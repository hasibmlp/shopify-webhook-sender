# Shopify Webhook Sender

A developer-focused CLI to test and replay Shopify webhooks using live store data.

## Features

- Fetch live Shopify data for various webhook topics.
- Send webhooks that are correctly shaped and signed with HMAC signatures.
- Manage multiple store credentials with a simple and secure profile system.
- Interactive prompts guide you when you're missing information.
- Use it as a global CLI or as a library in your own Node.js projects.

## Installation

```sh
# Install globally to use the 'sws' command
npm install -g shopify-webhook-sender
```
Note: The command is `shopify-webhook-sender`. A shorter alias, `sws`, is also available and recommended for daily use.

## Usage as a CLI

### 1. First-Time Setup

The tool uses profiles to securely store your store credentials. To create your first profile, run:
```sh
sws configure
```
This will interactively prompt you for a profile name (e.g., `default`, `my-staging-shop`), your Admin API Token, and your Webhook Secret. You can also save a default shop domain and destination URL for each profile.

### 2. Sending a Webhook

Use the `send` command to send a webhook.

```sh
# Run interactively, and the tool will ask for everything it needs
sws send

# Run non-interactively by providing all the details as flags
sws send \
  --profile my-staging-shop \
  --topic "orders/fulfilled" \
  --order-id 1234567890 \
  --shop "my-staging-shop.myshopify.com" \
  --url "https://my-app.com/webhooks/orders"
```

### 3. Commands and Options

- `sws --help`: Shows the main help message.
- `sws send`: Sends a webhook.
  - `--topic`: (Required) The topic to send.
  - `--order-id`: (Required for `orders/*` and `fulfillments/*` topics).
  - `--fulfillment-id`: (Required for `fulfillments/*` topics).
  - `--shop`: (Required unless a default is saved in your profile).
  - `--url`: (Required unless a default is saved in your profile).
  - `--profile`: The profile to use. Defaults to `default`.
  - `--token`, `--secret`: Override the profile's credentials for a single run.
  - `--dry-run`: Print the webhook payload to the console instead of sending it.
- `sws configure`: Interactively create or update a profile.
- `sws list-profiles`: List all your saved profiles with masked credentials.
- `sws list-topics`: List all webhook topics supported by the tool.

> **Currently Supported Topics:** `orders/fulfilled`, `fulfillments/create`.

## Usage as a Library

> **Warning:** Using this package as a library is a secondary feature. The API is stable but may be subject to changes in future major versions.

```typescript
import { sendCraftedWebhook } from 'shopify-webhook-sender';

// You must provide your own reference payload object when using the library.
const referencePayload = { "id": 123, "total_price": "100.00" }; // An example shape

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
3.  Run the CLI directly for testing: `pnpm dev <command>`.
4.  Build the project: `pnpm build`.
