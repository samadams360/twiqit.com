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
const { selectWinner } = require('./winnerSelector');
const { sendWinnerNotification } = require('./notificationService');

const opsAgent = require('./opsAgent');

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
    const { productId, minTwiqThreshold, maxTwiqThreshold, expiresAt } = req.body ?? {};

    if (minTwiqThreshold == null || maxTwiqThreshold == null || !expiresAt) {
      return errResponse(res, 400, 'MISSING_FIELDS',
        'minTwiqThreshold, maxTwiqThreshold, and expiresAt are required.');
    }
    if (!productId) {
      return errResponse(res, 400, 'MISSING_FIELDS', 'productId is required.');
    }
    if (maxTwiqThreshold < minTwiqThreshold) {
      return errResponse(res, 400, 'INVALID_THRESHOLDS',
        'maxTwiqThreshold must be greater than or equal to minTwiqThreshold.');
    }

    const raffle = await das.createRaffle(
      { id: uuidv4(), productId, minTwiqThreshold, maxTwiqThreshold, expiresAt, createdBy: req.user.id },
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
    const newMin = minTwiqThreshold ?? existing.minTwiqThreshold;
    const newMax = maxTwiqThreshold ?? existing.maxTwiqThreshold;
    if (newMax < newMin) {
      return errResponse(res, 400, 'INVALID_THRESHOLDS',
        'maxTwiqThreshold must be greater than or equal to minTwiqThreshold.');
    }
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

    const { productId, minTwiqThreshold, maxTwiqThreshold, expiresAt } = req.body ?? {};
    if (minTwiqThreshold == null || maxTwiqThreshold == null || !expiresAt || !productId) {
      return errResponse(res, 400, 'MISSING_FIELDS',
        'productId, minTwiqThreshold, maxTwiqThreshold, and expiresAt are required.');
    }
    if (maxTwiqThreshold < minTwiqThreshold) {
      return errResponse(res, 400, 'INVALID_THRESHOLDS',
        'maxTwiqThreshold must be greater than or equal to minTwiqThreshold.');
    }

    // Close the current raffle
    await das.updateRaffle(id, { status: 'closed', closedAt: new Date() }, 'admin');
    log('info', 'close_raffle', { raffleId: id, reason: 'replaced' });

    // Create the new one
    const newRaffle = await das.createRaffle(
      { id: uuidv4(), productId, minTwiqThreshold, maxTwiqThreshold, expiresAt, createdBy: req.user.id },
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

    // 6. Auto-close and select winner if max threshold reached
    if (newTotal >= raffle.maxTwiqThreshold) {
      const entries = await das.getBidEntriesByRaffleId(id, 'raffle_service');
      const winningEntry = selectWinner(entries);
      updatedRaffle = await das.updateRaffle(id, {
        status: 'winner_selected',
        closedAt: new Date(),
        winnerId: winningEntry.userId,
        winningBidId: winningEntry.id,
      }, 'raffle_service');
      const winner = await das.getUserById(winningEntry.userId, 'raffle_service');
      if (winner) sendWinnerNotification(winner, updatedRaffle).catch(() => {});
      log('info', 'raffle_max_threshold_reached', { raffleId: id, totalTwiqsBid: newTotal, winnerId: winningEntry.userId });
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
// GET /buy/api/raffle/my-wins?userId=<id> — all raffles the user has won
// ---------------------------------------------------------------------------
router.get('/raffle/my-wins', async (req, res) => {
  const { userId } = req.query;
  if (!userId) return errResponse(res, 400, 'MISSING_FIELDS', 'userId query param is required.');
  try {
    const raffles = await das.getAllWinsForUser(userId, 'raffle_service');
    res.json(raffles);
  } catch (err) {
    log('error', 'get_my_wins', { message: err.message });
    errResponse(res, 500, 'INTERNAL_ERROR', 'Something went wrong.');
  }
});

// ---------------------------------------------------------------------------
// GET /buy/api/raffle/my-history?userId=<id> — full raffle history for user
// ---------------------------------------------------------------------------
router.get('/raffle/my-history', async (req, res) => {
  const { userId } = req.query;
  if (!userId) return errResponse(res, 400, 'MISSING_FIELDS', 'userId query param is required.');
  try {
    const history = await das.getRaffleHistoryForUser(userId, 'raffle_service');
    res.json(history);
  } catch (err) {
    log('error', 'get_my_history', { message: err.message });
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
// GET /buy/api/raffle/recent — most recent raffle regardless of status
// ---------------------------------------------------------------------------
router.get('/raffle/recent', async (req, res) => {
  try {
    const result = await das.getMostRecentRaffle('raffle_service');
    res.json(result ?? null);
  } catch (err) {
    log('error', 'get_recent_raffle', { message: err.message });
    errResponse(res, 500, 'INTERNAL_ERROR', 'Something went wrong.');
  }
});

// ---------------------------------------------------------------------------
// PATCH /buy/api/admin/raffle/:id/hidden — toggle hidden flag
// Body: { hidden: true | false }
// ---------------------------------------------------------------------------
router.patch('/admin/raffle/:id/hidden', requireAuth, async (req, res) => {
  try {
    const { id } = req.params;
    const { hidden } = req.body ?? {};
    if (typeof hidden !== 'boolean') {
      return errResponse(res, 400, 'MISSING_FIELDS', 'hidden (boolean) is required.');
    }
    const existing = await das.getRaffleById(id, 'admin');
    if (!existing) return errResponse(res, 404, 'NOT_FOUND', 'Raffle not found.');
    const updated = await das.updateRaffle(id, { hidden }, 'admin');
    log('info', 'toggle_hidden', { raffleId: id, hidden });
    res.json(updated);
  } catch (err) {
    log('error', 'toggle_hidden', { message: err.message });
    errResponse(res, 500, 'INTERNAL_ERROR', 'Something went wrong.');
  }
});

// ---------------------------------------------------------------------------
// GET /buy/api/admin/raffles — raffle history (admin)
// ---------------------------------------------------------------------------
router.get('/admin/raffles', requireAuth, async (req, res) => {
  try {
    const limit = Math.min(parseInt(req.query.limit) || 50, 100);
    const offset = parseInt(req.query.offset) || 0;
    const raffles = await das.listRaffles(limit, offset, 'admin');
    res.json(raffles);
  } catch (err) {
    log('error', 'list_raffles', { message: err.message });
    errResponse(res, 500, 'INTERNAL_ERROR', 'Something went wrong.');
  }
});

// ---------------------------------------------------------------------------
// GET /buy/api/admin/drops — list all products (for admin UI product selector)
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

// ---------------------------------------------------------------------------
// POST /buy/api/admin/product — create a new product
// ---------------------------------------------------------------------------
router.post('/admin/product', requireAuth, async (req, res) => {
  try {
    const { name, description, imageUrl, retailValue } = req.body ?? {};
    if (!name || retailValue == null) {
      return errResponse(res, 400, 'MISSING_FIELDS', 'name and retailValue are required.');
    }
    const product = await das.createDrop({ name, description, imageUrl, retailValue }, 'admin');
    log('info', 'create_product', { productId: product.id });
    res.status(201).json(product);
  } catch (err) {
    log('error', 'create_product', { message: err.message });
    errResponse(res, 500, 'INTERNAL_ERROR', 'Something went wrong.');
  }
});

// ---------------------------------------------------------------------------
// PUT /buy/api/admin/product/:id — update a product
// ---------------------------------------------------------------------------
router.put('/admin/product/:id', requireAuth, async (req, res) => {
  try {
    const { id } = req.params;
    const existing = await das.getDropById(id, 'admin');
    if (!existing) return errResponse(res, 404, 'NOT_FOUND', 'Product not found.');
    const { name, description, imageUrl, retailValue } = req.body ?? {};
    const updated = await das.updateDrop(id, {
      ...(name != null && { name }),
      ...(description != null && { description }),
      ...(imageUrl != null && { imageUrl }),
      ...(retailValue != null && { retailValue }),
    }, 'admin');
    log('info', 'update_product', { productId: id });
    res.json(updated);
  } catch (err) {
    log('error', 'update_product', { message: err.message });
    errResponse(res, 500, 'INTERNAL_ERROR', 'Something went wrong.');
  }
});

// ---------------------------------------------------------------------------
// DELETE /buy/api/admin/product/:id — delete a product (only if no raffles reference it)
// ---------------------------------------------------------------------------
router.delete('/admin/product/:id', requireAuth, async (req, res) => {
  try {
    const { id } = req.params;
    const existing = await das.getDropById(id, 'admin');
    if (!existing) return errResponse(res, 404, 'NOT_FOUND', 'Product not found.');
    await das.deleteDrop(id, 'admin');
    log('info', 'delete_product', { productId: id });
    res.status(204).end();
  } catch (err) {
    log('error', 'delete_product', { message: err.message });
    if (err.code === '23503') {
      return errResponse(res, 409, 'PRODUCT_IN_USE',
        'Cannot delete a product that has been used in a raffle.');
    }
    errResponse(res, 500, 'INTERNAL_ERROR', 'Something went wrong.');
  }
});

// ---------------------------------------------------------------------------
// GET /buy/api/admin/product-suggestions — fetch products from Fake Store API
// ---------------------------------------------------------------------------
router.get('/admin/product-suggestions', requireAuth, async (req, res) => {
  try {
    const https = require('https');
    const raw = await new Promise((resolve, reject) => {
      https.get('https://fakestoreapi.com/products', (resp) => {
        let data = '';
        resp.on('data', chunk => data += chunk);
        resp.on('end', () => resolve(data));
        resp.on('error', reject);
      }).on('error', reject);
    });

    const products = JSON.parse(raw);
    if (!products?.length) {
      return errResponse(res, 502, 'NO_RESULTS', 'Fake Store API returned no products.');
    }

    // Shuffle and return up to 10
    const suggestions = products
      .sort(() => Math.random() - 0.5)
      .slice(0, 10)
      .map(p => ({
        name: p.title,
        description: p.description,
        imageUrl: p.image,
        retailValue: Math.round(p.price * 100), // dollars → cents
      }));

    log('info', 'product_suggestions', { count: suggestions.length });
    res.json(suggestions);
  } catch (err) {
    log('error', 'product_suggestions', { message: err.message });
    errResponse(res, 500, 'INTERNAL_ERROR', 'Something went wrong fetching suggestions.');
  }
});

// ---------------------------------------------------------------------------
// PUT /buy/api/user/payment-handle — save Venmo handle to user profile
// Body: { userId, venmoHandle }
// ---------------------------------------------------------------------------
router.put('/user/payment-handle', async (req, res) => {
  const { userId, venmoHandle } = req.body ?? {};
  if (!userId) return errResponse(res, 400, 'MISSING_FIELDS', 'userId is required.');
  if (typeof venmoHandle !== 'string') return errResponse(res, 400, 'MISSING_FIELDS', 'venmoHandle is required.');
  const handle = venmoHandle.trim().replace(/^@/, ''); // strip leading @ if present
  if (handle.length > 64) return errResponse(res, 400, 'INVALID_HANDLE', 'Venmo handle must be 64 characters or fewer.');
  try {
    const updated = await das.updateUser(userId, { venmoHandle: handle || null }, 'preference_service');
    if (!updated) return errResponse(res, 404, 'NOT_FOUND', 'User not found.');
    log('info', 'update_payment_handle', { userId });
    res.json({ id: updated.id, displayName: updated.displayName, venmoHandle: updated.venmoHandle });
  } catch (err) {
    log('error', 'update_payment_handle', { message: err.message });
    errResponse(res, 500, 'INTERNAL_ERROR', 'Something went wrong.');
  }
});

// ---------------------------------------------------------------------------
// GET /buy/api/user/profile?userId=<id> — return non-sensitive profile fields
// ---------------------------------------------------------------------------
router.get('/user/profile', async (req, res) => {
  const { userId } = req.query;
  if (!userId) return errResponse(res, 400, 'MISSING_FIELDS', 'userId query param is required.');
  try {
    const user = await das.getUserById(userId, 'preference_service');
    if (!user) return errResponse(res, 404, 'NOT_FOUND', 'User not found.');
    res.json({ id: user.id, displayName: user.displayName, venmoHandle: user.venmoHandle, isGuest: user.isGuest });
  } catch (err) {
    log('error', 'get_profile', { message: err.message });
    errResponse(res, 500, 'INTERNAL_ERROR', 'Something went wrong.');
  }
});

// ---------------------------------------------------------------------------
// POST /buy/api/twiqs/cashout — stubbed cashout via Venmo handle
// Body: { userId }
// ---------------------------------------------------------------------------
router.post('/twiqs/cashout', async (req, res) => {
  const { userId } = req.body ?? {};
  if (!userId) return errResponse(res, 400, 'MISSING_FIELDS', 'userId is required.');
  try {
    const user = await das.getUserById(userId, 'twiq_service');
    if (!user) return errResponse(res, 404, 'NOT_FOUND', 'User not found.');
    if (!user.venmoHandle) {
      return errResponse(res, 422, 'NO_PAYMENT_HANDLE',
        'Please set your Venmo handle in your profile before cashing out.');
    }
    const balance = await das.getTwiqBalance(userId, 'twiq_service');
    if (balance <= 0) {
      return errResponse(res, 422, 'INSUFFICIENT_BALANCE', 'No Twiqs to cash out.');
    }
    // Stub — log intent only, no real payment
    log('info', 'cashout_requested', { userId, venmoHandle: user.venmoHandle, balance });
    res.json({
      message: `Cashout requested — you will be contacted via Venmo @${user.venmoHandle}.`,
      balance,
    });
  } catch (err) {
    log('error', 'cashout', { message: err.message });
    errResponse(res, 500, 'INTERNAL_ERROR', 'Something went wrong.');
  }
});

// ---------------------------------------------------------------------------
// GET /buy/api/admin/ops-status — OpsAgent health + last-hour report
// ---------------------------------------------------------------------------
router.get('/admin/ops-status', requireAuth, async (req, res) => {
  try {
    const status = opsAgent.getStatus();
    const to   = new Date();
    const from = new Date(to.getTime() - 60 * 60 * 1000); // last hour
    const report = await opsAgent.generateReport(from, to);
    res.json({ status, report });
  } catch (err) {
    log('error', 'ops_status', { message: err.message });
    errResponse(res, 500, 'INTERNAL_ERROR', 'Something went wrong.');
  }
});

module.exports = router;
