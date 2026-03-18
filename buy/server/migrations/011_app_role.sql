-- Migration 011: Create least-privilege application role
-- The twiqit_app role has only the permissions it needs — no DDL, no superuser.
-- Run this as a superuser (postgres) once per environment.

CREATE ROLE twiqit_app WITH LOGIN PASSWORD 'twiqit_app_2026'
  NOSUPERUSER NOCREATEDB NOCREATEROLE;

GRANT CONNECT ON DATABASE twiqit TO twiqit_app;
GRANT USAGE ON SCHEMA public TO twiqit_app;

-- DML only — no DDL (no CREATE/DROP/ALTER)
GRANT SELECT, INSERT, UPDATE ON TABLE
  users, products, raffles, bid_entries, twiq_transactions
TO twiqit_app;

-- Products can be deleted by admin; other tables are append/update only
GRANT DELETE ON TABLE products TO twiqit_app;

-- NOTE: On Railway, run equivalent GRANT statements against the railway database.
-- The DATABASE_URL in production should use twiqit_app credentials, not postgres.
