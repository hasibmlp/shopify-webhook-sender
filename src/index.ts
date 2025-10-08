export { fetchOrder } from "./shopify.js";
export { fetchCurrentShippingPriceSet } from "./shopify-gql.js";
export { projectToShape } from "./shape.js";
export { hmacBase64 } from "./signer.js";
export { sendWebhook } from "./sender.js";

import { fetchOrder } from "./shopify.js";
import { fetchCurrentShippingPriceSet } from "./shopify-gql.js";
import { projectToShape } from "./shape.js";
import { sendWebhook } from "./sender.js";

/**
 * Creates and sends a new webhook for a given order, shaped like a reference payload.
 */
export async function sendCraftedWebhook(opts: {
  orderId: string | number;
  shop: string;
  adminToken: string;
  webhookSecret: string;
  url: string;
  reference: any;
  topic?: string;
  apiVersion?: string;
  strict?: boolean;
  dryRun?: boolean;
}) {
  const {
    orderId,
    shop,
    adminToken,
    webhookSecret,
    url,
    reference,
    topic = "orders/fulfilled",
    apiVersion = "2025-10",
    strict = false,
    dryRun = false,
  } = opts;

  // 1. Fetch the raw order from the REST API
  const rawOrder = await fetchOrder(orderId, shop, adminToken, apiVersion);

  // 2. Conditionally enrich the order with GraphQL data
  let order = rawOrder;
  if (reference && typeof reference === "object" && "current_shipping_price_set" in reference) {
    const gqlBag = await fetchCurrentShippingPriceSet(orderId, shop, adminToken, apiVersion).catch(() => null);
    const fallback = rawOrder.total_shipping_price_set ?? null;
    order = {
      ...rawOrder,
      current_shipping_price_set: gqlBag ?? fallback ?? null,
    };
  }

  // 3. Project the live order onto the reference shape
  const projected = projectToShape(reference, order, { strict });

  // 4. Stringify the body
  const body = JSON.stringify(projected, null, 2);

  // 5. Send the webhook
  return sendWebhook({
    url,
    topic,
    shop,
    apiVersion,
    secret: webhookSecret,
    body,
    dryRun,
  });
}
