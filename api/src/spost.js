/* ================================================================ 📣 Bài viết sẵn cho sale đăng Facebook CÁ NHÂN (11/11/2026, khoá content K131 Buổi 6, anh Sơn duyệt đợt 2)
 * Khoá học: "AI viết, người đăng" (Facebook cá nhân không để AI tự đăng) + kỹ thuật ghim bình luận:
 *   đăng bài KHÔNG có link → chờ bài có tương tác → viết 1 bình luận KHÔNG link (Facebook không cho ghim bình luận có link) → trả lời ngay dưới bình luận đó bằng link → ghim bình luận chính (bằng điện thoại).
 * Ở đây: Marketing / Quản lý / Quản trị bấm ✨ Viết 1 bài (theo nhóm khách + tension + big idea / góc kể như mọi trợ lý: insPick kênh 'fbcn')
 *   → nháp → ✅ Cho sale dùng → sale mở 📣 Bài đăng Facebook cá nhân, copy bài / bình luận ghim / câu trả lời có LINK RIÊNG ?ref= của mình (đơn trong 30 ngày tính cho sale).
 * Bảng D1 sp_posts. Lệnh spf_* (crm.js chuyển sang crmSpf). Đếm số lần sale copy (copies) để biết bài nào được dùng. */
import Anthropic from '@anthropic-ai/sdk';
import { aiFetch } from './airelay.js';
import { run, all, first, kvGet, kvSet, fmtDate, DAY } from './lib.js';
import { edAdd, edBlock, edCount } from './edlearn.js';
import { kb, safe, TRUTH_RULES } from './chat.js';
import { telegramTo } from './google.js';
import { insPick, insBlock, insParse, insLog, insRisk, insViet, insStyle, canIns, INS_HEAD, funOf } from './insight.js';

const WRITER = 'claude-opus-5-5';
/** Lối ra của bình luận ghim: đường dẫn trên web (CRM tự gắn ?ref= của sale) + mô tả cho AI */
export const SPF_TO = {
  nhom: ['/nhom-zalo/', 'Vào nhóm Zalo', 'vào nhóm Zalo "Sống khỏe cùng Thực Dưỡng Lành" (mẹo sống khỏe mỗi ngày, hỏi đáp, quà cho thành viên), miễn phí'],
  qua: ['/qua-tang/', 'Nhận quà tặng', 'nhận quà tặng miễn phí trên website Thực Dưỡng Lành (cẩm nang sống khỏe)'],
  web: ['/', 'Trang chủ web', 'xem website Thực Dưỡng Lành (sản phẩm, ưu đãi, đặt hàng có kiểm hàng)'],
  tet: ['/qua-tet/', 'Quà Tết 2027', 'xem 3 set quà Tết Sống khỏe chủ động trên website, gửi thẳng tới bố mẹ, đặt trước 27/1/2027'] // chiến dịch Tết 2027 (V-2026-11-022); sau Tết bỏ dòng này
};
const cut = (s, n) => String(s == null ? '' : s).trim().slice(0, n);
let client = null, schemaOk = false;
function ai(env) { if (!client) client = new Anthropic({ apiKey: env.ANTHROPIC_API_KEY, maxRetries: 1, timeout: 120e3, fetch: aiFetch(env), defaultHeaders: { 'x-tdl-muc': 'fb-ca-nhan' } }); return client; }
async function schema(db) {
  if (schemaOk) return;
  await run(db, `CREATE TABLE IF NOT EXISTS sp_posts (id INTEGER PRIMARY KEY AUTOINCREMENT, at INTEGER, by_name TEXT DEFAULT '', f TEXT DEFAULT '', ins TEXT DEFAULT '',
    text TEXT DEFAULT '', cmt TEXT DEFAULT '', reply TEXT DEFAULT '', to_k TEXT DEFAULT 'nhom', status TEXT DEFAULT 'draft', copies INTEGER DEFAULT 0, ok_by TEXT DEFAULT '', ok_at INTEGER)`);
  for (const c of ["src TEXT DEFAULT ''", "src_ref TEXT DEFAULT ''", "path TEXT DEFAULT ''", "title TEXT DEFAULT ''", "zmsg TEXT DEFAULT ''", "grp TEXT DEFAULT ''", "znk TEXT DEFAULT ''", "imgh TEXT DEFAULT ''", "img TEXT DEFAULT ''"]) { try { await run(db, 'ALTER TABLE sp_posts ADD COLUMN ' + c); } catch (e) { } } // 13/11/2026: 1 bài → nhiều kênh (bài web / bài nhóm Zalo → bài FB cá nhân + tin Zalo gửi khách)
  schemaOk = true;
}
const canEdit = u => !!u && (u.level >= 2 || u.role === 'Marketing');
const shape = (r, full) => {
  let ins = {}; try { ins = JSON.parse(r.ins || '{}') || {}; } catch (e) { }
  const o = { id: r.id, at: r.at, f: r.f, text: r.text, cmt: r.cmt, reply: r.reply, to: SPF_TO[r.to_k] ? r.to_k : 'nhom', path: r.path || (SPF_TO[r.to_k] || SPF_TO.nhom)[0], status: r.status, copies: r.copies || 0, gn: ins.gn || '',
    src: r.src || '', title: r.title || '', zmsg: r.zmsg || '', grp: r.grp || '', znk: r.znk || '', imgh: r.imgh || '', img: r.img || '' }; // imgh: gợi ý ảnh thật nên chụp; img: ảnh bài web gốc (bài chuyển thể) // 13/11/2026: mỗi bài sẵn 3 kênh: Facebook cá nhân · hội nhóm Facebook (grp) · nhật ký Zalo (znk) + tin Zalo gửi khách (zmsg)
  if (full) Object.assign(o, { by: r.by_name, ok_by: r.ok_by, ins: Object.assign(ins, { w: insRisk([r.text, r.cmt, r.reply].join('\n')), v: insStyle(r.text) }) });
  return o;
};

async function spWrite(x, u, d) {
  if (!x.env.ANTHROPIC_API_KEY) return { ok: false, error: 'Máy chủ chưa có khoá AI.' };
  const f = funOf(d.f) === 'MOFU' ? 'MOFU' : 'TOFU', to = SPF_TO[d.to] ? d.to : 'nhom', hint = cut(d.hint, 600);
  const p = await insPick(x, 'fbcn', cut(d.g, 80));
  if (!p.g) return { ok: false, error: 'Ngân hàng insight chưa có nhóm khách nào đang bật.' };
  const ask = [
    'Viết 1 bài để NHÂN VIÊN TƯ VẤN của Thực Dưỡng Lành tự đăng trên FACEBOOK CÁ NHÂN của họ (không phải fanpage). Bạn bè của họ là người quen, đồng nghiệp cũ, hàng xóm, phụ huynh cùng lớp con… Bài phải đọc như người thật kể chuyện đời thường, KHÔNG giống quảng cáo.',
    'Mục tiêu: bài được bạn bè bình luận, chia sẻ (bài nhận biết / tạo niềm tin). Việc dẫn khách nằm ở BÌNH LUẬN GHIM, không nằm trong bài.',
    'Lối ra (chỉ dùng trong bình luận ghim và câu trả lời): mời ' + SPF_TO[to][2] + '.',
    hint ? 'Yêu cầu thêm của người giao việc: ' + hint : '',
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
    '- TRONG BÀI: KHÔNG link, KHÔNG số điện thoại, KHÔNG giá, KHÔNG hashtag, KHÔNG "inbox / ib / nhắn mình". ' + (f === 'TOFU' ? 'Bài nhận biết: KHÔNG nhắc tên sản phẩm, chỉ có thể nhắc mình đang làm ở Thực Dưỡng Lành nếu thật tự nhiên.' : 'Bài tạo niềm tin: được nhắc 1 lần chuyện nghề (nguồn gốc, cách làm, vì sao chọn nguyên liệu) theo đúng TÀI LIỆU, không bán, không giá.'),
    '- BÌNH LUẬN GHIM: 1–2 câu, KHÔNG có link (Facebook không cho ghim bình luận có link), nối tiếp câu chuyện trong bài rồi mời ' + SPF_TO[to][2] + ', nói rõ điều kiện thật (miễn phí, để lại tên và số Zalo nếu trang yêu cầu).',
    '- TRẢ LỜI CÓ LINK: 1 câu ngắn trả lời ngay dưới bình luận ghim, kết thúc bằng đúng chữ [LINK] (CRM tự thay bằng link riêng của từng nhân viên).',
    '# Bản cho kênh khác (cùng ý, viết lại cho hợp kênh, KHÔNG chép nguyên)',
    '- BÀI HỘI NHÓM: đăng vào hội nhóm Facebook (nhóm mẹ bỉm, ăn chay, hưu trí, khu phố…). 100–220 chữ, chia sẻ kinh nghiệm / mẹo có ích trước, KHÔNG giới thiệu mình bán hàng, KHÔNG tên sản phẩm, KHÔNG link, câu cuối hỏi ý kiến mọi người trong nhóm.',
    '- NHẬT KÝ ZALO: đăng nhật ký Zalo cá nhân (bạn bè Zalo là khách cũ, người quen). 60–120 chữ, ấm, gần gũi, được nhắc nhẹ mình làm ở Thực Dưỡng Lành, kết thúc bằng lời mời ngắn rồi đúng chữ [LINK].',
    '- TIN ZALO: tin nhắn riêng gửi khách cũ / người quen, 2–4 câu, gọi người nhận là [Tên], hỏi thăm 1 câu rồi chia sẻ ý chính, kết thúc đúng chữ [LINK].',
    '',
    'Trả về ĐÚNG định dạng (không lời dẫn):', INS_HEAD, '---', 'BÀI:', '<nội dung bài>', 'BÌNH LUẬN GHIM:', '<1–2 câu>', 'TRẢ LỜI CÓ LINK:', '<1 câu> [LINK]', 'BÀI HỘI NHÓM:', '<nội dung>', 'NHẬT KÝ ZALO:', '<nội dung> [LINK]', 'TIN ZALO:', '<2–4 câu> [LINK]', 'GỢI Ý ẢNH:', '<1 câu: ảnh THẬT người đăng tự chụp bằng điện thoại đúng khoảnh khắc trong bài (vd ly trà trên bàn làm việc, mâm cơm tối, góc bếp buổi sáng); không chụp mặt khách, không ảnh sản phẩm trơn, không banner, không chữ trên ảnh>'
  ].join('\n');
  const know = await kb();
  const req = { model: WRITER, max_tokens: 9000, // 13/11/2026: 5000 bị cụt phần Zalo + gợi ý ảnh ở bài dài output_config: { effort: 'medium' },
    system: [{ type: 'text', text: 'Bạn là người viết nội dung mạng xã hội cho nhân viên Thực Dưỡng Lành (VitaGreen Nutrition): thực phẩm dinh dưỡng từ hạt, trà thảo mộc, đồ chay. Tiếng Việt đời thường, ấm, thật, đúng luật quảng cáo thực phẩm Việt Nam.\n' + TRUTH_RULES },
      { type: 'text', text: 'TÀI LIỆU (thông tin chính thức của Thực Dưỡng Lành):\n\n' + know, cache_control: { type: 'ephemeral' } }],
    messages: [{ role: 'user', content: ask }] };
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
  const znk = withL(clean(grab('NHẬT KÝ ZALO', 'TIN ZALO'))), zmsg = withL(clean(grab('TIN ZALO', 'GỢI Ý ẢNH'))), imgh = clean(grab('GỢI Ý ẢNH', '')).split('\n')[0];
  if (text.length < 120 || !cmt) return { ok: false, error: 'AI chưa viết đủ bài + bình luận ghim, bấm viết lại nhé.' };
  const ins = insParse(head, p.bank, p.g); if (p.angle) ins.a = p.angle; if (p.big) ins.b = p.big.t;
  const r = await run(x.db, 'INSERT INTO sp_posts (at, by_name, f, ins, text, cmt, reply, to_k, status, grp, znk, zmsg, imgh) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)', Date.now(), u.name, f, JSON.stringify(ins), text.slice(0, 5000), cmt.slice(0, 600), reply.slice(0, 400), to, 'draft', grp.slice(0, 4000), znk.slice(0, 1500), zmsg.slice(0, 1200), imgh.slice(0, 300));
  const id = r && r.meta && r.meta.last_row_id;
  await insLog(x, 'fbcn', { g: ins.g, gn: ins.gn, f, t: ins.t, ref: 'sp' + id, a: ins.a, b: ins.b });
  return { ok: true, post: shape(await first(x.db, 'SELECT * FROM sp_posts WHERE id = ?', id), true) };
}

/* ================================================================ ♻️ 1 bài → nhiều kênh (13/11/2026, anh Sơn): bài trợ lý đã đăng lên WEB (Góc Sống Lành) hoặc NHÓM ZALO "Sống khỏe cùng Thực Dưỡng Lành"
 * → AI chuyển thành: bài Facebook cá nhân (đăng trang cá nhân / hội nhóm), bình luận ghim, câu trả lời có link riêng, TIN ZALO gửi khách cũ. Bài gốc đã được duyệt nên bản chuyển thể cho sale dùng ngay (status ok),
 * quản lý vẫn sửa / ẩn được ở 📣. Bài web: link về chính bài viết (/goc-song-lanh/<slug>/?ref=sale). Bài nhóm Zalo: link mời vào nhóm (/nhom-zalo/?ref=sale), tối đa 1 bài / ngày.
 * Chạy theo lịch (cron.js), mỗi lượt tối đa 1 bài; báo Telegram riêng cho sale. */
const REPURPOSER = 'claude-sonnet-5-5';
export async function spRepurposeTick(x) {
  if (!x.env.ANTHROPIC_API_KEY) return;
  await schema(x.db);
  const now = Date.now(), day = fmtDate(now, 'yyyy-MM-dd'), done = new Set((await all(x.db, "SELECT src_ref FROM sp_posts WHERE src_ref != '' AND at > ?", now - 10 * DAY)).map(r => r.src_ref));
  let src = null;
  const web = await all(x.db, "SELECT day, title, slug, md FROM bl_posts WHERE status = 'published' AND pub_at > ? AND slug != '' AND md != '' ORDER BY pub_at DESC LIMIT 5", now - 3 * DAY).catch(() => []);
  const w = web.find(p => !done.has('web:' + p.day));
  if (w) src = { kind: 'web', ref: 'web:' + w.day, title: w.title, path: '/goc-song-lanh/' + w.slug + '/', img: ((String(w.md).match(/^image:\s*(\S+)/m) || [])[1] || '').replace(/^["']|["']$/g, ''), body: String(w.md).replace(/^---[\s\S]*?---/, '').slice(0, 7000) };
  else if (!(await first(x.db, "SELECT 1 FROM sp_posts WHERE src = 'zalo' AND at >= ?", now - (now + 7 * 3600e3) % DAY))) {
    const zs = await all(x.db, "SELECT id, topic, text FROM zb_posts WHERE status = 'sent' AND sent_at > ? AND length(text) >= 300 ORDER BY sent_at DESC LIMIT 5", now - 2 * DAY).catch(() => []);
    const z = zs.find(p => !done.has('zalo:' + p.id));
    if (z) src = { kind: 'zalo', ref: 'zalo:' + z.id, title: z.topic || 'Bài nhóm Zalo', path: SPF_TO.nhom[0], body: String(z.text).slice(0, 5000) };
  }
  if (!src) return;
  await run(x.db, "INSERT INTO sp_posts (at, by_name, f, ins, text, cmt, reply, to_k, status, src, src_ref, path, title) VALUES (?, 'AI', 'TOFU', '{}', '', '', '', ?, 'off', ?, ?, ?, ?)", now, src.kind === 'web' ? 'web' : 'nhom', src.kind, src.ref, src.path, cut(src.title, 200)); // giữ chỗ: lỗi AI không viết lại liên tục
  const row = await first(x.db, 'SELECT id FROM sp_posts WHERE src_ref = ? ORDER BY id DESC LIMIT 1', src.ref);
  const where = src.kind === 'web' ? 'bài viết trên website (Góc Sống Lành) có tên "' + src.title + '"' : 'bài trong nhóm Zalo "Sống khỏe cùng Thực Dưỡng Lành"';
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
    'Trả về ĐÚNG định dạng (không lời dẫn):', 'BÀI:', '<nội dung>', 'BÌNH LUẬN GHIM:', '<1–2 câu>', 'TRẢ LỜI CÓ LINK:', '<1 câu> [LINK]', 'BÀI HỘI NHÓM:', '<nội dung>', 'NHẬT KÝ ZALO:', '<nội dung> [LINK]', 'TIN ZALO:', '<2–4 câu> [LINK]', 'GỢI Ý ẢNH:', '<1 câu: ảnh THẬT người đăng tự chụp bằng điện thoại đúng khoảnh khắc trong bài (vd ly trà trên bàn làm việc, mâm cơm tối, góc bếp buổi sáng); không chụp mặt khách, không ảnh sản phẩm trơn, không banner, không chữ trên ảnh>'
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
    const imgh = clean(grab('GỢI Ý ẢNH', '')).split('\n')[0];
    if (text.length < 100 || !cmt) return;
    await run(x.db, "UPDATE sp_posts SET text = ?, cmt = ?, reply = ?, zmsg = ?, grp = ?, znk = ?, imgh = ?, img = ?, status = 'ok', ok_by = 'Tự động (bài gốc đã duyệt)', ok_at = ? WHERE id = ?", text.slice(0, 5000), cmt.slice(0, 600), reply.slice(0, 400), zmsg.slice(0, 1200), grp.slice(0, 4000), znk.slice(0, 1500), imgh.slice(0, 300), String(src.img || '').slice(0, 300), now, row.id);
    const us = await all(x.db, "SELECT name, tg FROM users WHERE active = 1 AND coalesce(tg, '') != '' AND role NOT IN ('Kho', 'Kế toán', 'Marketing')");
    const msg = '📣 <b>Có bài mới để chia sẻ</b> (' + (src.kind === 'web' ? '📰 từ bài web' : '💬 từ nhóm Zalo') + '): ' + cut(src.title, 120).replace(/[<>&]/g, '') + '\nĐã có sẵn bài đăng Facebook cá nhân, bài hội nhóm, nhật ký Zalo và tin Zalo gửi khách, link riêng của bạn tự gắn.\n👉 CRM → Hôm nay → 🌱 việc 5 → Xem bài & cách đăng';
    for (const v of us) { try { await telegramTo(x.env, v.tg, msg); } catch (e) { } }
  } catch (e) { console.error('spRepurpose', e.message); }
}

export async function crmSpf(x, u, d, crmLog) {
  await schema(x.db);
  const a = d.action, now = Date.now(), id = Number(d.id) || 0;
  if (a === 'spf_list') { // sale: bài đã duyệt; người quản lý (d.all): mọi bài
    const all_ = !!d.all && canEdit(u), rows = await all(x.db, all_ ? 'SELECT * FROM sp_posts ORDER BY id DESC LIMIT 40' : "SELECT * FROM sp_posts WHERE status = 'ok' ORDER BY id DESC LIMIT 15");
    return { ok: true, posts: rows.map(r => shape(r, all_)), to: Object.fromEntries(Object.entries(SPF_TO).map(([k, v]) => [k, v[1]])), edit: canEdit(u), write: canIns(u), learnEd: await edCount(x, 'sp') };
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
  const row = id && await first(x.db, 'SELECT * FROM sp_posts WHERE id = ?', id); if (!row) return { ok: false, error: 'Không tìm thấy bài.' };
  if (a === 'spf_save') {
    const st = ['draft', 'ok', 'off'].includes(d.status) ? d.status : row.status;
    const text = d.text != null ? insViet(cut(d.text, 5000)) : row.text, cmt = d.cmt != null ? cut(d.cmt, 600).replace(/https?:\/\/\S+/g, '') : row.cmt;
    let reply = d.reply != null ? cut(d.reply, 400) : row.reply; if (!/\[LINK\]/.test(reply)) reply = reply.trim() + ' [LINK]';
    const to = SPF_TO[d.to] ? d.to : row.to_k, grp = d.grp != null ? insViet(cut(d.grp, 4000)).replace(/https?:\/\/\S+/g, '') : row.grp || '';
    let znk = d.znk != null ? cut(d.znk, 1500) : row.znk || '', zmsg = d.zmsg != null ? cut(d.zmsg, 1200) : row.zmsg || '', imgh = d.imgh != null ? cut(d.imgh, 300) : row.imgh || '';
    if (znk && !/\[LINK\]/.test(znk)) znk += ' [LINK]'; if (zmsg && !/\[LINK\]/.test(zmsg)) zmsg += ' [LINK]';
    await run(x.db, 'UPDATE sp_posts SET grp = ?, znk = ?, zmsg = ?, imgh = ? WHERE id = ?', grp, znk, zmsg, imgh, id);
    await run(x.db, 'UPDATE sp_posts SET text = ?, cmt = ?, reply = ?, to_k = ?, status = ?, ok_by = ?, ok_at = ? WHERE id = ?', text, cmt, reply, to, st,
      st === 'ok' && row.status !== 'ok' ? u.name : row.ok_by, st === 'ok' && row.status !== 'ok' ? now : row.ok_at, id);
    if (d.text != null || d.cmt != null) await edAdd(x, 'sp', { id: 'sp' + id, by: u.name, t: '', ai: row.text + '\n[BÌNH LUẬN GHIM] ' + row.cmt, hu: text + '\n[BÌNH LUẬN GHIM] ' + cmt }); // ✍️ trợ lý học từ bản sửa
    if (st !== row.status) await crmLog(x, u, 'Bài Facebook cá nhân', '-', '', st === 'ok' ? 'Cho sale dùng' : st === 'off' ? 'Ẩn bài' : 'Về nháp', row.text.slice(0, 120));
    return { ok: true, post: shape(await first(x.db, 'SELECT * FROM sp_posts WHERE id = ?', id), true) };
  }
  if (a === 'spf_del') { await run(x.db, 'DELETE FROM sp_posts WHERE id = ?', id); await crmLog(x, u, 'Bài Facebook cá nhân', '-', '', 'Xoá bài', row.text.slice(0, 120)); return { ok: true }; }
  return { ok: false, error: 'Không rõ thao tác.' };
}
