// Report image drawn as a spreadsheet: column letters, row numbers, gridlines and header rows,
// so the PNG sent on WhatsApp reads like the Excel file's Summary sheet. Height grows with the rows.
const { esc, fit, onColor, FONT_STACK } = require('../lib/svg');
const { money } = require('../lib/util');

const W = 1080;
const ROWNUM_W = 56;
const COLS = [432, 200, 196, 196]; // A-D; sum + ROWNUM_W = W
const ROW_H = 44;
const HEAD_H = 34; // column-letter strip
const TAB_H = 52; // sheet tabs strip
const FS = 21;
const GRID = '#dadce0';
const HEADER_BG = '#f3f4f6';
const INK = '#1f2328';
const MUTED = '#6b7280';
const RED = '#b42318';
const AMBER = '#9a6700';
const GREEN = '#0f7a3d';
const OVERDUE_FILL = '#fde2e2';
const SECTION_FILL = '#eef1f4';

const whole = (v, cur) => money(Math.round(v || 0), cur).replace(/\.00$/, '');
const pct = (v) => `${Math.round(v * 10) / 10}%`;
const change = (now, before) => {
  if (!before) return { text: '—', color: MUTED };
  const d = ((now - before) / Math.abs(before)) * 100;
  return { text: `${d >= 0 ? '▲' : '▼'} ${Math.abs(d).toFixed(0)}%`, color: d >= 0 ? GREEN : RED };
};
const longDate = (d) => new Intl.DateTimeFormat('en-IN', { dateStyle: 'medium', timeZone: 'UTC' }).format(new Date(`${d}T00:00:00Z`));

// Row builders. A cell is a string or { v, align, color, bold }.
const title = (text, color) => ({ kind: 'title', text, color });
const note = (text, color = MUTED) => ({ kind: 'note', text, color });
const blank = () => ({ kind: 'blank' });
const head = (...cells) => ({ kind: 'head', cells });
const section = (text) => ({ kind: 'section', text });
const row = (cells, extra = {}) => ({ kind: 'row', cells, ...extra });
const num = (v, extra = {}) => ({ v, align: 'end', ...extra });

/** The rows of the report: same figures as the Excel Summary sheet, plus short lists. */
function buildRows(business, m, generatedAt, overview) {
  const t = business.terminology;
  const cur = business.currency;
  const brand = business.theme.primary || '#2563eb';
  const inv = t.invoice.toLowerCase();
  const rows = [];
  const period = overview ? (m.from === m.to ? longDate(m.from) : `${longDate(m.from)} to ${longDate(m.to)}`) : longDate(m.date);
  rows.push(title(`${business.name} - ${overview ? 'Business Overview' : 'Daily Business Report'}`, brand));
  rows.push(note(`${period}   ·   Generated ${generatedAt}   ·   ${cur}`));
  rows.push(blank());

  // Key figures, with yesterday side by side on the daily report.
  const p = !overview ? m.prevSales : null;
  if (p) {
    rows.push(head('Key figures', 'Today', 'Yesterday', 'Change'));
    const line = (label, a, b, fmt) => { const c = change(a, b); return row([label, num(fmt(a), { bold: label === 'Net sales' }), num(fmt(b), { color: MUTED }), num(c.text, { color: c.color })]); };
    rows.push(line('Net sales', m.sales.net, p.net, (v) => whole(v, cur)));
    rows.push(line('Gross sales', m.sales.gross, p.gross, (v) => whole(v, cur)));
    rows.push(line(`${t.invoice}s`, m.sales.bills, p.bills, String));
    rows.push(line(`Average ${inv}`, m.sales.avgBill, p.avgBill, (v) => whole(v, cur)));
    rows.push(line('Returns', m.sales.returns, p.returns, (v) => whole(v, cur)));
    rows.push(line('Discounts given', m.sales.discount, p.discount, (v) => whole(v, cur)));
    rows.push(line('Tax collected', m.sales.tax, p.tax, (v) => whole(v, cur)));
  } else {
    rows.push(head('Key figures', '', '', 'Value'));
    const line = (label, v, bold) => row([label, '', '', num(v, { bold })]);
    rows.push(line('Net sales', whole(m.sales.net, cur), true));
    rows.push(line('Gross sales', whole(m.sales.gross, cur)));
    rows.push(line(`${t.invoice}s`, String(m.sales.bills)));
    rows.push(line(`Average ${inv}`, whole(m.sales.avgBill, cur)));
    rows.push(line('Returns', whole(m.sales.returns, cur)));
    rows.push(line('Discounts given', whole(m.sales.discount, cur)));
    rows.push(line('Tax collected', whole(m.sales.tax, cur)));
    if (m.margin) rows.push(line(`Gross profit (${m.margin.pct}% margin)`, whole(m.margin.profit, cur), true));
  }
  rows.push(blank());

  // Payments
  const payTotal = m.payments.reduce((s, x) => s + x.amount, 0);
  rows.push(head('Payments received', '', 'Share', 'Amount'));
  if (!m.payments.length) rows.push(row([{ v: 'No payments', color: MUTED }, '', '', '']));
  m.payments.forEach((x) => rows.push(row([x.method, '', num(payTotal ? pct((x.amount / payTotal) * 100) : '—', { color: MUTED }), num(whole(x.amount, cur))])));
  if (m.payments.length > 1) rows.push(row([{ v: 'Total', bold: true }, '', '', num(whole(payTotal, cur), { bold: true })]));
  rows.push(blank());

  // Top sellers
  rows.push(head(`Top ${t.products.toLowerCase()}`, 'Quantity', 'Share', 'Value'));
  const sold = m.topByValue.reduce((s, x) => s + x.value, 0);
  if (!m.topByValue.length) rows.push(row([{ v: 'No sales recorded', color: MUTED }, '', '', '']));
  m.topByValue.slice(0, 5).forEach((x, i) => rows.push(row([`${i + 1}. ${x.name}`, num(`${x.qty} ${x.unit || ''}`.trim()), num(sold ? pct((x.value / sold) * 100) : '—', { color: MUTED }), num(whole(x.value, cur))])));
  rows.push(blank());

  // Everything else as label / value pairs, grouped like the Excel summary.
  rows.push(head('Other figures', '', '', 'Value'));
  const pair = (label, v, color) => row([label, '', '', num(v, { color })]);
  rows.push(section(t.customers));
  rows.push(pair(`New ${t.customers.toLowerCase()}`, String(m.customers.new)));
  rows.push(pair('Repeat visits', String(m.customers.repeat)));
  rows.push(section('Online orders & enquiries'));
  rows.push(pair('Online orders', `${m.online.orders} · ${whole(m.online.revenue, cur)}`));
  rows.push(pair('Orders waiting for action', String(m.online.pending), m.online.pending ? AMBER : undefined));
  rows.push(pair('New enquiries', String(m.enquiries.new)));
  rows.push(pair('Follow-ups overdue', String(m.enquiries.overdue), m.enquiries.overdue ? RED : undefined));
  if (m.purchases) {
    rows.push(section('Purchases'));
    rows.push(pair('Purchase value', whole(m.purchases.value, cur)));
    rows.push(pair('Purchase bills', String(m.purchases.count)));
  }
  if (m.ai) {
    rows.push(section('AI assistant'));
    rows.push(pair('Chats · leads · converted', `${m.ai.conversations} · ${m.ai.leads} · ${m.ai.converted}`));
  }
  rows.push(blank());

  // Stock alerts
  if (m.stock) {
    rows.push(head('Stock alerts', '', 'In stock', 'Status'));
    if (!m.stock.alerts.length) rows.push(row([{ v: 'Everything is well stocked', color: GREEN }, '', '', '']));
    m.stock.alerts.slice(0, 5).forEach((a) => rows.push(row([a.name, '', num(`${a.qty} ${a.unit || ''}`.trim()), num(a.status === 'OUT' ? 'Out of stock' : 'Low stock', { color: a.status === 'OUT' ? RED : AMBER, bold: true })])));
    if (m.stock.alerts.length > 5) rows.push(note(`+ ${m.stock.alerts.length - 5} more in the Excel file`));
    rows.push(blank());
  }

  // Outstanding bills: oldest first, more than 30 days shaded red (as in the Excel sheet).
  if (m.outstanding) {
    const o = m.outstanding;
    rows.push(head(`Outstanding ${inv}s`, t.invoice, 'Days', 'Balance due'));
    if (!o.bills.length) rows.push(row([{ v: `Every ${inv} is fully paid`, color: GREEN }, '', '', '']));
    o.bills.slice(0, 6).forEach((b) => rows.push(row([b.name, num(b.number), num(String(b.days), { color: b.overdue ? RED : INK, bold: b.overdue }), num(whole(b.due, cur))], { fill: b.overdue ? OVERDUE_FILL : null })));
    if (o.bills.length) {
      rows.push(row([{ v: `Total · ${o.totals.count} ${inv}s`, bold: true }, '', '', num(whole(o.totals.due, cur), { bold: true })]));
      rows.push(row([{ v: `Over ${o.overdueAfter} days · ${o.totals.overdueCount} ${inv}s`, color: RED, bold: true }, '', '', num(whole(o.totals.overdueDue, cur), { color: RED, bold: true })], { fill: o.totals.overdueCount ? OVERDUE_FILL : null }));
    }
    if (o.bills.length > 6) rows.push(note(`+ ${o.bills.length - 6} more in the Excel file`));
    rows.push(blank());
  }
  rows.push(note(`Figures exclude cancelled ${inv}s · net sales = gross − returns`));
  return rows;
}

/** Visual report as a spreadsheet image. variant 'daily' = one business day; 'overview' = a date range. */
function renderSheetSvg(business, m, generatedAt, { variant = 'daily' } = {}) {
  const brand = business.theme.primary || '#2563eb';
  const onBrand = onColor(brand);
  const rows = buildRows(business, m, generatedAt, variant === 'overview');
  const H = HEAD_H + rows.length * ROW_H + TAB_H;
  const xs = COLS.reduce((acc, w) => [...acc, acc[acc.length - 1] + w], [ROWNUM_W]); // column edges
  const out = [`<rect width="${W}" height="${H}" fill="#ffffff"/>`];

  // Column letters
  out.push(`<rect width="${W}" height="${HEAD_H}" fill="${HEADER_BG}"/>`);
  ['A', 'B', 'C', 'D'].forEach((l, i) => out.push(`<text x="${(xs[i] + xs[i + 1]) / 2}" y="${HEAD_H - 10}" font-size="17" fill="${MUTED}" text-anchor="middle">${l}</text>`));

  rows.forEach((r, i) => {
    const y = HEAD_H + i * ROW_H;
    const base = y + ROW_H / 2 + FS * 0.36;
    const fill = r.kind === 'head' ? brand : r.kind === 'section' ? SECTION_FILL : r.fill;
    if (fill) out.push(`<rect x="${ROWNUM_W}" y="${y}" width="${W - ROWNUM_W}" height="${ROW_H}" fill="${fill}"/>`);
    // Row number gutter
    out.push(`<rect x="0" y="${y}" width="${ROWNUM_W}" height="${ROW_H}" fill="${HEADER_BG}"/><text x="${ROWNUM_W / 2}" y="${base - 2}" font-size="16" fill="${MUTED}" text-anchor="middle">${i + 1}</text>`);
    // Text that spills across columns, as Excel shows long text in column A.
    if (['title', 'note', 'section'].includes(r.kind)) {
      const size = r.kind === 'title' ? 26 : r.kind === 'note' ? 18 : FS;
      const color = r.kind === 'section' ? INK : r.color;
      out.push(`<text x="${ROWNUM_W + 12}" y="${y + ROW_H / 2 + size * 0.36}" font-size="${size}" font-weight="${r.kind === 'note' ? 400 : 700}" fill="${color}">${esc(fit(r.text, W - ROWNUM_W - 24, size))}</text>`);
      return;
    }
    if (r.kind === 'blank') return;
    r.cells.forEach((c, j) => {
      const cell = typeof c === 'object' && c ? c : { v: c };
      if (cell.v === '' || cell.v === undefined || cell.v === null) return;
      const end = cell.align === 'end' || (r.kind === 'head' && j > 0); // headings line up with their numbers
      const color = r.kind === 'head' ? onBrand : cell.color || INK;
      const bold = r.kind === 'head' || cell.bold;
      const x = end ? xs[j + 1] - 12 : xs[j] + 12;
      out.push(`<text x="${x}" y="${base}" font-size="${FS}" font-weight="${bold ? 700 : 400}" fill="${color}"${end ? ' text-anchor="end"' : ''}>${esc(fit(cell.v, COLS[j] - 20, FS))}</text>`);
    });
  });

  // Gridlines over everything (text rows included, like a real sheet)
  const gridBottom = HEAD_H + rows.length * ROW_H;
  for (let i = 0; i <= rows.length; i += 1) out.push(`<line x1="0" x2="${W}" y1="${HEAD_H + i * ROW_H}" y2="${HEAD_H + i * ROW_H}" stroke="${GRID}" stroke-width="1"/>`);
  // Vertical lines per row; rows whose text spills across columns hide them, as Excel does.
  xs.forEach((x) => out.push(`<line x1="${x}" x2="${x}" y1="0" y2="${HEAD_H}" stroke="${GRID}" stroke-width="1"/>`));
  rows.forEach((r, i) => {
    const y = HEAD_H + i * ROW_H;
    const spill = ['title', 'note', 'section'].includes(r.kind);
    (spill ? [xs[0], xs[xs.length - 1]] : xs).forEach((x) => out.push(`<line x1="${x}" x2="${x}" y1="${y}" y2="${y + ROW_H}" stroke="${GRID}" stroke-width="1"/>`));
  });

  // Sheet tabs
  const ty = gridBottom;
  out.push(`<rect x="0" y="${ty}" width="${W}" height="${TAB_H}" fill="${HEADER_BG}"/><line x1="0" x2="${W}" y1="${ty}" y2="${ty}" stroke="#c4c7cc"/>`);
  out.push(`<rect x="${ROWNUM_W}" y="${ty}" width="150" height="${TAB_H - 10}" fill="#ffffff" stroke="#c4c7cc"/><rect x="${ROWNUM_W}" y="${ty + TAB_H - 13}" width="150" height="3" fill="${brand}"/>`);
  out.push(`<text x="${ROWNUM_W + 75}" y="${ty + 28}" font-size="18" font-weight="700" fill="${brand}" text-anchor="middle">Summary</text>`);
  out.push(`<text x="${W - 16}" y="${ty + 30}" font-size="16" fill="${MUTED}" text-anchor="end">${esc(business.slug)} · full details in the Excel file</text>`);

  return `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}" font-family="${FONT_STACK}">${out.join('')}</svg>`;
}

module.exports = { renderSheetSvg };
