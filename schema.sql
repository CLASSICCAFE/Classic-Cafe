-- Classic Cafe D1 schema (safe to run in D1 console)
CREATE TABLE IF NOT EXISTS settings(key TEXT PRIMARY KEY,value TEXT NOT NULL,updated_at TEXT NOT NULL);
INSERT OR IGNORE INTO settings(key,value,updated_at) VALUES
('shop_open','true',datetime('now')),('website_orders','true',datetime('now')),('delivery_enabled','true',datetime('now')),('opening_time','11:00',datetime('now')),('closing_time','00:00',datetime('now')),('delivery_radius','5',datetime('now')),('delivery_rate','20',datetime('now')),('auto_assign_distance','2',datetime('now'));
CREATE TABLE IF NOT EXISTS orders(id TEXT PRIMARY KEY,created_at TEXT NOT NULL,customer_name TEXT NOT NULL,mobile TEXT NOT NULL,address TEXT NOT NULL,lat REAL,lng REAL,distance_km REAL DEFAULT 0,delivery_charge REAL DEFAULT 0,food_total REAL DEFAULT 0,grand_total REAL DEFAULT 0,payment_method TEXT DEFAULT 'COD_OR_UPI_TO_DELIVERY_BOY',payment_status TEXT DEFAULT 'UNPAID',status TEXT DEFAULT 'NEW',items_json TEXT DEFAULT '[]');
CREATE TABLE IF NOT EXISTS order_tracking(order_id TEXT PRIMARY KEY,tracking_token TEXT NOT NULL UNIQUE,lat REAL,lng REAL,updated_at TEXT);
CREATE TABLE IF NOT EXISTS menu_items(id TEXT PRIMARY KEY,name TEXT NOT NULL UNIQUE,category TEXT,available INTEGER DEFAULT 1,price REAL DEFAULT 0,discount_percent REAL DEFAULT 0,updated_at TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS admin_sessions(token TEXT PRIMARY KEY,expires_at TEXT NOT NULL,created_at TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS delivery_boys(id TEXT PRIMARY KEY,name TEXT NOT NULL,mobile TEXT,access_key TEXT UNIQUE NOT NULL,active INTEGER DEFAULT 1,created_at TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS delivery_assignments(order_id TEXT PRIMARY KEY,delivery_boy_id TEXT NOT NULL,assigned_at TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS delivery_otp_requests(id TEXT PRIMARY KEY,mobile TEXT NOT NULL,otp TEXT NOT NULL,delivery_boy_id TEXT,approved INTEGER DEFAULT 0,used INTEGER DEFAULT 0,expires_at TEXT NOT NULL,created_at TEXT NOT NULL);
CREATE INDEX IF NOT EXISTS idx_delivery_otp_mobile ON delivery_otp_requests(mobile);
CREATE TABLE IF NOT EXISTS delivery_sessions(token TEXT PRIMARY KEY,delivery_boy_id TEXT NOT NULL,expires_at TEXT NOT NULL,created_at TEXT NOT NULL);
