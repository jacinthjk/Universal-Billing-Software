const { prisma } = require('../lib/prisma');
const { badRequest } = require('../lib/errors');
const { n, round3 } = require('../lib/util');

// Ledger movement types
const T = {
  OPENING: 'OPENING', PURCHASE_IN: 'PURCHASE_IN', SALE_OUT: 'SALE_OUT', RETURN_IN: 'RETURN_IN',
  PURCHASE_RETURN_OUT: 'PURCHASE_RETURN_OUT', ADJUSTMENT: 'ADJUSTMENT', CANCEL_IN: 'CANCEL_IN',
  EDIT_IN: 'EDIT_IN', EDIT_OUT: 'EDIT_OUT',
};

/**
 * Records one stock movement: updates the cached product quantity and writes an auditable ledger row.
 * qty is signed (+ in / - out). Must be called inside a transaction.
 */
async function moveStock(tx, { businessId, productId, qty, type, refType, refId, note, userId, unitCost, batchNo, expiryDate, allowNegative = false }) {
  const product = await tx.product.findFirst({ where: { id: productId, businessId } });
  if (!product) throw badRequest('Product not found');
  if (!product.trackStock || product.kind === 'SERVICE') return null;
  const delta = round3(qty);
  if (delta === 0) return null;

  // Conditional decrement guards against concurrent sales overselling.
  const where = { id: productId, businessId };
  if (delta < 0 && !allowNegative) where.stockQty = { gte: -delta };
  const res = await tx.product.updateMany({ where, data: { stockQty: { increment: delta } } });
  if (res.count === 0) {
    throw badRequest(`Insufficient stock for ${product.name} (available ${n(product.stockQty)} ${product.unit})`);
  }
  const updated = await tx.product.findUnique({ where: { id: productId }, select: { stockQty: true } });

  if (product.batchTracking && batchNo) {
    await tx.productBatch.upsert({
      where: { productId_batchNo: { productId, batchNo } },
      create: { businessId, productId, batchNo, expiryDate: expiryDate || null, qty: delta },
      update: { qty: { increment: delta }, ...(expiryDate ? { expiryDate } : {}) },
    });
  }

  return tx.stockLedger.create({
    data: {
      businessId, productId, type, qty: delta, balanceAfter: updated.stockQty, unitCost: unitCost ?? null,
      refType: refType || null, refId: refId || null, batchNo: batchNo || null, note: note || null, userId: userId || null,
    },
  });
}

// Quantity reserved by active online orders, keyed by productId.
async function reservedMap(businessId, productIds, db = prisma) {
  const rows = await db.stockReservation.groupBy({
    by: ['productId'],
    where: { businessId, status: 'ACTIVE', ...(productIds ? { productId: { in: productIds } } : {}) },
    _sum: { qty: true },
  });
  return Object.fromEntries(rows.map((r) => [r.productId, n(r._sum.qty)]));
}

// Sellable quantity = on hand - reserved. Services and untracked items are always available.
async function availability(businessId, products, db = prisma) {
  const reserved = await reservedMap(businessId, products.map((p) => p.id), db);
  return Object.fromEntries(
    products.map((p) => {
      if (!p.trackStock || p.kind === 'SERVICE') return [p.id, { available: null, inStock: true, reserved: 0 }];
      const available = round3(n(p.stockQty) - (reserved[p.id] || 0));
      return [p.id, { available, inStock: available > 0, reserved: reserved[p.id] || 0, onHand: n(p.stockQty) }];
    }),
  );
}

function stockStatus(p) {
  if (!p.trackStock || p.kind === 'SERVICE') return 'NA';
  const q = n(p.stockQty);
  if (q <= 0) return 'OUT';
  if (p.reorderLevel !== null && p.reorderLevel !== undefined && q <= n(p.reorderLevel)) return 'LOW';
  return 'OK';
}

module.exports = { T, moveStock, reservedMap, availability, stockStatus };
