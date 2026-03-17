-- Slice 9: extend raffle status to include winner_selected and no_winner
-- The raffles table uses a TEXT column for status (no enum constraint),
-- so no ALTER TYPE needed — just documenting the new valid values here.
-- Valid statuses: active | closed | winner_selected | no_winner | receipt_confirmed

-- Add index to speed up scheduler polling
CREATE INDEX IF NOT EXISTS idx_raffles_status_expires
  ON raffles(status, expires_at)
  WHERE status = 'active';
