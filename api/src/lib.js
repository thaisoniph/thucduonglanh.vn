// Hàm dùng chung: số điện thoại, tiền, ngày giờ Việt Nam, băm MD5, đọc/ghi D1.

export const TZ_MS = 7 * 3600e3; // Việt Nam UTC+7, không đổi giờ mùa hè
export const DAY = 864e5;
export const CRM_URL = 'https://crm.thucduonglanh.vn';

export function normPhone(p) { p = String(p == null ? '' : p).replace(/\D/g, ''); if (p.indexOf('84') === 0 && p.length >= 11) p = '0' + p.slice(2); return p; }
export function esc(s) { return String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;'); }
export function fmt(n) { return Math.round(Number(n) || 0).toString().replace(/\B(?=(\d{3})+(?!\d))/g, '.') + ' ₫'; }
export function startOfDay(t) { t = typeof t === 'number' ? t : new Date(t).getTime(); return Math.floor((t + TZ_MS) / DAY) * DAY - TZ_MS; }
/** Định dạng ngày giờ theo giờ Việt Nam: yyyy, yy, MM, dd, HH, mm, ss. */
export function fmtDate(t, f) {
  const d = new Date(Number(t) + TZ_MS), p = n => (n < 10 ? '0' : '') + n;
  return f.replace('yyyy', d.getUTCFullYear()).replace('yy', String(d.getUTCFullYear()).slice(2)).replace('MM', p(d.getUTCMonth() + 1)).replace('dd', p(d.getUTCDate()))
    .replace('HH', p(d.getUTCHours())).replace('mm', p(d.getUTCMinutes())).replace('ss', p(d.getUTCSeconds()));
}
/** "2026-09-30" → 9h sáng ngày đó (giờ VN), '' nếu trống. */
export function dateOrBlank(s) { if (!s) return null; const t = new Date(String(s) + 'T09:00:00+07:00').getTime(); return isNaN(t) ? null : t; }
export function nrm(s) { return String(s == null ? '' : s).toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/đ/g, 'd').replace(/\s+/g, ' ').trim(); }
export function slugName(n) { const s = String(n || 'NV').normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/đ/g, 'd').replace(/Đ/g, 'D').split(/\s+/).pop(); return s.charAt(0).toUpperCase() + s.slice(1); }
export function isVoid(st) { return /huỷ|hủy|hoàn/i.test(String(st || '')); } // đơn huỷ / hoàn: không tính doanh thu, không tính vào khách
export function randHex(n) { const b = new Uint8Array(n); crypto.getRandomValues(b); return [...b].map(x => x.toString(16).padStart(2, '0')).join(''); }

/* ---------- MD5 (giống Utilities.computeDigest MD5 của Apps Script, chuỗi UTF-8) để mã đơn tự tạo khớp với dữ liệu cũ */
export function md5hex(str) {
  const bytes = new TextEncoder().encode(String(str)), n = bytes.length, words = new Uint32Array((((n + 8) >> 6) + 1) * 16);
  for (let i = 0; i < n; i++) words[i >> 2] |= bytes[i] << ((i % 4) * 8);
  words[n >> 2] |= 0x80 << ((n % 4) * 8); words[words.length - 2] = n * 8;
  const K = [], S = [7, 12, 17, 22, 5, 9, 14, 20, 4, 11, 16, 23, 6, 10, 15, 21];
  for (let i = 0; i < 64; i++) K[i] = Math.floor(Math.abs(Math.sin(i + 1)) * 4294967296) >>> 0;
  let a0 = 0x67452301, b0 = 0xefcdab89, c0 = 0x98badcfe, d0 = 0x10325476;
  for (let o = 0; o < words.length; o += 16) {
    let A = a0, B = b0, Cc = c0, D = d0;
    for (let i = 0; i < 64; i++) {
      let F, g; const r = i >> 4;
      if (r === 0) { F = (B & Cc) | (~B & D); g = i; } else if (r === 1) { F = (D & B) | (~D & Cc); g = (5 * i + 1) % 16; } else if (r === 2) { F = B ^ Cc ^ D; g = (3 * i + 5) % 16; } else { F = Cc ^ (B | ~D); g = (7 * i) % 16; }
      F = (F + A + K[i] + words[o + g]) >>> 0; A = D; D = Cc; Cc = B;
      const s = S[r * 4 + (i % 4)]; B = (B + ((F << s) | (F >>> (32 - s)))) >>> 0;
    }
    a0 = (a0 + A) >>> 0; b0 = (b0 + B) >>> 0; c0 = (c0 + Cc) >>> 0; d0 = (d0 + D) >>> 0;
  }
  return [a0, b0, c0, d0].map(v => [0, 8, 16, 24].map(s => ((v >>> s) & 255).toString(16).padStart(2, '0')).join('')).join('');
}
export function hashKey(s) { return md5hex(s).slice(0, 12); } // 6 byte đầu, như bản Apps Script

/* ---------- D1 */
export async function all(db, sql, ...args) { return (await db.prepare(sql).bind(...args).all()).results || []; }
export async function first(db, sql, ...args) { return await db.prepare(sql).bind(...args).first(); }
export async function run(db, sql, ...args) { return await db.prepare(sql).bind(...args).run(); }
/** Ghi nhiều dòng 1 lần qua JSON (D1 giới hạn 100 tham số / câu lệnh). */
export async function insertMany(db, table, cols, rows, extra) {
  if (!rows.length) return;
  const sel = cols.map(c => `json_extract(value,'$.${c}')`).join(',');
  const sql = `INSERT INTO ${table} (${cols.join(',')}) SELECT ${sel} FROM json_each(?) WHERE true ${extra || ''}`;
  for (let i = 0; i < rows.length; i += 300) await db.prepare(sql).bind(JSON.stringify(rows.slice(i, i + 300))).run();
}
/** Chạy câu lệnh có "IN (danh sách)" theo từng phần. */
export async function allIn(db, sql, list, ...args) {
  const out = [];
  for (let i = 0; i < list.length; i += 500) out.push(...await all(db, sql, JSON.stringify(list.slice(i, i + 500)), ...args));
  return out;
}

/* ---------- kv: cài đặt nhỏ, mã tạm (có hạn) */
export async function kvGet(db, k) {
  const r = await first(db, 'SELECT v, exp FROM kv WHERE k = ?', k); if (!r) return null;
  if (r.exp && r.exp < Date.now()) { await run(db, 'DELETE FROM kv WHERE k = ?', k); return null; }
  return r.v;
}
export async function kvSet(db, k, v, ttlMs) { await run(db, 'INSERT INTO kv (k, v, exp) VALUES (?, ?, ?) ON CONFLICT(k) DO UPDATE SET v = excluded.v, exp = excluded.exp', k, String(v), ttlMs ? Date.now() + ttlMs : null); }
export async function kvDel(db, k) { await run(db, 'DELETE FROM kv WHERE k = ?', k); }
export async function kvJson(db, k, dflt) { const v = await kvGet(db, k); if (v == null) return dflt; try { return JSON.parse(v); } catch (e) { return dflt; } }
