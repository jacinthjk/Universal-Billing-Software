const router = require('express').Router();
const { z } = require('zod');
const { prisma } = require('../lib/prisma');
const { ah, notFound } = require('../lib/errors');
const { validate } = require('../middleware/validate');
const { requirePerm } = require('../middleware/tenant');
const { pageParams } = require('../lib/util');
const { audit } = require('../lib/audit');
const { chat, staffReply } = require('../services/ai/agent');
const config = require('../config');

router.get('/status', requirePerm('ai.manage', 'enquiries.view'), (req, res) => {
  res.json({ provider: req.business.ai.provider === 'rules' || !config.anthropicApiKey ? 'rules' : 'anthropic', hasApiKey: !!config.anthropicApiKey, ai: req.business.ai });
});

router.get('/conversations', requirePerm('ai.manage', 'enquiries.view'), ah(async (req, res) => {
  const { take, skip, page } = pageParams(req.query);
  const where = { businessId: req.businessId };
  if (req.query.status) where.status = req.query.status;
  if (req.query.uncertain === '1') where.uncertain = true;
  const [rows, total] = await Promise.all([
    prisma.aiConversation.findMany({ where, orderBy: { updatedAt: 'desc' }, take, skip, select: { id: true, channel: true, status: true, summary: true, uncertain: true, customerId: true, enquiryId: true, transcript: true, createdAt: true, updatedAt: true } }),
    prisma.aiConversation.count({ where }),
  ]);
  const customers = await prisma.customer.findMany({ where: { id: { in: rows.map((r) => r.customerId).filter(Boolean) } }, select: { id: true, name: true, phone: true } });
  const cm = Object.fromEntries(customers.map((c) => [c.id, c]));
  res.json({
    conversations: rows.map(({ transcript, ...r }) => ({ ...r, customer: cm[r.customerId], messages: transcript.length, lastMessage: transcript[transcript.length - 1]?.text?.slice(0, 140) })),
    total, page,
  });
}));

router.get('/conversations/:id', requirePerm('ai.manage', 'enquiries.view'), ah(async (req, res) => {
  const c = await prisma.aiConversation.findFirst({
    where: { id: req.params.id, businessId: req.businessId },
    select: { id: true, channel: true, status: true, summary: true, uncertain: true, customerId: true, enquiryId: true, transcript: true, createdAt: true, toolCalls: { orderBy: { createdAt: 'asc' } } },
  });
  if (!c) throw notFound();
  const customer = c.customerId ? await prisma.customer.findUnique({ where: { id: c.customerId }, select: { id: true, name: true, phone: true, email: true, visitCount: true } }) : null;
  res.json({ conversation: { ...c, customer } });
}));

router.post('/conversations/:id/reply', requirePerm('enquiries.manage'), validate(z.object({ text: z.string().trim().min(1).max(2000) })), ah(async (req, res) => {
  const c = await staffReply(req.business, req.user, req.params.id, req.body.text);
  if (!c) throw notFound();
  await audit({ businessId: req.businessId, userId: req.user.id, action: 'ai.staff_reply', entity: 'AiConversation', entityId: c.id });
  res.json({ ok: true, status: c.status });
}));

// Hand the conversation back to the AI, or close it.
router.post('/conversations/:id/status', requirePerm('enquiries.manage'), validate(z.object({ status: z.enum(['AI', 'CLOSED', 'STAFF']) })), ah(async (req, res) => {
  const c = await prisma.aiConversation.findFirst({ where: { id: req.params.id, businessId: req.businessId } });
  if (!c) throw notFound();
  await prisma.aiConversation.update({ where: { id: c.id }, data: { status: req.body.status } });
  res.json({ ok: true });
}));

// Staff "try the assistant" sandbox - same agent and tools as the public widget.
router.post('/test', requirePerm('ai.manage'), validate(z.object({ message: z.string().trim().min(1).max(1000), conversationId: z.string().optional() })), ah(async (req, res) => {
  const result = await chat(req.business, { conversationId: req.body.conversationId, visitorId: `staff-test-${req.user.id}`, message: req.body.message, channel: 'TEST' });
  res.json(result);
}));

// ───── Knowledge base ─────

router.get('/knowledge', requirePerm('ai.manage'), ah(async (req, res) => {
  res.json({ items: await prisma.knowledgeItem.findMany({ where: { businessId: req.businessId }, orderBy: [{ category: 'asc' }, { title: 'asc' }] }) });
}));

const kbSchema = z.object({ title: z.string().trim().min(2).max(150), content: z.string().trim().min(2).max(5000), category: z.string().max(30).default('FAQ'), active: z.boolean().default(true) });

router.post('/knowledge', requirePerm('ai.manage'), validate(kbSchema), ah(async (req, res) => {
  const item = await prisma.knowledgeItem.create({ data: { ...req.body, businessId: req.businessId } });
  await audit({ businessId: req.businessId, userId: req.user.id, action: 'kb.create', entity: 'KnowledgeItem', entityId: item.id });
  res.status(201).json({ item });
}));

router.put('/knowledge/:id', requirePerm('ai.manage'), validate(kbSchema.partial()), ah(async (req, res) => {
  const k = await prisma.knowledgeItem.findFirst({ where: { id: req.params.id, businessId: req.businessId } });
  if (!k) throw notFound();
  const item = await prisma.knowledgeItem.update({ where: { id: k.id }, data: req.body });
  await audit({ businessId: req.businessId, userId: req.user.id, action: 'kb.update', entity: 'KnowledgeItem', entityId: k.id });
  res.json({ item });
}));

router.delete('/knowledge/:id', requirePerm('ai.manage'), ah(async (req, res) => {
  const k = await prisma.knowledgeItem.findFirst({ where: { id: req.params.id, businessId: req.businessId } });
  if (!k) throw notFound();
  await prisma.knowledgeItem.delete({ where: { id: k.id } });
  res.json({ ok: true });
}));

module.exports = router;
