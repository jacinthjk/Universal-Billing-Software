// Automated daily visual report: branded 1080×1920 PNG (mobile-readable) + optional PDF wrapper.
const { prisma } = require('../lib/prisma');
const storage = require('../lib/storage');
const { iconSvg } = require('../lib/iconPaths');
const { esc, svgToPng, fit, onColor, FONT_STACK } = require('../lib/svg');
const { money, todayIn } = require('../lib/util');
const { dailyMetrics } = require('./reports');
const { notify } = require('../lib/audit');

// Validated categorical palette (light surface) - fixed order, never cycled.
const SERIES = ['#2a78d6', '#eb6834', '#1baf7a', '#eda100', '#e87ba4', '#008300'];
const INK = '#0b0b0b';
const INK2 = '#52514e';
const MUTED = '#8a8984';
const CARD = '#f5f5f3';
const GRID = '#e4e3df';

const W = 1080;
const H = 1920;
const P = 44;

function compact(v, currency) {
  const abs = Math.abs(v);
  const sym = { INR: '₹', USD: '$', EUR: '€', GBP: '£' }[currency] ?? '';
  if (currency === 'INR') {
    if (abs >= 1e7) return `${sym}${(v / 1e7).toFixed(2)}Cr`;
    if (abs >= 1e5) return `${sym}${(v / 1e5).toFixed(2)}L`;
  }
  if (abs >= 1e6) return `${sym}${(v / 1e6).toFixed(1)}M`;
  if (abs >= 1e3) return `${sym}${(v / 1e3).toFixed(1)}K`;
  return `${sym}${Math.round(v)}`;
}

// KPI money: whole units with grouping (e.g. ₹3,932) - the card is too narrow for paise.
function kpiMoney(v, currency) {
  return money(Math.round(v), currency).replace(/\.00$/, '');
}

function card(x, y, w, h, title) {
  return `<rect x="${x}" y="${y}" width="${w}" height="${h}" rx="22" fill="${CARD}"/>${title ? `<text x="${x + 24}" y="${y + 42}" font-size="22" font-weight="700" fill="${INK2}" letter-spacing="1.5">${esc(title.toUpperCase())}</text>` : ''}`;
}

function kpi(x, y, w, label, value, sub, subColor = MUTED) {
  return `${card(x, y, w, 150)}
    <text x="${x + 24}" y="${y + 42}" font-size="21" fill="${INK2}">${esc(label)}</text>
    <text x="${x + 24}" y="${y + 98}" font-size="${String(value).length > 8 ? 36 : 44}" font-weight="800" fill="${INK}">${esc(value)}</text>
    ${sub ? `<text x="${x + 24}" y="${y + 132}" font-size="20" fill="${subColor}">${esc(sub)}</text>` : ''}`;
}

function lineChart(x, y, w, h, data, color, currency) {
  const max = Math.max(...data.map((d) => d.sales), 1);
  const left = x + 24;
  const right = x + w - 24;
  const top = y + 70;
  const bottom = y + h - 50;
  const step = (right - left) / Math.max(data.length - 1, 1);
  const pts = data.map((d, i) => [left + i * step, bottom - (d.sales / max) * (bottom - top)]);
  const path = pts.map((p, i) => `${i ? 'L' : 'M'}${p[0].toFixed(1)},${p[1].toFixed(1)}`).join(' ');
  const area = `${path} L${pts[pts.length - 1][0]},${bottom} L${pts[0][0]},${bottom} Z`;
  const grid = [0, 0.5, 1].map((f) => {
    const gy = bottom - f * (bottom - top);
    return `<line x1="${left}" x2="${right}" y1="${gy}" y2="${gy}" stroke="${GRID}" stroke-width="1"/><text x="${right}" y="${gy - 6}" font-size="17" fill="${MUTED}" text-anchor="end">${esc(compact(max * f, currency))}</text>`;
  }).join('');
  // ~7 date labels whatever the range length, always including the last day.
  const every = Math.max(Math.ceil(data.length / 7), 1);
  const labels = data.map((d, i) => ((data.length - 1 - i) % every === 0 ? `<text x="${pts[i][0]}" y="${bottom + 30}" font-size="17" fill="${MUTED}" text-anchor="middle">${d.date.slice(8)}/${d.date.slice(5, 7)}</text>` : '')).join('');
  const last = pts[pts.length - 1];
  return `${grid}<path d="${area}" fill="${color}" opacity="0.10"/><path d="${path}" fill="none" stroke="${color}" stroke-width="3" stroke-linejoin="round" stroke-linecap="round"/>
    <circle cx="${last[0]}" cy="${last[1]}" r="7" fill="${color}" stroke="#fff" stroke-width="3"/>${labels}`;
}

function donut(cx, cy, r, thickness, slices) {
  const total = slices.reduce((s, x) => s + x.value, 0);
  if (!total) return `<circle cx="${cx}" cy="${cy}" r="${r - thickness / 2}" fill="none" stroke="${GRID}" stroke-width="${thickness}"/>`;
  let a0 = -Math.PI / 2;
  const gap = slices.length > 1 ? 0.02 : 0; // 2px-ish surface gap between segments
  return slices.map((s) => {
    const frac = s.value / total;
    const a1 = a0 + frac * Math.PI * 2;
    const rr = r - thickness / 2;
    let out;
    if (frac >= 0.999) out = `<circle cx="${cx}" cy="${cy}" r="${rr}" fill="none" stroke="${s.color}" stroke-width="${thickness}"/>`;
    else {
      const [s0, s1] = [a0 + gap, a1 - gap];
      const large = s1 - s0 > Math.PI ? 1 : 0;
      out = `<path d="M${cx + rr * Math.cos(s0)},${cy + rr * Math.sin(s0)} A${rr},${rr} 0 ${large} 1 ${cx + rr * Math.cos(s1)},${cy + rr * Math.sin(s1)}" fill="none" stroke="${s.color}" stroke-width="${thickness}"/>`;
    }
    a0 = a1;
    return out;
  }).join('');
}

function hbars(x, y, w, rows, color, fmt, max = 5) {
  const list = rows.slice(0, max);
  const top = Math.max(...list.map((r) => r.value), 1);
  const labelW = w * 0.42;
  const barW = w - labelW - 120;
  return list.map((r, i) => {
    const by = y + i * 52;
    const bw = Math.max((r.value / top) * barW, 4);
    return `<text x="${x}" y="${by + 26}" font-size="21" fill="${INK}">${esc(fit(r.label, labelW - 10, 21))}</text>
      <rect x="${x + labelW}" y="${by + 8}" width="${bw}" height="24" rx="4" fill="${color}"/>
      <text x="${x + labelW + bw + 10}" y="${by + 27}" font-size="19" fill="${INK2}">${esc(fmt(r.value))}</text>`;
  }).join('') || `<text x="${x}" y="${y + 26}" font-size="21" fill="${MUTED}">No sales recorded</text>`;
}

const longDate = (d) => new Intl.DateTimeFormat('en-IN', { dateStyle: 'medium', timeZone: 'UTC' }).format(new Date(`${d}T00:00:00Z`));

/** Visual report. variant 'daily' = one business day; 'overview' = a date range (Reports → Overview). */
async function renderReportSvg(business, m, generatedAt, { variant = 'daily' } = {}) {
  const overview = variant === 'overview';
  const primary = business.theme.primary || '#2563eb';
  const on = onColor(primary);
  const cur = business.currency;
  const fmt = (v) => compact(v, cur);
  const t = business.terminology;
  const parts = [`<rect width="${W}" height="${H}" fill="#ffffff"/>`];

  // Header
  parts.push(`<rect width="${W}" height="200" fill="${primary}"/>`);
  let nameX = P;
  const logo = await storage.readPublicImage(business.logoUrl).catch(() => null);
  if (logo) {
    const mime = logo[0] === 0x89 ? 'image/png' : 'image/jpeg';
    parts.push(`<image href="data:${mime};base64,${logo.toString('base64')}" x="${P}" y="44" width="110" height="110"/>`);
    nameX = P + 132;
  } else {
    // No logo: the business icon on a white badge.
    parts.push(`<rect x="${P}" y="46" width="106" height="106" rx="24" fill="#ffffff"/>`);
    parts.push(iconSvg(business.theme.icon || 'Store', P + 25, 71, 56, primary, { strokeWidth: 1.8 }));
    nameX = P + 132;
  }
  const subtitle = overview
    ? `Business Overview · ${m.from === m.to ? longDate(m.from) : `${longDate(m.from)} – ${longDate(m.to)}`}`
    : `Daily Business Report · ${new Intl.DateTimeFormat('en-IN', { dateStyle: 'full', timeZone: 'UTC' }).format(new Date(`${m.date}T00:00:00Z`))}`;
  parts.push(`<text x="${nameX}" y="92" font-size="44" font-weight="800" fill="${on}">${esc(fit(business.name, W - nameX - 300, 44))}</text>`);
  parts.push(`<text x="${nameX}" y="138" font-size="25" fill="${on}" opacity="0.9">${esc(fit(subtitle, W - nameX - 250, 25))}</text>`);
  parts.push(`<text x="${W - P}" y="92" font-size="20" fill="${on}" opacity="0.85" text-anchor="end">Generated</text>`);
  parts.push(`<text x="${W - P}" y="120" font-size="20" fill="${on}" opacity="0.85" text-anchor="end">${esc(generatedAt)}</text>`);

  // KPI row
  const kw = (W - 2 * P - 3 * 18) / 4;
  const delta = m.prevSales?.net ? ((m.sales.net - m.prevSales.net) / m.prevSales.net) * 100 : null;
  const deltaText = overview ? `${m.trend.length} day${m.trend.length === 1 ? '' : 's'}` : delta === null ? 'vs yesterday: —' : `${delta >= 0 ? '▲' : '▼'} ${Math.abs(delta).toFixed(0)}% vs yesterday`;
  parts.push(kpi(P, 224, kw, 'Net sales', kpiMoney(m.sales.net, cur), deltaText, delta === null || overview ? MUTED : delta >= 0 ? '#0f7a3d' : '#b42318'));
  parts.push(kpi(P + (kw + 18), 224, kw, `${t.invoice}s`, String(m.sales.bills), `Gross ${fmt(m.sales.gross)}`));
  parts.push(kpi(P + 2 * (kw + 18), 224, kw, `Avg ${t.invoice.toLowerCase()}`, kpiMoney(m.sales.avgBill, cur), m.sales.discount ? `Disc. ${fmt(m.sales.discount)}` : 'No discounts'));
  if (overview && m.margin) parts.push(kpi(P + 3 * (kw + 18), 224, kw, 'Gross profit', kpiMoney(m.margin.profit, cur), `${m.margin.pct}% margin`));
  else parts.push(kpi(P + 3 * (kw + 18), 224, kw, 'Online orders', String(m.online.orders), `${fmt(m.online.revenue)} revenue`));

  // Trend
  parts.push(card(P, 394, W - 2 * P, 330, overview ? `Sales trend · ${m.trend.length} days` : 'Sales trend · last 14 days'));
  parts.push(lineChart(P, 394, W - 2 * P, 330, m.trend, primary, cur));

  // Payments donut + customers
  const half = (W - 2 * P - 18) / 2;
  parts.push(card(P, 744, half, 340, 'Payments'));
  const pays = m.payments.slice(0, 4).map((p, i) => ({ label: p.method, value: p.amount, color: SERIES[i] }));
  const otherPay = m.payments.slice(4).reduce((s, p) => s + p.amount, 0);
  if (otherPay) pays.push({ label: 'Other', value: otherPay, color: SERIES[4] });
  parts.push(donut(P + 130, 744 + 195, 100, 34, pays));
  const payTotal = pays.reduce((s, p) => s + p.value, 0);
  parts.push(`<text x="${P + 130}" y="${744 + 192}" font-size="24" font-weight="800" fill="${INK}" text-anchor="middle">${esc(fmt(payTotal))}</text><text x="${P + 130}" y="${744 + 220}" font-size="17" fill="${MUTED}" text-anchor="middle">collected</text>`);
  pays.forEach((p, i) => {
    const ly = 744 + 110 + i * 46;
    parts.push(`<rect x="${P + 262}" y="${ly}" width="16" height="16" rx="4" fill="${p.color}"/><text x="${P + 288}" y="${ly + 15}" font-size="20" fill="${INK}">${esc(p.label)}</text><text x="${P + half - 24}" y="${ly + 15}" font-size="20" fill="${INK2}" text-anchor="end">${esc(fmt(p.value))}</text>`);
  });
  if (!pays.length) parts.push(`<text x="${P + 262}" y="${744 + 200}" font-size="20" fill="${MUTED}">No payments</text>`);

  const cx = P + half + 18;
  parts.push(card(cx, 744, half, 340, `${t.customers}`));
  const c = m.customers;
  parts.push(`<text x="${cx + 24}" y="${744 + 120}" font-size="54" font-weight="800" fill="${SERIES[2]}">${c.new}</text><text x="${cx + 24}" y="${744 + 152}" font-size="20" fill="${INK2}">New ${esc(t.customers.toLowerCase())}</text>`);
  parts.push(`<text x="${cx + half / 2}" y="${744 + 120}" font-size="54" font-weight="800" fill="${SERIES[0]}">${c.repeat}</text><text x="${cx + half / 2}" y="${744 + 152}" font-size="20" fill="${INK2}">Repeat visits</text>`);
  const totalV = Math.max(c.new + c.repeat, 1);
  const bw = half - 48;
  const nw = (c.new / totalV) * bw;
  if (c.new + c.repeat) {
    parts.push(`<rect x="${cx + 24}" y="${744 + 190}" width="${Math.max(nw - 1, 0)}" height="30" rx="4" fill="${SERIES[2]}"/><rect x="${cx + 24 + nw + 1}" y="${744 + 190}" width="${Math.max(bw - nw - 1, 0)}" height="30" rx="4" fill="${SERIES[0]}"/>`);
  } else parts.push(`<rect x="${cx + 24}" y="${744 + 190}" width="${bw}" height="30" rx="4" fill="${GRID}"/>`);
  parts.push(`<text x="${cx + 24}" y="${744 + 270}" font-size="20" fill="${INK2}">${c.visits} visits · ${c.added} profiles added</text>`);
  parts.push(`<text x="${cx + 24}" y="${744 + 302}" font-size="20" fill="${INK2}">Repeat share ${c.visits ? Math.round((c.repeat / c.visits) * 100) : 0}%</text>`);

  // Top products + categories
  parts.push(card(P, 1104, half, 340, `Top ${t.products.toLowerCase()} · value`));
  parts.push(hbars(P + 24, 1104 + 66, half - 48, m.topByValue.map((r) => ({ label: r.name, value: r.value })), primary, fmt));
  parts.push(card(cx, 1104, half, 340, 'Categories'));
  parts.push(hbars(cx + 24, 1104 + 66, half - 48, m.categories.map((r) => ({ label: r.name, value: r.value })), SERIES[0], fmt));

  // Stock / purchases / enquiries / AI
  const third = (W - 2 * P - 36) / 3;
  const s = m.stock;
  parts.push(card(P, 1464, third, 300, 'Stock'));
  parts.push(`<text x="${P + 24}" y="${1464 + 100}" font-size="40" font-weight="800" fill="${INK}">${esc(fmt(s.value))}</text><text x="${P + 24}" y="${1464 + 128}" font-size="19" fill="${INK2}">value · ${s.skus} SKUs</text>`);
  parts.push(`<text x="${P + 24}" y="${1464 + 178}" font-size="21" fill="#b42318">● ${s.out} out of stock</text><text x="${P + 24}" y="${1464 + 212}" font-size="21" fill="#9a6700">▲ ${s.low} low stock</text>`);
  s.alerts.slice(0, 2).forEach((a, i) => parts.push(`<text x="${P + 24}" y="${1464 + 250 + i * 26}" font-size="18" fill="${MUTED}">${esc(fit(`${a.name}: ${a.qty} ${a.unit}`, third - 48, 18))}</text>`));

  const x2 = P + third + 18;
  parts.push(card(x2, 1464, third, 300, 'Purchases'));
  parts.push(`<text x="${x2 + 24}" y="${1464 + 100}" font-size="40" font-weight="800" fill="${INK}">${esc(fmt(m.purchases.value))}</text><text x="${x2 + 24}" y="${1464 + 128}" font-size="19" fill="${INK2}">${m.purchases.count} purchase bills</text>`);
  m.purchases.suppliers.slice(0, 3).forEach((sp, i) => parts.push(`<text x="${x2 + 24}" y="${1464 + 178 + i * 32}" font-size="20" fill="${INK}">${esc(fit(sp.name, third - 150, 20))}</text><text x="${x2 + third - 24}" y="${1464 + 178 + i * 32}" font-size="20" fill="${INK2}" text-anchor="end">${esc(fmt(sp.value))}</text>`));

  const x3 = P + 2 * (third + 18);
  const e = m.enquiries;
  parts.push(card(x3, 1464, third, 300, 'Enquiries'));
  const funnel = [[overview ? 'New' : 'New today', e.new, SERIES[0]], ['Pending', e.pending, SERIES[3]], ['Converted', e.converted, SERIES[2]]];
  const fmax = Math.max(...funnel.map((f) => f[1]), 1);
  funnel.forEach(([label, val, col], i) => {
    const fy = 1464 + 78 + i * 62;
    parts.push(`<text x="${x3 + 24}" y="${fy + 20}" font-size="20" fill="${INK}">${label}</text><text x="${x3 + third - 24}" y="${fy + 20}" font-size="22" font-weight="700" fill="${INK}" text-anchor="end">${val}</text><rect x="${x3 + 24}" y="${fy + 30}" width="${Math.max(((third - 48) * val) / fmax, 4)}" height="14" rx="4" fill="${col}"/>`);
  });
  if (e.overdue) parts.push(`<text x="${x3 + 24}" y="${1464 + 280}" font-size="19" fill="#b42318">${e.overdue} follow-ups overdue</text>`);

  // AI strip
  if (m.ai) {
    const a = m.ai;
    parts.push(card(P, 1784, W - 2 * P, 100, null));
    parts.push(`<text x="${P + 24}" y="${1784 + 42}" font-size="22" font-weight="700" fill="${INK2}" letter-spacing="1.5">AI ASSISTANT</text>`);
    const stats = [['Chats', a.conversations], ['Leads', a.leads], ['Qualified', a.qualified], ['Handoffs', a.handoffs], ['Converted', `${a.conversionRate}%`]];
    stats.forEach(([l, v], i) => {
      const sx = P + 24 + i * ((W - 2 * P - 48) / 5);
      parts.push(`<text x="${sx}" y="${1784 + 82}" font-size="26" font-weight="800" fill="${INK}">${esc(String(v))}</text><text x="${sx + String(v).length * 19 + 14}" y="${1784 + 82}" font-size="19" fill="${INK2}">${esc(l)}</text>`);
    });
    if (a.topAsked.length) parts.push(`<text x="${W - P - 24}" y="${1784 + 42}" font-size="18" fill="${MUTED}" text-anchor="end">Most asked: ${esc(fit(a.topAsked.map((q) => q.query).join(', '), 520, 18))}</text>`);
  }

  parts.push(`<text x="${W / 2}" y="${H - 14}" font-size="16" fill="${MUTED}" text-anchor="middle">Figures exclude cancelled ${esc(t.invoice.toLowerCase())}s · net sales = gross − returns</text>`);
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}" font-family="${FONT_STACK}">${parts.join('')}</svg>`;
}

// Stored report files: private/<businessId>/reports/<date>.<png|pdf|xlsx>
const reportPath = (businessId, date, ext) => `private/${businessId}/reports/${date}.${ext}`;

/** Computes, renders and stores the daily report for a business/date (idempotent per date). */
async function generateDailyReport(business, date = todayIn(business.timezone)) {
  const metrics = await dailyMetrics(business, date);
  const generatedAt = new Intl.DateTimeFormat('en-IN', { timeZone: business.timezone, dateStyle: 'medium', timeStyle: 'short' }).format(new Date());
  const svg = await renderReportSvg(business, metrics, generatedAt);
  const png = svgToPng(svg);
  // Loaded here to avoid a circular import (reportExports reuses this module's renderer).
  const { buildPdf, buildWorkbook } = require('./reportExports');
  const pngPath = reportPath(business.id, date, 'png');
  const pdfPath = reportPath(business.id, date, 'pdf');
  await storage.put(pngPath, png);
  await storage.put(pdfPath, await buildPdf(business, metrics, png, { variant: 'daily' }));
  await storage.put(reportPath(business.id, date, 'xlsx'), await buildWorkbook(business, metrics, { variant: 'daily' }));
  const report = await prisma.dailyReport.upsert({
    where: { businessId_date: { businessId: business.id, date } },
    create: { businessId: business.id, date, pngPath, pdfPath, data: metrics },
    update: { pngPath, pdfPath, data: metrics, createdAt: new Date() },
  });
  await notify(business.id, { type: 'REPORT', title: `Daily report ready · ${date}`, body: `Net sales ${money(metrics.sales.net, business.currency)} from ${metrics.sales.bills} bills`, link: `/reports?tab=daily` });
  return report;
}

module.exports = { generateDailyReport, renderReportSvg, reportPath };
