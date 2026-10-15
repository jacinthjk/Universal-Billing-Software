const PREFIXES = { SALE: 'INV-', PURCHASE: 'PUR-', ORDER: 'ORD-', QUOTATION: 'QT-', RETURN: 'RET-', CUSTOMER: 'C' };

// Atomically allocates the next number in a per-business sequence (must run inside a transaction).
async function nextNumber(tx, businessId, key, prefixOverride, digits) {
  // An explicitly empty prefix is honoured (e.g. invoice numbers printed as just "319").
  const prefix = prefixOverride ?? PREFIXES[key] ?? `${key}-`;
  const seq = await tx.invoiceSequence.upsert({
    where: { businessId_key: { businessId, key } },
    create: { businessId, key, prefix, next: 2 },
    update: { next: { increment: 1 } },
  });
  const value = seq.next - 1;
  const pad = digits ?? (key === 'CUSTOMER' ? 5 : 6);
  return `${prefixOverride ?? seq.prefix}${String(value).padStart(pad, '0')}`;
}

module.exports = { nextNumber };
