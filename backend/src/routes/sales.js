const router = require('express').Router();
const { z } = require('zod');
const { prisma } = require('../lib/prisma');
const { ah, notFound } = require('../lib/errors');
const { validate } = require('../middleware/validate');
const { requirePerm } = require('../middleware/tenant');
const { pageParams, dayRange } = require('../lib/util');
const rateLimit = require('express-rate-limit');
const { previewSale, createSale, updateSale, addPayment, cancelSale, returnSale } = require('../services/sales');
const { verifyBillPasscode } = require('../lib/passcode');
const { loadInvoice, getInvoiceAsset, renderPreviewPng } = require('../services/invoice');
const { audit } = require('../lib/audit');
const messaging = require('../services/messaging');
const { invoiceText, invoiceMessage } = require('../services/whatsappMessages');

const paymentSchema = z.object({ method: z.string().min(1).max(20), amount: z.coerce.number().min(0), reference: z.string().max(80).optional() });

const billingSchema = z.object({
  name: z.string().trim().max(100).optional().or(z.literal('')),
  phone: z.string().trim().max(20).optional().or(z.literal('')),
  email: z.string().trim().max(120).optional().or(z.literal('')),
  address: z.string().trim().max(400).optional().or(z.literal('')),
  taxId: z.string().trim().max(30).optional().or(z.literal('')),
}).nullable().optional();

const saleSchema = z.object({
  customer: z.object({
    id: z.string().optional(), phone: z.string().max(20).optional(), email: z.string().max(120).optional(), name: z.string().max(100).optional(),
  }).nullable().optional(),
  items: z.array(z.object({
    productId: z.string(), qty: z.coerce.number().positive(),
    unitPrice: z.coerce.number().min(0).optional(), discount: z.coerce.number().min(0).optional(),
  })).min(1),
  billDiscount: z.coerce.number().min(0).default(0),
  payments: z.array(paymentSchema).default([]),
  notes: z.string().max(500).optional(),
  billing: billingSchema,
});

// Wrong passcodes are rate-limited per user (successful attempts don't count).
const passcodeLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, limit: 10, skipSuccessfulRequests: true, standardHeaders: 'draft-7', legacyHeaders: false,
  keyGenerator: (req) => `${req.businessId}:${req.user.id}`,
  message: { error: 'Too many wrong passcode attempts. Try again in 15 minutes.' },
});

const salePerms = (req) => ({ discount: req.can('sales.discount'), changePrice: req.can('sales.change_price'), editCustomer: req.can('customers.manage') });

// Bill preview before the sale is saved: same pricing and customer recognition, nothing is written.
router.post('/preview', requirePerm('pos.sell'), validate(saleSchema), ah(async (req, res) => {
  const { sale, errors, matchedCustomer } = await previewSale(req.business, req.body, salePerms(req));
  const { inv, png } = await renderPreviewPng(req.business, sale);
  res.json({ invoice: inv, image: `data:image/png;base64,${png.toString('base64')}`, errors, matchedCustomer });
}));

// POS checkout. Only product ids + quantities are trusted from the client; prices come from the master.
router.post('/', requirePerm('pos.sell'), validate(saleSchema), ah(async (req, res) => {
  const sale = await createSale(req.business, req.user, req.body, salePerms(req));
  const invoice = await loadInvoice(req.business, sale.id);
  // Optional: send the invoice PDF to the customer's WhatsApp in the background (logged in MessageLog).
  if (req.business.settings.whatsapp?.autoSendInvoice && invoice.customer?.phone && messaging.isReady(req.business)) {
    invoiceMessage(req.business, sale.id)
      .then((item) => messaging.send(req.business, item.message, { kind: 'INVOICE', userId: req.user.id, name: item.name, customerId: item.customerId, refId: item.refId }))
      .catch((e) => console.error('[whatsapp] auto-send invoice failed', e.message));
  }
  res.status(201).json({ sale, invoice });
}));

router.get('/', requirePerm('sales.view'), ah(async (req, res) => {
  const { take, skip, page } = pageParams(req.query);
  const where = { businessId: req.businessId };
  if (req.query.status) where.status = req.query.status;
  if (req.query.paymentStatus) where.paymentStatus = req.query.paymentStatus;
  if (req.query.channel) where.channel = req.query.channel;
  if (req.query.customerId) where.customerId = req.query.customerId;
  if (req.query.q) where.OR = [{ number: { contains: req.query.q, mode: 'insensitive' } }, { customer: { name: { contains: req.query.q, mode: 'insensitive' } } }, { customer: { phone: { contains: req.query.q } } }];
  if (req.query.from || req.query.to) {
    const tz = req.business.timezone;
    where.createdAt = { ...(req.query.from ? { gte: dayRange(req.query.from, tz).start } : {}), ...(req.query.to ? { lt: dayRange(req.query.to, tz).end } : {}) };
  }
  const [sales, total] = await Promise.all([
    prisma.sale.findMany({ where, include: { customer: { select: { id: true, name: true, phone: true } }, payments: { select: { method: true, amount: true } } }, orderBy: { createdAt: 'desc' }, take, skip }),
    prisma.sale.count({ where }),
  ]);
  res.json({ sales, total, page });
}));

router.get('/:id', requirePerm('sales.view', 'pos.sell'), ah(async (req, res) => {
  const sale = await prisma.sale.findFirst({ where: { id: req.params.id, businessId: req.businessId }, include: { items: true, payments: true, customer: true, returns: { include: { items: true } }, order: { select: { id: true, number: true } } } });
  if (!sale) throw notFound();
  if (!req.can('products.view_cost')) sale.items.forEach((i) => delete i.costPrice);
  if (sale.cancelledById) sale.cancelledByName = (await prisma.user.findUnique({ where: { id: sale.cancelledById }, select: { name: true } }))?.name;
  res.json({ sale, invoice: await loadInvoice(req.business, sale.id) });
}));

router.post('/:id/payments', requirePerm('pos.sell'), validate(paymentSchema), ah(async (req, res) => {
  res.json({ sale: await addPayment(req.business, req.user, req.params.id, req.body) });
}));

// Check the bill passcode before opening the editor / cancel dialog (the action itself re-checks it).
router.post('/:id/unlock', requirePerm('sales.edit', 'sales.void'), passcodeLimiter, validate(z.object({ passcode: z.string().max(12).optional(), action: z.enum(['edit', 'cancel']) })), ah(async (req, res) => {
  await verifyBillPasscode(req.businessId, req.body.passcode, { userId: req.user.id, action: req.body.action, saleId: req.params.id });
  res.json({ ok: true });
}));

// Edit a saved bill (passcode-protected when the business has set one).
router.put('/:id', requirePerm('sales.edit'), passcodeLimiter, validate(z.object({
  passcode: z.string().max(12).optional(),
  reason: z.string({ error: 'Enter a reason for the change' }).trim().min(3, 'Enter a reason for the change').max(300),
  billing: billingSchema,
  items: z.array(z.object({
    productId: z.string(), qty: z.coerce.number().positive(),
    unitPrice: z.coerce.number().min(0).optional(), discount: z.coerce.number().min(0).optional(),
  })).optional(),
  billDiscount: z.coerce.number().min(0).default(0),
  payments: z.array(paymentSchema).optional(),
  notes: z.string().max(500).nullable().optional(),
})), ah(async (req, res) => {
  const { passcode, ...input } = req.body;
  await verifyBillPasscode(req.businessId, passcode, { userId: req.user.id, action: 'edit', saleId: req.params.id });
  const sale = await updateSale(req.business, req.user, req.params.id, input, salePerms(req));
  res.json({ sale, invoice: await loadInvoice(req.business, sale.id) });
}));

// Cancel a bill: restores stock, reverses the customer visit (passcode-protected when set).
router.post('/:id/cancel', requirePerm('sales.void'), passcodeLimiter, validate(z.object({
  reason: z.string({ error: 'Enter a reason for cancelling' }).trim().min(3, 'Enter a reason for cancelling').max(300),
  passcode: z.string().max(12).optional(),
})), ah(async (req, res) => {
  await verifyBillPasscode(req.businessId, req.body.passcode, { userId: req.user.id, action: 'cancel', saleId: req.params.id });
  res.json({ sale: await cancelSale(req.business, req.user, req.params.id, req.body.reason) });
}));

// Create / edit / cancel / payment / return trail for one bill.
router.get('/:id/history', requirePerm('sales.view'), ah(async (req, res) => {
  const sale = await prisma.sale.findFirst({ where: { id: req.params.id, businessId: req.businessId }, select: { id: true } });
  if (!sale) throw notFound();
  const logs = await prisma.auditLog.findMany({ where: { businessId: req.businessId, entity: 'Sale', entityId: sale.id }, orderBy: { createdAt: 'desc' } });
  const users = await prisma.user.findMany({ where: { id: { in: [...new Set(logs.map((l) => l.userId).filter(Boolean))] } }, select: { id: true, name: true } });
  const names = Object.fromEntries(users.map((u) => [u.id, u.name]));
  res.json({ history: logs.map((l) => ({ id: l.id, action: l.action, at: l.createdAt, by: names[l.userId] || l.actor, data: l.data })) });
}));

router.post('/:id/return', requirePerm('sales.refund'), validate(z.object({
  reason: z.string().max(300).optional(),
  refundMethod: z.string().default('CASH'),
  items: z.array(z.object({ saleItemId: z.string(), qty: z.coerce.number().positive() })).min(1),
})), ah(async (req, res) => {
  res.json({ return: await returnSale(req.business, req.user, req.params.id, req.body) });
}));

// Invoice outputs: same authoritative data for PDF and image.
router.get('/:id/invoice.pdf', requirePerm('sales.view', 'pos.sell'), ah(async (req, res) => {
  const { buffer, inv } = await getInvoiceAsset(req.business, req.params.id, 'pdf', { force: req.query.regenerate === '1', format: req.query.format === 'THERMAL' ? 'THERMAL' : req.query.format === 'A4' ? 'A4' : undefined });
  res.setHeader('Content-Type', 'application/pdf');
  res.setHeader('Content-Disposition', `${req.query.download ? 'attachment' : 'inline'}; filename="${inv.number}.pdf"`);
  res.send(buffer);
}));

router.get('/:id/invoice.png', requirePerm('sales.view', 'pos.sell'), ah(async (req, res) => {
  const { buffer, inv } = await getInvoiceAsset(req.business, req.params.id, 'png', { force: req.query.regenerate === '1' });
  res.setHeader('Content-Type', 'image/png');
  res.setHeader('Content-Disposition', `${req.query.download ? 'attachment' : 'inline'}; filename="${inv.number}.png"`);
  res.send(buffer);
}));

// Ready-to-send WhatsApp share text with the public verification link.
router.get('/:id/share', requirePerm('sales.view', 'pos.sell'), ah(async (req, res) => {
  const inv = await loadInvoice(req.business, req.params.id);
  const text = invoiceText(req.business, inv);
  const phone = inv.customer?.phone ? messaging.toWhatsAppNumber(inv.customer.phone, messaging.countryCode(req.business)) : '';
  await audit({ businessId: req.businessId, userId: req.user.id, action: 'invoice.share', entity: 'Sale', entityId: req.params.id });
  res.json({ text, whatsappUrl: `https://wa.me/${phone}?text=${encodeURIComponent(text)}`, verifyUrl: inv.verifyUrl });
}));

module.exports = router;
