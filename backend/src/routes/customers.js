const router = require('express').Router();
const { z } = require('zod');
const { prisma } = require('../lib/prisma');
const { ah, notFound, conflict } = require('../lib/errors');
const { validate } = require('../middleware/validate');
const { requirePerm } = require('../middleware/tenant');
const { pageParams, normalizePhone, normalizeEmail, n, round2 } = require('../lib/util');
const { audit } = require('../lib/audit');
const { findCustomer, createCustomer, previewStatus } = require('../services/customers');

router.get('/', requirePerm('customers.view', 'pos.sell'), ah(async (req, res) => {
  const { q, tag, type } = req.query;
  const { take, skip, page } = pageParams(req.query);
  const where = { businessId: req.businessId };
  if (q) {
    const digits = normalizePhone(q);
    where.OR = [
      { name: { contains: q, mode: 'insensitive' } }, { email: { contains: q, mode: 'insensitive' } }, { code: { equals: q, mode: 'insensitive' } },
      ...(digits ? [{ phone: { contains: digits } }] : []),
    ];
  }
  if (tag) where.tags = { has: tag };
  if (type === 'lead') where.isLead = true;
  if (type === 'repeat') where.visitCount = { gt: 1 };
  if (type === 'new') where.visitCount = 1;
  const [customers, total] = await Promise.all([
    prisma.customer.findMany({ where, orderBy: { updatedAt: 'desc' }, take, skip }),
    prisma.customer.count({ where }),
  ]);
  res.json({ customers: customers.map((c) => ({ ...c, avgOrderValue: c.visitCount ? round2(n(c.totalSpent) / c.visitCount) : 0 })), total, page });
}));

// POS customer recognition: identify by phone/email/code and preview NEW vs REPEAT + next visit number.
router.get('/recognize', requirePerm('pos.sell', 'customers.view'), ah(async (req, res) => {
  const customer = await findCustomer(req.businessId, { phone: req.query.phone, email: req.query.email, code: req.query.code }, req.business.settings.customerMatch);
  if (!customer) return res.json({ customer: null, preview: { status: 'NEW', visitNumber: 1, label: 'New Customer' } });
  res.json({ customer, preview: previewStatus(customer) });
}));

router.get('/export.csv', requirePerm('customers.export'), ah(async (req, res) => {
  const rows = await prisma.customer.findMany({ where: { businessId: req.businessId }, orderBy: { createdAt: 'asc' } });
  const esc = (v) => `"${String(v ?? '').replace(/"/g, '""')}"`;
  const header = ['Code', 'Name', 'Phone', 'Email', 'City', 'Visits', 'Total spent', 'First purchase', 'Last purchase', 'Tags', 'Lead'];
  const lines = rows.map((c) => [c.code, c.name, c.phone, c.email, c.city, c.visitCount, n(c.totalSpent), c.firstPurchaseAt?.toISOString().slice(0, 10), c.lastPurchaseAt?.toISOString().slice(0, 10), c.tags.join('|'), c.isLead].map(esc).join(','));
  await audit({ businessId: req.businessId, userId: req.user.id, action: 'customers.export', entity: 'Customer', data: { count: rows.length } });
  res.setHeader('Content-Type', 'text/csv');
  res.setHeader('Content-Disposition', 'attachment; filename="customers.csv"');
  res.send([header.join(','), ...lines].join('\n'));
}));

router.get('/:id', requirePerm('customers.view'), ah(async (req, res) => {
  const customer = await prisma.customer.findFirst({ where: { id: req.params.id, businessId: req.businessId }, include: { addresses: true } });
  if (!customer) throw notFound();
  const [sales, orders, enquiries] = await Promise.all([
    prisma.sale.findMany({ where: { businessId: req.businessId, customerId: customer.id }, orderBy: { createdAt: 'desc' }, take: 100, select: { id: true, number: true, total: true, paidAmount: true, status: true, paymentStatus: true, channel: true, visitNumber: true, customerStatus: true, createdAt: true } }),
    prisma.order.findMany({ where: { businessId: req.businessId, customerId: customer.id }, orderBy: { createdAt: 'desc' }, take: 50, select: { id: true, number: true, kind: true, status: true, total: true, channel: true, createdAt: true } }),
    prisma.enquiry.findMany({ where: { businessId: req.businessId, customerId: customer.id }, orderBy: { createdAt: 'desc' }, take: 50, include: { followups: { orderBy: { createdAt: 'desc' }, take: 3 } } }),
  ]);
  // Outstanding credit across active sales.
  const due = round2(sales.filter((s) => s.status !== 'CANCELLED').reduce((acc, s) => acc + Math.max(n(s.total) - n(s.paidAmount), 0), 0));
  res.json({
    customer: { ...customer, avgOrderValue: customer.visitCount ? round2(n(customer.totalSpent) / customer.visitCount) : 0 },
    preview: previewStatus(customer), sales, orders, enquiries, due,
  });
}));

const customerSchema = z.object({
  name: z.string().trim().min(1).max(100),
  phone: z.string().max(20).nullable().optional(),
  email: z.string().email().nullable().optional().or(z.literal('')),
  taxId: z.string().max(30).nullable().optional(),
  address: z.string().max(300).nullable().optional(),
  city: z.string().max(80).nullable().optional(),
  notes: z.string().max(2000).nullable().optional(),
  tags: z.array(z.string().max(30)).optional(),
  marketingConsent: z.boolean().optional(),
});

async function assertUniqueContact(businessId, { phone, email }, exceptId) {
  const p = normalizePhone(phone);
  if (p) {
    const c = await prisma.customer.findFirst({ where: { businessId, phone: p, NOT: exceptId ? { id: exceptId } : undefined } });
    if (c) throw conflict(`Phone already belongs to ${c.name} (${c.code})`);
  }
}

router.post('/', requirePerm('customers.manage', 'pos.sell'), validate(customerSchema), ah(async (req, res) => {
  await assertUniqueContact(req.businessId, req.body);
  const customer = await prisma.$transaction((tx) => createCustomer(tx, req.businessId, req.body));
  await audit({ businessId: req.businessId, userId: req.user.id, action: 'customer.create', entity: 'Customer', entityId: customer.id });
  res.status(201).json({ customer, preview: previewStatus(customer) });
}));

router.put('/:id', requirePerm('customers.manage'), validate(customerSchema.partial()), ah(async (req, res) => {
  const c = await prisma.customer.findFirst({ where: { id: req.params.id, businessId: req.businessId } });
  if (!c) throw notFound();
  await assertUniqueContact(req.businessId, req.body, c.id);
  const data = { ...req.body };
  if (data.phone !== undefined) data.phone = normalizePhone(data.phone);
  if (data.email !== undefined) data.email = normalizeEmail(data.email) || null;
  const customer = await prisma.customer.update({ where: { id: c.id }, data });
  await audit({ businessId: req.businessId, userId: req.user.id, action: 'customer.update', entity: 'Customer', entityId: c.id });
  res.json({ customer });
}));

module.exports = router;
