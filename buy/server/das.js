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

async function updateUser(id, data, caller = 'unknown') {
  const fields = [];
  const values = [];
  let i = 1;
  if (data.displayName !== undefined) { fields.push(`display_name = $${i++}`); values.push(data.displayName); }
  if (data.venmoHandle !== undefined) { fields.push(`venmo_handle = $${i++}`); values.push(data.venmoHandle); }
  if (fields.length === 0) return getUserById(id, caller);
  values.push(id);
  const { rows } = await pool.query(
    `UPDATE users SET ${fields.join(', ')} WHERE id = $${i} RETURNING *`,
    values
  );
  audit('write', 'users', id, caller, true);
  return rows[0] ? rowToUser(rows[0]) : null;
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
    `SELECT r.*, p.name AS product_name, p.image_url AS product_image_url
     FROM raffles r
     JOIN products p ON p.id = r.product_id
     WHERE r.winner_id = $1
     ORDER BY r.closed_at DESC LIMIT 1`,
    [userId]
  );
  const row = rows[0] ?? null;
  audit('read', 'raffles', row?.id ?? null, caller, !!row);
  if (!row) return null;
  return {
    ...rowToRaffle(row),
    dropName: row.product_name,
    dropImageUrl: row.product_image_url,
  };
}

// Get full raffle history for a user — all raffles they bid on or won
async function getRaffleHistoryForUser(userId, caller = 'unknown') {
  const { rows } = await pool.query(
    `SELECT DISTINCT ON (r.id)
            r.id, r.status, r.hidden, r.min_twiq_threshold, r.max_twiq_threshold,
            r.expires_at, r.total_twiqs_bid, r.winner_id, r.winning_bid_id,
            r.created_by, r.created_at, r.closed_at,
            p.name AS product_name, p.image_url AS product_image_url,
            p.retail_value AS product_retail_value,
            COALESCE(SUM(b.amount) FILTER (WHERE b.user_id = $1), 0)::integer AS user_bid_total,
            (r.winner_id = $1) AS is_winner
     FROM raffles r
     JOIN products p ON p.id = r.product_id
     LEFT JOIN bid_entries b ON b.raffle_id = r.id AND b.user_id = $1
     WHERE r.winner_id = $1 OR b.user_id = $1
     GROUP BY r.id, p.name, p.image_url, p.retail_value
     ORDER BY r.id, r.created_at DESC`,
    [userId]
  );
  audit('read', 'raffles', userId, caller, true);
  return rows.map(row => ({
    id: row.id,
    status: row.status,
    hidden: row.hidden ?? false,
    minTwiqThreshold: row.min_twiq_threshold,
    maxTwiqThreshold: row.max_twiq_threshold,
    expiresAt: row.expires_at,
    totalTwiqsBid: row.total_twiqs_bid,
    winnerId: row.winner_id,
    createdAt: row.created_at,
    closedAt: row.closed_at,
    dropName: row.product_name,
    dropImageUrl: row.product_image_url,
    dropRetailValue: row.product_retail_value,
    userBidTotal: row.user_bid_total,
    isWinner: row.is_winner,
  }));
}

// Get all raffles where a given user is the winner (for profile history)
async function getAllWinsForUser(userId, caller = 'unknown') {
  const { rows } = await pool.query(
    `SELECT r.*, p.name AS product_name, p.image_url AS product_image_url,
            p.retail_value AS product_retail_value
     FROM raffles r
     JOIN products p ON p.id = r.product_id
     WHERE r.winner_id = $1
     ORDER BY r.closed_at DESC`,
    [userId]
  );
  audit('read', 'raffles', userId, caller, true);
  return rows.map(row => ({
    ...rowToRaffle(row),
    dropName: row.product_name,
    dropImageUrl: row.product_image_url,
    dropRetailValue: row.product_retail_value,
  }));
}

// ---------------------------------------------------------------------------
// Products
// ---------------------------------------------------------------------------
async function createDrop(data, caller = 'unknown') {
  const id = uuidv4();
  const { name, description = null, imageUrl = null, retailValue } = data;
  const { rows } = await pool.query(
    `INSERT INTO products (id, name, description, image_url, retail_value)
     VALUES ($1, $2, $3, $4, $5) RETURNING *`,
    [id, name, description, imageUrl, retailValue]
  );
  audit('write', 'products', id, caller, true);
  return rowToDrop(rows[0]);
}

async function getDropById(id, caller = 'unknown') {
  const { rows } = await pool.query(
    'SELECT * FROM products WHERE id = $1',
    [id]
  );
  const row = rows[0] ?? null;
  audit('read', 'products', id, caller, !!row);
  return row ? rowToDrop(row) : null;
}

async function listDrops(caller = 'unknown') {
  const { rows } = await pool.query(
    'SELECT * FROM products ORDER BY created_at DESC'
  );
  audit('read', 'products', null, caller, true);
  return rows.map(rowToDrop);
}

async function updateDrop(id, data, caller = 'unknown') {
  const fields = [];
  const values = [];
  let i = 1;
  if (data.name !== undefined)        { fields.push(`name = $${i++}`);         values.push(data.name); }
  if (data.description !== undefined) { fields.push(`description = $${i++}`);  values.push(data.description); }
  if (data.imageUrl !== undefined)    { fields.push(`image_url = $${i++}`);    values.push(data.imageUrl); }
  if (data.retailValue !== undefined) { fields.push(`retail_value = $${i++}`); values.push(data.retailValue); }
  if (fields.length === 0) return getDropById(id, caller);
  values.push(id);
  const { rows } = await pool.query(
    `UPDATE products SET ${fields.join(', ')} WHERE id = $${i} RETURNING *`,
    values
  );
  audit('write', 'products', id, caller, true);
  return rowToDrop(rows[0]);
}

async function deleteDrop(id, caller = 'unknown') {
  await pool.query('DELETE FROM products WHERE id = $1', [id]);
  audit('write', 'products', id, caller, true);
}

// ---------------------------------------------------------------------------
// Raffles
// ---------------------------------------------------------------------------
async function createRaffle(data, caller = 'unknown') {
  const id = data.id || uuidv4();
  const { productId, minTwiqThreshold, maxTwiqThreshold, expiresAt, createdBy = null } = data;
  const { rows } = await pool.query(
    `INSERT INTO raffles
       (id, product_id, status, min_twiq_threshold, max_twiq_threshold, expires_at,
        total_twiqs_bid, winner_id, winning_bid_id, created_by, created_at, closed_at)
     VALUES ($1, $2, 'active', $3, $4, $5, 0, NULL, NULL, $6, NOW(), NULL)
     RETURNING *`,
    [id, productId, minTwiqThreshold, maxTwiqThreshold, expiresAt, createdBy]
  );
  audit('write', 'raffles', id, caller, true);
  return rowToRaffle(rows[0]);
}

async function getActiveRaffle(caller = 'unknown') {
  const { rows } = await pool.query(
    `SELECT r.*, p.name AS product_name, p.description AS product_description,
            p.image_url AS product_image_url, p.retail_value AS product_retail_value,
            p.created_at AS product_created_at,
            u.display_name AS winner_name,
            c.display_name AS creator_name
     FROM raffles r
     JOIN products p ON p.id = r.product_id
     LEFT JOIN users u ON u.id = r.winner_id
     LEFT JOIN users c ON c.id = r.created_by
     WHERE r.status = 'active' AND r.hidden = false
     ORDER BY r.created_at DESC
     LIMIT 1`
  );
  const row = rows[0] ?? null;
  audit('read', 'raffles', row?.id ?? null, caller, true);
  if (!row) return null;
  return {
    raffle: { ...rowToRaffle(row), winnerName: row.winner_name ?? null, creatorName: row.creator_name ?? null },
    drop: {
      id: row.product_id,
      name: row.product_name,
      description: row.product_description,
      imageUrl: row.product_image_url,
      retailValue: row.product_retail_value,
      createdAt: row.product_created_at,
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
  if (data.hidden !== undefined)           { fields.push('hidden = $' + i++);               values.push(data.hidden); }

  if (fields.length === 0) return getRaffleById(id, caller);

  values.push(id);
  const { rows } = await pool.query(
    'UPDATE raffles SET ' + fields.join(', ') + ' WHERE id = $' + i + ' RETURNING *',
    values
  );
  audit('write', 'raffles', id, caller, true);
  return rowToRaffle(rows[0]);
}

// Get the most recent raffle regardless of status (for buy page fallback)
async function getMostRecentRaffle(caller = 'unknown') {
  const { rows } = await pool.query(
    `SELECT r.*, p.name AS product_name, p.description AS product_description,
            p.image_url AS product_image_url, p.retail_value AS product_retail_value,
            p.created_at AS product_created_at,
            u.display_name AS winner_name,
            c.display_name AS creator_name
     FROM raffles r
     JOIN products p ON p.id = r.product_id
     LEFT JOIN users u ON u.id = r.winner_id
     LEFT JOIN users c ON c.id = r.created_by
     WHERE r.hidden = false
     ORDER BY r.created_at DESC
     LIMIT 1`
  );
  const row = rows[0] ?? null;
  audit('read', 'raffles', row?.id ?? null, caller, true);
  if (!row) return null;
  return {
    raffle: { ...rowToRaffle(row), winnerName: row.winner_name ?? null, creatorName: row.creator_name ?? null },
    drop: {
      id: row.product_id,
      name: row.product_name,
      description: row.product_description,
      imageUrl: row.product_image_url,
      retailValue: row.product_retail_value,
      createdAt: row.product_created_at,
    },
  };
}

// List all raffles with drop info, ordered newest first (for admin history)
async function listRaffles(limit = 50, offset = 0, caller = 'unknown') {
  const { rows } = await pool.query(
    `SELECT r.*, p.name AS product_name, p.image_url AS product_image_url,
            p.retail_value AS product_retail_value,
            u.display_name AS winner_name,
            c.display_name AS creator_name
     FROM raffles r
     JOIN products p ON p.id = r.product_id
     LEFT JOIN users u ON u.id = r.winner_id
     LEFT JOIN users c ON c.id = r.created_by
     ORDER BY r.created_at DESC
     LIMIT $1 OFFSET $2`,
    [limit, offset]
  );
  audit('read', 'raffles', null, caller, true);
  return rows.map(row => ({
    ...rowToRaffle(row),
    dropName: row.product_name,
    dropImageUrl: row.product_image_url,
    dropRetailValue: row.product_retail_value,
    winnerName: row.winner_name ?? null,
    creatorName: row.creator_name ?? null,
  }));
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
    venmoHandle: row.venmo_handle ?? null,
    createdAt: row.created_at,
  };
}

function rowToRaffle(row) {
  return {
    id: row.id,
    productId: row.product_id,
    status: row.status,
    hidden: row.hidden ?? false,
    minTwiqThreshold: row.min_twiq_threshold,
    maxTwiqThreshold: row.max_twiq_threshold,
    expiresAt: row.expires_at,
    totalTwiqsBid: row.total_twiqs_bid,
    winnerId: row.winner_id,
    winningBidId: row.winning_bid_id,
    createdBy: row.created_by ?? null,
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
  updateUser,
  getOrCreateGuestUser,
  getTwiqBalance,
  getLastAdWatchTime,
  createTwiqTransaction,
  createBidEntry,
  getBidEntriesByRaffleId,
  getUserBidTotalForRaffle,
  getWinnerRaffleForUser,
  getAllWinsForUser,
  getRaffleHistoryForUser,
  createDrop,
  getDropById,
  listDrops,
  updateDrop,
  deleteDrop,
  createRaffle,
  getActiveRaffle,
  getMostRecentRaffle,
  listRaffles,
  getRaffleById,
  updateRaffle,
  closeActiveRaffles,
};
