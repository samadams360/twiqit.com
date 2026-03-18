/**
 * Telemetry endpoint — receives structured client-side events from the React frontend
 * and forwards them into the same log stream consumed by AI_Ops_Agent.
 *
 * POST /buy/api/telemetry/event
 */
const express = require('express');
const opsAgent = require('./opsAgent');

const router = express.Router();

function log(severity, op, extra = {}) {
  console.log(JSON.stringify({
    ts: new Date().toISOString(),
    service: 'telemetry',
    severity,
    op,
    ...extra,
  }));
}

// ---------------------------------------------------------------------------
// POST /buy/api/telemetry/event
// Body: { type, userId?, sessionId?, data? }
// ---------------------------------------------------------------------------
router.post('/telemetry/event', (req, res) => {
  const { type, userId, sessionId, data } = req.body ?? {};
  if (!type || typeof type !== 'string') {
    return res.status(400).json({ error: { code: 'MISSING_FIELDS', message: 'type is required.' } });
  }

  const event = {
    ts: new Date().toISOString(),
    service: 'frontend',
    severity: type === 'js_error' ? 'error' : 'info',
    op: type,
    userId: userId ?? null,
    sessionId: sessionId ?? null,
    ...(data && typeof data === 'object' ? data : {}),
  };

  // Emit to stdout (same stream as backend logs)
  console.log(JSON.stringify(event));

  // Feed into ops agent in-process log buffer
  opsAgent.ingest(event);

  res.status(202).json({ ok: true });
});

module.exports = router;
