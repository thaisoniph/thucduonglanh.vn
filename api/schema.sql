-- Cơ sở dữ liệu CRM Thực Dưỡng Lành (Cloudflare D1). Chạy lại nhiều lần không sao (IF NOT EXISTS).
-- Thời gian lưu dạng số mili giây (Date.now()).

CREATE TABLE IF NOT EXISTS orders (
  rid INTEGER PRIMARY KEY AUTOINCREMENT,
  id TEXT NOT NULL DEFAULT '', time INTEGER, name TEXT DEFAULT '', phone TEXT DEFAULT '', email TEXT DEFAULT '',
  province TEXT DEFAULT '', ward TEXT DEFAULT '', address TEXT DEFAULT '', items TEXT DEFAULT '',
  subtotal INTEGER DEFAULT 0, shipping INTEGER DEFAULT 0, total INTEGER DEFAULT 0, payment TEXT DEFAULT '', note TEXT DEFAULT '',
  status TEXT DEFAULT 'Mới', source TEXT DEFAULT '', first_source TEXT DEFAULT '', consent INTEGER DEFAULT 0, paid TEXT DEFAULT '',
  carrier TEXT DEFAULT '', tracking TEXT DEFAULT '', seller TEXT DEFAULT '', ca TEXT DEFAULT '', line TEXT DEFAULT '', ship TEXT DEFAULT '',
  ship_at INTEGER, received_at INTEGER, otype TEXT DEFAULT '', oflag TEXT DEFAULT '', trk TEXT DEFAULT '', trk_at INTEGER, trk_code INTEGER DEFAULT 0, addr_old TEXT DEFAULT ''
);
CREATE INDEX IF NOT EXISTS orders_id ON orders(id);
CREATE INDEX IF NOT EXISTS orders_phone ON orders(phone, time);
CREATE INDEX IF NOT EXISTS orders_time ON orders(time);
CREATE INDEX IF NOT EXISTS orders_seller ON orders(seller);
CREATE INDEX IF NOT EXISTS orders_status ON orders(status);
CREATE INDEX IF NOT EXISTS orders_tracking ON orders(tracking);

CREATE TABLE IF NOT EXISTS customers (
  phone TEXT PRIMARY KEY, name TEXT DEFAULT '', address TEXT DEFAULT '', province TEXT DEFAULT '', ward TEXT DEFAULT '',
  orders INTEGER DEFAULT 0, spent INTEGER DEFAULT 0, first INTEGER, last INTEGER, products TEXT DEFAULT '', runout INTEGER,
  consent INTEGER DEFAULT 0, source TEXT DEFAULT '', owner TEXT DEFAULT '', care_at INTEGER, care_result TEXT DEFAULT '',
  note TEXT DEFAULT '', callback INTEGER, flag TEXT DEFAULT '', tag TEXT DEFAULT '', last_status TEXT DEFAULT '', last_ca TEXT DEFAULT '',
  last_seller TEXT DEFAULT '', addr_old TEXT DEFAULT ''
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
CREATE INDEX IF NOT EXISTS logs_time ON logs(time);

CREATE TABLE IF NOT EXISTS contacts (
  rid INTEGER PRIMARY KEY AUTOINCREMENT,
  time INTEGER, name TEXT DEFAULT '', phone TEXT DEFAULT '', email TEXT DEFAULT '', message TEXT DEFAULT '', page TEXT DEFAULT '',
  done INTEGER DEFAULT 0, note TEXT DEFAULT ''
);

CREATE TABLE IF NOT EXISTS users (
  email TEXT PRIMARY KEY, name TEXT DEFAULT '', role TEXT DEFAULT 'Nhân viên', active INTEGER DEFAULT 1, recv TEXT DEFAULT '',
  tg TEXT DEFAULT '', alias TEXT DEFAULT '', prefix TEXT DEFAULT '', ord INTEGER DEFAULT 0, web TEXT DEFAULT ''
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

CREATE TABLE IF NOT EXISTS perf (
  rid INTEGER PRIMARY KEY AUTOINCREMENT,
  time INTEGER, by_name TEXT DEFAULT '', role TEXT DEFAULT '', what TEXT DEFAULT '',
  total REAL, server REAL, data TEXT DEFAULT '', kb REAL, dev TEXT DEFAULT ''
);
CREATE INDEX IF NOT EXISTS perf_time ON perf(time);

CREATE TABLE IF NOT EXISTS usage (
  rid INTEGER PRIMARY KEY AUTOINCREMENT,
  day TEXT NOT NULL, email TEXT NOT NULL, name TEXT DEFAULT '',
  opens INTEGER DEFAULT 0, mins REAL DEFAULT 0, screens TEXT DEFAULT '', dev TEXT DEFAULT '',
  first_time INTEGER, last_time INTEGER,
  UNIQUE(day, email)
);
CREATE INDEX IF NOT EXISTS usage_day ON usage(day);

CREATE TABLE IF NOT EXISTS feedback (
  id TEXT PRIMARY KEY, time INTEGER, by_name TEXT DEFAULT '', email TEXT DEFAULT '',
  kind TEXT DEFAULT 'Góp ý', text TEXT DEFAULT '', route TEXT DEFAULT '', ua TEXT DEFAULT '',
  ver TEXT DEFAULT '', imgs TEXT DEFAULT '', status TEXT DEFAULT 'Mới', reply TEXT DEFAULT '',
  handler TEXT DEFAULT '', updated INTEGER
);
CREATE TABLE IF NOT EXISTS feedback_images (
  id TEXT NOT NULL, idx INTEGER NOT NULL, data TEXT NOT NULL,
  PRIMARY KEY (id, idx)
);

-- Khách trùng sale: số điện thoại có trong từng sheet file sale (cập nhật mỗi lần đồng bộ) + khách quản lý đã chốt người giữ
CREATE TABLE IF NOT EXISTS sale_phones (
  phone TEXT NOT NULL, src TEXT NOT NULL, sheet TEXT NOT NULL, sale TEXT DEFAULT '', last INTEGER, rows INTEGER DEFAULT 1,
  PRIMARY KEY (phone, src, sheet)
);
CREATE INDEX IF NOT EXISTS sale_phones_src ON sale_phones(src, sheet);
CREATE TABLE IF NOT EXISTS dup_done (phone TEXT PRIMARY KEY, owner TEXT DEFAULT '', sales TEXT DEFAULT '', by_name TEXT DEFAULT '', at INTEGER);

-- Chi phí quảng cáo theo ngày / kênh / tài khoản / chiến dịch (api/src/mkt.js). src: auto (Facebook API) | file (nhập file CSV) | manual (nhập tay, chia đều theo ngày)
CREATE TABLE IF NOT EXISTS ad_spend (
  day TEXT NOT NULL, channel TEXT NOT NULL, account TEXT NOT NULL DEFAULT '', campaign TEXT NOT NULL DEFAULT '',
  spend INTEGER DEFAULT 0, impressions INTEGER DEFAULT 0, clicks INTEGER DEFAULT 0, msgs INTEGER DEFAULT 0, leads INTEGER DEFAULT 0, purchases INTEGER DEFAULT 0,
  src TEXT DEFAULT '', batch TEXT DEFAULT '', note TEXT DEFAULT '', at INTEGER,
  PRIMARY KEY (day, channel, account, campaign)
);
CREATE INDEX IF NOT EXISTS ad_spend_batch ON ad_spend(batch);

-- Đổi người phụ trách trên CRM (trigger customers_owner_chg / leads_owner_chg, tạo trong ensureSchema) → ghi lại vào cột Trùng sale file số quảng cáo
CREATE TABLE IF NOT EXISTS owner_chg (id INTEGER PRIMARY KEY AUTOINCREMENT, phone TEXT, owner TEXT, at INTEGER);

-- Lượt quét mã QR / mở link ngắn thucduonglanh.vn/q/<mã>/ (data/links.json): 1 lượt / máy / ngày, không lưu thông tin khách
CREATE TABLE IF NOT EXISTS qr_hits (code TEXT NOT NULL, day TEXT NOT NULL, n INTEGER DEFAULT 0, PRIMARY KEY (code, day));

-- 📍 Link & mã QR (api/src/links.js, CRM tab 📍 Link & QR): mã không đổi / không xoá (đã in thì phải luôn chạy), active = 0 chỉ ẩn khỏi danh sách
CREATE TABLE IF NOT EXISTS links (code TEXT PRIMARY KEY, name TEXT NOT NULL, kind TEXT DEFAULT 'khac', dest TEXT DEFAULT '/', note TEXT DEFAULT '', active INTEGER DEFAULT 1, by_name TEXT DEFAULT '', at INTEGER, upd_by TEXT DEFAULT '', upd_at INTEGER);
-- 3 link đầu tiên (16/10/2026, chuyển từ data/links.json của /admin). OR IGNORE: không ghi đè chỗ đã sửa trong CRM
INSERT OR IGNORE INTO links (code, name, kind, dest, note, active, by_name, at) VALUES
  ('sk', 'Tờ rơi phát ở sự kiện', 'to-roi', 'https://thucduonglanh.vn/', 'Phát ở các chương trình offline (chương trình thầy Tư, hội chợ…). Xem từng sự kiện bằng cách chọn ngày diễn ra sự kiện trong CRM.', 1, 'Thái Sơn', 1792138276354),
  ('st', 'Standee mang đi sự kiện', 'standee', '/', 'Standee của công ty mang đi các chương trình offline.', 1, 'Thái Sơn', 1792138276354),
  ('goi', 'Tờ rơi gửi kèm đơn hàng', 'goi-hang', '/', 'Bỏ vào hộp khi đóng gói đơn (đơn sàn, đơn sale): kéo khách cũ về đặt lại trên web.', 1, 'Thái Sơn', 1792138276354);
-- chống đếm trùng lượt quét: 1 lượt / máy / mã / ngày (khoá = ngày:mã:băm IP+trình duyệt, xoá sau 2 ngày)
CREATE TABLE IF NOT EXISTS qr_seen (k TEXT PRIMARY KEY, day TEXT);
