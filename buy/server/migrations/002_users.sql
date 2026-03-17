-- Migration 002: Users table
-- Run after 001_initial.sql

CREATE TABLE IF NOT EXISTS users (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  display_name TEXT NOT NULL,
  token_hash   TEXT NOT NULL UNIQUE,  -- SHA-256 hash of the bearer token
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
