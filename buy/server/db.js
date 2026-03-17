/**
 * PostgreSQL connection pool.
 * Reads DATABASE_URL from environment (set in .env or process env).
 * sslmode is controlled by the connection string or SSL env vars.
 */
const { Pool } = require('pg');

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.DATABASE_URL && process.env.DATABASE_URL.includes('localhost')
    ? false
    : { rejectUnauthorized: false },
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
