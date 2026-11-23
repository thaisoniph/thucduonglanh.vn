/**
 * 🏪 Kênh đại lý – đợt 1 (23/11/2026, anh Sơn duyệt phương án 3 bậc 30 / 35 / 40%).
 *
 * - Danh sách đại lý ở kv `dl_list` {sđt: {name, area, by, at, fix, note}} (ít người, không cần bảng mới).
 *   fix = 0: bậc tự tính theo tiền hàng (giá lẻ) tháng trước; 1–3: quản lý giữ cố định bậc đó.
 * - Mức ở kv `dl_cfg` (Quản trị sửa ở Cài đặt → 🏪 Đại lý): 3 bậc {name, pct, min}, đơn đầu tối thiểu, thưởng sale giới thiệu.
 * - Đơn của đại lý: người bán = DL_SELLER ("Kênh đại lý") → tự đứng ngoài doanh số / hoa hồng / thi đua / mục tiêu của từng sale.
 *   Giá lẻ của từng đơn nhớ ở kv `dl_ord` {mã đơn: {ph, l (tiền hàng giá lẻ), p (% chiết khấu)}} để tính bậc theo giá lẻ.
 * - Sale giới thiệu được đại lý (dl_list.by) → thưởng `bonus`% tiền nhập (đã trừ chiết khấu, không gồm ship) trong `bonusMonths` tháng từ đơn đầu.
 */
import { all, kvJson, kvSet, normPhone, fmt, fmtDate, isVoid, DAY } from './lib.js';
import { staffOf, staffHit } from './partner.js';

export const DL_SELLER = 'Kênh đại lý';
const CFG_DEF = {
  tiers: [{ name: 'Đại lý', pct: 30, min: 5000000 }, { name: 'Đại lý Bạc', pct: 35, min: 15000000 }, { name: 'Nhà phân phối tỉnh', pct: 40, min: 50000000 }],
  first: 5000000, top3: 3, bonus: 3, bonusMonths: 3
};
const COMPANY = { name: 'CÔNG TY TNHH TẬP ĐOÀN VITAGREEN NUTRITION', mst: '0111053409', addr: 'HA10-SP8A-15, Đường Hải Âu 8A, KĐT Vinhomes Ocean Park, Gia Lâm, TP. Hà Nội', hotline: '0966 326 522', rep: 'Nguyễn Văn Hiếu', repTitle: 'Giám đốc' };

export async function dlCfg(x) {
  const c = Object.assign({}, CFG_DEF, await kvJson(x.db, 'dl_cfg', null) || {});
  c.tiers = (Array.isArray(c.tiers) && c.tiers.length === 3 ? c.tiers : CFG_DEF.tiers).map((t, i) => ({ name: String(t.name || CFG_DEF.tiers[i].name), pct: Number(t.pct) || 0, min: Math.round(Number(t.min) || 0) }));
  return c;
}
export async function dlList(x) { return await kvJson(x.db, 'dl_list', null) || {}; }
async function dlOrd(x) { return await kvJson(x.db, 'dl_ord', null) || {}; }

/** Tháng (giờ VN) của 1 mốc thời gian: 'yyyy-MM'. */
const ym = t => fmtDate(t, 'yyyy-MM');
const ymShift = (k, n) => { let [y, m] = k.split('-').map(Number); m += n; while (m < 1) { m += 12; y--; } while (m > 12) { m -= 12; y++; } return y + '-' + String(m).padStart(2, '0'); };

/** Đơn của kênh đại lý (đã trừ huỷ / hoàn), kèm tiền giá lẻ. */
async function dlOrders(x) {
  const O = await dlOrd(x);
  const rows = await all(x.db, 'SELECT id, phone, time, total, shipping, subtotal, status, note FROM orders WHERE seller = ? ORDER BY time', DL_SELLER);
  return rows.filter(r => !isVoid(r.status) && !/hoàn/i.test(String(r.status || ''))).map(r => {
    const o = O[r.id] || {}, paid = Math.max(0, (Number(r.total) || 0) - (Number(r.shipping) || 0)), p = Number(o.p) || 0;
    return { id: r.id, ph: r.phone, t: Number(r.time) || 0, total: Number(r.total) || 0, paid, list: Number(o.l) || (p < 100 ? Math.round(paid / (1 - p / 100)) : paid), pct: p, status: r.status };
  });
}

/** Bậc đang áp dụng (1–3) của 1 đại lý trong tháng `k` theo tiền giá lẻ các tháng trước. */
function tierOf(cfg, e, byMonth, k) {
  if (Number(e.fix) >= 1 && Number(e.fix) <= 3) return Number(e.fix);
  const T = cfg.tiers, prev = byMonth[ymShift(k, -1)] || 0;
  let ok3 = true; for (let i = 1; i <= Math.max(1, cfg.top3); i++) if ((byMonth[ymShift(k, -i)] || 0) < T[2].min) ok3 = false;
  if (ok3) return 3;
  if (prev >= T[1].min) return 2;
  return 1;
}

/** Bản gọn cho mọi nhân sự (gửi kèm lệnh load): form lên đơn tự nhận ra đại lý và trừ chiết khấu. */
export async function dlMap(x) {
  const L = await dlList(x), keys = Object.keys(L); if (!keys.length) return {};
  const cfg = await dlCfg(x), os = await dlOrders(x), k = ym(Date.now()), out = {};
  keys.forEach(ph => {
    const mine = os.filter(o => o.ph === ph), bm = {}; mine.forEach(o => { const mk = ym(o.t); bm[mk] = (bm[mk] || 0) + o.list; });
    const tr = tierOf(cfg, L[ph], bm, k), T = cfg.tiers[tr - 1];
    out[ph] = { tier: tr, name: T.name, pct: T.pct, firstMin: mine.length ? 0 : cfg.first, shop: L[ph].name || '' };
  });
  return out;
}

/** Gọi trong lúc tạo đơn: khách là đại lý → kiểm tra giá, trả % chiết khấu. null = không phải đại lý. */
export async function dlOrderCheck(x, u, phone, items, sub, ship) {
  const L = await dlList(x); if (!L[phone]) return null;
  const m = (await dlMap(x))[phone], list = items.filter(i => !i.gift).reduce((s, i) => s + (Number(i.price) || 0) * (Number(i.qty) || 0), 0);
  if (!list) return { error: 'Đơn đại lý cần sản phẩm có giá niêm yết (chọn sản phẩm trong danh sách gợi ý) để CRM trừ chiết khấu.' };
  const want = Math.round(list * (1 - m.pct / 100));
  if (u.level < 2 && sub < want - 1000) return { error: 'Tiền hàng ' + fmt(sub) + ' thấp hơn giá đại lý ' + m.name + ' (giá lẻ ' + fmt(list) + ' − ' + m.pct + '% = ' + fmt(want) + '). Muốn giảm thêm thì nhờ quản lý lên đơn.' };
  if (u.level < 2 && m.firstMin && list < m.firstMin) return { error: 'Đại lý nhập lần đầu tối thiểu ' + fmt(m.firstMin) + ' (tính theo giá lẻ). Đơn này giá lẻ ' + fmt(list) + '. Thêm hàng, hoặc nhờ quản lý lên đơn.' };
  return { list, pct: m.pct, tierName: m.name, want, note: '🏪 Đơn đại lý ' + m.name + ' −' + m.pct + '% (giá lẻ ' + fmt(list) + ') · ' + u.name + ' lên đơn' };
}
/** Ghi giá lẻ của đơn đại lý vừa tạo. */
export async function dlOrderSave(x, id, phone, chk) {
  const O = await dlOrd(x); O[id] = { ph: phone, l: chk.list, p: chk.pct };
  await kvSet(x.db, 'dl_ord', JSON.stringify(O));
}

/** Màn 🏪 Đại lý: danh sách, bậc, tiền theo tháng, thưởng sale giới thiệu. */
async function dlView(x, u) {
  const cfg = await dlCfg(x), L = await dlList(x), os = await dlOrders(x), now = Date.now(), k = ym(now), kp = ymShift(k, -1);
  const phones = Object.keys(L), cs = phones.length ? await all(x.db, 'SELECT phone, name, province FROM customers WHERE phone IN (SELECT value FROM json_each(?))', JSON.stringify(phones)) : [], C = {};
  cs.forEach(c => { C[c.phone] = c; });
  const bonusOf = {}; // {tháng: {sale: tiền}}
  const list = phones.map(ph => {
    const e = L[ph], mine = os.filter(o => o.ph === ph), bm = {}, pm = {};
    mine.forEach(o => { const mk = ym(o.t); bm[mk] = (bm[mk] || 0) + o.list; pm[mk] = (pm[mk] || 0) + o.paid; });
    const tr = tierOf(cfg, e, bm, k), T = cfg.tiers[tr - 1], next = tierOf(cfg, Object.assign({}, e, { fix: 0 }), bm, ymShift(k, 1)), first0 = mine.length ? mine[0].t : 0;
    if (e.by && first0) mine.forEach(o => { if (o.t < first0 + cfg.bonusMonths * 30.5 * DAY) { const mk = ym(o.t); (bonusOf[mk] = bonusOf[mk] || {})[e.by] = ((bonusOf[mk] || {})[e.by] || 0) + Math.round(o.paid * cfg.bonus / 100); } });
    const last = mine.length ? mine[mine.length - 1].t : 0;
    return { ph, name: e.name || (C[ph] && C[ph].name) || '', cname: (C[ph] && C[ph].name) || '', area: e.area || (C[ph] && C[ph].province) || '', by: e.by || '', at: e.at || 0, fix: Number(e.fix) || 0, note: e.note || '',
      tier: tr, tierName: T.name, pct: T.pct, nextTier: next, thisList: bm[k] || 0, thisPaid: pm[k] || 0, prevList: bm[kp] || 0, allPaid: mine.reduce((s, o) => s + o.paid, 0), n: mine.length, first: first0, last, idle: last ? Math.floor((now - last) / DAY) : null,
      months: Object.keys(bm).sort().slice(-6).map(mk => [mk, bm[mk], pm[mk]]) };
  }).sort((a, b) => b.thisPaid - a.thisPaid || b.allPaid - a.allPaid);
  const sum = { n: list.length, thisPaid: list.reduce((s, r) => s + r.thisPaid, 0), prevPaid: os.filter(o => ym(o.t) === kp).reduce((s, o) => s + o.paid, 0), orders: os.filter(o => ym(o.t) === k).length };
  return { ok: true, cfg, list, sum, month: k, prev: kp, bonus: { [k]: bonusOf[k] || {}, [kp]: bonusOf[kp] || {} }, company: COMPANY, canCfg: u.level >= 3 };
}

export async function crmDaily(x, u, d, log, staffNames) {
  const a = d.action;
  if (a === 'dl_list') { if (u.level < 2) return { ok: false, error: 'Chỉ Quản lý và Quản trị xem danh sách đại lý.' }; return dlView(x, u); }
  if (a === 'dl_save') {
    if (u.level < 2) return { ok: false, error: 'Chỉ Quản lý và Quản trị thêm / sửa đại lý.' };
    const ph = normPhone(d.phone); if (!/^0\d{9,10}$/.test(ph)) return { ok: false, error: 'Số điện thoại chưa đúng (10 số, bắt đầu bằng 0).' };
    const L = await dlList(x), old = L[ph], name = String(d.name || '').trim().slice(0, 120);
    if (!name) return { ok: false, error: 'Nhập tên đại lý / cửa hàng.' };
    const by = String(d.by || '').trim(); if (by && staffNames.indexOf(by) < 0) return { ok: false, error: 'Người giới thiệu phải là nhân sự trong CRM.' };
    const fix = Math.round(Number(d.fix) || 0);
    const sw = staffHit(await staffOf(x), { phone: ph, name: d.cname || '' });
    if (sw && !d.okStaff) return { ok: false, warn: 1, error: sw + '. Nhân sự và người nhà không làm đại lý (giống luật CTV). Vẫn thêm thì bấm lại.' };
    L[ph] = { name, area: String(d.area || '').trim().slice(0, 120), by, fix: fix >= 1 && fix <= 3 ? fix : 0, note: String(d.note || '').trim().slice(0, 300), at: old ? old.at : Date.now(), atBy: old ? old.atBy : u.name };
    if (d.oldPhone && normPhone(d.oldPhone) !== ph) delete L[normPhone(d.oldPhone)];
    await kvSet(x.db, 'dl_list', JSON.stringify(L));
    await log(x, u, old ? 'Sửa đại lý' : 'Thêm đại lý', ph, name, L[ph].fix ? 'giữ bậc ' + L[ph].fix : 'bậc tự theo tháng trước', by ? 'sale giới thiệu: ' + by : '');
    return dlView(x, u);
  }
  if (a === 'dl_del') {
    if (u.level < 2) return { ok: false, error: 'Chỉ Quản lý và Quản trị bỏ đại lý.' };
    const ph = normPhone(d.phone), L = await dlList(x); if (!L[ph]) return dlView(x, u);
    const nm = L[ph].name; delete L[ph]; await kvSet(x.db, 'dl_list', JSON.stringify(L));
    await log(x, u, 'Bỏ đại lý', ph, nm, 'đơn cũ giữ ở kênh đại lý', '');
    return dlView(x, u);
  }
  if (a === 'dl_cfg') {
    if (u.level < 3) return { ok: false, error: 'Chỉ Quản trị đổi mức chiết khấu đại lý.' };
    const t = Array.isArray(d.tiers) ? d.tiers.slice(0, 3) : [];
    if (t.length !== 3) return { ok: false, error: 'Cần đủ 3 bậc.' };
    const tiers = t.map((r, i) => ({ name: String(r.name || CFG_DEF.tiers[i].name).trim().slice(0, 40), pct: Number(r.pct), min: Math.round(Number(r.min) || 0) }));
    if (tiers.some(r => !(r.pct >= 0 && r.pct <= 60))) return { ok: false, error: 'Chiết khấu mỗi bậc 0–60%.' };
    if (!(tiers[1].min > tiers[0].min && tiers[2].min > tiers[1].min)) return { ok: false, error: 'Mức nhập của bậc sau phải cao hơn bậc trước.' };
    if (!(tiers[1].pct >= tiers[0].pct && tiers[2].pct >= tiers[1].pct)) return { ok: false, error: 'Chiết khấu bậc sau không thấp hơn bậc trước.' };
    const firstMin = Math.round(Number(d.first) || 0), bonus = Number(d.bonus), bonusMonths = Math.round(Number(d.bonusMonths)), top3 = Math.round(Number(d.top3));
    if (!(firstMin >= 0) || !(bonus >= 0 && bonus <= 10) || !(bonusMonths >= 0 && bonusMonths <= 24) || !(top3 >= 1 && top3 <= 12)) return { ok: false, error: 'Kiểm tra lại: thưởng sale 0–10%, 0–24 tháng; số tháng liền để lên bậc 3 từ 1–12.' };
    await kvSet(x.db, 'dl_cfg', JSON.stringify({ tiers, first: firstMin, bonus, bonusMonths, top3 }));
    await log(x, u, 'Cài đặt đại lý', '', '', tiers.map(r => r.name + ' ' + r.pct + '% từ ' + fmt(r.min)).join(' · '), 'đơn đầu ' + fmt(firstMin) + ' · thưởng sale ' + bonus + '% ' + bonusMonths + ' tháng');
    return dlView(x, u);
  }
  return { ok: false, error: 'Không rõ thao tác: ' + a };
}
