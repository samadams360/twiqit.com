/**
 * Notification_Service
 * Pluggable email provider — defaults to console logging (stub).
 * Wire a real provider (e.g. SendGrid, SES) by calling setProvider().
 *
 * Methods:
 *   sendWinnerNotification(user, raffle)
 *   sendCashoutFailure(user, reason)
 *   sendAdCooldownNotice(user, eligibleAt)
 *   sendAdminRaffleUnderThreshold(admin, raffle)
 */

function log(severity, op, extra = {}) {
  console.log(JSON.stringify({
    ts: new Date().toISOString(),
    service: 'notification_service',
    severity,
    op,
    ...extra,
  }));
}

// Default stub provider — logs to stdout
let provider = {
  async send({ to, subject, body }) {
    log('info', 'email_stub', { to, subject, bodyPreview: body.slice(0, 80) });
  },
};

function setProvider(p) {
  provider = p;
}

async function sendWinnerNotification(user, raffle) {
  await provider.send({
    to: user.displayName,
    subject: `You won the Twiqit raffle!`,
    body: `Congratulations ${user.displayName}! You won the raffle for drop ${raffle.dropId}. We'll be in touch shortly.`,
  });
  log('info', 'winner_notification_sent', { userId: user.id, raffleId: raffle.id });
}

async function sendCashoutFailure(user, reason) {
  await provider.send({
    to: user.displayName,
    subject: `Twiqit cashout failed`,
    body: `Hi ${user.displayName}, your cashout could not be processed. Reason: ${reason}. Your Twiqs have been returned.`,
  });
  log('info', 'cashout_failure_sent', { userId: user.id, reason });
}

async function sendAdCooldownNotice(user, eligibleAt) {
  await provider.send({
    to: user.displayName,
    subject: `Twiqit ad cooldown`,
    body: `Hi ${user.displayName}, you can watch another ad and earn 100 Twiqs after ${new Date(eligibleAt).toLocaleString()}.`,
  });
  log('info', 'ad_cooldown_notice_sent', { userId: user.id, eligibleAt });
}

async function sendAdminRaffleUnderThreshold(admin, raffle) {
  await provider.send({
    to: admin.displayName,
    subject: `Raffle ended below minimum threshold`,
    body: `Raffle ${raffle.id} expired with ${raffle.totalTwiqsBid} Twiqs bid (minimum was ${raffle.minTwiqThreshold}). No winner was selected.`,
  });
  log('info', 'admin_under_threshold_sent', { adminId: admin.id, raffleId: raffle.id });
}

module.exports = {
  setProvider,
  sendWinnerNotification,
  sendCashoutFailure,
  sendAdCooldownNotice,
  sendAdminRaffleUnderThreshold,
};
