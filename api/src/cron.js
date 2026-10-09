// Việc chạy theo lịch: 8h sáng gửi danh sách chăm sóc + báo mức dùng CRM, 10 phút/lần lấy số quảng cáo, 30 phút/lần tự nhập file sale, 6 tiếng 1 lần chép bản sao dữ liệu sang Google Sheet.
import { normPhone, esc, fmtDate, startOfDay, all, kvGet, kvSet, kvDel, CRM_URL, DAY } from './lib.js';
import { telegram, telegramTo, gInfo, sheetMeta, sheetClear, sheetWrite, sheetAddTabs, sheetBatch, a1 } from './google.js';
import { crmUsers, unifyNames, autoCloseLeads, rulesCfg, careTask, groupOf, leadsData, leadDue, adsCfg, usageAlert } from './crm.js';
import { adsSync, srcAutoTick } from './sync.js';

function careMessage(items, leads, today, isGroup, who, R) {
  const block = (title, arr, tip) => !arr.length ? '' : '\n\n<b>' + title + ' (' + arr.length + ')</b> – ' + tip + '\n' + arr.slice(0, 25).map(c =>
    '• ' + esc(c.name) + ' – <a href="https://zalo.me/' + c.phone + '">' + c.phone + '</a>' + (c.group !== 'Mới' ? ' [' + c.group + ']' : '') + (isGroup ? (c.owner ? ' 👤' + esc(c.owner) : ' ⚠️chưa ai phụ trách') : '') +
    '\n   ' + esc(c.products) + (c.late ? ' <b>– đã quá ' + c.late + ' ngày</b>' : '') + (c.ok ? '' : ' <i>(chưa đồng ý nhận tin – chỉ hỏi thăm)</i>')).join('\n') + (arr.length > 25 ? '\n   … và ' + (arr.length - 25) + ' khách khác (xem CRM)' : '');
  const by = k => items.filter(i => i.type === k);
  const lb = leads.length ? '\n\n<b>🙋 Khách tiềm năng cần liên hệ (' + leads.length + ')</b>\n' + leads.slice(0, 25).map(l => '• ' + esc(l.name) + ' – <a href="https://zalo.me/' + l.phone + '">' + l.phone + '</a>' + (l.interest ? ' · ' + esc(l.interest) : '') + (isGroup ? (l.owner ? ' 👤' + esc(l.owner) : ' ⚠️chưa ai phụ trách') : '')).join('\n') : '';
  const total = items.length + leads.length;
  return '📋 <b>' + (who ? 'Việc của ' + esc(who) + ' ' : 'CSKH hôm nay ') + fmtDate(today, 'dd/MM') + '</b> – ' + items.length + ' khách cần chăm sóc' + (leads.length ? ', ' + leads.length + ' khách tiềm năng' : '') +
    block('📞 Hẹn gọi lại', by('callback'), 'khách đã hẹn') + block('📦 Hỏi nhận hàng, hướng dẫn dùng', by('d1'), 'đơn mới giao') + block('⏰ Sắp hết / đã hết sản phẩm', by('runout'), 'nhắc đặt lại, gợi ý đơn từ 300K được freeship') +
    block('💬 Xin cảm nhận', by('d14'), '14 ngày sau khi mua') + block('🌿 Giới thiệu sản phẩm phù hợp', by('d30'), '30 ngày sau khi mua') + block('💌 Mời quay lại', by('winback'), R.atRisk + ' ngày chưa mua') + lb +
    (total ? '\n\n✍️ Làm trên CRM: ' + CRM_URL : '\n\nHôm nay không có khách đến lịch chăm sóc 🎉');
}

/** 8h sáng: danh sách cần chăm sóc vào nhóm Telegram (quản lý) và riêng cho từng nhân viên + cảnh báo mức dùng CRM. */
export async function dailyCare(x) {
  const today = startOfDay(Date.now()), R = await rulesCfg(x), items = [];
  for (const v of await all(x.db, 'SELECT phone, name, orders, spent, last, runout, care_at, care_result, last_status, callback, products, consent, owner FROM customers WHERE orders > 0')) {
    const t = careTask(v, today, R); if (!t) continue;
    items.push({ type: t.type, name: v.name, phone: v.phone, products: String(v.products || '').split('; ').slice(-2).join(', '), group: groupOf(v.orders, v.spent, v.last, R), ok: !!v.consent, owner: v.owner || '', late: t.late });
  }
  const leads = (await leadsData(x, "status IN ('Mới hỏi', 'Đang tư vấn')")).filter(l => leadDue(l, today));
  await telegram(x.env, careMessage(items, leads, today, true, '', R));
  for (const u of await crmUsers(x)) {
    if (!u.active || !u.tg) continue;
    const mine = items.filter(i => i.owner === u.name), ml = leads.filter(l => l.owner === u.name);
    if (mine.length || ml.length) await telegramTo(x.env, u.tg, careMessage(mine, ml, today, false, u.name, R));
  }
  try { await usageAlert(x); } catch (e) { console.error('usageAlert', e.message); }
  return { items: items.length, leads: leads.length };
}

/* ---------- bản sao sang Google Sheet (để xem, lọc, xuất báo cáo; sửa trên Sheet không có tác dụng) */
const T = t => t ? fmtDate(t, 'yyyy-MM-dd HH:mm') : '';
const MIRROR = [
  ['CRM · Đơn hàng', ['Thời gian', 'Mã đơn', 'Khách hàng', 'Điện thoại', 'Email', 'Tỉnh/TP', 'Phường/Xã', 'Địa chỉ', 'Sản phẩm', 'Tạm tính', 'Phí ship', 'Tổng', 'Thanh toán', 'Ghi chú', 'Trạng thái', 'Nguồn', 'Nguồn đầu tiên', 'Đồng ý nhận tin', 'Đã nhận tiền', 'Đơn vị vận chuyển', 'Mã vận đơn', 'NV bán', 'Ca', 'Dòng SP', 'Lên đơn', 'Ngày nhận', 'Ngày gửi', 'Loại đơn', 'Kiểm tra loại đơn', 'Hành trình VC', 'Cập nhật VC', 'Mã TT VC'],
    'SELECT * FROM orders ORDER BY time, rid', r => [T(r.time), r.id, r.name, r.phone, r.email, r.province, r.ward, r.address, r.items, r.subtotal, r.shipping, r.total, r.payment, r.note, r.status, r.source, r.first_source, r.consent ? 'Có' : 'Không', r.paid, r.carrier, r.tracking, r.seller, r.ca, r.line, r.ship, T(r.received_at), T(r.ship_at), r.otype || '', r.oflag || '', r.trk || '', T(r.trk_at), r.trk_code || '']],
  ['CRM · Khách hàng', ['Điện thoại', 'Tên', 'Địa chỉ', 'Tỉnh/TP', 'Phường/Xã', 'Số đơn', 'Tổng chi', 'Đơn đầu', 'Đơn gần nhất', 'Sản phẩm đã mua', 'Dự kiến hết hàng', 'Đồng ý nhận tin', 'Nguồn đầu tiên', 'Phụ trách', 'Lần CSKH gần nhất', 'Kết quả CSKH', 'Ghi chú CSKH', 'Hẹn gọi lại', 'Nhãn', 'Nhãn màu'],
    "SELECT * FROM customers WHERE orders > 0 OR flag != '' ORDER BY last", r => [r.phone, r.name, r.address, r.province, r.ward, r.orders, r.spent, T(r.first), T(r.last), r.products, T(r.runout), r.consent ? 'Có' : 'Không', r.source, r.owner, T(r.care_at), r.care_result, String(r.note || '').slice(0, 45000), T(r.callback), r.flag, r.tag]],
  ['CRM · Khách tiềm năng', ['Mã', 'Thời gian', 'Tên', 'Điện thoại', 'Kênh', 'Quan tâm', 'Trạng thái', 'Phụ trách', 'Lần liên hệ gần nhất', 'Hẹn liên hệ lại', 'Lý do không mua', 'Ghi chú', 'Mã đơn', 'Người tạo'],
    'SELECT * FROM leads ORDER BY rid', r => [r.id, T(r.time), r.name, r.phone, r.channel, r.interest, r.status, r.owner, T(r.last_at), T(r.callback), r.reason, String(r.note || '').slice(0, 45000), r.order_id, r.by_name]],
  ['CRM · Nhật ký CSKH', ['Thời gian', 'Người làm', 'Việc', 'SĐT / Mã đơn', 'Khách', 'Kết quả', 'Ghi chú'], 'SELECT * FROM logs ORDER BY rid', r => [T(r.time), r.by_name, r.what, r.ref, r.name, r.result, r.note]],
  ['CRM · Liên hệ', ['Thời gian', 'Họ tên', 'Điện thoại', 'Email', 'Nội dung', 'Trang', 'Đã trả lời', 'Ghi chú'], 'SELECT * FROM contacts ORDER BY rid', r => [T(r.time), r.name, r.phone, r.email, r.message, r.page, r.done ? 'Có' : '', r.note]],
  ['CRM · Mục tiêu', ['Tháng', 'Nhân viên', 'Mục tiêu doanh số', 'Người đặt', 'Cập nhật lúc'], 'SELECT * FROM targets ORDER BY month, name', r => [r.month, r.name, r.amount, r.by_name, T(r.at)]],
  ['CRM · Hoạt động CRM', ['Ngày', 'Email', 'Tên', 'Lần mở', 'Phút dùng', 'Màn hình đã xem', 'Thiết bị', 'Vào lúc', 'Lần cuối'],
    'SELECT * FROM usage ORDER BY day DESC, last_time DESC', r => [r.day, r.email, r.name, r.opens, r.mins, r.screens, r.dev, T(r.first_time), T(r.last_time)]],
  ['CRM · Đo tốc độ CRM', ['Thời gian', 'Người', 'Vai trò', 'Thao tác', 'Tổng (giây)', 'Máy chủ (giây)', 'Dữ liệu', 'KB', 'Thiết bị'],
    'SELECT * FROM perf ORDER BY time DESC LIMIT 500', r => [T(r.time), r.by_name, r.role, r.what, r.total, r.server, r.data, r.kb, r.dev]],
  ['CRM · Góp ý', ['Mã', 'Thời gian', 'Người gửi', 'Email', 'Phân loại', 'Nội dung', 'Màn hình', 'Trình duyệt/Thiết bị', 'Phiên bản', 'Trạng thái', 'Phản hồi', 'Người xử lý', 'Cập nhật lúc'],
    'SELECT * FROM feedback ORDER BY time DESC', r => [r.id, T(r.time), r.by_name, r.email, r.kind, r.text, r.route, r.ua, r.ver, r.status, r.reply, r.handler, T(r.updated)]]
];
const MIRROR_COLS = 35; // A…AI (ô AI1 của tab đầu ghi giờ sao lưu)
/** Chép toàn bộ dữ liệu sang các tab "CRM · …" của file Sheet chính.
 *  Ghi đè lên bản cũ rồi mới xoá phần thừa (trước đây xoá trước → lỗi giữa chừng là mất sạch bản sao).
 *  Nới số dòng / cột của tab trước khi ghi: Google không cho ghi bắt đầu từ dòng nằm ngoài khung tab (lỗi cũ: chỉ chép được 2.000 đơn đầu, các tab sau trống). */
export async function mirror(x) {
  const info = await gInfo(x.env), id = info.sheetId; if (!id) throw new Error('Chưa biết file Sheet chính');
  let meta = await sheetMeta(x.env, id);
  const missing = MIRROR.map(m => m[0]).filter(t => !(meta.sheets || []).some(s => s.properties.title === t));
  if (missing.length) { await sheetAddTabs(x.env, id, missing); meta = await sheetMeta(x.env, id); }
  const prop = t => ((meta.sheets || []).find(s => s.properties.title === t) || {}).properties || {};
  const tabs = [], counts = {};
  for (const [tab, head, sql, row] of MIRROR) {
    const rows = (await all(x.db, sql)).map(r => row(r).map(v => v == null ? '' : v));
    counts[tab] = rows.length; tabs.push({ tab, values: [head, ...rows] });
  }
  const grow = [], extra = [];
  for (const t of tabs) {
    const p = prop(t.tab), g = p.gridProperties || {}, rowsHave = g.rowCount || 0, colsHave = g.columnCount || 0;
    if (rowsHave < t.values.length || colsHave < MIRROR_COLS) grow.push({ updateSheetProperties: { properties: { sheetId: p.sheetId, gridProperties: { rowCount: Math.max(rowsHave, t.values.length), columnCount: Math.max(colsHave, MIRROR_COLS) } }, fields: 'gridProperties.rowCount,gridProperties.columnCount' } });
    if (rowsHave > t.values.length) extra.push(a1(t.tab, 'A' + (t.values.length + 1) + ':AI' + rowsHave)); // dòng cũ thừa (dữ liệu đã bị xoá bớt)
  }
  await sheetBatch(x.env, id, grow);
  for (const t of tabs) for (let i = 0; i < t.values.length; i += 2000) await sheetWrite(x.env, id, [{ range: a1(t.tab, 'A' + (i + 1)), values: t.values.slice(i, i + 2000) }]); // từng phần cho khỏi quá giới hạn Google
  if (extra.length) await sheetClear(x.env, id, extra);
  await sheetWrite(x.env, id, [{ range: a1(MIRROR[0][0], 'AI1'), values: [['Bản sao tự động từ CRM lúc ' + fmtDate(Date.now(), 'HH:mm dd/MM/yyyy') + ' – sửa ở đây không có tác dụng, hãy sửa trên crm.thucduonglanh.vn']] }]);
  await kvSet(x.db, 'mirror_last', String(Date.now())); await kvDel(x.db, 'mirror_err');
  return counts;
}

/** Mỗi 10 phút từ 7h đến 22h (giờ VN), ban đêm nghỉ. 8h sáng: gửi danh sách chăm sóc. */
export async function scheduled(x, cron) {
  if (!await kvGet(x.db, 'migrated')) return;
  const now = Date.now(), vn = new Date(now + 7 * 3600e3);
  if (vn.getUTCHours() < 7 || vn.getUTCHours() >= 22) return; // ban đêm (22h–7h) không ai làm việc → nghỉ, đỡ tốn lượt đọc
  if (vn.getUTCHours() === 8 && vn.getUTCMinutes() < 10) {
    const key = 'care_' + fmtDate(now, 'yyyyMMdd');
    if (!await kvGet(x.db, key)) { await kvSet(x.db, key, '1', 2 * DAY); try { await dailyCare(x); } catch (e) { console.error('dailyCare', e.message); } }
  }
  const ads = await adsCfg(x);
  if (ads && ads.auto) { try { await adsSync(x, { name: 'Tự động', level: 3 }, false); } catch (e) { console.error('ads', e.message); } }
  const lastAuto = Number(await kvGet(x.db, 'auto_tick_last') || 0);
  if (now - lastAuto > 25 * 60e3 && vn.getUTCHours() >= 7 && vn.getUTCHours() <= 21) {
    await kvSet(x.db, 'auto_tick_last', String(now));
    try { await srcAutoTick(x); } catch (e) { console.error('srcAutoTick', e.message); }
    const lastUni = Number(await kvGet(x.db, 'unify_last') || 0); // gộp tên đọc hết các bảng → 6 tiếng 1 lần là đủ
    if (now - lastUni > 6 * 3600e3) { await kvSet(x.db, 'unify_last', String(now)); try { await unifyNames(x); } catch (e) { console.error('unifyNames', e.message); } }
    try { await autoCloseLeads(x, null); } catch (e) { console.error('autoCloseLeads', e.message); } // quét bù khách hỏi đã có đơn (25 phút 1 lần)
  }
  const last = Number(await kvGet(x.db, 'mirror_last') || 0);
  if (now - last > 6 * 3600e3 - 5 * 60e3) { try { // đọc toàn bộ dữ liệu → 6 tiếng 1 lần
     await mirror(x); } catch (e) { console.error('mirror', e.message); await kvSet(x.db, 'mirror_last', String(now)); await kvSet(x.db, 'mirror_err', fmtDate(now, 'HH:mm dd/MM') + ': ' + String(e.message).slice(0, 300)); } } // lỗi thì 6 tiếng sau mới thử lại (mỗi lần thử đọc hết dữ liệu)
}
