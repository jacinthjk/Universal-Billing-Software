const router = require('express').Router();
const crypto = require('crypto');
const bcrypt = require('bcryptjs');
const { z } = require('zod');
const { prisma } = require('../lib/prisma');
const { ah, badRequest, notFound, conflict } = require('../lib/errors');
const { validate } = require('../middleware/validate');
const { requirePerm } = require('../middleware/tenant');
const { ALL } = require('../lib/permissions');
const { audit } = require('../lib/audit');

router.use(requirePerm('users.manage'));

router.get('/', ah(async (req, res) => {
  const [members, roles] = await Promise.all([
    prisma.membership.findMany({ where: { businessId: req.businessId }, include: { user: { select: { id: true, name: true, email: true, phone: true } }, role: true }, orderBy: { createdAt: 'asc' } }),
    prisma.role.findMany({ where: { businessId: req.businessId }, orderBy: { createdAt: 'asc' } }),
  ]);
  res.json({ members, roles });
}));

// Add a user to this business. Creates the platform account with a temporary password if needed.
router.post('/', validate(z.object({ name: z.string().trim().min(2), email: z.string().trim().email(), roleId: z.string() })), ah(async (req, res) => {
  const role = await prisma.role.findFirst({ where: { id: req.body.roleId, businessId: req.businessId } });
  if (!role) throw badRequest('Invalid role');
  const email = req.body.email.toLowerCase();
  let user = await prisma.user.findUnique({ where: { email } });
  let tempPassword = null;
  if (!user) {
    tempPassword = crypto.randomBytes(6).toString('base64url');
    user = await prisma.user.create({ data: { name: req.body.name, email, passwordHash: await bcrypt.hash(tempPassword, 12) } });
  }
  const existing = await prisma.membership.findUnique({ where: { userId_businessId: { userId: user.id, businessId: req.businessId } } });
  if (existing) throw conflict('This user is already a member of the business');
  const m = await prisma.membership.create({ data: { userId: user.id, businessId: req.businessId, roleId: role.id } });
  await audit({ businessId: req.businessId, userId: req.user.id, action: 'team.add', entity: 'Membership', entityId: m.id, data: { email, role: role.name } });
  res.status(201).json({ membership: m, tempPassword });
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
