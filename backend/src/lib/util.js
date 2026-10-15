const n = (v) => (v === null || v === undefined || v === '' ? 0 : Number(v));
const round2 = (v) => Math.round((n(v) + Number.EPSILON) * 100) / 100;
const round3 = (v) => Math.round((n(v) + Number.EPSILON) * 1000) / 1000;

const slugify = (s) =>
  String(s || '')
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[^\w\s-]/g, '')
    .trim()
    .replace(/[\s_-]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60);

// Normalize a phone number into a stable matching key (digits only; strips a leading 91/0 for 10-digit Indian numbers).
function normalizePhone(phone) {
  if (!phone) return null;
  let d = String(phone).replace(/\D/g, '');
  if (!d) return null;
  if (d.length === 12 && d.startsWith('91')) d = d.slice(2);
  if (d.length === 11 && d.startsWith('0')) d = d.slice(1);
  return d;
}

const normalizeEmail = (e) => (e ? String(e).trim().toLowerCase() : null);

function pageParams(query) {
  const take = Math.min(Math.max(parseInt(query.limit, 10) || 50, 1), 200);
  const page = Math.max(parseInt(query.page, 10) || 1, 1);
  return { take, skip: (page - 1) * take, page };
}

// Day boundaries (as UTC Date objects) for a YYYY-MM-DD date in a given IANA timezone.
function tzOffsetMinutes(date, timeZone) {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone, hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit',
  }).formatToParts(date);
  const get = (t) => Number(parts.find((p) => p.type === t).value);
  const asUtc = Date.UTC(get('year'), get('month') - 1, get('day'), get('hour'), get('minute'), get('second'));
  return (asUtc - date.getTime()) / 60000;
}

function dayRange(dateStr, timeZone = 'UTC') {
  const [y, m, d] = dateStr.split('-').map(Number);
  const guess = new Date(Date.UTC(y, m - 1, d));
  const start = new Date(guess.getTime() - tzOffsetMinutes(guess, timeZone) * 60000);
  const end = new Date(start.getTime() + 24 * 3600 * 1000);
  return { start, end };
}

function todayIn(timeZone = 'UTC', date = new Date()) {
  return new Intl.DateTimeFormat('en-CA', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit' }).format(date);
}

function timeIn(timeZone = 'UTC', date = new Date()) {
  return new Intl.DateTimeFormat('en-GB', { timeZone, hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).format(date);
}

function addDays(dateStr, days) {
  const d = new Date(`${dateStr}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

const CURRENCY_SYMBOLS = { INR: '₹', USD: '$', EUR: '€', GBP: '£', AED: 'AED ', SGD: 'S$', AUD: 'A$' };
// `ascii` is for renderers whose fonts may not include the currency glyph (PDF core fonts).
function money(value, currency = 'INR', { ascii = false } = {}) {
  const sym = ascii ? (currency === 'INR' ? 'Rs. ' : `${currency} `) : CURRENCY_SYMBOLS[currency] || `${currency} `;
  const num = round2(value).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  return `${sym}${num}`;
}

module.exports = {
  n, round2, round3, slugify, normalizePhone, normalizeEmail, pageParams,
  dayRange, todayIn, timeIn, addDays, money,
};
