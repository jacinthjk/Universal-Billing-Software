const { prisma } = require('../lib/prisma');
const { badRequest, notFound } = require('../lib/errors');
const { n, round2, round3 } = require('../lib/util');
const { audit } = require('../lib/audit');
const { nextNumber } = require('./sequence');
const { moveStock, T } = require('./stock');

function priceItems(items) {
  const lines = items.map((it) => {
    const qty = round3(it.qty);
    const unitCost = round2(it.unitCost);
    const discount = round2(it.discount || 0);
    const base = round2(qty * unitCost - discount);
    const tax = round2(base * (n(it.taxRate) / 100));
    return { ...it, qty, unitCost, discount, taxRate: n(it.taxRate), tax, lineTotal: round2(base + tax), base };
  });
  return {
    lines,
    subtotal: round2(lines.reduce((s, l) => s + l.qty * l.unitCost, 0)),
    discount: round2(lines.reduce((s, l) => s + l.discount, 0)),
    tax: round2(lines.reduce((s, l) => s + l.tax, 0)),
    total: round2(lines.reduce((s, l) => s + l.lineTotal, 0)),
  };
}

async function stockIn(tx, businessId, purchase, lines, userId) {
  for (const l of lines) {
    await moveStock(tx, {
      businessId, productId: l.productId, qty: l.qty, type: T.PURCHASE_IN, refType: 'PURCHASE', refId: purchase.id,
      unitCost: l.unitCost, batchNo: l.batchNo, expiryDate: l.expiryDate ? new Date(l.expiryDate) : null, userId, allowNegative: true,
    });
    // Keep the master's cost price at the latest received cost.
    await tx.product.updateMany({ where: { id: l.productId, businessId }, data: { costPrice: l.unitCost } });
  }
}

/** status RECEIVED updates stock immediately (direct purchase / GRN); ORDERED creates a purchase order. */
async function createPurchase(business, user, input) {
  const { supplierId, supplierRef, status = 'RECEIVED', date, items, notes, paidAmount = 0, paymentMethod = 'CASH' } = input;
  if (!items?.length) throw badRequest('Add at least one item');
  return prisma.$transaction(async (tx) => {
    if (supplierId) {
      const s = await tx.supplier.findFirst({ where: { id: supplierId, businessId: business.id } });
      if (!s) throw badRequest('Supplier not found');
    }
    const products = await tx.product.findMany({ where: { businessId: business.id, id: { in: items.map((i) => i.productId) } } });
    if (products.length !== new Set(items.map((i) => i.productId)).size) throw badRequest('Unknown product in purchase');
    const byId = Object.fromEntries(products.map((p) => [p.id, p]));
    const priced = priceItems(items);
    const number = await nextNumber(tx, business.id, 'PURCHASE');
    const paid = Math.min(round2(paidAmount), priced.total);
    const purchase = await tx.purchase.create({
      data: {
        businessId: business.id, number, supplierId: supplierId || null, supplierRef: supplierRef || null, status,
        date: date ? new Date(date) : new Date(), subtotal: priced.subtotal, discount: priced.discount, tax: priced.tax,
        total: priced.total, paidAmount: paid, notes: notes || null, createdById: user.id,
        items: {
          create: priced.lines.map((l) => ({
            productId: l.productId, name: byId[l.productId].name, qty: l.qty, unitCost: l.unitCost, taxRate: l.taxRate,
            discount: l.discount, lineTotal: l.lineTotal, batchNo: l.batchNo || null, expiryDate: l.expiryDate ? new Date(l.expiryDate) : null,
          })),
        },
      },
    });
    if (status === 'RECEIVED') await stockIn(tx, business.id, purchase, priced.lines, user.id);
    if (paid > 0 && supplierId) {
      await tx.supplierPayment.create({ data: { businessId: business.id, supplierId, purchaseId: purchase.id, amount: paid, method: paymentMethod } });
    }
    await audit({ businessId: business.id, userId: user.id, action: 'purchase.create', entity: 'Purchase', entityId: purchase.id, data: { number, total: priced.total, status } }, tx);
    return purchase;
  });
}

async function receivePurchase(business, user, purchaseId) {
  return prisma.$transaction(async (tx) => {
    const p = await tx.purchase.findFirst({ where: { id: purchaseId, businessId: business.id }, include: { items: true } });
    if (!p) throw notFound('Purchase not found');
    if (p.status !== 'ORDERED') throw badRequest('Only ordered purchases can be received');
    await stockIn(tx, business.id, p, p.items.map((i) => ({ ...i, qty: n(i.qty), unitCost: n(i.unitCost) })), user.id);
    const updated = await tx.purchase.update({ where: { id: p.id }, data: { status: 'RECEIVED', date: new Date() } });
    await audit({ businessId: business.id, userId: user.id, action: 'purchase.receive', entity: 'Purchase', entityId: p.id }, tx);
    return updated;
  });
}

async function returnPurchase(business, user, purchaseId, { items, reason }) {
  return prisma.$transaction(async (tx) => {
    const p = await tx.purchase.findFirst({ where: { id: purchaseId, businessId: business.id }, include: { items: true } });
    if (!p) throw notFound('Purchase not found');
    if (p.status !== 'RECEIVED') throw badRequest('Only received purchases can be returned');
    const byId = Object.fromEntries(p.items.map((i) => [i.id, i]));
    for (const r of items) {
      const it = byId[r.itemId];
      if (!it) throw badRequest('Invalid purchase item');
      const qty = round3(r.qty);
      const max = round3(n(it.qty) - n(it.returnedQty));
      if (!(qty > 0) || qty > max) throw badRequest(`Invalid return quantity for ${it.name} (max ${max})`);
      await tx.purchaseItem.update({ where: { id: it.id }, data: { returnedQty: { increment: qty } } });
      await moveStock(tx, { businessId: business.id, productId: it.productId, qty: -qty, type: T.PURCHASE_RETURN_OUT, refType: 'PURCHASE', refId: p.id, unitCost: n(it.unitCost), batchNo: it.batchNo, note: reason, userId: user.id });
    }
    const after = await tx.purchaseItem.findMany({ where: { purchaseId } });
    if (after.every((i) => n(i.returnedQty) >= n(i.qty))) await tx.purchase.update({ where: { id: p.id }, data: { status: 'RETURNED' } });
    await audit({ businessId: business.id, userId: user.id, action: 'purchase.return', entity: 'Purchase', entityId: p.id, data: { items, reason } }, tx);
    return tx.purchase.findUnique({ where: { id: p.id }, include: { items: true } });
  });
}

module.exports = { createPurchase, receivePurchase, returnPurchase };
