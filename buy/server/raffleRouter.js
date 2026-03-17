/**
 * Raffle_Service — Express router mounted at /buy/api
 * Slice 2 scope: GET /buy/api/raffle/active
 */
const express = require('express');
const das = require('./das');

const router = express.Router();

// GET /buy/api/raffle/active
// Returns the active raffle + drop details, or HTTP 200 with null body when none exists.
router.get('/raffle/active', async (req, res) => {
  try {
    const result = await das.getActiveRaffle('raffle_service');
    console.log(JSON.stringify({
      ts: new Date().toISOString(),
      service: 'raffle_service',
      severity: 'info',
      op: 'get_active_raffle',
      found: !!result,
    }));
    res.json(result ?? null);
  } catch (err) {
    console.error(JSON.stringify({
      ts: new Date().toISOString(),
      service: 'raffle_service',
      severity: 'error',
      op: 'get_active_raffle',
      message: err.message,
    }));
    res.status(500).json({ error: { code: 'INTERNAL_ERROR', message: 'Something went wrong.' } });
  }
});

module.exports = router;
