const router = require('express').Router();
const bcrypt = require('bcryptjs');
const { z } = require('zod');
const { prisma } = require('../lib/prisma');
const { ah, badRequest, unauthorized, conflict } = require('../lib/errors');
const { validate } = require('../middleware/validate');
const { requireAuth, signToken } = require('../middleware/auth');
const { withDefaults } = require('../lib/businessConfig');

const publicUser = (u) => ({ id: u.id, name: u.name, email: u.email, phone: u.phone, isPlatformAdmin: u.isPlatformAdmin, mustChangePassword: u.mustChangePassword });

async function memberships(userId) {
  const rows = await prisma.membership.findMany({
    where: { userId, active: true },
    include: { business: true, role: true },
    orderBy: { createdAt: 'asc' },
  });
  return rows.map((m) => {
    const b = withDefaults(m.business);
    return { businessId: b.id, name: b.name, slug: b.slug, type: b.type, logoUrl: b.logoUrl, theme: b.theme, status: b.status, role: m.role.name };
  });
}

router.post('/register', validate(z.object({
  name: z.string().trim().min(2).max(80),
  email: z.string().trim().email().max(120),
  password: z.string().min(8).max(100),
  phone: z.string().max(20).optional(),
})), ah(async (req, res) => {
  const email = req.body.email.toLowerCase();
  if (await prisma.user.findUnique({ where: { email } })) throw conflict('An account with this email already exists');
  const user = await prisma.user.create({
    data: { name: req.body.name, email, phone: req.body.phone || null, passwordHash: await bcrypt.hash(req.body.password, 12) },
  });
  res.status(201).json({ token: signToken(user), user: publicUser(user), businesses: [] });
}));

router.post('/login', validate(z.object({ email: z.string().trim().email(), password: z.string().min(1) })), ah(async (req, res) => {
  const user = await prisma.user.findUnique({ where: { email: req.body.email.toLowerCase() } });
  if (!user || !user.active || !(await bcrypt.compare(req.body.password, user.passwordHash))) throw unauthorized('Invalid email or password');
  res.json({ token: signToken(user), user: publicUser(user), businesses: await memberships(user.id) });
}));

router.get('/me', requireAuth, ah(async (req, res) => {
  res.json({ user: publicUser(req.user), businesses: await memberships(req.user.id) });
}));

router.put('/me', requireAuth, validate(z.object({
  name: z.string().trim().min(2).max(80).optional(),
  phone: z.string().max(20).optional(),
  currentPassword: z.string().optional(),
  newPassword: z.string().min(8).max(100).optional(),
})), ah(async (req, res) => {
  const data = {};
  if (req.body.name) data.name = req.body.name;
  if (req.body.phone !== undefined) data.phone = req.body.phone;
  if (req.body.newPassword) {
    if (!req.body.currentPassword || !(await bcrypt.compare(req.body.currentPassword, req.user.passwordHash))) throw badRequest('Current password is incorrect');
    if (await bcrypt.compare(req.body.newPassword, req.user.passwordHash)) throw badRequest('Choose a password different from the temporary one');
    data.passwordHash = await bcrypt.hash(req.body.newPassword, 12);
    data.mustChangePassword = false;
  }
  const user = await prisma.user.update({ where: { id: req.user.id }, data });
  res.json({ user: publicUser(user) });
}));

module.exports = router;
