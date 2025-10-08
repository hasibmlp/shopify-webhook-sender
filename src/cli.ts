#!/usr/bin/env node
import "dotenv/config";
import os from 'node:os';
import fs from 'node:fs';
import path from 'node:path';
import * as dotenv from 'dotenv';
import prompts from 'prompts';
import minimist from "minimist";
import { fetchOrder, fetchFulfillment } from "./shopify.js";
import { projectToShape } from "./shape.js";
import { sendWebhook } from "./sender.js";
import { fetchCurrentShippingPriceSet } from "./shopify-gql.js";

const DEFAULT_REFERENCE_URL_TEMPLATE = "https://raw.githubusercontent.com/hasibmlp/shopify-webhook-sender/main/references/{TOPIC}.json";

async function getReferencePayload(url: string | undefined, topic: string) {
  const finalUrl = url || DEFAULT_REFERENCE_URL_TEMPLATE.replace("{TOPIC}", topic.replace("/", "-"));

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

async function promptForMissingFlags(argv: minimist.ParsedArgs) {
  const onCancel = () => {
    console.log("\nCancelled.");
    process.exit(0);
  };

  let topic = argv.topic;

  // 1. Prompt for topic if missing
  if (!topic) {
    const topicAnswer = await prompts({
      type: 'select',
      name: 'topic',
      message: 'Select a webhook topic',
      choices: [
        { title: 'orders/fulfilled', value: 'orders/fulfilled' },
        { title: 'fulfillments/create', value: 'fulfillments/create' },
      ],
      initial: 0,
    }, { onCancel });
    topic = topicAnswer.topic;
  }

  // 2. Build the rest of the questions based on the topic
  const questions: prompts.PromptObject[] = [];
  const addQuestion = (name: string, message: string) => {
    if (!argv[name]) {
      questions.push({ type: 'text', name, message: `Please provide ${message}` });
    }
  };

  addQuestion('shop', 'the shop domain');
  addQuestion('url', 'the destination URL');

  if (topic.startsWith('orders/')) {
    addQuestion('order-id', 'the Order ID');
  }
  if (topic.startsWith('fulfillments/')) {
    addQuestion('order-id', 'the Order ID');
    addQuestion('fulfillment-id', 'the Fulfillment ID');
  }

  // 3. Run the second prompt if there are questions to ask
  let answers = {};
  if (questions.length > 0) {
    answers = await prompts(questions, { onCancel });
  }

  // 4. Combine everything
  return { ...argv, topic, ...answers };
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
  
  const onCancel = () => {
    console.log("\nCancelled.");
    process.exit(0);
  };

  const response = await prompts([
    {
      type: 'text',
      name: 'adminToken',
      message: 'Please enter your SHOPIFY_ADMIN_TOKEN (shpat_...):'
    },
    {
      type: 'password',
      name: 'webhookSecret',
      message: 'Please enter your SHOPIFY_WEBHOOK_SECRET:'
    }
  ], { onCancel });

  const { adminToken, webhookSecret } = response;
  
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
  let orderId = argv["order-id"];
  let fulfillmentId = argv["fulfillment-id"];
  let url = argv["url"];
  let shop = argv["shop"];
  const referenceUrl = argv["reference-url"];
  let topic: string = argv["topic"] || "orders/fulfilled";
  const apiVersion = argv["api-version"] || "2025-10";
  const strictSchema = argv["strict-schema"] || false;
  const dryRun = argv["dry-run"] || false;
  const eventId = argv["event-id"];
  const nonInteractive = argv["non-interactive"] || false;

  // --- Env & Basic Validation ---
  const env = getShopifyEnv();
  const adminToken = env.SHOPIFY_ADMIN_TOKEN;
  const webhookSecret = env.SHOPIFY_WEBHOOK_SECRET;

  if (nonInteractive) {
    if (!url || !shop) {
      console.error("Error: --url and --shop are required in non-interactive mode.");
      process.exit(1);
    }
    if (topic.startsWith('orders/') && !orderId) {
      console.error(`Error: --order-id is required for topic '${topic}' in non-interactive mode.`);
      process.exit(1);
    }
    if (topic.startsWith('fulfillments/') && (!orderId || !fulfillmentId)) {
      console.error(`Error: --order-id and --fulfillment-id are required for topic '${topic}' in non-interactive mode.`);
      process.exit(1);
    }
  } else {
    const combinedArgs = await promptForMissingFlags(argv) as minimist.ParsedArgs;
    // Re-assign vars after they've been potentially filled by prompts
    shop = combinedArgs.shop;
    url = combinedArgs.url;
    orderId = combinedArgs['order-id'];
    fulfillmentId = combinedArgs['fulfillment-id'];
    topic = combinedArgs.topic;
  }

  if (!adminToken || !webhookSecret) {
    console.error(`Error: Shopify credentials not found.

To set them up for global use, please run:
  send-shopify-webhook configure`);
    process.exit(1);
  }

  try {
    const entityId = orderId || fulfillmentId;
    console.log(`--- Sending new '${topic}' webhook for ID ${entityId} ---`);
    
    const reference = await getReferencePayload(referenceUrl, topic);
    let liveData;

    if (topic.startsWith('orders/')) {
      liveData = await fetchOrder(orderId, shop, adminToken, apiVersion);
    } else if (topic.startsWith('fulfillments/')) {
      liveData = await fetchFulfillment(orderId, fulfillmentId, shop, adminToken, apiVersion);
    } else {
      throw new Error(`Unsupported topic: ${topic}. Please use a topic starting with 'orders/' or 'fulfillments/'.`);
    }

    // GraphQL enrichment only for orders for now
    if (topic.startsWith('orders/') && reference && typeof reference === "object" && "current_shipping_price_set" in reference) {
      const gqlBag = await fetchCurrentShippingPriceSet(orderId, shop, adminToken, apiVersion).catch(() => null);
      const fallback = liveData.total_shipping_price_set ?? null;
      liveData = { ...liveData, current_shipping_price_set: gqlBag ?? fallback ?? null };
    }

    const projected = projectToShape(reference, liveData, { strict: strictSchema });
    const body = JSON.stringify(projected, null, 2);

    // --- Send Webhook ---
    const { eventId: sentEventId } = await sendWebhook({
      url,
      topic,
      shop,
      apiVersion,
      secret: webhookSecret,
      body,
      dryRun,
      eventId,
    });

    if (!dryRun) {
      const commandParts = ['send-shopify-webhook'];
      if (topic) commandParts.push(`--topic "${topic}"`);
      if (shop) commandParts.push(`--shop "${shop}"`);
      if (url) commandParts.push(`--url "${url}"`);
      if (orderId) commandParts.push(`--order-id ${orderId}`);
      if (fulfillmentId) commandParts.push(`--fulfillment-id ${fulfillmentId}`);
      if (eventId) commandParts.push(`--event-id "${eventId}"`);
      
      const command = commandParts.join(' \\\n  ');

      console.log("\nTo run this command again non-interactively, use:");
      console.log(command, "\n");
      console.log(`✅ Sent ${topic} for ID ${entityId} to ${url} (status 200). EventId=${sentEventId}`);
    }
  } catch (error: any) {
    console.error("Error:", error.message);
    process.exit(1);
  }
}

main();