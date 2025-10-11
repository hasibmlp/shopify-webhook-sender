import "dotenv/config";
import { sendWebhook } from "../src/index.js";

async function main() {
  const {
    SHOPIFY_SHOP,
    SHOPIFY_ADMIN_TOKEN,
    SHOPIFY_WEBHOOK_SECRET,
    DESTINATION_URL,
  } = process.env;

  if (!SHOPIFY_SHOP || !SHOPIFY_ADMIN_TOKEN || !SHOPIFY_WEBHOOK_SECRET || !DESTINATION_URL) {
    console.error("Missing required environment variables. Please check your .env file.");
    process.exit(1);
  }

  // In a real app, this would come from a database or an API request.
  const orderIdToTest = "6690122039555";

  console.log(`Sending webhook for orders/fulfilled for Order ID: ${orderIdToTest}...`);
  try {
    const result = await sendWebhook({
      topic: 'orders/fulfilled',
      orderId: orderIdToTest,
      shop: SHOPIFY_SHOP,
      adminToken: SHOPIFY_ADMIN_TOKEN,
      webhookSecret: SHOPIFY_WEBHOOK_SECRET,
      url: DESTINATION_URL,
    });
    console.log(`✅ Success! Event ID: ${result.eventId}, Status: ${result.status}`);
  } catch (e) {
    console.error("❌ Failed to send webhook:", e);
  }
}

main();
