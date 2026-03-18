/**
 * AI_Ops_Agent unit tests — anomaly detection
 * Feature: ecommerce-platform
 */

// We need to isolate the module between tests to reset state
// eslint-disable-next-line @typescript-eslint/no-explicit-any
let opsAgent: any;
let alertsSent: Array<{ to: string; subject: string; body: string }>;

beforeEach(() => {
  jest.resetModules();
  alertsSent = [];

  // Mock notificationService before requiring opsAgent
  jest.mock('../../server/notificationService', () => ({
    sendWinnerNotification: jest.fn(async () => {}),
    sendCashoutFailure: jest.fn(async () => {}),
    sendAdCooldownNotice: jest.fn(async () => {}),
    sendAdminRaffleUnderThreshold: jest.fn(async () => {}),
    setProvider: jest.fn(),
  }));

  opsAgent = require('../../server/opsAgent');
  opsAgent.start();
});

afterEach(() => {
  opsAgent.stop();
  jest.clearAllMocks();
});

function ingestMany(events: object[], count: number) {
  for (let i = 0; i < count; i++) {
    opsAgent.ingest(events[i % events.length]);
  }
}

describe('AI_Ops_Agent — getStatus', () => {
  it('reports running=true after start()', () => {
    const status = opsAgent.getStatus();
    expect(status.running).toBe(true);
  });

  it('reports running=false after stop()', () => {
    opsAgent.stop();
    const status = opsAgent.getStatus();
    expect(status.running).toBe(false);
  });

  it('logIndexSize increments as events are ingested', () => {
    const before = opsAgent.getStatus().logIndexSize;
    opsAgent.ingest({ ts: new Date().toISOString(), service: 'test', severity: 'info', op: 'ping' });
    opsAgent.ingest({ ts: new Date().toISOString(), service: 'test', severity: 'info', op: 'ping' });
    const after = opsAgent.getStatus().logIndexSize;
    expect(after).toBe(before + 2);
  });
});

describe('AI_Ops_Agent — anomaly detection: HTTP 5xx rate', () => {
  it('fires http_5xx_rate alert when >1% of requests in 5-min window are 5xx', () => {
    const notif = require('../../server/notificationService');
    // Inject 21 requests, 2 of which are 5xx (>1%)
    for (let i = 0; i < 19; i++) {
      opsAgent.ingest({ ts: new Date().toISOString(), service: 'api', severity: 'info', op: 'request', statusCode: 200 });
    }
    for (let i = 0; i < 2; i++) {
      opsAgent.ingest({ ts: new Date().toISOString(), service: 'api', severity: 'error', op: 'request', statusCode: 500 });
    }
    expect(notif.sendWinnerNotification).toHaveBeenCalled();
  });

  it('does not fire alert when 5xx rate is at or below 1%', () => {
    const notif = require('../../server/notificationService');
    // 100 requests, 1 error = 1% exactly — threshold is >1% so no alert
    for (let i = 0; i < 99; i++) {
      opsAgent.ingest({ ts: new Date().toISOString(), service: 'api', severity: 'info', op: 'request', statusCode: 200 });
    }
    opsAgent.ingest({ ts: new Date().toISOString(), service: 'api', severity: 'error', op: 'request', statusCode: 500 });
    // 1/100 = 1%, not > 1%, so no alert
    expect(notif.sendWinnerNotification).not.toHaveBeenCalled();
  });
});

describe('AI_Ops_Agent — anomaly detection: failed auth spike', () => {
  it('fires failed_auth_spike alert when >20 failures from same IP in 10-min window', () => {
    const notif = require('../../server/notificationService');
    for (let i = 0; i < 21; i++) {
      opsAgent.ingest({ ts: new Date().toISOString(), service: 'api', severity: 'warning', op: 'auth_failed', ip: '1.2.3.4' });
    }
    expect(notif.sendWinnerNotification).toHaveBeenCalled();
  });

  it('does not fire alert for 20 or fewer failures from same IP', () => {
    const notif = require('../../server/notificationService');
    for (let i = 0; i < 20; i++) {
      opsAgent.ingest({ ts: new Date().toISOString(), service: 'api', severity: 'warning', op: 'auth_failed', ip: '5.6.7.8' });
    }
    expect(notif.sendWinnerNotification).not.toHaveBeenCalled();
  });
});

describe('AI_Ops_Agent — anomaly detection: bid error rate', () => {
  it('fires bid_error_rate alert when >5% of bids are errors in 5-min window', () => {
    const notif = require('../../server/notificationService');
    // 10 successful bids + 1 error = ~9% error rate, but need >10 total
    for (let i = 0; i < 10; i++) {
      opsAgent.ingest({ ts: new Date().toISOString(), service: 'raffle', severity: 'info', op: 'bid_placed' });
    }
    for (let i = 0; i < 1; i++) {
      opsAgent.ingest({ ts: new Date().toISOString(), service: 'raffle', severity: 'error', op: 'bid_placed' });
    }
    expect(notif.sendWinnerNotification).toHaveBeenCalled();
  });
});

describe('AI_Ops_Agent — anomaly detection: frontend JS errors', () => {
  it('fires frontend_js_errors alert when >10 unique JS errors in 5-min window', () => {
    const notif = require('../../server/notificationService');
    for (let i = 0; i < 11; i++) {
      opsAgent.ingest({ ts: new Date().toISOString(), service: 'frontend', severity: 'error', op: 'js_error', message: `Error ${i}` });
    }
    expect(notif.sendWinnerNotification).toHaveBeenCalled();
  });

  it('does not fire alert for 10 or fewer unique JS errors', () => {
    const notif = require('../../server/notificationService');
    for (let i = 0; i < 10; i++) {
      opsAgent.ingest({ ts: new Date().toISOString(), service: 'frontend', severity: 'error', op: 'js_error', message: `Error ${i}` });
    }
    expect(notif.sendWinnerNotification).not.toHaveBeenCalled();
  });
});

describe('AI_Ops_Agent — generateReport', () => {
  it('returns a report with the correct period', async () => {
    const from = new Date(Date.now() - 3600_000);
    const to = new Date();
    const report = await opsAgent.generateReport(from, to);
    expect(report.period.from).toEqual(from);
    expect(report.period.to).toEqual(to);
    expect(report.agentHealthy).toBe(true);
  });

  it('counts twiqTransactionVolume correctly', async () => {
    opsAgent.ingest({ ts: new Date().toISOString(), service: 'twiq', severity: 'info', op: 'watch_ad_credited' });
    opsAgent.ingest({ ts: new Date().toISOString(), service: 'twiq', severity: 'info', op: 'bid_placed' });
    opsAgent.ingest({ ts: new Date().toISOString(), service: 'twiq', severity: 'info', op: 'bid_placed' });
    const from = new Date(Date.now() - 60_000);
    const to = new Date();
    const report = await opsAgent.generateReport(from, to);
    expect(report.twiqTransactionVolume).toBeGreaterThanOrEqual(3);
  });
});
