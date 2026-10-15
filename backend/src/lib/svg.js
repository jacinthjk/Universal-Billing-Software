// Small helpers for building SVG documents server-side and rasterizing them to PNG with resvg.
const fs = require('fs');
const path = require('path');
const { Resvg } = require('@resvg/resvg-js');
const config = require('../config');

const FONT_STACK = "Inter, 'Segoe UI', Arial, 'Helvetica Neue', 'DejaVu Sans', 'Liberation Sans', 'Noto Sans', sans-serif";

const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&apos;' }[c]));

// Optional bundled fonts (drop .ttf/.otf files in STORAGE_DIR/fonts) for servers without system fonts.
function fontFiles() {
  const dir = path.join(config.storageDir, 'fonts');
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir).filter((f) => /\.(ttf|otf)$/i.test(f)).map((f) => path.join(dir, f));
}

function svgToPng(svg, width, extraFonts = []) {
  const resvg = new Resvg(svg, {
    fitTo: width ? { mode: 'width', value: width } : { mode: 'original' },
    font: { loadSystemFonts: true, fontFiles: [...extraFonts, ...fontFiles()], defaultFontFamily: 'Arial' },
    background: 'white',
  });
  return resvg.render().asPng();
}

// Truncate text to roughly fit a pixel width at a given font size (approximate average glyph width).
function fit(text, maxPx, size) {
  const s = String(text ?? '');
  const max = Math.floor(maxPx / (size * 0.55));
  return s.length > max ? `${s.slice(0, Math.max(max - 1, 1))}…` : s;
}

// Choose black or white text for a background colour.
function onColor(hex) {
  const h = hex.replace('#', '');
  const [r, g, b] = [0, 2, 4].map((i) => parseInt(h.slice(i, i + 2), 16) / 255);
  const lum = 0.2126 * r + 0.7152 * g + 0.0722 * b;
  return lum > 0.6 ? '#111111' : '#ffffff';
}

module.exports = { esc, svgToPng, fit, onColor, FONT_STACK };
