CREATE TABLE IF NOT EXISTS wdp_order_prices (
  order_id TEXT PRIMARY KEY REFERENCES wdp_orders(id),
  prices_json TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
