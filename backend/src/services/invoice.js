// Invoice output. PDF and image are rendered from the same server-side invoice data object,
// loaded fresh from the database - never from client-supplied values. The A4 PDF and the PNG share
// one layout (services/invoiceLayout.js), coloured by the business theme.
const PDFDocument = require('pdfkit');
const QRCode = require('qrcode');
const { prisma } = require('../lib/prisma');
const { notFound } = require('../lib/errors');
const { n, money } = require('../lib/util');
const { svgToPng } = require('../lib/svg');
const { amountInWords } = require('../lib/amountInWords');
const storage = require('../lib/storage');
const config = require('../config');
const { layoutInvoice, drawPdf, toSvg, FONT_FILES } = require('./invoiceLayout');
const { drawIconPdf } = require('../lib/iconPaths');

// Bump when the invoice design changes so previously stored files are re-rendered.
const LAYOUT_VERSION = 'v3';

async function loadInvoice(business, saleId) {
  const sale = await prisma.sale.findFirst({
    where: { id: saleId, businessId: business.id },
    include: { items: true, payments: true, customer: true, returns: true },
  });
  if (!sale) throw notFound('Invoice not found');
  return buildInvoiceData(business, sale);
}

// Bill-to block: the billing snapshot taken at the POS preview wins over the live customer profile.
function customerLine(sale, terms) {
  const c = sale.customer || {};
  const pick = (billKey, key) => (sale[billKey] !== undefined && sale[billKey] !== null ? sale[billKey] : c[key] || null);
  const name = pick('billName', 'name');
  if (!name && !sale.customer) return null;
  const status = sale.customerStatus === 'NEW' ? `New ${terms.customer}` : sale.customerStatus === 'REPEAT' ? `Repeat ${terms.customer}` : null;
  return {
    name: name || `Walk-in ${terms.customer}`, phone: pick('billPhone', 'phone'), email: pick('billEmail', 'email'), address: pick('billAddress', 'address'),
    taxId: pick('billTaxId', 'taxId'), code: c.code, status: sale.customerStatus, statusLabel: status,
    visitNumber: sale.visitNumber,
    // e.g. "Customer: Daniel | Repeat Customer | Visit #7"
    summary: [`${terms.customer}: ${name}`, status, sale.visitNumber ? `Visit #${sale.visitNumber}` : null].filter(Boolean).join(' | '),
  };
}

function buildInvoiceData(business, sale) {
  const t = business.terminology;
  const inv = business.settings.invoice;
  const taxByRate = {};
  for (const i of sale.items) {
    const k = n(i.taxRate);
    if (k > 0) taxByRate[k] = (taxByRate[k] || 0) + n(i.taxAmount);
  }
  const total = n(sale.total);
  return {
    business: {
      name: business.name, address: [business.address, business.city].filter(Boolean).join(', '), phone: business.phone,
      email: business.email, taxId: business.taxId, logoUrl: business.logoUrl, currency: business.currency,
      theme: business.theme, timezone: business.timezone,
    },
    title: inv.title || 'Tax Invoice',
    number: sale.number,
    date: sale.createdAt,
    dateText: new Intl.DateTimeFormat('en-IN', { timeZone: business.timezone, dateStyle: 'medium', timeStyle: 'short' }).format(sale.createdAt),
    // DD-MM-YYYY, as printed on the invoice
    dateOnly: new Intl.DateTimeFormat('en-GB', { timeZone: business.timezone, day: '2-digit', month: '2-digit', year: 'numeric' }).format(sale.createdAt).replace(/\//g, '-'),
    status: sale.status,
    cancelReason: sale.cancelReason || null,
    channel: sale.channel,
    customer: customerLine(sale, t),
    items: sale.items.map((i) => ({
      name: i.name, hsn: i.hsn, unit: i.unit, qty: n(i.qty), rate: n(i.unitPrice), gross: Math.round(n(i.unitPrice) * n(i.qty) * 100) / 100,
      discount: n(i.discount), taxRate: n(i.taxRate), tax: n(i.taxAmount), amount: n(i.lineTotal), returned: n(i.returnedQty),
    })),
    subtotal: n(sale.subtotal),
    discount: n(sale.discount),
    tax: n(sale.tax),
    taxInclusive: !!business.settings.taxInclusive,
    taxBreakup: Object.entries(taxByRate).map(([rate, amount]) => ({ rate: Number(rate), amount: Math.round(amount * 100) / 100 })),
    total,
    amountInWords: amountInWords(total, business.currency),
    paid: n(sale.paidAmount),
    due: Math.max(total - n(sale.paidAmount), 0),
    paymentStatus: sale.paymentStatus,
    payments: sale.payments.map((p) => ({ method: p.method, amount: n(p.amount), reference: p.reference })),
    returnsTotal: sale.returns.reduce((s, r) => s + n(r.total), 0),
    notes: sale.notes,
    footer: inv.footer,
    terms: inv.terms,
    showQr: inv.showQr,
    showCustomerStatus: inv.showCustomerStatus,
    verifyUrl: `${config.publicAppUrl}/verify/${sale.verifyToken}`,
    terminology: t,
  };
}

async function loadImages(inv) {
  const buf = await storage.readPublicImage(inv.business.logoUrl).catch(() => null);
  let logo = null;
  if (buf) {
    const mime = buf[0] === 0x89 ? 'image/png' : buf[0] === 0xff ? 'image/jpeg' : 'image/webp';
    logo = { buf, mime };
  }
  const qr = inv.showQr ? await QRCode.toBuffer(inv.verifyUrl, { margin: 0, width: 240 }) : null;
  return { logo, qr };
}

function pdfBuffer(doc) {
  const chunks = [];
  doc.on('data', (c) => chunks.push(c));
  return new Promise((resolve) => doc.on('end', () => resolve(Buffer.concat(chunks))));
}

// ─────────────── PDF ───────────────

async function renderPdf(inv, format = 'A4') {
  if (format === 'THERMAL') return renderThermal(inv);
  const { logo, qr } = await loadImages(inv);
  // pdfkit can't embed webp logos; the layout reserves space either way.
  const layout = layoutInvoice(inv, { paginate: true, logo: logo && logo.mime !== 'image/webp' ? logo : null, qr });
  const doc = new PDFDocument({ size: 'A4', margin: 0, info: { Title: `${inv.title} ${inv.number}`, Author: inv.business.name } });
  const done = pdfBuffer(doc);
  drawPdf(doc, layout.pages);
  doc.end();
  return done;
}

// 80mm thermal receipt (compact; same data, Inter font so the ₹ sign prints).
async function renderThermal(inv) {
  const width = 226;
  const M = 10;
  const W = width - 2 * M;
  const height = 300 + inv.items.length * 30 + (inv.customer ? 40 : 0) + inv.payments.length * 12;
  const doc = new PDFDocument({ size: [width, height], margin: M });
  const done = pdfBuffer(doc);
  doc.registerFont('regular', FONT_FILES.regular);
  doc.registerFont('bold', FONT_FILES.bold);
  const cur = (v) => money(v, inv.business.currency);
  const { qr } = await loadImages(inv);

  // Business icon above the shop name (thermal printers render it in black).
  drawIconPdf(doc, inv.business.theme?.icon || 'Store', (width - 22) / 2, M, 22, '#111111');
  doc.y = M + 28;
  doc.font('bold').fontSize(11).text(inv.business.name, { align: 'center' });
  doc.font('regular').fontSize(7).text([inv.business.address, inv.business.phone && `Ph: ${inv.business.phone}`, inv.business.taxId && `GSTIN: ${inv.business.taxId}`].filter(Boolean).join('\n'), { align: 'center' });
  doc.moveDown(0.4).font('bold').fontSize(8).text(inv.title, { align: 'center' });
  doc.font('regular').fontSize(7).text(`No: ${inv.number}   Date: ${inv.dateOnly}`, { align: 'center' });
  if (inv.customer) {
    doc.moveDown(0.3).fontSize(7.5).text(inv.showCustomerStatus ? inv.customer.summary : `${inv.terminology.customer}: ${inv.customer.name}`, { align: 'center' });
    const contact = [inv.customer.address, inv.customer.phone && `Ph: ${inv.customer.phone}`, inv.customer.taxId && `GSTIN: ${inv.customer.taxId}`].filter(Boolean).join('\n');
    if (contact) doc.fontSize(7).text(contact, { align: 'center' });
  }
  doc.moveDown(0.3).text('-'.repeat(48), { align: 'center' });
  for (const it of inv.items) {
    doc.font('bold').fontSize(7.5).text(it.name, M, doc.y, { width: W });
    const y = doc.y;
    doc.font('regular').fontSize(7).text(`${it.qty} ${it.unit || ''} x ${cur(it.rate)}`, M, y, { width: W * 0.6 });
    doc.text(cur(it.gross), M + W * 0.6, y, { width: W * 0.4, align: 'right' });
  }
  doc.text('-'.repeat(48), M, doc.y, { align: 'center', width: W });
  const row = (label, value, bold) => {
    const y = doc.y;
    doc.font(bold ? 'bold' : 'regular').fontSize(bold ? 9 : 7.5).text(label, M, y, { width: W * 0.55 });
    doc.text(value, M + W * 0.55, y, { width: W * 0.45, align: 'right' });
  };
  row('Sub Total', cur(inv.subtotal));
  if (inv.discount) row('Discount', `- ${cur(inv.discount)}`);
  for (const tb of inv.taxBreakup) row(`Tax @ ${tb.rate}%`, cur(tb.amount));
  row('Total', cur(inv.total), true);
  doc.font('regular').fontSize(6.5).text(inv.amountInWords, M, doc.y + 2, { width: W });
  row('Received', cur(inv.paid));
  row('Balance', cur(inv.due), inv.due > 0);
  if (qr) {
    doc.image(qr, (width - 70) / 2, doc.y + 6, { width: 70 });
    doc.y += 80;
  }
  doc.font('regular').fontSize(7).text(inv.terms || inv.footer || '', M, doc.y + 4, { width: W, align: 'center' });
  doc.end();
  return done;
}

// ─────────────── PNG (mobile / WhatsApp share) ───────────────

async function renderPng(inv) {
  const { logo, qr } = await loadImages(inv);
  const layout = layoutInvoice(inv, { paginate: false, logo, qr });
  // Rendered at 2× A4 width (~1190 px) - sharp on phones, same layout as the PDF.
  return svgToPng(toSvg(layout), Math.round(layout.width * 2), Object.values(FONT_FILES));
}

// Unsaved bill preview for the POS: same layout, marked as a preview, no verification QR.
async function renderPreviewPng(business, sale) {
  const inv = { ...buildInvoiceData(business, sale), showQr: false, number: 'PREVIEW' };
  return { inv, png: await renderPng(inv) };
}

// Render + store, so invoices can be re-downloaded; `force` regenerates (e.g. after a return).
async function getInvoiceAsset(business, saleId, kind, { force = false, format } = {}) {
  const inv = await loadInvoice(business, saleId);
  const fmt = format || business.settings.invoice.format;
  const assetKind = kind === 'pdf' ? `PDF_${fmt}` : 'PNG';
  const key = `private/${business.id}/invoices/${inv.number}-${assetKind}-${LAYOUT_VERSION}.${kind}`;
  const existing = await prisma.invoiceAsset.findUnique({ where: { saleId_kind: { saleId, kind: assetKind } } });
  // Regenerate when branding/settings or the sale itself changed after the stored copy was rendered.
  const stale = existing && (!existing.path.includes(LAYOUT_VERSION) || existing.createdAt < business.updatedAt || existing.createdAt < (await latestChange(saleId)));
  if (existing && !force && !stale && storage.exists(existing.path)) return { buffer: await storage.get(existing.path), inv };
  const buffer = kind === 'pdf' ? await renderPdf(inv, fmt) : await renderPng(inv);
  await storage.put(key, buffer);
  await prisma.invoiceAsset.upsert({
    where: { saleId_kind: { saleId, kind: assetKind } },
    create: { saleId, kind: assetKind, path: key },
    update: { path: key, createdAt: new Date() },
  });
  return { buffer, inv };
}

// Last time something on the sale changed that affects the invoice (payments, returns, status).
async function latestChange(saleId) {
  const [p, r, a] = await Promise.all([
    prisma.payment.findFirst({ where: { saleId }, orderBy: { createdAt: 'desc' }, select: { createdAt: true } }),
    prisma.saleReturn.findFirst({ where: { saleId }, orderBy: { createdAt: 'desc' }, select: { createdAt: true } }),
    prisma.auditLog.findFirst({ where: { entity: 'Sale', entityId: saleId }, orderBy: { createdAt: 'desc' }, select: { createdAt: true } }),
  ]);
  return new Date(Math.max(p?.createdAt || 0, r?.createdAt || 0, a?.createdAt || 0));
}

module.exports = { renderPreviewPng, loadInvoice, buildInvoiceData, renderPdf, renderPng, getInvoiceAsset };
