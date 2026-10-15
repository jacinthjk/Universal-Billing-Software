// Sends a generated daily report to the configured recipients (WhatsApp: image + Excel by default)
// through the business's WhatsApp provider (linked number or Cloud API), and records every attempt
// in ReportDelivery.
const { prisma } = require('../lib/prisma');
const storage = require('../lib/storage');
const { notify } = require('../lib/audit');
const { money } = require('../lib/util');
const messaging = require('./messaging');
const { reportPath } = require('./dailyReport');

const { toWhatsAppNumber, maskNumber } = messaging;
const XLSX_MIME = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
const MAX_AUTO_ATTEMPTS = 3;
const RETRY_GAP_MS = 10 * 60 * 1000;

/**
 * Delivers one daily report. trigger: 'SCHEDULE' (cron) or 'MANUAL' (Send now).
 * Returns [{ recipient, status, error }].
 */
async function deliverDailyReport(business, report, { trigger = 'SCHEDULE', recipients } = {}) {
  const cfg = business.settings.reportDelivery;
  const to = (recipients || cfg.recipients || []).map((r) => toWhatsAppNumber(r, cfg.countryCode)).filter((r) => r.length >= 10);
  const formats = cfg.formats?.length ? cfg.formats : ['image', 'excel'];
  const results = [];
  if (!to.length) return results;

  const label = `${business.name} · Daily report ${report.date}`;
  const net = report.data?.sales ? money(report.data.sales.net, business.currency) : '';
  const message = { text: `${label}${net ? ` · Net sales ${net}` : ''}`, template: true };
  if (formats.includes('image')) message.image = { buffer: await storage.get(reportPath(business.id, report.date, 'png')), filename: `${business.slug}-report-${report.date}.png`, mime: 'image/png' };
  if (formats.includes('excel')) message.document = { buffer: await storage.get(reportPath(business.id, report.date, 'xlsx')), filename: `${business.slug}-report-${report.date}.xlsx`, mime: XLSX_MIME, caption: label };

  for (const recipient of to) {
    const r = await messaging.send(business, { ...message, to: recipient }, { kind: 'REPORT', refId: report.id });
    // ReportDelivery keeps its original status name for "no WhatsApp set up".
    const status = r.status === 'NOT_CONNECTED' ? 'NOT_CONFIGURED' : r.status;
    await prisma.reportDelivery.create({
      data: { businessId: business.id, reportId: report.id, date: report.date, channel: 'WHATSAPP', recipient, formats, status, error: r.error, trigger },
    });
    results.push({ recipient: maskNumber(recipient), status, error: r.error });
  }

  const failed = results.filter((r) => r.status !== 'SENT');
  if (failed.length) {
    await notify(business.id, { type: 'REPORT', title: `Daily report not delivered · ${report.date}`, body: failed[0].error, link: '/reports?tab=daily' });
  }
  return results;
}

/** Should the scheduler (re)try delivery to this recipient for this date? */
async function needsDelivery(business, date, recipient) {
  const attempts = await prisma.reportDelivery.findMany({
    where: { businessId: business.id, date, recipient, trigger: 'SCHEDULE' },
    orderBy: { createdAt: 'desc' },
    select: { status: true, createdAt: true },
  });
  if (attempts.some((a) => a.status === 'SENT')) return false;
  // Not set up yet: log it once per day; if WhatsApp gets connected later that day, delivery still happens.
  if (!messaging.isReady(business)) return !attempts.some((a) => a.status === 'NOT_CONFIGURED');
  const failures = attempts.filter((a) => a.status === 'FAILED');
  if (failures.length >= MAX_AUTO_ATTEMPTS) return false;
  return !failures.length || Date.now() - failures[0].createdAt.getTime() > RETRY_GAP_MS;
}

module.exports = { deliverDailyReport, needsDelivery, toWhatsAppNumber, maskNumber };
