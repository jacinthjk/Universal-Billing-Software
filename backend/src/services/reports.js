// Reusable metrics engine for dashboards, report screens and the automated daily report.
const { prisma } = require('../lib/prisma');
const { n, round2, dayRange, addDays, todayIn } = require('../lib/util');
const { stockStatus } = require('./stock');

const ACTIVE_SALE = { not: 'CANCELLED' };

async function salesSummary(businessId, start, end) {
  const where = { businessId, createdAt: { gte: start, lt: end }, status: ACTIVE_SALE };
  const [agg, returns] = await Promise.all([
    prisma.sale.aggregate({ where, _sum: { subtotal: true, discount: true, tax: true, total: true }, _count: true }),
    prisma.saleReturn.aggregate({ where: { businessId, createdAt: { gte: start, lt: end } }, _sum: { total: true } }),
  ]);
  const gross = round2(n(agg._sum.total));
  const returned = round2(n(returns._sum.total));
  const bills = agg._count;
  return {
    gross, returns: returned, net: round2(gross - returned), bills, avgBill: bills ? round2(gross / bills) : 0,
    discount: round2(n(agg._sum.discount)), tax: round2(n(agg._sum.tax)),
  };
}

async function paymentsByMethod(businessId, start, end) {
  const rows = await prisma.payment.groupBy({
    by: ['method'],
    where: { createdAt: { gte: start, lt: end }, sale: { businessId, status: ACTIVE_SALE } },
    _sum: { amount: true },
  });
  return rows.map((r) => ({ method: r.method, amount: round2(n(r._sum.amount)) })).sort((a, b) => b.amount - a.amount);
}

async function itemPerformance(businessId, start, end) {
  const rows = await prisma.saleItem.groupBy({
    by: ['productId'],
    where: { sale: { businessId, createdAt: { gte: start, lt: end }, status: ACTIVE_SALE } },
    _sum: { qty: true, lineTotal: true, returnedQty: true },
  });
  const products = await prisma.product.findMany({
    where: { businessId, id: { in: rows.map((r) => r.productId) } },
    select: { id: true, name: true, unit: true, category: { select: { name: true } } },
  });
  const byId = Object.fromEntries(products.map((p) => [p.id, p]));
  const items = rows.map((r) => ({
    productId: r.productId, name: byId[r.productId]?.name || 'Deleted item', unit: byId[r.productId]?.unit,
    category: byId[r.productId]?.category?.name || 'Uncategorized', qty: n(r._sum.qty) - n(r._sum.returnedQty), value: round2(n(r._sum.lineTotal)),
  }));
  const catMap = {};
  for (const it of items) catMap[it.category] = round2((catMap[it.category] || 0) + it.value);
  return {
    topByValue: [...items].sort((a, b) => b.value - a.value).slice(0, 10),
    topByQty: [...items].sort((a, b) => b.qty - a.qty).slice(0, 10),
    categories: Object.entries(catMap).map(([name, value]) => ({ name, value })).sort((a, b) => b.value - a.value),
  };
}

async function dailyTrend(business, endDate, days = 14) {
  const out = [];
  const start = dayRange(addDays(endDate, -(days - 1)), business.timezone).start;
  const end = dayRange(endDate, business.timezone).end;
  const sales = await prisma.sale.findMany({
    where: { businessId: business.id, createdAt: { gte: start, lt: end }, status: ACTIVE_SALE },
    select: { createdAt: true, total: true },
  });
  const map = {};
  for (const s of sales) {
    const d = todayIn(business.timezone, s.createdAt);
    map[d] = round2((map[d] || 0) + n(s.total));
  }
  for (let i = days - 1; i >= 0; i -= 1) {
    const d = addDays(endDate, -i);
    out.push({ date: d, sales: map[d] || 0 });
  }
  return out;
}

async function stockSnapshot(businessId) {
  const products = await prisma.product.findMany({
    where: { businessId, active: true, trackStock: true, kind: 'PRODUCT' },
    select: { id: true, name: true, unit: true, stockQty: true, reorderLevel: true, costPrice: true, trackStock: true, kind: true },
  });
  let value = 0;
  const alerts = [];
  for (const p of products) {
    value += Math.max(n(p.stockQty), 0) * n(p.costPrice);
    const st = stockStatus(p);
    if (st === 'LOW' || st === 'OUT') alerts.push({ id: p.id, name: p.name, qty: n(p.stockQty), unit: p.unit, reorderLevel: n(p.reorderLevel), status: st });
  }
  alerts.sort((a, b) => (a.status === b.status ? a.qty - b.qty : a.status === 'OUT' ? -1 : 1));
  const soon = new Date(Date.now() + 30 * 86400000);
  const expiring = await prisma.productBatch.count({ where: { businessId, qty: { gt: 0 }, expiryDate: { lte: soon } } });
  return {
    skus: products.length, value: round2(value), low: alerts.filter((a) => a.status === 'LOW').length,
    out: alerts.filter((a) => a.status === 'OUT').length, alerts: alerts.slice(0, 20), expiringSoon: expiring,
  };
}

async function purchasesSummary(businessId, start, end) {
  const where = { businessId, date: { gte: start, lt: end }, status: { in: ['RECEIVED', 'RETURNED'] } };
  const [agg, bySupplier] = await Promise.all([
    prisma.purchase.aggregate({ where, _sum: { total: true }, _count: true }),
    prisma.purchase.groupBy({ by: ['supplierId'], where, _sum: { total: true } }),
  ]);
  const suppliers = await prisma.supplier.findMany({ where: { id: { in: bySupplier.map((s) => s.supplierId).filter(Boolean) } }, select: { id: true, name: true } });
  const names = Object.fromEntries(suppliers.map((s) => [s.id, s.name]));
  return {
    value: round2(n(agg._sum.total)), count: agg._count,
    suppliers: bySupplier.map((s) => ({ name: names[s.supplierId] || 'Direct', value: round2(n(s._sum.total)) })).sort((a, b) => b.value - a.value).slice(0, 5),
  };
}

async function customerSummary(businessId, start, end) {
  const visits = await prisma.customerVisit.findMany({ where: { businessId, createdAt: { gte: start, lt: end } }, select: { visitNumber: true } });
  const newCount = visits.filter((v) => v.visitNumber === 1).length;
  const added = await prisma.customer.count({ where: { businessId, createdAt: { gte: start, lt: end } } });
  return { visits: visits.length, new: newCount, repeat: visits.length - newCount, added };
}

async function enquirySummary(businessId, start, end) {
  const [created, pending, converted, bySource, overdue] = await Promise.all([
    prisma.enquiry.count({ where: { businessId, createdAt: { gte: start, lt: end } } }),
    prisma.enquiry.count({ where: { businessId, status: { notIn: ['CONVERTED', 'CLOSED'] } } }),
    prisma.enquiry.count({ where: { businessId, status: 'CONVERTED', updatedAt: { gte: start, lt: end } } }),
    prisma.enquiry.groupBy({ by: ['source'], where: { businessId, createdAt: { gte: start, lt: end } }, _count: true }),
    prisma.enquiry.count({ where: { businessId, status: { notIn: ['CONVERTED', 'CLOSED'] }, followUpAt: { lt: new Date() } } }),
  ]);
  return { new: created, pending, converted, overdue, bySource: bySource.map((s) => ({ source: s.source, count: s._count })) };
}

async function onlineOrderSummary(businessId, start, end) {
  const where = { businessId, createdAt: { gte: start, lt: end }, kind: 'ORDER', channel: { not: 'POS' } };
  const [agg, pending, byStatus] = await Promise.all([
    prisma.order.aggregate({ where: { ...where, status: { not: 'CANCELLED' } }, _sum: { total: true }, _count: true }),
    prisma.order.count({ where: { businessId, status: { in: ['PENDING', 'CONFIRMED', 'PROCESSING', 'READY'] } } }),
    prisma.order.groupBy({ by: ['status'], where, _count: true }),
  ]);
  return { orders: agg._count, revenue: round2(n(agg._sum.total)), pending, byStatus: byStatus.map((s) => ({ status: s.status, count: s._count })) };
}

async function aiSummary(businessId, start, end) {
  const [conversations, leads, qualified, handoffs, aiOrders, searches, uncertain] = await Promise.all([
    prisma.aiConversation.count({ where: { businessId, createdAt: { gte: start, lt: end } } }),
    prisma.enquiry.count({ where: { businessId, createdByAi: true, createdAt: { gte: start, lt: end } } }),
    prisma.enquiry.count({ where: { businessId, createdByAi: true, createdAt: { gte: start, lt: end }, leadScore: { gte: 40 } } }),
    prisma.aiConversation.count({ where: { businessId, status: 'HANDOFF', updatedAt: { gte: start, lt: end } } }),
    prisma.order.aggregate({ where: { businessId, createdByAi: true, createdAt: { gte: start, lt: end }, status: { not: 'CANCELLED' } }, _count: true, _sum: { total: true } }),
    prisma.aiToolCall.findMany({ where: { businessId, tool: { in: ['search_products', 'get_product_details', 'check_stock'] }, createdAt: { gte: start, lt: end } }, select: { input: true }, take: 500 }),
    prisma.aiConversation.count({ where: { businessId, uncertain: true, updatedAt: { gte: start, lt: end } } }),
  ]);
  const asked = {};
  for (const s of searches) {
    const q = String(s.input?.query || s.input?.name || '').toLowerCase().trim();
    if (q) asked[q] = (asked[q] || 0) + 1;
  }
  const converted = await prisma.enquiry.count({ where: { businessId, createdByAi: true, createdAt: { gte: start, lt: end }, status: 'CONVERTED' } });
  return {
    conversations, leads, qualified, handoffs, uncertain, converted,
    orders: aiOrders._count, revenue: round2(n(aiOrders._sum.total)),
    conversionRate: leads ? round2((converted / leads) * 100) : 0,
    topAsked: Object.entries(asked).sort((a, b) => b[1] - a[1]).slice(0, 5).map(([query, count]) => ({ query, count })),
  };
}

/** Full metric set for one business day (in the business's timezone). */
async function dailyMetrics(business, date) {
  const { start, end } = dayRange(date, business.timezone);
  const prev = dayRange(addDays(date, -1), business.timezone);
  const [sales, prevSales, payments, items, trend, stock, purchases, customers, enquiries, online, ai] = await Promise.all([
    salesSummary(business.id, start, end),
    salesSummary(business.id, prev.start, prev.end),
    paymentsByMethod(business.id, start, end),
    itemPerformance(business.id, start, end),
    dailyTrend(business, date, 14),
    stockSnapshot(business.id),
    purchasesSummary(business.id, start, end),
    customerSummary(business.id, start, end),
    enquirySummary(business.id, start, end),
    onlineOrderSummary(business.id, start, end),
    business.settings.modules.includes('ai') ? aiSummary(business.id, start, end) : null,
  ]);
  return { date, sales, prevSales, payments, ...items, trend, stock, purchases, customers, enquiries, online, ai };
}

/** Metrics for an arbitrary range (dashboard / reports screen). */
async function rangeMetrics(business, from, to) {
  const start = dayRange(from, business.timezone).start;
  const end = dayRange(to, business.timezone).end;
  const days = Math.min(Math.round((end - start) / 86400000), 366);
  const [sales, payments, items, trend, purchases, customers, enquiries, online] = await Promise.all([
    salesSummary(business.id, start, end),
    paymentsByMethod(business.id, start, end),
    itemPerformance(business.id, start, end),
    dailyTrend(business, to, Math.max(days, 1)),
    purchasesSummary(business.id, start, end),
    customerSummary(business.id, start, end),
    enquirySummary(business.id, start, end),
    onlineOrderSummary(business.id, start, end),
  ]);
  // Gross margin from cost captured on each sale line.
  const lines = await prisma.saleItem.findMany({
    where: { sale: { businessId: business.id, createdAt: { gte: start, lt: end }, status: ACTIVE_SALE } },
    select: { qty: true, returnedQty: true, costPrice: true, lineTotal: true, taxAmount: true },
  });
  let revenueExTax = 0;
  let cost = 0;
  for (const l of lines) {
    const keep = n(l.qty) ? (n(l.qty) - n(l.returnedQty)) / n(l.qty) : 0;
    revenueExTax += (n(l.lineTotal) - n(l.taxAmount)) * keep;
    cost += n(l.costPrice) * (n(l.qty) - n(l.returnedQty));
  }
  return {
    from, to, sales, payments, ...items, trend, purchases, customers, enquiries, online,
    margin: { revenue: round2(revenueExTax), cost: round2(cost), profit: round2(revenueExTax - cost), pct: revenueExTax ? round2(((revenueExTax - cost) / revenueExTax) * 100) : 0 },
  };
}

module.exports = { dailyMetrics, rangeMetrics, stockSnapshot, aiSummary, salesSummary };
