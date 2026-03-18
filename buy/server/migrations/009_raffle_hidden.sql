-- Migration 009: add hidden flag to raffles
ALTER TABLE raffles ADD COLUMN IF NOT EXISTS hidden BOOLEAN NOT NULL DEFAULT false;
