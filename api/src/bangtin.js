/* ================================================================ 📣 Bảng tin vui đồng đội (14/11/2026, anh Sơn chọn)
 * Một dòng ở đầu màn hình đầu tiên của mỗi người (app.js btCard), nằm yên, 7 giây đổi tin (không chữ chạy).
 * Tin lấy tự động, không ai phải nhập:
 *  - 🎉 "<sale> vừa chốt đơn <sản phẩm>": đơn 36 giờ qua có người bán, không huỷ / hoàn. KHÔNG ghi số tiền (giữ tinh thần thi đua bớt so tiền 17/10).
 *  - 🏁 "<người> đã chăm sóc xong hết khách hôm nay": app.js gửi bt_done khi danh sách Hôm nay về 0 (mỗi người 1 lần/ngày).
 * Ai cũng bấm 👏 Chúc mừng được (1 lần / tin), người được chúc thấy số 👏 và tên người chúc. Không dùng AI, không Telegram. */
import { run, all, startOfDay, isVoid, fmtDate } from './lib.js';

const WIN = 36 * 3600e3; // tin trong 36 giờ gần nhất (sáng sớm vẫn thấy tin chiều hôm qua)
const MAX = 12;

let schemaOk = false;
async function schema(db) {
  if (schemaOk) return;
  await run(db, `CREATE TABLE IF NOT EXISTS bt_event (day TEXT, email TEXT, name TEXT DEFAULT '', kind TEXT DEFAULT 'done', n INTEGER DEFAULT 0, at INTEGER, PRIMARY KEY (day, email, kind))`);
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
  const list = items.slice(0, MAX);
  const keys = list.map(i => i.k), claps = keys.length ? await all(x.db, `SELECT k, email, name FROM bt_clap WHERE k IN (${keys.map(() => '?').join(',')})`, ...keys) : [];
  list.forEach(i => {
    const cs = claps.filter(c => c.k === i.k);
    i.n = cs.length; i.mine = cs.some(c => c.email === u.email); i.me = i.who === u.name;
    if (i.me) i.by = cs.map(c => c.name); // người được chúc mới thấy tên ai chúc
  });
  return { ok: true, bt: { items: list, at: now, day0: startOfDay(now) } };
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
  return { ok: false, error: 'Không rõ thao tác: ' + a };
}
