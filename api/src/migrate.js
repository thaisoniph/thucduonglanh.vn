// Chuyển dữ liệu 1 lần từ Google Sheet "Đơn hàng website Thực Dưỡng Lành" (+ cài đặt trong Apps Script) sang D1.
// Các trang tính cũ giữ nguyên làm bản lưu. Chạy lại (force) sẽ xoá dữ liệu D1 và chép lại từ Sheet.
import { normPhone, hashKey, all, first, run, insertMany, kvGet, kvSet, kvDel, fmtDate } from './lib.js';
import { bridge, gInfo, sheetMeta, sheetValues, a1, serialToMs } from './google.js';
import { recalcAll, ORDER_COLS, DEFAULT_CYCLES, DEFAULT_TEMPLATES } from './crm.js';

/** Ngày giờ trong Sheet → mili giây: số sê-ri, hoặc chữ "30/09/2026 14:05:00", hoặc ISO. */
function toMs(v) {
  if (v === '' || v == null) return null;
  if (typeof v === 'number') return v > 20000 && v < 80000 ? serialToMs(v) : null;
  const s = String(v).trim(), m = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})(?:[ ,]+(\d{1,2}):(\d{2})(?::(\d{2}))?)?/);
  if (m) { const p = n => ('0' + n).slice(-2), t = new Date(m[3] + '-' + p(m[2]) + '-' + p(m[1]) + 'T' + p(m[4] || 9) + ':' + p(m[5] || 0) + ':' + p(m[6] || 0) + '+07:00').getTime(); return isNaN(t) ? null : t; }
  const t = Date.parse(s); return isNaN(t) ? null : t;
}
const S = v => v == null ? '' : typeof v === 'boolean' ? (v ? 'TRUE' : '') : String(v).replace(/^'/, '');
const N = v => Math.round(Number(v) || 0);
/** Đọc 1 trang tính → danh sách object theo tên cột. */
async function tab(x, id, names, name) {
  if (names.indexOf(name) < 0) return [];
  const rows = await sheetValues(x.env, id, a1(name, 'A:AB'), 'UNFORMATTED_VALUE'); if (rows.length < 2) return [];
  const H = rows[0].map(h => String(h || '').trim());
  return rows.slice(1).filter(r => r.some(c => c !== '' && c != null)).map(r => { const o = {}; H.forEach((h, i) => { if (h) o[h] = r[i] === undefined ? '' : r[i]; }); o.__r = r; return o; });
}

export async function migrate(x, opt) {
  opt = opt || {};
  if (await kvGet(x.db, 'migrated') && !opt.force) return { ok: false, error: 'Đã chuyển dữ liệu rồi (' + fmtDate(Number(await kvGet(x.db, 'migrated')), 'HH:mm dd/MM/yyyy') + ').' };
  if (await kvGet(x.db, 'migrating')) return { ok: false, error: 'Đang chuyển dữ liệu, chờ vài phút.' };
  await kvSet(x.db, 'migrating', '1', 10 * 60e3);
  try {
    const info = await gInfo(x.env, true), id = info.sheetId;
    if (opt.retire) await bridge(x.env, 'retire', { api: opt.apiUrl });
    const props = (await bridge(x.env, 'props')).props || {};
    const names = ((await sheetMeta(x.env, id)).sheets || []).map(s => s.properties.title);
    const orders = await tab(x, id, names, 'Đơn hàng'), cus = await tab(x, id, names, 'Khách hàng'), leads = await tab(x, id, names, 'Khách tiềm năng'), logs = await tab(x, id, names, 'Nhật ký CSKH');
    const contacts = await tab(x, id, names, 'Liên hệ'), users = await tab(x, id, names, 'Nhân sự CRM'), targets = await tab(x, id, names, 'Mục tiêu'), srcs = await tab(x, id, names, 'Nguồn dữ liệu sale');
    const cyc = names.indexOf('Chu kỳ dùng') >= 0 ? (await sheetValues(x.env, id, a1('Chu kỳ dùng', 'A2:D'), 'UNFORMATTED_VALUE')) : [];
    const tpl = names.indexOf('Mẫu tin nhắn CSKH') >= 0 ? (await sheetValues(x.env, id, a1('Mẫu tin nhắn CSKH', 'A2:C'), 'UNFORMATTED_VALUE')) : [];

    const keepFrom = ((await first(x.db, 'SELECT max(rid) AS m FROM orders')) || {}).m || 0; // đơn web vào trong lúc chuyển: giữ lại
    await x.db.batch(['DELETE FROM orders WHERE rid <= ' + Number(keepFrom), 'DELETE FROM customers', 'DELETE FROM leads', 'DELETE FROM logs', 'DELETE FROM contacts', 'DELETE FROM users', 'DELETE FROM targets', 'DELETE FROM cycles', 'DELETE FROM templates', 'DELETE FROM sources'].map(q => x.db.prepare(q)));

    await insertMany(x.db, 'orders', ORDER_COLS, orders.filter(o => o['Mã đơn'] !== '' || o['Khách hàng'] !== '').map(o => ({
      id: S(o['Mã đơn']), time: toMs(o['Thời gian']), name: S(o['Khách hàng']), phone: normPhone(o['Điện thoại']), email: S(o['Email']), province: S(o['Tỉnh/TP']), ward: S(o['Phường/Xã']), address: S(o['Địa chỉ']), items: S(o['Sản phẩm']),
      subtotal: N(o['Tạm tính']), shipping: N(o['Phí ship']), total: N(o['Tổng']), payment: S(o['Thanh toán']), note: S(o['Ghi chú']), status: S(o['Trạng thái']) || 'Mới', source: S(o['Nguồn']), first_source: S(o['Nguồn đầu tiên']),
      consent: o['Đồng ý nhận tin'] === 'Có' ? 1 : 0, paid: S(o['Đã nhận tiền']), carrier: S(o['Đơn vị vận chuyển']), tracking: S(o['Mã vận đơn']), seller: S(o['NV bán']), ca: S(o['Ca']), line: S(o['Dòng SP']), ship: S(o['Lên đơn']) })));

    const seenC = {};
    await insertMany(x.db, 'customers', ['phone', 'name', 'address', 'province', 'ward', 'orders', 'spent', 'first', 'last', 'products', 'runout', 'consent', 'source', 'owner', 'care_at', 'care_result', 'note', 'callback', 'flag', 'tag'],
      cus.map(c => ({ phone: normPhone(c['Điện thoại']), name: S(c['Tên']), address: S(c['Địa chỉ']), province: S(c['Tỉnh/TP']), ward: S(c['Phường/Xã']), orders: N(c['Số đơn']), spent: N(c['Tổng chi']), first: toMs(c['Đơn đầu']), last: toMs(c['Đơn gần nhất']),
        products: S(c['Sản phẩm đã mua']), runout: toMs(c['Dự kiến hết hàng']), consent: c['Đồng ý nhận tin'] === 'Có' ? 1 : 0, source: S(c['Nguồn đầu tiên']), owner: S(c['Phụ trách']), care_at: toMs(c['Lần CSKH gần nhất']), care_result: S(c['Kết quả CSKH']),
        note: S(c['Ghi chú CSKH']), callback: toMs(c['Hẹn gọi lại']), flag: S(c['Nhãn']), tag: S(c['Nhãn màu']) })).filter(c => { if (!c.phone || seenC[c.phone]) return false; seenC[c.phone] = 1; return true; }));

    const seenL = {};
    await insertMany(x.db, 'leads', ['id', 'time', 'name', 'phone', 'channel', 'interest', 'status', 'owner', 'last_at', 'callback', 'reason', 'note', 'order_id', 'by_name'],
      leads.filter(l => l['Mã'] !== '').map(l => ({ id: S(l['Mã']), time: toMs(l['Thời gian']), name: S(l['Tên']), phone: normPhone(l['Điện thoại']), channel: S(l['Kênh']), interest: S(l['Quan tâm']), status: S(l['Trạng thái']) || 'Mới hỏi', owner: S(l['Phụ trách']),
        last_at: toMs(l['Lần liên hệ gần nhất']), callback: toMs(l['Hẹn liên hệ lại']), reason: S(l['Lý do không mua']), note: S(l['Ghi chú']), order_id: S(l['Mã đơn']), by_name: S(l['Người tạo']) })).filter(l => { if (seenL[l.id]) return false; seenL[l.id] = 1; return true; }), 'ON CONFLICT(id) DO NOTHING');

    await insertMany(x.db, 'logs', ['time', 'by_name', 'what', 'ref', 'name', 'result', 'note'], logs.map(r => { const v = r.__r; return { time: toMs(v[0]), by_name: S(v[1]), what: S(v[2]), ref: S(v[3]), name: S(v[4]), result: S(v[5]), note: S(v[6]) }; }));
    await insertMany(x.db, 'contacts', ['time', 'name', 'phone', 'email', 'message', 'page', 'done', 'note'], contacts.map(r => { const v = r.__r; return { time: toMs(v[0]), name: S(v[1]), phone: normPhone(v[2]), email: S(v[3]), message: S(v[4]), page: S(v[5]), done: v[6] === true ? 1 : 0, note: S(v[7]) }; }));
    const seenU = {};
    await insertMany(x.db, 'users', ['email', 'name', 'role', 'active', 'recv', 'tg', 'alias', 'prefix', 'ord'], users.map((r, i) => { const v = r.__r; return { email: S(v[0]).trim().toLowerCase(), name: S(v[1]).trim(), role: S(v[2]), active: /^(không|khong|no|0|false)$/i.test(S(v[3]).trim()) ? 0 : 1, recv: S(v[4]).trim(), tg: S(v[5]).trim(), alias: S(v[6]).trim(), prefix: S(v[7]).trim(), ord: i }; })
      .filter(u => { if (!/@/.test(u.email) || seenU[u.email]) return false; seenU[u.email] = 1; return true; }));
    await insertMany(x.db, 'targets', ['month', 'name', 'amount', 'by_name', 'at'], targets.map(r => { const v = r.__r; return { month: typeof v[0] === 'number' ? fmtDate(serialToMs(v[0]), 'yyyy-MM') : S(v[0]), name: S(v[1]), amount: N(v[2]), by_name: S(v[3]), at: toMs(v[4]) }; }).filter(t => /^\d{4}-\d{2}$/.test(t.month) && t.name), 'ON CONFLICT(month, name) DO NOTHING');
    const cy = cyc.filter(r => r[0] && r[2]).map(r => ({ name: S(r[0]), variant: S(r[1]), days: N(r[2]), basis: S(r[3]) }));
    await insertMany(x.db, 'cycles', ['name', 'variant', 'days', 'basis'], cy.length ? cy : DEFAULT_CYCLES.map(r => ({ name: r[0], variant: r[1], days: r[2], basis: r[3] })));
    const tp = tpl.filter(r => r[2]).map(r => ({ when_txt: S(r[0]), purpose: S(r[1]), text: S(r[2]) }));
    await insertMany(x.db, 'templates', ['when_txt', 'purpose', 'text'], tp.length ? tp : DEFAULT_TEMPLATES.map(r => ({ when_txt: r[0], purpose: r[1], text: r[2] })));
    await insertMany(x.db, 'sources', ['id', 'sale', 'url', 'file_name', 'cfg', 'last', 'result'], srcs.map(r => { const v = r.__r; return { id: S(v[0]), sale: S(v[1]), url: S(v[2]), file_name: S(v[3]), cfg: S(v[4]) || '{}', last: toMs(v[5]), result: S(v[6]) }; }).filter(s => s.id), 'ON CONFLICT(id) DO NOTHING');

    // cài đặt & phiên đăng nhập trong Script Properties
    const kvKeys = Object.keys(props).filter(k => /^(assign_mode|rules_cfg|ca_cfg|ads_cfg|rr_last|rr_ads_.+|prefs_.+)$/.test(k));
    for (const k of kvKeys) await kvSet(x.db, k, props[k]);
    const sess = [];
    Object.keys(props).forEach(k => { if (k.indexOf('crm_s_') !== 0) return; try { const s = JSON.parse(props[k]); if (s.x > Date.now()) sess.push({ token: k.slice(6), email: s.e, exp: s.x }); } catch (e) { } });
    await insertMany(x.db, 'sessions', ['token', 'email', 'exp'], sess, 'ON CONFLICT(token) DO NOTHING');

    await recalcAll(x); // tính lại khách từ đơn (giữ ghi chú, phụ trách, hẹn, nhãn đã chép) + màu khách
    // kiểm tra mã băm giống Apps Script (để đồng bộ lại file sale không bị trùng)
    const cs = (await all(x.db, "SELECT id, phone, by_name FROM leads WHERE id LIKE 'CS%' AND by_name LIKE 'Đồng bộ %' LIMIT 200"));
    const hashOk = cs.filter(l => 'CS' + hashKey(l.by_name.slice(8) + '|' + l.phone) === l.id).length;
    const cnt = async t => (await first(x.db, 'SELECT count(*) AS n FROM ' + t)).n;
    const res = { ok: true, orders: await cnt('orders'), customers: await cnt('customers'), leads: await cnt('leads'), logs: await cnt('logs'), contacts: await cnt('contacts'), users: await cnt('users'), sessions: sess.length, settings: kvKeys.length, sources: await cnt('sources'),
      sheetRows: { orders: orders.length, customers: cus.length, leads: leads.length, logs: logs.length }, hashCheck: cs.length ? hashOk + '/' + cs.length : 'không có mẫu' };
    await kvSet(x.db, 'migrated', String(Date.now()));
    await kvSet(x.db, 'migrate_result', JSON.stringify(res));
    return res;
  } finally { await kvDel(x.db, 'migrating'); }
}
