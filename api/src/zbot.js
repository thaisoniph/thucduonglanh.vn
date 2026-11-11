/* ================================================================ 🤖 Trợ lý An Lành trong nhóm Zalo (26/10/2026, anh Sơn chọn cách B: tài khoản Zalo phụ "Trợ lý An Lành" chạy tự động)
 * Chương trình giữ tài khoản Zalo nằm ở thư mục zalo-bot/ (chạy trên máy Mac / máy chủ nhỏ, thư viện zca-js). Nó chỉ "nghe – nói": mọi quyết định nằm ở đây.
 * Chương trình gửi POST { type: 'zbot', key: ZBOT_KEY, ev, ... } tới api.thucduonglanh.vn:
 *   poll   (45 giây/lần) – báo đang chạy + danh sách người xin vào nhóm → trả cài đặt, việc cần làm (bài đăng, chào, tìm Zalo theo số), danh sách tự duyệt
 *   ack    – báo việc đã làm xong (kết quả tìm Zalo theo số: uid)
 *   join   – có người vào nhóm → trả lời chào (gọi tên @…), CRM đánh dấu khách "Đã vào" nhóm
 *   msg    – tin nhắn trong nhóm → AI quyết định: trả lời / thả tim / im lặng
 *   dm     – khách nhắn riêng cho trợ lý → trả lời như An Lành trên web (lịch sử ở bảng chats, sid 'zl' + uid)
 *   friend – khách gửi lời mời kết bạn → đồng ý + lời chào
 *   login  – tài khoản bị đăng xuất, cần quét mã QR → báo Telegram
 * Bài đăng hằng ngày: cron (zbotTick) soạn trước bằng AI theo lịch chủ đề trong tuần + bước 🎯 insight (insight.js: nhóm khách + tension, xoay vòng nhóm), lưu bảng zb_posts → nhân sự xem / sửa / bỏ ở CRM → tab 🤖 Trợ lý Zalo.
 * 📋 Kế hoạch chủ đề (10/11/2026, anh Sơn): bảng zb_plan = chủ đề cụ thể từng bài (tuần / tháng, theo 3 tầng phễu) → anh Sơn + người phụ trách duyệt trước → trợ lý viết bài đúng chủ đề đã duyệt.
 *   Soạn bài trước cfg.lead ngày (mặc định 3). Chủ đề chưa duyệt thì chờ, tới 24 tiếng trước giờ đăng mới viết theo chủ đề nháp. Mỗi bài đặt được giờ đăng riêng (zb_posts.at_time / zb_plan.at_time).
 *   Chế độ 'auto': tới giờ tự đăng (trừ bài đã bấm Bỏ). Chế độ 'approve': chỉ đăng bài đã bấm Duyệt.
 * Báo đăng ký (như nhóm Sống Khỏe 365): khách để số trên web mà đang ở trong nhóm → trợ lý chúc mừng @tên trong nhóm (chỉ tên Zalo + quà đã nhận, không số điện thoại, không bệnh).
 * Tự duyệt người xin vào nhóm: chỉ người đã để số qua web (tìm được tài khoản Zalo theo số) – người lạ báo Telegram để nhân sự duyệt tay (cổng nhóm 17/10/2026).
 * Chi phí AI: trả lời, chào dùng claude-haiku-5-5 (vài chục đồng/lần); bài đăng dùng claude-opus-5-5 (~2.500đ/bài, 2 bài/ngày ≈ 150k/tháng). */
import Anthropic from '@anthropic-ai/sdk';
import { aiFetch } from './airelay.js';
import { esc, run, all, first, kvGet, kvSet, kvJson, normPhone, fmtDate, isVoid, nrm, fmt, CRM_URL, TZ_MS, DAY } from './lib.js';
import { telegram } from './google.js';
import { addLead, telegramUser } from './crm.js';
import { kb, safe, workNow, TRUTH_RULES, REF_RULES, REF_TXT, PHONE_RE } from './chat.js';
import { botRef } from './partner.js';
import { offersLive } from './salemkt.js';
import { lunar } from './lunar.js';
import { dayTheme, upcoming, addDay, weekday } from './zday.js';
import { insPick, insBlock, insParse, insLog, insBank, insRisk, insViet, insStyle, INS_HEAD, FUN, spName } from './insight.js';

const BOT = 'An Lành';
const FAST = 'claude-haiku-5-5', WRITER = 'claude-opus-5-5';
const SITE = 'https://thucduonglanh.vn', API_URL = 'https://api.thucduonglanh.vn';
const RECALL_VER = '2026-11-11a'; // chương trình Zalo từ bản này mới gửi mã tin khi đăng + làm việc 'undo' (thu hồi)
const CFG0 = {
  on: true, groups: [], // nhóm trợ lý chăm sóc (mã nhóm Zalo). Trống → lần đầu tự chọn nhóm có tên "Thực Dưỡng Lành"
  welcome: true, answer: true, announce: true, approve: true, approveAll: false,
  mode: 'approve', // approve: chỉ đăng bài đã duyệt (anh Sơn chọn 27/10/2026) · auto: tới giờ tự đăng bài nháp
  lead: 3, // soạn bài trước mấy ngày (anh Sơn 10/11/2026: hiện trước 2–3 ngày để nhân sự kịp duyệt)
  planAuto: true, // 📋 tự lập kế hoạch chủ đề tuần kế tiếp (chờ duyệt)
  slots: [{ id: 'sang', at: '07:30', on: true }, { id: 'toi', at: '20:00', on: true }],
  maxHour: 8 // số câu trả lời tối đa / nhóm / giờ (tránh "nói nhiều", Zalo khoá)
};
const SLOT_NAME = { sang: 'Bài sáng', toi: 'Bài tối' };
/** 🧪 Thử giờ đăng bài sáng (anh Sơn duyệt 05/11/2026): mỗi khung 1 tuần, cùng chủ đề theo thứ → so người tương tác trung bình rồi chốt 1 giờ */
export const TIME_TRIAL = [{ from: '20261110', to: '20261116', slot: 'sang', at: '06:15' }, { from: '20261117', to: '20261123', slot: 'sang', at: '09:00' }];
const slotAt = (sl, day) => { const t = TIME_TRIAL.find(z => z.slot === sl.id && day >= z.from && day <= z.to); return t ? t.at : sl.at; };
/** ⏰ Giờ đăng hợp lệ (10/11/2026: nhân sự hẹn giờ riêng từng bài): bài sáng 06:00–11:59, bài tối 12:00–21:45 (21h45–6h trợ lý không đăng). Trả 'HH:mm' hoặc '' nếu sai */
export function okTime(slot, at) {
  const m = String(at || '').trim().match(/^(\d{1,2})[:hH](\d{2})$/); if (!m) return '';
  const h = +m[1], mi = +m[2], v = h * 60 + mi; if (mi > 59 || v < 360 || v > 21 * 60 + 45 || (slot === 'toi' ? v < 720 : v >= 720)) return '';
  return String(h).padStart(2, '0') + ':' + String(mi).padStart(2, '0');
}
const TIME_RULE = { sang: 'Bài sáng đăng từ 6:00 đến 11:59.', toi: 'Bài tối đăng từ 12:00 đến 21:45 (sau 21h45 trợ lý không đăng vào nhóm).' };
const leadOf = cfg => Math.max(1, Math.min(3, Number(cfg.lead) || 3));
// Lịch chủ đề trong tuần (0 = Chủ nhật). Sửa ở đây là bài soạn sau sẽ theo.
/** Lịch chủ đề theo phễu nội dung (31/10/2026, anh Sơn duyệt): người trong nhóm đã để số nhận quà → nhóm chủ yếu giữ chân + tạo niềm tin, bán vừa phải.
 * TOFU 🔵 tương tác, giá trị (8 bài/tuần) · MOFU ⚪ tạo niềm tin (4 bài) · BOFU 🟠 chuyển đổi (2 bài). Chỉ số = thứ trong tuần (0 = Chủ nhật). */
const THEME = {
  // 11/11/2026 (khoá K133): buổi sáng KHÔNG đăng bài bán (sáng là giờ kiến thức, trend); bài bán chỉ buổi tối Thứ 3 và Thứ 7, không 2 tối bán liền nhau
  sang: [
    { f: 'TOFU', t: 'Tâm an cuối tuần: lời chúc nhẹ nhàng + 1 suy ngẫm ngắn về sống chậm, biết ơn, gia đình (không bịa chuyện khách hàng)' },
    { f: 'MOFU', t: 'Kiến thức dinh dưỡng nền tảng: 1 điều dễ hiểu, áp dụng được ngay trong bữa ăn gia đình' },
    { f: 'MOFU', t: 'Ly sáng có gì: giới thiệu 1–3 nguyên liệu có trong 1 sản phẩm (đúng thành phần trong tài liệu), vị, cách người Việt quen dùng' },
    { f: 'TOFU', t: 'Bếp lành: 1 món ăn / thức uống lành, dễ làm, nguyên liệu dễ mua (có thể là món chay)' },
    { f: 'MOFU', t: 'Mở đầu bằng ĐÁP ÁN câu đố tối qua (giải thích ngắn, cảm ơn mọi người đã trả lời), rồi hỏi đáp: chọn 1 câu khách hay hỏi trong phần hỏi đáp của 1 sản phẩm và trả lời rõ ràng, gần gũi', quiz: 1 },
    { f: 'TOFU', t: 'Thói quen sống lành: ngủ, vận động nhẹ, uống nước, thở, ăn chậm… 1 việc nhỏ làm được hôm nay' },
    { f: 'TOFU', t: 'Sáng cuối tuần: mời mọi người khoe bữa sáng / mâm cơm lành cuối tuần của nhà mình, hoặc rủ cả nhà cùng nấu 1 món lành hôm nay' }],
  toi: [
    { f: 'TOFU', t: 'Chúc cả nhà tuần mới bình an + 1 câu hỏi nhỏ để mọi người chia sẻ' },
    { f: 'TOFU', t: 'Câu hỏi tương tác: hỏi thói quen ăn uống / sinh hoạt của mọi người, dễ trả lời 1 dòng' },
    { f: 'BOFU', t: 'Nhắc nhẹ giữa tuần: ưu đãi đang chạy (nếu có) hoặc hướng dẫn đặt hàng trên web 3 bước (được kiểm hàng trước khi nhận, freeship từ 300k), không thúc ép; để 1 link sản phẩm hợp nhất', link: 1 },
    { f: 'TOFU', q: 1, t: 'Mini đố vui về dinh dưỡng (1 câu, 3 lựa chọn A/B/C, đáp án là kiến thức phổ thông chắc chắn đúng), mời mọi người trả lời bằng 1 chữ cái, hẹn sáng mai công bố đáp án' },
    { f: 'MOFU', t: 'Câu chuyện khách hàng thật: dựa ĐÚNG vào CẢM NHẬN KHÁCH HÀNG được cung cấp bên dưới (không thêm thắt, không nói về bệnh / công dụng chữa trị), kể ngắn gọn ấm áp, cảm ơn khách đã chia sẻ, mời mọi người kể trải nghiệm của mình', fb: 1 },
    { f: 'TOFU', t: 'Mẹo nhỏ buổi tối: 1 mẹo để ngủ ngon / thư giãn / chuẩn bị bữa sáng mai' },
    { f: 'BOFU', t: 'Góc sản phẩm cuối tuần: giới thiệu nhẹ nhàng 1 sản phẩm (ai hợp, cách dùng, quy cách, giá đúng tài liệu) + ưu đãi đang chạy nếu có; nhắc đặt trên web được kiểm hàng trước khi nhận, freeship đơn từ 300k; để 1 link sản phẩm', link: 1 }]
};
/** Chủ đề theo thứ trong tuần cho 1 ngày (ngày lễ, rằm, mùng 1 đổi chủ đề ở zday.js) */
const baseTheme = (day, slot) => THEME[slot === 'toi' ? 'toi' : 'sang'][weekday(day)];
/** 31/10/2026 11:14: chương trình Zalo bắt đầu đếm tương tác; bài trước giờ này không có số đo (không tính vào thống kê) */
const TRACK_FROM = Date.UTC(2026, 9, 31, 4, 14);
const FUNNEL = { TOFU: '🔵 Nhận biết – tương tác', MOFU: '⚪ Cân nhắc – tạo niềm tin', BOFU: '🟠 Chuyển đổi – bán hàng' };

let client = null;
function ai(env) { if (!client) client = new Anthropic({ apiKey: env.ANTHROPIC_API_KEY, maxRetries: 2, timeout: 60e3, fetch: aiFetch(env), defaultHeaders: { 'x-tdl-muc': 'zalo' } }); return client; } // qua trạm Bắc Mỹ (airelay.js)
const textOf = res => res.content.filter(b => b.type === 'text').map(b => b.text).join('\n').trim();

export async function zbotSchema(db) {
  await run(db, `CREATE TABLE IF NOT EXISTS zb_users (uid TEXT PRIMARY KEY, phone TEXT DEFAULT '', name TEXT DEFAULT '', zname TEXT DEFAULT '', lead TEXT DEFAULT '', what TEXT DEFAULT '',
    at INTEGER, joined INTEGER, gid TEXT DEFAULT '', pend INTEGER DEFAULT 0)`); // tài khoản Zalo ↔ số điện thoại khách (tìm theo số khách để lại trên web)
  await run(db, 'CREATE INDEX IF NOT EXISTS zb_users_phone ON zb_users(phone)');
  try { await run(db, 'ALTER TABLE zb_users ADD COLUMN friend INTEGER'); } catch (e) { } // 05/11/2026: lúc khách kết bạn với trợ lý (đo % người vào nhóm kết bạn)
  await run(db, `CREATE TABLE IF NOT EXISTS zb_out (id INTEGER PRIMARY KEY AUTOINCREMENT, kind TEXT, gid TEXT DEFAULT '', uid TEXT DEFAULT '', phone TEXT DEFAULT '', text TEXT DEFAULT '',
    img TEXT DEFAULT '', mentions TEXT DEFAULT '', due INTEGER, status TEXT DEFAULT 'new', at INTEGER, done_at INTEGER, ref TEXT DEFAULT '')`); // việc chờ chương trình Zalo làm
  await run(db, 'CREATE INDEX IF NOT EXISTS zb_out_due ON zb_out(status, due)');
  for (const c of ["msgs TEXT DEFAULT ''", 'undone INTEGER DEFAULT 0']) { try { await run(db, 'ALTER TABLE zb_out ADD COLUMN ' + c); } catch (e) { } } // 11/11/2026: mã tin Zalo đã đăng [{m, c}] để ↩️ thu hồi; undone = đã thu hồi
  await run(db, 'CREATE TABLE IF NOT EXISTS zb_imgs (id TEXT PRIMARY KEY, data TEXT, at INTEGER)'); // ảnh nhân sự tải lên cho bài đăng (data:image/jpeg;base64…), xem ở api.thucduonglanh.vn/zb-img/<id>
  await run(db, `CREATE TABLE IF NOT EXISTS zb_posts (id TEXT PRIMARY KEY, day TEXT, slot TEXT, topic TEXT DEFAULT '', text TEXT DEFAULT '', img TEXT DEFAULT '', prod TEXT DEFAULT '',
    status TEXT DEFAULT 'draft', by_name TEXT DEFAULT '', at INTEGER, sent_at INTEGER)`); // bài đăng hằng ngày (id = yyyyMMdd_slot)
  await run(db, 'CREATE INDEX IF NOT EXISTS zb_posts_day ON zb_posts(day)');
  for (const c of ["funnel TEXT DEFAULT ''", 'eng_msgs INTEGER DEFAULT 0', 'eng_people INTEGER DEFAULT 0', 'eng_reacts INTEGER DEFAULT 0', "ev TEXT DEFAULT ''", "ins TEXT DEFAULT ''", "at_time TEXT DEFAULT ''", "plan TEXT DEFAULT ''"]) { try { await run(db, 'ALTER TABLE zb_posts ADD COLUMN ' + c); } catch (e) { } } // 31/10/2026: nhãn phễu + tương tác 2 tiếng sau khi đăng · 09/11/2026: ev = tên dịp lễ (zday.js) · 10/11/2026: ins = nhóm khách + tension bài nhắm tới (insight.js, JSON)
  await run(db, `CREATE TABLE IF NOT EXISTS zb_log (rid INTEGER PRIMARY KEY AUTOINCREMENT, at INTEGER, kind TEXT, gid TEXT DEFAULT '', uid TEXT DEFAULT '', name TEXT DEFAULT '',
    text TEXT DEFAULT '', reply TEXT DEFAULT '')`); // nhật ký trợ lý (CRM xem)
  await run(db, 'CREATE INDEX IF NOT EXISTS zb_log_at ON zb_log(at)');
  for (const c of ['done_at INTEGER', "done_by TEXT DEFAULT ''"]) { try { await run(db, 'ALTER TABLE zb_log ADD COLUMN ' + c); } catch (e) { } } // 05/11/2026: ca cần người thật → ai xử lý, lúc nào
  await run(db, 'CREATE TABLE IF NOT EXISTS zb_act (dh TEXT PRIMARY KEY, msgs INTEGER DEFAULT 0, people INTEGER DEFAULT 0)');
  // 10/11/2026: zb_posts.at_time = giờ đăng riêng của bài (HH:mm, trống = giờ của khung) · plan = bài viết theo chủ đề kế hoạch ('ok' đã duyệt / 'draft' chưa duyệt / '' không có)
  // 📋 kế hoạch chủ đề: 1 dòng / bài (id = yyyyMMdd_slot như zb_posts). status draft (chờ duyệt) | ok (đã duyệt → trợ lý viết theo) | skip (không đăng bài này)
  await run(db, `CREATE TABLE IF NOT EXISTS zb_plan (id TEXT PRIMARY KEY, day TEXT, slot TEXT, f TEXT DEFAULT '', topic TEXT DEFAULT '', idea TEXT DEFAULT '', cta TEXT DEFAULT '',
    g TEXT DEFAULT '', gn TEXT DEFAULT '', tn TEXT DEFAULT '', sp TEXT DEFAULT '', ev TEXT DEFAULT '', frame TEXT DEFAULT '', at_time TEXT DEFAULT '', status TEXT DEFAULT 'draft',
    by_name TEXT DEFAULT '', at INTEGER, ok_by TEXT DEFAULT '', ok_at INTEGER)`);
  await run(db, 'CREATE INDEX IF NOT EXISTS zb_plan_day ON zb_plan(day)'); // 05/11/2026: tin nhắn thành viên theo giờ (dh = yyyyMMddHH giờ VN), chọn giờ đăng
}

/** Khung giờ này tự đăng hay chờ duyệt (31/10/2026: mỗi khung giờ chọn riêng; khung chưa chọn thì theo chế độ chung) */
const slotAuto = (cfg, slot) => { const s = (cfg.slots || []).find(z => z.id === slot); return ((s && s.mode) || cfg.mode) === 'auto'; };
export async function zCfg(x) { const c = Object.assign({}, CFG0, await kvJson(x.db, 'zb_cfg', {})); if (!Array.isArray(c.slots) || !c.slots.length) c.slots = CFG0.slots; return c; }
const zlog = (x, kind, o) => run(x.db, 'INSERT INTO zb_log (at, kind, gid, uid, name, text, reply) VALUES (?, ?, ?, ?, ?, ?, ?)', Date.now(), kind, o.gid || '', o.uid || '', String(o.name || '').slice(0, 80), String(o.text || '').slice(0, 1000), String(o.reply || '').slice(0, 2000));
const vnHour = t => { const d = new Date(t + TZ_MS); return d.getUTCHours() + d.getUTCMinutes() / 60; };
const quiet = t => { const h = vnHour(t); return h >= 21.75 || h < 6; }; // 21h45 – 6h: không chủ động nhắn vào nhóm
const slotTime = (day, at) => { const [h, m] = String(at || '07:30').split(':').map(Number); return new Date(day.slice(0, 4) + '-' + day.slice(4, 6) + '-' + day.slice(6, 8) + 'T00:00:00+07:00').getTime() + ((h || 0) * 60 + (m || 0)) * 60e3; };
const groupName = (st, gid) => ((st && st.groups || []).find(g => g.id === gid) || {}).name || 'nhóm';

/** Sản phẩm trong kiến thức (chat-kb.txt): mã → tên, link, ảnh */
export function prodMap(know) {
  const out = {};
  for (const part of String(know).split('\n## Sản phẩm: ').slice(1)) {
    const name = part.split('\n')[0].trim(), code = (part.match(/\[\[sp:([a-z0-9-]+)\]\]/) || [])[1], img = (part.match(/\n- Ảnh: (\S+)/) || [])[1];
    if (code) out[code] = { name, url: SITE + '/san-pham/' + code + '/', img: img || '' };
  }
  return out;
}
/** Thẻ của An Lành web ([[sp:mã]], [[zalo]]) → chữ thường cho Zalo */
function zText(s, prods) {
  let zalo = false;
  const out = String(s || '').replace(/\s*\[\[sp:([a-z0-9-]+)\]\]/g, (m, c) => prods[c] ? '\n👉 ' + prods[c].name + ': ' + prods[c].url : '')
    .replace(/\s*\[\[zalo\]\]/g, () => { zalo = true; return ''; }).replace(/\n{3,}/g, '\n\n').trim();
  return { text: out, zalo };
}

/* ---------------------------------------------------------------- điều phối (index.js gọi khi type === 'zbot') */
export async function zbot(x, d) {
  if (!x.env.ZBOT_KEY || d.key !== x.env.ZBOT_KEY) return { ok: false, error: 'key' };
  const h = { poll: zPoll, ack: zAck, join: zJoin, msg: zMsg, dm: zDm, friend: zFriend, friend_ok: zFriendOk, login: zLogin, human: zHuman, pii: zPii }[d.ev];
  return h ? await h(x, d) : { ok: false, error: 'ev' };
}

async function zPoll(x, d) {
  const now = Date.now(), cfg = await zCfg(x), old = await kvJson(x.db, 'zb_status', null);
  const st = { at: now, me: d.me || null, groups: (d.groups || []).slice(0, 50), ver: String(d.ver || '') };
  if (!old || now - old.at > 4 * 60e3 || old.ver !== st.ver || JSON.stringify(old.groups) !== JSON.stringify(st.groups) || (old.down && !st.down)) await kvSet(x.db, 'zb_status', JSON.stringify(st)); // ghi 4 phút / lần cho đỡ tốn
  if (old && old.down) x.later(telegram(x.env, '✅ <b>Trợ lý Zalo An Lành đã chạy lại</b>'));
  for (const a of (Array.isArray(d.act) ? d.act : []).slice(0, 6)) if (/^\d{10}$/.test(String(a.dh))) // tin nhắn thành viên theo giờ (chương trình Zalo đếm, gửi số cộng dồn của giờ đó)
    try { await run(x.db, 'INSERT INTO zb_act (dh, msgs, people) VALUES (?, ?, ?) ON CONFLICT(dh) DO UPDATE SET msgs = max(zb_act.msgs, excluded.msgs), people = max(zb_act.people, excluded.people)', String(a.dh), Number(a.msgs) || 0, Number(a.people) || 0); } catch (e) { console.error('zb_act', e.message); } // lỗi đếm giờ không được chặn việc đăng bài
  for (const t of (Array.isArray(d.stats) ? d.stats : []).slice(0, 20)) // tương tác 2 tiếng sau khi đăng bài (chương trình Zalo đếm)
    await run(x.db, 'UPDATE zb_posts SET eng_msgs = ?, eng_people = ?, eng_reacts = ? WHERE id = ?', Number(t.msgs) || 0, Number(t.people) || 0, Number(t.reacts) || 0, String(t.id || ''));
  if (!cfg.groups.length && !(await kvGet(x.db, 'zb_cfg'))) { // lần đầu: tự chọn nhóm của Thực Dưỡng Lành
    const g = st.groups.filter(g => /thực dưỡng lành/i.test(g.name));
    if (g.length) { cfg.groups = g.map(g => g.id); await kvSet(x.db, 'zb_cfg', JSON.stringify(cfg)); }
  }
  // mỗi tài khoản Zalo thấy cùng một nhóm với mã khác nhau → đổi tài khoản trợ lý thì tìm lại nhóm theo tên (29/10: đổi SIM làm bài đăng lỗi "Tham số không hợp lệ")
  if (cfg.groups.length && st.groups.length) {
    const ids = st.groups.map(g => g.id), names = Object.assign({}, cfg.gnames || {});
    for (const g of st.groups) if (cfg.groups.includes(g.id)) names[g.id] = g.name;
    const map = {}; for (const id of cfg.groups) if (!ids.includes(id) && names[id]) { const g = st.groups.find(g => g.name === names[id]); if (g) { map[id] = g.id; names[g.id] = g.name; } }
    if (Object.keys(map).length || JSON.stringify(names) !== JSON.stringify(cfg.gnames || {})) {
      cfg.groups = [...new Set(cfg.groups.map(id => map[id] || id))]; cfg.gnames = names;
      await kvSet(x.db, 'zb_cfg', JSON.stringify(Object.assign(await kvJson(x.db, 'zb_cfg', {}), { groups: cfg.groups, gnames: names })));
      for (const [a, b] of Object.entries(map)) { await run(x.db, "UPDATE zb_out SET gid = ? WHERE gid = ? AND status = 'new'", b, a); await run(x.db, 'UPDATE zb_users SET gid = ? WHERE gid = ?', b, a); }
      if (Object.keys(map).length) await zlog(x, 'error', { text: 'Tài khoản trợ lý đổi → đã tự nhận lại nhóm: ' + Object.keys(map).map(id => names[id]).join(', ') });
    }
  }
  const out = { ok: true, cfg: { on: cfg.on, groups: cfg.groups, welcome: cfg.welcome, answer: cfg.answer, quiet: quiet(now), maxHour: cfg.maxHour }, jobs: [], approve: {} };
  if (!cfg.on) return out;

  // người xin vào nhóm: ai đã để số trên web (tìm được Zalo) → duyệt; người lạ → báo Telegram 1 lần
  const pend = d.pending || {};
  for (const gid of Object.keys(pend)) {
    if (!cfg.groups.includes(gid) || !cfg.approve) continue;
    const users = (pend[gid] || []).slice(0, 100); if (!users.length) continue;
    const ids = users.map(u => String(u.uid));
    const known = await all(x.db, `SELECT uid, phone, pend FROM zb_users WHERE uid IN (SELECT value FROM json_each(?))`, JSON.stringify(ids));
    const K = Object.fromEntries(known.map(r => [r.uid, r]));
    const ok = users.filter(u => cfg.approveAll || (K[u.uid] && K[u.uid].phone));
    if (ok.length) out.approve[gid] = ok.map(u => u.uid);
    // người lạ: lần đầu thấy chỉ ghi lại (pend 1); 10 phút sau vẫn chưa khớp số → báo Telegram 1 lần (pend 2). Chờ vì khách vừa để số thì trợ lý cần ít phút để tìm Zalo.
    const seen = await all(x.db, `SELECT uid, pend, at FROM zb_users WHERE uid IN (SELECT value FROM json_each(?))`, JSON.stringify(ids)), S = Object.fromEntries(seen.map(r => [r.uid, r]));
    const strange = users.filter(u => !ok.includes(u));
    for (const u of strange.filter(u => !S[u.uid])) await run(x.db, 'INSERT INTO zb_users (uid, zname, at, pend, gid) VALUES (?, ?, ?, 1, ?) ON CONFLICT(uid) DO NOTHING', u.uid, String(u.name || '').slice(0, 80), now, gid);
    const fresh = strange.filter(u => S[u.uid] && S[u.uid].pend === 1 && S[u.uid].at < now - 10 * 60e3);
    for (const u of fresh) await run(x.db, 'UPDATE zb_users SET pend = 2 WHERE uid = ?', u.uid);
    if (fresh.length) x.later(telegram(x.env, '👥 <b>Có ' + fresh.length + ' người xin vào nhóm Zalo "' + esc(groupName(st, gid)) + '"</b> nhưng chưa để số qua web:\n' + fresh.slice(0, 15).map(u => '• ' + esc(u.name || u.uid)).join('\n') + '\n👉 Mở Zalo → nhóm → Duyệt thành viên: kiểm tra rồi duyệt tay (trợ lý chỉ tự duyệt người đã để số).'));
  }

  // bài đăng tới giờ (trong 2 tiếng sau giờ hẹn; quá 2 tiếng thì bỏ – chương trình tắt lâu không đăng dồn)
  if (cfg.groups.length) {
    const day = fmtDate(now, 'yyyyMMdd');
    for (const p of await all(x.db, "SELECT * FROM zb_posts WHERE day = ? AND status IN ('draft', 'ok')", day)) {
      const sl = cfg.slots.find(s => s.id === p.slot); if (!sl || !sl.on) continue;
      const t = slotTime(day, p.at_time || slotAt(sl, day)); if (now < t || now > t + 2 * 3600e3) continue; // ⏰ bài có giờ riêng thì theo giờ đó
      if (p.status === 'draft' && !slotAuto(cfg, p.slot)) continue;
      if (!String(p.text || '').trim()) continue;
      await run(x.db, "UPDATE zb_posts SET status = 'sent', sent_at = ? WHERE id = ? AND status = ?", now, p.id, p.status);
      for (const gid of cfg.groups) await run(x.db, "INSERT INTO zb_out (kind, gid, text, img, due, at, ref) VALUES ('post', ?, ?, ?, ?, ?, ?)", gid, tagLinks(p.text, p.id), p.img || '', now, now, p.id); // 11/11/2026: bài sửa tay (✏️ Sửa chữ) cũng gắn mã theo dõi
    }
  }
  // việc chờ: giao 1 lần (không gửi lại khi lỗi → không đăng trùng vào nhóm)
  // tra số điện thoại trên Zalo: tối đa 1 lần / 3 phút, 25 lần / ngày (tra nhiều là dấu hiệu Zalo hay khoá)
  const lkDay = 'zb_lk_' + fmtDate(now, 'yyMMdd'), lkN = Number(await kvGet(x.db, lkDay) || 0), lkOk = lkN < 25 && now - Number(await kvGet(x.db, 'zb_lk_last') || 0) > 180e3;
  let jobs = await all(x.db, "SELECT id, kind, gid, uid, phone, text, img, mentions, ref FROM zb_out WHERE status = 'new' AND due <= ? ORDER BY due LIMIT 8", now);
  let lk = 0; jobs = jobs.filter(j => j.kind !== 'lookup' || (lkOk && !lk++));
  if (lk) { await kvSet(x.db, lkDay, String(lkN + 1), 2 * 86400e3); await kvSet(x.db, 'zb_lk_last', String(now)); }
  if (jobs.length) {
    await run(x.db, "UPDATE zb_out SET status = 'sent', done_at = ? WHERE id IN (SELECT value FROM json_each(?))", now, JSON.stringify(jobs.map(j => j.id)));
    out.jobs = jobs.filter(j => j.kind === 'lookup' || !quiet(now) || j.kind === 'dm' || j.kind === 'undo').map(j => ({ id: j.id, kind: j.kind, ref: j.ref || '', gid: j.gid, uid: j.uid, phone: j.phone, text: j.text, img: j.img, mentions: j.mentions ? JSON.parse(j.mentions) : [] }));
    const late = jobs.filter(j => !out.jobs.find(o => o.id === j.id)); // ban đêm: dời sang 6h sáng
    for (const j of late) await run(x.db, "UPDATE zb_out SET status = 'new', due = ? WHERE id = ?", nextMorning(now), j.id);
  }
  if (Math.random() < 0.01) x.later(run(x.db, 'DELETE FROM zb_log WHERE at < ?', now - 90 * DAY));
  return out;
}
function nextMorning(now) { const day = fmtDate(now + (vnHour(now) >= 6 ? DAY : 0), 'yyyyMMdd'); return slotTime(day, '06:30'); }

async function zAck(x, d) {
  const j = await first(x.db, 'SELECT * FROM zb_out WHERE id = ?', Number(d.id) || 0); if (!j) return { ok: true };
  await run(x.db, 'UPDATE zb_out SET status = ?, done_at = ? WHERE id = ?', d.ok ? 'done' : 'err', Date.now(), j.id);
  if (j.kind === 'lookup' && d.ok && d.uid) await zFound(x, j, String(d.uid), String(d.zname || ''), d.inGroups || []);
  if (j.kind === 'post' && d.ok && Array.isArray(d.msgs) && d.msgs.length) await run(x.db, 'UPDATE zb_out SET msgs = ? WHERE id = ?', JSON.stringify(d.msgs.slice(0, 10).map(m => ({ m: String(m.m || ''), c: String(m.c || '') }))), j.id); // ↩️ để thu hồi (trợ lý ≥ RECALL_VER)
  if (j.kind === 'undo') { // ↩️ thu hồi xong / lỗi
    if (d.ok) { await run(x.db, "UPDATE zb_out SET undone = 1 WHERE ref = ? AND gid = ? AND kind = 'post'", j.ref, j.gid); await run(x.db, "UPDATE zb_posts SET status = 'recalled' WHERE id = ?", j.ref); await zlog(x, 'recall', { gid: j.gid, text: 'Đã thu hồi tin ' + j.ref }); }
    else await zlog(x, 'error', { gid: j.gid, text: 'Không thu hồi được tin ' + j.ref + ': ' + String(d.error || '').slice(0, 200) });
    return { ok: true };
  }
  const p = j.kind === 'post' && j.ref && j.ref !== 'announce' ? await first(x.db, 'SELECT id, slot FROM zb_posts WHERE id = ?', j.ref) : null; // mọi tin đăng vào nhóm đều là 1 dòng zb_posts để đo (04/11/2026)
  if (p && d.ok && (p.slot === 'tay' || p.slot === 'chuc')) await run(x.db, "UPDATE zb_posts SET status = 'sent', sent_at = COALESCE(sent_at, ?) WHERE id = ?", Date.now(), p.id);
  if (p && !d.ok) await run(x.db, "UPDATE zb_posts SET status = 'fail' WHERE id = ?", p.id); // gửi lỗi: không tính là đã đăng
  if (j.kind === 'post' && d.ok) await zlog(x, j.ref === 'announce' || (p && p.slot === 'chuc') ? 'announced' : p && p.slot !== 'tay' ? 'post' : 'send', { gid: j.gid, text: j.text.slice(0, 200), name: p && p.slot !== 'tay' ? '' : 'Nhân sự gửi' });
  if (!d.ok && j.kind !== 'lookup') await zlog(x, 'error', { gid: j.gid, text: 'Không gửi được (' + j.kind + '): ' + String(d.error || '').slice(0, 200), reply: j.text.slice(0, 300) });
  return { ok: true };
}

/** Đã tìm được Zalo của khách để lại số trên web → ghi lại; khách đang trong nhóm → chúc mừng trong nhóm */
async function zFound(x, j, uid, zname, inGroups) {
  let info = {}; try { info = JSON.parse(j.text || '{}'); } catch (e) { }
  const now = Date.now(), old = await first(x.db, 'SELECT * FROM zb_users WHERE uid = ?', uid);
  await run(x.db, `INSERT INTO zb_users (uid, phone, name, zname, lead, what, at) VALUES (?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(uid) DO UPDATE SET phone = excluded.phone, name = excluded.name, zname = CASE WHEN excluded.zname != '' THEN excluded.zname ELSE zb_users.zname END, lead = CASE WHEN excluded.lead != '' THEN excluded.lead ELSE zb_users.lead END, what = CASE WHEN excluded.what != '' THEN excluded.what ELSE zb_users.what END, at = excluded.at`,
    uid, j.phone, String(info.name || '').slice(0, 80), zname.slice(0, 80), String(info.lead || ''), String(info.what || '').slice(0, 120), now);
  const cfg = await zCfg(x), g = inGroups.filter(id => cfg.groups.includes(id));
  if (g.length && !(old && old.joined)) await markJoined(x, uid, j.phone, g[0], zname, true);
  if (g.length && cfg.announce && info.what && info.announce) await queueAnnounce(x, g[0], uid, zname || info.name || 'bạn', info.what); // khách đã ở trong nhóm, vừa nhận quà trên web → chúc mừng (như nhóm Sống Khỏe 365)
}
async function queueAnnounce(x, gid, uid, nm, what) {
  const now = Date.now(), text = announceText(nm, what) + friendAsk(friendLink(await kvJson(x.db, 'zb_status', null))), due = quiet(now + 60e3) ? nextMorning(now) : now + 60e3; // giờ im lặng → 6h30 sáng
  const id = 'c' + now.toString(36) + Math.random().toString(36).slice(2, 5); // lưu thành bài (slot 'chuc') để đo tương tác như bài thường
  await run(x.db, "INSERT INTO zb_posts (id, day, slot, topic, text, status, by_name, at, funnel) VALUES (?, ?, 'chuc', ?, ?, 'ok', 'Trợ lý', ?, 'CHUC')", id, fmtDate(due, 'yyyyMMdd'), ('Chúc mừng ' + nm + ' nhận ' + what).slice(0, 120), text, now);
  await run(x.db, "INSERT INTO zb_out (kind, gid, text, mentions, due, at, ref) VALUES ('post', ?, ?, ?, ?, ?, ?)", gid, text, JSON.stringify([{ uid, name: nm }]), due, now, id);
  await zlog(x, 'announce', { gid, uid, name: nm, text: what + ' · ⏰ hẹn đăng ' + fmtDate(due, 'HH:mm dd/MM') + (due - now > 5 * 60e3 ? ' (sau giờ im lặng 21h45–6h)' : ''), reply: text });
}
function announceText(nm, what) {
  const t = [
    `🎉 Chúc mừng @${nm} vừa nhận ${what} trên web Thực Dưỡng Lành 🌿\n\nAi trong nhóm muốn nhận thì vào thucduonglanh.vn hoặc nhắn riêng cho em nha 💚`,
    `🌿 Nhóm mình vừa có @${nm} nhận ${what} nè cả nhà 🎉\n\nCô chú, anh chị nào cũng muốn nhận thì nhắn em một tiếng nha, hoàn toàn miễn phí ạ.`,
    `💚 @${nm} vừa nhận ${what} rồi ạ! Chúc anh/chị đọc vui và áp dụng được nhiều điều hay 🌱\n\nAi cần thì nhắn riêng em An Lành nhé.`
  ];
  return t[Math.floor(Math.random() * t.length)];
}

/** Khách vào nhóm: CRM ghi "Đã vào" (khách đã mua) / ghi chú khách hỏi */
async function markJoined(x, uid, phone, gid, zname, before) {
  const now = Date.now();
  await run(x.db, 'UPDATE zb_users SET joined = ?, gid = ?, pend = 0 WHERE uid = ?', now, gid, uid);
  if (!phone) return;
  await run(x.db, "UPDATE customers SET community = 'Đã vào' WHERE phone = ? AND coalesce(community, '') != 'Đã vào'", phone);
  if (!before) await run(x.db, "UPDATE leads SET note = coalesce(note, '') || ? WHERE rid = (SELECT rid FROM leads WHERE phone = ? ORDER BY rid DESC LIMIT 1)", '\n[' + fmtDate(now, 'dd/MM') + '] ✅ Đã vào nhóm Zalo (tên Zalo: ' + zname + ')', phone);
}

/** Gọi từ index.js / chat.js khi khách để lại số trên web: nhờ chương trình Zalo tìm tài khoản theo số (để tự duyệt vào nhóm, chúc mừng, CRM biết đã vào nhóm) */
export async function zbotLead(x, o) {
  try {
    const phone = normPhone(o.phone); if (!/^0\d{9}$/.test(phone)) return;
    const now = Date.now(), cfg = await zCfg(x); if (!cfg.on) return;
    const info = JSON.stringify({ name: o.name || '', what: o.what || '', lead: o.lead || '', announce: !!o.announce });
    const known = await first(x.db, 'SELECT * FROM zb_users WHERE phone = ? ORDER BY at DESC LIMIT 1', phone);
    if (known && known.joined && cfg.groups.includes(known.gid)) { // đã biết Zalo + đang ở nhóm → không cần tìm lại
      await run(x.db, "UPDATE zb_users SET what = CASE WHEN ? != '' THEN ? ELSE what END, lead = CASE WHEN ? != '' THEN ? ELSE lead END, at = ? WHERE uid = ?", o.what || '', o.what || '', o.lead || '', o.lead || '', now, known.uid);
      if (o.announce && o.what && cfg.announce) await queueAnnounce(x, known.gid, known.uid, known.zname || o.name || 'bạn', o.what);
      return;
    }
    if (await first(x.db, "SELECT id FROM zb_out WHERE kind = 'lookup' AND phone = ? AND status = 'new'", phone)) { await run(x.db, "UPDATE zb_out SET text = ? WHERE kind = 'lookup' AND phone = ? AND status = 'new'", info, phone); return; } // đang chờ tìm → cập nhật quà mới
    await run(x.db, "INSERT INTO zb_out (kind, phone, text, due, at, uid) VALUES ('lookup', ?, ?, ?, ?, ?)", phone, info, now, now, known ? known.uid : '');
  } catch (e) { console.error('zbotLead', e.message); }
}

/* ---------------------------------------------------------------- chào người mới */
async function zJoin(x, d) {
  const cfg = await zCfg(x), gid = String(d.gid || ''), now = Date.now();
  if (!cfg.on || !cfg.groups.includes(gid)) return { ok: true };
  const mem = (d.members || []).slice(0, 20).map(m => ({ uid: String(m.uid), name: String(m.name || '').trim().slice(0, 60) || 'bạn' }));
  if (!mem.length) return { ok: true };
  const rows = await all(x.db, 'SELECT * FROM zb_users WHERE uid IN (SELECT value FROM json_each(?))', JSON.stringify(mem.map(m => m.uid)));
  const R = Object.fromEntries(rows.map(r => [r.uid, r]));
  for (const m of mem) {
    if (R[m.uid]) await markJoined(x, m.uid, R[m.uid].phone, gid, m.name, false);
    else await run(x.db, 'INSERT INTO zb_users (uid, zname, at, joined, gid) VALUES (?, ?, ?, ?, ?) ON CONFLICT(uid) DO NOTHING', m.uid, m.name, now, now, gid);
  }
  if (!cfg.welcome) return { ok: true };
  const st = await kvJson(x.db, 'zb_status', null), gname = groupName(st, gid);
  const who = mem.map(m => '@' + m.name + (R[m.uid] && R[m.uid].what ? ' (vừa nhận ' + R[m.uid].what + ' trên web)' : '')).join(', ');
  let text = '';
  if (x.env.ANTHROPIC_API_KEY) {
    try {
      const res = await ai(x.env).messages.create({ model: FAST, max_tokens: 1200, output_config: { effort: 'low' },
        system: 'Bạn là "' + BOT + '", thành viên trong đội ngũ chăm sóc nhóm Zalo "' + gname + '" của Thực Dưỡng Lành (thực phẩm dinh dưỡng từ hạt, trà thảo mộc, thực phẩm chay). Viết tiếng Việt tự nhiên như người thật nhắn trong nhóm, ấm áp, không văn mẫu, không quảng cáo.',
        messages: [{ role: 'user', content: 'Bây giờ là ' + fmtDate(now, 'HH:mm') + '. Thành viên mới vào nhóm: ' + who + '.\nViết 1 tin chào mừng ngắn (3–5 câu, dưới 70 chữ, tối đa 2 emoji):\n- Bắt đầu bằng lời chào và gọi đúng từng tên viết y nguyên dạng "@Tên" như trên (giữ chữ @, không đổi tên). Gọi "anh/chị" (không đoán giới tính).\n- Nếu ai vừa nhận quà trên web thì nhắc 1 câu cho người đó (không nhắc bệnh, không số điện thoại).\n- Nói nhóm có gì: thực đơn lành, kiến thức sống khỏe mỗi sáng, hỏi đáp; cần gì cứ nhắn riêng em hoặc gọi tên em trong nhóm.\n- Không hỏi về bệnh, không chào giờ giấc sai (sáng/trưa/chiều/tối theo giờ hiện tại).\nChỉ trả về nội dung tin.' }] });
      text = safe(textOf(res));
    } catch (e) { console.error('zJoin ai', e.message); }
  }
  if (!text || mem.some(m => text.indexOf('@' + m.name) < 0)) text = 'Chào mừng ' + mem.map(m => '@' + m.name).join(', ') + ' đã vào nhóm ' + gname + ' 🌿\n\nMỗi sáng nhóm mình có bài kiến thức sống khỏe, thực đơn lành và hỏi đáp cùng đội ngũ Thực Dưỡng Lành. Anh/chị cần hỏi gì cứ nhắn riêng em An Lành hoặc gọi tên em trong nhóm nha 💚';
  text += friendAsk(friendLink(st)).replace('Anh/chị bấm', mem.length > 1 ? 'Cả nhà bấm' : 'Anh/chị bấm'); // mời kết bạn: trợ lý nhắn riêng được (Zalo hạn chế nhắn người chưa kết bạn)
  await zlog(x, 'welcome', { gid, name: mem.map(m => m.name).join(', '), reply: text });
  return { ok: true, text, mentions: mem };
}

/* ---------------------------------------------------------------- trả lời trong nhóm */
const GROUP_RULES = `# Bạn là ai
Bạn là "${BOT}" – thành viên đội chăm sóc khách hàng của Thực Dưỡng Lành, đang trực trong nhóm Zalo cộng đồng của công ty. Bạn là trợ lý ảo (AI); không tự giới thiệu là AI, nhưng ai hỏi thì nói thật và cho biết có chuyên viên thật hỗ trợ.

# Cách nhắn trong nhóm
- Như một người thật trong nhóm Zalo: câu ngắn, đời thường, "dạ", "ạ", "nha" vừa phải. Không văn mẫu, không quảng cáo, không kiểu báo cáo. Không tiêu đề, không bảng.
- Xưng "em". Gọi người hỏi theo cách họ xưng (cô/chú/bác/anh/chị); chưa rõ thì "anh/chị". Không cần gọi tên đầy đủ.
- Ngắn: 1–4 câu, dưới 70 chữ (trừ khi cần liệt kê). Emoji tối đa 1.
- Đồng cảm trước khi đưa thông tin nếu người ta kể chuyện, lo lắng.
- Tránh câu "nghe là biết máy": "Chắc chắn rồi", "Rất vui được hỗ trợ", "Cảm ơn bạn đã đặt câu hỏi", "Tuyệt vời!", "Hy vọng thông tin trên hữu ích", "Nếu còn thắc mắc gì…". Không nhắc lại câu hỏi của người ta. Không phải câu nào cũng mở bằng "Dạ"; đổi cách mở (dạ / vâng / ôi / gọi tên…) cho tự nhiên.
- Không gọi người nhắn là "bạn" (khách đa số là cô chú, anh chị). Viết đúng chính tả, có dấu đầy đủ, không viết tắt kiểu "k", "dc".
- Trả lời thẳng điều được hỏi. Gợi ý sản phẩm chỉ khi người ta hỏi hoặc rõ nhu cầu; khi gợi ý thêm [[sp:mã]] (tối đa 1).
- Việc riêng tư (đơn hàng, đổi trả, khiếu nại, giá sỉ, bệnh cụ thể, người muốn mua) → trả lời ngắn + thêm [[zalo]] để chuyên viên gọi lại. Khách đa số lớn tuổi, ít biết nhắn riêng: KHÔNG bảo khách "nhắn riêng em mã đơn / tên / địa chỉ". Nếu đội ngũ đã có số của khách thì nói "em báo chuyên viên gọi lại cho mình ngay nha"; chưa có số thì mời gọi hoặc nhắn Zalo hotline 0966 326 522, bên em gọi lại liền. Không hỏi số điện thoại, địa chỉ trong nhóm (khách lỡ gửi thì hệ thống tự ẩn tin).
- Khách báo "đã đặt hàng rồi": cảm ơn, nói chuyên viên sẽ kiểm tra đơn, ưu đãi, quà và gọi xác nhận cho mình; thêm [[zalo]]. Không đòi mã đơn.

# Khi nào lên tiếng
Bạn đọc một tin trong nhóm (kèm vài tin trước đó). Quyết định:
- Trả lời khi: người ta gọi bạn / trả lời tin của bạn; hoặc đặt câu hỏi về sản phẩm, cách dùng, dinh dưỡng, sống khỏe, đặt hàng, ưu đãi mà chưa ai trong đội ngũ trả lời.
- Chỉ thả tim (viết đúng: [TIM]) khi: người ta khoe bữa ăn lành, chia sẻ cảm nhận, cảm ơn, chúc mừng, trả lời câu hỏi tương tác của bài đăng.
- Im lặng (viết đúng: [BO_QUA]) khi: chuyện phiếm giữa thành viên, chào hỏi chung, tin không cần đội ngũ, quảng cáo / link lạ, đã có người trả lời đủ, tin chính trị / tôn giáo gây tranh cãi.
Khi trả lời thì chỉ viết nội dung tin (không ghi [TIM] / [BO_QUA]).

# Ví dụ giọng nhắn (chỉ để học giọng; thông tin thật lấy từ phần kiến thức, không lấy từ ví dụ)
- Hỏi: "Đặt hàng thế nào em ơi" → "Dạ chị đặt ngay trên web thucduonglanh.vn, hoặc gọi hay nhắn Zalo hotline 0966 326 522 là bên em lên đơn giúp chị liền ạ. Hàng tới chị được kiểm rồi mới trả tiền nha."
- Kể: "Cô đã đặt hàng rồi nha" → "Dạ con cảm ơn cô ạ! Con báo chị chuyên viên kiểm tra đơn, ưu đãi với quà của cô rồi gọi xác nhận cho cô liền nha." [[zalo]]
- Hỏi: "Có ai dùng thử chưa mọi người" → [BO_QUA] nếu thành viên khác đang trả lời; nếu chưa ai trả lời sau một lúc: "Nhiều cô chú trong nhóm đang dùng đó chị ạ, mọi người chia sẻ thêm cho chị với nha 😊"
- Kể: "Mấy hôm nay mất ngủ quá" → "Ôi mất ngủ mệt lắm chị ạ. Chị thử ăn tối sớm, bớt điện thoại trước giờ ngủ xem sao. Cần gì chị cứ nhắn riêng em nha."`;

async function zMsg(x, d) {
  const cfg = await zCfg(x), gid = String(d.gid || ''), now = Date.now();
  if (!cfg.on || !cfg.answer || !cfg.groups.includes(gid) || !x.env.ANTHROPIC_API_KEY) return { ok: true };
  const text = String(d.text || '').replace(/\s+/g, ' ').trim().slice(0, 800); if (!text) return { ok: true };
  const direct = !!d.direct;
  if (!direct && (quiet(now) || text.length < 6)) return { ok: true };
  const hk = 'zb_n_' + gid + '_' + fmtDate(now, 'yyMMddHH'), n = Number(await kvGet(x.db, hk) || 0);
  if (n >= (cfg.maxHour || 8) && !direct) return { ok: true };
  const st = await kvJson(x.db, 'zb_status', null), gname = groupName(st, gid), know = await kb(), w = workNow(now);
  const known = d.uid ? await first(x.db, "SELECT phone FROM zb_users WHERE uid = ? AND phone != ''", String(d.uid)) : null; // đội ngũ đã có số → hứa gọi lại, khỏi bảo khách nhắn riêng
  const od = await findOrder(x, d, text, known && known.phone, now); // 🧾 khách báo đã đặt hàng → trợ lý tự tìm đơn 3 ngày gần nhất
  const ctx = (d.ctx || []).slice(-12).map(m => (m.bot ? 'Em (' + BOT + ')' : m.staff ? '[Đội ngũ] ' + m.name : m.name) + ': ' + String(m.text || '').slice(0, 300)).join('\n');
  let reply = '';
  try {
    const res = await ai(x.env).messages.create({ model: FAST, max_tokens: 1500, output_config: { effort: 'low' },
      system: [{ type: 'text', text: GROUP_RULES + '\n' + TRUTH_RULES.replace(/mời nhắn Zalo/g, 'mời nhắn riêng') },
        { type: 'text', text: 'TÀI LIỆU (thông tin chính thức của Thực Dưỡng Lành):\n\n' + know, cache_control: { type: 'ephemeral' } },
        { type: 'text', text: 'Nhóm: "' + gname + '". Bây giờ là ' + w.label + '. Chuyên viên ' + (w.on ? 'đang trực.' : 'ngoài giờ (trực Thứ 2 – Thứ 7, 8h–17h).') + ' Đội ngũ ' + (known || od ? 'ĐÃ CÓ' : 'CHƯA có') + ' số điện thoại của người nhắn.' + (od ? '\nĐÃ TÌM THẤY ĐƠN của người nhắn: đặt lúc ' + fmtDate(od.time, 'HH:mm dd/MM') + ', trạng thái "' + (od.status || 'Mới') + '". Nói cho khách yên tâm là bên em đã nhận đơn (nêu giờ đặt), chuyên viên sẽ kiểm tra ưu đãi, quà rồi gọi xác nhận; thêm [[zalo]]. KHÔNG nêu mã đơn, số tiền, số điện thoại, địa chỉ trong nhóm; không bảo khách gọi hotline hay nhắn riêng.' : '') }],
      messages: [{ role: 'user', content: (ctx ? 'Các tin trước trong nhóm:\n' + ctx + '\n\n' : '') + 'TIN CẦN XỬ LÝ – ' + (d.name || 'Thành viên') + (direct ? ' (gọi em / trả lời tin của em)' : '') + ': ' + text }] });
    if (res.stop_reason === 'refusal') return { ok: true };
    reply = textOf(res);
  } catch (e) { console.error('zMsg ai', e && e.message); return { ok: true }; }
  if (!reply || /\[BO_QUA\]/.test(reply)) { if (direct) await zlog(x, 'skip', { gid, uid: d.uid, name: d.name, text }); return { ok: true }; }
  if (/^\s*\[TIM\]\s*$/.test(reply) || (/\[TIM\]/.test(reply) && reply.replace(/\[TIM\]/g, '').trim().length < 3)) { await zlog(x, 'react', { gid, uid: d.uid, name: d.name, text }); return { ok: true, react: 'heart' }; }
  const z = zText(safe(reply.replace(/\[(TIM|BO_QUA)\]/g, '')), prodMap(know));
  await kvSet(x.db, hk, String(n + 1), 2 * 3600e3);
  await zlog(x, z.zalo ? 'handoff' : 'answer', { gid, uid: d.uid, name: d.name, text, reply: z.text });
  if (z.zalo || od) x.later(handoff(x, { where: 'nhóm "' + gname + '"', name: d.name, uid: d.uid, text, reply: z.text, order: od }));
  return { ok: true, reply: z.text, quote: true };
}
/** 🧾 Khách nói đã đặt hàng → tìm đơn 3 ngày gần nhất theo số đã biết, hoặc theo tên (tên Zalo / tên khách gõ trong tin). Chỉ nhận khi đúng 1 khách khớp. */
const ORDER_TALK = /đặt|đơn|mua|nhận hàng|giao hàng|ship|chốt/i;
async function findOrder(x, d, text, phone, now) {
  const ctxT = (d.ctx || []).slice(-4).map(m => m.text || '').join(' ');
  if (!ORDER_TALK.test(text + ' ' + ctxT)) return null;
  const rows = await all(x.db, "SELECT id, time, name, phone, total, status FROM orders WHERE time > ? ORDER BY time DESC LIMIT 400", now - 3 * DAY);
  const live = rows.filter(o => !isVoid(o.status));
  let hit = phone ? live.filter(o => normPhone(o.phone) === phone) : [];
  if (!hit.length) {
    const said = ' ' + nrm(text + ' ' + d.name).replace(/[^a-z0-9 ]/g, ' ') + ' ';
    hit = live.filter(o => { const w = nrm(o.name).replace(/[^a-z0-9 ]/g, ' ').split(' ').filter(Boolean); if (w.length < 2) return false; return said.indexOf(' ' + w.slice(-2).join(' ') + ' ') >= 0; });
  }
  if (!hit.length || new Set(hit.map(o => normPhone(o.phone))).size > 1) return null; // không thấy, hoặc nhiều khách trùng tên → để chuyên viên tự tìm
  const o = hit[0];
  if (d.uid && /^0\d{9}$/.test(normPhone(o.phone))) await run(x.db, `INSERT INTO zb_users (uid, phone, zname, at) VALUES (?, ?, ?, ?) ON CONFLICT(uid) DO UPDATE SET phone = CASE WHEN zb_users.phone = '' THEN excluded.phone ELSE zb_users.phone END`, String(d.uid), normPhone(o.phone), String(d.name || '').slice(0, 80), now);
  return o;
}

/* ---------------------------------------------------------------- 🔒 khách gửi số điện thoại / địa chỉ vào nhóm (11/11/2026)
 * Chương trình Zalo tự nhận ra, ẩn tin (trợ lý là phó nhóm) rồi gọi vào đây: ghi khách tiềm năng, báo Telegram cho sale gọi,
 * trả về câu trợ lý nói trong nhóm để khách biết vì sao tin bị ẩn và ai sẽ liên hệ (không để khách bị "xoá tin không lời giải thích"). */
const HOTLINES = ['0966326522'];
async function zPii(x, d) {
  const cfg = await zCfg(x), gid = String(d.gid || ''), uid = String(d.uid || ''), nm = String(d.name || 'Khách').trim().slice(0, 60), now = Date.now();
  if (!cfg.on || !cfg.groups.includes(gid)) return { ok: true };
  const text = String(d.text || '').replace(/\s+/g, ' ').trim().slice(0, 800), del = !!d.del, w = workNow(now);
  const pm = text.match(PHONE_RE); let phone = pm ? normPhone(pm[0]) : '';
  if (!/^0\d{9}$/.test(phone) || HOTLINES.includes(phone)) phone = '';
  const u = uid ? await first(x.db, 'SELECT phone, lead FROM zb_users WHERE uid = ?', uid) : null;
  const callPhone = phone || (u && u.phone) || '';
  const st = await kvJson(x.db, 'zb_status', null), gname = groupName(st, gid);
  let ld = null;
  if (phone) {
    ld = await addLead(x, { name: nm, phone, channel: 'Zalo nhóm', interest: 'Gửi thông tin trong nhóm Zalo', addInterest: true, note: 'Khách gửi trong nhóm "' + gname + '" (tên Zalo: ' + nm + '): ' + text.slice(0, 400), by: 'Website', auto: true });
    await run(x.db, `INSERT INTO zb_users (uid, phone, zname, lead, at) VALUES (?, ?, ?, ?, ?) ON CONFLICT(uid) DO UPDATE SET phone = CASE WHEN zb_users.phone = '' THEN excluded.phone ELSE zb_users.phone END, lead = CASE WHEN zb_users.lead = '' THEN excluded.lead ELSE zb_users.lead END`, uid, phone, nm, ld.id, now);
  }
  await zlog(x, 'handoff', { gid, uid, name: nm, text: '🔒 ' + text, reply: del ? 'Trợ lý đã ẩn tin (có số điện thoại / địa chỉ) và báo khách nhân viên sẽ liên hệ.' : 'Trợ lý CHƯA ẩn được tin – phó nhóm xoá tay.' });
  const owner = ld && ld.owner || '';
  const tg = '🔒 <b>KHÁCH GỬI THÔNG TIN RIÊNG TRONG NHÓM ZALO</b> – nhóm "' + esc(gname) + '"\n👤 ' + esc(nm) + (callPhone ? ' – <b>' + esc(callPhone) + '</b>' : ' (chưa biết số)') + '\n💬 ' + esc(text.slice(0, 400))
    + '\n' + (del ? '✅ Trợ lý đã ẩn tin để bảo vệ khách và nhắn trong nhóm: nhân viên sẽ liên hệ.' : '⚠️ Trợ lý CHƯA ẩn được tin → phó nhóm vào xoá tay ngay.')
    + '\n👉 ' + (callPhone ? 'GỌI KHÁCH ' + (w.on ? 'TRONG 15 PHÚT' : 'LÚC 8H SÁNG NGÀY LÀM VIỆC TỚI') + ' từ hotline 0966 326 522: lên đơn / kiểm tra đơn, ưu đãi, quà.' : 'Chưa có số: nhắn tay cho khách trên điện thoại "Trợ lý An Lành" (tìm tên khách trong nhóm).')
    + (owner ? '\n👤 Khách của: ' + esc(owner) : ld ? '\n⚠️ Chưa có người phụ trách – vào CRM để giao' : '') + (ld ? '\n' + CRM_URL + '/#tiem-nang' : '');
  x.later(telegram(x.env, tg));
  if (owner) x.later(telegramUser(x, owner, tg).catch(() => {}));
  const k = 'zb_pii_' + gid + '_' + uid; // khách gửi liền mấy tin: chỉ nói trong nhóm 1 lần / 30 phút
  if (await kvGet(x.db, k)) return { ok: true };
  await kvSet(x.db, k, '1', 30 * 60e3);
  const when = w.on ? 'ngay' : 'từ 8h sáng ngày làm việc tới';
  const reply = del
    ? 'Dạ em cảm ơn @' + nm + ' ạ 💚 Tin vừa rồi có số điện thoại, địa chỉ nên em đã ẩn đi để giữ an toàn cho mình (nhóm đông người). Em ghi lại đủ rồi, chuyên viên bên em sẽ ' + (callPhone ? 'gọi' : 'nhắn Zalo') + ' cho mình ' + when + ' ạ.'
    : 'Dạ em cảm ơn @' + nm + ' ạ 💚 Em ghi lại thông tin rồi, chuyên viên bên em sẽ ' + (callPhone ? 'gọi' : 'nhắn Zalo') + ' cho mình ' + when + '. Nhóm đông người, mình bấm giữ tin vừa gửi rồi chọn Thu hồi giúp em để giữ an toàn số điện thoại, địa chỉ nha.';
  return { ok: true, reply, mentions: [{ uid, name: nm }] };
}

/** Câu cần người thật → Telegram (kèm số điện thoại nếu đã biết từ web) */
async function handoff(x, o) {
  const u = o.uid ? await first(x.db, 'SELECT phone, name FROM zb_users WHERE uid = ?', o.uid) : null, od = o.order;
  await telegram(x.env, '🤖 <b>TRỢ LÝ ZALO CẦN NGƯỜI THẬT</b> – ' + esc(o.where) + '\n👤 ' + esc(o.name || '') + (u && u.phone ? ' – <b>' + esc(u.phone) + '</b>' : ' (chưa biết số)') + '\n💬 ' + esc(o.text.slice(0, 300)) + '\n🤖 Đã trả lời: ' + esc(o.reply.slice(0, 300))
    + (od ? '\n🧾 Trợ lý tìm thấy đơn <b>' + esc(od.id) + '</b> – ' + esc(od.name) + ' – ' + esc(od.phone) + ' – ' + fmt(od.total) + ' – đặt ' + fmtDate(od.time, 'HH:mm dd/MM') + ' (' + esc(od.status || 'Mới') + ')\n👉 GỌI KHÁCH XÁC NHẬN ĐƠN, ưu đãi, quà.' : '')
    + '\n👉 ' + (u && u.phone ? 'Gọi / nhắn từ Zalo hotline 0966 326 522 theo số trên, hoặc ' : '') + 'trả lời ngay trên điện thoại "Trợ lý An Lành" (' + (o.where === 'tin nhắn riêng' ? 'mở cuộc trò chuyện với khách' : 'tìm tên khách trong nhóm') + '). Người nhắn tay thì trợ lý tự nhường 2 tiếng.');
}

/* ---------------------------------------------------------------- khách nhắn riêng cho trợ lý */
const DM_RULES = `# Bạn là ai
Bạn là "${BOT}" – chuyên viên chăm sóc khách hàng của Thực Dưỡng Lành, đang nhắn Zalo riêng với khách (tài khoản Zalo "Trợ lý An Lành"). Bạn là trợ lý ảo (AI); không tự giới thiệu là AI, nhưng khách hỏi thì nói thật và cho biết có chuyên viên thật hỗ trợ.

# Giọng nói
- Như tin Zalo giữa người với người: câu ngắn, đời thường, "dạ", "ạ", "nha" vừa phải. Không văn mẫu, không quảng cáo.
- Xưng hô theo khách (cô/chú/bác → xưng "con"/"cháu"; chị/anh → xưng "em"); chưa rõ thì "anh/chị", xưng "em". Giữ nguyên suốt cuộc trò chuyện.
- Đồng cảm trước khi đưa thông tin nếu khách kể chuyện. Nhớ điều khách đã kể, không hỏi lại.
- Ngắn: 2–4 câu, dưới 80 chữ; chỉ gạch đầu dòng khi liệt kê từ 3 ý. Emoji tối đa 1. Không tiêu đề, không bảng, không dấu ** (Zalo không hiện chữ đậm).
- Không phải câu nào cũng hỏi lại; hỏi 1 câu khi thật cần để tư vấn.
- Tránh câu "nghe là biết máy": "Chắc chắn rồi", "Rất vui được hỗ trợ", "Cảm ơn bạn đã đặt câu hỏi", "Tuyệt vời!", "Hy vọng thông tin trên hữu ích", "Nếu còn thắc mắc gì…". Không nhắc lại câu hỏi của người ta. Không phải câu nào cũng mở bằng "Dạ"; đổi cách mở (dạ / vâng / ôi / gọi tên…) cho tự nhiên.
- Không gọi người nhắn là "bạn" (khách đa số là cô chú, anh chị). Viết đúng chính tả, có dấu đầy đủ, không viết tắt kiểu "k", "dc".

# Tư vấn
- Trả lời thẳng trước. Biết nhu cầu thì gợi ý 1–2 sản phẩm hợp nhất kèm lý do gắn với hoàn cảnh khách, thêm [[sp:mã]] (tối đa 2). Khách muốn mua: bấm link đặt trên web (được kiểm hàng trước khi nhận), hoặc gửi tên + số điện thoại + địa chỉ để chuyên viên lên đơn.
- Thêm [[zalo]] khi cần người thật: khách gửi thông tin đặt hàng, hỏi đơn đã đặt, đổi trả, khiếu nại, giá sỉ / đại lý / cộng tác viên, sản phẩm chưa có trên web, bệnh cụ thể cần tư vấn kỹ, khách bực bội, hoặc điều em không biết. Khi đó nói tự nhiên: "em báo chị chuyên viên bên em nhắn lại cho mình ngay nha" (trong giờ làm việc; ngoài giờ thì từ 8h sáng hôm sau). Nếu khách chưa cho số điện thoại thì xin nhẹ nhàng 1 lần để chuyên viên gọi / nhắn Zalo hotline 0966 326 522 cho khách.
- Khách tự gửi số điện thoại thì cảm ơn và báo chuyên viên sẽ liên hệ.`;

async function zDm(x, d) {
  const cfg = await zCfg(x); if (!cfg.on || !x.env.ANTHROPIC_API_KEY) return { ok: true };
  const uid = String(d.uid || '').replace(/\D/g, '').slice(0, 30), text = String(d.text || '').replace(/\s+/g, ' ').trim().slice(0, 600);
  if (!uid || !text) return { ok: true };
  const now = Date.now(), sid = 'zl' + uid, dk = 'zb_dm_' + uid + '_' + fmtDate(now, 'yyMMdd'), nd = Number(await kvGet(x.db, dk) || 0);
  if (nd >= 30) return { ok: true }; // tối đa 30 câu trả lời / 1 người / ngày (tránh nhắn dồn dập)
  const row = await first(x.db, 'SELECT * FROM chats WHERE sid = ?', sid);
  let msgs = []; try { msgs = JSON.parse(row && row.msgs || '[]'); } catch (e) { }
  msgs.push({ r: 'u', t: text, at: now });
  const pm = text.match(PHONE_RE), ph = pm ? normPhone(pm[0]) : '';
  const gotPhone = ph && /^0\d{9}$/.test(ph) && !(row && row.phone) && !REF_TXT.test(text) ? ph : '';
  const hist = msgs.slice(-16); while (hist.length && hist[0].r !== 'u') hist.shift();
  const know = await kb(), w = workNow(now), u = await first(x.db, 'SELECT phone, what FROM zb_users WHERE uid = ?', uid);
  let reply = '';
  try {
    const res = await ai(x.env).messages.create({ model: FAST, max_tokens: 1500, output_config: { effort: 'low' },
      system: [{ type: 'text', text: DM_RULES + '\n' + REF_RULES + '\n' + TRUTH_RULES.replace(/mời nhắn Zalo/g, 'thêm [[zalo]] để chuyên viên hỗ trợ') },
        { type: 'text', text: 'TÀI LIỆU (thông tin chính thức của Thực Dưỡng Lành):\n\n' + know, cache_control: { type: 'ephemeral' } },
        { type: 'text', text: 'Bây giờ là ' + w.label + '. Chuyên viên ' + (w.on ? 'đang trực.' : 'ngoài giờ (trực Thứ 2 – Thứ 7, 8h–17h): gọi lại từ 8h sáng hôm sau.') + ' Tên Zalo của khách: ' + String(d.name || '').slice(0, 60) + '.' + (u && u.what ? ' Khách đã nhận trên web: ' + u.what + '.' : '') + (gotPhone ? '\n(Khách vừa gửi số điện thoại, hệ thống đã chuyển cho chuyên viên. Hãy cảm ơn và báo chuyên viên sẽ liên hệ.)' : '') }],
      messages: hist.map(m => ({ role: m.r === 'u' ? 'user' : 'assistant', content: m.t })) });
    reply = res.stop_reason === 'refusal' ? 'Dạ câu này em xin phép chưa trả lời được ạ, để chuyên viên bên em nhắn lại cho mình nha. [[zalo]]' : textOf(res);
  } catch (e) { console.error('zDm ai', e && e.message); return { ok: true, reply: 'Dạ em đang hơi chậm một chút, anh/chị nhắn lại giúp em sau ít phút nha 🙏' }; }
  const z = zText(safe(reply).replace(/\*\*/g, ''), prodMap(know));
  if (!z.text) return { ok: true };
  msgs.push({ r: 'a', t: z.text, at: Date.now() });
  await run(x.db, `INSERT INTO chats (sid, start, last, n, page, src, msgs, miss) VALUES (?, ?, ?, 1, 'Zalo trợ lý', 'Zalo', ?, ?)
    ON CONFLICT(sid) DO UPDATE SET last = excluded.last, n = chats.n + 1, msgs = excluded.msgs, miss = chats.miss + excluded.miss`, sid, now, now, JSON.stringify(msgs.slice(-60)).slice(0, 60000), z.zalo ? 1 : 0);
  await kvSet(x.db, dk, String(nd + 1), 2 * DAY);
  await zlog(x, z.zalo ? 'dm_handoff' : 'dm', { uid, name: d.name, text, reply: z.text });
  if (gotPhone) x.later(dmLead(x, { uid, name: String(d.name || ''), phone: gotPhone, msgs }));
  else if (z.zalo) x.later(handoff(x, { where: 'tin nhắn riêng', name: d.name, uid, text, reply: z.text }));
  return { ok: true, reply: z.text };
}
async function dmLead(x, o) {
  const asks = o.msgs.filter(m => m.r === 'u').map(m => m.t.replace(PHONE_RE, '[SĐT]').slice(0, 120)).slice(-5);
  const rf = await botRef(x, o.msgs.filter(m => m.r === 'u').map(m => m.t), o.phone); // 🌱 khách nói được người quen giới thiệu
  const ld = await addLead(x, Object.assign({ name: o.name || 'Khách Zalo', phone: o.phone, channel: 'Zalo Trợ lý An Lành', interest: 'Nhắn trợ lý Zalo', addInterest: true, note: 'Khách gửi số khi nhắn trợ lý Zalo An Lành (tên Zalo: ' + o.name + ') · Đã hỏi: ' + asks.join(' | ') + rf.note, by: 'Website', auto: true }, rf.lead));
  await run(x.db, "UPDATE chats SET phone = ?, name = ?, lead = ? WHERE sid = ?", o.phone, o.name, ld.id, 'zl' + o.uid);
  await run(x.db, `INSERT INTO zb_users (uid, phone, zname, lead, at) VALUES (?, ?, ?, ?, ?) ON CONFLICT(uid) DO UPDATE SET phone = excluded.phone, lead = excluded.lead`, o.uid, o.phone, o.name.slice(0, 80), ld.id, Date.now());
  await telegram(x.env, '💬 <b>KHÁCH ĐỂ LẠI SỐ QUA TRỢ LÝ ZALO</b>\n👤 ' + esc(o.name) + ' – <b>' + esc(o.phone) + '</b>\n💬 ' + esc(asks.join(' | ')) + (ld.owner ? '\n\n👤 Giao cho: ' + esc(ld.owner) : '\n\n⚠️ Chưa có người phụ trách – vào CRM để giao') + '\n👉 ' + CRM_URL + '/#tiem-nang');
}

/** Nhân sự nhắn tay trên điện thoại "Trợ lý An Lành" → trợ lý nhường cuộc trò chuyện đó 2 tiếng (chương trình Zalo tự làm, ở đây chỉ ghi nhật ký) */
async function zHuman(x, d) { await zlog(x, 'human', { uid: d.uid, text: String(d.text || '').slice(0, 300) }); return { ok: true }; }

async function zFriend(x, d) {
  const cfg = await zCfg(x); if (!cfg.on) return { ok: true, accept: false };
  const nm = String(d.name || '').trim(), uid = String(d.uid || '');
  const dk = 'zb_fr_' + fmtDate(Date.now(), 'yyMMdd'), n = Number(await kvGet(x.db, dk) || 0);
  if (n >= 30) { await zlog(x, 'friend', { uid, name: nm, text: '⏸ Quá 30 lời mời hôm nay: để nhân sự đồng ý tay trên điện thoại trợ lý (Zalo → Danh bạ → Lời mời kết bạn)' }); return { ok: true, accept: false }; } // tài khoản mới: đồng ý vừa phải
  await kvSet(x.db, dk, String(n + 1), 2 * DAY);
  await zlog(x, 'friend', { uid, name: nm, text: String(d.msg || '') });
  const u = uid ? await first(x.db, 'SELECT what FROM zb_users WHERE uid = ?', uid) : null;
  return { ok: true, accept: true, text: 'Dạ em chào anh/chị' + (nm ? ' ' + nm : '') + ' ạ 🌿 Em là An Lành bên Thực Dưỡng Lành, cảm ơn anh/chị đã kết bạn với em.' + (u && u.what ? ' Anh/chị vừa nhận ' + u.what + ' trên web, cần em gửi lại hay hướng dẫn cách dùng thì nhắn em nha.' : '') + ' Anh/chị cần hỏi gì về sản phẩm, cách dùng hay thực đơn lành cứ nhắn em, em trả lời liền ạ.' };
}
async function zFriendOk(x, d) { // đã đồng ý kết bạn → ghi lại để đo % người vào nhóm kết bạn
  const uid = String(d.uid || '').replace(/\D/g, '').slice(0, 30); if (!uid) return { ok: true };
  await run(x.db, 'INSERT INTO zb_users (uid, zname, at, friend) VALUES (?, ?, ?, ?) ON CONFLICT(uid) DO UPDATE SET friend = COALESCE(zb_users.friend, excluded.friend)', uid, String(d.name || '').slice(0, 80), Date.now(), Date.now());
  return { ok: true };
}

async function zLogin(x, d) {
  const k = 'zb_login_' + fmtDate(Date.now(), 'yyMMddHH');
  if (!await kvGet(x.db, k)) { await kvSet(x.db, k, '1', 2 * 3600e3); await telegram(x.env, '⚠️ <b>Trợ lý Zalo An Lành bị đăng xuất</b>' + (d.reason ? ' (' + esc(String(d.reason).slice(0, 120)) + ')' : '') + '\n👉 Cần mở máy đang chạy trợ lý, quét mã QR bằng Zalo của điện thoại "Trợ lý An Lành" (xem zalo-bot/README.md).'); }
  return { ok: true };
}

/* ---------------------------------------------------------------- soạn bài hằng ngày (cron 10 phút / lần, mỗi lần tối đa 1 bài) */
export async function zbotTick(x) {
  const cfg = await zCfg(x), now = Date.now(), st = await kvJson(x.db, 'zb_status', null);
  if (st && !st.down && now - st.at > 20 * 60e3) { // chương trình Zalo im lặng > 20 phút → báo 1 lần
    st.down = 1; await kvSet(x.db, 'zb_status', JSON.stringify(st));
    await telegram(x.env, '⚠️ <b>Trợ lý Zalo An Lành mất kết nối</b> từ ' + fmtDate(st.at, 'HH:mm dd/MM') + '.\n👉 Kiểm tra máy đang chạy trợ lý (bật máy, có mạng), xem zalo-bot/README.md.');
  }
  if (!cfg.on || !st || !x.env.ANTHROPIC_API_KEY) return; // chưa từng chạy chương trình Zalo → chưa soạn
  // soạn trước cfg.lead ngày (10/11/2026: 3 ngày, trước đây hôm nay + ngày mai) để nhân sự có 2–3 ngày duyệt
  const today = fmtDate(now, 'yyyyMMdd'), days = Array.from({ length: leadOf(cfg) + 1 }, (_, i) => addDay(today, i)), last = days[days.length - 1];
  const have = new Set((await all(x.db, 'SELECT id FROM zb_posts WHERE day >= ? AND day <= ?', today, last)).map(r => r.id));
  const plan = {}; for (const r of await all(x.db, 'SELECT id, status, at_time FROM zb_plan WHERE day >= ? AND day <= ?', today, last)) plan[r.id] = r;
  for (const day of days) for (const sl of cfg.slots) {
    const id = day + '_' + sl.id, pl = plan[id];
    if (!sl.on || have.has(id) || (pl && pl.status === 'skip')) continue; // 📋 kế hoạch ghi "không đăng bài này"
    const t = slotTime(day, (pl && pl.at_time) || slotAt(sl, day));
    if (t < now + 20 * 60e3) continue;
    if (pl && pl.status === 'draft' && t - now > DAY) continue; // 📋 chủ đề chưa duyệt: chờ duyệt, còn dưới 24 tiếng mới viết theo chủ đề nháp (vẫn kịp duyệt bài)
    try { await zWrite(x, day, sl.id, ''); } catch (e) { console.error('zWrite', e.message); await kvSet(x.db, 'zb_write_err', fmtDate(now, 'HH:mm dd/MM') + ': ' + String(e.message).slice(0, 200)); }
    return;
  }
  try { await planTick(x, cfg, now); } catch (e) { console.error('planTick', e.message); await kvSet(x.db, 'zb_plan_err', fmtDate(now, 'HH:mm dd/MM') + ': ' + String(e.message).slice(0, 200)); }
}

/* ---------------------------------------------------------------- 📋 Kế hoạch chủ đề (10/11/2026, anh Sơn: "hiển thị kế hoạch nội dung là các chủ đề chính trong tuần hay cả tháng
 * để anh và bạn phụ trách duyệt trước, duyệt rồi trợ lý dựa vào đó viết bài; chủ đề phân bổ theo 3 tầng như khoá Content").
 * Khung mỗi bài vẫn là lịch theo thứ (THEME) + ngày lễ (zday.js); AI chọn chủ đề cụ thể + nhóm khách + tension + sản phẩm cho từng bài.
 * Tỉ lệ phễu (khoá Content): lịch tuần ≈ 57/29/14 (mặc định, giữ đúng tầng của khung) · nhóm ấm 50/30/20 · mùa cao điểm 🟠 30–40% (tối đa 2 tuần). */
export const MIX = {
  frame: { name: 'Theo lịch tuần đã duyệt (🔵 57% · ⚪ 29% · 🟠 14%)', rule: '' },
  warm: { name: 'Nhóm ấm (🔵 50% · ⚪ 30% · 🟠 20%)', rule: 'Tỉ lệ mục tiêu cả kỳ: khoảng 50% 🔵 TOFU · 30% ⚪ MOFU · 20% 🟠 BOFU (khoá Content: kênh ấm – người trong nhóm đã để số nhận quà). Được đổi tầng của bài không có 🔒 để đạt tỉ lệ; không để 2 bài 🟠 liền nhau.' },
  peak: { name: 'Mùa cao điểm (🟠 30–40%, tối đa 2 tuần)', rule: 'Mùa cao điểm (dịp quà, Tết, ưu đãi lớn đang chạy): khoảng 40% 🔵 TOFU · 25% ⚪ MOFU · 35% 🟠 BOFU. Được đổi tầng của bài không có 🔒 để đạt tỉ lệ; không để 2 bài 🟠 liền nhau; bài 🟠 phải dựa trên ưu đãi / lý do mua có thật.' }
};
const WD = ['Chủ nhật', 'Thứ 2', 'Thứ 3', 'Thứ 4', 'Thứ 5', 'Thứ 6', 'Thứ 7'];
const dm = day => day.slice(6, 8) + '/' + day.slice(4, 6);
const cutS = (s, n) => String(s == null ? '' : s).replace(/\s+/g, ' ').trim().slice(0, n);

/** Cron (khi không có bài cần soạn): nhắc duyệt chủ đề 3 ngày tới (1 lần / ngày, sau 9h) + tự lập kế hoạch tuần kế tiếp (tối đa 1 lần / 6 tiếng) */
async function planTick(x, cfg, now) {
  const today = fmtDate(now, 'yyyyMMdd'), lead = leadOf(cfg), on = cfg.slots.filter(s => s.on).map(s => s.id); if (!on.length) return;
  const rk = 'zb_plan_rem_' + fmtDate(now, 'yyMMdd');
  if (vnHour(now) >= 9 && vnHour(now) < 20 && !(await kvGet(x.db, rk))) {
    const wait = await all(x.db, "SELECT id, day, slot, topic FROM zb_plan WHERE status = 'draft' AND day >= ? AND day <= ? AND id NOT IN (SELECT id FROM zb_posts) ORDER BY day, slot", today, addDay(today, lead + 1));
    if (wait.length) {
      await kvSet(x.db, rk, '1', 2 * DAY);
      await telegram(x.env, '📋 <b>Còn ' + wait.length + ' chủ đề bài Zalo chưa duyệt</b> (' + lead + ' ngày tới). Trợ lý chỉ viết bài sớm khi chủ đề đã duyệt; chưa duyệt thì 24 tiếng trước giờ đăng mới viết theo chủ đề nháp.\n' +
        wait.slice(0, 6).map(r => '• ' + WD[weekday(r.day)] + ' ' + dm(r.day) + ' ' + (SLOT_NAME[r.slot] || r.slot).toLowerCase() + ': ' + esc(r.topic)).join('\n') + '\n👉 Duyệt: ' + CRM_URL + '/#tro-ly-zalo');
    }
  }
  if (cfg.planAuto === false || now - Number(await kvGet(x.db, 'zb_plan_auto') || 0) < 6 * 3600e3) return;
  const start = addDay(today, lead + 1), end = addDay(today, 10); // luôn có chủ đề tới ít nhất 10 ngày tới
  const have = new Set((await all(x.db, 'SELECT id FROM zb_plan WHERE day >= ? AND day <= ? UNION SELECT id FROM zb_posts WHERE day >= ? AND day <= ?', start, end, start, end)).map(r => r.id));
  let from = ''; for (let d = start; d <= end && !from; d = addDay(d, 1)) if (on.some(s => !have.has(d + '_' + s))) from = d;
  if (!from) return;
  await kvSet(x.db, 'zb_plan_auto', String(now));
  const pm = cfg.pmix || {}, use = pm.to && pm.to >= from; // trọng tâm / tỉ lệ người lập kế hoạch gần nhất chọn, còn hạn thì dùng tiếp
  const r = await zPlanMake(x, from, 7, { mix: use ? pm.mix : 'frame', focus: use ? pm.focus : '', by: 'AI', fill: 1 });
  if (r.n) await telegram(x.env, '📋 <b>Kế hoạch chủ đề nhóm Zalo ' + dm(from) + '–' + dm(addDay(from, 6)) + '</b>: trợ lý đã lập ' + r.n + ' chủ đề theo 3 tầng phễu (' + r.mixTxt + '). Mời duyệt trước để trợ lý viết bài theo.\n👉 ' + CRM_URL + '/#tro-ly-zalo');
}

/** Khung từng bài trong khoảng ngày: { id, day, slot, fr (dayTheme), lock } */
async function frames(x, cfg, from, n) {
  const out = [];
  for (let i = 0; i < n; i++) {
    const day = addDay(from, i), live = await offersLive(x, slotTime(day, '12:00'));
    for (const sl of cfg.slots) {
      if (!sl.on) continue;
      const fr = dayTheme(day, sl.id === 'toi' ? 'toi' : 'sang', baseTheme, live.length > 0);
      out.push({ id: day + '_' + sl.id, day, slot: sl.id, sl, fr, live, lock: !!(fr.ev || fr.quiz || fr.q) }); // 🔒 ngày lễ, đố vui tối Thứ 4 → đáp án sáng Thứ 5: giữ tầng
    }
  }
  return out;
}

/** Lập (lại) chủ đề cho n ngày từ `from` (yyyyMMdd), tối đa 7 ngày / lần gọi (CRM gọi nhiều lần cho cả tháng).
 * Giữ nguyên: chủ đề đã duyệt / đã bỏ, bài đã đăng / đã duyệt / nhân sự đã sửa. opt: { mix, focus, by, only: [id] (lập lại đúng các bài này), hint } */
export async function zPlanMake(x, from, n, opt) {
  opt = opt || {};
  const cfg = await zCfg(x), now = Date.now(), mix = MIX[opt.mix] ? opt.mix : 'frame', to = addDay(from, Math.max(1, Math.min(7, n)) - 1);
  const fr = await frames(x, cfg, from, Math.max(1, Math.min(7, n)));
  const posts = {}; for (const r of await all(x.db, 'SELECT id, day, slot, topic, funnel, status, by_name FROM zb_posts WHERE day >= ? AND day <= ?', addDay(from, -14), addDay(to, 7))) posts[r.id] = r;
  const plans = {}; for (const r of await all(x.db, 'SELECT * FROM zb_plan WHERE day >= ? AND day <= ?', addDay(from, -7), addDay(to, 7))) plans[r.id] = r;
  const only = Array.isArray(opt.only) ? opt.only : null;
  const todo = fr.filter(z => {
    const p = posts[z.id], pl = plans[z.id];
    if (slotTime(z.day, (pl && pl.at_time) || slotAt(z.sl, z.day)) < now + 30 * 60e3) return false; // đã qua / sắp tới giờ
    if (p && (p.status === 'sent' || p.status === 'ok' || (p.by_name && p.by_name !== 'AI'))) return false; // bài đã chốt: giữ
    if (only) return only.includes(z.id);
    return !pl || (pl.status === 'draft' && !opt.fill); // tự lập (fill): chỉ điền bài chưa có chủ đề, không ghi đè chủ đề nhân sự đang sửa dở
  });
  if (!todo.length) return { n: 0, items: [], mixTxt: MIX[mix].name };
  const know = await kb(), prods = prodMap(know), bank = (await insBank(x)).filter(g => g.on && g.tensions.length);
  const done = [];
  for (const p of Object.values(posts)) if (p.topic && !todo.find(z => z.id === p.id)) done.push({ k: p.id, t: '- ' + WD[weekday(p.day)] + ' ' + dm(p.day) + ' ' + (SLOT_NAME[p.slot] || p.slot).toLowerCase() + (p.status === 'sent' ? ' (đã đăng)' : '') + ': ' + p.topic + (p.funnel ? ' [' + p.funnel + ']' : '') });
  for (const p of Object.values(plans)) if (p.topic && p.status !== 'skip' && !posts[p.id] && !todo.find(z => z.id === p.id)) done.push({ k: p.id, t: '- ' + WD[weekday(p.day)] + ' ' + dm(p.day) + ' ' + (SLOT_NAME[p.slot] || p.slot).toLowerCase() + (p.status === 'ok' ? ' (đã duyệt)' : ' (kế hoạch)') + ': ' + p.topic + ' [' + p.f + (p.gn ? ' · ' + p.gn : '') + ']' });
  done.sort((a, b) => a.k < b.k ? -1 : 1);
  const offers = [...new Map(todo.flatMap(z => z.live).map(o => [o.id || o.title, o])).values()];
  const ask = [
    'Lập KẾ HOẠCH CHỦ ĐỀ cho nhóm Zalo cộng đồng "Sống khỏe cùng Thực Dưỡng Lành" (thành viên đã để số nhận quà trên web: cô chú trung niên, mẹ bỉm, người ăn chay, dân văn phòng; nhóm chủ yếu giữ chân + tạo niềm tin, bán vừa phải).',
    'Mỗi dòng ở mục CÁC BÀI CẦN LẬP là 1 bài sẽ đăng. Chọn cho mỗi bài 1 chủ đề CỤ THỂ để quản lý duyệt trước; sau khi duyệt, trợ lý viết bài đúng chủ đề này.',
    '', '# 3 TẦNG PHỄU (khoá Content Tuấn Hà – K133)', ...Object.values(FUN).map(v => '- ' + v.name + ': ' + v.rule),
    MIX[mix].rule ? '\n# TỈ LỆ PHỄU KỲ NÀY\n' + MIX[mix].rule : '\n# TẦNG PHỄU: giữ ĐÚNG tầng ghi ở từng bài (lịch tuần anh Sơn đã duyệt).',
    opt.focus ? '\n# TRỌNG TÂM KỲ NÀY (quản lý giao, ưu tiên bám theo): ' + cutS(opt.focus, 500) : '',
    '', '# NGÂN HÀNG INSIGHT (id nhóm: tên – chân dung | tension: điều mong ↔ điều cản [SP: sản phẩm riêng, không nhãn = dùng chung])',
    ...bank.map(g => '- ' + g.id + ': ' + g.name + (g.who ? ' – ' + cutS(g.who, 140) : '') + (g.prods.length ? ' | hợp: ' + g.prods.map(spName).join(', ') : '') + '\n  ' + g.tensions.slice(0, 8).join('\n  ')),
    '', '# SẢN PHẨM (mã – tên)', ...Object.entries(prods).map(([c, p]) => '- ' + c + ': ' + p.name),
    offers.length ? '\n# ƯU ĐÃI ĐANG CHẠY (chỉ dùng đúng như sau)\n' + offers.map(o => '- ' + [o.title, o.prod ? 'sản phẩm: ' + o.prod : '', o.text, o.until ? 'hạn đến ' + o.until : ''].filter(Boolean).join(' · ')).join('\n') : '\nHiện không có ưu đãi riêng: bài 🟠 không bịa khuyến mãi (chỉ freeship đơn từ 300k, được kiểm hàng trước khi nhận).',
    done.length ? '\n# BÀI ĐÃ ĐĂNG / ĐÃ CHỐT QUANH KỲ NÀY (không lặp chủ đề, món, nguyên liệu, sản phẩm trong 7 ngày)\n' + done.map(d => d.t).join('\n') : '',
    '', '# CÁC BÀI CẦN LẬP (id · ngày · buổi · tầng · khung chủ đề)' + (mix === 'frame' ? '' : ' – 🔒 = giữ nguyên tầng'),
    ...todo.map(z => { const old = plans[z.id]; return '- ' + z.id + ' · ' + WD[weekday(z.day)] + ' ' + dm(z.day) + ' (âm ' + lunar(z.day).text + ') · ' + (z.slot === 'toi' ? 'tối' : 'sáng') + ' · ' + z.fr.f + (z.lock && mix !== 'frame' ? ' 🔒' : '') + (z.fr.ev ? ' · dịp: ' + z.fr.ev : '') + '\n  khung: ' + cutS(z.fr.t, 400) + (only && old && old.topic ? '\n  chủ đề cũ (cần đổi khác): ' + old.topic : ''); }),
    opt.hint ? '\nYêu cầu của quản lý cho lần lập này: ' + cutS(opt.hint, 300) : '',
    '', 'Yêu cầu:',
    '- Giữ đúng khung của từng bài (ngày lễ, đố vui tối Thứ 4 → đáp án sáng Thứ 5, cảm nhận khách tối Thứ 5, góc sản phẩm cuối tuần…). Chủ đề cụ thể = khung + 1 món / nguyên liệu / mẹo / câu hỏi / sản phẩm cụ thể.',
    '- 🔵 TOFU: giá trị nằm ở nội dung, tên sản phẩm KHÔNG có trong chủ đề. ⚪ MOFU: bằng chứng / kiến thức có thật trong TÀI LIỆU. 🟠 BOFU: đúng 1 sản phẩm (ghi mã ở "sp") gỡ đúng tension.',
    '- Mỗi bài 1 nhóm khách (id trong ngân hàng) + 1 tension của nhóm đó (được diễn đạt lại nhưng đủ 2 cực). Rải đều các nhóm trong kỳ, không 1 nhóm quá 2 bài liền; bài theo dịp lễ chọn nhóm rộng nhất.',
    '- Xen kẽ sản phẩm ở các bài MOFU / BOFU; không lặp món / nguyên liệu / sản phẩm trong 7 ngày.',
    '- Bài cảm nhận khách hàng: chủ đề chỉ ghi hướng kể (vd "Cảm nhận thật của khách về bữa sáng"), KHÔNG tự đặt nội dung cảm nhận; trợ lý dùng cảm nhận thật khi viết. Bài đố vui: chủ đề nêu rõ câu đố về điều gì; bài đáp án sáng hôm sau ghi "Đáp án đố vui + …".',
    '- Chỉ dùng thông tin có trong TÀI LIỆU; không bịa ưu đãi, cảm nhận khách, số liệu; không dùng "chữa / điều trị / khỏi bệnh"; tránh cụm dễ phạm luật quảng cáo.',
    '', 'Trả về DUY NHẤT 1 mảng JSON (không giải thích), mỗi bài 1 phần tử đúng thứ tự trên:',
    '[{"id": "<id>", "f": "TOFU|MOFU|BOFU", "topic": "<chủ đề cụ thể, tối đa 18 chữ>", "idea": "<góc viết / câu mở gợi ý, 1 câu>", "cta": "<lối ra của bài, tối đa 10 chữ>", "g": "<id nhóm khách>", "tn": "<điều họ mong> ↔ <điều đang cản họ>", "sp": "<mã sản phẩm hoặc rỗng>"}]'
  ].filter(s => s !== '').join('\n');
  const req = { model: WRITER, max_tokens: 12000, output_config: { effort: 'medium' },
    system: [{ type: 'text', text: 'Bạn là người lập kế hoạch nội dung cho nhóm Zalo cộng đồng của Thực Dưỡng Lành (VitaGreen Nutrition). Tiếng Việt chuẩn, tự nhiên.\n' + TRUTH_RULES },
      { type: 'text', text: 'TÀI LIỆU (thông tin chính thức của Thực Dưỡng Lành):\n\n' + know, cache_control: { type: 'ephemeral' } }],
    messages: [{ role: 'user', content: ask }] };
  const ro = { timeout: 170e3, headers: { 'x-tdl-muc': 'zalo-kh' } };
  let res;
  try { res = await ai(x.env).beta.messages.create(Object.assign({ betas: ['server-side-fallback-2026-07-01'], fallbacks: 'default' }, req), ro); }
  catch (e) { if (!(e instanceof Anthropic.BadRequestError)) throw e; res = await ai(x.env).messages.create(req, ro); }
  if (res.stop_reason === 'refusal') throw new Error('AI từ chối lập kế hoạch');
  const raw = textOf(res), m = raw.match(/\[[\s\S]*\]/);
  let list = []; try { list = JSON.parse(m ? m[0] : '[]'); } catch (e) { throw new Error('AI trả kế hoạch sai định dạng, bấm lập lại nhé'); }
  if (!Array.isArray(list)) list = [];
  const items = [];
  for (const z of todo) {
    const it = list.find(v => v && String(v.id) === z.id) || (list.length === todo.length ? list[todo.indexOf(z)] : null);
    if (!it || !cutS(it.topic, 200)) continue;
    const f = mix !== 'frame' && !z.lock && FUNNEL[String(it.f).toUpperCase()] ? String(it.f).toUpperCase() : z.fr.f;
    const g = bank.find(v => v.id === String(it.g || '').trim()) || null, sp = prods[String(it.sp || '').trim()] ? String(it.sp).trim() : '';
    const row = { id: z.id, day: z.day, slot: z.slot, f, topic: cutS(it.topic, 200), idea: cutS(it.idea, 300), cta: cutS(it.cta, 120), g: g ? g.id : '', gn: g ? g.name : '', tn: cutS(it.tn, 300).replace(/<->|<=>|->/g, '↔'), sp, ev: z.fr.ev || '', frame: cutS(z.fr.t, 600) };
    await run(x.db, `INSERT INTO zb_plan (id, day, slot, f, topic, idea, cta, g, gn, tn, sp, ev, frame, status, by_name, at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'draft', ?, ?)
      ON CONFLICT(id) DO UPDATE SET f = excluded.f, topic = excluded.topic, idea = excluded.idea, cta = excluded.cta, g = excluded.g, gn = excluded.gn, tn = excluded.tn, sp = excluded.sp, ev = excluded.ev, frame = excluded.frame,
      status = 'draft', by_name = excluded.by_name, at = excluded.at, ok_by = '', ok_at = NULL`,
      row.id, row.day, row.slot, row.f, row.topic, row.idea, row.cta, row.g, row.gn, row.tn, row.sp, row.ev, row.frame, opt.by || 'AI', now);
    items.push(row);
  }
  if (!items.length) throw new Error('AI chưa lập được chủ đề, bấm lập lại nhé');
  return { n: items.length, items, mixTxt: MIX[mix].name };
}

/** 📋 Chủ đề vừa duyệt / sửa mà bài AI đã soạn trước theo chủ đề cũ (chưa ai sửa, chưa duyệt, còn > 1 tiếng tới giờ đăng) → xoá bài để trợ lý soạn lại đúng chủ đề (≈ 10 phút) */
async function planReset(x, id) {
  const p = await first(x.db, 'SELECT id, day, slot, status, by_name, at_time FROM zb_posts WHERE id = ?', id); if (!p) return '';
  if (p.status === 'sent') return 'sent';
  const cfg = await zCfg(x), sl = cfg.slots.find(s => s.id === p.slot) || { id: p.slot, at: '07:30' };
  if (p.status === 'draft' && p.by_name === 'AI' && slotTime(p.day, p.at_time || slotAt(sl, p.day)) > Date.now() + 3600e3) {
    if (p.at_time) await run(x.db, "UPDATE zb_plan SET at_time = ? WHERE id = ? AND COALESCE(at_time, '') = ''", p.at_time, id); // giữ giờ riêng đã đặt cho bài
    await run(x.db, 'DELETE FROM zb_posts WHERE id = ?', id); return 'redo';
  }
  return 'kept';
}

/** ⏰ Đặt giờ đăng riêng cho 1 bài (id = yyyyMMdd_slot): ghi vào bài đã soạn + chủ đề kế hoạch. at = '' → về giờ của khung */
async function setTime(x, id, at) {
  const [day, slot] = String(id).split('_'); if (!/^\d{8}$/.test(day || '') || !/^(sang|toi)$/.test(slot || '')) return { ok: false, error: 'Không rõ bài.' };
  let v = '';
  if (at) {
    v = okTime(slot, at); if (!v) return { ok: false, error: 'Giờ chưa hợp lệ. ' + TIME_RULE[slot] };
    if (slotTime(day, v) < Date.now() + 5 * 60e3) return { ok: false, error: 'Giờ này đã qua (hoặc còn dưới 5 phút), chọn giờ muộn hơn nhé.' };
  }
  const p = await first(x.db, 'SELECT status FROM zb_posts WHERE id = ?', id), pl = await first(x.db, 'SELECT status FROM zb_plan WHERE id = ?', id);
  if (p && p.status === 'sent') return { ok: false, error: 'Bài này đã đăng rồi.' };
  if (!p && !pl) return { ok: false, error: 'Bài này chưa có chủ đề / chưa soạn: lập kế hoạch hoặc bấm ✍️ Soạn ngay trước.' };
  if (p) await run(x.db, 'UPDATE zb_posts SET at_time = ? WHERE id = ?', v, id);
  if (pl) await run(x.db, 'UPDATE zb_plan SET at_time = ? WHERE id = ?', v, id);
  return { ok: true, at: v };
}

/** Soạn 1 bài (hint: ý nhân sự gõ khi bấm "Viết lại") */
/** Kho ảnh thật cho bài đăng: https://thucduonglanh.vn/anh-zalo.json (build.py zalo_imgs(): ảnh trong các bài viết + chú thích), giữ trong bộ nhớ 10 phút */
let imgMem = null;
export async function imgLib() {
  if (imgMem && Date.now() - imgMem.t < 10 * 60e3) return imgMem.list;
  try { const r = await fetch(SITE + '/anh-zalo.json', { cf: { cacheTtl: 600, cacheEverything: true } }); if (r.ok) { const l = await r.json(); if (Array.isArray(l)) imgMem = { t: Date.now(), list: l }; } }
  catch (e) { console.error('anh-zalo', e.message); }
  return imgMem ? imgMem.list : [];
}

/** Link kết bạn với tài khoản trợ lý (zalo.me/<số SIM trợ lý>, chương trình Zalo gửi số khi chạy) */
const friendLink = st => st && st.me && /^0\d{9}$/.test(String(st.me.phone || '')) ? 'https://zalo.me/' + st.me.phone : '';
const friendAsk = link => link ? '\n\n👉 Anh/chị bấm kết bạn với em để em gửi quà, nhắc lịch sống khỏe và hỗ trợ riêng nha: ' + link : '';
/** Link web trong tin đăng nhóm → gắn mã tin để CRM đếm đơn (đơn ghi nguồn "zalo / nhom / <mã>") */
// link web trong bài → gắn mã theo dõi theo từng bài (nguồn đơn "zalo / nhom / <mã bài>", CRM đếm 🛒 đơn mỗi bài). 11/11/2026: giữ tham số khác (vd ?uudai=MÃ), bỏ utm cũ, không nuốt dấu câu cuối link
const tagLinks = (t, id) => String(t).replace(/https:\/\/thucduonglanh\.vn[^\s)]*/g, u => {
  const tail = (u.match(/[.,!?;:…]+$/) || [''])[0], [b, q = ''] = u.slice(0, u.length - tail.length).split('#')[0].split('?');
  return b + '?' + q.split('&').filter(s => s && !/^utm_/i.test(s)).concat(['utm_source=zalo', 'utm_medium=nhom', 'utm_campaign=' + id]).join('&') + tail;
});
export async function zWrite(x, day, slot, hint, by, grp) {
  const know = await kb(), prods = prodMap(know), wd = new Date(slotTime(day, '12:00') + TZ_MS).getUTCDay();
  const recent = await all(x.db, "SELECT day, slot, topic, img FROM zb_posts WHERE topic != '' AND slot != 'chuc' ORDER BY day DESC LIMIT 20");
  const used = new Set(recent.map(r => r.img).filter(Boolean)), lib = (await imgLib()).filter(i => !used.has(i.url)); // không lặp ảnh đã dùng gần đây
  // 📅 ngày lễ, rằm, mùng 1 (zday.js) thay chủ đề theo thứ; ngày đôi 11/11, 12/12 chỉ đăng khi có ưu đãi đang chạy. Ưu đãi tính tới ngày đăng (bài soạn trước 2–3 ngày)
  const cfg = await zCfg(x), sang = slot !== 'toi', live = await offersLive(x, slotTime(day, '12:00')), fr = dayTheme(day, sang ? 'sang' : 'toi', baseTheme, live.length > 0), lu = lunar(day);
  // 📋 chủ đề trong kế hoạch (đã duyệt, hoặc nháp khi còn < 24 tiếng): giữ khung theo thứ / dịp, đổi tầng phễu thì bỏ các phần riêng của khung (đố vui, cảm nhận khách)
  const pl = await first(x.db, "SELECT * FROM zb_plan WHERE id = ? AND status IN ('ok', 'draft') AND topic != ''", day + '_' + slot);
  const pf = pl && FUNNEL[pl.f] ? pl.f : fr.f, same = pf === fr.f;
  const th = pl ? Object.assign({}, fr, { f: pf, quiz: same ? fr.quiz : 0, fb: same ? fr.fb : 0, link: pf === 'BOFU' ? 1 : same ? fr.link : 0 }) : fr, evTxt = th.ev && !th.moved;
  // ưu đãi đang chạy (Marketing nhập ở CRM) cho bài bán hàng
  const offers = th.f === 'BOFU' ? live : [];
  // đố vui tối qua → sáng nay công bố đáp án
  const quiz = th.quiz && !dayTheme(addDay(day, -1), 'toi', baseTheme, live.length > 0).ev ? await first(x.db, "SELECT text FROM zb_posts WHERE day = ? AND slot = 'toi'", addDay(day, -1)) : null; // tối qua là bài ngày lễ thì không có đố vui
  // ⏰ giờ đăng thật của bài (giờ riêng nhân sự đặt / giờ khung / giờ thử) → AI viết lời chào hợp buổi
  const sl0 = cfg.slots.find(z => z.id === slot) || { id: slot, at: sang ? '07:30' : '20:00' };
  // cảm nhận khách hàng thật (anh Sơn cho phép đăng trong nhóm 31/10/2026): lấy cái lâu chưa dùng nhất
  const fbs = th.fb ? ((await kvJson(x.db, 'zb_fb', [])) || []).filter(f => f.on !== false).sort((a, b) => (a.used || 0) - (b.used || 0)) : [];
  const fb = fbs[0] || null;
  // học từ số đo: bài cùng tầng phễu nhiều người tương tác nhất / ít nhất trong 45 ngày
  const scored = await all(x.db, "SELECT topic, funnel, eng_people, eng_msgs FROM zb_posts WHERE status = 'sent' AND sent_at >= ? AND funnel = ? ORDER BY eng_people DESC, eng_msgs DESC", Math.max(TRACK_FROM, Date.now() - 45 * DAY), th.f);
  // 🎯 nhóm khách + tension (insight.js): viết lại giữ nhóm cũ, còn lại xoay vòng nhóm ít được viết nhất trong nhóm Zalo
  const old = await first(x.db, 'SELECT ins, at_time FROM zb_posts WHERE id = ?', day + '_' + slot); let og = ''; try { og = hint && old && old.ins ? JSON.parse(old.ins).g || '' : ''; } catch (e) { }
  const atT = (old && old.at_time) || (pl && pl.at_time) || '', at = atT || slotAt(sl0, day), hh = Number(at.slice(0, 2));
  const tod = hh < 9 ? 'sáng sớm' : hh < 11 ? 'buổi sáng' : hh < 13 ? 'buổi trưa' : hh < 18 ? 'buổi chiều' : 'buổi tối';
  const ip = await insPick(x, 'zalo', grp || og || (pl ? pl.g : ''), Object.assign(pl && pl.sp ? { prod: pl.sp } : {}, { noBig: !!(th.ev && !th.moved && th.f === 'TOFU') })); // nhân sự chọn nhóm khi viết lại > nhóm cũ > nhóm trong kế hoạch; bài chúc dịp lễ không theo big idea
  const plTn = pl && pl.tn && ip.g && ip.g.id === pl.g ? pl.tn : '';
  const learn = scored.length >= 4 ? 'Bài cùng loại trong nhóm này được nhiều người hưởng ứng nhất (học cách đặt vấn đề, cách hỏi):\n' + scored.slice(0, 3).map(r => '- ' + r.topic + ' (' + r.eng_people + ' người)').join('\n') + '\nBài ít người hưởng ứng (tránh kiểu này):\n' + scored.slice(-2).map(r => '- ' + r.topic + ' (' + r.eng_people + ' người)').join('\n') : '';
  const ask = [
    'Viết 1 bài đăng nhóm Zalo cộng đồng "Sống khỏe cùng Thực Dưỡng Lành" (thành viên phần lớn là cô chú trung niên, mẹ bỉm, người ăn chay, dân văn phòng).',
    'Ngày: ' + ['Chủ nhật', 'Thứ 2', 'Thứ 3', 'Thứ 4', 'Thứ 5', 'Thứ 6', 'Thứ 7'][wd] + ' ' + day.slice(6, 8) + '/' + day.slice(4, 6) + (evTxt ? ' (âm lịch: ' + lu.text + ') · dịp: ' + th.ev : '') + ' · đăng lúc ' + at.replace(':', 'h') + ' (' + tod + ').',
    pl ? 'Chủ đề ' + (pl.status === 'ok' ? 'ĐÃ DUYỆT' : 'đã lên') + ' trong kế hoạch nội dung (viết đúng chủ đề này): ' + pl.topic + ' (tầng phễu: ' + FUNNEL[th.f] + ')' + (pl.idea ? '\nGóc viết / câu mở gợi ý: ' + pl.idea : '') + (pl.cta ? '\nLối ra của bài: ' + pl.cta : '') +
      (pl.sp ? '\nSản phẩm của bài: ' + ((prods[pl.sp] || {}).name || spName(pl.sp)) : '') + (same ? '\nKhung chủ đề theo thứ / dịp (giữ nhịp nhóm): ' + fr.t : '') + (hint ? '\nYêu cầu thêm của nhân sự: ' + hint : '')
      : 'Chủ đề hôm nay: ' + th.t + ' (tầng phễu: ' + FUNNEL[th.f] + ')' + (hint ? '\nYêu cầu thêm của nhân sự: ' + hint : ''),
    '', insBlock(ip, th.f, { light: !!(th.ev && !th.moved && th.f === 'TOFU') }), plTn ? 'TENSION ĐÃ CHỌN TRONG KẾ HOẠCH (dùng đúng tension này): ' + plTn : '', 'Chủ đề hôm nay là khung bắt buộc: giữ đúng chủ đề, chỉ chọn góc viết (món, mẹo, câu hỏi, sản phẩm) chạm đúng tension của nhóm khách trên.', '',
    quiz ? (th.ev ? 'CÂU ĐỐ TỐI QUA (giữ chủ đề hôm nay, công bố ngắn đáp án đúng ở cuối bài, giải thích 1 câu; bài tối qua không phải câu đố thì bỏ phần này):\n' : 'CÂU ĐỐ TỐI QUA (công bố đáp án đúng, giải thích 1–2 câu; bài tối qua không phải câu đố thì bỏ phần đáp án):\n') + String(quiz.text).slice(0, 1200) : th.quiz && !th.ev ? 'Tối qua không có câu đố: bỏ phần đáp án, chỉ làm phần hỏi đáp.' : '',
    th.fb ? (fb ? 'CẢM NHẬN KHÁCH HÀNG (thật, khách đồng ý chia sẻ; chỉ dùng đúng ý này, không thêm chi tiết, không nêu họ tên đầy đủ – gọi "một chị khách", "anh khách quen"…):\n' + fb.note : 'Chưa có cảm nhận khách hàng mới: thay bằng câu hỏi mời mọi người kể trải nghiệm dùng sản phẩm của mình (không bịa cảm nhận).') : '',
    th.f === 'BOFU' ? (offers.length ? 'ƯU ĐÃI ĐANG CHẠY (chỉ nói đúng như sau):\n' + offers.map(o => '- ' + [o.title, o.prod ? 'sản phẩm: ' + o.prod : '', o.text, o.until ? 'hạn đến ' + o.until : ''].filter(Boolean).join(' · ')).join('\n') : 'Hiện không có ưu đãi riêng: không bịa khuyến mãi, chỉ nhắc freeship đơn từ 300k và được kiểm hàng trước khi nhận.') : '',
    learn,
    recent.length ? 'Các bài gần đây (KHÔNG lặp lại chủ đề / nguyên liệu / món / sản phẩm đã viết trong 7 ngày):\n' + recent.map(r => '- ' + r.day.slice(6, 8) + '/' + r.day.slice(4, 6) + ' ' + (SLOT_NAME[r.slot] || r.slot) + ': ' + r.topic).join('\n') : '',
    '',
    'Giọng văn: như một người chăm nhóm thật, ấm áp, gần gũi, kính trọng ("cô chú, anh chị"), xưng "Thực Dưỡng Lành" hoặc "em". Không văn quảng cáo, không giật tít, không hù dọa bệnh tật.',
    sang ? 'Độ dài 120–220 chữ. Mở đầu bằng 1 dòng tiêu đề VIẾT HOA có 1 emoji, bọc trong **…**. Sau đó lời chào buổi sáng ngắn, rồi 2–4 ý, mỗi ý bắt đầu bằng 1 emoji, ý chính in đậm bằng **…**. Kết bằng 1 câu hỏi nhẹ mời mọi người chia sẻ.'
      : 'Độ dài 40–90 chữ, không tiêu đề, 1–2 emoji, kết bằng câu hỏi / lời chúc để mọi người dễ trả lời.',
    'Đúng sự thật: thông tin về sản phẩm, thành phần, giá, ưu đãi CHỈ lấy từ TÀI LIỆU. Kiến thức chung chỉ nói điều phổ thông, an toàn, không số liệu nghiên cứu, không trích dẫn chuyên gia, không bịa câu chuyện / cảm nhận khách hàng.',
    'Không dùng các từ "chữa", "điều trị", "khỏi bệnh", "đặc trị", "thay thuốc", "thần dược". Nếu bài nói về sản phẩm: thêm 1 dòng cuối nhỏ "Sản phẩm là thực phẩm, không phải là thuốc và không có tác dụng thay thế thuốc chữa bệnh."',
    'Nếu nhắc tới sản phẩm có trên web thì có thể để link sản phẩm ở cuối bài (1 link). Không để số điện thoại.',
    '',
    lib.length ? 'KHO ẢNH THẬT (số. mô tả ảnh) – nếu bài KHÔNG nói chủ yếu về 1 sản phẩm, chọn 1 ảnh khớp rõ với nội dung bài (đúng món / nguyên liệu / hoạt động); không có ảnh nào khớp thì ghi "không", đừng chọn ảnh chỉ gần giống:\n' + lib.map((i, n) => (n + 1) + '. ' + i.alt).join('\n') : '',
    '',
    'Trả về đúng định dạng:\nCHỦ ĐỀ: <tóm tắt chủ đề trong 10 chữ, nêu rõ nguyên liệu / món / sản phẩm>\n' + INS_HEAD + '\nSẢN PHẨM: <mã sản phẩm dạng chữ-thường-gạch-ngang nếu bài nói chủ yếu về 1 sản phẩm có ảnh, không thì ghi "không">\nẢNH: <số ảnh trong KHO ẢNH THẬT, hoặc "không">\n---\n<nội dung bài>'
  ].filter(s => s !== null).join('\n');
  const req = { model: WRITER, max_tokens: 4000, output_config: { effort: 'medium' },
    system: [{ type: 'text', text: 'Bạn viết bài cho nhóm Zalo cộng đồng của Thực Dưỡng Lành (VitaGreen Nutrition). Tiếng Việt chuẩn, tự nhiên.\n' + TRUTH_RULES },
      { type: 'text', text: 'TÀI LIỆU (thông tin chính thức của Thực Dưỡng Lành):\n\n' + know, cache_control: { type: 'ephemeral' } }],
    messages: [{ role: 'user', content: ask }] };
  let res; // bị bộ lọc an toàn từ chối nhầm → máy chủ Anthropic tự chuyển mô hình dự phòng (fallbacks); tham số này lỗi thì gọi lại không kèm
  try { res = await ai(x.env).beta.messages.create(Object.assign({ betas: ['server-side-fallback-2026-07-01'], fallbacks: 'default' }, req), { headers: { 'x-tdl-muc': 'zalo-bai' } }); }
  catch (e) { if (!(e instanceof Anthropic.BadRequestError)) throw e; res = await ai(x.env).messages.create(req, { headers: { 'x-tdl-muc': 'zalo-bai' } }); }
  if (res.stop_reason === 'refusal') throw new Error('AI từ chối viết bài');
  const raw = textOf(res), parts = raw.split(/\n-{3,}\n/);
  const head = parts.length > 1 ? parts[0] : '', body = insViet(safe((parts.length > 1 ? parts.slice(1).join('\n---\n') : raw).trim()));
  const topic = ((head.match(/CHỦ ĐỀ:\s*(.+)/) || [])[1] || body.split('\n')[0]).replace(/\*/g, '').trim().slice(0, 120);
  const code = ((head.match(/SẢN PHẨM:\s*([a-z0-9-]+)/) || [])[1] || '');
  const pick = lib[Number((head.match(/ẢNH:\s*(\d+)/) || [])[1]) - 1];
  const img = fb && fb.img ? fb.img : prods[code] && prods[code].img ? prods[code].img : pick ? pick.url : '';
  if (!body) throw new Error('AI chưa viết được bài');
  const id = day + '_' + slot, now = Date.now(), ins = Object.assign(insParse(head, ip.bank, ip.g), { w: insRisk(body), v: insStyle(body), b: ip.big ? ip.big.t : '' }); if (ip.angle) ins.a = ip.angle;
  // link web trong bài → gắn mã bài để CRM đếm đơn từ bài này (đơn ghi nguồn "zalo / nhom / <mã bài>")
  const tagged = tagLinks(body.replace(/(^|[\s(])_([^_\n]+)_(?=[\s).,!?]|$)/gm, '$1$2').replace(/(^|[\s(])\*([^*\n]+)\*(?=[\s).,!?]|$)/gm, '$1$2'), id);
  if (fb) { const all = (await kvJson(x.db, 'zb_fb', [])) || []; for (const f of all) if (f.id === fb.id) f.used = now; await kvSet(x.db, 'zb_fb', JSON.stringify(all)); }
  await run(x.db, `INSERT INTO zb_posts (id, day, slot, topic, text, img, prod, status, by_name, at, funnel, ev, ins, at_time, plan) VALUES (?, ?, ?, ?, ?, ?, ?, 'draft', ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(id) DO UPDATE SET topic = excluded.topic, text = excluded.text, img = excluded.img, prod = excluded.prod, status = 'draft', by_name = excluded.by_name, at = excluded.at, funnel = excluded.funnel, ev = excluded.ev, ins = excluded.ins, at_time = excluded.at_time, plan = excluded.plan`,
    id, day, slot, topic, tagged.slice(0, 4000), img, prods[code] ? code : '', by || 'AI', now, th.f, th.ev || '', JSON.stringify(ins), atT, pl ? pl.status : '');
  await insLog(x, 'zalo', { g: ins.g, gn: ins.gn, f: th.f, t: ins.t, ref: id, sp: prods[code] ? code : '', a: ins.a, b: ins.b });
  if (!slotAuto(cfg, slot) && !by) x.later(telegram(x.env, '📝 <b>Bài Zalo chờ duyệt</b> – ' + (SLOT_NAME[slot] || slot) + ' ' + WD[wd] + ' ' + day.slice(6, 8) + '/' + day.slice(4, 6) + ' lúc ' + at.replace(':', 'h') + (th.ev ? ' · 📅 ' + esc(th.ev) : '') + (pl ? (pl.status === 'ok' ? ' · 📋 theo chủ đề đã duyệt' : ' · ⚠️ chủ đề kế hoạch chưa duyệt') : '') + ': ' + esc(topic) + '\n👉 Duyệt / sửa: ' + CRM_URL + '/#tro-ly-zalo'));
  return { id, topic };
}

/* ---------------------------------------------------------------- CRM → tab 🤖 Trợ lý Zalo (Quản lý, Quản trị, Marketing) */
export async function crmZbot(x, u, d, crmLog) {
  if (u.level < 2 && u.role !== 'Marketing' && !u.zb) return { ok: false, error: 'Bạn chưa được giao phụ trách Trợ lý Zalo. Nhờ Quản trị tích ô 🤖 Trợ lý Zalo cho bạn ở Cài đặt → Nhân sự.' };
  const a = d.action, now = Date.now();
  if (a === 'zb_view') {
    const cfg = await zCfg(x), st = await kvJson(x.db, 'zb_status', null);
    const from = fmtDate(now - DAY, 'yyyyMMdd');
    const posts = await all(x.db, 'SELECT id, day, slot, topic, text, img, prod, status, by_name, at, sent_at, funnel, ev, ins, eng_msgs, eng_people, eng_reacts, at_time, plan FROM zb_posts WHERE day >= ? ORDER BY day, slot', from);
    const plan = await all(x.db, 'SELECT * FROM zb_plan WHERE day >= ? ORDER BY day, slot LIMIT 200', fmtDate(now, 'yyyyMMdd')); // 📋 kế hoạch chủ đề từ hôm nay
    // 30 ngày: bài đã đăng + tương tác + đơn từ link trong bài (nguồn đơn "zalo / nhom / <mã bài>")
    const since = now - 30 * DAY, done = await all(x.db, "SELECT id, funnel, eng_msgs, eng_people, eng_reacts FROM zb_posts WHERE status = 'sent' AND sent_at >= ?", since);
    const ords = await all(x.db, "SELECT source, first_source, total, status FROM orders WHERE time >= ? AND (source LIKE 'zalo / nhom / %' OR first_source LIKE 'zalo / nhom / %')", since);
    const byPost = {}; for (const o of ords) { if (isVoid(o.status)) continue; const m = String(o.source).match(/^zalo \/ nhom \/ (\S+)/) || String(o.first_source).match(/^zalo \/ nhom \/ (\S+)/); if (!m) continue; const b = byPost[m[1]] || (byPost[m[1]] = { n: 0, rev: 0 }); b.n++; b.rev += Number(o.total) || 0; }
    const funnel = {}; for (const p of done) { const k = p.funnel || 'Khác', f = funnel[k] || (funnel[k] = { posts: 0, people: 0, msgs: 0, reacts: 0, orders: 0, rev: 0 }); f.posts++; f.people += p.eng_people || 0; f.msgs += p.eng_msgs || 0; f.reacts += p.eng_reacts || 0; if (byPost[p.id]) { f.orders += byPost[p.id].n; f.rev += byPost[p.id].rev; } }
    for (const p of posts) if (byPost[p.id]) { p.orders = byPost[p.id].n; p.rev = byPost[p.id].rev; }
    const log = await all(x.db, 'SELECT rid, at, kind, gid, uid, name, text, reply, done_at, done_by FROM zb_log ORDER BY rid DESC LIMIT 80');
    const open = await all(x.db, "SELECT rid, at, kind, gid, uid, name, text, reply, done_at, done_by FROM zb_log WHERE kind IN ('handoff', 'dm_handoff') AND done_at IS NULL AND at > ? ORDER BY rid DESC LIMIT 30", now - 7 * DAY); // ca cần người thật chưa xử lý: ghim lên đầu
    const lib = (await imgLib()).map(i => ({ url: i.url, thumb: i.thumb || i.url, alt: i.alt }));
    const stats = await all(x.db, 'SELECT kind, count(*) AS n FROM zb_log WHERE at > ? GROUP BY kind', now - 7 * DAY);
    const users = await first(x.db, "SELECT count(*) AS n, sum(CASE WHEN phone != '' THEN 1 ELSE 0 END) AS known, sum(CASE WHEN joined > ? AND phone != '' THEN 1 ELSE 0 END) AS joined7, sum(CASE WHEN joined > ? THEN 1 ELSE 0 END) AS in30, sum(CASE WHEN joined > ? AND friend IS NOT NULL THEN 1 ELSE 0 END) AS fr30, sum(CASE WHEN friend > ? THEN 1 ELSE 0 END) AS fr7 FROM zb_users", now - 7 * DAY, now - 30 * DAY, now - 30 * DAY, now - 7 * DAY);
    // 🕐 giờ nhóm hoạt động 14 ngày + 🧪 kết quả thử giờ đăng bài sáng (theo giờ đăng thật)
    const act = await all(x.db, "SELECT substr(dh, 9, 2) AS h, sum(msgs) AS msgs, sum(people) AS people, count(*) AS n FROM zb_act WHERE dh >= ? GROUP BY h", fmtDate(now - 14 * DAY, 'yyyyMMddHH'));
    const actDays = (await first(x.db, 'SELECT count(DISTINCT substr(dh, 1, 8)) AS n FROM zb_act WHERE dh >= ?', fmtDate(now - 14 * DAY, 'yyyyMMddHH'))).n || 0;
    const morn = await all(x.db, "SELECT sent_at, eng_people, eng_msgs, eng_reacts FROM zb_posts WHERE slot = 'sang' AND status = 'sent' AND sent_at >= ? AND COALESCE(ev, '') = '' AND COALESCE(at_time, '') = ''", TRACK_FROM); // bài ngày lễ (chủ đề khác ngày thường) và bài nhân sự đặt giờ riêng không tính vào thử giờ
    const trialRes = {}; for (const p of morn) { const k = fmtDate(p.sent_at, 'HH'), r = trialRes[k] || (trialRes[k] = { posts: 0, people: 0, msgs: 0, reacts: 0 }); r.posts++; r.people += p.eng_people || 0; r.msgs += p.eng_msgs || 0; r.reacts += p.eng_reacts || 0; }
    const prods = Object.entries(prodMap(await kb())).map(([c, p]) => ({ c, n: p.name }));
    // 📣 tin nhân sự gửi (11/11/2026): hẹn giờ (huỷ được) / đã đăng (thu hồi được nếu trợ lý đã lưu mã tin)
    const man = posts.filter(p => p.slot === 'tay'), mo = man.length ? await all(x.db, "SELECT ref, kind, status, due, msgs, undone FROM zb_out WHERE ref IN (SELECT value FROM json_each(?))", JSON.stringify(man.map(p => p.id))) : [];
    const manual = man.map(p => { const r = mo.filter(o => o.ref === p.id), po = r.filter(o => o.kind === 'post'), wait = po.filter(o => o.status === 'new');
      return { id: p.id, text: p.text, img: p.img, by: p.by_name, at: p.at, status: p.status, sent_at: p.sent_at, funnel: p.funnel, due: wait.length ? Math.min(...wait.map(o => o.due)) : 0, wait: wait.length, err: po.some(o => o.status === 'err'),
        can: po.some(o => o.status === 'done' && o.msgs && !o.undone), undone: po.length > 0 && po.every(o => o.undone), undoing: r.some(o => o.kind === 'undo' && (o.status === 'new' || o.status === 'sent')) }; }).sort((a, b) => (b.due || b.sent_at || b.at) - (a.due || a.sent_at || a.at));
    return { ok: true, manual, recallOk: !!(st && String(st.ver || '') >= RECALL_VER), cfg, status: st, posts, plan, prods, mix: Object.fromEntries(Object.entries(MIX).map(([k, v]) => [k, v.name])), log, open, lib, funnel, act, actDays, trial: TIME_TRIAL, trialRes, days: upcoming(fmtDate(now, 'yyyyMMdd'), 45, baseTheme), stats, users, err: await kvGet(x.db, 'zb_write_err'), planErr: await kvGet(x.db, 'zb_plan_err'), key: !!x.env.ZBOT_KEY, aiOn: !!x.env.ANTHROPIC_API_KEY, now,
      insG: (await insBank(x)).map(g => ({ id: g.id, name: g.name, on: g.on, tn: g.tensions.slice(0, 30) })) };
  }
  if (a === 'zb_cfg') {
    const cfg = await zCfg(x), c = d.cfg || {};
    for (const k of ['on', 'welcome', 'answer', 'announce', 'approve', 'approveAll']) if (c[k] !== undefined) cfg[k] = !!c[k];
    if (c.mode === 'auto' || c.mode === 'approve') cfg.mode = c.mode;
    if (Array.isArray(c.groups)) cfg.groups = c.groups.map(String).slice(0, 10);
    if (c.maxHour !== undefined) cfg.maxHour = Math.max(1, Math.min(30, Number(c.maxHour) || 8));
    if (c.lead !== undefined) cfg.lead = Math.max(1, Math.min(3, Number(c.lead) || 3)); // soạn trước 1–3 ngày
    if (c.planAuto !== undefined) cfg.planAuto = !!c.planAuto;
    if (Array.isArray(c.slots)) for (const n of c.slots) if (n.at && !okTime(n.id, n.at)) return { ok: false, error: 'Giờ ' + (n.id === 'toi' ? 'bài tối' : 'bài sáng') + ' chưa hợp lệ. ' + (TIME_RULE[n.id] || '') };
    if (Array.isArray(c.slots)) cfg.slots = cfg.slots.map(s => { const n = c.slots.find(z => z.id === s.id) || {}; return { id: s.id, at: okTime(s.id, n.at) || s.at, on: n.on === undefined ? s.on : !!n.on, mode: n.mode === 'auto' || n.mode === 'approve' ? n.mode : s.mode || cfg.mode }; });
    await kvSet(x.db, 'zb_cfg', JSON.stringify(cfg));
    await crmLog(x, u, 'Cài đặt trợ lý Zalo', '', '', '', JSON.stringify(c).slice(0, 300));
    return { ok: true, cfg };
  }
  if (a === 'zb_post') { // sửa / duyệt / bỏ / đăng lại
    const p = await first(x.db, 'SELECT * FROM zb_posts WHERE id = ?', String(d.id || '')); if (!p) return { ok: false, error: 'Không tìm thấy bài.' };
    if (p.status === 'sent' && d.status !== 'draft') return { ok: false, error: 'Bài này đã đăng rồi.' };
    const st = ['draft', 'ok', 'skip'].includes(d.status) ? d.status : p.status;
    const text = d.text === undefined ? p.text : tagLinks(String(d.text).slice(0, 4000), p.id); // link web tự gắn mã theo dõi của bài này
    const topic = String(d.topic === undefined ? '' : d.topic).trim().slice(0, 120) || p.topic; // 11/11/2026: sửa nhãn chủ đề + tầng phễu khi nhân sự viết lại hẳn bài
    const funnel = ['TOFU', 'MOFU', 'BOFU', 'TIN'].includes(d.funnel) ? d.funnel : p.funnel;
    let ins = p.ins || ''; // 11/11/2026: sửa nhóm khách + tension; đổi nhóm / tension thì bỏ insight, idea, issue cũ (không còn khớp)
    if (d.ins_g !== undefined || d.ins_t !== undefined) {
      let o = {}; try { o = JSON.parse(p.ins || '{}') || {}; } catch (e) { o = {}; }
      const gid = d.ins_g === undefined ? (o.g || '') : String(d.ins_g).slice(0, 60), tt = d.ins_t === undefined ? (o.t || '') : String(d.ins_t).trim().replace(/<->|<=>|->/g, '↔').slice(0, 300);
      if (gid !== (o.g || '') || tt !== (o.t || '')) {
        const g = gid ? (await insBank(x)).find(b => b.id === gid) : null;
        o = Object.assign(o, { g: gid, gn: g ? g.name : gid ? (o.g === gid ? o.gn : gid) : '', t: tt }); delete o.i; delete o.d; delete o.is; delete o.w;
        ins = o.gn || o.t ? JSON.stringify(o) : '';
      }
    }
    await run(x.db, 'UPDATE zb_posts SET text = ?, topic = ?, funnel = ?, ins = ?, status = ?, by_name = ?, at = ? WHERE id = ?', text, topic, funnel, ins, st, u.name, now, p.id);
    await crmLog(x, u, 'Bài Zalo', p.id, '', ({ ok: 'Duyệt', skip: 'Bỏ', draft: 'Sửa' }[st] || st) + (funnel !== p.funnel ? ' · phễu ' + (p.funnel || '–') + ' → ' + funnel : ''), topic);
    return { ok: true, warn: d.text !== undefined && d.text !== p.text ? await quizWarn(x, p) : '' };
  }
  if (a === 'zb_img') { // đổi ảnh bài: link trong kho / ảnh tải từ máy (data:image…) / '' = bỏ ảnh
    const p = await first(x.db, 'SELECT id, status, topic FROM zb_posts WHERE id = ?', String(d.id || '')); if (!p) return { ok: false, error: 'Không tìm thấy bài.' };
    if (p.status === 'sent') return { ok: false, error: 'Bài này đã đăng rồi.' };
    const im = await zImgSave(x, d.img, now); if (im.error) return { ok: false, error: im.error }; const img = im.img;
    await run(x.db, 'UPDATE zb_posts SET img = ?, by_name = ?, at = ? WHERE id = ?', img, u.name, now, p.id);
    await crmLog(x, u, 'Bài Zalo', p.id, '', img ? 'Đổi ảnh' : 'Bỏ ảnh', p.topic);
    return { ok: true, img };
  }
  if (a === 'zb_logmore') { // 🕘 xem thêm nhật ký cũ hơn
    const rows = await all(x.db, 'SELECT rid, at, kind, gid, uid, name, text, reply, done_at, done_by FROM zb_log WHERE rid < ? ORDER BY rid DESC LIMIT 100', Number(d.before) || 0);
    return { ok: true, log: rows };
  }
  if (a === 'zb_done') { // ✅ đánh dấu ca cần người thật đã xử lý (bỏ đánh dấu: undo)
    const r = await first(x.db, 'SELECT rid, kind, name FROM zb_log WHERE rid = ?', Number(d.rid) || 0); if (!r) return { ok: false, error: 'Không tìm thấy.' };
    await run(x.db, 'UPDATE zb_log SET done_at = ?, done_by = ? WHERE rid = ?', d.undo ? null : now, d.undo ? '' : u.name, r.rid);
    await crmLog(x, u, 'Trợ lý Zalo', String(r.rid), '', d.undo ? 'Bỏ đánh dấu đã xử lý' : 'Đã xử lý ca cần người thật', r.name || '');
    return { ok: true, done_at: d.undo ? null : now, done_by: d.undo ? '' : u.name };
  }
  if (a === 'zb_hist') { // 📚 bài đã đăng & hiệu quả (90 ngày)
    const since = now - 90 * DAY;
    const rows = await all(x.db, "SELECT id, day, slot, topic, text, img, funnel, ev, ins, by_name, sent_at, eng_msgs, eng_people, eng_reacts FROM zb_posts WHERE status = 'sent' AND sent_at >= ? ORDER BY sent_at DESC", since);
    const ords = await all(x.db, "SELECT source, first_source, total, status FROM orders WHERE time >= ? AND (source LIKE 'zalo / nhom / %' OR first_source LIKE 'zalo / nhom / %')", since);
    const byPost = {}; for (const o of ords) { if (isVoid(o.status)) continue; const m = String(o.source).match(/^zalo \/ nhom \/ (\S+)/) || String(o.first_source).match(/^zalo \/ nhom \/ (\S+)/); if (!m) continue; const b = byPost[m[1]] || (byPost[m[1]] = { n: 0, rev: 0 }); b.n++; b.rev += Number(o.total) || 0; }
    return { ok: true, track: TRACK_FROM, posts: rows.map(p => Object.assign(p, { tracked: p.sent_at >= TRACK_FROM, orders: (byPost[p.id] || {}).n || 0, rev: (byPost[p.id] || {}).rev || 0 })) };
  }
  if (a === 'zb_regen') {
    const p = await first(x.db, 'SELECT day, slot, status FROM zb_posts WHERE id = ?', String(d.id || ''));
    const day = p ? p.day : String(d.day || ''), slot = p ? p.slot : String(d.slot || '');
    if (!/^\d{8}$/.test(day) || !/^[a-z]+$/.test(slot)) return { ok: false, error: 'Thiếu ngày / buổi.' };
    if (p && p.status === 'sent') return { ok: false, error: 'Bài này đã đăng rồi.' };
    if (!x.env.ANTHROPIC_API_KEY) return { ok: false, error: 'Máy chủ chưa có khoá AI.' };
    const dk = 'zb_regen_' + fmtDate(now, 'yyMMdd'), n = Number(await kvGet(x.db, dk) || 0);
    if (n >= 30) return { ok: false, error: 'Hôm nay đã viết lại 30 lần, mai thử tiếp nhé.' };
    await kvSet(x.db, dk, String(n + 1), 2 * DAY);
    try { const r = await zWrite(x, day, slot, String(d.hint || '').slice(0, 300), u.name, String(d.grp || '').slice(0, 80)); return { ok: true, id: r.id, warn: await quizWarn(x, { day, slot }) }; }
    catch (e) { return { ok: false, error: 'AI chưa viết được: ' + e.message }; }
  }
  if (a === 'zb_send') { // nhân sự tự viết, trợ lý đăng vào nhóm (ngay / hẹn giờ)
    const text = String(d.text || '').trim().slice(0, 4000), cfg = await zCfg(x);
    if (text.length < 5) return { ok: false, error: 'Nội dung quá ngắn.' };
    const at = d.at ? new Date(String(d.at) + ':00+07:00').getTime() : now;
    if (isNaN(at)) return { ok: false, error: 'Giờ hẹn chưa đúng.' };
    const gs = (Array.isArray(d.groups) && d.groups.length ? d.groups.map(String) : cfg.groups).filter(g => cfg.groups.includes(g));
    if (!gs.length) return { ok: false, error: 'Chưa chọn nhóm cho trợ lý.' };
    const im = await zImgSave(x, d.img, now); if (im.error) return { ok: false, error: im.error }; // 🖼 ảnh kèm tin (11/11/2026): kho ảnh web / tải từ máy / không ảnh
    const id = 'm' + now.toString(36) + Math.random().toString(36).slice(2, 5), kind = ['TOFU', 'MOFU', 'BOFU', 'TIN'].includes(d.kind) ? d.kind : 'TIN';
    await run(x.db, "INSERT INTO zb_posts (id, day, slot, topic, text, status, by_name, at, funnel, img) VALUES (?, ?, 'tay', ?, ?, 'ok', ?, ?, ?, ?)", id, fmtDate(Math.max(at, now), 'yyyyMMdd'), text.replace(/\*/g, '').split('\n').find(l => l.trim()).trim().slice(0, 100), tagLinks(safe(text), id), u.name, now, kind, im.img); // tin nhân sự gửi: lưu để đo như bài AI
    for (const gid of gs) await run(x.db, "INSERT INTO zb_out (kind, gid, text, img, due, at, ref) VALUES ('post', ?, ?, ?, ?, ?, ?)", gid, tagLinks(safe(text), id), im.img, Math.max(at, now), now, id);
    await crmLog(x, u, 'Gửi tin vào nhóm Zalo', '', '', (at > now + 60e3 ? 'Hẹn ' + fmtDate(at, 'HH:mm dd/MM') : 'Gửi ngay') + (im.img ? ' · có ảnh' : ''), text.slice(0, 200));
    return { ok: true };
  }
  if (a === 'zb_cancel') { // 🗑 huỷ tin nhân sự gửi đang hẹn giờ (chưa tới giờ đăng)
    const p = await first(x.db, 'SELECT id, topic, status FROM zb_posts WHERE id = ?', String(d.id || '')); if (!p) return { ok: false, error: 'Không tìm thấy tin.' };
    if (p.status === 'skip') return { ok: true, already: 1 };
    const r = await run(x.db, "UPDATE zb_out SET status = 'cancel' WHERE ref = ? AND kind = 'post' AND status = 'new'", p.id);
    if (!(r && r.meta && r.meta.changes)) return { ok: false, error: 'Tin này trợ lý đã đăng (hoặc đang đăng) rồi, không huỷ được. Dùng ↩️ Thu hồi.' };
    await run(x.db, "UPDATE zb_posts SET status = 'skip', by_name = ?, at = ? WHERE id = ?", u.name, now, p.id);
    await crmLog(x, u, 'Bài Zalo', p.id, '', 'Huỷ tin hẹn giờ', p.topic);
    return { ok: true };
  }
  if (a === 'zb_recall') { // ↩️ thu hồi tin đã đăng trong nhóm (trợ lý dùng mã tin đã lưu lúc đăng)
    const p = await first(x.db, 'SELECT id, topic FROM zb_posts WHERE id = ?', String(d.id || '')); if (!p) return { ok: false, error: 'Không tìm thấy tin.' };
    const st = await kvJson(x.db, 'zb_status', null);
    if (!st || String(st.ver || '') < RECALL_VER) return { ok: false, error: 'Trợ lý trên máy đang chạy bản cũ nên chưa thu hồi được. Cập nhật trợ lý trên máy (xem hướng dẫn) rồi thử lại. Tin này anh/chị có thể thu hồi tay trên Zalo.' };
    if (await first(x.db, "SELECT id FROM zb_out WHERE ref = ? AND kind = 'undo' AND status IN ('new', 'sent')", p.id)) return { ok: true, already: 1 };
    const rows = await all(x.db, "SELECT gid, msgs FROM zb_out WHERE ref = ? AND kind = 'post' AND status = 'done' AND COALESCE(undone, 0) = 0", p.id), ok = rows.filter(r => r.msgs && r.msgs !== '[]');
    if (!ok.length) return { ok: false, error: rows.length ? 'Tin này đăng lúc trợ lý chưa lưu mã tin (trước bản cập nhật thu hồi) nên không thu hồi tự động được. Anh/chị thu hồi tay trên Zalo nhé.' : 'Tin này chưa đăng hoặc đã thu hồi rồi.' };
    for (const r of ok) await run(x.db, "INSERT INTO zb_out (kind, gid, text, due, at, ref) VALUES ('undo', ?, ?, ?, ?, ?)", r.gid, r.msgs, now, now, p.id);
    await crmLog(x, u, 'Bài Zalo', p.id, '', 'Thu hồi tin đã đăng', p.topic);
    return { ok: true };
  }
  if (a === 'zb_time') { // ⏰ giờ đăng riêng cho 1 bài (sáng / tối); at trống = về giờ của khung
    const r = await setTime(x, String(d.id || ''), String(d.at || '').trim());
    if (r.ok) await crmLog(x, u, 'Bài Zalo', String(d.id), '', r.at ? 'Hẹn giờ đăng ' + r.at : 'Về giờ mặc định', '');
    return r;
  }
  if (a === 'zb_plan_make') { // 📋 lập kế hoạch chủ đề: tối đa 7 ngày / lần (CRM gọi lần lượt cho 14 ngày / cả tháng)
    const from = String(d.from || ''); if (!/^\d{8}$/.test(from) || from < fmtDate(now, 'yyyyMMdd') || from > fmtDate(now + 90 * DAY, 'yyyyMMdd')) return { ok: false, error: 'Ngày bắt đầu chưa đúng.' };
    if (!x.env.ANTHROPIC_API_KEY) return { ok: false, error: 'Máy chủ chưa có khoá AI.' };
    const dk = 'zb_plan_n_' + fmtDate(now, 'yyMMdd'), cnt = Number(await kvGet(x.db, dk) || 0);
    if (cnt >= 25) return { ok: false, error: 'Hôm nay đã lập kế hoạch 25 lần, mai thử tiếp nhé.' };
    await kvSet(x.db, dk, String(cnt + 1), 2 * DAY);
    const mix = MIX[d.mix] ? d.mix : 'frame', focus = cutS(d.focus, 500), n = Math.max(1, Math.min(7, Number(d.n) || 7));
    if (d.save) { const cfg = await zCfg(x); cfg.pmix = { mix, focus, to: String(d.save).match(/^\d{8}$/) ? String(d.save) : addDay(from, n - 1) }; await kvSet(x.db, 'zb_cfg', JSON.stringify(cfg)); } // tự lập tuần sau dùng tiếp trọng tâm / tỉ lệ này tới hết kỳ
    try {
      const r = await zPlanMake(x, from, n, { mix, focus, by: u.name, hint: cutS(d.hint, 300) });
      await crmLog(x, u, 'Kế hoạch chủ đề Zalo', from, '', 'Lập ' + r.n + ' chủ đề từ ' + dm(from), MIX[mix].name + (focus ? ' · ' + focus : ''));
      await kvSet(x.db, 'zb_plan_err', '');
      return { ok: true, n: r.n };
    } catch (e) { return { ok: false, error: 'AI chưa lập được: ' + e.message }; }
  }
  if (a === 'zb_plan_redo') { // 🔄 đổi 1 chủ đề (AI gợi ý chủ đề khác cho đúng bài đó)
    const pl = await first(x.db, 'SELECT * FROM zb_plan WHERE id = ?', String(d.id || '')); if (!pl) return { ok: false, error: 'Không tìm thấy chủ đề.' };
    if (!x.env.ANTHROPIC_API_KEY) return { ok: false, error: 'Máy chủ chưa có khoá AI.' };
    const dk = 'zb_plan_n_' + fmtDate(now, 'yyMMdd'), cnt = Number(await kvGet(x.db, dk) || 0);
    if (cnt >= 25) return { ok: false, error: 'Hôm nay đã lập kế hoạch 25 lần, mai thử tiếp nhé.' };
    await kvSet(x.db, dk, String(cnt + 1), 2 * DAY);
    try {
      const pm = (await zCfg(x)).pmix || {}, use = pm.to && pm.to >= pl.day;
      const r = await zPlanMake(x, pl.day, 1, { mix: use ? pm.mix : 'frame', focus: use ? pm.focus : '', by: u.name, only: [pl.id], hint: cutS(d.hint, 300) });
      if (!r.n) return { ok: false, error: 'Bài này đã chốt (đã đăng / đã duyệt bài / sắp tới giờ) nên không đổi chủ đề được.' };
      await crmLog(x, u, 'Kế hoạch chủ đề Zalo', pl.id, '', 'Đổi chủ đề', r.items[0].topic);
      return { ok: true };
    } catch (e) { return { ok: false, error: 'AI chưa viết được: ' + e.message }; }
  }
  if (a === 'zb_plan_set') { // ✅ duyệt / ✏️ sửa / ⏸ bỏ chủ đề (1 bài, hoặc ids = duyệt cả tuần)
    const ids = (Array.isArray(d.ids) ? d.ids : [d.id]).map(String).filter(Boolean).slice(0, 62);
    const st = ['draft', 'ok', 'skip'].includes(d.status) ? d.status : '';
    const bank = await insBank(x), prods = d.sp !== undefined ? prodMap(await kb()) : {};
    let n = 0, redo = 0, kept = 0;
    for (const id of ids) {
      const pl = await first(x.db, 'SELECT * FROM zb_plan WHERE id = ?', id); if (!pl) continue;
      const v = Object.assign({}, pl);
      if (ids.length === 1) { // sửa nội dung chủ đề (chỉ khi sửa từng bài)
        for (const [k, nmax] of [['topic', 200], ['idea', 300], ['cta', 120], ['tn', 300]]) if (d[k] !== undefined) v[k] = cutS(d[k], nmax);
        if (d.f !== undefined && FUNNEL[d.f]) v.f = d.f;
        if (d.g !== undefined) { const g = bank.find(z => z.id === String(d.g)); v.g = g ? g.id : ''; v.gn = g ? g.name : ''; }
        if (d.sp !== undefined) v.sp = prods[String(d.sp)] ? String(d.sp) : '';
        if (!v.topic) return { ok: false, error: 'Chủ đề không được để trống.' };
      }
      if (st) v.status = st;
      if (st === 'ok' && st === pl.status && ids.length > 1) continue; // duyệt cả tuần: bỏ qua bài đã duyệt
      const changed = ['topic', 'idea', 'cta', 'tn', 'f', 'g', 'sp'].some(k => v[k] !== pl[k]);
      await run(x.db, 'UPDATE zb_plan SET topic = ?, idea = ?, cta = ?, tn = ?, f = ?, g = ?, gn = ?, sp = ?, status = ?, by_name = ?, at = ?, ok_by = ?, ok_at = ? WHERE id = ?',
        v.topic, v.idea, v.cta, v.tn, v.f, v.g, v.gn, v.sp, v.status, changed ? u.name : pl.by_name, changed ? now : pl.at, v.status === 'ok' ? (pl.status === 'ok' && !changed ? pl.ok_by : u.name) : '', v.status === 'ok' ? (pl.status === 'ok' && !changed ? pl.ok_at : now) : null, id);
      n++;
      if (v.status === 'ok' && (pl.status !== 'ok' || changed)) { const r = await planReset(x, id); if (r === 'redo') redo++; else if (r === 'kept') kept++; } // bài AI soạn trước theo chủ đề cũ → soạn lại
      if (v.status === 'skip') await run(x.db, "UPDATE zb_posts SET status = 'skip' WHERE id = ? AND status IN ('draft', 'ok')", id); // không đăng bài này
      if (pl.status === 'skip' && v.status !== 'skip') await run(x.db, "UPDATE zb_posts SET status = 'draft' WHERE id = ? AND status = 'skip'", id);
    }
    if (d.at !== undefined && ids.length === 1) { const r = await setTime(x, ids[0], String(d.at || '').trim()); if (!r.ok) return Object.assign(r, { n }); }
    await crmLog(x, u, 'Kế hoạch chủ đề Zalo', ids.length === 1 ? ids[0] : ids.length + ' bài', '', { ok: 'Duyệt chủ đề', skip: 'Không đăng bài này', draft: 'Bỏ duyệt chủ đề' }[st] || 'Sửa chủ đề', '');
    return { ok: true, n, redo, kept };
  }
  return { ok: false, error: 'Không rõ thao tác: ' + a };
}

/** Sửa / viết lại bài tối có câu đố → nhắc bài sáng hôm sau (công bố đáp án, đã soạn sẵn vì soạn trước 2–3 ngày) cần viết lại cho khớp */
async function quizWarn(x, p) {
  if (!p || p.slot !== 'toi') return '';
  const nx = addDay(p.day, 1); if (!dayTheme(nx, 'sang', baseTheme, false).quiz) return '';
  const m = await first(x.db, "SELECT status FROM zb_posts WHERE id = ? AND status IN ('draft', 'ok')", nx + '_sang');
  return m ? 'Bài sáng ' + WD[weekday(nx)] + ' ' + dm(nx) + ' công bố đáp án câu đố của bài này và đã được soạn trước: nhớ bấm 🔄 Viết lại bài sáng đó cho khớp câu đố mới.' : '';
}

/** Ảnh kèm bài / tin: link trong kho ảnh web (SITE/…), ảnh đã tải (API_URL/zb-img/…) hoặc data:image… mới tải từ máy (lưu zb_imgs). '' = không ảnh. */
async function zImgSave(x, v, now) {
  let img = String(v || '');
  if (img.startsWith('data:image/')) {
    if (img.length > 1.5e6) return { error: 'Ảnh lớn quá, bạn chọn ảnh khác giúp nhé.' };
    const iid = 'u' + now.toString(36) + Math.random().toString(36).slice(2, 6);
    await run(x.db, 'INSERT INTO zb_imgs (id, data, at) VALUES (?, ?, ?)', iid, img, now);
    img = API_URL + '/zb-img/' + iid;
  } else if (img && !img.startsWith(SITE + '/') && !img.startsWith(API_URL + '/zb-img/')) return { error: 'Ảnh không hợp lệ.' };
  return { img };
}

/** GET api.thucduonglanh.vn/zb-img/<id>: ảnh nhân sự tải lên cho bài đăng (chương trình Zalo tải về để đăng, CRM xem trước) */
export async function zbImg(x, id) {
  const r = await first(x.db, 'SELECT data FROM zb_imgs WHERE id = ?', String(id).replace(/[^a-z0-9]/g, '').slice(0, 30));
  const m = r && String(r.data).match(/^data:(image\/[a-z+]+);base64,(.+)$/);
  if (!m) return new Response('Không có ảnh', { status: 404 });
  const bin = atob(m[2]), buf = new Uint8Array(bin.length); for (let i = 0; i < bin.length; i++) buf[i] = bin.charCodeAt(i);
  return new Response(buf, { headers: { 'Content-Type': m[1], 'Cache-Control': 'public, max-age=31536000, immutable', 'Access-Control-Allow-Origin': '*' } });
}
