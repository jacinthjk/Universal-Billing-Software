const { prisma } = require('../lib/prisma');
const { badRequest, notFound, conflict, forbidden } = require('../lib/errors');
const { n, round2, round3 } = require('../lib/util');
const { audit } = require('../lib/audit');
const { nextNumber } = require('./sequence');
const { moveStock, T } = require('./stock');
const { priceLines } = require('./pricing');
const { findCustomer, findOrCreateCustomer, recordVisit, revertVisit, countsAsVisit } = require('./customers');

const clean = (v) => (typeof v === 'string' ? v.trim() : v) || null;

/**
 * Resolves the customer for a sale. When billing details come from the POS preview they are authoritative:
 * the customer is matched (or created) by the mobile/email shown on the bill; no contact means a walk-in bill.
 */
async function resolveCustomer(db, business, customerInput, billing, { create }) {
  const match = business.settings.customerMatch;
  if (billing) {
    const contact = { phone: clean(billing.phone), email: clean(billing.email), name: clean(billing.name) };
    if (!contact.phone && !contact.email) return null;
    return create ? findOrCreateCustomer(db, business.id, contact, match) : findCustomer(business.id, contact, match, db);
  }
  if (customerInput && (customerInput.id || customerInput.phone || customerInput.email)) {
    return create ? findOrCreateCustomer(db, business.id, customerInput, match) : findCustomer(business.id, customerInput, match, db);
  }
  return null;
}

// Billing snapshot printed on the invoice: edited preview values, falling back to the customer profile.
function billingSnapshot(billing, customer) {
  const pick = (k, ck = k) => (billing && billing[k] !== undefined ? clean(billing[k]) : customer?.[ck] || null);
  return { billName: pick('name'), billPhone: pick('phone'), billEmail: pick('email'), billAddress: pick('address'), billTaxId: pick('taxId') };
}

// Spread a bill-level discount across lines pro-rata by gross amount (before tax).
function allocateBillDiscount(products, items, billDiscount) {
  if (!(billDiscount > 0)) return items;
  const byId = Object.fromEntries(products.map((p) => [p.id, p]));
  const gross = items.map((it) => (it.unitPrice ?? n(byId[it.productId]?.sellingPrice)) * n(it.qty) - n(it.discount));
  const totalGross = gross.reduce((a, b) => a + b, 0);
  if (billDiscount > totalGross) throw badRequest('Discount exceeds bill amount');
  let remaining = round2(billDiscount);
  return items.map((it, i) => {
    const share = i === items.length - 1 ? remaining : round2((gross[i] / totalGross) * billDiscount);
    remaining = round2(remaining - share);
    return { ...it, discount: round2(n(it.discount) + share) };
  });
}

function paymentStatusFor(paid, total) {
  if (total <= 0 || paid >= total - 0.005) return 'PAID';
  return paid > 0 ? 'PARTIAL' : 'UNPAID';
}

/**
 * Creates a completed sale (= invoice) in one transaction:
 * price lines from the master -> resolve customer -> number -> stock out -> payments -> visit count -> audit.
 */
async function createSale(business, user, input, perms = {}) {
  const { customer: customerInput, billing = null, items, billDiscount = 0, payments = [], channel = 'POS', orderId = null, notes = null, lockedPrices = false } = input;
  if (!items?.length) throw badRequest('Add at least one item');
  const settings = business.settings;

  return prisma.$transaction(async (tx) => {
    const products = await tx.product.findMany({ where: { businessId: business.id, id: { in: items.map((i) => i.productId) } } });
    const allocated = allocateBillDiscount(products, items, n(billDiscount));
    const priced = priceLines(products, allocated, {
      taxInclusive: settings.taxInclusive,
      allowPriceOverride: lockedPrices || !!perms.changePrice,
      allowDiscount: lockedPrices || !!perms.discount,
    });

    let customer = await resolveCustomer(tx, business, customerInput, billing, { create: true });
    // Corrections made on the bill preview update the customer profile.
    customer = await applyProfileEdits(tx, customer, billing, perms);

    const paidRaw = round2(payments.reduce((s, p) => s + n(p.amount), 0));
    const paid = Math.min(paidRaw, priced.total);
    const paymentStatus = paymentStatusFor(paid, priced.total);
    if (paymentStatus !== 'PAID' && !customer) throw badRequest('A customer is required for credit / partially paid sales');

    const number = await nextNumber(tx, business.id, 'SALE', settings.invoice.prefix, settings.invoice.numberDigits);
    let sale = await tx.sale.create({
      data: {
        businessId: business.id, number, customerId: customer?.id || null, orderId, channel, status: 'COMPLETED',
        subtotal: priced.subtotal, discount: priced.lineDiscounts, tax: priced.tax, total: priced.total,
        paidAmount: paid, paymentStatus, notes, createdById: user?.id || null, ...billingSnapshot(billing, customer),
        items: { create: priced.lines.map(({ productId, name, hsn, unit, qty, unitPrice, costPrice, discount, taxRate, taxAmount, lineTotal }) => ({ productId, name, hsn, unit, qty, unitPrice, costPrice, discount, taxRate, taxAmount, lineTotal })) },
      },
    });

    // Record payments; cash overpayment is change returned to the customer, so cap at the bill total.
    let toRecord = paid;
    for (const p of payments) {
      const amt = Math.min(round2(p.amount), toRecord);
      if (amt <= 0) continue;
      toRecord = round2(toRecord - amt);
      await tx.payment.create({ data: { saleId: sale.id, method: p.method || 'CASH', amount: amt, reference: p.reference || null } });
    }

    for (const line of priced.lines) {
      await moveStock(tx, {
        businessId: business.id, productId: line.productId, qty: -line.qty, type: T.SALE_OUT,
        refType: 'SALE', refId: sale.id, userId: user?.id, unitCost: line.costPrice,
        allowNegative: settings.allowNegativeStock,
      });
    }

    if (customer) {
      sale = await recordVisit(tx, sale, settings.visitRule);
      if (!sale.customerStatus) {
        // Not counted (e.g. unpaid under PAID rule): still show the status the customer currently has.
        const c = await tx.customer.findUnique({ where: { id: customer.id } });
        sale = await tx.sale.update({ where: { id: sale.id }, data: { customerStatus: c.visitCount === 0 ? 'NEW' : 'REPEAT' } });
      }
    }

    await audit({ businessId: business.id, userId: user?.id, actor: user ? 'USER' : 'SYSTEM', action: 'sale.create', entity: 'Sale', entityId: sale.id, data: { number, total: priced.total, channel } }, tx);
    return sale;
  });
}

/**
 * Builds the bill exactly as it would be printed - same pricing and customer recognition as createSale -
 * without saving anything. Used by the POS preview step.
 */
async function previewSale(business, input, perms = {}) {
  const { customer: customerInput, billing = null, items, billDiscount = 0, payments = [], notes = null } = input;
  if (!items?.length) throw badRequest('Add at least one item');
  const settings = business.settings;
  const products = await prisma.product.findMany({ where: { businessId: business.id, id: { in: items.map((i) => i.productId) } } });
  const allocated = allocateBillDiscount(products, items, n(billDiscount));
  const priced = priceLines(products, allocated, { taxInclusive: settings.taxInclusive, allowPriceOverride: !!perms.changePrice, allowDiscount: !!perms.discount });
  const customer = await resolveCustomer(prisma, business, customerInput, billing, { create: false });
  const paid = Math.min(round2(payments.reduce((s, p) => s + n(p.amount), 0)), priced.total);
  const paymentStatus = paymentStatusFor(paid, priced.total);

  // Visit status as it will be stamped: a new contact is always NEW (visit #1).
  const hasContact = !!(billing ? clean(billing.phone) || clean(billing.email) : customer);
  const visits = customer?.visitCount || 0;
  const willCount = countsAsVisit({ status: 'COMPLETED', paymentStatus }, settings.visitRule);
  const visitNumber = hasContact && willCount ? visits + 1 : null;
  const customerStatus = hasContact ? (visits === 0 ? 'NEW' : 'REPEAT') : null;

  const snap = billingSnapshot(billing, customer);
  const sale = {
    number: 'PREVIEW', createdAt: new Date(), status: 'COMPLETED', channel: 'POS',
    subtotal: priced.subtotal, discount: priced.lineDiscounts, tax: priced.tax, total: priced.total, paidAmount: paid, paymentStatus,
    notes, verifyToken: 'preview', customerStatus, visitNumber, ...snap,
    customer: customer || (snap.billName ? { name: snap.billName } : null),
    items: priced.lines.map((l) => ({ ...l, unitPrice: l.unitPrice, returnedQty: 0 })),
    payments: payments.filter((p) => n(p.amount) > 0).map((p) => ({ method: p.method, amount: n(p.amount), reference: p.reference || null })),
    returns: [],
  };
  return {
    sale,
    errors: priced.lines.filter((l) => { const p = products.find((x) => x.id === l.productId); return p.trackStock && p.kind !== 'SERVICE' && !settings.allowNegativeStock && n(p.stockQty) < l.qty; })
      .map((l) => `Only ${n(products.find((x) => x.id === l.productId).stockQty)} ${l.unit} of ${l.name} in stock`),
    matchedCustomer: customer ? { id: customer.id, name: customer.name, phone: customer.phone, visitCount: customer.visitCount } : null,
  };
}

// Settle an outstanding balance on a credit / partially paid sale.
async function addPayment(business, user, saleId, { method = 'CASH', amount, reference }) {
  return prisma.$transaction(async (tx) => {
    const sale = await tx.sale.findFirst({ where: { id: saleId, businessId: business.id } });
    if (!sale) throw notFound('Sale not found');
    if (sale.status === 'CANCELLED') throw badRequest('Sale is cancelled');
    const due = round2(n(sale.total) - n(sale.paidAmount));
    const amt = Math.min(round2(amount), due);
    if (!(amt > 0)) throw badRequest('Nothing is due on this sale');
    await tx.payment.create({ data: { saleId, method, amount: amt, reference: reference || null } });
    const paid = round2(n(sale.paidAmount) + amt);
    let updated = await tx.sale.update({ where: { id: saleId }, data: { paidAmount: paid, paymentStatus: paymentStatusFor(paid, n(sale.total)) } });
    updated = await recordVisit(tx, updated, business.settings.visitRule);
    await audit({ businessId: business.id, userId: user.id, action: 'sale.payment', entity: 'Sale', entityId: saleId, data: { amount: amt, method } }, tx);
    return updated;
  });
}

// Compact snapshot of a bill for the edit history (audit log).
function billSummary(sale) {
  return {
    customer: sale.billName || null, phone: sale.billPhone || null, address: sale.billAddress || null,
    total: n(sale.total), paid: n(sale.paidAmount), paymentStatus: sale.paymentStatus,
    items: (sale.items || []).map((i) => `${n(i.qty)} x ${i.name} @ ${n(i.unitPrice)}${n(i.discount) ? ` -${n(i.discount)}` : ''}`),
    payments: (sale.payments || []).map((p) => `${p.method} ${n(p.amount)}`),
  };
}

// Applies corrections typed on a bill to the customer's profile (only for users allowed to edit customers).
async function applyProfileEdits(tx, customer, billing, perms) {
  if (!customer || !billing || !perms.editCustomer) return customer;
  const patch = {};
  for (const [k, v] of [['name', clean(billing.name)], ['address', clean(billing.address)], ['email', clean(billing.email)?.toLowerCase()], ['taxId', clean(billing.taxId)]]) {
    if (v && v !== customer[k]) patch[k] = v;
  }
  return Object.keys(patch).length ? tx.customer.update({ where: { id: customer.id }, data: patch }) : customer;
}

/**
 * Edits a saved bill: billing details, items, discounts, payments and notes. Stock is put back for the
 * old lines and taken for the new ones; payments are re-recorded; the visit follows the bill. Items are
 * locked once a return exists (edit the customer details only). Every edit is audited with before/after.
 */
async function updateSale(business, user, saleId, input, perms = {}) {
  const { billing, items, billDiscount = 0, payments, notes, reason } = input;
  const settings = business.settings;
  return prisma.$transaction(async (tx) => {
    const sale = await tx.sale.findFirst({ where: { id: saleId, businessId: business.id }, include: { items: true, payments: true, returns: true } });
    if (!sale) throw notFound('Bill not found');
    if (sale.status === 'CANCELLED') throw badRequest('Cancelled bills cannot be edited');
    if (items && sale.returns.length) throw badRequest('Items cannot be changed after a return - only customer details can be edited');
    const before = billSummary(sale);

    let priced = null;
    if (items) {
      if (!items.length) throw badRequest('A bill needs at least one item - cancel the bill instead');
      const orig = Object.fromEntries(sale.items.map((i) => [i.productId, i]));
      // Items already on the bill stay billable even if the product was deactivated since.
      const products = (await tx.product.findMany({ where: { businessId: business.id, id: { in: items.map((i) => i.productId) } } }))
        .map((p) => (orig[p.id] ? { ...p, active: true } : p));
      for (const it of items) {
        const p = products.find((x) => x.id === it.productId);
        if (!p) throw badRequest('One of the items no longer exists');
        const o = orig[it.productId];
        // Keeping the bill's original price/discount is always allowed; anything new needs the usual permission.
        if (it.unitPrice !== undefined && round2(it.unitPrice) !== round2(p.sellingPrice) && !perms.changePrice && !(o && round2(o.unitPrice) === round2(it.unitPrice))) {
          throw forbidden('You are not allowed to change prices');
        }
        if (n(it.discount) > 0 && !perms.discount && !(o && n(it.discount) <= n(o.discount))) throw forbidden('You are not allowed to give discounts');
      }
      if (n(billDiscount) > 0 && !perms.discount) throw forbidden('You are not allowed to give discounts');
      const allocated = allocateBillDiscount(products, items, n(billDiscount));
      priced = priceLines(products, allocated, { taxInclusive: settings.taxInclusive, allowPriceOverride: true, allowDiscount: true });

      for (const it of sale.items) {
        await moveStock(tx, { businessId: business.id, productId: it.productId, qty: n(it.qty), type: T.EDIT_IN, refType: 'SALE', refId: sale.id, userId: user.id, note: `Bill ${sale.number} edited`, allowNegative: true });
      }
      await tx.saleItem.deleteMany({ where: { saleId: sale.id } });
      await tx.saleItem.createMany({
        data: priced.lines.map(({ productId, name, hsn, unit, qty, unitPrice, costPrice, discount, taxRate, taxAmount, lineTotal }) => ({ saleId: sale.id, productId, name, hsn, unit, qty, unitPrice, costPrice, discount, taxRate, taxAmount, lineTotal })),
      });
      for (const line of priced.lines) {
        await moveStock(tx, { businessId: business.id, productId: line.productId, qty: -line.qty, type: T.EDIT_OUT, refType: 'SALE', refId: sale.id, userId: user.id, unitCost: line.costPrice, note: `Bill ${sale.number} edited`, allowNegative: settings.allowNegativeStock });
      }
    }
    const total = priced ? priced.total : n(sale.total);

    // Payments: re-record the given list (or the existing one), capped at the new total.
    const payList = payments ?? sale.payments.map((p) => ({ method: p.method, amount: n(p.amount), reference: p.reference }));
    const paid = Math.min(round2(payList.reduce((s, p) => s + n(p.amount), 0)), total);
    await tx.payment.deleteMany({ where: { saleId: sale.id } });
    let toRecord = paid;
    for (const p of payList) {
      const amt = Math.min(round2(p.amount), toRecord);
      if (amt <= 0) continue;
      toRecord = round2(toRecord - amt);
      await tx.payment.create({ data: { saleId: sale.id, method: p.method || 'CASH', amount: amt, reference: p.reference || null } });
    }
    const paymentStatus = sale.returns.length && sale.paymentStatus === 'REFUNDED' ? 'REFUNDED' : paymentStatusFor(paid, total);

    let customer = billing
      ? await resolveCustomer(tx, business, null, billing, { create: true })
      : sale.customerId ? await tx.customer.findUnique({ where: { id: sale.customerId } }) : null;
    customer = await applyProfileEdits(tx, customer, billing, perms);
    if (paymentStatus !== 'PAID' && paymentStatus !== 'REFUNDED' && !customer) throw badRequest('A mobile number is required for credit / partly paid bills');

    let updated = await tx.sale.update({
      where: { id: sale.id },
      data: {
        customerId: customer?.id || null,
        ...(priced ? { subtotal: priced.subtotal, discount: priced.lineDiscounts, tax: priced.tax, total: priced.total } : {}),
        paidAmount: paid, paymentStatus,
        ...(notes !== undefined ? { notes: clean(notes) } : {}),
        ...(billing ? billingSnapshot(billing, customer) : {}),
        editCount: { increment: 1 }, editedAt: new Date(),
      },
      include: { items: true, payments: true },
    });

    // Visit follows the bill: same customer and still counted -> keep the visit number, adjust spend only.
    const oldVisit = await tx.customerVisit.findUnique({ where: { saleId: sale.id } });
    const counts = customer && countsAsVisit({ status: 'COMPLETED', paymentStatus }, settings.visitRule);
    if (oldVisit && counts && oldVisit.customerId === customer.id) {
      const delta = round2(total - n(sale.total));
      if (delta) await tx.customer.update({ where: { id: customer.id }, data: { totalSpent: { increment: delta } } });
    } else {
      if (oldVisit) await revertVisit(tx, sale, round2(n(sale.total) - sale.returns.reduce((t, r) => t + n(r.total), 0)));
      updated = await tx.sale.update({ where: { id: sale.id }, data: { customerStatus: null, visitNumber: null }, include: { items: true, payments: true } });
      if (customer) {
        updated = await recordVisit(tx, updated, settings.visitRule);
        if (!updated.customerStatus) {
          const c = await tx.customer.findUnique({ where: { id: customer.id } });
          updated = await tx.sale.update({ where: { id: sale.id }, data: { customerStatus: c.visitCount === 0 ? 'NEW' : 'REPEAT' } });
        }
      }
    }

    const after = billSummary({ ...updated, items: priced ? priced.lines : sale.items, payments: payList.filter((p) => n(p.amount) > 0) });
    await audit({ businessId: business.id, userId: user.id, action: 'sale.edit', entity: 'Sale', entityId: sale.id, data: { reason, before, after } }, tx);
    return updated;
  });
}

async function cancelSale(business, user, saleId, reason) {
  return prisma.$transaction(async (tx) => {
    const sale = await tx.sale.findFirst({ where: { id: saleId, businessId: business.id }, include: { items: true, returns: true } });
    if (!sale) throw notFound('Bill not found');
    if (sale.status === 'CANCELLED') throw conflict('This bill is already cancelled');
    for (const it of sale.items) {
      const qty = round3(n(it.qty) - n(it.returnedQty));
      if (qty > 0) {
        await moveStock(tx, { businessId: business.id, productId: it.productId, qty, type: T.CANCEL_IN, refType: 'SALE', refId: sale.id, userId: user.id, note: `Bill ${sale.number} cancelled`, allowNegative: true });
      }
    }
    // Spend already reduced by returns is not subtracted twice.
    const returned = sale.returns.reduce((s, r) => s + n(r.total), 0);
    await revertVisit(tx, sale, round2(n(sale.total) - returned));
    const updated = await tx.sale.update({
      where: { id: sale.id },
      data: { status: 'CANCELLED', cancelledAt: new Date(), cancelledById: user.id, cancelReason: reason },
    });
    if (sale.orderId) await tx.order.update({ where: { id: sale.orderId }, data: { status: 'CANCELLED' } });
    await audit({ businessId: business.id, userId: user.id, action: 'sale.cancel', entity: 'Sale', entityId: sale.id, data: { reason } }, tx);
    return updated;
  });
}

// Partial or full return. Refund amount is computed from the original line totals.
async function returnSale(business, user, saleId, { items, reason, refundMethod = 'CASH' }) {
  return prisma.$transaction(async (tx) => {
    const sale = await tx.sale.findFirst({ where: { id: saleId, businessId: business.id }, include: { items: true } });
    if (!sale) throw notFound('Sale not found');
    if (sale.status === 'CANCELLED') throw badRequest('Cannot return a cancelled sale');
    const byId = Object.fromEntries(sale.items.map((i) => [i.id, i]));
    let total = 0;
    const rows = [];
    for (const r of items) {
      const it = byId[r.saleItemId];
      if (!it) throw badRequest('Invalid sale item');
      const qty = round3(r.qty);
      const remaining = round3(n(it.qty) - n(it.returnedQty));
      if (!(qty > 0) || qty > remaining) throw badRequest(`Invalid return quantity for ${it.name} (max ${remaining})`);
      const amount = round2((n(it.lineTotal) / n(it.qty)) * qty);
      total = round2(total + amount);
      rows.push({ it, qty, amount });
    }
    if (!rows.length) throw badRequest('Select items to return');
    const number = await nextNumber(tx, business.id, 'RETURN');
    const ret = await tx.saleReturn.create({
      data: {
        businessId: business.id, saleId, number, reason: reason || null, total, refundMethod, createdById: user.id,
        items: { create: rows.map(({ it, qty, amount }) => ({ saleItemId: it.id, productId: it.productId, qty, amount })) },
      },
    });
    for (const { it, qty } of rows) {
      await tx.saleItem.update({ where: { id: it.id }, data: { returnedQty: { increment: qty } } });
      await moveStock(tx, { businessId: business.id, productId: it.productId, qty, type: T.RETURN_IN, refType: 'RETURN', refId: ret.id, userId: user.id, allowNegative: true });
    }
    const after = await tx.saleItem.findMany({ where: { saleId } });
    const fully = after.every((i) => n(i.returnedQty) >= n(i.qty));
    await tx.sale.update({ where: { id: saleId }, data: { status: fully ? 'RETURNED' : 'PARTIALLY_RETURNED', ...(fully ? { paymentStatus: 'REFUNDED' } : {}) } });
    if (sale.customerId) await tx.customer.update({ where: { id: sale.customerId }, data: { totalSpent: { decrement: total } } });
    await audit({ businessId: business.id, userId: user.id, action: 'sale.return', entity: 'Sale', entityId: saleId, data: { number, total, reason } }, tx);
    return ret;
  });
}

module.exports = { previewSale, createSale, updateSale, addPayment, cancelSale, returnSale, paymentStatusFor };
