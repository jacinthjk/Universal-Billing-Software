const router = require('express').Router();
const { z } = require('zod');
const multer = require('multer');
const bcrypt = require('bcryptjs');
const { setBillPasscode } = require('../lib/passcode');
const { prisma } = require('../lib/prisma');
const { ah, badRequest, conflict, forbidden } = require('../lib/errors');
const { validate } = require('../middleware/validate');
const { requireBusiness, requirePerm } = require('../middleware/tenant');
const { THEMES, FONTS, BUSINESS_TYPES, MODULES, LATER_MODULES } = require('../lib/presets');
const { PERMISSIONS, SYSTEM_ROLES } = require('../lib/permissions');
const { withDefaults, deepMerge } = require('../lib/businessConfig');
const { slugify } = require('../lib/util');
const { audit } = require('../lib/audit');
const storage = require('../lib/storage');
const config = require('../config');

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 2 * 1024 * 1024 },
  fileFilter: (req, file, cb) => cb(null, /^image\/(png|jpe?g|webp)$/.test(file.mimetype)),
});

router.get('/meta', (req, res) => {
  res.json({
    themes: THEMES, fonts: FONTS, modules: MODULES, permissions: PERMISSIONS,
    businessTypes: Object.fromEntries(Object.entries(BUSINESS_TYPES).map(([k, v]) => [k, { label: v.label, theme: v.theme, fields: v.fields }])),
    aiModels: ['claude-opus-5-5', 'claude-sonnet-5-5', 'claude-haiku-4-5'],
  });
});

async function uniqueSlug(base) {
  let slug = slugify(base) || 'store';
  for (let i = 0; i < 50; i += 1) {
    const candidate = i ? `${slug}-${i + 1}` : slug;
    if (!(await prisma.business.findUnique({ where: { slug: candidate } }))) return candidate;
  }
  return `${slug}-${Date.now().toString(36)}`;
}

const RESERVED_SLUGS = new Set(['api', 'admin', 'app', 'www', 'login', 'register', 'verify', 'files', 's']);

// Business creation wizard - no developer intervention required.
router.post('/', validate(z.object({
  name: z.string().trim().min(2).max(100),
  type: z.enum(Object.keys(BUSINESS_TYPES)),
  themeKey: z.string().optional(),
  slug: z.string().trim().max(60).optional(),
  phone: z.string().max(20).optional(),
  email: z.string().email().optional().or(z.literal('')),
  address: z.string().max(300).optional(),
  city: z.string().max(80).optional(),
  taxId: z.string().max(30).optional(),
  currency: z.string().length(3).default('INR'),
  timezone: z.string().default('Asia/Kolkata'),
  primaryColor: z.string().regex(/^#[0-9a-fA-F]{6}$/).optional(),
})), ah(async (req, res) => {
  const b = req.body;
  let slug = b.slug ? slugify(b.slug) : await uniqueSlug(b.name);
  if (RESERVED_SLUGS.has(slug)) throw badRequest('That web address is reserved');
  if (b.slug && (await prisma.business.findUnique({ where: { slug } }))) throw conflict('That web address is already taken');
  try {
    Intl.DateTimeFormat('en', { timeZone: b.timezone });
  } catch {
    throw badRequest('Invalid timezone');
  }
  const typeCfg = BUSINESS_TYPES[b.type];
  const theme = { ...THEMES[b.themeKey && THEMES[b.themeKey] ? b.themeKey : typeCfg.theme], key: b.themeKey || typeCfg.theme };
  if (b.primaryColor) theme.primary = b.primaryColor;

  const business = await prisma.$transaction(async (tx) => {
    const created = await tx.business.create({
      data: {
        name: b.name, slug, type: b.type, phone: b.phone || null, email: b.email || null, address: b.address || null,
        city: b.city || null, taxId: b.taxId || null, currency: b.currency.toUpperCase(), timezone: b.timezone,
        theme, settings: { fields: typeCfg.fields }, website: { heroTitle: b.name },
      },
    });
    let ownerRoleId;
    for (const [name, permissions] of Object.entries(SYSTEM_ROLES)) {
      const role = await tx.role.create({ data: { businessId: created.id, name, permissions, isSystem: true } });
      if (name === 'Owner') ownerRoleId = role.id;
    }
    await tx.membership.create({ data: { userId: req.user.id, businessId: created.id, roleId: ownerRoleId } });
    await tx.location.create({ data: { businessId: created.id, name: 'Main', isDefault: true, address: b.address || null } });
    await tx.knowledgeItem.createMany({
      data: [
        { businessId: created.id, title: 'Store hours', content: 'Please update your store hours in Website settings.', category: 'HOURS' },
        { businessId: created.id, title: 'Payment options', content: 'We accept cash, UPI and cards in store.', category: 'PAYMENTS' },
      ],
    });
    await audit({ businessId: created.id, userId: req.user.id, action: 'business.create', entity: 'Business', entityId: created.id }, tx);
    return created;
  });
  res.status(201).json({ business: withDefaults(business) });
}));

// ───── Active business ─────

router.get('/current', requireBusiness, ah(async (req, res) => {
  res.json({
    business: req.business,
    role: req.membership.role.name,
    permissions: req.perms,
    websiteUrl: `${config.publicAppUrl}/s/${req.business.slug}`,
  });
}));

const sectionSchema = z.record(z.string(), z.any());
router.put('/current', requireBusiness, requirePerm('settings.manage', 'website.manage', 'ai.manage'), validate(z.object({
  name: z.string().trim().min(2).max(100).optional(),
  type: z.enum(Object.keys(BUSINESS_TYPES)).optional(),
  slug: z.string().trim().min(2).max(60).optional(),
  phone: z.string().max(20).nullable().optional(),
  email: z.string().max(120).nullable().optional(),
  address: z.string().max(300).nullable().optional(),
  city: z.string().max(80).nullable().optional(),
  taxId: z.string().max(30).nullable().optional(),
  currency: z.string().length(3).optional(),
  timezone: z.string().optional(),
  theme: sectionSchema.optional(),
  terminology: sectionSchema.optional(),
  settings: sectionSchema.optional(),
  website: sectionSchema.optional(),
  ai: sectionSchema.optional(),
})), ah(async (req, res) => {
  const body = req.body;
  const canSettings = req.can('settings.manage');
  const raw = await prisma.business.findUnique({ where: { id: req.businessId } });
  const data = {};

  const profileKeys = ['name', 'type', 'phone', 'email', 'address', 'city', 'taxId', 'currency', 'timezone', 'slug'];
  const touchesProfile = profileKeys.some((k) => body[k] !== undefined) || body.theme || body.terminology || body.settings;
  if (touchesProfile && !canSettings) throw forbidden('Only users with settings permission can change business settings');
  for (const k of profileKeys) if (body[k] !== undefined) data[k] = body[k];
  if (data.slug) {
    data.slug = slugify(data.slug);
    if (RESERVED_SLUGS.has(data.slug)) throw badRequest('That web address is reserved');
    const other = await prisma.business.findUnique({ where: { slug: data.slug } });
    if (other && other.id !== req.businessId) throw conflict('That web address is already taken');
  }
  if (data.timezone) {
    try { Intl.DateTimeFormat('en', { timeZone: data.timezone }); } catch { throw badRequest('Invalid timezone'); }
  }
  if (body.theme) data.theme = deepMerge(raw.theme || {}, body.theme);
  if (body.terminology) data.terminology = deepMerge(raw.terminology || {}, body.terminology);
  if (body.settings) {
    if (body.settings.modules) {
      body.settings.modules = body.settings.modules.filter((m) => MODULES.includes(m));
      body.settings.modulesOff = LATER_MODULES.filter((m) => !body.settings.modules.includes(m));
    }
    data.settings = deepMerge(raw.settings || {}, body.settings);
  }
  if (body.website) {
    if (!canSettings && !req.can('website.manage')) throw forbidden();
    data.website = deepMerge(raw.website || {}, body.website);
  }
  if (body.ai) {
    if (!canSettings && !req.can('ai.manage')) throw forbidden();
    data.ai = deepMerge(raw.ai || {}, body.ai);
  }
  const updated = await prisma.business.update({ where: { id: req.businessId }, data });
  await audit({ businessId: req.businessId, userId: req.user.id, action: 'business.update', entity: 'Business', entityId: req.businessId, data: Object.keys(data) });
  res.json({ business: withDefaults(updated) });
}));

router.post('/current/logo', requireBusiness, requirePerm('settings.manage', 'website.manage'), upload.single('file'), ah(async (req, res) => {
  if (!req.file) throw badRequest('Upload a PNG, JPG or WEBP image under 2 MB');
  const ext = req.file.mimetype.split('/')[1].replace('jpeg', 'jpg');
  const key = `public/${req.businessId}/logo-${Date.now()}.${ext}`;
  await storage.put(key, req.file.buffer);
  const updated = await prisma.business.update({ where: { id: req.businessId }, data: { logoUrl: storage.publicUrl(key) } });
  res.json({ business: withDefaults(updated) });
}));

router.post('/current/banner', requireBusiness, requirePerm('settings.manage', 'website.manage'), upload.single('file'), ah(async (req, res) => {
  if (!req.file) throw badRequest('Upload a PNG, JPG or WEBP image under 2 MB');
  const ext = req.file.mimetype.split('/')[1].replace('jpeg', 'jpg');
  const key = `public/${req.businessId}/banner-${Date.now()}.${ext}`;
  await storage.put(key, req.file.buffer);
  const raw = await prisma.business.findUnique({ where: { id: req.businessId } });
  const updated = await prisma.business.update({ where: { id: req.businessId }, data: { website: deepMerge(raw.website || {}, { bannerUrl: storage.publicUrl(key) }) } });
  res.json({ business: withDefaults(updated) });
}));

// Set, change or remove the passcode that protects editing/cancelling saved bills.
// Requires the signed-in user's account password, so a forgotten passcode can always be reset by the owner.
router.put('/current/bill-passcode', requireBusiness, requirePerm('settings.manage'), validate(z.object({
  password: z.string().min(1, 'Enter your account password'),
  passcode: z.string().regex(/^\d{4,8}$/, 'Passcode must be 4 to 8 digits').nullable(),
})), ah(async (req, res) => {
  if (!(await bcrypt.compare(req.body.password, req.user.passwordHash))) throw badRequest('Account password is incorrect');
  await setBillPasscode(req.businessId, req.body.passcode);
  await audit({ businessId: req.businessId, userId: req.user.id, action: req.body.passcode ? 'passcode.set' : 'passcode.removed', entity: 'Business', entityId: req.businessId });
  res.json({ hasBillPasscode: !!req.body.passcode });
}));

// Owner data export (authorized data only, scoped to this business).
router.get('/current/export', requireBusiness, requirePerm('settings.manage'), ah(async (req, res) => {
  const where = { businessId: req.businessId };
  const [categories, products, customers, suppliers, sales, purchases, orders, enquiries, stockLedger] = await Promise.all([
    prisma.category.findMany({ where }),
    prisma.product.findMany({ where }),
    req.can('customers.export') ? prisma.customer.findMany({ where }) : [],
    prisma.supplier.findMany({ where }),
    prisma.sale.findMany({ where, include: { items: true, payments: true } }),
    prisma.purchase.findMany({ where, include: { items: true } }),
    prisma.order.findMany({ where, include: { items: true } }),
    prisma.enquiry.findMany({ where, include: { followups: true } }),
    prisma.stockLedger.findMany({ where }),
  ]);
  await audit({ businessId: req.businessId, userId: req.user.id, action: 'business.export', entity: 'Business', entityId: req.businessId });
  res.setHeader('Content-Disposition', `attachment; filename="${req.business.slug}-export-${new Date().toISOString().slice(0, 10)}.json"`);
  res.json({ exportedAt: new Date(), business: req.business, categories, products, customers, suppliers, sales, purchases, orders, enquiries, stockLedger });
}));

module.exports = router;
