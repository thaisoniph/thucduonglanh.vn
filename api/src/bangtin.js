/* ================================================================ 📣 Bảng tin vui đồng đội (14/11/2026, anh Sơn chọn; 16/11/2026 Phương án A)
 * Một dòng ở đầu màn hình đầu tiên của mỗi người (app.js btCard), nằm yên, 7 giây đổi tin (không chữ chạy).
 * 16/11/2026 (anh Sơn: chị em sale ngại đơn mình hiện cho cả nhóm soi) → KHÔNG còn tin từng đơn có tên người chốt. Tin lấy tự động:
 *  - 🎉 Tin chung cả nhóm: "Hôm nay cả nhà mình đã chốt N đơn" (không tên, không sản phẩm, không tiền). Sáng sớm chưa có đơn thì hiện số hôm qua.
 *  - 🤝 Cả nhóm đạt X% mục tiêu tháng (tổng mục tiêu của người bán đang làm).
 *  - 🌱🔥🏆 "<người> đã đạt 50 / 80 / 100% mục tiêu tháng của mình": tính theo % mục tiêu RIÊNG (người mới mục tiêu nhỏ vẫn được khen),
 *    giờ tin = lúc đơn vượt mốc. Chưa tới mốc thì không có tin gì, nên không ai bị lộ là ít đơn.
 *  - 🏁 "<người> đã chăm sóc xong hết khách hôm nay": app.js gửi bt_done khi danh sách Hôm nay về 0 (mỗi người 1 lần/ngày).
 *  - 💬 Lời khen của khách (14/11/2026): sale tích ⭐ khi ghi chăm sóc, hoặc ghi tay. 3 lời khen mới nhất 30 ngày, tên khách + tỉnh, KHÔNG số điện thoại.
 *  - 🙈 Ai tích "Ẩn tên mình" (bảng bt_hide) thì mọi tin về người đó ghi "Một bạn trong nhóm"; chỉ chính người đó thấy "Bạn".
 * Ai cũng bấm 👏 Chúc mừng được (1 lần / tin), người được chúc thấy số 👏 và tên người chúc. Không dùng AI, không Telegram. */
import { run, all, startOfDay, isVoid, fmtDate, DAY, TZ_MS } from './lib.js';
import { crmUsers } from './crm.js';

const WIN = 36 * 3600e3; // tin trong 36 giờ gần nhất (sáng sớm vẫn thấy tin chiều hôm qua)
const MAX = 12;

let schemaOk = false;
async function schema(db) {
  if (schemaOk) return;
  await run(db, `CREATE TABLE IF NOT EXISTS bt_event (day TEXT, email TEXT, name TEXT DEFAULT '', kind TEXT DEFAULT 'done', n INTEGER DEFAULT 0, at INTEGER, PRIMARY KEY (day, email, kind))`);
  await run(db, `CREATE TABLE IF NOT EXISTS bt_praise (id INTEGER PRIMARY KEY AUTOINCREMENT, at INTEGER, phone TEXT DEFAULT '', cname TEXT DEFAULT '', prov TEXT DEFAULT '', text TEXT, by_email TEXT, by_name TEXT DEFAULT '', del INTEGER DEFAULT 0)`);
  await run(db, `CREATE TABLE IF NOT EXISTS bt_clap (k TEXT, email TEXT, name TEXT DEFAULT '', at INTEGER, PRIMARY KEY (k, email))`);
  await run(db, `CREATE TABLE IF NOT EXISTS bt_hide (name TEXT PRIMARY KEY, email TEXT DEFAULT '', at INTEGER)`); // 🙈 ẩn tên mình trên Tin vui (16/11/2026)
  schemaOk = true;
}

const MILES = [[50, '🌱', 'đã đạt 50% mục tiêu tháng của mình, cố lên nhé!'], [80, '🔥', 'đã đạt 80% mục tiêu tháng của mình, sắp về đích rồi!'], [100, '🏆', 'đã hoàn thành 100% mục tiêu tháng của mình 🎉']];
const SOMEONE = 'Một bạn trong nhóm';
/** Mã ngắn thay cho tên / email trong khoá tin (khoá gửi về máy mọi người: không để lộ ai là "Một bạn trong nhóm"). */
function hk(v) { let h = 2166136261; for (const c of String(v || '')) { h ^= c.codePointAt(0); h = Math.imul(h, 16777619); } return (h >>> 0).toString(36); }

export async function btFeed(x, u) {
  await schema(x.db);
  const now = Date.now(), since = now - WIN;
  const vn = new Date(now + TZ_MS), y = vn.getUTCFullYear(), mo = vn.getUTCMonth(), m0 = Date.UTC(y, mo, 1) - TZ_MS, mk = y + '-' + (mo < 9 ? '0' : '') + (mo + 1);
  const t0 = startOfDay(now), y0 = t0 - DAY, from = Math.min(m0, y0);
  const [ords, tg, hid, us] = await Promise.all([
    all(x.db, "SELECT time, seller, total, status FROM orders WHERE time >= ? AND time <= ? AND coalesce(seller, '') != '' ORDER BY time", from, now + 3600e3),
    all(x.db, 'SELECT name, amount FROM targets WHERE month = ?', mk).catch(() => []),
    all(x.db, 'SELECT name FROM bt_hide'),
    crmUsers(x)]);
  const hide = {}; hid.forEach(h => { hide[h.name] = 1; });
  const shown = n => hide[n] && n !== u.name ? SOMEONE : n; // 🙈 người ẩn tên: người khác thấy "Một bạn trong nhóm"
  const items = [];
  const ok = ords.filter(o => !isVoid(o.status)); // đơn web chưa ai xác nhận (không có người bán) không tính
  // 🎉 Tin chung cả nhóm: không tên, không sản phẩm, không tiền
  const today = ok.filter(o => o.time >= t0), yday = ok.filter(o => o.time >= y0 && o.time < t0);
  if (today.length) items.push({ k: 'tm' + fmtDate(now, 'yyyy-MM-dd'), at: today[today.length - 1].time, who: '', ic: '🎉', t: 'Hôm nay cả nhà mình đã chốt ' + today.length + ' đơn, cùng cố lên nhé!' });
  else if (yday.length) items.push({ k: 'tm' + fmtDate(y0, 'yyyy-MM-dd'), at: yday[yday.length - 1].time, who: '', ic: '🎉', t: 'Hôm qua cả nhà mình đã chốt ' + yday.length + ' đơn. Hôm nay mình cùng cố lên nhé!' });
  // 🤝 + 🌱🔥🏆 mốc mục tiêu tháng (theo % mục tiêu riêng của từng người, như bảng thi đua)
  const sellers = {}; us.filter(v => v.active && v.level >= 1 && v.level < 3).forEach(v => { sellers[v.name] = 1; });
  const tgt = {}; tg.forEach(t => { if (sellers[t.name] && Number(t.amount) > 0) tgt[t.name] = Number(t.amount); });
  const month = ok.filter(o => o.time >= m0), sum = {};
  let teamSum = 0;
  for (const o of month) {
    const v = Number(o.total) || 0, n = o.seller;
    if (tgt[n] !== undefined) teamSum += v;
    if (!tgt[n]) continue;
    const before = sum[n] || 0, after = before + v; sum[n] = after;
    for (const [p, ic, txt] of MILES) {
      if (before * 100 < tgt[n] * p && after * 100 >= tgt[n] * p && o.time > since) {
        const w = shown(n);
        items.push({ k: 'm' + p + ':' + mk + ':' + hk(n), at: o.time, who: w === SOMEONE ? '' : n, me0: n === u.name, ic, t: w + ' ' + txt });
      }
    }
  }
  const teamT = Object.values(tgt).reduce((s, v) => s + v, 0);
  if (teamT > 0 && teamSum > 0) {
    const pc = Math.floor(teamSum * 100 / teamT), dIn = Math.floor((t0 - m0) / DAY) + 1;
    items.push({ k: 'tg' + mk + ':' + Math.floor(pc / 10), at: month[month.length - 1].time - 1, who: '', ic: '🤝', t: 'Cả nhóm đã đi được ' + pc + '% mục tiêu tháng ' + (mo + 1) + ' (ngày ' + dIn + ' của tháng). Mình cùng nhau về đích nhé!' });
  }
  const evs = await all(x.db, 'SELECT day, email, name, kind, n, at FROM bt_event WHERE at > ? ORDER BY at DESC LIMIT 30', since);
  for (const e of evs) items.push({ k: 'd' + e.day + ':' + hk(e.email), at: e.at, who: shown(e.name) === SOMEONE ? '' : e.name, me0: e.name === u.name, ic: '🏁', t: shown(e.name) + ' đã chăm sóc xong hết ' + (e.n ? e.n + ' khách' : 'khách') + ' hôm nay' + (e.day !== fmtDate(now, 'yyyy-MM-dd') ? ' (hôm qua)' : '') });
  items.sort((a, b) => b.at - a.at);
  const pr = await all(x.db, 'SELECT id, at, cname, prov, text, by_email, by_name FROM bt_praise WHERE del = 0 AND at > ? ORDER BY at DESC LIMIT 3', now - 30 * DAY);
  const praise = pr.map(p => ({ k: 'p' + p.id, id: p.id, at: p.at, who: shown(p.by_name) === SOMEONE ? '' : p.by_name, me0: p.by_name === u.name, ic: '💬', pr: 1, t: (p.cname || 'Khách') + (p.prov ? ' (' + p.prov + ')' : '') + ': “' + p.text + '”' + (p.by_name && shown(p.by_name) !== SOMEONE ? ' · cảm ơn ' + p.by_name : ''), del: p.by_email === u.email || u.level >= 2 }));
  const list = praise.filter(p => now - p.at < WIN).concat(items).sort((a, b) => b.at - a.at).slice(0, MAX); // lời khen trong 36 giờ xếp theo giờ như tin khác
  praise.filter(p => now - p.at >= WIN).forEach((p, i) => list.splice(Math.min(list.length, 1 + i * 2), 0, p)); // lời khen cũ hơn (≤ 30 ngày) xen vào sau tin mới nhất, để ngày nào cũng có
  if (list.length > MAX) list.length = MAX;
  const keys = list.map(i => i.k), claps = keys.length ? await all(x.db, `SELECT k, email, name FROM bt_clap WHERE k IN (${keys.map(() => '?').join(',')})`, ...keys) : [];
  list.forEach(i => {
    const cs = claps.filter(c => c.k === i.k);
    i.n = cs.length; i.mine = cs.some(c => c.email === u.email); i.me = !!i.me0; delete i.me0;
    if (i.me) i.by = cs.map(c => c.name); // người được chúc mới thấy tên ai chúc
  });
  return { ok: true, bt: { items: list, at: now, day0: startOfDay(now), hide: !!hide[u.name] } };
}

/** 💬 Ghi lời khen của khách. d.phone (từ hộp chăm sóc) → tự lấy tên + tỉnh khách; không có số thì dùng d.cname / d.prov ghi tay. */
export async function btPraise(x, u, d) {
  await schema(x.db);
  const text = String(d.text || '').replace(/\s+/g, ' ').trim().slice(0, 240);
  if (text.length < 4) return { ok: false, error: 'Bạn ghi lời khen của khách giúp nhé.' };
  const ph = String(d.phone || '').replace(/\D/g, '').slice(0, 15);
  let cname = String(d.cname || '').trim().slice(0, 60), prov = String(d.prov || '').trim().slice(0, 40);
  if (ph) { const [c] = await all(x.db, 'SELECT name, province FROM customers WHERE phone = ?', ph); if (c) { cname = cname || c.name || ''; prov = prov || c.province || ''; } }
  await run(x.db, 'INSERT INTO bt_praise (at, phone, cname, prov, text, by_email, by_name) VALUES (?, ?, ?, ?, ?, ?, ?)', Date.now(), ph, cname, prov, text, u.email, u.name);
  return btFeed(x, u);
}

/** Ẩn lời khen (người ghi hoặc Quản lý trở lên). */
export async function btPdel(x, u, d) {
  await schema(x.db);
  const [p] = await all(x.db, 'SELECT by_email FROM bt_praise WHERE id = ?', Number(d.id) || 0);
  if (!p) return { ok: false, error: 'Không thấy lời khen này.' };
  if (u.level < 2 && p.by_email !== u.email) return { ok: false, error: 'Chỉ người ghi hoặc Quản lý ẩn được.' };
  await run(x.db, 'UPDATE bt_praise SET del = 1 WHERE id = ?', Number(d.id));
  return btFeed(x, u);
}

/** 🏁 Tự gửi khi người dùng chăm sóc xong hết khách hôm nay (mỗi người 1 lần / ngày). */
export async function btDone(x, u, d) {
  await schema(x.db);
  const n = Math.max(0, Math.min(500, Number(d.n) || 0));
  if (n) await run(x.db, `INSERT INTO bt_event (day, email, name, kind, n, at) VALUES (?, ?, ?, 'done', ?, ?) ON CONFLICT(day, email, kind) DO NOTHING`, fmtDate(Date.now(), 'yyyy-MM-dd'), u.email, u.name, n, Date.now());
  return btFeed(x, u);
}

/** 🙈 Ẩn / hiện tên mình trên Tin vui (16/11/2026). */
export async function btHide(x, u, d) {
  await schema(x.db);
  if (d.on) await run(x.db, 'INSERT INTO bt_hide (name, email, at) VALUES (?, ?, ?) ON CONFLICT(name) DO NOTHING', u.name, u.email, Date.now());
  else await run(x.db, 'DELETE FROM bt_hide WHERE name = ?', u.name);
  return btFeed(x, u);
}

/** 👏 Chúc mừng 1 tin (1 lần / người / tin, không tự chúc mình). */
export async function btClap(x, u, d) {
  await schema(x.db);
  const k = String(d.k || '').slice(0, 120);
  if (k && d.who !== u.name && !k.endsWith(':' + hk(u.name)) && !k.endsWith(':' + hk(u.email))) await run(x.db, 'INSERT INTO bt_clap (k, email, name, at) VALUES (?, ?, ?, ?) ON CONFLICT(k, email) DO NOTHING', k, u.email, u.name, Date.now());
  return btFeed(x, u);
}

export async function crmBt(x, u, d) {
  const a = d.action;
  if (a === 'bt_feed') return btFeed(x, u);
  if (a === 'bt_done') return btDone(x, u, d);
  if (a === 'bt_clap') return btClap(x, u, d);
  if (a === 'bt_praise') return btPraise(x, u, d);
  if (a === 'bt_pdel') return btPdel(x, u, d);
  if (a === 'bt_hide') return btHide(x, u, d);
  return { ok: false, error: 'Không rõ thao tác: ' + a };
}
