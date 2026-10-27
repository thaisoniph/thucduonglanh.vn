/* CRM Thực Dưỡng Lành – crm.thucduonglanh.vn
 * Trang tĩnh, dữ liệu nằm trong Google Sheet, đọc/ghi qua Apps Script (backend/google-apps-script.gs, type: 'crm'). */
(function () {
  'use strict';
  var CFG = window.CRM_CONFIG || {};
  var DAY = 864e5;
  var S = { token: store('crm_token'), user: null, d: null, loading: false, loadedAt: 0, who: store('crm_who') || '', f: {}, units: null };

  var TASKS = {
    callback: { icon: '📞', title: 'Hẹn gọi lại', tip: 'khách đã hẹn đến hôm nay', tpl: '' },
    d1: { icon: '📦', title: 'Hỏi nhận hàng, hướng dẫn dùng', tip: 'khách vừa nhận hàng, hoặc hàng dự kiến đã tới hôm qua (miền Bắc: ngày thứ 4, ở xa: ngày thứ 6 sau khi đặt)', tpl: '1 ngày' },
    runout: { icon: '⏰', title: 'Sắp hết / đã hết sản phẩm', tip: 'nhắc đặt lại trước khi hết để hàng tới kịp, đơn từ 300K được freeship', tpl: 'hết' },
    d7: { icon: '🤝', title: 'Hỏi thăm sau 1 tuần', tip: 'Khách mua lần đầu, 7 ngày sau khi nhận hàng: dùng có khó khăn gì, cần hỗ trợ gì', tpl: '7 ngày' },
    d14: { icon: '💬', title: 'Xin cảm nhận', tip: '14 ngày sau khi nhận hàng', tpl: '14' },
    d30: { icon: '🌿', title: 'Giới thiệu sản phẩm phù hợp', tip: '30 ngày sau khi nhận hàng', tpl: '30' },
    winback: { icon: '💌', title: 'Mời quay lại', tip: '60 ngày sau khi nhận hàng, chưa mua lại', tpl: '60' },
    old: { icon: '🔁', title: 'Khách cũ lâu chưa gọi', tip: 'quá 30 ngày chưa phản hồi, khách chi nhiều lên trước', tpl: '60' }
  };
  var TASK_ORDER = ['callback', 'd1', 'runout', 'd7', 'd14', 'd30', 'winback'];
  var TASK_LOG = { callback: 'Gọi lại theo hẹn', d1: 'Hỏi nhận hàng', runout: 'Nhắc đặt lại', d7: 'Hỏi thăm sau 1 tuần', d14: 'Xin cảm nhận', d30: 'Giới thiệu sản phẩm', winback: 'Mời quay lại', old: 'Gọi khách cũ', other: 'Chăm sóc' };
  var OLD_DAYS = 30, OLD_PER_DAY = 15; // khách cũ quá 30 ngày chưa phản hồi: mỗi ngày gợi ý 15 khách chi nhiều nhất
  var STATUS = ['Mới', 'Đã xác nhận', 'Đang giao', 'Đã giao', 'Huỷ', 'Hoàn', 'Đổi hàng'];
  var ST_CLS = { 'Mới': 'st-moi', 'Đã xác nhận': 'st-xn', 'Đang giao': 'st-giao', 'Đã giao': 'st-xong', 'Huỷ': 'st-huy', 'Hoàn': 'st-huy', 'Đổi hàng': 'st-giao' };
  function isVoid(st) { return /huỷ|hủy|hoàn/i.test(String(st || '')); } // huỷ / hoàn: không tính doanh số
  /** Doanh thu = tiền đơn đã thu (anh Sơn chốt 16/10/2026): không huỷ / hoàn và (Đã giao / Đổi hàng = COD đã thu, hoặc đã đánh dấu nhận chuyển khoản).
   *  Doanh số (26/10/2026) = tổng mọi đơn, GỒM đơn hoàn / huỷ; luôn kèm ô ↩️ Hoàn / huỷ để thấy bức tranh tổng. Mục tiêu, thi đua, hoa hồng của sale vẫn không tính đơn hoàn / huỷ. */
  /** Tiền tính hoa hồng = tiền hàng, không gồm phí ship (anh Sơn chốt 16/10/2026). Đơn nhập từ file sale không tách được ship (shipping = 0) thì tính cả số tiền. */
  function commBase(o) { return Math.max(0, (o.total || 0) - (o.shipping || 0)); }
  function isPaidOrder(o) { return !isVoid(o.status) && (/^(Đã giao|Đổi hàng)$/.test(o.status || '') || !!o.paid); }
  var NEXT = { 'Mới': 'Đã xác nhận', 'Đã xác nhận': 'Đang giao', 'Đang giao': 'Đã giao' };
  var NEXT_LABEL = { 'Mới': '✅ Xác nhận', 'Đã xác nhận': '🚚 Đang giao', 'Đang giao': '📬 Đã giao' };
  var RESULTS = ['Đã đặt lại', 'Hẹn gọi lại', 'Không nghe máy', 'Đã hỏi thăm', 'Không có nhu cầu'];
  // Ghi nhanh 1 chạm (giống cách sale viết tắt trên Sheet): tự chọn kết quả + tự hẹn ngày gọi lại
  var QUICK = [
    { k: 'knm', l: '📵 Không nghe máy', r: 'Không nghe máy', n: 'knm', d: 2 },
    { k: 'tb', l: '📴 Thuê bao / tắt máy', r: 'Không nghe máy', n: 'thuê bao', d: 3 },
    { k: 'tcn', l: '🙅 Từ chối nghe', r: 'Không nghe máy', n: 'từ chối nghe', d: 7 },
    { k: 'ok', l: '👍 Dùng ok', r: 'Đã hỏi thăm', n: 'kh dùng ok', d: 0 },
    { k: 'con', l: '📦 Còn hàng', r: 'Hẹn gọi lại', n: 'kh còn nhiều', d: 14 },
    { k: 'tien', l: '💸 Hết tiền', r: 'Hẹn gọi lại', n: 'kh hết tiền, hẹn tháng sau', d: 30 },
    { k: 'mua', l: '🛒 Đặt lại', r: 'Đã đặt lại', n: 'kh đặt lại', d: 0, order: true },
    { k: 'thoi', l: '🚫 Không dùng nữa', r: 'Không có nhu cầu', n: 'kh không dùng nữa', d: 0 },
    { k: 'nhan', l: '📦 Đã nhận, đã hướng dẫn dùng', r: 'Đã hỏi thăm', n: 'kh đã nhận hàng, đã hướng dẫn dùng', d: 0, received: 1, only: 'd1' },
    { k: 'chuanhan', l: '🚚 Chưa nhận hàng', r: 'Hẹn gọi lại', n: 'kh chưa nhận được hàng', d: 2, only: 'd1' }
  ];
  var SOURCES = ['Zalo', 'Điện thoại', 'Facebook', 'TikTok', 'Shopee', 'Khách quen giới thiệu', 'Tại cửa hàng', 'Tờ rơi / Sự kiện', 'Khác'];
  var GROUP_CLS = { 'VIP': 'vip', 'Quay lại': 'back', 'Mới': 'new', 'Sắp mất': 'risk' };
  var LEAD_ST = ['Mới hỏi', 'Đang tư vấn', 'Đã chốt', 'Không mua'];
  var LEAD_CLS = { 'Mới hỏi': 'st-moi', 'Đang tư vấn': 'st-xn', 'Đã chốt': 'st-xong', 'Không mua': 'st-huy' };
  var CHANNELS = ['Facebook', 'Zalo', 'Khách giới thiệu', 'TikTok', 'Điện thoại', 'Form website', 'Shopee', 'Sự kiện / hội thảo', 'Khác']; // 20/10/2026: “Người quen giới thiệu” → “Khách giới thiệu” (chọn được người giới thiệu)
  var LEAD_RESULTS = [{ v: 'Đã tư vấn, khách cân nhắc', days: 2 }, { v: 'Hẹn liên hệ lại', days: 2 }, { v: 'Không nghe máy', days: 1 }, { v: 'Khách chốt mua', close: true }, { v: 'Khách không mua', lost: true }];
  var LOST_REASONS = ['Giá cao', 'Chưa có nhu cầu', 'Đã mua nơi khác', 'Không liên lạc được', 'Khác'];
  // Đơn vị vận chuyển → link tra cứu ({c} = mã vận đơn). Hãng không có link thẳng thì mở trang tra cứu, mã được copy sẵn để dán.
  var CARRIERS = { 'Viettel Post': 'https://viettelpost.vn/viettelpost-iframe/tra-cuu-hanh-trinh-don-hang-v3-recaptcha?orderString={c}', 'BEST Express': 'https://www.best-inc.vn/track?bills={c}', 'GHN': 'https://donhang.ghn.vn/?order_code={c}', 'GHTK': 'https://i.ghtk.vn/{c}', 'J&T Express': 'https://jtexpress.vn/vi/tracking?type=track&billcode={c}', 'SPX Express': 'https://spx.vn/track?{c}', 'VNPost': 'https://vnpost.vn/', 'Xe ôm': '', 'Ahamove': '', 'Grab / Be': '', 'Tự giao': '' };
  var CAR_MAIN = ['BEST Express', 'Viettel Post', 'Xe ôm', 'Grab / Be']; // hãng hay dùng hiện sẵn ở form lên đơn, hãng khác bấm "＋ Hãng khác" (anh Sơn 20/10/2026)
  /** Ghi chú giao hàng hay dùng – bấm để thêm / bỏ trong ô ghi chú. Cặp trái nghĩa (cho / không cho xem hàng, sáng / chiều) bấm cái này thì bỏ cái kia. */
  var NOTE_QUICK = ['Gọi trước khi giao', 'Giao giờ hành chính', 'Cho xem hàng', 'Không cho xem hàng', 'Giao buổi sáng', 'Giao buổi chiều', 'Giao cuối tuần', 'Gửi bảo vệ / lễ tân', 'Giao gấp'];
  var NOTE_PAIR = { 'Cho xem hàng': 'Không cho xem hàng', 'Không cho xem hàng': 'Cho xem hàng', 'Giao buổi sáng': 'Giao buổi chiều', 'Giao buổi chiều': 'Giao buổi sáng' };


  /** Tên hãng chuẩn của đơn: khớp tên gõ tay (vd "viettelpost", "Best") với danh sách. Chưa có hãng thì đoán như máy chủ (shipFromCode):
   *  mã vận đơn VP + số = Viettel Post; mã đơn của sale bắt đầu bằng V (VPhuong060902) = Viettel Post; mã đơn ghi "xe ôm" = Xe ôm. */
  function guessCarrier(code) { return /^VP\d{10,}$/i.test(String(code || '').trim()) ? 'Viettel Post' : ''; }
  function carrierOf(o) {
    var c = String(o.carrier || '').trim(), k = c.toLowerCase().replace(/[^a-z0-9]/g, '');
    if (!c) return guessCarrier(o.tracking) || (/^V[a-zA-Z]/.test(o.id || '') ? 'Viettel Post' : /xe ?ôm/i.test(o.id || '') ? 'Xe ôm' : '');
    if (CARRIERS[c] !== undefined) return c;
    if (k.indexOf('viettel') >= 0 || k === 'vtp') return 'Viettel Post';
    if (k.indexOf('best') === 0) return 'BEST Express';
    return c;
  }
  var I = {
    today: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M9 11l3 3L22 4"/><path d="M21 12v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11"/></svg>',
    users: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 0 0-3-3.87M16 3.13a4 4 0 0 1 0 7.75"/></svg>',
    box: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z"/><path d="M3.27 6.96L12 12.01l8.73-5.05M12 22.08V12"/></svg>',
    mail: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/></svg>',
    gear: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 1 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 1 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 1 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 1 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"/></svg>',
    refresh: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M23 4v6h-6M1 20v-6h6"/><path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15"/></svg>',
    lead: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M19 8v6M22 11h-6"/></svg>',
    dash: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="3" width="7" height="9" rx="1.5"/><rect x="14" y="3" width="7" height="5" rx="1.5"/><rect x="14" y="12" width="7" height="9" rx="1.5"/><rect x="3" y="16" width="7" height="5" rx="1.5"/></svg>',
    chart: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 3v18h18"/><path d="M8 17V10M13 17V6M18 17v-4"/></svg>',
    help: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><path d="M9.09 9a3 3 0 0 1 5.83 1c0 2-3 3-3 3M12 17h.01"/></svg>',
    search: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><circle cx="11" cy="11" r="7"/><path d="M21 21l-4.3-4.3"/></svg>',
    qr: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="3" width="7" height="7"/><rect x="14" y="3" width="7" height="7"/><rect x="3" y="14" width="7" height="7"/><path d="M14 14h3v3h-3zM20 14v.01M14 20h.01M17 20h4v-3"/></svg>',
    mega: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 11v2a1 1 0 0 0 1 1h3l6 4V6L7 10H4a1 1 0 0 0-1 1z"/><path d="M17 9a4 4 0 0 1 0 6"/><path d="M8 14l1.5 5h2.5l-1.5-5"/></svg>',
    bot: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="8" width="18" height="12" rx="3"/><path d="M12 8V4M8 4h8M9 14h.01M15 14h.01"/></svg>',
    shop: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M6 2L3 6v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2V6l-3-4z"/><path d="M3 6h18"/><path d="M16 10a4 4 0 0 1-8 0"/></svg>'
  };

  /* ================================================================ tiện ích */
  function $(s, r) { return (r || document).querySelector(s); }
  function $$(s, r) { return Array.prototype.slice.call((r || document).querySelectorAll(s)); }
  function esc(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }
  /** Giữ chữ đang gõ trong ô (lưu trên máy này, tối đa 2 ngày): mở lại cửa sổ thì điền lại (Đợt 2, 16/10/2026). */
  function draftKeep(el, k) {
    if (!el) return; try { var d = JSON.parse(store(k) || 'null'); if (d && d.t > Date.now() - 2 * DAY && d.v && !el.value) el.value = d.v; } catch (e) { }
    el.addEventListener('input', function () { store(k, el.value.trim() ? JSON.stringify({ v: el.value, t: Date.now() }) : null); });
  }
  function store(k, v) {
    try { if (v === undefined) return localStorage.getItem(k); if (v === null) localStorage.removeItem(k); else localStorage.setItem(k, v); } catch (e) { }
    return null;
  }
  function money(n) { return (Number(n) || 0).toLocaleString('vi-VN') + 'đ'; }
  function moneyShort(n) { n = Number(n) || 0; if (n >= 1e9) return (n / 1e9).toFixed(1).replace('.0', '').replace('.', ',') + ' tỷ'; if (n >= 1e6) return (n / 1e6).toFixed(1).replace('.0', '').replace('.', ',') + ' tr'; return money(n); }
  function pad(n) { return (n < 10 ? '0' : '') + n; }
  function vnDate(t) { // Date theo giờ Việt Nam, không phụ thuộc máy
    var d = new Date(t + 7 * 3600e3); return { y: d.getUTCFullYear(), m: d.getUTCMonth() + 1, d: d.getUTCDate(), h: d.getUTCHours(), mi: d.getUTCMinutes() };
  }
  function fDate(t) { if (!t) return ''; var x = vnDate(t); return pad(x.d) + '/' + pad(x.m) + '/' + x.y; }
  function fDateTime(t) { if (!t) return ''; var x = vnDate(t); return pad(x.h) + ':' + pad(x.mi) + ' ' + pad(x.d) + '/' + pad(x.m); }
  function isoDate(t) { var x = vnDate(t); return x.y + '-' + pad(x.m) + '-' + pad(x.d); }
  function dayStart(t) { var x = vnDate(t); return Date.UTC(x.y, x.m - 1, x.d) - 7 * 3600e3; }
  function today() { return dayStart(Date.now()); }
  function daysAgo(t) { if (!t) return ''; var n = Math.round((today() - dayStart(t)) / DAY); if (n === 0) return 'hôm nay'; if (n === 1) return 'hôm qua'; if (n < 0) return 'còn ' + (-n) + ' ngày'; return n + ' ngày trước'; }
  function when(t) { if (!t) return ''; var n = Math.round((today() - dayStart(t)) / DAY), x = vnDate(t), noTime = !x.h && !x.mi; return n === 0 ? 'Hôm nay' + (noTime ? '' : ' ' + fDateTime(t).slice(0, 5)) : n === 1 ? 'Hôm qua' + (noTime ? '' : ' ' + fDateTime(t).slice(0, 5)) : noTime ? fDate(t).slice(0, 5) : fDateTime(t); } // đơn nhập từ file không có giờ → chỉ hiện ngày
  function norm(s) { return String(s || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/đ/g, 'd'); }
  /** Link riêng của sale: thucduonglanh.vn/?ref=thuy. Khách vào qua link rồi đặt trong 30 ngày → đơn tính cho sale (khách chưa ai phụ trách thì giao luôn). Trùng refCode trong api/src/crm.js. */
  function refCode(n) { return norm(n).replace(/[^a-z0-9]/g, ''); }
  function refLink(n, path) { return 'https://thucduonglanh.vn' + (path || '/') + '?ref=' + refCode(n); }
  /** Món trong đơn → sản phẩm đang bán trên web. Nhận theo chữ chỉ có trong tên đúng 1 sản phẩm (vitagreen, curcumin, dilvang, ruoc…), nên thêm sản phẩm mới không phải sửa code. */
  function webMatch(it) {
    var ps = (CFG.products || []).filter(function (p) { return p.slug; }), cnt = {}, words = function (t) { return norm(t).split(/[^a-z0-9]+/).filter(function (w) { return w.length >= 3; }); };
    ps.forEach(function (p) { words(p.name).filter(function (w, i, a) { return a.indexOf(w) === i; }).forEach(function (w) { cnt[w] = (cnt[w] || 0) + 1; }); });
    var t = ' ' + words(it.name).join(' ') + ' ', best = null, bs = 0;
    ps.forEach(function (p) { var sc = words(p.name).filter(function (w) { return cnt[w] === 1 && t.indexOf(' ' + w + ' ') >= 0; }).length; if (sc > bs) { bs = sc; best = p; } });
    if (!best) return null;
    var vi = -1, vs = best.variants || [];
    if (vs.length) {
      var vt = ' ' + words(it.variant + ' ' + it.name).join(' ') + ' ';
      vs.forEach(function (v, i) { if (vi < 0 && words(v.name).some(function (w) { return /\d/.test(w) && vt.indexOf(' ' + w + ' ') >= 0; })) vi = i; }); // 500g, 125g, 215g…
      if (vi < 0 && it.price) vs.forEach(function (v, i) { if (vi < 0 && Math.abs(v.price - it.price) <= v.price * 0.15) vi = i; });
      if (vi < 0) vi = 0;
    }
    return { p: best, vi: vi, qty: it.qty || 1 };
  }
  /** 🔗 Link đặt lại: giỏ hàng web điền sẵn như đơn gần nhất + mã ?ref= của người phụ trách (đơn tính cho người đó). */
  function openRelink(phone) {
    var c = cust(phone); if (!c) return;
    var lo = ordersOf(c.phone).filter(function (o) { return !isVoid(o.status) && parseItems(o.items).length; }).sort(function (a, b) { return (b.time || 0) - (a.time || 0); })[0];
    var got = [], miss = [];
    (lo ? parseItems(lo.items) : []).forEach(function (it) { if (it.gift) return; var w = webMatch(it); if (!w) { miss.push(it.name); return; } var same = got.filter(function (g) { return g.p.slug === w.p.slug && g.vi === w.vi; })[0]; if (same) same.qty += w.qty; else got.push(w); });
    var who = c.owner || S.user.name, url = got.length ? 'https://thucduonglanh.vn/thanh-toan/?add=' + got.map(function (g) { return g.p.slug + '.' + (g.vi >= 0 ? g.vi : '') + '.' + g.qty; }).join(',') + '&ref=' + refCode(who) : refLink(who, '/san-pham/');
    var list = got.map(function (g) { return g.qty + ' ' + g.p.name + (g.vi >= 0 ? ' (' + g.p.variants[g.vi].name + ')' : ''); }).join(', ');
    var txt = fillTpl(got.length ? 'Dạ [Tên] ơi, em gửi [Tên] link đặt lại ' + list + ' trên web Thực Dưỡng Lành ạ. Giỏ hàng đã có sẵn, [Tên] chỉ cần xem lại địa chỉ rồi bấm Đặt hàng: ' + url : 'Dạ [Tên] ơi, em gửi [Tên] link xem và đặt sản phẩm trên web Thực Dưỡng Lành ạ: ' + url, c) +
      '\nĐặt trên web giá tốt hơn trên sàn' + (CFG.web_gift ? ', kèm quà ' + CFG.web_gift : '') + '. Cần đổi số lượng hay hỏi gì, [Tên] cứ nhắn em nhé ❤️';
    txt = fillTpl(txt, c);
    var body = (lo ? '<p class="small muted" style="margin:0 0 8px">Theo đơn ' + fDate(lo.time) + ': ' + esc(parseItems(lo.items).filter(function (i) { return !i.gift; }).map(function (i) { return i.qty + ' ' + i.name; }).join(', ')) + '</p>' : '<p class="small muted" style="margin:0 0 8px">Khách chưa có đơn: gửi link trang sản phẩm.</p>') +
      (miss.length ? '<div class="notice">⚠️ Chưa bán trên web: <b>' + esc(miss.join(', ')) + '</b>. Món này khách đặt qua bạn (＋ Đơn) như cũ.</div>' : '') +
      '<label class="f"><span>Tin gửi khách (sửa được)</span><textarea id="rlText" rows="6">' + esc(txt) + '</textarea></label>' +
      '<p class="small muted" style="margin:6px 0 0">Khách đặt qua link này: đơn tính cho <b>' + esc(who) + '</b>' + (got.length ? ', giỏ hàng có sẵn ' + esc(list) + ' (khách đổi số lượng được)' : '') + '.</p>';
    var foot = '<button class="btn ghost" data-copyref="' + esc(url) + '">📋 Chỉ copy link</button><button class="btn pri" id="rlGo">📋 Copy tin & mở Zalo</button>';
    var m = modal('🔗 Link đặt lại – ' + esc(c.name || c.phone), body, foot);
    $('#rlGo', m).onclick = function () { copy($('#rlText', m).value).then(function () { toast('Đã copy tin ✓ Dán vào Zalo rồi gửi'); window.open(zalo(c.phone), '_blank', 'noopener'); }); };
  }
  function refRow(label, url) { return '<div class="ref-row"><span class="small muted">' + label + '</span><input type="text" readonly value="' + esc(url) + '"><button class="btn" data-copyref="' + esc(url) + '">📋 Copy</button></div>'; }
  function refLinks(n) { return refRow('Trang chủ', refLink(n)) + refRow('Tất cả sản phẩm', refLink(n, '/san-pham/')) + '<p class="small muted" style="margin:6px 0 0">Gửi link sản phẩm cụ thể: mở sản phẩm trên web, copy link rồi thêm <b>?ref=' + esc(refCode(n)) + '</b> vào cuối.</p>'; }
  /** Hộp 🌐 ở tab Hiệu quả: bao nhiêu đơn khách tự đặt trên web (đơn của mình), kèm link riêng để gửi khách. */
  function refBox(c, p, n) {
    return '<div class="box ref-box"><h3>🌐 Đơn khách tự đặt trên web</h3><p style="margin:0 0 6px"><b>' + c.web + '</b> / ' + c.orders + ' đơn' + (c.orders ? ' (' + c.webPct + '%)' : '') + (c.webRev ? ' · ' + moneyShort(c.webRev) : '') + ' ' + delta(c.web, p.web) + '</p>' +
      (n ? '<p class="small muted" style="margin:0 0 8px">Gửi link riêng cho khách (tin chăm sóc, nhóm Zalo, lúc chốt đơn). Khách đặt trên web trong 30 ngày, đơn tự tính cho ' + (n === S.user.name ? 'bạn' : esc(n)) + ', khách mới tự giao cho ' + (n === S.user.name ? 'bạn' : esc(n)) + ' phụ trách. Giá web rẻ hơn Shopee, có quà tặng.</p>' + refLinks(n) : '<p class="small muted" style="margin:0">Mỗi bạn có link riêng ở tab Hiệu quả của mình hoặc Cài đặt → 🌐 Link đặt hàng của tôi. Xếp hạng: 📊 So sánh nhân viên → Đơn qua web.</p>') + '</div>';
  }
  function normPhone(p) { p = String(p || '').replace(/\D/g, ''); if (p.indexOf('84') === 0 && p.length >= 11) p = '0' + p.slice(2); if (p.length === 9 && /^[35789]/.test(p)) p = '0' + p; return p; } // số copy từ Google Sheet hay mất số 0 đầu
  /** Bấm là copy: tên, SĐT (copy liền số), địa chỉ, mã đơn, sản phẩm, số tiền… (bắt ở sự kiện chung, không mở thẻ bên dưới). */
  function cp(v, html) { v = String(v == null ? '' : v).trim(); if (!v || v === '–') return html != null ? html : ''; return '<span class="cp" data-copy="' + esc(v) + '" title="Bấm để copy">' + (html != null ? html : esc(v)) + '</span>'; }
  function cpPhone(p) { return cp(normPhone(p), fPhone(p)); }
  function cpMoney(n, html) { return cp(String(Math.round(Number(n) || 0)), html != null ? html : money(n)); }
  function fullAddr(x) { return [x.address, x.ward, x.province].filter(Boolean).join(', '); }
  function fPhone(p) { p = normPhone(p); return p.length === 10 ? p.slice(0, 4) + ' ' + p.slice(4, 7) + ' ' + p.slice(7) : p; }
  function zalo(p) { return 'https://zalo.me/' + normPhone(p); }
  var ZI = '<svg class="zi" viewBox="0 0 32 32" aria-hidden="true"><rect width="32" height="32" rx="8" fill="#0068ff"/><text x="16" y="20.5" text-anchor="middle" font-family="Arial,Helvetica,sans-serif" font-size="11.5" font-weight="700" fill="#fff">Zalo</text></svg>'; // biểu tượng Zalo: khách đã kết bạn (khác 💬 = chăm sóc / nhắn tin)
  function lvl() { return S.user ? S.user.level : 0; }
  /* mkt.thucduonglanh.vn = cùng CRM này (thêm tên miền vào project Pages), mở thẳng tab Marketing và đổi tên hiển thị */
  var MKT_HOST = /^mkt\./.test(location.hostname), APP_NM = MKT_HOST ? 'Marketing Thực Dưỡng Lành' : 'CRM Thực Dưỡng Lành';
  if (MKT_HOST) { document.title = APP_NM; var mfl = document.querySelector('link[rel=manifest]'); if (mfl) mfl.href = '/manifest-mkt.webmanifest'; }
  function toast(msg, err) {
    var el = document.createElement('div'); if (err) el.className = 'err'; el.textContent = msg; $('#toast').appendChild(el);
    setTimeout(function () { el.remove(); }, err ? (msg.length > 120 ? 15000 : 6000) : 2800);
  }
  function copy(text) {
    if (navigator.clipboard && window.isSecureContext) return navigator.clipboard.writeText(text).catch(fallback);
    fallback(); return Promise.resolve();
    function fallback() { var t = document.createElement('textarea'); t.value = text; t.style.position = 'fixed'; t.style.opacity = '0'; document.body.appendChild(t); t.select(); try { document.execCommand('copy'); } catch (e) { } t.remove(); }
  }

  var SERVER_V = '2026-10-26b'; // phải trùng số phiên bản máy chủ (api/src/index.js)
  var ON_CF = !/script\.google/.test(CFG.endpoint || ''); // máy chủ Cloudflare (nhanh) hay Apps Script cũ
  function checkVersion(j) {
    if (j && j.v) S.srvV = j.v;
    if (j && /^\d{4}-\d\d-\d\d[a-z]$/.test(j.v || '') && j.v >= SERVER_V) return; // máy chủ bằng hoặc mới hơn bản giao diện cần
    if (!j || S._vWarned || j.v === SERVER_V || j.v === '2026-10-02a' || j.v === '2026-10-02b' || j.v === '2026-10-02c' || j.v === '2026-10-04a' || j.v === '2026-10-04b' || j.v === '2026-10-04c' || j.v === '2026-10-05a' || j.v === '2026-10-05b' || j.v === '2026-10-05c' || j.v === '2026-10-05d' || j.v === '2026-10-06a' || j.v === '2026-10-06b' || j.v === '2026-10-06c' || j.v === '2026-10-07a' || j.v === '2026-10-07b' || j.v === '2026-10-07c' || j.v === '2026-10-07d' || j.v === 'moved') return;
    S._vWarned = true;
    if (lvl() >= 2 || (j.user && j.user.level >= 2)) toast('⚠️ Máy chủ đang chạy bản cũ (' + (j.v || 'chưa có số phiên bản') + '), cần bản ' + SERVER_V + '.', true);
  }
  var lastErr = '';
  var READ_ACTS = { load: 1, src_inspect: 1, ads_inspect: 1, cust_orders: 1, sales_all: 1, fb_list: 1, fb_img: 1, check_phone: 1 }; // chỉ đọc: Google trả lỗi tạm thời thì tự thử lại
  var API_HEAVY = /^(src_|ads_|mkt_fb|mkt_import|dup_scan|migrate|mirror|san_|sync|care_now|usage_report|load$)/;
  function api(action, payload, tries) {
    var body = Object.assign({ type: 'crm', action: action, token: S.token }, payload || {});
    if (!CFG.endpoint) return Promise.reject(new Error('Chưa cấu hình máy chủ.'));
    tries = tries || 0; var t0 = Date.now();
    // chờ tối đa 30 giây (việc nặng của quản trị 90 giây) rồi báo, không để vòng quay mãi (16/10/2026)
    var ac = typeof AbortController === 'function' ? new AbortController() : null, wait = API_HEAVY.test(action) ? 90e3 : 30e3, tm = ac && setTimeout(function () { ac.abort(); }, wait);
    return fetch(CFG.endpoint, { method: 'POST', headers: { 'Content-Type': 'text/plain;charset=utf-8' }, body: JSON.stringify(body), signal: ac ? ac.signal : undefined })
      .then(function (r) { clearTimeout(tm); return r.text().then(function (t) { return { t: t, st: r.status }; }); }, function (er) { clearTimeout(tm); var slow = er && er.name === 'AbortError', e0 = new Error(slow ? 'Máy chủ trả lời chậm quá ' + (wait / 1000) + ' giây. Bạn kiểm tra mạng rồi bấm lại nhé.' : 'Mất kết nối mạng. Bạn thử lại nhé.'); e0.net = true; throw e0; })
      .then(function (x) {
        try { var j0 = JSON.parse(x.t); if (j0 && action === 'load') j0.__kb = Math.round(x.t.length / 1024); return j0; } catch (e) {
          if (READ_ACTS[action] && tries < 2) return new Promise(function (ok) { setTimeout(ok, 1500 * (tries + 1)); }).then(function () { return api(action, payload, tries + 1); }).then(function (j) { j.__retried = 1; return j; });
          var hint = String(x.t || '').replace(/<style[\s\S]*?<\/style>|<script[\s\S]*?<\/script>/gi, ' ').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 160);
          var e1 = new Error('Máy chủ báo lỗi (thường do việc chạy quá lâu hoặc dữ liệu quá lớn). Bạn bấm lại thử; nếu vẫn lỗi, chụp màn hình gửi quản trị. [' + x.st + (hint ? ': ' + hint : '') + ']'); e1.net = true; throw e1;
        }
      })
      .then(function (j) {
        perfRec(action, t0, j, payload); checkVersion(j);
        if (!j || !j.ok) {
          if (j && j.auth) { logout(true); }
          lastErr = action + ': ' + ((j && j.error) || '');
          var em = (j && j.error) || 'Có lỗi, bạn thử lại nhé.';
          if (/D1_|SQLITE|exceeded|too many|limit/i.test(em)) em = 'Máy chủ đang quá tải hoặc đã dùng hết hạn mức hôm nay. Bạn thử lại sau ít phút; vẫn lỗi thì báo quản trị. (' + em.slice(0, 80) + ')';
          var e2 = new Error(em); e2.j = j; throw e2;
        }
        return j;
      });
  }

  /* ---------- đo tốc độ: ghi thời gian mỗi lần tải / lưu, 2 phút gửi 1 lần lên tab "Đo tốc độ CRM" (để biết chậm do máy chủ hay do mạng) */
  var PERF_SKIP = { perf: 1, login: 1, verify: 1, logout: 1, fb_img: 1, fb_list: 1 };
  function perfRec(action, t0, j, p) {
    if (PERF_SKIP[action] || !j || !j.ok) return;
    var part = p && p.part, src = !j.t && j.pc === undefined ? (action === 'load' ? ({ core: 'tải đầu', rest: 'đợt 2', delta: 'làm mới' })[part] || 'tải đủ' : '') : action === 'load' ? (j.rest ? 'đợt 2 · ' : '') + (j.t && j.t.cached ? 'bản đọc sẵn' : 'đọc Sheet') : j.pc === true ? 'sửa bản đọc sẵn' : j.pc === false ? 'bỏ bản đọc sẵn' : '';
    S.pq = S.pq || []; S.pq.push([t0, action, Date.now() - t0, j.sms, src, action === 'load' ? j.__kb || '' : '']); if (S.pq.length > 60) S.pq.shift();
  }
  function perfFlush() {
    if (!S.pq || !S.pq.length || !S.token || !/^\d{4}-\d\d-\d\d[a-z]$/.test(S.srvV || '') || S.srvV < '2026-10-05d') return; // máy chủ cũ chưa có lệnh này
    var rows = S.pq, ua = navigator.userAgent, cn = navigator.connection; S.pq = []; S.pqAt = Date.now();
    var dev = (/iPhone|iPad/.test(ua) ? 'iPhone/iPad' : /Android/.test(ua) ? 'Android' : /Mac/.test(ua) ? 'Mac' : /Windows/.test(ua) ? 'Windows' : 'Khác') + (/Zalo/i.test(ua) ? ' · trong Zalo' : '') + (cn && cn.effectiveType ? ' · mạng ' + cn.effectiveType : '') + ' · ' + window.innerWidth + 'px';
    api('perf', { rows: rows, dev: dev }).catch(function () { });
  }

  /* ---------- mức độ dùng CRM: lượt mở, phút dùng (tab đang mở + có chạm / gõ / cuộn trong 2 phút qua), màn hình đã xem. 5 phút gửi 1 lần (hoặc khi ẩn tab) lên tab "Hoạt động CRM". Quản trị xem ở Hiệu quả → 📈 Mức dùng CRM */
  var U = { opens: 0, sec: 0, scr: {}, act: Date.now(), tick: Date.now(), at: Date.now(), hid: 0 };
  ['click', 'keydown', 'scroll', 'touchstart'].forEach(function (ev) { document.addEventListener(ev, function () { U.act = Date.now(); }, { passive: true, capture: true }); });
  function useScreen() { var v = route().view, x = VIEWS.filter(function (y) { return y.id === v; })[0]; if (x) U.scr[x.label] = 1; }
  function useTick(count) { var now = Date.now(); if (count && now - U.act < 120e3) U.sec += Math.min(now - U.tick, 60e3) / 1000; U.tick = now; }
  function useDev() { var ua = navigator.userAgent; return (/iPhone|iPad/.test(ua) ? 'iPhone/iPad' : /Android/.test(ua) ? 'Android' : /Mac/.test(ua) ? 'Mac' : /Windows/.test(ua) ? 'Windows' : 'Khác') + (/Zalo/i.test(ua) ? ' (Zalo)' : ''); }
  function useFlush() {
    if (!S.token || !/^\d{4}-\d\d-\d\d[a-z]$/.test(S.srvV || '') || S.srvV < '2026-10-07b') return; // máy chủ cũ chưa có lệnh này
    if (!U.opens && U.sec < 30 && !Object.keys(U.scr).length) return;
    var p = { opens: U.opens, mins: Math.round(U.sec / 6) / 10, screens: Object.keys(U.scr), dev: useDev() }; U.opens = 0; U.sec = 0; U.scr = {}; U.at = Date.now();
    api('usage', p).catch(function () { U.opens += p.opens; U.sec += p.mins * 60; p.screens.forEach(function (x) { U.scr[x] = 1; }); }); // gửi lỗi → giữ lại, lần sau gửi tiếp
  }

  /* ================================================================ đăng nhập */
  function renderLogin(step, email, msg) {
    $('#app').innerHTML = '<div class="login"><form class="login-box" novalidate>' +
      '<img src="/logo.webp" alt="Thực Dưỡng Lành"><h1>' + APP_NM + '</h1>' +
      (step === 'code'
        ? '<p class="sub">Mã 6 số đã gửi tới <b>' + esc(email) + '</b>.<br>Mở hộp thư (xem cả mục Spam/Quảng cáo) để lấy mã.</p>' +
          '<label class="f"><span>Mã đăng nhập</span><input type="text" class="code" name="code" inputmode="numeric" autocomplete="one-time-code" maxlength="6" required></label>' +
          '<button class="btn pri lg block" type="submit">Đăng nhập</button><p class="err" role="alert">' + esc(msg || '') + '</p>' +
          '<p style="text-align:center;margin:8px 0 0"><button type="button" class="link" data-back>← Đổi email</button> · <button type="button" class="link" data-resend>Gửi lại mã</button></p>'
        : '<p class="sub">Đăng nhập bằng email công việc. Chúng tôi sẽ gửi mã 6 số vào email của bạn.</p>' +
          '<label class="f"><span>Email</span><input type="email" name="email" autocomplete="email" inputmode="email" required value="' + esc(email || store('crm_email') || '') + '" placeholder="ten@gmail.com"></label>' +
          '<button class="btn pri lg block" type="submit">Gửi mã đăng nhập</button><p class="err" role="alert">' + esc(msg || '') + '</p>') +
      '<p class="small" style="text-align:center;margin:14px 0 0"><a href="/huong-dan/" target="_blank" rel="noopener">Hướng dẫn sử dụng CRM</a></p>' +
      '</form></div>';
    var form = $('.login-box'), btn = $('button[type=submit]', form), err = $('.err', form);
    var inp = $('input', form); setTimeout(function () { inp.focus(); }, 50);
    function busy(on, label) { btn.disabled = on; btn.textContent = on ? label : (step === 'code' ? 'Đăng nhập' : 'Gửi mã đăng nhập'); }
    function request(em) {
      busy(true, 'Đang gửi mã…'); err.textContent = '';
      return api('login', { email: em }).then(function () { store('crm_email', em); renderLogin('code', em); }, function (e) { busy(false); err.textContent = e.message; });
    }
    form.addEventListener('submit', function (e) {
      e.preventDefault();
      if (step !== 'code') { var em = inp.value.trim().toLowerCase(); if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(em)) { err.textContent = 'Email chưa đúng.'; return; } request(em); return; }
      var code = inp.value.replace(/\D/g, ''); if (code.length !== 6) { err.textContent = 'Mã gồm 6 chữ số.'; return; }
      busy(true, 'Đang kiểm tra…'); err.textContent = '';
      api('verify', { email: email, code: code }).then(function (j) { S.token = j.token; S.user = j.user; store('crm_token', j.token); start(); }, function (e) { busy(false); err.textContent = e.message; inp.select(); });
    });
    if (step === 'code') {
      inp.addEventListener('input', function () { if (inp.value.replace(/\D/g, '').length === 6) form.requestSubmit ? form.requestSubmit() : btn.click(); });
      $('[data-back]', form).onclick = function () { renderLogin('email', email); };
      $('[data-resend]', form).onclick = function () { err.textContent = 'Đang gửi lại…'; api('login', { email: email }).then(function () { err.textContent = ''; toast('Đã gửi mã mới vào email'); }, function (e) { err.textContent = e.message; }); };
    }
  }
  function logout(expired) {
    if (!expired && S.token) api('logout').catch(function () { });
    S.token = null; S.user = null; S.d = null; store('crm_token', null); closeModal(true);
    idb('del', 'data'); S.outbox = []; saveOutbox(); // xoá dữ liệu khách lưu trên máy này
    renderLogin('email', '', expired ? 'Phiên đăng nhập đã hết, bạn đăng nhập lại nhé.' : '');
  }

  /* ================================================================ dữ liệu */
  /** Tải 2 đợt: đợt 1 = khách, việc hôm nay, đơn 100 ngày, nhật ký 60 ngày (đủ làm việc ngay); đợt 2 tải ngầm đơn + nhật ký cũ hơn. */
  /** Tự làm mới nhẹ: chỉ hỏi máy chủ phần đổi từ lần trước. 6 tiếng (hoặc sang ngày mới, đổi quy tắc) mới tải đủ 1 lần cho chắc.
   *  Trước đây 1 tiếng/lần × mỗi máy đang mở CRM → hết hạn mức đọc miễn phí của D1 (5 triệu dòng/ngày, 09/10/2026). */
  var FULL_EVERY = 6 * 3600e3;
  function canDelta() { return S.d && S.d.sv && !S.d.partial && S.fullAt && Date.now() - S.fullAt < FULL_EVERY && S.d.today === startDay(Date.now()); }
  function startDay(t) { return Math.floor((t + 7 * 3600e3) / DAY) * DAY - 7 * 3600e3; }
  function loadDelta() {
    S.loading = true; var t0 = Date.now(), d = S.d;
    return api('load', { part: 'delta', since: d.sv, lr: d.lr, adV: d.adV }).then(function (j) {
      if (S.d !== d) return 'skip'; // đã tải đủ lần khác trong lúc chờ
      if (!j.delta || j.full || j.today !== d.today || JSON.stringify(j.rules) !== JSON.stringify(d.rules)) return 'full';
      var key = function (arr, k) { var m = {}; arr.forEach(function (x, i) { m[x[k]] = i; }); return m; };
      var merge = function (arr, add, gone, k) { // thay dòng cũ, thêm dòng mới, bỏ dòng không còn thuộc quyền xem
        var g = {}; (gone || []).forEach(function (v) { g[v] = 1; }); var m = key(arr, k), fresh = [];
        add.forEach(function (x) { if (m[x[k]] != null) arr[m[x[k]]] = x; else fresh.push(x); });
        return arr.concat(fresh).filter(function (x) { return !g[x[k]]; });
      };
      var hadPhone = key(d.customers, 'phone');
      d.customers = merge(d.customers, j.customers, j.cusGone, 'phone');
      d.orders = merge(d.orders, j.orders, j.ordGone, 'row').sort(function (a, b) { return (a.time || 0) - (b.time || 0) || a.row - b.row; });
      d.leads = merge(d.leads || [], j.leads, j.leadGone, 'id');
      var pending = {}; S.outbox.forEach(function (o) { pending[o.id] = 1; });
      d.log = (d.log || []).filter(function (l) { return !l.loc && (!l.op || pending[l.op]); }).concat(j.log); // dòng tạm hiện trên máy → thay bằng dòng thật từ máy chủ
      // khách mới thuộc quyền xem mà trên máy chưa có đủ đơn cũ (vd vừa được giao khách) → tải đủ
      var cnt = {}; d.orders.forEach(function (o) { if (!/Huỷ|Hủy|Hoàn/i.test(o.status)) cnt[o.phone] = (cnt[o.phone] || 0) + 1; });
      if (j.customers.some(function (c) { return hadPhone[c.phone] == null && (cnt[c.phone] || 0) < c.orders; })) return 'full';
      ['user', 'now', 'fbNew', 'users', 'prefs', 'tagColors', 'sources', 'ads', 'adV', 'adRows', 'contacts', 'targets', 'cycles', 'templates', 'rules', 'areas', 'sv', 'lr'].forEach(function (k) { if (j[k] !== undefined) d[k] = j[k]; });
      S.stale = false; setData(d, Date.now()); S.perf = { core: Date.now() - t0, srv: j.t, kb: j.__kb, delta: 1 };
      idb('set', 'data', { tk: S.token.slice(-12), at: S.loadedAt, fa: S.fullAt, d: d });
      if ($('.me')) { $('.me').innerHTML = meHTML(); navBadges(); }
      softRender(true);
      return 'ok';
    }, function () { return 'full'; }).then(function (r) {
      S.loading = false;
      if (r === 'full') return load(true, true);
    });
  }
  function load(silent, noDelta) {
    if (S.loading) return Promise.resolve();
    if (silent && !noDelta && canDelta()) return loadDelta();
    S.loading = true; var b = $('#refresh'); if (b) b.classList.add('spin');
    var fresh = !silent && !!S.d, t0 = Date.now(), prev = S.d; // bấm ↻: đọc thẳng từ Sheet, không dùng bản máy chủ nhớ tạm
    var p = { part: 'core' }; if (fresh) p.fresh = 1;
    return api('load', p).then(function (j) {
      S.stale = false;
      if (j.part && prev && prev.orders) keepOld(j, prev); // đang có dữ liệu cũ trên máy → giữ phần cũ tới khi đợt 2 về, số liệu không bị hụt
      var keep = !!j.part && silent && prev && prev.orders && !prev.partial && Date.now() - (S.restAt || 0) < 3600e3; // tự làm mới: đơn, nhật ký cũ giữ bản trên máy (1 tiếng mới đọc lại) – nhanh hơn, đỡ tốn lượt đọc máy chủ
      j.partial = !!j.part && !keep; setData(j, Date.now()); S.fullAt = Date.now(); S.perf = { core: Date.now() - t0, srv: j.t, kb: j.__kb };
      if (!j.part) idb('set', 'data', { tk: S.token.slice(-12), at: S.loadedAt, fa: S.fullAt, d: j }); // máy chủ cũ: 1 đợt
      if (!$('.me') || $$('.nav a').length !== navViews().length) shell(); else { $('.me').innerHTML = meHTML(); navBadges(); } // .me chỉ có ở giao diện thật (khung chờ không có)
      softRender(silent);
      if (j.part) { // đợt 2 tải ngầm, không giữ S.loading → bấm ↻ lúc đợt 2 chưa xong vẫn tải lại được
        if (keep) idb('set', 'data', { tk: S.token.slice(-12), at: S.loadedAt, fa: S.fullAt, d: j }); else loadRest(j);
      }
    }, function (e) { if (!silent && S.token) toast(e.message, true); if (!S.d && S.token && !$('.me')) { $('#app').innerHTML = '<div class="login"><div class="login-box"><h1>Chưa tải được dữ liệu</h1><p class="sub">' + esc(e.message) + '</p><button class="btn pri block" id="retry">Thử lại</button></div></div>'; $('#retry').onclick = function () { location.reload(); }; } })
      .then(function () { S.loading = false; var b2 = $('#refresh'); if (b2) b2.classList.remove('spin'); });
  }
  function softRender(silent) {
    var ae = document.activeElement, editing = silent && ae && ae.closest && ae.closest('#view') && /INPUT|TEXTAREA|SELECT/.test(ae.tagName);
    if (!editing) render(); else if ($('.updated')) $('.updated').outerHTML = updatedLine(); // đang gõ dở / đang mở hộp thì không vẽ lại, tránh mất chữ
  }
  function keepOld(j, prev) {
    var ids = {}; j.orders.forEach(function (o) { ids[o.id] = 1; });
    j.orders = prev.orders.filter(function (o) { return !ids[o.id] && (o.time || 0) < j.part.o; }).concat(j.orders);
    j.log = (prev.log || []).filter(function (l) { return (l.time || 0) < j.part.l; }).concat(j.log || []);
  }
  function loadRest(core) {
    var t1 = Date.now();
    return api('load', { part: 'rest', o: core.part.o, l: core.part.l }).then(function (r) {
      if (S.d !== core) return; // đã tải lại lần nữa → bỏ
      var ids = {}; r.orders.forEach(function (o) { ids[o.id] = 1; });
      var newO = S.d.orders.filter(function (o) { return (o.time || 0) >= core.part.o || (!ids[o.id] && /^(Mới|Đã xác nhận|Đang giao)$/.test(o.status)); });
      var newL = S.d.log.filter(function (l) { return (l.time || 0) >= core.part.l || l.op; }); // l.op: việc vừa bấm trên máy này
      [r.orders, r.log].forEach(function (arr) { arr.forEach(function (x) { if (x.name && ZALO_X.test(x.name)) { ZALO_X.lastIndex = 0; x.name = x.name.replace(ZALO_X, '').trim(); } ZALO_X.lastIndex = 0; }); });
      S.d.orders = r.orders.concat(newO); S.d.log = r.log.concat(newL); S.d.partial = false; S.restAt = Date.now();
      preIndexData(S.d);
      if (S.perf) { S.perf.rest = Date.now() - t1; S.perf.kb2 = r.__kb; }
      idb('set', 'data', { tk: S.token.slice(-12), at: S.loadedAt, fa: S.fullAt, d: S.d }); // lần sau mở CRM hiện ngay
      softRender(true);
    }, function () { /* đợt 2 lỗi: vẫn dùng được, lần tải sau thử lại */ });
  }
  var ZALO_X = /\s*\(\s*[xX×]\s*\)/g; // "(x)" sau tên = sale đã kết bạn Zalo (cách ghi trên Sheet) → hiện bằng biểu tượng Zalo, không hiện trong tên
  function preIndexData(j) {
    if (!j) return;
    j.byPhone = {};
    if (j.customers) {
      j.customers.forEach(function (c) {
        c._phoneDigits = (c.phone ? c.phone.replace(/\D/g, '') : '') + altPhones(c.note).map(function (p) { return ' ' + p; }).join(''); // tìm được theo số phụ (khách đã gộp nhiều số)
        c._normName = norm(c.name);
        if (c.phone) j.byPhone[normPhone(c.phone)] = c;
      });
    }
    j.orderById = {};
    j.ordersByPhone = {};
    if (j.orders) {
      var sortedOrders = j.orders.slice().sort(function (a, b) { return (b.time || 0) - (a.time || 0) || (b.row || 0) - (a.row || 0); });
      sortedOrders.forEach(function (o) {
        o._phoneDigits = o.phone ? o.phone.replace(/\D/g, '') : '';
        o._q = norm((o.name || '') + ' ' + (o.id || '') + ' ' + (o.items || '') + ' ' + (o.province || '') + ' ' + (o.source || '') + ' ' + (o.tracking || '') + ' ' + (o.seller || '') + ' ' + ((o.note || '').match(/Mã web TDL\w+/) || [''])[0]);
        if (o.id) j.orderById[o.id] = o;
        if (o.phone) {
          var ph = normPhone(o.phone);
          if (!j.ordersByPhone[ph]) j.ordersByPhone[ph] = [];
          j.ordersByPhone[ph].push(o);
        }
      });
    }
    j.leadById = {};
    j.leadsByPhone = {};
    if (j.leads) {
      var sortedLeads = (j.leads || []).slice().sort(function (a, b) { return (a.time || 0) - (b.time || 0); });
      sortedLeads.forEach(function (l) {
        l._phoneDigits = l.phone ? l.phone.replace(/\D/g, '') : '';
        l._q = norm((l.name || '') + ' ' + (l.channel || '') + ' ' + (l.interest || '') + ' ' + (l.province || '') + ' ' + (l.note || '') + ' ' + (l.owner || ''));
        if (l.id) j.leadById[l.id] = l;
        if (l.phone) {
          var ph = normPhone(l.phone);
          if (!j.leadsByPhone[ph]) j.leadsByPhone[ph] = [];
          j.leadsByPhone[ph].push(l);
        }
      });
    }
    j.logByRef = {};
    if (j.log) {
      var sortedLog = (j.log || []).slice().sort(function (a, b) { return (b.time || 0) - (a.time || 0); });
      sortedLog.forEach(function (l) {
        if (l.ref) {
          var ref = String(l.ref).replace(/^'/, '');
          if (!j.logByRef[ref]) j.logByRef[ref] = [];
          j.logByRef[ref].push(l);
        }
      });
    }
  }
  function addLog(l) {
    if (!S.d) return;
    if (!S.d.log) S.d.log = [];
    S.d.log.push(l);
    if (S.d.logByRef && l && l.ref) {
      var ref = String(l.ref).replace(/^'/, '');
      if (!S.d.logByRef[ref]) S.d.logByRef[ref] = [];
      S.d.logByRef[ref].unshift(l);
    }
    var c = cust(l.ref); if (c) invalidateCustomer(c);
  }
  function invalidateCustomer(c) {
    if (!c) return;
    c._stage = undefined; c._vip = undefined; c._risky = undefined; c._cold = undefined;
    c._reply = undefined; c._q = undefined; c._normName = undefined; c._phoneDigits = undefined;
    c._rh1 = undefined;
  }
  function setData(j, at) {
    S.d = j; S.user = j.user; S.loadedAt = at; S._refs = null;
    [j.customers, j.orders, j.leads || [], j.log || []].forEach(function (arr) { arr.forEach(function (x) { if (x.name && ZALO_X.test(x.name)) { ZALO_X.lastIndex = 0; x.name = x.name.replace(ZALO_X, '').trim(); } ZALO_X.lastIndex = 0; }); });
    preIndexData(j);
    S.outbox.forEach(applyOp); // việc vừa bấm nhưng máy chủ chưa nhận xong → vẫn hiện đúng
  }
  /** Khung trang hiện ngay lúc chờ máy chủ (thay cho màn hình trắng “Đang tải…”). */
  function skeleton() {
    var row = '<div class="sk-row"><div class="sk-l"><i style="width:45%"></i><i style="width:80%"></i><i style="width:60%"></i></div><div class="sk-b"></div><div class="sk-b"></div></div>';
    return '<header class="top"><div class="top-in"><span class="brand"><img src="/icon-180.png" alt="">CRM</span><div class="grow"></div></div></header>' +
      '<main id="view" class="sk"><p class="sk-msg">⏳ Đang tải dữ liệu… lần đầu trên máy này có thể mất 5–15 giây, các lần sau mở là thấy ngay.</p>' +
      '<div class="sk-h"></div><div class="sk-kpis"><i></i><i></i><i></i></div>' + row + row + row + row + row + '</main>';
  }
  function start() {
    U.opens++; useScreen();
    $('#app').innerHTML = skeleton();
    idb('get', 'data').then(function (c) {
      if (c && c.d && c.tk === String(S.token || '').slice(-12) && Date.now() - c.at < 7 * DAY && !S.d) { // dữ liệu lần trước trên máy này → hiện ngay, cập nhật ngầm
        S.stale = true; setData(c.d, c.at); S.fullAt = c.fa || 0; shell(); render(); load(true); flush(); // cùng ngày + chưa quá 6 tiếng từ lần tải đủ → chỉ tải phần thay đổi
      } else load().then(flush);
    });
  }

  /* ---------- lưu dữ liệu trên máy (IndexedDB): mở CRM thấy ngay, không phải chờ máy chủ. Đăng xuất là xoá. */
  var IDB = null;
  function idb(op, key, val) {
    return new Promise(function (ok) {
      setTimeout(function () { ok(null); }, 2500); // trình duyệt chặn / treo bộ nhớ máy → bỏ qua, tải bình thường
      try {
        var go = function (db) {
          var tx = db.transaction('kv', op === 'get' ? 'readonly' : 'readwrite'), st = tx.objectStore('kv');
          var rq = op === 'get' ? st.get(key) : op === 'set' ? st.put(val, key) : st.delete(key);
          rq.onsuccess = function () { ok(op === 'get' ? rq.result : true); }; rq.onerror = function () { ok(null); };
        };
        if (IDB) return go(IDB);
        var o = indexedDB.open('crm-tdl', 1);
        o.onupgradeneeded = function () { o.result.createObjectStore('kv'); };
        o.onsuccess = function () { IDB = o.result; go(IDB); }; o.onerror = function () { ok(null); };
      } catch (e) { ok(null); }
    });
  }

  /* ---------- hàng chờ gửi: bấm lưu là màn hình đổi ngay, lệnh gửi ngầm lên máy chủ; mất mạng thì tự gửi lại */
  S.outbox = (function () { try { return JSON.parse(store('crm_outbox') || '[]'); } catch (e) { return []; } })();
  function saveOutbox() { store('crm_outbox', S.outbox.length ? JSON.stringify(S.outbox) : null); pendingBadge(); }
  function sendOp(action, p) {
    var op = { id: Date.now().toString(36) + Math.random().toString(36).slice(2, 7), action: action, p: p, at: Date.now() };
    p.opId = op.id; S.outbox.push(op); saveOutbox(); applyOp(op); flush(); return op;
  }
  function applyOp(op) {
    var p = op.p, c = cust(p.phone);
    if (op.action === 'gift') { if (!S.d.log.some(function (l) { return l.op === op.id; })) addLog({ op: op.id, time: op.at, by: S.user.name, what: 'Gửi quà tặng', ref: normPhone(p.phone), name: p.name, result: p.gift, note: '' }); return; }
    if (!c) return;
    invalidateCustomer(c); // xoá bộ nhớ đệm thuộc tính khách (tên / kết quả CSKH / người phụ trách vừa đổi)
    if (op.action === 'care') {
      c.careAt = op.at; c.careResult = p.result; if (!c.owner) c.owner = S.user.name;
      c.callback = p.callback ? new Date(p.callback + 'T09:00:00+07:00').getTime() : null; c.task = null;
      if (p.received && !c.recv) c.recv = op.at;
      if (!S.d.log.some(function (l) { return l.op === op.id; })) addLog({ op: op.id, time: op.at, by: S.user.name, what: TASK_LOG[p.task] || TASK_LOG.other, ref: c.phone, name: c.name, result: p.result, note: p.note + (p.callback ? (p.note ? ' – ' : '') + 'hẹn gọi lại ' + p.callback.split('-').reverse().join('/') : '') });
    }
    if (op.action === 'customer') {
      if (p.owner !== undefined) c.owner = p.owner; if (p.note !== undefined) { c.note = p.note; c.noteCut = false; } if (p.tag !== undefined) c.tag = p.tag; if (p.zalo !== undefined) c.zalo = !!p.zalo; if (p.community !== undefined) c.community = p.community === 'Đã mời' ? 'Đã mời ' + fDate(op.at).replace(/\/(\d{2})(\d{2})$/, '/$2') : p.community; if (p.consent !== undefined) c.consent = !!p.consent; if (p.dob !== undefined) c.dob = p.dob;
      if (p.quick && !S.d.log.some(function (l) { return l.op === op.id; })) { // ✏️ Ghi nhanh = 1 lượt chăm sóc (máy chủ ghi nhật ký "Ghi nhanh", xoá hẹn gọi lại đã tới hạn)
        addLog({ op: op.id, time: op.at, by: S.user.name, what: 'Ghi nhanh', ref: c.phone, name: c.name, result: '', note: p.quick });
        c.careAt = op.at; c.careResult = 'Ghi nhanh'; if (!c.owner) c.owner = S.user.name;
        if (c.callback && dayStart(c.callback) <= today()) c.callback = null;
        c.task = null;
      }
      if (p.promo && !S.d.log.some(function (l) { return l.op === op.id; })) { addLog({ op: op.id, time: op.at, by: S.user.name, what: 'Gửi ưu đãi', ref: c.phone, name: c.name, result: p.promo, note: '' }); c.note = fDate(op.at).replace(/\/(\d{2})(\d{2})$/, '/$2') + ': 📣 Gửi ưu đãi: ' + p.promo + (c.note ? '\n' + c.note : ''); }
      if (p.callback !== undefined) {
        c.callback = p.callback ? new Date(p.callback + 'T09:00:00+07:00').getTime() : null;
        if (c.callback && dayStart(c.callback) <= today()) c.task = { type: 'callback', late: Math.round((today() - dayStart(c.callback)) / DAY), days: 0 };
        else if (c.task && c.task.type === 'callback') c.task = null;
      }
    }
  }
  var flushing = false, flushTimer = null;
  function flush() {
    if (flushing || !S.outbox.length || !S.token) return;
    flushing = true; var op = S.outbox[0];
    api(op.action, op.p).then(function () {
      S.outbox.shift(); saveOutbox(); flushing = false; flush();
    }, function (e) {
      flushing = false;
      if (e.net) { clearTimeout(flushTimer); flushTimer = setTimeout(flush, 20e3); pendingBadge(); return; } // mất mạng / máy chủ bận → 20 giây sau gửi lại
      S.outbox.shift(); saveOutbox(); toast('Chưa lưu được (' + ((cust(op.p.phone) || {}).name || op.p.phone) + '): ' + e.message, true); load(true); flush();
    });
  }
  function pendingBadge() {
    var n = S.outbox.length, b = $('#pending');
    if (!b && n && $('.top .me')) { $('.top .me').insertAdjacentHTML('beforebegin', '<span id="pending" class="pending"></span>'); b = $('#pending'); }
    if (b) { b.style.display = n ? '' : 'none'; b.textContent = '⏳ Đang gửi ' + n; b.title = 'Việc vừa lưu đang được gửi lên máy chủ. Mất mạng thì CRM tự gửi lại, không cần bấm lại.'; }
  }
  window.addEventListener('online', function () { flush(); });

  function cust(phone) { return S.d && S.d.byPhone && S.d.byPhone[normPhone(phone)]; }
  function ordersOf(phone) {
    if (!S.d) return [];
    phone = normPhone(phone);
    if (S.d.ordersByPhone) return S.d.ordersByPhone[phone] || [];
    return S.d.orders.filter(function (o) { return normPhone(o.phone) === phone; }).sort(function (a, b) { return b.time - a.time; });
  }
  function logOf(ref) {
    if (!S.d) return [];
    ref = String(ref).replace(/^'/, '');
    if (S.d.logByRef) return S.d.logByRef[ref] || [];
    return S.d.log.filter(function (l) { return String(l.ref).replace(/^'/, '') === ref; }).sort(function (a, b) { return b.time - a.time; });
  }
  /** Ô “Người phụ trách” (chỉ quản lý): '' = tất cả, '-' = chưa ai phụ trách, còn lại = tên nhân viên. Dùng chung cho 5 màn hình. */
  function whoF() { return lvl() >= 2 ? S.who || '' : S.user.name; }
  function whoOk(owner) { var w = whoF(); return !w || (w === '-' ? !owner : owner === w); }
  function whoName() { var w = whoF(); return w && w !== '-' ? w : null; } // đang lọc 1 người cụ thể
  function orderOwner(o) { return o.seller || (cust(o.phone) || {}).owner || ''; } // đơn khách tự đặt chưa có NV bán → người phụ trách khách
  function whoSel() {
    if (lvl() < 2) return '';
    var names = userNames(); if (S.who && S.who !== '-' && names.indexOf(S.who) < 0) names.push(S.who);
    return '<select id="who" class="who' + (S.who ? ' on' : '') + '" title="Lọc theo người phụ trách – áp dụng cho cả 5 màn hình"><option value="">👥 Tất cả nhân sự</option><option value="-"' + (S.who === '-' ? ' selected' : '') + '>🧺 Chưa ai phụ trách</option>' +
      names.map(function (n) { return '<option value="' + esc(n) + '"' + (n === S.who ? ' selected' : '') + '>👤 ' + esc(n) + (n === S.user.name ? ' (tôi)' : '') + '</option>'; }).join('') + '</select>';
  }
  function mineOk(c) { return whoOk(c.owner); } // sale: chỉ khách của mình (khách chưa ai nhận do quản lý giao ở mục Kho chung)
  function tasksAll() { return S.d.customers.filter(function (c) { return c.task; }); }
  function tasksShown() { return tasksAll().filter(function (c) { return mineOk(c) && !coldOf(c); }); } // khách lạnh không vào danh sách gọi
  /** Khách cũ lâu chưa gọi (không nằm trong lịch chăm sóc tự động): ưu tiên khách chi nhiều. */
  function oldDueAll(own) {
    var t0 = today();
    return S.d.customers.filter(function (c) {
      if (c.task || !c.last || c.flag || !(own ? c.owner === own : mineOk(c)) || (lvl() < 2 && c.owner !== S.user.name)) return false;
      if (c.callback && dayStart(c.callback) > t0) return false; // đã hẹn ngày khác
      if (daysSince(c.last) < OLD_DAYS) return false; // vừa mua (vd sale lên đơn qua điện thoại, chưa ghi chăm sóc) → chưa phải khách cũ
      var r = replyOf(c); return r.days >= OLD_DAYS && !coldOf(c);
    }).sort(function (a, b) { return b.spent - a.spent || (a.last || 0) - (b.last || 0); });
  }
  // Đơn mới chờ xác nhận: Quản lý/Quản trị thấy hết; nhân viên chỉ thấy đơn quản lý đã giao cho mình (NV bán = mình)
  function newOrderSeen(o) { return o.status !== 'Mới' || lvl() >= 2 || o.seller === S.user.name; }
  function newOrders() { return S.d.orders.filter(function (o) { return o.status === 'Mới' && newOrderSeen(o); }); }
  /** Đơn hiện ở tab Đơn hàng: nhân viên không thấy đơn Mới chưa giao cho mình. */
  function ordersSeen() { return lvl() >= 2 ? (S.who ? S.d.orders.filter(function (o) { return whoOk(orderOwner(o)); }) : S.d.orders) : S.d.orders.filter(newOrderSeen); }
  function assignOrder(o, v, sel) {
    var old = o.seller; if (v === old) return;
    o.seller = v; toast(v ? 'Đã giao đơn cho ' + v + ' ✓' : 'Đã bỏ giao đơn'); navBadges(); render();
    api('order_status', { id: o.id, row: o.row, seller: v }).catch(function (e) {
      o.seller = old; if (sel) sel.value = old; toast(e.message, true); navBadges(); render();
    });
  }
  function mode() { return (S.d && S.d.rules && S.d.rules.assignMode) || 'pool'; }
  function isPoolStaff() { return lvl() < 2 && mode() === 'pool'; }
  var MODE_INFO = {
    auto: ['Tự chia đều', 'Khách mới (đơn web, form liên hệ) tự giao lần lượt cho những người đang bật “Nhận khách mới”.'],
    manager: ['Quản lý giao tay', 'Khách mới nằm ở mục “Chờ giao” (chỉ quản lý thấy). Quản lý chọn người phụ trách cho từng khách.'],
    pool: ['Kho chung', 'Khách mới chưa ai phụ trách nằm ở mục Kho chung tab Hôm nay (chỉ quản lý thấy) để quản lý giao. Nhân viên xác nhận đơn / chăm sóc khách đó trước thì khách thuộc về người đó.']
  };
  var phoneTimer = null;
  /** Hỏi máy chủ số điện thoại này đang do ai phụ trách (nhân viên không xem được khách của người khác). */
  function checkPhone(ph, cb) {
    clearTimeout(phoneTimer); ph = normPhone(ph);
    if (!/^0\d{9,10}$/.test(ph)) { cb(null); return; }
    phoneTimer = setTimeout(function () { api('check_phone', { phone: ph }).then(cb, function () { cb(null); }); }, 450);
  }
  function ownerWarn(r) { return r && r.status === 'other' ? '⚠️ Số này ' + (r.lead ? 'đang là khách hỏi' : 'là khách hàng') + ' do <b>' + esc(r.owner) + '</b> phụ trách. Bạn không thao tác được – nhờ ' + esc(r.owner) + ' hoặc quản lý.' : ''; }
  function claimBtn(kind, id) { return '<button class="btn" data-claim="' + kind + '|' + esc(id) + '">✋ Nhận khách này</button>'; }
  /* ---------- màu phân loại khách (mỗi người tự chọn màu, tự tạo nhãn trong Cài đặt) */
  var CAT_DEF = {
    new: { label: 'Mua 1 lần', color: '#ffffff', tip: 'Khách đã mua 1 đơn (người chưa mua nằm ở tab Khách hỏi)' },
    old: { label: 'Mua từ 2 lần', color: '#fff1b8', tip: 'Khách đã mua lại, từ 2 đơn trở lên' },
    off: { label: 'Đặt tối / CN / lễ', color: '#eee2ff', tip: 'Đơn gần nhất đặt buổi tối, Chủ nhật hoặc ngày lễ (ngoài giờ hành chính)' },
    void: { label: 'Hay hoàn / bom', color: '#e4e4e4', tip: 'Hoàn từ 2 lần và hoàn ≥ số lần nhận, chưa nhận đơn nào, hoặc có nhãn bom hàng. Hoàn 1 lần trong nhiều đơn vẫn là khách tốt' }
  };
  var CAT_ORDER = ['new', 'old', 'off', 'void'];
  function catColor(k) { var p = (S.d && S.d.prefs && S.d.prefs.colors) || {}; return p[k] || CAT_DEF[k].color; }
  function myTags() { return (S.d && S.d.prefs && S.d.prefs.tags) || []; }
  function tagColor(name) { var t = myTags().filter(function (x) { return x.name === name; })[0]; return t ? t.color : (S.d.tagColors || {})[name] || '#dbeafe'; }
  function custCat(c) {
    if (c.tag) return { key: 'tag:' + c.tag, label: c.tag, color: tagColor(c.tag) };
    var k = c.flag || riskyReturn(c) || (!c.okN && !c.backN && /hoàn|huỷ|hủy/i.test(c.lastStatus || '')) ? 'void' : c.lastCa === 'Tối/CN' || c.lastCa === 'Lễ' ? 'off' : c.orders >= 2 ? 'old' : 'new';
    return { key: k, label: CAT_DEF[k].label, color: catColor(k) };
  }
  function orderCat(o) {
    var c = cust(o.phone), k = isVoid(o.status) ? 'void' : o.ca === 'Tối/CN' || o.ca === 'Lễ' ? 'off' : c && c.first && c.first < (o.time || 0) - 3600e3 ? 'old' : 'new';
    if (!isVoid(o.status) && c && c.tag) return { key: 'tag:' + c.tag, label: c.tag, color: tagColor(c.tag) };
    return { key: k, label: { new: 'Đơn đầu tiên', old: 'Khách mua lại', off: 'Đặt tối / CN / lễ', void: 'Hoàn / huỷ' }[k], color: catColor(k) };
  }
  /** Màu đậm hơn để làm viền / chữ trên nền màu nhạt. */
  function shade(hex, f) {
    var n = parseInt(String(hex).slice(1), 16); if (isNaN(n)) return '#999';
    var r = n >> 16, g = (n >> 8) & 255, b = n & 255, m = function (x) { return Math.max(0, Math.min(255, Math.round(x * (1 - f)))); };
    if (r > 245 && g > 245 && b > 245) return f > .5 ? '#555' : '#c9c6bb'; // màu trắng: viền xám
    return '#' + [m(r), m(g), m(b)].map(function (x) { return ('0' + x.toString(16)).slice(-2); }).join('');
  }
  function catAttr(cat) { return ' style="background:' + cat.color + ';border-left:7px solid ' + shade(cat.color, .35) + '"'; }
  function catChip(cat) { return '<span class="cat-chip" style="background:' + shade(cat.color, .08) + ';color:' + shade(cat.color, .72) + ';border-color:' + shade(cat.color, .3) + '">' + esc(cat.label) + '</span>'; }
  /** Chú thích màu; bấm vào để lọc (ở trang Khách hàng). */
  function legend(list, active) {
    var cnt = {}; (list || []).forEach(function (c) { var k = custCat(c).key; cnt[k] = (cnt[k] || 0) + 1; });
    var keys = CAT_ORDER.concat(myTags().map(function (t) { return 'tag:' + t.name; }));
    Object.keys(cnt).forEach(function (k) { if (keys.indexOf(k) < 0) keys.push(k); });
    return '<div class="legend"><span class="muted lg-t">Màu thẻ (bấm để lọc):</span>' + keys.map(function (k) {
      var isTag = k.indexOf('tag:') === 0, color = isTag ? tagColor(k.slice(4)) : catColor(k), label = isTag ? k.slice(4) : CAT_DEF[k].label;
      return '<button class="lg' + (active === k ? ' on' : '') + '" data-cat="' + esc(k) + '"' + (isTag ? '' : ' title="' + esc(CAT_DEF[k].tip) + '"') + '><i style="background:' + color + ';border-color:' + shade(color, .35) + '"></i>' + esc(label) + (list ? ' <em>' + (cnt[k] || 0) + '</em>' : '') + '</button>';
    }).join('') + '<button type="button" class="lg-set lg-help" data-taghelp>ⓘ Giải thích nhãn</button><a class="lg-set" href="#cai-dat">🎨 Đổi màu</a></div>';
  }
  /** Chú thích màu nền từng dòng, ngay trên danh sách: nhìn là biết dòng vàng / tím / xám nghĩa là gì. order = nhãn theo đơn. */
  function colorKey(order) {
    var L = order ? { new: 'Đơn đầu tiên', old: 'Khách mua lại', off: 'Đặt tối / CN / lễ', void: 'Hoàn / huỷ' } : null;
    return '<div class="ckey"><span class="muted">Màu dòng:</span>' + CAT_ORDER.map(function (k) { var c = catColor(k); return '<span><i style="background:' + c + ';border-color:' + shade(c, .35) + '"></i>' + esc(L ? L[k] : CAT_DEF[k].label) + '</span>'; }).join('') + (myTags().length ? '<span class="muted">· màu khác = nhãn riêng</span>' : '') + '</div>';
  }
  function isBank(o) { return /chuyển khoản/i.test(o.payment); }
  function unpaidOrders() { return S.d.orders.filter(function (o) { return isBank(o) && !o.paid && !isVoid(o.status); }); }
  function isOpenLead(l) { return l.status === 'Mới hỏi' || l.status === 'Đang tư vấn'; }
  function leadDue(l) {
    if (!isOpenLead(l)) return null;
    if (l.callback) return dayStart(l.callback) <= today() ? 'callback' : null;
    if (!l.lastAt) return 'new';
    return (today() - dayStart(l.lastAt)) / DAY >= 3 ? 'stale' : null;
  }
  function leadMine(l) { return whoOk(l.owner); }
  /** Khách vừa hỏi (trong 48 giờ, chưa liên hệ lần nào): khách nóng nhất → đưa lên ngay sau Đơn mới. */
  function isHotLead(l) { return leadDue(l) === 'new' && today() - dayStart(l.time || 0) <= DAY; }
  function hotLeads() { return leadsDue().filter(isHotLead); }
  function leadsDue() { return (S.d.leads || []).filter(function (l) { return leadDue(l) && leadMine(l); }); }
  function findLead(id) {
    if (!S.d) return null;
    if (S.d.leadById) return S.d.leadById[id] || null;
    return (S.d.leads || []).filter(function (l) { return l.id === id; })[0];
  }

  /* ================================================================ khung */
  var VIEWS = [
    { id: 'tong-quan', label: 'Tổng quan', icon: 'dash', min: 3 }, // chủ doanh nghiệp: kinh doanh + website
    { id: 'hom-nay', label: 'Hôm nay', icon: 'today' },
    { id: 'tiem-nang', label: 'Khách hỏi', icon: 'lead' }, // Đợt 2: khách hỏi lên ngay sau Hôm nay (khách mới cần gọi sớm)
    { id: 'khach-hang', label: 'Khách đã mua', short: 'Khách', icon: 'users' },
    { id: 'don-hang', label: 'Đơn hàng', icon: 'box' },
    { id: 'bao-cao', label: 'Hiệu quả', icon: 'chart' },
    { id: 'marketing', label: 'Marketing', icon: 'mega', mkt: 1 }, // quyền Marketing: chỉ thấy tab này + Cài đặt; Quản trị vào từ Tổng quan (không chiếm chỗ trên menu)
    { id: 'link-qr', label: 'Link & QR', short: 'QR', icon: 'qr', lq: 1 }, // 📍 link / mã QR theo dõi nguồn khách: Marketing, Quản lý, Quản trị (Quản trị vào từ Tổng quan / Marketing)
    { id: 'tro-ly-zalo', label: 'Trợ lý Zalo', short: 'Zalo', icon: 'bot', lq: 1 }, // 🤖 trợ lý An Lành trong nhóm Zalo (api/src/zbot.js): cùng quyền với Link & QR
    { id: 'fanpage', label: 'Fanpage', short: 'FB', icon: 'mail', lq: 1 }, // 📘 trợ lý Fanpage: trả lời bình luận, Messenger, bài đăng (api/src/fb.js): cùng quyền với Link & QR
    { id: 'san', label: 'Sàn', icon: 'shop', san: 1 }, // doanh số Shopee / TikTok Shop: Quản trị + người phụ trách sàn (Quản trị vào từ Tổng quan, không chiếm chỗ trên menu)
    { id: 'cai-dat', label: 'Cài đặt', icon: 'gear' }
  ];
  // Marketing: tab Marketing, Link & QR, Khách hỏi (24/10/2026: chỉ xem khách để lại số trên web), Cài đặt
  function myViews() { if (isMkt()) return VIEWS.filter(function (v) { return v.mkt || v.lq || v.id === 'tiem-nang' || v.id === 'cai-dat'; }); return VIEWS.filter(function (v) { return (!v.min || lvl() >= v.min) && (!v.lq || lvl() >= 2) && (!v.san || (S.d && S.d.sanOk) || lvl() >= 3) && (!v.mkt || lvl() >= 3 || mkvOnly()); }); }
  function navViews() { return myViews().filter(function (v) { return !((v.san || v.mkt || v.lq) && lvl() >= 3); }); }
  function meHTML() { return '<b>' + esc(S.user.name) + '</b>'; } // chỉ tên: mỗi người là chủ công việc của mình
  function updatedLine() {
    var pf = S.perf, sp = pf && lvl() >= 3 ? ' · tải ' + (pf.core / 1000).toFixed(1) + 's' + (pf.srv ? ' (máy chủ ' + (pf.srv.ms / 1000).toFixed(1) + 's' + (pf.srv.cached ? ', bản đọc sẵn' : ', đọc Sheet') + ')' : '') + (pf.kb ? ', ' + pf.kb + ' KB' : '') + (pf.rest ? ' + đợt 2 ' + (pf.rest / 1000).toFixed(1) + 's' + (pf.kb2 ? '/' + pf.kb2 + ' KB' : '') : '') : '';
    return '<p class="updated">' + (S.stale ? '⏳ Đang cập nhật… (đang xem dữ liệu lúc ' + fDateTime(S.loadedAt) + ')' : 'Cập nhật lúc ' + fDateTime(S.loadedAt)) + (S.d && S.d.partial ? ' · ⏳ đang tải thêm đơn & nhật ký cũ…' : '') + ' · dữ liệu lưu trên máy chủ CRM (bản sao ở Google Sheet)' + sp + '</p>';
  }
  function shell() {
    $('#app').innerHTML = '<header class="top"><div class="top-in">' +
      '<a class="brand" href="#' + homeView() + '"><img src="/icon-180.png" alt="">CRM</a>' +
      '<nav class="nav">' + navViews().map(function (v) { return '<a href="#' + v.id + '" data-v="' + v.id + '"' + (v.id === 'cai-dat' ? ' class="nav-set"' : '') + '>' + I[v.icon] + '<span' + (v.short ? ' data-short="' + v.short + '"' : '') + '>' + v.label + '</span></a>'; }).join('') + '</nav>' +
      '<div class="grow"></div><div class="me">' + meHTML() + '</div>' +
      (isMkt() ? '' : '<button class="icon-btn" id="gsBtn" title="Tìm ở mọi tab: khách đã mua, đơn hàng, khách hỏi" aria-label="Tìm ở mọi tab">🔍</button>') +
      '<button class="icon-btn fb-btn" id="fbBtn" title="Góp ý: báo lỗi, chỗ khó dùng, ý tưởng" aria-label="Góp ý">💡<span class="fb-lbl">Góp ý</span></button>' +
      '<a class="icon-btn" href="/huong-dan/' + (isMkt() ? 'marketing' : 'crm') + '/" target="_blank" rel="noopener" title="Hướng dẫn sử dụng" aria-label="Hướng dẫn sử dụng">' + I.help + '</a>' +
      '<a class="icon-btn top-set" href="#cai-dat" title="Cài đặt" aria-label="Cài đặt">' + I.gear + '</a>' +
      '<button class="icon-btn" id="refresh" title="Tải lại dữ liệu" aria-label="Tải lại dữ liệu">' + I.refresh + '</button>' +
      '</div></header><main id="view"></main>';
    $('#refresh').onclick = function () { load(); };
    $('#fbBtn').onclick = function () { openFeedback(); };
    if ($('#gsBtn')) $('#gsBtn').onclick = function () { openGlobalSearch(); };
    navBadges(); pendingBadge();
  }
  /** 🔍 Tìm nhanh trên mọi tab (Đợt 2, 16/10/2026): gõ SĐT / tên / mã đơn → khách đã mua, đơn hàng, khách hỏi; bấm là mở. Chỉ tìm trong dữ liệu người dùng được xem (máy chủ đã lọc).
   *  20/10/2026: gom theo người (số điện thoại) → mỗi người 1 dòng; đã mua thì mở hồ sơ khách (có cả lịch sử hỏi + đơn), chưa mua thì mở lượt hỏi gần nhất.
   *  Đơn chỉ hiện riêng khi khớp theo mã đơn. */
  function openGlobalSearch(pre) {
    var m = modal('🔍 Tìm nhanh', '<input type="search" id="gsQ" placeholder="Số điện thoại, tên khách hoặc mã đơn" autocomplete="off" inputmode="search"><div id="gsRes" class="gs-res"><p class="muted small">Gõ ít nhất 2 chữ hoặc 3 số.</p></div>', '');
    var qi = $('#gsQ', m), out = $('#gsRes', m), tm = null; if (pre) qi.value = pre;
    var it = function (href, title, sub, extra) { return '<a class="gs-it" href="' + href + '"><b>' + title + '</b><span>' + sub + '</span>' + (extra ? '<span class="gs-x">' + extra + '</span>' : '') + '</a>'; };
    var find = function () {
      var raw = qi.value.trim(), q = norm(raw), dg = raw.replace(/\D/g, ''), byPh = dg.length >= 3;
      if (q.length < 2 && !byPh) { out.innerHTML = '<p class="muted small">Gõ ít nhất 2 chữ hoặc 3 số.</p>'; return; }
      var hit = function (name, phone) { return (byPh && String(phone || '').indexOf(dg) >= 0) || (!byPh && norm(name).indexOf(q) >= 0); };
      var P = {}, keys = [], codeOs = [];
      var person = function (ph) { var k = normPhone(ph) || String(ph || ''); if (!P[k]) { P[k] = { ph: k, os: [], ls: [], t: 0 }; keys.push(k); } return P[k]; };
      (S.d.customers || []).forEach(function (c) { if (c.orders > 0 && hit(c.name, c.phone)) { var p = person(c.phone); p.c = c; p.t = Math.max(p.t, c.last || 0); } });
      (S.d.orders || []).forEach(function (o) {
        if (hit(o.name, o.phone)) { var p = person(o.phone); p.os.push(o); p.t = Math.max(p.t, o.time || 0); }
        else if (/\d/.test(q) && norm(o.id).indexOf(q) >= 0) codeOs.push(o); // mã đơn luôn có số: gõ tên thì không kéo theo đơn có tên sale trong mã
      });
      (S.d.leads || []).forEach(function (l) { if (hit(l.name, l.phone)) { var p = person(l.phone); p.ls.push(l); p.t = Math.max(p.t, l.lastAt || l.time || 0); } });
      keys.forEach(function (k) { var p = P[k]; if (!p.c && p.os.length) { var c = cust(k); if (c && c.orders > 0) p.c = c; } });
      var byT = function (a, b) { return (b.time || 0) - (a.time || 0); };
      var ppl = keys.map(function (k) { var p = P[k]; p.os.sort(byT); p.ls.sort(byT); return p; }).sort(function (a, b) { return (b.c ? 1 : 0) - (a.c ? 1 : 0) || b.t - a.t; }).slice(0, 10);
      var oLine = function (o) { return '📦 ' + esc(o.id) + ' ' + esc((o.status || '').toLowerCase()) + ' ' + fDate(o.time).slice(0, 5); };
      var lLine = function (l, n) { return '🙋 hỏi ' + fDate(l.time).slice(0, 5) + ' (' + esc((l.status || '').toLowerCase()) + ')' + (n > 1 ? ' · ' + n + ' lượt hỏi' : ''); };
      var h = ppl.map(function (p) {
        var c = p.c, o = p.os[0], l = p.ls[0], name = esc((c && c.name) || (o && o.name) || (l && l.name) || 'Khách') + ' · ' + fPhone(p.ph), x = [];
        if (c) {
          if (o) x.push(oLine(o)); if (l) x.push(lLine(l, p.ls.length));
          return it('#khach-hang/' + c.phone, name, '👤 Khách đã mua · ' + c.orders + ' đơn · ' + moneyShort(c.spent || 0) + (c.owner ? ' · ' + esc(c.owner) : ''), x.join(' · '));
        }
        if (l) {
          if (o) x.push(oLine(o));
          return it('#tiem-nang/' + encodeURIComponent(l.id), name, lLine(l, p.ls.length).replace('🙋 hỏi', '🙋 Khách hỏi · hỏi') + (l.owner ? ' · ' + esc(l.owner) : ''), x.join(' · '));
        }
        return it('#don-hang/' + encodeURIComponent(o.id), name, oLine(o) + ' · ' + moneyShort(o.total || 0), p.os.length > 1 ? p.os.length + ' đơn' : '');
      }).join('');
      if (h) h = '<h3>👤 Người tìm thấy (' + ppl.length + ')</h3>' + h;
      codeOs.sort(byT);
      if (codeOs.length) h += '<h3>📦 Đơn khớp mã</h3>' + codeOs.slice(0, 6).map(function (o) { return it('#don-hang/' + encodeURIComponent(o.id), esc(o.id) + ' · ' + esc(o.name || ''), fDate(o.time).slice(0, 5) + ' · ' + moneyShort(o.total || 0) + ' · ' + esc(o.status || '')); }).join('');
      out.innerHTML = h || '<p class="muted small">Không thấy. Khách do người khác phụ trách thì bạn không thấy được, nhờ quản lý tra giúp.</p>';
    };
    qi.addEventListener('input', function () { clearTimeout(tm); tm = setTimeout(find, 150); });
    out.addEventListener('click', function (e) { if (e.target.closest('.gs-it')) closeModal(true); });
    if (pre) find();
    setTimeout(function () { qi.focus(); }, 60);
  }
  /* ---------- ✨ AI (Đợt 3, 16/10/2026): tóm tắt hồ sơ khách / viết tin nhắn. Chỉ hiện khi máy chủ có khoá AI (rules.ai). Tên khách không gửi đi: AI viết [Tên], máy này điền lại. */
  function aiBox(c) {
    if (!S.d.rules || !S.d.rules.ai) return '';
    return '<div class="ai-box"><button type="button" class="btn sm" data-ai="sum" data-aiph="' + c.phone + '">✨ Tóm tắt khách bằng AI</button><div class="ai-out" hidden></div></div>';
  }
  document.addEventListener('click', function (e) {
    var b = e.target.closest && e.target.closest('[data-ai]'); if (!b || !S.d) return;
    e.preventDefault(); e.stopPropagation();
    var kind = b.getAttribute('data-ai'), c = cust(b.getAttribute('data-aiph')); if (!c) return;
    var box = b.closest('.ai-box'), out = box && $('.ai-out', box), m = b.closest('.modal'), txt = b.textContent;
    b.disabled = true; b.textContent = '⏳ AI đang đọc hồ sơ…';
    api('ai_sum', { phone: c.phone, kind: kind, task: b.getAttribute('data-aitask') || '' }).then(function (j) {
      var t = String(j.text || '').split('[Tên]').join(c.name || 'anh/chị');
      if (kind === 'msg') { var ta = m && $('#kMsg', m); if (ta) { ta.value = t; ta.focus(); } toast('AI đã viết tin, bạn đọc lại và sửa trước khi gửi'); }
      else if (out) { out.hidden = false; out.innerHTML = '<p class="small muted" style="margin:0 0 4px">✨ AI tóm tắt' + (j.cached ? ' (đã có sẵn hôm nay)' : '') + ' · chỉ để tham khảo, kiểm tra lại trước khi nói với khách</p>' + esc(t).replace(/\n/g, '<br>'); }
      b.disabled = false; b.textContent = txt;
    }, function (er) { b.disabled = false; b.textContent = txt; toast(er.message, true); });
  }, true);
  function setWho(v) { S.who = v || ''; store('crm_who', S.who); ['c', 'o', 't'].forEach(function (k) { if (S.f[k]) S.f[k].n = 60; }); navBadges(); render(); }
  function navBadges() {
    var fb = $('#fbBtn'); if (fb) { var fd = $('.dot', fb); if (fd) fd.remove(); if (lvl() >= 2 && S.d.fbNew) fb.insertAdjacentHTML('beforeend', '<span class="dot">' + S.d.fbNew + '</span>'); }
    var ld = leadsDue().length, n = { 'hom-nay': newOrders().length + dayQueue().list.length + hotLeads().length, 'don-hang': newOrders().length, 'tiem-nang': ld };
    $$('.nav a').forEach(function (a) {
      var v = a.getAttribute('data-v'), d = $('.dot', a); if (d) d.remove();
      if (n[v]) a.insertAdjacentHTML('beforeend', '<span class="dot">' + (n[v] > 99 ? '99+' : n[v]) + '</span>');
    });
  }
  /** Tab mở mặc định theo quyền: Quản trị → Tổng quan, Quản lý → Hiệu quả, nhân viên → Hôm nay. */
  function homeView() { return isMkt() || (MKT_HOST && myViews().some(function (x) { return x.id === 'marketing'; })) ? 'marketing' : lvl() >= 3 ? 'tong-quan' : lvl() >= 2 ? 'bao-cao' : 'hom-nay'; }
  function route() { var h = (location.hash || '').slice(1).split('/'); return { view: h[0] === 'lien-he' ? 'tiem-nang' : h[0] || homeView(), id: decodeURIComponent(h[1] || '') }; }
  var lastView = '';
  function render() {
    if (!S.d || !$('#view')) return;
    var r = route(), v = myViews().some(function (x) { return x.id === r.view; }) ? r.view : homeView();
    $$('.nav a').forEach(function (a) { a.classList.toggle('on', a.getAttribute('data-v') === v); }); var ts = $('.top-set'); if (ts) ts.classList.toggle('on', v === 'cai-dat');
    var keepScroll = lastView === v, y = window.scrollY;
    var el = $('#view');
    var focusId = document.activeElement && document.activeElement.id, selStart = document.activeElement && document.activeElement.selectionStart;
    el.innerHTML = ({ 'hom-nay': viewToday, 'khach-hang': viewCustomers, 'don-hang': viewOrders, 'tiem-nang': viewLeads, 'bao-cao': viewReport, 'cai-dat': viewSettings, 'tong-quan': viewDash, san: viewSan, marketing: viewMkt, 'link-qr': viewLinks, 'tro-ly-zalo': viewZbot, fanpage: viewFp })[v]();
    el.insertAdjacentHTML('beforeend', updatedLine());
    if (focusId && $('#' + focusId)) { var f = $('#' + focusId); f.focus(); try { f.setSelectionRange(selStart, selStart); } catch (e) { } }
    if (keepScroll) window.scrollTo(0, y); else window.scrollTo(0, 0);
    lastView = v;
    document.title = VIEWS.filter(function (x) { return x.id === v; })[0].label + ' – ' + APP_NM;
    if (v === 'cai-dat') bindSettings();
    if (v === 'tong-quan') bindDash();
    if (v === 'bao-cao') bindRep();
    if (v === 'marketing') bindMkv();
    if (v === 'tong-quan' || v === 'san') bindSan();
    if (r.id && !$('.modal')) {
      if (v === 'khach-hang' && cust(r.id)) openCustomer(r.id, true);
      if (v === 'don-hang') { var o = S.d.orders.filter(function (x) { return x.id === r.id; })[0]; if (o) openOrder(o.id, true); }
      if (v === 'tiem-nang' && findLead(r.id)) openLead(r.id, true);
    }
  }

  /* ================================================================ thẻ dùng chung */
  function groupTag(g) { return g ? '<span class="tag ' + (GROUP_CLS[g] || '') + '">' + esc(g) + '</span>' : ''; }
  /* ---------- nhóm khách: theo số ngày chưa mua (Đang dùng ≤60 · Sắp mất 61–180 · Lâu không mua >180) + VIP + khách lạnh */
  function daysSince(t) { return t ? Math.round((today() - dayStart(t)) / DAY) : 99999; }
  /** Số ngày chưa mua thì thành "Sắp mất": theo Cài đặt → Nhóm khách (máy chủ cũng dùng số này), mặc định 60. */
  function riskDays() { return Math.min(179, Number(S.d && S.d.rules && S.d.rules.atRisk) || 60); }
  function stageOf(c) { if (c._stage !== undefined) return c._stage; var d = daysSince(c.last); return (c._stage = (d <= riskDays() ? 'live' : d <= 180 ? 'risk' : 'lost')); }
  function isVip(c) { if (c._vip !== undefined) return c._vip; var R = S.d.rules || {}; return (c._vip = (c.orders >= (R.vipOrders || 3) || c.spent >= (R.vipSpent || 2e6))); }
  function riskyReturn(c) { if (c._risky !== undefined) return c._risky; var b = c.backN || 0, ok = c.okN || 0; return (c._risky = (b >= 1 && (ok === 0 || (b >= 2 && b >= ok)))); } // hoàn 1 lần trong nhiều đơn nhận = khách vẫn tốt
  function coldOf(c) { // khách lạnh: bom hàng / từ chối, hoặc đã nói "không dùng nữa" (sau 6 tháng tự ấm lại; đặt đơn mới cũng hết lạnh)
    if (c._cold !== undefined) return c._cold;
    if (c.flag) return (c._cold = (/bom/i.test(c.flag) ? 'Bom hàng' : c.flag));
    var r = replyOf(c); if (r.result === 'Không có nhu cầu' && r.at && !((c.last || 0) > r.at) && today() - r.at < 180 * DAY) return (c._cold = 'Không dùng nữa');
    return (c._cold = '');
  }
  var TIP = {
    vip: function () { var R = S.d.rules || {}; return 'Khách mua từ ' + (R.vipOrders || 3) + ' đơn, hoặc tổng chi từ ' + money(R.vipSpent || 2e6); },
    get risk() { return 'Sắp mất: ' + (riskDays() + 1) + '–180 ngày chưa mua lại. Nhóm đáng gọi nhất'; },
    lost: 'Lâu không mua: hơn 180 ngày chưa mua lại',
    get live() { return 'Đang dùng: mua trong ' + riskDays() + ' ngày gần đây'; },
    cold: 'Khách lạnh: đã nói không dùng nữa, hoặc bom hàng / từ chối nhận. Không đưa vào danh sách gọi hằng ngày',
    back: 'Hay hoàn: hoàn từ 2 lần và số lần hoàn ≥ số lần nhận, hoặc chưa nhận đơn nào. Nên nhờ khách chuyển khoản trước',
    zalo: 'Đã kết bạn Zalo: nhắn tin chăm sóc được',
    nozalo: 'Chưa kết bạn Zalo: gọi xong nhớ xin kết bạn',
    task: 'Khách đến lịch chăm sóc hôm nay (hẹn gọi lại, hỏi nhận hàng, sắp hết hàng…)',
    callback: 'Khách đã hẹn ngày gọi lại',
    fam: function () { var n = (S.d.rules && S.d.rules.famMin) || 1; return 'Khách quen sản phẩm: đơn gần nhất toàn sản phẩm khách đã mua từ ' + n + ' lần trước đó, đã biết cách dùng. CRM không nhắc hỏi nhận hàng / 7 ngày / 14 ngày; vẫn nhắc sắp hết hàng, 30 ngày, mời quay lại'; },
    all: 'Tất cả khách của bạn'
  };
  function custTags(c) {
    var st = stageOf(c), cold = coldOf(c);
    return (isVip(c) ? '<span class="tag vip" title="' + TIP.vip() + '">VIP</span>' : '') + (cold ? '<span class="tag cold" title="' + TIP.cold + '">❄️ ' + esc(cold) + '</span>' : st === 'risk' ? '<span class="tag risk" title="' + TIP.risk + '">Sắp mất</span>' : st === 'lost' ? '<span class="tag lost" title="' + TIP.lost + '">Lâu không mua</span>' : '') +
      (riskyReturn(c) && !cold ? '<span class="tag st-huy" title="' + TIP.back + '">⚠️ hay hoàn</span>' : '');
  }
  function famTag(c) { return c.fam ? '<span class="tag fam" title="' + esc(TIP.fam()) + '">🌟 Khách quen SP</span>' : ''; } // chỉ hiện trong hồ sơ + hộp chăm sóc (danh sách đỡ rối)
  function stTag(s) { return '<span class="tag ' + (ST_CLS[s] || '') + '">' + esc(s) + '</span>'; }
  var BRAND_W = { fucoidan: 'Fucoidan', progomax: 'Progomax', gafo: 'Gafo', dilvang: 'DILVANG', vitagreen: 'VitaGreen' };
  function prettyProd(p) { p = String(p).replace(/\s*\(.*\)\s*$/, '').trim().replace(/[a-zà-ỹ]+/gi, function (w) { return BRAND_W[w.toLowerCase()] || w; }); return p.charAt(0).toUpperCase() + p.slice(1); } // tên nhập từ file sale hay viết thường
  function pkey(p) { return norm(String(p).replace(/\s*\(.*\)\s*$/, '')).replace(/\b\d+([.,]\d+)?\s*(g|kg|ml|l|goi|hop|vien|tui|chai|lo)\b/g, '').replace(/[^a-z0-9 ]/g, ' ').replace(/\s+/g, ' ').trim(); }
  var coBuy = null, coBuyN = -1;
  /** Khách mua A thì hay mua thêm B: đếm theo cặp sản phẩm trong lịch sử mua của mọi khách. */
  function coBuyMap() {
    if (coBuy && coBuyN === S.d.customers.length) return coBuy;
    coBuy = { co: {}, name: {} }; coBuyN = S.d.customers.length;
    S.d.customers.forEach(function (c) {
      var ks = {}; (c.products || []).forEach(function (p) { if (/^🎁|tặng|quà/i.test(p)) return; var k = pkey(p); if (k) { ks[k] = 1; coBuy.name[k] = coBuy.name[k] || prettyProd(p).replace(/\s*[–-]?\s*\d+([.,]\d+)?\s*(g|kg|ml|gói|hộp|viên)\b.*$/i, ''); } });
      var a = Object.keys(ks); a.forEach(function (x) { a.forEach(function (y) { if (x !== y) { var m = coBuy.co[x] || (coBuy.co[x] = {}); m[y] = (m[y] || 0) + 1; } }); });
    });
    return coBuy;
  }
  function suggestFor(c) {
    var M = coBuyMap(), mine = {}, sc = {}; (c.products || []).forEach(function (p) { mine[pkey(p)] = 1; });
    Object.keys(mine).forEach(function (k) { var m = M.co[k] || {}; Object.keys(m).forEach(function (y) { if (!mine[y]) sc[y] = (sc[y] || 0) + m[y]; }); });
    var best = Object.keys(sc).sort(function (a, b) { return sc[b] - sc[a]; })[0];
    return best && sc[best] >= 2 ? M.name[best] : '';
  }
  function shortProducts(list, n) { return (list || []).slice(-(n || 2)).map(prettyProd).join(', '); }
  function taskLine(c) {
    var t = c.task; if (!t) return '';
    if (t.type === 'callback') return '<span class="warn-line">📞 Hẹn gọi lại ' + (t.late ? '– đã quá ' + t.late + ' ngày' : 'hôm nay') + '</span>';
    if (t.type === 'runout') return t.late ? '<span class="bad-line">Đã hết khoảng ' + t.late + ' ngày</span>' : '<span class="warn-line">' + (t.toRun === 0 ? 'Hết trong hôm nay' : 'Còn khoảng ' + t.toRun + ' ngày là hết (' + fDate(today() + t.toRun * DAY).slice(0, 5) + ')') + '</span>';
    var late = t.late ? ' <span class="bad-line">· ⏳ trễ ' + t.late + ' ngày</span>' : '';
    if (t.type === 'd1') return (t.est ? 'Đặt ' + daysAgo(c.last) + ' · <span class="warn-line">' + (/^(Mới|Đã xác nhận|Đang giao)$/.test(c.lastStatus || '') ? 'đơn vẫn «' + esc(c.lastStatus) + '», hỏi khách đã nhận hàng chưa' : 'chưa rõ ngày nhận hàng') + '</span>' + (c.zone ? ' · ' + (c.zone === 1 ? 'miền Bắc, giao ~' + ((S.d.rules || {}).shipDays || 3) : 'ở xa, giao ~' + ((S.d.rules || {}).shipFar || 5)) + ' ngày' : '') : 'Nhận hàng ' + (t.days === 0 ? 'hôm nay' : t.days + ' ngày trước')) + late;
    return (t.est ? 'Đặt ' + daysAgo(c.last) : 'Nhận hàng ' + t.days + ' ngày trước') + late;
  }
  /* ---------- số ngày chưa chăm sóc: tính từ lần gần nhất KHÁCH CÓ PHẢN HỒI ("Không nghe máy" không tính) */
  var NO_REPLY = 'Không nghe máy', CARE_WHAT = null, replyIdx = null, replyLogLen = -1;
  function replyIndex() {
    if (replyIdx && replyLogLen === S.d.log.length) return replyIdx;
    if (!CARE_WHAT) { CARE_WHAT = {}; Object.keys(TASK_LOG).forEach(function (k) { CARE_WHAT[TASK_LOG[k]] = 1; }); CARE_WHAT['Ghi nhanh'] = 1; }
    replyIdx = {}; replyLogLen = S.d.log.length;
    S.d.log.forEach(function (l) {
      if (!CARE_WHAT[l.what] || !l.time) return;
      var ph = String(l.ref).replace(/^'/, ''), r = replyIdx[ph] || (replyIdx[ph] = { at: 0, missed: [] });
      if (l.result === NO_REPLY) r.missed.push(l.time); else if (l.result && l.time > r.at) { r.at = l.time; r.result = l.result; r.by = l.by; }
    });
    return replyIdx;
  }
  function replyOf(c) {
    if (c._reply !== undefined) return c._reply;
    var r = replyIndex()[c.phone] || { at: 0, missed: [] }, at = r.at, result = r.result, by = r.by;
    if (c.careAt && c.careResult && c.careResult !== NO_REPLY && c.careAt > at) { at = c.careAt; result = c.careResult; by = c.owner; } // ghi trong Sheet trước khi có CRM
    var from = at || c.first; // chưa chăm sóc lần nào → đếm từ ngày mua đầu tiên
    return (c._reply = { at: at, never: !at, result: result, by: by, days: from ? Math.max(0, Math.round((today() - dayStart(from)) / DAY)) : 0, missed: r.missed.filter(function (t) { return t > at; }).length });
  }
  function ageLevel(days) { return days <= 7 ? 'ok' : days <= 30 ? 'mid' : 'bad'; }
  function ageTag(c) {
    var r = replyOf(c), txt = r.never ? (r.days === 0 ? 'Khách mới hôm nay' : r.days + ' ngày chưa chăm sóc (chưa lần nào)') : r.days === 0 ? 'Vừa chăm sóc hôm nay' : r.days + ' ngày chưa chăm sóc';
    return '<span class="age ' + ageLevel(r.days) + '" title="Tính từ lần gần nhất khách có phản hồi">💬 ' + txt + '</span>' +
      (r.missed ? '<span class="age-miss">📵 ' + r.missed + ' lần không nghe máy</span>' : '');
  }
  function custCard(c, withTask) {
    var cat = custCat(c);
    return '<div class="card click tinted" data-cust="' + c.phone + '"' + catAttr(cat) + '>' +
      '<div class="r1"><b>' + esc(c.name || 'Khách') + '</b>' + catChip(cat) + custTags(c) + (c.owner ? (lvl() >= 2 || c.owner !== S.user.name ? '<span class="tag owner">👤 ' + esc(c.owner) + '</span>' : '') : '<span class="tag noconsent">Chưa ai phụ trách</span>') + '<span class="end">' + (c.orders > 1 ? c.orders + ' đơn · ' : '') + moneyShort(c.spent) + '</span></div>' +
      '<div class="r2">' + fPhone(c.phone) + (c.products.length ? ' · ' + esc(shortProducts(c.products)) : '') + '</div>' +
      '<div class="r-age">' + zaloTag(c) + ageTag(c) + (c.flag ? '<span class="age bad">⚠️ ' + esc(c.flag) + '</span>' : '') + '</div>' +
      '<div class="r3">' + (withTask ? (c.task ? taskLine(c) : 'Mua gần nhất ' + daysAgo(c.last)) : 'Đơn gần nhất ' + daysAgo(c.last)) + '</div>' +
      (withTask ? '<div class="acts"><button class="btn pri" data-care="' + c.phone + '" data-task="' + (c.task ? c.task.type : 'old') + '">💬 Chăm sóc</button><a class="btn" href="tel:' + c.phone + '">📞 Gọi</a>' + (!c.owner && isPoolStaff() ? claimBtn('c', c.phone) : '<button class="btn" data-quick="' + c.phone + '|knm|' + (c.task ? c.task.type : 'old') + '" title="Gọi không nghe máy: ghi “knm”, 2 ngày sau tự nhắc gọi lại">📵 KNM</button>') + '</div>'
        : !c.owner && isPoolStaff() ? '<div class="acts">' + claimBtn('c', c.phone) + '</div>' : '') +
      '</div>';
  }
  /** Bảng giải thích mọi nhãn (bấm ⓘ, dùng được trên điện thoại). */
  function openTagHelp() {
    var sw = function (k) { var col = catColor(k); return '<i class="sw" style="background:' + col + ';border-color:' + shade(col, .35) + '"></i>'; };
    var row = function (a, b) { return '<tr><td>' + a + '</td><td>' + b + '</td></tr>'; };
    var body = '<div class="box"><h3>🎨 Màu thẻ khách</h3><table class="tg-help">' +
      CAT_ORDER.map(function (k) { return row(sw(k) + '<b>' + esc(CAT_DEF[k].label) + '</b>', esc(CAT_DEF[k].tip)); }).join('') + '</table>' +
      '<p class="small muted" style="margin:6px 0 0">Người <b>chưa mua</b> lần nào nằm ở tab <b>Khách hỏi</b>, không có trong danh sách khách hàng. Màu có thể đổi ở Cài đặt; nhãn riêng bạn tạo được ưu tiên tô màu trước.</p></div>' +
      '<div class="box"><h3>🏷️ Nhãn nhóm khách</h3><table class="tg-help">' +
      row('<i>(không nhãn)</i>', esc(TIP.live)) + row('<span class="tag risk">Sắp mất</span>', esc(TIP.risk)) + row('<span class="tag lost">Lâu không mua</span>', esc(TIP.lost)) +
      row('<span class="tag vip">VIP</span>', esc(TIP.vip())) + row('<span class="tag cold">❄️ Khách lạnh</span>', esc(TIP.cold) + '. Đặt đơn mới là hết lạnh; khách “không dùng nữa” sau 6 tháng tự quay lại để chào lại 1 lần.') +
      row('<span class="tag st-huy">⚠️ hay hoàn</span>', esc(TIP.back)) + '</table></div>' +
      '<div class="box"><h3>📌 Nhãn khác</h3><table class="tg-help">' +
      row('<span class="zl on">' + ZI + ' Zalo</span>', esc(TIP.zalo) + ' (trên file Sheet cũ là dấu “(x)” sau tên).') + row('<span class="zl add">➕ Đã kết bạn Zalo</span>', 'Bấm khi vừa kết bạn Zalo với khách.') +
      row('<span class="tag st-xong">✓ Nhận ưu đãi</span>', 'Khách đồng ý nhận tin khuyến mãi. Chưa đồng ý thì vẫn hỏi thăm, hướng dẫn dùng bình thường; chỉ tránh gửi quảng cáo hàng loạt.') +
      row('<span class="tag noconsent">Chưa ai phụ trách</span>', 'Khách chưa có sale nhận. Quản lý giao khách ở mục 🧺 Kho chung tab Hôm nay.') +
      row('<span class="bad-line">⏳ trễ N ngày</span>', 'Việc chăm sóc đã qua ngày nên làm mà chưa làm (vẫn giữ thêm 7 ngày).') + '</table></div>';
    modal('ⓘ Giải thích nhãn', body, '<button class="btn pri" data-close>Đã hiểu</button>');
  }
  /* ---------- 📣 gửi ưu đãi lần lượt qua Zalo cá nhân: CRM điền tên, copy tin, mở khung chat; sale dán & gửi rồi bấm "Đã gửi → tiếp" */
  var PROMO_DEF = 'Dạ [Tên] ơi, em là nhân viên Thực Dưỡng Lành ạ. Tuần này bên em có ưu đãi dành riêng cho khách thân thiết: … [Tên] đang dùng [Sản phẩm], nếu cần đặt thêm thì em giữ suất ưu đãi cho mình nhé ❤️';
  function promoStats() {
    var g = {};
    S.d.log.forEach(function (l) { if (l.what !== 'Gửi ưu đãi' || (lvl() < 2 && l.by !== S.user.name)) return; var x = g[l.result] || (g[l.result] = { name: l.result, first: l.time, ph: {} }); if (l.time < x.first) x.first = l.time; var ph = String(l.ref).replace(/^'/, ''); if (!x.ph[ph] || l.time < x.ph[ph]) x.ph[ph] = l.time; });
    return Object.keys(g).map(function (k) {
      var x = g[k], phones = Object.keys(x.ph), conv = 0, rev = 0;
      phones.forEach(function (ph) { var t = x.ph[ph], hit = S.d.orders.filter(function (o) { return o.phone === ph && !isVoid(o.status) && o.time > t && o.time <= t + 14 * DAY; }); if (hit.length) { conv++; rev += hit.reduce(function (s0, o) { return s0 + o.total; }, 0); } });
      return { name: x.name, first: x.first, sent: phones.length, conv: conv, rev: rev };
    }).sort(function (a, b) { return b.first - a.first; });
  }
  function promoSent(phone, name) { return S.d.log.some(function (l) { return l.what === 'Gửi ưu đãi' && l.result === name && String(l.ref).replace(/^'/, '') === phone; }); }
  function openPromo() {
    var pick = S.promoPick || { list: [], label: 'Tất cả' }, tp = S.d.templates || [];
    var stats = promoStats().slice(0, 6);
    var body = '<div class="box"><p style="margin:0 0 8px">Gửi tin ưu đãi qua <b>Zalo của bạn</b> cho từng khách trong danh sách đang lọc: <b>' + esc(pick.label) + '</b> (' + pick.list.length + ' khách). CRM tự điền tên, copy tin và mở khung chat; bạn chỉ cần <b>dán và bấm gửi</b>.</p>' +
      '<label class="switch"><input type="checkbox" id="prZ" checked> Chỉ khách <b>đã kết bạn Zalo</b></label><br>' +
      '<label class="switch" style="margin-top:6px"><input type="checkbox" id="prC" checked> Chỉ khách <b>đồng ý nhận ưu đãi</b> (đúng Nghị định 13)</label>' +
      '<p class="small muted" id="prN" style="margin:8px 0 0"></p></div>' +
      '<div class="box"><label class="f"><span>Tên chương trình (để đo hiệu quả)</span><input type="text" id="prName" value="' + esc('Ưu đãi ' + fDate(Date.now()).slice(0, 5)) + '"></label>' +
      '<label class="f"><span>Mẫu tin có sẵn</span><select id="prTpl"><option value="-1">– Mẫu ưu đãi mặc định –</option>' + tp.map(function (t, i) { return '<option value="' + i + '">' + esc(t[0] + (t[1] ? ' – ' + t[1] : '')) + '</option>'; }).join('') + '</select></label>' +
      '<label class="f"><span>Nội dung (viết [Tên], [Sản phẩm] để máy tự điền; nhớ sửa phần “…”)</span><textarea id="prText" rows="5">' + esc(PROMO_DEF) + '</textarea></label></div>' +
      (stats.length ? '<div class="box"><h3>📊 Chương trình gần đây</h3><table class="tg-help">' + stats.map(function (x) { return '<tr><td><b>' + esc(x.name) + '</b><br><span class="small muted">' + fDate(x.first) + '</span></td><td>Đã gửi <b>' + x.sent + '</b> khách · <b>' + x.conv + '</b> khách mua trong 14 ngày (' + (x.sent ? pct(x.conv, x.sent) : 0) + '%) · ' + moneyShort(x.rev) + '</td></tr>'; }).join('') + '</table></div>' : '') +
      '<p class="small muted">Lưu ý: gửi rải trong ngày, không gửi dồn liên tục vài trăm tin để Zalo không hạn chế tài khoản. Tin gửi từ chính Zalo của bạn nên khách thấy gần gũi.</p>';
    var m = modal('📣 Gửi ưu đãi lần lượt', body, '<button class="btn" data-close>Đóng</button><button class="btn pri" id="prGo">▶ Bắt đầu gửi</button>');
    var pool = function () { var z = $('#prZ', m).checked, cs = $('#prC', m).checked, nm = $('#prName', m).value.trim(); return pick.list.filter(function (c) { return !coldOf(c) && (!z || c.zalo) && (!cs || c.consent) && !promoSent(c.phone, nm); }); };
    var cnt = function () { var n = pool().length; $('#prN', m).innerHTML = n ? 'Sẽ gửi cho <b>' + n + '</b> khách (đã bỏ khách lạnh và khách đã nhận chương trình này).' : '<span class="bad-line">Không còn khách nào phù hợp.</span> Thử bỏ tích “đồng ý nhận ưu đãi” nếu bạn đã hỏi ý khách, hoặc đổi bộ lọc ở trang danh sách.'; $('#prGo', m).disabled = !n; };
    ['#prZ', '#prC', '#prName'].forEach(function (k) { $(k, m).addEventListener(k === '#prName' ? 'input' : 'change', cnt); }); cnt();
    $('#prTpl', m).onchange = function () { var i = +this.value; $('#prText', m).value = i >= 0 ? tp[i][2] : PROMO_DEF; };
    $('#prGo', m).onclick = function () {
      var name = $('#prName', m).value.trim() || 'Ưu đãi', text = $('#prText', m).value.trim(); if (!text) { toast('Bạn soạn nội dung tin giúp nhé', true); return; }
      S.promo = { name: name, text: text, list: pool().map(function (c) { return c.phone; }), i: 0, sent: 0, skip: 0 }; closeModal(true); promoStep();
    };
  }
  function promoStep() {
    var P = S.promo; if (!P) return;
    if (P.i >= P.list.length) { S.promo = null; render(); modal('📣 Xong chương trình', '<div class="box"><p style="margin:0">Đã gửi <b>' + P.sent + '</b> khách' + (P.skip ? ', bỏ qua ' + P.skip : '') + ' cho “' + esc(P.name) + '”. Sau 14 ngày, mở lại <b>📣 Gửi ưu đãi lần lượt</b> để xem bao nhiêu khách đã mua.</p></div>', '<button class="btn pri" data-close>Đóng</button>'); return; }
    var c = cust(P.list[P.i]); if (!c) { P.i++; promoStep(); return; }
    var msg = fillTpl(P.text, c);
    var body = '<div class="flow-h"><div><b>Khách ' + (P.i + 1) + ' / ' + P.list.length + '</b><span>📣 ' + esc(P.name) + ' · đã gửi ' + P.sent + '</span></div><div class="bar"><i style="width:' + Math.round(P.i * 100 / P.list.length) + '%"></i></div></div>' +
      '<div class="box"><div class="r1" style="display:flex;gap:8px;align-items:center;flex-wrap:wrap"><b>' + cp(c.name) + '</b>' + custTags(c) + (c.zalo ? '<span class="zl on">' + ZI + ' Zalo</span>' : '') + '<span class="muted">' + cpPhone(c.phone) + '</span></div>' +
      '<div class="small muted" style="margin-top:4px">' + esc(shortProducts(c.products, 2)) + ' · mua gần nhất ' + daysAgo(c.last) + '</div></div>' +
      '<div class="box"><label class="f"><span>Tin gửi khách (sửa được)</span><textarea id="pmMsg" rows="6">' + esc(msg) + '</textarea></label>' +
      '<div class="steps"><button class="btn zalo" id="pmZalo">📋 Copy tin & mở Zalo</button><button class="btn" id="pmCopy">Copy tin</button></div>' +
      '<p class="small muted" style="margin:8px 0 0">Dán tin vào khung chat Zalo của khách, bấm gửi, rồi quay lại bấm <b>✅ Đã gửi</b>.</p></div>';
    var m = modal('📣 ' + esc(c.name), body, '<button class="btn" id="pmSkip">⏭ Bỏ qua</button><button class="btn pri" id="pmDone">✅ Đã gửi → khách tiếp</button>');
    m.addEventListener('click', function (e) { if (e.target === m || e.target.closest('[data-close]')) { var P2 = S.promo; S.promo = null; if (P2 && P2.sent) toast('Đã dừng. Đã gửi ' + P2.sent + ' khách cho “' + P2.name + '”. Mở lại để gửi tiếp những khách còn lại.'); } }, true);
    $('#pmCopy', m).onclick = function () { copy($('#pmMsg', m).value).then(function () { toast('Đã copy tin'); }); };
    $('#pmZalo', m).onclick = function () { copy($('#pmMsg', m).value).then(function () { toast('Đã copy – dán vào khung chat Zalo'); }); window.open(zalo(c.phone), '_blank', 'noopener'); };
    $('#pmSkip', m).onclick = function () { P.skip++; P.i++; closeModal(true); promoStep(); };
    $('#pmDone', m).onclick = function () { sendOp('customer', { phone: c.phone, promo: P.name }); P.sent++; P.i++; closeModal(true); promoStep(); };
  }
  function consentTag(c) { return c.consent ? (canEdit(c) ? '<button type="button" class="tag st-xong" data-consent="' + c.phone + '" data-off="1" title="Khách đồng ý nhận tin ưu đãi. Bấm nếu khách không muốn nhận nữa">✓ Nhận ưu đãi</button>' : '<span class="tag st-xong" title="Khách đồng ý nhận tin ưu đãi">✓ Nhận ưu đãi</span>') : canEdit(c) ? '<button type="button" class="zl add" data-consent="' + c.phone + '" title="Bấm khi khách đồng ý nhận tin ưu đãi / khuyến mãi">☐ Khách đồng ý nhận ưu đãi</button>' : ''; }
  function canEdit(c) { return lvl() >= 2 || c.owner === S.user.name; }
  function zaloTag(c) { return c.zalo ? '<span class="zl on" title="Đã kết bạn Zalo: nhắn tin chăm sóc được">' + ZI + ' Zalo</span>' : canEdit(c) ? '<button type="button" class="zl add" data-zalo="' + c.phone + '" title="Bấm khi đã kết bạn Zalo với khách">➕ Đã kết bạn Zalo</button>' : ''; }
  /* ---------- 👥 mời khách vào nhóm Zalo cộng đồng “Sống khỏe cùng Thực Dưỡng Lành” (kiến thức dinh dưỡng, Zoom hỏi đáp cùng chuyên gia) */
  function inComm(c) { return c.community === 'Đã vào'; }
  function invited(c) { return /^Đã mời/.test(c.community || ''); }
  function commText(c) {
    var tp = S.d.templates || [], t = tp.filter(function (x) { return norm(x[0]).indexOf('cong dong') >= 0; })[0];
    var txt = t ? t[2] : 'Dạ [Tên] ơi, Thực Dưỡng Lành có nhóm Zalo “Sống khỏe cùng Thực Dưỡng Lành” – nơi chia sẻ kiến thức dinh dưỡng, thực đơn lành mạnh và thông báo các buổi Zoom miễn phí cùng chuyên gia dinh dưỡng để mình hỏi đáp trực tiếp ạ. [Tên] vào nhóm cùng mọi người nhé: [Link nhóm] ❤️';
    txt = fillTpl(txt, c); return /\[Link nhóm\]/i.test(txt) ? txt.replace(/\[Link nhóm\]/gi, CFG.zalo_group || '') : txt + (CFG.zalo_group && txt.indexOf(CFG.zalo_group) < 0 ? '\n' + CFG.zalo_group : '');
  }
  /** Khung mời cộng đồng trong hộp chăm sóc: mở sẵn ở mốc hỏi nhận hàng / hỏi thăm 1 tuần. */
  function commBox(c, type, shut) {
    if (inComm(c)) return '';
    var open = !shut && (type === 'd1' || type === 'd7') && !invited(c);
    return '<details class="box comm"' + (open ? ' open' : '') + '><summary><b>👥 Mời vào nhóm Zalo cộng đồng</b> <span class="small muted">' + (invited(c) ? esc(c.community) + ', khách chưa vào nhóm' : 'khách chưa vào nhóm') + '</span></summary>' +
      '<p class="small" style="margin:8px 0">Nhóm <b>“Sống khỏe cùng Thực Dưỡng Lành”</b>: kiến thức dinh dưỡng, thực đơn lành mạnh, <b>Zoom hỏi đáp miễn phí cùng chuyên gia dinh dưỡng</b>. Khách trong nhóm gắn bó và mua lại nhiều hơn.</p>' +
      '<div class="steps"><button type="button" class="btn zalo" data-comm="' + c.phone + '|zalo">📋 Copy lời mời & mở Zalo</button><button type="button" class="btn" data-comm="' + c.phone + '|copy">Copy lời mời</button><button type="button" class="btn" data-comm="' + c.phone + '|in">✅ Khách đã vào nhóm</button></div></details>';
  }
  function commAct(phone, how) {
    var c = cust(phone); if (!c) return;
    if (how === 'in') { sendOp('customer', { phone: phone, community: 'Đã vào' }); toast('Đã ghi: khách đã vào nhóm cộng đồng 👥'); $$('.comm').forEach(function (b) { b.remove(); }); render(); return; }
    copy(commText(c)).then(function () { toast('Đã copy lời mời – dán vào khung chat Zalo của khách'); });
    if (how === 'zalo') window.open(zalo(phone), '_blank', 'noopener');
    if (!invited(c)) sendOp('customer', { phone: phone, community: 'Đã mời' });
  }
  /* ---------- 🎁 tặng quà (cẩm nang, ebook) cho khách: thêm giá trị, mở lời bằng món quà thay vì chào bán ----------
     Mẫu tin mặc định ở GIFT_TPL; quản lý sửa được ở Cài đặt → Mẫu tin: thêm dòng Thời điểm "Quà tặng", Mục đích có chữ "cẩm nang" hoặc "ebook". */
  var GIFT_TPL = {
    camnang: 'Dạ [Tên] ơi, em gửi [Tên] món quà nhỏ của Thực Dưỡng Lành: cuốn cẩm nang “Sống khỏe chủ động” 🎁\n32 trang có minh họa và có sách nói (bật nghe được), chia sẻ cách xếp mâm cơm cân bằng, chuyển sang gạo lứt từng bước, giữ sức sau tuổi 45 và nhật ký 7 ngày thay đổi nhỏ.\n[Tên] bấm vào đây đọc ngay trên điện thoại nhé: [Link quà]\nĐọc thấy chỗ nào cần hỏi, [Tên] cứ nhắn em ạ ❤️',
    ebook: 'Dạ [Tên] ơi, em tặng [Tên] ebook “Dinh Dưỡng cho Cơ Xương Khớp” kèm video thực đơn 7 ngày ạ 🎁\nSách gợi ý nên ăn gì, nên hạn chế gì cho các vấn đề cơ xương khớp thường gặp, cùng hơn 20 món dễ nấu tại nhà.\n[Tên] xem ngay tại đây: [Link quà]\nCần hỏi thêm về chế độ ăn, [Tên] cứ nhắn em nhé ❤️'
  };
  var GIFT_ZALO = '\n\nNgoài ra [Tên] vào nhóm Zalo “Sống khỏe cùng Thực Dưỡng Lành” để cùng thực hành mỗi ngày và hỏi đáp miễn phí với chuyên gia dinh dưỡng nhé: [Link nhóm]';
  var GIFT_TIP = {
    d1: 'Khách vừa nhận hàng: gửi kèm 1 món quà kiến thức để khách thấy mình được chăm sóc, không chỉ được bán hàng.',
    d7: 'Hỏi thăm sau 1 tuần: món quà là cái cớ tự nhiên để trò chuyện tiếp.',
    lead: 'Khách mới hỏi: tặng quà trước để tạo thiện cảm, sau đó mới tư vấn sản phẩm.',
    winback: 'Lâu chưa liên lạc: mở lời bằng một món quà thay vì chào bán, khách dễ trả lời hơn.',
    old: 'Lâu chưa liên lạc: mở lời bằng một món quà thay vì chào bán, khách dễ trả lời hơn.',
    runout: 'Nhắc đặt lại: gửi thêm quà để tin nhắn có giá trị với khách, không chỉ là lời mời mua.'
  };
  function giftList() { return CFG.gifts || []; }
  function giftPerson(phone) {
    var c = cust(phone); if (c) return { phone: c.phone, name: c.name, products: c.products || [], hint: (c.products || []).join(' ') + ' ' + (c.note || ''), community: c.community || '', isCust: true };
    var l = (S.d.leads || []).filter(function (x) { return x.phone === normPhone(phone); }).sort(function (a, b) { return (b.time || 0) - (a.time || 0); })[0];
    return l ? { phone: l.phone, name: l.name, products: [l.interest || 'sản phẩm bên em'], hint: (l.interest || '') + ' ' + (l.note || ''), community: '', lead: l } : null;
  }
  /** Đã gửi quà này chưa: nhật ký "Gửi quà tặng", hoặc khách tự nhận trên web (khách hỏi kênh Ebook có ghi tên quà). */
  function giftGot(p, g) {
    var lg = logOf(p.phone).filter(function (l) { return l.what === 'Gửi quà tặng' && l.result === g.title; })[0];
    if (lg) return { time: lg.time, by: lg.by };
    var web = (S.d.leads || []).filter(function (l) { return l.phone === normPhone(p.phone) && /^ebook/i.test(l.channel || '') && norm(l.interest || '').indexOf(g.key === 'camnang' ? 'cam nang' : 'xuong khop') >= 0; })[0];
    return web ? { time: web.time, by: 'khách tự nhận trên web' } : null;
  }
  /** Gợi ý quà: khách có dấu hiệu quan tâm cơ xương khớp → ebook trước, còn lại cẩm nang trước; quà đã gửi xuống cuối. */
  function giftOrder(p) {
    var joint = /khop|xuong|gout|gut\b|loang|than kinh toa|thoai hoa|dau moi|cung co|dau lung|dau goi/.test(norm(p.hint || ''));
    return giftList().slice().sort(function (a, b) { var ga = giftGot(p, a) ? 1 : 0, gb = giftGot(p, b) ? 1 : 0; if (ga !== gb) return ga - gb; return ((a.key === 'ebook') === joint ? 0 : 1) - ((b.key === 'ebook') === joint ? 0 : 1); });
  }
  function giftText(p, g, withZalo) {
    var t = (S.d.templates || []).filter(function (x) { var k = norm(x[0] + ' ' + x[1]); return k.indexOf('qua tang') >= 0 && k.indexOf(g.key === 'camnang' ? 'cam nang' : 'ebook') >= 0; })[0];
    var txt = (t ? t[2] : GIFT_TPL[g.key] || 'Dạ [Tên] ơi, em gửi [Tên] món quà nhỏ của Thực Dưỡng Lành: [Tên quà] 🎁 [Link quà]');
    if (txt.indexOf('[Link quà]') < 0 && txt.indexOf(g.link) < 0) txt += '\n' + g.link;
    if (withZalo && CFG.zalo_group && p.community !== 'Đã vào') txt += GIFT_ZALO;
    return fillTpl(txt, p).replace(/\[Link quà\]/gi, g.link).replace(/\[Tên quà\]/gi, g.title).replace(/\[Link nhóm\]/gi, CFG.zalo_group || '');
  }
  function giftBox(p, ctx, shut) {
    var list = giftList(); if (!p || !list.length) return '';
    var ord = giftOrder(p), left = ord.filter(function (g) { return !giftGot(p, g); }).length;
    var open = !shut && !!GIFT_TIP[ctx] && (ctx === 'd1' || ctx === 'd7' || ctx === 'lead') && left > 0;
    return '<details class="box gift" data-gift-box="' + p.phone + '|' + (ctx || '') + '"' + (open ? ' open' : '') + '><summary><b>🎁 Tặng quà cho khách</b> <span class="small muted">' + (left ? left + ' quà chưa gửi' : 'đã gửi đủ quà') + '</span></summary>' +
      '<p class="small" style="margin:8px 0">' + esc(GIFT_TIP[ctx] || 'Quà tặng miễn phí, gửi để thêm giá trị cho khách. Mỗi khách gửi mỗi quà 1 lần là đủ.') + '</p>' +
      ord.map(function (g, i) {
        var got = giftGot(p, g);
        return '<div class="gift-row"><img src="' + esc(g.image) + '" alt="" width="48" height="72" loading="lazy"><div class="gift-t"><b>' + esc(g.title) + '</b>' + (i === 0 && !got ? ' <span class="tag st-xong">Gợi ý</span>' : '') +
          (got ? ' <span class="small muted">✓ ' + (got.by === 'khách tự nhận trên web' ? 'Khách đã tự nhận trên web ' : 'Đã gửi ') + fDate(got.time).slice(0, 5) + (got.by && got.by !== 'khách tự nhận trên web' ? ' (' + esc(got.by) + ')' : '') + '</span>' : '') +
          '<div class="small muted">' + esc(g.desc) + '</div>' +
          '<div class="steps"><button type="button" class="btn zalo" data-gift="' + p.phone + '|' + g.key + '|zalo">📋 Copy tin & mở Zalo</button><button type="button" class="btn" data-gift="' + p.phone + '|' + g.key + '|copy">Copy tin</button><button type="button" class="btn" data-gift="' + p.phone + '|' + g.key + '|link">🔗 Chỉ copy link</button></div></div></div>';
      }).join('') +
      (CFG.zalo_group && p.community !== 'Đã vào' ? '<label class="switch small" style="margin-top:6px"><input type="checkbox" data-giftz checked> Kèm lời mời vào nhóm Zalo cộng đồng</label>' : '') + '</details>';
  }
  function giftAct(el, phone, key, how) {
    var p = giftPerson(phone), g = giftList().filter(function (x) { return x.key === key; })[0]; if (!p || !g) return;
    var box = el.closest('[data-gift-box]'), z = box && $('[data-giftz]', box), txt = how === 'link' ? g.link : giftText(p, g, !!(z && z.checked));
    copy(txt).then(function () { toast(how === 'link' ? 'Đã copy link quà' : 'Đã copy tin tặng quà – dán vào khung chat Zalo của khách'); });
    if (how === 'zalo') window.open(zalo(phone), '_blank', 'noopener');
    if (how === 'link') return;
    if (!giftGot(p, g) || !giftGot(p, g).by || giftGot(p, g).by === 'khách tự nhận trên web' || Date.now() - giftGot(p, g).time > DAY) sendOp('gift', { phone: p.phone, name: p.name, gift: g.title });
    if (box) { var ctx = box.getAttribute('data-gift-box').split('|')[1], wasOpen = box.open; box.outerHTML = giftBox(p, ctx); var nb = $('[data-gift-box="' + p.phone + '|' + ctx + '"]'); if (nb) nb.open = wasOpen; }
  }
  function setZalo(c, on) { sendOp('customer', { phone: c.phone, zalo: on ? 1 : 0 }); toast(on ? 'Đã đánh dấu kết bạn Zalo ✓' : 'Đã bỏ đánh dấu Zalo'); render(); }
  function orderCard(o, withActs) {
    var next = NEXT[o.status];
    var oc = orderCat(o);
    return '<div class="card click tinted" data-order="' + esc(o.id) + '"' + catAttr(oc) + '>' +
      '<div class="r1"><b>' + esc(o.name) + '</b>' + stTag(o.status) + (oc.key !== 'void' ? catChip(oc) : '') + '<span class="end">' + money(o.total) + '</span></div>' +
      '<div class="r2">' + cpPhone(o.phone) + ' · ' + esc(o.payment) + ' ' + paidTag(o) + ' · <span class="muted">' + cp(o.id) + '</span></div>' +
      (o.tracking ? '<div class="r3">' + trackLink(o) + '</div>' : '') +
      '<div class="r3 pre">' + esc(o.items.split('\n').map(function (l) { return l.replace(/\s*=\s*[\d.,]+\s*₫?$/, ''); }).join('\n')) + '</div>' +
      '<div class="r3">' + when(o.time) + (o.ca && o.ca !== 'Ngày' ? ' · ' + (o.ca === 'Lễ' ? '🎉 Lễ' : '🌙 Tối/CN') : '') + (o.seller && (lvl() >= 2 || o.seller !== S.user.name) ? ' · 👤 ' + esc(o.seller) : '') + (o.note ? ' · 📝 ' + esc(o.note.length > 80 ? o.note.slice(0, 80) + '…' : o.note) : '') + '</div>' +
      (withActs && next ? '<div class="acts"><button class="btn pri" data-next="' + esc(o.id) + '">' + NEXT_LABEL[o.status] + '</button><a class="btn" href="tel:' + o.phone + '">📞 Gọi</a><a class="btn zalo" href="' + zalo(o.phone) + '" target="_blank" rel="noopener">Zalo</a></div>' : '') +
      '</div>';
  }
  function paidTag(o) {
    if (!isBank(o) || o.status === 'Huỷ') return '';
    return o.paid ? '<span class="tag st-xong">✓ Đã nhận tiền</span>' : '<span class="tag noconsent">💳 Chưa nhận tiền</span>';
  }
  function empty(t) { return '<div class="empty">' + t + '</div>'; }

  /* ================================================================ HÔM NAY */
  function viewToday() {
    var oOk = function (o) { return lvl() < 2 || whoOk(orderOwner(o)); }, wn = whoName();
    var no = newOrders().filter(oOk).sort(function (a, b) { return b.time - a.time; }), ts = tasksShown(), ld = sortLeads(leadsDue()), hot = ld.filter(isHotLead);
    ld = ld.filter(function (l) { return !isHotLead(l); });
    var up = unpaidOrders().filter(function (o) { return o.status !== 'Mới' && oOk(o); }).sort(function (a, b) { return a.time - b.time; });
    var t0 = today(), doneToday = S.d.log.filter(function (l) { return l.time >= t0 && l.what !== 'Cài đặt' && l.what !== 'Nhân sự' && (lvl() < 2 || !wn || l.by === wn); }).sort(function (a, b) { return b.time - a.time; });
    var h = '<div class="page-head"><h1>Chào ' + esc(S.user.name) + ' 👋</h1><div class="grow"></div>' + whoSel() + '</div>';
    var q = dayQueue(), total = q.list.length + q.done, pc = total ? Math.round(q.done * 100 / total) : 100;
    h += '<section class="hero"><div class="hero-t"><b>' + (q.list.length ? 'Hôm nay: ' + q.list.length + ' khách cần chăm sóc' : '🎉 Đã xong việc chăm sóc hôm nay') + '</b><span>đã xong ' + q.done + '</span></div>' +
      '<div class="bar"><i style="width:' + pc + '%"></i></div>' +
      (q.list.length && (!wn || wn === S.user.name) ? '<button class="btn pri lg block" data-flow>▶ Bắt đầu gọi lần lượt</button>' : '') +
      (q.rest ? '<p class="small muted" style="margin:8px 0 0">Còn ' + q.rest + ' khách để các ngày sau (tối đa ' + dayLimit() + ' khách/ngày, đổi ở <a href="#cai-dat">Cài đặt</a>).</p>' : '') +
      (lvl() < 2 ? todayGoalLine() : '') + '</section>';
    // Đợt 2 (16/10/2026): sale mở máy thấy ngay khách cần gọi; mục tiêu chi tiết + thi đua + báo cáo cuối ngày chuyển xuống cuối trang. Quản lý giữ thi đua + ô số ở đầu.
    if (lvl() >= 2) {
      h += raceBlock(); // bảng thi đua: quản lý thấy cả bảng, kể cả khi đang lọc 1 nhân viên
      h += '<div class="minis">' + mini('🧾 Đơn mới', no.length, '#don-hang', no.length ? 'warn' : '') + mini('🙋 Khách hỏi', hot.length + ld.length, '#tiem-nang', hot.length + ld.length ? 'bad' : '') + mini('✅ Đã làm', doneToday.length, '', '') + miniGoal() + '</div>';
    }
    var TB = trendBuckets(monthRange(monthOf(Date.now()))), tsk = function (v) { return sparkSvg(v, TB.partial); };
    if (lvl() >= 2 && wn) {
      var pm = perf(wn, monthRange(monthOf(Date.now())));
      h += '<div class="kpis">' + kpi('Doanh số tháng ' + (new Date().getMonth() + 1) + ' của ' + esc(wn), moneyShort(pm.sales), '', '', pm.orders + ' đơn · chốt ' + (pm.closePct === null ? '–' : pm.closePct + '%'), tsk(repSeries(wn, TB, 0, 'sales'))) +
        kpi('Khách đang phụ trách', pm.mine, '', '', pm.care + ' lượt chăm sóc tháng này') + '</div>';
    } else if (lvl() >= 2) {
      var m = monthStats();
      h += '<div class="kpis">' + kpi('Doanh số tháng ' + m.month, moneyShort(m.revenue), '', '', m.orders + ' đơn · ' + (m.prev ? (m.revenue >= m.prev ? '▲ ' : '▼ ') + 'tháng trước ' + moneyShort(m.prev) : 'chưa có tháng trước'), tsk(repSeries(null, TB, 0, 'sales'))) +
        kpi('Khách mới tháng ' + m.month, m.newCus, '', '', m.returning + ' khách mua lại', tsk(trendSum(TB, S.d.customers.filter(function (c) { return c.first; }), function (c) { return c.first; }, function () { return 1; }))) + '</div>';
    }

    if (lvl() >= 2 && !wn) h += teamBlock() + waitingBlock(); // đang xem 1 nhân viên → ẩn khách chưa ai phụ trách
    // Mở tab lần đầu: chỉ mục cần gọi đầu tiên mở sẵn (và chỉ hiện vài khách), các mục khác gập lại – sale tự bấm mở khi tới lượt
    var go = S.f.gopen || {}, firstG = true;
    var grp = function (k, title, n, tip, body, cls) { var op = k in go ? go[k] : firstG; firstG = false; return '<details class="grp" data-grp="' + k + '"' + (op ? ' open' : '') + '><summary><span class="g-t">' + title + '</span><span class="count">' + n + '</span>' + (tip ? '<span class="g-tip">' + tip + '</span>' : '') + '</summary><div class="' + cls + '">' + body + '</div></details>'; };
    if (no.length || up.length) h += '<section class="section"><div class="section-h"><h2>1️⃣ Đơn mới – gọi khách xác nhận</h2>' + (no.length ? '<span class="count">' + no.length + '</span>' : '') + '<span class="tip">gọi xong bấm “Xác nhận”</span></div>' +
      (no.length ? grp('neworders', '🧾 Đơn mới chờ xác nhận', no.length, 'gọi khách xác nhận đơn', capRows(no, orderRow), 'crows') : '') +
      (up.length ? (function () { var f = firstG; firstG = false; var x = grp('unpaid', '💳 Chuyển khoản chưa nhận tiền', up.length, 'xem tài khoản VCB, tiền về thì mở đơn bấm “Xác nhận đã nhận tiền”', capRows(up, orderRow), 'crows'); firstG = f; return x; })() : '') + '</section>'; // nhóm chờ tiền không tính là “cần gọi”
    h += refThanksBlock(); // 🎁 bạn bè khách cũ đã đặt → tặng quà / voucher cảm ơn người giới thiệu
    if (hot.length) h += '<section class="section"><div class="section-h"><h2>2️⃣ 🔥 Khách vừa hỏi – liên hệ ngay</h2><span class="count">' + hot.length + '</span></div>' +
      grp('hot', '🔥 Khách vừa hỏi', hot.length, 'hỏi trong 24 giờ qua, chưa ai liên hệ. Gọi càng sớm càng dễ chốt', capRows(hot, leadCard), 'list cols" style="padding:10px') + '</section>';

    h += '<section class="section"><div class="section-h"><h2>' + (hot.length ? '3️⃣' : '2️⃣') + ' Chăm sóc khách</h2>' + (q.list.length ? '<span class="count">' + q.list.length + '</span>' : '') + '<span class="tip">bấm vào nhóm để mở danh sách</span></div>' + (q.list.length ? colorKey() : '');
    if (!q.list.length) h += empty(lvl() >= 2 && S.who && tasksAll().length ? 'Khách của ' + (S.who === '-' ? 'mục “Chưa ai phụ trách”' : esc(S.who)) + ' đã chăm sóc xong. Chọn “Tất cả nhân sự” để xem các khách khác.' : 'Hôm nay không còn khách cần chăm sóc 🎉');
    GROUP_ORDER.forEach(function (k) {
      var arr = q.list.filter(function (c) { return (vipLate(c) ? 'viplate' : taskKey(c)) === k; }); if (!arr.length) return;
      var late = k === 'viplate' ? 0 : arr.filter(function (c) { return c.task && c.task.late && k !== 'callback' && k !== 'runout'; }).length;
      var G = k === 'viplate' ? { icon: '⚠️', title: 'Khách VIP trễ hạn', tip: 'khách VIP quá hạn chăm sóc từ 2 ngày – gọi trước' } : TASKS[k];
      var op = k in go ? go[k] : firstG; firstG = false; // nhóm đầu tiên còn việc tự mở sẵn
      h += '<details class="grp" data-grp="' + k + '"' + (op ? ' open' : '') + '><summary><span class="g-t">' + G.icon + ' ' + G.title + '</span><span class="count">' + arr.length + '</span>' + (late ? '<span class="g-late">⏳ ' + late + ' trễ</span>' : '') + '<span class="g-tip">' + G.tip + '</span></summary>' +
        '<div class="rows">' + capRows(arr, rowCard) + '</div></details>';
    });
    h += '</section>';

    h += '<section class="section"><div class="section-h"><h2>' + (hot.length ? '4️⃣' : '3️⃣') + ' Khách hỏi cần liên hệ</h2>' + (ld.length ? '<span class="count">' + ld.length + '</span>' : '') + '<span class="tip">người hỏi mua nhưng chưa mua</span></div>' +
      (ld.length ? '<details class="grp" data-grp="leads"' + (S.f.gopen && S.f.gopen.leads ? ' open' : '') + '><summary><span class="g-t">🙋 Người hỏi cần liên hệ</span><span class="count">' + ld.length + '</span><span class="g-tip">' + (hot.length ? 'đến hẹn, 3 ngày chưa liên hệ, hoặc hỏi đã lâu mà chưa ai liên hệ' : 'mới hỏi, đến hẹn hoặc 3 ngày chưa liên hệ') + '</span></summary><div class="list cols" style="padding:10px">' + ld.map(leadCard).join('') + '</div></details>' : empty('Không có khách hỏi cần liên hệ 🎉')) +
      '<button class="btn" data-newlead style="margin-top:10px">＋ Thêm khách hỏi</button></section>';

    if (doneToday.length) h += '<section class="section"><details class="grp" data-grp="done"' + (S.f.gopen && S.f.gopen.done ? ' open' : '') + '><summary><span class="g-t">✅ Đã làm hôm nay</span><span class="count">' + doneToday.length + '</span></summary><div class="timeline" style="padding:12px">' +
      doneToday.slice(0, 40).map(logItem).join('') + '</div></details></section>';
    if (lvl() < 2) h += '<section class="section td-tail"><div class="section-h"><h2>🏁 Mục tiêu & thi đua</h2></div>' + myGoalToday() + raceBlock() + '</section>';
    h += '<button class="btn block" data-daily="' + esc(lvl() >= 2 ? wn || '' : S.user.name) + '" style="margin-top:12px">📋 Báo cáo cuối ngày (gửi Zalo)</button>';
    return h;
  }
  /** Sale: 1 dòng mục tiêu tháng + hôm nay trong khung đầu trang Hôm nay (chi tiết ở cuối trang). */
  function todayGoalLine() {
    var me = S.user.name, mk = monthOf(Date.now()), R = monthRange(mk), t = targetOf(me, mk), t0 = today(), sales = perf(me, R).sales, td = perf(me, [t0, t0 + DAY]);
    if (!t || !t.amount) return '<p class="td-goal">🎯 Doanh số tháng: <b>' + moneyShort(sales) + '</b> · chưa đặt mục tiêu (đặt ở cuối trang)</p>';
    var left = Math.round((R[1] - t0) / DAY), need = Math.max(0, Math.ceil((t.amount - (sales - td.sales)) / Math.max(1, left)));
    return '<p class="td-goal">🎯 Tháng: <b>' + moneyShort(sales) + '</b> / ' + moneyShort(t.amount) + ' (' + pct(sales, t.amount) + '%) · Hôm nay: <b>' + moneyShort(td.sales) + '</b>' + (need ? ' / cần ' + moneyShort(need) : '') + '</p>';
  }
  /** Quản lý (đang xem Tất cả nhân sự): tiến độ hôm nay của từng người. Bấm 1 dòng → lọc theo người đó. */
  function teamBlock() {
    var names = staffNames(); if (!names.length) return '';
    var st = teamStats(names);
    var cell = function (v, bad) { return '<td' + (v && bad ? ' class="bad"' : '') + '>' + (v || '–') + '</td>'; };
    return '<section class="section"><div class="section-h"><h2>👥 Tiến độ nhân sự hôm nay</h2><span class="tip">bấm vào tên để xem việc của người đó</span></div><div class="team-wrap"><table class="team"><thead><tr><th>Nhân sự</th><th>Chăm sóc<br><small>đã xong / cần làm</small></th><th>Trễ hạn</th><th title="Khách gọi không nghe máy hôm nay">Không nghe</th><th>Khách hỏi chờ</th><th>Đơn chưa xác nhận</th><th>Chốt hôm nay</th></tr></thead><tbody>' +
      names.map(function (n) {
        var x = st[n], all = x.doneN + x.todo, p = all ? Math.round(x.doneN * 100 / all) : 100;
        return '<tr data-who="' + esc(n) + '"><td><b>' + esc(n) + '</b></td><td><div class="tm-p"><span>' + x.doneN + ' / ' + all + '</span><div class="bar"><i style="width:' + p + '%"></i></div></div></td>' +
          '<td' + (x.late ? ' class="bad"' : '') + '>' + (x.late ? x.late + (x.vip ? ' <small>(' + x.vip + ' VIP)</small>' : '') : '–') + '</td>' + cell(x.knm) + cell(x.leads, true) + cell(x.newO, true) +
          '<td>' + (x.sold ? x.sold + ' đơn · ' + moneyShort(x.rev) : '–') + '</td></tr>';
      }).join('') + '</tbody></table></div></section>';
  }
  /** Tiến độ hôm nay của từng người (bảng Tiến độ nhân sự + Mức dùng CRM). */
  function teamStats(names) {
    var t0 = today(), lim = dayLimit(), st = {};
    names.forEach(function (n) { st[n] = { done: {}, knm: 0, todo: 0, late: 0, vip: 0, leads: 0, newO: 0, sold: 0, rev: 0 }; });
    S.d.log.forEach(function (l) { var x = st[l.by]; if (!x || l.time < t0 || !isCareLog(l)) return; x.done[String(l.ref).replace(/^'/, '')] = 1; if (l.result === NO_REPLY) x.knm++; });
    S.d.customers.forEach(function (c) { var x = st[c.owner]; if (!x || !c.task || coldOf(c)) return; x.todo++; if (c.task.late && c.task.type !== 'runout') { x.late++; if (isVip(c)) x.vip++; } });
    names.forEach(function (n) { var x = st[n]; x.todo += oldDueAll(n).length; x.doneN = Object.keys(x.done).length; x.todo = Math.min(x.todo, Math.max(0, lim - x.doneN)); });
    (S.d.leads || []).forEach(function (l) { var x = st[l.owner]; if (x && leadDue(l)) x.leads++; });
    S.d.orders.forEach(function (o) { var x = st[orderOwner(o)], y = st[o.seller]; if (x && o.status === 'Mới') x.newO++; if (y && o.time >= t0 && !isVoid(o.status)) { y.sold++; y.rev += Number(o.total) || 0; } });
    return st;
  }
  /** Quản lý: khách / khách hỏi chưa có người phụ trách → giao ngay tại chỗ. */
  function waitingBlock() {
    var cs = S.d.customers.filter(function (c) { return !c.owner && (c.task || (c.last && today() - dayStart(c.last) <= 30 * DAY)); }).sort(function (a, b) { return (b.last || 0) - (a.last || 0); });
    var ls = (S.d.leads || []).filter(function (l) { return !l.owner && isOpenLead(l); });
    var allC = S.d.customers.filter(function (c) { return !c.owner; }).length;
    if (!cs.length && !ls.length && !allC) return '';
    var sel = function (kind, id) { return '<select class="assign" data-assign="' + kind + '|' + esc(id) + '"><option value="">Giao cho…</option>' + userNames().map(function (n) { return '<option>' + esc(n) + '</option>'; }).join('') + '</select>'; };
    return '<section class="section"><details class="grp" data-grp="waiting"' + (S.f.gopen && S.f.gopen.waiting ? ' open' : '') + '><summary><span class="g-t">🧺 Kho chung – chờ giao người phụ trách</span><span class="count">' + (cs.length + ls.length) + '</span><span class="g-tip">chỉ quản lý thấy · chọn “Giao cho…” để giao khách · chế độ hiện tại: ' + MODE_INFO[mode()][0] + ' (đổi ở Cài đặt)</span></summary><div style="padding:10px">' +
      (cs.length + ls.length ? '<div class="list cols">' +
        cs.slice(0, 20).map(function (c) { return '<div class="card"><div class="r1"><b>' + esc(c.name) + '</b>' + custTags(c) + '<span class="end">' + moneyShort(c.spent) + '</span></div><div class="r2">' + fPhone(c.phone) + ' · mua ' + daysAgo(c.last) + '</div><div class="acts">' + sel('c', c.phone) + '</div></div>'; }).join('') +
        ls.slice(0, 20).map(function (l) { return '<div class="card"><div class="r1"><b>' + esc(l.name) + '</b>' + leadTag(l) + '<span class="end small muted">' + esc(chLabel(l.channel)) + '</span></div><div class="r2">' + fPhone(l.phone) + (l.interest ? ' · ' + esc(l.interest) : '') + ' · hỏi ' + daysAgo(l.time) + '</div><div class="acts">' + sel('l', l.id) + '</div></div>'; }).join('') + '</div>' : '') +
      (allC > cs.length ? '<p class="small muted">Tổng cộng ' + allC + ' khách (kể cả khách cũ) chưa ai phụ trách. Vào <a href="#cai-dat">Cài đặt → Chia khách</a> để chia đều một lần.</p>' : '') + '</div></details></section>';
  }
  /** Nhóm dài: chỉ hiện vài thẻ đầu, phần còn lại bấm “Xem thêm” mới hiện (đỡ dài dằng dặc). */
  var CAP_ROWS = 5;
  function capRows(arr, fn) {
    if (arr.length <= CAP_ROWS + 2) return arr.map(fn).join('');
    return arr.slice(0, CAP_ROWS).map(fn).join('') + '<div class="gm-rest" hidden>' + arr.slice(CAP_ROWS).map(fn).join('') + '</div>' +
      '<button class="btn gm-more" data-gmore>Xem thêm ' + (arr.length - CAP_ROWS) + ' khách</button>';
  }
  /* ---------- danh sách việc trong ngày: xếp theo mức quan trọng, giới hạn số khách/ngày (phần còn lại để mai, có “trễ N ngày”) */
  var DAY_LIMIT_DEF = 30, GROUP_ORDER = ['callback', 'viplate', 'runout', 'd1', 'd7', 'd14', 'd30', 'winback', 'old'];
  var PRIO = { callback: 0, runout: 1, d1: 2, d7: 3.5, d14: 4, d30: 5, winback: 6, old: 7 }; // 27/10/2026: sắp hết hàng lên trước hỏi nhận hàng (dễ ra đơn nhất; hỏi nhận hàng còn hiện 3 ngày)
  function dayLimit() { var n = parseInt(store('crm_daylimit') || '', 10); return n > 0 ? n : DAY_LIMIT_DEF; }
  function taskKey(c) { return c.task ? c.task.type : 'old'; }
  /** Cùng loại việc: khách dễ ra đơn lên trước. VIP, mua lại nhiều lần cộng điểm; từng hoàn đơn, lần trước không nghe máy trừ điểm. */
  function buyScore(c) { return (isVip(c) ? 2 : 0) + Math.min(c.okN || 0, 5) * 0.5 - (c.backN ? 2 : 0) - (c.careResult === NO_REPLY ? 0.5 : 0); }
  function vipLate(c) { var k = taskKey(c); return !!(c.task && c.task.late >= 2 && k !== 'callback' && k !== 'runout' && isVip(c)); } // VIP bị bỏ sót ≥ 2 ngày
  function prioOf(c) { var k = taskKey(c); return vipLate(c) ? 0.5 : c.task && c.task.late && k !== 'callback' && k !== 'runout' ? 3 : PRIO[k]; }
  function isCareLog(l) { if (!CARE_WHAT) { CARE_WHAT = {}; Object.keys(TASK_LOG).forEach(function (k) { CARE_WHAT[TASK_LOG[k]] = 1; }); CARE_WHAT['Ghi nhanh'] = 1; } return !!CARE_WHAT[l.what]; }
  function doneCount() { var t0 = today(), o = {}, me = whoName() || S.user.name; S.d.log.forEach(function (l) { if (l.time >= t0 && l.by === me && isCareLog(l)) o[String(l.ref).replace(/^'/, '')] = 1; }); return Object.keys(o).length; }
  /** SĐT đang có thẻ khách hỏi cần liên hệ ở tab Hôm nay → khách cũ đó không hiện thêm 1 lần nữa ở mục Chăm sóc (mỗi khách 1 thẻ). */
  function leadPhones() { var o = {}; leadsDue().forEach(function (l) { o[normPhone(l.phone)] = 1; }); return o; }
  function dayQueue() {
    var lp = leadPhones(), all = tasksShown().concat(oldDueAll()).filter(function (c) { return !lp[c.phone]; });
    all.sort(function (a, b) { return prioOf(a) - prioOf(b) || ((b.task && b.task.late) || 0) - ((a.task && a.task.late) || 0) || buyScore(b) - buyScore(a) || b.spent - a.spent; });
    var done = doneCount(), room = Math.max(0, dayLimit() - done);
    return { list: all.slice(0, room), rest: Math.max(0, all.length - room), done: done };
  }
  function mini(label, n, href, cls) { return '<' + (href ? 'a href="' + href + '"' : 'div') + ' class="mini ' + (cls || '') + '"><span>' + label + '</span><b>' + n + '</b></' + (href ? 'a' : 'div') + '>'; }
  /** Tab Hôm nay của nhân viên: khối mục tiêu tháng (như tab Hiệu quả) + doanh số hôm nay so với mức cần bán mỗi ngày. */
  function myGoalToday() {
    var me = S.user.name, mk = monthOf(Date.now()), R = monthRange(mk), t = targetOf(me, mk), t0 = today();
    var sales = perf(me, R).sales, td = perf(me, [t0, t0 + DAY]), h = targetBlock(me, mk, sales, true);
    if (!t || !t.amount) return h;
    var left = Math.round((R[1] - t0) / DAY), need = Math.max(0, Math.ceil((t.amount - (sales - td.sales)) / Math.max(1, left))); // mức cần/ngày tính từ đầu hôm nay
    var p = need ? Math.min(1, td.sales / need) : 1;
    return h.replace(/<button class="btn[^"]*" data-target=/, '<div class="goal-day"><div><b>📅 Hôm nay:</b> đã bán <b>' + moneyShort(td.sales) + '</b> (' + td.orders + ' đơn)' + (need ? ' / cần <b>' + moneyShort(need) + '</b>' : '') + '<span>' + (need ? (p >= 1 ? '✅ Đủ chỉ tiêu ngày' : 'còn ' + moneyShort(need - td.sales)) : '') + '</span></div>' +
      (need ? '<div class="bar sm"><i style="width:' + (p * 100).toFixed(1) + '%"></i></div>' : '') + '</div>$&');
  }
  /* ---------- Bảng thi đua: Top 3 mỗi hạng mục + hạng của mình + còn cách người ngay trên bao nhiêu. Hỏi máy chủ lệnh 'race' (nhớ 10 phút);
   * máy chủ chỉ gửi cho nhân viên Top 3 và số của chính họ (người hạng 4 trở xuống không bị lộ). Máy chủ cũ chưa có lệnh này → ẩn khối. */
  // 17/10/2026: Doanh số xếp theo % mục tiêu (máy chủ gửi c.pct = 1); số tiền của người khác chỉ quản lý thấy. Máy chủ cũ (không có c.pct) vẫn hiện tiền như trước.
  var RACE_CATS = { sales: ['🏆 Doanh số', '% mục tiêu đạt (không tính đơn huỷ / hoàn)'], close: ['🎯 Tỷ lệ chốt', 'khách hỏi được giao ra đơn'], back: ['💚 Khách cũ quay lại', 'số khách cũ mua thêm đơn'], grow: ['🚀 Tiến bộ nhất', 'doanh số so với cùng kỳ trước'] };
  function raceGet() {
    var c = S.race;
    if ((!c || Date.now() - c.at > 600e3) && !S.raceBusy) {
      S.raceBusy = true;
      api('race', {}).then(function (j) { S.race = { at: Date.now(), d: j }; }, function (e) { S.race = { at: Date.now(), d: { ok: false, error: e && e.message } }; })
        .then(function () { S.raceBusy = false; if (route().view === 'hom-nay' && !$('.modal')) render(); });
    }
    return c ? c.d : undefined;
  }
  function raceVal(k, v, pc) { return k === 'sales' && !pc ? moneyShort(v) : k === 'sales' ? v + '%' : k === 'back' ? v + ' khách' : k === 'grow' ? (v > 0 ? '+' : '') + v + '%' : v + '%'; }
  function raceGap(k, g, pc) { return k === 'sales' && !pc ? moneyShort(g) : k === 'back' ? g + ' khách' : g + ' điểm %'; }
  function raceCat(c, P, wk) {
    var lb = RACE_CATS[c.k], md = ['🥇', '🥈', '🥉'], list = lvl() >= 2 && c.all ? c.all : c.top;
    var money = function (s) { return s != null && c.pct ? ' <small class="race-money">' + moneyShort(s) + '</small>' : ''; }; // máy chủ chỉ gửi tiền của mình (hoặc của mọi người cho quản lý)
    var rows = list.length ? list.map(function (e) { return '<li' + (e.n === S.user.name ? ' class="race-me"' : '') + '><span>' + (md[e.r - 1] || e.r + '.') + ' ' + esc(e.n) + '</span><b>' + raceVal(c.k, e.v, c.pct) + money(e.s) + '</b></li>'; }).join('') : '<li class="race-none">Chưa có ai trong kỳ này</li>';
    if (c.none && c.none.length) rows += '<li class="race-none">Chưa đặt mục tiêu: ' + c.none.map(function (e) { return esc(e.n) + (e.s ? ' (' + moneyShort(e.s) + ')' : ''); }).join(', ') + '</li>';
    var me = '';
    if (lvl() < 2) {
      if (!c.me) me = c.k === 'sales' && c.pct ? 'Đặt 🎯 mục tiêu tháng để vào bảng xếp hạng' : c.k === 'close' ? 'Cần ít nhất ' + (wk ? 3 : 5) + ' khách hỏi trong kỳ để xếp hạng' : c.k === 'grow' ? 'Cần doanh số kỳ trước từ 500k để so' : 'Chưa có số liệu';
      else if (c.me.r === 1 && c.me.v > 0) me = '👑 Bạn đang dẫn đầu, giữ vững nhé!' + (c.me.s != null ? ' · ' + moneyShort(c.me.s) : '');
      else me = 'Bạn: <b>hạng ' + c.me.r + '/' + c.count + '</b> · ' + raceVal(c.k, c.me.v, c.pct) + (c.me.s != null ? ' (' + moneyShort(c.me.s) + ')' : '') + (c.me.gap ? ' · còn cách người trên <b>' + raceGap(c.k, c.me.gap, c.pct) + '</b>' : '');
    }
    return '<div class="race-cat"><div class="race-cat-h"><b>' + lb[0] + '</b><small>' + lb[1] + '</small></div><ol>' + rows + '</ol>' + (me ? '<p class="race-mine">' + me + '</p>' : '') + '</div>';
  }
  function raceBlock() {
    var d = raceGet();
    if (d === null || (d && !d.ok)) return '<section class="race-box"><div class="race-h"><b>🏁 Bảng thi đua</b><button class="btn sm" data-race="retry">🔄 Thử lại</button></div><p class="small muted">Chưa tải được bảng thi đua' + (d && d.error ? ' (' + esc(d.error) + ')' : '') + '. Bấm Thử lại sau ít phút.</p></section>';
    if (!d) return '<section class="race-box"><div class="race-h"><b>🏁 Bảng thi đua</b></div><p class="small muted">Đang tải…</p></section>';
    var wk = (S.f.race || 'week') === 'week', P = wk ? d.week : d.month, t = d.team;
    var tb = '';
    if (t && t.target) {
      var p = t.sales / t.target, tp = Math.min(1, t.day / t.days), left = Math.max(1, t.days - t.day + 1), rem = Math.max(0, t.target - t.sales);
      tb = '<div class="race-team"><div class="race-team-h"><b>🤝 Mục tiêu chung cả nhóm ' + monthLabel(t.month) + '</b><span>' + Math.round(p * 100) + '%</span></div>' +
        '<div class="race-bar"><i style="width:' + Math.min(100, p * 100).toFixed(1) + '%"></i><u style="left:' + (tp * 100).toFixed(1) + '%"></u></div>' +
        '<p>' + moneyShort(t.sales) + ' / ' + moneyShort(t.target) + (p >= 1 ? ' · 🎉 Cả nhóm đã về đích!' : ' · còn <b>' + moneyShort(rem) + '</b> trong ' + left + ' ngày (≈ ' + moneyShort(Math.ceil(rem / left)) + '/ngày cả nhóm)') + '</p>' +
        '<p class="race-team-tip">Cả nhóm cùng về đích là thắng lớn nhất. Bảng bên dưới để mỗi người nhìn mình tiến bộ.</p></div>';
    }
    // 🤝 Cả nhóm đứng trên cả tiêu đề bảng thi đua: nhìn mục tiêu chung trước, hạng cá nhân sau (17/10/2026)
    return '<section class="race-box">' + tb + '<div class="race-h"><b>🏁 Bảng thi đua</b><div class="race-tabs"><button class="btn sm' + (wk ? ' pri' : '') + '" data-race="week">Tuần này</button><button class="btn sm' + (wk ? '' : ' pri') + '" data-race="month">Tháng này</button></div></div>' +
      '<div class="race-grid">' + P.cats.map(function (c) { return raceCat(c, P, wk); }).join('') + '</div>' +
      '<p class="race-note">' + (wk ? 'Tuần tính từ thứ Hai, mỗi tuần bắt đầu lại từ 0. ' : '') + (P.cats[0] && P.cats[0].pct ? 'Doanh số xếp theo % mục tiêu' + (wk ? ' (mục tiêu tuần = mục tiêu tháng chia theo ngày)' : '') + ', số tiền chỉ bạn và quản lý thấy. ' : '') + 'Mọi người thấy Top 3, hạng của mỗi người chỉ người đó thấy.</p></section>';
  }
  function miniGoal() {
    var mk = monthOf(Date.now()), t = targetOf(S.user.name, mk), sales = perf(S.user.name, monthRange(mk)).sales;
    return t && t.amount ? mini('🎯 Mục tiêu', pct(sales, t.amount) + '%', '#bao-cao', pct(sales, t.amount) >= 100 ? 'good' : '') : mini('🎯 Mục tiêu', 'Chưa đặt', '#bao-cao', 'warn');
  }
  /* ---------- tỉnh / thành từ địa chỉ: nhận cả 63 tỉnh cũ, gộp về 34 tỉnh mới (sau sáp nhập 2025) để báo cáo */
  var PROV_MERGE = { 'Tuyên Quang': ['Hà Giang', 'Tuyên Quang'], 'Lào Cai': ['Yên Bái', 'Lào Cai'], 'Thái Nguyên': ['Bắc Kạn', 'Bắc Cạn', 'Thái Nguyên'], 'Phú Thọ': ['Vĩnh Phúc', 'Hòa Bình', 'Phú Thọ'],
    'Bắc Ninh': ['Bắc Giang', 'Bắc Ninh'], 'Hưng Yên': ['Thái Bình', 'Hưng Yên'], 'Hải Phòng': ['Hải Dương', 'Hải Phòng', 'HP'], 'Ninh Bình': ['Hà Nam', 'Nam Định', 'Ninh Bình'], 'Quảng Trị': ['Quảng Bình', 'Quảng Trị'],
    'Đà Nẵng': ['Quảng Nam', 'Đà Nẵng'], 'Quảng Ngãi': ['Kon Tum', 'Kontum', 'Quảng Ngãi'], 'Gia Lai': ['Bình Định', 'Gia Lai', 'Quy Nhơn', 'Pleiku'], 'Khánh Hòa': ['Ninh Thuận', 'Khánh Hòa', 'Nha Trang', 'Phan Rang'],
    'Lâm Đồng': ['Đắk Nông', 'Đăk Nông', 'Dak Nong', 'Bình Thuận', 'Lâm Đồng', 'Đà Lạt', 'Phan Thiết'], 'Đắk Lắk': ['Phú Yên', 'Đắk Lắk', 'Đăk Lăk', 'Dak Lak', 'Daklak', 'Đaklak', 'Buôn Ma Thuột', 'Buôn Mê Thuột', 'Tuy Hòa'],
    'Hồ Chí Minh': ['Bà Rịa', 'Vũng Tàu', 'Bình Dương', 'Hồ Chí Minh', 'HCM', 'TPHCM', 'TP HCM', 'Sài Gòn', 'Thủ Đức', 'Thủ Dầu Một'], 'Đồng Nai': ['Bình Phước', 'Đồng Nai', 'Biên Hòa'],
    'Tây Ninh': ['Long An', 'Tây Ninh'], 'Cần Thơ': ['Sóc Trăng', 'Hậu Giang', 'Cần Thơ'], 'Vĩnh Long': ['Bến Tre', 'Trà Vinh', 'Vĩnh Long'], 'Đồng Tháp': ['Tiền Giang', 'Đồng Tháp', 'Mỹ Tho'],
    'Cà Mau': ['Bạc Liêu', 'Cà Mau'], 'An Giang': ['Kiên Giang', 'An Giang', 'Rạch Giá', 'Phú Quốc', 'Long Xuyên'],
    'Hà Nội': ['Hà Nội', 'HN'], 'Huế': ['Thừa Thiên Huế', 'Huế'], 'Lai Châu': ['Lai Châu'], 'Điện Biên': ['Điện Biên'], 'Sơn La': ['Sơn La'], 'Lạng Sơn': ['Lạng Sơn'], 'Quảng Ninh': ['Quảng Ninh', 'Hạ Long'],
    'Thanh Hóa': ['Thanh Hóa'], 'Nghệ An': ['Nghệ An'], 'Hà Tĩnh': ['Hà Tĩnh'], 'Cao Bằng': ['Cao Bằng'] };
  var PROV_KEYS = null;
  function provKeys() {
    if (PROV_KEYS) return PROV_KEYS; PROV_KEYS = [];
    Object.keys(PROV_MERGE).forEach(function (nw) { PROV_MERGE[nw].forEach(function (old) { PROV_KEYS.push({ k: ' ' + norm(old) + ' ', old: old, nw: nw }); }); });
    PROV_KEYS.sort(function (a, b) { return b.k.length - a.k.length; }); return PROV_KEYS;
  }
  /** { old: tên như địa chỉ ghi, nw: tỉnh mới } – tỉnh thường ghi ở cuối địa chỉ nên lấy tên xuất hiện sau cùng. */
  function provOf(c) {
    if (c._pv !== undefined) return c._pv;
    var t = ' ' + norm([c.address, c.ward, c.province].filter(Boolean).join(' ')).replace(/[.,;:\-–()/]/g, ' ').replace(/\s+/g, ' ') + ' ', best = null, at = -1;
    provKeys().forEach(function (x) { var i = t.lastIndexOf(x.k); if (i > at) { at = i; best = x; } });
    c._pv = best ? { old: /^(HCM|TPHCM|TP HCM|HN|HP|Kontum|Daklak|Đaklak)$/.test(best.old) ? best.nw : best.old, nw: best.nw } : null; return c._pv;
  }
  /* ---------- lý do khách chưa mua / từ chối: gom ghi chú về nhóm để sale xem và cải tiến cách tư vấn */
  var WHY = [
    ['💸 Chưa có tiền / hết tiền', /het tien|(k|ko|khong|chua) co tien|ket tien|kho khan|chua co luong|chua co lương|tien chua|eo hep/],
    ['📦 Còn hàng, chưa dùng hết', /con nhieu|con hang|chua dung het|con \d|con (1|mot|vai|it)|van con|chua het|dung chua het|con khoang/],
    ['🔄 Dùng sản phẩm khác', /ben khac|(sp|san pham|hang|sua|loai) khac|ensure|dung sang|chuyen sang|mua cho khac|nano|lovifood|dang dung .* khac/],
    ['👨‍👩‍👧 Người nhà quyết định / đã mua', /con (kh |khach )?(mua|da mua)|con gai|con trai|nguoi nha|chong|vo (kh|khach)|hoi y kien|ban bac|de hoi/],
    ['🏥 Sức khoẻ / nằm viện / đi vắng', /nam vien|di vien|nhap vien|dang om|benh|di vang|(k|ko|khong) co nha|ve que|di xa|dang o xa/],
    ['😐 Chưa thấy hợp / chưa hiệu quả', /(k|ko|khong|chua) (thay )?hieu qua|(k|ko|khong) hop|(k|ko|khong) tot|che |ngot|mui|so (bi|nong)|tang can|chua thay/],
    ['💰 Chê giá cao', /gia cao|dat qua|qua dat|mac qua|dat the|gia dat/],
    ['⏰ Bận, hẹn lúc khác', /dang ban|ban viec|goi lai sau|hen (lai|cuoi|thang|tuan|hom)|de sau/],
    ['🚫 Không có nhu cầu / không dùng nữa', /(k|ko|khong) (dung|mua|lay)( gi)? nua|(k|ko|khong) (co )?nhu cau|tu choi|(k|ko|khong) can/]
  ];
  var SHIFT_NOTE = /^(kh )?(toi|cn|le|chu nhat|ngay|khach toi|khach cn)$/;
  function whyOf(text) { var n = norm(text); if (/(^|[^a-z])(knm|tb)([^a-z]|$)|thue bao|khong nghe|k nghe|tat may|tu choi nghe/.test(n)) return null; for (var i = 0; i < WHY.length; i++) if (WHY[i][1].test(n)) return WHY[i][0]; return null; }
  /** Tìm ở tab này mà người đó nằm ở tab kia → gợi ý mở (sale không phải đoán khách đang ở đâu). */
  function crossHint(q, qd, toLeads) {
    if (!q || (q.length < 2 && qd.length < 4)) return '';
    var hit = function (txt, ph) { return norm(txt).indexOf(q) >= 0 || (qd.length >= 4 && String(ph).indexOf(qd) >= 0); };
    if (toLeads) {
      var ls = (S.d.leads || []).filter(function (l) { return hit(l.name, l.phone) && !cust(l.phone); }).slice(0, 5);
      return ls.length ? '<div class="notice info cross">🙋 Có <b>' + ls.length + '</b> người khớp ở tab <b>Khách hỏi</b> (chưa mua): ' + ls.map(function (l) { return '<button type="button" class="link" data-lead="' + esc(l.id) + '">' + esc(l.name || l.phone) + '</button>'; }).join(', ') + '</div>' : '';
    }
    var cs = S.d.customers.filter(function (c) { return hit(c.name, c.phone) && (lvl() >= 2 || c.owner === S.user.name); }).slice(0, 5);
    return cs.length ? '<div class="notice info cross">🛒 Có <b>' + cs.length + '</b> người khớp ở tab <b>Khách đã mua</b>: ' + cs.map(function (c) { return '<button type="button" class="link" data-cust="' + c.phone + '">' + esc(c.name || c.phone) + '</button>'; }).join(', ') + '</div>' : '';
  }
  /** Đang gõ tìm → tạm bỏ các mục lọc (về Tất cả) để không giấu khách tìm thấy; xoá chữ tìm → trả lại mục lọc cũ.
   *  Bấm chọn mục khác trong lúc tìm (searchKeep) thì giữ lựa chọn đó. */
  function searchWide(f, v, dflt) {
    if (v && !f._pre) { f._pre = {}; Object.keys(dflt).forEach(function (k) { f._pre[k] = f[k]; f[k] = dflt[k]; }); }
    else if (!v && f._pre) { Object.keys(f._pre).forEach(function (k) { f[k] = f._pre[k]; }); delete f._pre; }
  }
  function searchKeep(f) { if (f) delete f._pre; }
  /** Cập nhật các ô chọn / nút màu nằm ngoài phần vẽ lại cho khớp bộ lọc sau khi tìm (không vẽ lại cả trang để ô tìm giữ con trỏ). */
  function searchSync() {
    var sv = function (id, v) { var el = $('#' + id); if (el) { el.value = v || ''; el.classList.toggle('on', !!v); } };
    if (S.f.t) sv('tch', S.f.t.ch);
    if (S.f.c) { sv('cspend', S.f.c.spend); sv('csrc', S.f.c.src); sv('cbday', S.f.c.bday); $$('.legend .lg').forEach(function (b) { b.classList.toggle('on', b.getAttribute('data-cat') === S.f.c.cat); }); }
    $$('#tChips,#cChips').forEach(function (box) { var on = $('.chip.on', box); if (on) box.scrollLeft = Math.max(0, on.offsetLeft - box.offsetLeft - 12); }); // điện thoại: cuộn tới mục đang chọn (Tất cả nằm cuối hàng)
  }
  /** Dòng đếm khi đang tìm + ô trống khi không thấy (kèm nút tìm ở mọi tab). */
  function searchCount(n, unit, raw) { return 'Tìm thấy ' + n + ' ' + unit + ' khớp “' + raw + '”'; }
  function searchEmpty(what, raw) { return '<div class="empty">Không tìm thấy ' + what + ' nào khớp “' + esc(raw) + '”. <button type="button" class="btn sm" data-gsopen="' + esc(raw) + '">🔍 Tìm ở mọi tab</button></div>'; }
  function leadsOf(phone) {
    if (!S.d) return [];
    phone = normPhone(phone);
    if (S.d.leadsByPhone) return S.d.leadsByPhone[phone] || [];
    return (S.d.leads || []).filter(function (l) { return normPhone(l.phone) === phone; }).sort(function (a, b) { return (a.time || 0) - (b.time || 0); });
  }
  /** 1 dòng gọn ở tab Khách hàng: giá trị · lần mua gần nhất · việc tiếp theo · lần chăm sóc gần nhất. */
  function custRow(c, withRef) {
    var cat = custCat(c), h = recentHist(c, 1)[0], k = c.task ? c.task.type : '', live = stageOf(c) === 'live';
    return '<div class="rw cr click tinted" data-cust="' + c.phone + '"' + catAttr(cat) + '><div class="rw-m">' +
      '<div class="rw-1"><b>' + esc(c.name || 'Khách') + '</b>' + (c.zalo ? '<span class="zl ic" title="Đã kết bạn Zalo">' + ZI + '</span>' : '') + (inComm(c) ? '<span class="comm-ic" title="Đã vào nhóm Zalo cộng đồng">👥</span>' : '') + custTags(c) + (leadsOf(c.phone).some(isOpenLead) ? '<span class="tag reask" title="Khách vừa để lại số hỏi lại (quảng cáo / web). Xem ở tab Hôm nay hoặc Khách hỏi">🔁 Đang hỏi lại</span>' : '') + (c.owner && lvl() >= 2 ? '<span class="tag owner">👤 ' + esc(c.owner) + '</span>' : !c.owner ? '<span class="tag noconsent">Chưa ai phụ trách</span>' : '') + srcChip(c) + '<span class="end">' + c.orders + ' đơn · ' + moneyShort(c.spent) + '</span></div>' +
      '<div class="rw-2">' + (provOf(c) ? '📍 ' + esc(provOf(c).old) + ' · ' : '') + 'Mua lần đầu ' + fDate(c.first).replace(/\/(\d{2})(\d{2})$/, '/$2') + ' · gần nhất ' + daysAgo(c.last) + (c.products.length ? ' · ' + esc(shortProducts(c.products, 1)) : '') + bdayTag(c) + (live && c.runout && c.runout > (c.last || 0) && k !== 'runout' ? ' · ⏰ hết ~' + fDate(c.runout).slice(0, 5) : '') + (k && TASKS[k] ? ' · <span class="warn-line">' + TASKS[k].icon + ' ' + TASKS[k].title + '</span>' : '') + '</div>' +
      (withRef === true ? refLine(c) : '') +
      '<div class="rw-3">' + (h ? '💬 ' + fDate(h.time).slice(0, 5) + ': ' + esc(h.text.length > 90 ? h.text.slice(0, 90) + '…' : h.text) : '<span class="muted">Chưa có lần chăm sóc nào</span>') + '</div></div>' +
      '<div class="rw-a"><a class="btn" href="tel:' + c.phone + '" aria-label="Gọi">📞<small>Gọi</small></a><button class="btn pri" data-care="' + c.phone + '" data-task="' + (k || 'other') + '" aria-label="Chăm sóc">💬<small>Ghi lại</small></button></div></div>';
  }
  /** 1 dòng gọn cho danh sách việc: tên · việc cần làm · nút gọi / KNM / chăm sóc. */
  function rowCard(c) {
    var cat = custCat(c), k = taskKey(c);
    return '<div class="rw click tinted" data-cust="' + c.phone + '"' + catAttr(cat) + '><div class="rw-m"><div class="rw-1"><b>' + esc(c.name || 'Khách') + '</b>' + (c.zalo ? '<span class="zl ic" title="Đã kết bạn Zalo">' + ZI + '</span>' : '') + (inComm(c) ? '<span class="comm-ic" title="Đã vào nhóm Zalo cộng đồng">👥</span>' : '') + custTags(c) + (vipLate(c) ? '<span class="tag st-huy" title="Khách VIP đã quá hạn chăm sóc ' + c.task.late + ' ngày – ưu tiên gọi trước">⚠️ VIP trễ hạn</span>' : '') + bdayChip(c) + srcChip(c) + '<span class="end">' + (c.spent ? moneyShort(c.spent) : '<span class="muted" title="Đơn chưa ghi số tiền – mở hồ sơ kiểm tra lại đơn">chưa có tiền đơn</span>') + '</span></div>' +
      '<div class="rw-2">' + (vipLate(c) ? '<b>' + TASKS[k].icon + ' ' + TASKS[k].title + '</b> · ' : '') + (c.task ? taskLine(c) : replyOf(c).days + ' ngày chưa phản hồi') + (c.products.length ? ' · ' + esc(shortProducts(c.products, 1)) : '') + sugLine(c) + '</div>' + lastTouch(c) + '</div>' +
      '<div class="rw-a"><a class="btn" href="tel:' + c.phone + '" aria-label="Gọi">📞<small>Gọi</small></a><button class="btn" data-quick="' + c.phone + '|knm|' + k + '" title="Không nghe máy: 2 ngày sau tự nhắc" aria-label="KNM">📵<small>Không nghe</small></button><button class="btn pri" data-care="' + c.phone + '" data-task="' + k + '" aria-label="Chăm sóc">💬<small>Ghi lại</small></button></div></div>';
  }
  /** Mốc 30 ngày / mời quay lại / khách cũ: gợi ý sản phẩm khách khác hay mua kèm. */
  function sugLine(c) { var k = taskKey(c); if (k !== 'd30' && k !== 'winback' && k !== 'old' && k !== 'runout') return ''; var sg = suggestFor(c); return sg ? ' · <span class="sug" title="Khách mua sản phẩm giống khách này hay mua thêm sản phẩm này">💡 gợi ý: ' + esc(sg) + '</span>' : ''; }
  /** Lần liên hệ gần nhất (CRM + ghi chú cũ) để sale biết bối cảnh trước khi gọi. */
  function lastTouch(c) {
    var h = recentHist(c, 1)[0], r = replyOf(c);
    if (!h) return '<div class="rw-3 muted">🆕 Chưa liên hệ lần nào</div>';
    var t = String(h.text || '').replace(/^:\s*/, '').trim(), d = daysAgo(h.time);
    return '<div class="rw-3" title="' + esc(t) + '">🕘 ' + (d ? d.charAt(0).toUpperCase() + d.slice(1) : '') + ': ' + esc(t.length > 80 ? t.slice(0, 80) + '…' : t) + (r.missed > 1 ? ' <span class="bad-line">· 📵 ' + r.missed + ' lần KNM liền</span>' : '') + '</div>';
  }
  /* ---------- gọi lần lượt: mỗi lần 1 khách, ghi kết quả xong tự sang khách tiếp theo */
  function startFlow() { S.flow = { skip: {} }; nextFlow(); }
  function nextFlow() {
    if (!S.flow) return;
    var q = dayQueue(), list = q.list.filter(function (c) { return !S.flow.skip[c.phone]; });
    if (!list.length) { var sk = Object.keys(S.flow.skip).length; S.flow = null; render(); toast(sk ? 'Hết lượt. Còn ' + sk + ' khách bạn để sau, mở lại “Bắt đầu gọi” để gọi tiếp.' : 'Xong hết danh sách hôm nay 🎉 Cảm ơn bạn!'); return; }
    openCare(list[0].phone, taskKey(list[0]), { flow: true, n: q.done + 1, total: q.done + q.list.length });
  }
  function myGoalKpi() {
    var mk = monthOf(Date.now()), t = targetOf(S.user.name, mk), sales = perf(S.user.name, monthRange(mk)).sales;
    if (!t || !t.amount) return kpi('Mục tiêu tháng của tôi', 'Chưa đặt', 'warn', '#bao-cao', 'bấm để đặt mục tiêu');
    var p = pct(sales, t.amount); return kpi('Mục tiêu tháng của tôi', p + '%', p >= 100 ? 'good' : '', '#bao-cao', moneyShort(sales) + ' / ' + moneyShort(t.amount));
  }
  function kpi(label, val, cls, href, sub, spark) {
    return '<' + (href ? 'a href="' + href + '"' : 'div') + ' class="kpi ' + (cls || '') + '"><span>' + label + '</span>' + (spark ? '<div class="mv"><b>' + val + '</b>' + spark + '</div>' : '<b>' + val + '</b>') + (sub ? '<small>' + sub + '</small>' : '') + '</' + (href ? 'a' : 'div') + '>';
  }
  function logItem(l) {
    return '<div class="it"><b>' + esc(l.what) + '</b>' + (l.name ? ' – ' + esc(l.name) : '') + (l.result ? ': ' + esc(l.result) : '') + (l.note ? '<br>' + esc(l.note) : '') + '<small>' + fDateTime(l.time) + ' · ' + esc(l.by) + '</small></div>';
  }
  function monthStats() {
    var now = vnDate(Date.now()), ym = now.y * 12 + now.m, rev = 0, prev = 0, cnt = 0;
    S.d.orders.forEach(function (o) {
      if (isVoid(o.status) || !o.time) return; var x = vnDate(o.time), k = x.y * 12 + x.m; // bỏ đơn huỷ/hoàn – cùng cách tính với tab Hiệu quả
      if (k === ym) { rev += o.total; cnt++; } else if (k === ym - 1) prev += o.total;
    });
    var nc = 0, ret = 0;
    S.d.customers.forEach(function (c) {
      if (c.first) { var f = vnDate(c.first); if (f.y * 12 + f.m === ym) nc++; }
      if (c.orders > 1 && c.last) { var l = vnDate(c.last); if (l.y * 12 + l.m === ym) ret++; }
    });
    return { month: now.m, revenue: rev, orders: cnt, prev: prev, newCus: nc, returning: ret };
  }

  /* ================================================================ KHÁCH HÀNG */
  var CF = [
    { k: 'all', l: 'Tất cả', f: function () { return true; } },
    { k: 'task', l: 'Cần chăm sóc', f: function (c) { return !!c.task && !coldOf(c); } },
    { k: 'vip', l: 'VIP', f: function (c) { return isVip(c) && !coldOf(c); } },
    { k: 'risk', l: 'Sắp mất', f: function (c) { return stageOf(c) === 'risk' && !coldOf(c); } },
    { k: 'lost', l: 'Lâu không mua', f: function (c) { return stageOf(c) === 'lost' && !coldOf(c); } },
    { k: 'runout7', l: '⏰ Sắp hết hàng', f: function (c) { return !coldOf(c) && !!c.runout && c.runout > (c.last || 0) && c.runout >= today() - 7 * DAY && c.runout < today() + 8 * DAY; } },
    { k: 'callback', l: 'Có hẹn gọi lại', f: function (c) { return !!c.callback && !coldOf(c); } },
    { k: 'ref', l: '🎁 Đã giới thiệu khách', f: function (c) { return !!refStats().by[c.phone]; } },
    { k: 'zalo', l: ZI + ' Đã kết bạn Zalo', f: function (c) { return !!c.zalo && !coldOf(c); } },
    { k: 'nocomm', l: '👥 Chưa vào cộng đồng', f: function (c) { return !inComm(c) && !coldOf(c); } },
    { k: 'nozalo', l: 'Chưa kết bạn Zalo', f: function (c) { return !c.zalo && !coldOf(c); } },
    { k: 'cold', l: '❄️ Khách lạnh', f: function (c) { return !!coldOf(c); } }
  ];
  var SORTS = { prio: ['Nên gọi trước', function (a, b) { var pa = a.task ? prioOf(a) : isVip(a) && stageOf(a) === 'risk' ? 8 : 9, pb = b.task ? prioOf(b) : isVip(b) && stageOf(b) === 'risk' ? 8 : 9; return (coldOf(a) ? 1 : 0) - (coldOf(b) ? 1 : 0) || pa - pb || b.spent - a.spent; }],
    last: ['Mua gần nhất', function (a, b) { return (b.last || 0) - (a.last || 0); }], age: ['Lâu chưa chăm sóc nhất', function (a, b) { return (replyOf(a).at || 0) - (replyOf(b).at || 0) || (a.first || 0) - (b.first || 0); }], spent: ['Chi nhiều nhất', function (a, b) { return b.spent - a.spent; }],
    runout: ['Sắp hết hàng', function (a, b) { return (a.runout || 9e15) - (b.runout || 9e15); }], name: ['Tên A–Z', function (a, b) { return a.name.localeCompare(b.name, 'vi'); }] };
  /** Tách chữ tìm kiếm; tên tỉnh giữ nguyên cụm (“nam dinh” không khớp tên “Nam” + “dinh dưỡng”). */
  function qWords(q) {
    var t = ' ' + q + ' ', w = [];
    provKeys().forEach(function (x) { if (t.indexOf(x.k) >= 0) { w.push(x.k); t = t.split(x.k).join(' '); } });
    return w.concat(t.split(/\s+/).filter(String));
  }
  /** Tìm nhiều chữ cùng lúc, vd “nghe an dilvang”: mỗi chữ phải có trong tên / SĐT / sản phẩm / tỉnh (cả tên tỉnh mới) / địa chỉ / người phụ trách. */
  function custHit(c, words) {
    if (c._q === undefined) { var pv = provOf(c); c._q = ' ' + norm([c.name, c.products.join(' '), c.owner, c.address, c.ward, c.province, pv ? pv.old + ' ' + pv.nw : ''].join(' ')).replace(/[.,;:\-–()/]/g, ' ').replace(/\s+/g, ' ') + ' '; }
    return words.every(function (w) { return c._q.indexOf(w) >= 0; });
  }
  /** Số liệu cả công ty (máy chủ gửi kèm, chỉ con số) – máy chủ cũ chưa có thì tự đếm trên khách đang thấy. */
  function areaData() {
    if (S.d.areas) return S.d.areas;
    if (S._areas && S._areas.src === S.d.customers) return S._areas.v;
    var p = {}, s = {}, d30 = Date.now() - 30 * DAY;
    S.d.customers.forEach(function (c) {
      if (!c.orders) return; var rep = c.orders >= 2 ? 1 : 0, seen = {};
      c.products.forEach(function (x) { var n = x.replace(/\s*\(.*\)\s*$/, '').trim(); if (n) seen[n] = 1; });
      Object.keys(seen).forEach(function (n) { var r = s[n] || (s[n] = [0, 0]); r[0]++; r[1] += rep; });
      var pv = provOf(c); if (!pv) return; var a = p[pv.old] || (p[pv.old] = [pv.nw, 0, 0, 0, {}]);
      a[1]++; a[2] += rep; if (c.last && c.last >= d30) a[3]++; Object.keys(seen).forEach(function (n) { a[4][n] = (a[4][n] || 0) + 1; });
    });
    S._areas = { src: S.d.customers, v: { p: p, s: s, local: true } }; return S._areas.v;
  }
  function roundDown(n) { var r = n >= 100 ? Math.floor(n / 50) * 50 : n >= 10 ? Math.floor(n / 10) * 10 : n; return r < n ? 'hơn ' + r : String(n); } // 76 → “hơn 70”: nói tròn cho tự nhiên, không nói quá
  /** Gõ tên tỉnh (hoặc sản phẩm) vào ô tìm → khung “bên mình đã có bao nhiêu khách ở đó” để sale có chuyện nói với khách mới. */
  function areaBox(q, mode) {
    if (!q || q.length < 2) return '';
    var A = areaData(), t = ' ' + q.replace(/\s+/g, ' ') + ' ', key = null;
    provKeys().some(function (x) { if (t.indexOf(x.k) >= 0) { key = x; return true; } });
    var who = A.local && lvl() < 2 ? 'khách của bạn' : 'khách của công ty', h = '';
    if (key) {
      var old = /^(HCM|TPHCM|TP HCM|HN|HP|Kontum|Daklak|Đaklak)$/.test(key.old) || norm(key.old) === norm(key.nw) ? key.nw : key.old, nw = key.nw;
      var olds = Object.keys(A.p).filter(function (k) { return A.p[k][0] === nw; }), one = A.p[old] || null;
      if (old === nw) { one = [nw, 0, 0, 0, {}]; olds.forEach(function (k) { var a = A.p[k]; one[1] += a[1]; one[2] += a[2]; one[3] += a[3]; Object.keys(a[4]).forEach(function (n) { one[4][n] = (one[4][n] || 0) + a[4][n]; }); }); }
      if (!one || !one[1]) return '<div class="notice area">📍 Chưa có ' + who + ' nào ở <b>' + esc(old) + '</b> đã mua. Khách này có thể là người đầu tiên ở đó – cứ tự tin giới thiệu nhé!</div>';
      var merged = old !== nw ? olds.reduce(function (n, k) { return n + A.p[k][1]; }, 0) : 0;
      var top = Object.keys(one[4]).sort(function (x, y) { return one[4][y] - one[4][x]; }).slice(0, 3);
      h = '<b>📍 ' + esc(old) + (old !== nw ? ' <span class="muted">(nay thuộc ' + esc(nw) + ')</span>' : '') + '</b>: <b>' + one[1] + '</b> ' + who + ' đã mua' +
        (one[2] ? ' · <b>' + one[2] + '</b> người mua từ 2 lần' : '') + (one[3] ? ' · <b>' + one[3] + '</b> người mua trong 30 ngày qua' : '') +
        (merged > one[1] ? ' · cả ' + esc(nw) + ' mới: ' + merged + ' khách' : '') +
        (top.length ? '<div class="small">Hay mua: ' + top.map(function (n) { return esc(n) + ' (' + one[4][n] + ')'; }).join(' · ') + '</div>' : '') +
        '<div class="say">💡 Có thể nói: “Ở ' + esc(old) + ' bên em đã có ' + roundDown(one[1]) + ' cô chú anh chị dùng rồi' + (one[2] >= 2 ? ', nhiều người dùng thấy hợp nên mua lại' : '') + (top[0] ? ', nhất là ' + esc(top[0]) : '') + '.”</div>';
    } else {
      var ps = Object.keys(A.s).filter(function (n) { return norm(n).indexOf(q) >= 0; }).sort(function (x, y) { return A.s[y][0] - A.s[x][0]; });
      if (!ps.length || q.length < 3) return '';
      var n0 = ps[0], r = A.s[n0];
      h = '<b>🛒 ' + esc(n0) + '</b>: <b>' + r[0] + '</b> ' + who + ' đã mua' + (r[1] ? ' · <b>' + r[1] + '</b> người (' + Math.round(r[1] * 100 / r[0]) + '%) mua từ 2 lần trở lên' : '') +
        (ps.length > 1 ? '<div class="small muted">Cũng khớp: ' + ps.slice(1, 3).map(function (n) { return esc(n) + ' (' + A.s[n][0] + ')'; }).join(' · ') + '</div>' : '') +
        '<div class="say">💡 Có thể nói: “Sản phẩm này bên em đã có ' + roundDown(r[0]) + ' khách dùng' + (r[1] >= 2 ? ', nhiều người mua lại đều đặn' : '') + '.”</div>';
    }
    return '<div class="notice area">' + h + '<div class="small muted">Chỉ nói con số, không nói tên hay số điện thoại khách khác.' + (mode ? '' : ' Danh sách bên dưới là ' + (lvl() >= 2 ? 'khách khớp tìm kiếm' : 'khách của bạn') + ' – có thể nhắc khách quen (đã đồng ý) làm ví dụ.') + '</div></div>';
  }
  /** Ngày sinh "dd/mm" hoặc "dd/mm/yyyy" → { d, m, y }. Máy chủ Apps Script bản cũ không gửi c.dob. */
  function dobOf(c) { var m = String(c.dob || '').match(/^(\d{1,2})\/(\d{1,2})(?:\/(\d{4}))?$/); return m ? { d: +m[1], m: +m[2], y: m[3] ? +m[3] : 0 } : null; }
  function dobNorm(v) { var m = String(v || '').trim().match(/^(\d{1,2})[\/.\-](\d{1,2})(?:[\/.\-](\d{4}))?$/); if (!m || +m[1] < 1 || +m[1] > 31 || +m[2] < 1 || +m[2] > 12) return null; return pad(+m[1]) + '/' + pad(+m[2]) + (m[3] ? '/' + m[3] : ''); }
  function dobReady() { return !S.d.customers.length || S.d.customers.some(function (c) { return c.dob !== undefined; }); }
  /** Bộ lọc sinh nhật: this = tháng này, next = tháng sau, 1–12 = tháng đó, none = chưa có ngày sinh. */
  function bdayMonth(k) { var m = vnDate(Date.now()).m; return k === 'this' ? m : k === 'next' ? m % 12 + 1 : +k; }
  function bdayHit(c, k) { var b = dobOf(c); return k === 'none' ? !b : !!b && b.m === bdayMonth(k); }
  function bdayLabel(k) { return k === 'none' ? 'chưa có ngày sinh' : 'sinh nhật tháng ' + bdayMonth(k); }
  function bdaySoon(c) { // số ngày tới sinh nhật (0 = hôm nay), null nếu xa hơn 7 ngày
    var b = dobOf(c); if (!b) return null; var n = vnDate(Date.now());
    for (var i = 0; i <= 7; i++) { var x = vnDate(Date.UTC(n.y, n.m - 1, n.d + i, 5) - 7 * 3600e3); if (x.d === b.d && x.m === b.m) return i; }
    return null;
  }
  function bdayChip(c) { var i = bdaySoon(c); return i === null ? '' : '<span class="tag bday" title="Sinh nhật ' + pad(dobOf(c).d) + '/' + pad(dobOf(c).m) + ': nhắn chúc mừng, có thể tặng ưu đãi">🎂 ' + (i === 0 ? 'Sinh nhật hôm nay' : i === 1 ? 'SN ngày mai' : 'SN ' + pad(dobOf(c).d) + '/' + pad(dobOf(c).m)) + '</span>'; }
  function bdayTag(c) { var b = dobOf(c), n = vnDate(Date.now()); if (!b || b.m !== n.m) return ''; return b.d === n.d ? ' · <span class="warn-line">🎂 Sinh nhật hôm nay</span>' : ' · 🎂 SN ' + pad(b.d) + '/' + pad(b.m); }
  var SPEND = { lo: ['Dưới 500k', 0, 5e5], mid: ['500k – 2 triệu', 5e5, 2e6], hi: ['Trên 2 triệu', 2e6, 9e15] };
  /** Nguồn khách mua lần đầu (Facebook, Ladi, Zalo…), nhiều khách xếp trước. */
  function custSources() {
    var n = {}; S.d.customers.forEach(function (c) { if (lvl() >= 2 || c.owner === S.user.name) { var k = custSrc(c) || 'Chưa rõ'; n[k] = (n[k] || 0) + 1; } });
    return Object.keys(n).sort(function (a, b) { return n[b] - n[a]; });
  }
  function renderCustomerChips(base, cur) {
    return CF.map(function (x) {
      var n = base.filter(x.f).length, tp = { nocomm: 'Khách chưa vào nhóm Zalo “Sống khỏe cùng Thực Dưỡng Lành”: dùng 📣 Gửi ưu đãi lần lượt để mời hàng loạt', runout7: 'Dự kiến dùng hết trong 7 ngày tới (hoặc vừa hết trong 7 ngày qua): gọi mời mua lại ngay', vip: TIP.vip(), risk: TIP.risk, lost: TIP.lost, cold: TIP.cold, nozalo: TIP.nozalo, task: TIP.task, callback: TIP.callback, all: TIP.all }[x.k];
      return '<button class="chip' + (x.k === cur.k ? ' on' : '') + '" data-cf="' + x.k + '"' + (tp ? ' title="' + esc(tp) + '"' : '') + '>' + x.l + ' <em>' + n + '</em></button>';
    }).join('');
  }
  function custRowF(c) { return custRow(c, !!(S.f.c && S.f.c.k === 'ref')); }
  function renderCustomerList(list, n) {
    var rs = S.f.c && S.f.c.k === 'ref' ? refStats().sum : null;
    var sq = S.f.c && S.f.c.q && S.f.c.q.trim();
    if (!list.length) return rs ? empty('Chưa có khách nào giới thiệu. Khi thêm khách hỏi, chọn “Khách giới thiệu” rồi chọn người giới thiệu.') : sq ? searchEmpty('khách đã mua', sq) : empty('Không có khách nào khớp.');
    return (rs ? '<div class="notice info">🎁 <b>' + list.length + ' khách</b> đã giới thiệu ' + list.reduce(function (s0, c) { return s0 + refStats().by[c.phone].n; }, 0) + ' người, mang về <b>' + moneyShort(list.reduce(function (s0, c) { return s0 + refStats().by[c.phone].rev; }, 0)) + '</b>. Xếp theo doanh thu mang về. Mở hồ sơ để xem từng người và tặng quà cảm ơn.</div>' : '') +
      '<div class="crows">' + list.slice(0, n).map(custRowF).join('') + '</div>' +
      (list.length > n ? '<button class="btn more" data-more="c">Xem thêm ' + Math.min(60, list.length - n) + ' khách</button>' : '');
  }
  function renderCustomersPart(appendOnly) {
    var cList = $('#cList');
    if (!cList) { render(); return; }
    var f = S.f.c || (S.f.c = { q: '', k: 'all', sort: 'prio', n: 60 });
    var q = norm(f.q), qd = q.replace(/\D/g, ''), words = qWords(q);
    var base = S.d.customers.filter(function (c) { return whoOk(c.owner) && (!q || custHit(c, words) || (qd.length >= 3 && (c._phoneDigits || c.phone).indexOf(qd) >= 0)); });
    if (f.cat) base = base.filter(function (c) { return custCat(c).key === f.cat; });
    var srcs = custSources(); if (f.src && srcs.indexOf(f.src) < 0) f.src = '';
    if (f.spend) base = base.filter(function (c) { var r = SPEND[f.spend]; return c.spent >= r[1] && c.spent < r[2]; });
    if (f.src) base = base.filter(function (c) { return (custSrc(c) || 'Chưa rõ') === f.src; });
    if (f.bday) base = base.filter(function (c) { return bdayHit(c, f.bday); });
    var chips = CF;
    var cur = chips.filter(function (x) { return x.k === f.k; })[0] || chips[0];
    var list = base.filter(cur.f).sort(SORTS[f.sort][1]);
    if (f.bday && f.bday !== 'none') list.sort(function (a, b) { return dobOf(a).d - dobOf(b).d; }); // lọc sinh nhật: xếp theo ngày trong tháng
    if (cur.k === 'ref') list.sort(function (a, b) { var x = refStats().by[a.phone], y = refStats().by[b.phone]; return y.rev - x.rev || y.n - x.n; }); // 🎁 mang về nhiều doanh thu nhất lên đầu
    if (q) list = list.filter(function (c) { return (c._normName || norm(c.name)).indexOf(q) >= 0; }).concat(list.filter(function (c) { return (c._normName || norm(c.name)).indexOf(q) < 0; }));
    S.promoPick = { list: list, label: cur.l + (lvl() >= 2 && S.who ? ' · ' + (S.who === '-' ? 'chưa ai phụ trách' : 'của ' + S.who) : '') + (f.spend ? ' · chi ' + SPEND[f.spend][0].toLowerCase() : '') + (f.src ? ' · nguồn ' + f.src : '') + (f.bday ? ' · ' + bdayLabel(f.bday) : '') + (f.q ? ' · tìm “' + f.q + '”' : '') };

    if (appendOnly) {
      var crows = $('.crows', cList);
      var prevN = f.n - 60;
      var nextSlice = list.slice(prevN, f.n);
      if (crows && nextSlice.length) crows.insertAdjacentHTML('beforeend', nextSlice.map(custRowF).join(''));
      var btnMore = $('[data-more=c]', cList);
      if (btnMore) {
        if (list.length > f.n) btnMore.textContent = 'Xem thêm ' + Math.min(60, list.length - f.n) + ' khách';
        else btnMore.remove();
      }
      return;
    }

    var cCount = $('#cCount'); if (cCount) cCount.textContent = f.q.trim() ? searchCount(base.length, 'khách', f.q.trim()) : base.length + ' khách';
    var cChips = $('#cChips'); if (cChips) cChips.innerHTML = renderCustomerChips(base, cur);
    var cArea = $('#cArea'); if (cArea) cArea.innerHTML = areaBox(q) + crossHint(q, qd, true);
    cList.innerHTML = renderCustomerList(list, f.n);
  }
  document.addEventListener('toggle', function (e) { var t = e.target; if (t && t.classList && t.classList.contains('cfmore') && S.f && S.f.c) S.f.c.more = t.open; }, true);
  function viewCustomers() {
    var f = S.f.c || (S.f.c = { q: '', k: 'all', sort: 'prio', n: 60 });
    var q = norm(f.q), qd = q.replace(/\D/g, ''), words = qWords(q);
    var base = S.d.customers.filter(function (c) { return whoOk(c.owner) && (!q || custHit(c, words) || (qd.length >= 3 && (c._phoneDigits || c.phone).indexOf(qd) >= 0)); }); // sale: chỉ khách của mình (khách chưa ai nhận ở mục Kho chung tab Hôm nay)
    if (f.cat) base = base.filter(function (c) { return custCat(c).key === f.cat; });
    var srcs = custSources(); if (f.src && srcs.indexOf(f.src) < 0) f.src = '';
    if (f.spend) base = base.filter(function (c) { var r = SPEND[f.spend]; return c.spent >= r[1] && c.spent < r[2]; });
    if (f.src) base = base.filter(function (c) { return (custSrc(c) || 'Chưa rõ') === f.src; });
    if (f.bday) base = base.filter(function (c) { return bdayHit(c, f.bday); });
    var chips = CF;
    var cur = chips.filter(function (x) { return x.k === f.k; })[0] || chips[0];
    var list = base.filter(cur.f).sort(SORTS[f.sort][1]);
    if (f.bday && f.bday !== 'none') list.sort(function (a, b) { return dobOf(a).d - dobOf(b).d; }); // lọc sinh nhật: xếp theo ngày trong tháng
    if (cur.k === 'ref') list.sort(function (a, b) { var x = refStats().by[a.phone], y = refStats().by[b.phone]; return y.rev - x.rev || y.n - x.n; }); // 🎁 mang về nhiều doanh thu nhất lên đầu
    if (q) list = list.filter(function (c) { return (c._normName || norm(c.name)).indexOf(q) >= 0; }).concat(list.filter(function (c) { return (c._normName || norm(c.name)).indexOf(q) < 0; })); // trùng tên lên đầu, rồi mới đến trùng tỉnh / địa chỉ / sản phẩm
    S.promoPick = { list: list, label: cur.l + (lvl() >= 2 && S.who ? ' · ' + (S.who === '-' ? 'chưa ai phụ trách' : 'của ' + S.who) : '') + (f.spend ? ' · chi ' + SPEND[f.spend][0].toLowerCase() : '') + (f.src ? ' · nguồn ' + f.src : '') + (f.bday ? ' · ' + bdayLabel(f.bday) : '') + (f.q ? ' · tìm “' + f.q + '”' : '') };
    return '<div class="page-head"><h1>Khách đã mua</h1><span class="muted" id="cCount">' + esc(f.q.trim() ? searchCount(base.length, 'khách', f.q.trim()) : base.length + ' khách') + '</span><div class="grow"></div>' + whoSel() + '<button class="btn pri" data-promo title="Gửi tin ưu đãi qua Zalo cho từng khách trong danh sách đang lọc">📣 Gửi ưu đãi lần lượt</button></div>' +
      '<div class="tools"><div class="search">' + I.search + '<input type="search" id="cq" placeholder="Tìm tên, SĐT, tỉnh, sản phẩm…" value="' + esc(f.q) + '"><button type="button" class="search-x" aria-label="Xoá chữ tìm kiếm" title="Xoá">✕</button></div>' +
      '<select id="csort" style="flex:0 0 auto;width:auto">' + Object.keys(SORTS).map(function (k) { return '<option value="' + k + '"' + (f.sort === k ? ' selected' : '') + '>' + SORTS[k][0] + '</option>'; }).join('') + '</select></div>' +
      (f.bday && !dobReady() ? '<div class="notice">🎂 Máy chủ chưa có cột Ngày sinh. Báo quản lý dán code Apps Script bản mới và Triển khai phiên bản mới.</div>' : '') +
      '<div class="chips" id="cChips">' + renderCustomerChips(base, cur) + '</div>' +
      legend(S.d.customers.filter(function (c) { return whoOk(c.owner); }), f.cat) +
      '<details class="cfmore"' + (f.spend || f.src || f.bday || f.more ? ' open' : '') + '><summary>🔎 Lọc thêm: mức chi, nguồn khách, sinh nhật' + (f.spend || f.src || f.bday ? ' <b class="cf-on">· đang lọc</b>' : '') + '</summary>' +
      '<div class="tools filt"><select id="cspend" class="' + (f.spend ? 'on' : '') + '" title="Lọc theo tổng tiền khách đã chi"><option value="">💰 Mọi mức chi</option>' + Object.keys(SPEND).map(function (k) { return '<option value="' + k + '"' + (f.spend === k ? ' selected' : '') + '>Đã chi ' + SPEND[k][0].toLowerCase() + '</option>'; }).join('') + '</select>' +
        '<select id="csrc" class="' + (f.src ? 'on' : '') + '" title="Lọc theo nguồn khách mua lần đầu"><option value="">🧭 Mọi nguồn</option>' + srcs.map(function (x) { return '<option' + (f.src === x ? ' selected' : '') + '>' + esc(x) + '</option>'; }).join('') + '</select>' +
        '<select id="cbday" class="' + (f.bday ? 'on' : '') + '" title="Lọc khách theo tháng sinh nhật (ngày sinh nhập ở hồ sơ khách → Sửa thông tin)"><option value="">🎂 Sinh nhật</option>' +
          [['this', 'Sinh nhật tháng này (T' + bdayMonth('this') + ')'], ['next', 'Sinh nhật tháng sau (T' + bdayMonth('next') + ')']].concat([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12].map(function (m) { return [String(m), 'Sinh nhật tháng ' + m]; })).concat([['none', 'Chưa có ngày sinh']]).map(function (o) { return '<option value="' + o[0] + '"' + (f.bday === o[0] ? ' selected' : '') + '>' + o[1] + '</option>'; }).join('') + '</select>' +
        (f.spend || f.src || f.bday ? '<button type="button" class="link small" data-cfclear>Bỏ lọc</button>' : '') + '</div>' + '</details>' +
      '<div id="cArea">' + (areaBox(q) + crossHint(q, qd, true)) + '</div>' +
      '<div id="cList">' + renderCustomerList(list, f.n) + '</div>';
  }

  /* ---------- hồ sơ khách: giá trị khách → việc hôm nay → lịch sử (đơn + chăm sóc gộp) / đơn hàng / thông tin; ghi nhanh luôn ở đáy */
  function itemNames(items) { return String(items || '').split('\n').filter(function (l) { return l && !/^🎁/.test(l); }).map(function (l) { return l.replace(/\s*=\s*[\d.,]+\s*₫?$/, '').trim(); }); }
  function custStats(c, list) {
    var ok = (list || []).filter(function (o) { return !isVoid(o.status) && o.time; }).sort(function (a, b) { return a.time - b.time; });
    var gaps = []; for (var i = 1; i < ok.length; i++) { var g = Math.round((ok[i].time - ok[i - 1].time) / DAY); if (g >= 3) gaps.push(g); }
    gaps.sort(function (a, b) { return a - b; });
    var cnt = {}; ok.forEach(function (o) { itemNames(o.items).forEach(function (n) { var k = n.replace(/\s*x\d+$/, ''); cnt[k] = (cnt[k] || 0) + 1; }); });
    var top = Object.keys(cnt).sort(function (a, b) { return cnt[b] - cnt[a]; })[0] || (c.products[0] || '');
    return { gap: gaps.length ? gaps[Math.floor(gaps.length / 2)] : 0, top: top, topN: cnt[top] || 0 };
  }
  function altPhones(note) { var out = []; String(note || '').split('\n').forEach(function (l) { if (/^\s*SĐT khác:/.test(l)) out = out.concat(l.match(/0\d{9,10}/g) || []); }); return out; }
  function noteExtras(note) { return String(note || '').split('\n').filter(function (l) { return /^(Dùng cho|SĐT khác|Người giới thiệu|Sức khoẻ):/.test(l.trim()); }); }
  var EXTRA_IC = { 'Dùng cho': '🎯', 'Sức khoẻ': '🩺', 'Người giới thiệu': '🤝', 'SĐT khác': '📱' };
  function useForOf(note) { var l = noteExtras(note).filter(function (x) { return /^Dùng cho:/.test(x.trim()); })[0]; return l ? l.replace(/^\s*Dùng cho:\s*/, '') : ''; }
  /** Khách hay nghe máy buổi nào: đếm giờ các lần chăm sóc khách có trả lời (cần ≥ 2 lần, 1 buổi chiếm ≥ 60%). */
  function callHours(c) {
    var B = ['sáng (trước 11h)', 'trưa (11h–14h)', 'chiều (14h–17h)', 'tối (sau 17h)'], ok = [0, 0, 0, 0], n = 0;
    logOf(c.phone).filter(isCareLog).forEach(function (l) {
      if (!l.time || !l.result || l.result === NO_REPLY) return;
      var h = new Date(l.time + 7 * 3600e3).getUTCHours(); ok[h < 11 ? 0 : h < 14 ? 1 : h < 17 ? 2 : 3]++; n++;
    });
    if (n < 2) return '';
    var b = ok.indexOf(Math.max.apply(null, ok)); return ok[b] / n >= 0.6 ? B[b] : '';
  }
  /** Chi tiết 1 đơn, mở ngay trong hồ sơ khách (đơn cũ không có trong danh sách tải sẵn vẫn xem được). */
  function custOrderDetail(o, c) {
    var oa = fullAddr(o), ca = fullAddr(c), lg = logOf(o.id).slice(0, 4);
    return '<div class="or-d">' +
      '<div class="pre">' + esc(String(o.items || '').trim() || '–') + '</div>' +
      '<div class="or-sum"><span>Tạm tính <b>' + money(o.subtotal) + '</b></span><span>Ship <b>' + (o.shipping ? money(o.shipping) : 'miễn phí') + '</b></span><span>Tổng <b>' + money(o.total) + '</b></span></div>' +
      '<div>💳 ' + esc(o.payment || '–') + ' ' + paidTag(o) + '</div>' +
      (oa ? '<div>📍 ' + esc(oa) + (ca && norm(oa) !== norm(ca) ? ' <span class="warn-line">(khác địa chỉ hiện tại)</span>' : '') + '</div>' : '') +
      (o.tracking || carrierOf(o) ? '<div>' + (o.tracking ? trackLink(o) : '🚚 ' + esc(carrierOf(o))) + (o.trk ? ' · <span class="muted">' + esc(o.trk) + '</span>' : '') + '</div>' : '') +
      '<div class="muted">' + fDateTime(o.time) + ' · ' + esc(otLabel(otypeOf(o))) + (o.source ? ' · ' + esc(o.source) : '') + (o.seller ? ' · 👤 ' + esc(o.seller) : '') + '</div>' +
      (o.note ? '<div class="or-note">📝 ' + esc(o.note) + '</div>' : '') +
      (lg.length ? '<div class="or-log">' + lg.map(function (l) { return '<div>' + fDate(l.time).slice(0, 5) + ' · ' + esc(l.result || l.what) + (l.note ? ': ' + esc(l.note) : '') + (l.by ? ' <span class="muted">(' + esc(l.by) + ')</span>' : '') + '</div>'; }).join('') + '</div>' : '') +
      '<div class="steps">' + (parseItems(o.items).some(function (i) { return !i.gift; }) ? '<button type="button" class="btn pri" data-orrep="' + esc(o.id) + '">🔁 Đặt lại đơn này</button>' : '') +
      '<button type="button" class="btn" data-orcopy="' + esc(o.id) + '">📋 Copy</button>' + (findOrder(o.id) ? '<button type="button" class="btn" data-orfull="' + esc(o.id) + '">✏️ Mở đơn để sửa</button>' : '') + '</div></div>';
  }
  function timelineHtml(c, orders, max) {
    var items = (orders || []).map(function (o) { return { time: o.time, k: 'o', html: '<div class="tl o click' + (isVoid(o.status) ? ' void' : '') + '" data-poid="' + esc(o.id) + '" title="Bấm để xem chi tiết đơn"><i>🛒</i><div><b>Đơn ' + money(o.total) + '</b> ' + stTag(o.status) + '<div class="tl-s">' + esc(itemNames(o.items).join(', ')) + '</div></div><small>' + fDate(o.time) + '</small></div>' }; })
      .concat(leadsOf(c.phone).map(function (ld) { return { time: ld.time, html: '<div class="tl lead"><i>🙋</i><div><b>Hỏi qua ' + esc(ld.channel ? chLabel(ld.channel) : 'kênh khác') + '</b>' + (ld.interest ? ' · ' + esc(ld.interest) : '') + ' <span class="tag ' + (LEAD_CLS[ld.status] || '') + '">' + esc(ld.status) + '</span>' + (ld.note ? '<div class="tl-s">' + esc(String(ld.note).split('\n')[0].slice(0, 120)) + '</div>' : '') + '</div><small>' + fDate(ld.time) + (ld.owner ? '<br>' + esc(ld.owner) : '') + '</small></div>' }; }))
      .concat(logOf(c.phone).filter(function (l) { return l.what !== 'Gửi ưu đãi'; }).map(function (l) { var ic = l.result === NO_REPLY ? '📵' : l.result === 'Đã đặt lại' ? '✅' : '💬'; return { time: l.time, html: '<div class="tl"><i>' + ic + '</i><div><b>' + esc(l.result || l.what) + '</b>' + (l.note ? '<div class="tl-s">' + esc(l.note) + '</div>' : '') + '</div><small>' + fDate(l.time) + (l.by ? '<br>' + esc(l.by) : '') + '</small></div>' }; }))
      .concat(noteEntries(c.note).filter(function (e) { return !SHIFT_NOTE.test(norm(e.text)); }).map(function (e) { var miss = /(^|[^a-zà-ỹ])(knm|tb)([^a-zà-ỹ]|$)|thuê bao|không nghe|k nghe|tắt máy|từ chối nghe/i.test(e.text); return { time: e.time, html: '<div class="tl old"><i>' + (miss ? '📵' : '📒') + '</i><div>' + esc(e.text) + '</div><small>' + fDate(e.time) + '</small></div>' }; }))
      .sort(function (a, b) { return (b.time || 0) - (a.time || 0); });
    if (!items.length) return '<p class="muted" style="padding:8px 0">Chưa có đơn hàng hay lần chăm sóc nào.</p>';
    return '<div class="tls">' + items.slice(0, max).map(function (x) { return x.html; }).join('') + '</div>' + (items.length > max ? '<button class="btn block" data-tlmore style="margin-top:8px">Xem thêm ' + (items.length - max) + ' mục cũ hơn</button>' : '');
  }
  function openCustomer(phone, fromRoute) {
    var c = cust(phone); if (!c) { toast('Không tìm thấy khách', true); return; }
    if (!fromRoute) history.pushState(null, '', '#khach-hang/' + c.phone);
    var owners = userNames(), all = null, tab = 'hist', tlMax = 25, st = custStats(c, ordersOf(c.phone)), openId = '';
    var live = ordersOf(c.phone).filter(function (o) { return /^(Mới|Đã xác nhận|Đang giao)$/.test(o.status); })[0], sg = suggestFor(c), last1 = recentHist(c, 1)[0], hrs = callHours(c);
    if (c.owner && owners.indexOf(c.owner) < 0) owners.push(c.owner);
    var r = replyOf(c), avg = c.orders ? Math.round(c.spent / c.orders) : 0;
    var habit = function () { return '<span>🧺 Hay mua: <b>' + esc(st.top || '–') + '</b>' + (st.topN > 1 ? ' (' + st.topN + ' lần)' : '') + '</span>' + (st.gap ? '<span>🔁 Khoảng <b>' + st.gap + ' ngày</b> mua lại 1 lần</span>' : '') + (c.runout ? '<span>⏰ Dự kiến hết: <b>' + fDate(c.runout).slice(0, 5) + '</b> (' + daysAgo(c.runout) + ')</span>' : ''); };
    var body = '<div class="p-top"><div class="p-sub">' + cpPhone(c.phone) + ' · ' + (c.owner ? '👤 ' + esc(c.owner) : (isPoolStaff() ? claimBtn('c', c.phone) : 'Chưa ai phụ trách')) + (custSrc(c) ? ' · <span title="Nguồn khách (theo đơn đầu tiên)">' + srcIcon(custSrc(c)) + esc(custSrc(c)) + '</span>' : '') + '</div>' +
      '<div class="p-tags">' + zaloTag(c) + consentTag(c) + '</div>' +
      '<div class="acts steps p-acts"><a class="btn" href="tel:' + c.phone + '">📞 Gọi</a><a class="btn zalo" href="' + zalo(c.phone) + '" target="_blank" rel="noopener">Zalo</a><button class="btn pri" data-care="' + c.phone + '" data-task="' + (c.task ? c.task.type : 'other') + '">💬 Chăm sóc</button><button class="btn" data-neworder="' + c.phone + '">＋ Đơn</button><button class="btn" data-relink="' + c.phone + '" title="Link web có sẵn giỏ hàng như đơn trước, gửi khách tự đặt">🔗 Link đặt lại</button><button class="btn" data-refcode="' + c.phone + '" title="Mã giới thiệu riêng: bạn bè khách đặt lần đầu được giảm giá, khách được tặng quà">🎁 Mã giới thiệu</button></div></div>' +
      (c.flag ? '<div class="notice" style="background:var(--red-light);color:var(--red)">⚠️ Khách có nhãn <b>' + esc(c.flag) + '</b>. Nên yêu cầu chuyển khoản trước khi gửi hàng.</div>' : '') +
      '<div class="p-val"><div><b>' + moneyShort(c.spent) + '</b><span>Tổng chi</span></div><div><b>' + c.orders + '</b><span>đơn</span></div><div><b>' + moneyShort(avg) + '</b><span>TB/đơn</span></div></div>' +
      '<div class="p-lines"><span>🛒 Mua gần nhất: <b>' + daysAgo(c.last) + '</b> (' + fDate(c.last) + ')</span><span id="pHabit">' + habit() + '</span>' +
      (c.backN ? '<span>↩ ' + c.backN + ' lần hoàn' + (c.lastBack ? ' (gần nhất ' + fDate(c.lastBack) + ')' : '') + (riskyReturn(c) ? ' · <span class="bad-line">hay hoàn: nên nhờ khách chuyển khoản trước</span>' : ' · vẫn là khách tốt') + '</span>' : '') +
      noteExtras(c.note).map(function (l) { var i = l.indexOf(':'), k = l.slice(0, i).trim(); return '<span>' + (EXTRA_IC[k] || '•') + ' ' + esc(k) + ': <b>' + esc(l.slice(i + 1).trim()) + '</b></span>'; }).join('') +
      (sg ? '<span><span class="sug" title="Khách mua sản phẩm giống khách này hay mua thêm sản phẩm này">💡 Gợi ý giới thiệu: ' + esc(sg) + '</span></span>' : '') + '</div>' + refIntroBox(c) + aiBox(c) +
      (live ? '<div class="notice click" data-poid="' + esc(live.id) + '">' + (trkWarn(live) ? '⚠️' : '🚚') + ' Khách đang có đơn <b>' + fDate(live.time).slice(0, 5) + '</b> (' + esc(live.status) + (live.trk ? ': ' + esc(live.trk) : '') + ') chưa giao xong. Hỏi thăm đơn này trước, chưa nên chào thêm. <u>Xem đơn</u></div>' : '') +
      (coldOf(c) ? '<div class="notice" style="background:#eef2f7;color:#334">❄️ <b>Khách lạnh</b> (' + esc(coldOf(c)) + '): không đưa vào danh sách gọi hằng ngày. ' + (coldOf(c) === 'Không dùng nữa' ? 'Sau 6 tháng tự quay lại để chào lại 1 lần; khách đặt đơn mới là hết lạnh.' : 'Nếu bán lại, nên nhờ khách chuyển khoản trước.') + '</div>' : '') +
      '<div class="p-now">' + (c.task ? '<div>' + TASKS[c.task.type].icon + ' Hôm nay: <b>' + TASKS[c.task.type].title + '</b> · ' + taskLine(c) + '</div>' : '') +
      '<div class="' + (r.never ? 'muted' : '') + '">💬 ' + (r.never ? 'Chưa ghi nhận lần nào khách trả lời' : 'Lần cuối khách trả lời: <b>' + fDate(r.at) + '</b>' + (r.result ? ' – ' + esc(r.result) : '') + (r.by ? ' (' + esc(r.by) + ')' : '') + ' · ' + r.days + ' ngày trước') + (r.missed ? ' · <span class="bad-line">sau đó ' + r.missed + ' lần không nghe máy</span>' : '') + '</div>' +
      (last1 && last1.text ? '<div>📝 Ghi lần trước (' + fDate(last1.time).slice(0, 5) + '): <b>' + esc(last1.text.length > 220 ? last1.text.slice(0, 220) + '…' : last1.text) + '</b></div>' : '') +
      (hrs ? '<div>🕐 Khách hay nghe máy buổi <b>' + hrs + '</b></div>' : '') + '</div>' +
      giftBox(giftPerson(c.phone), '') +
      '<div class="tabs" role="tablist"><button data-ptab="hist" class="on">Lịch sử</button><button data-ptab="orders">Đơn hàng (' + c.orders + ')</button><button data-ptab="info">Thông tin</button></div><div id="pTab"></div>' +
      '<details class="p-edit" id="pEdit"><summary>⚙️ Sửa thông tin (người phụ trách, hẹn gọi lại, ngày sinh, nhãn màu, ghi chú)</summary><div class="box" style="margin:8px 0 0"><div class="row2c">' +
      (lvl() >= 2 ? '<label class="f"><span>Người phụ trách</span><select id="cOwner"><option value="">– Chưa ai –</option>' + owners.map(function (n) { return '<option' + (n === c.owner ? ' selected' : '') + '>' + esc(n) + '</option>'; }).join('') + '</select></label>' : '') +
      '<label class="f"><span>Hẹn gọi lại ngày</span><input type="date" id="cCb" value="' + (c.callback ? isoDate(c.callback) : '') + '"></label>' +
      '<label class="f"><span>🎂 Ngày sinh (ngày/tháng, năm nếu biết)</span><input type="text" id="cDob" inputmode="numeric" placeholder="VD 15/08 hoặc 15/08/1975" value="' + esc(c.dob || '') + '"' + (dobReady() ? '' : ' disabled title="Cần Apps Script bản mới"') + '></label></div>' +
      '<label class="f"><span>🎯 Khách dùng cho ai / để làm gì (hiện ở đầu hồ sơ)</span><input type="text" id="cUse" placeholder="VD: mua cho mẹ 70 tuổi, ăn ngủ kém" value="' + esc(useForOf(c.note)) + '"></label>' +
      '<label class="f"><span>🎨 Nhãn màu (để trống = máy tự tô theo loại khách)</span><select id="cTag"><option value="">Tự động: ' + esc(custCat(Object.assign({}, c, { tag: '' })).label) + '</option>' +
      myTags().concat(c.tag && !myTags().some(function (t) { return t.name === c.tag; }) ? [{ name: c.tag }] : []).map(function (t) { return '<option' + (t.name === c.tag ? ' selected' : '') + '>' + esc(t.name) + '</option>'; }).join('') + '</select></label>' +
      '<label class="f"><span>Ghi chú về khách / nhật ký (mỗi dòng “ngày: nội dung”)</span><textarea id="cNote" rows="6">' + esc(c.note) + '</textarea></label>' +
      (canEdit(c) ? commBox(c, '') : '') + (canEdit(c) && c.zalo ? '<p style="margin:0 0 10px"><button type="button" class="link small" id="cUnZalo">Bỏ đánh dấu đã kết bạn Zalo</button></p>' : '') +
      '<button class="btn pri" id="cSave">Lưu thay đổi</button></div></details>' +
      (canEdit(c) ? '<details class="p-edit"><summary>🔗 Gộp với số khác của khách này</summary><div class="box" style="margin:8px 0 0"><p class="small muted" style="margin:0 0 8px">Khách mua bằng 2–3 số điện thoại thì CRM tách thành nhiều hồ sơ. Nhập số còn lại: đơn hàng, nhật ký, ghi chú của số đó chuyển hết về hồ sơ này (' + fPhone(c.phone) + ' là số chính). Sau này file sale / đơn web có số kia cũng tự vào đây.</p>' +
        '<label class="f"><span>Số cần gộp vào (nhiều số cách nhau dấu phẩy)</span><input type="text" id="cMgPh" inputmode="tel" placeholder="VD 0399766607" value="' + esc(altPhones(c.note).filter(function (p) { return p !== c.phone && cust(p); }).join(', ')) + '"></label><button class="btn" id="cMg">🔗 Gộp vào hồ sơ này</button></div></details>' : '') +
      (lvl() >= 3 ? '<details class="p-edit"><summary>🗑 Xoá khách (chỉ Quản trị)</summary><div class="box" style="margin:8px 0 0"><p class="small muted" style="margin:0 0 8px">Dùng cho khách nhập thử / nhập nhầm. Xoá hồ sơ khách cùng <b>toàn bộ đơn hàng</b> (kể cả đơn huỷ/hoàn), khách hỏi và nhật ký chăm sóc của số ' + fPhone(c.phone) + '. Không khôi phục được.</p><button class="btn danger" id="cDel">🗑 Xoá khách này</button></div></details>' : '');
    var foot = '<div class="p-quick"><input type="text" id="cQuick" placeholder="✏️ Ghi nhanh: kh dùng ok, hẹn cuối tháng…" enterkeyhint="send"><button class="btn pri" id="cQSave">Lưu</button></div>';
    var m = modal(cp(c.name, esc(c.name || 'Khách')) + ' ' + custTags(c) + famTag(c), body, foot, { route: '#khach-hang', pushed: !fromRoute });
    var draw = function () {
      var list = all || ordersOf(c.phone), box = $('#pTab', m); if (!box) return;
      $$('[data-ptab]', m).forEach(function (b) { b.classList.toggle('on', b.getAttribute('data-ptab') === tab); });
      if (tab === 'hist') box.innerHTML = timelineHtml(c, list, tlMax) + (all ? '' : '<p class="small muted">Đang tải đơn cũ và ghi chú đầy đủ…</p>');
      if (tab === 'orders') box.innerHTML = (list.length ? '<div class="rows-b">' + list.slice().sort(function (a, b) { return (b.time || 0) - (a.time || 0); }).map(function (o) {
        var op = o.id === openId;
        return '<div class="or click' + (isVoid(o.status) ? ' void' : '') + (op ? ' open' : '') + '" data-poid="' + esc(o.id) + '"><div class="or-1"><b>' + fDate(o.time) + '</b>' + stTag(o.status) + '<span class="end">' + money(o.total) + ' <span class="or-tg">' + (op ? '▴' : '▾') + '</span></span></div><div class="or-2">' + esc(itemNames(o.items).join(', ')) + '</div>' +
          (op ? custOrderDetail(o, c) : '<div class="or-3">' + cp(o.id) + (o.seller ? ' · 👤 ' + esc(o.seller) : '') + (o.note ? ' · 📝 ' + esc(o.note.length > 80 ? o.note.slice(0, 80) + '…' : o.note) : '') + '</div>') + '</div>';
      }).join('') + '</div><p class="small muted" style="margin:6px 0 0">Bấm vào đơn để xem chi tiết, đặt lại đơn cũ.</p>' : '<p class="muted">Chưa có đơn.</p>') + (all ? '' : '<p class="small muted">Đang tải đơn cũ…</p>');
      if (tab === 'info') box.innerHTML = '<div class="box" style="margin:0"><div class="grid-info">' + info('Điện thoại', fPhone(c.phone), false, normPhone(c.phone)) + info('Zalo', c.zalo ? '✓ Đã kết bạn' : 'Chưa kết bạn') + info('Cộng đồng', inComm(c) ? '👥 Đã vào nhóm' : c.community || 'Chưa mời') +
        info('Ngày sinh', c.dob ? '🎂 ' + c.dob : 'chưa có') + info('Đơn đầu', fDate(c.first)) + info('Nhận hàng gần nhất', c.recv ? fDate(c.recv) : 'chưa rõ') + info('Nhóm', c.group) + info('Nguồn', custSrc(c) || '–') +
        (function () { var ld = leadsOf(c.phone)[0]; return ld ? info('Biết đến qua', chLabel(ld.channel) + ' · hỏi ' + fDate(ld.time) + (c.first && c.first >= (ld.time || 0) ? ' · chốt sau ' + Math.max(0, Math.round((c.first - ld.time) / DAY)) + ' ngày' : ''), true) : ''; })() + info('Tỉnh / thành', provOf(c) ? provOf(c).old + (provOf(c).old !== provOf(c).nw ? ' (nay thuộc ' + provOf(c).nw + ')' : '') : 'chưa rõ') + info('Địa chỉ', fullAddr(c), true, true) + (c.addrOld ? info('Địa chỉ cũ (Misa)', c.addrOld, true, true) : '') + info('Đã mua', c.products.join('; '), true) +
        noteExtras(c.note).map(function (l) { var i = l.indexOf(':'); return info(l.slice(0, i), l.slice(i + 1).trim(), true); }).join('') + '</div></div>';
      var mo = $('[data-tlmore]', m); if (mo) mo.onclick = function () { tlMax += 50; draw(); };
    };
    $$('[data-ptab]', m).forEach(function (b) { b.onclick = function () { tab = b.getAttribute('data-ptab'); draw(); }; });
    var findO = function (id) { return (all || ordersOf(c.phone)).filter(function (o) { return o.id === id; })[0]; };
    m.addEventListener('click', function (e) {
      var b = e.target.closest('[data-orrep],[data-orcopy],[data-orfull]');
      if (b) {
        var o = findO(b.getAttribute('data-orrep') || b.getAttribute('data-orcopy') || b.getAttribute('data-orfull')); if (!o) return;
        if (b.hasAttribute('data-orrep')) openOrderForm({ phone: c.phone, repeat: o });
        else if (b.hasAttribute('data-orfull')) { closeModal(true); openOrder(o.id); }
        else copy(o.name + ' – ' + o.phone + '\n' + fullAddr(o) + '\n' + o.items + '\nTổng: ' + money(o.total) + ' (' + o.payment + ')' + (o.note ? '\nGhi chú: ' + o.note : '')).then(function () { toast('Đã copy'); });
        return;
      }
      var r = e.target.closest('[data-poid]'); if (!r || e.target.closest('a,button,select,input,.or-d')) return;
      var id = r.getAttribute('data-poid'), inList = r.classList.contains('or');
      openId = inList && openId === id ? '' : id; tab = 'orders'; draw();
      if (!inList && openId) { var el = $('.or.open', m); if (el) el.scrollIntoView({ block: 'nearest', behavior: 'smooth' }); }
    });
    draw();
    var qs = $('#cQSave', m), qi = $('#cQuick', m), sv = $('#cSave', m), ta = $('#cNote', m);
    var cu = $('#cUse', m), noteBase = c.note || '', qD = 'draft_q_' + c.phone; draftKeep(qi, qD); // ghi chú lúc mở: máy chủ so với bản hiện tại để giữ dòng người khác vừa thêm
    if (c.noteCut) { qs.disabled = true; sv.disabled = true; ta.disabled = true; cu.disabled = true; }
    api('cust_orders', { phone: c.phone }).then(function (j) { // toàn bộ đơn (kể cả đơn cũ) + ghi chú đầy đủ
      all = j.orders; if (c.noteCut || j.note !== undefined) { c.note = j.note; c.noteCut = false; ta.value = j.note; noteBase = j.note || ''; }
      qs.disabled = false; sv.disabled = false; ta.disabled = false; cu.disabled = false; if (!cu.value) cu.value = useForOf(c.note); st = custStats(c, all); var hb = $('#pHabit', m); if (hb) hb.innerHTML = habit(); draw();
    }, function (e) { all = ordersOf(c.phone); qs.disabled = false; sv.disabled = !!c.noteCut; ta.disabled = !!c.noteCut; draw(); if (c.owner) toast(e.message, true); });
    if ($('#cMg', m)) $('#cMg', m).onclick = function () {
      var ps = ($('#cMgPh', m).value.match(/[\d\s.+]{9,}/g) || []).map(function (p) { return normPhone(p.replace(/\s|\./g, '')); }).filter(function (p) { return p && p !== c.phone; });
      if (!ps.length) { toast('Nhập số điện thoại cần gộp', true); return; }
      var miss = ps.filter(function (p) { return !cust(p); }); // số chưa có trong danh sách (chưa mua / nhân viên không thấy): máy chủ kiểm tra lại
      mergeCust(c.phone, ps, this, miss.length ? '\n(Số ' + miss.join(', ') + ' chưa thấy trong danh sách khách đã mua trên máy này.)' : '');
    };
    if ($('#cUnZalo', m)) $('#cUnZalo', m).onclick = function () { setZalo(c, false); this.remove(); };
    if ($('#cDel', m)) $('#cDel', m).onclick = function () { adminDelete('c', c, 'khách ' + (c.name || '') + ' – ' + fPhone(c.phone) + ' cùng ' + c.orders + ' đơn', this); };
    var quick = function () {
      var q = qi.value.trim(); if (!q || qs.disabled) return;
      var note = fDate(Date.now()).slice(0, 5) + ': ' + q + (c.note ? '\n' + c.note : '');
      sendOp('customer', { phone: c.phone, note: note, quick: q }); ta.value = note; noteBase = note; store(qD, null); qi.value = ''; tab = 'hist'; draw(); toast('Đã ghi ✓'); render();
    };
    qs.onclick = quick; qi.addEventListener('keydown', function (e) { if (e.key === 'Enter') { e.preventDefault(); quick(); } });
    sv.onclick = function () {
      var uf = $('#cUse', m).value.trim().replace(/\s+/g, ' ');
      if (uf !== useForOf(ta.value)) ta.value = (uf ? 'Dùng cho: ' + uf + '\n' : '') + ta.value.split('\n').filter(function (l) { return !/^\s*Dùng cho:/.test(l); }).join('\n');
      var p = { phone: c.phone, note: ta.value.trim(), callback: $('#cCb', m).value, tag: $('#cTag', m).value };
      if ($('#cOwner', m)) p.owner = $('#cOwner', m).value;
      var dv = $('#cDob', m).value.trim(), dn = dobNorm(dv);
      if (dv && !dn) { toast('Ngày sinh chưa đúng. Nhập dạng 15/08 hoặc 15/08/1975', true); return; }
      if (dobReady() && (dn || '') !== (c.dob || '')) p.dob = dn || '';
      if (p.note !== noteBase) p.noteWas = noteBase;
      sendOp('customer', p); noteBase = p.note; draw(); toast('Đã lưu ✓'); $('#pEdit', m).open = false; render();
    };
  }
  /** Các dòng "30/09/25: knm" trong ghi chú (nhập từ Sheet cũ hoặc ghi nhanh) → mốc thời gian. */
  function noteEntries(note) {
    var now = Date.now(), out = [];
    String(note || '').split('\n').forEach(function (l) {
      var m = l.match(/^\s*(\d{1,2})\/(\d{1,2})(?:\/(\d{2,4}))?\s*:\s*(.+)$/); if (!m) return;
      var y = m[3] ? (m[3].length === 2 ? 2000 + +m[3] : +m[3]) : vnDate(now).y, t = Date.UTC(y, m[2] - 1, +m[1], 2);
      if (!m[3] && t > now + 2 * DAY) t = Date.UTC(y - 1, m[2] - 1, +m[1], 2);
      out.push({ time: t, text: m[4].trim() });
    });
    return out;
  }
  function recentHist(c, n) { // vài lần chăm sóc gần nhất (CRM + ghi chú cũ) để nhìn nhanh trước khi gọi
    if (n === 1 && c._rh1 !== undefined) return c._rh1;
    var res = logOf(c.phone).filter(isCareLog).map(function (l) { return { time: l.time, text: (l.result || '') + (l.note ? ': ' + l.note : '') }; })
      .concat(noteEntries(c.note).filter(function (e) { return !SHIFT_NOTE.test(norm(e.text)); })).sort(function (a, b) { return (b.time || 0) - (a.time || 0); }).slice(0, n);
    if (n === 1) c._rh1 = res;
    return res;
  }
  function histHtml(c, logs) {
    var items = logs.map(function (l) { return { time: l.time, html: logItem(l) }; }).concat(noteEntries(c.note).map(function (e) {
      return { time: e.time, html: '<div class="it old"><b>' + (/(^|[^a-zà-ỹ])(knm|tb)([^a-zà-ỹ]|$)|thuê bao|không nghe|k nghe|tắt máy|từ chối nghe/i.test(e.text) ? '📵' : '📒') + '</b> ' + esc(e.text) + '<small>' + fDate(e.time) + ' · ghi chú</small></div>' };
    })).sort(function (a, b) { return (b.time || 0) - (a.time || 0); });
    return '<h3>Lịch sử chăm sóc (' + items.length + ')</h3>' + (items.length ? '<div class="timeline">' + items.map(function (x) { return x.html; }).join('') + '</div>' + (c.noteCut ? '<p class="small muted">Đang tải thêm ghi chú cũ…</p>' : '') :
      '<p class="muted">Chưa có lần chăm sóc nào.' + (c.careAt ? ' Lần gần nhất ghi trong Sheet: ' + fDate(c.careAt) + (c.careResult ? ' – ' + esc(c.careResult) : '') : '') + '</p>');
  }
  function ageBox(c) {
    var r = replyOf(c), lv = ageLevel(r.days);
    return '<div class="age-box ' + lv + '"><div class="age-num">' + r.days + '<small> ngày</small></div><div>' +
      (r.never ? '<b>chưa chăm sóc (chưa lần nào)</b><span>Tính từ ngày mua đầu tiên ' + fDate(c.first) + '. Khách chưa được liên hệ hoặc chưa trả lời lần nào.</span>'
        : '<b>' + (r.days === 0 ? 'Vừa chăm sóc hôm nay' : 'chưa chăm sóc') + '</b><span>Lần cuối khách phản hồi: ' + fDate(r.at) + (r.result ? ' – ' + esc(r.result) : '') + (r.by ? ' (' + esc(r.by) + ')' : '') + '</span>') +
      (r.missed ? '<span>📵 Sau đó đã gọi ' + r.missed + ' lần không nghe máy</span>' : '') + '</div></div>';
  }
  function info(k, v, full, cv) { var e = v === '' || v == null; return '<div' + (full ? ' class="full"' : '') + '><span>' + k + '</span><b>' + (cv && !e ? cp(cv === true ? v : cv, esc(v)) : esc(e ? '–' : v)) + '</b></div>'; }
  function userNames() { return (S.d.users || []).filter(function (u) { return u.active !== false && u.role !== 'Marketing'; }).map(function (u) { return u.name; }); }
  /** Tài khoản Quản trị (chủ, điều hành) không bán hàng → không đưa vào các bảng thống kê nhân sự cho gọn. */
  function isAdminName(n) { return (S.d.users || []).some(function (u) { return u.name === n && u.role === 'Quản trị'; }); }
  function staffNames() { return userNames().filter(function (n) { return !isAdminName(n); }); }
  /** Quản trị xoá dữ liệu nhập thử: xác nhận 2 lần (gõ chữ XOA), xoá xong tải lại dữ liệu. */
  function adminDelete(kind, target, label, btn) {
    if (lvl() < 3) return;
    if (!confirm('Xoá vĩnh viễn ' + label + '?\n\nKhông khôi phục được. Chỉ dùng cho dữ liệu nhập thử / nhập nhầm.')) return;
    var typed = prompt('Gõ chữ XOA (viết hoa, không dấu) để xác nhận xoá:'); if (typed === null) return;
    if (String(typed).trim().toUpperCase() !== 'XOA') { toast('Chưa xoá: gõ chưa đúng chữ XOA', true); return; }
    if (btn) { btn.disabled = true; btn.textContent = 'Đang xoá…'; }
    api(kind === 'o' ? 'order_delete' : 'customer_delete', kind === 'o' ? { id: target.id, row: target.row } : { phone: target.phone }).then(function (j) {
      var d = S.d;
      if (kind === 'o') d.orders = d.orders.filter(function (o) { return o.row !== target.row; });
      else {
        d.orders = d.orders.filter(function (o) { return o.phone !== target.phone; }); d.customers = d.customers.filter(function (c) { return c.phone !== target.phone; });
        d.leads = (d.leads || []).filter(function (l) { return l.phone !== target.phone; });
      }
      setData(d, S.loadedAt); closeModal(true); render(); navBadges();
      toast(kind === 'o' ? 'Đã xoá đơn ' + target.id : 'Đã xoá khách' + (j.orders ? ' và ' + j.orders + ' đơn' : ''));
      load(true, true); // tải lại để số liệu khách (tổng chi, số đơn) đúng
    }, function (e) { toast(e.message, true); if (btn) { btn.disabled = false; btn.textContent = kind === 'o' ? '🗑 Xoá đơn này' : '🗑 Xoá khách này'; } });
  }

  /* ---------- hộp chăm sóc: tin mẫu → Zalo → kết quả */
  function templateFor(type) {
    var key = TASKS[type === 'old' ? 'winback' : type] && TASKS[type === 'old' ? 'winback' : type].tpl, tp = S.d.templates; // khách cũ lâu chưa gọi → dùng mẫu "Mời quay lại"
    var find = function (k) { for (var i = 0; i < tp.length; i++) if (norm(tp[i][0]).indexOf(norm(k)) >= 0) return i; return -1; };
    var i = key ? find(key) : -1;
    if (i < 0 && type !== 'callback') i = find('7 ngày'); // việc chưa có mẫu riêng (chăm sóc tự do…) → mẫu hỏi thăm, không để ô tin trống
    return i;
  }
  function fillTpl(text, c) {
    var name = (c.name || '').replace(/\(.*?\)/g, ' ').trim().split(/\s+/).pop() || 'anh/chị';
    return String(text).replace(/\[Tên\]/gi, name).replace(/\[Sản phẩm\]/gi, shortProducts(c.products, 2) || 'sản phẩm');
  }
  function openCare(phone, type, opt) {
    var c = cust(phone); if (!c) return; opt = opt || {};
    type = type || (c.task ? c.task.type : 'other');
    var ti = templateFor(type), tp = S.d.templates;
    var hist = recentHist(c, 4), all = null;
    var body = (opt.flow ? '<div class="flow-h"><div><b>Khách ' + opt.n + ' / ' + opt.total + '</b><span>' + (TASKS[type] ? TASKS[type].icon + ' ' + TASKS[type].title : 'Chăm sóc') + '</span></div><div class="bar"><i style="width:' + Math.round((opt.n - 1) * 100 / Math.max(1, opt.total)) + '%"></i></div></div>' : '') +
      '<div class="box"><div class="r1" style="display:flex;gap:8px;align-items:center;flex-wrap:wrap"><b>' + cp(c.name) + '</b> ' + custTags(c) + famTag(c) + ' <span class="muted">' + cpPhone(c.phone) + '</span><button class="btn sm" data-relink="' + c.phone + '" style="margin-left:auto" title="Link web có sẵn giỏ hàng như đơn trước">🔗 Link đặt lại</button></div>' +
      '<div class="small muted" style="margin-top:4px">' + esc(shortProducts(c.products, 3)) + ' · mua ' + daysAgo(c.last) + (c.task ? ' · ' + taskLine(c) : '') + '</div>' +
      (c.flag ? '<div class="notice" style="background:var(--red-light);color:var(--red);margin:8px 0 0">⚠️ Khách có nhãn <b>' + esc(c.flag) + '</b>. Nên yêu cầu chuyển khoản trước khi gửi hàng.</div>' : '') +
      '<div id="kSum">' + careSum(c, null) + '</div>' + aiBox(c) +
      (hist.length ? '<div class="k-sec">💬 Chăm sóc gần đây</div><div class="mini-hist">' + hist.map(function (x) { return '<div><span>' + fDate(x.time).slice(0, 5) + '</span> ' + esc(x.text) + '</div>'; }).join('') + '</div>' : '') + '</div>' +
      '<div class="box"><h3>Bước 1 · Gọi hoặc nhắn cho khách</h3>' +
      (c.zalo ? '<div class="k-go"><button class="btn zalo" id="kZalo">💬 Nhắn Zalo</button><a class="btn" href="tel:' + c.phone + '">📞 Gọi</a></div><p class="small muted" style="margin:8px 0 0">' + ZI + ' Khách đã kết bạn Zalo: nhắn trước, khách tiện trả lời lúc rảnh. Bấm <b>Nhắn Zalo</b> là tin bên dưới được copy sẵn, chỉ cần dán và gửi.</p>'
        : '<div class="k-go"><a class="btn pri" href="tel:' + c.phone + '">📞 Gọi</a><button class="btn zalo" id="kZalo">💬 Nhắn Zalo</button></div><p class="small" style="margin:8px 0 0">Khách <b>chưa kết bạn Zalo</b>: nên gọi trước, gọi xong xin kết bạn. ' + (canEdit(c) ? zaloTag(c) : '') + '</p>') +
      '<details class="k-msg"' + (c.zalo ? ' open' : '') + '><summary>✏️ Tin nhắn sẽ gửi (sửa được)</summary>' +
      '<label class="f" style="margin-top:8px"><span>Mẫu tin</span><select id="kTpl"><option value="-1">– Tự viết –</option>' + tp.map(function (t, i) { return '<option value="' + i + '"' + (i === ti ? ' selected' : '') + '>' + esc(t[0] + (t[1] ? ' – ' + t[1] : '')) + '</option>'; }).join('') + '</select></label>' +
      '<label class="f"><span>Nội dung (nhớ điền phần “…” nếu có)</span><textarea id="kMsg" rows="5">' + esc(ti >= 0 ? fillTpl(tp[ti][2], c) : '') + '</textarea></label>' +
      '<button type="button" class="link small" id="kCopy">Chỉ copy tin (không mở Zalo)</button>' + (S.d.rules && S.d.rules.ai ? ' · <button type="button" class="link small" data-ai="msg" data-aiph="' + c.phone + '" data-aitask="' + esc(type || 'other') + '">✨ Nhờ AI viết tin</button>' : '') + '</details></div>' +
      commBox(c, type, true) + giftBox(giftPerson(c.phone), type, true) + // thu gọn: để Bước 2 không bị đẩy xuống xa
      '<div class="box"><h3>Bước 2 · Khách thế nào? Bấm 1 nút là xong</h3>' +
      '<label class="f"><span>Khách nói gì (không bắt buộc, gõ trước rồi bấm nút)</span><textarea id="kNote" rows="2" placeholder="vd: chị bảo ngủ ngon hơn, còn nửa hộp…"></textarea></label>' +
      '<div class="f"><span style="display:block;font-size:13px;color:var(--muted);margin-bottom:6px">Máy tự lưu và tự hẹn ngày gọi lại</span><div class="quick">' + QUICK.filter(function (q) { return !q.only || q.only === type; }).sort(function (a, b) { return (b.only ? 1 : 0) - (a.only ? 1 : 0); }).map(function (q) { return '<button class="btn" data-q="' + q.k + '" title="' + esc(q.r + (q.d ? ', ' + q.d + ' ngày sau tự nhắc gọi lại' : '')) + '">' + q.l + (q.d ? '<small>gọi lại sau ' + q.d + ' ngày</small>' : '') + '</button>'; }).join('') + '</div></div>' +
      '<div class="k-cb"><span>📅 Khách hẹn gọi lại:</span>' + [[1, 'Mai'], [3, '3 ngày'], [7, '1 tuần'], [14, '2 tuần']].map(function (x) { return '<button type="button" class="chip" data-kcb="' + x[0] + '">' + x[1] + '</button>'; }).join('') + '</div>' +
      '<details class="k-more"><summary>Kết quả khác / tự chọn ngày hẹn</summary><div style="margin-top:10px">' +
      '<label class="f"><span>Việc</span><select id="kTask">' + Object.keys(TASK_LOG).map(function (k) { return '<option value="' + k + '"' + (k === type ? ' selected' : '') + '>' + TASK_LOG[k] + '</option>'; }).join('') + '</select></label>' +
      '<div class="f"><span style="display:block;font-size:13px;font-weight:600;margin-bottom:6px;color:var(--ink)">Kết quả</span><div class="radios">' + RESULTS.map(function (r, i) { return '<label><input type="radio" name="kRes" value="' + esc(r) + '"' + '><span>' + esc(r) + '</span></label>'; }).join('') + '</div></div>' +
      '<label class="f" id="kCbWrap"><span>Hẹn gọi lại ngày (nếu có)</span><input type="date" id="kCb" min="' + isoDate(Date.now()) + '"></label>' +
      '<button class="btn pri" id="kSave" style="width:100%">' + (opt.flow ? 'Lưu & sang khách tiếp' : 'Lưu kết quả') + '</button></div></details><p class="err" id="kErr"></p></div>';
    var m = modal((opt.flow ? '📞 ' : 'Chăm sóc: ') + esc(c.name), body, opt.flow ? '<button class="btn" id="kSkip">⏭ Để sau, sang khách tiếp</button>' : '<button class="btn" data-close>Để sau</button>');
    if (opt.flow) {
      m.addEventListener('click', function (e) { if (e.target === m || e.target.closest('[data-close]')) S.flow = null; }, true); // bấm ✕ = dừng gọi lần lượt
      $('#kSkip', m).onclick = function () { if (S.flow) S.flow.skip[c.phone] = 1; closeModal(true); nextFlow(); };
    }
    var drawSum = function (more) { var b = $('#kSum', m); if (!b) return; b.innerHTML = careSum(c, all, more); var x = $('[data-kmore]', b); if (x) x.onclick = function () { drawSum(true); }; };
    drawSum(false);
    api('cust_orders', { phone: c.phone }).then(function (j) { all = j.orders || null; if (c.noteCut && j.note !== undefined) { c.note = j.note; c.noteCut = false; } drawSum(false); }, function () {}); // tải đủ đơn cũ (danh sách tải sẵn chỉ có đơn gần đây)
    var msg = $('#kMsg', m);
    $('#kTpl', m).onchange = function () { var i = +this.value; msg.value = i >= 0 ? fillTpl(tp[i][2], c) : ''; };
    $('#kCopy', m).onclick = function () { copy(msg.value).then(function () { toast('Đã copy tin nhắn'); }); };
    $('#kZalo', m).onclick = function () { copy(msg.value).then(function () { toast('Đã copy – dán vào khung chat Zalo'); }); window.open(zalo(c.phone), '_blank', 'noopener'); };
    $$('input[name=kRes]', m).forEach(function (r) { r.onchange = function () { if (r.value === 'Hẹn gọi lại' && !$('#kCb', m).value) { $('#kCb', m).value = isoDate(Date.now() + 2 * DAY); $('#kCb', m).focus(); } }; });
    $$('[data-q]', m).forEach(function (b) { b.onclick = function () { quickCare(c, b.getAttribute('data-q'), $('#kTask', m).value, $('#kNote', m).value.trim(), b, $('#kErr', m)); }; });
    var kn = $('#kNote', m), dk = 'draft_k_' + c.phone; draftKeep(kn, dk); // chữ đang gõ: lỡ đóng cửa sổ thì lần mở sau vẫn còn
    $$('[data-kcb]', m).forEach(function (b) { b.onclick = function () { // hẹn nhanh 1 chạm (Đợt 2): lưu "Hẹn gọi lại" + ngày
      var n = +b.getAttribute('data-kcb'), p = { phone: c.phone, task: $('#kTask', m).value, result: 'Hẹn gọi lại', note: kn.value.trim(), callback: isoDate(Date.now() + n * DAY) };
      $$('[data-kcb]', m).forEach(function (x) { x.disabled = true; });
      saveCare(c, p).then(function () { store(dk, null); closeModal(); toast('Đã hẹn gọi lại ' + fDate(Date.now() + n * DAY).slice(0, 5) + ' ✓'); navBadges(); render(); if (S.flow) setTimeout(nextFlow, 200); }, function (e) { $$('[data-kcb]', m).forEach(function (x) { x.disabled = false; }); $('#kErr', m).textContent = e.message; });
    }; });
    $('#kSave', m).onclick = function () {
      var res = $('input[name=kRes]:checked', m), err = $('#kErr', m);
      if (!res) { err.textContent = 'Bạn chọn kết quả giúp nhé.'; return; }
      var p = { phone: c.phone, task: $('#kTask', m).value, result: res.value, note: $('#kNote', m).value.trim(), callback: $('#kCb', m).value };
      var btn = this; btn.disabled = true; btn.textContent = 'Đang lưu…';
      saveCare(c, p).then(function () { store(dk, null); closeModal(); toast('Đã lưu kết quả chăm sóc ✓'); navBadges(); render(); if (S.flow) setTimeout(nextFlow, 200); }, function (e) { btn.disabled = false; btn.textContent = opt.flow ? 'Lưu & sang khách tiếp' : 'Lưu kết quả'; err.textContent = e.message; });
    };
  }
  /** Tóm tắt khách trong hộp chăm sóc: giá trị, thói quen mua, lần cuối trả lời, lịch sử đơn – nhìn 1 màn hình là đủ để gọi. */
  function careSum(c, all, more) {
    var list = (all || ordersOf(c.phone)).slice().sort(function (a, b) { return (b.time || 0) - (a.time || 0); }), st = custStats(c, list), r = replyOf(c), pv = provOf(c);
    var health = noteExtras(c.note).filter(function (l) { return /^Sức khoẻ:/.test(l.trim()); }).map(function (l) { return l.replace(/^\s*Sức khoẻ:\s*/, ''); }).join('; ');
    var sg = suggestFor(c), max = more ? list.length : 2;
    return '<div class="k-val"><span><b>' + moneyShort(c.spent) + '</b> tổng chi</span><span><b>' + c.orders + '</b> đơn</span>' + (c.orders ? '<span><b>' + moneyShort(c.spent / c.orders) + '</b> TB/đơn</span>' : '') + (c.first ? '<span>khách từ <b>' + fDate(c.first).replace(/^\d+\//, '') + '</b></span>' : '') + '</div>' +
      '<div class="k-lines">' +
      (st.top ? '<div>🧺 Hay mua: <b>' + esc(st.top) + '</b>' + (st.topN > 1 ? ' (' + st.topN + ' lần)' : '') + (st.gap ? ' · 🔁 ~' + st.gap + ' ngày mua lại' : '') + '</div>' : '') +
      (c.runout ? '<div>⏰ Dự kiến hết hàng: <b>' + fDate(c.runout).slice(0, 5) + '</b> (' + daysAgo(c.runout) + ')</div>' : '') +
      '<div' + (r.never ? ' class="muted"' : '') + '>💬 ' + (r.never ? 'Chưa ghi nhận lần nào khách trả lời' : 'Khách trả lời lần cuối: <b>' + fDate(r.at).slice(0, 5) + '</b>' + (r.result ? ' – ' + esc(r.result) : '') + ' (' + r.days + ' ngày trước)') + (r.missed ? ' · <span class="bad-line">' + r.missed + ' lần không nghe máy</span>' : '') + '</div>' +
      (useForOf(c.note) ? '<div>🎯 Dùng cho: <b>' + esc(useForOf(c.note)) + '</b></div>' : '') +
      (health ? '<div>🩺 Sức khoẻ: <b>' + esc(health) + '</b></div>' : '') +
      (pv || (c.owner && lvl() >= 2) ? '<div class="muted">' + (pv ? '📍 ' + esc(pv.old) : '') + (pv && c.owner && lvl() >= 2 ? ' · ' : '') + (c.owner && lvl() >= 2 ? '👤 ' + esc(c.owner) : '') + '</div>' : '') +
      (c.backN ? '<div>↩ ' + c.backN + ' lần hoàn' + (riskyReturn(c) ? ' · <span class="bad-line">nên nhờ khách chuyển khoản trước</span>' : '') + '</div>' : '') +
      (sg ? '<div><span class="sug" title="Khách mua sản phẩm giống khách này hay mua thêm sản phẩm này">💡 Gợi ý giới thiệu: ' + esc(sg) + '</span></div>' : '') + '</div>' +
      '<div class="k-sec">🛒 Lịch sử mua (' + Math.max(list.length, c.orders || 0) + ' đơn)</div>' +
      (list.length ? '<div class="k-ord">' + list.slice(0, max).map(function (o) {
        return '<div class="' + (isVoid(o.status) ? 'void' : '') + '"><div class="k-o1"><span>' + fDate(o.time) + '</span>' + stTag(o.status) + '<b>' + money(o.total) + '</b></div><div class="k-o2">' + esc(itemNames(o.items).join(', ') || '–') + (o.seller ? ' <span class="muted">· ' + esc(o.seller) + '</span>' : '') + '</div>' + (o.note ? '<div class="k-o3">📝 ' + esc(o.note.length > 90 ? o.note.slice(0, 90) + '…' : o.note) + '</div>' : '') + '</div>';
      }).join('') + '</div>' + (list.length > max ? '<button type="button" class="link small" data-kmore>Xem thêm ' + (list.length - max) + ' đơn cũ hơn</button>' : '') + (all ? '' : '<p class="small muted" style="margin:2px 0 0">Đang tải đơn cũ…</p>')
        : '<p class="small muted" style="margin:2px 0 0">' + (all ? 'Chưa có đơn.' : 'Đang tải đơn…') + '</p>');
  }
  function saveCare(c, p) { sendOp('care', p); return Promise.resolve(); } // lưu ngay trên màn hình, gửi ngầm (xem hàng chờ gửi)
  /** Ghi nhanh 1 chạm: KNM, thuê bao, dùng ok… (thêm ghi chú đang gõ nếu có). */
  function quickCare(c, key, task, extra, btn, errEl) {
    var q = QUICK.filter(function (x) { return x.k === key; })[0]; if (!q) return;
    var p = { phone: c.phone, task: task && TASK_LOG[task] ? task : 'other', result: q.r, note: q.n + (extra ? ', ' + extra : ''), callback: q.d ? isoDate(Date.now() + q.d * DAY) : '' };
    if (q.received) p.received = 1;
    var txt = btn ? btn.textContent : ''; if (btn) { btn.disabled = true; btn.textContent = 'Đang lưu…'; }
    saveCare(c, p).then(function () {
      store('draft_k_' + c.phone, null); if ($('.modal')) closeModal();
      toast('Đã ghi “' + q.n + '”' + (q.d ? ' · ' + q.d + ' ngày sau tự nhắc gọi lại' : '') + ' ✓'); navBadges(); render();
      if (q.order) { S.flow = null; openNewOrder(c.phone); } else if (S.flow) setTimeout(nextFlow, 200);
    }, function (e) { if (btn) { btn.disabled = false; btn.textContent = txt; } if (errEl) errEl.textContent = e.message; else toast(e.message, true); });
  }

  /* ================================================================ GÓP Ý: chụp màn hình + vài chữ → quản trị nhận qua Telegram, xem & trả lời trong CRM */
  var FB_KINDS = [['🐞 Lỗi', 'Lỗi'], ['😕 Khó dùng', 'Khó dùng'], ['💡 Ý tưởng', 'Ý tưởng']];
  function shrinkImage(file) { // ảnh chụp màn hình → JPEG rộng tối đa 1280px (~100–250KB) cho gửi nhanh
    return new Promise(function (ok, bad) {
      var fr = new FileReader(); fr.onerror = bad;
      fr.onload = function () {
        var im = new Image(); im.onerror = bad;
        im.onload = function () { var k = Math.min(1, 1280 / Math.max(im.width, im.height / 2.2)), c = document.createElement('canvas'); c.width = Math.round(im.width * k); c.height = Math.round(im.height * k); c.getContext('2d').drawImage(im, 0, 0, c.width, c.height); ok(c.toDataURL('image/jpeg', 0.75)); };
        im.src = fr.result;
      };
      fr.readAsDataURL(file);
    });
  }
  function openFeedback(tab) {
    tab = tab || 'send';
    var mgr = lvl() >= 2, here = route().view, imgs = [];
    var tabs = '<div class="chips" style="margin:0 0 12px"><button class="chip' + (tab === 'send' ? ' on' : '') + '" data-fbtab="send">✍️ Gửi góp ý</button><button class="chip' + (tab === 'list' ? ' on' : '') + '" data-fbtab="list">' + (mgr ? '📥 Danh sách góp ý' + (S.d.fbNew ? ' <em>' + S.d.fbNew + ' mới</em>' : '') : '📋 Góp ý của tôi') + '</button></div>';
    var body = tabs + (tab === 'send' ?
      '<p class="small muted" style="margin:0 0 10px">Gặp lỗi, chỗ khó dùng hay có ý tưởng? <b>Chụp màn hình</b> chỗ đó, rồi gửi kèm vài chữ. Máy tự ghi bạn đang ở màn hình nào.</p>' +
      '<div class="radios" style="margin-bottom:10px">' + FB_KINDS.map(function (k, i) { return '<label><input type="radio" name="fbKind" value="' + k[1] + '"' + (i === 0 ? ' checked' : '') + '><span>' + k[0] + '</span></label>'; }).join('') + '</div>' +
      '<label class="f"><span>Nội dung</span><textarea id="fbText" rows="4" placeholder="vd: Bấm KNM xong khách vẫn còn trong danh sách / Muốn có nút gửi tin Zalo hàng loạt…"></textarea></label>' +
      '<div class="f"><span style="display:block;font-size:13px;font-weight:600;margin-bottom:6px;color:var(--ink)">Ảnh chụp màn hình (tối đa 3)</span><div class="fb-imgs" id="fbImgs"></div>' +
      '<label class="btn" style="margin-top:6px">📷 Chọn ảnh<input type="file" id="fbFile" accept="image/*" multiple hidden></label> <span class="small muted">Trên máy tính: bấm Ctrl+V để dán ảnh</span></div><p class="err" id="fbErr"></p>'
      : '<div id="fbList"><p class="muted">Đang tải…</p></div>');
    var m = modal('💡 Góp ý cho CRM', body, tab === 'send' ? '<button class="btn" data-close>Đóng</button><button class="btn pri" id="fbSend">Gửi góp ý</button>' : '<button class="btn" data-close>Đóng</button>');
    $$('[data-fbtab]', m).forEach(function (b) { b.onclick = function () { closeModal(true); openFeedback(b.getAttribute('data-fbtab')); }; });
    if (tab === 'list') { fbList(m, mgr); return; }
    var draw = function () { $('#fbImgs', m).innerHTML = imgs.map(function (src, i) { return '<div class="fb-img"><img src="' + src + '" alt=""><button type="button" data-rmimg="' + i + '" aria-label="Bỏ ảnh">✕</button></div>'; }).join(''); $$('[data-rmimg]', m).forEach(function (b) { b.onclick = function () { imgs.splice(+b.getAttribute('data-rmimg'), 1); draw(); }; }); };
    var add = function (files) { Array.prototype.slice.call(files || []).filter(function (f) { return /^image\//.test(f.type); }).slice(0, 3 - imgs.length).forEach(function (f) { shrinkImage(f).then(function (src) { if (imgs.length < 3) { imgs.push(src); draw(); } }, function () { toast('Không đọc được ảnh này', true); }); }); };
    $('#fbFile', m).onchange = function () { add(this.files); this.value = ''; };
    m.addEventListener('paste', function (e) { var fs = []; Array.prototype.forEach.call((e.clipboardData || {}).items || [], function (it) { if (it.kind === 'file') fs.push(it.getAsFile()); }); if (fs.length) { e.preventDefault(); add(fs); } });
    setTimeout(function () { $('#fbText', m).focus(); }, 50);
    $('#fbSend', m).onclick = function () {
      var text = $('#fbText', m).value.trim(), err = $('#fbErr', m); if (!text && !imgs.length) { err.textContent = 'Bạn gõ vài chữ hoặc chọn ảnh giúp nhé.'; return; }
      var b = this; b.disabled = true; b.textContent = 'Đang gửi…';
      var ctx = 'Màn hình: ' + here + (lastErr ? ' · lỗi gần nhất: ' + lastErr.slice(0, 150) : '') + (S.outbox.length ? ' · đang chờ gửi ' + S.outbox.length : '');
      api('feedback', { kind: $('input[name=fbKind]:checked', m).value, text: text, images: imgs, route: here, ua: navigator.userAgent + ' · ' + screen.width + 'x' + screen.height + ' · ' + ctx, ver: 'web ' + ((($('script[src*="app.js"]') || {}).src || '').split('v=')[1] || '?') }).then(function (j) {
        closeModal(true); toast(j.warn ? 'Đã gửi nội dung (ảnh chưa lưu được, quản trị sẽ xem)' : 'Đã gửi góp ý. Cảm ơn bạn! 🙏', !!j.warn);
      }, function (e) { b.disabled = false; b.textContent = 'Gửi góp ý'; err.textContent = e.message; });
    };
  }
  var FB_CLS = { 'Mới': 'st-moi', 'Đang làm': 'st-xn', 'Đã xong': 'st-xong', 'Không làm': 'st-huy' };
  function fbList(m, mgr) {
    api('fb_list').then(function (j) {
      var box = $('#fbList', m); if (!j.items.length) { box.innerHTML = empty(mgr ? 'Chưa có góp ý nào.' : 'Bạn chưa gửi góp ý nào. Bấm “Gửi góp ý” để bắt đầu.'); return; }
      box.innerHTML = '<div class="list">' + j.items.map(function (x, i) {
        return '<div class="card click" data-fbi="' + i + '"><div class="r1"><b>' + esc(x.kind) + '</b><span class="tag ' + (FB_CLS[x.status] || '') + '">' + esc(x.status) + '</span><span class="end small muted">' + fDateTime(x.time) + '</span></div>' +
          '<div class="r2">' + esc(x.text.length > 140 ? x.text.slice(0, 140) + '…' : x.text) + '</div><div class="r3">' + (mgr ? '👤 ' + esc(x.by) + ' · ' : '') + '📍 ' + esc(x.route) + (x.imgs.length ? ' · 🖼 ' + x.imgs.length + ' ảnh' : '') + (x.reply ? ' · 💬 đã trả lời' : '') + '</div></div>';
      }).join('') + '</div>';
      $$('[data-fbi]', box).forEach(function (c) { c.onclick = function () { fbDetail(j.items[+c.getAttribute('data-fbi')], j.statuses, mgr); }; });
      if (mgr) { S.d.fbNew = j.items.filter(function (x) { return x.status === 'Mới'; }).length; navBadges(); }
    }, function (e) { $('#fbList', m).innerHTML = '<p class="err">' + esc(e.message) + '</p>'; });
  }
  function fbDetail(x, statuses, mgr) {
    var body = '<div class="box"><div class="r1" style="display:flex;gap:8px;align-items:center;flex-wrap:wrap"><b>' + esc(x.kind) + '</b><span class="tag ' + (FB_CLS[x.status] || '') + '">' + esc(x.status) + '</span><span class="small muted">' + fDateTime(x.time) + ' · ' + esc(x.by) + '</span></div>' +
      '<p class="pre" style="margin:8px 0">' + esc(x.text) + '</p><p class="small muted" style="margin:0">📍 ' + esc(x.route) + ' · ' + esc(x.ver) + '</p>' + (x.imgNote ? '<p class="small err">' + esc(x.imgNote) + '</p>' : '') + '</div>' +
      (x.imgs.length ? '<div class="box fb-full">' + x.imgs.map(function (f, i) { return '<div class="fb-ph" data-fbimg="' + i + '">Đang tải ảnh ' + (i + 1) + '…</div>'; }).join('') + '</div>' : '') +
      (mgr ? '<div class="box"><h3>Xử lý</h3><label class="f"><span>Trạng thái</span><select id="fbSt">' + statuses.map(function (s0) { return '<option' + (s0 === x.status ? ' selected' : '') + '>' + s0 + '</option>'; }).join('') + '</select></label>' +
        '<label class="f"><span>Trả lời người góp ý (gửi qua Telegram riêng của họ)</span><textarea id="fbReply" rows="3">' + esc(x.reply) + '</textarea></label><p class="small muted" style="margin:0">' + (x.handler ? 'Cập nhật bởi ' + esc(x.handler) + ' lúc ' + fDateTime(x.updated) : '') + '</p></div>'
        : (x.reply ? '<div class="box"><h3>💬 Phản hồi</h3><p class="pre" style="margin:0">' + esc(x.reply) + '</p><p class="small muted" style="margin:6px 0 0">' + esc(x.handler) + '</p></div>' : ''));
    var m = modal('💡 Góp ý ' + esc(x.id), body, '<button class="btn" data-back>← Danh sách</button>' + (mgr ? '<button class="btn pri" id="fbSave">Lưu</button>' : ''));
    $('[data-back]', m).onclick = function () { closeModal(true); openFeedback('list'); };
    $$('[data-fbimg]', m).forEach(function (ph) { api('fb_img', { id: x.id, i: +ph.getAttribute('data-fbimg') }).then(function (j) { ph.outerHTML = '<a href="' + j.src + '" target="_blank" rel="noopener"><img src="' + j.src + '" alt="Ảnh góp ý"></a>'; }, function (e) { ph.textContent = e.message; }); });
    if (mgr) $('#fbSave', m).onclick = function () {
      var b = this; b.disabled = true;
      api('fb_update', { id: x.id, status: $('#fbSt', m).value, reply: $('#fbReply', m).value.trim() }).then(function () { toast('Đã lưu ✓'); closeModal(true); openFeedback('list'); }, function (e) { toast(e.message, true); b.disabled = false; });
    };
  }

  /* ================================================================ ĐƠN HÀNG */
  /* ---------- tab Đơn hàng: mặc định "Cần xử lý" (đơn cần làm trước), dòng gọn với 1 nút đúng việc tiếp theo */
  var SHIP_LATE = 5; // đang giao quá 5 ngày → gọi giục để tránh hoàn
  /** Số ngày đơn đã đi đường: tính từ ngày gửi (cột “Ngày gửi”, tự ghi khi chuyển Đang giao / nhập mã vận đơn); đơn cũ chưa có thì tính từ ngày đặt. */
  function shipDays(o) { return daysSince(o.shipAt || o.time); }
  // Mã trạng thái Viettel Post (máy chủ tự ghi từ tin báo của Viettel Post) cần gọi khách ngay: chuyển hoàn, khách vắng, hẹn ra bưu cục…
  var VTP_WARN = { 502: 1, 503: 1, 505: 1, 506: 1, 507: 1, 515: 1 };
  function trkWarn(o) { return o.status === 'Đang giao' && !!VTP_WARN[o.trkCode]; }
  /** Dòng hành trình mới nhất từ hãng vận chuyển (chỉ có khi máy chủ nhận được tin báo của hãng). */
  function trkLine(o) {
    if (!o.trk || !(/^(Mới|Đã xác nhận|Đang giao)$/.test(o.status) || /hoàn/i.test(o.status))) return '';
    return '<div class="trkl' + (trkWarn(o) ? ' bad' : '') + '" title="Viettel Post tự báo – cập nhật ' + esc(o.trkAt ? fDate(o.trkAt) : '') + '">' + (trkWarn(o) ? '⚠️ ' : '📦 ') + esc(o.trk) + '</div>';
  }
  function orderTodo() {
    var t0 = today(), d = function (o) { return daysSince(o.time); };
    var G = [
      { k: 'new', t: '🆕 Chờ xác nhận', tip: lvl() >= 2 ? 'gọi khách xác nhận đơn · chọn “Giao cho…” để giao nhân sự' : 'đơn quản lý giao cho bạn – gọi khách xác nhận', f: function (o) { return o.status === 'Mới' && newOrderSeen(o); } },
      { k: 'pack', t: '📦 Chờ gửi hàng', tip: 'đã xác nhận, chưa có mã vận đơn – đóng hàng, nhập mã vận đơn', f: function (o) { return o.status === 'Đã xác nhận' && !o.tracking; } },
      { k: 'fail', t: '📵 Giao chưa được', tip: 'Viettel Post báo khách vắng / hẹn ra bưu cục / sắp hoàn – gọi khách ngay để giữ đơn', f: trkWarn },
      { k: 'late', t: '🚚 Giao lâu chưa tới', tip: 'đang giao quá ' + SHIP_LATE + ' ngày – gọi hỏi khách, giục bưu cục để tránh hoàn', f: function (o) { return o.status === 'Đang giao' && shipDays(o) > SHIP_LATE && !trkWarn(o); } },
      { k: 'pay', t: '💳 Chưa nhận tiền', tip: 'chuyển khoản chưa thấy tiền về – kiểm tra tài khoản VCB', f: function (o) { return isBank(o) && !o.paid && !isVoid(o.status) && o.status !== 'Mới'; } },
      { k: 'otype', t: '⚠️ Kiểm tra loại đơn', tip: 'sale chọn loại đơn khác gợi ý của CRM – mở đơn, bấm ✓ Đúng hoặc đổi loại để tính hoa hồng đúng', f: function (o) { return lvl() >= 2 && !!o.oflag; } },
      { k: 'back', t: '↩ Hoàn gần đây', tip: 'đơn hoàn (đặt trong 3 tuần) – gọi hỏi lý do, giữ khách', f: function (o) { return /hoàn/i.test(o.status) && d(o) <= 21; } }
    ];
    G.forEach(function (g) { g.list = S.d.orders.filter(g.f).sort(function (a, b) { return a.time - b.time; }); });
    return G;
  }
  /** Ghi chú giao hàng cần làm đúng (giờ giao, gọi trước, cho xem hàng…) → hiện nổi bật trên dòng đơn. */
  var KEY_NOTE = /gio hanh chinh|goi truoc|alo truoc|hen giao|giao (vao |buoi |sau |truoc |gap|nhanh|cuoi tuan|thu \d|chu nhat|sang|chieu|toi)|(khong|ko|k) (giao|nhan|cho xem|xem hang|goi)|cho xem hang|dong kiem|kiem hang|cuoi tuan|truoc \d+ ?h|sau \d+ ?h|gui (tai|o|qua)|nhan (tai|o)|de (o|tai)|bao ve|le tan|hoa toc/;
  function keyNote(o) { return !!o.note && KEY_NOTE.test(norm(o.note)) && !isVoid(o.status) && o.status !== 'Đã giao'; }
  /** Mã vận đơn bấm được: copy mã + mở trang tra cứu của hãng. */
  function trackLink(o) {
    if (!o.tracking) return '';
    var c = carrierOf(o), u = CARRIERS[c] || '', t = esc(c) + ' ' + esc(o.tracking);
    return u ? '<a class="trk" href="' + esc(u.replace('{c}', encodeURIComponent(o.tracking))) + '" target="_blank" rel="noopener" data-trk="' + esc(o.tracking) + '" title="Bấm để tra cứu (mã đã được copy sẵn)">🚚 ' + t + ' ↗</a>'
      : '<button type="button" class="trk link" data-trk="' + esc(o.tracking) + '" title="Bấm để copy mã vận đơn">🚚 ' + t + ' 📋</button>';
  }
  function orderRow(o) {
    var oc = orderCat(o), next = NEXT[o.status], dd = shipDays(o), shipping = o.status === 'Đang giao', pv = provOf(o), oc0 = cust(o.phone) || {}, backWarn = oc0.backN && !isVoid(o.status) && o.status !== 'Đã giao', kn = keyNote(o);
    var act = o.status === 'Đã xác nhận' && !o.tracking ? '<button class="btn pri" data-order="' + esc(o.id) + '" title="Mở đơn để nhập mã vận đơn">📦 Nhập mã VĐ</button>' : next ? '<button class="btn pri" data-next="' + esc(o.id) + '">' + NEXT_LABEL[o.status] + '</button>' : '';
    return '<div class="rw orw click tinted" data-order="' + esc(o.id) + '"' + catAttr(oc) + '><div class="rw-m">' +
      '<div class="rw-1"><b>' + esc(o.name) + '</b>' + stTag(o.status) + (shipping ? '<span class="tag ' + (dd > SHIP_LATE ? 'st-late' : 'st-giao') + '" title="' + (o.shipAt ? 'Đã gửi ' + dd + ' ngày (gửi ngày ' + fDate(o.shipAt).slice(0, 5) + ')' : 'Tính từ ngày đặt ' + fDate(o.time).slice(0, 5) + ' (đơn này chưa ghi ngày gửi)') + '">🚚 ' + dd + ' ngày' + (dd > SHIP_LATE ? ' ⚠️' : '') + '</span>' : '') + (oc.key !== 'void' ? catChip(oc) : '') + (backWarn ? '<span class="tag st-back" title="' + esc('Khách này đã hoàn ' + oc0.backN + ' đơn' + (oc0.lastBack ? ', gần nhất ' + fDate(oc0.lastBack) : '') + '. Gọi xác nhận kỹ trước khi gửi; đơn lớn nên nhờ chuyển khoản trước.') + '">⚠️ đã hoàn ' + oc0.backN + ' lần</span>' : '') + '<span class="end">' + (shipping && !isBank(o) ? '<small class="muted">thu hộ </small>' : '') + money(o.total) + '</span></div>' +
      '<div class="rw-2">' + (pv ? '<b class="prov">📍 ' + esc(pv.old) + '</b> · ' : '') + when(o.time) + ' · ' + esc(o.payment) + (isBank(o) && !isVoid(o.status) ? (o.paid ? ' ✓' : ' <span class="warn-line">chưa nhận tiền</span>') : '') + ' · ' + esc(itemNames(o.items).join(', ')) + '</div>' +
      trkLine(o) + (kn ? '<div class="keynote">📌 ' + esc(o.note.length > 140 ? o.note.slice(0, 140) + '…' : o.note) + '</div>' : '') +
      '<div class="rw-3">' + (o.oflag ? '<span class="tag st-late" title="' + esc(o.oflag) + '">⚠️ Kiểm tra loại đơn</span> ' : '') + (o.tracking ? trackLink(o) + ' · ' : carrierOf(o) ? '<span class="muted">🚚 ' + esc(carrierOf(o)) + '</span> · ' : '') + '<span class="muted">' + cp(o.id) + ' · ' + (isWebOrder(o) ? '<span class="tag st-giao" title="' + esc('Khách tự đặt trên website · nguồn: ' + (o.source || 'Truy cập trực tiếp')) + '">🌐 Web · ' + esc(webSrc(o)) + '</span>' : esc(otLabel(otypeOf(o)))) + '</span>' + (o.seller && (lvl() >= 2 || o.seller !== S.user.name) ? ' · 👤 ' + esc(o.seller) : '') + (o.note && !kn ? ' · 📝 ' + esc(o.note.length > 60 ? o.note.slice(0, 60) + '…' : o.note) : '') + '</div></div>' +
      '<div class="rw-a">' + (lvl() >= 2 && o.status === 'Mới' ? oAssignSel(o) : '') + act + '<a class="btn" href="tel:' + o.phone + '" aria-label="Gọi">📞<small>Gọi</small></a></div></div>';
  }
  /** Quản lý: giao đơn mới cho nhân sự (ghi vào NV bán) – nhân sự đó mới thấy đơn ở Hôm nay. */
  function oAssignSel(o) {
    var names = userNames(); if (o.seller && names.indexOf(o.seller) < 0) names.push(o.seller);
    return '<select class="assign" data-oassign="' + esc(o.id) + '" title="Giao đơn cho nhân sự gọi xác nhận"><option value="">' + (o.seller ? 'Bỏ giao' : 'Giao cho…') + '</option>' +
      names.map(function (n) { return '<option' + (n === o.seller ? ' selected' : '') + '>' + esc(n) + '</option>'; }).join('') + '</select>';
  }
  function renderOrdersBody(f, OS, q, qd) {
    if (f.tab === 'todo') {
      var G = orderTodo(); if (lvl() >= 2 && S.who) G.forEach(function (g) { g.list = g.list.filter(function (o) { return whoOk(orderOwner(o)); }); });
      var any = false, h = '';
      G.forEach(function (g) {
        if (!g.list.length) return; any = true;
        h += '<details class="grp" data-grp="o-' + g.k + '"' + (!S.f.gopen || S.f.gopen['o-' + g.k] !== false ? ' open' : '') + '><summary><span class="g-t">' + g.t + '</span><span class="count">' + g.list.length + '</span><span class="g-tip">' + g.tip + '</span></summary><div class="rows">' + g.list.slice(0, 50).map(orderRow).join('') + (g.list.length > 50 ? '<p class="small muted" style="padding:8px 12px">… và ' + (g.list.length - 50) + ' đơn khác (xem ở Tất cả đơn)</p>' : '') + '</div></details>';
      });
      if (!any) h += empty('🎉 Không có đơn nào cần xử lý. Xem lịch sử ở “Tất cả đơn”.');
      return h;
    }
    var RG = perRange(f.p);
    var base = OS.filter(function (o) { return o.time >= RG[0] && o.time < RG[1] && (!q || (o._q || norm(o.name + ' ' + o.id + ' ' + o.items + ' ' + o.province + ' ' + o.source + ' ' + o.tracking)).indexOf(q) >= 0 || (qd.length >= 3 && (o._phoneDigits || o.phone).indexOf(qd) >= 0)); }).sort(function (a, b) { return b.time - a.time; });
    var chN = { web: 0, sale: 0 }; base.forEach(function (o) { chN[isWebOrder(o) ? 'web' : 'sale']++; });
    if (f.ch) base = base.filter(function (o) { return isWebOrder(o) === (f.ch === 'web'); });
    var list = f.st === 'all' ? base : base.filter(function (o) { return o.status === f.st; });
    var sum = list.filter(function (o) { return !isVoid(o.status); }).reduce(function (s0, o) { return s0 + o.total; }, 0);
    return perChips('o', f.p, ['all'], true) +
      '<div class="chips">' + [['', 'Mọi kênh', chN.web + chN.sale], ['web', '🌐 Khách tự đặt trên web', chN.web], ['sale', '💬 Sale lên đơn', chN.sale]].map(function (c) { return '<button class="chip' + ((f.ch || '') === c[0] ? ' on' : '') + '" data-och="' + c[0] + '">' + c[1] + ' <em>' + c[2] + '</em></button>'; }).join('') + '</div>' +
      '<div class="chips">' + ['all'].concat(STATUS).map(function (s0) { var n = s0 === 'all' ? base.length : base.filter(function (o) { return o.status === s0; }).length; return n || s0 === 'all' || f.st === s0 ? '<button class="chip' + (f.st === s0 ? ' on' : '') + '" data-os="' + esc(s0) + '">' + (s0 === 'all' ? 'Tất cả' : s0) + ' <em>' + n + '</em></button>' : ''; }).join('') + '</div>' +
      '<p class="small muted" style="margin:0 0 8px">' + list.length + ' đơn' + ' · ' + money(sum) + ' (không tính huỷ / hoàn)' + '</p>' +
      (list.length ? '<div class="crows">' + list.slice(0, f.n).map(orderRow).join('') + '</div>' +
        (list.length > f.n ? '<button class="btn more" data-more="o">Xem thêm ' + Math.min(60, list.length - f.n) + ' đơn</button>' : '') : f.q && f.q.trim() ? searchEmpty('đơn', f.q.trim()) : empty('Không có đơn nào.'));
  }
  function renderOrdersPart(appendOnly) {
    var oBody = $('#oBody');
    if (!oBody) { render(); return; }
    var f = S.f.o || (S.f.o = { q: '', st: 'all', n: 60, tab: 'todo', p: { k: 'all' } });
    if (!f.tab) f.tab = 'todo'; if (!f.p) f.p = { k: 'all' };
    var q = norm(f.q), qd = q.replace(/\D/g, '');
    var OS = ordersSeen();

    if (appendOnly && f.tab === 'all') {
      var RG = perRange(f.p);
      var base = OS.filter(function (o) { return o.time >= RG[0] && o.time < RG[1] && (!q || (o._q || norm(o.name + ' ' + o.id + ' ' + o.items + ' ' + o.province + ' ' + o.source + ' ' + o.tracking)).indexOf(q) >= 0 || (qd.length >= 3 && (o._phoneDigits || o.phone).indexOf(qd) >= 0)); }).sort(function (a, b) { return b.time - a.time; });
      if (f.ch) base = base.filter(function (o) { return isWebOrder(o) === (f.ch === 'web'); });
      var list = f.st === 'all' ? base : base.filter(function (o) { return o.status === f.st; });
      var crows = $('.crows', oBody);
      var prevN = f.n - 60;
      var nextSlice = list.slice(prevN, f.n);
      if (crows && nextSlice.length) crows.insertAdjacentHTML('beforeend', nextSlice.map(orderRow).join(''));
      var btnMore = $('[data-more=o]', oBody);
      if (btnMore) {
        if (list.length > f.n) btnMore.textContent = 'Xem thêm ' + Math.min(60, list.length - f.n) + ' đơn';
        else btnMore.remove();
      }
      return;
    }

    oBody.innerHTML = renderOrdersBody(f, OS, q, qd);
    var oTabs = $('#oTabs');
    if (oTabs) {
      var G = orderTodo(); if (lvl() >= 2 && S.who) G.forEach(function (g) { g.list = g.list.filter(function (o) { return whoOk(orderOwner(o)); }); });
      var todoN = G.reduce(function (s0, g) { return s0 + g.list.length; }, 0);
      oTabs.innerHTML = '<button data-otab="todo" class="' + (f.tab === 'todo' ? 'on' : '') + '">⚡ Cần xử lý' + (todoN ? ' (' + todoN + ')' : '') + '</button><button data-otab="all" class="' + (f.tab === 'all' ? 'on' : '') + '">📋 Tất cả đơn</button>';
    }
  }
  function viewOrders() {
    var f = S.f.o || (S.f.o = { q: '', st: 'all', n: 60, tab: 'todo', p: { k: 'all' } });
    if (!f.tab) f.tab = 'todo'; if (!f.p) f.p = { k: 'all' };
    var q = norm(f.q), qd = q.replace(/\D/g, ''), t0 = today();
    if (q && f.tab === 'todo') f.tab = 'all'; // đang tìm → xem trong tất cả đơn
    var OS = ordersSeen();
    var mR = monthRange(monthOf(Date.now())), todayOs = OS.filter(function (o) { return o.time >= t0 && !isVoid(o.status); }), monthOs = OS.filter(function (o) { return o.time >= mR[0] && o.time < mR[1] && o.status !== 'Huỷ'; });
    var backM = monthOs.filter(function (o) { return /hoàn/i.test(o.status); }).length, shipOs = OS.filter(function (o) { return o.status === 'Đang giao'; }), shipping = shipOs.length, codOut = shipOs.reduce(function (s0, o) { return s0 + (isBank(o) ? 0 : o.total); }, 0);
    var h = '<div class="page-head"><h1>Đơn hàng</h1><div class="grow"></div>' + whoSel() + '<button class="btn pri" data-neworder="">＋ Tạo đơn (Zalo, điện thoại…)</button></div>' +
      '<div class="minis" id="oMinis">' + mini('🧾 Đơn hôm nay', todayOs.length, '', '') + mini('💰 Doanh số hôm nay', moneyShort(todayOs.reduce(function (s0, o) { return s0 + o.total; }, 0)), '', 'good') + mini('🚚 Đang giao', shipping + (codOut ? '<small class="mini-sub" title="Tiền COD bưu cục đang giữ của các đơn đang giao">thu hộ ' + moneyShort(codOut) + '</small>' : ''), '', '') + mini('↩ Hoàn tháng này', monthOs.length ? pct(backM, monthOs.length) + '%' : '–', '', backM ? 'bad' : '') + '</div>' +
      '<div class="tools"><div class="search">' + I.search + '<input type="search" id="oq" placeholder="Tìm tên, SĐT, mã đơn, sản phẩm…" value="' + esc(f.q) + '"><button type="button" class="search-x" aria-label="Xoá chữ tìm kiếm" title="Xoá">✕</button></div></div>';
    var G = orderTodo(); if (lvl() >= 2 && S.who) G.forEach(function (g) { g.list = g.list.filter(function (o) { return whoOk(orderOwner(o)); }); });
    var todoN = G.reduce(function (s0, g) { return s0 + g.list.length; }, 0);
    h += '<div class="tabs" id="oTabs" style="max-width:420px"><button data-otab="todo" class="' + (f.tab === 'todo' ? 'on' : '') + '">⚡ Cần xử lý' + (todoN ? ' (' + todoN + ')' : '') + '</button><button data-otab="all" class="' + (f.tab === 'all' ? 'on' : '') + '">📋 Tất cả đơn</button></div>' + colorKey(true) +
      '<div id="oBody">' + renderOrdersBody(f, OS, q, qd) + '</div>';
    return h;
  }
  function findOrder(id) {
    if (!S.d) return null;
    if (S.d.orderById) return S.d.orderById[id] || null;
    return S.d.orders.filter(function (o) { return o.id === id; })[0];
  }
  function openOrder(id, fromRoute) {
    var o = findOrder(id); if (!o) return;
    if (!fromRoute) history.pushState(null, '', '#don-hang/' + encodeURIComponent(o.id));
    var c = cust(o.phone), logs = logOf(o.id);
    var body = '<div class="acts steps" style="margin-bottom:12px"><a class="btn" href="tel:' + o.phone + '">📞 Gọi</a><a class="btn zalo" href="' + zalo(o.phone) + '" target="_blank" rel="noopener">Zalo</a>' +
      (c ? '<button class="btn" data-cust="' + c.phone + '">👤 Xem khách (' + c.orders + ' đơn)</button>' : '') + '<button class="btn" id="oCopy">📋 Copy thông tin giao hàng</button><button class="btn" id="oEdit">✏️ Sửa đơn</button></div>' +
      (o.oflag ? '<div class="notice" id="oOtBox">⚠️ <b>Kiểm tra loại đơn:</b> sale chọn <b>' + esc(otLabel(otypeOf(o))) + '</b>. ' + esc(o.oflag) + '.' + (lvl() >= 2 ? '<div class="steps" style="margin-top:8px"><button class="btn pri" id="oOtOk">✓ Đúng, giữ ' + esc(otypeOf(o)) + '</button>' + OTYPES.filter(function (t) { return t !== otypeOf(o); }).map(function (t) { return '<button class="btn" data-otset="' + esc(t) + '">Đổi sang ' + esc(otLabel(t)) + '</button>'; }).join('') + '</div>' : '<br>Quản lý sẽ kiểm tra lại.') + '</div>' : '') +
      '<div class="box"><h3>Trạng thái</h3>' + (NEXT[o.status] ? '<p class="next-hint">👉 Bước tiếp theo: bấm <b>' + NEXT[o.status] + '</b>' + { 'Mới': ' sau khi gọi khách xác nhận đơn.', 'Đã xác nhận': ' khi đã gửi hàng (hoặc nhập mã vận đơn bên dưới).', 'Đang giao': ' khi khách đã nhận hàng.' }[o.status] + '</p>' : '') + '<div class="radios">' + STATUS.map(function (s) { return '<label><input type="radio" name="oSt" value="' + s + '"' + (s === o.status ? ' checked' : '') + '><span>' + s + '</span></label>'; }).join('') + '</div></div>' +
      '<div class="box"><div class="grid-info">' + info('Khách', o.name, false, true) + info('Điện thoại', fPhone(o.phone), false, normPhone(o.phone)) + info('Thời gian', fDateTime(o.time) + ' ' + vnDate(o.time).y) + info('Thanh toán', o.payment) +
      info('Địa chỉ', fullAddr(o), true, true) + (o.addrOld ? info('Địa chỉ cũ (Misa)', o.addrOld, true, true) : '') + (o.email ? info('Email', o.email, true, true) : '') + info('Nguồn', o.source || '–', true) + '</div>' +
      (lvl() >= 2 ? '<label class="f" style="margin:10px 0 0"><span>Nhân viên bán (tính doanh số)</span><select id="oSeller">' + ownerOptions(o.seller, true) + '</select></label>' : '<p class="small muted" style="margin:8px 0 0">Nhân viên bán: <b>' + esc(o.seller || '–') + '</b></p>') + '</div>' +
      '<div class="box"><h3>Sản phẩm</h3><div class="pre">' + cp(o.items) + '</div>' +
      (o.ship ? '<p style="margin:10px 0 0"><b>Lên đơn:</b> ' + esc(o.ship) + ' <button class="btn ghost" id="oShipCopy" type="button">📋 Copy</button></p>' : '') +
      '<p class="small muted" style="margin:6px 0 0">Loại đơn: <b>' + esc(otLabel(otypeOf(o))) + '</b> · Dòng SP: <b>' + esc(o.line || '–') + '</b> · Nguồn: ' + esc(o.source || '–') + '</p><div class="sum" style="margin-top:10px"><div><span>Tạm tính</span><b>' + money(o.subtotal) + '</b></div><div><span>Phí ship</span><b>' + (o.shipping ? money(o.shipping) : 'Miễn phí') + '</b></div><div class="total"><span>Tổng</span><b>' + cpMoney(o.total) + '</b></div></div></div>' +
      '<div class="box"><h3>Thanh toán: ' + esc(o.payment) + ' ' + paidTag(o) + '</h3>' + (isBank(o)
        ? (o.paid ? '<p class="hint" style="margin:0 0 8px">✓ ' + esc(o.paid) + '</p><button class="btn ghost" id="oPaid">↩ Bỏ đánh dấu đã nhận tiền</button>'
          : '<p class="hint" style="margin:0 0 8px">Mở tài khoản VCB, thấy tiền về (nội dung có mã <b>' + cp(o.id) + '</b>, đúng ' + cpMoney(o.total) + ') thì mới bấm.</p><button class="btn pri" id="oPaid">💳 Xác nhận đã nhận tiền</button>')
        : '<p class="muted" style="margin:0">Khách trả tiền khi nhận hàng (COD).</p>') + '</div>' +
      '<div class="box"><h3>Vận chuyển</h3><div class="row2c"><label class="f"><span>Đơn vị vận chuyển</span><select id="oCarrier"><option value="">– Chọn –</option>' +
      Object.keys(CARRIERS).map(function (k) { return '<option' + (k === carrierOf(o) ? ' selected' : '') + '>' + esc(k) + '</option>'; }).join('') + '</select></label>' +
      '<label class="f"><span>Mã vận đơn</span><input type="text" id="oTrack" value="' + esc(o.tracking) + '" autocomplete="off"></label></div>' +
      (o.trk ? trkLine(o).replace('class="trkl', 'class="trkl full') || '<div class="trkl full">📦 ' + esc(o.trk) + '</div>' : '') +
      '<div class="steps"><button class="btn" id="oTrackSave">Lưu vận đơn</button>' + (o.tracking ? '<button class="btn" id="oTrackGo">🔎 Tra cứu hành trình</button>' : '') + '</div>' +
      (o.tracking ? '' : '<p class="hint" style="margin:8px 0 0">Nhập mã vận đơn xong, đơn tự chuyển sang “Đang giao”.' + (carrierOf(o) === 'Viettel Post' ? ' Mã đơn ' + esc(o.id) + ' là mã của sale, không tra cứu được trên Viettel Post – cần mã vận đơn Viettel Post cấp (in trên phiếu gửi). Khi tạo đơn trên Viettel Post có ghi mã đơn này vào ô mã đơn hàng riêng / tham chiếu thì CRM tự điền mã vận đơn.' : '') + '</p>') + '</div>' +
      '<div class="box"><label class="f" style="margin:0"><span>Ghi chú đơn</span><textarea id="oNote" rows="2">' + esc(o.note) + '</textarea></label><button class="btn" id="oNoteSave" style="margin-top:8px">Lưu ghi chú</button></div>' +
      (logs.length ? '<div class="box"><h3>Lịch sử</h3><div class="timeline">' + logs.map(logItem).join('') + '</div></div>' : '') +
      (lvl() >= 3 ? '<div class="box"><h3>Xoá đơn (chỉ Quản trị)</h3><p class="small muted" style="margin:0 0 8px">Dùng cho đơn nhập thử / nhập nhầm. Xoá là mất hẳn đơn và lịch sử của đơn, không khôi phục được. Đơn khách huỷ thật thì chọn trạng thái “Huỷ”, đừng xoá.</p><button class="btn danger" id="oDel">🗑 Xoá đơn này</button></div>' : '');
    var m = modal('Đơn ' + cp(o.id) + ' ' + stTag(o.status), body, null, { route: '#don-hang', pushed: !fromRoute });
    if ($('#oDel', m)) $('#oDel', m).onclick = function () { adminDelete('o', o, 'đơn ' + o.id + ' (' + (o.name || o.phone) + ', ' + money(o.total) + ')', this); };
    $$('input[name=oSt]', m).forEach(function (r) { r.onchange = function () { setStatus(o, r.value, function () { closeModal(); }); }; });
    $('#oCopy', m).onclick = function () {
      copy(o.name + ' – ' + o.phone + '\n' + [o.address, o.ward, o.province].filter(Boolean).join(', ') + '\n' + o.items + '\nTổng: ' + money(o.total) + ' (' + o.payment + ')' + (o.note ? '\nGhi chú: ' + o.note : '')).then(function () { toast('Đã copy'); });
    };
    $('#oEdit', m).onclick = function () { openOrderForm({ order: o }); };
    if ($('#oOtBox', m)) $('#oOtBox', m).addEventListener('click', function (e) {
      var b = e.target.closest('#oOtOk,[data-otset]'); if (!b) return; var to = b.getAttribute('data-otset'); b.disabled = true;
      api('order_status', to ? { id: o.id, row: o.row, otype: to } : { id: o.id, row: o.row, otypeOk: 1 }).then(function () {
        if (to) { o.otype = to; o.ca = to === 'Ngày lễ' ? 'Lễ' : to === 'Ngoài giờ' ? 'Tối/CN' : 'Ngày'; } else if (!o.otype) o.otype = otypeOf(o);
        o.oflag = ''; toast(to ? 'Đã đổi loại đơn: ' + to : 'Đã xác nhận loại đơn ✓'); closeModal(true); openOrder(o.id, true); navBadges(); render();
      }, function (er) { toast(er.message, true); b.disabled = false; });
    });
    if ($('#oShipCopy', m)) $('#oShipCopy', m).onclick = function () { copy(o.name + ' – ' + o.phone + '\n' + [o.address, o.ward, o.province].filter(Boolean).join(', ') + '\n' + o.ship + '\nThu: ' + money(o.total) + (isBank(o) ? ' (chuyển khoản)' : ' (COD)')).then(function () { toast('Đã copy nội dung lên đơn'); }); };
    if ($('#oSeller', m)) $('#oSeller', m).onchange = function () { assignOrder(o, this.value, this); };
    if ($('#oPaid', m)) $('#oPaid', m).onclick = function () {
      var paid = !o.paid, oldPaid = o.paid;
      o.paid = paid ? 'Có – ' + S.user.name + ' ' + fDateTime(Date.now()) : '';
      addLog({ loc: 1, time: Date.now(), by: S.user.name, what: 'Đơn hàng', ref: o.id, name: o.name, result: paid ? 'Đã nhận tiền chuyển khoản' : 'Bỏ đánh dấu đã nhận tiền', note: '' });
      toast(paid ? 'Đã ghi nhận tiền ✓' : 'Đã bỏ đánh dấu ✓'); closeModal(true); openOrder(o.id, true); render();
      api('order_status', { id: o.id, row: o.row, paid: paid }).catch(function (e) {
        o.paid = oldPaid; toast(e.message, true); render();
      });
    };
    $('#oTrack', m).oninput = function () { var g = guessCarrier(this.value); if (g && !$('#oCarrier', m).value) $('#oCarrier', m).value = g; };
    $('#oTrackSave', m).onclick = function () {
      var carrier = $('#oCarrier', m).value || guessCarrier($('#oTrack', m).value), code = $('#oTrack', m).value.trim();
      if (code && !carrier) { toast('Chọn đơn vị vận chuyển giúp em nhé', true); return; }
      var oldCarrier = o.carrier, oldTracking = o.tracking, oldStatus = o.status;
      o.carrier = carrier; o.tracking = code;
      if (code && (o.status === 'Mới' || o.status === 'Đã xác nhận')) o.status = 'Đang giao';
      toast('Đã lưu vận đơn' + (o.status === 'Đang giao' ? ' – đơn chuyển sang Đang giao' : '') + ' ✓');
      closeModal(true); openOrder(o.id, true); navBadges(); render();
      api('order_status', { id: o.id, row: o.row, carrier: carrier, tracking: code }).then(function (j) {
        if (j && j.status) o.status = j.status;
      }, function (e) {
        o.carrier = oldCarrier; o.tracking = oldTracking; o.status = oldStatus;
        toast(e.message, true); navBadges(); render();
      });
    };
    if ($('#oTrackGo', m)) $('#oTrackGo', m).onclick = function () {
      var u = CARRIERS[carrierOf(o)] || ''; copy(o.tracking);
      if (!u) { toast('Đã copy mã vận đơn ' + o.tracking); return; }
      toast('Đã copy mã ' + o.tracking + (u.indexOf('{c}') < 0 ? ' – dán vào ô tra cứu' : '')); window.open(u.replace('{c}', encodeURIComponent(o.tracking)), '_blank', 'noopener');
    };
    $('#oNoteSave', m).onclick = function () {
      var note = $('#oNote', m).value.trim(), oldNote = o.note;
      o.note = note; toast('Đã lưu ghi chú ✓'); render();
      api('order_status', { id: o.id, row: o.row, note: note }).catch(function (e) {
        o.note = oldNote; toast(e.message, true); render();
      });
    };
  }
  function setStatus(o, st, done) {
    if (st === o.status) return;
    var reason = '';
    if (st === 'Huỷ' || st === 'Hoàn' || st === 'Đổi hàng') { reason = prompt('Lý do ' + st.toLowerCase() + ' đơn ' + o.id + '? (không bắt buộc)', ''); if (reason === null) { render(); var r = $('input[name=oSt][value="' + o.status + '"]'); if (r) r.checked = true; return; } }
    var old = o.status; o.status = st; if (st === 'Đang giao' && !o.shipAt) o.shipAt = Date.now(); navBadges(); render(); if (done) done();
    api('order_status', { id: o.id, row: o.row, status: st, reason: reason }).then(function (j) {
      if (j.row) o.row = j.row;
      addLog({ loc: 1, time: Date.now(), by: S.user.name, what: 'Đơn hàng', ref: o.id, name: o.name, result: old + ' → ' + st, note: reason || '' });
      toast('Đơn ' + o.id + ': ' + st);
      if (isVoid(old) !== isVoid(st)) load(true); else render();
    }, function (e) { o.status = old; navBadges(); render(); toast(e.message, true); });
  }

  /* ---------- tạo / sửa đơn (giống sheet VTG_lendon: SĐT, tên, địa chỉ 1 dòng, sản phẩm, quà tặng, số tiền, ca) */
  function productOptions() {
    var o = []; (CFG.products || []).forEach(function (p) {
      if (p.variants && p.variants.length) p.variants.forEach(function (v) { o.push({ name: p.name, variant: v.name, price: v.price }); });
      else o.push({ name: p.name, variant: p.unit || '', price: p.price });
    });
    o.forEach(function (p) { p.label = p.name + (p.variant ? ' – ' + p.variant : ''); });
    return o;
  }
  /** Tên sản phẩm đã từng bán (lấy từ đơn cũ) để gợi ý khi gõ. */
  function soldNames() {
    if (S.d._sold) return S.d._sold;
    var cnt = {};
    S.d.orders.forEach(function (o) { parseItems(o.items).forEach(function (i) { var n = i.name + (i.variant ? ' – ' + i.variant : ''); cnt[n] = (cnt[n] || 0) + 1; }); });
    return (S.d._sold = Object.keys(cnt).sort(function (a, b) { return cnt[b] - cnt[a]; }).slice(0, 80));
  }
  function loadUnits() {
    if (S.units) return Promise.resolve(S.units);
    return fetch('/vn-units.json').then(function (r) { return r.json(); }).then(function (u) { S.units = u; return u; }).catch(function () { return []; });
  }
  /** Đọc lại dòng sản phẩm đã lưu: "Tên (quy cách) x2 = 280.000 ₫", dòng quà bắt đầu bằng 🎁. */
  function parseItems(text) {
    return String(text || '').split('\n').map(function (l) {
      var gift = /^🎁\s*/.test(l); l = l.replace(/^🎁\s*/, '');
      var m = l.match(/^(.*?)(?: \((.*)\))? x(\d+) = ([\d.,]+)/); if (!m) return null;
      var q = +m[3], sub = +m[4].replace(/\D/g, ''); return { name: m[1], variant: m[2] || '', qty: q, price: q ? Math.round(sub / q) : 0, gift: gift };
    }).filter(Boolean);
  }
  /** Nhận ra tỉnh / phường trong địa chỉ dán 1 dòng. */
  var PROV_ALIAS = { 'hcm': 'Hồ Chí Minh', 'tphcm': 'Hồ Chí Minh', 'sai gon': 'Hồ Chí Minh', 'ha noi': 'Hà Nội', 'hn': 'Hà Nội' };
  function detectAddr(text) {
    var u = S.units || [], t = ' ' + norm(text).replace(/[.,;\-–()]/g, ' ').replace(/\s+/g, ' ') + ' ', prov = null, ward = '';
    if (!String(text || '').trim()) return { province: '', ward: '' }; // địa chỉ trống: không đoán tỉnh
    u.forEach(function (p) { [p.n, p.f].forEach(function (nm) { if (!nm) return; var k = ' ' + norm(nm) + ' '; if (t.indexOf(k) >= 0 && (!prov || nm.length > prov._len)) { prov = p; prov._len = nm.length; } }); });
    if (!prov) Object.keys(PROV_ALIAS).forEach(function (k) { if (!prov && t.indexOf(' ' + k + ' ') >= 0) prov = u.filter(function (p) { return p.n === PROV_ALIAS[k]; })[0] || null; });
    if (!prov) { var pv = provOf({ address: text }); if (pv) prov = u.filter(function (p) { return p.n === pv.nw; })[0] || null; } // tên tỉnh cũ trước sáp nhập (Vĩnh Phúc → Phú Thọ…)
    var pool = prov ? [prov] : u, best = '';
    pool.forEach(function (p) {
      p.w.forEach(function (w) {
        var full = norm(w), bare = full.replace(/^(phuong|xa|dac khu|thi tran) /, '');
        var hit = t.indexOf(' ' + full + ' ') >= 0 || new RegExp(' (p|phuong|x|xa) ' + bare.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + ' ').test(t);
        if (hit && w.length > best.length) { best = w; if (!prov) prov = p; }
      });
    });
    return { province: prov ? prov.n : '', ward: best };
  }
  /* ---------- địa chỉ CŨ (63 tỉnh – huyện – xã, trước 01/07/2025) – Misa vẫn chọn theo địa chỉ cũ (anh Sơn 20/10/2026).
   *  /vn-units-old.json do scripts/vn-units-old.py tạo từ bảng chuyển đổi chính thức: mỗi xã cũ kèm (các) xã mới tương ứng. */
  function loadOldUnits() {
    if (S.unitsOld) return Promise.resolve(S.unitsOld);
    return fetch('/vn-units-old.json').then(function (r) { return r.json(); }).then(function (raw) { S.unitsOld = oldIndex(raw); return S.unitsOld; }).catch(function () { return null; });
  }
  function oldIndex(raw) {
    var rev = {}, P = raw.map(function (a) {
      var p = { n: a[0], f: a[1], nw: a[2] };
      p.d = a[3].map(function (b) {
        var d = { n: b[0], p: p };
        d.w = b[1].map(function (c) { var w = { n: c[0], d: d, nw: c[1] ? c[1].split('|') : [] }; w.nw.forEach(function (x) { (rev[p.nw + '|' + x] = rev[p.nw + '|' + x] || []).push(w); }); return w; });
        return d;
      });
      return p;
    });
    var alone = {}; P.forEach(function (p) { alone[p.n] = p.n !== p.nw; }); // tỉnh cũ đã gộp tên (Vĩnh Phúc…) – thấy là chắc chắn địa chỉ kiểu cũ
    return { p: P, rev: rev, alone: alone };
  }
  /** "Xã Thanh Vân, Huyện Tam Dương, Vĩnh Phúc" (đã lưu) → { w, d, p } của dữ liệu cũ; thiếu phần nào thì phần đó null. */
  function oldParse(OU, s) {
    var a = String(s || '').split(',').map(function (x) { return x.trim(); }).filter(Boolean), r = { p: null, d: null, w: null }; if (!OU || !a.length) return r;
    var pn = norm(a[a.length - 1]); r.p = OU.p.filter(function (p) { return norm(p.n) === pn || norm(p.f) === pn; })[0] || null; if (!r.p) return r;
    if (a.length >= 2) { var dn = norm(a[a.length - 2]); r.d = r.p.d.filter(function (d) { return norm(d.n) === dn; })[0] || null; }
    if (r.d && a.length >= 3) { var wn = norm(a[a.length - 3]); r.w = r.d.w.filter(function (w) { return norm(w.n) === wn; })[0] || null; }
    return r;
  }
  /** Tách địa chỉ cũ trong chữ khách ghi: "thôn Phú Thị, xã Thanh Vân, Tam Dương, Vĩnh Phúc" → tỉnh / huyện / xã cũ. Tỉnh lấy tên xuất hiện sau cùng. */
  function detectOld(OU, text) {
    var r = { p: null, d: null, w: null }; if (!OU || !String(text || '').trim()) return r;
    var t = ' ' + norm(text).replace(/[.,;:\-–()/]/g, ' ').replace(/\s+/g, ' ') + ' ', at = -1, AL = { hcm: 'Hồ Chí Minh', tphcm: 'Hồ Chí Minh', 'sai gon': 'Hồ Chí Minh', hn: 'Hà Nội', 'thua thien hue': 'Huế', brvt: 'Bà Rịa - Vũng Tàu', 'vung tau': 'Bà Rịa - Vũng Tàu', 'ba ria': 'Bà Rịa - Vũng Tàu' };
    var k2 = function (n) { return norm(n).replace(/[.,;:\-–()/]/g, ' ').replace(/\s+/g, ' ').trim(); }, bare = function (n) { return k2(n).replace(/^(tinh|thanh pho|quan|huyen|thi xa|phuong|xa|thi tran) /, ''); };
    OU.p.forEach(function (p) { [k2(p.f), bare(p.f)].concat(Object.keys(AL).filter(function (k) { return AL[k] === p.n; })).forEach(function (k) { var i = t.lastIndexOf(' ' + k + ' '); if (i > at) { at = i; r.p = p; } }); });
    var best = function (list, pre, bareOk) { // tên đầy đủ, hoặc chữ viết tắt + tên ("x thanh van", "h tam duong"), hoặc tên trơn khi đã biết vùng
      var hit = null, len = 0;
      list.forEach(function (o) {
        var b = bare(o.n), ok = t.indexOf(' ' + k2(o.n) + ' ') >= 0 || new RegExp(' (' + pre + ') ' + b.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + ' ').test(t) || (bareOk && t.indexOf(' ' + b + ' ') >= 0);
        if (ok && b.length > len) { hit = o; len = b.length; }
      });
      return hit;
    };
    if (r.p) r.d = best(r.p.d, 'q|quan|h|huyen|tx|thi xa|tp|thanh pho', true);
    var pool = r.d ? r.d.w : r.p ? [].concat.apply([], r.p.d.map(function (d) { return d.w; })) : [];
    r.w = best(pool, 'p|phuong|x|xa|tt|thi tran', !!r.d);
    if (r.w && !r.d) r.d = r.w.d;
    return r;
  }
  /** Ô gõ để tìm, không cần gõ dấu ("vinh phuc", "hoi thinh"): gợi ý ngay dưới ô, bấm hoặc Enter để chọn.
   *  items() → [{ v: giá trị điền vào ô, s: chữ phụ (mờ), k: chữ thêm để tìm, …dữ liệu riêng }]; onPick(item) khi chọn. */
  function addrPick(inp, items, onPick) {
    var box = document.createElement('div'), cur = [], hi = 0, wrap = inp.parentNode;
    box.className = 'apick-list'; box.hidden = true; wrap.classList.add('apick'); wrap.appendChild(box); inp.setAttribute('autocomplete', 'off');
    var key = function (x) { return x._k || (x._k = ' ' + norm(x.v + ' ' + (x.s || '') + ' ' + (x.k || '')).replace(/[^a-z0-9 ]/g, ' ').replace(/\s+/g, ' ') + ' '); };
    function draw() { box.innerHTML = cur.map(function (x, i) { return '<button type="button" data-i="' + i + '"' + (i === hi ? ' class="on"' : '') + '>' + esc(x.v) + (x.s ? '<small>' + esc(x.s) + '</small>' : '') + '</button>'; }).join(''); }
    function match() {
      var ws = norm(inp.value).replace(/[^a-z0-9 ]/g, ' ').trim().split(/\s+/).filter(Boolean), all = items() || [], r;
      r = ws.length ? all.filter(function (x) { var k = key(x); return ws.every(function (w) { return k.indexOf(' ' + w) >= 0; }); }) : all;
      if (ws.length) { // khớp tên chính / đúng chữ viết tắt của chính nó (x.a) lên trước; tỉnh cũ ("nay thuộc …") xuống sau
        var q = ' ' + ws.join(' '), ab = ' ' + ws.join('') + ' ';
        var sc = function (x) { return (norm(' ' + x.v).indexOf(q) >= 0 ? 2 : 0) + (x.a && (' ' + x.a + ' ').indexOf(ab) >= 0 ? 2 : 0) + (/^nay thuộc/.test(x.s || '') ? 0 : 1); };
        r.sort(function (a, b) { return sc(b) - sc(a); });
      }
      return r;
    }
    function show() { cur = match().slice(0, 40); hi = 0; draw(); box.hidden = !cur.length || document.activeElement !== inp; }
    function pick(x) { inp.value = x.v; box.hidden = true; if (onPick) onPick(x); }
    inp.addEventListener('input', show); inp.addEventListener('focus', show);
    inp.addEventListener('blur', function () { setTimeout(function () { box.hidden = true; }, 200); });
    inp.addEventListener('change', function () { // gõ xong không bấm chọn: khớp hẳn 1 tên, hoặc chỉ còn 1 gợi ý → nhận luôn
      var v = norm(inp.value).trim(); if (!v) { if (onPick) onPick(null); return; }
      var ex = (items() || []).filter(function (x) { return norm(x.v) === v || norm(x.v).replace(/^(tinh|thanh pho|quan|huyen|thi xa|phuong|xa|thi tran) /, '') === v; });
      if (ex.length !== 1) { ex = match(); if (ex.length !== 1) return; }
      if (inp.value !== ex[0].v || !onPick) pick(ex[0]); else onPick(ex[0]);
    });
    inp.addEventListener('keydown', function (e) {
      if (box.hidden || !cur.length) return;
      if (e.key === 'ArrowDown' || e.key === 'ArrowUp') { e.preventDefault(); hi = (hi + (e.key === 'ArrowDown' ? 1 : cur.length - 1)) % cur.length; draw(); var b = box.children[hi]; if (b) b.scrollIntoView({ block: 'nearest' }); }
      else if (e.key === 'Enter') { e.preventDefault(); pick(cur[hi]); }
      else if (e.key === 'Escape') box.hidden = true;
    });
    box.addEventListener('mousedown', function (e) { e.preventDefault(); }); // bấm gợi ý không làm mất con trỏ khỏi ô
    box.addEventListener('click', function (e) { var b = e.target.closest('[data-i]'); if (b) pick(cur[+b.getAttribute('data-i')]); });
  }
  /** Số tiền gõ tắt: 1800000, 1.800.000, 1tr8, 1tr85, 1,8tr, 800k. */
  function moneyIn(v) {
    var s = String(v || '').toLowerCase().replace(/\s/g, '').replace(/đ|vnd/g, ''); if (!s) return 0;
    var m = s.match(/^(\d+)(?:[.,](\d+))?(tr|trieu|triệu|m|k|nghin|nghìn|ngan|ngàn)(\d*)$/);
    if (m) { var mul = /^(k|ng)/.test(m[3]) ? 1e3 : 1e6, frac = m[2] || m[4] || ''; return Math.round(parseFloat(m[1] + '.' + (frac || '0')) * mul); }
    var n = parseInt(s.replace(/\D/g, ''), 10); return isNaN(n) ? 0 : n;
  }
  function caNow(t) {
    t = t || Date.now();
    var cfg = (S.d.rules && S.d.rules.ca) || {}, x = vnDate(t), dm = pad(x.d) + '/' + pad(x.m), ev = String(cfg.evening || '17:30').split(':');
    if ((cfg.holidays || ['01/01', '30/04', '01/05', '02/09']).indexOf(dm) >= 0) return 'Lễ';
    if (new Date(t + 7 * 3600e3).getUTCDay() === 0 || x.h * 60 + x.mi >= (+ev[0]) * 60 + (+ev[1] || 0)) return 'Tối/CN';
    return 'Ngày';
  }
  /* ---------- giờ lên đơn (đúng giờ đồng hồ, khác Loại đơn do sale chọn để tính hoa hồng). Ngày lễ → Ngoài giờ (Chủ nhật, trước 8:00, từ giờ ca tối) → Trong giờ; đơn nhập file chỉ có ngày → Không rõ giờ */
  var HR_KEYS = ['Trong giờ', 'Ngoài giờ', 'Ngày lễ', 'Không rõ giờ'];
  var HR_ICON = { 'Trong giờ': '🏢', 'Ngoài giờ': '🌙', 'Ngày lễ': '🎉', 'Không rõ giờ': '❔' };
  function evTime() { return ((S.d.rules || {}).ca || {}).evening || '17:30'; }
  function hourBucket(t) {
    if (!t) return 'Không rõ giờ';
    var c = caNow(t), x = vnDate(t);
    if (c === 'Lễ') return 'Ngày lễ';
    if (c === 'Tối/CN') return 'Ngoài giờ';
    if (!x.h && !x.mi) return 'Không rõ giờ';
    return x.h < 8 ? 'Ngoài giờ' : 'Trong giờ';
  }
  function hourTip(k) { return k === 'Trong giờ' ? 'Thứ 2 – thứ 7, 8:00 – ' + evTime() : k === 'Ngoài giờ' ? 'từ ' + evTime() + ', trước 8:00 và cả ngày Chủ nhật' : k === 'Ngày lễ' ? 'ngày lễ trong Cài đặt (kể cả Chủ nhật)' : 'đơn nhập từ file sale, chỉ có ngày'; }
  /* ---------- loại đơn (tính hoa hồng). Ưu tiên Lễ → Ngoài giờ → Mới/Cũ; khách để lại số qua quảng cáo / form web / ebook trong 30 ngày = Khách mới dù đã từng mua */
  var OTYPES = ['Khách mới', 'Khách cũ', 'Ngoài giờ', 'Ngày lễ'];
  var OT = { 'Khách mới': ['🆕', 'Lần đầu mua, hoặc vừa để lại số qua quảng cáo'], 'Khách cũ': ['🔁', 'Đã mua trước đó, tự liên hệ lại / được chăm sóc'], 'Ngoài giờ': ['🌙', 'Tối (sau giờ ca tối) hoặc Chủ nhật'], 'Ngày lễ': ['🎉', 'Đơn chốt vào ngày lễ'] };
  /* ---------- kênh đơn: Web = khách tự đặt trên thucduonglanh.vn (mã TDL…); Sale = sale lên đơn trong CRM / nhập từ file sale */
  function isWebOrder(o) { return (/^TDL\d/.test(o.id || '') || /Mã web TDL\d/.test(o.note || '')) && !/^(nhập tay|tiềm năng|file )/i.test(o.source || ''); } // đơn web sale lên lại trong file: đổi sang mã sale, ghi chú "Mã web TDL…"
  function webSrc(o) { // khách vào web từ đâu (lấy từ cột Nguồn: UTM / fbclid / trang giới thiệu)
    var a = String(o.source || '').split(' / '), s = a[0].trim().toLowerCase(), L = linkByCode(a[2]); if (L) return '📍 ' + L.name;
    return !s || /trực tiếp/.test(s) ? 'Vào thẳng web' : /facebook|^fb$|instagram|messenger/.test(s) ? 'Facebook' : /google/.test(s) ? 'Google' : /tiktok/.test(s) ? 'TikTok' : /zalo/.test(s) ? 'Zalo' : /youtube/.test(s) ? 'YouTube' : s;
  }
  function linkByCode(c) { c = String(c || '').trim().toLowerCase(); var r = c ? ((S.d && S.d.qrLinks) || []).filter(function (l) { return l[0] === c; })[0] : null; return r ? { code: r[0], name: r[1] } : null; } // 📍 tab Link & QR (máy chủ trả qrLinks khi tải CRM)
  var CH_WEB = 'Đơn web'; // khoá % hoa hồng riêng cho đơn web
  function otLabel(t) { return t ? (OT[t] ? OT[t][0] + ' ' : '') + t : '–'; }
  function otypeOf(o) { if (o.otype) return o.otype; if (o.ca === 'Lễ') return 'Ngày lễ'; if (o.ca === 'Tối/CN') return 'Ngoài giờ'; var c = cust(o.phone); return !c || !c.first || c.first >= o.time - 3600e3 ? 'Khách mới' : 'Khách cũ'; } // đơn cũ chưa có cột Loại đơn: suy ra
  function otypeSug(phone, t) {
    var ca = caNow(t), ph = normPhone(phone);
    if (ca === 'Lễ') return { t: 'Ngày lễ', why: 'đơn tạo ngày lễ' };
    if (ca === 'Tối/CN') return { t: 'Ngoài giờ', why: new Date(t + 7 * 3600e3).getUTCDay() === 0 ? 'đơn tạo Chủ nhật' : 'đơn tạo sau ' + (((S.d.rules || {}).ca || {}).evening || '17:30') };
    var ad = (S.d.leads || []).filter(function (l) { return l.phone === ph && /^(quảng cáo|ebook|form website)/i.test(l.channel || '') && l.time && l.time >= t - 30 * DAY && l.time <= t + DAY; }).sort(function (a, b) { return b.time - a.time; })[0];
    if (ad) return { t: 'Khách mới', why: 'khách để lại số qua ' + ad.channel + ' ngày ' + fDate(ad.time).slice(0, 5) };
    var c = cust(ph); if (c && c.first && c.first < t - 3600e3) return { t: 'Khách cũ', why: 'đã mua từ ' + fDate(c.first) + ' (' + c.orders + ' đơn)' };
    return { t: 'Khách mới', why: ph.length >= 10 ? 'lần đầu mua' : 'chưa nhập số điện thoại' };
  }
  function openNewOrder(phone) { openOrderForm({ phone: phone }); }
  /** Form đơn hàng dùng chung: tạo đơn mới (opt.phone), chốt đơn từ khách hỏi (opt.lead), sửa đơn (opt.order). */
  /** Tin Zalo khách gửi ("Lan 0912 345 678, số 5 ngõ 12 Cầu Giấy, Hà Nội") → { phone, name, address }. */
  function parseMsg(text) {
    var t = String(text || '').replace(/\r/g, ''), out = { phone: '', name: '', address: '' };
    var pm = t.match(/(?:\+?84|0)(?:[\s.\-]?\d){8,10}/); if (pm) { out.phone = normPhone(pm[0]); t = t.replace(pm[0], '\n'); }
    var lab = function (re) { var m = t.match(re); if (!m) return ''; t = t.replace(m[0], '\n'); return m[1].trim(); };
    out.name = lab(/(?:^|\n)\s*(?:họ\s*tên|tên(?:\s*khách)?|người\s*nhận)\s*[:\-]\s*([^\n]+)/i);
    out.address = lab(/(?:^|\n)\s*(?:địa\s*chỉ|đ\/?c|dc)\s*[:\-]\s*([^\n]+(?:\n(?!\s*\S+\s*:)[^\n]+)*)/i);
    t = t.replace(/(?:^|\n)\s*(?:sđt|sdt|số\s*điện\s*thoại|điện\s*thoại|đt)\s*[:\-]?\s*(?=\n|$)/gi, '\n');
    var parts = t.split(/\n|,(?=\s*\D)/).map(function (s) { return s.replace(/^[\s,;:\-–.]+|[\s,;:\-–.]+$/g, ''); }).filter(Boolean);
    if (!out.name) { var i = parts.findIndex(function (s) { return !/\d/.test(s) && s.split(/\s+/).length <= 5 && !/(phường|xã|quận|huyện|tỉnh|thành phố|tp|thôn|ngõ|ngách|đường|phố)\b/i.test(s); }); if (i >= 0) { out.name = parts[i]; parts.splice(i, 1); } }
    if (!out.address) out.address = parts.join(', ');
    out.address = out.address.replace(/\s*\n\s*/g, ', ').replace(/\s{2,}/g, ' ').trim();
    return out;
  }
  function shortLabel(n) { var p = String(n).split(' – '), v = (p[1] || '').match(/\d+\s*(g|kg|ml|gói)\b/i); var s = p[0].replace(/\s+VitaGreen\b/i, '').trim(); return (s.length > 26 ? s.slice(0, 24) + '…' : s) + (v ? ' ' + v[0].replace(/\s/g, '') : p[1] && p[1].length <= 10 ? ' ' + p[1] : ''); }
  function openOrderForm(opt) {
    opt = opt || {};
    var P = productOptions(), byLabel = {}, eo = opt.order || null, lead = opt.lead || null, mgr = lvl() >= 2;
    P.forEach(function (p) { byLabel[norm(p.label)] = p; });
    var c0 = eo ? { phone: eo.phone, name: eo.name, address: eo.address, province: eo.province, ward: eo.ward, addrOld: eo.addrOld, consent: eo.consent }
      : cust(opt.phone || (lead && lead.phone) || '') || (lead ? { phone: lead.phone, name: lead.name, address: '', province: '', ward: '', consent: false, isLead: true } : null);
    var names = P.map(function (p) { return p.label; }); soldNames().forEach(function (n) { if (names.indexOf(n) < 0) names.push(n); });
    var row = function (cls, it) {
      return '<div class="item2 ' + cls + '"><input type="text" class="iName" list="noProducts" placeholder="' + (cls === 'gift' ? 'Tên quà tặng' : 'Gõ tên sản phẩm khác') + '" value="' + esc(it ? it.name + (it.variant ? ' – ' + it.variant : '') : '') + '">' +
        '<input type="number" class="iQty" min="1" max="999" inputmode="numeric" value="' + (it ? it.qty : 1) + '" aria-label="Số lượng"><button type="button" class="rm" aria-label="Bỏ">✕</button></div>';
    };
    var start = eo ? parseItems(eo.items) : [], sItems = start.filter(function (i) { return !i.gift; }), sGifts = start.filter(function (i) { return i.gift; });
    if (!eo && lead && lead.interest) sItems = [{ name: lead.interest, variant: '', qty: 1 }];
    var fullAddr = c0 ? [c0.address, c0.ward, c0.province].filter(Boolean).join(', ') : '';
    var src0 = store('crm_osrc'); if (SOURCES.indexOf(src0) < 0) src0 = SOURCES[0]; // nhớ lựa chọn lần trước của từng người
    var car0 = eo ? carrierOf(eo) : 'BEST Express'; // đơn mới mặc định BEST Express (anh Sơn 20/10/2026)
    var carMore = Object.keys(CARRIERS).filter(function (k) { return CAR_MAIN.indexOf(k) < 0; }), carOpen = carMore.indexOf(car0) >= 0; // hãng ít dùng thu gọn, đơn gửi hãng khác thì mở sẵn
    var free0 = !(eo && eo.shipping > 0), fee0 = eo && eo.shipping > 0 ? eo.shipping : CFG.shipping_fee || 30000; // mặc định miễn phí vận chuyển
    var ot0 = eo ? otypeOf(eo) : '', otField = '<div class="f otype"><span class="lbl">Loại đơn (tính hoa hồng)</span><div class="radios ot4">' + OTYPES.map(function (t) { return '<label><input type="radio" name="otype" value="' + t + '"' + (t === ot0 ? ' checked' : '') + '><span><b>' + OT[t][0] + ' ' + t + '</b><small>' + esc(OT[t][1]) + '</small></span></label>'; }).join('') + '</div><p class="hint" id="noOtHint" style="margin:6px 0 0"></p></div>';
    var body = '<form id="noForm" novalidate>' +
      (lead ? '<div class="notice info">🛒 Chốt đơn cho khách hỏi <b>' + esc(lead.name || lead.phone || '') + '</b>. Lưu đơn xong, khách tự chuyển sang “Đã chốt”.</div>' : '') +
      (eo ? '<div class="notice">Đang sửa đơn <b>' + esc(eo.id) + '</b>. Lưu xong, số đơn / tổng chi của khách được tính lại.</div>' : '') +
      '<div class="box"><h3>Khách hàng</h3>' +
      (eo ? '' : '<details class="paste"' + (c0 ? '' : ' open') + '><summary>📋 Dán tin nhắn của khách</summary><textarea id="noPaste" rows="3" placeholder="Dán nguyên tin Zalo của khách (tên, số điện thoại, địa chỉ) – CRM tự tách vào các ô dưới"></textarea><p class="hint" id="noPasteHint" style="margin:4px 0 10px"></p></details>') +
      '<div class="row2c"><label class="f"><span>Số điện thoại *</span><input type="tel" name="phone" inputmode="tel" value="' + esc(c0 ? c0.phone : '') + '"></label>' +
      '<label class="f"><span>Tên khách *</span><input type="text" name="name" value="' + esc(c0 ? c0.name : '') + '"></label></div>' +
      '<div class="hint" id="noOld"></div><div id="noFlag"></div>' +
      '<label class="f"><span>Địa chỉ</span><textarea name="full" rows="2" placeholder="Số nhà, thôn, đường, xã, huyện, tỉnh – ghi kiểu cũ hay mới đều được">' + esc(fullAddr) + '</textarea></label>' +
      '<p class="hint" id="noAddrHint"></p>' +
      '<div class="no-addr2">' + // 2 địa chỉ: mới (34 tỉnh, giao hàng) + cũ (63 tỉnh, có huyện – Misa vẫn chọn kiểu cũ). Điền 1 bên, bên kia tự điền theo bảng chuyển đổi.
        '<div class="no-addr2-col"><div class="no-addr2-h"><b>🆕 Địa chỉ mới</b><button type="button" class="btn sm" data-acopy="new">Copy</button><small>34 tỉnh, từ 01/07/2025 · không có huyện</small></div>' +
          '<label class="f"><span>Tỉnh / Thành phố</span><input type="text" name="province" placeholder="Gõ để tìm, vd: phu tho" value="' + esc(c0 ? c0.province : '') + '"></label>' +
          '<label class="f"><span>Phường / Xã</span><input type="text" name="ward" placeholder="Gõ để tìm" value="' + esc(c0 ? c0.ward : '') + '"></label><p class="hint" id="noNewHint"></p></div>' +
        '<div class="no-addr2-col"><div class="no-addr2-h"><b>🕰 Địa chỉ cũ</b><button type="button" class="btn sm" data-acopy="old">Copy</button><small>63 tỉnh, có huyện · dùng khi lên đơn Misa</small></div>' +
          '<label class="f"><span>Tỉnh / Thành phố</span><input type="text" name="oprov" placeholder="Gõ để tìm, vd: vinh phuc"></label>' +
          '<label class="f"><span>Quận / Huyện</span><input type="text" name="odist" placeholder="Gõ để tìm"></label>' +
          '<label class="f"><span>Phường / Xã</span><input type="text" name="oward" placeholder="Gõ để tìm"></label><p class="hint" id="noOldHint"></p></div>' +
      '</div></div>' +
      '<datalist id="noProducts">' + names.map(function (n) { return '<option value="' + esc(n) + '">'; }).join('') + '</datalist>' +
      '<div class="box"><h3>Sản phẩm <span class="muted small" style="font-weight:400">· bấm để thêm, bấm lại để tăng số lượng</span></h3><div class="chips wrap" id="noChips"></div>' +
      '<div class="items" id="noItems">' + (sItems.length ? sItems.map(function (i) { return row('prod', i); }).join('') : row('prod')) + '</div>' +
      '<div class="steps" style="margin-top:8px"><button type="button" class="btn" id="noAdd">＋ Sản phẩm khác</button><button type="button" class="btn" id="noAddGift">🎁 Thêm quà</button></div>' +
      '<div class="items" id="noGifts" style="margin-top:8px">' + sGifts.map(function (i) { return row('gift', i); }).join('') + '</div></div>' +
      '<div class="box">' + otField + '<label class="f"><span>Số tiền thu khách *</span><input type="text" name="total" inputmode="decimal" autocomplete="off" placeholder="vd 1800000 hoặc 1tr8" value="' + (eo ? eo.total : '') + '"></label><p class="hint" id="noTotalHint"></p>' +
      '<div class="f"><span class="lbl">Thanh toán</span><div class="radios"><label><input type="radio" name="payment" value="cod"' + (eo && isBank(eo) ? '' : ' checked') + '><span>COD (trả khi nhận)</span></label><label><input type="radio" name="payment" value="bank"' + (eo && isBank(eo) ? ' checked' : '') + '><span>Chuyển khoản</span></label></div></div>' +
      '<div class="f"><span class="lbl">Đơn vị vận chuyển</span><div class="radios">' + CAR_MAIN.concat(carMore).map(function (k) { var x = CAR_MAIN.indexOf(k) < 0; return '<label' + (x ? ' class="no-car-x"' + (carOpen ? '' : ' hidden') : '') + '><input type="radio" name="carrier" value="' + esc(k) + '"' + (k === car0 ? ' checked' : '') + '><span>' + esc(k) + '</span></label>'; }).join('') +
        (carOpen ? '' : '<button type="button" class="chip" id="noCarMore">＋ Hãng khác</button>') + '</div></div>' +
      '<div class="f"><span class="lbl">Phí vận chuyển</span><div class="radios"><label><input type="radio" name="shipmode" value="free"' + (free0 ? ' checked' : '') + '><span>Miễn phí vận chuyển</span></label><label><input type="radio" name="shipmode" value="add"' + (free0 ? '' : ' checked') + '><span>Cộng phí ship</span></label></div></div>' +
      '<label class="f" id="noShipFee"' + (free0 ? ' hidden' : '') + '><span>Phí ship cộng vào tiền thu khách</span><input type="number" name="shipping" min="0" step="1000" inputmode="numeric" value="' + (free0 ? 0 : fee0) + '"></label>' +
      '<label class="f"><span>Mã đơn' + (eo ? ' (không đổi được khi sửa)' : '') + '</span><input type="text" name="code" autocomplete="off" value="' + (eo ? esc(eo.id) : '') + '"' + (eo ? ' readonly' : '') + '></label>' +
      (eo ? '' : '<p class="hint" id="noCodeHint">Tự điền: tên + ngày tháng năm + gạch + số thứ tự đơn trong ngày (vd Phuong201026-01), ghi vào cột Mã đơn trong file của bạn. Gửi Viettel Post thì thêm chữ V ở đầu.</p>') +
      (eo ? '<label class="f"><span>Lý do sửa (không bắt buộc)</span><input type="text" name="reason" placeholder="vd: khách đổi sang hộp 400g"></label>' : '<div class="f"><span class="lbl">Ghi chú giao hàng <span class="muted small" style="font-weight:400">· bấm để thêm nhanh</span></span><div class="chips wrap" id="noNoteChips">' + NOTE_QUICK.map(function (t) { return '<button type="button" class="chip" data-nq="' + esc(t) + '">' + esc(t) + '</button>'; }).join('') + '</div>' +
        '<textarea name="note" rows="2" placeholder="Ghi thêm nếu cần, vd: giao sau 17h, gửi nhà hàng xóm số 12"></textarea></div>') +
      '<details class="addr-more opts" id="noOpts"><summary>⚙️ <span id="noOptSum"></span></summary>' +
      (eo ? '' : (lead ? '' : '<label class="f"><span>Khách đặt qua</span><select name="source">' + SOURCES.map(function (s) { return '<option' + (s === src0 ? ' selected' : '') + '>' + s + '</option>'; }).join('') + '</select></label>') +
        '<div class="f"><span class="lbl">Trạng thái</span><div class="radios"><label><input type="radio" name="status" value="Đã xác nhận" checked><span>Đã chốt với khách</span></label><label><input type="radio" name="status" value="Mới"><span>Chưa xác nhận</span></label></div></div>' +
        '<label class="switch"><input type="checkbox" name="consent"' + (c0 && c0.consent ? ' checked' : '') + '> Khách đồng ý nhận tin ưu đãi</label>') + '</details>' +
      '<p class="hint" style="margin:10px 0 0">📦 <span id="noShip"></span> · <a href="#" id="noCopy">copy</a>' + (eo ? ' · Mã đơn <b>' + esc(eo.id) + '</b>' : '') + '</p></div>' +
      '<p class="err" id="noErr"></p></form>';
    var m = modal(eo ? 'Sửa đơn ' + esc(eo.id) : lead ? 'Chốt đơn: ' + esc(lead.name || lead.phone || 'khách hỏi') : 'Lên đơn mới', body, '<button class="btn" data-close>Huỷ</button><button class="btn pri" id="noSave">Lưu đơn</button>');
    var form = $('#noForm', m), F = form.elements, items = $('#noItems', m), gifts = $('#noGifts', m), prov = F.province, ward = F.ward, totalEdited = !!eo, curC = c0 && !c0.isLead && !eo ? c0 : null;
    /* ---- 2 địa chỉ. Tự điền (theo chữ địa chỉ / theo bên kia) chỉ đè ô chưa tự tay chọn; xoá chữ địa chỉ → làm lại từ đầu */
    var OU = null, oP = null, oD = null, oW = null, touchN = !!(c0 && (c0.province || c0.ward)), touchO = false;
    var oprov = F.oprov, odist = F.odist, oward = F.oward;
    function unitOf(n) { return (S.units || []).filter(function (p) { return p.n === n; })[0] || null; }
    function setProvince(pv, wd) {
      var hit = (S.units || []).filter(function (p) { return norm(p.n) === norm(pv) || norm(p.f) === norm(pv); })[0];
      prov.value = hit ? hit.n : pv || ''; if (wd !== undefined) ward.value = wd || ''; addrHint();
    }
    function setOld(p, d, w) { oP = p || null; oD = d || null; oW = w || null; oprov.value = oP ? oP.n : ''; odist.value = oD ? oD.n : ''; oward.value = oW ? oW.n : ''; addrHint(); }
    function oldText() { return [oward.value.trim(), odist.value.trim(), oprov.value.trim()].filter(Boolean).join(', '); }
    /** xã cũ → xã mới (1 xã cũ có thể chia sang vài xã mới: để sale chọn) */
    function newFromOld(w) {
      if (!w) return; var pn = w.d.p.nw; prov.value = pn; ward.value = w.nw.length === 1 ? w.nw[0] : (w.nw.indexOf(ward.value) >= 0 ? ward.value : '');
      addrHint();
    }
    /** xã mới → xã cũ: chỉ 1 xã cũ gộp vào thì điền luôn; nhiều xã cũ cùng huyện thì điền tỉnh + huyện */
    function oldFromNew() {
      if (!OU || !prov.value || !ward.value) return; var l = OU.rev[prov.value + '|' + ward.value] || []; if (!l.length) return;
      if (l.length === 1) return setOld(l[0].d.p, l[0].d, l[0]);
      var ds = l.map(function (w) { return w.d; }).filter(function (d, i, a) { return a.indexOf(d) === i; });
      var ps = ds.map(function (d) { return d.p; }).filter(function (p, i, a) { return a.indexOf(p) === i; });
      setOld(ps.length === 1 ? ps[0] : null, ds.length === 1 ? ds[0] : null, null);
    }
    function addrHint() {
      var nh = '', oh = '', full = F.full.value.trim();
      if (oW && oW.nw.length > 1 && oW.d.p.nw === prov.value && oW.nw.indexOf(ward.value) < 0) nh = '⚠️ ' + esc(oW.n) + ' cũ nay chia vào: <b>' + esc(oW.nw.join(', ')) + '</b> – chọn 1 xã đúng với nhà khách.';
      if (prov.value && ward.value && !oW && OU) { var l = OU.rev[prov.value + '|' + ward.value] || []; if (l.length > 1) oh = 'Phường / xã mới này gộp từ: ' + l.slice(0, 6).map(function (w) { return esc(w.n) + ' (' + esc(w.d.n.replace(/^(Huyện|Quận|Thị xã|Thành phố) /, '')) + ')'; }).join(', ') + (l.length > 6 ? '…' : '') + ' – bấm ô Phường / Xã để chọn.'; }
      if (prov.value && !unitOf(prov.value)) nh = '⚠️ “' + esc(prov.value) + '” không có trong 34 tỉnh mới – chọn trong danh sách gợi ý.';
      $('#noNewHint', m).innerHTML = nh; $('#noOldHint', m).innerHTML = oh;
      $('#noAddrHint', m).innerHTML = full && !prov.value && !oprov.value ? '⚠️ Chưa nhận ra tỉnh / phường – gõ vào các ô bên dưới để chọn.' : '';
    }
    function addrChanged() {
      if (!F.full.value.trim()) { touchN = touchO = false; setProvince('', ''); setOld(); return; }
      var d = detectAddr(F.full.value), o = detectOld(OU, F.full.value), oldStyle = o.w && (o.d || OU.alone[o.p.n]); // có tên huyện / tỉnh cũ → chắc là địa chỉ kiểu cũ
      if (!touchO && (o.w || (o.p && OU.alone[o.p.n]))) setOld(o.p, o.d, o.w);
      if (!touchN) { if (oldStyle) newFromOld(o.w); else if (d.province) setProvince(d.province, d.ward || (norm(d.province) === norm(prov.value) ? ward.value : '')); }
      if (!touchO && !o.w && !(o.p && OU.alone[o.p.n])) oldFromNew();
      addrHint();
    }
    /* ---- ô gõ để tìm */
    var OLD_OF = {}; // tỉnh mới → tên các tỉnh cũ gộp vào (gõ "vinh phuc" ở ô tỉnh mới vẫn ra Phú Thọ)
    var provItems = function () { return (S.units || []).map(function (p) { var o = (OLD_OF[p.n] || []).filter(function (x) { return x !== p.n; }); return { v: p.n, a: provAbbr(p.n), k: p.f + ' ' + provAbbr(p.n) + ' ' + o.map(provAbbr).join(' '), s: o.length ? 'gồm cả ' + o.join(', ') : '' }; }); };
    var wardItems = function () { var u = unitOf(prov.value); return u ? u.w.map(function (w) { return { v: w }; }) : [].concat.apply([], (S.units || []).map(function (p) { return p.w.map(function (w) { return { v: w, s: p.n, p: p.n }; }); })); };
    var oProvItems = function () { return OU ? OU.p.map(function (p) { return { v: p.n, a: provAbbr(p.n), k: p.f + ' ' + provAbbr(p.n), s: p.nw !== p.n ? 'nay thuộc ' + p.nw : '', o: p }; }) : []; };
    var oDistItems = function () { return OU ? (oP ? oP.d.map(function (d) { return { v: d.n, o: d }; }) : [].concat.apply([], OU.p.map(function (p) { return p.d.map(function (d) { return { v: d.n, s: p.n, o: d }; }); }))) : []; };
    var oWardItems = function () {
      if (!OU) return []; var sw = function (w, sh) { return { v: w.n, s: sh ? w.d.n + ', ' + w.d.p.n : w.nw.length ? '→ ' + w.nw.join(' / ') : '', o: w }; };
      if (oD) return oD.w.map(function (w) { return sw(w); });
      var l = prov.value && ward.value ? OU.rev[prov.value + '|' + ward.value] : null; if (l && l.length) return l.map(function (w) { return sw(w, true); }); // đã có xã mới: chỉ hiện các xã cũ gộp vào
      return [].concat.apply([], (oP ? [oP] : OU.p).map(function (p) { return [].concat.apply([], p.d.map(function (d) { return d.w.map(function (w) { return sw(w, true); }); })); }));
    };
    addrPick(prov, provItems, function (x) { touchN = true; var u = x && unitOf(x.v); if (!u || u.w.indexOf(ward.value) < 0) ward.value = ''; addrHint(); });
    addrPick(ward, wardItems, function (x) { touchN = true; if (x && x.p) prov.value = x.p; if (x && !touchO) oldFromNew(); addrHint(); });
    addrPick(oprov, oProvItems, function (x) { touchO = true; var p = x ? x.o : null; setOld(p, oD && oD.p === p ? oD : null, oW && oW.d.p === p ? oW : null); if (p && !touchN && !prov.value) setProvince(p.nw); });
    addrPick(odist, oDistItems, function (x) { touchO = true; var d = x ? x.o : null; setOld(d ? d.p : oP, d, oW && oW.d === d ? oW : null); });
    addrPick(oward, oWardItems, function (x) { touchO = true; var w = x ? x.o : null; if (!w) { setOld(oP, oD, null); return; } setOld(w.d.p, w.d, w); if (!touchN || !ward.value) newFromOld(w); });
    [oprov, odist, oward].forEach(function (el) { el.addEventListener('input', function () { touchO = true; if (!el.value.trim()) { if (el === oprov) setOld(); else if (el === odist) setOld(oP); else setOld(oP, oD); } }); });
    [prov, ward].forEach(function (el) { el.addEventListener('input', function () { touchN = true; addrHint(); }); });
    $$('[data-acopy]', m).forEach(function (b) { b.onclick = function () { var t = b.getAttribute('data-acopy') === 'old' ? oldText() : [ward.value.trim(), prov.value.trim()].filter(Boolean).join(', '); if (!t) return toast('Chưa có địa chỉ ' + (b.getAttribute('data-acopy') === 'old' ? 'cũ' : 'mới') + ' để copy', true); copy(t).then(function () { toast('Đã copy: ' + t); }); }; });
    Promise.all([loadUnits(), loadOldUnits()]).then(function (r) {
      OU = r[1]; if (OU) OU.p.forEach(function (p) { (OLD_OF[p.nw] = OLD_OF[p.nw] || []).push(p.n); });
      if (c0 && c0.addrOld && OU) { var po = oldParse(OU, c0.addrOld); touchO = true; setOld(po.p, po.d, po.w); if (!po.p) { var a = c0.addrOld.split(','); oprov.value = (a.pop() || '').trim(); } } // địa chỉ cũ đã lưu ở đơn / hồ sơ khách
      if (c0 && c0.province) setProvince(c0.province, c0.ward);
      if (c0 && c0.province && !touchO) oldFromNew();
      if (!(c0 && c0.province)) addrChanged(); else addrHint();
    });
    F.full.addEventListener('input', function () { clearTimeout(F.full._t); F.full._t = setTimeout(addrChanged, 300); });
    function flagOf(c) { return c && c.flag ? '<div class="notice">⚠️ Khách có nhãn <b>' + esc(c.flag) + '</b>. Kiểm tra kỹ trước khi gửi hàng (nên chuyển khoản trước).</div>' : ''; }
    /* ---- khách cũ: thông tin + nút đặt lại như đơn trước */
    function lastOrder(c) { return c ? ordersOf(c.phone).filter(function (o) { return !/huỷ|hủy|hoàn/i.test(o.status) && parseItems(o.items).length; })[0] : null; }
    function showOld(c) {
      var lo = eo ? null : (opt.repeat && c && normPhone(opt.repeat.phone) === c.phone ? opt.repeat : lastOrder(c)), el = $('#noOld', m);
      el.innerHTML = c ? 'Khách cũ: <b>' + esc(c.name) + '</b> · ' + c.orders + ' đơn, ' + money(c.spent) + (lo ? '<button type="button" class="btn sm" id="noRepeat" style="display:block;margin:6px 0 4px">🔁 Đặt lại như đơn ' + fDate(lo.time).slice(0, 5) + ': ' + esc(parseItems(lo.items).filter(function (i) { return !i.gift; }).slice(0, 3).map(function (i) { return i.qty + ' ' + shortLabel(i.name + (i.variant ? ' – ' + i.variant : '')); }).join(', ')) + ' · ' + moneyShort(lo.total) + '</button>' : '') : '';
      $('#noFlag', m).innerHTML = flagOf(c);
      if (lo) $('#noRepeat', m).onclick = function () {
        var its = parseItems(lo.items), ps = its.filter(function (i) { return !i.gift; }), gs = its.filter(function (i) { return i.gift; });
        items.innerHTML = ps.map(function (i) { return row('prod', i); }).join('') || row('prod'); gifts.innerHTML = gs.map(function (i) { return row('gift', i); }).join('');
        F.total.value = lo.total; totalEdited = true; setShipMode(lo.shipping > 0, lo.shipping);
        var pb = $('input[name=payment][value=' + (isBank(lo) ? 'bank' : 'cod') + ']', form); if (pb) pb.checked = true;
        calc(); toast('Đã điền như đơn ' + fDate(lo.time) + ' – sửa chỗ nào khác rồi lưu');
      };
      renderChips(c);
    }
    function fillFrom(c) {
      if (!F.name.value) F.name.value = c.name;
      if (!F.full.value.trim()) {
        F.full.value = [c.address, c.ward, c.province].filter(Boolean).join(', ');
        if (c.addrOld && OU) { var po = oldParse(OU, c.addrOld); if (po.p) { touchO = true; setOld(po.p, po.d, po.w); } }
        if (c.province) { touchN = true; setProvince(c.province, c.ward); if (!touchO) oldFromNew(); } else addrChanged();
      }
      if (F.consent) F.consent.checked = c.consent;
    }
    /* ---- số của người đang ở tab Khách hỏi (chưa mua): điền tên, gợi ý sản phẩm quan tâm; lưu đơn → khách hỏi tự chuyển "Đã chốt" */
    var autoLead = null;
    function openLeadOf(ph) { ph = normPhone(ph); return (S.d.leads || []).filter(function (l) { return l.phone === ph && (l.status === 'Mới hỏi' || l.status === 'Đang tư vấn'); }).sort(function (a, b) { return (b.time || 0) - (a.time || 0); })[0] || null; }
    function showLead(l) {
      var el = $('#noOld', m);
      el.innerHTML = '🙋 Khách hỏi từ <b>' + fDate(l.time).slice(0, 5) + '</b>' + (l.channel ? ' · ' + esc(l.channel) : '') + (l.interest ? ' · quan tâm <b>' + esc(l.interest) + '</b>' : '') + (l.owner ? ' · 👤 ' + esc(l.owner) : '') + '<br>Lưu đơn xong, khách tự chuyển sang “Đã chốt” trong tab Khách hỏi.';
      if (!F.name.value) F.name.value = l.name;
      var pv = (String(l.note || '').match(/📍\s*([^\n,;]+)/) || [])[1]; // tỉnh sale ghi khi tư vấn
      if (pv && !F.full.value.trim()) { F.full.value = pv.trim(); addrChanged(); }
      renderChips(null, l.interest);
    }
    F.phone.addEventListener('change', function () { var v = normPhone(this.value); if (/^0\d{9,10}$/.test(v) && v !== this.value) this.value = v; }); // gõ / dán xong: tự thêm số 0 đầu, bỏ dấu cách
    F.phone.addEventListener('paste', function () { var el = this; setTimeout(function () { var v = normPhone(el.value); if (/^0\d{9,10}$/.test(v) && v !== el.value) { el.value = v; el.dispatchEvent(new Event('input')); } }, 0); });
    F.phone.addEventListener('input', function () {
      var c = cust(this.value), hint = $('#noOld', m); curC = c || null; showOld(c);
      autoLead = !c && !lead && !eo ? openLeadOf(this.value) : null;
      if (autoLead) showLead(autoLead);
      else if (!c && lvl() < 2) checkPhone(this.value, function (r) { if (r && r.status === 'other') hint.innerHTML = ownerWarn(r); });
      if (c) fillFrom(c);
    });
    /* ---- dán tin nhắn khách */
    if ($('#noPaste', m)) $('#noPaste', m).addEventListener('input', function () {
      var ta = this; clearTimeout(ta._t); ta._t = setTimeout(function () {
        var r = parseMsg(ta.value), got = [];
        if (r.phone) { F.phone.value = r.phone; F.phone.dispatchEvent(new Event('input')); got.push('SĐT'); }
        if (r.name) { F.name.value = r.name; got.push('tên'); }
        if (r.address && r.address.length > 8) { F.full.value = r.address; addrChanged(); got.push('địa chỉ'); }
        $('#noPasteHint', m).textContent = ta.value.trim() ? (got.length ? '✓ Đã điền ' + got.join(', ') + ' – kiểm tra lại các ô dưới.' : 'Chưa tách được, bạn điền tay giúp nhé.') : '';
      }, 250);
    });
    /* ---- loại đơn: chọn sẵn theo gợi ý; sale chọn khác → cảnh báo, quản lý kiểm tra */
    var otPicked = !!eo, otTime = eo ? eo.time : Date.now();
    function otUpdate() {
      var sug = otypeSug(F.phone.value, otTime), cur = $('input[name=otype]:checked', form);
      if (!otPicked) { var r0 = $('input[name=otype][value="' + sug.t + '"]', form); if (r0) r0.checked = true; cur = r0; }
      var v = cur ? cur.value : '', bad = v && v !== sug.t, box = $('.f.otype', m);
      box.classList.toggle('warn', !!bad);
      $('#noOtHint', m).innerHTML = bad ? '⚠️ Bạn chọn <b>' + esc(v) + '</b>, CRM gợi ý <b>' + esc(sug.t) + '</b> (' + esc(sug.why) + '). ' + (mgr ? 'Bạn là quản lý nên lưu theo lựa chọn của bạn.' : 'Vẫn lưu được, quản lý sẽ kiểm tra lại.') : '💡 CRM gợi ý: <b>' + esc(sug.t) + '</b> – ' + esc(sug.why);
    }
    $$('input[name=otype]', form).forEach(function (r) { r.addEventListener('change', function () { otPicked = true; otUpdate(); }); });
    F.phone.addEventListener('input', otUpdate);
    /* ---- nút sản phẩm hay bán (+ sản phẩm khách hay mua lên trước) */
    function renderChips(c, interest) {
      var list = [], add = function (n) { if (n && list.indexOf(n) < 0) list.push(n); };
      var want = norm(interest || '').replace(/[^a-z0-9 ]/g, ' ').split(/\s+/).filter(function (w) { return w.length >= 3; }); // sản phẩm khách hỏi quan tâm lên đầu
      if (want.length) names.forEach(function (n) { var k = norm(n); if (want.every(function (w) { return k.indexOf(w) >= 0; })) add(n); });
      if (c) ordersOf(c.phone).slice(0, 5).forEach(function (o) { parseItems(o.items).forEach(function (i) { if (!i.gift) add(i.name + (i.variant ? ' – ' + i.variant : '')); }); });
      soldNames().forEach(function (n) { if (list.length < 8) add(n); });
      P.forEach(function (p) { if (list.length < 8) add(p.label); });
      $('#noChips', m).innerHTML = list.slice(0, 10).map(function (n) { return '<button type="button" class="chip" data-pick="' + esc(n) + '" title="' + esc(n) + '">' + esc(shortLabel(n)) + '</button>'; }).join('');
    }
    $('#noChips', m).addEventListener('click', function (e) {
      var b = e.target.closest('[data-pick]'); if (!b) return; var n = b.getAttribute('data-pick'), rows = $$('.item2', items);
      var hit = rows.filter(function (r) { return norm($('.iName', r).value.trim()) === norm(n); })[0];
      if (hit) { var q = $('.iQty', hit); q.value = (parseInt(q.value, 10) || 0) + 1; }
      else { var empty = rows.filter(function (r) { return !$('.iName', r).value.trim(); })[0]; if (!empty) { items.insertAdjacentHTML('beforeend', row('prod')); empty = $('.item2:last-child', items); } $('.iName', empty).value = n; }
      calc();
    });
    function read(box) {
      return $$('.item2', box).map(function (r) {
        var t = $('.iName', r).value.trim(), q = Math.max(0, parseInt($('.iQty', r).value, 10) || 0); if (!t || !q) return null;
        var p = byLabel[norm(t)], parts = t.split(' – ');
        return p ? { name: p.name, variant: p.variant, qty: q, price: p.price } : { name: parts[0], variant: parts.slice(1).join(' – '), qty: q, price: 0 };
      }).filter(Boolean);
    }
    function shipLine(ls, gs) { return ls.map(function (i) { return i.qty + ' ' + i.name + (i.variant ? ' ' + i.variant : ''); }).concat(gs.map(function (i) { return i.qty + ' ' + i.name + (i.variant ? ' ' + i.variant : '') + ' (quà)'; })).join(', '); }
    function optSum() {
      var st = $('input[name=status]:checked', form), ship = +F.shipping.value || 0;
      $('#noOptSum', m).textContent = 'Tuỳ chọn khác: ' + [F.source ? F.source.value : '', st ? (st.value === 'Mới' ? 'Chưa xác nhận' : 'Đã chốt') : '', ship ? 'ship ' + money(ship) : ''].filter(Boolean).join(' · ') + ' – bấm để sửa';
    }
    function calc() {
      var ls = read(items), gs = read(gifts), base = ls.reduce(function (s, i) { return s + i.qty * i.price; }, 0), ship = Math.max(0, +F.shipping.value || 0);
      if (!totalEdited && base) F.total.value = base + ship;
      var tot = moneyIn(F.total.value);
      $('#noTotalHint', m).innerHTML = (tot ? '= <b>' + money(tot) + '</b>' : '') + (base ? ' · giá niêm yết ' + money(base) + (tot && tot - ship !== base ? ' (bạn đang bán ' + (tot - ship > base ? 'cao' : 'thấp') + ' hơn ' + money(Math.abs(tot - ship - base)) + ')' : '') : '');
      $('#noShip', m).textContent = shipLine(ls, gs) || 'chưa có sản phẩm';
      $('#noSave', m).textContent = (eo ? 'Lưu đơn' : 'Lưu & copy lên đơn') + (tot ? ' · ' + money(tot) : '');
      optSum();
    }
    [items, gifts].forEach(function (box) {
      box.addEventListener('input', calc);
      box.addEventListener('click', function (e) { if (e.target.classList.contains('rm')) { var r = e.target.closest('.item2'); if (box === gifts || $$('.item2', box).length > 1) r.remove(); else { $('.iName', r).value = ''; $('.iQty', r).value = 1; } calc(); } });
    });
    $('#noAdd', m).onclick = function () { items.insertAdjacentHTML('beforeend', row('prod')); $('.item2:last-child .iName', items).focus(); };
    $('#noAddGift', m).onclick = function () { gifts.insertAdjacentHTML('beforeend', row('gift')); $('.item2:last-child .iName', gifts).focus(); };
    F.total.addEventListener('input', function () { totalEdited = true; calc(); });
    F.shipping.addEventListener('input', calc); $('#noOpts', m).addEventListener('change', optSum);
    /* ---- phí ship: Miễn phí (mặc định) / Cộng phí ship (hiện ô số tiền, mặc định phí ship của web) */
    function setShipMode(add, fee) {
      var r = $('input[name=shipmode][value=' + (add ? 'add' : 'free') + ']', form); if (r) r.checked = true;
      $('#noShipFee', m).hidden = !add; F.shipping.value = add ? (fee || +F.shipping.value || CFG.shipping_fee || 30000) : 0; calc();
    }
    $$('input[name=shipmode]', form).forEach(function (r) { r.addEventListener('change', function () { setShipMode(r.value === 'add'); }); });
    /* ---- mã đơn: <V nếu Viettel Post><tên của bạn><ddMMyy>-<số thứ tự 2 chữ số trong ngày>, vd Phuong201026-01, VPhuong201026-02 – ghi vào cột Mã đơn file sale.
     *  Sale tự sửa ô thì giữ chữ của sale (đổi hãng chỉ thêm / bỏ chữ V). Máy chủ kiểm tra trùng; mã tự điền trùng thì máy chủ tự lấy số kế tiếp. */
    var codeAuto = !eo, codePre = (S.user && S.user.prefix) || slugName(S.user && S.user.name), codeDay = (function () { var x = vnDate(Date.now()); return pad(x.d) + pad(x.m) + String(x.y).slice(-2); })();
    function isVtp() { var c = $('input[name=carrier]:checked', form); return !!c && c.value === 'Viettel Post'; }
    function codeSuggest() {
      var base = codePre + codeDay, t0 = dayStart(Date.now()), n = 0;
      (S.d.orders || []).forEach(function (o) { var id = String(o.id || ''); if ((o.time || 0) < t0) return; if (id.indexOf('V' + base) === 0) id = id.slice(1); var k = id.indexOf(base) === 0 && id.slice(base.length).match(/^-?(\d{2})(?![\d-])/); if (k) n = Math.max(n, +k[1]); }); // đếm cả mã không gạch Phuong20102601 (sáng 20/10/2026); bỏ mã trùng có đuôi SĐT Phuong201026-5179
      return (isVtp() ? 'V' : '') + base + '-' + pad(n + 1);
    }
    function codeVtp() {
      if (eo) return; if (codeAuto) { F.code.value = codeSuggest(); return; }
      var v = F.code.value.trim(), hasV = v.indexOf('V' + codePre) === 0;
      if (isVtp() && !hasV && v) F.code.value = 'V' + v; else if (!isVtp() && hasV) F.code.value = v.slice(1);
    }
    if (!eo) { F.code.value = codeSuggest(); F.code.addEventListener('input', function () { codeAuto = !F.code.value.trim(); }); F.code.addEventListener('change', function () { if (!F.code.value.trim()) { codeAuto = true; F.code.value = codeSuggest(); } }); }
    $$('input[name=carrier]', form).forEach(function (r) { r.addEventListener('change', codeVtp); });
    if ($('#noCarMore', m)) $('#noCarMore', m).onclick = function () { $$('.no-car-x', form).forEach(function (l) { l.hidden = false; }); this.remove(); };
    /* ---- ghi chú giao hàng: bấm nút để thêm / bỏ câu hay dùng trong ô ghi chú (sale vẫn gõ thêm được) */
    function noteParts() { return F.note.value.split(/\s*[,;\n]\s*/).map(function (t) { return t.trim(); }).filter(Boolean); }
    function noteChipsSync() { var ps = noteParts().map(norm); $$('#noNoteChips .chip', m).forEach(function (b) { b.classList.toggle('on', ps.indexOf(norm(b.dataset.nq)) >= 0); }); }
    if (F.note && $('#noNoteChips', m)) {
      $('#noNoteChips', m).addEventListener('click', function (e) {
        var b = e.target.closest('[data-nq]'); if (!b) return;
        var t = b.dataset.nq, off = NOTE_PAIR[t] ? norm(NOTE_PAIR[t]) : null, had = false, ps = noteParts().filter(function (p) { var k = norm(p); if (k === norm(t)) { had = true; return false; } return k !== off; });
        if (!had) ps.push(t); F.note.value = ps.join(', '); noteChipsSync();
      });
      F.note.addEventListener('input', noteChipsSync);
    }
    var shipText = function () { var addr = F.full.value.trim(); return F.name.value.trim() + ' – ' + normPhone(F.phone.value) + '\n' + addr + '\n' + $('#noShip', m).textContent + '\nThu: ' + money(moneyIn(F.total.value)) + ($('input[name=payment]:checked', form).value === 'bank' ? ' (đã chuyển khoản)' : ' (COD)') + (F.note && F.note.value.trim() ? '\nGhi chú: ' + F.note.value.trim() : ''); };
    $('#noCopy', m).onclick = function (e) { e.preventDefault(); copy(shipText()).then(function () { toast('Đã copy nội dung lên đơn'); }); };
    showOld(curC); calc(); otUpdate();
    if (opt.repeat && $('#noRepeat', m)) $('#noRepeat', m).click();
    $('#noSave', m).onclick = function () {
      var err = $('#noErr', m), ph = normPhone(F.phone.value), ls = read(items), gs = read(gifts), tot = moneyIn(F.total.value), ship = Math.max(0, +F.shipping.value || 0);
      if (!/^0\d{9,10}$/.test(ph)) { err.textContent = 'Số điện thoại chưa đúng (10 số, bắt đầu bằng 0).'; F.phone.focus(); return; }
      if (!eo && !/^[\p{L}\d][\p{L}\d.\-_ ]{2,29}$/u.test(F.code.value.trim())) { err.textContent = 'Mã đơn chưa đúng (3–30 ký tự: chữ, số, dấu chấm, gạch).'; F.code.focus(); return; }
      if (!F.name.value.trim()) { err.textContent = 'Nhập tên khách.'; F.name.focus(); return; }
      if (prov.value.trim() && !unitOf(prov.value.trim())) { err.textContent = 'Tỉnh / thành phố mới chưa đúng – chọn trong danh sách gợi ý.'; prov.focus(); return; }
      if (!ls.length) { err.textContent = 'Nhập ít nhất 1 sản phẩm.'; return; }
      if (!tot) { err.textContent = 'Nhập số tiền thu khách.'; F.total.focus(); return; }
      if (tot < ship) { err.textContent = 'Số tiền thu khách nhỏ hơn phí ship.'; $('#noOpts', m).open = true; return; }
      ls.forEach(function (i) { if (!i.price) i.price = Math.round((tot - ship) / ls.length / i.qty); }); // chưa có giá niêm yết: chia đều, máy tính lại theo tổng
      if (!eo) copy(shipText()); // copy ngay lúc bấm (điện thoại chỉ cho copy khi vừa bấm)
      var btn = this; btn.disabled = true; btn.textContent = 'Đang lưu…'; err.textContent = '';
      var full = F.full.value.trim(), cu = { phone: ph, name: F.name.value.trim(), province: prov.value.trim(), ward: ward.value.trim(), address: full, addrOld: oldText() };
      var otIn = $('input[name=otype]:checked', form), carIn = $('input[name=carrier]:checked', form);
      var common = { customer: cu, items: ls, gifts: gs, total: tot, shipping: ship, payment: $('input[name=payment]:checked', form).value, otype: otIn ? otIn.value : undefined, carrier: carIn ? carIn.value : '' }; // máy chủ tính lại gợi ý, khác gợi ý → quản lý kiểm tra
      var fail = function (e) { btn.disabled = false; calc(); err.textContent = e.message; };
      if (eo) {
        common.id = eo.id; common.row = eo.row; common.reason = F.reason.value.trim();
        api('order_edit', common).then(function () { closeModal(true); toast('Đã sửa đơn ' + eo.id + ' ✓'); history.replaceState(null, '', '#don-hang'); load(true); }, fail);
        return;
      }
      cu.note = F.note.value.trim(); common.status = $('input[name=status]:checked', form).value; common.code = F.code.value.trim(); common.codeAuto = codeAuto; common.source = F.source ? F.source.value : ''; common.consent = F.consent.checked; var L0 = lead || autoLead; common.leadId = L0 ? L0.id : '';
      if (F.source) store('crm_osrc', F.source.value);
      var create = function () { return api('order_create', common).catch(function (e) {
        if (!e.j || !e.j.dupOf || !confirm(e.message + '\n\nBấm OK nếu khách thật sự đặt thêm 1 đơn nữa. Bấm Huỷ để xem lại tab Đơn hàng.')) { if (e.j && e.j.dupOf) { closeModal(); location.hash = '#don-hang'; load(true); e.handled = true; } throw e; }
        common.force = true; return api('order_create', common);
      }); };
      create().then(function (j) {
        if (L0) { L0.status = 'Đã chốt'; L0.orderId = j.id; L0.callback = null; }
        closeModal(); toast('Đã tạo đơn ' + j.id + ' ✓ · nội dung lên đơn đã copy, dán sang bên vận chuyển'); if (j.oflag) toast('⚠️ Loại đơn khác gợi ý của CRM (' + j.oflag.replace(/^CRM gợi ý /, '') + '). Quản lý sẽ kiểm tra lại.', true); location.hash = '#don-hang'; load(true);
      }, function (e) { if (!e.handled) fail(e); });
    };
  }
  function slugName(n) { var s = norm(n || 'NV').split(/\s+/).pop() || 'nv'; return s.charAt(0).toUpperCase() + s.slice(1); }

  /* ================================================================ KHÁCH TIỀM NĂNG (hỏi mua nhưng chưa mua) */
  function leadDays(l) { var t = l.lastAt || l.time; return t ? Math.max(0, Math.round((today() - dayStart(t)) / DAY)) : 0; }
  /** Tên sản phẩm quan tâm: số từ file QC để tên sheet / chiến dịch thô (“N1_GafoFucoidan”) → “Gafo Fucoidan”. */
  function intLabel(s) { s = String(s || '').trim(); return /^N\d+_/i.test(s) ? s.replace(/^N\d+_+/i, '').replace(/_+/g, ' ').replace(/([a-zà-ỹ])([A-ZÀ-Ỹ])/g, '$1 $2').trim() || s : s; }
  /** Ghi chú khách hỏi: số tiền file QC ghi thô (“Đơn: 900000”) → “Đơn: 900.000đ”. */
  function leadNoteFmt(s) { return String(s || '').replace(/Đơn: (\d{4,})(?![\d.,])/g, function (a, n) { return 'Đơn: ' + money(+n); }); }
  /** Kênh khách hỏi để hiện: số từ file quảng cáo / file sale cũ đều là quảng cáo Facebook (anh Sơn 12/10/2026) → “Facebook Ads”; tên chiến dịch vẫn ở “Quan tâm”. */
  function chLabel(ch) { ch = String(ch || '').trim(); return /^(quảng cáo|file cũ)\s*[–-]/i.test(ch) ? 'Facebook Ads' : /^người quen giới thiệu$/i.test(ch) ? REF_CH : ch || 'Khác'; }
  /* ---------- 🎁 Khách giới thiệu (20/10/2026): khách hỏi kênh “Khách giới thiệu” ghi SĐT người giới thiệu (refPhone);
   *  đơn web dùng mã giới thiệu của khách cũ cũng có refPhone (api/src/partner.js). Gom lại: ai giới thiệu bao nhiêu người, bao nhiêu người đã mua, doanh thu mang về
   *  (tổng tiền các người được giới thiệu đã mua, không tính đơn huỷ / hoàn) → tặng quà cảm ơn. Chỉ tính trên dữ liệu người dùng được xem. */
  var REF_CH = 'Khách giới thiệu';
  function isRefCh(ch) { return chLabel(ch) === REF_CH; }
  function refWho(phone, name) { var c = phone && cust(phone), ld = !c && phone ? leadsOf(phone)[0] : null; return (c && c.name) || name || (ld && ld.name) || fPhone(phone) || 'Người giới thiệu'; }
  function refStats() {
    if (S._refs && S._refs.l === S.d.leads && S._refs.o === S.d.orders && S._refs.c === S.d.customers) return S._refs.v;
    var by = {}, of = {};
    var add = function (rp, rn, ph, name, t) {
      rp = normPhone(rp); ph = normPhone(ph); if (!rp || !ph || rp === ph) return;
      if (!of[ph] || t < of[ph].time) of[ph] = { phone: rp, name: rn || '', time: t };
      var r = by[rp] || (by[rp] = { phone: rp, name: '', ppl: {} }); if (!r.name && rn) r.name = rn;
      if (!r.ppl[ph] || t < r.ppl[ph].time) r.ppl[ph] = { phone: ph, name: name || '', time: t };
    };
    (S.d.leads || []).forEach(function (l) { if (l.refPhone) add(l.refPhone, l.refName, l.phone, l.name, l.time || 0); });
    (S.d.orders || []).forEach(function (o) { if (o.refPhone && !isVoid(o.status)) add(o.refPhone, '', o.phone, o.name, o.time || 0); });
    var sum = { refs: 0, n: 0, bought: 0, rev: 0 };
    Object.keys(by).forEach(function (k) {
      var r = by[k];
      r.list = Object.keys(r.ppl).map(function (p) { var x = r.ppl[p], c = cust(p); x.orders = c ? c.orders : 0; x.spent = c ? c.spent : 0; if (c && c.name) x.name = c.name; return x; }).sort(function (a, b) { return b.time - a.time; });
      r.n = r.list.length; r.bought = r.list.filter(function (x) { return x.orders > 0; }).length; r.rev = r.list.reduce(function (s0, x) { return s0 + x.spent; }, 0);
      r.gifts = logOf(k).filter(function (x) { return x.what === 'Cảm ơn giới thiệu'; });
      r.giftWait = (S.d.orders || []).filter(function (o) { return normPhone(o.refPhone) === k && !o.refGift && !isVoid(o.status); });
      sum.refs++; sum.n += r.n; sum.bought += r.bought; sum.rev += r.rev;
    });
    S._refs = { l: S.d.leads, o: S.d.orders, c: S.d.customers, v: { by: by, of: of, sum: sum } };
    return S._refs.v;
  }
  /** Ai giới thiệu số này (null nếu không ai). */
  function refByOf(phone) { return refStats().of[normPhone(phone)] || null; }
  /** Dòng giới thiệu trên thẻ khách (bộ lọc 🎁 Đã giới thiệu khách). */
  function refLine(c) {
    var r = refStats().by[c.phone]; if (!r) return '';
    return '<div class="rw-ref">🎁 Giới thiệu <b>' + r.n + ' người</b> · ' + r.bought + ' đã mua · mang về <b>' + moneyShort(r.rev) + '</b> · ' + (r.gifts.length ? '✓ đã tặng quà ' + r.gifts.length + ' lần' : '<span class="warn-line">chưa tặng quà cảm ơn</span>') + '</div>';
  }
  /** Ô 🎁 trong hồ sơ khách: được ai giới thiệu + đã giới thiệu những ai (bấm tên để mở), nút tặng quà cảm ơn theo đơn của người được giới thiệu. */
  function refIntroBox(c) {
    var by = refByOf(c.phone), r = refStats().by[c.phone], h = '';
    if (by) h += '<div class="notice info">🎁 Khách này được <button type="button" class="link" data-cust="' + by.phone + '"' + (cust(by.phone) ? '' : ' disabled') + '><b>' + esc(refWho(by.phone, by.name)) + '</b></button> giới thiệu' + (by.time ? ' (' + fDate(by.time) + ')' : '') + '.</div>';
    if (!r) return h;
    return h + '<div class="box ref-intro"><h3>🎁 Đã giới thiệu ' + r.n + ' người</h3>' +
      '<div class="p-val"><div><b>' + r.n + '</b><span>người</span></div><div><b>' + r.bought + '</b><span>đã mua</span></div><div><b>' + moneyShort(r.rev) + '</b><span>doanh thu mang về</span></div></div>' +
      '<div class="ref-ppl">' + r.list.map(function (x) { var c2 = cust(x.phone); return '<div><button type="button" class="link"' + (c2 ? ' data-cust="' + x.phone + '"' : ' disabled') + '>' + esc(x.name || fPhone(x.phone)) + '</button><span class="small muted">' + fDate(x.time).slice(0, 5) + ' · ' + (x.orders ? x.orders + ' đơn · ' + moneyShort(x.spent) : 'chưa mua') + '</span></div>'; }).join('') + '</div>' +
      '<p class="small" style="margin:8px 0 0">' + (r.gifts.length ? '✓ Đã tặng quà cảm ơn ' + r.gifts.length + ' lần, gần nhất ' + fDate(r.gifts[0].time) + ': ' + esc(r.gifts[0].result) : '<span class="warn-line">Chưa tặng quà cảm ơn.</span>') + '</p>' +
      (r.giftWait.length ? '<div class="steps" style="margin-top:8px">' + r.giftWait.slice(0, 3).map(function (o) { return '<button type="button" class="btn pri" data-refgift="' + esc(o.id) + '">🎁 Cảm ơn vì giới thiệu ' + esc(o.name) + '</button>'; }).join('') + '</div>' : '') + '</div>';
  }
  /** Biểu tượng + tên nguồn khách (lần đầu biết đến / mua lần đầu). */
  function srcIcon(s) { return s === 'Website' ? '🌐 ' : s === REF_CH ? '🎁 ' : s === 'Facebook Ads' ? '📘 ' : /^ebook/i.test(s) ? '🎁 ' : /zalo/i.test(s) ? '💬 ' : /tiktok/i.test(s) ? '🎵 ' : '📍 '; }
  /** Nguồn khách để hiện (giống custSource ở api/): máy chủ tính lại theo lịch ban ngày, dữ liệu cũ còn ghi nguồn thô của đơn đầu
   *  (“File Thu Phương – lên đơn”, “chatgpt.com”…) → quy đổi luôn ở đây. Anh Sơn 12/10/2026: khách nhập từ file sale / trước 13/10 = Facebook Ads. */
  var SRC_CUT = Date.parse('2026-10-13T00:00:00+07:00');
  function custSrc(c) {
    var s = String((c && c.source) || '').trim(), m = s.match(/^(Nhập tay|Tiềm năng)\s*[–-]\s*(.*)$/), k; if (!s) return '';
    if (/^file /i.test(s) || (m && (c.first || 0) < SRC_CUT)) return 'Facebook Ads';
    if (m) { k = norm(m[2]); return /facebook|\bfb\b|messenger|instagram|quang cao/.test(k) ? 'Facebook Ads' : /web/.test(k) ? 'Website' : /zalo/.test(k) ? 'Zalo' : /tiktok/.test(k) ? 'TikTok' : m[2].trim() || 'Khác'; }
    if (/\.|\s\/\s|truy cập trực tiếp/i.test(s)) return 'Website'; // nguồn thô của đơn web (utm / trang giới thiệu)
    return s;
  }
  function srcChip(c) { var s = custSrc(c); return s ? '<span class="src-chip" title="Nguồn khách: nơi khách đến lần đầu (theo đơn đầu tiên)">' + srcIcon(s) + esc(s) + '</span>' : ''; }
  /** Khách hỏi là khách cũ thật: đã mua trước lúc hỏi. Khách hỏi rồi mua lần đầu thì vẫn là khách mới. */
  function leadIsReask(l, c) { return !!(c && c.first && c.first < (l.time || 0) - 3600e3); }
  var REASK_TAG = '<span class="tag reask" title="Khách đã mua trước lúc hỏi, nay hỏi lại">🔁 Khách cũ hỏi lại</span>';
  function leadTags(l, c) { return leadIsReask(l, c) ? REASK_TAG : leadTag(l) + (c && l.status === 'Đã chốt' ? '<span class="tag" title="Lần hỏi này là lần đầu khách mua">🆕 Khách mới</span>' : ''); }
  /** Cùng 1 số + cùng 1 mã đơn đã chốt (khách để lại số 2 lần / file nhập trùng) → chỉ giữ 1 thẻ, lượt hỏi gần nhất. */
  function dedupLeads(arr) {
    var keep = {}, out = [];
    arr.forEach(function (l) { if (l.status !== 'Đã chốt' || !l.orderId) return; var k = normPhone(l.phone) + '|' + l.orderId, o = keep[k]; if (!o || (l.time || 0) > (o.time || 0)) keep[k] = l; });
    arr.forEach(function (l) { if (l.status !== 'Đã chốt' || !l.orderId || keep[normPhone(l.phone) + '|' + l.orderId] === l) out.push(l); });
    return out;
  }
  function leadTag(l) { return '<span class="tag ' + (LEAD_CLS[l.status] || '') + '">' + esc(l.status) + '</span>'; }
  /** Khách hỏi "Đã chốt" mà chưa thấy đơn thật: chỉ ghi "chốt" trong file quảng cáo, hoặc đơn đã huỷ / hoàn.
   *  Có đơn thật = hồ sơ khách đã mua có đơn (không huỷ / hoàn) từ ngày hỏi. Sale chỉ thấy khách của mình nên không có hồ sơ thì không kết luận. */
  function leadNoOrder(l) {
    if (l.status !== 'Đã chốt') return '';
    var c = cust(l.phone); if (!c && lvl() < 2) return '';
    if (c && (c.last || 0) >= dayStart(l.time || 0)) return '';
    var o = l.orderId && findOrder(l.orderId);
    return o && isVoid(o.status) ? 'void' : 'none';
  }
  function leadAge(l) {
    if (l.status === 'Đã chốt') {
      var no = leadNoOrder(l);
      return '<span class="age ok">🛒 Đã chốt đơn' + (l.orderId ? ' ' + esc(l.orderId) : '') + '</span>' +
        (no === 'void' ? '<span class="age bad" title="Đơn này đã huỷ / hoàn nên khách chưa được tính là khách đã mua. Mở đơn để kiểm tra, khách còn mua thì lên đơn mới.">⚠️ Đơn đã huỷ / hoàn</span>'
          : no ? '<span class="age bad" title="Khách được ghi “chốt” nhưng chưa có đơn nào trong CRM từ ngày hỏi, nên chưa nằm ở tab Khách đã mua. Bấm thẻ → Chốt đơn hoặc tạo đơn cho số này.">⚠️ Chưa có đơn trong hệ thống</span>' : '');
    }
    if (l.status === 'Không mua') return '<span class="age-miss">✕ Không mua' + (l.reason ? ': ' + esc(l.reason) : '') + '</span>';
    if (l.time && dayStart(l.time) > today() + DAY) return '<span class="age bad" title="Ngày hỏi sau hôm nay: file số quảng cáo gõ nhầm ngày (vd 11/3 thành 3/11). Bấm Sửa nếu cần.">⚠️ Ngày hỏi sai (' + fDate(l.time) + ')</span>';
    var d = leadDays(l), lv = d <= 2 ? 'ok' : d <= 7 ? 'mid' : 'bad';
    return '<span class="age ' + lv + '">🕑 ' + (l.lastAt ? (d === 0 ? 'Vừa liên hệ hôm nay' : d + ' ngày chưa liên hệ') : (d === 0 ? 'Mới hỏi hôm nay' : 'Hỏi ' + d + ' ngày, chưa liên hệ')) + '</span>';
  }
  function leadDueLine(l) {
    var w = leadDue(l);
    if (w === 'new') return '<span class="warn-line">🆕 Chưa liên hệ lần nào – gọi / nhắn ngay</span>';
    if (w === 'callback') { var late = Math.round((today() - dayStart(l.callback)) / DAY); return '<span class="warn-line">📞 Hẹn liên hệ lại ' + (late > 0 ? '– đã quá ' + late + ' ngày' : 'hôm nay') + '</span>'; }
    if (w === 'stale') return '<span class="bad-line">Đã ' + leadDays(l) + ' ngày chưa liên hệ lại</span>';
    if (isOpenLead(l) && l.callback) return 'Hẹn liên hệ lại ' + fDate(l.callback);
    return '';
  }
  function lastNote(l) { var n = leadNoteFmt(l.note).trim().split('\n').filter(Boolean); return n.length ? n[n.length - 1].replace(/^\[[^\]]*\]\s*/, '') : ''; }
  function leadCard(l) {
    var open = isOpenLead(l), due = leadDueLine(l), note = lastNote(l), c = cust(l.phone);
    return '<div class="card click" data-lead="' + esc(l.id) + '">' +
      '<div class="r1"><b>' + esc((c && c.name) || l.name || 'Khách') + '</b>' + leadTags(l, c) + (c ? custTags(c) : '') + (l.owner ? (lvl() >= 2 || l.owner !== S.user.name ? '<span class="tag owner">👤 ' + esc(l.owner) + '</span>' : '') : '<span class="tag noconsent">Chưa ai phụ trách</span>') + '<span class="end small muted" title="' + esc(l.channel) + '">' + srcIcon(chLabel(l.channel)) + esc(chLabel(l.channel)) + '</span></div>' +
      '<div class="r2">' + cpPhone(l.phone) + (leadProv(l) ? ' · 📍 ' + esc(leadProv(l).old) : '') + (l.interest ? ' · Quan tâm: ' + esc(intLabel(l.interest)) : '') + (l.refPhone || l.refName ? ' · 🎁 ' + esc(refWho(l.refPhone, l.refName)) + ' giới thiệu' : '') + '</div>' +
      '<div class="r-age">' + leadAge(l) + (c ? '<button type="button" class="age-miss link-cust" data-cust="' + c.phone + '" title="Mở hồ sơ khách đã mua">👤 ' + c.orders + ' đơn · ' + moneyShort(c.spent) + ' · mua gần nhất ' + daysAgo(c.last) + ' ›</button>' : '') + '</div>' +
      (due || note ? '<div class="r3">' + due + (due && note ? '<br>' : '') + (note ? '📝 ' + esc(note.length > 90 ? note.slice(0, 90) + '…' : note) : '') + '</div>' : '') +
      (isMkt() ? '' : open ? '<div class="acts"><button class="btn pri" data-consult="' + esc(l.id) + '">💬 Tư vấn</button><a class="btn" href="tel:' + l.phone + '">📞 Gọi</a><button class="btn" data-leadorder="' + esc(l.id) + '">🛒 Chốt đơn</button>' + (!l.owner && isPoolStaff() ? claimBtn('l', l.id) : '') + '</div>'
        : leadNoOrder(l) ? '<div class="acts"><button class="btn" data-leadorder="' + esc(l.id) + '">🛒 Lên đơn</button><a class="btn" href="tel:' + l.phone + '">📞 Gọi</a></div>' : '') +
      '</div>';
  }
  var DUE_RANK = { 'new': 0, 'callback': 1, 'stale': 2 };
  function sortLeads(arr) {
    return arr.sort(function (a, b) {
      var da = leadDue(a), db = leadDue(b), ra = da ? DUE_RANK[da] : 9, rb = db ? DUE_RANK[db] : 9;
      return ra - rb || (b.lastAt || b.time || 0) - (a.lastAt || a.time || 0);
    });
  }
  var LF = [
    { k: 'due', l: 'Cần liên hệ', f: function (l) { return !!leadDue(l); } },
    { k: 'open', l: 'Đang theo dõi', f: isOpenLead },
    { k: 'mine', l: 'Của tôi', f: function (l) { return l.owner === S.user.name; } },
    { k: 'nogiao', l: '🧺 Chờ giao', f: function (l) { return isOpenLead(l) && !l.owner; } }, // quản lý / Marketing: khách chưa ai phụ trách (khách web chờ quản lý giao)
    { k: 'Mới hỏi', l: 'Mới hỏi', f: function (l) { return l.status === 'Mới hỏi'; } },
    { k: 'Đang tư vấn', l: 'Đang tư vấn', f: function (l) { return l.status === 'Đang tư vấn'; } },
    { k: 'Đã chốt', l: 'Đã chốt', f: function (l) { return l.status === 'Đã chốt'; } },
    { k: 'Không mua', l: 'Không mua', f: function (l) { return l.status === 'Không mua'; } },
    { k: 'noorder', l: '⚠️ Chốt chưa có đơn', f: function (l) { return !!leadNoOrder(l); } },
    { k: 'all', l: 'Tất cả', f: function () { return true; } }
  ];
  function leadChannels() { var n = {}; (S.d.leads || []).forEach(function (l) { var k = chLabel(l.channel); n[k] = (n[k] || 0) + 1; }); return Object.keys(n).sort(function (a, b) { return n[b] - n[a]; }); }
  /** Tỉnh của khách hỏi: lấy từ dòng “📍 …” sale ghi lúc tư vấn (khách hỏi chưa có địa chỉ). */
  function leadProv(l) {
    if (l._pvn === l.note) return l._pv; l._pvn = l.note;
    var m = String(l.note || '').match(/📍\s*([^\n–;,]+)/g), last = m && m[m.length - 1].replace(/^📍\s*/, '');
    l._pv = last ? provOf({ address: last }) : null; return l._pv;
  }
  function leadHit(l, words) {
    var pv = leadProv(l), t = ' ' + norm([l.name, l.interest, l.channel, l.owner, l.note, pv ? pv.old + ' ' + pv.nw : ''].join(' ')).replace(/[.,;:\-–()/]/g, ' ').replace(/\s+/g, ' ') + ' ';
    return words.every(function (w) { return t.indexOf(w) >= 0; });
  }
  /** Danh sách tên tỉnh (cũ + mới) để chọn nhanh. */
  /** Chữ viết tắt tên tỉnh để gõ nhanh: chữ cái đầu mỗi chữ (hn, hcm, hp, dn, qn…) + vài cách gọi quen. Ghép vào ô k của addrPick. */
  var PROV_ABBR = { 'Hồ Chí Minh': 'tphcm sg sgn saigon', 'Bà Rịa - Vũng Tàu': 'brvt', 'Bà Rịa': 'brvt', 'Vũng Tàu': 'brvt', 'Thừa Thiên Huế': 'tth', 'Đắk Lắk': 'daklak', 'Đắk Nông': 'daknong' };
  function provAbbr(n) {
    var w = norm(n).replace(/^(tinh|thanh pho) /, '').split(/[\s-]+/).filter(Boolean);
    return (w.length > 1 ? w.map(function (x) { return x.charAt(0); }).join('') : '') + ' ' + (PROV_ABBR[n] || '');
  }
  /** Gợi ý cho ô gõ tìm tỉnh (addrPick): tỉnh mới ghi "gồm cả …", tỉnh cũ ghi "nay thuộc …". */
  function provPickItems() {
    var all = provNames();
    return all.map(function (n) {
      var nw = Object.keys(PROV_MERGE).filter(function (k) { return PROV_MERGE[k].indexOf(n) >= 0; })[0] || n;
      var olds = n === nw ? (PROV_MERGE[nw] || []).filter(function (x) { return x !== nw && all.indexOf(x) >= 0; }) : [];
      return { v: n, a: provAbbr(n), k: provAbbr(n) + ' ' + (n === nw ? olds.map(provAbbr).join(' ') : ''), s: n !== nw ? 'nay thuộc ' + nw : olds.length ? 'gồm cả ' + olds.join(', ') : '' };
    });
  }
  function provNames() { var o = {}; Object.keys(PROV_MERGE).forEach(function (nw) { o[nw] = 1; PROV_MERGE[nw].forEach(function (x) { if (!/^(HCM|TPHCM|TP HCM|HN|HP|Kontum|Daklak|Đaklak|Đăk .*|Dak .*|Bắc Cạn)$/.test(x)) o[x] = 1; }); }); return Object.keys(o).sort(function (a, b) { return a.localeCompare(b, 'vi'); }); }
  function leadsCountText(base) { var f = S.f.t || {}; if (f.q && f.q.trim()) return searchCount(base.length, 'khách hỏi', f.q.trim()); return base.length + ' lượt hỏi · ' + base.filter(isOpenLead).length + ' người đang theo dõi (chưa mua)'; }
  function renderLeadsChips(base, cur) {
    return LF.filter(function (x) { return x.k === 'mine' ? lvl() < 2 && !isMkt() : x.k === 'nogiao' ? lvl() >= 2 || isMkt() : true; }).map(function (x) {
      var n = base.filter(x.f).length; if ((x.k === 'noorder' || x.k === 'nogiao') && !n && cur.k !== x.k) return '';
      return '<button class="chip' + (x.k === cur.k ? ' on' : '') + '" data-tf="' + esc(x.k) + '">' + x.l + ' <em>' + n + '</em></button>';
    }).join('');
  }
  function renderLeadsList(list, n, curK) {
    var sq = S.f.t && S.f.t.q && S.f.t.q.trim();
    if (!list.length) return sq ? searchEmpty('khách hỏi', sq) + (curK !== 'all' ? '<p class="small muted" style="text-align:center">Đang lọc mục “' + ((LF.filter(function (x) { return x.k === curK; })[0] || {}).l || '') + '”. <button type="button" class="link" data-tf="all">Xem mọi mục</button></p>' : '') : empty(curK === 'due' ? 'Không có khách hỏi cần liên hệ 🎉' : 'Chưa có khách nào ở mục này.');
    return '<div class="list cols">' + list.slice(0, n).map(leadCard).join('') + '</div>' +
      (list.length > n ? '<button class="btn more" data-more="t">Xem thêm ' + Math.min(60, list.length - n) + ' khách</button>' : '');
  }
  function renderLeadsPart(appendOnly) {
    var tList = $('#tList');
    if (!tList) { render(); return; }
    var f = S.f.t || (S.f.t = { q: '', k: 'due', n: 60 });
    var q = norm(f.q), qd = q.replace(/\D/g, ''), words = qWords(q), chs = leadChannels(); if (f.ch && chs.indexOf(f.ch) < 0) f.ch = '';
    var base = dedupLeads((S.d.leads || []).filter(function (l) { return (lvl() < 2 || whoOk(l.owner)) && (!f.ch || chLabel(l.channel) === f.ch) && (!q || leadHit(l, words) || (qd.length >= 3 && (l._phoneDigits || l.phone).indexOf(qd) >= 0)); }));
    if ((lvl() >= 2 || isMkt()) && f.k === 'mine') f.k = 'due';
    var cur = LF.filter(function (x) { return x.k === f.k; })[0] || LF[0], list = sortLeads(base.filter(cur.f));

    if (appendOnly) {
      var cols = $('.list.cols', tList);
      var prevN = f.n - 60;
      var nextSlice = list.slice(prevN, f.n);
      if (cols && nextSlice.length) cols.insertAdjacentHTML('beforeend', nextSlice.map(leadCard).join(''));
      var btnMore = $('[data-more=t]', tList);
      if (btnMore) {
        if (list.length > f.n) btnMore.textContent = 'Xem thêm ' + Math.min(60, list.length - f.n) + ' khách';
        else btnMore.remove();
      }
      return;
    }

    var tCount = $('#tCount'); if (tCount) tCount.textContent = leadsCountText(base);
    var tChips = $('#tChips'); if (tChips) tChips.innerHTML = renderLeadsChips(base, cur);
    var tArea = $('#tArea'); if (tArea) tArea.innerHTML = areaBox(q, 'lead') + crossHint(q, qd, false);
    tList.innerHTML = renderLeadsList(list, f.n, f.k);
  }
  function viewLeads() {
    var f = S.f.t || (S.f.t = { q: '', k: 'due', n: 60 });
    var q = norm(f.q), qd = q.replace(/\D/g, ''), words = qWords(q), chs = leadChannels(); if (f.ch && chs.indexOf(f.ch) < 0) f.ch = '';
    var base = dedupLeads((S.d.leads || []).filter(function (l) { return (lvl() < 2 || whoOk(l.owner)) && (!f.ch || chLabel(l.channel) === f.ch) && (!q || leadHit(l, words) || (qd.length >= 3 && (l._phoneDigits || l.phone).indexOf(qd) >= 0)); }));
    if ((lvl() >= 2 || isMkt()) && f.k === 'mine') f.k = 'due';
    var cur = LF.filter(function (x) { return x.k === f.k; })[0] || LF[0], list = sortLeads(base.filter(cur.f));
    return '<div class="page-head"><h1>Khách hỏi</h1><span class="muted" id="tCount">' + esc(leadsCountText(base)) + '</span><div class="grow"></div>' + whoSel() + (isMkt() ? '' : '<button class="btn pri" data-newlead>＋ Thêm khách hỏi</button>') + '</div>' + (isMkt() ? '<p class="small muted">Khách để lại số trên web (nhận ebook, vào nhóm Zalo, form liên hệ). Bạn chỉ xem; quản lý giao khách cho sale ở tab Hôm nay → 🧺 Kho chung.</p>' : '') +
      '<div class="tools"><div class="search">' + I.search + '<input type="search" id="tq" placeholder="Tìm tên, SĐT, sản phẩm…" value="' + esc(f.q) + '"><button type="button" class="search-x" aria-label="Xoá chữ tìm kiếm" title="Xoá">✕</button></div>' +
        '<select id="tch" class="' + (f.ch ? 'on' : '') + '" style="flex:0 0 auto;width:auto" title="Lọc theo kênh khách hỏi"><option value="">📣 Mọi kênh</option>' + chs.map(function (x) { return '<option' + (f.ch === x ? ' selected' : '') + '>' + esc(x) + '</option>'; }).join('') + '</select></div>' +
      offerBanner() + '<div class="chips" id="tChips">' + renderLeadsChips(base, cur) + '</div>' +
      '<div id="tArea">' + (areaBox(q, 'lead') + crossHint(q, qd, false)) + '</div>' +
      '<div id="tList">' + renderLeadsList(list, f.n, f.k) + '</div>';
  }

  function openLead(id, fromRoute) {
    var l = findLead(id); if (!l) return;
    if (!fromRoute) history.pushState(null, '', '#tiem-nang/' + encodeURIComponent(l.id));
    var c = cust(l.phone), open = isOpenLead(l);
    var logs = logOf(l.phone).filter(function (x) { return x.what === 'Tư vấn' || x.what === 'Thêm tiềm năng'; });
    var body = (isMkt() ? '' : '<div class="acts steps" style="margin-bottom:12px">' + (open ? '<button class="btn pri" data-consult="' + esc(l.id) + '">💬 Tư vấn</button>' : '') +
      '<a class="btn" href="tel:' + l.phone + '">📞 Gọi</a><a class="btn zalo" href="' + zalo(l.phone) + '" target="_blank" rel="noopener">Zalo</a>' +
      (open || leadNoOrder(l) ? '<button class="btn" data-leadorder="' + esc(l.id) + '">🛒 ' + (open ? 'Chốt đơn' : 'Lên đơn') + '</button>' : '') + '<button class="btn" data-editlead="' + esc(l.id) + '">✏️ Sửa</button></div>') +
      (c ? '<div class="notice info">👤 Số này đã là khách hàng: <b>' + esc(c.name) + '</b> · ' + c.orders + ' đơn, ' + money(c.spent) + ' <button class="btn" data-cust="' + c.phone + '" style="margin-left:6px">Xem khách</button></div>' : '') + (leadProv(l) ? areaBox(norm(leadProv(l).old), 'lead') : '') +
      (open && leadDueLine(l) ? '<div class="notice">' + leadDueLine(l) + '</div>' : '') +
      (l.refPhone || l.refName ? '<div class="notice info">🎁 Được <b>' + esc(refWho(l.refPhone, l.refName)) + '</b>' + (l.refPhone ? ' (' + fPhone(l.refPhone) + ')' : '') + ' giới thiệu' + (cust(l.refPhone) ? ' <button class="btn" data-cust="' + cust(l.refPhone).phone + '" style="margin-left:6px">Xem người giới thiệu</button>' : '') + '</div>' : '') +
      '<div class="r-age" style="margin:0 0 12px">' + leadAge(l) + '</div>' +
      '<div class="box"><div class="grid-info">' + info('Điện thoại', fPhone(l.phone), false, normPhone(l.phone)) + info('Trạng thái', l.status) + info('Kênh', chLabel(l.channel) + (chLabel(l.channel) !== l.channel ? ' (' + l.channel + ')' : '')) + info('Quan tâm', intLabel(l.interest) || '–') +
      info('Phụ trách', l.owner || '– Chưa ai –') + info('Ngày hỏi', fDate(l.time)) + info('Lần liên hệ gần nhất', l.lastAt ? fDate(l.lastAt) + ' (' + daysAgo(l.lastAt) + ')' : 'chưa liên hệ') +
      info('Hẹn liên hệ lại', l.callback ? fDate(l.callback) : '–') + (l.reason ? info('Lý do không mua', l.reason, true) : '') + (l.orderId ? info('Mã đơn', l.orderId, true, true) : '') + '</div></div>' +
      '<div class="box"><h3>Ghi chú</h3><div class="pre">' + (l.note ? esc(leadNoteFmt(l.note)) : '<span class="muted">Chưa có ghi chú.</span>') + '</div></div>' +
      (open && !isMkt() ? giftBox(giftPerson(l.phone), '') : '') +
      '<div class="box"><h3>Lịch sử tư vấn (' + logs.length + ')</h3>' + (logs.length ? '<div class="timeline">' + logs.map(logItem).join('') + '</div>' : '<p class="muted">Chưa có.</p>') + '</div>';
    modal(cp(l.name, esc(l.name || 'Khách hỏi')) + ' ' + leadTag(l) + (leadIsReask(l, c) ? ' ' + REASK_TAG : ''), body, null, { route: '#tiem-nang', pushed: !fromRoute });
  }

  function ownerOptions(sel, withEmpty) {
    var names = userNames(); if (sel && names.indexOf(sel) < 0) names.push(sel);
    return (withEmpty ? '<option value="">– Chưa ai –</option>' : '') + names.map(function (n) { return '<option' + (n === sel ? ' selected' : '') + '>' + esc(n) + '</option>'; }).join('');
  }
  function productNames() { var seen = {}; return (CFG.products || []).map(function (p) { return p.name; }).filter(function (n) { if (seen[n]) return false; seen[n] = 1; return true; }); }

  /** Thêm mới hoặc sửa thông tin khách hỏi.
   *  20/10/2026: dán số thiếu số 0 (copy từ Sheet / Facebook) → tự thêm 0; số đã có thì hiện ngay thông tin khách (đã mua / đang hỏi) để ghi nối, không tạo trùng;
   *  kênh 🎁 Khách giới thiệu → chọn người giới thiệu (gõ tên hoặc SĐT) để theo dõi ai giới thiệu bao nhiêu người, mang về bao nhiêu doanh thu. */
  function openLeadForm(l) {
    var edit = !!l; l = l || { name: '', phone: '', channel: 'Facebook', interest: '', owner: S.user.name, note: '', callback: null, status: 'Mới hỏi', reason: '', refPhone: '', refName: '' };
    var ref = l.refPhone || l.refName ? { phone: l.refPhone || '', name: l.refName || '' } : null, chSel = chLabel(l.channel);
    var body = '<form id="lfForm" novalidate><div class="box">' +
      '<div class="row2c"><label class="f"><span>Số điện thoại *</span><input type="tel" name="phone" inputmode="tel" autocomplete="off" value="' + esc(l.phone) + '" placeholder="Dán hoặc gõ số, thiếu số 0 máy tự thêm"></label>' +
      '<label class="f"><span>Tên khách</span><input type="text" name="name" value="' + esc(l.name) + '" placeholder="vd: Chị Lan"></label></div><div id="lfHint"></div>' +
      '<div class="row2c"><label class="f"><span>Khách đến từ đâu</span><select name="channel">' + CHANNELS.concat(CHANNELS.indexOf(chSel) < 0 && l.channel ? [l.channel] : []).map(function (c) { return '<option' + (c === chSel || c === l.channel ? ' selected' : '') + '>' + esc(c) + '</option>'; }).join('') + '</select></label>' +
      '<label class="f"><span>Quan tâm sản phẩm</span><input type="text" name="interest" list="lfProducts" value="' + esc(l.interest) + '" placeholder="Chọn hoặc gõ"><datalist id="lfProducts">' + productNames().map(function (n) { return '<option value="' + esc(n) + '">'; }).join('') + '</datalist></label></div>' +
      '<div class="lf-ref" id="lfRef" hidden><span class="lf-ref-t">🎁 Ai giới thiệu khách này?</span><div id="lfRefSel"></div>' +
        '<div id="lfRefFind"><input type="text" id="lfRefQ" autocomplete="off" placeholder="Gõ tên hoặc số điện thoại người giới thiệu"><div class="ref-sug" id="lfRefSug"></div></div>' +
        '<p class="small muted" style="margin:6px 0 0">Ghi đúng người giới thiệu để CRM đếm họ đã giới thiệu bao nhiêu người, mang về bao nhiêu doanh thu → tặng quà cảm ơn.</p></div>' +
      '<div class="row2c"><label class="f"><span>Hẹn liên hệ lại ngày</span><input type="date" name="callback" value="' + (l.callback ? isoDate(l.callback) : '') + '"></label>' +
      (lvl() >= 2 ? '<label class="f"><span>Người phụ trách</span><select name="owner">' + ownerOptions(l.owner, true) + '</select></label>' : '<div class="f"><span>Người phụ trách</span><div class="lf-me">👤 ' + esc(l.owner || S.user.name) + '</div></div>') + '</div>' +
      (edit ? '<div class="row2c"><label class="f"><span>Trạng thái</span><select name="status">' + LEAD_ST.filter(function (s) { return s !== 'Đã chốt' || lvl() >= 2 || l.status === 'Đã chốt' || l.orderId; }).map(function (s) { return '<option' + (s === l.status ? ' selected' : '') + '>' + s + '</option>'; }).join('') + '</select></label>' +
        '<label class="f"><span>Lý do không mua</span><input type="text" name="reason" list="lfReasons" value="' + esc(l.reason) + '"><datalist id="lfReasons">' + LOST_REASONS.map(function (r) { return '<option value="' + r + '">'; }).join('') + '</datalist></label></div>' : '') +
      '<label class="f"><span>' + (edit ? 'Ghi chú' : 'Khách hỏi gì / cần gì') + '</span><textarea name="note" rows="' + (edit ? 5 : 3) + '">' + esc(l.note) + '</textarea></label>' +
      '<p class="err" id="lfErr"></p></div></form>';
    var m = modal(edit ? 'Sửa: ' + esc(l.name) : 'Thêm khách hỏi', body, '<button class="btn" data-close>Huỷ</button><button class="btn pri" id="lfSave">' + (edit ? 'Lưu' : 'Tạo khách hỏi') + '</button>');
    var F = $('#lfForm', m).elements, hint = $('#lfHint', m), save = $('#lfSave', m), touched = {}, lastPh = '';
    ['name', 'interest', 'channel'].forEach(function (k) { F[k].addEventListener('input', function () { touched[k] = 1; }); });

    /* ---- 🎁 người giới thiệu: gõ tên / SĐT → chọn khách có sẵn, hoặc dùng số mới (ghi thêm tên) */
    var refQ = $('#lfRefQ', m), refSug = $('#lfRefSug', m);
    function drawRef() {
      var on = isRefCh(F.channel.value); $('#lfRef', m).hidden = !on;
      $('#lfRefFind', m).hidden = !!ref;
      $('#lfRefSel', m).innerHTML = ref ? '<div class="ref-on"><span>✓ <b>' + esc(refWho(ref.phone, ref.name)) + '</b>' + (ref.phone ? ' · ' + fPhone(ref.phone) : '') + (refStats().by[ref.phone] ? ' · đã giới thiệu ' + refStats().by[ref.phone].n + ' người' : '') + '</span><button type="button" class="link small" id="lfRefX">Đổi người</button></div>' +
        (ref.phone && !cust(ref.phone) && !leadsOf(ref.phone).length ? '<input type="text" id="lfRefName" placeholder="Tên người giới thiệu (vd Chị Hoa)" value="' + esc(ref.name) + '" style="margin-top:8px">' : '') : '';
      var x = $('#lfRefX', m); if (x) x.onclick = function () { ref = null; drawRef(); refQ.value = ''; refSug.innerHTML = ''; refQ.focus(); };
      var rn = $('#lfRefName', m); if (rn) rn.oninput = function () { ref.name = rn.value.trim(); };
    }
    function findRef() {
      var q = norm(refQ.value.trim()), qd = refQ.value.replace(/\D/g, ''), ph = normPhone(F.phone.value), np = normPhone(refQ.value), seen = {}, out = [];
      if (q.length < 2 && qd.length < 3) { refSug.innerHTML = ''; return; }
      var words = q.split(/\s+/).filter(String), qd2 = normPhone(qd), hit = function (name, phone) { return phone !== ph && (qd.length >= 3 ? phone.indexOf(qd) >= 0 || (qd2 !== qd && phone.indexOf(qd2) >= 0) : words.every(function (w) { return norm(name).indexOf(w) >= 0; })); };
      S.d.customers.forEach(function (c) { if (out.length < 6 && !seen[c.phone] && hit(c.name || '', c.phone)) { seen[c.phone] = 1; out.push({ phone: c.phone, name: c.name, sub: c.orders + ' đơn · ' + moneyShort(c.spent) + (c.owner ? ' · 👤 ' + c.owner : '') }); } });
      (S.d.leads || []).forEach(function (x) { var p = normPhone(x.phone); if (out.length < 6 && !seen[p] && hit(x.name || '', p)) { seen[p] = 1; out.push({ phone: p, name: x.name, sub: 'khách hỏi · ' + x.status }); } });
      if (/^0\d{9,10}$/.test(np) && !seen[np] && np !== ph) out.push({ phone: np, name: '', sub: 'số chưa có trong CRM – bấm để dùng số này', isNew: 1 });
      refSug.innerHTML = out.length ? out.map(function (r, i) { var st = refStats().by[r.phone]; return '<button type="button" data-refi="' + i + '">' + (r.isNew ? '＋ ' + fPhone(r.phone) : '<b>' + esc(r.name || 'Khách') + '</b> · ' + fPhone(r.phone)) + '<small>' + esc(r.sub) + (st ? ' · đã giới thiệu ' + st.n + ' người' : '') + '</small></button>'; }).join('')
        : '<p class="small muted" style="margin:4px 0 0">Không thấy ai khớp. Gõ đủ số điện thoại người giới thiệu để dùng số mới.</p>';
      $$('[data-refi]', refSug).forEach(function (b) { b.onclick = function () { var r = out[+b.getAttribute('data-refi')]; ref = { phone: r.phone, name: r.name || '' }; refSug.innerHTML = ''; drawRef(); var rn = $('#lfRefName', m); if (rn) rn.focus(); }; });
    }
    refQ.addEventListener('input', findRef);
    F.channel.addEventListener('change', function () { drawRef(); if (isRefCh(F.channel.value) && !ref) refQ.focus(); });
    drawRef();

    /* ---- số điện thoại: tự thêm số 0 / bỏ +84, dấu cách; số đã có → hiện thông tin khách ngay */
    function fixPhone() {
      var raw = F.phone.value, n = normPhone(raw);
      if (raw !== n && /^0\d{9,10}$/.test(n)) { var add0 = raw.replace(/\D/g, '').charAt(0) !== '0'; F.phone.value = n; if (add0) toast('Đã tự thêm số 0 ở đầu: ' + fPhone(n)); }
    }
    function check() {
      fixPhone();
      var ph = normPhone(F.phone.value), ok = /^0\d{9,10}$/.test(ph); if (ph === lastPh) return; lastPh = ph;
      var c = ok && cust(ph), ol = ok && (S.d.leads || []).filter(function (x) { return normPhone(x.phone) === ph && isOpenLead(x) && x.id !== l.id; })[0], by = ok && refByOf(ph);
      save.disabled = false;
      if (!edit) save.textContent = ol ? 'Ghi thêm vào khách này' : c ? 'Lưu lượt hỏi lại' : 'Tạo khách hỏi';
      if (!ok) { hint.innerHTML = ''; return; }
      if (!c && !ol) {
        hint.innerHTML = edit ? '' : '<p class="lf-new">✨ Số mới, chưa có trong CRM. Bấm <b>Tạo khách hỏi</b> để tạo hồ sơ mới.</p>';
        if (lvl() < 2) checkPhone(ph, function (r) { if (r && r.status === 'other' && normPhone(F.phone.value) === ph) { hint.innerHTML = '<p class="lf-new bad">' + ownerWarn(r) + '</p>'; save.disabled = true; } });
        return;
      }
      var cl = c ? custStats(c, ordersOf(c.phone)) : null;
      hint.innerHTML = '<div class="lf-found"><div class="lf-f1">' + (c ? '👤 Khách đã mua: <b>' + esc(c.name || 'Khách') + '</b>' + custTags(c) : '🙋 Đang là khách hỏi: <b>' + esc(ol.name || 'Khách') + '</b>') + '</div>' +
        (c ? '<div class="lf-f2">🛒 <b>' + c.orders + ' đơn · ' + moneyShort(c.spent) + '</b> · mua gần nhất ' + daysAgo(c.last) + (cl && cl.top ? ' · hay mua ' + esc(cl.top) : '') + ' · ' + (c.owner ? '👤 ' + esc(c.owner) : 'chưa ai phụ trách') + '</div>' : '') +
        (ol ? '<div class="lf-f2">🙋 ' + leadTag(ol) + ' · hỏi ' + daysAgo(ol.time) + ' qua ' + esc(chLabel(ol.channel)) + (ol.interest ? ' · quan tâm ' + esc(intLabel(ol.interest)) : '') + ' · ' + (ol.owner ? '👤 ' + esc(ol.owner) : 'chưa ai phụ trách') + (lastNote(ol) ? '<br>📝 ' + esc(lastNote(ol).slice(0, 120)) : '') + '</div>' : '') +
        (by ? '<div class="lf-f2">🎁 Được <b>' + esc(refWho(by.phone, by.name)) + '</b> giới thiệu</div>' : '') +
        '<div class="lf-acts">' + (c ? '<button type="button" class="btn" data-cust="' + c.phone + '">👤 Mở hồ sơ khách</button>' : '') + (ol ? '<button type="button" class="btn" data-lead="' + esc(ol.id) + '">🙋 Xem khách hỏi</button><button type="button" class="btn pri" data-consult="' + esc(ol.id) + '">💬 Tư vấn ngay</button>' : '') + '</div>' +
        (edit ? '' : '<p class="small muted" style="margin:8px 0 0">' + (ol ? 'Bấm <b>Ghi thêm vào khách này</b>: nội dung khách hỏi được ghi nối vào khách hỏi đang có, không tạo trùng.' : 'Khách cũ hỏi lại: bấm <b>Lưu lượt hỏi lại</b> để tạo lượt hỏi mới, vẫn giữ người phụ trách cũ.') + '</p>') + '</div>';
      if (edit) return;
      var nm = (c && c.name) || (ol && ol.name); if (nm && !touched.name) F.name.value = nm;
      if (ol && ol.interest && !touched.interest) F.interest.value = ol.interest;
      if (ol && ol.channel && !touched.channel) { var cv = chLabel(ol.channel); if (CHANNELS.indexOf(cv) >= 0) F.channel.value = cv; }
      if (F.owner && (c || ol)) { var ow = (ol && ol.owner) || (c && c.owner); if (ow) F.owner.value = ow; }
      if (by && !ref) ref = { phone: by.phone, name: by.name || '' };
      drawRef();
    }
    F.phone.addEventListener('input', check); F.phone.addEventListener('blur', check);
    if (edit) check(); else setTimeout(function () { F.phone.focus(); }, 60);
    save.onclick = function () {
      var err = $('#lfErr', m), ph = normPhone(F.phone.value);
      if (!/^0\d{9,10}$/.test(ph)) { err.textContent = 'Số điện thoại chưa đúng (10 số, bắt đầu bằng 0).'; F.phone.focus(); return; }
      var isRef = isRefCh(F.channel.value);
      if (isRef && !ref && refQ.value.trim()) { err.textContent = 'Bấm chọn người giới thiệu trong danh sách gợi ý (hoặc xoá chữ ở ô người giới thiệu).'; refQ.focus(); return; }
      if (isRef && ref && ref.phone === ph) { err.textContent = 'Người giới thiệu không thể là chính khách này.'; return; }
      var p = { id: edit ? l.id : '', phone: ph, name: F.name.value.trim() || 'Khách ' + ph.slice(-4), channel: F.channel.value, interest: F.interest.value.trim(), owner: F.owner ? F.owner.value : S.user.name, callback: F.callback.value, note: F.note.value.trim(),
        refPhone: isRef && ref ? ref.phone : '', refName: isRef && ref ? (ref.name || (cust(ref.phone) || {}).name || '') : '' };
      if (edit) { p.status = F.status.value; p.reason = F.reason.value.trim(); if (p.status === 'Không mua' && !p.reason) { err.textContent = 'Ghi lý do khách không mua giúp em nhé.'; return; } }
      var btn = this, label = btn.textContent; btn.disabled = true; btn.textContent = 'Đang lưu…';
      api('lead_save', p).then(function (j) {
        closeModal(true); if (edit) history.replaceState(null, '', '#tiem-nang');
        toast(j.merged ? 'Số này đã có – đã ghi nối vào khách cũ ✓' : 'Đã lưu ✓');
        if (!edit && location.hash.indexOf('#tiem-nang') !== 0 && location.hash.indexOf('#hom-nay') !== 0) location.hash = '#tiem-nang';
        load(true);
      }, function (e) { btn.disabled = false; btn.textContent = label; err.textContent = e.message; });
    };
  }

  /** Tư vấn: gửi tin mẫu → ghi kết quả → (chốt đơn / không mua / hẹn lần sau). */
  function openConsult(id) {
    var l = findLead(id); if (!l) return;
    var tp = S.d.templates, ti = -1;
    if (!l.lastAt) tp.forEach(function (t, i) { if (ti < 0 && norm(t[0]).indexOf('khach moi hoi') >= 0) ti = i; });
    var fill = function (text) { return fillTpl(text, { name: l.name, products: [l.interest || 'sản phẩm bên em'] }); };
    var body = '<div class="box"><div style="display:flex;gap:8px;align-items:center;flex-wrap:wrap"><b>' + cp(l.name) + '</b> ' + leadTag(l) + ' <span class="muted">' + cpPhone(l.phone) + ' · ' + esc(chLabel(l.channel)) + '</span></div>' +
      '<div class="small muted" style="margin-top:4px">' + (l.interest ? 'Quan tâm: ' + esc(l.interest) + ' · ' : '') + 'hỏi ' + daysAgo(l.time) + (lastNote(l) ? '<br>📝 ' + esc(lastNote(l)) : '') + '</div></div>' +
      '<div class="box"><label class="f" style="margin:0"><span>📍 Khách ở tỉnh nào? <em class="muted" style="font-style:normal;font-weight:400">(hỏi khách rồi gõ, máy cho biết bên mình đã có bao nhiêu khách ở đó)</em></span><input type="text" id="cProv" autocomplete="off" placeholder="Gõ để tìm, vd: nghe an" value="' + esc(leadProv(l) ? leadProv(l).old : '') + '"></label><div id="cArea" style="margin-top:8px"></div></div>' +
      '<div class="box"><h3>Bước 1 · Nhắn / gọi cho khách</h3>' +
      '<label class="f"><span>Mẫu tin</span><select id="cTpl"><option value="-1">– Tự viết –</option>' + tp.map(function (t, i) { return '<option value="' + i + '"' + (i === ti ? ' selected' : '') + '>' + esc(t[0] + (t[1] ? ' – ' + t[1] : '')) + '</option>'; }).join('') + '</select></label>' +
      '<label class="f"><span>Nội dung (sửa được)</span><textarea id="cMsg" rows="5">' + esc(ti >= 0 ? fill(tp[ti][2]) : '') + '</textarea></label>' +
      '<div class="steps"><button class="btn zalo" id="cZalo">📋 Copy tin & mở Zalo</button><a class="btn" href="tel:' + l.phone + '">📞 Gọi</a></div></div>' +
      giftBox(giftPerson(l.phone), 'lead') +
      '<div class="box"><h3>Bước 2 · Khách thế nào? Bấm 1 nút là xong</h3>' +
      '<label class="f"><span>Ghi chú lần này (không bắt buộc, gõ trước rồi bấm nút)</span><textarea id="cNote" rows="2" placeholder="Khách nói gì, băn khoăn gì…"></textarea></label>' +
      '<div class="quick">' + [['📵 Không nghe máy', 'Không nghe máy'], ['🤔 Đang cân nhắc', 'Đã tư vấn, khách cân nhắc'], ['🛒 Chốt mua', 'Khách chốt mua']].map(function (x) { return '<button type="button" class="btn" data-cq="' + esc(x[1]) + '">' + x[0] + '</button>'; }).join('') + '</div>' +
      '<div class="k-cb"><span>📅 Hẹn liên hệ lại:</span>' + [[1, 'Mai'], [3, '3 ngày'], [7, '1 tuần']].map(function (x) { return '<button type="button" class="chip" data-cqd="' + x[0] + '">' + x[1] + '</button>'; }).join('') + '</div>' +
      '<div class="k-cb"><span>🚫 Không mua vì:</span>' + LOST_REASONS.map(function (r) { return '<button type="button" class="chip" data-cqr="' + esc(r) + '">' + esc(r) + '</button>'; }).join('') + '</div>' +
      '<details class="k-more"><summary>Chọn kết quả khác / tự chọn ngày</summary><div style="margin-top:10px"><div class="radios" style="margin-bottom:12px">' + LEAD_RESULTS.map(function (r) { return '<label><input type="radio" name="cRes" value="' + esc(r.v) + '"><span>' + esc(r.v) + '</span></label>'; }).join('') + '</div>' +
      '<div id="cLost" hidden><label class="f"><span>Lý do không mua *</span><select id="cReason"><option value="">– Chọn –</option>' + LOST_REASONS.map(function (r) { return '<option>' + r + '</option>'; }).join('') + '</select></label></div>' +
      '<p class="notice info" id="cClose" hidden>Bấm <b>Lưu</b> → mở ngay form tạo đơn cho khách.</p>' +
      '<label class="f" id="cCbWrap"><span>Hẹn liên hệ lại ngày</span><input type="date" id="cCb" min="' + isoDate(Date.now()) + '"></label>' +
      '<button class="btn pri" id="cSave" style="width:100%">Lưu</button></div></details><p class="err" id="cErr"></p></div>';
    var m = modal('Tư vấn: ' + esc(l.name), body, '<button class="btn" data-close>Để sau</button>');
    var msg = $('#cMsg', m), lnD = 'draft_l_' + l.id; draftKeep($('#cNote', m), lnD);
    $('#cTpl', m).onchange = function () { var i = +this.value; msg.value = i >= 0 ? fill(tp[i][2]) : ''; };
    $('#cZalo', m).onclick = function () { copy(msg.value).then(function () { toast('Đã copy – dán vào khung chat Zalo'); }); window.open(zalo(l.phone), '_blank', 'noopener'); };
    var provIn = $('#cProv', m), showArea = function () { var v = provIn.value.trim(), pv = v && provOf({ address: v }); $('#cArea', m).innerHTML = pv ? areaBox(norm(pv.old), 'consult') : v.length >= 3 ? '<p class="small muted" style="margin:0">Chưa nhận ra tỉnh – chọn trong danh sách gợi ý nhé.</p>' : ''; };
    provIn.oninput = showArea; showArea();
    addrPick(provIn, provPickItems, showArea); // gõ không dấu, tên tỉnh cũ hay mới đều ra (giống form lên đơn)
    // Đợt 3: nút 1 chạm giống cửa sổ Chăm sóc – chọn sẵn kết quả (+ ngày hẹn / lý do) rồi lưu luôn
    var pick = function (v, days, reason) {
      var r = $('input[name=cRes][value="' + v + '"]', m); if (!r) return; r.checked = true; r.onchange();
      if (days) $('#cCb', m).value = isoDate(Date.now() + days * DAY);
      if (reason) { var sel = $('#cReason', m); if (![].some.call(sel.options, function (o) { return o.value === reason; })) sel.insertAdjacentHTML('beforeend', '<option>' + esc(reason) + '</option>'); sel.value = reason; }
      $('#cSave', m).click();
    };
    $$('[data-cq]', m).forEach(function (b) { b.onclick = function () { pick(b.getAttribute('data-cq')); }; });
    $$('[data-cqd]', m).forEach(function (b) { b.onclick = function () { pick('Hẹn liên hệ lại', +b.getAttribute('data-cqd')); }; });
    $$('[data-cqr]', m).forEach(function (b) { b.onclick = function () { pick('Khách không mua', 0, b.getAttribute('data-cqr')); }; });
    $$('input[name=cRes]', m).forEach(function (r) {
      r.onchange = function () {
        var o = LEAD_RESULTS.filter(function (x) { return x.v === r.value; })[0];
        $('#cLost', m).hidden = !o.lost; $('#cClose', m).hidden = !o.close; $('#cCbWrap', m).hidden = !!(o.lost || o.close);
        if (o.days) $('#cCb', m).value = isoDate(Date.now() + o.days * DAY);
      };
    });
    $('#cSave', m).onclick = function () {
      var res = $('input[name=cRes]:checked', m), err = $('#cErr', m);
      if (!res) { err.textContent = 'Bạn chọn kết quả giúp nhé.'; return; }
      var o = LEAD_RESULTS.filter(function (x) { return x.v === res.value; })[0], reason = $('#cReason', m).value;
      if (o.lost && !reason) { err.textContent = 'Chọn lý do khách không mua giúp em nhé.'; return; }
      var pvNew = provOf({ address: provIn.value.trim() }), pvOld = leadProv(l), note0 = $('#cNote', m).value.trim();
      if (pvNew && (!pvOld || pvOld.old !== pvNew.old)) note0 = '📍 ' + pvNew.old + (note0 ? ' – ' + note0 : ''); // lưu tỉnh vào ghi chú (Sheet khách hỏi chưa có cột tỉnh)
      var p = { id: l.id, result: o.v, note: note0, callback: o.lost || o.close ? '' : $('#cCb', m).value, status: o.lost ? 'Không mua' : 'Đang tư vấn', reason: reason };
      var btn = this; btn.disabled = true; btn.textContent = 'Đang lưu…';
      api('lead_contact', p).then(function (j) {
        store(lnD, null); l.status = j.status; l.lastAt = j.at; l.owner = j.owner || l.owner; l.callback = p.callback ? new Date(p.callback + 'T09:00:00+07:00').getTime() : null;
        if (o.lost) l.reason = reason;
        if (p.note) l.note = (l.note ? l.note + '\n' : '') + '[' + fDate(j.at).slice(0, 5) + ' ' + S.user.name + '] ' + p.note;
        addLog({ loc: 1, time: j.at, by: S.user.name, what: 'Tư vấn', ref: l.phone, name: l.name, result: o.v, note: p.note });
        closeModal(true); if (route().id) history.replaceState(null, '', '#' + route().view);
        navBadges(); render();
        if (o.close) openOrderForm({ lead: l }); else toast('Đã lưu ✓');
      }, function (e) { btn.disabled = false; btn.textContent = 'Lưu'; err.textContent = e.message; });
    };
  }

  /* ================================================================ HIỆU QUẢ (nhân viên xem của mình, quản lý xem thêm cả nhóm) */
  function careWhat() { if (!CARE_WHAT) { CARE_WHAT = {}; Object.keys(TASK_LOG).forEach(function (k) { CARE_WHAT[TASK_LOG[k]] = 1; }); CARE_WHAT['Ghi nhanh'] = 1; } return CARE_WHAT; }
  function monthOf(t) { var x = vnDate(t); return x.y + '-' + pad(x.m); }
  function monthRange(key) { var y = +key.slice(0, 4), m = +key.slice(5, 7); return [Date.UTC(y, m - 1, 1) - 7 * 3600e3, Date.UTC(y, m, 1) - 7 * 3600e3]; }
  function shiftMonth(key, n) { var y = +key.slice(0, 4), m = +key.slice(5, 7) - 1 + n; y += Math.floor(m / 12); m = ((m % 12) + 12) % 12; return y + '-' + pad(m + 1); }
  function monthLabel(key) { return 'tháng ' + (+key.slice(5, 7)) + '/' + key.slice(0, 4); }
  function targetOf(name, month) { return (S.d.targets || []).filter(function (t) { return t.name === name && t.month === month; })[0] || null; }
  function teamTarget(month) { var s = 0; (S.d.targets || []).forEach(function (t) { if (t.month === month) s += t.amount; }); return s; }
  function pct(a, b) { return b ? Math.round(a * 100 / b) : 0; }

  /* ---------------- Bộ lọc thời gian dùng chung: Hôm nay / Hôm qua / 7 ngày qua / Tháng này / Tháng trước / Tuỳ chỉnh */
  var PER = [['today', 'Hôm nay'], ['yday', 'Hôm qua'], ['d7', '7 ngày qua'], ['month', 'Tháng này'], ['lmonth', 'Tháng trước']];
  /* Mốc thêm cho Tổng quan / Marketing (chủ doanh nghiệp xem theo tuần họp, tháng, quý, năm). Năm nay không so kỳ trước: CRM chỉ tải đơn 13 tháng gần nhất. */
  var PER_X = [['d30', '30 ngày qua'], ['week', 'Tuần này'], ['lweek', 'Tuần trước'], ['quarter', 'Quý này'], ['lquarter', 'Quý trước'], ['year', 'Năm nay']];
  var PER_CEO = ['today', 'yday', 'week', 'month', 'lmonth', 'quarter', 'year'];
  function weekStart(t) { var dow = new Date(t + 7 * 3600e3).getUTCDay(); return t - ((dow + 6) % 7) * DAY; } // thứ Hai
  function quarterOf(mk, n) { var y = +mk.slice(0, 4), m = +mk.slice(5, 7) - 1, q = Math.floor(m / 3) + (n || 0), yy = y + Math.floor(q / 4), qq = ((q % 4) + 4) % 4; return yy + '-' + pad(qq * 3 + 1); } // tháng đầu quý
  /** Nút chọn nhanh 1 chạm (Tổng quan, Marketing) + 📅 Khác (tự chọn ngày). Dưới là ngày cụ thể và đang so với kỳ nào. */
  function perChips(slot, p, extra, noCmp) { // extra: thêm nút cuối ('all' = Mọi lúc); noCmp: tab không so kỳ trước (Đơn hàng)
    var ks = PER_CEO.concat(extra || []), R = perRange(p), on = ks.indexOf(p.k) >= 0;
    return '<div class="per-q" role="group" aria-label="Thời gian">' + ks.map(function (k) { return '<button type="button" class="chip' + (p.k === k ? ' on' : '') + '" data-pq="' + slot + '|' + k + '">' + perLabel({ k: k }) + '</button>'; }).join('') +
      '<button type="button" class="chip' + (on ? '' : ' on') + '" data-per="' + slot + '">📅 ' + (on ? 'Khác' : esc(perLabel(p))) + '</button></div>' +
      '<p class="small muted per-q-d">' + (p.k === 'all' ? 'Từ trước tới nay' : perDates(R)) + (noCmp ? '' : CMP_LABEL ? ' · so với ' + CMP_LABEL : p.k === 'year' ? ' · năm nay chưa so với năm trước' : '') + '</p>' + (noCmp ? '' : statKey(slot));
  }
  /** Chú thích ngay trên màn hình thống kê: màu đèn, ▲▼, đường nhỏ, ô bấm được. Nhìn là hiểu, không phải mở hướng dẫn.
   *  Đèn chỉ có ở Tổng quan (g), Hiệu quả (r), Marketing (m); Sàn, Link & QR chỉ có ▲▼ và đường nhỏ. */
  function statKey(slot) {
    var lights = /^[grm]$/.test(slot), spk = '<svg viewBox="0 0 24 10" aria-hidden="true"><polyline points="0,8 6,5 11,7 17,2 24,3"/></svg>';
    return '<div class="stat-key">' + (lights ? '<span>🟢 Tốt</span><span>🟠 Cần để ý</span><span>🔴 Cần xử lý</span><span class="sk-sep"></span>' : '') +
      '<span><b class="sk-up">▲</b><b class="sk-dn">▼</b> so với ' + esc(CMP_LABEL || 'kỳ trước') + ': xanh là tốt hơn, đỏ là kém hơn</span>' +
      '<span class="sk-spk">' + spk + ' đường nhỏ: số lên hay xuống trong kỳ này</span>' + (lights ? '<span>› bấm vào ô để xem chi tiết</span>' : '') + '</div>';
  }
  /** Khoảng [từ, đến) theo giờ VN của 1 lựa chọn thời gian p = { k, from, to }. */
  function perRange(p) {
    var t0 = today(), mk = monthOf(Date.now());
    switch (p && p.k) {
      case 'all': return [0, Infinity];
      case 'today': return [t0, t0 + DAY];
      case 'yday': return [t0 - DAY, t0];
      case 'd7': return [t0 - 6 * DAY, t0 + DAY];
      case 'd30': return [t0 - 29 * DAY, t0 + DAY];
      case 'lmonth': return monthRange(shiftMonth(mk, -1));
      case 'week': return [weekStart(t0), weekStart(t0) + 7 * DAY];
      case 'lweek': return [weekStart(t0) - 7 * DAY, weekStart(t0)];
      case 'quarter': return [monthRange(quarterOf(mk))[0], monthRange(shiftMonth(quarterOf(mk), 2))[1]];
      case 'lquarter': return [monthRange(quarterOf(mk, -1))[0], monthRange(quarterOf(mk))[0]];
      case 'year': return [monthRange(mk.slice(0, 4) + '-01')[0], monthRange(mk.slice(0, 4) + '-12')[1]];
      case 'custom': return [p.from, p.to];
      default: return monthRange(mk);
    }
  }
  function perDates(R) { if (!R[0] && R[1] === Infinity) return ''; var a = fDate(R[0]), b = fDate(R[1] - 1); return a === b ? a : a.slice(0, 5) + ' – ' + b; }
  function perLabel(p) { if (p.k === 'all') return 'Mọi lúc'; if (p.k === 'custom') return perDates(perRange(p)); var x = PER.concat(PER_X).filter(function (z) { return z[0] === p.k; })[0]; return x ? x[1] : 'Tháng này'; }
  /** 📅 Khác: chỉ các mốc KHÔNG có sẵn trên hàng nút (7 / 30 ngày qua, tuần trước, quý trước) + tự chọn từ ngày – đến ngày (hiện sẵn). */
  var PER_MORE = [['d7', '7 ngày qua'], ['d30', '30 ngày qua'], ['lweek', 'Tuần trước'], ['lquarter', 'Quý trước']];
  function openPer(slot) {
    var f = S.f[slot], p = f.p || { k: 'month' }, R = p.k === 'custom' ? perRange(p) : null;
    var body = '<p class="per-h">Xem nhanh</p><div class="per-more">' + PER_MORE.map(function (o) { return '<button type="button" class="chip' + (p.k === o[0] ? ' on' : '') + '" data-pk="' + o[0] + '">' + o[1] + '<small>' + perDates(perRange({ k: o[0] })) + '</small></button>'; }).join('') + '</div>' +
      '<p class="per-h">📆 Tự chọn ngày</p><div class="row2c"><label class="f"><span>Từ ngày</span><input type="date" id="perFrom" value="' + (R ? isoDate(R[0]) : isoDate(monthRange(monthOf(Date.now()))[0])) + '" max="' + isoDate(Date.now()) + '"></label>' +
      '<label class="f"><span>Đến ngày</span><input type="date" id="perTo" value="' + (R ? isoDate(R[1] - 1) : isoDate(Date.now())) + '"></label></div><p class="err" id="perErr"></p><button type="button" class="btn pri" id="perOk" style="width:100%">Xem</button>';
    var m = modal('Chọn thời gian khác', body, '<button class="btn per-back" data-close>Đóng</button>');
    var set = function (np) { f.p = np; if (slot === 'o') f.n = 60; closeModal(); render(); };
    $$('[data-pk]', m).forEach(function (b) { b.onclick = function () { set({ k: b.getAttribute('data-pk') }); }; });
    $('#perOk', m).onclick = function () {
      var a = $('#perFrom', m).value, b = $('#perTo', m).value, err = $('#perErr', m);
      if (!a || !b) { err.textContent = 'Chọn đủ ngày bắt đầu và ngày kết thúc giúp em nhé.'; return; }
      var from = dayStart(new Date(a + 'T12:00:00+07:00').getTime()), to = dayStart(new Date(b + 'T12:00:00+07:00').getTime()) + DAY;
      if (to <= from) { err.textContent = 'Ngày kết thúc phải sau ngày bắt đầu.'; return; }
      set({ k: 'custom', from: from, to: to });
    };
  }

  /** Số liệu của 1 nhân viên (name) hoặc cả nhóm (name = null) trong khoảng thời gian R. */
  function careMetrics(c, p, me, name, R) {
    // đường nhỏ: không vẽ Chăm sóc ra đơn / Tỷ lệ hoàn (tính theo 14 ngày sau, hoàn về muộn → cuối kỳ luôn thấp)
    var CB = R ? trendBuckets(R) : null, PF = CB ? trendEachMemo('perf' + name, CB, function (r) { return perf(name, r); }) : null, csk = function (f, bad) { return PF ? sparkSvg(trendPick(PF, f), CB.partial, bad) : ''; };
    return '<section class="section"><div class="section-h"><h2>💬 Chăm sóc khách</h2></div><div class="metrics">' +
      metric('Lượt chăm sóc', c.care, (c.replyPct === null ? 'Chưa có lượt nào.' : 'Kết nối được ' + c.replyPct + '% (' + c.replied + '/' + c.care + ' lượt khách nghe máy / trả lời).'), delta(c.care, p.care), '', csk('care')) +
      metric('Chăm sóc ra đơn', c.convPct === null ? '–' : c.convPct + '%', c.conv + ' / ' + c.contacted + ' khách được chăm sóc đã mua trong 14 ngày sau đó · ' + moneyShort(c.convRev) + '. Số này cho biết chăm sóc có ra tiền không.', c.convPct === null ? '' : delta(c.convPct, p.convPct, 'rate')) +
      metric('Khách quay lại mua', c.repeat, 'Số khách cũ đã mua lại trong thời gian đã chọn.', delta(c.repeat, p.repeat), '', csk('repeat')) +
      metric('Tỷ lệ hoàn đơn', c.backPct === null ? '–' : c.backPct + '%', c.backN + ' đơn hoàn · ' + moneyShort(c.backV) + '. Gọi xác nhận kỹ trước khi gửi, đơn lớn nên nhờ chuyển khoản trước.', c.backPct === null ? '' : delta(c.backPct, p.backPct, 'rate')) +
      (function () { var cs = S.d.customers.filter(function (x) { return x.orders && !coldOf(x) && (!me || x.owner === S.user.name); }), inN = cs.filter(inComm).length, invN = cs.filter(invited).length;
        return metric('Khách trong nhóm cộng đồng', cs.length ? pct(inN, cs.length) + '%' : '–', inN + ' / ' + cs.length + ' khách đã vào nhóm Zalo “Sống khỏe cùng Thực Dưỡng Lành”' + (invN ? ' · ' + invN + ' khách đã mời, chưa vào' : '') + '. Mời ở mốc hỏi nhận hàng / hỏi thăm 1 tuần, hoặc lọc 👥 Chưa vào cộng đồng.', ''); })() +
      metric('VIP sắp mất chưa gọi', c.vipRisk, (c.vipRisk ? 'Khách VIP 61–180 ngày chưa mua và hơn 30 ngày chưa nói chuyện. Nên gọi trước tiên.' : 'Tốt lắm, khách VIP đều được chăm sóc.'), '', me && c.vipRisk ? '#khach-hang" data-vipgo="1' : '') +
      '</div></section>';
  }
  /** Danh sách thanh ngang (xếp hạng): 1 màu, đầu thanh bo 4px, số ghi cạnh thanh, rê chuột xem chi tiết. */
  function barList(items, fmt, empt, o) {
    if (!items.length) return '<p class="muted">' + (empt || 'Chưa có số liệu.') + '</p>';
    o = o || {}; var mx = Math.max.apply(null, items.map(function (x) { return x.v; }).concat(o.avg || 0)) || 1;
    var avg = o.avg ? '<u class="avg" style="left:' + (o.avg * 100 / mx).toFixed(1) + '%"></u>' : '';
    return '<div class="bars' + (o.avg !== undefined ? ' cmp' : '') + '" role="table">' + items.map(function (x) {
      return '<div class="bar-r' + (x.muted ? ' mut' : '') + (x.who ? ' click' : '') + '" role="row" title="' + esc(x.tip || '') + '"' + (x.who ? ' data-who="' + esc(x.who) + '"' : '') + '><span class="bar-l" role="cell">' + esc(x.l) + '</span><span class="bar-t" role="cell"><i style="width:' + Math.max(1.5, x.v * 100 / mx) + '%"></i>' + avg + '</span><span class="bar-v" role="cell">' + (x.txt !== undefined ? x.txt : fmt(x.v)) + (x.sub && !o.below ? '<small>' + esc(x.sub) + '</small>' : '') + '</span></div>' + ((x.sub || x.subH) && o.below ? '<div class="bar-q dash-sub">' + (x.subH || esc(x.sub)) + '</div>' : '') +
        (x.quotes && x.quotes.length ? '<div class="bar-q">' + x.quotes.map(function (q) { return '“' + esc(q) + '”'; }).join(' · ') + '</div>' : '');
    }).join('') + '</div>';
  }
  function geoBlock(name, cx) {
    var f = S.f.r || {}, by = f.pvm || 'cnt', scope = f.pvs || 'all', R = cx.R;
    var list = S.d.customers.filter(function (c) { return (name === null || c.owner === name) && (scope === 'all' || (c.first >= R[0] && c.first < R[1])); });
    var g = {}, none = { v: 0, n: 0 }; list.forEach(function (c) { var pv = provOf(c), val = by === 'rev' ? c.spent : 1; if (!pv) { none.v += val; none.n++; return; } var x = g[pv.nw] || (g[pv.nw] = { v: 0, n: 0, olds: {} }); x.v += val; x.n++; x.olds[pv.old] = (x.olds[pv.old] || 0) + 1; });
    var rows = Object.keys(g).map(function (k) { var x = g[k], olds = Object.keys(x.olds).filter(function (o) { return o !== k; }); return { l: k, v: x.v, sub: by === 'rev' ? x.n + ' khách' : '', tip: k + ': ' + x.n + ' khách' + (olds.length ? ' · gồm ' + olds.map(function (o) { return o + ' ' + x.olds[o]; }).join(', ') : '') }; }).sort(function (a, b) { return b.v - a.v; });
    var top = rows.slice(0, 10), rest = rows.slice(10), restV = rest.reduce(function (s0, x) { return s0 + x.v; }, 0);
    if (rest.length) top.push({ l: rest.length + ' tỉnh khác', v: restV, muted: true, tip: rest.map(function (x) { return x.l + ' ' + (by === 'rev' ? moneyShort(x.v) : x.v); }).join(', ') });
    if (none.n) top.push({ l: 'Chưa rõ tỉnh', v: none.v, muted: true, tip: none.n + ' khách địa chỉ thiếu tỉnh hoặc gõ sai' });
    var fmt = by === 'rev' ? moneyShort : function (v) { return v + ' khách'; }, total = list.length;
    var chip = function (k, v, l) { return '<button class="chip' + ((k === 'pvm' ? by : scope) === v ? ' on' : '') + '" data-rf="' + k + '|' + v + '">' + l + '</button>'; };
    return '<section class="section"><div class="section-h"><h2>📍 Khách theo tỉnh / thành</h2><span class="tip">' + total + ' khách · gộp theo 34 tỉnh mới, rê chuột để xem tỉnh cũ</span></div>' +
      '<div class="chips">' + chip('pvs', 'all', 'Tất cả khách') + chip('pvs', 'new', 'Khách mới ' + cx.label.toLowerCase()) + chip('pvm', 'cnt', 'Số khách') + chip('pvm', 'rev', 'Doanh số') + '</div>' +
      '<div class="box">' + barList(top, fmt, 'Chưa có khách nào trong phạm vi này.') + (rows.length ? '<p class="small muted" style="margin:8px 0 0">Nhiều nhất: <b>' + esc(rows[0].l) + '</b> (' + pct(rows[0].v, rows.reduce(function (s0, x) { return s0 + x.v; }, 0) + none.v) + '% ' + (by === 'rev' ? 'doanh số' : 'khách') + '). Dùng để chọn vùng chạy quảng cáo, giờ gọi và đơn vị vận chuyển phù hợp.</p>' : '') + '</div></section>';
  }
  function whyBlock(name, cx) {
    var f = S.f.r || {}, period = f.why || 'month', R = cx.R, inR = function (t) { return period === 'all' || (t && t >= R[0] && t < R[1]); }, me = function (n) { return name === null || n === name; };
    var b = {}, add = function (k, text, t) { if (!k) return; var x = b[k] || (b[k] = { v: 0, q: [] }); x.v++; if (text) x.q.push({ t: t || 0, s: text }); }, miss = 0;
    var CW = careWhat();
    S.d.log.forEach(function (l) {
      if (!CW[l.what] || !me(l.by) || !inR(l.time)) return;
      if (l.result === NO_REPLY) { miss++; return; }
      if (l.result === 'Đã đặt lại') return;
      var n = String(l.note || '').replace(/\s*[–-]\s*hẹn gọi lại \d{1,2}\/\d{1,2}(\/\d{2,4})?$/, '').trim(), k = whyOf(n) || (l.result === 'Không có nhu cầu' ? WHY[8][0] : null); add(k, n, l.time);
    });
    var LR = { 'Giá cao': WHY[6][0], 'Chưa có nhu cầu': WHY[8][0], 'Đã mua nơi khác': WHY[2][0] };
    (S.d.leads || []).forEach(function (l) { if (l.status !== 'Không mua' || !me(l.owner) || !inR(l.lastAt || l.time) || /dữ liệu cũ|rác/i.test(l.reason || '')) return; var k = LR[l.reason] || whyOf(l.note) || null; add(k, (l.note || l.reason || '').split('\n')[0].slice(0, 80), l.lastAt || l.time); });
    if (period === 'all') S.d.customers.forEach(function (c) { if (!me(c.owner)) return; noteEntries(c.note).forEach(function (e) { var k = whyOf(e.text); if (k) add(k, e.text, e.time); else if (/(^|[^a-z])(knm|tb)([^a-z]|$)|thue bao/.test(norm(e.text))) miss++; }); });
    var rows = WHY.map(function (w) { var x = b[w[0]]; return x ? { l: w[0], v: x.v, quotes: x.q.sort(function (a, c2) { return c2.t - a.t; }).map(function (q) { return q.s.slice(0, 70); }).filter(function (q, i, arr) { return q && arr.map(norm).indexOf(norm(q)) === i; }).slice(0, 3), tip: 'Bấm xem câu khách nói' } : null; }).filter(Boolean).sort(function (a, c2) { return c2.v - a.v; });
    var tot = rows.reduce(function (s0, x) { return s0 + x.v; }, 0);
    var chip = function (v, l) { return '<button class="chip' + (period === v ? ' on' : '') + '" data-rf="why|' + v + '">' + l + '</button>'; };
    return '<section class="section"><div class="section-h"><h2>🙅 Lý do khách chưa mua / từ chối</h2><span class="tip">máy tự gom từ ghi chú khi chăm sóc và lý do “không mua” của khách hỏi</span></div>' +
      '<div class="chips">' + chip('month', cx.label) + chip('all', 'Toàn bộ (cả ghi chú cũ từ Sheet)') + '</div>' +
      '<div class="box">' + barList(rows, function (v) { return v + ' lần' + (tot ? ' · ' + pct(v, tot) + '%' : ''); }, 'Chưa có ghi chú lý do nào. Khi chăm sóc, gõ vài chữ khách nói vào “Ghi chú lần này” (vd “kh hết tiền”, “dùng bên khác”) để máy gom.') +
      '<p class="small muted" style="margin:8px 0 0">Ngoài ra: <b>' + miss + '</b> lượt không nghe máy / thuê bao. Lý do nhiều nhất là chỗ cần chuẩn bị câu trả lời (vd hết tiền → gợi ý hộp nhỏ, chia đợt; còn hàng → hẹn đúng ngày sắp hết).</p></div></section>';
  }
  /** Tỷ lệ chốt = data quảng cáo đã ra đơn ÷ tổng data quảng cáo. Data quảng cáo = từng dòng có SĐT trong file số quảng cáo (S.d.adRows, máy chủ đọc
   *  khi lấy số: [đầu ngày, SĐT, sale, nguồn]; dòng quên ghi ngày theo ngày ghi gần nhất phía trên), ngày trong kỳ, sale = name; 1 SĐT nhiều lần trong
   *  kỳ chỉ tính 1. Ra đơn = SĐT có đơn không huỷ / hoàn từ đầu ngày có số (kể cả đơn ngoài CRM, khách tự đặt web) hoặc khách hỏi của số đó "Đã chốt".
   *  Không mua / số rác theo khách hỏi của số đó. Data gần đây còn đang tư vấn nên tỷ lệ kỳ đó tăng dần. */
  function buyMap() {
    var o = S.d.orders; if (S.d._buyFor === o && S.d._buyLen === o.length) return S.d._buy;
    var any = {}; o.forEach(function (x) { if (x.time && x.phone && !isVoid(x.status)) (any[x.phone] = any[x.phone] || []).push(x.time); });
    S.d._buyFor = o; S.d._buyLen = o.length; return (S.d._buy = any);
  }
  function closeStats(name, R) {
    var B = buyMap(), seen = {}, r = { data: 0, won: 0, lost: 0, junk: 0, open: 0 };
    (S.d.adRows || []).forEach(function (a) {
      var day = a[0], ph = a[1];
      if (day < R[0] || day >= R[1] || (name !== null && a[2] !== name) || seen[ph]) return;
      seen[ph] = 1;
      var ls = leadsOf(ph).filter(function (l) { return (l.lastAt || l.time || 0) >= day; });
      var won = (B[ph] || []).some(function (t) { return t >= day; }) || ls.some(function (l) { return l.status === 'Đã chốt'; });
      var no = !won && ls.filter(function (l) { return l.status === 'Không mua'; })[0];
      var k = won ? 'won' : no ? (/rác/i.test(no.reason || '') ? 'junk' : 'lost') : 'open';
      r.data++; r[k]++;
    });
    r.pct = r.data ? pct(r.won, r.data) : null; return r;
  }
  function closeTxt(c) { return c.data ? c.won + ' ra đơn / ' + c.data + ' data quảng cáo' + (c.lost ? ' · ' + c.lost + ' không mua' : '') + (c.junk ? ' · ' + c.junk + ' số rác' : '') + (c.pending ? ' · <b>' + c.pending + ' đang tư vấn</b> (bấm để cập nhật)' : '') : 'Chưa có data quảng cáo trong kỳ'; }
  function perf(name, R) {
    var CW = careWhat(), inR = function (t) { return t && t >= R[0] && t < R[1]; }, me = function (n) { return name === null || n === name; };
    var os = S.d.orders.filter(function (o) { return !isVoid(o.status) && inR(o.time) && me(o.seller); });
    var vos = S.d.orders.filter(function (o) { return isVoid(o.status) && inR(o.time) && me(o.seller); }), vV = vos.reduce(function (s, o) { return s + (o.total || 0); }, 0); // hoàn / huỷ
    var sales = os.reduce(function (s, o) { return s + o.total; }, 0), paid = os.reduce(function (s, o) { return s + (isPaidOrder(o) ? o.total : 0); }, 0);
    var old = os.filter(function (o) { var c = cust(o.phone); return c && c.first && c.first < o.time - 3600e3; });
    var oldRev = old.reduce(function (s, o) { return s + o.total; }, 0);
    var cs = closeStats(name, R);
    var care = S.d.log.filter(function (l) { return CW[l.what] && me(l.by) && inR(l.time); });
    var replied = care.filter(function (l) { return l.result && l.result !== NO_REPLY; }).length;
    var mine = S.d.customers.filter(function (c) { return name === null ? true : c.owner === name; }); // (dùng cho khách VIP sắp mất)
    // chăm sóc ra đơn: khách được chăm sóc trong kỳ rồi có đơn trong 14 ngày sau lần chăm sóc đầu tiên
    var firstCare = {}; care.forEach(function (l) { var ph = String(l.ref).replace(/^'/, ''); if (!firstCare[ph] || l.time < firstCare[ph]) firstCare[ph] = l.time; });
    var conv = 0, convRev = 0; Object.keys(firstCare).forEach(function (ph) { var t = firstCare[ph], hit = S.d.orders.filter(function (o) { return o.phone === ph && !isVoid(o.status) && o.time > t && o.time <= t + 14 * DAY; }); if (hit.length) { conv++; convRev += hit.reduce(function (s0, o) { return s0 + o.total; }, 0); } });
    var allOs = S.d.orders.filter(function (o) { return inR(o.time) && me(o.seller) && o.status !== 'Huỷ'; }), back = allOs.filter(function (o) { return /hoàn/i.test(o.status); });
    var repeat = {}; old.forEach(function (o) { repeat[o.phone] = 1; });
    var webOs = os.filter(isWebOrder), webRev = webOs.reduce(function (s0, o) { return s0 + o.total; }, 0);
    var vipRisk = mine.filter(function (c) { return isVip(c) && stageOf(c) === 'risk' && !coldOf(c) && replyOf(c).days > 30; }).length;
    return { contacted: Object.keys(firstCare).length, conv: conv, convRev: convRev, convPct: Object.keys(firstCare).length ? pct(conv, Object.keys(firstCare).length) : null, backN: back.length, backPct: allOs.length ? pct(back.length, allOs.length) : null, backV: back.reduce(function (s0, o) { return s0 + o.total; }, 0), repeat: Object.keys(repeat).length, vipRisk: vipRisk, web: webOs.length, webOf: os.length, webRev: webRev, webPct: pct(webOs.length, os.length),
      gross: sales + vV, grossN: os.length + vos.length, vN: vos.length, vV: vV, vPct: os.length + vos.length ? pct(vos.length, os.length + vos.length) : null,
      sales: sales, paid: paid, orders: os.length, avg: os.length ? Math.round(sales / os.length) : 0, oldRev: oldRev, oldPct: pct(oldRev, sales), won: cs.won, lost: cs.lost, junk: cs.junk, pending: cs.open, data: cs.data, closePct: cs.pct,
      care: care.length, replied: replied, replyPct: care.length ? pct(replied, care.length) : null, reorder: care.filter(function (l) { return l.result === 'Đã đặt lại'; }).length,
      stale: mine.filter(function (c) { return replyOf(c).days > 30; }).length, mine: mine.length };
  }
  /** Kỳ so sánh: tháng đang chạy → cùng số ngày của tháng trước (1–2/10 so với 1–2/9), tháng đã qua → cả tháng trước. */
  var CMP_LABEL = 'tháng trước';
  function prevRange(month) { var P = monthRange(shiftMonth(month, -1)), R = monthRange(month), now = Date.now(), part = now >= R[0] && now < R[1]; CMP_LABEL = part ? 'cùng kỳ tháng trước' : 'tháng trước'; return part ? [P[0], Math.min(P[1], P[0] + (now - R[0]))] : P; }
  /** Kỳ so sánh theo bộ lọc thời gian: tháng → như trên; còn lại → khoảng liền trước, cùng độ dài (đang chạy thì cắt tới cùng giờ). */
  function cmpRange(p) {
    if (p.k === 'all') { CMP_LABEL = ''; return [0, 0]; } // mọi lúc: không có kỳ để so
    if (p.k === 'month') return prevRange(monthOf(Date.now()));
    if (p.k === 'lmonth') return prevRange(shiftMonth(monthOf(Date.now()), -1));
    var now0 = Date.now(), R0 = perRange(p);
    if (p.k === 'week') { CMP_LABEL = 'cùng kỳ tuần trước'; return [R0[0] - 7 * DAY, Math.min(R0[1], now0) - 7 * DAY]; }
    if (p.k === 'lweek') { CMP_LABEL = 'tuần trước nữa'; return [R0[0] - 7 * DAY, R0[0]]; }
    if (p.k === 'quarter' || p.k === 'lquarter') { // quý đang chạy: cùng số ngày của quý trước; quý đã qua: cả quý trước
      var qs = monthOf(R0[0] + DAY), P0 = monthRange(quarterOf(qs, -1))[0], part = now0 < R0[1];
      CMP_LABEL = part ? 'cùng kỳ quý trước' : 'quý trước'; return [P0, part ? P0 + (now0 - R0[0]) : R0[0]];
    }
    if (p.k === 'year') { CMP_LABEL = ''; return [R0[0] - 365 * DAY, Math.min(R0[1], now0) - 365 * DAY]; } // khoảng hợp lệ cho Analytics / quảng cáo, nhưng không hiện so sánh
    var R = perRange(p), len = R[1] - R[0], now = Date.now();
    CMP_LABEL = p.k === 'today' ? 'cùng giờ hôm qua' : p.k === 'yday' ? 'hôm kia' : p.k === 'd7' ? '7 ngày trước đó' : p.k === 'd30' ? '30 ngày trước đó' : 'kỳ trước (' + perDates([R[0] - len, R[1] - len]) + ')';
    return [R[0] - len, Math.min(R[1], now) - len];
  }
  /** Mũi tên so với tháng trước. kind: 'money' | 'count' | 'rate' (điểm %) */
  function delta(cur, prev, kind) {
    if (!CMP_LABEL) return '';
    if (cur === null || prev === null || prev === undefined) return '<em class="delta">' + CMP_LABEL + ' chưa có số liệu</em>';
    if (kind === 'rate') { var d = cur - prev; return d === 0 ? '<em class="delta">bằng ' + CMP_LABEL + '</em>' : '<em class="delta ' + (d > 0 ? 'up' : 'down') + '">' + (d > 0 ? '▲ ' : '▼ ') + Math.abs(d) + ' điểm so với ' + CMP_LABEL + '</em>'; }
    if (!prev) return cur ? '<em class="delta up">▲ ' + CMP_LABEL + ' chưa có</em>' : '<em class="delta">' + CMP_LABEL + ' chưa có số liệu</em>';
    var p = Math.round((cur - prev) * 100 / prev);
    return p === 0 ? '<em class="delta">bằng ' + CMP_LABEL + '</em>' : '<em class="delta ' + (p > 0 ? 'up' : 'down') + '">' + (p > 0 ? '▲ ' : '▼ ') + Math.abs(p) + '% so với ' + CMP_LABEL + '</em>';
  }
  /** spark = đường xu hướng nhỏ (sparkSvg) đặt cạnh con số. */
  function metric(label, value, explain, d, href, spark) {
    return '<' + (href ? 'a href="' + href + '"' : 'div') + ' class="metric"><span>' + label + '</span>' + (spark ? '<div class="mv"><b>' + value + '</b>' + spark + '</div>' : '<b>' + value + '</b>') + (d || '') + '<small>' + explain + '</small></' + (href ? 'a' : 'div') + '>';
  }

  /** Khối mục tiêu tháng: thanh tiến độ + còn thiếu bao nhiêu + mỗi ngày cần bao nhiêu. */
  function targetBlock(name, month, sales, canEdit) {
    var t = targetOf(name, month), R = monthRange(month), isCur = month === monthOf(Date.now());
    var days = Math.round((R[1] - R[0]) / DAY), elapsed = isCur ? Math.min(days, Math.floor((today() - R[0]) / DAY) + 1) : days;
    var btn = canEdit ? '<button class="btn' + (t ? '' : ' pri') + '" data-target="' + esc(name) + '|' + month + '">🎯 ' + (t ? 'Sửa mục tiêu' : 'Đặt mục tiêu ' + monthLabel(month)) + '</button>' : '';
    if (!t || !t.amount) return '<div class="goal none"><div class="goal-h"><b>🎯 Mục tiêu ' + monthLabel(month) + '</b></div><p>Chưa đặt mục tiêu. Doanh số đến nay: <b>' + money(sales) + '</b>.</p>' + btn + '</div>';
    var p = sales / t.amount, tp = elapsed / days, lv = p >= 1 ? 'done' : p >= tp ? 'ok' : p >= tp * 0.8 ? 'mid' : 'bad';
    var label = { done: '🎉 Đã đạt mục tiêu!', ok: '🟢 Đúng tiến độ', mid: '🟠 Hơi chậm', bad: '🔴 Đang chậm' }[lv];
    var remain = Math.max(0, t.amount - sales), left = days - elapsed + 1, forecast = elapsed ? Math.round(sales / elapsed * days) : 0;
    var lines = [];
    if (isCur && p < 1) lines.push('Còn thiếu <b>' + money(remain) + '</b> trong <b>' + left + ' ngày</b> → mỗi ngày cần khoảng <b>' + moneyShort(Math.ceil(remain / left)) + '</b>.');
    if (isCur && p < 1 && elapsed >= 3) lines.push('Nếu giữ nhịp như hiện nay, cả tháng đạt khoảng <b>' + moneyShort(forecast) + '</b> (' + pct(forecast, t.amount) + '% mục tiêu).');
    if (p >= 1) lines.push('Vượt mục tiêu <b>' + money(sales - t.amount) + '</b>. Tuyệt vời!');
    if (!isCur && p < 1) lines.push('Kết thúc tháng đạt ' + Math.round(p * 100) + '% mục tiêu.');
    return '<div class="goal ' + lv + '"><div class="goal-h"><b>🎯 Mục tiêu ' + monthLabel(month) + '</b><span class="goal-st">' + label + '</span></div>' +
      '<div class="goal-num"><b>' + moneyShort(sales) + '</b> / ' + moneyShort(t.amount) + '<span>' + Math.round(p * 100) + '%</span></div>' +
      '<div class="bar"><i style="width:' + Math.min(100, p * 100).toFixed(1) + '%"></i>' + (isCur ? '<u style="left:' + (tp * 100).toFixed(1) + '%" title="Hôm nay"></u>' : '') + '</div>' +
      (isCur ? '<div class="bar-legend"><span>Vạch đen = hôm nay (ngày ' + elapsed + '/' + days + ')</span></div>' : '') +
      lines.map(function (x) { return '<p>' + x + '</p>'; }).join('') + btn + '</div>';
  }

  /* ================================================================ Tổng quan (chỉ Quản trị): bức tranh kinh doanh + website trên 1 màn hình.
   * Đơn hàng, khách, khách hỏi: tính ngay trên máy từ dữ liệu CRM đã tải (không tốn thêm lượt đọc máy chủ).
   * Website: Google Analytics 4 qua lệnh 'ga' (máy chủ lưu tạm 30 phút – 12 tiếng). */
  var GA = { cache: {}, busy: '', err: '' };
  var GA_CH = { 'Direct': 'Vào thẳng (gõ địa chỉ, bấm link lưu sẵn)', 'Organic Social': 'Mạng xã hội', 'Paid Social': 'Quảng cáo mạng xã hội', 'Organic Search': 'Google tìm kiếm', 'Paid Search': 'Quảng cáo Google', 'Referral': 'Trang web khác giới thiệu', 'Unassigned': 'Chưa rõ nguồn', 'Organic Video': 'Video (YouTube…)', 'Paid Video': 'Quảng cáo video', 'Email': 'Email', 'SMS': 'Tin nhắn SMS', 'Display': 'Quảng cáo hiển thị', 'Cross-network': 'Quảng cáo đa kênh', 'Organic Shopping': 'Sàn / mua sắm', 'Paid Shopping': 'Quảng cáo mua sắm', 'Paid Other': 'Quảng cáo khác', 'Mobile Push Notifications': 'Thông báo đẩy' };
  var GA_DEV = { mobile: '📱 Điện thoại', desktop: '💻 Máy tính', tablet: '📟 Máy tính bảng', 'smart tv': '📺 TV' };
  var FUNNEL_STEPS = [['page_view', 'Vào website'], ['view_item', 'Xem sản phẩm'], ['add_to_cart', 'Thêm vào giỏ'], ['begin_checkout', 'Mở form đặt hàng'], ['purchase', 'Đặt hàng xong']];
  /** Đơn thuộc kênh nào: [nhóm, chi tiết]. Nguồn đơn web = utm_source / medium / campaign do website ghi (main.js sourceLabel). */
  function chanOf(o) {
    var s = String(o.source || '');
    if (/^File /.test(s)) return ['Sale', 'File sale'];
    var m = s.match(/^(Nhập tay|Tiềm năng)\s*[–-]\s*(.*)$/);
    if (m) return [m[1] === 'Nhập tay' ? 'Sale' : 'Khách hỏi', m[2] || 'Khác'];
    return ['Website', srcLabel(s)];
  }
  function srcLabel(s) {
    var n = norm(s), paid = /\b(cpc|ppc|ads?|paid)\b/.test(n);
    if (!n || /truy cap truc tiep/.test(n)) return 'Vào thẳng';
    if (/facebook|\bfb\b|instagram|\big\b|messenger/.test(n)) return paid ? 'Facebook (quảng cáo)' : 'Facebook';
    if (/tiktok/.test(n)) return paid ? 'TikTok (quảng cáo)' : 'TikTok';
    if (/zalo/.test(n)) return 'Zalo';
    if (/google|bing|coccoc/.test(n)) return paid ? 'Google (quảng cáo)' : 'Google tìm kiếm';
    if (/youtube/.test(n)) return 'YouTube';
    return s.split(' / ')[0] || 'Khác';
  }
  function isWebLead(l) { return /website|form website/i.test(l.channel || ''); }
  function oneDec(v) { return (Math.round(v * 10) / 10).toString().replace('.', ','); }
  /** Mũi tên cho tỷ lệ % có 1 số lẻ (delta 'rate' chỉ làm tròn số nguyên). */
  function dRate(cur, prev) {
    if (!CMP_LABEL) return '';
    if (cur === null || prev === null || prev === undefined) return '<em class="delta">' + CMP_LABEL + ' chưa có số liệu</em>';
    var d = Math.round((cur - prev) * 10) / 10;
    return !d ? '<em class="delta">bằng ' + CMP_LABEL + '</em>' : '<em class="delta ' + (d > 0 ? 'up' : 'down') + '">' + (d > 0 ? '▲ ' : '▼ ') + oneDec(Math.abs(d)) + ' điểm so với ' + CMP_LABEL + '</em>';
  }
  /** Số kinh doanh trong khoảng R, từ đơn hàng + khách hỏi trên máy. */
  function bizStats(R) {
    var os = S.d.orders.filter(function (o) { return o.time >= R[0] && o.time < R[1]; }); // doanh số gồm đơn hoàn / huỷ (vN, vRev: phần hoàn / huỷ)
    var s = { n: os.length, rev: 0, vN: 0, vRev: 0, paid: 0, paidN: 0, web: 0, webRev: 0, oldRev: 0, firstN: 0, ch: {}, sub: {}, prod: {}, day: {} }, seen = {};
    os.forEach(function (o) {
      var c = chanOf(o), k = c[0] + ' · ' + c[1], ph = normPhone(o.phone), cu = S.d.byPhone && S.d.byPhone[ph], t = o.total || 0, dk = isoDate(o.time), vd = isVoid(o.status);
      s.rev += t; s.day[dk] = (s.day[dk] || 0) + t; if (vd) { s.vN++; s.vRev += t; } if (isPaidOrder(o)) { s.paid += t; s.paidN++; }
      if (c[0] === 'Website') { s.web++; s.webRev += t; }
      (s.ch[c[0]] = s.ch[c[0]] || { v: 0, n: 0 }).v += t; s.ch[c[0]].n++;
      (s.sub[k] = s.sub[k] || { v: 0, n: 0, g: c[0], l: c[1] }).v += t; s.sub[k].n++;
      if (cu && cu.first && dayStart(cu.first) < dayStart(o.time)) s.oldRev += t;
      else if (ph && !seen[ph] && !vd) { seen[ph] = 1; s.firstN++; }
      parseItems(o.items).forEach(function (i) { if (i.gift) return; var pk = prettyProd(i.name), p = s.prod[pk] || (s.prod[pk] = { q: 0, v: 0 }); p.q += i.qty; p.v += i.qty * i.price; });
    });
    s.avg = s.n ? Math.round(s.rev / s.n) : 0; s.oldPct = s.rev ? pct(s.oldRev, s.rev) : null; s.vPct = s.n ? pct(s.vN, s.n) : null;
    // khách để lại SĐT: bỏ dòng "File cũ – …" (khách cũ đồng bộ từ file sale, thời gian = ngày đồng bộ), mỗi SĐT tính 1 lần (lần hỏi đầu trong kỳ)
    var lp = {}, ls = (S.d.leads || []).filter(function (l) { return l.time >= R[0] && l.time < R[1] && !/^file cũ/i.test(l.channel || ''); })
      .sort(function (a, b) { return a.time - b.time; }).filter(function (l) { var ph = normPhone(l.phone) || l.id; if (lp[ph]) return false; lp[ph] = 1; return true; });
    s.leads = ls.length; s.webLeads = ls.filter(isWebLead).length; s.leadCh = {};
    s.ad = dashAdData(R);
    ls.forEach(function (l) { var k = l.channel || 'Khác'; s.leadCh[k] = (s.leadCh[k] || 0) + 1; });
    return s;
  }
  function gaKey(R, P) { return [isoDate(R[0]), isoDate(Math.min(R[1], Date.now()) - 1), isoDate(P[0]), isoDate(Math.max(P[0] + 1, P[1]) - 1)].join('_'); }
  function gaFetch(key, fresh) {
    if (GA.busy === key) return; GA.busy = key; GA.err = '';
    var k = key.split('_');
    api('ga', { from: k[0], to: k[1], pf: k[2], pt: k[3], fresh: fresh ? 1 : 0 }).then(function (j) { GA.cache[key] = j; }, function (e) {
      GA.err = /Không rõ thao tác/.test(e.message) ? 'Máy chủ đang cập nhật bản mới, anh/chị thử lại sau 2 phút.' : e.message;
    }).then(function () { GA.busy = ''; if (route().view === 'tong-quan') softRender(true); });
  }

  /* ================================================================ Biểu đồ xu hướng (Hiệu quả, Tổng quan, Marketing, Sàn).
   * Đường xanh = kỳ đang xem, đường xám nét đứt = kỳ trước (đặt chồng theo thứ tự ngày / tuần / tháng). 1 trục, rê chuột / chạm để xem số.
   * Nhãn 📈 / ➡️ / 📉 theo đường xu hướng (hồi quy tuyến tính) của các điểm đã trọn: bỏ ngày / tuần / tháng đang chạy dở để khỏi báo "đi xuống" oan. */
  /** Chia khoảng R thành các điểm: ≤ 45 ngày → từng ngày, ≤ 190 ngày → từng 7 ngày, dài hơn → từng tháng. Chỉ tới hôm nay. "Mọi lúc" → 13 tháng gần nhất. */
  function trendBuckets(R) {
    var now = Date.now(), r0 = R[0] || monthRange(shiftMonth(monthOf(now), -12))[0], end = Math.min(R[1], today() + DAY), days = Math.round((end - r0) / DAY), L = [];
    var unit = days <= 45 ? 'day' : days <= 190 ? 'week' : 'month', d5 = function (t) { return fDate(t).slice(0, 5); };
    if (unit === 'day') for (var t = r0; t < end; t += DAY) L.push({ a: t, b: t + DAY, l: d5(t), tip: fDate(t) });
    else if (unit === 'week') for (var w = r0; w < end; w += 7 * DAY) L.push({ a: w, b: Math.min(w + 7 * DAY, end), l: d5(w), tip: 'Tuần ' + d5(w) + ' – ' + d5(Math.min(w + 7 * DAY, end) - 1) });
    else for (var mk = monthOf(r0 + 1); monthRange(mk)[0] < end; mk = shiftMonth(mk, 1)) { var mr = monthRange(mk); L.push({ a: Math.max(r0, mr[0]), b: Math.min(mr[1], end), l: 'T' + (+mk.slice(5)), tip: 'Tháng ' + monthLabel(mk).replace(/^tháng /i, '') }); }
    var last = L[L.length - 1], full = unit === 'day' ? DAY : unit === 'week' ? 7 * DAY : 0;
    return { unit: unit, L: L, r0: r0, partial: !!last && (unit === 'month' ? monthRange(monthOf(last.a))[1] > now : last.a + full > now) && last.a <= now };
  }
  /** Cộng giá trị vào từng điểm. off = lùi về kỳ trước (ms); timeFn / valFn lấy thời điểm, giá trị của 1 dòng. */
  function trendSum(B, items, timeFn, valFn, off) {
    var v = B.L.map(function () { return 0; }); off = off || 0;
    items.forEach(function (it) { var t = timeFn(it) + off; if (!t) return; for (var i = 0; i < B.L.length; i++) if (t >= B.L[i].a && t < B.L[i].b) { v[i] += valFn(it); return; } });
    return v;
  }
  function dayMs(d) { return new Date(d + 'T12:00:00+07:00').getTime(); }
  /** Đi lên / ngang / xuống: độ dốc đường xu hướng × số điểm ÷ trung bình. Dưới ±10% = đi ngang. Cần ≥ 3 điểm trọn. */
  function trendVerdict(vals, partial) {
    var p = partial ? vals.slice(0, -1) : vals.slice(), n = p.length; if (n < 3 || p.filter(function (x) { return x > 0; }).length < 3) return null; // ít hơn 3 điểm có số: chưa kết luận
    var mx = 0, my = 0; p.forEach(function (y, x) { mx += x; my += y; }); mx /= n; my /= n; if (!my) return null;
    var sxy = 0, sxx = 0; p.forEach(function (y, x) { sxy += (x - mx) * (y - my); sxx += (x - mx) * (x - mx); });
    var ch = (sxy / sxx) * (n - 1) / my;
    var a = my - (sxy / sxx) * mx, b = a + (sxy / sxx) * (n - 1); // điểm đầu / cuối đường xu hướng
    return { k: ch >= 0.1 ? 'up' : ch <= -0.1 ? 'down' : 'flat', pct: Math.round(Math.abs(ch) * 100), x: a > 0 && b > 0 ? Math.max(a, b) / Math.min(a, b) : 0 };
  }
  var TRD_WORD = { up: '📈 Đang đi lên', flat: '➡️ Đi ngang', down: '📉 Đang đi xuống' };
  function trendSay(v, what, unit) {
    if (!v) return 'Chưa đủ số liệu để biết xu hướng (cần ít nhất 3 ' + unit + ' có số).';
    if (v.k !== 'flat' && v.x >= 2) return 'Tính theo đường xu hướng, ' + what.toLowerCase() + ' cuối kỳ ' + (v.k === 'up' ? 'gấp khoảng ' + oneDec(v.x) + ' lần đầu kỳ.' : 'chỉ còn khoảng ' + Math.round(100 / v.x) + '% so với đầu kỳ.');
    return v.k === 'flat' ? what + ' gần như giữ nguyên từ đầu tới cuối kỳ (chênh dưới 10%).' : 'Tính theo đường xu hướng, ' + what.toLowerCase() + ' cuối kỳ ' + (v.k === 'up' ? 'cao' : 'thấp') + ' hơn đầu kỳ khoảng ' + v.pct + '%.';
  }
  /** Biểu đồ đường. o = { B, series: [{ v: [..], name, cls: 'cur' | 'prev' | 'alt' }], fmt, what (tên số đang xem, cho câu kết luận), vIdx (series để kết luận, mặc định 0), note } */
  function trendChart(o) {
    var B = o.B, n = B.L.length, S0 = o.series.filter(function (s) { return s && s.v; }), fmt = o.fmt || String;
    if (n < 2) return '<p class="muted small">Chọn khoảng thời gian từ 2 ngày trở lên để xem biểu đồ.</p>';
    var mx = 0; S0.forEach(function (s) { s.v.forEach(function (x) { if (x > mx) mx = x; }); }); mx = mx || 1;
    var nice = function (x) { var p = Math.pow(10, Math.floor(Math.log10(x))), r = x / p; return (r <= 1 ? 1 : r <= 2 ? 2 : r <= 2.5 ? 2.5 : r <= 5 ? 5 : 10) * p; }; mx = nice(mx);
    var X = function (i) { return ((i + 0.5) / n * 1000).toFixed(1); }, Y = function (v) { return (300 - v / mx * 288).toFixed(1); };
    var path = function (v, a, b) { var d = ''; for (var i = a; i <= b; i++) d += (i === a ? 'M' : 'L') + X(i) + ' ' + Y(v[i]); return d; };
    var main = S0[o.vIdx || 0], V = trendVerdict(main.v, B.partial), unitW = { day: 'ngày', week: 'tuần', month: 'tháng' }[B.unit];
    var svg = '<svg viewBox="0 0 1000 300" preserveAspectRatio="none" aria-hidden="true">' + [0.5, 1].map(function (g) { return '<line class="trd-g" x1="0" x2="1000" y1="' + Y(mx * g) + '" y2="' + Y(mx * g) + '"/>'; }).join('') + '<line class="trd-g base" x1="0" x2="1000" y1="300" y2="300"/>';
    S0.slice().reverse().forEach(function (s) {
      var lastFull = B.partial && s.cls !== 'prev' ? n - 2 : n - 1;
      if (s.cls === 'cur') svg += '<path class="trd-a" d="' + path(s.v, 0, n - 1) + 'L' + X(n - 1) + ' 300L' + X(0) + ' 300Z"/>';
      svg += '<path class="trd-l ' + s.cls + '" d="' + path(s.v, 0, Math.max(0, lastFull)) + '"/>';
      if (lastFull < n - 1) svg += '<path class="trd-l ' + s.cls + ' part" d="' + path(s.v, n - 2, n - 1) + '"/>';
    });
    svg += '</svg>';
    var step = Math.ceil(n / 7), hits = B.L.map(function (b, i) {
      return '<div class="trd-hit" tabindex="0"><span class="trd-tip"><b>' + esc(b.tip) + (B.partial && i === n - 1 ? ' (đang chạy)' : '') + '</b>' + S0.map(function (s) { return '<span><i class="trd-k ' + s.cls + '"></i>' + esc(s.name) + ': <b>' + fmt(s.v[i]) + '</b></span>'; }).join('') + '</span></div>';
    }).join('');
    var dots = S0.filter(function (s) { return s.cls !== 'prev'; }).map(function (s) { return '<i class="trd-dot ' + s.cls + '" style="left:' + (X(n - 1) / 10) + '%;bottom:' + (s.v[n - 1] / mx * 96).toFixed(1) + '%"></i>'; }).join('');
    var pv = S0.filter(function (s) { return s.cls === 'prev'; })[0], sum = function (a) { return a.reduce(function (x, y) { return x + y; }, 0); }, cmp = '';
    if (pv && sum(pv.v) > 0) { var dP = Math.round((sum(main.v) - sum(pv.v)) * 100 / sum(pv.v)); cmp = ' Cả kỳ ' + (Math.abs(dP) < 3 ? 'gần bằng kỳ trước.' : (dP > 0 ? 'cao hơn' : 'thấp hơn') + ' kỳ trước ' + Math.abs(dP) + '% (đường xám).'); }
    return '<div class="trd">' + (o.noVerdict ? '' : '<div class="trd-h"><span class="trd-v ' + (V ? V.k : 'none') + '">' + (V ? TRD_WORD[V.k] : '… Chưa rõ') + '</span><small>' + trendSay(V, o.what || 'Số liệu', unitW) + cmp + '</small></div>') +
      '<div class="trd-c"><div class="trd-y"><span style="bottom:96%">' + fmt(mx) + '</span><span style="bottom:48%">' + fmt(mx / 2) + '</span><span style="bottom:0">0</span></div>' +
      '<div class="trd-p">' + svg + dots + '<div class="trd-hits">' + hits + '</div></div></div>' +
      '<div class="trd-x">' + B.L.map(function (b, i) { return '<span>' + (i % step === 0 ? esc(b.l) : '') + '</span>'; }).join('') + '</div>' +
      '<p class="trd-lg">' + S0.map(function (s) { return '<span><i class="trd-k ' + s.cls + '"></i>' + esc(s.name) + '</span>'; }).join('') + '<span class="muted">· mỗi điểm = 1 ' + unitW + (B.partial ? ' · đoạn mờ cuối = ' + unitW + ' đang chạy' : '') + '</span></p>' + (o.note ? '<p class="bar-legend">' + o.note + '</p>' : '') + '</div>';
  }
  /** Đường nhỏ trong ô số / thẻ nhân viên: thấy ngay lên hay xuống. Điểm null (kỳ không có số, vd. tỷ lệ khi chưa có đơn) thì bỏ qua.
   *  bad = true: số càng thấp càng tốt (hoàn / huỷ, chi phí / kết quả): đi lên tô đỏ, đi xuống tô xanh. bad = 'n': trung tính (tiền chi quảng cáo), không tô xanh / đỏ. */
  function sparkSvg(vals, partial, bad) {
    if (partial && vals.length && vals[vals.length - 1] === null) partial = false;
    vals = vals.filter(function (v) { return v !== null && v !== undefined && isFinite(v); });
    var n = vals.length; if (n < 2 || !vals.some(function (v) { return v; })) return ''; // toàn 0: không vẽ
    var mx = Math.max.apply(null, vals) || 1, V = trendVerdict(vals, partial), pts = vals.map(function (v, i) { return (i / (n - 1) * 100).toFixed(1) + ',' + (22 - v / mx * 20).toFixed(1); });
    var cls = V ? (bad === 'n' ? 'neu' : bad && V.k !== 'flat' ? (V.k === 'up' ? 'down' : 'up') : V.k) : 'none';
    return '<span class="spk ' + cls + '" title="' + (V ? TRD_WORD[V.k].slice(3) + ' trong kỳ' + (bad === true && V.k !== 'flat' ? (V.k === 'up' ? ' (chưa tốt)' : ' (tốt)') : '') : 'Chưa đủ số liệu để biết xu hướng') + '"><span class="spk-g"><svg viewBox="0 0 100 24" preserveAspectRatio="none" aria-hidden="true"><polyline points="' + pts.join(' ') + '"/></svg>' + (V ? '<em>' + { up: '↗', flat: '→', down: '↘' }[V.k] + '</em>' : '') + '</span><span class="spk-w">' + (V ? { up: 'đang lên', flat: 'đi ngang', down: 'đang xuống' }[V.k] : 'chưa rõ') + '</span></span>';
  }
  /** Tỷ lệ từng điểm = a ÷ b (× k); điểm không có mẫu số → null. */
  function trendRate(a, b, k) { return a.map(function (x, i) { return b[i] ? x * (k || 1) / b[i] : null; }); }
  /** Chạy fn(khoảng) cho từng điểm của B (dùng cho số phải tính lại cả khối, vd. tỷ lệ chốt). */
  function trendEach(B, fn) { return B.L.map(function (b) { return fn([b.a, b.b]); }); }
  /** Như trendEach nhưng nhớ kết quả (tính lại khi dữ liệu đổi): dùng cho bizStats / perf chạy từng ngày, khỏi tính lại mỗi lần vẽ màn hình. */
  var TREND_MEMO = {};
  function trendEachMemo(key, B, fn) {
    var d = S.d, st = [d.orders.length, (d.leads || []).length, d.log.length, (d.adRows || []).length, d.customers.length, B.r0, B.L.length, today()].join('|');
    var k = key + '|' + st, c = TREND_MEMO[k]; if (c && c.d === d) return c.v;
    if (Object.keys(TREND_MEMO).length > 40) TREND_MEMO = {};
    var v = trendEach(B, fn); TREND_MEMO[k] = { d: d, v: v }; return v;
  }
  /** Chuỗi theo ngày từ bảng {ngày yyyy-MM-dd: số} (máy chủ gửi) → các điểm của B. */
  function trendDays(B, o, f) { return trendSum(B, Object.keys(o || {}).map(function (k) { return [k, o[k]]; }), function (r) { return dayMs(r[0]); }, f || function (r) { return r[1]; }); }
  /** Lấy 1 trường từ mảng kết quả từng điểm. */
  function trendPick(arr, f) { return arr.map(function (x) { var v = typeof f === 'function' ? f(x) : x[f]; return v === undefined ? null : v; }); }
  /** Kỳ trước cùng độ dài để đặt chồng: lùi off ms. Không có kỳ so sánh (Năm nay, Mọi lúc) → null. */
  function trendOff(R, P) { return CMP_LABEL && P && P[1] > P[0] && R[0] ? R[0] - P[0] : null; }

  /* ---------- tab Hiệu quả: xu hướng doanh số / số đơn / lượt chăm sóc của cả nhóm hoặc 1 người */
  var REP_TM = { sales: ['Doanh số', moneyShort], orders: ['Số đơn', String], care: ['Lượt chăm sóc', String] };
  function repSeries(name, B, off, k) {
    var me = function (n) { return name === null || n === name; };
    if (k === 'care') { var CW = careWhat(); return trendSum(B, S.d.log.filter(function (l) { return CW[l.what] && me(l.by); }), function (l) { return l.time; }, function () { return 1; }, off); }
    return trendSum(B, S.d.orders.filter(function (o) { return !isVoid(o.status) && me(o.seller); }), function (o) { return o.time; }, k === 'orders' ? function () { return 1; } : function (o) { return o.total || 0; }, off);
  }
  /** Đường nhỏ cho 4 ô Hiệu quả (cả nhóm hoặc 1 người): doanh số, tỷ lệ chốt, tiền mỗi đơn, khách cũ mua lại theo từng ngày / tuần / tháng của kỳ đang xem. */
  function repSparks(name, cx) {
    var B = trendBuckets(cx.R), me = function (n) { return name === null || n === name; }, t = function (o) { return o.time; };
    var os = S.d.orders.filter(function (o) { return !isVoid(o.status) && me(o.seller); });
    var sales = trendSum(B, os, t, function (o) { return o.total || 0; }), n = trendSum(B, os, t, function () { return 1; });
    var old = os.filter(function (o) { var c = cust(o.phone); return c && c.first && c.first < o.time - 3600e3; });
    var rep = B.L.map(function (b) { var seen = {}, k = 0; old.forEach(function (o) { if (o.time >= b.a && o.time < b.b && !seen[o.phone]) { seen[o.phone] = 1; k++; } }); return k; });
    var cs = trendEach(B, function (r) { return closeStats(name, r); });
    var sp = function (v, bad) { return sparkSvg(v, B.partial, bad); }, all = S.d.orders.filter(function (o) { return me(o.seller); }), one = function () { return 1; };
    var gross = trendSum(B, all, t, function (o) { return o.total || 0; }), paid = trendSum(B, os.filter(isPaidOrder), t, function (o) { return o.total || 0; });
    var vd = trendRate(trendSum(B, all, t, function (o) { return isVoid(o.status) ? 1 : 0; }), trendSum(B, all, t, one), 100);
    return { gross: sp(gross), paid: sp(paid), vd: sp(vd, true), sales: sp(sales), close: sp(cs.map(function (c) { return c.pct; })), avg: sp(trendRate(sales, n)), repeat: sp(rep) };
  }
  function repTrend(name, cx) {
    var f = S.f.r, k = REP_TM[f.tm] ? f.tm : 'sales', B = trendBuckets(cx.R), off = trendOff(cx.R, cx.P);
    var cur = repSeries(name, B, 0, k), prev = off === null ? null : repSeries(name, B, off, k);
    return '<section class="section"><div class="section-h"><h2>📈 Xu hướng</h2><span class="tip">' + (name ? esc(name) : 'cả nhóm') + ' · ' + esc(cx.p.k === 'all' ? '13 tháng gần nhất' : cx.label) + '</span></div>' +
      '<div class="chips">' + Object.keys(REP_TM).map(function (x) { return '<button class="chip' + (x === k ? ' on' : '') + '" data-rf="tm|' + x + '">' + REP_TM[x][0] + '</button>'; }).join('') + '</div><div class="box">' +
      trendChart({ B: B, fmt: REP_TM[k][1], what: REP_TM[k][0], series: [{ v: cur, name: 'Kỳ này', cls: 'cur' }, prev && { v: prev, name: 'Kỳ trước (' + CMP_LABEL + ')', cls: 'prev' }] }) + '</div></section>';
  }

  /** Data quảng cáo trong kỳ = cùng cách đếm "data quảng cáo" ở tab Hiệu quả (closeStats: số trong file số quảng cáo, mỗi SĐT 1 lần),
   *  tách thêm: khách cũ (đã mua trước ngày có số) · từng hỏi (khách hỏi tạo trước ngày có số) · số mới. Không có file số quảng cáo → null. */
  function dashAdData(R) {
    if (!(S.d.adRows || []).length) return null;
    var c = closeStats(null, R), seen = {}, o = { n: c.data, won: c.won, pct: c.pct, old: 0, again: 0, fresh: 0 };
    S.d.adRows.forEach(function (a) {
      var day = a[0], ph = a[1]; if (day < R[0] || day >= R[1] || seen[ph]) return; seen[ph] = 1;
      var cu = S.d.byPhone && S.d.byPhone[normPhone(ph)];
      if (cu && cu.first && cu.first < day) o.old++;
      else if (leadsOf(ph).some(function (l) { return (l.time || 0) < day; })) o.again++;
      else o.fresh++;
    });
    return o;
  }
  /* Tổng quan theo góc nhìn chủ doanh nghiệp: màn hình đầu chỉ có 4 con số chính (đèn xanh / cam / đỏ), mục tiêu tháng và vài điều cần chú ý.
   * Mọi số liệu chi tiết xếp trong các mục thu gọn (dashMore), bấm vào mới mở; mục đang mở được nhớ trên máy (localStorage dash_open). */
  /** Mức đèn quảng cáo: chi phí / doanh số khách mới dưới [0]% = xanh, tới [1]% = cam, trên = đỏ. Quản trị sửa ở Cài đặt → 🚦 Mức đèn Tổng quan (kv dash_cfg); mặc định 30 / 40 (anh Sơn chốt 12/10/2026). */
  function dashAds() { var c = (S.d && S.d.rules && S.d.rules.dash) || {}; return [Number(c.adsGood) || 30, Number(c.adsBad) || 40]; }
  function adsLv(sp, rev) { if (!sp) return ''; var c = rev ? sp * 100 / rev : Infinity, A = dashAds(); return c < A[0] ? 'ok' : c <= A[1] ? 'mid' : 'bad'; }
  var DASH_LV = { ok: '🟢', done: '🟢', mid: '🟠', bad: '🔴' };
  var DASH_TIP = { ok: 'Tốt', done: 'Tốt', mid: 'Cần để ý', bad: 'Cần xử lý' };
  /** Đèn theo xu hướng so với kỳ trước: tăng = xanh, giảm dưới 10% = cam, giảm từ 10% = đỏ. */
  function dashTrend(cur, prev) { if (!CMP_LABEL || !prev) return ''; var d = (cur - prev) / prev; return d >= 0 ? 'ok' : d > -0.1 ? 'mid' : 'bad'; }
  function dashTile(go, lv, label, value, d, sub, spark) {
    return '<button type="button" class="dash-tile ' + (lv || '') + '" data-dgo="' + go + '"><span class="dash-tile-l">' + label + (DASH_LV[lv] ? '<i title="' + DASH_TIP[lv] + '">' + DASH_LV[lv] + '</i>' : '') + '</span><span class="dash-tile-v"><b>' + value + '</b>' + (spark || '') + '</span>' + (d || '') + '<small>' + sub + '</small></button>';
  }
  /** Mục tiêu tháng cả văn phòng = cộng các mảng (Sale, Website, sàn…). */
  function dashGoal(month, sj) {
    var rows = goalRows(month, sj, false), cur = 0, tt = 0; rows.forEach(function (x) { cur += x.v; tt += x.t; });
    return { rows: rows, cur: cur, tt: tt, G: tt ? goalCalc(cur, tt, month) : null };
  }
  function dashMore(k, title, line, body) {
    return '<details class="dash-more" data-dk="' + k + '" id="dm-' + k + '"' + (S.f.g.open[k] ? ' open' : '') + '><summary><b>' + title + '</b><span>' + line + '</span></summary><div class="dash-more-b">' + body + '</div></details>';
  }
  /** Màn hình đầu: 4 ô lớn + thanh mục tiêu tháng. Bấm vào ô → mở mục chi tiết tương ứng. */
  function dashHero(T, b, bp, M, gl, month, sj, p) {
    var G = gl.G, whole = p.k === 'month' || p.k === 'lmonth';
    var ads = M && M.tot ? M.nr / M.tot : null, adLv = ads === null ? '' : adsLv(M.tot, M.nr);
    var h = '<section class="dash-hero"><div class="dash-tiles dt6">' +
      dashTile('biz', '', '💵 Doanh thu', moneyShort(T.paid), '', T.rev ? 'Tiền đơn đã thu: ' + pct(T.paid, T.rev - T.vRev) + '% doanh số trừ hoàn / huỷ' + (T.rev - T.vRev > T.paid ? ' · còn ' + moneyShort(T.rev - T.vRev - T.paid) + ' đang giao / chờ thu' : '') + (T.san ? ' · sàn đã thu ' + moneyShort(T.sanPaid) + ' (tính khi có file Thu nhập hoặc đơn hoàn thành)' : '') : 'Chưa có đơn', sparkSvg(T.tr.paid, T.tr.B.partial)) +
      dashTile('biz', whole && G && G.isCur ? G.lv : dashTrend(T.rev, T.revP), '💰 Doanh số', moneyShort(T.rev), delta(T.rev, T.revP),
        T.n.toLocaleString('vi-VN') + ' đơn, gồm hoàn / huỷ' + (T.vRev ? ' (trừ đi còn ' + moneyShort(T.rev - T.vRev) + ')' : '') + (!sj ? (SN.err ? ' · chưa gồm sàn (chưa tải được)' : ' · ⏳ đang cộng số sàn…') : T.san ? ' · sàn ' + moneyShort(T.san) : ''), sparkSvg(T.tr.rev, T.tr.B.partial)) +
      dashTile('biz', dashTrend(b.firstN, bp.firstN), '🙋 Khách mới mua', b.firstN.toLocaleString('vi-VN'), delta(b.firstN, bp.firstN), 'Khách mua lần đầu trong kỳ', sparkSvg(T.tr.nw, T.tr.B.partial)) +
      dashTile('biz', b.oldPct === null || bp.oldPct === null ? '' : dashTrend(b.oldPct, bp.oldPct), '🔁 Khách mua lại', b.oldPct === null ? '–' : b.oldPct + '%', b.oldPct === null ? '' : delta(b.oldPct, bp.oldPct, 'rate'),
        b.oldPct === null ? 'Chưa có đơn văn phòng trong kỳ' : moneyShort(b.oldRev) + ' doanh số từ khách đã từng mua', sparkSvg(T.tr.old, T.tr.B.partial)) +
      dashTile('mkt', adLv, '📣 Quảng cáo', ads === null ? '–' : '1đ → ' + oneDec(ads) + 'đ', ads !== null && M.totp && M.nrp ? dRate(ads, M.nrp / M.totp).replace(/điểm/, 'đ') : '',
        !M ? (MK.err ? '⚠️ Chưa tải được chi phí' : '⏳ đang tải…') : M.tot ? 'Chi ' + moneyShort(M.tot) + (M.nr ? ' = ' + Math.round(M.tot * 100 / M.nr) + '% doanh số khách mới' : ', chưa có khách mới mua') + ' · tốt: dưới ' + dashAds()[0] + '%' : 'Chưa có chi phí quảng cáo trong kỳ', ads === null ? '' : sparkSvg(dashAdsSeries(T.tr.B, M, sj), T.tr.B.partial)) +
      dashTile('biz', T.vs.pct === null ? '' : T.vs.pct < 5 ? 'ok' : T.vs.pct < 10 ? 'mid' : 'bad', '↩️ Hoàn / huỷ', T.vs.pct === null ? '–' : T.vs.pct + '%', T.vs.pct !== null && T.vsp.pct !== null ? inv(delta(T.vs.pct, T.vsp.pct, 'rate')) : '',
        (T.vs.n ? T.vs.v + ' / ' + T.vs.n + ' đơn văn phòng · dưới 5% là tốt' : 'Chưa có đơn văn phòng trong kỳ') + (T.vRev ? '<br>Tiền hoàn / huỷ ' + moneyShort(T.vRev) + ' = ' + pct(T.vRev, T.rev) + '% doanh số' + (T.sanV ? ' (sàn ' + moneyShort(T.sanV) + ')' : '') : ''), sparkSvg(T.tr.vd, T.tr.B.partial, true)) +
      '</div><div class="dash-go"><a class="btn" href="#bao-cao">📊 Bán hàng</a><a class="btn" href="#marketing">📣 Marketing</a><a class="btn" href="#san">🛒 Sàn</a><a class="btn" href="#link-qr">📍 Link & QR</a><a class="btn" href="#tro-ly-zalo">🤖 Trợ lý Zalo</a><a class="btn" href="#fanpage">📘 Fanpage</a></div>';
    if (G) {
      var say = G.p >= 1 ? '🎉 Đã đạt mục tiêu, vượt <b>' + moneyShort(gl.cur - gl.tt) + '</b>.' : G.isCur ? 'Còn <b>' + G.left + ' ngày</b>, mỗi ngày cần bán khoảng <b>' + moneyShort(G.perDay) + '</b>' + (G.el >= 3 ? ' · giữ nhịp hiện nay thì cả tháng được khoảng ' + moneyShort(G.fc) + ' (' + pct(G.fc, gl.tt) + '%)' : '') + '.' : 'Cả tháng đạt ' + Math.round(G.p * 100) + '% mục tiêu.';
      h += '<div class="goal dash-goal ' + G.lv + '" role="button" tabindex="0" data-dgo="goal"><div class="goal-h"><b>🎯 Mục tiêu ' + monthLabel(month) + (sj ? '' : ' <small class="muted">(⏳ chưa gồm sàn)</small>') + '</b><span class="goal-st">' + GOAL_LV[G.lv] + '</span></div>' +
        '<div class="goal-num"><b>' + moneyShort(gl.cur) + '</b> / ' + moneyShort(gl.tt) + '<span>' + Math.round(G.p * 100) + '%</span></div>' +
        '<div class="ogoal-bar big"><i style="width:' + Math.min(100, G.p * 100).toFixed(1) + '%"></i>' + (G.isCur ? '<u style="left:' + (G.tp * 100).toFixed(1) + '%"></u>' : '') + '</div>' +
        (G.isCur ? '<div class="bar-legend"><span>Vạch đen = hôm nay (ngày ' + G.el + '/' + G.days + '). Thanh màu vượt vạch đen là đúng tiến độ.</span></div>' : '') + '<p>' + say + '</p></div>';
    } else h += '<div class="notice dash-goal-none">🎯 Chưa đặt mục tiêu ' + monthLabel(month) + '.' + (sj ? ' <button class="btn sm pri" data-san="goals" data-month="' + month + '">Đặt mục tiêu</button>' : '') + '</div>';
    var TR = T.tr, uw = { day: 'ngày', week: 'tuần', month: 'tháng' }[TR.B.unit];
    if (TR.B.L.length >= 2) h += '<div class="box dash-trd"><h3>📈 Doanh số theo ' + uw + (sj ? '' : ' <small class="muted">(⏳ chưa gồm sàn)</small>') + '</h3>' +
      trendChart({ B: TR.B, fmt: moneyShort, what: 'Doanh số', series: [{ v: TR.rev, name: 'Kỳ này', cls: 'cur' }, TR.revP && { v: TR.revP, name: 'Kỳ trước (' + CMP_LABEL + ')', cls: 'prev' }], note: 'Văn phòng + sàn, gồm cả đơn hoàn / huỷ. Rê chuột / chạm vào biểu đồ để xem số từng ' + uw + '.' }) + '</div>';
    return h + '</section>';
  }
  /** Chuỗi theo ngày / tuần / tháng cho biểu đồ Tổng quan: doanh số, số đơn (văn phòng + sàn), khách mới; kỳ trước đặt chồng (sàn cần máy chủ có pdays). */
  function dashSeries(R, P, sj) {
    var B = trendBuckets(R), off = trendOff(R, P), os = S.d.orders, t = function (o) { return o.time; }; // doanh số, số đơn gồm hoàn / huỷ (doanh thu: isPaidOrder)
    var add = function (a, c) { return c ? a.map(function (x, i) { return x + c[i]; }) : a; }, sd = function (r) { return dayMs(r[0]); };
    var pOk = off !== null && (!sj || sj.pdays), cs = S.d.customers.filter(function (c) { return c.first; });
    return { B: B,
      rev: add(trendSum(B, os, t, function (o) { return o.total || 0; }), sj && trendSum(B, sj.days, sd, function (r) { return (r[2] || 0) + (r[11] || 0); })),
      revP: pOk ? add(trendSum(B, os, t, function (o) { return o.total || 0; }, off), sj && trendSum(B, sj.pdays, sd, function (r) { return (r[1] || 0) + (r[3] || 0); }, off)) : null,
      n: add(trendSum(B, os, t, function () { return 1; }), sj && trendSum(B, sj.days, sd, function (r) { return (r[3] || 0) + (r[4] || 0) + (r[5] || 0); })),
      nP: pOk ? add(trendSum(B, os, t, function () { return 1; }, off), sj && trendSum(B, sj.pdays, sd, function (r) { return (r[2] || 0) + (r[4] || 0); }, off)) : null,
      nw: trendSum(B, cs, function (c) { return c.first; }, function () { return 1; }), nwP: off === null ? null : trendSum(B, cs, function (c) { return c.first; }, function () { return 1; }, off),
      paid: add(trendSum(B, os.filter(isPaidOrder), t, function (o) { return o.total || 0; }), sj && trendSum(B, sj.days, sd, function (r) { return r[10] || 0; })),
      // khách mua lại (đơn văn phòng, cách tính như bizStats), hoàn / huỷ: tỷ lệ từng ngày / tuần / tháng
      old: trendRate(trendSum(B, os, t, function (o) { var cu = S.d.byPhone && S.d.byPhone[normPhone(o.phone)]; return cu && cu.first && dayStart(cu.first) < dayStart(o.time) ? o.total || 0 : 0; }), trendSum(B, os, t, function (o) { return o.total || 0; }), 100),
      vd: trendRate(trendSum(B, S.d.orders, t, function (o) { return isVoid(o.status) ? 1 : 0; }), trendSum(B, S.d.orders, t, function () { return 1; }), 100) };
  }
  /** Quảng cáo từng điểm: doanh số khách mới (mua lần đầu trong kỳ, sàn chỉ tính kênh có chi phí, như mktCalc) ÷ chi phí. Điểm không có chi phí → null. */
  function dashAdsSeries(B, M, sj) { var A = dashAdsParts(B, M, sj); return A && trendRate(A.nr, A.sp); }
  /** { sp: chi phí, nr: doanh số khách mới } từng điểm của B. */
  function dashAdsParts(B, M, sj) {
    if (!M) return null;
    var sd = function (r) { return dayMs(r[0]); }, sp = trendSum(B, Object.keys(M.day).map(function (k) { return [k, M.day[k]]; }), sd, function (r) { return r[1]; });
    var nr = trendSum(B, S.d.orders.filter(function (o) { var cu = S.d.byPhone && S.d.byPhone[normPhone(o.phone)]; return !cu || !cu.first || cu.first >= B.r0; }), function (o) { return o.time; }, function (o) { return o.total || 0; });
    if (sj) nr = nr.map(function (x, i) { return x + trendSum(B, sj.days.filter(function (r) { return M.ch[r[1]]; }), sd, function (r) { return r[2] || 0; })[i]; });
    return { sp: sp, nr: nr };
  }
  /** a ÷ b từng điểm, chỉ khi cả 2 khác 0 (chi phí / kết quả: ngày không chi hoặc không có kết quả thì bỏ qua). */
  function trendRateNZ(a, b, k) { return b ? a.map(function (x, i) { return x && b[i] ? x * (k || 1) / b[i] : null; }) : null; }
  /** Tỷ lệ hoàn / huỷ đơn văn phòng (đơn trong CRM) trong khoảng R: số đơn huỷ + hoàn ÷ mọi đơn. */
  function voidStats(R) { var n = 0, v = 0, vr = 0; S.d.orders.forEach(function (o) { if (o.time >= R[0] && o.time < R[1]) { n++; if (isVoid(o.status)) { v++; vr += o.total || 0; } } }); return { n: n, v: v, vr: vr, pct: n ? Math.round(v * 100 / n) : null }; }
  function viewDash() {
    var f = S.f.g || (S.f.g = {}); if (!f.p || f.p.k === 'all') f.p = { k: 'month' }; if (f.sfb === undefined) f.sfb = store('dash_sfb') === '1'; // mặc định TẮT (16/10/2026): đơn chưa rõ nguồn không tự tính cho Facebook
    if (!f.open) { try { f.open = JSON.parse(store('dash_open') || '{}') || {}; } catch (e) { f.open = {}; } }
    var R = perRange(f.p), P = cmpRange(f.p), b = bizStats(R), bp = bizStats(P), key = gaKey(R, P), gj = GA.cache[key], g = gj && gj.ga, noGaCmp = f.p.k === 'today';
    if (!gj && !GA.err) setTimeout(function () { gaFetch(key); }, 0);
    var month = monthOf(Math.min(R[1] - 1, Date.now())), sj = snGet(R, P, month), M = mktCalc(key, R, P, sj), gl = dashGoal(month, sj);
    var sn = sj ? sanSum(sj.days, 2) : null, snp = sj ? sanSum(sj.prev, 1) : null;
    var T = { san: sn ? sn.g : 0, paid: b.paid + (sn ? sn.gp || 0 : 0), sanPaid: sn ? sn.gp || 0 : 0, rev: b.rev + (sn ? sn.g + sn.gv : 0), revP: bp.rev + (snp ? snp.g + snp.gv : 0), vRev: b.vRev + (sn ? sn.gv : 0), sanV: sn ? sn.gv : 0, n: b.n + (sn ? sn.n + sn.c + sn.r : 0), nP: bp.n + (snp ? snp.n + snp.c + snp.r : 0), tr: dashSeries(R, P, sj), vs: voidStats(R), vsp: voidStats(P) };
    var h = '<div class="page-head"><h1>Tổng quan</h1><div class="grow"></div><button class="btn ghost" data-dash="fresh" title="Lấy số mới nhất (quảng cáo, website)">↻ Cập nhật số</button></div>' + perChips('g', f.p);
    h += dashHero(T, b, bp, M, gl, month, sj, f.p);
    h += dashNotes(T, b, g, f.p, M, sj, gl);
    h += '<div class="section-h dash-more-h"><h2>🔎 Xem chi tiết</h2><span class="tip">bấm vào từng mục để mở / đóng</span></div>';
    // ---- mục tiêu từng mảng
    h += dashMore('goal', '🎯 Mục tiêu từng mảng', gl.rows.filter(function (x) { return x.t; }).map(function (x) { return x.c.icon + ' ' + esc(x.c.k) + ' ' + Math.round(x.v * 100 / x.t) + '%'; }).join(' · ') || 'Chưa đặt mục tiêu theo mảng', officeGoalBlock(month, sj, true));
    // ---- bán hàng văn phòng (đường nhỏ: bizStats từng ngày / tuần / tháng)
    var DB = T.tr.B, BZ = trendEachMemo('biz', DB, bizStats), sk = function (v, bad) { return v ? sparkSvg(v, DB.partial, bad) : ''; };
    h += dashMore('biz', '💰 Bán hàng văn phòng', b.n + ' đơn · ' + moneyShort(b.rev) + ' · ' + b.leads + ' khách hỏi mới', '<p class="small muted">Đơn trong CRM: website, sale, khách hỏi (sàn ở mục 🛒) · doanh số gồm cả đơn hoàn / huỷ, xem riêng ở ô Hoàn / huỷ.</p><div class="metrics">' +
      metric('Doanh số', moneyShort(b.rev), money(b.rev) + ' từ ' + b.n + ' đơn, gồm hoàn / huỷ' + (b.vRev ? ' · trừ hoàn / huỷ còn ' + moneyShort(b.rev - b.vRev) : '') + '.', delta(b.rev, bp.rev), '', sk(trendPick(BZ, 'rev'))) +
      metric('↩️ Hoàn / huỷ', b.vPct === null ? '–' : b.vPct + '% đơn', b.vN + ' đơn · ' + moneyShort(b.vRev) + (b.rev ? ' = ' + pct(b.vRev, b.rev) + '% doanh số' : '') + '. Việc của sale: gọi xác nhận trước khi gửi, theo dõi đơn đang giao.', b.vPct === null || bp.vPct === null ? '' : inv(delta(b.vPct, bp.vPct, 'rate')), '#bao-cao', sk(trendPick(BZ, 'vPct'), true)) +
      metric('Doanh thu (đã thu tiền)', moneyShort(b.paid), b.paidN + ' đơn đã giao hoặc đã nhận chuyển khoản' + (b.rev - b.vRev > b.paid ? ' · còn ' + moneyShort(b.rev - b.vRev - b.paid) + ' đang giao / chờ thu' : '') + '.', '', '', sk(trendPick(BZ, 'paid'))) +
      metric('Số đơn', b.n, 'Website ' + b.web + ' · Sale & khách hỏi ' + (b.n - b.web) + '.', delta(b.n, bp.n), '', sk(trendPick(BZ, 'n'))) +
      metric('Giá trị trung bình / đơn', b.n ? moneyShort(b.avg) : '–', 'Tăng khi khách mua combo, mua kèm, đủ mức miễn phí ship.', b.n ? delta(b.avg, bp.n ? bp.avg : 0) : '', '', sk(trendPick(BZ, function (x) { return x.n ? x.rev / x.n : null; }))) +
      metric('Khách mua lần đầu', b.firstN, 'Khách mới có đơn đầu tiên trong kỳ.', delta(b.firstN, bp.firstN), '', sk(trendPick(BZ, 'firstN'))) +
      metric('Doanh số từ khách cũ', b.oldPct === null ? '–' : b.oldPct + '%', moneyShort(b.oldRev) + ' từ khách đã từng mua. Cao = chăm sóc tốt, khách quay lại.', b.oldPct === null ? '' : delta(b.oldPct, bp.oldPct, 'rate'), '', sk(trendPick(BZ, 'oldPct'))) +
      (b.ad ? metric('Data quảng cáo', b.ad.n, b.ad.fresh + ' số mới · ' + b.ad.old + ' khách cũ · ' + b.ad.again + ' từng hỏi trước đây. ' + b.ad.won + ' ra đơn (chốt ' + (b.ad.pct === null ? '–' : b.ad.pct + '%') + '). Cùng cách đếm với tab Hiệu quả.', delta(b.ad.n, bp.ad ? bp.ad.n : null), '#bao-cao', sk(trendPick(BZ, function (x) { return x.ad ? x.ad.n : null; }))) : '') +
      metric('Khách hỏi mới', b.leads, 'Số chưa từng có trong CRM, mọi kênh (quảng cáo, website, nhập tay), trong đó ' + b.webLeads + ' từ website. Khách cũ / khách hỏi lại không tính.', delta(b.leads, bp.leads), '#tiem-nang', sk(trendPick(BZ, 'leads'))) +
      '</div>');
    // ---- quảng cáo
    var mLine = !M ? (MK.err ? '⚠️ chưa tải được' : '⏳ đang tải…') : M.tot ? 'Chi ' + moneyShort(M.tot) + (M.nr ? ' · 1đ → ' + oneDec(M.nr / M.tot) + 'đ doanh số khách mới' : '') : 'Chưa có chi phí trong kỳ';
    h += dashMore('mkt', '📣 Quảng cáo & hiệu quả từng kênh', mLine, mktBlock(M, R, b, bp, sj));
    // ---- sàn
    h += dashMore('san', '🛒 Sàn TMĐT', sn ? (sn.g || sn.n ? moneyShort(sn.g) + ' · ' + sn.n + ' đơn' : 'Chưa có đơn sàn trong kỳ') : SN.err ? '⚠️ chưa tải được' : '⏳ đang tải…', sanDashBlock(sj, R));
    // ---- xu hướng khác: số đơn, khách mới, lượt vào web
    var TR = T.tr;
    if (TR.B.L.length >= 2) {
      var dh = '<div class="dash-grid"><div class="box"><h3>🧾 Số đơn hàng</h3>' + trendChart({ B: TR.B, what: 'Số đơn', series: [{ v: TR.n, name: 'Kỳ này', cls: 'cur' }, TR.nP && { v: TR.nP, name: 'Kỳ trước', cls: 'prev' }] }) + '</div>' +
        '<div class="box"><h3>🙋 Khách mới mua</h3>' + trendChart({ B: TR.B, what: 'Khách mới', series: [{ v: TR.nw, name: 'Kỳ này', cls: 'cur' }, TR.nwP && { v: TR.nwP, name: 'Kỳ trước', cls: 'prev' }] }) + '</div>';
      if (g) dh += '<div class="box"><h3>🌐 Lượt vào website</h3>' + trendChart({ B: TR.B, what: 'Lượt vào web', fmt: function (v) { return Math.round(v).toLocaleString('vi-VN'); }, series: [{ v: trendSum(TR.B, g.days, function (x) { return dayMs(x[0]); }, function (x) { return x[1]; }), name: 'Kỳ này', cls: 'cur' }] }) + '</div>';
      var vs = [['Số đơn', trendVerdict(TR.n, TR.B.partial)], ['khách mới', trendVerdict(TR.nw, TR.B.partial)]].filter(function (x) { return x[1]; });
      h += dashMore('day', '📈 Xu hướng khác', vs.length ? vs.map(function (x) { return x[0] + ' ' + TRD_WORD[x[1].k].toLowerCase(); }).join(' · ') : 'Số đơn, khách mới, lượt vào web', dh + '</div>');
    }
    // ---- kênh bán
    var tot = b.rev || 1, subs = Object.keys(b.sub).map(function (k) { return b.sub[k]; }).sort(function (x, y) { return y.v - x.v; });
    h += dashMore('chan', '🧭 Tiền đến từ kênh nào', ['Website', 'Sale', 'Khách hỏi'].map(function (c) { return c + ' ' + (b.ch[c] ? pct(b.ch[c].v, tot) : 0) + '%'; }).join(' · '), '<div class="box">' +
      barList(subs.slice(0, 12).map(function (x) { return { l: x.g + ' – ' + x.l, v: x.v, sub: x.n + ' đơn · ' + pct(x.v, tot) + '%' }; }), moneyShort, 'Chưa có đơn trong kỳ.', { below: 1 }) +
      '<p class="bar-legend">Website = khách tự đặt trên web (nguồn theo link UTM / Facebook / Google…). Sale = đơn nhân viên lên (nhập tay, file sale). Khách hỏi = chốt từ tab Khách hỏi.</p></div>');
    // ---- sản phẩm + khách hỏi
    var prods = Object.keys(b.prod).map(function (k) { return { l: k, v: b.prod[k].v, sub: b.prod[k].q + ' sản phẩm' }; }).sort(function (x, y) { return y.v - x.v; });
    var lch = Object.keys(b.leadCh).map(function (k) { return { l: k, v: b.leadCh[k] }; }).sort(function (x, y) { return y.v - x.v; });
    h += dashMore('prod', '🏆 Sản phẩm bán chạy', prods.length ? 'Nhiều nhất: ' + esc(prods[0].l) + ' · ' + moneyShort(prods[0].v) : 'Chưa có đơn trong kỳ', '<div class="box">' + barList(prods.slice(0, 10), moneyShort, 'Chưa có đơn trong kỳ.', { below: 1 }) + '<p class="bar-legend">Đơn văn phòng, theo doanh số. Sản phẩm bán chạy trên sàn xem ở tab Sàn.</p></div>');
    h += dashMore('lead', '🙋 Khách hỏi theo kênh', b.leads + ' khách để lại SĐT' + (lch.length ? ' · nhiều nhất từ ' + esc(lch[0].l) : ''), '<div class="box">' + barList(lch.slice(0, 10), String, 'Chưa có khách hỏi trong kỳ.', { below: 1 }) + '</div>');
    // ---- website
    var conv = g && g.cur.sessions ? b.web * 100 / g.cur.sessions : null, convP = g && g.prev.sessions ? bp.web * 100 / g.prev.sessions : null, wh;
    if (!g) wh = gaSetupBox(gj);
    else { var GD = g.days || [], eng = GD.length && GD[0][3] !== undefined, gs = function (i) { return trendSum(DB, GD, function (r) { return dayMs(r[0]); }, function (r) { return r[i] || 0; }); }, gS = gs(1), gU = gs(2);
    wh = '<p class="small muted">Google Analytics · cập nhật ' + fDateTime(g.at) + '</p><div class="metrics dash-m3">' +
      metric('Lượt truy cập', g.cur.sessions.toLocaleString('vi-VN'), g.cur.views.toLocaleString('vi-VN') + ' lượt xem trang · mỗi lượt xem TB ' + (g.cur.sessions ? oneDec(g.cur.views / g.cur.sessions) : 0) + ' trang.', noGaCmp ? '' : delta(g.cur.sessions, g.prev.sessions), '', sk(gS)) +
      metric('Người xem', g.cur.users.toLocaleString('vi-VN'), g.cur.newUsers.toLocaleString('vi-VN') + ' người lần đầu vào web.', noGaCmp ? '' : delta(g.cur.users, g.prev.users), '', sk(gU)) +
      metric('Đơn đặt trên web', b.web, moneyShort(b.webRev) + ' · đếm từ CRM, đủ cả khách không bấm đồng ý cookie.', delta(b.web, bp.web), '', sk(trendPick(BZ, 'web'))) +
      metric('Tỷ lệ ra đơn', conv === null ? '–' : oneDec(conv) + '%', 'Đơn web ÷ lượt truy cập. Web bán lẻ thường đạt 1–3%. Hơi cao hơn thực tế vì Analytics chỉ đếm khách bấm đồng ý cookie.', conv === null || noGaCmp ? '' : dRate(conv, convP), '', sk(trendRate(trendPick(BZ, 'web'), gS, 100))) +
      metric('Khách ở lại xem', g.cur.sessions ? pct(g.cur.engaged, g.cur.sessions) + '%' : '–', 'Lượt truy cập có xem ≥ 10 giây, hoặc xem ≥ 2 trang, hoặc bấm mua / gọi. Thấp = trang vào đầu không hợp với khách.', noGaCmp || !g.prev.sessions ? '' : delta(pct(g.cur.engaged, g.cur.sessions), pct(g.prev.engaged, g.prev.sessions), 'rate'), '', eng ? sk(trendRate(gs(3), gS, 100)) : '') +
      metric('Thời gian xem TB', g.cur.users ? fDur(g.cur.dur / g.cur.users) : '–', 'Thời gian 1 người thật sự xem web (tab đang mở) trong kỳ.', noGaCmp || !g.prev.users ? '' : delta(Math.round(g.cur.dur / g.cur.users), Math.round(g.prev.dur / g.prev.users)), '', eng ? sk(trendRate(gs(4), gU)) : '') +
      '</div>' + gaBlocks(g, b, noGaCmp); }
    h += dashMore('web', '🌐 Website thucduonglanh.vn', g ? g.cur.sessions.toLocaleString('vi-VN') + ' lượt vào · ' + b.web + ' đơn web' + (conv === null ? '' : ' · ' + oneDec(conv) + '% ra đơn') : gj ? '🔌 chưa kết nối Google Analytics' : GA.err ? '⚠️ chưa tải được' : '⏳ đang tải…', wh);
    h += '<p class="small muted">Doanh số, đơn, khách lấy từ CRM (đơn 13 tháng gần nhất) và file sàn. Số website lấy từ Google Analytics, chỉ đếm khách đã bấm “Đồng ý” cookie (Nghị định 13/2023), nên thấp hơn số người vào thật.</p>' +
      '<p class="small muted">🔜 Sắp có: TikTok / Google Ads tự lấy chi phí · lãi gộp theo sản phẩm, theo kênh (cần giá vốn) · tỷ lệ giao thành công, khách mua lại sau 30 / 60 / 90 ngày.</p>';
    return h;
  }
  /* ---------------- Chi phí marketing (lệnh mkt*, api/src/mkt.js). Thêm kênh quảng cáo mới: thêm 1 dòng vào MKT_CH.
   * kw: từ khoá (không dấu) nhận ra đơn / khách hỏi đến từ kênh đó, dựa vào Nguồn đơn và Kênh của khách hỏi → tính “thu về” và ROAS của kênh. */
  var MKT_CH = [
    { k: 'Facebook', icon: '📘', kw: /facebook|\bfb\b|instagram|messenger|quang cao/ },
    { k: 'Website', icon: '🌐', kw: null }, // đơn đặt trên web không rõ quảng cáo nào (vào thẳng, Google tự nhiên, link KOC…); mục tiêu Website = cả khách mới + cũ (mktv.revAll)
    { k: 'Shopee', icon: '🟠', kw: /shopee/, san: 1 }, // kênh sàn: doanh số lấy từ tab Sàn, chi phí = quảng cáo trên sàn (nhập file / nhập tay)
    { k: 'TikTok Shop', icon: '🛍️', kw: /tiktok ?shop/, san: 1 },
    { k: 'Lazada', icon: '🔷', kw: /lazada/, san: 1 },
    { k: 'TikTok', icon: '🎵', kw: /tiktok/ },
    { k: 'Google', icon: '🔎', kw: /(google|youtube).*(cpc|ppc|paid|ads|quang cao)|google ads/ },
    { k: 'Zalo', icon: '💬', kw: /zalo.*(ads|quang cao)/ },
    { k: 'KOL / KOC', icon: '⭐', kw: /\bkol\b|\bkoc\b/ },
    { k: 'Cộng đồng Zalo', icon: '👥', kw: null, ret: 1 }, // giữ khách cũ: tiền = đơn mua lại của khách đã vào nhóm (mktv.comm); chi phí quà / minigame nhập tay, không tính vào hiệu quả quảng cáo
    { k: 'Khác', icon: '📦', kw: null }
  ];
  var MK = { cache: {}, busy: '', err: '' };
  function mkFetch(key) {
    if (MK.busy === key) return; MK.busy = key; MK.err = '';
    var k = key.split('_');
    api('mkt', { from: k[0], to: k[1], pf: k[2], pt: k[3] }).then(function (j) { MK.cache[key] = j; }, function (e) { MK.err = /Không rõ thao tác/.test(e.message) ? 'Máy chủ đang cập nhật bản mới, thử lại sau 2 phút.' : e.message; })
      .then(function () { MK.busy = ''; if (route().view === 'tong-quan') softRender(true); });
  }
  /** Chi phí: giảm là tốt → đổi màu mũi tên (xanh khi giảm). */
  function inv(h) { return String(h).replace(/class="delta (up|down)"/, function (_, c) { return 'class="delta ' + (c === 'up' ? 'down' : 'up') + '"'; }); }
  function chInfo(k) { return MKT_CH.filter(function (c) { return c.k === k; })[0] || { k: k, icon: '📦', kw: null }; }
  /* ---------- Hiệu quả từng kênh: chi phí quảng cáo ↔ doanh số KHÁCH MỚI của kênh đó.
   * Khách mới = khách mua lần đầu trong kỳ (cả các đơn sau của khách đó trong kỳ); kênh của khách = kênh của đơn đầu tiên. Gắn đơn về kênh theo thứ tự:
   * 1) SĐT có trong file số quảng cáo từ trước ngày đặt → Facebook  2) khách hỏi của SĐT đó (Kênh) → theo kw  3) Nguồn đơn (link UTM web…) → theo kw
   * 4) đơn sale (File / Nhập tay) chưa rõ nguồn → Facebook nếu bật "coi đơn sale chưa rõ là Facebook" (S.f.g.sfb), không thì "Chưa rõ nguồn".
   * Sàn: doanh số từ tab Sàn (không có SĐT nên không tách khách mới / cũ, tính cả). Khách cũ quay lại không tính vào hiệu quả kênh (chỉ hiện để tham khảo). */
  function adFirstMap() {
    var rows = S.d.adRows || []; if (S.d._admFor === rows) return S.d._adm;
    var m = {}; rows.forEach(function (a) { var ph = normPhone(a[1]); if (ph && (!m[ph] || a[0] < m[ph])) m[ph] = a[0]; });
    S.d._admFor = rows; return (S.d._adm = m);
  }
  function kwChan(text) { var n = norm(text); for (var i = 0; i < MKT_CH.length; i++) if (MKT_CH[i].kw && MKT_CH[i].kw.test(n)) return MKT_CH[i].k; return ''; }
  function orderChan(o, sfb) {
    var ph = normPhone(o.phone), ad = adFirstMap()[ph], k;
    if (ad && ad <= o.time) return 'Facebook';
    var ls = leadsOf(ph).filter(function (l) { return (l.time || 0) <= o.time && !/^file cũ/i.test(l.channel || ''); });
    for (var i = 0; i < ls.length; i++) if ((k = kwChan(ls[i].channel))) return k;
    if ((k = kwChan(o.source))) return k;
    if (chanOf(o)[0] === 'Website') return 'Website'; // giống api/src/mktv.js orderChan
    return sfb && /^(File |Nhập tay)/.test(o.source || '') ? 'Facebook' : '';
  }
  function chanEff(R, sj, prev, sfb) {
    var C = {}, get = function (k) { return C[k] || (C[k] = { k: k, newN: 0, newRev: 0, newVoid: 0, oldRev: 0, oldN: 0 }); }, who = {};
    S.d.orders.filter(function (o) { return o.time >= R[0] && o.time < R[1]; }).sort(function (a, b) { return a.time - b.time; }).forEach(function (o) {
      var ph = normPhone(o.phone) || o.id, cu = S.d.byPhone && S.d.byPhone[ph], t = o.total || 0;
      var isNew = !cu || !cu.first || cu.first >= R[0];
      if (!who[ph]) who[ph] = get(orderChan(o, sfb) || '?');
      var c = isNew ? who[ph] : get(orderChan(o, sfb) || '?');
      if (isNew) { if (!c['_' + ph]) { c['_' + ph] = 1; c.newN++; } c.newRev += t; if (isVoid(o.status)) c.newVoid += t; } else { c.oldRev += t; c.oldN++; }
    });
    if (sj) (prev ? sj.prev.map(function (r) { return [r[0], r[1]]; }) : sj.days.map(function (r) { return [r[1], r[2]]; })).forEach(function (r) { var c = get(r[0]); c.san = 1; c.newRev += r[1] || 0; });
    return C;
  }
  /** Thẻ từng kênh: chi phí, doanh số khách mới, % chi phí / doanh số khách mới, 1đ → bao nhiêu, chi phí / khách mới; đánh dấu kênh hiệu quả nhất / tốn nhất. */
  function effBlock(E, Ep, ch, chp, sfb, sj, bare) {
    var keys = {}; Object.keys(ch).forEach(function (k) { keys[k] = 1; }); Object.keys(E).forEach(function (k) { if (k !== '?' && E[k].newRev) keys[k] = 1; });
    var Z = { newN: 0, newRev: 0, oldRev: 0, oldN: 0 }, rows = Object.keys(keys).map(function (k) {
      var e = E[k] || Z, ep = Ep[k] || Z, sp = ch[k] || 0, spp = chp[k] || 0;
      return { k: k, c: chInfo(k), e: e, ep: ep, sp: sp, spp: spp, rate: sp && e.newRev ? sp * 100 / e.newRev : null, ratep: spp && ep.newRev ? spp * 100 / ep.newRev : null };
    }).sort(function (x, y) { return y.sp - x.sp || y.e.newRev - x.e.newRev; });
    var rated = rows.filter(function (r) { return r.rate !== null; }).sort(function (x, y) { return x.rate - y.rate; });
    var best = rated.length > 1 ? rated[0].k : '', worst = rated.length > 1 ? rated[rated.length - 1].k : '';
    var stat = function (l, v, d) { return '<div class="dash-ch-s"><span>' + l + '</span><b>' + v + '</b>' + (d || '') + '</div>'; };
    var h = '<section class="section"><div class="section-h"><h2>🎯 Hiệu quả từng kênh</h2><span class="tip">chi phí so với doanh số khách mới · bỏ 1đ thu về bao nhiêu</span></div>' +
      '<div class="chips wrap"><button class="chip' + (sfb ? ' on' : '') + '" data-dash="sfb">' + (sfb ? '✓ ' : '') + 'Đơn sale chưa rõ nguồn tính vào Facebook</button></div><div class="dash-chs">';
    rows.forEach(function (r) {
      var e = r.e, tag = r.k === best ? '<span class="tag vip">🏆 Hiệu quả nhất</span>' : r.k === worst ? '<span class="tag risk">⚠️ Tốn nhất</span>' : '';
      h += '<div class="dash-ch' + (r.k === best ? ' best' : r.k === worst ? ' worst' : '') + '"><div class="dash-ch-h"><b>' + r.c.icon + ' ' + esc(r.k) + '</b>' + tag + '</div><div class="dash-ch-g">' +
        stat('Chi phí', r.sp ? moneyShort(r.sp) : '–', r.sp && r.spp ? inv(delta(r.sp, r.spp)) : '') +
        stat(e.san ? 'Doanh số sàn' : 'DS khách mới', moneyShort(e.newRev), e.newRev ? delta(e.newRev, r.ep.newRev || null) : '') +
        stat('Chi phí / DT mới', r.rate === null ? '–' : oneDec(r.rate) + '%', r.rate !== null && r.ratep !== null ? inv(dRate(r.rate, r.ratep)) : '') +
        stat('1đ → thu về', r.sp && e.newRev ? oneDec(e.newRev / r.sp) + 'đ' : '–') +
        '</div><p class="small muted">' + [e.san ? 'Sàn không có SĐT khách nên tính cả doanh số, chưa tách khách mới / cũ' : e.newN + ' khách mới' + (r.sp && e.newN ? ' · ' + moneyShort(Math.round(r.sp / e.newN)) + ' / khách mới' : ''),
          e.oldRev ? 'khách cũ quay lại ' + moneyShort(e.oldRev) + ' (không tính vào hiệu quả)' : '',
          !r.sp ? 'chưa có chi phí kỳ này: bấm ⚙️ để nhập' : ''].filter(Boolean).join(' · ') + '</p></div>';
    });
    var u = E['?'];
    if (u && u.newRev) h += '<div class="dash-ch dash-ch-mut"><div class="dash-ch-h"><b>❔ Chưa rõ nguồn / không qua quảng cáo</b></div><p class="small">' + u.newN + ' khách mới · ' + moneyShort(u.newRev) + ' doanh số khách mới chưa gắn được kênh (khách quen giới thiệu, vào thẳng web, đơn nhập tay không ghi nguồn…). Ghi đúng nguồn khi lên đơn và dùng link UTM thì số này giảm, các kênh chính xác hơn.</p></div>';
    h += '</div><p class="bar-legend">Kênh của đơn: số có trong file số quảng cáo → Facebook; không có thì theo Kênh của khách hỏi, Nguồn đơn (link UTM). Khách mới = mua lần đầu trong kỳ, tính cả các đơn sau của họ trong kỳ, gắn theo kênh của đơn đầu tiên. Sàn: doanh số từ tab Sàn, chi phí = quảng cáo trên sàn (nhập file / nhập tay, kênh Shopee / TikTok Shop).</p></section>';
    if (bare) h = h.replace(/^<section class="section"><div class="section-h">[\s\S]*?<\/div>/, '').replace(/<\/section>$/, '');
    return h;
  }
  /** Số quảng cáo của kỳ (tự tải nếu chưa có): chi phí theo kênh / ngày, doanh số khách mới từng kênh (chanEff). null = đang tải.
   *  Dùng chung cho 4 ô màn hình đầu, Điểm cần chú ý và mục 📣 chi tiết, để các con số luôn khớp nhau. */
  function mktCalc(key, R, P, sj) {
    var mj = MK.cache[key];
    if (!mj && !MK.err) setTimeout(function () { mkFetch(key); }, 0);
    if (!mj) return null;
    var M = { mj: mj, ch: {}, chp: {}, tot: 0, totp: 0, day: {}, sfb: store('dash_sfb') === '1', newN: 0, newNp: 0 }; MK.fbOn = mj.cfg.fb.on;
    mj.days.forEach(function (r) { if (chInfo(r[1]).ret) return; M.ch[r[1]] = (M.ch[r[1]] || 0) + r[2]; M.tot += r[2]; M.day[r[0]] = (M.day[r[0]] || 0) + r[2]; });
    mj.prev.forEach(function (r) { if (chInfo(r[0]).ret) return; M.chp[r[0]] = r[1]; M.totp += r[1]; });
    M.E = chanEff(R, sj, false, M.sfb); M.Ep = chanEff(P, sj, true, M.sfb);
    var newRev = function (E0, sp) { var v = 0; Object.keys(E0).forEach(function (k) { if (!E0[k].san || sp[k]) v += E0[k].newRev; }); return v; }; // sàn chỉ tính khi có chi phí quảng cáo sàn
    M.nr = newRev(M.E, M.ch); M.nrp = newRev(M.Ep, M.chp);
    Object.keys(M.E).forEach(function (k) { M.newN += M.E[k].newN; }); Object.keys(M.Ep).forEach(function (k) { M.newNp += M.Ep[k].newN; });
    return M;
  }
  /** Dòng chiến dịch cho barList (mục 📣 Tổng quan + tab Marketing). r = [kênh, chiến dịch, src, chi phí, hiển thị, click, tin nhắn, SĐT, mua, [tên tài khoản, mã act_…]].
   *  Dòng dưới: tài khoản quảng cáo (Facebook có link mở thẳng Trình quản lý quảng cáo) + click / kết quả / chi phí mỗi kết quả. */
  function campRows(list) {
    return list.map(function (r) {
      var bits = [], acc = r[9] || ['', ''], res = r[6] + r[7];
      if (r[5]) bits.push(r[5].toLocaleString('vi-VN') + ' click'); if (r[6]) bits.push(r[6] + ' tin nhắn'); if (r[7]) bits.push(r[7] + ' SĐT'); if (r[8]) bits.push(r[8] + ' mua');
      if (res) bits.push(moneyShort(Math.round(r[3] / res)) + '/kết quả');
      var tk = acc[0] ? (acc[1] ? '<a href="https://adsmanager.facebook.com/adsmanager/manage/campaigns?act=' + esc(acc[1].replace(/^act_/, '')) + '" target="_blank" rel="noopener" title="Mở tài khoản này trong Trình quản lý quảng cáo Facebook">🏷 ' + esc(acc[0]) + ' ↗</a>' : '🏷 ' + esc(acc[0])) : '';
      return { l: chInfo(r[0]).icon + ' ' + r[1], v: r[3], acc: acc[0] || '', subH: [tk, esc(bits.join(' · '))].filter(Boolean).join(' · ') };
    });
  }
  function mktBlock(M, R, b, bp, sj) {
    var h = '<section class="section"><div class="section-h"><h2>📣 Marketing</h2><span class="tip">chi phí quảng cáo &amp; hiệu quả</span><div class="grow"></div><a class="btn sm" href="#marketing" title="Đúng màn hình bộ phận marketing đang xem">👁 Tab Marketing</a><a class="btn sm" href="#link-qr">📍 Link &amp; QR</a><button class="btn sm" data-dash="mkt">⚙️ Quản lý chi phí quảng cáo</button></div>';
    if (!M) return h + '<div class="box"><p class="muted">' + (MK.err ? '⚠️ ' + esc(MK.err) : '⏳ Đang tải chi phí…') + '</p></div></section>';
    var mj = M.mj, ch = M.ch, chp = M.chp, tot = M.tot, totp = M.totp, day = M.day;
    var fb = mj.cfg.fb, fbLine = fb.on ? '📘 Facebook Ads tự cập nhật' + (fb.last ? ' · lần gần nhất ' + fDateTime(fb.last) : '') + (fb.err ? ' · <span class="bad-line">⚠️ ' + esc(fb.err) + '</span>' : '') : '📘 Facebook Ads chưa kết nối tự động. Bấm <b>⚙️ Quản lý chi phí quảng cáo</b> để kết nối, hoặc nhập file / nhập tay.';
    if (!tot && !totp) return h + '<div class="box"><p>Chưa có chi phí quảng cáo nào trong kỳ này.</p><p class="small muted">' + fbLine + '</p></div></section>';
    var per = function (n, v) { return n && v ? moneyShort(Math.round(v / n)) : '–'; }, prevPer = function (n, v) { return n && v ? Math.round(v / n) : null; };
    var sfb = M.sfb, E = M.E, Ep = M.Ep, nr = M.nr, nrp = M.nrp, newN = M.newN, newNp = M.newNp;
    var MB = trendBuckets(R), MZ = trendEachMemo('biz', MB, bizStats), AP = dashAdsParts(MB, M, sj), msk = function (v, bad) { return v ? sparkSvg(v, MB.partial, bad) : ''; };
    var mNw = trendSum(MB, S.d.customers.filter(function (c) { return c.first; }), function (c) { return c.first; }, function () { return 1; });
    h += '<div class="metrics dash-m3">' +
      metric('Chi phí quảng cáo', moneyShort(tot), Object.keys(ch).sort(function (x, y) { return ch[y] - ch[x]; }).map(function (k) { return chInfo(k).icon + ' ' + esc(k) + ' ' + moneyShort(ch[k]); }).join(' · '), delta(tot, totp), '', msk(AP.sp, 'n')) +
      metric('Chi phí / doanh số khách mới', nr ? oneDec(tot * 100 / nr) + '%' : '–', 'Chi phí quảng cáo ÷ ' + moneyShort(nr) + ' doanh số khách mua lần đầu trong kỳ' + (sj && Object.keys(ch).some(function (k) { return chInfo(k).san; }) ? ' (gồm doanh số sàn có chạy quảng cáo)' : '') + '. Thấp hơn là tốt.', nr && nrp && totp ? inv(dRate(tot * 100 / nr, totp * 100 / nrp)) : '', '', msk(trendRateNZ(AP.sp, AP.nr, 100), true)) +
      metric('1đ chi phí → doanh số khách mới', nr ? oneDec(nr / tot) + 'đ' : '–', 'Doanh số khách mới ÷ chi phí quảng cáo.', nr && nrp && totp ? dRate(nr / tot, nrp / totp).replace(/điểm/, 'đ') : '', '', msk(trendRate(AP.nr, AP.sp))) +
      metric('Chi phí có 1 khách mới', per(newN, tot), newN + ' khách mua lần đầu. So với số tiền 1 khách mua trong cả năm để biết có đáng không (chưa tính giá vốn).', newN && tot ? inv(delta(Math.round(tot / newN), prevPer(newNp, totp))) : '', '', msk(trendRateNZ(AP.sp, mNw), true)) +
      (b.ad ? metric('Chi phí / data quảng cáo', per(b.ad.n, tot), 'Chi phí ÷ ' + b.ad.n + ' data quảng cáo (gồm cả khách cũ nhắn qua quảng cáo).' + (b.ad.won ? ' Mỗi data ra đơn tốn ' + per(b.ad.won, tot) + '.' : ''), b.ad.n && tot ? inv(delta(Math.round(tot / b.ad.n), bp.ad ? prevPer(bp.ad.n, totp) : null)) : '', '', msk(trendRateNZ(AP.sp, trendPick(MZ, function (x) { return x.ad ? x.ad.n : 0; })), true))
        : metric('Chi phí / khách hỏi mới', per(b.leads, tot), b.leads + ' khách hỏi mới mọi kênh (chưa có file số quảng cáo).', b.leads && tot ? inv(delta(Math.round(tot / b.leads), prevPer(bp.leads, totp))) : '', '', msk(trendRateNZ(AP.sp, trendPick(MZ, 'leads')), true))) +
      metric('Chi phí / doanh số tổng', b.rev ? oneDec(tot * 100 / b.rev) + '%' : '–', 'Chi phí ÷ toàn bộ doanh số CRM (cả khách cũ). Chỉ để tham khảo, đánh giá quảng cáo thì xem ô doanh số khách mới.', b.rev && bp.rev && totp ? inv(dRate(tot * 100 / b.rev, totp * 100 / bp.rev)) : '', '', msk(trendRateNZ(AP.sp, trendPick(MZ, 'rev'), 100), true)) +
      '</div>';
    h += effBlock(E, Ep, ch, chp, sfb, sj);
    h += '<div class="dash-grid">';
    var BM = trendBuckets(R); if (BM.L.length >= 2) h += '<div class="box"><h3>📈 Chi phí quảng cáo</h3>' + trendChart({ B: BM, fmt: moneyShort, what: 'Chi phí quảng cáo', series: [{ v: trendSum(BM, Object.keys(day).map(function (k) { return [k, day[k]]; }), function (r) { return dayMs(r[0]); }, function (r) { return r[1]; }), name: 'Chi phí', cls: 'alt' }] }) + '</div>';
    h += '</div>';
    var camps = campRows(mj.camps);
    h += '<div class="box"><h3>Chiến dịch tốn nhiều nhất</h3>' + barList(camps.slice(0, 12), moneyShort, '', { below: 1 }) + '<p class="bar-legend">Kết quả = tin nhắn + SĐT khách để lại (Facebook ghi nhận). Chi phí / kết quả càng thấp càng tốt.</p></div>';
    return h + '<p class="small muted">' + fbLine + '</p></section>';
  }

  /* ================================================================ Tab 📣 Marketing (quyền "Marketing" + Quản trị vào từ Tổng quan).
   * Số tính sẵn trên máy chủ (lệnh mktv, api/src/mktv.js), chỉ có con số tổng theo kênh / chiến dịch: bộ phận marketing không thấy khách, đơn hay doanh số toàn công ty.
   * Cách tính giống mục 📣 ở Tổng quan (chanEff, closeStats) nên 2 nơi ra cùng số. */
  function isMkt() { return !!(S.user && S.user.role === 'Marketing'); }
  /** 📣 Xem Marketing (Cài đặt → Nhân sự): Quản lý / Sale được xem tab Marketing, không nhập chi phí, không đặt mục tiêu. */
  function mkvOnly() { return !!(S.user && S.user.mkv) && !isMkt() && lvl() < 3; }
  var MV = { cache: {}, pend: {}, err: '' };
  function mvFetch(key, fresh) {
    if (MV.pend[key]) return; MV.pend[key] = 1; MV.err = '';
    var k = key.split('_');
    api('mktv', { from: k[0], to: k[1], pf: k[2], pt: k[3], sfb: k[4] === '1', fresh: fresh ? 1 : 0 }).then(function (j) { MV.cache[key] = j; }, function (e) { MV.err = /Không rõ thao tác/.test(e.message) ? 'Máy chủ đang cập nhật bản mới, thử lại sau 2 phút.' : e.message; })
      .then(function () { delete MV.pend[key]; if (route().view === 'marketing') softRender(true); });
  }
  function mvKey() { var f = S.f.m; return gaKey(perRange(f.p), cmpRange(f.p)) + '_' + (f.sfb ? 1 : 0); }
  /** Lời nhắc về quảng cáo (dùng chung Tổng quan + tab Marketing): kênh chi tiền chưa ra khách mới, kênh vượt mức đỏ, kênh hiệu quả nhất. */
  function adsNotes(ch, E) {
    var L = [], rated = Object.keys(ch).filter(function (k) { return ch[k] > 0; }).map(function (k) { var e = E[k] || { newRev: 0 }; return { k: k, sp: ch[k], r: e.newRev / ch[k] }; }).sort(function (x, y) { return y.r - x.r; });
    var zero = rated.filter(function (x) { return !x.r && x.sp >= 1e6; })[0], low = rated.filter(function (x) { return x.r && adsLv(x.sp, x.sp * x.r) === 'bad'; }).pop();
    if (zero) L.push('⚠️ Quảng cáo <b>' + esc(zero.k) + '</b> đã chi ' + moneyShort(zero.sp) + ' nhưng chưa có khách mới nào mua.');
    else if (low) L.push('⚠️ Quảng cáo <b>' + esc(low.k) + '</b> chưa hiệu quả: chi phí bằng ' + Math.round(100 / low.r) + '% tiền khách mới mua (nên dưới ' + dashAds()[0] + '%).');
    if (rated.length > 1 && adsLv(rated[0].sp, rated[0].sp * rated[0].r) === 'ok') L.push('🏆 Quảng cáo hiệu quả nhất: <b>' + esc(rated[0].k) + '</b> (chi phí bằng ' + Math.round(100 / rated[0].r) + '% tiền khách mới mua). Nên dồn thêm tiền cho kênh này.');
    return L;
  }
  /* ---------- Tab Marketing: các khối "nhìn là biết làm gì" (13/10/2026). Số từ lệnh mktv (api/src/mktv.js). Viết cho người không rành công nghệ:
   * mỗi số có đèn 🟢🟠🔴 + 1 câu "nên làm gì". */
  var MK_ADVICE = {
    c: 'Ít người bấm vào quảng cáo: thay hình / video / câu mở đầu mới cho bắt mắt hơn.',
    r: 'Bấm vào nhưng ít nhắn tin: xem lại lời chào, ưu đãi, nội dung có nói đúng điều khách cần không.',
    d: 'Nhắn tin nhưng ít để lại số: trả lời tin nhắn nhanh hơn, xin số khéo hơn (tặng ebook, tư vấn miễn phí).',
    w: 'Data nhiều nhưng ít mua: xem tỷ lệ số rác (chọn sai đối tượng) và nhắc sale gọi sớm, tư vấn kỹ hơn.',
    v: 'Khách mua ít tiền: gợi ý combo, mua 2 tặng quà, miễn ship từ 300k.'
  };
  /** Chấm điểm 1 chiến dịch: so giá 1 kết quả (tin nhắn + SĐT) với giá trung bình cả kênh. → { lv: ok|mid|bad|wait|'', tag, why, tired, stop } */
  function mkScore(r, mj) {
    var A = mj.cpr && mj.cpr[r[0]], res = (r[6] || 0) + (r[7] || 0), s = r[3] || 0, h = r[10] || [0, 0, ''], o = { lv: '', tag: '', why: '' };
    var i2 = (r[4] || 0) - h[0], c2 = (r[5] || 0) - h[1];
    if (h[0] >= 1000 && i2 >= 1000 && h[1] && c2 * h[0] < 0.7 * h[1] * i2) o.tired = 'Khách bấm ít dần: nửa đầu kỳ ' + oneDec(h[1] * 100 / h[0]) + '%, nửa sau còn ' + oneDec(c2 * 100 / i2) + '% → làm hình / video mới';
    var to = S.f.m && S.f.m.p ? perRange(S.f.m.p)[1] : 0; if (h[2] && to > Date.now() - DAY && dayMs(h[2]) < today() - DAY) o.stop = 1;
    if (!A) return o;
    if (!res) { if (s >= 1.5 * A) { o.lv = 'bad'; o.tag = '🔴 Nên tắt'; o.why = 'Đã tiêu ' + moneyShort(s) + ' mà chưa có tin nhắn / SĐT nào.'; } else { o.lv = 'wait'; o.tag = '⚪ Chưa đủ số'; o.why = 'Mới tiêu ' + moneyShort(s) + ', chờ thêm vài ngày rồi xem.'; } return o; }
    var c = s / res, k = Math.round((c / A - 1) * 100);
    if (s < 1.5 * A && res < 3) { o.lv = 'wait'; o.tag = '⚪ Chưa đủ số'; o.why = 'Mới có ' + res + ' kết quả, chờ thêm vài ngày rồi xem.'; }
    else if (c <= 0.8 * A) { o.lv = 'ok'; o.tag = '🟢 Nên tăng tiền'; o.why = '1 kết quả giá ' + moneyShort(Math.round(c)) + ', rẻ hơn mức trung bình ' + Math.abs(k) + '%.'; }
    else if (c >= 1.4 * A) { o.lv = 'bad'; o.tag = '🔴 Nên giảm / tắt'; o.why = '1 kết quả giá ' + moneyShort(Math.round(c)) + ', đắt hơn mức trung bình ' + k + '%.'; }
    else { o.lv = 'mid'; o.tag = '🟠 Giữ nguyên'; o.why = '1 kết quả giá ' + moneyShort(Math.round(c)) + ', gần mức trung bình (' + moneyShort(A) + ').'; }
    return o;
  }
  /** 🪜 Phễu: người thấy → bấm → nhắn tin / để số → data về sale → mua → tiền. Mỗi bước: “cứ 100 … thì … ” + đèn so với kỳ trước; tìm khâu yếu nhất. */
  function mkFunnel(mj, nr, newN) {
    var t = mj.tot || {}, p = mj.totPrev || {}, ad = mj.ad || {}, ap = mj.adPrev || {}, res = (t.m || 0) + (t.l || 0), resp = (p.m || 0) + (p.l || 0);
    if (!t.i && !ad.n) return { h: '', weak: null };
    var S1 = [
      { ic: '👀', l: 'Lượt thấy quảng cáo', v: t.i, cost: t.i ? moneyShort(Math.round(t.s * 1000 / t.i)) + ' / 1.000 lượt thấy' : '' },
      { ic: '👆', l: 'Lượt bấm vào', v: t.c, k: 'c', r: t.i ? t.c / t.i : null, rp: p.i ? p.c / p.i : null, say: function (x) { return 'Cứ 100 lượt thấy có ' + oneDec(x * 100) + ' lượt bấm'; }, cost: t.c ? moneyShort(Math.round(t.s / t.c)) + ' / 1 lượt bấm' : '' },
      { ic: '💬', l: 'Tin nhắn + SĐT để lại', v: res, k: 'r', r: t.c ? res / t.c : null, rp: p.c ? resp / p.c : null, say: function (x) { return 'Cứ 100 lượt bấm có ' + oneDec(x * 100) + ' người nhắn tin / để số'; }, cost: res ? moneyShort(Math.round(t.s / res)) + ' / 1 tin nhắn' : '' },
      { ic: '📇', l: 'Data về tới sale', v: ad.n, k: 'd', r: res && ad.n <= res * 1.2 ? ad.n / res : null, rp: resp && ap.n <= resp * 1.2 ? ap.n / resp : null, say: function (x) { return 'Cứ 100 tin nhắn có ' + Math.round(x * 100) + ' số điện thoại về tới sale'; }, cost: ad.n ? moneyShort(Math.round(t.s / ad.n)) + ' / 1 data' : '' },
      { ic: '🛒', l: 'Data đã mua hàng', v: ad.won, k: 'w', r: ad.n ? ad.won / ad.n : null, rp: ap.n ? ap.won / ap.n : null, say: function (x) { return 'Cứ 100 data có ' + Math.round(x * 100) + ' người mua'; }, cost: ad.won ? moneyShort(Math.round(t.s / ad.won)) + ' / 1 người mua' : '' },
      { ic: '💰', l: 'Tiền khách mới mua', v: nr, money: 1, k: 'v', r: newN ? nr / newN : null, rp: null, say: function (x) { return 'Trung bình 1 khách mới mua ' + moneyShort(Math.round(x)); } }
    ];
    var weak = null, h = '<div class="mk-fun">';
    S1.forEach(function (st, i) {
      if (st.v === undefined || st.v === null) return;
      var lv = st.r !== null && st.r !== undefined && st.rp ? (st.r >= st.rp * 0.97 ? 'ok' : st.r >= st.rp * 0.85 ? 'mid' : 'bad') : '';
      if (lv === 'bad' && (!weak || st.r / st.rp < weak.x)) weak = { k: st.k, x: st.r / st.rp, l: st.l };
      if (i && st.say && st.r !== null && st.r !== undefined) h += '<div class="mk-fun-arrow ' + lv + '">↓ ' + st.say(st.r) + (lv ? ' ' + DASH_LV[lv] + (st.rp ? ' <small>(' + CMP_LABEL + ': ' + (st.k === 'c' || st.k === 'r' ? oneDec(st.rp * 100) : Math.round(st.rp * 100)) + ')</small>' : '') : '') + '</div>';
      h += '<div class="mk-fun-step" style="width:' + (100 - i * 9) + '%"><span>' + st.ic + ' ' + st.l + '</span><b>' + (st.money ? moneyShort(st.v || 0) : (st.v || 0).toLocaleString('vi-VN')) + '</b>' + (st.cost ? '<small>' + st.cost + '</small>' : '') + '</div>';
    });
    h += '</div>';
    var tip = weak ? '<p class="mk-fun-weak">🔍 <b>Khâu yếu nhất: ' + weak.l + '.</b> ' + MK_ADVICE[weak.k] + '</p>' : (mj.totPrev && mj.totPrev.i ? '<p class="mk-fun-weak ok">✅ Không khâu nào kém đi rõ so với ' + CMP_LABEL + '.</p>' : '');
    return { h: h + tip + '<p class="bar-legend">Đọc từ trên xuống: quảng cáo đi qua từng bước, bước nào tụt nhiều so với ' + (CMP_LABEL || 'kỳ trước') + ' (đèn 🔴) là chỗ cần sửa. 3 bước đầu là số Facebook ghi nhận, data và mua hàng lấy từ file số quảng cáo.</p>', weak: weak };
  }
  /* ---------- 📊 Chỉ số chiến dịch (lệnh mkt_kpi, 23/10/2026 theo góp ý bạn marketing): CPM, CTR, CPC, tin nhắn từng chiến dịch hôm nay / hôm qua, so với
   * trung bình 7 ngày trước đó, hoặc với mức "tốt" Quản trị đặt ở Cài đặt → 📊 Mức tốt chỉ số quảng cáo (kv dash_cfg.kpi). Facebook tự cập nhật số hôm nay 1 tiếng 1 lần. */
  var KP = { j: null, at: 0, busy: 0, err: '' };
  function kpFetch(force) {
    if (KP.busy || (!force && (KP.err || (KP.j && Date.now() - KP.at < 10 * 60e3)))) return; KP.busy = 1; KP.err = '';
    api('mkt_kpi').then(function (j) { KP.j = j; KP.at = Date.now(); }, function (e) { KP.err = /Không rõ thao tác/.test(e.message) ? 'Máy chủ đang cập nhật bản mới, bấm ↻ sau 2 phút.' : e.message; })
      .then(function () { KP.busy = 0; if (route().view === 'marketing') softRender(true); });
  }
  /** Mức tốt Quản trị đặt. Chưa đặt lần nào → mức bạn marketing (Tùng) đề xuất 23/10/2026: 1 tin nhắn dưới 100k, 1 SĐT dưới 300k (200–300k là đẹp). */
  function kpGoal() { var d = S.d && S.d.rules && S.d.rules.dash, c = (d && d.kpi) || { msg: 100000, sdt: 300000 }; return { cpm: Number(c.cpm) || 0, ctr: Number(c.ctr) || 0, cpc: Number(c.cpc) || 0, msg: Number(c.msg) || 0, sdt: Number(c.sdt) || 0 }; }
  function kpCalc(t) { return { cpm: t.i ? t.s * 1000 / t.i : null, ctr: t.i ? t.c * 100 / t.i : null, cpc: t.c ? t.s / t.c : null, msg: t.m ? t.s / t.m : null, sdt: t.d ? t.s / t.d : null }; }
  /** Đèn 1 chỉ số (hi = cao là tốt, như CTR). Có mức tốt: đạt = xanh, kém hơn tới 20% = cam. Chưa có: so trung bình 7 ngày, kém hơn tới 10% = xanh, tới 30% = cam. */
  function kpLv(v, goal, avg, hi) {
    var ref = goal || avg; if (v === null || v === undefined || !ref) return '';
    var worse = hi ? (ref - v) / ref : (v - ref) / ref;
    return goal ? (worse <= 0 ? 'ok' : worse <= 0.2 ? 'mid' : 'bad') : (worse <= 0.1 ? 'ok' : worse <= 0.3 ? 'mid' : 'bad');
  }
  var KP_M = [['sdt', 'SĐT về sale', '', 0], ['cpm', 'CPM', 'giá 1.000 lượt thấy', 0], ['ctr', 'CTR', 'người thấy có bấm', 1], ['cpc', 'CPC', 'giá 1 lượt bấm', 0], ['msg', 'Tin nhắn', '', 0]];
  function kpFmt(k, v) { return v === null || v === undefined ? '–' : k === 'ctr' ? oneDec(v) + '%' : moneyShort(Math.round(v)); }
  /** 4 ô chỉ số của 1 chiến dịch (hoặc cả tài khoản). t = ngày đang xem, y = ngày trước đó, b = 7 ngày trước đó (cộng dồn). → { h, bad } */
  function kpCells(t, y, b, G, yl, withSdt) {
    var C = kpCalc(t), Y = kpCalc(y), B = kpCalc(b), few = t.i < 500, bad = 0;
    var h = '<div class="kp-g">' + KP_M.filter(function (m) { return withSdt || m[0] !== 'sdt'; }).map(function (m) {
      var k = m[0], v = C[k], cnt = k === 'msg' ? 'm' : k === 'sdt' ? 'd' : '', lv = few && !cnt ? '' : kpLv(v, G[k], B[k], m[3]), ref = G[k] || B[k];
      if (cnt && !t[cnt] && ref && t.s >= 1.5 * ref) lv = 'bad';
      if (lv === 'bad') bad++;
      var unit = k === 'msg' ? ' tin' : ' số', big = cnt ? (t[cnt] || 0) + unit : kpFmt(k, v), sub = cnt ? (v !== null ? moneyShort(Math.round(v)) + ' / 1' + unit : 'chưa có' + unit) : m[2];
      var cmp = [y.i || y.m || y.d ? yl + ' ' + kpFmt(k, Y[k]) : '', b.i || b.m || b.d ? 'TB 7 ngày ' + kpFmt(k, B[k]) : '', G[k] ? 'tốt: ' + (m[3] ? 'từ ' : 'dưới ') + kpFmt(k, G[k]) : ''].filter(Boolean).join(' · ');
      return '<div class="kp-c ' + lv + (k === 'sdt' ? ' kp-main' : '') + '"><span class="kp-l">' + m[1] + (DASH_LV[lv] ? ' <i title="' + DASH_TIP[lv] + '">' + DASH_LV[lv] + '</i>' : '') + '</span><b>' + big + '</b><small>' + sub + '</small>' + (cmp ? '<small class="kp-cmp">' + cmp + '</small>' : '') + '</div>';
    }).join('') + '</div>';
    return { h: h, bad: bad };
  }
  function mkKpiBlock(f) {
    var j = KP.j;
    if (!j) return { line: KP.err ? '⚠️ ' + esc(KP.err) : '⏳ Đang tải…', h: KP.err ? '<p class="err">' + esc(KP.err) + '</p>' : '<p class="muted">⏳ Đang tải…</p>', bad: 0 };
    var t0 = dayMs(j.today), yd = f.kd === 'y', dv = isoDate(yd ? t0 - DAY : t0), dp = isoDate(yd ? t0 - 2 * DAY : t0 - DAY), v0 = dayMs(dv), yl = yd ? 'hôm kia' : 'hôm qua';
    var G = kpGoal(), C = {}, z = function () { return { s: 0, i: 0, c: 0, m: 0 }; }, T = { t: z(), y: z(), b: z() };
    var add = function (o, r) { o.s += r[4] || 0; o.i += r[5] || 0; o.c += r[6] || 0; o.m += r[7] || 0; };
    (j.rows || []).forEach(function (r) {
      var acc = r[3] || ['', ''], k = r[1] + '|' + acc[0] + '|' + r[2], o = C[k] || (C[k] = { ch: r[1], n: r[2], acc: acc, t: z(), y: z(), b: z() }), ms = dayMs(r[0]);
      if (r[0] === dv) { add(o.t, r); add(T.t, r); }
      if (r[0] === dp) { add(o.y, r); add(T.y, r); }
      if (ms >= v0 - 7 * DAY && ms < v0) { add(o.b, r); add(T.b, r); }
    });
    var DD = j.data || {}; T.t.d = DD[dv] || 0; T.y.d = DD[dp] || 0; T.b.d = 0; for (var q = 1; q <= 7; q++) T.b.d += DD[isoDate(v0 - q * DAY)] || 0;
    var list = Object.keys(C).map(function (k) { return C[k]; }).filter(function (o) { return o.t.s > 0 || o.t.i > 0; }).sort(function (a, b) { return b.t.s - a.t.s; });
    var n = f.kall ? 80 : 12, badN = 0, cards = list.map(function (o) {
      var K = kpCells(o.t, o.y, o.b, G, yl); if (K.bad) badN++;
      return { bad: K.bad, h: '<div class="mk-camp kp-camp ' + (K.bad ? 'bad' : '') + '"><div class="mk-camp-h"><b>' + esc(o.n || 'Không tên') + '</b><span class="mk-camp-v">' + moneyShort(o.t.s) + '</span></div>' +
        '<p class="small muted">' + chInfo(o.ch).icon + ' ' + esc(o.ch) + (o.acc[0] ? ' · ' + (o.acc[1] ? '<a href="https://adsmanager.facebook.com/adsmanager/manage/campaigns?act=' + esc(o.acc[1].replace(/^act_/, '')) + '" target="_blank" rel="noopener">🏷 ' + esc(o.acc[0]) + '</a>' : '🏷 ' + esc(o.acc[0])) : '') + (o.t.i ? ' · ' + o.t.i.toLocaleString('vi-VN') + ' lượt thấy · ' + o.t.c.toLocaleString('vi-VN') + ' lượt bấm' : '') + '</p>' + K.h + '</div>' };
    });
    var TC = kpCalc(T.t), day = yd ? 'Hôm qua' : 'Hôm nay';
    var TS = T.t.d ? moneyShort(Math.round(T.t.s / T.t.d)) + ' / 1 SĐT · ' : '', line = T.t.i ? day + ': ' + TS + 'CPM ' + kpFmt('cpm', TC.cpm) + ' · CTR ' + kpFmt('ctr', TC.ctr) + ' · CPC ' + kpFmt('cpc', TC.cpc) + ' · ' + T.t.m + ' tin nhắn' + (badN ? ' · 🔴 ' + badN + ' chiến dịch cần xem' : '') : day + ' chưa có số quảng cáo';
    var h = '<div class="chips wrap"><button class="chip' + (yd ? '' : ' on') + '" data-kpd="">Hôm nay</button><button class="chip' + (yd ? ' on' : '') + '" data-kpd="y">Hôm qua</button></div>';
    h += '<p class="small muted">' + (j.last ? '📘 Facebook cập nhật lúc ' + fDateTime(j.last) + ' · số hôm nay tự cập nhật 1 tiếng 1 lần (7h–22h).' : 'Chưa kết nối Facebook tự động: chỉ có số từ file đã nhập.') + '</p>';
    if (!list.length) return { line: line, bad: 0, h: h + '<p class="muted">' + day + ' chưa có chiến dịch nào có lượt hiển thị.</p>' };
    var TK = kpCells(T.t, T.y, T.b, G, yl, 1);
    h += '<div class="mk-camp kp-camp kp-all"><div class="mk-camp-h"><b>Tất cả chiến dịch</b><span class="mk-camp-v">' + moneyShort(T.t.s) + '</span></div>' + TK.h + '</div>';
    cards.sort(function (a, b) { return b.bad - a.bad; });
    h += '<div class="mk-camps">' + cards.slice(0, n).map(function (c) { return c.h; }).join('') + '</div>' + (cards.length > n ? '<button class="btn ghost sm" data-kpall="1">Xem thêm ' + (cards.length - n) + ' chiến dịch</button>' : '');
    h += '<p class="bar-legend"><b>CPM</b> = tiền cho 1.000 lượt thấy quảng cáo (thầu đắt hay rẻ). <b>CTR</b> = cứ 100 người thấy có mấy người bấm (hình / video có hút không). <b>CPC</b> = tiền cho 1 lượt bấm. <b>Tin nhắn</b> = số tin khách nhắn và giá 1 tin. <b>SĐT về sale</b> = số điện thoại khách để lại có trong file số quảng cáo của sale và giá 1 số: <b>chỉ số quan trọng nhất</b> với ngành hàng mình; chỉ có ở ô Tất cả chiến dịch vì file số chưa ghi tên chiến dịch. ' +
      (G.cpm || G.ctr || G.cpc || G.msg ? 'Đèn so với <b>mức tốt</b> Quản trị đặt (🟢 đạt · 🟠 kém hơn tới 20% · 🔴 kém hơn nhiều); chỉ số chưa có mức tốt thì so trung bình 7 ngày.' : 'Đèn so với <b>trung bình 7 ngày trước</b> của chính chiến dịch đó: 🟢 bằng hoặc tốt hơn · 🟠 kém hơn 10–30% · 🔴 kém hơn trên 30%. Quản trị đặt mức tốt ở Cài đặt → 📊 Mức tốt chỉ số quảng cáo.') +
      ' Dưới 500 lượt thấy thì chưa tô đèn. Chiến dịch có đèn 🔴 xếp lên đầu. Khách mua thật, tiền thật xem ở 🎬 Chiến dịch và 🧴 Quảng cáo từng sản phẩm.</p>';
    return { line: line, h: h, bad: badN };
  }
  /** 🎬 Chiến dịch chấm điểm: lọc theo tài khoản + theo lời khuyên. */
  function mkCampBlock(mj, f) {
    var rows = campRows(mj.camps).map(function (c, i) { c.r = mj.camps[i]; c.sc = mkScore(c.r, mj); return c; });
    var accs = {}; rows.forEach(function (c) { if (c.acc) accs[c.acc] = (accs[c.acc] || 0) + c.v; });
    var accL = Object.keys(accs).sort(function (x, y) { return accs[y] - accs[x]; }); if (accL.indexOf(f.acc) < 0) f.acc = '';
    if (f.acc) rows = rows.filter(function (c) { return c.acc === f.acc; });
    var cnt = { ok: 0, mid: 0, bad: 0, wait: 0 }; rows.forEach(function (c) { if (cnt[c.sc.lv] !== undefined) cnt[c.sc.lv]++; });
    if (f.cv && !cnt[f.cv]) f.cv = '';
    var list = f.cv ? rows.filter(function (c) { return c.sc.lv === f.cv; }) : rows, n = f.call ? 60 : 12;
    var chip = function (k, l) { return '<button class="chip' + ((f.cv || '') === k ? ' on' : '') + '" data-mkc="' + k + '">' + l + '</button>'; };
    var h = '', tired = rows.filter(function (c) { return c.sc.tired; }).length;
    var line = rows.length ? [cnt.ok ? '🟢 ' + cnt.ok + ' nên tăng tiền' : '', cnt.bad ? '🔴 ' + cnt.bad + ' nên giảm / tắt' : '', tired ? '🎨 ' + tired + ' cần mẫu mới' : '', cnt.mid ? '🟠 ' + cnt.mid + ' giữ nguyên' : ''].filter(Boolean).join(' · ') || rows.length + ' chiến dịch' : 'Chưa có chiến dịch trong kỳ';
    if (accL.length > 1) h += '<div class="chips wrap"><button class="chip' + (f.acc ? '' : ' on') + '" data-mka="">Mọi tài khoản</button>' + accL.map(function (a) { return '<button class="chip' + (f.acc === a ? ' on' : '') + '" data-mka="' + esc(a) + '">🏷 ' + esc(a) + ' · ' + moneyShort(accs[a]) + '</button>'; }).join('') + '</div>';
    h += '<div class="chips wrap">' + chip('', 'Tất cả ' + rows.length) + (cnt.ok ? chip('ok', '🟢 Nên tăng ' + cnt.ok) : '') + (cnt.mid ? chip('mid', '🟠 Giữ ' + cnt.mid) : '') + (cnt.bad ? chip('bad', '🔴 Nên giảm / tắt ' + cnt.bad) : '') + (cnt.wait ? chip('wait', '⚪ Chưa đủ số ' + cnt.wait) : '') + '</div>';
    if (!list.length) return { h: h + '<p class="muted">Chưa có chiến dịch trong kỳ.</p>', line: line };
    h += '<div class="mk-camps">' + list.slice(0, n).map(function (c) {
      var r = c.r, sc = c.sc, ctr = r[4] ? oneDec(r[5] * 100 / r[4]) + '% bấm' : '';
      return '<div class="mk-camp ' + (sc.lv || '') + '"><div class="mk-camp-h">' + (sc.tag ? '<span class="mk-badge ' + sc.lv + '">' + sc.tag + '</span>' : '') + (sc.stop ? '<span class="tag">⏸ đã dừng</span>' : '') + '<b>' + esc(c.l) + '</b><span class="mk-camp-v">' + moneyShort(c.v) + '</span></div>' +
        (sc.why ? '<p class="mk-camp-why">' + sc.why + '</p>' : '') + (sc.tired ? '<p class="mk-camp-why mid">🎨 ' + sc.tired + '</p>' : '') +
        '<p class="small muted">' + [c.subH, ctr, r[8] ? '🛒 Facebook ghi nhận ' + r[8] + ' lượt mua' : ''].filter(Boolean).join(' · ') + '</p></div>';
    }).join('') + '</div>' + (list.length > n ? '<button class="btn ghost sm" data-mkv="call">Xem thêm ' + (list.length - n) + ' chiến dịch</button>' : '');
    var A = mj.cpr && mj.cpr.Facebook;
    return { line: line, h: h + '<p class="bar-legend">Kết quả = tin nhắn + SĐT khách để lại (Facebook ghi nhận).' + (A ? ' Giá trung bình 1 kết quả kỳ này: <b>' + moneyShort(A) + '</b>.' : '') + ' 🟢 rẻ hơn trung bình từ 20% · 🔴 đắt hơn từ 40% hoặc tiêu nhiều mà không ra kết quả · ⚪ tiêu chưa đủ để kết luận. Bấm 🏷 tên tài khoản để mở Trình quản lý quảng cáo.</p>' };
  }
  /** 🧴 Theo sản phẩm: chi phí (tên chiến dịch) ↔ data, tỷ lệ mua, tiền khách mới (dòng sản phẩm của đơn). */
  function mkProdBlock(mj) {
    var P = (mj.prod || []).filter(function (p) { return p.sp || p.rev; }); if (!P.length) return { h: '', line: '' };
    var named = P.filter(function (p) { return p.k; }), none = P.filter(function (p) { return !p.k; })[0];
    var h = '<div class="dash-chs">', lvs = { ok: [], mid: [], bad: [] };
    named.forEach(function (p) {
      var lead = /^Ebook/.test(p.k), lv = p.sp && !lead ? adsLv(p.sp, p.rev) : ''; if (lv) lvs[lv].push(p.k); var st = function (l, v) { return '<div class="dash-ch-s"><span>' + l + '</span><b>' + v + '</b></div>'; };
      h += '<div class="dash-ch mk-prod ' + lv + '"><div class="dash-ch-h"><b>' + esc(p.k) + '</b>' + (lv ? '<span class="mk-badge ' + lv + '">' + DASH_LV[lv] + ' ' + (lv === 'ok' ? 'Chi phí thấp' : lv === 'mid' ? 'Chi phí vừa' : 'Chi phí cao') + '</span>' : '') + '</div><div class="dash-ch-g">' +
        st('Chi phí quảng cáo', p.sp ? moneyShort(p.sp) : '–') + st('Tiền khách mới', moneyShort(p.rev)) +
        st('Data / đã mua', p.n ? p.n + ' / ' + p.won + ' <small>(' + pct(p.won, p.n) + '%)</small>' : '–') + st('Chi phí / tiền khách mới', p.sp && p.rev ? Math.round(p.sp * 100 / p.rev) + '%' : '–') +
        '</div><p class="small muted">' + (lead ? 'Chiến dịch xin số (tặng ebook): đánh giá bằng chi phí / data và tỷ lệ data mua hàng, không so như quảng cáo sản phẩm' : p.sp && p.rev ? 'Bỏ 1đ quảng cáo thu về ' + oneDec(p.rev / p.sp) + 'đ' : p.sp ? 'Chưa có khách mới mua sản phẩm này' : 'Có khách mới mua nhưng chưa thấy chiến dịch mang tên sản phẩm') + (p.newN ? ' · ' + p.newN + ' khách mới' : '') + '</p></div>';
    });
    h += '</div>';
    if (none && none.sp) h += '<p class="small muted">❔ ' + moneyShort(none.sp) + ' chi phí nằm ở chiến dịch không có tên sản phẩm. Đặt tên chiến dịch có tên sản phẩm (vd <b>7-10-PROGOMAX-SỮA</b>) để chia đúng.</p>';
    return { line: [lvs.ok.length ? '🟢 Chi phí thấp: ' + lvs.ok.join(', ') : '', lvs.bad.length ? '🔴 Chi phí cao: ' + lvs.bad.join(', ') : '', lvs.mid.length ? '🟠 Chi phí vừa: ' + lvs.mid.join(', ') : ''].filter(Boolean).join(' · ') || named.length + ' sản phẩm',
      h: h + '<p class="bar-legend">Chi phí: theo tên chiến dịch. Data: theo cột Nguồn quảng cáo của file số. Tiền khách mới: các dòng sản phẩm trong đơn của khách mua lần đầu (kênh có chạy quảng cáo). Đèn giống ô 🚦: dưới ' + dashAds()[0] + '% tiền khách mới mua là chi phí thấp (chưa tính giá vốn nên chưa biết lời lỗ).</p>' };
  }
  /* ---------------------------------------------------------------- 📍 Link & mã QR (api/src/links.js)
   * Mỗi điểm chạm (tờ rơi, standee, gói hàng, đối tác, quảng cáo…) 1 mã: in QR thucduonglanh.vn/q/<mã>/ → máy chủ đếm lượt quét → trang đích kèm UTM.
   * Marketing, Quản lý, Quản trị tạo / sửa được. Mã không đổi, không xoá (đã in phải luôn chạy); "Ngừng dùng" chỉ ẩn khỏi danh sách. */
  var LQ = { cache: {}, err: '', busy: '', lib: 0 };
  function lqLib() { // thư viện vẽ QR (crm/qrcode.js, MIT) chỉ tải khi mở tab này
    if (window.qrcode || LQ.lib) return; LQ.lib = 1;
    var sc = document.createElement('script'); sc.src = '/qrcode.js?v=1'; sc.onload = function () { render(); }; sc.onerror = function () { LQ.lib = 0; }; document.head.appendChild(sc);
  }
  function lqMake(text) { var q = window.qrcode(0, 'M'); q.addData(text); q.make(); return q; }
  function lqSvg(text, cell) { return window.qrcode ? lqMake(text).createSvgTag({ cellSize: cell || 4, margin: 4, scalable: true }) : ''; }
  function lqFetch(key) {
    var k = key.split('_'); LQ.busy = key; LQ.err = '';
    api('link_list', { from: k[0], to: k[1], pf: k[2], pt: k[3] }).then(function (j) { LQ.cache[key] = j; if (S.d) S.d.qrLinks = j.links.map(function (l) { return [l.code, l.name]; }); }, function (e) { LQ.err = /Không rõ thao tác/.test(e.message) ? 'Máy chủ đang cập nhật bản mới, thử lại sau 2 phút.' : e.message; })
      .then(function () { LQ.busy = ''; if (route().view === 'link-qr') render(); });
  }
  function lqKey() { var f = S.f.q; return gaKey(perRange(f.p), cmpRange(f.p)); }
  function lqCur() { return LQ.cache[lqKey()]; }
  function viewLinks() {
    var f = S.f.q || (S.f.q = { p: { k: 'month' } }), key = lqKey(), j = LQ.cache[key]; lqLib();
    if (!j && !LQ.err && LQ.busy !== key) setTimeout(function () { lqFetch(key); }, 0);
    var h = '<div class="page-head"><h1>📍 Link &amp; mã QR</h1><div class="grow"></div><button class="btn pri" data-lq="new">＋ Tạo link mới</button></div>' +
      '<p class="muted small lq-intro">Mỗi tờ rơi, standee, gói hàng, đối tác, quảng cáo dùng <b>1 link riêng</b>. Khách quét QR → vào web → đơn tự ghi nguồn. ⚠️ Link đã in thì không xoá được, chỉ đổi được tên và trang đích (QR đã in tự dẫn sang trang mới).</p>' +
      perChips('q', f.p);
    if (!j) return h + '<div class="box"><p class="muted">' + (LQ.err ? '⚠️ ' + esc(LQ.err) + ' <button class="link" data-lq="reload">Thử lại</button>' : '⏳ Đang tải…') + '</p></div>';
    var z = [0, 0, 0, 0], st = j.stats || {}, pv = j.prev || {}, T = [0, 0, 0, 0], Tp = [0, 0, 0, 0];
    j.links.forEach(function (l) { var a = st[l.code] || z, b = pv[l.code] || z; for (var i = 0; i < 4; i++) { T[i] += a[i]; Tp[i] += b[i]; } });
    var QB = trendBuckets(perRange(f.p)), qs = function (i) { return st._dd ? trendDays(QB, st._dd, function (r) { return r[1][i]; }) : null; }, qsk = function (i) { var v = qs(i); return v ? sparkSvg(v, QB.partial) : ''; };
    var tay = st._tay || z; T[1] += tay[1]; T[2] += tay[2]; T[3] += tay[3]; var tp = pv._tay || z; Tp[1] += tp[1]; Tp[2] += tp[2]; Tp[3] += tp[3];
    h += '<div class="metrics dash-m3">' + metric('👀 Lượt quét / mở link', T[0], 'Mỗi điện thoại tính 1 lần / ngày / link. Đếm cả khách chưa đồng ý cookie.', delta(T[0], Tp[0]), '', qsk(0)) +
      metric('🛒 Đơn', T[1], (T[0] && T[1] - tay[1] ? 'Cứ 100 lượt quét có ' + oneDec((T[1] - tay[1]) * 100 / T[0]) + ' đơn. ' : '') + 'Gồm khách quét rồi vài hôm sau mới đặt (trong 30 ngày).', delta(T[1], Tp[1]), '', qsk(1)) +
      metric('💰 Tiền', moneyShort(T[2]), 'Đơn huỷ / hoàn không tính.', delta(T[2], Tp[2]), '', qsk(2)) + metric('🆕 Khách mới', T[3], 'Khách mua lần đầu trong kỳ.', delta(T[3], Tp[3]), '', qsk(3)) + '</div>';
    if (tay[1]) h += '<p class="small">☎️ Khách gọi / nhắn Zalo đặt sau khi nhận tờ rơi, gặp ở sự kiện (sale lên đơn chọn “Tờ rơi / Sự kiện”): <b>' + tay[1] + ' đơn · ' + moneyShort(tay[2]) + '</b></p>';
    var on = j.links.filter(function (l) { return l.active; }).sort(function (a, b) { var x = st[a.code] || z, y = st[b.code] || z; return y[2] - x[2] || y[0] - x[0] || (b.at || 0) - (a.at || 0); }), off = j.links.filter(function (l) { return !l.active; });
    var kn = {}; (j.kinds || []).forEach(function (k) { kn[k[0]] = k[1]; });
    var card = function (l) {
      var a = st[l.code] || z, b = pv[l.code] || z, s = function (k, v) { return '<div class="dash-ch-s"><span>' + k + '</span><b>' + v + '</b></div>'; };
      return '<div class="dash-ch lq-card' + (l.active ? '' : ' lq-off') + '"><div class="lq-top"><button type="button" class="lq-qr" data-lq="qr|' + esc(l.code) + '" title="Tải mã QR">' + (lqSvg(l.short, 3) || '<span class="muted small">QR</span>') + '</button><div class="lq-info">' +
        '<b>' + esc(l.name) + '</b><span class="muted small lq-meta">' + esc(kn[l.kind] || l.kind) + ' · mã <b>' + esc(l.code) + '</b>' + (l.active ? '' : ' · ⏸ đã ngừng dùng') + '</span>' +
        '<span class="small muted lq-dest">→ ' + esc(/^(\/|https:\/\/(www\.)?thucduonglanh\.vn\/?)$/.test(l.dest) ? 'Trang chủ' : l.dest) + '</span>' + (l.note ? '<span class="small lq-note">' + esc(l.note) + '</span>' : '') + '</div></div>' +
        '<div class="dash-ch-g">' + s('👀 Lượt quét', a[0] + (b[0] ? ' <small>(' + (CMP_LABEL || 'kỳ trước') + ' ' + b[0] + ')</small>' : '')) + s('🛒 Đơn', a[1] + (a[0] && a[1] ? ' <small>(' + oneDec(a[1] * 100 / a[0]) + '%)</small>' : '')) +
        s('💰 Tiền', a[2] ? moneyShort(a[2]) : '–') + s('🆕 Khách mới', a[3]) + '</div>' +
        '<div class="lq-btns"><button class="btn sm" data-lq="qr|' + esc(l.code) + '">⬇ Tải QR</button><button class="btn sm ghost" data-lq="cs|' + esc(l.code) + '">📋 Link in</button><button class="btn sm ghost" data-lq="ct|' + esc(l.code) + '">📋 Link quảng cáo</button><button class="btn sm ghost" data-lq="ed|' + esc(l.code) + '">✏️ Sửa</button></div>' +
        '<p class="small muted lq-by">Tạo bởi ' + esc(l.by_name || '–') + (l.at ? ' · ' + fDate(l.at) : '') + (l.upd_by ? ' · sửa lần cuối: ' + esc(l.upd_by) + (l.upd_at ? ' ' + fDate(l.upd_at) : '') : '') + '</p></div>';
    };
    h += on.length ? '<div class="dash-chs lq-list">' + on.map(card).join('') + '</div>' : '<div class="box"><p>Chưa có link nào. Bấm <b>＋ Tạo link mới</b>.</p></div>';
    if (off.length) h += '<details class="lq-offs"><summary>⏸ Link đã ngừng dùng (' + off.length + ')</summary><div class="dash-chs lq-list">' + off.map(card).join('') + '</div></details>';
    return h + '<p class="bar-legend"><b>Link in</b> (thucduonglanh.vn/q/…): dùng làm mã QR trên tờ rơi, standee, gói hàng. <b>Link quảng cáo</b> (link dài có UTM): dán vào Google Ads, YouTube, bài đăng, không cần QR. Muốn xem riêng 1 sự kiện: chọn 📅 đúng ngày diễn ra sự kiện.</p>';
  }
  function lqFind(code) { var j = lqCur(); return j ? j.links.filter(function (l) { return l.code === code; })[0] : null; }
  function lqDl(name, blob) { var a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = name; document.body.appendChild(a); a.click(); setTimeout(function () { URL.revokeObjectURL(a.href); a.remove(); }, 1000); }
  function lqPng(text, code) { // ảnh PNG ~2000px để in, kèm dòng link bên dưới cho khách không quét được
    var q = lqMake(text), n = q.getModuleCount(), cell = Math.ceil(2000 / (n + 8)), w = cell * (n + 8), cap = Math.round(cell * 3.2), cv = document.createElement('canvas'), c = cv.getContext('2d');
    cv.width = w; cv.height = w + cap; c.fillStyle = '#fff'; c.fillRect(0, 0, cv.width, cv.height); c.fillStyle = '#000';
    for (var r = 0; r < n; r++) for (var k = 0; k < n; k++) if (q.isDark(r, k)) c.fillRect((k + 4) * cell, (r + 4) * cell, cell, cell);
    c.font = '600 ' + Math.round(cell * 1.6) + 'px system-ui, -apple-system, sans-serif'; c.textAlign = 'center'; c.fillText(text.replace(/^https:\/\//, '').replace(/\/$/, ''), w / 2, w + Math.round(cap * 0.35));
    cv.toBlob(function (b) { lqDl('QR-' + code + '.png', b); }, 'image/png');
  }
  function lqQrOpen(l) {
    if (!window.qrcode) { toast('Đang tải công cụ vẽ QR, bạn bấm lại sau 1 giây.'); lqLib(); return; }
    var m = modal('⬇ Mã QR · ' + esc(l.name), '<div class="lq-big">' + lqSvg(l.short, 8) + '</div><p class="small" style="text-align:center"><b>' + esc(l.short.replace(/^https:\/\//, '')) + '</b></p>' +
      '<p class="small muted">• <b>PNG</b>: ảnh 2000px có dòng link bên dưới, dán vào Canva hoặc gửi Zalo cho bên thiết kế.<br>• <b>SVG</b>: gửi nhà in, in to cỡ nào cũng nét.<br>• Nên in QR rộng từ 2,5 cm trở lên, nền trắng, có chữ “Quét để xem ưu đãi”.</p>',
      '<button class="btn" data-close>Đóng</button><button class="btn" id="lqSvgBtn">⬇ SVG</button><button class="btn pri" id="lqPngBtn">⬇ PNG</button>');
    $('#lqPngBtn', m).onclick = function () { lqPng(l.short, l.code); };
    $('#lqSvgBtn', m).onclick = function () { lqDl('QR-' + l.code + '.svg', new Blob([lqMake(l.short).createSvgTag({ cellSize: 10, margin: 4 })], { type: 'image/svg+xml' })); };
  }
  function lqForm(l) {
    var j = lqCur() || {}, isNew = !l; l = l || { code: '', name: '', kind: 'to-roi', dest: '/', note: '' };
    var m = modal(isNew ? '＋ Tạo link mới' : '✏️ Sửa link · ' + esc(l.code),
      '<label class="f"><span>Mã ngắn</span><input type="text" id="lqCode" value="' + esc(l.code) + '"' + (isNew ? '' : ' disabled') + ' maxlength="30" autocapitalize="off" autocomplete="off" placeholder="vd: dt-anlac"></label>' +
      '<p class="hint">' + (isNew ? 'Chữ thường không dấu, số, dấu gạch ngang. Càng ngắn QR càng dễ quét. Link in: thucduonglanh.vn/q/<b id="lqPrev">' + esc(l.code || '…') + '</b>/. ⚠️ Tạo xong không đổi được mã.' : 'Mã đã tạo thì không đổi được (QR đã in phải luôn chạy).') + '</p>' +
      '<label class="f"><span>Tên (để nhận ra trong báo cáo)</span><input type="text" id="lqName" value="' + esc(l.name) + '" maxlength="120" placeholder="vd: Standee cửa hàng chay An Lạc"></label>' +
      '<label class="f"><span>Loại</span><select id="lqKind">' + (j.kinds || []).map(function (k) { return '<option value="' + k[0] + '"' + (k[0] === l.kind ? ' selected' : '') + '>' + esc(k[1]) + '</option>'; }).join('') + '</select></label>' +
      '<label class="f"><span>Trang đích</span><input type="text" id="lqDest" value="' + esc(l.dest) + '" maxlength="500" autocapitalize="off" placeholder="/"></label>' +
      '<p class="hint"><b>/</b> = trang chủ. Trang sản phẩm: mở web, chép phần sau tên miền, vd <b>/san-pham/tra-dilvang/</b>. Đổi được bất cứ lúc nào.</p>' +
      '<label class="f"><span>Ghi chú (đặt ở đâu, in bao nhiêu, ngày nào)</span><textarea id="lqNote" rows="3" maxlength="1000">' + esc(l.note || '') + '</textarea></label>' +
      (isNew ? '' : '<p class="hint">' + (l.active ? '<button type="button" class="link" id="lqOff">⏸ Ngừng dùng link này</button> (ẩn khỏi danh sách; QR đã in vẫn dẫn khách vào web bình thường)' : '<button type="button" class="link" id="lqOn">▶️ Dùng lại link này</button>') + '</p>'),
      '<button class="btn" data-close>Huỷ</button><button class="btn pri" id="lqSave">Lưu</button>');
    var cd = $('#lqCode', m); if (isNew) cd.oninput = function () { var v = cd.value.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/đ/g, 'd').replace(/[^a-z0-9-]+/g, '-').replace(/^-+/, '').slice(0, 30); if (v !== cd.value) cd.value = v; $('#lqPrev', m).textContent = v || '…'; };
    var done = function (msg) { toast(msg); closeModal(); LQ.cache = {}; render(); };
    $('#lqSave', m).onclick = function () {
      var b = this, d = { code: isNew ? cd.value.replace(/-+$/, '') : l.code, name: $('#lqName', m).value.trim(), kind: $('#lqKind', m).value, dest: $('#lqDest', m).value.trim() || '/', note: $('#lqNote', m).value.trim(), isNew: isNew ? 1 : 0 };
      if (!d.code) return toast('Bạn chưa nhập mã ngắn.', true); if (!d.name) return toast('Bạn chưa đặt tên cho link.', true);
      b.disabled = true; api('link_save', d).then(function () { done(isNew ? 'Đã tạo link ' + d.code + ' ✓ Bấm ⬇ Tải QR để lấy mã.' : 'Đã lưu ✓'); }, function (e) { b.disabled = false; toast(e.message, true); });
    };
    var tg = function (onv) { return function () { if (!onv && !confirm('Ngừng dùng link “' + l.name + '”? Link ẩn khỏi danh sách, QR đã in vẫn dẫn khách vào web.')) return; api('link_active', { code: l.code, on: onv ? 1 : 0 }).then(function () { done(onv ? 'Đã dùng lại ✓' : 'Đã ngừng dùng ✓'); }, function (e) { toast(e.message, true); }); }; };
    if ($('#lqOff', m)) $('#lqOff', m).onclick = tg(false); if ($('#lqOn', m)) $('#lqOn', m).onclick = tg(true);
  }
  document.addEventListener('click', function (e) {
    var t = e.target.closest('[data-lq]'); if (!t) return;
    var v = t.getAttribute('data-lq').split('|'), l = v[1] ? lqFind(v[1]) : null;
    if (v[0] === 'new') return lqForm(null);
    if (v[0] === 'reload') { LQ.err = ''; LQ.cache = {}; return render(); }
    if (!l) return;
    if (v[0] === 'qr') return lqQrOpen(l);
    if (v[0] === 'ed') return lqForm(l);
    if (v[0] === 'cs' || v[0] === 'ct') { copy(v[0] === 'cs' ? l.short : l.target).then(function () { toast(v[0] === 'cs' ? 'Đã chép link in QR ✓' : 'Đã chép link quảng cáo ✓'); }); }
  });
  /* ---------------------------------------------------------------- 🤖 Trợ lý Zalo An Lành (api/src/zbot.js, chương trình ở zalo-bot/)
   * Tài khoản Zalo "Trợ lý An Lành" làm phó nhóm: chào người mới, trả lời câu hỏi, chúc mừng khách nhận quà trên web, tự duyệt người đã để số, đăng bài sáng / tối.
   * Tab này: xem trợ lý có đang chạy không, sửa / duyệt / bỏ bài AI soạn trước, gửi tin vào nhóm, cài đặt, xem trợ lý vừa làm gì. Quản lý, Quản trị, Marketing. */
  var ZB = { d: null, busy: 0, err: '' };
  var ZB_KIND = { welcome: ['👋', 'Chào người mới'], answer: ['💬', 'Trả lời trong nhóm'], handoff: ['🙋', 'Cần người thật (nhóm)'], react: ['❤️', 'Thả tim'], dm: ['📩', 'Trả lời tin riêng'], dm_handoff: ['🙋', 'Cần người thật (tin riêng)'],
    post: ['📝', 'Đăng bài'], send: ['📣', 'Đăng tin nhân sự gửi'], announce: ['🎉', 'Chúc mừng nhận quà'], friend: ['🤝', 'Kết bạn'], human: ['🧑', 'Nhân sự nhắn tay, trợ lý nhường 2 tiếng'], error: ['⚠️', 'Lỗi'], skip: ['🤐', 'Không trả lời'] };
  function zbFetch() {
    ZB.busy = 1; ZB.err = '';
    api('zb_view', {}).then(function (j) { ZB.d = j; }, function (e) { ZB.err = /Không rõ thao tác/.test(e.message) ? 'Máy chủ đang cập nhật bản mới, thử lại sau 2 phút.' : e.message; })
      .then(function () { ZB.busy = 0; if (route().view === 'tro-ly-zalo') render(); });
  }
  function zbDay(day) { var t = new Date(day.slice(0, 4) + '-' + day.slice(4, 6) + '-' + day.slice(6, 8) + 'T12:00:00+07:00').getTime(), d0 = today(); return dayStart(t) === d0 ? 'Hôm nay' : dayStart(t) === d0 + DAY ? 'Ngày mai' : dayStart(t) === d0 - DAY ? 'Hôm qua' : day.slice(6, 8) + '/' + day.slice(4, 6); }
  function zbSlot(id) { return (ZB.d.cfg.slots || []).filter(function (s) { return s.id === id; })[0] || { id: id, at: '', on: false }; }
  function viewZbot() {
    if (!ZB.d && !ZB.err && !ZB.busy) setTimeout(zbFetch, 0);
    var h = '<div class="page-head"><h1>🤖 Trợ lý Zalo An Lành</h1><div class="grow"></div><button class="btn pri" data-zb="send">📣 Gửi tin vào nhóm</button></div>' +
      '<p class="muted small lq-intro">Tài khoản Zalo <b>“Trợ lý An Lành”</b> làm phó nhóm: chào người mới, trả lời câu hỏi, chúc mừng khách vừa nhận quà trên web, tự duyệt người đã để số, đăng bài sáng và tối. Câu nào cần người thật thì báo Telegram.</p>';
    if (!ZB.d) return h + '<div class="box"><p class="muted">' + (ZB.err ? '⚠️ ' + esc(ZB.err) + ' <button class="link" data-zb="reload">Thử lại</button>' : '⏳ Đang tải…') + '</p></div>';
    var j = ZB.d, c = j.cfg, st = j.status, live = st && !st.down && j.now - st.at < 15 * 60e3, n = {};
    (j.stats || []).forEach(function (r) { n[r.kind] = r.n; });
    var g = function (k) { return n[k] || 0; };
    // trạng thái
    h += '<div class="box zb-status ' + (live && c.on ? 'ok' : 'bad') + '"><p><b>' + (!st ? '⚪ Chưa chạy lần nào' : !c.on ? '⏸ Đang tắt (bật lại ở Cài đặt bên dưới)' : live ? '🟢 Đang chạy' : '🔴 Mất kết nối') + '</b>' +
      (st ? ' · lần cuối báo về ' + fDateTime(st.at) + (st.me && st.me.name ? ' · tài khoản <b>' + esc(st.me.name) + '</b>' : '') : '') + '</p>' +
      (!st ? '<p class="small">Cần chạy chương trình trợ lý trên máy tính và quét mã QR bằng Zalo “Trợ lý An Lành” (hướng dẫn: thư mục zalo-bot/README.md).</p>' : !live && c.on ? '<p class="small">Kiểm tra máy đang chạy trợ lý: bật máy, có mạng. Nếu Telegram báo “bị đăng xuất” thì cần quét lại mã QR.</p>' : '') +
      (!j.aiOn ? '<p class="small">⚠️ Máy chủ chưa có khoá AI nên trợ lý chưa trả lời, chưa soạn bài được.</p>' : '') + (!j.key ? '<p class="small">⚠️ Máy chủ chưa có mã ZBOT_KEY nên chương trình trợ lý chưa kết nối được.</p>' : '') +
      (st && st.groups && st.groups.length ? '<p class="small">Nhóm đang chăm sóc: ' + st.groups.filter(function (x) { return c.groups.indexOf(x.id) >= 0; }).map(function (x) { return '<b>' + esc(x.name) + '</b> (' + x.total + ' người' + (x.admin ? '' : ', ⚠️ trợ lý chưa là phó nhóm nên chưa tự duyệt được') + ')'; }).join(', ') + (c.groups.length ? '' : '⚠️ chưa chọn nhóm nào (chọn ở Cài đặt)') + '</p>' : '') + '</div>';
    // 7 ngày qua
    h += '<h2 class="zb-h">7 ngày qua</h2><div class="metrics dash-m3">' + metric('👋 Chào người mới', g('welcome'), 'Mỗi lần chào có thể gồm nhiều người vào cùng lúc.', '') +
      metric('💬 Trả lời trong nhóm', g('answer') + g('handoff'), g('react') ? 'Thả tim ' + g('react') + ' lần cho chia sẻ của thành viên.' : 'Chỉ trả lời câu hỏi chưa ai trong đội ngũ trả lời.', '') +
      metric('📩 Trả lời tin riêng', g('dm') + g('dm_handoff'), 'Khách kết bạn, nhắn riêng cho trợ lý.', '') +
      metric('🙋 Cần người thật', g('handoff') + g('dm_handoff'), 'Đã báo Telegram để nhân sự nhắn khách.', '') +
      metric('📝 Bài đã đăng', g('post') + g('send'), '🎉 Chúc mừng nhận quà: ' + g('announce') + ' lần.', '') +
      metric('✅ Khách web đã vào nhóm', (j.users && j.users.joined7) || 0, 'Tìm được Zalo của ' + ((j.users && j.users.known) || 0) + ' khách để lại số trên web.', '') + '</div>';
    // bài đăng
    var auto = c.mode === 'auto', days = [], P = {};
    (j.posts || []).forEach(function (p) { P[p.id] = p; if (days.indexOf(p.day) < 0) days.push(p.day); });
    var key = function (t) { var x = new Date(t + 7 * 3600e3); return x.getUTCFullYear() + pad(x.getUTCMonth() + 1) + pad(x.getUTCDate()); };
    [key(j.now), key(j.now + DAY)].forEach(function (d) { if (days.indexOf(d) < 0) days.push(d); }); days.sort();
    h += '<h2 class="zb-h">📝 Bài đăng nhóm</h2><p class="muted small">AI soạn trước theo lịch chủ đề trong tuần, dùng đúng thông tin sản phẩm trên web. ' + (auto ? '<b>Chế độ tự đăng</b>: tới giờ trợ lý tự đăng bài nháp. Thấy bài chưa ổn thì sửa ngay trong ô, hoặc bấm <b>⏸ Bỏ bài này</b>.' : '<b>Chế độ chờ duyệt</b>: chỉ bài đã bấm <b>✅ Duyệt</b> mới được đăng.') + '</p>';
    days.forEach(function (d) {
      (c.slots || []).forEach(function (sl) {
        var p = P[d + '_' + sl.id]; if (!p && !sl.on) return;
        var lbl = zbDay(d) + ' · ' + (sl.id === 'toi' ? '🌙 Bài tối' : '☀️ Bài sáng') + ' ' + sl.at;
        if (!p) { if (new Date(d.slice(0, 4) + '-' + d.slice(4, 6) + '-' + d.slice(6, 8) + 'T' + (sl.at || '00:00') + ':00+07:00').getTime() < j.now) return; h += '<div class="box zb-post zb-none"><p><b>' + lbl + '</b> · <span class="muted">⏳ chưa soạn – AI soạn trước giờ đăng</span></p><button class="btn sm" data-zb="regen|' + d + '_' + sl.id + '">✍️ Soạn ngay</button></div>'; return; }
        var badge = p.status === 'sent' ? '📤 Đã đăng ' + fDateTime(p.sent_at) : p.status === 'skip' ? '⏸ Đã bỏ, không đăng' : p.status === 'ok' ? '✅ Đã duyệt, sẽ đăng lúc ' + sl.at : auto ? '✍️ Nháp, sẽ tự đăng lúc ' + sl.at : '⏳ Chờ duyệt';
        var done = p.status === 'sent';
        h += '<div class="box zb-post zb-' + p.status + '"><div class="zb-ph"><b>' + lbl + '</b><span class="zb-badge">' + badge + '</span></div>' +
          '<p class="small"><b>Chủ đề:</b> ' + esc(p.topic) + (p.img ? ' · 🖼 kèm ảnh sản phẩm' : '') + ' <span class="muted">· ' + (p.by_name && p.by_name !== 'AI' ? 'sửa bởi ' + esc(p.by_name) : 'AI soạn') + ' ' + fDateTime(p.at) + '</span></p>' +
          (p.img ? '<img class="zb-img" src="' + esc(p.img) + '" alt="" loading="lazy">' : '') +
          '<textarea class="zb-text" id="zbT_' + p.id + '" rows="' + Math.min(16, Math.max(4, String(p.text).split('\n').length + 1)) + '"' + (done ? ' readonly' : '') + '>' + esc(p.text) + '</textarea>' +
          (done ? '' : '<div class="lq-btns"><button class="btn sm pri" data-zb="save|' + p.id + '">💾 Lưu sửa</button>' + (!auto && p.status !== 'ok' ? '<button class="btn sm" data-zb="ok|' + p.id + '">✅ Duyệt</button>' : '') +
            (p.status === 'skip' ? '<button class="btn sm" data-zb="draft|' + p.id + '">▶️ Đăng lại bài này</button>' : '<button class="btn sm ghost" data-zb="skip|' + p.id + '">⏸ Bỏ bài này</button>') +
            '<button class="btn sm ghost" data-zb="regen|' + p.id + '">🔄 Viết lại</button></div>') + '</div>';
      });
    });
    h += '<p class="bar-legend">Chữ trong <b>**hai dấu sao**</b> sẽ in đậm trên Zalo. Bài nói về sản phẩm có ảnh sẽ kèm ảnh. Không đăng từ 21h45 tới 6h sáng.' + (j.err ? ' Lần soạn lỗi gần nhất: ' + esc(j.err) : '') + '</p>';
    // cài đặt
    var sg = (st && st.groups) || [], ck = function (k, t, sub) { return '<label class="zb-ck"><input type="checkbox" data-zbc="' + k + '"' + (c[k] ? ' checked' : '') + '><span><b>' + t + '</b>' + (sub ? '<small>' + sub + '</small>' : '') + '</span></label>'; };
    h += '<details class="box zb-set"><summary><b>⚙️ Cài đặt trợ lý</b></summary>' +
      ck('on', 'Bật trợ lý', 'Tắt thì trợ lý im lặng hoàn toàn (không chào, không trả lời, không đăng).') +
      '<p class="zb-sub"><b>Nhóm trợ lý chăm sóc</b></p>' + (sg.length ? sg.map(function (x) { return '<label class="zb-ck"><input type="checkbox" data-zbg="' + esc(x.id) + '"' + (c.groups.indexOf(x.id) >= 0 ? ' checked' : '') + '><span><b>' + esc(x.name) + '</b><small>' + x.total + ' người' + (x.admin ? ' · trợ lý là phó nhóm' : ' · ⚠️ trợ lý chưa là phó nhóm') + '</small></span></label>'; }).join('') : '<p class="small muted">Trợ lý chưa chạy hoặc chưa ở nhóm nào. Thêm tài khoản “Trợ lý An Lành” vào nhóm và đặt làm phó nhóm.</p>') +
      '<p class="zb-sub"><b>Việc trợ lý làm</b></p>' + ck('welcome', 'Chào người mới vào nhóm', 'Gọi tên @… , gộp người vào trong 1 phút thành 1 tin.') + ck('answer', 'Trả lời câu hỏi trong nhóm', 'Chờ 1,5 phút; đội ngũ (trưởng / phó nhóm) trả lời trước thì trợ lý thôi. Người gọi tên trợ lý thì trả lời ngay.') +
      ck('announce', 'Chúc mừng thành viên vừa nhận quà trên web', 'Chỉ tên Zalo + tên quà, không số điện thoại, không bệnh.') + ck('approve', 'Tự duyệt người xin vào nhóm đã để số trên web', 'Người lạ: báo Telegram để nhân sự duyệt tay. Cần bật “Duyệt thành viên” trong Zalo.') +
      ck('approveAll', 'Tự duyệt tất cả người xin vào (kể cả chưa để số)', '') +
      '<p class="zb-sub"><b>Bài đăng</b></p><label class="zb-ck"><input type="radio" name="zbMode" value="auto"' + (auto ? ' checked' : '') + '><span><b>Tự đăng</b><small>Tới giờ tự đăng bài nháp (vẫn sửa / bỏ được trước giờ đăng).</small></span></label>' +
      '<label class="zb-ck"><input type="radio" name="zbMode" value="approve"' + (auto ? '' : ' checked') + '><span><b>Chờ duyệt</b><small>Chỉ đăng bài đã bấm Duyệt. AI soạn xong báo Telegram.</small></span></label>' +
      (c.slots || []).map(function (sl) { return '<label class="zb-ck"><input type="checkbox" data-zbs="' + sl.id + '"' + (sl.on ? ' checked' : '') + '><span><b>' + (sl.id === 'toi' ? '🌙 Bài tối' : '☀️ Bài sáng') + '</b> lúc <input type="time" data-zbt="' + sl.id + '" value="' + esc(sl.at) + '" class="zb-time"></span></label>'; }).join('') +
      '<label class="f"><span>Tối đa số câu trả lời / nhóm / giờ</span><input type="number" id="zbMax" min="1" max="30" value="' + (c.maxHour || 8) + '"></label>' +
      '<button class="btn pri" data-zb="cfg">Lưu cài đặt</button></details>';
    // nhật ký
    h += '<h2 class="zb-h">🕘 Trợ lý vừa làm gì</h2>' + ((j.log || []).length ? '<div class="box zb-log">' + j.log.map(function (l) {
      var k = ZB_KIND[l.kind] || ['•', l.kind];
      return '<details><summary><span class="zb-t">' + fDateTime(l.at) + '</span> ' + k[0] + ' <b>' + k[1] + '</b>' + (l.name ? ' · ' + esc(l.name) : '') + (l.text ? ' <span class="muted">· ' + esc(l.text.slice(0, 80)) + '</span>' : '') + '</summary>' +
        (l.text ? '<p class="small"><b>Tin:</b> ' + esc(l.text) + '</p>' : '') + (l.reply ? '<p class="small zb-rep"><b>Trợ lý:</b> ' + esc(l.reply).replace(/\n/g, '<br>') + '</p>' : '') + '</details>';
    }).join('') + '</div>' : '<div class="box"><p class="muted">Chưa có hoạt động.</p></div>');
    return h;
  }
  function zbSendOpen() {
    var gs = ((ZB.d && ZB.d.status && ZB.d.status.groups) || []).filter(function (x) { return ZB.d.cfg.groups.indexOf(x.id) >= 0; });
    if (!gs.length) return toast('Trợ lý chưa chạy hoặc chưa chọn nhóm (xem ⚙️ Cài đặt trợ lý).', true);
    var m = modal('📣 Gửi tin vào nhóm', '<p class="small muted">Trợ lý đăng y nguyên nội dung này vào: ' + gs.map(function (x) { return '<b>' + esc(x.name) + '</b>'; }).join(', ') + '. Chữ trong **hai dấu sao** in đậm.</p>' +
      '<label class="f"><span>Nội dung</span><textarea id="zbSendT" rows="8" maxlength="4000" placeholder="vd: 🌿 Chào cả nhà, tối nay 20h có buổi live…"></textarea></label>' +
      '<label class="f"><span>Hẹn giờ (để trống = gửi ngay)</span><input type="datetime-local" id="zbSendAt"></label>',
      '<button class="btn" data-close>Huỷ</button><button class="btn pri" id="zbSendGo">Gửi</button>');
    draftKeep($('#zbSendT', m), 'zbSend');
    $('#zbSendGo', m).onclick = function () {
      var b = this, t = $('#zbSendT', m).value.trim(), at = $('#zbSendAt', m).value;
      if (t.length < 5) return toast('Bạn chưa nhập nội dung.', true);
      b.disabled = true; api('zb_send', { text: t, at: at }).then(function () { store('zbSend', null); closeModal(); toast(at ? 'Đã hẹn giờ ✓ Trợ lý sẽ đăng đúng giờ.' : 'Đã gửi ✓ Trợ lý đăng trong khoảng 1 phút.'); zbFetch(); }, function (e) { b.disabled = false; toast(e.message, true); });
    };
  }
  document.addEventListener('click', function (e) {
    var t = e.target.closest('[data-zb]'); if (!t) return;
    var v = t.getAttribute('data-zb').split('|'), id = v[1] || '';
    if (v[0] === 'reload') { ZB.err = ''; ZB.d = null; return render(); }
    if (v[0] === 'send') return zbSendOpen();
    var after = function (msg) { return function () { toast(msg); zbFetch(); }; }, fail = function (e) { t.disabled = false; toast(e.message, true); };
    if (v[0] === 'save' || v[0] === 'ok' || v[0] === 'skip' || v[0] === 'draft') {
      var ta = $('#zbT_' + id); t.disabled = true;
      return api('zb_post', { id: id, text: ta ? ta.value : undefined, status: v[0] === 'save' ? undefined : v[0] }).then(after({ save: 'Đã lưu bài ✓', ok: 'Đã duyệt ✓ Tới giờ trợ lý sẽ đăng.', skip: 'Đã bỏ bài này, trợ lý sẽ không đăng.', draft: 'Đã dùng lại bài này ✓' }[v[0]]), fail);
    }
    if (v[0] === 'regen') {
      var hint = prompt('Muốn AI viết lại thế nào? (vd: “nói về hạt óc chó”, “ngắn hơn”, “vui hơn”). Để trống = viết bài khác cùng chủ đề.', ''); if (hint === null) return;
      var p = id.split('_'); t.disabled = true; t.textContent = '⏳ AI đang viết (khoảng 30 giây)…';
      return api('zb_regen', { id: id, day: p[0], slot: p[1], hint: hint }).then(after('AI đã viết lại ✓ Xem và sửa nếu cần.'), fail);
    }
    if (v[0] === 'cfg') {
      var box = t.closest('.zb-set'), cfg = { groups: [], slots: [] };
      $$('[data-zbc]', box).forEach(function (x) { cfg[x.getAttribute('data-zbc')] = x.checked; });
      $$('[data-zbg]', box).forEach(function (x) { if (x.checked) cfg.groups.push(x.getAttribute('data-zbg')); });
      $$('[data-zbs]', box).forEach(function (x) { var sid = x.getAttribute('data-zbs'); cfg.slots.push({ id: sid, on: x.checked, at: $('[data-zbt="' + sid + '"]', box).value }); });
      var md = $('input[name="zbMode"]:checked', box); if (md) cfg.mode = md.value; cfg.maxHour = Number($('#zbMax', box).value) || 8;
      if (!$$('[data-zbg]', box).length) delete cfg.groups;
      t.disabled = true; return api('zb_cfg', { cfg: cfg }).then(after('Đã lưu cài đặt ✓ Trợ lý áp dụng trong khoảng 1 phút.'), fail);
    }
  });
  /* ---------------------------------------------------------------- 📘 Trợ lý Fanpage (api/src/fb.js, 26/10/2026)
   * Khách bình luận → bot thích + trả lời + nhắn riêng → An Lành tư vấn trong Messenger → xin số → gửi quà + link nhóm Zalo, CRM có khách hỏi.
   * AI soạn bài đăng cho từng trang, nhân sự duyệt / sửa. Quản lý, Quản trị, Marketing; kết nối ứng dụng + trang: chỉ Quản trị. Dùng lại giao diện zb-… của Trợ lý Zalo. */
  var FP = { d: null, busy: 0, err: '' };
  var FP_KIND = { comment: ['💬', 'Trả lời bình luận'], dm: ['📩', 'Trả lời tin nhắn'], handoff: ['🙋', 'Cần người thật'], lead: ['🎁', 'Khách để số, đã gửi quà'], gift_ask: ['📱', 'Xin số để gửi quà'],
    nudge: ['🔔', 'Nhắc nhận quà'], post: ['📝', 'Đăng bài'], error: ['⚠️', 'Lỗi'], connect: ['🔗', 'Kết nối trang'] };
  function fpFetch() {
    FP.busy = 1; FP.err = '';
    api('fp_view', {}).then(function (j) { FP.d = j; }, function (e) { FP.err = /Không rõ thao tác/.test(e.message) ? 'Máy chủ đang cập nhật bản mới, thử lại sau 2 phút.' : e.message; })
      .then(function () { FP.busy = 0; if (route().view === 'fanpage') render(); });
  }
  function fpPageOf(id) { return ((FP.d && FP.d.pages) || []).filter(function (p) { return p.id === id; })[0] || { name: '?', cfg: {} }; }
  function viewFp() {
    if (!FP.d && !FP.err && !FP.busy) setTimeout(fpFetch, 0);
    var h = '<div class="page-head"><h1>📘 Trợ lý Fanpage</h1><div class="grow"></div><button class="btn pri" data-fp="send">✍️ Viết bài đăng</button></div>' +
      '<p class="muted small lq-intro">Khách bình luận bài đăng hoặc quảng cáo → trợ lý <b>An Lành</b> thích, trả lời bình luận và nhắn riêng → tư vấn trong Messenger → xin số Zalo → gửi quà + link nhóm Zalo, khách vào tab Khách hỏi. AI soạn bài đăng cho từng trang để bạn duyệt. <a href="/huong-dan/fanpage/" target="_blank" rel="noopener">Xem hướng dẫn</a></p>';
    if (!FP.d) return h + '<div class="box"><p class="muted">' + (FP.err ? '⚠️ ' + esc(FP.err) + ' <button class="link" data-fp="reload">Thử lại</button>' : '⏳ Đang tải…') + '</p></div>';
    var j = FP.d, A = j.app, ps = j.pages || [], n = {}, on = ps.filter(function (p) { return p.active; });
    (j.stats || []).forEach(function (r) { n[r.kind] = r.n; });
    var g = function (k) { return n[k] || 0; }, ready = A.id && A.secret && A.verified && ps.length;
    // kết nối
    h += '<details class="box zb-set"' + (ready ? '' : ' open') + '><summary><b>🔗 Kết nối Facebook</b> · ' + (ready ? '✅ đã kết nối ' + ps.length + ' trang, đang bật ' + on.length : '⏳ chưa xong (làm theo 4 bước)') + '</summary>';
    if (!j.admin) h += '<p class="small muted">Chỉ Quản trị kết nối ứng dụng và fanpage.</p>';
    else h += '<p class="zb-sub"><b>Bước 1.</b> Tạo ứng dụng trên developers.facebook.com (xem hướng dẫn), rồi dán 2 mã vào đây.</p>' +
      '<div class="row2c"><label class="f"><span>App ID</span><input id="fpAppId" inputmode="numeric" value="' + esc(A.id || '') + '" placeholder="vd: 1234567890123456"></label>' +
      '<label class="f"><span>App Secret ' + (A.secret ? '(đã lưu, để trống nếu không đổi)' : '') + '</span><input id="fpSecret" type="password" autocomplete="off" placeholder="' + (A.secret ? '••••••••' : '32 ký tự') + '"></label></div>' +
      '<label class="f"><span>Configuration ID (chỉ cần nếu ứng dụng loại Doanh nghiệp dùng “Facebook Login for Business”)</span><input id="fpConfig" inputmode="numeric" value="' + esc(A.config || '') + '"></label>' +
      '<button class="btn sm pri" data-fp="app">💾 Lưu mã ứng dụng</button>' +
      (A.verify ? '<p class="zb-sub"><b>Bước 2.</b> Trong ứng dụng → Webhooks (đối tượng Page): dán 2 dòng dưới, rồi tích <b>feed</b>, <b>messages</b>, <b>messaging_postbacks</b>, <b>message_echoes</b>.</p>' +
        '<p class="small">Callback URL: <code>' + esc(A.hook) + '</code> <button class="link" data-fp="cp|' + esc(A.hook) + '">Chép</button><br>Verify token: <code>' + esc(A.verify) + '</code> <button class="link" data-fp="cp|' + esc(A.verify) + '">Chép</button><br>' +
        (A.verified ? '✅ Facebook đã xác minh webhook lúc ' + fDateTime(A.verified) : '⏳ Facebook chưa xác minh webhook') + '</p>' +
        '<p class="zb-sub"><b>Bước 3.</b> Trong ứng dụng → Facebook Login → Valid OAuth Redirect URIs: <code>' + esc(A.cb) + '</code> <button class="link" data-fp="cp|' + esc(A.cb) + '">Chép</button></p>' +
        '<p class="zb-sub"><b>Bước 4.</b> Kết nối fanpage (đăng nhập Facebook bằng tài khoản quản trị các trang, tích chọn tất cả trang cần dùng).</p>' +
        '<div class="lq-btns"><button class="btn pri" data-fp="connect">🔗 Kết nối fanpage</button></div>' +
        '<details class="small"><summary>Không đăng nhập được? Dán mã truy cập trang</summary><p class="muted">Lấy ở ứng dụng → Messenger → Cài đặt API → Tạo mã truy cập cho từng trang.</p><label class="f"><input class="zb-text" id="fpPtk" autocomplete="off" placeholder="EAA…"></label><button class="btn sm" data-fp="ptoken">Kết nối bằng mã</button></details>' : '');
    h += '</details>';
    if (!j.aiOn) h += '<div class="box zb-status bad"><p class="small">⚠️ Máy chủ chưa có khoá AI nên trợ lý chỉ trả lời theo câu mẫu, chưa tư vấn và chưa soạn bài được.</p></div>';
    // 7 ngày qua
    h += '<h2 class="zb-h">7 ngày qua</h2><div class="metrics dash-m3">' +
      metric('💬 Bình luận đã xử lý', g('comment'), 'Thích + trả lời công khai + nhắn riêng (mỗi người 1 lần / 24 giờ).', '') +
      metric('📩 Khách nhắn lại', j.talk || 0, 'Số người trò chuyện với trợ lý trong Messenger. Trợ lý trả lời ' + g('dm') + ' tin.', '') +
      metric('🎁 Khách để số', g('lead'), 'Đã gửi quà + link nhóm Zalo, khách vào tab Khách hỏi. Xin số ' + g('gift_ask') + ' lần, nhắc ' + g('nudge') + ' lần.', '') +
      metric('🙋 Cần người thật', g('handoff'), 'Đã báo Telegram để nhân sự trả lời trong hộp thư fanpage.', '') +
      metric('📝 Bài đã đăng', g('post'), g('error') ? '⚠️ ' + g('error') + ' lỗi (xem nhật ký bên dưới).' : 'AI soạn, nhân sự duyệt.', '') + '</div>';
    // từng trang
    h += '<h2 class="zb-h">📄 Fanpage</h2>' + (ps.length ? ps.map(fpPageBox).join('') : '<div class="box"><p class="muted">Chưa kết nối trang nào (xem 🔗 Kết nối Facebook ở trên).</p></div>');
    // bài đăng
    var days = [], P = {}, key = function (t) { var x = new Date(t + 7 * 3600e3); return x.getUTCFullYear() + pad(x.getUTCMonth() + 1) + pad(x.getUTCDate()); };
    (j.posts || []).forEach(function (p) { P[p.id] = p; if (days.indexOf(p.day) < 0) days.push(p.day); });
    var posting = on.filter(function (p) { return p.cfg.post; });
    if (posting.length) [key(j.now), key(j.now + DAY)].forEach(function (d) { if (days.indexOf(d) < 0) days.push(d); });
    days.sort();
    h += '<h2 class="zb-h">📝 Bài đăng fanpage</h2><p class="muted small">AI soạn trước 1 ngày theo lịch chủ đề trong tuần, dùng đúng thông tin sản phẩm trên web, cuối bài mời bình luận “QUÀ” để trợ lý nhắn riêng. Trang ở chế độ <b>Chờ duyệt</b> chỉ đăng bài đã bấm <b>✅ Duyệt</b>.</p>';
    if (!days.length) h += '<div class="box"><p class="muted">Chưa có bài. Bật “AI soạn bài đăng” trong cài đặt từng trang, hoặc bấm ✍️ Viết bài đăng.</p></div>';
    days.forEach(function (d) {
      var list = (j.posts || []).filter(function (p) { return p.day === d; });
      posting.forEach(function (pg) { pg.cfg.slots.forEach(function (sl) { var id = pg.id + '_' + d + '_' + sl.replace(':', ''); if (!P[id] && new Date(d.slice(0, 4) + '-' + d.slice(4, 6) + '-' + d.slice(6, 8) + 'T' + sl + ':00+07:00').getTime() > j.now) list.push({ id: id, page: pg.id, day: d, slot: sl, none: 1 }); }); });
      list.sort(function (a, b) { return a.slot < b.slot ? -1 : a.slot > b.slot ? 1 : fpPageOf(a.page).name < fpPageOf(b.page).name ? -1 : 1; });
      list.forEach(function (p) { h += fpPostBox(p, d); });
    });
    h += '<p class="bar-legend">Facebook không hiện chữ đậm nên bài viết dạng chữ thường + emoji. Bài có link sản phẩm sẽ hiện ảnh xem trước của trang sản phẩm.' + (j.err ? ' Lần soạn lỗi gần nhất: ' + esc(j.err) : '') + '</p>';
    // nhật ký
    h += '<h2 class="zb-h">🕘 Trợ lý vừa làm gì</h2>' + ((j.log || []).length ? '<div class="box zb-log">' + j.log.map(function (l) {
      var k = FP_KIND[l.kind] || ['•', l.kind], pg = l.page ? fpPageOf(l.page).name : '';
      return '<details><summary><span class="zb-t">' + fDateTime(l.at) + '</span> ' + k[0] + ' <b>' + k[1] + '</b>' + (pg ? ' · ' + esc(pg) : '') + (l.name ? ' · ' + esc(l.name) : '') + (l.text ? ' <span class="muted">· ' + esc(l.text.slice(0, 80)) + '</span>' : '') + '</summary>' +
        (l.text ? '<p class="small"><b>Khách:</b> ' + esc(l.text) + '</p>' : '') + (l.reply ? '<p class="small zb-rep"><b>Trợ lý:</b> ' + esc(l.reply).replace(/\n/g, '<br>') + '</p>' : '') + '</details>';
    }).join('') + '</div>' : '<div class="box"><p class="muted">Chưa có hoạt động.</p></div>');
    return h;
  }
  function fpPageBox(p) {
    var c = p.cfg, live = p.last_ev && FP.d.now - p.last_ev < 3 * DAY;
    var ck = function (k, t, sub) { return '<label class="zb-ck"><input type="checkbox" data-fpc="' + k + '"' + (c[k] ? ' checked' : '') + '><span><b>' + t + '</b>' + (sub ? '<small>' + sub + '</small>' : '') + '</span></label>'; };
    var ta = function (k, t, sub, rows) { return '<label class="f"><span>' + t + (sub ? ' <small class="muted">' + sub + '</small>' : '') + '</span><textarea class="zb-text" data-fpt="' + k + '" rows="' + (rows || 3) + '">' + esc(c[k] || '') + '</textarea></label>'; };
    var inp = function (k, t, sub) { return '<label class="f"><span>' + t + (sub ? ' <small class="muted">' + sub + '</small>' : '') + '</span><input class="zb-text" data-fpt="' + k + '" value="' + esc(c[k] || '') + '"></label>'; };
    return '<div class="box zb-status ' + (p.active && !p.err ? 'ok' : 'bad') + '" data-fpbox="' + esc(p.id) + '"><p><b>' + esc(p.name) + '</b> · ' + (p.err ? '⚠️ ' + esc(p.err) : p.active ? '🟢 Trợ lý đang bật' : '⏸ Trợ lý đang tắt') +
      (p.last_ev ? ' · <span class="muted">Facebook gửi sự kiện lần cuối ' + fDateTime(p.last_ev) + '</span>' : ' · <span class="muted">chưa nhận sự kiện nào</span>') + '</p>' +
      (p.active && !live && !p.err ? '<p class="small muted">Chưa thấy bình luận / tin nhắn nào gần đây. Nếu ứng dụng chưa được Facebook duyệt, trợ lý chỉ thấy người có vai trò trong ứng dụng (quản trị, nhà phát triển, người thử).</p>' : '') +
      '<label class="zb-ck"><input type="checkbox" data-fpa' + (p.active ? ' checked' : '') + '><span><b>Bật trợ lý cho trang này</b></span></label>' +
      '<details class="zb-set"><summary><b>⚙️ Cài đặt trang</b></summary>' +
      '<p class="zb-sub"><b>Bình luận</b></p>' + ck('like', 'Thích bình luận', '') + ck('reply', 'Trả lời công khai dưới bình luận', 'Đổi câu mỗi lần để Facebook không coi là spam.') +
      ck('dm', 'Nhắn riêng cho người bình luận', 'Facebook chỉ cho 1 tin / bình luận; mỗi người tối đa 1 lần / 24 giờ.') + ck('hide', 'Ẩn bình luận có số điện thoại', 'Bảo vệ thông tin khách; số vẫn được ghi vào Khách hỏi.') +
      inp('kw', 'Chỉ trả lời bình luận có từ khoá', 'cách nhau dấu phẩy, vd: quà, giá, tư vấn. Để trống = mọi bình luận') +
      '<label class="f"><span>Câu trả lời công khai <small class="muted">mỗi dòng 1 câu, trợ lý chọn ngẫu nhiên; {ten} = tên khách</small></span><textarea class="zb-text" data-fpt="replies" rows="4">' + esc((c.replies || []).join('\n')) + '</textarea></label>' +
      ta('dm_text', 'Lời mời nhận quà trong tin nhắn riêng', 'đặt sau lời chào và câu trả lời của AI', 3) +
      '<p class="zb-sub"><b>Tin nhắn Messenger</b></p>' + ck('ai', 'An Lành tư vấn bằng AI', 'Tắt thì chỉ gửi câu mẫu, nhân sự tự trả lời.') + ck('nudge', 'Nhắc nhận quà 1 lần', 'Khách nhắn rồi im 3 tiếng mà chưa để số (trong 24 giờ, 8h–21h).') +
      ta('gift_msg', 'Tin gửi quà khi khách để số', '{ten} = tên, {link} = link quà, {nhom} = link nhóm Zalo', 6) +
      inp('gift_link', 'Link quà', '') + inp('group', 'Link nhóm Zalo', '') +
      '<p class="zb-sub"><b>Bài đăng</b></p>' + ck('post', 'AI soạn bài đăng cho trang này', '') + ck('cta', 'Cuối bài mời bình luận “QUÀ”', 'Kéo khách bình luận để trợ lý nhắn riêng.') +
      '<label class="zb-ck"><input type="radio" name="fpMode_' + esc(p.id) + '" value="approve"' + (c.mode !== 'auto' ? ' checked' : '') + '><span><b>Chờ duyệt</b><small>Chỉ đăng bài đã bấm Duyệt. AI soạn xong báo Telegram.</small></span></label>' +
      '<label class="zb-ck"><input type="radio" name="fpMode_' + esc(p.id) + '" value="auto"' + (c.mode === 'auto' ? ' checked' : '') + '><span><b>Tự đăng</b><small>Tới giờ tự đăng bài nháp (vẫn sửa / bỏ được trước giờ đăng).</small></span></label>' +
      '<label class="f"><span>Giờ đăng <small class="muted">cách nhau dấu phẩy, tối đa 4 bài / ngày, vd: 11:30, 20:00</small></span><input class="zb-text" data-fpt="slots" value="' + esc((c.slots || []).join(', ')) + '"></label>' +
      ta('voice', 'Trang này dành cho ai, giọng thế nào', 'vd: mẹ bỉm sau sinh, giọng chị em tâm sự; AI viết theo', 2) +
      '<div class="lq-btns"><button class="btn pri" data-fp="page|' + esc(p.id) + '">💾 Lưu cài đặt</button>' +
      (FP.d.admin ? '<button class="btn sm ghost" data-fp="resub|' + esc(p.id) + '">🔄 Kết nối lại</button><button class="btn sm ghost" data-fp="del|' + esc(p.id) + '">🗑 Gỡ trang</button>' : '') + '</div></details></div>';
  }
  function fpPostBox(p, d) {
    var pg = fpPageOf(p.page), lbl = zbDay(d) + ' · ' + p.slot + ' · <b>' + esc(pg.name) + '</b>', auto = pg.cfg.mode === 'auto';
    if (p.none) return '<div class="box zb-post zb-none"><p>' + lbl + ' · <span class="muted">⏳ chưa soạn – AI soạn trước giờ đăng</span></p><button class="btn sm" data-fp="regen|' + esc(p.id) + '">✍️ Soạn ngay</button></div>';
    var done = p.status === 'sent' || p.status === 'sending';
    var badge = p.status === 'sent' ? '📤 Đã đăng ' + fDateTime(p.sent_at) : p.status === 'sending' ? '⏳ Đang đăng' : p.status === 'err' ? '⚠️ Lỗi: ' + esc(p.err) : p.status === 'skip' ? '⏸ Đã bỏ, không đăng' : p.status === 'ok' ? '✅ Đã duyệt, sẽ đăng lúc ' + p.slot : auto ? '✍️ Nháp, sẽ tự đăng lúc ' + p.slot : '⏳ Chờ duyệt';
    return '<div class="box zb-post zb-' + p.status + '"><div class="zb-ph"><span>' + lbl + '</span><span class="zb-badge">' + badge + '</span></div>' +
      '<p class="small"><b>Chủ đề:</b> ' + esc(p.topic) + ' <span class="muted">· ' + (p.by_name && p.by_name !== 'AI' ? 'sửa bởi ' + esc(p.by_name) : 'AI soạn') + ' ' + fDateTime(p.at) + '</span>' + (p.fb_id ? ' · <a href="https://facebook.com/' + esc(p.fb_id) + '" target="_blank" rel="noopener">Xem bài</a>' : '') + '</p>' +
      '<textarea class="zb-text" id="fpT_' + esc(p.id) + '" rows="' + Math.min(16, Math.max(4, String(p.text).split('\n').length + 1)) + '"' + (done ? ' readonly' : '') + '>' + esc(p.text) + '</textarea>' +
      '<label class="f"><span>Link kèm bài <small class="muted">hiện ảnh xem trước; để trống = không kèm link</small></span><input class="zb-text" id="fpL_' + esc(p.id) + '" value="' + esc(p.link || '') + '"' + (done ? ' readonly' : '') + '></label>' +
      (done ? '' : '<div class="lq-btns"><button class="btn sm pri" data-fp="save|' + esc(p.id) + '">💾 Lưu sửa</button>' + (p.status !== 'ok' ? '<button class="btn sm" data-fp="ok|' + esc(p.id) + '">✅ Duyệt</button>' : '') +
        '<button class="btn sm" data-fp="now|' + esc(p.id) + '">📤 Đăng ngay</button>' +
        (p.status === 'skip' ? '<button class="btn sm" data-fp="draft|' + esc(p.id) + '">▶️ Dùng lại bài này</button>' : '<button class="btn sm ghost" data-fp="skip|' + esc(p.id) + '">⏸ Bỏ bài này</button>') +
        '<button class="btn sm ghost" data-fp="regen|' + esc(p.id) + '">🔄 Viết lại</button></div>') + '</div>';
  }
  function fpSendOpen() {
    var ps = ((FP.d && FP.d.pages) || []);
    if (!ps.length) return toast('Chưa kết nối fanpage nào.', true);
    var m = modal('✍️ Viết bài đăng fanpage', '<p class="small muted">Đăng y nguyên nội dung này lên các trang đã chọn. Facebook không hiện chữ đậm.</p>' +
      '<p class="zb-sub"><b>Đăng lên trang</b></p>' + ps.map(function (p) { return '<label class="zb-ck"><input type="checkbox" data-fps="' + esc(p.id) + '"' + (p.active ? ' checked' : '') + '><span><b>' + esc(p.name) + '</b></span></label>'; }).join('') +
      '<label class="f"><span>Nội dung</span><textarea id="fpSendT" rows="8" maxlength="5000" placeholder="vd: 🌿 Sáng nay bạn đã uống đủ nước chưa?…"></textarea></label>' +
      '<label class="f"><span>Link kèm bài (tuỳ chọn)</span><input id="fpSendL" placeholder="https://thucduonglanh.vn/…"></label>' +
      '<label class="f"><span>Hẹn giờ (để trống = đăng ngay)</span><input type="datetime-local" id="fpSendAt"></label>',
      '<button class="btn" data-close>Huỷ</button><button class="btn pri" id="fpSendGo">Đăng</button>');
    draftKeep($('#fpSendT', m), 'fpSend');
    $('#fpSendGo', m).onclick = function () {
      var b = this, t = $('#fpSendT', m).value.trim(), at = $('#fpSendAt', m).value, pg = $$('[data-fps]', m).filter(function (x) { return x.checked; }).map(function (x) { return x.getAttribute('data-fps'); });
      if (t.length < 5) return toast('Bạn chưa nhập nội dung.', true);
      if (!pg.length) return toast('Chọn ít nhất 1 trang.', true);
      b.disabled = true; api('fp_send', { text: t, link: $('#fpSendL', m).value.trim(), at: at, pages: pg }).then(function () { store('fpSend', null); closeModal(); toast(at ? 'Đã hẹn giờ ✓' : 'Đã đăng ✓'); fpFetch(); }, function (e) { b.disabled = false; toast(e.message, true); });
    };
  }
  document.addEventListener('click', function (e) {
    var t = e.target.closest('[data-fp]'); if (!t) return;
    var v = t.getAttribute('data-fp').split('|'), id = v.slice(1).join('|');
    if (v[0] === 'reload') { FP.err = ''; FP.d = null; return render(); }
    if (v[0] === 'send') return fpSendOpen();
    if (v[0] === 'cp') return copy(id).then(function () { toast('Đã chép ✓'); });
    var after = function (msg) { return function () { toast(msg); fpFetch(); }; }, fail = function (e) { t.disabled = false; toast(e.message, true); };
    if (v[0] === 'app') { t.disabled = true; return api('fp_app', { appId: $('#fpAppId').value.trim(), secret: $('#fpSecret').value.trim(), config: $('#fpConfig').value.trim() }).then(after('Đã lưu ✓ Làm tiếp bước 2.'), fail); }
    if (v[0] === 'connect') { t.disabled = true; return api('fp_connect', {}).then(function (j) { t.disabled = false; location.href = j.url; }, fail); }
    if (v[0] === 'ptoken') { t.disabled = true; return api('fp_ptoken', { ptk: $('#fpPtk').value.trim() }).then(function (j) { toast('Đã kết nối ' + j.pages.length + ' trang ✓'); fpFetch(); }, fail); }
    if (v[0] === 'page') {
      var box = t.closest('[data-fpbox]'), cfg = {};
      $$('[data-fpc]', box).forEach(function (x) { cfg[x.getAttribute('data-fpc')] = x.checked; });
      $$('[data-fpt]', box).forEach(function (x) { cfg[x.getAttribute('data-fpt')] = x.value; });
      cfg.replies = cfg.replies.split('\n'); cfg.slots = cfg.slots.split(/[,;\s]+/);
      var md = $('input[name="fpMode_' + id + '"]:checked', box); if (md) cfg.mode = md.value;
      t.disabled = true; return api('fp_page', { id: id, active: $('[data-fpa]', box).checked, cfg: cfg }).then(after('Đã lưu cài đặt trang ✓'), fail);
    }
    if (v[0] === 'resub') { t.disabled = true; return api('fp_resub', { id: id }).then(after('Đã kết nối lại ✓'), fail); }
    if (v[0] === 'del') { if (!confirm('Gỡ trang ' + fpPageOf(id).name + ' khỏi trợ lý? Trợ lý sẽ không trả lời trang này nữa.')) return; t.disabled = true; return api('fp_del', { id: id }).then(after('Đã gỡ trang.'), fail); }
    if (v[0] === 'save' || v[0] === 'ok' || v[0] === 'skip' || v[0] === 'draft') {
      var ta = $('#fpT_' + id), ln = $('#fpL_' + id); t.disabled = true;
      return api('fp_post', { id: id, text: ta ? ta.value : undefined, link: ln ? ln.value : undefined, status: v[0] === 'save' ? undefined : v[0] }).then(after({ save: 'Đã lưu bài ✓', ok: 'Đã duyệt ✓ Tới giờ sẽ đăng.', skip: 'Đã bỏ bài này.', draft: 'Đã dùng lại bài này ✓' }[v[0]]), fail);
    }
    if (v[0] === 'now') {
      if (!confirm('Đăng bài này lên fanpage ngay bây giờ?')) return;
      var ta2 = $('#fpT_' + id), ln2 = $('#fpL_' + id); t.disabled = true;
      return api('fp_post', { id: id, text: ta2 ? ta2.value : undefined, link: ln2 ? ln2.value : undefined }).then(function () { return api('fp_now', { id: id }); }).then(after('Đã đăng lên fanpage ✓'), fail);
    }
    if (v[0] === 'regen') {
      var hint = prompt('Muốn AI viết lại thế nào? (vd: “nói về hạt óc chó”, “ngắn hơn”, “vui hơn”). Để trống = viết bài khác cùng chủ đề.', ''); if (hint === null) return;
      var q = id.split('_'), hm = q[2] || ''; t.disabled = true; t.textContent = '⏳ AI đang viết (khoảng 30 giây)…';
      return api('fp_regen', { id: id, page: q[0], day: q[1], slot: hm.slice(0, 2) + ':' + hm.slice(2, 4), hint: hint }).then(after('AI đã viết xong ✓ Xem và sửa nếu cần.'), fail);
    }
  });
  /** 💎 Giá trị 1 khách mới (90 ngày đầu) → nên chi tối đa bao nhiêu để có 1 khách mới. */
  function mkLtvBlock(mj, cpn) {
    var L = mj.ltv; if (!L || !L.n) return { h: '' };
    var g = (L.by && L.by['Facebook Ads']) || L, A = dashAds(), cap = Math.round(g.avg * A[0] / 100), lv = cpn ? (cpn <= cap ? 'ok' : cpn <= g.avg * A[1] / 100 ? 'mid' : 'bad') : '';
    var h = '<div class="metrics dash-m3">' +
      metric('1 khách mới mua trong 3 tháng đầu', moneyShort(g.avg), 'Gồm đơn đầu + các lần mua lại trong 90 ngày.', '') +
      metric('Đơn đầu tiên', moneyShort(g.first), 'Lần mua lại sau đó mang thêm ' + moneyShort(Math.max(0, g.avg - g.first)) + '.', '') +
      metric('Khách mua lại trong 3 tháng', g.rep + '%', 'Cứ 100 khách mới có ' + g.rep + ' người mua thêm lần nữa.', '') +
      '</div><div class="box mk-ltv ' + lv + '"><p>🎯 <b>Nên chi tối đa ' + moneyShort(cap) + ' để có 1 khách mới</b> (= ' + A[0] + '% của ' + moneyShort(g.avg) + ').</p>' +
      (cpn ? '<p>' + DASH_LV[lv] + ' Kỳ này đang chi <b>' + moneyShort(cpn) + '</b> cho 1 khách mới' + (lv === 'ok' ? ': trong mức cho phép, có thể tăng ngân sách.' : lv === 'mid' ? ': hơi cao, cần tối ưu chiến dịch đắt.' : ': quá cao so với mức cho phép. Giảm chiến dịch đắt, dồn tiền chiến dịch 🟢.') + '</p>' : '') +
      '</div><p class="bar-legend">Tính từ ' + g.n + ' khách mua lần đầu từ ' + L.from.split('-').reverse().join('/') + ' đến ' + L.to.split('-').reverse().join('/') + ' (đã đủ 3 tháng để xem họ mua lại)' + (g !== L ? ', nguồn Facebook Ads' : '') + '. Cập nhật mỗi ngày.</p>';
    return { h: h, lv: lv, cap: cap, line: 'Nên chi tối đa ' + moneyShort(cap) + ' / khách mới' + (cpn ? ' · đang chi ' + moneyShort(cpn) + ' ' + DASH_LV[lv] : '') };
  }
  /** 💰 Ngân sách quảng cáo tháng này: đã chi / ngân sách, vạch "hôm nay", cứ đà này cuối tháng chi bao nhiêu. */
  function mkBudgetCalc(b) {
    if (!b || !b.amt) return null;
    var fc = b.day ? Math.round(b.spent / b.day * b.dim) : 0, left = Math.max(0, b.amt - b.spent), dl = Math.max(1, b.dim - b.day + 1);
    var lv = fc > b.amt * 1.1 ? 'bad' : fc < b.amt * 0.8 ? 'mid' : 'ok';
    return { fc: fc, lv: lv, per: Math.round(left / dl), txt: lv === 'bad' ? 'Đang chi nhanh: cứ đà này cuối tháng hết ' + moneyShort(fc) + ', vượt ' + moneyShort(fc - b.amt) + '. Mỗi ngày còn lại nên chi khoảng ' + moneyShort(Math.round(left / dl)) + '.' : lv === 'mid' ? 'Đang chi chậm: cứ đà này cuối tháng mới chi ' + moneyShort(fc) + '. Nếu chiến dịch 🟢 còn tốt thì tăng thêm, mỗi ngày khoảng ' + moneyShort(Math.round(left / dl)) + '.' : 'Đúng nhịp: cứ đà này cuối tháng chi khoảng ' + moneyShort(fc) + '.' };
  }
  /** Thanh ngân sách gọn (màn hình đầu tab Marketing). Chưa đặt: chỉ Quản trị thấy lời mời đặt. */
  function mkBudgetBlock(b) {
    if (!b) return '';
    var own = lvl() >= 3, C = mkBudgetCalc(b), btn = own ? '<button class="link" data-mkv="budget">✏️ ' + (b.amt ? 'Sửa' : 'Đặt ngân sách') + '</button>' : '';
    if (!C) return own ? '<div class="mk-bud none"><span>💰 Ngân sách ' + monthLabel(b.m) + ': chưa đặt · đã chi ' + moneyShort(b.spent) + '</span>' + btn + '</div>' : '';
    var p = b.spent / b.amt, tp = b.day / b.dim;
    return '<div class="mk-bud ' + C.lv + '"><div class="mk-bud-h"><span>💰 Ngân sách ' + monthLabel(b.m) + ': <b>' + moneyShort(b.spent) + '</b> / ' + moneyShort(b.amt) + ' (' + Math.round(p * 100) + '%)</span>' + btn + '</div>' +
      '<div class="bar"><i style="width:' + Math.min(100, p * 100).toFixed(1) + '%"></i><u style="left:' + (tp * 100).toFixed(1) + '%" title="Hôm nay"></u></div>' +
      '<p class="small">' + DASH_LV[C.lv] + ' ' + C.txt + ' <span class="muted">(vạch dọc = hôm nay, ' + b.day + '/' + b.dim + ' ngày)</span></p></div>';
  }
  function openBudget(b) {
    var body = '<div class="box"><p style="margin:0 0 10px">Ngân sách quảng cáo <b>' + monthLabel(b.m) + '</b> (mọi kênh). Đã chi đến hôm nay: <b>' + money(b.spent) + '</b>.</p>' +
      '<label class="f"><span>Số tiền (gõ số, ví dụ 150000000 hoặc 150tr; để trống = bỏ)</span><input type="text" id="bgAmt" inputmode="decimal" value="' + (b.amt || '') + '" autocomplete="off"></label><p class="hint" id="bgShow"></p><p class="err" id="bgErr"></p></div>';
    var m = modal('💰 Ngân sách quảng cáo', body, '<button class="btn" data-close>Huỷ</button><button class="btn pri" id="bgSave">Lưu</button>');
    var inp = $('#bgAmt', m), show = $('#bgShow', m), upd = function () { var v = moneyIn(inp.value); show.innerHTML = v ? '= <b>' + money(v) + '</b>' : ''; };
    inp.addEventListener('input', upd); upd(); setTimeout(function () { inp.focus(); inp.select(); }, 60);
    $('#bgSave', m).onclick = function () {
      var btn = this; btn.disabled = true; btn.textContent = 'Đang lưu…';
      api('mkt_budget', { month: b.m, amount: moneyIn(inp.value) || 0 }).then(function (j) {
        Object.keys(MV.cache).forEach(function (k) { MV.cache[k].budget = j.budget; }); closeModal(); toast('💰 Đã lưu ngân sách'); render();
      }, function (e) { btn.disabled = false; btn.textContent = 'Lưu'; $('#bgErr', m).textContent = /Không rõ thao tác/.test(e.message) ? 'Máy chủ đang cập nhật bản mới, thử lại sau 2 phút.' : e.message; });
    };
  }
  /** ✅ Nên làm gì: gom lời khuyên quan trọng nhất của mọi khối (tối đa 6 dòng, việc gấp trước). */
  function mkTodo(mj, ch, E, ctx) {
    var L = adsNotes(ch, E).filter(function (t) { return !/^⚠️/.test(t) || !(ctx.gch || []).some(function (k) { return t.indexOf('<b>' + esc(k) + '</b>') >= 0; }); }).map(function (t) { return { p: /^🏆/.test(t) ? 5 : 1, t: t }; }), camps = mj.camps.map(function (r) { return { r: r, sc: mkScore(r, mj) }; }).filter(function (c) { return !c.sc.stop; });
    var nm = function (a) { return a.slice(0, 2).map(function (c) { return '<b>' + esc(c.r[1]) + '</b>'; }).join(', ') + (a.length > 2 ? ' và ' + (a.length - 2) + ' chiến dịch khác' : ''); };
    var bad = camps.filter(function (c) { return c.sc.lv === 'bad'; }), good = camps.filter(function (c) { return c.sc.lv === 'ok'; }), tired = camps.filter(function (c) { return c.sc.tired; });
    if (bad.length) L.push({ p: 2, t: '🔴 Giảm tiền hoặc tắt: ' + nm(bad) + ' (đắt hơn hẳn mức trung bình). <button class="link" data-dgo="mk-camp">Xem</button>' });
    if (good.length) L.push({ p: 3, t: '🟢 Tăng tiền cho: ' + nm(good) + ' (ra tin nhắn rẻ). <button class="link" data-dgo="mk-camp">Xem</button>' });
    if (tired.length) L.push({ p: 4, t: '🎨 Làm hình / video mới cho: ' + nm(tired) + ' (khách bấm ít dần).' });
    if (ctx.weak) L.push({ p: 3, t: '🔍 Khâu yếu nhất: <b>' + ctx.weak.l + '</b>. ' + MK_ADVICE[ctx.weak.k] + ' <button class="link" data-dgo="mk-fun">Xem phễu</button>' });
    var ad = mj.ad; if (ad && ad.idle >= 3) L.push({ p: 2, t: '⏳ <b>' + ad.idle + ' data</b> từ hôm qua trở về trước chưa có kết quả tư vấn. Nhắc sale gọi ngay: data để lâu là khách nguội, phí tiền quảng cáo.' });
    if (ad && ad.n >= 20 && ad.junk * 100 / ad.n >= 15) L.push({ p: 3, t: '🗑 ' + pct(ad.junk, ad.n) + '% data là số rác: xem lại đối tượng / mẫu form quảng cáo.' });
    if (ctx.bud && ctx.bud.lv !== 'ok') L.push({ p: 4, t: '💰 ' + ctx.bud.txt });
    if (ctx.ltv && ctx.ltv.lv === 'bad') L.push({ p: 2, t: '💎 Đang chi quá ' + moneyShort(ctx.ltv.cap) + ' (mức tối đa) để có 1 khách mới. <button class="link" data-dgo="mk-ltv">Xem</button>' });
    var P = (mj.prod || []).filter(function (p) { return p.k && !/^Ebook/.test(p.k) && p.sp >= 1e6; });
    P.filter(function (p) { return adsLv(p.sp, p.rev) === 'bad'; }).slice(0, 1).forEach(function (p) { L.push({ p: 3, t: '🧴 Quảng cáo <b>' + esc(p.k) + '</b> chi phí cao: chi ' + moneyShort(p.sp) + ', khách mới mua ' + moneyShort(p.rev) + '.' }); });
    (ctx.more || []).forEach(function (x) { L.push(x); });
    if (!ch || !Object.keys(ch).length) L.push({ p: 9, t: 'ℹ️ Kỳ này chưa có chi phí quảng cáo. Facebook tự cập nhật' + (mj.fb.on ? '' : ' khi Quản trị kết nối') + '; TikTok, Google, KOL… bấm <b>⚙️ Nhập chi phí</b>.' });
    return L.sort(function (a, b) { return a.p - b.p; }).slice(0, 5).map(function (x) { return x.t; });
  }
  /** Lời khuyên cho marketing theo lý do khách không mua (nhóm ở WHY trong api/src/mktv.js). */
  var MK_WHY = {
    'Chê giá cao': 'làm nội dung nói rõ giá trị (dùng được bao lâu, so với thứ khác), chạy combo / quà tặng / miễn ship.',
    'Chưa tin / sợ không hợp': 'làm video khách thật dùng, giấy chứng nhận, chuyên gia nói; nêu rõ ai dùng hợp, ai không.',
    'Chưa cần / để sau': 'quảng cáo đang tới người chưa có nhu cầu: thu hẹp đối tượng, nhấn vào vấn đề khách đang gặp.',
    'Đã mua / đang dùng nơi khác': 'nói rõ điểm khác biệt so với hàng khác, ưu đãi dùng thử.',
    'Người nhà không đồng ý': 'làm nội dung để khách gửi người nhà xem (video ngắn, bài viết dễ hiểu).',
    'Số rác / sai số': 'xem lại đối tượng và mẫu form: thêm câu hỏi lọc, bỏ đối tượng mở rộng quá rộng.',
    'Không liên lạc được': 'nhắc sale gọi sớm hơn (trong 1–2 giờ), gọi lại nhiều khung giờ; form ghi rõ sẽ có người gọi.',
    'Bom hàng': 'gọi xác nhận trước khi gửi, ưu đãi chuyển khoản trước; xem lại chiến dịch kéo nhiều khách bom.'
  };
  var MK_WAIT = ['Trong ngày', '1–2 ngày sau', '3–7 ngày sau', '8–30 ngày sau', 'Sau 30 ngày'];
  /** 🤝 Phản hồi từ sale: số tổng từ mktv.sale. → { h, line, todo: [{p, t}] } */
  function mkSaleBlock(mj) {
    var sl = mj.sale, ad = mj.ad; if (!sl || !ad || !ad.n) return { h: '', line: '', todo: [] };
    var T = [], h = '', box = function (t, sub, body) { return '<div class="mk-sb"><h3>' + t + (sub ? ' <span class="tip">' + sub + '</span>' : '') + '</h3>' + body + '</div>'; };
    // 1) chất lượng data theo nguồn
    var src = (sl.src || []).filter(function (x) { return x.n >= 3; });
    if (src.length) {
      h += box('📇 Chất lượng data theo nguồn', 'nguồn = cột Nguồn quảng cáo trong file số', '<div class="mk-q">' + src.map(function (x) {
        var w = function (v) { return (v * 100 / x.n).toFixed(1) + '%'; }, rest = x.n - x.won - x.junk - x.lost - x.idle, jr = pct(x.junk, x.n), wr = pct(x.won, x.n);
        var lv = jr >= 20 ? 'bad' : wr >= 25 ? 'ok' : 'mid';
        if (jr >= 20 && x.n >= 10) T.push({ p: 3, t: '🗑 Nguồn <b>' + esc(intLabel(x.k)) + '</b> có ' + jr + '% số rác: xem lại đối tượng / form của nguồn này.' });
        return '<div class="mk-q-r"><div class="mk-q-h"><b>' + DASH_LV[lv] + ' ' + esc(intLabel(x.k)) + '</b><span>' + x.n + ' data · mua ' + wr + '% · rác ' + jr + '%</span></div>' +
          '<div class="mk-stack"><i class="won" style="width:' + w(x.won) + '"></i><i class="talk" style="width:' + w(Math.max(0, rest)) + '"></i><i class="idle" style="width:' + w(x.idle) + '"></i><i class="lost" style="width:' + w(x.lost) + '"></i><i class="junk" style="width:' + w(x.junk) + '"></i></div></div>';
      }).join('') + '</div><p class="bar-legend"><span class="mk-dot won"></span>đã mua <span class="mk-dot talk"></span>đang tư vấn <span class="mk-dot idle"></span>chưa có kết quả <span class="mk-dot lost"></span>không mua <span class="mk-dot junk"></span>số rác. Nguồn tốt = nhiều xanh, ít đỏ.</p>');
    }
    // 2) lý do không mua
    var why = sl.why || {}, wk = Object.keys(why).sort(function (a, b) { return why[b] - why[a]; }), wn = wk.reduce(function (a, k) { return a + why[k]; }, 0), top = wk.filter(function (k) { return MK_WHY[k]; })[0];
    if (wn) {
      h += box('🙅 Vì sao khách không mua', wn + ' khách sale ghi "Không mua"', barList(wk.map(function (k) { return { l: k, v: why[k], txt: why[k] + ' (' + pct(why[k], wn) + '%)', muted: !MK_WHY[k] }; }), String) +
        (top ? '<p class="mk-tip">💡 Nhiều nhất là <b>' + top + '</b> → ' + MK_WHY[top] + '</p>' : '') + (why['Không ghi lý do'] ? '<p class="small muted">' + why['Không ghi lý do'] + ' khách không ghi lý do: nhắc sale ghi lý do để marketing biết đường sửa.</p>' : ''));
      if (top && wn >= 5 && why[top] * 100 / wn >= 25) T.push({ p: 3, t: '🙅 Khách không mua chủ yếu vì <b>' + top.toLowerCase() + '</b> (' + pct(why[top], wn) + '%): ' + MK_WHY[top] });
    }
    // 3) bao lâu thì mua
    var wt = sl.wait || [], wsum = wt.reduce(function (a, b) { return a + b; }, 0);
    if (wsum) {
      var late = wt[2] + wt[3] + wt[4], lp = pct(late, wsum);
      h += box('⏱ Data bao lâu thì mua', wsum + ' data đã mua', barList(wt.map(function (v, i) { return { l: MK_WAIT[i], v: v, txt: v + ' (' + pct(v, wsum) + '%)' }; }), String) +
        '<p class="mk-tip">💡 ' + (lp >= 30 ? lp + '% khách mua sau 3 ngày trở lên → <b>đừng tắt chiến dịch mới chạy chưa đủ 3–7 ngày</b>; chạy quảng cáo nhắc lại cho người đã nhắn tin trong 7 ngày.' : pct(wt[0] + wt[1], wsum) + '% khách mua trong 2 ngày đầu → sau 2–3 ngày chạy là đủ để đánh giá chiến dịch; sale cần gọi thật nhanh.') + '</p>');
      if (lp >= 30 && wsum >= 10) T.push({ p: 5, t: '⏱ ' + lp + '% data mua sau 3 ngày trở lên: chờ đủ 3–7 ngày rồi mới tắt chiến dịch mới.' });
    }
    // 4) hoàn / huỷ
    if (sl.ord) {
      var vr = pct(sl.voidN, sl.ord), vlv = vr <= 5 ? 'ok' : vr <= 10 ? 'mid' : 'bad', chs = Object.keys(sl.ch || {}).filter(function (k) { return sl.ch[k].n >= 5; });
      h += box('↩️ Đơn hoàn / huỷ', '', '<p>' + DASH_LV[vlv] + ' <b>' + sl.voidN + ' / ' + sl.ord + ' đơn</b> của data quảng cáo bị hoàn hoặc huỷ (' + vr + '%' + (sl.voidRev ? ', mất ' + moneyShort(sl.voidRev) : '') + ')' + (sl.ret ? ' · ' + sl.ret + ' hoàn' : '') + (sl.cancel ? ' · ' + sl.cancel + ' huỷ' : '') + '.</p>' +
        (chs.length > 1 ? '<p class="small">' + chs.map(function (k) { return chInfo(k).icon + ' ' + esc(k) + ': ' + pct(sl.ch[k].v, sl.ch[k].n) + '% (' + sl.ch[k].v + '/' + sl.ch[k].n + ' đơn)'; }).join(' · ') + '</p>' : '') +
        '<p class="small muted">Dưới 5% là tốt. Cao thì doanh số bị "ảo": ' + MK_WHY['Bom hàng'] + '</p>');
      if (vlv === 'bad' && sl.ord >= 10) T.push({ p: 2, t: '↩️ ' + vr + '% đơn từ quảng cáo bị hoàn / huỷ (mất ' + moneyShort(sl.voidRev) + '): ' + MK_WHY['Bom hàng'] });
    }
    // 5) hỏi gì – mua gì
    var pr = sl.pairs || [];
    if (pr.length) {
      var cross = pr.filter(function (x) { return x[0] !== x[1] && !/^Chưa rõ/.test(x[0]) && !/^Chưa rõ/.test(x[1]); });
      h += box('🛍 Khách hỏi gì, mua gì', 'đơn đầu tiên của data đã mua', '<div class="mk-pairs">' + pr.map(function (x) { var same = x[0] === x[1]; return '<div class="mk-pair' + (same ? '' : ' x') + '"><span>' + esc(x[0]) + '</span><b>→</b><span>' + esc(x[1]) + '</span><em>' + x[2] + ' người</em></div>'; }).join('') + '</div>' +
        '<p class="small">' + (sl.first ? '🧺 ' + pct(sl.combo, sl.first) + '% khách mua từ 2 sản phẩm trở lên · đơn đầu trung bình <b>' + moneyShort(Math.round(sl.firstRev / sl.first)) + '</b>.' : '') + '</p>' +
        (cross.length ? '<p class="mk-tip">💡 Có khách hỏi <b>' + esc(cross[0][0]) + '</b> nhưng mua <b>' + esc(cross[0][1]) + '</b>: thử quảng cáo ' + esc(cross[0][1]) + ' cho cùng nhóm khách, hoặc làm combo 2 sản phẩm này.</p>' : ''));
      if (cross.length && cross[0][2] >= 3) T.push({ p: 6, t: '🛍 Khách hỏi <b>' + esc(cross[0][0]) + '</b> nhưng mua <b>' + esc(cross[0][1]) + '</b> (' + cross[0][2] + ' người): thử combo / quảng cáo thêm sản phẩm này.' });
    }
    // 6) sale xử lý data
    var ss = sl.sales || [];
    if (ss.length) {
      var rt = ss.map(function (x) { return pct(x.won, x.n); }), mx = Math.max.apply(null, rt), mn = Math.min.apply(null, rt), avg = pct(ss.reduce(function (a, x) { return a + x.won; }, 0), ss.reduce(function (a, x) { return a + x.n; }, 0));
      var named = ss[0].k, gap = mx - mn;
      h += box('🧑‍💼 Sale xử lý data', 'mỗi sale từ 5 data trở lên', (named ? barList(ss.map(function (x) { return { l: x.k, v: pct(x.won, x.n), txt: pct(x.won, x.n) + '% mua · ' + x.n + ' data' + (x.idle ? ' · ' + x.idle + ' chưa gọi' : '') }; }), String)
        : '<p>Tỷ lệ data ra đơn giữa các sale: cao nhất <b>' + mx + '%</b>, thấp nhất <b>' + mn + '%</b>, trung bình <b>' + avg + '%</b>.</p>') +
        '<p class="mk-tip">💡 ' + (ss.length > 1 && gap >= 15 ? 'Chênh nhau ' + gap + ' điểm: cùng loại data mà kết quả khác xa → cần kèm cách tư vấn cho bạn thấp, chưa nên kết luận do quảng cáo.' : 'Các sale ra đơn khá đều → nếu tỷ lệ chung thấp thì xem lại chất lượng data (mục 📇 ở trên).') + '</p>' +
        (sl.unassigned ? '<p class="small muted">' + sl.unassigned + ' data chưa chia cho sale.</p>' : ''));
      if (ss.length > 1 && gap >= 15) T.push({ p: 4, t: '🧑‍💼 Tỷ lệ chốt giữa các sale chênh ' + gap + ' điểm (' + mn + '% → ' + mx + '%): vấn đề nằm ở khâu tư vấn nhiều hơn quảng cáo.' });
    }
    var line = ['Data ra đơn ' + pct(ad.won, ad.n) + '%', top ? 'không mua nhiều nhất vì ' + top.toLowerCase() : '', sl.ord ? 'hoàn / huỷ ' + pct(sl.voidN, sl.ord) + '%' : ''].filter(Boolean).join(' · ');
    return { h: h + '<p class="bar-legend">Tính từ data trong file số quảng cáo của kỳ này và kết quả sale ghi (khách hỏi, đơn hàng). Chỉ có con số tổng, không có thông tin khách.</p>', line: line, todo: T };
  }
  /** Mục thu gọn của tab Marketing: tiêu đề + 1 dòng tóm tắt, bấm mới mở. Nhớ mục đang mở (mkt_open). */
  /** ✍️ Người ký lời cam kết "Tôi chọn sống lành" trên thucduonglanh.vn/cam-ket-song-lanh/ (api/src/journey.js): chỉ có số đếm theo nguồn / tỉnh, không có tên hay SĐT. */
  function mkPledgeBlock(pl) {
    if (!pl || (!pl.n && !pl.prev)) return null;
    var rows = function (L, empty) { return L.slice(0, 10).map(function (r) { return { l: r[0] || empty, v: r[1], muted: !r[0] }; }); };
    var cnt = function (v) { return v + ' người'; }, top = pl.src[0];
    return {
      line: pl.n + ' người chọn' + (top ? ' · nhiều nhất từ ' + esc(top[0] || 'Truy cập trực tiếp') : ''),
      h: '<div class="metrics dash-m3">' + metric('Người chọn trong kỳ', pl.n, 'Số người bấm "Tôi chọn sống lành" trên website (thucduonglanh.vn/toi-chon-song-lanh/).', delta(pl.n, pl.prev)) + '</div>' +
        '<div class="dash-grid"><div class="box"><h3>Đến từ đâu</h3>' + barList(rows(pl.src, 'Truy cập trực tiếp'), cnt) + '</div>' +
        '<div class="box"><h3>Tỉnh / thành</h3>' + barList(rows(pl.prov, 'Không chọn tỉnh'), cnt) + '</div></div>' + mkWallRows(pl.names) +
        '<p class="bar-legend">Nguồn = nguồn / kênh / chiến dịch của lần vào web gần nhất (link UTM, mã QR ở 📍 Link &amp; QR, link sale). "cam_ket / chia_se" = người được bạn bè mời qua nút Chia sẻ / Mời người thân. Muốn biết bài đăng, sự kiện nào mang nhiều người ký: gắn link UTM hoặc mã QR riêng cho từng nơi. Website không lưu tên đầy đủ hay số điện thoại: chỉ lưu tên đã che của người tự bấm nút "…và hiện tên".</p>'
    };
  }
  /** 🧱 Bức tường Sống Lành (thucduonglanh.vn/buc-tuong-song-lanh/, 23/10/2026): 40 tên đã che mới nhất, bấm Ẩn nếu tên không phù hợp (api wall_hide). Web cập nhật sau tối đa 2 phút. */
  function mkWallRows(L) {
    if (!L || !L.length) return '';
    var d2 = function (t) { var d = new Date(t); return ('0' + d.getDate()).slice(-2) + '/' + ('0' + (d.getMonth() + 1)).slice(-2); };
    return '<div class="box mk-wl"><h3>🧱 Tên mới trên Bức tường Sống Lành</h3><p class="bar-legend">Tên đã che bớt, do khách tự bấm nút “Tôi chọn sống lành và hiện tên trên Bức tường”. Thấy tên không phù hợp (tục, quảng cáo, giả mạo) thì bấm <b>Ẩn</b>; khách nhắn xin gỡ tên cũng bấm Ẩn. <a href="https://thucduonglanh.vn/buc-tuong-song-lanh/" target="_blank" rel="noopener">Mở Bức tường ↗</a></p><ul>' +
      L.map(function (r) { return '<li' + (r.hide ? ' class="off"' : '') + '><span><b>' + esc(r.pub) + '</b> · ' + esc(r.province || 'Không chọn tỉnh') + (r.no ? ' · số ' + Number(r.no).toLocaleString('vi-VN') : '') + ' · ' + d2(r.time) + '</span><button type="button" class="btn sm ghost" data-wlh="' + r.id + '" data-on="' + (r.hide ? 0 : 1) + '">' + (r.hide ? 'Hiện lại' : 'Ẩn') + '</button></li>'; }).join('') + '</ul></div>';
  }
  document.addEventListener('click', function (e) {
    var b = e.target.closest && e.target.closest('[data-wlh]'); if (!b) return;
    var hide = b.getAttribute('data-on') === '1';
    b.disabled = true;
    api('wall_hide', { id: +b.getAttribute('data-wlh'), hide: hide ? 1 : 0 }).then(function () {
      b.disabled = false; b.setAttribute('data-on', hide ? 0 : 1); b.textContent = hide ? 'Hiện lại' : 'Ẩn'; b.closest('li').classList.toggle('off', hide);
      toast(hide ? 'Đã ẩn tên khỏi Bức tường ✓' : 'Đã hiện lại tên ✓');
    }, function (er) { b.disabled = false; toast(er.message, true); });
  });
  /** 🖐 Trò chơi "Bạn còn mấy ngón tay?" trên thucduonglanh.vn/ngon-tay-song-lanh/ (api/src/journey.js quizStats): số lượt chơi, điểm trung bình (thang 10), thói quen khách hay "hạ ngón" nhất. Không có tên hay SĐT. */
  function mkQuizBlock(qz) {
    if (!qz || (!qz.n && !qz.prev)) return null;
    var cnt = function (v) { return v + ' lượt'; }, pc = function (v) { return Math.round(v * 100 / (qz.n || 1)) + '% người chơi'; };
    var top = qz.miss[0], T = ['🏆 9–10 ngón', '🌿 7–8 ngón', '📩 4–6 ngón', '🚨 0–3 ngón'];
    return {
      line: qz.n + ' lượt chơi · trung bình ' + String(qz.avg).replace('.', ',') + '/10 ngón' + (top ? ' · hay hạ ngón nhất: ' + esc(top[0]) : ''),
      h: '<div class="metrics dash-m3">' + metric('Lượt chơi trong kỳ', qz.n, 'Số lượt chơi xong 10 câu trên website.', delta(qz.n, qz.prev)) +
        metric('Điểm trung bình', String(qz.avg).replace('.', ',') + ' <small>/10 ngón</small>', qz.prevAvg != null ? 'Kỳ trước: ' + String(qz.prevAvg).replace('.', ',') + '/10.' : 'Càng cao = khách có lối sống càng lành.', '') + '</div>' +
        '<div class="dash-grid"><div class="box"><h3>Thói quen khách hay "hạ ngón" nhất</h3>' + barList(qz.miss.slice(0, 10).map(function (r) { return { l: r[0], v: r[1] }; }), pc) + '</div>' +
        '<div class="box"><h3>Kết quả</h3>' + barList(qz.tiers.map(function (v, i) { return { l: T[i], v: v }; }), cnt) + '<h3 style="margin-top:16px">Đến từ đâu</h3>' + barList(qz.src.slice(0, 8).map(function (r) { return { l: r[0] || 'Truy cập trực tiếp', v: r[1], muted: !r[0] }; }), cnt) + '</div></div>' +
        '<p class="bar-legend">Thói quen hạ ngón nhiều nhất = điều khách đang thấy khó nhất: nên viết bài, làm video, chạy quảng cáo đúng chỗ đó. "ngon_tay / chia_se" = người được bạn bè rủ chơi qua nút Khoe kết quả / Thách bạn bè. Website không lưu tên hay số điện thoại người chơi.</p>'
    };
  }
  function mkMore(k, title, line, body) {
    if (!body) return '';
    var o = S.f.m.open || {};
    return '<details class="dash-more" data-mk="' + k + '" id="mk-' + k + '"' + (o[k] ? ' open' : '') + '><summary><b>' + title + '</b><span>' + line + '</span></summary><div class="dash-more-b">' + body + '</div></details>';
  }
  /* ---------- 🎯 Mục tiêu marketing từng kênh (kv mkt_goals, Quản trị đặt): tiền khách mới mục tiêu + chi phí tối đa % + người phụ trách.
   * Luôn tính cho THÁNG NÀY (đến hôm nay), dùng số mktv của kỳ "Tháng này" (mvMonthKey) dù đang xem kỳ khác. */
  function mvMonthKey() { var p = { k: 'month' }; return gaKey(perRange(p), cmpRange(p)) + '_' + (S.f.m.sfb ? 1 : 0); }
  /** Giống sameWho ở api/src/mktv.js: "Lan" = "Lan MKT". */
  function sameWho(a, b) { a = norm(a); b = norm(b); return !!a && !!b && (a === b || a.indexOf(b) >= 0 || b.indexOf(a) >= 0); }
  function mkGoalCh() { return MKT_CH.filter(function (c) { return c.k !== 'Khác'; }); }
  /** → { h, todo } */
  var MK_COMM = 'Cộng đồng Zalo';
  /** 🏆 Bảng thi đua marketing: gộp kênh theo người phụ trách, xếp theo % mục tiêu đạt; vượt mức chi phí thì không đứng hạng 1 (giống mktRank ở api/src/mktv.js). */
  function mkBoard(G, revOf, sp, month, people, web) {
    var P = {}, team = { rev: 0, tgt: 0, sp: 0, cap: 0 };
    Object.keys(G).forEach(function (k) {
      var g = G[k]; if (k.charAt(0) === '_' || !g || !g.rev) return;
      var who = String(g.who || '').trim() || 'Chưa giao', key = norm(who), o = P[key] || (P[key] = { who: who, ch: [], rev: 0, tgt: 0, sp: 0, cap: 0 }), r = revOf(k) || 0, s0 = sp[k] || 0;
      o.ch.push(k); o.rev += r; o.tgt += g.rev; o.sp += s0; o.cap += g.rev * (g.pct || 100) / 100; team.rev += r; team.tgt += g.rev; team.sp += s0; team.cap += g.rev * (g.pct || 100) / 100;
    });
    var fix = function (o) { o.C = goalCalc(o.rev, o.tgt, month); o.p = o.C.p; o.maxPct = o.tgt ? Math.round(o.cap * 100 / o.tgt) : 0; o.cp = o.rev ? o.sp * 100 / o.rev : null; o.bad = o.sp > 0 && (o.cp === null || o.cp > o.maxPct); return o; };
    var rows = Object.keys(P).map(function (k) { return fix(P[k]); }).sort(function (a, b) { return b.p - a.p; });
    var gi = -1; rows.some(function (o, i) { if (!o.bad) { gi = i; return true; } return false; }); if (gi > 0 && rows[0].bad) rows.unshift(rows.splice(gi, 1)[0]);
    fix(team);
    var MED = ['🥇', '🥈', '🥉'], ST = { done: '🎉 Đã đạt', ok: '🟢 Đúng tiến độ', mid: '🟠 Hơi chậm', bad: '🔴 Đang chậm' }, T = [];
    var bar = function (C) { return '<div class="bar"><i style="width:' + Math.min(100, C.p * 100).toFixed(1) + '%"></i>' + (C.isCur ? '<u style="left:' + (C.tp * 100).toFixed(1) + '%" title="Hôm nay"></u>' : '') + '</div>'; };
    var cost = function (o) { return o.sp ? (o.bad ? '🔴' : '🟢') + ' chi phí ' + (o.cp !== null ? Math.round(o.cp) + '%' : moneyShort(o.sp) + ' chưa ra tiền') + ' (mức ' + o.maxPct + '%)' : 'chưa có chi phí'; };
    if (!rows.length) return { h: '', todo: [] };
    var h = '<div class="mk-team ' + team.C.lv + '"><div class="mk-team-h"><b>🏢 Cả đội Marketing</b><span>' + (ST[team.C.lv] || '') + '</span></div><div class="goal-num"><b>' + moneyShort(team.rev) + '</b> / ' + moneyShort(team.tgt) + '<span>' + Math.round(team.p * 100) + '%</span></div>' + bar(team.C) +
      '<p class="small">' + cost(team) + (team.C.isCur && team.p < 1 ? ' · mỗi ngày cả đội cần ' + moneyShort(team.C.perDay) : '') + ' · tháng đã qua ' + Math.round(team.C.tp * 100) + '%</p></div>';
    if (web && web.share !== null) {
      var wt = G._web || 0, wl = wt ? (web.share >= wt ? 'ok' : web.share >= wt * 0.8 ? 'mid' : 'bad') : '', wsum = web.newRev + web.oldRev + web.fb;
      h += '<div class="mk-team mk-web ' + wl + '"><div class="mk-team-h"><b>🌐 Tiền qua website</b><span>' + (wl ? DASH_LV[wl] + ' mục tiêu ' + wt + '%' : 'chưa đặt mục tiêu') + '</span></div><div class="goal-num"><b>' + oneDec(web.share) + '%</b>' + (wt ? ' / ' + wt + '%' : '') + ' <small>tổng doanh số</small></div>' +
        (wt ? '<div class="bar"><i style="width:' + Math.min(100, web.share * 100 / wt).toFixed(1) + '%"></i></div>' : '') +
        (wsum ? '<div class="mk-stack mk-web-st"><i class="won" style="width:' + (web.newRev * 100 / wsum).toFixed(1) + '%"></i><i class="talk" style="width:' + (web.oldRev * 100 / wsum).toFixed(1) + '%"></i><i class="idle" style="width:' + (web.fb * 100 / wsum).toFixed(1) + '%"></i></div>' +
          '<p class="small"><span class="mk-dot won"></span>khách mới ' + pct(web.newRev, wsum) + '% (' + moneyShort(web.newRev) + ') <span class="mk-dot talk"></span>khách cũ ' + pct(web.oldRev, wsum) + '% (' + moneyShort(web.oldRev) + ')' + (web.fb ? ' <span class="mk-dot idle"></span>từ quảng cáo Facebook ' + pct(web.fb, wsum) + '%' : '') + '</p>' : '<p class="small muted">Chưa có đơn web trong tháng.</p>') + '</div>';
      if (wt && web.share < wt) T.push({ p: 2, t: '🌐 Tiền qua website mới ' + oneDec(web.share) + '% (mục tiêu ' + wt + '%): gắn link web (tạo ở /admin/utm) vào mọi bài đăng, KOC, nhóm Zalo; bỏ thẻ "đặt web lần sau giảm giá" vào đơn sàn.' });
    }
    h += '<div class="mk-board">' + rows.map(function (o, i) {
      var me = isMkt() && sameWho(o.who, S.user.name);
      if (me && o.C.isCur && o.C.lv === 'bad') T.push({ p: 0, t: '🏆 Bạn đang hạng ' + (i + 1) + '/' + rows.length + ', đạt ' + Math.round(o.p * 100) + '% mục tiêu (tháng đã qua ' + Math.round(o.C.tp * 100) + '%): mỗi ngày cần ' + moneyShort(o.C.perDay) + '.' });
      return '<div class="mk-br ' + o.C.lv + (me ? ' me' : '') + '"><span class="mk-br-rk">' + (MED[i] || (i + 1)) + '</span><div class="mk-br-m"><div class="mk-br-h"><b>' + esc(o.who) + '</b>' + (me ? '<span class="tag new">Bạn</span>' : '') +
        '<span class="mk-br-ch">' + o.ch.map(function (k) { return chInfo(k).icon + ' ' + esc(k); }).join(' · ') + '</span><span class="mk-br-p">' + Math.round(o.p * 100) + '%</span></div>' + bar(o.C) +
        '<p class="small">' + moneyShort(o.rev) + ' / ' + moneyShort(o.tgt) + ' · ' + (ST[o.C.lv] || '') + ' · ' + cost(o) + '</p></div></div>';
    }).join('') + '</div>';
    var none = (people || []).filter(function (n) { return !rows.some(function (o) { return sameWho(o.who, n); }); });
    if (none.length) h += '<p class="small muted">Chưa có mục tiêu: ' + none.map(esc).join(', ') + (lvl() >= 3 ? ' (bấm ✏️ Sửa mục tiêu, ghi tên bạn ấy ở ô Người phụ trách của 1 kênh)' : '') + '.</p>';
    h += '<p class="bar-legend">Xếp theo % mục tiêu đạt (kênh lớn, kênh nhỏ đều công bằng). Vạch đen = hôm nay: thanh vượt vạch là nhanh hơn tiến độ. Vượt mức chi phí (🔴) thì không đứng hạng 1. Mục tiêu từng kênh xem ở mục 🎯 bên dưới.</p>';
    return { h: h, todo: T };
  }
  function mkGoalBlock(gm, live) {
    var own = lvl() >= 3 || isMkt(), month = live && live.budget ? live.budget.m : monthOf(Date.now()), G = live && live.goals ? live.goals[month] : null;
    var btn = own ? '<button class="btn sm" data-mkv="goal">' + (isMkt() ? '🎯 Đặt mục tiêu của tôi' : '✏️ ' + (G ? 'Sửa' : 'Đặt') + ' mục tiêu') + '</button>' : '';
    var head = '<section class="section mk-goals"><div class="section-h"><h2>🏆 Thi đua Marketing ' + monthLabel(month) + '</h2><span class="tip">xếp theo % mục tiêu đạt</span><div class="grow"></div>' + btn + '</div>';
    var keys = G ? Object.keys(G).filter(function (k) { return k.charAt(0) !== '_' && G[k] && (G[k].rev || G[k].pct); }).sort(function (a, b) { return (G[b].rev || 0) - (G[a].rev || 0); }) : [];
    if (!keys.length) return { gch: [], h: own ? head + '<div class="box"><p class="muted">' + (isMkt() ? 'Chưa có mục tiêu tháng này. Bấm <b>🎯 Đặt mục tiêu của tôi</b> để tự đặt mục tiêu tiền khách mới và mức chi phí tối đa cho kênh bạn phụ trách, rồi theo dõi tiến độ mỗi ngày.' : 'Chưa đặt mục tiêu marketing tháng này. Bấm <b>✏️ Đặt mục tiêu</b>: mỗi kênh 1 mục tiêu tiền khách mới + mức chi phí tối đa. Bạn marketing cũng tự đặt được cho kênh mình phụ trách.') + '</p></div></section>' : '', todo: [] };
    if (!gm) return { gch: [], h: head + '<div class="box"><p class="muted">' + (MV.err ? '⚠️ ' + esc(MV.err) : '⏳ Đang tính tiến độ mục tiêu…') + '</p></div></section>', todo: [] };
    var sp = {}; gm.days.forEach(function (r) { sp[r[1]] = (sp[r[1]] || 0) + r[2]; });
    var revOf = function (k) { return (gm.revAll && gm.revAll[k] !== undefined) ? gm.revAll[k] : (gm.eff && gm.eff[k] ? gm.eff[k].newRev : 0); };
    var T = [], sumR = 0, sumT = 0, cards = keys.map(function (k) {
      var w = k === MK_COMM ? 'tiền mua lại' : k === 'Website' ? 'tiền đơn web' : chInfo(k).san ? 'doanh số sàn' : 'tiền khách mới', g = G[k], c = chInfo(k), rev = revOf(k), s = sp[k] || 0, C = goalCalc(rev, g.rev || 0, month), cp = rev ? s * 100 / rev : null;
      if (g.rev) { sumR += rev; sumT += g.rev; }
      var clv = g.pct && s ? (cp === null ? 'bad' : cp <= g.pct ? 'ok' : cp <= g.pct * 1.15 ? 'mid' : 'bad') : '';
      var lv = C.lv === 'none' ? (clv || 'none') : C.lv, label = { done: '🎉 Đã đạt!', ok: '🟢 Đúng tiến độ', mid: '🟠 Hơi chậm', bad: '🔴 Đang chậm', none: '' }[C.lv] || '';
      var L = [];
      if (g.rev && C.isCur && C.p < 1) L.push('Còn thiếu <b>' + moneyShort(C.remain) + '</b> trong ' + C.left + ' ngày → mỗi ngày cần <b>' + moneyShort(C.perDay) + '</b> ' + w + '.');
      if (g.rev && C.isCur && C.p < 1 && C.el >= 3) L.push('Giữ nhịp này cả tháng đạt khoảng ' + moneyShort(C.fc) + ' (' + pct(C.fc, g.rev) + '%).');
      if (g.rev && C.p >= 1) L.push('Vượt mục tiêu ' + moneyShort(rev - g.rev) + '. Tuyệt vời!');
      if (g.pct) L.push((clv ? DASH_LV[clv] + ' ' : '') + 'Chi phí ' + moneyShort(s) + (cp !== null ? ' = <b>' + Math.round(cp) + '%</b> ' + w : s ? ' mà chưa có ' + w : '') + ' (mục tiêu dưới ' + g.pct + '%).');
      if (g.pct && g.rev) L.push('<span class="muted">Đạt mục tiêu thì được chi tối đa ' + moneyShort(Math.round(g.rev * g.pct / 100)) + ' cả tháng · đã chi ' + pct(s, g.rev * g.pct / 100) + '%.</span>');
      if (g.rev && C.isCur && C.lv === 'bad') T.push({ p: 1, t: '🎯 <b>' + esc(k) + '</b> mới đạt ' + Math.round(C.p * 100) + '% mục tiêu (tháng đã qua ' + Math.round(C.tp * 100) + '%): mỗi ngày cần ' + moneyShort(C.perDay) + ' ' + w + '.' });
      if (clv === 'bad') T.push({ p: 1, t: '💸 <b>' + esc(k) + '</b>: chi phí ' + (cp !== null ? 'bằng ' + Math.round(cp) + '%' : moneyShort(s) + ' chưa ra') + ' ' + w + ', vượt mức ' + g.pct + '%. Giảm chiến dịch 🔴, dồn tiền chiến dịch 🟢.' });
      return '<div class="goal mk-goal ' + lv + '"><div class="goal-h"><b>' + c.icon + ' ' + esc(k) + '</b>' + (g.who ? '<span class="tag owner">' + esc(g.who) + '</span>' : '') + '<span class="goal-st">' + label + '</span></div>' +
        (g.rev ? '<div class="goal-num"><b>' + moneyShort(rev) + '</b> / ' + moneyShort(g.rev) + '<span>' + Math.round(C.p * 100) + '%</span></div><div class="bar"><i style="width:' + Math.min(100, C.p * 100).toFixed(1) + '%"></i>' + (C.isCur ? '<u style="left:' + (C.tp * 100).toFixed(1) + '%" title="Hôm nay"></u>' : '') + '</div>' : '<div class="goal-num"><b>' + moneyShort(rev) + '</b> tiền khách mới</div>') +
        L.map(function (x) { return '<p>' + x + '</p>'; }).join('') + '</div>';
    });
    var BD = mkBoard(G, revOf, sp, month, live.people || [], gm.web);
    return { todo: T.concat(BD.todo), gch: keys.filter(function (k) { return G[k].pct; }), h: head + BD.h + '</section>', line: keys.map(function (k) { return chInfo(k).icon + ' ' + esc(k) + ' ' + (G[k].rev ? pct(revOf(k), G[k].rev) + '%' : moneyShort(revOf(k))); }).join(' · '),
      body: '<div class="mk-goal-g">' + cards.join('') + '</div><p class="bar-legend">Vạch đen = hôm nay. Thanh xanh vượt vạch đen là đang nhanh hơn tiến độ. Tiền khách mới = tiền khách mua lần đầu do kênh mang về (sàn: doanh số sàn; 👥 Cộng đồng Zalo: tiền mua lại của khách đã vào nhóm). Chi phí = chi phí của kênh đó trong tháng.</p>' };
  }
  function openMkGoal(live, month) {
    var m0 = live.budget.m, m1 = Object.keys(live.goals || {}).filter(function (k) { return /^\d{4}-\d\d$/.test(k) && k !== m0; })[0];
    month = month || m0;
    var G = (live.goals && live.goals[month]) || {}, prev = live.goals && live.goals.prev, staff = (S.d.users || []).filter(function (u) { return u.active !== false && (u.role === 'Marketing' || u.role === 'Quản trị'); }).map(function (u) { return u.name; });
    var adm = lvl() >= 3, me = S.user.name, mineOf = function (k) { var g = G[k]; return adm || !g || !(g.rev || g.pct) || !g.who || sameWho(g.who, me); };
    var row = function (c) { var g = G[c.k] || {}, ok = mineOf(c.k), dis = ok ? '' : ' disabled';
      return '<div class="mk-gr' + (ok ? '' : ' lock') + '" data-ch="' + esc(c.k) + '"><b>' + c.icon + ' ' + esc(c.k) + (!ok ? '<small>🔒 ' + esc(g.who) + ' phụ trách</small>' : '') + '</b>' +
      '<label class="f"><span>' + (c.k === MK_COMM ? 'Tiền mua lại mục tiêu' : c.k === 'Website' ? 'Tiền đơn web mục tiêu (khách mới + cũ)' : c.san ? 'Doanh số sàn mục tiêu' : 'Tiền khách mới mục tiêu') + '</span><input type="text" inputmode="decimal" data-g="rev" value="' + (g.rev || '') + '" placeholder="vd 450tr"' + dis + '></label>' +
      '<label class="f"><span>Chi phí tối đa (%)</span><input type="number" min="0" max="100" step="1" data-g="pct" value="' + (g.pct || '') + '" placeholder="vd 30"' + dis + '></label>' +
      (adm ? '<label class="f"><span>Người phụ trách</span><input type="text" data-g="who" list="mkWho" value="' + esc(g.who || '') + '" placeholder="tên bạn marketing"></label>' : '<div class="f mk-gr-who"><span>Người phụ trách</span><b>' + (g.who ? esc(g.who) : ok ? '<span class="muted">Bạn, khi đặt mục tiêu</span>' : '') + '</b></div>') +
      '<small class="mk-gr-hint"></small>' + (g.by ? '<small class="mk-gr-by">' + esc(g.by) + ' sửa' + (g.at ? ' ' + fDateTime(g.at) : '') + '</small>' : '') + '</div>'; };
    var MAIN = ['Facebook', 'Website', 'Shopee', 'TikTok Shop', MK_COMM], chs = mkGoalCh(); if (!adm) chs = chs.filter(function (c) { return G[c.k] && G[c.k].who && sameWho(G[c.k].who, me); }).concat(chs.filter(function (c) { return !(G[c.k] && G[c.k].who && sameWho(G[c.k].who, me)); }));
    var body = '<div class="chips">' + [m0, m1].filter(Boolean).map(function (m) { return '<button class="chip' + (m === month ? ' on' : '') + '" data-gm="' + m + '">' + monthLabel(m) + '</button>'; }).join('') + (prev ? '<button class="chip" id="mgPrev">↺ Lấy theo tháng trước</button>' : '') + '</div>' +
      (adm ? '' : '<p class="notice info">Bạn tự đặt mục tiêu cho <b>kênh mình phụ trách</b> hoặc kênh chưa ai nhận (đặt xong kênh đó ghi tên bạn). Kênh của người khác chỉ xem.</p>') + '<p class="small muted">Kênh nào không chạy thì để trống. Tiền khách mới = tiền khách mua lần đầu do kênh mang về (Shopee, TikTok Shop: doanh số sàn). Chi phí tối đa: chi phí quảng cáo ÷ tiền khách mới, vượt mức này thì đèn đỏ.</p>' +
      '<datalist id="mkWho">' + staff.map(function (n) { return '<option value="' + esc(n) + '">'; }).join('') + '</datalist>' +
      (adm ? '<div class="mk-gr mk-gr-web"><b>🌐 Mục tiêu chung cả đội</b><label class="f"><span>% tiền qua website</span><input type="number" min="0" max="100" step="1" id="mgWeb" value="' + (G._web || '') + '" placeholder="vd 25"></label><small class="mk-gr-hint">Tiền khách đặt trên web ÷ toàn bộ doanh số (sale + web + sàn). Cả 4 bạn cùng góp: kéo khách về web thay vì sàn.</small></div>' : '') +
      '<div class="mk-grs">' + chs.filter(function (c) { return MAIN.indexOf(c.k) >= 0; }).map(row).join('') + '</div>' +
      '<details class="mk-gr-more"' + (chs.some(function (c) { return MAIN.indexOf(c.k) < 0 && G[c.k] && (G[c.k].rev || G[c.k].pct); }) ? ' open' : '') + '><summary>Kênh khác (TikTok, Google, Zalo Ads, KOL / KOC, Lazada) – thường không cần đặt</summary><div class="mk-grs">' + chs.filter(function (c) { return MAIN.indexOf(c.k) < 0; }).map(row).join('') + '</div></details>' +
      '<div><p class="err" id="mgErr"></p>' + (G._by ? '<p class="small muted">Lần sửa gần nhất: ' + esc(G._by) + (G._at ? ', ' + fDateTime(G._at) : '') + '</p>' : '');
    var m = modal('🎯 ' + (adm ? 'Mục tiêu marketing ' : 'Mục tiêu của tôi ') + monthLabel(month), body, '<button class="btn" data-close>Huỷ</button><button class="btn pri" id="mgSave">Lưu mục tiêu</button>');
    var hint = function (r) { var v = moneyIn($('[data-g=rev]', r).value), p = Number($('[data-g=pct]', r).value) || 0; $('.mk-gr-hint', r).innerHTML = v ? '= ' + money(v) + (p ? ' · được chi tối đa <b>' + moneyShort(Math.round(v * p / 100)) + '</b> cả tháng' : '') : ''; };
    $$('.mk-gr[data-ch]', m).forEach(function (r) { $$('input', r).forEach(function (i) { i.addEventListener('input', function () { hint(r); }); }); hint(r); });
    $$('[data-gm]', m).forEach(function (b) { b.onclick = function () { openMkGoal(live, b.getAttribute('data-gm')); }; });
    if ($('#mgPrev', m)) $('#mgPrev', m).onclick = function () { $$('.mk-gr[data-ch]:not(.lock)', m).forEach(function (r) { var g = prev[r.getAttribute('data-ch')] || {}; $('[data-g=rev]', r).value = g.rev || ''; $('[data-g=pct]', r).value = g.pct || ''; if ($('[data-g=who]', r)) $('[data-g=who]', r).value = g.who || ''; hint(r); }); };
    $('#mgSave', m).onclick = function () {
      var goals = {}, btn = this; $$('.mk-gr[data-ch]', m).forEach(function (r) { var v = moneyIn($('[data-g=rev]', r).value), p = Number($('[data-g=pct]', r).value) || 0; if (v || p) goals[r.getAttribute('data-ch')] = { rev: v, pct: p, who: $('[data-g=who]', r) ? $('[data-g=who]', r).value.trim() : '' }; });
      btn.disabled = true; btn.textContent = 'Đang lưu…';
      var wv = $('#mgWeb', m); api('mkt_goal', wv ? { month: month, goals: goals, web: Number(wv.value) || 0 } : { month: month, goals: goals }).then(function (j) {
        Object.keys(MV.cache).forEach(function (k) { MV.cache[k].goals = j.goals; MV.cache[k].budget = j.budget; }); closeModal(); toast(j.changes && !j.changes.length ? 'Không có gì thay đổi' : '🎯 Đã lưu mục tiêu'); render();
      }, function (e) { btn.disabled = false; btn.textContent = 'Lưu mục tiêu'; $('#mgErr', m).textContent = /Không rõ thao tác/.test(e.message) ? 'Máy chủ đang cập nhật bản mới, thử lại sau 2 phút.' : e.message; });
    };
  }
  /* ---------- 👥 tệp khách cho Facebook (Đối tượng tuỳ chỉnh): chỉ Quản trị; chỉ khách đồng ý nhận ưu đãi, bỏ khách lạnh */
  var FBAUD_G = [['all', 'Tất cả khách đã mua'], ['live', '🟢 Đang dùng'], ['risk', '🟠 Sắp mất'], ['lost', '⚪ Lâu không mua'], ['vip', '⭐ VIP']];
  function fbAudList(g) {
    return (S.d.customers || []).filter(function (c) { return c.orders > 0 && c.consent && !coldOf(c) && (g === 'all' || (g === 'vip' ? isVip(c) : stageOf(c) === g)); });
  }
  function openFbAud() {
    var g = 'all', cnt = {}; FBAUD_G.forEach(function (x) { cnt[x[0]] = fbAudList(x[0]).length; });
    var m = modal('👥 Tệp khách cho Facebook',
      '<p style="margin:0 0 8px">Tải file số điện thoại khách cũ lên Facebook (Trình quản lý quảng cáo → Đối tượng → Tạo đối tượng → Đối tượng tuỳ chỉnh → Danh sách khách hàng) để:</p>' +
      '<p class="small muted" style="margin:0 0 12px">• Quảng cáo nhắc khách cũ mua lại<br>• Loại khách cũ ra khỏi quảng cáo tìm khách mới<br>• Làm nguồn cho Đối tượng tương tự (tìm người giống khách đang mua)</p>' +
      '<div class="chips wrap">' + FBAUD_G.map(function (x) { return '<button type="button" class="chip' + (x[0] === g ? ' on' : '') + '" data-fag="' + x[0] + '">' + x[1] + ' <em>' + cnt[x[0]] + '</em></button>'; }).join('') + '</div>' +
      '<p class="small muted" style="margin:10px 0 0">Chỉ lấy khách <b>đồng ý nhận tin ưu đãi</b>, đã bỏ khách lạnh (bom hàng, không dùng nữa). Khách gộp nhiều số thì lấy cả số phụ. Facebook mã hoá số ngay trên máy trước khi tải lên.</p>' +
      '<p class="small muted" style="margin:6px 0 0">⚠️ File có số điện thoại khách: tải lên Facebook xong thì xoá khỏi máy, không gửi qua Zalo / email.</p>',
      '<button class="btn" data-close>Đóng</button><button class="btn pri" id="faDl"></button>');
    var dl = $('#faDl', m), upd = function () { dl.textContent = '⬇️ Tải file (' + cnt[g] + ' khách)'; dl.disabled = !cnt[g]; };
    $$('[data-fag]', m).forEach(function (b) { b.onclick = function () { g = b.getAttribute('data-fag'); $$('[data-fag]', m).forEach(function (x) { x.classList.toggle('on', x === b); }); upd(); }; });
    upd();
    dl.onclick = function () {
      var seen = {}, rows = [];
      fbAudList(g).forEach(function (c) { [c.phone].concat(altPhones(c.note)).forEach(function (p) { p = normPhone(p); if (!/^0\d{9}$/.test(p) || seen[p]) return; seen[p] = 1; rows.push('84' + p.slice(1) + ',VN'); }); });
      var a = document.createElement('a'); a.href = URL.createObjectURL(new Blob(['phone,country\n' + rows.join('\n') + '\n'], { type: 'text/csv;charset=utf-8' }));
      a.download = 'facebook-khach-' + g + '-' + isoDate(Date.now()) + '.csv'; document.body.appendChild(a); a.click(); setTimeout(function () { URL.revokeObjectURL(a.href); a.remove(); }, 1000);
      toast('⬇️ Đã tải ' + rows.length + ' số');
    };
  }
  /** 🗺 Ảnh hệ thống Marketing (bản Canva): nút ở đầu tab Marketing; Quản trị đổi link ở Cài đặt → Kết nối & báo cáo. */
  function mktDoc() { return (S.d && S.d.rules && S.d.rules.mktDoc) || {}; }
  function mktDocBtn() { var u = mktDoc().url; return u ? '<a class="btn ghost" href="' + esc(u) + '" target="_blank" rel="noopener" title="Sơ đồ hệ thống marketing của công ty (Canva)">🗺 Hệ thống Marketing</a>' : ''; }
  function viewMkt() {
    var f = S.f.m || (S.f.m = {}); if (!f.p || f.p.k === 'all') f.p = { k: 'month' }; if (f.sfb === undefined) f.sfb = store('dash_sfb') === '1'; // mặc định TẮT (16/10/2026): đơn chưa rõ nguồn không tự tính cho Facebook
    if (!f.open) { try { f.open = JSON.parse(store('mkt_open') || '{}'); } catch (e) { f.open = {}; } }
    var gKey = mvMonthKey(), R = perRange(f.p), key = mvKey(), mj = MV.cache[key], gm = MV.cache[gKey];
    if (gKey !== key && !gm && !MV.err) setTimeout(function () { mvFetch(gKey); }, 0);
    if (!mj && !MV.err) setTimeout(function () { mvFetch(key); }, 0);
    var h = '<div class="page-head"><h1>📣 Marketing</h1><div class="grow"></div>' + '<a class="btn ghost" href="#link-qr" title="Tạo link, mã QR cho tờ rơi, standee, quảng cáo và xem hiệu quả">📍 Link &amp; QR</a>' + mktDocBtn() + (lvl() >= 3 ? '<button class="btn ghost" data-mkv="aud" title="File số điện thoại khách cũ để tải lên Facebook">👥 Tệp khách FB</button>' : '') + (mkvOnly() ? '<span class="tag" title="Bạn được xem số marketing, không nhập chi phí hay đặt mục tiêu">👁 Chỉ xem</span>' : '<button class="btn" data-mkv="cost">⚙️ Nhập chi phí</button>') + '<button class="btn ghost" data-mkv="fresh" title="Tính lại số mới nhất">↻</button></div>' + perChips('m', f.p);
    if (!mj) return h + '<div class="box"><p class="muted">' + (MV.err ? '⚠️ ' + esc(MV.err) + ' <button class="link" data-mkv="fresh">Thử lại</button>' : '⏳ Đang tính hiệu quả quảng cáo…') + '</p></div>';
    MK.fbOn = mj.fb.on;
    var ch = {}, chp = {}, tot = 0, totp = 0, day = {}, A = dashAds(), per = function (n, v) { return n && v ? moneyShort(Math.round(v / n)) : '–'; };
    mj.days.forEach(function (r) { if (chInfo(r[1]).ret) return; ch[r[1]] = (ch[r[1]] || 0) + r[2]; tot += r[2]; day[r[0]] = (day[r[0]] || 0) + r[2]; }); // 👥 cộng đồng: không phải quảng cáo tìm khách mới
    mj.prev.forEach(function (r) { if (chInfo(r[0]).ret) return; chp[r[0]] = r[1]; totp += r[1]; });
    var E = mj.eff, Ep = mj.effPrev, nrOf = function (E0, sp) { var v = 0; Object.keys(E0).forEach(function (k) { if (!E0[k].san || sp[k]) v += E0[k].newRev; }); return v; };
    var nr = nrOf(E, ch), nrp = nrOf(Ep, chp), newN = 0, newNp = 0, nVoid = 0; Object.keys(E).forEach(function (k) { newN += E[k].newN; if (!E[k].san || ch[k]) nVoid += E[k].newVoid || 0; }); Object.keys(Ep).forEach(function (k) { newNp += Ep[k].newN; });
    var rate = tot && nr ? tot * 100 / nr : null, ad = mj.ad, adp = mj.adPrev;
    // ---- màn hình đầu: 2 hàng ô số (Tiền · Data & khách) + thi đua + ngân sách + Nên làm gì
    var cpd = ad && ad.n && tot ? Math.round(tot / ad.n) : 0, cpdP = adp && adp.n && totp ? Math.round(totp / adp.n) : 0, cpn = newN && tot ? Math.round(tot / newN) : 0, LT = mkLtvBlock(mj, cpn);
    var up = function (c, p0) { return !c || !p0 ? '' : c <= p0 * 1.05 ? 'ok' : c <= p0 * 1.2 ? 'mid' : 'bad'; }; // chi phí / đơn vị: tăng là xấu
    var wr = ad && ad.n ? pct(ad.won, ad.n) : null;
    var KB = trendBuckets(R), kSp = trendDays(KB, day), kNr = trendDays(KB, mj.newDay), kNn = mj.newNDay ? trendDays(KB, mj.newNDay) : null, kAd = ad && ad.dd ? ad.dd : null;
    var kAn = kAd ? trendDays(KB, kAd, function (r) { return r[1][0]; }) : null, ksk = function (v, bad) { return v ? sparkSvg(v, KB.partial, bad) : ''; };
    h += '<section class="dash-hero mk-hero"><p class="mk-row-l">💵 Tiền</p><div class="dash-tiles mk3">' +
      dashTile('ch', '', '💸 Tiền bỏ ra quảng cáo', moneyShort(tot), inv(delta(tot, totp)), Object.keys(ch).sort(function (x, y) { return ch[y] - ch[x]; }).slice(0, 3).map(function (k) { return chInfo(k).icon + ' ' + esc(k) + ' ' + moneyShort(ch[k]); }).join(' · ') || 'Chưa có chi phí trong kỳ', ksk(kSp, 'n')) +
      dashTile('ch', dashTrend(nr, nrp), '💰 Doanh số khách mới', moneyShort(nr), delta(nr, nrp), newN + ' khách mới từ quảng cáo · tính cả đơn hoàn / huỷ' + (nVoid ? ' (' + moneyShort(nVoid) + ', phần của sale)' : ''), ksk(kNr)) +
      dashTile('camp', tot ? adsLv(tot, nr) : '', '🚦 Chi phí / tiền khách mới', rate === null ? '–' : oneDec(rate) + '%', rate !== null && totp && nrp ? inv(dRate(rate, totp * 100 / nrp)) : '', 'Xanh dưới ' + A[0] + '% · đỏ trên ' + A[1] + '%' + (rate !== null ? ' · bỏ 1đ thu ' + oneDec(nr / tot) + 'đ' : ''), ksk(trendRateNZ(kSp, kNr, 100), true)) +
      '</div><p class="mk-row-l">📇 Data &amp; khách</p><div class="dash-tiles mk3">' +
      dashTile('data', kpGoal().sdt && cpd ? kpLv(cpd, kpGoal().sdt, 0, 0) : up(cpd, cpdP), '📇 Chi phí 1 data', cpd ? moneyShort(cpd) : '–', cpd && cpdP ? inv(delta(cpd, cpdP)) : '', ad ? ad.n.toLocaleString('vi-VN') + ' data (số khách để lại)' + (kpGoal().sdt ? ' · tốt: dưới ' + moneyShort(kpGoal().sdt) : '') + (adp && adp.n ? ' · ' + CMP_LABEL + ' ' + moneyShort(cpdP) + ' / data' : '') : 'Chưa có file số quảng cáo', ksk(trendRateNZ(kSp, kAn), true)) +
      dashTile('sale', wr === null ? '' : wr >= 25 ? 'ok' : wr >= 15 ? 'mid' : 'bad', '🛒 Data → mua hàng', wr === null ? '–' : wr + '%', ad ? delta(wr, adp && adp.n ? pct(adp.won, adp.n) : null, 'rate') : '', ad ? 'Cứ 100 data có ' + wr + ' người mua · ' + ad.won + ' / ' + ad.n + ' · tốt: từ 25%' : 'Chưa có file số quảng cáo') +
      dashTile('ltv', LT.cap && cpn ? LT.lv : up(cpn, newNp && totp ? Math.round(totp / newNp) : 0), '👤 Chi phí có 1 khách mới', cpn ? moneyShort(cpn) : '–', cpn && newNp && totp ? inv(delta(cpn, Math.round(totp / newNp))) : '', LT.cap ? 'Nên dưới ' + moneyShort(LT.cap) + ' (= ' + A[0] + '% tiền 1 khách mua trong 3 tháng)' : newN + ' khách mới', ksk(trendRateNZ(kSp, kNn), true)) +
      '</div></section>';
    var GB = mkGoalBlock(gKey === key ? mj : gm, mj); h += GB.h;
    h += mkBudgetBlock(mj.budget);
    var FN = mkFunnel(mj, nr, newN), BC = mkBudgetCalc(mj.budget), SB = mkSaleBlock(mj), CB = mkCampBlock(mj, f), PB = mkProdBlock(mj);
    if (!KP.j || Date.now() - KP.at > 10 * 60e3) setTimeout(kpFetch, 0);
    var KI = mkKpiBlock(f), kmore = KI.bad && f.kd !== 'y' ? [{ p: 2, t: '📊 <b>' + KI.bad + ' chiến dịch</b> hôm nay có chỉ số kém hơn bình thường (đèn 🔴): xem giá thầu, hình / video. <button class="link" data-dgo="mk-kpi">Xem</button>' }] : [];
    var L = mkTodo(mj, ch, E, { weak: FN.weak, ltv: LT, bud: BC, more: GB.todo.concat(SB.todo, kmore), gch: GB.gch });
    if (L.length) h += '<div class="box dash-notes"><h3>✅ Nên làm gì</h3>' + L.map(function (x) { return '<p>' + x + '</p>'; }).join('') + '</div>';
    h += offerAdmin();
    // ---- chi tiết: thu gọn, bấm mới mở (xếp theo mức quan trọng)
    h += '<h2 class="mk-more-h">Xem chi tiết <span class="tip">bấm vào từng mục để mở</span></h2>';
    h += mkMore('kpi', '📊 Chỉ số chiến dịch hôm nay: giá 1 SĐT, CPM, CTR, CPC, tin nhắn', KI.line, KI.h);
    if (GB.body) h += mkMore('goal', '🎯 Mục tiêu từng kênh', GB.line, GB.body);
    var wb = mj.web, wbp = mj.webPrev;
    if (wb && wb.share !== null) {
      var wsum = wb.newRev + wb.oldRev + wb.fb, wsp = wbp ? wbp.newRev + wbp.oldRev + wbp.fb : null;
      h += mkMore('web', '🌐 Website: khách mới & khách cũ', oneDec(wb.share) + '% tổng doanh số · khách mới ' + pct(wb.newRev, wsum) + '% · khách cũ ' + pct(wb.oldRev, wsum) + '%', '<div class="metrics dash-m3">' +
        metric('Tiền đơn web', moneyShort(wsum), (wb.newN + wb.oldN) + ' khách đặt trên web.', delta(wsum, wsp)) +
        metric('% tiền qua website', oneDec(wb.share) + '%', 'Tiền đơn web ÷ toàn bộ doanh số (sale + web + sàn). Càng cao càng đỡ phí sàn.', wbp && wbp.share !== null ? dRate(wb.share, wbp.share) : '') +
        metric('🆕 Khách mới đặt web', moneyShort(wb.newRev) + ' <small>(' + pct(wb.newRev, wsum) + '%)</small>', wb.newN + ' khách mua lần đầu trên web' + (wb.newN ? ' · trung bình ' + moneyShort(Math.round(wb.newRev / wb.newN)) : '') + '.', delta(wb.newRev, wbp ? wbp.newRev : null)) +
        metric('🔁 Khách cũ đặt lại trên web', moneyShort(wb.oldRev) + ' <small>(' + pct(wb.oldRev, wsum) + '%)</small>', wb.oldN + ' khách từng mua trước đó nay đặt trên web.', delta(wb.oldRev, wbp ? wbp.oldRev : null)) +
        (wb.fb ? metric('📘 Khách mới từ quảng cáo Facebook', moneyShort(wb.fb) + ' <small>(' + pct(wb.fb, wsum) + '%)</small>', 'Đặt trên web nhưng đến từ quảng cáo Facebook → tính cho kênh Facebook, không tính vào mục tiêu Website.', '') : '') +
        '</div><p class="bar-legend">Mục tiêu Website = tiền khách mới + khách cũ đặt trên web (không gồm phần quảng cáo Facebook). Khách cũ = đã từng mua trước kỳ này. Muốn tăng khách cũ đặt web: gửi link web trong nhóm Zalo, tin nhắn CSKH, thẻ trong đơn sàn.</p>');
    }
    var cm = mj.comm, cmp = mj.commPrev, csp = 0; mj.days.forEach(function (r) { if (r[1] === MK_COMM) csp += r[2]; });
    if (cm && (cm.rev || csp)) h += mkMore('comm', '👥 Cộng đồng Zalo', moneyShort(cm.rev) + ' tiền mua lại · ' + cm.buyers + ' khách', '<div class="metrics dash-m3">' +
      metric('Tiền mua lại', moneyShort(cm.rev), 'Đơn mua lại (không tính đơn đầu) của khách đã vào nhóm Zalo cộng đồng.', delta(cm.rev, cmp ? cmp.rev : null)) +
      metric('Khách trong nhóm đã mua lại', cm.buyers, cm.n + ' đơn' + (cm.buyers ? ' · trung bình ' + moneyShort(Math.round(cm.rev / cm.buyers)) + ' / khách' : '') + '.', delta(cm.buyers, cmp ? cmp.buyers : null)) +
      metric('Chi phí cộng đồng', csp ? moneyShort(csp) : '–', csp && cm.rev ? 'Bằng ' + Math.round(csp * 100 / cm.rev) + '% tiền mua lại. Quà tặng, minigame… nhập ở ⚙️ Nhập chi phí → kênh Cộng đồng Zalo.' : 'Quà tặng, minigame… nhập ở ⚙️ Nhập chi phí → kênh Cộng đồng Zalo.', '') +
      '</div><p class="bar-legend">Khách được tính là trong nhóm khi sale / CSKH bấm "Đã vào" ở ô Cộng đồng trên hồ sơ khách. Đánh dấu đủ thì số này mới đúng.</p>');
    var PL = mkPledgeBlock(mj.pledge); if (PL) h += mkMore('pledge', '🌱 Tôi chọn sống lành (website)', PL.line, PL.h);
    var QZ = mkQuizBlock(mj.quiz) || { line: 'Chưa có lượt chơi trong kỳ', h: '' }; h += mkMore('quiz', '🖐 Trò chơi Bạn còn mấy ngón tay (website)', QZ.line, QZ.h + qzeBox());
    h += mkMore('camp', '🎬 Chiến dịch: nên tăng, giữ hay tắt?', CB.line, CB.h);
    h += mkMore('sale', '🤝 Phản hồi từ sale', SB.line, SB.h);
    h += mkMore('fun', '🪜 Quảng cáo đi tới đâu thì rơi rụng?', FN.weak ? '🔴 Khâu yếu nhất: ' + FN.weak.l : 'Từ lúc khách thấy quảng cáo đến lúc trả tiền', FN.h);
    h += mkMore('prod', '🧴 Quảng cáo từng sản phẩm', PB.line, PB.h);
    var bestCh = Object.keys(ch).filter(function (k) { return ch[k] > 0 && E[k] && E[k].newRev; }).sort(function (x, y) { return ch[x] / E[x].newRev - ch[y] / E[y].newRev; });
    h += mkMore('ch', '🎯 Hiệu quả từng kênh', bestCh.length ? bestCh.map(function (k) { return chInfo(k).icon + ' ' + esc(k) + ' ' + Math.round(ch[k] * 100 / E[k].newRev) + '%'; }).join(' · ') + ' (chi phí / tiền khách mới)' : 'Chi phí so với tiền khách mới của từng kênh', effBlock(E, Ep, ch, chp, f.sfb, null, 1));
    h += mkMore('ltv', '💎 1 khách mới đáng giá bao nhiêu?', LT.line || '', LT.h);
    if (ad) h += mkMore('data', '📇 Data quảng cáo', ad.n + ' data · ' + per(ad.n, tot) + ' / data · ' + (ad.idle ? '⏳ ' + ad.idle + ' chưa có kết quả tư vấn' : 'rác ' + pct(ad.junk, ad.n) + '%'), '<div class="metrics dash-m3">' +
      metric('Tổng data', ad.n, ad.fresh + ' số mới · ' + ad.old + ' khách cũ · ' + ad.again + ' từng hỏi trước đây.', delta(ad.n, adp ? adp.n : null), '', ksk(kAn)) +
      metric('Chi phí / data', per(ad.n, tot), 'Chi phí quảng cáo ÷ số data.', ad.n && tot && adp && adp.n && totp ? inv(delta(Math.round(tot / ad.n), Math.round(totp / adp.n))) : '', '', ksk(trendRateNZ(kSp, kAn), true)) +
      metric('Data ra đơn', ad.n ? pct(ad.won, ad.n) + '%' : '–', ad.won + ' / ' + ad.n + ' data đã mua' + (ad.won && tot ? ' · mỗi data ra đơn tốn ' + per(ad.won, tot) : '') + '. Data gần đây còn đang tư vấn nên số này tăng dần.', ad.n && adp && adp.n ? delta(pct(ad.won, ad.n), pct(adp.won, adp.n), 'rate') : '') +
      metric('Không mua', ad.lost, 'Khách đã tư vấn nhưng không mua.', '') +
      metric('Số rác', ad.junk, 'Sai số, không liên lạc được, không có nhu cầu thật.', ad.junk && adp ? inv(delta(ad.junk, adp.junk)) : '') +
      metric('Đang tư vấn', Math.max(0, ad.n - ad.won - ad.lost - ad.junk - (ad.idle || 0)), 'Sale đã liên hệ, chưa có kết quả.', '') +
      metric('⏳ Chưa có kết quả tư vấn', ad.idle || 0, 'Data từ hôm qua trở về trước mà sale chưa ghi kết quả gọi. Càng ít càng tốt: data để lâu là khách nguội.', '') + '</div>');
    var BM = trendBuckets(R), dser = function (o) { return trendSum(BM, Object.keys(o || {}).map(function (k) { return [k, o[k]]; }), function (r) { return dayMs(r[0]); }, function (r) { return r[1]; }); };
    if (BM.L.length >= 2) {
      var nv = dser(mj.newDay), sv = dser(day), full = BM.partial ? BM.L.length - 1 : BM.L.length, hf = Math.floor(full / 2), part = function (a, i, j) { return a.slice(i, j).reduce(function (x, y) { return x + y; }, 0); };
      var r1 = part(nv, 0, hf) ? part(sv, 0, hf) * 100 / part(nv, 0, hf) : null, r2 = part(nv, hf, full) ? part(sv, hf, full) * 100 / part(nv, hf, full) : null;
      var eff = r1 !== null && r2 !== null && hf >= 2 ? (Math.abs(r2 - r1) < 3 ? '➡️ Hiệu quả giữ nguyên: chi phí bằng khoảng ' + Math.round(r2) + '% tiền khách mới cả nửa đầu lẫn nửa sau kỳ.' : (r2 < r1 ? '✅ Hiệu quả đang tốt lên' : '⚠️ Hiệu quả đang kém đi') + ': chi phí bằng ' + Math.round(r1) + '% tiền khách mới ở nửa đầu kỳ, ' + Math.round(r2) + '% ở nửa sau.') : '';
      h += mkMore('tr', '📈 Chi phí và tiền khách mới theo ngày', eff ? eff.split(':')[0] : 'Biểu đồ theo ngày', (mj.newDay ? '' : '<p class="small muted">⏳ Máy chủ đang cập nhật, bấm ↻ sau 2 phút để có đường tiền khách mới.</p>') +
        trendChart({ B: BM, fmt: moneyShort, what: 'Tiền khách mới', series: [{ v: nv, name: 'Tiền khách mới mua', cls: 'cur' }, { v: sv, name: 'Chi phí quảng cáo', cls: 'alt' }], note: (eff ? '<b>' + eff + '</b> ' : '') + 'Đường xanh nằm càng cao trên đường vàng là tiền thu về càng nhiều so với tiền quảng cáo.' }));
    }
    h += '<p class="small mk-tgline">📲 Mỗi sáng 8h, Telegram gửi tin <b>📣 Marketing sáng nay</b> (tiến độ mục tiêu, hôm qua, việc nên làm) cho bạn marketing đã kết nối Telegram ở Cài đặt.' + (mkvOnly() ? '' : ' <button class="link" data-mkv="tgtest">Gửi thử cho tôi</button>') + '</p>';
    h += '<p class="small muted" style="margin-top:12px">' + (mj.fb.on ? '📘 Facebook Ads tự cập nhật' + (mj.fb.last ? ' · lần gần nhất ' + fDateTime(mj.fb.last) : '') + ' · ' : '') + 'Số tính lúc ' + fDateTime(mj.at) + (mj.cached ? ' (bấm ↻ để tính lại)' : '') + '. Tiền khách mới = tiền khách mua lần đầu mang về trong kỳ (cả các đơn sau của họ trong kỳ), gắn theo kênh đã đưa khách tới.</p>';
    return h;
  }
  function bindMkv() {
    $$('[data-mkv]').forEach(function (el) { el.onclick = function () { var a = el.getAttribute('data-mkv'); if (a === 'aud') openFbAud(); else if (a === 'cost') openMkt(); else if (a === 'budget') { var bj = MV.cache[mvKey()]; if (bj) openBudget(bj.budget); } else if (a === 'call') { S.f.m.call = 1; render(); } else if (a === 'tgtest') { el.disabled = true; api('mkt_tg_test').then(function () { toast('📲 Đã gửi, mở Telegram để xem'); }, function (e) { toast(/Không rõ thao tác/.test(e.message) ? 'Máy chủ đang cập nhật bản mới, thử lại sau 2 phút.' : e.message, true); }).then(function () { el.disabled = false; }); } else if (a === 'goal') { var gj = MV.cache[mvKey()]; if (gj) openMkGoal(gj); } else if (a === 'fresh') { KP.err = ''; kpFetch(true); var mk0 = mvMonthKey(), k = mvKey(); delete MV.cache[k]; MV.err = ''; delete MV.pend[k]; mvFetch(k, true); if (mk0 !== k) { delete MV.cache[mk0]; delete MV.pend[mk0]; mvFetch(mk0, true); } render(); } }; });
    $$('#view [data-dash="sfb"]').forEach(function (el) { el.onclick = function () { var f = S.f.m; f.sfb = !f.sfb; store('dash_sfb', f.sfb ? '1' : '0'); render(); }; });
    $$('#view [data-dgo]').forEach(function (el) { el.onclick = function () { var g = el.getAttribute('data-dgo').replace(/^mk-/, ''), t = $('#mk-' + g); if (!t) return; if (t.tagName === 'DETAILS') t.open = true; t.scrollIntoView({ behavior: 'smooth', block: 'start' }); }; });
    $$('details[data-mk]').forEach(function (d) { d.addEventListener('toggle', function () { var o = S.f.m.open || (S.f.m.open = {}), k = d.getAttribute('data-mk'); if (d.open) o[k] = 1; else delete o[k]; store('mkt_open', JSON.stringify(o)); }); });
    $$('[data-mka]').forEach(function (el) { el.onclick = function () { S.f.m.acc = el.getAttribute('data-mka'); render(); }; });
    $$('[data-mkc]').forEach(function (el) { el.onclick = function () { S.f.m.cv = el.getAttribute('data-mkc'); S.f.m.call = 0; render(); }; });
    $$('[data-kpd]').forEach(function (el) { el.onclick = function () { S.f.m.kd = el.getAttribute('data-kpd'); S.f.m.kall = 0; render(); }; });
    $$('[data-kpall]').forEach(function (el) { el.onclick = function () { S.f.m.kall = 1; render(); }; });
  }

  /* ---------- màn hình Quản lý chi phí quảng cáo */
  function openMkt(tab) {
    var own = lvl() >= 3; tab = tab || (own ? 'fb' : 'file'); // Marketing: nhập file / nhập tay / xem lại; kết nối Facebook chỉ Quản trị
    var fp = (route().view === 'marketing' ? S.f.m : S.f.g) || { p: { k: 'month' } }, key = gaKey(perRange(fp.p), cmpRange(fp.p)), mj = MK.cache[key], fb = mj ? mj.cfg.fb : { on: false, all: [], accounts: [] };
    var tabs = [['fb', '📘 Facebook tự động'], ['file', '📄 Nhập file'], ['add', '✍️ Nhập tay'], ['list', '📋 Đã nhập']].filter(function (t) { return own || t[0] !== 'fb'; });
    var chSel = function (id, v) { return '<select id="' + id + '">' + MKT_CH.map(function (c) { return '<option' + (c.k === v ? ' selected' : '') + '>' + esc(c.k) + '</option>'; }).join('') + '</select>'; };
    var body = '<div class="chips wrap">' + tabs.map(function (t) { return '<button class="chip' + (t[0] === tab ? ' on' : '') + '" data-mt="' + t[0] + '">' + t[1] + '</button>'; }).join('') + '</div>';
    if (tab === 'fb') {
      body += fb.on ? '<div class="notice info">✅ Đã kết nối (mã …' + esc(fb.tail) + ')' + (fb.last ? ' · cập nhật ' + fDateTime(fb.last) : '') + (fb.from ? ' · có số từ ' + fDate(new Date(fb.from + 'T12:00:00+07:00').getTime()) : '') + '. CRM tự lấy số hôm nay 1 tiếng 1 lần, lấy lại 3 ngày gần nhất 3 tiếng 1 lần (7h–22h).</div>' + (fb.err ? '<p class="err">⚠️ ' + esc(fb.err) + '</p>' : '') +
        '<div class="box"><h3>Tài khoản quảng cáo lấy số</h3>' + fb.all.map(function (a) { return '<label class="dash-chk"><input type="checkbox" name="fbAcc" value="' + esc(a.id) + '"' + (fb.accounts.indexOf(a.id) >= 0 ? ' checked' : '') + '> ' + esc(a.name) + ' <span class="muted small">' + esc(a.id) + ' · ' + esc(a.cur) + (a.st !== 1 ? ' · không hoạt động' : '') + '</span></label>'; }).join('') + '<div class="steps"><button class="btn" id="fbAccSave">Lưu lựa chọn</button><button class="btn" id="fbFind">🔄 Tìm tài khoản mới</button></div>' +
        '<p class="small muted">CRM tự tìm tài khoản mới mỗi ngày' + (fb.listed ? ' (lần gần nhất ' + fDateTime(fb.listed) + ')' : '') + '. Tài khoản đang hoạt động được tự thêm và lấy số 90 ngày.</p>' +
        '<div class="row2c"><label class="f"><span>Thêm mã tài khoản quảng cáo</span><input id="fbAddAcc" type="text" inputmode="numeric" autocomplete="off" placeholder="vd 1234567890123456, 2345…"></label><div class="f" style="align-self:end"><button class="btn" id="fbAddGo">＋ Thêm</button></div></div></div>' +
        (fb.usd ? '<div class="box"><h3>💵 Tỷ giá USD</h3><p class="small muted">Có tài khoản tính tiền bằng USD (thường là tài khoản thuê). CRM đổi sang VND theo tỷ giá này, nên nhập đúng giá agency tính cho mình (cả phí).</p><div class="row2c"><label class="f"><span>1 USD = … đ</span><input id="fbFx" type="text" inputmode="numeric" value="' + (fb.fx || 26500) + '"></label><div class="f" style="align-self:end"><button class="btn" id="fbFxGo">Lưu &amp; tính lại 90 ngày</button></div></div></div>' : '') +
        '<div class="steps"><button class="btn pri" id="fbSync" data-days="7">↻ Lấy số 7 ngày gần nhất</button><button class="btn" id="fbSync90" data-days="90">Lấy lại 90 ngày</button><button class="btn ghost" id="fbOff">Ngắt kết nối</button></div>' +
        '<details class="box"><summary>Đổi mã truy cập</summary>' + fbTokenForm() + '</details>'
        : '<p>Kết nối 1 lần, CRM tự lấy chi phí từng chiến dịch mỗi ngày từ Facebook Ads (Meta), kể cả số tin nhắn, số khách để lại SĐT.</p>' + fbTokenForm() + fbGuide();
    } else if (tab === 'file') {
      body += '<p>Xuất báo cáo từ trình quản lý quảng cáo dạng <b>CSV</b>, chia <b>theo ngày</b> và <b>theo chiến dịch</b>, rồi chọn file ở đây. Đọc được file của Facebook, TikTok, Google Ads (tiếng Việt hoặc tiếng Anh). Nhập lại cùng khoảng ngày thì số cũ của kênh đó được thay bằng số mới.</p>' +
        '<div class="row2c"><label class="f"><span>Kênh</span>' + chSel('mfCh', 'TikTok') + '</label><label class="f"><span>File CSV</span><input type="file" id="mfFile" accept=".csv,.tsv,.txt,text/csv"></label></div>' +
        '<div id="mfNoDay" hidden><p class="small">File không có cột ngày → chọn khoảng ngày của báo cáo, CRM chia đều chi phí theo ngày.</p><div class="row2c"><label class="f"><span>Từ ngày</span><input type="date" id="mfFrom"></label><label class="f"><span>Đến ngày</span><input type="date" id="mfTo"></label></div></div>' +
        '<div id="mfPrev" class="small"></div><button class="btn pri" id="mfGo" disabled>Nhập</button>' +
        '<details class="small" style="margin-top:12px"><summary>Cách xuất file từng kênh</summary><p><b>Facebook:</b> Trình quản lý quảng cáo → tab Chiến dịch → Phân tích → Theo thời gian → <b>Ngày</b> → Báo cáo → Xuất dữ liệu bảng → .csv.</p><p><b>TikTok:</b> TikTok Ads Manager → Báo cáo → Báo cáo tuỳ chỉnh → chiều: Ngày + Chiến dịch, chỉ số: Chi phí, Lượt hiển thị, Lượt nhấp → Xuất → CSV.</p><p><b>Google Ads:</b> Chiến dịch → Phân đoạn → Thời gian → <b>Ngày</b> → biểu tượng Tải xuống → .csv.</p></details>';
    } else if (tab === 'add') {
      var t0 = today();
      body += '<p>Cho chi phí không có file: KOL / KOC, in tờ rơi, sự kiện, quảng cáo trả tiền mặt… Số tiền được chia đều cho các ngày trong khoảng.</p>' +
        '<div class="row2c"><label class="f"><span>Kênh</span>' + chSel('maCh', 'KOL / KOC') + '</label><label class="f"><span>Số tiền</span><input type="text" id="maAmt" inputmode="numeric" placeholder="vd 5tr hoặc 5000000"></label></div>' +
        '<div class="row2c"><label class="f"><span>Từ ngày</span><input type="date" id="maFrom" value="' + isoDate(monthRange(monthOf(t0))[0]) + '"></label><label class="f"><span>Đến ngày</span><input type="date" id="maTo" value="' + isoDate(monthRange(monthOf(t0))[1] - 1) + '"></label></div>' +
        '<label class="f"><span>Ghi chú (tên chiến dịch, người nhận…)</span><input type="text" id="maLabel" maxlength="120" placeholder="vd KOC Lan review DILVANG"></label><button class="btn pri" id="maGo">Lưu</button>';
    } else body += '<div id="mlList"><p class="muted">⏳ Đang tải…</p></div>';
    var m = modal('📣 Chi phí quảng cáo', body, '<button class="btn" data-close>Đóng</button>');
    $$('[data-mt]', m).forEach(function (b0) { b0.onclick = function () { closeModal(true); openMkt(b0.getAttribute('data-mt')); }; });
    var done = function (msg) { toast(msg); MK.cache = {}; MV.cache = {}; render(); };
    var busy = function (btn, on, txt) { btn.disabled = on; if (txt) btn.textContent = txt; };
    var tk = $('#fbTok', m);
    // mã Facebook gửi bằng tên fbToken: tên token là mã phiên đăng nhập CRM, trùng sẽ bị đăng xuất
    if (tk) $('#fbTokGo', m).onclick = function () {
      var btn = this; busy(btn, true, 'Đang kiểm tra và lấy 90 ngày…');
      api('mkt_fb', { fbToken: tk.value.trim(), fbAccount: ($('#fbAccId', m) || {}).value || '' }).then(function (j) { closeModal(true); done('✅ Đã kết nối Facebook Ads · ' + (j.rows || 0) + ' dòng · ' + moneyShort(j.spend || 0) + (j.warn ? ' · ' + j.warn : '')); openMkt('fb'); }, function (e) { busy(btn, false, 'Kết nối'); toast(e.message, true); var ai = $('#fbAccId', m); if (ai && e.j && e.j.needAcc) { ai.focus(); ai.scrollIntoView({ block: 'center' }); } });
    };
    var findDone = function (j) { closeModal(true); done(j.fresh ? '✅ Thêm ' + j.fresh + ' tài khoản mới · lấy ' + moneyShort(j.spend || 0) + ' (90 ngày)' + (j.warn ? ' · ⚠️ ' + j.warn : '') : 'Không có tài khoản mới'); openMkt('fb'); };
    if ($('#fbFxGo', m)) $('#fbFxGo', m).onclick = function () { var btn = this; busy(btn, true, 'Đang tính lại…'); api('mkt_fb', { fx: parseMoney($('#fbFx', m).value) }).then(function (j) { closeModal(true); done('Đã đổi tỷ giá, tính lại ' + moneyShort(j.spend || 0) + ' (90 ngày)'); openMkt('fb'); }, function (e) { busy(btn, false, 'Lưu & tính lại 90 ngày'); toast(e.message, true); }); };
    if ($('#fbFind', m)) $('#fbFind', m).onclick = function () { var btn = this; busy(btn, true, 'Đang tìm…'); api('mkt_fb', { refresh: 1 }).then(findDone, function (e) { busy(btn, false, '🔄 Tìm tài khoản mới'); toast(e.message, true); }); };
    if ($('#fbAddGo', m)) $('#fbAddGo', m).onclick = function () { var btn = this, v = $('#fbAddAcc', m).value.trim(); if (!v) { $('#fbAddAcc', m).focus(); return; } busy(btn, true, 'Đang thêm…'); api('mkt_fb', { addAcc: v }).then(findDone, function (e) { busy(btn, false, '＋ Thêm'); toast(e.message, true); }); };
    if ($('#fbAccSave', m)) $('#fbAccSave', m).onclick = function () { var ids = $$('input[name=fbAcc]:checked', m).map(function (i) { return i.value; }); api('mkt_fb', { accounts: ids }).then(function () { toast('Đã lưu'); }, function (e) { toast(e.message, true); }); };
    ['#fbSync', '#fbSync90'].forEach(function (s0) { var btn = $(s0, m); if (btn) btn.onclick = function () { var t = btn.textContent; busy(btn, true, 'Đang lấy…'); api('mkt_fb', { sync: 1, days: +btn.getAttribute('data-days') }).then(function (j) { busy(btn, false, t); done('Đã lấy ' + j.rows + ' dòng · ' + moneyShort(j.spend) + (j.warn ? ' · ⚠️ ' + j.warn : '')); }, function (e) { busy(btn, false, t); toast(e.message, true); }); }; });
    if ($('#fbOff', m)) $('#fbOff', m).onclick = function () { if (!confirm('Ngắt kết nối Facebook Ads? Số đã lấy vẫn giữ.')) return; api('mkt_fb', { off: 1 }).then(function () { closeModal(true); done('Đã ngắt kết nối'); }); };
    if (tab === 'file') bindMktFile(m, done);
    if (tab === 'add') $('#maGo', m).onclick = function () {
      var btn = this, amt = parseMoney($('#maAmt', m).value);
      busy(btn, true); api('mkt_add', { channel: $('#maCh', m).value, amount: amt, from: $('#maFrom', m).value, to: $('#maTo', m).value, label: $('#maLabel', m).value }).then(function () { closeModal(true); done('Đã lưu ' + money(amt)); }, function (e) { busy(btn, false); toast(e.message, true); });
    };
    if (tab === 'list') api('mkt_list').then(function (j) {
      $('#mlList', m).innerHTML = j.list.length ? j.list.map(function (r) { return '<div class="card"><div class="r1"><b>' + chInfo(r.channel).icon + ' ' + esc(r.channel) + ' · ' + esc(r.label) + '</b><span class="end">' + money(r.spend) + '</span></div><div class="r3">' + (r.src === 'file' ? '📄 ' : '✍️ ') + fDate(new Date(r.from + 'T12:00:00+07:00').getTime()) + ' – ' + fDate(new Date(r.to + 'T12:00:00+07:00').getTime()) + ' · ' + esc(r.note || '') + ' · ' + fDateTime(r.at) + ' <button class="link" data-mdel="' + esc(r.batch) + '">Xoá</button></div></div>'; }).join('') : '<p class="muted">Chưa nhập tay / nhập file lần nào.</p>';
      $$('[data-mdel]', m).forEach(function (b0) { b0.onclick = function () { if (!confirm('Xoá lần nhập này?')) return; api('mkt_del', { batch: b0.getAttribute('data-mdel') }).then(function () { closeModal(true); done('Đã xoá'); openMkt('list'); }, function (e) { toast(e.message, true); }); }; });
    }, function (e) { $('#mlList', m).innerHTML = '<p class="err">' + esc(e.message) + '</p>'; });
  }
  function fbTokenForm() { return '<label class="f"><span>Mã truy cập Facebook (access token)</span><input id="fbTok" type="password" autocomplete="off" placeholder="EAA…"></label><label class="f"><span>Mã tài khoản quảng cáo (không bắt buộc)</span><input id="fbAccId" type="text" inputmode="numeric" autocomplete="off" placeholder="vd 1234567890123456 – nhiều tài khoản thì cách nhau dấu phẩy"></label><button class="btn pri" id="fbTokGo">Kết nối</button><p class="small muted">Mã chỉ lưu trên máy chủ CRM, không hiện lại ở đây.</p>'; }
  function fbGuide() {
    return '<details class="box" open><summary><b>Cách lấy mã truy cập (làm 1 lần, trên máy tính)</b></summary><ol class="small">' +
      '<li>Mở <a href="https://business.facebook.com/settings/system-users" target="_blank" rel="noopener">Cài đặt doanh nghiệp → Người dùng hệ thống</a> (Business Manager đang giữ tài khoản quảng cáo).</li>' +
      '<li>Bấm <b>Thêm</b> → đặt tên “CRM Thực Dưỡng Lành” → vai trò <b>Nhân viên</b> → Tạo.</li>' +
      '<li>Chọn người dùng vừa tạo → <b>Gán tài sản</b> → Tài khoản quảng cáo → <b>tích chọn tất cả</b> tài khoản → bật <b>Xem hiệu quả</b> → Lưu. Tài khoản bạn marketing chạy bằng nick riêng thì thêm vào Business Manager trước (Tài khoản quảng cáo → Thêm → Yêu cầu quyền truy cập).</li>' +
      '<li>Bấm <b>Tạo mã</b> → chọn ứng dụng (chưa có thì tạo nhanh ở <a href="https://developers.facebook.com/apps/creation/" target="_blank" rel="noopener">developers.facebook.com</a>, loại “Doanh nghiệp”, gắn với Business Manager) → hạn dùng <b>Không bao giờ</b> → tích quyền <b>ads_read</b> → Tạo mã.</li>' +
      '<li>Copy mã (bắt đầu bằng EAA…), dán vào ô trên → <b>Kết nối</b>. CRM tự tìm tài khoản quảng cáo và lấy số 90 ngày gần nhất.</li></ol>' +
      '<p class="small muted">Không tự làm được thì nhờ người chạy quảng cáo làm giúp, hoặc tạm dùng tab 📄 Nhập file.</p></details>';
  }
  function parseMoney(s) { s = String(s || '').trim().toLowerCase().replace(/\s/g, ''); var m = s.match(/^([\d.,]+)(tr|triệu|k|nghìn|ngàn|tỷ)?$/); if (!m) return 0; var n = parseFloat(m[1].replace(/[.,](?=\d{3}(\D|$))/g, '').replace(',', '.')) || 0; return Math.round(n * ({ tr: 1e6, 'triệu': 1e6, k: 1e3, 'nghìn': 1e3, 'ngàn': 1e3, 'tỷ': 1e9 }[m[2]] || 1)); }

  /* ---------- đọc file CSV quảng cáo (Facebook / TikTok / Google, tiếng Việt / Anh, phẩy / chấm phẩy / tab, UTF-8 / UTF-16) */
  function csvRows(text) {
    var first = text.split(/\r?\n/).slice(0, 5).join('\n'), sep = [',', ';', '\t'].sort(function (a, b) { return first.split(b).length - first.split(a).length; })[0];
    var rows = [], row = [], f = '', q = false;
    for (var i = 0; i < text.length; i++) {
      var ch = text[i];
      if (q) { if (ch === '"') { if (text[i + 1] === '"') { f += '"'; i++; } else q = false; } else f += ch; continue; }
      if (ch === '"') q = true; else if (ch === sep) { row.push(f); f = ''; } else if (ch === '\n' || ch === '\r') { if (ch === '\r' && text[i + 1] === '\n') i++; row.push(f); rows.push(row); row = []; f = ''; } else f += ch;
    }
    if (f || row.length) { row.push(f); rows.push(row); }
    return rows;
  }
  var CSV_COL = {
    day: /^(ngay|day|date|by day|ngay bat dau bao cao|bat dau bao cao|reporting starts|thoi gian|stat time day)$/,
    campaign: /^(ten chien dich|chien dich|campaign name|campaign)$/,
    spend: /^(so tien da chi tieu|amount spent|cost|chi phi|spend|tong chi phi|total cost)\b/,
    impressions: /^(luot hien thi|impressions?|impr\.?|so lan hien thi)$/,
    clicks: /^(luot click vao lien ket|so lan nhap vao lien ket|link clicks|clicks?( \(destination\)| \(all\))?|luot nhap|luot click|so lan nhap)$/,
    msgs: /(luot bat dau cuoc tro chuyen|messaging conversations started|tin nhan)/,
    leads: /^(khach hang tiem nang|leads?|luot gui bieu mau|form submissions?)$/
  };
  function csvDate(s) {
    s = String(s || '').trim(); var m;
    if ((m = s.match(/^(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})/))) return m[1] + '-' + pad(+m[2]) + '-' + pad(+m[3]);
    if ((m = s.match(/^(\d{1,2})[-/.](\d{1,2})[-/.](\d{4})/))) return m[3] + '-' + pad(+m[2]) + '-' + pad(+m[1]); // file tiếng Việt: ngày/tháng/năm
    if ((m = s.match(/^([A-Za-z]{3})\w* (\d{1,2}), (\d{4})/))) { var mo = 'janfebmaraprmayjunjulaugsepoctnovdec'.indexOf(m[1].toLowerCase()) / 3 + 1; if (mo > 0) return m[3] + '-' + pad(mo) + '-' + pad(+m[2]); } // Google Ads: "Oct 1, 2026"
    return '';
  }
  function csvNum(s) { s = String(s == null ? '' : s).replace(/[^\d.,-]/g, ''); if (!s || s === '-') return 0; s = s.replace(/[.,](\d{1,2})$/, ''); return Math.round(Number(s.replace(/[.,]/g, '')) || 0); }
  function parseAdsCsv(text) {
    var rows = csvRows(text.replace(/^﻿/, '')), hi = -1, map = {};
    for (var i = 0; i < Math.min(rows.length, 15) && hi < 0; i++) {
      var mm = {}; rows[i].forEach(function (h, j) { var n = norm(h).replace(/\s*\(.*?\)\s*$/, '').trim(); Object.keys(CSV_COL).forEach(function (k) { if (mm[k] == null && CSV_COL[k].test(n)) mm[k] = j; }); });
      if (mm.spend != null) { hi = i; map = mm; }
    }
    if (hi < 0) return { err: 'Không thấy cột chi phí (Số tiền đã chi tiêu / Amount spent / Cost) trong file.' };
    var out = [];
    rows.slice(hi + 1).forEach(function (r) {
      var camp = map.campaign != null ? String(r[map.campaign] || '').trim() : '', sp = csvNum(r[map.spend]);
      if (!sp || /^(tong|total|tổng)/i.test(camp) || (map.campaign != null && !camp)) return;
      out.push({ day: map.day != null ? csvDate(r[map.day]) : '', campaign: camp || 'Không tên', spend: sp, impressions: map.impressions != null ? csvNum(r[map.impressions]) : 0, clicks: map.clicks != null ? csvNum(r[map.clicks]) : 0, msgs: map.msgs != null ? csvNum(r[map.msgs]) : 0, leads: map.leads != null ? csvNum(r[map.leads]) : 0 });
    });
    return { rows: out, noDay: map.day == null || out.every(function (x) { return !x.day; }), cols: Object.keys(map) };
  }
  function bindMktFile(m, done) {
    var P = null, file = '';
    var spread = function (rows, from, to) { // file không có ngày: chia đều theo ngày
      var a = new Date(from + 'T12:00:00+07:00').getTime(), n = Math.round((new Date(to + 'T12:00:00+07:00').getTime() - a) / DAY) + 1, out = [];
      rows.forEach(function (r) { for (var i = 0; i < n; i++) { var e = Math.floor(r.spend / n); out.push({ day: isoDate(a + i * DAY), campaign: r.campaign, spend: i === n - 1 ? r.spend - e * (n - 1) : e, impressions: i ? 0 : r.impressions, clicks: i ? 0 : r.clicks, msgs: i ? 0 : r.msgs, leads: i ? 0 : r.leads }); } });
      return out;
    };
    $('#mfFile', m).onchange = function () {
      var f0 = this.files[0]; if (!f0) return; file = f0.name;
      f0.arrayBuffer().then(function (buf) {
        var u8 = new Uint8Array(buf), enc = u8[0] === 0xFF && u8[1] === 0xFE ? 'utf-16le' : u8[0] === 0xFE && u8[1] === 0xFF ? 'utf-16be' : 'utf-8';
        P = parseAdsCsv(new TextDecoder(enc).decode(buf));
        var pv = $('#mfPrev', m);
        if (P.err) { pv.innerHTML = '<p class="err">' + esc(P.err) + '</p>'; $('#mfGo', m).disabled = true; return; }
        $('#mfNoDay', m).hidden = !P.noDay;
        var sum = P.rows.reduce(function (s0, r) { return s0 + r.spend; }, 0), ds = P.rows.map(function (r) { return r.day; }).filter(Boolean).sort();
        pv.innerHTML = '<div class="notice info">Đọc được <b>' + P.rows.length + '</b> dòng · tổng <b>' + money(sum) + '</b>' + (ds.length ? ' · từ ' + ds[0] + ' đến ' + ds[ds.length - 1] : '') + ' · cột: ' + P.cols.join(', ') + '</div>';
        $('#mfGo', m).disabled = !P.rows.length;
      });
    };
    $('#mfGo', m).onclick = function () {
      var btn = this, rows = P.rows, ch = $('#mfCh', m).value;
      if (P.noDay) { var a = $('#mfFrom', m).value, b = $('#mfTo', m).value; if (!a || !b || b < a) { toast('Chọn từ ngày – đến ngày của báo cáo.', true); return; } rows = spread(rows, a, b); }
      if (ch === 'Facebook' && MK.fbOn && !confirm('Facebook đang tự lấy số từ API. Nhập thêm file Facebook có thể bị tính 2 lần. Vẫn nhập?')) return;
      btn.disabled = true; btn.textContent = 'Đang nhập…';
      api('mkt_import', { channel: ch, rows: rows, file: file }).then(function (j) { closeModal(true); done('Đã nhập ' + money(j.spend) + ' (' + j.from + ' → ' + j.to + ')'); }, function (e) { btn.disabled = false; btn.textContent = 'Nhập'; toast(e.message, true); });
    };
  }

  /* ================================================================ Sàn TMĐT + mục tiêu tháng theo mảng của cả văn phòng (lệnh san*, api/src/san.js).
   * Đơn sàn không có trong CRM: người phụ trách sàn tải file đơn hàng xuất từ Seller Center (.xlsx / .csv), CRM đọc file ngay trên máy (sanParse) rồi gửi các đơn lên.
   * Tải lại file mới (cùng mã đơn) → trạng thái huỷ / hoàn được cập nhật, doanh số luôn tính theo ngày đặt.
   * Thêm sàn: thêm vào SAN_SHOPS + GOAL_CH ở đây và SHOPS trong api/src/san.js. Thêm mảng mục tiêu: GOAL_CH + GOAL_KEYS (san.js). */
  var SAN_SHOPS = [{ k: 'Shopee', icon: '🟠' }, { k: 'TikTok Shop', icon: '🎵' }, { k: 'Lazada', icon: '🔷' }];
  var GOAL_CH = [
    { k: 'Sale', icon: '📞', tip: 'đơn sale lên + chốt từ khách hỏi' },
    { k: 'Website', icon: '🌐', tip: 'khách tự đặt trên web' },
    { k: 'Shopee', icon: '🟠', san: 1 }, { k: 'TikTok Shop', icon: '🎵', san: 1 }, { k: 'Lazada', icon: '🔷', san: 1 },
    { k: 'Khác', icon: '📦', tip: 'sỉ, đại lý, CTV… chưa có số tự động' }
  ];
  var GOAL_LV = { done: '🎉 Đã đạt', ok: '🟢 Đúng tiến độ', mid: '🟠 Hơi chậm', bad: '🔴 Đang chậm', none: '' };
  var SN = { cache: {}, busy: '', err: '' };
  function sanIcon(k) { return (SAN_SHOPS.filter(function (x) { return x.k === k; })[0] || { icon: '🛒' }).icon; }
  function snKey(R, P, month) { return gaKey(R, P) + '_' + month; }
  function snFetch(key) {
    if (SN.busy === key) return; SN.busy = key; SN.err = '';
    var k = key.split('_');
    api('san', { from: k[0], to: k[1], pf: k[2], pt: k[3], month: k[4] }).then(function (j) { SN.cache[key] = j; }, function (e) { SN.err = /Không rõ thao tác/.test(e.message) ? 'Máy chủ đang cập nhật bản mới, thử lại sau 2 phút.' : e.message; })
      .then(function () { SN.busy = ''; var v = route().view; if (v === 'tong-quan' || v === 'san') softRender(true); });
  }
  /** Số liệu sàn của kỳ đang xem (tự tải nếu chưa có). */
  function snGet(R, P, month) { var key = snKey(R, P, month), sj = SN.cache[key]; if (!sj && !SN.err) setTimeout(function () { snFetch(key); }, 0); return sj; }

  /** Tiến độ mục tiêu tháng: đúng tiến độ nếu % đạt ≥ % số ngày đã qua; hơi chậm ≥ 80% mức đó (như khối Mục tiêu tháng ở Hiệu quả). */
  function goalCalc(cur, tgt, month) {
    var R = monthRange(month), isCur = month === monthOf(Date.now()), days = Math.round((R[1] - R[0]) / DAY), el = isCur ? Math.min(days, Math.floor((today() - R[0]) / DAY) + 1) : days;
    var p = tgt ? cur / tgt : 0, tp = el / days, left = days - el + 1, remain = Math.max(0, tgt - cur);
    return { p: p, tp: tp, isCur: isCur, el: el, days: days, left: left, perDay: isCur && left ? Math.ceil(remain / left) : 0, remain: remain, fc: el ? Math.round(cur / el * days) : 0,
      lv: !tgt ? 'none' : p >= 1 ? 'done' : p >= tp ? 'ok' : p >= tp * 0.8 ? 'mid' : 'bad' };
  }
  /** Doanh số đơn trong CRM theo mảng: Website = khách tự đặt trên web, Sale = còn lại (nhập tay, file sale, chốt từ khách hỏi). */
  function crmChanRev(R) {
    var r = { Sale: 0, Website: 0 };
    S.d.orders.forEach(function (o) { if (isVoid(o.status) || o.time < R[0] || o.time >= R[1]) return; r[chanOf(o)[0] === 'Website' ? 'Website' : 'Sale'] += o.total || 0; });
    return r;
  }
  /** Các dòng mục tiêu tháng: mảng có mục tiêu hoặc có doanh số (Sale, Shopee luôn hiện). Mục tiêu Sale để trống = tổng mục tiêu các nhân viên. */
  function goalRows(month, sj, onlySan) {
    var tg = (sj && sj.targets && sj.targets[month]) || {}, act = onlySan ? {} : crmChanRev(monthRange(month)), staffT = teamTarget(month);
    (sj ? sj.mon : []).forEach(function (r) { act[r[0]] = r[1]; });
    return GOAL_CH.filter(function (c) { return !onlySan || c.san; }).map(function (c) {
      return { c: c, t: c.k === 'Sale' ? (tg.Sale || staffT) : (tg[c.k] || 0), v: act[c.k] || 0, auto: c.k === 'Sale' && !tg.Sale && staffT > 0, wait: c.san && !sj };
    }).filter(function (x) { return x.t || x.v || x.c.k === 'Shopee' || (!onlySan && x.c.k === 'Sale'); });
  }
  function goalRowHTML(x, month) {
    var g = goalCalc(x.v, x.t, month);
    var num = x.wait ? '⏳ đang tải…' : x.t ? '<b>' + moneyShort(x.v) + '</b> / ' + moneyShort(x.t) + ' · <b>' + Math.round(g.p * 100) + '%</b>' : '<b>' + moneyShort(x.v) + '</b> · chưa đặt mục tiêu';
    var more = !x.t || x.wait ? '' : g.p >= 1 ? 'vượt ' + moneyShort(x.v - x.t) : g.isCur ? 'cần ~' + moneyShort(g.perDay) + '/ngày · giữ nhịp này cả tháng đạt ' + pct(g.fc, x.t) + '%' : 'cả tháng đạt ' + Math.round(g.p * 100) + '%';
    return '<div class="ogoal-r ' + g.lv + '"><div class="ogoal-h"><b>' + x.c.icon + ' ' + esc(x.c.k) + '</b>' + (x.c.tip ? '<small>' + esc(x.c.tip) + (x.auto ? ' · mục tiêu = tổng mục tiêu nhân viên' : '') + '</small>' : '') + '<span class="ogoal-st">' + GOAL_LV[g.lv] + '</span></div>' +
      '<div class="ogoal-bar"><i style="width:' + Math.min(100, g.p * 100).toFixed(1) + '%"></i>' + (g.isCur && x.t ? '<u style="left:' + (g.tp * 100).toFixed(1) + '%"></u>' : '') + '</div>' +
      '<div class="ogoal-m"><span>' + num + '</span><span>' + more + '</span></div></div>';
  }
  /** Khối tổng: thanh lớn + còn thiếu / mỗi ngày cần / dự báo. */
  function goalTotalHTML(title, cur, tgt, month) {
    var g = goalCalc(cur, tgt, month), L = [];
    if (g.isCur && g.p < 1) L.push('Còn thiếu <b>' + money(g.remain) + '</b> trong <b>' + g.left + ' ngày</b> → mỗi ngày cần khoảng <b>' + moneyShort(g.perDay) + '</b>.');
    if (g.isCur && g.p < 1 && g.el >= 3) L.push('Nếu giữ nhịp như hiện nay, cả tháng đạt khoảng <b>' + moneyShort(g.fc) + '</b> (' + pct(g.fc, tgt) + '% mục tiêu).');
    if (g.p >= 1) L.push('Vượt mục tiêu <b>' + money(cur - tgt) + '</b>. Tuyệt vời!');
    return '<div class="goal ' + g.lv + '"><div class="goal-h"><b>' + title + '</b><span class="goal-st">' + GOAL_LV[g.lv] + '</span></div>' +
      '<div class="goal-num"><b>' + moneyShort(cur) + '</b> / ' + moneyShort(tgt) + '<span>' + Math.round(g.p * 100) + '%</span></div>' +
      '<div class="ogoal-bar big"><i style="width:' + Math.min(100, g.p * 100).toFixed(1) + '%"></i>' + (g.isCur ? '<u style="left:' + (g.tp * 100).toFixed(1) + '%"></u>' : '') + '</div>' +
      (g.isCur ? '<div class="bar-legend"><span>Vạch đen = hôm nay (ngày ' + g.el + '/' + g.days + ')</span></div>' : '') + L.map(function (x) { return '<p>' + x + '</p>'; }).join('') + '</div>';
  }
  /** Tổng quan: mục tiêu tháng của cả văn phòng = cộng các mảng. */
  function officeGoalBlock(month, sj, noTotal) { // noTotal: Tổng quan đã có thanh tổng ở màn hình đầu
    var rows = goalRows(month, sj, false), cur = 0, tt = 0; rows.forEach(function (x) { cur += x.v; tt += x.t; });
    var h = '<section class="section"><div class="section-h"><h2>🎯 Mục tiêu ' + monthLabel(month) + ' · cả văn phòng</h2><div class="grow"></div>' + (sj ? '<button class="btn sm" data-san="goals" data-month="' + month + '">🎯 Đặt mục tiêu</button>' : '') + '</div>';
    if (!tt) h += '<div class="notice">Chưa đặt mục tiêu theo mảng. Bấm <b>🎯 Đặt mục tiêu</b> để chia mục tiêu tháng cho Sale, Website, Shopee, TikTok Shop…</div>';
    else if (!noTotal) h += goalTotalHTML('Tổng văn phòng' + (sj ? '' : ' <small class="muted">(⏳ chưa gồm sàn)</small>'), cur, tt, month);
    return h + '<div class="box ogoal">' + rows.map(function (x) { return goalRowHTML(x, month); }).join('') +
      '<p class="bar-legend">Vạch đen = hôm nay. Sale, Website lấy từ đơn trong CRM; sàn lấy từ file tải lên ở tab Sàn (theo ngày đặt, đã trừ đơn huỷ / hoàn).</p></div></section>';
  }
  /** Lần tải file gần nhất của từng sàn: quá 3 ngày chưa tải → nhắc. */
  /** Nguồn số mới nhất của từng sàn: file đơn tải lên hoặc Google Sheet báo cáo (Sheet: tính theo ngày cuối đã gõ số). → {sàn: {f, sheet, late (số ngày chưa cập nhật)}} */
  function sanLatest(sj) {
    var by = {};
    sj.files.forEach(function (f) {
      if (f[1] !== 'orders' && f[1] !== 'sheet') return;
      var sheet = f[1] === 'sheet', ref = sheet ? (f[3] ? new Date(f[3] + 'T23:59:00+07:00').getTime() : 0) : f[2], o = by[f[0]];
      if (!o || ref > o.ref) by[f[0]] = { f: f, sheet: sheet, ref: ref, late: Math.floor((Date.now() - ref) / DAY) };
    });
    return by;
  }
  function sanFresh(sj, compact) {
    var by = sanLatest(sj), ks = Object.keys(by), err = sj.sheet && sj.sheet.err ? '<div class="notice">⚠️ Chưa đọc được Google Sheet báo cáo sàn: ' + esc(sj.sheet.err) + '</div>' : '';
    if (!ks.length) return err + '<div class="notice">Chưa có số liệu sàn. Người phụ trách sàn gõ số hằng ngày vào Google Sheet báo cáo (CRM tự lấy 30 phút/lần), hoặc vào tab <b>Sàn</b> → <b>📤 Tải file từ sàn</b>.</div>';
    var fd = function (d) { return fDate(new Date(d + 'T12:00:00+07:00').getTime()); };
    return err + '<p class="small san-fresh">' + ks.map(function (k) {
      var o = by[k], f = o.f, old = o.sheet ? o.late > 2 : o.late > 3;
      return '<span class="' + (old ? 'bad-line' : 'muted') + '">' + sanIcon(k) + ' ' + esc(k) + ': ' + (o.sheet ? '📗 Google Sheet, có số đến ngày ' + (f[3] ? fd(f[3]) : '–') + ' (CRM lấy lúc ' + fDateTime(f[2]) + ')' : 'tải file ' + fDateTime(f[2]) + (f[3] ? ', đơn đến ' + fd(f[3]) : '')) +
        (old ? ' · ⚠️ ' + (o.sheet ? o.late + ' ngày chưa gõ số' : 'quá 3 ngày chưa cập nhật') : '') + '</span>';
    }).join(compact ? ' · ' : '<br>') + '</p>';
  }
  /** Cộng các dòng [.., sàn, g, n, c, r, t, nv, nn, nr] (off = vị trí g). */
  function sanSum(rows, off) {
    // gp = tiền đơn sàn đã thu (máy chủ mới; cũ = 0) · gv = tiền hoàn / huỷ sàn (máy chủ từ 26/10/2026)
    var F = ['g', 'n', 'c', 'r', 't', 'nv', 'nn', 'nr', 'gp', 'gv'], s = { shop: {}, day: {} }; F.forEach(function (f) { s[f] = 0; });
    rows.forEach(function (r) {
      var x = s.shop[r[off - 1]] || (s.shop[r[off - 1]] = {}); F.forEach(function (f, i) { s[f] += r[off + i] || 0; x[f] = (x[f] || 0) + (r[off + i] || 0); });
      if (off === 2) s.day[r[0]] = (s.day[r[0]] || 0) + (r[2] || 0);
    });
    return s;
  }
  function sanStats(sj, R, compact, P) {
    var s = sanSum(sj.days, 2), p = sanSum(sj.prev, 1), rate = function (a, b) { return b ? oneDec(a * 100 / b) + '%' : '–'; };
    // đường nhỏ: sj.days = [ngày, sàn, doanh số, đơn, huỷ, hoàn, tổng đơn đặt, …]; không vẽ Tiền thực về / Tỷ lệ hoàn (số về sau 1–2 tuần, mấy ngày gần đây luôn thấp)
    var SB = R ? trendBuckets(R) : null, sd = function (i) { return trendSum(SB, sj.days, function (r) { return dayMs(r[0]); }, function (r) { return r[i] || 0; }); }, ssk = function (f, bad) { return SB ? sparkSvg(f(), SB.partial, bad) : ''; };
    if (!s.t && !p.t) return '<div class="box"><p class="muted">Chưa có đơn sàn nào đặt trong kỳ này.</p></div>';
    var shops = Object.keys(s.shop).sort(function (a, b) { return s.shop[b].g - s.shop[a].g; });
    var netNote = !s.nn ? 'Chưa có số. Tải file Thu nhập / Đối soát của sàn để có tiền thật về tài khoản.' :
      (s.nr ? s.nr + ' đơn số thật (file Thu nhập)' : '') + (s.nn > s.nr ? (s.nr ? ', ' : '') + (s.nn - s.nr) + ' đơn ước tính (đã trừ voucher shop, phí sàn)' : '') + (s.n > s.nn ? ', ' + (s.n - s.nn) + ' đơn chưa có số' : '') + '.';
    var h = '<div class="metrics dash-m3">' +
      metric('Doanh số sàn', moneyShort(s.g + s.gv), money(s.g + s.gv) + ' · ' + shops.map(function (k) { return sanIcon(k) + ' ' + esc(k) + ' ' + moneyShort(s.shop[k].g + (s.shop[k].gv || 0)); }).join(' · ') + '. Theo ngày đặt, gồm đơn huỷ / hoàn' + (s.gv ? ' (' + moneyShort(s.gv) + ', trừ đi còn ' + moneyShort(s.g) + ')' : '') + '.', delta(s.g + s.gv, p.g + p.gv), '', ssk(function () { var a = sd(2), b = sd(11); return a.map(function (x, i) { return x + b[i]; }); })) +
      metric('Số đơn', s.n, shops.map(function (k) { return esc(k) + ' ' + s.shop[k].n; }).join(' · ') + ' (không tính huỷ / hoàn).', delta(s.n, p.n), '', ssk(function () { return sd(3); })) +
      metric('Giá trị TB / đơn', s.n ? moneyShort(Math.round(s.g / s.n)) : '–', 'Doanh số ÷ số đơn.', s.n && p.n ? delta(Math.round(s.g / s.n), Math.round(p.g / p.n)) : '', '', ssk(function () { return trendRate(sd(2), sd(3)); })) +
      metric('Tiền thực về', s.nn ? moneyShort(s.nv) : '–', netNote, s.nn && p.nn ? delta(s.nv, p.nv) : '') +
      metric('Tỷ lệ huỷ', rate(s.c, s.t), s.c + ' / ' + s.t + ' đơn đặt bị huỷ.', s.t && p.t ? inv(dRate(s.c * 100 / s.t, p.c * 100 / p.t)) : '', '', ssk(function () { return trendRate(sd(4), sd(6), 100); }, true)) +
      metric('Tỷ lệ hoàn', rate(s.r, s.t), s.r + ' đơn trả hàng / hoàn tiền / giao không thành công.', s.t && p.t ? inv(dRate(s.r * 100 / s.t, p.r * 100 / p.t)) : '') + '</div>';
    if (compact) return h;
    if (shops.length > 1) h += '<div class="box"><h3>Theo sàn</h3>' + barList(shops.map(function (k) { var x = s.shop[k]; return { l: sanIcon(k) + ' ' + k, v: x.g, sub: x.n + ' đơn · huỷ ' + x.c + ' · hoàn ' + x.r }; }), moneyShort, '', { below: 1 }) + '</div>';
    h += '<div class="dash-grid">';
    var BS = trendBuckets(R), offS = trendOff(R, P), sd = function (r) { return dayMs(r[0]); };
    if (BS.L.length >= 2) h += '<div class="box"><h3>📈 Doanh số sàn</h3>' + trendChart({ B: BS, fmt: moneyShort, what: 'Doanh số sàn', series: [{ v: trendSum(BS, sj.days, sd, function (r) { return r[2] || 0; }), name: 'Kỳ này', cls: 'cur' }, offS !== null && sj.pdays && { v: trendSum(BS, sj.pdays, sd, function (r) { return r[1] || 0; }, offS), name: 'Kỳ trước (' + CMP_LABEL + ')', cls: 'prev' }] }) + '</div>';
    h += '<div class="box"><h3>🏆 Sản phẩm bán chạy trên sàn</h3>' + barList(sj.prods.map(function (r) { return { l: sanIcon(r[0]) + ' ' + (r[1].length > 70 ? r[1].slice(0, 68) + '…' : r[1]), v: r[3], sub: r[2] + ' sản phẩm', tip: r[1] }; }), moneyShort, 'Chưa có.', { below: 1 }) + '</div></div>';
    return h;
  }
  /** Tổng quan: khối sàn gọn, bấm sang tab Sàn xem chi tiết. */
  function sanDashBlock(sj, R) {
    var h = '<section class="section"><div class="section-h"><h2>🛒 Sàn TMĐT</h2><span class="tip">Shopee, TikTok Shop · theo ngày đặt</span><div class="grow"></div><a class="btn sm" href="#san">Chi tiết sàn →</a></div>';
    if (!sj) return h + '<div class="box"><p class="muted">' + (SN.err ? '⚠️ ' + esc(SN.err) : '⏳ Đang tải số liệu sàn…') + '</p></div></section>';
    return h + sanFresh(sj, true) + (sj.files.length ? sanStats(sj, R, true) : '') + '</section>';
  }
  function viewSan() {
    var f = S.f.s || (S.f.s = {}); if (!f.p || f.p.k === 'all') f.p = { k: 'month' };
    var R = perRange(f.p), P = cmpRange(f.p), month = monthOf(Math.min(R[1] - 1, Date.now())), sj = snGet(R, P, month);
    var h = '<div class="page-head"><h1>Sàn TMĐT</h1><div class="grow"></div><button class="btn pri" data-san="up">📤 Tải file từ sàn</button></div>' + perChips('s', f.p);
    if (!sj) return h + '<div class="box"><p class="muted">' + (SN.err ? '⚠️ ' + esc(SN.err) : '⏳ Đang tải số liệu sàn…') + '</p></div>';
    h += sanFresh(sj);
    var rows = goalRows(month, sj, true), cur = 0, tt = 0; rows.forEach(function (x) { cur += x.v; tt += x.t; });
    h += '<section class="section"><div class="section-h"><h2>🎯 Mục tiêu ' + monthLabel(month) + ' · sàn</h2><div class="grow"></div>' + (sj.admin ? '<button class="btn sm" data-san="goals" data-month="' + month + '">🎯 Đặt mục tiêu</button>' : '') + '</div>' +
      (tt && rows.length > 1 ? goalTotalHTML('Tổng các sàn', cur, tt, month) : '') + '<div class="box ogoal">' + rows.map(function (x) { return goalRowHTML(x, month); }).join('') +
      (tt ? '' : '<p class="small muted">Chưa có mục tiêu sàn tháng này' + (sj.admin ? '. Bấm 🎯 Đặt mục tiêu.' : ', Quản trị đặt ở tab Tổng quan.') + '</p>') + '</div></section>';
    h += '<section class="section"><div class="section-h"><h2>📊 Kết quả ' + esc(perLabel(f.p).toLowerCase()) + '</h2></div>' + sanStats(sj, R, false, P) + '</section>';
    h += '<div class="steps">' + (sj.sheet && sj.sheet.id ? '<button class="btn" data-san="sheet">🔄 Lấy số từ Google Sheet</button><a class="btn" target="_blank" rel="noopener" href="https://docs.google.com/spreadsheets/d/' + esc(sj.sheet.id) + '/edit">📗 Mở Sheet báo cáo</a>' : '') +
      (sj.admin ? '<button class="btn" data-san="sheetcfg">⚙️ Link Sheet báo cáo</button>' : '') + '<button class="btn" data-san="list">📋 Các lần tải file</button>' + (sj.admin ? '<button class="btn" data-san="people">👤 Người phụ trách sàn' + (sj.people.length ? ': ' + esc(sj.people.join(', ')) : '') + '</button>' : '') + '</div>';
    return h + sanHowTo(false);
  }
  function sanHowTo(open) {
    return '<details class="box san-how"' + (open ? ' open' : '') + '><summary><b>Cách xuất file trên sàn</b></summary><div class="small">' +
      '<p><b>📗 Đang dùng Google Sheet báo cáo:</b> người phụ trách sàn gõ số mỗi ngày vào Sheet, CRM tự lấy 30 phút/lần (hoặc bấm 🔄 Lấy số từ Google Sheet). Không bắt buộc tải file. Tải file đơn hàng thì những ngày trong file dùng số của file (có thêm sản phẩm bán chạy, tiền thực về).</p>' +
      '<p><b>Nên làm:</b> mỗi ngày (hoặc 2–3 ngày 1 lần) xuất đơn <b>30 ngày gần nhất</b> rồi tải lên. Đơn cũ bị huỷ / hoàn sau đó sẽ tự được cập nhật, không bị tính trùng.</p>' +
      '<p><b>🟠 Shopee – file đơn hàng:</b> Kênh Người Bán → <b>Đơn hàng</b> → Tất cả → bấm <b>Xuất</b> → chọn khoảng <b>ngày đặt hàng</b> → đợi file tạo xong → <b>Tải về</b> (file .xlsx).</p>' +
      '<p><b>🟠 Shopee – tiền về (không bắt buộc):</b> Kênh Người Bán → <b>Tài Chính → Doanh Thu</b> → tab Đã thanh toán → <b>Xuất</b>. File này cho số tiền thật Shopee chuyển về, thay cho số ước tính.</p>' +
      '<p><b>🎵 TikTok Shop – file đơn hàng:</b> Seller Center → <b>Đơn hàng → Quản lý đơn hàng</b> → <b>Xuất</b> → chọn khoảng ngày tạo đơn → tải file (Excel hoặc CSV) trong mục Lịch sử xuất.</p>' +
      '<p><b>🎵 TikTok Shop – tiền về (không bắt buộc):</b> <b>Tài chính → Đối soát / Bảng sao kê</b> → xuất chi tiết theo đơn.</p>' +
      '<p class="muted">Tên nút trên sàn có thể đổi theo thời gian. File không đọc được thì CRM sẽ báo các cột đang có, chụp màn hình gửi Quản trị.</p></div></details>';
  }
  function bindSan() {
    $$('[data-san]').forEach(function (el) {
      el.onclick = function () {
        var a = el.getAttribute('data-san');
        if (a === 'sheet') sanSheetNow(el); else if (a === 'sheetcfg') openSanSheet(); else if (a === 'up') openSanUp(); else if (a === 'list') openSanList(); else if (a === 'people') openSanPeople(); else if (a === 'goals') openGoals(el.getAttribute('data-month'));
      };
    });
  }
  function sanDone(msg) { SN.cache = {}; SN.err = ''; toast(msg); render(); }
  function sanSheetMsg(j) { return j.off ? 'Đã tắt đọc Google Sheet.' : 'Đã lấy số từ Google Sheet: ' + j.tabs.map(function (t) { return t.shop + ' ' + t.days + ' ngày (' + t.n + ' đơn · ' + moneyShort(t.gmv) + ')'; }).join(' · '); }
  /** 🔄 Lấy số ngay từ Google Sheet báo cáo (bình thường CRM tự lấy 30 phút/lần). */
  function sanSheetNow(btn) {
    btn.disabled = true; btn.textContent = '⏳ Đang lấy số…';
    api('san_sheet', {}).then(function (j) { sanDone(sanSheetMsg(j)); }, function (e) { btn.disabled = false; btn.textContent = '🔄 Lấy số từ Google Sheet'; toast(e.message, true); });
  }
  /* ---------- Quản trị: link Google Sheet báo cáo sàn */
  function openSanSheet() {
    var cur = ''; for (var k in SN.cache) if (SN.cache[k].sheet) { cur = SN.cache[k].sheet.id; break; }
    var body = '<p>Người phụ trách sàn gõ số mỗi ngày vào Google Sheet (mỗi sàn 1 tab tên <b>Shopee</b> / <b>TikTok</b> / <b>Lazada</b>, cột Ngày, Số đơn hàng, Số lượng sản phẩm, Doanh số, Số đơn hoàn/huỷ, Doanh số hoàn huỷ). CRM tự lấy số 30 phút/lần.</p>' +
      '<p class="small muted">File phải chia sẻ cho <b>thaisoniph@gmail.com</b> (Người xem). Doanh thu = Doanh số − Doanh số hoàn huỷ. Ngày nào đã tải file đơn hàng từ sàn thì dùng số trong file (chi tiết hơn).</p>' +
      '<label class="f"><span>Link Google Sheet</span><input type="text" id="ssUrl" autocomplete="off" value="' + (cur ? 'https://docs.google.com/spreadsheets/d/' + esc(cur) + '/edit' : '') + '" placeholder="https://docs.google.com/spreadsheets/d/…"></label>' +
      '<p class="hint">Xoá trắng ô = dùng file mặc định. Gõ dấu <b>-</b> = tắt, không đọc Sheet nữa (xoá số đã lấy từ Sheet).</p><p class="err" id="ssErr"></p>';
    var m = modal('📗 Google Sheet báo cáo sàn', body, '<button class="btn" data-close>Huỷ</button><button class="btn pri" id="ssSave">Lưu &amp; lấy số</button>');
    $('#ssSave', m).onclick = function () {
      var btn = this; btn.disabled = true; btn.textContent = 'Đang lấy số…';
      api('san_sheet', { sheet: $('#ssUrl', m).value.trim() }).then(function (j) { closeModal(true); sanDone(sanSheetMsg(j)); }, function (e) { btn.disabled = false; btn.textContent = 'Lưu & lấy số'; $('#ssErr', m).textContent = e.message; });
    };
  }

  /* ---------- Quản trị đặt mục tiêu tháng từng mảng */
  function sanTargetsOf(month) { for (var k in SN.cache) { var t = SN.cache[k].targets; if (t && Object.prototype.hasOwnProperty.call(t, month)) return t[month] || {}; } return null; }
  function openGoals(month) {
    var tg = sanTargetsOf(month);
    if (!tg) { // tháng chưa tải (vd tháng sau): hỏi máy chủ rồi mở lại
      var d0 = isoDate(today()); api('san', { from: d0, to: d0, pf: d0, pt: d0, month: month }).then(function (j) { SN.cache['_goal_' + month] = j; openGoals(month); }, function (e) { toast(e.message, true); });
      return;
    }
    var staffT = teamTarget(month), last = crmChanRev(monthRange(shiftMonth(month, -1))), next = shiftMonth(monthOf(Date.now()), 1);
    var body = '<p>Mục tiêu doanh số <b>' + monthLabel(month) + '</b> cho từng mảng. Tổng văn phòng = cộng các mảng. Ô để trống = mảng đó không đặt mục tiêu.</p>' +
      GOAL_CH.map(function (c) {
        return '<label class="f"><span>' + c.icon + ' ' + esc(c.k) + (c.tip ? ' <small class="muted">(' + esc(c.tip) + ')</small>' : '') + '</span><input type="text" inputmode="decimal" autocomplete="off" data-gk="' + esc(c.k) + '" value="' + (tg[c.k] || '') + '" placeholder="' + (c.k === 'Sale' && staffT ? 'trống = tổng mục tiêu NV ' + moneyShort(staffT) : 'vd 150tr') + '"></label>' +
          (last[c.k] ? '<p class="hint">Tháng trước đạt ' + moneyShort(last[c.k]) + '</p>' : '');
      }).join('') + '<p class="hint" id="ogSum"></p>' + (tg._by ? '<p class="small muted">Lần sửa gần nhất: ' + esc(tg._by) + ', ' + fDateTime(tg._at) + '</p>' : '') +
      (month !== next ? '<p><button class="link" id="ogNext" type="button">Đặt mục tiêu ' + monthLabel(next) + ' →</button></p>' : '') + '<p class="err" id="ogErr"></p>';
    var m = modal('🎯 Mục tiêu ' + monthLabel(month), body, '<button class="btn" data-close>Huỷ</button><button class="btn pri" id="ogSave">Lưu</button>');
    var vals = function () { var o = {}; $$('[data-gk]', m).forEach(function (i) { var v = moneyIn(i.value); if (v) o[i.getAttribute('data-gk')] = v; }); return o; };
    var upd = function () { var o = vals(), s0 = 0; Object.keys(o).forEach(function (k) { s0 += o[k]; }); if (!o.Sale && staffT) s0 += staffT; $('#ogSum', m).innerHTML = 'Tổng văn phòng: <b>' + money(s0) + '</b>' + (!o.Sale && staffT ? ' (Sale = tổng mục tiêu nhân viên)' : ''); };
    $$('[data-gk]', m).forEach(function (i) { i.addEventListener('input', upd); }); upd();
    if ($('#ogNext', m)) $('#ogNext', m).onclick = function () { closeModal(true); openGoals(next); };
    $('#ogSave', m).onclick = function () {
      var btn = this; btn.disabled = true; btn.textContent = 'Đang lưu…';
      api('san_target', { month: month, goals: vals() }).then(function () { closeModal(true); sanDone('Đã lưu mục tiêu ' + monthLabel(month) + ' ✓'); }, function (e) { btn.disabled = false; btn.textContent = 'Lưu'; $('#ogErr', m).textContent = e.message; });
    };
  }
  /* ---------- Quản trị chọn người phụ trách sàn */
  function openSanPeople() {
    var cur = null; for (var k in SN.cache) if (SN.cache[k].people) { cur = SN.cache[k].people; break; }
    cur = cur || []; var ck = function (n) { return cur.some(function (c) { return norm(c) === norm(n); }); };
    var us = (S.d.users || []).filter(function (u) { return u.active !== false && u.role !== 'Quản trị' && u.role !== 'Marketing'; });
    var body = '<p>Người được chọn thấy tab <b>Sàn</b>: xem doanh số sàn, mục tiêu sàn và tải file đơn hàng lên. Quản trị luôn có quyền.</p>' +
      us.map(function (u) { return '<label class="dash-chk"><input type="checkbox" name="sanP" value="' + esc(u.name) + '"' + (ck(u.name) ? ' checked' : '') + '> ' + esc(u.name) + ' <span class="muted small">' + esc(u.role) + '</span></label>'; }).join('');
    var m = modal('👤 Người phụ trách sàn', body, '<button class="btn" data-close>Huỷ</button><button class="btn pri" id="spSave">Lưu</button>');
    $('#spSave', m).onclick = function () {
      var btn = this; btn.disabled = true;
      api('san_people', { people: $$('input[name=sanP]:checked', m).map(function (i) { return i.value; }) }).then(function () { closeModal(true); sanDone('Đã lưu. Người được chọn mở lại CRM là thấy tab Sàn.'); }, function (e) { btn.disabled = false; toast(e.message, true); });
    };
  }
  /* ---------- các lần tải file */
  function openSanList() {
    var m = modal('📋 Các lần tải file sàn', '<div id="slList"><p class="muted">⏳ Đang tải…</p></div>', '<button class="btn" data-close>Đóng</button>');
    api('san_list').then(function (j) {
      var fd = function (d) { return d ? fDate(new Date(d + 'T12:00:00+07:00').getTime()) : ''; };
      $('#slList', m).innerHTML = j.list.length ? j.list.map(function (r) {
        var sh = r.kind === 'sheet';
        return '<div class="card"><div class="r1"><b>' + sanIcon(r.shop) + ' ' + esc(r.shop) + ' · ' + (sh ? '📗 Google Sheet báo cáo' : r.kind === 'income' ? '💵 tiền về' : '📦 đơn hàng') + '</b><span class="end">' + moneyShort(r.gmv) + '</span></div>' +
          '<div class="r3">' + esc(r.file) + '<br>' + (sh ? r.n + ' đơn' + (r.from ? ' · ngày ' + fd(r.from) + ' – ' + fd(r.to) : '') + ' · lấy tự động lúc ' + fDateTime(r.at) : (r.kind === 'income' ? r.n + ' đơn, khớp ' + r.fresh : r.n + ' đơn (' + r.fresh + ' mới) · đặt ' + fd(r.from) + ' – ' + fd(r.to)) + ' · ' + esc(r.by || '') + ' · ' + fDateTime(r.at) + ' <button class="link" data-sdel="' + esc(r.batch) + '">Xoá</button>') + '</div></div>';
      }).join('') : '<p class="muted">Chưa tải file nào.</p>';
      $$('[data-sdel]', m).forEach(function (b0) {
        b0.onclick = function () {
          if (!confirm(b0.getAttribute('data-sdel')[0] === 'o' ? 'Xoá lần tải này? Các đơn lấy từ file này (chưa có ở file tải sau) sẽ bị xoá khỏi số liệu sàn.' : 'Xoá lần tải này? Tiền về của các đơn trong file quay lại số ước tính.')) return;
          api('san_del', { batch: b0.getAttribute('data-sdel') }).then(function () { closeModal(true); sanDone('Đã xoá'); openSanList(); }, function (e) { toast(e.message, true); });
        };
      });
    }, function (e) { $('#slList', m).innerHTML = '<p class="err">' + esc(e.message) + '</p>'; });
  }
  /* ---------- tải file */
  function openSanUp() {
    var body = '<p>Chọn file xuất từ Shopee / TikTok Shop (Excel .xlsx hoặc .csv). CRM tự nhận ra sàn và loại file (đơn hàng hay tiền về), đọc ngay trên máy rồi mới gửi lên.</p>' +
      '<label class="f"><span>File</span><input type="file" id="suFile" accept=".xlsx,.csv,.txt"></label>' +
      '<label class="f"><span>Sàn</span><select id="suShop">' + SAN_SHOPS.map(function (o) { return '<option>' + esc(o.k) + '</option>'; }).join('') + '</select></label>' +
      '<div id="suPrev" class="small"></div><button class="btn pri" id="suGo" disabled>Nhập</button>' + sanHowTo(false);
    var m = modal('📤 Tải file từ sàn', body, '<button class="btn" data-close>Đóng</button>'), P = null, file = '';
    $('#suFile', m).onchange = function () {
      var f0 = this.files[0], pv = $('#suPrev', m); if (!f0) return; file = f0.name; P = null; $('#suGo', m).disabled = true; pv.innerHTML = '<p>⏳ Đang đọc file…</p>';
      sanReadFile(f0).then(function (sheets) {
        P = sanParse(sheets);
        if (P.err) { pv.innerHTML = '<p class="err">' + P.err + '</p>'; P = null; return; }
        $('#suShop', m).value = P.shop; pv.innerHTML = sanPreview(P); $('#suGo', m).disabled = false;
      }).catch(function (e) { pv.innerHTML = '<p class="err">' + esc(e.message) + '</p>'; });
    };
    $('#suGo', m).onclick = function () {
      if (!P) return; var btn = this; btn.disabled = true; btn.textContent = 'Đang nhập…';
      api('san_import', { shop: $('#suShop', m).value, kind: P.kind, file: file, rows: P.rows }).then(function (j) {
        closeModal(true);
        sanDone(P.kind === 'income' ? 'Đã cập nhật tiền về ' + j.hit + ' đơn' + (j.miss ? ' · ' + j.miss + ' đơn chưa có (tải file đơn hàng trước rồi tải lại file này)' : '') : 'Đã nhập ' + j.rows + ' đơn (' + j.fresh + ' mới, ' + j.upd + ' cập nhật) · ' + moneyShort(j.gmv));
      }, function (e) { btn.disabled = false; btn.textContent = 'Nhập'; toast(e.message, true); });
    };
  }
  function sanPreview(P) {
    var fd = function (d) { return fDate(new Date(d + 'T12:00:00+07:00').getTime()); };
    if (P.kind === 'income') return '<div class="notice info">💵 File <b>tiền về</b> ' + esc(P.shop) + ': <b>' + P.rows.length + '</b> đơn · tổng ' + money(P.sum) + '. CRM ghi số tiền thật vào các đơn đã có, thay cho số ước tính.</div>';
    var n = P.n, st = Object.keys(P.st).sort(function (a, b) { return P.st[b][0] - P.st[a][0]; });
    var NM = { ok: 'tính doanh số', cancel: 'huỷ', 'return': 'hoàn', wait: 'chờ thanh toán (chưa tính)' };
    return '<div class="notice info">📦 File <b>đơn hàng</b> ' + esc(P.shop) + ': <b>' + P.rows.length + '</b> đơn, đặt từ ' + fd(P.from) + ' đến ' + fd(P.to) + '.<br>' +
      'Tính doanh số <b>' + n.ok + '</b> đơn · <b>' + money(P.sum) + '</b><br>Huỷ ' + n.cancel + ' · Hoàn ' + n['return'] + (n.wait ? ' · Chờ thanh toán ' + n.wait : '') + '</div>' +
      '<details><summary>Trạng thái đọc được trong file</summary>' + st.slice(0, 15).map(function (k) { return '<div>' + esc(k || '(trống)') + ': ' + P.st[k][0] + ' đơn → ' + NM[P.st[k][1]] + '</div>'; }).join('') + '</details>' +
      (P.noNet ? '<p class="muted">File không có cột phí sàn nên chưa ước tính được tiền về. Muốn có số tiền về, tải thêm file Thu nhập / Đối soát.</p>' : '');
  }

  /* ---------- đọc file sàn: .xlsx (giải nén ngay trên trình duyệt, không cần thư viện ngoài) hoặc .csv */
  function sanReadFile(f) {
    return f.arrayBuffer().then(function (buf) {
      var u8 = new Uint8Array(buf);
      if (u8[0] === 0x50 && u8[1] === 0x4B) return xlsxSheets(u8);
      if (u8[0] === 0xD0 && u8[1] === 0xCF) throw new Error('Đây là file Excel đời cũ (.xls). Mở file bằng Excel hoặc Google Sheets → Lưu dưới dạng .xlsx rồi tải lại.');
      var enc = u8[0] === 0xFF && u8[1] === 0xFE ? 'utf-16le' : u8[0] === 0xFE && u8[1] === 0xFF ? 'utf-16be' : 'utf-8';
      return [csvRows(new TextDecoder(enc).decode(buf).replace(/^﻿/, ''))];
    });
  }
  function zipDir(u8) {
    var dv = new DataView(u8.buffer, u8.byteOffset, u8.byteLength), e = -1, out = {};
    for (var i = u8.length - 22; i >= Math.max(0, u8.length - 70000); i--) if (dv.getUint32(i, true) === 0x06054b50) { e = i; break; }
    if (e < 0) throw new Error('File Excel bị lỗi hoặc chưa tải xong. Tải lại file từ sàn.');
    var n = dv.getUint16(e + 10, true), p = dv.getUint32(e + 16, true), td = new TextDecoder();
    for (var k = 0; k < n && dv.getUint32(p, true) === 0x02014b50; k++) {
      var nl = dv.getUint16(p + 28, true), xl = dv.getUint16(p + 30, true), cl = dv.getUint16(p + 32, true);
      out[td.decode(u8.subarray(p + 46, p + 46 + nl))] = { m: dv.getUint16(p + 10, true), cs: dv.getUint32(p + 20, true), lo: dv.getUint32(p + 42, true) };
      p += 46 + nl + xl + cl;
    }
    return out;
  }
  function zipText(u8, z, name) {
    var e = z[name]; if (!e) return Promise.resolve('');
    var dv = new DataView(u8.buffer, u8.byteOffset, u8.byteLength), st = e.lo + 30 + dv.getUint16(e.lo + 26, true) + dv.getUint16(e.lo + 28, true), data = u8.subarray(st, st + e.cs);
    if (e.m === 0) return Promise.resolve(new TextDecoder().decode(data));
    if (typeof DecompressionStream === 'undefined') return Promise.reject(new Error('Trình duyệt này chưa đọc được file Excel. Cập nhật trình duyệt (Chrome, Safari mới), hoặc lưu file thành .csv rồi tải lên.'));
    return new Response(new Blob([data]).stream().pipeThrough(new DecompressionStream('deflate-raw'))).text();
  }
  function xmlDec(s) { return s.indexOf('&') < 0 ? s : s.replace(/&(lt|gt|quot|apos|amp|#\d+|#x[0-9a-f]+);/gi, function (_, e) { var k = e.toLowerCase(); return { lt: '<', gt: '>', quot: '"', apos: "'", amp: '&' }[k] || String.fromCodePoint(k[1] === 'x' ? parseInt(k.slice(2), 16) : +k.slice(1)); }); }
  function xmlTxt(x) { var out = ''; x.replace(/<t(?:\s[^>]*)?>([\s\S]*?)<\/t>/g, function (_, t) { out += t; return ''; }); return xmlDec(out); }
  function xlsxCol(s) { var n = 0; for (var i = 0; i < s.length; i++) n = n * 26 + s.charCodeAt(i) - 64; return n - 1; }
  /** Các dòng của 1 trang tính: chữ → chuỗi, số → Number (để phân biệt 150.000 chữ với 150000.5 số). */
  function xlsxRows(x, ss) {
    var rows = [];
    x.replace(/<row\b[^>]*?(?:\/>|>([\s\S]*?)<\/row>)/g, function (_, inner) {
      var row = [];
      if (inner) inner.replace(/<c\b([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/g, function (_, at, body) {
        var ref = (at.match(/\br="([A-Z]+)/) || [])[1], t = (at.match(/\bt="(\w+)"/) || [])[1] || '', v = '';
        if (body) {
          if (t === 'inlineStr') v = xmlTxt(body);
          else { var mv = body.match(/<v>([\s\S]*?)<\/v>/); v = mv ? xmlDec(mv[1]) : ''; if (t === 's') v = ss[+v] || ''; else if ((t === '' || t === 'n') && v !== '' && !isNaN(+v)) v = +v; }
        }
        row[ref ? xlsxCol(ref) : row.length] = v; return '';
      });
      for (var i = 0; i < row.length; i++) if (row[i] === undefined) row[i] = '';
      rows.push(row); return '';
    });
    return rows;
  }
  function xlsxSheets(u8) {
    var z = zipDir(u8);
    return Promise.all([zipText(u8, z, 'xl/workbook.xml'), zipText(u8, z, 'xl/_rels/workbook.xml.rels'), zipText(u8, z, 'xl/sharedStrings.xml')]).then(function (a) {
      var rel = {}, paths = [], ss = [];
      a[1].replace(/<Relationship\b([^>]*)>/g, function (_, at) { var id = (at.match(/\bId="([^"]+)"/) || [])[1], tg = (at.match(/\bTarget="([^"]+)"/) || [])[1]; if (id && tg) rel[id] = tg.replace(/^\//, '').replace(/^(?!xl\/)/, 'xl/'); return ''; });
      a[0].replace(/<sheet\b([^>]*)>/g, function (_, at) { var id = (at.match(/\br:id="([^"]+)"/) || [])[1]; if (rel[id]) paths.push(rel[id]); return ''; });
      if (!paths.length) paths = Object.keys(z).filter(function (n) { return /^xl\/worksheets\/[^/]+\.xml$/.test(n); }).sort();
      a[2].replace(/<si(?:\s[^>]*)?>([\s\S]*?)<\/si>|<si\/>/g, function (_, inner) { ss.push(inner ? xmlTxt(inner.replace(/<rPh\b[\s\S]*?<\/rPh>/g, '')) : ''); return ''; });
      return Promise.all(paths.slice(0, 8).map(function (p) { return zipText(u8, z, p).then(function (x) { return xlsxRows(x, ss); }); }));
    });
  }
  /* Tên cột trong file các sàn (không dấu, chữ thường). Shopee: 1 dòng = 1 sản phẩm của đơn, cột cấp đơn lặp lại. TikTok: tương tự, có thêm 1 dòng giải thích dưới tiêu đề (tự bỏ qua). */
  var SAN_COL = {
    id: /^(ma don hang|id don hang|order id|order\/adjustment id|ma don hang\/dieu chinh|ordernumber|order number|so don hang)$/,
    day: /^(ngay dat hang|thoi gian dat hang|ngay tao don|ngay tao don hang|thoi gian tao|thoi gian tao don|thoi gian tao don hang|created time|order created time|order creation time|createtime|created at|order date)$/,
    status: /^(trang thai don hang|order status|status|trang thai)$/,
    sub: /^(order substatus|trang thai phu|trang thai con)$/,
    ret: /^(trang thai tra hang\/hoan tien|trang thai tra hang|cancelation\/return type|cancellation\/return type|loai huy\/tra hang|loai huy \/ tra hang)$/,
    name: /^(ten san pham|product name|itemname|item name)$/,
    qty: /^(so luong|quantity|qty)$/,
    rqty: /^(returned quantity|so luong san pham duoc hoan tra|so luong tra hang|sku quantity of return|so luong hoan tra)$/,
    line: /^(tong gia ban \(san pham\)|tong gia ban san pham)$/,
    before: /^(sku subtotal before discount|tong phu sku truoc giam gia|tong tien sku truoc giam gia)$/,
    sdisc: /^(sku seller discount|giam gia cua nguoi ban cho sku|giam gia sku cua nguoi ban)$/,
    after: /^(sku subtotal after discount|tong phu sku sau giam gia|tong tien sku sau giam gia)$/,
    price1: /^(gia uu dai|unitprice|unit price|don gia)$/,
    price0: /^(gia goc|sku unit original price)$/,
    voucher: /^(ma giam gia cua shop|voucher cua shop|shop voucher)$/,
    fee: /^(phi co dinh|phi dich vu|phi thanh toan|phi xu ly giao dich)$/,
    lvl: /^(don hang \/ san pham)$/, // file Thu nhập Shopee: mỗi đơn có 1 dòng Order + các dòng Sku lặp lại số tiền
    refund: /^(order refund amount|so tien hoan tra|so tien hoan lai|so tien hoan tien)$/,
    net: /^(tong tien da thanh toan|tong so tien da thanh toan|so tien thanh toan|tong thu nhap|so tien quyet toan|total settlement amount|settlement amount|so tien da nhan|tong so tien nguoi ban nhan duoc|so tien nguoi ban nhan duoc|thanh toan cho nguoi ban)$/
  };
  function sanCols(row) {
    var mm = { fee: [] };
    (row || []).forEach(function (h, j) { var n = norm(h).replace(/[*:]/g, '').replace(/\s+/g, ' ').trim(); Object.keys(SAN_COL).forEach(function (k) { if (!SAN_COL[k].test(n)) return; if (k === 'fee') mm.fee.push(j); else if (mm[k] == null) mm[k] = j; }); });
    return mm;
  }
  function sanNum(v) { return typeof v === 'number' ? Math.round(v) : csvNum(v); }
  function sanId(v) { var s = String(v == null ? '' : v).trim().replace(/^'/, ''); return /\d/.test(s) && /^[\w-]{5,40}$/.test(s) ? s : ''; }
  /** Ngày dạng a/b/yyyy: ngày trước hay tháng trước? Có số > 12 ở vị trí 2 mà không có ở vị trí 1 → tháng/ngày (file tiếng Anh), còn lại ngày/tháng. */
  function sanDmy(vals) { var d = 0, mo = 0; vals.forEach(function (v) { var m = String(v || '').match(/^(\d{1,2})[-/.](\d{1,2})[-/.]\d{4}/); if (!m) return; if (+m[1] > 12) d++; if (+m[2] > 12) mo++; }); return !(mo > 0 && d === 0); }
  function sanDay(v, dmy) {
    var y, mo, d, m;
    if (typeof v === 'number') { if (v < 20000 || v > 80000) return ''; var t = new Date(Math.round((v - 25569) * DAY)); y = t.getUTCFullYear(); mo = t.getUTCMonth() + 1; d = t.getUTCDate(); } // số ngày kiểu Excel
    else {
      var s = String(v || '').trim();
      if ((m = s.match(/^(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})/))) { y = +m[1]; mo = +m[2]; d = +m[3]; }
      else if ((m = s.match(/^(\d{1,2})[-/.](\d{1,2})[-/.](\d{4})/))) { y = +m[3]; mo = dmy ? +m[2] : +m[1]; d = dmy ? +m[1] : +m[2]; }
      else { var c = csvDate(s); return c; }
    }
    return y > 2000 && mo >= 1 && mo <= 12 && d >= 1 && d <= 31 ? y + '-' + pad(mo) + '-' + pad(d) : '';
  }
  /** Đọc các trang tính đã lấy từ file → { kind: 'orders' | 'income', shop, rows, … } hoặc { err }. */
  function sanParse(sheets) {
    var best = null;
    sheets.forEach(function (rows) {
      for (var i = 0; !best && i < Math.min(rows.length, 25); i++) { var mm = sanCols(rows[i]); if (mm.id != null && (mm.day != null || mm.net != null)) best = { rows: rows, hi: i, mm: mm }; }
    });
    if (!best) {
      var hd = (sheets[0] || []).slice(0, 3).map(function (r) { return r.filter(function (v) { return v !== ''; }).slice(0, 12).join(', '); }).join(' | ');
      return { err: 'Không nhận ra file. Cần file <b>đơn hàng</b> (có cột Mã đơn hàng + Ngày đặt hàng) hoặc file <b>tiền về</b> (Mã đơn hàng + số tiền thanh toán).<br><span class="muted">Đầu file: ' + esc(hd.slice(0, 300)) + '</span>' };
    }
    var mm = best.mm, R = best.rows.slice(best.hi + 1), hn = norm(best.rows[best.hi].join('|'));
    if (!R.some(function (r) { return r.some(function (v) { return v !== ''; }); })) return { err: 'File này <b>không có đơn nào</b> (chỉ có dòng tiêu đề). Trên Shopee hãy bấm tab <b>Tất cả</b> rồi mới bấm Xuất (file đúng có tên bắt đầu bằng <b>Order.all</b>; tên có chữ <i>toship</i> là đang ở tab Chờ lấy hàng).' };
    var g = function (r, k) { return mm[k] == null ? '' : r[mm[k]]; }, nb = function (r, k) { return mm[k] == null ? 0 : sanNum(r[mm[k]]); };
    var shop = /order id|id don hang|sku id|order\/adjustment id|tiktok/.test(hn) ? 'TikTok Shop' : /ordernumber|orderitemid|lazada/.test(hn) ? 'Lazada' : 'Shopee';
    var kind = mm.status == null && mm.net != null ? 'income' : 'orders';
    if (kind === 'income') {
      var I = {}, sum = 0; R.forEach(function (r) { var id = sanId(g(r, 'id')); if (!id || norm(g(r, 'lvl')).trim() === 'sku') return; var v = nb(r, 'net'); I[id] = (I[id] || 0) + v; sum += v; });
      var ir = Object.keys(I).map(function (id) { return { id: id, net: I[id] }; });
      return ir.length ? { kind: kind, shop: shop, rows: ir, sum: sum } : { err: 'File tiền về không có dòng nào có mã đơn.' };
    }
    if (mm.day == null) return { err: 'File không có cột Ngày đặt hàng.' };
    var dmy = sanDmy(R.map(function (r) { return g(r, 'day'); })), O = {}, list = [];
    R.forEach(function (r) {
      var id = sanId(g(r, 'id')), day = sanDay(g(r, 'day'), dmy); if (!id || !day) return;
      var o = O[id];
      if (!o) { o = O[id] = { id: id, day: day, status: String(g(r, 'status') || '').trim(), sub: String(g(r, 'sub') || '').trim(), ret: '', gmv: 0, rv: 0, qty: 0, items: {}, voucher: Math.abs(nb(r, 'voucher')), fee: mm.fee.reduce(function (s0, j) { return s0 + Math.abs(sanNum(r[j])); }, 0), rf: Math.abs(nb(r, 'refund')) }; list.push(o); }
      var rt = String(g(r, 'ret') || '').trim(); if (rt) o.ret = rt;
      var q = nb(r, 'qty') || 1, val = mm.line != null ? nb(r, 'line') : mm.before != null ? nb(r, 'before') - nb(r, 'sdisc') : mm.after != null ? nb(r, 'after') : (nb(r, 'price1') || nb(r, 'price0')) * q, rq = Math.min(q, nb(r, 'rqty'));
      o.gmv += val; o.qty += q; if (rq > 0) o.rv += val * rq / q;
      var nm = String(g(r, 'name') || '').trim(); if (nm) { var it = o.items[nm] || (o.items[nm] = [nm, 0, 0]); it[1] += q; it[2] += val; }
    });
    if (!list.length) return { err: 'Không đọc được đơn nào (cột Mã đơn hàng / Ngày đặt hàng trống hoặc sai định dạng).' };
    var n = { ok: 0, cancel: 0, 'return': 0, wait: 0 }, st = {}, sum2 = 0, days = [];
    var rows = list.map(function (o) {
      var s = norm(o.status + ' ' + o.sub), rt = norm(o.ret), state = 'ok', refund = 0;
      if (/huy|cancel/.test(s)) state = 'cancel';
      else if (/cho thanh toan|chua thanh toan|unpaid|awaiting payment/.test(s)) state = 'wait';
      else if (!/da nhan duoc hang/.test(s) && /khong thanh cong|that bai|failed|tra hang|hoan hang|returned|da hoan/.test(s)) state = 'return'; // Shopee: "Người mua xác nhận đã nhận được hàng, tuy nhiên vẫn có thể gửi yêu cầu Trả hàng…" là đơn thành công
      if (state === 'ok') {
        if (o.rf > 0) refund = o.rf;
        else if (rt && !/tu choi|rejected|huy|cancel|dong yeu cau|closed/.test(rt) && /chap nhan|chap thuan|dong y|hoan tien thanh cong|da hoan tien|da tra hang|accepted|approved|refunded|completed/.test(rt)) refund = o.rv > 0 ? o.rv : o.gmv; // yêu cầu đang xem xét: chưa trừ
        if (o.gmv > 0 && refund >= o.gmv) { state = 'return'; refund = 0; }
      }
      n[state]++; var sk = o.status + (o.ret ? ' · ' + o.ret : ''); (st[sk] = st[sk] || [0, state])[0]++;
      if (state === 'ok') sum2 += o.gmv - refund; days.push(o.day);
      return { id: o.id, day: o.day, status: sk, state: state, gmv: Math.round(o.gmv), refund: Math.round(refund), qty: o.qty,
        net: mm.fee.length ? Math.round(o.gmv - refund - o.voucher - o.fee) : null,
        items: Object.keys(o.items).map(function (k) { var it = o.items[k]; return [it[0], it[1], Math.round(it[2])]; }) };
    });
    days.sort();
    return { kind: kind, shop: shop, rows: rows, n: n, st: st, sum: sum2, from: days[0], to: days[days.length - 1], noNet: !mm.fee.length };
  }

  function fDur(sec) { sec = Math.round(sec || 0); return sec < 60 ? sec + ' giây' : Math.floor(sec / 60) + ' phút ' + pad(sec % 60) + ' giây'; }
  function gaSetupBox(gj) {
    if (!gj) return '<div class="box"><p class="muted">' + (GA.err ? '⚠️ ' + esc(GA.err) + ' <button class="link" data-dash="fresh">Thử lại</button>' : '⏳ Đang lấy số liệu Google Analytics…') + '</p></div>';
    var st = gj.setup, acc = gj.account ? '<b>' + esc(gj.account) + '</b>' : 'tài khoản Google chạy Apps Script';
    var steps = st === 'access' ? ['Mở <a href="https://analytics.google.com/" target="_blank" rel="noopener">Google Analytics</a> → ⚙️ Quản trị → <b>Quản lý quyền truy cập thuộc tính</b>.', 'Bấm ＋ → Thêm người dùng → nhập ' + acc + ' → vai trò <b>Người xem</b> → Thêm.', 'Quay lại đây bấm <b>Kiểm tra lại</b>.']
      : st === 'prop' ? ['Mở <a href="https://analytics.google.com/" target="_blank" rel="noopener">Google Analytics</a> → ⚙️ Quản trị → <b>Chi tiết thuộc tính</b>.', 'Copy <b>Mã thuộc tính</b> (dãy số ở góc phải, không phải mã G-…), dán vào ô dưới rồi bấm Lưu.']
      : ['Mở <a href="https://script.google.com/d/1xylCUALC-ny2iltgPPqiCSo2JaPqAGq5nSAYdePR2z1YmruWNK_1PNMP/edit" target="_blank" rel="noopener">Apps Script của CRM</a> bằng tài khoản thaisoniph@gmail.com (nên làm trên máy tính).', 'Bấm <b>▶ Chạy</b> ở thanh trên (hàm <b>ketNoiGA4</b> đã chọn sẵn) → <b>Xem xét quyền</b> → chọn tài khoản → nếu Google cảnh báo thì bấm <b>Nâng cao → Đi tới…</b> → <b>Cho phép</b>.', 'Báo Claude “đã cấp quyền GA4” để bật quyền mới, rồi bấm <b>Kiểm tra lại</b>.'];
    return '<div class="box dash-setup"><h3>🔌 Kết nối Google Analytics (làm 1 lần)</h3><p class="small muted">' + esc(gj.msg || '') + '</p><ol>' + steps.map(function (x) { return '<li>' + x + '</li>'; }).join('') + '</ol>' +
      (st === 'prop' ? '<div class="row2c"><label class="f"><span>Mã thuộc tính GA4</span><input type="text" id="gaProp" inputmode="numeric" value="' + esc(gj.prop || '') + '" placeholder="ví dụ 412345678"></label></div><button class="btn pri" data-dash="prop">Lưu</button> ' : '') +
      '<button class="btn" data-dash="fresh">Kiểm tra lại</button><p class="small muted" style="margin-top:8px">Trong lúc chờ, phần kinh doanh ở trên vẫn đúng vì lấy từ CRM.</p></div>';
  }
  function gaBlocks(g, b, noCmp) {
    var h = '', sess = g.cur.sessions || 1;
    // nguồn truy cập (Analytics phân loại)
    var ch = Object.keys(g.ch.cur).map(function (k) { var c = g.ch.cur[k], p = g.ch.prev[k]; return { l: GA_CH[k] || k, v: c[0], sub: pct(c[0], sess) + '% · ' + pct(c[1], c[0]) + '% ở lại xem' + (c[3] ? ' · ' + c[3] + ' đơn' : '') + (noCmp ? '' : p && p[0] ? ' · kỳ trước ' + p[0] : ' · kỳ trước 0') }; }).sort(function (x, y) { return y.v - x.v; });
    var src = g.src.map(function (r) { return { l: r[0] === '(direct) / (none)' ? 'Vào thẳng' : r[0], v: r[1], sub: pct(r[2], r[1]) + '% ở lại xem' + (r[3] ? ' · ' + r[3] + ' đơn' : '') }; });
    var webs = Object.keys(b.sub).filter(function (k) { return b.sub[k].g === 'Website'; }).map(function (k) { return { l: b.sub[k].l, v: b.sub[k].n, sub: moneyShort(b.sub[k].v) }; }).sort(function (x, y) { return y.v - x.v; });
    h += '<section class="section"><div class="section-h"><h2>🚦 Khách vào web từ đâu</h2><span class="tip">lượt truy cập theo nguồn · % ở lại xem · đơn Analytics ghi nhận</span></div><div class="dash-grid"><div class="box"><h3>Theo nhóm nguồn</h3>' + barList(ch, function (v) { return v.toLocaleString('vi-VN'); }, 'Chưa có lượt truy cập.', { below: 1 }) + '</div>' +
      '<div class="box"><h3>Chi tiết nguồn / kênh</h3>' + barList(src, function (v) { return v.toLocaleString('vi-VN'); }, 'Chưa có số liệu.', { below: 1 }) + '<p class="bar-legend">Tên do link UTM đặt (tạo ở <a href="https://thucduonglanh.vn/admin/utm" target="_blank" rel="noopener">/admin/utm</a>). Bài đăng nào cũng nên dùng link UTM để biết bài nào ra khách.</p></div></div>' +
      '<div class="box"><h3>Đơn web theo nguồn (CRM ghi nhận)</h3>' + barList(webs, String, 'Chưa có đơn web trong kỳ.', { below: 1 }) + '</div></section>';
    // phễu
    var ev = g.ev.cur, evp = g.ev.prev, users = function (e, o) { return (o || ev)[e] ? (o || ev)[e][1] : 0; }, steps = FUNNEL_STEPS.map(function (s, i) { return { k: s[0], l: s[1], v: i ? users(s[0]) : g.cur.users, pv: i ? users(s[0], evp) : g.prev.users }; });
    var worst = null; steps.forEach(function (s, i) { if (i < 2 || !steps[i - 1].v) return; s.rate = s.v / steps[i - 1].v; if (!worst || s.rate < worst.rate) worst = s; });
    h += '<section class="section"><div class="section-h"><h2>🔻 Phễu mua hàng trên web</h2><span class="tip">số người qua từng bước</span></div><div class="box">' +
      barList(steps.map(function (s, i) { var r = i ? (steps[i - 1].v ? pct(s.v, steps[i - 1].v) + '% bước trước' : '') : ''; return { l: s.l, v: s.v, txt: s.v.toLocaleString('vi-VN'), sub: (r ? r + ' · ' : '') + pct(s.v, steps[0].v || 1) + '% tổng' + (noCmp ? '' : ' · kỳ trước ' + s.pv) }; }), String, '', { below: 1 }) +
      (worst ? '<p class="notice" style="margin:10px 0 0">Khách rơi nhiều nhất ở bước <b>' + esc(worst.l.toLowerCase()) + '</b>: chỉ ' + Math.round(worst.rate * 100) + '% người qua bước trước đi tiếp. Nên xem bản ghi phiên ở <a href="https://clarity.microsoft.com/" target="_blank" rel="noopener">Clarity</a> đúng trang này.</p>' : '') +
      '<p class="bar-legend">Analytics ghi nhận ' + users('purchase') + ' người đặt hàng, CRM có ' + b.web + ' đơn web (CRM đầy đủ hơn vì không cần khách đồng ý cookie).</p></div></section>';
    // hành động liên hệ
    var act = function (e) { return ev[e] ? ev[e][0] : 0; }, actp = function (e) { return evp[e] ? evp[e][0] : 0; };
    h += '<section class="section"><div class="section-h"><h2>📞 Khách liên hệ từ web</h2></div><div class="kpis">' +
      kpi('Bấm gọi', act('click_call'), '', '', noCmp ? '' : 'kỳ trước ' + actp('click_call')) + kpi('Bấm Zalo', act('click_zalo'), '', '', noCmp ? '' : 'kỳ trước ' + actp('click_zalo')) +
      kpi('Điền form nhận quà / liên hệ', act('generate_lead'), '', '', b.webLeads + ' khách hỏi web trong CRM') + kpi('Lượt tìm kiếm', act('search'), '', '', 'gõ ở ô tìm sản phẩm') + '</div></section>';
    // video câu chuyện đồng hành: khách bấm xem ở vị trí nào (bắt đầu đo 18/10/2026)
    var BV_POS = [['bv_hero', 'Nút đầu trang chủ'], ['bv_bubble', 'Bong bóng góc màn hình'], ['bv_story', 'Khối Câu chuyện (giữa trang chủ)'], ['bv_about', 'Trang Giới thiệu']];
    var bvN = BV_POS.reduce(function (s0, x) { return s0 + act(x[0]); }, 0), bvP = BV_POS.reduce(function (s0, x) { return s0 + actp(x[0]); }, 0);
    h += '<section class="section"><div class="section-h"><h2>🎬 Video câu chuyện đồng hành</h2><span class="tip">lượt bấm xem theo vị trí · đo từ 18/10/2026</span></div><div class="box">' +
      barList(BV_POS.map(function (x) { return { l: x[1], v: act(x[0]), sub: (bvN ? pct(act(x[0]), bvN) + '% lượt xem' : '') + (noCmp ? '' : (bvN ? ' · ' : '') + 'kỳ trước ' + actp(x[0])) }; }).sort(function (x, y) { return y.v - x.v; }), String, 'Chưa có lượt xem trong kỳ.', { below: 1 }) +
      '<p class="bar-legend">Tổng ' + bvN + ' lượt xem' + (noCmp ? '' : ' (kỳ trước ' + bvP + ')') + ', khoảng ' + pct(bvN, g.cur.users || 1) + '% người vào web. Chỉ đếm khách đã đồng ý cookie. Vị trí nào gần như không ai bấm thì có thể bỏ cho trang gọn.</p></div></section>';
    // trang
    var trim = function (t) { return String(t || '').replace(/\s*[|–-]\s*Thực Dưỡng Lành.*$/i, '') || '(không tên)'; };
    h += '<div class="dash-grid"><section class="section"><div class="section-h"><h2>📄 Trang xem nhiều</h2></div><div class="box">' + barList(g.pages.map(function (r) { return { l: trim(r[1]), v: r[2], sub: r[0] + ' · ' + r[3] + ' người', tip: r[0] }; }), function (v) { return v.toLocaleString('vi-VN'); }, '', { below: 1 }) + '</div></section>' +
      '<section class="section"><div class="section-h"><h2>🚪 Trang khách vào đầu tiên</h2><span class="tip">% ở lại xem</span></div><div class="box">' + barList(g.land.map(function (r) { var e = pct(r[2], r[1]); return { l: r[0] === '/' ? 'Trang chủ' : r[0], v: r[1], sub: e + '% ở lại xem' + (r[3] ? ' · ' + r[3] + ' đơn' : ''), muted: r[1] >= 20 && e < 40 }; }), function (v) { return v.toLocaleString('vi-VN'); }, '', { below: 1 }) + '<p class="bar-legend">Thanh xám: nhiều người vào nhưng dưới 40% ở lại xem → nên sửa nội dung đầu trang hoặc kiểm tra quảng cáo dẫn về đây.</p></div></section></div>';
    var du = g.dev.reduce(function (s0, r) { return s0 + r[1]; }, 0) || 1;
    h += '<p class="small muted">Thiết bị: ' + g.dev.sort(function (x, y) { return y[1] - x[1]; }).map(function (r) { return (GA_DEV[r[0]] || r[0]) + ' ' + pct(r[1], du) + '%'; }).join(' · ') + '</p>';
    return h;
  }
  /** "Cần chú ý": tối đa 5 dòng tự rút ra từ số liệu, viết như lời nhắc cho người bận. Việc gấp (chậm mục tiêu, quảng cáo lỗ, thiếu số sàn) xếp trước. */
  function dashNotes(T, b, g, p, M, sj, gl) {
    var L = [], G = gl.G, xem = function (go) { return ' ' + (go.charAt(0) === '#' ? '<a class="link small" href="' + go + '">Xem →</a>' : '<button type="button" class="link small" data-dgo="' + go + '">Xem →</button>'); }; // Đợt 2: mỗi dòng có lối đi tới chỗ cần xử lý
    if (G && G.isCur && G.p < 1 && (G.lv === 'bad' || G.lv === 'mid')) L.push((G.lv === 'bad' ? '🔴' : '🟠') + ' <b>Đang chậm mục tiêu tháng.</b> Mỗi ngày cần bán khoảng <b>' + moneyShort(G.perDay) + '</b>, hiện mới bán trung bình ' + moneyShort(Math.round(gl.cur / G.el)) + ' / ngày.');
    if (G && G.p >= 1) L.push('🎉 <b>Đã đạt mục tiêu ' + monthLabel(monthOf(Math.min(perRange(p)[1] - 1, Date.now()))) + '.</b>');
    var nG = L.length; if (nG) L[nG - 1] += xem('#bao-cao');
    if (T.vs.pct !== null && T.vs.n >= 10 && T.vs.pct >= 10) L.push('↩️ <b>Hoàn / huỷ ' + T.vs.pct + '%</b> đơn văn phòng (' + T.vs.v + '/' + T.vs.n + ' đơn), mức tốt là dưới 5%. Xem đơn hoàn gần đây và lý do.' + xem('#don-hang'));
    var lateN = tasksAll().filter(function (c) { return c.task && c.task.late >= 2; }).length;
    if (lateN) L.push('⏳ <b>' + lateN + ' khách trễ hạn chăm sóc</b> từ 2 ngày trở lên.' + xem('#hom-nay'));
    if (M && M.tot) L = L.concat(adsNotes(M.ch, M.E).map(function (x) { return x + xem('mkt'); }));
    if (sj) { var by = sanLatest(sj); Object.keys(by).forEach(function (k) { var o = by[k]; if (o.late > (o.sheet ? 2 : 3)) L.push('⏰ ' + esc(k) + ' đã ' + o.late + (o.sheet ? ' ngày chưa gõ số vào Google Sheet báo cáo' : ' ngày chưa tải file đơn mới') + ', số sàn có thể đang thiếu.' + xem('#san')); }); }
    if (T.revP && CMP_LABEL && p.k !== 'today') { var d = Math.round((T.rev - T.revP) * 100 / T.revP); if (Math.abs(d) >= 10) L.push((d > 0 ? '📈 Doanh số tăng ' : '📉 Doanh số giảm ') + Math.abs(d) + '% so với ' + CMP_LABEL + ' (' + moneyShort(T.rev) + ' so với ' + moneyShort(T.revP) + ').' + xem('day')); }
    var top = Object.keys(b.sub).map(function (k) { return b.sub[k]; }).sort(function (x, y) { return y.v - x.v; })[0];
    if (top && b.rev) L.push('🏅 Kênh văn phòng ra nhiều tiền nhất: <b>' + esc(top.g + ' – ' + top.l) + '</b>, ' + pct(top.v, b.rev) + '% tiền văn phòng.' + xem('chan'));
    if (g) { var bad = g.land.filter(function (r) { return r[1] >= 20 && pct(r[2], r[1]) < 40; })[0]; if (bad) L.push('🌐 Trang <b>' + esc(bad[0] === '/' ? 'Trang chủ' : bad[0]) + '</b> có ' + bad[1] + ' lượt vào nhưng chỉ ' + pct(bad[2], bad[1]) + '% ở lại xem: nên sửa đầu trang.'); }
    return L.length ? '<div class="box dash-notes"><h3>📌 Cần chú ý</h3>' + L.slice(0, 5).map(function (x) { return '<p>' + x + '</p>'; }).join('') + '</div>' : '';
  }
  function bindDash() {
    $$('[data-dash]').forEach(function (el) {
      el.onclick = function () {
        var a = el.getAttribute('data-dash'), f = S.f.g, key = gaKey(perRange(f.p), cmpRange(f.p));
        if (a === 'mkt') { openMkt(); return; }
        if (a === 'sfb') { f.sfb = f.sfb === false; store('dash_sfb', f.sfb ? '1' : '0'); render(); return; }
        if (a === 'fresh') { delete MK.cache[key]; MK.err = ''; delete GA.cache[key]; GA.err = ''; GA.busy = ''; gaFetch(key, true); render(); return; }
        if (a === 'prop') { el.disabled = true; api('ga_prop', { prop: ($('#gaProp') || {}).value || '' }).then(function () { GA.cache = {}; GA.err = ''; toast('Đã lưu mã thuộc tính'); render(); }, function (e) { el.disabled = false; toast(e.message, true); }); }
      };
    });
    // mục chi tiết: nhớ mục đang mở; bấm ô ở màn hình đầu → mở mục tương ứng và cuộn tới
    $$('details[data-dk]').forEach(function (d) {
      d.addEventListener('toggle', function () { var o = S.f.g.open, k = d.getAttribute('data-dk'); if (d.open) o[k] = 1; else delete o[k]; store('dash_open', JSON.stringify(o)); });
    });
    $$('[data-dgo]').forEach(function (el) {
      var go = function () { var d = $('#dm-' + el.getAttribute('data-dgo')); if (!d) return; d.open = true; d.scrollIntoView({ behavior: 'smooth', block: 'start' }); };
      el.onclick = go; el.onkeydown = function (e) { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); go(); } };
    });
  }

  function viewReport() {
    var f = S.f.r || (S.f.r = {}), who = whoF();
    if (!f.p) f.p = { k: 'month' }; // "Mọi lúc": doanh số từ trước tới nay (cả đơn cũ nhập từ file sale)
    var R = perRange(f.p), cx = { p: f.p, R: R, label: perLabel(f.p), month: monthOf(Math.min(R[1] - 1, Date.now())) };
    cx.whole = f.p.k === 'month' || f.p.k === 'lmonth'; // đúng trọn 1 tháng → mục tiêu dùng luôn số trong kỳ
    cx.P = cmpRange(f.p);
    if (f.p.k === 'all') { cx.all = salesAllGet(); if (!cx.all) cx.allNote = S.salesAll ? '' : '<div class="notice">⏳ Đang lấy doanh số từ trước tới nay trên máy chủ…</div>'; else cx.allNote = '<p class="small muted">Mọi lúc: <b>doanh số, số đơn</b> tính đủ mọi đơn từ trước tới nay (cả đơn cũ nhập từ file sale). Các chỉ số khác (chăm sóc, tỷ lệ chốt, khách cũ) tính trên dữ liệu khoảng 13 tháng gần nhất.</p>'; }
    return '<div class="page-head"><h1>Hiệu quả</h1><div class="grow"></div>' + whoSel() + '</div>' + perChips('r', f.p, ['all']) +
      (cx.allNote || '') + (!who ? viewTeam(cx) : who === '-' ? viewNoOwner(cx) : viewPerson(who, cx));
  }
  /** Tổng doanh số từ trước tới nay theo nhân viên bán (hỏi máy chủ, nhớ 10 phút). null = đang tải / máy chủ cũ chưa có. */
  function salesAllGet() {
    var c = S.salesAll;
    if ((!c || Date.now() - c.at > 600e3) && !S.salesAllBusy) {
      S.salesAllBusy = true;
      api('sales_all', {}).then(function (j) { var m = {}; (j.rows || []).forEach(function (r) { m[r.seller] = r; }); S.salesAll = { at: Date.now(), m: m }; }, function () { S.salesAll = { at: Date.now(), m: null }; })
        .then(function () { S.salesAllBusy = false; if (route().view === 'bao-cao') render(); });
    }
    return c && c.m ? c.m : null;
  }
  /** Mọi lúc: thay doanh số / số đơn tính từ dữ liệu đã tải bằng số đủ từ máy chủ. name null = cả nhóm. */
  function salesAllFix(p, name, cx) {
    var m = cx.all; if (!m) return p;
    var n = 0, s = 0; Object.keys(m).forEach(function (k) { if (name === null || k === name) { n += m[k].n; s += m[k].s; } });
    p.orders = n; p.sales = s; p.avg = n ? Math.round(s / n) : 0; return p;
  }

  /* ---------- 📣 Từ quảng cáo: chi phí mỗi số, công ty đã chi cho từng sale, chốt theo sản phẩm, tốc độ gọi lại, ưu đãi đang chạy.
   * Máy chủ tính (lệnh 'sale_mkt', api/src/salemkt.js), nhớ 10 phút. Máy chủ cũ / kỳ "Mọi lúc" → không hiện. */
  function smkGet(name, cx) {
    if (cx.p.k === 'all') return null;
    var from = isoDate(cx.R[0]), to = isoDate(Math.min(cx.R[1], Date.now() + DAY) - 1), k = (name || '') + '|' + from + '|' + to, C = S.smk || (S.smk = {}), c = C[k];
    if ((!c || Date.now() - c.at > 600e3) && !c0busy(k)) {
      S.smkBusy = S.smkBusy || {}; S.smkBusy[k] = 1;
      api('sale_mkt', { from: from, to: to, name: name || '' }).then(function (j) { C[k] = { at: Date.now(), d: j && j.ok ? j : null }; }, function () { C[k] = { at: Date.now(), d: null }; })
        .then(function () { delete S.smkBusy[k]; if (route().view === 'bao-cao') render(); });
    }
    return c ? c.d : undefined;
  }
  function c0busy(k) { return !!(S.smkBusy && S.smkBusy[k]); }
  /** Gọi trong ngày: % số đã liên hệ ngay ngày nhận (bỏ số hôm nay chưa gọi vì còn trong ngày). */
  function smkSpeed(b) { var n = b.same + b.next + b.late + b.none; return n ? pct(b.same, n) : null; }
  function smkSpeedLv(v) { return v === null ? '' : v >= 80 ? 'ok' : v >= 60 ? 'mid' : 'bad'; }
  /** Khung "Công ty đã đầu tư cho bạn": tiền quảng cáo đem về số cho người này, tiền họ mang về từ các số đó, tốc độ gọi lại. */
  function smkInvest(d, b, who, label) {
    if (d === undefined) return '<div class="box smk-inv"><p class="muted">⏳ Đang tính tiền quảng cáo công ty đã chi…</p></div>';
    if (!d || !b || !b.n) return '';
    var me = who === 'bạn', T = d.team, roi = b.cost ? b.rev / b.cost : null, troi = T.roi != null ? T.roi : T.cost ? T.rev / T.cost : null; // sale: máy chủ chỉ gửi tỷ lệ cả nhóm (roi), không gửi tiền
    var lv = roi === null ? '' : adsLv(b.cost, b.rev); // cùng mức đèn quảng cáo ở Tổng quan (chi phí / tiền mang về)
    var sp = smkSpeed(b), tsp = smkSpeed(T), spLv = smkSpeedLv(sp);
    var h = '<div class="box smk-inv ' + lv + '"><h3>💸 ' + (me ? 'Công ty đã đầu tư cho bạn' : b === T ? 'Công ty đã đầu tư cho cả nhóm' : 'Công ty đã đầu tư cho ' + esc(who)) + ' <small class="muted">' + esc(label.toLowerCase()) + '</small></h3>';
    if (b.cost) {
      h += '<div class="smk-big"><b>' + moneyShort(b.cost) + '</b><span>tiền quảng cáo để đem về <b>' + b.n + ' số</b> khách hỏi · mỗi số khoảng <b>' + moneyShort(Math.round(b.cost / b.n)) + '</b></span></div>';
      h += '<p>' + (me ? 'Bạn' : b === T ? 'Cả nhóm' : esc(who)) + ' đã mang về <b>' + moneyShort(b.rev) + '</b> từ các số này' + (roi !== null ? ' → cứ <b>1đ</b> công ty chi, ' + (me ? 'bạn' : 'mang') + ' về <b>' + oneDec(roi) + 'đ</b> ' + (DASH_LV[lv] || '') : '') +
        (troi !== null && b !== T ? ' <small class="muted">(cả nhóm ' + oneDec(troi) + 'đ)</small>' : '') + '.</p>';
      if (me && b.open) h += '<p>Còn <b>' + b.open + ' số</b> chưa có kết quả, tương đương <b>' + moneyShort(Math.round(b.cost / b.n * b.open)) + '</b> công ty đã trả. Gọi lại để không phí tiền nhé!</p>';
    } else h += '<p><b>' + b.n + ' số</b> khách hỏi từ quảng cáo. Chưa có số chi phí quảng cáo trong kỳ (marketing chưa nhập) nên chưa tính được tiền mỗi số.</p>';
    if (sp !== null) h += '<p>📞 Gọi ngay trong ngày nhận số: <b>' + sp + '%</b> ' + (DASH_LV[spLv] || '') + (b !== T && tsp !== null ? ' <small class="muted">(cả nhóm ' + tsp + '%)</small>' : '') + (b.none ? ' · <b class="bad-line">' + b.none + ' số chưa gọi</b>' : '') + '</p>';
    return h + '<button class="link" data-rgo="mkt">Xem theo từng sản phẩm, ưu đãi đang chạy →</button></div>';
  }
  /** Mục chi tiết 📣 Từ quảng cáo: từng sản phẩm (của người này so với cả nhóm), tốc độ gọi lại, ưu đãi đang chạy. */
  function smkDetail(d, b) {
    if (!d) return '<p class="muted">' + (d === undefined ? '⏳ Đang tải…' : 'Chưa có số liệu (máy chủ chưa cập nhật hoặc đang chọn Mọi lúc).') + '</p>';
    var T = d.team, h = '';
    h += '<div class="box"><h3>🎁 Ưu đãi / thông điệp quảng cáo đang chạy</h3>' + offerList(d.offers, false) + '</div>';
    var ks = Object.keys((b || T).prod).sort(function (x, y) { return (b || T).prod[y].n - (b || T).prod[x].n; });
    if (ks.length) h += '<div class="box"><h3>📦 Theo sản phẩm khách hỏi</h3>' + ks.map(function (k) {
      var p = (b || T).prod[k], tp = T.prod[k] || p, c = pct(p.won, p.n), tc = pct(tp.won, tp.n), lv = b && b !== T ? (c >= tc ? 'ok' : c >= tc - 5 ? 'mid' : 'bad') : '';
      return '<div class="smk-prod ' + lv + '"><div class="smk-prod-h"><b>' + esc(k) + '</b><span>' + (DASH_LV[lv] || '') + ' chốt ' + c + '%</span></div><div class="rep-ppl-s">' + p.n + ' số · ' + p.won + ' ra đơn' + (p.junk ? ' · ' + p.junk + ' số rác' : '') +
        (b && b !== T ? ' · cả nhóm chốt ' + tc + '%' : '') + (p.cost ? ' · mỗi số ~' + moneyShort(Math.round(p.cost / p.n)) : '') + '</div></div>';
    }).join('') + '<p class="small muted" style="margin:8px 0 0">Sản phẩm theo cột Nguồn của file số quảng cáo. Chi phí mỗi số: tiền các chiến dịch có tên sản phẩm đó ÷ số khách hỏi sản phẩm đó; chiến dịch không ghi tên sản phẩm chia đều cho mọi số.</p></div>';
    var B = b || T, parts = [['s-same', 'Gọi trong ngày', B.same], ['s-next', 'Hôm sau', B.next], ['s-late', 'Sau 2 ngày trở lên', B.late], ['s-none', 'Chưa gọi', B.none]].filter(function (x) { return x[2]; }), n = B.same + B.next + B.late + B.none;
    if (n) h += '<div class="box rep-fun"><h3>📞 Gọi lại số mới nhanh hay chậm?</h3><div class="rep-fun-bar">' + parts.map(function (x) { return '<i class="' + x[0] + '" style="width:' + (x[2] * 100 / n).toFixed(1) + '%" title="' + x[1] + ': ' + x[2] + '"></i>'; }).join('') + '</div>' +
      '<div class="rep-fun-leg">' + parts.map(function (x) { return '<span class="' + x[0] + '"><u></u>' + x[1] + ' <b>' + x[2] + '</b></span>'; }).join('') + '</div>' +
      '<p>Khách vừa để số còn nhớ quảng cáo, gọi ngay trong ngày chốt dễ hơn nhiều. Tính theo lần đầu có ghi trên CRM (tư vấn, chăm sóc, đổi trạng thái khách hỏi, lên đơn). Gọi mà không ghi thì CRM không biết.' + (B.wait ? ' ' + B.wait + ' số nhận hôm nay chưa gọi chưa tính.' : '') + '</p></div>';
    h += '<p class="small muted">' + (d.spend != null ? 'Chi phí quảng cáo: tổng ' + moneyShort(d.spend) + ' cho ' + d.n + ' số khách hỏi cả công ty (mỗi số ~' + moneyShort(d.cpl) + '), ' : 'Chi phí quảng cáo tính cho các số giao cho bạn, ') + 'không tính quảng cáo trên sàn và KOL. Cập nhật khoảng 30 phút một lần.</p>';
    return h;
  }
  /* ---------- Ưu đãi đang chạy: Marketing / Quản trị ghi ở tab Marketing, sale xem ở Khách hỏi và Hiệu quả */
  function offerList(L, edit) {
    L = L || []; var t0 = isoDate(Date.now());
    if (!L.length) return '<p class="muted">' + (edit ? 'Chưa có ưu đãi nào. Bấm ＋ để thêm, sale sẽ thấy ngay ở tab Khách hỏi.' : 'Marketing chưa ghi ưu đãi nào.') + '</p>';
    return L.map(function (o) {
      var old = o.until && o.until < t0;
      return '<div class="offer-card' + (old ? ' old' : '') + '"><div class="offer-h"><b>🎁 ' + esc(o.title) + '</b>' + (o.prod ? '<span class="tag">' + esc(o.prod) + '</span>' : '') + '</div>' +
        (o.text ? '<p>' + esc(o.text).replace(/\n/g, '<br>') + '</p>' : '') +
        '<small class="muted">' + (o.until ? (old ? 'Đã hết hạn ' : 'Đến hết ') + o.until.split('-').reverse().join('/') : 'Không ghi hạn') + (o.by ? ' · ' + esc(o.by) : '') + '</small>' +
        (edit ? ' <button class="link" data-offer="' + esc(o.id) + '">Sửa</button>' : '') + '</div>';
    }).join('');
  }
  function offersGet() {
    var c = S.offers;
    if ((!c || Date.now() - c.at > 600e3) && !S.offersBusy) {
      S.offersBusy = true;
      api('offers', {}).then(function (j) { S.offers = { at: Date.now(), list: j && j.ok ? j.list : null }; }, function () { S.offers = { at: Date.now(), list: null }; })
        .then(function () { S.offersBusy = false; var v = route().view; if ((v === 'tiem-nang' || v === 'marketing') && !$('.modal')) render(); });
    }
    return c ? c.list : undefined;
  }
  /** Khối ưu đãi đầu tab Khách hỏi (thu gọn, chỉ hiện khi có ưu đãi còn hạn). */
  function offerBanner() {
    var L = offersGet(); if (!L) return ''; var t0 = isoDate(Date.now()); L = L.filter(function (o) { return !o.until || o.until >= t0; });
    if (!L.length) return '';
    return '<details class="dash-more offer-bn"><summary><b>🎁 ' + L.length + ' ưu đãi đang chạy</b><span>' + esc(L.map(function (o) { return o.title; }).join(' · ')) + '</span></summary><div class="dash-more-b">' + offerList(L, false) + '</div></details>';
  }
  /** Khối quản lý ưu đãi ở tab Marketing. */
  function offerAdmin() {
    if (!isMkt() && lvl() < 3) return '';
    var L = offersGet();
    return '<div class="box"><div class="offer-h"><h3 style="margin:0">🎁 Ưu đãi / thông điệp đang chạy <small class="muted">(sale xem ở tab Khách hỏi)</small></h3><button class="btn sm pri" data-offer="new">＋ Thêm</button></div>' +
      (L === undefined ? '<p class="muted">⏳ Đang tải…</p>' : L === null ? '<p class="muted">⚠️ Chưa tải được (máy chủ chưa cập nhật?).</p>' : offerList(L, true)) + '</div>';
  }
  function offerEdit(id) {
    var o = id === 'new' ? {} : ((S.offers && S.offers.list) || []).filter(function (x) { return x.id === id; })[0] || {};
    var body = '<div class="box"><label class="f"><span>Tên ưu đãi / thông điệp (khách đã thấy trên quảng cáo)</span><input type="text" id="ofT" maxlength="120" value="' + esc(o.title || '') + '" placeholder="vd Mua 2 tặng 1 Gafo Fucoidan"></label>' +
      '<label class="f"><span>Sản phẩm</span><input type="text" id="ofP" maxlength="60" value="' + esc(o.prod || '') + '" placeholder="vd Gafo Fucoidan"></label>' +
      '<label class="f"><span>Nội dung sale cần nói đúng (giá, quà, điều kiện, câu quảng cáo chính)</span><textarea id="ofX" rows="5" maxlength="800">' + esc(o.text || '') + '</textarea></label>' +
      '<label class="f"><span>Áp dụng đến hết ngày (bỏ trống = chưa có hạn)</span><input type="date" id="ofU" value="' + esc(o.until || '') + '"></label><p class="err" id="ofE"></p></div>';
    var m = modal(id === 'new' ? '🎁 Thêm ưu đãi' : '🎁 Sửa ưu đãi', body, (id !== 'new' ? '<button class="btn ghost" id="ofDel">Xoá</button>' : '') + '<button class="btn" data-close>Huỷ</button><button class="btn pri" id="ofSave">Lưu</button>');
    var done = function (j) { S.offers = { at: Date.now(), list: j.list }; closeModal(); toast('Đã lưu'); render(); }, fail = function (e) { $('#ofE', m).textContent = e.message; };
    $('#ofSave', m).onclick = function () { api('offer_save', { id: o.id || '', title: $('#ofT', m).value, prod: $('#ofP', m).value, text: $('#ofX', m).value, until: $('#ofU', m).value }).then(done, fail); };
    if ($('#ofDel', m)) $('#ofDel', m).onclick = function () { if (confirm('Xoá ưu đãi này?')) api('offer_del', { id: o.id }).then(done, fail); };
  }

  /* Hiệu quả của 1 sale, viết cho người không rành công nghệ: màn hình đầu chỉ có mục tiêu tháng, 4 ô lớn có đèn 🟢🟠🔴 (so với chính mình kỳ trước),
   * thanh "10 khách hỏi thì đi đâu" và tối đa 5 việc nên làm ngay. Số liệu chi tiết (xu hướng, chăm sóc, lý do, tỉnh) thu gọn, bấm mới mở; mục đang mở nhớ trên máy (localStorage rep_open). */
  /** Đèn cho tỷ lệ %: bằng / tăng = xanh, giảm dưới 3 điểm = cam, giảm từ 3 điểm = đỏ. */
  function repRateLv(cur, prev) { if (!CMP_LABEL || cur === null || prev === null || prev === undefined) return ''; var d = cur - prev; return d >= 0 ? 'ok' : d > -3 ? 'mid' : 'bad'; }
  function repMore(k, title, line, body) {
    var o = S.f.r.open || (S.f.r.open = (function () { try { return JSON.parse(store('rep_open') || '{}') || {}; } catch (e) { return {}; } })());
    return '<details class="dash-more" data-rk="' + k + '" id="rm-' + k + '"' + (o[k] ? ' open' : '') + '><summary><b>' + title + '</b><span>' + line + '</span></summary><div class="dash-more-b">' + body + '</div></details>';
  }
  /** Data quảng cáo trong kỳ đi về đâu: 1 thanh chia màu (đã mua / đang tư vấn / không mua / số rác). */
  function repFunnel(c, who) {
    if (!c.data) return '';
    var parts = [['won', '✅ Đã mua', c.won], ['open', '⏳ Đang tư vấn', c.pending], ['lost', '❌ Không mua', c.lost], ['junk', '🗑 Số rác', c.junk]].filter(function (x) { return x[2]; });
    var per10 = Math.round(c.won * 10 / c.data);
    return '<div class="box rep-fun"><h3>📞 ' + c.data + ' khách hỏi từ quảng cáo đi về đâu?</h3><div class="rep-fun-bar">' +
      parts.map(function (x) { return '<i class="' + x[0] + '" style="width:' + (x[2] * 100 / c.data).toFixed(1) + '%" title="' + x[1] + ': ' + x[2] + '"></i>'; }).join('') + '</div>' +
      '<div class="rep-fun-leg">' + parts.map(function (x) { return '<span class="' + x[0] + '"><u></u>' + x[1] + ' <b>' + x[2] + '</b></span>'; }).join('') + '</div>' +
      '<p>Cứ <b>10</b> khách hỏi thì ' + esc(who) + ' chốt được <b>' + per10 + '</b> khách.' + (c.pending ? ' Còn <b>' + c.pending + '</b> khách đang tư vấn, gọi lại sớm để chốt thêm. <a href="#tiem-nang">Mở Khách hỏi →</a>' : '') + '</p></div>';
  }
  /** Tối đa 5 việc nên làm ngay, việc gấp lên trước. Chỉ dựa trên số liệu đã có trên máy. */
  function repTodo(c, p, me, mb) {
    var L = [], you = me ? 'bạn' : '';
    if (mb && mb.none) L.push({ p: 0, t: '📵 <b>' + mb.none + ' số quảng cáo</b> nhận từ hôm qua trở về trước chưa gọi lần nào' + (mb.cost && mb.n ? ' (công ty đã trả ~' + moneyShort(Math.round(mb.cost / mb.n * mb.none)) + ')' : '') + '. Gọi ngay hôm nay.', a: '<a class="btn sm pri" href="#tiem-nang">Gọi</a>' });
    if (c.pending) L.push({ p: 1, t: '⏳ <b>' + c.pending + ' khách hỏi</b> đang tư vấn chưa chốt. Gọi lại ngay hôm nay.', a: '<a class="btn sm pri" href="#tiem-nang">Gọi</a>' });
    if (c.vipRisk) L.push({ p: 1, t: '💎 <b>' + c.vipRisk + ' khách VIP</b> lâu chưa mua, hơn 30 ngày chưa ai gọi. Gọi hỏi thăm trước tiên.', a: me ? '<a class="btn sm pri" href="#khach-hang" data-vipgo="1">Xem</a>' : '' });
    if (c.stale) L.push({ p: 2, t: '📵 <b>' + c.stale + ' khách</b> ' + you + ' phụ trách đã hơn 30 ngày chưa nói chuyện. Mỗi ngày gọi vài người.', a: me ? '<a class="btn sm" href="#hom-nay">Hôm nay</a>' : '' });
    if (c.closePct !== null && p.closePct !== null && c.closePct < p.closePct - 2) L.push({ p: 2, t: '📉 Chốt được ' + c.closePct + '%, thấp hơn ' + CMP_LABEL + ' (' + p.closePct + '%). Xem khách hay từ chối vì sao để chuẩn bị câu trả lời.', a: '<button class="btn sm" data-rgo="why">Xem lý do</button>' });
    if (c.orders >= 3 && p.orders && c.avg < p.avg * 0.9) L.push({ p: 3, t: '🛒 Mỗi đơn đang nhỏ hơn ' + CMP_LABEL + ' (' + moneyShort(c.avg) + ' so với ' + moneyShort(p.avg) + '). Gợi ý khách mua combo hoặc 2–3 hộp.' });
    if (c.backPct !== null && c.backPct >= 10 && c.backN >= 2) L.push({ p: 2, t: '📦 ' + c.backN + ' đơn bị hoàn (' + c.backPct + '%). Gọi xác nhận kỹ trước khi gửi, đơn lớn nhờ khách chuyển khoản trước.' });
    if (c.care && c.replyPct !== null && c.replyPct < 40) L.push({ p: 3, t: '☎️ Chỉ ' + c.replyPct + '% lượt gọi có khách nghe máy. Thử gọi giờ khác (12h–13h, sau 19h) hoặc nhắn Zalo trước.' });
    L.sort(function (x, y) { return x.p - y.p; });
    var body = L.length ? L.slice(0, 5).map(function (x) { return '<div class="rep-todo-r"><span>' + x.t + '</span>' + (x.a || '') + '</div>'; }).join('') : '<div class="rep-todo-r"><span>🎉 Mọi thứ đang ổn. Giữ nhịp chăm sóc khách cũ mỗi ngày nhé!</span></div>';
    return '<div class="box rep-todo"><h3>👉 Việc nên làm ngay</h3>' + body + '</div>';
  }
  /** 3 ô tiền của tab Hiệu quả (26/10/2026): 💰 Doanh số GỒM hoàn / huỷ · 💵 Doanh thu đã thu · ↩️ Hoàn / huỷ. Mục tiêu vẫn tính trên doanh số trừ hoàn / huỷ (c.sales).
   *  Mọi lúc (cx.all): máy chủ chỉ có doanh số trừ hoàn / huỷ → ô Doanh số hiện số đó. */
  function repMoneyTiles(c, p, G, cx, K) {
    var g = cx.all ? c.sales : c.gross, vlv = c.vPct === null ? '' : c.vPct < 5 ? 'ok' : c.vPct < 10 ? 'mid' : 'bad';
    return dashTile('rtrend', cx.whole && G && G.isCur ? G.lv : dashTrend(g, cx.all ? p.sales : p.gross), '💰 Doanh số', moneyShort(g), cx.all ? '' : delta(c.gross, p.gross),
        cx.all ? c.orders + ' đơn (Mọi lúc: chưa gồm hoàn / huỷ)' : c.grossN + ' đơn, gồm ' + c.vN + ' đơn hoàn / huỷ' + (c.vN ? '<br>🎯 Tính mục tiêu (trừ hoàn / huỷ): ' + moneyShort(c.sales) : ''), cx.all ? K.sales : K.gross) +
      dashTile('rtrend', dashTrend(c.paid, p.paid), '💵 Doanh thu', moneyShort(c.paid), delta(c.paid, p.paid), 'Tiền đơn đã giao hoặc đã nhận chuyển khoản' + (c.sales > c.paid ? ' · còn ' + moneyShort(c.sales - c.paid) + ' đang giao / chờ thu' : ''), K.paid) +
      dashTile('rtrend', vlv, '↩️ Hoàn / huỷ', c.vPct === null ? '–' : c.vPct + '%', c.vPct !== null && p.vPct !== null ? inv(delta(c.vPct, p.vPct, 'rate')) : '',
        c.grossN ? c.vN + ' / ' + c.grossN + ' đơn · ' + moneyShort(c.vV) + ' · dưới 5% là tốt' : 'Chưa có đơn trong kỳ', K.vd);
  }
  function viewPerson(name, cx) {
    var month = cx.month, c = salesAllFix(perf(name, cx.R), name, cx), p = perf(name, cx.P), me = name === S.user.name;
    var ms = cx.whole ? c.sales : perf(name, monthRange(month)).sales, t = targetOf(name, month), G = t && t.amount ? goalCalc(ms, t.amount, month) : null;
    var h = (lvl() >= 2 && !me ? '<button class="btn ghost" data-who="team" style="margin-bottom:10px">← Quay lại cả nhóm</button>' : '') +
      targetBlock(name, month, ms, me || lvl() >= 2);
    var per10 = c.data ? Math.round(c.won * 10 / c.data) : null, mk = smkGet(me && lvl() < 2 ? '' : name, cx), K = repSparks(name, cx);
    h += '<section class="dash-hero"><div class="dash-tiles dt6">' + repMoneyTiles(c, p, G, cx, K) +
      dashTile('why', repRateLv(c.closePct, p.closePct), '🎯 Chốt được', c.closePct === null ? '–' : c.closePct + '%', c.closePct === null ? '' : delta(c.closePct, p.closePct, 'rate'), c.data ? 'Cứ 10 khách hỏi chốt ' + per10 + ' khách' : 'Chưa có khách hỏi từ quảng cáo', K.close) +
      dashTile('rtrend', c.orders && p.orders ? dashTrend(c.avg, p.avg) : '', '🛒 Mỗi đơn', c.orders ? moneyShort(c.avg) : '–', c.orders ? delta(c.avg, p.orders ? p.avg : 0) : '', 'Bán combo, 2–3 hộp thì số này tăng', K.avg) +
      dashTile('care', c.sales ? repRateLv(c.oldPct, p.sales ? p.oldPct : null) : '', '🔁 Khách cũ mua lại', c.repeat + ' khách', delta(c.repeat, p.repeat), c.sales ? moneyShort(c.oldRev) + ' = ' + c.oldPct + '% doanh số' : 'Chăm sóc tốt thì số này tăng', K.repeat) +
      '</div>' + smkInvest(mk, mk && mk.me, me ? 'bạn' : name, cx.label) + repFunnel(c, me ? 'bạn' : name) + repTodo(c, p, me, mk && mk.me) + '</section>' + refBox(c, p, name);
    h += '<div class="steps" style="margin:0 0 16px"><button class="btn pri" data-daily="' + esc(name) + '">📋 Báo cáo ngày (gửi Zalo)</button><button class="btn" data-bcdt="' + esc(name) + '|' + month + '">📊 Bảng BCDT ' + monthLabel(month) + '</button>' + (lvl() >= 3 && !me ? '<button class="btn" data-usage="' + esc(name) + '">📈 Mức dùng CRM</button>' : '') + '</div>';
    h += '<h2 class="dash-more-h">Xem chi tiết <small class="muted">(bấm để mở)</small></h2>';
    h += repMore('rtrend', '📈 Bán hàng theo ngày', 'Doanh số, số đơn, lượt chăm sóc từng ngày, so với ' + (CMP_LABEL || 'kỳ trước'), repTrend(name, cx));
    h += smkMore(mk, mk && mk.me);
    h += repMore('care', '💬 Chăm sóc khách', c.care + ' lượt' + (c.replyPct === null ? '' : ' · ' + c.replyPct + '% khách nghe máy') + (c.convPct === null ? '' : ' · ' + c.convPct + '% chăm sóc ra đơn'), careMetrics(c, p, me, name, cx.R));
    var why = whyBlock(name, cx), wt = (why.match(/<span class="bar-l" role="cell">([^<]*)</) || [])[1];
    h += repMore('why', '🙅 Vì sao khách chưa mua', wt ? 'Nhiều nhất: ' + wt : 'Ghi lý do khi chăm sóc để máy gom', why);
    var geo = geoBlock(name, cx), gt = (geo.match(/Nhiều nhất: <b>([^<]*)</) || [])[1];
    h += repMore('geo', '📍 Khách ở tỉnh nào', gt ? 'Nhiều nhất: ' + gt : 'Chưa có địa chỉ', geo);
    h += '<p class="small muted">🟢 tốt hơn / bằng ' + (CMP_LABEL || 'kỳ trước') + ' · 🟠 giảm nhẹ · 🔴 giảm nhiều. Doanh số tính theo “Nhân viên bán” ghi trên từng đơn; đơn khách tự đặt trên web tính cho người đang phụ trách khách đó.</p>';
    return h;
  }
  function smkMore(d, b) {
    if (d === null) return '';
    var B = d && (b || d.team);
    return repMore('mkt', '📣 Từ quảng cáo', !d ? '⏳ đang tải…' : (B ? B.n + ' số' + (B.cost ? ' · công ty chi ' + moneyShort(B.cost) : '') + (smkSpeed(B) !== null ? ' · gọi trong ngày ' + smkSpeed(B) + '%' : '') : 'chưa có số') + ' · ưu đãi đang chạy', smkDetail(d, b));
  }
  function bindRep() {
    $$('details[data-rk]').forEach(function (d) {
      d.addEventListener('toggle', function () { var o = S.f.r.open || (S.f.r.open = {}), k = d.getAttribute('data-rk'); if (d.open) o[k] = 1; else delete o[k]; store('rep_open', JSON.stringify(o)); });
    });
    $$('#view [data-dgo], #view [data-rgo]').forEach(function (el) {
      el.onclick = function () { var d = $('#rm-' + (el.getAttribute('data-dgo') || el.getAttribute('data-rgo'))); if (!d) return; d.open = true; d.scrollIntoView({ behavior: 'smooth', block: 'start' }); };
    });
  }

  /* Hiệu quả cả nhóm cho quản lý: mục tiêu nhóm → 4 ô lớn có đèn → bảng từng người (đèn tiến độ, huy chương, điểm cần kèm) → việc quản lý nên làm.
   * Biểu đồ so sánh, xu hướng, chăm sóc, lý do, tỉnh: thu gọn (repMore), bấm mới mở. */
  /** Điểm cần kèm của 1 người, so với cả nhóm (t = perf(null)). Trả tối đa 2 dòng, việc ảnh hưởng tiền nhiều lên trước. */
  function repWeak(r, t, careAvg) {
    var w = [];
    if (r.mk && r.mk.none >= 3) w.push('📵 ' + r.mk.none + ' số quảng cáo chưa gọi');
    var sp0 = r.mk ? smkSpeed(r.mk) : null; if (sp0 !== null && r.mk.n >= 10 && sp0 < 60) w.push('📞 gọi chậm (' + sp0 + '% trong ngày)');
    if (r.pending >= 5) w.push('⏳ ' + r.pending + ' khách hỏi đang chờ gọi lại');
    if (r.closePct !== null && t.closePct !== null && r.data >= 10 && r.closePct < t.closePct - 3) w.push('🎯 chốt ' + r.closePct + '%, nhóm ' + t.closePct + '%');
    if (r.orders >= 3 && t.avg && r.avg < t.avg * 0.8) w.push('🛒 đơn nhỏ (' + moneyShort(r.avg) + ', nhóm ' + moneyShort(t.avg) + ')');
    if (careAvg >= 10 && r.care < careAvg * 0.5) w.push('💬 ít chăm sóc (' + r.care + ' lượt, TB nhóm ' + Math.round(careAvg) + ')');
    if (r.vipRisk) w.push('💎 ' + r.vipRisk + ' khách VIP chưa gọi');
    if (r.backPct !== null && r.backPct >= 10 && r.backN >= 2) w.push('📦 hoàn ' + r.backPct + '%');
    return w.slice(0, 2);
  }
  function repPeople(rows, t, cx) {
    var careAvg = rows.length ? rows.reduce(function (s0, r) { return s0 + r.care; }, 0) / rows.length : 0, M = ['🥇', '🥈', '🥉'], PB = trendBuckets(cx.R);
    return '<div class="box rep-ppl"><h3>👥 Từng nhân viên <small class="muted">(bấm vào tên để xem chi tiết, đặt mục tiêu)</small></h3>' + (rows.length ? rows.map(function (r, i) {
      var g = r.t && r.t.amount ? goalCalc(r.ms, r.t.amount, cx.month) : null, lv = g && g.isCur ? g.lv : dashTrend(r.sales, r.prev.sales), wk = repWeak(r, t, careAvg);
      return '<div class="rep-ppl-r ' + (lv || '') + '" role="button" tabindex="0" data-who="' + esc(r.n) + '">' +
        '<div class="rep-ppl-h"><b>' + (r.sales && i < 3 ? M[i] + ' ' : '') + esc(r.n) + '</b><span>' + sparkSvg(repSeries(r.n, PB, 0, 'sales'), PB.partial) + ' ' + (DASH_LV[lv] || '') + ' ' + moneyShort(r.sales) + '</span></div>' +
        (g ? '<div class="bar sm"><i style="width:' + Math.min(100, g.p * 100).toFixed(1) + '%"></i>' + (g.isCur ? '<u style="left:' + (g.tp * 100).toFixed(1) + '%"></u>' : '') + '</div><div class="rep-ppl-s">🎯 ' + Math.round(g.p * 100) + '% mục tiêu ' + moneyShort(r.t.amount) + (g.isCur ? ' · ' + GOAL_LV[g.lv] : '') + '</div>' : '<div class="rep-ppl-s warn">🎯 Chưa đặt mục tiêu ' + monthLabel(cx.month) + '</div>') +
        (r.mk && r.mk.n ? '<div class="rep-ppl-s">📣 ' + r.mk.n + ' số' + (r.mk.cost ? ' · công ty chi ' + moneyShort(r.mk.cost) + ' → mang về ' + moneyShort(r.mk.rev) : '') + (smkSpeed(r.mk) !== null ? ' · gọi trong ngày ' + smkSpeed(r.mk) + '%' : '') + '</div>' : '') +
        '<div class="rep-ppl-s">' + r.orders + ' đơn · chốt ' + (r.closePct === null ? '–' : r.closePct + '%') + ' · mỗi đơn ' + (r.orders ? moneyShort(r.avg) : '–') + ' · 💬 ' + r.care + ' lượt</div>' +
        (wk.length ? '<div class="rep-ppl-w">Cần kèm: ' + wk.join(' · ') + '</div>' : (r.orders ? '<div class="rep-ppl-ok">👍 Đang ổn</div>' : '')) + '</div>';
    }).join('') : '<p class="muted">Chưa có nhân viên nào.</p>') + '</div>';
  }
  /** Việc quản lý nên làm ngay: tối đa 5 dòng, gấp lên trước. */
  function repMgrTodo(rows, t, cx, noSeller) {
    var L = [], nm = function (a) { return a.map(function (r) { return '<button class="link" data-who="' + esc(r.n) + '">' + esc(r.n) + '</button>'; }).join(', '); };
    var slow = rows.filter(function (r) { var g = r.t && r.t.amount ? goalCalc(r.ms, r.t.amount, cx.month) : null; return g && g.isCur && g.lv === 'bad'; });
    if (slow.length) L.push({ p: 1, t: '🔴 Đang chậm mục tiêu: ' + nm(slow) + '. Ngồi cùng xem khách đang tư vấn và khách cũ sắp hết hàng.' });
    var pend = rows.filter(function (r) { return r.pending >= 5; }).sort(function (a, b) { return b.pending - a.pending; });
    if (t.pending >= 5) L.push({ p: 1, t: '⏳ Cả nhóm còn <b>' + t.pending + ' khách hỏi</b> đang tư vấn chưa chốt' + (pend.length ? ' (nhiều nhất: ' + nm(pend.slice(0, 2)) + ')' : '') + '. Nhắc gọi lại trong ngày.' });
    var nc = rows.filter(function (r) { return r.mk && r.mk.none; }).sort(function (a, b) { return b.mk.none - a.mk.none; }), ncN = nc.reduce(function (s0, r) { return s0 + r.mk.none; }, 0);
    if (ncN) L.push({ p: 0, t: '📵 <b>' + ncN + ' số quảng cáo</b> từ hôm qua trở về trước chưa ai gọi (' + nc.slice(0, 3).map(function (r) { return '<button class="link" data-who="' + esc(r.n) + '">' + esc(r.n) + '</button> ' + r.mk.none; }).join(', ') + '). Tiền quảng cáo đang bị bỏ phí.' });
    var vip = rows.filter(function (r) { return r.vipRisk; });
    if (t.vipRisk) L.push({ p: 2, t: '💎 <b>' + t.vipRisk + ' khách VIP</b> lâu chưa mua, chưa ai gọi' + (vip.length ? ' (' + nm(vip) + ')' : '') + '.' });
    if (noSeller.n) L.push({ p: 2, t: '🧾 <b>' + noSeller.n + ' đơn</b> (' + moneyShort(noSeller.v) + ') chưa có nhân viên bán, doanh số chưa tính cho ai.', a: '<button class="btn sm" data-who="-">Gán</button>' });
    var low = rows.filter(function (r) { return r.closePct !== null && t.closePct !== null && r.data >= 10 && r.closePct < t.closePct - 3; });
    if (low.length) L.push({ p: 2, t: '🎯 Chốt thấp hơn nhóm (' + t.closePct + '%): ' + nm(low) + '. Nghe lại vài cuộc gọi, xem lý do khách từ chối.', a: '<button class="btn sm" data-rgo="why">Lý do</button>' });
    var noT = rows.filter(function (r) { return !(r.t && r.t.amount); });
    if (noT.length && cx.month === monthOf(Date.now())) L.push({ p: 3, t: '🎯 Chưa đặt mục tiêu ' + monthLabel(cx.month) + ': ' + nm(noT) + '.' });
    if (t.backPct !== null && t.backPct >= 10 && t.backN >= 3) L.push({ p: 3, t: '📦 Tỷ lệ hoàn đơn ' + t.backPct + '% (' + t.backN + ' đơn, ' + moneyShort(t.backV) + '). Nhắc gọi xác nhận trước khi gửi.' });
    L.sort(function (x, y) { return x.p - y.p; });
    return '<div class="box rep-todo"><h3>👉 Quản lý nên làm ngay</h3>' + (L.length ? L.slice(0, 5).map(function (x) { return '<div class="rep-todo-r"><span>' + x.t + '</span>' + (x.a || '') + '</div>'; }).join('') : '<div class="rep-todo-r"><span>🎉 Cả nhóm đang ổn. Khen người dẫn đầu và giữ nhịp nhé!</span></div>') + '</div>';
  }
  /** Lý do khách hỏi không mua (chọn khi chốt "Không mua"), cả nhóm. */
  function teamLostBlock(R) {
    var reasons = {}, lostN = 0;
    (S.d.leads || []).forEach(function (l) { if (l.status === 'Không mua' && l.lastAt >= R[0] && l.lastAt < R[1]) { var r = l.reason || 'Không ghi'; reasons[r] = (reasons[r] || 0) + 1; lostN++; } });
    var rk = Object.keys(reasons).sort(function (a, b) { return reasons[b] - reasons[a]; });
    return rk.length ? '<section class="section"><div class="section-h"><h2>Khách hỏi chọn “Không mua” vì</h2></div><div class="box">' + rk.map(function (r) { return '<div class="reason"><span>' + esc(r) + '</span><b>' + reasons[r] + '</b><div class="bar sm"><i style="width:' + pct(reasons[r], lostN) + '%"></i></div></div>'; }).join('') + '</div></section>' : '';
  }
  function viewTeam(cx) {
    var month = cx.month, R = cx.R, all = salesAllFix(perf(null, R), null, cx), prev = perf(null, cx.P), tt = teamTarget(month);
    var names = staffNames(); S.d.orders.forEach(function (o) { if (o.seller && names.indexOf(o.seller) < 0 && !isAdminName(o.seller)) names.push(o.seller); }); // không tính tài khoản Quản trị
    var act = staffNames(), rows = names.map(function (n) { var p = salesAllFix(perf(n, R), n, cx); p.n = n; p.prev = perf(n, cx.P); p.t = targetOf(n, month); p.ms = cx.whole ? p.sales : perf(n, monthRange(month)).sales; return p; }).filter(function (p) { return act.indexOf(p.n) >= 0 || p.orders > 0; }).sort(function (a, b) { return b.sales - a.sales; });
    var ns = S.d.orders.filter(function (o) { return !isVoid(o.status) && o.time >= R[0] && o.time < R[1] && !o.seller; }), noSeller = { n: ns.length, v: ns.reduce(function (s0, o) { return s0 + o.total; }, 0) };
    var ms = cx.whole ? all.sales : perf(null, monthRange(month)).sales, G = tt ? goalCalc(ms, tt, month) : null, mk = smkGet('', cx), K = repSparks(null, cx);
    rows.forEach(function (r) { r.mk = mk && mk.people ? mk.people[r.n] || null : null; });
    var h = targetBlockTeam(ms, tt, month);
    h += '<section class="dash-hero"><div class="dash-tiles dt6">' + repMoneyTiles(all, prev, G, cx, K) +
      dashTile('cmp', repRateLv(all.closePct, prev.closePct), '🎯 Chốt được', all.closePct === null ? '–' : all.closePct + '%', all.closePct === null ? '' : delta(all.closePct, prev.closePct, 'rate'), all.data ? 'Cứ 10 khách hỏi chốt ' + Math.round(all.won * 10 / all.data) + ' khách' : 'Chưa có khách hỏi từ quảng cáo', K.close) +
      dashTile('cmp', all.orders && prev.orders ? dashTrend(all.avg, prev.avg) : '', '🛒 Mỗi đơn', all.orders ? moneyShort(all.avg) : '–', all.orders ? delta(all.avg, prev.orders ? prev.avg : 0) : '', 'Tiền trung bình 1 đơn', K.avg) +
      dashTile('care', all.sales ? repRateLv(all.oldPct, prev.sales ? prev.oldPct : null) : '', '🔁 Khách cũ mua lại', all.repeat + ' khách', delta(all.repeat, prev.repeat), all.sales ? moneyShort(all.oldRev) + ' = ' + all.oldPct + '% doanh số' : 'Chăm sóc tốt thì số này tăng', K.repeat) +
      '</div>' + smkInvest(mk, mk && mk.team, 'cả nhóm', cx.label) + repFunnel(all, 'cả nhóm') + repMgrTodo(rows, all, cx, noSeller) + teamBlock() /* Đợt 2: tiến độ hôm nay (việc trễ, đơn chưa xác nhận…) ngay trong Hiệu quả, quản lý không phải sang tab Hôm nay */ + repPeople(rows, all, cx) + '</section>' + refBox(all, prev, '');
    h += '<div class="steps" style="margin:0 0 16px"><button class="btn pri" data-daily="">📋 Báo cáo ngày (gửi Zalo)</button><button class="btn" data-bcdt="|' + month + '">📊 Bảng BCDT cả nhóm ' + monthLabel(month) + '</button>' + (lvl() >= 3 ? '<button class="btn" data-usage="">📈 Mức dùng CRM</button>' : '') + '</div>';
    h += '<h2 class="dash-more-h">Xem chi tiết <small class="muted">(bấm để mở)</small></h2>';
    var lead = rows[0] && rows[0].sales ? rows[0] : null;
    h += rows.length >= 2 ? repMore('cmp', '📊 So sánh nhân viên', 'Xếp hạng theo doanh số, số đơn, tỷ lệ chốt, % mục tiêu…' + (lead ? ' · dẫn đầu: ' + esc(lead.n) : ''), compareBlock(rows, cx)) : '';
    h += repMore('rtrend', '📈 Bán hàng theo ngày', 'Doanh số, số đơn, lượt chăm sóc từng ngày, so với ' + (CMP_LABEL || 'kỳ trước'), repTrend(null, cx));
    h += smkMore(mk, null);
    h += repMore('care', '💬 Chăm sóc khách', all.care + ' lượt' + (all.replyPct === null ? '' : ' · ' + all.replyPct + '% khách nghe máy') + (all.convPct === null ? '' : ' · ' + all.convPct + '% chăm sóc ra đơn'), careMetrics(all, prev, false, null, cx.R));
    var why = whyBlock(null, cx), wt = (why.match(/<span class="bar-l" role="cell">([^<]*)</) || [])[1];
    h += repMore('why', '🙅 Vì sao khách chưa mua', wt ? 'Nhiều nhất: ' + wt : 'Ghi lý do khi chăm sóc để máy gom', why + teamLostBlock(R));
    var geo = geoBlock(null, cx), gt = (geo.match(/Nhiều nhất: <b>([^<]*)</) || [])[1];
    h += repMore('geo', '📍 Khách ở tỉnh nào', gt ? 'Nhiều nhất: ' + gt : 'Chưa có địa chỉ', geo);
    h += '<p class="small muted">🟢 đúng tiến độ mục tiêu / tốt hơn ' + (CMP_LABEL || 'kỳ trước') + ' · 🟠 hơi chậm / giảm nhẹ · 🔴 đang chậm / giảm nhiều. 🥇🥈🥉 xếp theo doanh số trong kỳ đang chọn.</p>';
    return h;
  }
  /** Biểu đồ so sánh nhân viên: chọn 1 chỉ số, mỗi người 1 thanh (xếp từ cao xuống), vạch đậm = trung bình nhóm, bấm vào thanh để xem chi tiết người đó. */
  var CMP = {
    sales: ['Doanh số', function (r) { return r.sales; }, moneyShort, function (r) { return r.orders + ' đơn'; }],
    orders: ['Số đơn', function (r) { return r.orders; }, String, function (r) { return r.orders ? 'TB ' + moneyShort(r.avg) : ''; }],
    avg: ['TB / đơn', function (r) { return r.orders ? r.avg : null; }, moneyShort, function (r) { return r.orders + ' đơn'; }],
    close: ['Tỷ lệ chốt', function (r) { return r.closePct; }, function (v) { return v + '%'; }, function (r) { return r.won + ' / ' + r.data + ' data quảng cáo'; }],
    target: ['% mục tiêu', function (r) { return r.t && r.t.amount ? Math.round(r.ms * 100 / r.t.amount) : null; }, function (v) { return v + '%'; }, function (r) { return r.t && r.t.amount ? moneyShort(r.ms) + ' / ' + moneyShort(r.t.amount) : 'chưa đặt mục tiêu'; }],
    care: ['Lượt chăm sóc', function (r) { return r.care; }, String, function (r) { return r.reorder + ' đặt lại'; }],
    conv: ['Chăm sóc ra đơn', function (r) { return r.convPct; }, function (v) { return v + '%'; }, function (r) { return r.conv + ' / ' + r.contacted + ' khách'; }],
    web: ['Đơn qua web', function (r) { return r.webOf ? r.webPct : null; }, function (v) { return v + '%'; }, function (r) { return r.web + ' / ' + r.webOf + ' đơn'; }],
    old: ['Từ khách cũ', function (r) { return r.sales ? r.oldPct : null; }, function (v) { return v + '%'; }, function (r) { return moneyShort(r.oldRev); }]
  };
  function compareBlock(rows, cx) {
    if (rows.length < 2) return '';
    var f = S.f.r, k = CMP[f.cm] ? f.cm : 'sales', M = CMP[k];
    var its = rows.map(function (r) {
      var v = M[1](r);
      return { l: r.n, v: v || 0, txt: v === null ? '–' : M[2](v), sub: M[3](r), muted: v === null || !v, who: r.n,
        tip: r.n + ': ' + money(r.sales) + ' · ' + r.orders + ' đơn · chốt ' + (r.closePct === null ? '–' : r.closePct + '%') + ' · ' + r.care + ' lượt chăm sóc · bấm để xem chi tiết' };
    }).sort(function (a, b) { return b.v - a.v; });
    var has = its.filter(function (x) { return x.txt !== '–'; }), avg = has.length ? has.reduce(function (s0, x) { return s0 + x.v; }, 0) / has.length : 0;
    return '<section class="section"><div class="section-h"><h2>📊 So sánh nhân viên</h2><span class="tip">' + esc(k === 'target' ? 'mục tiêu ' + monthLabel(cx.month) : cx.label) + ' · bấm vào thanh để xem từng người</span></div>' +
      '<div class="chips">' + Object.keys(CMP).map(function (x) { return '<button class="chip' + (x === k ? ' on' : '') + '" data-rf="cm|' + x + '">' + CMP[x][0] + '</button>'; }).join('') + '</div>' +
      '<div class="box">' + barList(its, M[2], 'Chưa có số liệu.', { avg: has.length > 1 ? avg : null }) +
      (has.length > 1 ? '<p class="bar-legend"><span class="avg-k"></span> Trung bình nhóm: <b>' + M[2](Math.round(avg)) + '</b>' + (has.length < its.length ? ' · thanh xám: chưa có số liệu' : '') + '</p>' : '') + '</div></section>';
  }
  /** Mục “Chưa ai phụ trách” ở tab Hiệu quả: đơn chưa có NV bán, khách / khách hỏi chưa giao cho ai. */
  function viewNoOwner(cx) {
    var R = cx.R, os = S.d.orders.filter(function (o) { return !isVoid(o.status) && o.time >= R[0] && o.time < R[1] && !o.seller; }), sales = os.reduce(function (s0, o) { return s0 + o.total; }, 0);
    var cs = S.d.customers.filter(function (c) { return !c.owner; }), csTask = cs.filter(function (c) { return c.task && !coldOf(c); }).length;
    var ls = (S.d.leads || []).filter(function (l) { return !l.owner && isOpenLead(l); });
    return '<button class="btn ghost" data-who="team" style="margin-bottom:10px">← Quay lại cả nhóm</button>' +
      '<div class="kpis">' + kpi('Đơn chưa có NV bán', os.length, os.length ? 'warn' : '', '', money(sales) + ' · ' + cx.label) +
      kpi('Khách chưa ai phụ trách', cs.length, '', '', csTask + ' khách đang cần chăm sóc') + kpi('Khách hỏi chưa ai nhận', ls.length, ls.length ? 'warn' : '', '', 'đang theo dõi') + '</div>' +
      '<div class="notice">Các tab Hôm nay, Khách đã mua, Khách hỏi, Đơn hàng đang lọc theo “Chưa ai phụ trách”. Mở từng tab để giao người phụ trách (hồ sơ khách → Người phụ trách, hoặc đơn → Nhân viên bán). Chọn “Tất cả nhân sự” ở ô phía trên để bỏ lọc.</div>';
  }
  function targetBlockTeam(sales, tt, month) {
    if (!tt) return '<div class="goal none"><div class="goal-h"><b>🎯 Mục tiêu cả nhóm ' + monthLabel(month) + '</b></div><p>Chưa ai đặt mục tiêu. Bấm vào từng nhân viên bên dưới để đặt.</p></div>';
    var R = monthRange(month), isCur = month === monthOf(Date.now()), days = Math.round((R[1] - R[0]) / DAY), el = isCur ? Math.min(days, Math.floor((today() - R[0]) / DAY) + 1) : days;
    var p = sales / tt, tp = el / days, lv = p >= 1 ? 'done' : p >= tp ? 'ok' : p >= tp * 0.8 ? 'mid' : 'bad';
    return '<div class="goal ' + lv + '"><div class="goal-h"><b>🎯 Mục tiêu cả nhóm ' + monthLabel(month) + '</b><span class="goal-st">' + { done: '🎉 Đã đạt', ok: '🟢 Đúng tiến độ', mid: '🟠 Hơi chậm', bad: '🔴 Đang chậm' }[lv] + '</span></div>' +
      '<div class="goal-num"><b>' + moneyShort(sales) + '</b> / ' + moneyShort(tt) + '<span>' + Math.round(p * 100) + '%</span></div>' +
      '<div class="bar"><i style="width:' + Math.min(100, p * 100).toFixed(1) + '%"></i>' + (isCur ? '<u style="left:' + (tp * 100).toFixed(1) + '%"></u>' : '') + '</div>' + (isCur ? '<div class="bar-legend"><span>Vạch đen = hôm nay (ngày ' + el + '/' + days + ')</span></div>' : '') + (isCur && p < 1 ? '<p>Còn thiếu <b>' + moneyShort(tt - sales) + '</b> trong <b>' + (days - el + 1) + ' ngày</b> → cả nhóm mỗi ngày cần khoảng <b>' + moneyShort(Math.ceil((tt - sales) / (days - el + 1))) + '</b>.' + (el >= 3 ? ' Giữ nhịp hiện nay thì cả tháng được khoảng ' + moneyShort(Math.round(sales / el * days)) + ' (' + pct(Math.round(sales / el * days), tt) + '%).' : '') + '</p>' : '') + '<p class="small muted">Tổng mục tiêu của các nhân viên.</p></div>';
  }

  /** Đặt / sửa mục tiêu doanh số tháng. */
  function openTarget(name, month) {
    var t = targetOf(name, month), last = perf(name, monthRange(shiftMonth(month, -1))).sales;
    var body = '<div class="box"><p style="margin:0 0 10px">Mục tiêu doanh số <b>' + monthLabel(month) + '</b> của <b>' + esc(name) + '</b>.</p>' +
      '<label class="f"><span>Số tiền (gõ số, ví dụ 30000000 hoặc 30tr)</span><input type="text" id="tgAmt" inputmode="decimal" value="' + (t ? t.amount : '') + '" autocomplete="off"></label>' +
      '<p class="hint" id="tgShow"></p>' +
      (last ? '<p class="hint">Tháng trước đạt: <b>' + money(last) + '</b>. <button class="btn ghost" id="tgSame" type="button">Lấy bằng tháng trước +10%</button></p>' : '') +
      (t && t.by ? '<p class="small muted">Lần sửa gần nhất: ' + esc(t.by) + (t.at ? ', ' + fDateTime(t.at) : '') + '</p>' : '') + '<p class="err" id="tgErr"></p></div>';
    var m = modal('🎯 Mục tiêu ' + monthLabel(month), body, '<button class="btn" data-close>Huỷ</button><button class="btn pri" id="tgSave">Lưu mục tiêu</button>');
    var inp = $('#tgAmt', m), show = $('#tgShow', m);
    function val() { return moneyIn(inp.value); }
    function upd() { var v = val(); show.innerHTML = v ? '= <b>' + money(v) + '</b>' : ''; }
    inp.addEventListener('input', upd); upd(); setTimeout(function () { inp.focus(); inp.select(); }, 60);
    if ($('#tgSame', m)) $('#tgSame', m).onclick = function () { inp.value = Math.round(last * 1.1 / 1e5) * 1e5; upd(); };
    $('#tgSave', m).onclick = function () {
      var v = val(), err = $('#tgErr', m); if (!v) { err.textContent = 'Nhập số tiền mục tiêu giúp em nhé.'; return; }
      var btn = this; btn.disabled = true; btn.textContent = 'Đang lưu…';
      api('target', { month: month, name: name, amount: v }).then(function () {
        S.d.targets = (S.d.targets || []).filter(function (x) { return !(x.name === name && x.month === month); }).concat([{ month: month, name: name, amount: v, by: S.user.name, at: Date.now() }]);
        closeModal(); toast('Đã lưu mục tiêu ' + money(v) + ' ✓'); render();
      }, function (e) { btn.disabled = false; btn.textContent = 'Lưu mục tiêu'; err.textContent = e.message; });
    };
  }

  /* ================================================================ ĐỒNG BỘ FILE SALE & FILE SỐ QUẢNG CÁO (Quản trị) */
  var ROLE_LABEL = { skip: 'Bỏ qua', orders: '🧾 Đơn hàng', care: '👥 Khách & chăm sóc', reject: '⛔ Khách từ chối / bom' };
  var ROLE_FIELDS = {
    orders: ['date', 'name', 'phone', 'address', 'product', 'qty', 'gift1', 'gift1qty', 'gift2', 'gift2qty', 'status', 'ctype', 'line', 'code', 'amount', 'shipText', 'callback', 'note'],
    care: ['date', 'name', 'phone', 'product', 'status', 'amount', 'note', 'health'],
    reject: ['name', 'phone', 'status', 'note'],
    ads: ['date', 'name', 'phone', 'src', 'sale', 'ctype', 'dup', 'amount', 'note']
  };
  function syncBoxes() {
    var src = S.d.sources || [], ads = S.d.ads;
    var h = '<div class="box"><h3>📂 Đồng bộ dữ liệu từ file Google Sheet của sale</h3><p class="hint" style="margin:0 0 10px">Đưa khách, đơn cũ và nhật ký chăm sóc trong file của từng sale vào CRM. Làm lại nhiều lần không bị trùng. File cần được chia sẻ quyền xem cho tài khoản chạy CRM.</p>' +
      (src.length ? src.map(function (x) {
        var n = (x.cfg.sheets || []).filter(function (s) { return s.role !== 'skip'; });
        return '<div class="card" style="margin-bottom:8px"><div class="r1"><b>👤 ' + esc(x.sale) + '</b><span class="end small muted">' + (x.last ? 'đồng bộ ' + when(x.last) : 'chưa đồng bộ') + '</span></div>' +
          '<div class="r2">📄 ' + esc(x.fileName || x.url) + '</div><div class="r3">' + n.map(function (s) { return esc(s.name) + ' (' + ROLE_LABEL[s.role] + ')'; }).join(' · ') + '</div>' +
          (x.result ? '<div class="r3">Lần cuối: ' + esc(x.result) + '</div>' : '') +
          '<div class="acts"><button class="btn pri" data-srcsync="' + esc(x.id) + '">🔄 Đồng bộ</button><button class="btn" data-srcedit="' + esc(x.id) + '">⚙️ Cấu hình</button><button class="btn ghost" data-srcdel="' + esc(x.id) + '">Xoá</button></div></div>';
      }).join('') : '<p class="muted">Chưa có file nào.</p>') +
      '<button class="btn" data-srcadd>＋ Thêm file của 1 sale</button></div>';
    h += '<div class="box"><h3>📣 File số quảng cáo chung</h3>' + (ads && ads.fileId
      ? '<p style="margin:0 0 6px">📄 <a href="' + esc(ads.url) + '" target="_blank" rel="noopener">Mở file</a> · ' + (ads.sheets || []).filter(function (s) { return s.on; }).length + ' sheet</p>' +
        '<p style="margin:0 0 6px">Ai chia số: <b>' + (ads.mode === 'crm' ? 'CRM tự chia (ghi tên vào cột Sale)' : 'Nhân sự tự chia (CRM đọc tên ở cột Sale)') + '</b></p>' +
        '<p style="margin:0 0 10px">Lấy số từ ngày <b>' + esc(ads.since ? ads.since.split('-').reverse().join('/') : '–') + '</b> · ' + (ads.auto ? '🔁 tự lấy 10 phút/lần' : 'lấy bằng tay') + (ads.last ? ' · lần cuối ' + when(ads.last) : '') + '</p>' +
        '<div class="steps"><button class="btn pri" data-adssync="1">🔄 Lấy số mới ngay</button><button class="btn" data-adssync="dry">👀 Xem trước</button><button class="btn" data-adsedit>⚙️ Cài đặt</button></div>'
      : '<p class="hint" style="margin:0 0 10px">Số quảng cáo mới trong file chung sẽ tự vào mục <b>Khách hỏi</b> của đúng sale (theo tên ở cột Sale). Tên sale trong file khai ở Nhân sự → “Tên trong file QC”.</p><button class="btn" data-adsedit>⚙️ Kết nối file số quảng cáo</button>') + '</div>';
    return h;
  }
  function caBox() {
    var ca = (S.d.rules && S.d.rules.ca) || {};
    return '<div class="box"><h3>🕘 Ca làm việc (tính lương)</h3><p class="hint" style="margin:0 0 10px">Đơn lên sau giờ ca tối hoặc vào Chủ nhật → <b>Tối/CN</b>. Ngày lễ → <b>Lễ</b>. Sale vẫn sửa lại được khi lên đơn.</p>' +
      '<div class="row2c"><label class="f"><span>Ca tối bắt đầu lúc</span><input type="time" id="caEv" value="' + esc(ca.evening || '17:30') + '"></label>' +
      '<label class="f"><span>Ngày lễ (ngày/tháng, cách nhau dấu phẩy)</span><input type="text" id="caHol" value="' + esc((ca.holidays || ['01/01', '30/04', '01/05', '02/09']).join(', ')) + '"></label></div>' +
      '<button class="btn pri" id="caSave">Lưu ca làm việc</button></div>';
  }
  function bindSync() {
    if ($('#caSave')) $('#caSave').onclick = function () {
      var b = this; b.disabled = true;
      api('settings', { ca: { evening: $('#caEv').value, holidays: $('#caHol').value } }).then(function () { toast('Đã lưu ca làm việc ✓'); load(true); }, function (e) { toast(e.message, true); b.disabled = false; });
    };
  }
  function fieldSelect(key, headers, sel) {
    return '<label class="f map-f"><span>' + esc(FIELD_LABEL_UI[key] || key) + '</span><select data-field="' + key + '"><option value="">– không có –</option>' + headers.map(function (hh, i) { return '<option value="' + i + '"' + (String(sel) === String(i) ? ' selected' : '') + '>' + esc(hh) + '</option>'; }).join('') + '</select><em class="map-s"></em></label>';
  }
  var FIELD_LABEL_UI = { date: 'Ngày', name: 'Tên khách', phone: 'SĐT', address: 'Địa chỉ', product: 'Sản phẩm', qty: 'Số lượng', gift1: 'Quà tặng 1', gift1qty: 'SL quà 1', gift2: 'Quà tặng 2', gift2qty: 'SL quà 2', status: 'Trạng thái', ctype: 'Phân loại khách / ca', line: 'Dòng SP (nguồn)', code: 'Mã đơn', amount: 'Số tiền', shipText: 'Lên đơn (mô tả)', callback: 'Lịch gọi lại', note: 'Ghi chú / nhật ký', health: 'Tình trạng sức khoẻ', sale: 'Tên sale được chia', dup: 'Trùng sale', src: 'Nguồn / sản phẩm QC' };
  /** Khối cấu hình 1 sheet: vai trò + cột. */
  function sheetBlock(sh, i, ads) {
    var roles = ads ? { skip: 'Không lấy', ads: '✅ Lấy số từ sheet này' } : ROLE_LABEL, role = ads ? (sh.on ? 'ads' : 'skip') : sh.role; // file QC: theo lựa chọn bật/tắt, không theo vai trò máy tự nhận
    var fields = ROLE_FIELDS[ads ? 'ads' : role] || [];
    var mapped = {}; Object.keys(sh.map || {}).forEach(function (k) { mapped[sh.map[k]] = 1; });
    if (sh.pending) return '<div class="sheet-cfg unread" data-si="' + i + '"><div class="r1"><b>' + esc(sh.name) + '</b><span class="muted small">⏳ đang đọc…</span></div></div>';
    if (sh.failed) return '<div class="sheet-cfg" data-si="' + i + '"><div class="r1"><b>' + esc(sh.name) + '</b><span class="bad-line small">Không đọc được: ' + esc(sh.failed) + '</span><select class="role" style="display:none"><option value="skip">skip</option></select></div></div>';
    return '<div class="sheet-cfg' + (sh.unread ? ' unread' : '') + '" data-si="' + i + '"><div class="r1"><b>' + esc(sh.name) + '</b><span class="muted small">' + (sh.unread ? 'sheet báo cáo – không nhập' : (sh.rows || 0) + ' dòng') + '</span>' +
      '<select class="role" style="margin-left:auto;width:auto">' + Object.keys(roles).map(function (k) { return '<option value="' + k + '"' + (k === role ? ' selected' : '') + '>' + roles[k] + '</option>'; }).join('') + '</select></div>' +
      (sh.headers && sh.headers.length && (ads ? sh.on : role !== 'skip') ? '<details><summary>Cột nào là gì? (máy tự nhận – bấm để kiểm tra)</summary><div class="map-grid">' + fields.map(function (k) { return fieldSelect(k, sh.headers, sh.map ? sh.map[k] : ''); }).join('') + '</div>' +
        (role === 'orders' ? '<p class="small" style="margin:8px 0 4px"><b>Cột riêng của sale</b> (tick để giữ vào ghi chú đơn):</p><div class="extra">' + sh.headers.map(function (hh, k) { return mapped[k] || !/·/.test(hh) ? '' : '<label class="switch small"><input type="checkbox" data-extra="' + k + '"' + ((sh.extra || []).indexOf(k) >= 0 ? ' checked' : '') + '> ' + esc(hh) + '</label>'; }).join(' ') + '</div>' : '') +
        '<p class="small muted" style="margin:6px 0 0">Dòng mẫu: ' + esc((sh.samples && sh.samples[0] || []).slice(0, 8).join(' | ')) + '</p></details>' : '') + '</div>';
  }
  function defaultRole(sh, all) {
    var nm = norm(sh.name);
    if (sh.role === 'care') { var prefer = all.filter(function (x) { return x.role === 'care' && /cop so$|cham soc|luu so/.test(norm(x.name)); }); return prefer.length ? (prefer[0].name === sh.name ? 'care' : 'skip') : (all.filter(function (x) { return x.role === 'care'; })[0].name === sh.name ? 'care' : 'skip'); }
    return /^(bcdt|bao cao)/.test(nm) ? 'skip' : sh.role;
  }
  function readSheetCfg(m, sheets, ads) {
    return $$('.sheet-cfg', m).map(function (el) {
      var sh = sheets[+el.getAttribute('data-si')], role = $('.role', el).value, map = Object.assign({}, sh.map || {});
      $$('select[data-field]', el).forEach(function (s) { var k = s.getAttribute('data-field'); if (s.value === '') delete map[k]; else map[k] = +s.value; });
      var extra = $$('input[data-extra]', el).filter(function (c) { return c.checked; }).map(function (c) { return +c.getAttribute('data-extra'); });
      return ads ? { name: sh.name, on: role === 'ads', header: sh.header, map: map } : { name: sh.name, role: role, header: sh.header, map: map, extra: extra };
    });
  }
  /** Đọc file theo từng sheet: lấy danh sách tên trước, rồi đọc lần lượt từng sheet (sheet báo cáo bỏ qua). */
  function inspectFile(url, ads, onUpdate) {
    var act = ads ? 'ads_inspect' : 'src_inspect';
    return api(act, { url: url, list: true }).then(function (j) {
      var info = { fileId: j.fileId, fileName: j.fileName, sheets: j.sheets.map(function (x) { return x.report ? { name: x.name, role: 'skip', headers: [], unread: true } : { name: x.name, role: 'skip', headers: [], pending: true }; }) };
      onUpdate(info);
      var k = 0;
      return (function next() {
        while (k < info.sheets.length && !info.sheets[k].pending) k++;
        if (k >= info.sheets.length) return info;
        var i = k++;
        return api(act, { url: url, sheet: info.sheets[i].name }).then(function (r) { info.sheets[i] = r.sheets[0] || { name: info.sheets[i].name, role: 'skip', headers: [] }; onUpdate(info); return next(); },
          function (e) { info.sheets[i] = { name: info.sheets[i].name, role: 'skip', headers: [], failed: e.message }; onUpdate(info); return next(); });
      })();
    });
  }
  function openSrc(id) {
    var cur = (S.d.sources || []).filter(function (x) { return x.id === id; })[0], saleNames = userNames();
    var body = '<div class="box"><div class="row2c"><label class="f"><span>File của sale</span><select id="srcSale">' + saleNames.map(function (n) { return '<option' + (cur && cur.sale === n ? ' selected' : '') + '>' + esc(n) + '</option>'; }).join('') + '</select></label>' +
      '<label class="f"><span>Link file Google Sheet</span><input type="url" id="srcUrl" value="' + esc(cur ? cur.url : '') + '" placeholder="https://docs.google.com/spreadsheets/d/…"></label></div>' +
      '<p class="hint">Chưa có tên sale trong danh sách? Thêm ở <b>Cài đặt → Nhân sự</b> trước.</p>' +
      '<label class="f"><span>Ngày sale bắt đầu lên đơn trên CRM (không bắt buộc)</span><input type="date" id="srcUntil" value="' + esc(cur && cur.cfg.until || '') + '"></label>' +
      '<p class="hint">Đơn từ ngày này trở đi trong file cũ sẽ <b>không nhập</b>, tránh trùng với đơn đã lên trên CRM. Để trống nếu sale vẫn chỉ lên đơn trên file.</p>' +
      '<label class="switch" style="margin-top:6px"><input type="checkbox" id="srcAuto"' + (!cur || cur.cfg.autoSync !== false ? ' checked' : '') + '> 🕖 Tự nhập dòng mới mỗi sáng 7h</label>' +
      '<p class="hint">Máy tự lấy đơn và khách mới sale ghi thêm trong file, không phải bấm “Nhập vào CRM” mỗi ngày. Kết quả báo qua Telegram riêng của quản trị.</p>' +
      '<label class="switch" style="margin-top:6px"><input type="checkbox" id="srcWb"' + (cur && cur.cfg.writeBack ? ' checked' : '') + '> ✍️ Ghi kết quả chăm sóc ngược vào file này</label>' +
      '<p class="hint">Sale bấm kết quả trên CRM → máy tự viết thêm vào ô ghi chú của khách trong sheet chăm sóc (vd “, 30/9 knm”), khoảng 5 phút một lần. Sale vẫn xem đầy đủ trên file của mình. Cần sale <b>chia sẻ quyền Chỉnh sửa</b> file cho tài khoản chạy CRM.</p>' +
      '<button class="btn pri" id="srcRead">📖 Đọc file</button><p class="err" id="srcErr"></p></div><div id="srcSheets"></div>';
    var m = modal(cur ? 'Cấu hình file: ' + esc(cur.sale) : 'Thêm file của sale', body, '<button class="btn" data-close>Đóng</button><button class="btn pri" id="srcSave" disabled>Lưu cấu hình</button>');
    var info = null;
    function renderSheets() {
      $('#srcSheets', m).innerHTML = '<div class="box"><h3>📄 ' + esc(info.fileName) + '</h3><p class="hint" style="margin:0 0 10px">Chọn sheet nào là <b>Đơn hàng</b> (lên đơn), sheet nào là <b>Khách & chăm sóc</b> (lưu số, nhật ký). Các sheet báo cáo để “Bỏ qua”.</p>' +
        info.sheets.map(function (sh, i) { return sheetBlock(sh, i); }).join('') + '</div>';
      $$('.sheet-cfg .role', m).forEach(function (sel) { sel.onchange = function () { var i = +sel.closest('.sheet-cfg').getAttribute('data-si'); info.sheets[i].role = sel.value; if (!info.sheets[i].map || !Object.keys(info.sheets[i].map).length) info.sheets[i].map = {}; renderSheets(); }; });
      $$('select[data-field]', m).forEach(function (s) { var show = function () { var sh = info.sheets[+s.closest('.sheet-cfg').getAttribute('data-si')], v = s.value; s.parentNode.querySelector('.map-s').textContent = v === '' ? '' : 'vd: ' + ((sh.samples[0] || [])[+v] || (sh.samples[1] || [])[+v] || ''); }; s.onchange = show; show(); });
    }
    $('#srcRead', m).onclick = function () {
      var b = this, url = $('#srcUrl', m).value.trim(); if (!url) return; b.disabled = true; $('#srcErr', m).textContent = '';
      var t0 = Date.now(), tick = setInterval(function () { var sec = Math.round((Date.now() - t0) / 1000); b.textContent = 'Đang đọc file… ' + sec + ' giây' + (sec > 30 ? ' (file lớn, vui lòng chờ)' : ''); }, 1000); b.textContent = 'Đang đọc file…';
      var done = function () { clearInterval(tick); };
      var old = {}; (cur && cur.cfg.sheets || []).forEach(function (s) { old[s.name] = s; });
      inspectFile(url, false, function (j) {
        info = j;
        var allDone = !j.sheets.some(function (x) { return x.pending; }), usable = function (x) { return !x.pending && !x.unread && !x.failed; };
        j.sheets.forEach(function (sh) { if (usable(sh) && sh._det === undefined) { sh._det = sh.role; sh.role = old[sh.name] ? old[sh.name].role : 'skip'; if (old[sh.name]) { sh.map = old[sh.name].map || sh.map; sh.extra = old[sh.name].extra; } } });
        if (allDone) { // đọc xong hết mới chọn vai trò mặc định (cần biết toàn bộ sheet để chọn đúng sheet chăm sóc)
          var det = j.sheets.map(function (x) { return Object.assign({}, x, { role: x._det || 'skip' }); });
          j.sheets.forEach(function (sh, k) { if (usable(sh) && !sh._set) { sh._set = 1; if (!old[sh.name]) sh.role = defaultRole(det[k], det); } });
        }
        renderSheets(); $('#srcSave', m).disabled = j.sheets.some(function (x) { return x.pending; });
      }).then(function () { done(); b.disabled = false; b.textContent = '📖 Đọc lại file'; }, function (e) { done(); b.disabled = false; b.textContent = '📖 Đọc file'; $('#srcErr', m).textContent = e.message; });
    };
    if (cur) $('#srcRead', m).click();
    $('#srcSave', m).onclick = function () {
      var b = this; b.disabled = true;
      var cfg = { sheets: readSheetCfg(m, info.sheets), until: $('#srcUntil', m).value, writeBack: $('#srcWb', m).checked, autoSync: $('#srcAuto', m).checked };
      if (!cfg.sheets.some(function (s) { return s.role !== 'skip'; })) { toast('Chọn ít nhất 1 sheet để nhập', true); b.disabled = false; return; }
      api('src_save', { id: cur ? cur.id : '', sale: $('#srcSale', m).value, url: $('#srcUrl', m).value.trim(), fileName: info.fileName, cfg: cfg }).then(function (j) {
        toast('Đã lưu cấu hình ✓'); closeModal(true);
        load(true).then(function () { openSrcSync(j.id); });
      }, function (e) { toast(e.message, true); b.disabled = false; });
    };
  }
  function openSrcSync(id) {
    var src = (S.d.sources || []).filter(function (x) { return x.id === id; })[0]; if (!src) return;
    var order = { orders: 0, care: 1, reject: 2 }, list = (src.cfg.sheets || []).map(function (s, i) { return { s: s, i: i }; }).filter(function (x) { return x.s.role !== 'skip'; }).sort(function (a, b) { return order[a.s.role] - order[b.s.role]; });
    var body = '<div class="box"><p style="margin:0 0 8px">Đồng bộ file <b>' + esc(src.fileName) + '</b> của <b>' + esc(src.sale) + '</b>. Khách mới được giao cho ' + esc(src.sale) + '. Khách đang do người khác phụ trách thì giữ nguyên người cũ (xem mục “trùng”).</p>' +
      '<p class="hint" style="margin:0">Bấm <b>Xem trước</b> để xem số liệu, chưa ghi gì vào CRM. Đúng rồi mới bấm <b>Nhập vào CRM</b>. File lớn có thể mất 1–3 phút.</p></div>' +
      list.map(function (x) { return '<div class="box" data-sync="' + x.i + '"><h3>' + esc(x.s.name) + ' <span class="muted small">' + ROLE_LABEL[x.s.role] + '</span></h3><div class="res muted">Chưa chạy</div></div>'; }).join('');
    var m = modal('🔄 Đồng bộ: ' + esc(src.sale), body, '<button class="btn" data-close>Đóng</button><button class="btn" id="syDry">👀 Xem trước</button><button class="btn pri" id="syRun">✅ Nhập vào CRM</button>');
    function show(i, r) {
      var el = $('[data-sync="' + i + '"] .res', m), sh = src.cfg.sheets[i];
      if (r.sheetName && r.sheetName !== sh.name) { el.innerHTML = '<span class="bad-line">Máy chủ trả về kết quả của sheet “' + esc(r.sheetName) + '”. Bấm ↻ tải lại trang rồi thử lại.</span>'; return; }
      if (r.role === 'orders' && r.newOrders === undefined) { el.innerHTML = '<span class="bad-line">Kết quả chưa đầy đủ, bấm Xem trước lại.</span>'; return; }
      if (sh.role === 'orders') el.innerHTML = '<b>' + r.newOrders + '</b> đơn mới · ' + r.dup + ' đơn đã có' + (r.updated ? ' (<b>' + r.updated + '</b> đơn cập nhật trạng thái theo file)' : '') + (r.afterCut ? ' · ' + r.afterCut + ' đơn sau ngày lên CRM – bỏ qua' : '') + ' · ' + r.skip + ' dòng bỏ qua (thiếu SĐT / ngày / sản phẩm)<br>' + (r.approx ? 'khoảng ' : '') + r.customers + ' khách (' + r.newCustomers + ' khách mới với CRM) · doanh số ' + money(r.revenue) + (r.from ? ' · từ ' + fDate(r.from) + ' đến ' + fDate(r.to) : '') + conflictHtml(r);
      else if (sh.role === 'care') el.innerHTML = r.people + ' người trong sổ' + (r.from ? ' (từ dòng ' + (r.from + 1) + ')' : '') + ' · <b>' + r.notes + '</b> khách được ghép nhật ký cũ · <b>' + r.newLeads + '</b> người chưa mua → Khách hỏi (' + r.openLeads + ' còn theo dõi, số còn lại ghi “Không mua – dữ liệu cũ”)' + conflictHtml(r);
      else el.innerHTML = r.summary;
    }
    function conflictHtml(r) { return r.conflictCount ? '<br><span class="warn-line">⚠️ ' + r.conflictCount + ' khách đang do sale khác phụ trách (giữ người cũ):</span> ' + r.conflicts.slice(0, 12).map(function (c) { return esc(c.name || fPhone(c.phone)) + ' → ' + esc(c.owner); }).join(', ') + (r.conflictCount > 12 ? '…' : '') : ''; }
    var CHUNK = ON_CF ? 1e9 : 1500; // máy chủ mới xử lý cả sheet 1 lần
    function addUp(acc, r) { // cộng dồn kết quả các phần
      if (!acc) return r;
      ['newOrders', 'dup', 'skip', 'revenue', 'conflictCount', 'updated', 'afterCut'].forEach(function (k) { acc[k] = (acc[k] || 0) + (r[k] || 0); });
      acc.from = acc.from && r.from ? Math.min(acc.from, r.from) : acc.from || r.from; acc.to = Math.max(acc.to || 0, r.to || 0);
      acc.conflicts = (acc.conflicts || []).concat(r.conflicts || []); acc._ph = acc._ph || 0; return acc;
    }
    function syncSheet(x, dry) {
      var el = $('[data-sync="' + x.i + '"] .res', m);
      if (x.s.role !== 'orders') { el.innerHTML = '⏳ Đang ' + (dry ? 'đọc' : 'nhập') + '…'; return api('src_sync', { id: id, sheet: x.i, name: x.s.name, dry: dry }).then(function (r) { show(x.i, r); }); }
      var acc = null, off = 0, custs = 0, newCus = 0;
      return (function part() {
        el.innerHTML = '⏳ Đang ' + (dry ? 'đọc' : 'nhập') + (acc ? ' ' + Math.min(off, acc.total) + '/' + acc.total + ' dòng' : '') + '…';
        return api('src_sync', { id: id, sheet: x.i, name: x.s.name, dry: dry, offset: off, limit: CHUNK }).then(function (r) {
          custs += r.customers || 0; newCus += r.newCustomers || 0; acc = addUp(acc, r); acc.total = r.total; off += CHUNK;
          if (off < r.total) return part();
          acc.customers = custs; acc.newCustomers = newCus; acc.approx = r.total > CHUNK; show(x.i, acc);
        });
      })();
    }
    function run(dry) {
      var bD = $('#syDry', m), bR = $('#syRun', m); bD.disabled = bR.disabled = true;
      var k = 0, didOrders = false;
      var fail = function (e, x) { $('[data-sync="' + x.i + '"] .res', m).innerHTML = '<span class="bad-line">' + esc(e.message) + '</span>'; bD.disabled = bR.disabled = false; };
      (function next() {
        if (!dry && didOrders && (k >= list.length || list[k].s.role !== 'orders')) { // xong phần đơn hàng → tính lại khách 1 lần
          didOrders = false; toast('Đang tính lại danh sách khách…');
          return api('src_finish', { id: id }).then(next, function (e) { toast(e.message, true); bD.disabled = bR.disabled = false; });
        }
        if (k >= list.length) { bD.disabled = bR.disabled = false; toast(dry ? 'Xem trước xong' : 'Đã nhập xong ✓'); if (!dry) { bR.textContent = '✅ Đã nhập – nhập lại (chỉ thêm dòng mới)'; load(true); } return; }
        var x = list[k]; if (x.s.role === 'orders') didOrders = true;
        syncSheet(x, dry).then(function () { k++; next(); }, function (e) { fail(e, x); });
      })();
    }
    $('#syDry', m).onclick = function () { run(true); };
    $('#syRun', m).onclick = function () { if (confirm('Nhập dữ liệu của ' + src.sale + ' vào CRM?')) run(false); };
  }
  function openAds() {
    var cur = S.d.ads || {}, since = cur.since || isoDate(Date.now() - 3 * DAY);
    var aliases = (S.d.users || []).filter(function (u) { return u.alias; }).map(function (u) { return esc(u.name) + ' = “' + esc(u.alias) + '”'; });
    var body = '<div class="box"><label class="f"><span>Link file số quảng cáo chung</span><input type="url" id="adUrl" value="' + esc(cur.url || '') + '" placeholder="https://docs.google.com/spreadsheets/d/…"></label>' +
      '<button class="btn pri" id="adRead">📖 Đọc file</button><p class="err" id="adErr"></p></div>' +
      '<div class="box"><div class="f"><span class="lbl">Ai chia số?</span>' +
      '<label class="mode"><input type="radio" name="adMode" value="staff"' + (cur.mode !== 'crm' ? ' checked' : '') + '><span><b>Nhân sự tự chia</b>Người chia số ghi tên sale vào cột Sale như hiện nay. CRM chỉ đọc và đưa số vào đúng sale.</span></label>' +
      '<label class="mode"><input type="radio" name="adMode" value="crm"' + (cur.mode === 'crm' ? ' checked' : '') + '><span><b>CRM tự chia</b>Số chưa có tên sale: CRM chia lần lượt theo từng sheet sản phẩm (số trùng → giao lại sale cũ) và ghi tên vào cột Sale. Cần quyền sửa file.</span></label></div>' +
      '<div class="row2c"><label class="f"><span>Chỉ lấy số từ ngày</span><input type="date" id="adSince" value="' + esc(since) + '"></label>' +
      '<label class="switch" style="align-self:center"><input type="checkbox" id="adAuto"' + (cur.auto ? ' checked' : '') + '> Tự lấy số mới 10 phút/lần</label></div>' +
      '<p class="hint" style="margin:0">Tên sale trong file phải khớp tên ở <b>Nhân sự → Tên trong file QC</b>. Hiện có: ' + (aliases.length ? aliases.join(', ') : '<b>chưa khai ai</b>') + '. Số của sale chưa có trong CRM sẽ được bỏ qua.</p></div><div id="adSheets"></div>';
    var m = modal('📣 File số quảng cáo chung', body, '<button class="btn" data-close>Đóng</button><button class="btn pri" id="adSave"' + (cur.sheets ? '' : ' disabled') + '>Lưu</button>');
    var info = cur.sheets ? { sheets: cur.sheets.map(function (s) { return Object.assign({ headers: [], rows: '' }, s); }) } : null;
    function renderSheets() {
      $('#adSheets', m).innerHTML = '<div class="box"><h3>Sheet sản phẩm</h3>' + info.sheets.map(function (sh, i) { return sheetBlock(sh, i, true); }).join('') + '</div>';
      $$('.sheet-cfg .role', m).forEach(function (sel) { sel.onchange = function () { info.sheets[+sel.closest('.sheet-cfg').getAttribute('data-si')].on = sel.value === 'ads'; renderSheets(); }; });
      $$('select[data-field]', m).forEach(function (s) { var show = function () { var sh = info.sheets[+s.closest('.sheet-cfg').getAttribute('data-si')], v = s.value; s.parentNode.querySelector('.map-s').textContent = v === '' || !sh.samples ? '' : 'vd: ' + ((sh.samples[0] || [])[+v] || ''); }; s.onchange = show; show(); });
    }
    $('#adRead', m).onclick = function () {
      var b = this, url = $('#adUrl', m).value.trim(); if (!url) return; b.disabled = true; b.textContent = 'Đang đọc file…'; $('#adErr', m).textContent = '';
      var old = {}; (cur.sheets || []).forEach(function (s) { old[s.name] = s; });
      inspectFile(url, true, function (j) {
        j.sheets.forEach(function (sh) { if (sh.pending || sh._set) return; sh._set = 1; sh.on = old[sh.name] ? old[sh.name].on : sh.role === 'ads'; if (old[sh.name] && old[sh.name].map) sh.map = old[sh.name].map; });
        info = j; renderSheets(); $('#adSave', m).disabled = j.sheets.some(function (x) { return x.pending; });
      }).then(function () { b.disabled = false; b.textContent = '📖 Đọc lại file'; }, function (e) { b.disabled = false; b.textContent = '📖 Đọc file'; $('#adErr', m).textContent = e.message; });
    };
    if (info) { renderSheets(); $('#adSave', m).disabled = false; }
    $('#adSave', m).onclick = function () {
      var b = this; b.disabled = true;
      var cfg = { url: $('#adUrl', m).value.trim(), mode: ($('input[name=adMode]:checked', m) || {}).value || 'staff', since: $('#adSince', m).value, auto: $('#adAuto', m).checked, sheets: readSheetCfg(m, info.sheets, true) };
      if (cfg.mode === 'crm' && !confirm('CRM sẽ tự chia số và ghi tên sale vào file quảng cáo. Chắc chắn?')) { b.disabled = false; return; }
      api('ads_save', { cfg: cfg }).then(function () { toast('Đã lưu ✓'); closeModal(true); load(true); }, function (e) { toast(e.message, true); b.disabled = false; });
    };
  }
  function runAds(dry, btn) {
    btn.disabled = true; var t = btn.textContent; btn.textContent = '⏳ Đang đọc file…';
    api('ads_sync', { dry: dry }).then(function (r) {
      btn.disabled = false; btn.textContent = t;
      var per = Object.keys(r.perSale).map(function (n) { return esc(n) + ': ' + r.perSale[n]; }).join(', ');
      modal(dry ? '👀 Xem trước số quảng cáo' : '✅ Đã lấy số quảng cáo', '<div class="box"><p style="margin:0 0 8px"><b>' + r.newLeads + '</b> số mới' + (per ? ' (' + per + ')' : '') + '.</p>' +
        '<p class="small" style="margin:0 0 8px">Theo sheet: ' + Object.keys(r.perSheet).map(function (n) { return esc(n) + ' ' + r.perSheet[n]; }).join(' · ') + '</p>' +
        (r.merged ? '<p class="hint" style="margin:0 0 6px">' + r.merged + ' số đang được chăm sóc (đã có trong Khách hỏi) → không tạo trùng.</p>' : '') +
        (r.skipped ? '<p class="hint" style="margin:0">' + r.skipped + ' số của sale chưa có trong CRM (hoặc chưa chia) → bỏ qua.</p>' : '') + (r.writes ? '<p class="hint">CRM đã ghi tên sale cho ' + r.writes + ' số.</p>' : '') +
        (r.keep && r.keep.phones ? '<p class="hint" style="margin:6px 0 0">📋 Cột Trùng sale: ' + r.keep.phones + ' số có ghi sale phụ trách' + (r.keep.customers || r.keep.leads ? ' · ' + (dry ? 'sẽ chuyển' : 'đã chuyển') + ' ' + r.keep.customers + ' khách đã mua, ' + r.keep.leads + ' khách hỏi theo file' : '') + (r.keep.toFile ? ' · ' + (dry ? 'sẽ ghi' : 'đã ghi') + ' ' + r.keep.toFile + ' khách đổi trên CRM vào file' : '') + '.</p>' : '') +
        (r.keep && r.keep.writeError ? '<p class="err">Chưa ghi được vào file (cần quyền sửa file cho tài khoản Google của CRM): ' + esc(r.keep.writeError) + '</p>' : '') +
        (r.keep && r.keep.unknown ? '<p class="hint" style="margin:0">Tên ở cột Trùng sale chưa khớp nhân sự nào (thêm vào “Tên trong file QC” nếu cần): ' + r.keep.unknown.map(esc).join(', ') + '</p>' : '') + '</div>', '<button class="btn pri" data-close>Đóng</button>');
      if (!dry) load(true);
    }, function (e) { btn.disabled = false; btn.textContent = t; toast(e.message, true); });
  }

  /* ================================================================ BCDT – báo cáo doanh số tháng theo mẫu của sale */
  function lineOfTxt(t) { t = String(t || ''); return /progomax|fucoidan pro|fu ?pro/i.test(t) ? 'Fucoidan Pro' : /curcumin|nghệ/i.test(t) ? 'Curcumin' : /bữa ăn|badd|bua an/i.test(t) ? 'BADD' : 'Khác'; }
  var BC_LINES = ['Curcumin', 'BADD', 'Fucoidan Pro', 'Khác'];
  function bcdtData(name, month) {
    var R = monthRange(month), days = Math.round((R[1] - R[0]) / DAY), rows = [], tot = null, ca = { 'Ngày': [0, 0], 'Tối/CN': [0, 0], 'Lễ': [0, 0] }, ot = {}, web = { n: 0, r: 0, c: 0, src: {} }; OTYPES.forEach(function (t) { ot[t] = [0, 0, 0]; }); // [số đơn, doanh số, tiền tính hoa hồng = tiền hàng không gồm phí ship]
    var mine = function (o) { return name === null || o.seller === name; };
    var blank = function () { var r = { newN: {}, newD: {}, newR: {}, oldN: {}, oldR: {}, hoanN: 0, hoanV: 0, offN: 0, offR: 0, careOk: 0, knm: 0, hrN: {}, hrR: {} }; BC_LINES.forEach(function (l) { r.newN[l] = 0; r.newD[l] = 0; r.newR[l] = 0; r.oldN[l] = 0; r.oldR[l] = 0; }); HR_KEYS.forEach(function (k) { r.hrN[k] = 0; r.hrR[k] = 0; }); return r; };
    tot = blank();
    for (var d = 0; d < days; d++) rows.push(Object.assign(blank(), { day: R[0] + d * DAY }));
    S.d.orders.forEach(function (o) {
      if (!o.time || o.time < R[0] || o.time >= R[1] || !mine(o)) return;
      var r = rows[Math.floor((o.time - R[0]) / DAY)], l = o.line || lineOfTxt(o.items);
      if (BC_LINES.indexOf(l) < 0) l = 'Khác';
      if (/hoàn/i.test(o.status)) { r.hoanN++; r.hoanV += o.total; tot.hoanN++; tot.hoanV += o.total; return; }
      if (isVoid(o.status)) return;
      var c = cust(o.phone), t0 = otypeOf(o), isNew = t0 === 'Khách mới' ? true : t0 === 'Khách cũ' ? false : !c || !c.first || c.first >= o.time - 3600e3;
      if (isWebOrder(o)) { var ws = webSrc(o); web.n++; web.r += o.total; web.c += commBase(o); web.src[ws] = (web.src[ws] || 0) + 1; } else { ot[t0][0]++; ot[t0][1] += o.total; ot[t0][2] += commBase(o); } // đơn web tính hoa hồng riêng
      [r, tot].forEach(function (x) { if (isNew) { x.newN[l]++; x.newR[l] += o.total; } else { x.oldN[l]++; x.oldR[l] += o.total; } });
      var k = o.ca && ca[o.ca] ? o.ca : 'Ngày'; ca[k][0]++; ca[k][1] += o.total;
      if (k !== 'Ngày') [r, tot].forEach(function (x) { x.offN++; x.offR += o.total; });
      var hb = hourBucket(o.time);
      [r, tot].forEach(function (x) { x.hrN[hb]++; x.hrR[hb] += o.total; });
    });
    tot.close = closeStats(name, R); rows.forEach(function (r) { r.close = closeStats(name, [r.day, r.day + DAY]); });
    rows.forEach(function (r) { var cs = careStats(name, r.day, r.day + DAY); r.careOk = cs.ok; r.knm = cs.knm; tot.careOk += cs.ok; tot.knm += cs.knm; });
    var seenD = {}; (S.d.adRows || []).forEach(function (a) { // data mới theo dòng SP = số trong file quảng cáo (như tỷ lệ chốt)
      if (a[0] < R[0] || a[0] >= R[1] || (name !== null && a[2] !== name) || seenD[a[0] + a[1]]) return;
      seenD[a[0] + a[1]] = 1; var l = lineOfTxt(a[3]); rows[Math.floor((a[0] - R[0]) / DAY)].newD[l]++; tot.newD[l]++;
    });
    return { rows: rows, tot: tot, ca: ca, ot: ot, web: web };
  }
  /** Chăm sóc trong khoảng thời gian: số khách kết nối được, số khách không nghe máy, lý do khách chưa mua (ghi chú). */
  function careStats(name, from, to) {
    var ok = {}, miss = {}, why = [];
    S.d.log.forEach(function (l) {
      if (!l.time || l.time < from || l.time >= to || !isCareLog(l) || (name !== null && l.by !== name)) return;
      var ph = String(l.ref).replace(/^'/, '');
      if (l.result === NO_REPLY) miss[ph] = 1; else ok[ph] = 1;
      var n = String(l.note || '').replace(/\s*[–-]\s*hẹn gọi lại \d{1,2}\/\d{1,2}(\/\d{2,4})?$/, '').trim();
      if (n && (l.result === 'Không có nhu cầu' || l.result === 'Hẹn gọi lại') && !/chưa nhận/i.test(n) && why.indexOf(n) < 0) why.push(n);
    });
    Object.keys(ok).forEach(function (ph) { delete miss[ph]; }); // gọi lại sau đó khách nghe → tính kết nối
    return { ok: Object.keys(ok).length, knm: Object.keys(miss).length, why: why };
  }
  function dailyText(name, day) {
    var month = monthOf(day), d = bcdtData(name, month), R = monthRange(month), r = d.rows[Math.floor((dayStart(day) - R[0]) / DAY)] || d.rows[0];
    var sum = function (o) { return BC_LINES.reduce(function (s0, l) { return s0 + o[l]; }, 0); }, mf = function (v) { return (Number(v) || 0).toLocaleString('vi-VN'); };
    var lines = ['📋 BÁO CÁO NGÀY ' + fDate(day) + ' – ' + (name || 'Cả nhóm')];
    BC_LINES.forEach(function (l) {
      if (l === 'Khác') lines.push('Sản phẩm khác: ' + r.newN[l] + (r.newR[l] ? ' · ' + mf(r.newR[l]) : ''));
      else lines.push('Số đơn ' + l + ': ' + r.newN[l] + (r.newR[l] ? ' · ' + mf(r.newR[l]) : ''), 'Số mới ' + l + ': ' + r.newD[l]);
    });
    var d0 = dayStart(day), eb = (S.d.leads || []).filter(function (l) { return /^ebook/i.test(l.channel || '') && l.time >= d0 && l.time < d0 + DAY && (name === null || l.owner === name); }).length;
    if (eb) lines.push('Số mới Ebook (quà tặng): ' + eb);
    lines.push('Số đơn từ khách cũ: ' + sum(r.oldN) + (sum(r.oldR) ? ' · ' + mf(sum(r.oldR)) : ''));
    lines.push('💰 TỔNG DT: ' + mf(sum(r.newR) + sum(r.oldR)));
    if (r.offN) lines.push('   (trong đó ngoài giờ: ' + r.offN + ' đơn · ' + mf(r.offR) + ')');
    var hrL = HR_KEYS.filter(function (k) { return r.hrN[k] || k === 'Trong giờ' || k === 'Ngoài giờ'; }).map(function (k) { return HR_ICON[k] + ' ' + (k === 'Trong giờ' ? 'Giờ hành chính (8:00–' + evTime() + ')' : k === 'Ngoài giờ' ? 'Buổi tối / Chủ nhật' : k) + ': ' + r.hrN[k] + ' đơn · ' + mf(r.hrR[k]); });
    lines.push('🕘 Theo giờ lên đơn:'); hrL.forEach(function (t) { lines.push('   ' + t); });
    if (r.hoanN) lines.push('Đơn hoàn: ' + r.hoanN + ' · ' + mf(r.hoanV));
    var cs = careStats(name, dayStart(day), dayStart(day) + DAY);
    lines.push('KH cũ đã chăm sóc (kết nối): ' + cs.ok, 'Không nghe máy: ' + cs.knm);
    lines.push('Lý do từ chối:' + (cs.why.length ? '' : ' –')); cs.why.slice(0, 12).forEach(function (w) { lines.push('- ' + w); });
    var T = d.tot, mrev = sum(T.newR) + sum(T.oldR), tg = name ? targetOf(name, month) : null;
    lines.push('', '📈 Luỹ kế ' + monthLabel(month) + ': ' + mf(mrev) + (tg && tg.amount ? ' · đạt ' + pct(mrev, tg.amount) + '% mục tiêu ' + moneyShort(tg.amount) : ''));
    return lines.join('\n');
  }
  function openDaily(name, day) {
    name = name === undefined ? (lvl() >= 2 ? null : S.user.name) : name; day = day || Date.now();
    var opts = lvl() >= 2 ? '<label class="f"><span>Của ai</span><select id="dyWho"><option value="">Cả nhóm</option>' + userNames().map(function (n) { return '<option' + (n === name ? ' selected' : '') + '>' + esc(n) + '</option>'; }).join('') + '</select></label>' : '';
    var body = '<div class="row2c">' + opts + '<label class="f"><span>Ngày</span><input type="date" id="dyDay" value="' + isoDate(day) + '" max="' + isoDate(Date.now()) + '"></label></div>' +
      '<p class="small muted" style="margin:0 0 6px">Máy tự tính từ đơn hàng và các lần bạn bấm kết quả chăm sóc. Sửa được trước khi copy (vd thêm lý do từ chối).</p>' +
      '<textarea id="dyText" rows="18" style="font-family:inherit;font-size:14px;line-height:1.5">' + esc(dailyText(name, day)) + '</textarea>' +
      '<div id="dyList">' + dayOrdersHtml(name, day) + '</div>';
    var m = modal('📋 Báo cáo ngày', body, '<button class="btn" data-close>Đóng</button><button class="btn zalo" id="dyCopy">📋 Copy để dán vào Zalo</button>');
    var redraw = function () { var w = $('#dyWho', m), dv = $('#dyDay', m).value, nm = w ? (w.value || null) : name, dy = dv ? new Date(dv + 'T12:00:00+07:00').getTime() : Date.now(); $('#dyText', m).value = dailyText(nm, dy); $('#dyList', m).innerHTML = dayOrdersHtml(nm, dy); };
    if ($('#dyWho', m)) $('#dyWho', m).onchange = redraw; $('#dyDay', m).onchange = redraw;
    $('#dyCopy', m).onclick = function () { copy($('#dyText', m).value).then(function () { toast('Đã copy – mở nhóm Zalo và dán vào nhé'); }); };
  }
  /** Đơn trong ngày xếp theo giờ lên đơn (chỉ xem, không copy vào Zalo). Đơn huỷ / hoàn không tính. */
  function dayOrdersHtml(name, day) {
    var d0 = dayStart(day), L = (S.d.orders || []).filter(function (o) { return o.time >= d0 && o.time < d0 + DAY && (name === null || o.seller === name) && !isVoid(o.status); }).sort(function (a, b) { return a.time - b.time || (a.row || 0) - (b.row || 0); });
    if (!L.length) return '';
    return '<h3 style="margin:12px 0 6px">🕘 Đơn trong ngày theo giờ lên đơn</h3><div class="bcdt-wrap"><table class="bcdt"><thead><tr><th>Giờ</th><th>Mã đơn</th><th>Khách</th>' + (name === null ? '<th>Sale</th>' : '') + '<th>Số tiền</th><th>Ca</th></tr></thead><tbody>' +
      L.map(function (o) { var hb = hourBucket(o.time), x = vnDate(o.time); return '<tr><td>' + (hb === 'Không rõ giờ' ? '–' : pad(x.h) + ':' + pad(x.mi)) + '</td><td>' + esc(o.id || '') + '</td><td>' + esc(o.name || '') + '</td>' + (name === null ? '<td>' + esc(o.seller || '') + '</td>' : '') + '<td>' + (Number(o.total) || 0).toLocaleString('vi-VN') + '</td><td>' + HR_ICON[hb] + ' ' + hb + '</td></tr>'; }).join('') +
      '</tbody></table></div><p class="small muted" style="margin:6px 0 0">Giờ hành chính: thứ 2 – thứ 7, 8:00 – ' + esc(evTime()) + '. Chủ nhật tính ngoài giờ, trừ khi là ngày lễ. Đơn nhập từ file sale chỉ có ngày nên ghi “Không rõ giờ”.</p>';
  }
  function bcdtCols() {
    var c = [['Ngày', function (r) { return r.day ? fDate(r.day).slice(0, 5) : 'TỔNG'; }]];
    BC_LINES.forEach(function (l) { c.push(['Đơn mới ' + l, function (r) { return r.newN[l]; }], ['Data mới ' + l, function (r) { return r.newD[l]; }], ['DT mới ' + l, function (r) { return r.newR[l]; }, 1]); });
    BC_LINES.forEach(function (l) { c.push(['Đơn cũ ' + l, function (r) { return r.oldN[l]; }], ['DT cũ ' + l, function (r) { return r.oldR[l]; }, 1]); });
    c.push(['Số đơn hoàn', function (r) { return r.hoanN; }], ['Giá trị hoàn', function (r) { return r.hoanV; }, 1]);
    var sum = function (o) { return BC_LINES.reduce(function (s, l) { return s + o[l]; }, 0); };
    c.push(['DS khách mới', function (r) { return sum(r.newR); }, 1], ['DT khách cũ', function (r) { return sum(r.oldR); }, 1], ['TỔNG DT (đã trừ hoàn)', function (r) { return sum(r.newR) + sum(r.oldR); }, 1]);
    c.push(['Data quảng cáo', function (r) { return r.close.data; }], ['Data ra đơn', function (r) { return r.close.won; }], ['Tỷ lệ chốt', function (r) { return r.close.data ? r.close.pct + '%' : ''; }], ['TB/đơn mới', function (r) { var n = sum(r.newN); return n ? Math.round(sum(r.newR) / n) : 0; }, 1],
      ['% DT khách cũ', function (r) { var t = sum(r.newR) + sum(r.oldR); return t ? Math.round(sum(r.oldR) / t * 100) + '%' : ''; }],
      ['TB/đơn cũ', function (r) { var n = sum(r.oldN); return n ? Math.round(sum(r.oldR) / n) : 0; }, 1], ['DT ngoài giờ', function (r) { return r.offR; }, 1],
      ['DT giờ hành chính', function (r) { return r.hrR['Trong giờ']; }, 1], ['DT tối / CN (theo giờ)', function (r) { return r.hrR['Ngoài giờ']; }, 1], ['DT ngày lễ (theo giờ)', function (r) { return r.hrR['Ngày lễ']; }, 1], ['DT không rõ giờ', function (r) { return r.hrR['Không rõ giờ']; }, 1],
      ['KH cũ chăm sóc (kết nối)', function (r) { return r.careOk; }], ['Không nghe máy', function (r) { return r.knm; }]);
    return c;
  }
  function openBcdt(name, month) {
    var d = bcdtData(name, month), fmtv = function (v, isMoney) { return !v ? '' : isMoney ? v.toLocaleString('vi-VN') : v; };
    var cols = bcdtCols().filter(function (c, i) { return i === 0 || c[1](d.tot); }); // ẩn cột cả tháng bằng 0 (dòng SP không bán) cho gọn
    var sumL = function (o) { return BC_LINES.reduce(function (s, l) { return s + o[l]; }, 0); }, T = d.tot, tRev = sumL(T.newR) + sumL(T.oldR), tg = name ? targetOf(name, month) : null;
    var BR = d.rows.filter(function (r) { return r.day <= today(); }), bsk = function (f, bad) { return BR.length >= 2 ? sparkSvg(BR.map(f), month === monthOf(Date.now()), bad) : ''; };
    var sumKpi = kpi('Tổng doanh số', moneyShort(tRev), '', '', (sumL(T.newN) + sumL(T.oldN)) + ' đơn · hoàn ' + T.hoanN, bsk(function (r) { return sumL(r.newR) + sumL(r.oldR); })) +
      kpi('Tỷ lệ chốt', T.close.data ? T.close.pct + '%' : '–', '', '', T.close.won + ' ra đơn / ' + T.close.data + ' data quảng cáo' + (T.close.open ? ' · ' + T.close.open + ' đang tư vấn' : '')) +
      kpi('TB/đơn khách mới', sumL(T.newN) ? moneyShort(sumL(T.newR) / sumL(T.newN)) : '–', '', '', '', bsk(function (r) { return sumL(r.newN) ? sumL(r.newR) / sumL(r.newN) : null; })) +
      kpi('Doanh số khách cũ', tRev ? Math.round(sumL(T.oldR) / tRev * 100) + '%' : '–', '', '', moneyShort(sumL(T.oldR)), bsk(function (r) { var t = sumL(r.newR) + sumL(r.oldR); return t ? sumL(r.oldR) * 100 / t : null; })) +
      kpi('TB/đơn khách cũ', sumL(T.oldN) ? moneyShort(sumL(T.oldR) / sumL(T.oldN)) : '–', '', '', sumL(T.oldN) + ' đơn khách cũ', bsk(function (r) { return sumL(r.oldN) ? sumL(r.oldR) / sumL(r.oldN) : null; })) +
      kpi('DT ngoài giờ (loại đơn)', moneyShort(T.offR), '', '', T.offN + ' đơn sale chọn Ngoài giờ / Ngày lễ (tính hoa hồng)') +
      kpi('KH cũ đã chăm sóc', T.careOk, '', '', 'kết nối được · ' + T.knm + ' lượt không nghe máy', bsk(function (r) { return r.careOk; })) +
      (tg && tg.amount ? kpi('% tiến độ mục tiêu', pct(tRev, tg.amount) + '%', pct(tRev, tg.amount) >= 100 ? 'good' : '', '', 'mục tiêu ' + moneyShort(tg.amount)) : '');
    var head = '<tr>' + cols.map(function (c) { return '<th>' + esc(c[0]) + '</th>'; }).join('') + '</tr>';
    var tr = function (r, cls) { return '<tr' + (cls ? ' class="' + cls + '"' : '') + '>' + cols.map(function (c) { return '<td>' + fmtv(c[1](r), c[2]) + '</td>'; }).join('') + '</tr>'; };
    var CMr = S.d.rules.commission || {}, cmP = function (k) { return Number(CMr[k]) || 0; }, W = d.web, wP = cmP(CH_WEB), wCm = Math.round((W.c != null ? W.c : W.r) * wP / 100);
    var saleN = OTYPES.reduce(function (s0, t) { return s0 + d.ot[t][0]; }, 0), saleR = OTYPES.reduce(function (s0, t) { return s0 + d.ot[t][1]; }, 0), saleCm = OTYPES.reduce(function (s0, t) { return s0 + Math.round((d.ot[t][2] != null ? d.ot[t][2] : d.ot[t][1]) * cmP(t) / 100); }, 0);
    var chKpi = kpi('💬 Sale lên đơn', moneyShort(saleR), '', '', saleN + ' đơn · ' + (saleR + W.r ? Math.round(saleR / (saleR + W.r) * 100) : 0) + '% doanh số') +
      kpi('🌐 Khách tự đặt trên web', moneyShort(W.r), '', '', W.n + ' đơn' + (W.n ? ' · ' + Object.keys(W.src).sort(function (a, b) { return W.src[b] - W.src[a]; }).map(function (k) { return esc(k) + ' ' + W.src[k]; }).join(', ') : '') + (wP ? ' · hoa hồng ' + wP + '% = <b>' + money(wCm) + '</b>' : ''));
    var body = '<div class="box"><div class="kpis" style="margin:0 0 10px">' + sumKpi + '</div><h3 style="margin:4px 0 8px">Theo kênh đơn</h3><div class="kpis" style="margin:0 0 10px">' + chKpi + '</div>' +
      '<h3 style="margin:4px 0 8px">🕘 Theo giờ lên đơn</h3><div class="kpis" style="margin:0 0 10px">' + HR_KEYS.filter(function (k) { return T.hrN[k] || k === 'Trong giờ' || k === 'Ngoài giờ'; }).map(function (k) { var tt = HR_KEYS.reduce(function (s0, j) { return s0 + T.hrR[j]; }, 0); return kpi(HR_ICON[k] + ' ' + (k === 'Trong giờ' ? 'Giờ hành chính' : k === 'Ngoài giờ' ? 'Tối / Chủ nhật' : k), moneyShort(T.hrR[k]), '', '', T.hrN[k] + ' đơn' + (tt ? ' · ' + Math.round(T.hrR[k] / tt * 100) + '%' : '') + ' · ' + esc(hourTip(k))); }).join('') + '</div>' +
      '<h3 style="margin:4px 0 8px">Đơn sale lên – theo loại đơn (tính hoa hồng)</h3><div class="kpis" style="margin:0">' + OTYPES.map(function (t) { var p = cmP(t), x = d.ot[t]; return kpi(OT[t][0] + ' ' + t, moneyShort(x[1]), '', '', x[0] + ' đơn' + (p ? ' · hoa hồng ' + p + '% = <b>' + money(Math.round((x[2] != null ? x[2] : x[1]) * p / 100)) + '</b>' : '')); }).join('') +
      (OTYPES.concat([CH_WEB]).some(cmP) ? kpi('💰 Tổng hoa hồng', moneyShort(saleCm + wCm), 'good', '', 'đơn sale ' + moneyShort(saleCm) + ' + đơn web ' + moneyShort(wCm) + ' · tạm tính, đơn chờ kiểm tra loại vẫn tính') : '') + '</div>' +
      '<p class="small muted" style="margin:8px 0 0">Đơn web = khách tự đặt trên thucduonglanh.vn, tính cho sale đang phụ trách khách lúc đặt. Đơn web không tính vào 4 loại đơn ở trên mà tính theo % hoa hồng đơn web.</p></div>' +
      '<div class="box"><div class="bcdt-wrap"><table class="bcdt"><thead>' + head + '</thead><tbody>' + tr(d.tot, 'tot') + d.rows.map(function (r) { return tr(r); }).join('') + '</tbody></table></div>' +
      '<p class="small muted" style="margin:8px 0 0">Khách mới = đơn đầu tiên của khách. Data mới = số quảng cáo vào CRM trong ngày. Đơn huỷ không tính; đơn hoàn tính riêng.</p></div>';
    var m = modal('📊 BCDT ' + monthLabel(month) + (name ? ' – ' + esc(name) : ' – cả nhóm'), body, '<button class="btn" data-close>Đóng</button><button class="btn pri" id="bcCsv">⬇️ Tải file Excel (CSV)</button>');
    $('#bcCsv', m).onclick = function () {
      var lines = [cols.map(function (c) { return c[0]; })].concat([d.tot].concat(d.rows).map(function (r) { return cols.map(function (c) { return c[1](r); }); }));
      var csv = '﻿' + lines.map(function (l) { return l.map(function (v) { v = String(v == null ? '' : v); return /[",\n;]/.test(v) ? '"' + v.replace(/"/g, '""') + '"' : v; }).join(','); }).join('\n');
      var a = document.createElement('a'); a.href = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8' })); a.download = 'BCDT-' + month + (name ? '-' + slugName(name) : '-ca-nhom') + '.csv'; document.body.appendChild(a); a.click(); setTimeout(function () { URL.revokeObjectURL(a.href); a.remove(); }, 500);
    };
  }

  /* ================================================================ CÀI ĐẶT */
  function viewSettings() {
    var h = '<div class="page-head"><h1>Cài đặt</h1></div>', G = {};
    G.acc = '<div class="box"><h3>Tài khoản</h3><p style="margin:0 0 10px"><b>' + esc(S.user.name) + '</b> · ' + esc(S.user.email) + (lvl() >= 2 ? ' · ' + esc(S.user.role) : '') + '</p><button class="btn danger" id="logout">Đăng xuất</button></div>';
    G.tg = '<div class="box"><h3>📲 Thông báo Telegram riêng</h3>' + (S.user.tg
      ? '<p style="margin:0 0 10px">✅ Đã kết nối. ' + (isMkt() ? 'Bạn nhận tin <b>📣 Marketing sáng nay</b> lúc 8h: tiến độ mục tiêu kênh của bạn, hôm qua, việc nên làm.' : 'Bạn nhận riêng: đơn mới của khách mình phụ trách, khách hỏi mới được giao, danh sách việc lúc 8h sáng.') + '</p><button class="btn ghost" id="tgOff">Ngắt kết nối</button>'
      : '<p style="margin:0 0 10px">' + (isMkt() ? 'Nhận tin <b>📣 Marketing sáng nay</b> lúc 8h qua Telegram (tiến độ mục tiêu, việc nên làm).' : 'Nhận thông báo về khách <b>của riêng bạn</b> qua Telegram.') + ' Làm 1 lần, mất 30 giây:</p><ol style="margin:0 0 10px;padding-left:20px"><li>Bấm <b>“Kết nối Telegram”</b>.</li><li>Bấm <b>“Mở Telegram”</b> → trong Telegram bấm <b>Start / Bắt đầu</b>.</li><li>Quay lại đây bấm <b>“Tôi đã bấm Start”</b>.</li></ol><div class="steps" id="tgSteps"><button class="btn pri" id="tgLink">Kết nối Telegram</button></div>') + '</div>';
    if (isMkt()) return h + setGroup('acc', '👤 Tài khoản của tôi', esc(S.user.name) + ' · ' + esc(S.user.email), G.acc) + G.tg + setGroup('qz', '🖐 Trò chơi “Bạn còn mấy ngón tay?”', 'Sửa câu hỏi trò chơi trên web · màn hình chơi nhóm', qzeBox()) + '<div class="box"><h3>📣 Tài khoản Marketing</h3><p style="margin:0 0 8px">Bạn xem được tab <b>Marketing</b>: chi phí quảng cáo, khách mới và tiền khách mới mỗi kênh mang về, data quảng cáo, chiến dịch. Chi phí TikTok, Google, KOL… bấm <b>⚙️ Nhập chi phí</b> để nhập file hoặc nhập tay.</p><p style="margin:0 0 8px">Tab <b>Khách hỏi</b>: xem khách để lại số trên web (chỉ xem, quản lý giao cho sale).</p><p class="small muted" style="margin:0 0 10px">Số điện thoại khách chỉ dùng cho công việc, không chép ra ngoài (Nghị định 13/2023).</p><a class="btn" href="/huong-dan/crm/" target="_blank" rel="noopener">📖 Xem hướng dẫn</a></div>';
    G.lim = '<div class="box"><h3>🎯 Số khách chăm sóc mỗi ngày</h3><p class="small muted" style="margin:0 0 8px">Tab Hôm nay chỉ đưa ra tối đa bấy nhiêu khách mỗi ngày (khách quan trọng trước). Khách chưa tới lượt tự dời sang hôm sau. Cài trên máy này.</p>' +
      '<div style="display:flex;gap:8px;align-items:center"><input type="number" id="dayLim" min="5" max="200" value="' + dayLimit() + '" style="max-width:110px"><button class="btn" id="dayLimSave">Lưu</button></div></div>';
    var cc = {}; CAT_ORDER.forEach(function (k) { cc[k] = catColor(k); });
    var tg = S.f.tags || (S.f.tags = myTags().map(function (t) { return { name: t.name, color: t.color }; }));
    G.color = '<div class="box"><h3>🎨 Màu phân loại khách</h3><p class="hint" style="margin:0 0 10px">Thẻ khách và thẻ đơn được tô màu tự động theo loại. Bạn đổi màu tuỳ ý, hoặc tạo thêm nhãn riêng rồi gắn cho khách trong hồ sơ khách.</p>' +
      '<div class="color-rows">' + CAT_ORDER.map(function (k) { return '<label class="color-row"><input type="color" data-cc="' + k + '" value="' + cc[k] + '"><span><b>' + CAT_DEF[k].label + '</b><small>' + CAT_DEF[k].tip + '</small></span></label>'; }).join('') + '</div>' +
      '<h3 style="margin:14px 0 8px">Nhãn riêng của bạn</h3><div class="color-rows" id="tagRows">' + tg.map(function (t, i) { return '<div class="color-row" data-ti="' + i + '"><input type="color" data-tk="color" value="' + esc(t.color) + '"><input type="text" data-tk="name" value="' + esc(t.name) + '" placeholder="Tên nhãn (vd Khách thân)" maxlength="30"><button class="rm" data-deltag="' + i + '" aria-label="Xoá">✕</button></div>'; }).join('') + '</div>' +
      '<div class="steps" style="margin-top:10px"><button class="btn" data-addtag>＋ Thêm nhãn</button><button class="btn pri" id="prefSave">Lưu màu & nhãn</button><button class="btn ghost" id="prefReset">Về màu mặc định</button></div></div>';
    G.guide = '<div class="box guide"><h3>Hướng dẫn nhanh</h3><ol>' +
      '<li>Mỗi sáng mở <b>Hôm nay</b>, bấm <b>▶ Bắt đầu gọi lần lượt</b>. Với mỗi khách: <b>📞 Gọi</b> → nói chuyện → <b>💬 Ghi lại</b> kết quả. Khách không nghe máy thì bấm <b>📵 Không nghe</b>, 2 ngày sau CRM tự nhắc.</li>' +
      '<li>Khách đặt qua Zalo / điện thoại: <b>Đơn hàng → ＋ Tạo đơn</b>. Khách hỏi mà chưa mua: <b>Khách hỏi → ＋ Thêm khách hỏi</b>.</li>' +
      '<li>Mỗi đơn chỉ có 1 nút xanh là việc tiếp theo (Xác nhận → Đang giao → Đã giao). Cứ bấm theo nút đó.</li>' +
      '<li>Đầu tháng vào <b>Hiệu quả</b> bấm <b>🎯 Đặt mục tiêu</b>. Màu ở mọi màn hình: 🟢 tốt · 🟠 cần để ý · 🔴 cần xử lý (có dòng chú thích ngay trên màn hình).</li>' +
      '<li>Kết nối <b>📲 Telegram</b> (mục ngay dưới) để nhận việc mỗi sáng. Chỉ gửi ưu đãi khi khách đã đồng ý (ô <b>☐ Khách đồng ý nhận ưu đãi</b> trong hồ sơ).</li>' +
      '</ol><p style="margin:10px 0"><a class="btn" href="/huong-dan/crm/" target="_blank" rel="noopener">📖 Xem hướng dẫn đầy đủ</a></p><p class="small muted" style="margin:6px 0 0">Không chụp màn hình, không gửi danh sách khách ra ngoài: đây là dữ liệu cá nhân, pháp luật yêu cầu giữ kín (Nghị định 13/2023).</p></div>';
    h += '<p class="small muted set-intro">Bấm vào từng mục để mở. Dòng nhỏ dưới tên mục là đang cài thế nào; có <b>⚠️</b> là nên làm.</p>';
    h += setSec('🙋 Của tôi', setGroup('guide', '📖 Hướng dẫn nhanh', 'Những điều cần biết khi dùng CRM hằng ngày', G.guide, true) +
      setGroup('tg', '📲 Nhận thông báo qua Telegram', S.user.tg ? '✅ Đã kết nối' : '⚠️ Chưa kết nối · bấm để kết nối (30 giây)', G.tg, !S.user.tg) +
      setGroup('ref', '🌐 Link đặt hàng của tôi', 'Gửi khách tự đặt trên web, đơn vẫn tính cho bạn', '<div class="box ref-box"><p class="small muted" style="margin:0 0 8px">Khách bấm link rồi đặt trên web trong 30 ngày: đơn tự tính cho bạn (khách mới tự giao cho bạn phụ trách). Khách cũ đang do bạn phụ trách thì đặt bằng link nào cũng tính cho bạn. Web rẻ hơn Shopee, có quà ebook / 4 buổi Zoom cùng chuyên gia.</p>' + refLinks(S.user.name) + '</div>') +
      setGroup('acc', '👤 Tài khoản của tôi', esc(S.user.name) + ' · ' + esc(S.user.role), G.acc) +
      setGroup('lim', '🎯 Số khách chăm sóc mỗi ngày', 'Tối đa ' + dayLimit() + ' khách / ngày', G.lim) +
      setGroup('color', '🎨 Màu thẻ khách & nhãn riêng', myTags().length ? myTags().length + ' nhãn riêng' : 'Đổi màu, tạo nhãn riêng', G.color));
    if (lvl() < 2) return h + setSec('🔗 Khách của tôi', setGroup('mrg', '🔗 Khách dùng nhiều số', '1 khách mua bằng 2–3 số: gộp về 1 hồ sơ', mrgBox()));
    var R = S.d.rules || {};
    G.rules = '<div class="box"><h3>⭐ Nhóm khách (VIP, Sắp mất)</h3><p class="hint" style="margin:0 0 10px">Máy tự xếp nhóm cho khách theo các mức dưới đây.</p>' +
      '<div class="row2c"><label class="f"><span>VIP khi mua từ (số đơn)</span><input type="number" id="rVipN" min="1" value="' + esc(R.vipOrders || 3) + '"></label>' +
      '<label class="f"><span>hoặc tổng chi từ</span><input type="text" id="rVipS" inputmode="decimal" value="' + esc(R.vipSpent || 2000000) + '" placeholder="vd 5tr"></label></div>' +
      '<label class="f"><span>“Sắp mất” khi bao nhiêu ngày chưa mua lại</span><input type="number" id="rRisk" min="7" value="' + esc(R.atRisk || 60) + '"></label>' +
      '<label class="f"><span>🕑 Khách vừa được chăm sóc thì bao nhiêu ngày sau mới nhắc lại</span><input type="number" id="rCool" min="0" max="60" value="' + esc(R.coolDays === undefined ? 14 : R.coolDays) + '"></label>' +
      '<p class="hint">Khách đã trả lời (không tính “Không nghe máy”) trong số ngày này thì CRM <b>không</b> nhắc sắp hết hàng, xin cảm nhận, giới thiệu sản phẩm, mời quay lại. Vẫn nhắc <b>hẹn gọi lại</b> và <b>hỏi nhận hàng</b> đơn mới. Ghi <b>0</b> = tắt.</p>' +
      '<div class="row2c"><label class="f"><span>🚚 Số ngày giao: khách miền Bắc (gần)</span><input type="number" id="rShip" min="0" max="15" value="' + esc(R.shipDays === undefined ? 3 : R.shipDays) + '"></label>' +
      '<label class="f"><span>🚚 Số ngày giao: miền Trung, miền Nam (xa)</span><input type="number" id="rShipFar" min="0" max="15" value="' + esc(R.shipFar === undefined ? 5 : R.shipFar) + '"></label></div>' +
      '<p class="hint">CRM tự đọc tỉnh trong địa chỉ khách. <b>Gần</b> = Hà Nội, các tỉnh miền Bắc, Thanh Hóa, Nghệ An, Hà Tĩnh. <b>Xa</b> = từ Quảng Trị trở vào. Không đọc được tỉnh thì lấy trung bình 2 mức. Hỏi nhận hàng vào <b>1 ngày sau</b> ngày hàng dự kiến tới (gần: ngày thứ 4, xa: ngày thứ 6 sau khi đặt). Nhắc đặt lại trước ngày hết hàng (số ngày giao + 1) để đơn mới tới kịp.</p>' +
      '<label class="f"><span>🌟 Khách quen sản phẩm khi đã mua sản phẩm đó từ (lần)</span><input type="number" id="rFam" min="0" max="10" value="' + esc(R.famMin === undefined ? 1 : R.famMin) + '"></label>' +
      '<p class="hint">Khách quen (mua lại đúng sản phẩm đã dùng, lần mua trước trong 6 tháng, đơn trước không bị hoàn) đã biết cách dùng: CRM <b>bỏ qua</b> hỏi nhận hàng, hỏi thăm 7 ngày, xin cảm nhận 14 ngày. Vẫn nhắc <b>sắp hết hàng</b>, giới thiệu sản phẩm 30 ngày, mời quay lại. Ghi <b>0</b> = tắt (ai cũng gọi đủ các mốc).</p>' +
      '<p class="hint">Các mốc chăm sóc (hỏi nhận hàng, sắp hết hàng, xin cảm nhận…) tính từ <b>ngày khách nhận hàng</b>: ngày đơn chuyển “Đã giao”, hoặc ngày sale bấm “Đã nhận hàng” khi gọi. Chưa biết ngày nhận thì máy ước tính = <b>ngày gửi</b> + số ngày giao theo vùng (đơn chưa ghi ngày gửi: ngày đặt + số ngày giao).</p>' +
      '<p class="hint" id="rHint"></p><button class="btn pri" id="rSave">Lưu nhóm khách</button></div>';
    var CMc = R.commission || {};
    G.cm = '<div class="box"><h3>💰 Hoa hồng</h3><p class="hint" style="margin:0 0 10px">% hoa hồng trên tiền hàng của đơn (không gồm phí ship, đã trừ huỷ / hoàn). Báo cáo BCDT tự tính hoa hồng tháng cho từng sale. Để trống = chưa tính.</p><div class="row2c">' +
      OTYPES.map(function (t) { return '<label class="f"><span>' + OT[t][0] + ' ' + t + ' (%)</span><input type="text" inputmode="decimal" data-cm="' + esc(t) + '" value="' + esc(CMc[t] === undefined ? '' : CMc[t]) + '" placeholder="vd 5"></label>'; }).join('') +
      '<label class="f"><span>🌐 Đơn khách tự đặt trên web (%)</span><input type="text" inputmode="decimal" data-cm="' + CH_WEB + '" value="' + esc(CMc[CH_WEB] === undefined ? '' : CMc[CH_WEB]) + '" placeholder="vd 2"></label>' +
      '</div><p class="hint">Đơn web (khách tự đặt trên thucduonglanh.vn) tính <b>riêng</b> theo % này, không theo 4 loại đơn. Hoa hồng đơn web tính cho sale đang phụ trách khách lúc khách đặt. Xem ở <b>Đơn hàng → Tất cả đơn → 🌐 Khách tự đặt trên web</b> và báo cáo BCDT.</p><p class="hint">Loại đơn do sale chọn khi lên đơn (CRM chọn sẵn theo gợi ý: Lễ → Ngoài giờ → Khách mới / cũ; khách để lại số qua quảng cáo trong 30 ngày tính là Khách mới). Đơn sale chọn khác gợi ý hiện ở <b>Đơn hàng → Cần xử lý → Kiểm tra loại đơn</b>.</p><button class="btn pri" id="cmSave">Lưu hoa hồng</button></div>';
    if (lvl() >= 3) { var DA = dashAds();
      G.da = '<div class="box"><h3>🚦 Mức đèn Tổng quan</h3><p class="hint" style="margin:0 0 10px">Ô <b>📣 Quảng cáo</b> ở tab Tổng quan và mục <b>Cần chú ý</b> tô màu theo <b>chi phí quảng cáo ÷ tiền khách mới mua</b>. Áp dụng cho mọi Quản trị.</p><div class="row2c">' +
        '<label class="f"><span>🟢 Xanh khi dưới (%)</span><input type="text" inputmode="decimal" id="daGood" value="' + DA[0] + '"></label>' +
        '<label class="f"><span>🔴 Đỏ khi trên (%)</span><input type="text" inputmode="decimal" id="daBad" value="' + DA[1] + '"></label></div>' +
        '<p class="hint" id="daHint"></p><button class="btn pri" id="daSave">Lưu mức đèn</button></div>';
      var KG = kpGoal(), kf = function (id, l, v, ph) { return '<label class="f"><span>' + l + '</span><input type="text" inputmode="decimal" id="' + id + '" value="' + (v || '') + '" placeholder="' + ph + '"></label>'; };
      G.kpi = '<div class="box"><h3>📊 Mức tốt chỉ số quảng cáo</h3><p class="hint" style="margin:0 0 10px">Tab <b>📣 Marketing → 📊 Chỉ số chiến dịch hôm nay</b> tô đèn theo các mức này: 🟢 đạt · 🟠 kém hơn tới 20% · 🔴 kém hơn nhiều. Để trống ô nào thì ô đó so với trung bình 7 ngày trước của chiến dịch.</p><div class="row2c">' +
        kf('kpCpm', 'CPM tốt khi dưới (đ / 1.000 lượt thấy)', KG.cpm, 'vd 40000') + kf('kpCtr', 'CTR tốt khi từ (%)', KG.ctr, 'vd 1,5') + '</div><div class="row2c">' +
        kf('kpCpc', 'CPC tốt khi dưới (đ / 1 lượt bấm)', KG.cpc, 'vd 3000') + kf('kpMsg', 'Giá 1 tin nhắn tốt khi dưới (đ)', KG.msg, 'vd 100000') + '</div><div class="row2c">' + kf('kpSdt', '⭐ Giá 1 SĐT tốt khi dưới (đ)', KG.sdt, 'vd 300000') + '</div>' +
        '<button class="btn pri" id="kpSave">Lưu mức tốt</button></div>'; }
    var md = mode(), staff = (S.d.users || []).filter(function (u) { return u.active !== false && u.role !== 'Marketing'; }), noOwner = S.d.customers.filter(function (c) { return !c.owner; }).length;
    G.mode = '<div class="box"><h3>👥 Chia khách & phân quyền</h3><p class="hint" style="margin:0 0 10px">Sale & CSKH chỉ thấy khách mình phụ trách. Quản lý thấy tất cả.</p>' +
      '<div class="f"><span style="display:block;font-size:13px;font-weight:600;margin-bottom:6px;color:var(--ink)">Khách mới được giao thế nào?</span>' +
      Object.keys(MODE_INFO).map(function (k) { return '<label class="mode"><input type="radio" name="amode" value="' + k + '"' + (k === md ? ' checked' : '') + '><span><b>' + MODE_INFO[k][0] + '</b>' + MODE_INFO[k][1] + '</span></label>'; }).join('') + '</div>' +
      '<button class="btn pri" id="modeSave">Lưu cách chia khách</button>' +
      '<h3 style="margin:18px 0 8px">Ai được nhận khách mới?</h3><div class="edit-table">' + staff.map(function (u) {
        return '<div class="staff-row"><b>' + esc(u.name) + '</b><span class="muted small">' + esc(u.role) + (u.tg ? ' · 📲 Telegram ✓' : ' · chưa kết nối Telegram') + '</span><label class="switch"><input type="checkbox" data-recv="' + esc(u.name) + '"' + (u.recv ? ' checked' : '') + '> Nhận khách mới</label></div>';
      }).join('') + '</div>' +
      '<h3 style="margin:18px 0 8px">Chia / chuyển khách</h3>' +
      '<p style="margin:0 0 8px">Có <b>' + noOwner + '</b> khách chưa ai phụ trách.</p><button class="btn" id="spreadBtn"' + (noOwner ? '' : ' disabled') + '>Chia đều cho những người đang “Nhận khách mới”</button>' +
      '<div class="row2c" style="margin-top:12px"><label class="f"><span>Chuyển toàn bộ khách của</span><select id="mvFrom">' + ownerOptions('', true) + '</select></label><label class="f"><span>sang</span><select id="mvTo">' + ownerOptions('', true) + '</select></label></div>' +
      '<button class="btn" id="moveBtn">Chuyển khách</button><p class="hint" style="margin:8px 0 0">Dùng khi nhân viên nghỉ việc hoặc đổi ca. Khách hỏi đang theo dõi cũng được chuyển theo.</p></div>';
    G.dup = '<div class="box"><h3>🔀 Khách trùng sale</h3><p class="hint" style="margin:0 0 10px">Khách có trong file Sheet của 2 sale trở lên (trước khi gộp văn phòng, mỗi bạn chăm riêng). Mỗi khách chỉ để <b>1 sale phụ trách chính</b>: chọn người giữ rồi bấm <b>Chốt</b>. Đã chốt thì CRM không báo trùng nữa, các bạn không cần xoá dòng trong file.</p>' +
      '<button class="btn pri" id="dupOpen">Xem khách trùng sale</button></div>';
    G.mrg = mrgBox();
    var cy = S.f.cy || (S.f.cy = S.d.cycles.map(function (r) { return r.slice(); }));
    G.cy = '<div class="box"><h3>Chu kỳ dùng sản phẩm</h3><p class="hint" style="margin:0 0 10px">Khách dùng hết 1 hộp/hũ trong bao nhiêu ngày → máy tính ngày “sắp hết hàng” để nhắc đặt lại. Tên chỉ cần chứa 1 phần (ví dụ “DILVANG”). Quy cách để trống = mọi quy cách.</p>' +
      '<div class="edit-table" id="cyT"><div class="edit-row head"><span>Tên sản phẩm (chứa chữ)</span><span>Quy cách</span><span>Số ngày</span><span>Căn cứ</span><span></span></div>' +
      cy.map(function (r, i) { return '<div class="edit-row" data-i="' + i + '"><input type="text" data-k="0" value="' + esc(r[0]) + '" placeholder="Tên sản phẩm"><input type="text" data-k="1" value="' + esc(r[1]) + '" placeholder="vd 500g"><input type="number" data-k="2" min="1" value="' + esc(r[2]) + '" placeholder="Ngày"><input type="text" data-k="3" value="' + esc(r[3]) + '" placeholder="Căn cứ / ghi chú"><button class="rm" data-rm="cy" data-i="' + i + '" aria-label="Xoá">✕</button></div>'; }).join('') +
      '</div><div class="steps" style="margin-top:10px"><button class="btn" data-add="cy">＋ Thêm dòng</button><button class="btn pri" id="cySave">Lưu chu kỳ</button></div></div>';
    var tp = S.f.tp || (S.f.tp = S.d.templates.map(function (r) { return r.slice(); }));
    G.tp = '<div class="box"><h3>Mẫu tin nhắn chăm sóc</h3><p class="hint" style="margin:0 0 10px">Dùng <b>[Tên]</b> và <b>[Sản phẩm]</b>, máy tự thay khi nhắn. Cột “Thời điểm” cần chứa “1 ngày”, “hết”, “14”, “30”, “60” để tự chọn đúng mẫu cho từng việc. Mẫu <b>tặng quà</b>: Thời điểm “Quà tặng”, Mục đích có chữ “cẩm nang” hoặc “ebook”, dùng <b>[Link quà]</b> (máy tự điền link); để trống thì CRM dùng mẫu có sẵn.</p>' +
      '<div class="edit-table" id="tpT">' + tp.map(function (r, i) { return '<div class="edit-row tpl" data-i="' + i + '"><input type="text" data-k="0" value="' + esc(r[0]) + '" placeholder="Thời điểm"><input type="text" data-k="1" value="' + esc(r[1]) + '" placeholder="Mục đích"><button class="rm" data-rm="tp" data-i="' + i + '" aria-label="Xoá">✕</button><textarea data-k="2" rows="3" placeholder="Nội dung tin">' + esc(r[2]) + '</textarea></div>'; }).join('') +
      '</div><div class="steps" style="margin-top:10px"><button class="btn" data-add="tp">＋ Thêm mẫu</button><button class="btn pri" id="tpSave">Lưu mẫu tin</button></div></div>';
    if (lvl() >= 3) {
      var us = S.f.us || (S.f.us = S.d.users.map(function (u) { return { email: u.email, name: u.name, role: u.role, active: u.active !== false, alias: u.alias || '', prefix: u.prefix || '', web: !!u.web, mkv: !!u.mkv }; }));
      G.us = '<div class="box"><h3>Nhân sự được vào CRM</h3><p class="hint" style="margin:0 0 10px"><b>Quản trị</b>: toàn quyền. <b>Quản lý</b>: thêm xem doanh số, sửa chu kỳ & mẫu tin. <b>Sale & CSKH</b>: bán hàng, chăm sóc khách mình phụ trách, xử lý đơn. <b>Marketing</b>: tab 📣 Marketing (chi phí, hiệu quả quảng cáo, tự nhập chi phí) + xem (không sửa) khách để lại số trên web ở tab Khách hỏi; không thấy khách đã mua, đơn, doanh số công ty. Khách để lại số trên web luôn chờ Quản lý / Quản trị giao, sale không tự nhận. Muốn Quản lý / Sale xem thêm số marketing: tích <b>📣 Xem Marketing</b> dưới tên người đó (chỉ xem, không sửa). Nhân viên nghỉ việc: bỏ tích “Đang dùng” là không vào được nữa.</p>' +
        '<p class="hint" style="margin:0 0 10px"><b>Tên trong file QC</b>: tên sale như đang ghi ở cột Sale của file số quảng cáo (nhiều cách viết thì cách nhau dấu phẩy, vd “Phương, PHƯƠNG”). <b>Tiền tố mã đơn</b>: vd “Phuong” → mã đơn Phuong300926-01.</p>' +
        '<div class="edit-table" id="usT"><div class="edit-row usr head"><span>Email</span><span>Tên hiển thị</span><span>Quyền</span><span>Đang dùng</span><span></span></div>' +
        us.map(function (u, i) { return '<div class="edit-row usr" data-i="' + i + '"><input type="email" data-k="email" value="' + esc(u.email) + '" placeholder="email@gmail.com"><input type="text" data-k="name" value="' + esc(u.name) + '" placeholder="Tên"><select data-k="role">' + ['Quản trị', 'Quản lý', 'Marketing', 'Sale & CSKH'].map(function (r) { return '<option value="' + esc(r) + '"' + (r === u.role ? ' selected' : '') + '>' + esc(r) + '</option>'; }).join('') + '</select><label class="switch"><input type="checkbox" data-k="active"' + (u.active ? ' checked' : '') + '> Có</label><button class="rm" data-rm="us" data-i="' + i + '" aria-label="Xoá">✕</button>' +
          '<input type="text" data-k="alias" value="' + esc(u.alias || '') + '" placeholder="Tên trong file QC (vd Phương)" class="usr-x"><input type="text" data-k="prefix" value="' + esc(u.prefix || '') + '" placeholder="Tiền tố mã đơn (vd Phuong)" class="usr-x"><label class="switch usr-w"><input type="checkbox" data-k="web"' + (u.web || u.role === 'Quản trị' ? ' checked' : '') + (u.role === 'Quản trị' ? ' disabled' : '') + '> 🌐 Sửa website (đăng bài, sửa sản phẩm ở thucduonglanh.vn/admin)</label>' +
          (u.role === 'Quản lý' || u.role === 'Sale & CSKH' ? '<label class="switch usr-w"><input type="checkbox" data-k="mkv"' + (u.mkv ? ' checked' : '') + '> 📣 Xem Marketing (chỉ xem tab Marketing: chi phí, hiệu quả quảng cáo; không sửa)</label>' : '') + '</div>'; }).join('') +
        '</div><div class="steps" style="margin-top:10px"><button class="btn" data-add="us">＋ Thêm người</button><button class="btn pri" id="usSave">Lưu nhân sự</button></div></div>';
    }
    // ---- gom thành nhóm, mỗi mục 1 dòng tóm tắt
    var ca = R.ca || {}, hol = ca.holidays || ['01/01', '30/04', '01/05', '02/09'], cmOn = Object.keys(CMc).filter(function (k) { return CMc[k] !== '' && CMc[k] != null; });
    var act = (S.d.users || []).filter(function (u) { return u.active !== false; }), mk = act.filter(function (u) { return u.role === 'Marketing'; }).length, recvN = staff.filter(function (u) { return u.recv; }).length;
    if (G.us) h += setSec('👥 Nhân sự', setGroup('us', '🧑‍💼 Ai được vào CRM', act.length + ' người đang dùng' + (mk ? ' · ' + mk + ' marketing' : '') + ' · thêm / khoá người, đổi quyền', G.us));
    h += setSec(G.us ? '🤝 Chia khách' : '👥 Chia khách', setGroup('mode', '🔀 Khách mới giao cho ai', MODE_INFO[md][0] + ' · ' + recvN + ' người nhận khách mới' + (noOwner ? ' · ⚠️ ' + noOwner + ' khách chưa ai phụ trách' : ''), G.mode) +
      setGroup('dup', '👯 Khách trùng sale', 'Khách có ở file của 2 sale: chọn 1 người giữ', G.dup) +
      setGroup('mrg', '🔗 Khách dùng nhiều số', '1 khách mua bằng 2–3 số: gộp về 1 hồ sơ', G.mrg));
    h += setSec('🛒 Bán hàng & chăm sóc', setGroup('rules', '⭐ Nhóm khách & lịch nhắc', 'VIP từ ' + (R.vipOrders || 3) + ' đơn hoặc ' + moneyShort(R.vipSpent || 2000000) + ' · Sắp mất sau ' + (R.atRisk || 60) + ' ngày · nhắc lại sau ' + (R.coolDays === undefined ? 14 : R.coolDays) + ' ngày', G.rules) +
      setGroup('cy', '📦 Bao lâu khách dùng hết 1 hộp', cy.length + ' sản phẩm · để nhắc khách đặt lại đúng lúc', G.cy) +
      setGroup('tp', '💬 Mẫu tin nhắn chăm sóc', tp.length + ' mẫu', G.tp) +
      setGroup('cm', '💰 Hoa hồng', cmOn.length ? cmOn.map(function (k) { return esc(k) + ' ' + CMc[k] + '%'; }).join(' · ') : '⚠️ Chưa đặt % hoa hồng', G.cm) +
      setGroup('ca', '🕘 Ca tối & ngày lễ', 'Ca tối từ ' + esc(ca.evening || '17:30') + ' · ' + hol.length + ' ngày lễ', caBox()) +
      setGroup('vc', '🎟 Mã ưu đãi đặt hàng web', 'Tạo mã giảm giá gửi riêng khách cũ, đối tác', vcBox()) +
      setGroup('pt', '🤝 Cộng tác viên & khách giới thiệu', 'Link, mã giảm giá, hoa hồng, đối soát CTV', ptBox()) +
      setGroup('qz', '🖐 Trò chơi “Bạn còn mấy ngón tay?”', 'Sửa câu hỏi trò chơi trên web · màn hình chơi nhóm', qzeBox()));
    if (lvl() >= 3) {
      var src = S.d.sources || [], ads = S.d.ads, SB = syncBoxes(), cut = SB.indexOf('<div class="box"><h3>📣');
      h += setSec('🔌 Kết nối & báo cáo', setGroup('src', '📂 File Google Sheet của sale', src.length ? src.length + ' file' : '⚠️ Chưa có file nào', SB.slice(0, cut)) +
        setGroup('ads', '📣 File số quảng cáo chung', ads && ads.fileId ? '✅ ' + (ads.auto ? 'Tự lấy số 10 phút / lần' : 'Lấy số bằng tay') + (ads.last ? ' · lần cuối ' + when(ads.last) : '') : '⚠️ Chưa kết nối', SB.slice(cut)) +
        setGroup('mdoc', '🗺 Ảnh hệ thống Marketing', mktDoc().url ? '✅ Có link' + (mktDoc().at ? ' · đổi ' + esc(mktDoc().at) : '') + ' · nút ở đầu tab Marketing' : '⚠️ Chưa có link', '<div class="box"><p class="hint" style="margin:0 0 10px">Nút <b>🗺 Hệ thống Marketing</b> ở đầu tab Marketing mở link này. Cập nhật ảnh trên Canva thì dán link mới (Chia sẻ → Xem công khai → Sao chép liên kết).</p>' +
          '<div class="steps"><input type="url" id="mdocUrl" value="' + esc(mktDoc().url || '') + '" placeholder="https://www.canva.com/design/…/view" style="flex:1;min-width:220px"><button class="btn pri" id="mdocSave">Lưu link</button>' + (mktDoc().url ? '<a class="btn ghost" href="' + esc(mktDoc().url) + '" target="_blank" rel="noopener">Mở thử</a>' : '') + '</div></div>') +
        setGroup('da', '🚦 Mức đèn quảng cáo ở Tổng quan', '🟢 dưới ' + DA[0] + '% · 🔴 trên ' + DA[1] + '%', G.da) +
        setGroup('kpi', '📊 Mức tốt chỉ số quảng cáo', (function (k) { var t = [k.cpm ? 'CPM < ' + moneyShort(k.cpm) : '', k.ctr ? 'CTR ≥ ' + oneDec(k.ctr) + '%' : '', k.cpc ? 'CPC < ' + moneyShort(k.cpc) : '', k.msg ? '1 tin < ' + moneyShort(k.msg) : '', k.sdt ? '1 SĐT < ' + moneyShort(k.sdt) : ''].filter(Boolean).join(' · '); return t || '⚠️ Chưa đặt, đang so với trung bình 7 ngày'; })(kpGoal()), G.kpi) +
        setGroup('cms', '🌐 Trang quản trị website', cmsLine(), cmsBox()));
    }
    return h;
  }
  /** 🌐 Trang quản trị website (Quản trị): mã GitHub của công ty để nhân sự đăng nhập thucduonglanh.vn/admin bằng email (api/src/cms.js). Trạng thái tải khi mở Cài đặt. */
  function cmsLine() {
    var c = S.f.cms; if (!c) return 'Đang kiểm tra…';
    var webN = (S.d.users || []).filter(function (u) { return u.active !== false && u.web; }).length;
    if (!c.has) return '⚠️ Chưa kết nối GitHub · nhân sự chưa đăng nhập bằng email được';
    var left = c.exp ? Math.round((new Date(c.exp) - Date.now()) / 864e5) : null;
    return (left !== null && left < 14 ? '⚠️ Mã GitHub hết hạn ' + (left < 0 ? 'rồi' : 'sau ' + left + ' ngày') : '✅ Đã kết nối' + (c.exp ? ' · mã hết hạn ' + fDate(new Date(c.exp).getTime()) : '')) + ' · ' + webN + ' người được sửa website';
  }
  function cmsBox() {
    var c = S.f.cms || {};
    return '<div class="box"><p class="small">Nhân sự vào <a href="https://thucduonglanh.vn/admin/" target="_blank" rel="noopener">thucduonglanh.vn/admin</a> → <b>Đăng nhập bằng email</b> → nhập email → mã 6 số gửi về email. Không cần tài khoản GitHub. Ai được vào: bật ô <b>🌐 Sửa website</b> ở mục Nhân sự (Quản trị luôn được).</p>' +
      '<p class="small">Máy chủ dùng 1 mã GitHub của công ty để lưu bài. ' + (c.has ? '<b>Đang dùng mã hết hạn ' + (c.exp ? esc(c.exp.split('-').reverse().join('/')) : 'không rõ') + '.</b> Dán mã mới vào đây khi gần hết hạn.' : '<b>Chưa có mã.</b>') + '</p>' +
      '<details class="small"><summary>Cách tạo mã (3 phút)</summary><ol><li>Mở <a href="https://github.com/settings/personal-access-tokens/new" target="_blank" rel="noopener">github.com/settings/personal-access-tokens/new</a> (tài khoản thaisoniph).</li><li><b>Token name</b>: Trang quản trị website. <b>Expiration</b>: 1 năm (Custom).</li><li><b>Repository access</b>: Only select repositories → <b>thaisoniph/thucduonglanh.vn</b>.</li><li><b>Permissions</b> → Repository permissions → <b>Contents: Read and write</b>.</li><li>Bấm <b>Generate token</b>, sao chép mã (bắt đầu bằng github_pat_) rồi dán vào ô dưới.</li></ol></details>' +
      '<div class="steps" style="margin-top:8px"><input type="password" id="cmsPat" placeholder="github_pat_…" autocomplete="off" style="flex:1;min-width:200px"><button class="btn pri" id="cmsSave">Lưu mã</button></div></div>';
  }
  function bindCms() {
    if (!$('#cmsSave')) return;
    if (!S.f.cms && !S.f.cmsAsk) { S.f.cmsAsk = 1; api('cms_pat').then(function (j) { S.f.cms = j.status || { has: false }; render(); }, function () { S.f.cmsAsk = 0; }); }
    $('#cmsSave').onclick = function () {
      var b = this, v = $('#cmsPat').value.trim(); if (!v) { toast('Dán mã GitHub vào ô trước', true); return; }
      b.disabled = true; b.textContent = 'Đang kiểm tra…';
      api('cms_pat', { pat: v }).then(function (j) { S.f.cms = j.status; toast('Đã lưu mã ✓ Nhân sự đăng nhập /admin bằng email được rồi'); render(); }, function (e) { toast(e.message, true); b.disabled = false; b.textContent = 'Lưu mã'; });
    };
  }
  /** Cài đặt: 1 nhóm (tiêu đề nhỏ + các mục thu gọn). */
  function setSec(title, body) { return '<section class="set-sec"><h2>' + title + '</h2>' + body + '</section>'; }
  /** 1 mục cài đặt thu gọn: tên + dòng tóm tắt đang cài thế nào; bấm mở ra phần sửa. Mở / đóng được nhớ trên máy (localStorage set_open: 1 mở, 0 đóng).
   *  def = mở sẵn khi người dùng chưa từng bấm mục này (Hướng dẫn nhanh; Telegram khi chưa kết nối). */
  function setGroup(k, title, line, body, def) {
    var o = S.f.setOpen || (S.f.setOpen = (function () { try { return JSON.parse(store('set_open') || '{}') || {}; } catch (e) { return {}; } })());
    return '<details class="dash-more set-g" data-setk="' + k + '"' + (o[k] === 1 || (o[k] === undefined && def) ? ' open' : '') + '><summary><b>' + title + '</b><span>' + line + '</span></summary><div class="dash-more-b">' + body + '</div></details>';
  }
  function bindSettings() {
    $$('details[data-setk]').forEach(function (d) { d.addEventListener('toggle', function () { var o = S.f.setOpen || (S.f.setOpen = {}), k = d.getAttribute('data-setk'); o[k] = d.open ? 1 : 0; store('set_open', JSON.stringify(o)); }); });
    if ($('#dayLimSave')) $('#dayLimSave').onclick = function () { var n = Math.max(5, Math.min(200, parseInt($('#dayLim').value, 10) || DAY_LIMIT_DEF)); store('crm_daylimit', String(n)); toast('Mỗi ngày tối đa ' + n + ' khách ✓'); navBadges(); };
    $('#logout').onclick = function () { if (confirm('Đăng xuất khỏi CRM?')) logout(); };
    var syncTags = function () { $$('#tagRows [data-ti]').forEach(function (r) { var i = +r.getAttribute('data-ti'); $$('[data-tk]', r).forEach(function (x) { S.f.tags[i][x.getAttribute('data-tk')] = x.value; }); }); };
    if ($('#tagRows')) $('#tagRows').addEventListener('input', syncTags);
    if ($('#prefSave')) $('#prefSave').onclick = function () {
      syncTags(); var b = this, colors = {}; $$('[data-cc]').forEach(function (x) { colors[x.getAttribute('data-cc')] = x.value; }); b.disabled = true;
      api('prefs', { colors: colors, tags: S.f.tags.filter(function (t) { return String(t.name).trim(); }) }).then(function (j) { S.d.prefs = j.prefs; (j.prefs.tags || []).forEach(function (t) { S.d.tagColors[t.name] = t.color; }); S.f.tags = null; toast('Đã lưu màu ✓'); b.disabled = false; render(); }, function (e) { toast(e.message, true); b.disabled = false; });
    };
    if ($('#prefReset')) $('#prefReset').onclick = function () { CAT_ORDER.forEach(function (k) { var x = $('[data-cc="' + k + '"]'); if (x) x.value = CAT_DEF[k].color; }); toast('Bấm “Lưu màu & nhãn” để áp dụng'); };
    if ($('#rSave')) { var rh = function () { $('#rHint').textContent = 'Tổng chi = ' + money(moneyIn($('#rVipS').value)); }; $('#rVipS').addEventListener('input', rh); rh();
      $('#rSave').onclick = function () {
        var b = this; b.disabled = true;
        api('settings', { rules: { vipOrders: $('#rVipN').value, vipSpent: moneyIn($('#rVipS').value), atRisk: $('#rRisk').value, coolDays: $('#rCool').value, shipDays: $('#rShip').value, shipFar: $('#rShipFar').value, famMin: $('#rFam').value } }).then(function (j) { Object.assign(S.d.rules, j.rules); toast('Đã lưu. Nhóm khách được tính lại ✓'); load(true); }, function (e) { toast(e.message, true); b.disabled = false; });
      }; }
    if ($('#cmSave')) $('#cmSave').onclick = function () {
      var b = this, cm = {}; $$('[data-cm]').forEach(function (x) { cm[x.getAttribute('data-cm')] = x.value.trim(); }); b.disabled = true;
      api('settings', { commission: cm }).then(function (j) { S.d.rules.commission = j.commission; toast('Đã lưu % hoa hồng ✓'); b.disabled = false; }, function (e) { toast(e.message, true); b.disabled = false; });
    };
    if ($('#daSave')) { var dh = function () { var g = $('#daGood').value || '?', b = $('#daBad').value || '?'; $('#daHint').innerHTML = '🟢 dưới ' + esc(g) + '% · 🟠 từ ' + esc(g) + '% đến ' + esc(b) + '% · 🔴 trên ' + esc(b) + '%. Ví dụ chi 10 tr quảng cáo, khách mới mua 40 tr → 25%.'; };
      $('#daGood').addEventListener('input', dh); $('#daBad').addEventListener('input', dh); dh();
      $('#daSave').onclick = function () {
        var b = this, g = Number($('#daGood').value.replace(',', '.')), r = Number($('#daBad').value.replace(',', '.'));
        if (!(g > 0) || !(r >= g)) { toast('Mức đỏ phải lớn hơn hoặc bằng mức xanh, và đều lớn hơn 0.', true); return; }
        b.disabled = true;
        api('settings', { dash: { adsGood: g, adsBad: r } }).then(function (j) { if (!j.dash) { toast('Máy chủ đang cập nhật bản mới, thử lại sau 2 phút.', true); b.disabled = false; return; } S.d.rules.dash = j.dash; toast('Đã lưu mức đèn ✓'); b.disabled = false; }, function (e) { toast(e.message, true); b.disabled = false; });
      }; }
    if ($('#kpSave')) $('#kpSave').onclick = function () {
      var b = this, rd = function (id) { var v = $('#' + id).value.trim(); return v ? (id === 'kpCtr' ? Number(v.replace(',', '.')) : parseMoney(v)) : 0; }, K = { cpm: rd('kpCpm'), ctr: rd('kpCtr'), cpc: rd('kpCpc'), msg: rd('kpMsg'), sdt: rd('kpSdt') };
      if (Object.keys(K).some(function (k) { return isNaN(K[k]) || K[k] < 0; }) || K.ctr > 100) { toast('Số chưa đúng. CTR nhập phần trăm, ví dụ 1,5.', true); return; }
      b.disabled = true;
      api('settings', { kpi: K }).then(function (j) { if (!j.dash || !j.dash.kpi) { toast('Máy chủ đang cập nhật bản mới, thử lại sau 2 phút.', true); b.disabled = false; return; } S.d.rules.dash = j.dash; toast('Đã lưu mức tốt ✓'); b.disabled = false; }, function (e) { toast(e.message, true); b.disabled = false; });
    };
    if ($('#mdocSave')) $('#mdocSave').onclick = function () {
      var b = this, v = $('#mdocUrl').value.trim(); if (!/^https:\/\/\S+$/.test(v)) { toast('Link phải bắt đầu bằng https://', true); return; }
      b.disabled = true;
      api('settings', { mktDoc: { url: v } }).then(function (j) { if (!j.mktDoc) { toast('Máy chủ đang cập nhật bản mới, thử lại sau 2 phút.', true); b.disabled = false; return; } S.d.rules.mktDoc = j.mktDoc; toast('Đã lưu link ✓ Nút 🗺 Hệ thống Marketing đã mở link mới'); render(); }, function (e) { toast(e.message, true); b.disabled = false; });
    };
    if ($('#tgOff')) $('#tgOff').onclick = function () { if (!confirm('Ngắt thông báo Telegram riêng?')) return; api('tg_off').then(function () { S.user.tg = false; toast('Đã ngắt'); render(); }, function (e) { toast(e.message, true); }); };
    if ($('#tgLink')) $('#tgLink').onclick = function () {
      var b = this; b.disabled = true; b.textContent = 'Đang tạo link…';
      api('tg_link').then(function (j) {
        $('#tgSteps').innerHTML = '<a class="btn zalo" href="' + esc(j.url) + '" target="_blank" rel="noopener">① Mở Telegram</a><button class="btn pri" id="tgCheck">② Tôi đã bấm Start</button>';
        $('#tgCheck').onclick = function () {
          var c = this; c.disabled = true; c.textContent = 'Đang kiểm tra…';
          api('tg_check', { code: j.code }).then(function () { S.user.tg = true; toast('Đã kết nối Telegram ✓ – bot vừa gửi tin xác nhận'); render(); },
            function (e) { toast(e.message, true); c.disabled = false; c.textContent = '② Tôi đã bấm Start'; });
        };
      }, function (e) { toast(e.message, true); b.disabled = false; b.textContent = 'Kết nối Telegram'; });
    };
    if (lvl() >= 3) bindCms();
    if ($('#mrgOpen')) $('#mrgOpen').onclick = function () { openMerges(); };
    if ($('#vcOpen')) $('#vcOpen').onclick = function () { openVouchers(); };
    if ($('#ptOpen')) $('#ptOpen').onclick = function () { openPartners(); };
    if (lvl() < 2) return;
    bindSync();
    $('#modeSave').onclick = function () {
      var v = ($('input[name=amode]:checked') || {}).value, b = this; if (!v) return; b.disabled = true;
      api('settings', { assignMode: v }).then(function () { S.d.rules.assignMode = v; toast('Đã lưu: ' + MODE_INFO[v][0]); b.disabled = false; render(); }, function (e) { toast(e.message, true); b.disabled = false; });
    };
    $$('[data-recv]').forEach(function (x) {
      x.onchange = function () {
        var name = x.getAttribute('data-recv'), on = x.checked;
        api('recv', { name: name, on: on }).then(function () { (S.d.users || []).forEach(function (u) { if (u.name === name) u.recv = on; }); if (S.f.us) S.f.us.forEach(function (u) { if (u.name === name) u.recv = on; }); toast(name + ': ' + (on ? 'nhận' : 'không nhận') + ' khách mới'); },
          function (e) { x.checked = !on; toast(e.message, true); });
      };
    });
    $('#spreadBtn').onclick = function () {
      var b = this; if (!confirm('Chia đều các khách chưa ai phụ trách cho những người đang bật “Nhận khách mới”?')) return; b.disabled = true; b.textContent = 'Đang chia…';
      api('bulk', { spread: true }).then(function (j) { toast('Đã chia ' + j.customers + ' khách, ' + j.leads + ' khách hỏi ✓'); load(true); }, function (e) { toast(e.message, true); b.disabled = false; b.textContent = 'Chia đều'; });
    };
    $('#moveBtn').onclick = function () {
      var from = $('#mvFrom').value, to = $('#mvTo').value, b = this;
      if (!from || !to || from === to) { toast('Chọn 2 người khác nhau', true); return; }
      if (!confirm('Chuyển toàn bộ khách của ' + from + ' sang ' + to + '?')) return; b.disabled = true;
      api('bulk', { from: from, to: to }).then(function (j) { toast('Đã chuyển ' + j.customers + ' khách, ' + j.leads + ' khách hỏi ✓'); load(true); }, function (e) { toast(e.message, true); b.disabled = false; });
    };
    $('#dupOpen').onclick = function () { openDups(); };
    function sync(tableId, arr, isObj) {
      var t = $('#' + tableId); if (!t) return;
      t.addEventListener('input', function (e) { var r = e.target.closest('[data-i]'), k = e.target.getAttribute('data-k'); if (!r || k == null) return; var i = +r.getAttribute('data-i'); arr[i][isObj ? k : +k] = e.target.type === 'checkbox' ? e.target.checked : e.target.value; });
      t.addEventListener('change', function (e) { var r = e.target.closest('[data-i]'), k = e.target.getAttribute('data-k'); if (!r || k == null) return; var i = +r.getAttribute('data-i'); arr[i][isObj ? k : +k] = e.target.type === 'checkbox' ? e.target.checked : e.target.value; });
    }
    sync('cyT', S.f.cy); sync('tpT', S.f.tp); if (S.f.us) sync('usT', S.f.us, true);
    function save(btnId, label, action, payload, after) {
      var b = $('#' + btnId); if (!b) return;
      b.onclick = function () {
        b.disabled = true; b.textContent = 'Đang lưu…';
        api(action, payload()).then(function (j) { toast('Đã lưu ✓'); after(j); b.disabled = false; b.textContent = label; load(true); }, function (e) { toast(e.message, true); b.disabled = false; b.textContent = label; });
      };
    }
    save('cySave', 'Lưu chu kỳ', 'settings', function () { return { cycles: S.f.cy }; }, function () { S.f.cy = null; });
    save('tpSave', 'Lưu mẫu tin', 'settings', function () { return { templates: S.f.tp }; }, function () { S.f.tp = null; });
    save('usSave', 'Lưu nhân sự', 'users', function () { return { users: S.f.us }; }, function () { S.f.us = null; });
  }

  /* ================================================================ hộp thoại */
  var modalRoute = null, modalPushed = false;
  /* ================================================================ Quản trị: mức độ dùng CRM của nhân sự (usage_report) */
  function useAgo(t) { if (!t) return null; return Math.max(0, Math.round((today() - dayStart(t)) / DAY)); }
  function useAgoText(t) { var a = useAgo(t); return a === null ? 'Chưa từng vào' : a === 0 ? 'Hôm nay ' + fDateTime(t).slice(0, 5) : a === 1 ? 'Hôm qua ' + fDateTime(t).slice(0, 5) : a + ' ngày trước'; }
  function useStatus(p, days) {
    var a = useAgo(p.lastSeen), next = p.miles.filter(function (m) { return !m.done; })[0];
    if (a === null) return ['risk', '⛔ Chưa từng vào', 'Gọi hướng dẫn bạn đăng nhập lần đầu'];
    if (a >= 3) return ['risk', '⛔ ' + a + ' ngày chưa vào', 'Gọi hỏi thăm xem bạn có vướng gì không'];
    if (a >= 2) return ['noconsent', '⚠️ 2 ngày chưa vào', 'Nhắc bạn mở CRM mỗi sáng'];
    if (!p.actions) return ['noconsent', '⚠️ Có vào, chưa thao tác', 'Có thể chưa biết dùng – kèm bạn làm 1–2 khách đầu tiên'];
    if (p.activeDays < Math.ceil(days * 0.6)) return ['noconsent', '⚠️ Vào chưa đều', 'Mới vào ' + p.activeDays + '/' + days + ' ngày'];
    return ['st-xong', '✅ Dùng tốt', next ? 'Bước tiếp theo: ' + next.label : 'Đã qua đủ các mốc'];
  }
  function openUsage(who, days) {
    days = days || (S.f.use && S.f.use.days) || 7; S.f.use = { days: days };
    var m = modal('📈 Mức dùng CRM' + (who ? ' – ' + esc(who) : ''), '<p class="muted">Đang tải số liệu…</p>');
    api('usage_report', { days: days }).then(function (r) {
      if (!$('.sheet-b', m) || !m.isConnected) return;
      var chips = '<div class="chips">' + [7, 14, 30].map(function (n) { return '<button class="chip' + (n === r.days ? ' on' : '') + '" data-ud="' + n + '">' + n + ' ngày</button>'; }).join('') + '</div>';
      var p = who && r.people.filter(function (x) { return x.name === who; })[0];
      $('.sheet-b', m).innerHTML = chips + (who ? (p ? usagePerson(p, r) : empty('Không tìm thấy ' + esc(who) + ' trong danh sách nhân sự đang dùng.')) : usageTeam(r)) +
        '<p class="small muted" style="margin-top:14px">Số lượt mở và phút dùng có từ ngày 07/10/2026. Những ngày trước đó, CRM tính “ngày có vào” theo lượt tải dữ liệu và nhật ký thao tác. Phút dùng chỉ tính lúc CRM đang mở trên màn hình và có chạm, gõ hoặc cuộn trong 2 phút gần nhất.</p>';
      m.addEventListener('click', function (e) {
        var b = e.target.closest('[data-ud],[data-uw]'); if (!b) return;
        if (b.hasAttribute('data-ud')) openUsage(who, Number(b.getAttribute('data-ud')));
        else openUsage(b.getAttribute('data-uw') || null, r.days);
      });
    }, function (e) { if ($('.sheet-b', m)) $('.sheet-b', m).innerHTML = '<p class="err">' + esc(e.message) + '</p>' + (/Không rõ thao tác/.test(e.message) ? '<p class="small">Máy chủ Apps Script chưa có bản 2026-10-07b. Đợi GitHub tự triển khai xong (vài phút) rồi thử lại.</p>' : ''); });
  }
  function usageTeam(r) {
    var ppl = r.people.filter(function (p) { return p.level < 3; }); // bỏ tài khoản Quản trị
    var st = teamStats(ppl.map(function (p) { return p.name; })), rows = ppl.slice().sort(function (a, b) { return (b.lastSeen || 0) - (a.lastSeen || 0); });
    return '<div class="team-wrap"><table class="team use"><thead><tr><th>Nhân sự</th><th>Lần cuối vào</th><th>Số ngày vào<br><small>' + r.days + ' ngày qua</small></th><th>Phút dùng</th><th>Thao tác<br><small>chăm sóc · đơn · ưu đãi</small></th><th>Chăm sóc hôm nay<br><small>đã xong / cần làm</small></th><th>Mốc</th><th>Đánh giá</th></tr></thead><tbody>' +
      rows.map(function (p) {
        var s = useStatus(p, r.days), x = st[p.name] || { doneN: 0, todo: 0 }, all = x.doneN + x.todo, pc = all ? Math.round(x.doneN * 100 / all) : 100, done = p.miles.filter(function (m) { return m.done; }).length;
        return '<tr data-uw="' + esc(p.name) + '"><td><b>' + esc(p.name) + '</b>' + (p.level >= 2 ? ' <small class="muted">' + esc(p.role) + '</small>' : '') + '</td>' +
          '<td' + (useAgo(p.lastSeen) === null || useAgo(p.lastSeen) >= 2 ? ' class="bad"' : '') + '>' + useAgoText(p.lastSeen) + '</td>' +
          '<td>' + p.activeDays + '/' + r.days + '</td><td>' + (p.mins || '–') + '</td>' +
          '<td><b>' + p.actions + '</b> <small class="muted">' + p.acts.care + ' · ' + p.acts.order + ' · ' + p.acts.promo + '</small></td>' +
          '<td>' + (all ? '<div class="tm-p"><span>' + x.doneN + ' / ' + all + '</span><div class="bar"><i style="width:' + pc + '%"></i></div></div>' : '–') + '</td>' +
          '<td>' + done + '/' + p.miles.length + '</td><td style="text-align:left"><span class="tag ' + s[0] + '">' + s[1] + '</span><br><small class="muted">' + esc(s[2]) + '</small></td></tr>';
      }).join('') + '</tbody></table></div><p class="small muted" style="margin-top:8px">Bấm vào tên để xem chi tiết từng ngày, các mốc đã qua và thao tác gần đây.</p>';
  }
  function usagePerson(p, r) {
    var s = useStatus(p, r.days), x = (teamStats([p.name]))[p.name], all = x.doneN + x.todo, maxM = Math.max.apply(null, p.series.map(function (d) { return d.mins; }).concat(1)), maxA = Math.max.apply(null, p.series.map(function (d) { return d.actions; }).concat(1));
    var views = VIEWS.filter(function (v) { return !v.min || p.level >= v.min; }).map(function (v) { return v.label; }), unused = views.filter(function (v) { return !p.screens[v]; });
    var h = '<button class="btn ghost" data-uw="" style="margin-bottom:10px">← Cả nhóm</button>' +
      '<p><span class="tag ' + s[0] + '">' + s[1] + '</span> ' + esc(s[2]) + '</p><div class="metrics">' +
      metric('Lần cuối vào', useAgoText(p.lastSeen), p.lastSeen ? fDateTime(p.lastSeen) + (p.dev ? ' · ' + esc(p.dev) : '') : 'Chưa đăng nhập lần nào') +
      metric('Số ngày vào', p.activeDays + '/' + r.days, '7 ngày gần nhất: ' + p.days7 + '/7 ngày') +
      metric('Thời gian dùng', p.mins + ' phút', p.opens + ' lượt mở CRM trong ' + r.days + ' ngày') +
      metric('Thao tác', String(p.actions), 'Chăm sóc ' + p.acts.care + ' · đơn hàng ' + p.acts.order + ' · gửi ưu đãi ' + p.acts.promo + ' · khác ' + p.acts.other) +
      metric('Chăm sóc hôm nay', all ? x.doneN + ' / ' + all : '–', all ? 'Đã xong / cần làm' + (x.late ? ' · ' + x.late + ' khách trễ hạn' : '') : 'Hôm nay không có khách đến lịch') +
      '</div>';
    h += '<section class="section"><div class="section-h"><h2>🪜 Các mốc làm quen</h2></div><div class="use-miles">' + p.miles.map(function (m) {
      return '<div class="' + (m.done ? 'done' : '') + '"><b>' + (m.done ? '✅' : '⬜') + '</b> ' + esc(m.label) + (m.at ? ' <small class="muted">' + fDate(m.at) + '</small>' : '') + '</div>';
    }).join('') + '</div></section>';
    h += '<section class="section"><div class="section-h"><h2>📅 Từng ngày</h2></div><div class="team-wrap"><table class="team"><thead><tr><th>Ngày</th><th>Lượt mở</th><th>Phút dùng</th><th>Thao tác</th></tr></thead><tbody>' +
      p.series.slice().reverse().map(function (d) {
        var dd = d.day.split('-'), off = !d.seen && !d.actions;
        return '<tr class="' + (off ? 'off' : '') + '"><td>' + dd[2] + '/' + dd[1] + '</td><td>' + (d.opens || (d.seen ? 'có vào' : '–')) + '</td>' +
          '<td><div class="tm-p"><span>' + (d.mins || '–') + '</span><div class="bar"><i style="width:' + Math.round(d.mins * 100 / maxM) + '%"></i></div></div></td>' +
          '<td><div class="tm-p"><span>' + (d.actions || '–') + (d.care ? ' <small class="muted">(' + d.care + ' CS)</small>' : '') + '</span><div class="bar"><i style="width:' + Math.round(d.actions * 100 / maxA) + '%"></i></div></div></td></tr>';
      }).join('') + '</tbody></table></div></section>';
    h += '<section class="section"><div class="section-h"><h2>🧭 Màn hình đã dùng</h2><span class="tip">số ngày có mở</span></div><div class="chips wrap">' +
      views.map(function (v) { return '<span class="chip' + (p.screens[v] ? ' on' : '') + '">' + esc(v) + (p.screens[v] ? ' <em>' + p.screens[v] + '</em>' : '') + '</span>'; }).join('') + '</div>' +
      (unused.length && p.opens ? '<p class="small muted">Chưa mở: ' + esc(unused.join(', ')) + '. Có thể bạn chưa biết phần này, nên chỉ thêm.</p>' : '') + '</section>';
    var recent = S.d.log.filter(function (l) { return l.by === p.name; }).sort(function (a, b) { return b.time - a.time; }).slice(0, 20);
    h += '<section class="section"><div class="section-h"><h2>🕘 Thao tác gần đây</h2></div>' + (recent.length ? '<div class="timeline">' + recent.map(logItem).join('') + '</div>' : empty('Chưa có thao tác nào.')) + '</section>';
    return h;
  }
  /* ---------- gộp khách dùng nhiều số điện thoại (Quản lý trở lên) */
  function mergeCust(main, phones, btn, extra, done) {
    var lines = phones.map(function (p) { var o = cust(p); return '• ' + fPhone(p) + (o ? ' – ' + o.name + ' (' + o.orders + ' đơn, ' + moneyShort(o.spent) + ')' : ''); });
    var mc = cust(main);
    if (!confirm('Gộp vào hồ sơ ' + fPhone(main) + (mc ? ' – ' + mc.name : '') + ':\n' + lines.join('\n') + (extra || '') + '\n\nĐơn hàng, nhật ký, ghi chú của các số trên chuyển hết sang số chính. Hồ sơ số phụ bị bỏ. Tiếp tục?')) return;
    if (btn) btn.disabled = true;
    api('merge', { main: main, phones: phones }).then(function (j) {
      var d = S.d; d.customers = d.customers.filter(function (x) { return phones.indexOf(x.phone) < 0; });
      d.orders.forEach(function (o) { if (phones.indexOf(o.phone) >= 0) o.phone = main; });
      (d.leads || []).forEach(function (l) { if (phones.indexOf(l.phone) >= 0) l.phone = main; });
      setData(d, S.loadedAt); toast('Đã gộp ✓ ' + j.moved + ' đơn chuyển sang ' + fPhone(main));
      if (done) done(j); else { closeModal(true); render(); }
      load(true, true); // tải lại để số đơn, tổng chi, nhãn khách đúng
    }, function (e) { toast(e.message, true); if (btn) btn.disabled = false; });
  }
  /* ---------- 🎟 Mã ưu đãi đặt hàng web (Quản lý trở lên, api/src/voucher.js). Khách nhập ở dòng nhỏ "Có mã ưu đãi?" lúc thanh toán, hoặc mở link ?uudai=MÃ */
  /* ---------- 🖐 Sửa trò chơi "Bạn còn mấy ngón tay?" (thucduonglanh.vn/ngon-tay-song-lanh/) ngay trong CRM.
   * api quiz_cms (api/src/cms.js) đọc / ghi data/quiz.json trên GitHub; lưu xong web tự đăng lại sau 1–2 phút. Quyền: Quản lý+, Marketing, người có ô 🌐 Sửa website. */
  function qzeBox() { return '<div class="box"><p class="small muted" style="margin:0 0 10px">Sửa câu hỏi, câu đùa, việc nhỏ gợi ý, sản phẩm gợi ý và danh hiệu của trò chơi trên web. Lưu xong khoảng 1–2 phút web tự cập nhật. Màn hình lớn chơi nhóm ở sự kiện: <a href="https://thucduonglanh.vn/ngon-tay-song-lanh/nhom/" target="_blank" rel="noopener">thucduonglanh.vn/ngon-tay-song-lanh/nhom/</a></p><button class="btn" type="button" data-quiz-edit>✏️ Sửa câu hỏi trò chơi</button> <a class="btn ghost" href="https://thucduonglanh.vn/ngon-tay-song-lanh/" target="_blank" rel="noopener">Xem trò chơi ↗</a></div>'; }
  var QZE = null;
  function openQuizEdit() {
    var m = modal('🖐 Sửa trò chơi “Bạn còn mấy ngón tay?”', '<p class="muted">Đang tải nội dung trò chơi…</p>');
    api('quiz_cms', { op: 'get' }).then(function (j) {
      if (!j || !j.ok) { $('.sheet-b', m).innerHTML = '<div class="notice">' + esc((j && j.error) || 'Chưa tải được.') + '</div>'; return; }
      QZE = { q: j.quiz, sha: j.sha }; qzeRender(m);
    }, function (e) { $('.sheet-b', m).innerHTML = '<div class="notice">' + esc(e.message) + '</div>'; });
  }
  function qzeProds(v) {
    var seen = {}, o = '<option value="">— Không gợi ý sản phẩm —</option>';
    (CFG.products || []).forEach(function (p) { if (!p.slug || seen[p.slug]) return; seen[p.slug] = 1; o += '<option value="' + esc(p.slug) + '"' + (p.slug === v ? ' selected' : '') + '>' + esc(p.name) + '</option>'; });
    return o;
  }
  function qzeRender(m) {
    var Q = QZE.q, qs = Q.questions || [], rs = Q.results || [];
    var f = function (lbl, k, v, big, ph) { return '<label class="qze-f"><span>' + lbl + '</span>' + (big ? '<textarea rows="2" data-k="' + k + '" placeholder="' + esc(ph || '') + '">' + esc(v == null ? '' : v) + '</textarea>' : '<input type="text" data-k="' + k + '" value="' + esc(v == null ? '' : v) + '" placeholder="' + esc(ph || '') + '">') + '</label>'; };
    var h = '<div class="qze-top">' + f('Tiêu đề', 'title', Q.title) + f('Lời giới thiệu', 'lead', Q.lead, 1) + '</div>' +
      '<p class="small muted">Nên giữ đúng <b>10 câu</b> (10 ngón tay). Hỏi sao cho trả lời <b>Có</b> = thói quen tốt. Không dùng chữ chữa / điều trị / khỏi bệnh. Hiện có <b>' + qs.length + '</b> câu.</p>' +
      qs.map(function (q, i) {
        return '<details class="qze-q" data-i="' + i + '"' + (QZE.open === i ? ' open' : '') + '><summary><b>' + (i + 1) + '.</b> ' + esc((q.icon || '') + ' ' + q.q) + (q.product ? ' <small>🛍</small>' : '') + '</summary><div class="qze-b">' +
          '<div class="qze-row">' + f('Biểu tượng', 'icon', q.icon, 0, '🌙') + f('Câu hỏi', 'q', q.q, 0, 'Bạn thường đi ngủ trước 23h?') + '</div>' +
          f('Câu đùa nhỏ dưới câu hỏi', 'fun', q.fun) + f('Tên thói quen (ngắn, hiện ở gợi ý & thống kê)', 'habit', q.habit, 0, 'Ngủ trước 23h') +
          f('Việc nhỏ gợi ý khi khách hạ ngón', 'tip', q.tip, 1) +
          '<div class="qze-row qze-pr"><label class="qze-f"><span>Gợi ý sản phẩm (không bắt buộc)</span><select data-k="product">' + qzeProds(q.product) + '</select></label>' + f('Câu dẫn trước tên sản phẩm', 'product_lead', q.product_lead, 0, 'Sáng nào cũng vội?') + '</div>' +
          '<div class="qze-acts"><button type="button" class="btn ghost sm" data-qze="up">↑ Lên</button><button type="button" class="btn ghost sm" data-qze="down">↓ Xuống</button><button type="button" class="btn ghost sm danger" data-qze="del">🗑 Xoá câu này</button></div></div></details>';
      }).join('') +
      '<p><button type="button" class="btn ghost" data-qze="add">＋ Thêm câu hỏi</button></p>' +
      '<h3 class="qze-h">Danh hiệu theo số ngón còn lại</h3>' +
      rs.map(function (r, i) { return '<div class="qze-r" data-r="' + i + '"><div class="qze-row">' + f('Từ … ngón trở lên', 'min', r.min) + f('Biểu tượng', 'icon', r.icon) + f('Danh hiệu', 'title', r.title) + '</div>' + f('Lời nhắn', 'text', r.text, 1) + '</div>'; }).join('');
    $('.sheet-b', m).innerHTML = h;
    var ft = $('.sheet-f', m);
    if (!ft) { ft = document.createElement('div'); ft.className = 'sheet-f'; $('.sheet', m).appendChild(ft); }
    ft.innerHTML = '<span class="small muted qze-note">Lưu xong 1–2 phút web tự cập nhật</span><button class="btn pri" type="button" data-qze="save">💾 Lưu & đăng lên web</button>';
    m.onclick = function (e) {
      var b = e.target.closest('[data-qze]'); if (!b) return;
      var act = b.getAttribute('data-qze'); qzeCollect(m);
      var d = b.closest('[data-i]'), i = d ? Number(d.getAttribute('data-i')) : -1, L = QZE.q.questions;
      if (act === 'add') { L.push({ icon: '', q: '', fun: '', habit: '', tip: '' }); QZE.open = L.length - 1; return qzeRender(m); }
      if (act === 'del') { if (!confirm('Xoá câu này?')) return; L.splice(i, 1); QZE.open = -1; return qzeRender(m); }
      if (act === 'up' && i > 0) { L.splice(i - 1, 0, L.splice(i, 1)[0]); QZE.open = i - 1; return qzeRender(m); }
      if (act === 'down' && i < L.length - 1) { L.splice(i + 1, 0, L.splice(i, 1)[0]); QZE.open = i + 1; return qzeRender(m); }
      if (act === 'save') {
        b.disabled = true; b.textContent = 'Đang lưu…';
        api('quiz_cms', { op: 'save', quiz: QZE.q, sha: QZE.sha }).then(function (j) {
          b.disabled = false; b.textContent = '💾 Lưu & đăng lên web';
          if (!j || !j.ok) return toast((j && j.error) || 'Chưa lưu được.', true);
          QZE.sha = j.sha; closeModal(); toast('Đã lưu. Khoảng 1–2 phút nữa trò chơi trên web sẽ cập nhật.');
        }, function (er) { b.disabled = false; b.textContent = '💾 Lưu & đăng lên web'; toast(er.message, true); });
      }
    };
  }
  function qzeCollect(m) {
    var Q = QZE.q, val = function (box, k) { var el = box.querySelector('[data-k="' + k + '"]'); return el ? el.value.trim() : ''; };
    var top = $('.qze-top', m); if (top) { Q.title = val(top, 'title'); Q.lead = val(top, 'lead'); }
    $$('.qze-q', m).forEach(function (d) { var q = Q.questions[Number(d.getAttribute('data-i'))]; if (!q) return; ['icon', 'q', 'fun', 'habit', 'tip', 'product', 'product_lead'].forEach(function (k) { q[k] = val(d, k); }); if (!q.product) { delete q.product; delete q.product_lead; } if (d.open) QZE.open = Number(d.getAttribute('data-i')); });
    $$('.qze-r', m).forEach(function (d) { var r = Q.results[Number(d.getAttribute('data-r'))]; if (!r) return; r.min = Number(val(d, 'min')) || 0; ['icon', 'title', 'text'].forEach(function (k) { r[k] = val(d, k); }); });
  }
  document.addEventListener('click', function (e) { if (e.target.closest && e.target.closest('[data-quiz-edit]')) { e.preventDefault(); openQuizEdit(); } });
  function vcBox() {
    return '<div class="box"><h3>🎟 Mã ưu đãi đặt hàng web</h3><p class="hint" style="margin:0 0 10px">Mã giảm giá gửi riêng cho khách cũ, đối tác. Trên web chỉ có dòng chữ nhỏ <b>“Có mã ưu đãi?”</b> ở trang thanh toán, khách mua bình thường gần như không để ý. Cách gửi tiện nhất: bấm <b>📋 Copy tin gửi khách</b> → dán vào Zalo. Khách bấm link là mã tự áp dụng khi đặt hàng.</p>' +
      '<p class="hint" style="margin:0 0 10px">Mỗi đơn dùng 1 mã. Freeship vẫn tính theo tiền hàng <b>trước</b> khi giảm. Đơn huỷ / hoàn thì mã được trả lại lượt dùng.</p><button class="btn pri" id="vcOpen">Quản lý mã ưu đãi</button></div>';
  }
  function vcLink(c) { return 'https://thucduonglanh.vn/?uudai=' + encodeURIComponent(c); }
  function vcMsgText(v) {
    return 'Thực Dưỡng Lành gửi anh/chị mã ưu đãi riêng: ' + v.code + ' (' + v.label.replace(' ₫', 'đ') + (v.min_sub ? ', đơn từ ' + money(v.min_sub) : '') + (v.exp ? ', dùng đến ' + v.exp.split('-').reverse().join('/') : '') + ').\nBấm link để đặt hàng, mã tự áp dụng: ' + vcLink(v.code);
  }
  function openVouchers() {
    var D = { list: null, edit: null };
    var m = modal('🎟 Mã ưu đãi đặt hàng web', '<div id="vcMain"><p class="muted">Đang tải…</p></div>', '<button class="btn pri" id="vcNew">＋ Tạo mã mới</button><button class="btn ghost" data-close>Đóng</button>');
    function rand() { var a = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789', r = ''; for (var i = 0; i < 6; i++) r += a[Math.floor(Math.random() * a.length)]; return 'TDL' + r; }
    function cond(v) {
      var c = [];
      if (v.min_sub) c.push('đơn từ ' + money(v.min_sub));
      if (v.exp) c.push('đến ' + v.exp.split('-').reverse().join('/'));
      c.push(v.max_uses ? 'tối đa ' + v.max_uses + ' đơn' : 'không giới hạn lượt');
      if (v.once) c.push('mỗi SĐT 1 lần');
      if (v.phone) c.push('chỉ SĐT ' + fPhone(v.phone));
      return c.join(' · ');
    }
    function list() {
      var box = $('#vcMain', m); if (!box) return; $('#vcNew').hidden = false;
      if (!D.list.length) { box.innerHTML = empty('Chưa có mã nào. Bấm ＋ Tạo mã mới.'); return; }
      box.innerHTML = '<div class="list">' + D.list.map(function (v, i) {
        var exp = v.exp && v.exp < new Date(Date.now() + 7 * 3600e3).toISOString().slice(0, 10);
        return '<div class="card"' + (v.active && !exp ? '' : ' style="opacity:.6"') + '><div class="r1"><b>' + esc(v.code) + '</b><span class="small">' + esc(v.label) + '</span>' + (!v.active ? '<span class="small muted">· đã tắt</span>' : exp ? '<span class="small muted">· hết hạn</span>' : '') + '</div>' +
          '<div class="small muted" style="margin:4px 0">' + esc(cond(v)) + (v.note ? '<br>📝 ' + esc(v.note) : '') + '</div>' +
          '<div class="small">🛒 Đã dùng <b>' + v.used.n + '</b> đơn' + (v.used.n ? ' · giảm ' + money(v.used.off) + ' · thu ' + money(v.used.sales) : '') + '</div>' +
          '<div class="acts" style="margin-top:8px"><button class="btn" data-vccp="' + i + '">📋 Copy tin gửi khách</button><button class="btn ghost" data-vced="' + i + '">✏️ Sửa</button><button class="btn ghost" data-vcdel="' + i + '">' + (v.used.n ? '⏸ Tắt' : '🗑 Xoá') + '</button></div></div>';
      }).join('') + '</div>';
      $$('[data-vccp]', box).forEach(function (b) { b.onclick = function () { var t = vcMsgText(D.list[+b.getAttribute('data-vccp')]); (navigator.clipboard ? navigator.clipboard.writeText(t) : Promise.reject()).then(function () { toast('Đã copy – dán vào Zalo gửi khách'); }, function () { window.prompt('Copy tin này gửi khách:', t); }); }; });
      $$('[data-vced]', box).forEach(function (b) { b.onclick = function () { form(D.list[+b.getAttribute('data-vced')]); }; });
      $$('[data-vcdel]', box).forEach(function (b) { b.onclick = function () {
        var v = D.list[+b.getAttribute('data-vcdel')]; if (!confirm((v.used.n ? 'Tắt' : 'Xoá') + ' mã ' + v.code + '? Khách sẽ không dùng được mã này nữa.')) return; b.disabled = true;
        api('voucher_del', { code: v.code }).then(function (j) { D.list = j.list; list(); toast(j.off ? 'Đã tắt mã (giữ lại để xem thống kê)' : 'Đã xoá mã'); }, function (e) { toast(e.message, true); b.disabled = false; });
      }; });
    }
    function form(v) {
      var isNew = !v; v = v || { code: rand(), kind: 'amount', value: '', max_off: 0, min_sub: 0, exp: '', max_uses: 0, once: true, phone: '', note: '', active: true };
      $('#vcNew').hidden = true;
      $('#vcMain', m).innerHTML = '<div class="row2c"><label class="f"><span>Mã (chữ không dấu, số)</span><input type="text" id="vcCode" value="' + esc(v.code) + '" maxlength="30"' + (isNew ? '' : ' disabled') + ' style="text-transform:uppercase"></label>' +
        '<label class="f"><span>Loại ưu đãi</span><select id="vcKind"><option value="amount">Giảm số tiền</option><option value="percent">Giảm %</option><option value="ship">Miễn phí ship</option></select></label></div>' +
        '<div class="row2c"><label class="f" id="vcValF"><span id="vcValL">Số tiền giảm</span><input type="text" inputmode="decimal" id="vcVal" value="' + esc(v.kind === 'ship' ? '' : v.value) + '" placeholder="vd 50k"></label>' +
        '<label class="f" id="vcMaxF"><span>Giảm tối đa (để trống = không giới hạn)</span><input type="text" inputmode="decimal" id="vcMax" value="' + esc(v.max_off || '') + '" placeholder="vd 100k"></label></div>' +
        '<div class="row2c"><label class="f"><span>Áp dụng cho đơn từ (tiền hàng)</span><input type="text" inputmode="decimal" id="vcMin" value="' + esc(v.min_sub || '') + '" placeholder="để trống = mọi đơn"></label>' +
        '<label class="f"><span>Dùng đến hết ngày</span><input type="date" id="vcExp" value="' + esc(v.exp) + '"></label></div>' +
        '<div class="row2c"><label class="f"><span>Tổng số đơn được dùng</span><input type="number" min="0" id="vcUses" value="' + esc(v.max_uses || '') + '" placeholder="để trống = không giới hạn"></label>' +
        '<label class="f"><span>Chỉ cho 1 số điện thoại (mã riêng)</span><input type="tel" id="vcPhone" value="' + esc(v.phone) + '" placeholder="để trống = ai có mã cũng dùng được"></label></div>' +
        '<label class="f"><span>Ghi chú (gửi cho ai, dịp gì)</span><input type="text" id="vcNote" value="' + esc(v.note) + '" maxlength="200" placeholder="vd Đối tác chị Lan, tri ân khách cũ tháng 10"></label>' +
        '<label class="switch"><input type="checkbox" id="vcOnce"' + (v.once ? ' checked' : '') + '> Mỗi số điện thoại chỉ dùng 1 lần</label><br>' +
        '<label class="switch"><input type="checkbox" id="vcAct"' + (v.active ? ' checked' : '') + '> Đang dùng</label>' +
        '<div class="steps" style="margin-top:12px"><button class="btn pri" id="vcSave">' + (isNew ? 'Tạo mã' : 'Lưu') + '</button><button class="btn ghost" id="vcBack">Quay lại</button></div>';
      var k = $('#vcKind', m); k.value = v.kind;
      function kindUi() { var x = k.value; $('#vcValF', m).hidden = x === 'ship'; $('#vcMaxF', m).hidden = x !== 'percent'; $('#vcValL', m).textContent = x === 'percent' ? 'Phần trăm giảm (%)' : 'Số tiền giảm'; $('#vcVal', m).placeholder = x === 'percent' ? 'vd 10' : 'vd 50k'; }
      k.onchange = kindUi; kindUi();
      $('#vcBack', m).onclick = list;
      $('#vcSave', m).onclick = function () {
        var b = this, x = k.value, val = $('#vcVal', m).value;
        var p = { isNew: isNew, code: $('#vcCode', m).value, kind: x, value: x === 'percent' ? parseFloat(String(val).replace(',', '.')) || 0 : x === 'ship' ? 0 : parseMoney(val), max_off: x === 'percent' ? parseMoney($('#vcMax', m).value) : 0,
          min_sub: parseMoney($('#vcMin', m).value), exp: $('#vcExp', m).value, max_uses: +$('#vcUses', m).value || 0, phone: $('#vcPhone', m).value.trim(), note: $('#vcNote', m).value.trim(), once: $('#vcOnce', m).checked, active: $('#vcAct', m).checked };
        b.disabled = true;
        api('voucher_save', p).then(function (j) { D.list = j.list; list(); toast(isNew ? 'Đã tạo mã – bấm 📋 để copy tin gửi khách' : 'Đã lưu'); }, function (e) { toast(e.message, true); b.disabled = false; });
      };
    }
    $('#vcNew').onclick = function () { form(null); };
    api('voucher_list').then(function (j) { D.list = j.list || []; list(); }, function (e) { var bx = $('#vcMain', m); if (bx) bx.innerHTML = '<p class="err">' + esc(e.message) + '</p>'; });
  }
  /* ---------- 🎁 Khách cũ giới thiệu + 🤝 Cộng tác viên / đối tác (api/src/partner.js) */
  function rfCopyZalo(m, sel, phone) { copy($(sel, m).value).then(function () { toast('Đã copy tin ✓ Dán vào Zalo rồi gửi'); if (phone) window.open(zalo(phone), '_blank', 'noopener'); }); }
  /** Hồ sơ khách → 🎁 Mã giới thiệu: mã riêng của khách (TÊN + 3 số cuối), bạn bè đặt lần đầu trên web được giảm %, sale tặng quà cảm ơn khi bạn đặt. */
  function openRefCode(phone) {
    var c = cust(phone); if (!c) return;
    var m = modal('🎁 Mã giới thiệu – ' + esc(c.name || c.phone), '<div id="rfMain"><p class="muted">Đang tạo mã…</p></div>', '');
    api('ref_code', { phone: c.phone }).then(function (j) {
      var box = $('#rfMain', m); if (!box) return;
      var pct = (String(j.label).match(/[\d.,]+%/) || [''])[0], url = 'https://thucduonglanh.vn/?uudai=' + encodeURIComponent(j.code) + '&ref=' + refCode(c.owner || S.user.name);
      var txt = fillTpl('Dạ [Tên] ơi, cảm ơn [Tên] đã tin dùng Thực Dưỡng Lành ❤️ Em gửi [Tên] mã giới thiệu riêng: ' + j.code + '. Bạn bè, người thân của [Tên] đặt hàng lần đầu trên web nhập mã này được giảm ' + pct + '. Mỗi người bạn đặt hàng thành công, em xin gửi [Tên] một phần quà cảm ơn ạ.\n[Tên] chỉ cần chuyển tiếp tin dưới đây cho bạn bè nhé:\n\n---\nMình đang dùng sản phẩm của Thực Dưỡng Lành thấy hợp nên giới thiệu bạn. Đặt lần đầu trên web nhập mã ' + j.code + ' được giảm ' + pct + ' (bấm link là mã tự áp dụng): ' + url, c);
      box.innerHTML = '<div class="box rf-code"><b style="font-size:20px;letter-spacing:1px">' + esc(j.code) + '</b> <span class="small">' + esc(j.label) + ' đơn đầu cho bạn bè</span><p class="small muted" style="margin:6px 0 0">' + (j.used ? '🎉 Đã có <b>' + j.used + '</b> người đặt bằng mã này.' : 'Chưa có ai dùng mã.') + ' Chỉ khách <b>mua lần đầu</b> dùng được, khách không tự dùng mã của mình.</p></div>' +
        '<label class="f"><span>Tin gửi khách (sửa được)</span><textarea id="rfText" rows="9">' + esc(txt) + '</textarea></label>' +
        '<p class="small muted" style="margin:6px 0 0">Bạn bè đặt bằng mã: khách mới tự giao cho ' + esc(c.owner || S.user.name) + ' phụ trách, tab Hôm nay hiện mục <b>🎁 Cảm ơn khách giới thiệu</b> để bạn tặng quà hoặc voucher cho ' + esc(c.name || 'khách') + '.</p>' +
        '<div class="steps" style="margin-top:10px"><button class="btn pri" id="rfGo">📋 Copy tin & mở Zalo</button><button class="btn ghost" data-copyref="' + esc(url) + '">📋 Chỉ copy link</button></div>';
      $('#rfGo', m).onclick = function () { rfCopyZalo(m, '#rfText', c.phone); };
    }, function (e) { var box = $('#rfMain', m); if (box) box.innerHTML = '<p class="err">' + esc(e.message) + '</p>'; });
  }
  /** Tab Hôm nay: đơn của người được giới thiệu mà chưa tặng quà người giới thiệu (sale thấy khách mình phụ trách, quản lý thấy hết). */
  function refThanksBlock() {
    var os = S.d.orders.filter(function (o) { if (!o.refPhone || o.refGift || isVoid(o.status)) return false; if (lvl() >= 2) return true; var c = cust(o.refPhone); return c && c.owner === S.user.name; });
    if (!os.length) return '';
    return '<section class="section"><div class="section-h"><h2>🎁 Cảm ơn khách giới thiệu</h2><span class="count">' + os.length + '</span><span class="tip">nên tặng khi đơn đã giao</span></div><div class="list">' + os.slice(0, 30).map(function (o) {
      var rc = cust(o.refPhone);
      return '<div class="card"><div class="r1"><b>' + esc(rc ? rc.name || o.refPhone : o.refPhone) + '</b><span class="small">giới thiệu</span><b>' + esc(o.name) + '</b></div><div class="small muted" style="margin:4px 0">Đơn ' + esc(o.id) + ' · ' + money(o.total) + ' · ' + esc(o.status) + (lvl() >= 2 && rc && rc.owner ? ' · 👤 ' + esc(rc.owner) : '') + '</div>' +
        '<div class="acts"><button class="btn pri" data-refgift="' + esc(o.id) + '">🎁 Tặng quà / voucher</button>' + (rc ? '<button class="btn ghost" data-cust="' + rc.phone + '">Hồ sơ</button>' : '') + '</div></div>';
    }).join('') + '</div></section>';
  }
  function openRefGift(id) {
    var o = S.d.orders.filter(function (x) { return x.id === id; })[0]; if (!o) return;
    var rc = cust(o.refPhone) || { name: '', phone: o.refPhone };
    var m = modal('🎁 Cảm ơn ' + esc(rc.name || rc.phone), '<p class="small muted" style="margin:0 0 10px">' + esc(rc.name || rc.phone) + ' giới thiệu <b>' + esc(o.name) + '</b> (đơn ' + esc(o.id) + ', ' + money(o.total) + ', ' + esc(o.status) + '). Bạn chọn cách cảm ơn:</p>' +
      '<label class="switch"><input type="radio" name="rgK" value="gift" checked> 🎁 Tặng quà (gửi kèm đơn sau hoặc gửi riêng)</label><br><label class="switch"><input type="radio" name="rgK" value="voucher"> 🎟 Tặng voucher cho lần đặt sau (hạn 90 ngày)</label>' +
      '<div id="rgGift" style="margin-top:10px"><label class="f"><span>Quà tặng là gì</span><input type="text" id="rgText" maxlength="120" placeholder="vd 1 hũ Ruốc rong biển gửi kèm đơn sau"></label></div>' +
      '<div id="rgVc" hidden style="margin-top:10px"><div class="row2c"><label class="f"><span>Loại</span><select id="rgVk"><option value="amount">Giảm số tiền</option><option value="percent">Giảm %</option></select></label><label class="f"><span>Mức giảm</span><input type="text" id="rgVv" inputmode="decimal" value="50k" placeholder="vd 50k hoặc 10"></label></div></div>' +
      '<div id="rgDone"></div>', '<button class="btn pri" id="rgSave">Lưu</button><button class="btn ghost" data-close>Đóng</button>');
    $$('[name=rgK]', m).forEach(function (r) { r.onchange = function () { var v = $('[name=rgK]:checked', m).value; $('#rgGift', m).hidden = v !== 'gift'; $('#rgVc', m).hidden = v !== 'voucher'; }; });
    $('#rgSave', m).onclick = function () {
      var b = this, k = $('[name=rgK]:checked', m).value, vk = $('#rgVk', m).value, vv = $('#rgVv', m).value;
      b.disabled = true;
      api('ref_gift', { id: o.id, kind: k, text: $('#rgText', m).value, vkind: vk, value: vk === 'percent' ? parseFloat(String(vv).replace(',', '.')) || 0 : parseMoney(vv) }).then(function (j) {
        o.refGift = j.gift; b.hidden = true; S._refs = null;
        var txt = j.code ? 'Dạ [Tên] ơi, cảm ơn [Tên] đã giới thiệu ' + (o.name || 'bạn') + ' tin dùng Thực Dưỡng Lành ạ ❤️ Em gửi [Tên] voucher ' + j.code + ' (' + j.label.replace(' ₫', 'đ') + ') cho lần đặt hàng tiếp theo trên web, dùng trong 90 ngày. Bấm link là mã tự áp dụng: https://thucduonglanh.vn/?uudai=' + j.code
          : 'Dạ [Tên] ơi, cảm ơn [Tên] đã giới thiệu ' + (o.name || 'bạn') + ' tin dùng Thực Dưỡng Lành ạ ❤️ Em xin gửi [Tên] món quà nhỏ: ' + $('#rgText', m).value.trim() + '. Em sẽ báo [Tên] khi gửi quà nhé!';
        $('#rgDone', m).innerHTML = '<div class="notice" style="margin-top:10px">✅ Đã lưu: ' + esc(j.gift) + '</div><label class="f"><span>Tin gửi ' + esc(rc.name || 'khách') + '</span><textarea id="rgMsg" rows="5">' + esc(fillTpl(txt, rc)) + '</textarea></label><button class="btn pri" id="rgGo">📋 Copy tin & mở Zalo</button>';
        $('#rgGo', m).onclick = function () { rfCopyZalo(m, '#rgMsg', rc.phone); };
        render();
      }, function (e) { toast(e.message, true); b.disabled = false; });
    };
  }
  function ptBox() {
    return '<div class="box"><h3>🤝 Cộng tác viên & khách giới thiệu</h3><p class="hint" style="margin:0 0 10px">CTV / đối tác có link và mã giảm giá riêng. Khách <b>mới</b> đặt qua link / mã của CTV thì mọi đơn của khách đó trong thời hạn (mặc định 6 tháng, kể cả đơn sale lên lại) được tính hoa hồng (mặc định 10% tiền hàng). Chỉ trả <b>1 tầng</b> (không trả theo người CTV rủ thêm: nhiều tầng là bán hàng đa cấp, phải có giấy phép). Hoa hồng đủ điều kiện khi đơn <b>đã giao + qua 7 ngày</b>; trả từ 2 triệu / lần thì trừ 10% thuế TNCN.</p>' +
      '<p class="hint" style="margin:0 0 10px">Khách cũ giới thiệu bạn bè: sale bấm <b>🎁 Mã giới thiệu</b> trong hồ sơ khách. Cài % giảm cho bạn được giới thiệu ở đây.</p><button class="btn pri" id="ptOpen">Quản lý cộng tác viên</button></div>';
  }
  function openPartners() {
    var D = { j: null };
    var m = modal('🤝 Cộng tác viên & khách giới thiệu', '<div id="ptMain"><p class="muted">Đang tải…</p></div>', '<button class="btn pri" id="ptNew">＋ Thêm CTV</button><button class="btn ghost" id="ptCfgB">⚙️ Cài đặt chung</button><button class="btn ghost" data-close>Đóng</button>');
    var box = function () { return $('#ptMain', m); }, foot = function (on) { $('#ptNew').hidden = !on; $('#ptCfgB').hidden = !on; };
    function done(j) { D.j = j; list(); }
    function fail(e) { toast(e.message, true); }
    function list() {
      var j = D.j, cfg = j.cfg, r = j.refs || {}; foot(true);
      var h = '<p class="small muted" style="margin:0 0 10px">Mặc định: hoa hồng <b>' + cfg.rate + '%</b> · tính đơn mua lại <b>' + cfg.months + ' tháng</b> · bạn được khách cũ giới thiệu giảm <b>' + cfg.refPct + '%</b> đơn đầu.<br>🎁 Khách giới thiệu: ' + (r.codes || 0) + ' mã đã phát · ' + (r.orders || 0) + ' đơn từ bạn bè · ' + (r.gifts || 0) + ' lần đã tặng quà.</p>';
      if (!j.list.length) h += empty('Chưa có CTV nào. Bấm ＋ Thêm CTV (5–10 người thử trước).');
      else h += '<div class="list">' + j.list.map(function (p, i) {
        return '<div class="card"' + (p.active ? '' : ' style="opacity:.6"') + '><div class="r1"><b>' + esc(p.name) + '</b><span class="small">' + esc(p.kind) + ' · ' + p.rate + '%</span>' + (p.active ? '' : '<span class="small muted">· tạm dừng</span>') + '</div>' +
          '<div class="small muted" style="margin:4px 0">🔗 thucduonglanh.vn/?ref=' + esc(p.code) + (p.vcode ? ' · 🎟 mã ' + esc(p.vcode) : '') + (p.phone ? ' · ' + fPhone(p.phone) : '') + '</div>' +
          '<div class="small">👥 ' + p.cust + ' khách · 🛒 ' + p.n + ' đơn · ' + moneyShort(p.sales) + ' tiền hàng<br>💰 Đủ điều kiện trả: <b>' + money(p.ready) + '</b> (' + p.readyN + ' đơn) · chờ giao / đổi trả: ' + money(p.wait) + ' · đã trả: ' + money(p.paid) + '</div>' +
          '<div class="acts" style="margin-top:8px"><button class="btn" data-ptcp="' + i + '">📋 Tin gửi CTV</button><button class="btn" data-ptor="' + i + '">💰 Đơn & đối soát</button><button class="btn ghost" data-pted="' + i + '">✏️ Sửa</button></div></div>';
      }).join('') + '</div>';
      if (j.pays.length) h += '<h3 style="margin:14px 0 6px">Lịch sử trả hoa hồng</h3><div class="small">' + j.pays.slice(0, 20).map(function (p) { var pp = j.list.filter(function (x) { return x.code === p.code; })[0]; return fDate(p.at) + ' · ' + esc(pp ? pp.name : p.code) + ' · ' + p.n + ' đơn · ' + money(p.net) + (p.tax ? ' (thuế ' + money(p.tax) + ')' : '') + ' · ' + esc(p.by); }).join('<br>') + '</div>';
      box().innerHTML = h;
      $$('[data-pted]', m).forEach(function (b) { b.onclick = function () { form(j.list[+b.getAttribute('data-pted')]); }; });
      $$('[data-ptor]', m).forEach(function (b) { b.onclick = function () { orders(j.list[+b.getAttribute('data-ptor')]); }; });
      $$('[data-ptcp]', m).forEach(function (b) { b.onclick = function () { var p = j.list[+b.getAttribute('data-ptcp')]; copy(ptMsg(p)).then(function () { toast('Đã copy – dán vào Zalo gửi CTV'); }); }; });
    }
    function ptMsg(p) {
      return 'Chào ' + p.name + ', đây là link giới thiệu riêng của bạn với Thực Dưỡng Lành: https://thucduonglanh.vn/?ref=' + p.code + (p.vcode ? '\nMã giảm giá cho khách mới của bạn: ' + p.vcode + ' (khách nhập ở trang thanh toán, hoặc dùng link https://thucduonglanh.vn/?uudai=' + p.vcode + '&ref=' + p.code + ')' : '') +
        '\nKhách mới đặt qua link / mã này: bạn nhận ' + p.rate + '% tiền hàng cho mọi đơn của khách trong ' + D.j.cfg.months + ' tháng. Hoa hồng tính khi đơn đã giao và qua 7 ngày đổi trả, đối soát cuối tháng.' +
        '\nLưu ý khi đăng bài: chỉ nói đúng công dụng trên bao bì / hồ sơ công bố, không dùng các từ "chữa", "điều trị", "khỏi bệnh", và ghi rõ "sản phẩm không phải là thuốc, không có tác dụng thay thế thuốc chữa bệnh".';
    }
    function form(p) {
      var isNew = !p; p = p || { code: '', name: '', phone: '', email: '', kind: 'CTV', rate: D.j.cfg.rate, bank: '', idno: '', note: '', vcode: '', active: true }; foot(false);
      box().innerHTML = '<div class="row2c"><label class="f"><span>Tên CTV / đối tác</span><input type="text" id="ptName" value="' + esc(p.name) + '" maxlength="80" placeholder="vd Nguyễn Thu Hương"></label>' +
        '<label class="f"><span>Loại</span><select id="ptKind"><option>CTV</option><option>Đối tác</option></select></label></div>' +
        '<div class="row2c"><label class="f"><span>Mã link (?ref=…)</span><input type="text" id="ptCode" value="' + esc(p.code) + '" maxlength="30"' + (isNew ? '' : ' disabled') + ' placeholder="tự tạo từ tên"></label>' +
        '<label class="f"><span>% hoa hồng</span><input type="text" inputmode="decimal" id="ptRate" value="' + esc(p.rate) + '"></label></div>' +
        '<div class="row2c"><label class="f"><span>Mã giảm giá cho khách mới của CTV (để trống = không có)</span><input type="text" id="ptVc" value="' + esc(p.vcode) + '" maxlength="30" style="text-transform:uppercase" placeholder="vd HUONG10"></label>' +
        '<label class="f"><span>Khách giảm (%)</span><input type="text" inputmode="decimal" id="ptVp" value="' + esc(p.vcode ? p.vpct : '') + '" placeholder="vd 10"></label></div>' +
        '<div class="row2c"><label class="f"><span>Số điện thoại</span><input type="tel" id="ptPhone" value="' + esc(p.phone) + '"></label><label class="f"><span>Email</span><input type="email" id="ptEmail" value="' + esc(p.email) + '"></label></div>' +
        '<div class="row2c"><label class="f"><span>Tài khoản nhận tiền (ngân hàng, số TK, tên)</span><input type="text" id="ptBank" value="' + esc(p.bank) + '"></label><label class="f"><span>Số CCCD (để khấu trừ thuế)</span><input type="text" id="ptId" value="' + esc(p.idno) + '"></label></div>' +
        '<label class="f"><span>Ghi chú</span><input type="text" id="ptNote" value="' + esc(p.note) + '" maxlength="300"></label>' +
        '<label class="switch"><input type="checkbox" id="ptAct"' + (p.active ? ' checked' : '') + '> Đang hợp tác</label>' +
        (isNew ? '' : '<p class="small muted">Đổi % hoa hồng chỉ áp dụng cho đơn mới, đơn đã ghi giữ % cũ. Mã giảm giá đang có: điền lại % giảm khi lưu, để trống ô % là tắt mã.</p>') +
        '<div class="steps" style="margin-top:12px"><button class="btn pri" id="ptSave">' + (isNew ? 'Thêm CTV' : 'Lưu') + '</button><button class="btn ghost" id="ptBack">Quay lại</button></div>' +
        (isNew ? '' : '<details class="p-edit" style="margin-top:12px"><summary>＋ Gắn khách cho CTV này</summary><div class="box" style="margin:8px 0 0"><p class="small muted" style="margin:0 0 8px">Khách mới đặt qua điện thoại / Zalo nhưng do CTV giới thiệu: nhập số khách (đã có đơn trong CRM). Tính từ đơn đầu tiên của khách.</p><input type="tel" id="ptClPh" placeholder="Số điện thoại khách"><button class="btn" id="ptCl" style="margin-top:8px">Gắn khách</button></div></details>');
      $('#ptKind', m).value = p.kind;
      $('#ptBack', m).onclick = list;
      $('#ptSave', m).onclick = function () {
        var b = this; b.disabled = true;
        api('partner_save', { isNew: isNew, code: $('#ptCode', m).value || $('#ptName', m).value, name: $('#ptName', m).value, kind: $('#ptKind', m).value, rate: $('#ptRate', m).value.trim() === '' ? '' : parseFloat($('#ptRate', m).value.replace(',', '.')),
          vcode: $('#ptVc', m).value.trim(), vpct: parseFloat($('#ptVp', m).value.replace(',', '.')) || 0, phone: $('#ptPhone', m).value.trim(), email: $('#ptEmail', m).value.trim(), bank: $('#ptBank', m).value.trim(), idno: $('#ptId', m).value.trim(), note: $('#ptNote', m).value.trim(), active: $('#ptAct', m).checked })
          .then(function (j) { done(j); toast(isNew ? 'Đã thêm – bấm 📋 Tin gửi CTV để gửi link' : 'Đã lưu'); }, function (e) { fail(e); b.disabled = false; });
      };
      if ($('#ptCl', m)) $('#ptCl', m).onclick = function () { var b = this; b.disabled = true; api('partner_claim', { code: p.code, phone: $('#ptClPh', m).value.trim() }).then(function (j) { D.j = j; toast('Đã gắn khách cho ' + p.name); b.disabled = false; $('#ptClPh', m).value = ''; }, function (e) { fail(e); b.disabled = false; }); };
    }
    function orders(p) {
      foot(false); box().innerHTML = '<p class="muted">Đang tải…</p>';
      api('partner_orders', { code: p.code }).then(function (j) {
        var L = j.list, rd = L.filter(function (o) { return o.ready; }), sum = rd.reduce(function (s, o) { return s + o.comm; }, 0), tax = sum >= 2e6 ? Math.round(sum / 10) : 0;
        var st = function (o) { return o.void ? 'huỷ / hoàn' : o.paid ? '✅ đã trả' : o.ready ? '💰 đủ điều kiện' : '⏳ chờ giao / đổi trả'; };
        box().innerHTML = '<p style="margin:0 0 8px"><b>' + esc(p.name) + '</b> · ' + L.length + ' đơn</p>' +
          (rd.length ? '<div class="notice">Đủ điều kiện trả: <b>' + rd.length + ' đơn · ' + money(sum) + '</b>' + (tax ? ' · trừ thuế TNCN 10%: ' + money(tax) + ' → chuyển <b>' + money(sum - tax) + '</b>' : '') + (p.bank ? '<br>🏦 ' + esc(p.bank) : '<br>⚠️ Chưa có tài khoản nhận tiền (✏️ Sửa để thêm)') + '</div><div class="steps" style="margin:8px 0"><button class="btn pri" id="ptPay">✅ Đã chuyển tiền ' + rd.length + ' đơn này</button><button class="btn" id="ptRep">📋 Copy bảng đối soát gửi CTV</button></div>' : '<p class="small muted">Chưa có đơn đủ điều kiện trả.</p><button class="btn" id="ptRep" style="margin-bottom:8px">📋 Copy bảng đối soát gửi CTV</button>') +
          '<div class="small">' + (L.length ? L.map(function (o) { return fDate(o.time) + ' · ' + esc(o.who) + ' · ' + money(o.goods) + ' · ' + o.rate + '% = <b>' + money(o.comm) + '</b> · ' + esc(o.status) + ' · ' + st(o); }).join('<br>') : 'Chưa có đơn.') + '</div>' +
          '<div class="steps" style="margin-top:12px"><button class="btn ghost" id="ptBack">Quay lại</button></div>';
        $('#ptBack', m).onclick = list;
        $('#ptRep', m).onclick = function () { copy('Đối soát hoa hồng – ' + p.name + ' (' + fDate(Date.now()) + ')\n' + L.map(function (o) { return fDate(o.time) + ' | ' + o.who + ' | tiền hàng ' + money(o.goods) + ' | ' + o.rate + '% = ' + money(o.comm) + ' | ' + st(o); }).join('\n') + '\nĐủ điều kiện trả: ' + money(sum) + (tax ? ' − thuế TNCN 10% ' + money(tax) + ' = ' + money(sum - tax) : '')).then(function () { toast('Đã copy – dán vào Zalo gửi CTV'); }); };
        if ($('#ptPay', m)) $('#ptPay', m).onclick = function () {
          if (!confirm('Xác nhận đã chuyển ' + money(sum - tax) + ' cho ' + p.name + '? Các đơn này sẽ ghi là đã trả.')) return; var b = this; b.disabled = true;
          api('partner_pay', { code: p.code, ids: rd.map(function (o) { return o.id; }) }).then(function (j2) { D.j = j2; toast('Đã ghi trả ' + money(j2.paid.net)); orders(p); }, function (e) { fail(e); b.disabled = false; });
        };
      }, fail);
    }
    function cfgForm() {
      var c = D.j.cfg; foot(false);
      box().innerHTML = '<label class="f"><span>% hoa hồng mặc định cho CTV mới</span><input type="text" inputmode="decimal" id="pcRate" value="' + c.rate + '"></label>' +
        '<label class="f"><span>Tính hoa hồng đơn mua lại trong (tháng)</span><input type="number" min="1" max="36" id="pcMon" value="' + c.months + '"></label>' +
        '<label class="f"><span>🎁 Bạn được khách cũ giới thiệu giảm (%) đơn đầu</span><input type="text" inputmode="decimal" id="pcRef" value="' + c.refPct + '"></label>' +
        '<p class="small muted">Đổi % mặc định không đổi % của CTV đã có (sửa từng người). Đổi % giảm cho bạn được giới thiệu: mọi mã giới thiệu đã phát đổi theo.</p>' +
        '<div class="steps" style="margin-top:12px"><button class="btn pri" id="pcSave">Lưu</button><button class="btn ghost" id="ptBack">Quay lại</button></div>';
      $('#ptBack', m).onclick = list;
      $('#pcSave', m).onclick = function () { var b = this; b.disabled = true; api('partner_cfg', { rate: parseFloat($('#pcRate', m).value.replace(',', '.')), months: +$('#pcMon', m).value, refPct: parseFloat($('#pcRef', m).value.replace(',', '.')) }).then(function (j) { done(j); toast('Đã lưu'); }, function (e) { fail(e); b.disabled = false; }); };
    }
    $('#ptNew').onclick = function () { form(null); };
    $('#ptCfgB').onclick = cfgForm;
    api('partner_list').then(done, function (e) { box().innerHTML = '<p class="err">' + esc(e.message) + '</p>'; });
  }
  function mrgBox() {
    return '<div class="box"><h3>🔗 Khách dùng nhiều số</h3><p class="hint" style="margin:0 0 10px">Khách mua bằng 2–3 số điện thoại bị CRM tách thành nhiều hồ sơ. CRM tự tìm hồ sơ nghi cùng 1 người (cùng tên + địa chỉ, hoặc sale ghi số kia trong tên / dòng “SĐT khác”) để gộp lại. Cũng gộp được trong hồ sơ khách → 🔗 Gộp với số khác.' +
      (lvl() < 2 ? ' Bạn gộp được khách <b>do mình phụ trách</b>; số của bạn khác phụ trách thì nhờ quản lý.' : '') + '</p><button class="btn pri" id="mrgOpen">Xem khách nghi trùng</button></div>';
  }
  function openMerges() {
    var D = { groups: null, n: 40, pick: {} };
    var m = modal('🔗 Khách dùng nhiều số', '<div id="mgBox"><p class="muted">Đang tìm khách nghi trùng…</p></div>', '<button class="btn ghost" data-close>Đóng</button>');
    function draw() {
      var box = $('#mgBox', m); if (!box) return;
      if (!D.groups.length) { box.innerHTML = empty('Không còn khách nào nghi dùng nhiều số. 🎉'); return; }
      box.innerHTML = '<p class="hint" style="margin:0 0 10px">CRM nhận khách theo số điện thoại, nên khách mua bằng 2–3 số bị tách thành nhiều hồ sơ (số đơn, tổng chi bị chia nhỏ, có thể bị gọi nhiều lần). Dưới đây là các hồ sơ nghi cùng 1 người. Chọn <b>số chính</b> (thường là số khách hay dùng nhất) rồi bấm <b>Gộp</b>. Không phải 1 người thì bấm <b>Không phải</b>.</p>' +
        '<p class="small muted" style="margin:0 0 10px">' + D.total + ' nhóm' + (D.skipped ? ' · ' + D.skipped + ' nhóm đã đánh dấu không phải' : '') + '</p><div class="list">' +
        D.groups.slice(0, D.n).map(function (g, gi) {
          var sel = D.pick[g.key] || g.items[0].phone;
          return '<div class="card"><div class="r3">🔎 ' + esc(g.why.join(' · ')) + '</div>' + g.items.map(function (it) {
            return '<label class="mg-row"><input type="radio" name="mg' + gi + '" value="' + esc(it.phone) + '"' + (it.phone === sel ? ' checked' : '') + ' data-mgk="' + esc(g.key) + '"><span><b>' + esc(it.name || 'Khách') + '</b> · <span data-copy="' + esc(it.phone) + '">' + esc(fPhone(it.phone)) + '</span>' + (it.owner ? ' · 👤 ' + esc(it.owner) : '') +
              '<br><span class="small muted">' + it.orders + ' đơn · ' + money(it.spent) + (it.last ? ' · mua gần nhất ' + fDate(it.last) : '') + (it.products ? ' · ' + esc(String(it.products).slice(0, 80)) : '') + (it.address ? '<br>📍 ' + esc(String(it.address).slice(0, 120)) : '') + '</span></span></label>';
          }).join('') + '<div class="acts"><button class="btn pri" data-mgdo="' + gi + '">🔗 Gộp vào số đã chọn</button><button class="btn ghost" data-mgno="' + gi + '">Không phải 1 người</button></div></div>';
        }).join('') + '</div>' + (D.groups.length > D.n ? '<button class="btn" id="mgMore" style="margin-top:10px">Xem thêm ' + (D.groups.length - D.n) + ' nhóm</button>' : '');
      $$('[data-mgk]', box).forEach(function (x) { x.onchange = function () { D.pick[x.getAttribute('data-mgk')] = x.value; }; });
      if ($('#mgMore', box)) $('#mgMore', box).onclick = function () { D.n += 40; draw(); };
      $$('[data-mgdo]', box).forEach(function (b) { b.onclick = function () {
        var g = D.groups[+b.getAttribute('data-mgdo')], main = D.pick[g.key] || g.items[0].phone;
        mergeCust(main, g.items.map(function (i) { return i.phone; }).filter(function (p) { return p !== main; }), b, '', function () { D.groups = D.groups.filter(function (x) { return x !== g; }); D.total--; draw(); });
      }; });
      $$('[data-mgno]', box).forEach(function (b) { b.onclick = function () {
        var g = D.groups[+b.getAttribute('data-mgno')]; b.disabled = true;
        api('merge_skip', { key: g.key }).then(function () { D.groups = D.groups.filter(function (x) { return x !== g; }); D.total--; D.skipped = (D.skipped || 0) + 1; draw(); toast('Đã ẩn nhóm này'); }, function (e) { toast(e.message, true); b.disabled = false; });
      }; });
    }
    api('merge_suggest').then(function (j) { D.groups = j.groups || []; D.total = j.total || 0; D.skipped = j.skipped || 0; draw(); }, function (e) { var bx = $('#mgBox', m); if (bx) bx.innerHTML = '<p class="err">' + esc(e.message) + '</p>'; });
  }
  /* ---------- khách trùng sale: quản lý chốt 1 người giữ cho mỗi khách */
  function openDups() {
    var D = { items: null, tab: 'todo', sale: '', n: 60, pick: {} };
    var m = modal('🔀 Khách trùng sale', '<div id="dupBox"><p class="muted">Đang tải…</p></div>', '<button class="btn" id="dupScan">🔄 Quét lại file sale</button><button class="btn ghost" data-close>Đóng</button>');
    function guess(it) { // gợi ý người giữ: người đang phụ trách → sale có đơn gần nhất → sale ghi file gần nhất
      if (it.owner) return it.owner;
      var s = it.sales.slice().sort(function (a, b) { return (b.lastOrder || 0) - (a.lastOrder || 0) || (b.last || 0) - (a.last || 0); })[0];
      return s ? s.sale : '';
    }
    function shown() { return D.items.filter(function (it) { return (D.tab === 'done' ? it.ok : !it.ok) && (!D.sale || it.sales.some(function (s) { return s.sale === D.sale; })); }); }
    function opts(it) {
      var sel = D.pick[it.phone] !== undefined ? D.pick[it.phone] : guess(it), names = it.sales.map(function (s) { return s.sale; });
      userNames().forEach(function (n) { if (names.indexOf(n) < 0) names.push(n); });
      return (sel ? '' : '<option value="">– Chọn người giữ –</option>') + names.map(function (n) { return '<option' + (n === sel ? ' selected' : '') + '>' + esc(n) + '</option>'; }).join('');
    }
    function draw() {
      var box = $('#dupBox', m); if (!box) return;
      var todo = D.items.filter(function (it) { return !it.ok; }).length, done = D.items.length - todo, list = shown(), sales = {};
      D.items.forEach(function (it) { it.sales.forEach(function (s) { sales[s.sale] = 1; }); });
      if (!D.items.length) { box.innerHTML = empty(D.tracked ? 'Không có khách nào trùng giữa các sale. 🎉' : 'Chưa có dữ liệu file sale. Bấm “🔄 Quét lại file sale” bên dưới.'); return; }
      box.innerHTML = '<p class="hint" style="margin:0 0 10px">Chọn sale giữ khách rồi bấm <b>Chốt</b>. Sale được chọn thấy khách trong danh sách chăm sóc của mình; sale kia không thấy nữa. Đơn ai lên vẫn tính doanh số cho người đó.</p>' +
        '<div class="chips" style="margin:0 0 10px"><button class="chip' + (D.tab === 'todo' ? ' on' : '') + '" data-dtab="todo">Cần chốt <em>' + todo + '</em></button><button class="chip' + (D.tab === 'done' ? ' on' : '') + '" data-dtab="done">Đã chốt <em>' + done + '</em></button></div>' +
        '<label class="f"><span>Chỉ xem khách có trong file của</span><select id="dupSale"><option value="">Tất cả sale</option>' + Object.keys(sales).sort().map(function (n) { return '<option' + (n === D.sale ? ' selected' : '') + '>' + esc(n) + '</option>'; }).join('') + '</select></label>' +
        (D.tab === 'todo' && list.length > 1 ? '<div class="steps" style="margin:0 0 10px"><button class="btn pri" id="dupAll">Chốt cả ' + list.length + ' khách theo lựa chọn đang hiện</button></div>' : '') +
        (list.length ? '<div class="list">' + list.slice(0, D.n).map(function (it) {
          return '<div class="card"><div class="r1"><b>' + esc(it.name || 'Khách') + '</b><span class="small muted" data-copy="' + esc(it.phone) + '">' + esc(fPhone(it.phone)) + '</span><span class="end small">' + (it.owner ? '<span class="tag owner">👤 ' + esc(it.owner) + '</span>' : '<span class="tag risk">Chưa ai giữ</span>') + '</span></div>' +
            '<div class="r3">' + it.orders + ' đơn · ' + money(it.spent) + (it.last ? ' · mua gần nhất ' + fDate(it.last) : '') + (it.products.length ? ' · ' + esc(it.products.join(', ')) : '') + '</div>' +
            it.sales.map(function (s) {
              return '<div class="r2">• <b>' + esc(s.sale) + '</b>: ' + (s.sheets.length ? 'có trong file (' + esc(s.sheets.join(', ')) + ')' + (s.last ? ', ghi gần nhất ' + fDate(s.last) : '') : 'đang phụ trách trên CRM, không có trong file') +
                (s.orders ? ' · bán ' + s.orders + ' đơn, ' + money(s.spent) : '') + '</div>';
            }).join('') +
            (it.qc ? '<div class="r3">📋 Cột Trùng sale file quảng cáo: <b>' + esc(it.qc) + '</b> (đổi ở đây thì file tự cập nhật theo)</div>' : '') +
            (it.done ? '<div class="r3">✓ ' + esc(it.done.by) + ' chốt ' + fDate(it.done.at) + ': ' + esc(it.done.owner) + ' giữ' + (it.ok ? '' : ' (sau đó có thay đổi, cần chốt lại)') + '</div>' : '') +
            '<div class="acts"><select data-dpick="' + esc(it.phone) + '" style="flex:1;min-width:150px">' + opts(it) + '</select><button class="btn' + (it.ok ? '' : ' pri') + '" data-dset="' + esc(it.phone) + '">' + (it.ok ? 'Đổi' : 'Chốt') + '</button></div></div>';
        }).join('') + '</div>' + (list.length > D.n ? '<button class="btn" id="dupMore" style="margin-top:10px">Xem thêm ' + (list.length - D.n) + ' khách</button>' : '')
        : empty(D.tab === 'todo' ? 'Đã chốt hết khách trùng ✓' : 'Chưa chốt khách nào.'));
      $$('[data-dtab]', box).forEach(function (b) { b.onclick = function () { D.tab = b.getAttribute('data-dtab'); D.n = 60; draw(); }; });
      $('#dupSale', box).onchange = function () { D.sale = this.value; D.n = 60; draw(); };
      $$('[data-dpick]', box).forEach(function (x) { x.onchange = function () { D.pick[x.getAttribute('data-dpick')] = x.value; }; });
      if ($('#dupMore', box)) $('#dupMore', box).onclick = function () { D.n += 60; draw(); };
      $$('[data-dset]', box).forEach(function (b) { b.onclick = function () { var ph = b.getAttribute('data-dset'), o = $('[data-dpick="' + ph + '"]', box).value; if (!o) { toast('Chọn người giữ khách', true); return; } save([{ phone: ph, owner: o }], b); }; });
      if ($('#dupAll', box)) $('#dupAll', box).onclick = function () {
        var items = list.map(function (it) { var x = $('[data-dpick="' + it.phone + '"]', box); return { phone: it.phone, owner: x ? x.value : (D.pick[it.phone] !== undefined ? D.pick[it.phone] : guess(it)) }; }), miss = items.filter(function (i) { return !i.owner; }).length;
        if (miss) { toast(miss + ' khách chưa chọn người giữ', true); return; }
        var per = {}; items.forEach(function (i) { per[i.owner] = (per[i.owner] || 0) + 1; });
        if (!confirm('Chốt người giữ cho ' + items.length + ' khách?\n' + Object.keys(per).map(function (n) { return '• ' + n + ': ' + per[n] + ' khách'; }).join('\n'))) return;
        save(items, this);
      };
    }
    function save(items, b) {
      b.disabled = true;
      api('dup_set', { items: items }).then(function (j) {
        var by = {}; items.forEach(function (i) { by[i.phone] = i.owner; });
        D.items.forEach(function (it) { if (by[it.phone]) { it.owner = by[it.phone]; it.ok = true; it.done = { owner: it.owner, by: S.user.name, at: Date.now() }; delete D.pick[it.phone]; } });
        toast('Đã chốt ' + j.n + ' khách' + (j.moved ? ', chuyển ' + j.moved + ' khách sang người mới' : '') + ' ✓'); draw(); load(true);
      }, function (e) { toast(e.message, true); b.disabled = false; });
    }
    function got(j) { D.items = j.items || []; D.tracked = j.tracked; draw(); }
    api('dups').then(got, function (e) { var bx = $('#dupBox', m); if (bx) bx.innerHTML = '<p class="err">' + esc(e.message) + '</p>'; });
    $('#dupScan', m).onclick = function () {
      var b = this; b.disabled = true; b.textContent = 'Đang đọc file các sale…';
      api('dup_scan').then(function (j) { got(j); toast('Đã đọc ' + j.scanned + ' sheet' + (j.errors.length ? ', ' + j.errors.length + ' sheet lỗi: ' + j.errors[0] : '') + ' ✓', !!j.errors.length); b.disabled = false; b.textContent = '🔄 Quét lại file sale'; },
        function (e) { toast(e.message, true); b.disabled = false; b.textContent = '🔄 Quét lại file sale'; });
    };
  }

  function modal(title, body, foot, opt) {
    closeModal(true);
    var m = document.createElement('div'); m.className = 'modal'; m.setAttribute('role', 'dialog'); m.setAttribute('aria-modal', 'true');
    m.innerHTML = '<div class="sheet"><div class="sheet-h"><h2>' + title + '</h2><button class="x" data-close aria-label="Đóng">×</button></div><div class="sheet-b">' + body + '</div>' + (foot ? '<div class="sheet-f">' + foot + '</div>' : '') + '</div>';
    document.body.appendChild(m); document.body.style.overflow = 'hidden';
    modalRoute = opt && opt.route || null; modalPushed = !!(opt && opt.pushed);
    m.addEventListener('click', function (e) { if (e.target === m || e.target.closest('[data-close]')) closeModal(); });
    return m;
  }
  function closeModal(silent) {
    var m = $('.modal'); if (!m) return;
    m.remove(); document.body.style.overflow = '';
    if (!silent && modalRoute && route().id) { if (modalPushed) history.back(); else history.replaceState(null, '', modalRoute); }
    modalRoute = null; modalPushed = false;
  }

  /* ================================================================ sự kiện chung */
  document.addEventListener('click', function (e) {
    var t = e.target.closest && e.target.closest('[data-copy]'); if (!t) return;
    e.preventDefault(); e.stopPropagation();
    var v = t.getAttribute('data-copy'); copy(v).then(function () { toast('📋 Đã copy: ' + (v.length > 60 ? v.slice(0, 60) + '…' : v)); });
    t.classList.add('ok'); setTimeout(function () { t.classList.remove('ok'); }, 900);
  }, true);
  /* Bàn phím (Đợt 3, 16/10/2026): thẻ khách / đơn / khách hỏi (div .click) và chữ bấm-để-copy nhận được phím Tab, Enter / Space = bấm. */
  var KB_SEL = '.click:not(button):not(a):not([tabindex]), span[data-copy]:not([tabindex])', kbQ = 0;
  if (window.MutationObserver) new MutationObserver(function () { if (kbQ) return; kbQ = requestAnimationFrame(function () { kbQ = 0; $$(KB_SEL).forEach(function (el) { el.tabIndex = 0; el.setAttribute('role', 'button'); }); }); }).observe(document.body, { childList: true, subtree: true });
  document.addEventListener('keydown', function (e) {
    if (e.defaultPrevented || (e.key !== 'Enter' && e.key !== ' ') || !e.target || e.target.getAttribute('role') !== 'button' || /^(BUTTON|A|INPUT|TEXTAREA|SELECT)$/.test(e.target.tagName)) return;
    e.preventDefault(); e.target.click();
  });
  document.addEventListener('click', function (e) { var b = e.target.closest && e.target.closest('[data-refcode],[data-refgift]'); if (!b || !S.d) return; e.preventDefault(); e.stopPropagation(); if (b.hasAttribute('data-refcode')) openRefCode(b.getAttribute('data-refcode')); else openRefGift(b.getAttribute('data-refgift')); }, true);
  document.addEventListener('click', function (e) { var b = e.target.closest && e.target.closest('[data-relink]'); if (!b || !S.d) return; e.preventDefault(); e.stopPropagation(); openRelink(b.getAttribute('data-relink')); }, true);
  document.addEventListener('click', function (e) { var b = e.target.closest && e.target.closest('[data-copyref]'); if (!b) return; e.preventDefault(); copy(b.getAttribute('data-copyref')).then(function () { toast('Đã copy link ✓'); }); });
  document.addEventListener('click', function (e) { var b = e.target.closest && e.target.closest('[data-gmore]'); if (!b) return; var r = b.previousElementSibling; if (r) r.hidden = false; b.remove(); });
  document.addEventListener('toggle', function (e) { var d = e.target; if (d && d.matches && d.matches('details[data-grp]')) { S.f.gopen = S.f.gopen || {}; S.f.gopen[d.getAttribute('data-grp')] = d.open; } }, true);
  document.addEventListener('click', function (e) {
    var t = e.target.closest('[data-otab],[data-per],[data-pq],[data-promo],[data-rf],[data-vipgo],[data-taghelp],[data-consent],[data-daily],[data-usage],[data-flow],[data-zalo],[data-quick],[data-care],[data-next],[data-neworder],[data-cf],[data-os],[data-och],[data-tf],[data-cat],[data-addtag],[data-deltag],[data-claim],[data-bcdt],[data-srcadd],[data-srcedit],[data-srcsync],[data-srcdel],[data-adsedit],[data-adssync],[data-who],[data-target],[data-race],[data-offer],[data-myold],[data-more],[data-add],[data-rm],[data-consult],[data-leadorder],[data-newlead],[data-editlead],[data-cust],[data-order],[data-lead]');
    if (!t || !S.d) return;
    if (e.target.closest('a[href]') && !t.hasAttribute('data-myold')) return; // nút gọi / Zalo bên trong thẻ
    if (e.target.closest('select[data-oassign]')) return; // ô “Giao cho…” trên dòng đơn: không mở hộp đơn
    var a = function (k) { return t.getAttribute(k); };
    if (t.hasAttribute('data-flow')) { startFlow(); return; }
    if (t.hasAttribute('data-taghelp')) { openTagHelp(); return; }
    if (t.hasAttribute('data-promo')) { openPromo(); return; }
    if (t.hasAttribute('data-rf')) { var rf = a('data-rf').split('|'); S.f.r = S.f.r || {}; S.f.r[rf[0]] = rf[1]; render(); return; }
    if (t.hasAttribute('data-vipgo')) { e.preventDefault(); S.f.c = { q: '', k: 'risk', sort: 'spent', n: 60 }; location.hash = '#khach-hang'; return; }
    if (t.hasAttribute('data-consent')) { e.stopPropagation(); var cc = cust(a('data-consent')); if (cc) { var off = t.hasAttribute('data-off'); if (off && !confirm('Khách không muốn nhận tin ưu đãi nữa? CRM sẽ bỏ khách này khỏi 📣 Gửi ưu đãi lần lượt.')) return; sendOp('customer', { phone: cc.phone, consent: off ? 0 : 1 }); t.outerHTML = consentTag(cc); toast(off ? 'Đã bỏ: khách không nhận tin ưu đãi' : 'Đã ghi: khách đồng ý nhận ưu đãi ✓'); } return; }
    if (t.hasAttribute('data-daily')) { openDaily(a('data-daily') || null); return; }
    if (t.hasAttribute('data-usage')) { openUsage(a('data-usage') || null); return; }
    if (t.hasAttribute('data-zalo')) { e.stopPropagation(); var zc = cust(a('data-zalo')); if (zc) { setZalo(zc, true); var zb = $('.modal [data-zalo]'); if (zb) zb.outerHTML = zaloTag(zc); } return; }
    if (t.hasAttribute('data-quick')) { e.stopPropagation(); var qk = a('data-quick').split('|'), qc = cust(qk[0]); if (qc) quickCare(qc, qk[1], qk[2], '', t); return; }
    if (t.hasAttribute('data-care')) { e.stopPropagation(); openCare(a('data-care'), a('data-task')); return; }
    if (t.hasAttribute('data-next')) { var o = findOrder(a('data-next')); if (o && NEXT[o.status]) setStatus(o, NEXT[o.status]); return; }
    if (t.hasAttribute('data-cat')) { var ck = a('data-cat'); S.f.c = S.f.c || { q: '', k: 'all', sort: 'last', n: 60 }; S.f.c.cat = S.f.c.cat === ck ? '' : ck; S.f.c.n = 60; if (route().view !== 'khach-hang') location.hash = '#khach-hang'; else if ($('#cList')) renderCustomersPart(); else render(); return; }
    if (t.hasAttribute('data-addtag')) { var cols = ['#dbeafe', '#dcfce7', '#fee2e2', '#ffedd5', '#fce7f3', '#e0f2fe']; S.f.tags.push({ name: '', color: cols[S.f.tags.length % cols.length] }); render(); var ins = $$('#tagRows input[type=text]'); if (ins.length) ins[ins.length - 1].focus(); return; }
    if (t.hasAttribute('data-deltag')) { S.f.tags.splice(+a('data-deltag'), 1); render(); return; }
    if (t.hasAttribute('data-bcdt')) { var bc = a('data-bcdt').split('|'); openBcdt(bc[0] || null, bc[1]); return; }
    if (t.hasAttribute('data-srcadd')) { openSrc(''); return; }
    if (t.hasAttribute('data-srcedit')) { openSrc(a('data-srcedit')); return; }
    if (t.hasAttribute('data-srcsync')) { openSrcSync(a('data-srcsync')); return; }
    if (t.hasAttribute('data-srcdel')) { if (confirm('Xoá cấu hình file này? Dữ liệu đã nhập vào CRM vẫn giữ nguyên.')) api('src_delete', { id: a('data-srcdel') }).then(function () { toast('Đã xoá'); load(true); }, function (e) { toast(e.message, true); }); return; }
    if (t.hasAttribute('data-adsedit')) { openAds(); return; }
    if (t.hasAttribute('data-adssync')) { runAds(a('data-adssync') === 'dry', t); return; }
    if (t.hasAttribute('data-claim')) {
      var cl = a('data-claim').split('|');
      var prevOwner = cl[0] === 'c' ? (cust(cl[1]) || {}).owner : (findLead(cl[1]) || {}).owner;
      if (cl[0] === 'c') { var c0 = cust(cl[1]); if (c0) c0.owner = S.user.name; }
      else { var l0 = findLead(cl[1]); if (l0) l0.owner = S.user.name; }
      toast('Đã nhận khách ✓'); closeModal(true); navBadges();
      if (cl[0] === 'c' && $('#cList')) renderCustomersPart();
      else if (cl[0] !== 'c' && $('#tList')) renderLeadsPart();
      else render();
      api('claim', cl[0] === 'c' ? { phone: cl[1] } : { leadId: cl[1] }).then(function () {
        // thành công
      }, function (e) {
        if (cl[0] === 'c') { var c0 = cust(cl[1]); if (c0) c0.owner = prevOwner; }
        else { var l0 = findLead(cl[1]); if (l0) l0.owner = prevOwner; }
        toast(e.message, true); navBadges(); render();
      });
      return;
    }
    if (t.hasAttribute('data-consult')) { openConsult(a('data-consult')); return; }
    if (t.hasAttribute('data-leadorder')) { var L = findLead(a('data-leadorder')); if (L) openOrderForm({ lead: L }); return; }
    if (t.hasAttribute('data-newlead')) { openLeadForm(); return; }
    if (t.hasAttribute('data-editlead')) { var L2 = findLead(a('data-editlead')); if (L2) openLeadForm(L2); return; }
    if (t.hasAttribute('data-neworder')) { openNewOrder(a('data-neworder')); return; }
    if (t.hasAttribute('data-cf')) { searchKeep(S.f.c); S.f.c.k = a('data-cf'); S.f.c.n = 60; if ($('#cList')) renderCustomersPart(); else render(); return; }
    if (t.hasAttribute('data-och')) { searchKeep(S.f.o); S.f.o.ch = a('data-och'); S.f.o.n = 60; if ($('#oBody')) renderOrdersPart(); else render(); return; }
    if (t.hasAttribute('data-os')) { searchKeep(S.f.o); S.f.o.st = a('data-os'); S.f.o.n = 60; if ($('#oBody')) renderOrdersPart(); else render(); return; }
    if (t.hasAttribute('data-otab')) { searchKeep(S.f.o); S.f.o.tab = a('data-otab'); if (S.f.o.tab === 'todo') S.f.o.q = ''; S.f.o.n = 60; if ($('#oBody')) renderOrdersPart(); else render(); return; }
    if (t.hasAttribute('data-per')) { openPer(a('data-per')); return; }
    if (t.hasAttribute('data-pq')) { var pq = a('data-pq').split('|'); S.f[pq[0]].p = { k: pq[1] }; if (pq[0] === 'o') S.f.o.n = 60; render(); return; }
    if (t.hasAttribute('data-tf')) { searchKeep(S.f.t); S.f.t.k = a('data-tf'); S.f.t.n = 60; if ($('#tList')) renderLeadsPart(); else render(); return; }
    if (t.hasAttribute('data-who')) { setWho(a('data-who') === 'team' ? '' : a('data-who')); window.scrollTo(0, 0); return; }
    if (t.hasAttribute('data-offer')) { offerEdit(a('data-offer')); return; }
    if (t.hasAttribute('data-race')) { if (a('data-race') === 'retry') S.race = null; else S.f.race = a('data-race'); render(); return; }
    if (t.hasAttribute('data-target')) { var tg = a('data-target').split('|'); openTarget(tg[0], tg[1]); return; }
    if (t.hasAttribute('data-myold')) { e.preventDefault(); if (lvl() >= 2) { S.who = S.user.name; store('crm_who', S.who); } S.f.c = { q: '', k: 'all', sort: 'age', n: 60 }; location.hash = '#khach-hang'; return; }
    if (t.hasAttribute('data-more')) {
      var mk = a('data-more'); S.f[mk].n += 60;
      if (mk === 'c' && $('#cList')) renderCustomersPart(true);
      else if (mk === 'o' && $('#oBody')) renderOrdersPart(true);
      else if (mk === 't' && $('#tList')) renderLeadsPart(true);
      else render();
      return;
    }
    if (t.hasAttribute('data-add')) { var k = a('data-add'); S.f[k].push(k === 'us' ? { email: '', name: '', role: 'Sale & CSKH', active: true, alias: '', prefix: '', web: false } : k === 'tp' ? ['', '', ''] : ['', '', '', '']); render(); var rows = $$('#' + k + 'T .edit-row[data-i]'); if (rows.length) $('input', rows[rows.length - 1]).focus(); return; }
    if (t.hasAttribute('data-rm')) { var k2 = a('data-rm'); if (k2 === 'us' && S.f.us[+a('data-i')].email === S.user.email) { toast('Không tự xoá tài khoản của mình được.', true); return; } S.f[k2].splice(+a('data-i'), 1); render(); return; }
    if (t.hasAttribute('data-cust')) { closeModal(true); openCustomer(a('data-cust')); return; }
    if (t.hasAttribute('data-order')) { closeModal(true); openOrder(a('data-order')); return; }
    if (t.hasAttribute('data-lead')) { closeModal(true); openLead(a('data-lead')); return; }
  });
  document.addEventListener('click', function (e) {
    if (S.d && e.target.closest('[data-cfclear]')) {
      S.f.c.spend = ''; S.f.c.src = ''; S.f.c.bday = ''; S.f.c.n = 60;
      if ($('#cList')) renderCustomersPart(); else render();
    }
  });
  document.addEventListener('click', function (e) { // mã vận đơn trên dòng đơn: copy mã (link thì mở trang tra cứu), không mở hộp đơn
    var tk = e.target.closest && e.target.closest('[data-trk]'); if (!tk) return;
    e.stopPropagation(); var code = tk.getAttribute('data-trk'), paste = tk.tagName === 'A' && tk.getAttribute('href').indexOf(encodeURIComponent(code)) < 0;
    copy(code).then(function () { toast('Đã copy mã vận đơn ' + code + (paste ? ' – dán vào ô tra cứu' : '')); });
  }, true);
  document.addEventListener('click', function (e) { var gb = e.target.closest && e.target.closest('[data-gift]'); if (!gb || !S.d) return; e.stopPropagation(); var a = gb.getAttribute('data-gift').split('|'); giftAct(gb, a[0], a[1], a[2]); }, true);
  document.addEventListener('click', function (e) { var cm = e.target.closest && e.target.closest('[data-comm]'); if (!cm || !S.d) return; e.stopPropagation(); var a = cm.getAttribute('data-comm').split('|'); commAct(a[0], a[1]); }, true);
  document.addEventListener('click', function (e) { var g = e.target.closest && e.target.closest('[data-gsopen]'); if (!g || !S.d) return; e.stopPropagation(); openGlobalSearch(g.getAttribute('data-gsopen')); }, true);
  document.addEventListener('click', function (e) { // nút ✕ trong ô tìm kiếm: xoá chữ, giữ con trỏ để gõ tìm mới
    var bx = e.target.closest && e.target.closest('.search-x'); if (!bx) return;
    var inp = bx.parentNode.querySelector('input'); if (!inp) return;
    e.preventDefault(); inp.value = ''; inp.focus(); inp.dispatchEvent(new Event('input', { bubbles: true }));
  });
  var typing = null;
  document.addEventListener('input', function (e) {
    if (!S.d) return;
    if (e.target.id === 'cq' || e.target.id === 'oq' || e.target.id === 'tq') {
      var id = e.target.id, v = e.target.value;
      clearTimeout(typing);
      typing = setTimeout(function () {
        var on = !!v.trim();
        if (id === 'cq') { S.f.c.q = v; searchWide(S.f.c, on, { k: 'all', cat: '', spend: '', src: '', bday: '' }); S.f.c.n = 60; if ($('#cList')) renderCustomersPart(); else render(); }
        else if (id === 'oq') { S.f.o.q = v; searchWide(S.f.o, on, { tab: 'all', st: 'all', ch: '', p: { k: 'all' } }); S.f.o.n = 60; if ($('#oBody')) renderOrdersPart(); else render(); }
        else if (id === 'tq') { S.f.t.q = v; searchWide(S.f.t, on, { k: 'all', ch: '' }); S.f.t.n = 60; if ($('#tList')) renderLeadsPart(); else render(); }
        searchSync();
      }, 200);
    }
  });
  document.addEventListener('change', function (e) {
    if (!S.d) return;
    if (e.target.id === 'csort') { S.f.c.sort = e.target.value; if ($('#cList')) renderCustomersPart(); else render(); }
    if (e.target.id === 'cspend' || e.target.id === 'csrc' || e.target.id === 'cbday') { searchKeep(S.f.c); S.f.c[{ cspend: 'spend', csrc: 'src', cbday: 'bday' }[e.target.id]] = e.target.value; S.f.c.n = 60; if ($('#cList')) renderCustomersPart(); else render(); }
    if (e.target.id === 'tch') { searchKeep(S.f.t); S.f.t.ch = e.target.value; S.f.t.n = 60; if ($('#tList')) renderLeadsPart(); else render(); }
    if (e.target.hasAttribute && e.target.hasAttribute('data-assign') && e.target.value) {
      var as = e.target.getAttribute('data-assign').split('|'), to = e.target.value;
      var prevOwner = as[0] === 'c' ? (cust(as[1]) || {}).owner : (findLead(as[1]) || {}).owner;
      if (as[0] === 'c') {
        var c1 = cust(as[1]); if (c1) c1.owner = to;
        (S.d.leads || []).forEach(function (l) { if (l.phone === as[1] && isOpenLead(l)) l.owner = to; });
      } else {
        var l1 = findLead(as[1]); if (l1) l1.owner = to;
      }
      toast('Đã giao cho ' + to + ' ✓'); navBadges();
      if (as[0] === 'c' && $('#cList')) renderCustomersPart();
      else if (as[0] !== 'c' && $('#tList')) renderLeadsPart();
      else render();
      api('assign', as[0] === 'c' ? { phones: [as[1]], to: to, withLeads: true } : { leadIds: [as[1]], to: to }).then(function () {
        // success
      }, function (er) {
        if (as[0] === 'c') { var c1 = cust(as[1]); if (c1) c1.owner = prevOwner; }
        else { var l1 = findLead(as[1]); if (l1) l1.owner = prevOwner; }
        toast(er.message, true); navBadges(); render();
      });
      return;
    }
    if (e.target.hasAttribute && e.target.hasAttribute('data-oassign')) { var oa = findOrder(e.target.getAttribute('data-oassign')); if (oa) assignOrder(oa, e.target.value, e.target); return; }
    if (e.target.id === 'who') { setWho(e.target.value); }
  });
  document.addEventListener('keydown', function (e) { if (e.key === 'Escape' && $('.modal')) closeModal(); });
  window.addEventListener('hashchange', function () { if (!route().id) closeModal(true); render(); if (S.d) useScreen(); });
  window.addEventListener('popstate', function () { if (!route().id && $('.modal')) closeModal(true); });
  // tự làm mới mỗi 15 phút khi đang mở trang, và khi quay lại tab sau 10 phút (mỗi lần tải đọc toàn bộ dữ liệu, tải dày sẽ vượt hạn mức đọc miễn phí của máy chủ)
  function nightVN() { var h = new Date(Date.now() + 7 * 3600e3).getUTCHours(); return h < 6 || h >= 22; } // 22h–6h: máy để mở qua đêm thì không tự làm mới
  setInterval(function () { if (S.d && !document.hidden && !$('.modal') && !nightVN() && Date.now() - S.loadedAt > 15 * 60e3) load(true); if (S.pq && S.pq.length && Date.now() - (S.pqAt || 0) > 120e3) perfFlush(); useTick(!document.hidden); if (Date.now() - U.at > 300e3) useFlush(); }, 30e3);
  document.addEventListener('visibilitychange', function () {
    if (document.hidden) { useTick(true); U.hid = Date.now(); useFlush(); } else { U.tick = Date.now(); if (S.token && U.hid && Date.now() - U.hid > 30 * 60e3) { U.opens++; useScreen(); } } // quay lại sau 30 phút = 1 lượt mở mới
    if (document.hidden) perfFlush(); if (!document.hidden && S.d && !$('.modal') && Date.now() - S.loadedAt > 10 * 60e3) load(true); });

  /* ================================================================ chạy */
  if (S.token) start(); else renderLogin('email');
})();
