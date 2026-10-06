/**
 * Thực Dưỡng Lành – nhận đơn hàng, liên hệ & CRM chăm sóc khách hàng (thucduonglanh.vn)
 *
 * - Mỗi đơn: ghi "Đơn hàng", cập nhật "Khách hàng" (gộp theo SĐT), gửi email + Telegram.
 * - 8h sáng mỗi ngày: gửi danh sách "Hôm nay cần chăm sóc" vào nhóm Telegram.
 *
 * - Menu "🌿 Thực Dưỡng Lành" trên Sheet: sắp xếp & tô màu lại file, làm mới danh sách khách.
 *
 * Lần đầu: ⚙️ Cài đặt dự án → Thuộc tính tập lệnh → thêm TELEGRAM_TOKEN = token bot Telegram.
 * Cập nhật code: dán đè toàn bộ file → Lưu → chạy hàm setupCRM (1 lần) →
 * Triển khai → Quản lý các bản triển khai → ✏️ → Phiên bản mới → Triển khai.
 * Chỉ sửa phần CRM / giao diện Sheet (không sửa doPost) thì Lưu là đủ.
 */
var NOTIFY_EMAIL = 'vitagreennutrition@gmail.com';
// Báo đơn qua Telegram. Token bot KHÔNG ghi trong code (code để trên GitHub công khai): lưu ở ⚙️ Cài đặt dự án → Thuộc tính tập lệnh → TELEGRAM_TOKEN.
var TELEGRAM_TOKEN = PropertiesService.getScriptProperties().getProperty('TELEGRAM_TOKEN') || '';
var TELEGRAM_CHAT_IDS = '-5318324525'; // nhóm "Đơn hàng Thực Dưỡng Lành" – thêm/bớt nhân viên trực tiếp trong nhóm
var TZ = 'Asia/Ho_Chi_Minh';
var CRM_URL = 'https://crm.thucduonglanh.vn';
var CRM_VERSION = '2026-10-06a';
// Từ 10/2026 CRM chạy trên máy chủ Cloudflare (api.thucduonglanh.vn). Apps Script này chỉ còn làm "cầu nối" Google: gửi email, cấp quyền đọc Google Sheet.
var API_URL = 'https://api.thucduonglanh.vn/api'; // CRM web so với số này để biết Apps Script đã được triển khai bản mới chưa

// Phân nhóm khách (chỉnh được)
var VIP_ORDERS = 3, VIP_SPENT = 2000000, AT_RISK_DAYS = 60, SHIP_DAYS = 3, FAM_MIN = 1, FAM_GAP = 180; // SHIP_DAYS: số ngày giao hàng trung bình (chưa biết ngày nhận thật thì ước tính = ngày đặt + số này)
var MISS_DAYS = 7; // việc chăm sóc qua khung mà chưa làm: vẫn hiện thêm 7 ngày (việc bị lỡ)
function recvBase(orderDate, recv) { if (recv && !isNaN(recv)) return recv; var d = new Date(orderDate); return new Date(d.getTime() + rulesCfg().shipDays * 864e5); }

var ORDER_HEADERS = ['Thời gian', 'Mã đơn', 'Khách hàng', 'Điện thoại', 'Email', 'Tỉnh/TP', 'Phường/Xã', 'Địa chỉ', 'Sản phẩm', 'Tạm tính', 'Phí ship', 'Tổng', 'Thanh toán', 'Ghi chú', 'Trạng thái', 'Nguồn', 'Nguồn đầu tiên', 'Đồng ý nhận tin', 'Đã nhận tiền', 'Đơn vị vận chuyển', 'Mã vận đơn', 'NV bán', 'Ca', 'Dòng SP', 'Lên đơn', 'Ngày nhận', 'Ngày gửi', 'Loại đơn', 'Kiểm tra loại đơn', 'Hành trình VC', 'Cập nhật VC', 'Mã TT VC'];
var CUS_HEADERS = ['Điện thoại', 'Tên', 'Địa chỉ', 'Tỉnh/TP', 'Phường/Xã', 'Số đơn', 'Tổng chi', 'Đơn đầu', 'Đơn gần nhất', 'Sản phẩm đã mua', 'Dự kiến hết hàng', 'Nhóm', 'Đồng ý nhận tin', 'Nguồn đầu tiên', 'Phụ trách', 'Lần CSKH gần nhất', 'Kết quả CSKH', 'Ghi chú CSKH', 'Hẹn gọi lại', 'Nhãn', 'Nhãn màu', 'Zalo', 'Nhận hàng', 'Cộng đồng'];
var CONTACT_HEADERS = ['Thời gian', 'Họ tên', 'Điện thoại', 'Email', 'Nội dung', 'Trang'];
var C = {}; CUS_HEADERS.forEach(function (h, i) { C[h] = i; });

var READ_ONLY = { perf: 1, feedback: 1, fb_list: 1, fb_img: 1, fb_update: 1, load: 1, login: 1, verify: 1, logout: 1, check_phone: 1, cust_orders: 1, src_inspect: 1, ads_inspect: 1, tg_link: 1, prefs: 1 };
function doPost(e) {
  try {
    var data = JSON.parse(e.postData.contents);
    if (data.type === 'bridge') return json(bridgeOp(data));
    if (data.type === 'vtp') return json(vtpWebhook(data.payload)); // tin báo trạng thái đơn từ Viettel Post (qua crm.thucduonglanh.vn/vtp-webhook)
    if (PropertiesService.getScriptProperties().getProperty('retired')) { // đã chuyển sang máy chủ mới
      if (data.type === 'crm') return json({ ok: false, error: 'CRM đã chuyển sang máy chủ mới. Bấm ↻ (tải lại trang) để dùng tiếp.', v: 'moved' });
      var fw = UrlFetchApp.fetch(API_URL, { method: 'post', contentType: 'text/plain;charset=utf-8', payload: e.postData.contents, muteHttpExceptions: true }); // đơn / liên hệ từ trang web cũ còn lưu trong máy khách
      return ContentService.createTextOutput(fw.getContentText()).setMimeType(ContentService.MimeType.JSON);
    }
    if (data.type === 'crm') { var t0 = Date.now(), out = crmApi(data), ro = READ_ONLY[data.action]; if (!ro && !out._patched) dataChanged(); if (!ro) out.pc = !!out._patched; delete out._patched; out.v = CRM_VERSION; out.sms = Date.now() - t0; return json(out); } // giao diện web crm.thucduonglanh.vn; pc = đã sửa bản nhớ tạm (không bắt đọc lại Sheet), sms = máy chủ chạy bao lâu (đo tốc độ)
    dataChanged(); // đơn / liên hệ từ website
    if (data.website) return json({ ok: true }); // chống spam (honeypot)
    var ss = SpreadsheetApp.getActiveSpreadsheet();
    if (ss.getSpreadsheetTimeZone() !== TZ) ss.setSpreadsheetTimeZone(TZ);
    if (data.type === 'order') { saveOrder(ss, data, {}); return json({ ok: true, id: data.id }); }
    if (data.type === 'contact') {
      var sc = sheet(ss, 'Liên hệ', CONTACT_HEADERS);
      sc.appendRow([new Date(), data.name, "'" + data.phone, data.email, data.message, data.page]);
      var ld = null, isEb = data.kind === 'ebook'; // isEb: trang nhận ebook thucduonglanh.vn/ebook/
      try { ld = addLead(ss, isEb ? { name: data.name, phone: data.phone, channel: 'Ebook – quà tặng (Website)', interest: 'Ebook quà tặng' + (data.pos ? ' · từ web (' + data.pos + ')' : ''), note: 'Đăng ký ebook trên web · Nguồn: ' + (data.source || ''), by: 'Website', auto: true } : { name: data.name, phone: data.phone, channel: 'Form website', note: data.message, by: 'Website', auto: true }); } catch (x) { console.error('lead', x); }
      var cmsg = isEb ? '🎁 <b>ĐĂNG KÝ EBOOK</b>\n👤 ' + esc(data.name) + ' – <b>' + esc(data.phone) + '</b>\n📍 Nguồn: ' + esc(data.source || '') + (data.pos ? ' · bấm từ web: ' + esc(data.pos) : '') + '\n👉 Kết bạn Zalo, mời vào nhóm Sống khỏe'
        : '✉️ <b>LIÊN HỆ MỚI</b>\n👤 ' + esc(data.name) + ' – <b>' + esc(data.phone) + '</b>\n\n' + esc(data.message);
      telegram(cmsg + (ld && ld.owner ? '\n\n👤 Giao cho: ' + esc(ld.owner) : '\n\n⚠️ Chưa có người phụ trách – vào CRM để giao'));
      if (ld && ld.owner) telegramUser(ss, ld.owner, cmsg + '\n\n👉 Khách tiềm năng mới của bạn: ' + CRM_URL + '/#tiem-nang');
      if (!isEb) MailApp.sendEmail(NOTIFY_EMAIL, '✉️ Liên hệ mới từ website – ' + data.name, data.message + '\n\n' + data.name + ' – ' + data.phone + (data.email ? ' – ' + data.email : ''));
      return json({ ok: true });
    }
    return json({ ok: false, error: 'unknown type' });
  } catch (err) {
    return json({ ok: false, error: String(err) });
  }
}

/** Ghi 1 đơn: trang Đơn hàng + Khách hàng, báo email/Telegram. opt.by = tên nhân viên nhập tay (đơn từ Zalo/điện thoại…). */
function saveOrder(ss, data, opt) {
  var c = data.customer || {}, now = new Date(), manual = !!opt.by;
  var items = itemsText(data.items || []);
  var pay = data.payment === 'bank' ? 'Chuyển khoản' : 'COD';
  var realItems = (data.items || []).filter(function (i) { return !i.gift; });
  var ca = opt.ca || caOf(now), line = opt.line || lineOf(realItems.map(function (i) { return i.name + ' ' + (i.variant || ''); }).join(' ')), ship = opt.shipText || shipText(data.items || []);
  var lock = LockService.getScriptLock(); lock.waitLock(45000);
  try {
    var sh = sheet(ss, 'Đơn hàng', ORDER_HEADERS);
    var owner = ownerOf(ss, c.phone), assigned = '';
    if (!owner && !opt.by) owner = assigned = autoOwner(ss); // khách chưa ai phụ trách + chế độ "Tự chia đều"
    var seller = opt.by || owner; // đơn nhập tay: người nhập; đơn web: người phụ trách khách
    if (!opt.otype) { try { opt.otype = otypeSuggest(ss, c.phone, now).t; } catch (x) { console.error('otype', x); } } // đơn web: loại đơn theo gợi ý
    sh.appendRow([now, data.id, c.name, "'" + normPhone(c.phone), c.email, c.province, c.district, c.address, items, data.subtotal, data.shipping, data.total, pay, c.note, opt.status || 'Mới', data.source || '', data.first_source || '', data.marketing_consent ? 'Có' : 'Không', '', '', '', seller || '', ca, line, ship, '', '', opt.otype || '', opt.oflag || '']);
    try { comboCycles(ss, data.items || []); } catch (x) { console.error('comboCycles', x); }
    try { upsertCustomer(ss, data, now); } catch (x) { console.error('CRM', x); }
    if (assigned) setOwner(ss, c.phone, assigned);
  } finally { lock.releaseLock(); }
  if (!manual) MailApp.sendEmail({
    to: NOTIFY_EMAIL,
    subject: '🛒 Đơn hàng mới ' + data.id + ' – ' + c.name + ' – ' + fmt(data.total),
    body: 'Mã đơn: ' + data.id + '\nKhách: ' + c.name + ' – ' + c.phone + (c.email ? ' – ' + c.email : '') +
      '\nĐịa chỉ: ' + c.address + ', ' + c.district + ', ' + c.province + '\n\n' + items +
      '\n\nTạm tính: ' + fmt(data.subtotal) + '\nPhí ship: ' + fmt(data.shipping) + '\nTổng: ' + fmt(data.total) +
      '\nThanh toán: ' + pay + (c.note ? '\nGhi chú: ' + c.note : '') +
      '\nNguồn: ' + (data.source || '') + '\n\nXem đơn: ' + CRM_URL + '/#don-hang'
  });
  var omsg = (manual ? '📝 <b>ĐƠN NHẬP TAY ' + esc(data.id) + '</b> – bởi ' + esc(opt.by) : '🛒 <b>ĐƠN HÀNG MỚI ' + esc(data.id) + '</b>') +
    '\n👤 ' + esc(c.name) + ' – <b>' + esc(c.phone) + '</b>' +
    '\n📍 ' + esc([c.address, c.district, c.province].filter(String).join(', ')) + '\n\n' + esc(items) +
    '\n\n💰 <b>Tổng: ' + fmt(data.total) + '</b> (ship ' + fmt(data.shipping) + ') – ' + pay +
    (c.note ? '\n📝 ' + esc(c.note) : '') + (data.source ? '\n🔗 Nguồn: ' + esc(data.source) : '');
  telegram(omsg + (manual ? '' : owner ? '\n👤 Phụ trách: ' + esc(owner) + (assigned ? ' (vừa tự chia)' : '') : '\n⚠️ Khách chưa có người phụ trách – vào CRM để giao'));
  if (!manual && owner) telegramUser(ss, owner, omsg + '\n\n👉 Đơn của khách bạn phụ trách – gọi xác nhận: ' + CRM_URL + '/#don-hang');
}

/** Gán người phụ trách cho khách (theo SĐT). */
function setOwner(ss, phone, name) {
  var cs = ss.getSheetByName('Khách hàng'); if (!cs) return false;
  var row = customerRow(cs, normPhone(phone)); if (row < 0) return false;
  cs.getRange(row, C['Phụ trách'] + 1).setValue(name); return true;
}

/** Người đang phụ trách khách (theo SĐT), '' nếu chưa có. */
function ownerOf(ss, phone) {
  try { var cs = ss.getSheetByName('Khách hàng'); if (!cs) return ''; var row = customerRow(cs, normPhone(phone)); return row > 0 ? String(cs.getRange(row, C['Phụ trách'] + 1).getValue() || '') : ''; } catch (e) { return ''; }
}

function doGet() { return json({ ok: true, service: 'Thực Dưỡng Lành orders + CRM', v: CRM_VERSION, retired: !!PropertiesService.getScriptProperties().getProperty('retired') }); }

/**
 * Cầu nối cho máy chủ Cloudflare của mình. Mỗi yêu cầu kèm 1 mã dùng 1 lần; Apps Script hỏi lại api.thucduonglanh.vn để chắc chắn yêu cầu đến từ máy chủ đó.
 * Cần bật dịch vụ "Google Sheets API" (mục Dịch vụ + trong trình soạn Apps Script) để máy chủ đọc được file Sheet nhanh.
 */
function bridgeOp(d) {
  var n = String(d.nonce || '').replace(/[^a-f0-9]/g, ''), ok = false;
  if (n.length >= 16) { try { ok = JSON.parse(UrlFetchApp.fetch(API_URL + '/bridge-check?n=' + n, { muteHttpExceptions: true }).getContentText()).ok === true; } catch (e) { } }
  if (!ok) return { ok: false, error: 'Không xác nhận được yêu cầu' };
  var pp = PropertiesService.getScriptProperties();
  if (d.op === 'token') return { ok: true, token: ScriptApp.getOAuthToken(), sheetId: SpreadsheetApp.getActiveSpreadsheet().getId(), account: Session.getEffectiveUser().getEmail(), tg: TELEGRAM_TOKEN, chats: TELEGRAM_CHAT_IDS, notify: NOTIFY_EMAIL };
  if (d.op === 'mail') { var m = d.mail || {}; MailApp.sendEmail({ to: m.to, subject: m.subject, body: m.body, name: m.name || 'Thực Dưỡng Lành' }); return { ok: true }; }
  if (d.op === 'props') return { ok: true, props: pp.getProperties() };
  if (d.op === 'retire') { // tắt lịch chạy cũ (máy chủ mới tự gửi tin 8h, lấy số quảng cáo)
    ScriptApp.getProjectTriggers().forEach(function (t) { if (['dailyCare', 'adsTick'].indexOf(t.getHandlerFunction()) >= 0) ScriptApp.deleteTrigger(t); });
    pp.setProperty('retired', String(Date.now())); return { ok: true };
  }
  return { ok: false, error: 'Không rõ yêu cầu' };
}
/** Chạy tay trong trình soạn Apps Script nếu cần quay lại máy chủ cũ. */
function quayLaiMayChuCu() { PropertiesService.getScriptProperties().deleteProperty('retired'); Logger.log('Đã bật lại máy chủ cũ. Nhớ chạy setupCRM để cài lại lịch 8h.'); }

/* ================================================================ Viettel Post: tự cập nhật trạng thái đơn
 * Viettel Post gửi tin mỗi lần đơn đổi trạng thái (webhook) → crm.thucduonglanh.vn/vtp-webhook (Cloudflare, trả 200 ngay) → doPost type 'vtp' → đây.
 * Cài 1 lần: partner.viettelpost.vn (đăng nhập tài khoản shop) → Cài đặt tài khoản → Cấu hình webhook: URL = https://crm.thucduonglanh.vn/vtp-webhook,
 * Secret = 1 chuỗi tự đặt; Apps Script → ⚙️ Cài đặt dự án → Thuộc tính tập lệnh → VTP_SECRET = đúng chuỗi đó. Viettel Post duyệt xong là chạy.
 * Ghi vào tab Đơn hàng: Hành trình VC (chữ hiện trên CRM), Cập nhật VC (giờ của trạng thái), Mã TT VC (mã trạng thái Viettel Post).
 * 501 phát thành công → Đã giao; 504 đã trả về người gửi → Hoàn; trạng thái khác (đã nhận hàng, đang chuyển…) mà đơn còn Mới/Đã xác nhận → Đang giao.
 * Giao không được / đang hoàn / huỷ → báo Telegram nhóm + nhân viên bán để gọi khách. */
var VTP_ALERT = { 502: 'Chuyển hoàn', 503: 'Huỷ theo yêu cầu', 505: 'Sắp chuyển hoàn', 506: 'Khách vắng nhà / không liên lạc được', 507: 'Khách hẹn đến bưu cục nhận', 515: 'Bưu cục duyệt hoàn' };
var VTP_BOT = { name: 'Viettel Post (tự động)', email: '', level: 3, role: 'Hệ thống' };
function vtpWebhook(raw) {
  var d; try { d = typeof raw === 'string' ? JSON.parse(raw) : raw; } catch (e) { return { ok: false, error: 'Dữ liệu không đọc được' }; }
  var secret = PropertiesService.getScriptProperties().getProperty('VTP_SECRET') || '';
  if (!secret || String(d && d.TOKEN || '') !== secret) return { ok: false, denied: true, error: secret ? 'Sai mã bí mật' : 'Chưa cài VTP_SECRET trong Thuộc tính tập lệnh' };
  var D = d.DATA || {}, code = String(D.ORDER_NUMBER || '').trim().toUpperCase(), st = Number(D.ORDER_STATUS) || 0;
  if (!code) return { ok: true, skip: 'Không có mã vận đơn' };
  var lock = LockService.getScriptLock(); lock.waitLock(20000);
  try {
    var ss = SpreadsheetApp.getActiveSpreadsheet(), o = orderSheet(ss), sh = o.sh, H = o.H, n = sh.getLastRow() - 1;
    var col = function (h) { return H.indexOf(h) + 1; }, ref = String(D.ORDER_REFERENCE || '').trim();
    if (n < 1) return { ok: true, skip: 'Chưa có đơn' };
    var trk = sh.getRange(2, col('Mã vận đơn'), n, 1).getValues(), ids = sh.getRange(2, col('Mã đơn'), n, 1).getValues(), row = -1;
    for (var i = n - 1; i >= 0; i--) if (String(trk[i][0]).replace(/^'/, '').trim().toUpperCase() === code) { row = i + 2; break; } // đơn mới nhất có mã này
    if (row < 0 && ref) for (var k = n - 1; k >= 0; k--) if (String(ids[k][0]) === ref) { row = k + 2; break; } // mã tham chiếu = mã đơn của mình
    if (row < 0) return { ok: true, skip: 'Không có đơn nào mang mã ' + code };
    var at = vtpDate(D.ORDER_STATUSDATE) || new Date(), prevAt = sh.getRange(row, col('Cập nhật VC')).getValue();
    if (prevAt instanceof Date && at < prevAt) return { ok: true, skip: 'Tin cũ hơn tin đã có' }; // tin đến trễ / gửi lại
    var prevCode = Number(sh.getRange(row, col('Mã TT VC')).getValue()) || 0, id = String(sh.getRange(row, col('Mã đơn')).getValue());
    var name = String(sh.getRange(row, col('Khách hàng')).getValue()), seller = String(sh.getRange(row, col('NV bán')).getValue() || '');
    var old = String(sh.getRange(row, col('Trạng thái')).getValue() || 'Mới'), returning = D.IS_RETURNING === true;
    var label = String(D.STATUS_NAME || VTP_ALERT[st] || ('Trạng thái ' + st)).trim(), place = vtpPlace(D.LOCATION_CURRENTLY || D.LOCALION_CURRENTLY), note = String(D.NOTE || '').trim();
    var line = Utilities.formatDate(at, TZ, 'dd/MM HH:mm') + ' · ' + (returning && st !== 504 ? '↩️ Đang hoàn · ' : '') + label + (place ? ' · ' + place : '') + (note && note !== label ? ' · ' + note : '');
    sh.getRange(row, col('Hành trình VC')).setValue(line.slice(0, 300)); sh.getRange(row, col('Cập nhật VC')).setValue(at); sh.getRange(row, col('Mã TT VC')).setValue(st);
    if (!sh.getRange(row, col('Đơn vị vận chuyển')).getValue()) sh.getRange(row, col('Đơn vị vận chuyển')).setValue('Viettel Post');
    var to = st === 501 ? (/^(Mới|Đã xác nhận|Đang giao)$/.test(old) ? 'Đã giao' : '') : st === 504 ? (isVoid(old) ? '' : 'Hoàn')
      : st >= 200 && /^(Mới|Đã xác nhận)$/.test(old) && st !== 201 && st !== 503 ? 'Đang giao' : '';
    var res = to ? crmOrderStatus(ss, VTP_BOT, { id: id, row: row, status: to, reason: label }) : { ok: true, row: row };
    if (!to && st !== prevCode && (VTP_ALERT[st] || st === 504)) crmLog(ss, VTP_BOT, 'Đơn hàng', id, name, label, note);
    var warn = st !== prevCode && (VTP_ALERT[st] || st === 504);
    if (warn) {
      var msg = '🚚 <b>Viettel Post</b> · ' + esc(code) + '\n👤 <b>' + esc(name) + '</b> (' + esc(id) + ')\n⚠️ ' + esc(label) + (to === 'Hoàn' ? ' → đơn chuyển sang <b>Hoàn</b>' : '')
        + (note ? '\n📝 ' + esc(note) : '') + (place ? '\n📍 ' + esc(place) : '') + (seller ? '\n👤 NV bán: ' + esc(seller) : '') + '\n👉 ' + (st === 504 ? 'Xem đơn' : 'Gọi khách giữ đơn') + ': ' + CRM_URL + '/#don-hang';
      telegram(msg); if (seller) telegramUser(ss, seller, msg);
    }
    if (!(res && res.ok && cachePatch(ss, { id: id }, 'order_status', { row: row }))) dataChanged(); // sửa đúng dòng trong bản nhớ tạm; không được thì bắt đọc lại
    return { ok: true, id: id, status: (res && res.status) || old };
  } finally { lock.releaseLock(); }
}
/** "22/01/2026 09:36:53" → Date (giờ Việt Nam). */
function vtpDate(s) {
  var m = String(s || '').match(/(\d{1,2})\/(\d{1,2})\/(\d{4})\s+(\d{1,2}):(\d{2})(?::(\d{2}))?/); if (!m) return null;
  return Utilities.parseDate(m[3] + '-' + m[2] + '-' + m[1] + ' ' + m[4] + ':' + m[5] + ':' + (m[6] || '00'), TZ, 'yyyy-M-d H:mm:ss');
}
/** "BDG, HBBDDA, Bưu cục Thắng Lợi - BDG - Bình Dương, 0335…, …" → "Bưu cục Thắng Lợi - BDG - Bình Dương". */
function vtpPlace(s) {
  var p = String(s || '').split(/\s*,\s*/).filter(Boolean); if (!p.length) return '';
  var x = p.filter(function (t) { return /bưu cục|buu cuc|kho|trung tâm|điểm|bưu điện/i.test(t); })[0] || p[2] || p[0];
  return x.slice(0, 80);
}
/** Chạy tay trong Apps Script để thử: giả 1 tin Viettel Post cho mã vận đơn bên dưới (đổi mã thật trước khi chạy). */
function testVTP() {
  var code = 'V_DOI_MA_THAT', secret = PropertiesService.getScriptProperties().getProperty('VTP_SECRET');
  Logger.log(JSON.stringify(vtpWebhook({ TOKEN: secret, DATA: { ORDER_NUMBER: code, ORDER_STATUS: 506, STATUS_NAME: 'Tồn - Khách hàng nghỉ, không có nhà', ORDER_STATUSDATE: Utilities.formatDate(new Date(), TZ, 'dd/MM/yyyy HH:mm:ss'), NOTE: 'Thử nghiệm', LOCATION_CURRENTLY: 'HCM, X, Bưu cục Thử - HCM, 0, 0' } })));
}

/* ================================================================ CRM */

/** Chạy 1 lần sau khi dán code: tạo các trang tính, dựng danh sách khách từ đơn cũ, cài lịch 8h sáng. */
function setupCRM() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  ss.setSpreadsheetTimeZone(TZ);
  sheet(ss, 'Đơn hàng', ORDER_HEADERS);
  cycleSheet(ss); templateSheet(ss);
  rebuildCustomers();
  ScriptApp.getProjectTriggers().forEach(function (t) { if (t.getHandlerFunction() === 'dailyCare') ScriptApp.deleteTrigger(t); });
  ScriptApp.newTrigger('dailyCare').timeBased().atHour(8).nearMinute(0).everyDays(1).inTimezone(TZ).create();
  telegram('✅ <b>CRM Thực Dưỡng Lành đã bật</b>\nMỗi sáng 8h nhóm sẽ nhận danh sách khách cần chăm sóc.');
}

/** "Hạnh (x)" / "(X)" / "(×)" = sale đã kết bạn Zalo với khách (cách đánh dấu trong file Sheet) → tên gọn + cờ Zalo. */
var ZALO_RE = /\s*\(\s*[xX×]\s*\)/g;
function zaloMark(name) { var s = String(name || ''); return { name: s.replace(ZALO_RE, '').replace(/\s{2,}/g, ' ').trim(), zalo: /\(\s*[xX×]\s*\)/.test(s) }; }
function normPhone(p) { p = String(p || '').replace(/\D/g, ''); if (p.indexOf('84') === 0 && p.length >= 11) p = '0' + p.slice(2); if (p.length === 9 && /^[35789]/.test(p)) p = '0' + p; return p; } // số copy từ Google Sheet hay mất số 0 đầu

function cycleSheet(ss) {
  var sh = ss.getSheetByName('Chu kỳ dùng');
  if (!sh) {
    sh = ss.insertSheet('Chu kỳ dùng');
    sh.getRange(1, 1, 1, 4).setValues([['Tên sản phẩm (chứa chữ)', 'Quy cách (chứa chữ, để trống = mọi quy cách)', 'Số ngày dùng hết 1 đơn vị', 'Căn cứ']]);
    sh.getRange(2, 1, 8, 4).setValues([
      ['DILVANG', '', 6, '15 gói, dùng 2–3 gói/ngày (theo nhãn)'],
      ['Bữa Ăn Dinh Dưỡng', '500g', 10, '20 gói, khoảng 2 gói/ngày'],
      ['Bữa Ăn Dinh Dưỡng', '125g', 3, '5 gói, khoảng 2 gói/ngày'],
      ['Curcumin', '400g', 7, '30g/lần, 2 lần/ngày'],
      ['Curcumin', '125g', 2, '30g/lần, 2 lần/ngày'],
      ['Ruốc', '215g', 10, 'Ước tính – chỉnh theo thực tế'],
      ['Ruốc', '165g', 8, 'Ước tính – chỉnh theo thực tế'],
      ['Xì Dầu', '', 30, 'Ước tính – chỉnh theo thực tế']]);
    styleHeader(sh, 4); sh.setColumnWidths(1, 4, 220);
  }
  var pp = PropertiesService.getScriptProperties();
  if (!pp.getProperty('cycles_sale_added')) { // sản phẩm sale bán nhiều (ước tính 30g/lần, 2 lần/ngày) – quản lý chỉnh lại cho đúng thực tế
    [['Progomax', '900g', 15], ['Progomax', '400g', 7], ['Gafo', '800g', 13], ['Gafo', '500g', 8], ['Curcumin', '900g', 15], ['Vimy', '900g', 15], ['Ngũ cốc', '900g', 15], ['Ngũ cốc', '400g', 7]].forEach(function (x) { sh.appendRow([x[0], x[1], x[2], 'Ước tính 30g/lần, 2 lần/ngày – chỉnh theo thực tế']); });
    pp.setProperty('cycles_sale_added', '1');
  }
  if (sh.getLastRow() < 2) return [];
  return sh.getRange(2, 1, sh.getLastRow() - 1, 3).getValues().filter(function (r) { return r[0] && r[2]; });
}

/** Gói giải pháp trên web gửi kèm "days" (số ngày dùng hết gói) → tự thêm vào tab Chu kỳ dùng nếu chưa có, để CRM nhắc sale đúng ngày. */
function comboCycles(ss, items) {
  var add = (items || []).filter(function (i) { return Number(i.days) > 0 && i.name; }); if (!add.length) return;
  var cy = cycleSheet(ss), sh = ss.getSheetByName('Chu kỳ dùng');
  add.forEach(function (i) {
    var nm = String(i.name).toLowerCase();
    if (cy.some(function (r) { return nm.indexOf(String(r[0]).toLowerCase()) >= 0 && !r[1] && Number(r[2]) === Number(i.days); })) return;
    sh.appendRow([i.name, '', Number(i.days), 'Gói giải pháp – web tự thêm']); cy.push([i.name, '', Number(i.days)]);
  });
}

function templateSheet(ss) {
  if (ss.getSheetByName('Mẫu tin nhắn CSKH')) return;
  var sh = ss.insertSheet('Mẫu tin nhắn CSKH');
  sh.getRange(1, 1, 1, 3).setValues([['Thời điểm', 'Mục đích', 'Mẫu tin nhắn Zalo (thay [Tên], [Sản phẩm])']]);
  sh.getRange(2, 1, 5, 3).setValues([
    ['1 ngày sau khi nhận hàng', 'Hỏi nhận hàng + hướng dẫn dùng', 'Dạ em chào [Tên] ạ, em là nhân viên Thực Dưỡng Lành. [Tên] đã nhận được [Sản phẩm] chưa ạ? Em gửi mình cách dùng để đạt hiệu quả tốt nhất: … Có gì chưa rõ [Tên] cứ nhắn em nhé ❤️'],
    ['Trước khi hết sản phẩm', 'Nhắc đặt lại', 'Dạ [Tên] ơi, theo lịch thì [Sản phẩm] của mình sắp hết rồi ạ. [Tên] có muốn em lên đơn tiếp để dùng không bị gián đoạn không ạ? Đơn từ 300.000đ được miễn phí vận chuyển ạ.'],
    ['14 ngày sau khi nhận hàng', 'Xin cảm nhận', 'Dạ em chào [Tên], mình dùng [Sản phẩm] được 2 tuần rồi, [Tên] thấy thế nào ạ? Cảm nhận của [Tên] giúp Thực Dưỡng Lành làm tốt hơn mỗi ngày ạ 🙏'],
    ['30 ngày sau khi nhận hàng', 'Giới thiệu sản phẩm phù hợp', 'Dạ [Tên] ơi, ngoài [Sản phẩm], Thực Dưỡng Lành còn … phù hợp để bữa ăn cân bằng hơn. Em gửi [Tên] tham khảo nhé: https://thucduonglanh.vn/san-pham/'],
    ['60 ngày chưa mua lại', 'Mời quay lại', 'Dạ lâu rồi em chưa được phục vụ [Tên] ạ. Tháng này Thực Dưỡng Lành có ưu đãi dành riêng cho khách cũ … [Tên] cần em tư vấn gì cứ nhắn em nhé ❤️']]);
  styleHeader(sh, 3); sh.setColumnWidth(1, 170); sh.setColumnWidth(2, 200); sh.setColumnWidth(3, 620); sh.getRange('C:C').setWrap(true);
}

function usageDays(cycles, name, variant) {
  var nm = String(name).toLowerCase(); // ưu tiên dòng khớp TÊN (gói "Thử thách 10 ngày" có quy cách "Gồm … DILVANG …" không bị nhận nhầm thành DILVANG)
  for (var k = 0; k < cycles.length; k++) { var q = cycles[k]; if (q[0] && nm.indexOf(String(q[0]).toLowerCase()) >= 0 && (!q[1] || (nm + ' ' + String(variant || '').toLowerCase()).indexOf(String(q[1]).toLowerCase()) >= 0)) return Number(q[2]) || 0; }
  for (var i = 0; i < cycles.length; i++) {
    var r = cycles[i];
    var full = (String(name) + ' ' + String(variant || '')).toLowerCase();
    if (full.indexOf(String(r[0]).toLowerCase()) >= 0 && (!r[1] || full.indexOf(String(r[1]).toLowerCase()) >= 0)) return Number(r[2]) || 0;
  }
  return 0;
}

/** Ngày dự kiến hết hàng = ngày đặt + (số ngày dùng × số lượng) của món hết sớm nhất trong đơn. */
function runOutDate(cycles, items, date) {
  var best = 0;
  (items || []).forEach(function (i) { var d = usageDays(cycles, i.name, i.variant) * (Number(i.qty) || 1); if (d && (!best || d < best)) best = d; });
  return best ? new Date(date.getTime() + best * 864e5) : '';
}

/** Mức VIP / Sắp mất do quản lý cài (Cài đặt → Nhóm khách). */
var RULES_CFG = null;
function rulesCfg() {
  if (RULES_CFG) return RULES_CFG;
  var r = {}; try { r = JSON.parse(PropertiesService.getScriptProperties().getProperty('rules_cfg') || '{}'); } catch (e) { }
  RULES_CFG = { vipOrders: Number(r.vipOrders) || VIP_ORDERS, vipSpent: Number(r.vipSpent) || VIP_SPENT, atRisk: Number(r.atRisk) || AT_RISK_DAYS, shipDays: r.shipDays !== undefined && r.shipDays !== '' ? Number(r.shipDays) : SHIP_DAYS, famMin: r.famMin !== undefined && r.famMin !== '' ? Number(r.famMin) : FAM_MIN }; return RULES_CFG;
}
function commissionCfg() { try { return JSON.parse(PropertiesService.getScriptProperties().getProperty('commission_cfg') || '{}'); } catch (e) { return {}; } }
function groupOf(orders, spent, last) {
  var R = rulesCfg();
  if (last && !isNaN(last) && (Date.now() - last.getTime()) / 864e5 > R.atRisk) return 'Sắp mất';
  if (orders >= R.vipOrders || spent >= R.vipSpent) return 'VIP';
  if (orders >= 2) return 'Quay lại';
  return 'Mới';
}

function upsertCustomer(ss, data, when) {
  var sh = sheet(ss, 'Khách hàng', CUS_HEADERS), cycles = cycleSheet(ss);
  var c = data.customer || {}, phone = normPhone(c.phone); if (!phone) return;
  var real = (data.items || []).filter(function (i) { return !i.gift; });
  var names = real.map(function (i) { return i.name + (i.variant ? ' (' + i.variant + ')' : ''); });
  var run = runOutDate(cycles, real, recvBase(when, null));
  var last = sh.getLastRow(), rowIdx = -1;
  if (last > 1) { var phones = sh.getRange(2, 1, last - 1, 1).getValues(); for (var i = 0; i < phones.length; i++) if (normPhone(phones[i][0]) === phone) { rowIdx = i + 2; break; } }
  if (rowIdx < 0) {
    var row = []; for (var k = 0; k < CUS_HEADERS.length; k++) row.push('');
    row[C['Điện thoại']] = "'" + phone; row[C['Tên']] = zaloMark(c.name).name; if (zaloMark(c.name).zalo) row[C['Zalo']] = 'Có'; row[C['Địa chỉ']] = c.address; row[C['Tỉnh/TP']] = c.province; row[C['Phường/Xã']] = c.district;
    row[C['Số đơn']] = 1; row[C['Tổng chi']] = Number(data.total) || 0; row[C['Đơn đầu']] = when; row[C['Đơn gần nhất']] = when;
    row[C['Sản phẩm đã mua']] = names.join('; '); row[C['Dự kiến hết hàng']] = run; row[C['Nhóm']] = groupOf(1, Number(data.total) || 0, when);
    row[C['Đồng ý nhận tin']] = data.marketing_consent ? 'Có' : 'Không'; row[C['Nguồn đầu tiên']] = data.first_source || data.source || '';
    sh.appendRow(row);
  } else {
    var r = sh.getRange(rowIdx, 1, 1, CUS_HEADERS.length), v = r.getValues()[0];
    var orders = (Number(v[C['Số đơn']]) || 0) + 1, spent = (Number(v[C['Tổng chi']]) || 0) + (Number(data.total) || 0);
    var bought = String(v[C['Sản phẩm đã mua']] || '').split('; ').filter(String);
    names.forEach(function (n) { if (bought.indexOf(n) < 0) bought.push(n); });
    v[C['Tên']] = zaloMark(c.name).name || v[C['Tên']]; if (zaloMark(c.name).zalo) v[C['Zalo']] = 'Có'; v[C['Địa chỉ']] = c.address || v[C['Địa chỉ']]; v[C['Tỉnh/TP']] = c.province || v[C['Tỉnh/TP']]; v[C['Phường/Xã']] = c.district || v[C['Phường/Xã']];
    v[C['Số đơn']] = orders; v[C['Tổng chi']] = spent; v[C['Đơn gần nhất']] = when; v[C['Nhận hàng']] = ''; v[C['Sản phẩm đã mua']] = bought.join('; ');
    v[C['Dự kiến hết hàng']] = run || v[C['Dự kiến hết hàng']]; v[C['Nhóm']] = groupOf(orders, spent, when);
    if (data.marketing_consent) v[C['Đồng ý nhận tin']] = 'Có';
    v[C['Điện thoại']] = "'" + phone;
    r.setValues([v]);
  }
}

/** Dựng lại toàn bộ trang "Khách hàng" từ trang "Đơn hàng" (bỏ đơn Huỷ / Hoàn). Giữ nguyên các cột nhân viên điền. opt.owners = {sđt: tên} gán người phụ trách cho khách chưa có. */
function rebuildCustomers(opt) {
  dataChanged();
  opt = opt || {};
  var ss = SpreadsheetApp.getActiveSpreadsheet(), os = ss.getSheetByName('Đơn hàng'); if (!os || os.getLastRow() < 2) return;
  var cs = sheet(ss, 'Khách hàng', CUS_HEADERS), cycles = cycleSheet(ss), keep = {};
  var KEEP = ['Phụ trách', 'Lần CSKH gần nhất', 'Kết quả CSKH', 'Ghi chú CSKH', 'Hẹn gọi lại', 'Nhãn', 'Nhãn màu', 'Zalo', 'Cộng đồng'];
  if (cs.getLastRow() > 1) cs.getRange(2, 1, cs.getLastRow() - 1, CUS_HEADERS.length).getValues().forEach(function (v) { var ph = normPhone(v[0]); if (ph) keep[ph] = v; });
  var H = os.getRange(1, 1, 1, os.getLastColumn()).getValues()[0], idx = function (n) { return H.indexOf(n); };
  var rows = os.getRange(2, 1, os.getLastRow() - 1, os.getLastColumn()).getValues();
  rows.sort(function (a, b) { return new Date(a[0]) - new Date(b[0]); });
  var iRv = idx('Ngày nhận'), iSe = idx('NV bán'), map = {}, order = [], iSt = idx('Trạng thái'), iPh = idx('Điện thoại'), iIt = idx('Sản phẩm'), iTo = idx('Tổng'), iCo = idx('Đồng ý nhận tin'), iFs = idx('Nguồn đầu tiên'), iSo = idx('Nguồn');
  rows.forEach(function (r) {
    if (isVoid(r[iSt])) return;
    var phone = normPhone(r[iPh]), when = new Date(r[0]); if (!phone || isNaN(when)) return;
    var items = parseItemLines(r[iIt]);
    var c = map[phone];
    if (!c) { c = map[phone] = { orders: 0, spent: 0, first: when, bought: [], run: '', consent: false, src: String((iFs >= 0 && r[iFs]) || (iSo >= 0 && r[iSo]) || '') }; order.push(phone); }
    c.orders++; c.spent += Number(r[iTo]) || 0; c.last = when; if (iSe >= 0 && r[iSe]) c.seller = String(r[iSe]);
    var rv = iRv >= 0 && r[iRv] ? new Date(r[iRv]) : null; c.recv = rv && !isNaN(rv) ? rv : '';
    ['Khách hàng', 'Địa chỉ', 'Tỉnh/TP', 'Phường/Xã'].forEach(function (h) { var v = r[idx(h)]; if (v !== '' && v != null) c[h] = v; });
    if (zaloMark(r[idx('Khách hàng')]).zalo) c.zalo = true;
    items.forEach(function (i) { var n = i.name + (i.variant ? ' (' + i.variant + ')' : ''); if (c.bought.indexOf(n) < 0) c.bought.push(n); });
    c.run = runOutDate(cycles, items, recvBase(when, c.recv || null)) || ''; // dùng hết tính từ ngày khách nhận hàng của ĐƠN GẦN NHẤT (sản phẩm chưa có chu kỳ → để trống, không lấy ngày của đơn cũ)
    if (iCo >= 0 && r[iCo] === 'Có') c.consent = true;
  });
  var out = order.map(function (ph) {
    var c = map[ph], k = keep[ph], v = []; for (var i = 0; i < CUS_HEADERS.length; i++) v.push('');
    v[C['Điện thoại']] = "'" + ph; v[C['Tên']] = zaloMark(c['Khách hàng']).name; v[C['Địa chỉ']] = c['Địa chỉ'] || ''; v[C['Tỉnh/TP']] = c['Tỉnh/TP'] || ''; v[C['Phường/Xã']] = c['Phường/Xã'] || '';
    v[C['Số đơn']] = c.orders; v[C['Tổng chi']] = c.spent; v[C['Đơn đầu']] = c.first; v[C['Đơn gần nhất']] = c.last; v[C['Sản phẩm đã mua']] = c.bought.join('; ');
    v[C['Dự kiến hết hàng']] = c.run; v[C['Nhận hàng']] = c.recv || ''; v[C['Nhóm']] = groupOf(c.orders, c.spent, c.last); v[C['Đồng ý nhận tin']] = c.consent || (k && k[C['Đồng ý nhận tin']] === 'Có') ? 'Có' : 'Không'; v[C['Nguồn đầu tiên']] = c.src; // sale bấm "khách đồng ý nhận ưu đãi" → giữ
    if (k) KEEP.forEach(function (h) { v[C[h]] = k[C[h]]; });
    if (c.zalo && !v[C['Zalo']]) v[C['Zalo']] = 'Có';
    if (!v[C['Phụ trách']] && opt.owners && opt.owners[ph]) v[C['Phụ trách']] = opt.owners[ph];
    if (!v[C['Phụ trách']] && opt.sellerOwner && c.seller === opt.sellerOwner) v[C['Phụ trách']] = opt.sellerOwner;
    return v;
  });
  Object.keys(keep).forEach(function (ph) { if (!map[ph] && keep[ph][C['Nhãn']]) { var v = keep[ph].slice(); v[0] = "'" + ph; out.push(v); } }); // khách bị gắn nhãn (bom hàng…) vẫn giữ dù không còn đơn
  if (cs.getLastRow() > 1) cs.getRange(2, 1, cs.getLastRow() - 1, CUS_HEADERS.length).clearContent();
  if (out.length) { if (cs.getMaxRows() < out.length + 1) cs.insertRowsAfter(cs.getMaxRows(), out.length + 1 - cs.getMaxRows()); cs.getRange(2, 1, out.length, CUS_HEADERS.length).setValues(out); }
}
/** Đọc dòng sản phẩm đã lưu: "Tên (quy cách) x2 = 280.000 ₫". Bỏ dòng quà tặng (🎁). */
function parseItemLines(text) {
  return String(text || '').split('\n').map(function (l) { if (/^🎁/.test(l)) return null; var m = l.match(/^(.*?)(?: \((.*?)\))? x(\d+) =/); return m ? { name: m[1], variant: m[2] || '', qty: +m[3] } : null; }).filter(Boolean);
}

/**
 * Việc chăm sóc của 1 khách hôm nay (dùng chung cho tin Telegram 8h và trang "Hôm nay" trên CRM web).
 * Mỗi mốc có vài ngày "cửa sổ" để lỡ cuối tuần vẫn không sót; ai đã được chăm sóc sau mốc thì không nhắc nữa.
 */
var CARE_STEPS = [
  { key: 'd1', at: 0, win: 2 },       // hỏi nhận hàng, hướng dẫn dùng: từ ngày nhận (thật hoặc ước tính) đến 2 ngày sau
  { key: 'runout' },                  // sắp hết / đã hết sản phẩm
  { key: 'd7', at: 7, win: 2 },       // hỏi thăm sau 1 tuần: dùng có khó khăn gì, cần hỗ trợ gì
  { key: 'd14', at: 14, win: 3 },     // xin cảm nhận
  { key: 'd30', at: 30, win: 3 },     // giới thiệu sản phẩm phù hợp
  { key: 'winback', at: AT_RISK_DAYS, win: 7 } // mời quay lại
];
/** Đơn gần nhất (không tính huỷ/hoàn) của từng khách: ngày đặt, trạng thái, ngày gửi → ước tính ngày khách nhận hàng. */
function shipMap(orders) {
  var by = {}, m = {}, min = rulesCfg().famMin;
  orders.forEach(function (o) { if (o.phone) (by[o.phone] = by[o.phone] || []).push(o); });
  Object.keys(by).forEach(function (p) {
    var list = by[p].slice().sort(function (a, b) { return (a.time || 0) - (b.time || 0); }), xi = -1;
    for (var i = list.length - 1; i >= 0; i--) if (!isVoid(list[i].status)) { xi = i; break; }
    if (xi < 0) return; var x = list[xi];
    m[p] = { time: x.time || 0, status: x.status, shipAt: x.shipAt || 0, fam: famOf(list, xi, min) };
  });
  return m;
}
/** Tên sản phẩm trong ô "Sản phẩm" của đơn → khoá so sánh (bỏ quà 🎁, số lượng, giá, quy cách 400g/900g…). */
function prodKeys(items) {
  return String(items || '').split(/\n|;\s*/).map(function (l) { return l.trim(); }).filter(function (l) { return l && !/^🎁/.test(l); }).map(function (l) {
    return l.replace(/=.*$/, '').replace(/\s*x\s*\d+\s*$/i, '').toLowerCase().replace(/\(.*?\)/g, ' ').replace(/\d+([.,]\d+)?\s*(g|gr|gram|kg|ml|l|gói|goi|hộp|hop|hũ|hu|lon)(?=\s|$)/g, ' ').replace(/[^0-9a-zà-ỹđ]+/g, ' ').replace(/\s+/g, ' ').trim();
  }).filter(function (k) { return k.length >= 3; });
}
/** Khách quen sản phẩm: mọi sản phẩm trong đơn gần nhất khách đã nhận ≥ min lần trước đó (lần gần nhất trong FAM_GAP ngày), và đơn liền trước không bị hoàn.
 *  → đã biết cách dùng: không nhắc hỏi nhận hàng / 7 ngày / 14 ngày (vẫn nhắc sắp hết hàng, 30 ngày, mời quay lại). min = 0: tắt. */
function famOf(list, xi, min) {
  if (!min) return false;
  var x = list[xi], keys = prodKeys(x.items), t = x.time || 0; if (!keys.length) return false;
  var prev = list.slice(0, xi).filter(function (o) { return (o.time || 0) < t; }); if (!prev.length) return false;
  if (/hoàn/i.test(prev[prev.length - 1].status)) return false; // đơn trước bị hoàn: gọi lại cho chắc
  var pk = prev.filter(function (o) { return !isVoid(o.status); }).map(function (o) { return { time: o.time || 0, keys: prodKeys(o.items) }; });
  var same = function (a, b) { return a === b || a.indexOf(b) >= 0 || b.indexOf(a) >= 0; };
  return keys.every(function (k) {
    var hit = pk.filter(function (o) { return o.keys.some(function (q) { return same(k, q); }); });
    return hit.length >= min && t - hit[hit.length - 1].time <= FAM_GAP * 864e5;
  });
}
function shipMapSheet(ss) {
  var t = tableOf(ss.getSheetByName('Đơn hàng')), H = t.H, iT = H.indexOf('Thời gian'), iP = H.indexOf('Điện thoại'), iS = H.indexOf('Trạng thái'), iG = H.indexOf('Ngày gửi'), iI = H.indexOf('Sản phẩm');
  return shipMap(t.rows.map(function (r) { return { time: ts(r[iT]), phone: normPhone(r[iP]), status: String(r[iS] || 'Mới'), shipAt: iG >= 0 ? ts(r[iG]) : 0, items: iI >= 0 ? String(r[iI] || '') : '' }; }));
}
/** Ngày khách nhận hàng: ngày thật (cột Nhận hàng) → không có thì ngày gửi + số ngày giao → không có thì ngày đặt + số ngày giao.
 *  Đơn mới đặt (≤ 7 ngày) còn chờ xác nhận / chờ gửi → coi như chưa nhận (chưa hỏi “đã nhận hàng chưa”). */
function recvEst(ord, sh, today) {
  var sd = rulesCfg().shipDays * 864e5;
  if (sh && sh.time >= ord.getTime() - 864e5) {
    if (sh.shipAt) return startOfDay(new Date(sh.shipAt + sd));
    if ((sh.status === 'Mới' || sh.status === 'Đã xác nhận') && today.getTime() - sh.time < 7 * 864e5) return new Date(today.getTime() + sd);
  }
  return startOfDay(recvBase(ord, null));
}
var FAM_SKIP = { d1: 1, d7: 1, d14: 1 };
function careTask(v, today, sh) {
  var ord = v[C['Đơn gần nhất']] ? startOfDay(new Date(v[C['Đơn gần nhất']])) : null; if (!ord || isNaN(ord)) return null;
  var rv = v[C['Nhận hàng']] ? startOfDay(new Date(v[C['Nhận hàng']])) : null; if (rv && isNaN(rv)) rv = null;
  var last = rv || recvEst(ord, sh, today), est = !rv; // các mốc chăm sóc tính từ ngày khách nhận hàng (chưa biết thì ước tính)
  var days = Math.round((today - last) / 864e5);
  var run = v[C['Dự kiến hết hàng']] ? startOfDay(new Date(v[C['Dự kiến hết hàng']])) : null; if (run && isNaN(run)) run = null;
  if (run && est) { var lag = Math.round((last - startOfDay(recvBase(ord, null))) / 864e5); if (lag > 0 && lag < 30) run = new Date(run.getTime() + lag * 864e5); } // gửi hàng muộn → ngày hết hàng lùi theo
  var care = v[C['Lần CSKH gần nhất']] ? startOfDay(new Date(v[C['Lần CSKH gần nhất']])) : null; if (care && isNaN(care)) care = null;
  var toRun = run ? Math.round((run - today) / 864e5) : null;
  var cb = v[C['Hẹn gọi lại']] ? startOfDay(new Date(v[C['Hẹn gọi lại']])) : null;
  if (cb && !isNaN(cb) && cb <= today) return { type: 'callback', days: days, late: Math.round((today - cb) / 864e5), toRun: toRun, est: est };
  if (days < 0) return null; // hàng còn đang đi đường
  // Mốc đến hạn MUỘN nhất được làm (mốc cũ bị lỡ thì thôi, không chặn mốc mới); ưu tiên: hỏi nhận hàng > sắp hết hàng > các mốc khác
  var pick = null, runT = null;
  for (var i = 0; i < CARE_STEPS.length; i++) {
    var s = CARE_STEPS[i];
    if (sh && sh.fam && FAM_SKIP[s.key]) continue; // khách quen sản phẩm: đã biết cách dùng
    if (s.key === 'runout') {
      if (toRun !== null && toRun >= -7 && toRun <= 2 && days >= 2 && !(care && care >= new Date(run.getTime() - 3 * 864e5))) runT = { type: 'runout', days: days, late: toRun < 0 ? -toRun : 0, toRun: toRun, est: est };
    } else { var at = s.key === 'winback' ? rulesCfg().atRisk : s.at; if (days >= at && days <= at + s.win + MISS_DAYS && !(care && care >= new Date(last.getTime() + at * 864e5))) pick = { type: s.key, days: days, late: Math.max(0, days - at - s.win), toRun: toRun, est: est }; } // quá khung chưa làm: vẫn hiện thêm MISS_DAYS ngày
  }
  if (pick && pick.type === 'd1') return pick;
  return runT || pick;
}

/** 8h sáng mỗi ngày: cập nhật nhóm khách, gửi danh sách cần chăm sóc vào nhóm Telegram (quản lý) và riêng cho từng nhân viên. Chạy tay để thử. */
function dailyCare() {
  if (PropertiesService.getScriptProperties().getProperty('retired')) return; // máy chủ mới đã gửi
  dataChanged();
  var ss = SpreadsheetApp.getActiveSpreadsheet(), cs = ss.getSheetByName('Khách hàng'); if (!cs || cs.getLastRow() < 2) return;
  var today = startOfDay(new Date()), rg = cs.getRange(2, 1, cs.getLastRow() - 1, CUS_HEADERS.length), vals = rg.getValues(), items = [], sm = shipMapSheet(ss);
  vals.forEach(function (v) {
    if (!v[C['Đơn gần nhất']]) return;
    v[C['Nhóm']] = groupOf(Number(v[C['Số đơn']]), Number(v[C['Tổng chi']]), new Date(v[C['Đơn gần nhất']]));
    var t = careTask(v, today, sm[normPhone(v[0])]); if (!t) return;
    if (v[C['Nhãn']] || v[C['Kết quả CSKH']] === 'Không có nhu cầu') return; // khách lạnh: không đưa vào danh sách gọi
    items.push({ type: t.type, name: v[C['Tên']], phone: normPhone(v[0]), products: String(v[C['Sản phẩm đã mua']] || '').split('; ').slice(-2).join(', '), group: v[C['Nhóm']], ok: v[C['Đồng ý nhận tin']] === 'Có', owner: String(v[C['Phụ trách']] || ''), late: t.late });
  });
  rg.setValues(vals.map(function (v) { if (v[0] !== '') v[0] = "'" + normPhone(v[0]); return v; }));
  var leads = leadsData(ss).filter(function (l) { return leadDueServer(l, today); });
  telegram(groupDigest(items, leads, today));
  crmUsers(ss).forEach(function (x) {
    if (!x.active || !x.tg) return;
    var mine = items.filter(function (i) { return i.owner === x.name; }), ml = leads.filter(function (l) { return l.owner === x.name; });
    if (mine.length || ml.length) telegramTo(x.tg, careMessage(mine, ml, today, false, x.name));
  });
}
function leadDueServer(l, today) {
  if (l.status !== 'Mới hỏi' && l.status !== 'Đang tư vấn') return false;
  if (l.callback) return l.callback <= today.getTime() + 864e5 - 1;
  return !l.lastAt || l.lastAt < today.getTime() - 2 * 864e5;
}
/** Tin nhóm (quản lý): tóm tắt theo loại việc + theo từng sale + vài khách cần chú ý nhất; luôn ngắn. */
function groupDigest(items, leads, today) {
  var T = { callback: '📞 Hẹn gọi lại', d1: '📦 Hỏi nhận hàng', runout: '⏰ Sắp hết hàng', d7: '🤝 Hỏi thăm 1 tuần', d14: '💬 Xin cảm nhận', d30: '🌿 Giới thiệu SP', winback: '💌 Mời quay lại' };
  var byType = Object.keys(T).map(function (k) { var n = items.filter(function (i) { return i.type === k; }).length; return n ? T[k] + ': <b>' + n + '</b>' : ''; }).filter(String);
  var owners = {}; items.forEach(function (i) { var o = i.owner || '⚠️ chưa ai phụ trách'; owners[o] = owners[o] || { c: 0, l: 0, late: 0 }; owners[o].c++; if (i.late && i.type !== 'runout') owners[o].late++; });
  leads.forEach(function (l) { var o = l.owner || '⚠️ chưa ai phụ trách'; owners[o] = owners[o] || { c: 0, l: 0, late: 0 }; owners[o].l++; });
  var per = Object.keys(owners).sort(function (a, b) { return (owners[b].c + owners[b].l) - (owners[a].c + owners[a].l); }).map(function (o) { var x = owners[o]; return '• ' + esc(o) + ': ' + x.c + ' khách chăm sóc' + (x.late ? ' (' + x.late + ' trễ)' : '') + (x.l ? ', ' + x.l + ' khách hỏi' : ''); });
  var hot = items.filter(function (i) { return i.group === 'VIP' && (i.type === 'runout' || i.type === 'callback' || i.late); }).slice(0, 6).map(function (x) { return '• ' + esc(x.name) + ' – ' + x.phone + (x.owner ? ' 👤' + esc(x.owner) : '') + ' · ' + (T[x.type] || '') + (x.late ? (x.type === 'runout' ? ' <b>đã hết ' + x.late + ' ngày</b>' : ' <b>trễ ' + x.late + ' ngày</b>') : ''); });
  return '📋 <b>CSKH hôm nay ' + Utilities.formatDate(today, TZ, 'dd/MM') + '</b> – ' + items.length + ' khách cần chăm sóc' + (leads.length ? ', ' + leads.length + ' khách hỏi cần liên hệ' : '') +
    (byType.length ? '\n' + byType.join(' · ') : '') + (per.length ? '\n\n<b>Theo người phụ trách</b>\n' + per.slice(0, 15).join('\n') : '') +
    (hot.length ? '\n\n<b>⭐ VIP cần chú ý</b>\n' + hot.join('\n') : '') + '\n\n✍️ Chi tiết từng khách: ' + CRM_URL + (items.length + leads.length ? '' : '\n\nHôm nay không có khách đến lịch chăm sóc 🎉');
}
/** Chạy tay trong trình soạn Apps Script để gửi thử tin 8h sáng ngay. */
function thuTinSang() { dailyCare(); Logger.log('Đã gửi. Nếu Telegram không nhận được, xem dòng lỗi "Telegram ..." trong Nhật ký thực thi.'); }
function careMessage(items, leads, today, isGroup, who) {
  function block(title, arr, tip) {
    if (!arr.length) return '';
    return '\n\n<b>' + title + ' (' + arr.length + ')</b> – ' + tip + '\n' + arr.slice(0, 8).map(function (x) {
      return '• ' + esc(x.name) + ' – <a href="https://zalo.me/' + x.phone + '">' + x.phone + '</a>' + (x.group !== 'Mới' ? ' [' + x.group + ']' : '') + (isGroup ? (x.owner ? ' 👤' + esc(x.owner) : ' ⚠️chưa ai phụ trách') : '') +
        '\n   ' + esc(x.products) + (x.late ? ' <b>– đã quá ' + x.late + ' ngày</b>' : '');
    }).join('\n') + (arr.length > 8 ? '\n   … và ' + (arr.length - 8) + ' khách khác (xem CRM)' : '');
  }
  var by = function (k) { return items.filter(function (i) { return i.type === k; }); };
  var lb = leads.length ? '\n\n<b>🙋 Khách hỏi cần liên hệ (' + leads.length + ')</b>\n' + leads.slice(0, 8).map(function (l) {
    return '• ' + esc(l.name) + ' – <a href="https://zalo.me/' + l.phone + '">' + l.phone + '</a>' + (l.interest ? ' · ' + esc(l.interest) : '') + (isGroup ? (l.owner ? ' 👤' + esc(l.owner) : ' ⚠️chưa ai phụ trách') : '');
  }).join('\n') + (leads.length > 8 ? '\n   … và ' + (leads.length - 8) + ' người khác (xem CRM)' : '') : '';
  var total = items.length + leads.length;
  return '📋 <b>' + (who ? 'Việc của ' + esc(who) + ' ' : 'CSKH hôm nay ') + Utilities.formatDate(today, TZ, 'dd/MM') + '</b> – ' + items.length + ' khách cần chăm sóc' + (leads.length ? ', ' + leads.length + ' khách tiềm năng' : '') +
    block('📞 Hẹn gọi lại', by('callback'), 'khách đã hẹn') +
    block('📦 Hỏi nhận hàng, hướng dẫn dùng', by('d1'), 'đơn mới giao') +
    block('⏰ Sắp hết / đã hết sản phẩm', by('runout'), 'nhắc đặt lại, gợi ý đơn từ 300K được freeship') +
    block('🤝 Hỏi thăm sau 1 tuần', by('d7'), 'dùng có khó khăn gì, cần hỗ trợ gì; mời vào nhóm Zalo cộng đồng') +
    block('💬 Xin cảm nhận', by('d14'), '14 ngày sau khi nhận hàng') +
    block('🌿 Giới thiệu sản phẩm phù hợp', by('d30'), '30 ngày sau khi nhận hàng') +
    block('💌 Mời quay lại', by('winback'), rulesCfg().atRisk + ' ngày chưa mua') + lb +
    (total ? '\n\n✍️ Làm trên CRM: ' + CRM_URL : '\n\nHôm nay không có khách đến lịch chăm sóc 🎉');
}

function startOfDay(d) { var t = d instanceof Date ? d.getTime() : new Date(d).getTime(); return new Date(Math.floor((t + 7 * 3600e3) / 864e5) * 864e5 - 7 * 3600e3); } // 0h giờ Việt Nam (UTC+7), không dùng formatDate vì chậm

/* ================================================================ CRM web (crm.thucduonglanh.vn) */
// Đăng nhập bằng mã 6 số gửi về email. Danh sách người dùng + quyền nằm ở trang "Nhân sự CRM" (sửa được trên web, mục Cài đặt).
var SUPER_ADMIN = 'thaisoniph@gmail.com'; // luôn có quyền Quản trị, không bị khoá nhầm
var ROLES = { 'Quản trị': 3, 'Quản lý': 2, 'Nhân viên': 1 };
var USER_TAB = 'Nhân sự CRM', LOG_TAB = 'Nhật ký CSKH';
var USER_HEADERS = ['Email', 'Tên', 'Quyền', 'Đang dùng', 'Nhận khách mới', 'Telegram', 'Tên trong file QC', 'Tiền tố mã đơn'];
var BOT_USERNAME = 'thucduonglanh_donhang_bot';
var ASSIGN_MODES = { auto: 'Tự chia đều', manager: 'Quản lý giao tay', pool: 'Kho chung' };
var LOG_HEADERS = ['Thời gian', 'Người làm', 'Việc', 'SĐT / Mã đơn', 'Khách', 'Kết quả', 'Ghi chú'];
var SESSION_DAYS = 30;
var TASK_LABEL = { callback: 'Gọi lại theo hẹn', d1: 'Hỏi nhận hàng', runout: 'Nhắc đặt lại', d7: 'Hỏi thăm sau 1 tuần', d14: 'Xin cảm nhận', d30: 'Giới thiệu sản phẩm', winback: 'Mời quay lại', old: 'Gọi khách cũ', other: 'Chăm sóc' };

function crmApi(d) {
  try {
    var a = d.action;
    if (a === 'login') return crmLogin(d);
    if (a === 'verify') return crmVerify(d);
    var ss = SpreadsheetApp.getActiveSpreadsheet(), u = crmSession(ss, d.token);
    if (!u) return { ok: false, auth: true, error: 'Phiên đăng nhập đã hết. Vui lòng đăng nhập lại.' };
    if (a === 'logout') { PropertiesService.getScriptProperties().deleteProperty('crm_s_' + d.token); return { ok: true }; }
    if (a === 'load') return crmLoad(ss, u, d);
    if (a === 'order_create') { // saveOrder tự khoá; xong thì sửa bản nhớ tạm (thêm đơn vừa tạo) thay vì bỏ cả bản
      var rc = crmOrderCreate(ss, u, d);
      if (rc && rc.ok) { var lk = LockService.getScriptLock(); lk.waitLock(20000); try { rc._patched = cachePatch(ss, d, a, rc); } finally { lk.releaseLock(); } }
      return rc;
    }
    if (a === 'perf') return crmPerf(ss, u, d);
    if (a === 'check_phone') return crmCheckPhone(ss, u, d);
    if (a === 'cust_orders') return crmCustOrders(ss, u, d);
    var admin = { src_inspect: 1, src_save: 1, src_delete: 1, src_sync: 1, src_finish: 1, ads_inspect: 1, ads_save: 1, ads_sync: 1 };
    if (admin[a]) {
      if (u.level < 3) return { ok: false, error: 'Chỉ Quản trị làm được việc này.' };
      if (a === 'src_inspect') return crmSrcInspect(d);
      if (a === 'ads_inspect') return crmSrcInspect(d, true);
      if (a === 'src_save') return crmSrcSave(ss, u, d);
      if (a === 'src_delete') return crmSrcDelete(ss, u, d);
      if (a === 'src_sync') return crmSrcSync(ss, u, d);
      if (a === 'src_finish') return crmSrcFinish(ss, u, d);
      if (a === 'ads_save') return crmAdsSave(ss, u, d);
      if (a === 'ads_sync') return crmAdsSync(ss, u, !!d.dry);
    }
    if (a === 'feedback') return crmFeedback(ss, u, d);
    if (a === 'fb_list') return crmFbList(ss, u);
    if (a === 'fb_img') return crmFbImg(ss, u, d);
    if (a === 'fb_update') return crmFbUpdate(ss, u, d);
    if (a === 'tg_link') return crmTgLink(u);
    if (a === 'tg_check') return crmTgCheck(ss, u, d);
    if (a === 'prefs') return crmPrefs(ss, u, d);
    if (a === 'tg_off') { userCol(ss, u.email, 6, ''); return { ok: true }; }
    var need = { settings: 2, users: 3, assign: 2, bulk: 2, recv: 2 };
    if (need[a] && u.level < need[a]) return { ok: false, error: 'Bạn không có quyền làm việc này.' };
    var lock = LockService.getScriptLock(); lock.waitLock(20000);
    try {
      if (d.opId) { var oc = CacheService.getScriptCache(), ok0 = oc.get('op_' + d.opId); if (ok0) return JSON.parse(ok0); } // lệnh gửi lại (mạng chập chờn): đã làm rồi thì không làm lần 2
      var res = crmWrite(ss, u, d, a);
      if (res && res.ok) res._patched = cachePatch(ss, d, a, res); // sửa đúng dòng vừa đổi trong bản nhớ tạm, không bắt cả nhóm đọc lại cả Sheet
      if (res && res.ok && d.opId) CacheService.getScriptCache().put('op_' + d.opId, JSON.stringify(res), 21600);
      return res;
    } finally { lock.releaseLock(); }
  } catch (err) {
    console.error('crmApi', err);
    return { ok: false, error: String(err && err.message || err) };
  }
}
function crmWrite(ss, u, d, a) {
    {
      if (a === 'care') return crmCare(ss, u, d);
      if (a === 'customer') return crmCustomer(ss, u, d);
      if (a === 'order_status') return crmOrderStatus(ss, u, d);
      if (a === 'contact') return crmContact(ss, u, d);
      if (a === 'settings') return crmSettings(ss, u, d);
      if (a === 'users') return crmSaveUsers(ss, u, d);
      if (a === 'order_edit') return crmOrderEdit(ss, u, d);
      if (a === 'lead_save') return crmLeadSave(ss, u, d);
      if (a === 'lead_contact') return crmLeadContact(ss, u, d);
      if (a === 'target') return crmTarget(ss, u, d);
      if (a === 'assign') return crmAssign(ss, u, d);
      if (a === 'bulk') return crmBulk(ss, u, d);
      if (a === 'recv') return crmRecv(ss, u, d);
      if (a === 'claim') return crmClaim(ss, u, d);
    }
    return { ok: false, error: 'Không rõ thao tác: ' + a };
}

/* ---------- góp ý ngay trong CRM: ảnh chụp màn hình → thư mục Drive "Góp ý CRM", nội dung → tab "Góp ý", báo Telegram cho quản trị */
var FB_TAB = 'Góp ý', FB_HEADERS = ['Mã', 'Thời gian', 'Người gửi', 'Email', 'Loại', 'Nội dung', 'Màn hình', 'Thiết bị', 'Phiên bản', 'Ảnh', 'Trạng thái', 'Phản hồi', 'Người xử lý', 'Cập nhật'];
var FB_STATUS = ['Mới', 'Đang làm', 'Đã xong', 'Không làm'];
function fbFolder() {
  var pp = PropertiesService.getScriptProperties(), id = pp.getProperty('fb_folder');
  if (id) { try { return DriveApp.getFolderById(id); } catch (e) { } }
  var f = DriveApp.createFolder('Góp ý CRM Thực Dưỡng Lành'); pp.setProperty('fb_folder', f.getId()); return f;
}
/** Chạy 1 lần trong trình soạn Apps Script để cấp quyền lưu ảnh góp ý lên Google Drive. */
function capQuyenGopY() { Logger.log('Thư mục ảnh góp ý: ' + fbFolder().getUrl()); }
function crmFeedback(ss, u, d) {
  var text = String(d.text || '').trim().slice(0, 5000), imgs = (d.images || []).slice(0, 3);
  if (!text && !imgs.length) return { ok: false, error: 'Bạn gõ vài chữ hoặc gửi kèm ảnh giúp nhé.' };
  var id = 'GY' + Utilities.formatDate(new Date(), TZ, 'yyMMddHHmmss'), now = new Date(), files = [], blobs = [], note = '';
  imgs.forEach(function (b64, i) {
    var m = String(b64).match(/^data:(image\/[a-z]+);base64,(.+)$/); if (!m || m[2].length > 4e6) return;
    blobs.push(Utilities.newBlob(Utilities.base64Decode(m[2]), m[1], id + '-' + (i + 1) + '.jpg'));
  });
  try { var fd = blobs.length ? fbFolder() : null; blobs.forEach(function (bl) { files.push(fd.createFile(bl).getId()); }); }
  catch (e) { note = 'Ảnh chưa lưu được lên Drive (quản trị cần chạy hàm capQuyenGopY 1 lần): ' + String(e.message || e).slice(0, 120); console.error('fb drive', e); }
  sheet(ss, FB_TAB, FB_HEADERS).appendRow([id, now, u.name, u.email, String(d.kind || 'Góp ý'), text, String(d.route || ''), String(d.ua || '').slice(0, 300), String(d.ver || ''), files.join('\n') || note, 'Mới', '', '', now]);
  var cap = '💡 <b>GÓP Ý CRM</b> – ' + esc(d.kind || 'Góp ý') + '\n👤 ' + esc(u.name) + ' · ' + esc(d.route || '') + '\n\n' + esc(text.slice(0, 800)) + (imgs.length > 1 ? '\n\n(' + imgs.length + ' ảnh, xem đủ trong CRM → 💡 Góp ý)' : '') + '\n\n👉 ' + CRM_URL;
  try {
    var ad = crmUser(ss, SUPER_ADMIN), chat = ad && ad.tg ? ad.tg : String(TELEGRAM_CHAT_IDS).split(',')[0];
    if (blobs.length) UrlFetchApp.fetch('https://api.telegram.org/bot' + TELEGRAM_TOKEN + '/sendPhoto', { method: 'post', muteHttpExceptions: true, payload: { chat_id: chat, caption: cap.slice(0, 1000), parse_mode: 'HTML', photo: blobs[0] } });
    else telegramTo(chat, cap);
  } catch (e) { console.error('fb tg', e); }
  return { ok: true, id: id, warn: note };
}
function fbRows(ss) {
  var sh = ss.getSheetByName(FB_TAB); if (!sh || sh.getLastRow() < 2) return [];
  return sh.getRange(2, 1, sh.getLastRow() - 1, FB_HEADERS.length).getValues().map(function (r, i) {
    return { row: i + 2, id: String(r[0]), time: ts(r[1]), by: String(r[2]), email: String(r[3]), kind: String(r[4]), text: String(r[5]), route: String(r[6]), ua: String(r[7]), ver: String(r[8]),
      imgs: String(r[9]).split('\n').filter(function (x) { return /^[\w-]{20,}$/.test(x); }), imgNote: /^Ảnh chưa/.test(String(r[9])) ? String(r[9]) : '', status: String(r[10] || 'Mới'), reply: String(r[11]), handler: String(r[12]), updated: ts(r[13]) };
  }).filter(function (x) { return x.id; });
}
function fbNewCount(ss) { try { return fbRows(ss).filter(function (x) { return x.status === 'Mới'; }).length; } catch (e) { return 0; } }
function crmFbList(ss, u) {
  var rows = fbRows(ss); if (u.level < 2) rows = rows.filter(function (x) { return x.email === u.email; });
  return { ok: true, items: rows.reverse(), statuses: FB_STATUS };
}
function crmFbImg(ss, u, d) {
  var it = fbRows(ss).filter(function (x) { return x.id === d.id; })[0]; if (!it) return { ok: false, error: 'Không tìm thấy góp ý.' };
  if (u.level < 2 && it.email !== u.email) return { ok: false, error: 'Bạn không xem được góp ý này.' };
  var f = it.imgs[Number(d.i) || 0]; if (!f) return { ok: false, error: 'Không có ảnh.' };
  var bl = DriveApp.getFileById(f).getBlob(); return { ok: true, src: 'data:' + bl.getContentType() + ';base64,' + Utilities.base64Encode(bl.getBytes()) };
}
function crmFbUpdate(ss, u, d) {
  if (u.level < 2) return { ok: false, error: 'Chỉ quản lý cập nhật được góp ý.' };
  var it = fbRows(ss).filter(function (x) { return x.id === d.id; })[0]; if (!it) return { ok: false, error: 'Không tìm thấy góp ý.' };
  var st = FB_STATUS.indexOf(d.status) >= 0 ? d.status : it.status, reply = String(d.reply == null ? it.reply : d.reply).slice(0, 3000);
  ss.getSheetByName(FB_TAB).getRange(it.row, 11, 1, 4).setValues([[st, reply, u.name, new Date()]]);
  if (st !== it.status || reply !== it.reply) telegramUser(ss, it.by, '💡 Góp ý của bạn (' + esc(it.text.slice(0, 60)) + '…) → <b>' + esc(st) + '</b>' + (reply ? '\n💬 ' + esc(u.name) + ': ' + esc(reply) : '') + '\n\nCảm ơn bạn đã góp ý! 🙏');
  return { ok: true };
}

/* ---------- người dùng & đăng nhập */
function crmUsers(ss) {
  var sh = ss.getSheetByName(USER_TAB);
  if (!sh) {
    sh = ss.insertSheet(USER_TAB);
    sh.getRange(1, 1, 1, USER_HEADERS.length).setValues([USER_HEADERS]);
    sh.getRange(2, 1, 2, USER_HEADERS.length).setValues([[SUPER_ADMIN, 'Thái Sơn', 'Quản trị', 'Có', 'Không', '', '', ''], ['sondmt.bsm@gmail.com', 'Gia Huy', 'Nhân viên', 'Có', 'Có', '', '', '']]);
    styleHeader(sh, 4); sh.setColumnWidth(1, 240); sh.setColumnWidths(2, 3, 130); sh.setTabColor('#9e9e9e');
    sh.getRange(1, 3).setNote('Quản trị: toàn quyền, thêm/bớt nhân sự.\nQuản lý: xem doanh thu, sửa chu kỳ dùng & mẫu tin nhắn.\nNhân viên: chăm sóc khách, xử lý đơn.');
    sh.getRange(1, 4).setNote('Không = khoá tài khoản (nghỉ việc).');
  }
  if (sh.getRange(1, 7).getValue() !== USER_HEADERS[6]) {
    sh.getRange(1, 1, 1, USER_HEADERS.length).setValues([USER_HEADERS]); styleHeader(sh, USER_HEADERS.length);
    sh.getRange(1, 5).setNote('Có = được chia khách mới tự động (chế độ "Tự chia đều"). Để trống: nhân viên = Có, quản lý = Không.');
    sh.getRange(1, 6).setNote('Mã chat Telegram riêng – tự điền khi nhân viên bấm "Kết nối Telegram" trên CRM. Không sửa tay.');
  }
  var no = function (v) { return /^(không|khong|no|0|false)$/i.test(String(v).trim()); };
  var list = sh.getLastRow() < 2 ? [] : sh.getRange(2, 1, sh.getLastRow() - 1, USER_HEADERS.length).getValues().map(function (r) {
    var e = String(r[0] || '').trim().toLowerCase(), role = ROLES[r[2]] ? r[2] : 'Nhân viên';
    return { email: e, name: String(r[1] || e.split('@')[0]).trim(), role: role, active: !no(r[3]), recv: String(r[4]).trim() === '' ? role === 'Nhân viên' : !no(r[4]), tg: String(r[5] || '').trim(), alias: String(r[6] || '').trim(), prefix: String(r[7] || '').trim() };
  }).filter(function (x) { return /@/.test(x.email); });
  var sa = list.filter(function (x) { return x.email === SUPER_ADMIN; })[0];
  if (!sa) list.unshift({ email: SUPER_ADMIN, name: 'Thái Sơn', role: 'Quản trị', active: true, recv: false, tg: '' });
  else { sa.role = 'Quản trị'; sa.active = true; }
  list.forEach(function (x) { x.level = ROLES[x.role]; });
  return list;
}
function crmUser(ss, email) { email = String(email || '').trim().toLowerCase(); return crmUsers(ss).filter(function (x) { return x.email === email && x.active; })[0] || null; }
function publicUser(u) { return { email: u.email, name: u.name, role: u.role, level: u.level, tg: !!u.tg, prefix: u.prefix || slugName(u.name) }; }
function userCol(ss, email, col, value) {
  var sh = ss.getSheetByName(USER_TAB); if (!sh || sh.getLastRow() < 2) return false;
  var e = sh.getRange(2, 1, sh.getLastRow() - 1, 1).getValues();
  for (var i = 0; i < e.length; i++) if (String(e[i][0]).trim().toLowerCase() === email) { sh.getRange(i + 2, col).setValue(value); return true; }
  if (email === SUPER_ADMIN) { sh.appendRow([SUPER_ADMIN, 'Thái Sơn', 'Quản trị', 'Có', 'Không', '', '', '']); return userCol(ss, email, col, value); }
  return false;
}

/* ---------- chia khách & phạm vi dữ liệu */
function assignMode() { return PropertiesService.getScriptProperties().getProperty('assign_mode') || 'pool'; }
/** Người nhận khách mới tiếp theo (chế độ Tự chia đều): lần lượt theo thứ tự trang Nhân sự CRM. '' nếu không phải chế độ tự chia. */
function autoOwner(ss) { return assignMode() === 'auto' ? nextAssignee(ss) : ''; }
function nextAssignee(ss) {
  var names = crmUsers(ss).filter(function (x) { return x.active && x.recv; }).map(function (x) { return x.name; }); if (!names.length) return '';
  var p = PropertiesService.getScriptProperties(), i = names.indexOf(p.getProperty('rr_last') || ''), n = names[(i + 1) % names.length];
  p.setProperty('rr_last', n); return n;
}
/** Nhân viên chỉ được làm việc với khách mình phụ trách. Chế độ Kho chung: khách chưa ai phụ trách → người thao tác nhận luôn. Trả về lời báo lỗi hoặc ''. */
function guardPhone(ss, u, phone) {
  if (u.level >= 2) return '';
  var cs = ss.getSheetByName('Khách hàng'), row = cs ? customerRow(cs, normPhone(phone)) : -1; if (row < 0) return '';
  var owner = String(cs.getRange(row, C['Phụ trách'] + 1).getValue() || '');
  if (owner === u.name) return '';
  if (!owner && assignMode() === 'pool') { cs.getRange(row, C['Phụ trách'] + 1).setValue(u.name); crmLog(ss, u, 'Nhận khách', normPhone(phone), cs.getRange(row, C['Tên'] + 1).getValue(), 'Kho chung', ''); return ''; }
  return owner ? 'Khách này do ' + owner + ' phụ trách. Cần đổi người phụ trách thì nhờ quản lý chuyển.' : 'Khách này chưa được giao cho bạn. Nhờ quản lý giao.';
}
function guardLead(ss, u, ld) {
  if (u.level >= 2) return '';
  var owner = String(ld['Phụ trách'] || '');
  if (owner === u.name) return '';
  if (!owner && assignMode() === 'pool') { leadUpdate(ss, ld['Mã'], { 'Phụ trách': u.name }); crmLog(ss, u, 'Nhận khách', normPhone(ld['Điện thoại']), ld['Tên'], 'Kho chung – tiềm năng', ''); return ''; }
  return owner ? 'Khách này do ' + owner + ' phụ trách. Nhờ quản lý chuyển nếu cần.' : 'Khách này chưa được giao cho bạn. Nhờ quản lý giao.';
}
/** Số điện thoại này của ai? Nhân viên chỉ biết tên người phụ trách, không thấy thông tin khách. */
function crmCheckPhone(ss, u, d) {
  var phone = normPhone(d.phone); if (!/^0\d{9,10}$/.test(phone)) return { ok: true, status: 'none' };
  var owner = ownerOf(ss, phone), isCus = owner !== '' || customerRow(sheet(ss, 'Khách hàng', CUS_HEADERS), phone) > 0;
  if (!isCus) { var ol = leadsData(ss).filter(function (l) { return l.phone === phone && (l.status === 'Mới hỏi' || l.status === 'Đang tư vấn'); })[0]; if (ol) return { ok: true, status: ol.owner === u.name ? 'mine' : ol.owner ? 'other' : 'free', owner: ol.owner, lead: true }; return { ok: true, status: 'none' }; }
  return { ok: true, status: owner === u.name ? 'mine' : owner ? 'other' : 'free', owner: owner };
}
/** Quản lý: giao khách / tiềm năng cho 1 người. */
function crmAssign(ss, u, d) {
  var to = String(d.to || ''), n = 0, ln = 0;
  (d.phones || []).forEach(function (ph) { if (setOwner(ss, ph, to)) n++; });
  (d.leadIds || []).forEach(function (id) { if (leadUpdate(ss, id, { 'Phụ trách': to })) ln++; });
  if (d.withLeads) leadsData(ss).forEach(function (l) { if ((d.phones || []).map(normPhone).indexOf(l.phone) >= 0 && (l.status === 'Mới hỏi' || l.status === 'Đang tư vấn')) { leadUpdate(ss, l.id, { 'Phụ trách': to }); ln++; } });
  crmLog(ss, u, 'Giao khách', '-', to || 'bỏ phụ trách', n + ' khách, ' + ln + ' tiềm năng', '');
  return { ok: true, customers: n, leads: ln };
}
/** Quản lý: chuyển toàn bộ khách của A sang B, hoặc chia đều khách chưa ai phụ trách. */
function crmBulk(ss, u, d) {
  var cs = sheet(ss, 'Khách hàng', CUS_HEADERS), lsh = leadSheet(ss), n = 0, ln = 0;
  var names = crmUsers(ss).filter(function (x) { return x.active && x.recv; }).map(function (x) { return x.name; });
  if (d.spread && !names.length) return { ok: false, error: 'Chưa có ai bật "Nhận khách mới".' };
  if (!d.spread && (!d.from || !d.to || d.from === d.to)) return { ok: false, error: 'Chọn người chuyển đi và người nhận.' };
  var pick = function () { return nextAssignee(ss); };
  if (cs.getLastRow() > 1) {
    var rg = cs.getRange(2, C['Phụ trách'] + 1, cs.getLastRow() - 1, 1), v = rg.getValues();
    v.forEach(function (r) { if (d.spread ? !r[0] : r[0] === d.from) { r[0] = d.spread ? pick() : d.to; n++; } });
    rg.setValues(v);
  }
  if (lsh.getLastRow() > 1) {
    var oc = LEAD_HEADERS.indexOf('Phụ trách') + 1, sc = LEAD_HEADERS.indexOf('Trạng thái') + 1;
    var lr = lsh.getRange(2, oc, lsh.getLastRow() - 1, 1), lv = lr.getValues(), st = lsh.getRange(2, sc, lsh.getLastRow() - 1, 1).getValues();
    lv.forEach(function (r, i) { var open = st[i][0] === 'Mới hỏi' || st[i][0] === 'Đang tư vấn'; if (open && (d.spread ? !r[0] : r[0] === d.from)) { r[0] = d.spread ? pick() : d.to; ln++; } });
    lr.setValues(lv);
  }
  crmLog(ss, u, 'Giao khách', '-', d.spread ? 'Chia đều khách chưa ai phụ trách' : d.from + ' → ' + d.to, n + ' khách, ' + ln + ' tiềm năng', '');
  return { ok: true, customers: n, leads: ln };
}
/** Quản lý: bật / tắt "Nhận khách mới" của 1 người. */
function crmRecv(ss, u, d) {
  var x = crmUsers(ss).filter(function (y) { return y.name === d.name; })[0]; if (!x) return { ok: false, error: 'Không tìm thấy ' + d.name };
  userCol(ss, x.email, 5, d.on ? 'Có' : 'Không'); crmLog(ss, u, 'Nhân sự', '-', x.name, 'Nhận khách mới: ' + (d.on ? 'Có' : 'Không'), '');
  return { ok: true };
}

/* ---------- màu phân loại khách: mỗi người tự chọn màu + tự tạo nhãn */
function prefsOf(email) { try { return JSON.parse(PropertiesService.getScriptProperties().getProperty('prefs_' + email) || '{}'); } catch (e) { return {}; } }
function crmPrefs(ss, u, d) {
  var clean = function (c) { return /^#[0-9a-fA-F]{6}$/.test(String(c)) ? c : ''; }, colors = {};
  Object.keys(d.colors || {}).forEach(function (k) { if (/^(new|old|void|off|vip)$/.test(k) && clean(d.colors[k])) colors[k] = d.colors[k]; });
  var seen = {}, tags = (d.tags || []).map(function (t) { return { name: String(t.name || '').trim().slice(0, 30), color: clean(t.color) || '#dbeafe' }; }).filter(function (t) { if (!t.name || seen[t.name]) return false; seen[t.name] = 1; return true; }).slice(0, 20);
  PropertiesService.getScriptProperties().setProperty('prefs_' + u.email, JSON.stringify({ colors: colors, tags: tags }));
  return { ok: true, prefs: { colors: colors, tags: tags } };
}
/** Màu của mọi nhãn (để quản lý thấy màu nhãn do sale tạo). */
function allTagColors() {
  var all = PropertiesService.getScriptProperties().getProperties(), m = {};
  Object.keys(all).forEach(function (k) { if (k.indexOf('prefs_') !== 0) return; try { (JSON.parse(all[k]).tags || []).forEach(function (t) { if (!m[t.name]) m[t.name] = t.color; }); } catch (e) { } });
  return m;
}

/* ---------- Telegram riêng cho từng người */
function telegramTo(chatId, text) {
  if (!TELEGRAM_TOKEN || !chatId) return;
  tgChunks(text).forEach(function (part) {
    try {
      var r = UrlFetchApp.fetch('https://api.telegram.org/bot' + TELEGRAM_TOKEN + '/sendMessage', { method: 'post', muteHttpExceptions: true, payload: { chat_id: String(chatId), text: part, parse_mode: 'HTML', disable_web_page_preview: 'true' } });
      if (r.getResponseCode() !== 200) console.error('Telegram ' + chatId + ' lỗi ' + r.getResponseCode() + ': ' + r.getContentText().slice(0, 300));
    } catch (e) { console.error('Telegram ' + chatId + ': ' + e); }
  });
}
function telegramUser(ss, name, text) { var x = crmUsers(ss).filter(function (y) { return y.name === name && y.active; })[0]; if (x && x.tg) telegramTo(x.tg, text); }
/** Bước 1: tạo link mở bot kèm mã. Bước 2 (tg_check): đọc tin /start <mã> từ bot để lấy mã chat. */
function crmTgLink(u) {
  var code = Utilities.getUuid().replace(/-/g, '').slice(0, 10);
  CacheService.getScriptCache().put('tg_' + code, u.email, 3600);
  return { ok: true, code: code, url: 'https://t.me/' + BOT_USERNAME + '?start=' + code };
}
function crmTgCheck(ss, u, d) {
  var code = String(d.code || '').replace(/[^a-f0-9]/g, ''); if (CacheService.getScriptCache().get('tg_' + code) !== u.email) return { ok: false, error: 'Mã kết nối đã hết hạn, bấm "Kết nối Telegram" lại nhé.' };
  var res = UrlFetchApp.fetch('https://api.telegram.org/bot' + TELEGRAM_TOKEN + '/getUpdates?allowed_updates=' + encodeURIComponent('["message"]'), { muteHttpExceptions: true });
  var j = JSON.parse(res.getContentText() || '{}'), chat = null;
  (j.result || []).forEach(function (up) { var m = up.message; if (m && m.chat && m.chat.type === 'private' && String(m.text || '').trim() === '/start ' + code) chat = m.chat.id; });
  if (!chat) return { ok: false, error: j.ok === false ? 'Telegram báo lỗi: ' + (j.description || '') : 'Chưa thấy bạn bấm "Start" trong Telegram. Mở lại link, bấm Start (Bắt đầu) rồi thử lại.' };
  userCol(ss, u.email, 6, "'" + chat);
  telegramTo(chat, '✅ Đã kết nối CRM Thực Dưỡng Lành cho <b>' + esc(u.name) + '</b>.\nTừ giờ bạn nhận riêng: đơn mới của khách mình phụ trách, khách tiềm năng mới được giao, và danh sách việc lúc 8h sáng.');
  CacheService.getScriptCache().remove('tg_' + code);
  crmLog(ss, u, 'Nhân sự', '-', u.name, 'Kết nối Telegram', '');
  return { ok: true };
}

function crmLogin(d) {
  var email = String(d.email || '').trim().toLowerCase(), ss = SpreadsheetApp.getActiveSpreadsheet();
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) return { ok: false, error: 'Email chưa đúng.' };
  if (!crmUser(ss, email)) return { ok: false, error: 'Email này chưa được cấp quyền vào CRM. Nhờ anh Sơn hoặc quản lý thêm email của bạn.' };
  var cache = CacheService.getScriptCache(), rk = 'crm_rl_' + email, n = Number(cache.get(rk) || 0);
  if (n >= 5) return { ok: false, error: 'Bạn đã xin mã quá nhiều lần. Vui lòng đợi 15 phút rồi thử lại.' };
  cache.put(rk, String(n + 1), 900);
  var b = Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, Utilities.getUuid() + Date.now());
  var code = String(((b[0] & 255) * 65536 + (b[1] & 255) * 256 + (b[2] & 255)) % 900000 + 100000);
  cache.put('crm_otp_' + email, JSON.stringify({ c: code, t: 0 }), 600);
  MailApp.sendEmail({
    to: email, name: 'CRM Thực Dưỡng Lành', subject: code + ' là mã đăng nhập CRM Thực Dưỡng Lành',
    body: 'Mã đăng nhập của bạn: ' + code + '\n\nMã dùng được trong 10 phút. Không đưa mã này cho người khác.\nNếu bạn không yêu cầu đăng nhập, hãy bỏ qua email này.\n\n' + CRM_URL
  });
  return { ok: true };
}

function crmVerify(d) {
  var email = String(d.email || '').trim().toLowerCase(), code = String(d.code || '').replace(/\D/g, '');
  var cache = CacheService.getScriptCache(), key = 'crm_otp_' + email, raw = cache.get(key);
  if (!raw) return { ok: false, error: 'Mã đã hết hạn. Bấm "Gửi lại mã".' };
  var o = JSON.parse(raw);
  if (o.c !== code) {
    o.t++;
    if (o.t >= 5) { cache.remove(key); return { ok: false, error: 'Nhập sai quá 5 lần. Bấm "Gửi lại mã" để lấy mã mới.' }; }
    cache.put(key, JSON.stringify(o), 600);
    return { ok: false, error: 'Mã chưa đúng, bạn kiểm tra lại email nhé.' };
  }
  cache.remove(key);
  var ss = SpreadsheetApp.getActiveSpreadsheet(), u = crmUser(ss, email); if (!u) return { ok: false, error: 'Tài khoản đã bị khoá.' };
  var props = PropertiesService.getScriptProperties(), now = Date.now();
  var all = props.getProperties(); // dọn phiên hết hạn
  Object.keys(all).forEach(function (k) { if (k.indexOf('crm_s_') === 0) { try { if (JSON.parse(all[k]).x < now) props.deleteProperty(k); } catch (e) { props.deleteProperty(k); } } });
  var token = (Utilities.getUuid() + Utilities.getUuid()).replace(/-/g, '');
  props.setProperty('crm_s_' + token, JSON.stringify({ e: email, x: now + SESSION_DAYS * 864e5 }));
  return { ok: true, token: token, user: publicUser(u) };
}

function crmSession(ss, token) {
  if (!/^[a-f0-9]{64}$/.test(String(token || ''))) return null;
  var props = PropertiesService.getScriptProperties(), raw = props.getProperty('crm_s_' + token); if (!raw) return null;
  var s = JSON.parse(raw); if (s.x < Date.now()) { props.deleteProperty('crm_s_' + token); return null; }
  var u = crmUser(ss, s.e); if (!u) { props.deleteProperty('crm_s_' + token); return null; }
  return u;
}

/* ---------- đọc dữ liệu */
function ts(v) { if (v instanceof Date) return isNaN(v) ? null : v.getTime(); if (!v) return null; var d = new Date(v); return isNaN(d) ? null : d.getTime(); }
function tableOf(sh) {
  if (!sh || sh.getLastRow() < 2) return { H: sh ? sh.getRange(1, 1, 1, Math.max(sh.getLastColumn(), 1)).getValues()[0] : [], rows: [] };
  var all = sh.getRange(1, 1, sh.getLastRow(), sh.getLastColumn()).getValues();
  return { H: all[0], rows: all.slice(1) };
}

/* ---------- nhớ tạm dữ liệu đã đọc từ Sheet (CacheService, 10 phút): mở CRM không phải đọc lại cả Sheet mỗi lần.
 * Lưu chăm sóc / sửa khách / tư vấn → cachePatch() sửa đúng dòng đó; việc khác (đơn web, tạo đơn, nhập file…) → dataChanged() bỏ bản nhớ.
 * docSanCRM() (5 phút/lần) đọc sẵn khi bản nhớ hết hạn. Sửa tay trên Sheet: tối đa 10 phút sau mới thấy (hoặc bấm ↻). */
var LOAD_TTL = 600, CHUNK = 30000, CACHE_MAX = 3000000;
function dataChanged() { try { PropertiesService.getScriptProperties().setProperty('data_ver', Date.now().toString(36) + Math.random().toString(36).slice(2, 6)); } catch (e) { } }
function cacheKey() { return 'ld_' + (PropertiesService.getScriptProperties().getProperty('data_ver') || '0') + '_' + Utilities.formatDate(new Date(), TZ, 'yyMMdd'); }
function cacheGet(key) {
  try {
    var c = CacheService.getScriptCache(), n = Number(c.get(key + '_n')); if (!n) return null;
    var ks = []; for (var i = 0; i < n; i++) ks.push(key + '_' + i);
    var got = c.getAll(ks), parts = []; for (var j = 0; j < n; j++) { if (got[ks[j]] == null) return null; parts.push(got[ks[j]]); }
    return JSON.parse(parts.join(''));
  } catch (e) { return null; }
}
function cachePut(key, obj) {
  try {
    var str = JSON.stringify(obj), o = {}, n = Math.ceil(str.length / CHUNK); if (str.length > CACHE_MAX) return; // dữ liệu lớn: nhớ tạm tốn bộ nhớ hơn là đọc lại → bỏ
    for (var i = 0; i < n; i++) o[key + '_' + i] = str.substr(i * CHUNK, CHUNK);
    var c = CacheService.getScriptCache(); c.putAll(o, LOAD_TTL); c.put(key + '_n', String(n), LOAD_TTL); // số phần ghi sau cùng: có đủ phần mới dùng
  } catch (e) { console.error('cachePut', e); }
}
/** Chạy tay trong trình soạn Apps Script (chọn hàm này → ▶ Chạy) để xem tải CRM mất bao lâu / lỗi gì. Kết quả ở "Nhật ký thực thi". */
function thuTaiCRM() {
  var ss = SpreadsheetApp.getActiveSpreadsheet(), t0 = Date.now(), u = crmUser(ss, SUPER_ADMIN) || { name: 'Thái Sơn', level: 3, email: SUPER_ADMIN };
  try {
    var b = readBase(ss), t1 = Date.now();
    Logger.log('Đọc Sheet: ' + (t1 - t0) + ' ms · ' + b.customers.length + ' khách, ' + b.orders.length + ' đơn, ' + b.leads.length + ' tiềm năng, ' + b.log.length + ' nhật ký');
    var out = crmLoad(ss, u, { fresh: 1 }), t2 = Date.now(), str = JSON.stringify(out);
    Logger.log('Tải CRM (quản trị): ' + (t2 - t1) + ' ms · gửi về ' + Math.round(str.length / 1024) + ' KB · ' + out.orders.length + ' đơn gửi về');
  } catch (e) { Logger.log('LỖI: ' + (e && e.stack || e)); }
}
function loadBase(ss, fresh) {
  var key = cacheKey(), b = fresh ? null : cacheGet(key); if (b) { b.cached = true; return b; }
  b = readBase(ss); cachePut(key, b); return b;
}
/** 1 dòng tab Khách hàng → đối tượng gửi cho CRM. */
function custObj(v, today, sm) {
  var phone = normPhone(v[0]); if (!phone) return null;
  var t = careTask(v, today, sm && sm[phone]);
  return {
      phone: phone, name: String(v[C['Tên']] || ''), address: String(v[C['Địa chỉ']] || ''), province: String(v[C['Tỉnh/TP']] || ''), ward: String(v[C['Phường/Xã']] || ''),
      orders: Number(v[C['Số đơn']]) || 0, spent: Number(v[C['Tổng chi']]) || 0, first: ts(v[C['Đơn đầu']]), last: ts(v[C['Đơn gần nhất']]),
      products: String(v[C['Sản phẩm đã mua']] || '').split('; ').filter(String), runout: ts(v[C['Dự kiến hết hàng']]),
      group: groupOf(Number(v[C['Số đơn']]), Number(v[C['Tổng chi']]), new Date(v[C['Đơn gần nhất']])),
      consent: v[C['Đồng ý nhận tin']] === 'Có', source: String(v[C['Nguồn đầu tiên']] || ''), owner: String(v[C['Phụ trách']] || ''),
      careAt: ts(v[C['Lần CSKH gần nhất']]), careResult: String(v[C['Kết quả CSKH']] || ''), note: String(v[C['Ghi chú CSKH']] || '').slice(0, NOTE_MAX), noteCut: String(v[C['Ghi chú CSKH']] || '').length > NOTE_MAX, callback: ts(v[C['Hẹn gọi lại']]), flag: String(v[C['Nhãn']] || ''), tag: String(v[C['Nhãn màu']] || ''), zalo: v[C['Zalo']] === 'Có', community: String(v[C['Cộng đồng']] || ''), recv: ts(v[C['Nhận hàng']]),
      fam: !!(sm && sm[phone] && sm[phone].fam), task: t
  };
}
/** Đọc toàn bộ dữ liệu từ Sheet (chậm, vài giây): chưa lọc theo người xem. */
function readBase(ss) {
  var today = startOfDay(new Date());
  var cs = sheet(ss, 'Khách hàng', CUS_HEADERS), customers = [], cvals = cs.getLastRow() > 1 ? cs.getRange(2, 1, cs.getLastRow() - 1, CUS_HEADERS.length).getValues() : [];
  backfillSellers(ss);
  var ot = tableOf(ss.getSheetByName('Đơn hàng')), orders = [];
  ot.rows.forEach(function (r, i) { var o = orderObj(r, ot.H, i + 2); if (o) orders.push(o); });
  var sm = shipMap(orders); cvals.forEach(function (v) { var c = custObj(v, today, sm); if (c) customers.push(c); }); // việc chăm sóc cần ngày gửi của đơn gần nhất
  custStats(customers, orders);
  var lt = tableOf(ss.getSheetByName('Liên hệ')), contacts = [];
  lt.rows.forEach(function (r, i) { if (!r[0] && !r[1]) return; contacts.push({ row: i + 2, time: ts(r[0]), name: String(r[1] || ''), phone: normPhone(r[2]), email: String(r[3] || ''), message: String(r[4] || ''), page: String(r[5] || ''), done: r[6] === true, note: String(r[7] || '') }); });
  cycleSheet(ss); templateSheet(ss); ensureLeadTemplate(ss);
  var leads = leadsData(ss);
  var tp = tableOf(ss.getSheetByName('Mẫu tin nhắn CSKH')).rows.filter(function (r) { return r[2]; }).map(function (r) { return [String(r[0] || ''), String(r[1] || ''), String(r[2])]; });
  var ls = ss.getSheetByName(LOG_TAB), logN = ls ? Math.max(0, ls.getLastRow() - 1) : 0, nl = Math.min(logN, 6000); // chỉ đọc 6000 dòng nhật ký cuối (tab này dài ra mỗi ngày)
  var lg = nl ? ls.getRange(logN - nl + 2, 1, nl, 7).getValues().map(logObj) : [];
  return { today: today.getTime(), at: Date.now(), logN: logN, customers: customers, orders: orders, contacts: contacts, leads: leads, cycles: cyclesData(ss), templates: tp, log: lg, targets: targetsData(ss) };
}
/** 1 dòng tab Đơn hàng → đối tượng gửi cho CRM (null nếu dòng trống). */
function orderObj(r, H, row) {
  var g = function (n) { var k = H.indexOf(n); return k < 0 ? '' : r[k]; };
  if (!g('Mã đơn') && !g('Khách hàng')) return null;
  return { row: row, time: ts(g('Thời gian')), id: String(g('Mã đơn')), name: String(g('Khách hàng')), phone: normPhone(g('Điện thoại')), email: String(g('Email')),
    province: String(g('Tỉnh/TP')), ward: String(g('Phường/Xã')), address: String(g('Địa chỉ')), items: String(g('Sản phẩm')), subtotal: Number(g('Tạm tính')) || 0,
    shipping: Number(g('Phí ship')) || 0, total: Number(g('Tổng')) || 0, payment: String(g('Thanh toán')), note: String(g('Ghi chú')), status: String(g('Trạng thái') || 'Mới'),
    source: String(g('Nguồn')), consent: g('Đồng ý nhận tin') === 'Có', paid: String(g('Đã nhận tiền') || ''), carrier: String(g('Đơn vị vận chuyển') || ''), tracking: String(g('Mã vận đơn') || ''), seller: String(g('NV bán') || ''), ca: String(g('Ca') || ''), line: String(g('Dòng SP') || ''), ship: String(g('Lên đơn') || ''), shipAt: ts(g('Ngày gửi')), otype: String(g('Loại đơn') || ''), oflag: String(g('Kiểm tra loại đơn') || ''), trk: String(g('Hành trình VC') || ''), trkAt: ts(g('Cập nhật VC')), trkCode: Number(g('Mã TT VC')) || 0 };
}
/** Số đơn nhận / hoàn, đơn gần nhất của từng khách (từ tab Đơn hàng) → tô màu khách hoàn / ngoài giờ; khách thân thiết hoàn 1 lần không bị coi là bom. */
function custStats(customers, orders) {
  var lastOf = {}; // đơn gần nhất của từng khách (kể cả đơn hoàn)
  orders.forEach(function (o) { var x = lastOf[o.phone]; if (!x || (o.time || 0) >= x.time) lastOf[o.phone] = { time: o.time || 0, status: o.status, ca: isVoid(o.status) ? (x ? x.ca : '') : o.ca }; });
  var cnt = {}; orders.forEach(function (o) { var x = cnt[o.phone] || (cnt[o.phone] = { ok: 0, back: 0, lastBack: 0 }); if (/hoàn/i.test(o.status)) { x.back++; if ((o.time || 0) > x.lastBack) x.lastBack = o.time || 0; } else if (!isVoid(o.status)) x.ok++; });
  customers.forEach(function (c) { var x = lastOf[c.phone]; if (x) { c.lastStatus = x.status; c.lastCa = x.ca; } var y = cnt[c.phone]; if (y) { c.okN = y.ok; c.backN = y.back; c.lastBack = y.lastBack; } });
}
function cyclesData(ss) { return tableOf(ss.getSheetByName('Chu kỳ dùng')).rows.filter(function (r) { return r[0]; }).map(function (r) { return [String(r[0]), String(r[1] || ''), Number(r[2]) || 0, String(r[3] || '')]; }); }
function crmLoad(ss, u, d) {
  var t0 = Date.now();
  if (u.level >= 3 && !PropertiesService.getScriptProperties().getProperty('warm_on')) { try { caiDocSan(); } catch (e) { console.error('caiDocSan', e); } }
  var b = loadBase(ss, d && d.fresh), customers = b.customers, orders = b.orders, contacts = b.contacts, leads = b.leads, lg = b.log, cy = b.cycles, tp = b.templates;
  var users = crmUsers(ss).filter(function (x) { return x.active || u.level >= 3; }).map(function (x) {
    return u.level >= 3 ? { email: x.email, name: x.name, role: x.role, active: x.active, recv: x.recv, tg: !!x.tg, alias: x.alias, prefix: x.prefix || slugName(x.name) } : u.level >= 2 ? { name: x.name, role: x.role, recv: x.recv, tg: !!x.tg } : { name: x.name, role: x.role };
  });
  // Nhân viên chỉ nhận dữ liệu của khách mình phụ trách (Kho chung: thêm khách chưa ai phụ trách)
  var mode = assignMode(), targets = b.targets;
  if (u.level < 2) {
    var see = function (owner) { return owner === u.name || (mode === 'pool' && !owner); }, phones = {}, ids = {};
    customers = customers.filter(function (c) { if (see(c.owner)) { phones[c.phone] = 1; return true; } return false; });
    orders = orders.filter(function (o) { if (phones[o.phone] || o.seller === u.name) { ids[o.id] = 1; return true; } return false; });
    leads = leads.filter(function (l) { if (see(l.owner)) { phones[l.phone] = 1; return true; } return false; });
    lg = lg.filter(function (l) { var r = String(l.ref).replace(/^'/, ''); return l.by === u.name || phones[r] || ids[r]; });
    contacts = []; targets = targets.filter(function (t) { return t.name === u.name; });
  }
  orders = recentOrders(orders);
  // Tải 2 đợt: đợt 1 (part=core) đủ để làm việc ngay – đơn 100 ngày + đơn đang xử lý, nhật ký 60 ngày; đợt 2 (part=rest) phần cũ hơn, CRM tải ngầm.
  var OPEN = { 'Mới': 1, 'Đã xác nhận': 1, 'Đang giao': 1 }, cutO = Number(d && d.o) || Date.now() - 100 * 864e5, cutL = Number(d && d.l) || Date.now() - 60 * 864e5;
  var isNew = function (o) { return (o.time || 0) >= cutO || OPEN[o.status]; };
  if (d && d.part === 'rest') return { ok: true, rest: true, orders: orders.filter(function (o) { return !isNew(o); }), log: lg.filter(function (l) { return (l.time || 0) < cutL; }), t: { ms: Date.now() - t0, cached: !!b.cached } };
  var part = null;
  if (d && d.part === 'core') { orders = orders.filter(isNew); lg = lg.filter(function (l) { return (l.time || 0) >= cutL; }); part = { o: cutO, l: cutL }; }
  return { ok: true, part: part, t: { ms: Date.now() - t0, cached: !!b.cached, age: b.at ? Math.round((Date.now() - b.at) / 1000) : null }, fbNew: u.level >= 2 ? fbNewCount(ss) : 0, cached: !!b.cached, user: publicUser(u), now: Date.now(), today: b.today, areas: areaStats(b.customers), customers: customers, orders: orders, contacts: contacts.slice(-1000), leads: leads, targets: targets, cycles: cy, templates: tp, log: lg, users: users,
    prefs: prefsOf(u.email), tagColors: allTagColors(),
    rules: { vipOrders: rulesCfg().vipOrders, vipSpent: rulesCfg().vipSpent, atRisk: rulesCfg().atRisk, shipDays: rulesCfg().shipDays, famMin: rulesCfg().famMin, commission: commissionCfg(), otypes: OTYPES, statuses: ORDER_STATUS, results: CARE_RESULTS, leadStatus: LEAD_STATUS, assignMode: mode, bot: BOT_USERNAME, ca: caCfg(), lines: LINES.map(function (l) { return l[0]; }).concat(['Khác']) },
    sources: u.level >= 3 ? srcList(ss) : [], ads: u.level >= 3 ? adsCfg() : null };
}

/* Số liệu gộp của CẢ công ty theo tỉnh và theo sản phẩm (chỉ là con số, không có tên / số điện thoại):
   sale tìm "Nghệ An" hay "DILVANG" là biết bên mình đã có bao nhiêu khách ở đó để nói chuyện với khách mới. */
var PROV_MERGE = { 'Tuyên Quang': ['Hà Giang', 'Tuyên Quang'], 'Lào Cai': ['Yên Bái', 'Lào Cai'], 'Thái Nguyên': ['Bắc Kạn', 'Bắc Cạn', 'Thái Nguyên'], 'Phú Thọ': ['Vĩnh Phúc', 'Hòa Bình', 'Phú Thọ'],
  'Bắc Ninh': ['Bắc Giang', 'Bắc Ninh'], 'Hưng Yên': ['Thái Bình', 'Hưng Yên'], 'Hải Phòng': ['Hải Dương', 'Hải Phòng', 'HP'], 'Ninh Bình': ['Hà Nam', 'Nam Định', 'Ninh Bình'], 'Quảng Trị': ['Quảng Bình', 'Quảng Trị'],
  'Đà Nẵng': ['Quảng Nam', 'Đà Nẵng'], 'Quảng Ngãi': ['Kon Tum', 'Kontum', 'Quảng Ngãi'], 'Gia Lai': ['Bình Định', 'Gia Lai', 'Quy Nhơn', 'Pleiku'], 'Khánh Hòa': ['Ninh Thuận', 'Khánh Hòa', 'Nha Trang', 'Phan Rang'],
  'Lâm Đồng': ['Đắk Nông', 'Đăk Nông', 'Dak Nong', 'Bình Thuận', 'Lâm Đồng', 'Đà Lạt', 'Phan Thiết'], 'Đắk Lắk': ['Phú Yên', 'Đắk Lắk', 'Đăk Lăk', 'Dak Lak', 'Daklak', 'Đaklak', 'Buôn Ma Thuột', 'Buôn Mê Thuột', 'Tuy Hòa'],
  'Hồ Chí Minh': ['Bà Rịa', 'Vũng Tàu', 'Bình Dương', 'Hồ Chí Minh', 'HCM', 'TPHCM', 'TP HCM', 'Sài Gòn', 'Thủ Đức', 'Thủ Dầu Một'], 'Đồng Nai': ['Bình Phước', 'Đồng Nai', 'Biên Hòa'],
  'Tây Ninh': ['Long An', 'Tây Ninh'], 'Cần Thơ': ['Sóc Trăng', 'Hậu Giang', 'Cần Thơ'], 'Vĩnh Long': ['Bến Tre', 'Trà Vinh', 'Vĩnh Long'], 'Đồng Tháp': ['Tiền Giang', 'Đồng Tháp', 'Mỹ Tho'],
  'Cà Mau': ['Bạc Liêu', 'Cà Mau'], 'An Giang': ['Kiên Giang', 'An Giang', 'Rạch Giá', 'Phú Quốc', 'Long Xuyên'],
  'Hà Nội': ['Hà Nội', 'HN'], 'Huế': ['Thừa Thiên Huế', 'Huế'], 'Lai Châu': ['Lai Châu'], 'Điện Biên': ['Điện Biên'], 'Sơn La': ['Sơn La'], 'Lạng Sơn': ['Lạng Sơn'], 'Quảng Ninh': ['Quảng Ninh', 'Hạ Long'],
  'Thanh Hóa': ['Thanh Hóa'], 'Nghệ An': ['Nghệ An'], 'Hà Tĩnh': ['Hà Tĩnh'], 'Cao Bằng': ['Cao Bằng'] }; // giữ giống PROV_MERGE trong crm/app.js
var PROV_KEYS_ = null;
function provOfAddr(text) {
  if (!PROV_KEYS_) { PROV_KEYS_ = []; Object.keys(PROV_MERGE).forEach(function (nw) { PROV_MERGE[nw].forEach(function (old) { PROV_KEYS_.push({ k: ' ' + nrm(old) + ' ', old: old, nw: nw }); }); }); PROV_KEYS_.sort(function (a, b) { return b.k.length - a.k.length; }); }
  var t = ' ' + nrm(text).replace(/[.,;:\-–()/]/g, ' ').replace(/\s+/g, ' ') + ' ', best = null, at = -1;
  PROV_KEYS_.forEach(function (x) { var i = t.lastIndexOf(x.k); if (i > at) { at = i; best = x; } });
  return best ? { old: /^(HCM|TPHCM|TP HCM|HN|HP|Kontum|Daklak|Đaklak)$/.test(best.old) ? best.nw : best.old, nw: best.nw } : null;
}
/** { p: { 'Nam Định': [tỉnh mới, số khách, số khách mua ≥2 lần, mua trong 30 ngày, { sản phẩm: số khách }] }, s: { sản phẩm: [số khách, mua ≥2 lần] } } */
function areaStats(customers) {
  var p = {}, s = {}, d30 = Date.now() - 30 * 864e5;
  customers.forEach(function (c) {
    if (!c.orders) return;
    var rep = c.orders >= 2 ? 1 : 0, seen = {};
    c.products.forEach(function (x) { var n = x.replace(/\s*\(.*\)\s*$/, '').trim(); if (n) seen[n] = 1; });
    Object.keys(seen).forEach(function (n) { var r = s[n] || (s[n] = [0, 0]); r[0]++; r[1] += rep; });
    var pv = provOfAddr([c.address, c.ward, c.province].join(' ')); if (!pv) return;
    var a = p[pv.old] || (p[pv.old] = [pv.nw, 0, 0, 0, {}]);
    a[1]++; a[2] += rep; if (c.last && c.last >= d30) a[3]++;
    Object.keys(seen).forEach(function (n) { a[4][n] = (a[4][n] || 0) + 1; });
  });
  Object.keys(p).forEach(function (k) { var t = p[k][4], top = {}; Object.keys(t).sort(function (x, y) { return t[y] - t[x]; }).slice(0, 4).forEach(function (n) { top[n] = t[n]; }); p[k][4] = top; });
  return { p: p, s: s };
}

function logObj(r) { return { time: ts(r[0]), by: String(r[1] || ''), what: String(r[2] || ''), ref: String(r[3] || ''), name: String(r[4] || ''), result: String(r[5] || ''), note: String(r[6] || '') }; }
/** Lưu chăm sóc / sửa khách / tư vấn khách hỏi / tạo đơn / đổi trạng thái, ghi chú đơn / nhận khách: sửa đúng các dòng đó trong bản nhớ tạm
 *  (đọc lại vài dòng thay vì cả Sheet) → người vừa lưu và cả nhóm mở CRM vẫn nhanh. Trả true = bản nhớ vẫn đúng, không cần bỏ.
 *  Việc làm thay đổi nhiều khách (huỷ/hoàn đơn → tính lại khách, sửa đơn, chia khách, nhập file…) gọi dataChanged() → bản nhớ đổi khoá → ở đây không tìm thấy → bỏ như cũ. */
var PATCHABLE = { care: 1, customer: 1, lead_contact: 1, lead_save: 1, order_status: 1, order_create: 1, claim: 1 };
function cachePatch(ss, d, a, res) {
  try {
    if (!PATCHABLE[a] || (a === 'customer' && d.owner !== undefined)) return false;
    var key = cacheKey(), b = cacheGet(key); if (!b) return false;
    if (!b.at || Date.now() - b.at > LOAD_TTL * 1000) return false; // bản đọc đã quá 10 phút → đọc lại cả Sheet, để chỗ sửa tay trên Sheet lên CRM (không “vá” mãi bản cũ)
    var phones = {}, ordersOf = {}, leadsToo = false, o = null;
    if (a === 'care' || a === 'customer') { phones[normPhone(d.phone)] = 1; if (a === 'care' && d.received) ordersOf[normPhone(d.phone)] = 1; } // đã nhận hàng → đơn gần nhất đổi Đã giao / ngày nhận
    if (a === 'lead_contact' || a === 'lead_save') { leadsToo = true; if (a === 'lead_save' && !d.id) phones[normPhone(d.phone)] = 1; } // số đã là khách → ghi nối vào khách cũ
    if (a === 'claim') { if (d.phone) phones[normPhone(d.phone)] = 1; if (d.leadId) leadsToo = true; }
    if (a === 'order_status') {
      o = orderSheet(ss); var row = Number(res && res.row) || 0; if (row < 2) return false;
      var no = orderObj(o.sh.getRange(row, 1, 1, o.H.length).getValues()[0], o.H, row); if (!no || no.id !== String(d.id)) return false;
      phones[no.phone] = 1; ordersOf[no.phone] = 1;
    }
    if (a === 'order_create') {
      o = orderSheet(ss); var maxRow = 1; b.orders.forEach(function (x) { if (x.row > maxRow) maxRow = x.row; });
      var lr = o.sh.getLastRow(); if (lr - maxRow > 20) return false; // nhiều dòng mới lạ (vừa nhập file…) → đọc lại cả Sheet
      if (lr > maxRow) o.sh.getRange(maxRow + 1, 1, lr - maxRow, o.H.length).getValues().forEach(function (r, i) { var x = orderObj(r, o.H, maxRow + 1 + i); if (x) { b.orders.push(x); phones[x.phone] = 1; } });
      phones[normPhone((d.customer || {}).phone)] = 1; if (d.leadId) leadsToo = true;
      b.cycles = cyclesData(ss); // gói combo mới → tự thêm chu kỳ dùng
    }
    if (Object.keys(ordersOf).length) {
      if (!o) o = orderSheet(ss);
      for (var i = 0; i < b.orders.length; i++) {
        var x = b.orders[i]; if (!ordersOf[x.phone]) continue;
        var nx = orderObj(o.sh.getRange(x.row, 1, 1, o.H.length).getValues()[0], o.H, x.row);
        if (!nx || nx.id !== x.id) return false; // dòng đã xê dịch (xoá tay trên Sheet…) → đọc lại cả Sheet
        b.orders[i] = nx;
      }
    }
    var cs = ss.getSheetByName('Khách hàng');
    for (var ph in phones) {
      if (!ph) continue;
      var k = -1; for (var j = 0; j < b.customers.length; j++) if (b.customers[j].phone === ph) { k = j; break; }
      var crow = customerRow(cs, ph); if (crow < 0) { if (k >= 0) return false; continue; } // chưa là khách (vd mới là khách hỏi) → không có gì để sửa
      var po = b.orders.filter(function (y) { return y.phone === ph; });
      var c = custObj(cs.getRange(crow, 1, 1, CUS_HEADERS.length).getValues()[0], new Date(b.today), shipMap(po)); if (!c) return false;
      custStats([c], po);
      if (k >= 0) b.customers[k] = c; else b.customers.push(c);
    }
    if (leadsToo) b.leads = leadsData(ss);
    var ls = ss.getSheetByName(LOG_TAB), last = ls ? ls.getLastRow() - 1 : 0; // dòng nhật ký mới ghi thêm
    if (last > b.logN) { ls.getRange(b.logN + 2, 1, last - b.logN, 7).getValues().forEach(function (r) { b.log.push(logObj(r)); }); b.logN = last; if (b.log.length > 6000) b.log = b.log.slice(-6000); }
    dataChanged(); cachePut(cacheKey(), b); return true;
  } catch (e) { console.error('cachePatch', e); return false; }
}
/** Chạy tự động mỗi 5 phút (6h–22h): đọc sẵn Sheet vào bản nhớ tạm, nhân sự mở CRM không phải chờ đọc Sheet. */
function docSanCRM() {
  var pp = PropertiesService.getScriptProperties(); if (pp.getProperty('retired')) return;
  var h = Number(Utilities.formatDate(new Date(), TZ, 'H')); if (h < 6 || h >= 22) return;
  if (pp.getProperty('auto_tick_v') !== '30m') { try { wbTrigger(SpreadsheetApp.getActiveSpreadsheet()); } catch (e) { console.error('auto tick', e); } } // đổi lịch tự nhập file sale sang 30 phút (1 lần)
  if (!pp.getProperty('today_hidden')) { try { var tt = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(TODAY_TAB); if (tt) tt.hideSheet(); pp.setProperty('today_hidden', '1'); } catch (e) { console.error('hide today', e); } } // trang việc cũ trên Sheet: CRM đã thay → ẩn (1 lần)
  var key = cacheKey(), c = CacheService.getScriptCache(); if (c.get(key + '_n')) return; // bản nhớ còn → thôi
  var t0 = Date.now(), b = readBase(SpreadsheetApp.getActiveSpreadsheet());
  if (cacheKey() === key) cachePut(key, b); // trong lúc đọc có người lưu → bản vừa đọc có thể cũ, để lần sau
  console.log('docSanCRM ' + (Date.now() - t0) + 'ms, ' + Math.round(JSON.stringify(b).length / 1024) + ' KB');
}
/** Tự cài lịch đọc sẵn (1 lần). Có thể chạy tay hàm này trong Apps Script nếu cần. */
function caiDocSan() {
  var has = ScriptApp.getProjectTriggers().some(function (t) { return t.getHandlerFunction() === 'docSanCRM'; });
  if (!has) ScriptApp.newTrigger('docSanCRM').timeBased().everyMinutes(5).create();
  PropertiesService.getScriptProperties().setProperty('warm_on', '1'); return !has;
}

var NOTE_MAX = 400; // nhật ký dài chỉ gửi phần đầu khi mở CRM; mở hồ sơ khách mới tải đủ (cust_orders)
/** Gửi về trình duyệt: đơn 13 tháng gần nhất + đơn còn đang xử lý (đơn cũ hơn xem trong hồ sơ khách). */
function recentOrders(orders) {
  var from = Date.now() - 400 * 864e5, open = { 'Mới': 1, 'Đã xác nhận': 1, 'Đang giao': 1 };
  return orders.filter(function (o) { return (o.time && o.time >= from) || open[o.status]; }).sort(function (a, b) { return (a.time || 0) - (b.time || 0); }).slice(-6000);
}
/** Toàn bộ đơn của 1 khách (kể cả đơn cũ). */
function crmCustOrders(ss, u, d) {
  var phone = normPhone(d.phone);
  if (u.level < 2 && ownerOf(ss, phone) !== u.name) return { ok: false, error: 'Khách này không do bạn phụ trách.' };
  var t = tableOf(ss.getSheetByName('Đơn hàng')), H = t.H, g = function (r, n) { var k = H.indexOf(n); return k < 0 ? '' : r[k]; }, out = [];
  t.rows.forEach(function (r, i) {
    if (normPhone(g(r, 'Điện thoại')) !== phone) return;
    out.push({ row: i + 2, time: ts(g(r, 'Thời gian')), id: String(g(r, 'Mã đơn')), name: String(g(r, 'Khách hàng')), phone: phone, items: String(g(r, 'Sản phẩm')), total: Number(g(r, 'Tổng')) || 0,
      subtotal: Number(g(r, 'Tạm tính')) || 0, shipping: Number(g(r, 'Phí ship')) || 0, payment: String(g(r, 'Thanh toán')), note: String(g(r, 'Ghi chú')), status: String(g(r, 'Trạng thái') || ''), source: String(g(r, 'Nguồn')),
      seller: String(g(r, 'NV bán') || ''), ca: String(g(r, 'Ca') || ''), line: String(g(r, 'Dòng SP') || ''), ship: String(g(r, 'Lên đơn') || ''), shipAt: ts(g(r, 'Ngày gửi')), otype: String(g(r, 'Loại đơn') || ''), oflag: String(g(r, 'Kiểm tra loại đơn') || ''), address: String(g(r, 'Địa chỉ')), province: String(g(r, 'Tỉnh/TP')), ward: String(g(r, 'Phường/Xã')), paid: String(g(r, 'Đã nhận tiền') || ''), carrier: String(g(r, 'Đơn vị vận chuyển') || ''), tracking: String(g(r, 'Mã vận đơn') || ''), trk: String(g(r, 'Hành trình VC') || ''), trkAt: ts(g(r, 'Cập nhật VC')), trkCode: Number(g(r, 'Mã TT VC')) || 0 });
  });
  var cs = ss.getSheetByName('Khách hàng'), row = cs ? customerRow(cs, phone) : -1;
  return { ok: true, orders: out, note: row > 0 ? String(cs.getRange(row, C['Ghi chú CSKH'] + 1).getValue() || '') : '' };
}

/* ---------- ghi dữ liệu */
/* ---------- đo tốc độ: CRM trên máy từng người gửi thời gian mỗi lần tải / lưu (2 phút/lần, gộp) → tab "Đo tốc độ CRM".
 * Tổng − Máy chủ = thời gian đi đường (mạng, máy chủ Google nhận lệnh). Dữ liệu "đọc Sheet" = phải đọc lại cả Sheet (chậm). */
var PERF_TAB = 'Đo tốc độ CRM', PERF_HEADERS = ['Thời gian', 'Người', 'Vai trò', 'Thao tác', 'Tổng (giây)', 'Máy chủ (giây)', 'Dữ liệu', 'KB', 'Thiết bị'];
function crmPerf(ss, u, d) {
  var sec = function (v) { return v === null || v === undefined || v === '' || isNaN(v) ? '' : Math.round(Number(v) / 100) / 10; };
  var rows = (Array.isArray(d.rows) ? d.rows : []).slice(-60).map(function (r) { r = Array.isArray(r) ? r : []; return [new Date(Number(r[0]) || Date.now()), u.name, u.role, String(r[1] || '').slice(0, 40), sec(r[2]), sec(r[3]), String(r[4] || '').slice(0, 40), Number(r[5]) || '', String(d.dev || '').slice(0, 80)]; });
  if (!rows.length) return { ok: true };
  var sh = sheet(ss, PERF_TAB, PERF_HEADERS); sh.getRange(sh.getLastRow() + 1, 1, rows.length, PERF_HEADERS.length).setValues(rows);
  if (sh.getLastRow() > 8000) sh.deleteRows(2, sh.getLastRow() - 6000);
  return { ok: true };
}
function crmLog(ss, u, what, ref, name, result, note) {
  sheet(ss, LOG_TAB, LOG_HEADERS).appendRow([new Date(), u.name, what, "'" + ref, name || '', result || '', note || '']);
}
function customerRow(cs, phone) {
  if (cs.getLastRow() < 2) return -1;
  var p = cs.getRange(2, 1, cs.getLastRow() - 1, 1).getValues();
  for (var i = 0; i < p.length; i++) if (normPhone(p[i][0]) === phone) return i + 2;
  return -1;
}
function dateOrBlank(s) { if (!s) return ''; var d = new Date(String(s) + 'T09:00:00+07:00'); return isNaN(d) ? '' : d; }

/** Kho chung: nhân viên bấm "Nhận khách". */
function crmClaim(ss, u, d) {
  if (assignMode() !== 'pool' && u.level < 2) return { ok: false, error: 'Đang không ở chế độ Kho chung.' };
  if (d.leadId) { var ld = leadGet(ss, d.leadId); if (!ld) return { ok: false, error: 'Không tìm thấy khách.' }; if (ld['Phụ trách'] && ld['Phụ trách'] !== u.name) return { ok: false, error: 'Khách này vừa được ' + ld['Phụ trách'] + ' nhận.' }; leadUpdate(ss, d.leadId, { 'Phụ trách': u.name }); }
  if (d.phone) { var o = ownerOf(ss, d.phone); if (o && o !== u.name) return { ok: false, error: 'Khách này vừa được ' + o + ' nhận.' }; setOwner(ss, d.phone, u.name); }
  crmLog(ss, u, 'Nhận khách', normPhone(d.phone || ''), '', 'Kho chung', '');
  return { ok: true };
}

/** Khách đã nhận hàng: ghi Ngày nhận cho đơn gần nhất (đơn đang giao → Đã giao), tính lại ngày dùng hết từ hôm nay. */
function markReceived(ss, phone, when) {
  var o = orderSheet(ss), sh = o.sh, H = o.H, n = sh.getLastRow() - 1; if (n < 1) return false;
  var ip = H.indexOf('Điện thoại'), it = H.indexOf('Thời gian'), is = H.indexOf('Trạng thái'), ir = H.indexOf('Ngày nhận'), ii = H.indexOf('Sản phẩm'); if (ir < 0) return false;
  var vals = sh.getRange(2, 1, n, H.length).getValues(), best = -1;
  vals.forEach(function (r, i) { if (normPhone(r[ip]) === phone && !isVoid(r[is]) && (best < 0 || new Date(r[it]) >= new Date(vals[best][it]))) best = i; });
  if (best < 0) return false;
  var r = vals[best], open = /^(Mới|Đã xác nhận|Đang giao)$/.test(String(r[is]));
  if (r[ir] || (!open && when - new Date(r[it]) > 20 * 864e5)) return false; // đơn cũ đã giao từ lâu: không ghi ngày nhận = hôm nay (sai lệch ngày dùng hết)
  sh.getRange(best + 2, ir + 1).setValue(when); r[ir] = when;
  if (open) sh.getRange(best + 2, is + 1).setValue('Đã giao');
  var cs = sheet(ss, 'Khách hàng', CUS_HEADERS), row = customerRow(cs, phone); if (row < 0) return true;
  var rv = r[ir] ? new Date(r[ir]) : when, run = runOutDate(cycleSheet(ss), parseItemLines(r[ii]), rv);
  cs.getRange(row, C['Nhận hàng'] + 1).setValue(rv); if (run) cs.getRange(row, C['Dự kiến hết hàng'] + 1).setValue(run);
  return true;
}
function crmCare(ss, u, d) {
  var gErr = guardPhone(ss, u, d.phone); if (gErr) return { ok: false, error: gErr };
  var cs = sheet(ss, 'Khách hàng', CUS_HEADERS), phone = normPhone(d.phone), row = customerRow(cs, phone);
  if (row < 0) return { ok: false, error: 'Không tìm thấy khách ' + phone };
  var r = cs.getRange(row, 1, 1, CUS_HEADERS.length), v = r.getValues()[0], now = new Date();
  v[C['Lần CSKH gần nhất']] = now; v[C['Kết quả CSKH']] = String(d.result || '');
  v[C['Hẹn gọi lại']] = dateOrBlank(d.callback);
  if (!v[C['Phụ trách']]) v[C['Phụ trách']] = u.name;
  v[0] = "'" + phone; r.setValues([v]);
  var note = String(d.note || '').trim();
  if (d.received) markReceived(ss, phone, now);
  crmLog(ss, u, TASK_LABEL[d.task] || TASK_LABEL.other, phone, v[C['Tên']], d.result, note + (d.callback ? (note ? ' – ' : '') + 'hẹn gọi lại ' + String(d.callback).split('-').reverse().join('/') : ''));
  var cbTxt = d.callback ? ' (hẹn gọi ' + String(d.callback).split('-').reverse().slice(0, 2).map(Number).join('/') + ')' : '';
  wbQueue(ss, v[C['Phụ trách']], phone, v[C['Tên']], (note || WB_SHORT[d.result] || d.result) + cbTxt);
  return { ok: true, careAt: now.getTime(), owner: v[C['Phụ trách']], callback: ts(v[C['Hẹn gọi lại']]) };
}

function crmCustomer(ss, u, d) {
  var gErr = guardPhone(ss, u, d.phone); if (gErr) return { ok: false, error: gErr };
  if (u.level < 2) delete d.owner; // nhân viên không tự đổi người phụ trách
  var cs = sheet(ss, 'Khách hàng', CUS_HEADERS), phone = normPhone(d.phone), row = customerRow(cs, phone);
  if (row < 0) return { ok: false, error: 'Không tìm thấy khách ' + phone };
  var set = { owner: 'Phụ trách', note: 'Ghi chú CSKH', name: 'Tên', address: 'Địa chỉ', province: 'Tỉnh/TP', ward: 'Phường/Xã', tag: 'Nhãn màu' };
  Object.keys(set).forEach(function (k) { if (d[k] !== undefined) cs.getRange(row, C[set[k]] + 1).setValue(String(d[k]).slice(0, 45000)); });
  if (d.callback !== undefined) cs.getRange(row, C['Hẹn gọi lại'] + 1).setValue(dateOrBlank(d.callback));
  if (d.zalo !== undefined) cs.getRange(row, C['Zalo'] + 1).setValue(d.zalo ? 'Có' : '');
  if (d.community !== undefined) { // mời / đã vào nhóm Zalo cộng đồng
    var cm = d.community === 'Đã vào' ? 'Đã vào' : d.community === 'Đã mời' ? 'Đã mời ' + Utilities.formatDate(new Date(), TZ, 'dd/MM/yy') : '';
    cs.getRange(row, C['Cộng đồng'] + 1).setValue(cm);
    var cv2 = cs.getRange(row, 1, 1, CUS_HEADERS.length).getValues()[0];
    crmLog(ss, u, 'Cộng đồng', phone, cv2[C['Tên']], cm || 'Bỏ đánh dấu', '');
    if (cm === 'Đã vào') wbQueue(ss, cv2[C['Phụ trách']], phone, cv2[C['Tên']], '👥 đã vào nhóm Zalo cộng đồng');
  }
  if (d.consent !== undefined) cs.getRange(row, C['Đồng ý nhận tin'] + 1).setValue(d.consent ? 'Có' : 'Không');
  if (d.quick || d.zalo) { var cv = cs.getRange(row, 1, 1, CUS_HEADERS.length).getValues()[0]; if (d.quick) wbQueue(ss, cv[C['Phụ trách']], phone, cv[C['Tên']], d.quick); if (d.zalo) wbQueue(ss, cv[C['Phụ trách']], phone, cv[C['Tên']], WB_ZALO, true); } // ghi nhanh / đã kết bạn Zalo → cũng ghi vào file sale
  if (d.promo) { // đã gửi tin ưu đãi qua Zalo: thêm 1 dòng nhật ký (ghép vào ghi chú ở máy chủ, không đè), ghi file sale, ghi "Gửi ưu đãi" để đo ưu đãi ra đơn
    var pv = cs.getRange(row, 1, 1, CUS_HEADERS.length).getValues()[0], camp = String(d.promo).slice(0, 80), line = Utilities.formatDate(new Date(), TZ, 'dd/MM/yy') + ': 📣 Gửi ưu đãi: ' + camp, cur = String(pv[C['Ghi chú CSKH']] || '');
    cs.getRange(row, C['Ghi chú CSKH'] + 1).setValue((line + (cur ? '\n' + cur : '')).slice(0, 45000));
    wbQueue(ss, pv[C['Phụ trách']], phone, pv[C['Tên']], '📣 ' + camp);
    crmLog(ss, u, 'Gửi ưu đãi', phone, pv[C['Tên']], camp, '');
  }
  return { ok: true };
}

function orderRow(sh, H, d) {
  var row = Number(d.row), idc = H.indexOf('Mã đơn') + 1;
  if (row >= 2 && row <= sh.getLastRow() && String(sh.getRange(row, idc).getValue()) === String(d.id)) return row;
  var ids = sh.getRange(2, idc, Math.max(sh.getLastRow() - 1, 1), 1).getValues(); // dòng bị xê dịch → tìm lại theo mã đơn
  for (var i = 0; i < ids.length; i++) if (String(ids[i][0]) === String(d.id)) return i + 2;
  return -1;
}
function orderSheet(ss) { var sh = sheet(ss, 'Đơn hàng', ORDER_HEADERS); return { sh: sh, H: sh.getRange(1, 1, 1, sh.getLastColumn()).getValues()[0] }; }

/** Đổi trạng thái / ghi chú / đã nhận tiền / vận chuyển của 1 đơn. */
function crmOrderStatus(ss, u, d) {
  var o = orderSheet(ss), sh = o.sh, H = o.H, row = orderRow(sh, H, d);
  if (row < 0) return { ok: false, error: 'Không tìm thấy đơn ' + d.id };
  var col = function (n) { return H.indexOf(n) + 1; }, name = sh.getRange(row, col('Khách hàng')).getValue();
  var gErr = orderGuard(ss, u, sh, H, row); if (gErr) return { ok: false, error: gErr };
  var old = String(sh.getRange(row, col('Trạng thái')).getValue()), status = d.status;
  if (d.note !== undefined) sh.getRange(row, col('Ghi chú')).setValue(String(d.note));
  if (d.paid !== undefined) {
    var pv = d.paid ? 'Có – ' + u.name + ' ' + Utilities.formatDate(new Date(), TZ, 'dd/MM HH:mm') : '';
    sh.getRange(row, col('Đã nhận tiền')).setValue(pv);
    crmLog(ss, u, 'Đơn hàng', d.id, name, d.paid ? 'Đã nhận tiền chuyển khoản' : 'Bỏ đánh dấu đã nhận tiền', '');
  }
  if (d.otype !== undefined || d.otypeOk) { // quản lý kiểm tra loại đơn: giữ (✓ Đúng) hoặc đổi
    if (u.level < 2) return { ok: false, error: 'Chỉ quản lý xác nhận / đổi loại đơn.' };
    var ot0 = String(sh.getRange(row, col('Loại đơn')).getValue() || ''), ot1 = OTYPES.indexOf(d.otype) >= 0 ? d.otype : ot0, fl0 = String(sh.getRange(row, col('Kiểm tra loại đơn')).getValue() || '');
    sh.getRange(row, col('Loại đơn')).setValue(ot1); if (ot1 !== ot0) sh.getRange(row, col('Ca')).setValue(otypeCa(ot1)); sh.getRange(row, col('Kiểm tra loại đơn')).setValue('');
    crmLog(ss, u, 'Loại đơn', d.id, name, ot1 !== ot0 ? ot0 + ' → ' + ot1 : 'Xác nhận ' + ot1, fl0);
  }
  if (d.seller !== undefined) {
    if (u.level < 2) return { ok: false, error: 'Chỉ quản lý đổi được nhân viên bán.' };
    var oldSeller = String(sh.getRange(row, col('NV bán')).getValue() || '');
    sh.getRange(row, col('NV bán')).setValue(String(d.seller));
    crmLog(ss, u, 'Đơn hàng', d.id, name, 'Nhân viên bán: ' + (oldSeller || '–') + ' → ' + (d.seller || '–'), '');
  }
  if (d.tracking !== undefined || d.carrier !== undefined) {
    if (d.carrier !== undefined) sh.getRange(row, col('Đơn vị vận chuyển')).setValue(String(d.carrier));
    if (d.tracking !== undefined) sh.getRange(row, col('Mã vận đơn')).setValue("'" + String(d.tracking).trim());
    crmLog(ss, u, 'Đơn hàng', d.id, name, 'Vận đơn: ' + [d.carrier, d.tracking].filter(Boolean).join(' '), '');
    if (String(d.tracking || '').trim() && (old === 'Mới' || old === 'Đã xác nhận') && !status) status = 'Đang giao'; // có mã vận đơn = đã gửi hàng
  }
  if (status && status !== old) {
    if (ORDER_STATUS.indexOf(status) < 0) return { ok: false, error: 'Trạng thái không hợp lệ' };
    fixStatusRule(sh); sh.getRange(row, col('Trạng thái')).setValue(status);
    crmLog(ss, u, 'Đơn hàng', d.id, name, old + ' → ' + status, d.reason || '');
    if (status === 'Đang giao' && col('Ngày gửi') > 0 && !sh.getRange(row, col('Ngày gửi')).getValue()) sh.getRange(row, col('Ngày gửi')).setValue(new Date()); // tính “giao lâu” từ ngày gửi, không từ ngày đặt
    if (status === 'Đã giao' && col('Ngày nhận') > 0 && !sh.getRange(row, col('Ngày nhận')).getValue()) { sh.getRange(row, col('Ngày nhận')).setValue(new Date()); markReceived(ss, normPhone(sh.getRange(row, col('Điện thoại')).getValue()), new Date()); }
    if (isVoid(old) !== isVoid(status)) rebuildCustomers(); // huỷ / hoàn / khôi phục đơn → tính lại khách
    try { var ph0 = normPhone(sh.getRange(row, col('Điện thoại')).getValue()); var srcLbl = String(sh.getRange(row, col('Nguồn')).getValue() || ''); wbStatusQueue(ss, [String(sh.getRange(row, col('NV bán')).getValue() || ''), ownerOf(ss, ph0)], { id: String(d.id), sheet: /^File .+ – /.test(srcLbl) ? srcLbl.replace(/^File .+? – /, '') : '', phone: ph0, name: name, time: ts(sh.getRange(row, col('Thời gian')).getValue()), total: Number(sh.getRange(row, col('Tổng')).getValue()) || 0, status: status }); } catch (e) { console.error('wbStatus', e); } // ghi trạng thái vào file sale
  }
  return { ok: true, row: row, status: status || old };
}

/** Nhân viên được xử lý đơn mình bán hoặc đơn của khách mình phụ trách. */
function orderGuard(ss, u, sh, H, row) {
  if (u.level >= 2) return '';
  if (String(sh.getRange(row, H.indexOf('NV bán') + 1).getValue()) === u.name) return '';
  return guardPhone(ss, u, sh.getRange(row, H.indexOf('Điện thoại') + 1).getValue());
}

var CA_LIST = ['Ngày', 'Tối/CN', 'Lễ'];
/** Sale linh động giá: nếu nhập "Tổng tiền thu khách" thì chia lại tiền cho các dòng theo tỉ lệ giá. Trả về tạm tính. */
function applyTotal(items, total, ship) {
  var sub = items.reduce(function (s, i) { return s + i.subtotal; }, 0), want = Math.round(Number(total) || 0) - ship;
  if (!(want > 0) || want === sub) return sub;
  var left = want;
  items.forEach(function (i, k) { var v = k === items.length - 1 ? left : sub ? Math.round(i.subtotal * want / sub) : Math.round(want / items.length); i.subtotal = v; i.price = i.qty ? Math.round(v / i.qty) : v; left -= v; });
  return want;
}
/** Mã đơn theo sale: <tiền tố><ddMMyy>-<số thứ tự>, ví dụ Phuong300926-01. Tiền tố đặt ở Nhân sự (mặc định tên không dấu). */
function nextCode(ss, u, now) {
  var x = crmUsers(ss).filter(function (y) { return y.email === u.email; })[0] || u, pre = (x.prefix || slugName(u.name)) + Utilities.formatDate(now, TZ, 'ddMMyy') + '-';
  var sh = ss.getSheetByName('Đơn hàng'), n = 0;
  if (sh && sh.getLastRow() > 1) { var H = sh.getRange(1, 1, 1, sh.getLastColumn()).getValues()[0], ic = H.indexOf('Mã đơn') + 1; sh.getRange(2, ic, sh.getLastRow() - 1, 1).getValues().forEach(function (r) { var c = String(r[0]); if (c.indexOf(pre) === 0) n = Math.max(n, parseInt(c.slice(pre.length), 10) || 0); }); }
  return pre + (n + 1 < 10 ? '0' : '') + (n + 1);
}
function slugName(n) { var s = String(n || 'NV').normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/đ/g, 'd').replace(/Đ/g, 'D').split(/\s+/).pop(); return s.charAt(0).toUpperCase() + s.slice(1); }

function cleanItems(list) {
  return (list || []).filter(function (i) { return i && i.name && Number(i.qty) > 0; }).map(function (i) {
    var q = Math.round(Number(i.qty)), p = Math.round(Number(i.price) || 0);
    return { name: String(i.name).replace(/\s+x\d+\s*=.*$/, '').trim(), variant: String(i.variant || '').trim(), qty: q, price: p, subtotal: p * q };
  });
}
function itemsText(items) { return items.map(function (i) { return (i.gift ? '🎁 ' : '') + i.name + (i.variant ? ' (' + i.variant + ')' : '') + ' x' + i.qty + ' = ' + fmt(i.gift ? 0 : i.subtotal); }).join('\n'); }
/** Câu "lên đơn" gửi vận chuyển: "4 Fucoidan Progomax 900g, 1 Bữa ăn dinh dưỡng (quà)". */
function shipText(items) { return (items || []).map(function (i) { return (Number(i.qty) || 1) + ' ' + i.name + (i.variant ? ' ' + i.variant : '') + (i.gift ? ' (quà)' : ''); }).join(', '); }
var LINES = [['Fucoidan Pro', /progomax|fucoidan pro|fu ?pro/i], ['Curcumin', /curcumin|nghệ/i], ['BADD', /bữa ăn|badd|bua an/i]];
/** Dòng sản phẩm để báo cáo BCDT: Fucoidan Pro / Curcumin / BADD / Khác. */
function lineOf(text) { for (var i = 0; i < LINES.length; i++) if (LINES[i][1].test(String(text || ''))) return LINES[i][0]; return 'Khác'; }
function normLine(v, fallbackText) { var t = String(v || '').trim(); if (!t) return lineOf(fallbackText); var l = lineOf(t); return l !== 'Khác' ? l : (/khác/i.test(t) || !lineOf(fallbackText) ? 'Khác' : lineOf(fallbackText)); }
/** Ca: Lễ (ngày lễ trong Cài đặt) / Tối-CN (sau giờ ca tối hoặc Chủ nhật) / Ngày. */
var CA_CFG = null; // đọc 1 lần mỗi lượt chạy
function caCfg() { if (CA_CFG) return CA_CFG; try { CA_CFG = JSON.parse(PropertiesService.getScriptProperties().getProperty('ca_cfg') || '{}'); } catch (e) { CA_CFG = {}; } return CA_CFG; }
function caOf(d, cfg) {
  cfg = cfg || caCfg(); var t = new Date(d.getTime() + 7 * 3600e3), pad = function (n) { return (n < 10 ? '0' : '') + n; };
  var dm = pad(t.getUTCDate()) + '/' + pad(t.getUTCMonth() + 1), ev = String(cfg.evening || '17:30').split(':');
  if ((cfg.holidays || ['01/01', '30/04', '01/05', '02/09']).indexOf(dm) >= 0) return 'Lễ';
  if (t.getUTCDay() === 0) return 'Tối/CN';
  if (t.getUTCHours() * 60 + t.getUTCMinutes() >= (+ev[0]) * 60 + (+ev[1] || 0)) return 'Tối/CN';
  return 'Ngày';
}

/** Sửa đơn: khách, địa chỉ, sản phẩm, phí ship, thanh toán. Sau đó tính lại trang Khách hàng. */
function crmOrderEdit(ss, u, d) {
  var o = orderSheet(ss), sh = o.sh, H = o.H, row = orderRow(sh, H, d);
  if (row < 0) return { ok: false, error: 'Không tìm thấy đơn ' + d.id };
  var c = d.customer || {}, phone = normPhone(c.phone), items = cleanItems(d.items);
  if (!/^0\d{9,10}$/.test(phone)) return { ok: false, error: 'Số điện thoại chưa đúng.' };
  if (!String(c.name || '').trim()) return { ok: false, error: 'Thiếu tên khách.' };
  if (!items.length) return { ok: false, error: 'Đơn phải có ít nhất 1 sản phẩm.' };
  var gErr = orderGuard(ss, u, sh, H, row) || (normPhone(sh.getRange(row, H.indexOf('Điện thoại') + 1).getValue()) !== phone ? guardPhone(ss, u, phone) : ''); if (gErr) return { ok: false, error: gErr };
  var ship = Math.max(0, Math.round(Number(d.shipping) || 0)), sub = applyTotal(items, d.total, ship);
  items = items.concat(cleanItems(d.gifts).map(function (g) { g.gift = true; g.price = 0; g.subtotal = 0; return g; }));
  var r = sh.getRange(row, 1, 1, H.length), v = r.getValues()[0], set = function (n, val) { var k = H.indexOf(n); if (k >= 0) v[k] = val; };
  var before = fmt(v[H.indexOf('Tổng')]);
  set('Khách hàng', String(c.name).trim()); set('Điện thoại', "'" + phone); set('Tỉnh/TP', c.province || ''); set('Phường/Xã', c.ward || ''); set('Địa chỉ', c.address || '');
  set('Sản phẩm', itemsText(items)); set('Tạm tính', sub); set('Phí ship', ship); set('Tổng', sub + ship); set('Thanh toán', d.payment === 'bank' ? 'Chuyển khoản' : 'COD');
  set('Lên đơn', shipText(items)); set('Dòng SP', lineOf(items.filter(function (i) { return !i.gift; }).map(function (i) { return i.name + ' ' + i.variant; }).join(' '))); if (OTYPES.indexOf(d.otype) >= 0 && d.otype !== v[H.indexOf('Loại đơn')]) { // đổi loại đơn: quản lý → xong; nhân viên khác gợi ý → chờ quản lý kiểm tra
    var tOrd = v[H.indexOf('Thời gian')] instanceof Date ? v[H.indexOf('Thời gian')] : new Date();
    set('Loại đơn', d.otype); set('Ca', otypeCa(d.otype)); set('Kiểm tra loại đơn', u.level >= 2 ? '' : otypeFlag(d.otype, otypeSuggest(ss, phone, tOrd)));
  }
  var mv = H.indexOf('Mã vận đơn'); if (mv >= 0 && v[mv] !== '') v[mv] = "'" + v[mv];
  r.setValues([v]);
  crmLog(ss, u, 'Sửa đơn', d.id, c.name, before + ' → ' + fmt(sub + ship), d.reason || '');
  rebuildCustomers();
  return { ok: true, row: row };
}

/* ---------- loại đơn (tính hoa hồng): Khách mới / Khách cũ / Ngoài giờ / Ngày lễ. Ưu tiên Lễ → Ngoài giờ → Mới/Cũ.
 * Khách để lại số qua quảng cáo / form web / ebook trong 30 ngày → vẫn là Khách mới dù đã từng mua. Sale chọn khác gợi ý → ghi "Kiểm tra loại đơn" cho quản lý. */
var OTYPES = ['Khách mới', 'Khách cũ', 'Ngoài giờ', 'Ngày lễ'], AD_LEAD_DAYS = 30, AD_CH = /^(quảng cáo|ebook|form website)/i;
function otypeCa(t, when) { return t === 'Ngày lễ' ? 'Lễ' : t === 'Ngoài giờ' ? 'Tối/CN' : 'Ngày'; }
function otypeSuggest(ss, phone, when) {
  var ca = caOf(when), t = when.getTime(), dm = function (x) { return Utilities.formatDate(new Date(x), TZ, 'dd/MM'); };
  if (ca === 'Lễ') return { t: 'Ngày lễ', why: 'đơn tạo ngày lễ ' + dm(t) };
  if (ca === 'Tối/CN') return { t: 'Ngoài giờ', why: 'đơn tạo ' + (Number(Utilities.formatDate(when, TZ, 'u')) === 7 ? 'Chủ nhật' : 'sau giờ ca tối') };
  phone = normPhone(phone);
  var ad = leadsData(ss).filter(function (l) { return l.phone === phone && AD_CH.test(l.channel) && l.time && l.time >= t - AD_LEAD_DAYS * 864e5 && l.time <= t + 864e5; }).sort(function (a, b) { return b.time - a.time; })[0];
  if (ad) return { t: 'Khách mới', why: 'khách để lại số qua ' + ad.channel + ' ngày ' + dm(ad.time) };
  var cs = ss.getSheetByName('Khách hàng'), row = cs ? customerRow(cs, phone) : -1;
  if (row > 0) { var v = cs.getRange(row, 1, 1, CUS_HEADERS.length).getValues()[0], f = v[C['Đơn đầu']] ? new Date(v[C['Đơn đầu']]).getTime() : 0; if (f && f < t - 3600e3) return { t: 'Khách cũ', why: 'đã mua từ ' + Utilities.formatDate(new Date(f), TZ, 'dd/MM/yy') + ' (' + (Number(v[C['Số đơn']]) || 1) + ' đơn)' }; }
  return { t: 'Khách mới', why: 'lần đầu mua' };
}
function otypeFlag(chosen, sug) { return chosen && chosen !== sug.t ? 'CRM gợi ý ' + sug.t + ': ' + sug.why : ''; }
function crmOrderCreate(ss, u, d) {
  var c = d.customer || {}, phone = normPhone(c.phone);
  if (!/^0\d{9,10}$/.test(phone)) return { ok: false, error: 'Số điện thoại chưa đúng.' };
  if (u.level < 2) { var ow = ownerOf(ss, phone); if (ow && ow !== u.name) return { ok: false, error: 'Khách này do ' + ow + ' phụ trách. Nhờ ' + ow + ' lên đơn, hoặc nhờ quản lý chuyển khách.' }; }
  if (d.leadId) { var lg0 = leadGet(ss, d.leadId); if (lg0) { var lErr = guardLead(ss, u, lg0); if (lErr) return { ok: false, error: lErr }; } }
  if (!String(c.name || '').trim()) return { ok: false, error: 'Thiếu tên khách.' };
  var items = cleanItems(d.items);
  if (!items.length) return { ok: false, error: 'Chưa chọn sản phẩm.' };
  var ship = Math.max(0, Math.round(Number(d.shipping) || 0)), sub = applyTotal(items, d.total, ship);
  items = items.concat(cleanItems(d.gifts).map(function (g) { g.gift = true; g.price = 0; g.subtotal = 0; return g; }));
  var now = new Date(), id = nextCode(ss, u, now), sug = otypeSuggest(ss, phone, now); // gợi ý tính TRƯỚC khi lưu (lưu xong khách đã thành "đã mua")
  var otype = OTYPES.indexOf(d.otype) >= 0 ? d.otype : sug.t, oflag = u.level >= 2 ? '' : otypeFlag(otype, sug), caIn = otypeCa(otype, now); // ca theo loại đơn; quản lý chọn thì không cần kiểm tra
  var src = 'Nhập tay – ' + (d.source || 'Khác');
  if (d.leadId) { var ld = leadGet(ss, d.leadId); if (ld && ld['Kênh']) src = 'Tiềm năng – ' + ld['Kênh']; }
  saveOrder(ss, { id: id, customer: { name: String(c.name).trim(), phone: phone, email: c.email || '', province: c.province || '', district: c.ward || '', address: c.address || '', note: c.note || '' },
    items: items, subtotal: sub, shipping: ship, total: sub + ship, payment: d.payment === 'bank' ? 'bank' : 'cod', source: src, first_source: src, marketing_consent: !!d.consent },
    { by: u.name, status: ORDER_STATUS.indexOf(d.status) >= 0 ? d.status : 'Đã xác nhận', ca: caIn, otype: otype, oflag: oflag });
  var lock = LockService.getScriptLock(); lock.waitLock(20000);
  try {
    var cs = sheet(ss, 'Khách hàng', CUS_HEADERS), row = customerRow(cs, phone);
    if (row > 0 && !cs.getRange(row, C['Phụ trách'] + 1).getValue()) cs.getRange(row, C['Phụ trách'] + 1).setValue(u.name);
    crmLog(ss, u, 'Tạo đơn', id, c.name, fmt(sub + ship), src);
    var real0 = items.filter(function (i) { return !i.gift; }), gift0 = items.filter(function (i) { return i.gift; })[0];
    wbOrderQueue(ss, (row > 0 && cs.getRange(row, C['Phụ trách'] + 1).getValue()) || u.name, { id: id, time: now.getTime(), name: String(c.name).trim(), phone: phone, address: [c.address, c.ward, c.province].filter(Boolean).join(', '),
      product: real0.map(function (i) { return i.name + (i.variant ? ' ' + i.variant : '') + (real0.length > 1 ? ' x' + i.qty : ''); }).join(', '), qty: real0.length === 1 ? real0[0].qty : '', gift: gift0 ? gift0.name : '', giftQty: gift0 ? gift0.qty : '',
      total: sub + ship, status: ORDER_STATUS.indexOf(d.status) >= 0 ? d.status : 'Đã xác nhận', ship: shipText(items), note: c.note || '', ca: caIn, otype: otype, old: row > 0 && Number(cs.getRange(row, C['Số đơn'] + 1).getValue()) > 1 }); // ghi ngược vào sheet lên đơn của sale
    if (d.leadId) leadUpdate(ss, d.leadId, { 'Trạng thái': 'Đã chốt', 'Mã đơn': id, 'Lần liên hệ gần nhất': now, 'Hẹn liên hệ lại': '' });
  } finally { lock.releaseLock(); }
  return { ok: true, id: id, otype: otype, oflag: oflag };
}

function crmContact(ss, u, d) {
  var sh = sheet(ss, 'Liên hệ', CONTACT_HEADERS), row = Number(d.row);
  if (sh.getRange(1, 7).getValue() !== 'Đã trả lời') sh.getRange(1, 7, 1, 2).setValues([['Đã trả lời', 'Ghi chú']]);
  if (!(row >= 2 && row <= sh.getLastRow())) return { ok: false, error: 'Không tìm thấy liên hệ' };
  if (d.done !== undefined) sh.getRange(row, 7).setValue(!!d.done);
  if (d.note !== undefined) sh.getRange(row, 8).setValue(String(d.note));
  if (d.done) crmLog(ss, u, 'Trả lời liên hệ', normPhone(sh.getRange(row, 3).getValue()), sh.getRange(row, 2).getValue(), 'Đã trả lời', d.note || '');
  return { ok: true };
}

function rewriteRows(sh, fromRow, width, rows) {
  if (sh.getLastRow() >= fromRow) sh.getRange(fromRow, 1, sh.getLastRow() - fromRow + 1, width).clearContent();
  if (rows.length) sh.getRange(fromRow, 1, rows.length, width).setValues(rows);
}
function crmSettings(ss, u, d) {
  if (d.ca) {
    var hol = String(d.ca.holidays || '').split(/[,;\s]+/).map(function (x) { var m = x.match(/^(\d{1,2})\/(\d{1,2})$/); return m ? ('0' + m[1]).slice(-2) + '/' + ('0' + m[2]).slice(-2) : ''; }).filter(String);
    var ev = /^\d{1,2}:\d{2}$/.test(String(d.ca.evening)) ? d.ca.evening : '17:30';
    PropertiesService.getScriptProperties().setProperty('ca_cfg', JSON.stringify({ evening: ev, holidays: hol })); CA_CFG = null;
    crmLog(ss, u, 'Cài đặt', '-', '', 'Ca tối từ ' + ev + ', lễ: ' + hol.join(', '), '');
    return { ok: true };
  }
  if (d.rules) {
    var R = { vipOrders: Math.max(1, Math.round(Number(d.rules.vipOrders) || VIP_ORDERS)), vipSpent: Math.max(0, Math.round(Number(d.rules.vipSpent) || VIP_SPENT)), atRisk: Math.max(7, Math.round(Number(d.rules.atRisk) || AT_RISK_DAYS)), shipDays: Math.min(15, Math.max(0, Math.round(d.rules.shipDays === undefined || d.rules.shipDays === '' ? SHIP_DAYS : Number(d.rules.shipDays)))),
      famMin: d.rules.famMin === undefined || d.rules.famMin === '' ? rulesCfg().famMin : Math.min(10, Math.max(0, Math.round(Number(d.rules.famMin) || 0))) };
    PropertiesService.getScriptProperties().setProperty('rules_cfg', JSON.stringify(R)); RULES_CFG = null;
    crmLog(ss, u, 'Cài đặt', '-', '', 'VIP từ ' + R.vipOrders + ' đơn hoặc ' + fmt(R.vipSpent) + '; Sắp mất sau ' + R.atRisk + ' ngày; khách quen SP từ ' + R.famMin + ' lần', '');
    return { ok: true, rules: R };
  }
  if (d.commission) { // % hoa hồng theo loại đơn (quản lý sửa)
    var CM = {}; OTYPES.forEach(function (t) { var x = Number(String(d.commission[t] == null ? '' : d.commission[t]).replace(',', '.')); CM[t] = isNaN(x) ? 0 : Math.min(100, Math.max(0, x)); });
    PropertiesService.getScriptProperties().setProperty('commission_cfg', JSON.stringify(CM));
    crmLog(ss, u, 'Cài đặt', '-', '', 'Hoa hồng: ' + OTYPES.map(function (t) { return t + ' ' + CM[t] + '%'; }).join(', '), '');
    return { ok: true, commission: CM };
  }
  if (d.assignMode) {
    if (!ASSIGN_MODES[d.assignMode]) return { ok: false, error: 'Chế độ không hợp lệ' };
    PropertiesService.getScriptProperties().setProperty('assign_mode', d.assignMode);
    crmLog(ss, u, 'Cài đặt', '-', '', 'Chia khách mới: ' + ASSIGN_MODES[d.assignMode], '');
    return { ok: true };
  }
  if (d.cycles) {
    cycleSheet(ss);
    var rows = d.cycles.filter(function (r) { return r && String(r[0]).trim() && Number(r[2]) > 0; }).map(function (r) { return [String(r[0]).trim(), String(r[1] || '').trim(), Number(r[2]), String(r[3] || '')]; });
    rewriteRows(ss.getSheetByName('Chu kỳ dùng'), 2, 4, rows);
    rebuildCustomers(); // tính lại ngày dự kiến hết hàng theo chu kỳ mới
  }
  if (d.templates) {
    templateSheet(ss);
    rewriteRows(ss.getSheetByName('Mẫu tin nhắn CSKH'), 2, 3, d.templates.filter(function (r) { return r && String(r[2]).trim(); }).map(function (r) { return [String(r[0] || ''), String(r[1] || ''), String(r[2])]; }));
  }
  crmLog(ss, u, 'Cài đặt', '-', '', d.cycles ? 'Sửa chu kỳ dùng' : 'Sửa mẫu tin nhắn', '');
  return { ok: true };
}
function crmSaveUsers(ss, u, d) {
  var cur = {}; crmUsers(ss).forEach(function (x) { cur[x.email] = x; });
  var seen = {}, rows = (d.users || []).map(function (x) {
    var e = String(x.email || '').trim().toLowerCase(), o = cur[e] || {}, role = ROLES[x.role] ? x.role : 'Nhân viên';
    return [e, String(x.name || '').trim(), role, x.active === false ? 'Không' : 'Có', (x.recv !== undefined ? x.recv : o.recv !== undefined ? o.recv : role === 'Nhân viên') ? 'Có' : 'Không', o.tg ? "'" + o.tg : '',
      String(x.alias !== undefined ? x.alias : o.alias || '').trim(), String(x.prefix !== undefined ? x.prefix : o.prefix || '').replace(/[^A-Za-z0-9]/g, '')];
  })
    .filter(function (r) { if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(r[0]) || seen[r[0]]) return false; seen[r[0]] = 1; return true; });
  if (!seen[SUPER_ADMIN]) rows.unshift([SUPER_ADMIN, 'Thái Sơn', 'Quản trị', 'Có', 'Không', cur[SUPER_ADMIN] && cur[SUPER_ADMIN].tg ? "'" + cur[SUPER_ADMIN].tg : '', '', '']);
  rewriteRows(ss.getSheetByName(USER_TAB), 2, USER_HEADERS.length, rows);
  crmLog(ss, u, 'Nhân sự', '-', '', 'Cập nhật ' + rows.length + ' tài khoản', '');
  return { ok: true, users: crmUsers(ss) };
}

/* ---------- khách tiềm năng (hỏi mua nhưng chưa mua) */
var LEAD_TAB = 'Khách tiềm năng';
var LEAD_HEADERS = ['Mã', 'Thời gian', 'Tên', 'Điện thoại', 'Kênh', 'Quan tâm', 'Trạng thái', 'Phụ trách', 'Lần liên hệ gần nhất', 'Hẹn liên hệ lại', 'Lý do không mua', 'Ghi chú', 'Mã đơn', 'Người tạo'];
var LEAD_STATUS = ['Mới hỏi', 'Đang tư vấn', 'Đã chốt', 'Không mua'];
var LEAD_TPL = ['Khách mới hỏi', 'Chào hỏi, tư vấn', 'Dạ em chào [Tên] ạ, em là nhân viên Thực Dưỡng Lành. Em thấy mình đang quan tâm đến [Sản phẩm]. [Tên] cho em hỏi mình mua dùng cho bản thân hay cho người nhà, và đang mong muốn cải thiện điều gì ạ? Em tư vấn để mình chọn đúng sản phẩm nhé ❤️'];

/** Trang Khách tiềm năng. Lần đầu tạo: chuyển các lời nhắn cũ ở trang Liên hệ sang. */
function leadSheet(ss) {
  var sh = ss.getSheetByName(LEAD_TAB);
  if (sh) return sheet(ss, LEAD_TAB, LEAD_HEADERS);
  sh = sheet(ss, LEAD_TAB, LEAD_HEADERS);
  sh.setColumnWidths(1, LEAD_HEADERS.length, 120); sh.setColumnWidth(12, 320); sh.setTabColor('#1f5f3a');
  sh.getRange(1, 7).setNote('Mới hỏi → Đang tư vấn → Đã chốt (có đơn) / Không mua (ghi lý do).');
  var lt = tableOf(ss.getSheetByName('Liên hệ')), rows = [];
  lt.rows.forEach(function (r, i) {
    if (!r[0] && !r[1]) return;
    rows.push(['TN' + (1000 + i), r[0], r[1], "'" + normPhone(r[2]), 'Form website', '', r[6] === true ? 'Đang tư vấn' : 'Mới hỏi', '', r[6] === true ? r[0] : '', '', '', String(r[4] || '') + (r[7] ? '\n– ' + r[7] : ''), '', 'Website']);
  });
  if (rows.length) sh.getRange(2, 1, rows.length, LEAD_HEADERS.length).setValues(rows);
  return sh;
}
function leadRow(sh, id) {
  if (sh.getLastRow() < 2) return -1;
  var ids = sh.getRange(2, 1, sh.getLastRow() - 1, 1).getValues();
  for (var i = 0; i < ids.length; i++) if (String(ids[i][0]) === String(id)) return i + 2;
  return -1;
}
function leadGet(ss, id) {
  var sh = leadSheet(ss), row = leadRow(sh, id); if (row < 0) return null;
  var v = sh.getRange(row, 1, 1, LEAD_HEADERS.length).getValues()[0], o = {};
  LEAD_HEADERS.forEach(function (h, i) { o[h] = v[i]; }); o.row = row; return o;
}
function leadUpdate(ss, id, fields) {
  var sh = leadSheet(ss), row = leadRow(sh, id); if (row < 0) return false;
  var r = sh.getRange(row, 1, 1, LEAD_HEADERS.length), v = r.getValues()[0];
  Object.keys(fields).forEach(function (k) { var i = LEAD_HEADERS.indexOf(k); if (i >= 0) v[i] = fields[k]; });
  v[3] = "'" + normPhone(v[3]); r.setValues([v]);
  return true;
}
/** Thêm khách tiềm năng. Nếu số này đang có 1 lượt đang mở (Mới hỏi / Đang tư vấn) thì ghi nối vào đó, không tạo trùng. */
function addLead(ss, o) {
  var sh = leadSheet(ss), phone = normPhone(o.phone), now = new Date();
  if (sh.getLastRow() > 1) {
    var all = sh.getRange(2, 1, sh.getLastRow() - 1, LEAD_HEADERS.length).getValues();
    for (var i = all.length - 1; i >= 0; i--) {
      if (normPhone(all[i][3]) === phone && (all[i][6] === 'Mới hỏi' || all[i][6] === 'Đang tư vấn')) {
        var note = String(all[i][11] || '') + (o.note ? '\n[' + Utilities.formatDate(now, TZ, 'dd/MM') + '] ' + o.note : '');
        leadUpdate(ss, all[i][0], { 'Ghi chú': note, 'Quan tâm': o.interest || all[i][5], 'Phụ trách': all[i][7] || o.owner || '' });
        return { id: all[i][0], merged: true, owner: all[i][7] || o.owner || '' };
      }
    }
  }
  var owner = o.owner || '';
  if (!owner && o.auto) owner = ownerOf(ss, phone) || autoOwner(ss); // khách cũ → người đang phụ trách; khách lạ → theo chế độ chia khách
  var id = 'TN' + Utilities.formatDate(now, TZ, 'yyMMddHHmmss') + Math.floor(Math.random() * 10);
  sh.appendRow([id, now, o.name || '', "'" + phone, o.channel || 'Khác', o.interest || '', 'Mới hỏi', owner, '', dateOrBlank(o.callback), '', o.note || '', '', o.by || '']);
  return { id: id, merged: false, owner: owner };
}

function crmLeadSave(ss, u, d) {
  var phone = normPhone(d.phone);
  if (!/^0\d{9,10}$/.test(phone)) return { ok: false, error: 'Số điện thoại chưa đúng (10 số, bắt đầu bằng 0).' };
  if (!d.id && u.level < 2) { // nhân viên thêm khách tiềm năng: không được "đè" lên khách của người khác
    var chk = crmCheckPhone(ss, u, { phone: phone });
    if (chk.status === 'other') return { ok: false, error: 'Số này ' + (chk.lead ? 'đang là khách tiềm năng' : 'là khách hàng') + ' do ' + chk.owner + ' phụ trách. Nhờ quản lý nếu cần chuyển.' };
    d.owner = u.name;
  }
  if (d.id && u.level < 2) { var ld0 = leadGet(ss, d.id); if (!ld0) return { ok: false, error: 'Không tìm thấy khách tiềm năng.' }; var e0 = guardLead(ss, u, ld0); if (e0) return { ok: false, error: e0 }; d.owner = u.name; }
  if (!d.id) {
    var res = addLead(ss, { name: String(d.name || '').trim(), phone: phone, channel: d.channel, interest: d.interest, owner: d.owner === undefined ? u.name : d.owner, note: d.note, callback: d.callback, by: u.name });
    crmLog(ss, u, 'Thêm tiềm năng', phone, d.name, d.channel || '', d.interest || '');
    return { ok: true, id: res.id, merged: res.merged };
  }
  var f = { 'Tên': String(d.name || '').trim(), 'Điện thoại': phone, 'Kênh': d.channel || 'Khác', 'Quan tâm': d.interest || '', 'Phụ trách': d.owner || '', 'Ghi chú': d.note || '', 'Hẹn liên hệ lại': dateOrBlank(d.callback) };
  if (d.status && LEAD_STATUS.indexOf(d.status) >= 0) f['Trạng thái'] = d.status;
  if (d.reason !== undefined) f['Lý do không mua'] = d.reason;
  if (!leadUpdate(ss, d.id, f)) return { ok: false, error: 'Không tìm thấy khách tiềm năng.' };
  return { ok: true, id: d.id };
}

/** Ghi 1 lần tư vấn: kết quả, trạng thái mới, hẹn lần sau. */
function crmLeadContact(ss, u, d) {
  var ld = leadGet(ss, d.id); if (!ld) return { ok: false, error: 'Không tìm thấy khách tiềm năng.' };
  var gErr = guardLead(ss, u, ld); if (gErr) return { ok: false, error: gErr }; if (!ld['Phụ trách'] && u.level < 2) ld['Phụ trách'] = u.name;
  var st = LEAD_STATUS.indexOf(d.status) >= 0 ? d.status : (ld['Trạng thái'] === 'Mới hỏi' ? 'Đang tư vấn' : ld['Trạng thái']);
  if (st === 'Không mua' && !String(d.reason || '').trim()) return { ok: false, error: 'Ghi lý do khách không mua giúp em nhé.' };
  var now = new Date(), f = { 'Trạng thái': st, 'Lần liên hệ gần nhất': now, 'Hẹn liên hệ lại': st === 'Không mua' ? '' : dateOrBlank(d.callback) };
  if (!ld['Phụ trách']) f['Phụ trách'] = u.name;
  if (st === 'Không mua') f['Lý do không mua'] = String(d.reason).trim();
  var note = String(d.note || '').trim();
  if (note) f['Ghi chú'] = String(ld['Ghi chú'] || '') + '\n[' + Utilities.formatDate(now, TZ, 'dd/MM') + ' ' + u.name + '] ' + note;
  leadUpdate(ss, d.id, f);
  crmLog(ss, u, 'Tư vấn', normPhone(ld['Điện thoại']), ld['Tên'], d.result || st, [note, st === 'Không mua' ? 'Lý do: ' + d.reason : '', d.callback ? 'hẹn ' + String(d.callback).split('-').reverse().join('/') : ''].filter(String).join(' – '));
  var lt = [note || WB_SHORT[d.result] || d.result || st, st === 'Không mua' && d.reason ? 'không mua: ' + d.reason : ''].filter(String).join(', ') + (d.callback ? ' (hẹn gọi ' + String(d.callback).split('-').reverse().slice(0, 2).map(Number).join('/') + ')' : '');
  wbQueue(ss, f['Phụ trách'] || ld['Phụ trách'], normPhone(ld['Điện thoại']), ld['Tên'], lt); // tư vấn khách hỏi → cũng ghi vào file sale (sheet chăm sóc)
  return { ok: true, status: st, at: now.getTime(), owner: f['Phụ trách'] || ld['Phụ trách'] };
}

function leadsData(ss) {
  var t = tableOf(leadSheet(ss)), H = t.H;
  return t.rows.filter(function (r) { return r[0]; }).slice(-3000).map(function (r) { return leadObj(r, H); });
}
function leadObj(r, H) {
    var g = function (n) { return r[H.indexOf(n)]; };
    return { id: String(g('Mã')), time: ts(g('Thời gian')), name: String(g('Tên') || ''), phone: normPhone(g('Điện thoại')), channel: String(g('Kênh') || ''), interest: String(g('Quan tâm') || ''),
      status: String(g('Trạng thái') || 'Mới hỏi'), owner: String(g('Phụ trách') || ''), lastAt: ts(g('Lần liên hệ gần nhất')), callback: ts(g('Hẹn liên hệ lại')),
      reason: String(g('Lý do không mua') || ''), note: String(g('Ghi chú') || ''), orderId: String(g('Mã đơn') || ''), by: String(g('Người tạo') || '') };
}
/** Thêm mẫu tin "Khách mới hỏi" 1 lần (quản lý xoá đi thì không thêm lại). */
/* ---------- nhân viên bán & mục tiêu tháng */
/** Chạy 1 lần: điền "NV bán" cho đơn cũ = người đã nhập đơn (theo Nhật ký), không có thì người đang phụ trách khách. */
function backfillSellers(ss) {
  var p = PropertiesService.getScriptProperties(); if (p.getProperty('seller_backfilled')) return;
  var sh = sheet(ss, 'Đơn hàng', ORDER_HEADERS), H = sh.getRange(1, 1, 1, sh.getLastColumn()).getValues()[0];
  var sc = H.indexOf('NV bán'), ic = H.indexOf('Mã đơn'), pc = H.indexOf('Điện thoại');
  if (sc < 0) return;
  if (sh.getLastRow() > 1) {
    var by = {}; tableOf(ss.getSheetByName(LOG_TAB)).rows.forEach(function (r) { if (r[2] === 'Tạo đơn') by[String(r[3]).replace(/^'/, '')] = r[1]; });
    var owners = {}, cs = ss.getSheetByName('Khách hàng');
    if (cs && cs.getLastRow() > 1) cs.getRange(2, 1, cs.getLastRow() - 1, CUS_HEADERS.length).getValues().forEach(function (v) { owners[normPhone(v[0])] = v[C['Phụ trách']]; });
    var vals = sh.getRange(2, 1, sh.getLastRow() - 1, H.length).getValues(), col = [];
    vals.forEach(function (v) { col.push([v[sc] || by[String(v[ic])] || owners[normPhone(v[pc])] || '']); });
    sh.getRange(2, sc + 1, col.length, 1).setValues(col);
  }
  p.setProperty('seller_backfilled', '1');
}

var TARGET_TAB = 'Mục tiêu', TARGET_HEADERS = ['Tháng', 'Nhân viên', 'Mục tiêu doanh số', 'Người đặt', 'Cập nhật lúc'];
function monthKey(v) { return v instanceof Date ? Utilities.formatDate(v, TZ, 'yyyy-MM') : String(v).replace(/^'/, ''); }
function targetsData(ss) {
  var sh = ss.getSheetByName(TARGET_TAB); if (!sh || sh.getLastRow() < 2) return [];
  return sh.getRange(2, 1, sh.getLastRow() - 1, 5).getValues().filter(function (r) { return r[0] && r[1]; }).map(function (r) {
    return { month: monthKey(r[0]), name: String(r[1]), amount: Number(r[2]) || 0, by: String(r[3] || ''), at: ts(r[4]) };
  });
}
/** Đặt mục tiêu doanh số tháng. Nhân viên chỉ đặt cho mình; quản lý đặt / sửa cho mọi người. */
function crmTarget(ss, u, d) {
  var month = String(d.month || ''), amount = Math.round(Number(d.amount) || 0), name = String(d.name || u.name).trim();
  if (!/^\d{4}-\d{2}$/.test(month)) return { ok: false, error: 'Tháng không hợp lệ.' };
  if (amount < 0 || amount > 1e11) return { ok: false, error: 'Số tiền chưa đúng.' };
  if (name !== u.name && u.level < 2) return { ok: false, error: 'Bạn chỉ đặt được mục tiêu của mình.' };
  var sh = sheet(ss, TARGET_TAB, TARGET_HEADERS), row = -1;
  if (sh.getLastRow() > 1) {
    var v = sh.getRange(2, 1, sh.getLastRow() - 1, 2).getValues();
    for (var i = 0; i < v.length; i++) if (monthKey(v[i][0]) === month && String(v[i][1]) === name) { row = i + 2; break; }
  }
  var old = row > 0 ? Number(sh.getRange(row, 3).getValue()) || 0 : 0, vals = ["'" + month, name, amount, u.name, new Date()];
  if (row > 0) sh.getRange(row, 1, 1, 5).setValues([vals]); else sh.appendRow(vals);
  sh.getRange(2, 3, Math.max(sh.getLastRow() - 1, 1), 1).setNumberFormat('#,##0" ₫"');
  crmLog(ss, u, 'Mục tiêu', month, name, fmt(old) + ' → ' + fmt(amount), name !== u.name ? 'quản lý đặt' : '');
  return { ok: true };
}

function ensureLeadTemplate(ss) {
  var p = PropertiesService.getScriptProperties(), sh = ss.getSheetByName('Mẫu tin nhắn CSKH'); if (!sh) return;
  if (!p.getProperty('tpl_lead_added')) { sh.appendRow(LEAD_TPL); p.setProperty('tpl_lead_added', '1'); }
  if (!p.getProperty('tpl_d7_added')) { sh.appendRow(D7_TPL); sh.appendRow(COMMUNITY_TPL); p.setProperty('tpl_d7_added', '1'); } // thêm 1 lần, quản lý sửa chữ trên Sheet
}
var D7_TPL = ['7 ngày sau khi nhận hàng', 'Hỏi thăm, hỗ trợ khi dùng', 'Dạ em chào [Tên] ạ, mình dùng [Sản phẩm] được khoảng 1 tuần rồi. [Tên] dùng có thấy hợp không, có chỗ nào chưa rõ hay cần em hỗ trợ gì không ạ? Em luôn sẵn sàng đồng hành cùng mình ❤️'];
var COMMUNITY_TPL = ['Mời vào cộng đồng', 'Mời vào nhóm Zalo Sống khỏe cùng Thực Dưỡng Lành', 'Dạ [Tên] ơi, Thực Dưỡng Lành có nhóm Zalo “Sống khỏe cùng Thực Dưỡng Lành” – nơi chia sẻ kiến thức dinh dưỡng, thực đơn lành mạnh và thông báo các buổi Zoom miễn phí cùng chuyên gia dinh dưỡng để mình hỏi đáp trực tiếp ạ. [Tên] vào nhóm cùng mọi người nhé: [Link nhóm] ❤️'];

/* ================================================================ ĐỒNG BỘ DỮ LIỆU TỪ FILE SALE & FILE SỐ QUẢNG CÁO */
// Mỗi file sale: chọn sheet + vai trò (Đơn hàng / Khách & chăm sóc / Khách từ chối) + cột nào là gì (CRM tự nhận, quản trị sửa được).
// Đồng bộ nhiều lần không bị trùng: đơn nhận theo mã đơn (hoặc mã tự tạo từ ngày + SĐT + tiền), khách theo SĐT.
var SRC_TAB = 'Nguồn dữ liệu sale', SRC_HEADERS = ['Mã', 'Sale', 'Link file', 'Tên file', 'Cấu hình', 'Lần đồng bộ', 'Kết quả'];
var FIELD_LABEL = { date: 'Ngày', name: 'Tên khách', phone: 'SĐT', address: 'Địa chỉ', product: 'Sản phẩm', qty: 'Số lượng', gift1: 'Quà tặng 1', gift1qty: 'SL quà 1', gift2: 'Quà tặng 2', gift2qty: 'SL quà 2',
  status: 'Trạng thái', ctype: 'Phân loại khách / ca', line: 'Dòng SP (nguồn)', code: 'Mã đơn', amount: 'Số tiền', shipText: 'Lên đơn (mô tả)', callback: 'Lịch gọi lại', note: 'Ghi chú / nhật ký', health: 'Tình trạng sức khoẻ',
  sale: 'Sale được chia', dup: 'Trùng sale', src: 'Nguồn quảng cáo' };

/** Quyền đọc file khác (chạy 1 lần trong trình soạn Apps Script để cấp quyền). */
function capQuyenDocFile() { SpreadsheetApp.openById(SpreadsheetApp.getActiveSpreadsheet().getId()); Logger.log('Tài khoản chạy CRM: ' + Session.getEffectiveUser().getEmail()); }

function fileIdOf(url) { var m = String(url || '').match(/\/d\/([a-zA-Z0-9_-]{20,})/) || String(url || '').match(/^([a-zA-Z0-9_-]{25,})$/); return m ? m[1] : ''; }
function nrm(s) { return String(s == null ? '' : s).toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/đ/g, 'd').replace(/\s+/g, ' ').trim(); }
function colLetter(i) { var s = ''; i++; while (i > 0) { var m = (i - 1) % 26; s = String.fromCharCode(65 + m) + s; i = Math.floor((i - 1) / 26); } return s; }
function cellText(v) { if (v instanceof Date) return Utilities.formatDate(v, TZ, 'dd/MM/yyyy'); return String(v == null ? '' : v); }
function avgLen(S, i) { var n = 0, t = 0; S.forEach(function (r) { var v = r[i]; if (v !== '' && v != null && !(v instanceof Date)) { n++; t += String(v).length; } }); return n ? t / n : 0; }
function isDateLike(v) { return v instanceof Date || /^\d{1,2}\/\d{1,2}(\/\d{2,4})?/.test(String(v || '').trim()); }
function hashKey(s) { return Utilities.computeDigest(Utilities.DigestAlgorithm.MD5, s).slice(0, 6).map(function (b) { return ('0' + (b & 255).toString(16)).slice(-2); }).join(''); }

/** Đoán cột theo tiêu đề + dữ liệu mẫu. */
function detectMap(H, S, sheetName, ads) {
  var m = {}, used = {}, h = H.map(nrm);
  var find = function (re, from) { for (var i = from || 0; i < h.length; i++) if (!used[i] && re.test(h[i])) return i; return -1; };
  var set = function (k, i) { if (i >= 0 && i < H.length) { m[k] = i; used[i] = 1; } };
  set('phone', find(/sdt|so dt|dien thoai|so dien/));
  set('name', find(/^ten|ho ten|khach hang/));
  if (ads) {
    set('src', find(/^nguon/)); set('sale', find(/^sale/)); set('dup', find(/trung/)); set('ctype', find(/^nguon|phan loai/)); set('amount', find(/don hang|so tien/)); set('note', find(/ghi chu/));
  } else {
    set('code', find(/ma don/)); set('amount', find(/so tien|thanh tien|tong tien/)); set('status', find(/tra?n?g thai/)); set('ctype', find(/phan loai khach/));
    set('line', find(/phan loai nguon|dong sp|^nguon/)); set('shipText', find(/^len don$/)); set('callback', find(/lich goi lai|hen goi/)); set('address', find(/dia chi/)); set('health', find(/tinh trang sk|suc khoe/));
    var p = find(/san pham/); set('product', p); if (p >= 0) set('qty', find(/so l[uo]+ng|^sl$/, p + 1));
    var g1 = find(/qua tang/); set('gift1', g1); if (g1 >= 0) set('gift1qty', find(/so l[uo]+ng|^sl$/, g1 + 1));
    var g2 = find(/qua tang/); set('gift2', g2); if (g2 >= 0) set('gift2qty', find(/so l[uo]+ng|^sl$/, g2 + 1));
    if (m.gift1 === undefined && m.qty !== undefined && !h[m.qty + 1] && avgLen(S, m.qty + 1) > 3) { set('gift1', m.qty + 1); if (!h[m.qty + 2]) set('gift1qty', m.qty + 2); }
    set('note', find(/ghi chu/));
    if (m.address === undefined && m.phone !== undefined && !used[m.phone + 1] && avgLen(S, m.phone + 1) > 15) set('address', m.phone + 1);
  }
  var d = find(/thoi gian|^ngay/); if (d < 0 && !used[0] && S.filter(function (r) { return isDateLike(r[0]); }).length >= Math.min(2, S.length)) d = 0; set('date', d);
  if (!ads) { // ghi chú: cột chữ dài nhất còn lại nếu cột "ghi chú" gần như trống
    var best = -1, bl = 0; for (var i = 0; i < H.length; i++) if (!used[i]) { var l = avgLen(S, i); if (l > bl) { bl = l; best = i; } }
    if ((m.note === undefined || avgLen(S, m.note) < 5) && best >= 0 && bl > 20) { if (m.note !== undefined) delete used[m.note]; m.note = best; used[best] = 1; }
    // cột "ghi chú" thực chất là mô tả lên đơn ("4 hộp …", "7 lon …") → dùng làm Lên đơn
    if (m.note !== undefined && m.shipText === undefined) { var sv = S.map(function (r) { return String(r[m.note] || ''); }).filter(String); if (sv.length && sv.filter(function (x) { return /^\d+\s*(hộp|hop|lon|gói|goi|hũ|hu|chai|thùng|thung|túi)/i.test(x); }).length >= sv.length * 0.6) { m.shipText = m.note; delete m.note; } }
  }
  var role = ads ? (m.phone !== undefined ? 'ads' : 'skip') : /tu choi|bom/.test(nrm(sheetName)) ? 'reject' : m.code !== undefined && m.product !== undefined ? 'orders' : m.phone !== undefined && m.name !== undefined ? 'care' : 'skip';
  return { map: m, role: role };
}

/* ---------- đọc file bằng Google Sheets API (dịch vụ nâng cao "Sheets"): chỉ lấy giá trị, không phải mở cả file → nhanh hơn nhiều, không bị quá giờ */
function hasSheetsApi() { try { return typeof Sheets !== 'undefined' && !!Sheets.Spreadsheets; } catch (e) { return false; } }
function a1(name, range) { return "'" + String(name).replace(/'/g, "''") + "'" + (range ? '!' + range : ''); }
function padRow(r, n) { r = (r || []).slice(0, n); while (r.length < n) r.push(''); return r; }
function isSerial(v) { return typeof v === 'number' && v > 20000 && v < 80000; }
function serialDate(v) { return new Date(Math.round((v - 25569) * 864e5 - 7 * 3600e3)); } // số sê-ri ngày của Sheet (giờ VN) → Date
function noAccess(id) { return 'CRM chưa mở được file này. Chủ file cần chia sẻ quyền xem cho tài khoản chạy CRM (' + Session.getEffectiveUser().getEmail() + ').'; }
function inspectFast(d, ads, id) {
  var meta; try { meta = Sheets.Spreadsheets.get(id, { fields: 'properties.title,sheets.properties.title' }); } catch (e) { return { ok: false, error: noAccess(id) }; }
  var isReport = function (nm) { return /^(bcdt|bao cao|bc )/.test(nrm(nm)); }, fileName = meta.properties.title;
  var names = (meta.sheets || []).slice(0, 60).map(function (x) { return x.properties.title; });
  if (d.list) return { ok: true, fileId: id, fileName: fileName, sheets: names.map(function (nm) { return { name: nm, report: isReport(nm) }; }), fields: FIELD_LABEL };
  var out = (d.sheet ? names.filter(function (n) { return n === d.sheet; }) : names).map(function (nm) {
    if (!d.sheet && isReport(nm)) return { name: nm, rows: '', role: 'skip', headers: [], unread: true };
    // chỉ đọc 4 cột đầu để biết dòng cuối, rồi lấy 8 dòng đầu + vài dòng cuối (sheet hàng chục nghìn dòng vẫn nhanh)
    var narrow = Sheets.Spreadsheets.Values.get(id, a1(nm, 'A1:D'), { valueRenderOption: 'UNFORMATTED_VALUE' }).values || [], lr = narrow.length;
    var head = lr ? Sheets.Spreadsheets.Values.get(id, a1(nm, 'A1:AD8'), { valueRenderOption: 'FORMATTED_VALUE' }).values || [] : [];
    var tailRows = lr > 8 ? Sheets.Spreadsheets.Values.get(id, a1(nm, 'A' + Math.max(9, lr - 12) + ':AD' + lr), { valueRenderOption: 'FORMATTED_VALUE' }).values || [] : [];
    var rows = head.concat(lr > 8 ? new Array(Math.max(0, Math.max(9, lr - 12) - 9)) : []).concat(tailRows).map(function (r) { return r || []; });
    var lc = 0; head.concat(tailRows).forEach(function (r) { lc = Math.max(lc, (r || []).length); }); lc = Math.min(lc, 30);
    if (lr < 2 || lc < 2) return { name: nm, rows: lr, role: 'skip', headers: [] };
    var top = rows.slice(0, 8).map(function (r) { return padRow(r, lc); }), hr = -1;
    for (var i = 0; i < Math.min(5, top.length); i++) { var t = top[i].map(nrm).join('|'); if (/sdt|dien thoai/.test(t) && /ten|khach/.test(t)) { hr = i; break; } }
    if (hr < 0) return { name: nm, rows: lr, role: 'skip', headers: [] };
    var H = top[hr].map(cellText), n = Math.min(lr - hr - 1, 6);
    var tail = lr - hr - 1 > 6 ? rows.slice(Math.max(hr + 1 + n, lr - 12)).filter(function (r) { return r.some(function (c) { return c !== '' && c != null; }); }).slice(-4).map(function (r) { return padRow(r, lc); }) : [];
    var S = top.slice(hr + 1, hr + 1 + n).concat(tail), det = detectMap(H, S, nm, ads);
    return { name: nm, rows: lr - hr - 1, header: hr + 1, headers: H.map(function (x, k) { return colLetter(k) + (x ? ' · ' + x : ''); }), samples: S.map(function (r) { return r.map(function (c) { return cellText(c).slice(0, 60); }); }), role: det.role, map: det.map };
  });
  return { ok: true, fileId: id, fileName: fileName, sheets: out, fields: FIELD_LABEL };
}

/** Xem file: danh sách sheet, dòng tiêu đề, cột đoán được, vài dòng mẫu. */
function crmSrcInspect(d, ads) {
  var id = fileIdOf(d.url); if (!id) return { ok: false, error: 'Link file Google Sheet chưa đúng.' };
  if (hasSheetsApi()) return inspectFast(d, ads, id);
  var f; try { f = SpreadsheetApp.openById(id); } catch (e) { return { ok: false, error: 'CRM chưa mở được file này. Chủ file cần chia sẻ quyền xem cho tài khoản chạy CRM (' + Session.getEffectiveUser().getEmail() + ').' }; }
  var isReport = function (nm) { return /^(bcdt|bao cao|bc )/.test(nrm(nm)); }; // sheet báo cáo: không cần đọc (chậm vì nhiều công thức)
  if (d.list) return { ok: true, fileId: id, fileName: f.getName(), sheets: f.getSheets().slice(0, 60).map(function (ws) { var nm = ws.getName(); return { name: nm, report: isReport(nm) }; }), fields: FIELD_LABEL };
  var list = d.sheet ? [f.getSheetByName(d.sheet)].filter(Boolean) : f.getSheets().slice(0, 60);
  var out = list.map(function (ws) {
    var nm = ws.getName();
    if (!d.sheet && isReport(nm)) return { name: nm, rows: '', role: 'skip', headers: [], unread: true };
    var lr = ws.getLastRow(), lc = Math.min(ws.getLastColumn(), 30); if (lr < 2 || lc < 2) return { name: nm, rows: lr, role: 'skip', headers: [] };
    var top = ws.getRange(1, 1, Math.min(8, lr), lc).getValues(), hr = -1;
    for (var i = 0; i < Math.min(5, top.length); i++) { var t = top[i].map(nrm).join('|'); if (/sdt|dien thoai/.test(t) && /ten|khach/.test(t)) { hr = i; break; } }
    if (hr < 0) return { name: ws.getName(), rows: lr, role: 'skip', headers: [] };
    var H = top[hr].map(cellText), n = Math.min(lr - hr - 1, 6);
    var tail = lr - hr - 1 > 6 ? ws.getRange(Math.max(hr + 2, lr - 12), 1, Math.min(13, lr - hr - 1), lc).getValues().filter(function (r) { return r.some(function (c) { return c !== ''; }); }).slice(-4) : [];
    var S = top.slice(hr + 1, hr + 1 + n).concat(tail);
    var det = detectMap(H, S, ws.getName(), ads);
    return { name: ws.getName(), rows: lr - hr - 1, header: hr + 1, headers: H.map(function (x, k) { return colLetter(k) + (x ? ' · ' + x : ''); }), samples: S.map(function (r) { return r.map(function (c) { return cellText(c).slice(0, 60); }); }), role: det.role, map: det.map };
  });
  return { ok: true, fileId: id, fileName: f.getName(), sheets: out, fields: FIELD_LABEL };
}

/* ---------- danh sách nguồn (file sale) */
function srcSheet(ss) { return sheet(ss, SRC_TAB, SRC_HEADERS); }
function srcList(ss) {
  var sh = ss.getSheetByName(SRC_TAB); if (!sh || sh.getLastRow() < 2) return [];
  return sh.getRange(2, 1, sh.getLastRow() - 1, SRC_HEADERS.length).getValues().filter(function (r) { return r[0]; }).map(function (r, i) {
    var cfg = {}; try { cfg = JSON.parse(r[4] || '{}'); } catch (e) { }
    return { id: String(r[0]), sale: String(r[1]), url: String(r[2]), fileName: String(r[3]), cfg: cfg, last: ts(r[5]), result: String(r[6] || ''), row: i + 2 };
  });
}
function crmSrcSave(ss, u, d) {
  var sh = srcSheet(ss), list = srcList(ss), id = d.id || 'SRC' + Date.now().toString(36);
  var cur = list.filter(function (x) { return x.id === id; })[0];
  var cfg = d.cfg || (cur && cur.cfg) || {}; if (cur && cur.cfg && cur.cfg.done && !cfg.done) cfg.done = cur.cfg.done;
  var row = [id, d.sale || (cur && cur.sale) || '', d.url || (cur && cur.url) || '', d.fileName || (cur && cur.fileName) || '', JSON.stringify(cfg), cur ? cur.last ? new Date(cur.last) : '' : '', cur ? cur.result : ''];
  if (cur) sh.getRange(cur.row, 1, 1, SRC_HEADERS.length).setValues([row]); else sh.appendRow(row);
  crmLog(ss, u, 'Nguồn dữ liệu', id, row[1], cur ? 'Sửa cấu hình' : 'Thêm file ' + row[3], '');
  wbTrigger(ss);
  return { ok: true, id: id };
}

/* ---------- ghi ngược kết quả chăm sóc vào file của sale (ô ghi chú sheet "cop số"), đúng kiểu sale tự ghi: ", 30/9 knm"
 * Bấm trên CRM chỉ xếp hàng (nhanh); cứ 5 phút writeBackTick ghi 1 lượt. Cần sale chia sẻ quyền CHỈNH SỬA file cho tài khoản chạy CRM. */
var WB_TAB = 'Ghi ngược file sale', WB_HEADERS = ['Thời gian', 'Mã nguồn', 'SĐT', 'Tên', 'Nội dung', 'Kết quả'];
var WB_SHORT = { 'Không nghe máy': 'knm', 'Đã hỏi thăm': 'đã hỏi thăm', 'Hẹn gọi lại': 'hẹn gọi lại', 'Đã đặt lại': 'kh đặt lại', 'Không có nhu cầu': 'kh không có nhu cầu' };
function wbSource(ss, owner, orders) { return srcList(ss).filter(function (x) { return x.cfg.writeBack && x.sale === owner && (orders ? !!wbOrderSheet(x) : (x.cfg.sheets || []).some(function (s) { return s.role === 'care' && s.map && s.map.phone !== undefined && s.map.note !== undefined; })); })[0]; }
/** Sheet lên đơn của sale để ghi ngược đơn tạo trên CRM: cfg.orderSheet nếu quản trị chọn; không thì sheet vai trò "Đơn hàng" sale đang dùng
 *  (có ngày đơn mới nhất, vd Phương: VTG_lendon chứ không phải "lên đơn" cũ). Nhớ 6 tiếng cho đỡ đọc file. */
function wbOrderSheet(src, pick) {
  var os = (src.cfg.sheets || []).filter(function (s) { return s.role === 'orders' && s.map && s.map.phone !== undefined; });
  if (!os.length) return null;
  var byName = function (n) { return os.filter(function (s) { return s.name === n; })[0]; };
  if (src.cfg.orderSheet && byName(src.cfg.orderSheet)) return byName(src.cfg.orderSheet);
  if (os.length === 1 || !pick) return os[os.length - 1];
  var c = CacheService.getScriptCache(), ck = 'wbos_' + src.id, hit = c.get(ck); if (hit && byName(hit)) return byName(hit);
  var best = os[os.length - 1], bt = -1;
  os.forEach(function (sc) {
    if (sc.map.date === undefined) return;
    try {
      var col = colLetter(+sc.map.date), hr = sc.header || 1, vals;
      if (hasSheetsApi()) vals = (Sheets.Spreadsheets.Values.get(fileIdOf(src.url), a1(sc.name, col + (hr + 1) + ':' + col), { valueRenderOption: 'UNFORMATTED_VALUE' }).values || []).map(function (r) { return isSerial(r[0]) ? serialDate(r[0]) : r[0]; });
      else { var ws = SpreadsheetApp.openById(fileIdOf(src.url)).getSheetByName(sc.name), n = Math.max(ws.getLastRow() - hr, 0); vals = n ? ws.getRange(hr + 1, +sc.map.date + 1, n, 1).getValues().map(function (r) { return r[0]; }) : []; }
      var ctx = {}, t = 0; vals.forEach(function (v) { var d = toDate(v, ctx); if (d && d.getTime() > t) t = d.getTime(); });
      if (t > bt) { bt = t; best = sc; }
    } catch (e) { console.error('wbOrderSheet', sc.name, e); }
  });
  c.put(ck, best.name, 21600); return best;
}
var WB_ORDER = '@order ', WB_OST = '@ost '; // lệnh ghi ngược đơn: thêm dòng đơn mới / đổi trạng thái đơn trong sheet lên đơn của sale
var WB_ST = { 'Mới': 'Đã lên đơn', 'Đã xác nhận': 'Đã lên đơn', 'Đang giao': 'Đang giao', 'Đã giao': 'Giao thành công', 'Huỷ': 'Huỷ', 'Hoàn': 'Hoàn', 'Đổi hàng': 'Đổi hàng' }; // chữ quen dùng trong file sale (CRM đọc lại hiểu đúng)
/** Đơn tạo trên CRM → xếp hàng ghi vào sheet lên đơn của sale. */
function wbOrderQueue(ss, owner, o) {
  var src = owner && wbSource(ss, owner, true); if (!src) return;
  sheet(ss, WB_TAB, WB_HEADERS).appendRow([new Date(), src.id, "'" + o.phone, o.name || '', WB_ORDER + JSON.stringify(o), '']);
}
function wbStatusQueue(ss, owners, o) { // owners: [người bán, người phụ trách khách] – ai có file sale bật ghi ngược thì ghi vào file đó
  var src = null; (owners || []).forEach(function (w) { if (!src && w) src = wbSource(ss, w, true); }); if (!src) return;
  sheet(ss, WB_TAB, WB_HEADERS).appendRow([new Date(), src.id, "'" + o.phone, o.name || '', WB_OST + JSON.stringify(o), '']);
}
/** Ghi các lệnh đơn vào sheet lên đơn: thêm dòng đơn mới (đúng cột sale đang dùng) / sửa ô trạng thái của đúng dòng đơn. */
function wbOrderWrite(src, items) {
  var def = wbOrderSheet(src, true); if (!def) return items.map(function () { return 'Bỏ qua: chưa chọn sheet lên đơn'; });
  var groups = {}, res = [];
  items.forEach(function (it, i) { // đơn nhập từ sheet nào thì ghi trạng thái vào đúng sheet đó; đơn tạo trên CRM → sheet đang dùng
    var o = {}; try { o = JSON.parse(it.text.replace(/^@\w+ /, '')); } catch (e) { }
    var sc = (o.sheet && (src.cfg.sheets || []).filter(function (s) { return s.role === 'orders' && s.name === o.sheet && s.map && s.map.phone !== undefined; })[0]) || def;
    (groups[sc.name] = groups[sc.name] || { sc: sc, idx: [] }).idx.push(i);
  });
  Object.keys(groups).forEach(function (n) { var g = groups[n], r = wbOrderWriteSheet(src, g.sc, g.idx.map(function (i) { return items[i]; })); g.idx.forEach(function (i, k) { res[i] = r[k]; }); });
  return res;
}
function wbOrderWriteSheet(src, sc, items) {
  var id = fileIdOf(src.url), m = sc.map, hr = sc.header || 1, width = neededCols(sc), out = [], add = [], upd = {}, rows = null, added = {};
  var has = function (k) { return m[k] !== undefined && m[k] !== null && m[k] !== ''; };
  var readRows = function () { // đọc 1 lần các cột cần để tìm dòng đơn
    if (rows) return rows;
    if (hasSheetsApi()) { var v = Sheets.Spreadsheets.Values.get(id, a1(sc.name, 'A' + (hr + 1) + ':' + colLetter(width - 1)), { valueRenderOption: 'UNFORMATTED_VALUE' }).values || []; rows = v.map(function (r) { r = padRow(r, width); if (has('date') && isSerial(r[+m.date])) r[+m.date] = serialDate(r[+m.date]); return r; }); }
    else { var ws = SpreadsheetApp.openById(id).getSheetByName(sc.name), n = Math.max(ws.getLastRow() - hr, 0); rows = n ? ws.getRange(hr + 1, 1, n, width).getValues() : []; }
    return rows;
  };
  var day = function (v) { var d = v instanceof Date ? v : toDate(v, {}); return d ? Utilities.formatDate(d, TZ, 'yyyyMMdd') : ''; };
  items.forEach(function (it) {
    var o = {}; try { o = JSON.parse(it.text.replace(/^@\w+ /, '')); } catch (e) { out.push('Lỗi: lệnh hỏng'); return; }
    if (it.text.indexOf(WB_ORDER) === 0) {
      var r = []; for (var k = 0; k < width; k++) r.push('');
      var put = function (f, v) { if (has(f) && v !== undefined && v !== '') r[+m[f]] = v; };
      put('date', Utilities.formatDate(new Date(o.time), TZ, 'dd/MM/yyyy')); put('code', o.id); put('name', o.name); put('phone', o.phone); put('address', o.address);
      put('product', o.product); put('qty', o.qty); put('gift1', o.gift); put('gift1qty', o.giftQty); put('amount', o.total); put('status', WB_ST[o.status] || 'Đã lên đơn');
      put('shipText', o.ship); put('note', o.note); put('ctype', o.otype === 'Khách cũ' ? 'kh cũ' : o.otype === 'Khách mới' ? 'kh mới' : (o.old ? 'kh cũ' : 'kh mới') + (o.otype === 'Ngoài giờ' || o.ca === 'Tối/CN' ? ' tối' : o.otype === 'Ngày lễ' || o.ca === 'Lễ' ? ' lễ' : '')); // “Phân loại khách / ca” như sale vẫn ghi
      added[o.id] = r; add.push(r); out.push('Đã thêm đơn ' + o.id + ' vào sheet ' + sc.name); return;
    }
    if (!has('status')) { out.push('Bỏ qua: sheet lên đơn chưa chọn cột trạng thái'); return; } // đổi trạng thái
    if (added[o.id]) { added[o.id][+m.status] = WB_ST[o.status] || o.status; out.push('Đã ghi trạng thái (đơn vừa thêm): ' + added[o.id][+m.status]); return; } // đơn thêm cùng lượt
    var R = readRows(), hit = -1;
    for (var i = R.length - 1; i >= 0 && hit < 0; i--) { var rr = R[i]; if (has('code') && String(rr[+m.code]).trim() === o.id) hit = i; }
    if (hit < 0) for (var j = R.length - 1; j >= 0 && hit < 0; j--) { var r2 = R[j]; if (toPhone(r2[+m.phone]) === o.phone && day(has('date') ? r2[+m.date] : '') === day(new Date(o.time)) && (!has('amount') || !o.total || toMoney(r2[+m.amount]) === o.total)) hit = j; }
    if (hit < 0) { out.push('Bỏ qua: không thấy đơn ' + o.id + ' trong file'); return; }
    upd[hit] = WB_ST[o.status] || o.status; out.push('Đã ghi trạng thái dòng ' + (hr + 1 + hit) + ': ' + upd[hit]);
  });
  if (hasSheetsApi()) {
    var data = Object.keys(upd).map(function (i) { return { range: a1(sc.name, colLetter(+m.status) + (hr + 1 + +i)), values: [[upd[i]]] }; });
    if (data.length) Sheets.Spreadsheets.Values.batchUpdate({ valueInputOption: 'RAW', data: data }, id);
    if (add.length) Sheets.Spreadsheets.Values.append({ values: add }, id, a1(sc.name, 'A' + hr), { valueInputOption: 'USER_ENTERED', insertDataOption: 'INSERT_ROWS' });
  } else {
    var ws2 = SpreadsheetApp.openById(id).getSheetByName(sc.name);
    Object.keys(upd).forEach(function (i) { ws2.getRange(hr + 1 + +i, +m.status + 1).setValue(upd[i]); });
    add.forEach(function (r) { ws2.appendRow(r); });
  }
  return out;
}
var WB_ZALO = '@zalo'; // lệnh đặc biệt: thêm "(x)" vào tên khách trong file sale (= đã kết bạn Zalo)
function wbQueue(ss, owner, phone, name, text, raw) {
  text = String(text || '').replace(/\s+/g, ' ').trim(); if (!text || !owner) return;
  var src = wbSource(ss, owner); if (!src) return;
  sheet(ss, WB_TAB, WB_HEADERS).appendRow([new Date(), src.id, "'" + phone, name || '', raw ? text : Utilities.formatDate(new Date(), TZ, 'd/M') + ' ' + text, '']);
}
function wbTrigger(ss) {
  var list = srcList(ss), all = ScriptApp.getProjectTriggers(), of = function (fn) { return all.filter(function (t) { return t.getHandlerFunction() === fn; }); };
  var on = list.some(function (x) { return x.cfg.writeBack; }), has = of('writeBackTick');
  if (on && !has.length) ScriptApp.newTrigger('writeBackTick').timeBased().everyMinutes(5).create();
  if (!on) has.forEach(function (t) { ScriptApp.deleteTrigger(t); });
  var au = list.some(function (x) { return x.cfg.autoSync; }), ha = of('srcAutoTick'), pp = PropertiesService.getScriptProperties(); // tự nhập file sale 30 phút/lần (7h–21h)
  if (au && ha.length && pp.getProperty('auto_tick_v') !== '30m') { ha.forEach(function (t) { ScriptApp.deleteTrigger(t); }); ha = []; } // lịch cũ 7h sáng → đổi sang 30 phút
  if (au && !ha.length) { ScriptApp.newTrigger('srcAutoTick').timeBased().everyMinutes(30).create(); pp.setProperty('auto_tick_v', '30m'); }
  if (!au) { ha.forEach(function (t) { ScriptApp.deleteTrigger(t); }); pp.setProperty('auto_tick_v', '30m'); }
}
/** Tự nhập file sale 30 phút/lần (7h–21h): đơn mới, trạng thái đơn, ghi chú → CRM. Có thay đổi mới tính lại khách (đỡ chậm CRM).
 *  Mỗi lần chạy ghi 1 dòng vào tab "Tự nhập file sale" để đo; Telegram cho quản trị: bản tóm tắt lần đầu trong ngày + khi có lỗi. Chạy tay được để thử. */
var AUTO_TAB = 'Tự nhập file sale', AUTO_HEADERS = ['Thời gian', 'Sale', 'Chạy (giây)', 'Đơn mới', 'Cập nhật trạng thái', 'Ghi chú mới (khách)', 'Khách hỏi mới', 'Chi tiết / lỗi'];
function srcAutoTick(force) {
  var pp = PropertiesService.getScriptProperties(); if (pp.getProperty('retired')) return;
  var h = Number(Utilities.formatDate(new Date(), TZ, 'H')); if (force !== true && (h < 7 || h > 21)) return;
  var ss = SpreadsheetApp.getActiveSpreadsheet(), u = { name: 'Tự động', level: 3, email: '' }, t0 = Date.now(), out = [], errs = 0, changed = false, ROLE_ORDER = { orders: 0, care: 1, reject: 2 };
  srcList(ss).filter(function (x) { return x.cfg.autoSync; }).forEach(function (src) {
    var lines = [], st = { orders: 0, upd: 0, notes: 0, leads: 0, err: [] }, t1 = Date.now();
    (src.cfg.sheets || []).filter(function (s) { return s.role && s.role !== 'skip'; }).sort(function (a, b) { return ROLE_ORDER[a.role] - ROLE_ORDER[b.role]; }).forEach(function (sc) {
      if (Date.now() - t0 > 270e3) { lines.push(sc.name + ': để lượt sau (hết giờ)'); st.err.push(sc.name + ': hết giờ'); return; } // Apps Script chạy tối đa 6 phút
      try {
        var r = crmSrcSync(ss, u, sc.role === 'orders' ? { id: src.id, name: sc.name, limit: 1e6, offset: 0 } : { id: src.id, name: sc.name });
        if (r.ok) { lines.push(sc.name + ': ' + r.summary); st.orders += r.newOrders || 0; st.upd += r.updated || 0; st.notes += r.notes || 0; st.leads += (r.newLeads || 0) + (r.flagged || 0); }
        else { lines.push(sc.name + ': ' + r.error); st.err.push(sc.name + ': ' + r.error); }
      } catch (e) { lines.push(sc.name + ': LỖI ' + String(e.message || e).slice(0, 120)); st.err.push(sc.name + ': ' + String(e.message || e).slice(0, 120)); }
      if (sc.role === 'care' && Date.now() - t0 < 270e3) { try { var on = syncOldNotes(ss, src, sc); st.notes += on.customers; if (on.customers) lines.push(sc.name + ': ' + on.customers + ' khách có ghi chú mới viết thêm trên dòng cũ (' + on.lines + ' dòng) → đã đưa lên CRM'); } catch (e) { lines.push(sc.name + ' (ghi chú dòng cũ): LỖI ' + String(e.message || e).slice(0, 120)); st.err.push('ghi chú dòng cũ: ' + String(e.message || e).slice(0, 80)); } }
    });
    var any = st.orders || st.upd || st.notes || st.leads;
    if (any) { changed = true; try { crmSrcFinish(ss, u, { id: src.id }); } catch (e) { lines.push('Tính lại khách: LỖI ' + e.message); st.err.push('Tính lại khách: ' + e.message); } } // không có gì mới → không tính lại khách
    errs += st.err.length;
    try { var lt = sheet(ss, AUTO_TAB, AUTO_HEADERS); lt.appendRow([new Date(), src.sale, Math.round((Date.now() - t1) / 100) / 10, st.orders, st.upd, st.notes, st.leads, st.err.join(' · ')]); if (lt.getLastRow() > 1500) lt.deleteRows(2, lt.getLastRow() - 1000); } catch (e) { console.error('auto log', e); }
    out.push('📂 <b>' + esc(src.sale) + '</b> – ' + st.orders + ' đơn mới\n' + lines.map(function (l) { return '• ' + esc(l); }).join('\n'));
  });
  if (!out.length) return;
  if (changed) dataChanged();
  var day = Utilities.formatDate(new Date(), TZ, 'yyMMdd'), first = pp.getProperty('auto_tg_day') !== day;
  if (first || errs) { var ad = crmUser(ss, SUPER_ADMIN); if (ad && ad.tg) telegramTo(ad.tg, (first ? '🕖 <b>Tự nhập file sale – lần đầu hôm nay</b> (sau đó tự chạy 30 phút/lần, xem tab "' + AUTO_TAB + '")' : '⚠️ <b>Tự nhập file sale có lỗi</b>') + '\n\n' + out.join('\n\n')); pp.setProperty('auto_tg_day', day); }
}
/** Sale viết thêm ghi chú vào DÒNG CŨ trong sheet chăm sóc (vd "cop số") → đưa phần mới lên CRM (lần nhập thường chỉ đọc dòng mới).
 *  Chỉ lấy ghi chú có ngày trong 60 ngày gần đây; bỏ ghi chú CRM đã có, và bỏ dòng do chính CRM ghi ngược vào file. */
/** Nội dung CRM đã ghi ngược vào file của sale (theo SĐT, dạng khoá so sánh) → lúc nhập file không nhập lại chính những dòng đó. */
function wbKeys(ss, srcId) {
  var wb = {}, q = ss.getSheetByName(WB_TAB), now = Date.now(), key = function (t) { return nrm(t).replace(/[^a-z0-9]+/g, ' ').trim(); };
  if (q && q.getLastRow() > 1) q.getRange(2, 1, q.getLastRow() - 1, WB_HEADERS.length).getValues().forEach(function (r) {
    var t = String(r[4] || ''); if (String(r[1]) !== srcId || t.charAt(0) === '@') return; var ph = normPhone(r[2]);
    splitNote(t, null, now).forEach(function (e) { (wb[ph] = wb[ph] || []).push(key(e.text)); }); (wb[ph] = wb[ph] || []).push(key(t.replace(/^[\d\/\s]+/, '')));
  });
  return wb;
}
function wbHas(wb, ph, text) { var k = nrm(text).replace(/[^a-z0-9]+/g, ' ').trim(); return !!k && (wb[ph] || []).some(function (w) { return w && (w === k || w.indexOf(k) >= 0 || k.indexOf(w) >= 0); }); }
function syncOldNotes(ss, src, shCfg, data) {
  var m = shCfg.map || {}; if (m.phone === undefined || m.note === undefined) return { customers: 0, lines: 0 };
  data = data || srcRows(src, shCfg);
  var now = Date.now(), from = now - 60 * 864e5, ctx = {}, per = {}, key = function (t) { return nrm(t).replace(/[^a-z0-9]+/g, ' ').trim(); };
  data.rows.forEach(function (r) {
    var when = toDate(cell(r, m, 'date'), ctx), phone = toPhone(cell(r, m, 'phone')); if (!phone) return;
    splitNote(String(cell(r, m, 'note') || ''), when ? when.getTime() : null, now).forEach(function (e) { if (e.t && e.t >= from && e.t <= now + 864e5 && key(e.text).length >= 2) (per[phone] = per[phone] || []).push(e); });
  });
  var wb = wbKeys(ss, src.id); // dòng CRM đã ghi ngược vào file: không nhập lại
  var cs = ss.getSheetByName('Khách hàng'); if (!cs || cs.getLastRow() < 2) return { customers: 0, lines: 0 };
  var rg = cs.getRange(2, 1, cs.getLastRow() - 1, CUS_HEADERS.length), v = rg.getValues(), nC = 0, nL = 0;
  v.forEach(function (row) {
    var ph = normPhone(row[0]), es = per[ph]; if (!es || (row[C['Phụ trách']] && row[C['Phụ trách']] !== src.sale)) return;
    var cur = String(row[C['Ghi chú CSKH']] || ''), kc = ' ' + key(cur) + ' ', seen = {}, add = [];
    es.forEach(function (e) {
      var k = key(e.text), kd = key(Utilities.formatDate(new Date(e.t), TZ, 'dd/MM/yy') + ' ' + e.text); // so theo NGÀY + nội dung (“knm” ngày khác vẫn là ghi chú mới)
      if (seen[kd] || kc.indexOf(' ' + kd + ' ') >= 0) return; seen[kd] = 1;
      if ((wb[ph] || []).some(function (w) { return w && (w === k || w.indexOf(k) >= 0 || k.indexOf(w) >= 0); })) return;
      add.push(e);
    });
    if (!add.length) return;
    add.sort(function (a, b) { return b.t - a.t; });
    row[C['Ghi chú CSKH']] = (add.map(function (e) { return Utilities.formatDate(new Date(e.t), TZ, 'dd/MM/yy') + ': ' + e.text; }).join('\n') + (cur ? '\n' + cur : '')).slice(0, 45000);
    var rp = add.filter(function (e) { return e.res && e.res !== 'Không nghe máy'; })[0], ca = row[C['Lần CSKH gần nhất']] ? new Date(row[C['Lần CSKH gần nhất']]).getTime() : 0;
    if (rp && rp.t > ca) { row[C['Lần CSKH gần nhất']] = new Date(rp.t); row[C['Kết quả CSKH']] = rp.res; } // khách đã trả lời (ghi trên file) → mốc chăm sóc tính là đã làm
    nC++; nL += add.length;
  });
  if (nC) { var cols = [C['Ghi chú CSKH'], C['Lần CSKH gần nhất'], C['Kết quả CSKH']]; cols.forEach(function (ci) { cs.getRange(2, ci + 1, v.length, 1).setValues(v.map(function (r) { return [r[ci]]; })); }); dataChanged(); }
  return { customers: nC, lines: nL };
}
function writeBackTick() {
  if (PropertiesService.getScriptProperties().getProperty('retired')) return;
  var ss = SpreadsheetApp.getActiveSpreadsheet(), q = ss.getSheetByName(WB_TAB); if (!q || q.getLastRow() < 2) return;
  var rg = q.getRange(2, 1, q.getLastRow() - 1, WB_HEADERS.length), v = rg.getValues(), bySrc = {};
  v.forEach(function (r, i) { if (r[1] && (!r[5] || (/^Lỗi/.test(r[5]) && Date.now() - new Date(r[0]).getTime() < 7 * 864e5))) (bySrc[r[1]] = bySrc[r[1]] || []).push(i); }); // lỗi (vd chưa có quyền sửa) thử lại trong 7 ngày
  var srcs = {}; srcList(ss).forEach(function (x) { srcs[x.id] = x; });
  Object.keys(bySrc).forEach(function (id) {
    var idx = bySrc[id], res;
    try { res = wbWrite(srcs[id], idx.map(function (i) { return { phone: normPhone(v[i][2]), name: String(v[i][3] || ''), text: String(v[i][4]) }; })); }
    catch (e) { var msg = /permission|does not have|forbidden|403/i.test(String(e)) ? 'chưa có quyền chỉnh sửa file, nhờ sale chia sẻ quyền Chỉnh sửa cho ' + Session.getEffectiveUser().getEmail() : String(e.message || e).slice(0, 150); res = idx.map(function () { return 'Lỗi: ' + msg; }); }
    idx.forEach(function (i, k) { v[i][5] = res[k]; v[i][2] = "'" + normPhone(v[i][2]); });
  });
  rg.setValues(v);
  if (q.getLastRow() > 3000) q.deleteRows(2, q.getLastRow() - 2000); // giữ 2.000 dòng gần nhất để tra lại
}
/** Ghi 1 lượt vào 1 file: nối vào ô ghi chú dòng cuối cùng của khách; khách chưa có dòng → thêm dòng mới. */
function wbWrite(src, items) {
  if (!src || !src.cfg.writeBack) return items.map(function () { return 'Bỏ qua: file đã tắt ghi ngược'; });
  var isOrd = function (it) { return it.text.indexOf(WB_ORDER) === 0 || it.text.indexOf(WB_OST) === 0; };
  if (items.some(isOrd)) { // lệnh đơn ghi vào sheet lên đơn; ghi chú ghi vào sheet chăm sóc
    var oi = items.filter(isOrd), ni = items.filter(function (it) { return !isOrd(it); }), ro = wbOrderWrite(src, oi), rn = ni.length ? wbWrite(src, ni) : [], a = 0, b = 0;
    return items.map(function (it) { return isOrd(it) ? ro[a++] : rn[b++]; });
  }
  var sc = (src.cfg.sheets || []).filter(function (s) { return s.role === 'care' && s.map && s.map.phone !== undefined && s.map.note !== undefined; })[0];
  if (!sc) return items.map(function () { return 'Bỏ qua: chưa chọn sheet chăm sóc'; });
  var id = fileIdOf(src.url), m = sc.map, hr = sc.header || 1, pc = colLetter(+m.phone), nc = colLetter(+m.note), hasName = m.name !== undefined && m.name !== null && m.name !== '', mc = hasName ? colLetter(+m.name) : '', phones, notes, names = [];
  if (hasSheetsApi()) {
    var rgs = [a1(sc.name, pc + (hr + 1) + ':' + pc), a1(sc.name, nc + (hr + 1) + ':' + nc)]; if (hasName) rgs.push(a1(sc.name, mc + (hr + 1) + ':' + mc));
    var got = Sheets.Spreadsheets.Values.batchGet(id, { ranges: rgs, valueRenderOption: 'UNFORMATTED_VALUE' }).valueRanges;
    phones = (got[0].values || []).map(function (r) { return r[0]; }); notes = (got[1].values || []).map(function (r) { return r[0]; }); if (hasName) names = (got[2].values || []).map(function (r) { return r[0]; });
  } else {
    var ws = SpreadsheetApp.openById(id).getSheetByName(sc.name), n = Math.max(ws.getLastRow() - hr, 0);
    phones = n ? ws.getRange(hr + 1, +m.phone + 1, n, 1).getValues().map(function (r) { return r[0]; }) : []; notes = n ? ws.getRange(hr + 1, +m.note + 1, n, 1).getValues().map(function (r) { return r[0]; }) : [];
    if (hasName && n) names = ws.getRange(hr + 1, +m.name + 1, n, 1).getValues().map(function (r) { return r[0]; });
  }
  var nameUpd = {};
  var lastRow = {}; phones.forEach(function (p, i) { var ph = toPhone(p); if (ph) lastRow[ph] = i; });
  var cellUpd = {}, add = [], out = [], width = neededCols(sc), today = Utilities.formatDate(new Date(), TZ, 'd/M');
  items.forEach(function (it) {
    var i = lastRow[it.phone];
    if (it.text === WB_ZALO) { // đánh dấu đã kết bạn Zalo: thêm "(x)" vào tên ở mọi dòng của khách (dòng nào chưa có)
      if (!hasName) { out.push('Bỏ qua: sheet chưa chọn cột tên'); return; }
      var cnt = 0; phones.forEach(function (p, j) { if (toPhone(p) === it.phone) { var nm = String(nameUpd[j] !== undefined ? nameUpd[j] : names[j] == null ? '' : names[j]); if (!zaloMark(nm).zalo) { nameUpd[j] = nm.replace(/\s+$/, '') + '(x)'; cnt++; } } });
      out.push(cnt ? 'Đã thêm (x) vào ' + cnt + ' dòng' : (i === undefined ? 'Bỏ qua: không thấy khách trong file' : 'Tên đã có (x)')); return;
    }
    if (i === undefined) { var row = []; for (var k = 0; k < width; k++) row.push(''); if (m.date !== undefined) row[+m.date] = today; if (m.name !== undefined) row[+m.name] = it.name; row[+m.phone] = it.phone; row[+m.note] = it.text; add.push(row); out.push('Đã thêm dòng mới'); return; }
    var cur = cellUpd[i] !== undefined ? cellUpd[i] : String(notes[i] == null ? '' : notes[i]).replace(/[\s,]+$/, '');
    cellUpd[i] = cur ? cur + ', ' + it.text : it.text; out.push('Đã ghi dòng ' + (hr + 1 + i));
  });
  if (hasSheetsApi()) {
    var data = Object.keys(cellUpd).map(function (i) { return { range: a1(sc.name, nc + (hr + 1 + +i)), values: [[cellUpd[i]]] }; }).concat(Object.keys(nameUpd).map(function (i) { return { range: a1(sc.name, mc + (hr + 1 + +i)), values: [[nameUpd[i]]] }; }));
    if (data.length) Sheets.Spreadsheets.Values.batchUpdate({ valueInputOption: 'RAW', data: data }, id);
    if (add.length) Sheets.Spreadsheets.Values.append({ values: add }, id, a1(sc.name, 'A' + hr), { valueInputOption: 'USER_ENTERED', insertDataOption: 'INSERT_ROWS' });
  } else {
    Object.keys(cellUpd).forEach(function (i) { ws.getRange(hr + 1 + +i, +m.note + 1).setValue(cellUpd[i]); });
    Object.keys(nameUpd).forEach(function (i) { ws.getRange(hr + 1 + +i, +m.name + 1).setValue(nameUpd[i]); });
    add.forEach(function (r) { ws.appendRow(r); });
  }
  return out;
}
/** Chạy tay 1 lần trong trình soạn Apps Script để thử ghi ngược ngay (không phải chờ 5 phút). */
function thuTuNhap() { srcAutoTick(true); Logger.log('Xong. Xem kết quả ở tab "' + SRC_TAB + '" (cột Kết quả) và Nhật ký CSKH.'); }
function thuGhiNguoc() { writeBackTick(); Logger.log('Xong. Xem kết quả ở tab "' + WB_TAB + '".'); }
function crmSrcDelete(ss, u, d) {
  var cur = srcList(ss).filter(function (x) { return x.id === d.id; })[0]; if (!cur) return { ok: false, error: 'Không tìm thấy' };
  ss.getSheetByName(SRC_TAB).deleteRow(cur.row); crmLog(ss, u, 'Nguồn dữ liệu', d.id, cur.sale, 'Xoá nguồn (dữ liệu đã nhập vẫn giữ)', ''); return { ok: true };
}

/* ---------- đọc giá trị trong file cũ */
function toPhone(v) { var p = String(v == null ? '' : v).split('.')[0].replace(/\D/g, ''); if (p.indexOf('84') === 0 && p.length === 11) p = '0' + p.slice(2); if (p.length === 9) p = '0' + p; return /^0\d{9,10}$/.test(p) ? p : ''; }
function toMoney(v) {
  if (typeof v === 'number') return Math.round(v);
  var s = String(v || '').toLowerCase().replace(/\s/g, '').replace(/đ|vnd/g, ''); if (!s) return 0;
  var m = s.match(/^(\d+)(?:[.,](\d+))?(tr|trieu|triệu|m|k|nghin|nghìn|ngan|ngàn)(\d*)$/); // 1tr8, 1,8tr, 800k
  if (m) { var mul = /^(k|ng)/.test(m[3]) ? 1e3 : 1e6; return Math.round(parseFloat(m[1] + '.' + (m[2] || m[4] || '0')) * mul); }
  var n = parseInt(s.replace(/\D/g, ''), 10); return isNaN(n) ? 0 : n;
}
function toQty(v) { var n = parseInt(String(v == null ? '' : v), 10); return n > 0 ? n : 0; }
function toDate(v, ctx) {
  if (v instanceof Date && !isNaN(v)) { if (v.getTime() > Date.now() + 30 * 864e5) return null; ctx.y = v.getFullYear(); return v; } // ngày tương lai xa = gõ nhầm → bỏ qua dòng
  var m = String(v || '').trim().match(/^(\d{1,2})\/(\d{1,2})(?:\/(\d{2,4}))?/); if (!m) return null;
  var y = m[3] ? (m[3].length === 2 ? 2000 + (+m[3]) : +m[3]) : ctx.y || new Date().getFullYear(); ctx.y = y;
  var d = new Date(y + '-' + ('0' + m[2]).slice(-2) + '-' + ('0' + m[1]).slice(-2) + 'T09:00:00+07:00'); if (isNaN(d)) return null;
  if (!m[3] && d.getTime() > Date.now() + 2 * 864e5) { d.setFullYear(d.getFullYear() - 1); ctx.y = d.getFullYear(); } // "31/12" gõ không kèm năm → năm trước
  return d;
}
/* ---------- ô ghi chú kiểu Sheet "21/7 kh nhận hàng, 9/8 knm, 16/5 kh hết tiền" → từng lần chăm sóc có ngày (năm tự suy theo thứ tự) */
function vnMs(y, mo, d) { return Date.UTC(y, mo - 1, d, 2); } // 9h sáng giờ VN
function vnYear(t) { return new Date(t + 7 * 3600e3).getUTCFullYear(); }
function splitNote(text, base, now) {
  text = String(text || '').trim(); if (!text) return [];
  var re = /(?:^|[,;\n]|\.\s)\s*(\d{1,2})\/(\d{1,2})(?:\/(\d{2,4}))?(?![\d\/])/g, marks = [], k;
  while ((k = re.exec(text))) if (+k[1] >= 1 && +k[1] <= 31 && +k[2] >= 1 && +k[2] <= 12) marks.push({ at: k.index, end: re.lastIndex, d: +k[1], mo: +k[2], y: k[3] ? (k[3].length === 2 ? 2000 + (+k[3]) : +k[3]) : 0 });
  var out = [], prev = base || now, clean = function (s) { return s.replace(/^[\s,;.:\-–]+|[\s,;.\-–]+$/g, ''); };
  var head = clean(text.slice(0, marks.length ? marks[0].at : text.length)); if (head) out.push({ t: base || null, text: head, res: noteResult(head) });
  marks.forEach(function (m, i) {
    var body = clean(text.slice(m.end, i + 1 < marks.length ? marks[i + 1].at : text.length)); if (!body) return;
    var t = vnMs(m.y || vnYear(prev), m.mo, m.d);
    if (!m.y) { if (t < prev - 20 * 864e5) t = vnMs(vnYear(prev) + 1, m.mo, m.d); while (t > now + 2 * 864e5) t = vnMs(vnYear(t) - 1, m.mo, m.d); } // 16/5 sau 15/12 → năm sau
    prev = t; out.push({ t: t, text: body, res: noteResult(body) });
  });
  return out;
}
/** Kết quả của 1 lần ghi (theo cách viết tắt quen dùng của sale). */
function noteResult(s) {
  var n = nrm(s);
  if (/^(kh )?(toi|cn|le|chu nhat|ngay)$/.test(n)) return ''; // "kh tối", "kh lễ" = ghi ca, không phải lần chăm sóc
  if (/(^|[^a-z])(knm|kbm|tb)([^a-z]|$)|thue bao|(k|ko|khong|chua) (nghe|bat may)|tat may|may ban|tu choi nghe|(k|ko|khong) lien lac/.test(n)) return 'Không nghe máy';
  if (/(k|ko|khong) (dung|mua|lay)( gi)? nua|(k|ko|khong) (co )?nhu cau|tu choi/.test(n)) return 'Không có nhu cầu';
  if (/(^|[^a-z])hen([^a-z]|$)/.test(n)) return 'Hẹn gọi lại';
  if (/mua lai|dat lai|lay them|lay tiep|mua tiep|dat them|len don|chot don/.test(n)) return 'Đã đặt lại';
  return 'Đã hỏi thăm';
}
/** Ký hiệu trong tên khách: "(cô Bình gt)" = người giới thiệu, "(0961912253)" = số điện thoại khác. */
function nameMarks(name) {
  var out = [];
  String(name || '').replace(/\(([^)]*)\)/g, function (all, x) {
    var ph = toPhone(x.replace(/\s/g, '')); if (ph) out.push('SĐT khác: ' + ph);
    else if (/(^|\s)gt(\s|$)|gioi thieu/.test(nrm(x))) out.push('Người giới thiệu: ' + x.replace(/\s*(gt|giới thiệu)\s*$/i, '').trim());
    return all;
  });
  return out;
}
function mapStatus(v, when) {
  var s = nrm(v);
  if (/hoan/.test(s)) return 'Hoàn';
  if (/huy|bom/.test(s)) return 'Huỷ';
  if (/doi/.test(s)) return 'Đổi hàng';
  if (/giao thanh cong|da giao|thanh cong/.test(s)) return 'Đã giao';
  if (/dang giao/.test(s)) return 'Đang giao';
  return when && Date.now() - when.getTime() > 14 * 864e5 ? 'Đã giao' : 'Đang giao'; // "Đã lên đơn" / trống: đơn cũ coi như đã giao
}
/** Loại đơn từ cột "Phân loại khách / ca" trong file sale ("kh mới", "kh cũ tối", "lễ"…). */
function otypeFromFile(v, when) { var ca = caFromText(v, when), s = nrm(v); return ca === 'Lễ' ? 'Ngày lễ' : ca === 'Tối/CN' ? 'Ngoài giờ' : /(^| )cu( |$)/.test(s) ? 'Khách cũ' : /moi/.test(s) ? 'Khách mới' : ''; }
function caFromText(v, when) {
  var s = nrm(v);
  if (/(^| )le( |$)/.test(s)) return 'Lễ';
  if (/toi|(^| )cn( |$)|chu nhat/.test(s)) return 'Tối/CN';
  return when ? caOf(when, { evening: '23:59', holidays: caCfg().holidays }) : 'Ngày'; // file cũ không có giờ: chỉ xét Chủ nhật & ngày lễ
}
function cell(r, m, k) { return m[k] === undefined || m[k] === null || m[k] === '' ? '' : r[m[k]]; }
function neededCols(shCfg) {
  var mx = 0; Object.keys(shCfg.map || {}).forEach(function (k) { var v = Number(shCfg.map[k]); if (v + 1 > mx) mx = v + 1; });
  (shCfg.extra || []).forEach(function (v) { if (Number(v) + 1 > mx) mx = Number(v) + 1; });
  return Math.max(mx, 1);
}
function srcRows(src, shCfg) {
  if (hasSheetsApi()) {
    var hr0 = shCfg.header || 1, lc0 = neededCols(shCfg), vals;
    try { vals = Sheets.Spreadsheets.Values.get(fileIdOf(src.url), a1(shCfg.name, 'A' + hr0 + ':' + colLetter(lc0 - 1)), { valueRenderOption: 'UNFORMATTED_VALUE', dateTimeRenderOption: 'SERIAL_NUMBER' }).values || []; }
    catch (e) { throw new Error(/not found|Unable to parse range/i.test(String(e)) ? 'Không thấy sheet "' + shCfg.name + '" trong file.' : noAccess()); }
    if (!vals.length) return { rows: [], headers: [] };
    var mm = shCfg.map || {}, dc = [mm.date, mm.callback].filter(function (v) { return v !== undefined && v !== null && v !== ''; }).map(Number);
    return { headers: padRow(vals[0], lc0), rows: vals.slice(1).map(function (r) { r = padRow(r, lc0); dc.forEach(function (c) { if (isSerial(r[c])) r[c] = serialDate(r[c]); }); return r; }) };
  }
  var f = SpreadsheetApp.openById(fileIdOf(src.url)), ws = f.getSheetByName(shCfg.name); if (!ws) throw new Error('Không thấy sheet "' + shCfg.name + '" trong file.');
  var lr = ws.getLastRow(), hr = shCfg.header || 1; if (lr <= hr) return { rows: [], headers: [] };
  var lc = Math.min(ws.getLastColumn(), neededCols(shCfg)); // chỉ đọc đúng số cột cần (sheet có hàng nghìn cột trống sẽ làm tràn bộ nhớ)
  return { rows: ws.getRange(hr + 1, 1, lr - hr, lc).getValues(), headers: ws.getRange(hr, 1, 1, lc).getValues()[0] };
}

/** Đồng bộ 1 sheet của 1 file sale. d = { id, sheet (vị trí trong cấu hình), dry }. */
function crmSrcSync(ss, u, d) {
  var src = srcList(ss).filter(function (x) { return x.id === d.id; })[0]; if (!src) return { ok: false, error: 'Không tìm thấy nguồn.' };
  var sheets = src.cfg.sheets || [];
  if (d.name) { d.sheet = -1; sheets.forEach(function (x, i) { if (x.name === d.name) d.sheet = i; }); } // gọi theo tên sheet cho chắc chắn
  var shCfg = sheets[d.sheet]; if (!shCfg || shCfg.role === 'skip') return { ok: false, error: 'Sheet "' + (d.name || d.sheet) + '" không được chọn để nhập.' };
  var sale = src.sale; if (!crmUsers(ss).some(function (x) { return x.name === sale; })) return { ok: false, error: 'Chưa có nhân sự tên "' + sale + '" trong CRM. Thêm ở Cài đặt → Nhân sự trước.' };
  var data = srcRows(src, shCfg), res, total = data.rows.length;
  if (shCfg.role === 'orders' && d.limit) { var off = Math.max(0, Number(d.offset) || 0); data.rows = data.rows.slice(off, off + Number(d.limit)); data.chunk = true; } // xử lý từng phần cho khỏi quá giờ
  if (shCfg.role === 'orders') res = importOrders(ss, src, shCfg, data, !!d.dry);
  else if (shCfg.role === 'care') res = importCare(ss, src, shCfg, data, !!d.dry, d.sheet);
  else if (shCfg.role === 'reject') res = importReject(ss, src, shCfg, data, !!d.dry);
  else return { ok: false, error: 'Vai trò sheet không hợp lệ' };
  if (!d.dry) {
    var sh = ss.getSheetByName(SRC_TAB), cur = srcList(ss).filter(function (x) { return x.id === d.id; })[0];
    if (res.done !== undefined) { cur.cfg.done = cur.cfg.done || {}; cur.cfg.done[d.sheet] = res.done; sh.getRange(cur.row, 5).setValue(JSON.stringify(cur.cfg)); }
    sh.getRange(cur.row, 6, 1, 2).setValues([[new Date(), shCfg.name + ': ' + res.summary]]);
    if (u.name !== 'Tự động' || res.newOrders || res.updated || res.notes || res.newLeads || res.flagged) crmLog(ss, u, 'Đồng bộ file', src.id, sale, shCfg.name, res.summary); // tự nhập 30 phút/lần: không có gì mới thì không ghi nhật ký cho đỡ rối
  }
  res.ok = true; res.role = shCfg.role; res.sheetName = shCfg.name; res.total = total; return res;
}

/** Cột "Trạng thái" có ô chọn cũ (chưa có Hoàn / Đổi hàng) sẽ chặn ghi → cập nhật danh sách, cho phép giá trị khác. */
function fixStatusRule(sh) {
  var p = PropertiesService.getScriptProperties(); if (p.getProperty('status_rule_v2')) return;
  var H = sh.getRange(1, 1, 1, sh.getLastColumn()).getValues()[0], col = H.indexOf('Trạng thái') + 1; if (col < 1) return;
  sh.getRange(2, col, Math.max(sh.getMaxRows() - 1, 1), 1).setDataValidation(SpreadsheetApp.newDataValidation().requireValueInList(ORDER_STATUS, true).setAllowInvalid(true).setHelpText('Bấm ▼ để chọn trạng thái đơn').build());
  p.setProperty('status_rule_v2', '1');
}
function appendRows(sh, rows, width) {
  if (!rows.length) return; var st = sh.getLastRow() + 1;
  if (sh.getMaxRows() < st + rows.length) sh.insertRowsAfter(sh.getMaxRows(), st + rows.length - sh.getMaxRows());
  sh.getRange(st, 1, rows.length, width).setValues(rows);
}
/** Mã đơn đã có → dòng, trạng thái, nguồn (để đồng bộ lại chỉ thêm đơn mới + cập nhật trạng thái đơn cũ). */
function existingOrders(ss) {
  var sh = sheet(ss, 'Đơn hàng', ORDER_HEADERS), o = {}; if (sh.getLastRow() < 2) return o;
  var ic = ORDER_HEADERS.indexOf('Mã đơn'), is = ORDER_HEADERS.indexOf('Trạng thái'), iso = ORDER_HEADERS.indexOf('Nguồn');
  sh.getRange(2, 1, sh.getLastRow() - 1, iso + 1).getValues().forEach(function (r, i) { if (r[ic]) o[String(r[ic])] = { row: i + 2, status: String(r[is]), src: String(r[iso]) }; });
  return o;
}
/** Đơn không đến từ file sale (tạo trên CRM / web): SĐT|ngày|tiền → nhận ra khi chính đơn đó đã được ghi ngược vào file. */
function crmOrderDays(ss) {
  var t = tableOf(ss.getSheetByName('Đơn hàng')), H = t.H, iT = H.indexOf('Thời gian'), iP = H.indexOf('Điện thoại'), iS = H.indexOf('Nguồn'), iTo = H.indexOf('Tổng'), o = {};
  t.rows.forEach(function (r) { if (String(r[iS]).indexOf('File ') === 0 || !(r[iT] instanceof Date)) return; o[normPhone(r[iP]) + '|' + Utilities.formatDate(r[iT], TZ, 'yyyyMMdd') + '|' + (Number(r[iTo]) || 0)] = 1; });
  return o;
}
/** Số điện thoại đang có khách tiềm năng còn mở (Mới hỏi / Đang tư vấn) → không tạo trùng. */
function openLeadPhones(ss) { var o = {}; leadsData(ss).forEach(function (l) { if (l.status === 'Mới hỏi' || l.status === 'Đang tư vấn') o[l.phone] = l.owner || '-'; }); return o; }
function existingOrderKeys(ss) {
  var sh = sheet(ss, 'Đơn hàng', ORDER_HEADERS), keys = {}; if (sh.getLastRow() < 2) return keys;
  var ic = ORDER_HEADERS.indexOf('Mã đơn') + 1; sh.getRange(2, ic, sh.getLastRow() - 1, 1).getValues().forEach(function (r) { if (r[0]) keys[String(r[0])] = 1; });
  return keys;
}
function customerOwners(ss) {
  var cs = sheet(ss, 'Khách hàng', CUS_HEADERS), o = {}; if (cs.getLastRow() < 2) return o;
  cs.getRange(2, 1, cs.getLastRow() - 1, CUS_HEADERS.length).getValues().forEach(function (v) { var p = normPhone(v[0]); if (p) o[p] = { owner: String(v[C['Phụ trách']] || ''), name: v[C['Tên']] }; });
  return o;
}

/** Sheet đơn hàng ("lên đơn", "VTG_lendon"…). */
function importOrders(ss, src, shCfg, data, dry) {
  var m = shCfg.map || {}, ex = existingOrders(ss), crmDay = crmOrderDays(ss), owners = customerOwners(ss), ctx = {}, sale = src.sale, out = [], seen = {}, skip = 0, dup = 0, revenue = 0, phones = {}, callbacks = {}, minD = null, maxD = null;
  var extra = (shCfg.extra || []).filter(function (i) { return i >= 0; }), H = data.headers, label = 'File ' + sale + ' – ' + shCfg.name, keys = ex;
  var until = src.cfg.until ? new Date(src.cfg.until + 'T00:00:00+07:00').getTime() : 0, afterCut = 0, upd = [], FINAL = { 'Đã giao': 1, 'Hoàn': 1, 'Huỷ': 1, 'Đổi hàng': 1 };
  data.rows.forEach(function (r) {
    var phone = toPhone(cell(r, m, 'phone')), when = toDate(cell(r, m, 'date'), ctx), product = String(cell(r, m, 'product') || '').trim(), amount = toMoney(cell(r, m, 'amount'));
    if (!phone || !when || (!product && !amount)) { if (r.some(function (c) { return c !== ''; })) skip++; return; }
    var codeRaw = String(cell(r, m, 'code') || '').trim(), valid = /^[A-Za-z]{2,}\d{5,}/.test(codeRaw);
    var key = valid ? codeRaw : 'NK' + hashKey(sale + '|' + Utilities.formatDate(when, TZ, 'yyyyMMdd') + '|' + phone + '|' + amount + '|' + nrm(product));
    if (keys[key]) { // đã nhập: file cũ đổi sang Đã giao / Hoàn / Huỷ / Đổi hàng thì cập nhật theo (không đè thay đổi làm trên CRM)
      var st1 = mapStatus(cell(r, m, 'status'), when), cur = keys[key];
      if (cur.src.indexOf('File ') === 0 && st1 !== cur.status && FINAL[st1] && !FINAL[cur.status]) upd.push({ row: cur.row, status: st1 });
      dup++; return;
    }
    if (seen[key]) { dup++; return; } seen[key] = 1;
    if (crmDay[phone + '|' + Utilities.formatDate(when, TZ, 'yyyyMMdd') + '|' + amount]) { dup++; return; } // đơn tạo trên CRM / web đã ghi ngược vào file → không nhập lại
    if (until && when.getTime() >= until) { afterCut++; return; } // từ ngày này sale lên đơn trên CRM → không nhập để tránh trùng
    var items = [];
    if (product) items.push({ name: product, variant: '', qty: toQty(cell(r, m, 'qty')) || 1, price: 0, subtotal: amount });
    [['gift1', 'gift1qty'], ['gift2', 'gift2qty']].forEach(function (g) { var n = String(cell(r, m, g[0]) || '').trim(); if (n) items.push({ name: n, variant: '', qty: toQty(cell(r, m, g[1])) || 1, gift: true, subtotal: 0 }); });
    var ctype = String(cell(r, m, 'ctype') || '').trim(), notes = [String(cell(r, m, 'note') || '').trim()];
    if (!valid && codeRaw) notes.push(codeRaw);
    if (ctype && !/^(kh|khach)? ?(moi|cu|cu mua lai)$/.test(nrm(ctype)) && !/toi|cn|le/.test(nrm(ctype))) notes.push('Phân loại: ' + ctype);
    extra.forEach(function (i) { if (r[i] !== '' && r[i] != null) notes.push(cellText(H[i]) + ': ' + cellText(r[i])); });
    var cb = cell(r, m, 'callback'); if (cb instanceof Date && cb.getTime() > Date.now()) callbacks[phone] = cb;
    var status = mapStatus(cell(r, m, 'status'), when);
    out.push([when, key, String(cell(r, m, 'name') || '').trim(), "'" + phone, '', '', '', String(cell(r, m, 'address') || '').trim(), itemsText(items), amount, 0, amount, 'COD', notes.filter(String).join(' · '), status,
      label, label, 'Không', '', '', '', sale, caFromText(ctype, when), normLine(cell(r, m, 'line'), product), String(cell(r, m, 'shipText') || '').trim() || shipText(items), '', '', otypeFromFile(ctype, when), '']);
    if (!isVoid(status)) revenue += amount;
    phones[phone] = String(cell(r, m, 'name') || '');
    if (!minD || when < minD) minD = when; if (!maxD || when > maxD) maxD = when;
  });
  var conflicts = Object.keys(phones).filter(function (p) { return owners[p] && owners[p].owner && owners[p].owner !== sale; }).map(function (p) { return { phone: p, name: phones[p], owner: owners[p].owner }; });
  var newCus = Object.keys(phones).filter(function (p) { return !owners[p]; }).length;
  var summary = out.length + ' đơn mới, ' + dup + ' đã có' + (upd.length ? ' (' + upd.length + ' cập nhật trạng thái)' : '') + (afterCut ? ', ' + afterCut + ' đơn sau ngày chốt bỏ qua' : '') + ', ' + skip + ' dòng bỏ qua';
  var res = { updated: upd.length, afterCut: afterCut, rows: data.rows.length, newOrders: out.length, dup: dup, skip: skip, customers: Object.keys(phones).length, newCustomers: newCus, conflicts: conflicts.slice(0, 50), conflictCount: conflicts.length, revenue: revenue, from: minD ? minD.getTime() : null, to: maxD ? maxD.getTime() : null, summary: summary };
  if (dry || (!out.length && !upd.length)) return res;
  out.sort(function (a, b) { return a[0] - b[0]; });
  var sh = sheet(ss, 'Đơn hàng', ORDER_HEADERS); fixStatusRule(sh);
  if (upd.length) { var sc = ORDER_HEADERS.indexOf('Trạng thái') + 1, rc = ORDER_HEADERS.indexOf('Ngày nhận') + 1, lk0 = LockService.getScriptLock(); lk0.waitLock(60000); try { upd.forEach(function (x) { sh.getRange(x.row, sc).setValue(x.status); if (x.status === 'Đã giao' && !sh.getRange(x.row, rc).getValue()) sh.getRange(x.row, rc).setValue(new Date()); }); } finally { lk0.releaseLock(); } } // file đổi sang Đã giao → ngày nhận ≈ hôm nay
  for (var i = 0; i < out.length; i += 1000) { // ghi từng phần, nhả khoá để đơn web vẫn vào được
    var part = out.slice(i, i + 1000), lock = LockService.getScriptLock(); lock.waitLock(60000);
    try { var start = sh.getLastRow() + 1; if (sh.getMaxRows() < start + part.length) sh.insertRowsAfter(sh.getMaxRows(), start + part.length - sh.getMaxRows()); sh.getRange(start, 1, part.length, ORDER_HEADERS.length).setValues(part); } finally { lock.releaseLock(); }
  }
  if (data.chunk) { // tính lại khách 1 lần ở bước cuối (src_finish)
    var pp = PropertiesService.getScriptProperties(), k = 'cb_' + src.id, old = JSON.parse(pp.getProperty(k) || '{}');
    Object.keys(callbacks).forEach(function (ph) { old[ph] = callbacks[ph].getTime(); }); pp.setProperty(k, JSON.stringify(old));
    return res;
  }
  var own = {}; Object.keys(phones).forEach(function (p) { own[p] = sale; });
  var lk = LockService.getScriptLock(); lk.waitLock(60000);
  try { rebuildCustomers({ owners: own }); setCallbacks(ss, callbacks); } finally { lk.releaseLock(); }
  return res;
}
/** Sau khi nhập xong các phần đơn hàng: tính lại khách, gán người phụ trách = sale của file, đặt lịch gọi lại. */
function crmSrcFinish(ss, u, d) {
  var src = srcList(ss).filter(function (x) { return x.id === d.id; })[0]; if (!src) return { ok: false, error: 'Không tìm thấy nguồn.' };
  var lk = LockService.getScriptLock(); lk.waitLock(60000);
  try {
    rebuildCustomers({ sellerOwner: src.sale });
    var pp = PropertiesService.getScriptProperties(), k = 'cb_' + src.id, cb = JSON.parse(pp.getProperty(k) || '{}'), m = {};
    Object.keys(cb).forEach(function (ph) { m[ph] = new Date(cb[ph]); }); setCallbacks(ss, m); pp.deleteProperty(k);
  } finally { lk.releaseLock(); }
  return { ok: true };
}
function setCallbacks(ss, cb) {
  var ks = Object.keys(cb); if (!ks.length) return; var cs = ss.getSheetByName('Khách hàng'); if (!cs || cs.getLastRow() < 2) return;
  var rg = cs.getRange(2, 1, cs.getLastRow() - 1, CUS_HEADERS.length), v = rg.getValues();
  v.forEach(function (r) { var p = normPhone(r[0]); if (cb[p] && !r[C['Hẹn gọi lại']]) r[C['Hẹn gọi lại']] = cb[p]; r[0] = "'" + p; }); rg.setValues(v);
}

/** Sheet khách & nhật ký chăm sóc ("cop số"…): ghép nhật ký vào hồ sơ khách; người chưa mua → khách tiềm năng. */
function importCare(ss, src, shCfg, data, dry, idx) {
  var m = shCfg.map || {}, sale = src.sale, start = (src.cfg.done && src.cfg.done[idx]) || 0, ctx = {}, per = {}, order = [], skip = 0, nowMs = Date.now(), wbk = wbKeys(ss, src.id);
  data.rows.forEach(function (r, i) {
    var when = toDate(cell(r, m, 'date'), ctx); if (i < start) return; // ngày vẫn đọc để biết năm của các dòng sau
    var phone = toPhone(cell(r, m, 'phone')); if (!phone) { if (r.some(function (c) { return c !== ''; })) skip++; return; }
    var p = per[phone]; if (!p) { p = per[phone] = { name: '', entries: [], seen: {}, extra: [], last: null, status: '', product: '', amount: 0 }; order.push(phone); }
    p.name = String(cell(r, m, 'name') || p.name).trim(); if (when && (!p.last || when > p.last)) p.last = when;
    if (zaloMark(p.name).zalo) p.zalo = true;
    var n = String(cell(r, m, 'note') || '').trim(), hl = String(cell(r, m, 'health') || '').trim();
    splitNote(n, when ? when.getTime() : null, nowMs).forEach(function (e) { var key = e.t + '|' + e.text; if (!p.seen[key] && !wbHas(wbk, phone, e.text)) { p.seen[key] = 1; p.entries.push(e); } }); // dòng do CRM ghi ngược: bỏ
    nameMarks(cell(r, m, 'name')).concat(hl ? ['Sức khoẻ: ' + hl] : []).forEach(function (x) { if (p.extra.indexOf(x) < 0) p.extra.push(x); });
    p.status = String(cell(r, m, 'status') || p.status); p.product = String(cell(r, m, 'product') || p.product); p.amount = p.amount || toMoney(cell(r, m, 'amount'));
  });
  order.forEach(function (ph) { // nhật ký mới nhất lên đầu (giống ghi nhanh trên CRM); lần cuối khách có phản hồi → "Lần CSKH gần nhất"
    var p = per[ph]; p.entries.sort(function (a, b) { return (b.t || 0) - (a.t || 0); });
    p.notes = p.extra.concat(p.entries.map(function (e) { return (e.t ? Utilities.formatDate(new Date(e.t), TZ, 'dd/MM/yy') + ': ' : '') + e.text; }));
    var rp = p.entries.filter(function (e) { return e.t && e.res && e.res !== 'Không nghe máy'; })[0]; if (rp) { p.replyAt = new Date(rp.t); p.replyRes = rp.res; }
  });
  var owners = customerOwners(ss), leadIds = {}, lsh = leadSheet(ss), openP = openLeadPhones(ss), anyLead = {}; leadsData(ss).forEach(function (l) { anyLead[l.phone] = 1; });
  if (dry) (src.cfg.sheets || []).forEach(function (sc) { // xem trước: coi như các sheet đơn hàng đã được nhập
    if (sc.role !== 'orders') return; var dd = srcRows(src, sc), mm = sc.map || {};
    dd.rows.forEach(function (r) { var ph = toPhone(cell(r, mm, 'phone')); if (ph && !owners[ph]) owners[ph] = { owner: sale, name: '' }; });
  });
  if (lsh.getLastRow() > 1) lsh.getRange(2, 1, lsh.getLastRow() - 1, 1).getValues().forEach(function (r) { leadIds[String(r[0])] = 1; });
  var toNote = [], leads = [], conflicts = [], now = Date.now(), head = '— Nhật ký cũ (' + shCfg.name + ') —';
  order.forEach(function (ph) {
    var p = per[ph];
    if (owners[ph]) { if (owners[ph].owner && owners[ph].owner !== sale) conflicts.push({ phone: ph, name: p.name, owner: owners[ph].owner }); if (p.notes.length || p.zalo) toNote.push(ph); return; }
    var id = 'CS' + hashKey(sale + '|' + ph); if (leadIds[id] || openP[ph] || anyLead[ph]) return; // đã có trong Khách hỏi (kể cả đã đóng) → không tạo trùng
    var st = nrm(p.status), recent = p.last && now - p.last.getTime() <= 30 * 864e5;
    var status = /huy/.test(st) ? 'Không mua' : /chot|len don/.test(st) ? 'Đã chốt' : recent ? 'Đang tư vấn' : 'Không mua';
    var reason = status === 'Không mua' ? (/huy/.test(st) ? 'Huỷ' : 'Chưa mua (dữ liệu cũ)') : '';
    leads.push([id, p.last || new Date(), zaloMark(p.name).name, "'" + ph, 'File cũ – ' + shCfg.name, p.product, status, sale, p.last || '', '', reason, p.notes.join('\n').slice(0, 45000), '', 'Đồng bộ ' + sale]);
  });
  var summary = toNote.length + ' khách được thêm nhật ký cũ, ' + leads.length + ' người chưa mua → tiềm năng (' + leads.filter(function (l) { return l[6] === 'Đang tư vấn'; }).length + ' còn theo dõi), ' + skip + ' dòng bỏ qua';
  var res = { rows: data.rows.length, from: start, people: order.length, notes: toNote.length, newLeads: leads.length, openLeads: leads.filter(function (l) { return l[6] === 'Đang tư vấn'; }).length, conflicts: conflicts.slice(0, 50), conflictCount: conflicts.length, skip: skip, summary: summary, done: data.rows.length };
  if (dry) return res;
  var lock = LockService.getScriptLock(); lock.waitLock(60000);
  try {
    if (toNote.length) {
      var cs = ss.getSheetByName('Khách hàng'), rg = cs.getRange(2, 1, cs.getLastRow() - 1, CUS_HEADERS.length), v = rg.getValues(), set = {};
      toNote.forEach(function (ph) { set[ph] = per[ph].notes.join('\n'); });
      v.forEach(function (r) {
        var ph = normPhone(r[0]); r[0] = "'" + ph; if (set[ph] === undefined) return;
        if (per[ph].zalo && !r[C['Zalo']]) r[C['Zalo']] = 'Có';
        if (!set[ph]) return;
        var cur = String(r[C['Ghi chú CSKH']] || ''); r[C['Ghi chú CSKH']] = (cur.indexOf(head) >= 0 ? cur + '\n' + set[ph] : (cur ? cur + '\n' : '') + head + '\n' + set[ph]).slice(0, 45000);
        if (!r[C['Phụ trách']]) r[C['Phụ trách']] = sale;
        var ra = per[ph].replyAt, ca = r[C['Lần CSKH gần nhất']] ? new Date(r[C['Lần CSKH gần nhất']]) : null;
        if (ra && (!ca || isNaN(ca) || ca < ra)) { r[C['Lần CSKH gần nhất']] = ra; r[C['Kết quả CSKH']] = per[ph].replyRes; }
      });
      rg.setValues(v);
    }
    appendRows(lsh, leads, LEAD_HEADERS.length);
  } finally { lock.releaseLock(); }
  return res;
}

/** Sheet khách từ chối / bom hàng: gắn nhãn ⚠️ cho khách, người chưa mua → tiềm năng "Không mua". */
function importReject(ss, src, shCfg, data, dry) {
  var m = shCfg.map || {}, sale = src.sale, per = {};
  data.rows.forEach(function (r) { var ph = toPhone(cell(r, m, 'phone')); if (!ph) return; per[ph] = per[ph] || { name: String(cell(r, m, 'name') || ''), why: [] }; var n = String(cell(r, m, 'note') || cell(r, m, 'status') || '').trim(); if (n) per[ph].why.push(n); });
  var owners = customerOwners(ss), flags = [], leads = [], lsh = leadSheet(ss), ids = {};
  if (lsh.getLastRow() > 1) lsh.getRange(2, 1, lsh.getLastRow() - 1, 1).getValues().forEach(function (r) { ids[String(r[0])] = 1; });
  Object.keys(per).forEach(function (ph) {
    var bom = /bom/i.test(per[ph].why.join(' '));
    if (owners[ph]) flags.push([ph, bom ? 'Bom hàng' : 'Từ chối']);
    else { var id = 'TC' + hashKey(sale + '|' + ph); if (!ids[id]) leads.push([id, new Date(), per[ph].name, "'" + ph, 'File cũ – ' + shCfg.name, '', 'Không mua', sale, '', '', bom ? 'Bom hàng' : 'Từ chối', per[ph].why.join('\n'), '', 'Đồng bộ ' + sale]); }
  });
  var res = { rows: data.rows.length, people: Object.keys(per).length, flagged: flags.length, newLeads: leads.length, summary: flags.length + ' khách gắn nhãn cảnh báo, ' + leads.length + ' người vào danh sách "Không mua"' };
  if (dry) return res;
  var lock = LockService.getScriptLock(); lock.waitLock(60000);
  try {
    if (flags.length) { var cs = ss.getSheetByName('Khách hàng'), rg = cs.getRange(2, 1, cs.getLastRow() - 1, CUS_HEADERS.length), v = rg.getValues(), f = {}; flags.forEach(function (x) { f[x[0]] = x[1]; }); v.forEach(function (r) { var ph = normPhone(r[0]); r[0] = "'" + ph; if (f[ph] && !r[C['Nhãn']]) r[C['Nhãn']] = f[ph]; }); rg.setValues(v); }
      appendRows(lsh, leads, LEAD_HEADERS.length);
  } finally { lock.releaseLock(); }
  return res;
}

/* ---------- file số quảng cáo chung */
function adsCfg() { try { return JSON.parse(PropertiesService.getScriptProperties().getProperty('ads_cfg') || 'null'); } catch (e) { return null; } }
function crmAdsSave(ss, u, d) {
  var cfg = d.cfg || {}; cfg.fileId = fileIdOf(cfg.url); if (!cfg.fileId) return { ok: false, error: 'Link file chưa đúng.' };
  cfg.mode = cfg.mode === 'crm' ? 'crm' : 'staff';
  PropertiesService.getScriptProperties().setProperty('ads_cfg', JSON.stringify(cfg));
  ScriptApp.getProjectTriggers().forEach(function (t) { if (t.getHandlerFunction() === 'adsTick') ScriptApp.deleteTrigger(t); });
  if (cfg.auto) ScriptApp.newTrigger('adsTick').timeBased().everyMinutes(10).create();
  crmLog(ss, u, 'Cài đặt', '-', '', 'File số QC: ' + (cfg.mode === 'crm' ? 'CRM tự chia' : 'nhân sự chia') + (cfg.auto ? ', tự đồng bộ 10 phút/lần' : ''), '');
  return { ok: true };
}
/** Chạy tự động 10 phút/lần (bật trong Cài đặt → File số quảng cáo). */
function adsTick() { if (PropertiesService.getScriptProperties().getProperty('retired')) return; var ss = SpreadsheetApp.getActiveSpreadsheet(); try { var r = crmAdsSync(ss, { name: 'Tự động', level: 3 }, false); if (r && (r.added || r.newLeads || r.count)) dataChanged(); } catch (e) { console.error('adsTick', e); } }

/** Lấy số quảng cáo vào "Khách tiềm năng". Nhân sự chia: đọc tên sale ở cột Sale. CRM chia: số chưa có sale → giao theo lượt từng sheet (trùng số → sale cũ) và ghi tên vào cột Sale. */
/** Tên sale trong file QC hay kèm ca trực: "Phương T2", "Chang CN", "Lương ca tối" → "phuong". */
function saleKey(t) { return nrm(t).replace(/\s*[-–(]?\s*(t\s?[2-8]|cn|chu nhat|ca\s+\S+|toi|sang|chieu|\d+)\)?\s*$/, '').trim(); }
/** Số QC đã nhập với ngày trong tương lai (gõ đảo ngày/tháng) → sửa lại ngày cho đúng, không hợp lý thì đưa về ngày nhập. */
function fixFutureLeads(lsh) {
  if (lsh.getLastRow() < 2) return; var rg = lsh.getRange(2, 1, lsh.getLastRow() - 1, 2), v = rg.getValues(), lim = Date.now() + 864e5, ch = 0;
  v.forEach(function (r) {
    if (!/^QC/.test(String(r[0])) || !(r[1] instanceof Date) || r[1].getTime() <= lim) return;
    var dd = +Utilities.formatDate(r[1], TZ, 'dd'), sw = new Date(Utilities.formatDate(r[1], TZ, 'yyyy') + '-' + ('0' + dd).slice(-2) + '-' + Utilities.formatDate(r[1], TZ, 'MM') + 'T09:00:00+07:00');
    r[1] = dd <= 12 && !isNaN(sw) && sw.getTime() <= lim ? sw : new Date(); ch++;
  });
  if (ch) rg.setValues(v);
}
/** Số ebook đến từ website: dòng Ladi có utm_source=website (cột UTM / Nguồn / link trang) → { pos: vị trí bấm trên web }. */
var EBOOK_POS = { home: 'trang chủ', post: 'bài viết', menu: 'menu', float: 'hộp tư vấn' };
function ebookFromWeb(r, iMed) {
  var t = r.map(function (c) { return c instanceof Date ? '' : String(c == null ? '' : c); }).join(' ').toLowerCase();
  if (!/utm_source=website|(^|[^a-z_.])website([^a-z.]|$)/.test(t)) return null;
  var md = (t.match(/utm_medium=([a-z]+)/) || [])[1] || (iMed >= 0 ? String(r[iMed] || '').trim().toLowerCase() : '');
  return { pos: EBOOK_POS[md] || md || '' };
}
function crmAdsSync(ss, u, dry) {
  var cfg = adsCfg(); if (!cfg || !cfg.fileId) return { ok: false, error: 'Chưa cài file số quảng cáo.' };
  var users = crmUsers(ss).filter(function (x) { return x.active; }), byAlias = {};
  users.forEach(function (x) { [x.name].concat(String(x.alias || '').split(',')).forEach(function (a) { a = nrm(a); if (a) byAlias[a] = x.name; }); });
  var since = cfg.since ? new Date(cfg.since + 'T00:00:00+07:00').getTime() : Date.now() - 3 * 864e5;
  var lsh = leadSheet(ss), ids = {}, openBy = {};
  leadsData(ss).forEach(function (l) { ids[l.id] = 1; if (l.status === 'Mới hỏi' || l.status === 'Đang tư vấn') openBy[l.phone] = l.owner; });
  if (!dry) fixFutureLeads(lsh);
  var owners = customerOwners(ss), rows = [], perSale = {}, perSheet = {}, writes = [], skipped = 0, merged = 0, rr = {};
  var nextFrom = function (pool, key) { if (!(key in rr)) rr[key] = PropertiesService.getScriptProperties().getProperty(key) || ''; var n = pool[(pool.indexOf(rr[key]) + 1) % pool.length]; rr[key] = n; return n; };
  (cfg.sheets || []).filter(function (x) { return x.on; }).forEach(function (sc) {
    var m = sc.map || cfg.map || {}, hr = sc.header || 1, vals, ctx = {}, n = 0, ws = sc.name;
    var hdrs = [];
    try { var sr = srcRows({ url: cfg.fileId }, { name: sc.name, header: hr, map: m }); vals = sr.rows; hdrs = (sr.headers || []).map(nrm); } catch (e) { return; }
    var iMed = hdrs.findIndex(function (x) { return /utm.?medium/.test(x); });
    var pool = users.filter(function (x) { return x.recv && x.alias; }).map(function (x) { return x.name; }), rrKey = 'rr_ads_' + hashKey(sc.name);
    vals.forEach(function (r, i) {
      var when = toDate(cell(r, m, 'date'), ctx), phone = toPhone(cell(r, m, 'phone')); if (!when || !phone) return;
      if (when.getTime() > Date.now() + 864e5) { // ngày trong tương lai = gõ đảo ngày/tháng (vd "10/2" thành 2/10) → thử đảo lại, không hợp lý thì bỏ
        var sw = new Date(Utilities.formatDate(when, TZ, 'yyyy') + '-' + Utilities.formatDate(when, TZ, 'dd') + '-' + Utilities.formatDate(when, TZ, 'MM') + 'T09:00:00+07:00');
        if (isNaN(sw) || +Utilities.formatDate(when, TZ, 'dd') > 12 || sw.getTime() > Date.now() + 864e5) return; when = sw;
      }
      if (when.getTime() < since) return;
      var id = 'QC' + hashKey(sc.name + '|' + phone + '|' + Utilities.formatDate(when, TZ, 'yyyyMMdd')); if (ids[id]) return;
      if (openBy[phone] !== undefined && cfg.mode !== 'crm') { merged++; ids[id] = 1; return; } // số này đang được chăm sóc (tiềm năng còn mở) → không tạo trùng
      var saleTxt = String(cell(r, m, 'sale') || '').trim(), owner = byAlias[nrm(saleTxt)] || byAlias[saleKey(saleTxt)] || '';
      if (cfg.mode === 'crm' && !saleTxt) { // CRM chia
        var old = (owners[phone] && owners[phone].owner) || openBy[phone] || '';
        owner = old || (pool.length ? nextFrom(pool, rrKey) : '');
        if (owner) { var ux = users.filter(function (x) { return x.name === owner; })[0]; writes.push({ sheet: ws, row: hr + 1 + i, col: m.sale, val: (String(ux.alias || '').split(',')[0].trim() || owner), dupCol: old ? m.dup : undefined }); }
      }
      if (!owner) { skipped++; return; } // sale chưa có trong CRM (giai đoạn thử nghiệm) → bỏ qua
      var type = String(cell(r, m, 'ctype') || ''), note = String(cell(r, m, 'note') || '').trim(), nn = nrm(note + ' ' + type), srcName = String(cell(r, m, 'src') || sc.name).trim();
      var status = /rac/.test(nn) ? 'Không mua' : /chot/.test(nn) ? 'Đã chốt' : /knm|khong nghe|thue bao|tb/.test(nn) ? 'Đang tư vấn' : 'Mới hỏi';
      var ebook = /ladi|ebook|qua tang/.test(nrm(sc.name)); // số từ trang nhận quà ebook: kênh riêng, không tính vào "Số mới" quảng cáo sản phẩm
      var ebWeb = ebook ? ebookFromWeb(r, iMed) : null; // khách bấm từ thucduonglanh.vn (UTM utm_source=website do web gắn vào link)
      rows.push([id, when, String(cell(r, m, 'name') || '').trim(), "'" + phone, ebook ? 'Ebook – quà tặng (' + (ebWeb ? 'Website' : sc.name) + ')' : 'Quảng cáo – ' + srcName, ebook ? 'Ebook quà tặng' + (ebWeb ? ' · từ web' + (ebWeb.pos ? ' (' + ebWeb.pos + ')' : '') : '') : srcName, status, owner, status === 'Mới hỏi' ? '' : when, '', status === 'Không mua' ? 'Số rác' : '', [note, type ? 'Phân loại: ' + type : '', cell(r, m, 'amount') ? 'Đơn: ' + cellText(cell(r, m, 'amount')) : ''].filter(String).join(' · '), '', 'File QC']);
      ids[id] = 1; openBy[phone] = owner; perSale[owner] = (perSale[owner] || 0) + 1; n++;
    });
    perSheet[sc.name] = n;
  });
  var res = { ok: true, newLeads: rows.length, merged: merged, perSale: perSale, perSheet: perSheet, skipped: skipped, writes: writes.length, mode: cfg.mode, since: since };
  if (dry || !rows.length) return res;
  var lock = LockService.getScriptLock(); lock.waitLock(60000);
  try { appendRows(lsh, rows, LEAD_HEADERS.length); } finally { lock.releaseLock(); }
  if (writes.length) {
    if (hasSheetsApi()) { var wd = []; writes.forEach(function (w) { if (w.col !== undefined) wd.push({ range: a1(w.sheet, colLetter(w.col) + w.row), values: [[w.val]] }); if (w.dupCol !== undefined) wd.push({ range: a1(w.sheet, colLetter(w.dupCol) + w.row), values: [[w.val]] }); }); Sheets.Spreadsheets.Values.batchUpdate({ valueInputOption: 'RAW', data: wd }, cfg.fileId); }
    else { var f = SpreadsheetApp.openById(cfg.fileId); writes.forEach(function (w) { var wsx = f.getSheetByName(w.sheet); if (w.col !== undefined) wsx.getRange(w.row, w.col + 1).setValue(w.val); if (w.dupCol !== undefined) wsx.getRange(w.row, w.dupCol + 1).setValue(w.val); }); }
  }
  Object.keys(perSale).forEach(function (n) { var fresh = rows.filter(function (x) { return x[7] === n && x[6] === 'Mới hỏi'; }); if (fresh.length) telegramUser(ss, n, '🙋 <b>' + fresh.length + ' số quảng cáo mới</b> cho bạn:\n' + fresh.slice(0, 15).map(function (x) { return '• ' + esc(x[2]) + ' – <a href="https://zalo.me/' + String(x[3]).replace("'", '') + '">' + String(x[3]).replace("'", '') + '</a> · ' + esc(x[5]); }).join('\n') + '\n\n👉 ' + CRM_URL + '/#tiem-nang'); });
  Object.keys(rr).forEach(function (k) { PropertiesService.getScriptProperties().setProperty(k, rr[k]); });
  cfg.last = Date.now(); PropertiesService.getScriptProperties().setProperty('ads_cfg', JSON.stringify(cfg));
  if (u && u.email) crmLog(ss, u, 'Đồng bộ file', 'QC', '', rows.length + ' số mới', JSON.stringify(perSale));
  return res;
}

/* ================================================================ giao diện Sheet cho nhân viên */

var ORDER_STATUS = ['Mới', 'Đã xác nhận', 'Đang giao', 'Đã giao', 'Huỷ', 'Hoàn', 'Đổi hàng'];
function isVoid(st) { return /huỷ|hủy|hoàn/i.test(String(st || '')); } // đơn huỷ / hoàn: không tính doanh thu, không tính vào khách
var CARE_RESULTS = ['Đã đặt lại', 'Hẹn gọi lại', 'Không nghe máy', 'Đã hỏi thăm', 'Không có nhu cầu'];
var MANUAL_BG = '#f6a623', MANUAL_CELL = '#fff8e6', LOCK_NOTE = 'Máy tự điền';
var GUIDE = '📖 Hướng dẫn', TODAY_TAB = '✅ Việc hôm nay';

var ORDER_NOTES = {
  'Thời gian': 'Lúc khách bấm Đặt hàng. Máy tự điền.',
  'Mã đơn': 'Mã riêng của đơn. Khách chuyển khoản sẽ ghi mã này trong nội dung chuyển khoản.',
  'Điện thoại': 'Số của khách để gọi / nhắn Zalo xác nhận.',
  'Email': 'Khách có thể để trống.',
  'Sản phẩm': 'Món khách mua: tên (quy cách) x số lượng = thành tiền.',
  'Tạm tính': 'Tiền hàng, chưa có phí ship.',
  'Phí ship': '30.000đ. Đơn từ 300.000đ được miễn phí (0).',
  'Tổng': 'Số tiền khách phải trả (đã gồm phí ship).',
  'Thanh toán': 'COD = khách trả tiền khi nhận hàng.\nChuyển khoản = xem tiền đã về tài khoản VCB chưa rồi mới gửi hàng.',
  'Ghi chú': 'Lời nhắn của khách.\nÔ màu cam "⚠ Kiểm tra địa chỉ" = gọi hỏi lại khách phường/xã.',
  'Trạng thái': 'BẠN ĐIỀN. Bấm ▼ để chọn:\nMới → Đã xác nhận → Đang giao → Đã giao.\nKhách không lấy hàng: Huỷ.',
  'Nguồn': 'Khách đến web từ đâu (Facebook, TikTok, Google…). Máy tự điền.',
  'Nguồn đầu tiên': 'Nơi khách biết đến web lần đầu tiên.',
  'Đồng ý nhận tin': 'Có = được gửi ưu đãi.\nKhông = chỉ hỏi thăm, KHÔNG gửi quảng cáo.'
};
var CUS_NOTES = {
  'Điện thoại': 'Mỗi khách là 1 dòng, nhận ra khách bằng số điện thoại.',
  'Số đơn': 'Máy tự đếm từ trang Đơn hàng (không tính đơn Huỷ).',
  'Tổng chi': 'Tổng tiền khách đã mua. Máy tự cộng.',
  'Dự kiến hết hàng': 'Ngày khách dùng gần hết sản phẩm.\nÔ màu đỏ = sắp hết hoặc đã hết → nhắn Zalo nhắc đặt lại.',
  'Nhóm': 'Mới: mua 1 lần.\nQuay lại: mua từ 2 lần.\nVIP: từ 3 đơn hoặc tổng từ 2 triệu.\nSắp mất: 60 ngày chưa mua lại.',
  'Đồng ý nhận tin': 'Có = được gửi ưu đãi.\nKhông = chỉ hỏi thăm, KHÔNG gửi quảng cáo.',
  'Phụ trách': 'BẠN ĐIỀN. Tên người chăm sóc khách này.',
  'Lần CSKH gần nhất': 'BẠN ĐIỀN sau khi gọi / nhắn khách.\nBấm đúp vào ô → chọn ngày trên lịch.\n(Máy tính: bấm Ctrl + ; để điền ngày hôm nay.)',
  'Kết quả CSKH': 'BẠN ĐIỀN. Bấm ▼ chọn kết quả (hoặc tự gõ).',
  'Ghi chú CSKH': 'BẠN ĐIỀN. Điều cần nhớ về khách: thích gì, hẹn gì, dị ứng gì…',
  'Hẹn gọi lại': 'Ngày khách hẹn gọi lại. Đến ngày, khách sẽ hiện trong danh sách chăm sóc.'
};

/** Tạo menu "🌿 Thực Dưỡng Lành" mỗi khi mở file. */
function onOpen() {
  SpreadsheetApp.getUi().createMenu('🌿 Thực Dưỡng Lành')
    .addItem('Sắp xếp & tô màu lại file', 'tidySheet')
    .addItem('Làm mới danh sách khách hàng', 'rebuildCustomers')
    .addToUi();
}

/** Chạy 1 lần (hoặc từ menu): thêm trang Hướng dẫn, tô màu, ô chọn, định dạng tiền/ngày. Không xoá dữ liệu. */
function tidySheet() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  ss.setSpreadsheetTimeZone(TZ);
  var os = sheet(ss, 'Đơn hàng', ORDER_HEADERS), cs = sheet(ss, 'Khách hàng', CUS_HEADERS), ls = sheet(ss, 'Liên hệ', CONTACT_HEADERS);
  cycleSheet(ss); templateSheet(ss);
  cleanNotes(os);
  tidyOrders(os); tidyCustomers(cs); tidyContacts(ls); tidyRefSheets(ss);
  dropTodayTab(ss); guideSheet(ss); // trang "✅ Việc hôm nay" cũ: CRM đã thay → xoá
  [[GUIDE, '#e53935'], ['Đơn hàng', '#1f5f3a'], ['Khách hàng', '#1f5f3a'], ['Liên hệ', '#1f5f3a'], ['Mẫu tin nhắn CSKH', '#9e9e9e'], ['Chu kỳ dùng', '#9e9e9e']].forEach(function (t, i) {
    var sh = ss.getSheetByName(t[0]); if (!sh) return;
    sh.setTabColor(t[1]); ss.setActiveSheet(sh); ss.moveActiveSheet(i + 1);
  });
  ss.setActiveSheet(ss.getSheetByName(GUIDE));
}

function colOf(headers, name) { return headers.indexOf(name) + 1; }
function letterOf(headers, name) { return String.fromCharCode(64 + colOf(headers, name)); }
function ensureRows(sh, n) { if (sh.getMaxRows() < n) sh.insertRowsAfter(sh.getMaxRows(), n - sh.getMaxRows()); }
function dataCol(sh, headers, name) { return sh.getRange(2, colOf(headers, name), sh.getMaxRows() - 1, 1); }

/** Tiêu đề: xanh = máy tự điền, cam = nhân viên điền; di chuột vào tiêu đề để xem giải thích. */
function paintHeader(sh, headers, manual, notes) {
  var n = headers.length;
  styleHeader(sh, n);
  sh.getRange(1, 1, 1, n).setWrap(true).setVerticalAlignment('middle').setHorizontalAlignment('center');
  sh.setRowHeight(1, 44);
  headers.forEach(function (h, i) {
    var cell = sh.getRange(1, i + 1);
    cell.setNote(notes && notes[h] ? notes[h] : '');
    if (manual.indexOf(h) >= 0) { cell.setBackground(MANUAL_BG).setFontColor('#000000'); dataCol(sh, headers, h).setBackground(MANUAL_CELL); }
  });
  sh.getRange(2, 1, sh.getMaxRows() - 1, n).setVerticalAlignment('top');
}

/** Khoá "mềm" các cột máy tự điền: vẫn sửa được nhưng Sheet sẽ hỏi lại, tránh sửa nhầm. */
function softLock(sh, headers, manual) {
  sh.getProtections(SpreadsheetApp.ProtectionType.RANGE).forEach(function (p) { if (p.getDescription() === LOCK_NOTE) p.remove(); });
  sh.getRange(1, 1, 1, headers.length).protect().setDescription(LOCK_NOTE).setWarningOnly(true);
  headers.forEach(function (h) { if (manual.indexOf(h) < 0) dataCol(sh, headers, h).protect().setDescription(LOCK_NOTE).setWarningOnly(true); });
}

/** Thu gọn các cột ít dùng (bấm dấu + phía trên để mở lại). */
function foldColumns(sh, headers, names) {
  names.forEach(function (h) {
    var c = colOf(headers, h); if (c < 1) return;
    if (sh.getColumnGroupDepth(c) === 0) sh.getRange(1, c, 1, 1).shiftColumnGroupDepth(1);
    try { sh.getColumnGroup(c, 1).collapse(); } catch (e) { }
  });
}

function widths(sh, headers, map) { Object.keys(map).forEach(function (h) { var c = colOf(headers, h); if (c > 0) sh.setColumnWidth(c, map[h]); }); }
function cf(range, formula, bg, font, strike) {
  var b = SpreadsheetApp.newConditionalFormatRule().whenFormulaSatisfied(formula).setBackground(bg).setRanges([range]);
  if (font) b.setFontColor(font); if (strike) b.setStrikethrough(true);
  return b.build();
}

function cleanNotes(sh) {
  if (sh.getLastRow() < 2) return;
  var rg = sh.getRange(2, colOf(ORDER_HEADERS, 'Ghi chú'), sh.getLastRow() - 1, 1), v = rg.getValues(), changed = false;
  v.forEach(function (r) {
    var s = String(r[0] || ''), t = s.replace(/Địa chỉ cũ:\s*(\.|$)/g, '').replace(/(\.\s*){2,}/g, '. ').replace(/\s{2,}/g, ' ').trim();
    if (t !== s) { r[0] = t; changed = true; }
  });
  if (changed) rg.setValues(v);
}

function tidyOrders(sh) {
  var H = ORDER_HEADERS, manual = ['Trạng thái', 'Đã nhận tiền', 'Đơn vị vận chuyển', 'Mã vận đơn', 'NV bán'];
  ensureRows(sh, 2000);
  paintHeader(sh, H, manual, ORDER_NOTES);
  dataCol(sh, H, 'Thời gian').setNumberFormat('dd/MM/yyyy HH:mm');
  ['Tạm tính', 'Phí ship', 'Tổng'].forEach(function (h) { dataCol(sh, H, h).setNumberFormat('#,##0" ₫"'); });
  ['Địa chỉ', 'Sản phẩm', 'Ghi chú'].forEach(function (h) { dataCol(sh, H, h).setWrap(true); });
  dataCol(sh, H, 'Trạng thái').setDataValidation(SpreadsheetApp.newDataValidation().requireValueInList(ORDER_STATUS, true)
    .setAllowInvalid(true).setHelpText('Bấm ▼ để chọn trạng thái đơn').build()).setFontWeight('bold').setHorizontalAlignment('center');
  widths(sh, H, { 'Thời gian': 115, 'Mã đơn': 115, 'Khách hàng': 140, 'Điện thoại': 105, 'Email': 150, 'Tỉnh/TP': 100, 'Phường/Xã': 130, 'Địa chỉ': 220,
    'Sản phẩm': 330, 'Tạm tính': 95, 'Phí ship': 80, 'Tổng': 100, 'Thanh toán': 105, 'Ghi chú': 220, 'Trạng thái': 120, 'Nguồn': 130, 'Nguồn đầu tiên': 130, 'Đồng ý nhận tin': 90, 'Đã nhận tiền': 150, 'Đơn vị vận chuyển': 110, 'Mã vận đơn': 130, 'NV bán': 110 });
  sh.setFrozenColumns(3);
  var all = sh.getRange(2, 1, sh.getMaxRows() - 1, H.length), s = '$' + letterOf(H, 'Trạng thái') + '2';
  var note = dataCol(sh, H, 'Ghi chú');
  sh.setConditionalFormatRules([
    SpreadsheetApp.newConditionalFormatRule().whenTextContains('Kiểm tra địa chỉ').setBackground('#ffc978').setBold(true).setRanges([note]).build(),
    cf(all, '=' + s + '="Huỷ"', '#eeeeee', '#9e9e9e', true),
    cf(all, '=' + s + '="Đã giao"', '#e6f4ea'),
    cf(all, '=OR(' + s + '="Đã xác nhận",' + s + '="Đang giao")', '#e3f0fb'),
    cf(all, '=' + s + '="Mới"', '#fff3c4')
  ]);
  softLock(sh, H, manual.concat(['Ghi chú']));
  foldColumns(sh, H, ['Email', 'Tạm tính', 'Phí ship', 'Nguồn đầu tiên']);
}

function tidyCustomers(sh) {
  var H = CUS_HEADERS, manual = ['Phụ trách', 'Lần CSKH gần nhất', 'Kết quả CSKH', 'Ghi chú CSKH', 'Hẹn gọi lại'];
  ensureRows(sh, 2000);
  paintHeader(sh, H, manual, CUS_NOTES);
  dataCol(sh, H, 'Tổng chi').setNumberFormat('#,##0" ₫"');
  ['Đơn đầu', 'Đơn gần nhất', 'Dự kiến hết hàng', 'Lần CSKH gần nhất', 'Hẹn gọi lại'].forEach(function (h) { dataCol(sh, H, h).setNumberFormat('dd/MM/yyyy'); });
  ['Địa chỉ', 'Sản phẩm đã mua', 'Ghi chú CSKH'].forEach(function (h) { dataCol(sh, H, h).setWrap(true); });
  dataCol(sh, H, 'Lần CSKH gần nhất').setDataValidation(SpreadsheetApp.newDataValidation().requireDate().setAllowInvalid(true)
    .setHelpText('Bấm đúp để chọn ngày trên lịch').build());
  dataCol(sh, H, 'Kết quả CSKH').setDataValidation(SpreadsheetApp.newDataValidation().requireValueInList(CARE_RESULTS, true)
    .setAllowInvalid(true).setHelpText('Bấm ▼ để chọn, hoặc tự gõ').build());
  widths(sh, H, { 'Điện thoại': 105, 'Tên': 140, 'Địa chỉ': 200, 'Tỉnh/TP': 100, 'Phường/Xã': 120, 'Số đơn': 65, 'Tổng chi': 100, 'Đơn đầu': 95, 'Đơn gần nhất': 95,
    'Sản phẩm đã mua': 300, 'Dự kiến hết hàng': 100, 'Nhóm': 85, 'Đồng ý nhận tin': 85, 'Nguồn đầu tiên': 120, 'Phụ trách': 110, 'Lần CSKH gần nhất': 105, 'Kết quả CSKH': 140, 'Ghi chú CSKH': 220, 'Hẹn gọi lại': 100 });
  sh.setFrozenColumns(2);
  var g = dataCol(sh, H, 'Nhóm'), k = '$' + letterOf(H, 'Dự kiến hết hàng') + '2';
  sh.setConditionalFormatRules([
    cf(dataCol(sh, H, 'Dự kiến hết hàng'), '=AND(' + k + '<>"",INT(' + k + ')-TODAY()<=2)', '#f8c9c4', '#b3261e'),
    SpreadsheetApp.newConditionalFormatRule().whenTextEqualTo('VIP').setBackground('#ffe08a').setBold(true).setRanges([g]).build(),
    SpreadsheetApp.newConditionalFormatRule().whenTextEqualTo('Sắp mất').setBackground('#f8c9c4').setRanges([g]).build(),
    SpreadsheetApp.newConditionalFormatRule().whenTextEqualTo('Quay lại').setBackground('#d7f0dd').setRanges([g]).build()
  ]);
  softLock(sh, H, manual);
  foldColumns(sh, H, ['Tỉnh/TP', 'Phường/Xã', 'Đơn đầu', 'Nguồn đầu tiên']);
}

function tidyContacts(sh) {
  var H = CONTACT_HEADERS.concat(['Đã trả lời', 'Ghi chú']);
  sh.getRange(1, 1, 1, H.length).setValues([H]);
  ensureRows(sh, 1000);
  paintHeader(sh, H, ['Đã trả lời', 'Ghi chú'], { 'Đã trả lời': 'BẠN ĐIỀN. Gọi / nhắn khách xong thì bấm vào ô để tích ✓.', 'Ghi chú': 'BẠN ĐIỀN. Đã tư vấn gì, hẹn gì.' });
  dataCol(sh, H, 'Đã trả lời').setDataValidation(SpreadsheetApp.newDataValidation().requireCheckbox().build()); // chỉ gắn ô tích, không ghi giá trị (để đơn mới vẫn nối đúng dòng)
  dataCol(sh, H, 'Thời gian').setNumberFormat('dd/MM/yyyy HH:mm');
  ['Nội dung', 'Ghi chú'].forEach(function (h) { dataCol(sh, H, h).setWrap(true); });
  widths(sh, H, { 'Thời gian': 115, 'Họ tên': 150, 'Điện thoại': 105, 'Email': 170, 'Nội dung': 320, 'Trang': 200, 'Đã trả lời': 80, 'Ghi chú': 220 });
  var done = '$' + letterOf(H, 'Đã trả lời') + '2';
  sh.setConditionalFormatRules([cf(sh.getRange(2, 1, sh.getMaxRows() - 1, H.length), '=' + done + '=TRUE', '#e6f4ea', '#6b6b6b')]);
}

function tidyRefSheets(ss) {
  var cy = ss.getSheetByName('Chu kỳ dùng');
  if (cy) {
    styleHeader(cy, 4); cy.getRange(1, 3).setBackground(MANUAL_BG).setFontColor('#000000');
    cy.getRange(1, 1, 1, 4).setWrap(true);
    cy.getRange(1, 1).setNote('Một phần tên sản phẩm, ví dụ "DILVANG" là đủ.');
    cy.getRange(1, 2).setNote('Một phần quy cách, ví dụ "500g". Để trống = mọi quy cách của sản phẩm đó.');
    cy.getRange(1, 3).setNote('Khách dùng hết 1 hộp/hũ trong bao nhiêu ngày. Sửa số này nếu thực tế khách dùng nhanh / chậm hơn → lịch nhắc sẽ đúng hơn.');
  }
  var tp = ss.getSheetByName('Mẫu tin nhắn CSKH');
  if (tp) { styleHeader(tp, 3); tp.getRange(2, 1, Math.max(tp.getLastRow() - 1, 1), 3).setVerticalAlignment('top').setWrap(true); }
}

/** Trang tự cập nhật: đơn mới chưa xác nhận, khách sắp hết hàng, liên hệ chưa trả lời. */
function todaySheet(ss) {
  var sh = ss.getSheetByName(TODAY_TAB) || ss.insertSheet(TODAY_TAB);
  try { sh.hideSheet(); } catch (e) { } // CRM đã thay trang này → để ẩn
  sh.getRange(1, 1, sh.getMaxRows(), sh.getMaxColumns()).breakApart(); sh.clear(); sh.setConditionalFormatRules([]);
  var O = "'Đơn hàng'!", K = "'Khách hàng'!", L = "'Liên hệ'!";
  var oS = letterOf(ORDER_HEADERS, 'Trạng thái'), kR = letterOf(CUS_HEADERS, 'Dự kiến hết hàng'), kL = letterOf(CUS_HEADERS, 'Đơn gần nhất'), kC = letterOf(CUS_HEADERS, 'Lần CSKH gần nhất');
  var cols = function (H, names) { return names.map(function (n) { return colOf(H, n); }).join(','); };
  sh.getRange('A1').setValue('✅ VIỆC HÔM NAY  –  trang này máy tự cập nhật, bạn không cần sửa gì ở đây').setFontSize(14).setFontWeight('bold');
  sh.getRange('A2').setFormula('="Hôm nay: "&TEXT(TODAY(),"dd/mm/yyyy")&"   •   Làm xong việc nào thì sang đúng trang đó cập nhật, dòng đó sẽ tự biến mất khỏi đây."').setFontColor('#555555');
  var blocks = [
    { at: 1, title: '1️⃣ ĐƠN MỚI – gọi khách xác nhận', how: '→ Xong: trang Đơn hàng, cột Trạng thái chọn "Đã xác nhận"', color: '#fff3c4',
      head: ['Mã đơn', 'Khách hàng', 'Điện thoại', 'Tổng', 'Thanh toán', 'Ghi chú'],
      f: '=IFERROR(CHOOSECOLS(FILTER(' + O + 'A2:R,' + O + oS + '2:' + oS + '="Mới"),' + cols(ORDER_HEADERS, ['Mã đơn', 'Khách hàng', 'Điện thoại', 'Tổng', 'Thanh toán', 'Ghi chú']) + '),"Không có đơn mới 🎉")',
      fmt: { 3: '#,##0" ₫"' }, w: [115, 140, 105, 100, 105, 220] },
    { at: 8, title: '2️⃣ KHÁCH SẮP HẾT HÀNG – nhắn Zalo nhắc đặt lại', how: '→ Xong: trang Khách hàng, điền ô "Lần CSKH gần nhất"', color: '#f8c9c4',
      head: ['Tên', 'Điện thoại', 'Nhóm', 'Dự kiến hết', 'Đã mua', 'Phụ trách'],
      f: '=IFERROR(CHOOSECOLS(FILTER(' + K + 'A2:S,' + K + kR + '2:' + kR + '<>"",INT(' + K + kR + '2:' + kR + ')-TODAY()<=2,INT(' + K + kR + '2:' + kR + ')-TODAY()>=-7,TODAY()-INT(' + K + kL + '2:' + kL + ')>=2,(' + K + kC + '2:' + kC + '="")+(' + K + kC + '2:' + kC + '<' + K + kR + '2:' + kR + '-3)),' + cols(CUS_HEADERS, ['Tên', 'Điện thoại', 'Nhóm', 'Dự kiến hết hàng', 'Sản phẩm đã mua', 'Phụ trách']) + '),"Không có khách nào 🎉")',
      fmt: { 3: 'dd/MM/yyyy' }, w: [140, 105, 80, 95, 260, 100] },
    { at: 15, title: '3️⃣ LIÊN HỆ CHƯA TRẢ LỜI', how: '→ Xong: trang Liên hệ, tích ô "Đã trả lời"', color: '#e3f0fb',
      head: ['Thời gian', 'Họ tên', 'Điện thoại', 'Nội dung'],
      f: '=IFERROR(CHOOSECOLS(FILTER(' + L + 'A2:H,' + L + 'A2:A<>"",' + L + 'G2:G<>TRUE),1,2,3,5),"Không có liên hệ nào 🎉")',
      fmt: { 0: 'dd/MM/yyyy HH:mm' }, w: [115, 140, 105, 300] }
  ];
  blocks.forEach(function (b) {
    var n = b.head.length;
    sh.getRange(4, b.at, 1, n).merge().setValue(b.title).setFontWeight('bold').setBackground(b.color).setWrap(true);
    sh.getRange(5, b.at, 1, n).merge().setValue(b.how).setFontStyle('italic').setFontColor('#555555').setWrap(true);
    sh.getRange(6, b.at, 1, n).setValues([b.head]).setFontWeight('bold').setBackground('#1f5f3a').setFontColor('#ffffff');
    sh.getRange(7, b.at).setFormula(b.f);
    Object.keys(b.fmt).forEach(function (i) { sh.getRange(7, b.at + Number(i), 500, 1).setNumberFormat(b.fmt[i]); });
    b.w.forEach(function (w, i) { sh.setColumnWidth(b.at + i, w); });
    sh.getRange(7, b.at, 500, n).setVerticalAlignment('top').setWrap(true);
    if (b.at > 1) sh.setColumnWidth(b.at - 1, 24);
  });
  sh.setRowHeight(4, 36); sh.setFrozenRows(6);
}

/** Trang Hướng dẫn – viết thật đơn giản, người mới đọc 2 phút là dùng được. */
function guideSheet(ss) {
  var sh = ss.getSheetByName(GUIDE) || ss.insertSheet(GUIDE);
  sh.clear(); sh.setConditionalFormatRules([]);
  var rows = [
    ['📖 HƯỚNG DẪN DÙNG FILE NÀY', '(đọc 1 phút)', 'title'],
    ['', '', ''],
    ['FILE NÀY LÀ GÌ?', 'Đây là KHO DỮ LIỆU của CRM: đơn web, đơn và ghi chú nhập từ file sale, khách hàng, khách hỏi, nhật ký chăm sóc. Máy tự ghi vào file này.', 'h'],
    ['', '', ''],
    ['HẰNG NGÀY LÀM VIỆC Ở ĐÂU?', 'Trên CRM: https://crm.thucduonglanh.vn (đăng nhập bằng mã gửi về email).', 'h'],
    ['Việc hôm nay', 'Tab "Hôm nay" trên CRM cho biết hôm nay cần gọi ai, đơn nào cần xác nhận, khách nào sắp hết hàng.', ''],
    ['Đơn hàng', 'Xác nhận, đổi trạng thái, nhập mã vận đơn ngay trên CRM (tab "Đơn hàng").', ''],
    ['Chăm sóc khách', 'Bấm "💬 Chăm sóc" trên CRM: có sẵn tin mẫu, mở Zalo, bấm 1 lần là lưu kết quả.', ''],
    ['Hướng dẫn chi tiết', 'https://crm.thucduonglanh.vn/huong-dan/', ''],
    ['', '', ''],
    ['CÁC TRANG TRONG FILE', '', 'h'],
    ['Đơn hàng', 'Tất cả đơn. Đơn mới nhất ở DƯỚI CÙNG.', ''],
    ['Khách hàng', 'Mỗi khách 1 dòng (gộp theo số điện thoại). Máy tự tính lại từ trang Đơn hàng.', ''],
    ['Khách tiềm năng', 'Khách hỏi (số quảng cáo, liên hệ web, ebook…). Trên CRM là tab "Khách hỏi".', ''],
    ['Nhật ký CSKH', 'Mọi thao tác trên CRM: ai làm, lúc nào, kết quả gì.', ''],
    ['Mẫu tin nhắn CSKH', 'Tin mẫu hiện trong hộp Chăm sóc. Quản lý sửa được trên CRM (Cài đặt) hoặc tại đây.', ''],
    ['Chu kỳ dùng', 'Khách dùng hết 1 hộp trong mấy ngày, để tính ngày sắp hết hàng. Chỉ quản lý sửa.', ''],
    ['Nhân sự CRM', 'Ai được đăng nhập CRM và quyền gì. Chỉ quản trị sửa.', ''],
    ['Các trang khác', 'Nguồn dữ liệu sale, Ghi ngược file sale, Tự nhập file sale, Mục tiêu, Góp ý, Đo tốc độ CRM: máy tự ghi, không cần sửa.', ''],
    ['', '', ''],
    ['KHÔNG ĐƯỢC LÀM', '', 'h'],
    ['❌', 'Không xoá dòng, không đổi tên trang, không sửa chữ ở dòng tiêu đề, không thêm cột. (Đơn không lấy thì chọn "Huỷ", đừng xoá.)', ''],
    ['❌', 'Không chụp, gửi file hay danh sách khách ra ngoài. Đây là thông tin cá nhân của khách, pháp luật bắt buộc phải giữ kín.', ''],
    ['❌', 'Khách "Đồng ý nhận tin: Không" thì chỉ hỏi thăm, không gửi quảng cáo.', ''],
    ['', '', ''],
    ['CẦN GIÚP?', 'Hỏi anh Sơn, hoặc bấm "💡 Góp ý" trên CRM.', 'h']
  ];
  sh.getRange(1, 1, rows.length, 2).setValues(rows.map(function (r) { return [r[0], r[1]]; }));
  sh.setColumnWidth(1, 230); sh.setColumnWidth(2, 720);
  sh.getRange(1, 1, rows.length, 2).setWrap(true).setVerticalAlignment('middle').setFontSize(11);
  rows.forEach(function (r, i) {
    var a = sh.getRange(i + 1, 1), row = sh.getRange(i + 1, 1, 1, 2), st = r[2];
    if (st === 'title') { row.setFontSize(16).setFontWeight('bold').setFontColor('#1f5f3a'); sh.setRowHeight(i + 1, 40); }
    else if (st === 'h') { a.setFontWeight('bold').setFontColor('#ffffff').setBackground('#1f5f3a'); sh.getRange(i + 1, 2).setFontWeight('bold'); sh.setRowHeight(i + 1, 30); }
    else if (st.indexOf('c:') === 0) { var p = st.split(':'); a.setBackground(p[1]).setFontColor(p[2]).setFontWeight('bold'); }
    else if (r[0]) a.setFontWeight('bold');
  });
  sh.setFrozenRows(1); sh.setHiddenGridlines(true);
}

function dropTodayTab(ss) { var t = ss.getSheetByName(TODAY_TAB); if (t && ss.getSheets().length > 1) ss.deleteSheet(t); }

/** Chạy 1 lần trong trình soạn Apps Script (05/10/2026): viết lại trang Hướng dẫn chỉ sang CRM, xoá trang "✅ Việc hôm nay" cũ,
 *  đổi tên mẫu tin "… sau khi đặt" → "… sau khi nhận hàng" (lịch chăm sóc đã tính từ ngày nhận). Chạy lại nhiều lần cũng không sao. */
function suaHuongDanSheet() {
  var ss = SpreadsheetApp.getActiveSpreadsheet(), n = 0;
  dropTodayTab(ss); guideSheet(ss);
  var tp = ss.getSheetByName('Mẫu tin nhắn CSKH');
  if (tp && tp.getLastRow() > 1) {
    var rg = tp.getRange(2, 1, tp.getLastRow() - 1, 1), v = rg.getValues();
    v.forEach(function (r) { var t = String(r[0]); if (/sau khi đặt/i.test(t)) { r[0] = t.replace(/sau khi đặt/i, 'sau khi nhận hàng'); n++; } });
    if (n) rg.setValues(v);
  }
  var g = ss.getSheetByName(GUIDE); if (g) { g.setTabColor('#e53935'); ss.setActiveSheet(g); ss.moveActiveSheet(1); }
  try { dataChanged(); } catch (e) {}
  console.log('Xong: viết lại Hướng dẫn, xoá trang Việc hôm nay, đổi tên ' + n + ' mẫu tin.');
}

/* ================================================================ tiện ích */
function sheet(ss, name, headers) {
  var sh = ss.getSheetByName(name);
  if (!sh && name === 'Đơn hàng' && ss.getSheets().length === 1 && ss.getSheets()[0].getLastRow() <= 1) {
    sh = ss.getSheets()[0].setName(name); // dùng trang tính đầu tiên có sẵn
    sh.clear();
  }
  if (!sh) sh = ss.insertSheet(name);
  if (sh.getLastRow() === 0) sh.appendRow(headers);
  var cur = sh.getRange(1, 1, 1, Math.max(sh.getLastColumn(), 1)).getValues()[0];
  if (cur.length < headers.length || String(cur[headers.length - 1]) !== headers[headers.length - 1]) { sh.getRange(1, 1, 1, headers.length).setValues([headers]); styleHeader(sh, headers.length); } // thêm cột mới khi nâng cấp
  return sh;
}
function styleHeader(sh, n) { sh.getRange(1, 1, 1, n).setFontWeight('bold').setBackground('#1f5f3a').setFontColor('#ffffff'); sh.setFrozenRows(1); }
function telegram(text) {
  if (!TELEGRAM_TOKEN || !TELEGRAM_CHAT_IDS) return;
  TELEGRAM_CHAT_IDS.split(',').forEach(function (id) { telegramTo(id.trim(), text); });
}
/** Telegram nhận tối đa 4096 ký tự/tin → tự chia theo dòng; lỗi ghi vào Nhật ký thực thi (trước đây bị bỏ qua im lặng). */
function tgChunks(text) {
  var out = [], cur = ''; String(text).split('\n').forEach(function (l) { if ((cur + '\n' + l).length > 3800 && cur) { out.push(cur); cur = l; } else cur = cur ? cur + '\n' + l : l; }); if (cur) out.push(cur); return out;
}
function esc(s) { return String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;'); }
// Chạy thử hàm này trong trình soạn Apps Script để kiểm tra Telegram
function testTelegram() { telegram('✅ Kết nối báo đơn Thực Dưỡng Lành thành công!'); }
function fmt(n) { return (Number(n) || 0).toLocaleString('vi-VN') + ' ₫'; }
function json(o) { return ContentService.createTextOutput(JSON.stringify(o)).setMimeType(ContentService.MimeType.JSON); }
