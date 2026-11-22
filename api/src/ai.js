/* ================================================================ ✨ AI hỗ trợ sale (Đợt 3, 16/10/2026)
 * Lệnh 'ai_sum' { phone, kind: 'sum' | 'msg', task? }:
 *   sum = tóm tắt hồ sơ khách 3–4 dòng (đã mua gì, lần trước nói gì, lần này nên nói gì)
 *   msg = gợi ý 1 tin nhắn Zalo theo việc chăm sóc (task: d1, d7, runout…)
 * Chỉ chạy khi Cloudflare có secret ANTHROPIC_API_KEY (Workers → thucduonglanh-api → Settings → Variables and Secrets).
 * Không gửi tên, số điện thoại khách: tên thay bằng [Tên] (CRM điền lại trên máy), số điện thoại trong ghi chú bị che.
 * Giới hạn AI_DAY_MAX lượt / ngày cho cả công ty; cùng khách + cùng dữ liệu trong ngày thì dùng lại kết quả cũ (không tốn thêm).
 * 22/11/2026 (anh Sơn, mang từ CRM mối quan hệ crm.dinhminhthaison.com): msg viết 3 tin theo 3 góc (đúng việc hôm nay · hỏi thăm cảm nhận / cách dùng · cho đi trước),
 *   sale chọn 1, sửa, bấm Nhắn Zalo / Copy → lệnh 'ai_sent' so với gợi ý:
 *   ✍️ học: tin sale sửa lưu kv ed_care_<sale> (edlearn.js, riêng từng sale) → 5 lần gần nhất vào prompt lần sau (học giọng từng bạn);
 *   📊 đo: kv care_aiuse {sale: {sug, sent, same}} + kv care_ai_sent [{p, at, by}] → "khách mua lại trong 14 ngày sau tin AI" (aiStats). */
import Anthropic from '@anthropic-ai/sdk';
import { aiFetch } from './airelay.js';
import { normPhone, fmtDate, all, first, kvGet, kvSet, kvJson, isVoid, DAY } from './lib.js';
import { edAdd, edNorm } from './edlearn.js';

const AI_MODEL = 'claude-haiku-5-5'; // anh Sơn chọn 16/10/2026: rẻ (~17đ/lượt), đủ cho tóm tắt 4 dòng / tin 60 chữ. Cần hay hơn thì đổi 'claude-opus-5-5' (~680đ/lượt)
const AI_DAY_MAX = 300;
const TASK_WORD = { callback: 'gọi lại theo hẹn', d1: 'hỏi đã nhận hàng chưa, hướng dẫn cách dùng', runout: 'sắp dùng hết sản phẩm, nhắc đặt lại', d7: 'hỏi thăm sau 1 tuần dùng (khách mua lần đầu)', d14: 'xin cảm nhận sau 2 tuần', d30: 'giới thiệu sản phẩm phù hợp', winback: 'lâu chưa mua, mời quay lại', old: 'khách cũ lâu chưa liên lạc', other: 'chăm sóc chung' };
const SYSTEM = [
  'Bạn hỗ trợ nhân viên chăm sóc khách của Thực Dưỡng Lành (thực phẩm dinh dưỡng, thực phẩm bổ sung, trà thảo mộc). Viết tiếng Việt tự nhiên, ngắn gọn, dễ hiểu.',
  'Chỉ dùng thông tin có trong dữ liệu được cung cấp. Không bịa số liệu, không đoán bệnh của khách.',
  'Tuyệt đối không dùng các từ "chữa", "điều trị", "khỏi bệnh", không hứa công dụng chữa bệnh. Sản phẩm là thực phẩm, không phải là thuốc.',
  'Khách được gọi là [Tên] — giữ nguyên chữ [Tên] trong câu trả lời, không tự đặt tên khác.'
].join('\n');

const slug = s => String(s || '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/đ/g, 'd').replace(/[^a-z0-9]/g, '').slice(0, 24);
const GOC = ['Đúng việc hôm nay', 'Hỏi thăm cảm nhận / cách dùng', 'Cho đi trước'];

/** 📊 số đo tin AI (của 1 sale, hoặc cả công ty nếu all) – 30 ngày: gợi ý / có gửi / gửi y nguyên / khách mua lại trong 14 ngày sau tin */
export async function aiStats(x, name, all30) {
  const use = await kvJson(x.db, 'care_aiuse', {}) || {}, k = slug(name);
  const sum = all30 ? Object.values(use).reduce((a, o) => ({ sug: a.sug + (o.sug || 0), sent: a.sent + (o.sent || 0), same: a.same + (o.same || 0) }), { sug: 0, sent: 0, same: 0 }) : Object.assign({ sug: 0, sent: 0, same: 0 }, use[k] || {});
  const now = Date.now(), L = ((await kvJson(x.db, 'care_ai_sent', [])) || []).filter(e => e && e.at > now - 30 * DAY && (all30 || e.by === name));
  let buy = 0;
  if (L.length) {
    const ph = [...new Set(L.map(e => e.p))].slice(0, 300);
    const os = await all(x.db, 'SELECT phone, time, status FROM orders WHERE time > ? AND phone IN (' + ph.map(() => '?').join(',') + ')', now - 45 * DAY, ...ph);
    buy = L.filter(e => os.some(o => o.phone === e.p && o.time > e.at && o.time <= e.at + 14 * DAY && !isVoid(o.status))).length;
  }
  return { sug: sum.sug, sent: sum.sent, same: sum.same, n30: L.length, buy, learn: (((await kvJson(x.db, 'ed_care_' + k, [])) || []).length) };
}
async function aiUse(x, name, key) { const m = await kvJson(x.db, 'care_aiuse', {}) || {}; const o = m[slug(name)] || (m[slug(name)] = { sug: 0, sent: 0, same: 0, from: Date.now() }); o[key] = (o[key] || 0) + 1; await kvSet(x.db, 'care_aiuse', JSON.stringify(m)); }
async function learnBlock(x, name) {
  const L = ((await kvJson(x.db, 'ed_care_' + slug(name), [])) || []).filter(e => e && e.ai && e.hu && e.at > Date.now() - 90 * DAY).slice(0, 5);
  if (!L.length) return '';
  return '\n\n# CÁCH BẠN SALE NÀY HAY SỬA TIN AI (học giọng: xưng hô, độ dài, chữ hay dùng, điều bạn ấy thêm / bỏ; KHÔNG chép nội dung)\n' + L.map((e, i) => (i + 1) + '. ' + (e.ch ? '[' + e.ch + '] ' : '') + 'AI viết: "' + String(e.ai).slice(0, 250) + '"\n   Bạn ấy gửi: "' + String(e.hu).slice(0, 250) + '"').join('\n');
}

/** Lệnh 'ai_sent' {phone, text (tên khách đã đổi về [Tên])}: sale bấm Nhắn Zalo / Copy sau khi chọn tin AI → đo + học (chỉ tính 1 lần cho mỗi lần gợi ý) */
export async function crmAiSent(x, u, d) {
  const phone = normPhone(d.phone), text = String(d.text || '').trim().slice(0, 1500), sk = 'care_sug_' + phone + '_' + slug(u.name);
  const raw = await kvGet(x.db, sk); if (!raw || !text) return { ok: true, skip: 1 };
  let g = {}; try { g = JSON.parse(raw); } catch (e) { return { ok: true, skip: 1 }; }
  const words = t => new Set(edNorm(t).toLowerCase().split(' ')), tw = words(text);
  const sim = t => { const w = words(t); let n = 0; for (const v of w) if (tw.has(v)) n++; return n / Math.max(w.size, tw.size, 1); };
  const best = (g.r || []).map((t, i) => ({ t, i, s: sim(t) })).sort((a, b) => b.s - a.s)[0];
  if (!best || best.s < 0.15) return { ok: true, skip: 1 }; // tin khác hẳn (sale tự viết / dùng mẫu) → không tính là tin AI
  await kvSet(x.db, sk, '', 1);
  await aiUse(x, u.name, 'sent');
  const now = Date.now(), L = ((await kvJson(x.db, 'care_ai_sent', [])) || []).filter(e => e && e.at > now - 90 * DAY);
  L.unshift({ p: phone, at: now, by: u.name }); await kvSet(x.db, 'care_ai_sent', JSON.stringify(L.slice(0, 600)));
  if (edNorm(best.t) === edNorm(text)) { await aiUse(x, u.name, 'same'); return { ok: true, same: 1 }; }
  await edAdd(x, 'care_' + slug(u.name), { id: phone + ':' + now, by: u.name, ch: (GOC[best.i] || '') + ' · ' + (TASK_WORD[g.task] || ''), ai: best.t, hu: text }); // cả 2 bản đều giữ chữ [Tên] (máy sale đổi tên khách về [Tên] trước khi gửi lên)
  return { ok: true, learned: 1 };
}

let client = null;
function ai(env) { if (!client) client = new Anthropic({ apiKey: env.ANTHROPIC_API_KEY, maxRetries: 1, timeout: 25e3, fetch: aiFetch(env), defaultHeaders: { 'x-tdl-muc': 'crm' } }); return client; } // qua trạm Bắc Mỹ (airelay.js)

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
  const ck = 'ai_' + kind + '_' + phone + (kind === 'msg' ? '_' + task + '_' + slug(u.name) : ''), sig = fmtDate(Date.now(), 'yyMMdd') + ':' + data.length; // cùng ngày + dữ liệu không đổi → dùng lại
  if (!d.fresh) try { const old = JSON.parse(await kvGet(x.db, ck) || 'null'); if (old && old.sig === sig && (old.text || old.msgs)) return Object.assign({ ok: true, cached: 1 }, old.msgs ? { msgs: old.msgs, text: old.msgs[0].text, stats: await aiStats(x, u.name) } : { text: old.text }); } catch (e) { }
  const dk = 'ai_n_' + fmtDate(Date.now(), 'yyMMdd'), n = Number(await kvGet(x.db, dk) || 0);
  if (n >= AI_DAY_MAX) return { ok: false, error: 'Hôm nay đã dùng hết ' + AI_DAY_MAX + ' lượt AI của công ty. Mai dùng tiếp nhé.' };
  await kvSet(x.db, dk, String(n + 1), 2 * DAY);
  const ask = kind === 'sum'
    ? 'Tóm tắt khách này cho nhân viên sắp gọi điện, tối đa 4 dòng gạch đầu dòng, mỗi dòng dưới 25 chữ:\n1) Khách mua gì, bao lâu mua 1 lần.\n2) Lần liên hệ gần nhất khách nói gì.\n3) Điều cần lưu ý (nếu dữ liệu có).\n4) Lần này nên nói gì.\nKhông viết lời chào, không thêm tiêu đề.'
    : 'Viết 3 tin nhắn Zalo ngắn (mỗi tin dưới 60 chữ) để nhân viên chọn 1 gửi cho khách, mỗi tin 1 góc:\n' +
      '1) "' + GOC[0] + '": đúng mục đích hôm nay – ' + TASK_WORD[task] + '.\n' +
      '2) "' + GOC[1] + '": hỏi thăm khách dùng sản phẩm đã mua thấy thế nào / có cần em hướng dẫn cách dùng không, nhắc 1 chi tiết có thật trong dữ liệu (sản phẩm, lần chăm sóc trước).\n' +
      '3) "' + GOC[2] + '": trao 1 điều nhỏ có ích trước, không bán (mẹo dùng sản phẩm đã mua cho đúng, lời hỏi thăm theo điều khách từng kể), câu cuối hỏi nhẹ để khách dễ trả lời.\n' +
      'Xưng "em", gọi khách là [Tên], giọng thân thiện như người quen nhắn thật, không quảng cáo quá đà, tối đa 1 emoji mỗi tin.\n' +
      'Trả về ĐÚNG 1 khối JSON, không viết gì khác: {"msgs":[{"goc":"' + GOC[0] + '","text":"..."},{"goc":"' + GOC[1] + '","text":"..."},{"goc":"' + GOC[2] + '","text":"..."}]}' + await learnBlock(x, u.name);
  let res;
  try {
    res = await ai(x.env).messages.create({ // Haiku 5.5: không có mô hình dự phòng phía máy chủ; bị từ chối thì báo sale (stop_reason refusal bên dưới)
      model: AI_MODEL, max_tokens: kind === 'msg' ? 3000 : 2000, output_config: { effort: 'low' }, // msg: 3 tin + suy nghĩ (zsale.js 18/11: 700 token bị dùng hết để suy nghĩ)
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
  if (kind === 'msg') {
    let msgs = [];
    try { msgs = (JSON.parse((text.match(/\{[\s\S]*\}/) || ['{}'])[0]).msgs || []).filter(m => m && m.text).slice(0, 3).map((m, i) => ({ goc: GOC.includes(m.goc) ? m.goc : GOC[i] || GOC[0], text: String(m.text).trim().slice(0, 600) })); } catch (e) { }
    if (!msgs.length) msgs = [{ goc: GOC[0], text: text.slice(0, 600) }]; // AI không trả JSON → coi cả câu là 1 tin (như trước)
    await kvSet(x.db, ck, JSON.stringify({ sig, msgs }), DAY);
    await kvSet(x.db, 'care_sug_' + phone + '_' + slug(u.name), JSON.stringify({ r: msgs.map(m => m.text), task }), 3 * DAY); // để đo + học khi bấm Nhắn Zalo (crmAiSent)
    await aiUse(x, u.name, 'sug');
    return { ok: true, msgs, text: msgs[0].text, stats: await aiStats(x, u.name) };
  }
  await kvSet(x.db, ck, JSON.stringify({ sig, text }), DAY);
  return { ok: true, text };
}
