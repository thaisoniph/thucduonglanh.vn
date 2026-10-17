// Hành trình 10 triệu người Việt sống khỏe hơn: bộ đếm công khai (trang chủ, /cam-ket-song-lanh/) + lời cam kết "Tôi chọn sống lành".
// Bộ đếm = số khách đã mua (customers.orders > 0, đơn huỷ/hoàn không tính) + số lời cam kết. Chỉ trả về con số, không lộ dữ liệu khách.
// Lời cam kết chỉ lưu tên + tỉnh/thành (không số điện thoại), không hiện công khai.
import { first, run, kvGet, kvSet } from './lib.js';

export async function journeySchema(db) {
  await run(db, `CREATE TABLE IF NOT EXISTS pledges (id INTEGER PRIMARY KEY AUTOINCREMENT, time INTEGER, name TEXT DEFAULT '', province TEXT DEFAULT '', src TEXT DEFAULT '', ip TEXT DEFAULT '')`);
}

/** Số khách đã mua: đếm cả bảng khách (đọc nhiều dòng) nên lưu kv 6 tiếng để tiết kiệm lượt đọc D1. */
async function buyers(db) {
  const c = await kvGet(db, 'jr_buyers'); if (c != null) return Number(c) || 0;
  const r = await first(db, 'SELECT COUNT(*) n FROM customers WHERE orders > 0');
  const n = Number(r && r.n) || 0; await kvSet(db, 'jr_buyers', n, 6 * 3600e3); return n;
}
async function pledges(db) { const r = await first(db, 'SELECT MAX(id) n FROM pledges'); return Number(r && r.n) || 0; }

export async function journeyCounts(x) {
  const b = await buyers(x.db), p = await pledges(x.db);
  return { ok: true, buyers: b, pledges: p, total: b + p, goal: 10000000 };
}

const clean = (s, n) => String(s || '').replace(/<[^>]*>/g, '').replace(/[<>"`\u0000-\u001f]/g, '').replace(/\s+/g, ' ').trim().slice(0, n);

/** Khách ký cam kết → trả về số thứ tự trên hành trình để in lên ảnh chứng nhận. */
export async function pledge(x, d) {
  const name = clean(d.name, 40), province = clean(d.province, 40);
  if (name.length < 2) return { ok: false, error: 'Bạn ghi giúp tên của mình nhé.' };
  const ip = String(x.ip || '').slice(0, 64), k = 'jr_ip_' + ip;
  const used = Number(ip ? await kvGet(x.db, k) : 0) || 0; // tối đa 30 lần/ngày/mạng: đủ cho ký tập thể ở sự kiện (chung wifi), chặn spam
  if (used >= 30) return { ok: false, error: 'Bạn đã ký nhiều lần hôm nay rồi, cảm ơn bạn nhiều nhé!' };
  const r = await first(x.db, 'INSERT INTO pledges (time, name, province, src, ip) VALUES (?, ?, ?, ?, ?) RETURNING id', Date.now(), name, province, clean(d.src, 80), ip);
  if (ip) await kvSet(x.db, k, used + 1, 24 * 3600e3);
  const id = Number(r && r.id) || 0;
  return { ok: true, no: (await buyers(x.db)) + id, name };
}
