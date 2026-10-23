// Hành trình 10 triệu người Việt sống khỏe hơn: bộ đếm công khai (trang chủ, /cam-ket-song-lanh/) + lời cam kết "Tôi chọn sống lành".
// Bộ đếm = số khách đã mua (customers.orders > 0, đơn huỷ/hoàn không tính) + số lời cam kết. Chỉ trả về con số, không lộ dữ liệu khách.
// Không lưu SĐT, IP. Tên đầy đủ không bao giờ tới máy chủ: 23/10/2026 anh Sơn duyệt "Bức tường Sống Lành" (/buc-tuong-song-lanh/) →
// khách tự tích "Hiện tên tôi" thì máy chủ chỉ giữ tên đã che (Đ.M.T. Sơn) + số thứ tự; không tích = "Một người bạn".
// Máy chủ giữ: thời gian, tỉnh/thành (không bắt buộc), nguồn khách → thống kê ở CRM tab 📣 Marketing (ở đó ẩn được tên không phù hợp).
import { all, first, run, kvGet, kvSet, nrm } from './lib.js';
import { areaStats, provOfAddr } from './crm.js';

export async function journeySchema(db) {
  await run(db, `CREATE TABLE IF NOT EXISTS pledges (id INTEGER PRIMARY KEY AUTOINCREMENT, time INTEGER, name TEXT DEFAULT '', province TEXT DEFAULT '', src TEXT DEFAULT '', ip TEXT DEFAULT '')`);
  await run(db, 'CREATE INDEX IF NOT EXISTS pledges_time ON pledges(time)');
  // cột name, ip bỏ trống (tên / IP bản đầu đã xoá 17/10/2026). Bức tường (23/10/2026): pub = tên đã che, pk = pub không dấu để tìm, no = số thứ tự trên ảnh, hide = Marketing / Quản trị ẩn
  const pc = (await all(db, 'PRAGMA table_info(pledges)')).map(c => c.name);
  for (const [col, def] of [['pub', "TEXT DEFAULT ''"], ['pk', "TEXT DEFAULT ''"], ['no', 'INTEGER'], ['hide', 'INTEGER DEFAULT 0']]) if (!pc.includes(col)) { try { await run(db, `ALTER TABLE pledges ADD COLUMN ${col} ${def}`); } catch (e) { } }
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

// Che tên: tên gọi (chữ cuối) giữ nguyên, họ + tên đệm còn chữ cái đầu. "nguyễn thu hà" → "N.T. Hà". Máy khách che trước khi gửi, máy chủ che lại cho chắc.
export function maskName(s) {
  const w = clean(s, 60).replace(/[^\p{L}\s.'-]/gu, '').split(/[\s.]+/).filter(Boolean).map(v => v.charAt(0).toUpperCase() + v.slice(1).toLowerCase());
  if (!w.length) return '';
  const last = w.pop();
  return (w.length ? w.map(v => v.charAt(0) + '.').join('') + ' ' : '') + last.slice(0, 20);
}
// từ tục / không phù hợp (so không dấu, theo từng chữ): có thì vẫn đếm nhưng không hiện tên
const BAD = new Set('dit dm dmm dcm dkm vcl vkl vl clm cl cak deo ditme fuck shit sex porn bitch dick'.split(' '));
const badName = s => nrm(s).split(/[\s.]+/).some(v => BAD.has(v));

/** Khách chọn sống lành → trả về số thứ tự trên hành trình để in lên ảnh chứng nhận. Tên đầy đủ ở lại trên máy khách; chỉ nhận tên đã che khi khách tích "Hiện tên tôi". */
export async function pledge(x, d) {
  const province = clean(d.province, 40);
  let pub = d.show ? maskName(d.pub) : ''; if (pub.length < 2 || badName(pub)) pub = '';
  // chống spam: tối đa 30 lần/ngày/mạng (đủ cho ký tập thể ở sự kiện, chung wifi). Khoá đếm dùng mã băm của IP, tự xoá sau 1 ngày
  const k = x.ip ? 'jr_ip_' + await sha(x.ip + '|jr') : '';
  const used = Number(k ? await kvGet(x.db, k) : 0) || 0;
  if (used >= 30) return { ok: false, error: 'Mạng này đã ký nhiều lần hôm nay rồi, cảm ơn bạn nhiều nhé!' };
  const r = await first(x.db, 'INSERT INTO pledges (time, province, src, pub, pk) VALUES (?, ?, ?, ?, ?) RETURNING id', Date.now(), province, clean(d.src, 80), pub, nrm(pub));
  if (k) await kvSet(x.db, k, used + 1, 24 * 3600e3);
  const no = (await buyers(x.db)) + (Number(r && r.id) || 0);
  if (r && r.id) await run(x.db, 'UPDATE pledges SET no = ? WHERE id = ?', no, r.id);
  return { ok: true, no, pub };
}

/** Bức tường Sống Lành (GET /api/wall, index.js lưu đệm 2 phút): mới nhất trước, 60 người/lần; q = tên (không dấu) hoặc số thứ tự; p = tỉnh.
 *  Chỉ trả tên đã che. Người không tích "Hiện tên tôi" (và mọi người chọn trước 23/10/2026) hiện là "Một người bạn". */
export async function wall(x, q, p, before) {
  q = nrm(q).replace(/[^a-z0-9 .]/g, '').trim().slice(0, 40); p = clean(p, 40); before = Math.max(0, Number(before) || 0);
  const W = ['hide = 0'], A = [];
  if (/^\d[\d.,]*$/.test(q)) { W.push('no = ?'); A.push(Number(q.replace(/\D/g, ''))); }
  else if (q) { // "son" khớp tên gọi; "dinh minh thai son" / "d.m.t. son" khớp đúng tên đã che
    const m = nrm(maskName(q)); W.push("pk != ''");
    if (m.includes('.')) { W.push('(pk = ? OR pk LIKE ?)'); A.push(m, '%.' + m); } // "thai son" = "t. son" cũng khớp "d.m.t. son"
    else { W.push("(pk = ? OR pk LIKE ? OR pk LIKE ?)"); A.push(q, '% ' + q + '%', q + '%'); }
  }
  if (p) { W.push('province = ?'); A.push(p); }
  if (before) { W.push('id < ?'); A.push(before); }
  const rows = await all(x.db, `SELECT id, time, pub, province, no FROM pledges WHERE ${W.join(' AND ')} ORDER BY id DESC LIMIT 61`, ...A);
  const named = q || p || before ? null : Number((await first(x.db, "SELECT COUNT(*) n FROM pledges WHERE pub != '' AND hide = 0") || {}).n) || 0;
  return { ok: true, named, more: rows.length > 60 ? rows[59].id : 0,
    rows: rows.slice(0, 60).map(r => ({ n: r.pub || '', p: r.province || '', no: Number(r.no) || 0, t: r.time })) };
}

/** CRM 📣 Marketing → 🌱 Tôi chọn sống lành: ẩn / hiện lại một tên trên Bức tường (Marketing, Quản trị). */
export async function wallHide(x, u, d) {
  if (!(u.level >= 3 || u.role === 'Marketing')) return { ok: false, error: 'Chỉ Marketing và Quản trị.' };
  await run(x.db, 'UPDATE pledges SET hide = ? WHERE id = ?', d.hide ? 1 : 0, Number(d.id) || 0);
  return { ok: true };
}

/** Thống kê cho CRM tab 📣 Marketing (mktv.js): số người ký trong kỳ / kỳ trước, theo nguồn, theo tỉnh. */
export async function pledgeStats(x, R, P) {
  const [rows, prev] = await Promise.all([
    all(x.db, 'SELECT src, province, COUNT(*) AS n FROM pledges WHERE time >= ? AND time < ? GROUP BY src, province', R[0], R[1]).catch(() => []),
    first(x.db, 'SELECT COUNT(*) AS n FROM pledges WHERE time >= ? AND time < ?', P[0], P[1]).catch(() => null)
  ]);
  const by = f => { const m = {}; rows.forEach(r => { const k = String(r[f] || '').trim(); m[k] = (m[k] || 0) + (Number(r.n) || 0); }); return Object.entries(m).sort((a, b) => b[1] - a[1]); };
  const names = await all(x.db, "SELECT id, time, pub, province, no, hide FROM pledges WHERE pub != '' ORDER BY id DESC LIMIT 40").catch(() => []); // tên mới nhất trên Bức tường để duyệt
  return { n: rows.reduce((t, r) => t + (Number(r.n) || 0), 0), prev: Number(prev && prev.n) || 0, src: by('src'), prov: by('province'), names };
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
