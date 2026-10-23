// Hành trình 10 triệu người Việt sống khỏe hơn: bộ đếm công khai (trang chủ, /cam-ket-song-lanh/) + lời cam kết "Tôi chọn sống lành".
// Bộ đếm = số khách đã mua (customers.orders > 0, đơn huỷ/hoàn không tính) + số lời cam kết. Chỉ trả về con số, không lộ dữ liệu khách.
// Lời cam kết KHÔNG lưu tên, SĐT hay IP (17/10/2026, anh Sơn chọn: không chăm sóc lại được thì không giữ dữ liệu cá nhân).
// Tên chỉ nằm trên máy khách để vẽ ảnh chứng nhận. Máy chủ giữ: thời gian, tỉnh/thành (không bắt buộc), nguồn khách → thống kê ở CRM tab 📣 Marketing.
import { all, first, run, kvGet, kvSet } from './lib.js';
import { areaStats, provOfAddr } from './crm.js';

export async function journeySchema(db) {
  await run(db, `CREATE TABLE IF NOT EXISTS pledges (id INTEGER PRIMARY KEY AUTOINCREMENT, time INTEGER, name TEXT DEFAULT '', province TEXT DEFAULT '', src TEXT DEFAULT '', ip TEXT DEFAULT '')`);
  await run(db, 'CREATE INDEX IF NOT EXISTS pledges_time ON pledges(time)');
  await run(db, "UPDATE pledges SET name = '', ip = '' WHERE name != '' OR ip != ''"); // xoá tên / IP của bản đầu (17/10/2026), cột name, ip bỏ trống từ nay
  // trò chơi "Bạn còn mấy ngón tay?" (/ngon-tay-song-lanh/, 17/10/2026): chỉ lưu điểm, thói quen bị hạ ngón (cách nhau dấu |), nguồn
  await run(db, `CREATE TABLE IF NOT EXISTS quizzes (id INTEGER PRIMARY KEY AUTOINCREMENT, time INTEGER, score INTEGER, total INTEGER, miss TEXT DEFAULT '', src TEXT DEFAULT '')`);
  await run(db, 'CREATE INDEX IF NOT EXISTS quizzes_time ON quizzes(time)');
}

/** Số khách đã mua: đếm cả bảng khách (đọc nhiều dòng) nên lưu kv 6 tiếng để tiết kiệm lượt đọc D1. */
async function buyers(db) {
  const c = await kvGet(db, 'jr_buyers'); if (c != null) return Number(c) || 0;
  const r = await first(db, 'SELECT COUNT(*) n FROM customers WHERE orders > 0');
  const n = Number(r && r.n) || 0; await kvSet(db, 'jr_buyers', n, 6 * 3600e3); return n;
}
async function pledges(db) { const r = await first(db, 'SELECT MAX(id) n FROM pledges'); return Number(r && r.n) || 0; }

/** Bản đồ hành trình (23/10/2026): số người đồng hành theo 34 tỉnh mới = khách đã mua (tỉnh nhận từ địa chỉ, dùng chung bộ đếm areaStats
 *  của CRM, lưu kv 6 tiếng) + lời cam kết có chọn tỉnh. Chỉ con số theo tỉnh. Địa chỉ không nhận ra tỉnh thì không tính vào bản đồ. */
async function provCounts(x) {
  const m = {}, add = (nw, n) => { if (nw && n > 0) m[nw] = (m[nw] || 0) + n; };
  const a = await areaStats(x).catch(() => null);
  if (a) Object.values(a.p || {}).forEach(v => add(v[0], Number(v[1]) || 0));
  const rows = await all(x.db, "SELECT province, COUNT(*) AS n FROM pledges WHERE province != '' GROUP BY province").catch(() => []);
  rows.forEach(r => { const pv = provOfAddr(r.province); add(pv && pv.nw, Number(r.n) || 0); });
  return m;
}

export async function journeyCounts(x) {
  const b = await buyers(x.db), p = await pledges(x.db), prov = await provCounts(x).catch(() => ({}));
  return { ok: true, buyers: b, pledges: p, total: b + p, goal: 10000000, prov };
}

const clean = (s, n) => String(s || '').replace(/<[^>]*>/g, '').replace(/[<>"`\u0000-\u001f]/g, '').replace(/\s+/g, ' ').trim().slice(0, n);

async function sha(t) { const b = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(t)); return [...new Uint8Array(b)].slice(0, 12).map(v => v.toString(16).padStart(2, '0')).join(''); }

/** Khách ký cam kết → trả về số thứ tự trên hành trình để in lên ảnh chứng nhận. Không nhận tên (tên ở lại trên máy khách). */
export async function pledge(x, d) {
  const province = clean(d.province, 40);
  // chống spam: tối đa 30 lần/ngày/mạng (đủ cho ký tập thể ở sự kiện, chung wifi). Khoá đếm dùng mã băm của IP, tự xoá sau 1 ngày
  const k = x.ip ? 'jr_ip_' + await sha(x.ip + '|jr') : '';
  const used = Number(k ? await kvGet(x.db, k) : 0) || 0;
  if (used >= 30) return { ok: false, error: 'Mạng này đã ký nhiều lần hôm nay rồi, cảm ơn bạn nhiều nhé!' };
  const r = await first(x.db, 'INSERT INTO pledges (time, province, src) VALUES (?, ?, ?) RETURNING id', Date.now(), province, clean(d.src, 80));
  if (k) await kvSet(x.db, k, used + 1, 24 * 3600e3);
  return { ok: true, no: (await buyers(x.db)) + (Number(r && r.id) || 0) };
}

/** Thống kê cho CRM tab 📣 Marketing (mktv.js): số người ký trong kỳ / kỳ trước, theo nguồn, theo tỉnh. */
export async function pledgeStats(x, R, P) {
  const [rows, prev] = await Promise.all([
    all(x.db, 'SELECT src, province, COUNT(*) AS n FROM pledges WHERE time >= ? AND time < ? GROUP BY src, province', R[0], R[1]).catch(() => []),
    first(x.db, 'SELECT COUNT(*) AS n FROM pledges WHERE time >= ? AND time < ?', P[0], P[1]).catch(() => null)
  ]);
  const by = f => { const m = {}; rows.forEach(r => { const k = String(r[f] || '').trim(); m[k] = (m[k] || 0) + (Number(r.n) || 0); }); return Object.entries(m).sort((a, b) => b[1] - a[1]); };
  return { n: rows.reduce((t, r) => t + (Number(r.n) || 0), 0), prev: Number(prev && prev.n) || 0, src: by('src'), prov: by('province') };
}

/** Khách chơi xong "Bạn còn mấy ngón tay?" → lưu điểm để biết thói quen nào khách hay "hạ ngón" nhất. Không tên, SĐT, IP. */
export async function quiz(x, d) {
  const total = Math.max(1, Math.min(30, Math.round(Number(d.total) || 10)));
  const score = Math.max(0, Math.min(total, Math.round(Number(d.score) || 0)));
  // miss = tên thói quen bị hạ ngón (không dùng số thứ tự câu: sửa / đổi thứ tự câu hỏi ở /admin thì số liệu cũ vẫn đúng)
  const miss = [...new Set((Array.isArray(d.miss) ? d.miss : []).map(v => clean(v, 50).replace(/\|/g, '/')).filter(Boolean))].slice(0, total).join('|');
  const k = x.ip ? 'qz_ip_' + await sha(x.ip + '|qz') : ''; // chống spam: 60 lượt/ngày/mạng
  const used = Number(k ? await kvGet(x.db, k) : 0) || 0;
  if (used >= 60) return { ok: true, skip: true };
  await run(x.db, 'INSERT INTO quizzes (time, score, total, miss, src) VALUES (?, ?, ?, ?, ?)', Date.now(), score, total, miss, clean(d.src, 80));
  if (k) await kvSet(x.db, k, used + 1, 24 * 3600e3);
  return { ok: true };
}

/** Thống kê trò chơi cho CRM tab 📣 Marketing: số lượt chơi, điểm trung bình, mỗi thói quen bị hạ ngón bao nhiêu lần, nguồn. */
export async function quizStats(x, R, P) {
  const [rows, prev] = await Promise.all([
    all(x.db, 'SELECT score, total, miss, src FROM quizzes WHERE time >= ? AND time < ? LIMIT 20000', R[0], R[1]).catch(() => []),
    first(x.db, 'SELECT COUNT(*) AS n, AVG(score * 10.0 / total) AS a FROM quizzes WHERE time >= ? AND time < ?', P[0], P[1]).catch(() => null)
  ]);
  const miss = {}, src = {}, tiers = [0, 0, 0, 0]; let sum = 0;
  rows.forEach(r => {
    const s10 = (Number(r.score) || 0) * 10 / (Number(r.total) || 10); sum += s10;
    tiers[s10 >= 9 ? 0 : s10 >= 7 ? 1 : s10 >= 4 ? 2 : 3]++;
    String(r.miss || '').split('|').filter(Boolean).forEach(h => { miss[h] = (miss[h] || 0) + 1; });
    const k = String(r.src || '').trim(); src[k] = (src[k] || 0) + 1;
  });
  return { n: rows.length, avg: rows.length ? Math.round(sum / rows.length * 10) / 10 : 0, prev: Number(prev && prev.n) || 0, prevAvg: prev && prev.a != null ? Math.round(prev.a * 10) / 10 : null,
    tiers, miss: Object.entries(miss).sort((a, b) => b[1] - a[1]), src: Object.entries(src).sort((a, b) => b[1] - a[1]) };
}
