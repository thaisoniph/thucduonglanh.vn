// Máy chủ CRM + nhận đơn Thực Dưỡng Lành trên Cloudflare Workers (api.thucduonglanh.vn), dữ liệu ở Cloudflare D1.
// Giao diện gửi POST (text/plain, JSON) giống hệt Apps Script trước đây: {type:'crm', action, token, …} / {type:'order'} / {type:'contact'}.
import { esc, run, first, kvGet, normPhone, CRM_URL } from './lib.js';
import { crmApi, saveOrder, addLead, telegramUser, vtpWebhook, ensureSchema, adminByToken } from './crm.js';
import { telegram, sendMail, tgConf, bridge } from './google.js';
import { SYNC, DUPS } from './sync.js';
import { migrate } from './migrate.js';
import { scheduled, mirror, dailyCare } from './cron.js';
import { cmsRoute } from './cms.js';
import { voucherCheck, voucherApply } from './voucher.js';
import { qrGo } from './links.js';
import { journeyCounts, pledge, quiz, wall } from './journey.js';
import { apply } from './apply.js';
import { chat, chatLead } from './chat.js';
import { zbot, zbotLead, zbImg } from './zbot.js';
import { refMe, ctvMe, ctvApply } from './partner.js';
import { fbRoute } from './fb.js';
export { AiRelay } from './airelay.js'; // Durable Object chuyển tiếp lời gọi AI qua Bắc Mỹ

const API_VERSION = '2026-10-31h'; // CRM web so với số này để biết giao diện & máy chủ khớp nhau
const ORIGINS = /^https:\/\/((www\.|crm\.|mkt\.|congsu\.|camnangsongkhoe\.)?thucduonglanh\.vn|([a-z0-9-]+\.)?(thucduonglanh(-crm|-congsu)?|camnang-song-khoe-thuc-duong-lanh)\.pages\.dev)$|^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/;

function ctxOf(env, ectx) { return { env, db: env.DB, later: p => ectx.waitUntil(Promise.resolve(p).catch(e => console.error('later', e && e.message))) }; }
function json(o, origin, status) {
  const h = { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' };
  if (origin && ORIGINS.test(origin)) { h['Access-Control-Allow-Origin'] = origin; h['Vary'] = 'Origin'; }
  return new Response(JSON.stringify(o), { status: status || 200, headers: h });
}

const ADMIN = Object.assign({}, SYNC, {
  migrate: (x, u, d) => d.confirm === 'CHEP LAI' ? migrate(x, { force: true }) : { ok: false, error: 'Cần xác nhận' },
  mirror: async x => ({ ok: true, counts: await mirror(x) }),
  care_now: async x => ({ ok: true, sent: await dailyCare(x) }),
  clean_triggers: async x => bridge(x.env, 'clean_triggers')
});

/** Máy chủ dữ liệu (D1) lỗi / hết hạn mức → chuyển đơn, liên hệ sang Apps Script báo thẳng Telegram + email để nhân sự nhập tay, không mất khách. */
async function rescue(x, data, err) {
  if (!x.env.BRIDGE_URL) return false;
  try {
    const r = await fetch(x.env.BRIDGE_URL, { method: 'POST', headers: { 'Content-Type': 'text/plain;charset=utf-8' }, body: JSON.stringify({ type: 'rescue', data, error: String(err && err.message || err).slice(0, 300) }), redirect: 'follow' });
    const j = await r.json(); return !!(j && j.ok);
  } catch (e) { console.error('rescue', e.message); return false; }
}

async function website(x, data) {
  if (data.website) return { ok: true }; // chống spam (honeypot)
  if (data.type === 'vtp') return await vtpWebhook(x, data.payload);
  if (data.type === 'pledge') return await pledge(x, data); // lời cam kết "Tôi chọn sống lành" (journey.js)
  if (data.type === 'quiz') return await quiz(x, data); // trò chơi "Bạn còn mấy ngón tay?" (journey.js)
  if (data.type === 'voucher') return await voucherCheck(x, data); // khách bấm "Áp dụng" mã ưu đãi (gõ SĐT người giới thiệu cũng được)
  if (data.type === 'ctv_me') return await ctvMe(x, data); // 🤝 trang CTV tự xem hoa hồng /ctv/#<link bí mật> (partner.js)
  if (data.type === 'ctv_apply') return await ctvApply(x, data); // 📝 người ngoài đăng ký làm CTV ở /cong-tac-vien/ → chờ quản lý duyệt (partner.js)
  if (data.type === 'ref_me') return await refMe(x, data); // 🌱 /gioi-thieu-ban-be/ + trang cảm ơn: link giới thiệu, bạn bè đã mua, voucher (partner.js)
  if (data.type === 'apply') return await apply(x, data); // ứng tuyển từ congsu.thucduonglanh.vn (apply.js)
  if (data.type === 'chat') return await chat(x, data); // 💬 trợ lý chat An Lành trên web (chat.js)
  if (data.type === 'chat_lead') return await chatLead(x, data); // khách để lại số trong khung chat
  if (data.type === 'zbot') return await zbot(x, data); // 🤖 chương trình Zalo "Trợ lý An Lành" (zbot.js, zalo-bot/)
  if (data.type === 'order') {
    try {
      if (data.voucher) { // đơn gửi lại (mạng chập chờn) đã lưu rồi thì không kiểm tra lại mã (mã 1 lần sẽ báo "đã dùng")
        if (data.id && await first(x.db, 'SELECT rid FROM orders WHERE id = ?', String(data.id))) return { ok: true, id: data.id, dup: true };
        const v = await voucherApply(x, data); if (!v.ok) return { ok: false, voucher_error: v.error, error: v.error };
      } else { data.discount = 0; }
      const r = await saveOrder(x, data, {}); return { ok: true, id: data.id, dup: !!r.dup, total: data.total };
    }
    catch (e) { if (await rescue(x, data, e)) return { ok: true, id: data.id, rescued: true }; throw e; }
  }
  if (data.type === 'contact') {
    try { await run(x.db, 'INSERT INTO contacts (time, name, phone, email, message, page) VALUES (?, ?, ?, ?, ?, ?)', Date.now(), data.name || '', normPhone(data.phone), data.email || '', data.message || '', data.page || ''); }
    catch (e) { if (await rescue(x, data, e)) return { ok: true, rescued: true }; throw e; }
    // kind 'ebook': trang quà tặng trên web (/ebook/, /cam-nang-song-khoe/) → kênh "Ebook – quà tặng (Website)", không gửi email
    const isEb = data.kind === 'ebook', book = String(data.book_title || 'Ebook quà tặng').slice(0, 80), concern = String(data.concern || '').slice(0, 300), ask = String(data.ask || '').slice(0, 500), ctx = String(data.ctx || '').slice(0, 300); // ctx: kết quả trò chơi Bạn còn mấy ngón tay / đã ký cam kết
    if (data.kind === 'zalo') { // cổng vào nhóm Zalo /nhom-zalo/ (17/10/2026): khách để tên + số Zalo rồi mới nhận link nhóm → kênh "Nhóm Zalo (Website)"
      let lz = null; try { lz = await addLead(x, { name: data.name, phone: data.phone, channel: 'Nhóm Zalo (Website)', interest: 'Xin vào nhóm Zalo' + (concern ? ' · Quan tâm: ' + concern : '') + (data.pos ? ' · từ web (' + data.pos + ')' : ''), addInterest: true, note: (data.again ? 'Bấm vào nhóm Zalo trên web (đã có số từ trước)' : 'Xin vào nhóm Zalo trên web') + (ctx ? ' · ' + ctx : '') + ' · Nguồn: ' + (data.source || ''), by: 'Website', auto: true }); } catch (e) { console.error('lead', e.message); }
      x.later(zbotLead(x, { phone: data.phone, name: data.name, lead: lz && lz.id, what: '' })); // trợ lý Zalo tìm tài khoản theo số → tự duyệt vào nhóm
      if (!data.again) {
        const zm = '👥 <b>XIN VÀO NHÓM ZALO</b>\n👤 ' + esc(data.name) + ' – <b>' + esc(data.phone) + '</b>' + (concern ? '\n🩺 Quan tâm: ' + esc(concern) : '') + (ctx ? '\n' + esc(ctx) : '') + '\n📍 Nguồn: ' + esc(data.source || '') + (data.pos ? ' · bấm từ web: ' + esc(data.pos) : '') + '\n👉 Duyệt vào nhóm (nếu nhóm bật duyệt) + kết bạn Zalo, chào trong 24 giờ';
        x.later((async () => { await telegram(x.env, zm + (lz && lz.owner ? '\n\n👤 Giao cho: ' + esc(lz.owner) : '\n\n⚠️ Chưa có người phụ trách – vào CRM để giao')); if (lz && lz.owner) await telegramUser(x, lz.owner, zm + '\n\n👉 Khách tiềm năng mới của bạn: ' + CRM_URL + '/#tiem-nang'); })());
      }
      return { ok: true };
    }
    let ld = null; try { ld = await addLead(x, isEb ? { name: data.name, phone: data.phone, channel: 'Ebook – quà tặng (Website)', interest: book + (concern ? ' · Quan tâm: ' + concern : '') + (data.pos ? ' · từ web (' + data.pos + ')' : ''), addInterest: true, note: (data.again ? 'Nhận thêm ' : 'Đăng ký ') + book + ' trên web' + (ctx ? ' · ' + ctx : '') + (ask ? ' · Hỏi thêm: ' + ask : '') + ' · Nguồn: ' + (data.source || ''), by: 'Website', auto: true } : { name: data.name, phone: data.phone, channel: 'Form website', note: data.message, by: 'Website', auto: true }); } catch (e) { console.error('lead', e.message); }
    if (isEb) x.later(zbotLead(x, { phone: data.phone, name: data.name, lead: ld && ld.id, what: book, announce: !data.again })); // đang trong nhóm Zalo → trợ lý chúc mừng
    const cmsg = isEb ? (data.again ? '🎁 <b>NHẬN THÊM EBOOK</b> (khách đã đăng ký trước) – ' : '🎁 <b>ĐĂNG KÝ EBOOK</b> – ') + esc(book) + '\n👤 ' + esc(data.name) + ' – <b>' + esc(data.phone) + '</b>' + (concern ? '\n🩺 Quan tâm: ' + esc(concern) : '') + (ctx ? '\n' + esc(ctx) : '') + (ask ? '\n💬 ' + esc(ask) : '') + '\n📍 Nguồn: ' + esc(data.source || '') + (data.pos ? ' · bấm từ web: ' + esc(data.pos) : '') + '\n👉 Kết bạn Zalo, mời vào nhóm Sống khỏe'
      : '✉️ <b>LIÊN HỆ MỚI</b>\n👤 ' + esc(data.name) + ' – <b>' + esc(data.phone) + '</b>\n\n' + esc(data.message);
    x.later((async () => {
      await telegram(x.env, cmsg + (ld && ld.owner ? '\n\n👤 Giao cho: ' + esc(ld.owner) : '\n\n⚠️ Chưa có người phụ trách – vào CRM để giao'));
      if (ld && ld.owner) await telegramUser(x, ld.owner, cmsg + '\n\n👉 Khách tiềm năng mới của bạn: ' + CRM_URL + '/#tiem-nang');
      const c = await tgConf(x.env); if (c.notify && !isEb) await sendMail(x.env, { to: c.notify, subject: '✉️ Liên hệ mới từ website – ' + data.name, body: data.message + '\n\n' + data.name + ' – ' + data.phone + (data.email ? ' – ' + data.email : '') });
    })());
    return { ok: true };
  }
  return { ok: false, error: 'unknown type' };
}

export default {
  async fetch(req, env, ectx) {
    const url = new URL(req.url), origin = req.headers.get('Origin') || '', x = ctxOf(env, ectx), path = url.pathname.replace(/\/+$/, '') || '/';
    x.ip = req.headers.get('CF-Connecting-IP') || ''; // chống dò mã ưu đãi (voucher.js)
    if (path.startsWith('/gh/') || path.startsWith('/cms/')) { // trang quản trị website đăng nhập bằng email (cms.js)
      try { await ensureSchema(x.db); const r = await cmsRoute(x, req, path); if (r) return r; }
      catch (err) { console.error('cms', err && err.stack || err); return json({ ok: false, message: String(err && err.message || err) }, origin, 500); }
    }
    if (path.startsWith('/fb/')) { // 📘 trợ lý Fanpage: webhook Facebook + đăng nhập kết nối trang (fb.js)
      try { await ensureSchema(x.db); const r = await fbRoute(x, req, path, url); if (r) return r; }
      catch (err) { console.error('fb', err && err.stack || err); return new Response('error', { status: 500 }); }
    }
    if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: ORIGINS.test(origin) ? { 'Access-Control-Allow-Origin': origin, 'Access-Control-Allow-Methods': 'GET, POST', 'Access-Control-Allow-Headers': 'Content-Type', 'Access-Control-Max-Age': '86400' } : {} });
    try {
      if (req.method === 'GET') {
        if (/^\/zb-img\/[a-z0-9]+$/.test(path)) return await zbImg(x, path.slice(8)); // ảnh bài đăng nhóm Zalo do nhân sự tải lên (zbot.js)
        if (/^\/q\/[^/]+$/.test(path)) return await qrGo(x, req, path.slice(3)); // mã QR / link ngắn thucduonglanh.vn/q/<mã>/ (links.js)
        if (path === '/api/journey') { // bộ đếm hành trình 10 triệu người (journey.js): lưu đệm 5 phút ở Cloudflare để ít đọc D1
          const ck = new Request('https://api.thucduonglanh.vn/api/journey'), cache = caches.default;
          let r = await cache.match(ck);
          if (!r) { await ensureSchema(x.db); r = new Response(JSON.stringify(await journeyCounts(x)), { headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'public, max-age=300' } }); x.later(cache.put(ck, r.clone())); }
          const h = new Headers(r.headers); h.set('Access-Control-Allow-Origin', '*');
          return new Response(r.body, { headers: h });
        }
        if (path === '/api/wall') { // Bức tường Sống Lành /buc-tuong-song-lanh/ (journey.js): chỉ tên đã che; lưu đệm 2 phút theo từng câu tìm
          const sp = url.searchParams, key = new URL('https://api.thucduonglanh.vn/api/wall');
          ['q', 'p', 'b'].forEach(k => { const v = String(sp.get(k) || '').trim().slice(0, 40); if (v) key.searchParams.set(k, v); });
          const ck = new Request(key.toString()), cache = caches.default;
          let r = await cache.match(ck);
          if (!r) { await ensureSchema(x.db); r = new Response(JSON.stringify(await wall(x, key.searchParams.get('q'), key.searchParams.get('p'), key.searchParams.get('b'))), { headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'public, max-age=120' } }); x.later(cache.put(ck, r.clone())); }
          const h = new Headers(r.headers); h.set('Access-Control-Allow-Origin', '*');
          return new Response(r.body, { headers: h });
        }
        if (path === '/api/bridge-check') { const n = String(url.searchParams.get('n') || '').replace(/[^a-f0-9]/g, ''); return json({ ok: !!(n && await kvGet(x.db, 'bn_' + n)) }); }
        if (path === '/api/test-google' || path === '/api/status') { // chỉ Quản trị (trước đây ai cũng gọi được)
          await ensureSchema(x.db);
          if (!await adminByToken(x, url.searchParams.get('token'))) return json({ ok: false, error: 'Chỉ Quản trị: thêm ?token=<mã phiên CRM>' }, origin, 403);
        }
        if (path === '/api/test-google') {
          const r = await fetch(env.BRIDGE_URL, { method: 'POST', headers: { 'Content-Type': 'text/plain;charset=utf-8' }, body: JSON.stringify({ type: 'crm', action: 'ping' }), redirect: 'follow' });
          const text = await r.text();
          return json({ status: r.status, url: r.url, text: text.slice(0, 500) }, origin);
        }
        if (path === '/api/status') {
          const n = async t => (await first(x.db, 'SELECT count(*) AS n FROM ' + t)).n;
          const mr = await kvGet(x.db, 'migrate_result');
          return json({ ok: true, v: API_VERSION, migrated: Number(await kvGet(x.db, 'migrated')) || null, orders: await n('orders'), customers: await n('customers'), leads: await n('leads'), users: await n('users'), mirror: Number(await kvGet(x.db, 'mirror_last')) || null, mirrorErr: await kvGet(x.db, 'mirror_err'), migrate: mr ? JSON.parse(mr) : null }, origin);
        }
        if (path === '/api/setup') { // bước chuyển 1 lần: tắt máy chủ cũ (Apps Script chuyển đơn web sang đây) rồi chép dữ liệu
          if (await kvGet(x.db, 'migrated')) return json({ ok: true, already: true, result: JSON.parse(await kvGet(x.db, 'migrate_result') || 'null') }, origin);
          return json(await migrate(x, { retire: url.searchParams.get('retire') !== '0', apiUrl: url.origin + '/api' }), origin);
        }
        return json({ ok: true, service: 'Thực Dưỡng Lành orders + CRM', v: API_VERSION }, origin);
      }
      if (req.method !== 'POST') return json({ ok: false, error: 'method' }, origin, 405);
      const t0 = Date.now();
      await ensureSchema(x.db);
      const text = await req.text(); if (text.length > (text.startsWith('{"type":"apply"') ? 8e6 : 2e6)) return json({ ok: false, error: 'Dữ liệu quá lớn' }, origin, 413); // hồ sơ ứng tuyển kèm file CV tới 5 MB
      const d = JSON.parse(text || '{}');
      if (d.type === 'crm') { const out = await crmApi(x, d, ADMIN, DUPS); out.v = API_VERSION; out.sms = Date.now() - t0; return json(out, origin); } // sms: thời gian máy chủ xử lý → CRM ghi vào "Đo tốc độ CRM"
      if (d.type === 'vtp') return json(await vtpWebhook(x, d.payload), origin);
      return json(await website(x, d), origin);
    } catch (err) {
      console.error('api', err && err.stack || err);
      return json({ ok: false, error: String(err && err.message || err), v: API_VERSION }, origin);
    }
  },
  async scheduled(ev, env, ectx) { const x = ctxOf(env, ectx); await ensureSchema(x.db); ectx.waitUntil(scheduled(x, ev.cron)); }
};
