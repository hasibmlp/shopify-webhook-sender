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
    throw new Error(`Fetch fulfillment failed: ${res.status} ${await res.text()}`);
  }
  const data = await res.json();
  if (!data?.fulfillment) {
    throw new Error("No 'fulfillment' in Admin response");
  }
  return data.fulfillment;
}

export async function fetchOrderEdit(
  orderId: string | number,
  shop: string,
  adminToken: string,
  apiVersion: string
) {
  const url = `https://${shop}/admin/api/${apiVersion}/orders/${orderId}/begin_edit.json`;
  const res = await fetch(url, {
    method: "POST",
    headers: {
      "X-Shopify-Access-Token": adminToken,
      "Content-Type": "application/json",
    },
  });
  if (!res.ok) {
    throw new Error(`Begin order edit failed: ${res.status} ${await res.text()}`);
  }
  const data = await res.json();
  if (!data?.calculated_order) {
    throw new Error("No 'calculated_order' in Admin response for begin_edit");
  }
  // The webhook payload is shaped like { "order_edit": { ... } }
  // The begin_edit endpoint returns { "calculated_order": { "id": ORDER_ID, ... } }
  // We will simulate the webhook structure.
  return {
    order_edit: data.calculated_order
  };
}
