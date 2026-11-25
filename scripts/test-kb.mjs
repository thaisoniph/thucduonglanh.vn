// 💸 Thử kb() (api/src/chat.js): gọi mấy lần liền phải ra CÙNG một bản, có Sổ tay (25/11/2026: lần gọi lại từng thiếu Sổ tay → cache AI không dùng lại được).
// Chạy: node scripts/test-kb.mjs   (không gọi AI, không tốn tiền)
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
const ROOT = fileURLToPath(new URL('..', import.meta.url)).replace(/\/$/, '');
let hits = 0;
globalThis.fetch = async url => { // web giả: file kiến thức + Sổ tay
  hits++;
  if (String(url).includes('chat-kb.txt')) return new Response('# Thực Dưỡng Lành\n' + 'x'.repeat(3000));
  return new Response(JSON.stringify({ vars: { hotline: '0966 326 522' }, seed: [{ id: 'a', group: '📜 Chính sách', title: 'Đổi trả', body: 'Gọi {hotline}', status: 'Đã xác nhận' }] }));
};
const { kb } = await import('file://' + ROOT + '/api/src/chat.js');
const { usdOf } = await import('file://' + ROOT + '/api/src/aiuse.js');
const a = await kb(), n = hits, b = await kb(), c = await kb();
assert.ok(a.includes('# SỔ TAY DOANH NGHIỆP') && a.includes('Gọi 0966 326 522'), 'lần đầu phải có Sổ tay');
assert.equal(b, a, 'lần 2 phải giống hệt lần đầu'); assert.equal(c, a, 'lần 3 phải giống hệt lần đầu');
assert.equal(hits, n, 'gọi lại trong 10 phút không tải lại web');
// giá: Sonnet 5.5 ghi cache 1 giờ = 2 × giá vào ($4 / triệu), ghi 5 phút = $2,5 / triệu
assert.equal(usdOf('claude-sonnet-5-5', { cache_creation_input_tokens: 1e6, cache_creation: { ephemeral_1h_input_tokens: 1e6 } }), 4);
assert.equal(usdOf('claude-sonnet-5-5', { cache_creation_input_tokens: 1e6 }), 2.5);
console.log('✅ kb() ổn định + giá cache 1 giờ đúng');
