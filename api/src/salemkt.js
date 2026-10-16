// 📣 Từ quảng cáo (tab Hiệu quả của sale): sale thấy marketing đã đem về bao nhiêu số, mỗi số tốn bao nhiêu, công ty đã chi cho mình bao nhiêu,
// mình chốt từng sản phẩm thế nào so với cả nhóm, gọi lại số mới nhanh hay chậm, và ưu đãi / thông điệp quảng cáo đang chạy (marketing ghi).
// Nhân viên chỉ nhận số của chính mình + số tổng cả nhóm (không có tên người khác). Quản lý / Quản trị nhận đủ từng người.
import { all, allIn, kvGet, kvJson, kvSet, normPhone, nrm, isVoid, startOfDay, randHex, DAY } from './lib.js';

const DAY_RE = /^\d{4}-\d\d-\d\d$/;
const dayMs = s => new Date(s + 'T00:00:00+07:00').getTime();
/* Sản phẩm: giống PROD_KW trong mktv.js (thêm sản phẩm thì thêm cả 2 nơi). */
const PROD_KW = [['Fucoidan Progomax', /progomax/], ['Gafo Fucoidan', /gafo/], ['DILVANG', /dilvang|dinh lang|che vang/], ['Ruốc rong biển', /ruoc|rong bien/],
  ['Xì dầu 2S', /xi dau|nguu bang/], ['Dinh dưỡng từ hạt', /curcumin|tu hat/], ['Bữa ăn dinh dưỡng', /bua an/], ['Trà Mâm Xôi', /mam xoi/],
  ['Bột Đậu Xanh Rau Má', /rau ma|dau xanh/], ['Ebook / Cẩm nang', /ebook|cam nang/]];
const prodOf = t => { const n = nrm(String(t || '').replace(/_/g, ' ').replace(/([a-z])([A-Z])/g, '$1 $2')); for (const [k, re] of PROD_KW) if (re.test(n)) return k; return ''; };
/** Kênh có chi phí quảng cáo đem về số điện thoại cho sale: bỏ sàn (quảng cáo trong sàn ra đơn sàn) và KOL / KOC (trả theo bài, không ra số). */
const NO_DATA_CH = /shopee|lazada|tiktok ?shop|kol|koc/i;
/** Việc tính là "đã liên hệ" khách hỏi: tư vấn, chăm sóc, nhắn Zalo, gửi ưu đãi… (mọi dòng nhật ký có SĐT, trừ việc của hệ thống). */
const SYS_WHAT = /^(Giao khách|Đồng bộ|Nhập|Cài đặt|Nhân sự|Đơn hàng|Loại đơn|Mục tiêu)/;

/** Tính cho cả nhóm 1 lần (lưu tạm 30 phút), rồi cắt phần của từng người. */
async function teamCalc(x, from, to) {
  const key = 'smkt1_' + from + '_' + to + '_' + ((await kvGet(x.db, 'ads_rows_v')) || '');
  const c = await kvJson(x.db, key, null); if (c) return c;
  const R = [dayMs(from), dayMs(to) + DAY], today0 = startOfDay(Date.now());
  const [adRows, sp] = await Promise.all([kvJson(x.db, 'ads_rows', []),
    all(x.db, 'SELECT channel, campaign, SUM(spend) AS s FROM ad_spend WHERE day BETWEEN ? AND ? GROUP BY channel, campaign', from, to)]);
  // data trong kỳ: mỗi SĐT 1 lần (lần đầu trong kỳ), giống closeStats trong crm/app.js
  const seen = {}, data = [];
  (adRows || []).forEach(a => { const day = Number(a[0]) || 0, ph = normPhone(a[1]); if (!ph || day < R[0] || day >= R[1] || seen[ph]) return; seen[ph] = 1; data.push({ day, ph, sale: String(a[2] || ''), prod: prodOf(a[3]) || 'Khác' }); });
  // chi phí: theo sản phẩm (tên chiến dịch), phần không nhận ra sản phẩm → chia đều cho mọi số
  const spend = { all: 0, by: {} }; sp.forEach(r => { if (NO_DATA_CH.test(r.channel || '')) return; const v = Number(r.s) || 0, p = prodOf(r.campaign); spend.all += v; if (p) spend.by[p] = (spend.by[p] || 0) + v; });
  const nBy = {}; data.forEach(d0 => { nBy[d0.prod] = (nBy[d0.prod] || 0) + 1; });
  let rest = spend.all, restN = data.length; const cpl = {};
  Object.keys(spend.by).forEach(p => { if (nBy[p]) { cpl[p] = spend.by[p] / nBy[p]; rest -= spend.by[p]; restN -= nBy[p]; } });
  const cplRest = restN > 0 ? Math.max(0, rest) / restN : 0; // sản phẩm không có chiến dịch riêng / chiến dịch không ghi tên sản phẩm
  const costOf = p => cpl[p] !== undefined ? cpl[p] : cplRest;
  // kết quả từng số: đơn (không huỷ / hoàn) từ ngày có số, khách hỏi, lần liên hệ đầu tiên
  const phones = data.map(d0 => d0.ph);
  const [ords, lds, logs] = phones.length ? await Promise.all([
    allIn(x.db, 'SELECT phone, time, total, status FROM orders WHERE phone IN (SELECT value FROM json_each(?)) AND time >= ?', phones, R[0]),
    allIn(x.db, 'SELECT phone, time, last_at, status, reason FROM leads WHERE phone IN (SELECT value FROM json_each(?)) AND coalesce(last_at, time) >= ?', phones, R[0]),
    allIn(x.db, 'SELECT ref, time, what FROM logs WHERE ref IN (SELECT value FROM json_each(?)) AND time >= ?', phones, R[0])
  ]) : [[], [], []];
  const oBy = {}, lBy = {}, gBy = {}, push = (m, k, v) => { (m[k] = m[k] || []).push(v); };
  ords.forEach(o => push(oBy, normPhone(o.phone), o)); lds.forEach(l => push(lBy, normPhone(l.phone), l)); logs.forEach(g => { if (!SYS_WHAT.test(g.what || '')) push(gBy, normPhone(g.ref), Number(g.time) || 0); });
  const people = {}, team = blank(), P = {};
  data.forEach(d0 => {
    const os = (oBy[d0.ph] || []).filter(o => (Number(o.time) || 0) >= d0.day), ok = os.filter(o => !isVoid(o.status));
    const ls = (lBy[d0.ph] || []).filter(l => (Number(l.last_at) || Number(l.time) || 0) >= d0.day);
    const won = ok.length > 0 || ls.some(l => l.status === 'Đã chốt'), no = !won && ls.find(l => l.status === 'Không mua'), junk = no && /rác/i.test(no.reason || '');
    // lần liên hệ đầu: nhật ký có SĐT, khách hỏi đổi trạng thái (last_at), hoặc khách đã mua
    const touch = [].concat((gBy[d0.ph] || []).filter(t => t >= d0.day), ls.filter(l => l.status !== 'Mới hỏi' && l.last_at).map(l => Number(l.last_at)), os.map(o => Number(o.time) || 0)).filter(t => t >= d0.day);
    const t1 = touch.length ? Math.min.apply(null, touch) : 0, dd = t1 ? Math.round((startOfDay(t1) - d0.day) / DAY) : null;
    const sp0 = dd === null ? (d0.day < today0 ? 'none' : 'wait') : dd <= 0 ? 'same' : dd === 1 ? 'next' : 'late';
    const cost = costOf(d0.prod), rev = ok.reduce((s, o) => s + (Number(o.total) || 0), 0);
    [team, people[d0.sale] || (people[d0.sale] = blank())].forEach(b => {
      b.n++; b.cost += cost; b.rev += rev; b[sp0]++;
      if (won) b.won++; else if (junk) b.junk++; else if (no) b.lost++; else b.open++;
      const pp = b.prod[d0.prod] || (b.prod[d0.prod] = { n: 0, won: 0, junk: 0, cost: 0 }); pp.n++; pp.cost += cost; if (won) pp.won++; if (junk) pp.junk++;
    });
  });
  Object.keys(cpl).forEach(p => { P[p] = Math.round(cpl[p]); });
  const out = { at: Date.now(), spend: spend.all, n: data.length, cpl: data.length ? Math.round(spend.all / data.length) : 0, cplBy: P, cplRest: Math.round(cplRest), team: fin(team), people: {} };
  Object.keys(people).forEach(k => { out.people[k] = fin(people[k]); });
  const live = R[1] > Date.now();
  await kvSet(x.db, key, JSON.stringify(out), live ? 30 * 60e3 : 12 * 3600e3);
  return out;
}
function blank() { return { n: 0, won: 0, junk: 0, lost: 0, open: 0, cost: 0, rev: 0, same: 0, next: 0, late: 0, none: 0, wait: 0, prod: {} }; }
function fin(b) { b.cost = Math.round(b.cost); Object.keys(b.prod).forEach(k => { b.prod[k].cost = Math.round(b.prod[k].cost); }); return b; }

/** Lệnh 'sale_mkt' { from, to, name? }: name rỗng = cả nhóm (quản lý), nhân viên luôn là chính mình. */
export async function crmSaleMkt(x, u, d) {
  if (![d.from, d.to].every(s => DAY_RE.test(String(s || '')))) return { ok: false, error: 'Khoảng thời gian chưa đúng.' };
  const T = await teamCalc(x, d.from, d.to), name = u.level < 2 ? u.name : String(d.name || '');
  const me = name ? T.people[name] || null : null;
  if (u.level < 2) { // sale chỉ xem chi phí quảng cáo dành cho mình (anh Sơn chốt 16/10/2026): cả nhóm chỉ còn tỷ lệ để so sánh, không có số tiền
    const tm = T.team || blank(), prod = {};
    Object.keys(tm.prod || {}).forEach(k => { const p = tm.prod[k]; prod[k] = { n: p.n, won: p.won, junk: p.junk }; });
    const team = { n: tm.n, won: tm.won, junk: tm.junk, lost: tm.lost, open: tm.open, same: tm.same, next: tm.next, late: tm.late, none: tm.none, wait: tm.wait, cost: 0, rev: 0, roi: tm.cost ? Math.round(tm.rev / tm.cost * 10) / 10 : null, prod };
    return { ok: true, at: T.at, team, me, offers: await offersLive(x), mine: 1 };
  }
  return { ok: true, at: T.at, spend: T.spend, n: T.n, cpl: T.cpl, cplBy: T.cplBy, cplRest: T.cplRest, team: T.team, me, offers: await offersLive(x), people: T.people };
}

/* ---------- Ưu đãi / thông điệp quảng cáo đang chạy: Marketing + Quản trị ghi, mọi người đọc (kv mkt_offers) */
async function offersAll(x) { return (await kvJson(x.db, 'mkt_offers', [])) || []; }
async function offersLive(x) { const t0 = startOfDay(Date.now()); return (await offersAll(x)).filter(o => !o.until || dayMs(o.until) >= t0); }
export async function crmOffers(x, u, d) {
  const a = d.action;
  if (a === 'offers') return { ok: true, list: await offersAll(x) };
  if (u.level < 3 && u.role !== 'Marketing') return { ok: false, error: 'Chỉ Marketing và Quản trị sửa được ưu đãi.' };
  let L = await offersAll(x);
  if (a === 'offer_del') { L = L.filter(o => o.id !== d.id); await kvSet(x.db, 'mkt_offers', JSON.stringify(L)); return { ok: true, list: L }; }
  if (a === 'offer_save') {
    const title = String(d.title || '').trim().slice(0, 120); if (!title) return { ok: false, error: 'Chưa có tên ưu đãi.' };
    const until = DAY_RE.test(String(d.until || '')) ? d.until : '';
    const o = { id: d.id || randHex(4), title, prod: String(d.prod || '').trim().slice(0, 60), text: String(d.text || '').trim().slice(0, 800), until, by: u.name, at: Date.now() };
    const i = L.findIndex(y => y.id === o.id); if (i >= 0) L[i] = o; else L.unshift(o);
    L = L.filter(y => !y.until || dayMs(y.until) >= Date.now() - 60 * DAY).slice(0, 40); // ưu đãi hết hạn quá 60 ngày thì bỏ
    await kvSet(x.db, 'mkt_offers', JSON.stringify(L)); return { ok: true, list: L };
  }
  return { ok: false, error: 'Không rõ thao tác: ' + a };
}
