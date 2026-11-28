/* ================================================================ 📋 Kế hoạch chủ đề bài Fanpage (29/11/2026, anh Sơn: "tối ưu trợ lý Fanpage như trợ lý Zalo")
 * Giống zbot.js zPlanMake nhưng theo từng trang + giờ đăng của trang: bảng fp_plan (id = trang_yyyyMMdd_HHmm = mã bài sẽ soạn).
 * Khung mỗi bài = chủ đề theo thứ (fb.js FP_THEME) + ngày lễ / rằm / mùng 1 (zday.js dayTheme). AI chọn chủ đề cụ thể + nhóm khách + tension + sản phẩm.
 * Tự lập 7 ngày (từ ngày thứ 3 trở đi, 1 lần / 6 tiếng / trang, khi cron không còn bài cần soạn) → Telegram mời duyệt. Chưa duyệt vẫn viết theo chủ đề nháp.
 * Trợ lý viết bài (fb.js fpWrite) đọc fpPlanGet. Không dùng cảm nhận khách hàng như nhóm Zalo: anh Sơn chỉ cho phép đăng trong nhóm (31/10/2026), fanpage là công khai. */
import Anthropic from '@anthropic-ai/sdk';
import { aiFetch } from './airelay.js';
import { run, all, first, kvGet, kvSet, fmtDate, esc, CRM_URL, DAY } from './lib.js';
import { telegram } from './google.js';
import { kb, TRUTH_RULES } from './chat.js';
import { insBank, FUN, spName } from './insight.js';
import { prodMap } from './zbot.js';
import { offersLive } from './salemkt.js';
import { dayTheme, addDay, weekday } from './zday.js';
import { lunar } from './lunar.js';
import { FP_THEME, slotTime } from './fb.js';

const WRITER = 'claude-sonnet-5-5';
const WD = ['Chủ nhật', 'Thứ 2', 'Thứ 3', 'Thứ 4', 'Thứ 5', 'Thứ 6', 'Thứ 7'];
const dm = day => day.slice(6, 8) + '/' + day.slice(4, 6);
const cutS = (s, n) => String(s == null ? '' : s).replace(/\s+/g, ' ').trim().slice(0, n);
let client = null;
const ai = env => client || (client = new Anthropic({ apiKey: env.ANTHROPIC_API_KEY, maxRetries: 2, timeout: 170e3, fetch: aiFetch(env), defaultHeaders: { 'x-tdl-muc': 'fb-kh' } }));
const textOf = res => res.content.filter(b => b.type === 'text').map(b => b.text).join('\n').trim();

export async function fpPlanSchema(db) {
  await db.prepare(`CREATE TABLE IF NOT EXISTS fp_plan (id TEXT PRIMARY KEY, page TEXT, day TEXT, slot TEXT, f TEXT DEFAULT '', topic TEXT DEFAULT '', idea TEXT DEFAULT '', cta TEXT DEFAULT '',
    g TEXT DEFAULT '', gn TEXT DEFAULT '', tn TEXT DEFAULT '', sp TEXT DEFAULT '', ev TEXT DEFAULT '', status TEXT DEFAULT 'draft', by_name TEXT DEFAULT '', at INTEGER, ok_by TEXT DEFAULT '', ok_at INTEGER)`).run();
  await db.prepare('CREATE INDEX IF NOT EXISTS fp_plan_day ON fp_plan(page, day)').run();
}

/** Khung 1 bài: chủ đề theo thứ (bài thứ 2 trong ngày lệch +3 như cũ) + dịp lễ. Giờ trước 15h dùng lịch dịp buổi sáng, sau 15h buổi tối. */
export function fpFrame(day, slot, si, hasOffer) {
  const base = d => FP_THEME[(weekday(d) + si * 3) % 7];
  return dayTheme(day, Number(String(slot).slice(0, 2)) < 15 ? 'sang' : 'toi', d => base(d), hasOffer);
}
/** Ưu đãi đang chạy dùng được cho bài đăng trang (bỏ ưu đãi riêng của 1 quảng cáo, chỉ trang được chọn) */
export async function fpOffers(x, pid, at) {
  return (await offersLive(x, at)).filter(o => !(o.camps || []).length && (!(o.pages || []).length || o.pages.map(String).includes(String(pid))));
}
/** Chủ đề kế hoạch của 1 bài (đã duyệt hoặc nháp) */
export async function fpPlanGet(x, id) {
  return first(x.db, "SELECT * FROM fp_plan WHERE id = ? AND status IN ('ok', 'draft') AND topic != ''", id);
}

/** Lập (lại) chủ đề cho trang p, n ngày (≤ 7) từ `from`. Giữ: chủ đề đã duyệt / đã bỏ, bài đã đăng / đã duyệt / nhân sự đã sửa. opt: { by, fill, only: [id], hint } */
export async function fpPlanMake(x, p, from, n, opt) {
  opt = opt || {};
  const now = Date.now(), c = p.cfg, days = Math.max(1, Math.min(7, n || 7)), to = addDay(from, days - 1);
  const fr = [];
  for (let i = 0; i < days; i++) {
    const day = addDay(from, i), live = await fpOffers(x, p.id, slotTime(day, '12:00'));
    c.slots.forEach((sl, si) => fr.push({ id: p.id + '_' + day + '_' + sl.replace(':', ''), day, slot: sl, fr: fpFrame(day, sl, si, live.length > 0), live }));
  }
  const posts = {}; for (const r of await all(x.db, 'SELECT id, day, slot, topic, funnel, status, by_name FROM fp_posts WHERE page = ? AND day >= ? AND day <= ?', p.id, addDay(from, -10), addDay(to, 7))) posts[r.id] = r;
  const plans = {}; for (const r of await all(x.db, 'SELECT * FROM fp_plan WHERE page = ? AND day >= ? AND day <= ?', p.id, addDay(from, -7), addDay(to, 7))) plans[r.id] = r;
  const only = Array.isArray(opt.only) ? opt.only : null;
  const todo = fr.filter(z => {
    const ps = posts[z.id], pl = plans[z.id];
    if (slotTime(z.day, z.slot) < now + 30 * 60e3) return false;
    if (ps && (ps.status === 'sent' || ps.status === 'ok' || (ps.by_name && ps.by_name !== 'AI'))) return false;
    if (only) return only.includes(z.id);
    return !pl || (pl.status === 'draft' && !opt.fill);
  });
  if (!todo.length) return { n: 0, items: [] };
  const know = await kb(), prods = prodMap(know), bank = (await insBank(x)).filter(g => g.on && g.tensions.length && (!(c.aud || []).length || c.aud.includes(g.id)));
  const done = [];
  for (const r of Object.values(posts)) if (r.topic && !todo.find(z => z.id === r.id)) done.push({ k: r.day + r.slot, t: '- ' + WD[weekday(r.day)] + ' ' + dm(r.day) + ' ' + r.slot + (r.status === 'sent' ? ' (đã đăng)' : '') + ': ' + r.topic + (r.funnel ? ' [' + r.funnel + ']' : '') });
  for (const r of Object.values(plans)) if (r.topic && r.status !== 'skip' && !posts[r.id] && !todo.find(z => z.id === r.id)) done.push({ k: r.day + r.slot, t: '- ' + WD[weekday(r.day)] + ' ' + dm(r.day) + ' ' + r.slot + (r.status === 'ok' ? ' (đã duyệt)' : ' (kế hoạch)') + ': ' + r.topic + ' [' + r.f + ']' });
  done.sort((a, b) => a.k < b.k ? -1 : 1);
  const offers = [...new Map(todo.flatMap(z => z.live).map(o => [o.id || o.title, o])).values()];
  const ask = [
    'Lập KẾ HOẠCH CHỦ ĐỀ cho fanpage Facebook "' + p.name + '" của Thực Dưỡng Lành.',
    c.voice ? 'Trang này: ' + c.voice : 'Người theo dõi phần lớn là người lạ mới biết tới thương hiệu: cô chú trung niên, mẹ bỉm, người ăn chay, dân văn phòng quan tâm sống khỏe.',
    'Mỗi dòng ở mục CÁC BÀI CẦN LẬP là 1 bài sẽ đăng. Chọn cho mỗi bài 1 chủ đề CỤ THỂ để quản lý duyệt trước; sau khi duyệt, trợ lý viết bài đúng chủ đề này.',
    '', '# 3 TẦNG PHỄU (khoá Content Tuấn Hà – K133)', ...Object.values(FUN).map(v => '- ' + v.name + ': ' + v.rule),
    '# TẦNG PHỄU: giữ ĐÚNG tầng ghi ở từng bài (fanpage nhiều người lạ: mỗi tuần khoảng 4 bài 🔵 · 2 bài ⚪ · 1 bài 🟠).',
    '', '# NGÂN HÀNG INSIGHT (id nhóm: tên – chân dung | tension)',
    ...bank.map(g => '- ' + g.id + ': ' + g.name + (g.who ? ' – ' + cutS(g.who, 140) : '') + (g.prods.length ? ' | hợp: ' + g.prods.map(spName).join(', ') : '') + '\n  ' + g.tensions.slice(0, 8).join('\n  ')),
    '', '# SẢN PHẨM (mã – tên)', ...Object.entries(prods).map(([k, v]) => '- ' + k + ': ' + v.name),
    offers.length ? '\n# ƯU ĐÃI ĐANG CHẠY (chỉ dùng đúng như sau)\n' + offers.map(o => '- ' + [o.title, o.prod ? 'sản phẩm: ' + o.prod : '', o.text, o.until ? 'hạn đến ' + o.until : ''].filter(Boolean).join(' · ')).join('\n') : '\nHiện không có ưu đãi riêng: bài 🟠 không bịa khuyến mãi (chỉ freeship đơn từ 300k, được kiểm hàng trước khi nhận).',
    done.length ? '\n# BÀI ĐÃ ĐĂNG / ĐÃ CHỐT QUANH KỲ NÀY (không lặp chủ đề, món, nguyên liệu, sản phẩm trong 7 ngày)\n' + done.map(d => d.t).join('\n') : '',
    '', '# CÁC BÀI CẦN LẬP (id · ngày · giờ · tầng · khung chủ đề)',
    ...todo.map(z => { const old = plans[z.id]; return '- ' + z.id + ' · ' + WD[weekday(z.day)] + ' ' + dm(z.day) + ' (âm ' + lunar(z.day).text + ') · ' + z.slot + ' · ' + z.fr.f + (z.fr.ev ? ' · dịp: ' + z.fr.ev : '') + '\n  khung: ' + cutS(z.fr.t, 400) + (only && old && old.topic ? '\n  chủ đề cũ (cần đổi khác): ' + old.topic : ''); }),
    opt.hint ? '\nYêu cầu của quản lý cho lần lập này: ' + cutS(opt.hint, 300) : '',
    '', 'Yêu cầu:',
    '- Giữ đúng khung của từng bài (ngày lễ, chủ đề theo thứ). Chủ đề cụ thể = khung + 1 món / nguyên liệu / mẹo / câu hỏi / sản phẩm cụ thể.',
    '- 🔵 TOFU: giá trị nằm ở nội dung, tên sản phẩm KHÔNG có trong chủ đề. ⚪ MOFU: bằng chứng / kiến thức có thật trong TÀI LIỆU. 🟠 BOFU: đúng 1 sản phẩm (ghi mã ở "sp") gỡ đúng tension.',
    '- Mỗi bài 1 nhóm khách (id trong ngân hàng) + 1 tension của nhóm đó. Rải đều các nhóm, không 1 nhóm quá 2 bài liền; bài theo dịp lễ chọn nhóm rộng nhất.',
    '- Không lặp món / nguyên liệu / sản phẩm trong 7 ngày. Không dùng cảm nhận khách hàng (fanpage công khai). Chỉ dùng thông tin có trong TÀI LIỆU; không bịa ưu đãi, số liệu; không dùng "chữa / điều trị / khỏi bệnh".',
    '', 'Trả về DUY NHẤT 1 mảng JSON (không giải thích), mỗi bài 1 phần tử đúng thứ tự trên:',
    '[{"id": "<id>", "topic": "<chủ đề cụ thể, tối đa 18 chữ>", "idea": "<góc viết / câu mở gợi ý, 1 câu>", "cta": "<lối ra của bài, tối đa 10 chữ>", "g": "<id nhóm khách>", "tn": "<điều họ mong> ↔ <điều đang cản họ>", "sp": "<mã sản phẩm hoặc rỗng>"}]'
  ].filter(s => s !== '').join('\n');
  const req = { model: WRITER, max_tokens: 8000, output_config: { effort: 'medium' },
    system: [{ type: 'text', text: 'Bạn là người lập kế hoạch nội dung cho fanpage Facebook của Thực Dưỡng Lành (VitaGreen Nutrition). Tiếng Việt chuẩn, tự nhiên.\n' + TRUTH_RULES },
      { type: 'text', text: 'TÀI LIỆU (thông tin chính thức của Thực Dưỡng Lành):\n\n' + know, cache_control: { type: 'ephemeral' } }],
    messages: [{ role: 'user', content: ask }] };
  let res;
  try { res = await ai(x.env).beta.messages.create(Object.assign({ betas: ['server-side-fallback-2026-07-01'], fallbacks: 'default' }, req)); }
  catch (e) { if (!(e instanceof Anthropic.BadRequestError)) throw e; res = await ai(x.env).messages.create(req); }
  if (res.stop_reason === 'refusal') throw new Error('AI từ chối lập kế hoạch');
  const list = fpPlanParse(textOf(res));
  const items = [];
  for (const z of todo) {
    const it = list.find(v => v && String(v.id) === z.id) || (list.length === todo.length ? list[todo.indexOf(z)] : null);
    if (!it || !cutS(it.topic, 200)) continue;
    const g = bank.find(v => v.id === String(it.g || '').trim()) || null, sp = prods[String(it.sp || '').trim()] ? String(it.sp).trim() : '';
    const row = [z.id, p.id, z.day, z.slot, z.fr.f, cutS(it.topic, 200), cutS(it.idea, 300), cutS(it.cta, 120), g ? g.id : '', g ? g.name : '', cutS(it.tn, 300).replace(/<->|<=>|->/g, '↔'), sp, z.fr.ev || '', opt.by || 'AI', now];
    await run(x.db, `INSERT INTO fp_plan (id, page, day, slot, f, topic, idea, cta, g, gn, tn, sp, ev, status, by_name, at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'draft', ?, ?)
      ON CONFLICT(id) DO UPDATE SET f = excluded.f, topic = excluded.topic, idea = excluded.idea, cta = excluded.cta, g = excluded.g, gn = excluded.gn, tn = excluded.tn, sp = excluded.sp, ev = excluded.ev,
      status = 'draft', by_name = excluded.by_name, at = excluded.at, ok_by = '', ok_at = NULL`, ...row);
    items.push({ id: z.id, topic: row[5] });
  }
  if (!items.length) throw new Error('AI chưa lập được chủ đề, bấm lập lại nhé');
  return { n: items.length, items };
}
/** Lấy mảng JSON trong câu trả lời AI (có thể kèm chữ thừa / ```json) */
export function fpPlanParse(raw) {
  const m = String(raw || '').match(/\[[\s\S]*\]/);
  let list; try { list = JSON.parse(m ? m[0] : '[]'); } catch (e) { throw new Error('AI trả kế hoạch sai định dạng, bấm lập lại nhé'); }
  return Array.isArray(list) ? list : [];
}

/** Cron (fpTick, khi không còn bài cần soạn): mỗi trang soạn bài, 1 lần / 6 tiếng, có chủ đề tới 9 ngày tới (từ ngày thứ 3 = sau phần trợ lý đã viết bài) */
export async function fpPlanTick(x, P, now) {
  if (!x.env.ANTHROPIC_API_KEY) return;
  const today = fmtDate(now, 'yyyyMMdd'), start = addDay(today, 3), end = addDay(today, 9);
  for (const p of Object.values(P)) {
    if (!p.cfg.post || !p.cfg.slots.length) continue;
    const k = 'fp_plan_auto_' + p.id; if (now - Number(await kvGet(x.db, k) || 0) < 6 * 3600e3) continue;
    const have = new Set((await all(x.db, 'SELECT id FROM fp_plan WHERE page = ? AND day >= ? AND day <= ? UNION SELECT id FROM fp_posts WHERE page = ? AND day >= ? AND day <= ?', p.id, start, end, p.id, start, end)).map(r => r.id));
    let from = ''; for (let d = start; d <= end && !from; d = addDay(d, 1)) if (p.cfg.slots.some(s => !have.has(p.id + '_' + d + '_' + s.replace(':', '')))) from = d;
    if (!from) continue;
    await kvSet(x.db, k, String(now), 2 * DAY);
    try {
      const r = await fpPlanMake(x, p, from, 7, { by: 'AI', fill: 1 });
      if (r.n) await telegram(x.env, '📋 <b>Kế hoạch chủ đề Fanpage “' + esc(p.name) + '” ' + dm(from) + '–' + dm(addDay(from, 6)) + '</b>: trợ lý đã lập ' + r.n + ' chủ đề. Mời duyệt trước để trợ lý viết bài theo (chưa duyệt vẫn viết theo chủ đề nháp).\n👉 ' + CRM_URL + '/#fanpage');
    } catch (e) { console.error('fpPlanTick', e.message); await kvSet(x.db, 'fp_write_err', fmtDate(now, 'HH:mm dd/MM') + ' (kế hoạch ' + p.name + '): ' + String(e.message).slice(0, 200)); }
    return; // mỗi lượt cron 1 trang (lời gọi AI dài)
  }
}

/** Chủ đề vừa duyệt / sửa mà bài AI đã soạn theo chủ đề cũ (chưa ai sửa, chưa duyệt, còn > 1 tiếng) → xoá bài để trợ lý soạn lại (≈ 10 phút) */
async function planReset(x, id) {
  const r = await first(x.db, 'SELECT id, day, slot, status, by_name FROM fp_posts WHERE id = ?', id); if (!r) return '';
  if (r.status === 'draft' && r.by_name === 'AI' && slotTime(r.day, r.slot) > Date.now() + 3600e3) { await run(x.db, 'DELETE FROM fp_posts WHERE id = ?', id); return 'redo'; }
  return 'kept';
}

/** CRM: fp_plan_make { page, from } · fp_plan_set { ids, status, topic?, idea? } · fp_plan_redo { id, hint } */
export async function crmFpPlan(x, u, d, crmLog, pageGet) {
  const a = d.action, now = Date.now();
  if (a === 'fp_plan_make' || a === 'fp_plan_redo') {
    if (!x.env.ANTHROPIC_API_KEY) return { ok: false, error: 'Máy chủ chưa có khoá AI.' };
    const row = a === 'fp_plan_redo' ? await first(x.db, 'SELECT * FROM fp_plan WHERE id = ?', String(d.id || '')) : null;
    if (a === 'fp_plan_redo' && !row) return { ok: false, error: 'Không tìm thấy chủ đề.' };
    const p = await pageGet(x, row ? row.page : String(d.page || '')); if (!p) return { ok: false, error: 'Không tìm thấy trang.' };
    if (!p.cfg.post) return { ok: false, error: 'Trang này chưa bật “AI soạn bài đăng”.' };
    const from = row ? row.day : /^\d{8}$/.test(String(d.from || '')) ? String(d.from) : fmtDate(now, 'yyyyMMdd');
    try {
      const r = await fpPlanMake(x, p, from, row ? 1 : 7, { by: u.name, only: row ? [row.id] : null, hint: String(d.hint || '').slice(0, 300) });
      if (row) await planReset(x, row.id);
      await crmLog(x, u, 'Kế hoạch Fanpage', p.id, p.name, row ? 'Đổi chủ đề' : 'Lập 7 ngày từ ' + dm(from), r.n + ' chủ đề');
      return { ok: true, n: r.n };
    } catch (e) { return { ok: false, error: e.message }; }
  }
  if (a === 'fp_plan_set') {
    const ids = (Array.isArray(d.ids) ? d.ids : [d.id]).map(String).slice(0, 60), st = ['ok', 'skip', 'draft'].includes(d.status) ? d.status : '';
    const topic = d.topic === undefined ? null : cutS(d.topic, 200), idea = d.idea === undefined ? null : cutS(d.idea, 300);
    if (topic !== null && !topic) return { ok: false, error: 'Chủ đề không được để trống.' };
    let n = 0, redo = 0;
    for (const id of ids) {
      const r = await first(x.db, 'SELECT * FROM fp_plan WHERE id = ?', id); if (!r) continue;
      await run(x.db, 'UPDATE fp_plan SET topic = ?, idea = ?, status = ?, by_name = ?, at = ?, ok_by = ?, ok_at = ? WHERE id = ?', topic ?? r.topic, idea ?? r.idea, st || r.status, topic !== null ? u.name : r.by_name, now,
        (st || r.status) === 'ok' ? u.name : '', (st || r.status) === 'ok' ? now : null, id);
      if (topic !== null && topic !== r.topic || st === 'skip') { if (await planReset(x, id) === 'redo') redo++; }
      n++;
    }
    await crmLog(x, u, 'Kế hoạch Fanpage', ids[0] || '', '', { ok: 'Duyệt', skip: 'Bỏ', draft: 'Bỏ duyệt' }[st] || 'Sửa chủ đề', n + ' chủ đề');
    return { ok: true, n, redo };
  }
  return { ok: false, error: 'Không rõ thao tác.' };
}
