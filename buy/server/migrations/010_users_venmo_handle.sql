-- Migration 010: add venmo_handle to users
ALTER TABLE users ADD COLUMN IF NOT EXISTS venmo_handle VARCHAR(64);
