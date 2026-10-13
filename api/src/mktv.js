// Tab 📣 Marketing (quyền "Marketing" + Quản trị): hiệu quả quảng cáo tính sẵn trên máy chủ, chỉ gửi về CON SỐ TỔNG theo kênh / chiến dịch / sản phẩm.
// Bộ phận marketing không nhận tên, SĐT, danh sách khách hay doanh thu toàn công ty (Nghị định 13/2023) – chỉ phần doanh thu do khách mới mang về.
// Cách tính giống hệt tab Tổng quan (chanEff / orderChan / closeStats trong crm/app.js) để 2 nơi luôn ra cùng số. Sửa cách tính thì sửa cả 2 nơi.
import { accOf } from './mkt.js';
import { all, allIn, first, kvGet, kvSet, kvJson, normPhone, nrm, esc, isVoid, startOfDay, fmtDate, DAY, CRM_URL } from './lib.js';

const DAY_RE = /^\d{4}-\d\d-\d\d$/;
/* Từ khoá nhận ra kênh (giống MKT_CH trong crm/app.js – thêm kênh thì thêm cả 2 nơi). Kênh cụ thể (TikTok Shop) đứng trước kênh chung (TikTok). */
const CH_KW = [['Facebook', /facebook|\bfb\b|instagram|messenger|quang cao/], ['Shopee', /shopee/], ['TikTok Shop', /tiktok ?shop/], ['Lazada', /lazada/], ['TikTok', /tiktok/],
  ['Google', /(google|youtube).*(cpc|ppc|paid|ads|quang cao)|google ads/], ['Zalo', /zalo.*(ads|quang cao)/], ['KOL / KOC', /\bkol\b|\bkoc\b/]];
/** Kênh "👥 Cộng đồng Zalo" (giữ khách cũ): tiền = đơn MUA LẠI (không phải đơn đầu) của khách có ô Cộng đồng = "Đã vào". Không dùng để gắn kênh cho đơn. */
const COMM = 'Cộng đồng Zalo';
/** Kênh đặt được mục tiêu marketing (giống MKT_CH trong crm/app.js, trừ Khác). */
const WEB = 'Website';
const GOAL_CH = CH_KW.map(c => c[0]).concat(WEB, COMM);
/** Đơn đặt trên website (giống chanOf trong crm/app.js): không phải đơn file sale / nhập tay / chốt từ khách hỏi. */
const isWebO = o => { const s = String(o.source || ''); return !/^File /.test(s) && !/^(Nhập tay|Tiềm năng)\s*[–-]/.test(s); };
const kwChan = t => { const n = nrm(t); for (const [k, re] of CH_KW) if (re.test(n)) return k; return ''; };
/* Sản phẩm: nhận ra từ tên chiến dịch, cột Nguồn quảng cáo của file số, dòng sản phẩm của đơn (chữ không dấu). Thêm sản phẩm mới: thêm 1 dòng.
   Đặt tên chiến dịch có tên sản phẩm (vd "7-10-PROGOMAX - SỮA") thì chi phí mới chia đúng sản phẩm. */
const PROD_KW = [['Fucoidan Progomax', /progomax/], ['Gafo Fucoidan', /gafo/], ['DILVANG', /dilvang|dinh lang|che vang/], ['Ruốc rong biển', /ruoc|rong bien/],
  ['Xì dầu 2S', /xi dau|nguu bang/], ['Dinh dưỡng từ hạt', /curcumin|tu hat/], ['Bữa ăn dinh dưỡng', /bua an/], ['Trà Mâm Xôi', /mam xoi/],
  ['Bột Đậu Xanh Rau Má', /rau ma|dau xanh/], ['Ebook / Cẩm nang', /ebook|cam nang/]];
const prodOf = t => { const n = nrm(String(t || '').replace(/_/g, ' ').replace(/([a-z])([A-Z])/g, '$1 $2')); for (const [k, re] of PROD_KW) if (re.test(n)) return k; return ''; };
/** Lý do không mua (sale gõ tự do) → nhóm dễ hiểu. Thứ tự quan trọng: nhóm cụ thể trước. */
const WHY = [['Số rác / sai số', /rac|sai so|nham so|so ao|khong co that|khong phai/], ['Bom hàng', /\bbom\b/], ['Không liên lạc được', /khong nghe|khong bat|thue bao|khong lien lac|tat may|chan so|khong goi duoc/],
  ['Người nhà không đồng ý', /nguoi nha|\bchong\b|\bvo\b|\bcon\b|bo me|gia dinh|hoi y kien/], ['Chê giá cao', /\bgia\b|\bdat\b|\bmac\b|tien/],
  ['Chưa tin / sợ không hợp', /chua tin|khong tin|lua dao|hang gia|tac dung|hieu qua|nghi ngo|phan ung|so khong/],
  ['Đã mua / đang dùng nơi khác', /noi khac|cho khac|da mua|dang dung|ben khac|hang khac|da co/],
  ['Chưa cần / để sau', /chua can|de sau|suy nghi|tham khao|nhu cau|khong can|bao sau|hen sau|chua muon|chua mua/]];
const whyOf = t => { const n = nrm(t); for (const [k, re] of WHY) if (re.test(n)) return k; return n ? 'Lý do khác' : 'Không ghi lý do'; };
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
  const sfb = d.sfb !== false && d.sfb !== 0, key = 'mktv8_' + [d.from, d.to, d.pf, d.pt, sfb ? 1 : 0, u.level >= 3 ? 'a' : 'm'].join('_') + '_' + ((await kvGet(x.db, 'ads_rows_v')) || '');
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
  const ads = (adRows || []).map(a => [Number(a[0]) || 0, normPhone(a[1]), String(a[3] || ''), String(a[2] || '')]).filter(a => a[1]);
  const adFirst = {}; ads.forEach(a => { if (!adFirst[a[1]] || a[0] < adFirst[a[1]]) adFirst[a[1]] = a[0]; });
  const ords = ordAll.filter(o => !isVoid(o.status)).map(o => ({ ph: normPhone(o.phone), time: Number(o.time) || 0, total: Number(o.total) || 0, source: o.source || '', items: o.items || '' }));
  const adIn = ads.filter(a => (a[0] >= R[0] && a[0] < R[1]) || (a[0] >= P[0] && a[0] < P[1]));
  const phones = [...new Set(ords.map(o => o.ph).concat(adIn.map(a => a[1])).filter(Boolean))];
  const [cus, lds, buys] = phones.length ? await Promise.all([
    allIn(x.db, 'SELECT phone, first, community FROM customers WHERE phone IN (SELECT value FROM json_each(?))', phones),
    allIn(x.db, 'SELECT phone, time, last_at, channel, status, reason FROM leads WHERE phone IN (SELECT value FROM json_each(?))', phones),
    allIn(x.db, 'SELECT phone, time, status, total, items FROM orders WHERE phone IN (SELECT value FROM json_each(?)) AND time >= ?', adIn.map(a => a[1]), Math.min(R[0], P[0]))
  ]) : [[], [], []];
  const firstOf = {}, leadsBy = {}, buyBy = {}, ordBy = {}, inComm = {};
  cus.forEach(c => { const p = normPhone(c.phone); firstOf[p] = Number(c.first) || 0; if (c.community === 'Đã vào') inComm[p] = 1; });
  lds.sort((a, b) => (a.time || 0) - (b.time || 0)).forEach(l => { const p = normPhone(l.phone); (leadsBy[p] = leadsBy[p] || []).push(l); });
  buys.sort((a, b) => (a.time || 0) - (b.time || 0)).forEach(o => { const p = normPhone(o.phone); (ordBy[p] = ordBy[p] || []).push(o); if (!isVoid(o.status)) (buyBy[p] = buyBy[p] || []).push(Number(o.time) || 0); });

  const orderChan = o => {
    const ad = adFirst[o.ph]; if (ad && ad <= o.time) return 'Facebook';
    for (const l of leadsBy[o.ph] || []) { if ((l.time || 0) > o.time || /^file cũ/i.test(l.channel || '')) continue; const k = kwChan(l.channel); if (k) return k; }
    const k = kwChan(o.source); if (k) return k;
    if (isWebO(o)) return WEB; // đơn web không rõ quảng cáo nào (vào thẳng, Google tự nhiên, link KOC…) → kênh Website
    return sfb && /^(File |Nhập tay)/.test(o.source) ? 'Facebook' : '';
  };
  /** Doanh thu khách mới theo kênh (khách mua lần đầu trong kỳ, mọi đơn của họ trong kỳ, kênh = kênh đơn đầu). Khách cũ quay lại: chỉ để tham khảo.
   *  po (kỳ này): các đơn khách mới [kênh, sản phẩm, tiền] để chia theo sản phẩm. */
  const eff = (Rg, san, po, wb) => {
    const C = {}, get = k => C[k] || (C[k] = { newN: 0, newRev: 0, oldRev: 0, oldN: 0, dd: {} }), who = {}, seen = {};
    ords.filter(o => o.time >= Rg[0] && o.time < Rg[1]).forEach(o => {
      const ph = o.ph || ('?' + o.time), f = firstOf[o.ph], isNew = !f || f >= Rg[0];
      if (!who[ph]) who[ph] = orderChan(o) || '?';
      const k = isNew ? who[ph] : orderChan(o) || '?', c = get(k);
      if (wb) { wb.tot += o.total; if (isWebO(o)) { if (isNew && who[ph] === 'Facebook') wb.fb += o.total; else if (isNew) { wb.newRev += o.total; wb.nw[ph] = 1; } else { wb.oldRev += o.total; wb.od[ph] = 1; } } }
      if (isNew) {
        const fresh = !seen[k + ph]; if (fresh) { seen[k + ph] = 1; c.newN++; }
        c.newRev += o.total; const dk = iso(o.time); c.dd[dk] = (c.dd[dk] || 0) + o.total;
        if (po) orderProds(o.items, o.total).forEach(([p, v], i) => po.push([k, p, v, fresh && !i ? ph : '']));
      } else { c.oldRev += o.total; c.oldN++; }
    });
    san.forEach(r => { const c = get(r.shop), g = Number(r.g) || 0; c.san = 1; if (wb) wb.tot += g; c.newRev += g; c.dd[r.day] = (c.dd[r.day] || 0) + g; });
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
  /** 👥 Cộng đồng Zalo trong kỳ: đơn mua lại (sau đơn đầu) của khách đã vào nhóm. → { rev, n (đơn), buyers (khách) } */
  const commOf = Rg => { const o = { rev: 0, n: 0, buyers: 0 }, seen = {}; ords.forEach(d0 => { if (d0.time < Rg[0] || d0.time >= Rg[1] || !inComm[d0.ph] || !firstOf[d0.ph] || d0.time <= firstOf[d0.ph]) return; o.rev += d0.total; o.n++; if (!seen[d0.ph]) { seen[d0.ph] = 1; o.buyers++; } }); return o; };
  /** 🤝 Phản hồi từ sale (data trong kỳ R): chất lượng data theo nguồn, lý do không mua, bao lâu thì mua, hoàn / huỷ, hỏi gì mua gì, mức xử lý data của từng sale.
   *  Chỉ số tổng; tên sale chỉ gửi cho Quản trị (own), Marketing nhận danh sách không tên. */
  const saleFb = (Rg, own) => {
    const src = {}, why = {}, wait = [0, 0, 0, 0, 0], pair = {}, sale = {}, seen = {}, o = { ord: 0, voidN: 0, ret: 0, cancel: 0, voidRev: 0, combo: 0, first: 0, firstRev: 0, ch: {} };
    const sget = k => src[k] || (src[k] = { k, n: 0, won: 0, junk: 0, lost: 0, idle: 0 }), uget = k => sale[k] || (sale[k] = { k, n: 0, won: 0, idle: 0, lost: 0, junk: 0 });
    ads.forEach(([day, ph, sr, sl]) => {
      if (day < Rg[0] || day >= Rg[1] || seen[ph]) return; seen[ph] = 1;
      const ls = (leadsBy[ph] || []).filter(l => (l.last_at || l.time || 0) >= day), od = (ordBy[ph] || []).filter(x => (Number(x.time) || 0) >= day), ok = od.filter(x => !isVoid(x.status));
      const won = ok.length > 0 || ls.some(l => l.status === 'Đã chốt'), no = !won && ls.find(l => l.status === 'Không mua'), junk = no && /rác/i.test(no.reason || '');
      const idle = !won && !no && day < today0 && !ls.some(l => l.status && l.status !== 'Mới hỏi');
      const a = sget(sr || 'Không ghi nguồn'), b = uget(sl || 'Chưa chia');
      [a, b].forEach(c => { c.n++; if (won) c.won++; else if (junk) c.junk++; else if (no) c.lost++; else if (idle) c.idle++; });
      if (no) { const k = whyOf(no.reason); why[k] = (why[k] || 0) + 1; }
      od.forEach(x => { o.ord++; if (isVoid(x.status)) { o.voidN++; o.voidRev += Number(x.total) || 0; if (/hoàn/i.test(x.status)) o.ret++; else o.cancel++; } });
      if (ok.length) {
        const f0 = ok[0], dd = Math.floor((startOfDay(Number(f0.time) || 0) - startOfDay(day)) / DAY);
        wait[dd <= 0 ? 0 : dd <= 2 ? 1 : dd <= 7 ? 2 : dd <= 30 ? 3 : 4]++;
        const got = [...new Set(orderProds(f0.items, Number(f0.total) || 0).map(r => r[0]).filter(String))], ask = prodOf(sr) || 'Chưa rõ sản phẩm';
        o.first++; o.firstRev += Number(f0.total) || 0; if (got.length > 1) o.combo++;
        (got.length ? got : ['Chưa rõ sản phẩm']).forEach(g => { const k = ask + '|' + g; pair[k] = (pair[k] || 0) + 1; });
      }
    });
    // hoàn / huỷ theo kênh (mọi đơn trong kỳ của kênh có chạy quảng cáo)
    ordAll.filter(x => (Number(x.time) || 0) >= Rg[0] && (Number(x.time) || 0) < Rg[1]).forEach(x => {
      const k = orderChan({ ph: normPhone(x.phone), time: Number(x.time) || 0, source: x.source || '' }); if (!k || !paid[k]) return;
      const c = o.ch[k] || (o.ch[k] = { n: 0, v: 0 }); c.n++; if (isVoid(x.status)) c.v++;
    });
    const sl = Object.values(sale).filter(x => x.k !== 'Chưa chia' && x.n >= 5).sort((a, b) => b.won / b.n - a.won / a.n);
    return Object.assign(o, {
      src: Object.values(src).sort((a, b) => b.n - a.n).slice(0, 20), why, wait,
      pairs: Object.keys(pair).map(k => k.split('|').concat(pair[k])).sort((a, b) => b[2] - a[2]).slice(0, 12),
      sales: sl.map(x => own ? x : Object.assign({}, x, { k: '' })), unassigned: (sale['Chưa chia'] || { n: 0 }).n
    });
  };
  // chỉ giữ kênh có chạy quảng cáo (kỳ này hoặc kỳ trước): marketing không thấy doanh thu khách tự tìm đến, sàn không chạy quảng cáo, khách chưa rõ nguồn
  const paid = {}; spDays.concat(spPrev).forEach(r => { if (r.s > 0) paid[r.channel] = 1; });
  const onlyPaid = C => { const o = {}; Object.keys(C).forEach(k => { if (paid[k]) o[k] = C[k]; }); return o; };
  /** Tiền khách mới theo ngày, chỉ kênh có chi phí trong kỳ đó (sàn không chạy quảng cáo không tính) – cho biểu đồ chi phí ↔ tiền khách mới. */
  const byDay = (C, sp) => { const on = {}, o = {}; sp.forEach(r => { if (r.s > 0) on[r.channel] = 1; }); Object.keys(C).forEach(k => { if (on[k]) Object.keys(C[k].dd).forEach(dk => { o[dk] = (o[dk] || 0) + C[k].dd[dk]; }); delete C[k].dd; }); return o; };

  // theo sản phẩm (kỳ này): chi phí theo tên chiến dịch, data + ra đơn theo file số, tiền khách mới (chỉ kênh có chạy quảng cáo) theo dòng sản phẩm của đơn
  const PR = {}, pget = k => PR[k] || (PR[k] = { k, sp: 0, res: 0, n: 0, won: 0, rev: 0, newN: 0 }), po = [];
  const WB = () => ({ tot: 0, fb: 0, newRev: 0, oldRev: 0, nw: {}, od: {} }), wbR = WB(), wbP = WB();
  const fb = (cfg || {}).fb || {}, EF = eff(R, sanR, po, wbR), EP = eff(P, sanP, null, wbP);
  /** 🌐 Website: tiền đơn web chia khách mới / khách cũ; fb = đơn web của khách mới đến từ quảng cáo Facebook (tính cho kênh Facebook). share = % tiền qua web trên toàn bộ doanh thu (CRM + sàn), chỉ gửi %. */
  const webOut = w => ({ newRev: w.newRev, oldRev: w.oldRev, fb: w.fb, newN: Object.keys(w.nw).length, oldN: Object.keys(w.od).length, share: w.tot ? Math.round((w.newRev + w.oldRev + w.fb) * 1000 / w.tot) / 10 : null });
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
    sale: saleFb(R, u.level >= 3), ltv: await ltvOf(x),
    // tiền khách mới mọi kênh marketing (kể cả kênh chưa có chi phí, vd sàn) → tiến độ mục tiêu từng kênh
    revAll: Object.assign(Object.fromEntries(Object.keys(EF).filter(k => GOAL_CH.indexOf(k) >= 0).map(k => [k, EF[k].newRev])), { [COMM]: commOf(R).rev, [WEB]: wbR.newRev + wbR.oldRev }), comm: commOf(R), commPrev: commOf(P), web: webOut(wbR), webPrev: webOut(wbP),
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
  const people = (await all(x.db, "SELECT name FROM users WHERE role = 'Marketing' AND active = 1 ORDER BY ord, rowid")).map(r => r.name);
  const G = await kvJson(x.db, 'mkt_goals', {}), m2 = fmtDate(Date.UTC(y, mo, 1, 12), 'yyyy-MM');
  return { budget: { m, amt: Number(all0[m]) || 0, spent: (r && r.s) || 0, day, dim }, people, goals: { [m]: G[m] || null, [m2]: G[m2] || null, prev: G[fmtDate(Date.UTC(y, mo - 2, 1, 12), 'yyyy-MM')] || null } };
}
/** mkt_budget (Quản trị): { month: yyyy-MM, amount } → đặt ngân sách quảng cáo tháng (0 = bỏ). */
export async function mktBudgetSet(x, d) {
  if (!/^\d{4}-\d\d$/.test(String(d.month || ''))) return { ok: false, error: 'Tháng chưa đúng.' };
  const b = await kvJson(x.db, 'mkt_budget', {}), v = Math.max(0, Math.round(Number(d.amount) || 0));
  if (v) b[d.month] = v; else delete b[d.month];
  await kvSet(x.db, 'mkt_budget', JSON.stringify(b));
  return Object.assign({ ok: true }, await budgetOf(x));
}
/** Tên người phụ trách kênh có phải người này không (không dấu, cho phép "Lan" = "Lan MKT"). */
export function sameWho(a, b) { a = nrm(a); b = nrm(b); return !!a && !!b && (a === b || a.indexOf(b) >= 0 || b.indexOf(a) >= 0); }
/** mkt_goal: { month, goals: { kênh: { rev (tiền khách mới mục tiêu), pct (chi phí tối đa %), who (người phụ trách) } } } → kv mkt_goals.
 *  Quản trị: sửa mọi kênh. Marketing (như sale tự đặt mục tiêu): chỉ kênh mình phụ trách hoặc kênh chưa ai nhận (đặt xong ghi tên mình); kênh người khác giữ nguyên.
 *  Mỗi kênh lưu thêm by / at (ai sửa, lúc nào). Trả changes [[kênh, cũ, mới]] để crm.js ghi Nhật ký. */
export async function mktGoalSet(x, u, d) {
  if (!/^\d{4}-\d\d$/.test(String(d.month || ''))) return { ok: false, error: 'Tháng chưa đúng.' };
  const own = u.level >= 3, all0 = await kvJson(x.db, 'mkt_goals', {}), cur = all0[d.month] || {}, g = {}, changes = [], now = Date.now(), in0 = d.goals || {};
  const txt = v => v ? (v.rev ? ms(v.rev) : '–') + ' / ' + (v.pct ? v.pct + '%' : '–') + (v.who ? ' (' + v.who + ')' : '') : 'trống';
  GOAL_CH.forEach(k => {
    const e = cur[k] && (cur[k].rev || cur[k].pct) ? cur[k] : null, mine = own || !e || !e.who || sameWho(e.who, u.name);
    if (!mine) { if (e) g[k] = e; return; }
    const v = in0[k] || {}, rev = Math.max(0, Math.round(Number(v.rev) || 0)), pct = Math.min(100, Math.max(0, Number(v.pct) || 0));
    const who = own ? String(v.who || '').trim().slice(0, 60) : (e && e.who) || u.name;
    const nv = rev || pct ? { rev, pct, who } : null;
    if (!nv && !e) return;
    if (nv && e && e.rev === nv.rev && e.pct === nv.pct && (e.who || '') === nv.who) { g[k] = e; return; }
    if (nv) g[k] = Object.assign(nv, { by: u.name, at: now });
    changes.push([k, txt(e), txt(nv)]);
  });
  const web = own && d.web !== undefined ? Math.min(100, Math.max(0, Number(d.web) || 0)) : Number(cur._web) || 0;
  if (own && web !== (Number(cur._web) || 0)) changes.push(['% tiền qua website', cur._web ? cur._web + '%' : 'trống', web ? web + '%' : 'trống']);
  if (web) g._web = web;
  if (!own && !changes.length) return Object.assign({ ok: true, changes }, await budgetOf(x));
  if (Object.keys(g).length) all0[d.month] = Object.assign(g, { _by: u.name, _at: now }); else delete all0[d.month];
  await kvSet(x.db, 'mkt_goals', JSON.stringify(all0));
  return Object.assign({ ok: true, changes }, await budgetOf(x));
}

/* ---------------- 8h sáng: tin Telegram "📣 Marketing sáng nay" cho từng bạn Marketing (đã kết nối Telegram) + Quản trị.
 * Dùng lại mktView (cùng cách tính với tab Marketing): tiến độ mục tiêu tháng từng kênh, hôm qua, việc nên làm. Kênh có "người phụ trách" trùng tên người nhận đứng đầu. */
const CH_ICON = { [COMM]: '👥', [WEB]: '🌐', Facebook: '📘', Shopee: '🟠', 'TikTok Shop': '🛍️', Lazada: '🔷', TikTok: '🎵', Google: '🔎', Zalo: '💬', 'KOL / KOC': '⭐' };
const ms = n => { n = Number(n) || 0; return n >= 1e9 ? (n / 1e9).toFixed(1).replace('.0', '').replace('.', ',') + ' tỷ' : n >= 1e6 ? (n / 1e6).toFixed(1).replace('.0', '').replace('.', ',') + ' tr' : Math.round(n).toLocaleString('vi-VN') + 'đ'; };
const pc = (a, b) => b ? Math.round(a * 100 / b) : 0;
/** 🏆 Thi đua marketing: gộp các kênh theo người phụ trách. Xếp theo % mục tiêu đạt; người vượt mức chi phí không đứng hạng 1.
 *  Giống mkBoard trong crm/app.js. G = mục tiêu tháng, rev(k) = tiền của kênh, sp = {kênh: chi phí}. → { rows: [{who, ch[], rev, tgt, sp, cap, p, bad}], team } */
export function mktRank(G, rev, sp) {
  const P = {}, team = { rev: 0, tgt: 0, sp: 0, cap: 0 };
  Object.keys(G || {}).forEach(k => {
    const g = G[k]; if (k.charAt(0) === '_' || !g || !g.rev) return;
    const who = String(g.who || '').trim() || 'Chưa giao', o = P[nrm(who)] || (P[nrm(who)] = { who, ch: [], rev: 0, tgt: 0, sp: 0, cap: 0 });
    const r = rev(k) || 0, s = (sp && sp[k]) || 0; o.ch.push(k); o.rev += r; o.tgt += g.rev; o.sp += s; o.cap += g.rev * (g.pct || 100) / 100;
    team.rev += r; team.tgt += g.rev; team.sp += s; team.cap += g.rev * (g.pct || 100) / 100;
  });
  const fix = o => { o.p = o.tgt ? o.rev / o.tgt : 0; o.maxPct = o.tgt ? Math.round(o.cap * 100 / o.tgt) : 0; o.cp = o.rev ? o.sp * 100 / o.rev : null; o.bad = o.sp > 0 && (o.cp === null || o.cp > o.maxPct); return o; };
  const rows = Object.values(P).map(fix).sort((a, b) => b.p - a.p);
  const i = rows.findIndex(o => !o.bad); if (i > 0 && rows[0].bad) rows.unshift(rows.splice(i, 1)[0]);
  return { rows, team: fix(team) };
}
/** → [{ who: tên người nhận, text }] ; users = danh sách nhân sự (crmUsers), chỉ người có tg. */
export async function mktDailyMsgs(x, users) {
  const to = users.filter(y => y.active && y.tg && (y.role === 'Marketing' || y.level >= 3)); if (!to.length) return [];
  const now = Date.now(), t0 = startOfDay(now), m0 = dayMs(fmtDate(now, 'yyyy-MM') + '-01'), yd = t0 - DAY;
  const pm0 = dayMs(fmtDate(m0 - DAY, 'yyyy-MM') + '-01'), pTo = Math.min(m0 - DAY, pm0 + (t0 - m0));
  const sys = { name: 'Tự động', level: 3 };
  const M = await mktView(x, sys, { from: iso(m0), to: iso(t0), pf: iso(pm0), pt: iso(pTo), sfb: true });
  const Y = await mktView(x, sys, { from: iso(yd), to: iso(yd), pf: iso(yd - DAY), pt: iso(yd - DAY), sfb: true });
  if (!M.ok) return [];
  const G = (M.goals && M.goals[M.budget.m]) || {}, b = M.budget, tp = b.day / b.dim, left = b.dim - b.day + 1;
  const sp = {}; M.days.forEach(r => { sp[r[1]] = (sp[r[1]] || 0) + r[2]; });
  const rev = k => (M.revAll && M.revAll[k]) || 0;
  const line = k => {
    const g = G[k], r = rev(k), s = sp[k] || 0, p = g.rev ? r / g.rev : 0, lv = !g.rev ? '' : p >= 1 ? '🎉' : p >= tp ? '🟢' : p >= tp * 0.8 ? '🟠' : '🔴', cp = r ? s * 100 / r : null;
    const word = k === COMM ? 'tiền mua lại' : k === WEB ? 'tiền đơn web' : ['Shopee', 'TikTok Shop', 'Lazada'].indexOf(k) >= 0 ? 'doanh thu sàn' : 'tiền khách mới', clv = g.pct && s ? (cp === null || cp > g.pct * 1.15 ? '🔴' : cp > g.pct ? '🟠' : '🟢') : '';
    return (CH_ICON[k] || '📦') + ' <b>' + esc(k) + '</b>' + (g.who ? ' (' + esc(g.who) + ')' : '') + ': ' + (g.rev ? ms(r) + ' / ' + ms(g.rev) + ' – <b>' + Math.round(p * 100) + '%</b> ' + lv : ms(r) + ' ' + word) +
      (g.rev && p < 1 ? '\n   Mỗi ngày cần ' + ms(Math.ceil(Math.max(0, g.rev - r) / left)) + ' ' + word : '') +
      (g.pct ? '\n   ' + (!s ? 'Chưa có chi phí (mức tối đa ' + g.pct + '%)' : 'Chi phí ' + (cp !== null ? Math.round(cp) + '%' : ms(s) + ' chưa ra khách') + ' (mức tối đa ' + g.pct + '%) ' + clv) : '');
  };
  const keys = Object.keys(G).filter(k => k.charAt(0) !== '_' && G[k] && (G[k].rev || G[k].pct)).sort((a, c) => (G[c].rev || 0) - (G[a].rev || 0));
  // việc nên làm (giống mkScore / mkTodo, rút gọn)
  const todo = [], cs = (M.camps || []).filter(r => { const last = (r[10] || [])[2]; return !last || dayMs(last) >= yd; }).map(r => {
    const A = M.cpr && M.cpr[r[0]], res = (r[6] || 0) + (r[7] || 0), s = r[3] || 0; if (!A) return null;
    if (!res) return s >= 1.5 * A ? { r, lv: 'bad' } : null;
    if (s < 1.5 * A && res < 3) return null;
    const c = s / res; return { r, lv: c <= 0.8 * A ? 'ok' : c >= 1.4 * A ? 'bad' : '' };
  }).filter(Boolean);
  const nm = a => a.slice(0, 2).map(c => esc(c.r[1])).join(', ') + (a.length > 2 ? ' +' + (a.length - 2) : '');
  const bad = cs.filter(c => c.lv === 'bad'), good = cs.filter(c => c.lv === 'ok');
  if (bad.length) todo.push('🔴 Giảm / tắt: ' + nm(bad));
  if (good.length) todo.push('🟢 Tăng tiền: ' + nm(good));
  if (M.ad && M.ad.idle >= 3) todo.push('⏳ ' + M.ad.idle + ' data chưa có kết quả tư vấn: nhắc sale gọi');
  if (b.amt && b.day) { const fc = b.spent / b.day * b.dim; if (fc > b.amt * 1.1) todo.push('💰 Ngân sách đang chi nhanh: mỗi ngày còn lại nên chi khoảng ' + ms(Math.max(0, b.amt - b.spent) / left)); else if (fc < b.amt * 0.8) todo.push('💰 Ngân sách đang chi chậm (cứ đà này cuối tháng ' + ms(fc) + ' / ' + ms(b.amt) + ')'); }
  const why = (M.sale && M.sale.why) || {}, wk = Object.keys(why).filter(k => !/^(Không ghi|Lý do khác)/.test(k)).sort((a, c) => why[c] - why[a])[0];
  if (wk && why[wk] >= 3) todo.push('🙅 Khách không mua nhiều nhất vì: ' + wk.toLowerCase());
  // hôm qua
  let ys = 0; (Y.days || []).forEach(r => { ys += r[2]; }); let yr = 0; Object.keys(Y.eff || {}).forEach(k => { yr += Y.eff[k].newRev || 0; });
  const yline = Y.ok ? '📅 <b>Hôm qua</b>: chi ' + ms(ys) + ' · tiền khách mới ' + ms(yr) + (ys && yr ? ' (' + pc(ys, yr) + '%)' : '') + (Y.ad ? ' · ' + Y.ad.n + ' data, ' + Y.ad.won + ' đã mua' : '') : '';
  const RK = mktRank(G, rev, sp), team = RK.team, MED = ['🥇', '🥈', '🥉'];
  return to.map(y => {
    const ri = RK.rows.findIndex(o => sameWho(o.who, y.name)), me = RK.rows[ri];
    const rankTxt = RK.rows.length ? '🏆 <b>Thi đua</b>: ' + (me ? 'bạn đang <b>hạng ' + (ri + 1) + '/' + RK.rows.length + '</b> ' + (MED[ri] || '') + ' · đạt ' + Math.round(me.p * 100) + '% mục tiêu' + (me.bad ? ' · ⚠️ chi phí vượt mức' : '') : RK.rows.map((o, i) => (MED[i] || (i + 1) + '.') + ' ' + esc(o.who) + ' ' + Math.round(o.p * 100) + '%').join(' · ')) +
      (M.web && M.web.share !== null ? '\n🌐 <b>Tiền qua website</b>: ' + String(M.web.share).replace('.', ',') + '%' + (G._web ? ' (mục tiêu ' + G._web + '%) ' + (M.web.share >= G._web ? '🟢' : '🔴') : '') + ' · khách mới ' + ms(M.web.newRev) + ', khách cũ ' + ms(M.web.oldRev) : '') +
      '\n🏢 <b>Cả đội</b>: ' + ms(team.rev) + ' / ' + ms(team.tgt) + ' (' + Math.round(team.p * 100) + '%)' + (team.cp !== null && team.sp ? ' · chi phí ' + Math.round(team.cp) + '% (mức ' + team.maxPct + '%)' : '') : '';
    const mine = keys.filter(k => sameWho(G[k].who, y.name)), rest = keys.filter(k => mine.indexOf(k) < 0);
    const goalTxt = keys.length ? '🎯 <b>Mục tiêu tháng ' + Number(b.m.slice(5)) + '</b> (tháng đã qua ' + Math.round(tp * 100) + '%)' + (mine.length ? '\n<i>Kênh của bạn:</i>\n' + mine.map(line).join('\n') + (rest.length ? '\n<i>Kênh khác:</i> ' + rest.map(k => (CH_ICON[k] || '📦') + ' ' + esc(k) + ' ' + (G[k].rev ? pc(rev(k), G[k].rev) + '%' : ms(rev(k)))).join(' · ') : '') : (rest.length ? '\n' + rest.map(line).join('\n') : '')) : '🎯 Chưa có mục tiêu tháng này (Quản trị đặt ở tab Marketing).';
    return { who: y.name, tg: y.tg, text: '📣 <b>Marketing sáng ' + fmtDate(now, 'dd/MM') + '</b>\n\n' + (rankTxt ? rankTxt + '\n\n' : '') + goalTxt + (yline ? '\n\n' + yline : '') +
      (todo.length ? '\n\n✅ <b>Nên làm hôm nay</b>\n' + todo.slice(0, 5).map(t => '• ' + t).join('\n') : '') + '\n\n👉 Xem chi tiết: ' + CRM_URL + '/#marketing' };
  });
}
