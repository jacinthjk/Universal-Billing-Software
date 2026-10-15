# Universal Business Billing & Commerce Platform

A multi-tenant billing, POS, inventory, CRM, online-store and AI-assistant platform. One codebase serves any business type: retail, grocery/organic, electronics, fashion, beauty, restaurant, pharmacy, services, wholesale or custom. Each business gets its own isolated data, theme, invoices, website and daily reports.

| Layer | Stack |
|---|---|
| Frontend | React 19 + Vite, Tailwind CSS 4, axios, React Router, Recharts |
| Backend | Node.js + Express, JWT auth, Zod validation |
| Database | PostgreSQL via Prisma ORM (Render-hosted) |
| Documents | pdfkit (PDF invoices, A4 + 80mm thermal), resvg (PNG invoices + daily reports) |
| AI | Provider abstraction: Claude (`@anthropic-ai/sdk`) or the built-in rule-based assistant |

## Quick start

```bash
# 1. API
cd backend
npm install
npx prisma generate
npm run db:push      # creates/updates tables (refuses destructive changes)
npm run db:seed      # optional demo data
npm run dev          # http://localhost:5000

# 2. Web app (second terminal)
cd frontend
npm install
npm run dev          # http://localhost:5173  (proxies /api and /files to :5000)
```

Demo login (after seeding): **owner@demo.com / Demo@12345**. It owns two businesses (use the switcher at the top left):

- **Green Leaf Organics** (grocery, organic theme): store at `/s/green-leaf-organics`
- **ByteHub Electronics** (electronics, dark tech theme): store at `/s/bytehub-electronics`

The demo user is also a platform admin (`/admin`).

### Configuration (`backend/.env`)

| Variable | Purpose |
|---|---|
| `DATABASE_URL` | PostgreSQL connection string (Render external URL is set) |
| `JWT_SECRET` / `JWT_EXPIRES_IN` | Session signing |
| `CORS_ORIGINS` | Allowed web origins (comma separated) |
| `PUBLIC_APP_URL` | Public web URL, used in share links, QR codes and invoice verification |
| `PUBLIC_API_URL` | Public API URL, used for uploaded logo/product image URLs |
| `STORAGE_DIR` | Local object storage (swap `src/lib/storage.js` for S3/R2 later) |
| `ANTHROPIC_API_KEY` | Optional. Enables Claude for the AI assistant; without it the rule-based assistant is used |
| `PAYMENT_PROVIDER` + `RAZORPAY_*` | `manual` (pay on delivery/pickup) or `razorpay` |
| `DISABLE_SCHEDULER=1` | Turn off the daily-report cron in a given process |

`.env` is git-ignored because it contains the database password. `.env.example` lists the variables without secrets.

### Single-service production deploy (e.g. Render)

```bash
cd frontend && npm ci && npm run build      # outputs frontend/dist
cd ../backend && npm ci && npx prisma generate && npm start
```

When `frontend/dist` exists, the API also serves the web app (SPA fallback), so one Render Web Service is enough. Set `PUBLIC_APP_URL`, `PUBLIC_API_URL` and `CORS_ORIGINS` to the service URL. Run the API in the same region as the database (Oregon): a distant API adds latency to every query. For persistent uploads, attach a disk at `STORAGE_DIR` or move storage to object storage. Image rendering uses system fonts; on minimal Linux images, drop `.ttf` files (e.g. Inter or DejaVu Sans) into `STORAGE_DIR/fonts`.

## How it maps to the specification

| Spec area | Where |
|---|---|
| Multi-tenant isolation (§3, §28) | `middleware/tenant.js`: tenant comes from `X-Business-Id` and is **membership-checked on every request**; every query filters by `businessId` |
| Business types, themes, terminology (§4–5) | `lib/presets.js`, Settings → Theme & branding; theme = CSS variables applied at runtime |
| Roles & action-level permissions (§6) | `lib/permissions.js`, Settings → Team & roles (custom roles supported) |
| Products/services, variants, batches, custom fields (§8) | `routes/catalog.js`, Products page (fields adapt to business type) |
| Purchasing (§9) | `services/purchases.js`: PO/GRN, batches/expiry, returns, supplier payments |
| POS (§10) | `pages/POS.jsx`: barcode/search, categories, split payments, discounts (permissioned), F9 checkout |
| New vs Repeat customer + visit # (§11, §14) | `services/customers.js`: matched by normalised phone/email; visit counted only for qualifying sales (configurable `PAID`/`COMPLETED`), reversed on cancel |
| Invoices: PDF + image + print + share + QR verify (§13) | `services/invoice.js`: both outputs rendered server-side from the same invoice data; `/verify/:token` public page |
| Enquiries/CRM → order → invoice (§15–16) | `routes/enquiries.js` (convert without retyping), `services/orders.js` |
| Website, sharing, QR, online ordering, tracking (§17–19) | `routes/public.js`, `store/Store.jsx`, Website page |
| Inventory ledger, reservations (§20) | `services/stock.js`: every movement in `StockLedger`; online orders reserve stock until invoiced |
| Daily visual report (§21) | `services/dailyReport.js` (1080×1920 PNG + PDF), `services/scheduler.js` (per-business time & timezone) |
| Agentic AI (§36–55) | `services/ai/*`: controlled, permission-gated, logged tools; mandatory escalation keywords; staff handoff/takeover; knowledge base; AI metrics in reports |
| SaaS readiness (§29) | Modules per business, plan field, suspend/reactivate (platform admin), owner data export, audit log |

### Key rules enforced server-side
- Prices, totals and stock are always recomputed on the server; client prices are accepted only from users with `sales.change_price`.
- Overselling is prevented with a conditional stock decrement inside the sale transaction.
- Website orders take an idempotency key, and payment webhooks are signature-verified and idempotent.
- The AI never touches the database directly. It cannot change prices, apply discounts, modify stock, refund, or mark anything paid, and AI orders wait for staff confirmation by default.

## Project layout

```
backend/
  prisma/schema.prisma      data model (tenants, catalogue, ledger, sales, CRM, AI, reports, audit)
  prisma/seed.js            demo data built through the real services
  src/routes/               REST API (auth, businesses, team, catalog, customers, suppliers,
                            purchases, sales, inventory, enquiries, orders, reports, ai, public, webhooks)
  src/services/             domain logic (stock, sales, orders, customers, invoice, reports, AI, payments)
frontend/
  src/pages/                workspace screens
  src/store/                public storefront + AI chat widget
  src/components/           UI kit, layout, charts
```

## WhatsApp delivery of the daily report

Every day at the report time (default 22:00, business timezone) the server generates the daily report as **PNG, PDF and Excel** and sends the **image + Excel** to the numbers set in *Reports → Daily visual report → Automatic delivery*. Every attempt is logged there; failures retry up to 3 times, 10 minutes apart.

Sending uses Meta's **WhatsApp Business Cloud API**. To switch it on:

1. In [Meta for Developers](https://developers.facebook.com/) create an app → add **WhatsApp** → note the **Phone number ID** and create a **permanent access token** (System User token with `whatsapp_business_messaging`).
2. In WhatsApp Manager create two **message templates** (category *Utility*), approved by Meta:
   - one with an **Image** header (e.g. `daily_report_image`)
   - one with a **Document** header (e.g. `daily_report_file`)
   Templates are required because WhatsApp only allows a business to start a conversation with a template; without them, messages only reach numbers that messaged your business number in the last 24 hours.
3. Fill in `backend/.env` and restart the API:
   ```
   WHATSAPP_PHONE_NUMBER_ID="..."
   WHATSAPP_ACCESS_TOKEN="..."
   WHATSAPP_REPORT_IMAGE_TEMPLATE="daily_report_image"
   WHATSAPP_REPORT_DOC_TEMPLATE="daily_report_file"
   WHATSAPP_TEMPLATE_LANG="en"
   ```
4. Use **Send … now** on the Daily report tab to test.

The scheduler runs inside the API process, so the API must be running at report time - deploy it (e.g. Render) rather than relying on a local dev server.
