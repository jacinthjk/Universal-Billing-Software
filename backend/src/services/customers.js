const { prisma } = require('../lib/prisma');
const { normalizePhone, normalizeEmail, round2, n } = require('../lib/util');
const { nextNumber } = require('./sequence');

// Find a customer by the business's configured matching rules (id/code, then phone, then email).
async function findCustomer(businessId, { phone, email, code, id } = {}, matchBy = ['phone', 'email'], db = prisma) {
  if (id) return db.customer.findFirst({ where: { id, businessId } });
  if (code) {
    const c = await db.customer.findFirst({ where: { code, businessId } });
    if (c) return c;
  }
  const p = normalizePhone(phone);
  if (p && matchBy.includes('phone')) {
    const c = await db.customer.findFirst({ where: { businessId, phone: p } });
    if (c) return c;
  }
  const e = normalizeEmail(email);
  if (e && matchBy.includes('email')) {
    const c = await db.customer.findFirst({ where: { businessId, email: e } });
    if (c) return c;
  }
  return null;
}

async function createCustomer(tx, businessId, data) {
  const code = await nextNumber(tx, businessId, 'CUSTOMER');
  return tx.customer.create({
    data: {
      businessId, code, name: data.name?.trim() || 'Walk-in Customer',
      phone: normalizePhone(data.phone), email: normalizeEmail(data.email),
      address: data.address || null, city: data.city || null, taxId: data.taxId || null,
      notes: data.notes || null, tags: data.tags || [], isLead: !!data.isLead,
      marketingConsent: !!data.marketingConsent, createdByAi: !!data.createdByAi,
    },
  });
}

async function findOrCreateCustomer(tx, businessId, data, matchBy) {
  const existing = await findCustomer(businessId, data, matchBy, tx);
  if (existing) {
    const patch = {};
    if (data.name && (!existing.name || existing.name === 'Walk-in Customer')) patch.name = data.name.trim();
    if (data.email && !existing.email) patch.email = normalizeEmail(data.email);
    if (data.phone && !existing.phone) patch.phone = normalizePhone(data.phone);
    if (Object.keys(patch).length) return tx.customer.update({ where: { id: existing.id }, data: patch });
    return existing;
  }
  return createCustomer(tx, businessId, data);
}

// What the POS shows before the sale is finalized: NEW if no counted visits yet, otherwise REPEAT + next visit #.
function previewStatus(customer) {
  if (!customer) return null;
  const next = (customer.visitCount || 0) + 1;
  return { status: next === 1 ? 'NEW' : 'REPEAT', visitNumber: next, label: next === 1 ? 'New Customer' : `Repeat Customer · Visit #${next}` };
}

// Does this sale count as a visit under the business's configured rule?
function countsAsVisit(sale, visitRule = 'PAID') {
  if (sale.status === 'CANCELLED') return false;
  if (visitRule === 'COMPLETED') return true;
  return sale.paymentStatus === 'PAID';
}

// Increments the customer's visit count for a qualifying sale and stamps the sale with status + visit #.
async function recordVisit(tx, sale, visitRule) {
  if (!sale.customerId || !countsAsVisit(sale, visitRule)) return sale;
  const already = await tx.customerVisit.findUnique({ where: { saleId: sale.id } });
  if (already) return sale;
  const customer = await tx.customer.update({
    where: { id: sale.customerId },
    data: {
      visitCount: { increment: 1 },
      totalSpent: { increment: round2(sale.total) },
      lastPurchaseAt: sale.createdAt,
      isLead: false,
    },
  });
  if (!customer.firstPurchaseAt) await tx.customer.update({ where: { id: customer.id }, data: { firstPurchaseAt: sale.createdAt } });
  const visitNumber = customer.visitCount;
  await tx.customerVisit.create({ data: { businessId: sale.businessId, customerId: customer.id, saleId: sale.id, visitNumber } });
  return tx.sale.update({ where: { id: sale.id }, data: { visitNumber, customerStatus: visitNumber === 1 ? 'NEW' : 'REPEAT' } });
}

// Reverses a visit when a sale is cancelled.
async function revertVisit(tx, sale, amount = n(sale.total)) {
  const visit = await tx.customerVisit.findUnique({ where: { saleId: sale.id } });
  if (!visit) return;
  await tx.customerVisit.delete({ where: { id: visit.id } });
  await tx.customer.update({
    where: { id: visit.customerId },
    data: { visitCount: { decrement: 1 }, totalSpent: { decrement: round2(amount) } },
  });
}

module.exports = { findCustomer, createCustomer, findOrCreateCustomer, previewStatus, countsAsVisit, recordVisit, revertVisit };
