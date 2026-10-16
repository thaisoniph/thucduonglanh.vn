// 🤝 Cộng tác viên / đối tác (affiliate 1 tầng) + 🎁 khách cũ giới thiệu bạn bè (16/10/2026).
// - CTV có link thucduonglanh.vn/?ref=<mã> và (tuỳ chọn) mã giảm giá cho khách của mình. Khách MỚI đặt qua link / mã → khách thuộc CTV;
//   mọi đơn của khách đó trong `months` tháng (mặc định 6, kể cả đơn sale lên lại / nhập file) được tính hoa hồng `rate`% (mặc định 10)
//   trên tiền hàng (tổng − phí ship). % chốt vào đơn lúc gắn (đổi % chỉ áp dụng cho đơn sau). Chỉ trả 1 tầng: không tính đơn của người CTV giới thiệu
//   (nhiều tầng = bán hàng đa cấp, NĐ 40/2018 phải có giấy phép).
// - Đủ điều kiện trả: đơn Đã giao, qua 7 ngày đổi trả. Trả cá nhân từ 2 triệu / lần → khấu trừ 10% thuế TNCN.
// - Khách cũ giới thiệu: mã giảm giá riêng của khách (vouchers.ref_phone, chỉ khách mua lần đầu dùng được). Bạn đặt đơn → sale phụ trách khách cũ
//   được nhắc ở tab Hôm nay "🎁 Cảm ơn khách giới thiệu" để tặng quà hoặc voucher (sale chọn).
import { all, first, run, kvGet, kvSet, normPhone, fmt, nrm, isVoid, refCode } from './lib.js';
import { vcNorm, vcLabel } from './voucher.js';

const DAY = 864e5, RETURN_DAYS = 7, TAX_FROM = 2000000, TAX_PCT = 10;
const DEF = { rate: 10, months: 6, refPct: 10 };
export async function partnerCfg(x) { let c = {}; try { c = JSON.parse((await kvGet(x.db, 'partner_cfg')) || '{}'); } catch (e) { } return Object.assign({}, DEF, c); }

export async function partnerSchema(db) {
  await run(db, `CREATE TABLE IF NOT EXISTS partners (
    code TEXT PRIMARY KEY, name TEXT DEFAULT '', phone TEXT DEFAULT '', email TEXT DEFAULT '', kind TEXT DEFAULT 'CTV', rate REAL DEFAULT 10,
    bank TEXT DEFAULT '', idno TEXT DEFAULT '', note TEXT DEFAULT '', vcode TEXT DEFAULT '', active INTEGER DEFAULT 1, created INTEGER, by_name TEXT DEFAULT ''
  )`);
  await run(db, `CREATE TABLE IF NOT EXISTS partner_pay (
    id INTEGER PRIMARY KEY AUTOINCREMENT, code TEXT, at INTEGER, amount INTEGER DEFAULT 0, tax INTEGER DEFAULT 0, net INTEGER DEFAULT 0, n INTEGER DEFAULT 0, note TEXT DEFAULT '', by_name TEXT DEFAULT ''
  )`);
  const add = async (t, cols) => { const have = (await all(db, `PRAGMA table_info(${t})`)).map(r => r.name); for (const [c, d] of cols) if (!have.includes(c)) { try { await run(db, `ALTER TABLE ${t} ADD COLUMN ${c} ${d}`); } catch (e) { } } };
  await add('orders', [['partner', "TEXT DEFAULT ''"], ['partner_rate', 'REAL DEFAULT 0'], ['paid_out', 'INTEGER DEFAULT 0'], ['ref_phone', "TEXT DEFAULT ''"], ['ref_gift', "TEXT DEFAULT ''"]]);
  await add('customers', [['partner', "TEXT DEFAULT ''"], ['partner_at', 'INTEGER']]);
  await add('vouchers', [['ref_phone', "TEXT DEFAULT ''"], ['partner', "TEXT DEFAULT ''"], ['new_only', 'INTEGER DEFAULT 0']]);
  await run(db, 'CREATE INDEX IF NOT EXISTS orders_partner ON orders(partner)');
  await run(db, 'CREATE INDEX IF NOT EXISTS orders_ref_phone ON orders(ref_phone)');
}

/** Gắn CTV cho mọi đơn còn trống của khách thuộc CTV, trong thời hạn tính từ lúc khách thuộc CTV (gồm đơn sale nhập tay / nhập file). */
export async function partnerFill(x) {
  const cfg = await partnerCfg(x), win = Math.round(cfg.months * 30.44 * DAY);
  await run(x.db, `UPDATE orders SET partner = (SELECT c.partner FROM customers c WHERE c.phone = orders.phone),
      partner_rate = coalesce((SELECT p.rate FROM customers c JOIN partners p ON p.code = c.partner WHERE c.phone = orders.phone), ?)
    WHERE coalesce(partner, '') = '' AND EXISTS (SELECT 1 FROM customers c WHERE c.phone = orders.phone AND coalesce(c.partner, '') != '' AND c.partner_at IS NOT NULL
      AND orders.time >= c.partner_at - 3600000 AND orders.time <= c.partner_at + ?)`, cfg.rate, win);
}

/** Gọi trong saveOrder sau khi lưu đơn (đơn web): ghi khách giới thiệu / CTV. isNew = khách chưa có đơn nào trước đơn này. Trả thông tin để báo Telegram + ghi chú. */
export async function orderAttrib(x, { id, phone, ref, voucher, isNew }) {
  const out = {}; let v = null, pc = '';
  if (voucher) v = await first(x.db, 'SELECT ref_phone, partner FROM vouchers WHERE code = ?', String(voucher));
  if (v && v.ref_phone) {
    const rc = await first(x.db, 'SELECT name, owner FROM customers WHERE phone = ?', v.ref_phone);
    await run(x.db, 'UPDATE orders SET ref_phone = ? WHERE id = ? AND phone = ?', v.ref_phone, String(id), phone);
    out.refPhone = v.ref_phone; out.refName = rc ? rc.name || '' : ''; out.refOwner = rc ? rc.owner || '' : '';
  }
  if (ref) { const p = await first(x.db, 'SELECT code FROM partners WHERE code = ? AND active = 1', refCode(ref)); if (p) pc = p.code; }
  if (!pc && v && v.partner) pc = v.partner;
  if (pc && isNew) await run(x.db, "UPDATE customers SET partner = ?, partner_at = ? WHERE phone = ? AND coalesce(partner, '') = ''", pc, Date.now(), phone);
  const c = await first(x.db, 'SELECT partner FROM customers WHERE phone = ?', phone);
  if (c && c.partner) { await partnerFill(x); const p = await first(x.db, 'SELECT name FROM partners WHERE code = ?', c.partner); const o = await first(x.db, 'SELECT partner FROM orders WHERE id = ? AND phone = ?', String(id), phone); if (o && o.partner) out.partner = p ? p.name : c.partner; }
  return out;
}

/* ------------------------------------------------------------ 🎁 Khách cũ giới thiệu */
/** Mã giới thiệu của khách cũ: TÊN + 3 số cuối SĐT (HUONG522). Đã có thì trả mã cũ. */
async function refCodeFor(x, u, d, log) {
  const phone = normPhone(d.phone), c = await first(x.db, 'SELECT name FROM customers WHERE phone = ?', phone);
  if (!c) return { ok: false, error: 'Không tìm thấy khách.' };
  const cfg = await partnerCfg(x), used = async code => (await first(x.db, "SELECT count(*) AS n FROM orders WHERE voucher = ? AND status NOT LIKE '%uỷ%' AND status NOT LIKE '%ủy%' AND status NOT LIKE '%oàn%'", code)).n;
  const old = await first(x.db, 'SELECT * FROM vouchers WHERE ref_phone = ? AND active = 1 ORDER BY created LIMIT 1', phone);
  if (old) return { ok: true, code: old.code, label: vcLabel(old), used: await used(old.code) };
  const w = vcNorm(String(c.name || '').replace(/\(.*?\)/g, ' ').trim().split(/\s+/).pop() || 'BAN').slice(0, 8) || 'BAN';
  let code = w + phone.slice(-3), i = 1;
  while (await first(x.db, 'SELECT code FROM vouchers WHERE code = ?', code)) code = w + phone.slice(-3) + (++i);
  await run(x.db, "INSERT INTO vouchers (code, kind, value, max_off, min_sub, exp, max_uses, once, phone, note, active, created, by_name, ref_phone, new_only) VALUES (?, 'percent', ?, 0, 0, '', 0, 1, '', ?, 1, ?, ?, ?, 1)",
    code, cfg.refPct, 'Mã giới thiệu của ' + (c.name || phone), Date.now(), u.name, phone);
  await log(x, u, 'Mã giới thiệu', phone, c.name, code, 'Bạn bè giảm ' + cfg.refPct + '% đơn đầu');
  return { ok: true, code, label: 'Giảm ' + cfg.refPct + '%', used: 0, isNew: true };
}
/** Sale tặng quà / voucher cảm ơn khách đã giới thiệu (theo đơn của người được giới thiệu). */
async function refGift(x, u, d, log) {
  const o = await first(x.db, 'SELECT id, phone, name, ref_phone, ref_gift, total FROM orders WHERE id = ? ORDER BY rid LIMIT 1', String(d.id));
  if (!o || !o.ref_phone) return { ok: false, error: 'Đơn này không có khách giới thiệu.' };
  if (o.ref_gift) return { ok: false, error: 'Đã tặng rồi: ' + o.ref_gift };
  const rc = await first(x.db, 'SELECT name FROM customers WHERE phone = ?', o.ref_phone), day = new Date(Date.now() + 7 * 3600e3).toISOString().slice(0, 10).split('-').reverse().join('/');
  let txt = '', code = '', label = '';
  if (d.kind === 'voucher') {
    const kind = d.vkind === 'percent' ? 'percent' : 'amount', value = Math.max(0, Number(d.value) || 0);
    if (kind === 'percent' ? !(value > 0 && value <= 50) : !(value >= 10000)) return { ok: false, error: kind === 'percent' ? 'Phần trăm giảm từ 1 đến 50.' : 'Số tiền giảm từ 10.000đ.' };
    const exp = new Date(Date.now() + 90 * DAY + 7 * 3600e3).toISOString().slice(0, 10);
    code = 'CAMON' + o.ref_phone.slice(-4); let i = 1; while (await first(x.db, 'SELECT code FROM vouchers WHERE code = ?', code)) code = 'CAMON' + o.ref_phone.slice(-4) + (++i);
    await run(x.db, "INSERT INTO vouchers (code, kind, value, max_off, min_sub, exp, max_uses, once, phone, note, active, created, by_name) VALUES (?, ?, ?, 0, 0, ?, 1, 1, ?, ?, 1, ?, ?)",
      code, kind, value, exp, o.ref_phone, 'Cảm ơn giới thiệu đơn ' + o.id, Date.now(), u.name);
    label = vcLabel({ kind, value }); txt = 'Voucher ' + code + ' (' + label + ', hạn ' + exp.split('-').reverse().join('/') + ')';
  } else {
    const g = String(d.text || '').trim().slice(0, 120); if (!g) return { ok: false, error: 'Ghi quà tặng là gì (vd 1 hũ ruốc rong biển).' };
    txt = 'Quà: ' + g;
  }
  txt += ' · ' + u.name + ' ' + day;
  await run(x.db, 'UPDATE orders SET ref_gift = ? WHERE id = ? AND phone = ?', txt, o.id, o.phone);
  await log(x, u, 'Cảm ơn giới thiệu', o.ref_phone, rc ? rc.name : '', txt, 'Giới thiệu ' + (o.name || o.phone) + ' (đơn ' + o.id + ')');
  return { ok: true, gift: txt, code, label };
}

/* ------------------------------------------------------------ 🤝 CTV / đối tác (Quản lý trở lên) */
const ready = o => /đã giao/i.test(o.status || '') && (Number(o.received_at) || Number(o.ship_at) || Number(o.time) || 0) + RETURN_DAYS * DAY <= Date.now();
const comm = o => Math.max(0, Math.round(((Number(o.total) || 0) - (Number(o.shipping) || 0)) * (Number(o.partner_rate) || 0) / 100));
function mask(name, phone) {
  const n = String(name || '').trim().split(/\s+/).filter(Boolean).map(w => w[0] + '***').join(' ');
  return (n || 'Khách') + ' · ' + String(phone || '').slice(0, 3) + '****' + String(phone || '').slice(-3);
}
async function pList(x) {
  await partnerFill(x);
  const ps = await all(x.db, 'SELECT p.*, (SELECT v.value FROM vouchers v WHERE v.code = p.vcode AND v.active = 1) AS vpct FROM partners p ORDER BY p.active DESC, p.created');
  const os = await all(x.db, "SELECT id, phone, status, total, shipping, partner, partner_rate, paid_out, time, ship_at, received_at FROM orders WHERE coalesce(partner, '') != ''");
  const pays = await all(x.db, 'SELECT * FROM partner_pay ORDER BY id DESC LIMIT 200');
  const st = {};
  os.forEach(o => {
    const s = st[o.partner] || (st[o.partner] = { cust: {}, n: 0, sales: 0, ready: 0, readyN: 0, wait: 0, waitN: 0, paid: 0 });
    if (isVoid(o.status)) return;
    s.cust[o.phone] = 1; s.n++; s.sales += (Number(o.total) || 0) - (Number(o.shipping) || 0);
    if (o.paid_out) return;
    if (ready(o)) { s.ready += comm(o); s.readyN++; } else { s.wait += comm(o); s.waitN++; }
  });
  pays.forEach(p => { const s = st[p.code]; if (s) s.paid += p.amount; });
  const refs = await first(x.db, "SELECT (SELECT count(*) FROM vouchers WHERE coalesce(ref_phone, '') != '') AS codes, (SELECT count(*) FROM orders WHERE coalesce(ref_phone, '') != '' AND status NOT LIKE '%uỷ%' AND status NOT LIKE '%ủy%' AND status NOT LIKE '%oàn%') AS orders, (SELECT count(*) FROM orders WHERE coalesce(ref_gift, '') != '') AS gifts");
  return {
    ok: true, cfg: await partnerCfg(x), refs,
    list: ps.map(p => { const s = st[p.code] || { cust: {}, n: 0, sales: 0, ready: 0, readyN: 0, wait: 0, waitN: 0, paid: 0 }; return { code: p.code, name: p.name, phone: p.phone, email: p.email, kind: p.kind, rate: p.rate, bank: p.bank, idno: p.idno, note: p.note, vcode: p.vcode, vpct: p.vpct || '', active: !!p.active, created: p.created, by: p.by_name, cust: Object.keys(s.cust).length, n: s.n, sales: s.sales, ready: s.ready, readyN: s.readyN, wait: s.wait, waitN: s.waitN, paid: s.paid }; }),
    pays: pays.map(p => ({ id: p.id, code: p.code, at: p.at, amount: p.amount, tax: p.tax, net: p.net, n: p.n, note: p.note, by: p.by_name }))
  };
}
async function pSave(x, u, d, log, staffNames) {
  const code = refCode(d.code || d.name), name = String(d.name || '').trim().slice(0, 80);
  if (!name) return { ok: false, error: 'Nhập tên cộng tác viên.' };
  if (code.length < 3) return { ok: false, error: 'Mã link cần ít nhất 3 chữ cái hoặc số (không dấu).' };
  if (staffNames.some(n => refCode(n) === code)) return { ok: false, error: 'Mã "' + code + '" trùng link của nhân sự. Đặt mã khác (vd thêm họ hoặc số).' };
  const old = await first(x.db, 'SELECT * FROM partners WHERE code = ?', code);
  if (d.isNew && old) return { ok: false, error: 'Mã "' + code + '" đã có (' + old.name + '). Đặt mã khác nhé.' };
  const cfg = await partnerCfg(x), rate = d.rate === '' || d.rate == null ? cfg.rate : Number(d.rate);
  if (!(rate >= 0 && rate <= 50)) return { ok: false, error: '% hoa hồng từ 0 đến 50.' };
  const phone = normPhone(d.phone); if (d.phone && !/^0\d{9,10}$/.test(phone)) return { ok: false, error: 'Số điện thoại chưa đúng.' };
  // mã giảm giá cho khách của CTV (tuỳ chọn): % giảm đơn đầu, chỉ khách mới
  let vcode = old ? old.vcode || '' : '';
  const vp = Number(d.vpct) || 0;
  if (vp > 0) {
    if (vp > 30) return { ok: false, error: 'Mã giảm giá cho khách của CTV tối đa 30%.' };
    const want = vcNorm(d.vcode || code), hit = await first(x.db, 'SELECT code, partner FROM vouchers WHERE code = ?', want);
    if (hit && hit.partner !== code) return { ok: false, error: 'Mã giảm giá ' + want + ' đã dùng cho việc khác. Đặt mã khác nhé.' };
    if (hit) await run(x.db, "UPDATE vouchers SET kind = 'percent', value = ?, active = ?, new_only = 1, once = 1 WHERE code = ?", vp, d.active === false ? 0 : 1, want);
    else await run(x.db, "INSERT INTO vouchers (code, kind, value, max_off, min_sub, exp, max_uses, once, phone, note, active, created, by_name, partner, new_only) VALUES (?, 'percent', ?, 0, 0, '', 0, 1, '', ?, ?, ?, ?, ?, 1)", want, vp, 'Mã của CTV ' + name, d.active === false ? 0 : 1, Date.now(), u.name, code);
    if (vcode && vcode !== want) await run(x.db, 'UPDATE vouchers SET active = 0 WHERE code = ? AND partner = ?', vcode, code);
    vcode = want;
  } else if (vcode) { await run(x.db, 'UPDATE vouchers SET active = 0 WHERE code = ? AND partner = ?', vcode, code); vcode = ''; }
  const row = [name, phone, String(d.email || '').trim().slice(0, 120), d.kind === 'Đối tác' ? 'Đối tác' : 'CTV', rate, String(d.bank || '').slice(0, 200), String(d.idno || '').slice(0, 30), String(d.note || '').slice(0, 300), vcode, d.active === false ? 0 : 1];
  if (old) await run(x.db, 'UPDATE partners SET name = ?, phone = ?, email = ?, kind = ?, rate = ?, bank = ?, idno = ?, note = ?, vcode = ?, active = ? WHERE code = ?', ...row, code);
  else await run(x.db, 'INSERT INTO partners (name, phone, email, kind, rate, bank, idno, note, vcode, active, code, created, by_name) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)', ...row, code, Date.now(), u.name);
  await log(x, u, old ? 'Sửa CTV' : 'Thêm CTV', code, name, rate + '%' + (vcode ? ' · mã ' + vcode : '') + (row[9] ? '' : ' · tạm dừng'), '');
  return pList(x);
}
async function pOrders(x, code) {
  await partnerFill(x);
  const p = await first(x.db, 'SELECT * FROM partners WHERE code = ?', code); if (!p) return { ok: false, error: 'Không tìm thấy CTV.' };
  const os = await all(x.db, "SELECT id, phone, name, status, total, shipping, partner_rate, paid_out, time, ship_at, received_at FROM orders WHERE partner = ? ORDER BY time DESC LIMIT 1000", code);
  return { ok: true, list: os.map(o => ({ id: o.id, who: mask(o.name, o.phone), phone: o.phone, time: o.time, status: o.status, goods: (Number(o.total) || 0) - (Number(o.shipping) || 0), rate: o.partner_rate, comm: isVoid(o.status) ? 0 : comm(o), ready: !isVoid(o.status) && !o.paid_out && ready(o), paid: o.paid_out || 0, void: isVoid(o.status) })) };
}
async function pPay(x, u, d, log) {
  const code = String(d.code || ''), ids = (Array.isArray(d.ids) ? d.ids : []).map(String).slice(0, 500);
  if (!ids.length) return { ok: false, error: 'Chưa chọn đơn nào.' };
  const os = (await all(x.db, "SELECT rid, id, status, total, shipping, partner_rate, paid_out, time, ship_at, received_at FROM orders WHERE partner = ? AND id IN (SELECT value FROM json_each(?))", code, JSON.stringify(ids))).filter(o => !o.paid_out && !isVoid(o.status) && ready(o));
  if (!os.length) return { ok: false, error: 'Các đơn đã chọn chưa đủ điều kiện (đã giao + qua 7 ngày) hoặc đã trả rồi.' };
  const amount = os.reduce((s, o) => s + comm(o), 0), tax = amount >= TAX_FROM ? Math.round(amount * TAX_PCT / 100) : 0;
  const r = await run(x.db, 'INSERT INTO partner_pay (code, at, amount, tax, net, n, note, by_name) VALUES (?, ?, ?, ?, ?, ?, ?, ?)', code, Date.now(), amount, tax, amount - tax, os.length, String(d.note || '').slice(0, 200), u.name);
  const pid = r.meta.last_row_id;
  await run(x.db, 'UPDATE orders SET paid_out = ? WHERE rid IN (SELECT value FROM json_each(?))', pid, JSON.stringify(os.map(o => o.rid)));
  await log(x, u, 'Trả hoa hồng CTV', code, '', fmt(amount - tax) + (tax ? ' (đã trừ thuế ' + fmt(tax) + ')' : ''), os.length + ' đơn');
  return Object.assign(await pList(x), { paid: { amount, tax, net: amount - tax, n: os.length } });
}
async function pClaim(x, u, d, log) {
  const code = String(d.code || ''), phone = normPhone(d.phone);
  const p = await first(x.db, 'SELECT name FROM partners WHERE code = ?', code); if (!p) return { ok: false, error: 'Không tìm thấy CTV.' };
  const c = await first(x.db, 'SELECT name, partner, first FROM customers WHERE phone = ?', phone);
  if (!c) return { ok: false, error: 'Chưa có khách số ' + phone + ' trong CRM (khách cần có ít nhất 1 đơn).' };
  if (c.partner && c.partner !== code) return { ok: false, error: 'Khách này đã thuộc CTV khác (' + c.partner + ').' };
  await run(x.db, 'UPDATE customers SET partner = ?, partner_at = ? WHERE phone = ?', code, Number(c.first) || Date.now(), phone);
  await log(x, u, 'Gắn khách cho CTV', phone, c.name, p.name, '');
  return pList(x);
}

/** Lệnh CRM. ref_code / ref_gift: sale làm cho khách mình (crm.js kiểm tra người phụ trách trước). Còn lại: Quản lý trở lên. */
export async function crmPartner(x, u, d, log, staffNames) {
  const a = d.action;
  if (a === 'ref_code') return refCodeFor(x, u, d, log);
  if (a === 'ref_gift') return refGift(x, u, d, log);
  if (u.level < 2) return { ok: false, error: 'Chỉ Quản lý và Quản trị quản lý cộng tác viên.' };
  if (a === 'partner_list') return pList(x);
  if (a === 'partner_save') return pSave(x, u, d, log, staffNames);
  if (a === 'partner_orders') return pOrders(x, String(d.code || ''));
  if (a === 'partner_pay') return pPay(x, u, d, log);
  if (a === 'partner_claim') return pClaim(x, u, d, log);
  if (a === 'partner_cfg') {
    const c = await partnerCfg(x), rate = Number(d.rate), months = Math.round(Number(d.months)), refPct = Number(d.refPct);
    if (!(rate >= 0 && rate <= 50) || !(months >= 1 && months <= 36) || !(refPct >= 0 && refPct <= 30)) return { ok: false, error: 'Kiểm tra lại: hoa hồng 0–50%, thời hạn 1–36 tháng, giảm cho bạn được giới thiệu 0–30%.' };
    await kvSet(x.db, 'partner_cfg', JSON.stringify({ rate, months, refPct }));
    if (refPct !== c.refPct) await run(x.db, "UPDATE vouchers SET value = ? WHERE coalesce(ref_phone, '') != '' AND kind = 'percent'", refPct); // mã giới thiệu đã phát theo % mới
    await log(x, u, 'Cài đặt CTV', '', '', 'Hoa hồng ' + rate + '% · ' + months + ' tháng · bạn được giới thiệu giảm ' + refPct + '%', '');
    return pList(x);
  }
  return { ok: false, error: 'Không rõ thao tác: ' + a };
}
