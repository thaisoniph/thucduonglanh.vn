// 🏪 Thử kênh đại lý (api/src/daily.js) trên máy: node scripts/test-daily.mjs
// 25/11/2026: 🎁 thưởng quý (dưới trần giá vốn, trừ vào đơn quý sau), 🚀 3 tháng đầu lên 1 bậc, 🎯 mục tiêu quý, sửa đại lý không mất link.
// D1 giả bằng node:sqlite (schema.sql), Telegram + /dl-gia.json giả bằng fetch. Ngày giả: 25/11/2026 (tháng 2 của Quý 4).
import { DatabaseSync } from 'node:sqlite';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
const ROOT = fileURLToPath(new URL('..', import.meta.url)).replace(/\/$/, '');
const raw = new DatabaseSync(':memory:');
raw.exec(readFileSync(ROOT + '/api/schema.sql', 'utf8'));
for (const c of ['phone TEXT', 'full TEXT', 'acct TEXT']) { try { raw.exec('ALTER TABLE users ADD COLUMN ' + c); } catch (e) { } }
try { raw.exec('ALTER TABLE orders ADD COLUMN entered_at INTEGER'); } catch (e) { }
const DB = { prepare(sql) { const st = raw.prepare(sql); let a = []; const o = { bind(...x) { a = x.map(v => v === undefined ? null : typeof v === 'boolean' ? (v ? 1 : 0) : v); return o; },
  async all() { return { results: st.all(...a) }; }, async first() { return st.get(...a) || null; }, async run() { const r = st.run(...a); return { meta: { changes: r.changes } }; } }; return o; } };
const NOW = Date.parse('2026-11-25T10:00:00+07:00'), RealNow = Date.now; Date.now = () => NOW;
const T = s => Date.parse(s + 'T10:00:00+07:00');
const JR = o => new Response(JSON.stringify(o), { headers: { 'content-type': 'application/json' } });
const tg = [];
globalThis.fetch = async (url, init) => {
  const u = String(url);
  if (u.includes('api.telegram.org')) { tg.push(JSON.parse(init.body)); return JR({ ok: true }); }
  if (u.endsWith('/dl-gia.json')) return JR({ items: [{ id: 'xi-dau~0', name: 'Xì dầu', variant: '500ml', price: 100000 }, { id: 'dilvang~0', name: 'Trà DILVANG', variant: '30 gói', price: 200000 }] });
  throw new Error('fetch thật bị chặn: ' + u);
};
const kv = (k, v) => raw.prepare('INSERT OR REPLACE INTO kv (k, v) VALUES (?, ?)').run(k, JSON.stringify(v));
kv('cost_cfg', { items: [['Xì dầu 500ml', 64000]], oh: 0 }); // trần xì dầu = 100 − 64 − 25 = 11%
const A = '0911111111', B = '0922222222';
kv('dl_list', { [A]: { name: 'Tiệm chay An Nhiên', by: 'Lương', key: 'a'.repeat(24), at: T('2026-07-01') }, [B]: { name: 'Cửa hàng mới', key: 'b'.repeat(24), at: T('2026-11-20') } });
const ins = raw.prepare("INSERT INTO orders (id, phone, time, total, shipping, subtotal, status, seller) VALUES (?, ?, ?, ?, 0, ?, ?, 'Kênh đại lý')");
// Quý 3: A nhập 2 đơn đã giao, giá lẻ 20tr + 20tr = 40tr ≥ 15tr. Xì dầu đã ở trần 11% → room 0; DILVANG chưa có giá vốn → không giới hạn.
ins.run('DL1', A, T('2026-07-10'), 17800000, 17800000, 'Đã giao'); ins.run('DL2', A, T('2026-08-10'), 14000000, 14000000, 'Đã giao');
ins.run('DL3', A, T('2026-09-10'), 3000000, 3000000, 'Huỷ'); // huỷ: không tính
kv('dl_ord', { DL1: { ph: A, l: 20000000, p: 11, r: 0 }, DL2: { ph: A, l: 20000000, p: 30, r: 20000000 }, DL3: { ph: A, l: 4000000, p: 25 } });
raw.prepare("INSERT INTO users (email, name, role, active) VALUES ('l@x.vn', 'Lương', 'Sale & CSKH', 1)").run();

const later = [];
const x = { env: { DB, TELEGRAM_TOKEN: 't', TELEGRAM_CHAT_IDS: '-1', SITE_URL: 'https://site.test' }, db: DB, later: p => later.push(p), ip: '1.2.3.4' };
const D = await import('file://' + ROOT + '/api/src/daily.js');
let bad = 0; const ok = (c, m) => { console.log((c ? '✅ ' : '❌ ') + m); if (!c) bad++; };
const ql = { email: 't@x.vn', name: 'Thủy', role: 'Quản lý', level: 2 }, sale = { email: 'l@x.vn', name: 'Lương', role: 'Sale & CSKH', level: 1 };
const log = async () => {}, staff = ['Lương', 'Thủy'];

ok(D.qOf('2026-11') === '2026-Q4' && D.qShift('2026-Q1', -1) === '2025-Q4' && D.qShift('2026-Q4', 1) === '2027-Q1', 'Tính quý đúng (tháng 11 = Quý 4, lùi / tiến qua năm)');

// 🚀 ưu đãi 3 tháng đầu
let M = await D.dlMap(x);
ok(M[B].tier === 2 && M[B].pct === 35 && M[B].boost === 1, 'Đại lý mới (chưa nhập): bậc Đại lý 30% được hưởng bậc trên Đại lý Bạc 35% (thực tế ' + M[B].pct + '%)');
ok(M[A].tier === 1 && M[A].pct === 30 && !M[A].boost, 'Đại lý nhập từ tháng 7: hết 3 tháng đầu, tháng 10 không nhập → bậc 1 30%');

// 🎁 thưởng quý 3: 2% × (17,8tr xì dầu nhưng room 0 → 0) + 2% × 14tr = 280.000đ
ok(M[A].cr === 280000, 'Thưởng Quý 3 = 280.000đ (xì dầu đã sát trần nên không thưởng, đơn huỷ không tính), thực tế ' + M[A].cr);
ok(!M[B].cr, 'Đại lý mới chưa có thưởng quý');

// CRM lên đơn: giá lẻ 2 hộp DILVANG = 400.000 → giá đại lý 30% = 280.000 → trừ thưởng 280.000 = 0đ
let chk = await D.dlOrderCheck(x, sale, A, [{ name: 'Trà DILVANG', variant: '30 gói', price: 200000, qty: 10 }], 1120000, 0);
ok(chk && !chk.error && chk.cr === 280000 && /trừ thưởng Quý 3\/2026 280\.000/.test(chk.note), 'Sale thu 1.400.000 − 280.000 thưởng quý = 1.120.000 được lưu, ghi chú ghi rõ trừ thưởng');
let chk2 = await D.dlOrderCheck(x, sale, A, [{ name: 'Trà DILVANG', variant: '30 gói', price: 200000, qty: 10 }], 1000000, 0);
ok(chk2 && chk2.error && /trừ thưởng quý/.test(chk2.error), 'Sale thu thấp hơn cả sau khi trừ thưởng → chặn');
let chk3 = await D.dlOrderCheck(x, sale, A, [{ name: 'Trà DILVANG', variant: '30 gói', price: 200000, qty: 10 }], 1400000, 0);
ok(chk3 && !chk3.error && chk3.cr === 0, 'Sale thu đủ giá đại lý (không trừ thưởng) → thưởng quý vẫn còn nguyên');
ins.run('DL4', A, T('2026-11-25'), 1120000, 1120000, 'Đã xác nhận'); await D.dlOrderSave(x, 'DL4', A, chk);
M = await D.dlMap(x);
ok(M[A].cr === 0, 'Dùng hết thưởng quý → còn 0 (không dùng 2 lần)');
ok(chk.r === 4000000 * 0 + 2000000, 'Room của đơn DILVANG (chưa có giá vốn) = cả tiền hàng giá lẻ 2.000.000, thực tế ' + chk.r);
const chkX = await D.dlOrderCheck(x, ql, A, [{ name: 'Xì dầu', variant: '500ml', price: 100000, qty: 10 }], 890000, 0);
ok(chkX && !chkX.error && chkX.r === 0 && /−11%/.test(chkX.note), 'Xì dầu: chiết khấu 11% (trần giá vốn), room 0 → không có thưởng quý trên xì dầu');

// 🎯 mục tiêu quý
let r = await D.crmDaily(x, ql, { action: 'dl_goal', phone: A, v: 10000000 }, log, staff);
ok(!r.ok && /tối thiểu/.test(r.error), 'Mục tiêu dưới mức tối thiểu 15 triệu → chặn');
r = await D.crmDaily(x, ql, { action: 'dl_goal', phone: A, v: 20000000 }, log, staff);
let L = JSON.parse(raw.prepare("SELECT v FROM kv WHERE k = 'dl_list'").get().v);
ok(r.ok && L[A].goals && L[A].goals['2027-Q1'] === 20000000 && !L[A].goals['2026-Q4'], 'A đã nhập trong Quý 4, đăng ký ở tháng 2 của quý → mục tiêu áp Quý 1/2027 (không đăng ký muộn để ăn thêm 1%)');
r = await D.crmDaily(x, ql, { action: 'dl_goal', phone: B, v: 15000000 }, log, staff);
L = JSON.parse(raw.prepare("SELECT v FROM kv WHERE k = 'dl_list'").get().v);
ok(r.ok && L[B].goals['2026-Q4'] === 15000000, 'Đại lý mới chưa nhập trong quý → mục tiêu áp ngay Quý 4');
r = await D.crmDaily(x, ql, { action: 'dl_goal', phone: B, v: 30000000 }, log, staff);
ok(r.ok, 'Nâng mục tiêu được');
ins.run('DL5', B, T('2026-11-25'), 3500000, 3500000, 'Đã xác nhận'); await D.dlOrderSave(x, 'DL5', B, { list: 5000000, pct: 30, r: 5000000 });
r = await D.crmDaily(x, ql, { action: 'dl_goal', phone: B, v: 15000000 }, log, staff);
ok(!r.ok && /chỉ được nâng/.test(r.error), 'Sau tháng đầu của quý, đã nhập hàng → không được hạ mục tiêu');
ok(tg.some(t => /MỤC TIÊU QUÝ ĐẠI LÝ/.test(t.text)) || later.length > 0, 'Báo Telegram khi có mục tiêu quý');

// màn danh sách
let V = await D.crmDaily(x, ql, { action: 'dl_list' }, log, staff);
const vA = V.list.find(e => e.ph === A), vB = V.list.find(e => e.ph === B);
ok(vB.boost && vB.boost.base === 1 && vA.q && vA.q.name === 'Quý 4/2026', 'Màn đại lý: B có 🚀 (bậc thật 1), A có tiến độ Quý 4');
ok(vB.q.goal === 30000000 && vB.q.list === 5000000, 'Tiến độ quý của B: 5tr / mục tiêu 30tr');

// sửa đại lý: giữ link, mục tiêu
r = await D.crmDaily(x, ql, { action: 'dl_save', phone: A, name: 'Tiệm chay An Nhiên (mới)', area: 'Nam Định', by: 'Lương', fix: 0, note: '' }, log, staff);
L = JSON.parse(raw.prepare("SELECT v FROM kv WHERE k = 'dl_list'").get().v);
ok(L[A].key === 'a'.repeat(24) && L[A].goals['2027-Q1'] === 20000000 && L[A].name === 'Tiệm chay An Nhiên (mới)', 'Sửa đại lý không mất link đặt hàng và mục tiêu quý (lỗi cũ)');
r = await D.crmDaily(x, ql, { action: 'dl_kit', phone: B }, log, staff);
ok(r.list.find(e => e.ph === B).kit > 0, '🎁 Đánh dấu đã gửi bộ hàng mẫu');

// trang đặt hàng: thưởng quý tự trừ (thêm thưởng mới cho B: không có) → A đã dùng hết; thêm đại lý C có thưởng
kv('dl_list', Object.assign(L, { '0933333333': { name: 'C', key: 'c'.repeat(24), at: T('2026-06-01') } }));
ins.run('DL6', '0933333333', T('2026-08-01'), 14000000, 14000000, 'Đã giao'); ins.run('DL7', '0933333333', T('2026-09-01'), 14000000, 14000000, 'Mới');
const O = JSON.parse(raw.prepare("SELECT v FROM kv WHERE k = 'dl_ord'").get().v); O.DL6 = { ph: '0933333333', l: 20000000, p: 30 }; O.DL7 = { ph: '0933333333', l: 20000000, p: 30 }; kv('dl_ord', O);
const me = await D.dlMe(x, { key: 'c'.repeat(24) });
if (process.env.DUMP) { const fs = await import('node:fs'); fs.writeFileSync(process.env.DUMP + '/me.json', JSON.stringify(Object.assign({}, me, { items: [{ id: 'dilvang~0', name: 'Trà DILVANG', variant: '30 gói', img: '', price: 200000, pct: 30, dl: 140000 }, { id: 'xi-dau~0', name: 'Xì dầu', variant: '500ml', img: '', price: 100000, pct: 11, dl: 89000 }] }))); fs.writeFileSync(process.env.DUMP + '/list.json', JSON.stringify(await D.crmDaily(x, ql, { action: 'dl_list' }, log, staff))); }
ok(me.ok && me.credit && me.credit.bal === 280000, 'Trang đặt hàng: thưởng Quý 3 của C = 2% × 14tr (đơn Mới chưa chuyển tiền không tính) = 280.000, thực tế ' + (me.credit && me.credit.bal));
ok(me.quarter && me.quarter.qMin === 15000000 && me.quarter.goalQ === '2026-Q4', 'Trang đặt hàng có khối mục tiêu quý (C chưa nhập Quý 4 → đăng ký áp Quý 4)');
const saved = [];
const h = { saveOrder: async (xx, data, opt) => { saved.push({ data, opt }); raw.prepare("INSERT INTO orders (id, phone, time, total, shipping, subtotal, status, seller) VALUES (?, ?, ?, ?, 0, ?, 'Mới', 'Kênh đại lý')").run(data.id, data.customer.phone, NOW, data.total, data.subtotal); }, telegramUser: async () => {}, staff };
r = await D.dlOrderWeb(x, { key: 'c'.repeat(24), items: [{ id: 'dilvang~0', qty: 10 }], province: 'Hà Nội', address: '12 Lê Lợi' }, h);
ok(r.ok && r.cr === 280000 && r.total === 1400000 - 280000, 'Đại lý tự đặt 10 hộp: giá đại lý 1.400.000 − thưởng quý 280.000 = ' + r.total);
const sv = saved[0].data;
ok(sv.subtotal === 1120000 && sv.items.reduce((s, i) => s + i.subtotal, 0) === 1120000, 'Tiền từng dòng hàng khớp tổng sau khi trừ thưởng');
const me2 = await D.dlMe(x, { key: 'c'.repeat(24) });
ok(!me2.credit, 'Đặt xong: thưởng quý hết, không hiện nữa');
r = await D.dlGoalWeb(x, { key: 'c'.repeat(24), v: 20000000 });
ok(r.ok && r.q === '2027-Q1', 'Đại lý tự đăng ký mục tiêu trên trang đặt hàng (vừa nhập trong Quý 4 → áp Quý 1/2027)');

// cài đặt
r = await D.crmDaily(x, { name: 'Sơn', level: 3 }, { action: 'dl_cfg', tiers: [{ name: 'Đại lý', pct: 30, min: 0 }, { name: 'Đại lý Bạc', pct: 35, min: 15000000 }, { name: 'Nhà phân phối tỉnh', pct: 40, min: 50000000 }], first: 5000000, top3: 3, bonus: 3, bonusMonths: 3, qb: 3, qGoal: 1, qMin: 20000000, boost: 0 }, log, staff);
ok(r.ok && r.cfg.qb === 3 && r.cfg.qMin === 20000000 && r.cfg.boost === 0, 'Quản trị đổi mức thưởng quý / tắt ưu đãi 3 tháng đầu');
M = await D.dlMap(x);
ok(M[B].pct === 30 && !M[B].boost, 'Tắt ưu đãi → đại lý mới về đúng bậc 30%');
r = await D.crmDaily(x, { name: 'Sơn', level: 3 }, { action: 'dl_cfg', tiers: r.cfg.tiers, first: 5000000, top3: 3, bonus: 3, bonusMonths: 3, qb: 20 }, log, staff);
ok(!r.ok, 'Thưởng quý quá 10% → chặn');

Date.now = RealNow;
console.log(bad ? '\n❌ ' + bad + ' lỗi' : '\n✅ Tất cả đúng');
process.exit(bad ? 1 : 0);
