/* 🤖 Trợ lý viết bài tự động cho Góc Sống Lành (10/11/2026, anh Sơn duyệt giải pháp).
 * Cài đặt + danh sách chủ đề: /admin → Cài đặt website → 🤖 Trợ lý viết bài tự động (file data/blog-auto.json trong repo).
 *   per_week 1–7 bài / tuần (ngày đăng cố định theo DAYS), hour = giờ đăng, audience = tệp khách + insight + tension, topics = chủ đề chờ viết.
 * Luồng: cron 10 phút / lần (blogTick)
 *   1. Trước ngày đăng 1 ngày: viết bài nháp (Claude + tìm nguồn trên mạng), lưu D1 bảng bl_posts, nhắn Telegram riêng từng người duyệt kèm link duyệt.
 *      Chủ đề: chủ đề "Chờ viết" trên cùng ở /admin; hết thì tự chọn theo phễu TOFU/MOFU/BOFU (tỉ lệ 60/20/20) + insight, tension của tệp khách.
 *      Mọi bài (kể cả chủ đề được giao) đi qua bước 🎯 Insight → Tension → Phễu (insight.js): chọn nhóm khách (chủ đề có ghi nhóm → nhóm đó, không thì nhóm ít được viết nhất) + 1 tension rồi mới viết.
 *   2. Người duyệt (Quản trị, Quản lý, người được bật "Sửa website" ở CRM → Cài đặt → Nhân sự; phải nối Telegram) mở link /bai/<ngày>:
 *      ✅ Đăng · ✍️ Viết lại theo ý kiến · 🖊 Tự sửa trong /admin · 🔁 Đổi chủ đề khác · ❌ Bỏ.
 *   3. Bài đã duyệt: tới giờ đăng của ngày đăng thì commit content/posts/<slug>.md vào main (cùng lúc đổi chủ đề sang "Đã đăng") → web tự build, báo IndexNow.
 *      Duyệt muộn hơn giờ đăng → đăng ngay. Chưa ai duyệt thì không bao giờ tự đăng; tới giờ đăng mà chưa duyệt thì nhắc 1 lần.
 * Link duyệt ký bằng HMAC riêng từng người (không cần đăng nhập, không chứa email). Không có ANTHROPIC_API_KEY hoặc mã GitHub (gh_cms_token) thì không chạy. */
import Anthropic from '@anthropic-ai/sdk';
import { aiFetch } from './airelay.js';
import { esc, run, all, first, kvGet, kvSet, fmtDate, randHex, hashKey, TZ_MS, DAY, CRM_URL } from './lib.js';
import { telegram, telegramTo, gInfo } from './google.js';
import { crmUsers, crmLog } from './crm.js';
import { cmsToken } from './cms.js';
import { kb } from './chat.js';
import { imgLib, prodMap } from './zbot.js';
import { insPick, insBlock, insParse, insLog, insBank, insRisk, insViet, insStyle, INS_HEAD, kwPick, kwUse } from './insight.js';

const REPO = 'thaisoniph/thucduonglanh.vn', GH = 'https://api.github.com', SITE = 'https://thucduonglanh.vn', API = 'https://api.thucduonglanh.vn';
const CFG_PATH = 'data/blog-auto.json', POSTS_DIR = 'content/posts';
const MODEL = 'claude-opus-5-5'; // bài web dài, cần chắc chữ + đúng nguồn → mô hình tốt nhất (~8–10 nghìn đồng / bài kể cả tìm nguồn)
/** Ngày đăng theo số bài / tuần (0 = Chủ nhật, 1 = thứ 2…) */
const DAYS = { 1: [3], 2: [2, 5], 3: [1, 3, 5], 4: [1, 2, 4, 6], 5: [1, 2, 3, 4, 5], 6: [1, 2, 3, 4, 5, 6], 7: [0, 1, 2, 3, 4, 5, 6] };
const WD = ['Chủ nhật', 'Thứ 2', 'Thứ 3', 'Thứ 4', 'Thứ 5', 'Thứ 6', 'Thứ 7'];
const FUNNEL = {
  TOFU: { name: '🔵 Nhận biết (TOFU)', goal: 'Thu hút người chưa biết Thực Dưỡng Lành bằng kiến thức hữu ích, chạm đúng nỗi lòng (tension) của nhóm khách. KHÔNG bán hàng: tối đa 1 câu nhẹ ở cuối bài nhắc tới sản phẩm liên quan, có link.' },
  MOFU: { name: '⚪ Cân nhắc (MOFU)', goal: 'Giúp người đang tìm giải pháp so sánh, biết cách chọn, hiểu tiêu chí; tạo niềm tin bằng nguồn gốc, thành phần, hồ sơ chất lượng thật. Có 1 mục "Giải pháp từ Thực Dưỡng Lành" giới thiệu 1–2 sản phẩm phù hợp, có link.' },
  BOFU: { name: '🟠 Mua hàng (BOFU)', goal: 'Bài cho người đã sẵn sàng mua: hướng dẫn dùng 1 sản phẩm cụ thể trong đời sống hằng ngày (cách pha, thời điểm, kết hợp bữa ăn), ai nên dùng, ai cần hỏi bác sĩ, câu hỏi thường gặp, cách đặt trên web (freeship đơn từ 300.000đ, được kiểm hàng). Không bịa khuyến mãi.' },
};
const MIX = { TOFU: 0.6, MOFU: 0.2, BOFU: 0.2 }; // 11/11/2026 khoá K133: 60/20/20 (trước 50/30/20)
const CATS = ['kien-thuc-dinh-duong', 'song-lanh-moi-ngay', 'cau-chuyen-san-pham'];
const BAN_RE = /(chữa|điều trị|khỏi bệnh|đặc trị|thần dược|thay thuốc|thay thế thuốc|trị bệnh|trị dứt|chữa khỏi)/gi;
const DISCLAIMER = '*Sản phẩm là thực phẩm, không phải là thuốc và không có tác dụng thay thế thuốc chữa bệnh.*';
/** Câu bắt buộc "không có tác dụng thay thế thuốc chữa bệnh" có chữ "chữa" → bộ lọc từ cấm không được đụng vào (10/11/2026: bài 11/11 bị đổi thành "thay thế thuốc hỗ trợ bệnh"). */
const DISC_RE = /không có tác dụng thay thế thuốc[^.\n*]{0,20}bệnh/gi;
const fixDisc = s => String(s || '').replace(DISC_RE, 'không có tác dụng thay thế thuốc chữa bệnh');
const SAFE_BEFORE = /không|chẳng|chưa|đang|bác sĩ|thay thế/i; // "đang điều trị bệnh thì hỏi bác sĩ" là lời khuyên đúng, không phải quảng cáo công dụng

/* ---------------------------------------------------------------- dữ liệu */
let schemaOk = false;
async function schema(db) {
  if (schemaOk) return;
  await run(db, `CREATE TABLE IF NOT EXISTS bl_posts (day TEXT PRIMARY KEY, status TEXT, title TEXT DEFAULT '', slug TEXT DEFAULT '', funnel TEXT DEFAULT '', topic TEXT DEFAULT '',
    tkey TEXT DEFAULT '', md TEXT DEFAULT '', meta TEXT DEFAULT '{}', hint TEXT DEFAULT '', by_name TEXT DEFAULT '', at INTEGER DEFAULT 0, pub_at INTEGER DEFAULT 0,
    url TEXT DEFAULT '', err TEXT DEFAULT '', tries INTEGER DEFAULT 0, remind INTEGER DEFAULT 0, hidden INTEGER DEFAULT 0)`);
  await run(db, "CREATE TABLE IF NOT EXISTS bl_conv (oid TEXT PRIMARY KEY, slug TEXT, at INTEGER, total INTEGER DEFAULT 0)"); // đơn đặt trong 7 ngày sau khi khách đọc 1 bài viết (bài đọc gần nhất)
  schemaOk = true;
}
const addDays = (d, n) => fmtDate(new Date(d + 'T12:00:00+07:00').getTime() + n * DAY, 'yyyy-MM-dd');
const wdOf = d => new Date(d + 'T12:00:00+07:00').getUTCDay();
const dayTxt = d => WD[wdOf(d)] + ' ' + d.slice(8, 10) + '/' + d.slice(5, 7);
const meta = p => { try { return JSON.parse(p.meta || '{}'); } catch (e) { return {}; } };

/* ---------------------------------------------------------------- GitHub (mã của công ty, cùng mã /admin dùng) */
async function gh(x, method, path, body) {
  const t = await cmsToken(x); if (!t) throw new Error('Chưa có mã GitHub (CRM → Cài đặt → 🌐 Trang quản trị website)');
  const r = await fetch(GH + path, { method, headers: { Authorization: 'Bearer ' + t, Accept: 'application/vnd.github+json', 'User-Agent': 'thucduonglanh-blog', 'X-GitHub-Api-Version': '2022-11-28', 'Content-Type': 'application/json' }, body: body ? JSON.stringify(body) : undefined });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) { const e = new Error('GitHub ' + r.status + ': ' + (j.message || '')); e.status = r.status; throw e; }
  return j;
}
const b64dec = s => new TextDecoder().decode(Uint8Array.from(atob(String(s).replace(/\s/g, '')), c => c.charCodeAt(0)));
async function ghText(x, path) { return b64dec((await gh(x, 'GET', '/repos/' + REPO + '/contents/' + path + '?ref=main')).content); }
async function postSlugs(x) { return (await gh(x, 'GET', '/repos/' + REPO + '/contents/' + POSTS_DIR + '?ref=main')).filter(f => /\.md$/.test(f.name) && !/\.en\.md$/.test(f.name)).map(f => f.name.replace(/\.md$/, '')); }
/** 1 commit nhiều file. make() đọc bản mới nhất mỗi lần thử (nhân sự có thể vừa sửa /admin) → trả { đường dẫn: nội dung }. */
async function ghCommit(x, make, message) {
  for (let i = 0; i < 3; i++) {
    const base = (await gh(x, 'GET', '/repos/' + REPO + '/git/ref/heads/main')).object.sha;
    const c = await gh(x, 'GET', '/repos/' + REPO + '/git/commits/' + base), files = await make();
    const tree = await gh(x, 'POST', '/repos/' + REPO + '/git/trees', { base_tree: c.tree.sha, tree: Object.entries(files).map(([path, content]) => ({ path, mode: '100644', type: 'blob', content })) });
    const nc = await gh(x, 'POST', '/repos/' + REPO + '/git/commits', { message, tree: tree.sha, parents: [base] });
    try { await gh(x, 'PATCH', '/repos/' + REPO + '/git/refs/heads/main', { sha: nc.sha }); return nc.sha; }
    catch (e) { if (e.status !== 422 && e.status !== 409) throw e; } // main vừa đổi → làm lại trên bản mới
  }
  throw new Error('GitHub đang bận, sẽ thử lại sau');
}
async function cfgRaw(x) { return JSON.parse(await ghText(x, CFG_PATH)); }
function cfgOf(c) {
  const per = Math.min(7, Math.max(1, Math.round(Number(c.per_week) || 3)));
  return { on: c.on !== false, per, days: DAYS[per], hour: Math.min(21, Math.max(7, Math.round(Number(c.hour) || 9))), audience: String(c.audience || ''), topics: Array.isArray(c.topics) ? c.topics : [] };
}

/* ---------------------------------------------------------------- người duyệt + link ký riêng */
async function approvers(x) { return (await crmUsers(x)).filter(u => u.active && (u.level >= 2 || u.web)); }
async function secret(x) { let s = await kvGet(x.db, 'bl_secret'); if (!s) { s = randHex(32); await kvSet(x.db, 'bl_secret', s); } return s; }
async function sign(x, day, email) {
  const k = await crypto.subtle.importKey('raw', new TextEncoder().encode(await secret(x)), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const b = new Uint8Array(await crypto.subtle.sign('HMAC', k, new TextEncoder().encode('bai|' + day + '|' + email)));
  return [...b.slice(0, 12)].map(v => v.toString(16).padStart(2, '0')).join('');
}
async function linkFor(x, day, u) { return API + '/bai/' + day + '?u=' + hashKey(u.email) + '&k=' + await sign(x, day, u.email); }
async function whoOf(x, day, uh, k) {
  for (const u of await approvers(x)) if (hashKey(u.email) === uh && k && k === await sign(x, day, u.email)) return u;
  return null;
}
async function notifyApprovers(x, p, head) {
  const m = meta(p), list = (await approvers(x)).filter(u => u.tg);
  const body = head + '\n<b>' + esc(p.title) + '</b>\n' + esc(m.excerpt || '') + '\n' + (FUNNEL[p.funnel] ? FUNNEL[p.funnel].name : '') + (m.who ? ' · ' + esc(m.who) : '') + '\n📅 Đăng ' + dayTxt(p.day) + ' lúc ' + (m.hour || 9) + 'h';
  if (!list.length) return telegram(x.env, body + '\n\n⚠️ Chưa có người duyệt nào nối Telegram. Quản trị / Quản lý vào CRM → Cài đặt để nối Telegram rồi mới nhận được link duyệt.');
  for (const u of list) await telegramTo(x.env, u.tg, body + '\n\n👉 Xem và duyệt: ' + esc(await linkFor(x, p.day, u)) + '\n📰 Hoặc trong CRM: ' + CRM_URL + '/#bai-web');
}

/* ---------------------------------------------------------------- lịch (cron 10 phút / lần, 7h–22h) */
export async function blogTick(x) {
  if (!x.env.ANTHROPIC_API_KEY || !await cmsToken(x)) return;
  await schema(x.db);
  let raw; try { raw = await cfgRaw(x); } catch (e) { console.error('blog cfg', e.message); return; }
  const cfg = cfgOf(raw), now = Date.now(), today = fmtDate(now, 'yyyy-MM-dd'), h = new Date(now + TZ_MS).getUTCHours();
  // 1. bài đã duyệt tới giờ đăng → đăng
  for (const p of await all(x.db, "SELECT * FROM bl_posts WHERE status = 'approved' AND day <= ? ORDER BY day", today)) {
    if (p.day === today && h < cfg.hour) continue;
    try { await publish(x, p, false); } catch (e) { console.error('blog publish', e.message); await run(x.db, 'UPDATE bl_posts SET err = ? WHERE day = ?', String(e.message).slice(0, 300), p.day); }
  }
  // 2. tới giờ đăng mà chưa ai duyệt → nhắc 1 lần
  for (const p of await all(x.db, "SELECT * FROM bl_posts WHERE status = 'wait' AND remind = 0 AND day <= ?", today)) {
    if (p.day === today && h < cfg.hour) continue;
    await run(x.db, 'UPDATE bl_posts SET remind = 1 WHERE day = ?', p.day);
    await notifyApprovers(x, p, '⏰ <b>Bài web hôm nay chưa được duyệt nên chưa lên web.</b> Duyệt lúc nào bài lên lúc đó.');
  }
  // 3. viết lại theo ý kiến người duyệt (mỗi lần chạy tối đa 1 bài, vì 1 bài mất 2–5 phút)
  const rw = await first(x.db, "SELECT * FROM bl_posts WHERE status = 'rewrite' ORDER BY day LIMIT 1");
  if (rw) return write(x, cfg, rw.day, rw);
  const stuck = await first(x.db, "SELECT * FROM bl_posts WHERE status = 'writing' AND at < ? ORDER BY day LIMIT 1", now - 25 * 60e3); // lần viết trước bị ngắt giữa chừng
  if (stuck && stuck.tries < 3) return write(x, cfg, stuck.day, stuck);
  if (!cfg.on) return;
  // 4. viết nháp cho ngày đăng hôm nay (nếu vừa bật) và ngày mai
  for (const d of [today, addDays(today, 1)]) {
    if (!cfg.days.includes(wdOf(d)) || (d === today && h >= 20)) continue;
    const ex = await first(x.db, 'SELECT * FROM bl_posts WHERE day = ?', d);
    if (ex && !(ex.status === 'error' && ex.tries < 3 && now - ex.at > 30 * 60e3)) continue;
    return write(x, cfg, d, ex);
  }
}

/* ---------------------------------------------------------------- viết bài */
function pickFunnel(recent) {
  const n = { TOFU: 0, MOFU: 0, BOFU: 0 }; recent.forEach(r => { if (n[r.funnel] != null) n[r.funnel]++; });
  const tot = recent.length + 1;
  return Object.keys(MIX).sort((a, b) => (MIX[b] * tot - n[b]) - (MIX[a] * tot - n[a]))[0];
}
const funnelOf = s => (String(s || '').match(/TOFU|MOFU|BOFU/) || [''])[0];

async function write(x, cfg, day, row) {
  const now = Date.now();
  await run(x.db, `INSERT INTO bl_posts (day, status, at, tries) VALUES (?, 'writing', ?, 1)
    ON CONFLICT(day) DO UPDATE SET status = 'writing', at = excluded.at, tries = bl_posts.tries + 1, err = ''`, day, now);
  try {
    const hint = row && row.hint || '', newTopic = hint === '__new__', fb = newTopic ? '' : hint;
    const recent = await all(x.db, "SELECT day, title, funnel, tkey FROM bl_posts WHERE day != ? AND status IN ('published', 'approved', 'wait', 'rewrite', 'writing') ORDER BY day DESC LIMIT 12", day);
    // chủ đề: giữ nguyên khi viết lại; còn lại lấy chủ đề "Chờ viết" trên cùng chưa có bài nháp, không có thì tự chọn
    let topic = null;
    if (row && row.tkey && !newTopic) topic = cfg.topics.find(t => t.title === row.tkey) || { title: row.tkey };
    const skip = new Set([...recent.map(r => r.tkey), newTopic && row ? row.tkey : ''].filter(Boolean));
    if (!topic && !newTopic) topic = cfg.topics.find(t => (!t.status || t.status === 'Chờ viết') && t.title && !skip.has(t.title)) || null;
    if (!topic && newTopic) topic = cfg.topics.find(t => (!t.status || t.status === 'Chờ viết') && t.title && !skip.has(t.title)) || null;
    const funnel = funnelOf(topic && topic.funnel) || (row && !newTopic && row.funnel) || pickFunnel(recent);
    const [know, slugs, lib] = await Promise.all([kb(), postSlugs(x), imgLib()]);
    const prods = prodMap(know), imgs = lib.slice(0, 90);
    const keep = row && !newTopic && row.md ? row : null; // bản cũ khi viết lại
    let km = {}; try { km = JSON.parse(keep && keep.meta || '{}') || {}; } catch (e) { }
    // 🎯 nhóm khách: chủ đề có ghi nhóm → nhóm đó; viết lại → giữ nhóm cũ; còn lại xoay vòng nhóm ít được viết nhất (insight.js)
    // 🔑 trợ lý tự chọn chủ đề → lấy 1 từ khoá chưa viết trong ngân hàng 100 từ khoá (khoá K218); viết lại thì giữ từ khoá cũ
    const kw = topic ? null : km.kw ? { k: km.kw, g: km.g } : await kwPick(x, funnel).catch(() => null);
    const ip = await insPick(x, 'web', (topic && topic.group) || km.g || (kw && kw.g) || '', { prod: topic && topic.product || '' }); // chủ đề có sản phẩm → chỉ tension riêng của sản phẩm đó + tension dùng chung
    const ask = [
      'Viết 1 bài cho mục "Góc Sống Lành" trên website thucduonglanh.vn. Ngày đăng: ' + dayTxt(day) + '/' + day.slice(0, 4) + '.',
      'Tầng phễu: ' + FUNNEL[funnel].name + '. Mục tiêu: ' + FUNNEL[funnel].goal,
      topic ? 'CHỦ ĐỀ do nhân sự giao: ' + topic.title + (topic.note ? '\nGhi chú: ' + topic.note : '') + (topic.product ? '\nSản phẩm muốn nhắc: ' + topic.product : '')
        : 'Chưa có chủ đề được giao: TỰ CHỌN 1 chủ đề. Cách chọn: lấy 1 tension của nhóm khách mục tiêu bên dưới (chưa được viết gần đây), rồi đặt chủ đề giải đúng tension đó ở tầng phễu trên. Ưu tiên chủ đề người Việt đang tìm trên Google, gắn với thời điểm (mùa, ngày lễ, ngày sức khỏe thế giới trong tháng) nếu hợp.',
      kw ? '🔑 TỪ KHOÁ CHÍNH của bài (ngân hàng từ khoá theo insight): "' + kw.k + '". Chủ đề bài = trả lời đúng và đủ điều người gõ từ khoá này đang muốn biết (để Google và các trợ lý AI chọn bài làm câu trả lời: có đoạn trả lời thẳng ngay sau mở bài, có mục hỏi đáp). Tiêu đề, câu mở và 1 tiêu đề mục chứa từ khoá đúng cách người ta gõ, tự nhiên, không nhồi. Từ khoá chỉ để hiểu người đọc, KHÔNG vì thế mà hứa công dụng ngoài hồ sơ công bố.' : '',
      topic ? 'Chủ đề được giao vẫn phải đi qua bước insight: viết chủ đề này cho nhóm khách mục tiêu bên dưới, xoay quanh 1 tension của họ.' : '',
      insBlock(ip, funnel),
      cfg.audience ? 'GHI CHÚ THÊM VỀ TỆP KHÁCH (ô Tệp khách hàng ở /admin):\n' + cfg.audience : '',
      keep ? 'BẢN NHÁP TRƯỚC (viết lại bản này):\n' + keep.md.slice(0, 12000) : '',
      fb ? 'Ý KIẾN CỦA NGƯỜI DUYỆT (bắt buộc làm theo): ' + fb : '',
      recent.length ? 'Bài trợ lý viết gần đây (không lặp chủ đề):\n' + recent.map(r => '- ' + r.day + ' [' + r.funnel + '] ' + r.title).join('\n') : '',
      'Bài đã có trên web (không viết trùng; có thể dẫn link nội bộ tới 1–2 bài liên quan dạng ' + SITE + '/goc-song-lanh/<mã>/):\n' + slugs.join(', '),
      '',
      '# Cách viết',
      '- Tiếng Việt chuẩn, tự nhiên, ấm áp, rõ ràng như một chuyên viên dinh dưỡng viết cho người thường. Câu ngắn. Không giật tít, không hù dọa bệnh tật, không văn quảng cáo sáo rỗng.',
      '- Dài 900–1500 chữ. Mở bài 2–3 câu chạm đúng tình huống thật của người đọc. Chia 3–5 mục bằng tiêu đề "## ". Có danh sách gạch đầu dòng hoặc đánh số khi liệt kê.',
      '- Cuối bài có mục "## Hỏi đáp nhanh" gồm 3 câu hỏi in đậm (**…?**), mỗi câu trả lời 1–3 câu.',
      '- Số liệu, nghiên cứu, khuyến nghị của chuyên gia/tổ chức: PHẢI tìm trên mạng (công cụ web_search), ưu tiên nguồn uy tín tiếng Việt (Bộ Y tế, Viện Dinh dưỡng Quốc gia, bệnh viện lớn, báo chính thống) hoặc WHO. Ghi nguồn ngay trong câu dạng ([Tên nguồn](link)), link lấy đúng từ kết quả tìm kiếm. Không tìm được nguồn thì không nêu con số.',
      '- Thông tin sản phẩm, giá, thành phần, giấy tờ, chính sách CHỈ lấy từ TÀI LIỆU. Link sản phẩm dạng **[Tên sản phẩm](' + SITE + '/san-pham/<mã>/)** (web tự chèn khung mua nhanh theo link này). Không chèn ảnh trong bài.',
      '- Tuyệt đối không dùng các từ "chữa", "điều trị", "khỏi bệnh", "đặc trị", "thần dược", "thay thuốc". Không chẩn đoán, không kê đơn; với người đang điều trị bệnh, mang thai, cho con bú thì khuyên hỏi bác sĩ. Bài có nhắc sản phẩm thì dòng cuối cùng là: ' + DISCLAIMER,
      '- Không bịa khuyến mãi, câu chuyện khách hàng, đánh giá, số lượng đã bán.',
      '',
      imgs.length ? 'KHO ẢNH THẬT (số. mô tả) – chọn 1 ảnh bìa khớp rõ nhất với nội dung bài; không ảnh nào khớp thì ghi "không":\n' + imgs.map((i, n) => (n + 1) + '. ' + i.alt).join('\n') : '',
      '',
      'Trả về ĐÚNG định dạng sau (không thêm lời dẫn):\nTIÊU ĐỀ: <tiêu đề 50–80 ký tự, có từ khóa người đọc hay tìm>\nMÃ: <đường dẫn không dấu, chữ thường, nối bằng gạch ngang, tối đa 8 từ>\nMÔ TẢ: <1–2 câu, tối đa 160 ký tự, hiện khi chia sẻ Facebook/Zalo và trên Google>\nCHUYÊN MỤC: <một trong: ' + CATS.join(', ') + '>\nTẦNG PHỄU: <TOFU | MOFU | BOFU>\n' + INS_HEAD + '\nSẢN PHẨM: <mã sản phẩm chính nếu có, không thì "không">\nẢNH: <số ảnh hoặc "không">\n---\n<nội dung bài, Markdown, KHÔNG lặp lại tiêu đề>'
    ].filter(Boolean).join('\n');
    const system = [{ type: 'text', text: 'Bạn là biên tập viên nội dung của Thực Dưỡng Lành (VitaGreen Nutrition): thực phẩm dinh dưỡng từ hạt, trà thảo mộc, đồ chay. Bạn viết bài chuẩn SEO, đúng sự thật, đúng luật quảng cáo thực phẩm Việt Nam.' },
      { type: 'text', text: 'TÀI LIỆU (thông tin chính thức của Thực Dưỡng Lành):\n\n' + know, cache_control: { type: 'ephemeral' } }];
    const { text, urls } = await aiWrite(x.env, system, ask);
    const parts = text.split(/\n-{3,}\n/), head = parts.length > 1 ? parts[0] : '';
    const get = k => ((head.match(new RegExp(k + ':\\s*(.+)')) || [])[1] || '').trim();
    let body = insViet((parts.length > 1 ? parts.slice(1).join('\n---\n') : '').trim()); // ✍️ bỏ gạch ngang dài (khoá K131)
    const title = get('TIÊU ĐỀ').replace(/\*/g, '').slice(0, 120);
    if (!title || body.length < 1500) throw new Error('AI chưa viết được bài hoàn chỉnh');
    // kiểm tra tự động
    const checks = [];
    const dk = []; body = fixDisc(body).replace(DISC_RE, m => { dk.push(m); return '\u0000' + (dk.length - 1) + '\u0000'; }); // giữ nguyên câu miễn trừ
    const bad = [];
    body = body.replace(BAN_RE, (m, a, off, all) => { if (SAFE_BEFORE.test(all.slice(Math.max(0, off - 30), off))) return m; bad.push(m.toLowerCase()); return 'hỗ trợ'; });
    body = body.replace(/\u0000(\d+)\u0000/g, (m, i) => dk[+i]);
    if (bad.length) checks.push('⚠️ Đã thay từ cấm: ' + [...new Set(bad)].join(', ') + ' → kiểm tra lại câu có từ "hỗ trợ"');
    let dropped = 0;
    body = body.replace(/(!?)\[([^\]]+)\]\(([^)\s]+)\)/g, (m, img, t, u) => {
      if (img) { dropped++; return ''; } // không nhận ảnh trong bài (đường dẫn ảnh AI tự đặt dễ sai)
      const ok = u.startsWith(SITE) || urls.has(u.replace(/[#].*$/, '')) || [...urls].some(v => v.replace(/\/$/, '') === u.replace(/\/$/, ''));
      if (ok) return m; dropped++; return t;
    });
    if (dropped) checks.push('ℹ️ Đã bỏ ' + dropped + ' link/ảnh không có trong kết quả tìm kiếm (giữ lại chữ)');
    const sp = body.includes('/san-pham/');
    if (sp && !/không phải là thuốc/i.test(body)) body += '\n\n' + DISCLAIMER;
    const srcN = (body.match(/\]\(https?:\/\/(?!thucduonglanh\.vn)[^)]+\)/g) || []).length;
    checks.push(srcN ? '✅ ' + srcN + ' chỗ có dẫn nguồn' : 'ℹ️ Bài không dẫn nguồn ngoài (không có số liệu cần dẫn hoặc chưa tìm được nguồn)');
    checks.push('✅ Không có từ "chữa / điều trị / khỏi bệnh"' + (sp ? ', có dòng "không phải là thuốc"' : ''));
    const words = body.split(/\s+/).length; checks.push((words < 700 ? '⚠️ ' : '✅ ') + 'Dài khoảng ' + words + ' chữ');
    // mã bài (đường dẫn) không trùng bài đã có
    let slug = get('MÃ').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/đ/g, 'd').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').split('-').slice(0, 10).join('-') || 'bai-' + day;
    const taken = new Set(slugs); if (taken.has(slug)) slug += '-' + day.slice(5).replace('-', '');
    const code = get('SẢN PHẨM'), pick = imgs[Number(get('ẢNH')) - 1];
    const prodImg = prods[code] && prods[code].img;
    const cover = String(pick ? pick.url : prodImg || (imgs[0] && imgs[0].url) || '').replace(SITE, '');
    if (!pick) checks.push('⚠️ Ảnh bìa lấy tạm ' + (prodImg ? 'ảnh sản phẩm' : 'ảnh có sẵn') + ', nên đổi ảnh khác trong /admin');
    else checks.push('ℹ️ Ảnh bìa lấy từ kho ảnh đã dùng trên web' + (pick.bai ? ' (bài "' + pick.bai.slice(0, 60) + '")' : '') + ', đổi được trong /admin');
    const cat = CATS.includes(get('CHUYÊN MỤC')) ? get('CHUYÊN MỤC') : CATS[0];
    const excerpt = get('MÔ TẢ').slice(0, 200), f2 = funnelOf(get('TẦNG PHỄU')) || funnel;
    const q = s => JSON.stringify(String(s)); // chuỗi YAML an toàn (có dấu : vẫn đúng)
    const md = ['---', 'title: ' + q(title), 'date: ' + day, 'category: ' + cat, 'image: ' + cover, 'excerpt: ' + q(excerpt), 'published: true', '---', '', body, ''].join('\n');
    const ins = insParse(head, ip.bank, ip.g), rw = insRisk(body), rv = insStyle(body); if (ip.angle) ins.a = ip.angle;
    if (rv.length) checks.push('✍️ Văn còn giống AI: ' + rv.join(', ') + ' → sửa cho liền mạch, dùng dấu phẩy');
    if (rw.length) checks.push('⚠️ Đọc lại: ' + rw.join(', ') + ' → cụm dễ phạm luật quảng cáo chỉ giữ nếu đúng hồ sơ công bố hoặc là câu phủ định; hotline cũ 0896 869 333 đổi thành 0966 326 522');
    const m = { excerpt, cat, cover, who: ins.gn, g: ins.g, is: ins.is, t: ins.t, i: ins.i, d: ins.d, a: ins.a, b: ip.big ? ip.big.t : '', kw: kw ? kw.k : '', w: rw, v: rv, checks, hour: cfg.hour, sources: [...urls].slice(0, 30), fb };
    if (!ins.t) checks.push('⚠️ Trợ lý chưa ghi rõ tension bài này giải, nên đọc kỹ xem bài có chạm đúng nỗi lòng của nhóm khách không');
    if (kw) { checks.unshift('🔑 Từ khoá chính: ' + kw.k); await kwUse(x, kw.k, day).catch(() => { }); }
    await run(x.db, "UPDATE bl_posts SET status = 'wait', title = ?, slug = ?, funnel = ?, topic = ?, tkey = ?, md = ?, meta = ?, hint = '', at = ?, err = '', tries = 0, remind = 0 WHERE day = ?",
      title, slug, f2, topic ? topic.title : 'Trợ lý tự chọn', topic ? topic.title : '', md, JSON.stringify(m), Date.now(), day);
    await insLog(x, 'web', { g: ins.g, gn: ins.gn, f: f2, t: ins.t, ref: day, sp: prods[code] ? code : '', a: ins.a, b: ip.big ? ip.big.t : '' });
    const p = await first(x.db, 'SELECT * FROM bl_posts WHERE day = ?', day);
    await notifyApprovers(x, p, (row && row.md ? '✍️ <b>Bài web đã viết lại, chờ duyệt</b>' : '📝 <b>Bài web mới chờ duyệt</b>') + (topic ? ' · chủ đề được giao' : ' · trợ lý tự chọn chủ đề'));
    return { day, title };
  } catch (e) {
    console.error('blog write', e.message);
    const r = await first(x.db, 'SELECT tries FROM bl_posts WHERE day = ?', day);
    await run(x.db, "UPDATE bl_posts SET status = ?, err = ?, at = ? WHERE day = ?", row && row.md ? 'wait' : 'error', String(e.message).slice(0, 300), Date.now(), day);
    if (row && row.md) await telegram(x.env, '⚠️ <b>Trợ lý viết bài web</b> chưa viết lại được bài ' + esc(row.title) + ' (' + esc(String(e.message).slice(0, 150)) + '). Bản cũ vẫn chờ duyệt, link duyệt cũ vẫn dùng được.');
    else if (r && r.tries >= 3) await telegram(x.env, '⚠️ <b>Trợ lý viết bài web</b> không viết được bài đăng ' + dayTxt(day) + ' sau 3 lần thử: ' + esc(String(e.message).slice(0, 200)));
  }
}

/** Gọi Claude có công cụ tìm kiếm trên mạng. Trả chữ + danh sách link đã tìm được (để chỉ giữ link có thật). */
async function aiWrite(env, system, ask) {
  const client = new Anthropic({ apiKey: env.ANTHROPIC_API_KEY, maxRetries: 1, timeout: 9 * 60e3, fetch: aiFetch(env), defaultHeaders: { 'x-tdl-muc': 'web-bai' } });
  const messages = [{ role: 'user', content: ask }], urls = new Set(); let text = '';
  for (let i = 0; i < 4; i++) {
    const res = await client.messages.create({ model: MODEL, max_tokens: 12000, system, messages, tools: [{ type: 'web_search_20250305', name: 'web_search', max_uses: 6 }] });
    for (const b of res.content || []) {
      if (b.type === 'text') text += b.text;
      if (b.type === 'web_search_tool_result' && Array.isArray(b.content)) for (const r of b.content) if (r.url) urls.add(r.url);
    }
    if (res.stop_reason === 'refusal') throw new Error('AI từ chối viết bài này');
    if (res.stop_reason !== 'pause_turn') break; // pause_turn: tìm kiếm lâu, gửi lại để AI viết tiếp
    messages.push({ role: 'assistant', content: res.content });
  }
  return { text: text.trim(), urls };
}

/* ---------------------------------------------------------------- đăng lên web */
async function publish(x, p, hidden) {
  const today = fmtDate(Date.now(), 'yyyy-MM-dd'), day = p.day < today ? today : p.day; // duyệt muộn → ngày đăng là hôm nay
  let slug = p.slug;
  const md = fixDisc(p.md).replace(/^date: .*$/m, 'date: ' + day).replace(/^published: .*$/m, 'published: ' + (hidden ? 'false' : 'true'));
  await ghCommit(x, async () => {
    const slugs = new Set(await postSlugs(x)); if (slugs.has(slug)) slug = p.slug + '-' + day.slice(5).replace('-', '');
    const files = { [POSTS_DIR + '/' + slug + '.md']: md };
    if (p.tkey) { // chủ đề ở /admin → "Đã đăng" + link
      const raw = await cfgRaw(x), t = (raw.topics || []).find(y => y.title === p.tkey);
      if (t) { t.status = 'Đã đăng'; t.link = SITE + '/goc-song-lanh/' + slug + '/'; files[CFG_PATH] = JSON.stringify(raw, null, 2) + '\n'; }
    }
    return files;
  }, '🤖 Trợ lý viết bài: ' + p.title + (p.by_name ? ' (duyệt: ' + p.by_name + ')' : ''));
  const url = SITE + '/goc-song-lanh/' + slug + '/';
  await run(x.db, "UPDATE bl_posts SET status = 'published', slug = ?, url = ?, pub_at = ?, hidden = ?, err = '' WHERE day = ?", slug, url, Date.now(), hidden ? 1 : 0, p.day);
  await telegram(x.env, hidden
    ? '🖊 <b>Bài web đã vào /admin (đang ẩn)</b> để ' + esc(p.by_name) + ' tự sửa: ' + esc(p.title) + '\n👉 Sửa xong bật "Hiển thị trên web" rồi bấm Xuất bản: ' + SITE + '/admin/#/collections/posts/entries/' + slug
    : '✅ <b>Bài mới lên web</b> (chờ 1–2 phút): ' + esc(p.title) + '\n' + url + (p.by_name ? '\n👤 Duyệt: ' + esc(p.by_name) : ''));
  return url;
}

/* ---------------------------------------------------------------- trang duyệt bài /bai/<ngày> */
export async function blogRoute(x, req, path, url) {
  const m = path.match(/^\/bai\/(\d{4}-\d{2}-\d{2})$/); if (!m) return null;
  await schema(x.db);
  const day = m[1], uh = url.searchParams.get('u') || '', k = url.searchParams.get('k') || '';
  const u = await whoOf(x, day, uh, k);
  if (!u) return page('Link không dùng được', '<p>Link duyệt bài đã hết hiệu lực, hoặc bạn không còn quyền duyệt bài. Quyền duyệt: Quản trị, Quản lý, hoặc người được bật “Sửa website” ở CRM → Cài đặt → Nhân sự.</p>', 403);
  let p = await first(x.db, 'SELECT * FROM bl_posts WHERE day = ?', day);
  if (!p) return page('Không có bài', '<p>Chưa có bài cho ngày này.</p>', 404);
  let note = '';
  if (req.method === 'POST') {
    const f = await req.formData(), act = String(f.get('act') || ''), at = Number(f.get('at') || 0), hint = String(f.get('hint') || '').trim().slice(0, 1500);
    note = await doAct(x, u, p, act, at, hint);
    p = await first(x.db, 'SELECT * FROM bl_posts WHERE day = ?', day);
  }
  return page(p.title || 'Bài web', view(p, note));
}
/** Việc của người duyệt (trang /bai và tab 📰 Bài web trong CRM): ok | rewrite | new | admin | skip. Trả lời nhắn (HTML ngắn). */
async function doAct(x, u, p, act, at, hint) {
  const day = p.day; let note = '';
  if (p.status !== 'wait' && p.status !== 'approved' && p.status !== 'error') note = 'Bài đang ở trạng thái “' + stName(p) + '”, chưa làm được việc này.';
  else if (at !== p.at) note = 'Bài vừa được viết lại hoặc có người khác vừa xử lý. Đây là bản mới nhất, bạn xem lại nhé.';
  else if (act === 'ok') {
    await run(x.db, "UPDATE bl_posts SET status = 'approved', by_name = ? WHERE day = ?", u.name, day);
    const cfg = cfgOf(await cfgRaw(x).catch(() => ({}))), now = Date.now(), today = fmtDate(now, 'yyyy-MM-dd');
    const late = day < today || (day === today && new Date(now + TZ_MS).getUTCHours() >= cfg.hour);
    if (late) { p = await first(x.db, 'SELECT * FROM bl_posts WHERE day = ?', day); try { await publish(x, p, false); note = '✅ Đã đăng. Khoảng 1–2 phút nữa bài có trên web.'; } catch (e) { note = '✅ Đã duyệt. Đăng lên chưa được (' + esc(e.message) + '), máy chủ sẽ tự thử lại trong 10 phút.'; } }
    else note = '✅ Đã duyệt. Bài tự lên web lúc ' + cfg.hour + 'h ' + dayTxt(day) + '.';
    await telegram(x.env, '👍 ' + esc(u.name) + ' đã duyệt bài web: ' + esc(p.title));
    await logIt(x, u, 'Duyệt bài web', p.title);
  } else if (act === 'rewrite' || act === 'new') {
    if (act === 'rewrite' && !hint) note = 'Bạn ghi ý kiến cần sửa vào ô bên dưới rồi bấm lại nhé.';
    else {
      await run(x.db, "UPDATE bl_posts SET status = 'rewrite', hint = ?, by_name = ? WHERE day = ?", act === 'new' ? '__new__' : hint, u.name, day);
      note = '✍️ Đã nhận. Trợ lý sẽ ' + (act === 'new' ? 'viết bài chủ đề khác' : 'viết lại theo ý kiến của bạn') + ' trong khoảng 10–20 phút rồi nhắn Telegram cho bạn.';
      await logIt(x, u, act === 'new' ? 'Đổi chủ đề bài web' : 'Yêu cầu viết lại bài web', p.title + (hint ? ' – ' + hint : ''));
    }
  } else if (act === 'admin') {
    await run(x.db, 'UPDATE bl_posts SET by_name = ? WHERE day = ?', u.name, day); p.by_name = u.name;
    try { const slug = (await publish(x, p, true)).split('/').slice(-2)[0]; note = '🖊 Bài đã vào /admin ở dạng ẩn. <a href="' + SITE + '/admin/#/collections/posts/entries/' + slug + '">Mở /admin để sửa</a>, sửa xong bật “Hiển thị trên web” rồi bấm Xuất bản.'; }
    catch (e) { note = 'Chưa đưa được bài vào /admin: ' + esc(e.message); }
    await logIt(x, u, 'Tự sửa bài web trong /admin', p.title);
  } else if (act === 'skip') {
    await run(x.db, "UPDATE bl_posts SET status = 'dropped', by_name = ? WHERE day = ?", u.name, day);
    note = '❌ Đã bỏ bài này. ' + dayTxt(day) + ' không đăng bài.';
    await logIt(x, u, 'Bỏ bài web', p.title);
  }
  return note;
}
async function logIt(x, u, what, note) { try { await crmLog(x, u, 'Bài web', '-', '', what, String(note).slice(0, 300)); } catch (e) { } }
function stName(p) { return { writing: 'Đang viết', wait: 'Chờ duyệt', rewrite: 'Đang viết lại', approved: 'Đã duyệt, chờ tới giờ đăng', published: p.hidden ? 'Đã vào /admin (đang ẩn)' : 'Đã đăng', dropped: 'Đã bỏ', error: 'Viết lỗi' }[p.status] || p.status; }

function view(p, note) {
  const m = meta(p), body = fixDisc(p.md).replace(/^---[\s\S]*?\n---\n/, '');
  const can = p.status === 'wait' || p.status === 'error' && p.md;
  const st = '<p class="st">' + stName(p) + (p.by_name && p.status !== 'wait' ? ' · ' + esc(p.by_name) : '') + (p.url && p.status === 'published' && !p.hidden ? ' · <a href="' + esc(p.url) + '">Xem bài trên web</a>' : '') + '</p>';
  const form = can ? `<form method="post" class="acts"><input type="hidden" name="at" value="${p.at}">
<button name="act" value="ok" class="b ok">✅ Đăng bài này</button>
<p class="hint">Bài lên web lúc ${m.hour || 9}h ${dayTxt(p.day)}. Duyệt muộn hơn thì bài lên ngay.</p>
<label for="hint">Cần sửa gì? Ghi ý kiến cho trợ lý:</label>
<textarea id="hint" name="hint" rows="3" placeholder="Ví dụ: mở bài ngắn lại, thêm ví dụ bữa sáng cho dân văn phòng, bỏ đoạn về giá…"></textarea>
<button name="act" value="rewrite" class="b">✍️ Viết lại theo ý kiến</button>
<button name="act" value="admin" class="b">🖊 Tôi tự sửa trong /admin</button>
<button name="act" value="new" class="b">🔁 Đổi chủ đề khác</button>
<button name="act" value="skip" class="b no" onclick="return confirm('Bỏ bài này? Ngày này sẽ không đăng bài.')">❌ Bỏ, ngày này không đăng</button></form>` : '';
  return (note ? '<div class="note">' + note + '</div>' : '') + st +
    '<div class="info"><b>' + (FUNNEL[p.funnel] ? FUNNEL[p.funnel].name : '') + '</b>' + (m.who ? ' · ' + esc(m.who) : '') + '<br>Chủ đề: ' + esc(p.topic) + '<br>📅 Ngày đăng: ' + dayTxt(p.day) + (m.fb ? '<br>Ý kiến lần trước: ' + esc(m.fb) : '') + '</div>' +
    '<details class="chk" open><summary>Trợ lý tự kiểm tra</summary><ul>' + (m.checks || []).map(c => '<li>' + esc(c) + '</li>').join('') + '</ul></details>' +
    form + '<article><p class="ex">' + esc(m.excerpt || '') + '</p>' + (m.cover ? '<img class="cv" src="' + esc(SITE + m.cover) + '" alt="">' : '') + '<h1>' + esc(p.title) + '</h1>' + mdHtml(body) + '</article>' +
    (p.err ? '<p class="err">Lỗi gần nhất: ' + esc(p.err) + '</p>' : '');
}

/** Markdown → HTML gọn để xem trước (web thật build bằng build.py). */
function mdHtml(s) {
  const href = u => /^https?:\/\//.test(u) ? u : u.startsWith('/') ? SITE + u : '#';
  const inl = t => esc(t).replace(/\[([^\]]+)\]\(([^)\s]+)\)/g, (m, a, u) => '<a href="' + href(u.replace(/&amp;/g, '&')).replace(/"/g, '') + '" target="_blank" rel="noopener">' + a + '</a>')
    .replace(/\*\*([^*]+)\*\*/g, '<b>$1</b>').replace(/(^|[^*\w])\*([^*\n]+)\*/g, '$1<i>$2</i>');
  let out = '', list = '', para = [];
  const flush = () => { if (para.length) { out += '<p>' + inl(para.join(' ')) + '</p>'; para = []; } if (list) { out += '</' + list + '>'; list = ''; } };
  for (const line of String(s).split('\n')) {
    const l = line.trim(), h = l.match(/^(#{2,4})\s+(.*)/), ul = l.match(/^[-*]\s+(.*)/), ol = l.match(/^\d+[.)]\s+(.*)/);
    if (!l) { flush(); continue; }
    if (h) { flush(); out += '<h' + h[1].length + '>' + inl(h[2]) + '</h' + h[1].length + '>'; continue; }
    if (ul || ol) { if (para.length) { out += '<p>' + inl(para.join(' ')) + '</p>'; para = []; } const t = ul ? 'ul' : 'ol'; if (list !== t) { if (list) out += '</' + list + '>'; out += '<' + t + '>'; list = t; } out += '<li>' + inl((ul || ol)[1]) + '</li>'; continue; }
    if (l.startsWith('>')) { flush(); out += '<blockquote>' + inl(l.replace(/^>\s?/, '')) + '</blockquote>'; continue; }
    if (list) { out += '</' + list + '>'; list = ''; }
    para.push(l);
  }
  flush(); return out;
}

function page(title, html, status) {
  return new Response(`<!doctype html><html lang="vi"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex">
<title>${esc(title)} · Duyệt bài web</title><style>
:root{--g:#24805B;--t:#262A1F;--m:#5d6158;--bg:#F7F8F4;--line:#E2E6DE}
*{box-sizing:border-box}body{margin:0;background:var(--bg);color:var(--t);font:17px/1.6 -apple-system,system-ui,"Segoe UI",Roboto,sans-serif}
main{max-width:720px;margin:0 auto;padding:16px}a{color:var(--g)}
.top{font-size:14px;color:var(--m);margin:4px 0 12px}.st{font-weight:600;margin:0 0 10px}
.note{background:#EAF4EF;border:1px solid #bfdccd;border-radius:12px;padding:12px 14px;margin:0 0 14px}
.info,.chk{background:#fff;border:1px solid var(--line);border-radius:12px;padding:12px 14px;margin:0 0 12px;font-size:15px}
.chk ul{margin:6px 0 0;padding-left:20px}.chk summary{font-weight:600;cursor:pointer}
.acts{background:#fff;border:1px solid var(--line);border-radius:12px;padding:14px;margin:0 0 16px;display:flex;flex-direction:column;gap:10px}
.b{font:inherit;font-weight:600;padding:13px 14px;border-radius:12px;border:1px solid var(--line);background:#fff;color:var(--t);cursor:pointer;text-align:left}
.b.ok{background:var(--g);border-color:var(--g);color:#fff;text-align:center;font-size:18px}.b.no{color:#B5523B}
.hint{margin:-4px 0 4px;font-size:14px;color:var(--m)}label{font-size:15px;font-weight:600;margin-top:6px}
textarea{font:inherit;font-size:16px;width:100%;padding:10px;border:1px solid var(--line);border-radius:10px}
article{background:#fff;border:1px solid var(--line);border-radius:12px;padding:16px 18px}
article h1{font-size:26px;line-height:1.3;margin:12px 0}article h2{font-size:21px;margin:26px 0 8px}article h3{font-size:18px}
.cv{width:100%;border-radius:10px;display:block}.ex{color:var(--m);font-size:15px;margin:0 0 10px}
blockquote{margin:12px 0;padding:6px 14px;border-left:3px solid var(--g);color:var(--m)}.err{color:#B5523B;font-size:14px}
</style></head><body><main><p class="top">🤖 Trợ lý viết bài · Góc Sống Lành · thucduonglanh.vn</p>${html}</main></body></html>`,
    { status: status || 200, headers: { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store', 'Referrer-Policy': 'no-referrer' } });
}

/* ---------------------------------------------------------------- CRM → tab 📰 Bài web (cùng chỗ với Trợ lý Zalo, Fanpage) */
export function canBlog(u) { return !!u && u.active && (u.level >= 2 || !!u.web); }
const TOPIC_ST = ['Chờ viết', 'Đã đăng', 'Bỏ qua'], TOPIC_FN = ['Tự chọn', 'TOFU – Nhận biết', 'MOFU – Cân nhắc', 'BOFU – Mua hàng'];
const cut = (s, n) => String(s == null ? '' : s).trim().slice(0, n);
export async function crmBlog(x, u, d) {
  if (!canBlog(u)) return { ok: false, error: 'Bạn chưa có quyền duyệt bài web. Nhờ Quản trị bật “Sửa website” cho bạn ở Cài đặt → Nhân sự.' };
  await schema(x.db);
  const a = d.action, now = Date.now();
  if (a === 'bl_view') {
    let raw = null, cerr = ''; try { raw = await cfgRaw(x); } catch (e) { cerr = e.message; }
    const cfg = raw ? cfgOf(raw) : null, today = fmtDate(now, 'yyyy-MM-dd'), next = [];
    if (cfg) for (let i = 0; i < 15; i++) { const dd = addDays(today, i); if (cfg.days.includes(wdOf(dd))) next.push(dd); }
    const posts = (await all(x.db, 'SELECT day, status, title, slug, funnel, topic, meta, by_name, at, pub_at, url, err, hidden, tries FROM bl_posts ORDER BY day DESC LIMIT 60')).map(r => Object.assign(r, { meta: meta(r), st: stName(r) }));
    return { ok: true, now, today, next, posts, cerr, aiOn: !!x.env.ANTHROPIC_API_KEY, gh: !!await cmsToken(x),
      cfg: cfg && { on: cfg.on, per_week: cfg.per, hour: cfg.hour, audience: cfg.audience, topics: cfg.topics },
      approvers: (await approvers(x)).map(y => ({ name: y.name, tg: !!y.tg })), insG: (await insBank(x)).map(g => ({ id: g.id, name: g.name, on: g.on })), dayNames: Object.fromEntries(Object.entries(DAYS).map(([k, v]) => [k, v.map(i => WD[i]).join(', ')])) };
  }
  if (a === 'bl_post') { // xem trước bài đầy đủ
    const p = await first(x.db, 'SELECT * FROM bl_posts WHERE day = ?', String(d.day || ''));
    if (!p || !p.md) return { ok: false, error: 'Chưa có nội dung bài cho ngày này.' };
    return { ok: true, day: p.day, title: p.title, at: p.at, status: p.status, html: mdHtml(fixDisc(p.md).replace(/^---[\s\S]*?\n---\n/, '')), meta: meta(p) };
  }
  if (a === 'bl_act') {
    const p = await first(x.db, 'SELECT * FROM bl_posts WHERE day = ?', String(d.day || ''));
    if (!p) return { ok: false, error: 'Không thấy bài này, tải lại trang nhé.' };
    const note = await doAct(x, u, p, String(d.act || ''), Number(d.at) || 0, cut(d.hint, 1500));
    const q = await first(x.db, 'SELECT status, slug FROM bl_posts WHERE day = ?', p.day);
    return { ok: true, note: note.replace(/<[^>]+>/g, ''), status: q && q.status, admin: q && q.status === 'published' && d.act === 'admin' ? SITE + '/admin/#/collections/posts/entries/' + q.slug : '' };
  }
  if (a === 'bl_cfg') { // lưu vào data/blog-auto.json (cùng file /admin sửa) → 1 commit
    const patch = {};
    if (d.on !== undefined) patch.on = !!d.on;
    if (d.per_week !== undefined) patch.per_week = Math.min(7, Math.max(1, Math.round(Number(d.per_week) || 3)));
    if (d.hour !== undefined) patch.hour = Math.min(21, Math.max(7, Math.round(Number(d.hour) || 9)));
    if (d.audience !== undefined) patch.audience = cut(d.audience, 8000);
    const topics = Array.isArray(d.topics) ? d.topics.slice(0, 150).map(t => ({ title: cut(t.title, 200), note: cut(t.note, 1500), funnel: TOPIC_FN.includes(t.funnel) ? t.funnel : 'Tự chọn', group: cut(t.group, 80), product: cut(t.product, 80), status: TOPIC_ST.includes(t.status) ? t.status : 'Chờ viết', link: cut(t.link, 300) })).filter(t => t.title) : null;
    await ghCommit(x, async () => {
      const raw = await cfgRaw(x); Object.assign(raw, patch);
      if (topics) { // trợ lý có thể vừa đổi chủ đề sang "Đã đăng" sau lúc CRM tải → giữ trạng thái đó
        const old = {}; (raw.topics || []).forEach(t => { old[t.title] = t; });
        raw.topics = topics.map(t => old[t.title] && old[t.title].status === 'Đã đăng' && !t.link ? Object.assign(t, { status: 'Đã đăng', link: old[t.title].link || '' }) : t);
      }
      return { [CFG_PATH]: JSON.stringify(raw, null, 2) + '\n' };
    }, '🤖 Trợ lý viết bài: ' + u.name + ' sửa ' + (topics ? 'chủ đề' : 'cài đặt') + ' (CRM)');
    await logIt(x, u, topics ? 'Sửa chủ đề bài web' : 'Sửa cài đặt trợ lý viết bài', JSON.stringify(patch).slice(0, 200));
    return { ok: true };
  }
  if (a === 'bl_stats') return Object.assign({ ok: true }, await blogStats(x, [7, 30, 90].includes(Number(d.days)) ? Number(d.days) : 30));
  return { ok: false, error: 'Không rõ thao tác.' };
}

/* ---------------------------------------------------------------- 📊 hiệu quả bài viết */
/** Đơn web có kèm bài khách đọc gần nhất (main.js: localStorage tdl_post, 7 ngày) → bl_conv. */
export async function blogConv(x, data) {
  const slug = String(data.post || '').toLowerCase(); if (!/^[a-z0-9-]{3,120}$/.test(slug) || !data.id) return;
  await schema(x.db);
  await run(x.db, 'INSERT OR IGNORE INTO bl_conv (oid, slug, at, total) VALUES (?, ?, ?, ?)', String(data.id), slug, Date.now(), Math.round(Number(data.total) || 0));
}
/** Lượt xem từng bài từ GA4 (chỉ người bấm Đồng ý cookie), lưu tạm 3 tiếng. Chưa nối GA4 (tab Tổng quan) → null + lý do. */
async function gaPosts(x, days) {
  const ck = 'bl_ga_' + days, c = await kvGet(x.db, ck); if (c) { try { return JSON.parse(c); } catch (e) { } }
  const prop = await kvGet(x.db, 'ga_prop'); if (!prop) return { err: 'Chưa nối Google Analytics (Quản trị nối ở tab Tổng quan → khối Website).' };
  let tok; try { tok = (await gInfo(x.env)).token; } catch (e) { return { err: 'Chưa lấy được quyền đọc Google Analytics: ' + String(e.message).slice(0, 120) }; }
  const range = [{ startDate: days + 'daysAgo', endDate: 'today' }], path = { filter: { fieldName: 'pagePath', stringFilter: { matchType: 'BEGINS_WITH', value: '/goc-song-lanh/' } } };
  const body = { requests: [
    { dateRanges: range, dimensions: [{ name: 'pagePath' }], metrics: [{ name: 'screenPageViews' }, { name: 'activeUsers' }, { name: 'userEngagementDuration' }], dimensionFilter: path, limit: 500 },
    { dateRanges: range, dimensions: [{ name: 'pagePath' }, { name: 'eventName' }], metrics: [{ name: 'eventCount' }], limit: 1000,
      dimensionFilter: { andGroup: { expressions: [path, { filter: { fieldName: 'eventName', inListFilter: { values: ['add_to_cart', 'cta_click'] } } }] } } }] };
  const r = await fetch('https://analyticsdata.googleapis.com/v1beta/properties/' + prop + ':batchRunReports', { method: 'POST', headers: { Authorization: 'Bearer ' + tok, 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) return { err: 'Google Analytics báo lỗi: ' + String((j.error && j.error.message) || r.status).slice(0, 150) };
  const rows = k => ((j.reports || [])[k] || {}).rows || [], out = {};
  const slugOf = p => (String(p).match(/^\/goc-song-lanh\/([a-z0-9-]+)\/?$/) || [])[1];
  for (const w of rows(0)) { const s = slugOf(w.dimensionValues[0].value); if (!s || s === 'chuyen-muc') continue; const o = out[s] || (out[s] = { v: 0, u: 0, sec: 0, cart: 0, cta: 0 }); o.v += +w.metricValues[0].value || 0; o.u += +w.metricValues[1].value || 0; o.sec += +w.metricValues[2].value || 0; }
  for (const w of rows(1)) { const s = slugOf(w.dimensionValues[0].value); if (!s || !out[s]) continue; if (w.dimensionValues[1].value === 'add_to_cart') out[s].cart += +w.metricValues[0].value || 0; else out[s].cta += +w.metricValues[0].value || 0; }
  const res = { pages: out, at: Date.now() }; await kvSet(x.db, ck, JSON.stringify(res), 3 * 3600e3); return res;
}
async function blogStats(x, days) {
  const now = Date.now(), since = now - days * DAY;
  const mine = await all(x.db, "SELECT day, title, slug, funnel, url, pub_at FROM bl_posts WHERE status = 'published' AND hidden = 0 ORDER BY day DESC LIMIT 200");
  const conv = await all(x.db, 'SELECT c.slug, c.total, o.status FROM bl_conv c LEFT JOIN orders o ON o.id = c.oid WHERE c.at >= ?', since);
  const ord = {}; for (const c of conv) { if (/huỷ|hủy|hoàn/i.test(String(c.status || ''))) continue; const o = ord[c.slug] || (ord[c.slug] = { n: 0, rev: 0 }); o.n++; o.rev += c.total || 0; }
  const ga = await gaPosts(x, days);
  const cost = await first(x.db, "SELECT sum(usd) AS usd, sum(n) AS n FROM ai_usage WHERE muc = 'web-bai' AND day >= ?", fmtDate(since, 'yyyyMMdd')).catch(() => null);
  const rate = Number(await kvGet(x.db, 'ai_rate')) || 26500;
  const ai = new Set(mine.map(p => p.slug)), pages = (ga && ga.pages) || {}, slugs = new Set([...Object.keys(pages), ...Object.keys(ord), ...mine.map(p => p.slug)]);
  const title = {}; try { for (const m of String(await kb()).matchAll(/\[([^\]]+)\]\(https:\/\/thucduonglanh\.vn\/goc-song-lanh\/([a-z0-9-]+)\/\)/g)) title[m[2]] = m[1]; } catch (e) { } // tên bài viết người viết tay
  mine.forEach(p => { title[p.slug] = p.title; });
  const list = [...slugs].map(s => { const g = pages[s] || {}, o = ord[s] || {}, m = mine.find(p => p.slug === s); return { slug: s, title: title[s] || '', ai: ai.has(s), funnel: m ? m.funnel : '', day: m ? m.day : '', v: g.v || 0, u: g.u || 0, sec: g.u ? Math.round(g.sec / g.u) : 0, cart: g.cart || 0, cta: g.cta || 0, n: o.n || 0, rev: o.rev || 0 }; });
  return { days, list, gaErr: ga && ga.err || '', gaAt: ga && ga.at || 0, published: mine.filter(p => (p.pub_at || 0) >= since).length, costVnd: Math.round(((cost && cost.usd) || 0) * rate) };
}
