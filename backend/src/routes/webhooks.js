// Payment gateway webhooks. Signature-verified and idempotent: replays of the same event are no-ops.
const router = require('express').Router();
const express = require('express');
const { prisma } = require('../lib/prisma');
const { getProvider } = require('../services/payments');
const { audit, notify } = require('../lib/audit');

router.post('/payments', express.raw({ type: '*/*', limit: '1mb' }), async (req, res) => {
  try {
    const provider = getProvider();
    const evt = provider.verifyWebhook(req.body, req.headers);
    if (!evt?.orderId) return res.json({ ok: true, ignored: true });
    const order = await prisma.order.findUnique({ where: { id: evt.orderId } });
    if (!order) return res.json({ ok: true, ignored: true });
    if (order.paymentStatus === 'PAID') return res.json({ ok: true, duplicate: true });
    if (evt.amount && Math.abs(evt.amount - Number(order.total)) > 0.01) {
      await audit({ businessId: order.businessId, actor: 'SYSTEM', action: 'payment.amount_mismatch', entity: 'Order', entityId: order.id, data: evt });
      return res.json({ ok: true, mismatch: true });
    }
    // Conditional update makes concurrent deliveries safe.
    const updated = await prisma.order.updateMany({ where: { id: order.id, paymentStatus: { not: 'PAID' } }, data: { paymentStatus: 'PAID', paymentRef: evt.paymentRef, status: order.status === 'PENDING' ? 'CONFIRMED' : order.status } });
    if (updated.count) {
      await audit({ businessId: order.businessId, actor: 'SYSTEM', action: 'payment.captured', entity: 'Order', entityId: order.id, data: { provider: provider.name, ref: evt.paymentRef } });
      await notify(order.businessId, { type: 'PAYMENT', title: `Payment received for ${order.number}`, link: `/orders/${order.id}` });
    }
    res.json({ ok: true });
  } catch (e) {
    res.status(e.status || 500).json({ error: e.message });
  }
});

module.exports = router;
