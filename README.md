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

The tool needs your Shopify Admin API Token and Webhook Secret. It now uses a profile system, similar to the AWS CLI, to manage credentials for multiple projects.

All configuration is stored in two files in `~/.config/shopify-webhook-sender/`:
- `credentials`: Stores your `admin_token` and `webhook_secret` in named profiles.
- `config`: Stores optional default values like `shop` and `url` for each profile.

For the easiest setup, run the interactive configure command:
```sh
send-shopify-webhook configure
```
This will prompt you for a profile name (e.g., `default`, `client-a`), your credentials, and any optional defaults for that profile.

### 2. Execution

You can now specify which profile to use with the `--profile` flag. If you omit it, the `default` profile will be used.

```sh
# Send a webhook using the 'client-a' profile
send-shopify-webhook \
  --profile client-a \
  --order-id 1234567890

# Send a webhook using the 'default' profile (no flag needed)
send-shopify-webhook --order-id 1234567890
```

### 3. CLI Options

- `--profile <string>`: (Optional) The configuration profile to use. Defaults to `default`.
- `--url`, `--shop`: (Required, unless a default is configured for the profile)
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
