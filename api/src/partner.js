// 🤝 Cộng tác viên / đối tác (affiliate 1 tầng) + 🎁 khách cũ giới thiệu bạn bè (16/10/2026).
// - CTV có link thucduonglanh.vn/?ref=<mã> và (tuỳ chọn) mã giảm giá cho khách của mình. Khách MỚI đặt qua link / mã → khách thuộc CTV;
//   mọi đơn của khách đó trong `months` tháng (mặc định 6, kể cả đơn sale lên lại / nhập file) được tính hoa hồng `rate`% (mặc định 10)
//   trên tiền hàng (tổng − phí ship). % chốt vào đơn lúc gắn (đổi % chỉ áp dụng cho đơn sau). Chỉ trả 1 tầng: không tính đơn của người CTV giới thiệu
//   (nhiều tầng = bán hàng đa cấp, NĐ 40/2018 phải có giấy phép).
// - Đủ điều kiện trả: đơn Đã giao, qua 7 ngày đổi trả. Trả cá nhân từ 2 triệu / lần → khấu trừ 10% thuế TNCN.
// - Khách cũ giới thiệu: mã giảm giá riêng của khách (vouchers.ref_phone, chỉ khách mua lần đầu dùng được). Bạn đặt đơn → sale phụ trách khách cũ
//   được nhắc ở tab Hôm nay "🎁 Cảm ơn khách giới thiệu".
// - "Đại sứ Sống Lành" (28/10/2026): khách tự lấy link ở thucduonglanh.vn/gioi-thieu-ban-be/ (refMe) hoặc trang cảm ơn sau khi đặt; bạn bè gõ SĐT người
//   giới thiệu vào ô mã ưu đãi cũng được (voucher.js). Đơn của bạn đã giao + 7 ngày → refAuto tự phát voucher CAMON = rwPct % tiền hàng của bạn
//   (gắn SĐT người giới thiệu, hạn 90 ngày), sale chỉ việc báo khách. Đủ tierN bạn mua → tặng tierGift (1 hộp Trà DILVANG), đủ ctvN → mời làm CTV.
//   Chống gian lận: không tính đơn trùng SĐT / trùng địa chỉ người giới thiệu, đơn huỷ / hoàn.
import { all, first, run, kvGet, kvSet, normPhone, fmt, nrm, isVoid, refCode, randHex } from './lib.js';
import { vcNorm, vcLabel, makeRefCode } from './voucher.js';

const LIVE = "status NOT LIKE '%uỷ%' AND status NOT LIKE '%ủy%' AND status NOT LIKE '%oàn%'";
const DAY = 864e5, RETURN_DAYS = 7, TAX_FROM = 2000000, TAX_PCT = 10;
const DEF = { rate: 10, months: 6, refPct: 10, rwPct: 10, auto: 1, tierN: 3, tierGift: '1 hộp Trà DILVANG', ctvN: 5, bonus: 50000, goalN: 20, goalGift: 'Liên hoan cả nhóm' };
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
  await add('partners', [['view_key', "TEXT DEFAULT ''"]]); // link bí mật CTV tự xem hoa hồng: thucduonglanh.vn/ctv/#<view_key>
  await add('vouchers', [['ref_phone', "TEXT DEFAULT ''"], ['partner', "TEXT DEFAULT ''"], ['new_only', 'INTEGER DEFAULT 0']]);
  await add('orders', [['ref_told', 'INTEGER DEFAULT 0']]); // đã báo khách voucher cảm ơn tự động
  // mốc thưởng của người giới thiệu: tier = số bạn (3 → quà, 5 → mời làm CTV). done_at trống = sale chưa làm
  await run(db, `CREATE TABLE IF NOT EXISTS ref_tiers (phone TEXT, tier INTEGER, at INTEGER, done_at INTEGER, done_by TEXT DEFAULT '', note TEXT DEFAULT '', PRIMARY KEY (phone, tier))`);
  // 🌱 sale được ghi công khách mới nhờ khách cũ giới thiệu (30/10/2026): 1 dòng / khách mới. ok_at = lúc đủ điều kiện thưởng, void = 1 không thưởng (trùng địa chỉ người giới thiệu)
  await run(db, `CREATE TABLE IF NOT EXISTS ref_sale (phone TEXT PRIMARY KEY, sale TEXT DEFAULT '', ref_phone TEXT DEFAULT '', at INTEGER, src TEXT DEFAULT '', amount INTEGER DEFAULT 0, ok_at INTEGER, order_id TEXT DEFAULT '', void INTEGER DEFAULT 0, by_name TEXT DEFAULT '')`);
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
/** Sale bấm 🎁 Mã giới thiệu trong hồ sơ khách (mã tạo ở voucher.js makeRefCode, dùng chung với web). */
async function refCodeFor(x, u, d) {
  const phone = normPhone(d.phone), cfg = await partnerCfg(x);
  if (!await first(x.db, 'SELECT phone FROM customers WHERE phone = ?', phone)) return { ok: false, error: 'Không tìm thấy khách.' };
  const r = await makeRefCode(x, phone, u.name, cfg.refPct);
  if (!r) return { ok: false, error: 'Khách chưa có đơn hàng nào (không tính đơn huỷ / hoàn) nên chưa tạo được mã giới thiệu.' };
  return { ok: true, code: r.code, label: r.label, used: (await first(x.db, "SELECT count(*) AS n FROM orders WHERE voucher = ? AND " + LIVE, r.code)).n, isNew: !!r.isNew, cfg: { rwPct: cfg.rwPct, tierN: cfg.tierN, tierGift: cfg.tierGift, auto: cfg.auto } };
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

/* ------------------------------------------------------------ 🌱 Đại sứ Sống Lành: tự thưởng người giới thiệu (28/10/2026) */
const vnDay = t => new Date(t + 7 * 3600e3).toISOString().slice(0, 10);
const addrKey = (a, w) => { const k = nrm(a).replace(/[^a-z0-9]/g, ''); return k.length >= 5 ? k + '|' + nrm(w).replace(/[^a-z0-9]/g, '') : ''; }; // số nhà + đường + phường
const maskName = n => String(n || '').trim().split(/\s+/).filter(Boolean).map(w => w[0].toUpperCase() + '***').join(' ') || 'Một người bạn';
const rewarded = "coalesce(ref_gift, '') != '' AND ref_gift NOT LIKE '⛔%'";
/** Chạy theo lịch (cron.js, 8h sáng): đơn của người được giới thiệu đã giao + 7 ngày mà chưa cảm ơn → tạo voucher CAMON cho người giới thiệu;
 *  đủ mốc → ghi ref_tiers để sale tặng quà / mời làm CTV. Trả danh sách tin báo Telegram [{owner, text}]. */
export async function refAuto(x) {
  const cfg = await partnerCfg(x), out = [], hit = {};
  if (!cfg.auto) return out;
  const os = (await all(x.db, "SELECT id, phone, name, address, ward, total, shipping, status, time, ship_at, received_at, ref_phone FROM orders WHERE coalesce(ref_phone, '') != '' AND coalesce(ref_gift, '') = '' AND status LIKE '%giao%'")).filter(ready);
  for (const o of os) {
    const rp = o.ref_phone, rc = (await first(x.db, 'SELECT name, owner, address, ward FROM customers WHERE phone = ?', rp)) || {}, who = rc.name || rp, ak = addrKey(o.address, o.ward);
    const same = o.phone === rp ? 'trùng số điện thoại' : ak && ak === addrKey(rc.address, rc.ward) ? 'trùng địa chỉ nhận hàng' : '';
    let txt;
    if (same) txt = '⛔ Không tự tặng: ' + same + ' với người giới thiệu (quản lý xem lại, muốn tặng thì tạo mã ở 🎟 Mã ưu đãi)';
    else {
      const value = Math.max(10000, Math.floor(((Number(o.total) || 0) - (Number(o.shipping) || 0)) * cfg.rwPct / 100 / 1000) * 1000), exp = vnDay(Date.now() + 90 * DAY);
      let code = 'CAMON' + rp.slice(-4), i = 0; while (await first(x.db, 'SELECT code FROM vouchers WHERE code = ?', code)) code = 'CAMON' + rp.slice(-4) + 'BCDEFGHKMNPQRSTUVXYZ'.charAt(i++ % 20) + (i > 20 ? Math.ceil(i / 20) : ''); // CAMON5522, CAMON5522B, CAMON5522C…
      await run(x.db, "INSERT INTO vouchers (code, kind, value, max_off, min_sub, exp, max_uses, once, phone, note, active, created, by_name) VALUES (?, 'amount', ?, 0, 0, ?, 1, 1, ?, ?, 1, ?, 'Tự động')",
        code, value, exp, rp, 'Cảm ơn giới thiệu đơn ' + o.id + ' (tự động)', Date.now());
      txt = 'Voucher ' + code + ' (' + vcLabel({ kind: 'amount', value }) + ', hạn ' + exp.split('-').reverse().join('/') + ') · Tự động ' + vnDay(Date.now()).split('-').reverse().slice(0, 2).join('/');
      hit[rp] = 1;
    }
    await run(x.db, 'UPDATE orders SET ref_gift = ? WHERE id = ? AND phone = ?', txt, o.id, o.phone);
    await run(x.db, 'INSERT INTO logs (time, by_name, what, ref, name, result, note) VALUES (?, ?, ?, ?, ?, ?, ?)', Date.now(), 'Tự động', 'Cảm ơn giới thiệu', rp, rc.name || '', txt, 'Giới thiệu ' + (o.name || o.phone) + ' (đơn ' + o.id + ')');
    out.push({ owner: rc.owner || '', text: same ? '⛔ Không tự tặng quà cho ' + who + ' (giới thiệu ' + (o.name || o.phone) + ', đơn ' + o.id + '): ' + same + '. Quản lý xem lại.'
      : '🎁 ' + who + ' giới thiệu ' + (o.name || o.phone) + ' (đơn ' + o.id + ' đã giao) → ' + txt.split(' · ')[0] + '. Vào tab Hôm nay bấm "Báo khách" để gửi mã qua Zalo.' });
  }
  for (const rp of Object.keys(hit)) {
    const n = (await first(x.db, 'SELECT count(DISTINCT phone) AS n FROM orders WHERE ref_phone = ? AND ' + rewarded, rp)).n;
    const rc = (await first(x.db, 'SELECT name, owner, partner FROM customers WHERE phone = ?', rp)) || {}, who = rc.name || rp;
    for (const [tier, msg] of [[cfg.tierN, '🏅 ' + who + ' đã giới thiệu ' + n + ' người mua → tặng ' + cfg.tierGift + '. Vào tab Hôm nay bấm "Đã gửi quà" khi gửi xong.'],
      [cfg.ctvN, '🌟 ' + who + ' đã giới thiệu ' + n + ' người mua → mời làm Cộng tác viên (hoa hồng ' + cfg.rate + '%). Quản lý thêm CTV ở Cài đặt → 🤝.']]) {
      if (!(tier > 0) || n < tier || (tier === cfg.ctvN && rc.partner)) continue;
      const r = await run(x.db, 'INSERT OR IGNORE INTO ref_tiers (phone, tier, at) VALUES (?, ?, ?)', rp, tier, Date.now());
      if (r && r.meta && r.meta.changes) out.push({ owner: rc.owner || '', text: msg });
    }
  }
  return out;
}

/* ------------------------------------------------------------ 🌱 Sale giữ khách + thưởng khách mới nhờ khách cũ giới thiệu (30/10/2026) */
// Anh Sơn chọn: khách MỚI (số chưa có trong CRM: chưa là khách, chưa là khách hỏi, chưa có đơn) do khách cũ giới thiệu → thuộc về sale đang phụ trách
// khách cũ đó; sale được thưởng `bonus`đ (mặc định 50.000) khi đơn đầu của khách mới đã giao + 7 ngày. Mục tiêu cả nhóm: goalN khách mới / tháng → goalGift.
/** Ghi công cho sale nếu đủ điều kiện. Trả tên sale (rồi người gọi giao khách cho sale đó) hoặc ''. skipLead = id khách hỏi vừa tạo cho chính lượt này. */
export async function refClaim(x, phone, refPhone, src, by, skipLead) {
  phone = normPhone(phone); refPhone = normPhone(refPhone);
  if (!phone || !refPhone || phone === refPhone) return '';
  const rc = await first(x.db, "SELECT owner FROM customers WHERE phone = ? AND orders > 0 AND coalesce(owner, '') != ''", refPhone); if (!rc) return '';
  const su = await first(x.db, 'SELECT role, active FROM users WHERE name = ?', rc.owner); if (su && (!su.active || su.role === 'Marketing')) return ''; // sale đã nghỉ → không ghi công
  if (await first(x.db, 'SELECT phone FROM ref_sale WHERE phone = ?', phone) || await first(x.db, 'SELECT phone FROM customers WHERE phone = ?', phone) ||
    await first(x.db, 'SELECT rid FROM orders WHERE phone = ? LIMIT 1', phone) || await first(x.db, 'SELECT rid FROM leads WHERE phone = ? AND id != ? LIMIT 1', phone, String(skipLead || ''))) return ''; // đã có trong CRM
  const cfg = await partnerCfg(x);
  await run(x.db, 'INSERT OR IGNORE INTO ref_sale (phone, sale, ref_phone, at, src, amount, by_name) VALUES (?, ?, ?, ?, ?, ?, ?)', phone, rc.owner, refPhone, Date.now(), src, Math.round(Number(cfg.bonus) || 0), by || '');
  return rc.owner;
}
/** Cron 8h: đơn đầu (không huỷ / hoàn) của khách mới đã giao + 7 ngày → ghi thưởng cho sale. Trả [{owner, text}] để báo Telegram. */
export async function refSaleAuto(x) {
  const out = [];
  for (const r of await all(x.db, 'SELECT * FROM ref_sale WHERE ok_at IS NULL AND void = 0')) {
    const o = await first(x.db, 'SELECT id, name, address, ward, status, time, ship_at, received_at FROM orders WHERE phone = ? AND ' + LIVE + ' ORDER BY time LIMIT 1', r.phone);
    if (!o || !ready(o)) continue;
    const rc = (await first(x.db, 'SELECT name, address, ward FROM customers WHERE phone = ?', r.ref_phone)) || {}, ak = addrKey(o.address, o.ward);
    if (ak && ak === addrKey(rc.address, rc.ward)) { // cùng địa chỉ với người giới thiệu → không thưởng, quản lý xem lại
      await run(x.db, 'UPDATE ref_sale SET void = 1, order_id = ? WHERE phone = ?', o.id, r.phone);
      out.push({ owner: r.sale, text: '⛔ Không tính thưởng giới thiệu cho ' + r.sale + ': ' + (o.name || r.phone) + ' trùng địa chỉ với người giới thiệu ' + (rc.name || r.ref_phone) + ' (đơn ' + o.id + '). Quản lý xem lại.' });
      continue;
    }
    await run(x.db, 'UPDATE ref_sale SET ok_at = ?, order_id = ? WHERE phone = ?', Date.now(), o.id, r.phone);
    if (r.amount > 0) out.push({ owner: r.sale, text: '🎉 ' + r.sale + ' +' + fmt(r.amount) + ' thưởng giới thiệu: ' + (o.name || r.phone) + ' (do ' + (rc.name || r.ref_phone) + ' giới thiệu) đã nhận hàng đơn ' + o.id + '.' });
  }
  return out;
}
/** CRM: danh sách khách mới nhờ giới thiệu (sale chỉ thấy của mình) + số của cả nhóm theo tháng (mục tiêu nhóm) + khách đã có mã giới thiệu (để mời làm Đại sứ). */
async function bonusList(x, u) {
  const cfg = await partnerCfg(x), since = Date.now() - 400 * DAY;
  const rows = await all(x.db, `SELECT r.phone, r.sale, r.ref_phone, r.at, r.src, r.amount, r.ok_at, r.order_id, r.void, c.name AS name, rc.name AS ref_name,
    (SELECT name FROM leads l WHERE l.phone = r.phone ORDER BY l.rid LIMIT 1) AS lname,
    (SELECT o.time || '|' || o.status FROM orders o WHERE o.phone = r.phone AND o.${LIVE.replace(/ AND status/g, ' AND o.status')} ORDER BY o.time LIMIT 1) AS fo,
    (SELECT count(*) FROM orders o WHERE o.phone = r.phone) AS n
    FROM ref_sale r LEFT JOIN customers c ON c.phone = r.phone LEFT JOIN customers rc ON rc.phone = r.ref_phone WHERE r.at >= ?`, since);
  const team = {}, L = rows.map(r => {
    const f = r.fo ? String(r.fo).split('|') : null, ft = f ? Number(f[0]) : null;
    const st = r.void ? 'void' : r.ok_at ? 'ok' : !f ? (r.n ? 'void' : 'wait') : /đã giao/i.test(f[1]) ? 'hold' : 'ship';
    if (ft && !r.void) { const m = new Date(ft + 7 * 3600e3).toISOString().slice(0, 7); team[m] = (team[m] || 0) + 1; }
    return { phone: r.phone, name: r.name || r.lname || '', sale: r.sale, refPhone: r.ref_phone, refName: r.ref_name || '', at: r.at, src: r.src, amount: r.amount || 0, okAt: r.ok_at || null, first: ft, st };
  }).filter(r => u.level >= 2 || r.sale === u.name);
  const inv = (await all(x.db, "SELECT DISTINCT v.ref_phone AS p FROM vouchers v JOIN customers c ON c.phone = v.ref_phone WHERE coalesce(v.ref_phone, '') != ''" + (u.level >= 2 ? '' : ' AND c.owner = ?'), ...(u.level >= 2 ? [] : [u.name]))).map(r => r.p);
  return { ok: true, cfg: { bonus: cfg.bonus, goalN: cfg.goalN, goalGift: cfg.goalGift }, list: L, team, inv };
}

/** Web /gioi-thieu-ban-be/ + trang cảm ơn: khách nhập SĐT đã mua → link / mã giới thiệu, bạn bè đã mua (tên che), voucher đang có, mốc quà.
 *  Không trả tên, địa chỉ: mã giới thiệu ai lấy được cũng chỉ làm lợi cho chủ số; voucher CAMON gắn SĐT nên người khác không dùng được. */
export async function refMe(x, d) {
  const key = 'rfm_' + String(x.ip || 'x').slice(0, 60), tries = Number(await kvGet(x.db, key)) || 0;
  if (tries >= 20) return { ok: false, error: 'Bạn tra cứu nhiều lần quá. Thử lại sau 15 phút, hoặc nhắn Zalo 0966 326 522 nhé.' };
  await kvSet(x.db, key, tries + 1, 15 * 60e3);
  const phone = normPhone(d.phone);
  if (!/^0\d{9,10}$/.test(phone)) return { ok: false, error: 'Số điện thoại chưa đúng, bạn kiểm tra lại giúp nhé.' };
  const cfg = await partnerCfg(x), r = await makeRefCode(x, phone, 'Khách tự lấy trên web', cfg.refPct);
  if (!r) return { ok: false, none: true, error: 'Số ' + phone + ' chưa có đơn hàng nào tại Thực Dưỡng Lành. Sau khi bạn mua lần đầu, link giới thiệu sẽ có ngay tại đây.' };
  const seen = {}, friends = [];
  for (const o of await all(x.db, 'SELECT phone, name, status, time, ref_gift FROM orders WHERE ref_phone = ? ORDER BY time DESC LIMIT 200', phone)) {
    if (seen[o.phone]) continue; seen[o.phone] = 1;
    friends.push({ who: maskName(o.name), at: o.time, st: isVoid(o.status) ? 'void' : /^⛔/.test(o.ref_gift || '') ? 'no' : o.ref_gift ? 'done' : 'wait' });
  }
  const today = vnDay(Date.now()), vouchers = [];
  for (const v of await all(x.db, "SELECT code, kind, value, max_off, exp FROM vouchers WHERE phone = ? AND active = 1 AND coalesce(ref_phone, '') = '' ORDER BY created DESC LIMIT 20", phone)) {
    if (v.exp && v.exp < today) continue;
    if ((await first(x.db, 'SELECT count(*) AS n FROM orders WHERE voucher = ? AND ' + LIVE, v.code)).n) continue;
    vouchers.push({ code: v.code, label: vcLabel(v), exp: v.exp });
  }
  const tiers = (await all(x.db, 'SELECT tier, done_at FROM ref_tiers WHERE phone = ?', phone)).map(t => ({ tier: t.tier, done: !!t.done_at }));
  return { ok: true, code: r.code, pct: cfg.refPct, rwPct: cfg.rwPct, tierN: cfg.tierN, tierGift: cfg.tierGift, friends, n: friends.filter(f => f.st === 'done').length, vouchers, tiers };
}

/** CRM tab Hôm nay: mốc thưởng chưa làm (sale thấy khách mình phụ trách). */
async function tierList(x, u) {
  const cfg = await partnerCfg(x);
  const rows = await all(x.db, "SELECT t.phone, t.tier, t.at, c.name, c.owner, (SELECT count(DISTINCT o.phone) FROM orders o WHERE o.ref_phone = t.phone AND coalesce(o.ref_gift, '') != '' AND o.ref_gift NOT LIKE '⛔%') AS n FROM ref_tiers t LEFT JOIN customers c ON c.phone = t.phone WHERE t.done_at IS NULL ORDER BY t.at");
  return { ok: true, cfg: { tierN: cfg.tierN, tierGift: cfg.tierGift, ctvN: cfg.ctvN, rate: cfg.rate, auto: cfg.auto }, list: rows.filter(r => u.level >= 2 || r.owner === u.name).map(r => ({ phone: r.phone, tier: r.tier, at: r.at, name: r.name || '', owner: r.owner || '', n: r.n, kind: r.tier === cfg.ctvN ? 'ctv' : 'gift' })) };
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
  for (const p of await all(x.db, "SELECT code FROM partners WHERE coalesce(view_key, '') = ''")) await run(x.db, 'UPDATE partners SET view_key = ? WHERE code = ?', randHex(12), p.code);
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
    list: ps.map(p => { const s = st[p.code] || { cust: {}, n: 0, sales: 0, ready: 0, readyN: 0, wait: 0, waitN: 0, paid: 0 }; return { code: p.code, name: p.name, phone: p.phone, email: p.email, kind: p.kind, rate: p.rate, bank: p.bank, idno: p.idno, note: p.note, vcode: p.vcode, vpct: p.vpct || '', viewKey: p.view_key || '', active: !!p.active, created: p.created, by: p.by_name, cust: Object.keys(s.cust).length, n: s.n, sales: s.sales, ready: s.ready, readyN: s.readyN, wait: s.wait, waitN: s.waitN, paid: s.paid }; }),
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
  if (old && d.newKey) await run(x.db, 'UPDATE partners SET view_key = ? WHERE code = ?', randHex(12), code); // link cũ hết dùng được
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

/* ------------------------------------------------------------ 🤝 Trang CTV tự xem hoa hồng (28/10/2026): thucduonglanh.vn/ctv/#<view_key> (main.js initCtv) */
/** Không cần đăng nhập: ai có link bí mật mới xem được. Chỉ trả tên khách đã che, không trả SĐT / địa chỉ khách, tài khoản ngân hàng chỉ còn 4 số cuối.
 *  Sai link nhiều lần → khoá theo IP 15 phút. Quản lý đổi link ở CRM (✏️ Sửa CTV → Đổi link xem hoa hồng). */
export async function ctvMe(x, d) {
  const fk = 'ctvf_' + String(x.ip || 'x').slice(0, 60), fails = Number(await kvGet(x.db, fk)) || 0;
  if (fails >= 10) return { ok: false, error: 'Bạn mở sai link nhiều lần. Thử lại sau 15 phút nhé.' };
  const key = String(d.key || '').replace(/[^a-f0-9]/g, '');
  const p = key.length >= 16 ? await first(x.db, 'SELECT * FROM partners WHERE view_key = ?', key) : null;
  if (!p) { await kvSet(x.db, fk, fails + 1, 15 * 60e3); return { ok: false, bad: true, error: 'Link không đúng hoặc đã được đổi. Bạn nhắn Zalo 0966 326 522 để xin link mới nhé.' }; }
  const cfg = await partnerCfg(x), L = (await pOrders(x, p.code)).list || [];
  const sum = f => L.filter(f).reduce((s, o) => s + o.comm, 0), cnt = f => L.filter(f).length, live = o => !o.void;
  const pays = await all(x.db, 'SELECT at, net, tax, n, amount FROM partner_pay WHERE code = ? ORDER BY id DESC LIMIT 50', p.code);
  const vc = p.vcode ? await first(x.db, 'SELECT value FROM vouchers WHERE code = ? AND active = 1', p.vcode) : null;
  const custs = {}; L.filter(live).forEach(o => { custs[o.phone] = 1; });
  return {
    ok: true, name: p.name, kind: p.kind, active: !!p.active, code: p.code, rate: p.rate, months: cfg.months, vcode: vc ? p.vcode : '', vpct: vc ? vc.value : 0,
    bank: p.bank ? String(p.bank).replace(/\d(?=\d{4})/g, '•') : '',
    cust: Object.keys(custs).length, n: cnt(live), sales: L.filter(live).reduce((s, o) => s + o.goods, 0),
    ready: sum(o => o.ready), readyN: cnt(o => o.ready), wait: sum(o => live(o) && !o.paid && !o.ready), waitN: cnt(o => live(o) && !o.paid && !o.ready),
    paid: pays.reduce((s, q) => s + (q.net || 0), 0), taxFrom: TAX_FROM, taxPct: TAX_PCT,
    orders: L.slice(0, 300).map(o => ({ who: o.who.split(' · ')[0], time: o.time, goods: o.goods, rate: o.rate, comm: o.comm, st: o.void ? 'void' : o.paid ? 'paid' : o.ready ? 'ready' : 'wait', status: o.status })),
    pays: pays.map(q => ({ at: q.at, net: q.net, tax: q.tax, n: q.n }))
  };
}

/** Lệnh CRM. ref_code / ref_gift: sale làm cho khách mình (crm.js kiểm tra người phụ trách trước). Còn lại: Quản lý trở lên. */
export async function crmPartner(x, u, d, log, staffNames) {
  const a = d.action;
  if (a === 'ref_code') return refCodeFor(x, u, d);
  if (a === 'ref_gift') return refGift(x, u, d, log);
  if (a === 'ref_told') { await run(x.db, 'UPDATE orders SET ref_told = 1 WHERE id = ?', String(d.id || '')); const o = await first(x.db, 'SELECT ref_phone, ref_gift, name FROM orders WHERE id = ?', String(d.id || '')); if (o) await log(x, u, 'Báo voucher cảm ơn', o.ref_phone, '', o.ref_gift, 'Giới thiệu ' + (o.name || '')); return { ok: true }; }
  if (a === 'ref_tiers') return tierList(x, u);
  if (a === 'ref_bonus') return bonusList(x, u);
  if (a === 'ref_goal') { // thưởng sale + mục tiêu nhóm: chỉ Quản lý trở lên
    if (u.level < 2) return { ok: false, error: 'Chỉ Quản lý và Quản trị đổi mục này.' };
    const c = await partnerCfg(x), bonus = Math.round(Number(d.bonus)), goalN = Math.round(Number(d.goalN)), goalGift = String(d.goalGift || '').trim().slice(0, 80);
    if (!(bonus >= 0 && bonus <= 1000000) || !(goalN >= 0 && goalN <= 1000)) return { ok: false, error: 'Kiểm tra lại: thưởng 0–1.000.000đ, mục tiêu nhóm 0–1000 khách.' };
    await kvSet(x.db, 'partner_cfg', JSON.stringify(Object.assign({}, c, { bonus, goalN, goalGift })));
    if (bonus !== c.bonus) await run(x.db, 'UPDATE ref_sale SET amount = ? WHERE ok_at IS NULL AND void = 0', bonus); // khách chưa đủ điều kiện → theo mức mới
    await log(x, u, 'Cài đặt CTV', '', '', 'Thưởng sale ' + fmt(bonus) + ' / khách mới nhờ giới thiệu · mục tiêu nhóm ' + goalN + ' khách / tháng' + (goalGift ? ' → ' + goalGift : ''), '');
    return bonusList(x, u);
  }
  if (a === 'ref_tier_done') {
    const note = String(d.note || '').trim().slice(0, 200);
    await run(x.db, 'UPDATE ref_tiers SET done_at = ?, done_by = ?, note = ? WHERE phone = ? AND tier = ?', Date.now(), u.name, note, normPhone(d.phone), Number(d.tier) || 0);
    await log(x, u, Number(d.tier) === (await partnerCfg(x)).ctvN ? 'Mời làm CTV' : 'Quà mốc giới thiệu', normPhone(d.phone), '', note || 'Đã làm', 'Mốc ' + d.tier + ' người');
    return tierList(x, u);
  }
  if (u.level < 2) return { ok: false, error: 'Chỉ Quản lý và Quản trị quản lý cộng tác viên.' };
  if (a === 'partner_list') return pList(x);
  if (a === 'partner_save') return pSave(x, u, d, log, staffNames);
  if (a === 'partner_orders') return pOrders(x, String(d.code || ''));
  if (a === 'partner_pay') return pPay(x, u, d, log);
  if (a === 'partner_claim') return pClaim(x, u, d, log);
  if (a === 'partner_cfg') {
    const c = await partnerCfg(x), rate = Number(d.rate), months = Math.round(Number(d.months)), refPct = Number(d.refPct);
    const rwPct = d.rwPct == null ? c.rwPct : Number(d.rwPct), tierN = d.tierN == null ? c.tierN : Math.round(Number(d.tierN)), ctvN = d.ctvN == null ? c.ctvN : Math.round(Number(d.ctvN));
    const tierGift = d.tierGift == null ? c.tierGift : String(d.tierGift).trim().slice(0, 80), auto = d.auto == null ? c.auto : d.auto ? 1 : 0;
    if (!(rate >= 0 && rate <= 50) || !(months >= 1 && months <= 36) || !(refPct >= 0 && refPct <= 30)) return { ok: false, error: 'Kiểm tra lại: hoa hồng 0–50%, thời hạn 1–36 tháng, giảm cho bạn được giới thiệu 0–30%.' };
    if (!(rwPct >= 0 && rwPct <= 30) || !(tierN >= 0 && tierN <= 50) || !(ctvN >= 0 && ctvN <= 100)) return { ok: false, error: 'Kiểm tra lại: voucher cảm ơn 0–30%, mốc quà 0–50 người, mốc mời CTV 0–100 người.' };
    await kvSet(x.db, 'partner_cfg', JSON.stringify(Object.assign({}, c, { rate, months, refPct, rwPct, auto, tierN, tierGift, ctvN }))); // giữ thưởng sale / mục tiêu nhóm
    if (refPct !== c.refPct) await run(x.db, "UPDATE vouchers SET value = ? WHERE coalesce(ref_phone, '') != '' AND kind = 'percent'", refPct); // mã giới thiệu đã phát theo % mới
    await log(x, u, 'Cài đặt CTV', '', '', 'Hoa hồng ' + rate + '% · ' + months + ' tháng · bạn được giới thiệu giảm ' + refPct + '% · voucher cảm ơn ' + rwPct + '%' + (auto ? '' : ' (tắt tự động)') + ' · ' + tierN + ' bạn → ' + tierGift + ' · ' + ctvN + ' bạn → mời CTV', '');
    return pList(x);
  }
  return { ok: false, error: 'Không rõ thao tác: ' + a };
}
