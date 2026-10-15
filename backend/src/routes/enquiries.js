const router = require('express').Router();
const { z } = require('zod');
const { prisma } = require('../lib/prisma');
const { ah, notFound, badRequest } = require('../lib/errors');
const { validate } = require('../middleware/validate');
const { requirePerm } = require('../middleware/tenant');
const { pageParams, normalizePhone } = require('../lib/util');
const { audit } = require('../lib/audit');
const { findOrCreateCustomer } = require('../services/customers');
const { placeOrder } = require('../services/orders');

const STATUSES = ['NEW', 'CONTACTED', 'ENGAGED', 'INTERESTED', 'QUALIFIED', 'HIGH_INTENT', 'QUOTATION', 'CONVERTED', 'CLOSED'];
const SOURCES = ['WALK_IN', 'WEBSITE', 'WEBSITE_AI', 'WHATSAPP', 'INSTAGRAM', 'PHONE', 'REFERRAL', 'OTHER'];

router.get('/', requirePerm('enquiries.view'), ah(async (req, res) => {
  const { take, skip, page } = pageParams(req.query);
  const where = { businessId: req.businessId };
  if (req.query.status) where.status = { in: req.query.status.split(',') };
  if (req.query.source) where.source = req.query.source;
  if (req.query.assignedToId) where.assignedToId = req.query.assignedToId === 'me' ? req.user.id : req.query.assignedToId;
  if (req.query.ai === '1') where.createdByAi = true;
  if (req.query.due === '1') where.followUpAt = { lte: new Date() };
  if (req.query.q) where.OR = [{ name: { contains: req.query.q, mode: 'insensitive' } }, { phone: { contains: req.query.q } }, { itemText: { contains: req.query.q, mode: 'insensitive' } }, { summary: { contains: req.query.q, mode: 'insensitive' } }];
  const [enquiries, total, counts] = await Promise.all([
    prisma.enquiry.findMany({ where, include: { customer: { select: { id: true, name: true, phone: true, visitCount: true } } }, orderBy: [{ followUpAt: { sort: 'asc', nulls: 'last' } }, { createdAt: 'desc' }], take, skip }),
    prisma.enquiry.count({ where }),
    prisma.enquiry.groupBy({ by: ['status'], where: { businessId: req.businessId }, _count: true }),
  ]);
  const productIds = [...new Set(enquiries.map((e) => e.productId).filter(Boolean))];
  const products = await prisma.product.findMany({ where: { id: { in: productIds } }, select: { id: true, name: true } });
  const pm = Object.fromEntries(products.map((p) => [p.id, p.name]));
  res.json({ enquiries: enquiries.map((e) => ({ ...e, productName: pm[e.productId] })), total, page, counts: Object.fromEntries(counts.map((c) => [c.status, c._count])) });
}));

// Staff who can be assigned enquiries (names only).
router.get('/meta/staff', requirePerm('enquiries.view'), ah(async (req, res) => {
  const members = await prisma.membership.findMany({ where: { businessId: req.businessId, active: true }, include: { user: { select: { id: true, name: true } }, role: { select: { name: true } } } });
  res.json({ staff: members.map((m) => ({ id: m.user.id, name: m.user.name, role: m.role.name })) });
}));

router.get('/:id', requirePerm('enquiries.view'), ah(async (req, res) => {
  const e = await prisma.enquiry.findFirst({
    where: { id: req.params.id, businessId: req.businessId },
    include: { customer: true, followups: { orderBy: { createdAt: 'desc' } }, orders: { select: { id: true, number: true, kind: true, status: true, total: true } } },
  });
  if (!e) throw notFound();
  const [product, conversation, staff] = await Promise.all([
    e.productId ? prisma.product.findUnique({ where: { id: e.productId }, select: { id: true, name: true, sellingPrice: true, unit: true } }) : null,
    prisma.aiConversation.findFirst({ where: { businessId: req.businessId, enquiryId: e.id }, select: { id: true, transcript: true, status: true } }),
    prisma.user.findMany({ where: { id: { in: e.followups.map((f) => f.byUserId).filter(Boolean) } }, select: { id: true, name: true } }),
  ]);
  const names = Object.fromEntries(staff.map((s) => [s.id, s.name]));
  res.json({ enquiry: { ...e, followups: e.followups.map((f) => ({ ...f, byName: f.byAi ? 'AI assistant' : names[f.byUserId] })) }, product, conversation });
}));

const schema = z.object({
  customerId: z.string().nullable().optional(),
  name: z.string().max(100).nullable().optional(),
  phone: z.string().max(20).nullable().optional(),
  email: z.string().max(120).nullable().optional(),
  source: z.enum(SOURCES).default('WALK_IN'),
  intent: z.string().max(40).optional(),
  productId: z.string().nullable().optional(),
  itemText: z.string().max(300).nullable().optional(),
  quantity: z.string().max(60).nullable().optional(),
  budget: z.string().max(60).nullable().optional(),
  location: z.string().max(120).nullable().optional(),
  urgency: z.string().max(20).nullable().optional(),
  message: z.string().max(2000).nullable().optional(),
  status: z.enum(STATUSES).optional(),
  priority: z.enum(['LOW', 'NORMAL', 'HIGH']).optional(),
  assignedToId: z.string().nullable().optional(),
  followUpAt: z.string().nullable().optional(),
  nextAction: z.string().max(300).nullable().optional(),
});

async function cleanRefs(req, data) {
  if (data.customerId && !(await prisma.customer.findFirst({ where: { id: data.customerId, businessId: req.businessId } }))) throw badRequest('Invalid customer');
  if (data.productId && !(await prisma.product.findFirst({ where: { id: data.productId, businessId: req.businessId } }))) throw badRequest('Invalid product');
  if (data.assignedToId && !(await prisma.membership.findFirst({ where: { userId: data.assignedToId, businessId: req.businessId } }))) throw badRequest('Invalid staff member');
  if (data.followUpAt !== undefined) data.followUpAt = data.followUpAt ? new Date(data.followUpAt) : null;
  if (data.phone) data.phone = normalizePhone(data.phone);
  return data;
}

router.post('/', requirePerm('enquiries.manage'), validate(schema), ah(async (req, res) => {
  const data = await cleanRefs(req, { ...req.body });
  const enquiry = await prisma.$transaction(async (tx) => {
    // Match an existing customer or create a lead so nothing is retyped later.
    if (!data.customerId && (data.phone || data.email)) {
      const c = await findOrCreateCustomer(tx, req.businessId, { name: data.name, phone: data.phone, email: data.email, isLead: true }, req.business.settings.customerMatch);
      data.customerId = c.id;
      data.name = data.name || c.name;
    }
    const e = await tx.enquiry.create({ data: { ...data, businessId: req.businessId, assignedToId: data.assignedToId || req.user.id } });
    if (data.message) await tx.enquiryFollowup.create({ data: { enquiryId: e.id, note: data.message, byUserId: req.user.id } });
    await audit({ businessId: req.businessId, userId: req.user.id, action: 'enquiry.create', entity: 'Enquiry', entityId: e.id }, tx);
    return e;
  });
  res.status(201).json({ enquiry });
}));

router.put('/:id', requirePerm('enquiries.manage'), validate(schema.partial()), ah(async (req, res) => {
  const e = await prisma.enquiry.findFirst({ where: { id: req.params.id, businessId: req.businessId } });
  if (!e) throw notFound();
  const data = await cleanRefs(req, { ...req.body });
  const enquiry = await prisma.enquiry.update({ where: { id: e.id }, data });
  if (data.status && data.status !== e.status) {
    await prisma.enquiryFollowup.create({ data: { enquiryId: e.id, note: `Status changed ${e.status} → ${data.status}`, byUserId: req.user.id } });
  }
  await audit({ businessId: req.businessId, userId: req.user.id, action: 'enquiry.update', entity: 'Enquiry', entityId: e.id, data: Object.keys(data) });
  res.json({ enquiry });
}));

router.post('/:id/followups', requirePerm('enquiries.manage'), validate(z.object({
  note: z.string().trim().min(1).max(2000), nextFollowUpAt: z.string().nullable().optional(), status: z.enum(STATUSES).optional(),
})), ah(async (req, res) => {
  const e = await prisma.enquiry.findFirst({ where: { id: req.params.id, businessId: req.businessId } });
  if (!e) throw notFound();
  const followup = await prisma.enquiryFollowup.create({ data: { enquiryId: e.id, note: req.body.note, byUserId: req.user.id } });
  const data = {};
  if (req.body.nextFollowUpAt !== undefined) data.followUpAt = req.body.nextFollowUpAt ? new Date(req.body.nextFollowUpAt) : null;
  if (req.body.status) data.status = req.body.status;
  else if (e.status === 'NEW') data.status = 'CONTACTED';
  if (Object.keys(data).length) await prisma.enquiry.update({ where: { id: e.id }, data });
  res.status(201).json({ followup });
}));

// Convert an enquiry into a quotation or order, reusing its customer - no duplicate data entry.
router.post('/:id/convert', requirePerm('enquiries.manage'), validate(z.object({
  kind: z.enum(['QUOTATION', 'ORDER']),
  items: z.array(z.object({ productId: z.string(), qty: z.coerce.number().positive() })).min(1),
  fulfilment: z.enum(['PICKUP', 'DELIVERY']).default('PICKUP'),
  address: z.string().max(300).optional(),
  notes: z.string().max(500).optional(),
})), ah(async (req, res) => {
  const e = await prisma.enquiry.findFirst({ where: { id: req.params.id, businessId: req.businessId }, include: { customer: true } });
  if (!e) throw notFound();
  const contact = { name: e.customer?.name || e.name, phone: e.customer?.phone || e.phone, email: e.customer?.email || e.email };
  if (!e.customerId && !contact.phone && !contact.email) throw badRequest('Add a phone number or email to this enquiry first');
  const order = await placeOrder(req.business, {
    items: req.body.items, contact, fulfilment: req.body.fulfilment, address: req.body.address, notes: req.body.notes,
    kind: req.body.kind, channel: 'ENQUIRY', enquiryId: e.id, customerId: e.customerId, paymentMethod: 'PAY_AT_PICKUP',
  }, { actor: 'USER', userId: req.user.id });
  await prisma.enquiryFollowup.create({ data: { enquiryId: e.id, note: `Converted to ${req.body.kind.toLowerCase()} ${order.number}`, byUserId: req.user.id } });
  res.status(201).json({ order });
}));

module.exports = router;
