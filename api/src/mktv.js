// Tab 📣 Marketing (quyền "Marketing" + Quản trị): hiệu quả quảng cáo tính sẵn trên máy chủ, chỉ gửi về CON SỐ TỔNG theo kênh / chiến dịch / sản phẩm.
// Bộ phận marketing không nhận tên, SĐT, danh sách khách hay doanh thu toàn công ty (Nghị định 13/2023) – chỉ phần doanh thu do khách mới mang về.
// Cách tính giống hệt tab Tổng quan (chanEff / orderChan / closeStats trong crm/app.js) để 2 nơi luôn ra cùng số. Sửa cách tính thì sửa cả 2 nơi.
import { accOf } from './mkt.js';
import { all, allIn, first, kvGet, kvSet, kvJson, normPhone, nrm, isVoid, startOfDay, fmtDate, DAY } from './lib.js';

const DAY_RE = /^\d{4}-\d\d-\d\d$/;
/* Từ khoá nhận ra kênh (giống MKT_CH trong crm/app.js – thêm kênh thì thêm cả 2 nơi). Kênh cụ thể (TikTok Shop) đứng trước kênh chung (TikTok). */
const CH_KW = [['Facebook', /facebook|\bfb\b|instagram|messenger|quang cao/], ['Shopee', /shopee/], ['TikTok Shop', /tiktok ?shop/], ['Lazada', /lazada/], ['TikTok', /tiktok/],
  ['Google', /(google|youtube).*(cpc|ppc|paid|ads|quang cao)|google ads/], ['Zalo', /zalo.*(ads|quang cao)/], ['KOL / KOC', /\bkol\b|\bkoc\b/]];
const kwChan = t => { const n = nrm(t); for (const [k, re] of CH_KW) if (re.test(n)) return k; return ''; };
/* Sản phẩm: nhận ra từ tên chiến dịch, cột Nguồn quảng cáo của file số, dòng sản phẩm của đơn (chữ không dấu). Thêm sản phẩm mới: thêm 1 dòng.
   Đặt tên chiến dịch có tên sản phẩm (vd "7-10-PROGOMAX - SỮA") thì chi phí mới chia đúng sản phẩm. */
const PROD_KW = [['Fucoidan Progomax', /progomax/], ['Gafo Fucoidan', /gafo/], ['DILVANG', /dilvang|dinh lang|che vang/], ['Ruốc rong biển', /ruoc|rong bien/],
  ['Xì dầu 2S', /xi dau|nguu bang/], ['Dinh dưỡng từ hạt', /curcumin|tu hat/], ['Bữa ăn dinh dưỡng', /bua an/], ['Trà Mâm Xôi', /mam xoi/],
  ['Bột Đậu Xanh Rau Má', /rau ma|dau xanh/], ['Ebook / Cẩm nang', /ebook|cam nang/]];
const prodOf = t => { const n = nrm(String(t || '').replace(/_/g, ' ').replace(/([a-z])([A-Z])/g, '$1 $2')); for (const [k, re] of PROD_KW) if (re.test(n)) return k; return ''; };
const dayMs = s => new Date(s + 'T00:00:00+07:00').getTime();
const iso = t => fmtDate(t, 'yyyy-MM-dd');

/** Dòng sản phẩm của đơn ("Tên (quy cách) x2 = 900.000") → [[sản phẩm, phần tiền của đơn]]. Không đọc được tiền từng dòng thì chia đều. */
function orderProds(items, total) {
  const ls = String(items || '').split(/\n|;\s*/).map(l => l.trim()).filter(l => l && !/^🎁/.test(l));
  const rows = ls.map(l => { const m = l.match(/=\s*([\d.,]+)\s*đ?\s*$/); return [prodOf(l), m ? Number(m[1].replace(/\D/g, '')) || 0 : 0]; });
  if (!rows.length) return [['', total]];
  const sum = rows.reduce((a, r) => a + r[1], 0);
  return rows.map(r => [r[0], sum ? Math.round(total * r[1] / sum) : Math.round(total / rows.length)]);
}

/** mktv: { from, to, pf, pt (yyyy-mm-dd), sfb } → chi phí theo kênh / ngày / chiến dịch + doanh thu khách mới từng kênh + data quảng cáo, kỳ này và kỳ trước;
 *  thêm: phễu (tot / totPrev), giá trung bình 1 kết quả mỗi kênh (cpr), theo sản phẩm (prod), giá trị khách mới 90 ngày (ltv), ngân sách tháng (budget). */
export async function mktView(x, u, d) {
  if (![d.from, d.to, d.pf, d.pt].every(s => DAY_RE.test(String(s || '')))) return { ok: false, error: 'Khoảng thời gian chưa đúng.' };
  const sfb = d.sfb !== false && d.sfb !== 0, key = 'mktv4_' + [d.from, d.to, d.pf, d.pt, sfb ? 1 : 0].join('_') + '_' + ((await kvGet(x.db, 'ads_rows_v')) || '');
  if (!d.fresh) { const c = await kvJson(x.db, key, null); if (c) return Object.assign(c, { cached: true }, await budgetOf(x)); }
  const R = [dayMs(d.from), dayMs(d.to) + DAY], P = [dayMs(d.pf), dayMs(d.pt) + DAY];
  const mid = iso(Math.floor((R[0] + R[1]) / 2 / DAY) * DAY); // chia đôi kỳ: tỷ lệ bấm nửa đầu ↔ nửa sau (quảng cáo có bị nhàm không)
  const [spDays, camps, campAll, spPrev, ordAll, sanR, sanP, adRows, cfg] = await Promise.all([
    all(x.db, 'SELECT day, channel, SUM(spend) AS s FROM ad_spend WHERE day BETWEEN ? AND ? GROUP BY day, channel', d.from, d.to),
    all(x.db, 'SELECT channel, account, campaign, src, SUM(spend) AS s, SUM(impressions) AS i, SUM(clicks) AS c, SUM(msgs) AS m, SUM(leads) AS l, SUM(purchases) AS p, ' +
      'SUM(CASE WHEN day < ? THEN impressions ELSE 0 END) AS i1, SUM(CASE WHEN day < ? THEN clicks ELSE 0 END) AS c1, MAX(CASE WHEN spend > 0 THEN day END) AS last ' +
      'FROM ad_spend WHERE day BETWEEN ? AND ? GROUP BY channel, account, campaign ORDER BY s DESC LIMIT 60', mid, mid, d.from, d.to),
    all(x.db, 'SELECT channel, campaign, SUM(spend) AS s, SUM(msgs) + SUM(leads) AS r FROM ad_spend WHERE day BETWEEN ? AND ? GROUP BY channel, campaign', d.from, d.to),
    all(x.db, 'SELECT channel, SUM(spend) AS s, SUM(impressions) AS i, SUM(clicks) AS c, SUM(msgs) AS m, SUM(leads) AS l, SUM(purchases) AS p FROM ad_spend WHERE day BETWEEN ? AND ? GROUP BY channel', d.pf, d.pt),
    all(x.db, 'SELECT phone, time, total, status, source, items FROM orders WHERE time >= ? AND time < ? ORDER BY time', Math.min(R[0], P[0]), Math.max(R[1], P[1])),
    all(x.db, "SELECT day, shop, SUM(CASE WHEN state = 'ok' THEN gmv - refund ELSE 0 END) AS g FROM san_orders WHERE day BETWEEN ? AND ? GROUP BY day, shop", d.from, d.to).catch(() => []),
    all(x.db, "SELECT day, shop, SUM(CASE WHEN state = 'ok' THEN gmv - refund ELSE 0 END) AS g FROM san_orders WHERE day BETWEEN ? AND ? GROUP BY day, shop", d.pf, d.pt).catch(() => []),
    kvJson(x.db, 'ads_rows', []), kvJson(x.db, 'mkt_cfg', {})
  ]);
  const ads = (adRows || []).map(a => [Number(a[0]) || 0, normPhone(a[1]), String(a[3] || '')]).filter(a => a[1]);
  const adFirst = {}; ads.forEach(a => { if (!adFirst[a[1]] || a[0] < adFirst[a[1]]) adFirst[a[1]] = a[0]; });
  const ords = ordAll.filter(o => !isVoid(o.status)).map(o => ({ ph: normPhone(o.phone), time: Number(o.time) || 0, total: Number(o.total) || 0, source: o.source || '', items: o.items || '' }));
  const adIn = ads.filter(a => (a[0] >= R[0] && a[0] < R[1]) || (a[0] >= P[0] && a[0] < P[1]));
  const phones = [...new Set(ords.map(o => o.ph).concat(adIn.map(a => a[1])).filter(Boolean))];
  const [cus, lds, buys] = phones.length ? await Promise.all([
    allIn(x.db, 'SELECT phone, first FROM customers WHERE phone IN (SELECT value FROM json_each(?))', phones),
    allIn(x.db, 'SELECT phone, time, last_at, channel, status, reason FROM leads WHERE phone IN (SELECT value FROM json_each(?))', phones),
    allIn(x.db, 'SELECT phone, time, status FROM orders WHERE phone IN (SELECT value FROM json_each(?)) AND time >= ?', adIn.map(a => a[1]), Math.min(R[0], P[0]))
  ]) : [[], [], []];
  const firstOf = {}, leadsBy = {}, buyBy = {};
  cus.forEach(c => { firstOf[normPhone(c.phone)] = Number(c.first) || 0; });
  lds.sort((a, b) => (a.time || 0) - (b.time || 0)).forEach(l => { const p = normPhone(l.phone); (leadsBy[p] = leadsBy[p] || []).push(l); });
  buys.forEach(o => { if (!isVoid(o.status)) { const p = normPhone(o.phone); (buyBy[p] = buyBy[p] || []).push(Number(o.time) || 0); } });

  const orderChan = o => {
    const ad = adFirst[o.ph]; if (ad && ad <= o.time) return 'Facebook';
    for (const l of leadsBy[o.ph] || []) { if ((l.time || 0) > o.time || /^file cũ/i.test(l.channel || '')) continue; const k = kwChan(l.channel); if (k) return k; }
    const k = kwChan(o.source); if (k) return k;
    return sfb && /^(File |Nhập tay)/.test(o.source) ? 'Facebook' : '';
  };
  /** Doanh thu khách mới theo kênh (khách mua lần đầu trong kỳ, mọi đơn của họ trong kỳ, kênh = kênh đơn đầu). Khách cũ quay lại: chỉ để tham khảo.
   *  po (kỳ này): các đơn khách mới [kênh, sản phẩm, tiền] để chia theo sản phẩm. */
  const eff = (Rg, san, po) => {
    const C = {}, get = k => C[k] || (C[k] = { newN: 0, newRev: 0, oldRev: 0, oldN: 0, dd: {} }), who = {}, seen = {};
    ords.filter(o => o.time >= Rg[0] && o.time < Rg[1]).forEach(o => {
      const ph = o.ph || ('?' + o.time), f = firstOf[o.ph], isNew = !f || f >= Rg[0];
      if (!who[ph]) who[ph] = orderChan(o) || '?';
      const k = isNew ? who[ph] : orderChan(o) || '?', c = get(k);
      if (isNew) {
        const fresh = !seen[k + ph]; if (fresh) { seen[k + ph] = 1; c.newN++; }
        c.newRev += o.total; const dk = iso(o.time); c.dd[dk] = (c.dd[dk] || 0) + o.total;
        if (po) orderProds(o.items, o.total).forEach(([p, v], i) => po.push([k, p, v, fresh && !i ? ph : '']));
      } else { c.oldRev += o.total; c.oldN++; }
    });
    san.forEach(r => { const c = get(r.shop), g = Number(r.g) || 0; c.san = 1; c.newRev += g; c.dd[r.day] = (c.dd[r.day] || 0) + g; });
    return C;
  };
  /** Data quảng cáo (số trong file số quảng cáo, mỗi SĐT 1 lần trong kỳ) – giống closeStats / dashAdData.
   *  idle: data từ hôm qua trở về trước mà chưa có kết quả tư vấn nào (khách hỏi vẫn "Mới hỏi", chưa mua). prod: data / ra đơn theo sản phẩm (cột Nguồn quảng cáo). */
  const today0 = startOfDay(Date.now());
  const adStat = (Rg, byProd) => {
    const o = { n: 0, won: 0, lost: 0, junk: 0, fresh: 0, old: 0, again: 0, idle: 0 }, seen = {};
    ads.forEach(([day, ph, src]) => {
      if (day < Rg[0] || day >= Rg[1] || seen[ph]) return; seen[ph] = 1; o.n++;
      const ls = (leadsBy[ph] || []).filter(l => (l.last_at || l.time || 0) >= day);
      const won = (buyBy[ph] || []).some(t => t >= day) || ls.some(l => l.status === 'Đã chốt'), no = !won && ls.find(l => l.status === 'Không mua');
      if (won) o.won++; else if (no) o[/rác/i.test(no.reason || '') ? 'junk' : 'lost']++;
      else if (day < today0 && !ls.some(l => l.status && l.status !== 'Mới hỏi')) o.idle++;
      if (firstOf[ph] && firstOf[ph] < day) o.old++; else if ((leadsBy[ph] || []).some(l => (l.time || 0) < day)) o.again++; else o.fresh++;
      if (byProd) { const b = byProd(prodOf(src)); b.n++; if (won) b.won++; }
    });
    return o;
  };
  // chỉ giữ kênh có chạy quảng cáo (kỳ này hoặc kỳ trước): marketing không thấy doanh thu khách tự tìm đến, sàn không chạy quảng cáo, khách chưa rõ nguồn
  const paid = {}; spDays.concat(spPrev).forEach(r => { if (r.s > 0) paid[r.channel] = 1; });
  const onlyPaid = C => { const o = {}; Object.keys(C).forEach(k => { if (paid[k]) o[k] = C[k]; }); return o; };
  /** Tiền khách mới theo ngày, chỉ kênh có chi phí trong kỳ đó (sàn không chạy quảng cáo không tính) – cho biểu đồ chi phí ↔ tiền khách mới. */
  const byDay = (C, sp) => { const on = {}, o = {}; sp.forEach(r => { if (r.s > 0) on[r.channel] = 1; }); Object.keys(C).forEach(k => { if (on[k]) Object.keys(C[k].dd).forEach(dk => { o[dk] = (o[dk] || 0) + C[k].dd[dk]; }); delete C[k].dd; }); return o; };

  // theo sản phẩm (kỳ này): chi phí theo tên chiến dịch, data + ra đơn theo file số, tiền khách mới (chỉ kênh có chạy quảng cáo) theo dòng sản phẩm của đơn
  const PR = {}, pget = k => PR[k] || (PR[k] = { k, sp: 0, res: 0, n: 0, won: 0, rev: 0, newN: 0 }), po = [];
  const fb = (cfg || {}).fb || {}, EF = eff(R, sanR, po), EP = eff(P, sanP);
  const on = {}; spDays.forEach(r => { if (r.s > 0) on[r.channel] = 1; });
  campAll.forEach(r => { const p = pget(prodOf(r.campaign)); p.sp += r.s || 0; p.res += r.r || 0; });
  po.forEach(([k, p, v, ph]) => { if (!on[k]) return; const b = pget(p); b.rev += v; if (ph) b.newN++; });
  const ad = ads.length ? adStat(R, pget) : null;
  // giá trung bình 1 kết quả (tin nhắn + SĐT) mỗi kênh, tính trên mọi chiến dịch có số kết quả → chấm điểm từng chiến dịch
  const cpr = {}, cs = {}; campAll.forEach(r => { const c = cs[r.channel] || (cs[r.channel] = { s: 0, r: 0 }); c.s += r.s || 0; c.r += r.r || 0; });
  Object.keys(cs).forEach(k => { if (cs[k].r) cpr[k] = Math.round(cs[k].s / cs[k].r); });
  const sumT = rows => { const t = { s: 0, i: 0, c: 0, m: 0, l: 0, p: 0 }; rows.forEach(r => { Object.keys(t).forEach(f => { t[f] += Number(r[f]) || 0; }); }); return t; };
  const tot = sumT(camps.length < 60 ? camps : await all(x.db, 'SELECT SUM(spend) AS s, SUM(impressions) AS i, SUM(clicks) AS c, SUM(msgs) AS m, SUM(leads) AS l, SUM(purchases) AS p FROM ad_spend WHERE day BETWEEN ? AND ?', d.from, d.to));
  const out = {
    ok: true, at: Date.now(),
    days: spDays.map(r => [r.day, r.channel, r.s]), prev: spPrev.map(r => [r.channel, r.s]),
    // [kênh, chiến dịch, src, chi phí, hiển thị, click, tin nhắn, SĐT, mua, [tài khoản], [hiển thị nửa đầu, click nửa đầu, ngày cuối có chi]]
    camps: camps.map(r => [r.channel, r.campaign, r.src, r.s, r.i, r.c, r.m, r.l, r.p, accOf(cfg, r), [r.i1 || 0, r.c1 || 0, r.last || '']]),
    eff: onlyPaid(EF), effPrev: onlyPaid(EP), newDay: byDay(EF, spDays), newDayPrev: byDay(EP, spPrev), ad, adPrev: ads.length ? adStat(P) : null,
    tot, totPrev: sumT(spPrev), cpr, mid,
    prod: Object.values(PR).filter(p => p.sp || p.n || p.rev).sort((a, b) => b.sp - a.sp || b.rev - a.rev),
    ltv: await ltvOf(x),
    fb: { on: !!fb.token, last: fb.last || null }
  };
  const live = dayMs(d.to) + DAY > startOfDay(Date.now()); // kỳ có hôm nay: lưu tạm 30 phút, kỳ đã qua: 12 tiếng
  await kvSet(x.db, key, JSON.stringify(out), live ? 30 * 60e3 : 12 * 3600e3);
  return Object.assign(out, await budgetOf(x));
}

/** Giá trị 1 khách mới trong 90 ngày đầu: khách mua lần đầu cách đây 90–270 ngày (đã đủ 90 ngày để xem họ mua tiếp không), theo nguồn khách.
 *  Tính 1 lần / ngày (kv mkt_ltv_<ngày>) cho đỡ tốn lượt đọc. → { n, avg (tiền 90 ngày / khách), first (đơn đầu / khách), rep (% mua lại), by: {nguồn: {n, avg, rep}} } */
async function ltvOf(x) {
  const now = startOfDay(Date.now()), k = 'mkt_ltv_' + iso(now), c = await kvJson(x.db, k, null); if (c) return c;
  const A = now - 270 * DAY, B = now - 90 * DAY;
  const ords = (await all(x.db, 'SELECT phone, time, total, status FROM orders WHERE time >= ? ORDER BY time', A)).filter(o => !isVoid(o.status) && normPhone(o.phone));
  const by = {}; ords.forEach(o => { const p = normPhone(o.phone); (by[p] = by[p] || []).push(o); });
  const cand = Object.keys(by).filter(p => by[p][0].time < B);
  const info = {}; (await allIn(x.db, 'SELECT phone, first, source FROM customers WHERE phone IN (SELECT value FROM json_each(?))', cand)).forEach(r => { info[normPhone(r.phone)] = r; });
  const G = {}, add = (g, rev, fst, rep) => { const o = G[g] || (G[g] = { n: 0, rev: 0, fst: 0, rep: 0 }); o.n++; o.rev += rev; o.fst += fst; o.rep += rep; };
  cand.forEach(p => {
    const c0 = info[p], f = by[p][0].time; if (!c0 || (Number(c0.first) || f) < A || Math.abs((Number(c0.first) || f) - f) > DAY) return; // khách đã mua trước khung → không phải khách mới
    const in90 = by[p].filter(o => o.time < f + 90 * DAY), rev = in90.reduce((a, o) => a + (Number(o.total) || 0), 0), src = String(c0.source || '').trim() || 'Chưa rõ nguồn';
    add('*', rev, Number(by[p][0].total) || 0, in90.length > 1 ? 1 : 0); add(src, rev, Number(by[p][0].total) || 0, in90.length > 1 ? 1 : 0);
  });
  const fmt = o => o ? { n: o.n, avg: Math.round(o.rev / o.n), first: Math.round(o.fst / o.n), rep: Math.round(o.rep * 100 / o.n) } : null;
  const out = Object.assign(fmt(G['*']) || { n: 0 }, { from: iso(A), to: iso(B - DAY), by: {} });
  Object.keys(G).forEach(g => { if (g !== '*' && G[g].n >= 10) out.by[g] = fmt(G[g]); });
  await kvSet(x.db, k, JSON.stringify(out), DAY);
  return out;
}

/** Ngân sách quảng cáo tháng này (kv mkt_budget {yyyy-MM: số tiền}, Quản trị đặt) + đã chi từ đầu tháng. Không lưu tạm: đổi ngân sách là thấy ngay. */
async function budgetOf(x) {
  const now = Date.now(), m = fmtDate(now, 'yyyy-MM'), all0 = await kvJson(x.db, 'mkt_budget', {});
  const r = await first(x.db, 'SELECT SUM(spend) AS s FROM ad_spend WHERE day BETWEEN ? AND ?', m + '-01', m + '-31');
  const [y, mo] = m.split('-').map(Number), dim = new Date(Date.UTC(y, mo, 0)).getUTCDate(), day = Number(fmtDate(now, 'dd'));
  return { budget: { m, amt: Number(all0[m]) || 0, spent: (r && r.s) || 0, day, dim } };
}
/** mkt_budget (Quản trị): { month: yyyy-MM, amount } → đặt ngân sách quảng cáo tháng (0 = bỏ). */
export async function mktBudgetSet(x, d) {
  if (!/^\d{4}-\d\d$/.test(String(d.month || ''))) return { ok: false, error: 'Tháng chưa đúng.' };
  const b = await kvJson(x.db, 'mkt_budget', {}), v = Math.max(0, Math.round(Number(d.amount) || 0));
  if (v) b[d.month] = v; else delete b[d.month];
  await kvSet(x.db, 'mkt_budget', JSON.stringify(b));
  return Object.assign({ ok: true }, await budgetOf(x));
}
