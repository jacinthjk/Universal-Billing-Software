const config = require('./config');
const app = require('./app');
const { prisma } = require('./lib/prisma');
const { startScheduler } = require('./services/scheduler');
const messaging = require('./services/messaging');

const server = app.listen(config.port, () => {
  console.log(`API listening on http://localhost:${config.port}`);
  if (process.env.DISABLE_SCHEDULER !== '1') startScheduler();
  // Linked WhatsApp numbers reconnect by themselves; set DISABLE_WHATSAPP=1 on extra instances (one session per number).
  if (process.env.DISABLE_WHATSAPP !== '1') messaging.resumeAll().catch((e) => console.error('[whatsapp] resume failed', e.message));
});

async function shutdown() {
  server.close();
  await prisma.$disconnect();
  process.exit(0);
}
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
