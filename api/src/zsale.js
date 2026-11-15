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
 * Pháp luật (Luật 91/2025): Zalo công ty cấp cho công việc; ghi nội quy + cho sale ký đồng ý lưu hội thoại. Tin giữ 12 tháng. */
import { esc, run, all, first, kvGet, kvSet, kvJson, normPhone, fmtDate, CRM_URL, TZ_MS, DAY } from './lib.js';
import { telegram } from './google.js';
import { telegramUser } from './crm.js';

const CFG0 = { on: true, replyMins: 30 };
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
  for (const [sale, list] of Object.entries(bySale)) {
    const lines = list.map(w => '• ' + esc(w.who.name || w.zname || 'Khách') + (w.phone ? ' – ' + esc(w.phone) : '') + ' · chờ ' + Math.round((now - w.last_cust) / 60e3) + ' phút' + (w.who.owner ? ' · 👤' + esc(w.who.owner) : ''));
    await telegram(x.env, '💬 <b>Khách nhắn Zalo chưa được trả lời</b> – ' + esc(names[sale] || sale) + ' (' + list.length + ')\n' + lines.join('\n') + '\n\n👉 Xem trong CRM: ' + CRM_URL + '/#zalo-sale');
    const owners = {}; for (const w of list) if (w.who.owner) owners[w.who.owner] = (owners[w.who.owner] || 0) + 1;
    for (const [owner, n] of Object.entries(owners)) await telegramUser(x, owner, '💬 Có <b>' + n + '</b> khách nhắn Zalo đang chờ bạn trả lời. Xem CRM: ' + CRM_URL + '/#zalo-sale');
    await run(x.db, "UPDATE zs_threads SET alerted = 1 WHERE sale = ? AND uid IN (SELECT value FROM json_each(?))", sale, JSON.stringify(list.map(w => w.uid)));
  }
  if (Math.random() < 0.05) await run(x.db, 'DELETE FROM zs_msgs WHERE at < ?', now - RETAIN_DAYS * DAY);
}

async function custNameOwner(x, phone) {
  if (!phone) return { name: '', owner: '' };
  const c = await first(x.db, 'SELECT name, owner FROM customers WHERE phone = ?', phone);
  if (c) return { name: c.name || '', owner: c.owner || '' };
  const l = await first(x.db, 'SELECT name, owner FROM leads WHERE phone = ? ORDER BY rid DESC LIMIT 1', phone);
  return l ? { name: l.name || '', owner: l.owner || '' } : { name: '', owner: '' };
}

/* ================================================================ CRM → tab 👀 Zalo của sale (Quản lý, Quản trị) */
export async function crmZsale(x, u, d, crmLog) {
  if (u.level < 2) return { ok: false, error: 'Chỉ Quản lý và Quản trị xem được Zalo của sale.' };
  const a = d.action, now = Date.now();
  if (a === 'zs_view') return zsView(x, u);
  if (a === 'zs_thread') return zsThread(x, d);
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
    await kvSet(x.db, 'zs_cfg', JSON.stringify(cfg));
    if (crmLog) await crmLog(x, u, 'Cài đặt Zalo sale', '-', '', (cfg.on ? 'Bật' : 'Tắt') + ' · nhắc sau ' + cfg.replyMins + ' phút', '');
    return { ok: true, cfg };
  }
  return { ok: false, error: 'Không rõ thao tác: ' + a };
}

async function zsView(x, u) {
  const now = Date.now(), cfg = await zsCfg(x), day0 = dayStartVn(now), accounts = await zsAccounts(x);
  const live = {}; for (const s of await all(x.db, 'SELECT sale, name, phone, at, down, live FROM zs_sale')) live[s.sale] = s;
  // tài khoản đang theo dõi (want) + trạng thái
  const sales = Object.entries(accounts).filter(([, a]) => a.want).map(([sale, a]) => {
    const s = live[sale] || {};
    return { sale, name: a.name || (s.name) || sale, phone: s.phone || '', on: !!a.on, online: !!(s.live && s.at && now - s.at < 5 * 60e3 && !s.down), pairing: !a.on };
  });
  const saleNm = {}; sales.forEach(s => saleNm[s.sale] = s.name);
  // khách đang chờ trả lời
  const waitRows = await all(x.db, 'SELECT sale, uid, phone, zname, last_cust, last_sale FROM zs_threads WHERE last_cust > last_sale AND last_cust > ? ORDER BY last_cust LIMIT 60', now - DAY);
  const waiting = [];
  for (const w of waitRows) { const who = await custNameOwner(x, w.phone); waiting.push({ sale: w.sale, saleName: saleNm[w.sale] || w.sale, uid: w.uid, phone: w.phone, name: who.name || w.zname || 'Khách', owner: who.owner || '', mins: Math.round((now - w.last_cust) / 60e3) }); }
  // thống kê hôm nay từng sale
  const today = await all(x.db, 'SELECT sale, uid, self, ts FROM zs_msgs WHERE ts >= ? LIMIT 20000', day0);
  const stat = {}; const S = s => stat[s] || (stat[s] = { threads: {}, cust: 0, reply: 0, gaps: [] }); const seq = {};
  today.sort((a, b) => a.ts - b.ts);
  for (const m of today) { const st = S(m.sale); st.threads[m.uid] = 1; const k = m.sale + '|' + m.uid;
    if (m.self) { st.reply++; if (seq[k]) { st.gaps.push(m.ts - seq[k]); seq[k] = 0; } } else { st.cust++; if (!seq[k]) seq[k] = m.ts; } }
  const perSale = sales.map(s => { const st = stat[s.sale] || { threads: {}, cust: 0, reply: 0, gaps: [] }; const g = st.gaps; return {
    sale: s.sale, name: s.name, on: s.on, online: s.online, threads: Object.keys(st.threads).length, cust: st.cust, reply: st.reply,
    avgMin: g.length ? Math.round(g.reduce((a, b) => a + b, 0) / g.length / 60e3) : null, waiting: waiting.filter(w => w.sale === s.sale).length }; });
  const recent = await all(x.db, 'SELECT sale, uid, phone, zname, last_cust, last_sale, n FROM zs_threads ORDER BY max(last_cust, last_sale) DESC LIMIT 40');
  const recentOut = [];
  for (const r of recent) { const who = await custNameOwner(x, r.phone); recentOut.push({ sale: r.sale, saleName: saleNm[r.sale] || r.sale, uid: r.uid, phone: r.phone, name: who.name || r.zname || 'Khách', owner: who.owner || '', n: r.n, last: Math.max(r.last_cust, r.last_sale), wait: r.last_cust > r.last_sale }); }
  // chương trình giữ Zalo đã cài & đang chạy chưa (poll gần đây) → để CRM biết hiện nút Kết nối hay hướng dẫn cài 1 lần
  const hostAt = Number(await kvGet(x.db, 'zs_host_at')) || 0;
  const hostOn = now - hostAt < 5 * 60e3 || Object.keys(accounts).length > 0;
  return { ok: true, admin: u.level >= 3, hostOn, cfg: { on: cfg.on !== false, replyMins: cfg.replyMins }, sales, perSale, waiting, recent: recentOut };
}

async function zsThread(x, d) {
  const sale = slug(d.sale), uid = String(d.uid || ''), phone = normPhone(d.phone || '');
  let rows;
  if (sale && uid) rows = await all(x.db, 'SELECT sale, self, text, ts FROM zs_msgs WHERE sale = ? AND uid = ? ORDER BY id DESC LIMIT 300', sale, uid);
  else if (phone) rows = await all(x.db, 'SELECT sale, self, text, ts FROM zs_msgs WHERE phone = ? ORDER BY id DESC LIMIT 300', phone);
  else return { ok: false, error: 'thiếu khoá' };
  const saleNm = {}; for (const s of await all(x.db, 'SELECT sale, name FROM zs_sale')) saleNm[s.sale] = s.name || s.sale;
  const msgs = rows.reverse().map(r => ({ self: !!r.self, text: r.text, ts: r.ts, saleName: saleNm[r.sale] || r.sale }));
  const who = await custNameOwner(x, phone || (await first(x.db, 'SELECT phone FROM zs_threads WHERE sale = ? AND uid = ?', sale, uid) || {}).phone || '');
  return { ok: true, msgs, name: who.name, owner: who.owner };
}
