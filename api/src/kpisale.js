// 📋 Phiếu KPI tháng của sale (19/11/2026, anh Sơn học bảng KPI NVKD phòng khám Thăng Long của chị Ý: "Làm phiếu KPI sale").
// - 4 nhóm: Doanh số 60 · Việc dẫn tới doanh số 20 · Chất lượng 10 · Quy trình 10. CRM tự chấm gần hết từ số liệu (ksCalc trong crm/app.js).
// - Máy chủ chỉ lưu phần quản lý chấm (2 mục 100/80/50/0 + nhận xét) và bản chụp điểm lúc ✅ Chốt (để tháng cũ không đổi khi dữ liệu sửa sau).
// - Bảng kpi_sale: 1 dòng / (tháng, người). Chạy thử, CHƯA gắn vào lương.
import { all, run } from './lib.js';

let ok = false;
async function ksSchema(db) {
  if (ok) return;
  await run(db, "CREATE TABLE IF NOT EXISTS kpi_sale (id TEXT PRIMARY KEY, month TEXT, name TEXT, mgr TEXT DEFAULT '', mgr_by TEXT DEFAULT '', mgr_at INTEGER, snap TEXT DEFAULT '', done INTEGER DEFAULT 0, done_by TEXT DEFAULT '', done_at INTEGER)");
  ok = true;
}
const MON = /^20\d\d-(0[1-9]|1[0-2])$/;
const P_OK = { 100: 1, 80: 1, 50: 1, 0: 1 };
const parse = v => { try { return v ? JSON.parse(v) : null; } catch (e) { return null; } };
/** Phần quản lý chấm: p = [mức mục 1, mức mục 2] (100/80/50/0 hoặc null), n = nhận xét ≤ 600 chữ. */
function clean(s) {
  s = s && typeof s === 'object' ? s : {};
  const p = [0, 1].map(i => { const v = Array.isArray(s.p) && s.p[i] !== '' && s.p[i] != null ? Number(s.p[i]) : null; return P_OK[v] ? v : null; });
  return { p, n: String(s.n || '').slice(0, 600) };
}
/** Bản chụp điểm lúc chốt (máy CRM tính): chỉ giữ số, chữ ngắn. */
function cleanSnap(s) {
  s = s && typeof s === 'object' ? s : {};
  const num = v => Math.round((Number(v) || 0) * 10) / 10;
  const items = (Array.isArray(s.items) ? s.items : []).slice(0, 12).map(r => ({ k: String(r.k || '').slice(0, 20), t: String(r.t || '').slice(0, 80), w: num(r.w), v: r.v == null ? null : num(r.v), sc: r.sc == null ? null : num(r.sc), txt: String(r.txt || '').slice(0, 160) }));
  return { tot: num(s.tot), gr: /^[ABCD]$/.test(s.gr) ? s.gr : '', why: String(s.why || '').slice(0, 300), items };
}
const outRow = r => ({ month: r.month, name: r.name, mgr: parse(r.mgr), mgrBy: r.mgr_by || '', mgrAt: r.mgr_at || 0, snap: parse(r.snap), done: !!r.done, doneBy: r.done_by || '', doneAt: r.done_at || 0 });

/** sale_kpi {op}: list {month} · mgr {month, name, s, done, snap} (Quản lý / Quản trị) · reopen {month, name}. Sale chỉ đọc phiếu của mình. */
export async function crmSaleKpi(x, u, d, log) {
  const mgr = u.level >= 2;
  if (!mgr) return { ok: false, error: 'Phiếu KPI sale tạm chỉ Quản lý và Quản trị xem.' }; // 20/11/2026 anh Sơn: sale chưa thấy phiếu
  await ksSchema(x.db);
  const op = String(d.op || 'list'), now = Date.now(), month = String(d.month || '');
  if (!MON.test(month)) return { ok: false, error: 'Chọn tháng.' };
  const list = async () => {
    const R = await all(x.db, 'SELECT * FROM kpi_sale WHERE month = ?' + (mgr ? '' : ' AND name = ?'), ...(mgr ? [month] : [month, u.name]));
    return { ok: true, month, rows: R.map(outRow), can: { mgr } };
  };
  if (op === 'list') return list();
  if (!mgr) return { ok: false, error: 'Chỉ Quản lý và Quản trị chấm được.' };
  const name = String(d.name || '').trim(); if (!name) return { ok: false, error: 'Chọn sale.' };
  const id = month + '|' + name, row = (await all(x.db, 'SELECT * FROM kpi_sale WHERE id = ?', id))[0];
  if (op === 'mgr') {
    if (row && row.done) return { ok: false, error: 'Tháng này đã chốt. Bấm 🔓 Mở lại trước khi sửa.' };
    const s = clean(d.s);
    if (d.done && s.p.some(v => v == null)) return { ok: false, error: 'Chấm đủ 2 mục của quản lý rồi mới chốt.' };
    if (!row) await run(x.db, 'INSERT OR IGNORE INTO kpi_sale (id, month, name) VALUES (?, ?, ?)', id, month, name);
    await run(x.db, 'UPDATE kpi_sale SET mgr = ?, mgr_by = ?, mgr_at = ?, snap = ?, done = ?, done_by = ?, done_at = ? WHERE id = ?',
      JSON.stringify(s), u.name, now, d.done ? JSON.stringify(cleanSnap(d.snap)) : '', d.done ? 1 : 0, d.done ? u.name : '', d.done ? now : null, id);
    await log(x, u, 'Hiệu quả', '-', '', (d.done ? 'Chốt' : 'Chấm') + ' KPI sale ' + name + ' tháng ' + month + (d.sum ? ': ' + String(d.sum).slice(0, 80) : ''), '');
    return list();
  }
  if (op === 'reopen') {
    if (!row) return { ok: false, error: 'Chưa có phiếu tháng này.' };
    await run(x.db, "UPDATE kpi_sale SET done = 0, done_by = '', done_at = NULL, snap = '' WHERE id = ?", id);
    await log(x, u, 'Hiệu quả', '-', '', 'Mở lại KPI sale ' + name + ' tháng ' + month, '');
    return list();
  }
  return { ok: false, error: 'Không rõ thao tác: ' + op };
}
