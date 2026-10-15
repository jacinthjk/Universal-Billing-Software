require('dotenv').config();
const path = require('path');

const required = ['DATABASE_URL', 'JWT_SECRET'];
for (const key of required) {
  if (!process.env[key]) throw new Error(`Missing required env var ${key}`);
}

module.exports = {
  port: Number(process.env.PORT || 5000),
  env: process.env.NODE_ENV || 'development',
  jwtSecret: process.env.JWT_SECRET,
  jwtExpiresIn: process.env.JWT_EXPIRES_IN || '7d',
  corsOrigins: (process.env.CORS_ORIGINS || 'http://localhost:5173').split(',').map((s) => s.trim()),
  publicAppUrl: (process.env.PUBLIC_APP_URL || 'http://localhost:5173').replace(/\/$/, ''),
  publicApiUrl: (process.env.PUBLIC_API_URL || 'http://localhost:5000').replace(/\/$/, ''),
  storageDir: path.resolve(process.env.STORAGE_DIR || './storage'),
  anthropicApiKey: process.env.ANTHROPIC_API_KEY || '',
  paymentProvider: process.env.PAYMENT_PROVIDER || 'manual',
  // WhatsApp Business Cloud API (Meta) - used to deliver daily reports.
  whatsapp: {
    phoneNumberId: process.env.WHATSAPP_PHONE_NUMBER_ID || '',
    accessToken: process.env.WHATSAPP_ACCESS_TOKEN || '',
    apiVersion: process.env.WHATSAPP_API_VERSION || 'v21.0',
    imageTemplate: process.env.WHATSAPP_REPORT_IMAGE_TEMPLATE || '',
    docTemplate: process.env.WHATSAPP_REPORT_DOC_TEMPLATE || '',
    templateLang: process.env.WHATSAPP_TEMPLATE_LANG || 'en',
  },
  razorpay: {
    keyId: process.env.RAZORPAY_KEY_ID || '',
    keySecret: process.env.RAZORPAY_KEY_SECRET || '',
    webhookSecret: process.env.RAZORPAY_WEBHOOK_SECRET || '',
  },
};
