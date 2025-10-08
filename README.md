# Shopify Webhook Sender

A versatile CLI and library to send Shopify webhooks using live data, shaped precisely against a remote reference payload.

## Features

- **High-Fidelity Sending**: Fetches live data from the Shopify Admin REST API.
- **Precise Shaping**: Deeply projects live data onto the exact structure of a reference payload.
- **Automatic & Flexible**: Works out-of-the-box using default reference payloads from GitHub, or you can provide your own.
- **Multi-Topic Support**: Natively supports `orders/*` and `fulfillments/*` topics, with clear ID requirements for each.
- **GraphQL Enrichment**: Intelligently enriches order data by fetching `current_shipping_price_set` via the GraphQL API if needed.
- **Secure Signing**: Correctly computes the `X-Shopify-Hmac-Sha256` signature for all webhooks.
- **Professional CLI**: Features an interactive `configure` command and a smart credential system (local `.env` > global config).
- **Dual Use**: Can be used as a global CLI or imported as a library into other Node.js projects.

## Installation

```sh
# Install globally to use the CLI anywhere
pnpm add -g shopify-webhook-sender

# Or, install locally in a project to use as a library
pnpm add shopify-webhook-sender
```

## Usage as a CLI

### 1. Setup

The tool needs your Shopify Admin API Token and Webhook Secret. It looks for these credentials in the following order:

1.  A local `.env` file in the directory you are running the command from.
2.  A global configuration file located at `~/.config/shopify-webhook-sender/.env`.
3.  Shell environment variables (`SHOPIFY_ADMIN_TOKEN`, `SHOPIFY_WEBHOOK_SECRET`).

For the easiest setup, run the interactive configure command once:
```sh
send-shopify-webhook configure
```
This will create the global configuration file for you. You can also set optional `DEFAULT_SHOP` and `DEFAULT_URL` values to make the CLI even faster to use.

### 2. Execution

The tool fetches a reference payload and sends a new webhook shaped like that reference. If default values are configured, you can omit the `--shop` and `--url` flags.

```sh
# Send an orders/fulfilled webhook using configured defaults
send-shopify-webhook --order-id 1234567890

# Send a fulfillments/create webhook
send-shopify-webhook \
  --topic "fulfillments/create" \
  --order-id 1234567890 \
  --fulfillment-id 9876543210 \
  --shop your-shop.myshopify.com \
  --url "https://your-receiver.com/webhook"
```

### 3. CLI Options

- `--url`, `--shop`: (Required, unless a default is configured)
- `--topic`: (Optional) The webhook topic to send. Defaults to `orders/fulfilled`.
- `--order-id`: Required for `orders/*` and `fulfillments/*` topics.
- `--fulfillment-id`: Required for `fulfillments/*` topics.
- `--reference-url`: (Optional) A URL to a custom JSON payload for shaping. Defaults to a generic payload for the specified topic on GitHub.
- `--event-id`: (Optional) A custom value for the `X-Shopify-Event-Id` header.
- `--api-version`: The Shopify API version (default: `2025-10`).
- `--strict-schema`: Throws an error if any key in the reference is missing from the fetched data.
- `--dry-run`: Prints the payload and headers to the console without sending.
- `--non-interactive`: (Optional) Disables all interactive prompts. If required flags are missing, the command will fail with an error. Useful for scripts and automation.

## Usage as a Library

The package can be used programmatically in your own Node.js projects.

```typescript
import { sendCraftedWebhook } from 'shopify-webhook-sender';

// You must provide your own reference payload object when using the library.
// You can fetch the default one or use your own.
const referencePayload = await fetch("https://raw.githubusercontent.com/hasibmlp/shopify-webhook-sender/main/references/orders-fulfilled.json").then(res => res.json());

async function myCustomLogic() {
  const result = await sendCraftedWebhook({
    orderId: '1234567890',
    shop: process.env.SHOPIFY_SHOP,
    adminToken: process.env.SHOPIFY_ADMIN_TOKEN,
    webhookSecret: process.env.SHOPIFY_WEBHOOK_SECRET,
    url: 'https://your-receiver.com/webhook',
    reference: referencePayload,
  });

  console.log(`✅ Sending successful! EventId: ${result.eventId}`);
}
```

## Local Development

If you wish to contribute to or modify this tool:

1.  Clone the repository.
2.  Install dependencies: `pnpm install`.
3.  Run the CLI directly: `pnpm send ...` or `tsx src/cli.ts ...`.
4.  A `diff` script is available for testing: `pnpm diff file1.json file2.json`.