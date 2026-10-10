// Chi phí marketing cho tab Tổng quan (chỉ Quản trị). Bảng D1 ad_spend: 1 dòng = 1 ngày × kênh × tài khoản × chiến dịch.
// 3 cách đưa số vào, dùng chung cho mọi kênh:
//   auto   – Facebook Ads tự lấy qua Meta Marketing API (mã truy cập lưu ở kv mkt_cfg, không nằm trong code). Kênh khác nối API sau: thêm 1 hàm như fbSync.
//   file   – CSV xuất từ trình quản lý quảng cáo (Facebook, TikTok, Google…): CRM đọc file trên máy, gửi các dòng lên lệnh mkt_import.
//   manual – nhập tay 1 khoản cho 1 khoảng ngày (KOL, in ấn…), chia đều theo ngày để xem theo kỳ nào cũng đúng.
import { all, first, run, insertMany, kvJson, kvSet, randHex, startOfDay, fmtDate, DAY } from './lib.js';

const FB_API = 'https://graph.facebook.com/v23.0/';
const DAY_RE = /^\d{4}-\d\d-\d\d$/;
const COLS = ['day', 'channel', 'account', 'campaign', 'spend', 'impressions', 'clicks', 'msgs', 'leads', 'purchases', 'src', 'batch', 'note', 'at'];
const UPSERT = 'ON CONFLICT(day, channel, account, campaign) DO UPDATE SET spend = excluded.spend, impressions = excluded.impressions, clicks = excluded.clicks, msgs = excluded.msgs, leads = excluded.leads, purchases = excluded.purchases, src = excluded.src, batch = excluded.batch, note = excluded.note, at = excluded.at';
const iso = t => fmtDate(t, 'yyyy-MM-dd');
const num = v => Math.max(0, Math.round(Number(v) || 0));

async function cfgOf(x) { return await kvJson(x.db, 'mkt_cfg', {}) || {}; }
async function cfgSave(x, c) { await kvSet(x.db, 'mkt_cfg', JSON.stringify(c)); }
/** Cấu hình gửi về CRM: không bao giờ gửi mã truy cập, chỉ 4 ký tự cuối. */
function cfgPublic(c) {
  const fb = c.fb || {};
  return { fb: { on: !!fb.token, tail: fb.token ? fb.token.slice(-4) : '', accounts: fb.accounts || [], all: fb.all || [], last: fb.last || null, err: fb.err || '', from: fb.from || '', listed: fb.listed || null } };
}

/* ---------------- Facebook Ads (Meta Marketing API) */
async function fbGet(token, path, params) {
  const q = new URLSearchParams(Object.assign({}, params || {}, { access_token: token }));
  const r = await fetch(path.indexOf('https://') === 0 ? path : FB_API + path + '?' + q);
  const j = await r.json().catch(() => ({}));
  if (j.error) {
    const m = j.error.message || 'lỗi', code = j.error.code;
    if (code === 190) throw new Error('Mã truy cập Facebook đã hết hạn hoặc bị thu hồi. Tạo mã mới rồi dán lại.');
    if (code === 200 || code === 10 || /permission/i.test(m)) throw new Error('Mã truy cập chưa có quyền xem tài khoản quảng cáo (cần quyền ads_read). ' + m);
    if (code === 17 || code === 4 || code === 80004) throw new Error('Facebook đang giới hạn số lần hỏi, lát nữa tự thử lại.');
    throw new Error('Facebook báo lỗi: ' + m);
  }
  return j;
}
/** Các tài khoản quảng cáo mã truy cập xem được = tự tìm (me/adaccounts, me/assigned_ad_accounts, tài khoản của các Business Manager: owned + client)
 *  ∪ mã nhập tay (manual: số / act_…, cách nhau dấu phẩy). strict: mã nhập tay mở không được thì báo lỗi (lúc kết nối), không thì bỏ qua (lúc tự tìm lại).
 *  Mã Trang / ứng dụng: báo rõ loại mã. */
async function fbAccounts(token, manual, strict) {
  const one = a => ({ id: 'act_' + a.account_id, name: a.name || a.account_id, cur: a.currency || '', st: a.account_status });
  const F = { fields: 'name,account_id,currency,account_status', limit: 100 }, seen = {}, out = [];
  const add = a => { if (a && a.id && !seen[a.id]) { seen[a.id] = 1; out.push(a); } };
  const list = async path => { let j = await fbGet(token, path, F); for (let i = 0; i < 10; i++) { (j.data || []).forEach(a => add(one(a))); if (!j.paging || !j.paging.next) break; j = await fbGet(token, j.paging.next); } };
  const soft = async p => { try { await p; } catch (e) { if (/hết hạn/.test(e.message)) throw e; } }; // nhánh không có / thiếu quyền: bỏ qua, thử nhánh khác
  let me = {}; try { me = await fbGet(token, 'me', { fields: 'id,name', metadata: 1 }); } catch (e) { if (/hết hạn|quyền/.test(e.message)) throw e; }
  const type = me.metadata && me.metadata.type;
  if (type === 'page') throw new Error('Mã này là mã của Trang “' + (me.name || '') + '”, không đọc được quảng cáo. Tạo mã ở Người dùng hệ thống (bước 2–4 bên dưới).');
  if (type === 'application') throw new Error('Mã này là mã của ứng dụng, không đọc được quảng cáo. Tạo mã ở Người dùng hệ thống (bước 2–4 bên dưới).');
  await soft(list('me/adaccounts')); await soft(list('me/assigned_ad_accounts'));
  await soft((async () => { const b = await fbGet(token, 'me/businesses', { fields: 'id,name', limit: 50 }); for (const x of b.data || []) { await soft(list(x.id + '/owned_ad_accounts')); await soft(list(x.id + '/client_ad_accounts')); } })()); // cần quyền business_management
  for (const id of String(manual || '').split(/[\s,;]+/).map(v => v.replace(/\D/g, '')).filter(Boolean)) {
    if (seen['act_' + id]) continue;
    try { add(one(await fbGet(token, 'act_' + id, { fields: F.fields }))); } catch (e) { if (strict) throw new Error('Không mở được tài khoản quảng cáo ' + id + ': ' + e.message); }
  }
  return out;
}
/** Tìm lại tài khoản (mỗi ngày 1 lần + nút "Tìm tài khoản mới"): tài khoản mới đang hoạt động tự được thêm vào danh sách lấy số. Trả về các tài khoản vừa thêm. */
async function fbRefresh(x, addManual) {
  const c = await cfgOf(x), fb = c.fb || {}; if (!fb.token) return [];
  const manual = [fb.manual || '', addManual || ''].filter(Boolean).join(',');
  const accs = await fbAccounts(fb.token, manual, !!addManual), had = {}, pick = {}, fresh = [];
  (fb.all || []).forEach(a => { had[a.id] = 1; }); (fb.accounts || []).forEach(id => { pick[id] = 1; });
  const typed = {}; String(addManual || '').split(/[\s,;]+/).map(v => v.replace(/\D/g, '')).filter(Boolean).forEach(id => { typed['act_' + id] = 1; });
  accs.forEach(a => { if ((!had[a.id] && a.st === 1) || typed[a.id]) { if (!pick[a.id]) fresh.push(a.id); pick[a.id] = 1; } });
  const c2 = await cfgOf(x); c2.fb = Object.assign({}, c2.fb, { all: accs.length ? accs : fb.all, accounts: Object.keys(pick), manual, listed: Date.now() });
  await cfgSave(x, c2);
  return fresh;
}
const ACT = (acts, re) => (acts || []).filter(a => re.test(a.action_type)).reduce((s, a) => s + (Number(a.value) || 0), 0);
/** Lấy chi phí theo ngày × chiến dịch của các tài khoản đã chọn, từ ngày since đến until (yyyy-mm-dd), ghi đè phần đó trong D1. */
export async function fbSync(x, since, until) {
  const c = await cfgOf(x), fb = c.fb || {};
  if (!fb.token || !(fb.accounts || []).length) return { ok: false, error: 'Chưa kết nối Facebook Ads.' };
  let n = 0, spend = 0; const now = Date.now(), errs = [];
  for (const acc of fb.accounts) {
    try {
      const info = (fb.all || []).find(a => a.id === acc) || {};
      if (info.cur && info.cur !== 'VND') throw new Error('Tài khoản ' + (info.name || acc) + ' dùng tiền ' + info.cur + ', CRM mới tính được VND.');
      const rows = [];
      let j = await fbGet(fb.token, acc + '/insights', { level: 'campaign', time_increment: 1, time_range: JSON.stringify({ since, until }), fields: 'campaign_name,spend,impressions,inline_link_clicks,actions', limit: 500 });
      for (let i = 0; i < 40; i++) {
        (j.data || []).forEach(d => rows.push({ day: d.date_start, channel: 'Facebook', account: acc, campaign: String(d.campaign_name || '').slice(0, 200), spend: num(d.spend), impressions: num(d.impressions), clicks: num(d.inline_link_clicks),
          msgs: num(ACT(d.actions, /messaging_conversation_started_7d$/)), leads: num(ACT(d.actions, /^(lead|onsite_conversion\.lead_grouped|offsite_conversion\.fb_pixel_lead)$/)), purchases: num(ACT(d.actions, /^(purchase|offsite_conversion\.fb_pixel_purchase|onsite_web_purchase)$/)),
          src: 'auto', batch: '', note: '', at: now }));
        if (!j.paging || !j.paging.next) break; j = await fbGet(fb.token, j.paging.next);
      }
      await run(x.db, "DELETE FROM ad_spend WHERE channel = 'Facebook' AND account = ? AND src = 'auto' AND day BETWEEN ? AND ?", acc, since, until); // chiến dịch đã tắt / về 0 không còn trong kết quả
      await insertMany(x.db, 'ad_spend', COLS, rows, UPSERT);
      n += rows.length; spend += rows.reduce((s, r) => s + r.spend, 0);
    } catch (e) { const nm = ((fb.all || []).find(a => a.id === acc) || {}).name || acc; errs.push(/quyền/.test(e.message) ? 'TK “' + nm + '” chưa gán cho người dùng hệ thống (Gán tài sản → Xem hiệu quả)' : 'TK “' + nm + '”: ' + e.message); }
  }
  const c2 = await cfgOf(x); c2.fb = Object.assign({}, c2.fb, { last: now, err: errs.join(' · ') });
  if (!errs.length && (!c2.fb.from || since < c2.fb.from)) c2.fb.from = since;
  await cfgSave(x, c2);
  return errs.length && !n ? { ok: false, error: errs.join(' · ') } : { ok: true, rows: n, spend, warn: errs.join(' · ') };
}
/** Lịch tự động (cron.js): 3 tiếng 1 lần lấy lại 3 ngày gần nhất (Facebook còn chỉnh số 1–2 ngày sau). */
export async function mktTick(x) {
  const c = await cfgOf(x), fb = c.fb || {};
  if (!fb.token || Date.now() - (fb.last || 0) < 3 * 3600e3) return;
  const t = startOfDay(Date.now());
  if (Date.now() - (fb.listed || 0) > DAY) { try { if ((await fbRefresh(x)).length) return void await syncDays(x, 90); } catch (e) { console.error('fbRefresh', e.message); } }
  await fbSync(x, iso(t - 2 * DAY), iso(t));
}

/* ---------------- lệnh CRM (chỉ Quản trị) */
/** mkt: chi phí trong kỳ (from–to) + kỳ so sánh (pf–pt): theo ngày × kênh, theo chiến dịch, tổng kỳ trước theo kênh. */
async function mktLoad(x, d) {
  if (![d.from, d.to, d.pf, d.pt].every(s => DAY_RE.test(String(s || '')))) return { ok: false, error: 'Khoảng thời gian chưa đúng.' };
  const [days, camps, prev, c] = await Promise.all([
    all(x.db, 'SELECT day, channel, SUM(spend) AS s FROM ad_spend WHERE day BETWEEN ? AND ? GROUP BY day, channel', d.from, d.to),
    all(x.db, 'SELECT channel, campaign, src, SUM(spend) AS s, SUM(impressions) AS i, SUM(clicks) AS c, SUM(msgs) AS m, SUM(leads) AS l, SUM(purchases) AS p FROM ad_spend WHERE day BETWEEN ? AND ? GROUP BY channel, campaign ORDER BY s DESC LIMIT 40', d.from, d.to),
    all(x.db, 'SELECT channel, SUM(spend) AS s, SUM(clicks) AS c, SUM(msgs) AS m, SUM(leads) AS l FROM ad_spend WHERE day BETWEEN ? AND ? GROUP BY channel', d.pf, d.pt),
    cfgOf(x)
  ]);
  return { ok: true, days: days.map(r => [r.day, r.channel, r.s]), camps: camps.map(r => [r.channel, r.campaign, r.src, r.s, r.i, r.c, r.m, r.l, r.p]), prev: prev.map(r => [r.channel, r.s, r.c, r.m, r.l]), cfg: cfgPublic(c) };
}
/** Lấy lại số days ngày gần nhất, mỗi lần 30 ngày cho nhẹ. */
async function syncDays(x, days) {
  const t = startOfDay(Date.now()); days = Math.min(400, Math.max(1, days)); const r = { ok: true, rows: 0, spend: 0 };
  for (let k = 0; k < days; k += 30) {
    const until = t - k * DAY, since = Math.max(t - (days - 1) * DAY, until - 29 * DAY);
    const p = await fbSync(x, iso(since), iso(until)); if (!p.ok) return Object.assign(p, { cfg: cfgPublic(await cfgOf(x)) });
    r.rows += p.rows; r.spend += p.spend; if (p.warn) r.warn = p.warn;
  }
  return Object.assign(r, { cfg: cfgPublic(await cfgOf(x)) });
}
/** mkt_fb: dán mã truy cập (fbToken – d.token là mã phiên CRM) → kiểm tra, liệt kê tài khoản; chọn tài khoản (accounts); đồng bộ (sync, days); ngắt (off). */
async function mktFb(x, d) {
  const c = await cfgOf(x); c.fb = c.fb || {};
  if (d.off) { c.fb = {}; await cfgSave(x, c); return { ok: true, cfg: cfgPublic(c) }; } // số đã lấy vẫn giữ
  if (d.fbToken) {
    const token = String(d.fbToken).trim();
    if (!/^[A-Za-z0-9_-]{40,}$/.test(token)) return { ok: false, error: 'Mã truy cập chưa đúng: là một dãy dài chữ và số, thường bắt đầu bằng EAA.' };
    const accs = await fbAccounts(token, d.fbAccount, true);
    if (!accs.length) return { ok: false, error: 'Mã đúng nhưng Facebook không liệt kê được tài khoản quảng cáo. Điền ô “Mã tài khoản quảng cáo” (ngay dưới ô mã truy cập) rồi bấm Kết nối lại (xem ở Trình quản lý quảng cáo: dãy số cạnh tên tài khoản, hoặc số sau act= trên thanh địa chỉ).', needAcc: true };
    c.fb = { token, all: accs, accounts: accs.filter(a => a.st === 1 || accs.length === 1).map(a => a.id), manual: String(d.fbAccount || ''), listed: Date.now(), last: null, err: '' };
    if (!c.fb.accounts.length) c.fb.accounts = accs.map(a => a.id);
    await cfgSave(x, c);
  }
  if (d.refresh || d.addAcc) { // tìm tài khoản mới / thêm mã tài khoản bằng tay → có tài khoản mới thì lấy 90 ngày
    const fresh = await fbRefresh(x, d.addAcc);
    if (!fresh.length) return { ok: true, fresh: 0, cfg: cfgPublic(await cfgOf(x)) };
    return Object.assign(await syncDays(x, 90), { fresh: fresh.length });
  }
  if (d.accounts) { const ok = (c.fb.all || []).map(a => a.id); c.fb.accounts = d.accounts.filter(a => ok.indexOf(a) >= 0); await cfgSave(x, c); }
  if (d.fbToken || d.sync) return syncDays(x, Number(d.days) || (d.fbToken ? 90 : 7)); // lần đầu: 90 ngày; bấm "Lấy lại": d.days ngày
  return { ok: true, cfg: cfgPublic(await cfgOf(x)) };
}
function chName(s) { return String(s || '').trim().slice(0, 40) || 'Khác'; }
/** mkt_import: dòng từ file CSV {day, campaign, spend, impressions, clicks, msgs, leads}. Ghi đè số file cũ của cùng kênh trong cùng các ngày. */
async function mktImport(x, u, d) {
  const ch = chName(d.channel), rows = (d.rows || []).filter(r => DAY_RE.test(r.day) && num(r.spend) > 0).slice(0, 20000);
  if (!rows.length) return { ok: false, error: 'File không có dòng chi phí nào đọc được.' };
  const batch = 'f' + randHex(5), now = Date.now(), note = String(d.file || 'file').slice(0, 120) + ' · ' + u.name;
  const days = rows.map(r => r.day).sort(), from = days[0], to = days[days.length - 1];
  const sum = {}; rows.forEach(r => { const k = r.day + '|' + String(r.campaign || '').slice(0, 200); const o = sum[k] || (sum[k] = { day: r.day, channel: ch, account: 'file', campaign: String(r.campaign || '').slice(0, 200) || '(không tên)', spend: 0, impressions: 0, clicks: 0, msgs: 0, leads: 0, purchases: 0, src: 'file', batch, note, at: now }); ['spend', 'impressions', 'clicks', 'msgs', 'leads'].forEach(f => { o[f] += num(r[f]); }); });
  await run(x.db, "DELETE FROM ad_spend WHERE channel = ? AND src = 'file' AND day BETWEEN ? AND ?", ch, from, to);
  const list = Object.values(sum); await insertMany(x.db, 'ad_spend', COLS, list, UPSERT);
  return { ok: true, rows: list.length, spend: list.reduce((s, r) => s + r.spend, 0), from, to };
}
/** mkt_add: nhập tay 1 khoản cho 1 khoảng ngày, chia đều mỗi ngày (phần lẻ dồn ngày cuối). */
async function mktAdd(x, u, d) {
  const ch = chName(d.channel), amount = num(d.amount), label = String(d.label || '').trim().slice(0, 120) || 'Nhập tay';
  if (!DAY_RE.test(d.from) || !DAY_RE.test(d.to) || d.to < d.from) return { ok: false, error: 'Chọn từ ngày – đến ngày.' };
  if (!amount) return { ok: false, error: 'Nhập số tiền.' };
  const a = new Date(d.from + 'T12:00:00+07:00').getTime(), b = new Date(d.to + 'T12:00:00+07:00').getTime(), n = Math.round((b - a) / DAY) + 1;
  if (n > 400) return { ok: false, error: 'Tối đa 400 ngày cho 1 lần nhập.' };
  const batch = 'm' + randHex(5), each = Math.floor(amount / n), now = Date.now(), rows = [];
  for (let i = 0; i < n; i++) rows.push({ day: iso(a + i * DAY), channel: ch, account: batch, campaign: label, spend: i === n - 1 ? amount - each * (n - 1) : each, impressions: 0, clicks: 0, msgs: 0, leads: 0, purchases: 0, src: 'manual', batch, note: u.name, at: now });
  await insertMany(x.db, 'ad_spend', COLS, rows, UPSERT);
  return { ok: true, batch };
}
/** mkt_list: các lần nhập tay / nhập file (để xem lại, xoá). */
async function mktList(x) {
  const rows = await all(x.db, "SELECT batch, channel, src, MIN(day) AS f, MAX(day) AS t, SUM(spend) AS s, MIN(campaign) AS c, COUNT(DISTINCT campaign) AS n, MAX(note) AS note, MAX(at) AS at FROM ad_spend WHERE src IN ('manual', 'file') AND batch != '' GROUP BY batch ORDER BY at DESC LIMIT 100");
  return { ok: true, list: rows.map(r => ({ batch: r.batch, channel: r.channel, src: r.src, from: r.f, to: r.t, spend: r.s, label: r.n > 1 ? r.n + ' chiến dịch' : r.c, note: r.note, at: r.at })) };
}
async function mktDel(x, d) {
  if (!/^[mf][a-f0-9]{10}$/.test(String(d.batch || ''))) return { ok: false, error: 'Không rõ lần nhập.' };
  await run(x.db, 'DELETE FROM ad_spend WHERE batch = ?', d.batch);
  return { ok: true };
}

export async function crmMkt(x, u, d) {
  if (u.level < 3) return { ok: false, error: 'Chỉ Quản trị xem / sửa được chi phí marketing.' };
  switch (d.action) {
    case 'mkt': return mktLoad(x, d);
    case 'mkt_fb': return mktFb(x, d);
    case 'mkt_import': return mktImport(x, u, d);
    case 'mkt_add': return mktAdd(x, u, d);
    case 'mkt_list': return mktList(x);
    case 'mkt_del': return mktDel(x, d);
  }
  return { ok: false, error: 'Không rõ thao tác: ' + d.action };
}
