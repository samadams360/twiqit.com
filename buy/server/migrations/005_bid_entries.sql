-- Slice 7: bid_entries table
CREATE TABLE IF NOT EXISTS bid_entries (
  id           UUID PRIMARY KEY,
  raffle_id    UUID NOT NULL REFERENCES raffles(id),
  user_id      UUID NOT NULL REFERENCES users(id),
  amount       INTEGER NOT NULL CHECK (amount > 0),
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_bid_entries_raffle_id ON bid_entries(raffle_id);
CREATE INDEX IF NOT EXISTS idx_bid_entries_user_id   ON bid_entries(user_id);
