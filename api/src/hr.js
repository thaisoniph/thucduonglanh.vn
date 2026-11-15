/* ================================================================ 🧑‍💼 Tuyển dụng – đợt 1 của hr.thucduonglanh.vn (15/11/2026, anh Sơn "Làm đợt 1")
 * Ứng viên nộp ở congsu.thucduonglanh.vn (apply.js) → bảng applicants (+ file CV ≤ 1,4 MB ở bảng hr_cv để AI đọc và tải lại trong CRM)
 *  → cron (hrTick, 10 phút / lần, 7h–22h) AI đọc CV + câu trả lời, so với mô tả công việc trên congsu → % phù hợp, hạng A/B/C, lý do, câu hỏi phỏng vấn
 *  → CRM tab 🧑‍💼 Tuyển dụng (Quản lý + Quản trị): Mới → Hẹn phỏng vấn → Đã phỏng vấn → Mời nhận việc → Đã nhận việc / Không phù hợp / Từ chối nhận việc
 *  → email mời phỏng vấn / thư mời nhận việc (HTML có logo, gửi qua Apps Script) có link /tm/<mã> để ứng viên bấm xác nhận / nhận việc.
 * Lệnh CRM: hr {op}: list · note · stage · ai · iv · ivs · offer · prev · cfg · del · cv. Trang công khai: GET/POST /tm/<tok>.
 * Luật 91/2025: hồ sơ không trúng tuyển tự xoá sau 12 tháng (hrClean); file CV chỉ Quản lý / Quản trị tải được. */
import Anthropic from '@anthropic-ai/sdk';
import { aiFetch } from './airelay.js';
import { esc, all, first, run, kvJson, kvSet, kvGet, randHex, fmtDate, nrm, DAY } from './lib.js';
import { telegramTo, sendMail, tgConf } from './google.js';
import { fitScore } from './apply.js';
import { crmHrStaff, fbSync, ntPush } from './hrstaff.js'; // 🗂 đợt 2: hồ sơ nhân sự (lệnh hr {op: st_*})

export const HR_ST = ['Mới', 'Hẹn phỏng vấn', 'Đã phỏng vấn', 'Mời nhận việc', 'Đã nhận việc', 'Không phù hợp', 'Từ chối nhận việc'];
const API = 'https://api.thucduonglanh.vn', CONGSU = 'https://congsu.thucduonglanh.vn', LOGO = 'https://thucduonglanh.vn/assets/img/brand/logo.png';
const AI_MODEL = 'claude-sonnet-5-5'; // đọc CV + so mô tả công việc = việc cần nghĩ (chon-mo-hinh-ai: Sonnet), ~1–3 nghìn đồng / hồ sơ
const CV_MAX = 1.9e6; // ký tự base64 (~1,4 MB file): D1 giữ được 1 giá trị ≤ 2 MB
const QS = [['why', 'Vì sao muốn đồng hành cùng VitaGreen'], ['hard', 'Việc khó nhất đã theo đến cùng'], ['rules', 'Quy tắc làm tốt nhất / cần rèn thêm'], ['ai', 'AI & công cụ số đang dùng'], ['life', 'Lối sống lành hiện nay']];
const CFG_DEF = {
  from: 'Tuyển dụng Thực Dưỡng Lành', reply: '', sign: 'Ban Nhân sự\nCÔNG TY TNHH TẬP ĐOÀN VITAGREEN NUTRITION',
  place: 'HA10-SP8A-15, Đường Hải Âu 8A, KĐT Vinhomes Ocean Park, Gia Lâm, TP. Hà Nội', hours: '',
  ivNote: 'Bạn mang theo CV bản in (nếu có) và đến sớm 5–10 phút. Buổi trò chuyện khoảng 45 phút.',
  docs: 'CCCD (bản photo), sổ hộ khẩu hoặc giấy xác nhận cư trú, bằng cấp liên quan, 2 ảnh 3x4, sổ BHXH (nếu có)'
};
const parse = v => { try { return v ? JSON.parse(v) : null; } catch (e) { return null; } };
const cut = (v, n) => String(v == null ? '' : v).trim().slice(0, n);
const okRole = u => u && u.level >= 2 && ['Marketing', 'Kho', 'Kế toán'].indexOf(u.role) < 0;

let schemaOk = false;
export async function hrSchema(db) {
  if (schemaOk) return;
  await run(db, `CREATE TABLE IF NOT EXISTS applicants (
    id INTEGER PRIMARY KEY AUTOINCREMENT, time INTEGER, job TEXT DEFAULT '', name TEXT DEFAULT '', phone TEXT DEFAULT '', email TEXT DEFAULT '',
    birth TEXT DEFAULT '', area TEXT DEFAULT '', exp TEXT DEFAULT '', salary TEXT DEFAULT '', start TEXT DEFAULT '', cv_link TEXT DEFAULT '',
    file_name TEXT DEFAULT '', answers TEXT DEFAULT '', heard TEXT DEFAULT '', source TEXT DEFAULT '', status TEXT DEFAULT 'Mới', note TEXT DEFAULT '',
    score INTEGER, quiz TEXT DEFAULT '')`);
  const cols = (await all(db, 'PRAGMA table_info(applicants)')).map(r => r.name);
  for (const [c, t] of [['score', 'INTEGER'], ['quiz', "TEXT DEFAULT ''"], ['ai_score', 'INTEGER'], ['ai', "TEXT DEFAULT ''"], ['ai_at', 'INTEGER'], ['ai_try', 'INTEGER DEFAULT 0'],
    ['tok', "TEXT DEFAULT ''"], ['iv', "TEXT DEFAULT ''"], ['ivr', "TEXT DEFAULT ''"], ['ivs', "TEXT DEFAULT ''"], ['offer', "TEXT DEFAULT ''"], ['ofr', "TEXT DEFAULT ''"], ['hist', "TEXT DEFAULT ''"], ['upd', 'INTEGER']])
    if (!cols.includes(c)) { try { await run(db, `ALTER TABLE applicants ADD COLUMN ${c} ${t}`); } catch (e) { } }
  await run(db, 'CREATE TABLE IF NOT EXISTS hr_cv (id INTEGER PRIMARY KEY, name TEXT, b64 TEXT, time INTEGER)');
  try { await run(db, 'CREATE INDEX IF NOT EXISTS applicants_tok ON applicants (tok)'); } catch (e) { }
  schemaOk = true;
}
async function cfgOf(db) { return Object.assign({}, CFG_DEF, await kvJson(db, 'hr_cfg', null) || {}); }

/** Gọi từ apply.js sau khi lưu hồ sơ: giữ file CV (nếu đủ nhỏ) cho AI đọc ở lượt cron kế tiếp. */
export async function hrAfterApply(db, id, file) {
  await hrSchema(db);
  await run(db, 'UPDATE applicants SET tok = ?, upd = ?, hist = ? WHERE id = ?', randHex(12), Date.now(), JSON.stringify([[Date.now(), 'Ứng viên', 'Nộp hồ sơ trên congsu.thucduonglanh.vn']]), id);
  if (file && file.b64 && file.b64.length <= CV_MAX) await run(db, 'INSERT OR REPLACE INTO hr_cv (id, name, b64, time) VALUES (?, ?, ?, ?)', id, file.name, file.b64, Date.now());
}

/* ---------------------------------------------------------------- mô tả công việc: đọc thẳng trang congsu (luôn khớp bản đang đăng), lưu đệm 1 ngày */
const strip = h => String(h || '').replace(/<(script|style|noscript|svg|header|footer|nav|form)[\s\S]*?<\/\1>/gi, ' ').replace(/<[^>]+>/g, ' ')
  .replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/&#39;|&rsquo;/g, "'").replace(/&quot;/g, '"').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/\s+/g, ' ').trim();
async function jdOf(x, job) {
  const k = nrm(job), C = await kvJson(x.db, 'hr_jd', {}) || {};
  if (C[k] && Date.now() - C[k].at < DAY) return C[k].t;
  let t = '';
  try {
    const home = await (await fetch(CONGSU + '/')).text(), re = /<a[^>]+href="\/([a-z0-9-]+)\/"[^>]*>([\s\S]*?)<\/a>/g; let m, slug = '';
    while ((m = re.exec(home))) { if (nrm(strip(m[2])).includes(k)) { slug = m[1]; break; } }
    if (slug) t = strip(await (await fetch(CONGSU + '/' + slug + '/')).text()).slice(0, 9000);
  } catch (e) { console.error('hr jd', e.message); }
  if (t) { C[k] = { at: Date.now(), t }; await kvSet(x.db, 'hr_jd', JSON.stringify(C)); }
  return t || (C[k] && C[k].t) || '';
}

/* ---------------------------------------------------------------- AI đọc CV */
let client = null;
function ai(env) { if (!client) client = new Anthropic({ apiKey: env.ANTHROPIC_API_KEY, maxRetries: 1, timeout: 90e3, fetch: aiFetch(env), defaultHeaders: { 'x-tdl-muc': 'tuyendung' } }); return client; }
const SYS = [
  'Bạn là chuyên viên tuyển dụng của Thực Dưỡng Lành (VitaGreen Nutrition), công ty thực phẩm dinh dưỡng và trà thảo mộc ở Hà Nội, sứ mệnh giúp 10 triệu người Việt sống khoẻ từ Thân đến Tâm.',
  'Văn hoá: Thân – Tâm – Trí; gốc rễ Đạo đức – Trí tuệ – Nghị lực; trung thực, trách nhiệm, chủ động báo cáo, ham học hỏi, tử tế với khách và đồng đội.',
  'Nhiệm vụ: đọc CV + câu trả lời của ứng viên, so với mô tả công việc, chấm mức phù hợp 0–100 để quản lý quyết định có hẹn phỏng vấn không.',
  'Công bằng: KHÔNG chấm theo tuổi, giới tính, quê quán, tôn giáo, ngoại hình, tình trạng hôn nhân. Chỉ chấm năng lực, kinh nghiệm, thái độ, độ khớp với yêu cầu.',
  'Chỉ dựa vào thông tin có thật trong hồ sơ. Thiếu thông tin thì ghi là thiếu, không đoán. Viết tiếng Việt ngắn gọn, dễ hiểu, không viết tắt.',
  'Hạng: A (≥ 75) nên hẹn phỏng vấn sớm · B (55–74) cân nhắc, cần hỏi thêm · C (< 55) chưa phù hợp.',
  'Trả về DUY NHẤT 1 khối JSON: {"score": số 0-100, "rank": "A"|"B"|"C", "sum": "1 câu kết luận", "why": ["3 lý do chính cho điểm này"], "good": ["điểm mạnh, tối đa 4"], "risk": ["điểm cần lưu ý / cần hỏi lại, tối đa 4"], "ask": ["5 câu hỏi phỏng vấn riêng cho người này"], "cv": "tóm tắt CV tối đa 120 chữ: các nơi đã làm, số năm, kỹ năng chính (không ghi số điện thoại, email, địa chỉ)"}'
].join('\n');

function applicantText(r) {
  const ans = parse(r.answers) || {}, f = fitScore(parse(r.quiz) || {});
  return [
    'Vị trí ứng tuyển: ' + r.job,
    'Kinh nghiệm (tự khai): ' + (r.exp || '–'), 'Nơi ở: ' + (r.area || '–'), 'Thu nhập mong muốn: ' + (r.salary || '–'), 'Có thể bắt đầu: ' + (r.start || '–'),
    'Bài trắc nghiệm văn hoá trên trang tuyển dụng: ' + (r.score != null ? r.score + '%' : 'không làm') + ' (' + f.detail + ')' + (f.flags.length ? '. Lưu ý: ' + f.flags.join('; ') : ''),
    ...QS.map(([k, q]) => q + ':\n' + (ans[k] ? String(ans[k]).slice(0, 1500) : '–'))
  ].join('\n');
}
/** Chấm 1 hồ sơ. Trả về { ok, ai } hoặc { ok:false, error }. */
export async function hrAiEval(x, id) {
  if (!x.env.ANTHROPIC_API_KEY) return { ok: false, error: 'Máy chủ chưa có khoá AI (ANTHROPIC_API_KEY).' };
  await hrSchema(x.db);
  const r = await first(x.db, 'SELECT * FROM applicants WHERE id = ?', id); if (!r) return { ok: false, error: 'Không thấy hồ sơ.' };
  await run(x.db, 'UPDATE applicants SET ai_try = COALESCE(ai_try, 0) + 1 WHERE id = ?', id);
  const cv = await first(x.db, 'SELECT name, b64 FROM hr_cv WHERE id = ?', id), old = parse(r.ai) || {};
  const jd = await jdOf(x, r.job), content = [];
  let cvNote = '';
  if (cv && cv.b64) {
    const ext = (String(cv.name).match(/\.([a-z0-9]+)$/i) || [])[1] || '';
    if (/^pdf$/i.test(ext)) content.push({ type: 'document', source: { type: 'base64', media_type: 'application/pdf', data: cv.b64 } });
    else if (/^(png|jpe?g|webp)$/i.test(ext)) content.push({ type: 'image', source: { type: 'base64', media_type: 'image/' + (/jpe?g/i.test(ext) ? 'jpeg' : ext.toLowerCase()), data: cv.b64 } });
    else cvNote = 'File CV là Word, AI chưa đọc được: chỉ chấm theo câu trả lời.';
  } else if (old.cv) content.push({ type: 'text', text: 'Tóm tắt CV (đã đọc lần trước):\n' + old.cv });
  else cvNote = r.cv_link ? 'CV gửi dạng link (AI không mở được link): chỉ chấm theo câu trả lời.' : r.file_name ? 'File CV lớn, không giữ lại để AI đọc: chỉ chấm theo câu trả lời.' : 'Ứng viên không gửi CV: chỉ chấm theo câu trả lời.';
  content.push({ type: 'text', text: 'MÔ TẢ CÔNG VIỆC (trang tuyển dụng):\n' + (jd || 'Không đọc được trang, chỉ biết tên vị trí: ' + r.job) + '\n\n---\nHỒ SƠ ỨNG VIÊN:\n' + applicantText(r) + (cvNote ? '\n\nGhi chú: ' + cvNote : '') + '\n\nTrả về JSON như hướng dẫn.' });
  let res;
  try { res = await ai(x.env).messages.create({ model: AI_MODEL, max_tokens: 2000, system: SYS, messages: [{ role: 'user', content }] }); }
  catch (e) { console.error('hr ai', e.message); return { ok: false, error: 'AI chưa trả lời được (' + String(e.message).slice(0, 120) + '). Thử lại sau ít phút.' }; }
  const out = (res.content || []).filter(b => b.type === 'text').map(b => b.text).join(''), m = out.match(/\{[\s\S]*\}/);
  let j = null; try { j = m ? JSON.parse(m[0]) : null; } catch (e) { }
  if (!j || j.score == null) return { ok: false, error: 'AI trả lời không đúng mẫu, thử chấm lại.' };
  const arr = (v, n) => (Array.isArray(v) ? v : []).map(s => cut(s, 400)).filter(Boolean).slice(0, n);
  const score = Math.max(0, Math.min(100, Math.round(Number(j.score) || 0)));
  const A = { score, rank: /^[ABC]$/.test(j.rank) ? j.rank : score >= 75 ? 'A' : score >= 55 ? 'B' : 'C', sum: cut(j.sum, 400), why: arr(j.why, 4), good: arr(j.good, 4), risk: arr(j.risk, 4), ask: arr(j.ask, 6), cv: cut(j.cv, 1200) || old.cv || '', note: cvNote, jd: !!jd };
  await run(x.db, 'UPDATE applicants SET ai = ?, ai_score = ?, ai_at = ?, upd = ? WHERE id = ?', JSON.stringify(A), score, Date.now(), Date.now(), id);
  return { ok: true, ai: A, first: !r.ai_at };
}

/** cron 10 phút: chấm tối đa 3 hồ sơ chưa chấm (thử ≤ 3 lần), báo Telegram Quản trị; 1 lần / ngày dọn hồ sơ quá 12 tháng. */
export async function hrTick(x, users) {
  await hrSchema(x.db);
  if (x.env.ANTHROPIC_API_KEY) {
    const R = await all(x.db, "SELECT id, name, job, score FROM applicants WHERE ai_at IS NULL AND COALESCE(ai_try, 0) < 3 AND time > ? ORDER BY time LIMIT 3", Date.now() - 30 * DAY);
    for (const r of R) {
      const j = await hrAiEval(x, r.id); if (!j.ok) continue;
      const A = j.ai, msg = (A.rank === 'A' ? '🌟' : '🤖') + ' <b>AI đã đọc hồ sơ: ' + esc(r.name) + '</b> – ' + esc(r.job) + '\n🎯 Phù hợp <b>' + A.score + '% · hạng ' + A.rank + '</b>' + (r.score != null ? ' (trắc nghiệm ' + r.score + '%)' : '') +
        '\n' + esc(A.sum) + A.why.map(s => '\n• ' + esc(s)).join('') + (A.note ? '\nℹ️ ' + esc(A.note) : '') + '\n\n👉 Xem và hẹn phỏng vấn: https://hr.thucduonglanh.vn/#tuyen-dung';
      for (const u of (users || []).filter(z => z.active && z.tg && z.level >= 3)) await telegramTo(x.env, u.tg, msg);
    }
  }
  try { const w = await first(x.db, 'SELECT (SELECT COUNT(*) FROM hr_staff WHERE nt_dirty = 1 AND nt_err = \'\') + (SELECT COUNT(*) FROM hr_ht WHERE nt_dirty = 1 AND nt_err = \'\') n'); if (w && w.n) await ntPush(x, 15); } catch (e) { } // 📒 hồ sơ vừa đổi → ghi sang Notion (bảng chưa có thì bỏ qua)
  const dk = 'hr_clean_' + fmtDate(Date.now(), 'yyyyMMdd');
  if (!await kvGet(x.db, dk)) { await kvSet(x.db, dk, '1', 2 * DAY); await hrClean(x.db); try { const S = await kvJson(x.db, 'hr_fb_src', null); if (S && S.id) await fbSync(x); } catch (e) { console.error('hr fbSync', e.message); } } // 🗂 mỗi ngày đọc lại Sheet phiếu góp ý (câu trả lời mới)
}
async function hrClean(db) {
  const old = Date.now() - 365 * DAY;
  const R = await all(db, "SELECT id FROM applicants WHERE time < ? AND status != 'Đã nhận việc'", old);
  for (const r of R) { await run(db, 'DELETE FROM hr_cv WHERE id = ?', r.id); await run(db, 'DELETE FROM applicants WHERE id = ?', r.id); }
  await run(db, 'DELETE FROM hr_cv WHERE time < ?', old);
}

/* ---------------------------------------------------------------- email HTML */
const H = s => esc(s).replace(/\n/g, '<br>');
function mailHtml(title, inner, btn, cfg) {
  return `<div style="background:#f5f4ef;padding:24px 12px;font-family:-apple-system,BlinkMacSystemFont,system-ui,Helvetica Neue,Helvetica,Arial,sans-serif;font-weight:400;color:#262a1f">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:600px;table-layout:fixed;word-wrap:break-word;margin:0 auto;background:#ffffff;border-radius:14px;overflow:hidden;border:1px solid #e2e6de">
<tr><td style="padding:22px 28px 14px;border-bottom:3px solid #24805b"><img src="${LOGO}" alt="Thực Dưỡng Lành" height="44" style="display:block;height:44px"></td></tr>
<tr><td style="padding:24px 28px 8px"><h1 style="margin:0 0 14px;font-size:22px;line-height:1.3;color:#1f5f3a">${esc(title)}</h1>${inner}</td></tr>
${btn ? `<tr><td style="padding:8px 28px 22px" align="left"><a href="${btn[1]}" style="display:inline-block;background:#24805b;color:#ffffff;text-decoration:none;font-weight:700;padding:13px 22px;border-radius:10px;font-size:16px">${esc(btn[0])}</a>
<p style="margin:10px 0 0;font-size:13px;color:#5d6158;word-break:break-all">Nếu nút không bấm được, mở link: <a href="${btn[1]}" style="color:#24805b;word-break:break-all">${btn[1]}</a></p></td></tr>` : ''}
<tr><td style="padding:16px 28px 22px;font-size:15px;line-height:1.6">Trân trọng,<br><b>${H(cfg.sign)}</b></td></tr>
<tr><td style="padding:14px 28px;background:#f7f8f4;font-size:12px;line-height:1.6;color:#5d6158">Thực Dưỡng Lành – VitaGreen Nutrition · ${esc(cfg.place)} · Hotline / Zalo 0966 326 522 · <a href="https://thucduonglanh.vn" style="color:#24805b">thucduonglanh.vn</a><br>Thư này gửi riêng cho bạn, vui lòng không chuyển tiếp.</td></tr>
</table></div>`;
}
const P = s => `<p style="margin:0 0 12px;font-size:15px;line-height:1.65;font-weight:400">${s}</p>`;
const rows = L => '<table role="presentation" cellpadding="0" cellspacing="0" style="width:100%;margin:4px 0 16px;border-collapse:collapse;font-size:15px">' +
  L.filter(r => r[1]).map(r => `<tr><td style="padding:9px 10px;border-top:1px solid #eef0ea;color:#5d6158;width:38%;vertical-align:top">${esc(r[0])}</td><td style="padding:9px 10px;border-top:1px solid #eef0ea;font-weight:600;vertical-align:top">${H(r[1])}</td></tr>`).join('') + '</table>';
const txtRows = L => L.filter(r => r[1]).map(r => '- ' + r[0] + ': ' + r[1]).join('\n');
const callName = n => String(n || '').trim().split(/\s+/).pop() || 'bạn';
const dt = t => t ? fmtDate(t, 'HH:mm') + ', ' + ['Chủ nhật', 'Thứ Hai', 'Thứ Ba', 'Thứ Tư', 'Thứ Năm', 'Thứ Sáu', 'Thứ Bảy'][new Date(t + 7 * 3600e3).getUTCDay()] + ' ' + fmtDate(t, 'dd/MM/yyyy') : '';
const dday = s => { const m = String(s || '').match(/^(\d{4})-(\d{2})-(\d{2})$/); return m ? m[3] + '/' + m[2] + '/' + m[1] : String(s || ''); };

function ivMail(r, iv, cfg) {
  const link = API + '/tm/' + r.tok, L = [['Vị trí', r.job], ['Thời gian', dt(iv.at)], ['Hình thức', iv.mode], [/online|meet|zalo|gọi/i.test(iv.mode) ? 'Link / cách tham gia' : 'Địa điểm', iv.place], ['Người trò chuyện cùng bạn', iv.by]];
  const intro = 'Chào ' + callName(r.name) + ',', p1 = 'Cảm ơn bạn đã dành thời gian ứng tuyển vị trí <b>' + esc(r.job) + '</b> tại Thực Dưỡng Lành. Chúng tôi đã đọc hồ sơ của bạn và rất muốn được trò chuyện trực tiếp để hiểu bạn hơn.';
  const html = mailHtml('Thư mời phỏng vấn', P(esc(intro)) + P(p1) + rows(L) + (iv.note ? P(H(iv.note)) : '') + P('Bạn vui lòng bấm nút dưới đây để <b>xác nhận tham gia</b> hoặc <b>xin đổi lịch</b> nếu khung giờ chưa phù hợp.'), ['Xác nhận lịch phỏng vấn', link], cfg);
  const text = [intro, '', 'Cảm ơn bạn đã ứng tuyển vị trí ' + r.job + ' tại Thực Dưỡng Lành. Chúng tôi mời bạn tham gia buổi phỏng vấn:', txtRows(L), '', iv.note || '', '', 'Xác nhận tham gia hoặc xin đổi lịch tại: ' + link, '', 'Trân trọng,', cfg.sign].join('\n');
  return { subject: 'Thư mời phỏng vấn – ' + r.job + ' – Thực Dưỡng Lành', html, text };
}
function offerRows(o) {
  return [['Vị trí', o.pos], ['Ngày bắt đầu', dday(o.start)], ['Địa điểm làm việc', o.place], ['Thời gian làm việc', o.hours], ['Thời gian thử việc', o.trial], ['Lương thử việc', o.trialPay],
    ['Lương chính thức', o.pay], ['Phụ cấp, thưởng, phúc lợi', o.extra], ['Người quản lý trực tiếp', o.boss], ['Giấy tờ mang theo ngày đầu', o.docs], ['Hạn trả lời', dday(o.due)]];
}
function offerMail(r, o, cfg) {
  const link = API + '/tm/' + r.tok, intro = 'Chào ' + callName(r.name) + ',';
  const p1 = 'Cảm ơn bạn đã dành thời gian trò chuyện cùng chúng tôi. Ban điều hành Thực Dưỡng Lành rất vui được <b>mời bạn chính thức nhận việc</b> ở vị trí <b>' + esc(o.pos) + '</b>, cùng chúng tôi trên hành trình giúp 10 triệu người Việt sống khoẻ từ Thân đến Tâm.';
  const html = mailHtml('Thư mời nhận việc', P(esc(intro)) + P(p1) + rows(offerRows(o)) + (o.msg ? P(H(o.msg)) : '') +
    P('Bạn vui lòng bấm nút dưới đây để <b>xác nhận nhận việc</b> trước ngày <b>' + esc(dday(o.due)) + '</b>. Nếu có điều gì cần trao đổi thêm, bạn cứ trả lời thư này hoặc gọi hotline 0966 326 522.') +
    P('Chúng tôi rất mong được đón bạn ở ngày làm việc đầu tiên. 🌿'), ['Xem và xác nhận nhận việc', link], cfg);
  const text = [intro, '', 'Thực Dưỡng Lành trân trọng mời bạn nhận việc ở vị trí ' + o.pos + ':', txtRows(offerRows(o)), '', o.msg || '', '', 'Xác nhận nhận việc trước ' + dday(o.due) + ' tại: ' + link, '', 'Trân trọng,', cfg.sign].join('\n');
  return { subject: 'Thư mời nhận việc – ' + o.pos + ' – Thực Dưỡng Lành', html, text };
}
async function mailTo(x, r, m, cfg) {
  await sendMail(x.env, { to: r.email, subject: m.subject, body: m.text, htmlBody: m.html, name: cfg.from, replyTo: cfg.reply || (await tgConf(x.env)).notify || '' });
}

/* ---------------------------------------------------------------- lệnh CRM */
function outRow(r, cvn) {
  const q = parse(r.quiz) || {}, f = r.score != null ? fitScore(q) : null;
  return { id: r.id, time: r.time, job: r.job, name: r.name, phone: r.phone, email: r.email, birth: r.birth, area: r.area, exp: r.exp, salary: r.salary, start: r.start, cv_link: r.cv_link, file: r.file_name, cv: !!cvn,
    ans: parse(r.answers) || {}, heard: r.heard, st: HR_ST.indexOf(r.status) >= 0 ? r.status : 'Mới', note: r.note || '', quiz: r.score, qlv: f ? f.level : '', qflags: f ? f.flags : [], qdet: f ? f.detail : '',
    ai: parse(r.ai), aiAt: r.ai_at || 0, aiTry: r.ai_try || 0, iv: parse(r.iv), ivr: parse(r.ivr), ivs: parse(r.ivs), offer: parse(r.offer), ofr: parse(r.ofr), hist: parse(r.hist) || [], upd: r.upd || r.time, link: r.tok ? API + '/tm/' + r.tok : '' };
}
async function addHist(db, id, who, text, extra) {
  const r = await first(db, 'SELECT hist FROM applicants WHERE id = ?', id), h = parse(r && r.hist) || [];
  h.push([Date.now(), who, text]); const sets = ['hist = ?', 'upd = ?'], args = [JSON.stringify(h.slice(-60)), Date.now()];
  for (const k in extra || {}) { sets.push(k + ' = ?'); args.push(extra[k]); }
  await run(db, 'UPDATE applicants SET ' + sets.join(', ') + ' WHERE id = ?', ...args, id);
}
const str = (d, k, n) => cut(d[k], n || 300);
function ivOf(d, u) {
  const at = Number(d.at) || 0;
  return { at, mode: str(d, 'mode', 60) || 'Tại văn phòng', place: str(d, 'place', 300), by: str(d, 'by', 120) || u.name, note: str(d, 'note', 1200), sentBy: u.name };
}
function offerOf(d) {
  return { pos: str(d, 'pos', 120), start: str(d, 'start', 10), place: str(d, 'place', 300), hours: str(d, 'hours', 200), trial: str(d, 'trial', 80), trialPay: str(d, 'trialPay', 200), pay: str(d, 'pay', 200),
    extra: str(d, 'extra', 600), boss: str(d, 'boss', 120), docs: str(d, 'docs', 600), due: str(d, 'due', 10), msg: str(d, 'msg', 1500) };
}

/** hr {op, …}: Quản lý + Quản trị. */
export async function crmHr(x, u, d, log) {
  if (!okRole(u)) return { ok: false, error: 'Chỉ Quản lý và Quản trị xem được hồ sơ tuyển dụng.' };
  await hrSchema(x.db);
  if (/^st_/.test(String(d.op || ''))) return crmHrStaff(x, u, d, log);
  const op = String(d.op || 'list'), id = Number(d.id) || 0, cfg = await cfgOf(x.db);
  const list = async () => {
    const R = await all(x.db, 'SELECT * FROM applicants ORDER BY time DESC LIMIT 400'), C = {};
    for (const c of await all(x.db, 'SELECT id FROM hr_cv')) C[c.id] = 1;
    return { ok: true, rows: R.map(r => outRow(r, C[r.id])), st: HR_ST, cfg: await cfgOf(x.db), ai: !!x.env.ANTHROPIC_API_KEY, admin: u.level >= 3, me: u.name };
  };
  if (op === 'list') return list();
  if (op === 'cfg') {
    if (u.level < 3) return { ok: false, error: 'Chỉ Quản trị sửa được mẫu thư.' };
    const c = {}; for (const k of Object.keys(CFG_DEF)) if (d[k] != null) c[k] = cut(d[k], 800);
    if (c.reply && !/^\S+@\S+\.\S+$/.test(c.reply)) return { ok: false, error: 'Email nhận trả lời chưa đúng.' };
    await kvSet(x.db, 'hr_cfg', JSON.stringify(Object.assign({}, await kvJson(x.db, 'hr_cfg', null) || {}, c)));
    return list();
  }
  const r = id ? await first(x.db, 'SELECT * FROM applicants WHERE id = ?', id) : null;
  if (!r) return { ok: false, error: 'Không thấy hồ sơ (có thể đã bị xoá).' };
  if (!r.tok) { r.tok = randHex(12); await run(x.db, 'UPDATE applicants SET tok = ? WHERE id = ?', r.tok, id); }
  if (op === 'cv') {
    const c = await first(x.db, 'SELECT name, b64 FROM hr_cv WHERE id = ?', id);
    if (!c) return { ok: false, error: 'Không còn file CV trên máy chủ (file lớn hơn 1,4 MB chỉ gửi qua Telegram Quản trị).' };
    await log(x, u, 'Tuyển dụng', r.name, '', 'Tải file CV', '');
    return { ok: true, name: c.name, b64: c.b64 };
  }
  if (op === 'note') { await addHist(x.db, id, u.name, 'Sửa ghi chú', { note: cut(d.note, 3000) }); return list(); }
  if (op === 'stage') {
    const st = String(d.st || ''); if (HR_ST.indexOf(st) < 0) return { ok: false, error: 'Trạng thái không đúng.' };
    await addHist(x.db, id, u.name, 'Chuyển sang “' + st + '”' + (d.why ? ': ' + cut(d.why, 300) : ''), { status: st });
    await log(x, u, 'Tuyển dụng', r.name, '', r.status + ' → ' + st, '');
    return list();
  }
  if (op === 'ai') {
    const j = await hrAiEval(x, id); if (!j.ok) return j;
    await addHist(x.db, id, u.name, 'AI chấm lại: ' + j.ai.score + '% · hạng ' + j.ai.rank);
    return list();
  }
  if (op === 'prev') { // xem trước thư (không gửi)
    const m = d.kind === 'offer' ? offerMail(r, offerOf(d), cfg) : ivMail(r, ivOf(d, u), cfg);
    return { ok: true, subject: m.subject, html: m.html };
  }
  if (op === 'iv') {
    const iv = ivOf(d, u); if (!iv.at || iv.at < Date.now() - 3600e3) return { ok: false, error: 'Chọn ngày giờ phỏng vấn (từ bây giờ trở đi).' };
    if (!iv.place) return { ok: false, error: 'Điền địa điểm hoặc link tham gia.' };
    const send = !!d.send && /^\S+@\S+\.\S+$/.test(r.email);
    if (send) await mailTo(x, r, ivMail(r, iv, cfg), cfg);
    iv.sent = send ? Date.now() : 0;
    await addHist(x.db, id, u.name, 'Hẹn phỏng vấn ' + dt(iv.at) + (send ? ' · đã gửi email mời' : ' · không gửi email'), { iv: JSON.stringify(iv), ivr: '', status: r.status === 'Mới' || r.status === 'Hẹn phỏng vấn' ? 'Hẹn phỏng vấn' : r.status });
    await log(x, u, 'Tuyển dụng', r.name, '', 'Hẹn phỏng vấn ' + dt(iv.at), '');
    return Object.assign(await list(), { sent: send });
  }
  if (op === 'ivs') { // phiếu chấm sau phỏng vấn
    const s = {}; for (const k of ['than', 'tam', 'tri', 'vh', 'gb']) { const v = Math.round(Number((d.s || {})[k]) || 0); if (v < 1 || v > 5) return { ok: false, error: 'Chấm đủ 5 mục (1–5 sao).' }; s[k] = v; }
    const verdict = ['Nhận', 'Cân nhắc', 'Không nhận'].indexOf(d.verdict) >= 0 ? d.verdict : 'Cân nhắc';
    const ivs = { s, avg: Math.round((s.than + s.tam + s.tri + s.vh + s.gb) / 5 * 10) / 10, note: cut(d.note, 2000), verdict, by: u.name, at: Date.now() };
    const st = verdict === 'Không nhận' ? 'Không phù hợp' : r.status === 'Mời nhận việc' || r.status === 'Đã nhận việc' ? r.status : 'Đã phỏng vấn';
    await addHist(x.db, id, u.name, 'Chấm phỏng vấn ' + ivs.avg + '/5 · ' + verdict, { ivs: JSON.stringify(ivs), status: st });
    return list();
  }
  if (op === 'offer') {
    const o = offerOf(d);
    if (!o.pos || !/^\d{4}-\d{2}-\d{2}$/.test(o.start) || !o.pay || !/^\d{4}-\d{2}-\d{2}$/.test(o.due)) return { ok: false, error: 'Điền đủ vị trí, ngày bắt đầu, lương chính thức và hạn trả lời.' };
    if (!/^\S+@\S+\.\S+$/.test(r.email)) return { ok: false, error: 'Ứng viên không có email đúng để gửi thư.' };
    await mailTo(x, r, offerMail(r, o, cfg), cfg);
    o.sentBy = u.name; o.sent = Date.now();
    await addHist(x.db, id, u.name, 'Gửi thư mời nhận việc (hạn trả lời ' + dday(o.due) + ')', { offer: JSON.stringify(o), ofr: '', status: 'Mời nhận việc' });
    await log(x, u, 'Tuyển dụng', r.name, '', 'Gửi thư mời nhận việc: ' + o.pos, '');
    return list();
  }
  if (op === 'del') {
    if (u.level < 3) return { ok: false, error: 'Chỉ Quản trị xoá được hồ sơ.' };
    await run(x.db, 'DELETE FROM hr_cv WHERE id = ?', id); await run(x.db, 'DELETE FROM applicants WHERE id = ?', id);
    await log(x, u, 'Tuyển dụng', r.name, '', 'Xoá hồ sơ ứng viên (theo yêu cầu / hết thời gian lưu)', '');
    return list();
  }
  return { ok: false, error: 'Không rõ thao tác.' };
}

/* ---------------------------------------------------------------- trang công khai cho ứng viên: /tm/<tok> */
function page(title, body) {
  return new Response(`<!doctype html><html lang="vi"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex,nofollow">
<title>${esc(title)} · Thực Dưỡng Lành</title><style>
:root{--g:#24805B;--t:#262A1F;--m:#5d6158;--bg:#F5F4EF;--line:#E2E6DE}*{box-sizing:border-box}
body{margin:0;background:var(--bg);color:var(--t);font:17px/1.6 -apple-system,system-ui,"Segoe UI",Roboto,sans-serif}
main{max-width:620px;margin:0 auto;padding:20px 16px 40px}.card{background:#fff;border:1px solid var(--line);border-radius:16px;padding:22px 20px;margin:0 0 14px}
.logo{height:42px;display:block;margin:4px 0 18px}h1{font-size:24px;line-height:1.3;color:#1f5f3a;margin:0 0 12px}p{margin:0 0 12px}
table{width:100%;border-collapse:collapse;margin:6px 0 14px;font-size:16px}td{padding:9px 6px;border-top:1px solid #eef0ea;vertical-align:top}td:first-child{color:var(--m);width:40%}td:last-child{font-weight:600}
.b{display:block;width:100%;font:inherit;font-weight:700;padding:14px;border-radius:12px;border:1px solid var(--line);background:#fff;color:var(--t);cursor:pointer;margin:10px 0 0}
.b.ok{background:var(--g);border-color:var(--g);color:#fff;font-size:18px}.b.no{color:#B5523B}
textarea,input[type=text]{width:100%;font:inherit;padding:11px 12px;border:1px solid var(--line);border-radius:10px;margin:6px 0 0}
label.ck{display:flex;gap:10px;align-items:flex-start;margin:12px 0 0;font-size:15px}label.ck input{margin-top:5px;width:20px;height:20px;flex:none}
.note{background:#EAF4EF;border:1px solid #bfdccd;border-radius:12px;padding:12px 14px;margin:0 0 14px}.warn{background:#fff6e5;border-color:#f2d8a6}
details{margin-top:12px}summary{cursor:pointer;color:var(--g);font-weight:600}small,.m{color:var(--m);font-size:14px}
</style></head><body><main><img class="logo" src="${LOGO}" alt="Thực Dưỡng Lành">${body}
<p class="m" style="text-align:center;margin-top:18px">Thực Dưỡng Lành – VitaGreen Nutrition · Hotline / Zalo <a href="tel:0966326522" style="color:var(--g)">0966 326 522</a></p></main></body></html>`,
    { headers: { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store', 'X-Robots-Tag': 'noindex', 'Referrer-Policy': 'no-referrer' } });
}
const tbl = L => '<table>' + L.filter(r => r[1]).map(r => '<tr><td>' + esc(r[0]) + '</td><td>' + H(r[1]) + '</td></tr>').join('') + '</table>';
const pastDue = due => due && fmtDate(Date.now(), 'yyyy-MM-dd') > due;

function viewOf(r, note) {
  const iv = parse(r.iv), ivr = parse(r.ivr), o = parse(r.offer), ofr = parse(r.ofr), nm = esc(callName(r.name));
  const msg = note ? '<div class="note">' + note + '</div>' : '';
  if (o && (r.status === 'Mời nhận việc' || r.status === 'Đã nhận việc' || r.status === 'Từ chối nhận việc')) {
    let act;
    if (ofr && ofr.ok === 1) act = '<div class="note">🎉 Bạn đã xác nhận nhận việc lúc ' + esc(dt(ofr.at)) + '. Hẹn gặp bạn ngày <b>' + esc(dday(o.start)) + '</b>!' + (o.docs ? '<br><br><b>Nhớ mang theo:</b> ' + H(o.docs) : '') + '</div>';
    else if (ofr && ofr.ok === -1) act = '<div class="note warn">Bạn đã báo chưa nhận lời mời lúc ' + esc(dt(ofr.at)) + '. Cảm ơn bạn đã dành thời gian cho Thực Dưỡng Lành, chúc bạn mọi điều tốt đẹp.</div>';
    else if (pastDue(o.due)) act = '<div class="note warn">Thư mời đã quá hạn trả lời (' + esc(dday(o.due)) + '). Nếu bạn vẫn muốn nhận việc, vui lòng gọi hoặc nhắn Zalo 0966 326 522.</div>';
    else act = `<form method="post"><input type="hidden" name="act" value="offer_ok"><label class="ck"><input type="checkbox" name="agree" value="1" required><span>Tôi đã đọc và đồng ý với các nội dung của thư mời nhận việc này.</span></label>
<label style="display:block;margin-top:12px;font-size:15px">Gõ họ và tên đầy đủ của bạn để xác nhận<input type="text" name="sign" required autocomplete="name" placeholder="${esc(r.name)}"></label>
<button class="b ok">✅ Tôi đồng ý nhận việc</button></form>
<details><summary>Tôi cần trao đổi thêm / chưa thể nhận việc</summary><form method="post"><input type="hidden" name="act" value="offer_no"><textarea name="msg" rows="3" placeholder="Bạn muốn trao đổi điều gì? (không bắt buộc)"></textarea>
<button class="b" name="kind" value="ask">💬 Gửi câu hỏi, chưa trả lời ngay</button><button class="b no" name="kind" value="no">Tôi chưa thể nhận lời mời này</button></form></details>`;
    return page('Thư mời nhận việc', msg + '<div class="card"><h1>Thư mời nhận việc</h1><p>Chào ' + nm + ', Thực Dưỡng Lành trân trọng mời bạn nhận việc ở vị trí <b>' + esc(o.pos) + '</b>.</p>' + tbl(offerRows(o)) + (o.msg ? '<p>' + H(o.msg) + '</p>' : '') + act + '</div>');
  }
  if (iv && (r.status === 'Hẹn phỏng vấn' || r.status === 'Đã phỏng vấn')) {
    let act;
    if (r.status === 'Đã phỏng vấn') act = '<div class="note">Cảm ơn bạn đã tham gia buổi phỏng vấn. Chúng tôi sẽ báo kết quả qua email hoặc điện thoại trong vài ngày tới.</div>';
    else if (ivr && ivr.ok === 1) act = '<div class="note">✅ Bạn đã xác nhận tham gia lúc ' + esc(dt(ivr.at)) + '. Hẹn gặp bạn!</div>';
    else if (iv.at < Date.now()) act = '<div class="note warn">Buổi phỏng vấn đã qua giờ hẹn. Nếu bạn chưa kịp tham gia, vui lòng gọi hoặc nhắn Zalo 0966 326 522.</div>';
    else act = (ivr && ivr.ok === -1 ? '<div class="note warn">Bạn đã xin đổi lịch lúc ' + esc(dt(ivr.at)) + '. Chúng tôi sẽ liên hệ lại. Bạn vẫn có thể xác nhận lịch cũ nếu sắp xếp được.</div>' : '') +
      `<form method="post"><input type="hidden" name="act" value="iv_ok"><button class="b ok">✅ Tôi sẽ tham gia đúng lịch</button></form>
<details><summary>Tôi cần đổi lịch</summary><form method="post"><input type="hidden" name="act" value="iv_move"><textarea name="msg" rows="3" placeholder="Bạn rảnh vào những khung giờ nào? Ví dụ: sáng thứ Ba, chiều thứ Năm"></textarea><button class="b">📅 Gửi đề nghị đổi lịch</button></form></details>`;
    return page('Lịch phỏng vấn', msg + '<div class="card"><h1>Lịch phỏng vấn</h1><p>Chào ' + nm + ', cảm ơn bạn đã ứng tuyển vị trí <b>' + esc(r.job) + '</b>.</p>' +
      tbl([['Thời gian', dt(iv.at)], ['Hình thức', iv.mode], [/online|meet|zalo|gọi/i.test(iv.mode) ? 'Link / cách tham gia' : 'Địa điểm', iv.place], ['Người trò chuyện cùng bạn', iv.by]]) + (iv.note ? '<p>' + H(iv.note) + '</p>' : '') + act + '</div>');
  }
  return page('Hồ sơ ứng tuyển', msg + '<div class="card"><h1>Hồ sơ của bạn đang được xem</h1><p>Chào ' + nm + ', cảm ơn bạn đã ứng tuyển vị trí <b>' + esc(r.job) + '</b>. Chúng tôi sẽ liên hệ khi có lịch phỏng vấn hoặc kết quả.</p></div>');
}

export async function hrRoute(x, req, path, users) {
  const m = path.match(/^\/tm\/([a-f0-9]{24})$/); if (!m) return null;
  await hrSchema(x.db);
  const r = await first(x.db, 'SELECT * FROM applicants WHERE tok = ?', m[1]);
  if (!r) return page('Link không dùng được', '<div class="card"><h1>Link không còn hiệu lực</h1><p>Hồ sơ không còn trên hệ thống. Vui lòng gọi hoặc nhắn Zalo 0966 326 522 nếu cần hỗ trợ.</p></div>');
  if (req.method !== 'POST') return viewOf(r);
  const f = await req.formData(), act = String(f.get('act') || ''), msg = cut(f.get('msg'), 1000), now = Date.now();
  const iv = parse(r.iv), o = parse(r.offer), ofr = parse(r.ofr);
  let tg = '', note = '';
  if ((act === 'iv_ok' || act === 'iv_move') && iv && r.status === 'Hẹn phỏng vấn' && iv.at > now) {
    const ok = act === 'iv_ok' ? 1 : -1;
    await addHist(x.db, r.id, 'Ứng viên', ok === 1 ? 'Xác nhận tham gia phỏng vấn' : 'Xin đổi lịch phỏng vấn' + (msg ? ': ' + msg : ''), { ivr: JSON.stringify({ ok, note: msg, at: now }) });
    note = ok === 1 ? '✅ Cảm ơn bạn! Lịch phỏng vấn đã được xác nhận.' : '📅 Đã gửi đề nghị đổi lịch. Chúng tôi sẽ liên hệ lại bạn sớm.';
    tg = (ok === 1 ? '✅ <b>' + esc(r.name) + '</b> xác nhận tham gia phỏng vấn ' : '📅 <b>' + esc(r.name) + '</b> xin đổi lịch phỏng vấn ') + esc(dt(iv.at)) + ' (' + esc(r.job) + ')' + (msg ? '\n💬 ' + esc(msg) : '');
  } else if ((act === 'offer_ok' || act === 'offer_no') && o && r.status === 'Mời nhận việc' && !(ofr && ofr.ok === 1) && !pastDue(o.due)) {
    if (act === 'offer_ok') {
      const sign = cut(f.get('sign'), 120);
      if (!f.get('agree') || nrm(sign).replace(/\s/g, '').length < 4) return viewOf(r, '⚠️ Bạn tích ô đồng ý và gõ họ tên đầy đủ để xác nhận nhé.');
      await addHist(x.db, r.id, 'Ứng viên', 'Đồng ý nhận việc (ký tên: ' + sign + ')', { ofr: JSON.stringify({ ok: 1, sign, at: now, ip: x.ip || '' }), status: 'Đã nhận việc' });
      note = '🎉 Chào mừng bạn đến với Thực Dưỡng Lành! Chúng tôi đã nhận xác nhận của bạn.';
      tg = '🎉 <b>' + esc(r.name) + ' ĐỒNG Ý NHẬN VIỆC</b>\n💼 ' + esc(o.pos) + ' · bắt đầu ' + esc(dday(o.start)) + '\n✍️ Ký tên: ' + esc(sign) + '\n\n👉 Thêm tài khoản CRM ở Cài đặt → Nhân sự và chuẩn bị ngày đầu (Sổ tay, 10 Quy Tắc Danh Dự).';
    } else {
      const no = f.get('kind') === 'no';
      await addHist(x.db, r.id, 'Ứng viên', (no ? 'Chưa nhận lời mời' : 'Hỏi thêm về thư mời') + (msg ? ': ' + msg : ''), no ? { ofr: JSON.stringify({ ok: -1, note: msg, at: now }), status: 'Từ chối nhận việc' } : { ofr: JSON.stringify({ ok: 0, note: msg, at: now }) });
      note = no ? 'Cảm ơn bạn đã phản hồi. Chúc bạn mọi điều tốt đẹp.' : '💬 Đã gửi câu hỏi. Chúng tôi sẽ liên hệ lại bạn sớm.';
      tg = (no ? '🙏 <b>' + esc(r.name) + '</b> chưa nhận lời mời ' : '💬 <b>' + esc(r.name) + '</b> hỏi thêm về thư mời ') + '(' + esc(o.pos) + ')' + (msg ? '\n💬 ' + esc(msg) : '');
    }
  } else return viewOf(r, 'Thao tác này không còn dùng được (có thể bạn đã trả lời rồi). Đây là thông tin mới nhất.');
  if (tg) {
    const who = [iv && iv.sentBy, iv && iv.by, o && o.sentBy].filter(Boolean);
    const to = (users || []).filter(z => z.active && z.tg && (z.level >= 3 || who.indexOf(z.name) >= 0));
    x.later((async () => { for (const z of to) await telegramTo(x.env, z.tg, tg + '\n\nhttps://hr.thucduonglanh.vn/#tuyen-dung'); })());
  }
  return viewOf(await first(x.db, 'SELECT * FROM applicants WHERE id = ?', r.id), note);
}
