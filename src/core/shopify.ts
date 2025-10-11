export async function fetchOrder(
  orderId: string | number,
  shop: string,
  adminToken: string,
  apiVersion: string
) {
  const url = `https://${shop}/admin/api/${apiVersion}/orders/${orderId}.json`;
  const res = await fetch(url, {
    headers: {
      "X-Shopify-Access-Token": adminToken,
      "Content-Type": "application/json",
    },
  });
  if (!res.ok) {
    if (res.status === 404) {
      throw new Error(
        `Could not find Order #${orderId} on shop '${shop}'.\n\nThis could be because:\n  • The Shop Domain is incorrect.\n  • The Order ID does not exist on that shop.\n  • Your Admin API Token does not have 'read_orders' scope for this shop.`
      );
    }
    throw new Error(`Fetch order failed: ${res.status} ${await res.text()}`);
  }
  const data = await res.json();
  if (!data?.order) {
    throw new Error("No 'order' in Admin response");
  }

  return data.order; // use as the source of truth
}

export async function fetchFulfillment(
  orderId: string | number,
  fulfillmentId: string | number,
  shop: string,
  adminToken: string,
  apiVersion: string
) {
  const url = `https://${shop}/admin/api/${apiVersion}/orders/${orderId}/fulfillments/${fulfillmentId}.json`;
  const res = await fetch(url, {
    headers: {
      "X-Shopify-Access-Token": adminToken,
      "Content-Type": "application/json",
    },
  });
  if (!res.ok) {
    if (res.status === 404) {
      throw new Error(
        `Could not find Fulfillment #${fulfillmentId} for Order #${orderId} on shop '${shop}'.\n\nThis could be because:\n  • The Shop Domain is incorrect.\n  • The Order ID or Fulfillment ID does not exist.\n  • Your Admin API Token does not have 'read_fulfillments' scope for this shop.`
      );
    }
    throw new Error(`Fetch fulfillment failed: ${res.status} ${await res.text()}`);
  }
  const data = await res.json();
  if (!data?.fulfillment) {
    throw new Error("No 'fulfillment' in Admin response");
  }

  return data.fulfillment;
}
