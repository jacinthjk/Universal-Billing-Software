// WhatsApp messaging for a business, through the provider it picked in WhatsApp settings:
//  LINKED - its own number, linked by scanning a QR code (./linked.js, unofficial)
//  CLOUD  - the official WhatsApp Business Cloud API, configured on the server (./whatsapp.js)
//
// Every message is recorded in MessageLog. Sends are queued per business with a gap between
// messages; bulk sends from a linked number wait 6-14 s between messages to lower the ban risk.
const crypto = require('crypto');
const { prisma } = require('../../lib/prisma');
const linked = require('./linked');
const cloud = require('./whatsapp');

// Most recipients one bulk send (product update / reminders) may target.
const MAX_BULK = 250;

const providerOf = (business) => (business.settings.whatsapp?.provider === 'CLOUD' ? 'CLOUD' : 'LINKED');
const countryCode = (business) => business.settings.whatsapp?.countryCode || business.settings.reportDelivery?.countryCode || '91';

// "9025296615" -> "919025296615" (WhatsApp wants the country code, no "+").
function toWhatsAppNumber(phone, cc = '91') {
  let d = String(phone || '').replace(/\D/g, '');
  if (d.length === 11 && d.startsWith('0')) d = d.slice(1);
  if (d.length === 10) d = `${cc}${d}`;
  return d;
}

const maskNumber = (n) => (n.length > 4 ? `${'•'.repeat(n.length - 4)}${n.slice(-4)}` : n);

function status(business) {
  if (providerOf(business) === 'CLOUD') {
    const ok = cloud.isConfigured();
    return { provider: 'CLOUD', status: ok ? 'CONNECTED' : 'NOT_CONFIGURED', connected: ok, qr: null, me: null, error: ok ? null : 'The WhatsApp Cloud API is not configured on the server (WHATSAPP_PHONE_NUMBER_ID / WHATSAPP_ACCESS_TOKEN).' };
  }
  return { provider: 'LINKED', ...linked.status(business.id) };
}

const isReady = (business) => status(business).connected;

function notReadyError(business) {
  return providerOf(business) === 'CLOUD'
    ? 'The WhatsApp Cloud API is not configured on the server (WHATSAPP_PHONE_NUMBER_ID / WHATSAPP_ACCESS_TOKEN).'
    : 'WhatsApp is not linked. Open the WhatsApp page and scan the QR code.';
}

// ───── Per-business send queue ─────

const queues = new Map(); // businessId -> { tail, last }
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const gapFor = (provider, bulk) => (!bulk ? 1500 : provider === 'LINKED' ? 6000 + Math.random() * 8000 : 300);

function enqueue(businessId, gapMs, fn) {
  if (!queues.has(businessId)) queues.set(businessId, { tail: Promise.resolve(), last: 0 });
  const q = queues.get(businessId);
  const run = async () => {
    const wait = q.last + gapMs - Date.now();
    if (wait > 0) await sleep(wait);
    try {
      return await fn();
    } finally {
      q.last = Date.now();
    }
  };
  const p = q.tail.then(run);
  q.tail = p.catch(() => {});
  return p;
}

async function deliver(provider, businessId, to, { text, image, document, template }) {
  const p = provider === 'CLOUD' ? cloud : {
    sendText: (...a) => linked.sendText(businessId, ...a),
    sendImage: (...a) => linked.sendImage(businessId, ...a),
    sendDocument: (...a) => linked.sendDocument(businessId, ...a),
  };
  if (image) await p.sendImage(to, image.buffer, { filename: image.filename, mime: image.mime, caption: text, template });
  if (document) await p.sendDocument(to, document.buffer, { filename: document.filename, mime: document.mime, caption: document.caption ?? (image ? undefined : text), template });
  if (!image && !document) await p.sendText(to, text);
}

/**
 * Sends one message and logs it. Never throws for delivery problems - returns { recipient, status, error }.
 * message: { to, text, image?: {buffer, filename, mime}, document?: {buffer, filename, mime, caption?}, template? }
 * meta:    { kind, name, customerId, refId, batchId, userId, bulk }
 */
async function send(business, message, meta = {}) {
  const provider = providerOf(business);
  const recipient = toWhatsAppNumber(message.to, countryCode(business));
  let state = 'SENT';
  let error = null;
  if (recipient.length < 10) {
    state = 'FAILED';
    error = 'No valid mobile number';
  } else if (!isReady(business)) {
    state = 'NOT_CONNECTED';
    error = notReadyError(business);
  } else {
    try {
      await enqueue(business.id, gapFor(provider, meta.bulk), () => deliver(provider, business.id, recipient, message));
    } catch (e) {
      state = 'FAILED';
      error = e.message;
    }
  }
  await prisma.messageLog.create({
    data: {
      businessId: business.id, provider, kind: meta.kind || 'MESSAGE', recipient, name: meta.name || null, customerId: meta.customerId || null,
      refId: meta.refId || null, batchId: meta.batchId || null, status: state, error, userId: meta.userId || null,
    },
  }).catch((e) => console.error('[whatsapp] message log failed', e.message));
  return { recipient: maskNumber(recipient), status: state, error };
}

/**
 * Starts a bulk send in the background and returns { batchId, total } straight away.
 * Follow progress through MessageLog rows with that batchId.
 * items: [{ message, name, customerId, refId }]
 */
function sendBatch(business, items, { kind, userId }) {
  const batchId = crypto.randomUUID();
  (async () => {
    for (const item of items) {
      await send(business, item.message, { kind, userId, batchId, bulk: true, name: item.name, customerId: item.customerId, refId: item.refId });
    }
    console.log(`[whatsapp] ${business.slug} batch ${kind} finished (${items.length})`);
  })().catch((e) => console.error('[whatsapp] batch failed', e.message));
  return { batchId, total: items.length };
}

module.exports = {
  MAX_BULK, providerOf, status, isReady, send, sendBatch, toWhatsAppNumber, maskNumber, countryCode,
  connect: (business) => linked.connect(business.id),
  logout: (business) => linked.logout(business.id),
  resumeAll: linked.resumeAll,
};
