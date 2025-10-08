# Shopify Webhook Sender

A versatile CLI and library to send Shopify webhooks using live order data, shaped precisely against a reference payload.

## Features

- **High-Fidelity Sending**: Fetches live data from the Shopify Admin REST API.
- **Precise Shaping**: Deeply projects the live data onto the exact structure of a reference `example.json` file.
- **GraphQL Enrichment**: Intelligently enriches the data by fetching `current_shipping_price_set` via the GraphQL API if required by the reference file.
- **Secure Signing**: Correctly computes the `X-Shopify-Hmac-Sha256` signature.
- **Flexible Usage**: Use it as a global CLI or import it as a library into other Node.js projects.

## Installation

```sh
# Install globally to use the CLI anywhere
pnpm add -g shopify-webhook-sender

# Or, install locally in a project to use as a library
pnpm add shopify-webhook-sender
```

## Usage as a CLI

After global installation (`pnpm add -g ...`), you can run the `send-shopify-webhook` command from any directory.

### 1. Setup

Before running, make sure your directory contains:
1.  A `reference.json` file (the webhook payload to use as a template).
2.  A `.env` file with your Shopify credentials.

```
# .env
SHOPIFY_ADMIN_TOKEN="shpat_..."
SHOPIFY_WEBHOOK_SECRET="shpss_..."
```

### 2. Execution

```sh
send-shopify-webhook \
  --order-id 1234567890 \
  --shop your-shop.myshopify.com \
  --url "https://your-receiver.com/webhook"
```

### 3. CLI Options

- `--order-id`: (Required) The numeric Shopify order ID.
- `--url`: (Required) The webhook receiver endpoint.
- `--shop`: (Required) The shop domain (e.g., `your-shop.myshopify.com`).
- `--topic`: The webhook topic (default: `orders/fulfilled`).
- `--api-version`: The Shopify API version (default: `2025-10`).
- `--strict-schema`: Throws an error if any key in `reference.json` is missing from the fetched order.
- `--dry-run`: Prints the payload and headers to the console without sending the request.

## Usage as a Library

After local installation (`pnpm add ...`), you can import the functions into your project.

```typescript
import { sendCraftedWebhook } from 'shopify-webhook-sender';
import * as fs from 'fs/promises';

async function myCustomLogic() {
  const referencePayload = JSON.parse(await fs.readFile('path/to/reference.json', 'utf8'));

  const result = await sendCraftedWebhook({
    orderId: '1234567890',
    shop: process.env.SHOPIFY_SHOP_DOMAIN,
    adminToken: process.env.SHOPIFY_ADMIN_TOKEN,
    webhookSecret: process.env.SHOPIFY_WEBHOOK_SECRET,
    url: 'https://your-receiver.com/webhook',
    reference: referencePayload,
  });

  console.log(`Sending successful! EventId: ${result.eventId}`);
}
```
## Local Development

If you wish to contribute to or modify this tool:

1.  Clone the repository.
2.  Install dependencies: `pnpm install`.
3.  Run the CLI directly: `pnpm send ...` or `tsx src/cli.ts ...`.
4.  A `diff` script is available for testing: `pnpm diff file1.json file2.json`.

