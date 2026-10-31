/* ================================================================ 📘 Trợ lý Fanpage Facebook (26/10/2026, anh Sơn chọn hướng B: tự làm trên hệ thống, dùng chung bộ não An Lành)
 * 1 ứng dụng Meta (App ID + App Secret, Quản trị dán ở CRM → tab 📘 Fanpage, lưu kv fp_app) nối được nhiều fanpage (bảng fp_pages, mỗi trang 1 mã truy cập + cài đặt riêng).
 * Đường đi của khách:
 *   bình luận bài đăng / quảng cáo → webhook feed → thích + trả lời công khai (đổi câu) + 1 tin nhắn riêng (private reply: Facebook chỉ cho 1 tin / bình luận)
 *   → khách bấm "🎁 Nhận quà" hoặc nhắn lại → mở 24 giờ: An Lành trả lời (kiến thức chat-kb.txt như trên web), xin số Zalo (nút 1 chạm user_phone_number)
 *   → có số: khách hỏi kênh "Facebook" + Telegram + gửi quà (cẩm nang, mã SONGLANH5) + link nhóm Zalo; trợ lý Zalo tìm theo số để tự duyệt vào nhóm (zbot.js)
 *   → chưa để số: nhắc 1 lần sau 3 tiếng (vẫn trong 24 giờ Facebook cho phép), chỉ 8h–21h.
 *   Nhân sự trả lời tay trong hộp thư fanpage → bot im với khách đó 12 tiếng (tin "echo" không mang app_id của ứng dụng mình).
 *   Bình luận có số điện thoại → ẩn bình luận (bảo vệ thông tin khách, Luật 91/2025) + ghi khách hỏi luôn.
 * Bài đăng: cron (fpTick) soạn trước bằng AI cho từng trang (giọng / đối tượng riêng) → nhân sự duyệt ở CRM → tới giờ đăng lên trang (kèm link sản phẩm có UTM).
 * Webhook: https://api.thucduonglanh.vn/fb/hook (mã xác minh tự tạo, xem ở CRM). Kết nối trang: nút "Kết nối fanpage" (đăng nhập Facebook, /fb/cb) hoặc dán mã truy cập trang.
 * Luật Facebook: chỉ nhắn trong 24 giờ kể từ tin cuối của khách; quá 24 giờ bot không nhắn (chăm sóc tiếp qua Zalo / CRM). */
import Anthropic from '@anthropic-ai/sdk';
import { aiFetch } from './airelay.js';
import { esc, run, all, first, kvGet, kvSet, kvDel, kvJson, normPhone, nrm, fmtDate, randHex, CRM_URL, TZ_MS, DAY } from './lib.js';
import { telegram } from './google.js';
import { addLead, telegramUser } from './crm.js';
import { kb, safe, workNow, TRUTH_RULES, REF_RULES, REF_TXT, PHONE_RE } from './chat.js';
import { botRef } from './partner.js';
import { prodMap, zbotLead } from './zbot.js';

let GRAPH = 'https://graph.facebook.com/v23.0/';
const useEnv = x => { if (x.env.FB_GRAPH) GRAPH = x.env.FB_GRAPH; }; // chạy thử trên máy: wrangler dev đặt FB_GRAPH = Facebook giả
const HOOK_URL = 'https://api.thucduonglanh.vn/fb/hook', CB_URL = 'https://api.thucduonglanh.vn/fb/cb';
const SCOPES = 'pages_show_list,pages_messaging,pages_manage_metadata,pages_read_engagement,pages_read_user_content,pages_manage_engagement,pages_manage_posts,business_management';
const FIELDS = 'feed,messages,messaging_postbacks,message_echoes';
const PERMS = ['pages_messaging', 'pages_manage_metadata', 'pages_read_engagement', 'pages_read_user_content', 'pages_manage_engagement', 'pages_manage_posts']; // quyền bot cần (kiểm tra khi dán mã)
const FAST = 'claude-haiku-5-5', WRITER = 'claude-opus-5-5';
const BOT = 'An Lành';
const CAMNANG = 'https://camnangsongkhoe.thucduonglanh.vn/?ma=fb', ZALO_GROUP = 'https://zalo.me/g/tvepjg478'; // trùng data/site.json (camnang.reader, zalo_group)
const PCFG0 = {
  reply: true, like: true, dm: true, hide: true, ai: true, nudge: true,
  kw: '', // từ khoá (cách nhau dấu phẩy): trống = trả lời mọi bình luận
  replies: ['Dạ em gửi quà và thông tin vào tin nhắn rồi ạ, {ten} xem giúp em nha 💚', '{ten} ơi, em vừa nhắn riêng cho mình rồi ạ, mình mở tin nhắn xem nhé 🌿',
    'Dạ em cảm ơn {ten} đã quan tâm ạ. Em gửi tin nhắn riêng rồi, mình kiểm tra hộp thư giúp em nha 💌', 'Em nhắn {ten} rồi nha, có cả quà nhỏ em gửi tặng mình đó ạ 🎁'],
  dm_text: 'Em có món quà nhỏ tặng mình: cẩm nang “Sống khỏe chủ động” (32 trang, có sách nói) + mã giảm 5% khi đặt hàng trên web. Mình bấm “🎁 Nhận quà” bên dưới nha, hoặc cứ nhắn em điều mình muốn hỏi ạ.',
  gift_msg: 'Dạ em cảm ơn {ten} 💚 Quà của mình đây ạ:\n\n📖 Cẩm nang “Sống khỏe chủ động” (32 trang, có sách nói): {link}\n\n🎟 Mã SONGLANH5: giảm 5% tổng tiền hàng khi đặt trên thucduonglanh.vn (1 lần / số điện thoại, đơn từ 300k được freeship)\n\n👥 Nhóm Zalo “Sống khỏe cùng Thực Dưỡng Lành”: thực đơn lành, kiến thức mỗi sáng, hỏi đáp cùng đội ngũ: {nhom}\n\nChuyên viên bên em sẽ nhắn Zalo cho mình trong giờ làm việc ạ.',
  gift_link: CAMNANG, group: ZALO_GROUP,
  post: false, cta: true, mode: 'approve', slots: ['19:30'], // bài đăng: mặc định tắt, chờ duyệt, 1 bài / ngày
  voice: '' // trang này dành cho ai, giọng thế nào (AI viết bài theo)
};
const FP_THEME = [ // 0 = Chủ nhật. Trang nhiều bài / ngày thì bài sau lệch chủ đề (+3)
  'Tâm an cuối tuần: 1 suy ngẫm ngắn về sống chậm, biết ơn, gia đình (không bịa chuyện khách hàng)',
  'Kiến thức dinh dưỡng nền tảng: 1 điều dễ hiểu, áp dụng được ngay trong bữa ăn gia đình',
  'Hiểu về nguyên liệu: 1–3 nguyên liệu có trong 1 sản phẩm (đúng thành phần trong tài liệu), vị, cách người Việt quen dùng',
  'Bếp lành: 1 món ăn / thức uống lành, dễ làm, nguyên liệu dễ mua (có thể là món chay)',
  'Hỏi đáp: 1 câu khách hay hỏi trong phần hỏi đáp của 1 sản phẩm, trả lời rõ ràng, gần gũi',
  'Thói quen sống lành: ngủ, vận động nhẹ, uống nước, thở, ăn chậm… 1 việc nhỏ làm được hôm nay',
  'Góc sản phẩm: giới thiệu nhẹ nhàng 1 sản phẩm (ai hợp, cách dùng, quy cách, giá đúng tài liệu), nhắc đặt trên web được kiểm hàng trước khi nhận, freeship đơn từ 300k'
];

let client = null;
function ai(env) { if (!client) client = new Anthropic({ apiKey: env.ANTHROPIC_API_KEY, maxRetries: 2, timeout: 60e3, fetch: aiFetch(env) }); return client; } // qua trạm Bắc Mỹ (airelay.js)
const textOf = res => res.content.filter(b => b.type === 'text').map(b => b.text).join('\n').trim();
const vnHour = t => { const d = new Date(t + TZ_MS); return d.getUTCHours() + d.getUTCMinutes() / 60; };
const slotTime = (day, at) => { const [h, m] = String(at || '19:30').split(':').map(Number); return new Date(day.slice(0, 4) + '-' + day.slice(4, 6) + '-' + day.slice(6, 8) + 'T00:00:00+07:00').getTime() + ((h || 0) * 60 + (m || 0)) * 60e3; };
const given = n => String(n || '').trim().split(/\s+/).pop() || 'anh/chị'; // tên gọi tiếng Việt = chữ cuối
const pick = a => a[Math.floor(Math.random() * a.length)];
const plain = s => String(s || '').replace(/\*\*/g, '').replace(/^#+\s*/gm, ''); // Facebook không hiện chữ đậm / tiêu đề markdown

export async function fbSchema(db) {
  await run(db, `CREATE TABLE IF NOT EXISTS fp_pages (id TEXT PRIMARY KEY, name TEXT DEFAULT '', token TEXT DEFAULT '', active INTEGER DEFAULT 0, cfg TEXT DEFAULT '{}',
    at INTEGER, err TEXT DEFAULT '', last_ev INTEGER)`); // fanpage đã kết nối (token = mã truy cập trang, không bao giờ gửi về CRM)
  await run(db, `CREATE TABLE IF NOT EXISTS fp_users (psid TEXT PRIMARY KEY, page TEXT, name TEXT DEFAULT '', phone TEXT DEFAULT '', lead TEXT DEFAULT '', src TEXT DEFAULT '',
    last_in INTEGER, pause INTEGER DEFAULT 0, gift INTEGER DEFAULT 0, nudged INTEGER DEFAULT 0, mid TEXT DEFAULT '', at INTEGER)`); // người nhắn fanpage (psid theo từng trang). gift: 1 đã xin số, 2 đã gửi quà
  await run(db, 'CREATE INDEX IF NOT EXISTS fp_users_in ON fp_users(last_in)');
  await run(db, `CREATE TABLE IF NOT EXISTS fp_cmts (cid TEXT PRIMARY KEY, page TEXT, post TEXT DEFAULT '', uid TEXT DEFAULT '', name TEXT DEFAULT '', text TEXT DEFAULT '', at INTEGER, did TEXT DEFAULT '')`);
  await run(db, 'CREATE INDEX IF NOT EXISTS fp_cmts_uid ON fp_cmts(page, uid, at)');
  await run(db, `CREATE TABLE IF NOT EXISTS fp_posts (id TEXT PRIMARY KEY, page TEXT, day TEXT, slot TEXT, topic TEXT DEFAULT '', text TEXT DEFAULT '', link TEXT DEFAULT '', prod TEXT DEFAULT '',
    status TEXT DEFAULT 'draft', by_name TEXT DEFAULT '', at INTEGER, sent_at INTEGER, fb_id TEXT DEFAULT '', err TEXT DEFAULT '')`); // id = trang_yyyyMMdd_HHmm
  await run(db, 'CREATE INDEX IF NOT EXISTS fp_posts_day ON fp_posts(day)');
  await run(db, `CREATE TABLE IF NOT EXISTS fp_log (rid INTEGER PRIMARY KEY AUTOINCREMENT, at INTEGER, page TEXT DEFAULT '', kind TEXT, name TEXT DEFAULT '', text TEXT DEFAULT '', reply TEXT DEFAULT '')`);
  await run(db, 'CREATE INDEX IF NOT EXISTS fp_log_at ON fp_log(at)');
}
const flog = (x, page, kind, o) => run(x.db, 'INSERT INTO fp_log (at, page, kind, name, text, reply) VALUES (?, ?, ?, ?, ?, ?)', Date.now(), page || '', kind, String(o.name || '').slice(0, 80), String(o.text || '').slice(0, 1000), String(o.reply || '').slice(0, 2000));

/* ---------------------------------------------------------------- cài đặt + gọi Facebook */
async function appCfg(x) { return Object.assign({ id: '', secret: '', verify: '', config: '' }, await kvJson(x.db, 'fp_app', {})); }
function pageCfg(raw) { let c = {}; try { c = JSON.parse(raw || '{}'); } catch (e) { } c = Object.assign({}, PCFG0, c); if (!Array.isArray(c.replies) || !c.replies.length) c.replies = PCFG0.replies; if (!Array.isArray(c.slots)) c.slots = PCFG0.slots; return c; }
const PG = new Map(); // giữ trang trong bộ nhớ 60 giây (mỗi tin nhắn / bình luận đỡ 1 lần đọc D1)
async function pageGet(x, id) {
  const m = PG.get(id); if (m && Date.now() - m.t < 60e3) return m.p;
  const r = await first(x.db, 'SELECT * FROM fp_pages WHERE id = ?', id);
  const p = r ? Object.assign({}, r, { cfg: pageCfg(r.cfg) }) : null;
  PG.set(id, { t: Date.now(), p }); return p;
}

async function graph(path, token, body, method) {
  const url = GRAPH + path + (path.indexOf('?') < 0 ? '?' : '&') + 'access_token=' + encodeURIComponent(token);
  const r = await fetch(url, body !== undefined || method ? { method: method || 'POST', headers: { 'Content-Type': 'application/json' }, body: body !== undefined ? JSON.stringify(body) : undefined } : undefined);
  const j = await r.json().catch(() => ({}));
  if (j.error) { const e = new Error(j.error.error_user_msg || j.error.message || 'Facebook báo lỗi'); e.code = j.error.code; e.sub = j.error.error_subcode; throw e; }
  return j;
}
/** Mã trang hết hạn / bị thu hồi (190), mất quyền (200, 10) → ghi lỗi để CRM báo, Telegram 1 lần / ngày */
async function pageErr(x, p, e) {
  if (![190, 200, 10, 102].includes(e.code)) return;
  const msg = e.code === 190 ? 'Mã truy cập trang hết hạn hoặc bị thu hồi: bấm “Kết nối fanpage” lại.' : 'Ứng dụng chưa đủ quyền với trang: ' + e.message;
  await run(x.db, 'UPDATE fp_pages SET err = ? WHERE id = ?', msg.slice(0, 300), p.id); PG.delete(p.id);
  const k = 'fp_errtg_' + p.id + '_' + fmtDate(Date.now(), 'yyMMdd');
  if (!await kvGet(x.db, k)) { await kvSet(x.db, k, '1', 2 * DAY); await telegram(x.env, '⚠️ <b>Trợ lý Fanpage “' + esc(p.name) + '” lỗi</b>\n' + esc(msg) + '\n👉 ' + CRM_URL + '/#fanpage'); }
}
async function sigOk(secret, buf, header) {
  if (!secret || !header || header.indexOf('sha256=') !== 0) return false;
  const k = await crypto.subtle.importKey('raw', new TextEncoder().encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const hex = [...new Uint8Array(await crypto.subtle.sign('HMAC', k, buf))].map(b => b.toString(16).padStart(2, '0')).join('');
  return hex === header.slice(7);
}
const html = (title, body) => new Response('<!doctype html><html lang="vi"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>' + title + '</title><style>body{font:16px/1.6 system-ui,sans-serif;max-width:560px;margin:40px auto;padding:0 16px;color:#1f2d24}a.b{display:inline-block;margin-top:12px;padding:10px 18px;background:#2f7d4f;color:#fff;border-radius:8px;text-decoration:none}</style></head><body>' + body + '</body></html>', { headers: { 'Content-Type': 'text/html; charset=utf-8' } });

/* ---------------------------------------------------------------- đường dẫn /fb/… (index.js) */
export async function fbRoute(x, req, path, url) {
  useEnv(x);
  if (path === '/fb/hook' && req.method === 'GET') { // Facebook xác minh webhook
    const app = await appCfg(x), sp = url.searchParams;
    if (sp.get('hub.mode') === 'subscribe' && app.verify && sp.get('hub.verify_token') === app.verify) { await kvSet(x.db, 'fp_verified', String(Date.now())); return new Response(sp.get('hub.challenge') || '', { status: 200 }); }
    return new Response('forbidden', { status: 403 });
  }
  if (path === '/fb/hook' && req.method === 'POST') {
    const buf = await req.arrayBuffer(), app = await appCfg(x);
    if (!await sigOk(app.secret, buf, req.headers.get('X-Hub-Signature-256'))) return new Response('bad signature', { status: 403 });
    let d = null; try { d = JSON.parse(new TextDecoder().decode(buf)); } catch (e) { }
    if (d && d.object === 'page') x.later(hook(x, d, app));
    return new Response('EVENT_RECEIVED');
  }
  if (path === '/fb/cb') return await oauthCb(x, url);
  return null;
}

async function hook(x, d, app) {
  await Promise.all((d.entry || []).map(async e => {
    const p = await pageGet(x, String(e.id)); if (!p) return;
    const now = Date.now();
    if (!p.last_ev || now - p.last_ev > 5 * 60e3) { p.last_ev = now; await run(x.db, 'UPDATE fp_pages SET last_ev = ? WHERE id = ?', now, p.id); } // CRM biết trang đang nhận sự kiện (ghi 5 phút / lần)
    for (const c of e.changes || []) if (c.field === 'feed') { try { await onComment(x, p, c.value || {}); } catch (err) { console.error('fp cmt', err.message); await flog(x, p.id, 'error', { text: 'Bình luận: ' + err.message }); await pageErr(x, p, err); } }
    for (const m of e.messaging || []) { try { await onMessage(x, p, m, app); } catch (err) { console.error('fp msg', err.message); await flog(x, p.id, 'error', { text: 'Tin nhắn: ' + err.message }); await pageErr(x, p, err); } }
  }));
}

/* ---------------------------------------------------------------- bình luận → trả lời + nhắn riêng */
async function onComment(x, p, v) {
  if (v.item !== 'comment' || v.verb !== 'add' || !p.active) return;
  const from = v.from || {}, cid = String(v.comment_id || ''), post = String(v.post_id || '');
  if (!from.id || !cid || String(from.id) === p.id) return; // bình luận của chính trang (kể cả bot trả lời) → bỏ
  if (v.parent_id && v.parent_id !== post) return; // chỉ bình luận gốc, không chen vào chuỗi trả lời
  const c = p.cfg, text = String(v.message || '').trim().slice(0, 1000), name = String(from.name || '').trim().slice(0, 80), now = Date.now();
  const ins = await run(x.db, 'INSERT INTO fp_cmts (cid, page, post, uid, name, text, at) VALUES (?, ?, ?, ?, ?, ?, ?) ON CONFLICT(cid) DO NOTHING', cid, p.id, post, String(from.id), name, text, now);
  if (!ins.meta || !ins.meta.changes) return; // Facebook gửi lại sự kiện cũ
  const hk = 'fp_h_' + p.id + '_' + fmtDate(now, 'yyMMddHH'), nh = Number(await kvGet(x.db, hk) || 0);
  if (nh >= 200) return; // chống vượt giới hạn Facebook khi bài bị spam
  const did = [];
  const kws = String(c.kw || '').split(',').map(nrm).filter(Boolean);
  if (kws.length && !kws.some(k => nrm(text).indexOf(k) >= 0)) { // không khớp từ khoá → chỉ thích
    if (c.like) { try { await graph(cid + '/likes', p.token, {}); did.push('like'); } catch (e) { } }
    await run(x.db, 'UPDATE fp_cmts SET did = ? WHERE cid = ?', did.join(','), cid); return;
  }
  await kvSet(x.db, hk, String(nh + 1), 2 * 3600e3);
  const pm = text.match(PHONE_RE), ph = pm ? normPhone(pm[0]) : '', hasPhone = /^0\d{9}$/.test(ph);
  if (hasPhone) await saveLead(x, p, { psid: '', name, phone: ph, how: 'Khách để số trong bình luận', cmt: text, post }); // ghi số trước: bước sau lỗi cũng không mất khách
  let bad = null; const tryDo = async (k, f) => { try { await f(); did.push(k); } catch (e) { bad = bad || e; console.error('fp ' + k, e.message); } }; // mỗi việc độc lập
  if (c.like) await tryDo('like', () => graph(cid + '/likes', p.token, {}));
  if (hasPhone && c.hide) await tryDo('hide', () => graph(cid, p.token, { is_hidden: true })); // ẩn số điện thoại khỏi người khác
  if (c.reply) await tryDo('reply', () => graph(cid + '/comments', p.token, { message: (hasPhone ? 'Dạ em nhận được thông tin rồi ạ, em đã ẩn số điện thoại để bảo mật cho mình. Em nhắn riêng {ten} ngay nha 💚' : pick(c.replies)).replace(/\{ten\}/g, given(name)) }));
  if (c.dm && !await first(x.db, "SELECT cid FROM fp_cmts WHERE page = ? AND uid = ? AND cid != ? AND did LIKE '%dm%' AND at > ?", p.id, String(from.id), cid, now - DAY)) { // đã nhắn người này trong 24 giờ → không nhắn lại
    const opener = await commentOpener(x, p, name, text, post, hasPhone);
    await tryDo('dm', async () => {
      let r;
      try { r = await graph(p.id + '/messages', p.token, { recipient: { comment_id: cid }, message: { text: opener, quick_replies: QR_START } }); }
      catch (e) { if (e.code !== 100) throw e; r = await graph(p.id + '/messages', p.token, { recipient: { comment_id: cid }, message: { text: opener } }); } // tin nhắn riêng không nhận nút → gửi chữ
      const psid = String(r.recipient_id || '');
      if (psid) await run(x.db, `INSERT INTO fp_users (psid, page, name, phone, src, at) VALUES (?, ?, ?, ?, ?, ?) ON CONFLICT(psid) DO UPDATE SET src = excluded.src, phone = CASE WHEN fp_users.phone = '' THEN excluded.phone ELSE fp_users.phone END, name = CASE WHEN fp_users.name = '' THEN excluded.name ELSE fp_users.name END`,
        psid, p.id, name, hasPhone ? ph : '', JSON.stringify({ post, cid, text: text.slice(0, 300) }), now);
    });
  }
  await run(x.db, 'UPDATE fp_cmts SET did = ? WHERE cid = ?', did.join(','), cid);
  await flog(x, p.id, 'comment', { name, text: text.replace(PHONE_RE, '[SĐT]'), reply: did.map(k => ({ like: '👍 thích', hide: '🙈 ẩn (có SĐT)', reply: '💬 trả lời công khai', dm: '📩 nhắn riêng' })[k]).join(' · ') + (bad ? ' · ⚠️ ' + bad.message : '') });
  if (bad) await pageErr(x, p, bad);
}
const QR_START = [{ content_type: 'text', title: '🎁 Nhận quà', payload: 'GIFT' }, { content_type: 'text', title: '💬 Hỏi sản phẩm', payload: 'ASK' }];

/** Nội dung bài viết khách bình luận (để AI hiểu khách hỏi gì: "giá?" dưới bài DILVANG). Lưu 7 ngày. */
async function postText(x, p, post) {
  if (!post) return '';
  const k = 'fp_post_' + post, old = await kvGet(x.db, k); if (old !== null) return old;
  let t = ''; try { const j = await graph(post + '?fields=message', p.token); t = String(j.message || '').slice(0, 1500); } catch (e) { }
  await kvSet(x.db, k, t, 7 * DAY); return t;
}
/** Tin nhắn riêng đầu tiên: chào + (AI trả lời câu hỏi trong bình luận) + mời nhận quà */
async function commentOpener(x, p, name, text, post, hasPhone) {
  const c = p.cfg, hi = 'Dạ em chào ' + given(name) + ' 🌿 Em là ' + BOT + ' bên Thực Dưỡng Lành, em nhắn mình từ bình luận ở bài viết ạ.';
  if (hasPhone) return hi + ' Em đã nhận số điện thoại của mình, chuyên viên bên em sẽ liên hệ sớm nha. Trong lúc chờ, mình cần hỏi gì cứ nhắn em ạ.';
  let ans = '';
  const generic = /^(ib|inbox|check ?ib|xin gia|gia|quan tam|tu van|cho xin|.{0,6})$/; // bình luận chung chung → khỏi gọi AI
  if (c.ai && x.env.ANTHROPIC_API_KEY && !generic.test(nrm(text).replace(/[^a-z0-9 ]/g, '').trim())) {
    try {
      const know = await kb(), pt = await postText(x, p, post);
      const res = await ai(x.env).messages.create({ model: FAST, max_tokens: 800, output_config: { effort: 'low' },
        system: [{ type: 'text', text: MSG_RULES + '\n' + REF_RULES + '\n' + TRUTH_RULES.replace(/mời nhắn Zalo/g, 'thêm [[zalo]]') },
          { type: 'text', text: 'TÀI LIỆU (thông tin chính thức của Thực Dưỡng Lành):\n\n' + know, cache_control: { type: 'ephemeral' } }],
        messages: [{ role: 'user', content: (pt ? 'Bài viết trên fanpage "' + p.name + '":\n' + pt + '\n\n' : '') + 'Khách "' + name + '" bình luận dưới bài: "' + text + '"\n\nViết 1–2 câu (dưới 50 chữ) trả lời thẳng điều khách hỏi trong bình luận, để gửi trong tin nhắn riêng. Không chào (đã chào rồi), không mời nhận quà (đã có câu riêng). Bình luận không có câu hỏi thì viết đúng: [KHONG]' }] });
      ans = res.stop_reason === 'refusal' ? '' : textOf(res);
      if (/\[KHONG\]/.test(ans)) ans = '';
    } catch (e) { console.error('fp opener ai', e.message); }
  }
  const prods = ans ? prodMap(await kb()) : {};
  return [hi, ans ? fbText(safe(ans), prods, p).text : '', c.dm_text].filter(Boolean).join('\n\n').slice(0, 1990);
}

/* ---------------------------------------------------------------- tin nhắn Messenger */
const MSG_RULES = `# Bạn là ai
Bạn là "${BOT}" – chuyên viên chăm sóc khách hàng của Thực Dưỡng Lành, đang nhắn tin Messenger với khách trên fanpage. Bạn là trợ lý ảo (AI); không tự giới thiệu là AI, nhưng khách hỏi thì nói thật và cho biết có chuyên viên thật hỗ trợ.

# Giọng nói
- Như tin nhắn giữa người với người: câu ngắn, đời thường, "dạ", "ạ", "nha" vừa phải. Không văn mẫu, không quảng cáo.
- Xưng hô theo khách (cô/chú/bác → xưng "con"/"cháu"; chị/anh → xưng "em"); chưa rõ thì "anh/chị", xưng "em". Giữ nguyên suốt cuộc trò chuyện.
- Đồng cảm trước khi đưa thông tin nếu khách kể chuyện. Nhớ điều khách đã kể, không hỏi lại.
- Ngắn: 2–4 câu, dưới 80 chữ; chỉ gạch đầu dòng khi liệt kê từ 3 ý. Emoji tối đa 1. Không tiêu đề, không bảng, không dấu ** (Messenger không hiện chữ đậm).
- Không phải câu nào cũng hỏi lại; hỏi 1 câu khi thật cần để tư vấn.

# Tư vấn
- Trả lời thẳng trước. Biết nhu cầu thì gợi ý 1–2 sản phẩm hợp nhất kèm lý do gắn với hoàn cảnh khách, thêm [[sp:mã]] (tối đa 2). Khách muốn mua: bấm link đặt trên web (được kiểm hàng trước khi nhận), hoặc gửi tên + số điện thoại + địa chỉ để chuyên viên lên đơn.
- Quà: cẩm nang "Sống khỏe chủ động" + mã giảm 5% + vào nhóm Zalo Sống khỏe. Khách chưa để số mà đã hỏi vài câu thì có thể mời nhẹ 1 lần: để lại số điện thoại (có Zalo) là em gửi quà liền. Đã mời rồi thì không nhắc lại.
- Thêm [[zalo]] khi cần người thật: khách muốn gặp nhân viên / người thật, muốn xoá dữ liệu của mình, gửi thông tin đặt hàng, hỏi đơn đã đặt, đổi trả, khiếu nại, giá sỉ / đại lý / cộng tác viên, sản phẩm chưa có trên web, hoặc điều em không biết. Khi đó nói tự nhiên: "em chuyển chị bên chuyên viên nhắn lại cho mình ngay nha" (trong giờ làm việc; ngoài giờ thì từ 8h sáng hôm sau).
- Khách tự gửi số điện thoại thì cảm ơn và báo chuyên viên sẽ liên hệ.`;

/** Thẻ của An Lành ([[sp:mã]], [[zalo]]) → chữ thường cho Messenger, link sản phẩm gắn UTM theo trang */
function fbText(s, prods, p) {
  let zalo = false;
  const camp = nrm(p.name).replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 40) || 'fanpage';
  const out = plain(s).replace(/\s*\[\[sp:([a-z0-9-]+)\]\]/g, (m, c) => prods[c] ? '\n👉 ' + prods[c].name + ': ' + prods[c].url + '?utm_source=facebook&utm_medium=messenger&utm_campaign=' + camp : '')
    .replace(/\s*\[\[zalo\]\]/g, () => { zalo = true; return ''; }).replace(/\n{3,}/g, '\n\n').trim();
  return { text: out, zalo };
}
async function send(x, p, psid, text, qr) {
  const parts = []; let t = String(text || '').trim();
  while (t.length > 1990) { const cut = t.lastIndexOf('\n', 1990) > 800 ? t.lastIndexOf('\n', 1990) : 1990; parts.push(t.slice(0, cut)); t = t.slice(cut).trim(); }
  if (t) parts.push(t);
  for (let i = 0; i < parts.length; i++) await graph('me/messages', p.token, { recipient: { id: psid }, messaging_type: 'RESPONSE', message: Object.assign({ text: parts[i], metadata: 'anlanh' }, qr && i === parts.length - 1 ? { quick_replies: qr } : {}) });
}
const typing = (x, p, psid) => graph('me/messages', p.token, { recipient: { id: psid }, sender_action: 'typing_on' }).catch(() => { });
const PAUSE_MS = 12 * 3600e3, AUTO_MS = 20e3; // nhân sự nhắn tay → bot nhường 12 tiếng; tin trang gửi trong 20 giây sau tin khách = tự động của Meta
const ASK_PHONE = 'Dạ em gửi quà liền ạ 🎁 Mình cho em xin số điện thoại (có Zalo) để em gửi quà và mời mình vào nhóm Sống khỏe trên Zalo nha. Mình bấm số bên dưới cho nhanh, hoặc gõ số cũng được ạ.';

async function onMessage(x, p, m, app) {
  const now = Date.now(), msg = m.message || null;
  if (msg && msg.is_echo) { // tin trang gửi đi
    if (String(msg.app_id || '') === String(app.id) || msg.metadata === 'anlanh') return; // của bot
    const psid = String((m.recipient || {}).id || ''); if (!psid) return;
    const ou = await first(x.db, 'SELECT last_in FROM fp_users WHERE psid = ?', psid);
    if (ou && ou.last_in && now - ou.last_in < AUTO_MS) return; // trả lời tức thì / câu hỏi thường gặp của Meta Business Suite (gửi ngay sau tin khách) – không phải nhân sự
    await run(x.db, 'INSERT INTO fp_users (psid, page, pause, at) VALUES (?, ?, ?, ?) ON CONFLICT(psid) DO UPDATE SET pause = excluded.pause', psid, p.id, now + PAUSE_MS, now); // nhân sự nhắn tay → bot nhường 12 tiếng
    return;
  }
  if (!p.active || !msg && !m.postback) return;
  const psid = String((m.sender || {}).id || ''); if (!psid || psid === p.id) return;
  const mid = String(msg && msg.mid || m.postback && m.postback.mid || '');
  let u = await first(x.db, 'SELECT * FROM fp_users WHERE psid = ?', psid);
  if (u && mid && u.mid === mid) return; // Facebook gửi lại
  const payload = String(msg && msg.quick_reply && msg.quick_reply.payload || m.postback && m.postback.payload || '');
  let text = String(msg && msg.text || m.postback && m.postback.title || '').replace(/\s+/g, ' ').trim().slice(0, 600);
  if (!u) {
    let nm = ''; try { const pr = await graph(psid + '?fields=name', p.token); nm = String(pr.name || ''); } catch (e) { }
    await run(x.db, 'INSERT INTO fp_users (psid, page, name, at) VALUES (?, ?, ?, ?) ON CONFLICT(psid) DO NOTHING', psid, p.id, nm.slice(0, 80), now);
    u = await first(x.db, 'SELECT * FROM fp_users WHERE psid = ?', psid);
  }
  await run(x.db, 'UPDATE fp_users SET last_in = ?, mid = ? WHERE psid = ?', now, mid, psid);
  const sid = 'fb' + psid, row = await first(x.db, 'SELECT msgs FROM chats WHERE sid = ?', sid);
  let msgs = []; try { msgs = JSON.parse(row && row.msgs || '[]'); } catch (e) { }
  if (!text && !payload) return; // nhãn dán, ảnh: để nhân sự xem trong hộp thư
  const pm = (/^\+?\d[\d .-]{8,}$/.test(payload) ? payload : text).match(PHONE_RE), ph = pm ? normPhone(pm[0]) : '';
  const gotPhone = /^0\d{9}$/.test(ph) && !u.phone && !REF_TXT.test(text || '') ? ph : '';
  msgs.push({ r: 'u', t: payload === 'GIFT' ? '🎁 Nhận quà' : payload === 'ASK' ? '💬 Hỏi sản phẩm' : text || payload, at: now });
  const save = async (reply, miss) => {
    if (reply) msgs.push({ r: 'a', t: reply, at: Date.now() });
    await run(x.db, `INSERT INTO chats (sid, start, last, n, page, src, msgs, miss) VALUES (?, ?, ?, 1, ?, 'Facebook', ?, ?)
      ON CONFLICT(sid) DO UPDATE SET last = excluded.last, n = chats.n + 1, msgs = excluded.msgs, miss = chats.miss + excluded.miss`, sid, now, now, 'Fanpage ' + p.name, JSON.stringify(msgs.slice(-60)).slice(0, 60000), miss ? 1 : 0);
  };
  const echoAt = (u.pause || 0) - PAUSE_MS, autoEcho = msgs.some(z => z.r === 'u' && echoAt >= z.at && echoAt - z.at < AUTO_MS); // lần nhường do tin tự động của Meta (tới ngay sau 1 tin khách) → bỏ qua
  if (u.pause > now && !autoEcho) { await save('', 0); return; } // nhân sự đang nói chuyện với khách
  const nm = given(u.name), c = p.cfg;
  const giftOut = () => c.gift_msg.replace(/\{ten\}/g, nm).replace(/\{link\}/g, c.gift_link || CAMNANG).replace(/\{nhom\}/g, c.group || ZALO_GROUP);

  if (gotPhone) { // có số → ghi khách hỏi, gửi quà + nhóm Zalo
    const out = giftOut();
    await send(x, p, psid, out);
    await run(x.db, 'UPDATE fp_users SET phone = ?, gift = 2 WHERE psid = ?', gotPhone, psid);
    await save(out, 0);
    await flog(x, p.id, 'lead', { name: u.name, text: text.replace(PHONE_RE, '[SĐT]'), reply: 'Đã gửi quà + link nhóm Zalo' });
    let src = {}; try { src = JSON.parse(u.src || '{}'); } catch (e) { }
    await saveLead(x, p, { psid, name: u.name, phone: gotPhone, how: 'Để lại số qua Messenger', gift: true, asks: msgs.filter(z => z.r === 'u').map(z => z.t.replace(PHONE_RE, '[SĐT]')), raw: msgs.filter(z => z.r === 'u').map(z => z.t), post: src.post, cmt: src.text });
    return;
  }
  if (payload === 'GIFT' || /^(qua|nhan qua|lay qua|xin qua)\b/.test(nrm(text))) {
    if (u.phone) { const out = giftOut(); await send(x, p, psid, out); await save(out, 0); return; } // đã có số → gửi lại quà
    await send(x, p, psid, ASK_PHONE, [{ content_type: 'user_phone_number' }]);
    await run(x.db, 'UPDATE fp_users SET gift = 1 WHERE psid = ?', psid); await save(ASK_PHONE, 0);
    await flog(x, p.id, 'gift_ask', { name: u.name, reply: 'Xin số để gửi quà' }); return;
  }
  if (payload === 'ASK' && !text.replace(/💬|hỏi sản phẩm/gi, '').trim()) { const t = 'Dạ mình cứ nhắn điều mình muốn hỏi nha, em trả lời liền ạ 🌿 (ví dụ: sản phẩm nào hợp với mẹ sau sinh, trà uống thế nào, giá bao nhiêu…)'; await send(x, p, psid, t); await save(t, 0); return; }
  if (!c.ai || !x.env.ANTHROPIC_API_KEY) { await save('', 0); return; }
  const dk = 'fp_dm_' + psid + '_' + fmtDate(now, 'yyMMdd'), nd = Number(await kvGet(x.db, dk) || 0);
  if (nd >= 60) { await save('', 0); return; } // 1 người / ngày
  x.later(typing(x, p, psid));
  const hist = msgs.slice(-16); while (hist.length && hist[0].r !== 'u') hist.shift();
  const know = await kb(), w = workNow(now); let src = {}; try { src = JSON.parse(u.src || '{}'); } catch (e) { }
  const asked = msgs.filter(z => z.r === 'u').length;
  let reply = '', aerr = null;
  for (let tr = 0; tr < 2 && !reply; tr++) try { // lỗi thì thử lại 1 lần, lần sau gửi ít lịch sử hơn
    const hs = tr ? hist.slice(-6) : hist; while (hs.length && hs[0].r !== 'u') hs.shift();
    const res = await ai(x.env).messages.create({ model: FAST, max_tokens: 1500, output_config: { effort: 'low' },
      system: [{ type: 'text', text: MSG_RULES + '\n' + REF_RULES + '\n' + TRUTH_RULES.replace(/mời nhắn Zalo/g, 'thêm [[zalo]] để chuyên viên hỗ trợ') },
        { type: 'text', text: 'TÀI LIỆU (thông tin chính thức của Thực Dưỡng Lành):\n\n' + know, cache_control: { type: 'ephemeral' } },
        { type: 'text', text: 'Fanpage: "' + p.name + '". Bây giờ là ' + w.label + '. Chuyên viên ' + (w.on ? 'đang trực.' : 'ngoài giờ (trực Thứ 2 – Thứ 7, 8h–17h): nhắn lại từ 8h sáng hôm sau.') + (u.name ? ' Tên Facebook của khách: ' + u.name + '.' : '') + (src.text ? ' Khách đến từ bình luận: "' + src.text + '".' : '') + (u.phone ? ' Khách ĐÃ để số và đã nhận quà, không mời nhận quà nữa.' : u.gift ? ' Đã xin số để gửi quà, chưa nhận được.' : '') }],
      messages: hs.map(z => ({ role: z.r === 'u' ? 'user' : 'assistant', content: z.t })) });
    reply = res.stop_reason === 'refusal' ? 'Dạ câu này em xin phép chưa trả lời được ạ, để chuyên viên bên em nhắn lại cho mình nha. [[zalo]]' : textOf(res);
  } catch (e) { aerr = e; console.error('fp ai', e && (e.status || ''), e && e.message); }
  if (!reply) { reply = 'Dạ em đang hơi chậm một chút, mình nhắn lại giúp em sau ít phút nha 🙏'; await flog(x, p.id, 'error', { name: u.name, text: 'AI lỗi khi trả lời: ' + text.slice(0, 120), reply: aerr ? String(aerr.status || '') + ' ' + String(aerr.message || aerr).slice(0, 300) : 'AI không trả lời' }); }
  const z = fbText(safe(reply), prodMap(know), p); if (!z.text) return;
  const qr = !u.phone && !u.gift && asked >= 2 ? [{ content_type: 'text', title: '🎁 Nhận quà', payload: 'GIFT' }] : null; // từ câu hỏi thứ 2: nút nhận quà dưới câu trả lời
  await send(x, p, psid, z.text, qr);
  await save(z.text, z.zalo);
  await kvSet(x.db, dk, String(nd + 1), 2 * DAY);
  await flog(x, p.id, z.zalo ? 'handoff' : 'dm', { name: u.name, text, reply: z.text });
  if (z.zalo) x.later(handoff(x, p, u, text, z.text));
}

/** Câu cần người thật → Telegram kèm link hộp thư fanpage */
async function handoff(x, p, u, text, reply) {
  await telegram(x.env, '📘 <b>FANPAGE CẦN NGƯỜI THẬT</b> – ' + esc(p.name) + '\n👤 ' + esc(u.name || 'Khách') + (u.phone ? ' – <b>' + esc(u.phone) + '</b>' : ' (chưa có số)') + '\n💬 ' + esc(String(text).slice(0, 300)) + '\n🤖 Đã trả lời: ' + esc(String(reply).slice(0, 300))
    + '\n👉 Trả lời trong hộp thư fanpage (bot tự nhường 12 tiếng khi bạn nhắn): https://business.facebook.com/latest/inbox/all?asset_id=' + p.id);
}

/** Khách để số (bình luận / Messenger) → khách hỏi kênh Facebook + Telegram + trợ lý Zalo tìm theo số */
async function saveLead(x, p, o) {
  const asks = (o.asks || []).map(s => String(s).slice(0, 120)).slice(-5);
  const rf = await botRef(x, o.raw || [], o.phone); // 🌱 khách nói được người quen giới thiệu
  const ld = await addLead(x, { ...rf.lead, name: o.name || 'Khách fanpage', phone: o.phone, channel: 'Facebook', addInterest: true,
    interest: 'Fanpage ' + p.name + (o.gift ? ' · Nhận quà cẩm nang' : ''), note: o.how + ' – fanpage "' + p.name + '"' + (o.cmt ? ' · Bình luận: ' + String(o.cmt).replace(PHONE_RE, '[SĐT]').slice(0, 150) : '') + (asks.length ? ' · Đã hỏi: ' + asks.join(' | ') : '') + rf.note + (o.post ? ' · Bài: https://facebook.com/' + o.post : ''),
    by: 'Website', auto: true });
  if (o.psid) await run(x.db, 'UPDATE fp_users SET phone = ?, lead = ? WHERE psid = ?', o.phone, ld.id, o.psid);
  if (o.psid) await run(x.db, 'UPDATE chats SET phone = ?, name = ?, lead = ? WHERE sid = ?', o.phone, o.name || '', ld.id, 'fb' + o.psid);
  x.later(zbotLead(x, { phone: o.phone, name: o.name, lead: ld.id, what: o.gift ? 'quà cẩm nang “Sống khỏe chủ động”' : '', announce: !!o.gift })); // trợ lý nhóm Zalo: tìm Zalo theo số để tự duyệt vào nhóm, chúc mừng nếu đã nhận quà
  const w = workNow(Date.now());
  const m = '📘 <b>KHÁCH ĐỂ LẠI SỐ QUA FANPAGE</b> – ' + esc(p.name) + '\n👤 ' + esc(o.name || 'Chưa có tên') + ' – <b>' + esc(o.phone) + '</b>\n📍 ' + esc(o.how) + (asks.length ? '\n💬 ' + esc(asks.slice(-3).join(' | ')) : '')
    + '\n👉 ' + (w.on ? 'Gọi / nhắn Zalo cho khách ngay khi còn nóng' : 'Ngoài giờ: nhắn Zalo chào khách, gọi lúc 8h sáng');
  await telegram(x.env, m + (ld.owner ? '\n\n👤 Giao cho: ' + esc(ld.owner) : '\n\n⚠️ Chưa có người phụ trách – vào CRM để giao'));
  if (ld.owner) await telegramUser(x, ld.owner, m + '\n\n👉 Khách tiềm năng mới của bạn: ' + CRM_URL + '/#tiem-nang');
}

/* ---------------------------------------------------------------- kết nối trang */
async function oauthCb(x, url) {
  const st = String(url.searchParams.get('state') || '').replace(/[^a-f0-9]/g, ''), code = url.searchParams.get('code');
  const who = st ? await kvGet(x.db, 'fp_st_' + st) : null;
  if (!who) return html('Hết hạn', '<h2>Link đã hết hạn</h2><p>Quay lại CRM → tab 📘 Fanpage, bấm “Kết nối fanpage” lần nữa.</p><a class="b" href="' + CRM_URL + '/#fanpage">Về CRM</a>');
  await kvDel(x.db, 'fp_st_' + st);
  if (!code) return html('Chưa kết nối', '<h2>Chưa kết nối</h2><p>' + esc(url.searchParams.get('error_description') || 'Bạn đã huỷ đăng nhập Facebook.') + '</p><a class="b" href="' + CRM_URL + '/#fanpage">Về CRM</a>');
  const app = await appCfg(x);
  try {
    const q = o => Object.entries(o).map(([k, v]) => k + '=' + encodeURIComponent(v)).join('&');
    const t1 = await (await fetch(GRAPH + 'oauth/access_token?' + q({ client_id: app.id, redirect_uri: CB_URL, client_secret: app.secret, code }))).json();
    if (!t1.access_token) throw new Error((t1.error && t1.error.message) || 'Không đổi được mã đăng nhập');
    const t2 = await (await fetch(GRAPH + 'oauth/access_token?' + q({ grant_type: 'fb_exchange_token', client_id: app.id, client_secret: app.secret, fb_exchange_token: t1.access_token }))).json(); // mã dài hạn → mã trang không hết hạn
    const pages = await savePages(x, await userPages(t2.access_token || t1.access_token));
    await flog(x, '', 'connect', { name: who, text: 'Kết nối ' + pages.length + ' trang: ' + pages.map(z => z.name).join(', ') });
    return html('Đã kết nối', '<h2>✅ Đã kết nối ' + pages.length + ' fanpage</h2><ul>' + pages.map(z => '<li>' + esc(z.name) + (z.err ? ' – ⚠️ ' + esc(z.err) : '') + '</li>').join('') + '</ul><p>Quay lại CRM để bật trợ lý cho từng trang.</p><a class="b" href="' + CRM_URL + '/#fanpage">Về CRM</a>');
  } catch (e) { return html('Lỗi', '<h2>Chưa kết nối được</h2><p>' + esc(e.message) + '</p><a class="b" href="' + CRM_URL + '/#fanpage">Về CRM</a>'); }
}
async function userPages(utoken) {
  const out = []; let next = GRAPH + 'me/accounts?fields=id,name,access_token&limit=100&access_token=' + encodeURIComponent(utoken);
  for (let i = 0; next && i < 10; i++) { const j = await (await fetch(next)).json(); if (j.error) throw new Error(j.error.message); out.push(...(j.data || [])); next = j.paging && j.paging.next; }
  return out.filter(z => z.access_token);
}
/** Lưu trang (trang mới: tắt, chờ bật ở CRM) + đăng ký nhận bình luận / tin nhắn */
async function savePages(x, list) {
  const now = Date.now(), out = [];
  for (const z of list) {
    let err = '';
    try { await graph(z.id + '/subscribed_apps', z.access_token, { subscribed_fields: FIELDS }); } catch (e) { err = 'Chưa đăng ký nhận sự kiện: ' + e.message; }
    await run(x.db, `INSERT INTO fp_pages (id, name, token, at, err) VALUES (?, ?, ?, ?, ?) ON CONFLICT(id) DO UPDATE SET name = excluded.name, token = excluded.token, at = excluded.at, err = excluded.err`, String(z.id), String(z.name || '').slice(0, 120), z.access_token, now, err.slice(0, 300));
    PG.delete(String(z.id)); out.push({ id: z.id, name: z.name, err });
  }
  return out;
}

/* ---------------------------------------------------------------- lịch: nhắc khách, đăng bài, soạn bài (cron 10 phút / lần, 7h–22h) */
export async function fpTick(x) {
  useEnv(x);
  const pages = await all(x.db, 'SELECT * FROM fp_pages WHERE active = 1'); if (!pages.length) return;
  const now = Date.now(), P = Object.fromEntries(pages.map(r => [r.id, Object.assign({}, r, { cfg: pageCfg(r.cfg) })]));
  // nhắc 1 lần: khách đã nhắn (cửa sổ 24 giờ đang mở) nhưng chưa để số, im 3 tiếng
  if (vnHour(now) >= 8 && vnHour(now) < 21) {
    for (const u of await all(x.db, "SELECT * FROM fp_users WHERE phone = '' AND nudged = 0 AND last_in BETWEEN ? AND ? AND pause < ? LIMIT 20", now - 22 * 3600e3, now - 3 * 3600e3, now)) {
      const p = P[u.page]; if (!p || !p.cfg.nudge) continue;
      await run(x.db, 'UPDATE fp_users SET nudged = 1 WHERE psid = ?', u.psid);
      const t = 'Dạ ' + given(u.name) + ' ơi, quà cẩm nang “Sống khỏe chủ động” em vẫn giữ cho mình nha 🎁 Mình bấm bên dưới để nhận, hoặc cần hỏi gì thêm cứ nhắn em ạ.';
      try { await send(x, p, u.psid, t, [{ content_type: 'text', title: '🎁 Nhận quà', payload: 'GIFT' }]); await flog(x, p.id, 'nudge', { name: u.name, reply: t }); } catch (e) { console.error('fp nudge', e.message); }
    }
  }
  const day = fmtDate(now, 'yyyyMMdd');
  // đăng bài tới giờ (trong 2 tiếng sau giờ hẹn)
  for (const r of await all(x.db, "SELECT * FROM fp_posts WHERE day = ? AND status IN ('draft', 'ok')", day)) {
    const p = P[r.page]; if (!p) continue;
    const t = slotTime(day, r.slot); if (now < t || now > t + 2 * 3600e3 || !String(r.text || '').trim()) continue;
    if (r.status === 'draft' && (p.cfg.mode !== 'auto' || !p.cfg.post || p.cfg.slots.indexOf(r.slot) < 0)) continue;
    await publish(x, p, r);
  }
  // soạn trước: mỗi lần chạy tối đa 1 bài
  if (!x.env.ANTHROPIC_API_KEY) return;
  const have = new Set((await all(x.db, 'SELECT id FROM fp_posts WHERE day IN (?, ?)', day, fmtDate(now + DAY, 'yyyyMMdd'))).map(r => r.id));
  for (const d of [day, fmtDate(now + DAY, 'yyyyMMdd')]) for (const p of Object.values(P)) {
    if (!p.cfg.post) continue;
    for (const sl of p.cfg.slots) {
      const id = p.id + '_' + d + '_' + sl.replace(':', '');
      if (have.has(id) || slotTime(d, sl) < now + 20 * 60e3) continue;
      try { await fpWrite(x, p, d, sl, '', ''); } catch (e) { console.error('fpWrite', e.message); await kvSet(x.db, 'fp_write_err', fmtDate(now, 'HH:mm dd/MM') + ' (' + p.name + '): ' + String(e.message).slice(0, 200)); }
      return;
    }
  }
}
async function publish(x, p, r) {
  const now = Date.now();
  await run(x.db, "UPDATE fp_posts SET status = 'sending', sent_at = ? WHERE id = ? AND status = ?", now, r.id, r.status); // chặn đăng trùng
  try {
    const body = { message: plain(r.text) }; if (r.link) body.link = r.link;
    const j = await graph(p.id + '/feed', p.token, body);
    await run(x.db, "UPDATE fp_posts SET status = 'sent', fb_id = ?, err = '' WHERE id = ?", String(j.id || ''), r.id);
    await flog(x, p.id, 'post', { name: p.name, text: r.topic || String(r.text).slice(0, 120), reply: j.id ? 'https://facebook.com/' + j.id : '' });
  } catch (e) {
    await run(x.db, "UPDATE fp_posts SET status = 'err', err = ? WHERE id = ?", String(e.message).slice(0, 300), r.id);
    await flog(x, p.id, 'error', { name: p.name, text: 'Không đăng được bài: ' + e.message });
    await pageErr(x, p, e);
    await telegram(x.env, '⚠️ <b>Fanpage “' + esc(p.name) + '” chưa đăng được bài</b> ' + esc(r.slot) + '\n' + esc(e.message) + '\n👉 ' + CRM_URL + '/#fanpage');
  }
}

/** AI soạn 1 bài cho 1 trang (hint: ý nhân sự gõ khi bấm "Viết lại") */
async function fpWrite(x, p, day, slot, hint, by) {
  const know = await kb(), prods = prodMap(know), wd = new Date(slotTime(day, '12:00') + TZ_MS).getUTCDay(), c = p.cfg;
  const si = Math.max(0, c.slots.indexOf(slot)), theme = FP_THEME[(wd + si * 3) % 7];
  const recent = await all(x.db, "SELECT page, day, topic FROM fp_posts WHERE topic != '' AND day >= ? ORDER BY day DESC LIMIT 30", fmtDate(Date.now() - 8 * DAY, 'yyyyMMdd'));
  const ask = [
    'Viết 1 bài đăng cho fanpage Facebook "' + p.name + '" của Thực Dưỡng Lành.',
    c.voice ? 'Trang này: ' + c.voice : 'Người theo dõi phần lớn là cô chú trung niên, mẹ bỉm, người ăn chay, dân văn phòng quan tâm sống khỏe.',
    'Ngày: ' + ['Chủ nhật', 'Thứ 2', 'Thứ 3', 'Thứ 4', 'Thứ 5', 'Thứ 6', 'Thứ 7'][wd] + ' ' + day.slice(6, 8) + '/' + day.slice(4, 6) + ', đăng lúc ' + slot + '.',
    'Chủ đề: ' + theme + (hint ? '\nYêu cầu thêm của nhân sự: ' + hint : ''),
    recent.length ? 'Các bài gần đây của mọi fanpage (KHÔNG lặp lại chủ đề / nguyên liệu / món / sản phẩm đã viết):\n' + recent.map(r => '- ' + r.day.slice(6, 8) + '/' + r.day.slice(4, 6) + ': ' + r.topic).join('\n') : '',
    '',
    'Cách viết cho Facebook: dòng đầu là câu mở thu hút (câu hỏi, điều bất ngờ, hình ảnh gần gũi), không giật tít, không hù dọa bệnh tật. 100–200 chữ, đoạn ngắn 1–2 câu, mỗi ý bắt đầu bằng 1 emoji. KHÔNG dùng dấu ** hay # (Facebook không hiện). Giọng ấm áp, gần gũi, kính trọng, xưng "Thực Dưỡng Lành" hoặc "em".',
    c.cta && c.reply ? 'Kết bài bằng 1 dòng mời bình luận để nhận quà, đổi cách nói mỗi bài, ví dụ: "Bình luận “QUÀ” để em gửi tặng cẩm nang Sống khỏe chủ động miễn phí nha 🎁".' : 'Kết bằng 1 câu hỏi nhẹ mời mọi người chia sẻ.',
    'Đúng sự thật: thông tin sản phẩm, thành phần, giá, ưu đãi CHỈ lấy từ TÀI LIỆU. Kiến thức chung chỉ nói điều phổ thông, an toàn, không số liệu nghiên cứu, không trích dẫn chuyên gia, không bịa câu chuyện / cảm nhận khách hàng.',
    'Không dùng các từ "chữa", "điều trị", "khỏi bệnh", "đặc trị", "thay thuốc", "thần dược". Nếu bài nói về sản phẩm: thêm 1 dòng cuối "Sản phẩm là thực phẩm, không phải là thuốc và không có tác dụng thay thế thuốc chữa bệnh."',
    'Không để link, không để số điện thoại trong bài (hệ thống tự gắn link sản phẩm).',
    '',
    'Trả về đúng định dạng:\nCHỦ ĐỀ: <tóm tắt chủ đề trong 10 chữ, nêu rõ nguyên liệu / món / sản phẩm>\nSẢN PHẨM: <mã sản phẩm dạng chữ-thường-gạch-ngang nếu bài nói chủ yếu về 1 sản phẩm, không thì ghi "không">\n---\n<nội dung bài>'
  ].filter(s => s !== null).join('\n');
  const req = { model: WRITER, max_tokens: 4000, output_config: { effort: 'medium' },
    system: [{ type: 'text', text: 'Bạn viết bài cho fanpage Facebook của Thực Dưỡng Lành (VitaGreen Nutrition). Tiếng Việt chuẩn, tự nhiên.\n' + TRUTH_RULES },
      { type: 'text', text: 'TÀI LIỆU (thông tin chính thức của Thực Dưỡng Lành):\n\n' + know, cache_control: { type: 'ephemeral' } }],
    messages: [{ role: 'user', content: ask }] };
  let res; // bị bộ lọc an toàn từ chối nhầm → máy chủ Anthropic tự chuyển mô hình dự phòng (như zbot.js)
  try { res = await ai(x.env).beta.messages.create(Object.assign({ betas: ['server-side-fallback-2026-07-01'], fallbacks: 'default' }, req)); }
  catch (e) { if (!(e instanceof Anthropic.BadRequestError)) throw e; res = await ai(x.env).messages.create(req); }
  if (res.stop_reason === 'refusal') throw new Error('AI từ chối viết bài');
  const raw = textOf(res), parts = raw.split(/\n-{3,}\n/);
  const head = parts.length > 1 ? parts[0] : '', body = plain(safe((parts.length > 1 ? parts.slice(1).join('\n---\n') : raw).trim()));
  const topic = ((head.match(/CHỦ ĐỀ:\s*(.+)/) || [])[1] || body.split('\n')[0]).replace(/\*/g, '').trim().slice(0, 120);
  const code = ((head.match(/SẢN PHẨM:\s*([a-z0-9-]+)/) || [])[1] || '');
  if (!body) throw new Error('AI chưa viết được bài');
  const camp = nrm(p.name).replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 40) || 'fanpage';
  const link = prods[code] ? prods[code].url + '?utm_source=facebook&utm_medium=fanpage&utm_campaign=' + camp : '';
  const id = p.id + '_' + day + '_' + slot.replace(':', ''), now = Date.now();
  await run(x.db, `INSERT INTO fp_posts (id, page, day, slot, topic, text, link, prod, status, by_name, at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'draft', ?, ?)
    ON CONFLICT(id) DO UPDATE SET topic = excluded.topic, text = excluded.text, link = excluded.link, prod = excluded.prod, status = 'draft', by_name = excluded.by_name, at = excluded.at, err = ''`,
    id, p.id, day, slot, topic, body.slice(0, 5000), link, prods[code] ? code : '', by || 'AI', now);
  if (c.mode !== 'auto' && !by) x.later(telegram(x.env, '📝 <b>Bài fanpage chờ duyệt</b> – ' + esc(p.name) + ' · ' + slot + ' ' + day.slice(6, 8) + '/' + day.slice(4, 6) + ': ' + esc(topic) + '\n👉 Duyệt / sửa: ' + CRM_URL + '/#fanpage'));
  return { id, topic };
}

/* ---------------------------------------------------------------- CRM → tab 📘 Fanpage (Quản lý, Quản trị, Marketing; kết nối ứng dụng: Quản trị) */
export async function crmFp(x, u, d, crmLog) {
  useEnv(x);
  if (u.level < 2 && u.role !== 'Marketing') return { ok: false, error: 'Chỉ Quản lý, Quản trị và Marketing dùng được Trợ lý Fanpage.' };
  const a = d.action, now = Date.now(), admin = u.level >= 3;
  if (['fp_app', 'fp_connect', 'fp_ptoken', 'fp_del'].includes(a) && !admin) return { ok: false, error: 'Chỉ Quản trị kết nối / gỡ fanpage được.' };
  if (a === 'fp_view') {
    const app = await appCfg(x), from = fmtDate(now - DAY, 'yyyyMMdd');
    const pages = (await all(x.db, 'SELECT id, name, active, cfg, at, err, last_ev FROM fp_pages ORDER BY name')).map(r => Object.assign({}, r, { cfg: pageCfg(r.cfg) }));
    const posts = await all(x.db, 'SELECT id, page, day, slot, topic, text, link, prod, status, by_name, at, sent_at, fb_id, err FROM fp_posts WHERE day >= ? ORDER BY day, slot, page', from);
    const log = await all(x.db, 'SELECT at, page, kind, name, text, reply FROM fp_log ORDER BY rid DESC LIMIT 80');
    const stats = await all(x.db, 'SELECT kind, count(*) AS n FROM fp_log WHERE at > ? GROUP BY kind', now - 7 * DAY);
    const talk = await first(x.db, "SELECT count(*) AS n FROM fp_users WHERE last_in > ?", now - 7 * DAY);
    return { ok: true, app: { id: app.id, secret: !!app.secret, verify: admin ? app.verify : '', config: app.config, hook: HOOK_URL, cb: CB_URL, verified: Number(await kvGet(x.db, 'fp_verified')) || 0 },
      pages, posts, log, stats, talk: talk ? talk.n : 0, err: await kvGet(x.db, 'fp_write_err'), aiOn: !!x.env.ANTHROPIC_API_KEY, admin, now };
  }
  if (a === 'fp_app') {
    const app = await appCfg(x), id = String(d.appId || '').replace(/\D/g, ''), sec = String(d.secret || '').trim();
    if (!id) return { ok: false, error: 'Thiếu App ID (dãy số trong trang ứng dụng Meta).' };
    if (sec && !/^[a-f0-9]{32}$/i.test(sec)) return { ok: false, error: 'App Secret chưa đúng (32 ký tự chữ và số).' };
    app.id = id; if (sec) app.secret = sec; app.config = String(d.config || '').replace(/\D/g, '');
    if (!app.verify) app.verify = 'tdl' + randHex(12);
    await kvSet(x.db, 'fp_app', JSON.stringify(app));
    await crmLog(x, u, 'Cài đặt ứng dụng Facebook', '', '', 'App ' + id, sec ? 'Đổi App Secret' : '');
    return { ok: true };
  }
  if (a === 'fp_connect') { // link đăng nhập Facebook để chọn trang
    const app = await appCfg(x); if (!app.id || !app.secret) return { ok: false, error: 'Nhập App ID và App Secret trước.' };
    const st = randHex(12); await kvSet(x.db, 'fp_st_' + st, u.name, 20 * 60e3);
    const q = new URLSearchParams({ client_id: app.id, redirect_uri: CB_URL, state: st, response_type: 'code' });
    if (app.config) q.set('config_id', app.config); else q.set('scope', SCOPES); // ứng dụng loại Doanh nghiệp: Facebook Login for Business dùng config_id
    return { ok: true, url: 'https://www.facebook.com/v23.0/dialog/oauth?' + q };
  }
  if (a === 'fp_ptoken') { // dán mã truy cập trang (lấy ở trang ứng dụng Meta → Messenger → Tạo mã) hoặc mã người dùng
    const tk = String(d.ptk || '').trim(); if (tk.length < 40) return { ok: false, error: 'Mã truy cập chưa đúng.' };
    let list, miss = [];
    try { // debug_token (mã ứng dụng = App ID|App Secret): biết loại mã + quyền mà không cần quyền đọc trang
      const app = await appCfg(x); if (!app.id || !app.secret) return { ok: false, error: 'Lưu App ID và App Secret trước.' };
      const dbg = (await graph('debug_token?input_token=' + encodeURIComponent(tk), app.id + '|' + app.secret)).data || {};
      if (!dbg.is_valid) return { ok: false, error: 'Mã đã hết hạn hoặc không đúng ứng dụng Trợ lý Thực Dưỡng Lành. Tạo mã mới rồi dán lại.' };
      if (String(dbg.app_id) !== String(app.id)) return { ok: false, error: 'Mã này của ứng dụng khác (không phải App ID ' + app.id + ').' };
      miss = PERMS.filter(s => (dbg.scopes || []).indexOf(s) < 0);
      if (dbg.type === 'PAGE') {
        const id = String(dbg.profile_id || ''); let name = '';
        try { name = (await graph('me?fields=name', tk)).name || ''; } catch (e) { } // thiếu pages_read_engagement thì không đọc được tên
        list = [{ id, name: name || 'Fanpage ' + id, access_token: tk }];
      } else { // mã người dùng (vd Graph API Explorer, hết hạn sau 1 giờ) → đổi mã dài hạn → mã trang không hết hạn
        let long = tk;
        try { const j = await graph('oauth/access_token?grant_type=fb_exchange_token&client_id=' + app.id + '&client_secret=' + app.secret + '&fb_exchange_token=' + encodeURIComponent(tk), app.id + '|' + app.secret); if (j.access_token) long = j.access_token; } catch (e) { }
        list = await userPages(long);
      }
    } catch (e) { return { ok: false, error: 'Facebook không nhận mã này: ' + e.message }; }
    if (!list.length) return { ok: false, error: 'Mã này không quản lý fanpage nào.' };
    const pages = await savePages(x, list);
    await crmLog(x, u, 'Kết nối fanpage', '', '', pages.length + ' trang', pages.map(z => z.name).join(', ') + (miss.length ? ' · thiếu quyền: ' + miss.join(', ') : ''));
    return { ok: true, pages, miss };
  }
  if (a === 'fp_page') { // bật / tắt + cài đặt 1 trang
    const r = await first(x.db, 'SELECT * FROM fp_pages WHERE id = ?', String(d.id || '')); if (!r) return { ok: false, error: 'Không tìm thấy trang.' };
    const c = pageCfg(r.cfg), n = d.cfg || {};
    for (const k of ['reply', 'like', 'dm', 'hide', 'ai', 'nudge', 'post', 'cta']) if (n[k] !== undefined) c[k] = !!n[k];
    if (n.mode === 'auto' || n.mode === 'approve') c.mode = n.mode;
    if (n.kw !== undefined) c.kw = String(n.kw).slice(0, 300);
    if (Array.isArray(n.replies)) { const rs = n.replies.map(s => String(s).trim().slice(0, 300)).filter(Boolean).slice(0, 12); if (rs.length) c.replies = rs; }
    for (const k of ['dm_text', 'gift_msg', 'voice']) if (n[k] !== undefined) c[k] = String(n[k]).slice(0, 1500);
    if (!String(c.gift_msg).trim()) c.gift_msg = PCFG0.gift_msg;
    for (const k of ['gift_link', 'group']) if (n[k] !== undefined) { const v = String(n[k]).trim(); c[k] = /^https:\/\/\S+$/.test(v) ? v.slice(0, 300) : PCFG0[k]; }
    if (Array.isArray(n.slots)) c.slots = [...new Set(n.slots.map(s => String(s).trim()).filter(s => /^\d{1,2}:\d{2}$/.test(s)).map(s => s.padStart(5, '0')))].slice(0, 4).sort();
    const active = d.active === undefined ? r.active : d.active ? 1 : 0;
    await run(x.db, 'UPDATE fp_pages SET cfg = ?, active = ? WHERE id = ?', JSON.stringify(c), active, r.id); PG.delete(r.id);
    await crmLog(x, u, 'Cài đặt fanpage', r.id, r.name, active ? 'Bật' : 'Tắt', '');
    return { ok: true };
  }
  if (a === 'fp_resub' || a === 'fp_del') {
    const r = await first(x.db, 'SELECT * FROM fp_pages WHERE id = ?', String(d.id || '')); if (!r) return { ok: false, error: 'Không tìm thấy trang.' };
    if (a === 'fp_resub') { try { await graph(r.id + '/subscribed_apps', r.token, { subscribed_fields: FIELDS }); await run(x.db, "UPDATE fp_pages SET err = '' WHERE id = ?", r.id); PG.delete(r.id); return { ok: true }; } catch (e) { return { ok: false, error: e.message }; } }
    try { await graph(r.id + '/subscribed_apps', r.token, undefined, 'DELETE'); } catch (e) { }
    await run(x.db, 'DELETE FROM fp_pages WHERE id = ?', r.id); PG.delete(r.id);
    await crmLog(x, u, 'Gỡ fanpage', r.id, r.name, '', ''); return { ok: true };
  }
  if (a === 'fp_post') { // sửa / duyệt / bỏ / dùng lại
    const p = await first(x.db, 'SELECT * FROM fp_posts WHERE id = ?', String(d.id || '')); if (!p) return { ok: false, error: 'Không tìm thấy bài.' };
    if (p.status === 'sent' || p.status === 'sending') return { ok: false, error: 'Bài này đã đăng rồi.' };
    const st = ['draft', 'ok', 'skip'].includes(d.status) ? d.status : p.status === 'err' ? 'draft' : p.status;
    const text = d.text === undefined ? p.text : String(d.text).slice(0, 5000), link = d.link === undefined ? p.link : /^https:\/\/\S+$/.test(String(d.link).trim()) ? String(d.link).trim().slice(0, 500) : '';
    await run(x.db, "UPDATE fp_posts SET text = ?, link = ?, status = ?, by_name = ?, at = ?, err = '' WHERE id = ?", text, link, st, u.name, now, p.id);
    await crmLog(x, u, 'Bài fanpage', p.id, '', { ok: 'Duyệt', skip: 'Bỏ', draft: 'Sửa' }[st] || st, p.topic);
    return { ok: true };
  }
  if (a === 'fp_now') { // đăng ngay
    const r = await first(x.db, 'SELECT * FROM fp_posts WHERE id = ?', String(d.id || '')); if (!r) return { ok: false, error: 'Không tìm thấy bài.' };
    if (r.status === 'sent' || r.status === 'sending') return { ok: false, error: 'Bài này đã đăng rồi.' };
    const p = await pageGet(x, r.page); if (!p) return { ok: false, error: 'Trang đã bị gỡ.' };
    await publish(x, p, r);
    const after = await first(x.db, 'SELECT status, err FROM fp_posts WHERE id = ?', r.id);
    await crmLog(x, u, 'Đăng bài fanpage', r.id, p.name, after.status === 'sent' ? 'Đã đăng' : 'Lỗi', r.topic);
    return after.status === 'sent' ? { ok: true } : { ok: false, error: 'Chưa đăng được: ' + after.err };
  }
  if (a === 'fp_regen') {
    const old = await first(x.db, 'SELECT page, day, slot, status FROM fp_posts WHERE id = ?', String(d.id || ''));
    const pid = old ? old.page : String(d.page || ''), day = old ? old.day : String(d.day || ''), slot = old ? old.slot : String(d.slot || '');
    if (!/^\d{8}$/.test(day) || !/^\d\d:\d\d$/.test(slot)) return { ok: false, error: 'Thiếu ngày / giờ.' };
    if (old && (old.status === 'sent' || old.status === 'sending')) return { ok: false, error: 'Bài này đã đăng rồi.' };
    if (!x.env.ANTHROPIC_API_KEY) return { ok: false, error: 'Máy chủ chưa có khoá AI.' };
    const p = await pageGet(x, pid); if (!p) return { ok: false, error: 'Không tìm thấy trang.' };
    const dk = 'fp_regen_' + fmtDate(now, 'yyMMdd'), n = Number(await kvGet(x.db, dk) || 0);
    if (n >= 40) return { ok: false, error: 'Hôm nay đã viết lại 40 lần, mai thử tiếp nhé.' };
    await kvSet(x.db, dk, String(n + 1), 2 * DAY);
    try { const r = await fpWrite(x, p, day, slot, String(d.hint || '').slice(0, 300), u.name); return { ok: true, id: r.id }; }
    catch (e) { return { ok: false, error: 'AI chưa viết được: ' + e.message }; }
  }
  if (a === 'fp_send') { // nhân sự tự viết bài: đăng ngay / hẹn giờ, 1 hoặc nhiều trang
    const text = String(d.text || '').trim().slice(0, 5000); if (text.length < 5) return { ok: false, error: 'Nội dung quá ngắn.' };
    const link = /^https:\/\/\S+$/.test(String(d.link || '').trim()) ? String(d.link).trim().slice(0, 500) : '';
    const at = d.at ? new Date(String(d.at) + ':00+07:00').getTime() : now; if (isNaN(at)) return { ok: false, error: 'Giờ hẹn chưa đúng.' };
    const ids = Array.isArray(d.pages) ? d.pages.map(String) : []; if (!ids.length) return { ok: false, error: 'Chọn ít nhất 1 trang.' };
    const t = Math.max(at, now), day = fmtDate(t, 'yyyyMMdd'), slot = fmtDate(t, 'HH:mm'), errs = [];
    for (const pid of ids) {
      const p = await pageGet(x, pid); if (!p) continue;
      const id = pid + '_' + day + '_' + slot.replace(':', '') + 'n' + randHex(2);
      await run(x.db, "INSERT INTO fp_posts (id, page, day, slot, topic, text, link, status, by_name, at) VALUES (?, ?, ?, ?, ?, ?, ?, 'ok', ?, ?)", id, pid, day, slot, 'Nhân sự viết: ' + text.split('\n')[0].slice(0, 80), safe(text), link, u.name, now);
      if (t <= now + 60e3) { await publish(x, p, await first(x.db, 'SELECT * FROM fp_posts WHERE id = ?', id)); const r = await first(x.db, 'SELECT status, err FROM fp_posts WHERE id = ?', id); if (r.status !== 'sent') errs.push(p.name + ': ' + r.err); }
    }
    await crmLog(x, u, 'Viết bài fanpage', '', '', at > now + 60e3 ? 'Hẹn ' + fmtDate(at, 'HH:mm dd/MM') : 'Đăng ngay', text.slice(0, 200));
    return errs.length ? { ok: false, error: 'Chưa đăng được: ' + errs.join(' · ') } : { ok: true };
  }
  return { ok: false, error: 'Không rõ thao tác: ' + a };
}
