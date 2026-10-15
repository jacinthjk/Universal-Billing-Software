const { PrismaClient, Prisma } = require('@prisma/client');

// Serialize Decimal columns as JSON numbers instead of strings.
Prisma.Decimal.prototype.toJSON = function toJSON() {
  return this.toNumber();
};

// Generous interactive-transaction limits: the database may be in a distant region.
const prisma = global.__prisma || new PrismaClient({ transactionOptions: { maxWait: 15000, timeout: 30000 } });
if (process.env.NODE_ENV !== 'production') global.__prisma = prisma;

module.exports = { prisma, Prisma };
