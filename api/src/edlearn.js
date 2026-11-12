/* ✍️ Học từ người thật sửa (anh Sơn 12/11/2026): trợ lý AI viết bài / trả lời khách, nhân sự sửa lại → giữ cặp "AI viết → người sửa",
 * lần viết sau đưa vài cặp gần nhất vào prompt để trợ lý chỉnh văn phong theo đúng ý người duyệt.
 * Kênh (kv 'ed_<kênh>', tối đa 15 mục, giữ 90 ngày):
 *   fb    – bài Fanpage (fb.js fp_post → fpWrite)
 *   sp    – bài Facebook cá nhân cho sale (spost.js spf_* → spWrite)
 *   blog  – bài web Góc Sống Lành: ý kiến "Viết lại theo ý kiến" + bài nhân sự sửa trong /admin rồi mới bật hiện (blog.js blogLearn → write)
 *   reply – câu trả lời của trợ lý An Lành (nhóm Zalo, Zalo riêng, Fanpage, chat web): nhân sự bấm ✍️ Dạy trợ lý trong nhật ký
 * Bài nhóm Zalo dùng cột riêng trong zb_posts (ai_text / ed_by / ed_at, edPairs trong zbot.js).
 * Mục: { id, at, by, ch (nơi trả lời), t (chủ đề / tin của khách), ai, hu, note } */
import { kvJson, kvSet, DAY } from './lib.js';

const MAX = 15, KEEP = 90 * DAY;
/** So chữ: bỏ khoảng trắng thừa + mã theo dõi utm để biết có sửa thật */
export const edNorm = t => String(t || '').replace(/[?&]utm_[a-z]+=[^\s&)]*/g, '').replace(/\s+/g, ' ').trim();
const cut = (t, n) => { t = String(t || '').trim(); return t.length > n ? t.slice(0, n) + '…' : t; };

/** Ghi 1 lần sửa. Cùng id → giữ bản AI đầu tiên, cập nhật bản người sửa + nối ý kiến. Không đổi chữ và không có ý kiến → bỏ qua. */
export async function edAdd(x, ch, o) {
  const now = Date.now(), L = ((await kvJson(x.db, 'ed_' + ch, [])) || []).filter(e => e && e.at > now - KEEP);
  const i = o.id ? L.findIndex(e => e.id === o.id) : -1, old = i >= 0 ? L.splice(i, 1)[0] : null;
  const e = { id: o.id || String(now), at: now, by: o.by || (old && old.by) || '', ch: o.ch || (old && old.ch) || '', t: cut(o.t || (old && old.t), 300),
    ai: old && old.ai ? old.ai : cut(o.ai, 3000), hu: o.hu !== undefined ? cut(o.hu, 3000) : old ? old.hu : '', note: cut([old && old.note, o.note].filter(Boolean).join(' · '), 600) };
  if (!e.note && (!e.hu || edNorm(e.ai) === edNorm(e.hu))) { await kvSet(x.db, 'ed_' + ch, JSON.stringify(L)); return false; }
  L.unshift(e);
  await kvSet(x.db, 'ed_' + ch, JSON.stringify(L.slice(0, MAX)));
  return true;
}

/** Đoạn đưa vào prompt: n lần sửa gần nhất. len = số chữ tối đa mỗi bản. */
export async function edBlock(x, ch, opt) {
  const o = Object.assign({ n: 3, len: 900 }, opt || {}), now = Date.now();
  const L = ((await kvJson(x.db, 'ed_' + ch, [])) || []).filter(e => e && e.at > now - KEEP).slice(0, o.n);
  if (!L.length) return '';
  const what = ch === 'reply' ? 'CÂU TRẢ LỜI' : 'BÀI';
  return (ch === 'reply'
    ? 'NHÂN SỰ ĐÃ SỬA CÂU TRẢ LỜI CỦA TRỢ LÝ NHƯ SAU (học cách họ trả lời: xưng hô, độ dài, giọng, điều họ thêm / bỏ; gặp câu hỏi giống thì trả lời theo ý nhân sự. KHÔNG chép nguyên văn nếu câu hỏi khác):\n'
    : 'NGƯỜI DUYỆT ĐÃ SỬA BÀI TRỢ LÝ VIẾT NHƯ SAU (học cách họ sửa: giọng văn, độ dài, câu mở / câu kết, chữ họ bỏ đi hay thêm vào, cách xuống dòng, emoji; ý kiến của họ áp dụng cho cả bài này. KHÔNG chép chủ đề hay nội dung các bài này):\n') +
    L.map((e, i) => '【Ví dụ ' + (i + 1) + (e.ch ? ' · ' + e.ch : '') + (e.t ? ' · ' + (ch === 'reply' ? 'khách hỏi: "' + e.t + '"' : e.t) : '') + '】' +
      (e.ai && e.hu && edNorm(e.ai) !== edNorm(e.hu) ? '\nTRỢ LÝ VIẾT:\n' + cut(e.ai, o.len) + '\n→ ' + (ch === 'reply' ? 'NHÂN SỰ SỬA THÀNH' : 'NGƯỜI DUYỆT SỬA THÀNH') + ':\n' + cut(e.hu, o.len) : '') +
      (e.note ? '\nÝ KIẾN CỦA NGƯỜI DUYỆT VỀ ' + what + ': ' + e.note : '')).join('\n\n');
}

/** Số lần sửa trợ lý đang học + ai sửa (CRM hiện "✍️ Trợ lý đang học từ X …") */
export async function edCount(x, ch) {
  const now = Date.now(), L = ((await kvJson(x.db, 'ed_' + ch, [])) || []).filter(e => e && e.at > now - KEEP);
  return { n: L.length, by: [...new Set(L.map(e => e.by).filter(Boolean))], ids: L.map(e => e.id) };
}
