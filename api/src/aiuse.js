/* 🤖 Đếm mức dùng & chi phí AI (10/11/2026). Anthropic KHÔNG cho máy chủ hỏi "tài khoản còn bao nhiêu tiền", nên tự đếm:
 * mỗi lời gọi AI (airelay.js aiFetch) ghi số token vào bảng ai_usage theo ngày + mục + mô hình, nhân với bảng giá → tiền ước tính.
 * Quản trị ghi "đã nạp $X ngày Y" (kv ai_fund) → CRM hiện tiền còn lại ước tính, đủ mấy ngày; cron (aiTick) nhắc Telegram khi sắp hết.
 * Con số chính thức luôn xem ở console.anthropic.com → Usage / Billing; ở đây là ước tính (lệch vài %). */
import { run, all, first, kvGet, kvSet, kvDel, kvJson, fmtDate, DAY } from './lib.js';
import { telegram } from './google.js';

/** Giá USD / 1 triệu token (platform.claude.com/docs/en/about-claude/pricing, đọc lại 13/11/2026): [đầu tên mô hình, vào, ra, đọc cache, ghi cache 5 phút].
 * Mô hình lạ → tính theo Haiku. Haiku 5.5 có 2 mức: lời gọi gửi vào > 100 nghìn token (tính cả phần đọc / ghi cache) thì cả lượt tính giá gấp 5 (HAIKU_BIG). */
const PRICE = [
  ['claude-haiku-5-5', 0.10, 0.50, 0.01, 0.125],
  ['claude-haiku-4-5', 1, 5, 0.10, 1.25],
  ['claude-sonnet-5-5', 2, 10, 0.10, 2.5],
  ['claude-sonnet-5', 2, 10, 0.20, 2.5],
  ['claude-sonnet-4-6', 3, 15, 0.30, 3.75],
  ['claude-opus-5-5', 4, 20, 0.20, 5],
  ['claude-opus-5', 5, 25, 0.50, 6.25],
  ['claude-opus-4', 5, 25, 0.50, 6.25],
  ['claude-fable-5-2', 8, 40, 0.20, 10],
  ['claude-fable', 10, 50, 0.25, 12.5],
];
const HAIKU_BIG = ['claude-haiku-5-5', 0.50, 2.50, 0.05, 0.625];
/** Nhãn mục (header x-tdl-muc mỗi client AI gửi kèm). */
export const MUC = {
  chat: '💬 Chat An Lành trên web', zalo: '🤖 Trợ lý Zalo trả lời, chào, nhắn riêng', 'zalo-bai': '📝 Soạn bài nhóm Zalo', 'zalo-kh': '📋 Kế hoạch chủ đề nhóm Zalo',
  fanpage: '📘 Trợ lý Fanpage trả lời', 'fb-bai': '📝 Soạn bài Fanpage', 'web-bai': '📰 Trợ lý viết bài web', video: '🎬 Kịch bản video', insight: '🔍 Tìm / đọc insight', offer: '🎁 Viết offer', chamdiem: '🧪 Chấm bài trước khi đăng', crm: '✨ AI trong CRM (tóm tắt khách, gợi ý tin)',
  loikhach: '🗣 Kho lời khách (phân loại câu)', youtube: '▶️ Báo cáo tuần YouTube', hoi: '📊 Hỏi số liệu CRM', giaoviec: '✅ Bot giao việc đọc tin Telegram', 'tg-so': '📊 Hỏi số quảng cáo qua Telegram', huongdan: '📖 Hỏi trợ lý ở trang hướng dẫn', tuyendung: '🧑‍💼 AI đọc CV ứng viên', san: '🛒 Trợ lý sàn Shopee (sức khoẻ shop, đối thủ)', ketoan: '🧾 AI đọc chứng từ nhà cung cấp',
  'insight-anh': '📸 Câu lệnh tạo ảnh', 'insight-big': '💡 Big idea', 'insight-kw': '🔑 Lập từ khoá bài web', 'fb-ca-nhan': '👤 Bài Facebook cá nhân cho sale', khac: 'Khác',
};

/* 🎛 Chọn mô hình theo việc (20/11/2026, anh Sơn: "setup để anh chủ động chọn mô hình với từng loại công việc").
 * kv ai_models = { m: { <mục>: 'haiku' | 'sonnet' | 'opus' }, by: { <mục>: { n: tên, at } } }. Mục không có trong m = giữ mô hình code đang chọn (DEF).
 * airelay.js aiFetch đổi trường model ngay trước khi gửi Anthropic; mô hình chọn bị lỗi 400 (không hỗ trợ tham số…) → tự gửi lại bằng mô hình gốc. */
export const MODELS = { haiku: 'claude-haiku-5-5', sonnet: 'claude-sonnet-5-5', opus: 'claude-opus-5-5' };
/** Mô hình code đang dùng cho từng mục (để CRM hiện "Mặc định (…)"); 'mix' = trong mục có nhiều việc dùng mô hình khác nhau. */
export const DEF = { chat: 'haiku', zalo: 'haiku', 'zalo-bai': 'sonnet', 'zalo-kh': 'sonnet', fanpage: 'haiku', 'fb-bai': 'sonnet', 'web-bai': 'opus', video: 'opus', insight: 'mix', offer: 'opus', chamdiem: 'opus', crm: 'haiku',
  loikhach: 'haiku', youtube: 'sonnet', hoi: 'sonnet', giaoviec: 'haiku', 'tg-so': 'haiku', huongdan: 'haiku', tuyendung: 'sonnet', san: 'mix', ketoan: 'sonnet', 'insight-anh': 'sonnet', 'insight-big': 'opus', 'insight-kw': 'sonnet', 'fb-ca-nhan': 'opus' };
let pickCache = null, pickAt = 0;
async function pickMap(db) {
  if (pickCache && Date.now() - pickAt < 60e3) return pickCache; // đọc lại sau 1 phút (mỗi máy chủ giữ bản riêng)
  pickCache = await kvJson(db, 'ai_models', { m: {}, by: {} }); if (!pickCache.m) pickCache.m = {}; if (!pickCache.by) pickCache.by = {}; pickAt = Date.now(); return pickCache;
}
/** Mô hình Quản trị chọn cho 1 mục ('' = giữ mặc định). Không bao giờ ném lỗi. */
export async function aiPick(db, muc) { try { if (!db || !muc || muc === 'khac') return ''; const c = await pickMap(db); return MODELS[c.m[muc]] || ''; } catch (e) { return ''; } }
/** Lệnh CRM ai_pick (Quản trị): đổi mô hình cho 1 mục. model '' = về mặc định. */
export async function aiPickSet(x, u, d) {
  if (u.level < 3) return { ok: false, error: 'Chỉ Quản trị đổi được mô hình AI.' };
  const muc = String(d.muc || ''), m = String(d.model || '');
  if (!MUC[muc] || muc === 'khac') return { ok: false, error: 'Không có việc này.' };
  if (m && !MODELS[m]) return { ok: false, error: 'Mô hình không hợp lệ.' };
  const c = await kvJson(x.db, 'ai_models', { m: {}, by: {} }); c.m = c.m || {}; c.by = c.by || {};
  if (m && m !== DEF[muc]) c.m[muc] = m; else delete c.m[muc]; // chọn trùng mặc định = bỏ ghi đè
  c.by[muc] = { n: u.name, at: Date.now() };
  await kvSet(x.db, 'ai_models', JSON.stringify(c)); pickCache = null;
  return { ok: true, pick: c.m };
}
const RATE_DEF = 26500; // đ / USD, Quản trị sửa được
const slotDay = d => Date.UTC(+d.slice(0, 4), +d.slice(4, 6) - 1, +d.slice(6, 8)); // 'yyyyMMdd' → mốc ngày để trừ nhau

export function usdOf(model, u) {
  const m = String(model || '');
  let p = PRICE.find(r => m.startsWith(r[0])) || PRICE[0];
  if (p[0] === 'claude-haiku-5-5' && (Number(u.input_tokens) || 0) + (Number(u.cache_read_input_tokens) || 0) + (Number(u.cache_creation_input_tokens) || 0) > 100000) p = HAIKU_BIG;
  const w1h = Number(u.cache_creation && u.cache_creation.ephemeral_1h_input_tokens) || 0; // ghi cache giữ 1 giờ: giá gấp 2 giá vào (ghi 5 phút: gấp 1,25)
  return ((Number(u.input_tokens) || 0) * p[1] + (Number(u.output_tokens) || 0) * p[2] + (Number(u.cache_read_input_tokens) || 0) * p[3] + (Number(u.cache_creation_input_tokens) || 0) * p[4] + w1h * (p[1] * 2 - p[4])) / 1e6;
}

let schemaOk = false;
async function schema(db) {
  if (schemaOk) return;
  await run(db, 'CREATE TABLE IF NOT EXISTS ai_usage (day TEXT, muc TEXT, model TEXT, n INTEGER DEFAULT 0, inp INTEGER DEFAULT 0, out INTEGER DEFAULT 0, cr INTEGER DEFAULT 0, cw INTEGER DEFAULT 0, usd REAL DEFAULT 0, PRIMARY KEY (day, muc, model))');
  schemaOk = true;
}

/** Ghi 1 lời gọi (gọi từ airelay.js, không bao giờ ném lỗi ra ngoài). */
export async function aiLog(db, muc, model, u) {
  try {
    if (!db || !u) return;
    await schema(db);
    const k = MUC[muc] ? muc : 'khac', inp = Number(u.input_tokens) || 0, out = Number(u.output_tokens) || 0, cr = Number(u.cache_read_input_tokens) || 0, cw = Number(u.cache_creation_input_tokens) || 0;
    await run(db, `INSERT INTO ai_usage (day, muc, model, n, inp, out, cr, cw, usd) VALUES (?, ?, ?, 1, ?, ?, ?, ?, ?)
      ON CONFLICT(day, muc, model) DO UPDATE SET n = n + 1, inp = inp + excluded.inp, out = out + excluded.out, cr = cr + excluded.cr, cw = cw + excluded.cw, usd = usd + excluded.usd`,
      fmtDate(Date.now(), 'yyyyMMdd'), k, String(model || '').slice(0, 40), inp, out, cr, cw, usdOf(model, u));
  } catch (e) { console.error('aiLog', e && e.message); }
}

/** Tiền còn lại ước tính = đã nạp − chi từ ngày nạp. Trả về null nếu chưa ghi số tiền nạp. */
export async function aiBalance(db) {
  await schema(db);
  const f = await kvJson(db, 'ai_fund', null), now = Date.now();
  const d7 = fmtDate(now - 7 * DAY, 'yyyyMMdd');
  const w = await first(db, 'SELECT COALESCE(SUM(usd), 0) s, MIN(day) d0 FROM ai_usage WHERE day > ?', d7), today = fmtDate(now, 'yyyyMMdd');
  // số ngày đã có số liệu trong 7 ngày qua (mới bắt đầu đếm thì chia cho số ngày thật, không chia 7 → khỏi ra "đủ 14.000 ngày")
  const tracked = w && w.d0 ? Math.min(7, Math.round((slotDay(today) - slotDay(String(w.d0))) / DAY) + 1) : 0;
  const perDay = tracked ? (Number(w.s) || 0) / tracked : 0, rate = Number(await kvGet(db, 'ai_rate')) || RATE_DEF, enough = tracked >= 2; // cần ≥ 2 ngày số liệu mới ước tính được số ngày còn lại
  if (!f || !(Number(f.usd) > 0)) return { fund: null, perDay, tracked, enough, rate };
  const s = await first(db, 'SELECT COALESCE(SUM(usd), 0) s FROM ai_usage WHERE day >= ?', String(f.day || ''));
  const spent = s ? Number(s.s) : 0, left = Number(f.usd) - spent;
  return { fund: f, spent, left, perDay, tracked, enough, days: enough && perDay > 0 ? left / perDay : null, rate };
}

/** CRM → Cài đặt → 🤖 Chi phí trợ lý AI (Quản trị). */
export async function aiUsage(x, u) {
  if (u.level < 3) return { ok: false, error: 'Chỉ Quản trị xem được chi phí AI.' };
  await schema(x.db);
  const now = Date.now(), today = fmtDate(now, 'yyyyMMdd'), d7 = fmtDate(now - 7 * DAY, 'yyyyMMdd'), d30 = fmtDate(now - 30 * DAY, 'yyyyMMdd'), m0 = today.slice(0, 6) + '01';
  const sum = async (from, to) => { const r = await first(x.db, 'SELECT COALESCE(SUM(usd), 0) usd, COALESCE(SUM(n), 0) n FROM ai_usage WHERE day >= ? AND day <= ?', from, to || '99999999'); return { usd: Number(r.usd), n: Number(r.n) }; };
  const [bal, tDay, t7, t30, tMon, byMuc, byModel, byDay, since, mm, pk] = await Promise.all([
    aiBalance(x.db), sum(today), sum(d7 > m0 ? d7 : d7), sum(d30), sum(m0),
    all(x.db, 'SELECT muc, SUM(n) n, SUM(usd) usd, SUM(inp) inp, SUM(out) out, SUM(cr) cr FROM ai_usage WHERE day >= ? GROUP BY muc ORDER BY usd DESC', d30),
    all(x.db, 'SELECT model, SUM(n) n, SUM(usd) usd FROM ai_usage WHERE day >= ? GROUP BY model ORDER BY usd DESC', d30),
    all(x.db, 'SELECT day, SUM(n) n, SUM(usd) usd FROM ai_usage WHERE day >= ? GROUP BY day ORDER BY day', fmtDate(now - 14 * DAY, 'yyyyMMdd')),
    first(x.db, 'SELECT MIN(day) d FROM ai_usage'),
    all(x.db, 'SELECT muc, model, SUM(n) n, SUM(inp) inp, SUM(out) out, SUM(cr) cr, SUM(cw) cw FROM ai_usage WHERE day >= ? GROUP BY muc, model', d30),
    kvJson(x.db, 'ai_models', { m: {}, by: {} }),
  ]);
  // 🎛 ước tính 30 ngày nếu cả mục dùng Haiku / Sonnet / Opus: tính trên lượt trung bình (để bắt bẫy Haiku > 100 nghìn token / lượt)
  const est = {}, used = {};
  mm.forEach(r => {
    const n = Math.max(1, Number(r.n) || 0), avg = { input_tokens: r.inp / n, output_tokens: r.out / n, cache_read_input_tokens: r.cr / n, cache_creation_input_tokens: r.cw / n };
    const e = est[r.muc] || (est[r.muc] = { haiku: 0, sonnet: 0, opus: 0, n: 0 }); e.n += Number(r.n) || 0;
    Object.keys(MODELS).forEach(k => { e[k] += usdOf(MODELS[k], avg) * n; });
    const k = Object.keys(MODELS).find(k => String(r.model || '').startsWith(MODELS[k])) || String(r.model || ''); (used[r.muc] = used[r.muc] || {})[k] = (used[r.muc][k] || 0) + (Number(r.n) || 0);
  });
  return { ok: true, bal, today: tDay, d7: t7, d30: t30, month: tMon, byMuc, byModel, byDay, muc: MUC, since: since && since.d, aiOn: !!x.env.ANTHROPIC_API_KEY, now,
    pick: (pk && pk.m) || {}, pickBy: (pk && pk.by) || {}, def: DEF, est, used };
}

/** Quản trị ghi "đã nạp $X ngày Y" (+ tỷ giá). Nạp mới → xoá nhắc cũ để lần sắp hết sau còn nhắc. */
export async function aiFund(x, u, d) {
  if (u.level < 3) return { ok: false, error: 'Chỉ Quản trị sửa được.' };
  const usd = Number(String(d.usd || '').replace(',', '.')), day = String(d.day || '').replace(/\D/g, '');
  if (d.rate !== undefined) { const r = Number(d.rate); if (r >= 10000 && r <= 50000) await kvSet(x.db, 'ai_rate', String(Math.round(r))); }
  if (!(usd > 0)) return { ok: false, error: 'Số tiền đã nạp phải lớn hơn 0 (USD).' };
  if (!/^\d{8}$/.test(day)) return { ok: false, error: 'Ngày nạp chưa đúng.' };
  await kvSet(x.db, 'ai_fund', JSON.stringify({ usd, day, at: Date.now(), by: u.name }));
  await kvDel(x.db, 'ai_low');
  return { ok: true };
}

/** Cron (1 tiếng / lần): tiền ước tính còn dưới 5 ngày dùng hoặc dưới 5$ → nhắc Telegram 1 lần / ngày. Chưa ghi số nạp thì không nhắc (CRM có ⚠️ nhắc ghi). */
export async function aiTick(x) {
  const now = Date.now(), last = Number(await kvGet(x.db, 'ai_tick_last') || 0);
  if (now - last < 3600e3 || !x.env.ANTHROPIC_API_KEY) return;
  await kvSet(x.db, 'ai_tick_last', String(now));
  const b = await aiBalance(x.db);
  if (!b.fund || await kvGet(x.db, 'ai_low')) return;
  const low = b.left < 5 || (b.days !== null && b.days < 5);
  if (!low) return;
  await kvSet(x.db, 'ai_low', String(now), DAY);
  const vnd = n => Math.round(n * b.rate).toLocaleString('vi-VN') + 'đ';
  await telegram(x.env, '💳 <b>Tiền AI sắp hết</b> (ước tính): còn khoảng <b>' + b.left.toFixed(2) + '$</b> (~' + vnd(Math.max(0, b.left)) + ')' +
    (b.days !== null ? ', đủ khoảng <b>' + Math.max(0, Math.floor(b.days)) + ' ngày</b> với mức dùng ~' + b.perDay.toFixed(2) + '$/ngày' : '') +
    '.\nHết tiền thì trợ lý Zalo, chat An Lành, Fanpage và ✨ AI trong CRM đều dừng.\n👉 Anh Sơn nạp thêm ở console.anthropic.com → Plans & Billing, rồi vào CRM → Cài đặt → 🤖 Chi phí trợ lý AI ghi số đã nạp để đếm lại.');
}
