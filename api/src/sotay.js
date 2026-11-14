/* ================================================================ 📗 Sổ tay doanh nghiệp – MỘT NGUỒN DUY NHẤT (14/11/2026, anh Sơn, khoá "AI Workforce: Claude & Codex")
 * Nguồn: data/so-tay.json, sửa ở /admin → Cài đặt website → 📗 Sổ tay doanh nghiệp. build.py:
 *   - chèn Sổ tay vào cuối /chat-kb.txt (sotay_kb) → mọi trợ lý đọc qua kb() của chat.js: chat web, nhóm Zalo + tin riêng, Fanpage, viết bài web,
 *     bài Zalo / Fanpage / FB cá nhân, kịch bản video, chấm bài, trợ lý trang hướng dẫn. Không cần sửa từng trợ lý.
 *   - xuất /so-tay.json (đã điền số từ Cài đặt website) → ở đây: nhắc xác nhận lại, cổng MCP (công cụ so_tay), CRM xem tình trạng.
 * Quy tắc an toàn trong code (chat.js TRUTH_RULES, insight.js LAW) vẫn giữ làm "sàn": Sổ tay thêm / thay thông tin công ty, chính sách, cách nói. */
import { kvSet, kvGet, kvJson, fmtDate, DAY } from './lib.js';
import { crmUsers } from './crm.js';
import { telegramTo } from './google.js';

/* 15/11/2026 (anh Sơn: "đưa Sổ tay sang CRM để thao tác & cập nhật 1 chỗ"): bản chính nằm trong D1 (kv 'so_tay'), sửa ở CRM → 🎯 → ⚙️ Cài đặt → 📗 Sổ tay.
 * /so-tay.json (build.py) giờ chỉ dùng: vars = số điền ô {hotline}, {shipping_fee}… từ Cài đặt website (đổi số 1 chỗ), seed = bản cũ data/so-tay.json để chép sang lần đầu.
 * Trợ lý đọc qua kb() (chat.js nối stKb() vào cuối chat-kb.txt), giữ 2 phút. */
const URL_ST = 'https://thucduonglanh.vn/so-tay.json';
export const ST_CRM = 'https://quantri.thucduonglanh.vn/#noi-dung/so-tay';
export const ST_GROUPS = ['📖 Câu chuyện công ty', '📜 Chính sách', '🎨 Bản sắc thương hiệu', '❓ Câu hỏi khó + câu trả lời đã duyệt', '🚫 Điều không được nói'];
export const ST_STATUS = ['Chờ anh xác nhận', 'Đã xác nhận', 'Tắt'];
let DB = null;
/** index.js gọi mỗi lượt để kb() (không có x) đọc được Sổ tay trong D1 */
export function stBind(db) { if (db) DB = db; }
let web = null, mem = null;
async function stWeb() {
  if (web && Date.now() - web.t < 10 * 60e3) return web.d;
  try { const r = await fetch(URL_ST, { cf: { cacheTtl: 600, cacheEverything: true } }); if (r.ok) { const d = await r.json(); if (d) web = { t: Date.now(), d }; } } catch (e) { console.error('so tay web', e.message); }
  return web ? web.d : {};
}
const rid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
function norm(v) {
  return { id: String(v.id || rid()), group: ST_GROUPS.includes(v.group) ? v.group : ST_GROUPS[0], title: String(v.title || '').trim().slice(0, 300), body: String(v.body || '').trim().slice(0, 6000),
    status: ST_STATUS.includes(v.status) ? v.status : ST_STATUS[0], by: String(v.by || '').slice(0, 80), date: String(v.date || '').slice(0, 10), upd: Number(v.upd) || 0, ub: String(v.ub || '').slice(0, 80), hist: Array.isArray(v.hist) ? v.hist.slice(-5) : [] };
}
/** Bản gốc trong D1 (chưa điền số). Chưa có thì chép từ bản cũ trên web 1 lần. */
export async function stRaw(db) {
  db = db || DB;
  if (mem && Date.now() - mem.t < 2 * 60e3) return mem.d;
  let d = db ? await kvJson(db, 'so_tay', null) : null;
  if (!d) {
    // seed = bản gốc còn ô {hotline}…; web bản cũ chỉ có items đã điền số → dùng tạm để đọc, không lưu (tránh mất ô tự điền)
    const w = await stWeb(), seed = Array.isArray(w.seed) ? w.seed : null, its = seed || (Array.isArray(w.items) ? w.items : []);
    if (its.length) { d = { remind_days: Number(w.remind_days) || 90, items: its.filter(v => v && v.title).map(norm), from: seed ? 'web' : 'tmp', at: Date.now() }; if (db && seed) await kvSet(db, 'so_tay', JSON.stringify(d)); }
  }
  d = d || { remind_days: 90, items: [] };
  mem = { t: Date.now(), d };
  return d;
}
async function stPut(db, d) { await kvSet(db, 'so_tay', JSON.stringify(d)); mem = { t: Date.now(), d }; }
/** Ô {hotline}, {shipping_fee}… → số trong Cài đặt website */
export async function stFill(s) { const v = (await stWeb()).vars || {}; return String(s || '').replace(/\{(\w+)\}/g, (m, k) => v[k] != null && v[k] !== '' ? String(v[k]) : m); }
/** { remind_days, items } đang dùng (bỏ mục Tắt), đã điền số – cho trợ lý, nhắc xác nhận, MCP */
export async function soTay(db) {
  const d = await stRaw(db), items = [];
  for (const v of d.items) if (v.title && v.status !== 'Tắt') items.push({ id: v.id, group: v.group, title: await stFill(v.title), body: await stFill(v.body), status: v.status, by: v.by, date: v.date });
  return { remind_days: Number(d.remind_days) || 90, items };
}
/** Phần Sổ tay nối vào cuối kiến thức trợ lý (thay sotay_kb() cũ của build.py) */
export async function stKb() {
  try {
    const its = (await soTay()).items; if (!its.length) return '';
    const out = ['# SỔ TAY DOANH NGHIỆP (nguồn chính thức: câu chuyện, chính sách, bản sắc, câu trả lời đã duyệt, điều không được nói)', '',
      'Sổ tay là nguồn chính: thông tin công ty, chính sách, cách nói khác chỗ khác thì theo Sổ tay. Câu trả lời mẫu dùng đúng ý, được nói lại cho tự nhiên.', ''];
    for (const g of [...new Set(its.map(v => v.group))]) { out.push('## ' + g, ''); for (const v of its) if (v.group === g) out.push('### ' + v.title, v.body.trim(), ''); }
    return out.join('\n');
  } catch (e) { console.error('stKb', e.message); return ''; }
}
/** Mục quá hạn: chưa xác nhận lần nào, hoặc ngày xác nhận cũ hơn remind_days */
export function stDue(d, now) {
  const lim = (Number(d.remind_days) || 90) * DAY;
  return (d.items || []).map(v => { const t = v.date ? new Date(v.date + 'T09:00:00+07:00').getTime() : 0; return Object.assign({}, v, { age: t ? Math.floor((now - t) / DAY) : null, due: !t || v.status !== 'Đã xác nhận' || now - t > lim }); });
}
/** Tình trạng cho CRM (tab 🎯 → ⚙️ Cài đặt nội dung) */
export async function stInfo(x) {
  const d = await soTay(x && x.db), L = stDue(d, Date.now());
  return { n: L.length, ok: L.filter(v => !v.due).length, wait: L.filter(v => v.status !== 'Đã xác nhận').length, old: L.filter(v => v.status === 'Đã xác nhận' && v.due).length,
    days: Number(d.remind_days) || 90, admin: ST_CRM, items: L.map(v => ({ g: v.group, t: v.title, s: v.status, by: v.by, date: v.date, age: v.age, due: v.due })) };
}
/** Bản chữ cho cổng MCP: ChatGPT / Gemini / Claude bên ngoài đọc trước khi viết, trả lời thay công ty */
export async function stText(x) {
  const d = await soTay(x && x.db), G = [...new Set(d.items.map(v => v.group))];
  return ['SỔ TAY DOANH NGHIỆP THỰC DƯỠNG LÀNH (nguồn chính thức duy nhất: câu chuyện công ty, chính sách, bản sắc thương hiệu, câu hỏi khó + câu trả lời đã duyệt, điều không được nói). Viết hay trả lời thay công ty thì làm đúng Sổ tay; mục "Chờ anh xác nhận" là bản nháp đang dùng tạm.', '',
    ...G.map(g => '## ' + g + '\n' + d.items.filter(v => v.group === g).map(v => '### ' + v.title + (v.status === 'Đã xác nhận' ? ' (đã xác nhận ' + (v.by ? v.by + ' ' : '') + v.date + ')' : ' (' + v.status + ')') + '\n' + v.body).join('\n\n'))].join('\n');
}
/** ⏰ Thứ Hai 8h: Telegram Quản trị danh sách mục chưa xác nhận / quá hạn (cron.js) */
export async function stRemind(x) {
  const now = Date.now(), wk = 'st_rem_' + fmtDate(now, 'yyyyMMdd');
  if (new Date(now + 7 * 3600e3).getUTCDay() !== 1 || await kvGet(x.db, wk)) return;
  await kvSet(x.db, wk, '1', 2 * DAY);
  const d = await soTay(x.db), L = stDue(d, now).filter(v => v.due); if (!L.length) return;
  const e = s => String(s || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  const wait = L.filter(v => v.status !== 'Đã xác nhận'), old = L.filter(v => v.status === 'Đã xác nhận');
  const m = '📗 <b>Sổ tay doanh nghiệp cần anh xác nhận</b>\nMọi trợ lý AI (chat web, Zalo, Fanpage, viết bài, chấm bài) đang đọc Sổ tay này.'
    + (wait.length ? '\n\n🟡 ' + wait.length + ' mục chưa xác nhận: ' + e(wait.slice(0, 6).map(v => v.title).join(' · ')) + (wait.length > 6 ? '…' : '') : '')
    + (old.length ? '\n\n⏰ ' + old.length + ' mục quá ' + (Number(d.remind_days) || 90) + ' ngày chưa xác nhận lại: ' + e(old.slice(0, 6).map(v => v.title + ' (' + v.age + ' ngày)').join(' · ')) : '')
    + '\n\n👉 Mở CRM, đọc lại, sửa nếu cần rồi bấm ✅ Xác nhận: ' + ST_CRM;
  for (const u of await crmUsers(x)) if (u.active && u.tg && u.level >= 3) await telegramTo(x.env, u.tg, m);
}

/* ---------------------------------------------------------------- CRM → 🎯 → ⚙️ Cài đặt → 📗 Sổ tay: xem, sửa, xác nhận (15/11/2026)
 * Sửa: Marketing, Quản lý, Quản trị, người có ô 🌐 Sửa website. Xác nhận, xoá, đổi số ngày nhắc: chỉ Quản trị.
 * Sửa chữ của mục đã xác nhận → về "Chờ anh xác nhận" (trừ Quản trị bấm Lưu + xác nhận). Mỗi mục giữ 5 bản trước để xem lại / dùng lại. */
export async function crmSt(x, u, d, crmLog) {
  const a = d.action, adm = u.level >= 3, ed = adm || u.level >= 2 || u.role === 'Marketing' || !!u.web, today = fmtDate(Date.now(), 'yyyy-MM-dd');
  const raw = await stRaw(x.db), out = async () => ({ ok: true, st: { remind_days: Number(raw.remind_days) || 90, items: raw.items, vars: (await stWeb()).vars || {}, groups: ST_GROUPS, ed, adm } });
  if (a === 'ins_st') return out();
  if (raw.from === 'tmp') return { ok: false, error: 'Web đang cập nhật bản mới, thử lại sau 2–3 phút.' };
  if (!ed) return { ok: false, error: 'Bạn chưa có quyền sửa Sổ tay. Nhờ Quản trị cấp quyền Marketing hoặc ô 🌐 Sửa website.' };
  const find = id => raw.items.find(v => v.id === String(id || ''));
  if (a === 'ins_stsave') {
    const n = norm(Object.assign({}, d.item || {}, { hist: [] }));
    if (!n.title || !n.body) return { ok: false, error: 'Cần có tiêu đề và nội dung.' };
    let v = find(d.item && d.item.id), what;
    if (v) {
      const changed = v.title !== n.title || v.body !== n.body || v.group !== n.group;
      if (changed) v.hist = (v.hist || []).concat([{ title: v.title, body: v.body, by: v.ub || v.by || '', at: v.upd || 0 }]).slice(-5);
      Object.assign(v, { group: n.group, title: n.title, body: n.body });
      if (n.status === 'Tắt' || v.status === 'Tắt') v.status = n.status === 'Tắt' ? 'Tắt' : 'Chờ anh xác nhận';
      if (changed && v.status === 'Đã xác nhận') v.status = 'Chờ anh xác nhận';
      what = 'Sửa Sổ tay';
    } else { v = Object.assign(n, { id: rid(), status: n.status === 'Tắt' ? 'Tắt' : 'Chờ anh xác nhận', by: '', date: '' }); raw.items.push(v); what = 'Thêm mục Sổ tay'; }
    if (adm && d.ok && v.status !== 'Tắt') Object.assign(v, { status: 'Đã xác nhận', by: u.name, date: today });
    Object.assign(v, { upd: Date.now(), ub: u.name });
    await stPut(x.db, raw);
    await crmLog(x, u, 'Sổ tay', '-', '', what + (adm && d.ok ? ' + xác nhận' : ''), v.title.slice(0, 200));
    return out();
  }
  if (!adm) return { ok: false, error: 'Chỉ Quản trị xác nhận, xoá mục hoặc đổi số ngày nhắc.' };
  if (a === 'ins_stok') {
    const ids = [].concat(d.ids || d.id || []).map(String); let n = 0;
    for (const v of raw.items) if (ids.includes(v.id) && v.status !== 'Tắt') { Object.assign(v, { status: 'Đã xác nhận', by: u.name, date: today }); n++; }
    if (!n) return { ok: false, error: 'Không thấy mục cần xác nhận.' };
    await stPut(x.db, raw); await crmLog(x, u, 'Sổ tay', '-', '', 'Xác nhận ' + n + ' mục Sổ tay', ''); return out();
  }
  if (a === 'ins_stdel') {
    const v = find(d.id); if (!v) return { ok: false, error: 'Không thấy mục này.' };
    raw.items = raw.items.filter(w => w !== v); await stPut(x.db, raw);
    await crmLog(x, u, 'Sổ tay', '-', '', 'Xoá mục Sổ tay', v.title.slice(0, 200) + ' :: ' + v.body.slice(0, 300)); return out();
  }
  if (a === 'ins_stcfg') { raw.remind_days = Math.max(30, Math.min(365, Number(d.remind_days) || 90)); await stPut(x.db, raw); return out(); }
  return { ok: false, error: 'Không rõ thao tác.' };
}
