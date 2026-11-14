CREATE TABLE IF NOT EXISTS wdp_domain_registrations (
  order_id TEXT NOT NULL REFERENCES wdp_orders(id),
  domain TEXT NOT NULL,
  status TEXT NOT NULL CHECK(status IN ('pending','registered','issue')),
  registered_on TEXT,
  expires_on TEXT,
  provider_reference TEXT NOT NULL DEFAULT '',
  notes TEXT NOT NULL DEFAULT '',
  updated_by TEXT NOT NULL REFERENCES wdp_auth_users(id),
  version INTEGER NOT NULL CHECK(version>0),
  revision_id TEXT NOT NULL UNIQUE,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY(order_id,domain)
);
CREATE TABLE IF NOT EXISTS wdp_registration_audit (
  id TEXT PRIMARY KEY,
  order_id TEXT NOT NULL REFERENCES wdp_orders(id),
  domain TEXT NOT NULL,
  actor_id TEXT NOT NULL REFERENCES wdp_auth_users(id),
  before_json TEXT NOT NULL,
  after_json TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS wdp_registration_audit_order_idx ON wdp_registration_audit(order_id,created_at);
