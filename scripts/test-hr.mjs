// 🧑‍💼 Thử Tuyển dụng (api/src/hr.js + apply.js) trên máy, không gửi email / Telegram / AI thật: node scripts/test-hr.mjs [thư-mục-lưu-html]
// D1 giả bằng node:sqlite, email + Telegram giả bằng MOCK_GOOGLE (lưu kv mock_mail_*), AI giả bằng fetch trả JSON soạn sẵn, trang congsu giả.
import { DatabaseSync } from 'node:sqlite';
import { fileURLToPath } from 'node:url';
import { writeFileSync, mkdirSync } from 'node:fs';
const ROOT = fileURLToPath(new URL('..', import.meta.url)).replace(/\/$/, '');
const OUT = process.argv[2] || '';
const raw = new DatabaseSync(':memory:');
const DB = { prepare(sql) { const st = raw.prepare(sql); let a = []; const o = { bind(...x) { a = x.map(v => v === undefined ? null : typeof v === 'boolean' ? (v ? 1 : 0) : v); return o; }, async all() { return { results: st.all(...a) }; }, async first() { return st.get(...a) || null; }, async run() { const r = st.run(...a); return { meta: { last_row_id: Number(r.lastInsertRowid), changes: r.changes } }; } }; return o; } };
raw.exec(`CREATE TABLE kv (k TEXT PRIMARY KEY, v TEXT, exp INTEGER); CREATE TABLE users (email TEXT, name TEXT, role TEXT, active INTEGER, tg TEXT, ord INTEGER);
CREATE TABLE logs (time INTEGER, who TEXT, what TEXT, ref TEXT, name TEXT, result TEXT, note TEXT);`);
let aiCalls = 0, aiBody = null;
const realFetch = globalThis.fetch;
const JR = o => new Response(JSON.stringify(o), { headers: { 'content-type': 'application/json' } });
globalThis.fetch = async (url, init) => {
  const u = String(url);
  if (u.includes('anthropic')) { aiCalls++; aiBody = JSON.parse(init.body); return JR({ id: 'm', type: 'message', role: 'assistant', model: 'claude-sonnet-5-5', content: [{ type: 'text', text: JSON.stringify({ score: 82, rank: 'A', sum: 'Có 6 năm làm marketing ngành thực phẩm, từng dẫn đội 5 người, khớp phần lớn yêu cầu.', why: ['6 năm marketing FMCG', 'Đã chạy quảng cáo Facebook ngân sách lớn', 'Câu trả lời về văn hoá chân thành'], good: ['Dẫn đội', 'Số liệu rõ'], risk: ['Chưa làm thương hiệu sức khoẻ'], ask: ['Kể 1 chiến dịch thất bại', 'Bạn đo hiệu quả thế nào', 'Vì sao rời công ty cũ', 'Bạn dùng AI ra sao', 'Mong muốn 1 năm tới'], cv: 'Marketing 6 năm tại 2 công ty thực phẩm.' }) }], stop_reason: 'end_turn', usage: { input_tokens: 4000, output_tokens: 600 } }); }
  if (u === 'https://congsu.thucduonglanh.vn/') return new Response('<a class="fw-chip" href="/truong-phong-marketing/">Vị trí Trưởng phòng Marketing</a>');
  if (u.includes('congsu.thucduonglanh.vn/truong-phong-marketing')) return new Response('<html><header>menu</header><main><h1>Trưởng phòng Marketing</h1><p>Yêu cầu: 5 năm kinh nghiệm marketing, dẫn đội.</p></main></html>');
  if (u.includes('api.telegram.org')) return JR({ ok: true });
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
L = await H.crmHr(x, son, { op: 'del', id: r.id }, log); ok(L.rows.length === 0 && !(await DB.prepare('SELECT 1 FROM hr_cv').bind().first()), 'Quản trị xoá hồ sơ + file CV');

origLog(bad ? '\n❌ ' + bad + ' bước lỗi' : '\n✅ Tất cả đều đúng');
process.exit(bad ? 1 : 0);
