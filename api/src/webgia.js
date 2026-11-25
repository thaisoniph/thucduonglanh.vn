// 💰 Tính lại tiền đơn web theo bảng giá /web-gia.json (build.py web_prices, 25/11/2026 rà soát bảo mật).
// Trước đây máy chủ lưu nguyên giá / tạm tính / tổng tiền trình duyệt gửi → ai biết chút kỹ thuật gửi được đơn 10 hộp giá 10.000đ.
import { fmt } from './lib.js';

let cache = null, cacheAt = 0;
async function webPrices(x) {
  if (cache && Date.now() - cacheAt < 300e3) return cache;
  const r = await fetch((x.env.SITE_URL || 'https://thucduonglanh.vn') + '/web-gia.json', { cf: { cacheTtl: 300, cacheEverything: true } });
  if (!r.ok) throw new Error('web-gia.json ' + r.status);
  const j = await r.json(); if (!j || !j.items) throw new Error('web-gia.json trống');
  cache = j; cacheAt = Date.now(); return j;
}

/** Giá 1 dòng hàng theo bảng giá: sản phẩm có biến thể thì theo tên biến thể (tiếng Việt), không có biến thể thì giá sản phẩm. null = không tra được. */
export function listPrice(P, it) {
  const e = P && P.items && P.items[String(it.slug || '')]; if (!e) return null;
  const vs = e.v || {}, v = Object.keys(vs).length ? vs[String(it.variant || '')] : e.p;
  return v == null ? null : Math.round(Number(v));
}

/** Ghi lại data.items (giá, thành tiền), data.subtotal, data.shipping (không quá phí ship chuẩn), data.discount = 0, data.total trước khi tính mã ưu đãi / Ngày Đôi.
 *  Dòng không tra được giá (bảng giá lỗi, sản phẩm mới chưa build) → giữ giá web gửi, ghi ⚠ vào ghi chú để sale gọi xác nhận, không chặn đơn của khách thật. */
export async function webReprice(x, data, P) {
  if (P === undefined) { try { P = await webPrices(x); } catch (e) { console.error('webgia', e.message); P = null; } }
  const cu = data.customer || (data.customer = {}), warn = [];
  const items = (Array.isArray(data.items) ? data.items : []).filter(i => i && typeof i === 'object' && !i.gift).slice(0, 50);
  for (const i of items) {
    i.qty = Math.min(999, Math.max(1, Math.round(Number(i.qty) || 1)));
    const sent = Math.max(0, Math.round(Number(i.price) || 0)), lp = listPrice(P, i), nm = String(i.name || i.slug || '') + (i.variant ? ' ' + i.variant : '');
    if (lp == null) { i.price = sent; if (P) warn.push(nm + ': chưa có trong bảng giá web'); }
    else { if (lp !== sent) warn.push(nm + ': web gửi ' + fmt(sent) + ', bảng giá ' + fmt(lp)); i.price = lp; }
    i.subtotal = i.price * i.qty;
  }
  const sub = items.reduce((s, i) => s + i.subtotal, 0), fee = Math.round(Number(P && P.ship) || 30000);
  data.items = items; data.subtotal = sub; data.shipping = Math.min(fee, Math.max(0, Math.round(Number(data.shipping) || 0))); data.discount = 0; data.total = sub + data.shipping;
  const why = !P ? '⚠ Chưa đối chiếu được bảng giá web (máy chủ không tải được giá) – kiểm tra tiền đơn trước khi gửi hàng'
    : warn.length ? '⚠ Giá khác bảng giá web, đã tính theo bảng giá (' + warn.join('; ') + ') – gọi khách xác nhận tổng tiền' : '';
  if (why) cu.note = (cu.note ? cu.note + ' · ' : '') + why;
  return { checked: !!P, warn: warn.length };
}
