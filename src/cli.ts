#!/usr/bin/env node
import "dotenv/config";
import os from 'node:os';
import fs from 'node:fs';
import path from 'node:path';
import * as dotenv from 'dotenv';
import prompts from 'prompts';
import minimist from "minimist";
import chalk from 'chalk';
import boxen from 'boxen';
import updateNotifier from 'update-notifier';
import { createRequire } from 'module';
import { fetchOrder, fetchFulfillment, fetchOrderEdit } from "./shopify.js";
import { projectToShape } from "./shape.js";
import { sendWebhook } from "./sender.js";
import { fetchCurrentShippingPriceSet } from "./shopify-gql.js";
import { logger } from './logger.js';

const SUPPORTED_TOPICS = [
  { title: 'orders/fulfilled', value: 'orders/fulfilled' },
  { title: 'orders/edited', value: 'orders/edited' },
  { title: 'fulfillments/create', value: 'fulfillments/create' },
];

async function promptAndSaveDefaults(missing: { shop: boolean, url: boolean }): Promise<{ shop?: string; url?: string; didSave: boolean }> {
  const onCancel = () => {
    logger.plain("\nCancelled.");
    process.exit(0);
  };

  const questions: prompts.PromptObject[] = [];
  if (missing.shop) {
    questions.push({ type: 'text', name: 'shop', message: 'Please provide the shop domain' });
  }
  if (missing.url) {
    questions.push({ type: 'text', name: 'url', message: 'Please provide the destination URL' });
  }

  const answers = await prompts(questions, { onCancel });

  if ((missing.shop && !answers.shop) || (missing.url && !answers.url)) {
    logger.error("Shop and URL are required to proceed. Aborting.");
    process.exit(1);
  }

  // Sanitize the inputs before they are used or saved
  if (answers.shop) answers.shop = answers.shop.trim().replace(/["']/g, '');
  if (answers.url) answers.url = answers.url.trim().replace(/["']/g, '').replace(/\\/g, '');

  const saveConfirmation = await prompts({
    type: 'confirm',
    name: 'save',
    message: 'Save this shop and URL as defaults for future use?',
    initial: true
  }, { onCancel });

  if (saveConfirmation.save) {
    const globalDir = path.join(os.homedir(), '.config', 'shopify-webhook-sender');
    const globalPath = path.join(globalDir, '.env');
    const existingConfig = fs.existsSync(globalPath) ? dotenv.parse(fs.readFileSync(globalPath)) : {};

    const newConfig = {
      ...existingConfig,
      ...(answers.shop && { DEFAULT_SHOP: answers.shop }),
      ...(answers.url && { DEFAULT_URL: answers.url }),
    };

    const content = Object.entries(newConfig)
      .map(([key, value]) => `${key}="${value}"`)
      .join('\n') + '\n';

    if (!fs.existsSync(globalDir)) {
      fs.mkdirSync(globalDir, { recursive: true });
    }
    fs.writeFileSync(globalPath, content);
    logger.info(`Defaults saved to ${globalPath}\n`);
  }

  return { ...answers, didSave: saveConfirmation.save };
}

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

async function promptForMissingFlags(argv: minimist.ParsedArgs, env: NodeJS.ProcessEnv) {
  const onCancel = () => {
    logger.plain("\nCancelled.");
    process.exit(0);
  };

  let topic = argv.topic;

  // 1. Prompt for topic if missing
  if (!topic) {
    const topicAnswer = await prompts({
      type: 'select',
      name: 'topic',
      message: 'Select a webhook topic',
      choices: SUPPORTED_TOPICS,
      initial: 0,
    }, { onCancel });
    topic = topicAnswer.topic;
  }

  // 2. Build the rest of the questions based on the topic
  const questions: prompts.PromptObject[] = [];
  const addQuestion = (name: string, message: string, envVar?: string) => {
    if (!argv[name] && (!envVar || !env[envVar])) {
      questions.push({ type: 'text', name, message: `Please provide ${message}` });
    }
  };

  addQuestion('shop', 'the shop domain', 'DEFAULT_SHOP');
  addQuestion('url', 'the destination URL', 'DEFAULT_URL');

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
  logger.info("Configuring Shopify Webhook Sender (global settings)");
  
  const onCancel = () => {
    logger.plain("\nCancelled.");
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
    },
    {
      type: 'text',
      name: 'defaultShop',
      message: 'Enter a default shop domain (optional):'
    },
    {
      type: 'text',
      name: 'defaultUrl',
      message: 'Enter a default destination URL (optional):'
    }
  ], { onCancel });

  const { adminToken, webhookSecret, defaultShop, defaultUrl } = response;
  
  if (!adminToken || !webhookSecret) {
    logger.error("\nBoth token and secret are required. Configuration cancelled.");
    return;
  }

  const globalDir = path.join(os.homedir(), '.config', 'shopify-webhook-sender');
  const globalPath = path.join(globalDir, '.env');

  const existingConfig = fs.existsSync(globalPath) ? dotenv.parse(fs.readFileSync(globalPath)) : {};
  const newConfig = { ...existingConfig };

  // Always update credentials
  newConfig.SHOPIFY_ADMIN_TOKEN = adminToken;
  newConfig.SHOPIFY_WEBHOOK_SECRET = webhookSecret;

  // Handle optional defaults - allows unsetting with an empty string
  if (defaultShop) {
    newConfig.DEFAULT_SHOP = defaultShop;
  } else if (defaultShop === '') {
    delete newConfig.DEFAULT_SHOP;
  }

  if (defaultUrl) {
    newConfig.DEFAULT_URL = defaultUrl;
  } else if (defaultUrl === '') {
    delete newConfig.DEFAULT_URL;
  }

  const content = Object.entries(newConfig)
    .map(([key, value]) => `${key}="${value}"`)
    .join('\n') + '\n';

  try {
    if (!fs.existsSync(globalDir)) {
      fs.mkdirSync(globalDir, { recursive: true });
    }
    fs.writeFileSync(globalPath, content);
    logger.success(`\nGlobal configuration saved successfully to ${globalPath}`);
  } catch (e: any) {
    logger.error(`\nFailed to write configuration file: ${e.message}`);
  }
}


async function main() {
  const require = createRequire(import.meta.url);
  const pkg = require('../package.json');
  updateNotifier({ pkg }).notify();

  const argv = minimist(process.argv.slice(2));

  if (argv.version || argv.v) {
    console.log(pkg.version);
    return;
  }

  if (argv.help || argv.h) {
    console.log(`
  Usage
    $ send-shopify-webhook <options>

  Options
    --topic <string>          Webhook topic (e.g., "orders/fulfilled")
    --order-id <number>       Order ID
    --fulfillment-id <number> Fulfillment ID
    --shop <string>           Shop domain (e.g., "your-shop.myshopify.com")
    --url <string>            Destination URL
    --reference-url <string>  Custom reference payload URL
    --event-id <string>       Custom X-Shopify-Event-Id header
    --api-version <string>    Shopify API version (default: "2025-10")
    --strict-schema           Throw on schema mismatch
    --dry-run                 Print payload without sending
    --non-interactive         Disable all interactive prompts
    --version, -v             Show version
    --help, -h                Show this help message

  Commands
    configure                 Set up global credentials and defaults
      `);
    return;
  }

  // Sanitize URL input at the source to handle shell escaping
  if (argv.url && typeof argv.url === 'string') {
    argv.url = argv.url.replace(/\\/g, '');
  }

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
  let wasInteractive = false;
  let defaultsWereSaved = false;

  // --- Env & Basic Validation ---
  const env = getShopifyEnv();
  const adminToken = env.SHOPIFY_ADMIN_TOKEN;
  const webhookSecret = env.SHOPIFY_WEBHOOK_SECRET;

  if (nonInteractive) {
    if (!url || !shop) {
      logger.error("Error: --url and --shop are required in non-interactive mode.");
      process.exit(1);
    }
    if (topic.startsWith('orders/') && !orderId) {
      logger.error(`Error: --order-id is required for topic '${topic}' in non-interactive mode.`);
      process.exit(1);
    }
    if (topic.startsWith('fulfillments/') && (!orderId || !fulfillmentId)) {
      logger.error(`Error: --order-id and --fulfillment-id are required for topic '${topic}' in non-interactive mode.`);
      process.exit(1);
    }
  } else if (Object.keys(argv).length <= 2 && argv._.length === 0) { // Check for empty or just '_' and '$0'
    const combinedArgs = await promptForMissingFlags(argv, env) as minimist.ParsedArgs;
    // Re-assign vars and sanitize them
    shop = (combinedArgs.shop || env.DEFAULT_SHOP || '').trim().replace(/["']/g, '');
    url = (combinedArgs.url || env.DEFAULT_URL || '').trim().replace(/["']/g, '');
    orderId = String(combinedArgs['order-id'] || '').trim();
    fulfillmentId = String(combinedArgs['fulfillment-id'] || '').trim();
    topic = combinedArgs.topic;
    wasInteractive = true;
  } else {
    // If flags are passed, still respect the defaults from env if a flag is omitted
    const rawShop = shop ? String(shop) : (env.DEFAULT_SHOP || '');
    shop = rawShop.trim().replace(/["']/g, '');

    const rawUrl = url ? String(url) : (env.DEFAULT_URL || '');
    url = rawUrl.trim().replace(/["']/g, '');
  }

  if (!url || !shop) {
    const newValues = await promptAndSaveDefaults({ shop: !shop, url: !url });
    if (!shop && newValues.shop) shop = newValues.shop;
    if (!url && newValues.url) url = newValues.url;
    wasInteractive = true;
    defaultsWereSaved = newValues.didSave;
  }

  if (!adminToken || !webhookSecret) {
    logger.error(`Error: Shopify credentials not found.\n\nTo set them up for global use, please run:\n  send-shopify-webhook configure`);
    process.exit(1);
  }

  try {
    const entityId = orderId || fulfillmentId;

    if (wasInteractive) {
      const commandParts = [
        'send-shopify-webhook',
        `--topic "${topic}"`,
      ];

      // Only add shop and url to the main command if they aren't using a configured default
      if (!env.DEFAULT_SHOP || argv.shop) {
        commandParts.push(`--shop "${shop}"`);
      }
      if (!env.DEFAULT_URL || argv.url) {
        commandParts.push(`--url "${url}"`);
      }

      if (orderId) commandParts.push(`--order-id ${orderId}`);
      if (fulfillmentId) commandParts.push(`--fulfillment-id ${fulfillmentId}`);
      if (eventId) commandParts.push(`--event-id "${eventId}"`);

      const command = commandParts.join(' \\\n  ');

      logger.plain(`\nTo run this command again non-interactively, use:\n`);
      logger.plain(chalk.cyan(`  ${command}`));
      logger.plain(chalk.gray(`\nRun \`send-shopify-webhook --help\` for all available options.\n`));
    }

    logger.info(`Sending new '${topic}' webhook for ID ${entityId} ...`);
    
    const reference = await getReferencePayload(referenceUrl, topic);
    let liveData;

    if (topic === 'orders/edited') {
      liveData = await fetchOrderEdit(orderId, shop, adminToken, apiVersion);
    } else if (topic.startsWith('orders/')) {
      liveData = await fetchOrder(orderId, shop, adminToken, apiVersion);
    } else if (topic.startsWith('fulfillments/')) {
      liveData = await fetchFulfillment(orderId, fulfillmentId, shop, adminToken, apiVersion);
    } else {
      throw new Error(`Unsupported topic: ${topic}. Please use one of the supported topics.`);
    }

    // GraphQL enrichment only for orders for now
    if (topic.startsWith('orders/') && topic !== 'orders/edited' && reference && typeof reference === "object" && "current_shipping_price_set" in reference) {
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
      logger.success(`✅ Success!`);
      logger.break();
      logger.details('Topic:', topic);
      logger.details('Shop:', shop);
      logger.details('Destination:', url);
      logger.details('Event ID:', sentEventId);
    }
  } catch (error: any) {
    logger.error(`❌ Error!`);
    logger.break();
    logger.details('Topic:', topic);
    if (shop) logger.details('Shop:', shop);
    if (url) logger.details('Destination:', url);
    const entityId = orderId || fulfillmentId;
    if (entityId) logger.details('ID:', String(entityId));
    logger.break();
    logger.details('Details:', error.message);
    process.exit(1);
  }
}

main();