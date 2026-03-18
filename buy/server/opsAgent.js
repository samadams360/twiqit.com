/**
 * AI_Ops_Agent
 * Runs as a background process alongside the Express server.
 * - Ingests structured log events (backend + frontend telemetry)
 * - Applies anomaly detection rules with sliding windows
 * - Generates scheduled operational reports
 * - Watchdog: alerts if agent goes silent
 */
const notif = require('./notificationService');

// ---------------------------------------------------------------------------
// Config
// ---------------------------------------------------------------------------
const WINDOW_5MIN  = 5  * 60 * 1000;
const WINDOW_10MIN = 10 * 60 * 1000;
const WINDOW_30MIN = 30 * 60 * 1000;

const REPORT_INTERVAL_MS = parseInt(process.env.OPS_REPORT_INTERVAL_MS) || 24 * 60 * 60 * 1000;
const WATCHDOG_INTERVAL_MS = 2 * 60 * 1000;   // heartbeat every 2 min
const WATCHDOG_TIMEOUT_MS  = 6 * 60 * 1000;   // alert if silent > 6 min
const LOG_RETENTION_MS = 30 * 24 * 60 * 60 * 1000; // 30 days

// ---------------------------------------------------------------------------
// In-memory log index (ring buffer, 30-day retention)
// ---------------------------------------------------------------------------
let logIndex = [];   // { ts, service, severity, op, ...rest }
let anomalies = [];  // AnomalyEvent[]
let lastHeartbeat = Date.now();
let running = false;
let reportTimer = null;
let watchdogTimer = null;
let pruneTimer = null;

function log(severity, op, extra = {}) {
  console.log(JSON.stringify({
    ts: new Date().toISOString(),
    service: 'ops_agent',
    severity,
    op,
    ...extra,
  }));
}

// ---------------------------------------------------------------------------
// Ingest — called by telemetryRouter and can be called directly for backend logs
// ---------------------------------------------------------------------------
function ingest(event) {
  if (!running) return;
  const entry = { ...event, _ingestedAt: Date.now() };
  logIndex.push(entry);
  lastHeartbeat = Date.now();
  _checkAnomalies(entry);
}

// ---------------------------------------------------------------------------
// Anomaly detection helpers
// ---------------------------------------------------------------------------
function _eventsInWindow(windowMs, filter) {
  const cutoff = Date.now() - windowMs;
  return logIndex.filter(e => e._ingestedAt >= cutoff && (!filter || filter(e)));
}

function _recordAnomaly(signal, severity, detail) {
  const event = { ts: new Date().toISOString(), signal, severity, detail };
  anomalies.push(event);
  log('warning', 'anomaly_detected', event);
  // Fire-and-forget alert
  notif.sendWinnerNotification(
    { id: 'admin', displayName: process.env.ADMIN_EMAIL || 'admin' },
    { id: 'ops', dropId: signal }
  ).catch(() => {});
}

// Debounce: don't re-alert the same signal within the same window
const _lastAlert = {};
function _shouldAlert(signal, windowMs) {
  const now = Date.now();
  if (!_lastAlert[signal] || now - _lastAlert[signal] > windowMs) {
    _lastAlert[signal] = now;
    return true;
  }
  return false;
}

function _checkAnomalies(event) {
  const now = Date.now();

  // 1. HTTP 5xx rate > 1% in 5-min window
  const reqs5 = _eventsInWindow(WINDOW_5MIN, e => e.op && e.statusCode);
  const errs5 = reqs5.filter(e => e.statusCode >= 500);
  if (reqs5.length > 20 && errs5.length / reqs5.length > 0.01) {
    if (_shouldAlert('http_5xx_rate', WINDOW_5MIN))
      _recordAnomaly('http_5xx_rate', 'error', `${errs5.length}/${reqs5.length} requests in 5 min`);
  }

  // 2. Failed auth > 20 from same IP in 10-min window
  if (event.op === 'auth_failed' && event.ip) {
    const authFails = _eventsInWindow(WINDOW_10MIN, e => e.op === 'auth_failed' && e.ip === event.ip);
    if (authFails.length > 20 && _shouldAlert(`auth_fail_${event.ip}`, WINDOW_10MIN))
      _recordAnomaly('failed_auth_spike', 'critical', `${authFails.length} failures from ${event.ip} in 10 min`);
  }

  // 3. Bid errors > 5% in 5-min window
  const bids5 = _eventsInWindow(WINDOW_5MIN, e => e.op === 'bid_placed' || e.op === 'place_bid');
  const bidErrs5 = bids5.filter(e => e.severity === 'error');
  if (bids5.length > 10 && bidErrs5.length / bids5.length > 0.05) {
    if (_shouldAlert('bid_error_rate', WINDOW_5MIN))
      _recordAnomaly('bid_error_rate', 'warning', `${bidErrs5.length}/${bids5.length} bid errors in 5 min`);
  }

  // 4. DAS / DB connection failure — any occurrence is critical
  if (event.service === 'DAS' && event.severity === 'error' && event.op?.includes('connect')) {
    if (_shouldAlert('das_connection', WINDOW_5MIN))
      _recordAnomaly('das_connection_failure', 'critical', event.message || 'DB connection error');
  }

  // 5. Frontend JS errors > 10 unique in 5-min window
  if (event.op === 'js_error') {
    const jsErrs = _eventsInWindow(WINDOW_5MIN, e => e.op === 'js_error');
    const unique = new Set(jsErrs.map(e => e.message)).size;
    if (unique > 10 && _shouldAlert('js_error_spike', WINDOW_5MIN))
      _recordAnomaly('frontend_js_errors', 'warning', `${unique} unique JS errors in 5 min`);
  }

  // 6. Ad watch completion < 50% in 30-min window
  const adStarts = _eventsInWindow(WINDOW_30MIN, e => e.op === 'ad_watch_start');
  const adDone   = _eventsInWindow(WINDOW_30MIN, e => e.op === 'watch_ad_credited');
  if (adStarts.length > 10 && adDone.length / adStarts.length < 0.5) {
    if (_shouldAlert('ad_completion_rate', WINDOW_30MIN))
      _recordAnomaly('low_ad_completion', 'warning', `${adDone.length}/${adStarts.length} completions in 30 min`);
  }
}

// ---------------------------------------------------------------------------
// Report generation
// ---------------------------------------------------------------------------
async function generateReport(from, to) {
  const period = logIndex.filter(e => {
    const t = new Date(e.ts).getTime();
    return t >= from.getTime() && t <= to.getTime();
  });

  const requests = period.filter(e => e.statusCode);
  const errors   = requests.filter(e => e.statusCode >= 500);
  const errorRates = {};
  requests.forEach(e => {
    const key = e.op || 'unknown';
    if (!errorRates[key]) errorRates[key] = { total: 0, errors: 0 };
    errorRates[key].total++;
    if (e.statusCode >= 500) errorRates[key].errors++;
  });
  const errorRateMap = {};
  Object.entries(errorRates).forEach(([k, v]) => {
    errorRateMap[k] = v.total > 0 ? v.errors / v.total : 0;
  });

  const latencies = period.filter(e => typeof e.durationMs === 'number').map(e => e.durationMs).sort((a, b) => a - b);
  const pct = (arr, p) => arr.length ? arr[Math.floor(arr.length * p)] : 0;

  const twiqVol = period.filter(e => e.op === 'watch_ad_credited' || e.op === 'bid_placed').length;
  const failedLogins = period.filter(e => e.op === 'auth_failed').length;

  const jsErrors = {};
  period.filter(e => e.op === 'js_error').forEach(e => {
    const k = e.message || 'unknown';
    jsErrors[k] = (jsErrors[k] || 0) + 1;
  });

  const periodAnomalies = anomalies.filter(a => {
    const t = new Date(a.ts).getTime();
    return t >= from.getTime() && t <= to.getTime();
  });

  const report = {
    generatedAt: new Date(),
    period: { from, to },
    errorRates: errorRateMap,
    latencyPercentiles: {
      p50: pct(latencies, 0.5),
      p95: pct(latencies, 0.95),
      p99: pct(latencies, 0.99),
    },
    twiqTransactionVolume: twiqVol,
    failedLoginAttempts: failedLogins,
    frontendErrorSummary: Object.entries(jsErrors).map(([errorType, count]) => ({ errorType, count })),
    journeyFunnel: {
      registered:  period.filter(e => e.op === 'auth_guest').length,
      watchedAd:   period.filter(e => e.op === 'watch_ad_credited').length,
      placedBid:   period.filter(e => e.op === 'bid_placed').length,
      wonRaffle:   period.filter(e => e.op === 'raffle_max_threshold_reached' || e.op === 'raffle_expired_winner').length,
    },
    adWatchCompletionRate: (() => {
      const starts = period.filter(e => e.op === 'ad_watch_start').length;
      const done   = period.filter(e => e.op === 'watch_ad_credited').length;
      return starts > 0 ? done / starts : 1;
    })(),
    topDropOffPoints: [],
    anomalies: periodAnomalies,
    agentHealthy: running,
  };

  log('info', 'report_generated', { from: from.toISOString(), to: to.toISOString(), anomalyCount: periodAnomalies.length });
  return report;
}

// ---------------------------------------------------------------------------
// Scheduled report delivery
// ---------------------------------------------------------------------------
function _scheduleReport() {
  reportTimer = setInterval(async () => {
    const to   = new Date();
    const from = new Date(to.getTime() - REPORT_INTERVAL_MS);
    try {
      const report = await generateReport(from, to);
      const admin = { id: 'admin', displayName: process.env.ADMIN_EMAIL || 'admin' };
      await notif.sendAdminRaffleUnderThreshold(admin, {
        id: 'ops_report',
        totalTwiqsBid: report.twiqTransactionVolume,
        minTwiqThreshold: 0,
      });
      log('info', 'scheduled_report_sent', { anomalies: report.anomalies.length });
    } catch (err) {
      log('error', 'scheduled_report_failed', { message: err.message });
    }
  }, REPORT_INTERVAL_MS);
}

// ---------------------------------------------------------------------------
// Log index pruning (30-day retention)
// ---------------------------------------------------------------------------
function _schedulePrune() {
  pruneTimer = setInterval(() => {
    const cutoff = Date.now() - LOG_RETENTION_MS;
    const before = logIndex.length;
    logIndex = logIndex.filter(e => e._ingestedAt >= cutoff);
    const pruned = before - logIndex.length;
    if (pruned > 0) log('info', 'log_pruned', { pruned, remaining: logIndex.length });
  }, 60 * 60 * 1000); // prune hourly
}

// ---------------------------------------------------------------------------
// Watchdog
// ---------------------------------------------------------------------------
function _startWatchdog() {
  watchdogTimer = setInterval(() => {
    const silent = Date.now() - lastHeartbeat;
    if (silent > WATCHDOG_TIMEOUT_MS) {
      log('critical', 'watchdog_alert', { silentMs: silent });
      notif.sendCashoutFailure(
        { id: 'admin', displayName: process.env.ADMIN_EMAIL || 'admin' },
        `AI_Ops_Agent has been silent for ${Math.round(silent / 1000)}s`
      ).catch(() => {});
    }
    // Emit heartbeat
    lastHeartbeat = Date.now();
    log('info', 'heartbeat', { logIndexSize: logIndex.length, anomalyCount: anomalies.length });
  }, WATCHDOG_INTERVAL_MS);
}

// ---------------------------------------------------------------------------
// Public interface
// ---------------------------------------------------------------------------
function start() {
  if (running) return;
  running = true;
  lastHeartbeat = Date.now();
  _scheduleReport();
  _schedulePrune();
  _startWatchdog();
  log('info', 'agent_started', { reportIntervalMs: REPORT_INTERVAL_MS });
}

function stop() {
  running = false;
  clearInterval(reportTimer);
  clearInterval(watchdogTimer);
  clearInterval(pruneTimer);
  log('info', 'agent_stopped', {});
}

function getStatus() {
  return {
    running,
    logIndexSize: logIndex.length,
    anomalyCount: anomalies.length,
    lastHeartbeat: new Date(lastHeartbeat).toISOString(),
  };
}

module.exports = { start, stop, getStatus, ingest, generateReport };
