const router = require('express').Router();
const { z } = require('zod');
const { prisma } = require('../lib/prisma');
const { ah, notFound, badRequest } = require('../lib/errors');
const { validate } = require('../middleware/validate');
const { requirePerm } = require('../middleware/tenant');
const { todayIn, addDays, dayRange, n } = require('../lib/util');
const storage = require('../lib/storage');
const { rangeMetrics, dailyMetrics, aiSummary, dashboardExtras } = require('../services/reports');
const { generateDailyReport, reportPath } = require('../services/dailyReport');
const { overviewExport, buildWorkbook } = require('../services/reportExports');
const { deliverDailyReport, maskNumber } = require('../services/reportDelivery');
const messaging = require('../services/messaging');

const MIME = { png: 'image/png', pdf: 'application/pdf', xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' };
const { audit } = require('../lib/audit');

const dateRe = /^\d{4}-\d{2}-\d{2}$/;

function range(req) {
  const tz = req.business.timezone;
  const to = dateRe.test(req.query.to || '') ? req.query.to : todayIn(tz);
  const from = dateRe.test(req.query.from || '') ? req.query.from : addDays(to, -29);
  if (from > to) throw badRequest('Invalid date range');
  return { from, to };
}

// Operational dashboard: today's KPIs, 14-day trend, queues needing attention.
router.get('/dashboard', requirePerm('dashboard.view'), ah(async (req, res) => {
  const today = todayIn(req.business.timezone);
  const m = await dailyMetrics(req.business, today);
  const [followupsDue, recentSales, notifications, extras] = await Promise.all([
    prisma.enquiry.findMany({ where: { businessId: req.businessId, status: { notIn: ['CONVERTED', 'CLOSED'] }, followUpAt: { lte: dayRange(today, req.business.timezone).end } }, orderBy: { followUpAt: 'asc' }, take: 8 }),
    req.can('sales.view') ? prisma.sale.findMany({ where: { businessId: req.businessId }, orderBy: { createdAt: 'desc' }, take: 8, include: { customer: { select: { name: true } } } }) : [],
    prisma.notification.findMany({ where: { businessId: req.businessId }, orderBy: { createdAt: 'desc' }, take: 10 }),
    dashboardExtras(req.business, today),
  ]);
  // Business-type spotlight cards only show what this person is allowed to see.
  if (!req.can('sales.view')) delete extras.dues;
  if (!req.can('customers.view')) delete extras.topCustomers;
  if (!req.can('products.view_cost')) delete m.stock.value;
  if (!req.can('reports.view')) {
    // Operational staff see counts, not revenue breakdowns.
    delete m.purchases;
    delete m.prevSales;
  }
  res.json({ metrics: m, followupsDue, recentSales, notifications, extras });
}));

router.get('/summary', requirePerm('reports.view'), ah(async (req, res) => {
  const { from, to } = range(req);
  const m = await rangeMetrics(req.business, from, to);
  if (!req.can('products.view_cost')) delete m.margin;
  res.json(m);
}));

router.get('/ai', requirePerm('reports.view', 'ai.manage'), ah(async (req, res) => {
  const { from, to } = range(req);
  const tz = req.business.timezone;
  const start = dayRange(from, tz).start;
  const end = dayRange(to, tz).end;
  const [summary, sources] = await Promise.all([
    aiSummary(req.businessId, start, end),
    prisma.enquiry.groupBy({ by: ['source', 'status'], where: { businessId: req.businessId, createdAt: { gte: start, lt: end } }, _count: true }),
  ]);
  const bySource = {};
  for (const r of sources) {
    bySource[r.source] = bySource[r.source] || { source: r.source, leads: 0, converted: 0 };
    bySource[r.source].leads += r._count;
    if (r.status === 'CONVERTED') bySource[r.source].converted += r._count;
  }
  res.json({ from, to, ...summary, sources: Object.values(bySource) });
}));

router.get('/export/sales.csv', requirePerm('reports.export'), ah(async (req, res) => {
  const { from, to } = range(req);
  const tz = req.business.timezone;
  const sales = await prisma.sale.findMany({
    where: { businessId: req.businessId, createdAt: { gte: dayRange(from, tz).start, lt: dayRange(to, tz).end } },
    include: { customer: { select: { name: true, phone: true } }, payments: true }, orderBy: { createdAt: 'asc' },
  });
  const esc = (v) => `"${String(v ?? '').replace(/"/g, '""')}"`;
  const header = ['Invoice', 'Date', 'Customer', 'Phone', 'Channel', 'Status', 'Subtotal', 'Discount', 'Tax', 'Total', 'Paid', 'Payment status', 'Methods', 'Customer status', 'Visit #'];
  const rows = sales.map((s) => [s.number, s.createdAt.toISOString(), s.customer?.name, s.customer?.phone, s.channel, s.status, n(s.subtotal), n(s.discount), n(s.tax), n(s.total), n(s.paidAmount), s.paymentStatus, s.payments.map((p) => p.method).join('|'), s.customerStatus, s.visitNumber].map(esc).join(','));
  await audit({ businessId: req.businessId, userId: req.user.id, action: 'report.export', entity: 'Sale', data: { from, to } });
  res.setHeader('Content-Type', 'text/csv');
  res.setHeader('Content-Disposition', `attachment; filename="sales-${from}-to-${to}.csv"`);
  res.send([header.join(','), ...rows].join('\n'));
}));

// ───── Daily visual reports ─────

// Overview report for a date range as an image, PDF (visual + tables) or Excel workbook.
router.get('/overview.:format', requirePerm('reports.view'), ah(async (req, res) => {
  const format = req.params.format;
  if (!MIME[format]) throw notFound();
  const { from, to } = range(req);
  const out = await overviewExport(req.business, from, to, format, { includeCost: req.can('products.view_cost') });
  await audit({ businessId: req.businessId, userId: req.user.id, action: 'report.export', entity: 'Report', data: { report: 'overview', format, from, to } });
  res.setHeader('Content-Type', out.mime);
  res.setHeader('Content-Disposition', `${req.query.download ? 'attachment' : 'inline'}; filename="${out.filename}"`);
  res.send(out.buffer);
}));

router.get('/daily', requirePerm('reports.view'), ah(async (req, res) => {
  const reports = await prisma.dailyReport.findMany({ where: { businessId: req.businessId }, orderBy: { date: 'desc' }, take: 60, select: { id: true, date: true, pdfPath: true, createdAt: true } });
  const s = req.business.settings;
  res.json({
    reports,
    settings: { time: s.reportTime, enabled: s.reportEnabled, delivery: s.reportDelivery },
    whatsapp: { configured: messaging.isReady(req.business), provider: messaging.providerOf(req.business), templates: !!(require('../config').whatsapp.imageTemplate) },
  });
}));

router.post('/daily/generate', requirePerm('reports.view'), validate(z.object({ date: z.string().regex(dateRe).optional() })), ah(async (req, res) => {
  const report = await generateDailyReport(req.business, req.body.date || todayIn(req.business.timezone));
  res.status(201).json({ report: { id: report.id, date: report.date, createdAt: report.createdAt } });
}));

// Send a daily report to the configured recipients now (e.g. to test WhatsApp delivery).
router.post('/daily/:id/send', requirePerm('settings.manage', 'reports.export'), ah(async (req, res) => {
  const r = await prisma.dailyReport.findFirst({ where: { id: req.params.id, businessId: req.businessId } });
  if (!r) throw notFound();
  if (!req.business.settings.reportDelivery?.recipients?.length) throw badRequest('Add a recipient mobile number in the delivery settings first');
  const results = await deliverDailyReport(req.business, r, { trigger: 'MANUAL' });
  await audit({ businessId: req.businessId, userId: req.user.id, action: 'report.send', entity: 'Report', entityId: r.id, data: { results } });
  res.json({ results });
}));

router.get('/deliveries', requirePerm('reports.view'), ah(async (req, res) => {
  const rows = await prisma.reportDelivery.findMany({ where: { businessId: req.businessId }, orderBy: { createdAt: 'desc' }, take: 30 });
  res.json({ deliveries: rows.map((d) => ({ ...d, recipient: maskNumber(d.recipient) })) });
}));

router.get('/daily/:id/:kind', requirePerm('reports.view'), ah(async (req, res) => {
  const r = await prisma.dailyReport.findFirst({ where: { id: req.params.id, businessId: req.businessId } });
  if (!r) throw notFound();
  const kind = MIME[req.params.kind] ? req.params.kind : 'png';
  const key = reportPath(req.businessId, r.date, kind);
  let buffer;
  if (storage.exists(key)) buffer = await storage.get(key);
  else if (kind === 'xlsx') buffer = await buildWorkbook(req.business, r.data, { variant: 'daily' }); // older reports: rebuild from stored figures
  else throw notFound('Report file missing - regenerate it');
  res.setHeader('Content-Type', MIME[kind]);
  res.setHeader('Content-Disposition', `${req.query.download ? 'attachment' : 'inline'}; filename="${req.business.slug}-daily-report-${r.date}.${kind}"`);
  res.send(buffer);
}));

// ───── Notifications ─────

router.get('/notifications', ah(async (req, res) => {
  const [items, unread] = await Promise.all([
    prisma.notification.findMany({ where: { businessId: req.businessId }, orderBy: { createdAt: 'desc' }, take: 30 }),
    prisma.notification.count({ where: { businessId: req.businessId, read: false } }),
  ]);
  res.json({ items, unread });
}));

router.post('/notifications/read', ah(async (req, res) => {
  await prisma.notification.updateMany({ where: { businessId: req.businessId, read: false }, data: { read: true } });
  res.json({ ok: true });
}));

module.exports = router;
