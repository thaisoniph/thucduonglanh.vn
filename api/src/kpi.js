// 📋 KPI tháng của kế toán (13/11/2026, chị Thủy đề xuất bảng "KPI kế toán nội bộ kiêm thuế", anh Sơn "Làm luôn").
// - Kế toán tự chấm từng nhóm việc của tháng (mức 100 / 80 / 50 / 0% + ghi chú, bằng chứng) → Quản lý / Quản trị chấm lại, điểm cộng (≤ 5) → Chốt.
// - Bảng kpi_kt: 1 dòng / (tháng, người). self / mgr = JSON {g: [{p, n}], plus, pn}. tpl = bản chụp các nhóm việc lúc tạo, để sửa bảng sau này không đổi điểm tháng cũ.
// - Cách cộng điểm, xếp loại, lương hiệu quả tính ở CRM (kptCalc trong crm/app.js), máy chủ chỉ lưu.
// - kv kpi_cfg: {base, eff: {A, B, C, D}, trial: 'YYYY-MM' (tháng chấm thử: lương không thấp hơn floor), floor, groups} – Quản trị sửa được.
import { all, run, kvJson, kvSet } from './lib.js';

export const KPI_GROUPS = [
  { t: 'Thu chi, dòng tiền và doanh thu', w: 15, key: 1,
    due: ['Cập nhật thu chi mỗi ngày làm việc (tải sao kê VCB / MB vào CRM)', 'Thứ Hai gửi kế hoạch thu chi trong tuần', 'Thứ Tư đối soát Shopee, TikTok Shop và COD', 'Chiều thứ Sáu rà khoản chưa khớp', 'Chốt tháng trước vào ngày làm việc thứ 3 của tháng sau'],
    ok: ['Sổ thu chi đủ, khớp số dư quỹ và ngân hàng', 'Kế hoạch tuần ghi rõ khoản phải chi, nguồn chi, ngày có nguy cơ thiếu tiền', 'Phiếu Best / Viettel Post không để quá 3 ngày (đỏ trên CRM); đơn Shopee quá hạn đã hỏi sàn', 'Doanh thu từng sàn khớp với hoá đơn đã xuất'] },
  { t: 'Công nợ phải thu, phải trả', w: 10,
    due: ['Ngày 15 và ngày cuối tháng rà nợ quá hạn', 'Trình hồ sơ chi trước hạn thanh toán', 'Chốt số dư chậm nhất ngày mùng 5 tháng sau'],
    ok: ['Sổ công nợ nhà cung cấp trên CRM ghi đủ hoá đơn, khoản quá hạn có bước xử lý', 'Đối chiếu nhà cung cấp đến kỳ, hồ sơ chi đủ chứng từ', 'Báo sớm nguy cơ chậm duyệt hoặc thiếu tiền chi'] },
  { t: 'Lương, BHXH và thuế TNCN', w: 10,
    due: ['Trình bảng lương trước ngày chi lương ít nhất 1 ngày làm việc', 'Báo tăng, giảm BHXH ngay trong tháng phát sinh', 'Chi theo mốc Giám đốc đã duyệt'],
    ok: ['Bảng lương khớp công, phép, thưởng, hoa hồng và điều chỉnh đã duyệt', 'Khấu trừ BHXH và thuế TNCN đúng', 'Danh sách chuyển khoản xong ngay sau khi duyệt; báo ngay nếu thiếu dữ liệu'] },
  { t: 'Giá trị tồn kho', w: 5,
    due: ['Ngày làm việc cuối tháng chốt giá trị tồn ở CRM (💼 Kế toán → 📦 Hàng tồn kho → Cuối tháng)', 'Cuối quý đối chiếu cùng kho khi kiểm kê toàn kho'],
    ok: ['Giá trị tồn khớp sổ sách', 'Hàng về kho khớp hoá đơn nhà cung cấp; chênh lệch có ghi nguyên nhân và hướng xử lý'] },
  { t: 'Hoá đơn và chứng từ', w: 20, key: 1,
    due: ['Lập hoá đơn đầu ra đúng thời điểm của từng giao dịch', 'Chiều thứ Sáu rà hồ sơ đầu vào còn thiếu', 'Rà soát xong tháng trước vào ngày làm việc thứ 3 của tháng sau'],
    ok: ['100% hoá đơn đầu ra Trang phụ trách lập đúng thời điểm', 'Hoá đơn đầu vào hợp lệ, được kiểm tra và lưu đủ', 'Chứng từ thiếu có danh sách, người bổ sung và hạn hoàn tất', 'Hoá đơn lập muộn được ghi nhận ngay khi phát hiện'] },
  { t: 'Kê khai thuế và sổ sách', w: 10,
    due: ['Đầu tháng rà nghĩa vụ thuế đến hạn', 'Hồ sơ xong để kiểm tra trước hạn nộp ít nhất 5 ngày làm việc', 'Khoá sổ tháng trước vào ngày làm việc thứ 5 của tháng sau'],
    ok: ['Số liệu khớp sổ sách, hồ sơ đủ, nộp đúng hạn, lưu biên nhận', 'Báo và trình khoản phải nộp trước hạn', 'Không bị phạt do lỗi của kế toán'] },
  { t: 'Báo cáo tháng và bàn giao', w: 20, key: 1,
    due: ['Gửi báo cáo chậm nhất ngày làm việc thứ 5 của tháng sau', 'Báo ngay khi có nguy cơ trễ việc', 'Bàn giao trước ngày nghỉ đã lên lịch'],
    ok: ['Báo cáo gồm thu chi, dòng tiền, doanh thu theo kênh, công nợ, tồn kho và chênh lệch cần Giám đốc quyết định', 'Bàn giao ghi việc đã làm, việc còn lại, hạn, hồ sơ và người hỗ trợ'] }
];
export const KPI_DEF = { base: 7000000, eff: { A: 5000000, B: 4000000, C: 3000000, D: 2000000 }, trial: '2026-11', floor: 11000000, groups: KPI_GROUPS };

let ok = false;
async function kpiSchema(db) {
  if (ok) return;
  await run(db, "CREATE TABLE IF NOT EXISTS kpi_kt (id TEXT PRIMARY KEY, month TEXT, name TEXT, tpl TEXT DEFAULT '', self TEXT DEFAULT '', self_at INTEGER, mgr TEXT DEFAULT '', mgr_by TEXT DEFAULT '', mgr_at INTEGER, done INTEGER DEFAULT 0, done_by TEXT DEFAULT '', done_at INTEGER)");
  ok = true;
}
const MON = /^20\d\d-(0[1-9]|1[0-2])$/;
const P_OK = { 100: 1, 80: 1, 50: 1, 0: 1 };
/** Phiếu chấm gửi lên → chỉ giữ đúng số nhóm, mức 100/80/50/0 (hoặc trống), ghi chú ≤ 600 chữ; điểm cộng 0–5. */
function clean(s, n) {
  s = s && typeof s === 'object' ? s : {};
  const g = []; for (let i = 0; i < n; i++) { const r = (Array.isArray(s.g) ? s.g[i] : null) || {}, p = r.p === '' || r.p == null ? null : Number(r.p); g.push({ p: P_OK[p] ? p : null, n: String(r.n || '').slice(0, 600) }); }
  return { g, plus: Math.max(0, Math.min(5, Math.round(Number(s.plus) || 0))), pn: String(s.pn || '').slice(0, 600) };
}
const parse = v => { try { return v ? JSON.parse(v) : null; } catch (e) { return null; } };
async function cfgOf(x) { const c = await kvJson(x.db, 'kpi_cfg', null) || {}; return Object.assign({}, KPI_DEF, c, { eff: Object.assign({}, KPI_DEF.eff, c.eff || {}), groups: Array.isArray(c.groups) && c.groups.length ? c.groups : KPI_GROUPS }); }
const outRow = r => ({ month: r.month, name: r.name, tpl: parse(r.tpl), self: parse(r.self), selfAt: r.self_at || 0, mgr: parse(r.mgr), mgrBy: r.mgr_by || '', mgrAt: r.mgr_at || 0, done: !!r.done, doneBy: r.done_by || '', doneAt: r.done_at || 0 });

/** kt_kpi {op}: list · self {month, s} (người kế toán tự chấm, chưa chốt) · mgr {month, name, s, done} (Quản lý / Quản trị) · reopen {month, name} · cfg {base, eff, trial, floor} (Quản trị). */
export async function crmKpi(x, u, d, log, users) {
  const mgr = u.level >= 2 && u.role !== 'Kế toán', me = u.role === 'Kế toán';
  if (!mgr && !me) return { ok: false, error: 'Chỉ kế toán, Quản lý và Quản trị xem được KPI kế toán.' };
  await kpiSchema(x.db);
  const op = String(d.op || 'list'), now = Date.now(), cfg = await cfgOf(x);
  const staff = (users || []).filter(z => z.role === 'Kế toán' && z.active).map(z => z.name);
  const list = async () => {
    const R = await all(x.db, 'SELECT * FROM kpi_kt' + (mgr ? '' : ' WHERE name = ?') + ' ORDER BY month DESC LIMIT 400', ...(mgr ? [] : [u.name]));
    return { ok: true, cfg: Object.assign({}, cfg, mgr || me ? {} : { base: 0, eff: {} }), staff: mgr ? staff : [u.name], rows: R.map(outRow), can: { mgr, ceo: u.level >= 3 && u.role !== 'Kế toán' } };
  };
  if (op === 'list') return list();
  const month = String(d.month || ''); if ((op === 'self' || op === 'mgr' || op === 'reopen') && !MON.test(month)) return { ok: false, error: 'Chọn tháng.' };
  const name = op === 'self' ? u.name : String(d.name || '').trim();
  const id = month + '|' + name, cur = name ? await all(x.db, 'SELECT * FROM kpi_kt WHERE id = ?', id) : [], row = cur[0];
  const tpl = row && parse(row.tpl) || cfg.groups, n = tpl.length;
  const ensure = async () => { if (!row) await run(x.db, 'INSERT OR IGNORE INTO kpi_kt (id, month, name, tpl) VALUES (?, ?, ?, ?)', id, month, name, JSON.stringify(tpl)); };
  if (op === 'self') {
    if (!me) return { ok: false, error: 'Chỉ người kế toán tự chấm.' };
    if (row && row.done) return { ok: false, error: 'Tháng này đã chốt. Nhờ quản lý mở lại nếu cần sửa.' };
    await ensure(); await run(x.db, 'UPDATE kpi_kt SET self = ?, self_at = ? WHERE id = ?', JSON.stringify(clean(d.s, n)), now, id);
    await log(x, u, 'Kế toán', '-', '', 'Tự chấm KPI tháng ' + month, '');
    return list();
  }
  if (!mgr) return { ok: false, error: 'Chỉ Quản lý và Quản trị chấm lại được.' };
  if (op === 'mgr') {
    if (!name || (staff.indexOf(name) < 0 && !row)) return { ok: false, error: 'Chọn người kế toán.' };
    if (row && row.done && !d.done) return { ok: false, error: 'Tháng này đã chốt. Bấm 🔓 Mở lại trước khi sửa.' };
    const s = clean(d.s, n); if (d.done && s.g.some(r => r.p == null)) return { ok: false, error: 'Chấm đủ ' + n + ' nhóm việc rồi mới chốt.' };
    await ensure(); await run(x.db, 'UPDATE kpi_kt SET mgr = ?, mgr_by = ?, mgr_at = ?, done = ?, done_by = ?, done_at = ? WHERE id = ?', JSON.stringify(s), u.name, now, d.done ? 1 : 0, d.done ? u.name : '', d.done ? now : null, id);
    await log(x, u, 'Kế toán', '-', '', (d.done ? 'Chốt' : 'Chấm lại') + ' KPI kế toán ' + name + ' tháng ' + month + (d.sum ? ': ' + String(d.sum).slice(0, 80) : ''), '');
    return list();
  }
  if (op === 'reopen') {
    if (!row) return { ok: false, error: 'Chưa có phiếu tháng này.' };
    await run(x.db, "UPDATE kpi_kt SET done = 0, done_by = '', done_at = NULL WHERE id = ?", id);
    await log(x, u, 'Kế toán', '-', '', 'Mở lại KPI kế toán ' + name + ' tháng ' + month, '');
    return list();
  }
  if (op === 'cfg') {
    if (u.level < 3 || u.role === 'Kế toán') return { ok: false, error: 'Chỉ Quản trị sửa mức lương.' };
    const m = v => Math.max(0, Math.min(1e9, Math.round(Number(String(v == null ? '' : v).replace(/[^\d]/g, '')) || 0)));
    const c = await kvJson(x.db, 'kpi_cfg', null) || {};
    c.base = m(d.base); c.eff = { A: m(d.A), B: m(d.B), C: m(d.C), D: m(d.D) }; c.floor = m(d.floor); c.trial = MON.test(d.trial || '') ? d.trial : '';
    await kvSet(x.db, 'kpi_cfg', JSON.stringify(c));
    await log(x, u, 'Kế toán', '-', '', 'Sửa mức lương theo KPI kế toán', '');
    return list();
  }
  return { ok: false, error: 'Không rõ thao tác: ' + op };
}
