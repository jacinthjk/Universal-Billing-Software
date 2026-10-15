// Payment gateway abstraction. Providers implement createCheckout() and verifyWebhook().
// "manual" means no online gateway (pay on delivery / at pickup); Razorpay is one pluggable provider.
const crypto = require('crypto');
const config = require('../../config');

const manual = {
  name: 'manual',
  online: false,
  async createCheckout() {
    return null;
  },
  verifyWebhook() {
    return null;
  },
};

const razorpay = {
  name: 'razorpay',
  online: true,
  async createCheckout(order, business) {
    const auth = Buffer.from(`${config.razorpay.keyId}:${config.razorpay.keySecret}`).toString('base64');
    const res = await fetch('https://api.razorpay.com/v1/orders', {
      method: 'POST',
      headers: { Authorization: `Basic ${auth}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        amount: Math.round(Number(order.total) * 100),
        currency: business.currency,
        receipt: order.id,
        notes: { businessId: business.id, orderId: order.id, number: order.number },
      }),
    });
    if (!res.ok) throw new Error(`Razorpay order failed: ${res.status}`);
    const rp = await res.json();
    return { provider: 'razorpay', keyId: config.razorpay.keyId, gatewayOrderId: rp.id, amount: rp.amount, currency: rp.currency };
  },
  // Returns { orderId, paymentRef, eventId } for a captured payment, or null for events we ignore.
  verifyWebhook(rawBody, headers) {
    const sig = headers['x-razorpay-signature'];
    const expected = crypto.createHmac('sha256', config.razorpay.webhookSecret).update(rawBody).digest('hex');
    if (!sig || sig.length !== expected.length || !crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(expected))) {
      const err = new Error('Invalid webhook signature');
      err.status = 400;
      throw err;
    }
    const event = JSON.parse(rawBody.toString('utf8'));
    if (!['payment.captured', 'order.paid'].includes(event.event)) return null;
    const payment = event.payload?.payment?.entity;
    return { orderId: payment?.notes?.orderId, paymentRef: payment?.id, eventId: headers['x-razorpay-event-id'] || payment?.id, amount: payment?.amount / 100 };
  },
};

const providers = { manual, razorpay };

function getProvider() {
  const p = providers[config.paymentProvider] || manual;
  if (p === razorpay && (!config.razorpay.keyId || !config.razorpay.keySecret)) return manual;
  return p;
}

module.exports = { getProvider };
