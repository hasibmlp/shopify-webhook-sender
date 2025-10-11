import { fetchOrder, fetchFulfillment } from "./core/shopify.js";
import { projectToShape } from "./core/shape.js";
import {
  sendWebhook as sendCraftedWebhook,
  SendWebhookParams,
} from "./core/sender.js";
import { fetchCurrentShippingPriceSet, fetchOrderEditData } from "./core/shopify-gql.js";
import { transformAgreementsToChanges } from "./core/order-edit-transformer.js";

const DEFAULT_REFERENCE_URL_TEMPLATE = "https://raw.githubusercontent.com/hasibmlp/shopify-webhook-sender/main/references/{TOPIC}.json";

async function getReferencePayload(url: string | undefined, topic: string) {
  const finalUrl = url || DEFAULT_REFERENCE_URL_TEMPLATE.replace("{TOPIC}", topic.replace("/", "-"));
  try {
    const res = await fetch(finalUrl);
    if (!res.ok) throw new Error(`HTTP error! status: ${res.status}`);
    return await res.json();
  } catch (e: any) {
    throw new Error(`Failed to fetch or parse reference payload from ${finalUrl}. Error: ${e.message}`);
  }
}

export type ShopifyWebhookSenderParams = {
  topic: string;
  shop: string;
  adminToken: string;
  webhookSecret: string;
  url: string;
  apiVersion?: string;
  orderId?: string;
  fulfillmentId?: string;
  referenceUrl?: string;
  eventId?: string;
  dryRun?: boolean;
  strictSchema?: boolean;
};

export async function sendWebhook(params: ShopifyWebhookSenderParams) {
  const {
    topic,
    shop,
    adminToken,
    webhookSecret,
    url,
    apiVersion = "2025-10",
    orderId,
    fulfillmentId,
    referenceUrl,
    eventId,
    dryRun = false,
    strictSchema = false,
  } = params;

  const reference = await getReferencePayload(referenceUrl, topic);
  let liveData: any;

  if (topic.startsWith('orders/')) {
    if (!orderId) throw new Error("`orderId` is required for topics starting with 'orders/'");
    liveData = await fetchOrder(orderId, shop, adminToken, apiVersion);
    if (topic === 'orders/edited') {
      const agreementsData = await fetchOrderEditData(orderId, shop, adminToken, apiVersion);
      const reconstructedEdit = transformAgreementsToChanges(agreementsData, liveData);

      if (!reconstructedEdit) {
        // Return a specific result indicating no action was taken
        return { success: true, reason: "NO_EDITS_FOUND", message: "No order edits found; webhook not sent." };
      }

      liveData = { ...liveData, order_edit: reconstructedEdit };
    }
  } else if (topic.startsWith('fulfillments/')) {
    if (!orderId || !fulfillmentId) throw new Error("`orderId` and `fulfillmentId` are required for topics starting with 'fulfillments/'");
    liveData = await fetchFulfillment(orderId, fulfillmentId, shop, adminToken, apiVersion);
  } else {
    throw new Error(`Unsupported topic: ${topic}.`);
  }

  if (topic.startsWith('orders/') && reference && typeof reference === "object" && "current_shipping_price_set" in reference) {
    if (!orderId) throw new Error("`orderId` is required for GraphQL enrichment");
    const gqlBag = await fetchCurrentShippingPriceSet(orderId, shop, adminToken, apiVersion).catch(() => null);
    const fallback = (liveData as any).total_shipping_price_set ?? null;
    liveData = { ...liveData, current_shipping_price_set: gqlBag ?? fallback ?? null };
  }

  const projected = projectToShape(reference, liveData, { strict: strictSchema });
  const body = JSON.stringify(projected, null, 2);

  return await sendCraftedWebhook({
    url,
    topic,
    shop,
    apiVersion,
    secret: webhookSecret,
    body,
    dryRun,
    eventId,
  });
}

// Re-export for advanced use
export { sendCraftedWebhook };
export type { SendWebhookParams };
