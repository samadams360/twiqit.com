-- Migration 004: Twiq transactions table
CREATE TABLE IF NOT EXISTS twiq_transactions (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id      UUID NOT NULL REFERENCES users(id),
  type         TEXT NOT NULL CHECK (type IN ('ad_watch', 'bid', 'cashout')),
  amount       INTEGER NOT NULL,  -- positive = credit, negative = debit
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS twiq_transactions_user_id ON twiq_transactions(user_id);
