// What we send over WhatsApp: invoices, payment reminders and product updates.
// Each builder returns { message, name, customerId, refId } ready for messaging.send / sendBatch.
const { prisma } = require('../lib/prisma');
const { badRequest } = require('../lib/errors');
const { money, n } = require('../lib/util');
const storage = require('../lib/storage');
const config = require('../config');
const { loadInvoice, getInvoiceAsset } = require('./invoice');

const storeUrl = (business) => `${config.publicAppUrl}/s/${business.slug}`;
const isWalkIn = (name) => !name || /^walk-in/i.test(name);
const firstName = (name) => (isWalkIn(name) ? 'there' : String(name).trim().split(/\s+/)[0]);
const fill = (template, vars) => template.replace(/\{(\w+)\}/g, (m, k) => (vars[k] !== undefined ? vars[k] : m));

// Plain-text invoice summary with the public verification link (also used by the wa.me share link).
function invoiceText(business, inv) {
  return [
    `${inv.business.name} - ${inv.terminology.invoice} ${inv.number}`,
    inv.customer && !isWalkIn(inv.customer.name) ? `${inv.terminology.customer}: ${inv.customer.name}` : null,
    `Total: ${money(inv.total, inv.business.currency)} (${inv.paymentStatus.toLowerCase()})`,
    inv.due > 0 ? `Balance due: ${money(inv.due, inv.business.currency)}` : null,
    `View: ${inv.verifyUrl}`,
    `Shop online: ${storeUrl(business)}`,
  ].filter(Boolean).join('\n');
}

/** The invoice PDF with the summary as its caption. `to` overrides the number on the bill. */
async function invoiceMessage(business, saleId, to) {
  const { buffer, inv } = await getInvoiceAsset(business, saleId, 'pdf', { format: 'A4' });
  const phone = to || inv.customer?.phone;
  if (!phone) throw badRequest('This bill has no mobile number. Add one to the bill, or enter a number to send to.');
  const sale = await prisma.sale.findFirst({ where: { id: saleId, businessId: business.id }, select: { customerId: true } });
  return {
    message: { to: phone, text: invoiceText(business, inv), document: { buffer, filename: `${inv.number}.pdf`, mime: 'application/pdf' } },
    name: inv.customer?.name, customerId: sale?.customerId, refId: saleId,
  };
}

function reminderText(business, inv) {
  return [
    `Hi ${firstName(inv.customer?.name)}, this is a friendly reminder from ${business.name}.`,
    `${inv.terminology.invoice} ${inv.number} dated ${inv.dateOnly} has a balance of ${money(inv.due, business.currency)} due.`,
    `View your bill: ${inv.verifyUrl}`,
    business.phone ? `Questions? Call us on ${business.phone}.` : null,
    'Thank you!',
  ].filter(Boolean).join('\n');
}

async function reminderMessage(business, saleId) {
  const inv = await loadInvoice(business, saleId);
  if (inv.status === 'CANCELLED') throw badRequest('This bill is cancelled');
  if (inv.due <= 0) throw badRequest('Nothing is due on this bill');
  if (!inv.customer?.phone) throw badRequest('This bill has no mobile number');
  const sale = await prisma.sale.findFirst({ where: { id: saleId, businessId: business.id }, select: { customerId: true } });
  return { message: { to: inv.customer.phone, text: reminderText(business, inv) }, name: inv.customer.name, customerId: sale?.customerId, refId: saleId };
}

/** Open bills with a balance and a mobile number, oldest first, with when each was last reminded. */
async function dueBills(business) {
  const sales = await prisma.sale.findMany({
    where: { businessId: business.id, status: { in: ['COMPLETED', 'PARTIALLY_RETURNED'] }, paymentStatus: { in: ['UNPAID', 'PARTIAL'] } },
    include: { customer: { select: { name: true, phone: true } } },
    orderBy: { createdAt: 'asc' },
    take: 500,
  });
  const rows = sales
    .map((s) => ({
      id: s.id, number: s.number, createdAt: s.createdAt, total: n(s.total), due: Math.max(n(s.total) - n(s.paidAmount), 0),
      name: s.billName || s.customer?.name || null, phone: s.billPhone || s.customer?.phone || null,
    }))
    .filter((s) => s.due > 0);
  const last = await prisma.messageLog.groupBy({
    by: ['refId'], where: { businessId: business.id, kind: 'REMINDER', status: 'SENT', refId: { in: rows.map((r) => r.id) } }, _max: { createdAt: true },
  });
  const lastBy = Object.fromEntries(last.map((l) => [l.refId, l._max.createdAt]));
  return rows.map((r) => ({ ...r, lastRemindedAt: lastBy[r.id] || null }));
}

// ───── Product updates ─────

const DEFAULT_UPDATE = 'Hi {name}! New at {business}:\n{products}\n\nShop now: {link}';

/** Customers who agreed to marketing messages and have a mobile number (optionally only some tags). */
function audienceWhere(business, tags = []) {
  return { businessId: business.id, marketingConsent: true, phone: { not: null }, ...(tags.length ? { tags: { hasSome: tags } } : {}) };
}

const sniffMime = (buf) => (buf[0] === 0x89 ? 'image/png' : buf[0] === 0xff ? 'image/jpeg' : 'image/webp');

async function productUpdateMessages(business, { productIds = [], message, tags = [], includeImage = true }) {
  const products = productIds.length
    ? await prisma.product.findMany({ where: { businessId: business.id, id: { in: productIds }, active: true }, orderBy: { name: 'asc' } })
    : [];
  const list = products.map((p) => `• ${p.name}${p.variant ? ` (${p.variant})` : ''} - ${money(p.sellingPrice, business.currency)}`).join('\n');
  const template = (message || '').trim() || DEFAULT_UPDATE;
  if (!list && template.includes('{products}')) throw badRequest('Pick at least one product, or write your own message without {products}');

  let image = null;
  if (includeImage) {
    for (const p of products) {
      const buf = await storage.readPublicImage(p.imageUrl).catch(() => null);
      if (buf) {
        const mime = sniffMime(buf);
        image = { buffer: buf, mime, filename: `${p.sku || 'product'}.${mime.split('/')[1].replace('jpeg', 'jpg')}` };
        break;
      }
    }
  }

  const customers = await prisma.customer.findMany({ where: audienceWhere(business, tags), select: { id: true, name: true, phone: true }, orderBy: { lastPurchaseAt: 'desc' } });
  return customers.map((c) => ({
    message: { to: c.phone, text: fill(template, { name: firstName(c.name), business: business.name, products: list, link: storeUrl(business) }), image },
    name: c.name, customerId: c.id,
  }));
}

module.exports = { invoiceText, invoiceMessage, reminderMessage, dueBills, productUpdateMessages, audienceWhere, DEFAULT_UPDATE, fill };
