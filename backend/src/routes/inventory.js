const router = require('express').Router();
const { z } = require('zod');
const { prisma } = require('../lib/prisma');
const { ah, notFound } = require('../lib/errors');
const { validate } = require('../middleware/validate');
const { requirePerm } = require('../middleware/tenant');
const { pageParams, round3, n } = require('../lib/util');
const { audit } = require('../lib/audit');
const { moveStock, T } = require('../services/stock');
const { stockSnapshot } = require('../services/reports');

router.get('/summary', requirePerm('inventory.view'), ah(async (req, res) => {
  const snap = await stockSnapshot(req.businessId);
  const soon = new Date(Date.now() + 30 * 86400000);
  const expiring = await prisma.productBatch.findMany({
    where: { businessId: req.businessId, qty: { gt: 0 }, expiryDate: { lte: soon } },
    include: { product: { select: { name: true, unit: true } } }, orderBy: { expiryDate: 'asc' }, take: 50,
  });
  if (!req.can('products.view_cost')) delete snap.value;
  res.json({ ...snap, expiring });
}));

router.get('/ledger', requirePerm('inventory.view'), ah(async (req, res) => {
  const { take, skip, page } = pageParams(req.query);
  const where = { businessId: req.businessId };
  if (req.query.productId) where.productId = req.query.productId;
  if (req.query.type) where.type = req.query.type;
  const [rows, total] = await Promise.all([
    prisma.stockLedger.findMany({ where, orderBy: { createdAt: 'desc' }, take, skip }),
    prisma.stockLedger.count({ where }),
  ]);
  const products = await prisma.product.findMany({ where: { id: { in: [...new Set(rows.map((r) => r.productId))] } }, select: { id: true, name: true, unit: true, sku: true } });
  const users = await prisma.user.findMany({ where: { id: { in: [...new Set(rows.map((r) => r.userId).filter(Boolean))] } }, select: { id: true, name: true } });
  const pm = Object.fromEntries(products.map((p) => [p.id, p]));
  const um = Object.fromEntries(users.map((u) => [u.id, u.name]));
  res.json({
    entries: rows.map((r) => ({ ...r, unitCost: req.can('products.view_cost') ? r.unitCost : undefined, product: pm[r.productId], userName: um[r.userId] })),
    total, page,
  });
}));

// Manual stock adjustment (count correction, damage, wastage...). Either a delta or a counted quantity.
router.post('/adjust', requirePerm('inventory.adjust'), validate(z.object({
  productId: z.string(),
  mode: z.enum(['DELTA', 'SET']).default('DELTA'),
  qty: z.coerce.number(),
  reason: z.string().min(2).max(200),
  batchNo: z.string().max(40).optional(),
  expiryDate: z.string().optional(),
})), ah(async (req, res) => {
  const p = await prisma.product.findFirst({ where: { id: req.body.productId, businessId: req.businessId } });
  if (!p) throw notFound('Product not found');
  const delta = req.body.mode === 'SET' ? round3(req.body.qty - n(p.stockQty)) : round3(req.body.qty);
  const entry = await prisma.$transaction(async (tx) => {
    const e = await moveStock(tx, {
      businessId: req.businessId, productId: p.id, qty: delta, type: T.ADJUSTMENT, refType: 'ADJUSTMENT', note: req.body.reason,
      userId: req.user.id, batchNo: req.body.batchNo, expiryDate: req.body.expiryDate ? new Date(req.body.expiryDate) : null, allowNegative: req.body.mode === 'SET',
    });
    await audit({ businessId: req.businessId, userId: req.user.id, action: 'stock.adjust', entity: 'Product', entityId: p.id, data: { delta, reason: req.body.reason } }, tx);
    return e;
  });
  res.json({ entry, product: await prisma.product.findUnique({ where: { id: p.id } }) });
}));

module.exports = router;
