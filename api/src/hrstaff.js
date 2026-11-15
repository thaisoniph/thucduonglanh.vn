/* ================================================================ 🗂 Hồ sơ nhân sự – hr.thucduonglanh.vn đợt 2 (15/11/2026, anh Sơn "Làm đợt 2")
 * Thông tin chính vẫn ở bảng users (full, phone, joined, dob, acct – dùng chung với lời chúc sinh nhật, bảng lương, thâm niên).
 * Thêm: hr_staff (vị trí, bộ phận, quản lý trực tiếp, CCCD, nơi ở, liên hệ khẩn cấp, học vấn, ghi chú), hr_doc (giấy tờ ≤ 1,4 MB),
 * hr_fb (Phiếu góp ý ẩn danh "Món quà âm thầm": điểm mạnh / cần cải thiện, KHÔNG lưu người viết), kv hr_fb_map (tên trong phiếu → email), kv hr_fb_src (link Sheet, tự đọc lại mỗi ngày).
 * Quyền: Quản lý xem + sửa thông tin công việc, xem điểm mạnh. Quản trị thêm: điểm cần cải thiện, CCCD / nơi ở / số tài khoản / giấy tờ, tạo tài khoản từ ứng viên. */
import { all, first, run, kvJson, kvSet, normPhone, fmtDate, md5hex, DAY } from './lib.js';
import { sheetValues, serialToMs } from './google.js';
import { crmUsers, nameKey } from './crm.js';
import { dobNorm } from './loichuc.js';

const DOC_MAX = 1.9e6;
const ROLE_LIST = ['Sale & CSKH', 'Quản lý', 'Marketing', 'Kho', 'Kế toán', 'Quản trị'];
const cut = (v, n) => String(v == null ? '' : v).trim().slice(0, n);
const parse = v => { try { return v ? JSON.parse(v) : null; } catch (e) { return null; } };
const EXTRA = ['pos', 'dept', 'boss', 'addr', 'idno', 'idd', 'idp', 'emer', 'edu', 'note'];
const PRIV = ['addr', 'idno', 'idd', 'idp', 'emer']; // chỉ Quản trị

let ok = false;
export async function staffSchema(db) {
  if (ok) return;
  await run(db, `CREATE TABLE IF NOT EXISTS hr_staff (email TEXT PRIMARY KEY, pos TEXT DEFAULT '', dept TEXT DEFAULT '', boss TEXT DEFAULT '', addr TEXT DEFAULT '', idno TEXT DEFAULT '',
    idd TEXT DEFAULT '', idp TEXT DEFAULT '', emer TEXT DEFAULT '', edu TEXT DEFAULT '', note TEXT DEFAULT '', app_id INTEGER, upd INTEGER, upd_by TEXT DEFAULT '')`);
  await run(db, 'CREATE TABLE IF NOT EXISTS hr_doc (id INTEGER PRIMARY KEY AUTOINCREMENT, email TEXT, kind TEXT, name TEXT, b64 TEXT, size INTEGER, time INTEGER, by_name TEXT)');
  await run(db, 'CREATE TABLE IF NOT EXISTS hr_fb (id TEXT PRIMARY KEY, at INTEGER, who TEXT, good TEXT, imp TEXT)');
  ok = true;
}

/* ---------------------------------------------------------------- Phiếu góp ý "Món quà âm thầm" */
const JUNK = /^(\W|chưa|chua|không|khong|ko|k|em chưa|chưa có|chưa thấy|chưa tìm|không có|chưa nghĩ|chưa biết)\b.{0,25}$/i;
const clean = s => { s = cut(s, 800).replace(/\s+/g, ' '); return s.length < 3 || JUNK.test(s) ? '' : s; };
function tsOf(v) {
  if (typeof v === 'number' || /^\d+(\.\d+)?$/.test(String(v || ''))) return Math.round(serialToMs(v) / 1000) * 1000; // số ngày kiểu Excel (file .xlsx)
  const m = String(v || '').match(/(\d{1,2})\/(\d{1,2})\/(\d{4})(?:\s+(\d{1,2}):(\d{2})(?::(\d{2}))?)?/);
  return m ? Date.UTC(+m[3], +m[2] - 1, +m[1], +(m[4] || 9), +(m[5] || 0), +(m[6] || 0)) - 7 * 3600e3 : 0;
}
/** rows = mảng các hàng (hàng đầu là tiêu đề). Trả về số câu trả lời mới. */
async function fbImport(db, rows) {
  const H = (rows[0] || []).map(h => String(h || '').toLowerCase());
  const ci = H.findIndex(h => /đồng đội|người được|được góp ý|yêu thương/.test(h)), gi = [], ii = [];
  H.forEach((h, i) => { if (/điểm mạnh|trân trọng/.test(h)) gi.push(i); else if (/cải thiện|tốt hơn/.test(h)) ii.push(i); });
  if (ci < 0 || !gi.length) return { ok: false, error: 'Không thấy cột "Đồng đội được yêu thương" và cột "Điểm mạnh" trong file. Bạn tải đúng file câu trả lời của phiếu chưa?' };
  let n = 0, tot = 0;
  for (const r of rows.slice(1)) {
    const who = cut(r[ci], 80); if (!who) continue;
    const good = gi.map(i => clean(r[i])).filter(Boolean), imp = ii.map(i => clean(r[i])).filter(Boolean); if (!good.length && !imp.length) continue;
    const at = tsOf(r[0]) || 0, id = md5hex((at || String(r[0])) + '|' + nameKey(who)).slice(0, 16); // 1 lần gửi phiếu = giờ gửi + người được góp ý (đọc từ link hay file đều ra cùng mã, không nhập trùng) tot++;
    const res = await run(db, 'INSERT OR IGNORE INTO hr_fb (id, at, who, good, imp) VALUES (?, ?, ?, ?, ?)', id, at, who, JSON.stringify(good), JSON.stringify(imp));
    n += res.meta.changes || 0;
  }
  return { ok: true, n, tot };
}
const sheetId = s => (String(s || '').match(/\/d\/([a-zA-Z0-9_-]{20,})/) || String(s || '').match(/^([a-zA-Z0-9_-]{30,})$/) || [])[1] || '';
export async function fbSync(x) {
  const S = await kvJson(x.db, 'hr_fb_src', null); if (!S || !S.id) return { ok: false, error: 'Chưa lưu link Sheet.' };
  let r;
  try { r = await fbImport(x.db, await sheetValues(x.env, S.id, 'A1:Z3000', 'FORMATTED_VALUE')); }
  catch (e) { r = { ok: false, error: 'Không đọc được Sheet (' + String(e.message).slice(0, 140) + '). Mở Sheet → Chia sẻ, thêm email tài khoản chạy Apps Script của CRM, hoặc tải file .xlsx lên thay cho link.' }; }
  await kvSet(x.db, 'hr_fb_src', JSON.stringify(Object.assign(S, { at: Date.now(), n: r.ok ? r.n : 0, err: r.ok ? '' : r.error })));
  return r;
}

/* ---------------------------------------------------------------- dữ liệu cho CRM */
function fbOwner(users, map) {
  const byFull = {}, byName = {};
  users.forEach(u => { if (u.full) byFull[nameKey(u.full)] = u.email; byName[nameKey(u.name)] = byName[nameKey(u.name)] ? '?' : u.email; });
  return who => {
    const k = nameKey(who); if (map[k]) return map[k]; if (byFull[k]) return byFull[k];
    const hit = users.filter(u => { const n = nameKey(u.name); return n.split(' ').length >= 2 && (k === n || k.endsWith(' ' + n)); });
    return hit.length === 1 ? hit[0].email : '';
  };
}
async function listOut(x, u) {
  const qt = u.level >= 3, users = (await crmUsers(x)).filter(z => qt || z.active);
  const ext = {}; for (const r of await all(x.db, 'SELECT * FROM hr_staff')) ext[r.email] = r;
  const docs = {}; if (qt) for (const r of await all(x.db, 'SELECT id, email, kind, name, size, time, by_name FROM hr_doc ORDER BY time DESC')) (docs[r.email] = docs[r.email] || []).push({ id: r.id, kind: r.kind, name: r.name, size: r.size, time: r.time, by: r.by_name });
  const map = await kvJson(x.db, 'hr_fb_map', {}) || {}, own = fbOwner(users, map), fb = {}, miss = {};
  for (const r of await all(x.db, 'SELECT at, who, good, imp FROM hr_fb ORDER BY at')) {
    const e = own(r.who); if (!e) { miss[r.who] = (miss[r.who] || 0) + 1; continue; }
    const f = fb[e] || (fb[e] = { good: [], imp: [], n: 0 }); f.n++;
    (parse(r.good) || []).forEach(s => f.good.push([r.at, s])); if (qt) (parse(r.imp) || []).forEach(s => f.imp.push([r.at, s]));
  }
  const apps = {}; for (const r of await all(x.db, "SELECT id, name, job, time FROM applicants WHERE status = 'Đã nhận việc'").catch(() => [])) apps[r.id] = r;
  const staff = users.filter(z => z.email).map(z => {
    const e = ext[z.email] || {}, o = { email: z.email, name: z.name, role: z.role, active: z.active, full: z.full || '', phone: z.phone || '', joined: z.joined || '', dob: z.dob || '', ctv: !!z.ctv,
      pos: e.pos || '', dept: e.dept || '', boss: e.boss || '', edu: e.edu || '', note: e.note || '', upd: e.upd || 0, updBy: e.upd_by || '', app: e.app_id && apps[e.app_id] ? { id: e.app_id, job: apps[e.app_id].job } : null, fb: fb[z.email] || { good: [], imp: [], n: 0 } };
    if (qt) { PRIV.forEach(k => { o[k] = e[k] || ''; }); o.acct = z.acct || ''; o.docs = docs[z.email] || []; }
    return o;
  });
  const src = qt ? await kvJson(x.db, 'hr_fb_src', null) : null;
  return { ok: true, staff, qt, roles: ROLE_LIST, fbMiss: qt ? Object.keys(miss).map(k => ({ who: k, n: miss[k] })) : [], fbSrc: src ? { has: !!src.id, at: src.at || 0, n: src.n || 0, err: src.err || '' } : null, fbTot: (await first(x.db, 'SELECT COUNT(*) n FROM hr_fb')).n };
}

/** hr {op: st_*}: gọi từ crmHr (hr.js), quyền Quản lý + Quản trị đã kiểm. */
export async function crmHrStaff(x, u, d, log) {
  await staffSchema(x.db);
  const op = String(d.op), qt = u.level >= 3, email = cut(d.email, 120).toLowerCase(), now = Date.now();
  if (op === 'st_list') return listOut(x, u);
  const needQt = () => qt ? null : { ok: false, error: 'Chỉ Quản trị làm được việc này.' };
  if (op === 'st_save') {
    const z = (await crmUsers(x)).find(y => y.email === email); if (!z) return { ok: false, error: 'Không thấy nhân sự.' };
    const dob = cut(d.dob, 20) ? dobNorm(d.dob) : ''; if (cut(d.dob, 20) && !dob) return { ok: false, error: 'Ngày sinh chưa đúng (ví dụ 05/09/1995).' };
    const sets = [['full', cut(d.full, 80)], ['phone', normPhone(d.phone || '')], ['joined', cut(d.joined, 30)], ['dob', dob]];
    if (qt && d.acct != null) sets.push(['acct', String(d.acct || '').replace(/\D/g, '').slice(0, 24)]);
    for (const [k, v] of sets) await run(x.db, `UPDATE users SET ${k} = ? WHERE email = ?`, v, email);
    x._users = null;
    const cur = await first(x.db, 'SELECT * FROM hr_staff WHERE email = ?', email) || {}, val = {};
    EXTRA.forEach(k => { val[k] = PRIV.indexOf(k) >= 0 && !qt ? cur[k] || '' : cut(d[k], k === 'note' ? 3000 : 300); });
    await run(x.db, `INSERT INTO hr_staff (email, ${EXTRA.join(', ')}, upd, upd_by) VALUES (?, ${EXTRA.map(() => '?').join(', ')}, ?, ?)
      ON CONFLICT(email) DO UPDATE SET ${EXTRA.map(k => k + ' = excluded.' + k).join(', ')}, upd = excluded.upd, upd_by = excluded.upd_by`, email, ...EXTRA.map(k => val[k]), now, u.name);
    await log(x, u, 'Nhân sự', '-', z.name, 'Sửa hồ sơ nhân sự', '');
    return listOut(x, u);
  }
  if (op === 'st_doc_add') {
    const e = needQt(); if (e) return e;
    const b64 = String(d.data || '').replace(/^data:[^,]*,/, ''), name = cut(d.name, 120).replace(/[\\/:*?"<>|]/g, '_');
    if (!b64 || !name) return { ok: false, error: 'Chọn file.' }; if (b64.length > DOC_MAX) return { ok: false, error: 'File lớn hơn 1,4 MB. Chụp lại nhỏ hơn hoặc nén PDF trước khi tải.' };
    await run(x.db, 'INSERT INTO hr_doc (email, kind, name, b64, size, time, by_name) VALUES (?, ?, ?, ?, ?, ?, ?)', email, cut(d.kind, 60) || 'Giấy tờ khác', name, b64, Math.round(b64.length * 0.75), now, u.name);
    await log(x, u, 'Nhân sự', '-', email, 'Tải giấy tờ: ' + (cut(d.kind, 60) || name), '');
    return listOut(x, u);
  }
  if (op === 'st_doc_get' || op === 'st_doc_del') {
    const e = needQt(); if (e) return e;
    const r = await first(x.db, 'SELECT * FROM hr_doc WHERE id = ?', Number(d.id) || 0); if (!r) return { ok: false, error: 'Không thấy file.' };
    if (op === 'st_doc_get') { await log(x, u, 'Nhân sự', '-', r.email, 'Xem giấy tờ: ' + r.kind, ''); return { ok: true, name: r.name, b64: r.b64 }; }
    await run(x.db, 'DELETE FROM hr_doc WHERE id = ?', r.id); await log(x, u, 'Nhân sự', '-', r.email, 'Xoá giấy tờ: ' + r.kind, '');
    return listOut(x, u);
  }
  if (op === 'st_fb_link') { const e = needQt(); if (e) return e; const id = sheetId(d.url); if (!id) return { ok: false, error: 'Dán link Google Sheet câu trả lời của phiếu.' }; await kvSet(x.db, 'hr_fb_src', JSON.stringify({ id })); const r = await fbSync(x); return Object.assign(await listOut(x, u), { imp: r }); }
  if (op === 'st_fb_sync') { const e = needQt(); if (e) return e; const r = await fbSync(x); return Object.assign(await listOut(x, u), { imp: r }); }
  if (op === 'st_fb_rows') { const e = needQt(); if (e) return e; const r = await fbImport(x.db, Array.isArray(d.rows) ? d.rows.slice(0, 5000) : []); if (r.ok) await log(x, u, 'Nhân sự', '-', '', 'Nhập phiếu góp ý: ' + r.n + ' câu mới', ''); return Object.assign(await listOut(x, u), { imp: r }); }
  if (op === 'st_fb_map') {
    const e = needQt(); if (e) return e;
    const m = await kvJson(x.db, 'hr_fb_map', {}) || {}, k = nameKey(d.who); if (!k) return { ok: false, error: 'Thiếu tên.' };
    if (email) m[k] = email; else delete m[k]; await kvSet(x.db, 'hr_fb_map', JSON.stringify(m));
    return listOut(x, u);
  }
  if (op === 'st_hire') { // ứng viên đã nhận việc → tài khoản CRM + hồ sơ nhân sự + CV sang mục giấy tờ
    const e = needQt(); if (e) return e;
    const a = await first(x.db, 'SELECT * FROM applicants WHERE id = ?', Number(d.id) || 0); if (!a) return { ok: false, error: 'Không thấy hồ sơ ứng viên.' };
    const role = ROLE_LIST.indexOf(d.role) >= 0 ? d.role : 'Sale & CSKH', name = cut(d.name, 40) || a.name.split(/\s+/).slice(-2).join(' ');
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) return { ok: false, error: 'Email đăng nhập chưa đúng.' };
    const users = await crmUsers(x); if (users.some(z => z.email === email)) return { ok: false, error: 'Email này đã có tài khoản. Sửa ở Cài đặt → Nhân sự.' };
    if (users.some(z => z.active && nameKey(z.name) === nameKey(name))) return { ok: false, error: 'Đã có nhân sự tên “' + name + '”. Chọn tên gọi khác (thêm chữ đệm).' };
    const o = parse(a.offer) || {}, st = String(o.start || '').match(/^(\d{4})-(\d{2})-(\d{2})$/), joined = st ? st[3] + '/' + st[2] + '/' + st[1] : fmtDate(now, 'dd/MM/yyyy');
    const ord = ((await first(x.db, 'SELECT MAX(ord) m FROM users')) || {}).m || 0;
    await run(x.db, `INSERT INTO users (email, name, role, active, recv, tg, alias, prefix, web, mkv, ord) VALUES (?, ?, ?, 1, ?, '', '', '', '', '', ?)`, email, name, role, role === 'Sale & CSKH' ? 'Có' : 'Không', ord + 1);
    for (const [k, v] of [['full', a.name], ['phone', normPhone(a.phone)], ['joined', joined], ['dob', dobNorm(a.birth)]]) await run(x.db, `UPDATE users SET ${k} = ? WHERE email = ?`, v || '', email);
    x._users = null;
    await run(x.db, `INSERT INTO hr_staff (email, pos, boss, addr, app_id, upd, upd_by) VALUES (?, ?, ?, ?, ?, ?, ?) ON CONFLICT(email) DO UPDATE SET pos = excluded.pos, boss = excluded.boss, app_id = excluded.app_id`, email, cut(o.pos || a.job, 120), cut(o.boss, 120), cut(a.area, 300), a.id, now, u.name);
    const cv = await first(x.db, 'SELECT name, b64 FROM hr_cv WHERE id = ?', a.id).catch(() => null);
    if (cv) await run(x.db, 'INSERT INTO hr_doc (email, kind, name, b64, size, time, by_name) VALUES (?, ?, ?, ?, ?, ?, ?)', email, 'Hồ sơ xin việc (CV)', cv.name, cv.b64, Math.round(cv.b64.length * 0.75), now, u.name);
    const ofr = parse(a.ofr) || {}, b64u = t => { const b = new TextEncoder().encode(t); let r = ''; for (const c of b) r += String.fromCharCode(c); return btoa(r); };
    if (ofr.ok === 1) await run(x.db, 'INSERT INTO hr_doc (email, kind, name, b64, size, time, by_name) VALUES (?, ?, ?, ?, ?, ?, ?)', email, 'Thư mời nhận việc (đã ký)', 'thu-moi-nhan-viec.txt',
      b64u(['THƯ MỜI NHẬN VIỆC – Thực Dưỡng Lành', 'Ứng viên: ' + a.name, 'Vị trí: ' + (o.pos || ''), 'Ngày bắt đầu: ' + joined, 'Lương chính thức: ' + (o.pay || ''), 'Thử việc: ' + [o.trial, o.trialPay].filter(Boolean).join(' · '), 'Phụ cấp, thưởng: ' + (o.extra || ''), 'Ứng viên ký xác nhận: ' + (ofr.sign || '') + ' lúc ' + fmtDate(ofr.at || now, 'HH:mm dd/MM/yyyy') + (ofr.ip ? ' (IP ' + ofr.ip + ')' : '')].join('\n')), 0, now, u.name);
    await log(x, u, 'Nhân sự', '-', name, 'Tạo tài khoản + hồ sơ từ ứng viên ' + a.name + ' (' + role + ')', '');
    return Object.assign(await listOut(x, u), { made: email });
  }
  return { ok: false, error: 'Không rõ thao tác.' };
}
