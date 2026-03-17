-- Migration 003: Allow guest users (no token_hash required)
ALTER TABLE users ALTER COLUMN token_hash DROP NOT NULL;
ALTER TABLE users ADD COLUMN IF NOT EXISTS is_guest BOOLEAN NOT NULL DEFAULT false;
