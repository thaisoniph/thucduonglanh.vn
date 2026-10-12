// Tab 📣 Marketing (quyền "Marketing" + Quản trị): hiệu quả quảng cáo tính sẵn trên máy chủ, chỉ gửi về CON SỐ TỔNG theo kênh / chiến dịch.
// Bộ phận marketing không nhận tên, SĐT, danh sách khách hay doanh thu toàn công ty (Nghị định 13/2023) – chỉ phần doanh thu do khách mới mang về.
// Cách tính giống hệt tab Tổng quan (chanEff / orderChan / closeStats trong crm/app.js) để 2 nơi luôn ra cùng số. Sửa cách tính thì sửa cả 2 nơi.
import { accOf } from './mkt.js';
import { all, allIn, kvGet, kvSet, kvJson, normPhone, nrm, isVoid, startOfDay, fmtDate, DAY } from './lib.js';

const DAY_RE = /^\d{4}-\d\d-\d\d$/;
/* Từ khoá nhận ra kênh (giống MKT_CH trong crm/app.js – thêm kênh thì thêm cả 2 nơi). Kênh cụ thể (TikTok Shop) đứng trước kênh chung (TikTok). */
const CH_KW = [['Facebook', /facebook|\bfb\b|instagram|messenger|quang cao/], ['Shopee', /shopee/], ['TikTok Shop', /tiktok ?shop/], ['Lazada', /lazada/], ['TikTok', /tiktok/],
  ['Google', /(google|youtube).*(cpc|ppc|paid|ads|quang cao)|google ads/], ['Zalo', /zalo.*(ads|quang cao)/], ['KOL / KOC', /\bkol\b|\bkoc\b/]];
const kwChan = t => { const n = nrm(t); for (const [k, re] of CH_KW) if (re.test(n)) return k; return ''; };
const dayMs = s => new Date(s + 'T00:00:00+07:00').getTime();

/** mktv: { from, to, pf, pt (yyyy-mm-dd), sfb } → chi phí theo kênh / ngày / chiến dịch + doanh thu khách mới từng kênh + data quảng cáo, kỳ này và kỳ trước. */
export async function mktView(x, u, d) {
  if (![d.from, d.to, d.pf, d.pt].every(s => DAY_RE.test(String(s || '')))) return { ok: false, error: 'Khoảng thời gian chưa đúng.' };
  const sfb = d.sfb !== false && d.sfb !== 0, key = 'mktv3_' + [d.from, d.to, d.pf, d.pt, sfb ? 1 : 0].join('_') + '_' + ((await kvGet(x.db, 'ads_rows_v')) || '');
  if (!d.fresh) { const c = await kvJson(x.db, key, null); if (c) return Object.assign(c, { cached: true }); }
  const R = [dayMs(d.from), dayMs(d.to) + DAY], P = [dayMs(d.pf), dayMs(d.pt) + DAY];
  const [spDays, camps, spPrev, ordAll, sanR, sanP, adRows, cfg] = await Promise.all([
    all(x.db, 'SELECT day, channel, SUM(spend) AS s FROM ad_spend WHERE day BETWEEN ? AND ? GROUP BY day, channel', d.from, d.to),
    all(x.db, 'SELECT channel, account, campaign, src, SUM(spend) AS s, SUM(impressions) AS i, SUM(clicks) AS c, SUM(msgs) AS m, SUM(leads) AS l, SUM(purchases) AS p FROM ad_spend WHERE day BETWEEN ? AND ? GROUP BY channel, account, campaign ORDER BY s DESC LIMIT 40', d.from, d.to),
    all(x.db, 'SELECT channel, SUM(spend) AS s FROM ad_spend WHERE day BETWEEN ? AND ? GROUP BY channel', d.pf, d.pt),
    all(x.db, 'SELECT phone, time, total, status, source FROM orders WHERE time >= ? AND time < ? ORDER BY time', Math.min(R[0], P[0]), Math.max(R[1], P[1])),
    all(x.db, "SELECT day, shop, SUM(CASE WHEN state = 'ok' THEN gmv - refund ELSE 0 END) AS g FROM san_orders WHERE day BETWEEN ? AND ? GROUP BY day, shop", d.from, d.to).catch(() => []),
    all(x.db, "SELECT day, shop, SUM(CASE WHEN state = 'ok' THEN gmv - refund ELSE 0 END) AS g FROM san_orders WHERE day BETWEEN ? AND ? GROUP BY day, shop", d.pf, d.pt).catch(() => []),
    kvJson(x.db, 'ads_rows', []), kvJson(x.db, 'mkt_cfg', {})
  ]);
  const ads = (adRows || []).map(a => [Number(a[0]) || 0, normPhone(a[1])]).filter(a => a[1]);
  const adFirst = {}; ads.forEach(a => { if (!adFirst[a[1]] || a[0] < adFirst[a[1]]) adFirst[a[1]] = a[0]; });
  const ords = ordAll.filter(o => !isVoid(o.status)).map(o => ({ ph: normPhone(o.phone), time: Number(o.time) || 0, total: Number(o.total) || 0, source: o.source || '' }));
  const adIn = ads.filter(a => (a[0] >= R[0] && a[0] < R[1]) || (a[0] >= P[0] && a[0] < P[1]));
  const phones = [...new Set(ords.map(o => o.ph).concat(adIn.map(a => a[1])).filter(Boolean))];
  const [cus, lds, buys] = phones.length ? await Promise.all([
    allIn(x.db, 'SELECT phone, first FROM customers WHERE phone IN (SELECT value FROM json_each(?))', phones),
    allIn(x.db, 'SELECT phone, time, last_at, channel, status, reason FROM leads WHERE phone IN (SELECT value FROM json_each(?))', phones),
    allIn(x.db, 'SELECT phone, time, status FROM orders WHERE phone IN (SELECT value FROM json_each(?)) AND time >= ?', adIn.map(a => a[1]), Math.min(R[0], P[0]))
  ]) : [[], [], []];
  const first = {}, leadsBy = {}, buyBy = {};
  cus.forEach(c => { first[normPhone(c.phone)] = Number(c.first) || 0; });
  lds.sort((a, b) => (a.time || 0) - (b.time || 0)).forEach(l => { const p = normPhone(l.phone); (leadsBy[p] = leadsBy[p] || []).push(l); });
  buys.forEach(o => { if (!isVoid(o.status)) { const p = normPhone(o.phone); (buyBy[p] = buyBy[p] || []).push(Number(o.time) || 0); } });

  const orderChan = o => {
    const ad = adFirst[o.ph]; if (ad && ad <= o.time) return 'Facebook';
    for (const l of leadsBy[o.ph] || []) { if ((l.time || 0) > o.time || /^file cũ/i.test(l.channel || '')) continue; const k = kwChan(l.channel); if (k) return k; }
    const k = kwChan(o.source); if (k) return k;
    return sfb && /^(File |Nhập tay)/.test(o.source) ? 'Facebook' : '';
  };
  /** Doanh thu khách mới theo kênh (khách mua lần đầu trong kỳ, mọi đơn của họ trong kỳ, kênh = kênh đơn đầu). Khách cũ quay lại: chỉ để tham khảo. */
  const eff = (Rg, san) => {
    const C = {}, get = k => C[k] || (C[k] = { newN: 0, newRev: 0, oldRev: 0, oldN: 0, dd: {} }), who = {}, seen = {}, iso = t => fmtDate(t, 'yyyy-MM-dd');
    ords.filter(o => o.time >= Rg[0] && o.time < Rg[1]).forEach(o => {
      const ph = o.ph || ('?' + o.time), f = first[o.ph], isNew = !f || f >= Rg[0];
      if (!who[ph]) who[ph] = orderChan(o) || '?';
      const k = isNew ? who[ph] : orderChan(o) || '?', c = get(k);
      if (isNew) { if (!seen[k + ph]) { seen[k + ph] = 1; c.newN++; } c.newRev += o.total; const dk = iso(o.time); c.dd[dk] = (c.dd[dk] || 0) + o.total; } else { c.oldRev += o.total; c.oldN++; }
    });
    san.forEach(r => { const c = get(r.shop), g = Number(r.g) || 0; c.san = 1; c.newRev += g; c.dd[r.day] = (c.dd[r.day] || 0) + g; });
    return C;
  };
  /** Data quảng cáo (số trong file số quảng cáo, mỗi SĐT 1 lần trong kỳ) – giống closeStats / dashAdData. */
  const adStat = Rg => {
    const o = { n: 0, won: 0, lost: 0, junk: 0, fresh: 0, old: 0, again: 0 }, seen = {};
    ads.forEach(([day, ph]) => {
      if (day < Rg[0] || day >= Rg[1] || seen[ph]) return; seen[ph] = 1; o.n++;
      const ls = (leadsBy[ph] || []).filter(l => (l.last_at || l.time || 0) >= day);
      const won = (buyBy[ph] || []).some(t => t >= day) || ls.some(l => l.status === 'Đã chốt'), no = !won && ls.find(l => l.status === 'Không mua');
      if (won) o.won++; else if (no) o[/rác/i.test(no.reason || '') ? 'junk' : 'lost']++;
      if (first[ph] && first[ph] < day) o.old++; else if ((leadsBy[ph] || []).some(l => (l.time || 0) < day)) o.again++; else o.fresh++;
    });
    return o;
  };
  // chỉ giữ kênh có chạy quảng cáo (kỳ này hoặc kỳ trước): marketing không thấy doanh thu khách tự tìm đến, sàn không chạy quảng cáo, khách chưa rõ nguồn
  const paid = {}; spDays.concat(spPrev).forEach(r => { if (r.s > 0) paid[r.channel] = 1; });
  const onlyPaid = C => { const o = {}; Object.keys(C).forEach(k => { if (paid[k]) o[k] = C[k]; }); return o; };
  /** Tiền khách mới theo ngày, chỉ kênh có chi phí trong kỳ đó (sàn không chạy quảng cáo không tính) – cho biểu đồ chi phí ↔ tiền khách mới. */
  const byDay = (C, sp) => { const on = {}, o = {}; sp.forEach(r => { if (r.s > 0) on[r.channel] = 1; }); Object.keys(C).forEach(k => { if (on[k]) Object.keys(C[k].dd).forEach(dk => { o[dk] = (o[dk] || 0) + C[k].dd[dk]; }); delete C[k].dd; }); return o; };
  const fb = (cfg || {}).fb || {}, EF = eff(R, sanR), EP = eff(P, sanP);
  const out = {
    ok: true, at: Date.now(),
    days: spDays.map(r => [r.day, r.channel, r.s]), prev: spPrev.map(r => [r.channel, r.s]),
    camps: camps.map(r => [r.channel, r.campaign, r.src, r.s, r.i, r.c, r.m, r.l, r.p, accOf(cfg, r)]),
    eff: onlyPaid(EF), effPrev: onlyPaid(EP), newDay: byDay(EF, spDays), newDayPrev: byDay(EP, spPrev), ad: ads.length ? adStat(R) : null, adPrev: ads.length ? adStat(P) : null,
    fb: { on: !!fb.token, last: fb.last || null }
  };
  const live = dayMs(d.to) + DAY > startOfDay(Date.now()); // kỳ có hôm nay: lưu tạm 30 phút, kỳ đã qua: 12 tiếng
  await kvSet(x.db, key, JSON.stringify(out), live ? 30 * 60e3 : 12 * 3600e3);
  return out;
}
