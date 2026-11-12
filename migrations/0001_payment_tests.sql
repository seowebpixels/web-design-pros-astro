-- Isolated sandbox payments. Does not alter existing customer tables.
CREATE TABLE IF NOT EXISTS payment_tests (
  id TEXT PRIMARY KEY,
  access_hash TEXT NOT NULL,
  cart_json TEXT NOT NULL,
  amount INTEGER NOT NULL CHECK(amount > 0),
  checkout_id TEXT UNIQUE,
  redirect_url TEXT,
  status TEXT NOT NULL DEFAULT 'pending',
  payment_id TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
