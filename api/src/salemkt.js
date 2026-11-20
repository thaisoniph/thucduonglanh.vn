// 📣 Từ quảng cáo (tab Hiệu quả của sale): sale thấy marketing đã đem về bao nhiêu số, mỗi số tốn bao nhiêu, công ty đã chi cho mình bao nhiêu,
// mình chốt từng sản phẩm thế nào so với cả nhóm, gọi lại số mới nhanh hay chậm, và ưu đãi / thông điệp quảng cáo đang chạy (marketing ghi).
// Nhân viên chỉ nhận số của chính mình + số tổng cả nhóm (không có tên người khác). Quản lý / Quản trị nhận đủ từng người.
import { all, allIn, kvGet, kvJson, kvSet, normPhone, nrm, isVoid, startOfDay, randHex, DAY } from './lib.js';
import { ddOffer } from './ngaydoi.js';
import { caCfg, caOf, crmUsers, SUPER_ADMIN } from './crm.js';

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
  const key = 'smkt4_' + from + '_' + to + '_' + ((await kvGet(x.db, 'ads_rows_v')) || '');
  const c = await kvJson(x.db, key, null); if (c) return c;
  const R = [dayMs(from), dayMs(to) + DAY], today0 = startOfDay(Date.now());
  const [adRows, sp, dcfg] = await Promise.all([kvJson(x.db, 'ads_rows', []),
    all(x.db, 'SELECT channel, campaign, SUM(spend) AS s FROM ad_spend WHERE day BETWEEN ? AND ? GROUP BY channel, campaign', from, to), kvJson(x.db, 'dash_cfg', {})]);
  const backCost = Number(dcfg && dcfg.backCost) > 0 ? Number(dcfg.backCost) : 30000; // phí ship mất 1 đơn hoàn (đi + về), giống backCost() crm/app.js
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
    allIn(x.db, 'SELECT phone, time, total, status, ship_fee FROM orders WHERE phone IN (SELECT value FROM json_each(?))', phones), // cả đơn cũ: biết khách đã từng mua
    allIn(x.db, 'SELECT phone, time, last_at, status, reason FROM leads WHERE phone IN (SELECT value FROM json_each(?)) AND coalesce(last_at, time) >= ?', phones, R[0]),
    allIn(x.db, 'SELECT ref, time, what FROM logs WHERE ref IN (SELECT value FROM json_each(?)) AND time >= ?', phones, R[0])
  ]) : [[], [], []];
  const oBy = {}, lBy = {}, gBy = {}, push = (m, k, v) => { (m[k] = m[k] || []).push(v); };
  ords.forEach(o => push(oBy, normPhone(o.phone), o)); lds.forEach(l => push(lBy, normPhone(l.phone), l)); logs.forEach(g => { if (!SYS_WHAT.test(g.what || '')) push(gBy, normPhone(g.ref), Number(g.time) || 0); });
  const people = {}, team = blank(), P = {};
  data.forEach(d0 => {
    const all0 = oBy[d0.ph] || [], os = all0.filter(o => (Number(o.time) || 0) >= d0.day), ok = os.filter(o => !isVoid(o.status));
    // 20/11/2026: tỷ lệ chốt (cn / cw) chỉ tính khách chưa từng mua, ra đơn trong 30 ngày (giống closeStats crm/app.js); n / won / rev giữ cho tiền quảng cáo
    const was = all0.some(o => !isVoid(o.status) && (Number(o.time) || 0) < d0.day), end = d0.day + 30 * DAY;
    const w30 = !was && (ok.some(o => (Number(o.time) || 0) < end) || (lBy[d0.ph] || []).some(l => { const t = Number(l.last_at) || Number(l.time) || 0; return t >= d0.day && t < end && l.status === 'Đã chốt'; }));
    const ls = (lBy[d0.ph] || []).filter(l => (Number(l.last_at) || Number(l.time) || 0) >= d0.day);
    const won = ok.length > 0 || ls.some(l => l.status === 'Đã chốt'), no = !won && ls.find(l => l.status === 'Không mua'), junk = no && /rác/i.test(no.reason || '');
    // lần liên hệ đầu: nhật ký có SĐT, khách hỏi đổi trạng thái (last_at), hoặc khách đã mua
    const touch = [].concat((gBy[d0.ph] || []).filter(t => t >= d0.day), ls.filter(l => l.status !== 'Mới hỏi' && l.last_at).map(l => Number(l.last_at)), os.map(o => Number(o.time) || 0)).filter(t => t >= d0.day);
    const t1 = touch.length ? Math.min.apply(null, touch) : 0, dd = t1 ? Math.round((startOfDay(t1) - d0.day) / DAY) : null;
    const sp0 = dd === null ? (d0.day < today0 ? 'none' : 'wait') : dd <= 0 ? 'same' : dd === 1 ? 'next' : 'late';
    const cost = costOf(d0.prod), rev = ok.reduce((s, o) => s + (Number(o.total) || 0), 0);
    // 20/11/2026 anh Sơn: đơn hoàn mất phí ship 2 chiều → trừ khi xếp nhóm A/B/C (phí thật từ file đối soát, chưa đối soát = backCost). Huỷ trước khi gửi không mất ship.
    const backs = os.filter(o => /hoàn/i.test(String(o.status || ''))), bk = backs.reduce((s, o) => s + (o.ship_fee != null ? Number(o.ship_fee) || 0 : backCost), 0);
    [team, people[d0.sale] || (people[d0.sale] = blank())].forEach(b => {
      b.n++; b.cost += cost; b.rev += rev; b.bk += bk; b.bn += backs.length; b[sp0]++; if (!was) { b.cn++; if (w30) b.cw++; }
      if (won) b.won++; else if (junk) b.junk++; else if (no) b.lost++; else b.open++;
      const pp = b.prod[d0.prod] || (b.prod[d0.prod] = { n: 0, won: 0, junk: 0, cost: 0, cn: 0, cw: 0 }); pp.n++; pp.cost += cost; if (won) pp.won++; if (junk) pp.junk++; if (!was) { pp.cn++; if (w30) pp.cw++; }
    });
  });
  Object.keys(cpl).forEach(p => { P[p] = Math.round(cpl[p]); });
  const out = { at: Date.now(), spend: spend.all, n: data.length, cpl: data.length ? Math.round(spend.all / data.length) : 0, cplBy: P, cplRest: Math.round(cplRest), team: fin(team), people: {} };
  Object.keys(people).forEach(k => { out.people[k] = fin(people[k]); });
  out.best = await bestCalc(x, R, people);
  const live = R[1] > Date.now();
  await kvSet(x.db, key, JSON.stringify(out), live ? 30 * 60e3 : 12 * 3600e3);
  return out;
}
/** Người giỏi nhất nhóm ở từng bước (29/10/2026): chỉ tỷ lệ, không tên, không tiền (giữ cách thi đua bớt so tiền).
 *  Chỉ tính người đang làm (không Quản trị) có đủ mẫu: ≥ 10 số quảng cáo / ≥ 10 đơn, để 1–2 số may mắn không thành "giỏi nhất". */
async function bestCalc(x, R, people) {
  const staff = {}; (await all(x.db, "SELECT name FROM users WHERE active = 1 AND role != 'Quản trị'")).forEach(r => { staff[r.name] = 1; });
  const best = { speed: null, close: null, roi: null, ok: null }, up = (k, v) => { if (v !== null && (best[k] === null || v > best[k])) best[k] = v; };
  Object.keys(people).forEach(k => {
    const b = people[k]; if (!staff[k] || b.n < 10) return;
    const called = b.same + b.next + b.late + b.none;
    up('speed', called >= 10 ? Math.round(b.same * 100 / called) : null);
    up('close', b.cn >= 10 ? Math.round(b.cw * 100 / b.cn) : null);
    up('roi', b.cost ? Math.round(b.rev / b.cost * 10) / 10 : null);
  });
  const by = {}; (await all(x.db, "SELECT seller, status, count(*) AS n FROM orders WHERE time >= ? AND time < ? GROUP BY seller, status", R[0], R[1])).forEach(r => {
    const o = by[r.seller] || (by[r.seller] = { n: 0, v: 0 }); if (/huỷ|hủy/i.test(r.status || '')) return; o.n += r.n; if (/hoàn/i.test(r.status || '')) o.v += r.n; // 01/11/2026: giao thành công = 1 − đơn hoàn ÷ đơn đã gửi (đơn huỷ không tính)
  });
  Object.keys(by).forEach(k => { if (staff[k] && by[k].n >= 10) up('ok', 100 - Math.round(by[k].v * 100 / by[k].n)); });
  return best;
}
function blank() { return { n: 0, won: 0, cn: 0, cw: 0, junk: 0, lost: 0, open: 0, cost: 0, rev: 0, bk: 0, bn: 0, same: 0, next: 0, late: 0, none: 0, wait: 0, prod: {} }; }
function fin(b) { b.cost = Math.round(b.cost); Object.keys(b.prod).forEach(k => { b.prod[k].cost = Math.round(b.prod[k].cost); }); return b; }

/* ---------- 🅰️🅱️©️ Chia số quảng cáo theo nhóm (16/11/2026 anh Sơn + anh Hiếu): quảng cáo đắt, số ít → ưu tiên số cho sale chốt tốt.
 * Nhóm theo 60 ngày gần nhất (tới hôm qua): (tiền mang về từ số quảng cáo − phí ship mất của đơn hoàn, 20/11/2026) ÷ tiền quảng cáo của các số đó (ROI).
 * A ≥ 1,8đ (gần / qua mức ~2đ đủ bù quảng cáo sau giá vốn, ship, thuế, hoa hồng) → 3 lượt / vòng · B ≥ 1,2đ → 2 lượt · C dưới 1,2đ → 1 lượt (vẫn có số để cố gắng lên nhóm).
 * Thử với số thật 16/11: luật "gọi trong ngày dưới 60% xuống 1 nhóm" đẩy Lương (1,97đ, 57%) xuống C vì nhiều cuộc gọi không ghi CRM → bỏ, % gọi trong ngày chỉ để xem.
 * Dưới 15 số (người mới) → B. Tính lại 7 ngày / lần (kv ads_tier). */
export const TIER = { A: { w: 3, min: 1.8 }, B: { w: 2, min: 1.2 }, C: { w: 1, min: 0 } }, TIER_SP = 60, TIER_MINN = 15, TIER_DAYS = 60;
const isoVN = t => new Date(t + 7 * 3600e3).toISOString().slice(0, 10);
export async function adsTier(x, force) {
  const c = await kvJson(x.db, 'ads_tier', null);
  if (c && !force && Date.now() - c.at < 7 * DAY) return c;
  const to = isoVN(Date.now() - DAY), from = isoVN(Date.now() - TIER_DAYS * DAY), T = await teamCalc(x, from, to), P = {};
  Object.keys(T.people || {}).forEach(k => {
    const b = T.people[k], called = b.same + b.next + b.late + b.none, bk = b.bk || 0, roi = b.cost ? Math.round((b.rev - bk) / b.cost * 100) / 100 : null, sp = called ? Math.round(b.same * 100 / called) : null;
    const g = b.n < TIER_MINN || roi === null ? 'B' : roi >= TIER.A.min ? 'A' : roi >= TIER.B.min ? 'B' : 'C', down = false;
    P[k] = { g, roi, sp, n: b.n, rev: b.rev, cost: b.cost, bk, bn: b.bn || 0, down, nw: b.n < TIER_MINN }; // roi đã trừ ship đơn hoàn (bk, bn đơn)
  });
  const out = { at: Date.now(), from, to, people: P };
  await kvSet(x.db, 'ads_tier', JSON.stringify(out));
  return out;
}
/** Lệnh 'ads_tier' { force? }: Quản lý / Quản trị xem nhóm từng người; Quản trị bấm Xếp lại ngay (force). */
export async function crmAdsTier(x, u, d) {
  if (u.level < 2) return { ok: false, error: 'Chỉ Quản lý, Quản trị.' };
  const cfg = (await kvJson(x.db, 'ads_cfg', {})) || {}, w = (await kvJson(x.db, 'ads_wrr', {})) || {};
  const ca = await caCfg(x);
  return { ok: true, duty: ((await kvJson(x.db, 'ads_duty', null)) || {}).names || [], caNow: caOf(Date.now(), ca), evening: ca.evening || '17:30', t: await adsTier(x, !!d.force && u.level >= 3), W: TIER, sp: TIER_SP, minN: TIER_MINN, mode: cfg.mode || 'staff', today: w.cnt || {}, day: w.day || '' };
}
/* 🌙 Lịch trực số quảng cáo (19/11/2026, anh Sơn): tối (từ giờ ca tối) / Chủ nhật / ngày lễ CRM chỉ chia số cho người trực ca đó.
 * kv ads_duty = { week: { '0'..'6': [tên] } (lịch cố định mỗi tuần, 0 = Chủ nhật), days: { 'YYYY-MM-DD': [tên] } (sửa riêng 1 ngày, [] = không ai),
 *   boss: tên người phụ trách chia số (xếp lịch, nhặt số ban ngày, nhận nhắc), names: [] (bản đầu, chỉ còn để đọc lại) }. */
const vnKey = t => isoVN(t), vnDow = t => new Date(t + 7 * 3600e3).getUTCDay();
export async function dutyCfg(x) { const D = (await kvJson(x.db, 'ads_duty', null)) || {}; D.week = D.week || {}; D.days = D.days || {}; D.day = D.day || {}; D.dayOv = D.dayOv || {}; return D; }
/** ☀️ Người nhặt số ban ngày của 1 ngày: đổi riêng ngày → lịch thứ trong tuần → người phụ trách. */
export function dayPicker(D, t) { const k = vnKey(t); return (D.dayOv || {})[k] || (D.day || {})[String(vnDow(t))] || D.boss || ''; }
/** Người trực của 1 ngày (theo ngày sửa riêng → lịch tuần → bản đầu). */
export function dutyOn(D, t) { const k = vnKey(t); if (Array.isArray(D.days[k])) return D.days[k]; const w = D.week[String(vnDow(t))]; return Array.isArray(w) ? w : (D.names || []); }
/** Trả { ca, pool }: pool = danh sách được chia lúc này. Ban ngày hoặc ca chưa xếp ai → pool như cũ. */
export async function adsDutyPool(x, pool, users) {
  const ca = caOf(Date.now(), await caCfg(x)); if (ca === 'Ngày') return { ca, pool };
  const act = new Set(users.filter(y => y.active).map(y => y.name)), duty = dutyOn(await dutyCfg(x), Date.now()).filter(n => act.has(n));
  return { ca, pool: duty.length ? duty : pool, duty: duty.length > 0 };
}
const canDuty = (u, D) => u.level >= 2 || (D.boss && D.boss === u.name);
const cleanNames = a => (Array.isArray(a) ? a : []).map(n => String(n).trim()).filter(Boolean).slice(0, 10);
/** Lệnh 'ads_duty_get': ai cũng xem được lịch (sale thấy ca của mình), sửa: Quản lý / Quản trị / người phụ trách. */
export async function crmAdsDutyGet(x, u) {
  const D = await dutyCfg(x), ca = await caCfg(x);
  return { ok: true, week: D.week, days: D.days, day: D.day, dayOv: D.dayOv, boss: D.boss || '', names: D.names || [], at: D.at || 0, by: D.by || '', canEdit: canDuty(u, D), canBoss: u.level >= 2,
    evening: ca.evening || '17:30', holidays: ca.holidays || ['01/01', '30/04', '01/05', '02/09'], caNow: caOf(Date.now(), ca), today: vnKey(Date.now()) };
}
/** Lệnh 'ads_duty_set' { week?, days?, boss? }: lưu lịch trực. days chỉ giữ từ hôm nay trở đi. */
export async function crmAdsDutySet(x, u, d) {
  const D = await dutyCfg(x); if (!canDuty(u, D)) return { ok: false, error: 'Chỉ Quản lý, Quản trị hoặc người phụ trách chia số.' };
  if (d.week && typeof d.week === 'object') { const w = {}; for (let i = 0; i < 7; i++) w[i] = cleanNames(d.week[i]); D.week = w; delete D.names; }
  if (d.days && typeof d.days === 'object') { const today = vnKey(Date.now()), o = {}; Object.keys(d.days).filter(k => /^\d{4}-\d{2}-\d{2}$/.test(k) && k >= today).slice(0, 120).forEach(k => { o[k] = cleanNames(d.days[k]); }); D.days = o; }
  if (d.day && typeof d.day === 'object') { const w = {}; for (let i = 1; i <= 6; i++) { const n = String(d.day[i] || '').trim().slice(0, 60); if (n) w[i] = n; } D.day = w; }
  if (d.dayOv && typeof d.dayOv === 'object') { const today = vnKey(Date.now()), o = {}; Object.keys(d.dayOv).filter(k => /^\d{4}-\d{2}-\d{2}$/.test(k) && k >= today).slice(0, 120).forEach(k => { const n = String(d.dayOv[k] || '').trim().slice(0, 60); if (n) o[k] = n; }); D.dayOv = o; }
  if ('boss' in d) { if (u.level < 2) return { ok: false, error: 'Chỉ Quản lý, Quản trị giao người phụ trách.' }; D.boss = String(d.boss || '').trim().slice(0, 60); }
  D.at = Date.now(); D.by = u.name;
  await kvSet(x.db, 'ads_duty', JSON.stringify(D));
  return { ok: true };
}
/** Cron 10 phút: 🌙 nhắc người trực lúc vào ca (tối: giờ ca tối; Chủ nhật / lễ: 8h), 📅 thứ Sáu 9h nhắc người phụ trách nếu 7 ngày tới còn ca trống. */
export async function dutyTick(x, send) {
  const now = Date.now(), vn = new Date(now + 7 * 3600e3), hm = vn.getUTCHours() * 60 + vn.getUTCMinutes(), ca = await caCfg(x), D = await dutyCfg(x);
  const ev = String(ca.evening || '17:30').split(':'), evM = (+ev[0]) * 60 + (+ev[1] || 0), allDay = caOf(Date.UTC(vn.getUTCFullYear(), vn.getUTCMonth(), vn.getUTCDate(), 3), ca) !== 'Ngày'; // 10h sáng hôm nay đã là ca Tối/CN/Lễ → cả ngày
  const start = allDay ? 8 * 60 : evM, k = 'duty_tg_' + vnKey(now);
  if (hm >= start && hm < start + 30 && !(await kvGet(x.db, k))) {
    await kvSet(x.db, k, '1', 2 * DAY);
    const who = dutyOn(D, now), lbl = allDay ? (vn.getUTCDay() === 0 ? 'Chủ nhật hôm nay' : 'Ngày lễ hôm nay') : 'Tối nay (từ ' + (ca.evening || '17:30') + ')';
    for (const n of who) await send(x, n, '🌙 <b>' + lbl + ' bạn trực số quảng cáo</b>\nNhặt số khách nhắn page vào file (để trống ô Sale). CRM sẽ chia số ca này cho ' + (who.length > 1 ? 'các bạn trực: ' + who.join(', ') : 'bạn') + '.\nGọi số mới ngay khi Telegram báo nhé 💚');
    if (!who.length && D.boss) await send(x, D.boss, '⚠️ <b>' + lbl + ' chưa xếp ai trực số quảng cáo</b> → CRM đang chia cho mọi người. Mở CRM → 🗓 Lịch trực số để xếp.');
  }
  const kd = 'duty_dp_' + vnKey(now), dp = dayPicker(D, now);
  if (!allDay && dp && hm >= 8 * 60 && hm < 8 * 60 + 30 && !(await kvGet(x.db, kd))) {
    await kvSet(x.db, kd, '1', 2 * DAY);
    await send(x, dp, '☀️ <b>Hôm nay bạn phụ trách nhặt số quảng cáo ban ngày</b> (8h – ' + (ca.evening || '17:30') + ')\nKhách nhắn page để lại số → dán ngày, tên, số điện thoại vào file, <b>để trống ô Sale</b>, CRM tự chia. Trả lời khách sớm, đừng để tin nhắn chờ nhé 💚');
  }
  try { await adsSlowCheck(x, send, D, ca, now, hm, allDay, evM); } catch (e) { console.error('adsSlow', e.message); }
  try { await adsCrmAt(x, send, D, now); } catch (e) { console.error('adsCrmAt', e.message); }
  const kb = 'duty_wk_' + vnKey(now);
  if (D.boss && vn.getUTCDay() === 5 && hm >= 9 * 60 && hm < 9 * 60 + 30 && !(await kvGet(x.db, kb))) {
    await kvSet(x.db, kb, '1', 2 * DAY);
    const empty = []; for (let i = 1; i <= 7; i++) { const t = now + i * DAY; if (!dutyOn(D, t).length) empty.push(dutyLbl(t, ca)); }
    if (empty.length) await send(x, D.boss, '📅 <b>Lịch trực số 7 ngày tới còn ' + empty.length + ' ca trống</b>: ' + empty.join(', ') + '\nCa trống thì CRM chia cho mọi người. Mở CRM → 🗓 Lịch trực số để xếp.');
  }
}
/** ⏰ Hẹn bật CRM tự chia số (20/11/2026 anh Sơn: bật từ sáng thứ Hai 23/11): ads_cfg.crmAt = mốc giờ → tới giờ đổi mode = 'crm', bỏ crmAt,
 *  Telegram anh Sơn + người phụ trách chia số 1 lần (kv ads_crm_tg). Nếu lần đồng bộ file ghi đè ads_cfg cùng lúc thì 10 phút sau tự bật lại. */
async function adsCrmAt(x, send, D, now) {
  const cfg = await kvJson(x.db, 'ads_cfg', null); if (!cfg || !cfg.crmAt || now < Number(cfg.crmAt)) return;
  cfg.mode = 'crm'; delete cfg.crmAt; await kvSet(x.db, 'ads_cfg', JSON.stringify(cfg));
  if (await kvGet(x.db, 'ads_crm_tg')) return; await kvSet(x.db, 'ads_crm_tg', '1', 30 * DAY);
  const boss = ((await crmUsers(x)).find(y => y.email === SUPER_ADMIN) || {}).name, msg = '🅰️🅱️©️ <b>Từ bây giờ CRM tự chia số quảng cáo theo nhóm A/B/C</b> (A 3 · B 2 · C 1 số mỗi vòng, tối đa 10 số / người / ngày, khách cũ về sale cũ).\nNgười nhặt số nhớ <b>để trống ô Sale</b> trong file. Xem bảng nhóm ở Cài đặt → Đồng bộ → File số quảng cáo.';
  for (const n of [...new Set([boss, D.boss].filter(Boolean))]) await send(x, n, msg);
}
/** ⏰ Cảnh báo số về chậm (19/11/2026): 8h – 21h30, Facebook báo thêm ≥ 3 tin nhắn quảng cáo mà file 2 tiếng không có số mới
 *  → Telegram người đang phụ trách (ban ngày: người nhặt số; tối / CN / lễ: người trực) + anh Sơn. 2 tiếng báo tối đa 1 lần. kv ads_slow.
 *  Tin nhắn Facebook (ad_spend.msgs) cập nhật 1 tiếng / lần, không phải tin nào cũng có số → ngưỡng 3 tin để đỡ báo nhầm. */
async function adsSlowCheck(x, send, D, ca, now, hm, allDay, evM) {
  const day = vnKey(now), t0 = new Date(day + 'T00:00:00+07:00').getTime();
  const rows = (await kvJson(x.db, 'ads_rows', null)) || [], fileN = rows.filter(r => r[0] === t0).length;
  const m = await first0(x.db, "SELECT coalesce(sum(msgs), 0) n FROM ad_spend WHERE day = ? AND channel = 'Facebook'", day), msgN = Number(m && m.n) || 0;
  let S = (await kvJson(x.db, 'ads_slow', null)) || {};
  if (S.day !== day) S = { day, fileN, fileAt: now, msgAtFile: msgN, alertAt: 0 };
  if (fileN > S.fileN || fileN < S.fileN) { S.fileN = fileN; S.fileAt = now; S.msgAtFile = msgN; }
  const open = hm >= 8 * 60 && hm <= 21 * 60 + 30; if (!open) { S.fileAt = now; S.msgAtFile = msgN; } // đêm không ai trực → tính lại từ 8h
  const gap = now - S.fileAt, more = msgN - S.msgAtFile;
  if (open && gap >= 2 * 3600e3 && more >= 3 && now - (S.alertAt || 0) >= 2 * 3600e3) {
    S.alertAt = now;
    const night = allDay || hm >= evM, who = night ? dutyOn(D, now) : [dayPicker(D, now)].filter(Boolean);
    const h = Math.floor(gap / 3600e3), txt = '⏰ <b>Số quảng cáo về chậm</b>\n' + h + ' tiếng qua Facebook báo thêm <b>' + more + ' tin nhắn</b> từ quảng cáo nhưng file chưa có số mới (hôm nay file ' + fileN + ' số, Facebook ' + msgN + ' tin nhắn).\n👉 Mở page kiểm tra tin nhắn chờ, xin số và dán vào file.';
    const boss = ((await crmUsers(x)).find(y => y.email === SUPER_ADMIN) || {}).name;
    const to = [...new Set(who.concat(D.boss && !night ? [D.boss] : [], boss ? [boss] : []))];
    for (const n of to) await send(x, n, txt + (who.indexOf(n) >= 0 ? '' : '\n(Đang phụ trách: ' + (who.join(', ') || 'chưa xếp ai') + ')'));
  }
  await kvSet(x.db, 'ads_slow', JSON.stringify(S));
}
async function first0(db, q, ...a) { const r = await all(db, q, ...a); return r[0] || null; }
function dutyLbl(t, ca) { const d = new Date(t + 7 * 3600e3), dm = d.getUTCDate() + '/' + (d.getUTCMonth() + 1), w = d.getUTCDay(); return (w === 0 ? 'CN ' : 'Tối T' + (w + 1) + ' ') + dm; }
/** Nhóm của 1 người (không có số liệu → B). */
export function tierOf(t, name) { return (t && t.people && t.people[name]) || { g: 'B', nw: true }; }

/** Lệnh 'sale_mkt' { from, to, name? }: name rỗng = cả nhóm (quản lý), nhân viên luôn là chính mình. */
export async function crmSaleMkt(x, u, d) {
  if (![d.from, d.to].every(s => DAY_RE.test(String(s || '')))) return { ok: false, error: 'Khoảng thời gian chưa đúng.' };
  const T = await teamCalc(x, d.from, d.to), name = u.level < 2 ? u.name : String(d.name || '');
  const me = name ? T.people[name] || null : null;
  // 20/11/2026: mốc "cả nhóm" để so từng người = chỉ các sale văn phòng nhận số quảng cáo (không số chưa chia, quản lý, CTV) — giống coSales() trong crm/app.js.
  // team (mọi số) vẫn giữ cho chi phí / số liệu cả công ty.
  const cs = (await crmUsers(x)).filter(v => v.role === 'Sale & CSKH' && !v.ctv && v.active).map(v => v.name);
  const teamS = cs.reduce((t, n) => { const p = T.people[n]; if (p) { t.n += p.n; t.won += p.won; t.cn += p.cn || 0; t.cw += p.cw || 0; t.same += p.same; t.next += p.next; t.late += p.late; t.none += p.none; t.cost += p.cost; t.rev += p.rev; } return t; }, { n: 0, won: 0, cn: 0, cw: 0, same: 0, next: 0, late: 0, none: 0, cost: 0, rev: 0, names: cs.length });
  if (u.level < 2) { // sale chỉ xem chi phí quảng cáo dành cho mình (anh Sơn chốt 16/10/2026): cả nhóm chỉ còn tỷ lệ để so sánh, không có số tiền
    const tm = T.team || blank(), prod = {};
    Object.keys(tm.prod || {}).forEach(k => { const p = tm.prod[k]; prod[k] = { n: p.n, won: p.won, junk: p.junk, cn: p.cn, cw: p.cw }; });
    const team = { n: tm.n, won: tm.won, cn: tm.cn, cw: tm.cw, junk: tm.junk, lost: tm.lost, open: tm.open, same: tm.same, next: tm.next, late: tm.late, none: tm.none, wait: tm.wait, cost: 0, rev: 0, roi: tm.cost ? Math.round(tm.rev / tm.cost * 10) / 10 : null, prod };
    const tAll = await adsTier(x), aCfg = (await kvJson(x.db, 'ads_cfg', {})) || {}; // 20/11/2026: dòng nhóm A/B/C của sale ghi rõ cách tính, kỳ tính, ngày xếp lại, ngày bật
    return { ok: true, at: T.at, team, me, best: T.best || null, offers: await offersLive(x), mine: 1, teamS: { n: teamS.n, won: teamS.won, cn: teamS.cn, cw: teamS.cw, same: teamS.same, next: teamS.next, late: teamS.late, none: teamS.none, roi: teamS.cost ? Math.round(teamS.rev / teamS.cost * 10) / 10 : null }, co: await beCo(x, u, name), be: await kvJson(x.db, 'be_vr', null), tier: tierOf(tAll, name), tierAt: tAll.at, tierFrom: tAll.from, tierTo: tAll.to, tierMinN: TIER_MINN, tierW: TIER, split: aCfg.mode || 'staff', splitAt: aCfg.crmAt || null };
  }
  return { ok: true, co: await beCo(x, u, name || u.name), be: await kvJson(x.db, 'be_vr', null), at: T.at, spend: T.spend, n: T.n, cpl: T.cpl, cplBy: T.cplBy, cplRest: T.cplRest, team: T.team, teamS, me, best: T.best || null, offers: await offersLive(x), people: T.people };
}

/** ⚖️ Hoà vốn số quảng cáo (16/11/2026 anh Sơn): Quản trị mở Tổng quan → CRM gửi 1 tỷ lệ gộp (giá vốn + ship + VAT trên 1đ doanh số).
 *  Sale chỉ nhận tỷ lệ gộp này để tính "cần bán bao nhiêu từ số của mình thì công ty hoà vốn", không thấy giá nhập hay từng khoản. */
export async function crmBeVrSet(x, u, d) {
  if (u.level < 3) return { ok: false, error: 'Chỉ Quản trị.' };
  if (d.co) { // 🏢 hoà vốn cả văn phòng (19/11/2026, anh Sơn chọn mức A): chỉ số cần bán / ngày, TB đang bán, chi phí cố định / ngày, phần chia theo mục tiêu. Không có giá vốn, lãi lỗ.
    const c = d.co, n = v => { const k = Math.round(Number(v)); return isFinite(k) && k >= 0 && k < 1e10 ? k : null; }, sh = {};
    if (!/^20\d\d-(0[1-9]|1[0-2])$/.test(String(c.m || '')) || !n(c.be) || n(c.avg) === null) return { ok: false, error: 'Số hoà vốn chưa đúng.' };
    Object.keys(c.sh || {}).slice(0, 60).forEach(k => { const v = Number(c.sh[k]); if (v > 0 && v <= 1) sh[String(k).slice(0, 80)] = Math.round(v * 1000) / 1000; });
    await kvSet(x.db, 'be_co', JSON.stringify({ m: c.m, be: n(c.be), avg: n(c.avg), nd: Math.min(31, n(c.nd) || 0), fx: n(c.fx) || 0, sv: n(c.sv), sh, at: Date.now() }));
    return { ok: true };
  }
  const r = Number(d.r); if (!(r > 0 && r < 0.9)) return { ok: false, error: 'Tỷ lệ chưa đúng.' };
  await kvSet(x.db, 'be_vr', JSON.stringify({ r: Math.round(r * 1000) / 1000, at: Date.now() }));
  return { ok: true };
}
/** 🏢 số hoà vốn cả văn phòng cho sale: chỉ tháng này; sale chỉ nhận phần chia của mình (không thấy mục tiêu người khác). */
async function beCo(x, u, name) {
  const c = await kvJson(x.db, 'be_co', null); if (!c || !c.be) return null;
  const now = new Date(Date.now() + 7 * 3600e3), m = now.getUTCFullYear() + '-' + String(now.getUTCMonth() + 1).padStart(2, '0'); if (c.m !== m) return null;
  const o = { m: c.m, be: c.be, avg: c.avg, nd: c.nd, fx: c.fx, sv: c.sv != null ? c.sv : c.be, at: c.at, my: (c.sh || {})[name] || null, ns: Object.keys(c.sh || {}).length };
  return o;
}

/* ---------- Ưu đãi / thông điệp quảng cáo đang chạy: Marketing + Quản trị ghi, mọi người đọc (kv mkt_offers) */
async function offersAll(x) { return (await kvJson(x.db, 'mkt_offers', [])) || []; }
/** at = mốc thời gian (mặc định bây giờ): bài Zalo soạn trước 2–3 ngày lấy ưu đãi còn hạn tới ngày đăng */
export async function offersLive(x, at) {
  const t0 = startOfDay(at || Date.now()), L = (await offersAll(x)).filter(o => !o.until || dayMs(o.until) >= t0);
  try { const dd = await ddOffer(x, at); if (dd) L.unshift(dd); } catch (e) { console.error('ddOffer', e.message); } // 🎉 Ngày Đôi: tự có trong ưu đãi đang chạy đúng ngày (ngaydoi.js)
  return L;
}
export async function crmOffers(x, u, d) {
  const a = d.action;
  if (a === 'offers') { const L = await offersAll(x); try { const dd = await ddOffer(x); if (dd) L.unshift(dd); } catch (e) { } return { ok: true, list: L }; }
  if (u.level < 3 && u.role !== 'Marketing') return { ok: false, error: 'Chỉ Marketing và Quản trị sửa được ưu đãi.' };
  let L = await offersAll(x);
  if (a === 'offer_del') { L = L.filter(o => o.id !== d.id); await kvSet(x.db, 'mkt_offers', JSON.stringify(L)); return { ok: true, list: L }; }
  if (a === 'offer_save') {
    const title = String(d.title || '').trim().slice(0, 120); if (!title) return { ok: false, error: 'Chưa có tên ưu đãi.' };
    const until = DAY_RE.test(String(d.until || '')) ? d.until : '';
    const o = { id: d.id || randHex(4), title, prod: String(d.prod || '').trim().slice(0, 60), text: String(d.text || '').trim().slice(0, 800), msg: String(d.msg || '').trim().slice(0, 1000), until, by: u.name, at: Date.now() }; // msg: mẫu tin sale gửi khách ([Tên], [Sản phẩm], [Link])
    const i = L.findIndex(y => y.id === o.id); if (i >= 0) L[i] = o; else L.unshift(o);
    L = L.filter(y => !y.until || dayMs(y.until) >= Date.now() - 60 * DAY).slice(0, 40); // ưu đãi hết hạn quá 60 ngày thì bỏ
    await kvSet(x.db, 'mkt_offers', JSON.stringify(L)); return { ok: true, list: L };
  }
  return { ok: false, error: 'Không rõ thao tác: ' + a };
}
