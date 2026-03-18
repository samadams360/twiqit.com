/**
 * Raffle_Service — Express router mounted at /buy/api
 *
 * Slice 2: GET  /buy/api/raffle/active
 * Slice 3: POST /buy/api/admin/raffle
 *          PUT  /buy/api/admin/raffle/:id
 *          POST /buy/api/admin/raffle/:id/replace
 */
const express = require('express');
const { v4: uuidv4 } = require('uuid');
const das = require('./das');
const { requireAuth } = require('./authMiddleware');

const router = express.Router();

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
function log(severity, op, extra = {}) {
  console.log(JSON.stringify({
    ts: new Date().toISOString(),
    service: 'raffle_service',
    severity,
    op,
    ...extra,
  }));
}

function errResponse(res, status, code, message) {
  return res.status(status).json({ error: { code, message } });
}

// ---------------------------------------------------------------------------
// POST /buy/api/auth/guest — sign in with a display name (no password)
// ---------------------------------------------------------------------------
router.post('/auth/guest', async (req, res) => {
  const { displayName } = req.body ?? {};
  if (!displayName || typeof displayName !== 'string' || !displayName.trim()) {
    return errResponse(res, 400, 'MISSING_FIELDS', 'displayName is required.');
  }
  const name = displayName.trim().slice(0, 32); // cap at 32 chars
  try {
    const user = await das.getOrCreateGuestUser(name, 'auth_guest');
    log('info', 'auth_guest', { userId: user.id, displayName: user.displayName });
    res.json({ id: user.id, displayName: user.displayName });
  } catch (err) {
    log('error', 'auth_guest', { message: err.message });
    errResponse(res, 500, 'INTERNAL_ERROR', 'Something went wrong.');
  }
});

// ---------------------------------------------------------------------------
// GET /buy/api/auth/me — return current user if authenticated
// ---------------------------------------------------------------------------
router.get('/auth/me', async (req, res) => {
  const header = req.headers['authorization'] ?? '';
  const token = header.startsWith('Bearer ') ? header.slice(7) : null;
  if (!token) return res.status(401).json({ error: { code: 'UNAUTHORIZED', message: 'Authentication required.' } });
  const crypto = require('crypto');
  const tokenHash = crypto.createHash('sha256').update(token).digest('hex');
  try {
    const user = await das.getUserByToken(tokenHash, 'auth_me');
    if (!user) return res.status(401).json({ error: { code: 'UNAUTHORIZED', message: 'Invalid token.' } });
    res.json({ id: user.id, displayName: user.displayName });
  } catch (err) {
    log('error', 'auth_me', { message: err.message });
    errResponse(res, 500, 'INTERNAL_ERROR', 'Something went wrong.');
  }
});

// ---------------------------------------------------------------------------
// GET /buy/api/raffle/active
// ---------------------------------------------------------------------------
router.get('/raffle/active', async (req, res) => {
  try {
    const result = await das.getActiveRaffle('raffle_service');
    log('info', 'get_active_raffle', { found: !!result });
    res.json(result ?? null);
  } catch (err) {
    log('error', 'get_active_raffle', { message: err.message });
    errResponse(res, 500, 'INTERNAL_ERROR', 'Something went wrong.');
  }
});

// ---------------------------------------------------------------------------
// POST /buy/api/admin/raffle — create a new active raffle
// ---------------------------------------------------------------------------
router.post('/admin/raffle', requireAuth, async (req, res) => {
  try {
    const { dropId, minTwiqThreshold, maxTwiqThreshold, expiresAt } = req.body ?? {};

    if (minTwiqThreshold == null || maxTwiqThreshold == null || !expiresAt) {
      return errResponse(res, 400, 'MISSING_FIELDS',
        'minTwiqThreshold, maxTwiqThreshold, and expiresAt are required.');
    }
    if (!dropId) {
      return errResponse(res, 400, 'MISSING_FIELDS', 'dropId is required.');
    }

    const raffle = await das.createRaffle(
      { id: uuidv4(), dropId, minTwiqThreshold, maxTwiqThreshold, expiresAt },
      'admin'
    );
    log('info', 'create_raffle', { raffleId: raffle.id });
    res.status(201).json(raffle);
  } catch (err) {
    log('error', 'create_raffle', { message: err.message });
    // Unique index violation = already an active raffle
    if (err.code === '23505') {
      return errResponse(res, 409, 'ACTIVE_RAFFLE_EXISTS',
        'An active raffle already exists. Use /replace to swap it out.');
    }
    errResponse(res, 500, 'INTERNAL_ERROR', 'Something went wrong.');
  }
});

// ---------------------------------------------------------------------------
// PUT /buy/api/admin/raffle/:id — update active raffle (preserves bid entries)
// ---------------------------------------------------------------------------
router.put('/admin/raffle/:id', requireAuth, async (req, res) => {
  try {
    const { id } = req.params;
    const existing = await das.getRaffleById(id, 'admin');
    if (!existing) return errResponse(res, 404, 'NOT_FOUND', 'Raffle not found.');
    if (existing.status !== 'active') {
      return errResponse(res, 409, 'NOT_ACTIVE', 'Only active raffles can be updated.');
    }

    const { minTwiqThreshold, maxTwiqThreshold, expiresAt } = req.body ?? {};
    const updated = await das.updateRaffle(id, {
      ...(minTwiqThreshold != null && { minTwiqThreshold }),
      ...(maxTwiqThreshold != null && { maxTwiqThreshold }),
      ...(expiresAt != null && { expiresAt }),
    }, 'admin');

    log('info', 'update_raffle', { raffleId: id });
    res.json(updated);
  } catch (err) {
    log('error', 'update_raffle', { message: err.message });
    errResponse(res, 500, 'INTERNAL_ERROR', 'Something went wrong.');
  }
});

// ---------------------------------------------------------------------------
// POST /buy/api/admin/raffle/:id/replace — close current, create new active raffle
// ---------------------------------------------------------------------------
router.post('/admin/raffle/:id/replace', requireAuth, async (req, res) => {
  try {
    const { id } = req.params;
    const existing = await das.getRaffleById(id, 'admin');
    if (!existing) return errResponse(res, 404, 'NOT_FOUND', 'Raffle not found.');
    if (existing.status !== 'active') {
      return errResponse(res, 409, 'NOT_ACTIVE', 'Only active raffles can be replaced.');
    }

    const { dropId, minTwiqThreshold, maxTwiqThreshold, expiresAt } = req.body ?? {};
    if (minTwiqThreshold == null || maxTwiqThreshold == null || !expiresAt || !dropId) {
      return errResponse(res, 400, 'MISSING_FIELDS',
        'dropId, minTwiqThreshold, maxTwiqThreshold, and expiresAt are required.');
    }

    // Close the current raffle
    await das.updateRaffle(id, { status: 'closed', closedAt: new Date() }, 'admin');
    log('info', 'close_raffle', { raffleId: id, reason: 'replaced' });

    // Create the new one
    const newRaffle = await das.createRaffle(
      { id: uuidv4(), dropId, minTwiqThreshold, maxTwiqThreshold, expiresAt },
      'admin'
    );
    log('info', 'create_raffle', { raffleId: newRaffle.id, replacedId: id });
    res.status(201).json(newRaffle);
  } catch (err) {
    log('error', 'replace_raffle', { message: err.message });
    errResponse(res, 500, 'INTERNAL_ERROR', 'Something went wrong.');
  }
});

// ---------------------------------------------------------------------------
// POST /buy/api/raffle/:id/bid — place a bid (deduct Twiqs, record entry)
// Body: { userId, amount }
// ---------------------------------------------------------------------------
router.post('/raffle/:id/bid', async (req, res) => {
  const { id } = req.params;
  const { userId, amount } = req.body ?? {};

  if (!userId || !amount) {
    return errResponse(res, 400, 'MISSING_FIELDS', 'userId and amount are required.');
  }
  if (!Number.isInteger(amount) || amount <= 0) {
    return errResponse(res, 400, 'INVALID_AMOUNT', 'amount must be a positive integer.');
  }

  try {
    // 1. Verify raffle is active
    const raffle = await das.getRaffleById(id, 'raffle_service');
    if (!raffle) return errResponse(res, 404, 'NOT_FOUND', 'Raffle not found.');
    if (raffle.status !== 'active') {
      return errResponse(res, 409, 'RAFFLE_NOT_ACTIVE', 'This raffle is no longer accepting bids.');
    }

    // 2. Check balance
    const balance = await das.getTwiqBalance(userId, 'raffle_service');
    if (balance < amount) {
      return res.status(422).json({ error: { code: 'INSUFFICIENT_BALANCE', message: 'Not enough Twiqs.', balance } });
    }

    // 3. Deduct Twiqs
    await das.createTwiqTransaction({ userId, type: 'bid', amount: -amount }, 'raffle_service');

    // 4. Record bid entry
    const entry = await das.createBidEntry({ raffleId: id, userId, amount }, 'raffle_service');

    // 5. Update raffle total
    const newTotal = raffle.totalTwiqsBid + amount;
    let updatedRaffle = await das.updateRaffle(id, { totalTwiqsBid: newTotal }, 'raffle_service');

    // 6. Auto-close if max threshold reached
    if (newTotal >= raffle.maxTwiqThreshold) {
      updatedRaffle = await das.updateRaffle(id, { status: 'closed', closedAt: new Date() }, 'raffle_service');
      log('info', 'raffle_max_threshold_reached', { raffleId: id, totalTwiqsBid: newTotal });
    }

    const newBalance = await das.getTwiqBalance(userId, 'raffle_service');
    log('info', 'bid_placed', { raffleId: id, userId, amount, newTotal, newBalance });
    res.status(201).json({ bidEntryId: entry.id, balance: newBalance, raffle: updatedRaffle });
  } catch (err) {
    log('error', 'place_bid', { message: err.message });
    errResponse(res, 500, 'INTERNAL_ERROR', 'Something went wrong.');
  }
});

// ---------------------------------------------------------------------------
// POST /buy/api/raffle/:id/confirm-receipt
// Body: { userId }  — winner confirms they received the item
// ---------------------------------------------------------------------------
router.post('/raffle/:id/confirm-receipt', async (req, res) => {
  const { id } = req.params;
  const { userId } = req.body ?? {};
  if (!userId) return errResponse(res, 400, 'MISSING_FIELDS', 'userId is required.');

  try {
    const raffle = await das.getRaffleById(id, 'raffle_service');
    if (!raffle) return errResponse(res, 404, 'NOT_FOUND', 'Raffle not found.');
    if (raffle.status !== 'winner_selected') {
      return errResponse(res, 409, 'INVALID_STATUS',
        'Receipt can only be confirmed for raffles in winner_selected state.');
    }
    if (raffle.winnerId !== userId) {
      return errResponse(res, 403, 'NOT_WINNER', 'Only the winner can confirm receipt.');
    }
    const updated = await das.updateRaffle(id, { status: 'receipt_confirmed' }, 'raffle_service');
    log('info', 'receipt_confirmed', { raffleId: id, userId });
    res.json(updated);
  } catch (err) {
    log('error', 'confirm_receipt', { message: err.message });
    errResponse(res, 500, 'INTERNAL_ERROR', 'Something went wrong.');
  }
});

// ---------------------------------------------------------------------------
// GET /buy/api/raffle/my-win?userId=<id> — get user's most recent won raffle
// ---------------------------------------------------------------------------
router.get('/raffle/my-win', async (req, res) => {
  const { userId } = req.query;
  if (!userId) return errResponse(res, 400, 'MISSING_FIELDS', 'userId query param is required.');
  try {
    const raffle = await das.getWinnerRaffleForUser(userId, 'raffle_service');
    res.json(raffle ?? null);
  } catch (err) {
    log('error', 'get_my_win', { message: err.message });
    errResponse(res, 500, 'INTERNAL_ERROR', 'Something went wrong.');
  }
});

// ---------------------------------------------------------------------------
// GET /buy/api/raffle/:id/my-bids?userId=<id> — user's total bids on a raffle
// ---------------------------------------------------------------------------
router.get('/raffle/:id/my-bids', async (req, res) => {
  const { id } = req.params;
  const { userId } = req.query;
  if (!userId) return errResponse(res, 400, 'MISSING_FIELDS', 'userId query param is required.');
  try {
    const total = await das.getUserBidTotalForRaffle(id, userId, 'raffle_service');
    res.json({ raffleId: id, userId, totalBid: total });
  } catch (err) {
    log('error', 'get_my_bids', { message: err.message });
    errResponse(res, 500, 'INTERNAL_ERROR', 'Something went wrong.');
  }
});

// ---------------------------------------------------------------------------
// GET /buy/api/admin/drops — list all drops (for admin UI drop selector)
// ---------------------------------------------------------------------------
router.get('/admin/drops', requireAuth, async (req, res) => {
  try {
    const drops = await das.listDrops('admin');
    res.json(drops);
  } catch (err) {
    log('error', 'list_drops', { message: err.message });
    errResponse(res, 500, 'INTERNAL_ERROR', 'Something went wrong.');
  }
});

module.exports = router;
