CREATE UNIQUE INDEX IF NOT EXISTS wdp_renewal_cycle_unique ON wdp_orders(customer_id,mode,json_extract(cart_json,'$.renewal.sourceOrderId'),json_extract(cart_json,'$.renewal.domain'),json_extract(cart_json,'$.renewal.expiresOn')) WHERE json_extract(cart_json,'$.kind')='renewal';
CREATE TABLE IF NOT EXISTS wdp_renewal_mail (
 id TEXT PRIMARY KEY, customer_id TEXT NOT NULL REFERENCES wdp_auth_users(id),
 mode TEXT NOT NULL CHECK(mode IN ('test','live')), payload_json TEXT NOT NULL,
 status TEXT NOT NULL DEFAULT 'pending', attempts INTEGER NOT NULL DEFAULT 0,
 lease_until INTEGER NOT NULL DEFAULT 0, lease_token TEXT, first_attempt_at INTEGER,
 next_attempt_at INTEGER NOT NULL DEFAULT 0, last_error TEXT, sent_at TEXT
);
