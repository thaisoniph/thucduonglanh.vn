/* ================================================================ 👀 Giám sát Zalo của sale (15/11/2026, anh Sơn)
 * Mục đích: Quản lý / Quản trị xem sale chăm khách qua Zalo mà sale KHÔNG đổi thói quen (vẫn dùng Zalo điện thoại + Zalo PC).
 *   Anh Sơn đã thử 14/11: 1 tài khoản Zalo chạy song song điện thoại + Zalo PC + Zalo Web được, nên chương trình đọc ngồi ở
 *   chỗ "Zalo Web". Chương trình (zalo-bot/sale-manager.js) CHỈ ĐỌC tin nhắn riêng (1–1) của sale với khách, không gửi.
 * CÀI 1 LẦN: 1 chương trình giữ Zalo của nhiều sale. Mọi việc còn lại bấm trong CRM → tab 👀 Zalo của sale:
 *   ➕ Kết nối 1 sale → mã QR hiện ngay trong CRM → sale quét bằng Zalo của mình → xong. Ngắt cũng bấm trong CRM.
 * Khoá: dùng lại ZBOT_KEY (của trợ lý An Lành) để khỏi phải đặt secret mới. Chương trình gửi POST:
 *   { type:'zsale', key, ev, ... }
 *     poll      – 20 giây/lần: báo đang giữ tài khoản nào (sales[]) → trả { want:[cần kết nối], stop:[cần ngắt] }
 *     qr        – có mã QR cho 1 sale đang chờ kết nối → lưu để CRM hiện (ảnh data:image/png;base64)
 *     connected – 1 sale đăng nhập xong
 *     msg       – 1 tin nhắn riêng (self = 1 nếu do chính sale gửi)
 *     gone      – 1 sale đã ngắt / bị đăng xuất
 * zs_accounts (kv): danh sách sale muốn theo dõi (do Quản trị bấm trong CRM). zs_sale (bảng): trạng thái thật từng tài khoản.
 * Pháp luật (Luật 91/2025): Zalo công ty cấp cho công việc; ghi nội quy + cho sale ký đồng ý lưu hội thoại. Tin giữ 12 tháng.
 * 17/11/2026 anh Sơn (sau góp ý của chị Thủy): chia quyền theo vai trò để chị em không thấy bị giám sát:
 *   Quản trị: xem hết (cả nội dung) để đánh giá chất lượng chăm sóc.
 *   Quản lý: CHỈ con số thống kê + gợi ý hỗ trợ từng sale (zsTips). Không xem nội dung, không thấy tên / số khách.
 *   Sale: 💬 Zalo của tôi ở tab Hôm nay (zs_mine) – khách đang chờ mình trả lời, khách có ý muốn mua → Lên đơn, khách mới chưa có
 *   trong CRM → thêm / gắn số, lịch sử Zalo tự vào hồ sơ khách, 🔒 Không phải khách (người thân, bạn bè) → xoá + không lưu nữa.
 *   Nhóm Telegram chỉ nhận con số; tên khách chỉ nhắn riêng cho đúng sale đó. Ô Zalo của sale = tên nhân sự CRM (slug(u.name)). */
import Anthropic from '@anthropic-ai/sdk';
import { esc, run, all, first, kvGet, kvSet, kvJson, normPhone, fmtDate, CRM_URL, TZ_MS, DAY } from './lib.js';
import { aiFetch } from './airelay.js';
import { kb, safe } from './chat.js';
import { telegram } from './google.js';
import { telegramUser, crmUsers } from './crm.js';

const CFG0 = { on: true, replyMins: 30, readUntil: 0 };
const READ_MS = 24 * 3600e3; // 👁 Quản trị bật xem nội dung → tự tắt sau 24 giờ (18/11/2026 anh Sơn: chỉ bật khi cần, chị em yên tâm)
// 18/11/2026 anh Sơn: TRƯỚC MẮT không ai đọc nội dung, kể cả Quản trị (chị em yên tâm hoàn toàn). Muốn mở lại công tắc 👁 thì đổi thành true.
const READ_ALLOWED = false;
const readOn = cfg => READ_ALLOWED && Number(cfg.readUntil || 0) > Date.now();
const RETAIN_DAYS = 365;
const QR_TTL = 110e3; // mã QR sống ~110 giây rồi hết hạn (chương trình tự tạo mã mới)
const vnHour = t => { const d = new Date(t + TZ_MS); return d.getUTCHours() + d.getUTCMinutes() / 60; };
const workNow = t => { const h = vnHour(t); return h >= 8 && h < 21; };
const dayStartVn = t => Math.floor((t + TZ_MS) / DAY) * DAY - TZ_MS;
const PHONE_RE = /(?:\+?84|0)(?:[\s.\-]?\d){9}(?!\d)/;
// mã ngắn của sale từ tên (bỏ dấu, chỉ chữ thường + số) – chỉ để đặt tên slot, không phải định danh Zalo
const slug = s => String(s || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/đ/g, 'd').replace(/[^a-z0-9]/g, '').slice(0, 24);

export async function zsaleSchema(db) {
  await run(db, `CREATE TABLE IF NOT EXISTS zs_msgs (id INTEGER PRIMARY KEY AUTOINCREMENT, mid TEXT, sale TEXT, uid TEXT,
    phone TEXT DEFAULT '', self INTEGER DEFAULT 0, text TEXT DEFAULT '', ts INTEGER, at INTEGER)`);
  await run(db, 'CREATE UNIQUE INDEX IF NOT EXISTS zs_msgs_mid ON zs_msgs(mid)');
  await run(db, 'CREATE INDEX IF NOT EXISTS zs_msgs_thread ON zs_msgs(sale, uid, id)');
  await run(db, 'CREATE INDEX IF NOT EXISTS zs_msgs_phone ON zs_msgs(phone, id)');
  await run(db, `CREATE TABLE IF NOT EXISTS zs_threads (sale TEXT, uid TEXT, phone TEXT DEFAULT '', zname TEXT DEFAULT '',
    last_cust INTEGER DEFAULT 0, last_sale INTEGER DEFAULT 0, n INTEGER DEFAULT 0, cust_n INTEGER DEFAULT 0,
    alerted INTEGER DEFAULT 0, at INTEGER, PRIMARY KEY (sale, uid))`);
  await run(db, 'CREATE INDEX IF NOT EXISTS zs_threads_phone ON zs_threads(phone)');
  await run(db, 'CREATE INDEX IF NOT EXISTS zs_threads_wait ON zs_threads(last_cust)');
  await run(db, `CREATE TABLE IF NOT EXISTS zs_sale (sale TEXT PRIMARY KEY, name TEXT DEFAULT '', phone TEXT DEFAULT '',
    uid TEXT DEFAULT '', ver TEXT DEFAULT '', at INTEGER, down INTEGER DEFAULT 0, live INTEGER DEFAULT 0)`); // live = chương trình đang giữ tài khoản
}

export async function zsCfg(x) { return Object.assign({}, CFG0, await kvJson(x.db, 'zs_cfg', {})); }
const zsAccounts = async x => await kvJson(x.db, 'zs_accounts', {}); // { sale: { name, want, at } }
const zsAccountsSet = (x, a) => kvSet(x.db, 'zs_accounts', JSON.stringify(a));
const zsPriv = async x => await kvJson(x.db, 'zs_priv', {}); // 🔒 { sale: { uid: thời điểm } } – cuộc trò chuyện sale đánh dấu Không phải khách
const BUY_RE = /(đặt|lấy|mua|giá|bao nhiêu|bn tiền|ship|còn hàng|chốt|gửi (cho|về|giúp)|địa chỉ|chuyển khoản|stk|số tài khoản|cod)/i;
/** Ô Zalo (sale) → tên nhân sự CRM: ô được đặt theo tên nhân sự lúc Quản trị bấm Kết nối. */
async function slotUser(x, sale) { return (await crmUsers(x)).find(z => z.active && slug(z.name) === sale) || null; }

/* ---------------------------------------------------------------- điều phối (index.js gọi khi type === 'zsale') */
export async function zsale(x, d) {
  const key = x.env.ZSALE_KEY || x.env.ZBOT_KEY; // dùng lại ZBOT_KEY để khỏi đặt secret mới
  if (!key || d.key !== key) return { ok: false, error: 'key' };
  const h = { poll: zsPoll, qr: zsQr, connected: zsConnected, msg: zsMsg, gone: zsGone, login: zsLogin }[d.ev];
  return h ? await h(x, d) : { ok: false, error: 'ev' };
}

async function zsPoll(x, d) {
  const now = Date.now(), accounts = await zsAccounts(x);
  await kvSet(x.db, 'zs_host_at', String(now)); // chương trình giữ Zalo còn sống (để CRM biết đã cài, dù chưa kết nối sale nào)
  const running = {}; for (const s of (Array.isArray(d.sales) ? d.sales : [])) if (s && s.sale) running[s.sale] = s;
  // cập nhật trạng thái các tài khoản chương trình đang giữ
  for (const [sale, s] of Object.entries(running)) {
    const was = await first(x.db, 'SELECT down FROM zs_sale WHERE sale = ?', sale);
    await run(x.db, `INSERT INTO zs_sale (sale, name, phone, uid, ver, at, down, live) VALUES (?, ?, ?, ?, ?, ?, 0, 1)
      ON CONFLICT(sale) DO UPDATE SET name = excluded.name, phone = excluded.phone, uid = excluded.uid, ver = excluded.ver, at = excluded.at, down = 0, live = 1`,
      sale, String(s.name || (accounts[sale] && accounts[sale].name) || sale).slice(0, 80), normPhone(s.phone || ''), String(s.uid || ''), String(d.ver || ''), now);
    if (was && was.down) x.later(telegram(x.env, '✅ <b>Zalo của sale đã chạy lại</b>: ' + esc(String(s.name || sale))));
  }
  // cần kết nối: sale muốn theo dõi (want) mà chương trình chưa giữ · cần ngắt: chương trình đang giữ mà không còn want
  const want = Object.entries(accounts).filter(([sale, a]) => a.want && !running[sale]).map(([sale, a]) => ({ sale, name: a.name || sale }));
  const stop = Object.keys(running).filter(sale => !accounts[sale] || !accounts[sale].want);
  const cfg = await zsCfg(x);
  return { ok: true, want, stop, cfg: { on: cfg.on !== false, replyMins: cfg.replyMins } };
}

async function zsQr(x, d) {
  const sale = slug(d.sale); if (!sale) return { ok: false, error: 'sale' };
  const img = String(d.img || ''); if (!/^data:image\/(png|jpe?g);base64,/.test(img) || img.length > 400000) return { ok: false, error: 'img' };
  await kvSet(x.db, 'zs_qr_' + sale, img, QR_TTL);
  return { ok: true };
}

async function zsConnected(x, d) {
  const sale = slug(d.sale); if (!sale) return { ok: false, error: 'sale' };
  const accounts = await zsAccounts(x);
  if (accounts[sale]) { accounts[sale].on = 1; await zsAccountsSet(x, accounts); }
  await run(x.db, `INSERT INTO zs_sale (sale, name, phone, uid, at, down, live) VALUES (?, ?, ?, ?, ?, 0, 1)
    ON CONFLICT(sale) DO UPDATE SET name = excluded.name, phone = excluded.phone, uid = excluded.uid, at = excluded.at, down = 0, live = 1`,
    sale, String(d.name || (accounts[sale] && accounts[sale].name) || sale).slice(0, 80), normPhone(d.phone || ''), String(d.uid || ''), Date.now());
  await run(x.db, "DELETE FROM kv WHERE k = ?", 'zs_qr_' + sale);
  x.later(telegram(x.env, '✅ <b>Đã kết nối Zalo của sale</b>: ' + esc(String(d.name || sale)) + (d.phone ? ' (' + esc(normPhone(d.phone)) + ')' : '') + '\n👉 Xem trong CRM: ' + CRM_URL + '/#zalo-sale'));
  return { ok: true };
}

async function zsGone(x, d) {
  const sale = slug(d.sale); if (!sale) return { ok: false, error: 'sale' };
  await run(x.db, 'UPDATE zs_sale SET live = 0, down = 1 WHERE sale = ?', sale);
  await kvSet(x.db, 'zs_qr_' + sale, '', 1); // xoá mã QR cũ
  if (d.reason === 'logout') { const a = await zsAccounts(x); if (a[sale]) { delete a[sale]; await zsAccountsSet(x, a); } await run(x.db, 'DELETE FROM zs_sale WHERE sale = ?', sale); }
  return { ok: true };
}

async function zsMsg(x, d) {
  const cfg = await zsCfg(x);
  if (cfg.on === false) return { ok: true, off: 1 };
  const sale = slug(d.sale), uid = String(d.uid || '');
  if (!sale || !uid) return { ok: false, error: 'thiếu sale/uid' };
  if (((await zsPriv(x))[sale] || {})[uid]) return { ok: true, priv: 1 }; // 🔒 sale đã đánh dấu Không phải khách → không lưu
  const self = d.self ? 1 : 0, ts = Number(d.ts) || Date.now(), now = Date.now();
  const text = String(d.text || '').slice(0, 4000), zname = String(d.zname || '').slice(0, 80);
  let phone = normPhone(d.phone || '');
  if (!phone && !self) { const m = text.match(PHONE_RE); if (m) phone = normPhone(m[0]); }
  const mid = sale + ':' + String(d.msgId || (ts + '_' + Math.round(Math.random() * 1e9)));
  await run(x.db, 'INSERT OR IGNORE INTO zs_msgs (mid, sale, uid, phone, self, text, ts, at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)', mid, sale, uid, phone, self, text, ts, now);
  const th = await first(x.db, 'SELECT phone, last_cust, last_sale, alerted FROM zs_threads WHERE sale = ? AND uid = ?', sale, uid);
  if (!th) {
    await run(x.db, 'INSERT INTO zs_threads (sale, uid, phone, zname, last_cust, last_sale, n, cust_n, alerted, at) VALUES (?, ?, ?, ?, ?, ?, 1, ?, 0, ?)',
      sale, uid, phone, zname, self ? 0 : ts, self ? ts : 0, self ? 0 : 1, now);
  } else {
    const ph = phone || th.phone || '';
    await run(x.db, `UPDATE zs_threads SET phone = ?, zname = COALESCE(NULLIF(?, ''), zname),
      last_cust = ?, last_sale = ?, n = n + 1, cust_n = cust_n + ?, alerted = ? WHERE sale = ? AND uid = ?`,
      ph, zname, self ? th.last_cust : ts, self ? ts : th.last_sale, self ? 0 : 1, self ? th.alerted : 0, sale, uid);
    if (ph && !th.phone) await run(x.db, "UPDATE zs_msgs SET phone = ? WHERE sale = ? AND uid = ? AND phone = ''", ph, sale, uid);
  }
  return { ok: true };
}

async function zsLogin(x, d) {
  const sale = slug(d.sale), k = 'zs_login_' + sale + '_' + fmtDate(Date.now(), 'yyMMddHH');
  if (!await kvGet(x.db, k)) {
    await kvSet(x.db, k, '1', 2 * 3600e3);
    await telegram(x.env, '⚠️ <b>Zalo của sale bị đăng xuất</b>: ' + esc(String(d.name || sale)) + '\n👉 Vào CRM → 👀 Zalo của sale → bấm ➕ Kết nối lại rồi cho sale quét mã QR.');
  }
  return { ok: true };
}

/* ---------------------------------------------------------------- cron: báo khách chưa được trả lời + báo mất kết nối + dọn tin cũ */
export async function zsaleTick(x) {
  const cfg = await zsCfg(x); if (cfg.on === false) return;
  const now = Date.now();
  for (const s of await all(x.db, 'SELECT sale, name, at, down, live FROM zs_sale')) {
    if (s.live && !s.down && s.at && now - s.at > 20 * 60e3) {
      await run(x.db, 'UPDATE zs_sale SET down = 1 WHERE sale = ?', s.sale);
      await telegram(x.env, '⚠️ <b>Zalo của sale mất kết nối</b>: ' + esc(s.name || s.sale) + ' (từ ' + fmtDate(s.at, 'HH:mm dd/MM') + ').\n👉 Kiểm tra máy chủ đang chạy (bật máy, có mạng).');
    }
  }
  if (!workNow(now)) return;
  const mins = Math.max(5, Number(cfg.replyMins) || 30), cut = now - mins * 60e3;
  const wait = await all(x.db, 'SELECT sale, uid, phone, zname, last_cust FROM zs_threads WHERE last_cust > last_sale AND last_cust < ? AND last_cust > ? AND alerted = 0 ORDER BY last_cust LIMIT 60', cut, now - 6 * 3600e3);
  if (!wait.length) { if (Math.random() < 0.05) await run(x.db, 'DELETE FROM zs_msgs WHERE at < ?', now - RETAIN_DAYS * DAY); return; }
  const names = {}; for (const s of await all(x.db, 'SELECT sale, name FROM zs_sale')) names[s.sale] = s.name || s.sale;
  for (const w of wait) w.who = await custNameOwner(x, w.phone);
  const bySale = {}; for (const w of wait) (bySale[w.sale] || (bySale[w.sale] = [])).push(w);
  const grp = [];
  for (const [sale, list] of Object.entries(bySale)) {
    // nhắn riêng cho đúng sale (có tên khách – khách của chính bạn ấy), nhóm chỉ nhận con số (17/11/2026: Quản lý không thấy tên / nội dung)
    const lines = list.map(w => '• ' + esc(w.who.name || w.zname || 'Khách') + ' · chờ ' + Math.round((now - w.last_cust) / 60e3) + ' phút');
    const su = await slotUser(x, sale);
    if (su) await telegramUser(x, su.name, '💬 Có <b>' + list.length + '</b> khách nhắn Zalo đang chờ bạn trả lời:\n' + lines.join('\n') + '\n👉 Mở CRM → Hôm nay → 💬 Zalo của tôi: ' + CRM_URL + '/#hom-nay');
    grp.push(esc(names[sale] || sale) + ': ' + list.length + ' khách');
    await run(x.db, "UPDATE zs_threads SET alerted = 1 WHERE sale = ? AND uid IN (SELECT value FROM json_each(?))", sale, JSON.stringify(list.map(w => w.uid)));
  }
  if (grp.length) await telegram(x.env, '💬 <b>Khách nhắn Zalo chờ quá ' + mins + ' phút</b>\n' + grp.join('\n') + '\n(Đã nhắn riêng cho từng bạn. Nếu bạn đang bận gọi điện, nhờ người khác đỡ giúp.)');
  if (Math.random() < 0.05) await run(x.db, 'DELETE FROM zs_msgs WHERE at < ?', now - RETAIN_DAYS * DAY);
}

async function custNameOwner(x, phone) {
  if (!phone) return { name: '', owner: '' };
  const c = await first(x.db, 'SELECT name, owner FROM customers WHERE phone = ?', phone);
  if (c) return { name: c.name || '', owner: c.owner || '' };
  const l = await first(x.db, 'SELECT name, owner FROM leads WHERE phone = ? ORDER BY rid DESC LIMIT 1', phone);
  return l ? { name: l.name || '', owner: l.owner || '' } : { name: '', owner: '' };
}

/* ================================================================ CRM → tab 👀 Zalo của sale + 💬 Zalo của tôi (sale)
 * Quyền (17/11/2026): Quản trị (level 3) xem hết · Quản lý (level 2) chỉ con số + gợi ý · Sale (level 1) chỉ cuộc trò chuyện trên Zalo của chính mình. */
export async function crmZsale(x, u, d, crmLog) {
  const a = d.action, now = Date.now(), admin = u.level >= 3, mySlot = slug(u.name);
  // 👁 Quản trị chỉ đọc nội dung khi đã bật công tắc (tự tắt sau 24 giờ). Tắt = Quản trị thấy như Quản lý: con số + gợi ý.
  const full = admin && readOn(await zsCfg(x)), OFF_MSG = READ_ALLOWED ? 'Đang tắt xem nội dung tin nhắn. Bật ở đầu tab 👀 Zalo của sale (tự tắt sau 24 giờ).' : 'Nội dung tin nhắn chỉ sale đó xem. Quản trị và Quản lý xem con số + gợi ý ở tab 👀 Zalo của sale.';
  // ----- sale: 💬 Zalo của tôi
  if (a === 'zs_mine') return zsMine(x, u);
  if (a === 'zs_thread') {
    if (u.level >= 2 && !full) return { ok: false, error: admin ? OFF_MSG : 'Quản lý xem con số và gợi ý hỗ trợ ở tab 👀 Zalo của sale. Nội dung tin nhắn chỉ sale đó xem.' };
    return zsThread(x, d, full ? '' : mySlot);
  }
  if (a === 'zs_private' || a === 'zs_link') {
    const sale = admin ? slug(d.sale) : mySlot, uid = String(d.uid || '');
    if (!sale || !uid) return { ok: false, error: 'Thiếu cuộc trò chuyện.' };
    if (u.level >= 2 && !full) return { ok: false, error: admin ? OFF_MSG : 'Chỉ sale có Zalo đó làm được.' };
    const th = await first(x.db, 'SELECT phone, zname FROM zs_threads WHERE sale = ? AND uid = ?', sale, uid);
    if (!th) return { ok: false, error: 'Không tìm thấy cuộc trò chuyện (có thể đã xoá).' };
    if (a === 'zs_link') { // 📇 gắn số điện thoại cho cuộc trò chuyện chưa nhận ra khách → tin Zalo vào hồ sơ khách
      const ph = normPhone(d.phone || ''); if (!/^0\d{9}$/.test(ph)) return { ok: false, error: 'Số điện thoại chưa đúng (10 số).' };
      await run(x.db, 'UPDATE zs_threads SET phone = ? WHERE sale = ? AND uid = ?', ph, sale, uid);
      await run(x.db, 'UPDATE zs_msgs SET phone = ? WHERE sale = ? AND uid = ?', ph, sale, uid);
      return { ok: true, phone: ph, who: await custNameOwner(x, ph) };
    }
    // 🔒 Không phải khách: xoá hẳn + từ nay không lưu. Khách đã có trong CRM thì không cho (tránh giấu khách).
    if (th.phone && (await first(x.db, 'SELECT 1 FROM customers WHERE phone = ? UNION SELECT 1 FROM leads WHERE phone = ? LIMIT 1', th.phone, th.phone))) return { ok: false, error: 'Số này là khách trong CRM nên vẫn được lưu để chăm sóc. Nếu nhầm số, bấm 📇 Gắn số khách để sửa.' };
    const pv = await zsPriv(x); (pv[sale] || (pv[sale] = {}))[uid] = now; await kvSet(x.db, 'zs_priv', JSON.stringify(pv));
    await run(x.db, 'DELETE FROM zs_msgs WHERE sale = ? AND uid = ?', sale, uid);
    await run(x.db, 'DELETE FROM zs_threads WHERE sale = ? AND uid = ?', sale, uid);
    return { ok: true };
  }
  if (a === 'zs_self') return zsSelf(x, u, d, crmLog); // 📲 sale tự kết nối / tự ngắt Zalo của mình (17/11/2026)
  if (a === 'zs_qr' && slug(d.sale) === mySlot) { const acc = (await zsAccounts(x))[mySlot] || {}; return { ok: true, qr: await kvGet(x.db, 'zs_qr_' + mySlot) || '', on: !!acc.on }; }
  if (a === 'zs_ai') { // ✨ gợi ý trả lời + cách chăm sóc 1 khách (sale: Zalo của mình; Quản trị: mọi sale)
    if (u.level >= 2 && !full) return { ok: false, error: admin ? OFF_MSG : 'Gợi ý trả lời dành cho sale có Zalo đó.' };
    return zsAi(x, u, d, full ? slug(d.sale) : mySlot);
  }
  if (u.level < 2) return { ok: false, error: 'Mục này dành cho Quản lý và Quản trị. Zalo của bạn xem ở tab Hôm nay → 💬 Zalo của tôi.' };
  if (a === 'zs_view') return zsView(x, u);
  if (a === 'zs_qr') { const sale = slug(d.sale); return { ok: true, qr: await kvGet(x.db, 'zs_qr_' + sale) || '', on: !!((await zsAccounts(x))[sale] || {}).on }; }
  if (a === 'zs_connect') { // ➕ Quản trị thêm 1 sale để theo dõi → chương trình sẽ hiện mã QR
    if (u.level < 3) return { ok: false, error: 'Chỉ Quản trị kết nối được Zalo của sale.' };
    const name = String(d.name || '').trim().slice(0, 60), sale = slug(name);
    if (!sale) return { ok: false, error: 'Cần tên sale (vd Chị Thuý).' };
    const accounts = await zsAccounts(x); accounts[sale] = { name, want: 1, on: (accounts[sale] || {}).on || 0, at: now };
    await zsAccountsSet(x, accounts);
    if (crmLog) await crmLog(x, u, 'Kết nối Zalo sale', '-', '', name, '');
    return { ok: true, sale, name };
  }
  if (a === 'zs_disconnect') { // ⏹ ngắt theo dõi 1 sale
    if (u.level < 3) return { ok: false, error: 'Chỉ Quản trị ngắt được.' };
    const sale = slug(d.sale), accounts = await zsAccounts(x);
    if (accounts[sale]) { accounts[sale].want = 0; await zsAccountsSet(x, accounts); }
    await run(x.db, 'UPDATE zs_sale SET live = 0 WHERE sale = ?', sale);
    if (crmLog) await crmLog(x, u, 'Ngắt Zalo sale', '-', '', (accounts[sale] && accounts[sale].name) || sale, '');
    return { ok: true };
  }
  if (a === 'zs_cfg') {
    if (u.level < 3) return { ok: false, error: 'Chỉ Quản trị đổi được cài đặt.' };
    const cfg = await zsCfg(x);
    if (d.on !== undefined) cfg.on = !!d.on;
    if (d.replyMins !== undefined) cfg.replyMins = Math.max(5, Math.min(240, Number(d.replyMins) || 30));
    if (d.read !== undefined && !READ_ALLOWED) return { ok: false, error: 'Đang khoá xem nội dung tin nhắn: không ai đọc, kể cả Quản trị.' };
    if (d.read !== undefined) { // 👁 công tắc xem nội dung: bật 24 giờ / tắt ngay. Ghi nhật ký; sale thấy trạng thái trên màn hình của mình.
      cfg.readUntil = d.read ? now + READ_MS : 0; await kvSet(x.db, 'zs_cfg', JSON.stringify(cfg));
      if (crmLog) await crmLog(x, u, d.read ? 'Bật xem nội dung Zalo sale' : 'Tắt xem nội dung Zalo sale', '-', '', d.read ? 'tự tắt ' + fmtDate(cfg.readUntil, 'HH:mm dd/MM') : '', '');
      return { ok: true, cfg, read: readOn(cfg), readUntil: cfg.readUntil };
    }
    await kvSet(x.db, 'zs_cfg', JSON.stringify(cfg));
    if (crmLog) await crmLog(x, u, 'Cài đặt Zalo sale', '-', '', (cfg.on ? 'Bật' : 'Tắt') + ' · nhắc sau ' + cfg.replyMins + ' phút', '');
    return { ok: true, cfg };
  }
  return { ok: false, error: 'Không rõ thao tác: ' + a };
}

/** Thống kê tin nhắn từ mốc `from`: mỗi sale → số khách nhắn, số lần trả lời, thời gian trả lời trung bình, số lần trả lời chậm (> 60 phút, trong giờ làm). */
async function zsStats(x, from) {
  const rows = await all(x.db, 'SELECT sale, uid, self, ts FROM zs_msgs WHERE ts >= ? ORDER BY ts LIMIT 40000', from);
  const st = {}, seq = {};
  for (const m of rows) {
    const s = st[m.sale] || (st[m.sale] = { th: {}, cust: 0, reply: 0, gaps: [], slow: 0 }), k = m.sale + '|' + m.uid; s.th[m.uid] = 1;
    if (m.self) { s.reply++; if (seq[k]) { const g = m.ts - seq[k]; if (workNow(seq[k])) { s.gaps.push(g); if (g > 3600e3) s.slow++; } seq[k] = 0; } }
    else { s.cust++; if (!seq[k]) seq[k] = m.ts; }
  }
  const out = {};
  for (const [sale, s] of Object.entries(st)) out[sale] = { threads: Object.keys(s.th).length, cust: s.cust, reply: s.reply, slow: s.slow,
    avgMin: s.gaps.length ? Math.round(s.gaps.reduce((a, b) => a + b, 0) / s.gaps.length / 60e3) : null };
  return out;
}
const EMPTY_ST = { threads: 0, cust: 0, reply: 0, slow: 0, avgMin: null };

/** 💡 Gợi ý hỗ trợ cho Quản lý: chỉ từ con số, giọng hỗ trợ (không bắt lỗi). */
function zsTips(per, replyMins) {
  const tips = [];
  for (const p of per) {
    const n = p.name, t = p.today, w = p.week;
    if (p.on && !p.online) tips.push({ k: 'tech', t: 'Zalo của ' + n + ' đang mất kết nối với CRM → nhắc bạn mở Zalo trên điện thoại 1 lần, hoặc báo anh Sơn kết nối lại. Trong lúc này bạn không nhận được lời nhắc khách chờ.' });
    if (p.waiting >= 3) tips.push({ k: 'help', t: n + ' đang có ' + p.waiting + ' khách nhắn chờ trả lời → hỏi bạn có đang bận gọi điện / đi giao hàng không, cần người trực Zalo đỡ giúp một lúc không.' });
    else if (p.waiting) tips.push({ k: 'info', t: n + ' có ' + p.waiting + ' khách đang chờ trả lời (CRM đã nhắc riêng bạn ấy).' });
    if (w.avgMin != null && w.avgMin > 60 && w.cust >= 10) tips.push({ k: 'help', t: n + ' 7 ngày qua trả lời trung bình sau ' + (w.avgMin / 60).toFixed(1) + ' giờ → có thể bạn đang quá nhiều việc. Cùng bạn xem lại: giờ nào hay trả lời chậm, có nên chia bớt số mới, hay dùng câu trả lời mẫu cho câu hỏi hay gặp.' });
    if (w.slow >= 5) tips.push({ k: 'help', t: n + ' có ' + w.slow + ' lần khách chờ hơn 1 giờ trong 7 ngày → gợi ý bạn bật thông báo Zalo trên điện thoại, và hẹn khách "em gọi lại lúc …" khi đang bận.' });
    if (t.avgMin != null && t.avgMin <= 10 && t.threads >= 5) tips.push({ k: 'good', t: '👏 ' + n + ' hôm nay trả lời rất nhanh (trung bình ' + t.avgMin + ' phút, ' + t.threads + ' khách) → khen bạn trong buổi họp hoặc bấm 👏 trên CRM.' });
    else if (w.threads >= 30) tips.push({ k: 'good', t: '👏 ' + n + ' 7 ngày qua chăm ' + w.threads + ' khách qua Zalo → ghi nhận công sức của bạn.' });
  }
  if (!tips.length) tips.push({ k: 'good', t: '✅ Chưa thấy gì cần hỗ trợ. Khách nhắn đều được trả lời trong ' + replyMins + ' phút.' });
  const ord = { help: 0, tech: 1, info: 2, good: 3 }; return tips.sort((a, b) => ord[a.k] - ord[b.k]);
}

async function zsView(x, u) {
  const now = Date.now(), cfg = await zsCfg(x), day0 = dayStartVn(now), accounts = await zsAccounts(x), admin = u.level >= 3;
  const live = {}; for (const s of await all(x.db, 'SELECT sale, name, phone, at, down, live FROM zs_sale')) live[s.sale] = s;
  // tài khoản đang theo dõi (want) + trạng thái
  const sales = Object.entries(accounts).filter(([, a]) => a.want).map(([sale, a]) => {
    const s = live[sale] || {};
    return { sale, name: a.name || (s.name) || sale, phone: admin && readOn(cfg) ? s.phone || '' : '', on: !!a.on, online: !!(s.live && s.at && now - s.at < 5 * 60e3 && !s.down), pairing: !a.on };
  });
  const saleNm = {}; sales.forEach(s => saleNm[s.sale] = s.name);
  // khách đang chờ trả lời
  const waitRows = await all(x.db, 'SELECT sale, uid, phone, zname, last_cust, last_sale FROM zs_threads WHERE last_cust > last_sale AND last_cust > ? ORDER BY last_cust LIMIT 60', now - DAY);
  const waitN = {}; for (const w of waitRows) waitN[w.sale] = (waitN[w.sale] || 0) + 1;
  const stT = await zsStats(x, day0), stW = await zsStats(x, now - 7 * DAY);
  const perSale = sales.map(s => ({ sale: s.sale, name: s.name, on: s.on, online: s.online, waiting: waitN[s.sale] || 0, today: stT[s.sale] || EMPTY_ST, week: stW[s.sale] || EMPTY_ST }));
  const tips = zsTips(perSale.filter(p => p.on), cfg.replyMins);
  // chương trình giữ Zalo đã cài & đang chạy chưa (poll gần đây) → để CRM biết hiện nút Kết nối hay hướng dẫn cài 1 lần
  const hostAt = Number(await kvGet(x.db, 'zs_host_at')) || 0;
  const hostOn = now - hostAt < 5 * 60e3 || Object.keys(accounts).length > 0;
  const read = readOn(cfg);
  const out = { ok: true, admin, canRead: READ_ALLOWED, read, readUntil: read ? cfg.readUntil : 0, hostOn, cfg: { on: cfg.on !== false, replyMins: cfg.replyMins }, sales, perSale, tips };
  if (!admin || !read) return out; // Quản lý, và Quản trị khi tắt 👁: chỉ con số + gợi ý (17–18/11/2026)
  const waiting = [];
  for (const w of waitRows) { const who = await custNameOwner(x, w.phone); waiting.push({ sale: w.sale, saleName: saleNm[w.sale] || w.sale, uid: w.uid, phone: w.phone, name: who.name || w.zname || 'Khách', owner: who.owner || '', mins: Math.round((now - w.last_cust) / 60e3) }); }
  const recent = await all(x.db, 'SELECT sale, uid, phone, zname, last_cust, last_sale, n FROM zs_threads ORDER BY max(last_cust, last_sale) DESC LIMIT 40');
  const recentOut = [];
  for (const r of recent) { const who = await custNameOwner(x, r.phone); recentOut.push({ sale: r.sale, saleName: saleNm[r.sale] || r.sale, uid: r.uid, phone: r.phone, name: who.name || r.zname || 'Khách', owner: who.owner || '', n: r.n, last: Math.max(r.last_cust, r.last_sale), wait: r.last_cust > r.last_sale, crm: !!who.name }); }
  const pv = await zsPriv(x), priv = {}; for (const [sale, m] of Object.entries(pv)) priv[sale] = Object.keys(m).length;
  return Object.assign(out, { waiting, recent: recentOut, priv });
}

/** 💬 Zalo của tôi (sale): chỉ cuộc trò chuyện trên Zalo của chính mình. Ô Zalo = tên nhân sự (slug). */
async function zsMine(x, u) {
  const sale = slug(u.name), acc = (await zsAccounts(x))[sale];
  if (!acc || !acc.want || !acc.on) { // chưa kết nối → CRM hiện thẻ 📲 Kết nối Zalo của tôi (khi tính năng đang bật + chương trình trên máy chủ đang chạy)
    const cfg = await zsCfg(x), hostAt = Number(await kvGet(x.db, 'zs_host_at')) || 0;
    return { ok: true, on: false, sale, read: readOn(cfg), can: cfg.on !== false && Date.now() - hostAt < 10 * 60e3, pending: !!(acc && acc.want), agreed: !!(await kvJson(x.db, 'zs_consent', {}))[sale] };
  }
  const now = Date.now(), cfg = await zsCfg(x), s = await first(x.db, 'SELECT at, down, live FROM zs_sale WHERE sale = ?', sale) || {};
  const online = !!(s.live && s.at && now - s.at < 5 * 60e3 && !s.down);
  const th = await all(x.db, 'SELECT uid, phone, zname, last_cust, last_sale, n, cust_n FROM zs_threads WHERE sale = ? AND max(last_cust, last_sale) > ? ORDER BY max(last_cust, last_sale) DESC LIMIT 80', sale, now - 30 * DAY);
  const list = [];
  for (const t of th) {
    const who = await custNameOwner(x, t.phone), wait = t.last_cust > t.last_sale;
    const r = { uid: t.uid, phone: t.phone, name: who.name || t.zname || 'Khách Zalo', crm: !!who.name, owner: who.owner || '', n: t.n, last: Math.max(t.last_cust, t.last_sale), wait, mins: wait ? Math.round((now - t.last_cust) / 60e3) : 0 };
    if (now - t.last_cust < 3 * DAY && t.cust_n) { // khách có ý muốn mua: tin của khách 3 ngày gần đây có chữ đặt / giá / ship / địa chỉ…
      const lc = await all(x.db, 'SELECT text, ts FROM zs_msgs WHERE sale = ? AND uid = ? AND self = 0 ORDER BY id DESC LIMIT 5', sale, t.uid);
      const hit = lc.find(m => now - m.ts < 3 * DAY && BUY_RE.test(m.text)); if (hit) { r.buy = String(hit.text).slice(0, 120); r.buyAt = hit.ts; }
      if (wait && lc[0]) r.lastText = String(lc[0].text).slice(0, 120);
    }
    list.push(r);
  }
  const st = (await zsStats(x, dayStartVn(now)))[sale] || EMPTY_ST, wk = (await zsStats(x, now - 7 * DAY))[sale] || EMPTY_ST;
  return { ok: true, on: true, online, replyMins: cfg.replyMins, read: readOn(cfg), readUntil: readOn(cfg) ? cfg.readUntil : 0, list, today: st, week: wk };
}

async function zsThread(x, d, onlySale) {
  const sale = onlySale || slug(d.sale), uid = String(d.uid || ''), phone = normPhone(d.phone || '');
  let rows;
  if (uid && sale) rows = await all(x.db, 'SELECT sale, uid, self, text, ts FROM zs_msgs WHERE sale = ? AND uid = ? ORDER BY id DESC LIMIT 300', sale, uid);
  else if (phone) rows = onlySale ? await all(x.db, 'SELECT sale, uid, self, text, ts FROM zs_msgs WHERE phone = ? AND sale = ? ORDER BY id DESC LIMIT 300', phone, onlySale)
    : await all(x.db, 'SELECT sale, uid, self, text, ts FROM zs_msgs WHERE phone = ? ORDER BY id DESC LIMIT 300', phone);
  else return { ok: false, error: 'thiếu khoá' };
  const saleNm = {}; for (const s of await all(x.db, 'SELECT sale, name FROM zs_sale')) saleNm[s.sale] = s.name || s.sale;
  const msgs = rows.reverse().map(r => ({ self: !!r.self, text: r.text, ts: r.ts, saleName: saleNm[r.sale] || r.sale }));
  const t = uid && sale ? await first(x.db, 'SELECT phone, zname FROM zs_threads WHERE sale = ? AND uid = ?', sale, uid) : null;
  const ph = phone || (t && t.phone) || '', who = await custNameOwner(x, ph);
  return { ok: true, msgs, name: who.name, owner: who.owner, phone: ph, zname: (t && t.zname) || '', crm: !!who.name, sale, uid: uid || (rows[0] && rows[0].uid) || '' };
}

/* ================================================================ 📲 Sale tự kết nối Zalo của mình (17/11/2026 anh Sơn: chị em chủ động, yên tâm)
 * op 'connect' {agree}: ghi đồng ý (kv zs_consent – bằng chứng theo Luật 91/2025) + mở mã QR cho ô của mình. op 'off': tự ngắt (xoá phiên). */
async function zsSelf(x, u, d, crmLog) {
  const sale = slug(u.name), now = Date.now(); if (!sale) return { ok: false, error: 'Tài khoản chưa có tên.' };
  const accounts = await zsAccounts(x), cfg = await zsCfg(x);
  if (d.op === 'connect') {
    if (cfg.on === false) return { ok: false, error: 'Công ty đang tạm tắt tính năng này.' };
    if (!d.agree) return { ok: false, error: 'Bạn tích ô đồng ý trước nhé.' };
    const cs = await kvJson(x.db, 'zs_consent', {}); cs[sale] = { at: now, name: u.name, email: u.email }; await kvSet(x.db, 'zs_consent', JSON.stringify(cs));
    accounts[sale] = { name: u.name, want: 1, on: (accounts[sale] || {}).on || 0, at: now, self: 1 }; await zsAccountsSet(x, accounts);
    const pv = await zsPriv(x); // lần kết nối mới: không lưu lại các cuộc đã 🔒
    if (crmLog) await crmLog(x, u, 'Tự kết nối Zalo', '-', '', u.name, 'Đồng ý lưu tin nhắn công việc');
    return { ok: true, sale, priv: Object.keys(pv[sale] || {}).length };
  }
  if (d.op === 'off') {
    if (accounts[sale]) { accounts[sale].want = 0; await zsAccountsSet(x, accounts); }
    await run(x.db, 'UPDATE zs_sale SET live = 0 WHERE sale = ?', sale);
    if (crmLog) await crmLog(x, u, 'Tự ngắt Zalo', '-', '', u.name, String(d.why || '').slice(0, 200));
    x.later(telegram(x.env, '⏸ <b>' + esc(u.name) + '</b> đã tạm ngắt Zalo với CRM' + (d.why ? ': ' + esc(String(d.why).slice(0, 200)) : '') + '. Kết nối lại ở tab Hôm nay → 💬 Zalo của tôi.'));
    return { ok: true };
  }
  return { ok: false, error: 'Không rõ thao tác.' };
}

/* ================================================================ ✨ Gợi ý trả lời + cách chăm sóc 1 khách (17/11/2026)
 * Đọc ~20 tin gần nhất + hồ sơ khách trong CRM + thông tin sản phẩm chính thức (chat-kb, dùng chung trợ lý chat web) → Haiku viết:
 * khách đang cần gì, 2 câu trả lời mẫu (sale chép, tự gửi trên Zalo – CRM KHÔNG gửi), việc nên làm tiếp. ~100–300đ / lần. */
const ZS_AI_MAX = 60; // lượt / người / ngày
let zsClient = null;
const zsAiClient = env => zsClient || (zsClient = new Anthropic({ apiKey: env.ANTHROPIC_API_KEY, maxRetries: 1, timeout: 40e3, fetch: aiFetch(env), defaultHeaders: { 'x-tdl-muc': 'crm' } }));
const ZS_RULES = `Bạn là trợ lý chăm sóc khách của Thực Dưỡng Lành (thực phẩm thực dưỡng, trà thảo mộc). Bạn giúp NHÂN VIÊN SALE trả lời khách trên Zalo và chăm sóc khách tốt hơn. Sale sẽ tự chép câu trả lời và tự gửi.

Viết đúng 4 dòng, mỗi dòng bắt đầu bằng nhãn sau, không thêm gì khác:
KHÁCH CẦN: (1 câu: khách đang muốn gì / lo gì, đọc từ tin nhắn)
TRẢ LỜI 1: (câu trả lời để sale gửi ngay, ấm áp, xưng "em", gọi khách đúng như sale đang gọi, ≤ 60 chữ, có 1 câu hỏi mở hoặc lời mời bước tiếp theo)
TRẢ LỜI 2: (cách trả lời khác, ngắn hơn hoặc hướng khác, ≤ 45 chữ)
NÊN LÀM: (1–2 việc cụ thể sale nên làm tiếp: lên đơn, hẹn gọi lại giờ nào, gửi cách dùng, hỏi thăm sau khi dùng…, ≤ 40 chữ)

Quy tắc:
- Dựa vào THÔNG TIN SẢN PHẨM. Không bịa giá, khuyến mãi, công dụng. Không chắc giá / quà thì để sale điền: "[giá]".
- Không bao giờ nói sản phẩm "chữa", "điều trị", "khỏi bệnh", "đặc trị", "thay thuốc". Khách nhắc bệnh, thuốc, mang thai: nhắc nhẹ sản phẩm là thực phẩm, không phải là thuốc, nên hỏi bác sĩ nếu đang điều trị.
- Khách phải chờ lâu: mở đầu bằng lời xin lỗi ngắn.
- Văn tự nhiên như người Việt nhắn Zalo, không sáo rỗng, không dùng emoji quá 1 cái.`;

async function zsAi(x, u, d, sale) {
  const uid = String(d.uid || ''); if (!sale || !uid) return { ok: false, error: 'Thiếu cuộc trò chuyện.' };
  if (!x.env.ANTHROPIC_API_KEY) return { ok: false, error: 'Trợ lý AI chưa bật.' };
  const k = 'zsai_' + slug(u.name) + '_' + fmtDate(Date.now(), 'yyMMdd'), n = Number(await kvGet(x.db, k) || 0);
  if (n >= ZS_AI_MAX) return { ok: false, error: 'Hôm nay bạn đã dùng ' + ZS_AI_MAX + ' lượt gợi ý. Mai dùng tiếp nhé.' };
  const msgs = (await all(x.db, 'SELECT self, text, ts FROM zs_msgs WHERE sale = ? AND uid = ? ORDER BY id DESC LIMIT 20', sale, uid)).reverse();
  if (!msgs.length) return { ok: false, error: 'Chưa có tin nhắn nào để gợi ý.' };
  const th = await first(x.db, 'SELECT phone, zname FROM zs_threads WHERE sale = ? AND uid = ?', sale, uid) || {};
  let prof = 'Khách chưa có trong CRM (khách mới).';
  if (th.phone) {
    const c = await first(x.db, 'SELECT name, orders, spent, products, last, runout, care_result FROM customers WHERE phone = ?', th.phone);
    if (c) {
      const os = await all(x.db, "SELECT time, items, total, status FROM orders WHERE phone = ? ORDER BY time DESC LIMIT 3", th.phone);
      prof = 'Khách cũ: ' + (c.name || '') + ' · đã mua ' + (c.orders || 0) + ' đơn, tổng ' + Math.round((c.spent || 0) / 1000) + 'k' + (c.products ? ' · hay mua: ' + String(c.products).slice(0, 200) : '') +
        (c.last ? ' · lần mua gần nhất ' + fmtDate(c.last, 'dd/MM/yyyy') : '') + (c.runout ? ' · dự kiến hết hàng ' + fmtDate(c.runout, 'dd/MM') : '') + (c.care_result ? ' · lần chăm sóc trước: ' + String(c.care_result).slice(0, 120) : '') +
        (os.length ? '\nĐơn gần đây: ' + os.map(o => fmtDate(o.time, 'dd/MM') + ' ' + String(o.items || '').slice(0, 100) + ' (' + (o.status || '') + ')').join('; ') : '');
    } else if (await first(x.db, 'SELECT 1 FROM leads WHERE phone = ? LIMIT 1', th.phone)) prof = 'Khách đã hỏi trước đây nhưng chưa mua.';
  }
  const now = Date.now(), last = msgs[msgs.length - 1];
  const conv = msgs.map(m => (m.self ? 'Sale' : 'Khách') + ' (' + fmtDate(m.ts, 'dd/MM HH:mm') + '): ' + String(m.text).slice(0, 600)).join('\n');
  const wait = !last.self ? ' Khách nhắn cuối lúc ' + fmtDate(last.ts, 'HH:mm dd/MM') + ', đã chờ ' + Math.round((now - last.ts) / 60e3) + ' phút.' : ' Tin cuối là của sale (gợi ý cách nhắn tiếp / chăm sóc tiếp).';
  let res;
  try {
    res = await zsAiClient(x.env).messages.create({
      model: 'claude-haiku-5-5', max_tokens: 700, output_config: { effort: 'low' },
      system: [{ type: 'text', text: ZS_RULES }, { type: 'text', text: '# THÔNG TIN SẢN PHẨM\n\n' + await kb(), cache_control: { type: 'ephemeral' } }],
      messages: [{ role: 'user', content: 'Sale: ' + u.name + '. Hôm nay ' + fmtDate(now, 'dd/MM/yyyy HH:mm') + '.' + wait + '\n\n# HỒ SƠ KHÁCH\n' + prof + '\n\n# TIN NHẮN ZALO (cũ → mới)\n' + conv }]
    });
  } catch (e) { console.error('zs ai', e && (e.status || ''), e && e.message); return { ok: false, error: 'Trợ lý chưa trả lời được, thử lại sau ít phút.' }; }
  const t = safe(res.content.filter(b => b.type === 'text').map(b => b.text).join('\n'));
  const pick = lb => { const m = t.match(new RegExp(lb + '\\s*:\\s*(.+)')); return m ? m[1].trim() : ''; };
  const out = { need: pick('KHÁCH CẦN'), replies: [pick('TRẢ LỜI 1'), pick('TRẢ LỜI 2')].filter(Boolean), next: pick('NÊN LÀM') };
  if (!out.replies.length) return { ok: false, error: 'Trợ lý chưa gợi ý được, thử lại nhé.' };
  await kvSet(x.db, k, String(n + 1), 2 * DAY);
  return Object.assign({ ok: true }, out);
}
