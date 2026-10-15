const path = require('path');
const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const morgan = require('morgan');
const rateLimit = require('express-rate-limit');
const { Prisma } = require('@prisma/client');
const config = require('./config');
const { HttpError } = require('./lib/errors');
const { requireAuth } = require('./middleware/auth');
const { requireBusiness, requireModule } = require('./middleware/tenant');

const app = express();
app.set('trust proxy', 1);
app.use(helmet({
  crossOriginResourcePolicy: { policy: 'cross-origin' },
  contentSecurityPolicy: {
    directives: {
      'img-src': ["'self'", 'data:', 'blob:', 'https:'],
      'script-src': ["'self'", 'https://checkout.razorpay.com'],
      'frame-src': ["'self'", 'https://api.razorpay.com', 'https://checkout.razorpay.com'],
      'connect-src': ["'self'", 'https://*.razorpay.com'],
      'style-src': ["'self'", "'unsafe-inline'", 'https://fonts.googleapis.com'],
      'font-src': ["'self'", 'data:', 'https://fonts.gstatic.com'],
    },
  },
}));
app.use(cors({ origin: config.corsOrigins, credentials: true }));
app.use(morgan(config.env === 'production' ? 'combined' : 'dev'));

// Webhooks need the raw body for signature verification - mount before the JSON parser.
app.use('/api/webhooks', require('./routes/webhooks'));
app.use(express.json({ limit: '1mb' }));

// Public uploaded assets only (logos, product images). Invoices and reports are never served statically.
app.use('/files', express.static(path.join(config.storageDir, 'public'), { maxAge: '7d', fallthrough: false }));

app.get('/api/health', (req, res) => res.json({ ok: true, time: new Date() }));

const authLimiter = rateLimit({ windowMs: 15 * 60 * 1000, limit: 30, standardHeaders: 'draft-7', legacyHeaders: false });
app.use('/api/auth', authLimiter, require('./routes/auth'));
app.use('/api/public', require('./routes/public'));

// Authenticated, platform level
app.use('/api/businesses', requireAuth, require('./routes/businesses'));
app.use('/api/admin', requireAuth, require('./routes/admin'));

// Authenticated + business-scoped (tenant resolved from X-Business-Id and membership-checked)
const scoped = [requireAuth, requireBusiness];
app.use('/api/team', scoped, require('./routes/team'));
app.use('/api/catalog', scoped, require('./routes/catalog'));
app.use('/api/customers', scoped, require('./routes/customers'));
app.use('/api/suppliers', scoped, requireModule('purchases'), require('./routes/suppliers'));
app.use('/api/purchases', scoped, requireModule('purchases'), require('./routes/purchases'));
app.use('/api/sales', scoped, require('./routes/sales'));
app.use('/api/inventory', scoped, requireModule('inventory'), require('./routes/inventory'));
app.use('/api/enquiries', scoped, requireModule('enquiries'), require('./routes/enquiries'));
app.use('/api/orders', scoped, requireModule('orders'), require('./routes/orders'));
app.use('/api/reports', scoped, require('./routes/reports'));
app.use('/api/ai', scoped, requireModule('ai'), require('./routes/ai'));
app.use('/api/whatsapp', scoped, require('./routes/whatsapp'));

app.use('/api', (req, res) => res.status(404).json({ error: 'Not found' }));

// Optional single-service deploy: serve the built React app (frontend/dist) with SPA fallback.
const webDist = path.resolve(__dirname, '../../frontend/dist');
if (require('fs').existsSync(webDist)) {
  app.use(express.static(webDist, { index: false, maxAge: '1h' }));
  app.get(/^\/(?!api\/|files\/).*/, (req, res) => res.sendFile(path.join(webDist, 'index.html')));
}

// eslint-disable-next-line no-unused-vars
app.use((err, req, res, next) => {
  if (err instanceof HttpError) return res.status(err.status).json({ error: err.message, details: err.details });
  if (err instanceof Prisma.PrismaClientKnownRequestError) {
    if (err.code === 'P2002') return res.status(409).json({ error: 'A record with these details already exists' });
    if (err.code === 'P2025') return res.status(404).json({ error: 'Record not found' });
  }
  if (err.type === 'entity.parse.failed') return res.status(400).json({ error: 'Invalid JSON body' });
  if (err.code === 'LIMIT_FILE_SIZE') return res.status(400).json({ error: 'File is too large' });
  if (err.status === 404 || err.statusCode === 404) return res.status(404).json({ error: 'Not found' });
  console.error(err);
  res.status(500).json({ error: 'Something went wrong. Please try again.' });
});

module.exports = app;
