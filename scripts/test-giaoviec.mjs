// ✅ Thử Việc tuần (api/src/giaoviec.js) trên máy, không gọi Telegram / AI / Notion thật: node scripts/test-giaoviec.mjs
// D1 giả bằng node:sqlite, Telegram giả bằng MOCK_GOOGLE (in ra console), AI + Notion giả bằng fetch trả JSON soạn sẵn.
import { DatabaseSync } from 'node:sqlite';
import { fileURLToPath } from 'node:url';
const ROOT = fileURLToPath(new URL('..', import.meta.url)).replace(/\/$/, '');
const G = await import('file://' + ROOT + '/api/src/giaoviec.js');

const raw = new DatabaseSync(':memory:');
const DB = { prepare(sql) { const st = raw.prepare(sql); let a = []; const o = { bind(...x) { a = x.map(v => v === undefined ? null : typeof v === 'boolean' ? (v ? 1 : 0) : v); return o; }, async all() { return { results: st.all(...a) }; }, async first() { return st.get(...a) || null; }, async run() { const r = st.run(...a); return { meta: { last_row_id: Number(r.lastInsertRowid), changes: r.changes } }; } }; return o; } };
raw.exec(`CREATE TABLE kv (k TEXT PRIMARY KEY, v TEXT, exp INTEGER); CREATE TABLE users (email TEXT, name TEXT, role TEXT, active INTEGER, tg TEXT, ord INTEGER, full TEXT);
INSERT INTO users VALUES ('thaisoniph@gmail.com','Thái Sơn','Quản trị',1,'100',0,'Đinh Minh Thái Sơn'), ('thuy@x.vn','Nguyễn Thị Thủy','Quản lý',1,'',1,'Nguyễn Thị Thu Thủy'), ('trang@x.vn','Lê Thu Trang','Kế toán',1,'300',2,'Nguyễn Thị Kiều Trang'), ('ha@x.vn','Phạm Thu Hà','Marketing',1,'',3,'');`);

let aiReply = null; const sent = [], notionCalls = [];
const realFetch = globalThis.fetch;
const JR = (o, st) => new Response(JSON.stringify(o), { status: st || 200, headers: { 'content-type': 'application/json' } });
globalThis.fetch = async (url, init) => {
  const u = String(url);
  if (u.includes('anthropic')) return JR({ id: 'm', type: 'message', role: 'assistant', model: 'claude-haiku-5-5', content: [{ type: 'text', text: JSON.stringify(aiReply) }], stop_reason: 'end_turn', usage: { input_tokens: 10, output_tokens: 10 } });
  if (u.includes('api.notion.com')) {
    notionCalls.push({ url: u, method: init.method, body: init.body ? JSON.parse(init.body) : null });
    if (/databases\//.test(u)) return JR({ title: [{ plain_text: 'VitaGreen TDL. Công việc & Mục tiêu tuần' }], properties: { 'Nhân sự thực hiện': { select: { options: [{ name: 'Marketing — Phạm Thu Hà' }, { name: 'Kế toán — Nguyễn Thị Kiều Trang' }, { name: 'Quản lý — Nguyễn Thị Thu Thủy' }] } }, 'Bộ phận': { select: { options: [{ name: 'Marketing' }, { name: 'Kế toán' }, { name: 'Quản lý' }] } } } });
    if (/\/users/.test(u)) return JR({ results: [{ id: 'nu-ha', type: 'person', person: { email: 'ha@x.vn' } }, { id: 'nu-trang', type: 'person', person: { email: 'trang@x.vn' } }], has_more: false });
    if (/\/pages$/.test(u)) return JR({ id: 'page-' + notionCalls.length });
    return JR({ id: 'ok' });
  }
  return realFetch(url, init);
};
const origLog = console.log; console.log = (...a) => { if (a[0] === 'GV') sent.push(a.slice(1).join(' ')); else origLog(...a); };
const later = []; const x = { env: { DB, MOCK_GOOGLE: 1, ANTHROPIC_API_KEY: 'test' }, db: DB, later: p => later.push(p) };
const flush = async () => { while (later.length) await later.shift(); };
const users = { son: { email: 'thaisoniph@gmail.com', name: 'Thái Sơn', role: 'Quản trị', level: 3 }, thuy: { email: 'thuy@x.vn', name: 'Nguyễn Thị Thủy', role: 'Quản lý', level: 2 }, trang: { email: 'trang@x.vn', name: 'Lê Thu Trang', role: 'Kế toán', level: 0 }, ha: { email: 'ha@x.vn', name: 'Phạm Thu Hà', role: 'Marketing', level: 0 } };
let bad = 0; const ok = (c, m) => { origLog((c ? '✅ ' : '❌ ') + m); if (!c) bad++; };
const DAY = 864e5, W = G.weekOf(Date.now()), at = (d, h, m) => W + d * DAY + (h * 60 + (m || 0)) * 60e3 - 7 * 3600e3 + 7 * 3600e3; // W = thứ Hai 0h VN (ms UTC) → cộng ngày + giờ VN
const tick = t => G.gvTick(x, t);
const lastAnswer = () => sent.filter(s => s.startsWith('answerCallbackQuery')).pop() || '';

await DB.prepare("INSERT INTO kv (k, v) VALUES ('gv_cfg', ?)").bind(JSON.stringify({ token: '1:x', bot: 'tdl_cunglam_bot', secret: 'abc', group: '-500', groupName: 'Nhà Lành · Cùng làm', leads: [] })).run();
await DB.prepare("INSERT INTO kv (k, v) VALUES ('gv_tg_thaisoniph@gmail.com', '100')").run(); // anh Sơn đã bấm Start với bot mới
const hook = body => G.gvRoute(x, new Request('https://api.thucduonglanh.vn/gv/tg/abc', { method: 'POST', headers: { 'X-Telegram-Bot-Api-Secret-Token': 'abc' }, body: JSON.stringify(body) }), '/gv/tg/abc').then(flush);
const find = async (who, re) => (await G.crmGv(x, users.son, { action: 'gv_list' })).gv.tasks.find(t => re.test(t.title));

// 1. bắt buộc "Thế nào là xong"; việc trọng tâm mơ hồ → AI gợi ý viết lại
let r = await G.crmGv(x, users.ha, { action: 'gv_save', kind: 'tt', title: 'Làm video Tết', goal: '', who: 'ha@x.vn' }).catch(e => ({ ok: false, error: e.message }));
ok(!r.ok && /Thế nào là xong/.test(r.error), 'Thiếu "Thế nào là xong" → không lưu');
aiReply = { do_duoc: false, vi_sao: 'Chưa rõ bao nhiêu video, đăng ở đâu.', goi_y: 'Đăng 3 video Tết trà DILVANG lên TikTok, có tiêu đề + ảnh bìa' };
r = await G.crmGv(x, users.ha, { action: 'gv_save', kind: 'tt', title: 'Làm video Tết', goal: 'hoàn thành video', who: 'ha@x.vn' });
ok(!r.ok && r.needFix && /3 video/.test(r.goal), 'Trọng tâm mơ hồ → AI gợi ý "' + r.goal + '"');
r = await G.crmGv(x, users.ha, { action: 'gv_save', kind: 'tt', title: 'Làm video Tết', goal: r.goal, who: 'ha@x.vn' });
ok(r.ok && r.gv.tasks[0].kind === 'tt' && r.gv.tasks[0].st === 'Đang làm', 'Dùng câu gợi ý (có con số) → lưu, tự đặt nên Đang làm');
// 2. tối đa 3 việc trọng tâm
await G.crmGv(x, users.ha, { action: 'gv_save', kind: 'tt', title: 'Báo cáo quảng cáo tuần', goal: '1 file Sheet chi phí + số khách 7 ngày', who: 'ha@x.vn' });
await G.crmGv(x, users.ha, { action: 'gv_save', kind: 'tt', title: 'Viết 5 bài Fanpage', goal: '5 bài đã đăng trên Fanpage', who: 'ha@x.vn' });
r = await G.crmGv(x, users.ha, { action: 'gv_save', kind: 'tt', title: 'Việc thứ tư', goal: '4 việc cùng lúc', who: 'ha@x.vn' });
ok(!r.ok && /đã có 3 việc trọng tâm/.test(r.error), 'Việc trọng tâm thứ 4 → chặn, gợi ý dừng bớt hoặc ghi phát sinh');
r = await G.crmGv(x, users.ha, { action: 'gv_save', kind: 'ps', title: 'Việc thứ tư', goal: 'gửi 1 ảnh mẫu', who: 'ha@x.vn' });
ok(r.ok, 'Ghi là việc phát sinh thì được');
// 3. ai cũng nhờ được ai (phát sinh); trọng tâm của người khác thì không
r = await G.crmGv(x, users.ha, { action: 'gv_save', kind: 'tt', title: 'Trang làm gì đó', goal: '1 file báo cáo', who: 'trang@x.vn' });
ok(!r.ok && /tự chốt hoặc Quản lý/.test(r.error), 'Hà không đặt việc trọng tâm cho Trang');
r = await G.crmGv(x, users.ha, { action: 'gv_save', kind: 'ps', title: 'Gửi số chi quảng cáo tháng 10', goal: '1 con số tổng chi T10', who: 'trang@x.vn' });
ok(r.ok, 'Hà nhờ Trang 1 việc phát sinh được');

// 4. anh Sơn đặt việc trọng tâm cho Trang, hạn ~50 phút nữa
sent.length = 0;
r = await G.crmGv(x, users.son, { action: 'gv_save', kind: 'tt', title: 'Gửi bảng lương tháng 11', goal: 'Bảng lương 12 người trong 1 file Sheet', who: 'trang@x.vn', due: Date.now() + 50 * 60e3, dueT: 1, tg: true });
const t2 = r.gv.tasks.find(t => t.title === 'Gửi bảng lương tháng 11');
ok(r.ok && t2.st === 'Mới' && sent.some(s => s.includes('-500') && s.includes('Việc trọng tâm')), 'Tin việc ⭐ vào nhóm, có "Thế nào là xong"');
const msg = await DB.prepare('SELECT * FROM gv_msg WHERE task = ? AND chat = ?').bind(t2.id, '-500').first();
await hook({ callback_query: { id: 'q1', from: { id: 300 }, data: 'gv:nhan:' + t2.id } });
ok((await find(0, /bảng lương tháng 11/)).st === 'Đang làm', 'Trang bấm 🙋 Mình nhận → Đang làm');
// 5. ✅ Xong khi chưa có minh chứng → không cho
sent.length = 0;
await hook({ callback_query: { id: 'q2', from: { id: 300 }, data: 'gv:xong:' + t2.id } });
ok((await find(0, /bảng lương tháng 11/)).st === 'Đang làm' && /minh chứng/.test(lastAnswer()), 'Bấm Xong khi thiếu kết quả + minh chứng → nhắc gửi, chưa ghi Xong');
// 6. nhắc trước 1 tiếng
sent.length = 0; await tick();
ok(sent.some(s => s.includes('Còn khoảng 1 tiếng')), 'Nhắc trước hạn 1 tiếng');
// 7. trả lời tin việc "xong + kết quả + link"
sent.length = 0;
await hook({ message: { message_id: 50, from: { id: 300 }, chat: { id: -500, type: 'supergroup' }, text: 'xong rồi ạ, bảng lương 12 người https://docs.google.com/spreadsheets/abc', reply_to_message: { message_id: msg.msg } } });
const t2b = await find(0, /bảng lương tháng 11/);
ok(t2b.st === 'Xong' && /12 người/.test(t2b.result) && /docs.google/.test(t2b.proof), 'Trả lời "xong, kết quả + link" → Xong, tách kết quả + minh chứng');
ok(sent.some(s => s.includes('-500') && s.includes('Cảm ơn')), 'Bot cảm ơn trong nhóm');
ok(sent.some(s => s.includes('"chat_id":"100"') && s.includes('Xong rồi')), 'Báo riêng anh Sơn (người nhờ)');

// 8. nhắn bot trong nhóm, AI tách việc trọng tâm + phát sinh
aiReply = { loai: 'giao', viec: [{ nguoi: 'Thủy', viec: 'Chốt lịch livestream tuần sau', xong_la: 'Lịch 3 buổi live có giờ + người dẫn', trong_tam: true, han: '2026-11-20 17:00' }, { nguoi: 'Hà', viec: 'Gửi ảnh bìa video', xong_la: '3 ảnh bìa', trong_tam: true, han: '' }], cap_nhat: [], tra_loi: '' };
sent.length = 0;
await hook({ message: { message_id: 60, from: { id: 100 }, chat: { id: -500, type: 'supergroup' }, text: '@tdl_cunglam_bot trọng tâm: Thủy chốt lịch livestream 17h thứ 6, Hà gửi ảnh bìa' } });
const tt = await find(0, /livestream/), th = await find(0, /ảnh bìa/);
ok(tt && tt.kind === 'tt' && tt.goal && tt.dueT === 1, 'AI: Thủy nhận việc ⭐ có "Thế nào là xong" + giờ hạn');
ok(th && th.kind === 'ps' && sent.some(s => s.includes('đã có 3 việc trọng tâm')), 'Hà đã đủ 3 việc ⭐ → bot ghi việc này là phát sinh và báo lý do');
sent.length = 0;
await hook({ message: { message_id: 61, from: { id: 300 }, chat: { id: -500, type: 'supergroup' }, text: 'mọi người ăn trưa chưa' } });
ok(sent.length === 0, 'Chuyện thường trong nhóm: bot im lặng');

// 9. Hà nối riêng
r = await G.crmGv(x, users.ha, { action: 'gv_link' });
await hook({ message: { message_id: 1, from: { id: 400 }, chat: { id: 400, type: 'private' }, text: '/start ' + r.url.split('start=')[1] } });
ok((await G.crmGv(x, users.ha, { action: 'gv_list' })).gv.linked === 1, 'Hà nối Telegram riêng bằng mã');

// 10. nhịp tuần
sent.length = 0; await tick(at(0, 20, 5));
ok(sent.some(s => s.includes('-500') && s.includes('Tuần mới') && s.includes('tg://user?id=300')), 'Thứ Hai 20h: người chưa nối bot riêng được gắn tên chung 1 tin trong nhóm');
ok(!sent.some(s => s.includes('"chat_id":"400"') && s.includes('Tuần mới')), 'Hà đã đủ 3 việc ⭐ → không bị nhắc');
sent.length = 0; await tick(at(1, 9, 5));
ok(sent.some(s => s.includes('"chat_id":"100"') && s.includes('chưa chốt việc trọng tâm') && s.includes('Lê Thu Trang') === false), '9h thứ Ba: Quản lý nhận danh sách người chưa chốt');
sent.length = 0; await tick(at(3, 19, 5));
const paceMsg = sent.filter(s => s.includes('"chat_id":"400"') && s.includes('Cập nhật tiến độ'));
ok(paceMsg.length === 3, '19h thứ Năm: Hà nhận 3 tin hỏi tiến độ (mỗi việc ⭐ 1 tin, có 3 nút)');
const tVid = await find(0, /video Tết/);
await hook({ callback_query: { id: 'q3', from: { id: 400 }, data: 'gv:help:' + tVid.id } });
const pm = await DB.prepare("SELECT msg FROM gv_msg WHERE task = ? AND chat = '400' ORDER BY at DESC").bind(tVid.id).first();
aiReply = { loai: 'cap_nhat', viec: [], cap_nhat: [{ id: tVid.id, tien_do: 'help', buoc_tiep: 'Đã quay 2/3 video, còn 1 video', vuong: 'Cần Thu gửi ảnh sản phẩm trước thứ Sáu', trang_thai: '' }], tra_loi: '' };
await hook({ message: { message_id: 2, from: { id: 400 }, chat: { id: 400, type: 'private' }, text: 'đã quay 2/3 video, cần Thu gửi ảnh sản phẩm trước thứ 6', reply_to_message: { message_id: pm.msg } } });
const tVid2 = await find(0, /video Tết/);
ok(tVid2.pace === 'help' && /2\/3/.test(tVid2.next) && /ảnh sản phẩm/.test(tVid2.block), 'Hà bấm 🔴 + trả lời 1 câu → lưu tiến độ, bước tiếp, cần hỗ trợ');
sent.length = 0; await tick(at(3, 21, 5));
ok(sent.some(s => s.includes('"chat_id":"100"') && s.includes('Cần mình hỗ trợ') && s.includes('video Tết')), '21h thứ Năm: anh Sơn thấy việc cần hỗ trợ');
sent.length = 0; await tick(at(6, 19, 5));
const resMsg = sent.filter(s => s.includes('"chat_id":"400"') && s.includes('Chốt kết quả tuần'));
ok(resMsg.length === 3, '19h Chủ nhật: Hà nhận 3 tin chốt kết quả');
const rm = await DB.prepare("SELECT msg FROM gv_msg WHERE task = ? AND chat = '400' ORDER BY at DESC").bind(tVid.id).first();
await hook({ message: { message_id: 3, from: { id: 400 }, chat: { id: 400, type: 'private' }, photo: [{ file_id: 'small' }, { file_id: 'BIG' }], caption: '', reply_to_message: { message_id: rm.msg } } });
await hook({ message: { message_id: 4, from: { id: 400 }, chat: { id: 400, type: 'private' }, text: 'xong, đã đăng 3 video Tết', reply_to_message: { message_id: rm.msg } } });
const tVid3 = await find(0, /video Tết/);
ok(tVid3.st === 'Xong' && tVid3.proofTg === 1 && /\/gv\/f\//.test(tVid3.proof) && /3 video/.test(tVid3.result), 'Gửi ảnh rồi "xong, kết quả" → Xong, minh chứng là ảnh Telegram (có link mở)');
const fr = await G.gvRoute(x, new Request('https://api.thucduonglanh.vn' + new URL(tVid3.proof).pathname.replace(/[a-f0-9]{12}$/, '000000000000')), new URL(tVid3.proof).pathname.replace(/[a-f0-9]{12}$/, '000000000000'));
ok(fr && fr.status === 403, 'Link file minh chứng sai mã → chặn');
const tRep = await find(0, /Báo cáo quảng cáo/);
await hook({ callback_query: { id: 'q4', from: { id: 400 }, data: 'gv:carry:' + tRep.id } });
sent.length = 0; await tick(at(6, 21, 5));
ok(sent.some(s => s.includes('"chat_id":"100"') && s.includes('21h Chủ nhật')), '21h Chủ nhật: anh Sơn nhận tổng tuần');

// 11. báo cáo họp thứ Hai
r = await G.crmGv(x, users.son, { action: 'gv_rep', week: W });
const pHa = r.rep.people.find(p => p.email === 'ha@x.vn'), pTr = r.rep.people.find(p => p.email === 'trang@x.vn');
ok(pHa.n === 3 && pHa.done === 1 && pTr.n === 1 && pTr.done === 1 && pTr.ontime === 1, 'Báo cáo tuần: Hà xong 1/3, Trang xong 1/1 đúng hạn');
ok(/Cam kết/.test(pHa.text) && /Thực tế/.test(pHa.text), 'Có bài nói theo công thức họp (Cam kết → Thực tế → minh chứng)');
r = await G.crmGv(x, users.trang, { action: 'gv_rep', week: W });
ok(r.rep.people.length === 1 && r.rep.people[0].email === 'trang@x.vn', 'Nhân sự chỉ xem báo cáo của mình');
sent.length = 0; await tick(at(7, 7, 5));
const tRep2 = await find(0, /Báo cáo quảng cáo/);
ok(tRep2.carry === 1, '7h thứ Hai: việc chưa xong chuyển tuần (đếm lần chuyển)');
ok(sent.some(s => s.includes('"chat_id":"400"') && s.includes('Báo cáo tuần') && s.includes('Chuyển tuần')), 'Hà nhận bài báo cáo cho buổi họp');
ok(sent.some(s => s.includes('-500') && s.includes('Nhà Lành cùng xong')), 'Nhóm nhận lời cảm ơn cả tuần');
r = await G.crmGv(x, users.son, { action: 'gv_rep', week: W + 7 * DAY });
ok(r.rep.people.find(p => p.email === 'ha@x.vn').n === 2, 'Tuần mới: việc chuyển sang được tính cho tuần mới (Hà 2 việc ⭐)');

// 12. Notion song song
const C0 = JSON.parse((await DB.prepare("SELECT v FROM kv WHERE k = 'gv_cfg'").first()).v); C0.notion = { token: 'ntn_test', db: 'bc08' }; await DB.prepare("UPDATE kv SET v = ? WHERE k = 'gv_cfg'").bind(JSON.stringify(C0)).run();
notionCalls.length = 0; await G.gvNotionTick(x, C0, 50);
const posts = notionCalls.filter(c => c.method === 'POST');
const pVid = posts.find(c => /video Tết/.test(c.body.properties['Đầu việc / Kết quả'].title[0].text.content));
ok(posts.length >= 8, 'Đẩy ' + posts.length + ' việc sang bảng Notion');
ok(pVid && pVid.body.properties['Nhân sự thực hiện'].select.name === 'Marketing — Phạm Thu Hà' && pVid.body.properties['Bộ phận'].select.name === 'Marketing' && pVid.body.properties['Người phụ trách chính'].people[0].id === 'nu-ha', 'Notion: đúng Nhân sự thực hiện, Bộ phận, Người phụ trách chính');
ok(pVid.body.properties['Trạng thái'].status.name === 'Hoàn thành' && pVid.body.properties['Loại việc'].select.name === 'Cam kết đầu tuần' && /\/gv\/f\//.test(pVid.body.properties['Minh chứng'].url) && pVid.body.properties['Ngày hoàn thành thực tế'].date, 'Notion: Hoàn thành + Cam kết đầu tuần + Minh chứng + Ngày hoàn thành');
const pTrg = posts.find(c => /bảng lương tháng 11/.test(c.body.properties['Đầu việc / Kết quả'].title[0].text.content));
ok(pTrg && pTrg.body.properties['Nhân sự thực hiện'].select.name === 'Kế toán — Nguyễn Thị Kiều Trang', 'Notion: khớp Trang theo họ tên đầy đủ trong CRM');
notionCalls.length = 0; await G.crmGv(x, users.son, { action: 'gv_set', id: tRep.id, pace: 'ok', next: 'Xong 50%' }); await G.gvNotionTick(x, C0, 50);
ok(notionCalls.length === 1 && notionCalls[0].method === 'PATCH', 'Sửa 1 việc → chỉ cập nhật đúng 1 trang Notion');

// 13. quyền, giả mạo
r = await G.crmGv(x, users.trang, { action: 'gv_list' });
ok(r.ok && r.gv.tasks.every(t => t.whoE === 'trang@x.vn' || t.byE === 'trang@x.vn' || t.helpers.indexOf('trang@x.vn') >= 0), 'Kế toán chỉ thấy việc của mình / mình nhờ / cùng làm');
const bad403 = await G.gvRoute(x, new Request('https://api.thucduonglanh.vn/gv/tg/abc', { method: 'POST', headers: { 'X-Telegram-Bot-Api-Secret-Token': 'sai' }, body: '{}' }), '/gv/tg/abc');
ok(bad403 && bad403.status === 403, 'Tin giả mạo (sai mã bí mật) bị chặn');

// 16. 🎙 nhận việc từ biên bản họp (POST /gv/import)
x.env.GV_IMPORT_KEY = 'k-test-123';
raw.exec("INSERT INTO users VALUES ('ha2@x.vn','Trần Văn Hà','Sale',1,'',4,'')"); delete x._users; // thêm người trùng tên gọi "Hà"
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
