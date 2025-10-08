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
  fulfillmentId: string | number,
  shop: string,
  adminToken: string,
  apiVersion: string
) {
  const url = `https://${shop}/admin/api/${apiVersion}/fulfillments/${fulfillmentId}.json`;
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
