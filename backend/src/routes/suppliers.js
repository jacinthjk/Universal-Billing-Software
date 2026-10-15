const router = require('express').Router();
const { z } = require('zod');
const { prisma } = require('../lib/prisma');
const { ah, notFound, badRequest } = require('../lib/errors');
const { validate } = require('../middleware/validate');
const { requirePerm } = require('../middleware/tenant');
const { n, round2 } = require('../lib/util');
const { audit } = require('../lib/audit');

async function balances(businessId, supplierIds) {
  const [purch, pays] = await Promise.all([
    prisma.purchase.groupBy({ by: ['supplierId'], where: { businessId, supplierId: { in: supplierIds }, status: { in: ['RECEIVED', 'RETURNED'] } }, _sum: { total: true } }),
    prisma.supplierPayment.groupBy({ by: ['supplierId'], where: { businessId, supplierId: { in: supplierIds } }, _sum: { amount: true } }),
  ]);
  const p = Object.fromEntries(purch.map((r) => [r.supplierId, n(r._sum.total)]));
  const q = Object.fromEntries(pays.map((r) => [r.supplierId, n(r._sum.amount)]));
  return Object.fromEntries(supplierIds.map((id) => [id, { purchased: round2(p[id] || 0), paid: round2(q[id] || 0), balance: round2((p[id] || 0) - (q[id] || 0)) }]));
}

router.get('/', requirePerm('purchases.view', 'suppliers.manage'), ah(async (req, res) => {
  const where = { businessId: req.businessId };
  if (req.query.q) where.name = { contains: req.query.q, mode: 'insensitive' };
  const suppliers = await prisma.supplier.findMany({ where, orderBy: { name: 'asc' } });
  const bal = await balances(req.businessId, suppliers.map((s) => s.id));
  res.json({ suppliers: suppliers.map((s) => ({ ...s, ...bal[s.id] })) });
}));

router.get('/:id', requirePerm('purchases.view', 'suppliers.manage'), ah(async (req, res) => {
  const s = await prisma.supplier.findFirst({ where: { id: req.params.id, businessId: req.businessId } });
  if (!s) throw notFound();
  const [purchases, payments, bal] = await Promise.all([
    prisma.purchase.findMany({ where: { businessId: req.businessId, supplierId: s.id }, orderBy: { date: 'desc' }, take: 100 }),
    prisma.supplierPayment.findMany({ where: { businessId: req.businessId, supplierId: s.id }, orderBy: { date: 'desc' }, take: 100 }),
    balances(req.businessId, [s.id]),
  ]);
  res.json({ supplier: { ...s, ...bal[s.id] }, purchases, payments });
}));

const schema = z.object({
  name: z.string().trim().min(1).max(100), phone: z.string().max(20).nullable().optional(), email: z.string().max(120).nullable().optional(),
  address: z.string().max(300).nullable().optional(), taxId: z.string().max(30).nullable().optional(), notes: z.string().max(1000).nullable().optional(), active: z.boolean().optional(),
});

router.post('/', requirePerm('suppliers.manage', 'purchases.manage'), validate(schema), ah(async (req, res) => {
  const supplier = await prisma.supplier.create({ data: { ...req.body, businessId: req.businessId } });
  res.status(201).json({ supplier });
}));

router.put('/:id', requirePerm('suppliers.manage'), validate(schema.partial()), ah(async (req, res) => {
  const s = await prisma.supplier.findFirst({ where: { id: req.params.id, businessId: req.businessId } });
  if (!s) throw notFound();
  res.json({ supplier: await prisma.supplier.update({ where: { id: s.id }, data: req.body }) });
}));

router.post('/:id/payments', requirePerm('suppliers.manage'), validate(z.object({
  amount: z.coerce.number().positive(), method: z.string().default('CASH'), reference: z.string().max(80).optional(), purchaseId: z.string().optional(), date: z.string().optional(),
})), ah(async (req, res) => {
  const s = await prisma.supplier.findFirst({ where: { id: req.params.id, businessId: req.businessId } });
  if (!s) throw notFound();
  const payment = await prisma.$transaction(async (tx) => {
    if (req.body.purchaseId) {
      const p = await tx.purchase.findFirst({ where: { id: req.body.purchaseId, businessId: req.businessId, supplierId: s.id } });
      if (!p) throw badRequest('Invalid purchase');
      await tx.purchase.update({ where: { id: p.id }, data: { paidAmount: { increment: round2(req.body.amount) } } });
    }
    return tx.supplierPayment.create({ data: { businessId: req.businessId, supplierId: s.id, purchaseId: req.body.purchaseId || null, amount: round2(req.body.amount), method: req.body.method, reference: req.body.reference || null, date: req.body.date ? new Date(req.body.date) : new Date() } });
  });
  await audit({ businessId: req.businessId, userId: req.user.id, action: 'supplier.payment', entity: 'Supplier', entityId: s.id, data: { amount: req.body.amount } });
  res.status(201).json({ payment });
}));

module.exports = router;
