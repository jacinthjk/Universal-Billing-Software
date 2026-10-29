const router = require('express').Router();
const crypto = require('crypto');
const bcrypt = require('bcryptjs');
const { z } = require('zod');
const { prisma } = require('../lib/prisma');
const { ah, badRequest, notFound, conflict, forbidden } = require('../lib/errors');
const { validate } = require('../middleware/validate');
const { requirePerm } = require('../middleware/tenant');
const { ALL } = require('../lib/permissions');
const { audit } = require('../lib/audit');
const config = require('../config');
const messaging = require('../services/messaging');

const tempPasswordFor = () => crypto.randomBytes(6).toString('base64url');

// WhatsApp message carrying a temporary password and where to log in.
const passwordMessage = (business, user, password, isNew) => [
  `Hello ${user.name},`,
  '',
  isNew ? `You have been added to *${business.name}* on the billing portal.` : `Your password for *${business.name}* on the billing portal has been reset.`,
  '',
  `Login: ${config.publicAppUrl}/login`,
  `Email: ${user.email}`,
  `Temporary password: ${password}`,
  '',
  'You will be asked to choose your own password after logging in.',
].join('\n');

async function sendPassword(req, user, password, isNew) {
  if (!user.phone) return { status: 'NO_PHONE' };
  if (!messaging.isReady(req.business)) return { status: 'NOT_CONNECTED' };
  const r = await messaging.send(req.business, { to: user.phone, text: passwordMessage(req.business, user, password, isNew) }, { kind: 'PASSWORD', userId: req.user.id, name: user.name });
  return { status: r.status, to: r.recipient, error: r.error };
}

router.use(requirePerm('users.manage'));

router.get('/', ah(async (req, res) => {
  const [members, roles] = await Promise.all([
    prisma.membership.findMany({ where: { businessId: req.businessId }, include: { user: { select: { id: true, name: true, email: true, phone: true, mustChangePassword: true } }, role: true }, orderBy: { createdAt: 'asc' } }),
    prisma.role.findMany({ where: { businessId: req.businessId }, orderBy: { createdAt: 'asc' } }),
  ]);
  res.json({ members, roles, whatsappReady: messaging.isReady(req.business) });
}));

// Add a user to this business. Creates the platform account with a temporary password if needed.
router.post('/', validate(z.object({ name: z.string().trim().min(2), email: z.string().trim().email(), phone: z.string().trim().max(20).optional(), roleId: z.string(), sendWhatsApp: z.boolean().optional() })), ah(async (req, res) => {
  const role = await prisma.role.findFirst({ where: { id: req.body.roleId, businessId: req.businessId } });
  if (!role) throw badRequest('Invalid role');
  const email = req.body.email.toLowerCase();
  let user = await prisma.user.findUnique({ where: { email } });
  let tempPassword = null;
  if (!user) {
    tempPassword = tempPasswordFor();
    user = await prisma.user.create({ data: { name: req.body.name, email, phone: req.body.phone || null, passwordHash: await bcrypt.hash(tempPassword, 12), mustChangePassword: true } });
  }
  const existing = await prisma.membership.findUnique({ where: { userId_businessId: { userId: user.id, businessId: req.businessId } } });
  if (existing) throw conflict('This user is already a member of the business');
  const m = await prisma.membership.create({ data: { userId: user.id, businessId: req.businessId, roleId: role.id } });
  await audit({ businessId: req.businessId, userId: req.user.id, action: 'team.add', entity: 'Membership', entityId: m.id, data: { email, role: role.name } });
  const delivery = tempPassword && req.body.sendWhatsApp ? await sendPassword(req, user, tempPassword, true) : null;
  res.status(201).json({ membership: m, tempPassword, delivery });
}));

// Owner only: issue a new temporary password for a member and optionally send it on WhatsApp.
// Refused for accounts that also belong to other businesses (or the platform admin), so one
// business owner can never take over a login another business depends on.
router.post('/:id/reset-password', validate(z.object({ phone: z.string().trim().max(20).optional(), sendWhatsApp: z.boolean().optional() })), ah(async (req, res) => {
  if (req.membership.role.name !== 'Owner') throw forbidden('Only the business owner can reset passwords');
  const m = await prisma.membership.findFirst({ where: { id: req.params.id, businessId: req.businessId }, include: { user: true, role: true } });
  if (!m) throw notFound();
  if (m.userId === req.user.id) throw badRequest('Change your own password from your profile instead');
  if (m.role.name === 'Owner') throw badRequest('Another owner\'s password cannot be reset here');
  if (m.user.isPlatformAdmin) throw badRequest('This account is managed by the platform administrator');
  const others = await prisma.membership.count({ where: { userId: m.userId, businessId: { not: req.businessId } } });
  if (others) throw badRequest('This person also uses the portal for another business, so only they can change their password');
  const tempPassword = tempPasswordFor();
  const user = await prisma.user.update({
    where: { id: m.userId },
    data: { passwordHash: await bcrypt.hash(tempPassword, 12), mustChangePassword: true, ...(req.body.phone ? { phone: req.body.phone } : {}) },
  });
  const delivery = req.body.sendWhatsApp ? await sendPassword(req, user, tempPassword, false) : null;
  await audit({ businessId: req.businessId, userId: req.user.id, action: 'team.password_reset', entity: 'Membership', entityId: m.id, data: { email: user.email, whatsapp: delivery?.status || 'NOT_SENT' } });
  res.json({ tempPassword, delivery, user: { name: user.name, email: user.email, phone: user.phone } });
}));

router.patch('/:id', validate(z.object({ roleId: z.string().optional(), active: z.boolean().optional() })), ah(async (req, res) => {
  const m = await prisma.membership.findFirst({ where: { id: req.params.id, businessId: req.businessId }, include: { role: true } });
  if (!m) throw notFound();
  if (m.userId === req.user.id) throw badRequest('You cannot change your own access');
  if (req.body.roleId) {
    const role = await prisma.role.findFirst({ where: { id: req.body.roleId, businessId: req.businessId } });
    if (!role) throw badRequest('Invalid role');
  }
  const updated = await prisma.membership.update({ where: { id: m.id }, data: req.body });
  await audit({ businessId: req.businessId, userId: req.user.id, action: 'team.update', entity: 'Membership', entityId: m.id, data: req.body });
  res.json({ membership: updated });
}));

const roleSchema = z.object({ name: z.string().trim().min(2).max(40), permissions: z.array(z.enum(ALL)) });

router.post('/roles', validate(roleSchema), ah(async (req, res) => {
  const role = await prisma.role.create({ data: { businessId: req.businessId, name: req.body.name, permissions: req.body.permissions } }).catch(() => { throw conflict('A role with this name exists'); });
  res.status(201).json({ role });
}));

router.put('/roles/:id', validate(roleSchema), ah(async (req, res) => {
  const role = await prisma.role.findFirst({ where: { id: req.params.id, businessId: req.businessId } });
  if (!role) throw notFound();
  if (role.name === 'Owner') throw badRequest('The Owner role cannot be modified');
  const updated = await prisma.role.update({ where: { id: role.id }, data: req.body });
  await audit({ businessId: req.businessId, userId: req.user.id, action: 'role.update', entity: 'Role', entityId: role.id, data: req.body });
  res.json({ role: updated });
}));

router.delete('/roles/:id', ah(async (req, res) => {
  const role = await prisma.role.findFirst({ where: { id: req.params.id, businessId: req.businessId }, include: { _count: { select: { memberships: true } } } });
  if (!role) throw notFound();
  if (role.isSystem) throw badRequest('System roles cannot be deleted');
  if (role._count.memberships) throw badRequest('Reassign members before deleting this role');
  await prisma.role.delete({ where: { id: role.id } });
  res.json({ ok: true });
}));

router.get('/audit', ah(async (req, res) => {
  const logs = await prisma.auditLog.findMany({ where: { businessId: req.businessId }, orderBy: { createdAt: 'desc' }, take: 200 });
  const users = await prisma.user.findMany({ where: { id: { in: [...new Set(logs.map((l) => l.userId).filter(Boolean))] } }, select: { id: true, name: true } });
  const names = Object.fromEntries(users.map((u) => [u.id, u.name]));
  res.json({ logs: logs.map((l) => ({ ...l, userName: l.actor === 'AI' ? 'AI assistant' : names[l.userId] || l.actor })) });
}));

module.exports = router;
