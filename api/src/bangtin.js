/* ================================================================ 📣 Bảng tin vui đồng đội (14/11/2026, anh Sơn chọn)
 * Một dòng ở đầu màn hình đầu tiên của mỗi người (app.js btCard), nằm yên, 7 giây đổi tin (không chữ chạy).
 * Tin lấy tự động, không ai phải nhập:
 *  - 🎉 "<sale> vừa chốt đơn <sản phẩm>": đơn 36 giờ qua có người bán, không huỷ / hoàn. KHÔNG ghi số tiền (giữ tinh thần thi đua bớt so tiền 17/10).
 *  - 🏁 "<người> đã chăm sóc xong hết khách hôm nay": app.js gửi bt_done khi danh sách Hôm nay về 0 (mỗi người 1 lần/ngày).
 *  - 💬 Lời khen của khách (14/11/2026): sale tích ⭐ khi ghi chăm sóc, hoặc ghi tay (lời khen cũ từ Zalo…). Hiện 3 lời khen mới nhất 30 ngày,
 *    tên khách + tỉnh, KHÔNG số điện thoại; 👏 gửi tới người chăm sóc. Người ghi / Quản lý trở lên ẩn được.
 * Ai cũng bấm 👏 Chúc mừng được (1 lần / tin), người được chúc thấy số 👏 và tên người chúc. Không dùng AI, không Telegram. */
import { run, all, startOfDay, isVoid, fmtDate, DAY } from './lib.js';

const WIN = 36 * 3600e3; // tin trong 36 giờ gần nhất (sáng sớm vẫn thấy tin chiều hôm qua)
const MAX = 12;

let schemaOk = false;
async function schema(db) {
  if (schemaOk) return;
  await run(db, `CREATE TABLE IF NOT EXISTS bt_event (day TEXT, email TEXT, name TEXT DEFAULT '', kind TEXT DEFAULT 'done', n INTEGER DEFAULT 0, at INTEGER, PRIMARY KEY (day, email, kind))`);
  await run(db, `CREATE TABLE IF NOT EXISTS bt_praise (id INTEGER PRIMARY KEY AUTOINCREMENT, at INTEGER, phone TEXT DEFAULT '', cname TEXT DEFAULT '', prov TEXT DEFAULT '', text TEXT, by_email TEXT, by_name TEXT DEFAULT '', del INTEGER DEFAULT 0)`);
  await run(db, `CREATE TABLE IF NOT EXISTS bt_clap (k TEXT, email TEXT, name TEXT DEFAULT '', at INTEGER, PRIMARY KEY (k, email))`);
  schemaOk = true;
}

/** Tên sản phẩm đầu tiên trong đơn, bỏ số lượng / giá / phân loại: "Trà DILVANG (Hộp 30 gói) x2 = 360.000" → "Trà DILVANG". */
function firstProd(items) {
  const lines = String(items || '').split('\n').map(l => l.replace(/^🎁\s*/, '').trim()).filter(Boolean);
  if (!lines.length) return '';
  const nm = l => l.replace(/\s+x\d+\s*=.*$/, '').replace(/\s*\(.*\)\s*$/, '').trim();
  const real = lines.filter(l => !/^🎁/.test(l)), first = nm(real[0] || lines[0]);
  return first + (lines.length > 1 ? ' và ' + (lines.length - 1) + ' món khác' : '');
}

export async function btFeed(x, u) {
  await schema(x.db);
  const now = Date.now(), since = now - WIN;
  const ords = await all(x.db, `SELECT o.rid, o.time, o.seller, o.items, o.status, c.owner FROM orders o LEFT JOIN customers c ON c.phone = o.phone WHERE o.time > ? AND o.time <= ? ORDER BY o.time DESC LIMIT 60`, since, now + 3600e3);
  const items = [];
  for (const o of ords) {
    if (isVoid(o.status)) continue;
    const who = o.seller || '';
    if (!who) continue; // đơn web chưa ai xác nhận: chưa phải công của ai
    const p = firstProd(o.items);
    items.push({ k: 'o' + o.rid, at: o.time, who, ic: '🎉', t: who + ' vừa chốt đơn' + (p ? ' ' + p : '') });
  }
  const evs = await all(x.db, 'SELECT day, email, name, kind, n, at FROM bt_event WHERE at > ? ORDER BY at DESC LIMIT 30', since);
  for (const e of evs) items.push({ k: 'd' + e.day + ':' + e.email, at: e.at, who: e.name, ic: '🏁', t: e.name + ' đã chăm sóc xong hết ' + (e.n ? e.n + ' khách' : 'khách') + ' hôm nay' + (e.day !== fmtDate(now, 'yyyy-MM-dd') ? ' (hôm qua)' : '') });
  items.sort((a, b) => b.at - a.at);
  const pr = await all(x.db, 'SELECT id, at, cname, prov, text, by_email, by_name FROM bt_praise WHERE del = 0 AND at > ? ORDER BY at DESC LIMIT 3', now - 30 * DAY);
  const praise = pr.map(p => ({ k: 'p' + p.id, id: p.id, at: p.at, who: p.by_name, ic: '💬', pr: 1, t: (p.cname || 'Khách') + (p.prov ? ' (' + p.prov + ')' : '') + ': “' + p.text + '”' + (p.by_name ? ' · cảm ơn ' + p.by_name : ''), del: p.by_email === u.email || u.level >= 2 }));
  const list = praise.filter(p => now - p.at < WIN).concat(items).sort((a, b) => b.at - a.at).slice(0, MAX); // lời khen trong 36 giờ xếp theo giờ như tin khác
  praise.filter(p => now - p.at >= WIN).forEach((p, i) => list.splice(Math.min(list.length, 1 + i * 2), 0, p)); // lời khen cũ hơn (≤ 30 ngày) xen vào sau tin mới nhất, để ngày nào cũng có
  if (list.length > MAX) list.length = MAX;
  const keys = list.map(i => i.k), claps = keys.length ? await all(x.db, `SELECT k, email, name FROM bt_clap WHERE k IN (${keys.map(() => '?').join(',')})`, ...keys) : [];
  list.forEach(i => {
    const cs = claps.filter(c => c.k === i.k);
    i.n = cs.length; i.mine = cs.some(c => c.email === u.email); i.me = i.who === u.name;
    if (i.me) i.by = cs.map(c => c.name); // người được chúc mới thấy tên ai chúc
  });
  return { ok: true, bt: { items: list, at: now, day0: startOfDay(now) } };
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

/** 👏 Chúc mừng 1 tin (1 lần / người / tin, không tự chúc mình). */
export async function btClap(x, u, d) {
  await schema(x.db);
  const k = String(d.k || '').slice(0, 120);
  if (k && d.who !== u.name) await run(x.db, 'INSERT INTO bt_clap (k, email, name, at) VALUES (?, ?, ?, ?) ON CONFLICT(k, email) DO NOTHING', k, u.email, u.name, Date.now());
  return btFeed(x, u);
}

export async function crmBt(x, u, d) {
  const a = d.action;
  if (a === 'bt_feed') return btFeed(x, u);
  if (a === 'bt_done') return btDone(x, u, d);
  if (a === 'bt_clap') return btClap(x, u, d);
  if (a === 'bt_praise') return btPraise(x, u, d);
  if (a === 'bt_pdel') return btPdel(x, u, d);
  return { ok: false, error: 'Không rõ thao tác: ' + a };
}
