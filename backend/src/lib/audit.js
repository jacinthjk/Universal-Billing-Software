const { prisma } = require('./prisma');

// Append-only audit trail. Accepts a transaction client so the log commits with the change.
async function audit({ businessId, userId = null, actor = 'USER', action, entity, entityId = null, data = null }, db = prisma) {
  try {
    await db.auditLog.create({ data: { businessId, userId, actor, action, entity, entityId, data } });
  } catch (e) {
    console.error('audit log failed', e.message);
  }
}

async function notify(businessId, { type, title, body = null, link = null }, db = prisma) {
  try {
    await db.notification.create({ data: { businessId, type, title, body, link } });
  } catch (e) {
    console.error('notification failed', e.message);
  }
}

module.exports = { audit, notify };
