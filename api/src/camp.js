/* ================================================================ 📊 Đợt phát động mở rộng khách (15/11/2026, anh Sơn)
 * "Xem các sale đã triển khai được những phần gì để đánh giá mức độ hưởng ứng phát động của công ty và việc chị em làm thực tế."
 * Chỉ đọc. Trả về số liệu thô của cả đợt (14/11 → 30/11/2026), CRM (app.js campHtml) tự tính từng sale:
 * - logs: 5 việc mở rộng khách (Mời giới thiệu, Mời nhóm Zalo, Gọi lại khách cũ, Nhận khách = Kho chung, Đăng bài FB)
 * - leads: khách hỏi tạo trong đợt (để đếm khách được giới thiệu / sale tự tìm)
 * - orders: đơn trong đợt (để biết việc nào ra đơn)
 * - reads: ai đã bấm ✅ Tôi đã đọc thông báo phát động
 * Đọc thẳng D1 (không dùng S.d.log của CRM vì CRM chỉ tải 6000 dòng nhật ký gần nhất). */
import { all, first } from './lib.js';
import { crmUsers } from './crm.js';

export const CAMP = { from: Date.UTC(2026, 10, 13, 17, 0), to: Date.UTC(2026, 10, 30, 17, 0), tb: '%6 người khách của riêng mình%' }; // 0h 14/11 → hết 30/11 giờ VN

export async function crmCamp(x, u) {
  if (u.level < 2) return { ok: false, error: 'Chỉ Quản lý / Quản trị xem được.' };
  const { from, to } = CAMP;
  const [logs, leads, orders, post] = await Promise.all([
    all(x.db, "SELECT time, by_name, what, ref, result FROM logs WHERE what IN ('Mời giới thiệu', 'Mời nhóm Zalo', 'Gọi lại khách cũ', 'Nhận khách', 'Đăng bài FB') AND time >= ? AND time < ?", from, to).catch(() => []),
    all(x.db, "SELECT phone, time, by_name, owner, channel, how, ref_phone, ref_name FROM leads WHERE time >= ? AND time < ?", from, to).catch(() => []),
    all(x.db, "SELECT phone, time, total, seller, status, ref_phone FROM orders WHERE time >= ? AND time < ?", from, to + 7 * 864e5).catch(() => []),
    first(x.db, 'SELECT id FROM tb_posts WHERE title LIKE ? ORDER BY id LIMIT 1', CAMP.tb).catch(() => null)]);
  const reads = post ? await all(x.db, 'SELECT name, at FROM tb_read WHERE post = ?', post.id).catch(() => []) : [];
  const sales = (await crmUsers(x)) // chỉ quyền Sale & CSKH đang làm: đúng những người được đặt mục tiêu 6 khách (crm.js self6_1411_mig)
   .filter(v => v.active && v.role === 'Sale & CSKH').map(v => ({ name: v.name, role: v.role }));
  const ph = s => String(s || '').replace(/^'/, '');
  return { ok: true, from, to, now: Date.now(), sales, read: reads.map(r => ({ n: r.name, at: r.at })), hasPost: !!post,
    logs: logs.map(l => [l.time, l.by_name, l.what, ph(l.ref), l.result || '']),
    leads: leads.map(l => [l.time, ph(l.phone), l.by_name || '', l.owner || '', l.channel || '', l.how || '', ph(l.ref_phone), l.ref_name || '']),
    orders: orders.filter(o => !/huỷ|hủy|hoàn/i.test(o.status || '')).map(o => [o.time, ph(o.phone), Number(o.total) || 0, o.seller || '', ph(o.ref_phone)]) };
}
