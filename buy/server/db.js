/**
 * PostgreSQL connection pool.
 * Reads DATABASE_URL from environment (set in .env or Railway env vars).
 *
 * TLS policy:
 *   - Local (localhost): TLS disabled (dev convenience)
 *   - Remote (Railway / any non-localhost): TLS required, rejectUnauthorized=false
 *     because Railway uses self-signed certs. The connection is still encrypted.
 *
 * Least-privilege:
 *   - Production DATABASE_URL should use the twiqit_app role (see migration 011).
 *   - twiqit_app has SELECT/INSERT/UPDATE on all tables + DELETE on products only.
 *   - No DDL access; migrations must be run as postgres superuser.
 */
const { Pool } = require('pg');

const isLocal = !process.env.DATABASE_URL ||
  process.env.DATABASE_URL.includes('localhost') ||
  process.env.DATABASE_URL.includes('127.0.0.1');

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: isLocal ? false : { rejectUnauthorized: false },
});

pool.on('error', (err) => {
  console.error(JSON.stringify({
    ts: new Date().toISOString(),
    service: 'db',
    severity: 'critical',
    op: 'pool_error',
    message: err.message,
  }));
});

module.exports = pool;
