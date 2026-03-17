/**
 * Twiq_Service — Express router mounted at /buy/api
 *
 * Slice 6:
 *   POST /buy/api/twiqs/watch-ad  — credit 100 Twiqs (24h cooldown)
 *   GET  /buy/api/twiqs/balance   — return current balance
 *   POST /buy/api/twiqs/cashout   — deduct balance, initiate bank transfer
 */
const express = require('express');
const das = require('./das');
const { optionalAuth } = require('./authMiddleware');

const router = express.Router();
const AD_WATCH_AMOUNT = 100;
const AD_COOLDOWN_MS = 24 * 60 * 60 * 1000;

function log(severity, op, extra = {}) {
  console.log(JSON.stringify({ ts: new Date().toISOString(), service: 'twiq_service', severity, op, ...extra }));
}
function errResponse(res, status, code, message) {
  return res.status(status).json({ error: { code, message } });
}

// Resolve user from stored guest id in request body or optionalAuth
function resolveUser(req) {
  return req.user ?? null;
}

// ---------------------------------------------------------------------------
// POST /buy/api/twiqs/watch-ad
// Body: { userId }  (guest users pass their id from localStorage)
// ---------------------------------------------------------------------------
router.post('/twiqs/watch-ad', async (req, res) => {
  const userId = req.body?.userId;
  if (!userId) return errResponse(res, 400, 'MISSING_FIELDS', 'userId is required.');

  try {
    const lastWatch = await das.getLastAdWatchTime(userId, 'twiq_service');
    if (lastWatch) {
      const elapsed = Date.now() - new Date(lastWatch).getTime();
      if (elapsed < AD_COOLDOWN_MS) {
        const eligibleAt = new Date(new Date(lastWatch).getTime() + AD_COOLDOWN_MS).toISOString();
        log('info', 'watch_ad_cooldown', { userId, eligibleAt });
        return res.status(429).json({ error: { code: 'COOLDOWN', message: 'Ad already watched recently.', eligibleAt } });
      }
    }

    const tx = await das.createTwiqTransaction({ userId, type: 'ad_watch', amount: AD_WATCH_AMOUNT }, 'twiq_service');
    const balance = await das.getTwiqBalance(userId, 'twiq_service');
    log('info', 'watch_ad_credited', { userId, amount: AD_WATCH_AMOUNT, balance });
    res.json({ credited: AD_WATCH_AMOUNT, balance, transactionId: tx.id });
  } catch (err) {
    log('error', 'watch_ad', { message: err.message });
    errResponse(res, 500, 'INTERNAL_ERROR', 'Something went wrong.');
  }
});

// ---------------------------------------------------------------------------
// GET /buy/api/twiqs/balance?userId=<id>
// ---------------------------------------------------------------------------
router.get('/twiqs/balance', async (req, res) => {
  const userId = req.query.userId;
  if (!userId) return errResponse(res, 400, 'MISSING_FIELDS', 'userId query param is required.');

  try {
    const balance = await das.getTwiqBalance(userId, 'twiq_service');
    log('info', 'get_balance', { userId, balance });
    res.json({ balance });
  } catch (err) {
    log('error', 'get_balance', { message: err.message });
    errResponse(res, 500, 'INTERNAL_ERROR', 'Something went wrong.');
  }
});

// ---------------------------------------------------------------------------
// POST /buy/api/twiqs/cashout
// Body: { userId, amount }
// Stub: logs intent, deducts balance. Bank transfer wired in Slice 11.
// ---------------------------------------------------------------------------
router.post('/twiqs/cashout', async (req, res) => {
  const { userId, amount } = req.body ?? {};
  if (!userId || !amount) return errResponse(res, 400, 'MISSING_FIELDS', 'userId and amount are required.');
  if (amount <= 0) return errResponse(res, 400, 'INVALID_AMOUNT', 'Amount must be positive.');

  try {
    const balance = await das.getTwiqBalance(userId, 'twiq_service');
    if (balance < amount) {
      return res.status(422).json({ error: { code: 'INSUFFICIENT_BALANCE', message: 'Not enough Twiqs.', balance } });
    }
    const tx = await das.createTwiqTransaction({ userId, type: 'cashout', amount: -amount }, 'twiq_service');
    const newBalance = await das.getTwiqBalance(userId, 'twiq_service');
    log('info', 'cashout', { userId, amount, newBalance });
    // Bank transfer stub — wired in Slice 11
    res.json({ deducted: amount, balance: newBalance, transactionId: tx.id });
  } catch (err) {
    log('error', 'cashout', { message: err.message });
    errResponse(res, 500, 'INTERNAL_ERROR', 'Something went wrong.');
  }
});

module.exports = router;
