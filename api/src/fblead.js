/* ================================================================ 📋 Biểu mẫu Facebook → CRM + 📡 báo kết quả về Facebook (18/11/2026, anh Sơn "Làm việc CRM trước")
 * Vì sao: tháng 11 Meta đếm 94 người để lại thông tin nhưng file số quảng cáo chỉ có 58 số (nhập tay bị sót, chậm); mọi chiến dịch chạy "Mua qua tin nhắn"
 * nên Facebook không biết khách nào mua (sale chốt qua điện thoại) → máy không học được. Giá 1 số ~960k trong khi trần ~270k (chốt 37% × lãi đơn đầu 730k).
 *
 * 1) Nhận số từ Biểu mẫu tức thì (Instant Form) của mọi fanpage đã kết nối ở tab 📘 Fanpage (bảng fp_pages, dùng chung mã trang):
 *    - webhook trường "leadgen" (fb.js gọi flHook) → về ngay;
 *    - cron 10 phút / lần quét lại /{trang}/leadgen_forms → /{form}/leads (phòng khi webhook chưa chạy: app chưa Live / chưa xin quyền).
 *    Mỗi số: khách hỏi kênh "Quảng cáo – Form FB" (addLead, by_name 'Form FB'), tự chia sale theo nhóm A/B/C như file số QC (adsPick, chung kv ads_wrr)
 *    trừ khi Quản trị chọn "người trực chia"; báo Telegram sale + nhóm; ghi vào ads_rows (danh sách số quảng cáo mọi báo cáo đang dùng) và phone_seen.
 *    adsSync (sync.js) gộp lại các số này mỗi lần dựng ads_rows (flRegRows) và không tạo trùng nếu người trực lỡ chép số vào file.
 * 2) Báo ngược về Facebook (Conversions API, Pixel website 2205980853628210 – meta-pixel-moi): chỉ khách đến từ quảng cáo (biểu mẫu, khách hỏi kênh Quảng cáo / Facebook).
 *    - "Contacted": số biểu mẫu sale gọi được (nhật ký Tư vấn khác "Không nghe máy", không phải số rác / sai số) → Facebook học tìm người nghe máy;
 *    - "Purchase": đơn đầu (không huỷ / hoàn) trong 30 ngày sau lúc hỏi, kèm tiền.
 *    Số điện thoại băm SHA-256 trước khi gửi (Facebook không nhận số thật). Số biểu mẫu gửi kèm lead_id (tích hợp CRM của Meta, action_source system_generated).
 *    Chỉ gửi sự kiện ≤ 6 ngày (Facebook từ chối sự kiện quá 7 ngày). Mỗi sự kiện 1 lần (bảng capi_log).
 * Cài đặt: kv fl_cfg { on (báo Facebook), pixel, token (mã Conversions API; trống = dùng mã Facebook Ads ở tab Marketing), test (mã thử Events Manager), split: 'auto' | 'staff' }.
 * Mã truy cập không bao giờ gửi về CRM (chỉ 4 ký tự cuối). */
import { esc, run, all, first, allIn, kvGet, kvSet, kvJson, normPhone, fmtDate, insertMany, hashKey, CRM_URL, DAY } from './lib.js';
import { telegram } from './google.js';
import { addLead, telegramUser, crmUsers, mainPhone, ownerOf } from './crm.js';
import { adsTier, tierOf, TIER, adsDutyPool } from './salemkt.js';
import { fpTracked } from './fb.js';

let GRAPH = 'https://graph.facebook.com/v23.0/';
const useEnv = x => { if (x.env.FB_GRAPH) GRAPH = x.env.FB_GRAPH; };
const PIXEL0 = '2205980853628210';
const LEAD_FIELDS = 'id,created_time,field_data,ad_id,ad_name,adset_name,campaign_name,form_id,platform,is_organic';
const CH = 'Quảng cáo – Form FB', BY = 'Form FB';
const MAX_AGE = 6 * DAY; // Facebook nhận sự kiện trong 7 ngày
const JUNK = /rác|rac\b|sai số|sai so|ảo|nhầm số|không phải|khong phai|trùng/i;

let ready = false;
async function flSchema(db) {
  if (ready) return; // bảng tự tạo, không cần SCHEMA_V (như sanai.js)
  await run(db, `CREATE TABLE IF NOT EXISTS fl_leads (lead_id TEXT PRIMARY KEY, page TEXT DEFAULT '', form TEXT DEFAULT '', form_name TEXT DEFAULT '', ad_name TEXT DEFAULT '', adset TEXT DEFAULT '',
    campaign TEXT DEFAULT '', phone TEXT DEFAULT '', name TEXT DEFAULT '', answers TEXT DEFAULT '', crm_lead TEXT DEFAULT '', owner TEXT DEFAULT '', at INTEGER, got_at INTEGER, via TEXT DEFAULT '', contacted_at INTEGER)`);
  await run(db, 'CREATE INDEX IF NOT EXISTS fl_leads_at ON fl_leads(at)');
  await run(db, `CREATE TABLE IF NOT EXISTS capi_log (k TEXT PRIMARY KEY, at INTEGER, ev TEXT DEFAULT '', ev_at INTEGER, src TEXT DEFAULT '', value INTEGER DEFAULT 0, ok INTEGER DEFAULT 0, err TEXT DEFAULT '')`);
  await run(db, 'CREATE INDEX IF NOT EXISTS capi_log_at ON capi_log(at)');
  ready = true;
}
async function cfgOf(x) { return Object.assign({ on: false, pixel: PIXEL0, token: '', test: '', split: 'auto' }, await kvJson(x.db, 'fl_cfg', {}) || {}); }
const dayOf = t => Math.floor((t + 7 * 3600e3) / DAY) * DAY - 7 * 3600e3;

async function gget(path, token) {
  const r = await fetch(GRAPH + path + (path.indexOf('?') < 0 ? '?' : '&') + 'access_token=' + encodeURIComponent(token));
  const j = await r.json().catch(() => ({}));
  if (j.error) { const e = new Error(j.error.error_user_msg || j.error.message || 'Facebook báo lỗi'); e.code = j.error.code; throw e; }
  return j;
}
async function setErr(x, msg) { await kvSet(x.db, 'fl_err', msg ? fmtDate(Date.now(), 'HH:mm dd/MM') + ': ' + String(msg).slice(0, 300) : ''); }
const permHint = e => /leads_retrieval|permission|\(#200\)|\(#10\)|pages_manage_ads/i.test(e.message || '') || [10, 200].includes(e.code)
  ? 'Mã trang chưa có quyền đọc biểu mẫu (leads_retrieval, pages_manage_ads). Vào tab 📘 Fanpage → Kết nối fanpage lại và tích đủ quyền. (' + e.message + ')' : e.message;

/* ---------------------------------------------------------------- chia sale: giống file số QC khi CRM chia (nhóm A 3 lượt, B 2, C 1; trần 10 số / người / ngày) */
async function adsPick(x) {
  const all0 = await crmUsers(x), users = all0.filter(y => y.active && y.recv && y.alias); let pool = users.map(y => y.name); if (!pool.length) return '';
  pool = (await adsDutyPool(x, pool, all0)).pool; // 🌙 tối / CN / lễ: chỉ người trực
  const wrr = (await kvJson(x.db, 'ads_wrr', null)) || {}; wrr.cur = wrr.cur || {};
  const tier = await adsTier(x), day = fmtDate(Date.now(), 'yyyyMMdd'); if (wrr.day !== day) { wrr.day = day; wrr.cnt = {}; }
  let cand = pool.filter(n => (wrr.cnt[n] || 0) < 10); if (!cand.length) cand = pool;
  const w = n => (TIER[tierOf(tier, n).g] || TIER.B).w, sum = cand.reduce((a, n) => a + w(n), 0); let best = cand[0];
  cand.forEach(n => { wrr.cur[n] = (wrr.cur[n] || 0) + w(n); if (wrr.cur[n] > wrr.cur[best]) best = n; });
  wrr.cur[best] -= sum; wrr.cnt[best] = (wrr.cnt[best] || 0) + 1;
  await kvSet(x.db, 'ads_wrr', JSON.stringify(wrr)); return best;
}

/* ---------------------------------------------------------------- nhận 1 khách từ biểu mẫu */
function parseLead(L) {
  let phone = '', name = '', first0 = '', last0 = ''; const ans = [];
  for (const f of L.field_data || []) {
    const k = String(f.name || '').toLowerCase(), v = String((f.values || [])[0] || '').trim(); if (!v) continue;
    if (!phone && /phone|sdt|so_dien_thoai|điện thoại|dien_thoai|zalo/.test(k) && normPhone(v).length >= 10) phone = normPhone(v);
    else if (k === 'full_name' || k === 'ho_ten' || k === 'name' || k === 'customer_name' || k === 'ten' || k === 'ho_va_ten') name = v; // customer_name: biểu mẫu tin nhắn / quảng cáo tương tác
    else if (k === 'thread_link') continue;
    else if (k === 'first_name') first0 = v; else if (k === 'last_name') last0 = v;
    else if (!/email|city|province|street/.test(k)) ans.push(String(f.name).replace(/_/g, ' ') + ': ' + v);
  }
  if (!name) name = [last0, first0].filter(String).join(' ');
  return { phone, name: name.slice(0, 80), answers: ans.join(' · ').slice(0, 500) };
}
async function ingest(x, p, L, via) {
  await flSchema(x.db);
  const id = String(L.id || ''); if (!id || await first(x.db, 'SELECT 1 FROM fl_leads WHERE lead_id = ?', id)) return false;
  const cfg = await cfgOf(x), o = parseLead(L), at = Date.parse(L.created_time || '') || Date.now(), now = Date.now();
  const formName = String(L.form_name || ''), camp = String(L.campaign_name || '');
  const ok = /^0\d{9,10}$/.test(o.phone), phone = ok ? await mainPhone(x, o.phone) : '';
  let owner = '', ld = null;
  if (ok) {
    const open = await first(x.db, "SELECT owner FROM leads WHERE phone = ? AND status IN ('Mới hỏi', 'Đang tư vấn') ORDER BY rid DESC LIMIT 1", phone);
    owner = (await ownerOf(x, phone)) || (open && open.owner) || (cfg.split === 'staff' ? '' : await adsPick(x));
    ld = await addLead(x, { name: o.name || 'Khách biểu mẫu FB', phone, channel: CH, interest: camp || formName || 'Biểu mẫu Facebook', owner, by: BY, addInterest: true,
      note: 'Biểu mẫu Facebook' + (formName ? ' “' + formName + '”' : '') + ' – trang ' + (p.name || p.id) + (camp ? ' · Chiến dịch: ' + camp : '') + (L.ad_name ? ' · Mẫu QC: ' + L.ad_name : '') + (o.answers ? ' · Trả lời: ' + o.answers : '') + (L.is_organic ? ' · (không qua quảng cáo)' : '') });
    owner = ld.owner || owner;
  }
  await run(x.db, 'INSERT OR IGNORE INTO fl_leads (lead_id, page, form, form_name, ad_name, adset, campaign, phone, name, answers, crm_lead, owner, at, got_at, via) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
    id, String(p.id), String(L.form_id || ''), formName.slice(0, 120), String(L.ad_name || '').slice(0, 160), String(L.adset_name || '').slice(0, 160), camp.slice(0, 160), phone, o.name, o.answers, ld ? ld.id : '', owner, at, now, via);
  if (!ok) { await telegram(x.env, '⚠️ <b>Biểu mẫu Facebook: số điện thoại không đúng</b> – trang ' + esc(p.name) + '\n👤 ' + esc(o.name || '?') + (o.answers ? '\n📝 ' + esc(o.answers) : '') + '\n👉 Xem trong Trung tâm khách hàng tiềm năng của Meta'); return true; }
  // danh sách số quảng cáo mọi báo cáo dùng (giá 1 số, số về cho sale, tỷ lệ chốt) – adsSync dựng lại sẽ gộp từ fl_leads
  const rows = await kvJson(x.db, 'ads_rows', []) || [];
  if (!rows.some(r => r[1] === phone && Math.abs(Number(r[0]) - dayOf(at)) <= DAY)) { rows.push([dayOf(at), phone, owner, 'Form FB', camp]); const js = JSON.stringify(rows); await kvSet(x.db, 'ads_rows', js); await kvSet(x.db, 'ads_rows_v', hashKey(js)); }
  try { await insertMany(x.db, 'phone_seen', ['phone', 'at', 'src'], [{ phone, at, src: 'Form FB' }], 'ON CONFLICT(phone) DO UPDATE SET at = excluded.at, src = excluded.src WHERE excluded.at < phone_seen.at'); } catch (e) { }
  const m = '📋 <b>SỐ MỚI TỪ BIỂU MẪU FACEBOOK</b>\n👤 ' + esc(o.name || 'Chưa có tên') + ' – <a href="https://zalo.me/' + phone + '">' + phone + '</a>' + (camp ? '\n📣 ' + esc(camp) : '') + (o.answers ? '\n📝 ' + esc(o.answers) : '')
    + (ld && ld.merged ? '\n🔁 Số này đang có khách hỏi mở – đã ghi nối' : '') + '\n👉 Gọi trong 5 phút: khách vừa điền xong, đang nhớ mình';
  await telegram(x.env, m + (owner ? '\n\n👤 Giao cho: ' + esc(owner) : '\n\n⚠️ Chưa có người phụ trách – vào CRM giao ngay: ' + CRM_URL + '/#tiem-nang'));
  if (owner) await telegramUser(x, owner, m + '\n\n👉 ' + CRM_URL + '/#tiem-nang');
  return true;
}

/** webhook trường leadgen (fb.js hook): { leadgen_id, form_id, page_id, ad_id, created_time } */
export async function flHook(x, p, v) {
  useEnv(x);
  if (!v || !v.leadgen_id || !p.token) return;
  if (!(await fpTracked(x)).has(String(p.id))) return; // 📌 trang không theo dõi
  try {
    const L = await gget(String(v.leadgen_id) + '?fields=' + LEAD_FIELDS, p.token);
    if (v.form_id && !L.form_name) { try { L.form_name = (await gget(String(v.form_id) + '?fields=name', p.token)).name || ''; } catch (e) { } }
    await ingest(x, p, L, 'webhook'); await kvSet(x.db, 'fl_hook_at', String(Date.now()));
    if (v.form_id) await formKeep(x, String(v.form_id), String(p.id));
  } catch (e) { console.error('flHook', e.message); await setErr(x, 'Webhook: ' + permHint(e)); }
}

/** Biểu mẫu không có trong /{trang}/leadgen_forms (vd biểu mẫu tự tạo của quảng cáo tương tác / tin nhắn – 18/11/2026 khách thử bị sót vì vậy)
 *  → nhớ form_id lấy từ webhook / khách đã về (kv fl_xforms {form: trang}, giữ 60 ngày) để lượt quét đọc cả các biểu mẫu này. */
async function formKeep(x, form, page) {
  const m = await kvJson(x.db, 'fl_xforms', {}) || {}; if (m[form] && Date.now() - m[form].t < DAY) return;
  m[form] = { p: page, t: Date.now() }; for (const k of Object.keys(m)) if (Date.now() - m[k].t > 60 * DAY) delete m[k];
  await kvSet(x.db, 'fl_xforms', JSON.stringify(m));
}
/** Quét biểu mẫu mọi trang (cron 10 phút / lần + nút 🔄 Quét ngay). Lần đầu lấy 2 ngày gần nhất. */
async function scan(x) {
  useEnv(x); await flSchema(x.db);
  const tk = await fpTracked(x), pages = (await all(x.db, "SELECT id, name, token FROM fp_pages WHERE token != ''")).filter(p => tk.has(String(p.id))); if (!pages.length) return { pages: 0, got: 0 }; // 📌 chỉ trang theo dõi
  let got = 0, forms = 0, seen = 0, err = ''; const xf = await kvJson(x.db, 'fl_xforms', {}) || {};
  for (const p of pages) {
    const sk = 'fl_since_' + p.id, since = Number(await kvGet(x.db, sk)) || Date.now() - 2 * DAY, t0 = Date.now();
    try {
      const fl = await gget(p.id + '/leadgen_forms?fields=id,name,status&limit=100', p.token), list = (fl.data || []).filter(f => f.status !== 'DELETED');
      for (const [id, o] of Object.entries(xf)) if (o.p === String(p.id) && !list.some(f => f.id === id)) list.push({ id, name: '' });
      for (const f of list) { // gồm cả biểu mẫu lưu trữ (18/11/2026: khách thử của biểu mẫu lưu trữ bị bỏ sót)
        forms++;
        const filt = encodeURIComponent(JSON.stringify([{ field: 'time_created', operator: 'GREATER_THAN', value: Math.floor((since - 10 * 60e3) / 1000) }]));
        const j = await gget(f.id + '/leads?fields=' + LEAD_FIELDS + '&filtering=' + filt + '&limit=200', p.token);
        for (const L of j.data || []) { seen++; L.form_name = f.name; if (await ingest(x, p, L, 'quét')) got++; }
      }
      await kvSet(x.db, sk, String(t0));
    } catch (e) { if (!err) err = (p.name || p.id) + ': ' + permHint(e); }
  }
  await kvSet(x.db, 'fl_scan_at', String(Date.now())); await kvSet(x.db, 'fl_forms', String(forms)); await kvSet(x.db, 'fl_diag', JSON.stringify({ at: Date.now(), pages: pages.length, forms, seen, got })); await setErr(x, err);
  return { pages: pages.length, forms, seen, got, err };
}

/** Số biểu mẫu để adsSync gộp khi dựng lại ads_rows: [ngày, sđt, sale, nguồn] */
export async function flRegRows(x, from) {
  try { await flSchema(x.db); return (await all(x.db, "SELECT at, phone, owner, campaign FROM fl_leads WHERE at >= ? AND phone != ''", from)).map(r => [dayOf(r.at), r.phone, r.owner || '', 'Form FB', String(r.campaign || '')]); }
  catch (e) { return []; }
}

/* ---------------------------------------------------------------- 📡 báo kết quả về Facebook (Conversions API) */
async function sha(s) { const b = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(s)); return [...new Uint8Array(b)].map(v => v.toString(16).padStart(2, '0')).join(''); }
const e164 = p => '84' + String(p).replace(/^0/, '');
async function tokenOf(x, cfg) { if (cfg.token) return cfg.token; const m = await kvJson(x.db, 'mkt_cfg', {}) || {}; return (m.fb && m.fb.token) || ''; }
async function sendEvents(x, cfg, evs) {
  const token = await tokenOf(x, cfg); if (!token) throw new Error('Chưa có mã Conversions API (dán ở ô Mã truy cập, hoặc kết nối Facebook Ads ở tab Marketing).');
  const body = { data: evs }; if (cfg.test) body.test_event_code = cfg.test;
  const r = await fetch(GRAPH + (cfg.pixel || PIXEL0) + '/events?access_token=' + encodeURIComponent(token), { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  const j = await r.json().catch(() => ({}));
  if (j.error) throw new Error(j.error.error_user_msg || j.error.message || 'Facebook báo lỗi');
  return j;
}
async function evOf(name, at, phone, leadId, value, key) {
  const ud = { ph: [await sha(e164(phone))], country: [await sha('vn')] };
  const e = { event_name: name, event_time: Math.floor(at / 1000), event_id: key, user_data: ud, custom_data: {} };
  if (leadId && /^\d{1,20}$/.test(leadId)) { ud.lead_id = Number.isSafeInteger(Number(leadId)) ? Number(leadId) : String(leadId); e.action_source = 'system_generated'; e.custom_data.event_source = 'crm'; e.custom_data.lead_event_source = 'Thuc Duong Lanh CRM'; }
  else e.action_source = 'phone_call';
  if (value) { e.custom_data.value = value; e.custom_data.currency = 'VND'; }
  return e;
}
async function capiTick(x, cfg) {
  await flSchema(x.db);
  const now = Date.now(), evs = [], logs = [];
  const done = async keys => { const s = new Set(); (await allIn(x.db, 'SELECT k FROM capi_log WHERE k IN (SELECT value FROM json_each(?))', keys)).forEach(r => s.add(r.k)); return s; };
  // 1) Contacted: số biểu mẫu đã gọi được
  const fl = await all(x.db, "SELECT lead_id, phone, at, crm_lead FROM fl_leads WHERE contacted_at IS NULL AND phone != '' AND at > ? LIMIT 300", now - 28 * DAY);
  if (fl.length) {
    const lg = {}; (await allIn(x.db, "SELECT ref, min(time) t FROM logs WHERE ref IN (SELECT value FROM json_each(?)) AND what = 'Tư vấn' AND result NOT LIKE 'Không nghe%' AND time > ? GROUP BY ref", fl.map(r => r.phone), now - 30 * DAY)).forEach(r => { lg[r.ref] = r.t; });
    const st = {}; (await allIn(x.db, 'SELECT id, status, reason FROM leads WHERE id IN (SELECT value FROM json_each(?))', fl.map(r => r.crm_lead).filter(String))).forEach(r => { st[r.id] = r; });
    const seen = await done(fl.map(r => 'c_' + r.lead_id));
    for (const r of fl) {
      const t = lg[r.phone]; if (!t || t < r.at - 60e3) continue;
      const l = st[r.crm_lead]; if (l && l.status === 'Không mua' && JUNK.test(l.reason || '')) { await run(x.db, 'UPDATE fl_leads SET contacted_at = ? WHERE lead_id = ?', -1, r.lead_id); continue; }
      await run(x.db, 'UPDATE fl_leads SET contacted_at = ? WHERE lead_id = ?', t, r.lead_id);
      const k = 'c_' + r.lead_id; if (seen.has(k) || now - t > MAX_AGE) continue;
      evs.push(await evOf('Contacted', t, r.phone, r.lead_id, 0, k)); logs.push({ k, at: now, ev: 'Contacted', ev_at: t, src: 'Form FB', value: 0 });
    }
  }
  // 2) Purchase: đơn trong 6 ngày qua của khách đến từ quảng cáo (biểu mẫu / khách hỏi kênh Quảng cáo, Facebook) – đơn trong 30 ngày sau lúc hỏi
  const src = {};
  (await all(x.db, "SELECT phone, min(time) t FROM leads WHERE time > ? AND (channel LIKE 'Quảng cáo%' OR channel LIKE 'Facebook%' OR by_name IN ('File QC', 'Form FB')) GROUP BY phone", now - 40 * DAY)).forEach(r => { src[r.phone] = { t: r.t }; });
  (await all(x.db, "SELECT lead_id, phone, at FROM fl_leads WHERE at > ? AND phone != ''", now - 40 * DAY)).forEach(r => { src[r.phone] = { t: Math.min(r.at, (src[r.phone] || {}).t || r.at), lead: r.lead_id }; });
  const phones = Object.keys(src);
  if (phones.length) {
    const od = await allIn(x.db, "SELECT id, phone, time, total, status FROM orders WHERE phone IN (SELECT value FROM json_each(?)) AND time > ? AND id != ''", phones, now - MAX_AGE);
    const seen = await done(od.map(o => 'p_' + o.id));
    for (const o of od) {
      const s = src[o.phone], k = 'p_' + o.id;
      if (!s || seen.has(k) || /huỷ|hủy|hoàn/i.test(o.status || '') || o.time < s.t - DAY || o.time > s.t + 30 * DAY) continue;
      evs.push(await evOf('Purchase', o.time, o.phone, s.lead, Number(o.total) || 0, k)); logs.push({ k, at: now, ev: 'Purchase', ev_at: o.time, src: s.lead ? 'Form FB' : 'Quảng cáo', value: Number(o.total) || 0 });
    }
  }
  if (!evs.length) return { sent: 0 };
  let sent = 0, err = '';
  for (let i = 0; i < evs.length && i < 200; i += 50) {
    const part = evs.slice(i, i + 50), lp = logs.slice(i, i + 50);
    try { await sendEvents(x, cfg, part); sent += part.length; lp.forEach(l => { l.ok = 1; l.err = ''; }); }
    catch (e) { err = e.message; lp.forEach(l => { l.ok = 0; l.err = String(e.message).slice(0, 200); }); }
    await insertMany(x.db, 'capi_log', ['k', 'at', 'ev', 'ev_at', 'src', 'value', 'ok', 'err'], lp.filter(l => l.ok), 'ON CONFLICT(k) DO NOTHING'); // lỗi thì lần sau gửi lại
  }
  await kvSet(x.db, 'capi_err', err ? fmtDate(now, 'HH:mm dd/MM') + ': ' + err.slice(0, 300) : '');
  if (err) { const tk = 'capi_errtg_' + fmtDate(now, 'yyMMdd'); if (!await kvGet(x.db, tk)) { await kvSet(x.db, tk, '1', 2 * DAY); await telegram(x.env, '⚠️ <b>Báo kết quả về Facebook bị lỗi</b>\n' + esc(err) + '\n👉 ' + CRM_URL + '/#marketing (🧰 Công cụ → 📋 Biểu mẫu FB)'); } }
  return { sent, err };
}

/** cron 10 phút / lần (7h–22h) */
export async function flTick(x) {
  const pages = await first(x.db, "SELECT count(*) n FROM fp_pages WHERE token != ''").catch(() => null);
  if (pages && pages.n) { try { await scan(x); } catch (e) { console.error('flScan', e.message); } }
  const cfg = await cfgOf(x);
  if (cfg.on) { try { await capiTick(x, cfg); } catch (e) { console.error('capi', e.message); } }
}

/* ---------------------------------------------------------------- CRM: fl_view (Marketing, Quản lý, Quản trị) · fl_scan · fl_save, fl_test (Quản trị) */
const mask = p => p ? String(p).slice(0, 4) + '***' + String(p).slice(-3) : '';
export async function crmFl(x, u, d, crmLog) {
  useEnv(x); await flSchema(x.db);
  const a = d.action, admin = u.level >= 3, mkt = u.role === 'Marketing' || u.level >= 2;
  if (!mkt) return { ok: false, error: 'Bạn chưa có quyền xem mục này.' };
  if ((a === 'fl_save' || a === 'fl_test') && !admin) return { ok: false, error: 'Chỉ Quản trị sửa được mục này.' };
  const cfg = await cfgOf(x);
  if (a === 'fl_save') {
    const c = d.cfg || {}, n = Object.assign({}, cfg, { on: !!c.on, pixel: String(c.pixel || PIXEL0).replace(/\D/g, '') || PIXEL0, test: String(c.test || '').trim().slice(0, 40), split: c.split === 'staff' ? 'staff' : 'auto' });
    if (c.key !== undefined && String(c.key).trim()) n.token = String(c.key).trim(); if (c.clearToken) n.token = ''; // gửi tên 'key' (tên 'token' đè mã phiên CRM)
    await kvSet(x.db, 'fl_cfg', JSON.stringify(n));
    await crmLog(x, u, 'Cài đặt', '-', '', 'Biểu mẫu FB: ' + (n.split === 'staff' ? 'người trực chia' : 'tự chia A/B/C') + ' · Báo Facebook: ' + (n.on ? 'bật' : 'tắt') + (n.test ? ' (mã thử ' + n.test + ')' : ''), '');
    return { ok: true };
  }
  if (a === 'fl_scan') { const r = await scan(x); return { ok: !r.err, error: r.err || '', got: r.got || 0, forms: r.forms || 0, pages: r.pages || 0 }; }
  if (a === 'fl_test') {
    try { const r = await sendEvents(x, Object.assign({}, cfg, { test: String(d.test || cfg.test || '').trim() || undefined }), [{ event_name: 'Contacted', event_time: Math.floor(Date.now() / 1000), event_id: 'test_' + Date.now(), action_source: 'phone_call', user_data: { ph: [await sha('84900000000')], country: [await sha('vn')] }, custom_data: {} }]);
      return { ok: true, received: r.events_received || 0 }; } catch (e) { return { ok: false, error: e.message }; }
  }
  // fl_view
  const now = Date.now(), t0 = dayOf(now);
  const [list, c7, ct, cap, capiErr, err, scanAt, hookAt, forms, tk] = await Promise.all([
    all(x.db, 'SELECT f.lead_id, f.at, f.name, f.phone, f.form_name, f.campaign, f.owner, f.via, f.contacted_at, l.status FROM fl_leads f LEFT JOIN leads l ON l.id = f.crm_lead ORDER BY f.at DESC LIMIT 15'),
    first(x.db, 'SELECT count(*) n, sum(CASE WHEN contacted_at > 0 THEN 1 ELSE 0 END) c FROM fl_leads WHERE at >= ?', now - 7 * DAY),
    first(x.db, 'SELECT count(*) n FROM fl_leads WHERE at >= ?', t0),
    all(x.db, 'SELECT ev, count(*) n, sum(value) v FROM capi_log WHERE at >= ? AND ok = 1 GROUP BY ev', now - 7 * DAY),
    kvGet(x.db, 'capi_err'), kvGet(x.db, 'fl_err'), kvGet(x.db, 'fl_scan_at'), kvGet(x.db, 'fl_hook_at'), kvGet(x.db, 'fl_forms'), tokenOf(x, cfg)
  ]);
  const trk = await fpTracked(x), pages = (await all(x.db, "SELECT id, name FROM fp_pages WHERE token != ''")).filter(p => trk.has(String(p.id)));
  const bp = {}; (await all(x.db, 'SELECT page, count(*) n, sum(CASE WHEN contacted_at > 0 THEN 1 ELSE 0 END) c FROM fl_leads WHERE at >= ? GROUP BY page', now - 7 * DAY)).forEach(r => { bp[r.page] = r; });
  const seePhone = u.level >= 2; // Marketing không xem số khách (NĐ 13/2023) – như tab Marketing
  return { ok: true, admin,
    cfg: { on: cfg.on, pixel: cfg.pixel, test: cfg.test, split: cfg.split, tail: cfg.token ? cfg.token.slice(-4) : '', own: !!cfg.token, has: !!tk },
    pages: pages.map(p => p.name), byPage: pages.map(p => ({ name: p.name, n: (bp[p.id] || {}).n || 0, c: (bp[p.id] || {}).c || 0 })).filter(r => r.n).sort((a, b) => b.n - a.n), forms: Number(forms) || 0, scanAt: Number(scanAt) || 0, hookAt: Number(hookAt) || 0, err: err || '', capiErr: capiErr || '',
    n7: (c7 && c7.n) || 0, c7: (c7 && c7.c) || 0, today: (ct && ct.n) || 0, cap: Object.fromEntries(cap.map(r => [r.ev, { n: r.n, v: r.v || 0 }])),
    list: list.map(r => ({ at: r.at, name: seePhone ? r.name : '', phone: seePhone ? r.phone : mask(r.phone), form: r.form_name, camp: r.campaign, owner: r.owner, via: r.via, ok: r.contacted_at > 0, junk: r.contacted_at === -1, status: r.status || '' })) };
}
