// CRM: đăng nhập, dữ liệu, đơn hàng, khách, tiềm năng, cài đặt. Chuyển từ Apps Script sang, giữ nguyên cách làm việc & dữ liệu trả về cho giao diện.
import { normPhone, esc, fmt, startOfDay, fmtDate, dateOrBlank, slugName, isVoid, randHex, all, first, run, insertMany, allIn, kvGet, kvSet, kvDel, kvJson, DAY, CRM_URL } from './lib.js';
import { sendMail, telegram, telegramTo, tgUpdates, tgConf } from './google.js';

export const SUPER_ADMIN = 'thaisoniph@gmail.com'; // luôn có quyền Quản trị
const ROLES = { 'Quản trị': 3, 'Quản lý': 2, 'Nhân viên': 1 };
const BOT_USERNAME = 'thucduonglanh_donhang_bot';
const ASSIGN_MODES = { auto: 'Tự chia đều', manager: 'Quản lý giao tay', pool: 'Kho chung' };
const SESSION_DAYS = 30;
const TASK_LABEL = { callback: 'Gọi lại theo hẹn', d1: 'Hỏi nhận hàng', runout: 'Nhắc đặt lại', d14: 'Xin cảm nhận', d30: 'Giới thiệu sản phẩm', winback: 'Mời quay lại', old: 'Gọi khách cũ', other: 'Chăm sóc' };
export const ORDER_STATUS = ['Mới', 'Đã xác nhận', 'Đang giao', 'Đã giao', 'Huỷ', 'Hoàn', 'Đổi hàng'];
const OPEN_STATUS = ['Mới', 'Đã xác nhận', 'Đang giao'];
const CARE_RESULTS = ['Đã đặt lại', 'Hẹn gọi lại', 'Không nghe máy', 'Đã hỏi thăm', 'Không có nhu cầu'];
export const LEAD_STATUS = ['Mới hỏi', 'Đang tư vấn', 'Đã chốt', 'Không mua'];
const CA_LIST = ['Ngày', 'Tối/CN', 'Lễ'];
export const VIP_ORDERS = 3, VIP_SPENT = 2000000, AT_RISK_DAYS = 60;
const NOTE_MAX = 400; // nhật ký dài chỉ gửi phần đầu khi mở CRM; mở hồ sơ khách mới tải đủ (cust_orders)
export const LINES = [['Fucoidan Pro', /progomax|fucoidan pro|fu ?pro/i], ['Curcumin', /curcumin|nghệ/i], ['BADD', /bữa ăn|badd|bua an/i]];
export const DEFAULT_CYCLES = [
  ['DILVANG', '', 6, '15 gói, dùng 2–3 gói/ngày (theo nhãn)'], ['Bữa Ăn Dinh Dưỡng', '500g', 10, '20 gói, khoảng 2 gói/ngày'], ['Bữa Ăn Dinh Dưỡng', '125g', 3, '5 gói, khoảng 2 gói/ngày'],
  ['Curcumin', '400g', 7, '30g/lần, 2 lần/ngày'], ['Curcumin', '125g', 2, '30g/lần, 2 lần/ngày'], ['Ruốc', '215g', 10, 'Ước tính – chỉnh theo thực tế'], ['Ruốc', '165g', 8, 'Ước tính – chỉnh theo thực tế'],
  ['Xì Dầu', '', 30, 'Ước tính – chỉnh theo thực tế'], ['Progomax', '900g', 15, 'Ước tính 30g/lần, 2 lần/ngày – chỉnh theo thực tế'], ['Progomax', '400g', 7, 'Ước tính 30g/lần, 2 lần/ngày – chỉnh theo thực tế'],
  ['Gafo', '800g', 13, 'Ước tính 30g/lần, 2 lần/ngày – chỉnh theo thực tế'], ['Gafo', '500g', 8, 'Ước tính 30g/lần, 2 lần/ngày – chỉnh theo thực tế'], ['Curcumin', '900g', 15, 'Ước tính 30g/lần, 2 lần/ngày – chỉnh theo thực tế'],
  ['Vimy', '900g', 15, 'Ước tính 30g/lần, 2 lần/ngày – chỉnh theo thực tế'], ['Ngũ cốc', '900g', 15, 'Ước tính 30g/lần, 2 lần/ngày – chỉnh theo thực tế'], ['Ngũ cốc', '400g', 7, 'Ước tính 30g/lần, 2 lần/ngày – chỉnh theo thực tế']];
export const DEFAULT_TEMPLATES = [
  ['1 ngày sau khi đặt', 'Hỏi nhận hàng + hướng dẫn dùng', 'Dạ em chào [Tên] ạ, em là nhân viên Thực Dưỡng Lành. [Tên] đã nhận được [Sản phẩm] chưa ạ? Em gửi mình cách dùng để đạt hiệu quả tốt nhất: … Có gì chưa rõ [Tên] cứ nhắn em nhé ❤️'],
  ['Trước khi hết sản phẩm', 'Nhắc đặt lại', 'Dạ [Tên] ơi, theo lịch thì [Sản phẩm] của mình sắp hết rồi ạ. [Tên] có muốn em lên đơn tiếp để dùng không bị gián đoạn không ạ? Đơn từ 300.000đ được miễn phí vận chuyển ạ.'],
  ['14 ngày sau khi đặt', 'Xin cảm nhận', 'Dạ em chào [Tên], mình dùng [Sản phẩm] được 2 tuần rồi, [Tên] thấy thế nào ạ? Cảm nhận của [Tên] giúp Thực Dưỡng Lành làm tốt hơn mỗi ngày ạ 🙏'],
  ['30 ngày sau khi đặt', 'Giới thiệu sản phẩm phù hợp', 'Dạ [Tên] ơi, ngoài [Sản phẩm], Thực Dưỡng Lành còn … phù hợp để bữa ăn cân bằng hơn. Em gửi [Tên] tham khảo nhé: https://thucduonglanh.vn/san-pham/'],
  ['60 ngày chưa mua lại', 'Mời quay lại', 'Dạ lâu rồi em chưa được phục vụ [Tên] ạ. Tháng này Thực Dưỡng Lành có ưu đãi dành riêng cho khách cũ … [Tên] cần em tư vấn gì cứ nhắn em nhé ❤️'],
  ['Khách mới hỏi', 'Chào hỏi, tư vấn', 'Dạ em chào [Tên] ạ, em là nhân viên Thực Dưỡng Lành. Em thấy mình đang quan tâm đến [Sản phẩm]. [Tên] cho em hỏi mình mua dùng cho bản thân hay cho người nhà, và đang mong muốn cải thiện điều gì ạ? Em tư vấn để mình chọn đúng sản phẩm nhé ❤️']];

/* ================================================================ cài đặt chung (bảng kv) */
export async function rulesCfg(x) {
  if (x._rules) return x._rules;
  const r = await kvJson(x.db, 'rules_cfg', {}) || {};
  return (x._rules = { vipOrders: Number(r.vipOrders) || VIP_ORDERS, vipSpent: Number(r.vipSpent) || VIP_SPENT, atRisk: Number(r.atRisk) || AT_RISK_DAYS });
}
export async function caCfg(x) { if (!x._ca) x._ca = await kvJson(x.db, 'ca_cfg', {}) || {}; return x._ca; }
export async function assignMode(x) { if (!x._mode) x._mode = (await kvGet(x.db, 'assign_mode')) || 'pool'; return x._mode; }
export function groupOf(orders, spent, last, R) {
  if (last && (Date.now() - last) / DAY > R.atRisk) return 'Sắp mất';
  if (orders >= R.vipOrders || spent >= R.vipSpent) return 'VIP';
  if (orders >= 2) return 'Quay lại';
  return 'Mới';
}
/** Ca: Lễ (ngày lễ trong Cài đặt) / Tối-CN (sau giờ ca tối hoặc Chủ nhật) / Ngày. */
export function caOf(t, cfg) {
  const d = new Date(Number(t) + 7 * 3600e3), pad = n => (n < 10 ? '0' : '') + n;
  const dm = pad(d.getUTCDate()) + '/' + pad(d.getUTCMonth() + 1), ev = String(cfg.evening || '17:30').split(':');
  if ((cfg.holidays || ['01/01', '30/04', '01/05', '02/09']).indexOf(dm) >= 0) return 'Lễ';
  if (d.getUTCDay() === 0) return 'Tối/CN';
  if (d.getUTCHours() * 60 + d.getUTCMinutes() >= (+ev[0]) * 60 + (+ev[1] || 0)) return 'Tối/CN';
  return 'Ngày';
}
export function lineOf(text) { for (const l of LINES) if (l[1].test(String(text || ''))) return l[0]; return 'Khác'; }
export function normLine(v, fallbackText) { const t = String(v || '').trim(); if (!t) return lineOf(fallbackText); const l = lineOf(t); return l !== 'Khác' ? l : (/khác/i.test(t) || !lineOf(fallbackText) ? 'Khác' : lineOf(fallbackText)); }

/* ================================================================ nhân sự */
const no = v => /^(không|khong|no|0|false)$/i.test(String(v == null ? '' : v).trim());
export async function crmUsers(x) {
  if (x._users) return x._users;
  const rows = await all(x.db, 'SELECT * FROM users ORDER BY ord, rowid');
  const list = rows.map(r => {
    const e = String(r.email || '').trim().toLowerCase(), role = ROLES[r.role] ? r.role : 'Nhân viên';
    return { email: e, name: String(r.name || e.split('@')[0]).trim(), role, active: !!r.active, recv: String(r.recv || '').trim() === '' ? role === 'Nhân viên' : !no(r.recv), tg: String(r.tg || '').trim(), alias: String(r.alias || '').trim(), prefix: String(r.prefix || '').trim() };
  }).filter(u => /@/.test(u.email));
  const sa = list.find(u => u.email === SUPER_ADMIN);
  if (!sa) list.unshift({ email: SUPER_ADMIN, name: 'Thái Sơn', role: 'Quản trị', active: true, recv: false, tg: '', alias: '', prefix: '' });
  else { sa.role = 'Quản trị'; sa.active = true; }
  list.forEach(u => { u.level = ROLES[u.role]; });
  return (x._users = list);
}
async function crmUser(x, email) { email = String(email || '').trim().toLowerCase(); return (await crmUsers(x)).find(u => u.email === email && u.active) || null; }
function publicUser(u) { return { email: u.email, name: u.name, role: u.role, level: u.level, tg: !!u.tg, prefix: u.prefix || slugName(u.name) }; }
async function userSet(x, email, field, value) {
  const r = await run(x.db, `UPDATE users SET ${field} = ? WHERE email = ?`, value, email);
  if (!r.meta.changes && email === SUPER_ADMIN) { await run(x.db, "INSERT INTO users (email, name, role, active, recv, ord) VALUES (?, 'Thái Sơn', 'Quản trị', 1, 'Không', -1)", SUPER_ADMIN); await run(x.db, `UPDATE users SET ${field} = ? WHERE email = ?`, value, email); }
  x._users = null;
}

/* ================================================================ nhật ký */
export async function crmLog(x, u, what, ref, name, result, note) {
  await run(x.db, 'INSERT INTO logs (time, by_name, what, ref, name, result, note) VALUES (?, ?, ?, ?, ?, ?, ?)', Date.now(), u.name || '', what, String(ref == null ? '' : ref), name || '', result || '', note || '');
}

/* ================================================================ khách hàng: tính lại từ đơn hàng */
export async function cyclesList(x) {
  if (!x._cycles) x._cycles = (await all(x.db, 'SELECT name, variant, days, basis FROM cycles ORDER BY rid')).filter(r => r.name && r.days).map(r => [String(r.name), String(r.variant || ''), Number(r.days) || 0, String(r.basis || '')]);
  return x._cycles;
}
function usageDays(cycles, name, variant) {
  const full = (String(name) + ' ' + String(variant || '')).toLowerCase();
  for (const r of cycles) if (full.indexOf(String(r[0]).toLowerCase()) >= 0 && (!r[1] || full.indexOf(String(r[1]).toLowerCase()) >= 0)) return Number(r[2]) || 0;
  return 0;
}
/** Ngày dự kiến hết hàng = ngày đặt + (số ngày dùng × số lượng) của món hết sớm nhất trong đơn. */
function runOutDate(cycles, items, t) { let best = 0; (items || []).forEach(i => { const d = usageDays(cycles, i.name, i.variant) * (Number(i.qty) || 1); if (d && (!best || d < best)) best = d; }); return best ? t + best * DAY : null; }
/** Đọc dòng sản phẩm đã lưu: "Tên (quy cách) x2 = 280.000 ₫". Bỏ dòng quà tặng (🎁). */
export function parseItemLines(text) { return String(text || '').split('\n').map(l => { if (/^🎁/.test(l)) return null; const m = l.match(/^(.*?)(?: \((.*?)\))? x(\d+) =/); return m ? { name: m[1], variant: m[2] || '', qty: +m[3] } : null; }).filter(Boolean); }

const CUS_COLS = ['phone', 'name', 'address', 'province', 'ward', 'orders', 'spent', 'first', 'last', 'products', 'runout', 'consent', 'source', 'owner', 'last_status', 'last_ca', 'last_seller'];
/**
 * Tính lại khách của các số điện thoại (từ toàn bộ đơn, bỏ đơn Huỷ / Hoàn). Giữ nguyên các cột nhân viên điền (ghi chú, hẹn, nhãn…).
 * opt.owners = {sđt: tên} gán người phụ trách cho khách chưa có; opt.sellerOwner = tên sale: khách chưa ai phụ trách mà đơn gần nhất do sale này bán → giao cho sale.
 */
export async function recalc(x, phones, opt) {
  opt = opt || {};
  const list = [...new Set((phones || []).map(normPhone).filter(Boolean))]; if (!list.length) return 0;
  const cycles = await cyclesList(x); let n = 0;
  for (let i = 0; i < list.length; i += 400) {
    const part = list.slice(i, i + 400);
    const rows = await all(x.db, 'SELECT phone, time, status, items, total, consent, first_source, source, seller, name, address, province, ward, ca FROM orders WHERE phone IN (SELECT value FROM json_each(?)) ORDER BY time, rid', JSON.stringify(part));
    const map = {};
    for (const r of rows) {
      const c = map[r.phone] || (map[r.phone] = { orders: 0, spent: 0, first: null, last: null, bought: [], run: null, consent: 0, src: '', lastT: -1, lastStatus: '', lastCa: '', seller: '' });
      if ((r.time || 0) >= c.lastT) { c.lastT = r.time || 0; c.lastStatus = r.status || ''; if (!isVoid(r.status)) c.lastCa = r.ca || ''; }
      if (isVoid(r.status) || !r.time) continue;
      if (!c.orders) { c.first = r.time; c.src = String(r.first_source || r.source || ''); }
      c.orders++; c.spent += Number(r.total) || 0; c.last = r.time; if (r.seller) c.seller = r.seller;
      ['name', 'address', 'province', 'ward'].forEach(h => { if (r[h] !== '' && r[h] != null) c[h] = r[h]; });
      const items = parseItemLines(r.items);
      items.forEach(it => { const nm = it.name + (it.variant ? ' (' + it.variant + ')' : ''); if (c.bought.indexOf(nm) < 0) c.bought.push(nm); });
      const ro = runOutDate(cycles, items, r.time); if (ro) c.run = ro;
      if (r.consent) c.consent = 1;
    }
    const up = [], zero = [];
    for (const ph of part) {
      const c = map[ph];
      if (!c || !c.orders) { zero.push({ phone: ph, last_status: c ? c.lastStatus : '', last_ca: c ? c.lastCa : '' }); continue; }
      let owner = (opt.owners && opt.owners[ph]) || '';
      if (!owner && opt.sellerOwner && c.seller === opt.sellerOwner) owner = opt.sellerOwner;
      up.push({ phone: ph, name: c.name || '', address: c.address || '', province: c.province || '', ward: c.ward || '', orders: c.orders, spent: c.spent, first: c.first, last: c.last, products: c.bought.join('; '), runout: c.run, consent: c.consent, source: c.src, owner, last_status: c.lastStatus, last_ca: c.lastCa, last_seller: c.seller });
    }
    await insertMany(x.db, 'customers', CUS_COLS, up, `ON CONFLICT(phone) DO UPDATE SET name = excluded.name, address = excluded.address, province = excluded.province, ward = excluded.ward, orders = excluded.orders, spent = excluded.spent,
      first = excluded.first, last = excluded.last, products = excluded.products, runout = excluded.runout, consent = excluded.consent, source = excluded.source, last_status = excluded.last_status, last_ca = excluded.last_ca, last_seller = excluded.last_seller,
      owner = CASE WHEN customers.owner IS NULL OR customers.owner = '' THEN excluded.owner ELSE customers.owner END`);
    if (zero.length) await run(x.db, "UPDATE customers SET orders = 0, spent = 0, products = '', runout = NULL, last_status = json_extract(j.value, '$.last_status'), last_ca = json_extract(j.value, '$.last_ca') FROM json_each(?) j WHERE customers.phone = json_extract(j.value, '$.phone')", JSON.stringify(zero));
    n += up.length;
  }
  return n;
}
/** Tính lại toàn bộ khách (đổi chu kỳ dùng, chuyển dữ liệu). */
export async function recalcAll(x, opt) {
  const phones = (await all(x.db, "SELECT DISTINCT phone FROM orders WHERE phone != ''")).map(r => r.phone);
  return recalc(x, phones, opt);
}
export async function setCallbacks(x, cb) {
  const list = Object.keys(cb).map(p => ({ p, t: cb[p] })); if (!list.length) return;
  for (let i = 0; i < list.length; i += 500) await run(x.db, "UPDATE customers SET callback = json_extract(j.value, '$.t') FROM json_each(?) j WHERE customers.phone = json_extract(j.value, '$.p') AND customers.callback IS NULL", JSON.stringify(list.slice(i, i + 500)));
}

/* ================================================================ việc chăm sóc hôm nay */
const CARE_STEPS = [{ key: 'd1', at: 1, win: 2 }, { key: 'runout' }, { key: 'd14', at: 14, win: 3 }, { key: 'd30', at: 30, win: 3 }, { key: 'winback', at: AT_RISK_DAYS, win: 7 }];
export function careTask(c, today, R) {
  const last = c.last ? startOfDay(c.last) : null; if (last == null) return null;
  const days = Math.round((today - last) / DAY);
  const runD = c.runout ? startOfDay(c.runout) : null, care = c.care_at ? startOfDay(c.care_at) : null;
  const toRun = runD != null ? Math.round((runD - today) / DAY) : null;
  const cb = c.callback ? startOfDay(c.callback) : null;
  if (cb != null && cb <= today) return { type: 'callback', days, late: Math.round((today - cb) / DAY), toRun };
  for (const s of CARE_STEPS) {
    if (s.key === 'runout') { if (toRun !== null && toRun >= -7 && toRun <= 2 && days >= 2 && !(care != null && care >= runD - 3 * DAY)) return { type: 'runout', days, late: toRun < 0 ? -toRun : 0, toRun }; }
    else { const at = s.key === 'winback' ? R.atRisk : s.at; if (days >= at && days <= at + s.win && !(care != null && care >= last + at * DAY)) return { type: s.key, days, late: 0, toRun }; }
  }
  return null;
}
export function leadDue(l, today) {
  if (l.status !== 'Mới hỏi' && l.status !== 'Đang tư vấn') return false;
  if (l.callback) return l.callback <= today + DAY - 1;
  return !l.lastAt || l.lastAt < today - 2 * DAY;
}

/* ================================================================ đọc dữ liệu cho giao diện */
const leadOut = r => ({ id: r.id, time: r.time, name: r.name || '', phone: r.phone || '', channel: r.channel || '', interest: r.interest || '', status: r.status || 'Mới hỏi', owner: r.owner || '', lastAt: r.last_at, callback: r.callback, reason: r.reason || '', note: r.note || '', orderId: r.order_id || '', by: r.by_name || '' });
const orderOut = r => ({ row: r.rid, time: r.time, id: r.id, name: r.name || '', phone: r.phone || '', email: r.email || '', province: r.province || '', ward: r.ward || '', address: r.address || '', items: r.items || '', subtotal: r.subtotal || 0,
  shipping: r.shipping || 0, total: r.total || 0, payment: r.payment || '', note: r.note || '', status: r.status || 'Mới', source: r.source || '', consent: !!r.consent, paid: r.paid || '', carrier: r.carrier || '', tracking: r.tracking || '', seller: r.seller || '', ca: r.ca || '', line: r.line || '', ship: r.ship || '' });
export async function leadsData(x, where, ...args) { return (await all(x.db, 'SELECT * FROM leads' + (where ? ' WHERE ' + where : '') + ' ORDER BY rid DESC LIMIT 3000', ...args)).reverse().map(leadOut); }

async function prefsOf(x, email) { return await kvJson(x.db, 'prefs_' + email, {}) || {}; }
async function allTagColors(x) {
  const m = {};
  for (const r of await all(x.db, "SELECT v FROM kv WHERE k LIKE 'prefs\\_%' ESCAPE '\\'")) { try { (JSON.parse(r.v).tags || []).forEach(t => { if (!m[t.name]) m[t.name] = t.color; }); } catch (e) { } }
  return m;
}
export async function srcList(x) {
  return (await all(x.db, 'SELECT * FROM sources ORDER BY rid')).map(r => { let cfg = {}; try { cfg = JSON.parse(r.cfg || '{}'); } catch (e) { } return { id: r.id, sale: r.sale || '', url: r.url || '', fileName: r.file_name || '', cfg, last: r.last, result: r.result || '', row: r.rid }; });
}
export async function adsCfg(x) { return kvJson(x.db, 'ads_cfg', null); }

async function crmLoad(x, u) {
  const today = startOfDay(Date.now()), R = await rulesCfg(x), mode = await assignMode(x), staff = u.level < 2;
  const see = "(owner = ?1 OR (?2 = 'pool' AND (owner = '' OR owner IS NULL)))";
  const cusSql = `SELECT phone, name, address, province, ward, orders, spent, first, last, products, runout, consent, source, owner, care_at, care_result, substr(note, 1, ${NOTE_MAX}) AS note, length(note) > ${NOTE_MAX} AS cut, callback, flag, tag, last_status, last_ca FROM customers WHERE (orders > 0 OR flag != '')` + (staff ? ' AND ' + see : '');
  const from = Date.now() - 400 * DAY, open = "status IN ('Mới', 'Đã xác nhận', 'Đang giao')";
  const ordSql = `SELECT * FROM orders WHERE (time >= ?3 OR ${open})` + (staff ? ` AND (seller = ?1 OR phone IN (SELECT phone FROM customers WHERE ${see}))` : '') + ' ORDER BY time DESC, rid DESC LIMIT 6000';
  const leadSql = 'SELECT * FROM leads' + (staff ? ' WHERE ' + see : '') + ' ORDER BY rid DESC LIMIT 3000';
  const logSql = 'SELECT time, by_name, what, ref, name, result, note FROM logs' + (staff ? ` WHERE by_name = ?1 OR ref IN (SELECT phone FROM customers WHERE ${see}) OR ref IN (SELECT phone FROM leads WHERE ${see}) OR ref IN (SELECT id FROM orders WHERE seller = ?1 OR phone IN (SELECT phone FROM customers WHERE ${see}))` : '') + ' ORDER BY rid DESC LIMIT 6000';
  const b = (sql, ...a) => x.db.prepare(sql).bind(...a);
  const res = await x.db.batch([
    staff ? b(cusSql, u.name, mode) : b(cusSql),
    staff ? b(ordSql, u.name, mode, from) : b(ordSql.replace('?3', '?1'), from),
    staff ? b(leadSql, u.name, mode) : b(leadSql),
    staff ? b(logSql, u.name, mode) : b(logSql),
    b('SELECT * FROM contacts ORDER BY rid DESC LIMIT 1000'),
    b('SELECT * FROM targets' + (staff ? ' WHERE name = ?' : ''), ...(staff ? [u.name] : [])),
    b('SELECT name, variant, days, basis FROM cycles ORDER BY rid'),
    b('SELECT when_txt, purpose, text FROM templates ORDER BY rid')
  ]);
  const [cs, os, ls, lg, ct, tg, cy, tp] = res.map(r => r.results || []);
  const customers = cs.map(v => ({
    phone: v.phone, name: v.name || '', address: v.address || '', province: v.province || '', ward: v.ward || '', orders: v.orders || 0, spent: v.spent || 0, first: v.first, last: v.last,
    products: String(v.products || '').split('; ').filter(String), runout: v.runout, group: groupOf(v.orders || 0, v.spent || 0, v.last, R), consent: !!v.consent, source: v.source || '', owner: v.owner || '',
    careAt: v.care_at, careResult: v.care_result || '', note: v.note || '', noteCut: !!v.cut, callback: v.callback, flag: v.flag || '', tag: v.tag || '', task: careTask(v, today, R), lastStatus: v.last_status || '', lastCa: v.last_ca || ''
  }));
  const users = (await crmUsers(x)).filter(y => y.active || u.level >= 3).map(y => u.level >= 3 ? { email: y.email, name: y.name, role: y.role, active: y.active, recv: y.recv, tg: !!y.tg, alias: y.alias, prefix: y.prefix || slugName(y.name) } : u.level >= 2 ? { name: y.name, role: y.role, recv: y.recv, tg: !!y.tg } : { name: y.name, role: y.role });
  const ca = await caCfg(x);
  return {
    ok: true, user: publicUser(u), now: Date.now(), today, customers, orders: os.reverse().map(orderOut),
    contacts: staff ? [] : ct.reverse().map(r => ({ row: r.rid, time: r.time, name: r.name || '', phone: r.phone || '', email: r.email || '', message: r.message || '', page: r.page || '', done: !!r.done, note: r.note || '' })),
    leads: ls.reverse().map(leadOut), targets: tg.map(t => ({ month: t.month, name: t.name, amount: t.amount || 0, by: t.by_name || '', at: t.at })),
    cycles: cy.filter(r => r.name).map(r => [r.name, r.variant || '', Number(r.days) || 0, r.basis || '']), templates: tp.filter(r => r.text).map(r => [r.when_txt || '', r.purpose || '', r.text]),
    log: lg.reverse().map(l => ({ time: l.time, by: l.by_name || '', what: l.what || '', ref: l.ref || '', name: l.name || '', result: l.result || '', note: l.note || '' })), users,
    prefs: await prefsOf(x, u.email), tagColors: await allTagColors(x),
    rules: { vipOrders: R.vipOrders, vipSpent: R.vipSpent, atRisk: R.atRisk, statuses: ORDER_STATUS, results: CARE_RESULTS, leadStatus: LEAD_STATUS, assignMode: mode, bot: BOT_USERNAME, ca, lines: LINES.map(l => l[0]).concat(['Khác']) },
    sources: u.level >= 3 ? await srcList(x) : [], ads: u.level >= 3 ? await adsCfg(x) : null
  };
}
/** Toàn bộ đơn của 1 khách (kể cả đơn cũ) + ghi chú đầy đủ. */
async function crmCustOrders(x, u, d) {
  const phone = normPhone(d.phone);
  if (u.level < 2 && await ownerOf(x, phone) !== u.name) return { ok: false, error: 'Khách này không do bạn phụ trách.' };
  const os = await all(x.db, 'SELECT * FROM orders WHERE phone = ? ORDER BY time, rid', phone);
  const c = await first(x.db, 'SELECT note FROM customers WHERE phone = ?', phone);
  return { ok: true, orders: os.map(orderOut), note: c ? c.note || '' : '' };
}

/* ================================================================ chia khách & phạm vi dữ liệu */
export async function ownerOf(x, phone) { const r = await first(x.db, 'SELECT owner FROM customers WHERE phone = ?', normPhone(phone)); return r ? r.owner || '' : ''; }
async function setOwner(x, phone, name) { const r = await run(x.db, 'UPDATE customers SET owner = ? WHERE phone = ?', name, normPhone(phone)); return r.meta.changes > 0; }
export async function nextAssignee(x) {
  const names = (await crmUsers(x)).filter(u => u.active && u.recv).map(u => u.name); if (!names.length) return '';
  const last = x._rr !== undefined ? x._rr : (await kvGet(x.db, 'rr_last')) || '';
  const n = names[(names.indexOf(last) + 1) % names.length]; x._rr = n; await kvSet(x.db, 'rr_last', n); return n;
}
export async function autoOwner(x) { return (await assignMode(x)) === 'auto' ? nextAssignee(x) : ''; }
/** Nhân viên chỉ được làm việc với khách mình phụ trách. Chế độ Kho chung: khách chưa ai phụ trách → người thao tác nhận luôn. */
async function guardPhone(x, u, phone) {
  if (u.level >= 2) return '';
  phone = normPhone(phone);
  const c = await first(x.db, 'SELECT owner, name FROM customers WHERE phone = ?', phone); if (!c) return '';
  const owner = c.owner || '';
  if (owner === u.name) return '';
  if (!owner && await assignMode(x) === 'pool') { await setOwner(x, phone, u.name); await crmLog(x, u, 'Nhận khách', phone, c.name, 'Kho chung', ''); return ''; }
  return owner ? 'Khách này do ' + owner + ' phụ trách. Cần đổi người phụ trách thì nhờ quản lý chuyển.' : 'Khách này chưa được giao cho bạn. Nhờ quản lý giao.';
}
async function guardLead(x, u, ld) {
  if (u.level >= 2) return '';
  const owner = ld.owner || '';
  if (owner === u.name) return '';
  if (!owner && await assignMode(x) === 'pool') { await leadUpdate(x, ld.id, { owner: u.name }); ld.owner = u.name; await crmLog(x, u, 'Nhận khách', ld.phone, ld.name, 'Kho chung – tiềm năng', ''); return ''; }
  return owner ? 'Khách này do ' + owner + ' phụ trách. Nhờ quản lý chuyển nếu cần.' : 'Khách này chưa được giao cho bạn. Nhờ quản lý giao.';
}
/** Số điện thoại này của ai? Nhân viên chỉ biết tên người phụ trách, không thấy thông tin khách. */
async function crmCheckPhone(x, u, d) {
  const phone = normPhone(d.phone); if (!/^0\d{9,10}$/.test(phone)) return { ok: true, status: 'none' };
  const c = await first(x.db, 'SELECT owner FROM customers WHERE phone = ?', phone);
  if (!c) {
    const ol = await first(x.db, "SELECT owner FROM leads WHERE phone = ? AND status IN ('Mới hỏi', 'Đang tư vấn') ORDER BY rid LIMIT 1", phone);
    if (ol) return { ok: true, status: ol.owner === u.name ? 'mine' : ol.owner ? 'other' : 'free', owner: ol.owner || '', lead: true };
    return { ok: true, status: 'none' };
  }
  const owner = c.owner || '';
  return { ok: true, status: owner === u.name ? 'mine' : owner ? 'other' : 'free', owner };
}
async function crmAssign(x, u, d) {
  const to = String(d.to || ''); let n = 0, ln = 0;
  for (const ph of d.phones || []) if (await setOwner(x, ph, to)) n++;
  for (const id of d.leadIds || []) if (await leadUpdate(x, id, { owner: to })) ln++;
  if (d.withLeads && (d.phones || []).length) { const r = await run(x.db, "UPDATE leads SET owner = ? WHERE status IN ('Mới hỏi', 'Đang tư vấn') AND phone IN (SELECT value FROM json_each(?))", to, JSON.stringify((d.phones || []).map(normPhone))); ln += r.meta.changes; }
  await crmLog(x, u, 'Giao khách', '-', to || 'bỏ phụ trách', n + ' khách, ' + ln + ' tiềm năng', '');
  return { ok: true, customers: n, leads: ln };
}
async function crmBulk(x, u, d) {
  const names = (await crmUsers(x)).filter(y => y.active && y.recv).map(y => y.name);
  if (d.spread && !names.length) return { ok: false, error: 'Chưa có ai bật "Nhận khách mới".' };
  if (!d.spread && (!d.from || !d.to || d.from === d.to)) return { ok: false, error: 'Chọn người chuyển đi và người nhận.' };
  let n = 0, ln = 0;
  if (d.spread) {
    const cs = await all(x.db, "SELECT phone FROM customers WHERE (owner = '' OR owner IS NULL) AND (orders > 0 OR flag != '')");
    const ls = await all(x.db, "SELECT id FROM leads WHERE (owner = '' OR owner IS NULL) AND status IN ('Mới hỏi', 'Đang tư vấn')");
    let last = (await kvGet(x.db, 'rr_last')) || '', i = names.indexOf(last);
    const pick = () => { i = (i + 1) % names.length; return names[i]; };
    const ca = cs.map(r => ({ k: r.phone, o: pick() })), la = ls.map(r => ({ k: r.id, o: pick() }));
    for (let k = 0; k < ca.length; k += 500) await run(x.db, "UPDATE customers SET owner = json_extract(j.value, '$.o') FROM json_each(?) j WHERE customers.phone = json_extract(j.value, '$.k')", JSON.stringify(ca.slice(k, k + 500)));
    for (let k = 0; k < la.length; k += 500) await run(x.db, "UPDATE leads SET owner = json_extract(j.value, '$.o') FROM json_each(?) j WHERE leads.id = json_extract(j.value, '$.k')", JSON.stringify(la.slice(k, k + 500)));
    if (i >= 0) await kvSet(x.db, 'rr_last', names[i]);
    n = ca.length; ln = la.length;
  } else {
    n = (await run(x.db, 'UPDATE customers SET owner = ? WHERE owner = ?', d.to, d.from)).meta.changes;
    ln = (await run(x.db, "UPDATE leads SET owner = ? WHERE owner = ? AND status IN ('Mới hỏi', 'Đang tư vấn')", d.to, d.from)).meta.changes;
  }
  await crmLog(x, u, 'Giao khách', '-', d.spread ? 'Chia đều khách chưa ai phụ trách' : d.from + ' → ' + d.to, n + ' khách, ' + ln + ' tiềm năng', '');
  return { ok: true, customers: n, leads: ln };
}
async function crmRecv(x, u, d) {
  const y = (await crmUsers(x)).find(z => z.name === d.name); if (!y) return { ok: false, error: 'Không tìm thấy ' + d.name };
  await userSet(x, y.email, 'recv', d.on ? 'Có' : 'Không'); await crmLog(x, u, 'Nhân sự', '-', y.name, 'Nhận khách mới: ' + (d.on ? 'Có' : 'Không'), '');
  return { ok: true };
}
async function crmClaim(x, u, d) {
  if (await assignMode(x) !== 'pool' && u.level < 2) return { ok: false, error: 'Đang không ở chế độ Kho chung.' };
  if (d.leadId) { const ld = await leadGet(x, d.leadId); if (!ld) return { ok: false, error: 'Không tìm thấy khách.' }; if (ld.owner && ld.owner !== u.name) return { ok: false, error: 'Khách này vừa được ' + ld.owner + ' nhận.' }; await leadUpdate(x, d.leadId, { owner: u.name }); }
  if (d.phone) { const o = await ownerOf(x, d.phone); if (o && o !== u.name) return { ok: false, error: 'Khách này vừa được ' + o + ' nhận.' }; await setOwner(x, d.phone, u.name); }
  await crmLog(x, u, 'Nhận khách', normPhone(d.phone || ''), '', 'Kho chung', '');
  return { ok: true };
}

/* ================================================================ màu phân loại khách */
async function crmPrefs(x, u, d) {
  const clean = c => /^#[0-9a-fA-F]{6}$/.test(String(c)) ? c : '', colors = {};
  Object.keys(d.colors || {}).forEach(k => { if (/^(new|old|void|off|vip)$/.test(k) && clean(d.colors[k])) colors[k] = d.colors[k]; });
  const seen = {}, tags = (d.tags || []).map(t => ({ name: String(t.name || '').trim().slice(0, 30), color: clean(t.color) || '#dbeafe' })).filter(t => { if (!t.name || seen[t.name]) return false; seen[t.name] = 1; return true; }).slice(0, 20);
  await kvSet(x.db, 'prefs_' + u.email, JSON.stringify({ colors, tags }));
  return { ok: true, prefs: { colors, tags } };
}

/* ================================================================ Telegram riêng */
async function crmTgLink(x, u) {
  const code = randHex(5); await kvSet(x.db, 'tg_' + code, u.email, 3600e3);
  return { ok: true, code, url: 'https://t.me/' + BOT_USERNAME + '?start=' + code };
}
async function crmTgCheck(x, u, d) {
  const code = String(d.code || '').replace(/[^a-f0-9]/g, '');
  if (await kvGet(x.db, 'tg_' + code) !== u.email) return { ok: false, error: 'Mã kết nối đã hết hạn, bấm "Kết nối Telegram" lại nhé.' };
  const j = await tgUpdates(x.env); let chat = null;
  (j.result || []).forEach(up => { const m = up.message; if (m && m.chat && m.chat.type === 'private' && String(m.text || '').trim() === '/start ' + code) chat = m.chat.id; });
  if (!chat) return { ok: false, error: j.ok === false ? 'Telegram báo lỗi: ' + (j.description || '') : 'Chưa thấy bạn bấm "Start" trong Telegram. Mở lại link, bấm Start (Bắt đầu) rồi thử lại.' };
  await userSet(x, u.email, 'tg', String(chat));
  await telegramTo(x.env, chat, '✅ Đã kết nối CRM Thực Dưỡng Lành cho <b>' + esc(u.name) + '</b>.\nTừ giờ bạn nhận riêng: đơn mới của khách mình phụ trách, khách tiềm năng mới được giao, và danh sách việc lúc 8h sáng.');
  await kvDel(x.db, 'tg_' + code);
  await crmLog(x, u, 'Nhân sự', '-', u.name, 'Kết nối Telegram', '');
  return { ok: true };
}
export async function telegramUser(x, name, text) { const y = (await crmUsers(x)).find(z => z.name === name && z.active); if (y && y.tg) await telegramTo(x.env, y.tg, text); }

/* ================================================================ đăng nhập */
async function crmLogin(x, d) {
  const email = String(d.email || '').trim().toLowerCase();
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) return { ok: false, error: 'Email chưa đúng.' };
  if (!await crmUser(x, email)) return { ok: false, error: 'Email này chưa được cấp quyền vào CRM. Nhờ anh Sơn hoặc quản lý thêm email của bạn.' };
  const rk = 'rl_' + email, n = Number(await kvGet(x.db, rk) || 0);
  if (n >= 5) return { ok: false, error: 'Bạn đã xin mã quá nhiều lần. Vui lòng đợi 15 phút rồi thử lại.' };
  await kvSet(x.db, rk, String(n + 1), 900e3);
  const b = new Uint32Array(1); crypto.getRandomValues(b); const code = String(b[0] % 900000 + 100000);
  await kvSet(x.db, 'otp_' + email, JSON.stringify({ c: code, t: 0 }), 600e3);
  x.later(sendMail(x.env, { to: email, name: 'CRM Thực Dưỡng Lành', subject: code + ' là mã đăng nhập CRM Thực Dưỡng Lành',
    body: 'Mã đăng nhập của bạn: ' + code + '\n\nMã dùng được trong 10 phút. Không đưa mã này cho người khác.\nNếu bạn không yêu cầu đăng nhập, hãy bỏ qua email này.\n\n' + CRM_URL }).catch(e => console.error('mail', e.message))); // gửi nền: trả lời ngay, email tới sau vài giây
  return { ok: true };
}
async function crmVerify(x, d) {
  const email = String(d.email || '').trim().toLowerCase(), code = String(d.code || '').replace(/\D/g, ''), key = 'otp_' + email;
  const raw = await kvGet(x.db, key); if (!raw) return { ok: false, error: 'Mã đã hết hạn. Bấm "Gửi lại mã".' };
  const o = JSON.parse(raw);
  if (o.c !== code) {
    o.t++;
    if (o.t >= 5) { await kvDel(x.db, key); return { ok: false, error: 'Nhập sai quá 5 lần. Bấm "Gửi lại mã" để lấy mã mới.' }; }
    await run(x.db, 'UPDATE kv SET v = ? WHERE k = ?', JSON.stringify(o), key);
    return { ok: false, error: 'Mã chưa đúng, bạn kiểm tra lại email nhé.' };
  }
  await kvDel(x.db, key);
  const u = await crmUser(x, email); if (!u) return { ok: false, error: 'Tài khoản đã bị khoá.' };
  await run(x.db, 'DELETE FROM sessions WHERE exp < ?', Date.now());
  const token = randHex(32);
  await run(x.db, 'INSERT INTO sessions (token, email, exp) VALUES (?, ?, ?)', token, email, Date.now() + SESSION_DAYS * DAY);
  return { ok: true, token, user: publicUser(u) };
}
async function crmSession(x, token) {
  if (!/^[a-f0-9]{64}$/.test(String(token || ''))) return null;
  const s = await first(x.db, 'SELECT email, exp FROM sessions WHERE token = ?', token); if (!s) return null;
  if (s.exp < Date.now()) { await run(x.db, 'DELETE FROM sessions WHERE token = ?', token); return null; }
  const u = await crmUser(x, s.email); if (!u) { await run(x.db, 'DELETE FROM sessions WHERE token = ?', token); return null; }
  return u;
}

/* ================================================================ đơn hàng */
export function itemsText(items) { return items.map(i => (i.gift ? '🎁 ' : '') + i.name + (i.variant ? ' (' + i.variant + ')' : '') + ' x' + i.qty + ' = ' + fmt(i.gift ? 0 : i.subtotal)).join('\n'); }
/** Câu "lên đơn" gửi vận chuyển: "4 Fucoidan Progomax 900g, 1 Bữa ăn dinh dưỡng (quà)". */
export function shipText(items) { return (items || []).map(i => (Number(i.qty) || 1) + ' ' + i.name + (i.variant ? ' ' + i.variant : '') + (i.gift ? ' (quà)' : '')).join(', '); }
function cleanItems(list) {
  return (list || []).filter(i => i && i.name && Number(i.qty) > 0).map(i => {
    const q = Math.round(Number(i.qty)), p = Math.round(Number(i.price) || 0);
    return { name: String(i.name).replace(/\s+x\d+\s*=.*$/, '').trim(), variant: String(i.variant || '').trim(), qty: q, price: p, subtotal: p * q };
  });
}
/** Sale linh động giá: nếu nhập "Tổng tiền thu khách" thì chia lại tiền cho các dòng theo tỉ lệ giá. Trả về tạm tính. */
function applyTotal(items, total, ship) {
  const sub = items.reduce((s, i) => s + i.subtotal, 0), want = Math.round(Number(total) || 0) - ship;
  if (!(want > 0) || want === sub) return sub;
  let left = want;
  items.forEach((i, k) => { const v = k === items.length - 1 ? left : sub ? Math.round(i.subtotal * want / sub) : Math.round(want / items.length); i.subtotal = v; i.price = i.qty ? Math.round(v / i.qty) : v; left -= v; });
  return want;
}
const ORDER_COLS = ['id', 'time', 'name', 'phone', 'email', 'province', 'ward', 'address', 'items', 'subtotal', 'shipping', 'total', 'payment', 'note', 'status', 'source', 'first_source', 'consent', 'paid', 'carrier', 'tracking', 'seller', 'ca', 'line', 'ship'];
export { ORDER_COLS };

/** Ghi 1 đơn (web hoặc nhập tay), tính lại khách, báo email/Telegram. opt.by = tên nhân viên nhập tay. */
export async function saveOrder(x, data, opt) {
  const c = data.customer || {}, now = Date.now(), manual = !!opt.by, phone = normPhone(c.phone);
  if (!manual && data.id && await first(x.db, 'SELECT rid FROM orders WHERE id = ?', String(data.id))) return { dup: true }; // web gửi lại khi mạng chập chờn
  const items = itemsText(data.items || []), pay = data.payment === 'bank' ? 'Chuyển khoản' : 'COD', realItems = (data.items || []).filter(i => !i.gift);
  const ca = opt.ca || caOf(now, await caCfg(x)), line = opt.line || lineOf(realItems.map(i => i.name + ' ' + (i.variant || '')).join(' ')), ship = opt.shipText || shipText(data.items || []);
  let owner = await ownerOf(x, phone), assigned = '';
  if (!owner && !opt.by) owner = assigned = await autoOwner(x); // khách chưa ai phụ trách + chế độ "Tự chia đều"
  const seller = opt.by || owner;
  await insertMany(x.db, 'orders', ORDER_COLS, [{ id: String(data.id || ''), time: now, name: c.name || '', phone, email: c.email || '', province: c.province || '', ward: c.district || '', address: c.address || '', items,
    subtotal: Number(data.subtotal) || 0, shipping: Number(data.shipping) || 0, total: Number(data.total) || 0, payment: pay, note: c.note || '', status: opt.status || 'Mới', source: data.source || '', first_source: data.first_source || '',
    consent: data.marketing_consent ? 1 : 0, paid: '', carrier: '', tracking: '', seller: seller || '', ca, line, ship }]);
  await recalc(x, [phone], assigned ? { owners: { [phone]: assigned } } : {});
  const notify = async () => {
    const tg = await tgConf(x.env);
    if (!manual && tg.notify) await sendMail(x.env, { to: tg.notify, subject: '🛒 Đơn hàng mới ' + data.id + ' – ' + c.name + ' – ' + fmt(data.total),
      body: 'Mã đơn: ' + data.id + '\nKhách: ' + c.name + ' – ' + c.phone + (c.email ? ' – ' + c.email : '') + '\nĐịa chỉ: ' + c.address + ', ' + c.district + ', ' + c.province + '\n\n' + items +
        '\n\nTạm tính: ' + fmt(data.subtotal) + '\nPhí ship: ' + fmt(data.shipping) + '\nTổng: ' + fmt(data.total) + '\nThanh toán: ' + pay + (c.note ? '\nGhi chú: ' + c.note : '') + '\nNguồn: ' + (data.source || '') + '\n\nXem đơn: ' + CRM_URL + '/#don-hang' }).catch(() => {});
    const omsg = (manual ? '📝 <b>ĐƠN NHẬP TAY ' + esc(data.id) + '</b> – bởi ' + esc(opt.by) : '🛒 <b>ĐƠN HÀNG MỚI ' + esc(data.id) + '</b>') + '\n👤 ' + esc(c.name) + ' – <b>' + esc(c.phone) + '</b>' +
      '\n📍 ' + esc([c.address, c.district, c.province].filter(Boolean).join(', ')) + '\n\n' + esc(items) + '\n\n💰 <b>Tổng: ' + fmt(data.total) + '</b> (ship ' + fmt(data.shipping) + ') – ' + pay +
      (c.note ? '\n📝 ' + esc(c.note) : '') + (data.source ? '\n🔗 Nguồn: ' + esc(data.source) : '');
    await telegram(x.env, omsg + (manual ? '' : owner ? '\n👤 Phụ trách: ' + esc(owner) + (assigned ? ' (vừa tự chia)' : '') : '\n⚠️ Khách chưa có người phụ trách – vào CRM để giao'));
    if (!manual && owner) await telegramUser(x, owner, omsg + '\n\n👉 Đơn của khách bạn phụ trách – gọi xác nhận: ' + CRM_URL + '/#don-hang');
  };
  x.later(notify());
  return { ok: true };
}
async function orderFind(x, d) {
  let o = await first(x.db, 'SELECT * FROM orders WHERE rid = ? AND id = ?', Number(d.row) || 0, String(d.id));
  if (!o) o = await first(x.db, 'SELECT * FROM orders WHERE id = ? ORDER BY rid LIMIT 1', String(d.id));
  return o;
}
/** Nhân viên được xử lý đơn mình bán hoặc đơn của khách mình phụ trách. */
async function orderGuard(x, u, o) { if (u.level >= 2 || o.seller === u.name) return ''; return guardPhone(x, u, o.phone); }
async function crmOrderStatus(x, u, d) {
  const o = await orderFind(x, d); if (!o) return { ok: false, error: 'Không tìm thấy đơn ' + d.id };
  const gErr = await orderGuard(x, u, o); if (gErr) return { ok: false, error: gErr };
  const old = String(o.status || ''), set = {}; let status = d.status;
  if (d.seller !== undefined && u.level < 2) return { ok: false, error: 'Chỉ quản lý đổi được nhân viên bán.' };
  if (status && status !== old && ORDER_STATUS.indexOf(status) < 0) return { ok: false, error: 'Trạng thái không hợp lệ' };
  if (d.note !== undefined) set.note = String(d.note);
  if (d.paid !== undefined) { set.paid = d.paid ? 'Có – ' + u.name + ' ' + fmtDate(Date.now(), 'dd/MM HH:mm') : ''; await crmLog(x, u, 'Đơn hàng', d.id, o.name, d.paid ? 'Đã nhận tiền chuyển khoản' : 'Bỏ đánh dấu đã nhận tiền', ''); }
  if (d.seller !== undefined) { set.seller = String(d.seller); await crmLog(x, u, 'Đơn hàng', d.id, o.name, 'Nhân viên bán: ' + (o.seller || '–') + ' → ' + (d.seller || '–'), ''); }
  if (d.tracking !== undefined || d.carrier !== undefined) {
    if (d.carrier !== undefined) set.carrier = String(d.carrier);
    if (d.tracking !== undefined) set.tracking = String(d.tracking).trim();
    await crmLog(x, u, 'Đơn hàng', d.id, o.name, 'Vận đơn: ' + [d.carrier, d.tracking].filter(Boolean).join(' '), '');
    if (String(d.tracking || '').trim() && (old === 'Mới' || old === 'Đã xác nhận') && !status) status = 'Đang giao'; // có mã vận đơn = đã gửi hàng
  }
  if (status && status !== old) { set.status = status; await crmLog(x, u, 'Đơn hàng', d.id, o.name, old + ' → ' + status, d.reason || ''); }
  const ks = Object.keys(set);
  if (ks.length) await run(x.db, 'UPDATE orders SET ' + ks.map(k => k + ' = ?').join(', ') + ' WHERE rid = ?', ...ks.map(k => set[k]), o.rid);
  if (set.status) await recalc(x, [o.phone]); // huỷ / hoàn / khôi phục đơn → tính lại khách (và màu khách)
  return { ok: true, row: o.rid, status: status || old };
}
async function crmOrderEdit(x, u, d) {
  const o = await orderFind(x, d); if (!o) return { ok: false, error: 'Không tìm thấy đơn ' + d.id };
  const c = d.customer || {}, phone = normPhone(c.phone); let items = cleanItems(d.items);
  if (!/^0\d{9,10}$/.test(phone)) return { ok: false, error: 'Số điện thoại chưa đúng.' };
  if (!String(c.name || '').trim()) return { ok: false, error: 'Thiếu tên khách.' };
  if (!items.length) return { ok: false, error: 'Đơn phải có ít nhất 1 sản phẩm.' };
  const gErr = (await orderGuard(x, u, o)) || (o.phone !== phone ? await guardPhone(x, u, phone) : ''); if (gErr) return { ok: false, error: gErr };
  const ship = Math.max(0, Math.round(Number(d.shipping) || 0)), sub = applyTotal(items, d.total, ship);
  items = items.concat(cleanItems(d.gifts).map(g => Object.assign(g, { gift: true, price: 0, subtotal: 0 })));
  const set = { name: String(c.name).trim(), phone, province: c.province || '', ward: c.ward || '', address: c.address || '', items: itemsText(items), subtotal: sub, shipping: ship, total: sub + ship, payment: d.payment === 'bank' ? 'Chuyển khoản' : 'COD',
    ship: shipText(items), line: lineOf(items.filter(i => !i.gift).map(i => i.name + ' ' + i.variant).join(' ')) };
  if (CA_LIST.indexOf(d.ca) >= 0) set.ca = d.ca;
  const ks = Object.keys(set);
  await run(x.db, 'UPDATE orders SET ' + ks.map(k => k + ' = ?').join(', ') + ' WHERE rid = ?', ...ks.map(k => set[k]), o.rid);
  await crmLog(x, u, 'Sửa đơn', d.id, c.name, fmt(o.total) + ' → ' + fmt(sub + ship), d.reason || '');
  await recalc(x, [o.phone, phone]);
  return { ok: true, row: o.rid };
}
/** Mã đơn theo sale: <tiền tố><ddMMyy>-<số thứ tự>, ví dụ Phuong300926-01. */
async function nextCode(x, u, now) {
  const y = (await crmUsers(x)).find(z => z.email === u.email) || u, pre = (y.prefix || slugName(u.name)) + fmtDate(now, 'ddMMyy') + '-';
  let n = 0; for (const r of await all(x.db, 'SELECT id FROM orders WHERE substr(id, 1, ?) = ?', pre.length, pre)) n = Math.max(n, parseInt(r.id.slice(pre.length), 10) || 0);
  return pre + (n + 1 < 10 ? '0' : '') + (n + 1);
}
async function crmOrderCreate(x, u, d) {
  const c = d.customer || {}, phone = normPhone(c.phone);
  if (!/^0\d{9,10}$/.test(phone)) return { ok: false, error: 'Số điện thoại chưa đúng.' };
  if (u.level < 2) { const ow = await ownerOf(x, phone); if (ow && ow !== u.name) return { ok: false, error: 'Khách này do ' + ow + ' phụ trách. Nhờ ' + ow + ' lên đơn, hoặc nhờ quản lý chuyển khách.' }; }
  let ld = null;
  if (d.leadId) { ld = await leadGet(x, d.leadId); if (ld) { const lErr = await guardLead(x, u, ld); if (lErr) return { ok: false, error: lErr }; } }
  if (!String(c.name || '').trim()) return { ok: false, error: 'Thiếu tên khách.' };
  let items = cleanItems(d.items); if (!items.length) return { ok: false, error: 'Chưa chọn sản phẩm.' };
  const ship = Math.max(0, Math.round(Number(d.shipping) || 0)), sub = applyTotal(items, d.total, ship);
  items = items.concat(cleanItems(d.gifts).map(g => Object.assign(g, { gift: true, price: 0, subtotal: 0 })));
  const now = Date.now(), id = await nextCode(x, u, now);
  const src = ld && ld.channel ? 'Tiềm năng – ' + ld.channel : 'Nhập tay – ' + (d.source || 'Khác');
  await saveOrder(x, { id, customer: { name: String(c.name).trim(), phone, email: c.email || '', province: c.province || '', district: c.ward || '', address: c.address || '', note: c.note || '' },
    items, subtotal: sub, shipping: ship, total: sub + ship, payment: d.payment === 'bank' ? 'bank' : 'cod', source: src, first_source: src, marketing_consent: !!d.consent },
    { by: u.name, status: ORDER_STATUS.indexOf(d.status) >= 0 ? d.status : 'Đã xác nhận', ca: CA_LIST.indexOf(d.ca) >= 0 ? d.ca : '' });
  await run(x.db, "UPDATE customers SET owner = ? WHERE phone = ? AND (owner = '' OR owner IS NULL)", u.name, phone);
  await crmLog(x, u, 'Tạo đơn', id, c.name, fmt(sub + ship), src);
  if (d.leadId) await leadUpdate(x, d.leadId, { status: 'Đã chốt', order_id: id, last_at: now, callback: null });
  return { ok: true, id };
}

/* ================================================================ khách: chăm sóc, sửa thông tin */
async function crmCare(x, u, d) {
  const gErr = await guardPhone(x, u, d.phone); if (gErr) return { ok: false, error: gErr };
  const phone = normPhone(d.phone), c = await first(x.db, 'SELECT name, owner FROM customers WHERE phone = ?', phone);
  if (!c) return { ok: false, error: 'Không tìm thấy khách ' + phone };
  const now = Date.now(), cb = dateOrBlank(d.callback), owner = c.owner || u.name;
  await run(x.db, 'UPDATE customers SET care_at = ?, care_result = ?, callback = ?, owner = ? WHERE phone = ?', now, String(d.result || ''), cb, owner, phone);
  const note = String(d.note || '').trim();
  await crmLog(x, u, TASK_LABEL[d.task] || TASK_LABEL.other, phone, c.name, d.result, note + (d.callback ? (note ? ' – ' : '') + 'hẹn gọi lại ' + String(d.callback).split('-').reverse().join('/') : ''));
  return { ok: true, careAt: now, owner, callback: cb };
}
async function crmCustomer(x, u, d) {
  const gErr = await guardPhone(x, u, d.phone); if (gErr) return { ok: false, error: gErr };
  if (u.level < 2) delete d.owner; // nhân viên không tự đổi người phụ trách
  const phone = normPhone(d.phone); if (!await first(x.db, 'SELECT phone FROM customers WHERE phone = ?', phone)) return { ok: false, error: 'Không tìm thấy khách ' + phone };
  const map = { owner: 'owner', note: 'note', name: 'name', address: 'address', province: 'province', ward: 'ward', tag: 'tag' }, set = {};
  Object.keys(map).forEach(k => { if (d[k] !== undefined) set[map[k]] = String(d[k]).slice(0, 45000); });
  if (d.callback !== undefined) set.callback = dateOrBlank(d.callback);
  const ks = Object.keys(set);
  if (ks.length) await run(x.db, 'UPDATE customers SET ' + ks.map(k => k + ' = ?').join(', ') + ' WHERE phone = ?', ...ks.map(k => set[k]), phone);
  return { ok: true };
}
async function crmContact(x, u, d) {
  const r = await first(x.db, 'SELECT * FROM contacts WHERE rid = ?', Number(d.row) || 0); if (!r) return { ok: false, error: 'Không tìm thấy liên hệ' };
  if (d.done !== undefined) await run(x.db, 'UPDATE contacts SET done = ? WHERE rid = ?', d.done ? 1 : 0, r.rid);
  if (d.note !== undefined) await run(x.db, 'UPDATE contacts SET note = ? WHERE rid = ?', String(d.note), r.rid);
  if (d.done) await crmLog(x, u, 'Trả lời liên hệ', r.phone, r.name, 'Đã trả lời', d.note || '');
  return { ok: true };
}

/* ================================================================ cài đặt, nhân sự, mục tiêu */
async function crmSettings(x, u, d) {
  if (d.ca) {
    const hol = String(d.ca.holidays || '').split(/[,;\s]+/).map(s => { const m = s.match(/^(\d{1,2})\/(\d{1,2})$/); return m ? ('0' + m[1]).slice(-2) + '/' + ('0' + m[2]).slice(-2) : ''; }).filter(String);
    const ev = /^\d{1,2}:\d{2}$/.test(String(d.ca.evening)) ? d.ca.evening : '17:30';
    await kvSet(x.db, 'ca_cfg', JSON.stringify({ evening: ev, holidays: hol })); x._ca = null;
    await crmLog(x, u, 'Cài đặt', '-', '', 'Ca tối từ ' + ev + ', lễ: ' + hol.join(', '), '');
    return { ok: true };
  }
  if (d.rules) {
    const R = { vipOrders: Math.max(1, Math.round(Number(d.rules.vipOrders) || VIP_ORDERS)), vipSpent: Math.max(0, Math.round(Number(d.rules.vipSpent) || VIP_SPENT)), atRisk: Math.max(7, Math.round(Number(d.rules.atRisk) || AT_RISK_DAYS)) };
    await kvSet(x.db, 'rules_cfg', JSON.stringify(R)); x._rules = null;
    await crmLog(x, u, 'Cài đặt', '-', '', 'VIP từ ' + R.vipOrders + ' đơn hoặc ' + fmt(R.vipSpent) + '; Sắp mất sau ' + R.atRisk + ' ngày', '');
    return { ok: true, rules: R };
  }
  if (d.assignMode) {
    if (!ASSIGN_MODES[d.assignMode]) return { ok: false, error: 'Chế độ không hợp lệ' };
    await kvSet(x.db, 'assign_mode', d.assignMode); x._mode = null;
    await crmLog(x, u, 'Cài đặt', '-', '', 'Chia khách mới: ' + ASSIGN_MODES[d.assignMode], '');
    return { ok: true };
  }
  if (d.cycles) {
    const rows = d.cycles.filter(r => r && String(r[0]).trim() && Number(r[2]) > 0).map(r => ({ name: String(r[0]).trim(), variant: String(r[1] || '').trim(), days: Number(r[2]), basis: String(r[3] || '') }));
    await x.db.batch([x.db.prepare('DELETE FROM cycles')]); await insertMany(x.db, 'cycles', ['name', 'variant', 'days', 'basis'], rows); x._cycles = null;
    await recalcAll(x); // tính lại ngày dự kiến hết hàng theo chu kỳ mới
  }
  if (d.templates) {
    const rows = d.templates.filter(r => r && String(r[2]).trim()).map(r => ({ when_txt: String(r[0] || ''), purpose: String(r[1] || ''), text: String(r[2]) }));
    await run(x.db, 'DELETE FROM templates'); await insertMany(x.db, 'templates', ['when_txt', 'purpose', 'text'], rows);
  }
  await crmLog(x, u, 'Cài đặt', '-', '', d.cycles ? 'Sửa chu kỳ dùng' : 'Sửa mẫu tin nhắn', '');
  return { ok: true };
}
async function crmSaveUsers(x, u, d) {
  const cur = {}; (await crmUsers(x)).forEach(y => { cur[y.email] = y; });
  const seen = {}, rows = (d.users || []).map((y, i) => {
    const e = String(y.email || '').trim().toLowerCase(), o = cur[e] || {}, role = ROLES[y.role] ? y.role : 'Nhân viên';
    return { email: e, name: String(y.name || '').trim(), role, active: y.active === false ? 0 : 1, recv: (y.recv !== undefined ? y.recv : o.recv !== undefined ? o.recv : role === 'Nhân viên') ? 'Có' : 'Không', tg: o.tg || '',
      alias: String(y.alias !== undefined ? y.alias : o.alias || '').trim(), prefix: String(y.prefix !== undefined ? y.prefix : o.prefix || '').replace(/[^A-Za-z0-9]/g, ''), ord: i };
  }).filter(r => { if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(r.email) || seen[r.email]) return false; seen[r.email] = 1; return true; });
  if (!seen[SUPER_ADMIN]) rows.unshift({ email: SUPER_ADMIN, name: 'Thái Sơn', role: 'Quản trị', active: 1, recv: 'Không', tg: cur[SUPER_ADMIN] ? cur[SUPER_ADMIN].tg || '' : '', alias: '', prefix: '', ord: -1 });
  await run(x.db, 'DELETE FROM users'); await insertMany(x.db, 'users', ['email', 'name', 'role', 'active', 'recv', 'tg', 'alias', 'prefix', 'ord'], rows); x._users = null;
  await crmLog(x, u, 'Nhân sự', '-', '', 'Cập nhật ' + rows.length + ' tài khoản', '');
  return { ok: true, users: await crmUsers(x) };
}
async function crmTarget(x, u, d) {
  const month = String(d.month || ''), amount = Math.round(Number(d.amount) || 0), name = String(d.name || u.name).trim();
  if (!/^\d{4}-\d{2}$/.test(month)) return { ok: false, error: 'Tháng không hợp lệ.' };
  if (amount < 0 || amount > 1e11) return { ok: false, error: 'Số tiền chưa đúng.' };
  if (name !== u.name && u.level < 2) return { ok: false, error: 'Bạn chỉ đặt được mục tiêu của mình.' };
  const old = await first(x.db, 'SELECT amount FROM targets WHERE month = ? AND name = ?', month, name);
  await run(x.db, 'INSERT INTO targets (month, name, amount, by_name, at) VALUES (?, ?, ?, ?, ?) ON CONFLICT(month, name) DO UPDATE SET amount = excluded.amount, by_name = excluded.by_name, at = excluded.at', month, name, amount, u.name, Date.now());
  await crmLog(x, u, 'Mục tiêu', month, name, fmt(old ? old.amount : 0) + ' → ' + fmt(amount), name !== u.name ? 'quản lý đặt' : '');
  return { ok: true };
}

/* ================================================================ khách tiềm năng */
async function leadGet(x, id) { return first(x.db, 'SELECT * FROM leads WHERE id = ?', String(id)); }
const LEAD_FIELDS = ['time', 'name', 'phone', 'channel', 'interest', 'status', 'owner', 'last_at', 'callback', 'reason', 'note', 'order_id', 'by_name'];
export async function leadUpdate(x, id, f) {
  const ks = Object.keys(f).filter(k => LEAD_FIELDS.indexOf(k) >= 0); if (!ks.length) return false;
  if (f.phone !== undefined) f.phone = normPhone(f.phone);
  const r = await run(x.db, 'UPDATE leads SET ' + ks.map(k => k + ' = ?').join(', ') + ' WHERE id = ?', ...ks.map(k => f[k] === undefined ? null : f[k]), String(id));
  return r.meta.changes > 0;
}
/** Thêm khách tiềm năng. Số này đang có 1 lượt đang mở (Mới hỏi / Đang tư vấn) thì ghi nối vào đó, không tạo trùng. */
export async function addLead(x, o) {
  const phone = normPhone(o.phone), now = Date.now();
  const cur = await first(x.db, "SELECT * FROM leads WHERE phone = ? AND status IN ('Mới hỏi', 'Đang tư vấn') ORDER BY rid DESC LIMIT 1", phone);
  if (cur) {
    const note = String(cur.note || '') + (o.note ? '\n[' + fmtDate(now, 'dd/MM') + '] ' + o.note : '');
    await leadUpdate(x, cur.id, { note, interest: o.interest || cur.interest, owner: cur.owner || o.owner || '' });
    return { id: cur.id, merged: true, owner: cur.owner || o.owner || '' };
  }
  let owner = o.owner || '';
  if (!owner && o.auto) owner = (await ownerOf(x, phone)) || await autoOwner(x); // khách cũ → người đang phụ trách; khách lạ → theo chế độ chia khách
  const id = 'TN' + fmtDate(now, 'yyMMddHHmmss') + Math.floor(Math.random() * 10) + randHex(1);
  await run(x.db, 'INSERT INTO leads (id, time, name, phone, channel, interest, status, owner, last_at, callback, reason, note, order_id, by_name) VALUES (?, ?, ?, ?, ?, ?, ?, ?, NULL, ?, \'\', ?, \'\', ?)',
    id, now, o.name || '', phone, o.channel || 'Khác', o.interest || '', 'Mới hỏi', owner, dateOrBlank(o.callback), o.note || '', o.by || '');
  return { id, merged: false, owner };
}
async function crmLeadSave(x, u, d) {
  const phone = normPhone(d.phone);
  if (!/^0\d{9,10}$/.test(phone)) return { ok: false, error: 'Số điện thoại chưa đúng (10 số, bắt đầu bằng 0).' };
  if (!d.id && u.level < 2) { // nhân viên thêm khách tiềm năng: không được "đè" lên khách của người khác
    const chk = await crmCheckPhone(x, u, { phone });
    if (chk.status === 'other') return { ok: false, error: 'Số này ' + (chk.lead ? 'đang là khách tiềm năng' : 'là khách hàng') + ' do ' + chk.owner + ' phụ trách. Nhờ quản lý nếu cần chuyển.' };
    d.owner = u.name;
  }
  if (d.id && u.level < 2) { const ld0 = await leadGet(x, d.id); if (!ld0) return { ok: false, error: 'Không tìm thấy khách tiềm năng.' }; const e0 = await guardLead(x, u, ld0); if (e0) return { ok: false, error: e0 }; d.owner = u.name; }
  if (!d.id) {
    const res = await addLead(x, { name: String(d.name || '').trim(), phone, channel: d.channel, interest: d.interest, owner: d.owner === undefined ? u.name : d.owner, note: d.note, callback: d.callback, by: u.name });
    await crmLog(x, u, 'Thêm tiềm năng', phone, d.name, d.channel || '', d.interest || '');
    return { ok: true, id: res.id, merged: res.merged };
  }
  const f = { name: String(d.name || '').trim(), phone, channel: d.channel || 'Khác', interest: d.interest || '', owner: d.owner || '', note: d.note || '', callback: dateOrBlank(d.callback) };
  if (d.status && LEAD_STATUS.indexOf(d.status) >= 0) f.status = d.status;
  if (d.reason !== undefined) f.reason = d.reason;
  if (!await leadUpdate(x, d.id, f)) return { ok: false, error: 'Không tìm thấy khách tiềm năng.' };
  return { ok: true, id: d.id };
}
async function crmLeadContact(x, u, d) {
  const ld = await leadGet(x, d.id); if (!ld) return { ok: false, error: 'Không tìm thấy khách tiềm năng.' };
  const gErr = await guardLead(x, u, ld); if (gErr) return { ok: false, error: gErr };
  const st = LEAD_STATUS.indexOf(d.status) >= 0 ? d.status : (ld.status === 'Mới hỏi' ? 'Đang tư vấn' : ld.status);
  if (st === 'Không mua' && !String(d.reason || '').trim()) return { ok: false, error: 'Ghi lý do khách không mua giúp em nhé.' };
  const now = Date.now(), f = { status: st, last_at: now, callback: st === 'Không mua' ? null : dateOrBlank(d.callback) };
  if (!ld.owner) f.owner = u.name;
  if (st === 'Không mua') f.reason = String(d.reason).trim();
  const note = String(d.note || '').trim();
  if (note) f.note = String(ld.note || '') + '\n[' + fmtDate(now, 'dd/MM') + ' ' + u.name + '] ' + note;
  await leadUpdate(x, d.id, f);
  await crmLog(x, u, 'Tư vấn', ld.phone, ld.name, d.result || st, [note, st === 'Không mua' ? 'Lý do: ' + d.reason : '', d.callback ? 'hẹn ' + String(d.callback).split('-').reverse().join('/') : ''].filter(String).join(' – '));
  return { ok: true, status: st, at: now, owner: f.owner || ld.owner };
}

/* ================================================================ điều phối */
export async function crmApi(x, d, sync) {
  const a = d.action;
  if (a === 'login') return crmLogin(x, d);
  if (a === 'verify') return crmVerify(x, d);
  const u = await crmSession(x, d.token);
  if (!u) return { ok: false, auth: true, error: 'Phiên đăng nhập đã hết. Vui lòng đăng nhập lại.' };
  x.user = u;
  if (a === 'logout') { await run(x.db, 'DELETE FROM sessions WHERE token = ?', d.token); return { ok: true }; }
  if (a === 'load') return crmLoad(x, u);
  if (a === 'order_create') return crmOrderCreate(x, u, d);
  if (a === 'check_phone') return crmCheckPhone(x, u, d);
  if (a === 'cust_orders') return crmCustOrders(x, u, d);
  if (sync[a]) { if (u.level < 3) return { ok: false, error: 'Chỉ Quản trị làm được việc này.' }; return sync[a](x, u, d); }
  if (a === 'tg_link') return crmTgLink(x, u);
  if (a === 'tg_check') return crmTgCheck(x, u, d);
  if (a === 'prefs') return crmPrefs(x, u, d);
  if (a === 'tg_off') { await userSet(x, u.email, 'tg', ''); return { ok: true }; }
  const need = { settings: 2, users: 3, assign: 2, bulk: 2, recv: 2 };
  if (need[a] && u.level < need[a]) return { ok: false, error: 'Bạn không có quyền làm việc này.' };
  const h = { care: crmCare, customer: crmCustomer, order_status: crmOrderStatus, contact: crmContact, settings: crmSettings, users: crmSaveUsers, order_edit: crmOrderEdit,
    lead_save: crmLeadSave, lead_contact: crmLeadContact, target: crmTarget, assign: crmAssign, bulk: crmBulk, recv: crmRecv, claim: crmClaim }[a];
  if (h) return h(x, u, d);
  return { ok: false, error: 'Không rõ thao tác: ' + a };
}
