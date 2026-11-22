// ✨ Thử "Nhờ AI viết tin" khi chăm khách (api/src/ai.js: 3 tin · học giọng từng sale · đo khách mua lại) trên máy, không gọi AI thật:
// node scripts/test-aicare.mjs   (D1 giả bằng node:sqlite, AI giả bằng fetch trả JSON soạn sẵn)
import { DatabaseSync } from 'node:sqlite';
import { fileURLToPath } from 'node:url';
import assert from 'node:assert/strict';
const ROOT = fileURLToPath(new URL('..', import.meta.url)).replace(/\/$/, '');
const A = await import('file://' + ROOT + '/api/src/ai.js');

const raw = new DatabaseSync(':memory:');
const DB = { prepare(sql) { const st = raw.prepare(sql); let a = []; const o = { bind(...x) { a = x.map(v => v === undefined ? null : typeof v === 'boolean' ? (v ? 1 : 0) : v); return o; }, async all() { return { results: st.all(...a) }; }, async first() { return st.get(...a) || null; }, async run() { const r = st.run(...a); return { meta: { last_row_id: Number(r.lastInsertRowid), changes: r.changes } }; } }; return o; } };
const now = Date.now(), DAY = 864e5;
raw.exec(`CREATE TABLE kv (k TEXT PRIMARY KEY, v TEXT, exp INTEGER);
CREATE TABLE customers (phone TEXT, name TEXT, orders INTEGER, spent INTEGER, first INTEGER, last INTEGER, products TEXT, runout INTEGER, care_result TEXT, note TEXT, tag TEXT, recv TEXT, owner TEXT);
CREATE TABLE orders (phone TEXT, time INTEGER, items TEXT, total INTEGER, status TEXT);
CREATE TABLE logs (ref TEXT, time INTEGER, what TEXT, result TEXT, note TEXT);`);
raw.prepare('INSERT INTO customers VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)').run('0912345678', 'Chị Nguyễn Thị Lan', 2, 600000, now - 60 * DAY, now - 20 * DAY, 'Trà DILVANG', now + 3 * DAY, '', 'Chị Lan hay mất ngủ', '', '', 'Ngô Thị Lan');

let calls = 0, lastBody = null;
const MSGS = { msgs: [{ goc: 'Đúng việc hôm nay', text: '[Tên] ơi, trà DILVANG của mình sắp hết chưa ạ? Em gửi thêm cho chị nhé.' }, { goc: 'Hỏi thăm cảm nhận / cách dùng', text: '[Tên] ơi, chị uống trà thấy ngủ thế nào rồi ạ?' }, { goc: 'Cho đi trước', text: '[Tên] ơi, em gửi chị mẹo pha trà ngon hơn nhé: hãm 5 phút với nước 90 độ ạ.' }] };
globalThis.fetch = async (url, init) => {
  calls++; lastBody = JSON.parse(init.body);
  return new Response(JSON.stringify({ id: 'm', type: 'message', role: 'assistant', model: 'claude-haiku-5-5', content: [{ type: 'text', text: JSON.stringify(MSGS) }], stop_reason: 'end_turn', usage: { input_tokens: 10, output_tokens: 10 } }), { headers: { 'content-type': 'application/json' } });
};
const x = { env: { DB, ANTHROPIC_API_KEY: 'test' }, db: DB }, lan = { name: 'Ngô Thị Lan', level: 1 };

// 1) 3 tin, giữ chữ [Tên] (không gửi tên khách đi), có số đo
let r = await A.crmAi(x, lan, { phone: '0912345678', kind: 'msg', task: 'runout' });
assert.equal(r.ok, true); assert.equal(r.msgs.length, 3); assert.ok(r.stats); assert.equal(r.stats.sug, 1);
assert.ok(!JSON.stringify(lastBody).includes('Nguyễn Thị Lan'), 'tên khách không được gửi cho AI');
// 2) gửi y nguyên tin 2 → đếm same, không học
r = await A.crmAiSent(x, lan, { phone: '0912345678', text: '[Tên] ơi, chị uống trà thấy ngủ thế nào rồi ạ?' });
assert.equal(r.same, 1);
// 3) gợi ý khác (fresh) → sửa tin 3 rồi gửi → học
r = await A.crmAi(x, lan, { phone: '0912345678', kind: 'msg', task: 'runout', fresh: 1 });
assert.equal(calls, 2);
r = await A.crmAiSent(x, lan, { phone: '0912345678', text: '[Tên] ơi em mách chị cách pha trà ngon: nước 90 độ, hãm 5 phút nha chị 😊' });
assert.equal(r.learned, 1);
// gửi lần nữa không đếm trùng
r = await A.crmAiSent(x, lan, { phone: '0912345678', text: 'gì đó' }); assert.equal(r.skip, 1);
// 4) lần sau: prompt có phần học giọng
await A.crmAi(x, lan, { phone: '0912345678', kind: 'msg', task: 'd7' });
assert.ok(JSON.stringify(lastBody).includes('CÁCH BẠN SALE NÀY HAY SỬA TIN AI'), 'prompt phải có lần sửa của sale');
// 5) khách mua lại sau tin → đếm buy
raw.prepare('INSERT INTO orders VALUES (?,?,?,?,?)').run('0912345678', Date.now() + 1000, 'Trà DILVANG x2', 300000, 'Đã giao');
const st = await A.aiStats(x, 'Ngô Thị Lan');
assert.equal(st.sent, 2); assert.equal(st.same, 1); assert.equal(st.n30, 2); assert.equal(st.buy, 2); assert.equal(st.learn, 1);
const all = await A.aiStats(x, 'Ai đó', true); assert.equal(all.sent, 2);
// 6) tóm tắt (sum) vẫn như cũ
r = await A.crmAi(x, lan, { phone: '0912345678', kind: 'sum' }); assert.equal(r.ok, true); assert.ok(r.text);
console.log('✅ test-aicare: 3 tin, đo (gợi ý/gửi/y nguyên/mua lại), học giọng sale – tất cả đúng', st);
