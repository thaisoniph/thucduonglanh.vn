// Ghi ngược vào file Google Sheet của sale (bản D1 của "Ghi ngược file sale" trong Apps Script):
// - ghi chú chăm sóc → nối vào ô ghi chú dòng cuối của khách trong sheet chăm sóc ("cop số"), đúng kiểu sale tự ghi ", 30/9 knm"
// - "@zalo" → thêm "(x)" vào tên khách (= đã kết bạn Zalo)
// - "@order {...}" → thêm dòng đơn tạo trên CRM vào sheet lên đơn; "@ost {...}" → sửa ô trạng thái của đúng dòng đơn
// - "@cinfo {...}" → sửa tên / địa chỉ khách trên CRM → sửa ô tên, địa chỉ ở dòng đơn gần nhất của khách
// - "@oed {...}" → sửa đơn trên CRM (tên, SĐT, địa chỉ, sản phẩm, tiền) → sửa các ô của dòng đơn; "@odel {...}" → Quản trị xoá đơn trên CRM → ô trạng thái "Huỷ" (không xoá dòng của sale)
// Bấm trên CRM chỉ xếp hàng vào bảng wb_queue (nhanh); lịch 10 phút/lần wbTick ghi 1 lượt. Cần sale chia sẻ quyền CHỈNH SỬA file cho tài khoản Google của CRM.
import { normPhone, nrm, fmtDate, all, run, allIn, kvGet, kvSet, TZ_MS, DAY } from './lib.js';
import { sheetValues, sheetBatchGet, sheetWrite, sheetAppend, a1 } from './google.js';
import { fileIdOf, SRC_UTIL } from './sync.js';
import { phoneAlias } from './crm.js';

const WB_ORDER = '@order ', WB_OST = '@ost ', WB_OED = '@oed ', WB_ODEL = '@odel ', WB_CINFO = '@cinfo ', WB_ZALO = '@zalo';
export const WB_SHORT = { 'Không nghe máy': 'knm', 'Đã hỏi thăm': 'đã hỏi thăm', 'Hẹn gọi lại': 'hẹn gọi lại', 'Đã đặt lại': 'kh đặt lại', 'Không có nhu cầu': 'kh không có nhu cầu' }; // chữ viết tắt sale quen dùng
const WB_ST = { 'Mới': 'Đã lên đơn', 'Đã xác nhận': 'Đã lên đơn', 'Đang giao': 'Đang giao', 'Đã giao': 'Giao thành công', 'Huỷ': 'Huỷ', 'Hoàn': 'Hoàn', 'Đổi hàng': 'Đổi hàng' }; // chữ quen dùng trong file sale (lúc nhập lại CRM hiểu đúng)
const RETRY_MS = 7 * DAY, KEEP_MS = 60 * DAY, BACKOFF_MS = 30 * 60e3; // lỗi thử lại trong 7 ngày (30 phút/lần); giữ 60 ngày để tra lại + để lúc nhập file nhận ra dòng CRM đã ghi
const has = (m, k) => m[k] !== undefined && m[k] !== null && m[k] !== '';
const isOrd = it => [WB_ORDER, WB_OST, WB_OED, WB_ODEL, WB_CINFO].some(k => it.text.indexOf(k) === 0);
const keyOf = t => nrm(t).replace(/[^a-z0-9]+/g, ' ').trim();
const dM = t => { const d = new Date(t + TZ_MS); return d.getUTCDate() + '/' + (d.getUTCMonth() + 1); }; // "11/10" như sale ghi

let ready = false;
async function ensure(db) {
  if (ready) return;
  await run(db, `CREATE TABLE IF NOT EXISTS wb_queue (rid INTEGER PRIMARY KEY AUTOINCREMENT, time INTEGER, src TEXT, phone TEXT, name TEXT DEFAULT '', text TEXT, result TEXT DEFAULT '', done_at INTEGER)`);
  await run(db, 'CREATE INDEX IF NOT EXISTS wb_queue_done ON wb_queue(done_at)'); // done_at NULL = còn chờ ghi → lượt chạy chỉ đọc đúng các dòng này
  await run(db, 'CREATE INDEX IF NOT EXISTS wb_queue_src ON wb_queue(src)');
  ready = true;
}
function parseSrc(r) { let cfg = {}; try { cfg = JSON.parse(r.cfg || '{}'); } catch (e) { } return { id: r.id, sale: r.sale || '', url: r.url || '', cfg }; }
const careSheet = src => (src.cfg.sheets || []).filter(s => s.role === 'care' && s.map && s.map.phone !== undefined && s.map.note !== undefined)[0];
const orderSheets = src => (src.cfg.sheets || []).filter(s => s.role === 'orders' && s.map && s.map.phone !== undefined);
/** File sale bật ghi ngược của người phụ trách (orders: có sheet lên đơn; không thì có sheet chăm sóc chọn cột SĐT + ghi chú). */
async function wbSource(x, owner, orders) {
  if (!owner) return null;
  return (await all(x.db, 'SELECT id, sale, url, cfg FROM sources WHERE sale = ? ORDER BY rid', String(owner))).map(parseSrc)
    .filter(s => s.cfg.writeBack && (orders ? orderSheets(s).length : careSheet(s)))[0] || null;
}
async function push(x, src, phone, name, text) { await run(x.db, "INSERT INTO wb_queue (time, src, phone, name, text, result) VALUES (?, ?, ?, ?, ?, '')", Date.now(), src.id, normPhone(phone), String(name || ''), text); }

/** Ghi chú chăm sóc → xếp hàng ghi vào sheet chăm sóc của sale phụ trách. raw: ghi nguyên văn (vd '@zalo'), không thêm ngày "d/M ". */
export async function wbQueue(x, owner, phone, name, text, raw) {
  await ensure(x.db);
  text = String(text || '').replace(/\s+/g, ' ').trim(); if (!text || !owner || !normPhone(phone)) return;
  const src = await wbSource(x, owner, false); if (!src) return;
  await push(x, src, phone, name, raw ? text : dM(Date.now()) + ' ' + text);
}
/** Đơn tạo trên CRM → xếp hàng thêm dòng vào sheet lên đơn của sale. */
export async function wbOrderQueue(x, owner, o) {
  await ensure(x.db);
  const src = o && o.phone && await wbSource(x, owner, true); if (!src) return;
  await push(x, src, o.phone, o.name, WB_ORDER + JSON.stringify(o));
}
/** Đổi trạng thái đơn → xếp hàng sửa ô trạng thái. owners: [người bán, người phụ trách khách] – người đầu tiên có file bật ghi ngược. */
export async function wbStatusQueue(x, owners, o) {
  await ensure(x.db);
  if (!o || !o.phone) return;
  let src = null; for (const w of owners || []) { if (!src && w) src = await wbSource(x, w, true); } if (!src) return;
  await push(x, src, o.phone, o.name, WB_OST + JSON.stringify(o));
}
/** Sửa đơn trên CRM (o.prev = SĐT / tiền trước khi sửa để tìm dòng) → xếp hàng sửa các ô của dòng đơn. */
export async function wbEditQueue(x, owners, o) {
  await ensure(x.db);
  if (!o || !o.phone) return;
  let src = null; for (const w of owners || []) { if (!src && w) src = await wbSource(x, w, true); } if (!src) return;
  await push(x, src, o.phone, o.name, WB_OED + JSON.stringify(o));
}
/** Quản trị xoá đơn trên CRM → xếp hàng ghi "Huỷ" vào ô trạng thái (để doanh số trong file khớp CRM). */
export async function wbDeleteQueue(x, owners, o) {
  await ensure(x.db);
  if (!o || !o.phone) return;
  let src = null; for (const w of owners || []) { if (!src && w) src = await wbSource(x, w, true); } if (!src) return;
  await push(x, src, o.phone, o.name, WB_ODEL + JSON.stringify(o));
}
/** Sửa tên / địa chỉ khách trên CRM → xếp hàng sửa dòng đơn gần nhất của khách trong file (o: phone, name, address). */
export async function wbInfoQueue(x, owners, o) {
  await ensure(x.db);
  if (!o || !o.phone) return;
  let src = null; for (const w of owners || []) { if (!src && w) src = await wbSource(x, w, true); } if (!src) return;
  await push(x, src, o.phone, o.name, WB_CINFO + JSON.stringify(o));
}
/** Mã đơn CRM đang chờ ghi vào file này (sửa / đổi trạng thái / xoá): lúc nhập file chưa lấy số trong file đè lên đơn đó.
 *  added: mã đơn CRM đã thêm dòng vào sheet (name) thành công → dòng đó bị sale xoá khỏi file thì xoá đơn trên CRM. */
export async function wbPending(x, srcId, sheet) {
  await ensure(x.db);
  const pend = {}, added = {}, pendPh = {}; // pendPh: SĐT khách đang chờ ghi tên / địa chỉ
  for (const r of await all(x.db, "SELECT text, result, done_at FROM wb_queue WHERE src = ? AND substr(text, 1, 1) = '@' AND (done_at IS NULL OR text LIKE '@order %')", String(srcId))) {
    let o = {}; try { o = JSON.parse(String(r.text).replace(/^@\w+ /, '')); } catch (e) { continue; }
    if (r.done_at == null && String(r.text).indexOf(WB_CINFO) === 0) { pendPh[normPhone(o.phone)] = 1; continue; }
    if (!o.id) continue;
    if (r.done_at == null) pend[o.id] = 1;
    else if (String(r.text).indexOf(WB_ORDER) === 0 && String(r.result || '').indexOf('Đã thêm đơn ' + o.id + ' vào sheet ' + sheet) === 0) added[o.id] = 1;
  }
  return { pend, added, pendPh };
}

/** Nội dung CRM đã ghi ngược vào file của sale (theo SĐT, dạng khoá so sánh) → lúc nhập file không nhập lại chính những dòng đó. */
export async function wbKeys(x, srcId) {
  await ensure(x.db);
  const wb = {}, now = Date.now(), add = (ph, k) => { (wb[ph] = wb[ph] || []).push(k); };
  for (const r of await all(x.db, "SELECT phone, text FROM wb_queue WHERE src = ? AND substr(text, 1, 1) != '@'", String(srcId))) {
    const t = String(r.text || ''), ph = normPhone(r.phone);
    SRC_UTIL.splitNote(t, null, now).forEach(e => add(ph, keyOf(e.text))); add(ph, keyOf(t.replace(/^[\d\/\s]+/, '')));
  }
  return wb;
}
export function wbHas(wb, phone, text) { const k = keyOf(text); return !!k && (wb[phone] || []).some(w => w && (w === k || w.indexOf(k) >= 0 || k.indexOf(w) >= 0)); }

/** Sheet lên đơn: cfg.orderSheet nếu quản trị chọn; không thì sheet "Đơn hàng" sale đang dùng (ngày đơn mới nhất, vd Phương: VTG_lendon). Nhớ 6 tiếng. */
async function wbOrderSheet(x, src) {
  const os = orderSheets(src); if (!os.length) return null;
  const byName = n => os.find(s => s.name === n);
  if (src.cfg.orderSheet && byName(src.cfg.orderSheet)) return byName(src.cfg.orderSheet);
  if (os.length === 1) return os[0];
  const ck = 'wbos_' + src.id, hit = await kvGet(x.db, ck); if (hit && byName(hit)) return byName(hit);
  let best = os[os.length - 1], bt = -1;
  for (const sc of os) {
    if (!has(sc.map, 'date')) continue;
    try {
      const col = SRC_UTIL.colLetter(+sc.map.date), hr = sc.header || 1; let t = 0;
      const vals = (await sheetValues(x.env, fileIdOf(src.url), a1(sc.name, col + (hr + 1) + ':' + col), 'UNFORMATTED_VALUE')).map(r => r[0]), ctx = { us: SRC_UTIL.usDates(vals) };
      vals.forEach(v => { const d = SRC_UTIL.toDate(v, ctx); if (d && d > t) t = d; });
      if (t > bt) { bt = t; best = sc; }
    } catch (e) { console.error('wbOrderSheet', sc.name, e.message); }
  }
  await kvSet(x.db, ck, best.name, 6 * 3600e3); return best;
}
/** Lệnh đơn: đơn nhập từ sheet nào thì ghi trạng thái vào đúng sheet đó; đơn tạo trên CRM → sheet đang dùng. */
async function wbOrderWrite(x, src, items) {
  const def = await wbOrderSheet(x, src); if (!def) return items.map(() => 'Bỏ qua: chưa chọn sheet lên đơn');
  const groups = {}, res = [];
  items.forEach((it, i) => {
    let o = {}; try { o = JSON.parse(it.text.replace(/^@\w+ /, '')); } catch (e) { }
    const sc = (o.sheet && orderSheets(src).find(s => s.name === o.sheet)) || def;
    (groups[sc.name] = groups[sc.name] || { sc, idx: [] }).idx.push(i);
  });
  for (const n of Object.keys(groups)) {
    const g = groups[n]; let r;
    try { r = await wbOrderWriteSheet(x, src, g.sc, g.idx.map(i => items[i])); } catch (e) { r = g.idx.map(() => 'Lỗi: ' + String(e.message || e).slice(0, 150)); }
    g.idx.forEach((i, k) => { res[i] = r[k]; });
  }
  return res;
}
async function wbOrderWriteSheet(x, src, sc, items) {
  const U = SRC_UTIL, id = fileIdOf(src.url), m = sc.map, hr = sc.header || 1, width = U.neededCols(sc), out = [], add = [], cells = {}, added = {}; let rows = null;
  const setCell = (i, f, v) => { if (has(m, f) && v !== undefined && v !== null) cells[i + '|' + m[f]] = { i, c: +m[f], v }; };
  const readRows = async () => { // đọc 1 lần các cột cần để tìm dòng đơn
    if (!rows) rows = (await sheetValues(x.env, id, a1(sc.name, 'A' + (hr + 1) + ':' + U.colLetter(width - 1)), 'UNFORMATTED_VALUE')).map(r => { r = (r || []).slice(0, width); while (r.length < width) r.push(''); return r; });
    return rows;
  };
  const day = v => { const t = typeof v === 'number' && v > 1e11 ? v : U.toDate(v, {}); return t ? fmtDate(t, 'yyyyMMdd') : ''; };
  for (const it of items) {
    let o; try { o = JSON.parse(it.text.replace(/^@\w+ /, '')); } catch (e) { out.push('Lỗi: lệnh hỏng'); continue; }
    if (it.text.indexOf(WB_ORDER) === 0) { // thêm dòng đơn mới đúng cột sale đang dùng
      const r = Array(width).fill(''), put = (f, v) => { if (has(m, f) && v !== undefined && v !== null && v !== '') r[+m[f]] = v; };
      put('date', fmtDate(Number(o.time) || Date.now(), 'dd/MM/yyyy')); put('code', o.id); put('name', o.name); put('phone', o.phone ? "'" + o.phone : ''); put('address', o.address);
      put('product', o.product); put('qty', o.qty); put('gift1', o.gift); put('gift1qty', o.giftQty); put('amount', o.total); put('status', WB_ST[o.status] || 'Đã lên đơn');
      put('shipText', o.ship); put('note', o.note); put('ctype', o.otype === 'Khách cũ' ? 'kh cũ' : o.otype === 'Khách mới' ? 'kh mới' : (o.old ? 'kh cũ' : 'kh mới') + (o.otype === 'Ngoài giờ' || o.ca === 'Tối/CN' ? ' tối' : o.otype === 'Ngày lễ' || o.ca === 'Lễ' ? ' lễ' : '')); // “Phân loại khách / ca” như sale vẫn ghi
      added[o.id] = r; add.push(r); out.push('Đã thêm đơn ' + o.id + ' vào sheet ' + sc.name); continue;
    }
    if (it.text.indexOf(WB_CINFO) === 0) { // tên / địa chỉ khách: dòng đơn gần nhất của SĐT này; tên giữ dấu "(x)" (đã kết bạn Zalo) nếu dòng cũ có
      const R = await readRows(), AL = await phoneAlias(x), mo = p => AL[p] || p, ph = mo(normPhone(o.phone)); let hit = -1;
      for (let j = R.length - 1; j >= 0 && hit < 0; j--) if (mo(U.toPhone(R[j][+m.phone])) === ph) hit = j;
      if (hit < 0) { out.push('Bỏ qua: không thấy khách ' + o.phone + ' trong sheet ' + sc.name); continue; }
      const nm0 = has(m, 'name') ? String(R[hit][+m.name] || '') : '', zx = /\(\s*[xX×]\s*\)/.test(nm0) && !/\(\s*[xX×]\s*\)/.test(o.name || '');
      if (o.name) setCell(hit, 'name', String(o.name).trim() + (zx ? '(x)' : ''));
      if (o.address) setCell(hit, 'address', o.address);
      out.push('Đã sửa tên / địa chỉ khách ở dòng ' + (hr + 1 + hit)); continue;
    }
    const ed = it.text.indexOf(WB_OED) === 0, del = it.text.indexOf(WB_ODEL) === 0;
    if (!ed && !has(m, 'status')) { out.push('Bỏ qua: sheet lên đơn chưa chọn cột trạng thái'); continue; } // đổi trạng thái / xoá
    const st = del ? 'Huỷ' : WB_ST[o.status] || o.status;
    if (added[o.id] && !ed) { added[o.id][+m.status] = st; out.push('Đã ghi trạng thái (đơn vừa thêm): ' + st); continue; } // đơn thêm cùng lượt
    const R = await readRows(); let hit = -1;
    const ph0 = normPhone((o.prev && o.prev.phone) || o.phone), tot0 = Number(o.prev ? o.prev.total : o.total) || 0; // sửa đơn: tìm dòng theo SĐT / tiền trước khi sửa
    if (has(m, 'code')) for (let i = R.length - 1; i >= 0 && hit < 0; i--) if (String(R[i][+m.code]).trim() === String(o.id)) hit = i;
    if (hit < 0) { const AL = await phoneAlias(x), mo = p => AL[p] || p; for (let j = R.length - 1; j >= 0 && hit < 0; j--) { const r2 = R[j]; if (mo(U.toPhone(r2[+m.phone])) === mo(ph0) && day(has(m, 'date') ? r2[+m.date] : '') === day(Number(o.time)) && (!has(m, 'amount') || !tot0 || U.toMoney(r2[+m.amount]) === tot0)) hit = j; } }
    if (hit < 0) { out.push('Bỏ qua: không thấy đơn ' + o.id + ' trong file'); continue; }
    if (ed) {
      setCell(hit, 'name', o.name); setCell(hit, 'phone', o.phone || undefined); // ghi RAW: chữ, giữ số 0 đầu if (o.address) setCell(hit, 'address', o.address);
      setCell(hit, 'product', o.product); setCell(hit, 'qty', o.qty); setCell(hit, 'gift1', o.gift); setCell(hit, 'gift1qty', o.giftQty); setCell(hit, 'amount', o.total); if (o.ship) setCell(hit, 'shipText', o.ship);
      out.push('Đã sửa dòng ' + (hr + 1 + hit) + ' theo đơn sửa trên CRM'); continue;
    }
    setCell(hit, 'status', st); out.push('Đã ghi trạng thái dòng ' + (hr + 1 + hit) + ': ' + st + (del ? ' (đơn đã xoá trên CRM)' : ''));
  }
  await sheetWrite(x.env, id, Object.values(cells).map(c => ({ range: a1(sc.name, U.colLetter(c.c) + (hr + 1 + c.i)), values: [[c.v]] })));
  if (add.length) await appendAt(x, id, sc.name, hr + 1 + (await readRows()).length, width, add);
  return out;
}
/** Ghi 1 lượt vào 1 file: lệnh đơn → sheet lên đơn; ghi chú → nối vào ô ghi chú dòng cuối của khách (chưa có dòng → thêm dòng mới). Trả về kết quả từng dòng, không ném lỗi. */
async function wbWrite(x, src, items) {
  if (!src || !src.cfg.writeBack) return items.map(() => 'Bỏ qua: file đã tắt ghi ngược');
  const oi = items.filter(isOrd), ni = items.filter(it => !isOrd(it)), err = e => 'Lỗi: ' + String(e.message || e).slice(0, 150);
  let ro = [], rn = [];
  if (oi.length) { try { ro = await wbOrderWrite(x, src, oi); } catch (e) { ro = oi.map(() => err(e)); } }
  if (ni.length) { try { rn = await wbNoteWrite(x, src, ni); } catch (e) { rn = ni.map(() => err(e)); } }
  let a = 0, b = 0; return items.map(it => isOrd(it) ? ro[a++] : rn[b++]);
}
/** Sheet chăm sóc phụ: sheet khác (không nhập) cùng kiểu cop số, có cột SĐT + ghi chú (vd "cop so2" của Phương: khách cũ chưa chép sang "cop số"). */
const careSheets2 = (src, sc) => (src.cfg.sheets || []).filter(s => s !== sc && (s.role === 'care' || s.role === 'skip') && s.map && s.map.phone !== undefined && s.map.note !== undefined);
/** Thông tin khách trên CRM để điền dòng mới / ô địa chỉ trống: địa chỉ + mô tả đơn gần nhất. */
async function custInfo(x, phones) {
  const out = {}; if (!phones.length) return out;
  (await allIn(x.db, "SELECT c.phone, c.address, (SELECT o.ship FROM orders o WHERE o.phone = c.phone ORDER BY o.time DESC LIMIT 1) ship FROM customers c WHERE c.phone IN (SELECT value FROM json_each(?))", phones))
    .forEach(r => { out[r.phone] = { address: String(r.address || '').trim(), ship: String(r.ship || '').trim() }; });
  return out;
}
async function wbNoteWrite(x, src, items) {
  const sc = careSheet(src); if (!sc) return items.map(() => 'Bỏ qua: chưa chọn sheet chăm sóc');
  const U = SRC_UTIL, id = fileIdOf(src.url), m = sc.map, hr = sc.header || 1, pc = U.colLetter(+m.phone), nc = U.colLetter(+m.note), hasName = has(m, 'name'), mc = hasName ? U.colLetter(+m.name) : '';
  const hasAddr = has(m, 'address'), ac = hasAddr ? U.colLetter(+m.address) : '', sc2 = careSheets2(src, sc);
  const rgs = [a1(sc.name, pc + (hr + 1) + ':' + pc), a1(sc.name, nc + (hr + 1) + ':' + nc), hasName ? a1(sc.name, mc + (hr + 1) + ':' + mc) : '', hasAddr ? a1(sc.name, ac + (hr + 1) + ':' + ac) : ''].filter(String);
  sc2.forEach(s => { const h = s.header || 1, c = U.colLetter(+s.map.phone), n = U.colLetter(+s.map.note); rgs.push(a1(s.name, c + (h + 1) + ':' + c), a1(s.name, n + (h + 1) + ':' + n)); });
  const got = await sheetBatchGet(x.env, id, rgs, 'UNFORMATTED_VALUE'), col = v => (v || []).map(r => r[0]);
  let gi = 0; const phones = col(got[gi++]), notes = col(got[gi++]), names = hasName ? col(got[gi++]) : [], addrs = hasAddr ? col(got[gi++]) : [];
  const AL = await phoneAlias(x), mainOf = p => AL[p] || p; // khách đã gộp nhiều số: dòng của số phụ trong file = dòng của khách
  const rowsOf = ph => { const last = {}, alias = {}; ph.forEach((p, i) => { const v = U.toPhone(p); if (v) { last[v] = i; if (AL[v]) alias[AL[v]] = i; } }); Object.keys(alias).forEach(v => { if (last[v] === undefined) last[v] = alias[v]; }); return last; };
  const lastRow = rowsOf(phones);
  // khách không có trong sheet chăm sóc chính → tìm ở sheet phụ (15/10/2026: Phương chăm khách cũ nằm ở "cop so2", CRM lại thêm dòng trống ở cuối "cop số")
  const alt = sc2.map(s => { const p = col(got[gi++]), n = col(got[gi++]); return { s, notes: n, last: rowsOf(p), upd: {} }; });
  const info = await custInfo(x, [...new Set(items.map(it => it.phone))]);
  const nameUpd = {}, cellUpd = {}, addrUpd = {}, add = [], newRow = {}, out = [], width = U.neededCols(sc), today = dM(Date.now());
  const append = (cur, t) => { cur = String(cur == null ? '' : cur).replace(/[\s,]+$/, ''); return cur ? cur + ', ' + t : t; };
  for (const it of items) {
    const i = lastRow[it.phone], ci = info[it.phone] || info[mainOf(it.phone)] || {};
    if (it.text === WB_ZALO) { // đã kết bạn Zalo: thêm "(x)" vào tên ở mọi dòng của khách (dòng nào chưa có)
      if (!hasName) { out.push('Bỏ qua: sheet chưa chọn cột tên'); continue; }
      let cnt = 0; phones.forEach((p, j) => { if (mainOf(U.toPhone(p)) !== mainOf(it.phone)) return; const nm = String(nameUpd[j] !== undefined ? nameUpd[j] : names[j] == null ? '' : names[j]); if (!/\(\s*[xX×]\s*\)/.test(nm)) { nameUpd[j] = nm.replace(/\s+$/, '') + '(x)'; cnt++; } });
      out.push(cnt ? 'Đã thêm (x) vào ' + cnt + ' dòng' : (i === undefined ? 'Bỏ qua: không thấy khách trong file' : 'Tên đã có (x)')); continue;
    }
    if (i !== undefined) {
      cellUpd[i] = append(cellUpd[i] !== undefined ? cellUpd[i] : notes[i], it.text); out.push('Đã ghi dòng ' + (hr + 1 + i));
      if (hasAddr && ci.address && !String(addrs[i] == null ? '' : addrs[i]).trim()) addrUpd[i] = ci.address; // dòng CRM thêm trước đây chưa có địa chỉ → bổ sung
      continue;
    }
    const a = alt.find(A => A.last[it.phone] !== undefined);
    if (a) { const j = a.last[it.phone]; a.upd[j] = append(a.upd[j] !== undefined ? a.upd[j] : a.notes[j], it.text); out.push('Đã ghi sheet ' + a.s.name + ' dòng ' + ((a.s.header || 1) + 1 + j)); continue; }
    if (newRow[it.phone]) { const row = newRow[it.phone]; row[+m.note] += ', ' + it.text; out.push('Đã ghi vào dòng mới thêm'); continue; } // khách mới thêm cùng lượt: gộp vào 1 dòng
    const row = Array(width).fill(''); if (has(m, 'date')) row[+m.date] = today; if (hasName) row[+m.name] = it.name; row[+m.phone] = "'" + it.phone; row[+m.note] = it.text;
    if (hasAddr) row[+m.address] = ci.address || ''; if (has(m, 'shipText') && +m.shipText < width) row[+m.shipText] = ci.ship || ''; // khách đã mua: điền địa chỉ + đơn gần nhất cho đủ thông tin
    add.push(row); newRow[it.phone] = row; out.push('Đã thêm dòng mới');
  }
  const wr = Object.keys(cellUpd).map(i => ({ range: a1(sc.name, nc + (hr + 1 + +i)), values: [[cellUpd[i]]] }))
    .concat(Object.keys(nameUpd).map(i => ({ range: a1(sc.name, mc + (hr + 1 + +i)), values: [[nameUpd[i]]] })))
    .concat(Object.keys(addrUpd).map(i => ({ range: a1(sc.name, ac + (hr + 1 + +i)), values: [[addrUpd[i]]] })));
  alt.forEach(A => { const h = A.s.header || 1, n = U.colLetter(+A.s.map.note); Object.keys(A.upd).forEach(j => wr.push({ range: a1(A.s.name, n + (h + 1 + +j)), values: [[A.upd[j]]] })); });
  await sheetWrite(x.env, id, wr);
  if (add.length) await appendAt(x, id, sc.name, hr + 1 + Math.max(phones.length, notes.length, names.length, addrs.length), width, add);
  return out;
}
/** Thêm dòng vào CUỐI sheet. Trước đây gọi append từ ô A<dòng tiêu đề>: ô A tiêu đề để trống (vd "cop số" của Phương) thì Google không nhận ra bảng
 *  → chèn dòng mới lên TRÊN CÙNG, đẩy cả bảng xuống (13/10/2026). Nay chỉ thẳng dòng ngay sau dòng có dữ liệu cuối cùng. */
async function appendAt(x, id, name, row, width, add) {
  await sheetAppend(x.env, id, a1(name, 'A' + row + ':' + SRC_UTIL.colLetter(width - 1) + row), add);
}

/** Lịch 10 phút/lần: ghi các dòng đang chờ, gom theo file (mỗi file 1–3 lần gọi Google). Hàng trống → 1 câu SELECT theo chỉ mục rồi thôi. Không bao giờ ném lỗi ra ngoài. */
export async function wbTick(x) {
  try {
    await ensure(x.db);
    const q = await all(x.db, 'SELECT rid, time, src, phone, name, text, result FROM wb_queue WHERE done_at IS NULL ORDER BY rid LIMIT 500');
    if (!q.length) return { n: 0 };
    const now = Date.now(), done = [], bySrc = {};
    q.forEach(r => {
      if (now - r.time > RETRY_MS) done.push({ i: r.rid, r: r.result || 'Bỏ qua: quá 7 ngày chưa ghi được', d: now }); // lỗi mãi (vd chưa có quyền sửa) → thôi
      else (bySrc[r.src] = bySrc[r.src] || []).push(r);
    });
    const srcs = {}; (await allIn(x.db, 'SELECT id, sale, url, cfg FROM sources WHERE id IN (SELECT value FROM json_each(?))', Object.keys(bySrc))).forEach(r => { srcs[r.id] = parseSrc(r); });
    for (const id of Object.keys(bySrc)) {
      const rs = bySrc[id], bk = 'wbe_' + id;
      if (rs.every(r => /^Lỗi/.test(r.result || '')) && await kvGet(x.db, bk)) continue; // file vừa lỗi, không có dòng mới → 30 phút sau mới thử lại
      let res;
      try { res = srcs[id] ? await wbWrite(x, srcs[id], rs.map(r => ({ phone: normPhone(r.phone), name: String(r.name || ''), text: String(r.text || '') }))) : rs.map(() => 'Bỏ qua: không còn nguồn dữ liệu này'); }
      catch (e) { res = rs.map(() => 'Lỗi: ' + String(e.message || e).slice(0, 150)); }
      let bad = false;
      rs.forEach((r, k) => { const v = String(res[k] || 'Lỗi: không rõ'), er = /^Lỗi/.test(v); if (er) bad = true; done.push({ i: r.rid, r: v, d: er ? null : now }); });
      if (bad) { try { await kvSet(x.db, bk, '1', BACKOFF_MS); } catch (e) { } }
    }
    for (let i = 0; i < done.length; i += 300) await run(x.db, "UPDATE wb_queue SET result = json_extract(j.value, '$.r'), done_at = json_extract(j.value, '$.d') FROM json_each(?) j WHERE wb_queue.rid = json_extract(j.value, '$.i')", JSON.stringify(done.slice(i, i + 300)));
    await run(x.db, 'DELETE FROM wb_queue WHERE done_at < ?', now - KEEP_MS); // giữ 60 ngày gần nhất
    return { n: done.length };
  } catch (e) { console.error('wbTick', e.message); return { error: e.message }; }
}
