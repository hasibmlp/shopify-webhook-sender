// This transformer converts the GraphQL `agreements` data model into the
// `order_edit.changes` array model found in the `orders/edited` webhook.

export function transformAgreementsToChanges(agreementsData: any, liveData: any): any {
  const agreements = agreementsData?.agreements;
  const events = agreementsData?.events;
  const liveLineItems = liveData.line_items;

  // Ensure agreements are sorted by happenedAt to get the latest one
  const sortedAgreements = agreementsData.agreements?.edges.slice().sort((a: any, b: any) => {
    return new Date(b.node.happenedAt).getTime() - new Date(a.node.happenedAt).getTime();
  });

  const latestEditAgreement = sortedAgreements?.find((edge: any) => edge.node.reason === "ORDER_EDIT");

  const eventEdges = agreementsData.events?.edges;
  const editEventIndex = eventEdges?.findIndex((edge: any) => edge.node.message?.includes("edited this order"));

  let customerWasNotified = false;
  if (editEventIndex !== undefined && editEventIndex > 0) {
    const precedingEvent = eventEdges[editEventIndex - 1];
    const message = precedingEvent.node.message;
    if (message?.includes("sent invoice") || message?.includes("sent an order edited email")) {
      customerWasNotified = true;
    }
  }

  const editEvent = agreementsData.events?.edges.find((edge: any) => edge.node.message?.includes("edited this order"))?.node;

  if (!latestEditAgreement) {
    return null; // No edit agreement found
  }

  const latestEdit = latestEditAgreement.node;
  const changes: any[] = [];

  for (const edge of latestEdit.sales.edges) {
    const entry = edge.node;

    const lineItemId = entry.lineItem?.id.split('/').pop();
    const liveLineItem = liveLineItems.find((li:any) => String(li.id) === lineItemId);

    switch (entry.__typename) {
      case "ProductSale":
        if (entry.quantity > 0) {
          changes.push({ type: "line_item_added", line_item_id: lineItemId, quantity: entry.quantity, sale: entry });
        } else if (entry.quantity < 0) {
          changes.push({ type: "line_item_removed", line_item_id: lineItemId, quantity: entry.quantity, sale: entry });
        }
        break;
      case "ShippingLineSale":
        if (parseFloat(entry.totalAmount.shopMoney.amount) >= 0) {
          changes.push({
            type: "shipping_line_added",
            id: entry.shippingLine.id.split('/').pop(),
          });
        } else {
          changes.push({
            type: "shipping_line_removed",
            id: entry.shippingLine.id.split('/').pop(),
          });
        }
        break;
    }
  }

  const consolidatedChanges: any[] = [];
  const lineItemIds = new Set(changes.filter(c => c.type.startsWith('line_item')).map(c => c.line_item_id));

  for (const id of lineItemIds) {
    const additions = changes.filter(c => c.type === 'line_item_added' && c.line_item_id === id);
    const removals = changes.filter(c => c.type === 'line_item_removed' && c.line_item_id === id);

    if (additions.length > 0 && removals.length > 0) {
      const oldSale = removals[0].sale;
      const newSale = additions[0].sale;

      const oldDiscountValue = parseFloat(oldSale.totalDiscountAmountBeforeTaxes.shopMoney.amount);
      const newDiscountValue = parseFloat(newSale.totalDiscountAmountBeforeTaxes.shopMoney.amount);

      if (oldDiscountValue !== 0 && newDiscountValue === 0) {
        // This is a removal
        let activeAllocation = oldSale.lineItem.discountAllocations?.find(
          (alloc: any) => parseFloat(alloc.allocatedAmountSet.shopMoney.amount) === Math.abs(oldDiscountValue)
        );

        if (!activeAllocation) {
          // Fallback for percentage-based removals where allocatedAmountSet is 0
          const oldTotal = Math.abs(parseFloat(oldSale.totalAmount.shopMoney.amount));
          const originalPrice = oldTotal + Math.abs(oldDiscountValue);
          const percentage = ((Math.abs(oldDiscountValue) / originalPrice) * 100);

          activeAllocation = oldSale.lineItem.discountAllocations?.find(
            (alloc: any) => alloc.discountApplication.value.percentage && Math.abs(alloc.discountApplication.value.percentage - percentage) < 0.1
          );
        }

        if (!activeAllocation) {
          // Fallback for fixed-amount removals
          activeAllocation = oldSale.lineItem.discountAllocations?.find(
            (alloc: any) => alloc.discountApplication.value.amount && parseFloat(alloc.discountApplication.value.amount) === Math.abs(oldDiscountValue)
          );
        }


        if (activeAllocation) {
          const value = activeAllocation.discountApplication.value;
          consolidatedChanges.push({
            type: 'discount_removed',
            line_item_id: id,
            percent_amount: value.percentage ? (value.percentage).toFixed(1) : null,
            fixed_amount_set: value.__typename === 'MoneyV2' ? {
              shop_money: { amount: value.amount, currency_code: 'USD' },
              presentment_money: { amount: value.amount, currency_code: 'USD' },
            } : null,
          });
        }
      } else if (oldDiscountValue === 0 && newDiscountValue !== 0) {
        // This is an addition
        let activeAllocation = newSale.lineItem.discountAllocations?.find(
          (alloc: any) => parseFloat(alloc.allocatedAmountSet.shopMoney.amount) === Math.abs(newDiscountValue)
        );

        if (!activeAllocation) {
          // Fallback for percentage-based additions where allocatedAmountSet is 0
          const newTotal = Math.abs(parseFloat(newSale.totalAmount.shopMoney.amount));
          const originalPrice = newTotal + Math.abs(newDiscountValue);
          const percentage = ((Math.abs(newDiscountValue) / originalPrice) * 100);

          activeAllocation = newSale.lineItem.discountAllocations?.find(
            (alloc: any) => alloc.discountApplication.value.percentage && Math.abs(alloc.discountApplication.value.percentage - percentage) < 0.1
          );
        }

        if (!activeAllocation) {
          // Fallback for fixed-amount additions
          activeAllocation = newSale.lineItem.discountAllocations?.find(
            (alloc: any) => alloc.discountApplication.value.amount && parseFloat(alloc.discountApplication.value.amount) === Math.abs(newDiscountValue)
          );
        }

        if (activeAllocation) {
          const value = activeAllocation.discountApplication.value;
          consolidatedChanges.push({
            type: 'discount_added',
            line_item_id: id,
            percent_amount: value.percentage ? (value.percentage).toFixed(1) : null,
            fixed_amount_set: value.__typename === 'MoneyV2' ? {
              shop_money: { amount: value.amount, currency_code: 'USD' },
              presentment_money: { amount: value.amount, currency_code: 'USD' },
            } : null,
          });
        }
      } else if (oldDiscountValue !== 0 && newDiscountValue !== 0 && oldDiscountValue !== newDiscountValue) {
        // This is an update, treat as remove + add

        // Removal part
        const oldActiveAllocation = oldSale.lineItem.discountAllocations?.find(
          (alloc: any) => parseFloat(alloc.allocatedAmountSet.shopMoney.amount) === Math.abs(oldDiscountValue)
        ) || oldSale.lineItem.discountAllocations?.find(
          (alloc: any) => alloc.discountApplication.value.amount && parseFloat(alloc.discountApplication.value.amount) === Math.abs(oldDiscountValue)
        ) || oldSale.lineItem.discountAllocations?.find(
          (alloc: any) => {
            if (!alloc.discountApplication.value.percentage) return false;
            const oldTotal = Math.abs(parseFloat(oldSale.totalAmount.shopMoney.amount));
            const originalPrice = oldTotal + Math.abs(oldDiscountValue);
            const percentage = ((Math.abs(oldDiscountValue) / originalPrice) * 100);
            return Math.abs(alloc.discountApplication.value.percentage - percentage) < 0.1;
          }
        );

        if (oldActiveAllocation) {
          const value = oldActiveAllocation.discountApplication.value;
          consolidatedChanges.push({
            type: 'discount_removed',
            line_item_id: id,
            percent_amount: value.percentage ? (value.percentage).toFixed(1) : null,
            fixed_amount_set: value.__typename === 'MoneyV2' ? { shop_money: { amount: value.amount, currency_code: 'USD' }, presentment_money: { amount: value.amount, currency_code: 'USD' } } : null,
          });
        }

        // Addition part
        const newActiveAllocation = newSale.lineItem.discountAllocations?.find(
          (alloc: any) => parseFloat(alloc.allocatedAmountSet.shopMoney.amount) === Math.abs(newDiscountValue)
        ) || newSale.lineItem.discountAllocations?.find(
          (alloc: any) => alloc.discountApplication.value.amount && parseFloat(alloc.discountApplication.value.amount) === Math.abs(newDiscountValue)
        ) || newSale.lineItem.discountAllocations?.find(
          (alloc: any) => {
            if (!alloc.discountApplication.value.percentage) return false;
            const newTotal = Math.abs(parseFloat(newSale.totalAmount.shopMoney.amount));
            const originalPrice = newTotal + Math.abs(newDiscountValue);
            const percentage = ((Math.abs(newDiscountValue) / originalPrice) * 100);
            return Math.abs(alloc.discountApplication.value.percentage - percentage) < 0.1;
          }
        );

        if (newActiveAllocation) {
          const value = newActiveAllocation.discountApplication.value;
          consolidatedChanges.push({
            type: 'discount_added',
            line_item_id: id,
            percent_amount: value.percentage ? (value.percentage).toFixed(1) : null,
            fixed_amount_set: value.__typename === 'MoneyV2' ? { shop_money: { amount: value.amount, currency_code: 'USD' }, presentment_money: { amount: value.amount, currency_code: 'USD' } } : null,
          });
        }
      }
    } else {
      consolidatedChanges.push(...additions, ...removals);
    }
  }

  const finalChanges = consolidatedChanges.concat(changes.filter(c => !c.type.startsWith('line_item')));

  const lineItemAdditions = finalChanges.filter(c => c.type === 'line_item_added').map(c => ({ id: parseInt(c.line_item_id, 10), delta: c.quantity }));
  const lineItemRemovals = finalChanges.filter(c => c.type === 'line_item_removed').map(c => ({ id: parseInt(c.line_item_id, 10), delta: Math.abs(c.quantity) }));
  const shippingAdditions = finalChanges.filter(c => c.type === 'shipping_line_added').map(c => ({ id: parseInt(c.id, 10) }));
  const shippingRemovals = finalChanges.filter(c => c.type === 'shipping_line_removed').map(c => ({ id: parseInt(c.id, 10) }));

  const discountAdditions = finalChanges.filter(c => c.type === 'discount_added').map(c => ({
    line_item_id: parseInt(c.line_item_id, 10),
    percent_amount: c.percent_amount,
    fixed_amount_set: c.fixed_amount_set,
    description: "", // Fallback to empty string to maintain type
  }));
  const discountRemovals = finalChanges.filter(c => c.type === 'discount_removed').map(c => ({
    line_item_id: parseInt(c.line_item_id, 10),
    percent_amount: c.percent_amount,
    fixed_amount_set: c.fixed_amount_set,
    description: "", // Fallback to empty string to maintain type
  }));

  return {
    id: parseInt(latestEdit.id.split('/').pop(), 10),
    created_at: editEvent?.createdAt || latestEdit.happenedAt, // Fallback to happenedAt
    committed_at: latestEdit.happenedAt,
    staff_note: null,
    line_items: {
      additions: lineItemAdditions,
      removals: lineItemRemovals,
    },
    app_id: latestEdit.app ? parseInt(latestEdit.app.id.split('/').pop(), 10) : null,
    notify_customer: customerWasNotified,
    order_id: null,
    user_id: null,
    discounts: { line_item: { additions: discountAdditions, removals: discountRemovals } },
    shipping_lines: { additions: shippingAdditions, removals: shippingRemovals },
  };
}
