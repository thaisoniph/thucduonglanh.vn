// 🧑‍💼 Thử Tuyển dụng (api/src/hr.js + apply.js) trên máy, không gửi email / Telegram / AI thật: node scripts/test-hr.mjs [thư-mục-lưu-html]
// D1 giả bằng node:sqlite, email + Telegram giả bằng MOCK_GOOGLE (lưu kv mock_mail_*), AI giả bằng fetch trả JSON soạn sẵn, trang congsu giả.
import { DatabaseSync } from 'node:sqlite';
import { fileURLToPath } from 'node:url';
import { writeFileSync, mkdirSync } from 'node:fs';
const ROOT = fileURLToPath(new URL('..', import.meta.url)).replace(/\/$/, '');
const OUT = process.argv[2] || '';
const raw = new DatabaseSync(':memory:');
const DB = { prepare(sql) { const st = raw.prepare(sql); let a = []; const o = { bind(...x) { a = x.map(v => v === undefined ? null : typeof v === 'boolean' ? (v ? 1 : 0) : v); return o; }, async all() { return { results: st.all(...a) }; }, async first() { return st.get(...a) || null; }, async run() { const r = st.run(...a); return { meta: { last_row_id: Number(r.lastInsertRowid), changes: r.changes } }; } }; return o; } };
raw.exec(`CREATE TABLE kv (k TEXT PRIMARY KEY, v TEXT, exp INTEGER); CREATE TABLE users (email TEXT PRIMARY KEY, name TEXT, role TEXT, active INTEGER, recv TEXT DEFAULT '', tg TEXT DEFAULT '', alias TEXT DEFAULT '', prefix TEXT DEFAULT '', ord INTEGER, web TEXT DEFAULT '', mkv TEXT DEFAULT '', zb TEXT DEFAULT '', kho TEXT DEFAULT '', phone TEXT DEFAULT '', full TEXT DEFAULT '', acct TEXT DEFAULT '', joined TEXT DEFAULT '', dob TEXT DEFAULT '', ctv TEXT DEFAULT '');
INSERT INTO users (email, name, role, active, ord, full) VALUES ('thaisoniph@gmail.com','Thái Sơn','Quản trị',1,0,'Đinh Minh Thái Sơn'), ('thuy@x.vn','Thu Thủy','Quản lý',1,1,'Nguyễn Thị Thu Thủy'), ('myanh@x.vn','Mỹ Anh','Sale & CSKH',1,2,'');
CREATE TABLE logs (time INTEGER, who TEXT, what TEXT, ref TEXT, name TEXT, result TEXT, note TEXT);`);
let aiCalls = 0, aiBody = null; const ntCalls = [];
const T = s => ({ type: 'text', plain_text: s, text: { content: s } });
const NT_ROWS = [
  { id: 'pg-thuy', created_time: '2026-09-01T00:00:00Z', properties: { 'Họ tên': { title: [T('Nguyễn Thị Thu Thủy')] }, 'Email': { email: null }, 'Số điện thoại': { phone_number: '0912 000 101' }, 'Ngày sinh': { date: { start: '1990-11-18' } }, 'Ngày bắt đầu': { date: { start: '2023-11-01' } }, 'Vai trò': { rich_text: [T('Quản lý kinh doanh')] }, 'Bộ phận': { select: { name: 'Quản lý' } }, 'Trạng thái': { status: { name: 'Đang làm' } }, 'Điểm mạnh': { rich_text: [T('Giữ đội ổn định')] }, 'Tài khoản ngân hàng': { rich_text: [T('VCB – 0011 0022 33 – CN Long Biên')] } } },
  { id: 'pg-co-van', created_time: '2026-09-01T00:00:00Z', properties: { 'Họ tên': { title: [T('Trần Cố Vấn')] }, 'Trạng thái': { status: { name: 'Cố vấn/Đối tác' } }, 'Vai trò': { rich_text: [T('Cố vấn')] } } }
];
const realFetch = globalThis.fetch;
const JR = o => new Response(JSON.stringify(o), { headers: { 'content-type': 'application/json' } });
globalThis.fetch = async (url, init) => {
  const u = String(url);
  if (u.includes('anthropic')) { aiCalls++; aiBody = JSON.parse(init.body); return JR({ id: 'm', type: 'message', role: 'assistant', model: 'claude-sonnet-5-5', content: [{ type: 'text', text: JSON.stringify({ score: 82, rank: 'A', sum: 'Có 6 năm làm marketing ngành thực phẩm, từng dẫn đội 5 người, khớp phần lớn yêu cầu.', why: ['6 năm marketing FMCG', 'Đã chạy quảng cáo Facebook ngân sách lớn', 'Câu trả lời về văn hoá chân thành'], good: ['Dẫn đội', 'Số liệu rõ'], risk: ['Chưa làm thương hiệu sức khoẻ'], ask: ['Kể 1 chiến dịch thất bại', 'Bạn đo hiệu quả thế nào', 'Vì sao rời công ty cũ', 'Bạn dùng AI ra sao', 'Mong muốn 1 năm tới'], cv: 'Marketing 6 năm tại 2 công ty thực phẩm.' }) }], stop_reason: 'end_turn', usage: { input_tokens: 4000, output_tokens: 600 } }); }
  if (u === 'https://congsu.thucduonglanh.vn/') return new Response('<a class="fw-chip" href="/truong-phong-marketing/">Vị trí Trưởng phòng Marketing</a>');
  if (u.includes('congsu.thucduonglanh.vn/truong-phong-marketing')) return new Response('<html><header>menu</header><main><h1>Trưởng phòng Marketing</h1><p>Yêu cầu: 5 năm kinh nghiệm marketing, dẫn đội.</p></main></html>');
  if (u.includes('api.telegram.org')) return JR({ ok: true });
  if (u.includes('api.notion.com')) { // Notion giả: 2 bảng, ghi lại mọi lần tạo / sửa trang
    const b = init && init.body ? JSON.parse(init.body) : null; ntCalls.push({ m: init.method, u, b });
    if (/databases\/[a-f0-9]+\/query/.test(u)) return JR({ results: /584ef1e1/.test(u) ? NT_ROWS : [], has_more: false });
    if (/databases\//.test(u)) return JR({ id: 'db' });
    if (/pages$/.test(u)) return JR({ id: 'new-' + ntCalls.length });
    return JR({ id: 'ok' });
  }
  return realFetch(url, init);
};
const tg = []; const origLog = console.log; console.log = (...a) => { if (a[0] === 'TG' || a[0] === 'MAIL') tg.push(a.join(' ')); else origLog(...a); };
const later = []; const env = { DB, MOCK_GOOGLE: 1, ANTHROPIC_API_KEY: 'test', TELEGRAM_TOKEN: '1:x', NOTIFY_EMAIL: 'notify@x.vn' };
const x = { env, db: DB, later: p => later.push(p), ip: '1.2.3.4' };
const flush = async () => { while (later.length) await later.shift(); };
const H = await import('file://' + ROOT + '/api/src/hr.js');
const AP = await import('file://' + ROOT + '/api/src/apply.js');
let bad = 0; const ok = (c, m) => { origLog((c ? '✅ ' : '❌ ') + m); if (!c) bad++; };
const son = { email: 'thaisoniph@gmail.com', name: 'Thái Sơn', role: 'Quản trị', level: 3 }, thuy = { email: 'thuy@x.vn', name: 'Nguyễn Thị Thủy', role: 'Quản lý', level: 2 }, sale = { email: 's@x.vn', name: 'Hà', role: 'Sale & CSKH', level: 1 }, kt = { email: 'kt@x.vn', name: 'Trang', role: 'Kế toán', level: 0 };
const users = [Object.assign({ active: true, tg: '100' }, son), Object.assign({ active: true, tg: '200' }, thuy)];
const log = async () => { };
const mails = async () => (await DB.prepare("SELECT v FROM kv WHERE k LIKE 'mock_mail_%' ORDER BY k").bind().all()).results.map(r => JSON.parse(r.v)).filter(m => m.to === 'an@example.com'); // bỏ email báo hồ sơ mới cho hộp thư công ty

// 1. ứng viên nộp hồ sơ có file PDF
const pdf = Buffer.from('%PDF-1.4 giả').toString('base64');
const ap = await AP.apply(x, { job: 'Trưởng phòng Marketing', name: 'Trần Văn An', phone: '0912345678', email: 'an@example.com', consent: 1, exp: '6 năm', salary: '20 triệu', why: 'Muốn làm thương hiệu tử tế', q: { r1: 'b', r2: 'c' }, file: { name: 'CV An.pdf', data: 'data:application/pdf;base64,' + pdf } });
await flush();
ok(ap.ok, 'Nộp hồ sơ thành công');
let row = await DB.prepare('SELECT * FROM applicants').bind().first();
ok(row && row.tok && row.tok.length === 24, 'Có mã link trả lời 24 ký tự');
ok(!!(await DB.prepare('SELECT 1 FROM hr_cv WHERE id = ?').bind(row.id).first()), 'Giữ file CV cho AI đọc');

// 2. quyền
ok(!(await H.crmHr(x, sale, { op: 'list' }, log)).ok, 'Sale không xem được');
ok(!(await H.crmHr(x, kt, { op: 'list' }, log)).ok, 'Kế toán không xem được');
ok((await H.crmHr(x, thuy, { op: 'list' }, log)).ok, 'Quản lý xem được');

// 3. cron: AI chấm
await H.hrTick(x, users);
row = await DB.prepare('SELECT * FROM applicants').bind().first();
ok(row.ai_score === 82 && aiCalls === 1, 'Cron: AI chấm 82%');
ok(aiBody.messages[0].content[0].type === 'document', 'AI nhận file PDF');
ok(/5 năm kinh nghiệm/.test(aiBody.messages[0].content[1].text) && !/menu/.test(aiBody.messages[0].content[1].text), 'AI nhận mô tả công việc từ congsu (bỏ menu)');
ok(tg.some(t => /AI đã đọc hồ sơ/.test(t) && /TG 100/.test(t)) && !tg.some(t => /AI đã đọc/.test(t) && /TG 200/.test(t)), 'Telegram báo Quản trị, không báo Quản lý');
await H.hrTick(x, users); ok(aiCalls === 1, 'Không chấm lại hồ sơ đã chấm');

let L = await H.crmHr(x, thuy, { op: 'list' }, log), r = L.rows[0];
ok(r.ai.rank === 'A' && r.cv && r.st === 'Mới' && r.quiz != null, 'Danh sách có điểm AI, trắc nghiệm, file CV');
ok((await H.crmHr(x, thuy, { op: 'cv', id: r.id }, log)).b64 === pdf, 'Tải lại được file CV');

// 4. hẹn phỏng vấn
const ivAt = Date.now() + 2 * 864e5;
const pv = await H.crmHr(x, thuy, { op: 'prev', kind: 'iv', id: r.id, at: ivAt, mode: 'Tại văn phòng', place: 'Văn phòng Ocean Park', by: 'Chị Thủy' }, log);
ok(pv.ok && /Thư mời phỏng vấn/.test(pv.html) && (await mails()).length === 0, 'Xem trước thư phỏng vấn, chưa gửi');
ok(!(await H.crmHr(x, thuy, { op: 'iv', id: r.id, at: Date.now() - 864e5, place: 'x', send: 1 }, log)).ok, 'Chặn hẹn vào ngày đã qua');
L = await H.crmHr(x, thuy, { op: 'iv', id: r.id, at: ivAt, mode: 'Tại văn phòng', place: 'Văn phòng Ocean Park', by: 'Chị Thủy – Quản lý', note: 'Mang CV bản in', send: 1 }, log);
let M = await mails();
ok(L.sent && M.length === 1 && M[0].to === 'an@example.com' && M[0].htmlBody && /\/tm\/[a-f0-9]{24}/.test(M[0].body) && M[0].replyTo === 'notify@x.vn', 'Gửi email mời (HTML + chữ thường + link + nhận trả lời)');
ok(L.rows[0].st === 'Hẹn phỏng vấn', 'Chuyển sang Hẹn phỏng vấn');
if (OUT) { mkdirSync(OUT, { recursive: true }); writeFileSync(OUT + '/mail-iv.html', M[0].htmlBody); }

// 5. ứng viên mở link và xác nhận
const tok = row.tok, url = 'https://api.thucduonglanh.vn/tm/' + tok;
let res = await H.hrRoute(x, new Request(url), '/tm/' + tok, users), html = await res.text();
ok(/Lịch phỏng vấn/.test(html) && /Tôi sẽ tham gia/.test(html), 'Trang ứng viên hiện lịch + nút xác nhận');
if (OUT) writeFileSync(OUT + '/page-iv.html', html);
ok(/Link không còn hiệu lực/.test(await (await H.hrRoute(x, new Request('https://api.thucduonglanh.vn/tm/' + 'a'.repeat(24)), '/tm/' + 'a'.repeat(24), users)).text()), 'Mã sai → báo link không còn hiệu lực');
const post = (fields) => { const f = new FormData(); for (const k in fields) f.append(k, fields[k]); return H.hrRoute(x, new Request(url, { method: 'POST', body: f }), '/tm/' + tok, users); };
tg.length = 0; html = await (await post({ act: 'iv_ok' })).text(); await flush();
ok(/đã được xác nhận/.test(html), 'Ứng viên xác nhận lịch');
ok(tg.some(t => /xác nhận tham gia/.test(t) && /TG 200/.test(t)) && tg.some(t => /TG 100/.test(t)), 'Telegram báo người phỏng vấn (Thủy) + Quản trị');
L = await H.crmHr(x, thuy, { op: 'list' }, log); ok(L.rows[0].ivr.ok === 1, 'CRM thấy ✅ đã xác nhận');

// 6. phiếu phỏng vấn
ok(!(await H.crmHr(x, thuy, { op: 'ivs', id: r.id, s: { than: 4 } }, log)).ok, 'Phiếu thiếu mục bị chặn');
L = await H.crmHr(x, thuy, { op: 'ivs', id: r.id, s: { than: 4, tam: 5, tri: 4, vh: 5, gb: 4 }, note: 'Rất chân thành', verdict: 'Nhận' }, log);
ok(L.rows[0].st === 'Đã phỏng vấn' && L.rows[0].ivs.avg === 4.4, 'Lưu phiếu 4,4/5 → Đã phỏng vấn');

// 7. thư mời nhận việc
const due = new Date(Date.now() + 3 * 864e5 + 7 * 3600e3).toISOString().slice(0, 10), start = new Date(Date.now() + 10 * 864e5).toISOString().slice(0, 10);
ok(!(await H.crmHr(x, thuy, { op: 'offer', id: r.id, pos: 'Trưởng phòng Marketing' }, log)).ok, 'Thư mời thiếu lương / ngày bị chặn');
L = await H.crmHr(x, thuy, { op: 'offer', id: r.id, pos: 'Trưởng phòng Marketing', start, due, pay: '20.000.000đ/tháng + thưởng KPI', trial: '2 tháng', trialPay: '85%', boss: 'Anh Sơn', docs: 'CCCD', place: 'Ocean Park', hours: '8h–17h30' }, log);
M = await mails();
ok(L.rows[0].st === 'Mời nhận việc' && M.length === 2 && /Thư mời nhận việc/.test(M[1].subject) && /20\.000\.000/.test(M[1].htmlBody), 'Gửi thư mời nhận việc');
if (OUT) writeFileSync(OUT + '/mail-offer.html', M[1].htmlBody);
html = await (await H.hrRoute(x, new Request(url), '/tm/' + tok, users)).text();
ok(/Tôi đồng ý nhận việc/.test(html) && /20\.000\.000/.test(html), 'Trang ứng viên hiện thư mời + nút nhận việc');
if (OUT) writeFileSync(OUT + '/page-offer.html', html);
html = await (await post({ act: 'offer_ok', sign: 'An' })).text();
ok(/tích ô đồng ý/.test(html) && (await H.crmHr(x, thuy, { op: 'list' }, log)).rows[0].st === 'Mời nhận việc', 'Thiếu tích đồng ý / tên quá ngắn → chưa nhận');
tg.length = 0; html = await (await post({ act: 'offer_ok', agree: '1', sign: 'Trần Văn An' })).text(); await flush();
L = await H.crmHr(x, thuy, { op: 'list' }, log);
ok(/Chào mừng/.test(html) && L.rows[0].st === 'Đã nhận việc' && L.rows[0].ofr.sign === 'Trần Văn An' && L.rows[0].ofr.ip === '1.2.3.4', 'Ứng viên ký nhận việc (tên + giờ + IP)');
ok(tg.some(t => /ĐỒNG Ý NHẬN VIỆC/.test(t)), 'Telegram báo nhận việc');
if (OUT) writeFileSync(OUT + '/page-done.html', html);
html = await (await post({ act: 'offer_no', kind: 'no' })).text();
ok((await H.crmHr(x, thuy, { op: 'list' }, log)).rows[0].st === 'Đã nhận việc', 'Đã nhận rồi thì không đổi được sang từ chối');

// 8. mẫu thư, xoá, dọn 12 tháng
ok(!(await H.crmHr(x, thuy, { op: 'cfg', sign: 'x' }, log)).ok, 'Quản lý không sửa mẫu thư');
L = await H.crmHr(x, son, { op: 'cfg', sign: 'Đinh Minh Thái Sơn – Giám đốc', reply: 'tuyendung@x.vn' }, log); ok(L.cfg.sign.startsWith('Đinh') && L.cfg.reply === 'tuyendung@x.vn', 'Quản trị sửa mẫu thư');
ok(!(await H.crmHr(x, thuy, { op: 'del', id: r.id }, log)).ok, 'Quản lý không xoá được hồ sơ');
await DB.prepare("INSERT INTO applicants (time, job, name, status) VALUES (?, 'Kế toán', 'Cũ', 'Không phù hợp')").bind(Date.now() - 400 * 864e5).run();
await DB.prepare("DELETE FROM kv WHERE k LIKE 'hr_clean_%'").bind().run();
await H.hrTick(x, users);
ok((await DB.prepare("SELECT COUNT(*) n FROM applicants").bind().first()).n === 1, 'Hồ sơ không trúng tuyển quá 12 tháng tự xoá, người đã nhận việc giữ lại');
// 9. 🗂 đợt 2: hồ sơ nhân sự
const S2 = await import('file://' + ROOT + '/api/src/hrstaff.js');
let st = await H.crmHr(x, son, { op: 'st_hire', id: r.id, email: 'an@example.com', name: 'Văn An', role: 'Marketing' }, log);
ok(st.ok && st.made === 'an@example.com', 'Tạo tài khoản + hồ sơ từ ứng viên đã nhận việc');
let an = st.staff.find(z => z.email === 'an@example.com');
ok(an && an.full === 'Trần Văn An' && an.phone === '0912345678' && an.pos === 'Trưởng phòng Marketing' && an.role === 'Marketing' && /\d{2}\/\d{2}\/\d{4}/.test(an.joined), 'Hồ sơ chép đủ họ tên, SĐT, vị trí, ngày vào làm');
ok(an.docs.some(dc => /CV/.test(dc.kind)) && an.docs.some(dc => /Thư mời/.test(dc.kind)), 'CV + thư mời đã ký sang mục Giấy tờ');
ok(!(await H.crmHr(x, son, { op: 'st_hire', id: r.id, email: 'an@example.com', name: 'An 2', role: 'Marketing' }, log)).ok, 'Không tạo trùng tài khoản');
ok(!(await H.crmHr(x, thuy, { op: 'st_hire', id: r.id, email: 'z@x.vn', name: 'Z', role: 'Kho' }, log)).ok, 'Quản lý không tạo được tài khoản');
// phiếu góp ý
st = await H.crmHr(x, son, { op: 'st_fb_rows', rows: [['Dấu thời gian', 'Đồng đội được yêu thương?', 'Điểm mạnh số 1 – Điều bạn trân trọng', 'Điểm mạnh số 2', 'Điểm cần cải thiện số 1 – Người này có thể thay đổi', 'Điểm cần cải thiện số 2'],
  ['17/09/2026 18:53:48', 'Bùi Thị Mỹ Anh', 'Có tinh thần học hỏi', 'Biết lắng nghe', 'Mạnh dạn đưa ý kiến hơn', 'Em chưa tìm ra'], ['17/09/2026 19:05:09', 'Nguyễn Thị Thu Thủy', 'Tháo vát', 'Chăm chỉ', 'Em chưa tìm raa', ''], ['18/09/2026 9:00:00', 'Lê Văn Lạ', 'Vui vẻ', '', '', '']] }, log);
ok(st.imp && st.imp.ok && st.imp.n === 3, 'Nhập 3 câu trả lời phiếu Món quà âm thầm');
let thuyP = st.staff.find(z => z.email === 'thuy@x.vn'), ma = st.staff.find(z => z.email === 'myanh@x.vn');
ok(thuyP.fb.good.length === 2 && thuyP.fb.imp.length === 0, 'Thủy khớp theo họ tên đầy đủ, bỏ câu “Em chưa tìm raa”');
ok(ma.fb.good.length === 2 && ma.fb.imp.length === 1, 'Mỹ Anh khớp theo tên gọi (đuôi họ tên)');
ok(st.fbMiss.length === 1 && st.fbMiss[0].who === 'Lê Văn Lạ', 'Tên lạ hiện ở danh sách chưa khớp');
st = await H.crmHr(x, son, { op: 'st_fb_rows', rows: [['Dấu thời gian', 'Đồng đội được yêu thương?', 'Điểm mạnh số 1'], ['17/09/2026 18:53:48', 'Bùi Thị Mỹ Anh', 'Có tinh thần học hỏi']] }, log);
ok(st.imp.ok, 'Nhập lại file (đã có) không lỗi');
st = await H.crmHr(x, son, { op: 'st_fb_map', who: 'Lê Văn Lạ', email: 'an@example.com' }, log);
ok(st.fbMiss.length === 0 && st.staff.find(z => z.email === 'an@example.com').fb.good.length === 1, 'Khớp tay tên lạ → nhân sự, máy nhớ');
const lq = await H.crmHr(x, thuy, { op: 'st_list' }, log), mq = lq.staff.find(z => z.email === 'myanh@x.vn');
ok(mq.fb.good.length === 2 && mq.fb.imp.length === 0 && mq.idno === undefined && mq.docs === undefined, 'Quản lý thấy điểm mạnh, không thấy điều cần cải thiện / CCCD / giấy tờ');
// sửa hồ sơ
ok(!(await H.crmHr(x, thuy, { op: 'st_save', email: 'myanh@x.vn', dob: '35/13/1990' }, log)).ok, 'Ngày sinh sai bị chặn');
st = await H.crmHr(x, thuy, { op: 'st_save', email: 'myanh@x.vn', full: 'Bùi Thị Mỹ Anh', dob: '5/9/1998', joined: '01/03/2025', pos: 'Nhân viên kinh doanh', idno: '001', acct: '999' }, log);
ma = (await H.crmHr(x, son, { op: 'st_list' }, log)).staff.find(z => z.email === 'myanh@x.vn');
ok(ma.dob === '05/09/1998' && ma.pos === 'Nhân viên kinh doanh' && ma.full === 'Bùi Thị Mỹ Anh' && !ma.idno && !ma.acct, 'Quản lý sửa thông tin công việc, không ghi được CCCD / số tài khoản');
await H.crmHr(x, son, { op: 'st_save', email: 'myanh@x.vn', full: 'Bùi Thị Mỹ Anh', dob: '05/09/1998', joined: '01/03/2025', pos: 'Nhân viên kinh doanh', idno: '001098000123', acct: '1234 567 890', emer: 'Mẹ – 0912' }, log);
ma = (await H.crmHr(x, son, { op: 'st_list' }, log)).staff.find(z => z.email === 'myanh@x.vn');
ok(ma.idno === '001098000123' && ma.acct === '1234567890' && ma.emer === 'Mẹ – 0912', 'Quản trị ghi CCCD, số tài khoản, liên hệ khẩn cấp');
// giấy tờ
ok(!(await H.crmHr(x, thuy, { op: 'st_doc_add', email: 'myanh@x.vn', kind: 'CCCD', name: 'a.png', data: 'AAAA' }, log)).ok, 'Quản lý không tải giấy tờ');
st = await H.crmHr(x, son, { op: 'st_doc_add', email: 'myanh@x.vn', kind: 'CCCD (2 mặt)', name: 'cccd.png', data: 'data:image/png;base64,AAAA' }, log);
const dc = st.staff.find(z => z.email === 'myanh@x.vn').docs[0];
ok(dc && (await H.crmHr(x, son, { op: 'st_doc_get', id: dc.id }, log)).b64 === 'AAAA', 'Tải lên + tải về giấy tờ');
st = await H.crmHr(x, son, { op: 'st_doc_del', id: dc.id }, log); ok(!st.staff.find(z => z.email === 'myanh@x.vn').docs.length, 'Xoá giấy tờ');

// 10. 🤝 Hiểu & Thương + 📒 Notion
ok(!(await H.crmHr(x, son, { op: 'st_nt_pull' }, log)).pull.ok, 'Chưa có khoá Notion → báo rõ');
await DB.prepare("INSERT INTO kv (k, v) VALUES ('gv_cfg', ?)").bind(JSON.stringify({ notion: { token: 'ntn_' + 'x'.repeat(30), db: 'gv' } })).run();
let nl = await H.crmHr(x, son, { op: 'st_list' }, log);
ok(nl.nt.tok && nl.nt.staff && nl.nt.ht, 'Dùng chung khoá Notion của Việc tuần, đọc được 2 bảng');
await DB.prepare("UPDATE users SET dob = '' WHERE email = 'thuy@x.vn'").bind().run();
nl = await H.crmHr(x, son, { op: 'st_nt_pull' }, log);
const th = nl.staff.find(z => z.email === 'thuy@x.vn');
ok(nl.pull.ok && nl.pull.n === 1 && th.dob === '18/11/1990' && th.joined === '01/11/2023' && th.pos === 'Quản lý kinh doanh' && th.strong === 'Giữ đội ổn định', 'Lấy từ Notion: khớp Thủy theo họ tên, điền ô trống');
ok(th.acct === '0011002233' && th.bank.startsWith('VCB'), 'Số tài khoản tách từ ô ngân hàng Notion');
ok(nl.pull.miss.length === 1 && nl.pull.miss[0].name === 'Trần Cố Vấn', 'Người chưa có tài khoản CRM chỉ liệt kê, không tự tạo');
await DB.prepare("UPDATE hr_staff SET pos = 'Đã sửa trên CRM' WHERE email = 'thuy@x.vn'").bind().run();
nl = await H.crmHr(x, son, { op: 'st_nt_pull' }, log);
ok(nl.staff.find(z => z.email === 'thuy@x.vn').pos === 'Đã sửa trên CRM', 'Lấy lại không ghi đè ô CRM đã có');
// form 9 câu
const HT = await import('file://' + ROOT + '/api/src/hrstaff.js');
{ const mx = { email: 'myanh@x.vn', name: 'Mỹ Anh', role: 'Sale & CSKH', level: 1 };
  const m0 = await HT.crmHt(x, mx, { op: 'me' });
  ok(m0.forms.ht === 0 && m0.forms.pf === 1 && m0.pf && !m0.pf.at, 'Mặc định: Hiểu & Thương tắt, Thông tin của tôi bật');
  ok(!(await HT.crmHt(x, mx, { op: 'save', q2: 'a', q4: 'b', q6: 'c', q9: 'd', give: ['Giao tiếp / kết nối'], need: ['Lập kế hoạch / ưu tiên'], how: 'Hỏi và lắng nghe', consent: 1 })).ok, 'Form Hiểu & Thương tắt thì không gửi được');
  ok(!(await HT.crmHt(x, mx, { op: 'forms', ht: 1, pf: 1 })).ok, 'Sale không bật / tắt được form');
  ok((await HT.crmHt(x, son, { op: 'forms', ht: 1, pf: 1 })).forms.ht === 1, 'Quản trị bật lại Hiểu & Thương');
}
const ma2 = { email: 'myanh@x.vn', name: 'Mỹ Anh', role: 'Sale & CSKH', level: 1 };
ok((await HT.crmHt(x, ma2, { op: 'me' })).ans === null, 'Nhân sự chưa điền thì ans = null (hiện thẻ mời)');
ok(!(await HT.crmHt(x, ma2, { op: 'save', q2: 'Chăm khách' })).ok, 'Thiếu câu bắt buộc bị chặn');
ntCalls.length = 0;
let hs = await HT.crmHt(x, ma2, { op: 'save', q1: 'Mẹ đơn thân', q2: 'Chăm khách cũ', q4: 'Kiên nhẫn', q6: 'Nhớ khách', q9: 'Gọi 30 khách/ngày', give: ['Giao tiếp / kết nối', 'Lắng nghe / tinh thần', 'Sáng tạo / nội dung', 'X lạ'], need: ['Lập kế hoạch / ưu tiên'], how: 'Hỏi và lắng nghe', priv: 'chuyện nhà', consent: 1 });
await flush();
ok(hs.ok && hs.ans.give.length === 3 && hs.ans.give.indexOf('X lạ') < 0, 'Lưu 9 câu, chỉ nhận lựa chọn hợp lệ, tối đa 3');
ok(ntCalls.some(c => c.m === 'POST' && /pages$/.test(c.u) && c.b.parent.database_id === 'c4a8bccc9c3f4e32a1700132c543991a' && c.b.properties['1. Cá nhân và gia đình']), 'Tự ghi bài Hiểu & Thương sang Notion ngay sau khi lưu');
const ql = (await H.crmHr(x, thuy, { op: 'st_list' }, log)).staff.find(z => z.email === 'myanh@x.vn').ht;
ok(ql.a.q2 === 'Chăm khách cũ' && ql.a.q1 === undefined && ql.a.priv === undefined, 'Quản lý xem được câu 2, không thấy câu 1 / điều riêng tư');
const qa = (await H.crmHr(x, son, { op: 'st_list' }, log)).staff.find(z => z.email === 'myanh@x.vn').ht;
ok(qa.a.q1 === 'Mẹ đơn thân' && qa.a.priv === 'chuyện nhà', 'Quản trị xem đủ');
// ghép Đệ nhị thân + ghi Notion có quan hệ
ntCalls.length = 0;
nl = await H.crmHr(x, son, { op: 'st_pair', email: 'myanh@x.vn', pair: 'thuy@x.vn', why: 'Thủy giỏi lập kế hoạch', st: 'Đã đề xuất', both: 1 }, log); await flush();
ok(nl.staff.find(z => z.email === 'thuy@x.vn').ht.pair === 'myanh@x.vn' && nl.staff.find(z => z.email === 'myanh@x.vn').ht.pairSt === 'Đã đề xuất', 'Ghép Đệ nhị thân 2 chiều');
const pc = ntCalls.find(c => c.b && c.b.properties && c.b.properties['Đệ nhị thân đề xuất']);
ok(pc && pc.b.properties['Đệ nhị thân đề xuất'].relation[0].id === 'pg-thuy', 'Ghi sang Notion kèm quan hệ Đệ nhị thân → trang Notion của Thủy');
ok(!(await H.crmHr(x, thuy, { op: 'st_pair', email: 'myanh@x.vn', pair: '' }, log)).ok, 'Quản lý không ghép được');
// sửa hồ sơ → tự ghi Notion, không gửi ô trống
ntCalls.length = 0;
await H.crmHr(x, son, { op: 'st_save', email: 'thuy@x.vn', full: 'Nguyễn Thị Thu Thủy', dob: '18/11/1990', joined: '01/11/2023', pos: 'Quản lý kinh doanh', home: 'Nam Định', note: '' }, log); await flush();
const sp = ntCalls.find(c => c.m === 'PATCH' && /pages\/pg-thuy/.test(c.u));
ok(sp && sp.b.properties['Quê quán'] && sp.b.properties['Ngày sinh'].date.start === '1990-11-18' && !sp.b.properties['Ghi chú'] && !sp.b.properties['Chi phí/Lương tháng'], 'Sửa hồ sơ → tự sửa trang Notion (bỏ ô trống, không gửi lương)');
nl = await H.crmHr(x, son, { op: 'st_nt_push', all: 1 }, log);
ok(nl.push.ok && nl.push.n >= 4 && nl.nt.wait === 0, 'Nút ghi tất cả sang Notion: tạo trang cho người chưa có');

// 10b. 📝 Thông tin của tôi
{
const mx = { email: 'myanh@x.vn', name: 'Mỹ Anh', role: 'Sale & CSKH', level: 1 };
ok(!(await HT.crmHt(x, mx, { op: 'pf_save', full: 'Bùi Thị Mỹ Anh', dob: '02/12', phone: '0912000102', addr: 'Gia Lâm', emerName: 'Mẹ', emerPhone: '0912000999', consent: 1 })).ok, 'Ngày sinh thiếu năm bị chặn');
ok(!(await HT.crmHt(x, mx, { op: 'pf_save', full: 'Bùi Thị Mỹ Anh', dob: '02/12/1998', phone: '0912000102', addr: 'Gia Lâm', consent: 1 })).ok, 'Thiếu người thân liên hệ bị chặn');
let pj = await HT.crmHt(x, mx, { op: 'pf_save', full: 'Bùi Thị Mỹ Anh', dob: '2/12/1998', phone: '0912 000 102', home: 'Thái Bình', addr: 'Ocean Park, Gia Lâm', idno: '034198000111', acct: '0011 2233', bank: 'VCB', emerRel: 'Mẹ', emerName: 'Nguyễn Thị Hoa', emerPhone: '0912000999', fam: 'Đã kết hôn', kids: '1 bé 2022', health: 'Dị ứng tôm', shirt: 'M', consent: 1 });
ok(pj.ok && pj.saved && pj.pf.at && pj.pf.dob === '02/12/1998' && pj.pf.emer === 'Mẹ – Nguyễn Thị Hoa – 0912000999' && pj.pf.care.kids === '1 bé 2022', 'Nhân sự tự cập nhật: lưu vào hồ sơ + phần chăm sóc');
let pl = await H.crmHr(x, son, { op: 'st_list' }, log), pm = pl.staff.find(z => z.email === 'myanh@x.vn');
ok(pm.full === 'Bùi Thị Mỹ Anh' && pm.home === 'Thái Bình' && pm.idno === '034198000111' && pm.acct === '00112233' && pm.pf.c.health === 'Dị ứng tôm', 'Quản trị thấy đủ trong hồ sơ (cả CCCD, sức khoẻ)');
pm = (await H.crmHr(x, thuy, { op: 'st_list' }, log)).staff.find(z => z.email === 'myanh@x.vn');
ok(pm.pf.c.kids && !pm.pf.c.health && !pm.idno && !pm.addr, 'Quản lý thấy phần chăm sóc, không thấy sức khoẻ, CCCD, nơi ở');
await HT.crmHt(x, son, { op: 'forms', ht: 1, pf: 0 });
ok(!(await HT.crmHt(x, mx, { op: 'pf_save', full: 'x' })).ok, 'Tắt form Thông tin của tôi thì không gửi được');
await HT.crmHt(x, son, { op: 'forms', ht: 1, pf: 1 });
}
// 11. 📄 Hợp đồng
{
const CT = await import('file://' + ROOT + '/api/src/hrhd.js');
const dIso = n => new Date(Date.now() + 7 * 36e5 + n * 864e5).toISOString().slice(0, 10);
ok(!(await H.crmHr(x, thuy, { op: 'ct_save', email: 'myanh@x.vn', kind: 'Thử việc', start: dIso(0), end: dIso(59), pay: '6.000.000đ' }, log)).ok, 'Quản lý không làm được hợp đồng (có lương)');
let cs = await H.crmHr(x, son, { op: 'ct_save', email: 'myanh@x.vn', kind: 'Thử việc', start: dIso(0), end: dIso(89), pay: '5.000.000đ', offerPay: '7.000.000đ' }, log);
ok(!cs.ok && cs.warn && cs.warn.some(w => /60 ngày/.test(w)) && cs.warn.some(w => /85%/.test(w)), 'Thử việc 90 ngày + lương < 85% → cảnh báo theo luật, chưa lưu');
ok(!(await H.crmHr(x, son, { op: 'ct_save', email: 'myanh@x.vn', kind: 'Xác định thời hạn', start: dIso(0), end: '', pay: '7tr' }, log)).ok, 'Xác định thời hạn thiếu ngày kết thúc bị chặn');
cs = await H.crmHr(x, son, { op: 'ct_save', email: 'myanh@x.vn', kind: 'Thử việc', start: dIso(-50), end: dIso(9), pay: '6.000.000đ', pos: 'Nhân viên kinh doanh', offerPay: '7.000.000đ' }, log);
let mc = cs.staff.find(z => z.email === 'myanh@x.vn');
ok(cs.ok && mc.cts.length === 1 && /^01\/\d{4}\/HĐTV-VTG$/.test(mc.cts[0].no) && mc.cts[0].st === 'Nháp', 'Lưu hợp đồng thử việc nháp, tự đánh số ' + (mc.cts[0] || {}).no);
const ctId = mc.cts[0].id;
let dc = await H.crmHr(x, son, { op: 'ct_doc', id: ctId }, log);
ok(/thời hạn <b>[^<]+<\/b>, từ ngày <b>[^<]+<\/b> đến hết ngày <b>/.test(dc.html) || /đến hết ngày <b>/.test(dc.html), 'Câu “từ ngày … đến hết ngày …” có dấu cách');
ok(dc.ok && /HỢP ĐỒNG THỬ VIỆC/.test(dc.html) && /Nhân viên kinh doanh/.test(dc.html) && /6\.000\.000đ/.test(dc.html) && dc.miss.indexOf('noi_cap') >= 0 && dc.miss.indexOf('dai_dien') >= 0 && /class="dot"/.test(dc.html), 'Bản in điền thông tin, chỗ thiếu (nơi cấp CCCD, người đại diện) để dòng chấm');
ok(/0111053409/.test(dc.html) && /VITAGREEN/.test(dc.html), 'Bản in có tên công ty + mã số doanh nghiệp');
let cf = await H.crmHr(x, son, { op: 'ct_cfg', save: 1, rep: 'Người Đại Diện', repTitle: 'Giám đốc', tpl: { tv: CT.TPL_DEF.tv + '\nĐiều riêng của anh.' } }, log);
ok(cf.ok && cf.ctCfg.rep === 'Người Đại Diện' && cf.ctCfg.edited.indexOf('tv') >= 0, 'Lưu người đại diện + sửa mẫu thử việc');
dc = await H.crmHr(x, son, { op: 'ct_doc', id: ctId }, log);
ok(/Người Đại Diện/.test(dc.html) && /Điều riêng của anh/.test(dc.html) && dc.miss.indexOf('dai_dien') < 0, 'Bản in dùng mẫu đã sửa + người đại diện');
cs = await H.crmHr(x, son, { op: 'st_list' }, log); mc = cs.staff.find(z => z.email === 'myanh@x.vn');
ok(mc.cts[0].state.k === 'draft', 'Nháp đã tới ngày bắt đầu → hiện cần ký');
cs = await H.crmHr(x, son, { op: 'ct_sign', id: ctId, sign: dIso(-50), data: 'data:application/pdf;base64,' + pdf, name: 'HĐTV My Anh.pdf' }, log);
mc = cs.staff.find(z => z.email === 'myanh@x.vn');
ok(mc.cts[0].st === 'Đã ký' && mc.cts[0].doc > 0 && mc.cts[0].locked && mc.docs.some(d => /Hợp đồng thử việc .* \(bản ký\)/.test(d.kind)), 'Đã ký: lưu bản scan vào Giấy tờ, chốt nội dung');
ok(mc.cts[0].state.k === 'soon' && mc.cts[0].state.n === 9, 'Thử việc còn 9 ngày → Sắp hết hạn');
ok(!(await H.crmHr(x, son, { op: 'ct_save', id: ctId, email: 'myanh@x.vn', kind: 'Thử việc', start: dIso(-50), end: dIso(20), pay: '6tr' }, log)).ok, 'Hợp đồng đã ký không sửa được');
await H.crmHr(x, son, { op: 'ct_cfg', save: 1, rep: 'Tên Khác' }, log);
ok(!/Tên Khác/.test((await H.crmHr(x, son, { op: 'ct_doc', id: ctId }, log)).html), 'Bản đã ký in đúng nội dung lúc ký');
ok(!(await H.crmHr(x, son, { op: 'ct_del', id: ctId }, log)).ok, 'Không xoá được hợp đồng đã ký');
// nhắc Telegram
await DB.prepare("DELETE FROM kv WHERE k LIKE 'hr_ct_tg_%'").bind().run(); tg.length = 0; await CT.ctTick(x, users, 1);
ok(tg.some(t => /Hợp đồng nhân sự cần xử lý/.test(t) && /TG 100/.test(t)) && (await DB.prepare('SELECT rem FROM hr_ct WHERE id = ?').bind(ctId).first()).rem === 2 && !tg.some(t => /Hợp đồng nhân sự/.test(t) && /TG 200/.test(t)), 'Telegram 8h báo Quản trị: thử việc còn 9 ngày');
tg.length = 0; await CT.ctTick(x, users, 1); ok(!tg.length, 'Cùng ngày không nhắc lại');
await DB.prepare("DELETE FROM kv WHERE k LIKE 'hr_ct_tg_%'").bind().run(); tg.length = 0; await CT.ctTick(x, users, 1); ok(!tg.length, 'Hôm sau cùng mốc (còn ≤ 15 ngày) không nhắc lại');
// hợp đồng tiếp theo + luật 2 lần xác định thời hạn
let todo = await CT.ctTodo(x); ok(todo.some(i => i.k === 'none' && i.z.email === 'thuy@x.vn') && !todo.some(i => i.z.email === 'thaisoniph@gmail.com') && todo.some(i => i.k === 'soon' && i.z.email === 'myanh@x.vn'), 'Việc cần xử lý: Thủy chưa có hợp đồng, Mỹ Anh sắp hết thử việc');
for (const [a, b] of [[10, 375], [376, 740]]) { const r2 = await H.crmHr(x, son, { op: 'ct_save', email: 'myanh@x.vn', kind: 'Xác định thời hạn', start: dIso(a), end: dIso(b), pay: '7.000.000đ', force: 1 }, log); await H.crmHr(x, son, { op: 'ct_sign', id: r2.staff.find(z => z.email === 'myanh@x.vn').cts[0].id }, log); }
todo = await CT.ctTodo(x); ok(!todo.some(i => i.z.email === 'myanh@x.vn'), 'Đã có hợp đồng tiếp theo → hết cảnh báo thử việc');
cs = await H.crmHr(x, son, { op: 'ct_save', email: 'myanh@x.vn', kind: 'Xác định thời hạn', start: dIso(741), end: dIso(1100), pay: '8tr' }, log);
ok(cs.warn && cs.warn.some(w => /không xác định thời hạn/.test(w)), 'Lần 3 xác định thời hạn → nhắc phải ký không xác định thời hạn (Điều 20)');
cs = await H.crmHr(x, son, { op: 'ct_save', email: 'myanh@x.vn', kind: 'Không xác định thời hạn', start: dIso(741), end: dIso(900), pay: '8tr' }, log);
mc = cs.staff.find(z => z.email === 'myanh@x.vn'); ok(cs.ok && mc.cts[0].end === '' && /HĐLĐ-VTG/.test(mc.cts[0].no), 'Không xác định thời hạn: bỏ ngày kết thúc');
dc = await H.crmHr(x, son, { op: 'ct_doc', id: mc.cts[0].id }, log); ok(/không xác định thời hạn/.test(dc.html) && !/đến hết ngày/.test(dc.html), 'Bản in không thời hạn không có "đến hết ngày"');
cs = await H.crmHr(x, son, { op: 'ct_off', id: ctId, date: dIso(9), why: 'Kết thúc thử việc' }, log);
ok(cs.staff.find(z => z.email === 'myanh@x.vn').cts.find(c => c.id === ctId).st === 'Đã thanh lý', 'Thanh lý hợp đồng');
if (OUT) writeFileSync(OUT + '/hop-dong.html', (await H.crmHr(x, son, { op: 'ct_doc', id: ctId }, log)).html);
}
// 12. 🎂 Sinh nhật theo tháng
{
const SN = await import('file://' + ROOT + '/api/src/sinhnhat.js');
const ma3 = { email: 'myanh@x.vn', name: 'Mỹ Anh', role: 'Sale & CSKH', level: 1 };
const d3 = new Date(Date.now() + 7 * 36e5 + 3 * 864e5), dm3 = String(d3.getUTCDate()).padStart(2, '0') + '/' + String(d3.getUTCMonth() + 1).padStart(2, '0');
await DB.prepare("UPDATE users SET dob = ?, tg = '300' WHERE email = 'myanh@x.vn'").bind(dm3 + '/1998').run();
await DB.prepare("UPDATE users SET tg = '200' WHERE email = 'thuy@x.vn'").bind().run(); x._users = null;
ok((await SN.crmSnh(x, ma3, { op: 'list' })).show === false, 'Sale thường không thấy danh sách sinh nhật');
ok(!(await SN.crmSnh(x, thuy, { op: 'life', emails: ['myanh@x.vn'] })).ok, 'Quản lý không chọn được Trưởng ban');
ok((await SN.crmSnh(x, son, { op: 'life', emails: ['myanh@x.vn', 'la@x.vn'] })).life.join() === 'myanh@x.vn', 'Quản trị chọn Trưởng ban (bỏ email không có tài khoản)');
const sl = await SN.crmSnh(x, ma3, { op: 'list' });
ok(sl.show && sl.me && sl.staff.some(z => z.email === 'myanh@x.vn' && z.dm === dm3) && sl.staff.every(z => z.dm === '' || z.dm.length === 5) && !sl.staff.some(z => z.phone), 'Trưởng ban thấy tên + ngày/tháng, không có năm sinh, số điện thoại');
ok((await SN.crmSnh(x, thuy, { op: 'list' })).show, 'Quản lý thấy danh sách');
tg.length = 0; await SN.snhTick(x, 1);
ok(tg.some(t => /TG 300/.test(t) && /Còn 3 ngày/.test(t)) && tg.some(t => /TG 200/.test(t) && /Còn 3 ngày/.test(t)), 'Telegram báo trước 3 ngày cho Trưởng ban + Quản lý');
tg.length = 0; await SN.snhTick(x, 1); ok(!tg.length, 'Cùng ngày không báo lại');
}

L = await H.crmHr(x, son, { op: 'del', id: r.id }, log); ok(L.rows.length === 0 && !(await DB.prepare('SELECT 1 FROM hr_cv').bind().first()), 'Quản trị xoá hồ sơ + file CV');

origLog(bad ? '\n❌ ' + bad + ' bước lỗi' : '\n✅ Tất cả đều đúng');
process.exit(bad ? 1 : 0);
