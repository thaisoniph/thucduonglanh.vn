// 🤖 Thử: trợ lý Fanpage ghi số vào file số quảng cáo → sale điền tên ô Sale → CRM giao khách; 🚨 cảnh báo số chưa ai nhận.
// node scripts/test-fbqc.mjs — D1 giả (node:sqlite), Google Sheet giả (MOCK_GOOGLE), Telegram giả. Không gọi dịch vụ thật.
import { DatabaseSync } from 'node:sqlite';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import assert from 'node:assert/strict';
const ROOT = fileURLToPath(new URL('..', import.meta.url)).replace(/\/$/, '');
const raw = new DatabaseSync(':memory:');
const DB = { prepare(sql) { const st = raw.prepare(sql); let a = []; const o = { bind(...x) { a = x.map(v => v === undefined ? null : typeof v === 'boolean' ? (v ? 1 : 0) : v); return o; },
  async all() { return { results: st.all(...a) }; }, async first() { return st.get(...a) || null; }, async run() { const r = st.run(...a); return { meta: { changes: r.changes } }; } }; return o; },
  async batch(l) { const out = []; for (const s of l) out.push(await s.run()); return out; }, async exec(q) { raw.exec(q); } };
const now = Date.now(), day = new Date(now + 7 * 3600e3), dmy = String(day.getUTCDate()).padStart(2, '0') + '/' + String(day.getUTCMonth() + 1).padStart(2, '0') + '/' + day.getUTCFullYear();
const book = { title: 'File QC', sheets: { 'Bữa Ăn VTG': [['Ngày', 'Tên', 'SĐT', 'Sale', 'Ghi chú'], [dmy, 'Khách cũ', '0911111111', 'Lương', '']], 'N1_GafoFucoidan': [['Ngày', 'Tên', 'SĐT', 'Sale', 'Ghi chú']] } };
const tg = [], log0 = console.log; console.log = (...a) => { if (a[0] === 'TG') tg.push(a.slice(1).join(' ')); else log0(...a); }; // MOCK_GOOGLE: Telegram in ra console
globalThis.fetch = async (url, init) => {
  const u = String(url);
  if (u.startsWith('https://mock.google/')) return new Response(JSON.stringify(book));
  if (u.includes('api.telegram.org')) { tg.push(JSON.parse(init.body).text); return new Response('{"ok":true,"result":{}}'); }
  return new Response('{}');
};
const env = { DB, MOCK_GOOGLE: 'https://mock.google', TELEGRAM_TOKEN: 't', TELEGRAM_CHAT_IDS: '-1' };
const x = { env, db: DB, later: () => { } };
const C = await import('file://' + ROOT + '/api/src/crm.js');
raw.exec(readFileSync(ROOT + '/api/schema.sql', 'utf8')); await C.ensureSchema(DB);
for (const [e, n, r, al] of [['luong@x.vn', 'Lương', 'Sale & CSKH', 'Lương'], ['thuy@x.vn', 'Thu Thủy', 'Quản lý', ''], ['thaisoniph@gmail.com', 'Thái Sơn', 'Quản trị', '']])
  raw.prepare("INSERT INTO users (email, name, role, active, recv, alias, tg) VALUES (?, ?, ?, 1, 'Có', ?, ?)").run(e, n, r, al, '9' + n.length);
const map = { date: 0, name: 1, phone: 2, sale: 3, note: 4 };
raw.prepare("INSERT INTO kv (k, v) VALUES ('ads_cfg', ?)").run(JSON.stringify({ fileId: 'F1', mode: 'staff', since: '2026-01-01', sheets: [{ name: 'Bữa Ăn VTG', on: true, header: 1, map }, { name: 'N1_GafoFucoidan', on: true, header: 1, map }, { name: 'Ladi', on: false, header: 1, map }] }));
const S = await import('file://' + ROOT + '/api/src/sync.js');

// chọn tab theo sản phẩm
const tabs = ['N1_GafoFucoidan', 'Bữa Ăn VTG', 'SP Chè Vằng', 'Sữa CurCumin'];
assert.equal(S.qcTabOf(tabs, ['28/11 Bua an dinh duong VitaGreen - Tin nhan', '', 'Fanpage Gafo']), 'Bữa Ăn VTG');
assert.equal(S.qcTabOf(tabs, ['', 'gafo fucoidan giá bao nhiêu', 'Thực Dưỡng Lành - VitaGreen Nutrition']), 'N1_GafoFucoidan', 'câu hỏi của khách trước tên trang');
assert.equal(S.qcTabOf(tabs, ['', 'trà dilvang uống sao']), 'SP Chè Vằng');
assert.equal(S.qcTabOf(tabs, ['', 'xin giá']), 'Bữa Ăn VTG', 'không rõ → Bữa Ăn');

// trợ lý ghi dòng: sau dòng cuối có SĐT, ô Sale trống
const ld = await C.addLead(x, { name: 'Chị Lan', phone: '0922222222', channel: 'Facebook', by: 'Website', auto: true, note: 'Để lại số qua Messenger' });
assert.equal(ld.owner, '');
let r = await S.qcBotRow(x, { phone: '0922222222', name: 'Chị Lan', owner: '', hints: ['', 'giá bữa ăn', 'Thực Dưỡng Lành'], note: '🤖 Trợ lý Fanpage' });
assert.equal(r.ok, true); assert.equal(r.tab, 'Bữa Ăn VTG'); assert.equal(r.row, 3);
const w1 = JSON.parse(env.__mockWrites.pop().body).data.map(d => d.range + '=' + d.values[0][0]);
assert.ok(w1.includes("'Bữa Ăn VTG'!C3='0922222222") && w1.includes("'Bữa Ăn VTG'!B3=Chị Lan") && !w1.some(s => /!D3/.test(s)), 'không điền Sale: ' + w1.join(' | '));

// file đã có số này hôm nay → không ghi lại
book.sheets['Bữa Ăn VTG'].push([dmy, 'Chị Lan', '0922222222', '', '🤖 Trợ lý Fanpage']);
r = await S.qcBotRow(x, { phone: '0922222222', name: 'Chị Lan', hints: ['bữa ăn'] }); assert.equal(r.dup, true);

// 🚨 chưa ai nhận ≥ 15 phút → báo Quản trị + Quản lý
raw.prepare("UPDATE leads SET time = ? WHERE phone = '0922222222'").run(now - 20 * 60e3);
const sent = []; const send = async (_, n, t) => { sent.push([n, t]); };
const M = await import('file://' + ROOT + '/api/src/salemkt.js');
await M.adsNoOwnerCheck(x, send, {}, now, 10 * 60);
assert.deepEqual(sent.map(z => z[0]).sort(), ['Thu Thủy', 'Thái Sơn']); assert.ok(sent[0][1].includes('0922222222') && sent[0][1].includes('chờ <b>20 phút</b>'));
sent.length = 0; await M.adsNoOwnerCheck(x, send, {}, now + 10 * 60e3, 10 * 60); assert.equal(sent.length, 0, 'chưa đủ 30 phút, không có số mới → không báo lại');
await M.adsNoOwnerCheck(x, send, {}, now + 31 * 60e3, 10 * 60); assert.equal(sent.length, 2, 'vẫn chưa ai nhận → 30 phút báo lại');
sent.length = 0; await M.adsNoOwnerCheck(x, send, {}, now + 2 * 3600e3, 23 * 60); assert.equal(sent.length, 0, 'đêm không báo');

// sale điền tên → lượt đọc file giao khách đó, không tạo khách trùng
book.sheets['Bữa Ăn VTG'][2][3] = 'Lương';
const res = await S.adsSync(x, null, false, true);
assert.equal(res.assigned, 1, JSON.stringify(res));
const L = raw.prepare("SELECT owner, by_name FROM leads WHERE phone = '0922222222'").all();
assert.equal(L.length, 1, 'không tạo trùng'); assert.equal(L[0].owner, 'Lương');
assert.ok(tg.some(t => t.startsWith('95 ') && t.includes('Số mới cho bạn')), 'Telegram sale: ' + tg.join(' | '));
sent.length = 0; await M.adsNoOwnerCheck(x, send, {}, now + 3 * 3600e3, 10 * 60); assert.equal(sent.length, 0, 'đã giao → hết cảnh báo');
console.log('✅ test-fbqc: OK');
