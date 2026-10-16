/* ================================================================ ✨ AI hỗ trợ sale (Đợt 3, 16/10/2026)
 * Lệnh 'ai_sum' { phone, kind: 'sum' | 'msg', task? }:
 *   sum = tóm tắt hồ sơ khách 3–4 dòng (đã mua gì, lần trước nói gì, lần này nên nói gì)
 *   msg = gợi ý 1 tin nhắn Zalo theo việc chăm sóc (task: d1, d7, runout…)
 * Chỉ chạy khi Cloudflare có secret ANTHROPIC_API_KEY (Workers → thucduonglanh-api → Settings → Variables and Secrets).
 * Không gửi tên, số điện thoại khách: tên thay bằng [Tên] (CRM điền lại trên máy), số điện thoại trong ghi chú bị che.
 * Giới hạn AI_DAY_MAX lượt / ngày cho cả công ty; cùng khách + cùng dữ liệu trong ngày thì dùng lại kết quả cũ (không tốn thêm). */
import Anthropic from '@anthropic-ai/sdk';
import { normPhone, fmtDate, all, first, kvGet, kvSet, isVoid, DAY } from './lib.js';

const AI_MODEL = 'claude-haiku-5-5'; // anh Sơn chọn 16/10/2026: rẻ (~17đ/lượt), đủ cho tóm tắt 4 dòng / tin 60 chữ. Cần hay hơn thì đổi 'claude-opus-5-5' (~680đ/lượt)
const AI_DAY_MAX = 300;
const TASK_WORD = { callback: 'gọi lại theo hẹn', d1: 'hỏi đã nhận hàng chưa, hướng dẫn cách dùng', runout: 'sắp dùng hết sản phẩm, nhắc đặt lại', d7: 'hỏi thăm sau 1 tuần dùng (khách mua lần đầu)', d14: 'xin cảm nhận sau 2 tuần', d30: 'giới thiệu sản phẩm phù hợp', winback: 'lâu chưa mua, mời quay lại', old: 'khách cũ lâu chưa liên lạc', other: 'chăm sóc chung' };
const SYSTEM = [
  'Bạn hỗ trợ nhân viên chăm sóc khách của Thực Dưỡng Lành (thực phẩm dinh dưỡng, thực phẩm bổ sung, trà thảo mộc). Viết tiếng Việt tự nhiên, ngắn gọn, dễ hiểu.',
  'Chỉ dùng thông tin có trong dữ liệu được cung cấp. Không bịa số liệu, không đoán bệnh của khách.',
  'Tuyệt đối không dùng các từ "chữa", "điều trị", "khỏi bệnh", không hứa công dụng chữa bệnh. Sản phẩm là thực phẩm, không phải là thuốc.',
  'Khách được gọi là [Tên] — giữ nguyên chữ [Tên] trong câu trả lời, không tự đặt tên khác.'
].join('\n');

let client = null;
function ai(env) { if (!client) client = new Anthropic({ apiKey: env.ANTHROPIC_API_KEY, maxRetries: 1, timeout: 25e3 }); return client; }

/** Che số điện thoại / email trong ghi chú trước khi gửi đi. */
const scrub = s => String(s || '').replace(/(\+?84|0)[\d .]{8,12}\d/g, '[SĐT]').replace(/[\w.+-]+@[\w-]+\.[\w.]+/g, '[email]');

async function custData(x, phone) {
  const c = await first(x.db, 'SELECT name, orders, spent, first, last, products, runout, care_result, note, tag, recv FROM customers WHERE phone = ?', phone);
  if (!c) return null;
  const os = await all(x.db, 'SELECT time, items, total, status FROM orders WHERE phone = ? ORDER BY time DESC LIMIT 12', phone);
  const lg = await all(x.db, "SELECT time, what, result, note FROM logs WHERE ref = ? AND what NOT IN ('Sửa thông tin khách', 'Đổi phụ trách', 'Xoá dữ liệu') ORDER BY time DESC LIMIT 12", phone);
  const nm = String(c.name || '').replace(/^(chị|anh|cô|chú|bác|em|bà|ông)\s+/i, '').trim(), hide = s => nm.length >= 2 ? scrub(s).split(nm).join('[Tên]') : scrub(s);
  const d = t => t ? fmtDate(t, 'dd/MM/yy') : '?';
  const lines = [
    'Hôm nay: ' + d(Date.now()),
    'Khách mua ' + (c.orders || 0) + ' đơn, tổng ' + Math.round((c.spent || 0) / 1000) + 'k, đơn đầu ' + d(c.first) + ', đơn gần nhất ' + d(c.last) + (c.runout ? ', dự kiến dùng hết ' + d(c.runout) : '') + '.',
    'Sản phẩm đã mua: ' + (c.products || '–'),
    c.tag ? 'Nhãn: ' + hide(c.tag) : '',
    'Đơn hàng (mới nhất trước):', ...os.map(o => '- ' + d(o.time) + ': ' + String(o.items || '').replace(/\s+/g, ' ').slice(0, 160) + ' · ' + Math.round((o.total || 0) / 1000) + 'k · ' + (o.status || '') + (isVoid(o.status) ? ' (không tính)' : '')),
    'Lịch sử chăm sóc (mới nhất trước):', ...(lg.length ? lg.map(l => '- ' + d(l.time) + ': ' + l.what + (l.result ? ' → ' + l.result : '') + (l.note ? ' · ' + hide(l.note).slice(0, 200) : '')) : ['- chưa có']),
    'Ghi chú của nhân viên (mới nhất ở trên):', hide(c.note).slice(0, 3000) || '–'
  ];
  return lines.filter(Boolean).join('\n');
}

export async function crmAi(x, u, d) {
  if (!x.env.ANTHROPIC_API_KEY) return { ok: false, off: true, error: 'AI chưa được bật (chưa có khoá ANTHROPIC_API_KEY trên máy chủ).' };
  const phone = normPhone(d.phone), kind = d.kind === 'msg' ? 'msg' : 'sum';
  const c = await first(x.db, 'SELECT owner FROM customers WHERE phone = ?', phone);
  if (!c) return { ok: false, error: 'Không tìm thấy khách.' };
  if (u.level < 2 && c.owner && c.owner !== u.name) return { ok: false, error: 'Khách này do ' + c.owner + ' phụ trách.' };
  const data = await custData(x, phone), task = TASK_WORD[d.task] ? d.task : 'other';
  const ck = 'ai_' + kind + '_' + phone + (kind === 'msg' ? '_' + task : ''), sig = fmtDate(Date.now(), 'yyMMdd') + ':' + data.length; // cùng ngày + dữ liệu không đổi → dùng lại
  try { const old = JSON.parse(await kvGet(x.db, ck) || 'null'); if (old && old.sig === sig && old.text) return { ok: true, text: old.text, cached: 1 }; } catch (e) { }
  const dk = 'ai_n_' + fmtDate(Date.now(), 'yyMMdd'), n = Number(await kvGet(x.db, dk) || 0);
  if (n >= AI_DAY_MAX) return { ok: false, error: 'Hôm nay đã dùng hết ' + AI_DAY_MAX + ' lượt AI của công ty. Mai dùng tiếp nhé.' };
  await kvSet(x.db, dk, String(n + 1), 2 * DAY);
  const ask = kind === 'sum'
    ? 'Tóm tắt khách này cho nhân viên sắp gọi điện, tối đa 4 dòng gạch đầu dòng, mỗi dòng dưới 25 chữ:\n1) Khách mua gì, bao lâu mua 1 lần.\n2) Lần liên hệ gần nhất khách nói gì.\n3) Điều cần lưu ý (nếu dữ liệu có).\n4) Lần này nên nói gì.\nKhông viết lời chào, không thêm tiêu đề.'
    : 'Viết 1 tin nhắn Zalo ngắn (dưới 60 chữ) nhân viên gửi cho khách, mục đích: ' + TASK_WORD[task] + '. Xưng "em", gọi khách là [Tên], giọng thân thiện, không quảng cáo quá đà, không dùng emoji quá 2 cái. Chỉ trả về nội dung tin nhắn.';
  let res;
  try {
    res = await ai(x.env).messages.create({ // Haiku 5.5: không có mô hình dự phòng phía máy chủ; bị từ chối thì báo sale (stop_reason refusal bên dưới)
      model: AI_MODEL, max_tokens: 2000, output_config: { effort: 'low' },
      system: SYSTEM,
      messages: [{ role: 'user', content: 'Dữ liệu khách:\n' + data + '\n\n' + ask }]
    });
  } catch (e) {
    if (e instanceof Anthropic.AuthenticationError) return { ok: false, error: 'Khoá AI không đúng hoặc đã bị khoá. Nhờ quản trị kiểm tra ANTHROPIC_API_KEY.' };
    if (e instanceof Anthropic.RateLimitError) return { ok: false, error: 'AI đang bận, thử lại sau 1 phút.' };
    if (e instanceof Anthropic.APIError) return { ok: false, error: 'AI báo lỗi (' + (e.status || '') + '). Thử lại sau.' };
    return { ok: false, error: 'Không kết nối được AI. Thử lại sau.' };
  }
  if (res.stop_reason === 'refusal') return { ok: false, error: 'AI không trả lời được cho khách này.' };
  const text = res.content.filter(b => b.type === 'text').map(b => b.text).join('\n').trim().replace(/chữa|điều trị|khỏi bệnh/gi, '…');
  if (!text) return { ok: false, error: 'AI chưa trả lời, thử lại.' };
  await kvSet(x.db, ck, JSON.stringify({ sig, text }), DAY);
  return { ok: true, text };
}
