-- Migration 008: add created_by to raffles (FK to users)
ALTER TABLE raffles ADD COLUMN IF NOT EXISTS created_by UUID REFERENCES users(id);
