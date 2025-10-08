#!/usr/bin/env node
import "dotenv/config";
import os from 'node:os';
import fs from 'node:fs';
import path from 'node:path';
import * as dotenv from 'dotenv';
import readline from 'node:readline/promises';
import minimist from "minimist";
import { fetchOrder } from "./shopify.js";
import { projectToShape } from "./shape.js";
import { sendWebhook } from "./sender.js";
import { fetchCurrentShippingPriceSet } from "./shopify-gql.js";

const DEFAULT_REFERENCE_URL = "https://raw.githubusercontent.com/hasibmlp/shopify-webhook-sender/main/generic-reference.json";

async function getReferencePayload(url?: string) {
  const finalUrl = url || DEFAULT_REFERENCE_URL;
  if (!url) {
    console.log(`--reference-url not provided. Using default: ${finalUrl}`);
  } else {
    console.log(`Using provided reference URL: ${finalUrl}`);
  }

  try {
    const res = await fetch(finalUrl);
    if (!res.ok) {
      throw new Error(`HTTP error! status: ${res.status}`);
    }
    return await res.json();
  } catch (e: any) {
    throw new Error(`Failed to fetch or parse reference payload from ${finalUrl}. Error: ${e.message}`);
  }
}

function getShopifyEnv() {
  // 1. Local .env file
  const localPath = path.resolve(process.cwd(), '.env');
  const localConfig = fs.existsSync(localPath) ? dotenv.parse(fs.readFileSync(localPath)) : {};

  // 2. Global config file
  const globalDir = path.join(os.homedir(), '.config', 'shopify-webhook-sender');
  const globalPath = path.join(globalDir, '.env');
  const globalConfig = fs.existsSync(globalPath) ? dotenv.parse(fs.readFileSync(globalPath)) : {};

  // 3. Environment variables (process.env)
  // Merge them in order of priority: local > global > process.env
  return { ...process.env, ...globalConfig, ...localConfig };
}

async function runConfigureCommand() {
  console.log("Configuring Shopify Webhook Sender (global settings)");
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });

  const adminToken = await rl.question('? Please enter your SHOPIFY_ADMIN_TOKEN (shpat_...): ');
  const webhookSecret = await rl.question('? Please enter your SHOPIFY_WEBHOOK_SECRET: ');
  rl.close();

  if (!adminToken || !webhookSecret) {
    console.error("\n❌ Both token and secret are required. Configuration cancelled.");
    return;
  }

  const globalDir = path.join(os.homedir(), '.config', 'shopify-webhook-sender');
  const globalPath = path.join(globalDir, '.env');
  const content = `SHOPIFY_ADMIN_TOKEN="${adminToken}"\nSHOPIFY_WEBHOOK_SECRET="${webhookSecret}"\n`;

  try {
    if (!fs.existsSync(globalDir)) {
      fs.mkdirSync(globalDir, { recursive: true });
    }
    fs.writeFileSync(globalPath, content);
    console.log(`\n✅ Global configuration saved successfully to ${globalPath}`);
  } catch (e: any) {
    console.error(`\n❌ Failed to write configuration file: ${e.message}`);
  }
}


async function main() {
  const argv = minimist(process.argv.slice(2));

  if (argv._[0] === 'configure') {
    await runConfigureCommand();
    return;
  }

  // --- Flag Parsing ---
  const orderId = argv["order-id"];
  const url = argv["url"];
  const shop = argv["shop"];
  const referenceUrl = argv["reference-url"];
  const topic = argv["topic"] || "orders/fulfilled";
  const apiVersion = argv["api-version"] || "2025-10";
  const strictSchema = argv["strict-schema"] || false;
  const dryRun = argv["dry-run"] || false;

  // --- Env & Basic Validation ---
  const env = getShopifyEnv();
  const adminToken = env.SHOPIFY_ADMIN_TOKEN;
  const webhookSecret = env.SHOPIFY_WEBHOOK_SECRET;

  if (!orderId || !url || !shop) {
    console.error("Missing required flags: --order-id, --url, --shop");
    process.exit(1);
  }

  if (!adminToken || !webhookSecret) {
    console.error(`Error: Shopify credentials not found.

To set them up for global use, please run:
  send-shopify-webhook configure`);
    process.exit(1);
  }

  try {
    console.log(`--- Emulate Mode: Sending new webhook for order ${orderId} ---`);
    const reference = await getReferencePayload(referenceUrl);

    const rawOrder = await fetchOrder(orderId, shop, adminToken, apiVersion);

    let order = rawOrder;
    if (reference && typeof reference === "object" && "current_shipping_price_set" in reference) {
      const gqlBag = await fetchCurrentShippingPriceSet(orderId, shop, adminToken, apiVersion).catch(() => null);
      const fallback = rawOrder.total_shipping_price_set ?? null;
      order = { ...rawOrder, current_shipping_price_set: gqlBag ?? fallback ?? null };
    }

    const projected = projectToShape(reference, order, { strict: strictSchema });
    const body = JSON.stringify(projected, null, 2);

    // --- Send Webhook ---
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
      console.log(`Sent ${topic} for order ${orderId} to ${url} (status 200). EventId=${eventId}`);
    }
  } catch (error: any) {
    console.error("Error:", error.message);
    process.exit(1);
  }
}

main();
