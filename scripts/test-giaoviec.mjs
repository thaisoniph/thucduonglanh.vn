// ✅ Thử bot giao việc (api/src/giaoviec.js) trên máy, không gọi Telegram / AI thật: node scripts/test-giaoviec.mjs
// D1 giả bằng node:sqlite, Telegram giả bằng MOCK_GOOGLE (in ra console), AI giả bằng fetch trả JSON soạn sẵn.
import { DatabaseSync } from 'node:sqlite';
import { fileURLToPath } from 'node:url';
const ROOT = fileURLToPath(new URL('..', import.meta.url)).replace(/\/$/, '');
const G = await import('file://' + ROOT + '/api/src/giaoviec.js');

const raw = new DatabaseSync(':memory:');
const DB = { prepare(sql) { const st = raw.prepare(sql); let a = []; const o = { bind(...x) { a = x.map(v => v === undefined ? null : typeof v === 'boolean' ? (v ? 1 : 0) : v); return o; }, async all() { return { results: st.all(...a) }; }, async first() { return st.get(...a) || null; }, async run() { const r = st.run(...a); return { meta: { last_row_id: Number(r.lastInsertRowid), changes: r.changes } }; } }; return o; } };
raw.exec(`CREATE TABLE kv (k TEXT PRIMARY KEY, v TEXT, exp INTEGER); CREATE TABLE users (email TEXT, name TEXT, role TEXT, active INTEGER, tg TEXT, ord INTEGER);
INSERT INTO users VALUES ('thaisoniph@gmail.com','Thái Sơn','Quản trị',1,'100',0), ('thuy@x.vn','Nguyễn Thị Thủy','Quản lý',1,'',1), ('trang@x.vn','Lê Thu Trang','Kế toán',1,'300',2), ('ha@x.vn','Phạm Thu Hà','Marketing',1,'',3);`);

let aiReply = null; const sent = [];
const realFetch = globalThis.fetch;
globalThis.fetch = async (url, init) => {
  if (String(url).includes('anthropic')) return new Response(JSON.stringify({ id: 'm', type: 'message', role: 'assistant', model: 'claude-haiku-5-5', content: [{ type: 'text', text: JSON.stringify(aiReply) }], stop_reason: 'end_turn', usage: { input_tokens: 10, output_tokens: 10 } }), { headers: { 'content-type': 'application/json' } });
  return realFetch(url, init);
};
const origLog = console.log; console.log = (...a) => { if (a[0] === 'GV') sent.push(a.slice(1).join(' ')); else origLog(...a); };
const later = []; const x = { env: { DB, MOCK_GOOGLE: 1, ANTHROPIC_API_KEY: 'test' }, db: DB, later: p => later.push(p) };
const flush = async () => { while (later.length) await later.shift(); };
const users = { son: { email: 'thaisoniph@gmail.com', name: 'Thái Sơn', role: 'Quản trị', level: 3 }, thuy: { email: 'thuy@x.vn', name: 'Nguyễn Thị Thủy', role: 'Quản lý', level: 2 }, trang: { email: 'trang@x.vn', name: 'Lê Thu Trang', role: 'Kế toán', level: 0 }, ha: { email: 'ha@x.vn', name: 'Phạm Thu Hà', role: 'Marketing', level: 0 } };
let bad = 0; const ok = (c, m) => { origLog((c ? '✅ ' : '❌ ') + m); if (!c) bad++; };

// cài bot (giả): ghi thẳng cấu hình, vì gv_cfg gọi getMe thật
await DB.prepare("INSERT INTO kv (k, v) VALUES ('gv_cfg', ?)").bind(JSON.stringify({ token: '1:x', bot: 'tdl_giaoviec_bot', secret: 'abc', group: '-500', groupName: 'Phòng Marketing', leads: [] })).run();
const hook = body => G.gvRoute(x, new Request('https://api.thucduonglanh.vn/gv/tg/abc', { method: 'POST', headers: { 'X-Telegram-Bot-Api-Secret-Token': 'abc' }, body: JSON.stringify(body) }), '/gv/tg/abc').then(flush);

// 1. Hà (Marketing) chưa được giao việc cho người khác
let r = await G.crmGv(x, users.ha, { action: 'gv_save', title: 'Việc cho Trang', who: 'trang@x.vn', due: 0 });
ok(!r.ok, 'Marketing thường không giao được việc cho người khác');
r = await G.crmGv(x, users.ha, { action: 'gv_save', title: 'Làm báo cáo quảng cáo tuần', who: 'ha@x.vn', due: 0 });
ok(r.ok && r.gv.tasks.length === 1 && r.gv.tasks[0].st === 'Đang làm', 'Tự ghi việc cho mình → Đang làm');

// 2. anh Sơn giao Trang trong CRM, có giờ hạn ~50 phút nữa
sent.length = 0;
r = await G.crmGv(x, users.son, { action: 'gv_save', title: 'Gửi bảng lương tháng 11', who: 'trang@x.vn', due: Date.now() + 50 * 60e3, dueT: 1, tg: true });
const t2 = r.gv.tasks.find(t => t.title === 'Gửi bảng lương tháng 11');
ok(r.ok && t2 && t2.st === 'Mới' && r.sent >= 1, 'Anh Sơn giao Trang, gửi vào nhóm (' + r.sent + ' tin)');
ok(sent.some(s => s.includes('sendMessage') && s.includes('-500')), 'Tin việc vào nhóm -500 có nút');

// 3. Trang bấm ✋ Nhận việc (from.id 300 = users.tg)
const msg = (await DB.prepare('SELECT * FROM gv_msg WHERE task = ?').bind(t2.id).first());
sent.length = 0;
await hook({ callback_query: { id: 'q1', from: { id: 300 }, data: 'gv:nhan:' + t2.id } });
r = await G.crmGv(x, users.son, { action: 'gv_list' });
ok(r.gv.tasks.find(t => t.id === t2.id).st === 'Đang làm', 'Trang bấm Nhận việc → Đang làm');
ok(sent.some(s => s.includes('editMessageText')), 'Tin trong nhóm được sửa theo trạng thái');

// 4. Hà bấm nút Nhận của việc Trang → bị chặn (Hà chưa nối → báo nối)
sent.length = 0;
await hook({ callback_query: { id: 'q2', from: { id: 999 }, data: 'gv:nhan:' + t2.id } });
ok(sent.some(s => s.includes('answerCallbackQuery') && s.includes('chưa nối CRM')), 'Người lạ bấm nút → nhắc nối CRM');

// 5. nhắc trước 1 tiếng
sent.length = 0; await G.gvTick(x);
ok(sent.some(s => s.includes('Còn khoảng 1 tiếng')), 'Nhắc trước hạn 1 tiếng');
sent.length = 0; await G.gvTick(x);
ok(!sent.some(s => s.includes('Còn khoảng 1 tiếng')), 'Không nhắc lặp');

// 6. Trang trả lời tin việc "xong rồi https://drive…"
sent.length = 0;
await hook({ message: { message_id: 50, from: { id: 300 }, chat: { id: -500, type: 'supergroup' }, text: 'xong rồi ạ https://drive.google.com/abc', reply_to_message: { message_id: msg.msg } } });
r = await G.crmGv(x, users.son, { action: 'gv_list' });
const t2b = r.gv.tasks.find(t => t.id === t2.id);
ok(t2b.st === 'Xong' && /drive/.test(t2b.result), 'Trả lời "xong rồi + link" → Xong, lưu link kết quả');
ok(sent.some(s => s.includes('tg://user?id=100') && s.includes('Xong')), 'Báo anh Sơn việc đã xong (anh chưa Start bot mới → gắn tên anh trong nhóm)');

// 7. anh Sơn nhắn bot trong nhóm, AI tách 2 việc
aiReply = { loai: 'giao', viec: [{ nguoi: 'Thủy', viec: 'Chốt lịch livestream tuần sau', han: '2026-11-20 17:00', ghi_chu: '' }, { nguoi: 'Hà', viec: 'Viết 3 bài Tết cho DILVANG', han: '2026-11-21', ghi_chu: '' }], cap_nhat: [], tra_loi: '' };
sent.length = 0;
await hook({ message: { message_id: 60, from: { id: 100 }, chat: { id: -500, type: 'supergroup' }, text: '@tdl_giaoviec_bot giao Thủy chốt lịch livestream 17h thứ 5, Hà viết 3 bài Tết DILVANG hạn thứ 6' } });
r = await G.crmGv(x, users.son, { action: 'gv_list' });
const tt = r.gv.tasks.find(t => /livestream/.test(t.title)), th = r.gv.tasks.find(t => /Tết/.test(t.title));
ok(tt && tt.whoE === 'thuy@x.vn' && tt.dueT === 1 && th && th.whoE === 'ha@x.vn' && th.dueT === 0, 'AI giao 2 việc đúng người, đúng hạn');
ok(sent.filter(s => s.includes('sendMessage') && s.includes('Việc #')).length >= 2, 'Mỗi việc 1 tin trong nhóm');

// 8. tin thường trong nhóm (không gọi bot) → bỏ qua
sent.length = 0;
await hook({ message: { message_id: 61, from: { id: 300 }, chat: { id: -500, type: 'supergroup' }, text: 'mọi người ăn trưa chưa' } });
ok(sent.length === 0, 'Tin chuyện thường trong nhóm: bot im lặng');

// 9. nối riêng: Hà bấm Kết nối trong CRM → /start mã
r = await G.crmGv(x, users.ha, { action: 'gv_link' });
const code = r.url.split('start=')[1];
sent.length = 0;
await hook({ message: { message_id: 1, from: { id: 400 }, chat: { id: 400, type: 'private' }, text: '/start ' + code } });
r = await G.crmGv(x, users.ha, { action: 'gv_list' });
ok(r.gv.linked === 1 && sent.some(s => s.includes('Đã nối với CRM')), 'Hà nối Telegram riêng bằng mã');

// 10. Hà nhắn riêng "/viec"
sent.length = 0;
await hook({ message: { message_id: 2, from: { id: 400 }, chat: { id: 400, type: 'private' }, text: '/viec' } });
ok(sent.some(s => s.includes('Viết 3 bài Tết')), '/viec liệt kê việc của Hà');

// 11. Hà xin lùi hạn (không phải người giao) → chưa đổi hạn, báo anh Sơn duyệt
aiReply = { loai: 'cap_nhat', viec: [], cap_nhat: [{ id: th.id, trang_thai: '', han_moi: '2026-11-24', ket_qua: '', ghi_chu: 'cần thêm ảnh sản phẩm' }], tra_loi: '' };
sent.length = 0;
await hook({ message: { message_id: 3, from: { id: 400 }, chat: { id: 400, type: 'private' }, text: 'em xin lùi bài Tết sang thứ Hai vì chờ ảnh' } });
r = await G.crmGv(x, users.son, { action: 'gv_list' });
ok(r.gv.tasks.find(t => t.id === th.id).due === th.due && sent.some(s => s.includes('xin lùi hạn') && s.includes('tg://user?id=100')), 'Xin lùi hạn: giữ hạn cũ, báo người giao duyệt');

// 12. Quản trị cấp quyền giao việc cho Hà → Hà giao được Trang
await G.crmGv(x, users.son, { action: 'gv_cfg', leads: ['ha@x.vn'] });
r = await G.crmGv(x, users.ha, { action: 'gv_save', title: 'Duyệt chi phí quảng cáo', who: 'trang@x.vn', due: 0 });
ok(r.ok && r.gv.lead === 1, 'Sau khi được cấp quyền, Hà giao việc cho Trang được');

// 13. quá hạn + 8h sáng + thứ Hai
await DB.prepare('UPDATE gv_tasks SET due = ?, due_t = 1 WHERE id = ?').bind(Date.now() - 3600e3, tt.id).run();
sent.length = 0; await G.gvTick(x);
ok(sent.some(s => s.includes('đã quá hạn')), 'Báo quá hạn');
sent.length = 0; await G.gvMorning(x);
ok(sent.some(s => s.includes('Việc hôm nay')), 'Tin 8h sáng vào nhóm');
ok(sent.some(s => s.includes('"chat_id":"400"') && s.includes('Chào')), 'Tin 8h sáng riêng cho Hà');

// 14. Trang (Kế toán) xem được tab, chỉ thấy việc của mình / mình giao
r = await G.crmGv(x, users.trang, { action: 'gv_list' });
ok(r.ok && r.gv.tasks.every(t => t.whoE === 'trang@x.vn' || t.byE === 'trang@x.vn'), 'Kế toán chỉ thấy việc của mình');

// 15. sai mã bí mật → chặn
const bad403 = await G.gvRoute(x, new Request('https://api.thucduonglanh.vn/gv/tg/abc', { method: 'POST', headers: { 'X-Telegram-Bot-Api-Secret-Token': 'sai' }, body: '{}' }), '/gv/tg/abc');
ok(bad403 && bad403.status === 403, 'Tin giả mạo (sai mã bí mật) bị chặn');


// 16. 🎙 nhận việc từ biên bản họp (POST /gv/import)
x.env.GV_IMPORT_KEY = 'k-test-123';
raw.exec("INSERT INTO users VALUES ('ha2@x.vn','Trần Văn Hà','Sale',1,'',4)"); delete x._users; // thêm người trùng tên gọi "Hà"
const imp = (body, key) => G.gvRoute(x, new Request('https://api.thucduonglanh.vn/gv/import', { method: 'POST', headers: { 'Content-Type': 'application/json', 'x-gv-key': key }, body: JSON.stringify(body) }), '/gv/import');
let res = await imp({ src: 'hop', meeting: 'Họp sale (14/11)', tasks: [{ who: 'Trang', title: 'Gửi bảng lương nháp' }] }, 'sai');
ok(res.status === 401, 'Sai khoá → 401');
res = await imp({ src: 'hop', meeting: 'Họp sale (14/11)', tasks: [] });
ok(res.status === 401, 'Không có khoá → 401');
sent.length = 0;
res = await imp({ src: 'hop', meeting: 'Họp sale (14/11)', tasks: [
  { who: 'chị Trang', title: 'Gửi bảng lương nháp T11', body: 'Gửi anh Sơn xem trước', due: '2026-11-20' },
  { who: 'Nguyen Thi Thuy', title: 'Chốt lịch trực Chủ nhật', body: '', due: '' },
  { who: 'Hà', title: 'Làm 3 video Tết', body: '', due: '2026-11-22' },
  { who: 'Minh', title: 'Gọi lại nhà cung cấp', body: '', due: '' }] }, 'k-test-123');
let J = await res.json();
ok(res.status === 200 && J.ok && J.made.length === 2, 'Tạo 2 việc khớp tên (' + J.made.map(m => m.who).join(', ') + ')');
ok(J.made.some(m => m.who === 'Lê Thu Trang') && J.made.some(m => m.who === 'Nguyễn Thị Thủy'), 'Khớp tên gọi "chị Trang" và họ tên không dấu');
ok(J.unknown.indexOf('Hà') >= 0 && J.unknown.indexOf('Minh') >= 0, 'Trùng tên (2 người tên Hà) + tên lạ → unknown, không tạo');
r = await G.crmGv(x, users.son, { action: 'gv_list' });
const tl = r.gv.tasks.find(t => t.title === 'Gửi bảng lương nháp T11'), tc = r.gv.tasks.find(t => t.title === 'Chốt lịch trực Chủ nhật');
ok(tl && tl.src === 'hop' && tl.byE === 'thaisoniph@gmail.com' && /Từ cuộc họp: Họp sale \(14\/11\)/.test(tl.body), 'Người giao = anh Sơn, src hop, body có "Từ cuộc họp"');
const vn = new Date(tl.due + 7 * 3600e3);
ok(tl.dueT === 0 && vn.getUTCDate() === 20 && vn.getUTCHours() === 23 && vn.getUTCMinutes() === 59, 'Hạn = cuối ngày 20/11 (23:59 giờ VN)');
ok(tc && !tc.due, 'Hạn rỗng → không đặt hạn');
ok(sent.filter(s => s.includes('sendMessage') && s.includes('Việc #')).length >= 2, 'Gửi Telegram cho người làm như khi giao trong CRM');
res = await imp({ src: 'hop', meeting: 'Họp sale (14/11)', tasks: [{ who: 'Trang', title: 'Gửi bảng lương nháp T11', due: '2026-11-20' }] }, 'k-test-123');
J = await res.json();
ok(J.made.length === 0 && J.skipped.length === 1, 'Bot gửi lại lần 2 → không tạo trùng');

origLog('sai:', bad);
process.exit(bad ? 1 : 0);
