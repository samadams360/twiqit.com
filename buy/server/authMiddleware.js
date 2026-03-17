/**
 * Auth middleware — bearer token (Option B scaffolding)
 * Resolves req.user from Authorization: Bearer <token> header.
 * Swap this file out when upgrading to OAuth/magic-link.
 */
const crypto = require('crypto');
const das = require('./das');

function hashToken(token) {
  return crypto.createHash('sha256').update(token).digest('hex');
}

/**
 * requireAuth — attaches req.user or returns 401.
 */
async function requireAuth(req, res, next) {
  const header = req.headers['authorization'] ?? '';
  const token = header.startsWith('Bearer ') ? header.slice(7) : null;
  if (!token) {
    return res.status(401).json({ error: { code: 'UNAUTHORIZED', message: 'Authentication required.' } });
  }
  try {
    const user = await das.getUserByToken(hashToken(token), 'auth_middleware');
    if (!user) {
      return res.status(401).json({ error: { code: 'UNAUTHORIZED', message: 'Invalid token.' } });
    }
    req.user = user;
    next();
  } catch (err) {
    console.error(JSON.stringify({ ts: new Date().toISOString(), service: 'auth_middleware', severity: 'error', message: err.message }));
    res.status(500).json({ error: { code: 'INTERNAL_ERROR', message: 'Something went wrong.' } });
  }
}

/**
 * optionalAuth — attaches req.user if token present and valid, otherwise continues.
 */
async function optionalAuth(req, res, next) {
  const header = req.headers['authorization'] ?? '';
  const token = header.startsWith('Bearer ') ? header.slice(7) : null;
  if (!token) return next();
  try {
    const user = await das.getUserByToken(hashToken(token), 'auth_middleware');
    if (user) req.user = user;
  } catch (_) { /* ignore */ }
  next();
}

module.exports = { requireAuth, optionalAuth };
