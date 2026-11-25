/**
 * 🏪 Kênh đại lý – đợt 1 (23/11/2026, anh Sơn duyệt phương án 3 bậc 30 / 35 / 40%).
 *
 * - Danh sách đại lý ở kv `dl_list` {sđt: {name, area, by, at, fix, note}} (ít người, không cần bảng mới).
 *   fix = 0: bậc tự tính theo tiền hàng (giá lẻ) tháng trước; 1–3: quản lý giữ cố định bậc đó.
 * - Mức ở kv `dl_cfg` (Quản trị sửa ở Cài đặt → 🏪 Đại lý): 3 bậc {name, pct, min}, đơn đầu tối thiểu, thưởng sale giới thiệu.
 * - Đơn của đại lý: người bán = DL_SELLER ("Kênh đại lý") → tự đứng ngoài doanh số / hoa hồng / thi đua / mục tiêu của từng sale.
 *   Giá lẻ của từng đơn nhớ ở kv `dl_ord` {mã đơn: {ph, l (tiền hàng giá lẻ), p (% chiết khấu)}} để tính bậc theo giá lẻ.
 * - Đợt 2 (23/11/2026): người ngoài đăng ký ở thucduonglanh.vn/dai-ly/ (build.py page_dl_join → dlApply) → kv `dl_apps` [{id, at, name, phone, shop, area, kind, plan, note, src, st}]
 *   → báo Telegram → người phụ trách (dl_cfg.lead) gọi làm quen rồi Duyệt (dl_save kèm appId) / Từ chối (dl_app_no) ở Cài đặt → 🏪 Đại lý.
 * - Đợt 3 (23/11/2026): đại lý tự đặt hàng bằng link riêng thucduonglanh.vn/dai-ly/dat-hang/#<key> (dl_list[sđt].key, CRM nút 🔗 → dl_key).
 *   Giá lẻ đọc từ /dl-gia.json (build.py dl_prices: chỉ hộp / chai lẻ, không combo) → máy chủ tự tính, trang web không gửi giá.
 *   dlMe (xem bậc, giá, đơn cũ) · dlOrderWeb (tạo đơn: người bán Kênh đại lý, trạng thái Mới, chuyển khoản trước) → báo Telegram nhóm + người phụ trách.
 * - Chiết khấu riêng từng sản phẩm theo giá vốn (24/11/2026): trần % = 100 − giá vốn / giá lẻ − dl_cfg.keep (lãi gộp tối thiểu % giá lẻ, mặc định 25).
 *   Giá vốn từ kv cost_cfg (💰 Giá vốn, Quản trị / Kế toán nhập). % từng sản phẩm = min(% bậc, trần). Chưa có giá vốn → theo bậc.
 *   dlCaps → {'loại|trọng lượng': %, 'loại': % thấp nhất của loại} gửi CRM (rules.dlCaps, không gửi giá vốn) để form lên đơn tính giống máy chủ.
 * - Sale giới thiệu được đại lý (dl_list.by) → thưởng `bonus`% tiền nhập (đã trừ chiết khấu, không gồm ship) trong `bonusMonths` tháng từ đơn đầu.
 */
import { all, first, kvGet, kvJson, kvSet, normPhone, fmt, fmtDate, isVoid, esc, DAY, nrm } from './lib.js';
import { staffOf, staffHit } from './partner.js';
import { telegram } from './google.js';

export const DL_SELLER = 'Kênh đại lý';
const CFG_DEF = {
  tiers: [{ name: 'Đại lý', pct: 30, min: 5000000 }, { name: 'Đại lý Bạc', pct: 35, min: 15000000 }, { name: 'Nhà phân phối tỉnh', pct: 40, min: 50000000 }],
  first: 5000000, top3: 3, bonus: 3, bonusMonths: 3, lead: 'Thủy', selfMin: 1000000, // selfMin: mỗi đơn đại lý tự đặt trên web tối thiểu (giá lẻ)
  keep: 25 // keep: công ty giữ lãi gộp tối thiểu bao nhiêu % giá lẻ ở mọi sản phẩm (giới hạn chiết khấu theo giá vốn)
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

/* ---- 💰 chiết khấu riêng từng sản phẩm theo giá vốn (24/11/2026) */
// Loại sản phẩm: cùng COST_FAM (crm/app.js costKey) và FAM (kho.js khoKey). Thêm dòng sản phẩm mới thì thêm cả 3 nơi.
const DL_FAM = [[/(forganic|foganic).*thay the|thay the.*(forganic|foganic)/, 'fbt'], [/forganic|foganic/, 'fdd'], [/progomax|fucoidan pro\b/, 'pgm'], [/curcumin|cucumin/, 'cur'], [/fucoidan|gafo/, 'gafo'], [/bua an|\bdd\b|dinh duong vitagreen/, 'bua'], [/dilvang|che vang|dinh lang/, 'dil'], [/xi dau/, 'xd'], [/mam xoi/, 'mx'], [/dau xanh|rau ma/, 'dx'], [/ruoc|rong bien/, 'ruoc']];
export function dlKey(t) {
  const n = nrm(t); let f = null; DL_FAM.some(r => { if (r[0].test(n)) { f = r[1]; return true; } return false; });
  let w = n.match(/(\d+)\s*(g|ml)\b/), m = 1; const a = n.match(/mua (\d+) tang (\d+)/), c = n.match(/combo (\d+)/), g = !/hop/.test(n) && n.match(/(\d+)\s*goi\s*[*x×]?\s*(25)\s*g/);
  if (a) m = +a[1] + +a[2]; else if (c) m = +c[1]; if (g) { m *= +g[1]; w = [0, g[2]]; }
  return { f, w: w ? +w[1] : 0, m };
}
/** Giá vốn 1 đơn vị (đúng cỡ → cỡ gần nhất lệch ≤ 30% → loại chỉ có 1 dòng thì lấy dòng đó). 0 = chưa có. */
function unitCost(M, k) {
  const F = k.f && M[k.f]; if (!F) return 0;
  const ws = Object.keys(F).map(Number); if (F[k.w]) return F[k.w];
  let b = 0, d = 1e9; ws.forEach(x => { const e = Math.abs(x - k.w); if (x && k.w && e < d) { d = e; b = x; } });
  if (b && d <= 0.3 * b) return F[b];
  return ws.length === 1 ? F[ws[0]] : 0;
}
async function costMap(x) {
  const C = await kvJson(x.db, 'cost_cfg', null), M = {}; if (!C || !Array.isArray(C.items)) return M;
  C.items.forEach(r => { const k = dlKey(r[0]); if (k.f) (M[k.f] = M[k.f] || {})[k.w] = Math.round(Number(r[1]) * (1 + (Number(C.oh) || 0) / 100)); });
  return M;
}
/** Bảng sản phẩm lẻ (dl-gia.json) kèm giá vốn và trần % chiết khấu. full = trả cả giá vốn (chỉ màn Quản trị). */
async function dlCapList(x, cfg, items) {
  const M = await costMap(x);
  return (items || await dlPrices(x)).map(i => {
    const k = dlKey(i.name + ' ' + i.variant), cost = unitCost(M, k) * k.m;
    const cap = cost && i.price ? Math.max(0, Math.min(100, Math.floor(100 - cost * 100 / i.price - cfg.keep))) : null;
    return Object.assign({}, i, { f: k.f, w: k.w, cost, cap });
  });
}
/** {'f|w': trần %, 'f': trần thấp nhất của loại} cho CRM + máy chủ. */
export async function dlCaps(x, cfg) {
  const out = {}; (await dlCapList(x, cfg || await dlCfg(x))).forEach(i => { if (i.cap == null || !i.f) return; out[i.f + '|' + i.w] = Math.min(i.cap, out[i.f + '|' + i.w] ?? 100); out[i.f] = Math.min(i.cap, out[i.f] ?? 100); });
  return out;
}
/** % chiết khấu của 1 dòng hàng: min(% bậc, trần của sản phẩm). */
export function dlPctOf(caps, tierPct, name) {
  const k = dlKey(name), c = caps[k.f + '|' + k.w] ?? caps[k.f];
  return c == null ? tierPct : Math.min(tierPct, c);
}

/** Bản gọn cho mọi nhân sự (gửi kèm lệnh load): form lên đơn tự nhận ra đại lý và trừ chiết khấu. */
export async function dlMap(x) {
  const L = await dlList(x), keys = Object.keys(L); if (!keys.length) return {};
  const cfg = await dlCfg(x), os = await dlOrders(x), k = ym(Date.now()), out = {};
  keys.forEach(ph => {
    const mine = os.filter(o => o.ph === ph), bm = {}; mine.forEach(o => { const mk = ym(o.t); bm[mk] = (bm[mk] || 0) + o.list; });
    const tr = tierOf(cfg, L[ph], bm, k), T = cfg.tiers[tr - 1];
    out[ph] = { tier: tr, name: T.name, pct: T.pct, firstMin: mine.length ? 0 : cfg.first, shop: L[ph].name || '', lead: cfg.lead || '' };
  });
  return out;
}

/** Gọi trong lúc tạo đơn: khách là đại lý → kiểm tra giá, trả % chiết khấu. null = không phải đại lý. */
export async function dlOrderCheck(x, u, phone, items, sub, ship) {
  const L = await dlList(x); if (!L[phone]) return null;
  const m = (await dlMap(x))[phone], caps = await dlCaps(x), real = items.filter(i => !i.gift), list = real.reduce((s, i) => s + (Number(i.price) || 0) * (Number(i.qty) || 0), 0);
  if (!list) return { error: 'Đơn đại lý cần sản phẩm có giá niêm yết (chọn sản phẩm trong danh sách gợi ý) để CRM trừ chiết khấu.' };
  const want = Math.round(real.reduce((s, i) => s + (Number(i.price) || 0) * (Number(i.qty) || 0) * (1 - dlPctOf(caps, m.pct, i.name + ' ' + (i.variant || '')) / 100), 0)), eff = Math.round((list - want) * 1000 / list) / 10;
  if (u.level < 2 && sub < want - 1000) return { error: 'Tiền hàng ' + fmt(sub) + ' thấp hơn giá đại lý ' + m.name + ' (giá lẻ ' + fmt(list) + ', chiết khấu ' + (eff === m.pct ? m.pct + '%' : 'theo từng sản phẩm, bình quân ' + String(eff).replace('.', ',') + '%') + ' = ' + fmt(want) + '). Muốn giảm thêm thì nhờ ' + (m.lead ? 'chị ' + m.lead + ' (phụ trách đại lý)' : 'quản lý') + ' lên đơn.' };
  if (u.level < 2 && m.firstMin && list < m.firstMin) return { error: 'Đại lý nhập lần đầu tối thiểu ' + fmt(m.firstMin) + ' (tính theo giá lẻ). Đơn này giá lẻ ' + fmt(list) + '. Thêm hàng, hoặc nhờ ' + (m.lead ? 'chị ' + m.lead + ' (phụ trách đại lý)' : 'quản lý') + ' lên đơn.' };
  return { list, pct: eff, tierName: m.name, want, note: '🏪 Đơn đại lý ' + m.name + ' −' + (eff === m.pct ? m.pct + '%' : String(eff).replace('.', ',') + '% (riêng từng sản phẩm theo giá vốn)') + ' (giá lẻ ' + fmt(list) + ') · ' + u.name + ' lên đơn' };
}
/** Ghi giá lẻ của đơn đại lý vừa tạo. */
export async function dlOrderSave(x, id, phone, chk) {
  const O = await dlOrd(x); O[id] = { ph: phone, l: chk.list, p: chk.pct };
  await kvSet(x.db, 'dl_ord', JSON.stringify(O));
}

async function dlApps(x) { const a = await kvJson(x.db, 'dl_apps', null); return Array.isArray(a) ? a : []; }
export async function dlAppsNew(x) { return (await dlApps(x)).filter(r => r.st === 'new').length; } // số đăng ký chờ duyệt (Cài đặt → 🏪, Tổng quan)
/** 📝 Đăng ký làm đại lý từ web /dai-ly/ (không cần đăng nhập). Chống spam: 5 lần / giờ / IP + ô bẫy "website". */
export async function dlApply(x, d) {
  if (d.website) return { ok: true };
  const fk = 'dla_' + String(x.ip || 'x').slice(0, 60), n = Number(await kvGet(x.db, fk)) || 0;
  if (n >= 5) return { ok: false, error: 'Bạn gửi nhiều lần quá. Thử lại sau 1 giờ, hoặc nhắn Zalo 0966 326 522 nhé.' };
  const t = (v, m) => String(v || '').trim().slice(0, m), name = t(d.name, 80), phone = normPhone(d.phone);
  if (name.length < 2) return { ok: false, error: 'Bạn nhập họ tên giúp nhé.' };
  if (!/^0\d{9,10}$/.test(phone)) return { ok: false, error: 'Số điện thoại chưa đúng, bạn kiểm tra lại giúp nhé.' };
  if (!t(d.area, 80)) return { ok: false, error: 'Bạn cho biết tỉnh / thành bạn bán hàng giúp nhé.' };
  if (!d.agree) return { ok: false, error: 'Bạn đọc chính sách và đánh dấu ô đồng ý giúp nhé.' };
  await kvSet(x.db, fk, n + 1, 60 * 60e3);
  if ((await dlList(x))[phone]) return { ok: true, already: 'dl', msg: 'Số này đã là đại lý của chúng tôi. Cần nhập hàng, bạn nhắn Zalo 0966 326 522 nhé.' };
  const A = await dlApps(x);
  if (A.some(r => r.phone === phone && r.st === 'new')) return { ok: true, already: 'wait', msg: 'Chúng tôi đã nhận đăng ký của số này và đang xem. Người phụ trách đại lý sẽ gọi hoặc nhắn Zalo cho bạn trong 1–2 ngày làm việc.' };
  const row = { id: Date.now().toString(36) + Math.random().toString(36).slice(2, 5), at: Date.now(), name, phone, shop: t(d.shop, 120), area: t(d.area, 80), kind: t(Array.isArray(d.kind) ? d.kind.join(', ') : d.kind, 200), plan: t(d.plan, 60), note: t(d.note, 500), src: t(d.source, 200), st: 'new' };
  A.unshift(row); await kvSet(x.db, 'dl_apps', JSON.stringify(A.slice(0, 300)));
  const cfg = await dlCfg(x), c = await first(x.db, 'SELECT orders, owner FROM customers WHERE phone = ?', phone), sw = staffHit(await staffOf(x), { phone, name });
  x.later(telegram(x.env, '🏪 <b>ĐĂNG KÝ ĐẠI LÝ</b>\n👤 ' + esc(name) + ' – <b>' + esc(phone) + '</b> · ' + esc(row.area) + (row.shop ? '\n🏬 ' + esc(row.shop) : '') + (row.kind ? '\n📣 Bán qua: ' + esc(row.kind) : '') + (row.plan ? '\n📦 Dự kiến nhập: ' + esc(row.plan) + '/tháng' : '') + (row.note ? '\n💬 ' + esc(row.note) : '') +
    (c ? '\n🛒 Đã là khách: ' + (c.orders || 0) + ' đơn' + (c.owner ? ' · sale ' + esc(c.owner) : '') : '') + (sw ? '\n' + esc(sw) + ' (nhân sự và người nhà không làm đại lý)' : '') +
    '\n👉 ' + (cfg.lead ? 'Chị ' + esc(cfg.lead) + ' g' : 'G') + 'ọi / Zalo làm quen rồi Duyệt ở CRM → Cài đặt → 🏪 Đại lý'));
  return { ok: true };
}

/* ================================================================ 🛒 đợt 3: đại lý tự đặt hàng bằng link riêng */
export const DL_ORDER_URL = 'https://thucduonglanh.vn/dai-ly/dat-hang/';
function newKey() { return [...crypto.getRandomValues(new Uint8Array(12))].map(b => b.toString(16).padStart(2, '0')).join(''); }
/** Bảng giá lẻ do build.py ghi ra (/dl-gia.json). SITE_URL (wrangler dev) để thử trên máy. */
async function dlPrices(x) {
  try {
    const r = await fetch((x.env.SITE_URL || 'https://thucduonglanh.vn') + '/dl-gia.json', { cf: { cacheTtl: 300, cacheEverything: true } });
    if (r.ok) { const j = await r.json(); if (Array.isArray(j.items)) return j.items; }
  } catch (e) { console.error('dl-gia.json', e.message); }
  return [];
}
/** Link sai nhiều lần → khoá 15 phút theo IP (chống dò link). */
async function dlByKey(x, key) {
  const fk = 'dlkf_' + String(x.ip || 'x').slice(0, 60), fails = Number(await kvGet(x.db, fk)) || 0;
  if (fails >= 10) return { err: 'Bạn mở sai link nhiều lần. Thử lại sau 15 phút nhé.' };
  const k = String(key || '').replace(/[^a-f0-9]/g, ''), L = await dlList(x), ph = k.length >= 20 ? Object.keys(L).find(p => L[p].key === k) : null;
  if (!ph) { await kvSet(x.db, fk, fails + 1, 15 * 60e3); return { err: 'Link không đúng hoặc đã được đổi. Bạn nhắn Zalo 0966 326 522 để xin link mới nhé.', bad: true }; }
  return { ph, e: L[ph], L };
}
/** Bậc + tiền giá lẻ tháng này / tháng trước của 1 đại lý. */
async function dlState(x, ph, e) {
  const cfg = await dlCfg(x), os = (await dlOrders(x)).filter(o => o.ph === ph), bm = {}, k = ym(Date.now());
  os.forEach(o => { const mk = ym(o.t); bm[mk] = (bm[mk] || 0) + o.list; });
  const tr = tierOf(cfg, e, bm, k), T = cfg.tiers[tr - 1], next = tierOf(cfg, Object.assign({}, e, { fix: 0 }), bm, ymShift(k, 1));
  return { cfg, os, tier: tr, T, next, thisList: bm[k] || 0, prevList: bm[ymShift(k, -1)] || 0, firstMin: os.length ? 0 : cfg.first };
}
const dlUnit = (price, pct) => Math.round(price * (1 - pct / 100) / 100) * 100; // giá đại lý / 1 sản phẩm, làm tròn 100đ
/** Trang /dai-ly/dat-hang/: chào, bậc, bảng giá đại lý, địa chỉ nhận lần trước, đơn gần đây. */
export async function dlMe(x, d) {
  const b = await dlByKey(x, d.key); if (b.err) return { ok: false, bad: !!b.bad, error: b.err };
  const { ph, e } = b, st = await dlState(x, ph, e), caps = await dlCaps(x, st.cfg), items = await dlPrices(x);
  const last = await first(x.db, 'SELECT name, province, ward, address FROM orders WHERE phone = ? ORDER BY time DESC LIMIT 1', ph);
  const c = await first(x.db, 'SELECT name, province, address FROM customers WHERE phone = ?', ph);
  const rec = await all(x.db, 'SELECT id, time, total, status, payment, paid FROM orders WHERE phone = ? AND seller = ? ORDER BY time DESC LIMIT 12', ph, DL_SELLER);
  const T2 = st.cfg.tiers[1];
  return {
    ok: true, shop: e.name || '', name: (c && c.name) || (last && last.name) || e.name || '', phone: ph, lead: st.cfg.lead || '',
    tier: st.tier, tierName: st.T.name, pct: st.T.pct, nextTier: st.next, nextName: st.cfg.tiers[st.next - 1].name, nextPct: st.cfg.tiers[st.next - 1].pct, fixed: Number(e.fix) || 0,
    thisList: st.thisList, prevList: st.prevList, firstMin: st.firstMin, selfMin: st.cfg.selfMin, tiers: st.cfg.tiers, top3: st.cfg.top3, toT2: Math.max(0, T2.min - st.thisList),
    items: items.map(i => { const p = dlPctOf(caps, st.T.pct, i.name + ' ' + i.variant); return { id: i.id, name: i.name, variant: i.variant, img: i.img || '', price: i.price, pct: p, dl: dlUnit(i.price, p) }; }),
    addr: last ? { name: last.name, province: last.province || '', ward: last.ward || '', address: last.address || '' } : c ? { name: c.name, province: c.province || '', ward: '', address: c.address || '' } : null,
    orders: rec.map(o => ({ id: o.id, time: Number(o.time) || 0, total: Number(o.total) || 0, status: o.status || '', paid: o.paid || '' }))
  };
}
/** Đại lý bấm "Gửi đơn nhập hàng". h = { saveOrder, telegramUser, staff: [tên nhân sự] } (truyền từ index.js để không vòng import crm.js). */
export async function dlOrderWeb(x, d, h) {
  if (d.website) return { ok: true };
  const b = await dlByKey(x, d.key); if (b.err) return { ok: false, bad: !!b.bad, error: b.err };
  const { ph, e } = b, st = await dlState(x, ph, e), caps = await dlCaps(x, st.cfg), P = {}, now = Date.now();
  (await dlPrices(x)).forEach(i => { P[i.id] = i; });
  const want = (Array.isArray(d.items) ? d.items : []).slice(0, 40).map(i => ({ p: P[String(i.id || '')], qty: Math.round(Number(i.qty) || 0), id: i.id })).filter(i => i.qty > 0);
  if (!want.length) return { ok: false, error: 'Bạn chọn số lượng ít nhất 1 sản phẩm nhé.' };
  if (want.some(i => !i.p)) return { ok: false, error: 'Có sản phẩm vừa đổi giá hoặc ngừng bán. Bạn tải lại trang rồi đặt lại giúp nhé.' };
  if (want.some(i => i.qty > 2000)) return { ok: false, error: 'Số lượng lớn quá, bạn nhắn Zalo 0966 326 522 để đặt riêng nhé.' };
  const t = (v, m) => String(v || '').trim().replace(/\s+/g, ' ').slice(0, m), name = t(d.name, 80) || e.name, province = t(d.province, 60), ward = t(d.ward, 80), address = t(d.address, 200), note = t(d.note, 300);
  if (!province || address.length < 4) return { ok: false, error: 'Bạn ghi địa chỉ nhận hàng (số nhà, đường) và tỉnh / thành giúp nhé.' };
  const pct = st.T.pct, list = want.reduce((s, i) => s + i.p.price * i.qty, 0);
  const items = want.map(i => { const u1 = dlUnit(i.p.price, dlPctOf(caps, pct, i.p.name + ' ' + (i.p.variant || ''))); return { name: i.p.name, variant: i.p.variant || '', qty: i.qty, price: u1, subtotal: u1 * i.qty }; });
  const paid = items.reduce((s, i) => s + i.subtotal, 0), eff = Math.round((list - paid) * 1000 / list) / 10, effT = eff === pct ? pct + '%' : String(eff).replace('.', ',') + '% (riêng từng sản phẩm theo giá vốn)';
  if (st.firstMin && list < st.firstMin) return { ok: false, error: 'Lần nhập đầu tiên tối thiểu ' + fmt(st.firstMin) + ' (tính theo giá lẻ). Đơn này giá lẻ ' + fmt(list) + ', bạn thêm ' + fmt(st.firstMin - list) + ' nữa nhé.' };
  if (list < st.cfg.selfMin) return { ok: false, error: 'Mỗi đơn nhập tối thiểu ' + fmt(st.cfg.selfMin) + ' (tính theo giá lẻ) để được miễn phí ship. Đơn này giá lẻ ' + fmt(list) + '.' };
  const recent = await all(x.db, 'SELECT id, total, time FROM orders WHERE phone = ? AND seller = ? AND coalesce(entered_at, time) > ? ORDER BY time DESC', ph, DL_SELLER, now - DAY);
  const dup = recent.find(o => Number(o.total) === paid && Number(o.time) > now - 30 * 60e3);
  if (dup) return { ok: true, dup: true, id: dup.id, total: paid, list, pct: eff, off: list - paid };
  if (recent.length >= 5) return { ok: false, error: 'Hôm nay bạn đã gửi 5 đơn rồi. Cần đặt thêm, bạn nhắn Zalo 0966 326 522 nhé.' };
  let id = ''; for (let n = 0; n < 6 && !id; n++) { const c = 'DL' + fmtDate(now, 'yyMMdd') + Math.floor(1000 + Math.random() * 9000); if (!(await first(x.db, 'SELECT rid FROM orders WHERE id = ?', c))) id = c; }
  if (!id) return { ok: false, error: 'Máy chủ đang bận, bạn bấm gửi lại giúp nhé.' };
  const tag = '🏪 Đại lý tự đặt trên web · Đơn đại lý ' + st.T.name + ' −' + effT + ' (giá lẻ ' + fmt(list) + ')';
  await h.saveOrder(x, { id, customer: { name, phone: ph, province, district: ward, address, note: tag + (note ? ' · 💬 ' + note : '') }, items, subtotal: paid, shipping: 0, total: paid, payment: 'bank', source: 'Đại lý tự đặt (web)', first_source: 'Đại lý tự đặt (web)' },
    { by: DL_SELLER, status: 'Mới' });
  await dlOrderSave(x, id, ph, { list, pct: eff });
  const keeper = e.by || (h.staff.indexOf(st.cfg.lead) >= 0 ? st.cfg.lead : ''); // khách đại lý chưa có người chăm → sale giới thiệu, không thì người phụ trách đại lý
  if (keeper) await x.db.prepare("UPDATE customers SET owner = ? WHERE phone = ? AND (owner = '' OR owner IS NULL OR owner = ?)").bind(keeper, ph, DL_SELLER).run();
  const msg = '🏪 <b>ĐẠI LÝ TỰ ĐẶT HÀNG</b> – ' + esc(id) + '\n🏬 ' + esc(e.name || name) + ' – <b>' + esc(ph) + '</b> · ' + esc(st.T.name) + ' −' + esc(effT) + '\n' +
    items.map(i => '• ' + esc(i.name + (i.variant ? ' ' + i.variant : '')) + ' x' + i.qty).join('\n') +
    '\n💰 Giá lẻ ' + fmt(list) + ' → đại lý trả <b>' + fmt(paid) + '</b> (chuyển khoản trước, miễn ship)\n📍 ' + esc([address, ward, province].filter(Boolean).join(', ')) + (note ? '\n💬 ' + esc(note) : '') +
    '\n👉 ' + (st.cfg.lead ? 'Chị ' + esc(st.cfg.lead) + ' g' : 'G') + 'ọi xác nhận, kiểm tiền vào rồi đổi đơn sang Đã xác nhận để kho soạn hàng';
  x.later((async () => { await telegram(x.env, msg); if (st.cfg.lead && h.staff.indexOf(st.cfg.lead) >= 0) await h.telegramUser(x, st.cfg.lead, msg); })().catch(er => console.error('dl tg', er.message)));
  return { ok: true, id, total: paid, list, pct: eff, off: list - paid };
}

/** 🙋 Thưởng sale giới thiệu: bonus% tiền đại lý trả (không ship) các đơn trong bonusMonths tháng từ đơn đầu, gộp theo tháng của đơn. */
// 25/11/2026 (rà soát bảo mật): đơn 'Mới' = đại lý chưa chuyển tiền (chưa xác nhận) → chưa tính thưởng giới thiệu
function bonusAdd(out, cfg, e, mine) {
  const first0 = mine.length ? mine[0].t : 0; if (!e.by || !first0) return;
  mine.forEach(o => { if (o.t < first0 + cfg.bonusMonths * 30.5 * DAY && o.status !== 'Mới') { const mk = ym(o.t), m = out[mk] = out[mk] || {}; m[e.by] = (m[e.by] || 0) + Math.round(o.paid * cfg.bonus / 100); } });
}
/** Bảng lương (luong.js): thưởng giới thiệu đại lý của tháng `month` ('yyyy-MM') → {tên nhân sự: tiền}. Đơn huỷ / hoàn không tính. */
export async function dlBonusMonth(x, month) {
  const L = await dlList(x), phones = Object.keys(L).filter(ph => L[ph].by); if (!phones.length) return {};
  const cfg = await dlCfg(x), os = await dlOrders(x), out = {};
  phones.forEach(ph => bonusAdd(out, cfg, L[ph], os.filter(o => o.ph === ph)));
  return out[month] || {};
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
    bonusAdd(bonusOf, cfg, e, mine);
    const last = mine.length ? mine[mine.length - 1].t : 0;
    return { ph, name: e.name || (C[ph] && C[ph].name) || '', cname: (C[ph] && C[ph].name) || '', area: e.area || (C[ph] && C[ph].province) || '', by: e.by || '', at: e.at || 0, fix: Number(e.fix) || 0, note: e.note || '',
      tier: tr, tierName: T.name, pct: T.pct, nextTier: next, key: e.key || '', thisList: bm[k] || 0, thisPaid: pm[k] || 0, prevList: bm[kp] || 0, allPaid: mine.reduce((s, o) => s + o.paid, 0), n: mine.length, first: first0, last, idle: last ? Math.floor((now - last) / DAY) : null,
      months: Object.keys(bm).sort().slice(-6).map(mk => [mk, bm[mk], pm[mk]]) };
  }).sort((a, b) => b.thisPaid - a.thisPaid || b.allPaid - a.allPaid);
  const sum = { n: list.length, thisPaid: list.reduce((s, r) => s + r.thisPaid, 0), prevPaid: os.filter(o => ym(o.t) === kp).reduce((s, o) => s + o.paid, 0), orders: os.filter(o => ym(o.t) === k).length };
  const A = await dlApps(x), apps = A.filter(r => r.st === 'new').concat(A.filter(r => r.st !== 'new').slice(0, 10));
  const caps = u.level >= 3 ? (await dlCapList(x, cfg)).map(i => ({ name: i.name, variant: i.variant, price: i.price, cost: i.cost, cap: i.cap })) : null; // 💰 chỉ Quản trị thấy giá vốn
  return { ok: true, cfg, list, sum, apps, caps, month: k, prev: kp, bonus: { [k]: bonusOf[k] || {}, [kp]: bonusOf[kp] || {} }, company: COMPANY, canCfg: u.level >= 3 };
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
    if (d.appId) L[ph].app = String(d.appId).slice(0, 20);
    await kvSet(x.db, 'dl_list', JSON.stringify(L));
    if (d.appId) { const A = await dlApps(x), r = A.find(z => z.id === d.appId); if (r && r.st === 'new') { Object.assign(r, { st: 'ok', doneAt: Date.now(), doneBy: u.name }); await kvSet(x.db, 'dl_apps', JSON.stringify(A)); } }
    await log(x, u, old ? 'Sửa đại lý' : d.appId ? 'Duyệt đăng ký đại lý' : 'Thêm đại lý', ph, name, L[ph].fix ? 'giữ bậc ' + L[ph].fix : 'bậc tự theo tháng trước', by ? 'sale giới thiệu: ' + by : '');
    return dlView(x, u);
  }
  if (a === 'dl_key') { // 🔗 link đặt hàng riêng của đại lý (tạo lần đầu / đổi link khi lộ)
    if (u.level < 2) return { ok: false, error: 'Chỉ Quản lý và Quản trị lấy link đặt hàng của đại lý.' };
    const ph = normPhone(d.phone), L = await dlList(x); if (!L[ph]) return { ok: false, error: 'Không tìm thấy đại lý này.' };
    if (!L[ph].key || d.reset) { L[ph].key = newKey(); await kvSet(x.db, 'dl_list', JSON.stringify(L)); await log(x, u, d.reset ? 'Đổi link đặt hàng đại lý' : 'Tạo link đặt hàng đại lý', ph, L[ph].name, d.reset ? 'link cũ hết dùng được' : '', ''); }
    return { ok: true, key: L[ph].key, link: DL_ORDER_URL + '#' + L[ph].key };
  }
  if (a === 'dl_app_no') {
    if (u.level < 2) return { ok: false, error: 'Chỉ Quản lý và Quản trị xử lý đăng ký đại lý.' };
    const A = await dlApps(x), r = A.find(z => z.id === d.id); if (!r || r.st !== 'new') return { ok: false, error: 'Đăng ký này đã xử lý rồi.' };
    Object.assign(r, { st: 'no', doneAt: Date.now(), doneBy: u.name, reason: String(d.reason || '').trim().slice(0, 200) });
    await kvSet(x.db, 'dl_apps', JSON.stringify(A));
    await log(x, u, 'Từ chối đăng ký đại lý', r.phone, r.name, r.reason, '');
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
    const old = await dlCfg(x), lead = d.lead == null ? old.lead : String(d.lead).trim().slice(0, 40), selfMin = d.selfMin == null ? old.selfMin : Math.max(0, Math.round(Number(d.selfMin) || 0));
    const keep = d.keep == null || d.keep === '' ? old.keep : Number(String(d.keep).replace(',', '.'));
    if (!(keep >= 0 && keep <= 80)) return { ok: false, error: 'Lãi gộp tối thiểu giữ lại 0–80% giá lẻ.' };
    await kvSet(x.db, 'dl_cfg', JSON.stringify({ tiers, first: firstMin, bonus, bonusMonths, top3, lead, selfMin, keep }));
    await log(x, u, 'Cài đặt đại lý', '', '', tiers.map(r => r.name + ' ' + r.pct + '% từ ' + fmt(r.min)).join(' · '), 'phụ trách ' + (lead || '—') + ' · đơn đầu ' + fmt(firstMin) + ' · tự đặt từ ' + fmt(selfMin) + ' · giữ lãi gộp ≥ ' + keep + '% giá lẻ' + ' · thưởng sale ' + bonus + '% ' + bonusMonths + ' tháng');
    return dlView(x, u);
  }
  return { ok: false, error: 'Không rõ thao tác: ' + a };
}
