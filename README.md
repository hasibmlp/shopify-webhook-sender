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

The tool needs your Shopify Admin API Token and Webhook Secret. It looks for these credentials in the following order:

1.  A local `.env` file in the directory you are running the command from.
2.  A global configuration file located at `~/.config/shopify-webhook-sender/.env`.
3.  Shell environment variables (`SHOPIFY_ADMIN_TOKEN`, `SHOPIFY_WEBHOOK_SECRET`).

For global use, creating the global config file is recommended. The tool will provide the exact path on first run if it can't find credentials.

You can set up the global configuration interactively by running:
```sh
send-shopify-webhook configure
```

An `.env.example` file is provided in this repository to show the required format.

### 2. Execution

The tool fetches a reference payload from a URL and then sends a new webhook shaped like that reference. The `--topic` flag determines what kind of webhook is sent.

```sh
# Send an orders/fulfilled webhook (default topic)
send-shopify-webhook \
  --order-id <ORDER_ID> \
  --url "..." --shop "..."

# Send a fulfillments/create webhook
send-shopify-webhook \
  --topic "fulfillments/create" \
  --fulfillment-id <FULFILLMENT_ID> \
  --url "..." --shop "..."
```

### 3. CLI Options

- `--url`, `--shop`: (Required)
- `--topic`: (Optional) The webhook topic to send. Defaults to `orders/fulfilled`. Supported topics currently include `orders/*` and `fulfillments/*`.
- `--order-id`: Required if the topic is `orders/*`.
- `--fulfillment-id`: Required if the topic is `fulfillments/*`.
- `--reference-url`: (Optional) A URL to a custom JSON payload to use for shaping. Defaults to a generic payload for the specified topic on GitHub.
- `--api-version`: The Shopify API version (default: `2025-10`).
- `--strict-schema`: Throws an error if any key in the reference is missing from the fetched data.
- `--dry-run`: Prints the payload and headers to the console without sending the request.


## Usage as a Library

```