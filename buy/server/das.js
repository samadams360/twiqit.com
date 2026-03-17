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
  getDropById,
  createRaffle,
  getActiveRaffle,
  getRaffleById,
  updateRaffle,
  closeActiveRaffles,
};
