// Automated daily report: a spreadsheet-style PNG (easy to read on WhatsApp) + PDF and Excel files.
const { prisma } = require('../lib/prisma');
const storage = require('../lib/storage');
const { svgToPng } = require('../lib/svg');
const { money, todayIn } = require('../lib/util');
const { dailyMetrics, outstandingReport } = require('./reports');
const { notify } = require('../lib/audit');
const { renderSheetSvg } = require('./reportSheet');

/** Report image as SVG (drawn like the Excel Summary sheet). variant 'daily' | 'overview'. */
async function renderReportSvg(business, m, generatedAt, opts = {}) {
  return renderSheetSvg(business, m, generatedAt, opts);
}

// Stored report files: private/<businessId>/reports/<date>.<png|pdf|xlsx>
const reportPath = (businessId, date, ext) => `private/${businessId}/reports/${date}.${ext}`;

/** Computes, renders and stores the daily report for a business/date (idempotent per date). */
async function generateDailyReport(business, date = todayIn(business.timezone)) {
  const metrics = await dailyMetrics(business, date);
  const generatedAt = new Intl.DateTimeFormat('en-IN', { timeZone: business.timezone, dateStyle: 'medium', timeStyle: 'short' }).format(new Date());
  // Unpaid bills with outstanding days go into the image, PDF and Excel files (not the stored figures).
  const files = { ...metrics, outstanding: await outstandingReport(business) };
  const png = svgToPng(await renderReportSvg(business, files, generatedAt));
  // Loaded here to avoid a circular import (reportExports reuses this module's renderer).
  const { buildPdf, buildWorkbook } = require('./reportExports');
  const pngPath = reportPath(business.id, date, 'png');
  const pdfPath = reportPath(business.id, date, 'pdf');
  await storage.put(pngPath, png);
  await storage.put(pdfPath, await buildPdf(business, files, png, { variant: 'daily' }));
  await storage.put(reportPath(business.id, date, 'xlsx'), await buildWorkbook(business, files, { variant: 'daily' }));
  const report = await prisma.dailyReport.upsert({
    where: { businessId_date: { businessId: business.id, date } },
    create: { businessId: business.id, date, pngPath, pdfPath, data: metrics },
    update: { pngPath, pdfPath, data: metrics, createdAt: new Date() },
  });
  await notify(business.id, { type: 'REPORT', title: `Daily report ready · ${date}`, body: `Net sales ${money(metrics.sales.net, business.currency)} from ${metrics.sales.bills} bills`, link: `/reports?tab=daily` });
  return report;
}

module.exports = { generateDailyReport, renderReportSvg, reportPath };
