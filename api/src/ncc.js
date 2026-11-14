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
import { fmtDate, all, run, nrm, randHex, DAY } from './lib.js';

let ok = false;
async function nccSchema(db) {
  if (ok) return;
  await run(db, "CREATE TABLE IF NOT EXISTS ncc (id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT, phone TEXT DEFAULT '', terms INTEGER DEFAULT 30, keys TEXT DEFAULT '', note TEXT DEFAULT '', off INTEGER DEFAULT 0, by_name TEXT DEFAULT '', at INTEGER)");
  await run(db, "CREATE TABLE IF NOT EXISTS ncc_bill (id INTEGER PRIMARY KEY AUTOINCREMENT, ncc INTEGER, doc TEXT DEFAULT '', day TEXT, due TEXT DEFAULT '', amt INTEGER DEFAULT 0, note TEXT DEFAULT '', by_name TEXT DEFAULT '', at INTEGER)");
  await run(db, "CREATE TABLE IF NOT EXISTS ncc_pay (id TEXT PRIMARY KEY, ncc INTEGER, day TEXT, amt INTEGER DEFAULT 0, src TEXT DEFAULT '', note TEXT DEFAULT '', by_name TEXT DEFAULT '', at INTEGER)");
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
async function load(x) {
  await nccSchema(x.db);
  const S = await all(x.db, 'SELECT * FROM ncc ORDER BY name'), B = await all(x.db, 'SELECT * FROM ncc_bill ORDER BY day DESC, id DESC LIMIT 5000');
  const unk = await nccAuto(x, S, B), P = await all(x.db, 'SELECT * FROM ncc_pay ORDER BY day DESC LIMIT 5000');
  const C = await all(x.db, 'SELECT * FROM ncc_chk ORDER BY at DESC LIMIT 500');
  return { S, B, P, unk, C };
}
/** Gộp vào số tài chính (finFull): F.pay = [tên, số HĐ, ngày HĐ, hạn, còn nợ, giá trị] như trang Công nợ của file kế toán. */
export async function nccMerge(x, F) {
  let D; try { D = await load(x); } catch (e) { return F; }
  if (!D.B.length) return F;
  const L = nccOpen(D.B, D.P).left, nm = {}; D.S.forEach(s => { nm[s.id] = s.name; });
  const G = Object.assign({}, F || { at: 0, file: '', chi: null, bank: null, pay: null });
  G.pay = D.B.filter(b => L[b.id] > 0).map(b => [String(nm[b.ncc] || '?').slice(0, 80), String(b.doc || '').slice(0, 30), b.day || '', b.due || '', L[b.id], b.amt]);
  const K = nccChkState(D.S, D.B, D.P, D.C, Date.now()); G.payChk = { due: K.due, miss: K.miss.slice(0, 20), diff: K.diff.slice(0, 20), done: K.done };
  G.paySrc = 'crm'; G.payUnk = D.unk.length; G.payUnkV = D.unk.reduce((s, r) => s + r.amt, 0);
  return G;
}
const out = D => ({
  ok: true,
  ncc: D.S.map(s => ({ id: s.id, name: s.name, phone: s.phone, terms: s.terms, keys: s.keys, note: s.note, off: s.off })),
  bills: D.B.map(b => ({ id: b.id, ncc: b.ncc, doc: b.doc, day: b.day, due: b.due, amt: b.amt, note: b.note, by: b.by_name, at: b.at })),
  pays: D.P.map(p => ({ id: p.id, ncc: p.ncc, day: p.day, amt: p.amt, src: p.src, note: p.note, by: p.by_name })),
  unk: D.unk,
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
