// 🎯 Số thật theo từng chiến dịch quảng cáo (18/11/2026, anh Sơn chọn phương án A + B):
//   Meta báo X tin nhắn / lead → SĐT thật Y (file số quảng cáo) → ra đơn Z → doanh thu → giá 1 SĐT thật, giá 1 đơn thật, tỷ lệ Y/X.
// A. File số quảng cáo có cột "Chiến dịch" (CRM thêm bằng nút ở tab Marketing): người trực chọn từ danh sách thả xuống.
//    Danh sách lấy từ tab "DS chiến dịch (CRM)" do CRM tự ghi (chiến dịch Facebook có chi tiền 21 ngày gần đây), ghi lại khi danh sách đổi.
// B. Máy tự biết chiến dịch:
//    - khách bấm quảng cáo nhắn tin (Click-to-Messenger): Facebook gửi kèm referral.ad_id (cần quyền pages_messaging + trường messaging_referrals),
//      khách gõ SĐT trong Messenger → bảng mk_adref gắn SĐT với chiến dịch;
//    - khách điền biểu mẫu Facebook: fl_leads đã có tên chiến dịch (fblead.js).
//    adsSync (sync.js) điền tên chiến dịch máy biết vào ô "Chiến dịch" còn trống của file; ô người trực đã chọn thì giữ nguyên.
// Không gắn được thì để "Chưa rõ chiến dịch", không đoán.
import { all, allIn, run, kvGet, kvSet, kvJson, normPhone, nrm, hashKey, isVoid, DAY } from './lib.js';
import { sheetMeta, sheetValues, sheetWrite, sheetClear, sheetBatch, sheetAddTabs, a1 } from './google.js';
import { PHONE_RE } from './chat.js';

export const MK_CAMP_TAB = 'DS chiến dịch (CRM)';
export const MK_NO_CAMP = 'Chưa rõ chiến dịch';
const FB_API = 'https://graph.facebook.com/v23.0/';
const LIST_DAYS = 21; // chiến dịch có chi tiền trong 21 ngày gần đây mới vào danh sách thả xuống
const AUTO_GAP = 3 * DAY; // SĐT trong file cách lúc máy biết chiến dịch quá 3 ngày → không tự điền

export async function mkCampSchema(db) {
  await run(db, `CREATE TABLE IF NOT EXISTS mk_adref (psid TEXT PRIMARY KEY, page TEXT DEFAULT '', ad TEXT DEFAULT '', camp TEXT DEFAULT '', at INTEGER,
    phone TEXT DEFAULT '', ph_at INTEGER)`); // người nhắn fanpage đến từ quảng cáo nào (lần bấm quảng cáo gần nhất) + SĐT họ gõ trong Messenger
  await run(db, 'CREATE INDEX IF NOT EXISTS mk_adref_ph ON mk_adref(ph_at)');
}

/* ---------------------------------------------------------------- B. mã quảng cáo từ Messenger */
/** Tên chiến dịch của 1 quảng cáo: tìm trong danh sách đang chạy (kv mkt_live), không có thì hỏi Facebook bằng mã quảng cáo của tab Marketing. */
async function campOfAd(x, ad) {
  const L = await kvJson(x.db, 'mkt_live', null);
  for (const c of (L && L.camps) || []) if ((c.ads || []).some(a => String(a.id) === ad)) return c.n;
  const fb = ((await kvJson(x.db, 'mkt_cfg', {})) || {}).fb || {}; if (!fb.token) return '';
  try {
    const r = await fetch(FB_API + ad + '?fields=campaign%7Bname%7D&access_token=' + encodeURIComponent(fb.token)), j = await r.json();
    return String((j.campaign || {}).name || '').slice(0, 200);
  } catch (e) { return ''; }
}
/** Gọi ở đầu onMessage (fb.js), trước khi xét trợ lý bật / tắt: ghi lần khách bấm quảng cáo + SĐT khách gõ sau đó (30 ngày). Lỗi không làm hỏng trợ lý. */
export async function mkAdRef(x, p, m) {
  try {
    const msg = m.message || {}; if (msg.is_echo) return;
    const psid = String((m.sender || {}).id || ''); if (!psid || psid === p.id) return;
    const now = Date.now(), rf = m.referral || msg.referral || (m.postback && m.postback.referral) || null;
    if (rf && String(rf.source || '').toUpperCase() === 'ADS' && /^\d{1,25}$/.test(String(rf.ad_id || ''))) {
      const ad = String(rf.ad_id), camp = await campOfAd(x, ad);
      await run(x.db, `INSERT INTO mk_adref (psid, page, ad, camp, at, phone, ph_at) VALUES (?, ?, ?, ?, ?, '', NULL)
        ON CONFLICT(psid) DO UPDATE SET page = excluded.page, ad = excluded.ad, camp = excluded.camp, at = excluded.at, phone = '', ph_at = NULL`, psid, String(p.id), ad, camp, now);
    }
    const txt = String((msg.quick_reply && msg.quick_reply.payload) || msg.text || ''), pm = txt.match(PHONE_RE); if (!pm) return;
    const ph = normPhone(pm[0]); if (!/^0\d{9}$/.test(ph)) return;
    await run(x.db, "UPDATE mk_adref SET phone = ?, ph_at = ? WHERE psid = ? AND phone = '' AND at > ?", ph, now, psid, now - 30 * DAY);
  } catch (e) { console.error('mkAdRef', e.message); }
}
/** Quảng cáo chưa ra tên chiến dịch lúc nhận tin (danh sách cũ, Facebook chậm) → thử lại tối đa 20 mã / lần đồng bộ. */
async function mkAdResolve(x) {
  const rs = await all(x.db, "SELECT DISTINCT ad FROM mk_adref WHERE camp = '' AND ad != '' AND at > ? LIMIT 20", Date.now() - 30 * DAY).catch(() => []);
  for (const r of rs) { const c = await campOfAd(x, r.ad); if (c) await run(x.db, "UPDATE mk_adref SET camp = ? WHERE ad = ? AND camp = ''", c, r.ad); }
}
/** SĐT máy biết chiến dịch (Messenger + biểu mẫu) từ mốc from: { sđt: [[lúc, chiến dịch]] }. */
export async function mkAutoCamp(x, from) {
  await mkAdResolve(x).catch(() => { });
  const out = {}, put = (ph, at, c) => { ph = normPhone(ph); c = String(c || '').trim(); if (!ph || !c) return; (out[ph] = out[ph] || []).push([Number(at) || 0, c]); };
  (await all(x.db, "SELECT phone, ph_at, camp FROM mk_adref WHERE phone != '' AND camp != '' AND ph_at >= ?", from).catch(() => [])).forEach(r => put(r.phone, r.ph_at, r.camp));
  (await all(x.db, "SELECT phone, at, campaign FROM fl_leads WHERE phone != '' AND campaign != '' AND at >= ?", from).catch(() => [])).forEach(r => put(r.phone, r.at, r.campaign));
  return out;
}
/** Chiến dịch máy biết cho 1 dòng file (SĐT ph, ngày day): lần gần ngày nhất, cách tối đa 3 ngày. */
export function mkAutoPick(auto, ph, day) {
  let best = null; (auto[ph] || []).forEach(([t, c]) => { const g = Math.abs(t - day); if (g <= AUTO_GAP + DAY && (!best || g < best[0])) best = [g, c]; });
  return best ? best[1] : '';
}

/* ---------------------------------------------------------------- A. danh sách thả xuống trong file số quảng cáo */
const isoOf = t => new Date(t + 7 * 3600e3).toISOString().slice(0, 10);
/** Chiến dịch Facebook có chi tiền 21 ngày gần đây (mới chạy trước) + chiến dịch đang chạy trong kv mkt_live → [[tên, trạng thái, tài khoản]]. */
async function mkCampNames(x) {
  const rows = await all(x.db, "SELECT campaign, MIN(account) AS acc, MAX(day) AS last, SUM(spend) AS s FROM ad_spend WHERE channel = 'Facebook' AND day >= ? AND spend > 0 GROUP BY campaign ORDER BY last DESC, s DESC LIMIT 250", isoOf(Date.now() - LIST_DAYS * DAY));
  const L = await kvJson(x.db, 'mkt_live', null), on = {}; ((L && L.camps) || []).forEach(c => { on[c.n] = c.an || c.acc; });
  const seen = {}, out = [];
  Object.keys(on).forEach(n => { seen[n] = 1; out.push([n, 'Đang chạy', on[n]]); });
  rows.forEach(r => { const n = String(r.campaign || '').trim(); if (!n || seen[n]) return; seen[n] = 1; out.push([n, 'Chạy tới ' + r.last.slice(8, 10) + '/' + r.last.slice(5, 7), r.acc]); });
  return out;
}
/** Ghi danh sách vào tab "DS chiến dịch (CRM)" khi danh sách đổi (so mã băm kv mk_camp_list_v). force: ghi lại dù không đổi. */
export async function mkListSync(x, cfg, force) {
  if (!cfg || !cfg.fileId || !cfg.campTab) return { ok: false };
  const L = await mkCampNames(x), v = hashKey(JSON.stringify(L));
  if (!force && (await kvGet(x.db, 'mk_camp_list_v')) === v) return { ok: true, same: 1, n: L.length };
  await sheetClear(x.env, cfg.fileId, [a1(cfg.campTab, 'A1:C400')]);
  await sheetWrite(x.env, cfg.fileId, [{ range: a1(cfg.campTab, 'A1:C' + (L.length + 1)), values: [['Chiến dịch (CRM tự ghi, đừng sửa tab này)', 'Trạng thái', 'Tài khoản']].concat(L) }]);
  await kvSet(x.db, 'mk_camp_list_v', v);
  return { ok: true, n: L.length };
}
/** mk_camp_col (Quản trị): thêm cột "Chiến dịch" vào mọi tab đang đọc của file số quảng cáo + danh sách thả xuống. Cột đã có (tiêu đề có chữ "chiến dịch") thì dùng lại.
 *  → { ok, tabs: [{ name, col, added }] }. Đổi ads_cfg: cfg.campTab, sheets[].map.camp. */
export async function mkCampCol(x, u, adsCfgFn, crmLog) {
  if (u.level < 3) return { ok: false, error: 'Chỉ Quản trị thêm được cột vào file số quảng cáo.' };
  const cfg = await adsCfgFn(x); if (!cfg || !cfg.fileId) return { ok: false, error: 'Chưa cài file số quảng cáo (Cài đặt → File số quảng cáo).' };
  const meta = await sheetMeta(x.env, cfg.fileId), props = {}; (meta.sheets || []).forEach(s => { props[s.properties.title] = s.properties; });
  if (!props[MK_CAMP_TAB]) { await sheetAddTabs(x.env, cfg.fileId, [MK_CAMP_TAB]); }
  const colL = i => { let s = ''; i++; while (i > 0) { const m = (i - 1) % 26; s = String.fromCharCode(65 + m) + s; i = Math.floor((i - 1) / 26); } return s; };
  const tabs = [], req = [], heads = [];
  for (const sc of (cfg.sheets || []).filter(s => s.on)) {
    const P = props[sc.name]; if (!P) continue;
    const hr = sc.header || 1, H = ((await sheetValues(x.env, cfg.fileId, a1(sc.name, 'A' + hr + ':ZZ' + hr), 'FORMATTED_VALUE'))[0] || []).map(v => String(v || ''));
    let i = H.findIndex(h => /chien dich/.test(nrm(h))), added = false;
    if (i < 0) { let last = -1; H.forEach((h, k) => { if (h.trim()) last = k; }); i = last + 1; added = true; heads.push({ range: a1(sc.name, colL(i) + hr), values: [['Chiến dịch']] }); }
    const cols = (P.gridProperties || {}).columnCount || 26, rowsN = (P.gridProperties || {}).rowCount || 1000;
    if (i >= cols) req.push({ appendDimension: { sheetId: P.sheetId, dimension: 'COLUMNS', length: i - cols + 1 } });
    req.push({ setDataValidation: { range: { sheetId: P.sheetId, startRowIndex: hr, endRowIndex: Math.max(rowsN, hr + 2000), startColumnIndex: i, endColumnIndex: i + 1 },
      rule: { condition: { type: 'ONE_OF_RANGE', values: [{ userEnteredValue: '=' + a1(MK_CAMP_TAB, '$A$2:$A$400') }] }, showCustomUi: true, strict: false,
        inputMessage: 'Chọn chiến dịch khách bấm vào (hộp thư Meta Business Suite có ghi). Không rõ thì để trống, CRM tự điền nếu biết.' } } });
    sc.map = Object.assign({}, sc.map, { camp: i });
    tabs.push({ name: sc.name, col: colL(i), added });
  }
  if (!tabs.length) return { ok: false, error: 'Không thấy tab nào đang đọc trong file số quảng cáo.' };
  await sheetBatch(x.env, cfg.fileId, req.filter(r => r.appendDimension));
  await sheetWrite(x.env, cfg.fileId, heads);
  await sheetBatch(x.env, cfg.fileId, req.filter(r => r.setDataValidation));
  cfg.campTab = MK_CAMP_TAB; await kvSet(x.db, 'ads_cfg', JSON.stringify(cfg));
  const ls = await mkListSync(x, cfg, true);
  await crmLog(x, u, 'Marketing', '-', '', '🎯 Thêm cột Chiến dịch vào file số quảng cáo: ' + tabs.map(t => t.name + ' (cột ' + t.col + (t.added ? ', mới' : ', đã có') + ')').join(', '), '');
  return { ok: true, tabs, n: ls.n || 0 };
}

/* ---------------------------------------------------------------- tính X → Y → Z theo chiến dịch (dùng chung tab Marketing + mkt_kpi) */
/** SĐT quảng cáo (ngày về day) đã ra đơn chưa – đúng như adStat / closeStats: có đơn (không hoàn / huỷ) từ ngày đó, hoặc khách hỏi "Đã chốt" cập nhật từ ngày đó. */
export function adWon(day, ph, leadsBy, buyBy) {
  return (buyBy[ph] || []).some(t => t >= day) || (leadsBy[ph] || []).some(l => (l.last_at || l.time || 0) >= day && l.status === 'Đã chốt');
}
/** ads: [[ngày, sđt, nguồn, sale, chiến dịch]] · Rg: [từ, đến) mili giây · sp: dòng ad_spend Facebook theo chiến dịch {campaign, account, s, m, l}
 *  ordBy: {sđt: [{time, status, total}]} · → { rows: [[tên, tài khoản, chi, X, Y, Z, doanh thu]], none: [Y, Z, doanh thu], n } (X = tin nhắn, chiến dịch không có tin nhắn thì lấy lead) */
export function mkCampCalc(ads, Rg, sp, leadsBy, buyBy, ordBy) {
  const C = {}, get = (n, acc) => C[n] || (C[n] = { n, acc: acc || '', s: 0, m: 0, l: 0, y: 0, z: 0, rev: 0 }), none = { y: 0, z: 0, rev: 0 };
  (sp || []).forEach(r => { const n = String(r.campaign || '').trim(); if (!n) return; const c = get(n, r.account); c.s += Number(r.s) || 0; c.m += Number(r.m) || 0; c.l += Number(r.l) || 0; });
  const first = {}; // SĐT tính 1 lần trong kỳ (lần đầu), chiến dịch = ô đầu tiên có ghi của số đó trong kỳ
  ads.forEach(a => { const [day, ph] = a; if (day < Rg[0] || day >= Rg[1] || !ph) return; const f = first[ph]; if (!f) first[ph] = { day, camp: a[4] || '' }; else { if (day < f.day) f.day = day; if (!f.camp && a[4]) f.camp = a[4]; } });
  let n = 0;
  Object.keys(first).forEach(ph => {
    const f = first[ph], won = adWon(f.day, ph, leadsBy, buyBy); n++;
    const rev = (ordBy[ph] || []).filter(o => !isVoid(o.status) && (Number(o.time) || 0) >= f.day && (Number(o.time) || 0) < Rg[1]).reduce((a, o) => a + (Number(o.total) || 0), 0);
    const c = f.camp ? get(f.camp) : none; c.y++; if (won) { c.z++; c.rev += rev; }
  });
  const rows = Object.values(C).filter(c => c.s > 0 || c.y > 0).sort((a, b) => b.s - a.s || b.y - a.y).map(c => [c.n, c.acc, Math.round(c.s), c.m > 0 ? c.m : c.l, c.y, c.z, Math.round(c.rev)]);
  return { rows, none: [none.y, none.z, Math.round(none.rev)], n };
}
/** Bản tự tải số (cho mkt_kpi: 7 ngày gần nhất tính cả hôm nay). Lưu kv theo phiên bản ads_rows, 3 tiếng (đơn mới ra trong ngày vẫn kịp hiện). */
export async function mkCampReal(x, from, to) {
  const av = (await kvGet(x.db, 'ads_rows_v')) || '', key = 'mkcr1_' + from + '_' + to + '_' + av;
  const c = await kvJson(x.db, key, null); if (c) return c;
  const R = [new Date(from + 'T00:00:00+07:00').getTime(), new Date(to + 'T00:00:00+07:00').getTime() + DAY];
  const [rows, sp] = await Promise.all([kvJson(x.db, 'ads_rows', []),
    all(x.db, "SELECT campaign, MIN(account) AS account, SUM(spend) AS s, SUM(msgs) AS m, SUM(leads) AS l FROM ad_spend WHERE channel = 'Facebook' AND day BETWEEN ? AND ? GROUP BY campaign", from, to)]);
  const ads = (rows || []).map(a => [Number(a[0]) || 0, normPhone(a[1]), String(a[3] || ''), String(a[2] || ''), String(a[4] || '')]).filter(a => a[1] && a[0] >= R[0] && a[0] < R[1]);
  const phones = [...new Set(ads.map(a => a[1]))], leadsBy = {}, buyBy = {}, ordBy = {};
  if (phones.length) {
    const [lds, ods] = await Promise.all([allIn(x.db, 'SELECT phone, time, last_at, status FROM leads WHERE phone IN (SELECT value FROM json_each(?))', phones),
      allIn(x.db, 'SELECT phone, time, status, total FROM orders WHERE phone IN (SELECT value FROM json_each(?)) AND time >= ?', phones, R[0])]);
    lds.forEach(l => { const p = normPhone(l.phone); (leadsBy[p] = leadsBy[p] || []).push(l); });
    ods.forEach(o => { const p = normPhone(o.phone); (ordBy[p] = ordBy[p] || []).push(o); if (!isVoid(o.status)) (buyBy[p] = buyBy[p] || []).push(Number(o.time) || 0); });
  }
  const out = Object.assign(mkCampCalc(ads, R, sp, leadsBy, buyBy, ordBy), { from, to, at: Date.now() });
  await kvSet(x.db, key, JSON.stringify(out), 3 * 3600e3);
  return out;
}
