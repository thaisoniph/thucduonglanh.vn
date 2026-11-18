// 📋 Thử Biểu mẫu Facebook → CRM + 📡 báo kết quả về Facebook (api/src/fblead.js) trên máy: node scripts/test-fblead.mjs
// D1 giả bằng node:sqlite (schema.sql), Facebook + Telegram giả bằng fetch. Không gọi dịch vụ thật.
import { DatabaseSync } from 'node:sqlite';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
const ROOT = fileURLToPath(new URL('..', import.meta.url)).replace(/\/$/, '');
const raw = new DatabaseSync(':memory:');
raw.exec(readFileSync(ROOT + '/api/schema.sql', 'utf8'));
for (const c of ['recv TEXT', 'alias TEXT', 'tg TEXT', 'ord INTEGER']) { try { raw.exec('ALTER TABLE users ADD COLUMN ' + c); } catch (e) { } }
for (const c of ['ref_phone TEXT', 'ref_name TEXT', 'own_at INTEGER', 'how TEXT']) { try { raw.exec('ALTER TABLE leads ADD COLUMN ' + c); } catch (e) { } }
raw.exec(`CREATE TABLE IF NOT EXISTS fp_pages (id TEXT PRIMARY KEY, name TEXT DEFAULT '', token TEXT DEFAULT '', active INTEGER DEFAULT 0, cfg TEXT DEFAULT '{}', at INTEGER, err TEXT DEFAULT '', last_ev INTEGER, on_at INTEGER);
CREATE TABLE IF NOT EXISTS phone_seen (phone TEXT PRIMARY KEY, at INTEGER, src TEXT);
INSERT INTO fp_pages (id, name, token) VALUES ('111', 'Thực Dưỡng Lành', 'PAGE_TOKEN');`);
const DB = { prepare(sql) { const st = raw.prepare(sql); let a = []; const o = { bind(...x) { a = x.map(v => v === undefined ? null : typeof v === 'boolean' ? (v ? 1 : 0) : v); return o; },
  async all() { return { results: st.all(...a) }; }, async first() { return st.get(...a) || null; }, async run() { const r = st.run(...a); return { meta: { changes: r.changes } }; } }; return o; } };
const now = Date.now(), DAY = 864e5;
raw.prepare("INSERT INTO users (email, name, role, active, recv, alias) VALUES (?, ?, ?, 1, 'Có', ?)").run('luong@x.vn', 'Lương', 'Sale & CSKH', 'Lương');
raw.prepare("INSERT INTO users (email, name, role, active, recv, alias) VALUES (?, ?, ?, 1, 'Có', ?)").run('chang@x.vn', 'Chang', 'Sale & CSKH', 'Chang');
raw.prepare("INSERT INTO kv (k, v) VALUES ('ads_tier', ?)").run(JSON.stringify({ at: now, people: { 'Lương': { g: 'A' }, 'Chang': { g: 'C' } } }));
raw.prepare("INSERT INTO kv (k, v) VALUES ('mkt_cfg', ?)").run(JSON.stringify({ fb: { token: 'ADS_TOKEN' } }));

const tg = [], capi = [], graphCalls = [];
let leadsData = [
  { id: '9001', created_time: new Date(now - 3600e3).toISOString(), campaign_name: '18/11 Form số - 45-65', ad_name: 'Reel không kham khổ', form_id: 'F1',
    field_data: [{ name: 'full_name', values: ['Nguyễn Văn A'] }, { name: 'phone_number', values: ['+84912345678'] }, { name: 'bạn_quan_tâm_điều_gì?', values: ['Tiêu hoá'] }] },
  { id: '9002', created_time: new Date(now - 1800e3).toISOString(), campaign_name: '18/11 Form số - 45-65', form_id: 'F1', field_data: [{ name: 'full_name', values: ['Sai Số'] }, { name: 'phone_number', values: ['12345'] }] }
];
const JR = o => new Response(JSON.stringify(o), { headers: { 'content-type': 'application/json' } });
globalThis.fetch = async (url, init) => {
  const u = String(url);
  if (u.includes('api.telegram.org')) { tg.push(JSON.parse(init.body)); return JR({ ok: true }); }
  if (u.startsWith('https://fb.test/')) {
    graphCalls.push(u);
    if (/\/events\?/.test(u)) { const b = JSON.parse(init.body); capi.push(...b.data); return JR({ events_received: b.data.length }); }
    if (/111\/leadgen_forms/.test(u)) { if (!u.includes('PAGE_TOKEN')) return JR({ error: { message: 'bad token' } }); return JR({ data: [{ id: 'F1', name: 'Nhận cẩm nang', status: 'ACTIVE' }] }); }
    if (/F1\/leads/.test(u)) return JR({ data: leadsData });
    const m = u.match(/fb\.test\/(\d+)\?fields/); if (m) return JR(leadsData.find(l => l.id === m[1]) || { error: { message: 'not found' } });
    return JR({});
  }
  throw new Error('fetch thật bị chặn: ' + u);
};
const later = [];
const x = { env: { DB, FB_GRAPH: 'https://fb.test/', TELEGRAM_TOKEN: 't', TELEGRAM_CHAT_IDS: '-1' }, db: DB, later: p => later.push(p) };
const F = await import('file://' + ROOT + '/api/src/fblead.js');
let bad = 0; const ok = (c, m) => { console.log((c ? '✅ ' : '❌ ') + m); if (!c) bad++; };
const admin = { email: 'thaisoniph@gmail.com', name: 'Thái Sơn', role: 'Quản trị', level: 3 }, mkt = { email: 'm@x.vn', name: 'Hà', role: 'Marketing', level: 0 };
const log = async () => {};

// 1) quét biểu mẫu
let r = await F.crmFl(x, admin, { action: 'fl_scan' }, log);
ok(r.ok && r.got === 2, 'Quét: lấy 2 khách từ 1 biểu mẫu (got=' + r.got + ', err=' + (r.error || '') + ')');
const L = raw.prepare("SELECT * FROM leads WHERE by_name = 'Form FB'").all();
ok(L.length === 1 && L[0].phone === '0912345678' && L[0].channel === 'Quảng cáo – Form FB', 'Số đúng vào Khách hỏi, kênh Quảng cáo – Form FB, số +84 đổi về 0912345678');
ok(L[0].owner === 'Lương', 'Tự chia cho sale nhóm A (Lương), thực tế: ' + L[0].owner);
ok(/Tiêu hoá/.test(L[0].note) && /Reel không kham khổ/.test(L[0].note), 'Ghi chú có câu trả lời của khách + tên mẫu quảng cáo');
const rows = JSON.parse(raw.prepare("SELECT v FROM kv WHERE k = 'ads_rows'").get().v);
ok(rows.length === 1 && rows[0][1] === '0912345678' && rows[0][2] === 'Lương', 'Thêm vào danh sách số quảng cáo (giá 1 số, số về cho sale tính được)');
ok(tg.some(t => /SỐ MỚI TỪ BIỂU MẪU/.test(t.text)) && tg.some(t => /số điện thoại không đúng/.test(t.text)), 'Telegram: báo số mới + cảnh báo số sai');
r = await F.crmFl(x, admin, { action: 'fl_scan' }, log);
ok(r.got === 0 && raw.prepare("SELECT count(*) n FROM fl_leads").get().n === 2, 'Quét lần 2 không tạo trùng');

// 2) webhook (khách mới thứ 3)
leadsData.push({ id: '9003', created_time: new Date().toISOString(), form_id: 'F1', field_data: [{ name: 'full_name', values: ['Trần B'] }, { name: 'phone_number', values: ['0987654321'] }] });
await F.flHook(x, { id: '111', name: 'Thực Dưỡng Lành', token: 'PAGE_TOKEN' }, { leadgen_id: '9003', form_id: 'F1' });
const L3 = raw.prepare("SELECT owner FROM leads WHERE phone = '0987654321'").get();
ok(L3 && L3.owner, 'Webhook: khách thứ 3 vào CRM ngay, giao cho ' + (L3 && L3.owner));

// 3) Marketing chỉ thấy số đã che
r = await F.crmFl(x, mkt, { action: 'fl_view' }, log);
ok(r.ok && r.list.length === 3 && r.list.every(l => (!l.phone || /\*\*\*/.test(l.phone)) && !l.name), 'Marketing xem được danh sách nhưng số bị che, không thấy tên khách');
ok((await F.crmFl(x, mkt, { action: 'fl_save', cfg: { on: true } }, log)).ok === false, 'Marketing không sửa được cài đặt');

// 4) báo về Facebook: sale gọi được số 1, khách mua; số 3 không nghe máy
raw.prepare("INSERT INTO logs (time, by_name, what, ref, name, result, note) VALUES (?, 'Lương', 'Tư vấn', '0912345678', 'A', 'Đã tư vấn, khách cân nhắc', '')").run(now - 600e3);
raw.prepare("INSERT INTO logs (time, by_name, what, ref, name, result, note) VALUES (?, 'Chang', 'Tư vấn', '0987654321', 'B', 'Không nghe máy', '')").run(now - 300e3);
raw.prepare("INSERT INTO orders (id, time, name, phone, total, status) VALUES ('DH1', ?, 'A', '0912345678', 1520000, 'Mới')").run(now - 60e3);
raw.prepare("INSERT INTO orders (id, time, name, phone, total, status) VALUES ('DH0', ?, 'Z', '0900000001', 900000, 'Mới')").run(now - 60e3); // khách không từ quảng cáo
r = await F.crmFl(x, admin, { action: 'fl_save', cfg: { on: true, split: 'auto', key: 'CAPI_TOKEN' } }, log);
ok(r.ok, 'Quản trị bật báo kết quả về Facebook, dán mã');
await F.flTick(x);
const ev = n => capi.filter(e => e.event_name === n);
ok(ev('Contacted').length === 1 && ev('Contacted')[0].user_data.lead_id === 9001 && ev('Contacted')[0].action_source === 'system_generated', 'Gửi "Contacted" cho số gọi được, kèm lead_id; số không nghe máy không gửi');
ok(ev('Purchase').length === 1 && ev('Purchase')[0].custom_data.value === 1520000 && ev('Purchase')[0].custom_data.currency === 'VND', 'Gửi "Purchase" 1.520.000đ cho khách từ biểu mẫu; khách không từ quảng cáo không gửi');
ok(capi.every(e => /^[0-9a-f]{64}$/.test(e.user_data.ph[0])) && !JSON.stringify(capi).includes('0912345678'), 'Số điện thoại đã băm SHA-256, không gửi số thật');
ok(graphCalls.some(u => /2205980853628210\/events\?access_token=CAPI_TOKEN/.test(u)), 'Gửi đúng Pixel 2205980853628210 bằng mã đã dán');
await F.flTick(x);
ok(capi.length === 2, 'Chạy lại không gửi trùng');
r = await F.crmFl(x, admin, { action: 'fl_view' }, log);
ok(r.cap.Purchase.n === 1 && r.cap.Contacted.n === 1 && r.cfg.tail === 'OKEN' && !JSON.stringify(r).includes('CAPI_TOKEN'), 'Màn hình: 1 số gọi được, 1 đơn; mã không gửi về trình duyệt');
r = await F.crmFl(x, admin, { action: 'fl_test' }, log);
ok(r.ok && r.received === 1, 'Nút Gửi thử: Facebook nhận 1 sự kiện');
await Promise.all(later);
console.log(bad ? '\n❌ ' + bad + ' lỗi' : '\n✅ Tất cả đều đúng');
process.exit(bad ? 1 : 0);
