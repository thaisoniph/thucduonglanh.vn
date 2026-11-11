// 💼 Tài chính (05/11/2026): máy chủ tự đọc link Google Sheet báo cáo của kế toán (Quản trị nối link ở Tổng quan → 🏦 Tiền & công nợ).
// Đọc: trang Tổng hợp + Chi phí (như 📎 Tải file kế toán ở CRM: ktParse, chép y từ crm/app.js — sửa 1 bên thì sửa cả 2),
// và 3 trang hằng ngày: "Sổ chi" (mỗi khoản chi 1 dòng), "Số dư ngân hàng" (số dư cuối ngày từng tài khoản), "Công nợ" (nợ nhà cung cấp + hạn thanh toán).
// Lưu kv opex_cfg (chi phí theo tháng, như tải file) + kv fin_cfg (tiền, sổ chi, công nợ). Cron 7h30 rồi 3 tiếng / lần tới 20h (gói Workers $5, đọc 1 file ~70ms CPU); 8h sáng nhắn Telegram riêng cho Quản trị.
import { esc, fmtDate, startOfDay, all, run, kvSet, kvJson, DAY, CRM_URL } from './lib.js';
import { telegramTo } from './google.js';
import { ktMorningLines } from './kt.js';
import { nccMerge } from './ncc.js';

function norm(s) { return String(s || '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/đ/g, 'd'); }
function pad(n) { return (n < 10 ? '0' : '') + n; }
function zipDir(u8) {
  var dv = new DataView(u8.buffer, u8.byteOffset, u8.byteLength), e = -1, out = {};
  for (var i = u8.length - 22; i >= Math.max(0, u8.length - 70000); i--) if (dv.getUint32(i, true) === 0x06054b50) { e = i; break; }
  if (e < 0) throw new Error('File Excel bị lỗi hoặc chưa tải xong. Tải lại file từ sàn.');
  var n = dv.getUint16(e + 10, true), p = dv.getUint32(e + 16, true), td = new TextDecoder();
  for (var k = 0; k < n && dv.getUint32(p, true) === 0x02014b50; k++) {
    var nl = dv.getUint16(p + 28, true), xl = dv.getUint16(p + 30, true), cl = dv.getUint16(p + 32, true);
    out[td.decode(u8.subarray(p + 46, p + 46 + nl))] = { m: dv.getUint16(p + 10, true), cs: dv.getUint32(p + 20, true), us: dv.getUint32(p + 24, true), lo: dv.getUint32(p + 42, true) };
    p += 46 + nl + xl + cl;
  }
  return out;
}
function zipText(u8, z, name) {
  var e = z[name]; if (!e) return Promise.resolve('');
  var dv = new DataView(u8.buffer, u8.byteOffset, u8.byteLength), st = e.lo + 30 + dv.getUint16(e.lo + 26, true) + dv.getUint16(e.lo + 28, true), data = u8.subarray(st, st + e.cs);
  if (e.m === 0) return Promise.resolve(new TextDecoder().decode(data));
  if (typeof DecompressionStream === 'undefined') return Promise.reject(new Error('Trình duyệt này chưa đọc được file Excel. Cập nhật trình duyệt (Chrome, Safari mới), hoặc lưu file thành .csv rồi tải lên.'));
  return new Response(new Blob([data]).stream().pipeThrough(new DecompressionStream('deflate-raw'))).text();
}
function xmlDec(s) { return s.indexOf('&') < 0 ? s : s.replace(/&(lt|gt|quot|apos|amp|#\d+|#x[0-9a-f]+);/gi, function (_, e) { var k = e.toLowerCase(); return { lt: '<', gt: '>', quot: '"', apos: "'", amp: '&' }[k] || String.fromCodePoint(k[1] === 'x' ? parseInt(k.slice(2), 16) : +k.slice(1)); }); }
function xmlTxt(x) { var out = ''; x.replace(/<t(?:\s[^>]*)?>([\s\S]*?)<\/t>/g, function (_, t) { out += t; return ''; }); return xmlDec(out); }
function xlsxCol(s) { var n = 0; for (var i = 0; i < s.length; i++) n = n * 26 + s.charCodeAt(i) - 64; return n - 1; }
function xlsxRows(x, ss) {
  var rows = [];
  x.replace(/<row\b[^>]*?(?:\/>|>([\s\S]*?)<\/row>)/g, function (_, inner) {
    var row = [];
    if (inner) inner.replace(/<c\b([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/g, function (_, at, body) {
      var ref = (at.match(/\br="([A-Z]+)/) || [])[1], t = (at.match(/\bt="(\w+)"/) || [])[1] || '', v = '';
      if (body) {
        if (t === 'inlineStr') v = xmlTxt(body);
        else { var mv = body.match(/<v>([\s\S]*?)<\/v>/); v = mv ? xmlDec(mv[1]) : ''; if (t === 's') v = ss[+v] || ''; else if ((t === '' || t === 'n') && v !== '' && !isNaN(+v)) v = +v; }
      }
      row[ref ? xlsxCol(ref) : row.length] = v; return '';
    });
    for (var i = 0; i < row.length; i++) if (row[i] === undefined) row[i] = '';
    rows.push(row); return '';
  });
  return rows;
}
export function xlsxNamed(u8, maxMb) {
  var z = zipDir(u8);
  return Promise.all([zipText(u8, z, 'xl/workbook.xml'), zipText(u8, z, 'xl/_rels/workbook.xml.rels'), zipText(u8, z, 'xl/sharedStrings.xml')]).then(function (a) {
    var rel = {}, sh = [], ss = [];
    a[1].replace(/<Relationship\b([^>]*)>/g, function (_, at) { var id = (at.match(/\bId="([^"]+)"/) || [])[1], tg = (at.match(/\bTarget="([^"]+)"/) || [])[1]; if (id && tg) rel[id] = tg.replace(/^\//, '').replace(/^(?!xl\/)/, 'xl/'); return ''; });
    a[0].replace(/<sheet\b([^>]*)>/g, function (_, at) { var id = (at.match(/\br:id="([^"]+)"/) || [])[1], nm = (at.match(/\bname="([^"]*)"/) || [])[1]; if (rel[id] && z[rel[id]]) sh.push({ n: xmlDec(nm || ''), p: rel[id] }); return ''; });
    a[2].replace(/<si(?:\s[^>]*)?>([\s\S]*?)<\/si>|<si\/>/g, function (_, inner) { ss.push(inner ? xmlTxt(inner.replace(/<rPh\b[\s\S]*?<\/rPh>/g, '')) : ''); return ''; });
    sh = sh.filter(function (x, i) { return z[x.p].us <= maxMb * 1e6 && (i === 0 || /tong hop|chi phi|cong no|so chi|so du/.test(norm(x.n))); }).slice(0, 10); // chỉ đọc trang cần (đỡ tốn CPU máy chủ)
    return Promise.all(sh.map(function (x) { return zipText(u8, z, x.p).then(function (t) { return { n: x.n, rows: xlsxRows(t, ss) }; }); }));
  });
}
var KT_KEY = { sale: /^(tong )?doanh thu sale$/, shopee: /^(tong )?doanh thu shopee$/, dt: /^tong doanh thu/, cogs: /^gia von( hang ban)?$/, gp: /^loi nhuan gop$/, cost: /^tong chi phi$/,
  profit: /^loi nhuan truoc thue/, flow: /^dong tien thuan/, cash: /so du tien gui.*cuoi ky|^tien ngan hang cuoi ky/, payable: /^(con )?phai tra nha cung cap$/ };
function ktKind(g) { var n = norm(g); return /quang cao|\bads\b/.test(n) ? 'ads' : /san tmdt|shopee|tiktok shop|lazada/.test(n) ? 'san' : ''; }
function ktRow(row) {
  var s = [], v = [];
  row.forEach(function (c) { if (typeof c === 'number') { if (s.length) v.push(c); } else { var t = String(c).trim(); if (t && !v.length && !/^([ivx]+|\d+)\.?$/i.test(t)) s.push(t); } });
  var l = s.join(' '); return { l: l, n: norm(l).replace(/^[ivx]+\.\s*/, '').replace(/\s+/g, ' ').trim(), v: v };
}
export function ktParse(sheets, fname) {
  var sum = {}, rep = '', yr = 0, mo = 0, gB = [], inB = false, mat = {}, matDone = false; // chỉ đọc bảng chi phí theo tháng đầu tiên (file T9 còn bảng tổng hợp theo nhóm lặp lại số)
  sheets.forEach(function (sh, si) {
    var mc = null, gc = -1;
    sh.rows.forEach(function (row) {
      var r = ktRow(row), txt = norm(row.filter(function (c) { return typeof c === 'string'; }).join(' '));
      if (!yr && /^nam bao cao/.test(r.n) && r.v[0] > 2000) yr = r.v[0];
      if (!mo && /^thang bao cao/.test(r.n) && r.v[0] >= 1 && r.v[0] <= 12) mo = r.v[0];
      if (!rep) { var km = txt.match(/thang\s*(\d{1,2})\s*\/\s*(20\d\d)/); if (km && +km[1] >= 1 && +km[1] <= 12) rep = km[2] + '-' + pad(+km[1]); }
      if (si === 0) {
        Object.keys(KT_KEY).some(function (k) {
          if (!KT_KEY[k].test(r.n) || !r.v.length) return false;
          if (k === 'payable') { if (/^con /.test(r.n) || sum.payable == null) sum.payable = /^con /.test(r.n) || r.v.length < 3 ? r.v[0] : r.v[2]; }
          else if (sum[k] == null) sum[k] = r.v[0];
          return true;
        });
        // khối chi phí theo nhóm của trang tổng hợp: từ dòng tiêu đề "Chi phí" / "Cơ cấu chi phí" tới "Tổng chi phí"
        if (!r.v.length && /^(chi phi|co cau chi phi.*)$/.test(r.n)) { inB = !gB.length; return; }
        if (inB) { if (/^tong chi phi/.test(r.n) || /^(iv|kết quả)/i.test(r.l)) inB = false; else if (r.l && r.v.length && !/^(nhom chi phi|chi tieu)/.test(r.n)) gB.push([r.l.replace(/\s+/g, ' '), r.v[0]]); }
      }
      // bảng chi phí theo tháng (cột 1…12): cộng theo nhóm cho từng tháng
      if (mc === null) { if (matDone) return; var j = row.map(function (c) { return norm(c).trim(); }).indexOf('nhom chi phi'); if (j >= 0 && row.filter(function (c) { return typeof c === 'number' && c >= 1 && c <= 12; }).length >= 6) { mc = {}; gc = j; row.forEach(function (c, i) { if (typeof c === 'number' && c >= 1 && c <= 12 && mc[c] == null) mc[c] = i; }); } return; }
      if (mc === false) return;
      if (/tong chi phi|tong hop theo nhom/.test(txt)) { mc = false; matDone = true; return; }
      var g = String(row[gc] || '').trim(); if (!g || typeof row[gc] === 'number') return;
      Object.keys(mc).forEach(function (m) { var v = row[mc[m]]; if (typeof v === 'number' && v) { var a = mat[m] || (mat[m] = {}); a[g] = (a[g] || 0) + v; } });
    });
  });
  if (yr && mo) rep = yr + '-' + pad(mo);
  if (!rep) { var fm = String(fname || '').match(/(?:^|[^a-z])t(?:hang)?\s*(\d{1,2})(?!\d)/i); if (fm && +fm[1] >= 1 && +fm[1] <= 12) rep = (yr || new Date().getFullYear()) + '-' + pad(+fm[1]); }
  var Y = rep ? rep.slice(0, 4) : String(yr || new Date().getFullYear()), months = {};
  Object.keys(mat).forEach(function (m) { var a = mat[m], L = Object.keys(a).map(function (k) { return [k, Math.round(a[k])]; }).filter(function (x) { return x[1]; }); if (L.length) months[Y + '-' + pad(+m)] = L; });
  if (rep && !months[rep] && gB.length) months[rep] = gB.map(function (x) { return [x[0], Math.round(x[1])]; }).filter(function (x) { return x[1]; });
  ['sale', 'shopee', 'cogs'].forEach(function (k) { if (sum[k] != null) sum[k] = Math.round(sum[k]); });
  if (sum.dt == null && (sum.sale != null || sum.shopee != null)) sum.dt = (sum.sale || 0) + (sum.shopee || 0);
  return { rep: rep, sum: sum, months: months };
}
function ktSplit(groups) {
  var o = { items: [], ads: 0, san: 0, tot: 0 };
  groups.forEach(function (g) { var k = ktKind(g[0]); o.tot += g[1]; if (k) o[k] += g[1]; else o.items.push(g); });
  return o;
}

/* ================= Phần mới: đọc 3 trang hằng ngày ================= */
/** Ô ngày → 'YYYY-MM-DD': số ngày kiểu Excel (46331), chữ 05/11/2026 hoặc 2026-11-05. */
function isoDay(v) {
  if (typeof v === 'number' && v > 30000 && v < 80000) { const d = new Date(Date.UTC(1899, 11, 30) + Math.round(v) * DAY); return d.toISOString().slice(0, 10); }
  const s = String(v || '').trim(); let m = s.match(/^(\d{1,2})[\/.-](\d{1,2})[\/.-](20\d\d)/); if (m) return m[3] + '-' + pad(+m[2]) + '-' + pad(+m[1]);
  m = s.match(/^(20\d\d)-(\d\d)-(\d\d)/); return m ? m[0] : '';
}
function num(v) { if (typeof v === 'number') return v; const s = String(v || '').replace(/[^\d-]/g, ''); return s && s !== '-' ? +s : 0; }
/** Nhóm trong sổ chi không phải chi phí (chỉ là tiền ra): trả nợ / nhập hàng / chuyển nội bộ / thuế. */
export function chiKind(g) { const n = norm(g); return /chuyen (giua|noi bo)|chuyen tien|rut tien/.test(n) ? 'move' : /tra no|nha cung cap|nhap hang/.test(n) ? 'ncc' : /^thue\b(?! (van phong|mat bang|nha|kho))/.test(n) ? 'tax' : ''; }
/** Tìm dòng tiêu đề có đủ các cột (mỗi mục là regex trên tên cột đã bỏ dấu) → { r: số dòng, c: { tên: vị trí } }. */
function findHead(rows, want, max) {
  for (let i = 0; i < Math.min(rows.length, max || 30); i++) {
    const H = rows[i].map(x => norm(x).replace(/\s+/g, ' ').trim()), c = {};
    let ok = true; for (const k in want) { const j = H.findIndex(h => want[k].test(h)); if (j < 0) { ok = false; break; } c[k] = j; }
    if (ok) return { r: i, c, H };
  }
  return null;
}
export function finParse(sheets) {
  const out = { chi: null, bank: null, pay: null };
  for (const sh of sheets) {
    const nm = norm(sh.n);
    if (!out.chi && /so chi/.test(nm)) {
      const h = findHead(sh.rows, { d: /^ngay/, g: /^nhom/, v: /^so tien/ }); if (!h) continue;
      const nd = h.H.findIndex(x => /^noi dung|dien giai/.test(x)), to = h.H.findIndex(x => /nguoi nhan|nha cung cap/.test(x)), L = [];
      sh.rows.slice(h.r + 1).forEach(r => { const d = isoDay(r[h.c.d]), v = num(r[h.c.v]); if (d && v > 0) L.push([d, String(r[h.c.g] || 'Chưa chọn nhóm').trim(), Math.round(v), nd >= 0 ? String(r[nd] || '').trim().slice(0, 80) : '', to >= 0 ? String(r[to] || '').trim().slice(0, 60) : '']); });
      out.chi = L;
    }
    if (!out.bank && /so du/.test(nm)) {
      const h = findHead(sh.rows, { d: /^ngay/, t: /^tong/ }); if (!h) continue;
      const acc = h.H.map((x, j) => j !== h.c.d && j !== h.c.t && x && !/ghi chu/.test(x) ? j : -1).filter(j => j >= 0), names = acc.map(j => String(sh.rows[h.r][j]).trim()), L = [];
      sh.rows.slice(h.r + 1).forEach(r => {
        const d = isoDay(r[h.c.d]); if (!d) return; const v = acc.map(j => Math.round(num(r[j]))), s = v.reduce((a, b) => a + b, 0), t = num(r[h.c.t]) || s;
        if (t || s) L.push([d, Math.round(t), v]);
      });
      L.sort((a, b) => a[0] < b[0] ? -1 : 1); out.bank = { acc: names, rows: L.slice(-62) };
    }
    if (!out.pay && /cong no/.test(nm)) {
      const h = findHead(sh.rows, { ncc: /^nha cung cap/, v: /^gia tri/ }, 40); if (!h) continue;
      const H = h.H, f = re => H.findIndex(x => re.test(x)), cHd = f(/so hoa don|chung tu/), cNg = f(/^ngay hoa don/), cHan = f(/^han/), cPaid = f(/^da thanh toan/), cCon = f(/^con phai tra/), L = [];
      for (const r of sh.rows.slice(h.r + 1)) {
        const n = String(r[h.c.ncc] || '').trim(); if (!n) continue;
        if (/^(tong|cong)( cong)?\s*$|^tong cong/.test(norm(n).trim())) break;
        const v = num(r[h.c.v]), paid = cPaid >= 0 ? num(r[cPaid]) : 0, con = cCon >= 0 && r[cCon] !== '' && r[cCon] != null ? num(r[cCon]) : v - paid;
        if (con > 0) L.push([n.slice(0, 80), cHd >= 0 ? String(r[cHd] || '').trim().slice(0, 30) : '', cNg >= 0 ? isoDay(r[cNg]) : '', cHan >= 0 ? isoDay(r[cHan]) : '', Math.round(con), Math.round(v)]);
      }
      out.pay = L;
    }
  }
  return out;
}

/* ================= Tải link, lưu vào CRM ================= */
export function sheetId(link) { return (String(link || '').match(/(?:docs\.google\.com\/spreadsheets\/d\/|drive\.google\.com\/(?:file\/d\/|open\?id=))([\w-]{20,})/) || [])[1] || ''; }
/** Tải bản .xlsx của Google Sheet (link phải mở "Bất kỳ ai có đường liên kết"). → { buf, name } hoặc { error } */
export async function fetchXlsx(link) {
  const id = sheetId(link); if (!id) return { error: 'Link chưa đúng: cần link Google Sheet (docs.google.com/spreadsheets/d/…).' };
  for (const url of ['https://docs.google.com/spreadsheets/d/' + id + '/export?format=xlsx', 'https://drive.google.com/uc?export=download&id=' + id]) {
    let r; try { r = await fetch(url, { redirect: 'follow' }); } catch (e) { continue; }
    if (!r.ok) continue;
    const buf = new Uint8Array(await r.arrayBuffer());
    if (buf.length < 4 || buf[0] !== 0x50 || buf[1] !== 0x4B) continue; // trang đăng nhập Google (HTML) = link chưa mở quyền xem
    if (buf.length > 15e6) return { error: 'File quá lớn (' + Math.round(buf.length / 1e6) + ' MB). Tải file về máy rồi chọn file.' };
    const cd = r.headers.get('content-disposition') || '', nm = (cd.match(/filename\*=UTF-8''([^;]+)/i) || [])[1] || (cd.match(/filename="([^"]+)"/i) || [])[1] || '';
    let name = 'Google Sheet kế toán.xlsx'; try { if (nm) name = decodeURIComponent(nm); } catch (e) { name = nm; }
    return { buf, name: /\.xlsx$/i.test(name) ? name : name + '.xlsx' };
  }
  return { error: 'Không tải được file. Nhờ kế toán bật Chia sẻ → "Bất kỳ ai có đường liên kết" → Người xem, rồi thử lại.' };
}
/** Ghi kết quả đọc file (P = ktParse, F = finParse) vào opex_cfg + fin_cfg. Dùng chung cho máy chủ tự đọc (finSync) và CRM đọc trên máy rồi gửi lên (fin_save). */
export async function finStore(x, P, F, fname, by) {
  const O = (await kvJson(x.db, 'opex_cfg', {})) || {}, now = Date.now(), saved = [], M = (P && P.months) || {};
  Object.keys(M).filter(m => /^20\d\d-(0[1-9]|1[0-2])$/.test(m) && Array.isArray(M[m])).slice(0, 14).forEach(m => {
    const old = O[m], own = old && old.kt && old.kt.dt != null && !old.kt.link; // tháng đã có file báo cáo riêng (tải tay) → chỉ thay tháng báo cáo của link
    if (m !== P.rep && own) return;
    const g = M[m].slice(0, 60).map(r => [String(r[0] || '').slice(0, 80), Math.round(Number(r[1]) || 0)]).filter(r => r[0] && r[1]), sp = ktSplit(g);
    const sum = {}; if (m === P.rep) Object.keys(KT_KEY).concat(['dt']).forEach(k => { const v = Number((P.sum || {})[k]); if (isFinite(v) && (P.sum || {})[k] != null) sum[k] = Math.round(v); });
    O[m] = Object.assign({ items: sp.items, at: now, by: by || 'Tự đọc link' }, { kt: Object.assign({ file: String(fname || '').slice(0, 120), link: 1, groups: g, ads: sp.ads, san: sp.san }, sum) }, old && old.pay ? { pay: old.pay } : {}); saved.push(m);
  });
  if (saved.length) await kvSet(x.db, 'opex_cfg', JSON.stringify(O));
  F = F || {};
  const fin = { at: now, by: by || 'Tự đọc link', file: String(fname || '').slice(0, 120), rep: P && P.rep || '',
    chi: Array.isArray(F.chi) ? F.chi.slice(-1500).map(r => [String(r[0]).slice(0, 10), String(r[1] || '').slice(0, 60), Math.round(Number(r[2]) || 0), String(r[3] || '').slice(0, 80), String(r[4] || '').slice(0, 60)]) : null,
    bank: F.bank && Array.isArray(F.bank.rows) ? { acc: (F.bank.acc || []).slice(0, 10).map(a => String(a).slice(0, 40)), rows: F.bank.rows.slice(-62).map(r => [String(r[0]).slice(0, 10), Math.round(Number(r[1]) || 0), (r[2] || []).slice(0, 10).map(v => Math.round(Number(v) || 0))]) } : null,
    pay: Array.isArray(F.pay) ? F.pay.slice(0, 200).map(r => [String(r[0] || '').slice(0, 80), String(r[1] || '').slice(0, 30), String(r[2] || '').slice(0, 10), String(r[3] || '').slice(0, 10), Math.round(Number(r[4]) || 0), Math.round(Number(r[5]) || 0)]) : null };
  await kvSet(x.db, 'fin_cfg', JSON.stringify(fin));
  const L = await kvJson(x.db, 'kt_link', null); if (L) { L.last = now; delete L.err; await kvSet(x.db, 'kt_link', JSON.stringify(L)); }
  return { ok: true, opex: O, fin: await finFull(x, fin), saved };
}
/** Máy chủ tự đọc link đã nối (cron 7h30). Trang quá nặng (vd "Doanh thu" kê từng hoá đơn) và trang không cần thì bỏ qua cho nhẹ. */
export async function finSync(x, by) {
  const L = await kvJson(x.db, 'kt_link', null); if (!L || !L.link) return { ok: false, error: 'Chưa nối link Google Sheet kế toán.' };
  const f = await fetchXlsx(L.link);
  if (f.error) { L.err = f.error; L.errAt = Date.now(); await kvSet(x.db, 'kt_link', JSON.stringify(L)); return { ok: false, error: f.error }; }
  const sh = await xlsxNamed(f.buf, 0.6);
  return finStore(x, ktParse(sh, f.name), finParse(sh), f.name, by);
}
/* ---------- 🏦 Tiền ra + số dư từ sao kê ngân hàng (11/11/2026, anh Sơn: mọi khoản chi đều qua tài khoản → tải sao kê là đủ, không ghi Sổ chi).
 * CRM đọc sao kê VCB trên máy (ktsParse), tự xếp nhóm theo nội dung (ktcGuess + bộ nhớ kt_chi_map theo người nhận), kế toán xem lại rồi gửi kt_chis.
 * Bảng kt_chi: mỗi khoản tiền ra 1 dòng (id = số TK:số CT). kv kt_bal = {số TK: {name, d: {ngày: số dư cuối ngày}}}.
 * finFull gộp vào fin_cfg trước khi trả CRM / tin 8h / trợ lý: chi += dòng sao kê (bỏ dòng Sổ chi trùng ngày + số tiền), bank += số dư theo tài khoản (khớp tên trang Số dư theo 3 số cuối TK). */
let kcOk = false;
async function kcSchema(db) {
  if (kcOk) return;
  await run(db, "CREATE TABLE IF NOT EXISTS kt_chi (id TEXT PRIMARY KEY, acct TEXT DEFAULT '', day TEXT, amt INTEGER DEFAULT 0, grp TEXT DEFAULT '', txt TEXT DEFAULT '', man INTEGER DEFAULT 0, by_name TEXT DEFAULT '', at INTEGER)");
  kcOk = true;
}
const KC_DAYS = 400;
function kcLabel(acct) { const a = String(acct || ''); return a ? 'TK …' + a.slice(-3) : ''; }
/** Số tài chính đầy đủ = file kế toán + sao kê (finFull0) + sổ công nợ nhà cung cấp trong CRM (ncc.js, 12/11/2026). */
export async function finFull(x, F) { return nccMerge(x, await finFull0(x, F)); }
async function finFull0(x, F) {
  let R = [], B = {};
  try { await kcSchema(x.db); R = await all(x.db, 'SELECT acct, day, amt, grp, txt FROM kt_chi WHERE day >= ? ORDER BY day', fmtDate(Date.now() - KC_DAYS * DAY, 'yyyy-MM-dd')); B = (await kvJson(x.db, 'kt_bal', null)) || {}; } catch (e) { return F; }
  if (!R.length && !Object.keys(B).length) return F;
  const G = Object.assign({}, F || { at: 0, file: '', chi: null, bank: null, pay: null });
  if (R.length) {
    const seen = {}; R.forEach(r => { seen[r.day + ':' + r.amt] = (seen[r.day + ':' + r.amt] || 0) + 1; });
    const sheet = (G.chi || []).filter(r => { const k = r[0] + ':' + r[2]; if (seen[k]) { seen[k]--; return false; } return true; }); // khoản chuyển khoản kế toán lỡ ghi cả Sổ chi → giữ dòng sao kê
    G.chi = sheet.concat(R.map(r => [r.day, r.grp || 'Chưa chọn nhóm', r.amt, String(r.txt || '').slice(0, 80), kcLabel(r.acct)])).sort((a, b) => a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0);
    G.chiBank = R.length;
  }
  const ks = Object.keys(B).filter(k => B[k] && B[k].d && Object.keys(B[k].d).length);
  if (ks.length) {
    const sb = G.bank && G.bank.rows ? G.bank : { acc: [], rows: [] }, acc = sb.acc.slice(), src = acc.map(() => null);
    ks.forEach(k => { let j = acc.findIndex((a, i) => !src[i] && String(a).replace(/\D/g, '').slice(-3) === k.slice(-3)); const bn = norm(B[k].name || ''); if (j < 0 && bn) j = acc.findIndex((a, i) => !src[i] && !/\d{3}/.test(a) && norm(a).split(/[^a-z0-9]+/).indexOf(bn) >= 0); if (j >= 0) src[j] = k; else { acc.push((B[k].name ? B[k].name + ' ' : 'TK ') + '…' + k.slice(-3)); src.push(k); } });
    const days = {}; sb.rows.forEach(r => { days[r[0]] = 1; }); ks.forEach(k => Object.keys(B[k].d).forEach(d => { days[d] = 1; }));
    const sheetAt = (j, d) => { let v = null; sb.rows.forEach(r => { if (r[0] <= d && r[2] && r[2][j] != null && r[2][j] !== 0) v = r[2][j]; }); return v; };
    const bankAt = (k, d) => { let v = null, best = ''; Object.keys(B[k].d).forEach(x2 => { if (x2 <= d && x2 > best) { best = x2; v = B[k].d[x2]; } }); return v; };
    const rows = Object.keys(days).sort().slice(-62).map(d => { const v = acc.map((a, j) => { const w = src[j] ? bankAt(src[j], d) : null; return Math.round(w != null ? w : j < sb.acc.length ? sheetAt(j, d) || 0 : 0); }); return [d, v.reduce((a, b) => a + b, 0), v]; });
    G.bank = { acc, rows, fromBank: ks.map(kcLabel) };
  }
  return G;
}
/** kt_chi {from?}: danh sách tiền ra + bộ nhớ nhóm · kt_chis {acct, name, rows: [{doc, day, amt, txt, grp, man}], bal: {ngày: số dư}, map: {khoá: nhóm}} · kt_chig {id, grp, key}. Kế toán + Quản trị. */
export async function crmKtChi(x, u, d, log) {
  if (!(u.level >= 3 || u.role === 'Kế toán')) return { ok: false, error: 'Chỉ Kế toán và Quản trị làm được việc này.' };
  await kcSchema(x.db); const now = Date.now(), map = (await kvJson(x.db, 'kt_chi_map', null)) || {};
  const list = async () => (await all(x.db, 'SELECT * FROM kt_chi WHERE day >= ? ORDER BY day DESC, id LIMIT 3000', /^20\d\d-\d\d-\d\d$/.test(d.from || '') ? d.from : fmtDate(now - 120 * DAY, 'yyyy-MM-dd'))).map(r => ({ id: r.id, acct: r.acct, day: r.day, amt: r.amt, grp: r.grp, txt: r.txt, man: r.man, by: r.by_name, at: r.at }));
  const putMap = async M => { let n = 0; Object.keys(M || {}).slice(0, 300).forEach(k => { const g = String(M[k] || '').trim().slice(0, 60), kk = String(k).slice(0, 60); if (kk && g) { map[kk] = g; n++; } }); if (n) { const ks = Object.keys(map); if (ks.length > 800) ks.slice(0, ks.length - 800).forEach(k => delete map[k]); await kvSet(x.db, 'kt_chi_map', JSON.stringify(map)); } };
  const fin = async () => finFull(x, await kvJson(x.db, 'fin_cfg', null));
  if (d.action === 'kt_chi') return { ok: true, rows: await list(), map };
  if (d.action === 'kt_chig') {
    const id = String(d.id || ''), g = String(d.grp || '').trim().slice(0, 60); if (!id || !g) return { ok: false, error: 'Thiếu khoản chi hoặc nhóm.' };
    await run(x.db, 'UPDATE kt_chi SET grp = ?, man = 1, by_name = ?, at = ? WHERE id = ?', g, u.name, now, id);
    if (d.key) await putMap({ [d.key]: g });
    return { ok: true, rows: await list(), map, fin: await fin() };
  }
  if (d.action !== 'kt_chis') return { ok: false, error: 'Không rõ thao tác: ' + d.action };
  const acct = String(d.acct || '').replace(/\D/g, '').slice(0, 20); if (!acct) return { ok: false, error: 'Sao kê không có số tài khoản.' };
  const rows = (Array.isArray(d.rows) ? d.rows : []).slice(0, 2000).filter(r => /^20\d\d-\d\d-\d\d$/.test(r.day || '') && Number(r.amt) > 0);
  const st = rows.map(r => x.db.prepare(`INSERT INTO kt_chi (id, acct, day, amt, grp, txt, man, by_name, at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(id) DO UPDATE SET day = excluded.day, amt = excluded.amt, txt = excluded.txt, grp = CASE WHEN kt_chi.man = 1 AND excluded.man = 0 THEN kt_chi.grp ELSE excluded.grp END, man = MAX(kt_chi.man, excluded.man), by_name = excluded.by_name, at = excluded.at`)
    .bind(acct + ':' + String(r.doc || r.day + '·' + r.amt).slice(0, 60), acct, r.day, Math.round(Number(r.amt)), String(r.grp || '').trim().slice(0, 60), String(r.txt || '').slice(0, 200), r.man ? 1 : 0, u.name, now));
  for (let i = 0; i < st.length; i += 100) await x.db.batch(st.slice(i, i + 100));
  await putMap(d.map);
  const bal = d.bal && typeof d.bal === 'object' ? d.bal : {}, bd = Object.keys(bal).filter(k => /^20\d\d-\d\d-\d\d$/.test(k));
  if (bd.length) {
    const B = (await kvJson(x.db, 'kt_bal', null)) || {}, cut = fmtDate(now - KC_DAYS * DAY, 'yyyy-MM-dd'), o = B[acct] || { name: '', d: {} };
    o.name = String(d.name || o.name || '').slice(0, 30); bd.forEach(k => { o.d[k] = Math.round(Number(bal[k]) || 0); }); Object.keys(o.d).forEach(k => { if (k < cut) delete o.d[k]; });
    B[acct] = o; await kvSet(x.db, 'kt_bal', JSON.stringify(B));
  }
  if (rows.length) await log(x, u, 'Kế toán', '-', '', 'Lưu ' + rows.length + ' khoản tiền ra từ sao kê TK …' + acct.slice(-3), '');
  return { ok: true, n: rows.length, rows: await list(), map, fin: await fin() };
}
/** Lệnh CRM (chỉ Quản trị): kt_link = nối / bỏ link · fin_save = CRM đọc file trên máy rồi gửi kết quả · fin_test = gửi thử tin sáng cho chính mình. */
export async function crmFin(x, u, d, a) {
  if (!(u.level >= 3 || u.role === 'Kế toán')) return { ok: false, error: 'Bạn không có quyền làm việc này.' };
  if (a === 'kt_link') {
    if (d.off) { await kvSet(x.db, 'kt_link', JSON.stringify({ link: '', by: u.name, at: Date.now() })); return { ok: true, ktLink: null }; }
    if (!sheetId(d.link)) return { ok: false, error: 'Link chưa đúng: cần link Google Sheet (docs.google.com/spreadsheets/d/…).' };
    const L = { link: String(d.link).trim().slice(0, 300), by: u.name, at: Date.now() }; await kvSet(x.db, 'kt_link', JSON.stringify(L)); return { ok: true, ktLink: L };
  }
  if (a === 'fin_save') return finStore(x, d.kt || {}, d.fin || {}, d.file, u.name);
  if (a === 'fin_test') { const t = await finMorning(x); if (!t) return { ok: false, error: 'Chưa có số kế toán để gửi.' }; if (!u.tg) return { ok: false, error: 'Bạn chưa nối Telegram (Cài đặt → 📲 Nhận tin Telegram).', text: t }; await telegramTo(x.env, u.tg, t); return { ok: true }; }
  return { ok: false, error: 'Không rõ thao tác: ' + a };
}

/* ================= Tin Telegram 8h sáng cho Quản trị ================= */
function money(n) { return Math.round(n).toLocaleString('vi-VN') + 'đ'; }
function tr(n) { const a = Math.abs(n); return (n < 0 ? '−' : '') + (a >= 1e6 ? (Math.round(a / 1e5) / 10).toString().replace('.', ',') + ' tr' : money(a)); }
/** Lãi lỗ ước tính kỳ [a, b): doanh số đơn (đã trừ hoàn / huỷ) × (1 − tỷ lệ giá vốn kế toán) − quảng cáo − chi phí cố định theo ngày. Chưa gồm sàn. */
/* Sổ chi → chi phí từng ngày (11/11/2026), giống fxPlan / fxDay trong crm/app.js (sửa 1 bên sửa cả 2): khoản trả theo tháng (FX_PER) chia đều theo chi phí văn phòng tháng gần nhất,
 * khoản phát sinh trừ đúng ngày trong Sổ chi; ngày sau dòng Sổ chi mới nhất / tháng chưa có Sổ chi → tạm tính trung bình như cũ. */
const FX_PER = /luong|nhan vien|nhan su|bhxh|bao hiem|thue (van phong|mat bang|nha|kho)|mat bang|^dien|dien nuoc|nuoc|internet|dien thoai|phan mem|khau hao|van chuyen|ship/;
function fxSkip(g) { const n = norm(g); return !!chiKind(g) || (/quang cao|\bads\b/.test(n) && !/tiktok/.test(n)) || /san tmdt|shopee|lazada/.test(n) || FX_PER.test(n); }
function fxPlan(F) {
  const by = {}, mon = {}; let last = '';
  if (F && F.chi) F.chi.forEach(r => { if (chiKind(r[1]) === 'move') return; if (r[0] > last) last = r[0]; mon[r[0].slice(0, 7)] = 1; if (!fxSkip(r[1])) by[r[0]] = (by[r[0]] || 0) + r[2]; });
  return { by, last, mon };
}
async function plRange(x, a, b, rate, fixDay, C, P) {
  let fix = 0;
  for (let t = a; t < b; t += DAY) { const d = fmtDate(t, 'yyyy-MM-dd'); fix += P && C && P.mon[d.slice(0, 7)] ? C.per + (d <= P.last ? P.by[d] || 0 : fixDay - C.per) : fixDay; }
  const [o] = await all(x.db, "SELECT COALESCE(SUM(total), 0) AS v, COUNT(*) AS n FROM orders WHERE time >= ? AND time < ? AND status NOT LIKE '%hoàn%' AND status NOT LIKE '%huỷ%' AND status NOT LIKE '%hủy%'", a, b);
  const [s] = await all(x.db, 'SELECT COALESCE(SUM(spend), 0) AS v FROM ad_spend WHERE day BETWEEN ? AND ?', fmtDate(a, 'yyyy-MM-dd'), fmtDate(b - 1, 'yyyy-MM-dd'));
  const days = Math.round((b - a) / DAY), gp = o.v * (1 - rate);
  return { rev: o.v, n: o.n, ads: s.v, fix, net: gp - s.v - fix };
}
/** Số liệu chung cho tin sáng + kiểm tra: tỷ lệ giá vốn + chi phí cố định 1 ngày từ tháng kế toán gần nhất. */
function baseCfg(O) {
  const ks = Object.keys(O || {}).sort().reverse(); let rate = 0.3, rm = '', fix = 0, per = 0, fm = '';
  for (const k of ks) { const t = O[k] && O[k].kt; if (!rm && t && t.cogs > 0 && t.dt > 0) { rate = t.cogs / t.dt; rm = k; } if (!fm && O[k] && (O[k].items || []).length) { const y = +k.slice(0, 4), m = +k.slice(5, 7), dim = new Date(Date.UTC(y, m, 0)).getUTCDate(); fix = O[k].items.reduce((s, r) => s + (r[1] || 0), 0) / dim; per = O[k].items.reduce((s, r) => s + (FX_PER.test(norm(r[0])) ? r[1] || 0 : 0), 0) / dim; fm = k; } }
  return { rate, rm, fix, per, fm };
}
export async function finMorning(x) {
  const O = (await kvJson(x.db, 'opex_cfg', {})) || {}, F = await finFull(x, await kvJson(x.db, 'fin_cfg', null)), C = baseCfg(O);
  const KL = await ktMorningLines(x).catch(() => []); // 💤 tiền treo ở hãng (kt.js, 09/11/2026)
  if (!C.fm && !F) return KL.length ? ['💼 <b>Tài chính sáng ' + fmtDate(Date.now(), 'dd/MM') + '</b>', ''].concat(KL, ['', CRM_URL]).join('\n') : ''; // chưa có số kế toán → chỉ gửi phần tiền treo (nếu có)
  const t0 = startOfDay(Date.now()), y0 = t0 - DAY, ym = fmtDate(y0, 'yyyy-MM'), m0 = startOfDay(new Date(ym + '-01T00:00:00+07:00').getTime());
  const P = fxPlan(F), Y = await plRange(x, y0, t0, C.rate, C.fix, C, P), M = await plRange(x, m0, t0, C.rate, C.fix, C, P), md = Math.round((t0 - m0) / DAY);
  const L = ['💼 <b>Tài chính sáng ' + fmtDate(Date.now(), 'dd/MM') + '</b>',
    '', '<b>Hôm qua ' + fmtDate(y0, 'dd/MM') + '</b>: bán ' + tr(Y.rev) + ' (' + Y.n + ' đơn) → ' + (Y.net < 0 ? '🔴 lỗ ' : '🟢 lãi ') + tr(Math.abs(Y.net)),
    '<b>Từ đầu tháng</b> (' + md + ' ngày): bán ' + tr(M.rev) + ' → ' + (M.net < 0 ? '🔴 lỗ ' : '🟢 lãi ') + tr(Math.abs(M.net)) + (M.rev ? ' · quảng cáo ' + Math.round(M.ads * 100 / M.rev) + '% doanh số' : ''),
    C.fix ? '⚖️ Hoà vốn cần bán ~' + tr(C.fix / Math.max(0.05, 1 - C.rate - (M.rev ? M.ads / M.rev : 0.25))) + ' / ngày' : ''];
  if (F && F.bank && F.bank.rows.length) {
    const b = F.bank.rows[F.bank.rows.length - 1], burn = C.fix + (M.rev && md ? (M.rev * C.rate + M.ads) / md : 0);
    L.push('', '🏦 <b>Tiền ngân hàng</b> ' + fmtDate(new Date(b[0] + 'T12:00:00+07:00').getTime(), 'dd/MM') + ': ' + tr(b[1]) + (burn > 0 ? ' · đủ chi khoảng <b>' + Math.max(0, Math.floor(b[1] / burn)) + ' ngày</b>' : ''));
  }
  if (F && F.pay && F.pay.length) {
    const tot = F.pay.reduce((s, r) => s + r[4], 0), td = fmtDate(t0, 'yyyy-MM-dd'), d7 = fmtDate(t0 + 7 * DAY, 'yyyy-MM-dd');
    const due = F.pay.filter(r => r[3] && r[3] <= d7).sort((a, b) => a[3] < b[3] ? -1 : 1), noHan = F.pay.filter(r => !r[3]).length;
    L.push('🧾 <b>Nợ nhà cung cấp</b>: ' + tr(tot) + (due.length ? '\n' + due.slice(0, 5).map(r => '• ' + (r[3] < td ? '⚠️ QUÁ HẠN ' : '') + esc(r[0]) + ': ' + tr(r[4]) + ' – hạn ' + fmtDate(new Date(r[3] + 'T12:00:00+07:00').getTime(), 'dd/MM')).join('\n') : ' · không khoản nào tới hạn 7 ngày tới') + (noHan ? '\n<i>' + noHan + ' hoá đơn chưa ghi hạn thanh toán</i>' : '') + (F.payUnk ? '\n👉 ' + F.payUnk + ' khoản trả nhà cung cấp trên sao kê (' + tr(F.payUnkV || 0) + ') chưa rõ trả cho ai: kế toán chọn ở tab Kế toán → 🧾 Công nợ nhà cung cấp' : ''));
  }
  if (F && F.chi) {
    const yd = fmtDate(y0, 'yyyy-MM-dd'), big = F.chi.filter(r => r[0] === yd && !chiKind(r[1]) && r[2] >= 5e6);
    if (big.length) L.push('', '💸 <b>Khoản chi lớn hôm qua</b>\n' + big.slice(0, 5).map(r => '• ' + esc(r[1]) + (r[3] ? ' – ' + esc(r[3]) : '') + ': ' + tr(r[2])).join('\n'));
    const last = F.chi.reduce((m, r) => r[0] > m ? r[0] : m, '');
    if (last && last < fmtDate(y0 - DAY, 'yyyy-MM-dd')) L.push('<i>Sổ chi chưa cập nhật từ ' + fmtDate(new Date(last + 'T12:00:00+07:00').getTime(), 'dd/MM') + '.</i>');
  }
  if (KL.length) L.push('', ...KL);
  L.push('', '<i>Ước tính: giá vốn ' + Math.round(C.rate * 100) + '% (kế toán ' + (C.rm ? 'T' + +C.rm.slice(5) : 'mặc định') + '), chi phí cố định ' + tr(C.fix) + '/ngày' + (C.fm ? ' (T' + +C.fm.slice(5) + ')' : '') + (P.last ? ', khoản phát sinh theo Sổ chi' : '') + ', chưa gồm sàn.</i>', CRM_URL);
  return L.filter((s, i) => s !== '' || L[i - 1] !== '').join('\n');
}
