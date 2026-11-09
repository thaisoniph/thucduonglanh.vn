// 📦 Kho hàng (06/11/2026, anh Sơn): số hàng còn từng sản phẩm, tự trừ khi đơn đi, tự báo người phụ trách kho khi cần đặt nhà cung cấp (NCC).
// Bảng:
//   kho_items  sản phẩm trong kho: tên (máy đọc loại + trọng lượng giống 💰 Giá vốn, để khớp tên trong đơn), đơn vị, số ngày NCC giao (lead),
//              số ngày dự phòng (safety), mỗi lần đặt đủ bán bao nhiêu ngày (cover), mức tối thiểu (min_qty), tên + SĐT NCC.
//   kho_moves  nhập hàng (in), xuất khác (out: quà tặng, đại lý, livestream, hàng mẫu, hỏng…), kiểm kho (count: qty = số đếm thật, sys = số máy tính lúc đó).
//   kho_po     lần đặt NCC: số lượng, ngày hẹn về (eta), open → done (đã nhập kho) / cancel.
//   kho_out    sổ hàng đi theo đơn, máy tự lập từ orders + san_orders (khoSync): 1 dòng = 1 đơn × 1 sản phẩm kho.
//              st: w = chờ gửi (Mới / Đã xác nhận), o = đã gửi (Đang giao / Đã giao / Đổi hàng / Đang chuyển hoàn), b = hoàn về kho (Hoàn).
//              out_at / back_at = lúc hàng đi / về (giữ nguyên khi đơn sửa sau đó). Đơn huỷ = xoá dòng.
// Số còn = số kiểm kho gần nhất + nhập − xuất khác − hàng theo đơn đi + hàng hoàn về (mọi thứ sau lần kiểm đó).
// Bán mỗi ngày = lấy số lớn hơn của (30 ngày, 14 ngày gần nhất): đơn đã gửi (không tính hoàn) + xuất khác (trừ hàng hỏng) → tháng bán chạy tự báo sớm hơn.
// Cần đặt khi (còn − chờ gửi + đang đặt) < bán/ngày × (ngày NCC giao + dự phòng), hoặc dưới mức tối thiểu, hoặc đã hết.
// Báo: ngay khi vừa chạm mức (cron 10 phút, khoTick) + 8h sáng (khoMorning) cho người tích 📦 Phụ trách kho; quá 1 buổi sáng chưa ghi "Đã đặt NCC" → báo Quản trị.
import { all, first, run, kvGet, kvSet, kvJson, nrm, esc, fmtDate, startOfDay, randHex, md5hex, dateOrBlank, allIn, DAY, CRM_URL } from './lib.js';
import { telegram, telegramTo } from './google.js';
import { crmUsers } from './crm.js';

const WIN = 130 * DAY; // đơn cũ hơn không ảnh hưởng số tồn (lần kiểm kho đầu tiên làm sau ngày bật tính năng)
const WAIT_DAYS = 21; // đơn "Mới / Đã xác nhận" quá 21 ngày không còn tính là đang giữ hàng
const KHO_URL = CRM_URL + '/#kho';
export const KHO_REASONS = ['Quà tặng', 'Đại lý / bán sỉ', 'Livestream / sự kiện', 'Hàng mẫu', 'Hàng hỏng / hết hạn', 'Khác'];
const BROKEN = /hỏng|hết hạn/i; // xuất vì hỏng không tính là bán

export async function khoSchema(db) {
  await run(db, `CREATE TABLE IF NOT EXISTS kho_items (id TEXT PRIMARY KEY, name TEXT NOT NULL, unit TEXT DEFAULT 'hộp', lead INTEGER DEFAULT 10, safety INTEGER DEFAULT 7,
    cover INTEGER DEFAULT 30, min_qty INTEGER DEFAULT 0, supplier TEXT DEFAULT '', note TEXT DEFAULT '', active INTEGER DEFAULT 1, ord INTEGER DEFAULT 0, by_name TEXT DEFAULT '', at INTEGER)`);
  await run(db, `CREATE TABLE IF NOT EXISTS kho_moves (id INTEGER PRIMARY KEY AUTOINCREMENT, item TEXT NOT NULL, kind TEXT NOT NULL, qty REAL NOT NULL, sys REAL,
    reason TEXT DEFAULT '', note TEXT DEFAULT '', po INTEGER, by_name TEXT DEFAULT '', at INTEGER NOT NULL, made INTEGER)`);
  await run(db, 'CREATE INDEX IF NOT EXISTS kho_moves_at ON kho_moves(at)');
  await run(db, `CREATE TABLE IF NOT EXISTS kho_po (id INTEGER PRIMARY KEY AUTOINCREMENT, item TEXT NOT NULL, qty REAL NOT NULL, eta INTEGER, note TEXT DEFAULT '',
    by_name TEXT DEFAULT '', at INTEGER, status TEXT DEFAULT 'open', got REAL DEFAULT 0, done_at INTEGER)`);
  await run(db, `CREATE TABLE IF NOT EXISTS kho_out (src TEXT NOT NULL, ref TEXT NOT NULL, item TEXT NOT NULL, units REAL NOT NULL, st TEXT NOT NULL,
    t0 INTEGER, out_at INTEGER, back_at INTEGER, PRIMARY KEY (src, ref, item))`);
  await run(db, 'CREATE INDEX IF NOT EXISTS kho_out_out ON kho_out(out_at)');
  await run(db, 'CREATE INDEX IF NOT EXISTS kho_out_back ON kho_out(back_at)');
  await run(db, 'CREATE INDEX IF NOT EXISTS kho_out_st ON kho_out(st, t0)');
  await run(db, 'CREATE INDEX IF NOT EXISTS san_orders_at ON san_orders(at)'); // khoSync chỉ đọc đơn sàn vừa nhập file
}

/* ================================================================ đọc tên hàng trong đơn */
// Loại sản phẩm: giống COST_FAM trong crm/app.js (💰 Giá vốn). Thêm dòng sản phẩm mới thì thêm ở cả 2 nơi.
const FAM = [[/progomax/, 'pgm'], [/curcumin/, 'cur'], [/fucoidan|gafo/, 'gafo'], [/bua an|\bdd\b|dinh duong vitagreen/, 'bua'], [/dilvang|che vang|dinh lang/, 'dil'], [/xi dau/, 'xd'], [/mam xoi/, 'mx'], [/dau xanh|rau ma/, 'dx'], [/ruoc|rong bien/, 'ruoc']];
/** Loại (f), trọng lượng (w, g hoặc ml) và số hộp trong 1 quy cách (m: Combo 3 → 3, Mua 3 tặng 1 → 4, 5 gói 25g → 5). Cùng công thức costKey (crm/app.js). */
export function khoKey(t) {
  const n = nrm(t); let f = null; FAM.some(r => { if (r[0].test(n)) { f = r[1]; return true; } return false; });
  let w = n.match(/(\d+)\s*(g|ml)\b/), m = 1; const a = n.match(/mua (\d+) tang (\d+)/), c = n.match(/combo (\d+)/), g = !/hop/.test(n) && n.match(/(\d+)\s*goi\s*[*x×]?\s*(25)\s*g/);
  if (a) m = +a[1] + +a[2]; else if (c) m = +c[1]; if (g) { m *= +g[1]; w = [0, g[2]]; }
  return { f, w: w ? +w[1] : 0, m };
}
/** Dòng hàng trong đơn CRM ("Tên (quy cách) x2 = 300.000 ₫", 🎁 quà tặng cũng tính) → [[tên kèm quy cách, số lượng]]. */
export function khoLines(items) {
  return String(items || '').split('\n').map(l => { const m = l.replace(/^🎁\s*/, '').match(/^(.*?) x(\d+) = /); return m && m[1].trim() ? [m[1].trim(), +m[2] || 1] : null; }).filter(Boolean);
}
function sanLines(items) { let a = []; try { a = JSON.parse(items || '[]'); } catch (e) { } return a.map(i => [String(i[0] || '').trim(), Number(i[1]) || 1]).filter(i => i[0]); }
const merge = arr => { const by = {}; arr.forEach(([id, u]) => { by[id] = (by[id] || 0) + u; }); return Object.keys(by).map(id => [id, by[id]]); };
/** Tên hàng → [[mã sản phẩm kho, số đơn vị cho 1 suất]]; [] = không trừ kho; null = máy chưa biết (hiện ở mục 🔗 Ghép tên hàng).
 *  Thứ tự: ghép tay (kho_map) → combo trên web (gồm nhiều sản phẩm) → tự đọc loại + trọng lượng. Không ghi trọng lượng → sản phẩm lớn nhất cùng loại (hộp chính). */
export function khoResolve(text, C, depth) {
  const key = nrm(text);
  if (C.map[key]) return C.map[key];
  const nm = key.replace(/\s*\(.*$/, '');
  if (!depth && C.combos[nm]) {
    const out = []; for (const [pt, q] of C.combos[nm]) { const r = khoResolve(pt, C, 1); if (!r) return null; r.forEach(([id, u]) => out.push([id, u * q])); }
    return merge(out);
  }
  const out = [];
  for (const part of String(text).split(/,\s+/)) {
    const x = part.match(/\sx(\d+)\s*$/), mul = x ? +x[1] : 1, k = khoKey(part.replace(/\sx\d+\s*$/, '')), list = k.f && C.byFam[k.f];
    if (!list) return null;
    const it = list.find(i => i.k.w === k.w) || (!k.w ? list.slice().sort((a, b) => b.k.w - a.k.w)[0] : null) || (list.length === 1 && !list[0].k.w ? list[0] : null);
    if (!it) return null;
    out.push([it.id, k.m * mul]);
  }
  return out.length ? merge(out) : null;
}
export async function khoItems(x) { return (await all(x.db, 'SELECT * FROM kho_items ORDER BY ord, rowid')).map(r => Object.assign(r, { lead: Number(r.lead) || 0, safety: Number(r.safety) || 0, cover: Number(r.cover) || 0, min_qty: Number(r.min_qty) || 0 })); }
async function khoCtx(x, items) {
  const map = await kvJson(x.db, 'kho_map', {}) || {}, combos = await kvJson(x.db, 'kho_combos', {}) || {}, act = items.filter(i => i.active), ok = {}, byFam = {};
  act.forEach(i => { ok[i.id] = 1; const k = khoKey(i.name); if (k.f) (byFam[k.f] = byFam[k.f] || []).push({ id: i.id, k }); });
  const m2 = {}; Object.keys(map).forEach(k => { const v = (map[k] || []).filter(c => ok[c[0]]); if (!(map[k] || []).length || v.length) m2[k] = v; }); // ghép tay vào sản phẩm đã xoá → coi như chưa ghép
  return { map: m2, combos, byFam, v: md5hex(JSON.stringify([act.map(i => [i.id, i.name]), m2, combos])).slice(0, 10) };
}

/* ================================================================ sổ hàng đi theo đơn */
/** Trạng thái đơn CRM → w / o / b / '' (không giữ hàng). */
function stOf(s, shipAt) {
  s = nrm(s);
  if (/chuyen hoan/.test(s)) return 'o';
  if (/hoan/.test(s)) return 'b';
  if (/huy/.test(s)) return '';
  if (/dang giao|da giao|doi hang|giao thanh cong|da nhan/.test(s)) return 'o';
  if (!s || /^moi|xac nhan|cho /.test(s)) return shipAt ? 'o' : 'w';
  return shipAt ? 'o' : '';
}
const SAN_ST = { ok: 'o', wait: 'w', return: 'b', cancel: '' };
/** Cập nhật kho_out theo đơn mới đổi (cột upd) + đơn sàn vừa nhập file. Đổi danh sách sản phẩm / ghép tên → tính lại toàn bộ (giữ ngày đi / về đã ghi).
 *  Trả số dòng đã đổi. Chưa có sản phẩm kho nào thì không làm gì. */
export async function khoSync(x, force) {
  const items = await khoItems(x); if (!items.some(i => i.active)) return -1;
  const C = await khoCtx(x, items), now = Date.now(), cur = await kvJson(x.db, 'kho_cur', null) || {}, LIM = 2000;
  const init = !cur.o, full = force || init || cur.v !== C.v || now - (cur.full || 0) > 3 * DAY; // 3 ngày tính lại 1 lần: dọn đơn đã xoá
  const curO = full ? ((await first(x.db, 'SELECT max(upd) AS m FROM orders')) || {}).m || 0 : 0, curS = full ? ((await first(x.db, 'SELECT max(at) AS m FROM san_orders')) || {}).m || 0 : 0;
  const ord = full ? await all(x.db, 'SELECT rid, time, items, status, ship_at, upd FROM orders WHERE time > ?', now - WIN)
    : await all(x.db, 'SELECT rid, time, items, status, ship_at, upd FROM orders WHERE upd > ? ORDER BY upd LIMIT ' + LIM, cur.o || 0);
  const san = full ? await all(x.db, "SELECT shop, id, day, state, items, at FROM san_orders WHERE day >= ? AND items NOT IN ('', '[]')", fmtDate(now - WIN, 'yyyy-MM-dd'))
    : await all(x.db, 'SELECT shop, id, day, state, items, at FROM san_orders WHERE at > ? ORDER BY at LIMIT ' + LIM, cur.s || 0);
  const want = []; // [src, ref, t0, st, shipAt, {mã sản phẩm kho: số đơn vị}]
  const unitsOf = (lines, C) => { const u = {}; lines.forEach(([t, q]) => { const r = khoResolve(t, C); if (r) r.forEach(([id, n]) => { u[id] = (u[id] || 0) + n * q; }); }); return u; };
  ord.forEach(o => {
    const t0 = Number(o.time) || Number(o.upd) || now; if (!full && t0 < now - WIN) return;
    const st = stOf(o.status, o.ship_at);
    want.push(['o', String(o.rid), t0, st, Number(o.ship_at) || 0, st ? unitsOf(khoLines(o.items), C) : {}, /da giao|doi hang|giao thanh cong|da nhan/.test(nrm(o.status))]);
  });
  san.forEach(o => {
    const t0 = dateOrBlank(o.day) || now, st = SAN_ST[o.state] === undefined ? 'o' : SAN_ST[o.state];
    want.push(['s', o.shop + '|' + o.id, t0, st, 0, st ? unitsOf(sanLines(o.items), C) : {}, true]);
  });
  const rows = full ? await all(x.db, 'SELECT * FROM kho_out') : [], old = {};
  if (!full) for (const src of ['o', 's']) { const refs = want.filter(w => w[0] === src).map(w => w[1]); if (refs.length) rows.push(...await allIn(x.db, "SELECT * FROM kho_out WHERE src = '" + src + "' AND ref IN (SELECT value FROM json_each(?))", refs)); }
  rows.forEach(r => { old[r.src + '|' + r.ref + '|' + r.item] = r; });
  const up = [], del = [], seen = {}, wantRef = {};
  want.forEach(([src, ref, t0, st, shipAt, u, done]) => {
    wantRef[src + '|' + ref] = 1;
    Object.keys(u).forEach(id => {
      const k = src + '|' + ref + '|' + id, e = old[k]; seen[k] = 1;
      // Lúc hàng đi khi máy chưa ghi: ngày bấm Đang giao (ship_at) nếu có; vừa thấy đơn chuyển từ "chờ gửi" sang gửi = lúc này;
      // đơn Đang giao mới đặt trong 3 ngày (lần cập nhật thường) = lúc này; còn lại (đã giao, đơn sàn, đơn cũ, tính lại sau khi ghép tên) = hôm sau ngày đặt.
      const guess = shipAt || (!init && e && e.st === 'w' ? now : !full && !done && now - t0 <= 3 * DAY ? now : Math.min(now, t0 + DAY));
      let r;
      if (st === 'w') r = { st: 'w', out_at: null, back_at: null };
      else if (st === 'o') r = { st: 'o', out_at: (e && e.out_at) || guess, back_at: null };
      else { const oa = (e && e.out_at) || guess; r = { st: 'b', out_at: oa, back_at: (e && e.back_at) || (e && e.st === 'o' ? now : oa) }; } // đang gửi → hoàn: về kho lúc này; chưa từng thấy đi thì coi như đi rồi về cùng lúc (không đổi số tồn)
      r = Object.assign({ src, ref, item: id, units: Math.round(u[id] * 100) / 100, t0 }, r);
      if (!e || e.units !== r.units || e.st !== r.st || e.t0 !== r.t0 || (e.out_at || null) !== r.out_at || (e.back_at || null) !== r.back_at) up.push(r);
    });
  });
  rows.forEach(r => {
    const k = r.src + '|' + r.ref + '|' + r.item; if (seen[k]) return;
    if (wantRef[r.src + '|' + r.ref] || (full && (r.t0 || 0) > now - WIN + DAY)) del.push([r.src, r.ref, r.item]); // đơn huỷ / bỏ sản phẩm / đơn đã xoá
  });
  const db = x.db, st = [];
  const UP = "INSERT INTO kho_out (src, ref, item, units, st, t0, out_at, back_at) SELECT json_extract(value,'$.src'), json_extract(value,'$.ref'), json_extract(value,'$.item'), json_extract(value,'$.units'), json_extract(value,'$.st'), json_extract(value,'$.t0'), json_extract(value,'$.out_at'), json_extract(value,'$.back_at') FROM json_each(?) WHERE true " +
    'ON CONFLICT(src, ref, item) DO UPDATE SET units = excluded.units, st = excluded.st, t0 = excluded.t0, out_at = excluded.out_at, back_at = excluded.back_at';
  for (let i = 0; i < up.length; i += 300) st.push(db.prepare(UP).bind(JSON.stringify(up.slice(i, i + 300))));
  for (let i = 0; i < del.length; i += 300) st.push(db.prepare("DELETE FROM kho_out WHERE rowid IN (SELECT o.rowid FROM kho_out o JOIN json_each(?) j ON o.src = json_extract(j.value,'$[0]') AND o.ref = json_extract(j.value,'$[1]') AND o.item = json_extract(j.value,'$[2]'))").bind(JSON.stringify(del.slice(i, i + 300))));
  for (let i = 0; i < st.length; i += 40) await db.batch(st.slice(i, i + 40));
  const mx = (arr, k, d) => arr.reduce((a, r) => Math.max(a, Number(r[k]) || 0), d || 0);
  const nc = full ? { o: Math.max(curO, cur.o || 0), s: Math.max(curS, cur.s || 0), v: C.v, full: now }
    : { o: mx(ord, 'upd', cur.o), s: mx(san, 'at', cur.s), v: C.v, full: ord.length >= LIM || san.length >= LIM ? 0 : cur.full }; // đổi hàng loạt (quá 2000 đơn) → lần sau tính lại toàn bộ
  if (JSON.stringify(nc) !== JSON.stringify(cur)) await kvSet(x.db, 'kho_cur', JSON.stringify(nc));
  if (full && Math.random() < 0.3) await run(x.db, 'DELETE FROM kho_out WHERE t0 < ?', now - 400 * DAY); // dọn sổ quá 13 tháng
  return up.length + del.length;
}

/* ================================================================ số tồn, mức báo */
const LV_TXT = { nobase: '⚪ Chưa đếm', out: '🔴 Hết hàng', urgent: '🔴 Sắp hết – đặt gấp', order: '🟠 Sắp hết – cần đặt', late: '🔴 Hàng về trễ hẹn', risk: '🟠 Có thể hết trước khi hàng về', wait: '⏳ Đang chờ hàng về', ok: '🟢 Đủ hàng' };
const r1 = n => Math.round((Number(n) || 0) * 10) / 10;
/** Tính cho từng sản phẩm đang dùng: còn, chờ gửi, đang đặt, bán / ngày, đủ bán bao nhiêu ngày, mức (lv), nên đặt bao nhiêu (sug). */
export async function khoStats(x, items) {
  items = items || (await khoItems(x)).filter(i => i.active);
  const now = Date.now(), t30 = now - 30 * DAY, t14 = now - 14 * DAY, today = startOfDay(now);
  const counts = await all(x.db, "SELECT item, qty, at FROM (SELECT item, qty, at, ROW_NUMBER() OVER (PARTITION BY item ORDER BY at DESC, id DESC) AS rn FROM kho_moves WHERE kind = 'count') WHERE rn = 1");
  const base = {}; counts.forEach(c => { base[c.item] = { qty: Number(c.qty) || 0, at: Number(c.at) || 0 }; });
  const minB = Math.min(t30, ...Object.values(base).map(b => b.at));
  const [moves, outs, backs, pend, pos] = await Promise.all([
    all(x.db, "SELECT item, kind, qty, reason, at FROM kho_moves WHERE kind != 'count' AND at > ?", minB),
    all(x.db, "SELECT item, units, st, out_at FROM kho_out WHERE out_at > ? AND st IN ('o', 'b')", minB),
    all(x.db, 'SELECT item, units, back_at FROM kho_out WHERE back_at > ?', minB),
    all(x.db, "SELECT item, src, units, t0 FROM kho_out WHERE st = 'w' AND t0 > ?", now - WAIT_DAYS * DAY),
    all(x.db, "SELECT * FROM kho_po WHERE status = 'open' ORDER BY eta, id")]);
  return items.map(it => {
    const b = base[it.id], s = { id: it.id, name: it.name, unit: it.unit || 'hộp', lead: it.lead, safety: it.safety, cover: it.cover, min: it.min_qty, supplier: it.supplier || '', note: it.note || '' };
    let have = b ? b.qty : null, u30 = 0, u14 = 0, other30 = 0;
    moves.forEach(m => { if (m.item !== it.id) return; const q = Number(m.qty) || 0; if (b && m.at > b.at) have += m.kind === 'in' ? q : -q; if (m.kind === 'out' && !BROKEN.test(m.reason || '') && m.at > t30) { other30 += q; if (m.at > t14) u14 += q; } });
    outs.forEach(o => { if (o.item !== it.id) return; const q = Number(o.units) || 0; if (b && o.out_at > b.at) have -= q; if (o.st === 'o' && o.out_at > t30) { u30 += q; if (o.out_at > t14) u14 += q; } });
    backs.forEach(o => { if (o.item === it.id && b && o.back_at > b.at) have += Number(o.units) || 0; });
    u30 += other30;
    const wait = pend.filter(p => p.item === it.id && (p.src !== 's' || p.t0 > now - 7 * DAY)).reduce((a, p) => a + (Number(p.units) || 0), 0);
    const open = pos.filter(p => p.item === it.id).map(p => ({ id: p.id, qty: r1(p.qty), got: r1(p.got), left: r1(Math.max(0, p.qty - (p.got || 0))), eta: p.eta || null, at: p.at, by: p.by_name || '', note: p.note || '', late: !!(p.eta && p.eta < today) }));
    const onOrder = open.reduce((a, p) => a + p.left, 0), rate = Math.max(u30 / 30, u14 / 14), avail = have === null ? null : have - wait, position = avail === null ? null : avail + onOrder;
    const rp = rate * (it.lead + it.safety), left = avail !== null && rate > 0 ? Math.max(0, Math.floor(avail / rate)) : null;
    const need = avail !== null && ((rate > 0 && position < rp) || (it.min_qty > 0 && position < it.min_qty) || (avail <= 0 && (rate > 0 || it.min_qty > 0) && !onOrder));
    const eta = open.reduce((a, p) => p.eta && (!a || p.eta < a) ? p.eta : a, 0), late = open.some(p => p.late);
    let lv;
    if (have === null) lv = 'nobase';
    else if (avail <= 0) lv = 'out';
    else if (need && !open.length) lv = rate > 0 && avail / rate < it.lead ? 'urgent' : 'order';
    else if (need) lv = 'order';
    else if (late) lv = 'late';
    else if (open.length && rate > 0 && eta && avail / rate < (eta - today) / DAY) lv = 'risk';
    else if (open.length) lv = 'wait';
    else lv = 'ok';
    const target = Math.max(rate * (it.lead + it.safety + it.cover), it.min_qty), sug = position === null ? 0 : Math.max(0, Math.ceil(target - position));
    return Object.assign(s, { have: have === null ? null : r1(have), wait: r1(wait), avail: avail === null ? null : r1(avail), onOrder: r1(onOrder), rate: Math.round(rate * 100) / 100, sold30: r1(u30), left, lv, lvTxt: LV_TXT[lv], need, act: need, late, eta: eta || null, sug: need ? Math.max(1, sug) : sug, open, countAt: b ? b.at : null, short: need && open.length > 0 });
  });
}

/* ================================================================ báo Telegram */
const nf = n => String(r1(n)).replace(/\B(?=(\d{3})+(?!\d))/g, '.').replace(/\.(\d)$/, ',$1');
const dm = t => fmtDate(t, 'dd/MM');
function khoLine(s, withSug) {
  const nm = '<b>' + esc(s.name) + '</b>', u = ' ' + esc(s.unit);
  const have = s.avail === null ? 'chưa đếm' : s.avail <= 0 ? '<b>đã hết</b>' + (s.wait ? ' (còn ' + nf(s.wait) + u + ' đơn chờ gửi chưa có hàng)' : '') : 'còn ' + nf(s.avail) + u + (s.wait ? ' (đã trừ ' + nf(s.wait) + ' chờ gửi)' : '');
  const days = s.left !== null && s.avail > 0 ? ' · đủ bán ~' + s.left + ' ngày' : '';
  const po = s.open.length ? ' · đã đặt ' + nf(s.onOrder) + u + (s.eta ? ', hẹn về ' + dm(s.eta) : '') + (s.late ? ' <b>(trễ hẹn)</b>' : '') : '';
  const sug = withSug && s.need ? '\n   → nhà cung cấp giao mất ~' + s.lead + ' ngày, nên đặt <b>' + nf(s.sug) + u + '</b>' + (s.short ? ' nữa' : '') + (s.supplier ? ' · ' + esc(s.supplier) : '') : '';
  return '• ' + nm + ': ' + have + days + po + sug;
}
async function khoPeople(x) {
  const us = (await crmUsers(x)).filter(u => u.active);
  return { staff: us.filter(u => u.kho), admins: us.filter(u => u.level >= 3 && u.tg) };
}
/** Gửi cho người phụ trách kho (đã nối Telegram); chưa ai nối thì gửi nhóm Telegram để không lỡ. Trả true nếu đã gửi riêng được. */
async function toStaff(x, P, text) {
  const tg = P.staff.filter(u => u.tg);
  if (!tg.length) { await telegram(x.env, text + (P.staff.length ? '' : '\n\n<i>Chưa ai được tích 📦 Phụ trách kho ở CRM → Cài đặt → Nhân sự.</i>')); return false; }
  for (const u of tg) await telegramTo(x.env, u.tg, text);
  return true;
}
const vnH = t => new Date(t + 7 * 3600e3).getUTCHours();
/** Tính lại số tồn, lưu tóm tắt (kho_sum cho Tổng quan), báo ngay sản phẩm vừa chạm mức cần đặt (1 lần / đợt, 7h–21h). */
export async function khoCheck(x, opt) {
  opt = opt || {};
  const items = (await khoItems(x)).filter(i => i.active), now = Date.now();
  if (!items.length) { await kvSet(x.db, 'kho_sum', JSON.stringify({ n: 0, at: now })); return { list: [], A: {} }; }
  const list = await khoStats(x, items), cnt = k => list.filter(s => s.lv === k).length;
  const sum = { n: list.length, need: list.filter(s => s.act).length, out: cnt('out'), late: list.filter(s => s.late).length, nobase: cnt('nobase'), at: now,
    top: list.filter(s => s.act || s.late || s.lv === 'out').slice(0, 5).map(s => [s.name, s.lv, s.left, s.unit]) };
  await kvSet(x.db, 'kho_sum', JSON.stringify(sum));
  const A0 = await kvJson(x.db, 'kho_alert', {}) || {}, A = {}, fresh = [];
  list.forEach(s => { if (s.act) { A[s.id] = A0[s.id] || { since: now }; if (!A0[s.id]) fresh.push(s); } });
  if (fresh.length && opt.notify !== false && vnH(now) >= 7 && vnH(now) < 21) {
    const P = await khoPeople(x), who = P.staff.map(u => u.name).join(', ');
    const msg = '📦 <b>SẮP HẾT HÀNG – cần đặt nhà cung cấp</b>\n' + fresh.map(s => khoLine(s, true)).join('\n') + '\n\n👉 Đặt xong, vào CRM → Kho bấm <b>✅ Tôi đã đặt hàng</b> để máy thôi nhắc: ' + KHO_URL;
    const solo = await toStaff(x, P, msg);
    if (solo) await telegram(x.env, '📦 <b>Kho sắp hết</b>: ' + fresh.map(s => esc(s.name) + (s.left !== null && s.avail > 0 ? ' (~' + s.left + ' ngày)' : ' (hết)')).join(', ') + (who ? '\n👤 Đã báo ' + esc(who) + ' đặt thêm hàng' : ''));
    fresh.forEach(s => { A[s.id].sent = now; });
  }
  if (JSON.stringify(A) !== JSON.stringify(A0)) await kvSet(x.db, 'kho_alert', JSON.stringify(A));
  return { list, A, sum };
}
/** 10 phút / lần (cron): cập nhật sổ hàng theo đơn mới; có thay đổi thì tính lại và báo ngay nếu vừa chạm mức. */
export async function khoTick(x) {
  const n = await khoSync(x); if (n < 0) return; // chưa có sản phẩm kho
  const last = Number(await kvGet(x.db, 'kho_chk') || 0);
  if (n || Date.now() - last > 3 * 3600e3) { await kvSet(x.db, 'kho_chk', String(Date.now())); await khoCheck(x, {}); }
}
/** 8h sáng: tin kho cho người phụ trách (cần đặt, hàng trễ, thứ 6 kiểm kho, tên hàng chưa ghép), tóm tắt vào nhóm, và báo Quản trị việc bị bỏ quên. */
export async function khoMorning(x) {
  const items = (await khoItems(x)).filter(i => i.active); if (!items.length) return null;
  try { await khoSync(x); } catch (e) { console.error('khoSync', e.message); }
  const { list, A } = await khoCheck(x, { notify: false }), now = Date.now(), cfg = await kvJson(x.db, 'kho_cfg', {}) || {};
  const P = await khoPeople(x), who = P.staff.map(u => u.name).join(', ') || 'người phụ trách kho';
  const wd = new Date(now + 7 * 3600e3).getUTCDay(), cday = cfg.countDay === undefined ? 5 : Number(cfg.countDay);
  const act = list.filter(s => s.act), late = list.filter(s => s.late && !s.act), risk = list.filter(s => s.lv === 'risk'), outW = list.filter(s => s.lv === 'out' && !s.act), nob = list.filter(s => s.lv === 'nobase');
  let unm = 0; try { unm = (await khoNames(x, await khoCtx(x, items), 14)).filter(r => !r.to).length; } catch (e) { }
  const parts = [];
  if (act.length) parts.push('<b>🛒 Cần đặt thêm hàng (' + act.length + ')</b>\n' + act.map(s => khoLine(s, true) + (A[s.id] && now - A[s.id].since > 20 * 3600e3 ? '\n   ⚠️ Đã báo từ ' + fmtDate(A[s.id].since, 'HH:mm dd/MM') + ', chưa ghi đặt hàng' : '')).join('\n'));
  if (outW.length) parts.push('<b>🔴 Đang hết, chờ hàng về</b>\n' + outW.map(s => khoLine(s)).join('\n'));
  if (late.length) parts.push('<b>⏰ Hàng về trễ hẹn – gọi giục nhà cung cấp (' + late.length + ')</b>\n' + late.map(s => khoLine(s)).join('\n'));
  if (risk.length) parts.push('<b>🟠 Có thể hết trước khi hàng về</b>\n' + risk.map(s => khoLine(s)).join('\n'));
  if (nob.length) parts.push('⚪ ' + nob.length + ' sản phẩm chưa đếm: ' + nob.map(s => esc(s.name)).join(', ') + '. Đếm rồi bấm 🧮 Đếm kho.');
  if (unm) parts.push('❓ ' + unm + ' tên hàng trong đơn 14 ngày qua máy chưa biết là sản phẩm nào → vào Kho, bấm vào dòng ❓ để chỉ cho máy.');
  try { const rt = await first(x.db, "SELECT count(*) AS n FROM orders WHERE status = 'Đang chuyển hoàn'"); if (rt && rt.n) parts.push('↩ <b>' + rt.n + ' đơn hoàn đang trên đường về kho.</b> Gói hàng hoàn về: mở hàng kiểm đủ chưa, rồi vào Kho → ↩ Hàng hoàn bấm 📦 Đã nhận hàng.'); } catch (e) { }
  if (wd === cday) parts.push('🧮 <b>Hôm nay ' + (cday === 0 ? 'chủ nhật' : 'thứ ' + (cday + 1)) + ': đếm kho cuối tuần.</b> Đếm từng sản phẩm, vào CRM → Kho bấm 🧮 Đếm kho. Máy tự sửa phần lệch.');
  if (parts.length) await toStaff(x, P, '📦 <b>Kho sáng ' + dm(now) + '</b>\n\n' + parts.join('\n\n') + '\n\n👉 ' + KHO_URL);
  if (P.staff.some(u => u.tg) && (act.length || late.length || outW.length)) await telegram(x.env, '📦 <b>Kho hôm nay</b>' + (act.length ? '\n🛒 Cần đặt: ' + act.map(s => esc(s.name) + (s.avail > 0 && s.left !== null ? ' (~' + s.left + ' ngày)' : ' (hết)')).join(', ') : '') + (outW.length ? '\n🔴 Đang hết: ' + outW.map(s => esc(s.name)).join(', ') : '') + (late.length ? '\n⏰ Hàng về trễ: ' + late.map(s => esc(s.name)).join(', ') : '') + '\n👤 ' + esc(who) + ' phụ trách');
  // Quản trị: việc bị bỏ quên
  const esc1 = act.filter(s => A[s.id] && now - A[s.id].since > 20 * 3600e3 && !s.open.length), late2 = list.filter(s => s.late), oldCnt = list.filter(s => s.countAt && now - s.countAt > 10 * DAY);
  const ap = [];
  if (esc1.length) ap.push('<b>⚠️ Đã báo ' + esc(who) + ' nhưng chưa ghi đã đặt hàng</b>\n' + esc1.map(s => khoLine(s, true) + '\n   (báo từ ' + fmtDate(A[s.id].since, 'HH:mm dd/MM') + ')').join('\n'));
  if (late2.length) ap.push('<b>⏰ Hàng về trễ hẹn</b>\n' + late2.map(s => '• ' + esc(s.name) + ': hẹn ' + (s.eta ? dm(s.eta) : '?') + (s.supplier ? ' · ' + esc(s.supplier) : '')).join('\n'));
  if (oldCnt.length) ap.push('🧮 Quá 10 ngày chưa kiểm kho: ' + oldCnt.map(s => esc(s.name) + ' (lần cuối ' + dm(s.countAt) + ')').join(', '));
  if (ap.length) for (const u of P.admins) await telegramTo(x.env, u.tg, '📦 <b>Kho – cần anh/chị để ý</b>\n\n' + ap.join('\n\n') + '\n\n👉 ' + KHO_URL);
  return { act: act.length, late: late2.length };
}

/* ================================================================ CRM: tab 📦 Kho */
/** Tên hàng đã bán N ngày qua (đơn CRM + đơn sàn có file) và máy đang tính vào sản phẩm kho nào. */
async function khoNames(x, C, days) {
  const since = Date.now() - (days || 60) * DAY, by = {};
  const add = (t, q, src) => { const k = nrm(t); if (!k) return; const r = by[k] || (by[k] = { t, n: 0, q: 0, src }); r.n++; r.q += q; };
  for (const r of await all(x.db, "SELECT items FROM orders WHERE time > ? AND items != ''", since)) khoLines(r.items).forEach(([t, q]) => add(t, q, 'CRM'));
  for (const r of await all(x.db, "SELECT shop, items FROM san_orders WHERE day >= ? AND items NOT IN ('', '[]')", fmtDate(since, 'yyyy-MM-dd'))) sanLines(r.items).forEach(([t, q]) => add(t, q, r.shop));
  return Object.values(by).map(r => ({ t: r.t, n: r.n, q: r.q, src: r.src, to: khoResolve(r.t, C), manual: !!C.map[nrm(r.t)] })).sort((a, b) => (a.to ? 1 : 0) - (b.to ? 1 : 0) || b.n - a.n).slice(0, 200);
}
async function khoLoad(x, u, d) {
  if (Array.isArray(d.combos)) { // combo trên web (CRM_CONFIG từ build.py): [[tên combo, [[tên sản phẩm (quy cách), số lượng]]]]
    const cb = {}; d.combos.slice(0, 50).forEach(c => { if (c && c[0] && Array.isArray(c[1])) cb[nrm(c[0])] = c[1].slice(0, 10).map(p => [String(p[0] || '').slice(0, 160), Math.max(1, Number(p[1]) || 1)]); });
    const old = await kvGet(x.db, 'kho_combos'); if (JSON.stringify(cb) !== (old || '{}')) await kvSet(x.db, 'kho_combos', JSON.stringify(cb));
  }
  let syncErr = ''; try { await khoSync(x); } catch (e) { syncErr = e.message; console.error('khoSync', e.stack || e.message); }
  const now = Date.now(), items = await khoItems(x);
  const [chk, pos, moves, cfg, P, C] = await Promise.all([khoCheck(x, {}), all(x.db, "SELECT * FROM kho_po WHERE status = 'open' OR at > ? ORDER BY id DESC LIMIT 120", now - 120 * DAY),
    all(x.db, 'SELECT * FROM kho_moves WHERE at > ? ORDER BY at DESC, id DESC LIMIT 200', now - 90 * DAY), kvJson(x.db, 'kho_cfg', {}), khoPeople(x), khoCtx(x, items)]);
  const names = await khoNames(x, C, 60), map = await kvJson(x.db, 'kho_map', {}) || {};
  const [ret, got] = await Promise.all([all(x.db, "SELECT " + RET_COLS + " FROM orders WHERE status = 'Đang chuyển hoàn' ORDER BY time LIMIT 300"),
    all(x.db, "SELECT " + RET_COLS + " FROM orders WHERE status = 'Hoàn' AND upd > ? ORDER BY upd DESC LIMIT 60", now - 14 * DAY)]); // ↩ hàng hoàn đang về / vừa về
  const done = pos.filter(p => p.status === 'done' && p.done_at && p.at), realLead = {};
  done.forEach(p => { const r = realLead[p.item] || (realLead[p.item] = []); r.push(Math.round((p.done_at - p.at) / DAY)); });
  return { ok: true, list: chk.list, items: items.map(i => ({ id: i.id, name: i.name, unit: i.unit, lead: i.lead, safety: i.safety, cover: i.cover, min: i.min_qty, supplier: i.supplier, note: i.note, active: !!i.active, realLead: realLead[i.id] || [] })),
    pos: pos.map(p => ({ id: p.id, item: p.item, qty: r1(p.qty), got: r1(p.got), eta: p.eta, note: p.note, by: p.by_name, at: p.at, status: p.status, doneAt: p.done_at })),
    moves: moves.map(m => ({ id: m.id, item: m.item, kind: m.kind, qty: r1(m.qty), sys: m.sys === null ? null : r1(m.sys), reason: m.reason, note: m.note, po: m.po, by: m.by_name, at: m.at, made: m.made || m.at })),
    names, manual: Object.keys(map).length, cfg: Object.assign({ countDay: 5 }, cfg || {}), reasons: KHO_REASONS, alert: chk.A,
    staff: P.staff.map(s => ({ name: s.name, tg: !!s.tg })), syncErr, ret: ret.map(khoRetOut), got: got.map(khoRetOut) };
}
/** ↩ Đơn hoàn cho tab Kho (09/11/2026): chỉ phần kho cần để khớp gói hàng (mã đơn, tên, 4 số cuối SĐT, hàng, hãng + mã vận đơn), không gửi địa chỉ / tiền. */
export function khoRetOut(o) {
  const p = String(o.phone || '').replace(/\D/g, '');
  return { row: o.rid, id: o.id, time: o.time, name: o.name, ph: p ? '…' + p.slice(-4) : '', items: String(o.items || '').slice(0, 400), status: o.status, carrier: o.carrier || '', tracking: o.tracking || '', seller: o.seller || '', trk: o.trk || '', upd: o.upd || 0, note: String(o.note || '').split('\n').filter(l => /^📦 Kho nhận hoàn/.test(l)).pop() || '' };
}
const RET_COLS = 'rid, id, time, name, phone, items, status, carrier, tracking, seller, trk, upd, note';
const num = (v, lo, hi) => { const n = Number(String(v == null ? '' : v).replace(/\./g, '').replace(',', '.')); return isFinite(n) && n >= lo && n <= hi ? n : null; };
async function itemOf(x, id) { return id ? await first(x.db, 'SELECT * FROM kho_items WHERE id = ?', String(id)) : null; }
/** Lệnh của tab Kho: người tích 📦 Phụ trách kho, Quản lý, Quản trị. Ghi xong trả lại toàn bộ số liệu tab (khoLoad). */
export async function crmKho(x, u, d, log) {
  if (!(u.level >= 2 || u.kho)) return { ok: false, error: 'Mục Kho dành cho người phụ trách kho, Quản lý và Quản trị. Nhờ Quản trị tích ô 📦 Phụ trách kho cho bạn ở Cài đặt → Nhân sự.' };
  const a = d.action, now = Date.now();
  if (a === 'kho_load') return khoLoad(x, u, d);
  if (a === 'kho_item') { // thêm / sửa / ngừng theo dõi 1 sản phẩm
    const v = d.item || {}, id = String(v.id || ''), o = id ? await itemOf(x, id) : null;
    if (id && !o) return { ok: false, error: 'Không tìm thấy sản phẩm này (có thể vừa bị xoá).' };
    if (v.active === false) { await run(x.db, 'UPDATE kho_items SET active = 0, at = ?, by_name = ? WHERE id = ?', now, u.name, id); await log(x, u, 'Kho', '-', o.name, 'Ngừng theo dõi sản phẩm', ''); return khoLoad(x, u, {}); }
    const name = String(v.name || '').replace(/\s+/g, ' ').trim().slice(0, 120); if (!name) return { ok: false, error: 'Nhập tên sản phẩm.' };
    const lead = num(v.lead, 1, 365), safety = num(v.safety, 0, 180), cover = num(v.cover, 1, 365), min = num(v.min || 0, 0, 1e6);
    if (lead === null) return { ok: false, error: 'Số ngày nhà cung cấp giao hàng: nhập từ 1 đến 365.' };
    if (safety === null || cover === null || min === null) return { ok: false, error: 'Số ngày dự phòng / đặt đủ bán / mức tối thiểu chưa đúng.' };
    const row = [name, String(v.unit || 'hộp').trim().slice(0, 20) || 'hộp', Math.round(lead), Math.round(safety), Math.round(cover), Math.round(min), String(v.supplier || '').trim().slice(0, 200), String(v.note || '').trim().slice(0, 300), now, u.name];
    if (o) await run(x.db, 'UPDATE kho_items SET name = ?, unit = ?, lead = ?, safety = ?, cover = ?, min_qty = ?, supplier = ?, note = ?, at = ?, by_name = ?, active = 1 WHERE id = ?', ...row, id);
    else { const m = await first(x.db, 'SELECT max(ord) AS m FROM kho_items'); await run(x.db, 'INSERT INTO kho_items (id, name, unit, lead, safety, cover, min_qty, supplier, note, at, by_name, active, ord) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?)', 'k' + randHex(4), ...row, ((m && m.m) || 0) + 1); }
    await log(x, u, 'Kho', '-', name, o ? 'Sửa sản phẩm kho' : 'Thêm sản phẩm kho', 'nhà cung cấp giao ' + Math.round(lead) + ' ngày · dự phòng ' + Math.round(safety) + ' ngày');
    return khoLoad(x, u, {});
  }
  if (a === 'kho_move') { // 📥 nhập hàng / 📤 xuất khác
    const it = await itemOf(x, d.item), kind = d.kind === 'in' ? 'in' : d.kind === 'out' ? 'out' : '', qty = num(d.qty, 0.01, 1e6);
    if (!it || !kind) return { ok: false, error: 'Chọn sản phẩm.' }; if (qty === null) return { ok: false, error: 'Số lượng chưa đúng.' };
    const reason = kind === 'out' ? String(d.reason || 'Khác').slice(0, 60) : '', note = String(d.note || '').trim().slice(0, 300), at = Math.min(now, Math.max(now - 7 * DAY, Number(d.at) || now));
    let po = null;
    if (kind === 'in' && d.po) {
      po = await first(x.db, "SELECT * FROM kho_po WHERE id = ? AND item = ? AND status = 'open'", Number(d.po), it.id);
      if (po) await run(x.db, 'UPDATE kho_po SET got = got + ?, status = ?, done_at = ? WHERE id = ?', qty, d.keep ? 'open' : 'done', d.keep ? null : now, po.id);
    }
    await run(x.db, 'INSERT INTO kho_moves (item, kind, qty, reason, note, po, by_name, at, made) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)', it.id, kind, qty, reason, note, po ? po.id : null, u.name, at, now);
    await log(x, u, 'Kho', '-', it.name, (kind === 'in' ? 'Hàng về kho ' : 'Lấy hàng ra ') + nf(qty) + ' ' + it.unit + (reason ? ' · ' + reason : ''), note);
    return khoLoad(x, u, {});
  }
  if (a === 'kho_count') { // 🧮 kiểm kho: số đếm thật của nhiều sản phẩm 1 lần
    const rows = (Array.isArray(d.rows) ? d.rows : []).map(r => [String(r[0] || ''), num(r[1], 0, 1e7)]).filter(r => r[0] && r[1] !== null);
    if (!rows.length) return { ok: false, error: 'Nhập số đếm được của ít nhất 1 sản phẩm.' };
    const at = Math.min(now, Math.max(now - 3 * DAY, Number(d.at) || now)), note = String(d.note || '').trim().slice(0, 300);
    try { await khoSync(x); } catch (e) { }
    const before = {}; (await khoStats(x)).forEach(s => { before[s.id] = s; });
    const items = await khoItems(x), byId = {}; items.forEach(i => { byId[i.id] = i; });
    const diffs = [];
    for (const [id, q] of rows) {
      const it = byId[id]; if (!it) continue;
      const s = before[id], sys = s && s.have !== null && at >= (s.countAt || 0) ? s.have : null;
      await run(x.db, "INSERT INTO kho_moves (item, kind, qty, sys, note, by_name, at, made) VALUES (?, 'count', ?, ?, ?, ?, ?, ?)", id, q, sys, note, u.name, at, now);
      if (sys !== null && Math.abs(q - sys) >= 0.5) diffs.push('• ' + esc(it.name) + ': đếm ' + nf(q) + ', máy tính ' + nf(sys) + ' → <b>lệch ' + (q > sys ? '+' : '') + nf(q - sys) + ' ' + esc(it.unit) + '</b>');
    }
    await log(x, u, 'Kho', '-', '', 'Đếm kho ' + rows.length + ' sản phẩm' + (diffs.length ? ' · lệch ' + diffs.length : ''), note);
    if (diffs.length) x.later((async () => { for (const z of (await khoPeople(x)).admins) await telegramTo(x.env, z.tg, '🧮 <b>' + esc(u.name) + ' vừa đếm kho</b> (' + fmtDate(at, 'HH:mm dd/MM') + ')\n' + diffs.join('\n') + (note ? '\n📝 ' + esc(note) : '') + '\n\nLệch thường do quà tặng, hàng mẫu, hàng hỏng chưa ghi “📤 Lấy hàng ra”, hoặc đơn ngoài CRM. 👉 ' + KHO_URL); })());
    return Object.assign(await khoLoad(x, u, {}), { diffs: diffs.length });
  }
  if (a === 'kho_po') { // 🛒 đã đặt NCC / đổi ngày hẹn / huỷ
    if (d.id) {
      const p = await first(x.db, 'SELECT * FROM kho_po WHERE id = ?', Number(d.id)); if (!p) return { ok: false, error: 'Không tìm thấy lần đặt hàng này.' };
      const it = await itemOf(x, p.item);
      if (d.cancel) { await run(x.db, "UPDATE kho_po SET status = 'cancel', done_at = ? WHERE id = ?", now, p.id); await log(x, u, 'Kho', '-', it ? it.name : p.item, 'Huỷ lần đặt hàng ' + nf(p.qty), String(d.note || '')); }
      else { const eta = dateOrBlank(d.eta); if (!eta) return { ok: false, error: 'Chọn ngày hẹn hàng về.' }; await run(x.db, 'UPDATE kho_po SET eta = ?, note = ? WHERE id = ?', eta, String(d.note != null ? d.note : p.note || '').slice(0, 300), p.id); await log(x, u, 'Kho', '-', it ? it.name : p.item, 'Nhà cung cấp hẹn lại ngày về ' + dm(eta), ''); }
      return khoLoad(x, u, {});
    }
    const it = await itemOf(x, d.item), qty = num(d.qty, 0.01, 1e7), eta = dateOrBlank(d.eta);
    if (!it) return { ok: false, error: 'Chọn sản phẩm.' }; if (qty === null) return { ok: false, error: 'Số lượng đặt chưa đúng.' }; if (!eta) return { ok: false, error: 'Chọn ngày nhà cung cấp hẹn giao.' };
    const note = String(d.note || '').trim().slice(0, 300);
    await run(x.db, 'INSERT INTO kho_po (item, qty, eta, note, by_name, at) VALUES (?, ?, ?, ?, ?, ?)', it.id, qty, eta, note, u.name, now);
    await log(x, u, 'Kho', '-', it.name, 'Đã đặt hàng ' + nf(qty) + ' ' + it.unit + ', hẹn về ' + dm(eta), note);
    x.later(telegram(x.env, '🛒 <b>' + esc(u.name) + ' đã đặt thêm hàng</b>: ' + esc(it.name) + ' ' + nf(qty) + ' ' + esc(it.unit) + ', hẹn về ' + dm(eta) + (note ? '\n📝 ' + esc(note) : '')));
    return khoLoad(x, u, {});
  }
  if (a === 'kho_map') { // 🔗 ghép tay 1 tên hàng: comps [[mã sản phẩm, số đơn vị / suất]]; [] = không trừ kho; null = bỏ ghép tay
    const key = nrm(d.text); if (!key) return { ok: false, error: 'Thiếu tên hàng.' };
    const map = await kvJson(x.db, 'kho_map', {}) || {}, ids = {}; (await khoItems(x)).forEach(i => { ids[i.id] = 1; });
    if (d.comps === null || d.comps === undefined) delete map[key];
    else {
      const comps = (Array.isArray(d.comps) ? d.comps : []).map(c => [String(c[0] || ''), num(c[1], 0.01, 1000)]).filter(c => ids[c[0]] && c[1] !== null);
      if ((d.comps || []).length && !comps.length) return { ok: false, error: 'Chọn sản phẩm kho và số lượng.' };
      map[key] = merge(comps);
    }
    if (Object.keys(map).length > 2000) return { ok: false, error: 'Quá nhiều tên ghép tay.' };
    await kvSet(x.db, 'kho_map', JSON.stringify(map));
    await log(x, u, 'Kho', '-', String(d.text).slice(0, 100), d.comps == null ? 'Bỏ ghép tay' : (map[key] || []).length ? 'Ghép tên hàng' : 'Không trừ kho', '');
    return khoLoad(x, u, {});
  }
  if (a === 'kho_undo') { // xoá 1 lần nhập / xuất / kiểm ghi nhầm (trong 7 ngày)
    const m = await first(x.db, 'SELECT * FROM kho_moves WHERE id = ?', Number(d.id)); if (!m) return { ok: false, error: 'Không tìm thấy dòng này.' };
    if (now - (m.made || m.at) > 7 * DAY) return { ok: false, error: 'Chỉ xoá được dòng ghi trong 7 ngày. Dòng cũ hơn: kiểm kho lại để sửa số.' };
    if (m.by_name !== u.name && u.level < 2) return { ok: false, error: 'Chỉ người ghi hoặc Quản lý xoá được dòng này.' };
    await run(x.db, 'DELETE FROM kho_moves WHERE id = ?', m.id);
    if (m.po) await run(x.db, "UPDATE kho_po SET got = max(0, got - ?), status = 'open', done_at = NULL WHERE id = ?", m.qty, m.po);
    const it = await itemOf(x, m.item);
    await log(x, u, 'Kho', '-', it ? it.name : m.item, 'Xoá dòng ' + ({ in: 'hàng về kho', out: 'lấy hàng ra', count: 'đếm kho' })[m.kind] + ' ' + nf(m.qty), fmtDate(m.at, 'HH:mm dd/MM'));
    return khoLoad(x, u, {});
  }
  if (a === 'kho_cfg') {
    const cday = Number(d.countDay); if (!(cday >= -1 && cday <= 6)) return { ok: false, error: 'Ngày kiểm kho chưa đúng.' };
    await kvSet(x.db, 'kho_cfg', JSON.stringify({ countDay: cday }));
    return khoLoad(x, u, {});
  }
  return { ok: false, error: 'Không rõ thao tác: ' + a };
}
