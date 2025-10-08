# Shopify Webhook Sender

A versatile CLI and library to send Shopify webhooks using live order data, shaped precisely against a remote reference payload.

## Features

- **High-Fidelity Sending**: Fetches live data from the Shopify Admin REST API.
- **Precise Shaping**: Deeply projects the live data onto the exact structure of a reference payload fetched from a URL.
- **GraphQL Enrichment**: Intelligently enriches the data by fetching `current_shipping_price_set` via the GraphQL API if required by the reference file.
- **Secure Signing**: Correctly computes the `X-Shopify-Hmac-Sha256` signature.
- **Dual Use**: Can be used as a global CLI or imported as a library into other Node.js projects.
- **Fully Automatic**: Works out-of-the-box by using a default, generic payload shape hosted on GitHub. No local configuration needed.

## Installation

```sh
# Install globally to use the CLI anywhere
pnpm add -g shopify-webhook-sender

# Or, install locally in a project to use as a library
pnpm add shopify-webhook-sender
```

## Usage as a CLI

### 1. Setup

Before running, create a `.env` file with your Shopify credentials (`SHOPIFY_ADMIN_TOKEN`, `SHOPIFY_WEBHOOK_SECRET`). An `.env.example` is provided.

### 2. Execution

The tool fetches a reference payload from a URL and then sends a new webhook shaped like that reference.

```sh
# It will automatically use a generic reference payload from GitHub
send-shopify-webhook \
  --order-id <ORDER_ID> \
  --url "..." --shop "..."

# Or, you can provide your own reference payload URL
send-shopify-webhook \
  --order-id <ORDER_ID> \
  --reference-url <URL_TO_YOUR_JSON> \
  --url "..." --shop "..."
```

### 3. CLI Options

- `--order-id`: (Required) The numeric Shopify order ID.
- `--url`: (Required) The webhook receiver endpoint.
- `--shop`: (Required) The shop domain (e.g., `your-shop.myself.com`).
- `--reference-url`: (Optional) A URL to a custom JSON payload to use for shaping. Defaults to a generic payload on GitHub.
- `--topic`: The webhook topic (default: `orders/fulfilled`).
- `--api-version`: The Shopify API version (default: `2025-10`).
- `--strict-schema`: Throws an error if any key in the reference is missing from the fetched order.
- `--dry-run`: Prints the payload and headers to the console without sending the request.


## Usage as a Library

```typescript
import { sendCraftedWebhook } from 'shopify-webhook-sender';

// You must provide your own reference payload object when using the library
const referencePayload = await fetch("https://.../your-reference.json").then(res => res.json());

await sendCraftedWebhook({
  orderId: '<NEW_ORDER_ID>',
  reference: referencePayload,
  // ... other required options like shop, adminToken, etc.
});
```
## Local Development

If you wish to contribute to or modify this tool:

1.  Clone the repository.
2.  Install dependencies: `pnpm install`.
3.  Run the CLI directly: `pnpm send ...` or `tsx src/cli.ts ...`.
4.  A `diff` script is available for testing: `pnpm diff file1.json file2.json`.

