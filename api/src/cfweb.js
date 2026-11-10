// Lượt vào website đếm bằng Cloudflare Web Analytics (10/11/2026) cho khối 🌐 Website ở tab Tổng quan (chỉ Quản trị).
// Vì sao cần thêm: Google Analytics chỉ chạy sau khi khách bấm "Đồng ý" cookie (Luật 91/2025) nên đếm thiếu; Cloudflare đếm
// không dùng cookie, không thu thập dữ liệu cá nhân → đủ 100% lượt vào. Lượt vào lấy ở đây, hành vi (ở lại xem, phễu, nguồn) vẫn từ GA4.
// Cài 1 lần: Quản trị dán mã API Cloudflare (quyền Account Analytics: Read) ở Tổng quan → khối Website; máy chủ tự tìm mã tài khoản
// và mã site (siteTag) của thucduonglanh.vn, lưu kv cf_wa = {token, acct, site, host}. Kết quả lưu tạm như GA4 (có hôm nay 30 phút, đã qua 12 tiếng).
// Số liệu Cloudflare giữ 6 tháng; khoảng cũ hơn trả 0.
import { kvSet, kvDel, kvJson, TZ_MS, DAY } from './lib.js';

const GQL = 'https://api.cloudflare.com/client/v4/graphql';
const REST = 'https://api.cloudflare.com/client/v4/';
const HOST_RE = /(^|\.)thucduonglanh\.vn$/i;
const DAY_RE = /^\d{4}-\d\d-\d\d$/;

/** Lỗi cần Quản trị làm thêm 1 bước (step: token | acct | site) → CRM hiện hướng dẫn đúng chỗ. */
function setupErr(step, msg, extra) { const e = new Error(msg); e.setup = step; Object.assign(e, extra || {}); return e; }

async function gql(token, query) {
  const r = await fetch(GQL, { method: 'POST', headers: { Authorization: 'Bearer ' + token, 'Content-Type': 'application/json' }, body: JSON.stringify({ query }) });
  const t = await r.text(); let j = {}; try { j = JSON.parse(t); } catch (e) { }
  if (r.status === 401 || r.status === 403) throw setupErr('token', 'Cloudflare không nhận mã API này (lỗi ' + r.status + '). Tạo lại mã có quyền Account Analytics: Read rồi dán lại.');
  const errs = (j.errors || []).map(e => e.message).join('; ');
  if (errs) {
    if (/not authorized|unauthorized|permission|authentication/i.test(errs)) throw setupErr('token', 'Mã API chưa có quyền Account Analytics: Read (' + errs.slice(0, 120) + ').');
    throw new Error('Cloudflare báo lỗi: ' + errs.slice(0, 200));
  }
  if (!r.ok) throw new Error('Cloudflare báo lỗi ' + r.status + ': ' + t.slice(0, 200));
  return j.data || {};
}

/** Kiểm tra mã API còn dùng được không (GET /user/tokens/verify – mọi mã đều gọi được). */
async function verifyToken(token) {
  const r = await fetch(REST + 'user/tokens/verify', { headers: { Authorization: 'Bearer ' + token } });
  let j = {}; try { j = await r.json(); } catch (e) { }
  if (r.ok && j.success && j.result && /active/i.test(j.result.status || '')) return;
  const m = (((j.errors || [])[0] || {}).message) || ('lỗi ' + r.status);
  throw setupErr('token', 'Cloudflare không nhận mã này (' + m + '). Mã thật dài khoảng 40 ký tự và chỉ hiện 1 lần lúc bấm Create Token hoặc Roll; dãy 32 ký tự "Token ID" ở danh sách không phải mã. Nếu đã lỡ đóng màn hình thì bấm ⋯ → Roll ở dòng token để lấy mã mới.');
}
/** Các tài khoản Cloudflare mà mã API xem được → [{id, name}]. Mã hợp lệ nhưng không liệt kê được → [] (CRM hỏi Account ID). */
async function listAccounts(token) {
  await verifyToken(token);
  const r = await fetch(REST + 'accounts?per_page=50', { headers: { Authorization: 'Bearer ' + token } });
  let j = {}; try { j = await r.json(); } catch (e) { }
  return r.ok && j.success ? (j.result || []).map(a => ({ id: a.id, name: a.name })) : [];
}

const iso = t => new Date(t).toISOString().replace(/\.\d{3}Z$/, 'Z');
/** Khoảng ngày VN (yyyy-mm-dd, cả 2 đầu) → [UTC bắt đầu, UTC kết thúc (không gồm)]. */
function range(from, to) { const d = s => Date.UTC(+s.slice(0, 4), +s.slice(5, 7) - 1, +s.slice(8, 10)) - TZ_MS; return [d(from), d(to) + DAY]; }
const vnDay = t => new Date(t + TZ_MS).toISOString().slice(0, 10);
const node = (filter, extra, fields) => `rumPageloadEventsAdaptiveGroups(filter: ${filter}${extra || ''}) { ${fields} }`;
const timeF = (from, to) => `datetime_geq: "${iso(from)}", datetime_lt: "${iso(to)}"`;
const acctQ = (acct, body) => `{ viewer { accounts(filter: {accountTag: "${acct}"}) { ${body} } } }`;
const pick = (data, k) => ((((data.viewer || {}).accounts || [])[0] || {})[k]) || [];

/** Tìm mã site Web Analytics của thucduonglanh.vn trong tài khoản (30 ngày gần nhất): ưu tiên site có lượt vào từ tên miền web. */
async function findSite(token, acct) {
  const [f, t] = range(vnDay(Date.now() - 30 * DAY), vnDay(Date.now()));
  let rows;
  try { rows = pick(await gql(token, acctQ(acct, 's: ' + node(`{${timeF(f, t)}}`, ', limit: 200', 'dimensions { siteTag requestHost } sum { visits }'))), 's'); }
  catch (e) { rows = pick(await gql(token, acctQ(acct, 's: ' + node(`{${timeF(f, t)}}`, ', limit: 50', 'dimensions { siteTag } sum { visits }'))), 's'); } // bản API không cho xem tên miền → lấy site nhiều lượt nhất
  const by = {}; rows.forEach(r => { const k = r.dimensions.siteTag; by[k] = by[k] || { v: 0, host: '' }; by[k].v += r.sum.visits; if (HOST_RE.test(r.dimensions.requestHost || '')) by[k].host = r.dimensions.requestHost; });
  const tags = Object.keys(by).sort((a, b) => by[b].v - by[a].v), hit = tags.filter(k => by[k].host);
  if (hit.length) return { site: hit[0], host: by[hit[0]].host };
  if (tags.length === 1) return { site: tags[0], host: '' };
  throw setupErr('site', tags.length ? 'Tài khoản có ' + tags.length + ' site Web Analytics nhưng chưa thấy site của thucduonglanh.vn trong 30 ngày qua. Dán mã site bằng tay.' : 'Tài khoản này chưa có lượt vào Web Analytics nào trong 30 ngày qua. Kiểm tra đã bật Web Analytics cho thucduonglanh.vn chưa.');
}

/** Lệnh CRM 'cf_token' {cfToken | acct | site | off} (không đặt tên `token`: trùng mã phiên CRM): dán mã API → tự tìm tài khoản + site; nhiều tài khoản → trả danh sách để chọn. */
export async function crmCfToken(x, u, d) {
  if (u.level < 3) return { ok: false, error: 'Chỉ Quản trị làm được việc này.' };
  const cur = (await kvJson(x.db, 'cf_wa', null)) || {};
  if (d.off) { await kvDel(x.db, 'cf_wa'); return { ok: true }; }
  const token = String(d.cfToken || cur.token || '').trim();
  if (!token) return { ok: false, error: 'Chưa dán mã API Cloudflare.' };
  if (!/^[A-Za-z0-9_-]{30,}$/.test(token)) return { ok: false, error: 'Mã API Cloudflare là một dãy chữ + số dài (~40 ký tự), không có dấu cách.' };
  try {
    let acct = String(d.acct || '').trim();
    if (!/^[0-9a-f]{32}$/.test(acct)) {
      const accts = await listAccounts(token);
      if (!accts.length) throw setupErr('acct', 'Mã API đúng nhưng chưa tự lấy được danh sách tài khoản. Dán Mã tài khoản (Account ID) bằng tay: Cloudflare → Workers & Pages → cột phải có dòng Account ID → Copy.');
      if (accts.length > 1 && !d.acct) { await kvSet(x.db, 'cf_wa', JSON.stringify({ token })); return { ok: true, accts }; }
      acct = accts[0].id;
    }
    let site = String(d.site || '').trim(), host = '';
    if (site && !/^[0-9a-f]{32}$/.test(site)) return { ok: false, error: 'Mã site Web Analytics là dãy 32 chữ + số (phần token="…" trong đoạn mã Cloudflare).' };
    if (!site) { const s = await findSite(token, acct); site = s.site; host = s.host; }
    await kvSet(x.db, 'cf_wa', JSON.stringify({ token, acct, site, host, at: Date.now() }));
    return { ok: true };
  } catch (e) {
    if (e.setup === 'token') { await kvDel(x.db, 'cf_wa'); return { ok: true, setup: 'token', msg: e.message }; } // mã sai: không giữ lại, để hộp cài quay về bước dán mã
    if (e.setup) { await kvSet(x.db, 'cf_wa', JSON.stringify({ token, acct: /^[0-9a-f]{32}$/.test(String(d.acct || '')) ? d.acct : '' })); return { ok: true, setup: e.setup, msg: e.message }; }
    throw e;
  }
}

async function cfReport(c, from, to, pf, pt) {
  const [f1, t1] = range(from, to), [f2, t2] = range(pf, pt), F = `{siteTag: "${c.site}", ${timeF(f1, t1)}}`, P = `{siteTag: "${c.site}", ${timeF(f2, t2)}}`;
  const hours = Math.ceil((t1 - f1) / 3600e3), byHour = hours <= 9500; // giới hạn 10.000 dòng / truy vấn; khoảng quá dài thì gom theo ngày UTC
  const data = await gql(c.token, acctQ(c.acct,
    'cur: ' + node(F, ', limit: 1', 'count sum { visits }') +
    ' prev: ' + node(P, ', limit: 1', 'count sum { visits }') +
    ' days: ' + node(F, byHour ? ', limit: 10000, orderBy: [datetimeHour_ASC]' : ', limit: 400, orderBy: [date_ASC]', 'dimensions { ' + (byHour ? 'datetimeHour' : 'date') + ' } count sum { visits }') +
    ' ref: ' + node(F, ', limit: 12, orderBy: [sum_visits_DESC]', 'dimensions { refererHost } sum { visits }') +
    ' dev: ' + node(F, ', limit: 5', 'dimensions { deviceType } sum { visits }') +
    ' pages: ' + node(F, ', limit: 12, orderBy: [count_DESC]', 'dimensions { requestPath } count sum { visits }')));
  const one = k => { const r = pick(data, k)[0]; return r ? { visits: r.sum.visits, views: r.count } : { visits: 0, views: 0 }; };
  const days = {}; pick(data, 'days').forEach(r => { const k = byHour ? vnDay(Date.parse(r.dimensions.datetimeHour)) : r.dimensions.date; (days[k] = days[k] || [k, 0, 0]); days[k][1] += r.sum.visits; days[k][2] += r.count; });
  return {
    cur: one('cur'), prev: one('prev'),
    days: Object.keys(days).sort().map(k => days[k]),
    ref: pick(data, 'ref').map(r => [r.dimensions.refererHost || '', r.sum.visits]),
    dev: pick(data, 'dev').map(r => [r.dimensions.deviceType || '', r.sum.visits]),
    pages: pick(data, 'pages').map(r => [r.dimensions.requestPath || '/', r.count, r.sum.visits]),
    host: c.host || ''
  };
}

/** Phần Cloudflare gắn vào kết quả lệnh 'ga': {cf} hoặc {cf: null, cfSetup: 'token'|'acct'|'site', cfMsg} hoặc {cf: null, cfErr}. */
export async function cfPart(x, d, todayIso) {
  const c = await kvJson(x.db, 'cf_wa', null);
  if (!c || !c.token) return { cf: null, cfSetup: 'token' };
  if (!c.acct) return { cf: null, cfSetup: 'acct', cfMsg: 'Mã API đã nhận. Chọn tài khoản Cloudflare chứa website, hoặc dán Mã tài khoản (Account ID: Cloudflare → Workers & Pages → cột phải → Account ID).' };
  if (!c.site) return { cf: null, cfSetup: 'site', cfMsg: 'Chưa tìm thấy site Web Analytics của thucduonglanh.vn. Dán mã site bằng tay.' };
  if (![d.from, d.to, d.pf, d.pt].every(s => DAY_RE.test(String(s || '')))) return { cf: null, cfErr: 'Khoảng thời gian chưa đúng.' };
  const to = d.to > todayIso ? todayIso : d.to, key = 'cfw_' + c.site.slice(0, 8) + '_' + [d.from, to, d.pf, d.pt].join('_');
  if (!d.fresh) { const k = await kvJson(x.db, key, null); if (k) return { cf: k }; }
  try {
    const cf = await cfReport(c, d.from, to, d.pf, d.pt); cf.at = Date.now();
    await kvSet(x.db, key, JSON.stringify(cf), d.to >= todayIso ? 30 * 60e3 : 12 * 3600e3);
    return { cf };
  } catch (e) {
    if (e.setup) return { cf: null, cfSetup: e.setup, cfMsg: e.message };
    return { cf: null, cfErr: e.message };
  }
}
