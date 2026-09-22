-- Drop existing tables if re-initialising
DROP TABLE IF EXISTS invoices;
DROP TABLE IF EXISTS services;
DROP TABLE IF EXISTS domains;
DROP TABLE IF EXISTS users;

-- 1. Users Table
CREATE TABLE users (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  email TEXT UNIQUE NOT NULL,
  phone TEXT,
  address TEXT,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- 2. Domains Table
CREATE TABLE domains (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  domain_name TEXT UNIQUE NOT NULL,
  status TEXT DEFAULT 'active', -- 'active', 'pending', 'expired'
  next_due_date DATE NOT NULL,
  auto_renew INTEGER DEFAULT 1, -- 1 = ON, 0 = OFF
  FOREIGN KEY (user_id) REFERENCES users(id)
);

-- 3. Services / Hosting Packages Table
CREATE TABLE services (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  package_name TEXT NOT NULL,
  associated_domain TEXT,
  price TEXT NOT NULL,
  billing_cycle TEXT NOT NULL, -- 'Monthly', 'Annually'
  next_due_date DATE NOT NULL,
  status TEXT DEFAULT 'active', -- 'active', 'pending'
  FOREIGN KEY (user_id) REFERENCES users(id)
);

-- 4. Invoices Table
CREATE TABLE invoices (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  invoice_number TEXT NOT NULL,
  invoice_date DATE NOT NULL,
  due_date DATE NOT NULL,
  total_amount TEXT NOT NULL,
  status TEXT DEFAULT 'unpaid', -- 'paid', 'unpaid'
  FOREIGN KEY (user_id) REFERENCES users(id)
);