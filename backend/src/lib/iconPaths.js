// Business icons for server-rendered documents (invoices, reports). Uses the same lucide icon set as
// the web app, flattened into one SVG path on a 24x24 grid so pdfkit and resvg can both draw it.
const lucide = require('lucide');
const { esc } = require('./svg');

// lucide has no tooth - identical to the frontend's custom Tooth icon.
const CUSTOM = {
  Tooth: 'M7.5 3C5 3 3.5 4.9 3.5 7.4c0 1.9.7 3.3 1.4 4.8.7 1.6.9 3.3 1.2 5.2.3 1.9.8 3.6 2.1 3.6 1.4 0 1.7-1.6 2-3.3.3-1.5.6-2.9 1.8-2.9s1.5 1.4 1.8 2.9c.3 1.7.6 3.3 2 3.3 1.3 0 1.8-1.7 2.1-3.6.3-1.9.5-3.6 1.2-5.2.7-1.5 1.4-2.9 1.4-4.8C20.5 4.9 19 3 16.5 3c-1.9 0-2.9 1-4.5 1S9.4 3 7.5 3Z M9 7.5c.9.4 2 .6 3 .6',
};

const num = (v) => Number(v || 0);
const points = (p) => String(p).trim().split(/[\s,]+/).map(Number).reduce((acc, v, i) => (i % 2 ? (acc[acc.length - 1].push(v), acc) : [...acc, [v]]), []);

function elementToPath([tag, a]) {
  switch (tag) {
    case 'path': return a.d;
    case 'circle': {
      const [cx, cy, r] = [num(a.cx), num(a.cy), num(a.r)];
      return `M${cx - r} ${cy}a${r} ${r} 0 1 0 ${2 * r} 0a${r} ${r} 0 1 0 ${-2 * r} 0Z`;
    }
    case 'ellipse': {
      const [cx, cy, rx, ry] = [num(a.cx), num(a.cy), num(a.rx), num(a.ry)];
      return `M${cx - rx} ${cy}a${rx} ${ry} 0 1 0 ${2 * rx} 0a${rx} ${ry} 0 1 0 ${-2 * rx} 0Z`;
    }
    case 'rect': {
      const [x, y, w, h] = [num(a.x), num(a.y), num(a.width), num(a.height)];
      const r = Math.min(num(a.rx ?? a.ry), w / 2, h / 2);
      if (!r) return `M${x} ${y}h${w}v${h}h${-w}Z`;
      return `M${x + r} ${y}h${w - 2 * r}a${r} ${r} 0 0 1 ${r} ${r}v${h - 2 * r}a${r} ${r} 0 0 1 ${-r} ${r}h${-(w - 2 * r)}a${r} ${r} 0 0 1 ${-r} ${-r}v${-(h - 2 * r)}a${r} ${r} 0 0 1 ${r} ${-r}Z`;
    }
    case 'line': return `M${num(a.x1)} ${num(a.y1)}L${num(a.x2)} ${num(a.y2)}`;
    case 'polyline':
    case 'polygon': {
      const pts = points(a.points);
      return `M${pts.map((p) => p.join(' ')).join('L')}${tag === 'polygon' ? 'Z' : ''}`;
    }
    default: return '';
  }
}

// Rewrites path data with explicit separators. lucide packs arc flags ("a10 10 0 0010-10" means flags 0,0
// then 10,-10), which pdfkit's parser would misread as one number.
const NUM = /^[+-]?(?:\d+\.?\d*|\.\d+)(?:[eE][+-]?\d+)?/;
function normalizePath(d) {
  const out = [];
  let i = 0;
  let cmd = '';
  let arg = 0;
  while (i < d.length) {
    const c = d[i];
    if (/[\s,]/.test(c)) { i += 1; continue; }
    if (/[a-zA-Z]/.test(c)) { cmd = c; arg = 0; out.push(c); i += 1; continue; }
    const isFlag = (cmd === 'a' || cmd === 'A') && (arg % 7 === 3 || arg % 7 === 4);
    const m = isFlag ? [c] : d.slice(i).match(NUM);
    if (!m) { i += 1; continue; }
    out.push(m[0]);
    i += m[0].length;
    arg += 1;
  }
  return out.join(' ');
}

const cache = new Map();
/** Single SVG path (24x24 grid, meant to be stroked) for an icon name; falls back to a shop icon. */
function iconPath(name) {
  const key = CUSTOM[name] || lucide[name] ? name : 'Store';
  if (!cache.has(key)) cache.set(key, normalizePath(CUSTOM[key] || lucide[key].map(elementToPath).join(' ')));
  return cache.get(key);
}

/** SVG markup for an icon at (x, y) with the given size - for resvg-rendered images. */
function iconSvg(name, x, y, size, color, { opacity = 1, strokeWidth = 2 } = {}) {
  return `<g transform="translate(${x} ${y}) scale(${size / 24})"><path d="${esc(iconPath(name))}" fill="none" stroke="${color}" stroke-width="${strokeWidth}" stroke-linecap="round" stroke-linejoin="round" stroke-opacity="${opacity}"/></g>`;
}

/** Draws an icon into a pdfkit document. */
function drawIconPdf(doc, name, x, y, size, color, { opacity = 1, strokeWidth = 2 } = {}) {
  doc.save();
  doc.translate(x, y).scale(size / 24);
  doc.path(iconPath(name)).lineWidth(strokeWidth).lineCap('round').lineJoin('round').strokeOpacity(opacity).stroke(color);
  doc.restore();
}

module.exports = { iconPath, iconSvg, drawIconPdf };
