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
 * Bài đăng hằng ngày: cron (zbotTick) soạn trước bằng AI theo lịch chủ đề trong tuần, lưu bảng zb_posts → nhân sự xem / sửa / bỏ ở CRM → tab 🤖 Trợ lý Zalo.
 *   Chế độ 'auto': tới giờ tự đăng (trừ bài đã bấm Bỏ). Chế độ 'approve': chỉ đăng bài đã bấm Duyệt.
 * Báo đăng ký (như nhóm Sống Khỏe 365): khách để số trên web mà đang ở trong nhóm → trợ lý chúc mừng @tên trong nhóm (chỉ tên Zalo + quà đã nhận, không số điện thoại, không bệnh).
 * Tự duyệt người xin vào nhóm: chỉ người đã để số qua web (tìm được tài khoản Zalo theo số) – người lạ báo Telegram để nhân sự duyệt tay (cổng nhóm 17/10/2026).
 * Chi phí AI: trả lời, chào dùng claude-haiku-5-5 (vài chục đồng/lần); bài đăng dùng claude-opus-5-5 (~2.500đ/bài, 2 bài/ngày ≈ 150k/tháng). */
import Anthropic from '@anthropic-ai/sdk';
import { aiFetch } from './airelay.js';
import { esc, run, all, first, kvGet, kvSet, kvJson, normPhone, fmtDate, isVoid, CRM_URL, TZ_MS, DAY } from './lib.js';
import { telegram } from './google.js';
import { addLead } from './crm.js';
import { kb, safe, workNow, TRUTH_RULES, REF_RULES, REF_TXT, PHONE_RE } from './chat.js';
import { botRef } from './partner.js';
import { offersLive } from './salemkt.js';

const BOT = 'An Lành';
const FAST = 'claude-haiku-5-5', WRITER = 'claude-opus-5-5';
const SITE = 'https://thucduonglanh.vn', API_URL = 'https://api.thucduonglanh.vn';
const CFG0 = {
  on: true, groups: [], // nhóm trợ lý chăm sóc (mã nhóm Zalo). Trống → lần đầu tự chọn nhóm có tên "Thực Dưỡng Lành"
  welcome: true, answer: true, announce: true, approve: true, approveAll: false,
  mode: 'approve', // approve: chỉ đăng bài đã duyệt (anh Sơn chọn 27/10/2026) · auto: tới giờ tự đăng bài nháp
  slots: [{ id: 'sang', at: '07:30', on: true }, { id: 'toi', at: '20:00', on: true }],
  maxHour: 8 // số câu trả lời tối đa / nhóm / giờ (tránh "nói nhiều", Zalo khoá)
};
const SLOT_NAME = { sang: 'Bài sáng', toi: 'Bài tối' };
// Lịch chủ đề trong tuần (0 = Chủ nhật). Sửa ở đây là bài soạn sau sẽ theo.
/** Lịch chủ đề theo phễu nội dung (31/10/2026, anh Sơn duyệt): người trong nhóm đã để số nhận quà → nhóm chủ yếu giữ chân + tạo niềm tin, bán vừa phải.
 * TOFU 🔵 tương tác, giá trị (8 bài/tuần) · MOFU ⚪ tạo niềm tin (4 bài) · BOFU 🟠 chuyển đổi (2 bài). Chỉ số = thứ trong tuần (0 = Chủ nhật). */
const THEME = {
  sang: [
    { f: 'TOFU', t: 'Tâm an cuối tuần: lời chúc nhẹ nhàng + 1 suy ngẫm ngắn về sống chậm, biết ơn, gia đình (không bịa chuyện khách hàng)' },
    { f: 'MOFU', t: 'Kiến thức dinh dưỡng nền tảng: 1 điều dễ hiểu, áp dụng được ngay trong bữa ăn gia đình' },
    { f: 'MOFU', t: 'Ly sáng có gì: giới thiệu 1–3 nguyên liệu có trong 1 sản phẩm (đúng thành phần trong tài liệu), vị, cách người Việt quen dùng' },
    { f: 'TOFU', t: 'Bếp lành: 1 món ăn / thức uống lành, dễ làm, nguyên liệu dễ mua (có thể là món chay)' },
    { f: 'MOFU', t: 'Mở đầu bằng ĐÁP ÁN câu đố tối qua (giải thích ngắn, cảm ơn mọi người đã trả lời), rồi hỏi đáp: chọn 1 câu khách hay hỏi trong phần hỏi đáp của 1 sản phẩm và trả lời rõ ràng, gần gũi', quiz: 1 },
    { f: 'TOFU', t: 'Thói quen sống lành: ngủ, vận động nhẹ, uống nước, thở, ăn chậm… 1 việc nhỏ làm được hôm nay' },
    { f: 'BOFU', t: 'Góc sản phẩm cuối tuần: giới thiệu nhẹ nhàng 1 sản phẩm (ai hợp, cách dùng, quy cách, giá đúng tài liệu) + ưu đãi đang chạy nếu có; nhắc đặt trên web được kiểm hàng trước khi nhận, freeship đơn từ 300k; để 1 link sản phẩm', link: 1 }],
  toi: [
    { f: 'TOFU', t: 'Chúc cả nhà tuần mới bình an + 1 câu hỏi nhỏ để mọi người chia sẻ' },
    { f: 'TOFU', t: 'Câu hỏi tương tác: hỏi thói quen ăn uống / sinh hoạt của mọi người, dễ trả lời 1 dòng' },
    { f: 'TOFU', t: 'Mẹo nhỏ buổi tối: 1 mẹo để ngủ ngon / thư giãn / chuẩn bị bữa sáng mai' },
    { f: 'TOFU', t: 'Mini đố vui về dinh dưỡng (1 câu, 3 lựa chọn A/B/C, đáp án là kiến thức phổ thông chắc chắn đúng), mời mọi người trả lời bằng 1 chữ cái, hẹn sáng mai công bố đáp án' },
    { f: 'MOFU', t: 'Câu chuyện khách hàng thật: dựa ĐÚNG vào CẢM NHẬN KHÁCH HÀNG được cung cấp bên dưới (không thêm thắt, không nói về bệnh / công dụng chữa trị), kể ngắn gọn ấm áp, cảm ơn khách đã chia sẻ, mời mọi người kể trải nghiệm của mình', fb: 1 },
    { f: 'BOFU', t: 'Nhắc nhẹ cuối tuần: ưu đãi đang chạy (nếu có) hoặc hướng dẫn đặt hàng trên web 3 bước (được kiểm hàng trước khi nhận, freeship từ 300k), không thúc ép; để 1 link sản phẩm hợp nhất', link: 1 },
    { f: 'TOFU', t: 'Cuối tuần: mời mọi người khoe mâm cơm / bữa ăn lành của nhà mình, hoặc rủ cả nhà cùng nấu 1 món lành' }]
};
const FUNNEL = { TOFU: '🔵 Nhận biết – tương tác', MOFU: '⚪ Cân nhắc – tạo niềm tin', BOFU: '🟠 Chuyển đổi – bán hàng' };

let client = null;
function ai(env) { if (!client) client = new Anthropic({ apiKey: env.ANTHROPIC_API_KEY, maxRetries: 2, timeout: 60e3, fetch: aiFetch(env) }); return client; } // qua trạm Bắc Mỹ (airelay.js)
const textOf = res => res.content.filter(b => b.type === 'text').map(b => b.text).join('\n').trim();

export async function zbotSchema(db) {
  await run(db, `CREATE TABLE IF NOT EXISTS zb_users (uid TEXT PRIMARY KEY, phone TEXT DEFAULT '', name TEXT DEFAULT '', zname TEXT DEFAULT '', lead TEXT DEFAULT '', what TEXT DEFAULT '',
    at INTEGER, joined INTEGER, gid TEXT DEFAULT '', pend INTEGER DEFAULT 0)`); // tài khoản Zalo ↔ số điện thoại khách (tìm theo số khách để lại trên web)
  await run(db, 'CREATE INDEX IF NOT EXISTS zb_users_phone ON zb_users(phone)');
  await run(db, `CREATE TABLE IF NOT EXISTS zb_out (id INTEGER PRIMARY KEY AUTOINCREMENT, kind TEXT, gid TEXT DEFAULT '', uid TEXT DEFAULT '', phone TEXT DEFAULT '', text TEXT DEFAULT '',
    img TEXT DEFAULT '', mentions TEXT DEFAULT '', due INTEGER, status TEXT DEFAULT 'new', at INTEGER, done_at INTEGER, ref TEXT DEFAULT '')`); // việc chờ chương trình Zalo làm
  await run(db, 'CREATE INDEX IF NOT EXISTS zb_out_due ON zb_out(status, due)');
  await run(db, 'CREATE TABLE IF NOT EXISTS zb_imgs (id TEXT PRIMARY KEY, data TEXT, at INTEGER)'); // ảnh nhân sự tải lên cho bài đăng (data:image/jpeg;base64…), xem ở api.thucduonglanh.vn/zb-img/<id>
  await run(db, `CREATE TABLE IF NOT EXISTS zb_posts (id TEXT PRIMARY KEY, day TEXT, slot TEXT, topic TEXT DEFAULT '', text TEXT DEFAULT '', img TEXT DEFAULT '', prod TEXT DEFAULT '',
    status TEXT DEFAULT 'draft', by_name TEXT DEFAULT '', at INTEGER, sent_at INTEGER)`); // bài đăng hằng ngày (id = yyyyMMdd_slot)
  await run(db, 'CREATE INDEX IF NOT EXISTS zb_posts_day ON zb_posts(day)');
  for (const c of ["funnel TEXT DEFAULT ''", 'eng_msgs INTEGER DEFAULT 0', 'eng_people INTEGER DEFAULT 0', 'eng_reacts INTEGER DEFAULT 0']) { try { await run(db, 'ALTER TABLE zb_posts ADD COLUMN ' + c); } catch (e) { } } // 31/10/2026: nhãn phễu + tương tác 2 tiếng sau khi đăng
  await run(db, `CREATE TABLE IF NOT EXISTS zb_log (rid INTEGER PRIMARY KEY AUTOINCREMENT, at INTEGER, kind TEXT, gid TEXT DEFAULT '', uid TEXT DEFAULT '', name TEXT DEFAULT '',
    text TEXT DEFAULT '', reply TEXT DEFAULT '')`); // nhật ký trợ lý (CRM xem)
  await run(db, 'CREATE INDEX IF NOT EXISTS zb_log_at ON zb_log(at)');
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
  const h = { poll: zPoll, ack: zAck, join: zJoin, msg: zMsg, dm: zDm, friend: zFriend, login: zLogin, human: zHuman }[d.ev];
  return h ? await h(x, d) : { ok: false, error: 'ev' };
}

async function zPoll(x, d) {
  const now = Date.now(), cfg = await zCfg(x), old = await kvJson(x.db, 'zb_status', null);
  const st = { at: now, me: d.me || null, groups: (d.groups || []).slice(0, 50), ver: String(d.ver || '') };
  if (!old || now - old.at > 4 * 60e3 || JSON.stringify(old.groups) !== JSON.stringify(st.groups) || (old.down && !st.down)) await kvSet(x.db, 'zb_status', JSON.stringify(st)); // ghi 4 phút / lần cho đỡ tốn
  if (old && old.down) x.later(telegram(x.env, '✅ <b>Trợ lý Zalo An Lành đã chạy lại</b>'));
  for (const t of (Array.isArray(d.stats) ? d.stats : []).slice(0, 5)) // tương tác 2 tiếng sau khi đăng bài (chương trình Zalo đếm)
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
      const t = slotTime(day, sl.at); if (now < t || now > t + 2 * 3600e3) continue;
      if (p.status === 'draft' && !slotAuto(cfg, p.slot)) continue;
      if (!String(p.text || '').trim()) continue;
      await run(x.db, "UPDATE zb_posts SET status = 'sent', sent_at = ? WHERE id = ? AND status = ?", now, p.id, p.status);
      for (const gid of cfg.groups) await run(x.db, "INSERT INTO zb_out (kind, gid, text, img, due, at, ref) VALUES ('post', ?, ?, ?, ?, ?, ?)", gid, p.text, p.img || '', now, now, p.id);
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
    out.jobs = jobs.filter(j => j.kind === 'lookup' || !quiet(now) || j.kind === 'dm').map(j => ({ id: j.id, kind: j.kind, ref: j.ref || '', gid: j.gid, uid: j.uid, phone: j.phone, text: j.text, img: j.img, mentions: j.mentions ? JSON.parse(j.mentions) : [] }));
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
  if (j.kind === 'post' && d.ok) await zlog(x, j.ref === 'announce' ? 'announced' : j.ref ? 'post' : 'send', { gid: j.gid, text: j.text.slice(0, 200), name: j.ref ? '' : 'Nhân sự gửi' });
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
  const now = Date.now(), text = announceText(nm, what), due = quiet(now + 60e3) ? nextMorning(now) : now + 60e3; // giờ im lặng → 6h30 sáng
  await run(x.db, "INSERT INTO zb_out (kind, gid, text, mentions, due, at, ref) VALUES ('post', ?, ?, ?, ?, ?, 'announce')", gid, text, JSON.stringify([{ uid, name: nm }]), due, now);
  await zlog(x, 'announce', { gid, uid, name: nm, text: what + ' · ⏰ hẹn đăng ' + fmtDate(due, 'HH:mm dd/MM') + (due - now > 5 * 60e3 ? ' (sau giờ im lặng 21h45–6h)' : ''), reply: text });
}
function announceText(nm, what) {
  const t = [
    `🎉 Chúc mừng @${nm} vừa nhận ${what} trên web Thực Dưỡng Lành 🌿\n\nAi trong nhóm muốn nhận thì vào thucduonglanh.vn hoặc nhắn riêng cho em nha, em gửi ngay ạ 💚`,
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
- Việc riêng tư (đơn hàng, đổi trả, khiếu nại, giá sỉ, bệnh cụ thể, người muốn mua) → trả lời ngắn và mời nhắn riêng: "anh/chị nhắn riêng em nha, em hỗ trợ kỹ hơn" + thêm [[zalo]] để chuyên viên biết. Không hỏi số điện thoại trong nhóm.

# Khi nào lên tiếng
Bạn đọc một tin trong nhóm (kèm vài tin trước đó). Quyết định:
- Trả lời khi: người ta gọi bạn / trả lời tin của bạn; hoặc đặt câu hỏi về sản phẩm, cách dùng, dinh dưỡng, sống khỏe, đặt hàng, ưu đãi mà chưa ai trong đội ngũ trả lời.
- Chỉ thả tim (viết đúng: [TIM]) khi: người ta khoe bữa ăn lành, chia sẻ cảm nhận, cảm ơn, chúc mừng, trả lời câu hỏi tương tác của bài đăng.
- Im lặng (viết đúng: [BO_QUA]) khi: chuyện phiếm giữa thành viên, chào hỏi chung, tin không cần đội ngũ, quảng cáo / link lạ, đã có người trả lời đủ, tin chính trị / tôn giáo gây tranh cãi.
Khi trả lời thì chỉ viết nội dung tin (không ghi [TIM] / [BO_QUA]).

# Ví dụ giọng nhắn (chỉ để học giọng; thông tin thật lấy từ phần kiến thức, không lấy từ ví dụ)
- Hỏi: "Đặt hàng thế nào em ơi" → "Dạ chị nhắn riêng em tên với địa chỉ, em lên đơn cho chị luôn nha. Hàng tới chị được kiểm rồi mới trả tiền ạ."
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
  const ctx = (d.ctx || []).slice(-12).map(m => (m.bot ? 'Em (' + BOT + ')' : m.staff ? '[Đội ngũ] ' + m.name : m.name) + ': ' + String(m.text || '').slice(0, 300)).join('\n');
  let reply = '';
  try {
    const res = await ai(x.env).messages.create({ model: FAST, max_tokens: 1500, output_config: { effort: 'low' },
      system: [{ type: 'text', text: GROUP_RULES + '\n' + TRUTH_RULES.replace(/mời nhắn Zalo/g, 'mời nhắn riêng') },
        { type: 'text', text: 'TÀI LIỆU (thông tin chính thức của Thực Dưỡng Lành):\n\n' + know, cache_control: { type: 'ephemeral' } },
        { type: 'text', text: 'Nhóm: "' + gname + '". Bây giờ là ' + w.label + '. Chuyên viên ' + (w.on ? 'đang trực.' : 'ngoài giờ (trực Thứ 2 – Thứ 7, 8h–17h).') }],
      messages: [{ role: 'user', content: (ctx ? 'Các tin trước trong nhóm:\n' + ctx + '\n\n' : '') + 'TIN CẦN XỬ LÝ – ' + (d.name || 'Thành viên') + (direct ? ' (gọi em / trả lời tin của em)' : '') + ': ' + text }] });
    if (res.stop_reason === 'refusal') return { ok: true };
    reply = textOf(res);
  } catch (e) { console.error('zMsg ai', e && e.message); return { ok: true }; }
  if (!reply || /\[BO_QUA\]/.test(reply)) { if (direct) await zlog(x, 'skip', { gid, uid: d.uid, name: d.name, text }); return { ok: true }; }
  if (/^\s*\[TIM\]\s*$/.test(reply) || (/\[TIM\]/.test(reply) && reply.replace(/\[TIM\]/g, '').trim().length < 3)) { await zlog(x, 'react', { gid, uid: d.uid, name: d.name, text }); return { ok: true, react: 'heart' }; }
  const z = zText(safe(reply.replace(/\[(TIM|BO_QUA)\]/g, '')), prodMap(know));
  await kvSet(x.db, hk, String(n + 1), 2 * 3600e3);
  await zlog(x, z.zalo ? 'handoff' : 'answer', { gid, uid: d.uid, name: d.name, text, reply: z.text });
  if (z.zalo) x.later(handoff(x, { where: 'nhóm "' + gname + '"', name: d.name, uid: d.uid, text, reply: z.text }));
  return { ok: true, reply: z.text, quote: true };
}

/** Câu cần người thật → Telegram (kèm số điện thoại nếu đã biết từ web) */
async function handoff(x, o) {
  const u = o.uid ? await first(x.db, 'SELECT phone, name FROM zb_users WHERE uid = ?', o.uid) : null;
  await telegram(x.env, '🤖 <b>TRỢ LÝ ZALO CẦN NGƯỜI THẬT</b> – ' + esc(o.where) + '\n👤 ' + esc(o.name || '') + (u && u.phone ? ' – <b>' + esc(u.phone) + '</b>' : ' (chưa biết số)') + '\n💬 ' + esc(o.text.slice(0, 300)) + '\n🤖 Đã trả lời: ' + esc(o.reply.slice(0, 300))
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
  const nm = String(d.name || '').trim();
  await zlog(x, 'friend', { uid: d.uid, name: nm, text: String(d.msg || '') });
  return { ok: true, accept: true, text: 'Dạ em chào anh/chị' + (nm ? ' ' + nm : '') + ' ạ 🌿 Em là An Lành bên Thực Dưỡng Lành. Anh/chị cần hỏi gì về sản phẩm, cách dùng hay thực đơn lành cứ nhắn em nha, em trả lời liền ạ.' };
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
  const days = [fmtDate(now, 'yyyyMMdd'), fmtDate(now + DAY, 'yyyyMMdd')];
  const have = new Set((await all(x.db, 'SELECT id FROM zb_posts WHERE day IN (?, ?)', days[0], days[1])).map(r => r.id));
  for (const day of days) for (const sl of cfg.slots) {
    if (!sl.on || have.has(day + '_' + sl.id) || slotTime(day, sl.at) < now + 20 * 60e3) continue;
    try { await zWrite(x, day, sl.id, ''); } catch (e) { console.error('zWrite', e.message); await kvSet(x.db, 'zb_write_err', fmtDate(now, 'HH:mm dd/MM') + ': ' + String(e.message).slice(0, 200)); }
    return;
  }
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

export async function zWrite(x, day, slot, hint, by) {
  const know = await kb(), prods = prodMap(know), wd = new Date(slotTime(day, '12:00') + TZ_MS).getUTCDay();
  const recent = await all(x.db, "SELECT day, slot, topic, img FROM zb_posts WHERE topic != '' ORDER BY day DESC LIMIT 20");
  const used = new Set(recent.map(r => r.img).filter(Boolean)), lib = (await imgLib()).filter(i => !used.has(i.url)); // không lặp ảnh đã dùng gần đây
  const sang = slot !== 'toi', th = THEME[sang ? 'sang' : 'toi'][wd];
  // ưu đãi đang chạy (Marketing nhập ở CRM) cho bài bán hàng
  const offers = th.f === 'BOFU' ? await offersLive(x) : [];
  // đố vui tối qua → sáng nay công bố đáp án
  const quiz = th.quiz ? await first(x.db, "SELECT text FROM zb_posts WHERE day = ? AND slot = 'toi'", fmtDate(slotTime(day, '12:00') - DAY, 'yyyyMMdd')) : null;
  // cảm nhận khách hàng thật (anh Sơn cho phép đăng trong nhóm 31/10/2026): lấy cái lâu chưa dùng nhất
  const fbs = th.fb ? ((await kvJson(x.db, 'zb_fb', [])) || []).filter(f => f.on !== false).sort((a, b) => (a.used || 0) - (b.used || 0)) : [];
  const fb = fbs[0] || null;
  const ask = [
    'Viết 1 bài đăng nhóm Zalo cộng đồng "Sống khỏe cùng Thực Dưỡng Lành" (thành viên phần lớn là cô chú trung niên, mẹ bỉm, người ăn chay, dân văn phòng).',
    'Ngày: ' + ['Chủ nhật', 'Thứ 2', 'Thứ 3', 'Thứ 4', 'Thứ 5', 'Thứ 6', 'Thứ 7'][wd] + ' ' + day.slice(6, 8) + '/' + day.slice(4, 6) + ' · ' + (sang ? 'đăng lúc sáng sớm' : 'đăng buổi tối') + '.',
    'Chủ đề hôm nay: ' + th.t + ' (tầng phễu: ' + FUNNEL[th.f] + ')' + (hint ? '\nYêu cầu thêm của nhân sự: ' + hint : ''),
    quiz ? 'CÂU ĐỐ TỐI QUA (công bố đáp án đúng, giải thích 1–2 câu):\n' + String(quiz.text).slice(0, 1200) : th.quiz ? 'Tối qua không có câu đố: bỏ phần đáp án, chỉ làm phần hỏi đáp.' : '',
    th.fb ? (fb ? 'CẢM NHẬN KHÁCH HÀNG (thật, khách đồng ý chia sẻ; chỉ dùng đúng ý này, không thêm chi tiết, không nêu họ tên đầy đủ – gọi "một chị khách", "anh khách quen"…):\n' + fb.note : 'Chưa có cảm nhận khách hàng mới: thay bằng câu hỏi mời mọi người kể trải nghiệm dùng sản phẩm của mình (không bịa cảm nhận).') : '',
    th.f === 'BOFU' ? (offers.length ? 'ƯU ĐÃI ĐANG CHẠY (chỉ nói đúng như sau):\n' + offers.map(o => '- ' + [o.title, o.prod ? 'sản phẩm: ' + o.prod : '', o.text, o.until ? 'hạn đến ' + o.until : ''].filter(Boolean).join(' · ')).join('\n') : 'Hiện không có ưu đãi riêng: không bịa khuyến mãi, chỉ nhắc freeship đơn từ 300k và được kiểm hàng trước khi nhận.') : '',
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
    'Trả về đúng định dạng:\nCHỦ ĐỀ: <tóm tắt chủ đề trong 10 chữ, nêu rõ nguyên liệu / món / sản phẩm>\nSẢN PHẨM: <mã sản phẩm dạng chữ-thường-gạch-ngang nếu bài nói chủ yếu về 1 sản phẩm có ảnh, không thì ghi "không">\nẢNH: <số ảnh trong KHO ẢNH THẬT, hoặc "không">\n---\n<nội dung bài>'
  ].filter(s => s !== null).join('\n');
  const req = { model: WRITER, max_tokens: 4000, output_config: { effort: 'medium' },
    system: [{ type: 'text', text: 'Bạn viết bài cho nhóm Zalo cộng đồng của Thực Dưỡng Lành (VitaGreen Nutrition). Tiếng Việt chuẩn, tự nhiên.\n' + TRUTH_RULES },
      { type: 'text', text: 'TÀI LIỆU (thông tin chính thức của Thực Dưỡng Lành):\n\n' + know, cache_control: { type: 'ephemeral' } }],
    messages: [{ role: 'user', content: ask }] };
  let res; // bị bộ lọc an toàn từ chối nhầm → máy chủ Anthropic tự chuyển mô hình dự phòng (fallbacks); tham số này lỗi thì gọi lại không kèm
  try { res = await ai(x.env).beta.messages.create(Object.assign({ betas: ['server-side-fallback-2026-07-01'], fallbacks: 'default' }, req)); }
  catch (e) { if (!(e instanceof Anthropic.BadRequestError)) throw e; res = await ai(x.env).messages.create(req); }
  if (res.stop_reason === 'refusal') throw new Error('AI từ chối viết bài');
  const raw = textOf(res), parts = raw.split(/\n-{3,}\n/);
  const head = parts.length > 1 ? parts[0] : '', body = safe((parts.length > 1 ? parts.slice(1).join('\n---\n') : raw).trim());
  const topic = ((head.match(/CHỦ ĐỀ:\s*(.+)/) || [])[1] || body.split('\n')[0]).replace(/\*/g, '').trim().slice(0, 120);
  const code = ((head.match(/SẢN PHẨM:\s*([a-z0-9-]+)/) || [])[1] || '');
  const pick = lib[Number((head.match(/ẢNH:\s*(\d+)/) || [])[1]) - 1];
  const img = fb && fb.img ? fb.img : prods[code] && prods[code].img ? prods[code].img : pick ? pick.url : '';
  if (!body) throw new Error('AI chưa viết được bài');
  const id = day + '_' + slot, now = Date.now();
  // link web trong bài → gắn mã bài để CRM đếm đơn từ bài này (đơn ghi nguồn "zalo / nhom / <mã bài>")
  const tagged = body.replace(/https:\/\/thucduonglanh\.vn[^\s)]*/g, u => u.replace(/[?#].*$/, '') + '?utm_source=zalo&utm_medium=nhom&utm_campaign=' + id);
  if (fb) { const all = (await kvJson(x.db, 'zb_fb', [])) || []; for (const f of all) if (f.id === fb.id) f.used = now; await kvSet(x.db, 'zb_fb', JSON.stringify(all)); }
  await run(x.db, `INSERT INTO zb_posts (id, day, slot, topic, text, img, prod, status, by_name, at, funnel) VALUES (?, ?, ?, ?, ?, ?, ?, 'draft', ?, ?, ?)
    ON CONFLICT(id) DO UPDATE SET topic = excluded.topic, text = excluded.text, img = excluded.img, prod = excluded.prod, status = 'draft', by_name = excluded.by_name, at = excluded.at, funnel = excluded.funnel`,
    id, day, slot, topic, tagged.slice(0, 4000), img, prods[code] ? code : '', by || 'AI', now, th.f);
  const cfg = await zCfg(x);
  if (!slotAuto(cfg, slot) && !by) x.later(telegram(x.env, '📝 <b>Bài Zalo chờ duyệt</b> – ' + (SLOT_NAME[slot] || slot) + ' ' + day.slice(6, 8) + '/' + day.slice(4, 6) + ': ' + esc(topic) + '\n👉 Duyệt / sửa: ' + CRM_URL + '/#tro-ly-zalo'));
  return { id, topic };
}

/* ---------------------------------------------------------------- CRM → tab 🤖 Trợ lý Zalo (Quản lý, Quản trị, Marketing) */
export async function crmZbot(x, u, d, crmLog) {
  if (u.level < 2 && u.role !== 'Marketing' && !u.zb) return { ok: false, error: 'Bạn chưa được giao phụ trách Trợ lý Zalo. Nhờ Quản trị tích ô 🤖 Trợ lý Zalo cho bạn ở Cài đặt → Nhân sự.' };
  const a = d.action, now = Date.now();
  if (a === 'zb_view') {
    const cfg = await zCfg(x), st = await kvJson(x.db, 'zb_status', null);
    const from = fmtDate(now - DAY, 'yyyyMMdd');
    const posts = await all(x.db, 'SELECT id, day, slot, topic, text, img, prod, status, by_name, at, sent_at, funnel, eng_msgs, eng_people, eng_reacts FROM zb_posts WHERE day >= ? ORDER BY day, slot', from);
    // 30 ngày: bài đã đăng + tương tác + đơn từ link trong bài (nguồn đơn "zalo / nhom / <mã bài>")
    const since = now - 30 * DAY, done = await all(x.db, "SELECT id, funnel, eng_msgs, eng_people, eng_reacts FROM zb_posts WHERE status = 'sent' AND sent_at >= ?", since);
    const ords = await all(x.db, "SELECT source, first_source, total, status FROM orders WHERE time >= ? AND (source LIKE 'zalo / nhom / %' OR first_source LIKE 'zalo / nhom / %')", since);
    const byPost = {}; for (const o of ords) { if (isVoid(o.status)) continue; const m = String(o.source).match(/^zalo \/ nhom \/ (\S+)/) || String(o.first_source).match(/^zalo \/ nhom \/ (\S+)/); if (!m) continue; const b = byPost[m[1]] || (byPost[m[1]] = { n: 0, rev: 0 }); b.n++; b.rev += Number(o.total) || 0; }
    const funnel = {}; for (const p of done) { const k = p.funnel || 'Khác', f = funnel[k] || (funnel[k] = { posts: 0, people: 0, msgs: 0, reacts: 0, orders: 0, rev: 0 }); f.posts++; f.people += p.eng_people || 0; f.msgs += p.eng_msgs || 0; f.reacts += p.eng_reacts || 0; if (byPost[p.id]) { f.orders += byPost[p.id].n; f.rev += byPost[p.id].rev; } }
    for (const p of posts) if (byPost[p.id]) { p.orders = byPost[p.id].n; p.rev = byPost[p.id].rev; }
    const log = await all(x.db, 'SELECT at, kind, gid, name, text, reply FROM zb_log ORDER BY rid DESC LIMIT 60');
    const lib = (await imgLib()).map(i => ({ url: i.url, thumb: i.thumb || i.url, alt: i.alt }));
    const stats = await all(x.db, 'SELECT kind, count(*) AS n FROM zb_log WHERE at > ? GROUP BY kind', now - 7 * DAY);
    const users = await first(x.db, "SELECT count(*) AS n, sum(CASE WHEN phone != '' THEN 1 ELSE 0 END) AS known, sum(CASE WHEN joined > ? AND phone != '' THEN 1 ELSE 0 END) AS joined7 FROM zb_users", now - 7 * DAY);
    return { ok: true, cfg, status: st, posts, log, lib, funnel, stats, users, err: await kvGet(x.db, 'zb_write_err'), key: !!x.env.ZBOT_KEY, aiOn: !!x.env.ANTHROPIC_API_KEY, now };
  }
  if (a === 'zb_cfg') {
    const cfg = await zCfg(x), c = d.cfg || {};
    for (const k of ['on', 'welcome', 'answer', 'announce', 'approve', 'approveAll']) if (c[k] !== undefined) cfg[k] = !!c[k];
    if (c.mode === 'auto' || c.mode === 'approve') cfg.mode = c.mode;
    if (Array.isArray(c.groups)) cfg.groups = c.groups.map(String).slice(0, 10);
    if (c.maxHour !== undefined) cfg.maxHour = Math.max(1, Math.min(30, Number(c.maxHour) || 8));
    if (Array.isArray(c.slots)) cfg.slots = cfg.slots.map(s => { const n = c.slots.find(z => z.id === s.id) || {}; return { id: s.id, at: /^\d{1,2}:\d{2}$/.test(n.at || '') ? n.at.padStart(5, '0') : s.at, on: n.on === undefined ? s.on : !!n.on, mode: n.mode === 'auto' || n.mode === 'approve' ? n.mode : s.mode || cfg.mode }; });
    await kvSet(x.db, 'zb_cfg', JSON.stringify(cfg));
    await crmLog(x, u, 'Cài đặt trợ lý Zalo', '', '', '', JSON.stringify(c).slice(0, 300));
    return { ok: true, cfg };
  }
  if (a === 'zb_post') { // sửa / duyệt / bỏ / đăng lại
    const p = await first(x.db, 'SELECT * FROM zb_posts WHERE id = ?', String(d.id || '')); if (!p) return { ok: false, error: 'Không tìm thấy bài.' };
    if (p.status === 'sent' && d.status !== 'draft') return { ok: false, error: 'Bài này đã đăng rồi.' };
    const st = ['draft', 'ok', 'skip'].includes(d.status) ? d.status : p.status;
    const text = d.text === undefined ? p.text : String(d.text).slice(0, 4000);
    await run(x.db, 'UPDATE zb_posts SET text = ?, status = ?, by_name = ?, at = ? WHERE id = ?', text, st, u.name, now, p.id);
    await crmLog(x, u, 'Bài Zalo', p.id, '', { ok: 'Duyệt', skip: 'Bỏ', draft: 'Sửa' }[st] || st, p.topic);
    return { ok: true };
  }
  if (a === 'zb_img') { // đổi ảnh bài: link trong kho / ảnh tải từ máy (data:image…) / '' = bỏ ảnh
    const p = await first(x.db, 'SELECT id, status, topic FROM zb_posts WHERE id = ?', String(d.id || '')); if (!p) return { ok: false, error: 'Không tìm thấy bài.' };
    if (p.status === 'sent') return { ok: false, error: 'Bài này đã đăng rồi.' };
    let img = String(d.img || '');
    if (img.startsWith('data:image/')) {
      if (img.length > 1.5e6) return { ok: false, error: 'Ảnh lớn quá, bạn chọn ảnh khác giúp nhé.' };
      const iid = 'u' + now.toString(36) + Math.random().toString(36).slice(2, 6);
      await run(x.db, 'INSERT INTO zb_imgs (id, data, at) VALUES (?, ?, ?)', iid, img, now);
      img = API_URL + '/zb-img/' + iid;
    } else if (img && !img.startsWith(SITE + '/') && !img.startsWith(API_URL + '/zb-img/')) return { ok: false, error: 'Ảnh không hợp lệ.' };
    await run(x.db, 'UPDATE zb_posts SET img = ?, by_name = ?, at = ? WHERE id = ?', img, u.name, now, p.id);
    await crmLog(x, u, 'Bài Zalo', p.id, '', img ? 'Đổi ảnh' : 'Bỏ ảnh', p.topic);
    return { ok: true, img };
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
    try { const r = await zWrite(x, day, slot, String(d.hint || '').slice(0, 300), u.name); return { ok: true, id: r.id }; }
    catch (e) { return { ok: false, error: 'AI chưa viết được: ' + e.message }; }
  }
  if (a === 'zb_send') { // nhân sự tự viết, trợ lý đăng vào nhóm (ngay / hẹn giờ)
    const text = String(d.text || '').trim().slice(0, 4000), cfg = await zCfg(x);
    if (text.length < 5) return { ok: false, error: 'Nội dung quá ngắn.' };
    const at = d.at ? new Date(String(d.at) + ':00+07:00').getTime() : now;
    if (isNaN(at)) return { ok: false, error: 'Giờ hẹn chưa đúng.' };
    const gs = (Array.isArray(d.groups) && d.groups.length ? d.groups.map(String) : cfg.groups).filter(g => cfg.groups.includes(g));
    if (!gs.length) return { ok: false, error: 'Chưa chọn nhóm cho trợ lý.' };
    for (const gid of gs) await run(x.db, "INSERT INTO zb_out (kind, gid, text, due, at) VALUES ('post', ?, ?, ?, ?)", gid, safe(text), Math.max(at, now), now);
    await crmLog(x, u, 'Gửi tin vào nhóm Zalo', '', '', at > now + 60e3 ? 'Hẹn ' + fmtDate(at, 'HH:mm dd/MM') : 'Gửi ngay', text.slice(0, 200));
    return { ok: true };
  }
  return { ok: false, error: 'Không rõ thao tác: ' + a };
}

/** GET api.thucduonglanh.vn/zb-img/<id>: ảnh nhân sự tải lên cho bài đăng (chương trình Zalo tải về để đăng, CRM xem trước) */
export async function zbImg(x, id) {
  const r = await first(x.db, 'SELECT data FROM zb_imgs WHERE id = ?', String(id).replace(/[^a-z0-9]/g, '').slice(0, 30));
  const m = r && String(r.data).match(/^data:(image\/[a-z+]+);base64,(.+)$/);
  if (!m) return new Response('Không có ảnh', { status: 404 });
  const bin = atob(m[2]), buf = new Uint8Array(bin.length); for (let i = 0; i < bin.length; i++) buf[i] = bin.charCodeAt(i);
  return new Response(buf, { headers: { 'Content-Type': m[1], 'Cache-Control': 'public, max-age=31536000, immutable', 'Access-Control-Allow-Origin': '*' } });
}
