// Số liệu website từ Google Analytics 4 cho tab Tổng quan của CRM (chỉ Quản trị).
// Mã truy cập Google lấy qua cầu nối Apps Script (gInfo), nên tài khoản chạy Apps Script cần quyền xem GA4
// và Apps Script cần quyền "analytics.readonly": thêm dịch vụ Google Analytics Data API + Admin API, chạy hàm ketNoiGA4 1 lần.
// Kết quả lưu tạm trong kv (khoảng đã qua: 12 tiếng, có hôm nay: 30 phút) → mở Tổng quan không tốn lượt đọc D1 đáng kể.
import { kvGet, kvSet, kvDel, kvJson, startOfDay, fmtDate } from './lib.js';
import { gInfo } from './google.js';

const DATA = 'https://analyticsdata.googleapis.com/v1beta/';
const ADMIN = 'https://analyticsadmin.googleapis.com/v1beta/';
const MEASUREMENT_ID = 'G-X40P3S7FZ8'; // data/config.json → ga4_id
const FUNNEL = ['page_view', 'view_item', 'add_to_cart', 'begin_checkout', 'purchase', 'generate_lead', 'click_call', 'click_zalo', 'search'];

/** Lỗi cần Quản trị làm thêm bước cài đặt (setup = mã bước để CRM hiện hướng dẫn đúng chỗ). */
function setupErr(step, msg, account) { const e = new Error(msg); e.setup = step; e.account = account || ''; return e; }

async function gaFetch(env, url, body, fresh) {
  const info = await gInfo(env, fresh);
  const r = await fetch(url, { method: body ? 'POST' : 'GET', headers: { Authorization: 'Bearer ' + info.token, 'Content-Type': 'application/json' }, body: body ? JSON.stringify(body) : undefined });
  const t = await r.text(); let j = {}; try { j = JSON.parse(t); } catch (e) { }
  if (r.ok) return j;
  const msg = (j.error && j.error.message) || t.slice(0, 200);
  if (/insufficient authentication scopes|ACCESS_TOKEN_SCOPE_INSUFFICIENT/i.test(msg) || r.status === 401) {
    if (!fresh) return gaFetch(env, url, body, true); // mã cũ (lưu 45 phút) chưa có quyền mới → lấy mã mới thử lại
    throw setupErr('auth', 'Apps Script chưa được cấp quyền đọc Google Analytics.', info.account);
  }
  if (/has not been used|is disabled|SERVICE_DISABLED/i.test(msg)) throw setupErr('api', 'Chưa bật ' + (url.indexOf(ADMIN) === 0 ? 'Google Analytics Admin API' : 'Google Analytics Data API') + ' trong Apps Script.', info.account);
  if (r.status === 403) throw setupErr('access', 'Tài khoản ' + (info.account || 'chạy Apps Script') + ' chưa có quyền xem thuộc tính Google Analytics này.', info.account);
  throw new Error('Google Analytics báo lỗi: ' + msg);
}

/** Mã thuộc tính GA4 (số): lưu ở kv ga_prop; chưa có thì tự tìm thuộc tính có luồng web mang mã đo lường của website. */
async function propId(x) {
  const saved = await kvGet(x.db, 'ga_prop'); if (saved) return saved;
  let sums;
  try { sums = await gaFetch(x.env, ADMIN + 'accountSummaries?pageSize=200'); }
  catch (e) { if (e.setup === 'api' || e.setup === 'access') throw setupErr('prop', 'Chưa tự tìm được thuộc tính GA4 (' + e.message + ') – nhập mã thuộc tính bằng tay.', e.account); throw e; }
  const props = []; (sums.accountSummaries || []).forEach(a => (a.propertySummaries || []).forEach(p => props.push(p.property)));
  for (const p of props) {
    try {
      const s = await gaFetch(x.env, ADMIN + p + '/dataStreams?pageSize=50');
      if ((s.dataStreams || []).some(d => d.webStreamData && d.webStreamData.measurementId === MEASUREMENT_ID)) { const id = p.split('/')[1]; await kvSet(x.db, 'ga_prop', id); return id; }
    } catch (e) { }
  }
  throw setupErr('prop', props.length ? 'Tài khoản Google có ' + props.length + ' thuộc tính GA4 nhưng không thấy thuộc tính của website (' + MEASUREMENT_ID + ').' : 'Tài khoản Google chạy Apps Script chưa thấy thuộc tính GA4 nào.', '');
}

const DAY_RE = /^\d{4}-\d\d-\d\d$/;
const rep = (dims, metrics, ranges, extra) => Object.assign({ dateRanges: ranges, dimensions: dims.map(name => ({ name })), metrics: metrics.map(name => ({ name })), keepEmptyRows: false }, extra || {});
/** rows → [[giá trị chiều…, số…]] (chiều dateRange nếu có nằm cuối danh sách chiều). */
function rowsOf(r) { return (r && r.rows || []).map(w => w.dimensionValues.map(v => v.value).concat(w.metricValues.map(v => Number(v.value) || 0))); }

async function gaReport(x, prop, from, to, pf, pt) {
  const both = [{ startDate: from, endDate: to, name: 'cur' }, { startDate: pf, endDate: pt, name: 'prev' }], cur = [both[0]];
  const ev = { dimensionFilter: { filter: { fieldName: 'eventName', inListFilter: { values: FUNNEL } } } };
  const top = (m, n) => ({ orderBys: [{ metric: { metricName: m }, desc: true }], limit: n });
  const [a, b] = await Promise.all([
    gaFetch(x.env, DATA + 'properties/' + prop + ':batchRunReports', { requests: [
      rep([], ['activeUsers', 'newUsers', 'sessions', 'engagedSessions', 'screenPageViews', 'userEngagementDuration'], both),
      rep(['date'], ['sessions', 'activeUsers'], cur),
      rep(['sessionDefaultChannelGroup'], ['sessions', 'engagedSessions', 'activeUsers', 'ecommercePurchases'], both),
      rep(['eventName'], ['eventCount', 'totalUsers'], both, ev),
      rep(['sessionSourceMedium'], ['sessions', 'engagedSessions', 'ecommercePurchases'], cur, top('sessions', 12))
    ] }),
    gaFetch(x.env, DATA + 'properties/' + prop + ':batchRunReports', { requests: [
      rep(['pagePath', 'pageTitle'], ['screenPageViews', 'activeUsers'], cur, top('screenPageViews', 12)),
      rep(['landingPage'], ['sessions', 'engagedSessions', 'ecommercePurchases'], cur, top('sessions', 10)),
      rep(['deviceCategory'], ['activeUsers'], cur)
    ] })
  ]);
  const [tot, days, ch, evs, src] = (a.reports || []).map(rowsOf), [pages, land, dev] = (b.reports || []).map(rowsOf);
  const sum = name => { const r = tot.filter(w => w[0] === name)[0]; return r ? { users: r[1], newUsers: r[2], sessions: r[3], engaged: r[4], views: r[5], dur: r[6] } : { users: 0, newUsers: 0, sessions: 0, engaged: 0, views: 0, dur: 0 }; };
  const byRange = (rows, n) => { const o = { cur: {}, prev: {} }; rows.forEach(w => { o[w[1]][w[0]] = w.slice(2, 2 + n); }); return o; };
  return {
    cur: sum('cur'), prev: sum('prev'),
    days: days.map(w => [w[0].slice(0, 4) + '-' + w[0].slice(4, 6) + '-' + w[0].slice(6), w[1], w[2]]).sort((p, q) => p[0] < q[0] ? -1 : 1),
    ch: byRange(ch, 4), ev: byRange(evs, 2),
    src: src.map(w => [w[0], w[1], w[2], w[3]]),
    pages: pages.map(w => [w[0], w[1], w[2], w[3]]),
    land: land.map(w => [w[0], w[1], w[2], w[3]]),
    dev: dev.map(w => [w[0], w[1]])
  };
}

/** Lệnh CRM 'ga': {from, to, pf, pt} (yyyy-mm-dd, giờ VN) → số liệu GA4 kỳ này + kỳ so sánh. fresh: bỏ bản lưu tạm. */
export async function crmGa(x, u, d) {
  if (u.level < 3) return { ok: false, error: 'Chỉ Quản trị xem được số liệu website.' };
  if (![d.from, d.to, d.pf, d.pt].every(s => DAY_RE.test(String(s || '')))) return { ok: false, error: 'Khoảng thời gian chưa đúng.' };
  const todayIso = fmtDate(startOfDay(Date.now()), 'yyyy-MM-dd'), key = 'gac_' + [d.from, d.to, d.pf, d.pt].join('_');
  if (!d.fresh) { const c = await kvJson(x.db, key, null); if (c) return { ok: true, ga: c, cached: true }; }
  try {
    const prop = await propId(x);
    const ga = await gaReport(x, prop, d.from, d.to > todayIso ? todayIso : d.to, d.pf, d.pt);
    ga.at = Date.now(); ga.prop = prop;
    await kvSet(x.db, key, JSON.stringify(ga), d.to >= todayIso ? 30 * 60e3 : 12 * 3600e3);
    return { ok: true, ga };
  } catch (e) {
    if (e.setup) return { ok: true, ga: null, setup: e.setup, msg: e.message, account: e.account, prop: await kvGet(x.db, 'ga_prop') || '' };
    throw e;
  }
}

/** Lệnh CRM 'ga_prop': Quản trị nhập tay mã thuộc tính GA4 (dãy số, GA4 → Quản trị → Chi tiết thuộc tính). Rỗng = xoá để tự tìm lại. */
export async function crmGaProp(x, u, d) {
  if (u.level < 3) return { ok: false, error: 'Chỉ Quản trị làm được việc này.' };
  const id = String(d.prop || '').replace(/^properties\//, '').trim();
  if (!id) { await kvDel(x.db, 'ga_prop'); return { ok: true }; }
  if (!/^\d{6,12}$/.test(id)) return { ok: false, error: 'Mã thuộc tính GA4 là một dãy số (ví dụ 412345678), không phải mã G-…' };
  await kvSet(x.db, 'ga_prop', id);
  return { ok: true };
}
