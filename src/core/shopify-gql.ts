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

export async function fetchOrderEditData(orderId: string, shop: string, token: string, apiVersion: string) {
  const GID = `gid://shopify/Order/${orderId}`;
  const query = `
    query OrderEditData($id: ID!) {
      order(id: $id) {
        agreements(first: 200) {
          edges {
            node {
              id
              reason
              happenedAt
              app { id }
              sales(first: 10) {
                edges {
                  node {
                    __typename
                    ... on ProductSale {
                      lineItem {
                        id
                        discountAllocations {
                          allocatedAmountSet {
                            shopMoney { amount currencyCode }
                            presentmentMoney { amount currencyCode }
                          }
                          discountApplication {
                            value {
                              __typename
                              ... on MoneyV2 { amount currencyCode }
                              ... on PricingPercentageValue { percentage }
                            }
                          }
                        }
                      }
                      quantity
                      totalAmount { shopMoney { amount } }
                      totalDiscountAmountBeforeTaxes { shopMoney { amount } }
                    }
                    ... on ShippingLineSale {
                      shippingLine { id, title }
                      totalAmount { shopMoney { amount } }
                    }
                    ... on AdjustmentSale {
                      totalAmount { shopMoney { amount } }
                    }
                    ... on FeeSale {
                      quantity
                      totalAmount { shopMoney { amount } }
                    }
                  }
                }
              }
            }
          }
        }
        events(first: 10, sortKey: CREATED_AT, reverse: true) {
          edges {
            node {
              ... on BasicEvent {
                message
                createdAt
              }
            }
          }
        }
      }
    }
  `;

  const res = await fetch(`https://${shop}/admin/api/${apiVersion}/graphql.json`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Shopify-Access-Token': token,
    },
    body: JSON.stringify({
      query,
      variables: { id: GID },
    }),
  });

  if (!res.ok) {
    throw new Error(`GraphQL fetch failed: ${res.status} ${await res.text()}`);
  }

  const json = await res.json();
  if (json.errors) {
    throw new Error(`GraphQL query errors: ${JSON.stringify(json.errors)}`);
  }
  return json.data.order;
}