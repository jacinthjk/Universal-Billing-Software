// Cron worker (every minute). Once a business's report time has arrived (in its own timezone):
//  1. make sure today's daily report exists and was generated at/after that time (so it covers the
//     whole trading day even if someone generated it manually earlier), then
//  2. deliver it to the configured recipients who haven't received it yet (WhatsApp image + Excel).
const cron = require('node-cron');
const { prisma } = require('../lib/prisma');
const { withDefaults } = require('../lib/businessConfig');
const { todayIn, timeIn, dayRange } = require('../lib/util');
const { generateDailyReport } = require('./dailyReport');
const { deliverDailyReport, needsDelivery, toWhatsAppNumber } = require('./reportDelivery');

let running = false;

function scheduledAt(date, time, timeZone) {
  const [h, m] = time.split(':').map(Number);
  return new Date(dayRange(date, timeZone).start.getTime() + (h * 60 + m) * 60000);
}

async function runForBusiness(b) {
  if (!b.settings.reportEnabled) return;
  if (timeIn(b.timezone) < b.settings.reportTime) return;
  const date = todayIn(b.timezone);
  let report = await prisma.dailyReport.findUnique({ where: { businessId_date: { businessId: b.id, date } } });
  if (!report || report.createdAt < scheduledAt(date, b.settings.reportTime, b.timezone)) {
    report = await generateDailyReport(b, date);
    console.log(`[scheduler] daily report generated for ${b.slug} ${date}`);
  }

  const cfg = b.settings.reportDelivery;
  if (!cfg?.enabled || !cfg.recipients?.length) return;
  const pending = [];
  for (const r of cfg.recipients) {
    if (await needsDelivery(b, date, toWhatsAppNumber(r, cfg.countryCode))) pending.push(r);
  }
  if (!pending.length) return;
  const results = await deliverDailyReport(b, report, { trigger: 'SCHEDULE', recipients: pending });
  console.log(`[scheduler] report delivery for ${b.slug} ${date}:`, results.map((x) => `${x.recipient} ${x.status}`).join(', '));
}

async function tick() {
  if (running) return;
  running = true;
  try {
    const businesses = await prisma.business.findMany({ where: { status: 'ACTIVE' } });
    for (const raw of businesses) {
      const b = withDefaults(raw);
      try {
        await runForBusiness(b);
      } catch (e) {
        console.error(`[scheduler] ${b.slug}:`, e.message);
      }
    }
  } catch (e) {
    console.error('[scheduler] tick failed', e.message);
  } finally {
    running = false;
  }
}

function startScheduler() {
  cron.schedule('* * * * *', tick);
  console.log('[scheduler] daily report scheduler started');
}

module.exports = { startScheduler, tick, runForBusiness };
