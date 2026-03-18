/**
 * Data_Access_Service (DAS)
 * Single proxy between all upstream services and PostgreSQL.
 * - All queries are parameterized (no string interpolation)
 * - Every operation appends an audit log entry
 * - PII encryption handled here (email, bankAccountInfo) — added in Slice 10
 */
const { v4: uuidv4 } = require('uuid');
const pool = require('./db');

// ---------------------------------------------------------------------------
// Audit log
// ---------------------------------------------------------------------------
function audit(op, table, recordId, caller, success) {
  console.log(JSON.stringify({
    ts: new Date().toISOString(),
    service: 'DAS',
    severity: 'info',
    op,
    table,
    recordId: recordId ?? null,
    caller,
    success,
  }));
}

// ---------------------------------------------------------------------------
// Users
// ---------------------------------------------------------------------------
async function createUser(data, caller = 'unknown') {
  const id = data.id || uuidv4();
  const { displayName, tokenHash = null, isGuest = false } = data;
  const { rows } = await pool.query(
    `INSERT INTO users (id, display_name, token_hash, is_guest)
     VALUES ($1, $2, $3, $4)
     ON CONFLICT (token_hash) DO NOTHING
     RETURNING *`,
    [id, displayName, tokenHash, isGuest]
  );
  audit('write', 'users', id, caller, true);
  return rows[0] ? rowToUser(rows[0]) : null;
}

async function getUserById(id, caller = 'unknown') {
  const { rows } = await pool.query(
    'SELECT * FROM users WHERE id = $1',
    [id]
  );
  const row = rows[0] ?? null;
  audit('read', 'users', id, caller, !!row);
  return row ? rowToUser(row) : null;
}

async function getUserByToken(tokenHash, caller = 'unknown') {
  const { rows } = await pool.query(
    'SELECT * FROM users WHERE token_hash = $1',
    [tokenHash]
  );
  const row = rows[0] ?? null;
  audit('read', 'users', row?.id ?? null, caller, !!row);
  return row ? rowToUser(row) : null;
}

async function getOrCreateGuestUser(displayName, caller = 'unknown') {
  // Find existing guest with this display name (case-insensitive)
  const { rows: existing } = await pool.query(
    `SELECT * FROM users WHERE LOWER(display_name) = LOWER($1) AND is_guest = true LIMIT 1`,
    [displayName]
  );
  if (existing[0]) {
    audit('read', 'users', existing[0].id, caller, true);
    return rowToUser(existing[0]);
  }
  // Create new guest user
  const id = uuidv4();
  const { rows } = await pool.query(
    `INSERT INTO users (id, display_name, token_hash, is_guest)
     VALUES ($1, $2, NULL, true)
     RETURNING *`,
    [id, displayName]
  );
  audit('write', 'users', id, caller, true);
  return rowToUser(rows[0]);
}

// ---------------------------------------------------------------------------
// Twiq Transactions
// ---------------------------------------------------------------------------
async function getTwiqBalance(userId, caller = 'unknown') {
  const { rows } = await pool.query(
    'SELECT COALESCE(SUM(amount), 0)::integer AS balance FROM twiq_transactions WHERE user_id = $1',
    [userId]
  );
  audit('read', 'twiq_transactions', userId, caller, true);
  return rows[0].balance;
}

async function getLastAdWatchTime(userId, caller = 'unknown') {
  const { rows } = await pool.query(
    `SELECT created_at FROM twiq_transactions
     WHERE user_id = $1 AND type = 'ad_watch'
     ORDER BY created_at DESC LIMIT 1`,
    [userId]
  );
  audit('read', 'twiq_transactions', userId, caller, true);
  return rows[0]?.created_at ?? null;
}

async function createTwiqTransaction(data, caller = 'unknown') {
  const { userId, type, amount } = data;
  const id = uuidv4();
  // Wrap in a transaction to ensure atomicity
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const { rows } = await client.query(
      `INSERT INTO twiq_transactions (id, user_id, type, amount)
       VALUES ($1, $2, $3, $4) RETURNING *`,
      [id, userId, type, amount]
    );
    await client.query('COMMIT');
    audit('write', 'twiq_transactions', id, caller, true);
    return rowToTwiqTransaction(rows[0]);
  } catch (err) {
    await client.query('ROLLBACK');
    audit('write', 'twiq_transactions', id, caller, false);
    throw err;
  } finally {
    client.release();
  }
}

// ---------------------------------------------------------------------------
// Bid Entries
// ---------------------------------------------------------------------------
async function createBidEntry(data, caller = 'unknown') {
  const id = uuidv4();
  const { raffleId, userId, amount } = data;
  const { rows } = await pool.query(
    `INSERT INTO bid_entries (id, raffle_id, user_id, amount)
     VALUES ($1, $2, $3, $4) RETURNING *`,
    [id, raffleId, userId, amount]
  );
  audit('write', 'bid_entries', id, caller, true);
  return rowToBidEntry(rows[0]);
}

async function getBidEntriesByRaffleId(raffleId, caller = 'unknown') {
  const { rows } = await pool.query(
    'SELECT * FROM bid_entries WHERE raffle_id = $1 ORDER BY created_at ASC',
    [raffleId]
  );
  audit('read', 'bid_entries', raffleId, caller, true);
  return rows.map(rowToBidEntry);
}

async function getUserBidTotalForRaffle(raffleId, userId, caller = 'unknown') {
  const { rows } = await pool.query(
    `SELECT COALESCE(SUM(amount), 0)::integer AS total
     FROM bid_entries WHERE raffle_id = $1 AND user_id = $2`,
    [raffleId, userId]
  );
  audit('read', 'bid_entries', raffleId, caller, true);
  return rows[0].total;
}

// Get the most recent raffle where a given user is the winner
async function getWinnerRaffleForUser(userId, caller = 'unknown') {
  const { rows } = await pool.query(
    `SELECT r.*, d.name AS drop_name, d.image_url AS drop_image_url
     FROM raffles r
     JOIN drops d ON d.id = r.drop_id
     WHERE r.winner_id = $1
     ORDER BY r.closed_at DESC LIMIT 1`,
    [userId]
  );
  const row = rows[0] ?? null;
  audit('read', 'raffles', row?.id ?? null, caller, !!row);
  if (!row) return null;
  return {
    ...rowToRaffle(row),
    dropName: row.drop_name,
    dropImageUrl: row.drop_image_url,
  };
}

// ---------------------------------------------------------------------------
// Drops
// ---------------------------------------------------------------------------
async function getDropById(id, caller = 'unknown') {
  const { rows } = await pool.query(
    'SELECT * FROM drops WHERE id = $1',
    [id]
  );
  const row = rows[0] ?? null;
  audit('read', 'drops', id, caller, !!row);
  return row ? rowToDrop(row) : null;
}

async function listDrops(caller = 'unknown') {
  const { rows } = await pool.query(
    'SELECT * FROM drops ORDER BY created_at DESC'
  );
  audit('read', 'drops', null, caller, true);
  return rows.map(rowToDrop);
}

// ---------------------------------------------------------------------------
// Raffles
// ---------------------------------------------------------------------------
async function createRaffle(data, caller = 'unknown') {
  const id = data.id || uuidv4();
  const { dropId, minTwiqThreshold, maxTwiqThreshold, expiresAt } = data;
  const { rows } = await pool.query(
    `INSERT INTO raffles
       (id, drop_id, status, min_twiq_threshold, max_twiq_threshold, expires_at,
        total_twiqs_bid, winner_id, winning_bid_id, created_at, closed_at)
     VALUES ($1, $2, 'active', $3, $4, $5, 0, NULL, NULL, NOW(), NULL)
     RETURNING *`,
    [id, dropId, minTwiqThreshold, maxTwiqThreshold, expiresAt]
  );
  audit('write', 'raffles', id, caller, true);
  return rowToRaffle(rows[0]);
}

async function getActiveRaffle(caller = 'unknown') {
  const { rows } = await pool.query(
    `SELECT r.*, d.name AS drop_name, d.description AS drop_description,
            d.image_url AS drop_image_url, d.retail_value AS drop_retail_value,
            d.created_at AS drop_created_at
     FROM raffles r
     JOIN drops d ON d.id = r.drop_id
     WHERE r.status = 'active'
     ORDER BY r.created_at DESC
     LIMIT 1`
  );
  const row = rows[0] ?? null;
  audit('read', 'raffles', row?.id ?? null, caller, true);
  if (!row) return null;
  return {
    raffle: rowToRaffle(row),
    drop: {
      id: row.drop_id,
      name: row.drop_name,
      description: row.drop_description,
      imageUrl: row.drop_image_url,
      retailValue: row.drop_retail_value,
      createdAt: row.drop_created_at,
    },
  };
}

async function getRaffleById(id, caller = 'unknown') {
  const { rows } = await pool.query(
    'SELECT * FROM raffles WHERE id = $1',
    [id]
  );
  const row = rows[0] ?? null;
  audit('read', 'raffles', id, caller, !!row);
  return row ? rowToRaffle(row) : null;
}

async function updateRaffle(id, data, caller = 'unknown') {
  const fields = [];
  const values = [];
  let i = 1;

  if (data.status !== undefined)           { fields.push('status = $' + i++);              values.push(data.status); }
  if (data.minTwiqThreshold !== undefined) { fields.push('min_twiq_threshold = $' + i++);  values.push(data.minTwiqThreshold); }
  if (data.maxTwiqThreshold !== undefined) { fields.push('max_twiq_threshold = $' + i++);  values.push(data.maxTwiqThreshold); }
  if (data.expiresAt !== undefined)        { fields.push('expires_at = $' + i++);           values.push(data.expiresAt); }
  if (data.totalTwiqsBid !== undefined)    { fields.push('total_twiqs_bid = $' + i++);      values.push(data.totalTwiqsBid); }
  if (data.winnerId !== undefined)         { fields.push('winner_id = $' + i++);            values.push(data.winnerId); }
  if (data.winningBidId !== undefined)     { fields.push('winning_bid_id = $' + i++);       values.push(data.winningBidId); }
  if (data.closedAt !== undefined)         { fields.push('closed_at = $' + i++);            values.push(data.closedAt); }

  if (fields.length === 0) return getRaffleById(id, caller);

  values.push(id);
  const { rows } = await pool.query(
    'UPDATE raffles SET ' + fields.join(', ') + ' WHERE id = $' + i + ' RETURNING *',
    values
  );
  audit('write', 'raffles', id, caller, true);
  return rowToRaffle(rows[0]);
}

// Close all currently active raffles (used during replace)
async function closeActiveRaffles(caller = 'unknown') {
  const { rows } = await pool.query(
    `UPDATE raffles SET status = 'closed', closed_at = NOW()
     WHERE status = 'active'
     RETURNING id`
  );
  rows.forEach(r => audit('write', 'raffles', r.id, caller, true));
  return rows.map(r => r.id);
}

// ---------------------------------------------------------------------------
// Row mappers
// ---------------------------------------------------------------------------
function rowToTwiqTransaction(row) {
  return {
    id: row.id,
    userId: row.user_id,
    type: row.type,
    amount: row.amount,
    createdAt: row.created_at,
  };
}

function rowToUser(row) {
  return {
    id: row.id,
    displayName: row.display_name,
    tokenHash: row.token_hash,
    isGuest: row.is_guest,
    createdAt: row.created_at,
  };
}

function rowToRaffle(row) {
  return {
    id: row.id,
    dropId: row.drop_id,
    status: row.status,
    minTwiqThreshold: row.min_twiq_threshold,
    maxTwiqThreshold: row.max_twiq_threshold,
    expiresAt: row.expires_at,
    totalTwiqsBid: row.total_twiqs_bid,
    winnerId: row.winner_id,
    winningBidId: row.winning_bid_id,
    createdAt: row.created_at,
    closedAt: row.closed_at,
  };
}

function rowToBidEntry(row) {
  return {
    id: row.id,
    raffleId: row.raffle_id,
    userId: row.user_id,
    amount: row.amount,
    createdAt: row.created_at,
  };
}

function rowToDrop(row) {
  return {
    id: row.id,
    name: row.name,
    description: row.description,
    imageUrl: row.image_url,
    retailValue: row.retail_value,
    createdAt: row.created_at,
  };
}

module.exports = {
  createUser,
  getUserById,
  getUserByToken,
  getOrCreateGuestUser,
  getTwiqBalance,
  getLastAdWatchTime,
  createTwiqTransaction,
  createBidEntry,
  getBidEntriesByRaffleId,
  getUserBidTotalForRaffle,
  getWinnerRaffleForUser,
  getDropById,
  listDrops,
  createRaffle,
  getActiveRaffle,
  getRaffleById,
  updateRaffle,
  closeActiveRaffles,
};
