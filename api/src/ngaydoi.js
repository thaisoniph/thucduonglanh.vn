// 🎉 Ngày Đôi Sống Lành (10/11/2026, anh Sơn): các ngày 1/1, 2/2 … 12/12 (giờ Việt Nam), đơn ĐẶT TRÊN WEB được:
//   miễn ship đơn từ free_ship_min (0 = mọi đơn) + đơn từ gift_min tặng quà + first_n đơn đầu tiên trong ngày (từ first_min) tặng thêm quà.
//   11/11/2026 anh Sơn: miễn ship từ 150k; đơn dùng mã giảm tiền / % (discount > 0) vẫn miễn ship nhưng KHÔNG kèm quà (không cộng dồn).
// Không cần mã: máy chủ tự trừ ship, tự thêm quà vào đơn (dòng 🎁, giá 0) và ghi chú "🎉 Ngày Đôi d/m: …" để kho gói kèm.
// Cài đặt: /admin → Cài đặt chung → 🎉 Ngày Đôi (data/site.json → double_day) → build.py ghi https://thucduonglanh.vn/ngay-doi.json.
// Máy chủ đọc file đó (giữ 10 phút, bản đọc được gần nhất lưu kv dd_cfg); chưa đọc được lần nào thì dùng DEF.
// Đếm suất "N đơn đầu": kv dd_<YYYY-MM-DD> (tăng 1 cho mỗi đơn đủ điều kiện, đơn huỷ không trả suất).
import { first, kvGet, kvSet, fmt } from './lib.js';

const DEF = { enabled: true, name: 'Ngày Đôi Sống Lành', free_ship: true, free_ship_min: 150000, gift_min: 500000, first_n: 11, first_min: 300000,
  gift: { name: 'Ruốc Rong Biển Vị Sườn Non Thuần Chay', variant: 'Hũ 165g', label: '1 hũ Ruốc Rong Biển 165g' },
  first: { name: 'Trà Hòa Tan DILVANG – Đinh Lăng Chè Vằng', variant: 'Hộp lẻ 75g (15 gói x 5g)', label: '1 hộp Trà DILVANG' } };
const VN = 7 * 3600e3;
let mem = null;

/** Hôm nay (giờ VN) có phải ngày đôi không → { key: '2026-11-11', label: '11/11', d, m } | null */
export function ddDay(t) {
  const d = new Date((t || Date.now()) + VN), day = d.getUTCDate(), m = d.getUTCMonth() + 1;
  return day === m ? { key: d.toISOString().slice(0, 10), label: day + '/' + m, d: day, m } : null;
}
export async function ddCfg(x) {
  if (mem && Date.now() - mem.t < 600e3) return mem.d;
  let d = null;
  try {
    const r = await fetch('https://thucduonglanh.vn/ngay-doi.json', { cf: { cacheTtl: 300, cacheEverything: true } });
    if (r.ok) { const j = await r.json(); d = Object.assign({}, DEF, j); const s = JSON.stringify(j); if (x && (!mem || mem.s !== s)) await kvSet(x.db, 'dd_cfg', s); mem = { t: Date.now(), d, s }; return d; }
  } catch (e) { console.error('ngay-doi.json', e.message); }
  try { const s = x && await kvGet(x.db, 'dd_cfg'); if (s) d = Object.assign({}, DEF, JSON.parse(s)); } catch (e) { }
  d = d || DEF; mem = { t: Date.now() - 480e3, d }; // đọc lỗi: thử lại sau 2 phút
  return d;
}
const num = v => Math.max(0, Math.round(Number(v) || 0));
const k = v => Math.round(num(v) / 1000) + 'K';

/** Câu mô tả ưu đãi (CRM → Ưu đãi đang chạy, bài trợ lý Zalo) */
export function ddText(c, label) {
  const g = [c.gift && num(c.gift_min) ? 'đơn từ ' + k(c.gift_min) + ' tặng ' + c.gift.label : '', c.first && num(c.first_n) ? num(c.first_n) + ' đơn đầu tiên' + (num(c.first_min) ? ' từ ' + k(c.first_min) : '') + ' tặng thêm ' + c.first.label : ''].filter(Boolean);
  return [c.free_ship ? 'miễn phí ship ' + (num(c.free_ship_min) ? 'đơn từ ' + k(c.free_ship_min) : 'mọi đơn') : '', ...g].filter(Boolean).join('; ') + (g.length ? ' (quà không áp dụng cùng mã giảm giá)' : '');
}
/** Ưu đãi ảo cho danh sách "Ưu đãi đang chạy" vào đúng ngày đôi (at = mốc thời gian, mặc định bây giờ) */
export async function ddOffer(x, at) {
  const day = ddDay(at); if (!day) return null;
  const c = await ddCfg(x); if (!c.enabled) return null;
  return { id: 'ngaydoi', auto: 1, title: '🎉 ' + (c.name || 'Ngày Đôi') + ' ' + day.label + ' (chỉ khi đặt trên web)', prod: '',
    text: 'Chỉ trong ngày ' + day.label + ', khách tự đặt trên web thucduonglanh.vn: ' + ddText(c, day.label) + '. Không cần mã, quà tự ghi vào đơn. Đặt qua sale / gọi điện không áp dụng.', until: day.key, by: 'Tự động', at: 0 };
}

/** Web gọi: còn bao nhiêu suất quà "N đơn đầu" hôm nay */
export async function ddStatus(x) {
  const day = ddDay(); if (!day) return { on: false };
  const c = await ddCfg(x); if (!c.enabled) return { on: false };
  const used = Number(await kvGet(x.db, 'dd_' + day.key)) || 0, n = num(c.first_n);
  return { on: true, label: day.label, n, left: Math.max(0, n - used) };
}

/** Đơn web vào ngày đôi: bỏ phí ship, thêm quà vào data.items, ghi chú. Trả { label, ship, gifts, rank } để trang cảm ơn hiện cho khách. */
export async function ddApply(x, data) {
  const day = ddDay(); if (!day) return null;
  const c = await ddCfg(x); if (!c.enabled) return null;
  const sub = num(data.subtotal), cu = data.customer || (data.customer = {}), items = Array.isArray(data.items) ? data.items : (data.items = []);
  const out = { label: day.label, ship: false, gifts: [] }, why = [], n = num(c.first_n);
  if (c.free_ship && sub >= num(c.free_ship_min)) { const sh = num(data.shipping); if (sh) { data.total = Math.max(0, (Number(data.total) || 0) - sh); data.shipping = 0; } out.ship = true; why.push('miễn ship'); }
  const low = Math.min(c.gift && c.gift.name && num(c.gift_min) ? num(c.gift_min) : Infinity, c.first && c.first.name && n ? num(c.first_min) : Infinity);
  if (num(data.discount) > 0 && sub >= low) { out.noGift = true; why.push('không kèm quà vì đơn đã dùng mã giảm ' + fmt(data.discount)); } // không cộng dồn quà với mã giảm giá
  else {
  const give = (g, txt) => { items.push({ name: g.name, variant: g.variant || '', qty: 1, price: 0, subtotal: 0, gift: true }); out.gifts.push(g.label); why.push('🎁 ' + g.label + ' (' + txt + ')'); };
  if (c.gift && c.gift.name && num(c.gift_min) && sub >= num(c.gift_min)) give(c.gift, 'đơn từ ' + fmt(c.gift_min));
  if (c.first && c.first.name && n && sub >= num(c.first_min)) {
    const r = await first(x.db, "INSERT INTO kv (k, v, exp) VALUES (?, '1', ?) ON CONFLICT(k) DO UPDATE SET v = CAST(v AS INTEGER) + 1 RETURNING v", 'dd_' + day.key, Date.now() + 40 * 864e5);
    const i = Number(r && r.v) || 0;
    if (i && i <= n) { out.rank = i; out.n = n; give(c.first, 'đơn thứ ' + i + '/' + n + ' hôm nay'); }
  }
  }
  if (!why.length) return null; // đơn nhỏ hơn mức miễn ship, không có quà: đơn bình thường
  cu.note = (cu.note ? cu.note + ' · ' : '') + '🎉 Ngày Đôi ' + day.label + ': ' + why.join(', ');
  return out;
}
