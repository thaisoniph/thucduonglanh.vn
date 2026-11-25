// 👥 Bảng lương tháng cho kế toán (14/11/2026, anh Sơn "Làm luôn").
// - kv luong_staff: [{name, dept, kind: 'sale' | 'kpi' | 'fix', base, bh, cc, pa: [xăng, ăn, điện thoại] mỗi công, other, on}] – mức lương từng người, nhập 1 lần.
// - kv luong_cfg: {std: công chuẩn, bhPct: % người lao động đóng BH, ccOff: số buổi nghỉ có phép vẫn giữ chuyên cần, ccLate: số lần đi muộn vẫn giữ, lateFee: tiền trừ / lần đi muộn, prorate: lương cứng sale chia theo công}.
// - Bảng luong_th: 1 dòng / tháng. inp = {tên: {cong, phep, kp, late, thuong, phat, ung, thue, note}} kế toán nhập.
//   auto = {tên: {fixed, comm, sen, bon, rev, tier}} hoa hồng sale do CRM của Quản lý / Quản trị tính (kế toán không thấy đơn đầy đủ nên không tự tính được).
//   dlb (trả kèm list) = {tên: tiền} thưởng sale giới thiệu đại lý của tháng (daily.js dlBonusMonth), CRM cộng vào cột Hoa hồng; duyệt thì chốt ở kv luong_dlb_<tháng>.
//   st = '' (đang nhập) | 'trinh' (đã trình) | 'duyet' (đã duyệt, khoá sửa).
// - kv luong_real (16/11/2026, anh Sơn gửi file "Quản lý Nội Bộ" của Trang): lương THỰC TRẢ từng tháng đọc từ tab "Tính lương".
//   {tháng: {tên trong file: {u: tên CRM, g: nhóm, cong, std, dt, cb, kpi, hh, pc, tn, bhc, bhn, ung}}} – tn = tổng thu nhập chưa BH, bhc = phụ cấp BH trả tiền mặt (+), bhn = trích BH người lao động (−).
//   Dùng cho 💎 Giá trị nhân sự (chi phí thật từng người). kv luong_link = {link, map: {tên file: [tên CRM, nhóm]}} để đọc lại tháng sau.
// - Cộng trừ ra thực lĩnh ở CRM (lgCalc trong crm/app.js), máy chủ chỉ lưu. Không lưu số tài khoản ngân hàng.
import { all, run, kvJson, kvSet, kvDel } from './lib.js';
import { telegramTo } from './google.js';
import { dlBonusMonth } from './daily.js'; // 🏪 thưởng sale giới thiệu đại lý (23/11/2026): tự cộng vào bảng lương

export const LG_CFG = { std: 26, bhPct: 10.5, ccOff: 1, ccLate: 3, lateFee: 0, prorate: 1 };
const KINDS = { sale: 1, kpi: 1, fix: 1 };
const MON = /^20\d\d-(0[1-9]|1[0-2])$/;
let ok = false;
async function lgSchema(db) {
  if (ok) return;
  await run(db, "CREATE TABLE IF NOT EXISTS luong_th (month TEXT PRIMARY KEY, inp TEXT DEFAULT '', auto TEXT DEFAULT '', auto_by TEXT DEFAULT '', auto_at INTEGER, st TEXT DEFAULT '', st_by TEXT DEFAULT '', st_at INTEGER, upd_by TEXT DEFAULT '', upd_at INTEGER)");
  ok = true;
}
const parse = v => { try { return v ? JSON.parse(v) : null; } catch (e) { return null; } };
const money = v => Math.max(0, Math.min(1e10, Math.round(Number(String(v == null ? '' : v).replace(/[^\d.-]/g, '')) || 0)));
const numf = (v, max) => Math.max(0, Math.min(max, Math.round((Number(String(v == null ? '' : v).replace(',', '.')) || 0) * 10) / 10));
const txt = (v, n) => String(v == null ? '' : v).replace(/\s+/g, ' ').trim().slice(0, n);
function cleanStaff(list) {
  const seen = {}, out = [];
  (Array.isArray(list) ? list : []).forEach(p => {
    const name = txt(p && p.name, 60); if (!name || seen[name]) return; seen[name] = 1;
    const pa = Array.isArray(p.pa) ? p.pa : [];
    out.push({ name, dept: txt(p.dept, 40), kind: KINDS[p.kind] ? p.kind : 'fix', base: money(p.base), bh: money(p.bh), cc: money(p.cc), pa: [money(pa[0]), money(pa[1]), money(pa[2])], other: money(p.other), on: p.on === false || p.on === 0 ? false : true });
  });
  return out.slice(0, 80);
}
function cleanInp(inp, names) {
  const o = {}; inp = inp && typeof inp === 'object' ? inp : {};
  names.forEach(n => {
    const r = inp[n]; if (!r || typeof r !== 'object') return;
    o[n] = { cong: r.cong === '' || r.cong == null ? null : numf(r.cong, 31), phep: numf(r.phep, 31), kp: numf(r.kp, 31), late: numf(r.late, 99), thuong: money(r.thuong), phat: money(r.phat), ung: money(r.ung), thue: money(r.thue), note: txt(r.note, 300) };
  });
  return o;
}
function cleanAuto(a) {
  const o = {}; a = a && typeof a === 'object' ? a : {};
  Object.keys(a).slice(0, 80).forEach(k => { const r = a[k] || {}, n = txt(k, 60); if (n) o[n] = { fixed: money(r.fixed), comm: money(r.comm), sen: money(r.sen), bon: money(r.bon), rev: money(r.rev), tier: txt(r.tier, 40) }; });
  return o;
}
const REAL_G = { Sale: 1, 'Quản lý': 1, 'Kế toán': 1, Kho: 1, Marketing: 1, 'Ban giám đốc': 1, 'Khác': 1 };
const sMoney = v => Math.max(-1e9, Math.min(1e10, Math.round(Number(v) || 0)));
function cleanReal(all) {
  const out = {}; all = all && typeof all === 'object' ? all : {};
  Object.keys(all).filter(m => MON.test(m)).sort().slice(-24).forEach(m => {
    const o = {}, src = all[m] || {};
    Object.keys(src).slice(0, 60).forEach(k => {
      const r = src[k] || {}, n = txt(k, 60); if (!n) return;
      o[n] = { u: txt(r.u, 60), g: REAL_G[r.g] ? r.g : 'Khác', cong: numf(r.cong, 31), std: numf(r.std, 31), dt: money(r.dt), cb: money(r.cb), kpi: money(r.kpi), hh: money(r.hh), pc: money(r.pc), tn: money(r.tn), bhc: sMoney(r.bhc), bhn: sMoney(r.bhn), ung: money(r.ung) };
    });
    if (Object.keys(o).length) out[m] = o;
  });
  return out;
}
const outRow = r => r ? { month: r.month, inp: parse(r.inp) || {}, auto: parse(r.auto) || {}, autoBy: r.auto_by || '', autoAt: r.auto_at || 0, st: r.st || '', stBy: r.st_by || '', stAt: r.st_at || 0, updBy: r.upd_by || '', updAt: r.upd_at || 0 } : null;

/** kt_luong {op}: list {month} · staff {list} · cfg {...} · save {month, inp} · auto {month, auto} (Quản lý / Quản trị) · st {month, st: 'trinh' | 'duyet' | ''}.
 *  Quyền: Kế toán + Quản lý + Quản trị. Sale không xem được. */
export async function crmLuong(x, u, d, log, users) {
  const kt = u.role === 'Kế toán', mgr = u.level >= 2 && !kt;
  if (!kt && !mgr) return { ok: false, error: 'Chỉ kế toán, Quản lý và Quản trị xem được bảng lương.' };
  await lgSchema(x.db);
  const op = String(d.op || 'list'), now = Date.now(), month = String(d.month || '');
  if (!MON.test(month) && op !== 'staff' && op !== 'cfg' && op !== 'real') return { ok: false, error: 'Chọn tháng.' };
  const getRow = async m => outRow((await all(x.db, 'SELECT * FROM luong_th WHERE month = ?', m))[0]);
  const staffOf = async () => cleanStaff(await kvJson(x.db, 'luong_staff', null) || []);
  const list = async m => {
    const cfg = Object.assign({}, LG_CFG, await kvJson(x.db, 'luong_cfg', null) || {});
    const crm = (users || []).filter(z => z.active).map(z => ({ name: z.name, full: z.full || '', role: z.role, joined: z.joined || '' }));
    const mm = m || month, r0 = await getRow(mm), snap = r0 && r0.st === 'duyet' ? await kvJson(x.db, 'luong_snap_' + mm, null) : null; // 25/11/2026: tháng đã duyệt dùng mức lương + quy định lúc duyệt (sửa mức lương sau không làm đổi tháng đã duyệt)
    // 🏪 thưởng giới thiệu đại lý: tính lại mỗi lần mở; bảng đã duyệt thì dùng số đã chốt lúc duyệt (kv luong_dlb_<tháng>)
    const dlb = r0 && r0.st === 'duyet' ? await kvJson(x.db, 'luong_dlb_' + mm, null) || {} : await dlBonusMonth(x, mm).catch(e => { console.error('dlBonus', e.message); return {}; });
    return { ok: true, cfg: snap && snap.cfg ? snap.cfg : cfg, staff: snap && snap.staff ? snap.staff : await staffOf(), snap: !!snap, crm, dlb, real: await kvJson(x.db, 'luong_real', null) || {}, realLink: await kvJson(x.db, 'luong_link', null) || {}, row: await getRow(m || month) || { month: m || month, inp: {}, auto: {}, st: '' }, can: { mgr, ceo: u.level >= 3 && !kt, kt } };
  };
  if (op === 'list') return list();
  const row = MON.test(month) ? await getRow(month) : null, locked = row && row.st === 'duyet';
  const ensure = async () => { if (!row) await run(x.db, 'INSERT OR IGNORE INTO luong_th (month) VALUES (?)', month); };
  if (op === 'staff') {
    if (locked && await kvJson(x.db, 'luong_snap_' + month, null)) return { ok: false, error: 'Tháng này đã duyệt nên đang hiện mức lương lúc duyệt. Chọn tháng chưa duyệt (vd tháng này) rồi sửa mức lương.' }; // tránh lưu đè mức lương cũ lên mức hiện tại
    const s = cleanStaff(d.list), old = {}; (await staffOf()).forEach(p => { old[p.name] = p; }); await kvSet(x.db, 'luong_staff', JSON.stringify(s));
    // 25/11/2026 (rà soát bảo mật): ghi rõ ai đổi lương ai, từ bao nhiêu → bao nhiêu (trước đây chỉ ghi "N người")
    const F = { base: 'lương', bh: 'đóng BH', cc: 'chuyên cần', other: 'khác' }, diff = s.map(p => { const o = old[p.name]; if (!o) return p.name + ' (mới) lương ' + p.base; const ch = Object.keys(F).filter(k => (o[k] || 0) !== (p[k] || 0)).map(k => F[k] + ' ' + (o[k] || 0) + '→' + (p[k] || 0)); if ((o.pa || []).join() !== (p.pa || []).join()) ch.push('phụ cấp ' + (o.pa || []).join('/') + '→' + p.pa.join('/')); return ch.length ? p.name + ': ' + ch.join(', ') : ''; }).filter(Boolean);
    Object.keys(old).filter(n => !s.some(p => p.name === n)).forEach(n => diff.push(n + ' (bỏ khỏi bảng)'));
    await log(x, u, 'Kế toán', '-', '', 'Sửa mức lương nhân sự (' + s.length + ' người)', diff.join(' · ').slice(0, 900));
    return list(MON.test(month) ? month : '');
  }
  if (op === 'real') {
    // 📥 Lương thực trả từ tab "Tính lương" (kế toán đọc link Google Sheet trên CRM). Ghi đè từng tháng có trong d.months, tháng khác giữ nguyên.
    const cur = await kvJson(x.db, 'luong_real', null) || {}, add = cleanReal(d.months), ms = Object.keys(add);
    if (!ms.length && !d.clear) return { ok: false, error: 'Không có tháng nào để lưu.' };
    ms.forEach(m => { cur[m] = add[m]; }); if (d.clear && MON.test(String(d.clear))) delete cur[String(d.clear)];
    await kvSet(x.db, 'luong_real', JSON.stringify(cleanReal(cur)));
    const map = {}, mp = d.map && typeof d.map === 'object' ? d.map : {};
    Object.keys(mp).slice(0, 80).forEach(k => { const v = Array.isArray(mp[k]) ? mp[k] : []; const n = txt(k, 60); if (n) map[n] = [txt(v[0], 60), REAL_G[v[1]] ? v[1] : 'Khác']; });
    const link = /^https:\/\/(docs|drive)\.google\.com\//.test(String(d.link || '')) ? txt(d.link, 300) : ((await kvJson(x.db, 'luong_link', null)) || {}).link || '';
    await kvSet(x.db, 'luong_link', JSON.stringify({ link, map, by: u.name, at: now }));
    await log(x, u, 'Kế toán', '-', '', 'Cập nhật lương thực trả ' + ms.map(m => 'T' + (+m.slice(5))).join(', '), '');
    return list(MON.test(month) ? month : ms.sort().pop());
  }
  if (op === 'cfg') {
    const c = { std: numf(d.std, 31) || 26, bhPct: numf(d.bhPct, 50), ccOff: numf(d.ccOff, 31), ccLate: numf(d.ccLate, 99), lateFee: money(d.lateFee), prorate: d.prorate ? 1 : 0 };
    await kvSet(x.db, 'luong_cfg', JSON.stringify(c));
    await log(x, u, 'Kế toán', '-', '', 'Sửa quy định tính lương (công chuẩn ' + c.std + ')', '');
    return list(MON.test(month) ? month : '');
  }
  if (op === 'save') {
    if (locked) return { ok: false, error: 'Bảng lương tháng này đã duyệt. Nhờ Quản lý / Quản trị mở lại nếu cần sửa.' };
    const names = (await staffOf()).map(p => p.name);
    await ensure(); await run(x.db, 'UPDATE luong_th SET inp = ?, upd_by = ?, upd_at = ? WHERE month = ?', JSON.stringify(cleanInp(d.inp, names)), u.name, now, month);
    return list();
  }
  if (op === 'auto') {
    if (!mgr) return { ok: false, error: 'Chỉ Quản lý / Quản trị cập nhật được hoa hồng sale.' };
    if (locked) return list();
    await ensure(); await run(x.db, 'UPDATE luong_th SET auto = ?, auto_by = ?, auto_at = ? WHERE month = ?', JSON.stringify(cleanAuto(d.auto)), u.name, now, month);
    return list();
  }
  if (op === 'st') {
    const st = String(d.st || '');
    if (st === 'trinh') { if (locked) return { ok: false, error: 'Đã duyệt rồi.' }; }
    else if (st === 'duyet' || st === '') { if (!mgr) return { ok: false, error: 'Chỉ Quản lý / Quản trị duyệt hoặc mở lại bảng lương.' }; }
    else return { ok: false, error: 'Không rõ trạng thái.' };
    await ensure(); await run(x.db, 'UPDATE luong_th SET st = ?, st_by = ?, st_at = ? WHERE month = ?', st, u.name, now, month);
    if (st === 'duyet') await kvSet(x.db, 'luong_dlb_' + month, JSON.stringify(await dlBonusMonth(x, month).catch(() => ({})))); // chốt thưởng đại lý lúc duyệt
    if (st === 'duyet') await kvSet(x.db, 'luong_snap_' + month, JSON.stringify({ staff: await staffOf(), cfg: Object.assign({}, LG_CFG, await kvJson(x.db, 'luong_cfg', null) || {}) })); // 25/11/2026: chốt mức lương + quy định lúc duyệt
    if (st === '') await kvDel(x.db, 'luong_snap_' + month); // mở lại: tính theo mức lương hiện tại
    const ml = 'tháng ' + (+month.slice(5)) + '/' + month.slice(0, 4), sum = d.sum ? ' (' + txt(d.sum, 80) + ')' : '';
    await log(x, u, 'Kế toán', '-', '', (st === 'trinh' ? 'Trình' : st === 'duyet' ? 'Duyệt' : 'Mở lại') + ' bảng lương ' + ml + sum, '');
    const to = (users || []).filter(z => z.active && z.tg && z.name !== u.name && (st === 'trinh' ? z.role === 'Quản trị' || z.role === 'Quản lý' : z.role === 'Kế toán'));
    const msg = st === 'trinh' ? '👥 ' + u.name + ' đã trình bảng lương ' + ml + sum + '. Mở CRM → 💼 Kế toán → 👥 Bảng lương tháng để xem và duyệt.'
      : st === 'duyet' ? '✅ ' + u.name + ' đã duyệt bảng lương ' + ml + sum + '. Mở CRM → 💼 Kế toán → 👥 Bảng lương tháng → 📤 Tải Excel để chuyển khoản.'
        : '🔓 ' + u.name + ' đã mở lại bảng lương ' + ml + ' để sửa.';
    for (const z of to) { try { await telegramTo(x.env, z.tg, msg); } catch (e) { } }
    return list();
  }
  return { ok: false, error: 'Không rõ thao tác: ' + op };
}
