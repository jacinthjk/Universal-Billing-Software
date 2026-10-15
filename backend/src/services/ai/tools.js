// Controlled tool layer for the AI agent. The model never touches the database directly: it can only
// call these functions, each permission-gated per business, scoped to the business/tenant and the
// current conversation, and logged to AiToolCall (plus AuditLog for writes).
const { prisma } = require('../../lib/prisma');
const { audit, notify } = require('../../lib/audit');
const { n, normalizePhone } = require('../../lib/util');
const { availability } = require('../stock');
const { findCustomer, findOrCreateCustomer } = require('../customers');
const { placeOrder } = require('../orders');
const config = require('../../config');

const storeUrl = (business, path = '') => `${config.publicAppUrl}/s/${business.slug}${path}`;
const itemsSchema = {
  type: 'array',
  items: {
    type: 'object',
    properties: { product_id: { type: 'string' }, qty: { type: 'number', description: 'Quantity in the product unit' } },
    required: ['product_id', 'qty'],
  },
};
const contactSchema = {
  type: 'object',
  properties: { name: { type: 'string' }, phone: { type: 'string' }, email: { type: 'string' } },
};

const DEFINITIONS = {
  search_products: {
    description: 'Search the live catalogue by name, category, brand or SKU. Returns verified name, price, unit and availability. Use this before mentioning any product, price or stock.',
    input_schema: { type: 'object', properties: { query: { type: 'string' }, limit: { type: 'integer', description: 'Max results (default 5)' } }, required: ['query'] },
  },
  get_product_details: {
    description: 'Get verified details for one product/service: description, specifications/custom fields, price, MRP, tax and current availability.',
    input_schema: { type: 'object', properties: { product_id: { type: 'string' } }, required: ['product_id'] },
  },
  check_stock: {
    description: 'Check whether a quantity of a product is currently available to order.',
    input_schema: { type: 'object', properties: { product_id: { type: 'string' }, qty: { type: 'number' } }, required: ['product_id'] },
  },
  get_business_info: {
    description: 'Business hours, address, contact details, delivery/pickup options, payment options, policies, and approved knowledge-base answers (FAQs, ingredients, delivery areas). Pass a topic to search the knowledge base.',
    input_schema: { type: 'object', properties: { topic: { type: 'string', description: 'Optional question or topic to look up' } } },
  },
  search_customer: {
    description: 'Check whether the person chatting is an existing customer, using the phone or email THEY provided. Returns only whether a profile exists - never other customers\' details.',
    input_schema: { type: 'object', properties: { phone: { type: 'string' }, email: { type: 'string' } } },
  },
  create_customer: {
    description: 'Create (or match) the customer profile for the person chatting, once they have shared their name and phone or email.',
    input_schema: { type: 'object', properties: { name: { type: 'string' }, phone: { type: 'string' }, email: { type: 'string' }, city: { type: 'string' } }, required: ['name'] },
  },
  create_enquiry: {
    description: 'Record this conversation as a lead/enquiry in the CRM. Call once the customer\'s need is clear (ideally with contact details). If an enquiry already exists for this chat it is updated instead.',
    input_schema: {
      type: 'object',
      properties: {
        intent: { type: 'string', enum: ['PRODUCT_ENQUIRY', 'PURCHASE', 'GENERAL', 'COMPLAINT', 'SUPPORT', 'OTHER'] },
        name: { type: 'string' }, phone: { type: 'string' }, email: { type: 'string' },
        product_id: { type: 'string', description: 'Main product of interest, if any' },
        item_text: { type: 'string', description: 'What they asked for, in their words' },
        quantity: { type: 'string' }, budget: { type: 'string', description: 'Only if the customer stated it' },
        location: { type: 'string' }, urgency: { type: 'string', enum: ['TODAY', 'THIS_WEEK', 'RESEARCHING', 'UNKNOWN'] },
        summary: { type: 'string', description: 'Concise summary of the conversation so far' },
        next_action: { type: 'string' },
        signals: { type: 'array', items: { type: 'string', enum: ['productSelected', 'quantityGiven', 'priceAsked', 'deliveryAsked', 'quotationAsked', 'cartCreated', 'callbackAsked'] } },
      },
      required: ['intent', 'summary'],
    },
  },
  update_enquiry: {
    description: 'Update this conversation\'s enquiry: summary, status, buying signals or notes.',
    input_schema: {
      type: 'object',
      properties: {
        status: { type: 'string', enum: ['NEW', 'ENGAGED', 'QUALIFIED', 'HIGH_INTENT', 'CLOSED'] },
        summary: { type: 'string' }, note: { type: 'string' }, quantity: { type: 'string' }, location: { type: 'string' },
        signals: { type: 'array', items: { type: 'string' } },
      },
    },
  },
  create_followup: {
    description: 'Schedule a staff follow-up (e.g. a callback) on this conversation\'s enquiry.',
    input_schema: { type: 'object', properties: { note: { type: 'string' }, when: { type: 'string', description: 'ISO date-time; default is in 2 hours' } }, required: ['note'] },
  },
  create_cart: {
    description: 'Build a cart on the website with verified prices and return a checkout link the customer can open.',
    input_schema: { type: 'object', properties: { items: itemsSchema }, required: ['items'] },
  },
  create_quotation: {
    description: 'Create a quotation for the customer with verified prices (no stock is reserved). Requires contact details.',
    input_schema: { type: 'object', properties: { items: itemsSchema, contact: contactSchema, notes: { type: 'string' } }, required: ['items', 'contact'] },
  },
  create_order: {
    description: 'Place an order ONLY after the customer has explicitly confirmed the items, quantities, total and fulfilment. Orders are never marked paid; staff confirm them.',
    input_schema: {
      type: 'object',
      properties: {
        items: itemsSchema, contact: contactSchema,
        fulfilment: { type: 'string', enum: ['PICKUP', 'DELIVERY'] }, address: { type: 'string' },
        customer_confirmed: { type: 'boolean', description: 'True only if the customer explicitly said yes to this exact order' },
      },
      required: ['items', 'contact', 'fulfilment', 'customer_confirmed'],
    },
  },
  handoff_to_staff: {
    description: 'Hand the conversation to a human. Use when asked for a person, for complaints, refunds, payment disputes, negotiated/bulk pricing, sensitive account issues, or when verified data cannot answer the question.',
    input_schema: {
      type: 'object',
      properties: { reason: { type: 'string' }, summary: { type: 'string' }, suggested_next_action: { type: 'string' } },
      required: ['reason', 'summary'],
    },
  },
  get_order_status: {
    description: 'Look up an order\'s status. Requires the order number and the phone number used for the order.',
    input_schema: { type: 'object', properties: { order_number: { type: 'string' }, phone: { type: 'string' } }, required: ['order_number', 'phone'] },
  },
};

const WRITE_TOOLS = new Set(['create_customer', 'create_enquiry', 'update_enquiry', 'create_followup', 'create_quotation', 'create_order', 'handoff_to_staff']);

function toolDefinitions(business) {
  const perms = business.ai.permissions;
  return Object.entries(DEFINITIONS).filter(([name]) => perms[name]).map(([name, d]) => ({ name, ...d }));
}

function productView(business, p, avail) {
  const a = avail[p.id];
  return {
    product_id: p.id, name: p.name, variant: p.variant || undefined, kind: p.kind, unit: p.unit,
    price: n(p.sellingPrice), mrp: p.mrp ? n(p.mrp) : undefined, currency: business.currency,
    category: p.category?.name, brand: p.brand || undefined,
    availability: a.available === null ? 'available' : a.available > 0 ? (business.website.showStock ? `${a.available} ${p.unit} in stock` : 'in stock') : 'out of stock',
    url: storeUrl(business, `/p/${p.id}`),
  };
}

function leadScore(rules, signals = [], isRepeat = false) {
  let s = 0;
  for (const sig of new Set(signals)) s += rules[sig] || 0;
  if (isRepeat) s += rules.repeatCustomer || 0;
  return Math.min(s, 100);
}
const statusForScore = (score) => (score >= 70 ? 'HIGH_INTENT' : score >= 40 ? 'QUALIFIED' : score >= 15 ? 'ENGAGED' : 'NEW');

async function ensureEnquiry(ctx, seed = {}) {
  const { business, conversation } = ctx;
  if (conversation.enquiryId) {
    const e = await prisma.enquiry.findFirst({ where: { id: conversation.enquiryId, businessId: business.id } });
    if (e) return e;
  }
  const e = await prisma.enquiry.create({
    data: {
      businessId: business.id, customerId: conversation.customerId, source: conversation.channel === 'WEBSITE' ? 'WEBSITE_AI' : `${conversation.channel}_AI`,
      intent: seed.intent || 'GENERAL', summary: seed.summary || 'Conversation with AI assistant', createdByAi: true, status: 'NEW',
    },
  });
  conversation.enquiryId = e.id;
  await prisma.aiConversation.update({ where: { id: conversation.id }, data: { enquiryId: e.id } });
  await audit({ businessId: business.id, actor: 'AI', action: 'enquiry.create', entity: 'Enquiry', entityId: e.id, data: { conversationId: conversation.id } });
  return e;
}

async function linkCustomer(ctx, customer) {
  const { conversation } = ctx;
  if (!customer || conversation.customerId === customer.id) return;
  conversation.customerId = customer.id;
  await prisma.aiConversation.update({ where: { id: conversation.id }, data: { customerId: customer.id } });
  if (conversation.enquiryId) await prisma.enquiry.update({ where: { id: conversation.enquiryId }, data: { customerId: customer.id } });
}

const mapItems = (items) => (items || []).map((i) => ({ productId: i.product_id, qty: n(i.qty) }));

const EXECUTORS = {
  async search_products({ business }, { query, limit = 5 }) {
    const words = String(query || '').trim().split(/\s+/).filter((w) => w.length > 1).slice(0, 6);
    const where = {
      businessId: business.id, active: true, showOnWebsite: true,
      AND: words.map((w) => ({ OR: [{ name: { contains: w, mode: 'insensitive' } }, { sku: { equals: w, mode: 'insensitive' } }, { brand: { contains: w, mode: 'insensitive' } }, { variant: { contains: w, mode: 'insensitive' } }, { category: { name: { contains: w, mode: 'insensitive' } } }] })),
    };
    let products = await prisma.product.findMany({ where, include: { category: true }, take: Math.min(limit, 10) });
    if (!products.length && words.length > 1) {
      // Fall back to matching any word.
      products = await prisma.product.findMany({ where: { businessId: business.id, active: true, showOnWebsite: true, OR: words.map((w) => ({ name: { contains: w, mode: 'insensitive' } })) }, include: { category: true }, take: Math.min(limit, 10) });
    }
    const avail = await availability(business.id, products);
    return { results: products.map((p) => productView(business, p, avail)), note: products.length ? undefined : 'No matching products in the catalogue.' };
  },

  async get_product_details({ business }, { product_id }) {
    const p = await prisma.product.findFirst({ where: { id: product_id, businessId: business.id, active: true, showOnWebsite: true }, include: { category: true } });
    if (!p) return { error: 'Product not found' };
    const avail = await availability(business.id, [p]);
    return { ...productView(business, p, avail), description: p.description || 'No description on file.', details: p.customFields, tax_rate_percent: n(p.taxRate), prices_include_tax: business.settings.taxInclusive };
  },

  async check_stock({ business }, { product_id, qty = 1 }) {
    const p = await prisma.product.findFirst({ where: { id: product_id, businessId: business.id, active: true } });
    if (!p) return { error: 'Product not found' };
    const a = (await availability(business.id, [p]))[p.id];
    if (a.available === null) return { product: p.name, available: true };
    return { product: p.name, requested: qty, available: a.available >= qty, ...(business.website.showStock ? { in_stock_qty: Math.max(a.available, 0), unit: p.unit } : {}) };
  },

  async get_business_info({ business }, { topic } = {}) {
    const w = business.website;
    const info = {
      name: business.name, phone: business.phone, email: business.email, address: [business.address, business.city].filter(Boolean).join(', '),
      hours: w.hours || 'Not specified', fulfilment_options: w.fulfilment, payment_options: w.paymentOptions,
      delivery_note: w.deliveryNote || undefined, policies: w.policies, website: storeUrl(business),
    };
    const kbWhere = { businessId: business.id, active: true };
    let kb = await prisma.knowledgeItem.findMany({ where: kbWhere, take: 50 });
    if (topic) {
      const words = topic.toLowerCase().split(/\W+/).filter((x) => x.length > 2);
      kb = kb.map((k) => ({ k, score: words.filter((w2) => `${k.title} ${k.content}`.toLowerCase().includes(w2)).length })).filter((x) => x.score > 0).sort((a, b) => b.score - a.score).map((x) => x.k);
    }
    return { ...info, knowledge_base: kb.slice(0, 8).map((k) => ({ title: k.title, answer: k.content, category: k.category })) };
  },

  async search_customer(ctx, { phone, email }) {
    const c = await findCustomer(ctx.business.id, { phone, email }, ctx.business.settings.customerMatch);
    if (c) await linkCustomer(ctx, c);
    return { found: !!c, returning_customer: !!c && c.visitCount > 0 };
  },

  async create_customer(ctx, { name, phone, email, city }) {
    if (!phone && !email) return { error: 'Ask the customer for a phone number or email first.' };
    const c = await prisma.$transaction((tx) => findOrCreateCustomer(tx, ctx.business.id, { name, phone, email, city, isLead: true, createdByAi: true }, ctx.business.settings.customerMatch));
    await linkCustomer(ctx, c);
    await audit({ businessId: ctx.business.id, actor: 'AI', action: 'customer.upsert', entity: 'Customer', entityId: c.id, data: { conversationId: ctx.conversation.id } });
    return { customer_id: c.id, status: 'saved' };
  },

  async create_enquiry(ctx, input) {
    const { business } = ctx;
    if ((input.phone || input.email) && !ctx.conversation.customerId) {
      await EXECUTORS.create_customer(ctx, { name: input.name || 'Website visitor', phone: input.phone, email: input.email });
    }
    const e = await ensureEnquiry(ctx, input);
    let product = null;
    if (input.product_id) product = await prisma.product.findFirst({ where: { id: input.product_id, businessId: business.id }, select: { id: true } });
    const customer = ctx.conversation.customerId ? await prisma.customer.findUnique({ where: { id: ctx.conversation.customerId } }) : null;
    const signals = [...new Set([...(ctx.signals || []), ...(input.signals || [])])];
    ctx.signals = signals;
    const score = leadScore(business.ai.leadRules, signals, customer?.visitCount > 0);
    const updated = await prisma.enquiry.update({
      where: { id: e.id },
      data: {
        intent: input.intent, name: input.name || customer?.name || e.name, phone: normalizePhone(input.phone) || customer?.phone || e.phone,
        email: input.email || customer?.email || e.email, productId: product?.id || e.productId, itemText: input.item_text || e.itemText,
        quantity: input.quantity || e.quantity, budget: input.budget || e.budget, location: input.location || e.location,
        urgency: input.urgency || e.urgency, summary: input.summary, nextAction: input.next_action || e.nextAction,
        leadScore: score, status: e.status === 'CONVERTED' ? e.status : statusForScore(score),
        priority: input.intent === 'COMPLAINT' || score >= 70 ? 'HIGH' : 'NORMAL',
      },
    });
    await notify(business.id, { type: 'LEAD', title: `AI lead: ${updated.name || 'Website visitor'}`, body: updated.summary, link: `/enquiries/${updated.id}` });
    return { enquiry_id: updated.id, lead_status: updated.status, lead_score: score };
  },

  async update_enquiry(ctx, input) {
    if (!ctx.conversation.enquiryId) return { error: 'No enquiry exists for this conversation yet - use create_enquiry.' };
    const e = await prisma.enquiry.findFirst({ where: { id: ctx.conversation.enquiryId, businessId: ctx.business.id } });
    const signals = [...new Set([...(ctx.signals || []), ...(input.signals || [])])];
    ctx.signals = signals;
    const score = leadScore(ctx.business.ai.leadRules, signals);
    const data = {
      ...(input.summary ? { summary: input.summary } : {}), ...(input.quantity ? { quantity: input.quantity } : {}), ...(input.location ? { location: input.location } : {}),
      leadScore: Math.max(score, e.leadScore),
    };
    if (input.status && e.status !== 'CONVERTED') data.status = input.status;
    else if (e.status !== 'CONVERTED') data.status = statusForScore(data.leadScore);
    await prisma.enquiry.update({ where: { id: e.id }, data });
    if (input.note) await prisma.enquiryFollowup.create({ data: { enquiryId: e.id, note: input.note, byAi: true } });
    return { enquiry_id: e.id, lead_status: data.status || e.status };
  },

  async create_followup(ctx, { note, when }) {
    const e = await ensureEnquiry(ctx, { summary: note });
    const at = when && !Number.isNaN(Date.parse(when)) ? new Date(when) : new Date(Date.now() + 2 * 3600 * 1000);
    await prisma.enquiry.update({ where: { id: e.id }, data: { followUpAt: at, nextAction: note } });
    await prisma.enquiryFollowup.create({ data: { enquiryId: e.id, note: `Follow-up scheduled: ${note}`, byAi: true } });
    await notify(ctx.business.id, { type: 'FOLLOWUP', title: 'AI scheduled a follow-up', body: note, link: `/enquiries/${e.id}` });
    return { scheduled_for: at.toISOString() };
  },

  async create_cart(ctx, { items }) {
    const { business } = ctx;
    const ids = items.map((i) => i.product_id);
    const products = await prisma.product.findMany({ where: { businessId: business.id, id: { in: ids }, active: true, showOnWebsite: true } });
    const avail = await availability(business.id, products);
    const lines = [];
    const problems = [];
    for (const it of items) {
      const p = products.find((x) => x.id === it.product_id);
      if (!p) { problems.push(`Unknown product ${it.product_id}`); continue; }
      const a = avail[p.id];
      if (a.available !== null && a.available < it.qty) problems.push(`${p.name}: only ${Math.max(a.available, 0)} ${p.unit} available`);
      lines.push({ id: p.id, q: n(it.qty) });
    }
    const token = Buffer.from(JSON.stringify(lines)).toString('base64url');
    ctx.signals = [...new Set([...(ctx.signals || []), 'cartCreated'])];
    if (ctx.conversation.enquiryId) await EXECUTORS.update_enquiry(ctx, { note: 'AI created a website cart' });
    const subtotal = lines.reduce((s, l) => s + n(products.find((p) => p.id === l.id)?.sellingPrice) * l.q, 0);
    return { checkout_url: storeUrl(business, `/cart?add=${token}`), estimated_total_before_tax: subtotal, currency: business.currency, problems: problems.length ? problems : undefined };
  },

  async create_quotation(ctx, { items, contact, notes }) {
    const order = await placeOrder(ctx.business, { items: mapItems(items), contact, kind: 'QUOTATION', channel: 'AI', notes, enquiryId: ctx.conversation.enquiryId, createdByAi: true, customerId: ctx.conversation.customerId }, { actor: 'AI' });
    await linkCustomer(ctx, { id: order.customerId });
    return { quotation_number: order.number, total: n(order.total), currency: ctx.business.currency, note: 'Staff will review and share the final quotation.' };
  },

  async create_order(ctx, { items, contact, fulfilment, address, customer_confirmed }) {
    if (!customer_confirmed) return { error: 'Confirm the exact items, quantities, total and fulfilment with the customer first.' };
    if (fulfilment === 'DELIVERY' && !address) return { error: 'A delivery address is required.' };
    const order = await placeOrder(ctx.business, {
      items: mapItems(items), contact, fulfilment, address, kind: 'ORDER', channel: 'AI', paymentMethod: fulfilment === 'DELIVERY' ? 'PAY_ON_DELIVERY' : 'PAY_AT_PICKUP',
      notes: ctx.business.ai.orderRequiresStaffApproval ? 'Placed via AI assistant - awaiting staff confirmation' : 'Placed via AI assistant',
      enquiryId: ctx.conversation.enquiryId, createdByAi: true, customerId: ctx.conversation.customerId,
    }, { actor: 'AI' });
    await linkCustomer(ctx, { id: order.customerId });
    return {
      order_number: order.number, total: n(order.total), currency: ctx.business.currency, payment_status: 'UNPAID',
      status: ctx.business.ai.orderRequiresStaffApproval ? 'Awaiting staff confirmation' : 'Received',
      tracking_url: storeUrl(ctx.business, `/track/${order.trackingToken}`),
    };
  },

  async handoff_to_staff(ctx, { reason, summary, suggested_next_action }) {
    const e = await ensureEnquiry(ctx, { summary, intent: /complain|refund|dispute/i.test(reason) ? 'COMPLAINT' : 'SUPPORT' });
    await prisma.enquiry.update({ where: { id: e.id }, data: { summary, nextAction: suggested_next_action || 'Reply to customer', priority: 'HIGH', followUpAt: new Date() } });
    await prisma.enquiryFollowup.create({ data: { enquiryId: e.id, note: `AI handoff - ${reason}. ${suggested_next_action || ''}`.trim(), byAi: true } });
    await prisma.aiConversation.update({ where: { id: ctx.conversation.id }, data: { status: 'HANDOFF', summary } });
    ctx.conversation.status = 'HANDOFF';
    await notify(ctx.business.id, { type: 'HANDOFF', title: 'Customer needs a human', body: `${reason}: ${summary}`, link: `/ai?conversation=${ctx.conversation.id}` });
    return { handed_off: true, message_for_customer: 'A team member will continue this conversation shortly.' };
  },

  async get_order_status({ business }, { order_number, phone }) {
    const order = await prisma.order.findFirst({ where: { businessId: business.id, number: { equals: order_number.trim(), mode: 'insensitive' } }, include: { items: true } });
    if (!order || normalizePhone(order.contactPhone) !== normalizePhone(phone)) return { error: 'No order found with that number and phone.' };
    return { order_number: order.number, status: order.status, payment_status: order.paymentStatus, fulfilment: order.fulfilment, total: n(order.total), items: order.items.map((i) => `${n(i.qty)} × ${i.name}`), tracking_url: storeUrl(business, `/track/${order.trackingToken}`) };
  },
};

/** Executes a tool call for the agent with permission checks and logging. Never throws. */
async function executeTool(ctx, name, input) {
  const { business, conversation } = ctx;
  let output;
  let ok = true;
  try {
    if (!EXECUTORS[name]) throw new Error(`Unknown tool ${name}`);
    if (!business.ai.permissions[name]) throw new Error(`The business has not allowed the assistant to use ${name}`);
    output = await EXECUTORS[name](ctx, input || {});
    if (output?.error) ok = false;
  } catch (e) {
    ok = false;
    output = { error: e.status && e.status < 500 ? e.message : `Tool failed: ${e.message}` };
  }
  await prisma.aiToolCall.create({ data: { businessId: business.id, conversationId: conversation.id, tool: name, input: input || {}, output, ok } }).catch(() => {});
  if (WRITE_TOOLS.has(name) && ok) {
    await audit({ businessId: business.id, actor: 'AI', action: `ai.${name}`, entity: 'AiConversation', entityId: conversation.id, data: { input, output } });
  }
  return { ok, output };
}

module.exports = { toolDefinitions, executeTool, storeUrl, leadScore };
