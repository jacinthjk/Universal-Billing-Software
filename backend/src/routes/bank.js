const router = require('express').Router();
const multer = require('multer');
const crypto = require('crypto');
const { z } = require('zod');
const { prisma } = require('../lib/prisma');
const { ah, badRequest, notFound } = require('../lib/errors');
const { validate } = require('../middleware/validate');
const { requirePerm } = require('../middleware/tenant');
const { n, round2, todayIn, dayRange, pageParams } = require('../lib/util');
const { audit } = require('../lib/audit');
const bank = require('../services/bank');

const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 10 * 1024 * 1024 } });
const dateRe = /^\d{4}-\d{2}-\d{2}$/;
const view = requirePerm('bank.view', 'bank.manage');
const manage = requirePerm('bank.manage');

async function getAccount(req, id) {
  const account = await prisma.bankAccount.findFirst({ where: { id, businessId: req.businessId } });
  if (!account) throw notFound('Bank account not found');
  return account;
}

// ───── Accounts ─────

router.get('/accounts', view, ah(async (req, res) => {
  const accounts = await prisma.bankAccount.findMany({ where: { businessId: req.businessId }, orderBy: [{ active: 'desc' }, { createdAt: 'asc' }] });
  const monthStart = dayRange(`${todayIn(req.business.timezone).slice(0, 7)}-01`, req.business.timezone).start;
  const bal = await bank.accountBalances(req.businessId, accounts.map((a) => a.id), monthStart);
  res.json({
    accounts: accounts.map((a) => ({ ...a, ...bal[a.id], balance: round2(n(a.openingBalance) + bal[a.id].credits - bal[a.id].debits) })),
  });
}));

const accountSchema = z.object({
  name: z.string().trim().min(1).max(80), bankName: z.string().max(80).nullable().optional(),
  accountMask: z.string().max(30).nullable().optional(), ifsc: z.string().max(15).nullable().optional(),
  openingBalance: z.coerce.number().optional(), openingDate: z.string().regex(dateRe).nullable().optional(), active: z.boolean().optional(),
});
const accountData = (b) => ({ ...b, ...(b.openingDate !== undefined ? { openingDate: b.openingDate ? bank.asDate(b.openingDate) : null } : {}), ...(b.accountMask ? { accountMask: b.accountMask.replace(/\D/g, '').slice(-4) } : {}) });

router.post('/accounts', manage, validate(accountSchema), ah(async (req, res) => {
  const account = await prisma.bankAccount.create({ data: { ...accountData(req.body), businessId: req.businessId } });
  await audit({ businessId: req.businessId, userId: req.user.id, action: 'bank.account_create', entity: 'BankAccount', entityId: account.id });
  res.status(201).json({ account });
}));

router.put('/accounts/:id', manage, validate(accountSchema.partial()), ah(async (req, res) => {
  const a = await getAccount(req, req.params.id);
  res.json({ account: await prisma.bankAccount.update({ where: { id: a.id }, data: accountData(req.body) }) });
}));

// ───── Statement import ─────

router.post('/accounts/:id/import', manage, upload.single('file'), ah(async (req, res) => {
  const account = await getAccount(req, req.params.id);
  if (!req.file) throw badRequest('Choose a statement file to upload');
  const parsed = await bank.parseStatement(req.file.buffer, req.file.originalname);
  const result = await bank.importLines(account, parsed.lines);
  const dates = parsed.lines.map((l) => l.date).sort();
  await audit({ businessId: req.businessId, userId: req.user.id, action: 'bank.import', entity: 'BankAccount', entityId: account.id, data: { file: req.file.originalname, ...result, skipped: parsed.skipped } });
  res.json({ ...result, skipped: parsed.skipped, rows: parsed.lines.length, from: dates[0], to: dates[dates.length - 1], columns: parsed.columns });
}));

router.get('/imports', view, ah(async (req, res) => {
  const where = { businessId: req.businessId, importId: { not: null } };
  if (req.query.accountId) where.accountId = req.query.accountId;
  const groups = await prisma.bankTransaction.groupBy({ by: ['importId', 'accountId'], where, _count: true, _min: { date: true, createdAt: true }, _max: { date: true }, _sum: { credit: true, debit: true }, orderBy: { _min: { createdAt: 'desc' } }, take: 30 });
  res.json({ imports: groups.map((g) => ({ importId: g.importId, accountId: g.accountId, count: g._count, from: g._min.date, to: g._max.date, importedAt: g._min.createdAt, credits: round2(n(g._sum.credit)), debits: round2(n(g._sum.debit)) })) });
}));

router.delete('/imports/:importId', manage, ah(async (req, res) => {
  const { count } = await prisma.bankTransaction.deleteMany({ where: { businessId: req.businessId, importId: req.params.importId } });
  if (!count) throw notFound('Import not found');
  await audit({ businessId: req.businessId, userId: req.user.id, action: 'bank.import_undo', entity: 'BankTransaction', data: { importId: req.params.importId, removed: count } });
  res.json({ removed: count });
}));

// ───── Transactions ─────

function txnWhere(req) {
  const tz = req.business.timezone;
  const where = { businessId: req.businessId };
  if (req.query.accountId) where.accountId = req.query.accountId;
  if (dateRe.test(req.query.from || '') || dateRe.test(req.query.to || '')) {
    where.date = {};
    if (dateRe.test(req.query.from || '')) where.date.gte = dayRange(req.query.from, tz).start;
    if (dateRe.test(req.query.to || '')) where.date.lt = dayRange(req.query.to, tz).end;
  }
  if (req.query.type === 'credit') where.credit = { gt: 0 };
  if (req.query.type === 'debit') where.debit = { gt: 0 };
  if (req.query.mode) where.mode = req.query.mode;
  if (req.query.q) where.OR = [{ description: { contains: req.query.q, mode: 'insensitive' } }, { reference: { contains: req.query.q, mode: 'insensitive' } }, { category: { contains: req.query.q, mode: 'insensitive' } }];
  return where;
}

router.get('/transactions', view, ah(async (req, res) => {
  const where = txnWhere(req);
  const { page, take, skip } = pageParams(req.query);
  const [transactions, total, sums, byMode] = await Promise.all([
    prisma.bankTransaction.findMany({ where, orderBy: [{ date: 'desc' }, { createdAt: 'desc' }], skip, take, include: { account: { select: { name: true, accountMask: true } } } }),
    prisma.bankTransaction.count({ where }),
    prisma.bankTransaction.aggregate({ where, _sum: { credit: true, debit: true } }),
    prisma.bankTransaction.groupBy({ by: ['mode'], where, _sum: { credit: true, debit: true }, _count: true }),
  ]);
  const credits = round2(n(sums._sum.credit));
  const debits = round2(n(sums._sum.debit));
  res.json({
    transactions, total, page, limit: take, totals: { credits, debits, net: round2(credits - debits) },
    byMode: byMode.map((m) => ({ mode: m.mode || 'OTHER', credits: round2(n(m._sum.credit)), debits: round2(n(m._sum.debit)), count: m._count })).sort((a, b) => b.credits + b.debits - (a.credits + a.debits)),
  });
}));

// Money in and out per month, for the chart.
router.get('/monthly', view, ah(async (req, res) => {
  const where = { businessId: req.businessId, ...(req.query.accountId ? { accountId: req.query.accountId } : {}) };
  const since = new Date();
  since.setUTCMonth(since.getUTCMonth() - 11, 1);
  const rows = await prisma.bankTransaction.findMany({ where: { ...where, date: { gte: since } }, select: { date: true, credit: true, debit: true } });
  const map = {};
  for (const r of rows) {
    const k = r.date.toISOString().slice(0, 7);
    map[k] = map[k] || { month: k, credits: 0, debits: 0 };
    map[k].credits = round2(map[k].credits + n(r.credit));
    map[k].debits = round2(map[k].debits + n(r.debit));
  }
  res.json({ months: Object.values(map).sort((a, b) => a.month.localeCompare(b.month)) });
}));

router.get('/transactions.csv', view, ah(async (req, res) => {
  const rows = await prisma.bankTransaction.findMany({ where: txnWhere(req), orderBy: { date: 'asc' }, take: 20000, include: { account: { select: { name: true } } } });
  const esc = (v) => `"${String(v ?? '').replace(/"/g, '""')}"`;
  const lines = [['Date', 'Account', 'Description', 'Reference', 'Mode', 'Category', 'Debit', 'Credit', 'Balance'].join(',')]
    .concat(rows.map((t) => [t.date.toISOString().slice(0, 10), t.account.name, t.description, t.reference, t.mode, t.category, n(t.debit) || '', n(t.credit) || '', t.balance ?? ''].map(esc).join(',')));
  res.setHeader('Content-Type', 'text/csv; charset=utf-8');
  res.setHeader('Content-Disposition', 'attachment; filename="bank-transactions.csv"');
  res.send(`﻿${lines.join('\n')}`);
}));

router.post('/transactions', manage, validate(z.object({
  accountId: z.string(), date: z.string().regex(dateRe), description: z.string().trim().min(1).max(500), reference: z.string().max(80).nullable().optional(),
  type: z.enum(['credit', 'debit']), amount: z.coerce.number().positive(), category: z.string().max(60).nullable().optional(),
})), ah(async (req, res) => {
  const account = await getAccount(req, req.body.accountId);
  const b = req.body;
  const line = { date: b.date, description: b.description, reference: b.reference || null, debit: b.type === 'debit' ? round2(b.amount) : 0, credit: b.type === 'credit' ? round2(b.amount) : 0, balance: null };
  const transaction = await prisma.bankTransaction.create({
    data: { businessId: req.businessId, accountId: account.id, ...line, date: bank.asDate(b.date), mode: bank.detectMode(b.description), category: b.category || null, source: 'MANUAL', hash: `manual-${crypto.randomUUID()}` },
  });
  res.status(201).json({ transaction });
}));

router.put('/transactions/:id', manage, validate(z.object({ category: z.string().max(60).nullable() })), ah(async (req, res) => {
  const t = await prisma.bankTransaction.findFirst({ where: { id: req.params.id, businessId: req.businessId } });
  if (!t) throw notFound();
  res.json({ transaction: await prisma.bankTransaction.update({ where: { id: t.id }, data: { category: req.body.category } }) });
}));

router.delete('/transactions/:id', manage, ah(async (req, res) => {
  const t = await prisma.bankTransaction.findFirst({ where: { id: req.params.id, businessId: req.businessId } });
  if (!t) throw notFound();
  await prisma.bankTransaction.delete({ where: { id: t.id } });
  res.json({ ok: true });
}));

module.exports = router;
