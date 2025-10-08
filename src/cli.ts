#!/usr/bin/env node
import "dotenv/config";
import fs from "node:fs/promises";
import path from "node:path";
import minimist from "minimist";
import { fetchOrder } from "./shopify.js";
import { projectToShape } from "./shape.js";
import { sendWebhook } from "./sender.js";
import { fetchCurrentShippingPriceSet } from "./shopify-gql.js";

// small utility
function referenceExpectsCurrentShipping(ref: any): boolean {
  return ref && typeof ref === "object" && "current_shipping_price_set" in ref;
}

async function maybeEnrichCurrentShippingPriceSet(opts: {
  order: any;
  ref: any;
  shop: string;
  apiVersion: string;
  adminToken: string;
  orderId: string | number;
}) {
  const { order, ref, shop, apiVersion, adminToken, orderId } = opts;
  if (!referenceExpectsCurrentShipping(ref)) return order;

  const gqlBag = await fetchCurrentShippingPriceSet(
    orderId,
    shop,
    adminToken,
    apiVersion
  ).catch(() => null);

  // Prefer GraphQL; fallback to total_shipping_price_set when identical/no edits
  const fallback = order.total_shipping_price_set ?? null;
  return {
    ...order,
    current_shipping_price_set: gqlBag ?? fallback ?? null,
  };
}

async function main() {
  const argv = minimist(process.argv.slice(2));

  const orderId = argv["order-id"];
  const url = argv["url"];
  const shop = argv["shop"];
  const topic = argv["topic"] || "orders/fulfilled";
  const apiVersion = argv["api-version"] || "2025-10";
  const strictSchema = argv["strict-schema"] || false;
  const dryRun = argv["dry-run"] || false;

  const adminToken = process.env.SHOPIFY_ADMIN_TOKEN;
  const webhookSecret = process.env.SHOPIFY_WEBHOOK_SECRET;

  if (!orderId || !url || !shop) {
    console.error("Missing required flags: --order-id, --url, --shop");
    process.exit(1);
  }

  if (!adminToken || !webhookSecret) {
    console.error(
      "Missing required environment variables: SHOPIFY_ADMIN_TOKEN, SHOPIFY_WEBHOOK_SECRET"
    );
    process.exit(1);
  }

  try {
    const exampleJsonPath = path.resolve(process.cwd(), "reference.json");
    const reference = JSON.parse(await fs.readFile(exampleJsonPath, "utf-8"));

    const rawOrder = await fetchOrder(orderId, shop, adminToken, apiVersion);
    const order = await maybeEnrichCurrentShippingPriceSet({
      order: rawOrder,
      ref: reference,
      shop,
      apiVersion,
      adminToken,
      orderId,
    });

    const projected = projectToShape(reference, order, {
      strict: strictSchema,
    });

    const body = JSON.stringify(projected, null, 2);

    const { eventId } = await sendWebhook({
      url,
      topic,
      shop,
      apiVersion,
      secret: webhookSecret,
      body,
      dryRun,
    });

    if (!dryRun) {
      console.log(
        `Sent ${topic} for order ${orderId} to ${url} (status 200). EventId=${eventId}`
      );
    }
  } catch (error) {
    console.error("Error:", (error as Error).message);
    process.exit(1);
  }
}

main();
