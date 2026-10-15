// "Tax Invoice" layout shared by the A4 PDF and the PNG image.
// layoutInvoice() measures text with the real Inter font and emits drawing operations
// (rect / line / text / image) in A4 points; renderers below draw those operations with pdfkit or SVG,
// so both outputs are identical. Colours come from the business theme.
const path = require('path');
const fontkit = require('fontkit');
const { money } = require('../lib/util');
const { esc, onColor } = require('../lib/svg');
const { iconSvg, drawIconPdf } = require('../lib/iconPaths');

const FONT_DIR = path.dirname(require.resolve('@expo-google-fonts/inter/package.json'));
const FONT_FILES = {
  regular: path.join(FONT_DIR, '400Regular', 'Inter_400Regular.ttf'),
  semibold: path.join(FONT_DIR, '600SemiBold', 'Inter_600SemiBold.ttf'),
  bold: path.join(FONT_DIR, '700Bold', 'Inter_700Bold.ttf'),
};
const FONTS = Object.fromEntries(Object.entries(FONT_FILES).map(([k, f]) => [k, fontkit.openSync(f)]));
const SVG_WEIGHT = { regular: 400, semibold: 600, bold: 700 };

const PAGE_W = 595.28;
const PAGE_H = 841.89;
const M = 30;
const CW = PAGE_W - 2 * M;
const LINE = 1.25; // line-height multiplier

function measure(text, size, weight = 'regular') {
  const f = FONTS[weight];
  return (f.layout(String(text ?? '')).advanceWidth / f.unitsPerEm) * size;
}

function wrap(text, size, weight, maxW) {
  const out = [];
  for (const para of String(text ?? '').split('\n')) {
    let line = '';
    for (const word of para.split(/\s+/).filter(Boolean)) {
      const next = line ? `${line} ${word}` : word;
      if (measure(next, size, weight) <= maxW || !line) line = next;
      else { out.push(line); line = word; }
    }
    out.push(line);
  }
  return out;
}

// ── colour helpers ──
const hex = (h) => h.replace('#', '').match(/../g).map((x) => parseInt(x, 16));
const toHex = (rgb) => `#${rgb.map((v) => Math.round(Math.max(0, Math.min(255, v))).toString(16).padStart(2, '0')).join('')}`;
const mix = (a, b, t) => toHex(hex(a).map((v, i) => v * t + hex(b)[i] * (1 - t)));
const lum = (h) => { const [r, g, b] = hex(h).map((v) => v / 255); return 0.2126 * r + 0.7152 * g + 0.0722 * b; };

function palette(theme = {}) {
  const primary = /^#[0-9a-f]{6}$/i.test(theme.primary || '') ? theme.primary : '#2563eb';
  // Keep accents readable on white even for very light brand colours.
  const accent = lum(primary) > 0.55 ? mix(primary, '#000000', 0.55) : primary;
  return {
    brand: primary,
    accent,
    tint: mix(primary, '#ffffff', 0.1), // header bands
    tintSoft: mix(primary, '#ffffff', 0.05), // total row
    border: mix(primary, '#2b2f38', 0.3),
    ink: '#1f2430',
    muted: '#5b6070',
    newColor: '#15803d',
    repeatColor: '#6d28d9',
  };
}

/**
 * Lays out the invoice. With paginate=true content flows onto A4 pages (PDF);
 * otherwise it returns one tall page (PNG).
 */
function layoutInvoice(inv, { paginate = true, logo = null, qr = null } = {}) {
  const C = palette(inv.business.theme);
  const cur = (v) => money(v, inv.business.currency).replace(/^(\D+)/, '$1 ');
  const pages = [[]];
  let ops = pages[0];
  let y = M - 6;
  const bottom = PAGE_H - M;

  const rect = (x, yy, w, h, { fill = null, stroke = C.border, r = 0 } = {}) => ops.push({ t: 'rect', x, y: yy, w, h, fill, stroke, r });
  // Small line icons (24px grid, stroked) - the business's own icon plus section icons.
  const icon = (name, x, yy, size, { color = C.accent, opacity = 1, strokeWidth = 2 } = {}) => ops.push({ t: 'icon', name, x, y: yy, size, color, opacity, strokeWidth });
  const BIZ_ICON = inv.business.theme?.icon || 'Store';
  // Section heading with a small icon in the brand colour.
  const band = (label, iconName, x, yy) => {
    icon(iconName, x + 6, yy + 4.5, 10, { strokeWidth: 2.2 });
    text(label, x + 21, mid(yy, 19, 9), { size: 9, weight: 'bold' });
  };
  const line = (x1, y1, x2, y2, color = C.border) => ops.push({ t: 'line', x1, y1, x2, y2, color });
  const text = (str, x, yy, { size = 9, weight = 'regular', color = C.ink, align = 'left', w = 0 } = {}) => {
    const s = String(str ?? '');
    if (!s) return;
    const tw = measure(s, size, weight);
    const tx = align === 'right' ? x + w - tw : align === 'center' ? x + (w - tw) / 2 : x;
    ops.push({ t: 'text', x: tx, y: yy, text: s, size, weight, color });
  };
  // Vertically centre a single text line in a band of height h.
  const mid = (yy, h, size) => yy + (h - size * 1.21) / 2;
  const ensure = (h, onNewPage) => {
    if (!paginate || y + h <= bottom) return;
    ops = [];
    pages.push(ops);
    y = M;
    if (onNewPage) onNewPage();
  };

  // ── Title ──
  text(inv.title, M, y, { size: 19, weight: 'bold', color: C.accent, align: 'center', w: CW });
  const titleW = measure(inv.title, 19, 'bold');
  icon(BIZ_ICON, M + CW / 2 - titleW / 2 - 29, y + 1, 21);
  y += 34;
  if (inv.status === 'CANCELLED') {
    // Cancelled bills stay printable for records but are unmistakably void.
    const msg = `CANCELLED${inv.cancelReason ? ` - ${inv.cancelReason}` : ''}`;
    rect(M, y - 6, CW, 22, { fill: '#fde8e8', stroke: '#dc2626' });
    text(msg.length > 90 ? `${msg.slice(0, 89)}…` : msg, M, mid(y - 6, 22, 10), { size: 10, weight: 'bold', color: '#b91c1c', align: 'center', w: CW });
    y += 24;
  }

  // ── Business header ──
  const b = inv.business;
  const textX = M + 92;
  const nameLines = wrap(b.name, 17, 'bold', CW - (textX - M) - 10);
  const contact = [];
  if (b.address) contact.push(...wrap(b.address, 9, 'regular', CW - (textX - M) - 10));
  const headerH = Math.max(84, 14 + nameLines.length * 21 + 16 + contact.length * 12 + (b.taxId ? 13 : 0) + 8);
  rect(M, y, CW, headerH);
  if (logo) ops.push({ t: 'image', x: M + 8, y: y + 8, w: 76, h: headerH - 16 > 76 ? 76 : headerH - 16, buf: logo.buf, mime: logo.mime });
  else {
    rect(M + 8, y + 8, 68, 68, { fill: C.brand, stroke: null, r: 12 });
    icon(BIZ_ICON, M + 8 + 16, y + 8 + 16, 36, { color: onColor(C.brand), strokeWidth: 1.8 });
  }
  let hy = y + 12;
  for (const l of nameLines) { text(l, textX, hy, { size: 17, weight: 'bold' }); hy += 21; }
  hy += 2;
  const contactRow = (label, value, x) => {
    if (!value) return;
    text(label, x, hy, { size: 9, color: C.muted });
    text(value, x + measure(label, 9) + 3, hy, { size: 9, weight: 'semibold' });
  };
  contactRow('Phone:', b.phone, textX);
  contactRow('Email:', b.email, M + CW * 0.55);
  hy += 14;
  for (const l of contact) { text(l, textX, hy, { size: 9, color: C.muted }); hy += 12; }
  if (b.taxId) { text('GSTIN:', textX, hy, { size: 9, color: C.muted }); text(b.taxId, textX + measure('GSTIN:', 9) + 3, hy, { size: 9, weight: 'semibold' }); }
  y += headerH;

  // ── Bill To / Invoice Details ──
  const half = CW / 2;
  rect(M, y, CW, 19, { fill: C.tint });
  line(M + half, y, M + half, y + 19);
  band('Bill To:', 'User', M, y);
  band('Invoice Details:', 'FileText', M + half, y);
  y += 19;

  const left = [];
  const c = inv.customer;
  if (c) {
    left.push({ s: c.name, size: 10, weight: 'bold' });
    // Address sits directly under the customer's name.
    if (c.address) wrap(c.address, 9, 'regular', half - 14).forEach((l) => left.push({ s: l, size: 9 }));
    if (c.phone) left.push({ s: `Phone: ${c.phone}`, size: 9, color: C.muted });
    if (c.email) left.push({ s: `Email: ${c.email}`, size: 9, color: C.muted });
    if (c.taxId) left.push({ s: `GSTIN: ${c.taxId}`, size: 9, color: C.muted });
    if (inv.showCustomerStatus && c.status) {
      left.push({
        s: c.status === 'NEW' ? `New ${inv.terminology.customer}` : `Repeat ${inv.terminology.customer}  ·  Visit #${c.visitNumber || ''}`,
        size: 9, weight: 'bold', color: c.status === 'NEW' ? C.newColor : C.repeatColor,
      });
    }
  } else {
    left.push({ s: `Walk-in ${inv.terminology.customer}`, size: 10, weight: 'bold' });
  }
  const right = [['No:', inv.number], ['Date:', inv.dateOnly]];
  if (inv.payments.length) right.push(['Payment:', [...new Set(inv.payments.map((p) => p.method))].join(' + ')]);
  if (inv.status !== 'COMPLETED') right.push(['Status:', inv.status.replace(/_/g, ' ')]);
  const rowH = Math.max(left.reduce((s, l) => s + l.size * 1.45, 0), right.length * 13) + 12;
  rect(M, y, CW, rowH);
  line(M + half, y, M + half, y + rowH);
  let ly = y + 7;
  for (const l of left) { text(l.s, M + 6, ly, { size: l.size, weight: l.weight || 'regular', color: l.color || C.ink }); ly += l.size * 1.45; }
  let ry = y + 7;
  for (const [k, v] of right) {
    text(k, M + half + 6, ry, { size: 9, color: C.muted });
    text(v, M + half + 6 + measure(k, 9) + 4, ry, { size: 9, weight: 'bold', color: k === 'Status:' ? '#b91c1c' : C.ink });
    ry += 13;
  }
  y += rowH + 8;

  // ── Items table ──
  const cols = [
    { k: '#', w: 24, a: 'left' }, { k: 'Item Name', w: 186, a: 'left' }, { k: 'HSN/ SAC', w: 62, a: 'left' },
    { k: 'Quantity', w: 62, a: 'right' }, { k: 'Unit', w: 46, a: 'right' }, { k: `Price/ Unit (${cur(0).trim().split(' ')[0]})`, w: 76, a: 'right' },
  ];
  cols.push({ k: `Amount(${cur(0).trim().split(' ')[0]})`, w: CW - cols.reduce((s, x) => s + x.w, 0), a: 'right' });
  const colX = [];
  cols.reduce((x, col) => { colX.push(x); return x + col.w; }, M);
  const vlines = (yy, h) => colX.slice(1).forEach((x) => line(x, yy, x, yy + h));
  const tableHeader = () => {
    rect(M, y, CW, 20, { fill: C.tint });
    vlines(y, 20);
    cols.forEach((col, i) => text(col.k, colX[i] + 5, mid(y, 20, 8.5), { size: 8.5, weight: 'bold', align: col.a, w: col.w - 10 }));
    y += 20;
  };
  tableHeader();

  let totalQty = 0;
  let totalAmount = 0;
  inv.items.forEach((it, idx) => {
    const nameLines = wrap(it.name, 9, 'semibold', cols[1].w - 10);
    const extra = [];
    if (it.discount) extra.push(`Discount: -${cur(it.discount)}`);
    if (it.taxRate) extra.push(`Tax ${it.taxRate}%: ${cur(it.tax)}`);
    if (it.returned) extra.push(`Returned: ${it.returned}`);
    const h = Math.max(20, nameLines.length * 11.5 + extra.length * 10.5 + 9);
    ensure(h, tableHeader);
    rect(M, y, CW, h);
    vlines(y, h);
    const ty = y + 5;
    text(String(idx + 1), colX[0] + 5, ty, { size: 9, weight: 'semibold' });
    nameLines.forEach((l, i) => text(l, colX[1] + 5, ty + i * 11.5, { size: 9, weight: 'semibold' }));
    extra.forEach((l, i) => text(l, colX[1] + 5, ty + nameLines.length * 11.5 + i * 10.5, { size: 7.5, color: C.muted }));
    text(it.hsn || '', colX[2] + 5, ty, { size: 9 });
    text(String(it.qty), colX[3] + 5, ty, { size: 9, align: 'right', w: cols[3].w - 10 });
    text(it.unit || '', colX[4] + 5, ty, { size: 9, align: 'right', w: cols[4].w - 10 });
    text(cur(it.rate), colX[5] + 5, ty, { size: 9, align: 'right', w: cols[5].w - 10 });
    text(cur(it.gross), colX[6] + 5, ty, { size: 9, align: 'right', w: cols[6].w - 10 });
    totalQty += it.qty;
    totalAmount += it.gross;
    y += h;
  });
  ensure(20, tableHeader);
  rect(M, y, CW, 20, { fill: C.tintSoft });
  vlines(y, 20);
  text('Total', colX[1] + 5, mid(y, 20, 9), { size: 9, weight: 'bold' });
  text(String(Math.round(totalQty * 1000) / 1000), colX[3] + 5, mid(y, 20, 9), { size: 9, weight: 'bold', align: 'right', w: cols[3].w - 10 });
  text(cur(totalAmount), colX[6] + 5, mid(y, 20, 9), { size: 9, weight: 'bold', align: 'right', w: cols[6].w - 10 });
  y += 20;

  // ── Totals block (right) + QR / notes (left) ──
  const bw = 248;
  const bx = M + CW - bw;
  const rows = [['Sub Total', cur(inv.subtotal)]];
  if (inv.discount) rows.push(['Discount', `- ${cur(inv.discount)}`]);
  for (const tb of inv.taxBreakup) rows.push([`Tax @ ${tb.rate}%${inv.taxInclusive ? ' (incl.)' : ''}`, cur(tb.amount)]);
  rows.push(['Total', cur(inv.total), 'bold']);
  const words = wrap(inv.amountInWords, 9, 'regular', bw - 12);
  const tail = [['Received', cur(inv.paid)], ['Balance', cur(inv.due)]];
  if (inv.returnsTotal) tail.push(['Refunded', `- ${cur(inv.returnsTotal)}`]);
  const R = 19;
  const blockH = rows.length * R + R + words.length * 12 + 8 + tail.length * R;
  ensure(blockH);
  rect(M, y, CW, blockH);
  line(bx, y, bx, y + blockH);
  let by = y;
  const kv = ([k, v, weight], fill) => {
    if (fill) rect(bx, by, bw, R, { fill, stroke: null });
    line(bx, by, bx + bw, by);
    const w = weight || 'regular';
    text(k, bx + 6, mid(by, R, 9), { size: 9, weight: w });
    text(':', bx + 128, mid(by, R, 9), { size: 9, weight: w });
    text(v, bx + 6, mid(by, R, 9), { size: 9, weight: w, align: 'right', w: bw - 12 });
    by += R;
  };
  rows.forEach((r) => kv(r, r[2] ? C.tintSoft : null));
  rect(bx, by, bw, R, { fill: C.tint, stroke: null });
  line(bx, by, bx + bw, by);
  band('Invoice Amount In Words :', 'Banknote', bx, by);
  by += R;
  line(bx, by, bx + bw, by);
  words.forEach((w, i) => text(w, bx + 6, by + 4 + i * 12, { size: 9 }));
  by += words.length * 12 + 8;
  tail.forEach((r) => kv(r));

  // Left side: verification QR + notes
  let lx = M + 8;
  let lyy = y + 8;
  if (qr) {
    ops.push({ t: 'image', x: lx, y: lyy, w: 66, h: 66, buf: qr, mime: 'image/png' });
    text('Scan to verify', lx, lyy + 69, { size: 7, color: C.muted, align: 'center', w: 66 });
    lx += 78;
  }
  const noteW = bx - lx - 10;
  if (inv.notes) {
    text('Notes:', lx, lyy, { size: 8.5, weight: 'bold' });
    wrap(inv.notes, 8.5, 'regular', noteW).slice(0, Math.floor((blockH - 26) / 11)).forEach((l, i) => text(l, lx, lyy + 13 + i * 11, { size: 8.5, color: C.muted }));
  }
  if (!inv.notes && blockH >= 110) icon(BIZ_ICON, bx - 92, y + blockH - 92, 80, { opacity: 0.1, strokeWidth: 1.5 });
  y += blockH + 8;

  // ── Terms ──
  const terms = wrap(inv.terms || inv.footer || 'Thank you for doing business with us.', 9, 'regular', CW - 12);
  const termsH = 19 + terms.length * 12 + 10;
  ensure(termsH);
  rect(M, y, CW, 19, { fill: C.tint });
  band('Terms And Conditions:', 'ScrollText', M, y);
  rect(M, y + 19, CW, termsH - 19);
  terms.forEach((l, i) => text(l, M + 6, y + 24 + i * 12, { size: 9 }));
  y += termsH;

  // ── Signatory ──
  ensure(95);
  const sx = M + half;
  rect(sx, y, half, 19, { fill: C.tint });
  band(`For ${b.name}:`, 'PenLine', sx, y);
  rect(sx, y + 19, half, 76);
  rect(sx + (half - 136) / 2, y + 31, 136, 42, { stroke: '#c4c7cf' });
  text('Authorized Signatory', sx, y + 78, { size: 9, color: C.muted, align: 'center', w: half });
  if (!(inv.terms && inv.footer)) {
    icon(BIZ_ICON, M + 6, y + 30, 26);
    text('Thank you!', M + 40, y + 31, { size: 12, weight: 'bold', color: C.accent });
    // Wrapped so it never runs into the signatory box beside it.
    wrap(`We look forward to serving you again at ${b.name}.`, 8, 'regular', half - 54).slice(0, 3)
      .forEach((l, i) => text(l, M + 40, y + 47 + i * 10.5, { size: 8, color: C.muted }));
  }
  if (inv.terms && inv.footer) {
    // Footer message sits beside the signatory box when terms are shown separately.
    wrap(inv.footer, 9, 'regular', half - 20).forEach((l, i) => text(l, M + 4, y + 30 + i * 12, { size: 9, color: C.muted }));
  }
  y += 95;

  return { pages, height: paginate ? PAGE_H : y + M, width: PAGE_W };
}

// ── Renderers ──

function drawPdf(doc, pages) {
  doc.registerFont('regular', FONT_FILES.regular);
  doc.registerFont('semibold', FONT_FILES.semibold);
  doc.registerFont('bold', FONT_FILES.bold);
  pages.forEach((ops, i) => {
    if (i > 0) doc.addPage();
    for (const o of ops) {
      if (o.t === 'icon') {
        drawIconPdf(doc, o.name, o.x, o.y, o.size, o.color, { opacity: o.opacity, strokeWidth: o.strokeWidth });
      } else if (o.t === 'rect') {
        doc.lineWidth(0.75);
        if (o.r) doc.roundedRect(o.x, o.y, o.w, o.h, o.r);
        else doc.rect(o.x, o.y, o.w, o.h);
        if (o.fill && o.stroke) doc.fillAndStroke(o.fill, o.stroke);
        else if (o.fill) doc.fill(o.fill);
        else doc.stroke(o.stroke);
      } else if (o.t === 'line') {
        doc.lineWidth(0.75).moveTo(o.x1, o.y1).lineTo(o.x2, o.y2).stroke(o.color);
      } else if (o.t === 'text') {
        doc.font(o.weight).fontSize(o.size).fillColor(o.color).text(o.text, o.x, o.y, { lineBreak: false });
      } else if (o.t === 'image') {
        try {
          doc.image(o.buf, o.x, o.y, { fit: [o.w, o.h], align: 'center', valign: 'center' });
        } catch { /* unsupported image format (e.g. webp) - skip */ }
      }
    }
  });
}

function toSvg(layout) {
  const asc = FONTS.regular.ascent / FONTS.regular.unitsPerEm;
  const parts = [`<rect width="${layout.width}" height="${layout.height}" fill="#ffffff"/>`];
  for (const o of layout.pages[0]) {
    if (o.t === 'icon') parts.push(iconSvg(o.name, o.x, o.y, o.size, o.color, { opacity: o.opacity, strokeWidth: o.strokeWidth }));
    else if (o.t === 'rect') parts.push(`<rect x="${o.x}" y="${o.y}" width="${o.w}" height="${o.h}"${o.r ? ` rx="${o.r}"` : ''} fill="${o.fill || 'none'}"${o.stroke ? ` stroke="${o.stroke}" stroke-width="0.75"` : ''}/>`);
    else if (o.t === 'line') parts.push(`<line x1="${o.x1}" y1="${o.y1}" x2="${o.x2}" y2="${o.y2}" stroke="${o.color}" stroke-width="0.75"/>`);
    else if (o.t === 'text') parts.push(`<text x="${o.x.toFixed(2)}" y="${(o.y + asc * o.size).toFixed(2)}" font-family="Inter" font-weight="${SVG_WEIGHT[o.weight]}" font-size="${o.size}" fill="${o.color}">${esc(o.text)}</text>`);
    else if (o.t === 'image') parts.push(`<image x="${o.x}" y="${o.y}" width="${o.w}" height="${o.h}" preserveAspectRatio="xMidYMid meet" href="data:${o.mime};base64,${o.buf.toString('base64')}"/>`);
  }
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${layout.width}" height="${layout.height}" viewBox="0 0 ${layout.width} ${layout.height}">${parts.join('')}</svg>`;
}

module.exports = { layoutInvoice, drawPdf, toSvg, FONT_FILES, PAGE_W, PAGE_H, measure };
