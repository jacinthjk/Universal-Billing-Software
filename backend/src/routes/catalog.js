const router = require('express').Router();
const { z } = require('zod');
const multer = require('multer');
const { prisma } = require('../lib/prisma');
const { ah, badRequest, notFound, conflict } = require('../lib/errors');
const { validate } = require('../middleware/validate');
const { requirePerm } = require('../middleware/tenant');
const { slugify, pageParams, n } = require('../lib/util');
const { audit } = require('../lib/audit');
const storage = require('../lib/storage');
const { moveStock, T, availability, stockStatus } = require('../services/stock');

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 2 * 1024 * 1024 },
  fileFilter: (req, file, cb) => cb(null, /^image\/(png|jpe?g|webp)$/.test(file.mimetype)),
});

// ───── Categories ─────

router.get('/categories', ah(async (req, res) => {
  const categories = await prisma.category.findMany({
    where: { businessId: req.businessId },
    orderBy: [{ sortOrder: 'asc' }, { name: 'asc' }],
    include: { _count: { select: { products: true } } },
  });
  res.json({ categories });
}));

router.post('/categories', requirePerm('products.manage'), validate(z.object({ name: z.string().trim().min(1).max(60), sortOrder: z.number().int().optional() })), ah(async (req, res) => {
  const slug = slugify(req.body.name);
  if (await prisma.category.findUnique({ where: { businessId_slug: { businessId: req.businessId, slug } } })) throw conflict('Category already exists');
  const category = await prisma.category.create({ data: { businessId: req.businessId, name: req.body.name, slug, sortOrder: req.body.sortOrder || 0 } });
  res.status(201).json({ category });
}));

router.put('/categories/:id', requirePerm('products.manage'), validate(z.object({ name: z.string().trim().min(1).max(60), sortOrder: z.number().int().optional() })), ah(async (req, res) => {
  const c = await prisma.category.findFirst({ where: { id: req.params.id, businessId: req.businessId } });
  if (!c) throw notFound();
  const category = await prisma.category.update({ where: { id: c.id }, data: { name: req.body.name, slug: slugify(req.body.name), sortOrder: req.body.sortOrder ?? c.sortOrder } });
  res.json({ category });
}));

router.delete('/categories/:id', requirePerm('products.manage'), ah(async (req, res) => {
  const c = await prisma.category.findFirst({ where: { id: req.params.id, businessId: req.businessId } });
  if (!c) throw notFound();
  await prisma.category.delete({ where: { id: c.id } });
  res.json({ ok: true });
}));

// ───── Products / services ─────

function present(req, p, avail) {
  const out = { ...p, stockStatus: stockStatus(p), available: avail?.[p.id]?.available ?? null, reserved: avail?.[p.id]?.reserved ?? 0 };
  if (!req.can('products.view_cost')) delete out.costPrice;
  return out;
}

router.get('/products', requirePerm('products.view', 'pos.sell'), ah(async (req, res) => {
  const { q, categoryId, status, kind, active } = req.query;
  const { take, skip, page } = pageParams(req.query);
  const where = { businessId: req.businessId };
  if (active !== 'all') where.active = active === 'false' ? false : true;
  if (categoryId) where.categoryId = categoryId;
  if (kind) where.kind = kind;
  if (q) {
    where.OR = [
      { name: { contains: q, mode: 'insensitive' } }, { sku: { contains: q, mode: 'insensitive' } },
      { barcode: q }, { brand: { contains: q, mode: 'insensitive' } }, { variant: { contains: q, mode: 'insensitive' } },
    ];
  }
  let products = await prisma.product.findMany({ where, include: { category: { select: { id: true, name: true } } }, orderBy: { name: 'asc' }, take: status ? 1000 : take, skip: status ? 0 : skip });
  if (status) products = products.filter((p) => stockStatus(p) === status).slice(skip, skip + take);
  const total = status ? products.length : await prisma.product.count({ where });
  const avail = await availability(req.businessId, products);
  res.json({ products: products.map((p) => present(req, p, avail)), total, page });
}));

// Exact barcode / SKU lookup for the POS scanner.
router.get('/products/lookup/:code', requirePerm('products.view', 'pos.sell'), ah(async (req, res) => {
  const code = req.params.code.trim();
  const p = await prisma.product.findFirst({ where: { businessId: req.businessId, active: true, OR: [{ barcode: code }, { sku: { equals: code, mode: 'insensitive' } }] } });
  if (!p) throw notFound('No product with that barcode / SKU');
  const avail = await availability(req.businessId, [p]);
  res.json({ product: present(req, p, avail) });
}));

router.get('/products/:id', requirePerm('products.view', 'pos.sell'), ah(async (req, res) => {
  const p = await prisma.product.findFirst({ where: { id: req.params.id, businessId: req.businessId }, include: { category: true, batches: { where: { qty: { gt: 0 } }, orderBy: { expiryDate: 'asc' } } } });
  if (!p) throw notFound();
  const avail = await availability(req.businessId, [p]);
  res.json({ product: present(req, p, avail) });
}));

const productSchema = z.object({
  sku: z.string().trim().max(40).optional(),
  barcode: z.string().trim().max(60).nullable().optional(),
  hsn: z.string().trim().max(20).nullable().optional(),
  name: z.string().trim().min(1).max(150),
  kind: z.enum(['PRODUCT', 'SERVICE']).default('PRODUCT'),
  categoryId: z.string().nullable().optional(),
  brand: z.string().max(60).nullable().optional(),
  variant: z.string().max(60).nullable().optional(),
  unit: z.string().max(20).default('pcs'),
  costPrice: z.coerce.number().min(0).optional(),
  sellingPrice: z.coerce.number().min(0),
  mrp: z.coerce.number().min(0).nullable().optional(),
  taxRate: z.coerce.number().min(0).max(100).default(0),
  trackStock: z.boolean().default(true),
  reorderLevel: z.coerce.number().min(0).nullable().optional(),
  batchTracking: z.boolean().default(false),
  serialTracking: z.boolean().default(false),
  description: z.string().max(4000).nullable().optional(),
  customFields: z.record(z.string(), z.any()).optional(),
  showOnWebsite: z.boolean().default(true),
  active: z.boolean().default(true),
  openingStock: z.coerce.number().min(0).optional(),
});

async function nextSku(businessId) {
  const count = await prisma.product.count({ where: { businessId } });
  for (let i = count + 1; i < count + 1000; i += 1) {
    const sku = `SKU${String(i).padStart(5, '0')}`;
    if (!(await prisma.product.findUnique({ where: { businessId_sku: { businessId, sku } } }))) return sku;
  }
  return `SKU${Date.now()}`;
}

async function checkCategory(req, categoryId) {
  if (!categoryId) return;
  const c = await prisma.category.findFirst({ where: { id: categoryId, businessId: req.businessId } });
  if (!c) throw badRequest('Invalid category');
}

router.post('/products', requirePerm('products.manage'), validate(productSchema), ah(async (req, res) => {
  const { openingStock, ...data } = req.body;
  await checkCategory(req, data.categoryId);
  data.sku = data.sku || (await nextSku(req.businessId));
  if (await prisma.product.findUnique({ where: { businessId_sku: { businessId: req.businessId, sku: data.sku } } })) throw conflict('SKU already in use');
  if (data.kind === 'SERVICE') data.trackStock = false;
  if (!req.can('products.view_cost')) delete data.costPrice;
  const product = await prisma.$transaction(async (tx) => {
    const p = await tx.product.create({ data: { ...data, businessId: req.businessId } });
    if (openingStock > 0 && p.trackStock) {
      await moveStock(tx, { businessId: req.businessId, productId: p.id, qty: openingStock, type: T.OPENING, refType: 'PRODUCT', refId: p.id, unitCost: n(p.costPrice), userId: req.user.id, note: 'Opening stock' });
    }
    await audit({ businessId: req.businessId, userId: req.user.id, action: 'product.create', entity: 'Product', entityId: p.id }, tx);
    return tx.product.findUnique({ where: { id: p.id } });
  });
  res.status(201).json({ product: present(req, product) });
}));

router.put('/products/:id', requirePerm('products.manage'), validate(productSchema.partial()), ah(async (req, res) => {
  const existing = await prisma.product.findFirst({ where: { id: req.params.id, businessId: req.businessId } });
  if (!existing) throw notFound();
  const { openingStock, ...data } = req.body; // stock changes only via ledger movements
  await checkCategory(req, data.categoryId);
  if (data.sku && data.sku !== existing.sku && (await prisma.product.findUnique({ where: { businessId_sku: { businessId: req.businessId, sku: data.sku } } }))) throw conflict('SKU already in use');
  if (!req.can('products.view_cost')) delete data.costPrice;
  if (data.kind === 'SERVICE') data.trackStock = false;
  const product = await prisma.product.update({ where: { id: existing.id }, data });
  const changed = {};
  for (const k of ['sellingPrice', 'costPrice', 'taxRate', 'mrp']) if (data[k] !== undefined && n(existing[k]) !== n(data[k])) changed[k] = { from: n(existing[k]), to: n(data[k]) };
  await audit({ businessId: req.businessId, userId: req.user.id, action: 'product.update', entity: 'Product', entityId: product.id, data: Object.keys(changed).length ? changed : undefined });
  res.json({ product: present(req, product) });
}));

// Soft delete keeps sales/ledger history intact.
router.delete('/products/:id', requirePerm('products.manage'), ah(async (req, res) => {
  const p = await prisma.product.findFirst({ where: { id: req.params.id, businessId: req.businessId } });
  if (!p) throw notFound();
  await prisma.product.update({ where: { id: p.id }, data: { active: false, showOnWebsite: false } });
  await audit({ businessId: req.businessId, userId: req.user.id, action: 'product.deactivate', entity: 'Product', entityId: p.id });
  res.json({ ok: true });
}));

router.post('/products/:id/image', requirePerm('products.manage'), upload.single('file'), ah(async (req, res) => {
  const p = await prisma.product.findFirst({ where: { id: req.params.id, businessId: req.businessId } });
  if (!p) throw notFound();
  if (!req.file) throw badRequest('Upload a PNG, JPG or WEBP image under 2 MB');
  const ext = req.file.mimetype.split('/')[1].replace('jpeg', 'jpg');
  const key = `public/${req.businessId}/products/${p.id}-${Date.now()}.${ext}`;
  await storage.put(key, req.file.buffer);
  const product = await prisma.product.update({ where: { id: p.id }, data: { imageUrl: storage.publicUrl(key) } });
  res.json({ product: present(req, product) });
}));

module.exports = router;
