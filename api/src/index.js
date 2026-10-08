// Máy chủ CRM + nhận đơn Thực Dưỡng Lành trên Cloudflare Workers (api.thucduonglanh.vn), dữ liệu ở Cloudflare D1.
// Giao diện gửi POST (text/plain, JSON) giống hệt Apps Script trước đây: {type:'crm', action, token, …} / {type:'order'} / {type:'contact'}.
import { esc, run, first, kvGet, normPhone, CRM_URL } from './lib.js';
import { crmApi, saveOrder, addLead, telegramUser, vtpWebhook, ensureSchema } from './crm.js';
import { telegram, sendMail, tgConf, bridge } from './google.js';
import { SYNC, DUPS } from './sync.js';
import { migrate } from './migrate.js';
import { scheduled, mirror, dailyCare } from './cron.js';

const API_VERSION = '2026-10-08b'; // CRM web so với số này để biết giao diện & máy chủ khớp nhau
const ORIGINS = /^https:\/\/((www\.|crm\.)?thucduonglanh\.vn|[a-z0-9-]+\.thucduonglanh(-crm)?\.pages\.dev)$|^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/;

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
  if (data.type === 'order') {
    try { const r = await saveOrder(x, data, {}); return { ok: true, id: data.id, dup: !!r.dup }; }
    catch (e) { if (await rescue(x, data, e)) return { ok: true, id: data.id, rescued: true }; throw e; }
  }
  if (data.type === 'contact') {
    try { await run(x.db, 'INSERT INTO contacts (time, name, phone, email, message, page) VALUES (?, ?, ?, ?, ?, ?)', Date.now(), data.name || '', normPhone(data.phone), data.email || '', data.message || '', data.page || ''); }
    catch (e) { if (await rescue(x, data, e)) return { ok: true, rescued: true }; throw e; }
    let ld = null; try { ld = await addLead(x, { name: data.name, phone: data.phone, channel: 'Form website', note: data.message, by: 'Website', auto: true }); } catch (e) { console.error('lead', e.message); }
    const cmsg = '✉️ <b>LIÊN HỆ MỚI</b>\n👤 ' + esc(data.name) + ' – <b>' + esc(data.phone) + '</b>\n\n' + esc(data.message);
    x.later((async () => {
      await telegram(x.env, cmsg + (ld && ld.owner ? '\n\n👤 Giao cho: ' + esc(ld.owner) : '\n\n⚠️ Chưa có người phụ trách – vào CRM để giao'));
      if (ld && ld.owner) await telegramUser(x, ld.owner, cmsg + '\n\n👉 Khách tiềm năng mới của bạn: ' + CRM_URL + '/#tiem-nang');
      const c = await tgConf(x.env); if (c.notify) await sendMail(x.env, { to: c.notify, subject: '✉️ Liên hệ mới từ website – ' + data.name, body: data.message + '\n\n' + data.name + ' – ' + data.phone + (data.email ? ' – ' + data.email : '') });
    })());
    return { ok: true };
  }
  return { ok: false, error: 'unknown type' };
}

export default {
  async fetch(req, env, ectx) {
    const url = new URL(req.url), origin = req.headers.get('Origin') || '', x = ctxOf(env, ectx), path = url.pathname.replace(/\/+$/, '') || '/';
    if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: ORIGINS.test(origin) ? { 'Access-Control-Allow-Origin': origin, 'Access-Control-Allow-Methods': 'GET, POST', 'Access-Control-Allow-Headers': 'Content-Type', 'Access-Control-Max-Age': '86400' } : {} });
    try {
      if (req.method === 'GET') {
        if (path === '/api/bridge-check') { const n = String(url.searchParams.get('n') || '').replace(/[^a-f0-9]/g, ''); return json({ ok: !!(n && await kvGet(x.db, 'bn_' + n)) }); }
        if (path === '/api/test-google') {
          const r = await fetch(env.BRIDGE_URL, { method: 'POST', headers: { 'Content-Type': 'text/plain;charset=utf-8' }, body: JSON.stringify({ type: 'crm', action: 'ping' }), redirect: 'follow' });
          const text = await r.text();
          return json({ status: r.status, url: r.url, text: text.slice(0, 500) }, origin);
        }
        if (path === '/api/status') {
          const n = async t => (await first(x.db, 'SELECT count(*) AS n FROM ' + t)).n;
          const mr = await kvGet(x.db, 'migrate_result');
          return json({ ok: true, v: API_VERSION, migrated: Number(await kvGet(x.db, 'migrated')) || null, orders: await n('orders'), customers: await n('customers'), leads: await n('leads'), users: await n('users'), mirror: Number(await kvGet(x.db, 'mirror_last')) || null, migrate: mr ? JSON.parse(mr) : null }, origin);
        }
        if (path === '/api/setup') { // bước chuyển 1 lần: tắt máy chủ cũ (Apps Script chuyển đơn web sang đây) rồi chép dữ liệu
          if (await kvGet(x.db, 'migrated')) return json({ ok: true, already: true, result: JSON.parse(await kvGet(x.db, 'migrate_result') || 'null') }, origin);
          return json(await migrate(x, { retire: url.searchParams.get('retire') !== '0', apiUrl: url.origin + '/api' }), origin);
        }
        return json({ ok: true, service: 'Thực Dưỡng Lành orders + CRM', v: API_VERSION }, origin);
      }
      if (req.method !== 'POST') return json({ ok: false, error: 'method' }, origin, 405);
      await ensureSchema(x.db);
      const text = await req.text(); if (text.length > 2e6) return json({ ok: false, error: 'Dữ liệu quá lớn' }, origin, 413);
      const d = JSON.parse(text || '{}');
      if (d.type === 'crm') { const out = await crmApi(x, d, ADMIN, DUPS); out.v = API_VERSION; return json(out, origin); }
      if (d.type === 'vtp') return json(await vtpWebhook(x, d.payload), origin);
      return json(await website(x, d), origin);
    } catch (err) {
      console.error('api', err && err.stack || err);
      return json({ ok: false, error: String(err && err.message || err), v: API_VERSION }, origin);
    }
  },
  async scheduled(ev, env, ectx) { const x = ctxOf(env, ectx); await ensureSchema(x.db); ectx.waitUntil(scheduled(x, ev.cron)); }
};
