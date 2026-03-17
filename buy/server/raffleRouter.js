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
router.post('/admin/raffle', async (req, res) => {
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
router.put('/admin/raffle/:id', async (req, res) => {
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
router.post('/admin/raffle/:id/replace', async (req, res) => {
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

module.exports = router;
