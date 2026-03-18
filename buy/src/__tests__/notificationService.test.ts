/**
 * Notification_Service unit tests
 * Feature: ecommerce-platform
 * Tests each method dispatches to the email provider with the correct payload.
 */

// We require the actual module but swap the provider
const notif = require('../../server/notificationService');

describe('Notification_Service', () => {
  let sent: Array<{ to: string; subject: string; body: string }>;

  beforeEach(() => {
    sent = [];
    notif.setProvider({
      async send(msg: { to: string; subject: string; body: string }) {
        sent.push(msg);
      },
    });
  });

  // ---------------------------------------------------------------------------
  // sendWinnerNotification
  // ---------------------------------------------------------------------------
  describe('sendWinnerNotification', () => {
    it('dispatches to provider with correct to, subject, and body', async () => {
      const user = { id: 'u1', displayName: 'Alice' };
      const raffle = { id: 'r1', dropId: 'drop-1' };
      await notif.sendWinnerNotification(user, raffle);
      expect(sent).toHaveLength(1);
      expect(sent[0].to).toBe('Alice');
      expect(sent[0].subject).toContain('won');
      expect(sent[0].body).toContain('Alice');
      expect(sent[0].body).toContain('drop-1');
    });

    it('calls provider exactly once per invocation', async () => {
      await notif.sendWinnerNotification({ id: 'u1', displayName: 'Bob' }, { id: 'r1', dropId: 'd1' });
      expect(sent).toHaveLength(1);
    });
  });

  // ---------------------------------------------------------------------------
  // sendCashoutFailure
  // ---------------------------------------------------------------------------
  describe('sendCashoutFailure', () => {
    it('dispatches with user name and reason in body', async () => {
      const user = { id: 'u2', displayName: 'Carol' };
      await notif.sendCashoutFailure(user, 'bank declined');
      expect(sent).toHaveLength(1);
      expect(sent[0].to).toBe('Carol');
      expect(sent[0].subject).toContain('cashout');
      expect(sent[0].body).toContain('Carol');
      expect(sent[0].body).toContain('bank declined');
    });
  });

  // ---------------------------------------------------------------------------
  // sendAdCooldownNotice
  // ---------------------------------------------------------------------------
  describe('sendAdCooldownNotice', () => {
    it('dispatches with eligibleAt in body', async () => {
      const user = { id: 'u3', displayName: 'Dave' };
      const eligibleAt = new Date('2026-01-01T12:00:00Z').toISOString();
      await notif.sendAdCooldownNotice(user, eligibleAt);
      expect(sent).toHaveLength(1);
      expect(sent[0].to).toBe('Dave');
      expect(sent[0].subject).toContain('cooldown');
      expect(sent[0].body).toContain('Dave');
    });
  });

  // ---------------------------------------------------------------------------
  // sendAdminRaffleUnderThreshold
  // ---------------------------------------------------------------------------
  describe('sendAdminRaffleUnderThreshold', () => {
    it('dispatches with raffle id, totalTwiqsBid, and minTwiqThreshold', async () => {
      const admin = { id: 'admin', displayName: 'Admin' };
      const raffle = { id: 'r2', totalTwiqsBid: 50, minTwiqThreshold: 200 };
      await notif.sendAdminRaffleUnderThreshold(admin, raffle);
      expect(sent).toHaveLength(1);
      expect(sent[0].to).toBe('Admin');
      expect(sent[0].subject).toContain('threshold');
      expect(sent[0].body).toContain('r2');
      expect(sent[0].body).toContain('50');
      expect(sent[0].body).toContain('200');
    });
  });

  // ---------------------------------------------------------------------------
  // Property 15: Winner notification is sent
  // ---------------------------------------------------------------------------
  describe('Property 15: Winner notification is sent', () => {
    // Feature: ecommerce-platform, Property 15: Winner notification is sent
    it('sendWinnerNotification always calls provider.send exactly once', async () => {
      const calls: number[] = [];
      notif.setProvider({
        async send() { calls.push(1); },
      });
      await notif.sendWinnerNotification({ id: 'u1', displayName: 'Eve' }, { id: 'r1', dropId: 'd1' });
      expect(calls).toHaveLength(1);
    });
  });
});
