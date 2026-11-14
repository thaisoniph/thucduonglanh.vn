/* ================================================================ 📗 Sổ tay doanh nghiệp – MỘT NGUỒN DUY NHẤT (14/11/2026, anh Sơn, khoá "AI Workforce: Claude & Codex")
 * Nguồn: data/so-tay.json, sửa ở /admin → Cài đặt website → 📗 Sổ tay doanh nghiệp. build.py:
 *   - chèn Sổ tay vào cuối /chat-kb.txt (sotay_kb) → mọi trợ lý đọc qua kb() của chat.js: chat web, nhóm Zalo + tin riêng, Fanpage, viết bài web,
 *     bài Zalo / Fanpage / FB cá nhân, kịch bản video, chấm bài, trợ lý trang hướng dẫn. Không cần sửa từng trợ lý.
 *   - xuất /so-tay.json (đã điền số từ Cài đặt website) → ở đây: nhắc xác nhận lại, cổng MCP (công cụ so_tay), CRM xem tình trạng.
 * Quy tắc an toàn trong code (chat.js TRUTH_RULES, insight.js LAW) vẫn giữ làm "sàn": Sổ tay thêm / thay thông tin công ty, chính sách, cách nói. */
import { kvGet, kvSet, fmtDate, DAY } from './lib.js';
import { crmUsers } from './crm.js';
import { telegramTo } from './google.js';

const URL_ST = 'https://thucduonglanh.vn/so-tay.json';
const ADMIN = 'https://thucduonglanh.vn/admin/#/collections/settings/entries/so_tay';
let mem = null;
/** { remind_days, items: [{ group, title, body, status, by, date }] } – giữ 10 phút; lỗi mạng dùng bản cũ */
export async function soTay() {
  if (mem && Date.now() - mem.t < 10 * 60e3) return mem.d;
  try {
    const r = await fetch(URL_ST, { cf: { cacheTtl: 600, cacheEverything: true } });
    if (r.ok) { const d = await r.json(); if (d && Array.isArray(d.items)) mem = { t: Date.now(), d }; }
  } catch (e) { console.error('so tay', e.message); }
  return mem ? mem.d : { remind_days: 90, items: [] };
}
/** Mục quá hạn: chưa xác nhận lần nào, hoặc ngày xác nhận cũ hơn remind_days */
export function stDue(d, now) {
  const lim = (Number(d.remind_days) || 90) * DAY;
  return (d.items || []).map(v => { const t = v.date ? new Date(v.date + 'T09:00:00+07:00').getTime() : 0; return Object.assign({}, v, { age: t ? Math.floor((now - t) / DAY) : null, due: !t || v.status !== 'Đã xác nhận' || now - t > lim }); });
}
/** Tình trạng cho CRM (tab 🎯 → ⚙️ Cài đặt nội dung) */
export async function stInfo() {
  const d = await soTay(), L = stDue(d, Date.now());
  return { n: L.length, ok: L.filter(v => !v.due).length, wait: L.filter(v => v.status !== 'Đã xác nhận').length, old: L.filter(v => v.status === 'Đã xác nhận' && v.due).length,
    days: Number(d.remind_days) || 90, admin: ADMIN, items: L.map(v => ({ g: v.group, t: v.title, s: v.status, by: v.by, date: v.date, age: v.age, due: v.due })) };
}
/** Bản chữ cho cổng MCP: ChatGPT / Gemini / Claude bên ngoài đọc trước khi viết, trả lời thay công ty */
export async function stText() {
  const d = await soTay(), G = [...new Set(d.items.map(v => v.group))];
  return ['SỔ TAY DOANH NGHIỆP THỰC DƯỠNG LÀNH (nguồn chính thức duy nhất: câu chuyện công ty, chính sách, bản sắc thương hiệu, câu hỏi khó + câu trả lời đã duyệt, điều không được nói). Viết hay trả lời thay công ty thì làm đúng Sổ tay; mục "Chờ anh xác nhận" là bản nháp đang dùng tạm.', '',
    ...G.map(g => '## ' + g + '\n' + d.items.filter(v => v.group === g).map(v => '### ' + v.title + (v.status === 'Đã xác nhận' ? ' (đã xác nhận ' + (v.by ? v.by + ' ' : '') + v.date + ')' : ' (' + v.status + ')') + '\n' + v.body).join('\n\n'))].join('\n');
}
/** ⏰ Thứ Hai 8h: Telegram Quản trị danh sách mục chưa xác nhận / quá hạn (cron.js) */
export async function stRemind(x) {
  const now = Date.now(), wk = 'st_rem_' + fmtDate(now, 'yyyyMMdd');
  if (new Date(now + 7 * 3600e3).getUTCDay() !== 1 || await kvGet(x.db, wk)) return;
  await kvSet(x.db, wk, '1', 2 * DAY);
  const d = await soTay(), L = stDue(d, now).filter(v => v.due); if (!L.length) return;
  const e = s => String(s || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  const wait = L.filter(v => v.status !== 'Đã xác nhận'), old = L.filter(v => v.status === 'Đã xác nhận');
  const m = '📗 <b>Sổ tay doanh nghiệp cần anh xác nhận</b>\nMọi trợ lý AI (chat web, Zalo, Fanpage, viết bài, chấm bài) đang đọc Sổ tay này.'
    + (wait.length ? '\n\n🟡 ' + wait.length + ' mục chưa xác nhận: ' + e(wait.slice(0, 6).map(v => v.title).join(' · ')) + (wait.length > 6 ? '…' : '') : '')
    + (old.length ? '\n\n⏰ ' + old.length + ' mục quá ' + (Number(d.remind_days) || 90) + ' ngày chưa xác nhận lại: ' + e(old.slice(0, 6).map(v => v.title + ' (' + v.age + ' ngày)').join(' · ')) : '')
    + '\n\n👉 Đọc lại, sửa nếu cần, chọn "Đã xác nhận" + ghi tên, ngày hôm nay → Lưu: ' + ADMIN;
  for (const u of await crmUsers(x)) if (u.active && u.tg && u.level >= 3) await telegramTo(x.env, u.tg, m);
}
