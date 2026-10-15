const router = require('express').Router();
const { z } = require('zod');
const { prisma } = require('../lib/prisma');
const { ah, notFound } = require('../lib/errors');
const { validate } = require('../middleware/validate');
const { requirePerm } = require('../middleware/tenant');
const { pageParams } = require('../lib/util');
const { createPurchase, receivePurchase, returnPurchase } = require('../services/purchases');

router.get('/', requirePerm('purchases.view'), ah(async (req, res) => {
  const { take, skip, page } = pageParams(req.query);
  const where = { businessId: req.businessId };
  if (req.query.supplierId) where.supplierId = req.query.supplierId;
  if (req.query.status) where.status = req.query.status;
  if (req.query.from || req.query.to) where.date = { ...(req.query.from ? { gte: new Date(req.query.from) } : {}), ...(req.query.to ? { lte: new Date(`${req.query.to}T23:59:59`) } : {}) };
  const [purchases, total] = await Promise.all([
    prisma.purchase.findMany({ where, include: { supplier: { select: { id: true, name: true } }, _count: { select: { items: true } } }, orderBy: { date: 'desc' }, take, skip }),
    prisma.purchase.count({ where }),
  ]);
  res.json({ purchases, total, page });
}));

router.get('/:id', requirePerm('purchases.view'), ah(async (req, res) => {
  const purchase = await prisma.purchase.findFirst({ where: { id: req.params.id, businessId: req.businessId }, include: { items: true, supplier: true, payments: true } });
  if (!purchase) throw notFound();
  res.json({ purchase });
}));

router.post('/', requirePerm('purchases.manage'), validate(z.object({
  supplierId: z.string().nullable().optional(),
  supplierRef: z.string().max(60).optional(),
  status: z.enum(['ORDERED', 'RECEIVED']).default('RECEIVED'),
  date: z.string().optional(),
  notes: z.string().max(1000).optional(),
  paidAmount: z.coerce.number().min(0).default(0),
  paymentMethod: z.string().default('CASH'),
  items: z.array(z.object({
    productId: z.string(), qty: z.coerce.number().positive(), unitCost: z.coerce.number().min(0),
    taxRate: z.coerce.number().min(0).max(100).default(0), discount: z.coerce.number().min(0).default(0),
    batchNo: z.string().max(40).optional(), expiryDate: z.string().optional(),
  })).min(1),
})), ah(async (req, res) => {
  const purchase = await createPurchase(req.business, req.user, req.body);
  res.status(201).json({ purchase });
}));

router.post('/:id/receive', requirePerm('purchases.manage'), ah(async (req, res) => {
  res.json({ purchase: await receivePurchase(req.business, req.user, req.params.id) });
}));

router.post('/:id/return', requirePerm('purchases.manage'), validate(z.object({
  reason: z.string().max(300).optional(),
  items: z.array(z.object({ itemId: z.string(), qty: z.coerce.number().positive() })).min(1),
})), ah(async (req, res) => {
  res.json({ purchase: await returnPurchase(req.business, req.user, req.params.id, req.body) });
}));

module.exports = router;
