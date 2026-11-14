// 👥 Bảng lương tháng cho kế toán (14/11/2026, anh Sơn "Làm luôn").
// - kv luong_staff: [{name, dept, kind: 'sale' | 'kpi' | 'fix', base, bh, cc, pa: [xăng, ăn, điện thoại] mỗi công, other, on}] – mức lương từng người, nhập 1 lần.
// - kv luong_cfg: {std: công chuẩn, bhPct: % người lao động đóng BH, ccOff: số buổi nghỉ có phép vẫn giữ chuyên cần, ccLate: số lần đi muộn vẫn giữ, lateFee: tiền trừ / lần đi muộn, prorate: lương cứng sale chia theo công}.
// - Bảng luong_th: 1 dòng / tháng. inp = {tên: {cong, phep, kp, late, thuong, phat, ung, thue, note}} kế toán nhập.
//   auto = {tên: {fixed, comm, sen, bon, rev, tier}} hoa hồng sale do CRM của Quản lý / Quản trị tính (kế toán không thấy đơn đầy đủ nên không tự tính được).
//   st = '' (đang nhập) | 'trinh' (đã trình) | 'duyet' (đã duyệt, khoá sửa).
// - Cộng trừ ra thực lĩnh ở CRM (lgCalc trong crm/app.js), máy chủ chỉ lưu. Không lưu số tài khoản ngân hàng.
import { all, run, kvJson, kvSet } from './lib.js';
import { telegramTo } from './google.js';

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
const outRow = r => r ? { month: r.month, inp: parse(r.inp) || {}, auto: parse(r.auto) || {}, autoBy: r.auto_by || '', autoAt: r.auto_at || 0, st: r.st || '', stBy: r.st_by || '', stAt: r.st_at || 0, updBy: r.upd_by || '', updAt: r.upd_at || 0 } : null;

/** kt_luong {op}: list {month} · staff {list} · cfg {...} · save {month, inp} · auto {month, auto} (Quản lý / Quản trị) · st {month, st: 'trinh' | 'duyet' | ''}.
 *  Quyền: Kế toán + Quản lý + Quản trị. Sale không xem được. */
export async function crmLuong(x, u, d, log, users) {
  const kt = u.role === 'Kế toán', mgr = u.level >= 2 && !kt;
  if (!kt && !mgr) return { ok: false, error: 'Chỉ kế toán, Quản lý và Quản trị xem được bảng lương.' };
  await lgSchema(x.db);
  const op = String(d.op || 'list'), now = Date.now(), month = String(d.month || '');
  if (!MON.test(month) && op !== 'staff' && op !== 'cfg') return { ok: false, error: 'Chọn tháng.' };
  const getRow = async m => outRow((await all(x.db, 'SELECT * FROM luong_th WHERE month = ?', m))[0]);
  const staffOf = async () => cleanStaff(await kvJson(x.db, 'luong_staff', null) || []);
  const list = async m => {
    const cfg = Object.assign({}, LG_CFG, await kvJson(x.db, 'luong_cfg', null) || {});
    const crm = (users || []).filter(z => z.active).map(z => ({ name: z.name, full: z.full || '', role: z.role, joined: z.joined || '' }));
    return { ok: true, cfg, staff: await staffOf(), crm, row: await getRow(m || month) || { month: m || month, inp: {}, auto: {}, st: '' }, can: { mgr, ceo: u.level >= 3 && !kt, kt } };
  };
  if (op === 'list') return list();
  const row = MON.test(month) ? await getRow(month) : null, locked = row && row.st === 'duyet';
  const ensure = async () => { if (!row) await run(x.db, 'INSERT OR IGNORE INTO luong_th (month) VALUES (?)', month); };
  if (op === 'staff') {
    const s = cleanStaff(d.list); await kvSet(x.db, 'luong_staff', JSON.stringify(s));
    await log(x, u, 'Kế toán', '-', '', 'Sửa mức lương nhân sự (' + s.length + ' người)', '');
    return list(MON.test(month) ? month : '');
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
