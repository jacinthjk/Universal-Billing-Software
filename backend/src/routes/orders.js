const router = require('express').Router();
const { z } = require('zod');
const { prisma } = require('../lib/prisma');
const { ah, notFound, badRequest } = require('../lib/errors');
const { validate } = require('../middleware/validate');
const { requirePerm } = require('../middleware/tenant');
const { pageParams } = require('../lib/util');
const { audit } = require('../lib/audit');
const { placeOrder, updateOrderStatus, completeOrder, TRANSITIONS } = require('../services/orders');
const config = require('../config');

router.get('/', requirePerm('orders.view'), ah(async (req, res) => {
  const { take, skip, page } = pageParams(req.query);
  const where = { businessId: req.businessId };
  if (req.query.status) where.status = { in: req.query.status.split(',') };
  if (req.query.kind) where.kind = req.query.kind;
  if (req.query.channel) where.channel = req.query.channel;
  if (req.query.q) where.OR = [{ number: { contains: req.query.q, mode: 'insensitive' } }, { contactName: { contains: req.query.q, mode: 'insensitive' } }, { contactPhone: { contains: req.query.q } }];
  const [orders, total, counts] = await Promise.all([
    prisma.order.findMany({ where, include: { _count: { select: { items: true } }, sale: { select: { id: true, number: true } } }, orderBy: { createdAt: 'desc' }, take, skip }),
    prisma.order.count({ where }),
    prisma.order.groupBy({ by: ['status'], where: { businessId: req.businessId }, _count: true }),
  ]);
  res.json({ orders, total, page, counts: Object.fromEntries(counts.map((c) => [c.status, c._count])) });
}));

router.get('/:id', requirePerm('orders.view'), ah(async (req, res) => {
  const order = await prisma.order.findFirst({
    where: { id: req.params.id, businessId: req.businessId },
    include: { items: true, customer: true, sale: { select: { id: true, number: true, paymentStatus: true } }, enquiry: { select: { id: true, summary: true } }, reservations: true },
  });
  if (!order) throw notFound();
  res.json({ order, nextStatuses: TRANSITIONS[order.status], trackingUrl: `${config.publicAppUrl}/s/${req.business.slug}/track/${order.trackingToken}` });
}));

// Staff-created order / quotation (e.g. phone orders, bulk quotes).
router.post('/', requirePerm('orders.manage'), validate(z.object({
  kind: z.enum(['ORDER', 'QUOTATION']).default('ORDER'),
  customerId: z.string().optional(),
  contact: z.object({ name: z.string().max(100).optional(), phone: z.string().max(20).optional(), email: z.string().max(120).optional() }).default({}),
  items: z.array(z.object({ productId: z.string(), qty: z.coerce.number().positive() })).min(1),
  fulfilment: z.enum(['PICKUP', 'DELIVERY']).default('PICKUP'),
  address: z.string().max(300).optional(),
  notes: z.string().max(500).optional(),
})), ah(async (req, res) => {
  if (req.body.customerId && !(await prisma.customer.findFirst({ where: { id: req.body.customerId, businessId: req.businessId } }))) throw badRequest('Invalid customer');
  const order = await placeOrder(req.business, { ...req.body, channel: 'STAFF', paymentMethod: 'PAY_AT_PICKUP' }, { actor: 'USER', userId: req.user.id });
  res.status(201).json({ order });
}));

router.post('/:id/status', requirePerm('orders.manage'), validate(z.object({
  status: z.enum(['PENDING', 'CONFIRMED', 'PROCESSING', 'READY', 'COMPLETED', 'CANCELLED']),
  payments: z.array(z.object({ method: z.string(), amount: z.coerce.number().min(0), reference: z.string().optional() })).optional(),
})), ah(async (req, res) => {
  const order = await updateOrderStatus(req.business, req.user, req.params.id, req.body.status, { payments: req.body.payments });
  res.json({ order });
}));

// Convert a quotation into a firm order (reserves stock).
router.post('/:id/accept-quotation', requirePerm('orders.manage'), ah(async (req, res) => {
  const q = await prisma.order.findFirst({ where: { id: req.params.id, businessId: req.businessId, kind: 'QUOTATION' }, include: { items: true } });
  if (!q) throw notFound('Quotation not found');
  if (q.status === 'CANCELLED' || q.status === 'COMPLETED') throw badRequest('Quotation is closed');
  const order = await placeOrder(req.business, {
    items: q.items.map((i) => ({ productId: i.productId, qty: Number(i.qty) })), customerId: q.customerId,
    contact: { name: q.contactName, phone: q.contactPhone, email: q.contactEmail }, fulfilment: q.fulfilment, address: q.address,
    notes: `From quotation ${q.number}`, kind: 'ORDER', channel: q.channel, enquiryId: q.enquiryId,
  }, { actor: 'USER', userId: req.user.id });
  await prisma.order.update({ where: { id: q.id }, data: { status: 'COMPLETED' } });
  res.status(201).json({ order });
}));

router.post('/:id/invoice', requirePerm('orders.manage'), validate(z.object({
  payments: z.array(z.object({ method: z.string(), amount: z.coerce.number().min(0), reference: z.string().optional() })).optional(),
})), ah(async (req, res) => {
  const sale = await completeOrder(req.business, req.user, req.params.id, req.body);
  res.status(201).json({ sale });
}));

router.post('/:id/mark-paid', requirePerm('orders.manage'), validate(z.object({ reference: z.string().max(80).optional() })), ah(async (req, res) => {
  const o = await prisma.order.findFirst({ where: { id: req.params.id, businessId: req.businessId } });
  if (!o) throw notFound();
  const order = await prisma.order.update({ where: { id: o.id }, data: { paymentStatus: 'PAID', paymentRef: req.body.reference || o.paymentRef } });
  await audit({ businessId: req.businessId, userId: req.user.id, action: 'order.mark_paid', entity: 'Order', entityId: o.id, data: req.body });
  res.json({ order });
}));

module.exports = router;
