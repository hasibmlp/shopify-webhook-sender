import crypto from "node:crypto";
import { hmacBase64 } from "./signer.js";

export async function sendWebhook(opts: {
  url: string;
  topic: string;
  shop: string;
  apiVersion: string;
  secret: string;
  body: string; // projected JSON string
  dryRun?: boolean;
  eventId?: string;
}) {
  const { url, topic, shop, apiVersion, secret, body, dryRun, eventId: customEventId } = opts;

  const hmac = hmacBase64(secret, body);
  const eventId = customEventId || crypto.randomUUID();
  const webhookId = crypto.randomUUID();

  const headers = {
    "Content-Type": "application/json",
    "X-Shopify-Topic": topic,
    "X-Shopify-Shop-Domain": shop,
    "X-Shopify-Api-Version": apiVersion,
    "X-Shopify-Event-Id": eventId,
    "X-Shopify-Webhook-Id": webhookId,
    "X-Shopify-Hmac-Sha256": hmac,
  };

  if (dryRun) {
    console.log("[DRY RUN] POST", url);
    console.log(headers);
    console.log(JSON.stringify(JSON.parse(body), null, 2));
    return { headers, eventId, webhookId, status: 200, duration: 0 };
  }

  const startTime = Date.now();
  const res = await fetch(url, { method: "POST", headers, body });
  const duration = Date.now() - startTime;

  if (!res.ok) {
    throw new Error(`POST failed: ${res.status} ${await res.text()}`);
  }
  return { headers, eventId, webhookId, status: res.status, duration };
}
