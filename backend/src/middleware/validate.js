const { badRequest } = require('../lib/errors');

// Parse req.body (or another source) with a zod schema; replaces it with the parsed value.
const validate = (schema, source = 'body') => (req, res, next) => {
  const result = schema.safeParse(req[source]);
  if (!result.success) {
    const issues = result.error.issues.map((i) => ({ path: i.path.join('.'), message: i.message }));
    return next(badRequest(issues[0] ? `${issues[0].path || 'input'}: ${issues[0].message}` : 'Invalid input', issues));
  }
  req[source === 'query' ? 'q' : source] = result.data;
  next();
};

module.exports = { validate };
