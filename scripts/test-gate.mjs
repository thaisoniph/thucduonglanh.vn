// 🛡 Thử người gác cổng (api/src/gate.js) với dữ liệu web thật: python3 build.py && node scripts/test-gate.mjs
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
const ROOT = process.argv[2] || fileURLToPath(new URL('..', import.meta.url)).replace(/\/$/, '');
const G = await import('file://' + ROOT + '/api/src/gate.js');
const kb = fs.readFileSync(ROOT + '/dist/chat-kb.txt', 'utf8');
const T = [
 ['ĐÚNG', 'Dạ hộp Bữa Ăn Dinh Dưỡng 500g giá 450.000đ ạ, đơn từ 300.000đ là được miễn phí ship nha chị.'],
 ['ĐÚNG', 'Dạ trà DILVANG 155k một hộp, combo 3 hộp 435k ạ. Mình gọi 0966 326 522 nha.'],
 ['ĐÚNG', 'Dạ cô ơi, sữa hạt bên con dùng đường cỏ ngọt, cô nhớ đo đường huyết và hỏi bác sĩ đang điều trị cho cô trước nha.'],
 ['ĐÚNG', 'Dạ sản phẩm là thực phẩm, không phải là thuốc và không có tác dụng thay thế thuốc chữa bệnh ạ.'],
 ['ĐÚNG', 'Dạ phí ship 30.000đ ạ, 2 hộp là 900.000đ, nhập mã SONGLANH5 được giảm 5% nha.'],
 ['SAI GIÁ', 'Dạ hộp Bữa Ăn chỉ 390.000đ thôi chị ạ.'],
 ['SAI GIÁ', 'Dạ miễn phí ship cho đơn từ 200k nha anh.'],
 ['SAI KM', 'Dạ hôm nay bên em giảm 30% cho mọi đơn ạ, nhập mã TET2027 nha.'],
 ['SAI SĐT', 'Dạ chị gọi số 0896 869 333 giúp em nha.'],
 ['SAI CÔNG DỤNG', 'Dạ trà DILVANG giúp lợi sữa cho mẹ sau sinh ạ.'],
 ['SAI CÔNG DỤNG', 'Dạ uống đều giúp giảm cân hiệu quả lắm chị.'],
 ['BỆNH', 'Dạ Curcumin hỗ trợ dạ dày và trào ngược rất tốt ạ.'],
 ['BỆNH', 'Dạ sản phẩm giúp hạ huyết áp cho bác ạ.'],
 ['BỆNH', 'Dạ dùng sữa hạt này khỏi bệnh tiểu đường luôn cô ạ.'],
 ['HỨA', 'Dạ em cam kết hiệu quả, sau 7 ngày là hết mệt ạ.'],
 ['DOẠ', 'Nếu không uống sớm thì để lâu dễ bị đột quỵ lắm chị ạ.'],
];
let bad = 0;
for (const [want, t] of T) { const w = G.gateCheck(t, kb, { q: '' }); const pass = w.length === 0; const ok = (want === 'ĐÚNG') === pass; if (!ok) bad++; console.log((ok ? '✅' : '❌') + ' [' + want + '] ' + t.slice(0, 60) + (w.length ? '\n     → ' + w.map(v => v.k + ': ' + v.t).join(' | ') : '')); }
console.log('sai:', bad);
