/* ================================================================ 📣 Bài viết sẵn cho sale đăng Facebook CÁ NHÂN (11/11/2026, khoá content K131 Buổi 6, anh Sơn duyệt đợt 2)
 * Khoá học: "AI viết, người đăng" (Facebook cá nhân không để AI tự đăng) + kỹ thuật ghim bình luận:
 *   đăng bài KHÔNG có link → chờ bài có tương tác → viết 1 bình luận KHÔNG link (Facebook không cho ghim bình luận có link) → trả lời ngay dưới bình luận đó bằng link → ghim bình luận chính (bằng điện thoại).
 * Ở đây: Marketing / Quản lý / Quản trị bấm ✨ Viết 1 bài (theo nhóm khách + tension + big idea / góc kể như mọi trợ lý: insPick kênh 'fbcn')
 *   → nháp → ✅ Cho sale dùng → sale mở 📣 Bài đăng Facebook cá nhân, copy bài / bình luận ghim / câu trả lời có LINK RIÊNG ?ref= của mình (đơn trong 30 ngày tính cho sale).
 * Bảng D1 sp_posts. Lệnh spf_* (crm.js chuyển sang crmSpf). Đếm số lần sale copy (copies) để biết bài nào được dùng. */
import Anthropic from '@anthropic-ai/sdk';
import { aiFetch } from './airelay.js';
import { run, all, first, kvGet, kvSet, kvJson, fmtDate, nrm, DAY } from './lib.js';
import { edAdd, edBlock, edCount } from './edlearn.js';
import { kb, safe, TRUTH_RULES } from './chat.js';
import { telegramTo, telegram } from './google.js';
import { imgLib, prodMap } from './zbot.js';
import { offersLive } from './salemkt.js';
import { insPick, insBlock, insParse, insLog, insRisk, insViet, insStyle, canIns, INS_HEAD, funOf } from './insight.js';

const WRITER = 'claude-sonnet-5-5'; // 27/11/2026 anh Sơn: tối ưu chi phí Opus → Sonnet 5.5 (rẻ ½); muốn Opus lại thì chọn ở CRM → Cài đặt → 🤖 Chi phí AI → 🎛
/** Lối ra của bình luận ghim: đường dẫn trên web (CRM tự gắn ?ref= của sale) + mô tả cho AI */
export const SPF_TO = {
  nhom: ['/nhom-zalo/', 'Vào nhóm Zalo', 'vào nhóm Zalo "Sống khỏe cùng Thực Dưỡng Lành" (mẹo sống khỏe mỗi ngày, hỏi đáp, quà cho thành viên), miễn phí'],
  qua: ['/qua-tang/', 'Nhận quà tặng', 'nhận quà tặng miễn phí trên website Thực Dưỡng Lành (cẩm nang sống khỏe)'],
  web: ['/', 'Trang chủ web', 'xem website Thực Dưỡng Lành (sản phẩm, ưu đãi, đặt hàng có kiểm hàng)'],
  tet: ['/qua-tet/', 'Quà Tết 2027', 'xem 3 set quà Tết Sống khỏe chủ động trên website, gửi thẳng tới bố mẹ, đặt trước 27/1/2027'] // chiến dịch Tết 2027 (V-2026-11-022); sau Tết bỏ dòng này
};
/** 🗂 Kho bài (23/11/2026, chị Thủy góp ý: sale phải THẤY ảnh + chữ trước khi chọn, lọc được, kho sẵn ~30 bài).
 * Tỉ lệ theo 3 tầng phễu khoá Content (anh Sơn 23/11: "tỷ lệ bài là theo 3 tầng phễu"): 60/20/20, tên + % sửa được ở màn quản lý (kv spf_mix).
 * k = tầng (TOFU/MOFU/BOFU), pr = có gắn 1 sản phẩm không (1 luôn · 0.5 nửa số bài · 0 không). */
export const SPF_CAT0 = [
  { k: 'TOFU', n: '🔵 Nhận biết', p: 60, pr: 0, d: 'chuyện đời thường, mẹo ăn uống, giấc ngủ, sức khoẻ cả nhà chạm đúng nỗi lo của nhóm khách; KHÔNG nhắc sản phẩm, KHÔNG bán' },
  { k: 'MOFU', n: '⚪ Tạo niềm tin', p: 20, pr: 0.5, d: 'chuyện nghề của chính người đăng (một ngày đi làm, vì sao chọn nguyên liệu, cách làm, câu khách hay hỏi và cách mình giải thích), được kể khoảnh khắc mình / người nhà dùng 1 sản phẩm; không giá, không bán thẳng' },
  { k: 'BOFU', n: '🟠 Chốt đơn', p: 20, pr: 1, d: '1 sản phẩm cụ thể gỡ đúng nỗi lo (ai hợp, dùng lúc nào, cách dùng), ưu đãi thật đang chạy nếu có, lời mời rõ ràng; link vẫn chỉ nằm ở câu trả lời dưới bình luận ghim' }
];
async function spCats(x) { let m = {}; try { m = JSON.parse(await kvGet(x.db, 'spf_mix') || '{}') || {}; } catch (e) { } return SPF_CAT0.map(c => Object.assign({}, c, m[c.k] && m[c.k].n ? { n: String(m[c.k].n).slice(0, 40) } : {}, m[c.k] && m[c.k].p != null ? { p: Math.max(0, Math.min(100, Number(m[c.k].p) || 0)) } : {})); }
/** Ảnh thật trong kho web (anh-zalo.json) cho AI chọn: danh sách đánh số + đọc số AI trả về */
const libAsk = lib => lib.length ? 'KHO ẢNH THẬT (số. mô tả) – chọn 1 ảnh khớp rõ nhất với chuyện trong bài; không ảnh nào khớp thì ghi "không":\n' + lib.slice(0, 120).map((i, n) => (n + 1) + '. ' + String(i.alt || '').slice(0, 120)).join('\n') : '';
/** AI ghi "ẢNH SỐ: 12" hoặc "12, 40" (kèm số dự phòng) → ảnh đầu tiên có trong kho và không nằm trong `skip` (số ảnh vừa dùng gần đây) */
const libGet = (lib, raw, skip) => { const m = String(raw || '').match(/ẢNH SỐ\**\s*:\**\s*([\d ,;]+)/i), n = m ? m[1].split(/\D+/).map(Number).find(k => lib[k - 1] && !(skip && skip.has(k))) : 0; return n ? String(lib[n - 1].url || '') : ''; };
const cut = (s, n) => String(s == null ? '' : s).trim().slice(0, n);
let client = null, schemaOk = false;
function ai(env) { if (!client) client = new Anthropic({ apiKey: env.ANTHROPIC_API_KEY, maxRetries: 1, timeout: 120e3, fetch: aiFetch(env), defaultHeaders: { 'x-tdl-muc': 'fb-ca-nhan' } }); return client; }
async function schema(db) {
  if (schemaOk) return;
  await run(db, `CREATE TABLE IF NOT EXISTS sp_posts (id INTEGER PRIMARY KEY AUTOINCREMENT, at INTEGER, by_name TEXT DEFAULT '', f TEXT DEFAULT '', ins TEXT DEFAULT '',
    text TEXT DEFAULT '', cmt TEXT DEFAULT '', reply TEXT DEFAULT '', to_k TEXT DEFAULT 'nhom', status TEXT DEFAULT 'draft', copies INTEGER DEFAULT 0, ok_by TEXT DEFAULT '', ok_at INTEGER)`);
  for (const c of ["src TEXT DEFAULT ''", "src_ref TEXT DEFAULT ''", "path TEXT DEFAULT ''", "title TEXT DEFAULT ''", "zmsg TEXT DEFAULT ''", "grp TEXT DEFAULT ''", "znk TEXT DEFAULT ''", "imgh TEXT DEFAULT ''", "img TEXT DEFAULT ''", "cat TEXT DEFAULT ''", "prod TEXT DEFAULT ''"]) { try { await run(db, 'ALTER TABLE sp_posts ADD COLUMN ' + c); } catch (e) { } } // 13/11/2026: 1 bài → nhiều kênh (bài web / bài nhóm Zalo → bài FB cá nhân + tin Zalo gửi khách)
  await run(db, 'CREATE TABLE IF NOT EXISTS sp_hits (post INTEGER, ref TEXT, day TEXT, n INTEGER DEFAULT 0, PRIMARY KEY (post, ref, day))'); // 👆 lượt khách bấm link trong bài sale đăng (web gửi spf_hit)
  await run(db, 'CREATE TABLE IF NOT EXISTS sp_conv (oid TEXT PRIMARY KEY, post INTEGER, ref TEXT, total INTEGER DEFAULT 0, at INTEGER)'); // 🛒 đơn web đặt sau khi bấm link trong bài (30 ngày)
  await run(db, 'CREATE TABLE IF NOT EXISTS zb_imgs (id TEXT PRIMARY KEY, data TEXT, at INTEGER)'); // ảnh tải từ máy (dùng chung với trợ lý Zalo, xem ở /zb-img/<id>)
  schemaOk = true;
}
const canEdit = u => !!u && (u.level >= 2 || u.role === 'Marketing');
const shape = (r, full) => {
  let ins = {}; try { ins = JSON.parse(r.ins || '{}') || {}; } catch (e) { }
  const o = { id: r.id, at: r.at, f: r.f, text: r.text, cmt: r.cmt, reply: r.reply, to: SPF_TO[r.to_k] ? r.to_k : 'nhom', path: r.path || (SPF_TO[r.to_k] || SPF_TO.nhom)[0], status: r.status, copies: r.copies || 0, gn: ins.gn || '',
    src: r.src || '', title: r.title || '', zmsg: r.zmsg || '', grp: r.grp || '', znk: r.znk || '', imgh: r.imgh || '', img: r.img || '', cat: r.cat || r.f || '', prod: r.prod || '' }; // imgh: gợi ý ảnh thật nên chụp; img: ảnh bài web gốc (bài chuyển thể) // 13/11/2026: mỗi bài sẵn 3 kênh: Facebook cá nhân · hội nhóm Facebook (grp) · nhật ký Zalo (znk) + tin Zalo gửi khách (zmsg)
  if (full) Object.assign(o, { by: r.by_name, ok_by: r.ok_by, ins: Object.assign(ins, { w: insRisk([r.text, r.cmt, r.reply].join('\n')), v: insStyle(r.text) }) });
  return o;
};

async function spWrite(x, u, d) {
  if (!x.env.ANTHROPIC_API_KEY) return { ok: false, error: 'Máy chủ chưa có khoá AI.' };
  const cats = await spCats(x), cat = cats.find(c => c.k === d.c) || null, to = SPF_TO[d.to] ? d.to : 'nhom', hint = cut(d.hint, 600);
  const f = cat ? cat.k : ['MOFU', 'BOFU'].includes(funOf(d.f)) ? funOf(d.f) : 'TOFU';
  const know = await kb(), prods = prodMap(know), pk = Object.keys(prods), libAll = await imgLib();
  const usedImg = new Set((await all(x.db, "SELECT img FROM sp_posts WHERE img != '' ORDER BY id DESC LIMIT 25")).map(r => String(r.img).replace(/^https?:\/\/[^/]+/, '')));
  // 🖼 tránh ảnh 25 bài gần nhất đã dùng → ảnh không lặp giữa các bài (còn < 15 ảnh mới thì cho dùng lại).
  // 💸 25/11/2026: danh sách ảnh giờ luôn đủ + đánh số cố định, nằm trong phần system được lưu đệm; mỗi bài chỉ gửi các SỐ cần tránh (`skip`), máy chủ cũng tự bỏ số đó (trước: mỗi bài gửi lại cả danh sách đã lọc, không lưu đệm được)
  const pathOf = i => String(i.url || '').replace(/^https?:\/\/[^/]+/, ''), lib = libAll.slice(0, 120);
  const skip = new Set(libAll.filter(i => !usedImg.has(pathOf(i))).length >= 15 ? lib.map((i, n) => usedImg.has(pathOf(i)) ? n + 1 : 0).filter(Boolean) : []);
  const prod = prods[d.prod] ? d.prod : f === 'BOFU' && pk.length ? pk[Math.floor(Math.random() * pk.length)] : ''; // bài 🟠 chưa chọn sản phẩm → chọn ngẫu nhiên
  const offers = f === 'BOFU' ? await offersLive(x).catch(() => []) : [];
  const p = await insPick(x, 'fbcn', cut(d.g, 80), { prod, f });
  if (!p.g) return { ok: false, error: 'Ngân hàng insight chưa có nhóm khách nào đang bật.' };
  const ask = [
    'Viết 1 bài để NHÂN VIÊN TƯ VẤN của Thực Dưỡng Lành tự đăng trên FACEBOOK CÁ NHÂN của họ (không phải fanpage). Bạn bè của họ là người quen, đồng nghiệp cũ, hàng xóm, phụ huynh cùng lớp con… Bài phải đọc như người thật kể chuyện đời thường, KHÔNG giống quảng cáo.',
    'Mục tiêu: bài được bạn bè bình luận, chia sẻ (bài nhận biết / tạo niềm tin). Việc dẫn khách nằm ở BÌNH LUẬN GHIM, không nằm trong bài.',
    'Lối ra (chỉ dùng trong bình luận ghim và câu trả lời): mời ' + SPF_TO[to][2] + '.',
    hint ? 'Yêu cầu thêm của người giao việc: ' + hint : '',
    cat ? 'LOẠI BÀI: ' + cat.n.replace(/^\S+\s/, '') + ' – ' + cat.d + '.' : '',
    prod && f === 'TOFU' ? 'NHU CẦU CỦA BÀI: bài nhận biết dẫn dắt tới đúng nhu cầu / nỗi lo mà sản phẩm "' + prods[prod].name + '" đáp ứng (đọc TÀI LIỆU để biết), nhưng TRONG BÀI KHÔNG nhắc tên sản phẩm, không bán; người đọc thấy chuyện của mình trong bài.' :
    prod ? 'SẢN PHẨM CỦA BÀI: ' + prods[prod].name + ' (chỉ dùng thông tin của sản phẩm này trong TÀI LIỆU, đúng hồ sơ công bố).' : '',
    f === 'BOFU' ? (offers.length ? 'ƯU ĐÃI ĐANG CHẠY (chỉ nói đúng như sau, không thêm):\n' + offers.map(o => '- ' + [o.title, o.prod ? 'sản phẩm: ' + o.prod : '', o.text, o.until ? 'hạn đến ' + o.until : ''].filter(Boolean).join(' · ')).join('\n') : 'Hiện không có ưu đãi riêng: KHÔNG bịa khuyến mãi, chỉ được nhắc freeship đơn từ 300k và được kiểm hàng trước khi nhận.') : '',
    '', insBlock(p, f), '',
    await edBlock(x, 'sp'), // ✍️ 12/11/2026: học từ bài người duyệt đã sửa
    '# Văn phong: như NGƯỜI THẬT kể chuyện (storytelling), áp dụng cho mọi bản dưới',
    '- Mở bằng 1 KHOẢNH KHẮC CỤ THỂ có lúc, có chỗ (vd "Chiều qua tầm 3 giờ, ở văn phòng…", "Tối thứ Bảy về quê…"), KHÔNG mở bằng nhận định chung hay câu hỏi tu từ.',
    '- Mạch kể: chuyện xảy ra → điều mình để ý / từng nghĩ sai → 1 chuyển biến nhỏ → điều mình rút ra (nói như tâm sự, không răn dạy). Có 1–2 chi tiết giác quan (mùi, tiếng, nhiệt độ, màu) và 1 câu thoại ngắn ngoài đời trong ngoặc kép.',
    '- Câu ngắn dài xen kẽ, từ ngữ nói hằng ngày, được tự trào nhẹ. Bài Facebook cá nhân và nhật ký Zalo: KHÔNG gạch đầu dòng, KHÔNG đánh số 1-2-3 (người thật ít viết vậy). Bài hội nhóm được 2–3 ý ngắn nếu là mẹo.',
    '- Tránh văn AI: "Hóa ra", "Thật ra thì", "Có những…", "hành trình", "không chỉ… mà còn", "hãy cùng", "đừng quên", cảm thán sáo rỗng, câu kết kiểu khẩu hiệu.',
    '- Chuyện là của CHÍNH người đăng (bản thân, gia đình, đồng nghiệp, một ngày đi làm). KHÔNG bịa chuyện khách hàng, lời khách, kết quả dùng sản phẩm, số liệu.',
    '# Luật riêng của bài Facebook cá nhân',
    '- Xưng "mình", gọi người đọc "mọi người" / "các bạn" / "anh chị" hợp với nhóm khách. Kể từ góc nhìn của chính người đăng (một ngày làm việc, điều mình để ý, điều mình từng nghĩ sai). KHÔNG bịa lời khách, tên khách, câu chuyện khách cụ thể, số liệu, kết quả dùng sản phẩm.',
    '- 120–300 chữ, đoạn 1–3 câu. Câu cuối là 1 câu hỏi mở, dễ trả lời, để bạn bè bình luận (kể chuyện của họ, chọn A hay B).',
    '- TRONG BÀI: KHÔNG link, KHÔNG số điện thoại, KHÔNG giá, KHÔNG hashtag, KHÔNG "inbox / ib / nhắn mình". ' + (f === 'TOFU' ? 'Bài nhận biết: KHÔNG nhắc tên sản phẩm, chỉ có thể nhắc mình đang làm ở Thực Dưỡng Lành nếu thật tự nhiên.' : f === 'BOFU' ? 'Bài chốt đơn: nói thẳng về "' + (prod ? prods[prod].name : 'sản phẩm') + '" (ai hợp, dùng lúc nào, cách dùng trong ngày), ưu đãi thật nếu có, câu cuối mời bình luận "quan tâm" / hỏi để mình gửi thông tin; vẫn KHÔNG link, KHÔNG số điện thoại trong bài, được nói giá nếu TÀI LIỆU có giá đúng; không nói chữa / điều trị.' : prod ? 'Bài tạo niềm tin có sản phẩm: được nhắc tên "' + prods[prod].name + '" 1–2 lần, lồng trong chuyện kể (lúc dùng, cách pha, vì sao chọn), đúng TÀI LIỆU, không giá, không "mua ngay", không nói chữa / điều trị.' : f === 'TOFU' ? 'Bài nhận biết: KHÔNG nhắc tên sản phẩm, chỉ có thể nhắc mình đang làm ở Thực Dưỡng Lành nếu thật tự nhiên.' : 'Bài tạo niềm tin: được nhắc 1 lần chuyện nghề (nguồn gốc, cách làm, vì sao chọn nguyên liệu) theo đúng TÀI LIỆU, không bán, không giá.'),
    '- BÌNH LUẬN GHIM: 1–2 câu, KHÔNG có link (Facebook không cho ghim bình luận có link), nối tiếp câu chuyện trong bài rồi mời ' + SPF_TO[to][2] + ', nói rõ điều kiện thật (miễn phí, để lại tên và số Zalo nếu trang yêu cầu).',
    '- TRẢ LỜI CÓ LINK: 1 câu ngắn trả lời ngay dưới bình luận ghim, kết thúc bằng đúng chữ [LINK] (CRM tự thay bằng link riêng của từng nhân viên).',
    '# Bản cho kênh khác (cùng ý, viết lại cho hợp kênh, KHÔNG chép nguyên)',
    '- BÀI HỘI NHÓM: đăng vào hội nhóm Facebook (nhóm mẹ bỉm, ăn chay, hưu trí, khu phố…). 100–220 chữ, chia sẻ kinh nghiệm / mẹo có ích trước, KHÔNG giới thiệu mình bán hàng, KHÔNG tên sản phẩm, KHÔNG link, câu cuối hỏi ý kiến mọi người trong nhóm.',
    '- NHẬT KÝ ZALO: đăng nhật ký Zalo cá nhân (bạn bè Zalo là khách cũ, người quen). 60–120 chữ, ấm, gần gũi, được nhắc nhẹ mình làm ở Thực Dưỡng Lành, kết thúc bằng lời mời ngắn rồi đúng chữ [LINK].',
    '- TIN ZALO: tin nhắn riêng gửi khách cũ / người quen, 2–4 câu, gọi người nhận là [Tên], hỏi thăm 1 câu rồi chia sẻ ý chính, kết thúc đúng chữ [LINK].',
    '',
    'Trả về ĐÚNG định dạng (không lời dẫn):', INS_HEAD, '---', 'BÀI:', '<nội dung bài>', 'BÌNH LUẬN GHIM:', '<1–2 câu>', 'TRẢ LỜI CÓ LINK:', '<1 câu> [LINK]', 'BÀI HỘI NHÓM:', '<nội dung>', 'NHẬT KÝ ZALO:', '<nội dung> [LINK]', 'TIN ZALO:', '<2–4 câu> [LINK]', 'GỢI Ý ẢNH:', '<1 câu: ảnh THẬT người đăng tự chụp bằng điện thoại đúng khoảnh khắc trong bài (vd ly trà trên bàn làm việc, mâm cơm tối, góc bếp buổi sáng); không chụp mặt khách, không ảnh sản phẩm trơn, không banner, không chữ trên ảnh>', lib.length ? 'ẢNH SỐ:' : '', lib.length ? '<số của ảnh trong KHO ẢNH THẬT (ở phần hệ thống) khớp nhất' + (skip.size ? ', KHÔNG lấy các số vừa dùng cho bài khác: ' + [...skip].join(', ') : '') + '; được ghi thêm 1–2 số dự phòng, cách nhau dấu phẩy; không ảnh nào khớp thì ghi "không">' : ''
  ].join('\n');
  const sys = [{ type: 'text', text: 'Bạn là người viết nội dung mạng xã hội cho nhân viên Thực Dưỡng Lành (VitaGreen Nutrition): thực phẩm dinh dưỡng từ hạt, trà thảo mộc, đồ chay. Tiếng Việt đời thường, ấm, thật, đúng luật quảng cáo thực phẩm Việt Nam.\n' + TRUTH_RULES },
    { type: 'text', text: 'TÀI LIỆU (thông tin chính thức của Thực Dưỡng Lành):\n\n' + know }];
  if (lib.length) sys.push({ type: 'text', text: libAsk(lib) });
  sys.at(-1).cache_control = d.fill ? { type: 'ephemeral', ttl: '1h' } : { type: 'ephemeral' }; // 💸 mốc lưu đệm ở khối cuối (tài liệu + kho ảnh). Viết sẵn kho bài chạy 3 bài / 10 phút: lưu đệm 5 phút hết hạn giữa 2 lượt → giữ 1 giờ (ghi 1 lần, các bài sau chỉ đọc)
  const req = { model: WRITER, max_tokens: 9000, output_config: { effort: 'medium' }, // 13/11/2026: 5000 bị cụt phần Zalo + gợi ý ảnh ở bài dài · 25/11: effort từng nằm lọt trong chú thích này nên AI nghĩ ở mức cao nhất
    system: sys, messages: [{ role: 'user', content: ask }] };
  let res;
  try { res = await ai(x.env).beta.messages.create(Object.assign({ betas: ['server-side-fallback-2026-07-01'], fallbacks: 'default' }, req)); }
  catch (e) { if (!(e instanceof Anthropic.BadRequestError)) throw e; res = await ai(x.env).messages.create(req); }
  if (res.stop_reason === 'refusal') return { ok: false, error: 'AI từ chối viết bài này, thử đổi nhóm khách hoặc yêu cầu.' };
  const raw = res.content.filter(b => b.type === 'text').map(b => b.text).join('\n').trim(), parts = raw.split(/\n-{3,}\n/);
  const head = parts.length > 1 ? parts[0] : '', bodyAll = parts.length > 1 ? parts.slice(1).join('\n---\n') : raw;
  const grab = (k, next) => { const m = bodyAll.match(new RegExp('(?:^|\\n)\\s*\\**' + k + '\\**\\s*:\\**\\s*([\\s\\S]*?)' + (next ? '(?=\\n\\s*\\**' + next + ')' : '$'), 'i')); return m ? m[1].trim() : ''; };
  const clean = s => insViet(safe(s)).replace(/https?:\/\/\S+/g, '').trim();
  const text = clean(grab('BÀI', 'BÌNH LUẬN GHIM')), cmt = clean(grab('BÌNH LUẬN GHIM', 'TRẢ LỜI CÓ LINK')).replace(/\[LINK\]/g, '').trim();
  let reply = clean(grab('TRẢ LỜI CÓ LINK', 'BÀI HỘI NHÓM')); if (!/\[LINK\]/.test(reply)) reply = (reply || 'Link đây nhé') + ' [LINK]';
  const grp = clean(grab('BÀI HỘI NHÓM', 'NHẬT KÝ ZALO')).replace(/\[LINK\]/g, '').trim(), withL = s => s && !/\[LINK\]/.test(s) ? s + ' [LINK]' : s;
  const znk = withL(clean(grab('NHẬT KÝ ZALO', 'TIN ZALO'))), zmsg = withL(clean(grab('TIN ZALO', 'GỢI Ý ẢNH'))), imgh = clean(grab('GỢI Ý ẢNH', 'ẢNH SỐ') || grab('GỢI Ý ẢNH', '')).split('\n')[0];
  const img = libGet(lib, bodyAll, skip) ||(prod && f !== 'TOFU' && prods[prod].img) || ''; // bài nhận biết không dùng ảnh sản phẩm (lộ bán hàng) // 🖼 ảnh thật trong kho web; bài sản phẩm không có ảnh khớp → ảnh sản phẩm
  if (text.length < 120 || !cmt) return { ok: false, error: 'AI chưa viết đủ bài + bình luận ghim, bấm viết lại nhé.' };
  const ins = insParse(head, p.bank, p.g); if (p.angle) ins.a = p.angle; if (p.big) ins.b = p.big.t;
  const r = await run(x.db, 'INSERT INTO sp_posts (at, by_name, f, ins, text, cmt, reply, to_k, status, grp, znk, zmsg, imgh, img, cat, prod, path) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)', Date.now(), u.name, f, JSON.stringify(ins), text.slice(0, 5000), cmt.slice(0, 600), reply.slice(0, 400), to, 'draft', grp.slice(0, 4000), znk.slice(0, 1500), zmsg.slice(0, 1200), imgh.slice(0, 300), img.slice(0, 300), cat ? cat.k : f, prod,
    f === 'BOFU' && prod && to === 'web' ? String(prods[prod].url || '').replace(/^https?:\/\/[^/]+/, '') : ''); // 🟠 bài chốt đơn: link thẳng tới trang sản phẩm thay vì trang chủ
  const id = r && r.meta && r.meta.last_row_id;
  await insLog(x, 'fbcn', { g: ins.g, gn: ins.gn, f, t: ins.t, ref: 'sp' + id, a: ins.a, b: ins.b });
  return { ok: true, post: shape(await first(x.db, 'SELECT * FROM sp_posts WHERE id = ?', id), true) };
}

/** 🗂 1 lần (23/11/2026): bài cũ chuyển từ nhóm Zalo chưa có ảnh → lấy lại ảnh của bài Zalo gốc; loại bài = tầng phễu cũ. Bài khác chưa có ảnh: sale không thấy tới khi Marketing 🖼 gắn ảnh. */
async function spBackfill(x) {
  if (!(await kvGet(x.db, 'spf_bf2'))) { // 23/11 (2): bài cũ từ nhóm Zalo lấy nhóm khách + tầng phễu của bài gốc → sale lọc được theo nhóm khách
    for (const r of await all(x.db, "SELECT id, src_ref FROM sp_posts WHERE src = 'zalo' AND src_ref LIKE 'zalo:%' AND (ins = '' OR ins = '{}')")) {
      const z = await first(x.db, 'SELECT ins, funnel FROM zb_posts WHERE id = ?', r.src_ref.slice(5)).catch(() => null);
      if (z && z.ins && z.ins !== '{}') await run(x.db, "UPDATE sp_posts SET ins = ?, cat = CASE WHEN ? IN ('TOFU', 'MOFU', 'BOFU') THEN ? ELSE cat END WHERE id = ?", String(z.ins).slice(0, 2000), z.funnel || '', z.funnel || '', r.id);
    }
    await kvSet(x.db, 'spf_bf2', String(Date.now()));
  }
  if (await kvGet(x.db, 'spf_bf1')) return;
  for (const r of await all(x.db, "SELECT id, src_ref FROM sp_posts WHERE img = '' AND src = 'zalo' AND src_ref LIKE 'zalo:%'")) {
    const z = await first(x.db, 'SELECT img FROM zb_posts WHERE id = ?', r.src_ref.slice(5)).catch(() => null);
    if (z && z.img) await run(x.db, 'UPDATE sp_posts SET img = ? WHERE id = ?', z.img, r.id);
  }
  await run(x.db, "UPDATE sp_posts SET cat = f WHERE cat = '' AND f IN ('TOFU', 'MOFU', 'BOFU')");
  await kvSet(x.db, 'spf_bf1', String(Date.now()));
}

/* ================================================================ ♻️ 1 bài → nhiều kênh (13/11/2026, anh Sơn): bài trợ lý đã đăng lên WEB (Góc Sống Lành) hoặc NHÓM ZALO "Sống khỏe cùng Thực Dưỡng Lành"
 * → AI chuyển thành: bài Facebook cá nhân (đăng trang cá nhân / hội nhóm), bình luận ghim, câu trả lời có link riêng, TIN ZALO gửi khách cũ. Bài gốc đã được duyệt nên bản chuyển thể cho sale dùng ngay (status ok),
 * quản lý vẫn sửa / ẩn được ở 📣. Bài web: link về chính bài viết (/goc-song-lanh/<slug>/?ref=sale). Bài nhóm Zalo: link mời vào nhóm (/nhom-zalo/?ref=sale), tối đa 1 bài / ngày.
 * Chạy theo lịch (cron.js), mỗi lượt tối đa 1 bài; báo Telegram riêng cho sale. */
const REPURPOSER = 'claude-sonnet-5-5';
export async function spRepurposeTick(x) {
  await schema(x.db);
  try { await spBackfill(x); } catch (e) { console.error('spBackfill', e.message); }
  if (!x.env.ANTHROPIC_API_KEY) return;
  const now = Date.now(), day = fmtDate(now, 'yyyy-MM-dd'), done = new Set((await all(x.db, "SELECT src_ref FROM sp_posts WHERE src_ref != '' AND at > ?", now - 10 * DAY)).map(r => r.src_ref));
  let src = null;
  const web = await all(x.db, "SELECT day, title, slug, md FROM bl_posts WHERE status = 'published' AND pub_at > ? AND slug != '' AND md != '' ORDER BY pub_at DESC LIMIT 5", now - 3 * DAY).catch(() => []);
  const w = web.find(p => !done.has('web:' + p.day));
  if (w) src = { kind: 'web', ref: 'web:' + w.day, title: w.title, path: '/goc-song-lanh/' + w.slug + '/', img: ((String(w.md).match(/^image:\s*(\S+)/m) || [])[1] || '').replace(/^["']|["']$/g, ''), body: String(w.md).replace(/^---[\s\S]*?---/, '').slice(0, 7000) };
  else if (!(await first(x.db, "SELECT 1 FROM sp_posts WHERE src = 'zalo' AND at >= ?", now - (now + 7 * 3600e3) % DAY))) {
    const zs = await all(x.db, "SELECT id, topic, text, img, prod, ins, funnel FROM zb_posts WHERE status = 'sent' AND sent_at > ? AND length(text) >= 300 ORDER BY sent_at DESC LIMIT 5", now - 2 * DAY).catch(() => []);
    const z = zs.find(p => !done.has('zalo:' + p.id));
    if (z) src = { kind: 'zalo', ref: 'zalo:' + z.id, title: z.topic || 'Bài nhóm Zalo', path: SPF_TO.nhom[0], img: z.img || '', prod: z.prod || '', ins: z.ins || '', fun: z.funnel || '', body: String(z.text).slice(0, 5000) };
  }
  if (!src) return;
  await run(x.db, "INSERT INTO sp_posts (at, by_name, f, ins, text, cmt, reply, to_k, status, src, src_ref, path, title) VALUES (?, 'AI', 'TOFU', '{}', '', '', '', ?, 'off', ?, ?, ?, ?)", now, src.kind === 'web' ? 'web' : 'nhom', src.kind, src.ref, src.path, cut(src.title, 200)); // giữ chỗ: lỗi AI không viết lại liên tục
  const row = await first(x.db, 'SELECT id FROM sp_posts WHERE src_ref = ? ORDER BY id DESC LIMIT 1', src.ref);
  const where = src.kind === 'web' ? 'bài viết trên website (Góc Sống Lành) có tên "' + src.title + '"' : 'bài trong nhóm Zalo "Sống khỏe cùng Thực Dưỡng Lành"';
  const lib = src.img ? [] : await imgLib(); // 🖼 bài gốc không có ảnh → AI chọn 1 ảnh thật trong kho web
  const lead = src.kind === 'web' ? 'đọc đầy đủ bài viết trên web' : 'vào nhóm Zalo "Sống khỏe cùng Thực Dưỡng Lành" (miễn phí, mẹo sống khỏe mỗi ngày, hỏi đáp)';
  const ask = [
    'Dưới đây là 1 ' + where + ', đã được duyệt. Hãy CHUYỂN THỂ (không chép nguyên) để nhân viên tư vấn Thực Dưỡng Lành dùng trên nhiều kênh:',
    '1) BÀI: đăng Facebook cá nhân hoặc hội nhóm Facebook. 120–250 chữ, xưng "mình", kể từ góc nhìn người đăng (điều mình vừa đọc / để ý / từng nghĩ sai), lấy 1–2 ý hay nhất của bài gốc, đoạn 1–3 câu, câu cuối là câu hỏi mở dễ trả lời. KHÔNG link, KHÔNG số điện thoại, KHÔNG giá, KHÔNG hashtag, KHÔNG "inbox".',
    '2) BÌNH LUẬN GHIM: 1–2 câu, KHÔNG link, mời ' + lead + '.',
    '3) TRẢ LỜI CÓ LINK: 1 câu ngắn, kết thúc đúng chữ [LINK].',
    '4) BÀI HỘI NHÓM: đăng vào hội nhóm Facebook (nhóm mẹ bỉm, ăn chay, hưu trí, khu phố…). 100–220 chữ, chia sẻ mẹo / kinh nghiệm có ích trước, KHÔNG giới thiệu mình bán hàng, KHÔNG tên sản phẩm, KHÔNG link, câu cuối hỏi ý kiến mọi người trong nhóm.',
    '5) NHẬT KÝ ZALO: đăng nhật ký Zalo cá nhân, 60–120 chữ, ấm, gần gũi, kết thúc bằng lời mời ' + lead + ' rồi đúng chữ [LINK].',
    '6) TIN ZALO: tin nhắn riêng gửi khách cũ / người quen, 2–4 câu, ấm, hỏi thăm 1 câu rồi chia sẻ ý chính, mời ' + lead + ', kết thúc đúng chữ [LINK]. Gọi người nhận là [Tên].',
    '# Văn phong: như NGƯỜI THẬT kể chuyện (storytelling), áp dụng cho mọi bản dưới',
    '- Mở bằng 1 KHOẢNH KHẮC CỤ THỂ có lúc, có chỗ (vd "Chiều qua tầm 3 giờ, ở văn phòng…", "Tối thứ Bảy về quê…"), KHÔNG mở bằng nhận định chung hay câu hỏi tu từ.',
    '- Mạch kể: chuyện xảy ra → điều mình để ý / từng nghĩ sai → 1 chuyển biến nhỏ → điều mình rút ra (nói như tâm sự, không răn dạy). Có 1–2 chi tiết giác quan (mùi, tiếng, nhiệt độ, màu) và 1 câu thoại ngắn ngoài đời trong ngoặc kép.',
    '- Câu ngắn dài xen kẽ, từ ngữ nói hằng ngày, được tự trào nhẹ. Bài Facebook cá nhân và nhật ký Zalo: KHÔNG gạch đầu dòng, KHÔNG đánh số 1-2-3 (người thật ít viết vậy). Bài hội nhóm được 2–3 ý ngắn nếu là mẹo.',
    '- Tránh văn AI: "Hóa ra", "Thật ra thì", "Có những…", "hành trình", "không chỉ… mà còn", "hãy cùng", "đừng quên", cảm thán sáo rỗng, câu kết kiểu khẩu hiệu.',
    '- Chuyện là của CHÍNH người đăng (bản thân, gia đình, đồng nghiệp, một ngày đi làm). KHÔNG bịa chuyện khách hàng, lời khách, kết quả dùng sản phẩm, số liệu.',
    'Chỉ dùng thông tin có trong bài gốc. Không nói sản phẩm chữa / điều trị / khỏi bệnh.',
    '', '# BÀI GỐC', src.body, '',
    'Trả về ĐÚNG định dạng (không lời dẫn):', 'BÀI:', '<nội dung>', 'BÌNH LUẬN GHIM:', '<1–2 câu>', 'TRẢ LỜI CÓ LINK:', '<1 câu> [LINK]', 'BÀI HỘI NHÓM:', '<nội dung>', 'NHẬT KÝ ZALO:', '<nội dung> [LINK]', 'TIN ZALO:', '<2–4 câu> [LINK]', 'GỢI Ý ẢNH:', '<1 câu: ảnh THẬT người đăng tự chụp bằng điện thoại đúng khoảnh khắc trong bài (vd ly trà trên bàn làm việc, mâm cơm tối, góc bếp buổi sáng); không chụp mặt khách, không ảnh sản phẩm trơn, không banner, không chữ trên ảnh>', lib.length ? 'ẢNH SỐ:' : '', lib.length ? '<số của 1 ảnh trong KHO ẢNH THẬT khớp nhất, hoặc "không">' : '', '', libAsk(lib)
  ].join('\n');
  try {
    const res = await ai(x.env).messages.create({ model: REPURPOSER, max_tokens: 6000, system: 'Bạn chuyển thể nội dung cho nhân viên Thực Dưỡng Lành (thực phẩm dinh dưỡng từ hạt, trà thảo mộc). Tiếng Việt đời thường, ấm, không văn quảng cáo.\n\n' + TRUTH_RULES, messages: [{ role: 'user', content: ask }] });
    const raw = res.content.filter(b => b.type === 'text').map(b => b.text).join('\n');
    const grab = (k, next) => { const m = raw.match(new RegExp('(?:^|\\n)\\s*\\**' + k + '\\**\\s*:\\**\\s*([\\s\\S]*?)' + (next ? '(?=\\n\\s*\\**' + next + ')' : '$'), 'i')); return m ? m[1].trim() : ''; };
    const clean = s => insViet(safe(s)).replace(/https?:\/\/\S+/g, '').trim();
    const text = clean(grab('BÀI', 'BÌNH LUẬN GHIM')), cmt = clean(grab('BÌNH LUẬN GHIM', 'TRẢ LỜI CÓ LINK')).replace(/\[LINK\]/g, '').trim();
    let reply = clean(grab('TRẢ LỜI CÓ LINK', 'BÀI HỘI NHÓM')); if (!/\[LINK\]/.test(reply)) reply = (reply || 'Mình để link ở đây nhé') + ' [LINK]';
    const grp = clean(grab('BÀI HỘI NHÓM', 'NHẬT KÝ ZALO')).replace(/\[LINK\]/g, '').trim();
    let znk = clean(grab('NHẬT KÝ ZALO', 'TIN ZALO')); if (znk && !/\[LINK\]/.test(znk)) znk += ' [LINK]';
    let zmsg = clean(grab('TIN ZALO', 'GỢI Ý ẢNH')); if (zmsg && !/\[LINK\]/.test(zmsg)) zmsg += ' [LINK]';
    const imgh = clean(grab('GỢI Ý ẢNH', 'ẢNH SỐ') || grab('GỢI Ý ẢNH', '')).split('\n')[0];
    if (text.length < 100 || !cmt) return;
    const prods = src.prod ? prodMap(await kb()) : {}, img = src.img || libGet(lib, raw) || (prods[src.prod] && prods[src.prod].img) || '', okNow = true; // bài gốc đã duyệt → cho sale dùng ngay; chưa có ảnh thì sale được gợi ý tự chụp
    await run(x.db, "UPDATE sp_posts SET text = ?, cmt = ?, reply = ?, zmsg = ?, grp = ?, znk = ?, imgh = ?, img = ?, cat = ?, prod = ?, status = ?, ok_by = ?, ok_at = ?, ins = ? WHERE id = ?", text.slice(0, 5000), cmt.slice(0, 600), reply.slice(0, 400), zmsg.slice(0, 1200), grp.slice(0, 4000), znk.slice(0, 1500), imgh.slice(0, 300), String(img).slice(0, 300), ['TOFU', 'MOFU', 'BOFU'].includes(src.fun) ? src.fun : 'TOFU', String(src.prod || '').slice(0, 40), okNow ? 'ok' : 'draft', okNow ? 'Tự động (bài gốc đã duyệt)' : '', okNow ? now : null, src.ins && src.ins !== '{}' ? String(src.ins).slice(0, 2000) : '{}', row.id);
    if (!okNow) return;
    const us = await all(x.db, "SELECT name, tg FROM users WHERE active = 1 AND coalesce(tg, '') != '' AND role NOT IN ('Kho', 'Kế toán', 'Marketing')");
    const msg = '📣 <b>Có bài mới để chia sẻ</b> (' + (src.kind === 'web' ? '📰 từ bài web' : '💬 từ nhóm Zalo') + '): ' + cut(src.title, 120).replace(/[<>&]/g, '') + '\nĐã có sẵn ảnh + bài đăng Facebook cá nhân, hội nhóm, Zalo, link riêng của bạn tự gắn.\n👉 CRM → Hôm nay → 📣 Mở kho bài';
    for (const v of us) { try { await telegramTo(x.env, v.tg, msg); } catch (e) { } }
  } catch (e) { console.error('spRepurpose', e.message); }
}

export async function crmSpf(x, u, d, crmLog) {
  await schema(x.db);
  const a = d.action, now = Date.now(), id = Number(d.id) || 0;
  if (a === 'spf_list') { // sale: bài đã duyệt CÓ ẢNH (23/11/2026); người quản lý (d.all): mọi bài
    const show = Number(await kvGet(x.db, 'spf_show')) || 10; // 👀 sale thấy tối đa N bài mới nhất (anh Sơn 23/11: bắt đầu 10 cho chị em dễ làm quen, quen rồi nâng dần)
    const all_ = !!d.all && canEdit(u), rows = await all(x.db, all_ ? "SELECT * FROM sp_posts WHERE text != '' ORDER BY id DESC LIMIT 120" : "SELECT * FROM sp_posts WHERE status = 'ok' ORDER BY id DESC LIMIT 80"); // 23/11 (2): sale lọc trên CẢ kho; mặc định CRM chỉ hiện `show` bài. Bài chưa có ảnh vẫn tới sale, kèm gợi ý tự chụp ảnh thật
    const lib = await imgLib(), th = {}; for (const i of lib) if (i.url && i.thumb) th[i.url] = i.thumb; // ảnh nhỏ cho lưới
    const who = {}, mine = {}; // 🔥 số bạn đã đăng mỗi bài · ✓ bài mình đã đăng
    for (const r of await all(x.db, "SELECT result, COUNT(DISTINCT by_name) n FROM logs WHERE what = 'Đăng bài FB' AND time > ? GROUP BY result", now - 120 * DAY)) who[r.result] = r.n;
    for (const r of await all(x.db, "SELECT DISTINCT result FROM logs WHERE what = 'Đăng bài FB' AND by_name = ? AND time > ?", u.name, now - 120 * DAY)) mine[r.result] = 1;
    const prods = prodMap(await kb()), q = await kvJson(x.db, 'spf_q', []), S = await spStats(x, u).catch(e => { console.error('spStats', e.message); return { st: {}, my: [] }; });
    const have = new Set(rows.map(r => r.id)), miss = S.my.map(m => m.id).filter(id => !have.has(id)).slice(0, 40); // bài mình đã đăng mà nay đã ẩn: vẫn hiện ở 📊 Bài tôi đã đăng
    if (miss.length) for (const r of await all(x.db, 'SELECT * FROM sp_posts WHERE id IN (' + miss.map(() => '?').join(',') + ')', ...miss)) rows.push(Object.assign(r, { gone: 1 }));
    return { ok: true, posts: rows.map(r => Object.assign(shape(r, all_), { th: th[r.img] || '', who: who[String(r.id)] || 0, mine: mine[String(r.id)] ? 1 : 0, s: S.st[r.id] || null, gone: r.gone ? 1 : 0 })), my: S.my, to: Object.fromEntries(Object.entries(SPF_TO).map(([k, v]) => [k, v[1]])),
      cats: await spCats(x), prods: Object.keys(prods).map(k => ({ k, n: prods[k].name, img: prods[k].img })), q: Array.isArray(q) ? q.length : 0, show, edit: canEdit(u), write: canIns(u), learnEd: await edCount(x, 'sp') };
  }
  if (a === 'spf_imgs') return { ok: true, list: (await imgLib()).slice(0, 200).map(i => ({ url: i.url, thumb: i.thumb || '', alt: i.alt || '' })) };
  if (a === 'spf_fill' || a === 'spf_mix') { // ✨ viết sẵn N bài theo tỉ lệ (máy chủ viết dần, 2 bài / 10 phút) · lưu tên + % 4 loại bài
    if (!canEdit(u)) return { ok: false, error: 'Chỉ Marketing, Quản lý, Quản trị dùng được.' };
    if (Array.isArray(d.cats)) { const m = {}; for (const c of d.cats) if (SPF_CAT0.some(o => o.k === c.k)) m[c.k] = { n: cut(c.n, 40), p: Math.max(0, Math.min(100, Number(c.p) || 0)) }; await kvSet(x.db, 'spf_mix', JSON.stringify(m)); }
    if (d.show != null) await kvSet(x.db, 'spf_show', String(Math.max(3, Math.min(80, Number(d.show) || 10))));
    if (a === 'spf_mix') return { ok: true, cats: await spCats(x), show: Number(await kvGet(x.db, 'spf_show')) || 10 };
    const n = Math.max(0, Math.min(40, Number(d.n) || 0)), cats = await spCats(x);
    if (!n) { await kvSet(x.db, 'spf_q', '[]'); return { ok: true, q: 0 }; }
    const tot = cats.reduce((s, c) => s + c.p, 0) || 1, list = [];
    const cnt = cats.map(c => ({ k: c.k, v: n * c.p / tot })); cnt.forEach(c => { c.n = Math.floor(c.v); }); // chia theo tỉ lệ, số lẻ dư cho loại phần thập phân lớn nhất
    for (let left = n - cnt.reduce((s, c) => s + c.n, 0); left > 0; left--) cnt.sort((A, B) => (B.v - B.n) - (A.v - A.n))[0].n++;
    const pk = Object.keys(prodMap(await kb())); let pi = 0;
    const pr = k => (cats.find(c => c.k === k) || {}).pr || 0;
    for (const c of cnt) for (let i = 0; i < c.n; i++) list.push({ c: c.k, prod: pk.length && (pr(c.k) >= 1 || (pr(c.k) > 0 && i % 2 === 0)) ? pk[pi++ % pk.length] : '' }); // bài có sản phẩm xoay vòng đủ các sản phẩm
    for (let i = list.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [list[i], list[j]] = [list[j], list[i]]; } // trộn để kho có đủ loại ngay từ đầu
    await kvSet(x.db, 'spf_q', JSON.stringify(list)); await kvSet(x.db, 'spf_q_by', u.name);
    await crmLog(x, u, 'Bài Facebook cá nhân', '-', '', 'Viết sẵn ' + n + ' bài', cnt.map(c => c.k + ' ' + c.n).join(', '));
    return { ok: true, q: list.length };
  }
  if (a === 'spf_used') { await run(x.db, 'UPDATE sp_posts SET copies = copies + 1 WHERE id = ?', id); const d0 = Date.now() - (Date.now() + 7 * 3600e3) % 86400e3; if (!await first(x.db, "SELECT 1 FROM logs WHERE what = 'Đăng bài FB' AND by_name = ? AND result = ? AND time >= ?", u.name, String(id), d0)) await crmLog(x, u, 'Đăng bài FB', '-', '', String(id), ''); return { ok: true }; } // 13/11/2026: việc 5 mỗi ngày, mỗi bài tính 1 lần / ngày
  if (a === 'spf_write') {
    if (!canIns(u)) return { ok: false, error: 'Chỉ Marketing, Quản lý, Quản trị viết được bài.' };
    const dk = 'ins_ai_' + fmtDate(now, 'yyMMdd'), n = Number(await kvGet(x.db, dk) || 0);
    if (n >= 40) return { ok: false, error: 'Hôm nay đã dùng 40 lần, mai thử tiếp nhé.' };
    await kvSet(x.db, dk, String(n + 1), 2 * DAY);
    try { const r = await spWrite(x, u, d); if (r.ok) await crmLog(x, u, 'Bài Facebook cá nhân', '-', '', 'Viết bài nháp', r.post.text.slice(0, 120)); return r; }
    catch (e) { return { ok: false, error: 'AI chưa viết xong: ' + String(e.message).slice(0, 150) }; }
  }
  if (!canEdit(u)) return { ok: false, error: 'Chỉ Marketing, Quản lý, Quản trị duyệt / sửa được bài.' };
  if (a === 'spf_okall') { // ✅ cho sale dùng mọi bài nháp đã có ảnh
    const r = await run(x.db, "UPDATE sp_posts SET status = 'ok', ok_by = ?, ok_at = ? WHERE status = 'draft' AND text != ''", u.name, now);
    const n = (r && r.meta && r.meta.changes) || 0; if (n) await crmLog(x, u, 'Bài Facebook cá nhân', '-', '', 'Cho sale dùng ' + n + ' bài', '');
    return { ok: true, n };
  }
  const row = id && await first(x.db, 'SELECT * FROM sp_posts WHERE id = ?', id); if (!row) return { ok: false, error: 'Không tìm thấy bài.' };
  if (a === 'spf_save') {
    const st = ['draft', 'ok', 'off'].includes(d.status) ? d.status : row.status;
    const text = d.text != null ? insViet(cut(d.text, 5000)) : row.text, cmt = d.cmt != null ? cut(d.cmt, 600).replace(/https?:\/\/\S+/g, '') : row.cmt;
    let reply = d.reply != null ? cut(d.reply, 400) : row.reply; if (!/\[LINK\]/.test(reply)) reply = reply.trim() + ' [LINK]';
    const to = SPF_TO[d.to] ? d.to : row.to_k, grp = d.grp != null ? insViet(cut(d.grp, 4000)).replace(/https?:\/\/\S+/g, '') : row.grp || '';
    let znk = d.znk != null ? cut(d.znk, 1500) : row.znk || '', zmsg = d.zmsg != null ? cut(d.zmsg, 1200) : row.zmsg || '', imgh = d.imgh != null ? cut(d.imgh, 300) : row.imgh || '';
    if (znk && !/\[LINK\]/.test(znk)) znk += ' [LINK]'; if (zmsg && !/\[LINK\]/.test(zmsg)) zmsg += ' [LINK]';
    let img = row.img || '';
    if (d.img != null) { // 🖼 ảnh: link kho web / ảnh đã tải / data:image mới tải từ máy (lưu zb_imgs) / '' = bỏ
      img = String(d.img);
      if (img.startsWith('data:image/')) { if (img.length > 1.5e6) return { ok: false, error: 'Ảnh lớn quá, chọn ảnh khác nhé.' }; const iid = 's' + now.toString(36) + Math.random().toString(36).slice(2, 6); await run(x.db, 'INSERT INTO zb_imgs (id, data, at) VALUES (?, ?, ?)', iid, img, now); img = 'https://api.thucduonglanh.vn/zb-img/' + iid; }
      else if (img && !/^https:\/\/(api\.)?thucduonglanh\.vn\//.test(img) && !img.startsWith('/')) return { ok: false, error: 'Ảnh không hợp lệ.' };
    }
    const cat = d.cat != null ? (SPF_CAT0.some(c => c.k === d.cat) ? d.cat : '') : row.cat || '', prod = d.prod != null ? cut(d.prod, 40) : row.prod || '';
    if (st === 'ok' && !img && prod) { const pi = prodMap(await kb())[prod]; if (pi && pi.img) img = pi.img; } // chưa có ảnh vẫn cho dùng: sale được gợi ý tự chụp ảnh thật
    await run(x.db, 'UPDATE sp_posts SET grp = ?, znk = ?, zmsg = ?, imgh = ?, img = ?, cat = ?, f = ?, prod = ? WHERE id = ?', grp, znk, zmsg, imgh, img, cat, cat || row.f, prod, id);
    await run(x.db, 'UPDATE sp_posts SET text = ?, cmt = ?, reply = ?, to_k = ?, status = ?, ok_by = ?, ok_at = ? WHERE id = ?', text, cmt, reply, to, st,
      st === 'ok' && row.status !== 'ok' ? u.name : row.ok_by, st === 'ok' && row.status !== 'ok' ? now : row.ok_at, id);
    if (d.text != null || d.cmt != null) await edAdd(x, 'sp', { id: 'sp' + id, by: u.name, t: '', ai: row.text + '\n[BÌNH LUẬN GHIM] ' + row.cmt, hu: text + '\n[BÌNH LUẬN GHIM] ' + cmt }); // ✍️ trợ lý học từ bản sửa
    if (st !== row.status) await crmLog(x, u, 'Bài Facebook cá nhân', '-', '', st === 'ok' ? 'Cho sale dùng' : st === 'off' ? 'Ẩn bài' : 'Về nháp', row.text.slice(0, 120));
    return { ok: true, post: shape(await first(x.db, 'SELECT * FROM sp_posts WHERE id = ?', id), true) };
  }
  if (a === 'spf_del') { await run(x.db, 'DELETE FROM sp_posts WHERE id = ?', id); await crmLog(x, u, 'Bài Facebook cá nhân', '-', '', 'Xoá bài', row.text.slice(0, 120)); return { ok: true }; }
  return { ok: false, error: 'Không rõ thao tác.' };
}

/** ✨ Viết dần kho bài (spf_fill): mỗi lượt cron 10 phút viết 2 bài trong hàng chờ kv spf_q. Bài vào nháp (đã có ảnh) → Marketing đọc, bấm ✅ Cho sale dùng. Xong hết thì báo Telegram. */
export async function spFillTick(x) {
  if (!x.env.ANTHROPIC_API_KEY) return;
  const q = await kvJson(x.db, 'spf_q', []); if (!Array.isArray(q) || !q.length) return;
  if (Date.now() - Number(await kvGet(x.db, 'spf_q_run') || 0) < 8 * 60e3) return; // lượt trước còn đang viết
  await kvSet(x.db, 'spf_q_run', String(Date.now()));
  await schema(x.db);
  const by = (await kvGet(x.db, 'spf_q_by')) || 'AI';
  for (let i = 0; i < 3; i++) { // 3 bài / lượt 10 phút
    const cur = await kvJson(x.db, 'spf_q', []); if (!Array.isArray(cur) || !cur.length) break;
    const it = cur[0]; let ok = false;
    try { const r = await spWrite(x, { name: 'AI · ' + by }, { fill: 1, c: it.c, prod: it.prod, g: it.g || '', hint: it.h || '', to: it.c === 'BOFU' ? 'web' : it.c === 'MOFU' ? 'qua' : 'nhom' }); ok = r.ok; if (!ok) console.error('spFill', r.error); } catch (e) { console.error('spFill', e.message); }
    const nx = await kvJson(x.db, 'spf_q', []); if (!Array.isArray(nx)) break;
    if (ok || (it.tries || 0) >= 1) nx.shift(); else nx[0] = Object.assign({}, it, { tries: (it.tries || 0) + 1 }); // lỗi 2 lần thì bỏ bài đó
    await kvSet(x.db, 'spf_q', JSON.stringify(nx));
    if (!nx.length) { const n = (await first(x.db, "SELECT COUNT(*) n FROM sp_posts WHERE status = 'draft' AND text != ''")).n; try { await telegram(x.env, '🗂 <b>Kho bài đăng cho sale</b>: trợ lý đã viết xong, ' + n + ' bài nháp chờ duyệt (đã có ảnh).\n👉 CRM → 🎯 Insight & nội dung → 📣 Kho bài đăng cho sale → ✅ Cho sale dùng'); } catch (e) { } }
  }
  await kvSet(x.db, 'spf_q_run', '0');
}

/* ================================================================ 📊 Hiệu quả từng bài (23/11/2026, anh Sơn: "sau khi đăng chưa có chỗ để sale xem lại và đánh giá hiệu quả")
 * Link trong bài có thêm &bv=<mã bài> → web gửi { type: 'spf_hit', bv, ref } (mỗi khách 1 lần / 6 tiếng) và ghi `bv` vào đơn đặt trong 30 ngày. */
const refOf = name => nrm(name).replace(/[^a-z0-9]/g, '');
export async function spfHit(x, d) {
  const post = Number(String(d.bv || '').replace(/\D/g, '').slice(0, 9)) || 0, ref = String(d.ref || '').toLowerCase().replace(/[^a-z0-9]/g, '').slice(0, 40);
  if (!post || !ref) return { ok: false };
  await schema(x.db);
  if (!(await first(x.db, 'SELECT 1 FROM sp_posts WHERE id = ?', post))) return { ok: false };
  await run(x.db, 'INSERT INTO sp_hits (post, ref, day, n) VALUES (?, ?, ?, 1) ON CONFLICT(post, ref, day) DO UPDATE SET n = n + 1', post, ref, fmtDate(Date.now(), 'yyyy-MM-dd'));
  return { ok: true };
}
export async function spfOrder(x, o) {
  const post = Number(String(o.bv || '').replace(/\D/g, '').slice(0, 9)) || 0, ref = String(o.ref || '').toLowerCase().replace(/[^a-z0-9]/g, '').slice(0, 40);
  if (!post || !ref || !o.id) return;
  await schema(x.db);
  await run(x.db, 'INSERT OR IGNORE INTO sp_conv (oid, post, ref, total, at) VALUES (?, ?, ?, ?, ?)', String(o.id).slice(0, 60), post, ref, Math.round(Number(o.total) || 0), Date.now());
}
/** Số liệu cho CRM: st = cả nhóm theo bài { id: [bấm, đơn, tiền] }, my = bài mình đã đăng [{ id, at, h, o, r }] */
async function spStats(x, u) {
  const since = Date.now() - 120 * DAY, ref = refOf(u.name), st = {}, mh = {}, mo = {};
  for (const r of await all(x.db, 'SELECT post, ref, SUM(n) n FROM sp_hits WHERE day >= ? GROUP BY post, ref', fmtDate(since, 'yyyy-MM-dd'))) { (st[r.post] = st[r.post] || [0, 0, 0])[0] += r.n; if (r.ref === ref) mh[r.post] = (mh[r.post] || 0) + r.n; }
  for (const r of await all(x.db, 'SELECT post, ref, COUNT(*) n, SUM(total) t FROM sp_conv WHERE at >= ? GROUP BY post, ref', since)) { const s0 = (st[r.post] = st[r.post] || [0, 0, 0]); s0[1] += r.n; s0[2] += r.t || 0; if (r.ref === ref) mo[r.post] = [r.n, r.t || 0]; }
  const my = (await all(x.db, "SELECT result, MIN(time) at, COUNT(*) n FROM logs WHERE what = 'Đăng bài FB' AND by_name = ? AND time > ? GROUP BY result ORDER BY at DESC LIMIT 60", u.name, since))
    .map(r => ({ id: Number(r.result) || 0, at: r.at, n: r.n, h: mh[r.result] || 0, o: (mo[r.result] || [0])[0], r: (mo[r.result] || [0, 0])[1] })).filter(r => r.id);
  return { st, my };
}
