// WhatsApp Business Cloud API (Meta) provider: upload media, then send it as an image or document.
//
// Business-initiated messages need an approved *template* unless the recipient messaged the business
// number in the last 24 hours. Set WHATSAPP_REPORT_IMAGE_TEMPLATE / WHATSAPP_REPORT_DOC_TEMPLATE to
// templates with an IMAGE / DOCUMENT header to deliver reliably every day; without them free-form
// messages are sent (fine for testing within the 24-hour window).
const config = require('../../config');

const wa = config.whatsapp;
const isConfigured = () => !!(wa.phoneNumberId && wa.accessToken);
const base = () => `https://graph.facebook.com/${wa.apiVersion}/${wa.phoneNumberId}`;

async function call(path, init) {
  const res = await fetch(`${base()}${path}`, { ...init, headers: { Authorization: `Bearer ${wa.accessToken}`, ...(init.headers || {}) } });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) {
    const err = new Error(body?.error?.error_user_msg || body?.error?.message || `WhatsApp API error ${res.status}`);
    err.status = res.status;
    throw err;
  }
  return body;
}

async function uploadMedia(buffer, mime, filename) {
  const form = new FormData();
  form.append('messaging_product', 'whatsapp');
  form.append('type', mime);
  form.append('file', new Blob([buffer], { type: mime }), filename);
  const { id } = await call('/media', { method: 'POST', body: form });
  return id;
}

const send = (to, message) => call('/messages', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ messaging_product: 'whatsapp', recipient_type: 'individual', to, ...message }),
});

function templateMessage(name, headerParam) {
  return { type: 'template', template: { name, language: { code: wa.templateLang }, components: [{ type: 'header', parameters: [headerParam] }] } };
}

// Free-form text: only delivered inside the 24-hour customer service window.
const sendText = (to, text) => send(to, { type: 'text', text: { body: text, preview_url: true } });

// template: true uses the daily-report templates (if configured) so reports arrive outside the 24-hour window.
async function sendImage(to, buffer, { filename, caption, mime = 'image/png', template = false }) {
  const id = await uploadMedia(buffer, mime, filename);
  return send(to, template && wa.imageTemplate ? templateMessage(wa.imageTemplate, { type: 'image', image: { id } }) : { type: 'image', image: { id, caption } });
}

async function sendDocument(to, buffer, { filename, mime, caption, template = false }) {
  const id = await uploadMedia(buffer, mime, filename);
  return send(to, template && wa.docTemplate ? templateMessage(wa.docTemplate, { type: 'document', document: { id, filename } }) : { type: 'document', document: { id, filename, caption } });
}

module.exports = { name: 'CLOUD', isConfigured, sendText, sendImage, sendDocument };
