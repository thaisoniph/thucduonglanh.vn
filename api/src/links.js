// 📍 Link & mã QR theo dõi nguồn khách (tờ rơi, standee, gói hàng, đối tác, quảng cáo…), quản lý trong CRM (tab 📍 Link & QR).
// QR in: thucduonglanh.vn/q/<mã>/ → (_redirects của website) → api.thucduonglanh.vn/q/<mã> → đếm lượt quét → 302 tới trang đích kèm UTM (utm_campaign = mã).
// Đơn web ghi nguồn "utm_source / utm_medium / mã" (main.js captureSource, giữ 30 ngày) → thống kê đơn theo mã.
import { all, first, run, allIn, normPhone, isVoid, fmtDate, DAY } from './lib.js';

const SITE = 'https://thucduonglanh.vn';
/** loại → [utm_source, utm_medium, tên hiện ở CRM] */
export const LINK_KINDS = {
  'to-roi': ['offline', 'to-roi', 'Tờ rơi phát ở sự kiện'], standee: ['offline', 'standee', 'Standee'], 'goi-hang': ['offline', 'goi-hang', 'Tờ rơi gửi kèm đơn hàng'],
  'doi-tac': ['offline', 'doi-tac', 'Điểm bán / đối tác'], 'danh-thiep': ['offline', 'danh-thiep', 'Danh thiếp, ấn phẩm khác'],
  google: ['google', 'cpc', 'Quảng cáo Google'], youtube: ['youtube', 'video', 'YouTube'], facebook: ['facebook', 'social', 'Facebook (bài đăng, nhóm)'],
  tiktok: ['tiktok', 'social', 'TikTok'], zalo: ['zalo', 'message', 'Zalo'], kol: ['kol', 'social', 'KOL / cộng tác viên'],
  'bao-chi': ['pr', 'article', 'Báo chí / bài PR'], email: ['email', 'email', 'Email / SMS'], khac: ['other', 'link', 'Khác']
};
const CODE_RE = /^[a-z0-9-]{1,30}$/;
const BOT_RE = /bot|crawl|spider|preview|facebookexternalhit|zalo.*(link|preview)|slurp|headless|curl|wget|python|monitor/i;
const dayMs = s => new Date(s + 'T00:00:00+07:00').getTime();
const today = () => fmtDate(Date.now(), 'yyyy-MM-dd');

/** Trang đích đầy đủ kèm UTM. dest: "/" | "/san-pham/…" | "https://…" */
export function linkTarget(l, code) {
  const k = LINK_KINDS[l && l.kind] || LINK_KINDS.khac;
  let to = String((l && l.dest) || '/').trim(), hash = '';
  if (!/^https:\/\//i.test(to)) to = SITE + '/' + to.replace(/^\/+/, '');
  const i = to.indexOf('#'); if (i >= 0) { hash = to.slice(i); to = to.slice(0, i); }
  return to + (to.indexOf('?') >= 0 ? '&' : '?') + 'utm_source=' + k[0] + '&utm_medium=' + k[1] + '&utm_campaign=' + encodeURIComponent(code) + hash;
}

async function sha(s) { const b = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(s)); return [...new Uint8Array(b)].slice(0, 10).map(x => x.toString(16).padStart(2, '0')).join(''); }

/** GET /q/<mã>: chuyển ngay, đếm sau (1 lượt / máy / ngày theo mã băm IP + trình duyệt, không lưu IP; bỏ qua máy đọc link xem trước). */
export async function qrGo(x, req, code) {
  code = String(code || '').toLowerCase().replace(/[^a-z0-9-]/g, '').slice(0, 30);
  let l = null; try { l = code ? await first(x.db, 'SELECT code, kind, dest FROM links WHERE code = ?', code) : null; } catch (e) { }
  const to = code ? linkTarget(l || { kind: 'khac', dest: '/' }, code) : SITE + '/';
  const ua = req.headers.get('User-Agent') || '';
  if (l && !BOT_RE.test(ua)) x.later((async () => {
    const d = today(), k = d + ':' + code + ':' + await sha((req.headers.get('CF-Connecting-IP') || '') + '|' + ua);
    const r = await run(x.db, 'INSERT OR IGNORE INTO qr_seen (k, day) VALUES (?, ?)', k, d);
    if (r.meta && r.meta.changes) await run(x.db, 'INSERT INTO qr_hits (code, day, n) VALUES (?, ?, 1) ON CONFLICT(code, day) DO UPDATE SET n = n + 1', code, d);
    if (Math.random() < 0.02) await run(x.db, 'DELETE FROM qr_seen WHERE day < ?', fmtDate(Date.now() - 2 * DAY, 'yyyy-MM-dd'));
  })());
  return new Response(null, { status: 302, headers: { Location: to, 'Cache-Control': 'no-store', 'X-Robots-Tag': 'noindex' } });
}

const campOf = v => { const a = String(v || '').split(' / '); return a.length >= 3 && !/^(sale|nhập tay|tiềm năng|file )/i.test(a[0]) ? a[2].trim().toLowerCase() : ''; };

/** Thống kê kỳ [from, to]: { mã: [lượt quét, đơn, tiền, khách mới] }; _tay = đơn sale lên với nguồn "Tờ rơi / Sự kiện". */
async function linkStats(x, from, to) {
  const A = dayMs(from), B = dayMs(to) + DAY, o = {}, g = c => o[c] || (o[c] = [0, 0, 0, 0]);
  const [hits, ords] = await Promise.all([
    all(x.db, 'SELECT code, SUM(n) AS n FROM qr_hits WHERE day BETWEEN ? AND ? GROUP BY code', from, to),
    all(x.db, "SELECT phone, time, total, status, source, first_source FROM orders WHERE time >= ? AND time < ? AND (source LIKE '% / % / %' OR first_source LIKE '% / % / %' OR source LIKE 'Nhập tay – Tờ rơi%')", A, B)
  ]);
  hits.forEach(h => { g(h.code)[0] += Number(h.n) || 0; });
  const list = ords.filter(r => !isVoid(r.status)).map(r => ({ ph: normPhone(r.phone), total: Number(r.total) || 0, c: campOf(r.source) || campOf(r.first_source) || (/^nhập tay – tờ rơi/i.test(r.source || '') ? '_tay' : '') })).filter(r => r.c && r.c.length <= 40);
  const phones = [...new Set(list.map(r => r.ph).filter(Boolean))], firstOf = {};
  if (phones.length) (await allIn(x.db, 'SELECT phone, first FROM customers WHERE phone IN (SELECT value FROM json_each(?))', phones)).forEach(c => { firstOf[normPhone(c.phone)] = Number(c.first) || 0; });
  const seen = {};
  list.forEach(r => { const a = g(r.c), f = firstOf[r.ph]; a[1]++; a[2] += r.total; if (r.ph && !seen[r.c + r.ph] && (!f || f >= A)) { seen[r.c + r.ph] = 1; a[3]++; } });
  return o;
}

/** CRM: link_list (danh sách + số liệu kỳ này / kỳ trước), link_save (tạo / sửa; mã không đổi được sau khi tạo), link_active (ngừng dùng / dùng lại).
 *  Quyền: Marketing, Quản lý, Quản trị. Không có xoá: mã đã in phải luôn chạy. */
export async function crmLinks(x, u, d, log) {
  if (u.level < 2 && u.role !== 'Marketing') return { ok: false, error: 'Chỉ Marketing, Quản lý và Quản trị dùng được mục này.' };
  const a = d.action, DR = /^\d{4}-\d\d-\d\d$/;
  if (a === 'link_list') {
    const links = await all(x.db, 'SELECT code, name, kind, dest, note, active, by_name, at, upd_by, upd_at FROM links ORDER BY active DESC, at DESC');
    links.forEach(l => { l.target = linkTarget(l, l.code); l.short = SITE + '/q/' + l.code + '/'; });
    const ok = [d.from, d.to, d.pf, d.pt].every(s => DR.test(String(s || '')));
    return { ok: true, links, kinds: Object.keys(LINK_KINDS).map(k => [k, LINK_KINDS[k][2]]), stats: ok ? await linkStats(x, d.from, d.to) : {}, prev: ok ? await linkStats(x, d.pf, d.pt) : {} };
  }
  if (a === 'link_save') {
    const code = String(d.code || '').trim().toLowerCase(), name = String(d.name || '').trim().slice(0, 120), kind = LINK_KINDS[d.kind] ? d.kind : 'khac';
    const dest = String(d.dest || '/').trim().slice(0, 500) || '/', note = String(d.note || '').trim().slice(0, 1000);
    if (!CODE_RE.test(code)) return { ok: false, error: 'Mã chỉ gồm chữ thường không dấu, số và dấu gạch ngang (tối đa 30 ký tự).' };
    if (!name) return { ok: false, error: 'Cần đặt tên cho link.' };
    if (!/^\//.test(dest) && !/^https:\/\/[^\s]+$/i.test(dest)) return { ok: false, error: 'Trang đích phải bắt đầu bằng / (trang trên web) hoặc https://' };
    const old = await first(x.db, 'SELECT * FROM links WHERE code = ?', code), now = Date.now();
    if (d.isNew && old) return { ok: false, error: 'Mã "' + code + '" đã có (' + old.name + '). Chọn mã khác.' };
    if (old) await run(x.db, 'UPDATE links SET name = ?, kind = ?, dest = ?, note = ?, upd_by = ?, upd_at = ? WHERE code = ?', name, kind, dest, note, u.name, now, code);
    else await run(x.db, 'INSERT INTO links (code, name, kind, dest, note, active, by_name, at) VALUES (?, ?, ?, ?, ?, 1, ?, ?)', code, name, kind, dest, note, u.name, now);
    await log(x, u, old ? 'Sửa link QR' : 'Tạo link QR', code, name, old && old.dest !== dest ? 'Trang đích: ' + old.dest + ' → ' + dest : '', '');
    return { ok: true };
  }
  if (a === 'link_active') {
    const code = String(d.code || '').toLowerCase(), on = d.on ? 1 : 0;
    await run(x.db, 'UPDATE links SET active = ?, upd_by = ?, upd_at = ? WHERE code = ?', on, u.name, Date.now(), code);
    await log(x, u, on ? 'Dùng lại link QR' : 'Ngừng dùng link QR', code, '', '', '');
    return { ok: true };
  }
  return { ok: false, error: 'Không rõ thao tác: ' + a };
}
