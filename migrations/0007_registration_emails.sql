CREATE TABLE IF NOT EXISTS wdp_registration_emails (
  order_id TEXT NOT NULL,
  domain TEXT NOT NULL,
  payload_json TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','sending','sent')),
  attempts INTEGER NOT NULL DEFAULT 0,
  first_attempt_at INTEGER,
  next_attempt_at INTEGER NOT NULL DEFAULT 0,
  lease_token TEXT,
  lease_until INTEGER NOT NULL DEFAULT 0,
  provider_id TEXT,
  last_error TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  sent_at TEXT,
  PRIMARY KEY(order_id,domain),
  FOREIGN KEY(order_id,domain) REFERENCES wdp_domain_registrations(order_id,domain)
);
CREATE INDEX IF NOT EXISTS wdp_registration_emails_pending_idx ON wdp_registration_emails(status,next_attempt_at);
