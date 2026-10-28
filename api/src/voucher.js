// Mã ưu đãi khi khách đặt hàng trên web (gửi riêng cho khách cũ, đối tác). Quản lý / Quản trị tạo mã ở CRM → Cài đặt → 🎟 Mã ưu đãi.
// Web: khách bấm "Có mã ưu đãi?" ở trang thanh toán, hoặc mở link ?uudai=MÃ (web tự nhớ, tự áp dụng).
// Máy chủ luôn tự tính lại tiền giảm lúc chốt đơn, không tin số trình duyệt gửi lên.
import { all, first, run, kvGet, kvSet, normPhone, fmt, nrm, isVoid } from './lib.js';

export async function voucherSchema(db) {
  await run(db, `CREATE TABLE IF NOT EXISTS vouchers (
    code TEXT PRIMARY KEY, kind TEXT DEFAULT 'amount', value REAL DEFAULT 0, max_off INTEGER DEFAULT 0, min_sub INTEGER DEFAULT 0,
    exp TEXT DEFAULT '', max_uses INTEGER DEFAULT 0, once INTEGER DEFAULT 1, phone TEXT DEFAULT '', note TEXT DEFAULT '',
    active INTEGER DEFAULT 1, created INTEGER, by_name TEXT DEFAULT ''
  )`);
  await run(db, 'CREATE INDEX IF NOT EXISTS orders_voucher ON orders(voucher)');
}

export function vcNorm(c) { return nrm(c).toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 30); }
const KINDS = { amount: 1, percent: 1, ship: 1 };
/** Tiền giảm theo tạm tính (trước phí ship). Phần trăm: làm tròn xuống nghìn, không quá mức giảm tối đa. */
export function vcOff(v, sub) {
  sub = Math.max(0, Math.round(Number(sub) || 0));
  if (v.kind === 'percent') { let o = Math.floor(sub * (Number(v.value) || 0) / 100 / 1000) * 1000; if (v.max_off > 0) o = Math.min(o, v.max_off); return Math.min(o, sub); }
  if (v.kind === 'amount') return Math.min(Math.round(Number(v.value) || 0), sub);
  return 0; // ship: miễn phí vận chuyển
}
export function vcLabel(v) {
  return v.kind === 'percent' ? 'Giảm ' + v.value + '%' + (v.max_off > 0 ? ' (tối đa ' + fmt(v.max_off) + ')' : '') : v.kind === 'ship' ? 'Miễn phí vận chuyển' : 'Giảm ' + fmt(v.value);
}
function expAt(s) { if (!s) return 0; const t = new Date(String(s) + 'T23:59:59+07:00').getTime(); return isNaN(t) ? 0 : t; }
const LIVE = "status NOT LIKE '%uỷ%' AND status NOT LIKE '%ủy%' AND status NOT LIKE '%Hoàn%'"; // đơn huỷ / hoàn trả lại lượt dùng

const LIVE_O = "status NOT LIKE '%uỷ%' AND status NOT LIKE '%ủy%' AND status NOT LIKE '%oàn%'";
/** 🎁 Mã giới thiệu của khách đã mua: TÊN + 3 số cuối SĐT (HUONG522), bạn bè mua lần đầu giảm refPct %. Đã có thì trả mã cũ.
 *  Dùng chung cho: sale bấm 🎁 Mã giới thiệu (partner.js), khách tự lấy ở /gioi-thieu-ban-be/, bạn bè gõ SĐT người giới thiệu vào ô mã ưu đãi.
 *  Khách chưa có đơn nào (không huỷ / hoàn) → null. */
export async function makeRefCode(x, phone, by, refPct) {
  phone = normPhone(phone);
  const old = await first(x.db, 'SELECT * FROM vouchers WHERE ref_phone = ? AND active = 1 ORDER BY created LIMIT 1', phone);
  if (old) return { code: old.code, label: vcLabel(old), v: old };
  const c = await first(x.db, 'SELECT name FROM customers WHERE phone = ?', phone);
  if (!c || !(await first(x.db, 'SELECT count(*) AS n FROM orders WHERE phone = ? AND ' + LIVE_O, phone)).n) return null;
  const w = vcNorm(String(c.name || '').replace(/\(.*?\)/g, ' ').trim().split(/\s+/).pop() || 'BAN').slice(0, 8) || 'BAN';
  let code = w + phone.slice(-3), i = 1;
  while (await first(x.db, 'SELECT code FROM vouchers WHERE code = ?', code)) code = w + phone.slice(-3) + (++i);
  await run(x.db, "INSERT INTO vouchers (code, kind, value, max_off, min_sub, exp, max_uses, once, phone, note, active, created, by_name, ref_phone, new_only) VALUES (?, 'percent', ?, 0, 0, '', 0, 1, '', ?, 1, ?, ?, ?, 1)",
    code, refPct, 'Mã giới thiệu của ' + (c.name || phone), Date.now(), by || '', phone);
  await run(x.db, 'INSERT INTO logs (time, by_name, what, ref, name, result, note) VALUES (?, ?, ?, ?, ?, ?, ?)', Date.now(), by || '', 'Mã giới thiệu', phone, c.name || '', code, 'Bạn bè giảm ' + refPct + '% đơn đầu');
  return { code, label: 'Giảm ' + refPct + '%', isNew: true, v: await first(x.db, 'SELECT * FROM vouchers WHERE code = ?', code) };
}
async function refPctOf(x) { try { const c = JSON.parse((await kvGet(x.db, 'partner_cfg')) || '{}'); return c.refPct == null ? 10 : Number(c.refPct); } catch (e) { return 10; } } // = partnerCfg(x).refPct (partner.js nhập file này)

/** Kiểm tra mã cho 1 đơn. phone có thể trống (khách chưa nhập) → mã gắn số điện thoại báo cần nhập số trước.
 *  Khách gõ SỐ ĐIỆN THOẠI người giới thiệu vào ô mã (28/10/2026) → đổi thành mã giới thiệu của người đó. */
async function vcCheck(x, code, sub, phone) {
  code = vcNorm(code); if (!code) return { ok: false, error: 'Bạn nhập mã ưu đãi giúp nhé.' };
  if (/^(0\d{9,10}|84\d{9,10})$/.test(code)) {
    const rp = normPhone(code);
    if (phone && normPhone(phone) === rp) return { ok: false, error: 'Đây là số của chính bạn. Ô này để nhập số điện thoại của người đã giới thiệu bạn nhé.' };
    const r = await makeRefCode(x, rp, 'Website', await refPctOf(x));
    if (!r) return { ok: false, bad: true, error: 'Số ' + rp + ' chưa từng mua hàng tại Thực Dưỡng Lành nên chưa có ưu đãi giới thiệu. Bạn kiểm tra lại số giúp nhé.' };
    code = r.code;
  }
  const v = await first(x.db, 'SELECT * FROM vouchers WHERE code = ?', code);
  if (!v || !v.active) return { ok: false, bad: true, error: 'Mã ưu đãi không đúng. Bạn kiểm tra lại giúp nhé.' };
  if (v.exp && expAt(v.exp) < Date.now()) return { ok: false, error: 'Mã ưu đãi đã hết hạn.' };
  if (v.min_sub > 0 && Number(sub) < v.min_sub) return { ok: false, v, error: 'Mã này áp dụng cho đơn từ ' + fmt(v.min_sub) + ' (chưa tính phí ship).' };
  phone = normPhone(phone);
  if (v.phone) {
    if (!phone) return { ok: false, needPhone: true, error: 'Mã này dành riêng cho 1 số điện thoại. Bạn nhập số điện thoại nhận hàng trước rồi bấm Áp dụng nhé.' };
    if (normPhone(v.phone) !== phone) return { ok: false, error: 'Mã này không dành cho số điện thoại ' + phone + '.' };
  }
  if (v.new_only && phone) { // mã giới thiệu của khách cũ / mã của CTV: chỉ khách mua lần đầu. Chưa có SĐT (mở link ?uudai=) thì cho áp dụng thử, lúc đặt hàng kiểm tra lại
    if (v.ref_phone && normPhone(v.ref_phone) === phone) return { ok: false, error: 'Đây là mã giới thiệu của bạn, để tặng bạn bè, người thân. Bạn không dùng được mã của chính mình nhé.' };
    if ((await first(x.db, 'SELECT count(*) AS n FROM orders WHERE phone = ? AND ' + LIVE, phone)).n) return { ok: false, error: 'Mã này dành cho khách mua lần đầu. Số ' + phone + ' đã từng đặt hàng nên không dùng được, bạn thông cảm nhé.' };
  }
  if (v.max_uses > 0 && (await first(x.db, 'SELECT count(*) AS n FROM orders WHERE voucher = ? AND ' + LIVE, code)).n >= v.max_uses) return { ok: false, error: 'Mã ưu đãi đã hết lượt dùng.' };
  if (v.once && phone && (await first(x.db, 'SELECT count(*) AS n FROM orders WHERE voucher = ? AND phone = ? AND ' + LIVE, code, phone)).n) return { ok: false, error: 'Số điện thoại này đã dùng mã ưu đãi này rồi.' };
  return { ok: true, v };
}

/** Web gọi khi khách bấm "Áp dụng" (hoặc mở link có mã). Nhập sai nhiều lần → tạm khoá theo địa chỉ IP để không ai dò mã. */
export async function voucherCheck(x, d) {
  const key = 'vcf_' + String(x.ip || 'x').slice(0, 60), fails = Number(await kvGet(x.db, key)) || 0;
  if (fails >= 8) return { ok: false, error: 'Bạn nhập sai mã nhiều lần. Thử lại sau 15 phút, hoặc gọi hotline để được hỗ trợ nhé.' };
  const r = await vcCheck(x, d.code, d.subtotal, d.phone);
  if (r.bad) await kvSet(x.db, key, fails + 1, 15 * 60e3);
  if (!r.v) return { ok: false, needPhone: !!r.needPhone, error: r.error };
  const v = r.v, out = { code: v.code, kind: v.kind, value: v.value, max_off: v.max_off || 0, min_sub: v.min_sub || 0, phone: !!v.phone, label: vcLabel(v) };
  return r.ok ? Object.assign({ ok: true, off: vcOff(v, d.subtotal) }, out) : { ok: false, needPhone: !!r.needPhone, error: r.error, low: v.min_sub > 0 && Number(d.subtotal) < v.min_sub ? out : undefined };
}

/** Lúc chốt đơn: kiểm tra lại mã, tự tính tiền giảm + tổng tiền, ghi vào data. Mã không hợp lệ → trả lỗi để web báo khách (không lưu đơn). */
export async function voucherApply(x, data) {
  const c = data.customer || {}, sub = Math.round(Number(data.subtotal) || 0);
  const r = await vcCheck(x, data.voucher, sub, c.phone);
  if (!r.ok) return { ok: false, error: r.error };
  const v = r.v, off = vcOff(v, sub);
  if (v.kind === 'ship') data.shipping = 0;
  data.voucher = v.code; data.discount = off; data.total = sub - off + (Number(data.shipping) || 0);
  c.note = (c.note ? c.note + ' · ' : '') + '🎟 Mã ưu đãi ' + v.code + ': ' + (v.kind === 'ship' ? 'miễn phí ship' : '−' + fmt(off) + ' (tạm tính ' + fmt(sub) + ')');
  data.customer = c;
  return { ok: true };
}

/* ---------------------------------------------------------------- CRM: Quản lý / Quản trị tạo / sửa / tắt mã */
async function vcList(x) {
  const rows = await all(x.db, 'SELECT * FROM vouchers ORDER BY active DESC, created DESC LIMIT 500');
  const used = {}; (await all(x.db, "SELECT voucher, status, discount, total FROM orders WHERE voucher != ''")).forEach(o => {
    if (isVoid(o.status)) return; const u = used[o.voucher] || (used[o.voucher] = { n: 0, off: 0, sales: 0 }); u.n++; u.off += Number(o.discount) || 0; u.sales += Number(o.total) || 0;
  });
  return rows.map(v => Object.assign({ code: v.code, kind: v.kind, value: v.value, max_off: v.max_off || 0, min_sub: v.min_sub || 0, exp: v.exp || '', max_uses: v.max_uses || 0, once: !!v.once, phone: v.phone || '', note: v.note || '', active: !!v.active, created: v.created, by: v.by_name || '', label: vcLabel(v), refPhone: v.ref_phone || '', partner: v.partner || '', newOnly: !!v.new_only }, { used: used[v.code] || { n: 0, off: 0, sales: 0 } }));
}
export async function crmVoucher(x, u, d, log) {
  if (u.level < 2) return { ok: false, error: 'Chỉ Quản lý và Quản trị quản lý được mã ưu đãi.' };
  const a = d.action;
  if (a === 'voucher_list') return { ok: true, list: await vcList(x) };
  const code = vcNorm(d.code);
  if (code.length < 3) return { ok: false, error: 'Mã cần ít nhất 3 ký tự (chữ không dấu hoặc số).' };
  const old = await first(x.db, 'SELECT * FROM vouchers WHERE code = ?', code);
  if (a === 'voucher_save') {
    if (d.isNew && old) return { ok: false, error: 'Mã ' + code + ' đã có. Bạn đặt mã khác nhé.' };
    const kind = KINDS[d.kind] ? d.kind : 'amount', value = Math.max(0, Number(d.value) || 0);
    if (kind === 'percent' && !(value > 0 && value <= 100)) return { ok: false, error: 'Phần trăm giảm cần từ 1 đến 100.' };
    if (kind === 'amount' && !(value >= 1000)) return { ok: false, error: 'Số tiền giảm cần từ 1.000đ.' };
    const phone = normPhone(d.phone); if (d.phone && !/^0\d{9,10}$/.test(phone)) return { ok: false, error: 'Số điện thoại chưa đúng.' };
    const exp = /^\d{4}-\d{2}-\d{2}$/.test(String(d.exp || '')) ? d.exp : '';
    const row = [kind, value, Math.max(0, Math.round(Number(d.max_off) || 0)), Math.max(0, Math.round(Number(d.min_sub) || 0)), exp, Math.max(0, Math.round(Number(d.max_uses) || 0)), d.once ? 1 : 0, phone, String(d.note || '').slice(0, 200), d.active === false ? 0 : 1];
    if (old) await run(x.db, 'UPDATE vouchers SET kind = ?, value = ?, max_off = ?, min_sub = ?, exp = ?, max_uses = ?, once = ?, phone = ?, note = ?, active = ? WHERE code = ?', ...row, code);
    else await run(x.db, 'INSERT INTO vouchers (kind, value, max_off, min_sub, exp, max_uses, once, phone, note, active, code, created, by_name) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)', ...row, code, Date.now(), u.name);
    await log(x, u, old ? 'Sửa mã ưu đãi' : 'Tạo mã ưu đãi', code, '', vcLabel({ kind, value, max_off: row[2] }) + (row[9] ? '' : ' · tắt'), String(d.note || ''));
    return { ok: true, list: await vcList(x) };
  }
  if (a === 'voucher_del') {
    if (!old) return { ok: true, list: await vcList(x) };
    const n = (await first(x.db, "SELECT count(*) AS n FROM orders WHERE voucher = ?", code)).n;
    if (n) await run(x.db, 'UPDATE vouchers SET active = 0 WHERE code = ?', code); // đã có đơn dùng → chỉ tắt, giữ để thống kê
    else await run(x.db, 'DELETE FROM vouchers WHERE code = ?', code);
    await log(x, u, n ? 'Tắt mã ưu đãi' : 'Xoá mã ưu đãi', code, '', '', '');
    return { ok: true, list: await vcList(x), off: !!n };
  }
  return { ok: false, error: 'Không rõ thao tác: ' + a };
}
