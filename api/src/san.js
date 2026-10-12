// Doanh thu sàn TMĐT (Shopee, TikTok Shop, Lazada) + mục tiêu tháng theo mảng của cả văn phòng.
// Đơn sàn không đi qua CRM: người phụ trách sàn xuất file đơn hàng trên Seller Center, CRM đọc file trên máy (crm/app.js parseSanFile) rồi gửi lên san_import.
//   Bảng san_orders: 1 dòng = 1 đơn sàn, khoá (shop, id). Nhập lại file mới → ghi đè trạng thái (huỷ / hoàn) của đơn cũ, nên doanh thu theo ngày đặt luôn đúng sau mỗi lần cập nhật.
//   Doanh thu đặt hàng (gmv) = tiền hàng theo giá shop bán (đã trừ giảm giá của shop trên sản phẩm, chưa trừ voucher / phí sàn). Đơn huỷ, hoàn: không tính; hoàn 1 phần: trừ refund.
//   Tiền thực về (net): ước tính từ cột phí trong file đơn (Shopee có), hoặc số thật từ file Thu nhập / Đối soát (net_real = 1, không bị file đơn ghi đè).
// Mục tiêu theo mảng: kv san_targets { 'yyyy-MM': { Sale, Website, Shopee, 'TikTok Shop', Lazada, Khác } }. Mục tiêu Sale để trống = tổng mục tiêu các nhân viên (bảng targets).
// Quyền: Quản trị + người có tên trong kv san_cfg.people (Quản trị chọn ở tab Sàn → ⚙️).
// Google Sheet báo cáo sàn (người phụ trách sàn gõ số mỗi ngày, 1 tab / sàn, 1 dòng / ngày): sanSheetSync đọc 30 phút/lần (cron) hoặc khi bấm 🔄,
//   mỗi ngày tách thành các "đơn" giả mã S:yyyy-MM-dd:n (đơn thường + đơn hoàn/huỷ, tiền chia đều) để số đơn / tỷ lệ huỷ / doanh thu tính chung với đơn từ file.
//   Ngày đã có file đơn hàng của sàn đó (san_files kind 'orders') thì bỏ dòng Sheet (file chi tiết hơn). Link Sheet: kv san_cfg.sheet (trống = SHEET_DEFAULT, '-' = tắt).
import { all, first, run, insertMany, kvJson, kvSet, kvDel, kvGet, randHex, nrm, md5hex, fmtDate } from './lib.js';
import { nameKey } from './crm.js';
import { sheetMeta, sheetBatchGet, a1 } from './google.js';

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
    targets: { [month]: tgs[month] || {}, [pm]: tgs[pm] || {} }, people: cfg.people || [], admin: u.level >= 3,
    sheet: { id: sheetIdOf(cfg), err: await kvGet(x.db, 'san_sheet_err') || '' }
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
  const days = rows.map(r => r.day).sort();
  await run(x.db, "DELETE FROM san_orders WHERE shop = ? AND id LIKE 'S:%' AND day BETWEEN ? AND ?", shop, days[0], days[days.length - 1]); // file đơn chi tiết thay số Sheet các ngày đó
  const gmv = rows.reduce((s, r) => s + (r.state === 'ok' ? r.gmv - r.refund : 0), 0), fresh = rows.filter(r => !known[r.id]).length;
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
  if (b[0] === 'o') { await run(x.db, 'DELETE FROM san_orders WHERE batch = ?', b); await kvDel(x.db, 'san_sheet_h'); } // lần đồng bộ Sheet sau lấy lại số các ngày đó
  else await run(x.db, 'UPDATE san_orders SET net = NULL, net_real = 0, ibatch = \'\' WHERE ibatch = ?', b);
  await run(x.db, 'DELETE FROM san_files WHERE batch = ?', b);
  return { ok: true };
}

/* ---------- Google Sheet báo cáo sàn */
export const SHEET_DEFAULT = '1ZAGIl4X31Yzcnps9zVoZ7ghZNLdW6tQi-U6xxJP_w_k'; // "BC KQKD Sàn TMĐT" của người phụ trách sàn (tab Shope)
// Doanh số trên Sheet đã gồm đơn hoàn/huỷ (như số "Đơn đã đặt" của Shopee) → doanh thu = Doanh số − Doanh số hoàn huỷ.
const SHEET_COL = { day: /^ngay$/, buyers: /nguoi mua/, n: /^so don( hang)?$/, qty: /so luong/, gmv: /^doanh so$/, cn: /don.*(hoan|huy)/, cv: /doanh so.*(hoan|huy)/ };
function sheetIdOf(c) { const v = String(c.sheet == null ? '' : c.sheet).trim(); if (v === '-') return ''; const m = v.match(/\/d\/([a-zA-Z0-9_-]{20,})/) || v.match(/^([a-zA-Z0-9_-]{25,})$/); return m ? m[1] : SHEET_DEFAULT; }
function tabShop(t) { const n = nrm(t); return /shop(e|ee)?\b|shopee/.test(n) && !/tik/.test(n) ? 'Shopee' : /tik ?tok/.test(n) ? 'TikTok Shop' : /lazada/.test(n) ? 'Lazada' : ''; }
function sheetDay(v) {
  if (typeof v === 'number' && v > 40000 && v < 60000) return fmtDate(Math.round((v - 25569) * 864e5 - 7 * 3600e3), 'yyyy-MM-dd'); // số sê-ri ngày
  const m = String(v == null ? '' : v).trim().match(/^(\d{1,2})[\/.-](\d{1,2})[\/.-](\d{4})$/);
  return m && +m[2] >= 1 && +m[2] <= 12 && +m[1] >= 1 && +m[1] <= 31 ? m[3] + '-' + m[2].padStart(2, '0') + '-' + m[1].padStart(2, '0') : '';
}
const cellNum = v => typeof v === 'number' ? v : Number(String(v == null ? '' : v).replace(/[^\d-]/g, '')) || 0;
/** Đọc 1 tab: dòng tiêu đề có ô "Ngày" (có thể lặp lại mỗi tháng), các dòng có ngày + số → {day: {n, cn, gmv, cv, qty}}. */
export function sheetParse(values) {
  let M = null; const out = {};
  for (const row of values) {
    const h = row.map(c => nrm(c).replace(/[^a-z0-9 ]/g, ' ').replace(/\s+/g, ' ').trim());
    if (h.some(c => SHEET_COL.day.test(c)) && h.some(c => SHEET_COL.gmv.test(c))) {
      M = {}; h.forEach((c, j) => { for (const k in SHEET_COL) if (M[k] == null && SHEET_COL[k].test(c)) M[k] = j; });
      continue;
    }
    if (!M || M.day == null) continue;
    const day = sheetDay(row[M.day]); if (!day) continue;
    const g = k => M[k] == null ? 0 : Math.max(0, Math.round(cellNum(row[M[k]])));
    const r = { n: g('n'), cn: g('cn'), gmv: g('gmv'), cv: g('cv'), qty: g('qty') };
    if (r.n || r.gmv) out[day] = r;
  }
  return out;
}
/** 1 ngày trên Sheet → các đơn giả: (n − cn) đơn tính doanh thu chia đều (Doanh số − hoàn huỷ), cn đơn huỷ chia đều tiền hoàn huỷ. */
function sheetOrders(shop, day, r, at) {
  const okG = Math.max(0, r.gmv - r.cv), nBad = r.cn, nOk = Math.max(r.n - r.cn, okG ? 1 : 0), qOk = Math.max(r.qty - nBad, 0), out = [];
  const split = (tot, k, i) => Math.floor(tot / k) + (i < tot % k ? 1 : 0);
  for (let i = 0; i < nOk; i++) out.push({ shop, id: 'S:' + day + ':' + (i + 1), day, status: 'Theo Google Sheet báo cáo', state: 'ok', gmv: split(okG, nOk, i), refund: 0, net: null, net_real: 0, qty: split(qOk, nOk, i), items: '[]', batch: 'sheet', at });
  for (let i = 0; i < nBad; i++) out.push({ shop, id: 'S:' + day + ':h' + (i + 1), day, status: 'Hoàn / huỷ (Google Sheet)', state: 'cancel', gmv: split(r.cv, nBad, i), refund: 0, net: null, net_real: 0, qty: 1, items: '[]', batch: 'sheet', at });
  return out;
}
/** Đọc Google Sheet báo cáo sàn, ghi lại những ngày thay đổi. force: bỏ qua so sánh (bấm 🔄). */
export async function sanSheetSync(x, force) {
  const c = await cfgOf(x), id = sheetIdOf(c); if (!id) return { ok: true, off: true };
  const meta = await sheetMeta(x.env, id);
  const tabs = (meta.sheets || []).map(s => s.properties.title).map(t => ({ t, shop: tabShop(t) })).filter(o => o.shop);
  if (!tabs.length) throw new Error('File "' + ((meta.properties || {}).title || '') + '" không có tab nào tên Shopee / TikTok / Lazada.');
  const vals = await sheetBatchGet(x.env, id, tabs.map(o => a1(o.t, 'A1:Z1200')));
  const st = (force ? null : await kvJson(x.db, 'san_sheet_h', null)) || {}, h1 = {}, now = Date.now(), res = [];
  const files = await all(x.db, "SELECT shop, d_from, d_to FROM san_files WHERE kind = 'orders'");
  for (let i = 0; i < tabs.length; i++) {
    const shop = tabs[i].shop, D = sheetParse(vals[i] || []);
    const fileDay = d => files.some(f => f.shop === shop && f.d_from <= d && d <= f.d_to); // ngày đã có file đơn chi tiết
    const days = Object.keys(D).filter(d => !fileDay(d)).sort(), rows = [], gone = [];
    days.forEach(d => { const k = shop + '|' + d, hv = md5hex(JSON.stringify(D[d])).slice(0, 8); h1[k] = hv; if (st[k] !== hv) rows.push(...sheetOrders(shop, d, D[d], now)), gone.push(d); });
    Object.keys(st).forEach(k => { const [s0, d] = k.split('|'); if (s0 === shop && !h1[k]) gone.push(d); }); // ngày bị xoá khỏi Sheet
    for (let j = 0; j < gone.length; j += 90) await run(x.db, "DELETE FROM san_orders WHERE shop = ? AND id LIKE 'S:%' AND day IN (SELECT value FROM json_each(?))", shop, JSON.stringify(gone.slice(j, j + 90)));
    await insertMany(x.db, 'san_orders', COLS, rows, UPSERT);
    const tot = days.reduce((a, d) => (a.n += D[d].n, a.g += Math.max(0, D[d].gmv - D[d].cv), a), { n: 0, g: 0 });
    await run(x.db, 'INSERT INTO san_files (batch, shop, kind, file, n, fresh, d_from, d_to, gmv, by_name, at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?) ON CONFLICT(batch) DO UPDATE SET file = excluded.file, n = excluded.n, fresh = excluded.fresh, d_from = excluded.d_from, d_to = excluded.d_to, gmv = excluded.gmv, at = excluded.at',
      'gs_' + SHOPS.indexOf(shop), shop, 'sheet', ((meta.properties || {}).title || 'Google Sheet') + ' · tab ' + tabs[i].t, tot.n, gone.length, days[0] || '', days[days.length - 1] || '', tot.g, 'Tự động từ Google Sheet', now);
    res.push({ shop, tab: tabs[i].t, days: days.length, changed: gone.length, from: days[0] || '', to: days[days.length - 1] || '', n: tot.n, gmv: tot.g });
  }
  await kvSet(x.db, 'san_sheet_h', JSON.stringify(h1)); await kvSet(x.db, 'san_sheet_last', String(now)); await kvDel(x.db, 'san_sheet_err');
  return { ok: true, id, title: (meta.properties || {}).title || '', tabs: res };
}
/** Cron: 30 phút 1 lần. Lỗi (chưa chia sẻ file…) ghi lại để tab Sàn báo. */
export async function sanSheetTick(x) {
  if (Date.now() - Number(await kvGet(x.db, 'san_sheet_last') || 0) < 28 * 60e3) return;
  await kvSet(x.db, 'san_sheet_last', String(Date.now()));
  try { await sanSheetSync(x, false); } catch (e) { await kvSet(x.db, 'san_sheet_err', String(e.message || e).slice(0, 300)); }
}
async function sanSheetCmd(x, u, d) {
  const c = await cfgOf(x);
  if (d.sheet != null) { // Quản trị đổi link Sheet
    if (u.level < 3) return { ok: false, error: 'Chỉ Quản trị đổi được link Sheet.' };
    const v = String(d.sheet).trim(); if (v && v !== '-' && !/\/d\/[a-zA-Z0-9_-]{20,}|^[a-zA-Z0-9_-]{25,}$/.test(v)) return { ok: false, error: 'Link Google Sheet chưa đúng.' };
    c.sheet = v; await kvSet(x.db, 'san_cfg', JSON.stringify(c)); await kvDel(x.db, 'san_sheet_h');
    if (!sheetIdOf(c)) { await run(x.db, "DELETE FROM san_orders WHERE id LIKE 'S:%'"); await run(x.db, "DELETE FROM san_files WHERE kind = 'sheet'"); return { ok: true, off: true }; }
  }
  try { return await sanSheetSync(x, true); }
  catch (e) { const m = String(e.message || e); await kvSet(x.db, 'san_sheet_err', m.slice(0, 300)); return { ok: false, error: /403|404|permission|not found/i.test(m) ? 'Máy chủ chưa mở được file Sheet. Nhờ người tạo file bấm Chia sẻ → thêm thaisoniph@gmail.com (Người xem). (' + m.slice(0, 120) + ')' : m }; }
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
    case 'san_sheet': return sanSheetCmd(x, u, d);
  }
  return { ok: false, error: 'Không rõ thao tác: ' + d.action };
}
