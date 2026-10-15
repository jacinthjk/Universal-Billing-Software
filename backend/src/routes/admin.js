// Platform administration (SaaS level). Platform admins manage tenants, not business transactions.
const router = require('express').Router();
const { z } = require('zod');
const { prisma } = require('../lib/prisma');
const { ah, forbidden, notFound } = require('../lib/errors');
const { validate } = require('../middleware/validate');
const { audit } = require('../lib/audit');

router.use((req, res, next) => (req.user.isPlatformAdmin ? next() : next(forbidden('Platform admin only'))));

router.get('/businesses', ah(async (req, res) => {
  const businesses = await prisma.business.findMany({
    orderBy: { createdAt: 'desc' },
    select: { id: true, name: true, slug: true, type: true, status: true, plan: true, createdAt: true, _count: { select: { memberships: true, sales: true, products: true } } },
  });
  res.json({ businesses });
}));

// Suspend / reactivate a tenant without deleting any data; change plan.
router.patch('/businesses/:id', validate(z.object({ status: z.enum(['ACTIVE', 'SUSPENDED']).optional(), plan: z.string().max(30).optional() })), ah(async (req, res) => {
  const b = await prisma.business.findUnique({ where: { id: req.params.id } });
  if (!b) throw notFound();
  const updated = await prisma.business.update({ where: { id: b.id }, data: req.body });
  await audit({ businessId: b.id, userId: req.user.id, actor: 'PLATFORM', action: 'business.admin_update', entity: 'Business', entityId: b.id, data: req.body });
  res.json({ business: updated });
}));

module.exports = router;
