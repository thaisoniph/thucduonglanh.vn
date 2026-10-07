-- Cơ sở dữ liệu CRM Thực Dưỡng Lành (Cloudflare D1). Chạy lại nhiều lần không sao (IF NOT EXISTS).
-- Thời gian lưu dạng số mili giây (Date.now()).

CREATE TABLE IF NOT EXISTS orders (
  rid INTEGER PRIMARY KEY AUTOINCREMENT,
  id TEXT NOT NULL DEFAULT '', time INTEGER, name TEXT DEFAULT '', phone TEXT DEFAULT '', email TEXT DEFAULT '',
  province TEXT DEFAULT '', ward TEXT DEFAULT '', address TEXT DEFAULT '', items TEXT DEFAULT '',
  subtotal INTEGER DEFAULT 0, shipping INTEGER DEFAULT 0, total INTEGER DEFAULT 0, payment TEXT DEFAULT '', note TEXT DEFAULT '',
  status TEXT DEFAULT 'Mới', source TEXT DEFAULT '', first_source TEXT DEFAULT '', consent INTEGER DEFAULT 0, paid TEXT DEFAULT '',
  carrier TEXT DEFAULT '', tracking TEXT DEFAULT '', seller TEXT DEFAULT '', ca TEXT DEFAULT '', line TEXT DEFAULT '', ship TEXT DEFAULT ''
);
CREATE INDEX IF NOT EXISTS orders_id ON orders(id);
CREATE INDEX IF NOT EXISTS orders_phone ON orders(phone, time);
CREATE INDEX IF NOT EXISTS orders_time ON orders(time);
CREATE INDEX IF NOT EXISTS orders_seller ON orders(seller);
CREATE INDEX IF NOT EXISTS orders_status ON orders(status);

CREATE TABLE IF NOT EXISTS customers (
  phone TEXT PRIMARY KEY, name TEXT DEFAULT '', address TEXT DEFAULT '', province TEXT DEFAULT '', ward TEXT DEFAULT '',
  orders INTEGER DEFAULT 0, spent INTEGER DEFAULT 0, first INTEGER, last INTEGER, products TEXT DEFAULT '', runout INTEGER,
  consent INTEGER DEFAULT 0, source TEXT DEFAULT '', owner TEXT DEFAULT '', care_at INTEGER, care_result TEXT DEFAULT '',
  note TEXT DEFAULT '', callback INTEGER, flag TEXT DEFAULT '', tag TEXT DEFAULT '', last_status TEXT DEFAULT '', last_ca TEXT DEFAULT '',
  last_seller TEXT DEFAULT ''
);
CREATE INDEX IF NOT EXISTS customers_owner ON customers(owner);

CREATE TABLE IF NOT EXISTS leads (
  rid INTEGER PRIMARY KEY AUTOINCREMENT,
  id TEXT NOT NULL UNIQUE, time INTEGER, name TEXT DEFAULT '', phone TEXT DEFAULT '', channel TEXT DEFAULT '', interest TEXT DEFAULT '',
  status TEXT DEFAULT 'Mới hỏi', owner TEXT DEFAULT '', last_at INTEGER, callback INTEGER, reason TEXT DEFAULT '', note TEXT DEFAULT '',
  order_id TEXT DEFAULT '', by_name TEXT DEFAULT ''
);
CREATE INDEX IF NOT EXISTS leads_phone ON leads(phone);
CREATE INDEX IF NOT EXISTS leads_owner ON leads(owner);

CREATE TABLE IF NOT EXISTS logs (
  rid INTEGER PRIMARY KEY AUTOINCREMENT,
  time INTEGER, by_name TEXT DEFAULT '', what TEXT DEFAULT '', ref TEXT DEFAULT '', name TEXT DEFAULT '', result TEXT DEFAULT '', note TEXT DEFAULT ''
);
CREATE INDEX IF NOT EXISTS logs_by ON logs(by_name);
CREATE INDEX IF NOT EXISTS logs_ref ON logs(ref);

CREATE TABLE IF NOT EXISTS contacts (
  rid INTEGER PRIMARY KEY AUTOINCREMENT,
  time INTEGER, name TEXT DEFAULT '', phone TEXT DEFAULT '', email TEXT DEFAULT '', message TEXT DEFAULT '', page TEXT DEFAULT '',
  done INTEGER DEFAULT 0, note TEXT DEFAULT ''
);

CREATE TABLE IF NOT EXISTS users (
  email TEXT PRIMARY KEY, name TEXT DEFAULT '', role TEXT DEFAULT 'Nhân viên', active INTEGER DEFAULT 1, recv TEXT DEFAULT '',
  tg TEXT DEFAULT '', alias TEXT DEFAULT '', prefix TEXT DEFAULT '', ord INTEGER DEFAULT 0
);

CREATE TABLE IF NOT EXISTS targets (
  month TEXT, name TEXT, amount INTEGER DEFAULT 0, by_name TEXT DEFAULT '', at INTEGER, PRIMARY KEY (month, name)
);

CREATE TABLE IF NOT EXISTS cycles (rid INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT, variant TEXT DEFAULT '', days INTEGER, basis TEXT DEFAULT '');
CREATE TABLE IF NOT EXISTS templates (rid INTEGER PRIMARY KEY AUTOINCREMENT, when_txt TEXT DEFAULT '', purpose TEXT DEFAULT '', text TEXT DEFAULT '');

CREATE TABLE IF NOT EXISTS sources (
  rid INTEGER PRIMARY KEY AUTOINCREMENT,
  id TEXT NOT NULL UNIQUE, sale TEXT DEFAULT '', url TEXT DEFAULT '', file_name TEXT DEFAULT '', cfg TEXT DEFAULT '{}', last INTEGER, result TEXT DEFAULT ''
);

CREATE TABLE IF NOT EXISTS sessions (token TEXT PRIMARY KEY, email TEXT, exp INTEGER);
CREATE TABLE IF NOT EXISTS kv (k TEXT PRIMARY KEY, v TEXT, exp INTEGER);
