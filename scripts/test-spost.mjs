// 🗂 Thử ✨ Viết bài Kho bài (api/src/spost.js spWrite) bằng AI giả + SQLite trong máy: kho ảnh nằm trong phần system được lưu đệm, bài sau không lặp ảnh bài trước.
// Chạy: python3 build.py && node scripts/test-spost.mjs   (không gọi AI thật, không tốn tiền)
import { DatabaseSync } from 'node:sqlite';
import { readFileSync } from 'node:fs';
const sq = new DatabaseSync(':memory:');
const D1 = { prepare(sql) { return { _a: [], bind(...a) { this._a = a.map(v => v === undefined ? null : typeof v === 'boolean' ? Number(v) : v); return this; },
  async all() { return { results: sq.prepare(sql).all(...this._a) }; }, async first() { return sq.prepare(sql).get(...this._a) || null; }, async run() { const r = sq.prepare(sql).run(...this._a); return { meta: { changes: r.changes, last_row_id: Number(r.lastInsertRowid) } }; } }; } };
sq.exec('CREATE TABLE kv (k TEXT PRIMARY KEY, v TEXT, exp INTEGER); CREATE TABLE logs (what TEXT, by_name TEXT, result TEXT, time INTEGER)');
const KB = readFileSync(new URL('../dist/chat-kb.txt', import.meta.url), 'utf8');
const IMGS = Array.from({ length: 20 }, (_, i) => ({ url: 'https://thucduonglanh.vn/assets/uploads/anh-' + (i + 1) + '.webp', alt: 'Ảnh thử số ' + (i + 1) }));
const calls = []; let pick = '2';
globalThis.fetch = async (url, init) => {
  url = String(url);
  if (url.includes('chat-kb.txt')) return new Response(KB);
  if (url.includes('anh-zalo.json')) return new Response(JSON.stringify(IMGS), { headers: { 'content-type': 'application/json' } });
  if (url.includes('anthropic.com')) {
    const body = JSON.parse(init.body); calls.push(body);
    const text = 'NHÓM KHÁCH: x\nISSUE: x\nTENSION: a ↔ b\nINSIGHT: t\nIDEA: y\n---\nBÀI:\n' + 'Nội dung bài thử dài dài. '.repeat(12) + '\nBÌNH LUẬN GHIM:\nMời vào nhóm\nTRẢ LỜI CÓ LINK:\nĐây [LINK]\nBÀI HỘI NHÓM:\nabc\nNHẬT KÝ ZALO:\nabc [LINK]\nTIN ZALO:\nabc [LINK]\nGỢI Ý ẢNH:\nly trà\nẢNH SỐ: ' + pick;
    return new Response(JSON.stringify({ id: 'm', type: 'message', role: 'assistant', model: body.model, content: [{ type: 'text', text }], stop_reason: 'end_turn', usage: { input_tokens: 10, output_tokens: 10 } }), { headers: { 'content-type': 'application/json' } });
  }
  return new Response('{}', { headers: { 'content-type': 'application/json' } }); // so-tay.json…
};
const P = await import('../api/src/spost.js');
const ok = (c, m) => { if (!c) { console.error('❌', m); process.exitCode = 1; } else console.log('✅', m); };
const x = { db: D1, env: { DB: D1, ANTHROPIC_API_KEY: 'x' }, later() { } }, u = { name: 'Thử', level: 3, role: 'Quản trị' };
const write = () => P.crmSpf(x, u, { action: 'spf_write', c: 'TOFU' }, async () => { });

const a = await write(); // bài 1: AI chọn ảnh 2
ok(a.ok && a.post.img.endsWith('anh-2.webp'), 'bài 1 lấy ảnh số 2: ' + (a.post && a.post.img));
pick = '2, 5'; // bài 2: AI lỡ chọn lại ảnh 2, kèm số dự phòng 5
const b = await write();
ok(b.ok && b.post.img.endsWith('anh-5.webp'), 'bài 2 bỏ ảnh 2 vừa dùng, lấy số dự phòng 5: ' + (b.post && b.post.img));
const [c1, c2] = calls, last = c2.system.at(-1), ask2 = c2.messages[0].content;
ok(JSON.stringify(c1.system) === JSON.stringify(c2.system), '2 bài có phần system giống hệt (lưu đệm dùng lại được)');
ok(last.text.startsWith('KHO ẢNH THẬT') && last.text.includes('20. Ảnh thử số 20') && last.cache_control && c2.system.filter(s => s.cache_control).length === 1, 'kho ảnh đủ 20 ảnh nằm ở khối system cuối, có mốc lưu đệm');
ok(!ask2.includes('Ảnh thử số') && /KHÔNG lấy các số vừa dùng cho bài khác: 2[;,]/.test(ask2) && !c1.messages[0].content.includes('KHÔNG lấy các số'), 'lời nhắn mỗi bài không gửi lại danh sách, chỉ gửi số ảnh cần tránh');
pick = '2'; const c = await write(); // AI chỉ đưa ảnh đã dùng → không gắn ảnh lặp (bài nhận biết không có ảnh sản phẩm thay thế)
ok(c.ok && c.post.img === '', 'AI chỉ chọn ảnh đã dùng → để trống, không lặp ảnh');
console.log(process.exitCode ? 'CÓ LỖI' : 'Tất cả đều ổn');
