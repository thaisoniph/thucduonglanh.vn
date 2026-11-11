// 💼 Kế toán (09/11/2026, anh Sơn chọn PA 2): quyền "Kế toán" riêng, chỉ thấy phần tài chính.
// - Đơn hàng: mã, ngày, sale, sản phẩm, tiền, trạng thái, hãng, mã vận đơn, tên khách + 4 số cuối SĐT (ktOrderOut). Không SĐT đầy đủ, địa chỉ, ghi chú, khách, khách hỏi, nhật ký.
// - Tiền về tài khoản: cột orders.cash_at (lúc tiền về) / cash_amt (tiền hãng thu hộ hoặc tiền khách chuyển) / cash_src ("COD Best 09/11 · NO100…", "Tay – Lan").
//   Kế toán tích tay từng đơn / nhiều đơn, hoặc tải file đối soát COD Best / Viettel Post (CRM đọc trên máy, khớp đơn, gửi lô kt_cash).
// - 💤 Tiền treo ở hãng = đơn COD Đã giao / Đổi hàng từ ngày bắt đầu theo dõi (kv kt_cfg.from) mà chưa có cash_at. kt_cfg.on = lần đầu ghi tiền về → Tổng quan, tin 8h mới hiện số treo.
import { all, run, allIn, kvJson, kvSet, fmtDate, startOfDay, esc, DAY, adjOut } from './lib.js';
import { khoItems, khoStats } from './kho.js';
import { kspMorningLine } from './san.js';

export const KT_ROLE = 'Kế toán';
export const isKt = u => !!u && u.role === KT_ROLE;
/** Được làm việc tài chính: Quản trị hoặc Kế toán. */
export const finOk = u => !!u && (u.level >= 3 || u.role === KT_ROLE);
// Tài khoản Kế toán: ngoài các lệnh này + kt_* máy chủ từ chối hết (crmApi). settings: chỉ phần chi phí / bảng lương / giá vốn (ktSettingsOk).
export const KT_ROLE_OK = { load: 1, logout: 1, guide_ask: 1, prefs: 1, tg_link: 1, tg_check: 1, tg_off: 1, perf: 1, usage: 1, feedback: 1, fb_list: 1, fb_img: 1, settings: 1, mkt: 1, san: 1, fin_save: 1, fin_test: 1 };
export function ktSettingsOk(d) { return Object.keys(d).every(k => ['type', 'action', 'token', 'opId', 'cost', 'opex', 'pay'].indexOf(k) >= 0); }
const KT_FROM_DEF = '2026-10-01';
// 10/11/2026 (file đối soát T10 của kế toán): tiền về tài khoản nào – Best / xe ôm có khi về TK công ty, có khi về TK anh Sơn, có đơn lên Hộ kinh doanh. Kế toán sửa danh sách ở ⚙️ Cài đặt kế toán.
const ACCTS_DEF = ['Công ty', 'Anh Sơn', 'Hộ kinh doanh'];
export const WHY_LIST = ['Hạ COD hỗ trợ ship', 'Sale nhập sai tiền', 'Khách trả thiếu', 'Giảm giá thêm cho khách', 'Khác'];
const cleanAccts = a => (Array.isArray(a) ? a : []).map(v => String(v || '').trim().slice(0, 40)).filter((v, i, z) => v && z.indexOf(v) === i).slice(0, 8);
const CARRIERS = ['BEST Express', 'Viettel Post'];

export async function ktCfg(x) { const c = (await kvJson(x.db, 'kt_cfg', null)) || {}; const ac = cleanAccts(c.accts); return { from: /^20\d\d-\d\d-\d\d$/.test(c.from || '') ? c.from : KT_FROM_DEF, on: Number(c.on) || 0, by: c.by || '', at: c.at || 0, accts: ac.length ? ac : ACCTS_DEF.slice(), whys: WHY_LIST }; }
const fromMs = c => new Date(c.from + 'T00:00:00+07:00').getTime();
const last4 = p => String(p || '').replace(/\D/g, '').slice(-4);

/** Đơn gửi cho Kế toán: bỏ SĐT (chỉ 4 số cuối), địa chỉ, email, ghi chú, SĐT người giới thiệu. */
export function ktOrderOut(r) {
  return { row: r.rid, time: r.time, id: r.id, name: r.name || '', phone: '', ph: last4(r.phone), email: '', province: '', ward: '', address: '', items: r.items || '', subtotal: r.subtotal || 0,
    shipping: r.shipping || 0, total: r.total || 0, payment: r.payment || '', note: '', status: r.status || 'Mới', source: r.source || '', consent: false, paid: r.paid || '', carrier: r.carrier || '', tracking: r.tracking || '', seller: r.seller || '', ca: r.ca || '', line: r.line || '', ship: r.ship || '',
    shipAt: r.ship_at, receivedAt: r.received_at, otype: r.otype || '', oflag: '', trk: '', trkAt: null, trkCode: 0, voucher: r.voucher || '', refPhone: '', refGift: '', refTold: 0, partner: r.partner || '', pRate: r.partner_rate || 0, discount: r.discount || 0, addrOld: '', shipFee: r.ship_fee == null ? null : r.ship_fee, recon: r.recon || '',
    cashAt: r.cash_at || null, cashAmt: r.cash_amt == null ? null : r.cash_amt, cashSrc: r.cash_src || '', cashAcct: r.cash_acct || '', cashWhy: r.cash_why || '', adj: adjOut(r) };
}

/** Lệnh load của Kế toán: khung (loadSmall) + đơn 400 ngày đã che. d.part = 'delta' → chỉ đơn đổi từ lần trước. */
export async function ktLoad(x, u, d, small, nowSql, deltaOk) {
  const b = (sql, ...a) => x.db.prepare(sql).bind(...a), today = startOfDay(Date.now()), cfg = await ktCfg(x);
  const empty = { customers: [], leads: [], log: [], contacts: [], targets: [], cusGone: [], leadGone: [], ordGone: [], ads: null, adRows: [], adV: '', fbNew: 0, sv: 0, lr: 0, qrLinks: [] };
  if (d.part === 'delta') {
    const since = Number(d.since) || 0; if (!since || !deltaOk) return { ok: true, delta: true, full: true };
    const [mk, os] = (await x.db.batch([b(`SELECT ${nowSql} AS sv`), b('SELECT * FROM orders WHERE upd > ?1 LIMIT 1501', since - 5000)])).map(r => r.results || []);
    if (os.length > 1500) return { ok: true, delta: true, full: true };
    return Object.assign(await small, empty, { delta: true, today, ktCfg: cfg, orders: os.map(ktOrderOut), sv: (mk[0] || {}).sv || 0, lr: Number(d.lr) || 0 });
  }
  const [mk, os] = (await x.db.batch([b(`SELECT ${nowSql} AS sv`), b("SELECT * FROM orders WHERE time >= ?1 OR status IN ('Mới', 'Đã xác nhận', 'Đang giao') ORDER BY time DESC, rid DESC LIMIT 8000", Date.now() - 400 * DAY)])).map(r => r.results || []);
  return Object.assign(await small, empty, { today, ktCfg: cfg, orders: os.reverse().map(ktOrderOut), sv: deltaOk ? (mk[0] || {}).sv || 0 : 0 });
}

/** Số tiền treo ở hãng + chuyển khoản chờ xác nhận (tin 8h, ô Doanh thu ở Tổng quan). null = chưa bắt đầu theo dõi. */
export async function ktTreo(x) {
  const c = await ktCfg(x); if (!c.on) return null;
  const f = fromMs(c), old = Date.now() - 10 * DAY;
  const rows = await all(x.db, "SELECT carrier, COUNT(*) AS n, COALESCE(SUM(total), 0) AS v, SUM(COALESCE(received_at, ship_at, time) < ?2) AS ln, COALESCE(SUM(CASE WHEN COALESCE(received_at, ship_at, time) < ?2 THEN total ELSE 0 END), 0) AS lv FROM orders WHERE time >= ?1 AND status IN ('Đã giao', 'Đổi hàng') AND cash_at IS NULL AND payment NOT LIKE '%huyển khoản%' AND total > 0 GROUP BY carrier", f, old);
  const [bk] = await all(x.db, "SELECT COUNT(*) AS n, COALESCE(SUM(total), 0) AS v FROM orders WHERE time >= ?1 AND payment LIKE '%huyển khoản%' AND cash_at IS NULL AND status NOT LIKE '%oàn%' AND status NOT LIKE '%uỷ%' AND status NOT LIKE '%ủy%' AND total > 0", f);
  const y0 = startOfDay(Date.now()) - DAY, [got] = await all(x.db, 'SELECT COUNT(*) AS n, COALESCE(SUM(cash_amt), 0) AS v FROM orders WHERE cash_at >= ? AND cash_at < ?', y0, y0 + DAY);
  const by = rows.map(r => ({ c: r.carrier || 'Chưa ghi hãng', n: r.n, v: r.v, ln: r.ln || 0, lv: r.lv || 0 })).sort((a, b) => b.v - a.v);
  return { from: c.from, by, n: by.reduce((s, r) => s + r.n, 0), v: by.reduce((s, r) => s + r.v, 0), ln: by.reduce((s, r) => s + r.ln, 0), lv: by.reduce((s, r) => s + r.lv, 0), bank: { n: bk.n, v: bk.v }, got: { n: got.n, v: got.v } };
}
function tr(n) { const a = Math.abs(Math.round(n)); return a >= 1e6 ? (Math.round(a / 1e5) / 10).toString().replace('.', ',') + ' tr' : a.toLocaleString('vi-VN') + 'đ'; }
/** Mấy dòng 💤 cho tin Telegram 8h (Quản trị + Kế toán). */
export async function ktMorningLines(x) {
  const T = await ktTreo(x); if (!T) return [];
  const L = ['💤 <b>Tiền đang treo ở hãng vận chuyển</b>: ' + tr(T.v) + ' (' + T.n + ' đơn đã giao, hãng chưa trả tiền)'];
  T.by.slice(0, 4).forEach(r => L.push('• ' + esc(r.c) + ': ' + tr(r.v) + ' · ' + r.n + ' đơn' + (r.ln ? ' · ⚠️ ' + r.ln + ' đơn quá 10 ngày (' + tr(r.lv) + ')' : '')));
  if (T.ln) L.push('👉 Kế toán đối chiếu file COD, hỏi hãng các đơn quá 10 ngày.');
  if (T.got.n) L.push('💵 Hôm qua ghi nhận tiền về: ' + tr(T.got.v) + ' (' + T.got.n + ' đơn)');
  if (T.bank.n) L.push('🏦 Chuyển khoản chờ kế toán xác nhận: ' + T.bank.n + ' đơn · ' + tr(T.bank.v));
  const B = await ktbWait(x).catch(() => []);
  if (B.length) {
    const late = B.filter(b => b.made && b.made < Date.now() - KTB_LATE * DAY);
    L.push('🧾 Phiếu đối soát chờ tiền về: ' + B.length + ' phiếu · ' + tr(B.reduce((s, b) => s + (b.exp || 0), 0)) + (late.length ? ' · ⚠️ ' + late.length + ' phiếu quá ' + KTB_LATE + ' ngày chưa thấy tiền: hỏi hãng' : ''));
  }
  const SP = await kspMorningLine(x).catch(() => ''); if (SP) L.push(SP);
  return L;
}

/** kt_cash {items: [{row, id, amt, fee, day}], src, acct, off}: ghi / bỏ ghi tiền về (acct = tài khoản nhận). kt_cfg {from?, accts?}: ngày bắt đầu theo dõi, danh sách tài khoản. kt_why {row, id, why}: lý do lệch tiền thu hộ. Chỉ Kế toán, Quản trị. */
export async function crmKt(x, u, d, log) {
  if (!finOk(u)) return { ok: false, error: 'Chỉ Kế toán và Quản trị làm được việc này.' };
  if (d.action === 'kt_cfg') {
    const c = await ktCfg(x), n = Object.assign(c, { by: u.name, at: Date.now() }), msg = [];
    if (d.from != null) { if (!/^20\d\d-\d\d-\d\d$/.test(d.from || '')) return { ok: false, error: 'Ngày chưa đúng.' }; n.from = d.from; msg.push('Theo dõi tiền về từ ngày ' + d.from.split('-').reverse().join('/')); }
    if (d.accts != null) { const ac = cleanAccts(d.accts); if (!ac.length) return { ok: false, error: 'Cần ít nhất 1 tài khoản nhận tiền.' }; n.accts = ac; msg.push('Tài khoản nhận tiền: ' + ac.join(', ')); }
    delete n.whys; await kvSet(x.db, 'kt_cfg', JSON.stringify(n));
    await log(x, u, 'Kế toán', '-', '', msg.join(' · ') || 'Lưu cài đặt kế toán', '');
    return { ok: true, ktCfg: await ktCfg(x) };
  }
  if (d.action === 'kt_why') { // lý do hãng thu khác tiền trên đơn (danh sách ⚠️ Đơn lệch tiền thu hộ ở tab Kế toán)
    const o = await x.db.prepare('SELECT * FROM orders WHERE rid = ?').bind(Number(d.row) || 0).first();
    if (!o || String(o.id) !== String(d.id)) return { ok: false, error: 'Không thấy đơn ' + (d.id || '') + '.' };
    const why = String(d.why || '').trim().slice(0, 120);
    await run(x.db, 'UPDATE orders SET cash_why = ? WHERE rid = ?', why, o.rid);
    await log(x, u, 'Kế toán', String(o.id), '', why ? 'Lý do lệch tiền thu hộ: ' + why : 'Bỏ lý do lệch tiền thu hộ', '');
    const r = await x.db.prepare('SELECT * FROM orders WHERE rid = ?').bind(o.rid).first();
    return { ok: true, orders: [ktOrderOut(r)] };
  }
  if (d.action !== 'kt_cash') return { ok: false, error: 'Không rõ thao tác: ' + d.action };
  const items = (Array.isArray(d.items) ? d.items : []).slice(0, 3000), off = !!d.off, now = Date.now();
  if (!items.length) return { ok: false, error: 'Chưa chọn đơn nào.' };
  const src = String(d.src || '').trim().slice(0, 80) || 'Tay – ' + u.name, acct = String(d.acct || '').trim().slice(0, 40), tag = src + ' ' + fmtDate(now, 'dd/MM');
  const byRid = {}; (await allIn(x.db, 'SELECT * FROM orders WHERE rid IN (SELECT value FROM json_each(?))', items.map(it => Number(it.row) || 0))).forEach(o => { byRid[o.rid] = o; });
  const ups = [], done = [], errs = []; let sum = 0;
  for (const it of items) {
    const o = byRid[Number(it.row) || 0]; if (!o || String(o.id) !== String(it.id)) { errs.push(it.id); continue; }
    if (off) { ups.push(x.db.prepare("UPDATE orders SET cash_at = NULL, cash_amt = NULL, cash_src = '', cash_acct = '', cash_why = '' WHERE rid = ?").bind(o.rid)); done.push(o.rid); continue; }
    const amt = it.amt == null || it.amt === '' ? Number(o.total) || 0 : Math.max(0, Math.round(Number(it.amt) || 0)), day = Number(it.day) > 1.5e12 && Number(it.day) < now + DAY ? Math.round(Number(it.day)) : now;
    const set = { cash_at: day, cash_amt: amt, cash_src: (it.ref ? src + ' · ' + String(it.ref).slice(0, 30) : src).slice(0, 120) };
    if (acct) set.cash_acct = acct;
    if (/chuyển khoản/i.test(o.payment || '') && !o.paid) set.paid = 'Có – ' + u.name + (u.role === KT_ROLE ? ' (kế toán) ' : ' ') + fmtDate(now, 'dd/MM HH:mm');
    if (it.fee != null && it.fee !== '' && Number(it.fee) >= 0 && o.ship_fee == null) set.ship_fee = Math.round(Number(it.fee));
    const ks = Object.keys(set); ups.push(x.db.prepare('UPDATE orders SET ' + ks.map(k => k + ' = ?').join(', ') + ' WHERE rid = ?').bind(...ks.map(k => set[k]), o.rid));
    done.push(o.rid); sum += amt;
  }
  for (let i = 0; i < ups.length; i += 100) await x.db.batch(ups.slice(i, i + 100));
  if (!off && done.length) { const c = await ktCfg(x); if (!c.on) { c.on = now; await kvSet(x.db, 'kt_cfg', JSON.stringify(c)); } }
  await log(x, u, 'Kế toán', items.length === 1 ? String(items[0].id || '-') : '-', '', off ? 'Bỏ ghi tiền về ' + done.length + ' đơn' : 'Tiền về ' + tag + (acct ? ' (TK ' + acct + ')' : '') + ': ' + done.length + ' đơn, ' + sum.toLocaleString('vi-VN') + 'đ', errs.length ? 'Không thấy: ' + errs.slice(0, 20).join(', ') : '');
  const rows = done.length ? await allIn(x.db, 'SELECT * FROM orders WHERE rid IN (SELECT value FROM json_each(?))', done) : [];
  return { ok: true, n: done.length, sum, errors: errs, orders: rows.map(ktOrderOut), ktCfg: await ktCfg(x) };
}
/** 📦 kt_kho (09/11/2026): kế toán xem số hàng tồn (chỉ đọc, số do kho ghi trên CRM) để tính giá trị tồn kho + so hoá đơn nhà cung cấp với hàng về kho.
 *  ends: số tồn lúc 0h ngày 1 của 3 tháng gần nhất (= cuối tháng trước), lùi từ số hiện tại: − nhập + xuất khác + hàng theo đơn đi − hàng hoàn về − chênh lệch kiểm kho (qty − sys).
 *  Trước lần đếm kho đầu tiên: null (chưa có số gốc). Không trả khách / đơn nào. */
export async function ktKho(x, u) {
  if (!finOk(u)) return { ok: false, error: 'Chỉ Kế toán và Quản trị xem được mục này.' };
  const items = (await khoItems(x)).filter(i => i.active);
  if (!items.length) return { ok: true, items: [], ins: [], ends: [] };
  const st = await khoStats(x, items), now = Date.now();
  const mStart = (y, m) => new Date(Date.UTC(y, m, 1) - 7 * 3600e3).getTime(); // 0h ngày 1 giờ VN
  const n = new Date(now + 7 * 3600e3), E = [0, 1, 2].map(k => mStart(n.getUTCFullYear(), n.getUTCMonth() - k)), e0 = E[2];
  const [mv, outs, backs, first] = await Promise.all([
    all(x.db, 'SELECT item, kind, qty, sys, at FROM kho_moves WHERE at > ?', e0),
    all(x.db, "SELECT item, units, out_at FROM kho_out WHERE out_at > ? AND st IN ('o', 'b')", e0),
    all(x.db, 'SELECT item, units, back_at FROM kho_out WHERE back_at > ?', e0),
    all(x.db, "SELECT item, MIN(at) AS at FROM kho_moves WHERE kind = 'count' GROUP BY item")]);
  const f0 = {}; first.forEach(r => { f0[r.item] = Number(r.at) || 0; });
  const ends = E.map(t => {
    const q = {};
    st.forEach(s => {
      if (s.have === null || !f0[s.id] || f0[s.id] > t) { q[s.id] = null; return; }
      let h = s.have;
      mv.forEach(m => { if (m.item !== s.id || m.at <= t) return; const v = Number(m.qty) || 0; if (m.kind === 'in') h -= v; else if (m.kind === 'out') h += v; else if (m.kind === 'count' && m.sys !== null) h -= v - (Number(m.sys) || 0); });
      outs.forEach(o => { if (o.item === s.id && o.out_at > t) h += Number(o.units) || 0; });
      backs.forEach(o => { if (o.item === s.id && o.back_at > t) h -= Number(o.units) || 0; });
      q[s.id] = Math.round(h * 10) / 10;
    });
    return { at: t, q };
  });
  const ins = await all(x.db, "SELECT item, qty, note, by_name, at FROM kho_moves WHERE kind = 'in' AND at > ? ORDER BY at DESC LIMIT 300", now - 100 * DAY);
  return { ok: true, items: st.map(s => ({ id: s.id, name: s.name, unit: s.unit, have: s.have, countAt: s.countAt })), ends,
    ins: ins.map(m => ({ item: m.item, qty: Number(m.qty) || 0, note: m.note || '', by: m.by_name || '', at: m.at })) };
}

/* 🧾 Phiếu đối soát (11/11/2026, anh Sơn gửi mẫu Best "NO…" + Viettel Post "bảng kê PCOD…"): hãng chốt 1 phiếu nhiều đơn, chuyển 1 khoản vào thứ 2 / 4 / 6.
 * Kế toán tải file phiếu → CRM đọc trên máy, khớp đơn (mã vận đơn → mã → 4 số cuối SĐT + tiền) → kt_badd lưu phiếu (chờ tiền về, ghi luôn phí ship thật).
 * Thấy đúng số tiền phiếu trên sao kê → kt_bpay: 1 lần bấm ghi tiền về cho mọi đơn có thu hộ trong phiếu (cash_src "COD Best · NO…").
 * Best: tiền về TK = "COD cần chuyển khách" − 5.000đ phí chuyển khoản (khớp ảnh "Số tiền đã thanh toán" 29.499.600 / 35.188.500). Viettel Post: tổng "Tiền thu về". */
const KTB_LATE = 3; // phiếu tạo quá 3 ngày chưa thấy tiền → đỏ, nhắc hỏi hãng
let kbOk = false;
async function kbSchema(db) {
  if (kbOk) return;
  await run(db, `CREATE TABLE IF NOT EXISTS kt_batch (id TEXT PRIMARY KEY, carrier TEXT DEFAULT '', code TEXT DEFAULT '', made INTEGER, n INTEGER DEFAULT 0, cod INTEGER DEFAULT 0, fee INTEGER DEFAULT 0,
    exp INTEGER DEFAULT 0, items TEXT DEFAULT '[]', miss TEXT DEFAULT '[]', file TEXT DEFAULT '', st TEXT DEFAULT 'wait', got INTEGER, paid_at INTEGER, acct TEXT DEFAULT '', by_name TEXT DEFAULT '', at INTEGER, paid_by TEXT DEFAULT '')`);
  kbOk = true;
}
const pj = (s, d) => { try { return JSON.parse(s || '') || d; } catch (e) { return d; } };
const kbOut = r => ({ id: r.id, carrier: r.carrier, code: r.code, made: r.made, n: r.n, cod: r.cod, fee: r.fee, exp: r.exp, items: pj(r.items, []), miss: pj(r.miss, []), file: r.file, st: r.st, got: r.got, paidAt: r.paid_at, acct: r.acct, by: r.by_name, at: r.at, paidBy: r.paid_by });
async function ktbWait(x) { await kbSchema(x.db); return (await all(x.db, "SELECT * FROM kt_batch WHERE st = 'wait' ORDER BY made")).map(kbOut); }
async function ktbList(x) { await kbSchema(x.db); return (await all(x.db, "SELECT * FROM kt_batch WHERE st = 'wait' OR COALESCE(paid_at, at) > ? ORDER BY COALESCE(made, at) DESC LIMIT 300", Date.now() - 120 * DAY)).map(kbOut); }
const int = v => Math.round(Number(v) || 0);

/** kt_bl: danh sách phiếu · kt_badd {list: [phiếu]} · kt_bpay {id, day, got, acct, off} · kt_bdel {id}. Chỉ Kế toán, Quản trị. */
export async function crmKtBatch(x, u, d, log) {
  if (!finOk(u)) return { ok: false, error: 'Chỉ Kế toán và Quản trị làm được việc này.' };
  await kbSchema(x.db); const now = Date.now();
  if (d.action === 'kt_bl') return { ok: true, batches: await ktbList(x) };
  if (d.action === 'kt_badd') {
    const list = (Array.isArray(d.list) ? d.list : []).slice(0, 30); if (!list.length) return { ok: false, error: 'Chưa có phiếu nào.' };
    const saved = [], skip = [], fees = [];
    for (const b of list) {
      const carrier = CARRIERS.indexOf(b.carrier) >= 0 ? b.carrier : 'BEST Express', code = String(b.code || '').trim().slice(0, 60);
      if (!code) return { ok: false, error: 'Phiếu chưa có mã. Gõ mã phiếu / mã bảng kê rồi lưu lại.' };
      const id = (carrier === 'Viettel Post' ? 'VTP:' : 'BEST:') + code.toUpperCase();
      const old = await x.db.prepare('SELECT st FROM kt_batch WHERE id = ?').bind(id).first();
      if (old && old.st === 'paid') { skip.push(code); continue; }
      const items = (Array.isArray(b.items) ? b.items : []).slice(0, 2000).map(it => ({ row: int(it.row), id: String(it.id || '').slice(0, 40), wb: String(it.wb || '').slice(0, 30), cod: int(it.cod), fee: it.fee == null ? null : int(it.fee) }));
      const miss = (Array.isArray(b.miss) ? b.miss : []).slice(0, 300).map(m => ({ wb: String(m.wb || '').slice(0, 30), cod: int(m.cod), label: String(m.label || '').slice(0, 60) }));
      await run(x.db, `INSERT INTO kt_batch (id, carrier, code, made, n, cod, fee, exp, items, miss, file, st, by_name, at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'wait', ?, ?)
        ON CONFLICT(id) DO UPDATE SET made = excluded.made, n = excluded.n, cod = excluded.cod, fee = excluded.fee, exp = excluded.exp, items = excluded.items, miss = excluded.miss, file = excluded.file, by_name = excluded.by_name, at = excluded.at`,
        id, carrier, code, int(b.made) || now, int(b.n) || items.length + miss.length, int(b.cod), int(b.fee), int(b.exp), JSON.stringify(items), JSON.stringify(miss), String(b.file || '').slice(0, 120), u.name, now);
      items.forEach(it => { if (it.row && it.fee != null && it.fee >= 0) fees.push(x.db.prepare('UPDATE orders SET ship_fee = ? WHERE rid = ? AND id = ? AND ship_fee IS NULL').bind(it.fee, it.row, it.id)); });
      saved.push(code);
    }
    for (let i = 0; i < fees.length; i += 100) await x.db.batch(fees.slice(i, i + 100));
    if (saved.length) await log(x, u, 'Kế toán', '-', '', 'Lưu phiếu đối soát chờ tiền về: ' + saved.join(', '), '');
    const rows = fees.length ? await allIn(x.db, 'SELECT * FROM orders WHERE rid IN (SELECT value FROM json_each(?))', list.flatMap(b => (b.items || []).map(it => int(it.row))).filter(Boolean)) : [];
    return { ok: true, saved, skip, batches: await ktbList(x), orders: rows.map(ktOrderOut) };
  }
  const b = await x.db.prepare('SELECT * FROM kt_batch WHERE id = ?').bind(String(d.id || '')).first();
  if (!b) return { ok: false, error: 'Không thấy phiếu này. Tải lại trang rồi thử lại.' };
  const B = kbOut(b);
  if (d.action === 'kt_bdel') {
    if (b.st === 'paid') return { ok: false, error: 'Phiếu đã ghi tiền về. Bấm ↩ Bỏ ghi trước rồi mới xoá.' };
    await run(x.db, 'DELETE FROM kt_batch WHERE id = ?', b.id);
    await log(x, u, 'Kế toán', '-', '', 'Xoá phiếu đối soát ' + b.code, '');
    return { ok: true, batches: await ktbList(x) };
  }
  if (d.action !== 'kt_bpay') return { ok: false, error: 'Không rõ thao tác: ' + d.action };
  const off = !!d.off, src = 'COD ' + (b.carrier === 'Viettel Post' ? 'Viettel Post' : 'Best') + ' · ' + b.code, rids = B.items.map(it => it.row).filter(Boolean);
  const byRid = {}; (rids.length ? await allIn(x.db, 'SELECT * FROM orders WHERE rid IN (SELECT value FROM json_each(?))', rids) : []).forEach(o => { byRid[o.rid] = o; });
  const ups = [], done = []; let sum = 0, had = 0;
  if (off) {
    B.items.forEach(it => { const o = byRid[it.row]; if (o && String(o.id) === it.id && String(o.cash_src || '') === src) { ups.push(x.db.prepare("UPDATE orders SET cash_at = NULL, cash_amt = NULL, cash_src = '', cash_acct = '' WHERE rid = ?").bind(o.rid)); done.push(o.rid); } });
    ups.push(x.db.prepare("UPDATE kt_batch SET st = 'wait', got = NULL, paid_at = NULL, acct = '', paid_by = '' WHERE id = ?").bind(b.id));
  } else {
    const day = Number(d.day) > 1.5e12 && Number(d.day) < now + DAY ? Math.round(Number(d.day)) : now, acct = String(d.acct || '').trim().slice(0, 40), got = d.got == null || d.got === '' ? b.exp : int(d.got);
    B.items.forEach(it => {
      const o = byRid[it.row]; if (!o || String(o.id) !== it.id || !(it.cod > 0)) return;
      if (o.cash_at) { had++; return; }
      const set = { cash_at: day, cash_amt: it.cod, cash_src: src.slice(0, 120) }; if (acct) set.cash_acct = acct;
      if (it.fee != null && it.fee >= 0 && o.ship_fee == null) set.ship_fee = it.fee;
      const ks = Object.keys(set); ups.push(x.db.prepare('UPDATE orders SET ' + ks.map(k => k + ' = ?').join(', ') + ' WHERE rid = ?').bind(...ks.map(k => set[k]), o.rid));
      done.push(o.rid); sum += it.cod;
    });
    ups.push(x.db.prepare("UPDATE kt_batch SET st = 'paid', got = ?, paid_at = ?, acct = ?, paid_by = ? WHERE id = ?").bind(got, day, acct, u.name, b.id));
    const c = await ktCfg(x); if (!c.on) { c.on = now; delete c.whys; await kvSet(x.db, 'kt_cfg', JSON.stringify(c)); }
  }
  for (let i = 0; i < ups.length; i += 100) await x.db.batch(ups.slice(i, i + 100));
  await log(x, u, 'Kế toán', '-', '', off ? 'Bỏ ghi tiền về phiếu ' + b.code + ' (' + done.length + ' đơn)' : 'Tiền về phiếu ' + b.code + ' ngày ' + fmtDate(Number(d.day) || now, 'dd/MM') + (d.acct ? ' (TK ' + d.acct + ')' : '') + ': ' + done.length + ' đơn, thu hộ ' + sum.toLocaleString('vi-VN') + 'đ' + (had ? ', ' + had + ' đơn đã ghi từ trước' : ''), '');
  const rows = done.length ? await allIn(x.db, 'SELECT * FROM orders WHERE rid IN (SELECT value FROM json_each(?))', done) : [];
  return { ok: true, n: done.length, sum, had, orders: rows.map(ktOrderOut), batches: await ktbList(x), ktCfg: await ktCfg(x) };
}
export { CARRIERS };
