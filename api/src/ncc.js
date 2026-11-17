// 🧾 Sổ công nợ nhà cung cấp (12/11/2026, anh Sơn: kế toán ghi công nợ ngay trong CRM thay trang "Công nợ" của file Google Sheet).
// - Bảng ncc (nhà cung cấp: tên, SĐT, số ngày được nợ, từ khoá nhận ra trong sao kê), ncc_bill (hoá đơn nhập hàng: số HĐ, ngày, hạn, tiền),
//   ncc_pay (lần trả: id 'chi:<id kt_chi>' = lấy từ sao kê, 'tay:<…>' = ghi tay; ncc = 0 nghĩa là khoản sao kê này KHÔNG phải trả nhà cung cấp).
// - Còn nợ từng hoá đơn = trả dồn theo thứ tự hạn (hoá đơn cũ trả trước), nên không phải chọn trả cho hoá đơn nào.
// - nccAuto: khoản tiền ra trên sao kê (bảng kt_chi, fin.js) có từ khoá của 1 nhà cung cấp, từ ngày hoá đơn đầu tiên của nhà cung cấp đó → tự ghi đã trả.
//   Khoản nhóm "Trả nợ nhà cung cấp" / "Nhập hàng" không nhận ra → danh sách "trả cho ai?" để kế toán chọn 1 lần (máy nhớ từ khoá).
// - 🔍 Đối chiếu (14/11/2026, sau vụ NCC Dinh Dưỡng Hoa Kỳ gửi công nợ 310tr quên trừ khoản chuyển 40tr ngày 21/10): bảng ncc_chk (mỗi lần NCC gửi số:
//   ngày chốt `upto`, số NCC báo `their`, số sổ CRM tới ngày đó `ours` = tổng hoá đơn − tổng đã trả có ngày ≤ upto, lệch, ghi chú). Ngày 10 hằng tháng (anh Hiếu chốt)
//   NCC còn nợ chưa đối chiếu trong tháng → F.payChk → tin 8h + 👉 Cần anh xử lý ở Tổng quan.
// - nccMerge (gọi trong finFull): có sổ CRM thì F.pay lấy từ sổ này → ô 🧾 Nợ nhà cung cấp ở Tổng quan, tin Telegram 8h, trợ lý dùng luôn.
// - 📎 Chứng từ + ✨ AI đọc ảnh + 🛒 đơn đặt / 🎁 hàng hỗ trợ (17/11/2026, anh Sơn "Làm cả 3" sau tin nhắn NCC Hoa Kỳ: ảnh chuyển khoản, thông báo công nợ, đơn đặt hàng, hỗ trợ 50% VAT bằng hàng):
//   ncc_doc: ảnh / PDF chứng từ (base64 trong D1 như CV ứng viên, ≤ ~1,4 MB/file; ảnh nén ở CRM trước khi gửi), ref = 'bill:<id>' / 'po:<id>' / 'chk:<id>' / '' (chung của NCC).
//   ncc_po: kind 'buy' = đơn đặt hàng (tiền gồm VAT) → hàng về thì tự thành hoá đơn công nợ; 'gift' = NCC còn nợ mình bằng hàng (hỗ trợ VAT, khuyến mại) → không cộng công nợ.
//   Có chọn sản phẩm kho → tạo luôn kho_po (kho thấy "đang đặt"); kho ghi 📥 Hàng về theo lần đặt đó (kho_po done) → nccPoSync tự đánh dấu đã về + tạo hoá đơn.
//   op 'ai' {b64, mime}: AI (Sonnet) đọc chứng từ → {type, ...số} để CRM mở đúng hộp đã điền sẵn.
import { fmtDate, all, run, nrm, randHex, DAY, kvJson, kvSet } from './lib.js';
import Anthropic from '@anthropic-ai/sdk';
import { aiFetch } from './airelay.js';
import { khoSchema } from './kho.js';
import { gInfo } from './google.js';

let ok = false;
async function nccSchema(db) {
  if (ok) return;
  await run(db, "CREATE TABLE IF NOT EXISTS ncc (id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT, phone TEXT DEFAULT '', terms INTEGER DEFAULT 30, keys TEXT DEFAULT '', note TEXT DEFAULT '', off INTEGER DEFAULT 0, by_name TEXT DEFAULT '', at INTEGER)");
  await run(db, "CREATE TABLE IF NOT EXISTS ncc_bill (id INTEGER PRIMARY KEY AUTOINCREMENT, ncc INTEGER, doc TEXT DEFAULT '', day TEXT, due TEXT DEFAULT '', amt INTEGER DEFAULT 0, note TEXT DEFAULT '', by_name TEXT DEFAULT '', at INTEGER)");
  await run(db, "CREATE TABLE IF NOT EXISTS ncc_pay (id TEXT PRIMARY KEY, ncc INTEGER, day TEXT, amt INTEGER DEFAULT 0, src TEXT DEFAULT '', note TEXT DEFAULT '', by_name TEXT DEFAULT '', at INTEGER)");
  await run(db, "CREATE TABLE IF NOT EXISTS ncc_doc (id TEXT PRIMARY KEY, ncc INTEGER, ref TEXT DEFAULT '', kind TEXT DEFAULT '', day TEXT DEFAULT '', name TEXT DEFAULT '', mime TEXT DEFAULT '', size INTEGER DEFAULT 0, b64 TEXT, by_name TEXT DEFAULT '', at INTEGER)");
  try { await run(db, "ALTER TABLE ncc_doc ADD COLUMN drive TEXT DEFAULT ''"); } catch (e) { } // ☁️ id file đã chép lên Google Drive (thứ Hai hằng tuần)
  await run(db, "CREATE TABLE IF NOT EXISTS ncc_po (id INTEGER PRIMARY KEY AUTOINCREMENT, ncc INTEGER, kind TEXT DEFAULT 'buy', day TEXT, doc TEXT DEFAULT '', items TEXT DEFAULT '', amt INTEGER DEFAULT 0, eta TEXT DEFAULT '', kitem TEXT DEFAULT '', qty REAL DEFAULT 0, kpo INTEGER, st TEXT DEFAULT 'open', got_day TEXT DEFAULT '', bill INTEGER, note TEXT DEFAULT '', by_name TEXT DEFAULT '', at INTEGER)");
  await run(db, "CREATE TABLE IF NOT EXISTS ncc_chk (id INTEGER PRIMARY KEY AUTOINCREMENT, ncc INTEGER, upto TEXT, their INTEGER DEFAULT 0, ours INTEGER DEFAULT 0, note TEXT DEFAULT '', by_name TEXT DEFAULT '', at INTEGER)");
  ok = true;
}
export const CHK_DAY = 10; // ngày 10 hằng tháng đối chiếu công nợ nhà cung cấp (anh Hiếu, 14/11/2026)
/** Số sổ CRM còn nợ 1 nhà cung cấp tính đến hết ngày upto (âm = mình trả dư). */
function oweAt(B, P, ncc, upto) {
  let v = 0; B.forEach(b => { if (+b.ncc === +ncc && b.day <= upto) v += b.amt; }); P.forEach(p => { if (+p.ncc === +ncc && p.day <= upto) v -= p.amt; });
  return v;
}
/** Tình trạng đối chiếu tháng này: miss = NCC còn nợ chưa đối chiếu (từ ngày 10), diff = lần đối chiếu gần nhất trong tháng còn lệch. */
export function nccChkState(S, B, P, C, now) {
  const L = nccOpen(B, P).left, owe = {}; B.forEach(b => { if (L[b.id] > 0) owe[b.ncc] = (owe[b.ncc] || 0) + L[b.id]; });
  const td = fmtDate(now, 'yyyy-MM-dd'), mo = td.slice(0, 7), last = {};
  C.forEach(c => { if (fmtDate(c.at, 'yyyy-MM') === mo && (!last[c.ncc] || c.at > last[c.ncc].at)) last[c.ncc] = c; });
  const due = +td.slice(8, 10) >= CHK_DAY, miss = [], diff = [], done = [];
  S.forEach(s => {
    const c = last[s.id];
    if (c) { if (c.their !== c.ours && !/đã giải quyết|da giai quyet/i.test(c.note || '')) diff.push([s.name, c.their - c.ours]); else done.push(s.name); }
    else if (owe[s.id] > 0) miss.push([s.name, owe[s.id]]);
  });
  return { due, mo, miss, diff, done: done.length };
}
const ISO = /^20\d\d-\d\d-\d\d$/;
const NCC_GRP = /tra no|nha cung cap|nhap hang/; // nhóm tiền ra coi là trả nhà cung cấp (giống chiKind 'ncc')
const STOP = /\b(cong ty|cty|tnhh|co phan|cp|mtv|htx|hop tac xa|ho kinh doanh|hkd|tap doan|thuong mai|san xuat|dich vu|tm|sx|dv|xnk|va)\b/g;
/** Từ khoá nhận ra nhà cung cấp trong nội dung sao kê: từ khoá kế toán thêm + tên bỏ chữ "công ty, TNHH…" (≥ 2 chữ). */
function keysOf(s) {
  const K = String(s.keys || '').split('|').map(k => nrm(k)).filter(k => k.length >= 4 && !/vitagreen|thuc duong lanh/.test(k)); // tên công ty mình có trong mọi khoản chuyển đi
  const core = nrm(s.name).replace(/[^a-z0-9 ]/g, ' ').replace(STOP, ' ').replace(/\s+/g, ' ').trim();
  if (core.split(' ').length >= 2 && core.length >= 6) K.push(core);
  return K;
}
const plain = t => nrm(t).replace(/[^a-z0-9 ]/g, ' ').replace(/\s+/g, ' ');
function whoOf(S, txt) {
  const t = plain(txt); let best = null, bl = 0;
  S.forEach(s => keysOf(s).forEach(k => { if (k.length > bl && t.indexOf(k) >= 0) { best = s; bl = k.length; } }));
  return best;
}
/** Tự ghi đã trả cho khoản sao kê nhận ra nhà cung cấp; trả danh sách khoản trả nhà cung cấp chưa rõ trả cho ai. */
async function nccAuto(x, S, B) {
  const first = {}; B.forEach(b => { if (!first[b.ncc] || b.day < first[b.ncc]) first[b.ncc] = b.day; });
  const d0 = Object.keys(first).map(k => first[k]).sort()[0]; if (!d0) return [];
  let R = [];
  try { R = await all(x.db, "SELECT c.id, c.acct, c.day, c.amt, c.grp, c.txt FROM kt_chi c LEFT JOIN ncc_pay p ON p.id = 'chi:' || c.id WHERE p.id IS NULL AND c.day >= ? ORDER BY c.day", d0); } catch (e) { return []; } // chưa tải sao kê lần nào → chưa có bảng kt_chi
  const unk = [], ins = [], now = Date.now(), live = S.filter(s => !s.off);
  R.forEach(r => {
    const g = nrm(r.grp), s = /noi bo|rut tien|chuyen tien/.test(g) ? null : whoOf(live, r.txt);
    if (s && r.day >= (first[s.id] || '9')) ins.push(x.db.prepare("INSERT OR IGNORE INTO ncc_pay (id, ncc, day, amt, src, note, by_name, at) VALUES (?, ?, ?, ?, ?, '', 'Tự khớp sao kê', ?)").bind('chi:' + r.id, s.id, r.day, r.amt, 'Sao kê TK …' + String(r.acct).slice(-3), now));
    else if (NCC_GRP.test(g)) unk.push({ id: r.id, day: r.day, amt: r.amt, txt: String(r.txt || '').slice(0, 160), acct: String(r.acct).slice(-3) });
  });
  for (let i = 0; i < ins.length; i += 100) await x.db.batch(ins.slice(i, i + 100));
  return unk;
}
/** Còn nợ từng hoá đơn: tiền đã trả của nhà cung cấp trừ dần vào hoá đơn hạn sớm nhất. */
export function nccOpen(B, P) {
  const paid = {}; P.forEach(p => { if (p.ncc) paid[p.ncc] = (paid[p.ncc] || 0) + p.amt; });
  const by = {}; B.forEach(b => { (by[b.ncc] = by[b.ncc] || []).push(b); });
  const out = {}, pre = {};
  Object.keys(by).forEach(k => {
    let left = paid[k] || 0;
    by[k].sort((a, b) => ((a.due || a.day) < (b.due || b.day) ? -1 : (a.due || a.day) > (b.due || b.day) ? 1 : a.id - b.id)).forEach(b => { const u = Math.min(b.amt, Math.max(0, left)); left -= u; out[b.id] = b.amt - u; });
    if (left > 0) pre[k] = left; // trả dư = trả trước cho lần nhập sau
  });
  return { left: out, pre };
}
const DOC_MAX = 1.9e6; // ký tự base64 (~1,4 MB): D1 giữ 1 giá trị ≤ 2 MB
export const DOC_KINDS = ['Hoá đơn', 'Phiếu xuất kho', 'Đơn đặt hàng', 'Thông báo công nợ', 'Ảnh chuyển khoản', 'Biên bản đối chiếu', 'Hỗ trợ / khuyến mại', 'Khác'];
/** Hàng về: đơn đặt (buy) → hoá đơn công nợ (hạn = ngày về + số ngày được nợ); hàng hỗ trợ (gift) → chỉ đóng lại. */
async function poGot(x, po, day, who) {
  let bill = null;
  if (po.kind === 'buy' && po.amt > 0 && !po.bill) {
    const s = (await all(x.db, 'SELECT * FROM ncc WHERE id = ?', po.ncc))[0], due = dueOf(day, s ? s.terms || 0 : 0);
    const r = await all(x.db, 'INSERT INTO ncc_bill (ncc, doc, day, due, amt, note, by_name, at) VALUES (?, ?, ?, ?, ?, ?, ?, ?) RETURNING id', po.ncc, po.doc || '', day, due, po.amt, ('Từ đơn đặt ngày ' + po.day.split('-').reverse().join('/') + (po.items ? ': ' + po.items : '')).slice(0, 300), who, Date.now());
    bill = r[0] && r[0].id;
    await run(x.db, "UPDATE ncc_doc SET ref = 'bill:' || ? WHERE ref = 'po:' || ?", bill, po.id); // chứng từ của đơn đặt đi theo hoá đơn
  }
  await run(x.db, "UPDATE ncc_po SET st = 'got', got_day = ?, bill = ? WHERE id = ?", day, bill, po.id);
}
/** Kho đã ghi 📥 Hàng về theo lần đặt (kho_po done) → đơn NCC tự thành đã về. */
async function nccPoSync(x) {
  let R = []; try { R = await all(x.db, "SELECT p.*, k.done_at AS kdone FROM ncc_po p JOIN kho_po k ON k.id = p.kpo WHERE p.st = 'open' AND k.status = 'done'"); } catch (e) { return; }
  for (const po of R) await poGot(x, po, fmtDate(po.kdone || Date.now(), 'yyyy-MM-dd'), 'Kho ghi hàng về');
  try { await run(x.db, "UPDATE ncc_po SET st = 'cancel' WHERE st = 'open' AND kpo IN (SELECT id FROM kho_po WHERE status = 'cancel')"); } catch (e) { }
}
async function load(x) {
  await nccSchema(x.db); await nccPoSync(x);
  const S = await all(x.db, 'SELECT * FROM ncc ORDER BY name'), B = await all(x.db, 'SELECT * FROM ncc_bill ORDER BY day DESC, id DESC LIMIT 5000');
  const unk = await nccAuto(x, S, B), P = await all(x.db, 'SELECT * FROM ncc_pay ORDER BY day DESC LIMIT 5000');
  const C = await all(x.db, 'SELECT * FROM ncc_chk ORDER BY at DESC LIMIT 500');
  const O = await all(x.db, 'SELECT * FROM ncc_po ORDER BY day DESC, id DESC LIMIT 1000'), F = await all(x.db, 'SELECT id, ncc, ref, kind, day, name, mime, size, drive, by_name, at FROM ncc_doc ORDER BY at DESC LIMIT 2000');
  const drv = await kvJson(x.db, 'ncc_drive', null);
  return { S, B, P, unk, C, O, F, drv };
}
/** Gộp vào số tài chính (finFull): F.pay = [tên, số HĐ, ngày HĐ, hạn, còn nợ, giá trị] như trang Công nợ của file kế toán. */
export async function nccMerge(x, F) {
  let D; try { D = await load(x); } catch (e) { return F; }
  if (!D.B.length) return F;
  const L = nccOpen(D.B, D.P).left, nm = {}; D.S.forEach(s => { nm[s.id] = s.name; });
  const G = Object.assign({}, F || { at: 0, file: '', chi: null, bank: null, pay: null });
  G.pay = D.B.filter(b => L[b.id] > 0).map(b => [String(nm[b.ncc] || '?').slice(0, 80), String(b.doc || '').slice(0, 30), b.day || '', b.due || '', L[b.id], b.amt]);
  const K = nccChkState(D.S, D.B, D.P, D.C, Date.now()); G.payChk = { due: K.due, miss: K.miss.slice(0, 20), diff: K.diff.slice(0, 20), done: K.done };
  const og = D.O.filter(o => o.st === 'open'); G.payPo = { buy: og.filter(o => o.kind === 'buy').reduce((t, o) => t + o.amt, 0), nb: og.filter(o => o.kind === 'buy').length, gift: og.filter(o => o.kind === 'gift').reduce((t, o) => t + o.amt, 0), ng: og.filter(o => o.kind === 'gift').length };
  G.paySrc = 'crm'; G.payUnk = D.unk.length; G.payUnkV = D.unk.reduce((s, r) => s + r.amt, 0);
  return G;
}
const out = D => ({
  ok: true,
  ncc: D.S.map(s => ({ id: s.id, name: s.name, phone: s.phone, terms: s.terms, keys: s.keys, note: s.note, off: s.off })),
  bills: D.B.map(b => ({ id: b.id, ncc: b.ncc, doc: b.doc, day: b.day, due: b.due, amt: b.amt, note: b.note, by: b.by_name, at: b.at })),
  pays: D.P.map(p => ({ id: p.id, ncc: p.ncc, day: p.day, amt: p.amt, src: p.src, note: p.note, by: p.by_name })),
  unk: D.unk,
  pos: D.O.map(o => ({ id: o.id, ncc: o.ncc, kind: o.kind, day: o.day, doc: o.doc, items: o.items, amt: o.amt, eta: o.eta, kitem: o.kitem, qty: o.qty, kpo: o.kpo, st: o.st, got: o.got_day, bill: o.bill, note: o.note, by: o.by_name })),
  docs: D.F.map(f => ({ id: f.id, ncc: f.ncc, ref: f.ref, kind: f.kind, day: f.day, name: f.name, mime: f.mime, size: f.size, drive: f.drive || '', by: f.by_name, at: f.at })),
  drive: D.drv || null,
  chks: D.C.map(c => ({ id: c.id, ncc: c.ncc, upto: c.upto, their: c.their, ours: c.ours, note: c.note, by: c.by_name, at: c.at }))
});
const dueOf = (day, terms) => fmtDate(new Date(day + 'T12:00:00+07:00').getTime() + Math.max(0, terms) * DAY, 'yyyy-MM-dd');
const amtOf = v => Math.round(Number(String(v == null ? '' : v).replace(/[^\d-]/g, '')) || 0);

/** kt_ncc {op}: list · sup {id?, name, phone, terms, keys, note, off} · bill {id?, ncc, doc, day, due, amt, note, del} · pay {id?, ncc, day, amt, note, del}
 *  · link {chi, ncc, key} (khoản sao kê → nhà cung cấp, nhớ từ khoá) · skip {chi} (không phải trả nhà cung cấp) · unlink {id} · import {rows: [[tên, số HĐ, ngày, hạn, còn nợ, giá trị]]}. Kế toán + Quản trị. */
export async function crmNcc(x, u, d, log, finAfter) {
  if (!(u.level >= 3 || u.role === 'Kế toán')) return { ok: false, error: 'Chỉ Kế toán và Quản trị làm được việc này.' };
  await nccSchema(x.db);
  const op = String(d.op || 'list'), now = Date.now(), done = async () => { const D = await load(x); return Object.assign(out(D), { fin: finAfter ? await finAfter() : undefined }); };
  if (op === 'list') return out(await load(x));
  if (op === 'sup') {
    const name = String(d.name || '').trim().slice(0, 100); if (!name && !d.id) return { ok: false, error: 'Ghi tên nhà cung cấp.' };
    const terms = Math.max(0, Math.min(365, Math.round(Number(d.terms)))), t = isFinite(terms) ? terms : 30, keys = String(d.keys || '').split(/[|\n,;]+/).map(k => k.trim()).filter(k => nrm(k).length >= 4).slice(0, 10).join('|').slice(0, 400);
    if (d.id) await run(x.db, 'UPDATE ncc SET name = COALESCE(NULLIF(?, \'\'), name), phone = ?, terms = ?, keys = ?, note = ?, off = ?, by_name = ?, at = ? WHERE id = ?', name, String(d.phone || '').slice(0, 60), t, keys, String(d.note || '').slice(0, 300), d.off ? 1 : 0, u.name, now, +d.id);
    else {
      const dup = (await all(x.db, 'SELECT id, name FROM ncc')).filter(s => nrm(s.name) === nrm(name))[0]; if (dup) return { ok: false, error: 'Đã có nhà cung cấp "' + dup.name + '".' };
      await run(x.db, 'INSERT INTO ncc (name, phone, terms, keys, note, by_name, at) VALUES (?, ?, ?, ?, ?, ?, ?)', name, String(d.phone || '').slice(0, 60), t, keys, String(d.note || '').slice(0, 300), u.name, now);
    }
    await log(x, u, 'Kế toán', '-', '', (d.id ? 'Sửa' : 'Thêm') + ' nhà cung cấp ' + name, '');
    return done();
  }
  if (op === 'bill') {
    if (d.id && d.del) { const b = (await all(x.db, 'SELECT * FROM ncc_bill WHERE id = ?', +d.id))[0]; if (b) { await run(x.db, 'DELETE FROM ncc_bill WHERE id = ?', b.id); await log(x, u, 'Kế toán', '-', '', 'Xoá hoá đơn nhà cung cấp ' + (b.doc || '') + ' ' + b.amt, ''); } return done(); }
    const s = (await all(x.db, 'SELECT * FROM ncc WHERE id = ?', +d.ncc))[0]; if (!s) return { ok: false, error: 'Chọn nhà cung cấp.' };
    const amt = amtOf(d.amt); if (amt <= 0) return { ok: false, error: 'Ghi số tiền hoá đơn.' };
    const day = ISO.test(d.day || '') ? d.day : fmtDate(now, 'yyyy-MM-dd'), due = ISO.test(d.due || '') ? d.due : dueOf(day, s.terms || 0);
    if (d.id) await run(x.db, 'UPDATE ncc_bill SET ncc = ?, doc = ?, day = ?, due = ?, amt = ?, note = ?, by_name = ?, at = ? WHERE id = ?', s.id, String(d.doc || '').trim().slice(0, 40), day, due, amt, String(d.note || '').slice(0, 300), u.name, now, +d.id);
    else await run(x.db, 'INSERT INTO ncc_bill (ncc, doc, day, due, amt, note, by_name, at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)', s.id, String(d.doc || '').trim().slice(0, 40), day, due, amt, String(d.note || '').slice(0, 300), u.name, now);
    await log(x, u, 'Kế toán', '-', '', (d.id ? 'Sửa' : 'Ghi') + ' hoá đơn ' + s.name + ' ' + (d.doc || '') + ': ' + amt.toLocaleString('vi-VN') + 'đ, hạn ' + due, '');
    return done();
  }
  if (op === 'pay') {
    if (d.id && d.del) { await run(x.db, "DELETE FROM ncc_pay WHERE id = ? AND id LIKE 'tay:%'", String(d.id)); return done(); }
    const s = (await all(x.db, 'SELECT * FROM ncc WHERE id = ?', +d.ncc))[0]; if (!s) return { ok: false, error: 'Chọn nhà cung cấp.' };
    const amt = amtOf(d.amt); if (amt <= 0) return { ok: false, error: 'Ghi số tiền đã trả.' };
    const day = ISO.test(d.day || '') ? d.day : fmtDate(now, 'yyyy-MM-dd');
    await run(x.db, 'INSERT INTO ncc_pay (id, ncc, day, amt, src, note, by_name, at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)', 'tay:' + randHex(6), s.id, day, amt, 'Ghi tay', String(d.note || '').slice(0, 300), u.name, now);
    await log(x, u, 'Kế toán', '-', '', 'Ghi đã trả ' + s.name + ': ' + amt.toLocaleString('vi-VN') + 'đ (' + (d.note || 'tiền mặt / tài khoản khác') + ')', '');
    return done();
  }
  if (op === 'link' || op === 'skip') {
    const c = (await all(x.db, 'SELECT * FROM kt_chi WHERE id = ?', String(d.chi || '')))[0]; if (!c) return { ok: false, error: 'Không thấy khoản tiền ra này.' };
    let s = null; if (op === 'link') { s = (await all(x.db, 'SELECT * FROM ncc WHERE id = ?', +d.ncc))[0]; if (!s) return { ok: false, error: 'Chọn nhà cung cấp.' }; }
    await run(x.db, 'INSERT INTO ncc_pay (id, ncc, day, amt, src, note, by_name, at) VALUES (?, ?, ?, ?, ?, \'\', ?, ?) ON CONFLICT(id) DO UPDATE SET ncc = excluded.ncc, by_name = excluded.by_name, at = excluded.at',
      'chi:' + c.id, s ? s.id : 0, c.day, c.amt, 'Sao kê TK …' + String(c.acct).slice(-3), u.name, now);
    if (s) {
      const k = String(d.key || '').trim().slice(0, 60); if (k && nrm(k).length >= 4 && !/vitagreen|thuc duong lanh|tap doan/.test(nrm(k)) && plain(c.txt).indexOf(plain(k).trim()) >= 0) { const K = String(s.keys || '').split('|').filter(Boolean); if (K.map(nrm).indexOf(nrm(k)) < 0) { K.push(k); await run(x.db, 'UPDATE ncc SET keys = ? WHERE id = ?', K.slice(-10).join('|'), s.id); } }
      if (!NCC_GRP.test(nrm(c.grp))) await run(x.db, "UPDATE kt_chi SET grp = 'Trả nợ nhà cung cấp', man = 1 WHERE id = ?", c.id); // trả nhà cung cấp không tính là chi phí
    }
    return done();
  }
  if (op === 'chk') { // 🔍 nhà cung cấp gửi công nợ → so với sổ, lưu kết quả
    if (d.del) { await run(x.db, 'DELETE FROM ncc_chk WHERE id = ?', +d.id); return done(); }
    const s = (await all(x.db, 'SELECT * FROM ncc WHERE id = ?', +d.ncc))[0]; if (!s) return { ok: false, error: 'Chọn nhà cung cấp.' };
    const upto = ISO.test(d.upto || '') ? d.upto : fmtDate(now, 'yyyy-MM-dd'), their = Math.round(Number(String(d.their == null ? '' : d.their).replace(/[^\d-]/g, '')));
    if (!isFinite(their) || String(d.their).replace(/[^\d]/g, '') === '') return { ok: false, error: 'Ghi số nhà cung cấp báo còn nợ.' };
    const D = await load(x), ours = oweAt(D.B, D.P, s.id, upto), note = String(d.note || '').trim().slice(0, 500);
    if (d.id) await run(x.db, 'UPDATE ncc_chk SET note = ?, by_name = ? WHERE id = ?', note, u.name, +d.id);
    else await run(x.db, 'INSERT INTO ncc_chk (ncc, upto, their, ours, note, by_name, at) VALUES (?, ?, ?, ?, ?, ?, ?)', s.id, upto, their, ours, note, u.name, now);
    await log(x, u, 'Kế toán', '-', '', 'Đối chiếu công nợ ' + s.name + ' đến ' + upto + ': NCC báo ' + their.toLocaleString('vi-VN') + 'đ, sổ CRM ' + ours.toLocaleString('vi-VN') + 'đ' + (their === ours ? ' ✅ khớp' : ' ⚠️ lệch ' + (their - ours).toLocaleString('vi-VN') + 'đ') + (note ? ' · ' + note : ''), '');
    return done();
  }
  if (op === 'doc') { // 📎 lưu ảnh / PDF chứng từ
    const b64 = String(d.b64 || '').replace(/^data:[^,]*,/, ''), mime = String(d.mime || '');
    if (!b64) return { ok: false, error: 'Chưa chọn file.' }; if (b64.length > DOC_MAX) return { ok: false, error: 'File lớn quá 1,4 MB. Chụp ảnh thay vì PDF, hoặc nén PDF rồi tải lại.' };
    if (!/^(image\/(jpeg|png|webp)|application\/pdf)$/.test(mime)) return { ok: false, error: 'Chỉ nhận ảnh (JPG, PNG) hoặc PDF.' };
    const s = d.ncc ? (await all(x.db, 'SELECT * FROM ncc WHERE id = ?', +d.ncc))[0] : null; if (!s) return { ok: false, error: 'Chọn nhà cung cấp.' };
    const kind = DOC_KINDS.indexOf(d.kind) >= 0 ? d.kind : 'Khác', ref = /^(bill|po|chk):\d+$/.test(d.ref || '') ? d.ref : '', day = ISO.test(d.day || '') ? d.day : fmtDate(now, 'yyyy-MM-dd');
    await run(x.db, 'INSERT INTO ncc_doc (id, ncc, ref, kind, day, name, mime, size, b64, by_name, at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)', randHex(8), s.id, ref, kind, day, String(d.name || kind).slice(0, 120), mime, Math.round(b64.length * 0.75), b64, u.name, now);
    await log(x, u, 'Kế toán', '-', '', 'Lưu chứng từ ' + kind + ' – ' + s.name, String(d.name || ''));
    return done();
  }
  if (op === 'doc_get') { const f = (await all(x.db, 'SELECT * FROM ncc_doc WHERE id = ?', String(d.id || '')))[0]; return f ? { ok: true, b64: f.b64, mime: f.mime, name: f.name } : { ok: false, error: 'Không thấy chứng từ.' }; }
  if (op === 'doc_set') { await run(x.db, 'UPDATE ncc_doc SET ref = ?, kind = COALESCE(NULLIF(?, \'\'), kind) WHERE id = ?', /^(bill|po|chk):\d+$/.test(d.ref || '') ? d.ref : '', DOC_KINDS.indexOf(d.kind) >= 0 ? d.kind : '', String(d.id || '')); return done(); }
  if (op === 'doc_del') { await run(x.db, 'DELETE FROM ncc_doc WHERE id = ?', String(d.id || '')); await log(x, u, 'Kế toán', '-', '', 'Xoá chứng từ nhà cung cấp', ''); return done(); }
  if (op === 'po') { // 🛒 đơn đặt hàng / 🎁 hàng hỗ trợ
    if (d.id && (d.cancel || d.got)) {
      const po = (await all(x.db, 'SELECT * FROM ncc_po WHERE id = ?', +d.id))[0]; if (!po || po.st !== 'open') return done();
      if (d.cancel) { await run(x.db, "UPDATE ncc_po SET st = 'cancel' WHERE id = ?", po.id); if (po.kpo) { try { await run(x.db, "UPDATE kho_po SET status = 'cancel', done_at = ? WHERE id = ? AND status = 'open'", now, po.kpo); } catch (e) { } } await log(x, u, 'Kế toán', '-', '', 'Huỷ ' + (po.kind === 'gift' ? 'hàng hỗ trợ' : 'đơn đặt') + ' nhà cung cấp ' + (po.items || ''), ''); return done(); }
      const day = ISO.test(d.day || '') ? d.day : fmtDate(now, 'yyyy-MM-dd'); await poGot(x, po, day, u.name);
      await log(x, u, 'Kế toán', '-', '', (po.kind === 'gift' ? 'Đã nhận hàng hỗ trợ ' : 'Hàng về, ghi công nợ ') + (po.items || '') + ' ' + po.amt.toLocaleString('vi-VN') + 'đ', ''); return done();
    }
    const s = (await all(x.db, 'SELECT * FROM ncc WHERE id = ?', +d.ncc))[0]; if (!s) return { ok: false, error: 'Chọn nhà cung cấp.' };
    const kind = d.kind === 'gift' ? 'gift' : 'buy', amt = amtOf(d.amt), day = ISO.test(d.day || '') ? d.day : fmtDate(now, 'yyyy-MM-dd'), eta = ISO.test(d.eta || '') ? d.eta : '';
    const items = String(d.items || '').trim().slice(0, 300), note = String(d.note || '').trim().slice(0, 300), qty = Math.max(0, Number(d.qty) || 0);
    if (amt <= 0) return { ok: false, error: kind === 'gift' ? 'Ghi giá trị hàng hỗ trợ.' : 'Ghi tổng tiền đơn đặt (gồm VAT).' }; if (!items) return { ok: false, error: 'Ghi hàng gì, bao nhiêu.' };
    if (d.id) { await run(x.db, "UPDATE ncc_po SET ncc = ?, kind = ?, day = ?, doc = ?, items = ?, amt = ?, eta = ?, note = ?, by_name = ? WHERE id = ? AND st = 'open'", s.id, kind, day, String(d.doc || '').slice(0, 40), items, amt, eta, note, u.name, +d.id); return done(); }
    let kpo = null, kitem = '';
    if (d.kitem && qty > 0) { // kho thấy "đang đặt" + hẹn ngày về
      await khoSchema(x.db); const it = (await all(x.db, 'SELECT * FROM kho_items WHERE id = ?', String(d.kitem)))[0];
      if (it) { const r = await all(x.db, 'INSERT INTO kho_po (item, qty, eta, note, by_name, at) VALUES (?, ?, ?, ?, ?, ?) RETURNING id', it.id, qty, eta ? new Date(eta + 'T09:00:00+07:00').getTime() : now + 7 * DAY, (kind === 'gift' ? '🎁 Hàng hỗ trợ ' : '🛒 Đơn ') + s.name + (note ? ' · ' + note : ''), u.name, now); kpo = r[0] && r[0].id; kitem = it.id; }
    }
    await run(x.db, 'INSERT INTO ncc_po (ncc, kind, day, doc, items, amt, eta, kitem, qty, kpo, note, by_name, at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)', s.id, kind, day, String(d.doc || '').slice(0, 40), items, amt, eta, kitem, qty, kpo, note, u.name, now);
    if (d.docId) { const id = (await all(x.db, 'SELECT id FROM ncc_po ORDER BY id DESC LIMIT 1'))[0].id; await run(x.db, "UPDATE ncc_doc SET ref = 'po:' || ? WHERE id = ?", id, String(d.docId)); }
    await log(x, u, 'Kế toán', '-', '', (kind === 'gift' ? 'Ghi hàng hỗ trợ ' : 'Ghi đơn đặt ') + s.name + ': ' + items + ' · ' + amt.toLocaleString('vi-VN') + 'đ' + (kpo ? ' (kho thấy đang đặt)' : ''), note);
    return done();
  }
  if (op === 'ai') return nccAiRead(x, d);
  if (op === 'drive') { const r = await nccDriveRun(x, 25); await log(x, u, 'Kế toán', '-', '', '☁️ Chép chứng từ nhà cung cấp lên Drive: ' + r.n + ' file' + (r.err ? ' · lỗi: ' + r.err : ''), ''); return Object.assign(await done(), { copied: r.n, left: r.left, derr: r.err }); }
  if (op === 'unlink') { await run(x.db, 'UPDATE ncc_pay SET ncc = 0, by_name = ?, at = ? WHERE id = ?', u.name, now, String(d.id || '')); return done(); }
  if (op === 'import') {
    const rows = (Array.isArray(d.rows) ? d.rows : []).slice(0, 300).filter(r => r && String(r[0] || '').trim() && amtOf(r[4]) > 0); if (!rows.length) return { ok: false, error: 'Trang Công nợ không có khoản nào còn nợ.' };
    const S = await all(x.db, 'SELECT id, name FROM ncc'), id = {}; S.forEach(s => { id[nrm(s.name)] = s.id; });
    for (const r of rows) { const n = String(r[0]).trim().slice(0, 100); if (!id[nrm(n)]) { await run(x.db, 'INSERT INTO ncc (name, terms, by_name, at) VALUES (?, 30, ?, ?)', n, u.name, now); id[nrm(n)] = (await all(x.db, 'SELECT id FROM ncc WHERE name = ? ORDER BY id DESC LIMIT 1', n))[0].id; } }
    const today = fmtDate(now, 'yyyy-MM-dd');
    await x.db.batch(rows.map(r => { const day = ISO.test(r[2] || '') ? r[2] : today; return x.db.prepare('INSERT INTO ncc_bill (ncc, doc, day, due, amt, note, by_name, at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)').bind(id[nrm(String(r[0]).trim().slice(0, 100))], String(r[1] || '').slice(0, 40), day, ISO.test(r[3] || '') ? r[3] : '', amtOf(r[4]), amtOf(r[5]) > amtOf(r[4]) ? 'Chép từ trang Công nợ (hoá đơn ' + amtOf(r[5]).toLocaleString('vi-VN') + 'đ, đã trả trước ' + (amtOf(r[5]) - amtOf(r[4])).toLocaleString('vi-VN') + 'đ)' : 'Chép từ trang Công nợ', u.name, now); }));
    await log(x, u, 'Kế toán', '-', '', 'Chép ' + rows.length + ' khoản công nợ từ file kế toán vào sổ CRM', '');
    return done();
  }
  return { ok: false, error: 'Không rõ thao tác: ' + op };
}

/** ✨ AI đọc 1 chứng từ nhà cung cấp (ảnh / PDF) → loại + số liệu để CRM điền sẵn. Không ghi gì vào sổ. */
const AI_SYS = `Bạn là kế toán đọc chứng từ nhà cung cấp gửi cho CÔNG TY TNHH TẬP ĐOÀN VITAGREEN NUTRITION (bên mua, còn gọi Thực Dưỡng Lành, mã KH có thể là AHIEU / Anh Hiếu).
Đọc ảnh / PDF và trả về DUY NHẤT 1 khối JSON:
{"type": "cong_no" | "hoa_don" | "phieu_xuat" | "don_dat" | "ho_tro" | "chuyen_khoan" | "khac",
 "ncc": "tên nhà cung cấp (bên bán) nếu thấy, không đoán",
 "day": "YYYY-MM-DD ngày chứng từ / ngày in / ngày giao dịch",
 "upto": "YYYY-MM-DD ngày của dòng cuối cùng trong bảng công nợ (chỉ với cong_no)",
 "balance": số dư cuối cùng bên mua còn nợ (cong_no, số nguyên đồng, dòng cuối cột Số dư),
 "amount": tổng tiền phải trả GỒM VAT (hoa_don, phieu_xuat, don_dat), giá trị hỗ trợ (ho_tro), số tiền chuyển (chuyen_khoan),
 "doc": "số hoá đơn / số phiếu / mã đơn / số tham chiếu nếu có",
 "items": "tóm tắt hàng: tên – số lượng × đơn giá, ngắn gọn",
 "qty": tổng số lượng (số), "vat": tiền VAT nếu có,
 "rows": [["YYYY-MM-DD", "Bán hàng"|"Thu tiền"|..., số tiền (thu tiền ghi số dương)]] (chỉ với cong_no, mọi dòng trong bảng),
 "note": "1–2 câu điều kế toán cần để ý (vd: chưa có khoản chuyển ngày X, hỗ trợ trả bằng hàng, chọn loại 400g hay 900g)"}
Số tiền là số nguyên đồng, bỏ dấu chấm / phẩy ngăn nghìn; số trong ngoặc ( ) là số âm. Không thấy thì để null. Không thêm chữ ngoài JSON.`;
let aiClient = null;
async function nccAiRead(x, d) {
  if (!x.env.ANTHROPIC_API_KEY) return { ok: false, error: 'Máy chủ chưa có khoá AI.' };
  const b64 = String(d.b64 || '').replace(/^data:[^,]*,/, ''), mime = String(d.mime || '');
  if (!b64 || b64.length > DOC_MAX) return { ok: false, error: 'Chưa có file hoặc file lớn quá 1,4 MB.' };
  const src = mime === 'application/pdf' ? { type: 'document', source: { type: 'base64', media_type: mime, data: b64 } } : /^image\/(jpeg|png|webp)$/.test(mime) ? { type: 'image', source: { type: 'base64', media_type: mime, data: b64 } } : null;
  if (!src) return { ok: false, error: 'Chỉ đọc được ảnh hoặc PDF.' };
  if (!aiClient) aiClient = new Anthropic({ apiKey: x.env.ANTHROPIC_API_KEY, maxRetries: 1, timeout: 60e3, fetch: aiFetch(x.env), defaultHeaders: { 'x-tdl-muc': 'ketoan' } });
  let res; try { res = await aiClient.messages.create({ model: 'claude-sonnet-5-5', max_tokens: 1500, system: AI_SYS, messages: [{ role: 'user', content: [src, { type: 'text', text: 'Đọc chứng từ này, trả JSON.' }] }] }); }
  catch (e) { return { ok: false, error: 'AI chưa đọc được (' + String(e.message).slice(0, 100) + '). Thử lại sau ít phút, hoặc gõ tay.' }; }
  const t = (res.content || []).filter(b => b.type === 'text').map(b => b.text).join(''), m = t.match(/\{[\s\S]*\}/);
  let j = null; try { j = m ? JSON.parse(m[0]) : null; } catch (e) { }
  if (!j || !j.type) return { ok: false, error: 'AI đọc không ra, gõ tay giúp.' };
  const n = v => v == null || v === '' ? null : Math.round(Number(String(v).replace(/[^\d.-]/g, ''))) || null, dd = v => ISO.test(String(v || '')) ? String(v) : '';
  return { ok: true, read: { type: String(j.type), ncc: String(j.ncc || '').slice(0, 100), day: dd(j.day), upto: dd(j.upto), balance: n(j.balance), amount: n(j.amount), doc: String(j.doc || '').slice(0, 40), items: String(j.items || '').slice(0, 300), qty: Number(j.qty) || 0, vat: n(j.vat), note: String(j.note || '').slice(0, 300), rows: (Array.isArray(j.rows) ? j.rows : []).slice(0, 60).map(r => [dd(r[0]), String(r[1] || '').slice(0, 40), n(r[2])]) } };
}

/* ☁️ Chép chứng từ lên Google Drive (17/11/2026, anh Sơn: "thêm bước chép sang Drive hằng tuần"): thứ Hai từ 9h cron chép các file chưa chép (≤ 10 file / lượt 10 phút),
 * hoặc kế toán bấm ☁️ Chép ngay. Dùng mã truy cập Google của Apps Script (tài khoản chạy cầu nối, có quyền Drive) gọi Drive API.
 * Thư mục: 03_CÔNG VIỆC/02_VITAGREEN/05_Tài chính & Kế toán (id DRIVE_ROOT, kv ncc_drive.root để đổi) / Chứng từ nhà cung cấp / <Tên NCC> / <Năm-Tháng> / "Năm-Tháng-Ngày_Loại - NCC (tên file)". */
const DRIVE_ROOT = '1vP89Dq1CM0_PfnGqE5apmaYLPrDwRiob', DRIVE_DIR = 'Chứng từ nhà cung cấp', FOLDER = 'application/vnd.google-apps.folder';
async function gdrive(x, url, opt) {
  const info = await gInfo(x.env), r = await fetch(url, Object.assign({}, opt, { headers: Object.assign({ Authorization: 'Bearer ' + info.token }, (opt || {}).headers || {}) }));
  const t = await r.text(); let j = {}; try { j = JSON.parse(t); } catch (e) { }
  if (!r.ok) {
    const m = (j.error && j.error.message) || t.slice(0, 160);
    if (/has not been used|is disabled|SERVICE_DISABLED/i.test(m)) throw new Error('Chưa bật Drive API trong Apps Script (mục Dịch vụ + → Drive API → Thêm, rồi Lưu).');
    if (/insufficient|scope/i.test(m)) throw new Error('Apps Script chưa có quyền Drive: mở Apps Script, chạy hàm capQuyenGopY 1 lần, bấm Cho phép.');
    throw new Error('Google Drive báo lỗi: ' + m);
  }
  return j;
}
async function driveDir(x, cache, name, parent) {
  const k = parent + '/' + name; if (cache[k]) return cache[k];
  const q = "name = '" + name.replace(/\\/g, '\\\\').replace(/'/g, "\\'") + "' and '" + parent + "' in parents and mimeType = '" + FOLDER + "' and trashed = false";
  const f = await gdrive(x, 'https://www.googleapis.com/drive/v3/files?fields=files(id)&q=' + encodeURIComponent(q));
  const id = f.files && f.files[0] ? f.files[0].id : (await gdrive(x, 'https://www.googleapis.com/drive/v3/files?fields=id', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name, mimeType: FOLDER, parents: [parent] }) })).id;
  cache[k] = id; return id;
}
const safeName = t => String(t || '').replace(/[\\/:*?"<>|]+/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 120);
/** Chép tối đa `max` chứng từ chưa chép. Trả {n, left, err}. */
export async function nccDriveRun(x, max) {
  await nccSchema(x.db);
  const st = await kvJson(x.db, 'ncc_drive', null) || {}, root = st.root || DRIVE_ROOT, cache = st.dirs || {};
  const L = await all(x.db, "SELECT d.id, d.ncc, d.kind, d.day, d.name, d.mime, d.b64, n.name AS nname FROM ncc_doc d LEFT JOIN ncc n ON n.id = d.ncc WHERE COALESCE(d.drive, '') = '' ORDER BY d.at LIMIT ?", max || 10);
  let n = 0, err = '';
  try {
    for (const f of L) {
      const top = await driveDir(x, cache, DRIVE_DIR, root), sup = await driveDir(x, cache, safeName(f.nname || 'Khác'), top), mon = await driveDir(x, cache, String(f.day || '').slice(0, 7) || 'Khác', sup);
      const ext = /pdf/.test(f.mime) ? '.pdf' : /png/.test(f.mime) ? '.png' : '.jpg', base = safeName(f.name).replace(/\.(pdf|png|jpe?g|webp)$/i, '');
      const name = (f.day || '') + '_' + safeName(f.kind) + ' - ' + safeName(f.nname) + (base && base !== f.kind ? ' (' + base + ')' : '') + ext;
      const bin = Uint8Array.from(atob(f.b64), c => c.charCodeAt(0)), B = 'tdl' + randHex(8), enc = new TextEncoder();
      const head = enc.encode('--' + B + '\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n' + JSON.stringify({ name, parents: [mon] }) + '\r\n--' + B + '\r\nContent-Type: ' + f.mime + '\r\n\r\n'), tail = enc.encode('\r\n--' + B + '--');
      const body = new Uint8Array(head.length + bin.length + tail.length); body.set(head, 0); body.set(bin, head.length); body.set(tail, head.length + bin.length);
      const up = await gdrive(x, 'https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart&fields=id', { method: 'POST', headers: { 'Content-Type': 'multipart/related; boundary=' + B }, body });
      await run(x.db, 'UPDATE ncc_doc SET drive = ? WHERE id = ?', up.id, f.id); n++;
    }
  } catch (e) { err = String(e.message || e).slice(0, 200); }
  const left = (await all(x.db, "SELECT COUNT(*) AS c FROM ncc_doc WHERE COALESCE(drive, '') = ''"))[0].c;
  const top = cache[root + '/' + DRIVE_DIR] || '';
  await kvSet(x.db, 'ncc_drive', JSON.stringify(Object.assign(st, { dirs: cache, at: n || err ? Date.now() : st.at || 0, n: (n ? n : st.n || 0), err, left, url: top ? 'https://drive.google.com/drive/folders/' + top : st.url || '' })));
  return { n, left, err };
}
/** cron: thứ Hai từ 9h, mỗi lượt 10 phút chép tối đa 10 file tới khi hết. */
export async function nccDriveTick(x) {
  let c = 0; try { c = (await all(x.db, "SELECT COUNT(*) AS c FROM ncc_doc WHERE COALESCE(drive, '') = ''"))[0].c; } catch (e) { return; }
  if (c) await nccDriveRun(x, 10);
}
