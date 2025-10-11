#!/usr/bin/env node
import "dotenv/config";
import os from 'node:os';
import fs from 'node:fs';
import path from 'node:path';
import prompts from 'prompts';
import minimist from "minimist";
import chalk from 'chalk';
import boxen from 'boxen';
import updateNotifier from 'update-notifier';
import { createRequire } from 'module';
import * as ini from 'ini';
import { fetchOrder, fetchFulfillment } from "./core/shopify.js";
import { projectToShape } from "./core/shape.js";
import { sendWebhook } from "./core/sender.js";
import { fetchCurrentShippingPriceSet, fetchOrderEditData } from "./core/shopify-gql.js";
import { logger } from './logger.js';
import { transformAgreementsToChanges } from "./core/order-edit-transformer.js";

const SUPPORTED_TOPICS = [
  { title: 'orders/fulfilled', value: 'orders/fulfilled' },
  { title: 'orders/edited', value: 'orders/edited' },
  { title: 'fulfillments/create', value: 'fulfillments/create' },
];

async function promptAndSaveDefaults(missing: { shop: boolean, url: boolean }, profile: string): Promise<{ shop?: string; url?: string; didSave: boolean }> {
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

  if (answers.shop) answers.shop = answers.shop.trim().replace(/["']/g, '');
  if (answers.url) answers.url = answers.url.trim().replace(/["']/g, '').replace(/\\/g, '');

  const thingsToSave: string[] = [];
  if (answers.shop) thingsToSave.push(`shop "${answers.shop}"`);
  if (answers.url) thingsToSave.push(`URL "${answers.url}"`);
  const thingsString = thingsToSave.join(' and ');

  const saveConfirmation = await prompts({
    type: 'confirm',
    name: 'save',
    message: `Save ${thingsString} as default for the "${profile}" profile?`,
    initial: true
  }, { onCancel });

  if (saveConfirmation.save) {
    const globalDir = path.join(os.homedir(), '.config', 'shopify-webhook-sender');
    const configPath = path.join(globalDir, 'config');

    if (!fs.existsSync(globalDir)) {
      fs.mkdirSync(globalDir, { recursive: true });
    }

    const config = fs.existsSync(configPath) ? ini.parse(fs.readFileSync(configPath, 'utf-8')) : {};
    const profileConfig = config[profile] || {};

    if (answers.shop) profileConfig.shop = answers.shop;
    if (answers.url) profileConfig.url = answers.url;

    config[profile] = profileConfig;
    fs.writeFileSync(configPath, ini.stringify(config));
    logger.info(`Defaults for profile "${profile}" saved to ${configPath}\n`);
  }

  return { ...answers, didSave: saveConfirmation.save };
}

const DEFAULT_REFERENCE_URL_TEMPLATE = "https://raw.githubusercontent.com/hasibmlp/shopify-webhook-sender/main/references/{TOPIC}.json";

async function getReferencePayload(url: string | undefined, topic: string, local: boolean = false) {
  if (local) {
    const localPath = path.join(process.cwd(), 'references', `${topic.replace('/', '-')}.json`);
    try {
      const fileContent = fs.readFileSync(localPath, 'utf-8');
      return JSON.parse(fileContent);
    } catch (e: any) {
      throw new Error(`Failed to read or parse local reference payload from ${localPath}. Error: ${e.message}`);
    }
  }
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

function getShopifyEnv(profile = 'default') {
  const globalDir = path.join(os.homedir(), '.config', 'shopify-webhook-sender');
  const credPath = path.join(globalDir, 'credentials');
  const configPath = path.join(globalDir, 'config');

  let credentials: Record<string, any> = {};
  if (fs.existsSync(credPath)) {
    const credFile = fs.readFileSync(credPath, 'utf-8');
    credentials = ini.parse(credFile);
  }

  let config: Record<string, any> = {};
  if (fs.existsSync(configPath)) {
    const configFile = fs.readFileSync(configPath, 'utf-8');
    config = ini.parse(configFile);
  }

  const profileCreds = (credentials[profile] || {}) as { admin_token?: string; webhook_secret?: string };
  const profileConfig = (config[profile] || {}) as { shop?: string; url?: string };

  return {
    SHOPIFY_ADMIN_TOKEN: profileCreds.admin_token,
    SHOPIFY_WEBHOOK_SECRET: profileCreds.webhook_secret,
    DEFAULT_SHOP: profileConfig.shop,
    DEFAULT_URL: profileConfig.url,
  };
}

async function runConfigureCommand() {
  logger.info("Configuring a new profile");

  const onCancel = () => {
    logger.plain("\nCancelled.");
    process.exit(0);
  };

  const { profileName } = await prompts({
    type: 'text',
    name: 'profileName',
    message: 'Enter a profile name (e.g., "my-shop"):',
    initial: 'default'
  }, { onCancel });

  if (!profileName) {
    logger.error("Profile name is required. Configuration cancelled.");
    return;
  }


  const response = await prompts([
    {
      type: 'password',
      name: 'adminToken',
      message: 'Enter SHOPIFY_ADMIN_TOKEN (shpat_...):'
    },
    {
      type: 'password',
      name: 'webhookSecret',
      message: 'Enter SHOPIFY_WEBHOOK_SECRET:'
    },
    {
      type: 'text',
      name: 'defaultShop',
      message: 'Enter a default shop domain (press Enter to skip):'
    },
    {
      type: 'text',
      name: 'defaultUrl',
      message: 'Enter a default destination URL (press Enter to skip):'
    }
  ], { onCancel });

  const { adminToken, webhookSecret, defaultShop, defaultUrl } = response;
  
  if (!adminToken || !webhookSecret) {
    logger.error("\nBoth token and secret are required. Configuration cancelled.");
    return;
  }

  const globalDir = path.join(os.homedir(), '.config', 'shopify-webhook-sender');
  const credPath = path.join(globalDir, 'credentials');
  const configPath = path.join(globalDir, 'config');

  if (!fs.existsSync(globalDir)) {
    fs.mkdirSync(globalDir, { recursive: true });
  }

  // --- Update Credentials ---
  const creds = fs.existsSync(credPath) ? ini.parse(fs.readFileSync(credPath, 'utf-8')) : {};
  creds[profileName] = {
    admin_token: adminToken,
    webhook_secret: webhookSecret,
  };
  fs.writeFileSync(credPath, ini.stringify(creds));

  // --- Update Config ---
  const config = fs.existsSync(configPath) ? ini.parse(fs.readFileSync(configPath, 'utf-8')) : {};
  const profileConfig = config[profileName] || {};
  if (defaultShop) profileConfig.shop = defaultShop;
  if (defaultUrl) profileConfig.url = defaultUrl;

  if (Object.keys(profileConfig).length > 0) {
    config[profileName] = profileConfig;
    fs.writeFileSync(configPath, ini.stringify(config));
  }

  logger.success(`\nProfile "${profileName}" saved successfully.`);
}

async function listProfiles() {
  const globalDir = path.join(os.homedir(), '.config', 'shopify-webhook-sender');
  const credPath = path.join(globalDir, 'credentials');
  const configPath = path.join(globalDir, 'config');

  const credentials: Record<string, any> = fs.existsSync(credPath) ? ini.parse(fs.readFileSync(credPath, 'utf-8')) : {};
  const config: Record<string, any> = fs.existsSync(configPath) ? ini.parse(fs.readFileSync(configPath, 'utf-8')) : {};

  const allProfiles = new Set([...Object.keys(credentials), ...Object.keys(config)]);

  if (allProfiles.size === 0) {
    logger.info("No profiles found. Run `sws configure` to create one.");
    return;
  }

  logger.info("Available profiles:");
  logger.break();

  const maskSecret = (secret?: string): string => {
    if (!secret) return 'Not set';
    if (secret.length <= 4) return '****';
    return `${'*'.repeat(16)}${secret.slice(-4)}`;
  }

  for (const profile of Array.from(allProfiles).sort()) {
    const creds = credentials[profile] || {};
    const conf = config[profile] || {};

    const details = [
      chalk.dim('Shop Domain:     ') + (conf.shop || 'Not set'),
      chalk.dim('Destination URL: ') + (conf.url || 'Not set'),
      chalk.dim('Admin Token:     ') + maskSecret(creds.admin_token),
      chalk.dim('Webhook Secret:  ') + maskSecret(creds.webhook_secret),
    ].join('\n');

    const title = chalk.bold(profile) + (profile === 'default' ? chalk.dim(' (default)') : '');
    logger.plain(boxen(details, { title, padding: 1, margin: { bottom: 1 }, borderStyle: 'round', borderColor: 'cyan' }));
  }
}

function runListTopicsCommand() {
  logger.plain("Supported webhook topics:");
  for (const topic of SUPPORTED_TOPICS) {
    logger.plain(`  - ${topic.value}`);
  }
}

function getAvailableProfiles(): string[] {
  const globalDir = path.join(os.homedir(), '.config', 'shopify-webhook-sender');
  const credPath = path.join(globalDir, 'credentials');
  const configPath = path.join(globalDir, 'config');

  const credentials: Record<string, any> = fs.existsSync(credPath) ? ini.parse(fs.readFileSync(credPath, 'utf-8')) : {};
  const config: Record<string, any> = fs.existsSync(configPath) ? ini.parse(fs.readFileSync(configPath, 'utf-8')) : {};

  const allProfiles = new Set([...Object.keys(credentials), ...Object.keys(config)]);
  return Array.from(allProfiles).sort();
}

function showHelp(command?: string) {
  const commands: Record<string, string> = {
    'send': `
  Sends a webhook based on live Shopify data. This is the default command.

  Usage
    $ sws send [options]

  Options
    --topic <string>          Webhook topic (e.g., "orders/fulfilled")
    --order-id <number>       Order ID
    --fulfillment-id <number> Fulfillment ID
    --shop <string>           Shop domain (e.g., "your-shop.myshopify.com")
    --url <string>            Destination URL
    --token <string>          Shopify Admin API Token (overrides profiles)
    --secret <string>         Shopify Webhook Secret (overrides profiles)
    --reference-url <string>  Custom reference payload URL
    --event-id <string>       Custom X-Shopify-Event-Id header
    --api-version <string>    Shopify API version (default: "2025-10")
    --strict-schema           Throw on schema mismatch
    --dry-run                 Print payload without sending
    --non-interactive         Disable all interactive prompts
    `,
    'configure': `
  Sets up a new profile for credentials and defaults via an interactive prompt.

  Usage
    $ sws configure
    `,
    'list-profiles': `
  Lists all configured profiles from your global settings.

  Usage
    $ sws list-profiles
    `,
    'list-topics': `
  Lists all supported webhook topics.

  Usage
    $ sws list-topics
    `,
    'global': `
  Usage
    $ shopify-webhook-sender <command> [options]
    $ sws <command> [options]

  Commands
    send                      Send a webhook (default command)
    configure                 Set up a new profile for credentials and defaults
    list-profiles             List all configured profiles
    list-topics               List all supported webhook topics

  Global Options
    --version, -v             Show version
    --help, -h                Show this help message for any command
    `
  };

  const helpText = commands[command || 'global'] || commands['global'];
  console.log(helpText);
}


async function runSendCommand(argv: minimist.ParsedArgs) {
  const knownFlags = new Set([
    '_',
    'topic',
    'order-id',
    'fulfillment-id',
    'shop',
    'url',
    'token',
    'secret',
    'reference-url',
    'event-id',
    'api-version',
    'strict-schema',
    'dry-run',
    'non-interactive',
    'profile',
    'local-reference', // Add the new flag
  ]);

  const unknownFlags = Object.keys(argv).filter(flag => !knownFlags.has(flag));

  if (unknownFlags.length > 0) {
    logger.error(`Error: Unknown option(s): ${unknownFlags.map(f => `--${f}`).join(', ')}`);
    logger.break();
    showHelp();
    process.exit(1);
  }

  // --- Flag Parsing ---
  let orderId = argv["order-id"];
  let fulfillmentId = argv["fulfillment-id"];
  let url = argv["url"];
  let shop = argv["shop"];
  const referenceUrl = argv["reference-url"];
  let topic: string = argv["topic"];
  const apiVersion = argv["api-version"] || "2025-10";
  const strictSchema = argv["strict-schema"] || false;
  const dryRun = argv["dry-run"] || false;
  const eventId = argv["event-id"];
  const nonInteractive = argv["non-interactive"] || false;
  const localReference = argv["local-reference"] || false;
  
  let profile = argv["profile"];
  if (!profile && !nonInteractive && !argv.token && !argv.secret) {
    const profiles = getAvailableProfiles();
    if (profiles.length > 0 && !profiles.includes('default')) {
      const onCancel = () => {
        logger.plain("\nCancelled.");
        process.exit(0);
      };
      const profileAnswer = await prompts({
        type: 'select',
        name: 'profile',
        message: 'No default profile found. Please choose a profile to use:',
        choices: profiles.map(p => ({ title: p, value: p })),
      }, { onCancel });

      profile = profileAnswer.profile;
    }
  }
  profile = profile || 'default';
  
  let wasInteractive = false;
  let defaultsWereSaved = false;

  // --- Env & Basic Validation ---
  const env = getShopifyEnv(profile);
  const adminToken = argv.token || env.SHOPIFY_ADMIN_TOKEN;
  const webhookSecret = argv.secret || env.SHOPIFY_WEBHOOK_SECRET;

  if (profile !== 'default' || argv.profile) {
    logger.step(`Using profile: ${chalk.bold(profile)}`);
  }

  if (nonInteractive) {
    if (!topic) {
      logger.error("Error: --topic is a required flag in non-interactive mode.");
      process.exit(1);
    }
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
  } else {
    // A robust check for interactive mode:
    // Are there any flags (other than '_')? Are there any positional args?
    // If the answer to both is no, we go interactive.
    const { _, ...flags } = argv;
    // We want to ignore the 'profile' flag when deciding to go interactive
    delete (flags as any).profile;
    const hasNoFlags = Object.keys(flags).length === 0;
    const hasNoPositionalArgs = _.length === 0;

    if (hasNoFlags && hasNoPositionalArgs) {
      const combinedArgs = await promptForMissingFlags(argv, env) as minimist.ParsedArgs;
      // Re-assign vars and sanitize them
      shop = (combinedArgs.shop || env.DEFAULT_SHOP || '').trim().replace(/["']/g, '');
      url = (combinedArgs.url || env.DEFAULT_URL || '').trim().replace(/["']/g, '');
      orderId = String(combinedArgs['order-id'] || '').trim();
      fulfillmentId = String(combinedArgs['fulfillment-id'] || '').trim();
      topic = combinedArgs.topic;
      wasInteractive = true;
    } else {
      // Partially interactive: some flags were passed, but we might still need to prompt for the topic.
      if (!topic) {
        const onCancel = () => { process.exit(0); };
        const topicAnswer = await prompts({
          type: 'select',
          name: 'topic',
          message: 'Select a webhook topic',
          choices: SUPPORTED_TOPICS,
        }, { onCancel });
        topic = topicAnswer.topic;
        if (!topic) process.exit(0); // User cancelled
        wasInteractive = true;
      }
      // If flags are passed, still respect the defaults from env if a flag is omitted
      const rawShop = shop ? String(shop) : (env.DEFAULT_SHOP || '');
      shop = rawShop.trim().replace(/["']/g, '');

      const rawUrl = url ? String(url) : (env.DEFAULT_URL || '');
      url = rawUrl.trim().replace(/["']/g, '');
    }
  }

  // After determining the topic, we must ensure we have the required IDs, even in partial-interactive mode.
  if (!nonInteractive) {
    const onCancel = () => { logger.plain("\nCancelled."); process.exit(0); };
    if (topic.startsWith('orders/') && !orderId) {
      const { id } = await prompts({ type: 'text', name: 'id', message: 'Please provide the Order ID' }, { onCancel });
      orderId = id;
      if (!orderId) process.exit(1);
      wasInteractive = true;
    }
    if (topic.startsWith('fulfillments/')) {
      if (!orderId) {
        const { id } = await prompts({ type: 'text', name: 'id', message: 'Please provide the Order ID' }, { onCancel });
        orderId = id;
        if (!orderId) process.exit(1);
        wasInteractive = true;
      }
      if (!fulfillmentId) {
        const { id } = await prompts({ type: 'text', name: 'id', message: 'Please provide the Fulfillment ID' }, { onCancel });
        fulfillmentId = id;
        if (!fulfillmentId) process.exit(1);
        wasInteractive = true;
      }
    }
  }

  if (!url || !shop) {
    const newValues = await promptAndSaveDefaults({ shop: !shop, url: !url }, profile);
    if (!shop && newValues.shop) shop = newValues.shop;
    if (!url && newValues.url) url = newValues.url;
    wasInteractive = true;
    defaultsWereSaved = newValues.didSave;
  }

  if (!adminToken || !webhookSecret) {
    logger.error(`Error: Shopify credentials not found.\n\nTo set them up, you can either:\n1. Pass them directly using --token and --secret flags.\n2. Run the configure command: sws configure`);
    process.exit(1);
  }

  try {
    const entityId = orderId || fulfillmentId;

    if (wasInteractive) {
      const commandParts = [
        'sws send',
      ];

      if (profile && profile !== 'default') {
        commandParts.push(`--profile "${profile}"`);
      }

      commandParts.push(`--topic "${topic}"`);

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
      logger.plain(chalk.gray(`\nRun \`sws send --help\` for all available options.\n`));
    }

    if (topic === 'orders/edited') {
      logger.warn(
        "Notice: The 'orders/edited' payload is a reconstruction. Some fields (like discounts) may be omitted or differ slightly from a live Shopify webhook.",
      )
    }

    logger.info(`Fetching live data from Shopify...`);

    const reference = await getReferencePayload(
      referenceUrl,
      topic,
      localReference
    );
    let liveData;

    if (topic.startsWith("orders/")) {
      liveData = await fetchOrder(orderId, shop, adminToken, apiVersion);
      if (topic === "orders/edited") {
        const agreementsData = await fetchOrderEditData(orderId as string, shop, adminToken, apiVersion);

        const reconstructedEdit = transformAgreementsToChanges(agreementsData, liveData);

        if (!reconstructedEdit) {
          logger.step("No order edits found for this order. No webhook will be sent.");
          return;
        }
        
        liveData = { ...liveData, order_edit: reconstructedEdit };
      }
    } else if (topic.startsWith("fulfillments/")) {
      liveData = await fetchFulfillment(
        orderId,
        fulfillmentId,
        shop,
        adminToken,
        apiVersion
      );
    } else {
      throw new Error(
        `Unsupported topic: ${topic}. Please use one of the supported topics.`
      );
    }

    // GraphQL enrichment only for orders for now
    if (topic.startsWith('orders/') && reference && typeof reference === "object" && "current_shipping_price_set" in reference) {
      const gqlBag = await fetchCurrentShippingPriceSet(orderId, shop, adminToken, apiVersion).catch(() => null);
      const fallback = liveData.total_shipping_price_set ?? null;
      liveData = { ...liveData, current_shipping_price_set: gqlBag ?? fallback ?? null };
    }

    const projected = projectToShape(reference, liveData, { strict: strictSchema });
    const body = JSON.stringify(projected, null, 2);

    logger.info(`Sending webhook to ${url}...`);
    // --- Send Webhook ---
    const { eventId: sentEventId, status, duration } = await sendWebhook({
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
      logger.details('Status:', String(status));
      logger.details('Duration:', `${duration}ms`);
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

    // Extract status code from the error message if possible
    const statusMatch = error.message.match(/\b(\d{3})\b/);
    if (statusMatch) {
      logger.details('Status:', statusMatch[1]);
    }

    logger.break();
    logger.details('Details:', error.message);
    process.exit(1);
  }
}

async function main() {
  const require = createRequire(import.meta.url);
  const pkg = require('../package.json');
  updateNotifier({ pkg }).notify();

  const rawArgv = minimist(process.argv.slice(2));
  const command = rawArgv._[0];

  if (rawArgv.version || rawArgv.v) {
    console.log(pkg.version);
    return;
  }
  
  // Sanitize URL input at the source to handle shell escaping
  if (rawArgv.url && typeof rawArgv.url === 'string') {
    rawArgv.url = rawArgv.url.replace(/\\/g, '');
  }

  switch (command) {
    case 'send':
      rawArgv._.shift();
      if (rawArgv.help || rawArgv.h) { showHelp('send'); return; }
      await runSendCommand(rawArgv);
      break;
    case 'configure':
      if (rawArgv.help || rawArgv.h) { showHelp('configure'); return; }
      await runConfigureCommand();
      break;
    case 'list-profiles':
      if (rawArgv.help || rawArgv.h) { showHelp('list-profiles'); return; }
      await listProfiles();
      break;
    case 'list-topics':
      if (rawArgv.help || rawArgv.h) { showHelp('list-topics'); return; }
      runListTopicsCommand();
      break;
    default:
      // If no command is specified, or an unknown command is given,
      // check for legacy flags or show help.
      if (rawArgv.help || rawArgv.h || (rawArgv._.length === 1 && rawArgv._[0] === '-')) {
        showHelp();
        return;
      }

      // If there are any flags that suggest a "send" operation, we can
      // assume the user is using the old format and run the send command.
      const legacySendFlags = ['topic', 'order-id', 'fulfillment-id', 'shop', 'url'];
      const isLegacySend = Object.keys(rawArgv).some(key => legacySendFlags.includes(key));
      
      if (isLegacySend) {
        if (rawArgv.help || rawArgv.h) { showHelp('send'); return; }
        await runSendCommand(rawArgv);
      } else {
        showHelp();
      }
      break;
  }
}

main();