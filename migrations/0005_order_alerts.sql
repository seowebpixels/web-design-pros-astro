CREATE TABLE IF NOT EXISTS wdp_order_alerts (
  order_id TEXT NOT NULL REFERENCES wdp_orders(id),
  channel TEXT NOT NULL CHECK(channel IN ('email','telegram')),
  payload_json TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','sending','sent')),
  attempts INTEGER NOT NULL DEFAULT 0,
  next_attempt_at INTEGER NOT NULL DEFAULT 0,
  lease_token TEXT,
  lease_until INTEGER NOT NULL DEFAULT 0,
  provider_id TEXT,
  last_error TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  sent_at TEXT,
  PRIMARY KEY(order_id,channel)
);
CREATE INDEX IF NOT EXISTS wdp_order_alerts_pending_idx ON wdp_order_alerts(status,next_attempt_at);
