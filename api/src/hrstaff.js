/* ================================================================ 🗂 Hồ sơ nhân sự – hr.thucduonglanh.vn đợt 2 (15/11/2026, anh Sơn "Làm đợt 2")
 * Thông tin chính vẫn ở bảng users (full, phone, joined, dob, acct – dùng chung với lời chúc sinh nhật, bảng lương, thâm niên).
 * Thêm: hr_staff (vị trí, bộ phận, quản lý trực tiếp, CCCD, nơi ở, liên hệ khẩn cấp, học vấn, ghi chú), hr_doc (giấy tờ ≤ 1,4 MB),
 * hr_fb (Phiếu góp ý ẩn danh "Món quà âm thầm": điểm mạnh / cần cải thiện, KHÔNG lưu người viết), kv hr_fb_map (tên trong phiếu → email), kv hr_fb_src (link Sheet, tự đọc lại mỗi ngày).
 * Quyền: Quản lý xem + sửa thông tin công việc, xem điểm mạnh. Quản trị thêm: điểm cần cải thiện, CCCD / nơi ở / số tài khoản / giấy tờ, tạo tài khoản từ ứng viên. */
import { all, first, run, kvJson, kvSet, normPhone, fmtDate, md5hex, DAY } from './lib.js';
import { sheetValues, serialToMs } from './google.js';
import { crmUsers, nameKey } from './crm.js';
import { dobNorm } from './loichuc.js';
import { ctList, crmHrCt } from './hrhd.js'; // 📄 đợt 3: hợp đồng

const DOC_MAX = 1.9e6;
const ROLE_LIST = ['Sale & CSKH', 'Quản lý', 'Marketing', 'Kho', 'Kế toán', 'Quản trị'];
const cut = (v, n) => String(v == null ? '' : v).trim().slice(0, n);
const parse = v => { try { return v ? JSON.parse(v) : null; } catch (e) { return null; } };
const EXTRA = ['pos', 'dept', 'boss', 'addr', 'idno', 'idd', 'idp', 'emer', 'edu', 'note', 'strong', 'home', 'bank'];
const PRIV = ['addr', 'idno', 'idd', 'idp', 'emer', 'bank']; // chỉ Quản trị

let ok = false;
export async function staffSchema(db) {
  if (ok) return;
  await run(db, `CREATE TABLE IF NOT EXISTS hr_staff (email TEXT PRIMARY KEY, pos TEXT DEFAULT '', dept TEXT DEFAULT '', boss TEXT DEFAULT '', addr TEXT DEFAULT '', idno TEXT DEFAULT '',
    idd TEXT DEFAULT '', idp TEXT DEFAULT '', emer TEXT DEFAULT '', edu TEXT DEFAULT '', note TEXT DEFAULT '', app_id INTEGER, upd INTEGER, upd_by TEXT DEFAULT '')`);
  await run(db, 'CREATE TABLE IF NOT EXISTS hr_doc (id INTEGER PRIMARY KEY AUTOINCREMENT, email TEXT, kind TEXT, name TEXT, b64 TEXT, size INTEGER, time INTEGER, by_name TEXT)');
  await run(db, 'CREATE TABLE IF NOT EXISTS hr_fb (id TEXT PRIMARY KEY, at INTEGER, who TEXT, good TEXT, imp TEXT)');
  const cols = (await all(db, 'PRAGMA table_info(hr_staff)')).map(r => r.name); // 15/11/2026 đợt Notion: điểm mạnh (quản lý ghi), quê quán, ngân hàng, mã trang Notion
  for (const [c, t] of [['strong', "TEXT DEFAULT ''"], ['home', "TEXT DEFAULT ''"], ['bank', "TEXT DEFAULT ''"], ['nt_id', "TEXT DEFAULT ''"], ['nt_dirty', 'INTEGER DEFAULT 0'], ['nt_err', "TEXT DEFAULT ''"]])
    if (!cols.includes(c)) { try { await run(db, `ALTER TABLE hr_staff ADD COLUMN ${c} ${t}`); } catch (e) { } }
  await run(db, `CREATE TABLE IF NOT EXISTS hr_ht (email TEXT PRIMARY KEY, ans TEXT DEFAULT '', at INTEGER, upd INTEGER, pair TEXT DEFAULT '', pair_why TEXT DEFAULT '', pair_st TEXT DEFAULT '',
    nt_id TEXT DEFAULT '', nt_dirty INTEGER DEFAULT 0, nt_err TEXT DEFAULT '')`);
  await run(db, 'CREATE TABLE IF NOT EXISTS hr_pf (email TEXT PRIMARY KEY, data TEXT DEFAULT \'\', at INTEGER)'); // 📝 Thông tin của tôi
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
  const cts = qt ? await ctList(x.db) : {};
  const apps = {}; for (const r of await all(x.db, "SELECT id, name, job, time, offer FROM applicants WHERE status = 'Đã nhận việc'").catch(() => [])) apps[r.id] = r;
  const ht = {}; for (const r of await all(x.db, 'SELECT * FROM hr_ht')) ht[r.email] = r;
  const pfr = {}; for (const r of await all(x.db, 'SELECT * FROM hr_pf')) pfr[r.email] = r;
  const staff = users.filter(z => z.email).map(z => {
    const e = ext[z.email] || {}, o = { email: z.email, name: z.name, role: z.role, active: z.active, full: z.full || '', phone: z.phone || '', joined: z.joined || '', dob: z.dob || '', ctv: !!z.ctv,
      pos: e.pos || '', dept: e.dept || '', boss: e.boss || '', edu: e.edu || '', note: e.note || '', upd: e.upd || 0, updBy: e.upd_by || '', app: e.app_id && apps[e.app_id] ? { id: e.app_id, job: apps[e.app_id].job } : null, fb: fb[z.email] || { good: [], imp: [], n: 0 },
      strong: e.strong || '', home: e.home || '', ht: htOut(ht[z.email], qt), pf: pfOut(pfr[z.email], qt) };
    if (qt) { o.nt = { id: e.nt_id || '', dirty: !!e.nt_dirty, err: e.nt_err || '' }; }
    if (qt) { PRIV.forEach(k => { o[k] = e[k] || ''; }); o.acct = z.acct || ''; o.docs = docs[z.email] || []; o.cts = cts[z.email] || []; const of = e.app_id && apps[e.app_id] ? parse(apps[e.app_id].offer) : null; o.offer = of ? { pay: of.pay || '', trial: of.trial || '', trialPay: of.trialPay || '', extra: of.extra || '', place: of.place || '', hours: of.hours || '', start: of.start || '' } : null; }
    return o;
  });
  const src = qt ? await kvJson(x.db, 'hr_fb_src', null) : null;
  const N = qt ? await ntState(x) : null;
  return { ok: true, staff, qt, roles: ROLE_LIST, htOpt: HT_OPT, forms: await formsOf(x.db), pfOpt: PF_OPT, nt: N, fbMiss: qt ? Object.keys(miss).map(k => ({ who: k, n: miss[k] })) : [], fbSrc: src ? { has: !!src.id, at: src.at || 0, n: src.n || 0, err: src.err || '' } : null, fbTot: (await first(x.db, 'SELECT COUNT(*) n FROM hr_fb')).n };
}

/** hr {op: st_*}: gọi từ crmHr (hr.js), quyền Quản lý + Quản trị đã kiểm. */
export async function crmHrStaff(x, u, d, log) {
  await staffSchema(x.db);
  const op = String(d.op), qt = u.level >= 3, email = cut(d.email, 120).toLowerCase(), now = Date.now();
  if (op === 'st_list') return listOut(x, u);
  const needQt = () => qt ? null : { ok: false, error: 'Chỉ Quản trị làm được việc này.' };
  if (op.startsWith('ct_')) { const e = needQt(); if (e) return e; const r = await crmHrCt(x, u, d, log); return !r.ok || r.html || r.ctCfg ? r : Object.assign(await listOut(x, u), r); }
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
    await ntDirty(x, email);
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
    await ntDirty(x, email);
    await log(x, u, 'Nhân sự', '-', name, 'Tạo tài khoản + hồ sơ từ ứng viên ' + a.name + ' (' + role + ')', '');
    return Object.assign(await listOut(x, u), { made: email });
  }
  if (op === 'st_pair') { // 🤝 ghép Đệ nhị thân (Quản trị)
    const e = needQt(); if (e) return e;
    const pair = cut(d.pair, 120).toLowerCase(), st = ['Chưa phân tích', 'Đã đề xuất', 'Đã thống nhất', 'Cần điều chỉnh'].indexOf(d.st) >= 0 ? d.st : 'Đã đề xuất';
    await run(x.db, "INSERT INTO hr_ht (email, upd) VALUES (?, ?) ON CONFLICT(email) DO NOTHING", email, now);
    await run(x.db, 'UPDATE hr_ht SET pair = ?, pair_why = ?, pair_st = ?, upd = ?, nt_dirty = 1 WHERE email = ?', pair, cut(d.why, 800), pair ? st : '', now, email);
    if (pair && d.both) { await run(x.db, "INSERT INTO hr_ht (email, upd) VALUES (?, ?) ON CONFLICT(email) DO NOTHING", pair, now); await run(x.db, 'UPDATE hr_ht SET pair = ?, pair_why = ?, pair_st = ?, upd = ?, nt_dirty = 1 WHERE email = ?', email, cut(d.why, 800), st, now, pair); }
    x.later(ntPush(x, 20).catch(er => console.error('ntPush', er.message)));
    return listOut(x, u);
  }
  if (op === 'st_nt') { // 📒 Notion: lưu khoá riêng (không bắt buộc), kiểm tra quyền đọc 2 bảng
    const e = needQt(); if (e) return e;
    if (d.token !== undefined) { const t = cut(d.token, 200); if (t && !/^(secret_|ntn_)\w{20,}$/.test(t)) return { ok: false, error: 'Khoá Notion có dạng ntn_… hoặc secret_…' }; await kvSet(x.db, 'hr_nt', JSON.stringify({ token: t })); }
    await kvSet(x.db, 'hr_nt_chk', ''); return listOut(x, u);
  }
  if (op === 'st_nt_pull') { const e = needQt(); if (e) return e; const r = await ntPull(x); if (r.ok) await log(x, u, 'Nhân sự', '-', '', 'Lấy hồ sơ từ Notion: ' + r.msg, ''); return Object.assign(await listOut(x, u), { pull: r }); }
  if (op === 'st_nt_push') { const e = needQt(); if (e) return e; if (d.all) { await run(x.db, "UPDATE hr_staff SET nt_dirty = 1"); await run(x.db, "UPDATE hr_ht SET nt_dirty = 1 WHERE ans != ''"); await ensureRows(x); } const r = await ntPush(x, 60); return Object.assign(await listOut(x, u), { push: r }); }
  return { ok: false, error: 'Không rõ thao tác.' };
}

/* ================================================================ 🤝 Hiểu & Thương – 9 câu (form gốc ở Notion "Hiểu & Thương — Ghép Đệ nhị thân VitaGreen")
 * Mọi nhân sự tự điền trong CRM (lệnh ht {op: me | save}); Quản lý xem câu 2–6, 8, 9 + thế mạnh / cần hỗ trợ; câu 1, 7, điều không muốn chia sẻ chỉ Quản trị. */
const HT_Q = [['q1', '1. Tình trạng cá nhân và gia đình', '1. Cá nhân và gia đình', 0, 1], ['q2', '2. Điểm mạnh – việc bạn giỏi nhất', '2. Điểm mạnh và việc giỏi nhất', 1, 0],
  ['q3', '3. Kinh nghiệm và khả năng dẫn dắt', '3. Kinh nghiệm và khả năng dẫn dắt', 0, 0], ['q4', '4. Tính cách nổi bật', '4. Tính cách nổi bật', 1, 0],
  ['q5', '5. Khát khao và tâm huyết', '5. Khát khao và tâm huyết', 0, 0], ['q6', '6. Sở trường có thể đóng góp cho đội ngũ', '6. Hiểu biết sâu sắc / sở trường', 1, 0],
  ['q7', '7. Khó khăn hoặc biến cố lớn', '7. Khó khăn hoặc biến cố lớn', 0, 1], ['q8', '8. Đóng góp và phụng sự', '8. Đóng góp và phụng sự', 0, 0],
  ['q9', '9. Cam kết rèn luyện trong 30 ngày', '9. Tự nhận xét và cam kết 30 ngày', 1, 0]]; // [khoá, câu hỏi, cột Notion, bắt buộc, riêng tư]
const HT_SK = ['Lập kế hoạch / ưu tiên', 'Hành động / bám tiến độ', 'Cẩn thận / kiểm soát lỗi', 'Giao tiếp / kết nối', 'Sáng tạo / nội dung', 'Marketing / bán hàng', 'Công nghệ / AI / Notion', 'Quản lý / đào tạo', 'Lắng nghe / tinh thần'];
const HT_HOW = ['Nhắc việc nhẹ nhàng', 'Hỏi và lắng nghe', 'Góp ý thẳng - ngắn gọn', 'Cùng làm mẫu một lần', 'Kiểm tra tiến độ định kỳ'];
const HT_OPT = { q: HT_Q.map(q => ({ k: q[0], t: q[1], req: q[3], priv: q[4] })), sk: HT_SK, how: HT_HOW };
function htOut(r, qt) {
  if (!r) return null; const a = parse(r.ans);
  const o = { at: r.at || 0, upd: r.upd || 0, pair: r.pair || '', pairWhy: r.pair_why || '', pairSt: r.pair_st || '' };
  if (a) { o.a = {}; for (const k in a) if (qt || !(HT_Q.find(q => q[0] === k) || [])[4] && k !== 'priv') o.a[k] = a[k]; }
  return o;
}
function htClean(d) {
  const a = {}; for (const q of HT_Q) a[q[0]] = cut(d[q[0]], 1500);
  const pick = (v, L) => (Array.isArray(v) ? v : []).filter(s => L.indexOf(s) >= 0).slice(0, 3);
  a.give = pick(d.give, HT_SK); a.need = pick(d.need, HT_SK); a.how = HT_HOW.indexOf(d.how) >= 0 ? d.how : ''; a.priv = cut(d.priv, 800); a.consent = !!d.consent;
  return a;
}
/** ht {op: me | save}: mọi vai trò, chỉ phần của chính mình. */
export async function crmHt(x, u, d) {
  await staffSchema(x.db);
  let F = await formsOf(x.db);
  const me = async () => { const r2 = await first(x.db, 'SELECT * FROM hr_ht WHERE email = ?', u.email); return { ok: true, ans: r2 ? parse(r2.ans) : null, opt: HT_OPT, forms: F, pf: await pfMe(x, u), pfOpt: PF_OPT }; };
  if (d.op === 'forms') { // Quản trị bật / tắt 2 form (Cài đặt → Nhân sự)
    if (u.level < 3) return { ok: false, error: 'Chỉ Quản trị bật / tắt được form.' };
    F = { ht: d.ht ? 1 : 0, pf: d.pf ? 1 : 0 }; await kvSet(x.db, 'hr_forms', JSON.stringify(F)); return me();
  }
  if (d.op === 'pf_save') { if (!F.pf) return { ok: false, error: 'Form này đang tạm tắt.' }; const j = await pfSave(x, u, d); return j.ok ? Object.assign(await me(), { saved: 1 }) : j; }
  if (d.op === 'save' && !F.ht) return { ok: false, error: 'Form Hiểu & Thương đang tạm tắt.' };
  if (d.op === 'save') {
    const a = htClean(d), miss = HT_Q.filter(q => q[3] && !a[q[0]]).map(q => q[1].split('.')[0]);
    if (miss.length) return { ok: false, error: 'Bạn trả lời thêm câu ' + miss.join(', ') + ' (bắt buộc) nhé.' };
    if (!a.give.length || !a.need.length || !a.how) return { ok: false, error: 'Chọn thế mạnh, nội dung cần hỗ trợ và cách muốn được đồng hành.' };
    if (!a.consent) return { ok: false, error: 'Tích ô đồng ý ở cuối để gửi.' };
    const now = Date.now();
    await run(x.db, `INSERT INTO hr_ht (email, ans, at, upd, nt_dirty) VALUES (?, ?, ?, ?, 1) ON CONFLICT(email) DO UPDATE SET ans = excluded.ans, upd = excluded.upd, at = COALESCE(hr_ht.at, excluded.at), nt_dirty = 1`, u.email, JSON.stringify(a), now, now);
    await run(x.db, "INSERT INTO hr_staff (email, upd, upd_by) VALUES (?, ?, ?) ON CONFLICT(email) DO NOTHING", u.email, now, u.name);
    x.later(ntPush(x, 10).catch(er => console.error('ntPush', er.message)));
    return Object.assign(await me(), { saved: 1 });
  }
  return me();
}

/* ================================================================ 📒 Notion: lấy về 1 lần (chỉ điền ô CRM đang trống) + ghi ngược làm bản lưu dự phòng
 * Bảng "👥 Nhân sự VitaGreen / Thực Dưỡng Lành" + "🤝 Hiểu & Thương". Khoá: kv hr_nt (riêng) hoặc khoá Notion của ✅ Việc tuần (gv_cfg.notion).
 * Không bao giờ xoá ô bên Notion: ô CRM trống thì không gửi. Lương không gửi sang Notion. */
const NT_STAFF = '584ef1e12b004e0c9e5fa5bf65ca3c69', NT_HT = 'c4a8bccc9c3f4e32a1700132c543991a', NV = '2022-06-28';
async function ntTok(x) { const h = await kvJson(x.db, 'hr_nt', null); if (h && h.token) return h.token; const g = await kvJson(x.db, 'gv_cfg', {}) || {}; return g.notion && g.notion.token || ''; }
async function nt(tok, method, path, body) {
  const r = await fetch('https://api.notion.com/v1/' + path, { method, headers: { Authorization: 'Bearer ' + tok, 'Notion-Version': NV, 'Content-Type': 'application/json' }, body: body ? JSON.stringify(body) : undefined });
  const j = await r.json().catch(() => ({})); if (!r.ok) throw new Error((j.message || 'Notion lỗi ' + r.status).slice(0, 200)); return j;
}
async function ntAll(tok, db) { const out = []; let cur; for (let i = 0; i < 10; i++) { const j = await nt(tok, 'POST', 'databases/' + db + '/query', Object.assign({ page_size: 100 }, cur ? { start_cursor: cur } : {})); out.push(...(j.results || [])); if (!j.has_more) break; cur = j.next_cursor; } return out; }
async function ntState(x) {
  const tok = await ntTok(x), own = !!((await kvJson(x.db, 'hr_nt', null)) || {}).token;
  if (!tok) return { tok: 0 };
  let C = await kvJson(x.db, 'hr_nt_chk', null);
  if (!C || Date.now() - C.at > 6 * 3600e3) {
    C = { at: Date.now() };
    for (const [k, db] of [['staff', NT_STAFF], ['ht', NT_HT]]) { try { await nt(tok, 'GET', 'databases/' + db); C[k] = 1; } catch (e) { C[k] = 0; C[k + 'Err'] = e.message; } }
    await kvSet(x.db, 'hr_nt_chk', JSON.stringify(C));
  }
  const w = await first(x.db, 'SELECT COUNT(*) n, MAX(nt_err) e FROM hr_staff WHERE nt_dirty = 1'), w2 = await first(x.db, 'SELECT COUNT(*) n FROM hr_ht WHERE nt_dirty = 1');
  return { tok: 1, own: own ? 1 : 0, staff: C.staff, ht: C.ht, staffErr: C.staffErr || '', htErr: C.htErr || '', wait: (w.n || 0) + (w2.n || 0), err: w.e || '', last: (await kvJson(x.db, 'hr_nt_last', null)) || null };
}
async function ntDirty(x, email) { await run(x.db, 'UPDATE hr_staff SET nt_dirty = 1 WHERE email = ?', email); x.later(ntPush(x, 10).catch(e => console.error('ntPush', e.message))); }
async function ensureRows(x) { for (const z of await crmUsers(x)) await run(x.db, "INSERT INTO hr_staff (email, upd, nt_dirty) VALUES (?, ?, 1) ON CONFLICT(email) DO NOTHING", z.email, Date.now()); }
// đọc ô Notion
const pT = p => p ? ((p.title || p.rich_text || []).map(t => t.plain_text).join('')).trim() : '';
const pD = p => p && p.date && p.date.start ? p.date.start.slice(0, 10) : '';
const pS = p => p ? (p.select && p.select.name) || (p.status && p.status.name) || '' : '';
const pM = p => p && p.multi_select ? p.multi_select.map(o => o.name) : [];
const isoDmy = s => { const m = String(s || '').match(/^(\d{4})-(\d{2})-(\d{2})/); return m ? m[3] + '/' + m[2] + '/' + m[1] : ''; };
const dmyIso = s => { const m = String(s || '').match(/(\d{1,2})\/(\d{1,2})\/(\d{4})/); return m ? m[3] + '-' + m[2].padStart(2, '0') + '-' + m[1].padStart(2, '0') : ''; };
// ghi ô Notion (bỏ ô trống)
const wT = (v, title) => v ? { [title ? 'title' : 'rich_text']: [{ type: 'text', text: { content: String(v).slice(0, 1900) } }] } : null;
const wD = v => v ? { date: { start: v } } : null;

function matcher(users) {
  return (name, email) => {
    if (email) { const z = users.find(u => u.email === String(email).toLowerCase()); if (z) return z; }
    const k = nameKey(name); if (!k) return null;
    let z = users.filter(u => u.full && nameKey(u.full) === k); if (z.length === 1) return z[0];
    z = users.filter(u => nameKey(u.name) === k); if (z.length === 1) return z[0];
    z = users.filter(u => { const n = nameKey(u.name); return n.split(' ').length >= 2 && k.endsWith(' ' + n); }); return z.length === 1 ? z[0] : null;
  };
}
export async function ntPull(x) {
  const tok = await ntTok(x); if (!tok) return { ok: false, error: 'Chưa có khoá Notion.' };
  await staffSchema(x.db);
  let pages; try { pages = await ntAll(tok, NT_STAFF); } catch (e) { return { ok: false, error: 'Không đọc được bảng 👥 Nhân sự trên Notion (' + e.message + '). Mở bảng → ••• → Kết nối → thêm tích hợp của CRM.' }; }
  const users = await crmUsers(x), find = matcher(users), miss = [], now = Date.now(); let n = 0, f = 0;
  for (const pg of pages) {
    const P = pg.properties || {}, name = pT(P['Họ tên']); if (!name) continue;
    const z = find(name, P['Email'] && P['Email'].email);
    if (!z) { miss.push({ name, st: pS(P['Trạng thái']), role: pT(P['Vai trò']) }); continue; }
    n++;
    const uu = [['full', name], ['phone', normPhone(P['Số điện thoại'] && P['Số điện thoại'].phone_number || '')], ['dob', isoDmy(pD(P['Ngày sinh']))], ['joined', isoDmy(pD(P['Ngày bắt đầu']))]];
    const bank = pT(P['Tài khoản ngân hàng']), digits = (bank.match(/\d[\d .]{5,}\d/) || [''])[0].replace(/\D/g, '');
    if (digits) uu.push(['acct', digits]);
    for (const [k, v] of uu) if (v) f += (await run(x.db, `UPDATE users SET ${k} = ? WHERE email = ? AND COALESCE(${k}, '') = ''`, v, z.email)).meta.changes || 0;
    await run(x.db, "INSERT INTO hr_staff (email, upd, upd_by) VALUES (?, ?, 'Notion') ON CONFLICT(email) DO NOTHING", z.email, now);
    const ss = [['pos', pT(P['Vai trò'])], ['dept', pS(P['Bộ phận'])], ['note', pT(P['Ghi chú'])], ['strong', pT(P['Điểm mạnh'])], ['idno', pT(P['Số CCCD'])], ['addr', pT(P['Địa chỉ hiện tại'])], ['emer', pT(P['Người liên hệ khẩn cấp'])], ['bank', bank], ['home', pT(P['Quê quán'])]];
    for (const [k, v] of ss) if (v) f += (await run(x.db, `UPDATE hr_staff SET ${k} = ? WHERE email = ? AND COALESCE(${k}, '') = ''`, v, z.email)).meta.changes || 0;
    await run(x.db, 'UPDATE hr_staff SET nt_id = ? WHERE email = ?', pg.id, z.email);
  }
  x._users = null;
  // Hiểu & Thương: câu trả lời điền trên Notion mà CRM chưa có
  let h = 0, herr = '';
  try {
    const byNt = {}; for (const r of await all(x.db, "SELECT email, nt_id FROM hr_staff WHERE nt_id != ''")) byNt[r.nt_id.replace(/-/g, '')] = r.email;
    for (const pg of await ntAll(tok, NT_HT)) {
      const P = pg.properties || {}, rel = (P['Hồ sơ nhân sự'] && P['Hồ sơ nhân sự'].relation || [])[0];
      const email = rel && byNt[rel.id.replace(/-/g, '')] || ((find(pT(P['Họ và tên'])) || {}).email); if (!email) continue;
      const cur = await first(x.db, 'SELECT ans FROM hr_ht WHERE email = ?', email); if (cur && cur.ans) { await run(x.db, 'UPDATE hr_ht SET nt_id = ? WHERE email = ?', pg.id, email); continue; }
      const a = {}; for (const q of HT_Q) a[q[0]] = pT(P[q[2]]);
      a.give = pM(P['Thế mạnh có thể hỗ trợ']); a.need = pM(P['Nội dung đang cần hỗ trợ']); a.how = pS(P['Cách muốn được đồng hành']); a.priv = pT(P['Điều không muốn chia sẻ công khai']); a.consent = !!(P['Đồng ý dùng dữ liệu để ghép Đệ nhị thân'] || {}).checkbox;
      await run(x.db, `INSERT INTO hr_ht (email, ans, at, upd, nt_id) VALUES (?, ?, ?, ?, ?) ON CONFLICT(email) DO UPDATE SET ans = excluded.ans, at = excluded.at, upd = excluded.upd, nt_id = excluded.nt_id`, email, JSON.stringify(a), Date.parse(pg.created_time) || now, now, pg.id); h++;
    }
  } catch (e) { herr = e.message; }
  const msg = 'khớp ' + n + '/' + pages.length + ' người, điền thêm ' + f + ' ô còn trống' + (h ? ', ' + h + ' bài Hiểu & Thương' : '');
  await kvSet(x.db, 'hr_nt_last', JSON.stringify({ pull: now, pullMsg: msg }));
  return { ok: true, n, tot: pages.length, f, h, miss, herr, msg };
}
/** Ghi ngược sang Notion những hồ sơ / bài Hiểu & Thương vừa đổi (nt_dirty). Gọi sau khi lưu, khi bấm nút, và mỗi lượt cron. */
export async function ntPush(x, max) {
  const tok = await ntTok(x); if (!tok) return { ok: false, error: 'Chưa có khoá Notion.' };
  await staffSchema(x.db);
  const users = await crmUsers(x), U = {}; users.forEach(z => { U[z.email] = z; });
  let n = 0, bad = 0, err = '';
  for (const r of await all(x.db, 'SELECT * FROM hr_staff WHERE nt_dirty = 1 LIMIT ?', max || 20)) {
    const z = U[r.email]; if (!z) { await run(x.db, 'UPDATE hr_staff SET nt_dirty = 0 WHERE email = ?', r.email); continue; }
    const pr = { 'Họ tên': wT(z.full || z.name, 1), 'Email': z.email ? { email: z.email } : null, 'Số điện thoại': z.phone ? { phone_number: z.phone } : null,
      'Ngày sinh': wD(dmyIso(z.dob)), 'Ngày bắt đầu': wD(dmyIso(z.joined)), 'Vai trò': wT(r.pos), 'Bộ phận': r.dept ? { select: { name: r.dept.slice(0, 90) } } : null,
      'Ghi chú': wT(r.note), 'Điểm mạnh': wT(r.strong), 'Số CCCD': wT(r.idno), 'Địa chỉ hiện tại': wT(r.addr), 'Người liên hệ khẩn cấp': wT(r.emer), 'Tài khoản ngân hàng': wT(r.bank || z.acct), 'Quê quán': wT(r.home) };
    if (!z.active) pr['Trạng thái'] = { status: { name: 'Đã nghỉ' } }; else if (!r.nt_id) pr['Trạng thái'] = { status: { name: 'Đang làm' } };
    for (const k in pr) if (!pr[k]) delete pr[k];
    try {
      if (r.nt_id) await nt(tok, 'PATCH', 'pages/' + r.nt_id, { properties: pr });
      else { const pg = await nt(tok, 'POST', 'pages', { parent: { database_id: NT_STAFF }, properties: pr }); await run(x.db, 'UPDATE hr_staff SET nt_id = ? WHERE email = ?', pg.id, r.email); }
      await run(x.db, "UPDATE hr_staff SET nt_dirty = 0, nt_err = '' WHERE email = ?", r.email); n++;
    } catch (e) { bad++; err = e.message; await run(x.db, 'UPDATE hr_staff SET nt_err = ? WHERE email = ?', e.message.slice(0, 200), r.email); if (/Could not find|unauthorized|restricted/i.test(e.message)) break; }
  }
  const sid = {}; for (const r of await all(x.db, "SELECT email, nt_id FROM hr_staff WHERE nt_id != ''")) sid[r.email] = r.nt_id;
  const DEPT = { 'Sale & CSKH': 'Kinh doanh / CSKH', 'Marketing': 'Marketing', 'Kho': 'Vận hành', 'Kế toán': 'Kế toán / Hành chính', 'Quản lý': 'Ban lãnh đạo', 'Quản trị': 'Ban lãnh đạo' };
  for (const r of await all(x.db, 'SELECT * FROM hr_ht WHERE nt_dirty = 1 LIMIT ?', max || 20)) {
    const z = U[r.email], a = parse(r.ans) || {}; if (!z) { await run(x.db, 'UPDATE hr_ht SET nt_dirty = 0 WHERE email = ?', r.email); continue; }
    const pr = { 'Họ và tên': wT(z.full || z.name, 1), 'Bộ phận': { select: { name: DEPT[z.role] || 'Khác' } }, 'Số điện thoại/Zalo': z.phone ? { phone_number: z.phone } : null, 'Ngày sinh': wD(dmyIso(z.dob)),
      'Thế mạnh có thể hỗ trợ': a.give && a.give.length ? { multi_select: a.give.map(name => ({ name })) } : null, 'Nội dung đang cần hỗ trợ': a.need && a.need.length ? { multi_select: a.need.map(name => ({ name })) } : null,
      'Cách muốn được đồng hành': a.how ? { select: { name: a.how } } : null, 'Điều không muốn chia sẻ công khai': wT(a.priv), 'Đồng ý dùng dữ liệu để ghép Đệ nhị thân': r.ans ? { checkbox: !!a.consent } : null,
      'Hồ sơ nhân sự': sid[r.email] ? { relation: [{ id: sid[r.email] }] } : null, 'Đệ nhị thân đề xuất': r.pair && sid[r.pair] ? { relation: [{ id: sid[r.pair] }] } : null,
      'Lý do ghép': wT(r.pair_why), 'Trạng thái ghép': r.pair_st ? { select: { name: r.pair_st } } : null };
    for (const q of HT_Q) pr[q[2]] = wT(a[q[0]]);
    for (const k in pr) if (!pr[k]) delete pr[k];
    try {
      if (r.nt_id) await nt(tok, 'PATCH', 'pages/' + r.nt_id, { properties: pr });
      else { const pg = await nt(tok, 'POST', 'pages', { parent: { database_id: NT_HT }, properties: pr }); await run(x.db, 'UPDATE hr_ht SET nt_id = ? WHERE email = ?', pg.id, r.email); }
      await run(x.db, "UPDATE hr_ht SET nt_dirty = 0, nt_err = '' WHERE email = ?", r.email); n++;
    } catch (e) { bad++; err = e.message; await run(x.db, 'UPDATE hr_ht SET nt_err = ? WHERE email = ?', e.message.slice(0, 200), r.email); if (/Could not find|unauthorized|restricted/i.test(e.message)) break; }
  }
  const L = await kvJson(x.db, 'hr_nt_last', null) || {}; L.push = Date.now(); L.pushMsg = 'ghi ' + n + ' mục' + (bad ? ', lỗi ' + bad + ' (' + err + ')' : ''); await kvSet(x.db, 'hr_nt_last', JSON.stringify(L));
  return { ok: !bad, n, bad, error: bad ? 'Có ' + bad + ' mục chưa ghi được sang Notion: ' + err : '' };
}

/* ================================================================ 📝 Thông tin của tôi (15/11/2026, anh Sơn: form để nhân sự tự cập nhật, công ty hỗ trợ + chăm sóc tốt hơn)
 * kv hr_forms = { ht: 0|1, pf: 0|1 } – Quản trị bật / tắt 2 form ở Cài đặt (mặc định: Hiểu & Thương tắt, Thông tin của tôi bật).
 * Lưu thẳng vào hồ sơ: users (full, dob, phone, acct) + hr_staff (home, addr, idno, idd, idp, emer, bank); phần chăm sóc vào hr_pf (data JSON).
 * Quản lý xem phần chăm sóc trừ sức khoẻ; CCCD, nơi ở, tài khoản, sức khoẻ chỉ Quản trị (giống PRIV). */
const FORMS_DEF = { ht: 0, pf: 1 };
export async function formsOf(db) { return Object.assign({}, FORMS_DEF, await kvJson(db, 'hr_forms', null) || {}); }
const PF_CARE = [['fam', 'Tình trạng gia đình'], ['kids', 'Con (số con, năm sinh)'], ['wed', 'Ngày cưới'], ['like', 'Sở thích, món ăn / đồ uống yêu thích'], ['gift', 'Món quà nhỏ bạn thích'],
  ['shirt', 'Size áo'], ['go', 'Đi làm bằng gì, mất bao lâu'], ['health', 'Lưu ý sức khoẻ, dị ứng'], ['wish', 'Mong công ty hỗ trợ thêm']];
const PF_PRIV = ['health'];
export const PF_OPT = { care: PF_CARE.map(c => ({ k: c[0], t: c[1], priv: PF_PRIV.indexOf(c[0]) >= 0 })), fam: ['Độc thân', 'Đã kết hôn', 'Khác'], shirt: ['S', 'M', 'L', 'XL', 'XXL'] };
async function pfMe(x, u) {
  const z = (await crmUsers(x)).find(y => y.email === u.email) || {}, e = await first(x.db, 'SELECT * FROM hr_staff WHERE email = ?', u.email) || {}, p = await first(x.db, 'SELECT * FROM hr_pf WHERE email = ?', u.email);
  return { full: z.full || '', dob: z.dob || '', phone: z.phone || '', acct: z.acct || '', home: e.home || '', addr: e.addr || '', idno: e.idno || '', idd: e.idd || '', idp: e.idp || '', emer: e.emer || '', bank: e.bank || '', care: p ? parse(p.data) || {} : {}, at: p ? p.at : 0 };
}
/** cho listOut: phần chăm sóc theo quyền. */
export function pfOut(r, qt) {
  if (!r) return null; const c = parse(r.data) || {}, o = {};
  PF_CARE.forEach(([k]) => { if (c[k] && (qt || PF_PRIV.indexOf(k) < 0)) o[k] = c[k]; });
  return { c: o, at: r.at || 0 };
}
async function pfSave(x, u, d) {
  const full = cut(d.full, 80), phone = normPhone(d.phone || ''), dob = dobNorm(d.dob), addr = cut(d.addr, 300);
  if (!full || !dob || !/\/\d{4}$/.test(dob) || !phone || !addr) return { ok: false, error: 'Bạn điền đủ họ tên, ngày sinh (có năm), số điện thoại, nơi ở hiện tại nhé.' };
  const en = cut(d.emerName, 80), ep = normPhone(d.emerPhone || '');
  if (!en || !ep) return { ok: false, error: 'Bạn ghi tên và số điện thoại người liên hệ khi cần (người thân).' };
  if (!d.consent) return { ok: false, error: 'Tích ô đồng ý ở cuối để gửi.' };
  const now = Date.now(), care = {};
  PF_CARE.forEach(([k]) => { const v = cut(d[k], 500); if (v) care[k] = v; });
  for (const [k, v] of [['full', full], ['phone', phone], ['dob', dob]]) await run(x.db, `UPDATE users SET ${k} = ? WHERE email = ?`, v, u.email);
  const acct = String(d.acct || '').replace(/\D/g, '').slice(0, 24); if (acct) await run(x.db, 'UPDATE users SET acct = ? WHERE email = ?', acct, u.email);
  x._users = null;
  const emer = [cut(d.emerRel, 40), en, ep].filter(Boolean).join(' – ');
  await run(x.db, "INSERT INTO hr_staff (email, upd, upd_by) VALUES (?, ?, ?) ON CONFLICT(email) DO NOTHING", u.email, now, u.name);
  const sets = [['home', cut(d.home, 300)], ['addr', addr], ['idno', cut(d.idno, 30)], ['idd', cut(d.idd, 30)], ['idp', cut(d.idp, 200)], ['emer', emer], ['bank', cut(d.bank, 300)]].filter(s => s[1]);
  for (const [k, v] of sets) await run(x.db, `UPDATE hr_staff SET ${k} = ? WHERE email = ?`, v, u.email);
  await run(x.db, 'UPDATE hr_staff SET upd = ?, upd_by = ? WHERE email = ?', now, u.name + ' (tự cập nhật)', u.email);
  await run(x.db, 'INSERT INTO hr_pf (email, data, at) VALUES (?, ?, ?) ON CONFLICT(email) DO UPDATE SET data = excluded.data, at = excluded.at', u.email, JSON.stringify(care), now);
  await ntDirty(x, u.email);
  return { ok: true, saved: 1 };
}
