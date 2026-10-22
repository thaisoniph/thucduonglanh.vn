// Ứng tuyển từ trang tuyển dụng congsu.thucduonglanh.vn (22/10/2026): lưu bảng D1 applicants (không lưu file CV),
// báo Telegram riêng cho tài khoản Quản trị (kèm file CV), email về hộp thư báo đơn. Không gửi vào nhóm Đơn hàng (dữ liệu cá nhân ứng viên).
import { esc, run, normPhone, fmtDate } from './lib.js';
import { telegramTo, telegram, sendMail, tgConf } from './google.js';
import { crmUsers } from './crm.js';

const MAX_FILE = 5 * 1024 * 1024; // 5 MB
const FILE_TYPES = /\.(pdf|docx?|png|jpe?g|webp)$/i;
const QS = [['why', 'Vì sao muốn đồng hành cùng VitaGreen'], ['hard', 'Việc khó nhất đã theo đến cùng'], ['rules', 'Quy tắc làm tốt nhất / cần rèn thêm'], ['ai', 'AI & công cụ số đang dùng'], ['life', 'Lối sống lành hiện nay']];
const cut = (v, n) => String(v == null ? '' : v).trim().slice(0, n);

async function applySchema(db) {
  await run(db, `CREATE TABLE IF NOT EXISTS applicants (
    id INTEGER PRIMARY KEY AUTOINCREMENT, time INTEGER, job TEXT DEFAULT '', name TEXT DEFAULT '', phone TEXT DEFAULT '', email TEXT DEFAULT '',
    birth TEXT DEFAULT '', area TEXT DEFAULT '', exp TEXT DEFAULT '', salary TEXT DEFAULT '', start TEXT DEFAULT '', cv_link TEXT DEFAULT '',
    file_name TEXT DEFAULT '', answers TEXT DEFAULT '', heard TEXT DEFAULT '', source TEXT DEFAULT '', status TEXT DEFAULT 'Mới', note TEXT DEFAULT ''
  )`);
}

/** Gửi file CV (base64) vào 1 chat Telegram. Lỗi → bỏ qua (tin chữ đã gửi trước). */
async function telegramFile(env, chatId, b64, name, caption) {
  const c = await tgConf(env); if (!c.token || !chatId || env.MOCK_GOOGLE) return;
  try {
    const bin = Uint8Array.from(atob(b64), ch => ch.charCodeAt(0)), fd = new FormData();
    fd.append('chat_id', String(chatId)); fd.append('caption', caption.slice(0, 1000)); fd.append('document', new Blob([bin]), name);
    await fetch('https://api.telegram.org/bot' + c.token + '/sendDocument', { method: 'POST', body: fd });
  } catch (e) { console.error('telegramFile', e.message); }
}

export async function apply(x, d) {
  const a = { job: cut(d.job, 80), name: cut(d.name, 80), phone: normPhone(d.phone), email: cut(d.email, 120), birth: cut(d.birth, 10), area: cut(d.area, 120),
    exp: cut(d.exp, 40), salary: cut(d.salary, 80), start: cut(d.start, 80), cv_link: cut(d.cv_link, 500), heard: cut(d.heard, 80), source: cut(d.source, 200) };
  if (!a.job || !a.name || !/^0\d{9}$/.test(a.phone) || !/^\S+@\S+\.\S+$/.test(a.email)) return { ok: false, error: 'Vui lòng điền đủ vị trí, họ tên, số điện thoại (10 số) và email.' };
  if (!d.consent) return { ok: false, error: 'Vui lòng đồng ý cho công ty lưu thông tin để xét tuyển.' };
  const ans = {}; for (const [k] of QS) ans[k] = cut(d[k], 2000);
  let file = null;
  if (d.file && d.file.data) {
    const name = cut(d.file.name, 120).replace(/[\\/:*?"<>|]/g, '_'), b64 = String(d.file.data).replace(/^data:[^,]*,/, '');
    if (!FILE_TYPES.test(name)) return { ok: false, error: 'File CV cần là PDF, Word hoặc ảnh.' };
    if (b64.length * 0.75 > MAX_FILE) return { ok: false, error: 'File CV lớn hơn 5 MB. Bạn gửi link CV thay cho file nhé.' };
    file = { name, b64 };
  }
  await applySchema(x.db);
  const now = Date.now();
  await run(x.db, 'INSERT INTO applicants (time, job, name, phone, email, birth, area, exp, salary, start, cv_link, file_name, answers, heard, source) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
    now, a.job, a.name, a.phone, a.email, a.birth, a.area, a.exp, a.salary, a.start, a.cv_link, file ? file.name : '', JSON.stringify(ans), a.heard, a.source);

  const line = (k, v) => v ? '\n' + k + ': ' + esc(v) : '';
  const head = '🧑‍💼 <b>ỨNG TUYỂN: ' + esc(a.job) + '</b>\n👤 ' + esc(a.name) + (a.birth ? ' (' + esc(a.birth) + ')' : '') + ' – <b>' + esc(a.phone) + '</b>\n✉️ ' + esc(a.email)
    + line('📍 Nơi ở', a.area) + line('💼 Kinh nghiệm', a.exp) + line('💰 Mong muốn', a.salary) + line('📅 Bắt đầu', a.start) + line('🔗 CV', a.cv_link) + (file ? '\n📎 File CV gửi ngay dưới' : '') + line('📣 Biết tin từ', a.heard);
  const qa = QS.filter(([k]) => ans[k]).map(([k, q]) => '\n\n<b>' + q + '</b>\n' + esc(ans[k].slice(0, 600))).join('');
  const msg = (head + qa).slice(0, 3900) + '\n\n👉 Gọi / nhắn Zalo cho ứng viên trong 2 ngày làm việc';
  x.later((async () => {
    const admins = (await crmUsers(x)).filter(u => u.active && u.role === 'Quản trị' && u.tg);
    for (const u of admins) { await telegramTo(x.env, u.tg, msg); if (file) await telegramFile(x.env, u.tg, file.b64, file.name, 'CV ' + a.name + ' – ' + a.job); }
    if (!admins.length) await telegram(x.env, '🧑‍💼 Có hồ sơ ứng tuyển mới (' + esc(a.job) + '). Chi tiết đã gửi email cho Quản trị.');
    const c = await tgConf(x.env);
    if (c.notify) await sendMail(x.env, { to: c.notify, subject: '🧑‍💼 Ứng tuyển ' + a.job + ' – ' + a.name, body: [
      'Vị trí: ' + a.job, 'Họ tên: ' + a.name + (a.birth ? ' (' + a.birth + ')' : ''), 'Điện thoại: ' + a.phone, 'Email: ' + a.email,
      'Nơi ở: ' + a.area, 'Kinh nghiệm: ' + a.exp, 'Thu nhập mong muốn: ' + a.salary, 'Có thể bắt đầu: ' + a.start,
      'Link CV: ' + (a.cv_link || '–') + (file ? '\nFile CV: ' + file.name + ' (đã gửi Telegram cho Quản trị)' : ''), 'Biết tin từ: ' + a.heard,
      ...QS.map(([k, q]) => '\n' + q + ':\n' + (ans[k] || '–')), '\nGửi lúc ' + fmtDate(now, 'HH:mm dd/MM/yyyy') + ' từ congsu.thucduonglanh.vn'].join('\n') });
  })());
  return { ok: true };
}
