// src/shopify-gql.ts
export async function fetchCurrentShippingPriceSet(
  orderId: string | number,
  shop: string,
  adminToken: string,
  apiVersion = "2025-10"
) {
  const gid = `gid://shopify/Order/${orderId}`;
  const query = `
    query ($id: ID!) {
      order(id: $id) {
        currentShippingPriceSet {
          shopMoney { amount currencyCode }
          presentmentMoney { amount currencyCode }
        }
      }
    }
  `;

  const res = await fetch(`https://${shop}/admin/api/${apiVersion}/graphql.json`, {
    method: "POST",
    headers: {
      "X-Shopify-Access-Token": adminToken,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ query, variables: { id: gid } }),
  });

  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`GraphQL currentShippingPriceSet failed: ${res.status} ${text}`);
  }

  const data = await res.json();
  const bag = data?.data?.order?.currentShippingPriceSet;
  if (!bag) return null;

  // Helper to format amount to two decimal places
  const formatAmount = (amountStr: string) => {
    const num = parseFloat(amountStr);
    return isNaN(num) ? amountStr : num.toFixed(2);
  };

  // Convert to webhook/REST-style snake_case keys
  return {
    shop_money: {
      amount: formatAmount(bag.shopMoney.amount),
      currency_code: bag.shopMoney.currencyCode,
    },
    presentment_money: {
      amount: formatAmount(bag.presentmentMoney.amount),
      currency_code: bag.presentmentMoney.currencyCode,
    },
  };
}
