CREATE TABLE IF NOT EXISTS wdp_order_sequences (
  mode TEXT PRIMARY KEY CHECK(mode IN ('test','live')),
  next_value INTEGER NOT NULL CHECK(next_value > 0)
);
INSERT OR IGNORE INTO wdp_order_sequences (mode,next_value) VALUES ('test',1);
INSERT OR IGNORE INTO wdp_order_sequences (mode,next_value) VALUES ('live',2412);

CREATE TABLE IF NOT EXISTS wdp_orders (
  id TEXT PRIMARY KEY,
  customer_id TEXT NOT NULL REFERENCES wdp_auth_users(id),
  mode TEXT NOT NULL CHECK(mode IN ('test','live')),
  sequence INTEGER NOT NULL CHECK(sequence > 0),
  access_hash TEXT NOT NULL,
  cart_json TEXT NOT NULL,
  billing_json TEXT NOT NULL,
  registrant_json TEXT NOT NULL,
  amount INTEGER NOT NULL CHECK(amount > 0),
  currency TEXT NOT NULL DEFAULT 'ZAR' CHECK(currency='ZAR'),
  payment_status TEXT NOT NULL DEFAULT 'pending' CHECK(payment_status IN ('pending','paid','failed')),
  fulfilment_status TEXT NOT NULL DEFAULT 'not_started',
  checkout_id TEXT,
  payment_id TEXT,
  terms_url TEXT NOT NULL,
  terms_accepted_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  paid_at TEXT,
  UNIQUE(mode,sequence)
);
CREATE INDEX IF NOT EXISTS wdp_orders_customer_sequence_idx ON wdp_orders(customer_id,mode,sequence DESC);
