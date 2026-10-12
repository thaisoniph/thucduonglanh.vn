// Đồng bộ dữ liệu từ file Google Sheet của sale (lên đơn, cop số, từ chối) và file số quảng cáo chung.
// Đọc bằng Google Sheets API (nhanh, không phải mở cả file như Apps Script). Nhập nhiều lần không trùng.
import { normPhone, esc, fmtDate, nrm, isVoid, hashKey, hashKeyLegacy, all, first, run, insertMany, allIn, kvGet, kvSet, kvDel, kvJson, CRM_URL, DAY } from './lib.js';
import { sheetMeta, sheetValues, sheetWrite, a1, serialToMs } from './google.js';
import { wbKeys, wbHas } from './wb.js';
import { crmUsers, crmLog, recalc, deletedOrderIds, delMark, setCallbacks, caCfg, caOf, normLine, itemsText, shipText, ORDER_COLS, srcList, adsCfg, telegramUser, unifyNames } from './crm.js';

const FIELD_LABEL = { date: 'Ngày', name: 'Tên khách', phone: 'SĐT', address: 'Địa chỉ', product: 'Sản phẩm', qty: 'Số lượng', gift1: 'Quà tặng 1', gift1qty: 'SL quà 1', gift2: 'Quà tặng 2', gift2qty: 'SL quà 2',
  status: 'Trạng thái', ctype: 'Phân loại khách / ca', line: 'Dòng SP (nguồn)', code: 'Mã đơn', amount: 'Số tiền', shipText: 'Lên đơn (mô tả)', callback: 'Lịch gọi lại', note: 'Ghi chú / nhật ký', health: 'Tình trạng sức khoẻ',
  sale: 'Sale được chia', dup: 'Trùng sale', src: 'Nguồn quảng cáo' };
const LEAD_COLS = ['id', 'time', 'name', 'phone', 'channel', 'interest', 'status', 'owner', 'last_at', 'callback', 'reason', 'note', 'order_id', 'by_name'];

export function fileIdOf(url) { const m = String(url || '').match(/\/d\/([a-zA-Z0-9_-]{20,})/) || String(url || '').match(/^([a-zA-Z0-9_-]{25,})$/); return m ? m[1] : ''; }
function colLetter(i) { let s = ''; i++; while (i > 0) { const m = (i - 1) % 26; s = String.fromCharCode(65 + m) + s; i = Math.floor((i - 1) / 26); } return s; }
const isSerial = v => typeof v === 'number' && v > 20000 && v < 80000;
function cellText(v) { return String(v == null ? '' : v); }
function avgLen(S, i) { let n = 0, t = 0; S.forEach(r => { const v = r[i]; if (v !== '' && v != null) { n++; t += String(v).length; } }); return n ? t / n : 0; }
function isDateLike(v) { return /^\d{1,2}\/\d{1,2}(\/\d{2,4})?/.test(String(v || '').trim()) || /^\d{4}-\d{2}-\d{2}/.test(String(v || '').trim()); }
const pad = (r, n) => { r = (r || []).slice(0, n); while (r.length < n) r.push(''); return r; };

/* ---------- đọc giá trị trong file cũ */
function toPhone(v) { let p = String(v == null ? '' : v).split('.')[0].replace(/\D/g, ''); if (p.indexOf('84') === 0 && p.length === 11) p = '0' + p.slice(2); if (p.length === 9) p = '0' + p; return /^0\d{9,10}$/.test(p) ? p : ''; }
function toMoney(v) {
  if (typeof v === 'number') return Math.round(v);
  const s = String(v || '').toLowerCase().replace(/\s/g, '').replace(/đ|vnd/g, ''); if (!s) return 0;
  const m = s.match(/^(\d+)(?:[.,](\d+))?(tr|trieu|triệu|m|k|nghin|nghìn|ngan|ngàn)(\d*)$/); // 1tr8, 1,8tr, 800k
  if (m) { const mul = /^(k|ng)/.test(m[3]) ? 1e3 : 1e6; return Math.round(parseFloat(m[1] + '.' + (m[2] || m[4] || '0')) * mul); }
  const n = parseInt(s.replace(/\D/g, ''), 10); return isNaN(n) ? 0 : n;
}
function toQty(v) { const n = parseInt(String(v == null ? '' : v), 10); return n > 0 ? n : 0; }
const yearOf = t => new Date(t + 7 * 3600e3).getUTCFullYear();
/** Ngày trong file: số sê-ri (ô ngày thật) hoặc chữ "30/9", "30/09/2026". Trả về mili giây hoặc null. */
function toDate(v, ctx, code) {
  ctx.sw = 0;
  if (isSerial(v)) {
    let t = serialToMs(v); const d = new Date(t + 7 * 3600e3);
    if (ctx.us && d.getUTCDate() <= 12 && !codeNear(code, d.getUTCDate(), d.getUTCMonth() + 1)) { t = Date.UTC(d.getUTCFullYear(), d.getUTCDate() - 1, d.getUTCMonth() + 1) - 7 * 3600e3; ctx.sw = 1; } // file để định dạng Mỹ: gõ "7/3" bị hiểu là 3/7 → đảo lại
    if (t > Date.now() + 30 * DAY) return null; ctx.y = yearOf(t); return t; // ngày tương lai xa = gõ nhầm → bỏ dòng
  }
  const s = String(v == null ? '' : v).trim();
  const iso = s.match(/^(\d{4})-(\d{2})-(\d{2})/); if (iso) { const t = new Date(iso[1] + '-' + iso[2] + '-' + iso[3] + 'T09:00:00+07:00').getTime(); if (isNaN(t)) return null; ctx.y = +iso[1]; return t; }
  const m = s.match(/^(\d{1,2})\/(\d{1,2})(?:\/(\d{2,4}))?/); if (!m) return null;
  let y = m[3] ? (m[3].length === 2 ? 2000 + (+m[3]) : +m[3]) : ctx.y || yearOf(Date.now()); ctx.y = y;
  let t = new Date(y + '-' + ('0' + m[2]).slice(-2) + '-' + ('0' + m[1]).slice(-2) + 'T09:00:00+07:00').getTime(); if (isNaN(t)) return null;
  if (!m[3] && t > Date.now() + 2 * DAY) { t = new Date((y - 1) + '-' + ('0' + m[2]).slice(-2) + '-' + ('0' + m[1]).slice(-2) + 'T09:00:00+07:00').getTime(); ctx.y = y - 1; } // "31/12" gõ không kèm năm → năm trước
  return t;
}
/** Cột ngày của file để định dạng Mỹ (tháng/ngày)? Gõ "23/1" không thành ngày (giữ chữ), gõ "7/3" thành ngày 3/7.
 *  Dấu hiệu: có ≥ 3 ô chữ kiểu "23/1" (số đầu > 12) và gần như mọi ô ngày thật đều có ngày ≤ 12 (12/10/2026: file Chang, sheet Lên đơn). */
function usDates(vals) {
  let ser = 0, big = 0, txt = 0;
  vals.forEach(v => { if (isSerial(v)) { ser++; if (new Date(serialToMs(v) + 7 * 3600e3).getUTCDate() > 12) big++; } else { const m = String(v == null ? '' : v).trim().match(/^(\d{1,2})\/(\d{1,2})/); if (m && +m[1] > 12 && +m[2] <= 12) txt++; } });
  return ser >= 3 && txt >= 3 && big <= ser * 0.02;
}
function dateCtx(rows, m) { return { us: usDates(rows.map(r => cell(r, m, 'date'))) }; }
/** Ngày trong mã đơn: tên + ngày + tháng + số thứ tự trong ngày ("Chang090601" = 09/06 đơn 01). Tên có thể có dấu, dấu chấm, khoảng trắng
 *  ("Lương 010401", "T.THUY240701"), sau số có thể có chữ ("Chang250401A", "THU120501 - 1 GAFO 500G"). 7 chữ số: ddMM + 3 số hoặc 0 + ddMM + 2 số
 *  ("TUAN0141101"), hoặc gõ thừa số → trả mọi cách đọc hợp lệ [[ngày, tháng]]. */
const CODE_RE = /^[\p{L}.\s]{2,16}?(\d{5,7})(?!\d)/u;
function codeDays(code) {
  const m = String(code || '').trim().match(CODE_RE); if (!m) return [];
  const D = m[1], out = [];
  for (const i of D.length === 7 ? [0, 1] : [0]) { const d = +D.substr(i, 2), mo = +D.substr(i + 2, 2); if (d >= 1 && d <= 31 && mo >= 1 && mo <= 12) out.push([d, mo]); }
  return out;
}
function codeDay(code) { const c = codeDays(code)[0]; return c ? c[0] + '/' + c[1] : ''; }
/** Ngày của từng dòng sheet đơn hàng. Có mã đơn đọc được ngày → ngày/tháng theo mã đơn (anh Sơn chọn 12/10/2026, mã do sale điền khi lên đơn).
 *  Năm: ô ngày có năm (ô ngày thật / "30/9/2025") → năm làm ngày gần ô đó nhất; ô trống / không có năm → suy từ dưới lên (đơn mới ở dưới):
 *  năm của các dòng bên dưới (`anchor`), ngày sau anchor quá 20 ngày thì lùi 1 năm.
 *  Mã lệch ô ngày quá 45 ngày (1 trong 2 gõ nhầm): lấy bên nào gần các dòng xung quanh hơn (`far`).
 *  Trả về [{ t, sw (ô bị đảo kiểu Mỹ), old (ngày theo ô như bản cũ), code (1 = ngày đổi theo mã), far }]. */
function orderDates(rows, m) {
  const ctx = dateCtx(rows, m), now = Date.now(), out = rows.map(r => {
    const raw = cell(r, m, 'date'), code = String(cell(r, m, 'code') || '').trim(), t = toDate(raw, ctx, code);
    const full = !!t && (isSerial(raw) || /^\s*\d{1,2}\/\d{1,2}\/\d{2,4}/.test(String(raw)) || /^\d{4}-\d{2}-\d{2}/.test(String(raw).trim()));
    return { t, sw: ctx.sw, old: t, cds: codeDays(code), full };
  });
  const day = t => fmtDate(t, 'yyyyMMdd');
  // anchor: ngày của các dòng bên dưới. 1 dòng gõ nhầm không được kéo lệch năm các dòng trên: ngày sớm hơn anchor quá 60 ngày
  // chỉ nhận làm anchor khi 3 dòng liền nhau đều như vậy (sheet thật sự lùi về quá khứ).
  let anchor = now + 2 * DAY, low = [];
  const byAnchor = ([d, mo]) => { let y = vnYear(anchor), c = vnMs(y, mo, d); if (c > anchor + 20 * DAY) c = vnMs(--y, mo, d); if (c > now + 2 * DAY) c = vnMs(y - 1, mo, d); return c; };
  const nearest = (L, ref) => L.slice().sort((a, b) => Math.abs(a - ref) - Math.abs(b - ref))[0];
  for (let i = out.length - 1; i >= 0; i--) {
    const o = out[i]; if (!o.cds.length && !o.t) continue;
    let t = o.t;
    if (o.cds.length) {
      if (o.t) { // có ô ngày: mã gần ô ngày (≤ 45 ngày) → theo mã
        const y0 = vnYear(o.t), c = nearest(o.cds.flatMap(([d, mo]) => [y0 - 1, y0, y0 + 1].map(y => vnMs(y, mo, d))), o.t);
        if (Math.abs(c - o.t) <= 45 * DAY) t = o.full ? c : byAnchor(fmtDate(c, 'dd/MM').split('/').map(Number));
        else { o.far = 1; const cand = o.cds.map(byAnchor).concat([o.full ? o.t : byAnchor(fmtDate(o.t, 'dd/MM').split('/').map(Number))]); t = nearest(cand, anchor); }
      } else t = nearest(o.cds.map(byAnchor), anchor); // ô ngày trống
    } else if (!o.full) t = byAnchor(fmtDate(o.t, 'dd/MM').split('/').map(Number));
    if (!o.t || day(t) !== day(o.t)) { o.t = t; o.code = 1; o.byCode = o.cds.length > 0; }
    if (o.t > now + 30 * DAY) { o.t = null; continue; }
    if (o.t >= anchor - 60 * DAY) { anchor = Math.min(Math.max(o.t, anchor - 60 * DAY), now + 2 * DAY); low = []; }
    else if (low.push(o.t) >= 3) { anchor = low[low.length - 1]; low = []; }
  }
  return out;
}
function codeNear(code, day, mon) { // ngày trong mã đơn cách ngày/tháng này ≤ 4 ngày (trong năm)
  const c = codeDay(code); if (!c) return false; const [d, m] = c.split('/').map(Number);
  return Math.abs(Date.UTC(2001, m - 1, d) - Date.UTC(2001, mon - 1, day)) <= 4 * DAY;
}
/* ---------- ô ghi chú kiểu Sheet "21/7 kh nhận hàng, 9/8 knm, 16/5 kh hết tiền" → từng lần chăm sóc có ngày (năm tự suy theo thứ tự) */
function vnMs(y, mo, d) { return Date.UTC(y, mo - 1, d, 2); } // 9h sáng giờ VN
function vnYear(t) { return new Date(t + 7 * 3600e3).getUTCFullYear(); }
function splitNote(text, base, now) {
  text = String(text || '').trim(); if (!text) return [];
  var re = /(?:^|[,;\n]|\.\s)\s*(\d{1,2})\/(\d{1,2})(?:\/(\d{2,4}))?(?![\d\/])/g, marks = [], k;
  while ((k = re.exec(text))) if (+k[1] >= 1 && +k[1] <= 31 && +k[2] >= 1 && +k[2] <= 12) marks.push({ at: k.index, end: re.lastIndex, d: +k[1], mo: +k[2], y: k[3] ? (k[3].length === 2 ? 2000 + (+k[3]) : +k[3]) : 0 });
  var out = [], prev = base || now, clean = function (s) { return s.replace(/^[\s,;.:\-–]+|[\s,;.\-–]+$/g, ''); };
  var head = clean(text.slice(0, marks.length ? marks[0].at : text.length)); if (head) out.push({ t: base || null, text: head, res: noteResult(head) });
  marks.forEach(function (m, i) {
    var body = clean(text.slice(m.end, i + 1 < marks.length ? marks[i + 1].at : text.length)); if (!body) return;
    var t = vnMs(m.y || vnYear(prev), m.mo, m.d);
    if (!m.y) { if (t < prev - 20 * 864e5) t = vnMs(vnYear(prev) + 1, m.mo, m.d); while (t > now + 2 * 864e5) t = vnMs(vnYear(t) - 1, m.mo, m.d); } // 16/5 sau 15/12 → năm sau
    prev = t; out.push({ t: t, text: body, res: noteResult(body) });
  });
  return out;
}
/** Kết quả của 1 lần ghi (theo cách viết tắt quen dùng của sale). */
function noteResult(s) {
  var n = nrm(s);
  if (/^(kh )?(toi|cn|le|chu nhat|ngay)$/.test(n)) return ''; // "kh tối", "kh lễ" = ghi ca, không phải lần chăm sóc
  if (/(^|[^a-z])(knm|kbm|tb)([^a-z]|$)|thue bao|(k|ko|khong|chua) (nghe|bat may)|tat may|may ban|tu choi nghe|(k|ko|khong) lien lac/.test(n)) return 'Không nghe máy';
  if (/(k|ko|khong) (dung|mua|lay)( gi)? nua|(k|ko|khong) (co )?nhu cau|tu choi/.test(n)) return 'Không có nhu cầu';
  if (/(^|[^a-z])hen([^a-z]|$)/.test(n)) return 'Hẹn gọi lại';
  if (/mua lai|dat lai|lay them|lay tiep|mua tiep|dat them|len don|chot don/.test(n)) return 'Đã đặt lại';
  return 'Đã hỏi thăm';
}
/** Ký hiệu trong tên khách: "(cô Bình gt)" = người giới thiệu, "(0961912253)" = số điện thoại khác. */
function nameMarks(name) {
  var out = [];
  String(name || '').replace(/\(([^)]*)\)/g, function (all, x) {
    var ph = toPhone(x.replace(/\s/g, '')); if (ph) out.push('SĐT khác: ' + ph);
    else if (/(^|\s)gt(\s|$)|gioi thieu/.test(nrm(x))) out.push('Người giới thiệu: ' + x.replace(/\s*(gt|giới thiệu)\s*$/i, '').trim());
    return all;
  });
  return out;
}
const EXPLICIT = /hoan|huy|bom|doi|giao thanh cong|da giao|thanh cong/, FILE_BY = 'File sale'; // trạng thái sale ghi rõ trong file (không phải để trống)
function mapStatus(v, when) {
  const s = nrm(v);
  if (/hoan (thanh|tat)/.test(s)) return 'Đã giao'; // "Hoàn thành" / "Hoàn tất" = giao xong, không phải hoàn hàng
  if (/hoan/.test(s)) return 'Hoàn';
  if (/huy|bom/.test(s)) return 'Huỷ';
  if (/doi/.test(s)) return 'Đổi hàng';
  if (/giao thanh cong|da giao|thanh cong/.test(s)) return 'Đã giao';
  if (/dang giao/.test(s)) return 'Đang giao';
  return when && Date.now() - when > 14 * DAY ? 'Đã giao' : 'Đang giao'; // "Đã lên đơn" / trống: đơn cũ coi như đã giao
}
function caFromText(v, when, cfg) {
  const s = nrm(v);
  if (/(^| )le( |$)/.test(s)) return 'Lễ';
  if (/toi|(^| )cn( |$)|chu nhat/.test(s)) return 'Tối/CN';
  return when ? caOf(when, { evening: '23:59', holidays: cfg.holidays }) : 'Ngày'; // file cũ không có giờ: chỉ xét Chủ nhật & ngày lễ
}
/** Tên sản phẩm chính của đơn đã nhập (dòng đầu của items, bỏ " x4 = …"), chữ thường không dấu để so với file. */
const prodOf = items => nrm(String(items || '').split('\n')[0].replace(/^🎁\s*/, '').replace(/\s+x\d+\s*=.*$/, ''));
function cell(r, m, k) { if (m[k] === undefined || m[k] === null || m[k] === '') return ''; const v = r[m[k]]; return v === undefined || v === null ? '' : v; }
function neededCols(shCfg) {
  let mx = 0; Object.keys(shCfg.map || {}).forEach(k => { const v = Number(shCfg.map[k]); if (v + 1 > mx) mx = v + 1; });
  (shCfg.extra || []).forEach(v => { if (Number(v) + 1 > mx) mx = Number(v) + 1; });
  return Math.max(mx, 1);
}
const nonEmpty = r => (r || []).some(c => c !== '' && c != null);

/** Đoán cột theo tiêu đề + dữ liệu mẫu. */
function detectMap(H, S, sheetName, ads) {
  const m = {}, used = {}, h = H.map(nrm);
  const find = (re, from) => { for (let i = from || 0; i < h.length; i++) if (!used[i] && re.test(h[i])) return i; return -1; };
  const set = (k, i) => { if (i >= 0 && i < H.length) { m[k] = i; used[i] = 1; } };
  set('phone', find(/sdt|so dt|dien thoai|so dien/));
  set('name', find(/^ten|ho ten|khach hang/));
  if (ads) {
    set('src', find(/^nguon/)); set('sale', find(/^sale/)); set('dup', find(/trung/)); set('ctype', find(/^nguon|phan loai/)); set('amount', find(/don hang|so tien/)); set('note', find(/ghi chu/));
  } else {
    set('code', find(/ma don/)); set('amount', find(/so tien|thanh tien|tong tien/)); set('status', find(/tra?n?g thai/)); set('ctype', find(/phan loai khach/));
    set('line', find(/phan loai nguon|dong sp|^nguon/)); set('shipText', find(/^len don$/)); set('callback', find(/lich goi lai|hen goi/)); set('address', find(/dia chi/)); set('health', find(/tinh trang sk|suc khoe/));
    const p = find(/san pham/); set('product', p); if (p >= 0) set('qty', find(/so l[uo]+ng|^sl$/, p + 1));
    const g1 = find(/qua tang/); set('gift1', g1); if (g1 >= 0) set('gift1qty', find(/so l[uo]+ng|^sl$/, g1 + 1));
    const g2 = find(/qua tang/); set('gift2', g2); if (g2 >= 0) set('gift2qty', find(/so l[uo]+ng|^sl$/, g2 + 1));
    if (m.gift1 === undefined && m.qty !== undefined && !h[m.qty + 1] && avgLen(S, m.qty + 1) > 3) { set('gift1', m.qty + 1); if (!h[m.qty + 2]) set('gift1qty', m.qty + 2); }
    set('note', find(/ghi chu/));
    if (m.address === undefined && m.phone !== undefined && !used[m.phone + 1] && avgLen(S, m.phone + 1) > 15) set('address', m.phone + 1);
  }
  let d = find(/thoi gian|^ngay/); if (d < 0 && !used[0] && S.filter(r => isDateLike(r[0])).length >= Math.min(2, S.length)) d = 0; set('date', d);
  if (!ads) { // ghi chú: cột chữ dài nhất còn lại nếu cột "ghi chú" gần như trống
    let best = -1, bl = 0; for (let i = 0; i < H.length; i++) if (!used[i]) { const l = S.some(r => isDateLike(r[i])) ? 0 : avgLen(S, i); if (l > bl) { bl = l; best = i; } }
    if ((m.note === undefined || avgLen(S, m.note) < 5) && best >= 0 && bl > 20) { if (m.note !== undefined) delete used[m.note]; m.note = best; used[best] = 1; }
    // cột "ghi chú" thực chất là mô tả lên đơn ("4 hộp …", "7 lon …") → dùng làm Lên đơn
    if (m.note !== undefined && m.shipText === undefined) { const sv = S.map(r => String(r[m.note] || '')).filter(String); if (sv.length && sv.filter(x => /^\d+\s*(hộp|hop|lon|gói|goi|hũ|hu|chai|thùng|thung|túi)/i.test(x)).length >= sv.length * 0.6) { m.shipText = m.note; delete m.note; } }
  }
  const role = ads ? (m.phone !== undefined ? 'ads' : 'skip') : /tu choi|bom/.test(nrm(sheetName)) ? 'reject' : m.code !== undefined && m.product !== undefined ? 'orders' : m.phone !== undefined && m.name !== undefined ? 'care' : 'skip';
  return { map: m, role };
}

/** Xem file: danh sách sheet (d.list), hoặc 1 sheet (d.sheet): dòng tiêu đề, cột đoán được, vài dòng mẫu. */
async function inspect(x, u, d, ads) {
  const id = fileIdOf(d.url); if (!id) return { ok: false, error: 'Link file Google Sheet chưa đúng.' };
  const isReport = nm => /^(bcdt|bao cao|bc )/.test(nrm(nm)); // sheet báo cáo: không cần đọc
  const meta = await sheetMeta(x.env, id), names = (meta.sheets || []).slice(0, 60).map(s => s.properties.title), fileName = meta.properties.title;
  if (d.list) return { ok: true, fileId: id, fileName, sheets: names.map(nm => ({ name: nm, report: isReport(nm) })), fields: FIELD_LABEL };
  const out = [];
  for (const nm of (d.sheet ? names.filter(n => n === d.sheet) : names)) {
    if (!d.sheet && isReport(nm)) { out.push({ name: nm, rows: '', role: 'skip', headers: [], unread: true }); continue; }
    const rows = await sheetValues(x.env, id, a1(nm, 'A1:AD'), 'FORMATTED_VALUE');
    const lr = rows.length, lc = Math.min(30, Math.max(0, ...rows.slice(0, 50).map(r => r.length)));
    if (lr < 2 || lc < 2) { out.push({ name: nm, rows: lr, role: 'skip', headers: [] }); continue; }
    const top = rows.slice(0, 8).map(r => pad(r, lc)); let hr = -1;
    for (let i = 0; i < Math.min(5, top.length); i++) { const t = top[i].map(nrm).join('|'); if (/sdt|dien thoai/.test(t) && /ten|khach/.test(t)) { hr = i; break; } }
    if (hr < 0) { out.push({ name: nm, rows: lr, role: 'skip', headers: [] }); continue; }
    const H = top[hr].map(cellText), n = Math.min(lr - hr - 1, 6);
    const tail = lr - hr - 1 > 6 ? rows.slice(Math.max(hr + 1 + n, lr - 12)).filter(nonEmpty).slice(-4).map(r => pad(r, lc)) : [];
    const S = top.slice(hr + 1, hr + 1 + n).concat(tail);
    const det = detectMap(H, S, nm, ads);
    out.push({ name: nm, rows: lr - hr - 1, header: hr + 1, headers: H.map((v, k) => colLetter(k) + (v ? ' · ' + v : '')), samples: S.map(r => r.map(c => cellText(c).slice(0, 60))), role: det.role, map: det.map });
  }
  return { ok: true, fileId: id, fileName, sheets: out, fields: FIELD_LABEL };
}

/* ---------- danh sách nguồn (file sale) */
async function srcSave(x, u, d) {
  const list = await srcList(x), id = d.id || 'SRC' + Date.now().toString(36), cur = list.find(s => s.id === id);
  const cfg = d.cfg || (cur && cur.cfg) || {}; if (cur && cur.cfg && cur.cfg.done && !cfg.done) cfg.done = cur.cfg.done;
  const sale = d.sale || (cur && cur.sale) || '', url = d.url || (cur && cur.url) || '', fileName = d.fileName || (cur && cur.fileName) || '';
  if (cur) await run(x.db, 'UPDATE sources SET sale = ?, url = ?, file_name = ?, cfg = ? WHERE id = ?', sale, url, fileName, JSON.stringify(cfg), id);
  else await run(x.db, "INSERT INTO sources (id, sale, url, file_name, cfg, last, result) VALUES (?, ?, ?, ?, ?, NULL, '')", id, sale, url, fileName, JSON.stringify(cfg));
  await crmLog(x, u, 'Nguồn dữ liệu', id, sale, cur ? 'Sửa cấu hình' : 'Thêm file ' + fileName, '');
  return { ok: true, id };
}
async function srcDelete(x, u, d) {
  const cur = (await srcList(x)).find(s => s.id === d.id); if (!cur) return { ok: false, error: 'Không tìm thấy' };
  await run(x.db, 'DELETE FROM sources WHERE id = ?', d.id); await crmLog(x, u, 'Nguồn dữ liệu', d.id, cur.sale, 'Xoá nguồn (dữ liệu đã nhập vẫn giữ)', ''); return { ok: true };
}
async function sha1(t) { const h = await crypto.subtle.digest('SHA-1', new TextEncoder().encode(t)); return [...new Uint8Array(h)].map(b => b.toString(16).padStart(2, '0')).join(''); }
async function srcRows(x, src, shCfg) {
  const hr = shCfg.header || 1, lc = neededCols(shCfg); // chỉ đọc đúng số cột cần
  const vals = await sheetValues(x.env, fileIdOf(src.url), a1(shCfg.name, 'A' + hr + ':' + colLetter(lc - 1)), 'UNFORMATTED_VALUE');
  if (!vals.length) return { rows: [], headers: [] };
  return { headers: pad(vals[0], lc), rows: vals.slice(1).map(r => pad(r, lc)) };
}

/** Đồng bộ 1 sheet của 1 file sale. d = { id, name (tên sheet), dry }. */
async function srcSync(x, u, d) {
  const src = (await srcList(x)).find(s => s.id === d.id); if (!src) return { ok: false, error: 'Không tìm thấy nguồn.' };
  const sheets = src.cfg.sheets || [];
  if (d.name) { d.sheet = -1; sheets.forEach((s, i) => { if (s.name === d.name) d.sheet = i; }); }
  const shCfg = sheets[d.sheet]; if (!shCfg || shCfg.role === 'skip') return { ok: false, error: 'Sheet "' + (d.name || d.sheet) + '" không được chọn để nhập.' };
  const sale = src.sale; if (!(await crmUsers(x)).some(y => y.name === sale)) return { ok: false, error: 'Chưa có nhân sự tên "' + sale + '" trong CRM. Thêm ở Cài đặt → Nhân sự trước.' };
  if (Number(d.offset) > 0) return { ok: true, role: shCfg.role, sheetName: shCfg.name, total: 0, newOrders: 0, dup: 0, skip: 0, customers: 0, newCustomers: 0, conflicts: [], conflictCount: 0, revenue: 0, summary: '' }; // bản cũ gửi từng phần: phần đầu đã xử lý hết
  const data = await srcRows(x, src, shCfg), total = data.rows.length; let res;
  // tự nhập 25 phút/lần: sheet không đổi chữ nào so với lần trước → bỏ qua, không đọc / ghi máy chủ dữ liệu
  const auto = u.name === 'Tự động' && !d.dry, sigKey = 'ss_' + hashKey(src.id + '|' + shCfg.name);
  const sig = auto ? await sha1('d4#' + src.sale + '#' + (src.cfg.until || '') + '#' + JSON.stringify(shCfg) + '#' + JSON.stringify(data.rows)) : '';
  if (auto && await kvGet(x.db, sigKey) === sig) return { ok: true, role: shCfg.role, sheetName: shCfg.name, total, skipped: true, summary: 'không đổi' };
  if (!d.dry && (shCfg.role === 'orders' || shCfg.role === 'care')) { try { await notePhones(x, src, shCfg, data.rows); } catch (e) { console.error('notePhones', sale, shCfg.name, e.message); } }
  if (shCfg.role === 'orders') res = await importOrders(x, src, shCfg, data, !!d.dry);
  else if (shCfg.role === 'care') res = await importCare(x, src, shCfg, data, !!d.dry, d.sheet);
  else if (shCfg.role === 'reject') res = await importReject(x, src, shCfg, data, !!d.dry);
  else return { ok: false, error: 'Vai trò sheet không hợp lệ' };
  if (!d.dry) {
    const cfg = src.cfg; if (res.done !== undefined) { cfg.done = cfg.done || {}; cfg.done[d.sheet] = res.done; }
    await run(x.db, 'UPDATE sources SET cfg = ?, last = ?, result = ? WHERE id = ?', JSON.stringify(cfg), Date.now(), shCfg.name + ': ' + res.summary, src.id);
    await crmLog(x, u, 'Đồng bộ file', src.id, sale, shCfg.name, res.summary);
    if (auto) await kvSet(x.db, sigKey, sig, 2 * 86400e3);
  }
  return Object.assign(res, { ok: true, role: shCfg.role, sheetName: shCfg.name, total });
}
async function ownersOf(x, phones) {
  const o = {}; (await allIn(x.db, 'SELECT phone, owner, name FROM customers WHERE phone IN (SELECT value FROM json_each(?))', phones)).forEach(r => { o[r.phone] = { owner: r.owner || '', name: r.name }; }); return o;
}

/** Sheet đơn hàng ("lên đơn", "VTG_lendon"…). */
async function importOrders(x, src, shCfg, data, dry) {
  const m = shCfg.map || {}, sale = src.sale, extra = (shCfg.extra || []).filter(i => i >= 0), H = data.headers, label = 'File ' + sale + ' – ' + shCfg.name, ca = await caCfg(x);
  const until = src.cfg.until ? new Date(src.cfg.until + 'T00:00:00+07:00').getTime() : 0, FINAL = { 'Đã giao': 1, 'Hoàn': 1, 'Huỷ': 1, 'Đổi hàng': 1 };
  const parsed = [], days = orderDates(data.rows, m), far = [];
  let skip = 0;
  for (const [ri, r] of data.rows.entries()) {
    const phone = toPhone(cell(r, m, 'phone')), codeRaw = String(cell(r, m, 'code') || '').trim(), product = String(cell(r, m, 'product') || '').trim(), amount = toMoney(cell(r, m, 'amount'));
    const D = days[ri], when = D.t, sw = D.sw || D.code; // ngày theo mã đơn (ô trống / lệch ô ngày); 12/10/2026: sheet VTG_lendon của Chang bỏ trống ngày 260 dòng
    if (!phone || !when || (!product && !amount)) { if (nonEmpty(r)) skip++; continue; }
    if (D.far && far.length < 30) far.push({ row: ri + (shCfg.header || 1) + 1, code: codeRaw, date: fmtDate(D.old, 'dd/MM/yyyy') });
    const valid = CODE_RE.test(codeRaw) || /^[A-Za-z]{2,}\d{5,}/.test(codeRaw);
    const nkOf = t => { const hk = sale + '|' + fmtDate(t, 'yyyyMMdd') + '|' + phone + '|' + amount + '|' + nrm(product); return ['NK' + hashKey(hk), 'NK' + hashKeyLegacy(hk)]; };
    const [nk, old] = nkOf(when), prev = D.old && fmtDate(D.old, 'yyyyMMdd') !== fmtDate(when, 'yyyyMMdd') ? nkOf(D.old) : [];
    const key = valid ? codeRaw : nk, alt = (valid ? [nk, old] : [old]).concat(prev); // alt: mã NK… cùng dòng (Apps Script cũ băm chữ có dấu thành "?"; sale điền mã đơn sau khi đã nhập; ngày cũ theo ô trước khi lấy theo mã)
    parsed.push({ r, phone, when, sw, dc: D.code && D.old ? (D.byCode ? 1 : 2) : 0, product, amount, codeRaw, valid, key, alt, yk: valid ? codeRaw + '-' + phone.slice(-4) : '', sig: phone + '|' + fmtDate(when, 'yyyyMMdd') + '|' + amount + '|' + nrm(product || cell(r, m, 'gift1')) });
  }
  const ex = {}; (await allIn(x.db, 'SELECT rid, id, status, source, name, phone, time, total, items FROM orders WHERE id IN (SELECT value FROM json_each(?))', [...new Set(parsed.flatMap(p => [p.key, p.yk].concat(p.alt)).filter(String))])).forEach(o => { ex[o.id] = o; });
  // Mã đơn không có năm → trùng giữa các năm / giữa các sheet ("Chang101001" năm 2025 và 2026 là 2 khách khác nhau). Mã đã thuộc đơn của khách khác
  // (khác SĐT) → đơn này dùng mã + 4 số cuối SĐT. 12/10/2026: 64 đơn VTG_lendon của Chang bị coi là "đã có", 8 đơn cũ bị ghi đè.
  const owner = {}; Object.keys(ex).forEach(k => { owner[k] = ex[k]; });
  parsed.forEach(p => {
    if (!p.valid) return; if (ex[p.yk]) { p.key = p.yk; return; }
    const o = owner[p.codeRaw];
    if (!o) { owner[p.codeRaw] = { phone: p.phone }; return; }
    if (o.phone !== p.phone) p.key = p.yk;
  });
  const gone = {}; (await deletedOrderIds(x)).forEach(i => { gone[i] = 1; }); // đơn Quản trị đã xoá trên CRM → không nhập lại
  // Ghép dòng file ↔ đơn đã nhập. Sale hay sửa dòng sau khi CRM đã nhập (điền mã đơn, sửa sản phẩm / số tiền / ngày) → mã NK… tính lại khác:
  // phải nhận lại đơn cũ, không tạo đơn thứ 2 (12/10/2026: Phương sửa 900g → 400g lúc điền mã đơn → đơn Đào Văn Nhật bị tính 2 lần).
  const claimed = {}; parsed.forEach(p => [p.key].concat(p.alt).forEach(k => { if (ex[k]) claimed[ex[k].rid] = 1; }));
  const pool = {}; // đơn NK… của chính sheet này chưa dòng nào nhận, theo SĐT
  (await allIn(x.db, "SELECT rid, id, status, source, seller, name, phone, time, total, items FROM orders WHERE phone IN (SELECT value FROM json_each(?)) AND id LIKE 'NK%' AND source LIKE 'File %'", [...new Set(parsed.map(p => p.phone))])).forEach(o => {
    if (claimed[o.rid] || o.seller !== sale || !String(o.source).endsWith(' – ' + shCfg.name)) return; // cùng sheet (tên sale trong nhãn có thể đã đổi)
    o.day = fmtDate(o.time, 'yyyyMMdd'); o.prod = prodOf(o.items); (pool[o.phone] = pool[o.phone] || []).push(o);
  });
  const take = (p, ok) => { const L = pool[p.phone] || [], i = L.findIndex(ok); return i < 0 ? null : L.splice(i, 1)[0]; };
  // 1 đơn cũ chỉ cho 1 dòng nhận qua mã NK… (sale tách 1 lần mua thành nhiều dòng cùng ngày / tiền / sản phẩm, mỗi dòng 1 mã đơn: trước đây mã NK
  // giống nhau nên chỉ nhập 1 đơn; nay mỗi mã 1 đơn, dòng thứ 2 trở đi là đơn mới). Dòng trùng hẳn mã đơn vẫn coi là 1 đơn.
  const used = {};
  parsed.forEach(p => { p.day = fmtDate(p.when, 'yyyyMMdd'); p.prod = nrm(p.product || cell(p.r, m, 'gift1')); if (ex[p.key]) { p.o = ex[p.key]; used[p.o.rid] = 1; } });
  parsed.forEach(p => {
    if (p.o) return;
    const a = p.alt.find(k => ex[k] && !used[ex[k].rid]);
    p.o = a ? ex[a] : take(p, o => o.day === p.day && o.total === p.amount && o.prod === p.prod); // khớp hẳn (mã băm cũ, đổi tên nhân sự…)
    if (p.o) used[p.o.rid] = 1;
  });
  // Lượt 2: dòng chưa ghép (dòng mới, hoặc dòng đã sửa) nhận đơn NK… còn thừa của cùng SĐT, giống nhất trước
  const rest = parsed.filter(p => !p.o && !gone[p.key] && !p.alt.some(k => gone[k]));
  const near = (p, o) => Math.abs(o.time - p.when) <= 7 * DAY, cnt = (L, f) => L.filter(f).length;
  [(p, o) => o.day === p.day && o.total === p.amount, // sửa sản phẩm
    (p, o) => o.day === p.day && o.prod === p.prod, // sửa số tiền
    (p, o) => o.total === p.amount && o.prod === p.prod && near(p, o), // sửa ngày
    (p, o) => o.day === p.day && cnt(pool[p.phone] || [], q => q.day === p.day) === 1 && cnt(rest, q => !q.o && q.phone === p.phone && q.day === p.day) === 1] // cùng ngày chỉ có 1 đơn cũ và 1 dòng
    .forEach(rule => rest.forEach(p => { if (!p.o) { const o = take(p, o => rule(p, o)); if (o) { p.o = o; p.edited = 1; } } }));
  // đơn file đã ghép có mã đơn thật: sale sửa ngày / tiền / sản phẩm trong file (đơn 60 ngày gần đây, chưa ai sửa đơn trên CRM) → CRM theo file
  const chkIds = parsed.filter(p => p.o && !p.edited && String(p.o.source || '').indexOf('File ') === 0 && (p.when > Date.now() - 60 * DAY || p.o.time > Date.now() - 60 * DAY || p.sw) && (prodOf(p.o.items) !== p.prod || (p.amount > 0 && Number(p.o.total) !== p.amount) || fmtDate(p.o.time, 'yyyyMMdd') !== p.day)).map(p => p.o.id);
  const handEdit = {}; if (chkIds.length) (await allIn(x.db, "SELECT DISTINCT ref FROM logs WHERE what = 'Sửa đơn' AND ref IN (SELECT value FROM json_each(?))", [...new Set(chkIds)])).forEach(l => { handEdit[l.ref] = 1; });
  const crmDay = {}; (await allIn(x.db, "SELECT phone, time, total FROM orders WHERE phone IN (SELECT value FROM json_each(?)) AND source NOT LIKE 'File %'", [...new Set(parsed.map(p => p.phone))])).forEach(o => { crmDay[o.phone + '|' + fmtDate(o.time, 'yyyyMMdd') + '|' + (Number(o.total) || 0)] = 1; }); // đơn tạo trên CRM / web (đã ghi ngược vào file)
  const out = [], seen = {}, phones = {}, callbacks = {}, upd = [], ren = [], fix = [], chg = [], chgPh = {}; let dup = 0, revenue = 0, minD = null, maxD = null, afterCut = 0;
  const rowItems = (r, product, amount) => {
    const items = [];
    if (product) items.push({ name: product, variant: '', qty: toQty(cell(r, m, 'qty')) || 1, price: 0, subtotal: amount });
    [['gift1', 'gift1qty'], ['gift2', 'gift2qty']].forEach(g => { const n = String(cell(r, m, g[0]) || '').trim(); if (n) items.push({ name: n, variant: '', qty: toQty(cell(r, m, g[1])) || 1, gift: true, subtotal: 0 }); });
    return items;
  };
  for (const p of parsed) {
    const { r, phone, when, product, amount, codeRaw, valid, key, alt } = p;
    if (p.o && !ex[key]) { ex[key] = p.o; if (p.o.id !== key && (valid || p.edited)) ren.push({ rid: p.o.rid, from: p.o.id, to: key }); } // sale đã điền mã đơn / sửa dòng → đổi mã cũ thành mã hiện tại
    if (ex[key]) { // đã nhập: file cũ đổi sang Đã giao / Hoàn / Huỷ / Đổi hàng thì cập nhật theo (không đè thay đổi làm trên CRM)
      const st1 = mapStatus(cell(r, m, 'status'), when), cur = ex[key];
      if (String(cur.source || '').indexOf('File ') === 0 && (p.edited || chkIds.indexOf(cur.id) >= 0) && !handEdit[cur.id] && !seen['c' + cur.rid]) {
        seen['c' + cur.rid] = 1; const amt = amount || Number(cur.total) || 0, items = rowItems(r, product, amt); // ô tiền trống: giữ số tiền cũ
        chg.push({ why: p.dc === 1 ? 'Ngày theo mã đơn ' + p.codeRaw + ' (file ' + shCfg.name + ')' : p.dc === 2 ? 'Năm của ngày ' + fmtDate(when, 'dd/MM') + ' suy theo các dòng xung quanh (file ' + shCfg.name + ')' : p.sw ? 'Ngày trong file ' + shCfg.name + ' bị đảo ngày/tháng (định dạng Mỹ)' : String(cur.source || '').endsWith(' – ' + shCfg.name) ? '' : 'Mã đơn trùng với dòng sheet khác (' + String(cur.source).replace(/^File .* – /, '') + ')', rid: cur.rid, time: when, total: amt, subtotal: amt, items: itemsText(items), line: normLine(cell(r, m, 'line'), product), ship: String(cell(r, m, 'shipText') || '').trim() || shipText(items), name: cur.name, id: key, from: fmtDate(cur.time, 'dd/MM') + ' ' + (Number(cur.total) || 0).toLocaleString('vi-VN') + 'đ ' + String(cur.items || '').split('\n')[0].replace(/\s+x\d+\s*=.*$/, ''), to: fmtDate(when, 'dd/MM') + ' ' + amt.toLocaleString('vi-VN') + 'đ ' + product });
        chgPh[phone] = 1;
      }
      if (String(cur.source || '').indexOf('File ') === 0 && st1 !== cur.status && FINAL[st1]) {
        if (!FINAL[cur.status]) { upd.push({ rid: cur.rid, status: st1 }); cur.status = st1; }
        else if (EXPLICIT.test(nrm(cell(r, m, 'status')))) fix.push({ cur, status: st1 }); // sale sửa trạng thái đã chốt (vd nhập nhầm Hoàn → Đã giao): chỉ theo file nếu chưa ai đổi trên CRM / Viettel Post
      }
      dup++; continue;
    }
    if (gone[key] || alt.some(k => gone[k])) { dup++; continue; }
    if (crmDay[phone + '|' + fmtDate(when, 'yyyyMMdd') + '|' + amount]) { dup++; continue; } // đơn CRM / web đã ghi ngược vào file → không nhập lại
    if (seen[key]) { dup++; continue; } seen[key] = 1;
    if (until && when >= until) { afterCut++; continue; } // từ ngày này sale lên đơn trên CRM → không nhập để tránh trùng
    const items = rowItems(r, product, amount);
    const ctype = String(cell(r, m, 'ctype') || '').trim(), notes = [String(cell(r, m, 'note') || '').trim()];
    if (!valid && codeRaw) notes.push(codeRaw);
    if (ctype && !/^(kh|khach)? ?(moi|cu|cu mua lai)$/.test(nrm(ctype)) && !/toi|cn|le/.test(nrm(ctype))) notes.push('Phân loại: ' + ctype);
    extra.forEach(i => { if (r[i] !== '' && r[i] != null) notes.push(cellText(H[i]) + ': ' + (isSerial(r[i]) && /ngay|lich|hen/.test(nrm(H[i])) ? fmtDate(serialToMs(r[i]), 'dd/MM/yyyy') : cellText(r[i]))); });
    const cb = cell(r, m, 'callback'); if (isSerial(cb) && serialToMs(cb) > Date.now()) callbacks[phone] = serialToMs(cb);
    const status = mapStatus(cell(r, m, 'status'), when);
    out.push({ id: key, time: when, name: String(cell(r, m, 'name') || '').trim(), phone, email: '', province: '', ward: '', address: String(cell(r, m, 'address') || '').trim(), items: itemsText(items), subtotal: amount, shipping: 0, total: amount,
      payment: 'COD', note: notes.filter(String).join(' · '), status, source: label, first_source: label, consent: 1 /* khách trong file sale: mặc định đồng ý nhận ưu đãi (anh Sơn chọn 11/10/2026) */, paid: '', carrier: '', tracking: '', seller: sale, ca: caFromText(ctype, when, ca), line: normLine(cell(r, m, 'line'), product),
      ship: String(cell(r, m, 'shipText') || '').trim() || shipText(items) });
    if (!isVoid(status)) revenue += amount;
    phones[phone] = String(cell(r, m, 'name') || '');
    if (!minD || when < minD) minD = when; if (!maxD || when > maxD) maxD = when;
  }
  const owners = await ownersOf(x, Object.keys(phones));
  const settled = await settledOf(x, Object.keys(phones), sale);
  const conflicts = Object.keys(phones).filter(p => owners[p] && owners[p].owner && owners[p].owner !== sale && settled[p] !== owners[p].owner).map(p => ({ phone: p, name: phones[p], owner: owners[p].owner }));
  const newCus = Object.keys(phones).filter(p => !owners[p]).length;
  if (fix.length) {
    const hand = {}; (await allIn(x.db, "SELECT ref, result FROM logs WHERE what = 'Đơn hàng' AND ref IN (SELECT value FROM json_each(?)) AND by_name != ?", [...new Set(fix.map(f => f.cur.id))], FILE_BY)).forEach(l => { if (/→ (Mới|Đã xác nhận|Đang giao|Đã giao|Huỷ|Hoàn|Đổi hàng)$/.test(l.result || '')) hand[l.ref] = 1; });
    fix.forEach(f => { if (hand[f.cur.id] || f.cur.status === f.status) return; upd.push({ rid: f.cur.rid, status: f.status, id: f.cur.id, name: f.cur.name, from: f.cur.status }); f.cur.status = f.status; });
  }
  // Đơn NK… của sheet này (30 ngày gần đây) không còn dòng nào trong file nhận, mà cùng SĐT có dòng khác cách ≤ 3 ngày: bản cũ của dòng đã sửa (nhập trước khi có lượt 2) → xoá cho khỏi tính 2 lần
  const orphan = []; Object.keys(pool).forEach(ph => pool[ph].forEach(o => { if (o.time > Date.now() - 30 * DAY && parsed.some(p => p.phone === ph && Math.abs(p.when - o.time) <= 3 * DAY && (!p.o || p.o.rid !== o.rid))) orphan.push(o); }));
  const summary = out.length + ' đơn mới, ' + dup + ' đã có' + (upd.length ? ' (' + upd.length + ' cập nhật trạng thái)' : '') + (ren.length ? ', ' + ren.length + ' đơn nhận mã đơn mới' : '') + (chg.length ? ', ' + chg.length + ' đơn sửa theo file' : '') + (orphan.length ? ', xoá ' + orphan.length + ' đơn trùng' : '') + (afterCut ? ', ' + afterCut + ' đơn sau ngày chốt bỏ qua' : '') + ', ' + skip + ' dòng bỏ qua' + (far.length ? ', ' + far.length + ' mã đơn lệch ô ngày quá 45 ngày (lấy theo mã)' : '');
  const res = { updated: upd.length, renamed: ren.length, changed: chg.length, removed: orphan.length, afterCut, rows: data.rows.length, newOrders: out.length, dup, skip, customers: Object.keys(phones).length, newCustomers: newCus, conflicts: conflicts.slice(0, 50), conflictCount: conflicts.length, revenue, from: minD, to: maxD, far, summary };
  if (dry || (!out.length && !upd.length && !ren.length && !chg.length && !orphan.length)) return res;
  for (let i = 0; i < ren.length; i += 300) { // gộp: lần đầu đọc mã có dấu / khoảng trắng ("Lương 010401") → hàng trăm đơn đổi mã 1 lượt
    const part = JSON.stringify(ren.slice(i, i + 300));
    await run(x.db, "UPDATE orders SET id = json_extract(j.value, '$.to') FROM json_each(?) j WHERE orders.rid = json_extract(j.value, '$.rid')", part);
    await run(x.db, "UPDATE logs SET ref = json_extract(j.value, '$.to') FROM json_each(?) j WHERE logs.ref = json_extract(j.value, '$.from')", part);
  }
  for (let i = 0; i < chg.length; i += 200) await run(x.db, "UPDATE orders SET time = json_extract(j.value, '$.time'), total = json_extract(j.value, '$.total'), subtotal = json_extract(j.value, '$.subtotal'), items = json_extract(j.value, '$.items'), line = json_extract(j.value, '$.line'), ship = json_extract(j.value, '$.ship') FROM json_each(?) j WHERE orders.rid = json_extract(j.value, '$.rid')", JSON.stringify(chg.slice(i, i + 200)));
  const now0 = Date.now(); await insertMany(x.db, 'logs', ['time', 'by_name', 'what', 'ref', 'name', 'result', 'note'], chg.map(c => ({ time: now0, by_name: FILE_BY, what: 'Đơn hàng', ref: String(c.id), name: c.name || '', result: 'Sửa theo file: ' + c.from + ' → ' + c.to, note: c.why || 'Sale sửa dòng trong file ' + shCfg.name })));
  if (orphan.length) {
    await run(x.db, 'DELETE FROM orders WHERE rid IN (SELECT value FROM json_each(?))', JSON.stringify(orphan.map(o => o.rid)));
    await delMark(x, orphan, []);
    for (const o of orphan) { chgPh[o.phone] = 1; await crmLog(x, { name: FILE_BY }, 'Xoá dữ liệu', '', o.name, 'Xoá đơn trùng ' + o.id, (Number(o.total) || 0).toLocaleString('vi-VN') + 'đ · ' + o.phone + ' · dòng trong file ' + shCfg.name + ' đã sửa'); }
  }
  out.sort((a, b) => a.time - b.time);
  await insertMany(x.db, 'orders', ORDER_COLS, out);
  for (const u of upd) if (u.from) await crmLog(x, { name: FILE_BY }, 'Đơn hàng', u.id, u.name, u.from + ' → ' + u.status, 'Sale sửa trong file ' + shCfg.name);
  for (let i = 0; i < upd.length; i += 500) await run(x.db, "UPDATE orders SET status = json_extract(j.value, '$.status') FROM json_each(?) j WHERE orders.rid = json_extract(j.value, '$.rid')", JSON.stringify(upd.slice(i, i + 500)));
  const own = {}, keep = await keepOf(x); Object.keys(phones).forEach(p => { own[p] = keep[p] || sale; });
  const updPhones = upd.length ? (await allIn(x.db, 'SELECT DISTINCT phone FROM orders WHERE rid IN (SELECT value FROM json_each(?))', upd.map(u => u.rid))).map(r => r.phone) : [];
  await recalc(x, [...new Set(Object.keys(phones).concat(updPhones, Object.keys(chgPh)))], { owners: own });
  await setCallbacks(x, callbacks);
  return res;
}
/** Sau khi nhập các sheet đơn hàng: khách chưa ai phụ trách mà đơn gần nhất do sale này bán → giao cho sale. */
async function srcFinish(x, u, d) {
  const src = (await srcList(x)).find(s => s.id === d.id); if (!src) return { ok: false, error: 'Không tìm thấy nguồn.' };
  await run(x.db, "UPDATE customers SET owner = ? WHERE (owner = '' OR owner IS NULL) AND last_seller = ?", src.sale, src.sale);
  return { ok: true };
}

/** Sheet khách & nhật ký chăm sóc ("cop số"…): ghép nhật ký vào hồ sơ khách; người chưa mua → khách tiềm năng. */
async function importCare(x, src, shCfg, data, dry, idx) {
  const m = shCfg.map || {}, sale = src.sale, start = (src.cfg.done && src.cfg.done[idx]) || 0, ctx = dateCtx(data.rows, shCfg.map || {}), per = {}, order = [], nowMs = Date.now(), wbk = await wbKeys(x, src.id); let skip = 0;
  data.rows.forEach((r, i) => {
    const when = toDate(cell(r, m, 'date'), ctx); if (i < start) return; // ngày vẫn đọc để biết năm của các dòng sau
    const phone = toPhone(cell(r, m, 'phone')); if (!phone) { if (nonEmpty(r)) skip++; return; }
    let p = per[phone]; if (!p) { p = per[phone] = { name: '', entries: [], seen: {}, extra: [], last: null, status: '', product: '', amount: 0 }; order.push(phone); }
    p.name = String(cell(r, m, 'name') || p.name).trim(); if (when && (!p.last || when > p.last)) p.last = when;
    const n = String(cell(r, m, 'note') || '').trim(), hl = String(cell(r, m, 'health') || '').trim();
    splitNote(n, when || null, nowMs).forEach(e => { const key = e.t + '|' + e.text; if (!p.seen[key] && !wbHas(wbk, phone, e.text)) { p.seen[key] = 1; p.entries.push(e); } }); // dòng do CRM ghi ngược: bỏ
    nameMarks(cell(r, m, 'name')).concat(hl ? ['Sức khoẻ: ' + hl] : []).forEach(v => { if (p.extra.indexOf(v) < 0) p.extra.push(v); });
    p.status = String(cell(r, m, 'status') || p.status); p.product = String(cell(r, m, 'product') || p.product); p.amount = p.amount || toMoney(cell(r, m, 'amount'));
  });
  order.forEach(ph => { // nhật ký mới nhất lên đầu; lần cuối khách có phản hồi → care_at
    const p = per[ph]; p.entries.sort((a, b) => (b.t || 0) - (a.t || 0));
    p.notes = p.extra.concat(p.entries.map(e => (e.t ? fmtDate(e.t, 'dd/MM/yy') + ': ' : '') + e.text));
    const rp = p.entries.filter(e => e.t && e.res && e.res !== 'Không nghe máy')[0]; if (rp) { p.replyAt = rp.t; p.replyRes = rp.res; }
  });
  const owners = await ownersOf(x, order);
  if (dry) for (const sc of src.cfg.sheets || []) { // xem trước: coi như các sheet đơn hàng đã được nhập
    if (sc.role !== 'orders') continue; const dd = await srcRows(x, src, sc), mm = sc.map || {};
    dd.rows.forEach(r => { const ph = toPhone(cell(r, mm, 'phone')); if (ph && !owners[ph] && per[ph]) owners[ph] = { owner: sale, name: '' }; });
  }
  const ids = order.map(ph => 'CS' + hashKey(sale + '|' + ph)), oldIds = order.map(ph => 'CS' + hashKeyLegacy(sale + '|' + ph)); // oldIds: mã do Apps Script cũ tạo
  const have = {}; (await allIn(x.db, 'SELECT id FROM leads WHERE id IN (SELECT value FROM json_each(?))', ids.concat(oldIds))).forEach(r => { have[r.id] = 1; });
  (await allIn(x.db, "SELECT phone FROM leads WHERE id LIKE 'CS%' AND phone IN (SELECT value FROM json_each(?))", order)).forEach(r => { have['p' + r.phone] = 1; }); // đã nhập từ file (tên sale lúc đó có thể khác)
  const openP = {}; (await allIn(x.db, "SELECT phone FROM leads WHERE status IN ('Mới hỏi', 'Đang tư vấn') AND phone IN (SELECT value FROM json_each(?))", order)).forEach(r => { openP[r.phone] = 1; });
  const settled = await settledOf(x, order, sale), keep = await keepOf(x);
  const toNote = [], leads = [], conflicts = [], now = Date.now(), head = '— Nhật ký cũ (' + shCfg.name + ') —';
  order.forEach((ph, k) => {
    const p = per[ph];
    if (owners[ph]) { if (owners[ph].owner && owners[ph].owner !== sale && settled[ph] !== owners[ph].owner) conflicts.push({ phone: ph, name: p.name, owner: owners[ph].owner }); if (p.notes.length) toNote.push(ph); return; }
    const id = ids[k]; if (have[id] || have[oldIds[k]] || have['p' + ph] || openP[ph]) return;
    const st = nrm(p.status), recent = p.last && now - p.last <= 30 * DAY;
    const status = /huy/.test(st) ? 'Không mua' : /chot|len don/.test(st) ? 'Đã chốt' : recent ? 'Đang tư vấn' : 'Không mua';
    const reason = status === 'Không mua' ? (/huy/.test(st) ? 'Huỷ' : 'Chưa mua (dữ liệu cũ)') : '';
    leads.push({ id, time: p.last || now, name: p.name, phone: ph, channel: 'File cũ – ' + shCfg.name, interest: p.product, status, owner: keep[ph] || sale, last_at: p.last || null, callback: null, reason, note: p.notes.join('\n').slice(0, 45000), order_id: '', by_name: 'Đồng bộ ' + sale });
  });
  const open = leads.filter(l => l.status === 'Đang tư vấn').length;
  const summary = toNote.length + ' khách được thêm nhật ký cũ, ' + leads.length + ' người chưa mua → tiềm năng (' + open + ' còn theo dõi), ' + skip + ' dòng bỏ qua';
  const res = { rows: data.rows.length, from: start, people: order.length, notes: toNote.length, newLeads: leads.length, openLeads: open, conflicts: conflicts.slice(0, 50), conflictCount: conflicts.length, skip, summary, done: data.rows.length };
  if (dry) return res;
  if (toNote.length) {
    const cur = {}; (await allIn(x.db, 'SELECT phone, note FROM customers WHERE phone IN (SELECT value FROM json_each(?))', toNote)).forEach(r => { cur[r.phone] = r.note || ''; });
    const up = toNote.map(ph => { const c = cur[ph] || '', add = per[ph].notes.join('\n'); return { p: ph, n: (c.indexOf(head) >= 0 ? c + '\n' + add : (c ? c + '\n' : '') + head + '\n' + add).slice(0, 45000), a: per[ph].replyAt || null, r: per[ph].replyRes || '' }; });
    const newer = "json_extract(j.value, '$.a') IS NOT NULL AND (customers.care_at IS NULL OR customers.care_at < json_extract(j.value, '$.a'))";
    for (let i = 0; i < up.length; i += 300) await run(x.db, "UPDATE customers SET note = json_extract(j.value, '$.n'), owner = CASE WHEN customers.owner IS NULL OR customers.owner = '' THEN ? ELSE customers.owner END, care_at = CASE WHEN " + newer + " THEN json_extract(j.value, '$.a') ELSE customers.care_at END, care_result = CASE WHEN " + newer + " THEN json_extract(j.value, '$.r') ELSE customers.care_result END FROM json_each(?) j WHERE customers.phone = json_extract(j.value, '$.p')", sale, JSON.stringify(up.slice(i, i + 300)));
  }
  await insertMany(x.db, 'leads', LEAD_COLS, leads, 'ON CONFLICT(id) DO NOTHING');
  return res;
}

/** Sheet khách từ chối / bom hàng: gắn nhãn ⚠️ cho khách, người chưa mua → tiềm năng "Không mua". */
async function importReject(x, src, shCfg, data, dry) {
  const m = shCfg.map || {}, sale = src.sale, per = {};
  data.rows.forEach(r => { const ph = toPhone(cell(r, m, 'phone')); if (!ph) return; per[ph] = per[ph] || { name: String(cell(r, m, 'name') || ''), why: [] }; const n = String(cell(r, m, 'note') || cell(r, m, 'status') || '').trim(); if (n) per[ph].why.push(n); });
  const phs = Object.keys(per), owners = await ownersOf(x, phs), flags = [], leads = [];
  const have = {}; (await allIn(x.db, 'SELECT id FROM leads WHERE id IN (SELECT value FROM json_each(?))', phs.flatMap(ph => ['TC' + hashKey(sale + '|' + ph), 'TC' + hashKeyLegacy(sale + '|' + ph)]))).forEach(r => { have[r.id] = 1; });
  (await allIn(x.db, "SELECT phone FROM leads WHERE id LIKE 'TC%' AND phone IN (SELECT value FROM json_each(?))", phs)).forEach(r => { have['p' + r.phone] = 1; }); // đã nhập (tên sale lúc đó có thể khác)
  phs.forEach(ph => {
    const bom = /bom/i.test(per[ph].why.join(' '));
    if (owners[ph]) flags.push({ p: ph, f: bom ? 'Bom hàng' : 'Từ chối' });
    else { const id = 'TC' + hashKey(sale + '|' + ph); if (!have[id] && !have['TC' + hashKeyLegacy(sale + '|' + ph)] && !have['p' + ph]) leads.push({ id, time: Date.now(), name: per[ph].name, phone: ph, channel: 'File cũ – ' + shCfg.name, interest: '', status: 'Không mua', owner: sale, last_at: null, callback: null, reason: bom ? 'Bom hàng' : 'Từ chối', note: per[ph].why.join('\n'), order_id: '', by_name: 'Đồng bộ ' + sale }); }
  });
  const res = { rows: data.rows.length, people: phs.length, flagged: flags.length, newLeads: leads.length, summary: flags.length + ' khách gắn nhãn cảnh báo, ' + leads.length + ' người vào danh sách "Không mua"' };
  if (dry) return res;
  for (let i = 0; i < flags.length; i += 500) await run(x.db, "UPDATE customers SET flag = json_extract(j.value, '$.f') FROM json_each(?) j WHERE customers.phone = json_extract(j.value, '$.p') AND (customers.flag IS NULL OR customers.flag = '')", JSON.stringify(flags.slice(i, i + 500)));
  await insertMany(x.db, 'leads', LEAD_COLS, leads, 'ON CONFLICT(id) DO NOTHING');
  return res;
}

/* ---------- file số quảng cáo chung */
async function adsSave(x, u, d) {
  const cfg = d.cfg || {}; cfg.fileId = fileIdOf(cfg.url); if (!cfg.fileId) return { ok: false, error: 'Link file chưa đúng.' };
  cfg.mode = cfg.mode === 'crm' ? 'crm' : 'staff';
  const old = await adsCfg(x); if (old && old.last) cfg.last = old.last;
  await kvSet(x.db, 'ads_cfg', JSON.stringify(cfg));
  await crmLog(x, u, 'Cài đặt', '-', '', 'File số QC: ' + (cfg.mode === 'crm' ? 'CRM tự chia' : 'nhân sự chia') + (cfg.auto ? ', tự đồng bộ 10 phút/lần' : ''), '');
  return { ok: true };
}
/** Ngày của từng dòng file số quảng cáo. Ngày ghi ở 1 dòng áp dụng cho các dòng bên dưới tới khi gặp ngày mới (nhân sự thường chỉ ghi ở dòng đầu,
 *  hoặc quên ghi). Ngày tương lai hoặc gõ đảo (vd 10/2 thành 2/10, nằm giữa dữ liệu cũ) bị coi như ô trống: ngày coi là sai khi bên dưới có từ
 *  5 dòng sớm hơn nó trên 2 ngày (file ghi theo thứ tự thời gian; 1–2 dòng gõ nhầm bên dưới không làm hỏng ngày đúng). Trả về mili giây hoặc 0. */
function adsDays(raw) {
  const ctx = { us: usDates(raw) }, t = raw.map(v => toDate(v, ctx) || 0), lim = Date.now() + DAY, low = []; // low: 5 ngày sớm nhất ở các dòng bên dưới
  for (let i = t.length - 1; i >= 0; i--) {
    const v = t[i]; if (!v) continue;
    if (v > lim || (low.length >= 5 && low[4] < v - 2 * DAY)) t[i] = 0;
    low.push(v); low.sort((a, b) => a - b); if (low.length > 5) low.pop();
  }
  let last = 0; return t.map(v => (last = v || last));
}
/** Cột "Trùng sale" của file số quảng cáo = sale phụ trách khách, đồng bộ 2 chiều: sửa ở đâu sau cùng thì lấy theo đó.
 *  keep = {sđt: tên CRM} đọc từ file; kv ads_keep = trạng thái lần trước. Bảng owner_chg (trigger) ghi các lần đổi người phụ trách trên CRM.
 *  - Đổi trên CRM sau lần đọc trước → ghi tên (alias) vào cột Trùng sale của file (các dòng đã ghi + dòng dưới cùng của số đó), keep theo CRM.
 *  - Cột trong file đổi so với lần trước (lần đầu: mọi số) → đổi người phụ trách khách đã mua + khách hỏi đang mở, ghi Khách trùng sale như đã chốt.
 *  rowsOf = {sđt: [{sheet, row, col, has}]} các dòng có số đó trong file. Sửa keep tại chỗ (khách hỏi mới từ file lấy theo keep). */
async function syncKeep(x, keep, rowsOf, users, dry) {
  const prevRaw = await kvGet(x.db, 'ads_keep'), prev = prevRaw ? JSON.parse(prevRaw) : {}, fresh = !prevRaw; // lần đầu: file là gốc
  const ocLast = +(await kvGet(x.db, 'oc_last')) || 0, active = {}; users.forEach(y => { active[y.name] = y; });
  const chg = await all(x.db, 'SELECT id, phone, owner FROM owner_chg WHERE id > ? ORDER BY id', ocLast), crm = {};
  let ocMax = ocLast; chg.forEach(r => { ocMax = Math.max(ocMax, r.id); if (!fresh && rowsOf[r.phone] && active[r.owner]) crm[r.phone] = r.owner; });
  const back = Object.keys(crm).filter(p => keep[p] !== crm[p]); // đổi trên CRM → ghi ra file (đổi cả 2 nơi cùng lúc: lấy CRM)
  back.forEach(p => { keep[p] = crm[p]; });
  const fromFile = Object.keys(keep).filter(p => keep[p] !== prev[p] && !crm[p]);
  const out = { phones: Object.keys(keep).length, customers: 0, leads: 0, toFile: back.length };
  const cur = {};
  if (fromFile.length) (await allIn(x.db, 'SELECT phone, owner, name FROM customers WHERE phone IN (SELECT value FROM json_each(?))', fromFile)).forEach(r => { cur[r.phone] = r; });
  const leads = fromFile.length ? (await allIn(x.db, "SELECT id, phone, owner FROM leads WHERE status IN ('Mới hỏi', 'Đang tư vấn') AND phone IN (SELECT value FROM json_each(?))", fromFile)).filter(r => r.owner !== keep[r.phone]) : [];
  const cus = fromFile.filter(p => cur[p] && cur[p].owner !== keep[p]);
  out.customers = cus.length; out.leads = leads.length;
  if (dry) return out;
  const save = Object.assign({}, keep);
  if (back.length) { // ghi tên sale vào cột Trùng sale
    const wd = [];
    back.forEach(p => { const rs = rowsOf[p], u = active[keep[p]], val = String(u.alias || '').split(',')[0].trim() || u.name;
      rs.forEach((r, k) => { if (r.has || k === rs.length - 1) wd.push({ range: a1(r.sheet, colLetter(r.col) + r.row), values: [[val]] }); }); });
    const cfg = await adsCfg(x);
    try { await sheetWrite(x.env, cfg.fileId, wd); } catch (e) { out.writeError = e.message; back.forEach(p => { if (prev[p]) save[p] = prev[p]; else delete save[p]; }); ocMax = ocLast; } // chưa ghi được → lần sau thử lại
  }
  const now = Date.now();
  if (cus.length || leads.length) {
    for (let i = 0; i < cus.length; i += 300) await run(x.db, "UPDATE customers SET owner = json_extract(j.value, '$.o') FROM json_each(?) j WHERE customers.phone = json_extract(j.value, '$.p')", JSON.stringify(cus.slice(i, i + 300).map(p => ({ p, o: keep[p] }))));
    for (let i = 0; i < leads.length; i += 300) await run(x.db, "UPDATE leads SET owner = json_extract(j.value, '$.o') FROM json_each(?) j WHERE leads.id = json_extract(j.value, '$.k')", JSON.stringify(leads.slice(i, i + 300).map(l => ({ k: l.id, o: keep[l.phone] }))));
    await insertMany(x.db, 'logs', ['time', 'by_name', 'what', 'ref', 'name', 'result', 'note'], cus.map(p => ({ time: now, by_name: 'File QC', what: 'Giao khách', ref: p, name: cur[p].name || '',
      result: 'Theo cột Trùng sale → ' + keep[p] + (cur[p].owner ? ' (trước: ' + cur[p].owner + ')' : ''), note: '' })));
  }
  const has = Object.keys(cur).concat(back);
  if (has.length) { // ghi nhận ở màn hình Khách trùng sale như đã chốt
    const done = {}, sales = {};
    (await allIn(x.db, 'SELECT phone, owner, sales FROM dup_done WHERE phone IN (SELECT value FROM json_each(?))', has)).forEach(r => { done[r.phone] = r; });
    (await allIn(x.db, 'SELECT DISTINCT phone, sale FROM sale_phones WHERE phone IN (SELECT value FROM json_each(?))', has)).forEach(r => { (sales[r.phone] = sales[r.phone] || []).push(r.sale); });
    const dd = [];
    has.forEach(p => { const want = save[p]; if (!want) return; const d = done[p], al = [...new Set((sales[p] || []).concat(want, (cur[p] && cur[p].owner) || ''))].filter(String), ds = d ? String(d.sales || '').split('|') : [];
      if (!d || d.owner !== want || al.some(n => ds.indexOf(n) < 0)) dd.push({ phone: p, owner: want, sales: al.join('|'), by_name: crm[p] ? 'Đổi trên CRM' : 'Cột Trùng sale (file QC)', at: now }); });
    await insertMany(x.db, 'dup_done', ['phone', 'owner', 'sales', 'by_name', 'at'], dd, 'ON CONFLICT(phone) DO UPDATE SET owner = excluded.owner, sales = excluded.sales, by_name = excluded.by_name, at = excluded.at');
  }
  const js = JSON.stringify(save); if (js !== prevRaw) await kvSet(x.db, 'ads_keep', js);
  if (ocMax !== ocLast) { await kvSet(x.db, 'oc_last', String(ocMax)); await run(x.db, 'DELETE FROM owner_chg WHERE id <= ?', ocMax); }
  return out;
}
/** Đầu ngày (giờ VN) của mốc thời gian, mili giây. */
function dayOf(t) { return Math.floor((t + 7 * 3600e3) / DAY) * DAY - 7 * 3600e3; }
/** Lấy số quảng cáo vào "Khách tiềm năng". Nhân sự chia: đọc tên sale ở cột Sale. CRM chia: số chưa có sale → giao theo lượt từng sheet (trùng số → sale cũ) và ghi tên vào cột Sale. */
export async function adsSync(x, u, dry) {
  const cfg = await adsCfg(x); if (!cfg || !cfg.fileId) return { ok: false, error: 'Chưa cài file số quảng cáo.' };
  const users = (await crmUsers(x)).filter(y => y.active), byAlias = {};
  users.forEach(y => { [y.name].concat(String(y.alias || '').split(',')).forEach(a => { a = nrm(a); if (a) byAlias[a] = y.name; }); });
  const who = t => { t = nrm(t); return byAlias[t] || byAlias[t.replace(/\s+t\d+$/, '')] || ''; }; // "Phương T2" = Phương
  const since = cfg.since ? new Date(cfg.since + 'T00:00:00+07:00').getTime() : Date.now() - 3 * DAY;
  const rows = [], perSale = {}, perSheet = {}, writes = [], rr = {}; let skipped = 0, merged = 0;
  const nextFrom = async (pool, key) => { if (!(key in rr)) rr[key] = (await kvGet(x.db, key)) || ''; const n = pool[(pool.indexOf(rr[key]) + 1) % pool.length]; rr[key] = n; return n; };
  const scan = [], reg = [], regFrom = Date.now() - 100 * DAY; // reg: mọi dòng có SĐT trong 100 ngày → đếm data quảng cáo (tỷ lệ chốt), không phụ thuộc việc tạo khách hỏi
  const keep = {}, keepRaw = {}, rowsOf = {}; // cột Trùng sale: {sđt: sale phụ trách khách} (dòng dưới cùng có ghi thắng) – không phụ thuộc file sale nào nhập trước
  const sheets = [];
  for (const sc of (cfg.sheets || []).filter(s => s.on)) {
    const m = sc.map || cfg.map || {}, hr = sc.header || 1;
    const vals = await sheetValues(x.env, cfg.fileId, a1(sc.name, 'A' + (hr + 1) + ':' + colLetter(neededCols({ map: m }) - 1)), 'UNFORMATTED_VALUE');
    sheets.push({ sc, m, hr, vals });
    if (m.dup !== undefined) vals.forEach((r, i) => {
      const ph = toPhone(cell(r, m, 'phone')), t = String(cell(r, m, 'dup') || '').trim(); if (!ph) return;
      (rowsOf[ph] = rowsOf[ph] || []).push({ sheet: sc.name, row: hr + 1 + i, col: m.dup, has: !!t }); if (!t) return;
      const n = who(t); if (n) { keep[ph] = n; delete keepRaw[ph]; } else if (!keep[ph]) keepRaw[ph] = t;
    });
  }
  const kres = await syncKeep(x, keep, rowsOf, users, dry); const odd = Object.values(keepRaw); if (odd.length) kres.unknown = [...new Set(odd)].slice(0, 20); // tên ở cột Trùng sale không khớp nhân sự nào
  for (const { sc, m, hr, vals } of sheets) {
    const days = adsDays(vals.map(r => cell(r, m, 'date')));
    vals.forEach((r, i) => {
      const when = days[i], phone = toPhone(cell(r, m, 'phone')); if (!when || !phone) return;
      if (when >= regFrom) { const st = String(cell(r, m, 'sale') || '').trim(); reg.push([dayOf(when), phone, keep[phone] || who(st) || st, String(cell(r, m, 'src') || sc.name).trim()]); }
      if (when < since) return; scan.push({ sc, m, hr, r, i, when, phone, id: 'QC' + hashKey(sc.name + '|' + phone + '|' + fmtDate(when, 'yyyyMMdd')) });
    });
  }
  if (!dry) { const js = JSON.stringify(reg), v = hashKey(js); if ((await kvGet(x.db, 'ads_rows_v')) !== v) { await kvSet(x.db, 'ads_rows', js); await kvSet(x.db, 'ads_rows_v', v); } }
  const ids = {}, openBy = {};
  (await allIn(x.db, 'SELECT id FROM leads WHERE id IN (SELECT value FROM json_each(?))', scan.map(s => s.id))).forEach(r => { ids[r.id] = 1; });
  const phones = [...new Set(scan.map(s => s.phone))];
  (await allIn(x.db, "SELECT phone, owner FROM leads WHERE status IN ('Mới hỏi', 'Đang tư vấn') AND phone IN (SELECT value FROM json_each(?))", phones)).forEach(r => { openBy[r.phone] = r.owner || ''; });
  const owners = await ownersOf(x, phones), pool = users.filter(y => y.recv && y.alias).map(y => y.name);
  for (const s of scan) {
    const { sc, m, hr, r, i, when, phone, id } = s; if (ids[id]) continue;
    if (openBy[phone] !== undefined && cfg.mode !== 'crm') { merged++; ids[id] = 1; continue; } // số này đang được chăm sóc (tiềm năng còn mở) → không tạo trùng
    const saleTxt = String(cell(r, m, 'sale') || '').trim(); let owner = keep[phone] || who(saleTxt);
    if (cfg.mode === 'crm' && !saleTxt && !keep[phone]) { // CRM chia
      const old = (owners[phone] && owners[phone].owner) || openBy[phone] || '';
      owner = old || (pool.length ? await nextFrom(pool, 'rr_ads_' + hashKey(sc.name)) : '');
      if (owner) { const ux = users.find(y => y.name === owner); writes.push({ sheet: sc.name, row: hr + 1 + i, col: m.sale, val: (String(ux.alias || '').split(',')[0].trim() || owner), dupCol: old ? m.dup : undefined }); }
    }
    if (!owner) { skipped++; continue; } // sale chưa có trong CRM (giai đoạn thử nghiệm) → bỏ qua
    const type = String(cell(r, m, 'ctype') || ''), note = String(cell(r, m, 'note') || '').trim(), nn = nrm(note + ' ' + type), srcName = String(cell(r, m, 'src') || sc.name).trim();
    const status = /rac/.test(nn) ? 'Không mua' : /chot/.test(nn) ? 'Đã chốt' : /knm|khong nghe|thue bao|tb/.test(nn) ? 'Đang tư vấn' : 'Mới hỏi';
    rows.push({ id, time: when, name: String(cell(r, m, 'name') || '').trim(), phone, channel: 'Quảng cáo – ' + srcName, interest: srcName, status, owner, last_at: status === 'Mới hỏi' ? null : when, callback: null, reason: status === 'Không mua' ? 'Số rác' : '',
      note: [note, type ? 'Phân loại: ' + type : '', cell(r, m, 'amount') ? 'Đơn: ' + cellText(cell(r, m, 'amount')) : ''].filter(String).join(' · '), order_id: '', by_name: 'File QC' });
    ids[id] = 1; openBy[phone] = owner; perSale[owner] = (perSale[owner] || 0) + 1; perSheet[sc.name] = (perSheet[sc.name] || 0) + 1;
  }
  const res = { ok: true, newLeads: rows.length, merged, perSale, perSheet, skipped, writes: writes.length, mode: cfg.mode, since };
  res.keep = kres;
  if (dry || !rows.length) return res;
  await insertMany(x.db, 'leads', LEAD_COLS, rows, 'ON CONFLICT(id) DO NOTHING');
  const wd = []; writes.forEach(w => { if (w.col !== undefined) wd.push({ range: a1(w.sheet, colLetter(w.col) + w.row), values: [[w.val]] }); if (w.dupCol !== undefined) wd.push({ range: a1(w.sheet, colLetter(w.dupCol) + w.row), values: [[w.val]] }); });
  if (wd.length) { try { await sheetWrite(x.env, cfg.fileId, wd); } catch (e) { res.writeError = e.message; } }
  for (const n of Object.keys(perSale)) {
    const fresh = rows.filter(r => r.owner === n && r.status === 'Mới hỏi');
    if (fresh.length) await telegramUser(x, n, '🙋 <b>' + fresh.length + ' số quảng cáo mới</b> cho bạn:\n' + fresh.slice(0, 15).map(r => '• ' + esc(r.name) + ' – <a href="https://zalo.me/' + r.phone + '">' + r.phone + '</a> · ' + esc(r.interest)).join('\n') + '\n\n👉 ' + CRM_URL + '/#tiem-nang');
  }
  for (const k of Object.keys(rr)) await kvSet(x.db, k, rr[k]);
  cfg.last = Date.now(); await kvSet(x.db, 'ads_cfg', JSON.stringify(cfg));
  if (u && u.email) await crmLog(x, u, 'Đồng bộ file', 'QC', '', rows.length + ' số mới', JSON.stringify(perSale));
  return res;
}

export async function srcAutoTick(x, force) {
  const now = Date.now(), vn = new Date(now + 7 * 3600e3), h = vn.getUTCHours();
  if (force !== true && (h < 7 || h > 21)) return;
  const sources = (await srcList(x)).filter(s => s.cfg && s.cfg.autoSync);
  if (!sources.length) return;
  const u = { name: 'Tự động', level: 3, email: '' };
  for (const src of sources) {
    const sheets = (src.cfg.sheets || []).filter(s => s.role && s.role !== 'skip');
    for (let i = 0; i < sheets.length; i++) {
      try {
        await srcSync(x, u, { id: src.id, name: sheets[i].name });
      } catch (e) {
        console.error('srcAutoTick', src.sale, sheets[i].name, e.message);
      }
    }
  }
}

/* ---------- khách trùng sale: 1 khách có trong file của nhiều sale (trước khi gộp văn phòng mỗi người chăm riêng) → quản lý chốt 1 người giữ */
/** Ghi lại các số có trong 1 sheet file sale. Chỉ ghi phần thay đổi; sheet không đổi thì bỏ qua. */
async function notePhones(x, src, shCfg, rows) {
  const m = shCfg.map || {}, ctx = dateCtx(rows, shCfg.map || {}), per = {};
  for (const r of rows) {
    const when = toDate(cell(r, m, 'date'), ctx), ph = toPhone(cell(r, m, 'phone')); if (!ph) continue;
    const p = per[ph] || (per[ph] = { n: 0, last: null }); p.n++; if (when && (!p.last || when > p.last)) p.last = when;
  }
  const sheet = shCfg.name, keys = Object.keys(per).sort(), kk = 'sp_' + hashKey(src.id + '|' + sheet);
  const sig = hashKey(src.sale + '#' + keys.map(k => k + ':' + per[k].n + ':' + (per[k].last || '')).join(','));
  if (await kvGet(x.db, kk) === sig) return;
  const cur = {}; (await all(x.db, 'SELECT phone, sale, rows, last FROM sale_phones WHERE src = ? AND sheet = ?', src.id, sheet)).forEach(r => { cur[r.phone] = r; });
  const put = keys.filter(k => !cur[k] || cur[k].sale !== src.sale || cur[k].rows !== per[k].n || (cur[k].last || null) !== per[k].last).map(k => ({ phone: k, src: src.id, sheet, sale: src.sale, last: per[k].last, rows: per[k].n }));
  const del = Object.keys(cur).filter(k => !per[k]); // sale đã xoá dòng khỏi file
  await insertMany(x.db, 'sale_phones', ['phone', 'src', 'sheet', 'sale', 'last', 'rows'], put, 'ON CONFLICT(phone, src, sheet) DO UPDATE SET sale = excluded.sale, last = excluded.last, rows = excluded.rows');
  for (let i = 0; i < del.length; i += 500) await run(x.db, 'DELETE FROM sale_phones WHERE src = ? AND sheet = ? AND phone IN (SELECT value FROM json_each(?))', src.id, sheet, JSON.stringify(del.slice(i, i + 500)));
  await kvSet(x.db, kk, sig);
}
/** Sale phụ trách theo cột Trùng sale của file số quảng cáo (syncKeep lưu): {sđt: tên}. */
async function keepOf(x) { return (await kvJson(x.db, 'ads_keep')) || {}; }
/** Khách quản lý đã chốt người giữ, có tính cả sale này: {sđt: người giữ}. Dùng để không báo trùng lại khi nhập file. */
async function settledOf(x, phones, sale) {
  const o = {}, keep = await keepOf(x); phones.forEach(p => { if (keep[p]) o[p] = keep[p]; }); (await allIn(x.db, 'SELECT phone, owner, sales FROM dup_done WHERE phone IN (SELECT value FROM json_each(?))', phones)).forEach(r => { if (!o[r.phone] && String(r.sales || '').split('|').indexOf(sale) >= 0) o[r.phone] = r.owner; }); return o;
}
/** Đọc lại cột SĐT của mọi sheet đơn hàng / chăm sóc trong file sale (không nhập gì). */
async function dupScan(x, u) {
  const live = {}, errors = []; let n = 0;
  for (const src of await srcList(x)) for (const sc of src.cfg.sheets || []) {
    if (sc.role !== 'orders' && sc.role !== 'care') continue;
    live[src.id + '|' + sc.name] = 1;
    try { await notePhones(x, src, sc, (await srcRows(x, src, sc)).rows); n++; } catch (e) { errors.push(src.sale + ' – ' + sc.name + ': ' + e.message); }
  }
  for (const o of await all(x.db, 'SELECT DISTINCT src, sheet FROM sale_phones')) if (!live[o.src + '|' + o.sheet]) { // file / sheet không còn nhập
    await run(x.db, 'DELETE FROM sale_phones WHERE src = ? AND sheet = ?', o.src, o.sheet); await kvDel(x.db, 'sp_' + hashKey(o.src + '|' + o.sheet));
  }
  await crmLog(x, u, 'Khách trùng sale', '-', '', 'Quét lại ' + n + ' sheet', errors.join('; '));
  return Object.assign(await dupList(x), { scanned: n, errors });
}
/** Danh sách khách trùng: có trong file của ≥ 2 sale, hoặc trong file của 1 sale nhưng đang do người khác phụ trách. */
async function dupList(x) {
  await unifyNames(x);
  const phones = (await all(x.db, `SELECT sp.phone FROM sale_phones sp JOIN customers c ON c.phone = sp.phone WHERE (c.orders > 0 OR c.flag != '')
    GROUP BY sp.phone HAVING count(DISTINCT sp.sale) >= 2 OR sum(coalesce(c.owner, '') != '' AND sp.sale != c.owner) > 0`)).map(r => r.phone);
  const tracked = (await first(x.db, 'SELECT count(DISTINCT src || sheet) AS n FROM sale_phones') || {}).n || 0;
  if (!phones.length) return { ok: true, items: [], tracked };
  const q = sql => allIn(x.db, sql, phones);
  const [cs, sp, os, dn] = [await q('SELECT phone, name, owner, orders, spent, last, products FROM customers WHERE phone IN (SELECT value FROM json_each(?))'),
    await q('SELECT phone, sale, sheet, last FROM sale_phones WHERE phone IN (SELECT value FROM json_each(?))'),
    await q("SELECT phone, seller, count(*) AS n, sum(total) AS s, max(time) AS t FROM orders WHERE phone IN (SELECT value FROM json_each(?)) AND status NOT IN ('Huỷ', 'Hủy', 'Hoàn') GROUP BY phone, seller"),
    await q('SELECT phone, owner, sales, by_name, at FROM dup_done WHERE phone IN (SELECT value FROM json_each(?))')];
  const S = {}, O = {}, D = {}, keep = await keepOf(x);
  sp.forEach(r => { const a = S[r.phone] = S[r.phone] || {}, s = a[r.sale] = a[r.sale] || { sheets: [], last: null }; if (s.sheets.indexOf(r.sheet) < 0) s.sheets.push(r.sheet); if (r.last && (!s.last || r.last > s.last)) s.last = r.last; });
  os.forEach(r => { (O[r.phone] = O[r.phone] || {})[r.seller || ''] = { n: r.n, s: r.s || 0, t: r.t }; });
  dn.forEach(r => { D[r.phone] = r; });
  const items = cs.map(c => {
    const inFile = S[c.phone] || {}, names = Object.keys(inFile); if (c.owner && names.indexOf(c.owner) < 0) names.unshift(c.owner);
    const sales = names.map(n => { const f = inFile[n], o = (O[c.phone] || {})[n]; return { sale: n, sheets: f ? f.sheets : [], last: f ? f.last : null, orders: o ? o.n : 0, spent: o ? o.s : 0, lastOrder: o ? o.t : null }; });
    const d = D[c.phone], ds = d ? String(d.sales || '').split('|') : [];
    return { phone: c.phone, name: c.name || '', owner: c.owner || '', orders: c.orders || 0, spent: c.spent || 0, last: c.last, products: String(c.products || '').split('; ').filter(String).slice(0, 4), sales,
      done: d ? { owner: d.owner, by: d.by_name, at: d.at } : null, qc: keep[c.phone] || '', ok: !!(d && d.owner === c.owner && names.every(n => ds.indexOf(n) >= 0)) };
  }).sort((a, b) => (a.ok - b.ok) || ((b.last || 0) - (a.last || 0)));
  return { ok: true, items, tracked };
}
/** Quản lý chốt người giữ: d.items = [{phone, owner}]. Khách hỏi đang theo dõi của số đó chuyển theo. */
async function dupSet(x, u, d) {
  const names = (await crmUsers(x)).filter(y => y.active).map(y => y.name);
  const list = (d.items || []).map(i => ({ phone: String(i.phone || '').replace(/\D/g, ''), owner: String(i.owner || '') })).filter(i => i.phone && names.indexOf(i.owner) >= 0);
  if (!list.length) return { ok: false, error: 'Chưa chọn người giữ khách.' };
  const phones = list.map(i => i.phone), sales = {}, cur = {};
  (await allIn(x.db, 'SELECT DISTINCT phone, sale FROM sale_phones WHERE phone IN (SELECT value FROM json_each(?))', phones)).forEach(r => { (sales[r.phone] = sales[r.phone] || []).push(r.sale); });
  (await allIn(x.db, 'SELECT phone, owner, name FROM customers WHERE phone IN (SELECT value FROM json_each(?))', phones)).forEach(r => { cur[r.phone] = r; });
  const now = Date.now(), ok = list.filter(i => cur[i.phone]), gain = {};
  const done = ok.map(i => ({ phone: i.phone, owner: i.owner, sales: [...new Set((sales[i.phone] || []).concat(i.owner, cur[i.phone].owner || ''))].filter(String).join('|'), by_name: u.name, at: now }));
  const logs = ok.map((i, k) => {
    const was = cur[i.phone].owner || ''; if (was !== i.owner) gain[i.owner] = (gain[i.owner] || 0) + 1;
    return { time: now, by_name: u.name, what: 'Giao khách', ref: i.phone, name: cur[i.phone].name || '', result: 'Khách trùng sale → ' + i.owner + (was === i.owner ? ' (giữ nguyên)' : was ? ' (trước: ' + was + ')' : ''), note: 'Có trong file: ' + done[k].sales.split('|').join(', ') };
  });
  for (let i = 0; i < ok.length; i += 300) {
    const part = JSON.stringify(ok.slice(i, i + 300));
    await run(x.db, "UPDATE customers SET owner = json_extract(j.value, '$.owner') FROM json_each(?) j WHERE customers.phone = json_extract(j.value, '$.phone')", part);
    await run(x.db, "UPDATE leads SET owner = json_extract(j.value, '$.owner') FROM json_each(?) j WHERE leads.phone = json_extract(j.value, '$.phone') AND leads.status IN ('Mới hỏi', 'Đang tư vấn')", part);
  }
  await insertMany(x.db, 'dup_done', ['phone', 'owner', 'sales', 'by_name', 'at'], done, 'ON CONFLICT(phone) DO UPDATE SET owner = excluded.owner, sales = excluded.sales, by_name = excluded.by_name, at = excluded.at');
  await insertMany(x.db, 'logs', ['time', 'by_name', 'what', 'ref', 'name', 'result', 'note'], logs);
  for (const n of Object.keys(gain)) x.later(telegramUser(x, n, '👥 ' + esc(u.name) + ' vừa giao cho bạn <b>' + gain[n] + ' khách</b> (khách trước đây có trong file của nhiều sale). Từ nay bạn là người phụ trách chính.\n\n👉 ' + CRM_URL + '/#khach-hang'));
  return { ok: true, n: ok.length, moved: Object.keys(gain).reduce((t, n) => t + gain[n], 0) };
}

export { srcSync };
export const SRC_UTIL = { toPhone, toDate, usDates, codeDay, orderDates, toMoney, splitNote, neededCols, colLetter }; // cho wb.js (ghi ngược file sale)
export const DUPS = { dups: x => dupList(x), dup_scan: dupScan, dup_set: dupSet };

export const SYNC = {
  src_inspect: (x, u, d) => inspect(x, u, d, false), ads_inspect: (x, u, d) => inspect(x, u, d, true),
  src_save: srcSave, src_delete: srcDelete, src_sync: srcSync, src_finish: srcFinish,
  ads_save: adsSave, ads_sync: (x, u, d) => adsSync(x, u, !!d.dry)
};
