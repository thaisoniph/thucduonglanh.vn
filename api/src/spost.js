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
  schemaOk = true;
}
const canEdit = u => !!u && (u.level >= 2 || u.role === 'Marketing');
const shape = (r, full) => {
  let ins = {}; try { ins = JSON.parse(r.ins || '{}') || {}; } catch (e) { }
  const o = { id: r.id, at: r.at, f: r.f, text: r.text, cmt: r.cmt, reply: r.reply, to: SPF_TO[r.to_k] ? r.to_k : 'nhom', path: (SPF_TO[r.to_k] || SPF_TO.nhom)[0], status: r.status, copies: r.copies || 0, gn: ins.gn || '' };
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
    '# Luật riêng của bài Facebook cá nhân',
    '- Xưng "mình", gọi người đọc "mọi người" / "các bạn" / "anh chị" hợp với nhóm khách. Kể từ góc nhìn của chính người đăng (một ngày làm việc, điều mình để ý, điều mình từng nghĩ sai). KHÔNG bịa lời khách, tên khách, câu chuyện khách cụ thể, số liệu, kết quả dùng sản phẩm.',
    '- 120–300 chữ, đoạn 1–3 câu. Câu cuối là 1 câu hỏi mở, dễ trả lời, để bạn bè bình luận (kể chuyện của họ, chọn A hay B).',
    '- TRONG BÀI: KHÔNG link, KHÔNG số điện thoại, KHÔNG giá, KHÔNG hashtag, KHÔNG "inbox / ib / nhắn mình". ' + (f === 'TOFU' ? 'Bài nhận biết: KHÔNG nhắc tên sản phẩm, chỉ có thể nhắc mình đang làm ở Thực Dưỡng Lành nếu thật tự nhiên.' : 'Bài tạo niềm tin: được nhắc 1 lần chuyện nghề (nguồn gốc, cách làm, vì sao chọn nguyên liệu) theo đúng TÀI LIỆU, không bán, không giá.'),
    '- BÌNH LUẬN GHIM: 1–2 câu, KHÔNG có link (Facebook không cho ghim bình luận có link), nối tiếp câu chuyện trong bài rồi mời ' + SPF_TO[to][2] + ', nói rõ điều kiện thật (miễn phí, để lại tên và số Zalo nếu trang yêu cầu).',
    '- TRẢ LỜI CÓ LINK: 1 câu ngắn trả lời ngay dưới bình luận ghim, kết thúc bằng đúng chữ [LINK] (CRM tự thay bằng link riêng của từng nhân viên).',
    '',
    'Trả về ĐÚNG định dạng (không lời dẫn):', INS_HEAD, '---', 'BÀI:', '<nội dung bài>', 'BÌNH LUẬN GHIM:', '<1–2 câu>', 'TRẢ LỜI CÓ LINK:', '<1 câu> [LINK]'
  ].join('\n');
  const know = await kb();
  const req = { model: WRITER, max_tokens: 3000, output_config: { effort: 'medium' },
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
  let reply = clean(grab('TRẢ LỜI CÓ LINK', '')); if (!/\[LINK\]/.test(reply)) reply = (reply || 'Link đây nhé') + ' [LINK]';
  if (text.length < 120 || !cmt) return { ok: false, error: 'AI chưa viết đủ bài + bình luận ghim, bấm viết lại nhé.' };
  const ins = insParse(head, p.bank, p.g); if (p.angle) ins.a = p.angle; if (p.big) ins.b = p.big.t;
  const r = await run(x.db, 'INSERT INTO sp_posts (at, by_name, f, ins, text, cmt, reply, to_k, status) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)', Date.now(), u.name, f, JSON.stringify(ins), text.slice(0, 5000), cmt.slice(0, 600), reply.slice(0, 400), to, 'draft');
  const id = r && r.meta && r.meta.last_row_id;
  await insLog(x, 'fbcn', { g: ins.g, gn: ins.gn, f, t: ins.t, ref: 'sp' + id, a: ins.a, b: ins.b });
  return { ok: true, post: shape(await first(x.db, 'SELECT * FROM sp_posts WHERE id = ?', id), true) };
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
    const to = SPF_TO[d.to] ? d.to : row.to_k;
    await run(x.db, 'UPDATE sp_posts SET text = ?, cmt = ?, reply = ?, to_k = ?, status = ?, ok_by = ?, ok_at = ? WHERE id = ?', text, cmt, reply, to, st,
      st === 'ok' && row.status !== 'ok' ? u.name : row.ok_by, st === 'ok' && row.status !== 'ok' ? now : row.ok_at, id);
    if (d.text != null || d.cmt != null) await edAdd(x, 'sp', { id: 'sp' + id, by: u.name, t: '', ai: row.text + '\n[BÌNH LUẬN GHIM] ' + row.cmt, hu: text + '\n[BÌNH LUẬN GHIM] ' + cmt }); // ✍️ trợ lý học từ bản sửa
    if (st !== row.status) await crmLog(x, u, 'Bài Facebook cá nhân', '-', '', st === 'ok' ? 'Cho sale dùng' : st === 'off' ? 'Ẩn bài' : 'Về nháp', row.text.slice(0, 120));
    return { ok: true, post: shape(await first(x.db, 'SELECT * FROM sp_posts WHERE id = ?', id), true) };
  }
  if (a === 'spf_del') { await run(x.db, 'DELETE FROM sp_posts WHERE id = ?', id); await crmLog(x, u, 'Bài Facebook cá nhân', '-', '', 'Xoá bài', row.text.slice(0, 120)); return { ok: true }; }
  return { ok: false, error: 'Không rõ thao tác.' };
}
