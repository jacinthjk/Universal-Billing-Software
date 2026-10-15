const { n, round2 } = require('../lib/util');
const { badRequest, forbidden } = require('../lib/errors');

/**
 * Authoritative line pricing. Prices always come from the product master unless the caller
 * explicitly allows overrides (permission-checked). Client-sent totals are ignored.
 */
function priceLines(products, items, { taxInclusive = false, allowPriceOverride = false, allowDiscount = false } = {}) {
  const byId = Object.fromEntries(products.map((p) => [p.id, p]));
  const lines = items.map((it) => {
    const p = byId[it.productId];
    if (!p || !p.active) throw badRequest('One of the items is no longer available');
    const qty = n(it.qty);
    if (!(qty > 0)) throw badRequest(`Invalid quantity for ${p.name}`);
    let unitPrice = n(p.sellingPrice);
    if (it.unitPrice !== undefined && it.unitPrice !== null && round2(it.unitPrice) !== round2(unitPrice)) {
      if (!allowPriceOverride) throw forbidden('You are not allowed to change prices');
      unitPrice = round2(it.unitPrice);
    }
    const discount = round2(it.discount || 0);
    if (discount > 0 && !allowDiscount) throw forbidden('You are not allowed to give discounts');
    const gross = round2(unitPrice * qty);
    if (discount > gross) throw badRequest(`Discount exceeds line amount for ${p.name}`);
    const base = gross - discount;
    const rate = n(p.taxRate) / 100;
    const taxAmount = taxInclusive ? round2(base - base / (1 + rate)) : round2(base * rate);
    const lineTotal = taxInclusive ? round2(base) : round2(base + taxAmount);
    return {
      productId: p.id, name: p.variant ? `${p.name} (${p.variant})` : p.name, hsn: p.hsn || null, unit: p.unit, qty, unitPrice,
      costPrice: n(p.costPrice), discount, taxRate: n(p.taxRate), taxAmount, lineTotal,
    };
  });
  const subtotal = round2(lines.reduce((s, l) => s + l.unitPrice * l.qty, 0));
  const lineDiscounts = round2(lines.reduce((s, l) => s + l.discount, 0));
  const tax = round2(lines.reduce((s, l) => s + l.taxAmount, 0));
  const total = round2(lines.reduce((s, l) => s + l.lineTotal, 0));
  return { lines, subtotal, lineDiscounts, tax, total };
}

module.exports = { priceLines };
