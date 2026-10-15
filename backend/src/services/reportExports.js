// Report exports shared by the Overview report (any date range) and the daily visual report:
// PNG (visual), PDF (visual page + data tables) and Excel (one sheet per section).
const ExcelJS = require('exceljs');
const PDFDocument = require('pdfkit');
const { money, dayRange } = require('../lib/util');
const { svgToPng } = require('../lib/svg');
const { rangeMetrics, stockSnapshot, aiSummary } = require('./reports');
const { renderReportSvg } = require('./dailyReport');
const { FONT_FILES } = require('./invoiceLayout');

const generatedAtText = (business) => new Intl.DateTimeFormat('en-IN', { timeZone: business.timezone, dateStyle: 'medium', timeStyle: 'short' }).format(new Date());
const periodText = (m) => (m.date ? m.date : m.from === m.to ? m.from : `${m.from} to ${m.to}`);
const title = (variant) => (variant === 'overview' ? 'Business Overview' : 'Daily Business Report');

// Key figures as [label, value, kind] rows - used by both the Excel summary sheet and the PDF.
function summaryRows(business, m) {
  const t = business.terminology;
  const rows = [
    ['Sales', null, 'section'],
    ['Net sales', m.sales.net, 'money'], ['Gross sales', m.sales.gross, 'money'], ['Returns', m.sales.returns, 'money'],
    [`${t.invoice}s`, m.sales.bills, 'int'], [`Average ${t.invoice.toLowerCase()}`, m.sales.avgBill, 'money'],
    ['Discounts given', m.sales.discount, 'money'], ['Tax collected', m.sales.tax, 'money'],
  ];
  if (m.prevSales) rows.push(['Net sales (previous day)', m.prevSales.net, 'money']);
  if (m.margin) rows.push(['Profit', null, 'section'], ['Revenue (excl. tax)', m.margin.revenue, 'money'], ['Cost of goods', m.margin.cost, 'money'], ['Gross profit', m.margin.profit, 'money'], ['Gross margin %', m.margin.pct, 'pct']);
  rows.push(
    [t.customers, null, 'section'], ['Counted visits', m.customers.visits, 'int'], [`New ${t.customers.toLowerCase()}`, m.customers.new, 'int'],
    ['Repeat visits', m.customers.repeat, 'int'], ['Profiles added', m.customers.added, 'int'],
    ['Online orders', null, 'section'], ['Orders', m.online.orders, 'int'], ['Online revenue', m.online.revenue, 'money'], ['Awaiting action', m.online.pending, 'int'],
    ['Purchases', null, 'section'], ['Purchase value', m.purchases.value, 'money'], ['Purchase bills', m.purchases.count, 'int'],
    ['Enquiries', null, 'section'], ['New enquiries', m.enquiries.new, 'int'], ['Open now', m.enquiries.pending, 'int'], ['Converted', m.enquiries.converted, 'int'], ['Follow-ups overdue', m.enquiries.overdue, 'int'],
  );
  if (m.stock) {
    rows.push(['Stock (current)', null, 'section'], ['Tracked SKUs', m.stock.skus, 'int'], ['Stock value (cost)', m.stock.value, 'money'], ['Low stock items', m.stock.low, 'int'], ['Out of stock items', m.stock.out, 'int'], ['Batches expiring in 30 days', m.stock.expiringSoon, 'int']);
  }
  if (m.ai) {
    rows.push(['AI assistant', null, 'section'], ['Conversations', m.ai.conversations, 'int'], ['Leads captured', m.ai.leads, 'int'], ['Qualified leads', m.ai.qualified, 'int'], ['Human handoffs', m.ai.handoffs, 'int'], ['Converted', m.ai.converted, 'int'], ['Lead conversion %', m.ai.conversionRate, 'pct']);
  }
  return rows;
}

// ─────────────── Excel ───────────────

async function buildWorkbook(business, m, { variant = 'daily' } = {}) {
  const wb = new ExcelJS.Workbook();
  wb.creator = business.name;
  wb.created = new Date();
  const brand = (business.theme.primary || '#2563eb').replace('#', '').toUpperCase();
  const moneyFmt = business.currency === 'INR' ? '"₹"#,##0.00' : '#,##0.00';
  const t = business.terminology;

  const sheet = (name, columns, rows, { money: moneyCols = [], pct: pctCols = [] } = {}) => {
    const ws = wb.addWorksheet(name, { views: [{ state: 'frozen', ySplit: 4 }] });
    ws.getCell('A1').value = `${business.name} - ${title(variant)}`;
    ws.getCell('A1').font = { bold: true, size: 14, color: { argb: `FF${brand}` } };
    ws.getCell('A2').value = `Period: ${periodText(m)}   ·   Generated: ${generatedAtText(business)}`;
    ws.getCell('A2').font = { size: 10, color: { argb: 'FF666666' } };
    const header = ws.getRow(4);
    columns.forEach((c, i) => { header.getCell(i + 1).value = c.header; ws.getColumn(i + 1).width = c.width || 16; });
    header.eachCell((cell) => {
      cell.font = { bold: true, color: { argb: 'FFFFFFFF' } };
      cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: `FF${brand}` } };
      cell.alignment = { vertical: 'middle' };
    });
    rows.forEach((r) => ws.addRow(r));
    moneyCols.forEach((c) => { ws.getColumn(c).numFmt = moneyFmt; });
    pctCols.forEach((c) => { ws.getColumn(c).numFmt = '0.00"%"'; });
    if (!rows.length) ws.addRow(['No data for this period']);
    return ws;
  };

  // Summary: metric / value with per-row formats and bold section headings.
  const sum = wb.addWorksheet('Summary', { views: [{ state: 'frozen', ySplit: 4 }] });
  sum.getCell('A1').value = `${business.name} - ${title(variant)}`;
  sum.getCell('A1').font = { bold: true, size: 14, color: { argb: `FF${brand}` } };
  sum.getCell('A2').value = `Period: ${periodText(m)}   ·   Generated: ${generatedAtText(business)}   ·   Currency: ${business.currency}`;
  sum.getCell('A2').font = { size: 10, color: { argb: 'FF666666' } };
  sum.getColumn(1).width = 34;
  sum.getColumn(2).width = 20;
  const sh = sum.getRow(4);
  sh.values = ['Metric', 'Value'];
  sh.eachCell((c) => { c.font = { bold: true, color: { argb: 'FFFFFFFF' } }; c.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: `FF${brand}` } }; });
  for (const [label, value, kind] of summaryRows(business, m)) {
    const row = sum.addRow([label, value]);
    if (kind === 'section') {
      row.font = { bold: true };
      row.getCell(1).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFF1F3F5' } };
      row.getCell(2).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFF1F3F5' } };
    } else if (kind === 'money') row.getCell(2).numFmt = moneyFmt;
    else if (kind === 'pct') row.getCell(2).numFmt = '0.00"%"';
  }

  sheet('Sales by day', [{ header: 'Date', width: 14 }, { header: `${t.sale}s`, width: 18 }], m.trend.map((d) => [d.date, d.sales]), { money: [2] });
  sheet(`Top ${t.products}`, [{ header: '#', width: 6 }, { header: t.product, width: 34 }, { header: 'Category', width: 20 }, { header: 'Quantity', width: 12 }, { header: 'Unit', width: 10 }, { header: 'Sales value', width: 16 }],
    m.topByValue.map((p, i) => [i + 1, p.name, p.category, p.qty, p.unit || '', p.value]), { money: [6] });
  sheet('Top by quantity', [{ header: '#', width: 6 }, { header: t.product, width: 34 }, { header: 'Quantity', width: 12 }, { header: 'Unit', width: 10 }, { header: 'Sales value', width: 16 }],
    m.topByQty.map((p, i) => [i + 1, p.name, p.qty, p.unit || '', p.value]), { money: [5] });
  sheet('Categories', [{ header: 'Category', width: 28 }, { header: 'Sales value', width: 16 }], m.categories.map((c) => [c.name, c.value]), { money: [2] });
  const payTotal = m.payments.reduce((s, p) => s + p.amount, 0);
  sheet('Payments', [{ header: 'Method', width: 16 }, { header: 'Amount', width: 16 }, { header: 'Share %', width: 10 }],
    m.payments.map((p) => [p.method, p.amount, payTotal ? Math.round((p.amount / payTotal) * 10000) / 100 : 0]), { money: [2], pct: [3] });
  sheet('Purchases', [{ header: 'Supplier', width: 30 }, { header: 'Purchase value', width: 16 }], m.purchases.suppliers.map((s) => [s.name, s.value]), { money: [2] });
  sheet('Enquiries', [{ header: 'Source', width: 22 }, { header: 'Enquiries', width: 12 }], m.enquiries.bySource.map((s) => [s.source, s.count]));
  if (m.stock) {
    sheet('Stock alerts', [{ header: t.product, width: 34 }, { header: 'In stock', width: 12 }, { header: 'Unit', width: 10 }, { header: 'Reorder level', width: 14 }, { header: 'Status', width: 12 }],
      m.stock.alerts.map((a) => [a.name, a.qty, a.unit, a.reorderLevel, a.status === 'OUT' ? 'Out of stock' : 'Low stock']));
  }
  if (m.ai?.topAsked?.length) sheet('AI questions', [{ header: 'Most asked about', width: 34 }, { header: 'Times', width: 10 }], m.ai.topAsked.map((q) => [q.query, q.count]));

  return Buffer.from(await wb.xlsx.writeBuffer());
}

// ─────────────── PDF: visual page + data tables ───────────────

function buildPdf(business, m, png, { variant = 'daily' } = {}) {
  return new Promise((resolve) => {
    const doc = new PDFDocument({ size: [540, 960], margin: 0, info: { Title: `${business.name} - ${title(variant)} ${periodText(m)}`, Author: business.name } });
    const chunks = [];
    doc.on('data', (c) => chunks.push(c));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.registerFont('regular', FONT_FILES.regular);
    doc.registerFont('bold', FONT_FILES.bold);
    doc.image(png, 0, 0, { width: 540, height: 960 });

    const brand = business.theme.primary || '#2563eb';
    const cur = (v) => money(v, business.currency);
    const M = 40;
    const Wd = 595.28 - 2 * M;
    let y = 0;
    const newPage = () => { doc.addPage({ size: 'A4', margin: 0 }); y = M; };
    const ensure = (h) => { if (y + h > 841.89 - M) newPage(); };
    const heading = (txt) => {
      ensure(40);
      doc.font('bold').fontSize(12).fillColor(brand).text(txt, M, y);
      y += 20;
    };
    const table = (cols, rows) => {
      const rowH = 17;
      const draw = (vals, bold, fill) => {
        ensure(rowH);
        if (fill) doc.rect(M, y, Wd, rowH).fill(fill);
        let x = M;
        vals.forEach((v, i) => {
          doc.font(bold ? 'bold' : 'regular').fontSize(8.5).fillColor(fill === brand ? '#ffffff' : '#1f2430')
            .text(String(v ?? ''), x + 4, y + 4.5, { width: cols[i].w - 8, align: cols[i].align || 'left', lineBreak: false, ellipsis: true });
          x += cols[i].w;
        });
        doc.moveTo(M, y + rowH).lineTo(M + Wd, y + rowH).lineWidth(0.4).stroke('#d9dce1');
        y += rowH;
      };
      draw(cols.map((c) => c.h), true, brand);
      if (!rows.length) draw(['No data', ...cols.slice(1).map(() => '')]);
      rows.forEach((r) => draw(r));
      y += 14;
    };

    newPage();
    doc.font('bold').fontSize(16).fillColor('#1f2430').text(`${business.name} - ${title(variant)}`, M, y);
    y += 22;
    doc.font('regular').fontSize(9).fillColor('#5b6070').text(`Period: ${periodText(m)}  ·  Generated: ${generatedAtText(business)}`, M, y);
    y += 24;

    heading('Key figures');
    table([{ h: 'Metric', w: Wd * 0.65 }, { h: 'Value', w: Wd * 0.35, align: 'right' }],
      summaryRows(business, m).filter(([, , k]) => k !== 'section').map(([l, v, k]) => [l, k === 'money' ? cur(v) : k === 'pct' ? `${v}%` : v]));
    heading(`${business.terminology.sale}s by day`);
    table([{ h: 'Date', w: Wd * 0.5 }, { h: 'Sales', w: Wd * 0.5, align: 'right' }], m.trend.map((d) => [d.date, cur(d.sales)]));
    heading(`Top ${business.terminology.products.toLowerCase()}`);
    table([{ h: '#', w: 26 }, { h: business.terminology.product, w: Wd - 26 - 160 }, { h: 'Qty', w: 60, align: 'right' }, { h: 'Value', w: 100, align: 'right' }],
      m.topByValue.map((p, i) => [i + 1, p.name, `${p.qty} ${p.unit || ''}`, cur(p.value)]));
    heading('Categories');
    table([{ h: 'Category', w: Wd * 0.6 }, { h: 'Sales', w: Wd * 0.4, align: 'right' }], m.categories.map((c) => [c.name, cur(c.value)]));
    heading('Payments');
    table([{ h: 'Method', w: Wd * 0.6 }, { h: 'Amount', w: Wd * 0.4, align: 'right' }], m.payments.map((p) => [p.method, cur(p.amount)]));
    if (m.stock?.alerts?.length) {
      heading('Stock alerts');
      table([{ h: business.terminology.product, w: Wd * 0.55 }, { h: 'In stock', w: Wd * 0.2, align: 'right' }, { h: 'Status', w: Wd * 0.25 }],
        m.stock.alerts.map((a) => [a.name, `${a.qty} ${a.unit}`, a.status === 'OUT' ? 'Out of stock' : 'Low stock']));
    }
    doc.end();
  });
}

// ─────────────── Overview report (date range) ───────────────

async function overviewMetrics(business, from, to) {
  const m = await rangeMetrics(business, from, to);
  const { start } = dayRange(from, business.timezone);
  const { end } = dayRange(to, business.timezone);
  const [stock, ai] = await Promise.all([
    stockSnapshot(business.id),
    business.settings.modules.includes('ai') ? aiSummary(business.id, start, end) : null,
  ]);
  return { ...m, stock, ai };
}

/** Builds the Overview report for a date range in the requested format: 'png' | 'pdf' | 'xlsx'. */
async function overviewExport(business, from, to, format, { includeCost = true } = {}) {
  const m = await overviewMetrics(business, from, to);
  if (!includeCost) { delete m.margin; if (m.stock) delete m.stock.value; }
  const base = `${business.slug}-overview-${from}${from === to ? '' : `-to-${to}`}`;
  if (format === 'xlsx') return { buffer: await buildWorkbook(business, m, { variant: 'overview' }), filename: `${base}.xlsx`, mime: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' };
  const png = svgToPng(await renderReportSvg(business, m, generatedAtText(business), { variant: 'overview' }));
  if (format === 'png') return { buffer: png, filename: `${base}.png`, mime: 'image/png' };
  return { buffer: await buildPdf(business, m, png, { variant: 'overview' }), filename: `${base}.pdf`, mime: 'application/pdf' };
}

module.exports = { buildWorkbook, buildPdf, overviewExport, overviewMetrics };
