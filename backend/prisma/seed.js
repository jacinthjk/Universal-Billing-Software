// Demo data: one owner with two businesses (organic grocery + electronics) to show multi-tenant
// switching, themes, POS history with repeat customers, enquiries, orders and the AI knowledge base.
// Run: npm run db:seed   (safe to re-run: skips if the demo user already exists)
require('dotenv').config();
const bcrypt = require('bcryptjs');
const { prisma } = require('../src/lib/prisma');
const { THEMES, BUSINESS_TYPES } = require('../src/lib/presets');
const { SYSTEM_ROLES } = require('../src/lib/permissions');
const { withDefaults } = require('../src/lib/businessConfig');
const { slugify } = require('../src/lib/util');
const { moveStock, T } = require('../src/services/stock');
const { createSale } = require('../src/services/sales');
const { createPurchase } = require('../src/services/purchases');
const { placeOrder } = require('../src/services/orders');

const DEMO_EMAIL = 'owner@demo.com';
const DEMO_PASSWORD = 'Demo@12345';

async function makeBusiness(owner, { name, slug, type, phone, address, city, website, kb, categories, products }) {
  const theme = { ...THEMES[BUSINESS_TYPES[type].theme], key: BUSINESS_TYPES[type].theme };
  const raw = await prisma.business.create({
    data: {
      name, slug, type, phone, email: `hello@${slug}.example`, address, city, currency: 'INR', timezone: 'Asia/Kolkata',
      theme, settings: { fields: BUSINESS_TYPES[type].fields, invoice: { footer: `Thank you for shopping at ${name}!` } },
      website,
    },
  });
  let ownerRole;
  for (const [roleName, permissions] of Object.entries(SYSTEM_ROLES)) {
    const r = await prisma.role.create({ data: { businessId: raw.id, name: roleName, permissions, isSystem: true } });
    if (roleName === 'Owner') ownerRole = r;
  }
  await prisma.membership.create({ data: { userId: owner.id, businessId: raw.id, roleId: ownerRole.id } });
  await prisma.location.create({ data: { businessId: raw.id, name: 'Main', isDefault: true, address } });
  await prisma.knowledgeItem.createMany({ data: kb.map((k) => ({ ...k, businessId: raw.id })) });

  const catIds = {};
  for (const [i, c] of categories.entries()) {
    const cat = await prisma.category.create({ data: { businessId: raw.id, name: c, slug: slugify(c), sortOrder: i } });
    catIds[c] = cat.id;
  }
  const created = [];
  for (const [i, p] of products.entries()) {
    const { category, stock, ...data } = p;
    const prod = await prisma.product.create({ data: { ...data, businessId: raw.id, sku: `SKU${String(i + 1).padStart(5, '0')}`, categoryId: catIds[category] } });
    if (stock && prod.trackStock) {
      await prisma.$transaction((tx) => moveStock(tx, { businessId: raw.id, productId: prod.id, qty: stock, type: T.OPENING, refType: 'PRODUCT', refId: prod.id, unitCost: Number(prod.costPrice), userId: owner.id, note: 'Opening stock' }));
    }
    created.push(prod);
  }
  return { business: withDefaults(await prisma.business.findUnique({ where: { id: raw.id } })), products: created };
}

async function main() {
  if (await prisma.user.findUnique({ where: { email: DEMO_EMAIL } })) {
    console.log('Demo data already present - skipping. Log in with', DEMO_EMAIL, '/', DEMO_PASSWORD);
    return;
  }
  const owner = await prisma.user.create({ data: { name: 'Daniel Walker', email: DEMO_EMAIL, passwordHash: await bcrypt.hash(DEMO_PASSWORD, 12), isPlatformAdmin: true } });

  // ───── Business A: organic grocery ─────
  const A = await makeBusiness(owner, {
    name: 'Green Leaf Organics', slug: 'green-leaf-organics', type: 'GROCERY', phone: '9876543210', address: '12 Market Road', city: 'Chennai',
    website: { tagline: 'Farm-fresh organic groceries', heroTitle: 'Pure. Organic. Local.', heroSubtitle: 'Cold-pressed oils, ghee, millets and fresh produce from partner farms.', hours: 'Mon–Sat 8:00–21:00, Sun 9:00–14:00', deliveryNote: 'Free delivery within 5 km on orders above ₹500.', about: 'Green Leaf Organics sources directly from certified organic farms around Tamil Nadu.', policies: { returns: 'Unopened items can be returned within 3 days with the invoice.', shipping: 'Same-day delivery for orders before 4 PM within 5 km.', privacy: 'We only use your details to process orders and send updates you ask for.' } },
    kb: [
      { title: 'Store hours', content: 'Mon–Sat 8:00 AM – 9:00 PM, Sunday 9:00 AM – 2:00 PM.', category: 'HOURS' },
      { title: 'Delivery areas', content: 'We deliver within 5 km of 12 Market Road, Chennai. Delivery is free above ₹500, otherwise ₹40.', category: 'DELIVERY' },
      { title: 'Are your oils cold pressed?', content: 'Yes - all our groundnut, sesame and coconut oils are wood cold-pressed (marachekku) with no additives.', category: 'FAQ' },
      { title: 'Payment options', content: 'Cash, UPI and cards in store. Pay on delivery for home deliveries.', category: 'PAYMENTS' },
    ],
    categories: ['Oils', 'Ghee & Dairy', 'Grains & Millets', 'Fresh Produce', 'Spices'],
    products: [
      { name: 'Cold Pressed Groundnut Oil', variant: '1 L', unit: 'bottle', category: 'Oils', costPrice: 260, sellingPrice: 340, mrp: 360, taxRate: 5, stock: 40, reorderLevel: 10, description: 'Wood cold-pressed groundnut oil from Tamil Nadu farms. No additives or preservatives.', batchTracking: true },
      { name: 'Cold Pressed Sesame Oil', variant: '1 L', unit: 'bottle', category: 'Oils', costPrice: 380, sellingPrice: 480, mrp: 500, taxRate: 5, stock: 25, reorderLevel: 8, description: 'Traditional gingelly oil, wood pressed.' },
      { name: 'Virgin Coconut Oil', variant: '500 ml', unit: 'bottle', category: 'Oils', costPrice: 210, sellingPrice: 290, taxRate: 5, stock: 6, reorderLevel: 8, description: 'Cold-pressed virgin coconut oil.' },
      { name: 'A2 Cow Ghee', variant: '500 ml', unit: 'jar', category: 'Ghee & Dairy', costPrice: 520, sellingPrice: 690, mrp: 750, taxRate: 12, stock: 18, reorderLevel: 5, description: 'Bilona-churned A2 desi cow ghee.', batchTracking: true },
      { name: 'Foxtail Millet', variant: '1 kg', unit: 'pack', category: 'Grains & Millets', costPrice: 85, sellingPrice: 120, taxRate: 0, stock: 50, reorderLevel: 15 },
      { name: 'Hand-pounded Red Rice', variant: '1 kg', unit: 'pack', category: 'Grains & Millets', costPrice: 70, sellingPrice: 105, taxRate: 0, stock: 60, reorderLevel: 20 },
      { name: 'Organic Tomatoes', unit: 'kg', category: 'Fresh Produce', costPrice: 30, sellingPrice: 48, taxRate: 0, stock: 30, reorderLevel: 10 },
      { name: 'Organic Turmeric Powder', variant: '200 g', unit: 'pack', category: 'Spices', costPrice: 55, sellingPrice: 85, taxRate: 5, stock: 0, reorderLevel: 10 },
    ],
  });

  // ───── Business B: electronics ─────
  const B = await makeBusiness(owner, {
    name: 'ByteHub Electronics', slug: 'bytehub-electronics', type: 'ELECTRONICS', phone: '9123456780', address: '44 Tech Park Avenue', city: 'Bengaluru',
    website: { tagline: 'Gadgets, accessories & service', heroTitle: 'Tech that just works', heroSubtitle: 'Genuine accessories with warranty and same-day setup help.', hours: 'Daily 10:00–21:00', deliveryNote: 'Same-day delivery across Bengaluru.' },
    kb: [
      { title: 'Warranty', content: 'All products carry the manufacturer warranty. Bring the invoice for warranty claims.', category: 'POLICY' },
      { title: 'Store hours', content: 'Open every day 10 AM – 9 PM.', category: 'HOURS' },
    ],
    categories: ['Audio', 'Chargers & Cables', 'Accessories', 'Services'],
    products: [
      { name: 'Wireless Earbuds Pro', brand: 'Sonix', unit: 'pcs', category: 'Audio', costPrice: 1800, sellingPrice: 2499, mrp: 2999, taxRate: 18, stock: 15, reorderLevel: 5, customFields: { warranty: '1 year', model: 'SX-EB2' } },
      { name: '65W GaN Fast Charger', brand: 'VoltX', unit: 'pcs', category: 'Chargers & Cables', costPrice: 1100, sellingPrice: 1599, taxRate: 18, stock: 22, reorderLevel: 6, customFields: { warranty: '6 months' } },
      { name: 'USB-C Braided Cable 1.5m', brand: 'VoltX', unit: 'pcs', category: 'Chargers & Cables', costPrice: 180, sellingPrice: 349, taxRate: 18, stock: 4, reorderLevel: 10 },
      { name: 'Laptop Sleeve 14"', unit: 'pcs', category: 'Accessories', costPrice: 400, sellingPrice: 799, taxRate: 12, stock: 12 },
      { name: 'Phone Setup & Data Transfer', kind: 'SERVICE', trackStock: false, unit: 'service', category: 'Services', costPrice: 0, sellingPrice: 299, taxRate: 18, description: 'We move your contacts, photos and apps to your new phone.' },
    ],
  });

  // Supplier + purchase for A
  const supplier = await prisma.supplier.create({ data: { businessId: A.business.id, name: 'Kaveri Farmers Co-op', phone: '9000011111', address: 'Erode' } });
  await createPurchase(A.business, owner, { supplierId: supplier.id, supplierRef: 'KFC-2291', status: 'RECEIVED', paidAmount: 5000, items: [
    { productId: A.products[0].id, qty: 20, unitCost: 255, taxRate: 5, batchNo: 'GN-0926', expiryDate: '2027-03-31' },
    { productId: A.products[3].id, qty: 10, unitCost: 515, taxRate: 12, batchNo: 'GH-0926', expiryDate: '2026-12-31' },
  ] });

  // Sales with repeat customers (Priya visits 3 times, Arun twice, plus walk-ins)
  const perms = { discount: true, changePrice: true };
  // Tendered amount is capped at the server-computed total, so this pays each bill exactly.
  const sell = (biz, customer, items, method = 'CASH') => createSale(biz, owner, { customer, items, payments: [{ method, amount: 1e9 }] }, perms);
  const priya = { name: 'Priya', phone: '9840012345' };
  const arun = { name: 'Arun', phone: '9840054321' };
  await sell(A.business, priya, [{ productId: A.products[0].id, qty: 2 }, { productId: A.products[4].id, qty: 1 }], 'UPI');
  await sell(A.business, arun, [{ productId: A.products[3].id, qty: 1 }], 'CARD');
  await sell(A.business, priya, [{ productId: A.products[5].id, qty: 3 }, { productId: A.products[6].id, qty: 1.5 }], 'UPI');
  await sell(A.business, null, [{ productId: A.products[1].id, qty: 1 }], 'CASH');
  await sell(A.business, priya, [{ productId: A.products[3].id, qty: 1 }, { productId: A.products[2].id, qty: 1 }], 'CASH');
  await sell(A.business, arun, [{ productId: A.products[0].id, qty: 1 }], 'UPI');
  await sell(B.business, { name: 'Meera', phone: '9988776655' }, [{ productId: B.products[0].id, qty: 1 }, { productId: B.products[4].id, qty: 1 }], 'CARD');

  // Enquiries + a website order for A
  await prisma.enquiry.create({ data: { businessId: A.business.id, name: 'Karthik', phone: '9876500000', source: 'WHATSAPP', intent: 'PRODUCT_ENQUIRY', productId: A.products[3].id, itemText: 'A2 ghee 1 L', quantity: '2 jars', status: 'NEW', followUpAt: new Date(), summary: 'Asked if 1 L ghee jars are available for bulk purchase.' } });
  await prisma.enquiry.create({ data: { businessId: A.business.id, name: 'Lakshmi', phone: '9876511111', source: 'INSTAGRAM', intent: 'PURCHASE', itemText: 'Millet combo pack', status: 'INTERESTED', followUpAt: new Date(Date.now() + 86400000), summary: 'Wants a monthly millet subscription.' } });
  await placeOrder(A.business, { items: [{ productId: A.products[0].id, qty: 1 }, { productId: A.products[4].id, qty: 2 }], contact: { name: 'Sanjay', phone: '9876522222' }, fulfilment: 'DELIVERY', address: '5 Lake View Street, Chennai', paymentMethod: 'PAY_ON_DELIVERY', channel: 'WEBSITE' });

  console.log('Seeded demo data.');
  console.log(`  Login: ${DEMO_EMAIL} / ${DEMO_PASSWORD}`);
  console.log('  Stores: /s/green-leaf-organics  and  /s/bytehub-electronics');
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
