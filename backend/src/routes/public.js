// Public storefront + AI widget API. No auth: everything is resolved by the business slug and
// only website-visible data is exposed. Prices, stock and totals are always computed server-side.
const router = require('express').Router();
const { z } = require('zod');
const rateLimit = require('express-rate-limit');
const { prisma } = require('../lib/prisma');
const { ah, notFound, badRequest, forbidden } = require('../lib/errors');
const { validate } = require('../middleware/validate');
const { withDefaults } = require('../lib/businessConfig');
const { n, normalizePhone, pageParams } = require('../lib/util');
const { availability } = require('../services/stock');
const { priceLines } = require('../services/pricing');
const { placeOrder } = require('../services/orders');
const { findOrCreateCustomer } = require('../services/customers');
const { chat } = require('../services/ai/agent');
const { getProvider } = require('../services/payments');
const { notify, audit } = require('../lib/audit');

const writeLimiter = rateLimit({ windowMs: 60 * 1000, limit: 20, standardHeaders: 'draft-7', legacyHeaders: false });
const chatLimiter = rateLimit({ windowMs: 60 * 1000, limit: 15, standardHeaders: 'draft-7', legacyHeaders: false });

// Invoice verification (QR on invoices).
router.get('/verify/:token', ah(async (req, res) => {
  const sale = await prisma.sale.findUnique({ where: { verifyToken: req.params.token }, include: { business: true, customer: { select: { name: true } } } });
  if (!sale) throw notFound('Invoice not found');
  const b = withDefaults(sale.business);
  res.json({
    valid: true, business: { name: b.name, slug: b.slug, logoUrl: b.logoUrl, theme: b.theme, currency: b.currency },
    number: sale.number, date: sale.createdAt, total: n(sale.total), status: sale.status, paymentStatus: sale.paymentStatus,
    customer: sale.customer ? sale.customer.name.replace(/^(\S+).*/, '$1') : null,
  });
}));

// Resolve the business for all /:slug routes.
router.param('slug', async (req, res, next, slug) => {
  try {
    const raw = await prisma.business.findUnique({ where: { slug } });
    if (!raw || raw.status !== 'ACTIVE') throw notFound('Store not found');
    const business = withDefaults(raw);
    if (!business.website.enabled || !business.settings.modules.includes('website')) throw notFound('This store website is not published');
    req.business = business;
    next();
  } catch (e) {
    next(e);
  }
});

function productCard(b, p, a) {
  return {
    id: p.id, name: p.name, variant: p.variant, kind: p.kind, unit: p.unit, brand: p.brand, imageUrl: p.imageUrl,
    description: p.description, category: p.category ? { id: p.category.id, name: p.category.name, slug: p.category.slug } : null,
    price: b.website.showPrices ? n(p.sellingPrice) : null, mrp: b.website.showPrices && p.mrp ? n(p.mrp) : null, taxRate: n(p.taxRate),
    inStock: a.inStock, available: b.website.showStock ? a.available : undefined, customFields: p.customFields,
  };
}

router.get('/:slug', ah(async (req, res) => {
  const b = req.business;
  const categories = await prisma.category.findMany({ where: { businessId: b.id, products: { some: { active: true, showOnWebsite: true } } }, orderBy: [{ sortOrder: 'asc' }, { name: 'asc' }] });
  res.json({
    business: {
      name: b.name, slug: b.slug, type: b.type, phone: b.phone, email: b.email, address: b.address, city: b.city,
      logoUrl: b.logoUrl, currency: b.currency, theme: b.theme, terminology: b.terminology, website: b.website,
      taxInclusive: b.settings.taxInclusive,
      ai: { enabled: b.ai.enabled && b.settings.modules.includes('ai'), greeting: b.ai.greeting },
      onlinePayments: getProvider().online,
    },
    categories,
  });
}));

router.get('/:slug/products', ah(async (req, res) => {
  const b = req.business;
  const { take, skip, page } = pageParams({ limit: req.query.limit || 24, page: req.query.page });
  const where = { businessId: b.id, active: true, showOnWebsite: true };
  if (req.query.category) where.category = { slug: req.query.category };
  if (req.query.q) where.OR = [{ name: { contains: req.query.q, mode: 'insensitive' } }, { brand: { contains: req.query.q, mode: 'insensitive' } }, { description: { contains: req.query.q, mode: 'insensitive' } }];
  if (req.query.ids) where.id = { in: String(req.query.ids).split(',').slice(0, 50) };
  const orderBy = req.query.sort === 'price_asc' ? { sellingPrice: 'asc' } : req.query.sort === 'price_desc' ? { sellingPrice: 'desc' } : req.query.sort === 'new' ? { createdAt: 'desc' } : { name: 'asc' };
  const [products, total] = await Promise.all([
    prisma.product.findMany({ where, include: { category: true }, orderBy, take, skip }),
    prisma.product.count({ where }),
  ]);
  const avail = await availability(b.id, products);
  let list = products.map((p) => productCard(b, p, avail[p.id]));
  if (req.query.inStock === '1') list = list.filter((p) => p.inStock);
  res.json({ products: list, total, page });
}));

router.get('/:slug/products/:id', ah(async (req, res) => {
  const b = req.business;
  const p = await prisma.product.findFirst({ where: { id: req.params.id, businessId: b.id, active: true, showOnWebsite: true }, include: { category: true } });
  if (!p) throw notFound('Product not found');
  const avail = await availability(b.id, [p]);
  const related = await prisma.product.findMany({ where: { businessId: b.id, active: true, showOnWebsite: true, categoryId: p.categoryId, NOT: { id: p.id } }, include: { category: true }, take: 4 });
  const ra = await availability(b.id, related);
  res.json({ product: productCard(b, p, avail[p.id]), related: related.map((r) => productCard(b, r, ra[r.id])) });
}));

const itemsSchema = z.array(z.object({ productId: z.string(), qty: z.coerce.number().positive().max(10000) })).min(1).max(50);

// Server-side cart pricing + availability (the client never sends prices).
router.post('/:slug/cart', validate(z.object({ items: itemsSchema })), ah(async (req, res) => {
  const b = req.business;
  const products = await prisma.product.findMany({ where: { businessId: b.id, active: true, showOnWebsite: true, id: { in: req.body.items.map((i) => i.productId) } }, include: { category: true } });
  const known = req.body.items.filter((i) => products.some((p) => p.id === i.productId));
  if (!known.length) return res.json({ lines: [], subtotal: 0, tax: 0, total: 0, problems: [] });
  const priced = priceLines(products, known, { taxInclusive: b.settings.taxInclusive });
  const avail = await availability(b.id, products);
  const problems = priced.lines.filter((l) => avail[l.productId].available !== null && avail[l.productId].available < l.qty)
    .map((l) => ({ productId: l.productId, message: `Only ${Math.max(avail[l.productId].available, 0)} ${l.unit} of ${l.name} available` }));
  res.json({
    lines: priced.lines.map((l) => ({ ...l, costPrice: undefined, product: productCard(b, products.find((p) => p.id === l.productId), avail[l.productId]) })),
    subtotal: priced.subtotal, tax: priced.tax, total: priced.total, problems,
  });
}));

router.post('/:slug/orders', writeLimiter, validate(z.object({
  items: itemsSchema,
  contact: z.object({ name: z.string().trim().min(2).max(100), phone: z.string().trim().min(6).max(20), email: z.string().email().optional().or(z.literal('')) }),
  fulfilment: z.enum(['PICKUP', 'DELIVERY']),
  address: z.string().max(400).optional(),
  paymentMethod: z.enum(['PAY_ON_DELIVERY', 'PAY_AT_PICKUP', 'ONLINE']),
  notes: z.string().max(500).optional(),
  idempotencyKey: z.string().min(8).max(80),
})), ah(async (req, res) => {
  const b = req.business;
  const w = b.website;
  if (!w.allowOrders) throw forbidden('Online ordering is not enabled for this store');
  if (!w.fulfilment.includes(req.body.fulfilment)) throw badRequest('Selected fulfilment option is not available');
  if (req.body.fulfilment === 'DELIVERY' && !req.body.address) throw badRequest('Delivery address is required');
  const provider = getProvider();
  if (req.body.paymentMethod === 'ONLINE' ? !provider.online : !w.paymentOptions.includes(req.body.paymentMethod)) throw badRequest('Selected payment option is not available');
  const order = await placeOrder(b, { ...req.body, contact: { ...req.body.contact, email: req.body.contact.email || undefined }, channel: 'WEBSITE' });
  let checkout = null;
  if (req.body.paymentMethod === 'ONLINE' && order.paymentStatus !== 'PAID') {
    checkout = await provider.createCheckout(order, b);
    if (checkout?.gatewayOrderId) await prisma.order.update({ where: { id: order.id }, data: { paymentRef: checkout.gatewayOrderId } });
  }
  res.status(201).json({ order: { number: order.number, total: n(order.total), status: order.status, trackingToken: order.trackingToken }, checkout });
}));

router.get('/:slug/track/:token', ah(async (req, res) => {
  const o = await prisma.order.findFirst({ where: { businessId: req.business.id, trackingToken: req.params.token }, include: { items: true, sale: { select: { verifyToken: true, number: true } } } });
  if (!o) throw notFound('Order not found');
  res.json({
    order: {
      number: o.number, kind: o.kind, status: o.status, paymentStatus: o.paymentStatus, paymentMethod: o.paymentMethod, fulfilment: o.fulfilment,
      total: n(o.total), tax: n(o.tax), createdAt: o.createdAt, updatedAt: o.updatedAt, contactName: o.contactName,
      items: o.items.map((i) => ({ name: i.name, qty: n(i.qty), unitPrice: n(i.unitPrice), lineTotal: n(i.lineTotal) })),
      invoice: o.sale ? { number: o.sale.number, verifyToken: o.sale.verifyToken } : null,
    },
  });
}));

router.post('/:slug/enquiries', writeLimiter, validate(z.object({
  name: z.string().trim().min(2).max(100), phone: z.string().trim().min(6).max(20), email: z.string().email().optional().or(z.literal('')),
  message: z.string().trim().min(2).max(2000), productId: z.string().optional(),
})), ah(async (req, res) => {
  const b = req.business;
  const product = req.body.productId ? await prisma.product.findFirst({ where: { id: req.body.productId, businessId: b.id }, select: { id: true, name: true } }) : null;
  const enquiry = await prisma.$transaction(async (tx) => {
    const c = await findOrCreateCustomer(tx, b.id, { name: req.body.name, phone: req.body.phone, email: req.body.email || undefined, isLead: true }, b.settings.customerMatch);
    const e = await tx.enquiry.create({
      data: {
        businessId: b.id, customerId: c.id, name: req.body.name, phone: normalizePhone(req.body.phone), email: req.body.email || null,
        source: 'WEBSITE', intent: 'PRODUCT_ENQUIRY', productId: product?.id, itemText: product?.name, message: req.body.message, status: 'NEW',
        followUpAt: new Date(Date.now() + 2 * 3600 * 1000),
      },
    });
    await tx.enquiryFollowup.create({ data: { enquiryId: e.id, note: `Website enquiry: ${req.body.message}` } });
    await audit({ businessId: b.id, actor: 'CUSTOMER', action: 'enquiry.create', entity: 'Enquiry', entityId: e.id }, tx);
    return e;
  });
  await notify(b.id, { type: 'ENQUIRY', title: `Website enquiry from ${req.body.name}`, body: req.body.message.slice(0, 140), link: `/enquiries/${enquiry.id}` });
  res.status(201).json({ ok: true });
}));

// ───── AI chat widget ─────

router.post('/:slug/chat', chatLimiter, validate(z.object({
  visitorId: z.string().min(8).max(80), conversationId: z.string().max(40).optional(), message: z.string().trim().min(1).max(1000), page: z.string().max(300).optional(),
})), ah(async (req, res) => {
  const result = await chat(req.business, { ...req.body, channel: 'WEBSITE' });
  res.json(result);
}));

router.get('/:slug/chat/:conversationId', ah(async (req, res) => {
  const c = await prisma.aiConversation.findFirst({ where: { id: req.params.conversationId, businessId: req.business.id, visitorId: String(req.query.visitorId || '') }, select: { id: true, status: true, transcript: true } });
  if (!c) throw notFound();
  res.json({ conversationId: c.id, status: c.status, messages: c.transcript.map(({ role, text, at }) => ({ role, text, at })) });
}));

module.exports = router;
