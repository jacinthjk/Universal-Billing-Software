const { prisma } = require('../lib/prisma');
const { forbidden, badRequest } = require('../lib/errors');
const { has } = require('../lib/permissions');
const { withDefaults } = require('../lib/businessConfig');

// Resolves the active business from the X-Business-Id header and verifies the user is an
// active member. Every business-scoped route reads req.businessId from here - never from the body.
async function requireBusiness(req, res, next) {
  try {
    const businessId = req.headers['x-business-id'];
    if (!businessId) throw badRequest('No active business selected');
    const membership = await prisma.membership.findUnique({
      where: { userId_businessId: { userId: req.user.id, businessId } },
      include: { role: true, business: true },
    });
    if (!membership || !membership.active) throw forbidden('You do not have access to this business');
    if (membership.business.status === 'SUSPENDED') throw forbidden('This business account is suspended');
    req.businessId = businessId;
    req.business = withDefaults(membership.business);
    req.membership = membership;
    req.perms = membership.role.permissions;
    req.can = (p) => has(req.perms, p);
    // Role preview: someone who manages users can see the portal exactly as another role does.
    // The server applies that role's permissions, and nothing can be changed while previewing.
    const previewId = req.headers['x-preview-role'];
    if (previewId && req.can('users.manage')) {
      const role = await prisma.role.findFirst({ where: { id: String(previewId), businessId } });
      if (!role) throw badRequest('That role no longer exists');
      if (!['GET', 'HEAD'].includes(req.method)) throw forbidden(`Preview mode is read-only. Exit the ${role.name} preview to make changes.`);
      req.preview = { roleId: role.id, roleName: role.name };
      req.perms = role.permissions;
      req.can = (p) => has(req.perms, p);
    }
    next();
  } catch (e) {
    next(e);
  }
}

// Route guard: user must hold at least one of the listed permissions.
const requirePerm = (...perms) => (req, res, next) => {
  if (perms.some((p) => req.can(p))) return next();
  next(forbidden());
};

// Route guard: module must be enabled for the business.
const requireModule = (mod) => (req, res, next) => {
  if (req.business.settings.modules.includes(mod)) return next();
  next(forbidden(`The ${mod} module is not enabled for this business`));
};

module.exports = { requireBusiness, requirePerm, requireModule };
