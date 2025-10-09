export { fetchOrder, fetchFulfillment } from "./shopify.js";
export { fetchCurrentShippingPriceSet } from "./shopify-gql.js";
export { projectToShape } from "./shape.js";
export { hmacBase64 } from "./signer.js";
export { sendWebhook } from "./sender.js";

import { fetchOrder, fetchFulfillment } from "./shopify.js";
import { fetchCurrentShippingPriceSet } from "./shopify-gql.js";
import { projectToShape } from "./shape.js";
import { sendWebhook } from "./sender.js";

/**
 * Creates and sends a new webhook for a given order, shaped like a reference payload.
 */
export async function sendCraftedWebhook(opts: {
  entityId: string | number | { orderId: string | number, fulfillmentId: string | number };
  shop: string;
  adminToken: string;
  webhookSecret: string;
  url: string;
  reference: any;
  topic?: string;
  apiVersion?: string;
  strict?: boolean;
  dryRun?: boolean;
  eventId: string;
}) {
  const {
    entityId,
    shop,
    adminToken,
    webhookSecret,
    url,
    reference,
    topic = "orders/fulfilled",
    apiVersion = "2025-10",
    strict = false,
    dryRun = false,
    eventId,
  } = opts;

  let liveData;
  if (topic.startsWith('orders/')) {
    liveData = await fetchOrder(entityId as string | number, shop, adminToken, apiVersion);
  } else if (topic.startsWith('fulfillments/')) {
    const { orderId, fulfillmentId } = entityId as { orderId: string | number, fulfillmentId: string | number };
    liveData = await fetchFulfillment(orderId, fulfillmentId, shop, adminToken, apiVersion);
  } else {
    throw new Error(`Unsupported topic: ${topic}. Please use a topic starting with 'orders/' or 'fulfillments/'.`);
  }

  // Conditionally enrich the order with GraphQL data
  if (topic.startsWith('orders/') && reference && typeof reference === "object" && "current_shipping_price_set" in reference) {
    const gqlBag = await fetchCurrentShippingPriceSet(entityId as string | number, shop, adminToken, apiVersion).catch(() => null);
    const fallback = liveData.total_shipping_price_set ?? null;
    liveData = {
      ...liveData,
      current_shipping_price_set: gqlBag ?? fallback ?? null,
    };
  }

  // Project the live order onto the reference shape
  const projected = projectToShape(reference, liveData, { strict });

  // Stringify the body
  const body = JSON.stringify(projected, null, 2);

  // Send the webhook
  return sendWebhook({
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
