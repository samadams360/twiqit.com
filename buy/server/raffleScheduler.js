/**
 * Raffle Expiration Scheduler
 * Polls every 60 seconds for active raffles whose expiresAt has passed.
 *
 * - totalTwiqsBid >= minTwiqThreshold → close, select winner, notify winner
 * - totalTwiqsBid <  minTwiqThreshold → set status 'no_winner', notify admin
 */
const das = require('./das');
const { selectWinner } = require('./winnerSelector');
const notifications = require('./notificationService');

const POLL_INTERVAL_MS = 60 * 1000; // 60 seconds

function log(severity, op, extra = {}) {
  console.log(JSON.stringify({
    ts: new Date().toISOString(),
    service: 'raffle_scheduler',
    severity,
    op,
    ...extra,
  }));
}

async function processExpiredRaffles() {
  try {
    const { rows } = await require('./db').query(
      `SELECT * FROM raffles
       WHERE status = 'active' AND expires_at <= NOW()`
    );

    for (const row of rows) {
      const raffle = {
        id: row.id,
        dropId: row.drop_id,
        status: row.status,
        minTwiqThreshold: row.min_twiq_threshold,
        maxTwiqThreshold: row.max_twiq_threshold,
        expiresAt: row.expires_at,
        totalTwiqsBid: row.total_twiqs_bid,
        winnerId: row.winner_id,
        winningBidId: row.winning_bid_id,
      };

      log('info', 'processing_expired_raffle', { raffleId: raffle.id, totalTwiqsBid: raffle.totalTwiqsBid });

      if (raffle.totalTwiqsBid >= raffle.minTwiqThreshold) {
        // Sufficient bids — select a winner
        const entries = await das.getBidEntriesByRaffleId(raffle.id, 'scheduler');
        if (entries.length === 0) {
          // Edge case: threshold met but no entries (shouldn't happen, but guard it)
          await das.updateRaffle(raffle.id, { status: 'no_winner', closedAt: new Date() }, 'scheduler');
          log('warn', 'no_entries_despite_threshold', { raffleId: raffle.id });
          continue;
        }

        const winningEntry = selectWinner(entries);
        await das.updateRaffle(raffle.id, {
          status: 'winner_selected',
          closedAt: new Date(),
          winnerId: winningEntry.userId,
          winningBidId: winningEntry.id,
        }, 'scheduler');

        log('info', 'winner_selected', { raffleId: raffle.id, winnerId: winningEntry.userId, winningBidId: winningEntry.id });

        // Notify winner
        const winner = await das.getUserById(winningEntry.userId, 'scheduler');
        if (winner) {
          await notifications.sendWinnerNotification(winner, raffle).catch(err =>
            log('error', 'winner_notification_failed', { raffleId: raffle.id, error: err.message })
          );
        }
      } else {
        // Below minimum threshold — no winner
        await das.updateRaffle(raffle.id, { status: 'no_winner', closedAt: new Date() }, 'scheduler');
        log('info', 'raffle_no_winner', { raffleId: raffle.id, totalTwiqsBid: raffle.totalTwiqsBid, minTwiqThreshold: raffle.minTwiqThreshold });

        // Notify admin
        const adminToken = process.env.ADMIN_TOKEN;
        if (adminToken) {
          const crypto = require('crypto');
          const tokenHash = crypto.createHash('sha256').update(adminToken).digest('hex');
          const admin = await das.getUserByToken(tokenHash, 'scheduler');
          if (admin) {
            await notifications.sendAdminRaffleUnderThreshold(admin, raffle).catch(err =>
              log('error', 'admin_notification_failed', { raffleId: raffle.id, error: err.message })
            );
          }
        }
      }
    }
  } catch (err) {
    log('error', 'scheduler_poll_failed', { message: err.message });
  }
}

function start() {
  log('info', 'scheduler_started', { pollIntervalMs: POLL_INTERVAL_MS });
  // Run once immediately on start, then on interval
  processExpiredRaffles();
  return setInterval(processExpiredRaffles, POLL_INTERVAL_MS);
}

module.exports = { start, processExpiredRaffles };
