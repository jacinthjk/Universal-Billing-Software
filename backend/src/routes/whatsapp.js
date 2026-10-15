// WhatsApp: link a number by QR code (or use the Cloud API), send invoices, payment reminders and
// product updates, and see what was sent.
const router = require('express').Router();
const { z } = require('zod');
const { prisma } = require('../lib/prisma');
const { ah, badRequest } = require('../lib/errors');
const { validate } = require('../middleware/validate');
const { requirePerm } = require('../middleware/tenant');
const { audit } = require('../lib/audit');
const messaging = require('../services/messaging');
const { invoiceMessage, reminderMessage, dueBills, productUpdateMessages, audienceWhere, DEFAULT_UPDATE } = require('../services/whatsappMessages');

const canSend = requirePerm('whatsapp.manage', 'sales.view', 'pos.sell');
const manage = requirePerm('whatsapp.manage');

router.get('/status', canSend, (req, res) => {
  const s = messaging.status(req.business);
  // Only people who can link/unlink see the QR code; scanning it takes over the business's number.
  if (!req.can('whatsapp.manage')) s.qr = null;
  res.json({ ...s, settings: req.business.settings.whatsapp, maxBulk: messaging.MAX_BULK, defaultUpdate: DEFAULT_UPDATE });
});

// Start linking: the QR code appears in /status within a few seconds.
router.post('/link', manage, ah(async (req, res) => {
  if (messaging.providerOf(req.business) !== 'LINKED') throw badRequest('Switch the provider to "Linked WhatsApp (QR)" first');
  await messaging.connect(req.business);
  await audit({ businessId: req.businessId, userId: req.user.id, action: 'whatsapp.link', entity: 'Business', entityId: req.businessId });
  res.json(messaging.status(req.business));
}));

router.post('/unlink', manage, ah(async (req, res) => {
  await messaging.logout(req.business);
  await audit({ businessId: req.businessId, userId: req.user.id, action: 'whatsapp.unlink', entity: 'Business', entityId: req.businessId });
  res.json(messaging.status(req.business));
}));

const phoneSchema = z.string().trim().min(8, 'Enter a mobile number').max(20);

router.post('/test', manage, validate(z.object({ to: phoneSchema })), ah(async (req, res) => {
  const result = await messaging.send(req.business, { to: req.body.to, text: `Test message from ${req.business.name}. WhatsApp is connected.` }, { kind: 'TEST', userId: req.user.id });
  res.json(result);
}));

// ───── Invoices & reminders ─────

router.post('/invoice/:saleId', requirePerm('sales.view', 'pos.sell'), validate(z.object({ to: phoneSchema.optional() })), ah(async (req, res) => {
  const item = await invoiceMessage(req.business, req.params.saleId, req.body.to);
  const result = await messaging.send(req.business, item.message, { kind: 'INVOICE', userId: req.user.id, name: item.name, customerId: item.customerId, refId: item.refId });
  if (result.status === 'SENT') await audit({ businessId: req.businessId, userId: req.user.id, action: 'invoice.whatsapp', entity: 'Sale', entityId: req.params.saleId });
  res.json(result);
}));

router.post('/reminder/:saleId', requirePerm('sales.view'), ah(async (req, res) => {
  const item = await reminderMessage(req.business, req.params.saleId);
  res.json(await messaging.send(req.business, item.message, { kind: 'REMINDER', userId: req.user.id, name: item.name, customerId: item.customerId, refId: item.refId }));
}));

router.get('/dues', requirePerm('sales.view'), ah(async (req, res) => {
  res.json({ bills: await dueBills(req.business) });
}));

router.post('/reminders', manage, validate(z.object({ saleIds: z.array(z.string()).min(1) })), ah(async (req, res) => {
  if (req.body.saleIds.length > messaging.MAX_BULK) throw badRequest(`Send to at most ${messaging.MAX_BULK} bills at a time`);
  if (!messaging.isReady(req.business)) throw badRequest(messaging.status(req.business).error || 'WhatsApp is not connected');
  const items = [];
  for (const id of req.body.saleIds) {
    try {
      items.push(await reminderMessage(req.business, id));
    } catch { /* paid, cancelled or no number since the list loaded - skip */ }
  }
  if (!items.length) throw badRequest('None of these bills can be reminded (paid, cancelled or no mobile number)');
  res.json(messaging.sendBatch(req.business, items, { kind: 'REMINDER', userId: req.user.id }));
}));

// ───── Product updates (marketing - consented customers only) ─────

const tagsSchema = z.array(z.string().max(30)).max(20).default([]);

router.post('/audience', manage, validate(z.object({ tags: tagsSchema })), ah(async (req, res) => {
  const where = audienceWhere(req.business, req.body.tags);
  const [count, tagRows] = await Promise.all([
    prisma.customer.count({ where }),
    prisma.customer.findMany({ where: { businessId: req.businessId, marketingConsent: true }, select: { tags: true } }),
  ]);
  res.json({ count, tags: [...new Set(tagRows.flatMap((r) => r.tags))].sort() });
}));

const updateSchema = z.object({
  productIds: z.array(z.string()).max(20).default([]),
  message: z.string().max(1500).optional(),
  tags: tagsSchema,
  includeImage: z.boolean().default(true),
});

router.post('/broadcast/preview', manage, validate(updateSchema), ah(async (req, res) => {
  const items = await productUpdateMessages(req.business, req.body);
  res.json({ count: items.length, sample: items[0]?.message.text || null, hasImage: !!items[0]?.message.image });
}));

router.post('/broadcast', manage, validate(updateSchema), ah(async (req, res) => {
  if (!messaging.isReady(req.business)) throw badRequest(messaging.status(req.business).error || 'WhatsApp is not connected');
  const items = await productUpdateMessages(req.business, req.body);
  if (!items.length) throw badRequest('No customers to send to. Only customers who consented to marketing messages and have a mobile number receive product updates.');
  if (items.length > messaging.MAX_BULK) throw badRequest(`This would message ${items.length} customers. Narrow it down with tags to ${messaging.MAX_BULK} or fewer.`);
  const batch = messaging.sendBatch(req.business, items, { kind: 'PRODUCT_UPDATE', userId: req.user.id });
  await audit({ businessId: req.businessId, userId: req.user.id, action: 'whatsapp.broadcast', entity: 'Business', entityId: req.businessId, data: { batchId: batch.batchId, total: batch.total, productIds: req.body.productIds } });
  res.json(batch);
}));

// ───── Log ─────

router.get('/messages', canSend, ah(async (req, res) => {
  const where = { businessId: req.businessId };
  if (req.query.batchId) where.batchId = String(req.query.batchId);
  if (req.query.kind) where.kind = String(req.query.kind);
  if (req.query.refId) where.refId = String(req.query.refId);
  const take = Math.min(Number(req.query.limit) || 100, 300);
  const messages = await prisma.messageLog.findMany({ where, orderBy: { createdAt: 'desc' }, take });
  const out = messages.map((m) => ({ ...m, recipient: messaging.maskNumber(m.recipient) }));
  if (!req.query.batchId) return res.json({ messages: out });
  const counts = await prisma.messageLog.groupBy({ by: ['status'], where, _count: true });
  res.json({ messages: out, counts: Object.fromEntries(counts.map((c) => [c.status, c._count])) });
}));

module.exports = router;
