/* ================================================================ 🔗 Nối Shopee chính chủ (Shopee Open Platform v2, 16/11/2026, anh Sơn: Thủy muốn trợ lý tự đọc shop, không tải file).
 * Anh Sơn / Thủy đăng ký ứng dụng loại Seller In-house System trên open.shopee.com, Shopee duyệt → có Partner ID + Partner Key.
 * Quản trị dán 2 mã này ở CRM → Sàn → 🔗 Nối Shopee (lưu kv shp_app, KHÔNG ghi vào repo) hoặc secret SHOPEE_PARTNER_ID / SHOPEE_PARTNER_KEY,
 * rồi bấm "Cho phép CRM đọc shop" (đăng nhập Shopee bằng tài khoản shop, trang của Shopee) → Shopee gọi lại /shopee/cb?code&shop_id → CRM đổi lấy mã đọc (4 tiếng, tự gia hạn bằng refresh 30 ngày).
 * 30 phút / lần (cron, 7h–22h): đơn chờ đóng gói (order.get_order_list READY_TO_SHIP), số dư quảng cáo (ads.get_total_balance), chi phí + doanh thu quảng cáo theo ngày
 * (ads.get_all_cpc_ads_daily_performance) → ghi vào sổ theo dõi ngày san_day (src 'api'), tin nhắn chưa đọc (sellerchat, chỉ khi Shopee cấp quyền).
 * Mỗi phần lỗi riêng không làm hỏng phần khác; lỗi lưu ở kv shp_live.err. CHƯA THỬ VỚI SHOPEE THẬT (chờ duyệt ứng dụng): tên trường trả về đọc theo nhiều kiểu. */
import { kvJson, kvSet, kvDel, run, fmtDate, DAY } from './lib.js';

const HOST = 'https://partner.shopeemobile.com';
export const SHP_CB = 'https://api.thucduonglanh.vn/shopee/cb';

async function appOf(x) {
  const a = await kvJson(x.db, 'shp_app', null) || {};
  const id = Number(x.env.SHOPEE_PARTNER_ID || a.id || 0), key = String(x.env.SHOPEE_PARTNER_KEY || a.key || '');
  return id && key ? { id, key } : null;
}
async function hmac(key, s) {
  const k = await crypto.subtle.importKey('raw', new TextEncoder().encode(key), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  return [...new Uint8Array(await crypto.subtle.sign('HMAC', k, new TextEncoder().encode(s)))].map(b => b.toString(16).padStart(2, '0')).join('');
}
const ts = () => Math.floor(Date.now() / 1000);

/** Gọi API công khai (chưa cần shop): đổi mã / gia hạn mã. */
async function pubPost(app, path, body) {
  const t = ts(), sign = await hmac(app.key, app.id + path + t);
  const r = await fetch(HOST + path + '?partner_id=' + app.id + '&timestamp=' + t + '&sign=' + sign, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(Object.assign({ partner_id: app.id }, body)) });
  const j = await r.json().catch(() => ({}));
  if (j.error) throw new Error(j.error + (j.message ? ': ' + j.message : ''));
  return j;
}
async function tokenOf(x, app) {
  const T = await kvJson(x.db, 'shp_tok', null); if (!T || !T.refresh) return null;
  if (T.exp - Date.now() > 10 * 60e3) return T;
  const j = await pubPost(app, '/api/v2/auth/access_token/get', { refresh_token: T.refresh, shop_id: T.shop });
  const N = { shop: T.shop, access: j.access_token, refresh: j.refresh_token || T.refresh, exp: Date.now() + (Number(j.expire_in) || 14400) * 1000, at: T.at, by: T.by };
  await kvSet(x.db, 'shp_tok', JSON.stringify(N)); return N;
}
/** Gọi API của shop (GET, tham số trên đường dẫn). */
async function shopGet(x, app, T, path, q) {
  const t = ts(), sign = await hmac(app.key, app.id + path + t + T.access + T.shop);
  const p = new URLSearchParams(Object.assign({ partner_id: app.id, timestamp: t, sign, access_token: T.access, shop_id: T.shop }, q || {}));
  const r = await fetch(HOST + path + '?' + p.toString());
  const j = await r.json().catch(() => ({}));
  if (j.error) throw new Error(j.error + (j.message ? ': ' + j.message : ''));
  return j.response || j;
}

/** Link đăng nhập Shopee để chủ shop bấm Cho phép. */
export async function shpAuthUrl(x) {
  const app = await appOf(x); if (!app) return null;
  const path = '/api/v2/shop/auth_partner', t = ts(), sign = await hmac(app.key, app.id + path + t);
  return HOST + path + '?partner_id=' + app.id + '&timestamp=' + t + '&sign=' + sign + '&redirect=' + encodeURIComponent(SHP_CB);
}
/** /shopee/cb?code=…&shop_id=… (Shopee chuyển về sau khi chủ shop bấm Cho phép). */
export async function shpRoute(x, req, path, url) {
  if (path !== '/shopee/cb') return null;
  const page = (t, ok) => new Response('<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Nối Shopee</title><body style="font:16px system-ui;padding:24px;max-width:520px;margin:auto"><h2>' + (ok ? '✅' : '⚠️') + ' ' + t + '</h2><p><a href="https://crm.thucduonglanh.vn/#san">Về CRM → tab Sàn</a></p></body>', { headers: { 'Content-Type': 'text/html; charset=utf-8' } });
  const app = await appOf(x); if (!app) return page('CRM chưa có mã ứng dụng Shopee.', false);
  const code = url.searchParams.get('code'), shop = Number(url.searchParams.get('shop_id') || 0);
  if (!code || !shop) return page('Shopee chưa gửi mã cho phép. Bấm lại nút Cho phép trong CRM.', false);
  try {
    const j = await pubPost(app, '/api/v2/auth/token/get', { code, shop_id: shop });
    await kvSet(x.db, 'shp_tok', JSON.stringify({ shop, access: j.access_token, refresh: j.refresh_token, exp: Date.now() + (Number(j.expire_in) || 14400) * 1000, at: Date.now() }));
    x.later && x.later(shpTick(x, true).catch(e => console.error('shpTick', e.message)));
    return page('Đã nối Shopee. CRM bắt đầu tự lấy số (khoảng 1 phút).', true);
  } catch (e) { return page('Shopee báo lỗi: ' + e.message, false); }
}

const dmy = t => fmtDate(t, 'dd-MM-yyyy'), ymd = t => fmtDate(t, 'yyyy-MM-dd');
const numOf = (o, ks) => { for (const k of ks) if (o && o[k] != null && isFinite(Number(o[k]))) return Number(o[k]); return null; };
const arrOf = r => Array.isArray(r) ? r : (r && (r.result_list || r.performance_list || r.list || r.data || r.order_list)) || [];
export async function sanDaySchema(db) {
  await run(db, "CREATE TABLE IF NOT EXISTS san_day (day TEXT PRIMARY KEY, ads INTEGER, ads_gmv INTEGER, bal INTEGER, vid INTEGER, live INTEGER, aff INTEGER, note TEXT DEFAULT '', by_name TEXT DEFAULT '', at INTEGER, src TEXT DEFAULT 'tay')");
}

/** 30 phút / lần: lấy số từ Shopee. force = bỏ qua hẹn giờ. */
export async function shpTick(x, force) {
  const T0 = await kvJson(x.db, 'shp_tok', null); if (!T0) return;
  const L = await kvJson(x.db, 'shp_live', {}) || {};
  if (!force && Date.now() - (L.at || 0) < 28 * 60e3) return;
  const app = await appOf(x); if (!app) return;
  const out = { at: Date.now(), err: {} };
  let T;
  try { T = await tokenOf(x, app); } catch (e) { out.err.auth = 'Hết hạn cho phép, Quản trị bấm lại 🔗 Cho phép CRM đọc shop (' + e.message + ')'; await kvSet(x.db, 'shp_live', JSON.stringify(Object.assign({}, L, out))); return; }
  try { // 📦 đơn chờ đóng gói (15 ngày gần nhất, Shopee cho tối đa 15 ngày / lần)
    let n = 0, cursor = '', more = true, k = 0;
    while (more && k++ < 5) { const r = await shopGet(x, app, T, '/api/v2/order/get_order_list', { time_range_field: 'create_time', time_from: ts() - 15 * 86400, time_to: ts(), page_size: 100, order_status: 'READY_TO_SHIP', cursor }); n += arrOf(r).length; more = !!r.more; cursor = r.next_cursor || ''; }
    out.pending = n;
  } catch (e) { out.err.order = e.message; }
  try { const r = await shopGet(x, app, T, '/api/v2/ads/get_total_balance'); out.bal = numOf(r, ['total_balance', 'balance']); } catch (e) { out.err.bal = e.message; }
  try { // 📈 quảng cáo theo ngày (7 ngày) → sổ theo dõi ngày
    const r = await shopGet(x, app, T, '/api/v2/ads/get_all_cpc_ads_daily_performance', { start_date: dmy(Date.now() - 7 * DAY), end_date: dmy(Date.now()) });
    await sanDaySchema(x.db);
    for (const d of arrOf(r)) {
      const ds = String(d.date || ''), m = ds.match(/^(\d\d)-(\d\d)-(\d{4})$/), day = m ? m[3] + '-' + m[2] + '-' + m[1] : /^\d{4}-\d\d-\d\d$/.test(ds) ? ds : ''; if (!day) continue;
      const ads = numOf(d, ['expense', 'cost', 'spend']), gmv = numOf(d, ['broad_gmv', 'gmv', 'direct_gmv']);
      await run(x.db, "INSERT INTO san_day (day, ads, ads_gmv, at, src, by_name) VALUES (?, ?, ?, ?, 'api', 'Shopee') ON CONFLICT(day) DO UPDATE SET ads = excluded.ads, ads_gmv = excluded.ads_gmv, at = excluded.at, src = 'api'", day, Math.round(ads || 0), Math.round(gmv || 0), Date.now());
    }
    if (out.bal != null) await run(x.db, "INSERT INTO san_day (day, bal, at, src) VALUES (?, ?, ?, 'api') ON CONFLICT(day) DO UPDATE SET bal = excluded.bal", ymd(Date.now()), Math.round(out.bal), Date.now());
    out.ads = 1;
  } catch (e) { out.err.ads = e.message; }
  try { // 💬 tin nhắn chưa đọc: Shopee chỉ cấp quyền chat cho một số ứng dụng → lỗi thì ghi "chưa có quyền"
    const r = await shopGet(x, app, T, '/api/v2/sellerchat/get_conversation_list', { direction: 'latest', type: 'unread', page_size: 50 });
    out.chat = arrOf(r.conversations || r).length;
  } catch (e) { out.err.chat = e.message; }
  await kvSet(x.db, 'shp_live', JSON.stringify(out));
}

/** Lệnh CRM: san_shp (xem trạng thái), san_shp_app (Quản trị dán Partner ID / Key), san_shp_auth (link cho phép), san_shp_sync (lấy ngay), san_shp_off (ngắt). */
export async function crmShp(x, u, d) {
  const a = d.action;
  if (a === 'san_shp_app') {
    if (u.level < 3) return { ok: false, error: 'Chỉ Quản trị.' };
    const id = String(d.pid || '').replace(/\D/g, ''), key = String(d.pkey || '').trim();
    if (!id || key.length < 20) return { ok: false, error: 'Partner ID là số, Partner Key là chuỗi dài. Kiểm tra lại trên open.shopee.com → App List.' };
    await kvSet(x.db, 'shp_app', JSON.stringify({ id, key, by: u.name, at: Date.now() })); return { ok: true };
  }
  if (a === 'san_shp_auth') { if (u.level < 3) return { ok: false, error: 'Chỉ Quản trị.' }; const url = await shpAuthUrl(x); return url ? { ok: true, url } : { ok: false, error: 'Chưa có mã ứng dụng Shopee.' }; }
  if (a === 'san_shp_sync') { await shpTick(x, true); }
  if (a === 'san_shp_off') { if (u.level < 3) return { ok: false, error: 'Chỉ Quản trị.' }; await kvDel(x.db, 'shp_tok'); await kvDel(x.db, 'shp_live'); return { ok: true }; }
  const app = await appOf(x), T = await kvJson(x.db, 'shp_tok', null), L = await kvJson(x.db, 'shp_live', null);
  return { ok: true, app: !!app, on: !!T, shop: T && T.shop, since: T && T.at, live: L, cb: SHP_CB };
}
