/* ================================================================ 👀 Giám sát Zalo của sale (15/11/2026, anh Sơn)
 * Mục đích: Quản lý / Quản trị xem được sale đang nhắn Zalo chăm sóc khách như thế nào, mà KHÔNG đổi thói quen của sale
 *   (sale vẫn dùng Zalo trên điện thoại + Zalo PC như cũ). Mỗi sale 1 số Zalo riêng công ty cấp.
 * Cách làm: chương trình "người đọc" (zalo-bot/sale-reader.js, thư viện zca-js) đăng nhập tài khoản Zalo của sale ở chỗ
 *   "Zalo Web" (anh Sơn đã thử 14/11: điện thoại + Zalo PC + Zalo Web chạy song song cùng lúc được) và CHỈ ĐỌC – không bao
 *   giờ gửi tin. Mỗi tin nhắn riêng (1–1) giữa sale và khách được gửi về đây:
 *   { type:'zsale', key:ZSALE_KEY, ev, sale, name, phone, uid, zname, self, text, msgId, ts }
 *     poll  – 60 giây/lần: báo còn chạy (+ hồ sơ tài khoản) → trả cài đặt { on, replyMins }
 *     msg   – 1 tin nhắn riêng (self = 1 nếu do chính sale gửi, 0 nếu của khách)
 *     login – tài khoản bị đăng xuất, cần quét lại mã QR → báo Telegram
 * Chỉ nghe tin nhắn RIÊNG (ThreadType.User). Không đụng nhóm, không gửi, không thả tim. Rủi ro Zalo khoá thấp vì chỉ đọc.
 * Quyền xem: Quản lý + Quản trị (u.level >= 2). Sale không xem Zalo của sale khác.
 * Pháp luật (Luật BVDLCN 91/2025): Zalo công ty cấp cho sale dùng cho công việc; cần ghi nội quy + cho sale ký đồng ý
 *   lưu lại hội thoại công việc để kiểm tra chất lượng (xem guide/zalo-sale.md). Tin tự xoá sau 12 tháng (dọn ở cron). */
import { esc, run, all, first, kvGet, kvSet, kvJson, normPhone, fmtDate, CRM_URL, TZ_MS, DAY } from './lib.js';
import { telegram } from './google.js';
import { telegramUser } from './crm.js';

const CFG0 = { on: true, replyMins: 30 }; // replyMins: khách nhắn quá bao nhiêu phút chưa ai trả lời thì báo Telegram
const RETAIN_DAYS = 365; // giữ tin tối đa 12 tháng rồi tự xoá
const vnHour = t => { const d = new Date(t + TZ_MS); return d.getUTCHours() + d.getUTCMinutes() / 60; };
const workNow = t => { const h = vnHour(t); return h >= 8 && h < 21; }; // chỉ báo "chưa trả lời" trong giờ làm (8h–21h)
const dayStartVn = t => Math.floor((t + TZ_MS) / DAY) * DAY - TZ_MS;
const PHONE_RE = /(?:\+?84|0)(?:[\s.\-]?\d){9}(?!\d)/;

export async function zsaleSchema(db) {
  await run(db, `CREATE TABLE IF NOT EXISTS zs_msgs (id INTEGER PRIMARY KEY AUTOINCREMENT, mid TEXT, sale TEXT, uid TEXT,
    phone TEXT DEFAULT '', self INTEGER DEFAULT 0, text TEXT DEFAULT '', ts INTEGER, at INTEGER)`); // 1 dòng = 1 tin nhắn riêng
  await run(db, 'CREATE UNIQUE INDEX IF NOT EXISTS zs_msgs_mid ON zs_msgs(mid)'); // tránh lưu trùng khi chương trình gửi lại
  await run(db, 'CREATE INDEX IF NOT EXISTS zs_msgs_thread ON zs_msgs(sale, uid, id)');
  await run(db, 'CREATE INDEX IF NOT EXISTS zs_msgs_phone ON zs_msgs(phone, id)');
  await run(db, `CREATE TABLE IF NOT EXISTS zs_threads (sale TEXT, uid TEXT, phone TEXT DEFAULT '', zname TEXT DEFAULT '',
    last_cust INTEGER DEFAULT 0, last_sale INTEGER DEFAULT 0, n INTEGER DEFAULT 0, cust_n INTEGER DEFAULT 0,
    alerted INTEGER DEFAULT 0, at INTEGER, PRIMARY KEY (sale, uid))`); // mỗi cuộc trò chuyện sale ↔ khách
  await run(db, 'CREATE INDEX IF NOT EXISTS zs_threads_phone ON zs_threads(phone)');
  await run(db, 'CREATE INDEX IF NOT EXISTS zs_threads_wait ON zs_threads(last_cust)');
  await run(db, `CREATE TABLE IF NOT EXISTS zs_sale (sale TEXT PRIMARY KEY, name TEXT DEFAULT '', phone TEXT DEFAULT '',
    uid TEXT DEFAULT '', ver TEXT DEFAULT '', at INTEGER, down INTEGER DEFAULT 0)`); // trạng thái từng người đọc (1 sale = 1 tài khoản)
}

export async function zsCfg(x) { return Object.assign({}, CFG0, await kvJson(x.db, 'zs_cfg', {})); }

/* ---------------------------------------------------------------- điều phối (index.js gọi khi type === 'zsale') */
export async function zsale(x, d) {
  if (!x.env.ZSALE_KEY || d.key !== x.env.ZSALE_KEY) return { ok: false, error: 'key' };
  const h = { poll: zsPoll, msg: zsMsg, login: zsLogin }[d.ev];
  return h ? await h(x, d) : { ok: false, error: 'ev' };
}

async function zsPoll(x, d) {
  const now = Date.now(), sale = String(d.sale || '').slice(0, 40);
  if (!sale) return { ok: false, error: 'sale' };
  const me = d.me || {}, was = await first(x.db, 'SELECT down FROM zs_sale WHERE sale = ?', sale);
  await run(x.db, `INSERT INTO zs_sale (sale, name, phone, uid, ver, at, down) VALUES (?, ?, ?, ?, ?, ?, 0)
    ON CONFLICT(sale) DO UPDATE SET name = excluded.name, phone = excluded.phone, uid = excluded.uid, ver = excluded.ver, at = excluded.at, down = 0`,
    sale, String(d.name || me.name || '').slice(0, 80), normPhone(me.phone || ''), String(me.uid || ''), String(d.ver || ''), now);
  if (was && was.down) x.later(telegram(x.env, '✅ <b>Người đọc Zalo của sale đã chạy lại</b>: ' + esc(String(d.name || sale))));
  const cfg = await zsCfg(x);
  return { ok: true, cfg: { on: cfg.on !== false, replyMins: cfg.replyMins } };
}

async function zsMsg(x, d) {
  const cfg = await zsCfg(x);
  if (cfg.on === false) return { ok: true, off: 1 };
  const sale = String(d.sale || '').slice(0, 40), uid = String(d.uid || '');
  if (!sale || !uid) return { ok: false, error: 'thiếu sale/uid' };
  const self = d.self ? 1 : 0, ts = Number(d.ts) || Date.now(), now = Date.now();
  const text = String(d.text || '').slice(0, 4000), zname = String(d.zname || '').slice(0, 80);
  let phone = normPhone(d.phone || '');
  if (!phone && !self) { const m = text.match(PHONE_RE); if (m) phone = normPhone(m[0]); } // khách tự gõ số trong tin → nhận ra khách
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
    if (ph && !th.phone) await run(x.db, "UPDATE zs_msgs SET phone = ? WHERE sale = ? AND uid = ? AND phone = ''", ph, sale, uid); // vừa biết số → gắn cho các tin cũ cùng cuộc
  }
  return { ok: true };
}

async function zsLogin(x, d) {
  const sale = String(d.sale || '').slice(0, 40), k = 'zs_login_' + sale + '_' + fmtDate(Date.now(), 'yyMMddHH');
  if (!await kvGet(x.db, k)) {
    await kvSet(x.db, k, '1', 2 * 3600e3);
    await telegram(x.env, '⚠️ <b>Người đọc Zalo của sale bị đăng xuất</b>: ' + esc(String(d.name || sale)) + (d.reason ? ' (' + esc(String(d.reason).slice(0, 120)) + ')' : '') + '\n👉 Mở máy đang chạy, quét lại mã QR bằng Zalo của sale này (xem zalo-bot/README.md).');
  }
  return { ok: true };
}

/* ---------------------------------------------------------------- cron: báo khách chưa được trả lời + báo mất kết nối + dọn tin cũ */
export async function zsaleTick(x) {
  const cfg = await zsCfg(x); if (cfg.on === false) return;
  const now = Date.now();
  // người đọc im lặng > 20 phút → báo 1 lần
  for (const s of await all(x.db, 'SELECT sale, name, at, down FROM zs_sale')) {
    if (!s.down && s.at && now - s.at > 20 * 60e3) {
      await run(x.db, 'UPDATE zs_sale SET down = 1 WHERE sale = ?', s.sale);
      await telegram(x.env, '⚠️ <b>Người đọc Zalo của sale mất kết nối</b>: ' + esc(s.name || s.sale) + ' (từ ' + fmtDate(s.at, 'HH:mm dd/MM') + ').\n👉 Kiểm tra máy đang chạy (bật máy, có mạng).');
    }
  }
  if (!workNow(now)) return; // chỉ nhắc "chưa trả lời" trong giờ làm
  const mins = Math.max(5, Number(cfg.replyMins) || 30), cut = now - mins * 60e3;
  const wait = await all(x.db, 'SELECT sale, uid, phone, zname, last_cust FROM zs_threads WHERE last_cust > last_sale AND last_cust < ? AND last_cust > ? AND alerted = 0 ORDER BY last_cust LIMIT 60', cut, now - 6 * 3600e3);
  if (!wait.length) return;
  const names = {}; for (const s of await all(x.db, 'SELECT sale, name FROM zs_sale')) names[s.sale] = s.name || s.sale;
  for (const w of wait) w.who = await custNameOwner(x, w.phone);
  const bySale = {}; for (const w of wait) (bySale[w.sale] || (bySale[w.sale] = [])).push(w);
  for (const [sale, list] of Object.entries(bySale)) {
    const lines = list.map(w => '• ' + esc(w.who.name || w.zname || 'Khách') + (w.phone ? ' – ' + esc(w.phone) : '') + ' · chờ ' + Math.round((now - w.last_cust) / 60e3) + ' phút' + (w.who.owner ? ' · 👤' + esc(w.who.owner) : ''));
    await telegram(x.env, '💬 <b>Khách nhắn Zalo chưa được trả lời</b> – ' + esc(names[sale] || sale) + ' (' + list.length + ')\n' + lines.join('\n') + '\n\n👉 Xem trong CRM: ' + CRM_URL + '/#zalo-sale');
    // báo riêng cho sale phụ trách khách (nếu biết)
    const owners = {}; for (const w of list) if (w.who.owner) owners[w.who.owner] = (owners[w.who.owner] || 0) + 1;
    for (const [owner, n] of Object.entries(owners)) await telegramUser(x, owner, '💬 Có <b>' + n + '</b> khách nhắn Zalo đang chờ bạn trả lời. Xem CRM: ' + CRM_URL + '/#zalo-sale');
    await run(x.db, "UPDATE zs_threads SET alerted = 1 WHERE sale = ? AND uid IN (SELECT value FROM json_each(?))", sale, JSON.stringify(list.map(w => w.uid)));
  }
  if (Math.random() < 0.05) await run(x.db, 'DELETE FROM zs_msgs WHERE at < ?', now - RETAIN_DAYS * DAY); // dọn tin cũ > 12 tháng
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
  if (a === 'zs_cfg') { // chỉ Quản trị đổi cài đặt (bật/tắt, số phút nhắc)
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
  const now = Date.now(), cfg = await zsCfg(x), day0 = dayStartVn(now);
  const sales = (await all(x.db, 'SELECT sale, name, phone, at, down FROM zs_sale ORDER BY name')).map(s => ({
    sale: s.sale, name: s.name || s.sale, phone: s.phone || '', lastSeen: s.at || 0,
    online: !!(s.at && now - s.at < 5 * 60e3 && !s.down)
  }));
  // khách đang chờ trả lời (khách nhắn sau cùng, trong 24h)
  const waitRows = await all(x.db, 'SELECT sale, uid, phone, zname, last_cust, last_sale, cust_n FROM zs_threads WHERE last_cust > last_sale AND last_cust > ? ORDER BY last_cust LIMIT 60', now - DAY);
  const saleNm = {}; sales.forEach(s => saleNm[s.sale] = s.name);
  const waiting = [];
  for (const w of waitRows) { const who = await custNameOwner(x, w.phone); waiting.push({ sale: w.sale, saleName: saleNm[w.sale] || w.sale, uid: w.uid, phone: w.phone, name: who.name || w.zname || 'Khách', owner: who.owner || '', mins: Math.round((now - w.last_cust) / 60e3) }); }
  // thống kê hôm nay từng sale
  const today = await all(x.db, 'SELECT sale, uid, self, ts FROM zs_msgs WHERE ts >= ? LIMIT 20000', day0);
  const stat = {}; const S = s => stat[s] || (stat[s] = { threads: {}, cust: 0, reply: 0, gaps: [] });
  const seq = {}; // theo cuộc: khách nhắn lúc nào, chờ sale trả lời → đo thời gian trả lời lần đầu
  today.sort((a, b) => a.ts - b.ts);
  for (const m of today) {
    const st = S(m.sale); st.threads[m.uid] = 1;
    const k = m.sale + '|' + m.uid;
    if (m.self) { st.reply++; if (seq[k]) { st.gaps.push(m.ts - seq[k]); seq[k] = 0; } }
    else { st.cust++; if (!seq[k]) seq[k] = m.ts; }
  }
  const perSale = sales.map(s => { const st = stat[s.sale] || { threads: {}, cust: 0, reply: 0, gaps: [] }; const g = st.gaps; return {
    sale: s.sale, name: s.name, online: s.online, threads: Object.keys(st.threads).length, cust: st.cust, reply: st.reply,
    avgMin: g.length ? Math.round(g.reduce((a, b) => a + b, 0) / g.length / 60e3) : null, waiting: waiting.filter(w => w.sale === s.sale).length }; });
  // cuộc trò chuyện gần đây (mọi sale) để mở nhanh
  const recent = await all(x.db, 'SELECT sale, uid, phone, zname, last_cust, last_sale, n FROM zs_threads ORDER BY max(last_cust, last_sale) DESC LIMIT 40');
  const recentOut = [];
  for (const r of recent) { const who = await custNameOwner(x, r.phone); recentOut.push({ sale: r.sale, saleName: saleNm[r.sale] || r.sale, uid: r.uid, phone: r.phone, name: who.name || r.zname || 'Khách', owner: who.owner || '', n: r.n, last: Math.max(r.last_cust, r.last_sale), wait: r.last_cust > r.last_sale }); }
  return { ok: true, admin: u.level >= 3, cfg: { on: cfg.on !== false, replyMins: cfg.replyMins }, sales, perSale, waiting, recent: recentOut };
}

async function zsThread(x, d) {
  const sale = String(d.sale || ''), uid = String(d.uid || ''), phone = normPhone(d.phone || '');
  let rows;
  if (sale && uid) rows = await all(x.db, 'SELECT sale, self, text, ts FROM zs_msgs WHERE sale = ? AND uid = ? ORDER BY id DESC LIMIT 300', sale, uid);
  else if (phone) rows = await all(x.db, 'SELECT sale, self, text, ts FROM zs_msgs WHERE phone = ? ORDER BY id DESC LIMIT 300', phone);
  else return { ok: false, error: 'thiếu khoá' };
  const saleNm = {}; for (const s of await all(x.db, 'SELECT sale, name FROM zs_sale')) saleNm[s.sale] = s.name || s.sale;
  const msgs = rows.reverse().map(r => ({ self: !!r.self, text: r.text, ts: r.ts, saleName: saleNm[r.sale] || r.sale }));
  const who = await custNameOwner(x, phone || (await first(x.db, 'SELECT phone FROM zs_threads WHERE sale = ? AND uid = ?', sale, uid) || {}).phone || '');
  return { ok: true, msgs, name: who.name, owner: who.owner };
}
