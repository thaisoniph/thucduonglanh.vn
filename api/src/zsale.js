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
import { edAdd, edNorm } from './edlearn.js';
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
// 18/11/2026: tin khách chỉ để chào / cảm ơn / "để sau" thì không tính là đang chờ trả lời (thật: "Để sau con" bị báo chờ 57 phút)
const CLOSE_W = new Set('ok oke okie okay oki vâng dạ ừ uh ừm um được rồi cảm ơn cám thanks thank you tks để sau thôi bye chào hihi haha hì nhé nha ạ nhá à em con chị cô cháu anh bác mình nhiều lắm vậy'.split(' '));
const isClosing = t => { const x = String(t || '').toLowerCase().replace(/[\p{Extended_Pictographic}\uFE0F.!?…,~]+/gu, ' ').trim(); if (String(t || '').length > 40) return false; if (!x) return true; return x.split(/\s+/).every(w => CLOSE_W.has(w)); };
// tên Zalo ↔ tên khách trong CRM: bỏ dấu, bỏ xưng hô (chị, cô, anh…) để đoán khách khi Zalo ẩn số
const normName = s => String(s || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/đ/g, 'd').replace(/\b(chi|co|anh|em|bac|chu|di|ba|ong|me|kh|khach)\b/g, ' ').replace(/[^a-z ]/g, ' ').replace(/\s+/g, ' ').trim();
const BUY_RE = /(đặt|lấy|mua|giá|bao nhiêu|bn tiền|ship|còn hàng|chốt|gửi (cho|về|giúp)|địa chỉ|chuyển khoản|stk|số tài khoản|cod)/i;
// 20/11/2026 anh Sơn (khách cũ đến từ Zalo nhiều – không sót khách, gợi ý cách tiếp cận từng khách):
// khách phàn nàn → lên đầu danh sách, nhãn đỏ "gọi ngay"
const COMPLAIN_RE = /(chưa (nhận|thấy) (được )?hàng|chưa thấy giao|giao chậm|lâu quá|sao lâu|hỏng|bị vỡ|\bvỡ\b|móp|bị lỗi|sai hàng|giao sai|thiếu hàng|bị thiếu|hết hạn|bị mốc|bực|thất vọng|không hài lòng|trả hàng|trả lại hàng|hoàn tiền|đổi hàng|dị ứng|đau bụng|tiêu chảy|nổi mẩn)/i;
// đồng nghiệp trong danh sách Zalo của sale (thật 20/11: "Thu Thuỷ Thực Dưỡng Lành" bị tính là khách chờ) → không tính là khách
const STAFF_RE = /thuc duong lanh|vitagreen|vita green|vtg/;
async function staffSet(x) { const s = new Set(); for (const z of await crmUsers(x)) { const k = normName(z.name); if (k.length >= 4) s.add(k); } return s; }
const isStaff = (zname, ss) => { const k = normName(zname); return !!k && (STAFF_RE.test(k) || ss.has(k)); };
const firstProd = p => String(p || '').split(/[,;\n|]/)[0].replace(/\s+\d+\s*(g|gr|gói|hộp|ml)\b.*$/i, '').trim().slice(0, 32);
/** 🏷 Loại khách + việc nên làm (không tốn AI). prof: hồ sơ khách trong CRM (customers) nếu có. */
function zsTag(r, prof, isLead, complain, now) {
  if (complain) return { k: 'warn', t: '😟 Khách đang không vui', do: 'Gọi điện ngay, xin lỗi trước rồi hỏi rõ. Cần thì báo quản lý' };
  if (prof && prof.orders > 0) {
    if (prof.runout && prof.runout - now < 7 * DAY) return { k: 'out', t: '🔁 Khách cũ ' + (prof.runout < now ? 'đã hết ' : 'sắp hết ') + (firstProd(prof.products) || 'hàng'), do: 'Hỏi thăm dùng thấy thế nào, rồi mời đặt lại' };
    return { k: 'old', t: '💚 Khách cũ · ' + prof.orders + ' đơn', do: 'Hỏi thăm việc dùng trước, sau mới giới thiệu thêm' };
  }
  if (isLead) return { k: 'lead', t: '🙋 Đã hỏi trước, chưa mua', do: 'Hỏi lại điều khách còn lo, nhắc ưu đãi đang có' };
  if (r.buy || r.ask) return { k: 'new', t: '🌱 Khách mới hỏi mua', do: 'Hỏi dùng cho ai, đang lo gì, rồi báo giá + quà, xin số để lên đơn' };
  if (!r.phone) return { k: 'unk', t: '❓ Chưa biết là ai', do: 'Bấm đúng tên khách bên dưới, hoặc xin số điện thoại' };
  return null;
}
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
  if (self && text) await zsLearn(x, sale, uid, text);
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
  // ☀️ 8h sáng: nhắn riêng từng sale khách chờ từ hôm qua + khách im sau khi hỏi mua (20/11/2026: trước đây chỉ nhắc 1 lần, chờ quá 6 giờ là không ai nhắc nữa)
  const amK = 'zs_am_' + fmtDate(now, 'yyMMdd');
  if (vnHour(now) < 9.5 && !(await kvGet(x.db, amK))) { await kvSet(x.db, amK, '1', 2 * DAY); await zsMorning(x, now); }
  const mins = Math.max(5, Number(cfg.replyMins) || 30), cut = now - mins * 60e3;
  const wait = await all(x.db, 'SELECT sale, uid, phone, zname, last_cust FROM zs_threads WHERE last_cust > last_sale AND last_cust < ? AND last_cust > ? AND alerted = 0 ORDER BY last_cust LIMIT 60', cut, now - 6 * 3600e3);
  if (!wait.length) { if (Math.random() < 0.05) await run(x.db, 'DELETE FROM zs_msgs WHERE at < ?', now - RETAIN_DAYS * DAY); return; }
  const names = {}; for (const s of await all(x.db, 'SELECT sale, name FROM zs_sale')) names[s.sale] = s.name || s.sale;
  for (let i = wait.length - 1; i >= 0; i--) { const lt = await first(x.db, 'SELECT text FROM zs_msgs WHERE sale = ? AND uid = ? AND self = 0 ORDER BY id DESC LIMIT 1', wait[i].sale, wait[i].uid);
    if (lt && isClosing(lt.text)) { await run(x.db, 'UPDATE zs_threads SET alerted = 1 WHERE sale = ? AND uid = ?', wait[i].sale, wait[i].uid); wait.splice(i, 1); } } // khách chỉ chào / cảm ơn
  const ss = await staffSet(x);
  for (let i = wait.length - 1; i >= 0; i--) if (isStaff(wait[i].zname, ss)) { await run(x.db, 'UPDATE zs_threads SET alerted = 1 WHERE sale = ? AND uid = ?', wait[i].sale, wait[i].uid); wait.splice(i, 1); } // đồng nghiệp
  if (!wait.length) return;
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

/** ☀️ Tin sáng cho từng sale đã nối Zalo: khách chờ ≥ 12 giờ + 💤 khách im sau khi hỏi mua. Chỉ nhắn riêng đúng sale (tên khách là khách của chính bạn ấy). */
async function zsMorning(x, now) {
  for (const [sale, a] of Object.entries(await zsAccounts(x))) {
    if (!a || !a.want || !a.on) continue;
    const su = await slotUser(x, sale); if (!su) continue;
    const r = await zsMine(x, { name: su.name }); if (!r.on) continue;
    const wait = r.list.filter(t => t.wait && t.mins >= 720).sort((p, q) => (q.hot || 0) - (p.hot || 0) || q.mins - p.mins), sil = r.list.filter(t => t.silent);
    if (!wait.length && !sil.length) continue;
    const ln = t => '• ' + esc(t.name) + (t.hot ? ' 😟' : '');
    let m = '☀️ <b>Zalo của bạn sáng nay</b>';
    if (wait.length) m += '\n⏰ <b>' + wait.length + '</b> khách nhắn từ hôm qua chưa được trả lời:\n' + wait.slice(0, 8).map(t => ln(t) + ' · chờ ' + (t.mins < 1440 ? Math.round(t.mins / 60) + ' giờ' : Math.round(t.mins / 1440) + ' ngày')).join('\n');
    if (sil.length) m += '\n💤 <b>' + sil.length + '</b> khách hỏi mua rồi im, nhắn nhắc nhẹ 1 câu:\n' + sil.slice(0, 8).map(t => ln(t) + ' · im ' + t.silent + ' ngày').join('\n');
    await telegramUser(x, su.name, m + '\n👉 CRM → Hôm nay → 💬 Zalo của tôi (bấm ✨ để có câu gợi ý): ' + CRM_URL + '/#hom-nay');
  }
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
  // 👁 Quản trị đang "Xem như" 1 nhân sự: KHÔNG lộ Zalo của bạn ấy (18/11/2026 – đã hứa với chị em: không ai đọc, kể cả Quản trị)
  if (u.viewAs) { if (a === 'zs_mine') return { ok: true, on: false, can: false, va: 1 }; if (/^zs_(thread|ai|order|link|private|self|qr)$/.test(a)) return { ok: false, error: 'Zalo của nhân sự không hiện khi đang 👁 Xem như.' }; }
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
  if (a === 'zs_order') { // 🛒 đọc tin nhắn → số điện thoại, địa chỉ, món khách muốn mua để điền sẵn form lên đơn (18/11/2026)
    if (u.level >= 2 && !full) return { ok: false, error: admin ? OFF_MSG : 'Lên đơn từ Zalo dành cho sale có Zalo đó.' };
    return zsOrder(x, u, d, full ? slug(d.sale) : mySlot);
  }
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
  const ss = await staffSet(x);
  for (let i = waitRows.length - 1; i >= 0; i--) { if (isStaff(waitRows[i].zname, ss)) { waitRows.splice(i, 1); continue; } const lt = await first(x.db, 'SELECT text FROM zs_msgs WHERE sale = ? AND uid = ? AND self = 0 ORDER BY id DESC LIMIT 1', waitRows[i].sale, waitRows[i].uid); if (lt && isClosing(lt.text)) waitRows.splice(i, 1); }
  const waitN = {}; for (const w of waitRows) waitN[w.sale] = (waitN[w.sale] || 0) + 1;
  const stT = await zsStats(x, day0), stW = await zsStats(x, now - 7 * DAY);
  const aiuse = await kvJson(x.db, 'zs_aiuse', {}); // ✨ gợi ý: bấm / có gửi / gửi y nguyên (20/11/2026 – đo để cải tiến)
  const perSale = sales.map(s => ({ sale: s.sale, name: s.name, on: s.on, online: s.online, waiting: waitN[s.sale] || 0, today: stT[s.sale] || EMPTY_ST, week: stW[s.sale] || EMPTY_ST, ai: aiuse[s.sale] || null }));
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

/** 💬 Zalo của tôi (sale): chỉ cuộc trò chuyện trên Zalo của chính mình. Ô Zalo = tên nhân sự (slug).
 * 20/11/2026 anh Sơn (khách cũ đến từ Zalo nhiều): ẩn đồng nghiệp; 😟 khách phàn nàn lên đầu; 💤 khách im sau khi hỏi mua (nhắc lần 1 sau 2 ngày,
 * lần 2 sau 7 ngày, quá 14 ngày thôi); ứng viên gắn số theo tên (cands, tối đa 3); 🏷 nhãn loại khách + việc nên làm (zsTag); zph = số khách hay nhắn Zalo. */
async function zsMine(x, u) {
  const sale = slug(u.name), acc = (await zsAccounts(x))[sale];
  if (!acc || !acc.want || !acc.on) { // chưa kết nối → CRM hiện thẻ 📲 Kết nối Zalo của tôi (khi tính năng đang bật + chương trình trên máy chủ đang chạy)
    const cfg = await zsCfg(x), hostAt = Number(await kvGet(x.db, 'zs_host_at')) || 0;
    return { ok: true, on: false, sale, read: readOn(cfg), can: cfg.on !== false && Date.now() - hostAt < 10 * 60e3, pending: !!(acc && acc.want), agreed: !!(await kvJson(x.db, 'zs_consent', {}))[sale] };
  }
  const now = Date.now(), cfg = await zsCfg(x), s = await first(x.db, 'SELECT at, down, live FROM zs_sale WHERE sale = ?', sale) || {};
  const online = !!(s.live && s.at && now - s.at < 5 * 60e3 && !s.down), ss = await staffSet(x);
  const th = await all(x.db, 'SELECT uid, phone, zname, last_cust, last_sale, n, cust_n FROM zs_threads WHERE sale = ? AND max(last_cust, last_sale) > ? ORDER BY max(last_cust, last_sale) DESC LIMIT 80', sale, now - 30 * DAY);
  // ứng viên gắn số: khách + khách hỏi của chính bạn ấy, xếp theo tên gọi (chữ cuối của tên)
  const byLast = {};
  if (th.some(t => !t.phone)) {
    const add = (c, lead) => { const tk = normName(c.name).split(' ').filter(Boolean); if (!tk.length || tk[tk.length - 1].length < 2) return; (byLast[tk[tk.length - 1]] || (byLast[tk[tk.length - 1]] = [])).push({ phone: c.phone, name: c.name, tk, orders: c.orders || 0, last: c.last || 0, lead }); };
    for (const c of await all(x.db, 'SELECT phone, name, orders, last FROM customers WHERE owner = ? LIMIT 6000', u.name)) add(c, 0);
    for (const l of await all(x.db, "SELECT phone, name, max(time) last FROM leads WHERE owner = ? AND phone <> '' GROUP BY phone LIMIT 4000", u.name)) add(l, 1);
  }
  const cands = zname => {
    const zt = normName(zname).split(' ').filter(Boolean); if (!zt.length) return [];
    const pool = byLast[zt[zt.length - 1]] || [], seen = {};
    return pool.filter(c => c.tk.every(w => zt.includes(w)) || zt.every(w => c.tk.includes(w)))
      .map(c => Object.assign({ sc: c.tk.filter(w => zt.includes(w)).length * 10 + (c.lead ? 0 : 5) }, c))
      .sort((a, b) => b.sc - a.sc || b.last - a.last).filter(c => !seen[c.phone] && (seen[c.phone] = 1)).slice(0, 3)
      .map(c => ({ phone: c.phone, name: c.name, info: c.lead ? 'đã hỏi' : c.orders ? c.orders + ' đơn' : '' }));
  };
  const list = [];
  for (const t of th) {
    if (isStaff(t.zname, ss)) continue; // đồng nghiệp: không phải khách
    const prof = t.phone ? await first(x.db, 'SELECT name, owner, orders, products, runout, last FROM customers WHERE phone = ?', t.phone) : null;
    const lead = t.phone && !prof ? await first(x.db, 'SELECT name, owner FROM leads WHERE phone = ? ORDER BY rid DESC LIMIT 1', t.phone) : null;
    const who = prof || lead || {}; let wait = t.last_cust > t.last_sale, complain = false;
    const r = { uid: t.uid, phone: t.phone, zname: t.zname || '', name: who.name || t.zname || 'Khách Zalo', crm: !!who.name, owner: who.owner || '', n: t.n, last: Math.max(t.last_cust, t.last_sale), wait, mins: 0 };
    if (t.cust_n && (wait || now - t.last_cust < 14 * DAY)) {
      const lc = await all(x.db, 'SELECT text, ts FROM zs_msgs WHERE sale = ? AND uid = ? AND self = 0 ORDER BY id DESC LIMIT 6', sale, t.uid);
      if (lc[0]) r.lastText = String(lc[0].text).slice(0, 120);
      if (wait && lc[0] && isClosing(lc[0].text)) { wait = r.wait = false; r.closed = 1; } // khách chỉ chào / cảm ơn / để sau
      complain = lc.some(m => now - m.ts < 3 * DAY && COMPLAIN_RE.test(m.text));
      // khách có ý muốn mua: tin của khách gần đây có chữ đặt / giá / ship / địa chỉ…
      const hit = lc.find(m => now - m.ts < 14 * DAY && BUY_RE.test(m.text) && !isClosing(m.text));
      if (hit && r.phone && await first(x.db, "SELECT 1 FROM orders WHERE phone = ? AND time >= ? LIMIT 1", r.phone, hit.ts - 600e3)) r.bought = 1; // đã lên đơn sau tin đó
      else if (hit) {
        if (now - hit.ts < 3 * DAY && !wait) { r.buy = String(hit.text).slice(0, 120); r.buyAt = hit.ts; }
        // 💤 sale đã trả lời, khách im: lần 1 sau 2 ngày, lần 2 sau 7 ngày (nếu bạn ấy mới nhắc 1 lần), quá 14 ngày thôi
        const dC = (now - t.last_cust) / DAY, dS = (now - t.last_sale) / DAY;
        if (!wait && dC >= 2 && dC <= 14) {
          const nud = (await first(x.db, 'SELECT count(*) n FROM zs_msgs WHERE sale = ? AND uid = ? AND self = 1 AND ts > ?', sale, t.uid, t.last_cust + 20 * 3600e3)).n;
          if (nud === 0 || (nud === 1 && dC >= 7 && dS >= 4)) { r.silent = Math.floor(dC); r.nudge = nud + 1; r.ask = String(hit.text).slice(0, 120); r.askAt = hit.ts; delete r.buy; }
        }
      }
    }
    if (wait) r.mins = Math.round((now - t.last_cust) / 60e3);
    if (!t.phone) { const cs = cands(t.zname); if (cs.length) { r.cands = cs; if (cs.length === 1) r.guess = cs[0]; } }
    r.tag = zsTag(r, prof, !!lead, complain, now);
    if (r.tag && r.silent) r.tag.do = r.nudge > 1 ? 'Nhắn lần cuối thật nhẹ: chúc khách khoẻ, cần thì nhắn em' : 'Nhắn nhắc nhẹ 1 câu: hỏi khách còn phân vân gì, đừng giục';
    if (complain) r.hot = 1;
    list.push(r);
  }
  const zph = {}; // khách hay nhắn Zalo với bạn ấy (90 ngày) → tab Việc gọi gắn nhãn 💬 nhắn trước, gọi sau
  for (const z of await all(x.db, "SELECT phone FROM zs_threads WHERE sale = ? AND phone <> '' AND cust_n > 0 AND last_cust > ?", sale, now - 90 * DAY)) zph[z.phone] = 1;
  const st = (await zsStats(x, dayStartVn(now)))[sale] || EMPTY_ST, wk = (await zsStats(x, now - 7 * DAY))[sale] || EMPTY_ST;
  return { ok: true, on: true, online, replyMins: cfg.replyMins, read: readOn(cfg), readUntil: readOn(cfg) ? cfg.readUntil : 0, list, today: st, week: wk, zph };
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

Chỉ trả về đúng 1 khối JSON, không viết gì khác (18/11/2026: đổi từ 4 dòng có nhãn sang JSON cho chắc chắn đọc được):
{"need":"1 câu: khách đang muốn gì / lo gì, đọc từ tin nhắn","reply1":"câu trả lời để sale gửi ngay, ấm áp, xưng em, gọi khách đúng như sale đang gọi, ≤ 60 chữ, có 1 câu hỏi mở hoặc lời mời bước tiếp theo","reply2":"cách trả lời khác, ngắn hơn hoặc hướng khác, ≤ 45 chữ","next":"1–2 việc cụ thể sale nên làm tiếp: lên đơn, hẹn gọi lại giờ nào, gửi cách dùng, hỏi thăm sau khi dùng…, ≤ 40 chữ"}

Quy tắc:
- Dựa vào THÔNG TIN SẢN PHẨM. Không bịa giá, khuyến mãi, công dụng. Không chắc giá / quà thì để sale điền: "[giá]".
- Không bao giờ nói sản phẩm "chữa", "điều trị", "khỏi bệnh", "đặc trị", "thay thuốc". Khách nhắc bệnh, thuốc, mang thai: nhắc nhẹ sản phẩm là thực phẩm, không phải là thuốc, nên hỏi bác sĩ nếu đang điều trị.
- Khách phải chờ lâu: mở đầu bằng lời xin lỗi ngắn.
- Tiếp cận theo LOẠI KHÁCH (20/11/2026):
  · Khách đang không vui (giao chậm, hàng lỗi, dị ứng…): xin lỗi, nhận phần mình, hỏi rõ, hẹn gọi điện ngay. KHÔNG mời mua thêm.
  · Khách cũ: hỏi thăm việc dùng trước (dùng có đều không, thấy thế nào), sau đó mới giới thiệu thêm. Sắp hết / đã hết: nhắc nhẹ, mời đặt lại đúng món khách hay dùng.
  · Khách đã hỏi trước, chưa mua: hỏi lại điều khách còn lo (giá, cách dùng, có hợp không), nhắc ưu đãi nếu có trong THÔNG TIN SẢN PHẨM.
  · Khách mới hỏi mua: hỏi dùng cho ai, đang lo gì (mẹ sau sinh, người lớn tuổi, dân văn phòng, người ăn chay…) rồi gợi ý 1 sản phẩm hợp nhất, báo giá.
  · Khách im sau khi hỏi giá (tin cuối là của sale, đã vài ngày): 1 câu nhắc nhẹ, hỏi còn phân vân gì, không giục, không gửi lại cả bảng giá.
- Chưa có số điện thoại mà khách muốn mua: khéo xin số + địa chỉ để giao hàng.
- Văn tự nhiên như người Việt nhắn Zalo, không sáo rỗng, không dùng emoji quá 1 cái.`;

/* ✍️ Học từ câu sale thật sự gửi (20/11/2026, nguyên tắc "trợ lý AI học từ người sửa"): sau khi bấm ✨, tin đầu tiên bạn ấy gửi khách trong 3 giờ
 * được so với câu gợi ý gần nhất → lưu cặp (gợi ý → câu đã gửi) vào kv ed_zs_<sale> (edlearn.js, riêng từng sale, không ai xem) → lần gợi ý sau học giọng của bạn ấy.
 * Số đo kv zs_aiuse {sale: {sug, sent, same}}: bấm gợi ý bao nhiêu lần, bao nhiêu lần có gửi, bao nhiêu lần gửi y nguyên. */
async function zsUse(x, sale, k) { const m = await kvJson(x.db, 'zs_aiuse', {}); const o = m[sale] || (m[sale] = { sug: 0, sent: 0, same: 0, from: Date.now() }); o[k] = (o[k] || 0) + 1; await kvSet(x.db, 'zs_aiuse', JSON.stringify(m)); }
async function zsLearn(x, sale, uid, text) {
  const sk = 'zsai_sug_' + sale + '_' + uid, raw = await kvGet(x.db, sk); if (!raw) return;
  await kvSet(x.db, sk, '', 1);
  let g = {}; try { g = JSON.parse(raw); } catch (e) { return; }
  const words = t => new Set(edNorm(t).toLowerCase().split(' ')), tw = words(text);
  const sim = t => { const w = words(t); let n = 0; for (const v of w) if (tw.has(v)) n++; return n / Math.max(w.size, tw.size, 1); };
  const best = (g.r || []).map(t => ({ t, s: sim(t) })).sort((a, b) => b.s - a.s)[0]; if (!best) return;
  await zsUse(x, sale, 'sent');
  if (edNorm(best.t) === edNorm(text)) { await zsUse(x, sale, 'same'); return; }
  if (best.s < 0.15 || String(text).length < 8) return; // câu khác hẳn (nhắn chuyện khác) → không coi là sửa gợi ý
  await edAdd(x, 'zs_' + sale, { id: uid, by: g.by || '', ch: 'Zalo riêng', t: g.t || '', ai: best.t, hu: String(text).slice(0, 600) });
}
async function zsLearnBlock(x, sale) {
  const L = ((await kvJson(x.db, 'ed_zs_' + sale, [])) || []).filter(e => e && e.ai && e.hu && e.at > Date.now() - 90 * DAY).slice(0, 5);
  if (!L.length) return '';
  return '# CÁCH BẠN SALE NÀY HAY SỬA GỢI Ý (học giọng: xưng hô, độ dài, chữ hay dùng; KHÔNG chép nội dung)\n' + L.map((e, i) => (i + 1) + '. Gợi ý: "' + String(e.ai).slice(0, 250) + '"\n   Bạn ấy gửi: "' + String(e.hu).slice(0, 250) + '"').join('\n');
}

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
  const lastCust = [...msgs].reverse().find(m => !m.self), silentD = last.self && lastCust ? Math.floor((now - lastCust.ts) / DAY) : 0;
  let kind = /^Khách cũ/.test(prof) ? 'Khách cũ' : /chưa mua/.test(prof) ? 'Khách đã hỏi trước, chưa mua' : 'Khách mới';
  if (msgs.some(m => !m.self && now - m.ts < 3 * DAY && COMPLAIN_RE.test(m.text))) kind = 'Khách đang không vui (phàn nàn)';
  else if (silentD >= 2) kind += ', đã im ' + silentD + ' ngày sau tin của sale';
  const learn = await zsLearnBlock(x, sale);
  const conv = msgs.map(m => (m.self ? 'Sale' : 'Khách') + ' (' + fmtDate(m.ts, 'dd/MM HH:mm') + '): ' + String(m.text).slice(0, 600)).join('\n');
  const wait = !last.self ? ' Khách nhắn cuối lúc ' + fmtDate(last.ts, 'HH:mm dd/MM') + ', đã chờ ' + Math.round((now - last.ts) / 60e3) + ' phút.' : ' Tin cuối là của sale (gợi ý cách nhắn tiếp / chăm sóc tiếp).';
  let res;
  try {
    res = await zsAiClient(x.env).messages.create({
      model: 'claude-haiku-5-5', max_tokens: 3000, output_config: { effort: 'low' }, // 18/11: 700 bị AI dùng hết để suy nghĩ (stop max_tokens, không ra chữ)
      system: [{ type: 'text', text: ZS_RULES }, { type: 'text', text: '# THÔNG TIN SẢN PHẨM\n\n' + await kb(), cache_control: { type: 'ephemeral' } }],
      messages: [{ role: 'user', content: 'Sale: ' + u.name + '. Hôm nay ' + fmtDate(now, 'dd/MM/yyyy HH:mm') + '.' + wait + '\n\n# LOẠI KHÁCH\n' + kind + '\n\n# HỒ SƠ KHÁCH\n' + prof + (learn ? '\n\n' + learn : '') + '\n\n# TIN NHẮN ZALO (cũ → mới)\n' + conv }]
    });
  } catch (e) { console.error('zs ai', e && (e.status || ''), e && e.message); return { ok: false, error: 'Trợ lý chưa trả lời được, thử lại sau ít phút.' }; }
  const t = safe(res.content.filter(b => b.type === 'text').map(b => b.text).join('\n'));
  let j = {}; try { j = JSON.parse((t.match(/\{[\s\S]*\}/) || ['{}'])[0]); } catch (e) { j = {}; }
  const pick = lb => { const m = t.replace(/\*\*/g, '').match(new RegExp(lb + '\\s*:\\s*(.+)', 'i')); return m ? m[1].trim() : ''; }; // dự phòng nếu AI không trả JSON
  const out = { need: String(j.need || pick('KHÁCH CẦN')).trim(), replies: [j.reply1 || pick('TRẢ LỜI 1'), j.reply2 || pick('TRẢ LỜI 2')].map(v => safe(String(v || '').trim())).filter(Boolean), next: String(j.next || pick('NÊN LÀM')).trim() };
  if (!out.replies.length) { console.error('zs ai parse', res.stop_reason, t.slice(0, 300)); return { ok: false, error: 'Trợ lý chưa gợi ý được, thử lại nhé.' }; }
  await kvSet(x.db, k, String(n + 1), 2 * DAY);
  await kvSet(x.db, 'zsai_sug_' + sale + '_' + uid, JSON.stringify({ r: out.replies, by: u.name, t: lastCust ? String(lastCust.text).slice(0, 200) : '' }), 3 * 3600e3); // để học câu bạn ấy thật sự gửi (zsLearn)
  await zsUse(x, sale, 'sug');
  return Object.assign({ ok: true }, out);
}

/* ================================================================ 🛒 Lên đơn từ tin Zalo (18/11/2026 anh Sơn: khách chưa có số / địa chỉ thì lên đơn thế nào?)
 * Haiku đọc 30 tin gần nhất → JSON {phone, name, address, items[{name, qty}], missing[], ask}. Thấy số thì tự gắn vào cuộc trò chuyện
 * (tin Zalo vào đúng hồ sơ khách). Thiếu gì thì "ask" = câu sale chép gửi khách để xin thêm. Lỗi AI → chỉ dò số điện thoại bằng mẫu số. */
async function zsOrder(x, u, d, sale) {
  const uid = String(d.uid || ''); if (!sale || !uid) return { ok: false, error: 'Thiếu cuộc trò chuyện.' };
  const msgs = (await all(x.db, 'SELECT self, text, ts FROM zs_msgs WHERE sale = ? AND uid = ? ORDER BY id DESC LIMIT 30', sale, uid)).reverse();
  if (!msgs.length) return { ok: false, error: 'Chưa có tin nhắn nào.' };
  const th = await first(x.db, 'SELECT phone, zname FROM zs_threads WHERE sale = ? AND uid = ?', sale, uid) || {};
  let phone = th.phone || '';
  if (!phone) for (const m of [...msgs].reverse()) { if (m.self) continue; const g = String(m.text).match(PHONE_RE); if (g) { phone = normPhone(g[0]); break; } }
  const out = { ok: true, phone, name: '', address: '', items: [], ask: '', zname: th.zname || '' };
  const prods = (Array.isArray(d.prods) ? d.prods : []).map(p => String(p).slice(0, 80)).slice(0, 80);
  if (x.env.ANTHROPIC_API_KEY) {
    const k = 'zsai_' + slug(u.name) + '_' + fmtDate(Date.now(), 'yyMMdd'), n = Number(await kvGet(x.db, k) || 0);
    if (n < ZS_AI_MAX) {
      try {
        const res = await zsAiClient(x.env).messages.create({
          model: 'claude-haiku-5-5', max_tokens: 2000, output_config: { effort: 'low' },
          system: 'Bạn đọc tin nhắn Zalo giữa nhân viên bán hàng (Sale) và khách của Thực Dưỡng Lành, lấy thông tin để lên đơn. Chỉ trả về 1 khối JSON, không giải thích:\n{"phone":"số điện thoại nhận hàng (10 số, bắt đầu 0) hoặc rỗng","name":"tên người nhận hoặc rỗng","address":"địa chỉ nhận hàng đầy đủ khách đã gửi hoặc rỗng","items":[{"name":"tên sản phẩm, chọn đúng 1 tên trong DANH SÁCH SẢN PHẨM nếu khớp","qty":1}],"ask":"nếu thiếu số điện thoại, địa chỉ hoặc chưa rõ món: 1 câu ngắn lễ phép (xưng em) để Sale gửi khách xin đúng phần còn thiếu; đủ rồi thì rỗng"}\nChỉ lấy thông tin khách đã viết, không bịa. Sản phẩm chưa rõ thì để items rỗng.',
          messages: [{ role: 'user', content: 'DANH SÁCH SẢN PHẨM: ' + (prods.join(' | ') || '(không có)') + '\nTên Zalo của khách: ' + (th.zname || '') + '\n\nTIN NHẮN (cũ → mới):\n' + msgs.map(m => (m.self ? 'Sale' : 'Khách') + ': ' + String(m.text).slice(0, 500)).join('\n') }]
        });
        await kvSet(x.db, k, String(n + 1), 2 * DAY);
        const t = res.content.filter(b => b.type === 'text').map(b => b.text).join(''), j = JSON.parse((t.match(/\{[\s\S]*\}/) || ['{}'])[0]);
        const ph = normPhone(j.phone || ''); if (/^0\d{9}$/.test(ph)) out.phone = ph;
        out.name = String(j.name || '').slice(0, 60); out.address = String(j.address || '').slice(0, 300); out.ask = safe(String(j.ask || '').slice(0, 300));
        out.items = (Array.isArray(j.items) ? j.items : []).filter(i => i && i.name).slice(0, 6).map(i => ({ name: String(i.name).slice(0, 80), qty: Math.max(1, Math.min(99, Number(i.qty) || 1)) }));
      } catch (e) { console.error('zs order', e && e.message); }
    }
  }
  if (out.phone && out.phone !== th.phone) { // thấy số → gắn vào cuộc trò chuyện để tin Zalo vào đúng hồ sơ khách
    await run(x.db, 'UPDATE zs_threads SET phone = ? WHERE sale = ? AND uid = ?', out.phone, sale, uid);
    await run(x.db, "UPDATE zs_msgs SET phone = ? WHERE sale = ? AND uid = ? AND phone = ''", out.phone, sale, uid);
  }
  const who = await custNameOwner(x, out.phone); out.crm = !!who.name; if (who.name && !out.name) out.name = who.name;
  if (!out.ask) { const miss = [!out.phone && 'số điện thoại', !out.address && !out.crm && 'địa chỉ nhận hàng', !out.items.length && 'sản phẩm và số lượng'].filter(Boolean);
    if (miss.length) out.ask = 'Dạ để em lên đơn cho mình, mình cho em xin ' + miss.join(', ') + ' với ạ.'; }
  return out;
}
