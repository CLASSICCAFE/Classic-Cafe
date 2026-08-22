CREATE TABLE IF NOT EXISTS orders (
  id TEXT PRIMARY KEY,
  created_at TEXT NOT NULL,
  customer_name TEXT NOT NULL,
  mobile TEXT NOT NULL,
  address TEXT NOT NULL,
  lat REAL NOT NULL,
  lng REAL NOT NULL,
  distance_km REAL NOT NULL,
  delivery_charge INTEGER NOT NULL,
  food_total INTEGER NOT NULL,
  grand_total INTEGER NOT NULL,
  payment_method TEXT NOT NULL DEFAULT 'COD_OR_UPI_TO_DELIVERY_BOY',
  payment_status TEXT NOT NULL DEFAULT 'UNPAID',
  status TEXT NOT NULL DEFAULT 'NEW',
  items_json TEXT NOT NULL,
  notes TEXT DEFAULT ''
);
CREATE INDEX IF NOT EXISTS idx_orders_created_at ON orders(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_orders_status ON orders(status);


CREATE TABLE IF NOT EXISTS order_tracking (
  order_id TEXT PRIMARY KEY,
  tracking_token TEXT UNIQUE NOT NULL,
  lat REAL,
  lng REAL,
  updated_at TEXT,
  FOREIGN KEY(order_id) REFERENCES orders(id)
);
CREATE INDEX IF NOT EXISTS idx_tracking_token ON order_tracking(tracking_token);
