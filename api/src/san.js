// Doanh thu sàn TMĐT (Shopee, TikTok Shop, Lazada) + mục tiêu tháng theo mảng của cả văn phòng.
// Đơn sàn không đi qua CRM: người phụ trách sàn xuất file đơn hàng trên Seller Center, CRM đọc file trên máy (crm/app.js parseSanFile) rồi gửi lên san_import.
//   Bảng san_orders: 1 dòng = 1 đơn sàn, khoá (shop, id). Nhập lại file mới → ghi đè trạng thái (huỷ / hoàn) của đơn cũ, nên doanh thu theo ngày đặt luôn đúng sau mỗi lần cập nhật.
//   Doanh thu đặt hàng (gmv) = tiền hàng theo giá shop bán (đã trừ giảm giá của shop trên sản phẩm, chưa trừ voucher / phí sàn). Đơn huỷ, hoàn: không tính; hoàn 1 phần: trừ refund.
//   Tiền thực về (net): ước tính từ cột phí trong file đơn (Shopee có), hoặc số thật từ file Thu nhập / Đối soát (net_real = 1, không bị file đơn ghi đè).
// Mục tiêu theo mảng: kv san_targets { 'yyyy-MM': { Sale, Website, Shopee, 'TikTok Shop', Lazada, Khác } }. Mục tiêu Sale để trống = tổng mục tiêu các nhân viên (bảng targets).
// Quyền: Quản trị + người có tên trong kv san_cfg.people (Quản trị chọn ở tab Sàn → ⚙️).
import { all, first, run, insertMany, kvJson, kvSet, randHex } from './lib.js';
import { nameKey } from './crm.js';

export const SHOPS = ['Shopee', 'TikTok Shop', 'Lazada'];
const GOAL_KEYS = ['Sale', 'Website', 'Shopee', 'TikTok Shop', 'Lazada', 'Khác'];
const STATES = ['ok', 'cancel', 'return', 'wait'];
const DAY_RE = /^\d{4}-\d\d-\d\d$/, MONTH_RE = /^\d{4}-\d\d$/;
const COLS = ['shop', 'id', 'day', 'status', 'state', 'gmv', 'refund', 'net', 'net_real', 'qty', 'items', 'batch', 'at'];
const UPSERT = 'ON CONFLICT(shop, id) DO UPDATE SET day = excluded.day, status = excluded.status, state = excluded.state, gmv = excluded.gmv, refund = excluded.refund, qty = excluded.qty, items = excluded.items, batch = excluded.batch, at = excluded.at, ' +
  'net = CASE WHEN san_orders.net_real = 1 THEN san_orders.net ELSE excluded.net END'; // số tiền về thật (file Thu nhập) giữ nguyên
const num = v => Math.max(0, Math.round(Number(v) || 0));

export async function sanSchema(db) {
  await run(db, `CREATE TABLE IF NOT EXISTS san_orders (
      shop TEXT NOT NULL, id TEXT NOT NULL, day TEXT NOT NULL, status TEXT DEFAULT '', state TEXT DEFAULT 'ok',
      gmv INTEGER DEFAULT 0, refund INTEGER DEFAULT 0, net INTEGER, net_real INTEGER DEFAULT 0, qty INTEGER DEFAULT 0, items TEXT DEFAULT '',
      batch TEXT DEFAULT '', ibatch TEXT DEFAULT '', at INTEGER, PRIMARY KEY (shop, id)
    )`);
  await run(db, 'CREATE INDEX IF NOT EXISTS san_orders_day ON san_orders(day)');
  await run(db, `CREATE TABLE IF NOT EXISTS san_files (batch TEXT PRIMARY KEY, shop TEXT, kind TEXT, file TEXT, n INTEGER DEFAULT 0, fresh INTEGER DEFAULT 0, d_from TEXT, d_to TEXT, gmv INTEGER DEFAULT 0, by_name TEXT, at INTEGER)`);
}

async function cfgOf(x) { return await kvJson(x.db, 'san_cfg', {}) || {}; }
/** Người được xem / tải file sàn: Quản trị, hoặc có tên trong danh sách phụ trách sàn. */
export async function sanAllowed(x, u) {
  if (u.level >= 3) return true;
  const k = nameKey(u.name); return ((await cfgOf(x)).people || []).some(n => nameKey(n) === k);
}

/** san: số liệu kỳ from–to (theo ngày × sàn), kỳ so sánh pf–pt, tháng đang xem mục tiêu (month), sản phẩm bán chạy, lần tải file gần nhất. */
async function sanLoad(x, u, d) {
  if (![d.from, d.to, d.pf, d.pt].every(s => DAY_RE.test(String(s || '')))) return { ok: false, error: 'Khoảng thời gian chưa đúng.' };
  const month = MONTH_RE.test(d.month || '') ? d.month : String(d.to).slice(0, 7), mf = month + '-01', mt = month + '-31';
  const AGG = "SUM(CASE WHEN state = 'ok' THEN gmv - refund ELSE 0 END) AS g, SUM(state = 'ok') AS n, SUM(state = 'cancel') AS c, SUM(state = 'return') AS r, COUNT(*) AS t, " +
    "SUM(CASE WHEN state = 'ok' AND net IS NOT NULL THEN net ELSE 0 END) AS nv, SUM(state = 'ok' AND net IS NOT NULL) AS nn, SUM(state = 'ok' AND net_real = 1) AS nr";
  const [days, prev, mon, items, files, tg, cfg, pdays] = await Promise.all([
    all(x.db, `SELECT day, shop, ${AGG} FROM san_orders WHERE day BETWEEN ? AND ? GROUP BY day, shop`, d.from, d.to),
    all(x.db, `SELECT shop, ${AGG} FROM san_orders WHERE day BETWEEN ? AND ? GROUP BY shop`, d.pf, d.pt),
    all(x.db, "SELECT shop, SUM(CASE WHEN state = 'ok' THEN gmv - refund ELSE 0 END) AS g FROM san_orders WHERE day BETWEEN ? AND ? GROUP BY shop", mf, mt),
    all(x.db, "SELECT shop, items FROM san_orders WHERE state = 'ok' AND day BETWEEN ? AND ? LIMIT 20000", d.from, d.to),
    all(x.db, "SELECT shop, kind, MAX(at) AS at, MAX(d_to) AS dt FROM san_files GROUP BY shop, kind"),
    kvJson(x.db, 'san_targets', {}), cfgOf(x),
    all(x.db, "SELECT day, SUM(CASE WHEN state = 'ok' THEN gmv - refund ELSE 0 END) AS g, SUM(state = 'ok') AS n FROM san_orders WHERE day BETWEEN ? AND ? GROUP BY day", d.pf, d.pt) // kỳ trước theo ngày: đường so sánh trên biểu đồ
  ]);
  const P = {}; // sản phẩm bán chạy: items = JSON [[tên, số lượng, tiền], …]
  items.forEach(r => { let a = []; try { a = JSON.parse(r.items || '[]'); } catch (e) { } a.forEach(i => { const k = r.shop + '|' + i[0], p = P[k] || (P[k] = [r.shop, i[0], 0, 0]); p[2] += Number(i[1]) || 0; p[3] += Number(i[2]) || 0; }); });
  const agg = r => [r.g || 0, r.n || 0, r.c || 0, r.r || 0, r.t || 0, r.nv || 0, r.nn || 0, r.nr || 0];
  const tgs = tg || {}, pm = prevMonth(month);
  return {
    ok: true, month, days: days.map(r => [r.day, r.shop].concat(agg(r))), prev: prev.map(r => [r.shop].concat(agg(r))), pdays: pdays.map(r => [r.day, r.g || 0, r.n || 0]), mon: mon.map(r => [r.shop, r.g || 0]),
    prods: Object.values(P).sort((a, b) => b[3] - a[3]).slice(0, 15), files: files.map(r => [r.shop, r.kind, r.at, r.dt]),
    targets: { [month]: tgs[month] || {}, [pm]: tgs[pm] || {} }, people: cfg.people || [], admin: u.level >= 3
  };
}
function prevMonth(m) { const y = +m.slice(0, 4), mo = +m.slice(5, 7); return mo === 1 ? (y - 1) + '-12' : y + '-' + String(mo - 1).padStart(2, '0'); }

/** san_import: kind 'orders' – các đơn đọc từ file đơn hàng; kind 'income' – [{id, net}] từ file Thu nhập / Đối soát (tiền thực về). */
async function sanImport(x, u, d) {
  const shop = SHOPS.indexOf(d.shop) >= 0 ? d.shop : '';
  if (!shop) return { ok: false, error: 'Chọn sàn (Shopee / TikTok Shop / Lazada).' };
  const batch = (d.kind === 'income' ? 'i' : 'o') + randHex(5), now = Date.now(), file = String(d.file || 'file').slice(0, 150);
  const ids = r => String(r.id || '').trim().slice(0, 60);
  if (d.kind === 'income') {
    const rows = (d.rows || []).filter(r => ids(r)).slice(0, 30000);
    if (!rows.length) return { ok: false, error: 'File không có dòng tiền về nào đọc được.' };
    const sql = 'UPDATE san_orders SET net = ?, net_real = 1, ibatch = ? WHERE shop = ? AND id = ?';
    let hit = 0;
    for (let i = 0; i < rows.length; i += 200) {
      const res = await x.db.batch(rows.slice(i, i + 200).map(r => x.db.prepare(sql).bind(Math.round(Number(r.net) || 0), batch, shop, ids(r))));
      res.forEach(r => { hit += (r.meta && r.meta.changes) || 0; });
    }
    await run(x.db, 'INSERT INTO san_files (batch, shop, kind, file, n, fresh, d_from, d_to, gmv, by_name, at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)', batch, shop, 'income', file, rows.length, hit, '', '', rows.reduce((s, r) => s + (Math.round(Number(r.net) || 0)), 0), u.name, now);
    return { ok: true, rows: rows.length, hit, miss: rows.length - hit };
  }
  const rows = (d.rows || []).filter(r => ids(r) && DAY_RE.test(r.day)).slice(0, 30000).map(r => ({
    shop, id: ids(r), day: r.day, status: String(r.status || '').slice(0, 80), state: STATES.indexOf(r.state) >= 0 ? r.state : 'ok',
    gmv: num(r.gmv), refund: num(r.refund), net: r.net == null || r.net === '' ? null : Math.round(Number(r.net) || 0), net_real: 0, qty: num(r.qty),
    items: JSON.stringify((r.items || []).slice(0, 20).map(i => [String(i[0] || '').slice(0, 120), num(i[1]), num(i[2])])), batch, at: now
  }));
  if (!rows.length) return { ok: false, error: 'File không có đơn nào đọc được (cần cột Mã đơn hàng và Ngày đặt hàng).' };
  const known = {}; // đơn đã có từ lần tải trước → để báo "mới / cập nhật"
  for (let i = 0; i < rows.length; i += 500) (await all(x.db, 'SELECT id FROM san_orders WHERE shop = ? AND id IN (SELECT value FROM json_each(?))', shop, JSON.stringify(rows.slice(i, i + 500).map(r => r.id)))).forEach(r => { known[r.id] = 1; });
  await insertMany(x.db, 'san_orders', COLS, rows, UPSERT);
  const days = rows.map(r => r.day).sort(), gmv = rows.reduce((s, r) => s + (r.state === 'ok' ? r.gmv - r.refund : 0), 0), fresh = rows.filter(r => !known[r.id]).length;
  await run(x.db, 'INSERT INTO san_files (batch, shop, kind, file, n, fresh, d_from, d_to, gmv, by_name, at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)', batch, shop, 'orders', file, rows.length, fresh, days[0], days[days.length - 1], gmv, u.name, now);
  return { ok: true, rows: rows.length, fresh, upd: rows.length - fresh, from: days[0], to: days[days.length - 1], gmv };
}

/** san_target: Quản trị đặt mục tiêu tháng từng mảng. Ô để trống = xoá mục tiêu mảng đó. */
async function sanTarget(x, u, d) {
  if (u.level < 3) return { ok: false, error: 'Chỉ Quản trị đặt được mục tiêu văn phòng.' };
  if (!MONTH_RE.test(d.month || '')) return { ok: false, error: 'Tháng chưa đúng.' };
  const all0 = await kvJson(x.db, 'san_targets', {}) || {}, t = {};
  GOAL_KEYS.forEach(k => { const v = num((d.goals || {})[k]); if (v) t[k] = v; });
  t._by = u.name; t._at = Date.now(); all0[d.month] = t;
  await kvSet(x.db, 'san_targets', JSON.stringify(all0));
  return { ok: true, goals: t };
}
/** san_people: Quản trị chọn người phụ trách sàn (được vào tab Sàn, tải file). */
async function sanPeople(x, u, d) {
  if (u.level < 3) return { ok: false, error: 'Chỉ Quản trị chọn được người phụ trách sàn.' };
  const c = await cfgOf(x); c.people = (d.people || []).map(s => String(s).trim()).filter(Boolean).slice(0, 20);
  await kvSet(x.db, 'san_cfg', JSON.stringify(c)); return { ok: true, people: c.people };
}
async function sanList(x) {
  const rows = await all(x.db, 'SELECT * FROM san_files ORDER BY at DESC LIMIT 60');
  return { ok: true, list: rows.map(r => ({ batch: r.batch, shop: r.shop, kind: r.kind, file: r.file, n: r.n, fresh: r.fresh, from: r.d_from, to: r.d_to, gmv: r.gmv, by: r.by_name, at: r.at })) };
}
/** Xoá 1 lần tải: file đơn → xoá các đơn mà lần tải gần nhất là file này; file thu nhập → bỏ số tiền về thật của file đó (về lại ước tính khi tải lại file đơn). */
async function sanDel(x, u, d) {
  const b = String(d.batch || '');
  if (!/^[oi][a-f0-9]{10}$/.test(b)) return { ok: false, error: 'Không rõ lần tải.' };
  if (b[0] === 'o') await run(x.db, 'DELETE FROM san_orders WHERE batch = ?', b);
  else await run(x.db, 'UPDATE san_orders SET net = NULL, net_real = 0, ibatch = \'\' WHERE ibatch = ?', b);
  await run(x.db, 'DELETE FROM san_files WHERE batch = ?', b);
  return { ok: true };
}

export async function crmSan(x, u, d) {
  if (!await sanAllowed(x, u)) return { ok: false, error: 'Bạn chưa được giao phụ trách sàn. Nhờ Quản trị thêm tên ở tab Sàn → ⚙️ Người phụ trách sàn.' };
  switch (d.action) {
    case 'san': return sanLoad(x, u, d);
    case 'san_import': return sanImport(x, u, d);
    case 'san_target': return sanTarget(x, u, d);
    case 'san_people': return sanPeople(x, u, d);
    case 'san_list': return sanList(x);
    case 'san_del': return sanDel(x, u, d);
  }
  return { ok: false, error: 'Không rõ thao tác: ' + d.action };
}
