// Thử 🔥 Radar trend (insight.js): giai đoạn + mục tiêu ô 🔥, 🔍 AI xét trend (AI giả), góc kể 17–18, dòng trend trong tin thứ Hai. Chạy: node scripts/test-trend.mjs
import { DatabaseSync } from 'node:sqlite';
import { fileURLToPath } from 'node:url';
const ROOT = fileURLToPath(new URL('..', import.meta.url)).replace(/\/$/, '');
const raw = new DatabaseSync(':memory:');
const DB = { prepare(sql) { const st = raw.prepare(sql); let a = []; const o = { bind(...x) { a = x.map(v => v === undefined ? null : typeof v === 'boolean' ? (v ? 1 : 0) : v); return o; }, async all() { return { results: st.all(...a) }; }, async first() { return st.get(...a) || null; }, async run() { const r = st.run(...a); return { meta: { last_row_id: Number(r.lastInsertRowid), changes: r.changes } }; } }; return o; }, exec: async s => raw.exec(s), batch: async L => Promise.all(L.map(s => s.run())) };
raw.exec('CREATE TABLE kv (k TEXT PRIMARY KEY, v TEXT, exp INTEGER)');
let aiReply = null, aiAsk = '';
const realFetch = globalThis.fetch;
globalThis.fetch = async (url, init) => {
  if (String(url).includes('anthropic')) { aiAsk = String(init && init.body || ''); return new Response(JSON.stringify({ id: 'm', type: 'message', role: 'assistant', model: 'claude-sonnet-5-5', content: [{ type: 'text', text: JSON.stringify(aiReply) }], stop_reason: 'end_turn', usage: { input_tokens: 10, output_tokens: 10 } }), { headers: { 'content-type': 'application/json' } }); }
  if (/thucduonglanh\.vn/.test(String(url))) return new Response('{}', { headers: { 'content-type': 'application/json' } });
  return realFetch(url, init);
};
const I = await import('file://' + ROOT + '/api/src/insight.js');
const x = { env: { DB, ANTHROPIC_API_KEY: 'test' }, db: DB, later: () => { } };
const mk = { name: 'Phạm Thu Hà', role: 'Marketing', level: 0 }, sale = { name: 'Sale A', role: 'Sale', level: 1 };
const log = async () => { };
let bad = 0; const ok = (c, m) => { console.log((c ? '✅ ' : '❌ ') + m); if (!c) bad++; };
const kv = async k => { const r = raw.prepare('SELECT v, exp FROM kv WHERE k = ?').get(k); return r ? { v: JSON.parse(r.v), exp: r.exp } : null; };

// 1. ô 🔥: giai đoạn + mục tiêu, hạn giữ
let r = await I.crmIns(x, mk, { action: 'ins_trend', t: 'Cả mạng đăng mâm cơm 3 món', st: 3, goal: 'cmt' }, log);
ok(r.ok && r.trend.st === 3 && r.trend.goal === 'cmt', 'Lưu ô 🔥 có giai đoạn 3 + mục tiêu bình luận');
let k = await kv('ins_trend'); ok(k && k.exp && Math.abs(k.exp - Date.now() - 86400e3) < 120e3, 'Giai đoạn 3 giữ 1 ngày (exp ' + (k && k.exp) + ')');
r = await I.crmIns(x, mk, { action: 'ins_trend', t: 'Chuyện mới nổi', st: 7, goal: 'xx' }, log);
k = await kv('ins_trend'); ok(r.trend.st === 2 && r.trend.goal === '' && Math.abs(k.exp - Date.now() - 3 * 86400e3) < 120e3, 'Giai đoạn lạ → 2, giữ 3 ngày, mục tiêu lạ bỏ');
// 2. insBlock đọc giai đoạn + mục tiêu
const p = await I.insPick(x, 'fb');
p.trend = { t: 'Trend X', at: Date.now(), st: 3, goal: 'share' };
let b = I.insBlock(p, 'TOFU'); ok(/Lây lan bùng nổ/.test(b) && /BẮT BUỘC có góc nhìn mới/.test(b) && /CHIA SẺ \/ LƯU LẠI/.test(b), 'insBlock: giai đoạn 3 bắt buộc góc mới + mục tiêu khớp MỤC TIÊU TƯƠNG TÁC');
p.trend = { t: 'Trend cũ', at: Date.now() }; b = I.insBlock(p, 'TOFU'); ok(/Trend cũ/.test(b) && !/Giai đoạn của chuyện/.test(b), 'Dữ liệu cũ không có giai đoạn vẫn chạy');
// 3. góc kể
ok(I.ANGLES.length === 18 && /^Bản chất của/.test(I.ANGLES[16]) && /^Bắt cầu/.test(I.ANGLES[17]), 'Kho góc kể có 18 góc, 17 Bản chất của…, 18 Bắt cầu');
ok(/Bắt cầu/.test(I.insBlock(Object.assign({}, p, { big: null }), 'TOFU')), 'insBlock đưa góc mới vào kho xoay vòng');
// 4. AI xét trend
r = await I.crmIns(x, sale, { action: 'ins_trendai', t: 'Chuyện gì đó đang nóng lắm' }, log); ok(!r.ok, 'Sale không dùng được 🔍 AI xét trend');
aiReply = { list: [
  { chuyen: 'Mâm cơm 3 món — ai cũng đăng', gd: 2, dau: ['nhiều người lặp câu', 'báo chưa viết'], song: '2 ngày', lam: true, ly: 'Mới nổi', nhom: 'Mẹ bỉm', tension: 'Muốn nấu ngon nhưng không có thời gian', goal: 'cmt', huong: [{ goc: 'Khoảnh khắc', y: 'Bữa tối 6h', mo: 'Nhà mình mấy món?' }, { goc: 'Bắt cầu', y: 'b', mo: 'c' }, { goc: 'Hai trường phái', y: 'd', mo: 'e' }], cau: 'Mọi người đang khoe mâm cơm 3 món, đi góc bữa cơm vội của mẹ bỉm', luat: '' },
  { chuyen: 'Vụ tai nạn', gd: 3, lam: true, ly: 'x', tension: '', huong: [{ y: 'z' }], cau: 'abc' }] };
r = await I.crmIns(x, mk, { action: 'ins_trendai', t: '1) Mâm cơm 3 món 2) Vụ tai nạn' }, log);
ok(r.ok && r.list.length === 2, 'AI xét trend trả 2 chuyện');
ok(r.list[0].lam && r.list[0].st === 2 && r.list[0].goal === 'cmt' && r.list[0].huong.length === 3 && !/—/.test(r.list[0].chuyen), 'Chuyện 1: LÀM, giai đoạn 2, 3 hướng, bỏ gạch ngang dài');
ok(!r.list[1].lam && !r.list[1].cau && !r.list[1].huong.length, 'Chuyện 2 không có tension → coi là BỎ, không có câu lưu');
ok(/LUẬT ĐỎ/.test(aiAsk) && /tin buồn, tai nạn/.test(aiAsk) && /Không gắn sản phẩm vào trend/.test(aiAsk) && /NGÂN HÀNG INSIGHT/.test(aiAsk), 'Prompt có luật đỏ + ngân hàng insight');
aiReply = { nope: 1 }; r = await I.crmIns(x, mk, { action: 'ins_trendai', t: 'Một chuyện khác đang nóng' }, log); ok(!r.ok, 'AI trả sai định dạng → báo bấm lại');
// 5. tin thứ Hai
const w = await I.insWeekly(x);
ok(/Radar trend 7 ngày: ghi 2 trend/.test(w) && /giai đoạn 2: 1 · giai đoạn 3: 1/.test(w) && /AI xét 2 chuyện, 1 chuyện nên làm/.test(w), 'Tin thứ Hai đếm trend theo giai đoạn + số chuyện AI xét');
raw.exec("DELETE FROM kv WHERE k = 'ins_trend_log'");
ok(/mỗi sáng dán 2–3 chuyện/.test(await I.insWeekly(x)), 'Chưa xét trend → nhắc dùng 🔍 AI xét trend');
console.log(bad ? '❌ ' + bad + ' lỗi' : '✅ Tất cả đều đúng'); process.exit(bad ? 1 : 0);
