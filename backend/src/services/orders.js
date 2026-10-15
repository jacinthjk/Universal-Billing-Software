const { prisma } = require('../lib/prisma');
const { badRequest, notFound, conflict } = require('../lib/errors');
const { n, round2 } = require('../lib/util');
const { audit, notify } = require('../lib/audit');
const { nextNumber } = require('./sequence');
const { availability } = require('./stock');
const { priceLines } = require('./pricing');
const { findOrCreateCustomer } = require('./customers');
const { createSale } = require('./sales');

const TRANSITIONS = {
  PENDING: ['CONFIRMED', 'CANCELLED'],
  CONFIRMED: ['PROCESSING', 'READY', 'COMPLETED', 'CANCELLED'],
  PROCESSING: ['READY', 'COMPLETED', 'CANCELLED'],
  READY: ['COMPLETED', 'CANCELLED'],
  COMPLETED: [],
  CANCELLED: [],
};

/**
 * Places a website / AI / enquiry order or quotation. Prices and availability are computed server-side;
 * stock is reserved (not deducted) until the order is completed and invoiced.
 */
async function placeOrder(business, input, { actor = 'CUSTOMER', userId = null } = {}) {
  const { items, contact = {}, fulfilment = 'PICKUP', address, paymentMethod = 'PAY_ON_DELIVERY', notes, channel = 'WEBSITE', kind = 'ORDER', enquiryId = null, createdByAi = false, idempotencyKey = null, customerId = null } = input;
  if (!items?.length) throw badRequest('Your cart is empty');

  if (idempotencyKey) {
    const existing = await prisma.order.findUnique({ where: { businessId_idempotencyKey: { businessId: business.id, idempotencyKey } }, include: { items: true } });
    if (existing) return existing;
  }

  return prisma.$transaction(async (tx) => {
    const products = await tx.product.findMany({ where: { businessId: business.id, id: { in: items.map((i) => i.productId) }, active: true } });
    const priced = priceLines(products, items.map((i) => ({ productId: i.productId, qty: i.qty })), { taxInclusive: business.settings.taxInclusive });

    if (kind === 'ORDER') {
      const avail = await availability(business.id, products, tx);
      for (const line of priced.lines) {
        const a = avail[line.productId];
        if (a.available !== null && a.available < line.qty) {
          throw badRequest(`Only ${Math.max(a.available, 0)} ${line.unit} of ${line.name} available`);
        }
      }
    }

    let customer = null;
    if (customerId) customer = await tx.customer.findFirst({ where: { id: customerId, businessId: business.id } });
    if (!customer && (contact.phone || contact.email)) {
      customer = await findOrCreateCustomer(tx, business.id, { ...contact, address, createdByAi }, business.settings.customerMatch);
    }
    if (!customer) throw badRequest('Phone number or email is required');

    const number = await nextNumber(tx, business.id, kind === 'QUOTATION' ? 'QUOTATION' : 'ORDER');
    const order = await tx.order.create({
      data: {
        businessId: business.id, number, kind, channel, status: 'PENDING', customerId: customer.id, enquiryId,
        contactName: contact.name || customer.name, contactPhone: customer.phone, contactEmail: contact.email || customer.email,
        fulfilment, address: address || null, paymentMethod, paymentStatus: 'UNPAID', notes: notes || null,
        subtotal: round2(priced.total - priced.tax), tax: priced.tax, total: priced.total, createdByAi, idempotencyKey,
        items: { create: priced.lines.map((l) => ({ productId: l.productId, name: l.name, qty: l.qty, unitPrice: l.unitPrice, taxRate: l.taxRate, lineTotal: l.lineTotal })) },
      },
      include: { items: true },
    });

    if (kind === 'ORDER') {
      for (const l of priced.lines) {
        const p = products.find((x) => x.id === l.productId);
        if (p.trackStock && p.kind !== 'SERVICE') {
          await tx.stockReservation.create({ data: { businessId: business.id, productId: l.productId, orderId: order.id, qty: l.qty } });
        }
      }
    }

    if (enquiryId) await tx.enquiry.updateMany({ where: { id: enquiryId, businessId: business.id }, data: { status: kind === 'QUOTATION' ? 'QUOTATION' : 'CONVERTED', customerId: customer.id } });

    await notify(business.id, { type: 'ORDER', title: `New ${kind === 'QUOTATION' ? 'quotation' : 'order'} ${number}`, body: `${order.contactName || 'Customer'} · ${channel}`, link: `/orders/${order.id}` }, tx);
    await audit({ businessId: business.id, userId, actor, action: 'order.create', entity: 'Order', entityId: order.id, data: { number, total: priced.total, channel, kind } }, tx);
    return order;
  });
}

async function releaseReservations(tx, orderId, status = 'RELEASED') {
  await tx.stockReservation.updateMany({ where: { orderId, status: 'ACTIVE' }, data: { status } });
}

// Converts an order into a completed sale/invoice. Prices are those locked on the order.
async function completeOrder(business, user, orderId, { payments } = {}) {
  const order = await prisma.order.findFirst({ where: { id: orderId, businessId: business.id }, include: { items: true, sale: true } });
  if (!order) throw notFound('Order not found');
  if (order.sale) throw conflict('Order is already invoiced');
  if (order.status === 'CANCELLED') throw badRequest('Order is cancelled');

  // Release the reservation first so the sale's own stock check sees the reserved quantity as available.
  await prisma.$transaction((tx) => releaseReservations(tx, order.id, 'CONSUMED'));
  try {
    const pays = payments?.length ? payments : order.paymentStatus === 'PAID' ? [{ method: 'ONLINE', amount: n(order.total), reference: order.paymentRef }] : [];
    const sale = await createSale(business, user, {
      customer: order.customerId ? { id: order.customerId } : null,
      items: order.items.map((i) => ({ productId: i.productId, qty: n(i.qty), unitPrice: n(i.unitPrice) })),
      payments: pays, channel: order.channel, orderId: order.id, notes: order.notes, lockedPrices: true,
    });
    await prisma.order.update({ where: { id: order.id }, data: { status: 'COMPLETED', kind: 'ORDER', paymentStatus: sale.paymentStatus } });
    return sale;
  } catch (e) {
    await prisma.stockReservation.updateMany({ where: { orderId: order.id, status: 'CONSUMED' }, data: { status: 'ACTIVE' } });
    throw e;
  }
}

async function updateOrderStatus(business, user, orderId, status, extra = {}) {
  const order = await prisma.order.findFirst({ where: { id: orderId, businessId: business.id } });
  if (!order) throw notFound('Order not found');
  if (order.status === status) return order;
  if (!TRANSITIONS[order.status].includes(status)) throw badRequest(`Cannot move order from ${order.status} to ${status}`);
  if (status === 'COMPLETED') {
    await completeOrder(business, user, orderId, extra);
    return prisma.order.findUnique({ where: { id: orderId } });
  }
  return prisma.$transaction(async (tx) => {
    if (status === 'CANCELLED') await releaseReservations(tx, orderId);
    const updated = await tx.order.update({ where: { id: orderId }, data: { status } });
    await audit({ businessId: business.id, userId: user?.id, action: 'order.status', entity: 'Order', entityId: orderId, data: { from: order.status, to: status } }, tx);
    return updated;
  });
}

module.exports = { placeOrder, completeOrder, updateOrderStatus, TRANSITIONS };
