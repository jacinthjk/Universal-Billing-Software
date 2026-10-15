const jwt = require('jsonwebtoken');
const config = require('../config');
const { prisma } = require('../lib/prisma');
const { unauthorized } = require('../lib/errors');

const signToken = (user) => jwt.sign({ sub: user.id }, config.jwtSecret, { expiresIn: config.jwtExpiresIn });

// Verifies the bearer JWT and loads the platform user.
async function requireAuth(req, res, next) {
  try {
    const header = req.headers.authorization || '';
    const token = header.startsWith('Bearer ') ? header.slice(7) : null;
    if (!token) throw unauthorized();
    let payload;
    try {
      payload = jwt.verify(token, config.jwtSecret);
    } catch {
      throw unauthorized('Session expired, please log in again');
    }
    const user = await prisma.user.findUnique({ where: { id: payload.sub } });
    if (!user || !user.active) throw unauthorized();
    req.user = user;
    next();
  } catch (e) {
    next(e);
  }
}

module.exports = { requireAuth, signToken };
