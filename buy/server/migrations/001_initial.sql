-- Migration 001: Initial schema — drops and raffles tables
-- Run once against your PostgreSQL database before starting the server.

CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- Drops: the featured item in a raffle
CREATE TABLE IF NOT EXISTS drops (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name          TEXT NOT NULL,
  description   TEXT NOT NULL,
  image_url     TEXT NOT NULL,
  retail_value  INTEGER NOT NULL,  -- in cents
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Raffles: one active raffle at a time
CREATE TABLE IF NOT EXISTS raffles (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  drop_id             UUID NOT NULL REFERENCES drops(id),
  status              TEXT NOT NULL DEFAULT 'active'
                        CHECK (status IN ('active','closed','winner_selected','receipt_confirmed','no_winner')),
  min_twiq_threshold  INTEGER NOT NULL,
  max_twiq_threshold  INTEGER NOT NULL,
  expires_at          TIMESTAMPTZ NOT NULL,
  total_twiqs_bid     INTEGER NOT NULL DEFAULT 0,
  winner_id           UUID,          -- FK to users (added in migration 002)
  winning_bid_id      UUID,          -- FK to bid_entries (added in migration 003)
  created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  closed_at           TIMESTAMPTZ
);

-- Enforce at most one active raffle at a time
CREATE UNIQUE INDEX IF NOT EXISTS raffles_one_active
  ON raffles (status)
  WHERE status = 'active';

-- Seed: insert a sample drop so the homepage has something to show
-- Remove or replace this before going to production.
INSERT INTO drops (id, name, description, image_url, retail_value)
VALUES (
  gen_random_uuid(),
  'Sony WH-1000XM5 Headphones',
  'Industry-leading noise cancellation with up to 30-hour battery life and crystal-clear hands-free calling.',
  'https://images.unsplash.com/photo-1505740420928-5e560c06d30e?w=600',
  39999
)
ON CONFLICT DO NOTHING;
