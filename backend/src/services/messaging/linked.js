// WhatsApp linked-device provider: the business scans a QR code (WhatsApp > Linked devices) and the
// server sends from their own number, like WhatsApp Web. Built on Baileys (unofficial).
//
// WhatsApp does not permit unofficial clients and can ban numbers that send bulk or unsolicited
// messages. Callers throttle bulk sends (see ./index.js) and product updates only go to customers
// who gave marketing consent.
//
// Session keys live in the WhatsAppAuth table, so a link survives restarts and redeploys. Only one
// server instance may hold a business's session at a time - a second one gets "connection replaced".
const QRCode = require('qrcode');
const { prisma } = require('../../lib/prisma');
const { notify } = require('../../lib/audit');

let lib;
const baileys = async () => (lib ||= await import('baileys'));
const logger = require('pino')({ level: 'silent' });

const MAX_RETRIES = 8;

// businessId -> { sock, status: DISCONNECTED | CONNECTING | QR | CONNECTED, qr, me, error, retries, stopping }
const sessions = new Map();

// ───── Auth state in Postgres (same contract as Baileys' useMultiFileAuthState) ─────

async function dbAuthState(businessId) {
  const { BufferJSON, initAuthCreds, proto } = await baileys();
  const where = (key) => ({ businessId_key: { businessId, key } });
  const encode = (data) => JSON.stringify(data, BufferJSON.replacer);
  const decode = (value) => JSON.parse(value, BufferJSON.reviver);

  // Writes are serialised per session so concurrent upserts of the same key can't collide.
  let chain = Promise.resolve();
  const serial = (fn) => (chain = chain.catch(() => {}).then(fn));

  const row = await prisma.whatsAppAuth.findUnique({ where: where('creds') });
  const creds = row ? decode(row.value) : initAuthCreds();

  return {
    state: {
      creds,
      keys: {
        get: async (type, ids) => {
          const rows = await prisma.whatsAppAuth.findMany({ where: { businessId, key: { in: ids.map((id) => `${type}-${id}`) } } });
          const byKey = Object.fromEntries(rows.map((r) => [r.key, decode(r.value)]));
          const out = {};
          for (const id of ids) {
            let value = byKey[`${type}-${id}`] ?? null;
            if (type === 'app-state-sync-key' && value) value = proto.Message.AppStateSyncKeyData.fromObject(value);
            out[id] = value;
          }
          return out;
        },
        set: (data) => serial(async () => {
          const ops = [];
          for (const type of Object.keys(data)) {
            for (const [id, value] of Object.entries(data[type])) {
              const key = `${type}-${id}`;
              ops.push(value
                ? prisma.whatsAppAuth.upsert({ where: where(key), create: { businessId, key, value: encode(value) }, update: { value: encode(value) } })
                : prisma.whatsAppAuth.deleteMany({ where: { businessId, key } }));
            }
          }
          if (ops.length) await prisma.$transaction(ops);
        }),
      },
    },
    saveCreds: () => serial(() => prisma.whatsAppAuth.upsert({ where: where('creds'), create: { businessId, key: 'creds', value: encode(creds) }, update: { value: encode(creds) } })),
  };
}

const clearAuth = (businessId) => prisma.whatsAppAuth.deleteMany({ where: { businessId } });

// ───── Connection lifecycle ─────

function session(businessId) {
  if (!sessions.has(businessId)) sessions.set(businessId, { sock: null, status: 'DISCONNECTED', qr: null, me: null, error: null, retries: 0 });
  return sessions.get(businessId);
}

/** Opens (or resumes) the business's WhatsApp connection. A new link shows a QR code in status(). */
async function connect(businessId) {
  const s = session(businessId);
  if (s.sock || s.status === 'CONNECTING') return status(businessId);
  s.status = 'CONNECTING';
  s.error = null;
  s.stopping = false;

  const { default: makeWASocket, DisconnectReason, Browsers, fetchLatestBaileysVersion } = await baileys();
  let auth;
  try {
    auth = await dbAuthState(businessId);
  } catch (e) {
    s.status = 'DISCONNECTED';
    s.error = `Could not load the WhatsApp session: ${e.message}`;
    return status(businessId);
  }
  // Using the current WhatsApp Web version avoids "outdated client" rejections; fall back to the bundled one.
  const { version } = await fetchLatestBaileysVersion().catch(() => ({}));
  const sock = makeWASocket({
    auth: auth.state, version, logger, browser: Browsers.windows('Chrome'),
    markOnlineOnConnect: false, syncFullHistory: false, generateHighQualityLinkPreview: false,
  });
  s.sock = sock;

  sock.ev.on('creds.update', auth.saveCreds);
  sock.ev.on('connection.update', async ({ connection, lastDisconnect, qr }) => {
    if (sock !== s.sock) return; // a newer socket replaced this one
    if (qr) {
      s.status = 'QR';
      s.qr = await QRCode.toDataURL(qr, { margin: 1, width: 320 });
    }
    if (connection === 'open') {
      const phone = (sock.user?.id || '').split(/[:@]/)[0];
      Object.assign(s, { status: 'CONNECTED', qr: null, error: null, retries: 0, me: { phone, name: sock.user?.name || null }, connectedAt: new Date() });
      console.log(`[whatsapp] ${businessId} linked as +${phone}`);
    }
    if (connection !== 'close') return;

    const code = lastDisconnect?.error?.output?.statusCode;
    const paired = !!auth.state.creds.me;
    s.sock = null;
    s.qr = null;
    if (s.stopping) {
      s.status = 'DISCONNECTED';
    } else if (code === DisconnectReason.loggedOut) {
      await clearAuth(businessId);
      Object.assign(s, { status: 'DISCONNECTED', me: null, error: 'WhatsApp was unlinked from the phone. Scan a new QR code to link again.' });
      await notify(businessId, { type: 'WHATSAPP', title: 'WhatsApp disconnected', body: s.error, link: '/whatsapp' });
    } else if (code === DisconnectReason.connectionReplaced) {
      Object.assign(s, { status: 'DISCONNECTED', error: 'This WhatsApp session was opened somewhere else (another server or browser). Click Reconnect to take it back.' });
    } else if (!paired && code !== DisconnectReason.restartRequired) {
      // Nobody scanned before the QR codes ran out.
      Object.assign(s, { status: 'DISCONNECTED', error: 'The QR code expired. Click Link WhatsApp to get a new one.' });
    } else if (s.retries >= MAX_RETRIES) {
      Object.assign(s, { status: 'DISCONNECTED', error: `Lost connection to WhatsApp (${lastDisconnect?.error?.message || code}). Click Reconnect.` });
      await notify(businessId, { type: 'WHATSAPP', title: 'WhatsApp disconnected', body: s.error, link: '/whatsapp' });
    } else {
      // restartRequired right after pairing, or a dropped network connection: reconnect with backoff.
      const delay = code === DisconnectReason.restartRequired ? 0 : Math.min(2 ** s.retries * 2000, 60000);
      s.retries += 1;
      s.status = 'CONNECTING';
      setTimeout(() => {
        if (s.stopping) return; // unlinked while waiting
        s.status = 'DISCONNECTED';
        connect(businessId).catch(() => {});
      }, delay);
    }
  });
  return status(businessId);
}

/** Unlinks the device from the phone and forgets the session. */
async function logout(businessId) {
  const s = session(businessId);
  s.stopping = true;
  try {
    await s.sock?.logout();
  } catch { /* already gone */ }
  s.sock?.end?.(undefined);
  await clearAuth(businessId);
  Object.assign(s, { sock: null, status: 'DISCONNECTED', qr: null, me: null, error: null, retries: 0 });
}

function status(businessId) {
  const s = session(businessId);
  return { status: s.status, connected: s.status === 'CONNECTED', qr: s.qr, me: s.me, error: s.error, connectedAt: s.connectedAt || null };
}

const isReady = (businessId) => session(businessId).status === 'CONNECTED';

/** Reconnects every business that was linked before the server restarted. */
async function resumeAll() {
  const rows = await prisma.whatsAppAuth.findMany({ where: { key: 'creds' }, select: { businessId: true } });
  for (const { businessId } of rows) {
    connect(businessId).catch((e) => console.error(`[whatsapp] resume ${businessId}:`, e.message));
  }
  if (rows.length) console.log(`[whatsapp] resuming ${rows.length} linked session(s)`);
}

// ───── Sending ─────

async function jidFor(businessId, number) {
  const s = session(businessId);
  if (!s.sock || s.status !== 'CONNECTED') throw new Error('WhatsApp is not linked. Open WhatsApp settings and scan the QR code.');
  const [hit] = (await s.sock.onWhatsApp(number)) || [];
  if (!hit?.exists) throw new Error(`+${number} is not on WhatsApp`);
  return { sock: s.sock, jid: hit.jid };
}

async function sendText(businessId, to, text) {
  const { sock, jid } = await jidFor(businessId, to);
  return sock.sendMessage(jid, { text });
}

async function sendImage(businessId, to, buffer, { caption } = {}) {
  const { sock, jid } = await jidFor(businessId, to);
  return sock.sendMessage(jid, { image: buffer, caption });
}

async function sendDocument(businessId, to, buffer, { filename, mime, caption } = {}) {
  const { sock, jid } = await jidFor(businessId, to);
  return sock.sendMessage(jid, { document: buffer, mimetype: mime, fileName: filename, caption });
}

module.exports = { name: 'LINKED', connect, logout, status, isReady, resumeAll, sendText, sendImage, sendDocument };
