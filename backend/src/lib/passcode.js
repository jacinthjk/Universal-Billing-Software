// Optional business passcode that protects editing and cancelling saved bills.
// The bcrypt hash never leaves the server; clients only see `hasBillPasscode`.
const bcrypt = require('bcryptjs');
const { prisma } = require('./prisma');
const { HttpError, badRequest } = require('./errors');
const { audit } = require('./audit');

const PASSCODE_RE = /^\d{4,8}$/;

async function setBillPasscode(businessId, passcode) {
  if (passcode !== null && !PASSCODE_RE.test(String(passcode))) throw badRequest('Passcode must be 4 to 8 digits');
  const billPasscodeHash = passcode === null ? null : await bcrypt.hash(String(passcode), 10);
  await prisma.business.update({ where: { id: businessId }, data: { billPasscodeHash } });
}

/** Throws 403 unless the passcode matches (no-op when the business has not set one). */
async function verifyBillPasscode(businessId, passcode, { userId, action, saleId } = {}) {
  const b = await prisma.business.findUnique({ where: { id: businessId }, select: { billPasscodeHash: true } });
  if (!b?.billPasscodeHash) return;
  if (!passcode) throw new HttpError(403, 'Enter the bill passcode', { code: 'PASSCODE_REQUIRED' });
  if (!(await bcrypt.compare(String(passcode), b.billPasscodeHash))) {
    await audit({ businessId, userId, action: 'passcode.failed', entity: 'Sale', entityId: saleId, data: { action } });
    throw new HttpError(403, 'Incorrect passcode', { code: 'PASSCODE_INVALID' });
  }
}

module.exports = { setBillPasscode, verifyBillPasscode };
