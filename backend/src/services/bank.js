// Bank statements: parse CSV / Excel exports from any bank, detect the columns, and store each line once.
// Live bank feeds (RBI Account Aggregator) can later write into the same BankTransaction table.
const crypto = require('crypto');
const ExcelJS = require('exceljs');
const { prisma } = require('../lib/prisma');
const { badRequest } = require('../lib/errors');
const { n, round2 } = require('../lib/util');

// ───── Reading the file into rows of text cells ─────

function parseCsv(text) {
  const delim = (text.split('\n').slice(0, 30).join('\n').match(/\t/g) || []).length > (text.match(/,/g) || []).length / 4 ? '\t' : ',';
  const rows = [];
  let row = [];
  let cell = '';
  let quoted = false;
  for (let i = 0; i < text.length; i += 1) {
    const c = text[i];
    if (quoted) {
      if (c === '"' && text[i + 1] === '"') { cell += '"'; i += 1; } else if (c === '"') quoted = false; else cell += c;
    } else if (c === '"') quoted = true;
    else if (c === delim) { row.push(cell); cell = ''; } else if (c === '\n' || c === '\r') {
      if (c === '\r' && text[i + 1] === '\n') i += 1;
      row.push(cell); rows.push(row); row = []; cell = '';
    } else cell += c;
  }
  if (cell || row.length) { row.push(cell); rows.push(row); }
  return rows;
}

// Some banks' ".xls" downloads are really HTML tables.
function parseHtmlTable(html) {
  const strip = (s) => s.replace(/<[^>]+>/g, ' ').replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/\s+/g, ' ').trim();
  return [...html.matchAll(/<tr[\s\S]*?<\/tr>/gi)].map((tr) => [...tr[0].matchAll(/<t[dh][^>]*>([\s\S]*?)<\/t[dh]>/gi)].map((td) => strip(td[1])));
}

const cellText = (v) => {
  if (v === null || v === undefined) return '';
  if (v instanceof Date) return v;
  if (typeof v === 'object') return v.text ?? v.result ?? (v.richText ? v.richText.map((r) => r.text).join('') : '');
  return v;
};

async function readRows(buffer, filename = '') {
  const head = buffer.subarray(0, 8);
  if (head[0] === 0x50 && head[1] === 0x4b) { // xlsx (zip)
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(buffer);
    // The sheet with the most rows is the statement.
    const ws = wb.worksheets.reduce((a, b) => (b.rowCount > (a?.rowCount || 0) ? b : a), null);
    const rows = [];
    ws.eachRow({ includeEmpty: false }, (r) => { rows.push(r.values.slice(1).map(cellText)); });
    return rows;
  }
  if (head[0] === 0xd0 && head[1] === 0xcf) throw badRequest('This is an old Excel (.xls) file. Open it in Excel and use "Save As" → Excel Workbook (.xlsx) or CSV, then upload again.');
  if (head[0] === 0x25 && head[1] === 0x50) throw badRequest('PDF statements cannot be read. Download the statement as Excel or CSV from your net banking instead.');
  const text = buffer.toString('utf8').replace(/^﻿/, '');
  if (/<table/i.test(text)) return parseHtmlTable(text);
  if (/\.(csv|txt|xls)$/i.test(filename) || text.includes(',') || text.includes('\t')) return parseCsv(text);
  throw badRequest('Upload the statement as CSV or Excel (.xlsx)');
}

// ───── Understanding the columns ─────

const norm = (s) => String(s instanceof Date ? '' : s).toLowerCase().replace(/[^a-z/ ]/g, ' ').replace(/\s+/g, ' ').trim();
const COLS = {
  date: [/^(txn |transaction |tran |posting |value )?date$/, /^date$/, /date/],
  description: [/narration/, /description/, /particulars/, /remarks/, /details/],
  reference: [/chq|cheque|ref|utr/],
  debit: [/withdraw/, /^debit/, /debit amount/, /^dr( amount)?$/, /paid out/],
  credit: [/deposit/, /^credit/, /credit amount/, /^cr( amount)?$/, /paid in/],
  amount: [/^(txn |transaction )?amount( inr| rs)?$/],
  drcr: [/^dr ?\/ ?cr$/, /^cr ?\/ ?dr$/, /^type$/, /debit ?\/ ?credit/],
  balance: [/balance/, /^bal$/],
};

function detectHeader(rows) {
  for (let i = 0; i < Math.min(rows.length, 60); i += 1) {
    const cells = rows[i].map(norm);
    const find = (key, taken = []) => {
      for (const re of COLS[key]) {
        // Prefer the transaction date over the value date.
        const idx = cells.findIndex((c, j) => c && !taken.includes(j) && re.test(c) && !(key === 'date' && /value/.test(c) && cells.some((x) => /^(txn |transaction |tran )?date$/.test(x))));
        if (idx >= 0) return idx;
      }
      return -1;
    };
    const date = find('date');
    if (date < 0) continue;
    const map = { date };
    map.debit = find('debit', [date]);
    map.credit = find('credit', [date, map.debit]);
    map.balance = find('balance', [date, map.debit, map.credit]);
    map.amount = map.debit < 0 || map.credit < 0 ? find('amount', [date, map.balance]) : -1;
    map.drcr = map.amount >= 0 ? find('drcr', [date, map.amount, map.balance]) : -1;
    map.description = find('description', [date]);
    map.reference = find('reference', [date, map.description]);
    const hasMoney = (map.debit >= 0 && map.credit >= 0) || map.amount >= 0;
    if (hasMoney) return { index: i, map, headers: rows[i] };
  }
  throw badRequest('Could not find the column headings (Date, Narration, Withdrawal / Debit, Deposit / Credit, Balance) in this file');
}

const MONTHS = { jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6, jul: 7, aug: 8, sep: 9, oct: 10, nov: 11, dec: 12 };
const pad = (x) => String(x).padStart(2, '0');

/** Statement date → YYYY-MM-DD (Indian banks write day first). */
function parseDate(v) {
  if (v instanceof Date && !Number.isNaN(v.getTime())) return `${v.getUTCFullYear()}-${pad(v.getUTCMonth() + 1)}-${pad(v.getUTCDate())}`;
  if (typeof v === 'number' && v > 20000 && v < 80000) { // Excel serial date
    const d = new Date(Math.round((v - 25569) * 86400000));
    return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`;
  }
  const s = String(v || '').trim();
  let m = s.match(/^(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})/);
  if (m) return `${m[1]}-${pad(m[2])}-${pad(m[3])}`;
  m = s.match(/^(\d{1,2})[-/. ](\d{1,2}|[A-Za-z]{3,9})[-/. ,]+(\d{2,4})/);
  if (!m) return null;
  const month = /\d/.test(m[2]) ? Number(m[2]) : MONTHS[m[2].slice(0, 3).toLowerCase()];
  let year = Number(m[3]);
  if (year < 100) year += 2000;
  const day = Number(m[1]);
  if (!month || month > 12 || day > 31) return null;
  return `${year}-${pad(month)}-${pad(day)}`;
}

function parseAmount(v) {
  if (typeof v === 'number') return v;
  const s = String(v || '').trim();
  if (!s || s === '-') return 0;
  const neg = /^\(.*\)$/.test(s) || /^-/.test(s) || /\bdr\.?$/i.test(s);
  const num = Number(s.replace(/[^0-9.]/g, ''));
  return Number.isFinite(num) ? (neg ? -num : num) : 0;
}

// Payment mode from the narration, for filtering and the "how money moves" summary.
const MODES = [
  ['UPI', /\bupi\b/i], ['NEFT', /\bneft\b/i], ['IMPS', /\bimps\b/i], ['RTGS', /\brtgs\b/i], ['ATM', /\batm\b|\bnwd\b|cash wdl/i],
  ['CARD', /\bpos\b|\bcard\b|\becom\b/i], ['CHEQUE', /\bchq\b|cheque|\bclg\b|clearing/i], ['NACH', /\bnach\b|\becs\b|\bach\b|auto ?debit|\bsi\b/i],
  ['INTEREST', /\bint\.?\b.*(pd|paid|cr)|interest/i], ['CHARGES', /charge|\bchg\b|\bfee\b|gst|sms alert|min bal/i], ['CASH', /cash dep|\bcash\b|\bcdm\b/i],
];
const detectMode = (text) => (MODES.find(([, re]) => re.test(text)) || ['OTHER'])[0];

const lineHash = (t) => crypto.createHash('sha1').update([t.date, t.description, t.reference || '', t.debit, t.credit, t.balance ?? ''].join('|')).digest('hex');
// Stored at midday UTC so the calendar date is the same in any Indian/Asian/European timezone.
const asDate = (ymd) => new Date(`${ymd}T12:00:00Z`);

/** Turns a statement file into transaction lines (nothing is saved). */
async function parseStatement(buffer, filename) {
  const rows = await readRows(buffer, filename);
  const { index, map, headers } = detectHeader(rows);
  const lines = [];
  let skipped = 0;
  for (const r of rows.slice(index + 1)) {
    const date = parseDate(r[map.date]);
    if (!date) { if (r.some((c) => String(c).trim())) skipped += 1; continue; }
    let debit = 0;
    let credit = 0;
    if (map.debit >= 0 && map.credit >= 0) {
      debit = Math.abs(parseAmount(r[map.debit]));
      credit = Math.abs(parseAmount(r[map.credit]));
    } else {
      const amt = parseAmount(r[map.amount]);
      const flag = map.drcr >= 0 ? norm(r[map.drcr]) : '';
      const isDebit = flag ? /^d|debit|withdraw/.test(flag) : amt < 0;
      if (isDebit) debit = Math.abs(amt); else credit = Math.abs(amt);
    }
    if (!debit && !credit) { skipped += 1; continue; }
    const description = String(map.description >= 0 ? r[map.description] ?? '' : '').replace(/\s+/g, ' ').trim() || '(no description)';
    const reference = map.reference >= 0 ? String(r[map.reference] ?? '').trim().replace(/^0+$/, '') || null : null;
    const balance = map.balance >= 0 && String(r[map.balance] ?? '').trim() ? round2(parseAmount(r[map.balance])) : null;
    lines.push({ date, description: description.slice(0, 500), reference: reference?.slice(0, 80) || null, debit: round2(debit), credit: round2(credit), balance, mode: detectMode(`${description} ${reference || ''}`) });
  }
  if (!lines.length) throw badRequest('No transactions were found below the column headings');
  const label = (k) => (map[k] >= 0 ? String(headers[map[k]]).trim() : null);
  return { lines, skipped, columns: { date: label('date'), description: label('description'), debit: label('debit') || label('amount'), credit: label('credit') || label('amount'), balance: label('balance') } };
}

/** Saves parsed lines to an account; lines already imported are skipped. */
async function importLines(account, lines) {
  const importId = crypto.randomUUID();
  const existing = await prisma.bankTransaction.count({ where: { accountId: account.id } });
  const data = lines.map((l) => ({
    businessId: account.businessId, accountId: account.id, date: asDate(l.date), description: l.description, reference: l.reference,
    debit: l.debit, credit: l.credit, balance: l.balance, mode: l.mode, source: 'IMPORT', importId, hash: lineHash(l),
  }));
  const { count } = await prisma.bankTransaction.createMany({ data, skipDuplicates: true });
  // First statement for an account with no opening balance: work it out from the first line's running balance.
  if (!existing && !n(account.openingBalance) && lines.length) {
    const sorted = [...lines].sort((a, b) => a.date.localeCompare(b.date));
    const first = sorted[0].balance !== null ? sorted[0] : null;
    if (first) await prisma.bankAccount.update({ where: { id: account.id }, data: { openingBalance: round2(first.balance - first.credit + first.debit), openingDate: asDate(first.date) } });
  }
  return { importId, added: count, duplicates: lines.length - count };
}

async function accountBalances(businessId, accountIds, monthStart) {
  const [all, month, last] = await Promise.all([
    prisma.bankTransaction.groupBy({ by: ['accountId'], where: { businessId, accountId: { in: accountIds } }, _sum: { credit: true, debit: true }, _count: true, _max: { date: true } }),
    prisma.bankTransaction.groupBy({ by: ['accountId'], where: { businessId, accountId: { in: accountIds }, date: { gte: monthStart } }, _sum: { credit: true, debit: true } }),
    Promise.all(accountIds.map((id) => prisma.bankTransaction.findFirst({ where: { accountId: id, balance: { not: null } }, orderBy: [{ date: 'desc' }, { createdAt: 'desc' }], select: { balance: true, date: true } }))),
  ]);
  const a = Object.fromEntries(all.map((r) => [r.accountId, r]));
  const m = Object.fromEntries(month.map((r) => [r.accountId, r]));
  return Object.fromEntries(accountIds.map((id, i) => [id, {
    credits: round2(n(a[id]?._sum.credit)), debits: round2(n(a[id]?._sum.debit)), count: a[id]?._count || 0, lastDate: a[id]?._max.date || null,
    monthCredits: round2(n(m[id]?._sum.credit)), monthDebits: round2(n(m[id]?._sum.debit)),
    statementBalance: last[i] ? { amount: n(last[i].balance), date: last[i].date } : null,
  }]));
}

module.exports = { parseStatement, importLines, accountBalances, lineHash, asDate, detectMode, parseDate, parseAmount };
