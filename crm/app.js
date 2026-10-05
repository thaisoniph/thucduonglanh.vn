/* CRM Thực Dưỡng Lành – crm.thucduonglanh.vn
 * Trang tĩnh, dữ liệu nằm trong Google Sheet, đọc/ghi qua Apps Script (backend/google-apps-script.gs, type: 'crm'). */
(function () {
  'use strict';
  var CFG = window.CRM_CONFIG || {};
  var DAY = 864e5;
  var S = { token: store('crm_token'), user: null, d: null, loading: false, loadedAt: 0, mine: store('crm_mine') === '1', f: {}, units: null };

  var TASKS = {
    callback: { icon: '📞', title: 'Hẹn gọi lại', tip: 'khách đã hẹn đến hôm nay', tpl: '' },
    d1: { icon: '📦', title: 'Hỏi nhận hàng, hướng dẫn dùng', tip: 'khách vừa nhận hàng (hoặc đã quá ngày giao dự kiến)', tpl: '1 ngày' },
    runout: { icon: '⏰', title: 'Sắp hết / đã hết sản phẩm', tip: 'nhắc đặt lại, đơn từ 300K được freeship', tpl: 'hết' },
    d7: { icon: '🤝', title: 'Hỏi thăm sau 1 tuần', tip: '7 ngày sau khi nhận hàng: dùng có khó khăn gì, cần hỗ trợ gì', tpl: '7 ngày' },
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
  function isVoid(st) { return /huỷ|hủy|hoàn/i.test(String(st || '')); } // huỷ / hoàn: không tính doanh thu
  var NEXT = { 'Mới': 'Đã xác nhận', 'Đã xác nhận': 'Đang giao', 'Đang giao': 'Đã giao' };
  var NEXT_LABEL = { 'Mới': '✅ Xác nhận', 'Đã xác nhận': '🚚 Đang giao', 'Đang giao': '📬 Đã giao' };
  var RESULTS = ['Đã đặt lại', 'Hẹn gọi lại', 'Không nghe máy', 'Đã hỏi thăm', 'Không có nhu cầu'];
  // Ghi nhanh 1 chạm (giống cách sale viết tắt trên Sheet): tự chọn kết quả + tự hẹn ngày gọi lại
  var QUICK = [
    { k: 'knm', l: '📵 KNM', r: 'Không nghe máy', n: 'knm', d: 2 },
    { k: 'tb', l: '📴 Thuê bao', r: 'Không nghe máy', n: 'thuê bao', d: 3 },
    { k: 'tcn', l: '🙅 Từ chối nghe', r: 'Không nghe máy', n: 'từ chối nghe', d: 7 },
    { k: 'ok', l: '👍 Dùng ok', r: 'Đã hỏi thăm', n: 'kh dùng ok', d: 0 },
    { k: 'con', l: '📦 Còn hàng', r: 'Hẹn gọi lại', n: 'kh còn nhiều', d: 14 },
    { k: 'tien', l: '💸 Hết tiền', r: 'Hẹn gọi lại', n: 'kh hết tiền, hẹn tháng sau', d: 30 },
    { k: 'mua', l: '🛒 Đặt lại', r: 'Đã đặt lại', n: 'kh đặt lại', d: 0, order: true },
    { k: 'thoi', l: '🚫 Không dùng nữa', r: 'Không có nhu cầu', n: 'kh không dùng nữa', d: 0 },
    { k: 'nhan', l: '📦 Đã nhận, đã HD dùng', r: 'Đã hỏi thăm', n: 'kh đã nhận hàng, đã hướng dẫn dùng', d: 0, received: 1, only: 'd1' },
    { k: 'chuanhan', l: '🚚 Chưa nhận hàng', r: 'Hẹn gọi lại', n: 'kh chưa nhận được hàng', d: 2, only: 'd1' }
  ];
  var SOURCES = ['Zalo', 'Điện thoại', 'Facebook', 'TikTok', 'Shopee', 'Khách quen giới thiệu', 'Tại cửa hàng', 'Khác'];
  var GROUP_CLS = { 'VIP': 'vip', 'Quay lại': 'back', 'Mới': 'new', 'Sắp mất': 'risk' };
  var LEAD_ST = ['Mới hỏi', 'Đang tư vấn', 'Đã chốt', 'Không mua'];
  var LEAD_CLS = { 'Mới hỏi': 'st-moi', 'Đang tư vấn': 'st-xn', 'Đã chốt': 'st-xong', 'Không mua': 'st-huy' };
  var CHANNELS = ['Facebook', 'Zalo', 'TikTok', 'Điện thoại', 'Form website', 'Shopee', 'Người quen giới thiệu', 'Sự kiện / hội thảo', 'Khác'];
  var LEAD_RESULTS = [{ v: 'Đã tư vấn, khách cân nhắc', days: 2 }, { v: 'Hẹn liên hệ lại', days: 2 }, { v: 'Không nghe máy', days: 1 }, { v: 'Khách chốt mua', close: true }, { v: 'Khách không mua', lost: true }];
  var LOST_REASONS = ['Giá cao', 'Chưa có nhu cầu', 'Đã mua nơi khác', 'Không liên lạc được', 'Khác'];
  // Đơn vị vận chuyển → link tra cứu ({c} = mã vận đơn). Hãng không có link thẳng thì mở trang tra cứu, mã được copy sẵn để dán.
  var CARRIERS = { 'GHN': 'https://donhang.ghn.vn/?order_code={c}', 'GHTK': 'https://i.ghtk.vn/{c}', 'Viettel Post': 'https://viettelpost.com.vn/tra-cuu-hanh-trinh-don/', 'J&T Express': 'https://jtexpress.vn/vi/tracking?type=track&billcode={c}', 'SPX Express': 'https://spx.vn/track?{c}', 'VNPost': 'https://vnpost.vn/', 'Ahamove': '', 'Grab / Be': '', 'Tự giao': '' };

  var I = {
    today: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M9 11l3 3L22 4"/><path d="M21 12v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11"/></svg>',
    users: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 0 0-3-3.87M16 3.13a4 4 0 0 1 0 7.75"/></svg>',
    box: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z"/><path d="M3.27 6.96L12 12.01l8.73-5.05M12 22.08V12"/></svg>',
    mail: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/></svg>',
    gear: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 1 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 1 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 1 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 1 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"/></svg>',
    refresh: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M23 4v6h-6M1 20v-6h6"/><path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15"/></svg>',
    lead: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M19 8v6M22 11h-6"/></svg>',
    chart: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 3v18h18"/><path d="M8 17V10M13 17V6M18 17v-4"/></svg>',
    help: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><path d="M9.09 9a3 3 0 0 1 5.83 1c0 2-3 3-3 3M12 17h.01"/></svg>',
    search: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><circle cx="11" cy="11" r="7"/><path d="M21 21l-4.3-4.3"/></svg>'
  };

  /* ================================================================ tiện ích */
  function $(s, r) { return (r || document).querySelector(s); }
  function $$(s, r) { return Array.prototype.slice.call((r || document).querySelectorAll(s)); }
  function esc(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }
  function store(k, v) {
    try { if (v === undefined) return localStorage.getItem(k); if (v === null) localStorage.removeItem(k); else localStorage.setItem(k, v); } catch (e) { }
    return null;
  }
  function money(n) { return (Number(n) || 0).toLocaleString('vi-VN') + 'đ'; }
  function moneyShort(n) { n = Number(n) || 0; if (n >= 1e9) return (n / 1e9).toFixed(1).replace('.0', '') + ' tỷ'; if (n >= 1e6) return (n / 1e6).toFixed(1).replace('.0', '').replace('.', ',') + ' tr'; return money(n); }
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
  function normPhone(p) { p = String(p || '').replace(/\D/g, ''); if (p.indexOf('84') === 0 && p.length >= 11) p = '0' + p.slice(2); if (p.length === 9 && /^[35789]/.test(p)) p = '0' + p; return p; } // số copy từ Google Sheet hay mất số 0 đầu
  function fPhone(p) { p = normPhone(p); return p.length === 10 ? p.slice(0, 4) + ' ' + p.slice(4, 7) + ' ' + p.slice(7) : p; }
  function zalo(p) { return 'https://zalo.me/' + normPhone(p); }
  var ZI = '<svg class="zi" viewBox="0 0 32 32" aria-hidden="true"><rect width="32" height="32" rx="8" fill="#0068ff"/><text x="16" y="20.5" text-anchor="middle" font-family="Arial,Helvetica,sans-serif" font-size="11.5" font-weight="700" fill="#fff">Zalo</text></svg>'; // biểu tượng Zalo: khách đã kết bạn (khác 💬 = chăm sóc / nhắn tin)
  function lvl() { return S.user ? S.user.level : 0; }
  function toast(msg, err) {
    var el = document.createElement('div'); if (err) el.className = 'err'; el.textContent = msg; $('#toast').appendChild(el);
    setTimeout(function () { el.remove(); }, err ? (msg.length > 120 ? 15000 : 6000) : 2800);
  }
  function copy(text) {
    if (navigator.clipboard && window.isSecureContext) return navigator.clipboard.writeText(text).catch(fallback);
    fallback(); return Promise.resolve();
    function fallback() { var t = document.createElement('textarea'); t.value = text; t.style.position = 'fixed'; t.style.opacity = '0'; document.body.appendChild(t); t.select(); try { document.execCommand('copy'); } catch (e) { } t.remove(); }
  }

  var SERVER_V = '2026-10-02a'; // phải trùng số phiên bản máy chủ (api/src/index.js)
  var ON_CF = !/script\.google/.test(CFG.endpoint || ''); // máy chủ Cloudflare (nhanh) hay Apps Script cũ
  function checkVersion(j) {
    if (j && j.v) S.srvV = j.v;
    if (!j || S._vWarned || j.v === SERVER_V || j.v === '2026-10-02b' || j.v === '2026-10-02c' || j.v === '2026-10-04a' || j.v === '2026-10-04b' || j.v === '2026-10-04c' || j.v === '2026-10-05a' || j.v === '2026-10-05b' || j.v === '2026-10-05c' || j.v === '2026-10-05d' || j.v === 'moved') return;
    S._vWarned = true;
    if (lvl() >= 2 || (j.user && j.user.level >= 2)) toast('⚠️ Máy chủ Apps Script đang chạy bản cũ (' + (j.v || 'chưa có số phiên bản') + '), cần bản ' + SERVER_V + '. Vào Apps Script → Triển khai → Quản lý các bản triển khai → ✏️ → Phiên bản: Phiên bản mới → Triển khai.', true);
  }
  var lastErr = '';
  var READ_ACTS = { load: 1, src_inspect: 1, ads_inspect: 1, cust_orders: 1, fb_list: 1, fb_img: 1, check_phone: 1 }; // chỉ đọc: Google trả lỗi tạm thời thì tự thử lại
  function api(action, payload, tries) {
    var body = Object.assign({ type: 'crm', action: action, token: S.token }, payload || {});
    if (!CFG.endpoint) return Promise.reject(new Error('Chưa cấu hình máy chủ.'));
    tries = tries || 0; var t0 = Date.now();
    return fetch(CFG.endpoint, { method: 'POST', headers: { 'Content-Type': 'text/plain;charset=utf-8' }, body: JSON.stringify(body) })
      .then(function (r) { return r.text().then(function (t) { return { t: t, st: r.status }; }); }, function () { var e0 = new Error('Mất kết nối mạng. Bạn thử lại nhé.'); e0.net = true; throw e0; })
      .then(function (x) {
        try { var j0 = JSON.parse(x.t); if (j0 && action === 'load') j0.__kb = Math.round(x.t.length / 1024); return j0; } catch (e) {
          if (READ_ACTS[action] && tries < 2) return new Promise(function (ok) { setTimeout(ok, 1500 * (tries + 1)); }).then(function () { return api(action, payload, tries + 1); }).then(function (j) { j.__retried = 1; return j; });
          var hint = String(x.t || '').replace(/<style[\s\S]*?<\/style>|<script[\s\S]*?<\/script>/gi, ' ').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 160);
          var e1 = new Error('Máy chủ Google báo lỗi (thường do việc chạy quá lâu hoặc file quá lớn). Bạn bấm lại thử; nếu vẫn lỗi, chụp màn hình gửi quản trị. [' + x.st + (hint ? ': ' + hint : '') + ']'); e1.net = true; throw e1;
        }
      })
      .then(function (j) {
        perfRec(action, t0, j); checkVersion(j);
        if (!j || !j.ok) {
          if (j && j.auth) { logout(true); }
          lastErr = action + ': ' + ((j && j.error) || '');
          throw new Error((j && j.error) || 'Có lỗi, bạn thử lại nhé.');
        }
        return j;
      });
  }

  /* ---------- đo tốc độ: ghi thời gian mỗi lần tải / lưu, 2 phút gửi 1 lần lên tab "Đo tốc độ CRM" (để biết chậm do máy chủ hay do mạng) */
  var PERF_SKIP = { perf: 1, login: 1, verify: 1, logout: 1, fb_img: 1, fb_list: 1 };
  function perfRec(action, t0, j) {
    if (PERF_SKIP[action] || !j || !j.ok) return;
    var src = action === 'load' ? (j.rest ? 'đợt 2 · ' : '') + (j.t && j.t.cached ? 'bản đọc sẵn' : 'đọc Sheet') : j.pc === true ? 'sửa bản đọc sẵn' : j.pc === false ? 'bỏ bản đọc sẵn' : '';
    S.pq = S.pq || []; S.pq.push([t0, action, Date.now() - t0, j.sms, src, action === 'load' ? j.__kb || '' : '']); if (S.pq.length > 60) S.pq.shift();
  }
  function perfFlush() {
    if (!S.pq || !S.pq.length || !S.token || !/^\d{4}-\d\d-\d\d[a-z]$/.test(S.srvV || '') || S.srvV < '2026-10-05d') return; // máy chủ cũ chưa có lệnh này
    var rows = S.pq, ua = navigator.userAgent, cn = navigator.connection; S.pq = []; S.pqAt = Date.now();
    var dev = (/iPhone|iPad/.test(ua) ? 'iPhone/iPad' : /Android/.test(ua) ? 'Android' : /Mac/.test(ua) ? 'Mac' : /Windows/.test(ua) ? 'Windows' : 'Khác') + (/Zalo/i.test(ua) ? ' · trong Zalo' : '') + (cn && cn.effectiveType ? ' · mạng ' + cn.effectiveType : '') + ' · ' + window.innerWidth + 'px';
    api('perf', { rows: rows, dev: dev }).catch(function () { });
  }

  /* ================================================================ đăng nhập */
  function renderLogin(step, email, msg) {
    $('#app').innerHTML = '<div class="login"><form class="login-box" novalidate>' +
      '<img src="/logo.webp" alt="Thực Dưỡng Lành"><h1>CRM Thực Dưỡng Lành</h1>' +
      (step === 'code'
        ? '<p class="sub">Mã 6 số đã gửi tới <b>' + esc(email) + '</b>.<br>Mở hộp thư (xem cả mục Spam/Quảng cáo) để lấy mã.</p>' +
          '<label class="f"><span>Mã đăng nhập</span><input class="code" name="code" inputmode="numeric" autocomplete="one-time-code" maxlength="6" required></label>' +
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
  function load(silent) {
    if (S.loading) return Promise.resolve();
    S.loading = true; var b = $('#refresh'); if (b) b.classList.add('spin');
    var fresh = !silent && !!S.d, t0 = Date.now(), prev = S.d; // bấm ↻: đọc thẳng từ Sheet, không dùng bản máy chủ nhớ tạm
    var p = { part: 'core' }; if (fresh) p.fresh = 1;
    return api('load', p).then(function (j) {
      S.stale = false;
      if (j.part && prev && prev.orders) keepOld(j, prev); // đang có dữ liệu cũ trên máy → giữ phần cũ tới khi đợt 2 về, số liệu không bị hụt
      j.partial = !!j.part; setData(j, Date.now()); S.perf = { core: Date.now() - t0, srv: j.t, kb: j.__kb };
      if (!j.part) idb('set', 'data', { tk: S.token.slice(-12), at: S.loadedAt, d: j }); // máy chủ cũ: 1 đợt
      if (!$('.me')) shell(); else { $('.me').innerHTML = meHTML(); navBadges(); } // .me chỉ có ở giao diện thật (khung chờ không có)
      softRender(silent);
      if (j.part) loadRest(j); // tải ngầm, không giữ S.loading → bấm ↻ lúc đợt 2 chưa xong vẫn tải lại được
    }, function (e) { if (!silent && S.token) toast(e.message, true); if (!S.d && S.token && !$('.me')) { $('#app').innerHTML = '<div class="login"><div class="login-box"><h1>Chưa tải được dữ liệu</h1><p class="sub">' + esc(e.message) + '</p><button class="btn pri block" id="retry">Thử lại</button></div></div>'; $('#retry').onclick = function () { location.reload(); }; } })
      .then(function () { S.loading = false; var b2 = $('#refresh'); if (b2) b2.classList.remove('spin'); });
  }
  function softRender(silent) {
    var ae = document.activeElement, editing = silent && ae && ae.closest && ae.closest('#view') && /INPUT|TEXTAREA|SELECT/.test(ae.tagName) && ae.type !== 'search';
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
      S.d.orders = r.orders.concat(newO); S.d.log = r.log.concat(newL); S.d.partial = false;
      if (S.perf) { S.perf.rest = Date.now() - t1; S.perf.kb2 = r.__kb; }
      idb('set', 'data', { tk: S.token.slice(-12), at: S.loadedAt, d: S.d }); // lần sau mở CRM hiện ngay
      softRender(true);
    }, function () { /* đợt 2 lỗi: vẫn dùng được, lần tải sau thử lại */ });
  }
  var ZALO_X = /\s*\(\s*[xX×]\s*\)/g; // "(x)" sau tên = sale đã kết bạn Zalo (cách ghi trên Sheet) → hiện bằng biểu tượng Zalo, không hiện trong tên
  function setData(j, at) {
    S.d = j; S.user = j.user; S.loadedAt = at;
    [j.customers, j.orders, j.leads || [], j.log || []].forEach(function (arr) { arr.forEach(function (x) { if (x.name && ZALO_X.test(x.name)) { ZALO_X.lastIndex = 0; x.name = x.name.replace(ZALO_X, '').trim(); } ZALO_X.lastIndex = 0; }); });
    S.d.byPhone = {}; j.customers.forEach(function (c) { S.d.byPhone[c.phone] = c; });
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
    $('#app').innerHTML = skeleton();
    idb('get', 'data').then(function (c) {
      if (c && c.d && c.tk === String(S.token || '').slice(-12) && Date.now() - c.at < 7 * DAY && !S.d) { // dữ liệu lần trước trên máy này → hiện ngay, cập nhật ngầm
        S.stale = true; setData(c.d, c.at); shell(); render(); load(true); flush();
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
    var p = op.p, c = cust(p.phone); if (!c) return;
    c._q = undefined; // chuỗi tìm kiếm tính lại (tên / người phụ trách có thể vừa đổi)
    if (op.action === 'care') {
      c.careAt = op.at; c.careResult = p.result; if (!c.owner) c.owner = S.user.name;
      c.callback = p.callback ? new Date(p.callback + 'T09:00:00+07:00').getTime() : null; c.task = null;
      if (p.received && !c.recv) c.recv = op.at;
      if (!S.d.log.some(function (l) { return l.op === op.id; })) S.d.log.push({ op: op.id, time: op.at, by: S.user.name, what: TASK_LOG[p.task] || TASK_LOG.other, ref: c.phone, name: c.name, result: p.result, note: p.note + (p.callback ? (p.note ? ' – ' : '') + 'hẹn gọi lại ' + p.callback.split('-').reverse().join('/') : '') });
    }
    if (op.action === 'customer') {
      if (p.owner !== undefined) c.owner = p.owner; if (p.note !== undefined) { c.note = p.note; c.noteCut = false; } if (p.tag !== undefined) c.tag = p.tag; if (p.zalo !== undefined) c.zalo = !!p.zalo; if (p.community !== undefined) c.community = p.community === 'Đã mời' ? 'Đã mời ' + fDate(op.at).replace(/\/(\d{2})(\d{2})$/, '/$2') : p.community; if (p.consent !== undefined) c.consent = !!p.consent;
      if (p.promo && !S.d.log.some(function (l) { return l.op === op.id; })) { S.d.log.push({ op: op.id, time: op.at, by: S.user.name, what: 'Gửi ưu đãi', ref: c.phone, name: c.name, result: p.promo, note: '' }); c.note = fDate(op.at).replace(/\/(\d{2})(\d{2})$/, '/$2') + ': 📣 Gửi ưu đãi: ' + p.promo + (c.note ? '\n' + c.note : ''); }
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

  function cust(phone) { return S.d && S.d.byPhone[normPhone(phone)]; }
  function ordersOf(phone) { phone = normPhone(phone); return S.d.orders.filter(function (o) { return o.phone === phone; }).sort(function (a, b) { return b.time - a.time; }); }
  function logOf(ref) { return S.d.log.filter(function (l) { return String(l.ref).replace(/^'/, '') === ref; }).sort(function (a, b) { return b.time - a.time; }); }
  function mineOk(c) { return lvl() < 2 ? c.owner === S.user.name : !S.mine || !c.owner || c.owner === S.user.name; } // sale: chỉ khách của mình (khách chưa ai nhận nằm ở mục Kho chung)
  function tasksAll() { return S.d.customers.filter(function (c) { return c.task; }); }
  function tasksShown() { return tasksAll().filter(function (c) { return mineOk(c) && !coldOf(c); }); } // khách lạnh không vào danh sách gọi
  /** Khách cũ lâu chưa gọi (không nằm trong lịch chăm sóc tự động): ưu tiên khách chi nhiều. */
  function oldDueAll() {
    var t0 = today();
    return S.d.customers.filter(function (c) {
      if (c.task || !c.last || c.flag || !mineOk(c) || (lvl() < 2 && c.owner !== S.user.name)) return false;
      if (c.callback && dayStart(c.callback) > t0) return false; // đã hẹn ngày khác
      var r = replyOf(c); return r.days >= OLD_DAYS && !coldOf(c);
    }).sort(function (a, b) { return b.spent - a.spent || (a.last || 0) - (b.last || 0); });
  }
  function newOrders() { return S.d.orders.filter(function (o) { return o.status === 'Mới'; }); }
  function mode() { return (S.d && S.d.rules && S.d.rules.assignMode) || 'pool'; }
  function isPoolStaff() { return lvl() < 2 && mode() === 'pool'; }
  var MODE_INFO = {
    auto: ['Tự chia đều', 'Khách mới (đơn web, form liên hệ) tự giao lần lượt cho những người đang bật “Nhận khách mới”.'],
    manager: ['Quản lý giao tay', 'Khách mới nằm ở mục “Chờ giao” (chỉ quản lý thấy). Quản lý chọn người phụ trách cho từng khách.'],
    pool: ['Kho chung', 'Khách mới chưa ai phụ trách thì mọi nhân viên đều thấy. Ai bấm “Nhận khách” hoặc chăm sóc / xác nhận đơn trước thì khách thuộc về người đó.']
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
    return '<div class="legend">' + keys.map(function (k) {
      var isTag = k.indexOf('tag:') === 0, color = isTag ? tagColor(k.slice(4)) : catColor(k), label = isTag ? k.slice(4) : CAT_DEF[k].label;
      return '<button class="lg' + (active === k ? ' on' : '') + '" data-cat="' + esc(k) + '"' + (isTag ? '' : ' title="' + esc(CAT_DEF[k].tip) + '"') + '><i style="background:' + color + ';border-color:' + shade(color, .35) + '"></i>' + esc(label) + (list ? ' <em>' + (cnt[k] || 0) + '</em>' : '') + '</button>';
    }).join('') + '<button type="button" class="lg-set lg-help" data-taghelp>ⓘ Giải thích nhãn</button><a class="lg-set" href="#cai-dat">🎨 Đổi màu</a></div>';
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
  function leadMine(l) { return lvl() < 2 ? l.owner === S.user.name : !S.mine || !l.owner || l.owner === S.user.name; }
  function leadsDue() { return (S.d.leads || []).filter(function (l) { return leadDue(l) && leadMine(l); }); }
  function findLead(id) { return (S.d.leads || []).filter(function (l) { return l.id === id; })[0]; }

  /* ================================================================ khung */
  var VIEWS = [
    { id: 'hom-nay', label: 'Hôm nay', icon: 'today' },
    { id: 'khach-hang', label: 'Khách đã mua', icon: 'users' },
    { id: 'don-hang', label: 'Đơn hàng', icon: 'box' },
    { id: 'tiem-nang', label: 'Khách hỏi', icon: 'lead' },
    { id: 'bao-cao', label: 'Hiệu quả', icon: 'chart' },
    { id: 'cai-dat', label: 'Cài đặt', icon: 'gear' }
  ];
  function myViews() { return VIEWS.filter(function (v) { return !v.min || lvl() >= v.min; }); }
  function meHTML() { return '<b>' + esc(S.user.name) + '</b>'; } // chỉ tên: mỗi người là chủ công việc của mình
  function updatedLine() {
    var pf = S.perf, sp = pf && lvl() >= 3 ? ' · tải ' + (pf.core / 1000).toFixed(1) + 's' + (pf.srv ? ' (máy chủ ' + (pf.srv.ms / 1000).toFixed(1) + 's' + (pf.srv.cached ? ', bản đọc sẵn' : ', đọc Sheet') + ')' : '') + (pf.kb ? ', ' + pf.kb + ' KB' : '') + (pf.rest ? ' + đợt 2 ' + (pf.rest / 1000).toFixed(1) + 's' + (pf.kb2 ? '/' + pf.kb2 + ' KB' : '') : '') : '';
    return '<p class="updated">' + (S.stale ? '⏳ Đang cập nhật… (đang xem dữ liệu lúc ' + fDateTime(S.loadedAt) + ')' : 'Cập nhật lúc ' + fDateTime(S.loadedAt)) + (S.d && S.d.partial ? ' · ⏳ đang tải thêm đơn & nhật ký cũ…' : '') + ' · dữ liệu lưu trong Google Sheet' + sp + '</p>';
  }
  function shell() {
    $('#app').innerHTML = '<header class="top"><div class="top-in">' +
      '<a class="brand" href="#hom-nay"><img src="/icon-180.png" alt="">CRM</a>' +
      '<nav class="nav">' + myViews().map(function (v) { return '<a href="#' + v.id + '" data-v="' + v.id + '">' + I[v.icon] + '<span>' + v.label + '</span></a>'; }).join('') + '</nav>' +
      '<div class="grow"></div><div class="me">' + meHTML() + '</div>' +
      '<button class="icon-btn fb-btn" id="fbBtn" title="Góp ý: báo lỗi, chỗ khó dùng, ý tưởng" aria-label="Góp ý">💡<span class="fb-lbl">Góp ý</span></button>' +
      '<a class="icon-btn" href="/huong-dan/crm/" target="_blank" rel="noopener" title="Hướng dẫn sử dụng" aria-label="Hướng dẫn sử dụng">' + I.help + '</a>' +
      '<button class="icon-btn" id="refresh" title="Tải lại dữ liệu" aria-label="Tải lại dữ liệu">' + I.refresh + '</button>' +
      '</div></header><main id="view"></main>';
    $('#refresh').onclick = function () { load(); };
    $('#fbBtn').onclick = function () { openFeedback(); };
    navBadges(); pendingBadge();
  }
  function navBadges() {
    var fb = $('#fbBtn'); if (fb) { var fd = $('.dot', fb); if (fd) fd.remove(); if (lvl() >= 2 && S.d.fbNew) fb.insertAdjacentHTML('beforeend', '<span class="dot">' + S.d.fbNew + '</span>'); }
    var ld = leadsDue().length, n = { 'hom-nay': newOrders().length + dayQueue().list.length + ld, 'don-hang': newOrders().length, 'tiem-nang': ld };
    $$('.nav a').forEach(function (a) {
      var v = a.getAttribute('data-v'), d = $('.dot', a); if (d) d.remove();
      if (n[v]) a.insertAdjacentHTML('beforeend', '<span class="dot">' + (n[v] > 99 ? '99+' : n[v]) + '</span>');
    });
  }
  function route() { var h = (location.hash || '#hom-nay').slice(1).split('/'); return { view: h[0] === 'lien-he' ? 'tiem-nang' : h[0] || 'hom-nay', id: decodeURIComponent(h[1] || '') }; }
  var lastView = '';
  function render() {
    if (!S.d || !$('#view')) return;
    var r = route(), v = myViews().some(function (x) { return x.id === r.view; }) ? r.view : 'hom-nay';
    $$('.nav a').forEach(function (a) { a.classList.toggle('on', a.getAttribute('data-v') === v); });
    var keepScroll = lastView === v, y = window.scrollY;
    var el = $('#view');
    var focusId = document.activeElement && document.activeElement.id, selStart = document.activeElement && document.activeElement.selectionStart;
    el.innerHTML = ({ 'hom-nay': viewToday, 'khach-hang': viewCustomers, 'don-hang': viewOrders, 'tiem-nang': viewLeads, 'bao-cao': viewReport, 'cai-dat': viewSettings })[v]();
    el.insertAdjacentHTML('beforeend', updatedLine());
    if (focusId && $('#' + focusId)) { var f = $('#' + focusId); f.focus(); try { f.setSelectionRange(selStart, selStart); } catch (e) { } }
    if (keepScroll) window.scrollTo(0, y); else window.scrollTo(0, 0);
    lastView = v;
    document.title = VIEWS.filter(function (x) { return x.id === v; })[0].label + ' – CRM Thực Dưỡng Lành';
    if (v === 'cai-dat') bindSettings();
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
  function stageOf(c) { var d = daysSince(c.last); return d <= 60 ? 'live' : d <= 180 ? 'risk' : 'lost'; }
  function isVip(c) { var R = S.d.rules || {}; return c.orders >= (R.vipOrders || 3) || c.spent >= (R.vipSpent || 2e6); }
  function riskyReturn(c) { var b = c.backN || 0, ok = c.okN || 0; return b >= 1 && (ok === 0 || (b >= 2 && b >= ok)); } // hoàn 1 lần trong nhiều đơn nhận = khách vẫn tốt
  function coldOf(c) { // khách lạnh: bom hàng / từ chối, hoặc đã nói "không dùng nữa" (sau 6 tháng tự ấm lại; đặt đơn mới cũng hết lạnh)
    if (c.flag) return /bom/i.test(c.flag) ? 'Bom hàng' : c.flag;
    var r = replyOf(c); if (r.result === 'Không có nhu cầu' && r.at && !((c.last || 0) > r.at) && today() - r.at < 180 * DAY) return 'Không dùng nữa';
    return '';
  }
  var TIP = {
    vip: function () { var R = S.d.rules || {}; return 'Khách mua từ ' + (R.vipOrders || 3) + ' đơn, hoặc tổng chi từ ' + money(R.vipSpent || 2e6); },
    risk: 'Sắp mất: 61–180 ngày chưa mua lại. Nhóm đáng gọi nhất',
    lost: 'Lâu không mua: hơn 180 ngày chưa mua lại',
    live: 'Đang dùng: mua trong 60 ngày gần đây',
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
  function shortProducts(list, n) { return (list || []).slice(-(n || 2)).map(function (p) { return p.replace(/\s*\(.*\)\s*$/, ''); }).join(', '); }
  function taskLine(c) {
    var t = c.task; if (!t) return '';
    if (t.type === 'callback') return '<span class="warn-line">📞 Hẹn gọi lại ' + (t.late ? '– đã quá ' + t.late + ' ngày' : 'hôm nay') + '</span>';
    if (t.type === 'runout') return t.late ? '<span class="bad-line">Đã hết khoảng ' + t.late + ' ngày</span>' : '<span class="warn-line">' + (t.toRun === 0 ? 'Hết trong hôm nay' : 'Còn khoảng ' + t.toRun + ' ngày là hết') + '</span>';
    var late = t.late ? ' <span class="bad-line">· ⏳ trễ ' + t.late + ' ngày</span>' : '';
    if (t.type === 'd1') return (t.est ? 'Đặt ' + daysAgo(c.last) + ' · <span class="warn-line">chưa rõ khách đã nhận hàng chưa</span>' : 'Nhận hàng ' + (t.days === 0 ? 'hôm nay' : t.days + ' ngày trước')) + late;
    return (t.est ? 'Đặt ' + daysAgo(c.last) : 'Nhận hàng ' + t.days + ' ngày trước') + late;
  }
  /* ---------- số ngày chưa chăm sóc: tính từ lần gần nhất KHÁCH CÓ PHẢN HỒI ("Không nghe máy" không tính) */
  var NO_REPLY = 'Không nghe máy', CARE_WHAT = null, replyIdx = null, replyLogLen = -1;
  function replyIndex() {
    if (replyIdx && replyLogLen === S.d.log.length) return replyIdx;
    if (!CARE_WHAT) { CARE_WHAT = {}; Object.keys(TASK_LOG).forEach(function (k) { CARE_WHAT[TASK_LOG[k]] = 1; }); }
    replyIdx = {}; replyLogLen = S.d.log.length;
    S.d.log.forEach(function (l) {
      if (!CARE_WHAT[l.what] || !l.time) return;
      var ph = String(l.ref).replace(/^'/, ''), r = replyIdx[ph] || (replyIdx[ph] = { at: 0, missed: [] });
      if (l.result === NO_REPLY) r.missed.push(l.time); else if (l.result && l.time > r.at) { r.at = l.time; r.result = l.result; r.by = l.by; }
    });
    return replyIdx;
  }
  function replyOf(c) {
    var r = replyIndex()[c.phone] || { at: 0, missed: [] }, at = r.at, result = r.result, by = r.by;
    if (c.careAt && c.careResult && c.careResult !== NO_REPLY && c.careAt > at) { at = c.careAt; result = c.careResult; by = c.owner; } // ghi trong Sheet trước khi có CRM
    var from = at || c.first; // chưa chăm sóc lần nào → đếm từ ngày mua đầu tiên
    return { at: at, never: !at, result: result, by: by, days: from ? Math.max(0, Math.round((today() - dayStart(from)) / DAY)) : 0, missed: r.missed.filter(function (t) { return t > at; }).length };
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
      row('<span class="tag noconsent">Chưa ai phụ trách</span>', 'Khách chưa có sale nhận. Ở chế độ Kho chung, khách này nằm ở mục 🧺 Kho chung tab Hôm nay.') +
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
      '<div class="box"><div class="r1" style="display:flex;gap:8px;align-items:center;flex-wrap:wrap"><b>' + esc(c.name) + '</b>' + custTags(c) + (c.zalo ? '<span class="zl on">' + ZI + ' Zalo</span>' : '') + '<span class="muted">' + fPhone(c.phone) + '</span></div>' +
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
  function consentTag(c) { return c.consent ? '<span class="tag st-xong" title="Khách đồng ý nhận tin ưu đãi">✓ Nhận ưu đãi</span>' : canEdit(c) ? '<button type="button" class="zl add" data-consent="' + c.phone + '" title="Bấm khi khách đồng ý nhận tin ưu đãi / khuyến mãi">☐ Khách đồng ý nhận ưu đãi</button>' : ''; }
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
  function commBox(c, type) {
    if (inComm(c)) return '';
    var open = (type === 'd1' || type === 'd7') && !invited(c);
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
  function setZalo(c, on) { sendOp('customer', { phone: c.phone, zalo: on ? 1 : 0 }); toast(on ? 'Đã đánh dấu kết bạn Zalo ✓' : 'Đã bỏ đánh dấu Zalo'); render(); }
  function orderCard(o, withActs) {
    var next = NEXT[o.status];
    var oc = orderCat(o);
    return '<div class="card click tinted" data-order="' + esc(o.id) + '"' + catAttr(oc) + '>' +
      '<div class="r1"><b>' + esc(o.name) + '</b>' + stTag(o.status) + (oc.key !== 'void' ? catChip(oc) : '') + '<span class="end">' + money(o.total) + '</span></div>' +
      '<div class="r2">' + fPhone(o.phone) + ' · ' + esc(o.payment) + ' ' + paidTag(o) + ' · <span class="muted">' + esc(o.id) + '</span></div>' +
      (o.tracking ? '<div class="r3">🚚 ' + esc(o.carrier) + ' ' + esc(o.tracking) + '</div>' : '') +
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
    var no = newOrders().sort(function (a, b) { return b.time - a.time; }), ts = tasksShown(), ld = sortLeads(leadsDue()), od = oldDueAll();
    var up = unpaidOrders().filter(function (o) { return o.status !== 'Mới'; }).sort(function (a, b) { return a.time - b.time; });
    var t0 = today(), doneToday = S.d.log.filter(function (l) { return l.time >= t0 && l.what !== 'Cài đặt' && l.what !== 'Nhân sự'; }).sort(function (a, b) { return b.time - a.time; });
    var h = '<div class="page-head"><h1>Chào ' + esc(S.user.name) + ' 👋</h1><div class="grow"></div>' +
      (lvl() >= 2 ? '<label class="switch"><input type="checkbox" id="mine"' + (S.mine ? ' checked' : '') + '> Chỉ khách của tôi</label>' : '') + '</div>';
    var q = dayQueue(), total = q.list.length + q.done, pc = total ? Math.round(q.done * 100 / total) : 100;
    h += '<section class="hero"><div class="hero-t"><b>' + (q.list.length ? 'Hôm nay: ' + q.list.length + ' khách cần chăm sóc' : '🎉 Đã xong việc chăm sóc hôm nay') + '</b><span>đã xong ' + q.done + '</span></div>' +
      '<div class="bar"><i style="width:' + pc + '%"></i></div>' +
      (q.list.length ? '<button class="btn pri lg block" data-flow>▶ Bắt đầu gọi lần lượt</button>' : '') +
      (q.rest ? '<p class="small muted" style="margin:8px 0 0">Còn ' + q.rest + ' khách để các ngày sau (tối đa ' + dayLimit() + ' khách/ngày, đổi ở <a href="#cai-dat">Cài đặt</a>).</p>' : '') +
      '<button class="btn block" data-daily="' + (lvl() >= 2 ? '' : esc(S.user.name)) + '" style="margin-top:8px">📋 Báo cáo cuối ngày (gửi Zalo)</button></section>';
    h += '<div class="minis">' + mini('🧾 Đơn mới', no.length, '#don-hang', no.length ? 'warn' : '') + mini('🙋 Khách hỏi', ld.length, '#tiem-nang', ld.length ? 'bad' : '') + mini('✅ Đã làm', doneToday.length, '', '') + miniGoal() + '</div>';
    if (lvl() >= 2) {
      var m = monthStats();
      h += '<div class="kpis">' + kpi('Doanh thu tháng ' + m.month, moneyShort(m.revenue), '', '', m.orders + ' đơn · ' + (m.prev ? (m.revenue >= m.prev ? '▲ ' : '▼ ') + 'tháng trước ' + moneyShort(m.prev) : 'chưa có tháng trước')) +
        kpi('Khách mới tháng ' + m.month, m.newCus, '', '', m.returning + ' khách mua lại') + '</div>';
    }

    if (lvl() >= 2) h += waitingBlock();
    if (no.length || up.length) h += '<section class="section"><div class="section-h"><h2>1️⃣ Đơn mới – gọi khách xác nhận</h2>' + (no.length ? '<span class="count">' + no.length + '</span>' : '') + '<span class="tip">gọi xong bấm “Xác nhận”</span></div>' +
      (no.length ? '<div class="crows">' + no.map(orderRow).join('') + '</div>' : '') +
      (up.length ? '<div class="section-h" style="margin-top:12px"><h3>💳 Chuyển khoản chưa nhận tiền</h3><span class="count">' + up.length + '</span><span class="tip">xem tài khoản VCB, tiền về thì mở đơn bấm “Xác nhận đã nhận tiền”</span></div>' +
        '<div class="crows">' + up.map(orderRow).join('') + '</div>' : '') + '</section>';

    h += '<section class="section"><div class="section-h"><h2>2️⃣ Chăm sóc khách</h2>' + (q.list.length ? '<span class="count">' + q.list.length + '</span>' : '') + '<span class="tip">bấm vào nhóm để mở danh sách</span></div>';
    if (!q.list.length) h += empty(lvl() >= 2 && S.mine && tasksAll().length ? 'Khách của bạn đã chăm sóc xong. Tắt “Chỉ khách của tôi” để xem các khách khác.' : 'Hôm nay không còn khách cần chăm sóc 🎉');
    GROUP_ORDER.forEach(function (k) {
      var arr = q.list.filter(function (c) { return taskKey(c) === k; }); if (!arr.length) return;
      var late = arr.filter(function (c) { return c.task && c.task.late && k !== 'callback' && k !== 'runout'; }).length;
      h += '<details class="grp" data-grp="' + k + '"' + (S.f.gopen && S.f.gopen[k] ? ' open' : '') + '><summary><span class="g-t">' + TASKS[k].icon + ' ' + TASKS[k].title + '</span><span class="count">' + arr.length + '</span>' + (late ? '<span class="g-late">⏳ ' + late + ' trễ</span>' : '') + '<span class="g-tip">' + TASKS[k].tip + '</span></summary>' +
        '<div class="rows">' + arr.map(rowCard).join('') + '</div></details>';
    });
    h += '</section>';

    h += '<section class="section"><div class="section-h"><h2>3️⃣ Khách hỏi cần liên hệ</h2>' + (ld.length ? '<span class="count">' + ld.length + '</span>' : '') + '<span class="tip">người hỏi mua nhưng chưa mua</span></div>' +
      (ld.length ? '<details class="grp" data-grp="leads"' + (S.f.gopen && S.f.gopen.leads ? ' open' : '') + '><summary><span class="g-t">🙋 Người hỏi cần liên hệ</span><span class="count">' + ld.length + '</span><span class="g-tip">mới hỏi, đến hẹn hoặc 3 ngày chưa liên hệ</span></summary><div class="list cols" style="padding:10px">' + ld.map(leadCard).join('') + '</div></details>' : empty('Không có khách hỏi cần liên hệ 🎉')) +
      '<button class="btn" data-newlead style="margin-top:10px">＋ Thêm khách hỏi</button></section>';

    if (isPoolStaff()) h += poolBlock();
    if (doneToday.length) h += '<section class="section"><details class="grp" data-grp="done"' + (S.f.gopen && S.f.gopen.done ? ' open' : '') + '><summary><span class="g-t">✅ Đã làm hôm nay</span><span class="count">' + doneToday.length + '</span></summary><div class="timeline" style="padding:12px">' +
      doneToday.slice(0, 40).map(logItem).join('') + '</div></details></section>';
    return h;
  }
  /** Quản lý: khách / khách hỏi chưa có người phụ trách → giao ngay tại chỗ. */
  function waitingBlock() {
    var cs = S.d.customers.filter(function (c) { return !c.owner && (c.task || (c.last && today() - dayStart(c.last) <= 30 * DAY)); }).sort(function (a, b) { return (b.last || 0) - (a.last || 0); });
    var ls = (S.d.leads || []).filter(function (l) { return !l.owner && isOpenLead(l); });
    var allC = S.d.customers.filter(function (c) { return !c.owner; }).length;
    if (!cs.length && !ls.length && !allC) return '';
    var sel = function (kind, id) { return '<select class="assign" data-assign="' + kind + '|' + esc(id) + '"><option value="">Giao cho…</option>' + userNames().map(function (n) { return '<option>' + esc(n) + '</option>'; }).join('') + '</select>'; };
    return '<section class="section"><div class="section-h"><h2>🧺 Chờ giao người phụ trách</h2><span class="count">' + (cs.length + ls.length) + '</span><span class="tip">chế độ hiện tại: ' + MODE_INFO[mode()][0] + ' · đổi ở Cài đặt</span></div>' +
      (cs.length + ls.length ? '<div class="list cols">' +
        cs.slice(0, 20).map(function (c) { return '<div class="card"><div class="r1"><b>' + esc(c.name) + '</b>' + custTags(c) + '<span class="end">' + moneyShort(c.spent) + '</span></div><div class="r2">' + fPhone(c.phone) + ' · mua ' + daysAgo(c.last) + '</div><div class="acts">' + sel('c', c.phone) + '</div></div>'; }).join('') +
        ls.slice(0, 20).map(function (l) { return '<div class="card"><div class="r1"><b>' + esc(l.name) + '</b>' + leadTag(l) + '<span class="end small muted">' + esc(l.channel) + '</span></div><div class="r2">' + fPhone(l.phone) + (l.interest ? ' · ' + esc(l.interest) : '') + ' · hỏi ' + daysAgo(l.time) + '</div><div class="acts">' + sel('l', l.id) + '</div></div>'; }).join('') + '</div>' : '') +
      (allC > cs.length ? '<p class="small muted">Tổng cộng ' + allC + ' khách (kể cả khách cũ) chưa ai phụ trách. Vào <a href="#cai-dat">Cài đặt → Chia khách</a> để chia đều một lần.</p>' : '') + '</section>';
  }
  /** Sale ở chế độ Kho chung: khách / khách hỏi chưa ai nhận, để riêng cuối trang (không lẫn vào danh sách gọi của mình). */
  function poolBlock() {
    var t0 = today(), cs = S.d.customers.filter(function (c) { return !c.owner && (c.task || (c.last && t0 - dayStart(c.last) <= 30 * DAY)); }).sort(function (a, b) { return (b.last || 0) - (a.last || 0); });
    var ls = (S.d.leads || []).filter(function (l) { return !l.owner && isOpenLead(l); });
    if (!cs.length && !ls.length) return '';
    return '<section class="section"><div class="section-h"><h2>🧺 Kho chung – chưa ai nhận</h2><span class="count">' + (cs.length + ls.length) + '</span><span class="tip">bấm “Nhận khách” để thành khách của bạn</span></div><div class="list cols">' +
      cs.slice(0, 10).map(function (c) { return custCard(c, false); }).join('') + ls.slice(0, 10).map(leadCard).join('') + '</div></section>';
  }
  /* ---------- danh sách việc trong ngày: xếp theo mức quan trọng, giới hạn số khách/ngày (phần còn lại để mai, có “trễ N ngày”) */
  var DAY_LIMIT_DEF = 30, GROUP_ORDER = ['callback', 'd1', 'runout', 'd7', 'd14', 'd30', 'winback', 'old'];
  var PRIO = { callback: 0, d1: 1, runout: 2, d7: 3.5, d14: 4, d30: 5, winback: 6, old: 7 };
  function dayLimit() { var n = parseInt(store('crm_daylimit') || '', 10); return n > 0 ? n : DAY_LIMIT_DEF; }
  function taskKey(c) { return c.task ? c.task.type : 'old'; }
  function prioOf(c) { var k = taskKey(c); return c.task && c.task.late && k !== 'callback' && k !== 'runout' ? 3 : PRIO[k]; }
  function isCareLog(l) { if (!CARE_WHAT) { CARE_WHAT = {}; Object.keys(TASK_LOG).forEach(function (k) { CARE_WHAT[TASK_LOG[k]] = 1; }); } return !!CARE_WHAT[l.what]; }
  function doneCount() { var t0 = today(), o = {}; S.d.log.forEach(function (l) { if (l.time >= t0 && l.by === S.user.name && isCareLog(l)) o[String(l.ref).replace(/^'/, '')] = 1; }); return Object.keys(o).length; }
  function dayQueue() {
    var all = tasksShown().concat(oldDueAll());
    all.sort(function (a, b) { return prioOf(a) - prioOf(b) || ((b.task && b.task.late) || 0) - ((a.task && a.task.late) || 0) || b.spent - a.spent; });
    var done = doneCount(), room = Math.max(0, dayLimit() - done);
    return { list: all.slice(0, room), rest: Math.max(0, all.length - room), done: done };
  }
  function mini(label, n, href, cls) { return '<' + (href ? 'a href="' + href + '"' : 'div') + ' class="mini ' + (cls || '') + '"><span>' + label + '</span><b>' + n + '</b></' + (href ? 'a' : 'div') + '>'; }
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
  function leadsOf(phone) { return (S.d.leads || []).filter(function (l) { return l.phone === phone; }).sort(function (a, b) { return (a.time || 0) - (b.time || 0); }); }
  /** 1 dòng gọn ở tab Khách hàng: giá trị · lần mua gần nhất · việc tiếp theo · lần chăm sóc gần nhất. */
  function custRow(c) {
    var cat = custCat(c), h = recentHist(c, 1)[0], k = c.task ? c.task.type : '', live = stageOf(c) === 'live';
    return '<div class="rw cr click tinted" data-cust="' + c.phone + '"' + catAttr(cat) + '><div class="rw-m">' +
      '<div class="rw-1"><b>' + esc(c.name || 'Khách') + '</b>' + (c.zalo ? '<span class="zl ic" title="Đã kết bạn Zalo">' + ZI + '</span>' : '') + (inComm(c) ? '<span class="comm-ic" title="Đã vào nhóm Zalo cộng đồng">👥</span>' : '') + custTags(c) + (c.owner && lvl() >= 2 ? '<span class="tag owner">👤 ' + esc(c.owner) + '</span>' : !c.owner ? '<span class="tag noconsent">Chưa ai phụ trách</span>' : '') + '<span class="end">' + c.orders + ' đơn · ' + moneyShort(c.spent) + '</span></div>' +
      '<div class="rw-2">' + (provOf(c) ? '📍 ' + esc(provOf(c).old) + ' · ' : '') + 'Mua lần đầu ' + fDate(c.first).replace(/\/(\d{2})(\d{2})$/, '/$2') + ' · gần nhất ' + daysAgo(c.last) + (c.products.length ? ' · ' + esc(shortProducts(c.products, 1)) : '') + (live && c.runout && c.runout > (c.last || 0) && k !== 'runout' ? ' · ⏰ hết ~' + fDate(c.runout).slice(0, 5) : '') + (k && TASKS[k] ? ' · <span class="warn-line">' + TASKS[k].icon + ' ' + TASKS[k].title + '</span>' : '') + '</div>' +
      '<div class="rw-3">' + (h ? '💬 ' + fDate(h.time).slice(0, 5) + ': ' + esc(h.text.length > 90 ? h.text.slice(0, 90) + '…' : h.text) : '<span class="muted">Chưa có lần chăm sóc nào</span>') + '</div></div>' +
      '<div class="rw-a"><a class="btn" href="tel:' + c.phone + '" aria-label="Gọi">📞</a><button class="btn pri" data-care="' + c.phone + '" data-task="' + (k || 'other') + '" aria-label="Chăm sóc">💬</button></div></div>';
  }
  /** 1 dòng gọn cho danh sách việc: tên · việc cần làm · nút gọi / KNM / chăm sóc. */
  function rowCard(c) {
    var cat = custCat(c), k = taskKey(c);
    return '<div class="rw click tinted" data-cust="' + c.phone + '"' + catAttr(cat) + '><div class="rw-m"><div class="rw-1"><b>' + esc(c.name || 'Khách') + '</b>' + (c.zalo ? '<span class="zl ic" title="Đã kết bạn Zalo">' + ZI + '</span>' : '') + (inComm(c) ? '<span class="comm-ic" title="Đã vào nhóm Zalo cộng đồng">👥</span>' : '') + custTags(c) + '<span class="end">' + moneyShort(c.spent) + '</span></div>' +
      '<div class="rw-2">' + (c.task ? taskLine(c) : replyOf(c).days + ' ngày chưa phản hồi') + (c.products.length ? ' · ' + esc(shortProducts(c.products, 1)) : '') + '</div></div>' +
      '<div class="rw-a"><a class="btn" href="tel:' + c.phone + '" aria-label="Gọi">📞</a><button class="btn" data-quick="' + c.phone + '|knm|' + k + '" title="Không nghe máy: 2 ngày sau tự nhắc" aria-label="KNM">📵</button><button class="btn pri" data-care="' + c.phone + '" data-task="' + k + '" aria-label="Chăm sóc">💬</button></div></div>';
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
  function kpi(label, val, cls, href, sub) {
    return '<' + (href ? 'a href="' + href + '"' : 'div') + ' class="kpi ' + (cls || '') + '"><span>' + label + '</span><b>' + val + '</b>' + (sub ? '<small>' + sub + '</small>' : '') + '</' + (href ? 'a' : 'div') + '>';
  }
  function logItem(l) {
    return '<div class="it"><b>' + esc(l.what) + '</b>' + (l.name ? ' – ' + esc(l.name) : '') + (l.result ? ': ' + esc(l.result) : '') + (l.note ? '<br>' + esc(l.note) : '') + '<small>' + fDateTime(l.time) + ' · ' + esc(l.by) + '</small></div>';
  }
  function monthStats() {
    var now = vnDate(Date.now()), ym = now.y * 12 + now.m, rev = 0, prev = 0, cnt = 0;
    S.d.orders.forEach(function (o) {
      if (o.status === 'Huỷ' || !o.time) return; var x = vnDate(o.time), k = x.y * 12 + x.m;
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
    { k: 'mine', l: 'Của tôi', f: function (c) { return c.owner === S.user.name; } },
    { k: 'noowner', l: 'Chưa ai phụ trách', f: function (c) { return !c.owner; } },
    { k: 'vip', l: 'VIP', f: function (c) { return isVip(c) && !coldOf(c); } },
    { k: 'risk', l: 'Sắp mất', f: function (c) { return stageOf(c) === 'risk' && !coldOf(c); } },
    { k: 'lost', l: 'Lâu không mua', f: function (c) { return stageOf(c) === 'lost' && !coldOf(c); } },
    { k: 'runout7', l: '⏰ Sắp hết hàng', f: function (c) { return !coldOf(c) && !!c.runout && c.runout > (c.last || 0) && c.runout >= today() - 7 * DAY && c.runout < today() + 8 * DAY; } },
    { k: 'callback', l: 'Có hẹn gọi lại', f: function (c) { return !!c.callback && !coldOf(c); } },
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
  var SPEND = { lo: ['Dưới 500k', 0, 5e5], mid: ['500k – 2 triệu', 5e5, 2e6], hi: ['Trên 2 triệu', 2e6, 9e15] };
  /** Nguồn khách mua lần đầu (Facebook, Ladi, Zalo…), nhiều khách xếp trước. */
  function custSources() {
    var n = {}; S.d.customers.forEach(function (c) { if (lvl() >= 2 || c.owner === S.user.name) { var k = c.source || 'Chưa rõ'; n[k] = (n[k] || 0) + 1; } });
    return Object.keys(n).sort(function (a, b) { return n[b] - n[a]; });
  }
  function viewCustomers() {
    var f = S.f.c || (S.f.c = { q: '', k: 'all', sort: 'prio', n: 60 });
    var q = norm(f.q), qd = q.replace(/\D/g, ''), words = qWords(q);
    var base = S.d.customers.filter(function (c) { return (lvl() >= 2 || c.owner === S.user.name) && (!q || custHit(c, words) || (qd.length >= 3 && c.phone.indexOf(qd) >= 0)); }); // sale: chỉ khách của mình (khách chưa ai nhận ở mục Kho chung tab Hôm nay)
    if (f.cat) base = base.filter(function (c) { return custCat(c).key === f.cat; });
    var srcs = custSources(); if (f.src && srcs.indexOf(f.src) < 0) f.src = '';
    if (f.spend) base = base.filter(function (c) { var r = SPEND[f.spend]; return c.spent >= r[1] && c.spent < r[2]; });
    if (f.src) base = base.filter(function (c) { return (c.source || 'Chưa rõ') === f.src; });
    var chips = CF.filter(function (x) { return lvl() >= 2 || (x.k !== 'mine' && x.k !== 'noowner' && x.k !== 'myold'); });
    var cur = chips.filter(function (x) { return x.k === f.k; })[0] || chips[0];
    var list = base.filter(cur.f).sort(SORTS[f.sort][1]);
    if (q) list = list.filter(function (c) { return norm(c.name).indexOf(q) >= 0; }).concat(list.filter(function (c) { return norm(c.name).indexOf(q) < 0; })); // trùng tên lên đầu, rồi mới đến trùng tỉnh / địa chỉ / sản phẩm
    S.promoPick = { list: list, label: cur.l + (f.spend ? ' · chi ' + SPEND[f.spend][0].toLowerCase() : '') + (f.src ? ' · nguồn ' + f.src : '') + (f.q ? ' · tìm “' + f.q + '”' : '') };
    return '<div class="page-head"><h1>Khách đã mua</h1><span class="muted">' + base.length + ' khách</span><div class="grow"></div><button class="btn pri" data-promo title="Gửi tin ưu đãi qua Zalo cho từng khách trong danh sách đang lọc">📣 Gửi ưu đãi lần lượt</button></div>' +
      '<div class="tools"><div class="search">' + I.search + '<input type="search" id="cq" placeholder="Tìm tên, SĐT, tỉnh, huyện, sản phẩm…" value="' + esc(f.q) + '"></div>' +
      '<select id="csort" style="flex:0 0 auto;width:auto">' + Object.keys(SORTS).map(function (k) { return '<option value="' + k + '"' + (f.sort === k ? ' selected' : '') + '>' + SORTS[k][0] + '</option>'; }).join('') + '</select></div>' +
      '<div class="tools filt"><select id="cspend" class="' + (f.spend ? 'on' : '') + '" title="Lọc theo tổng tiền khách đã chi"><option value="">💰 Mọi mức chi</option>' + Object.keys(SPEND).map(function (k) { return '<option value="' + k + '"' + (f.spend === k ? ' selected' : '') + '>Đã chi ' + SPEND[k][0].toLowerCase() + '</option>'; }).join('') + '</select>' +
        '<select id="csrc" class="' + (f.src ? 'on' : '') + '" title="Lọc theo nguồn khách mua lần đầu"><option value="">🧭 Mọi nguồn</option>' + srcs.map(function (x) { return '<option' + (f.src === x ? ' selected' : '') + '>' + esc(x) + '</option>'; }).join('') + '</select>' +
        (f.spend || f.src ? '<button type="button" class="link small" data-cfclear>Bỏ lọc</button>' : '') + '</div>' +
      legend(lvl() >= 2 ? S.d.customers : S.d.customers.filter(function (c) { return c.owner === S.user.name; }), f.cat) +
      '<div class="chips">' + chips.map(function (x) { var n = base.filter(x.f).length, tp = { nocomm: 'Khách chưa vào nhóm Zalo “Sống khỏe cùng Thực Dưỡng Lành”: dùng 📣 Gửi ưu đãi lần lượt để mời hàng loạt', runout7: 'Dự kiến dùng hết trong 7 ngày tới (hoặc vừa hết trong 7 ngày qua): gọi mời mua lại ngay', vip: TIP.vip(), risk: TIP.risk, lost: TIP.lost, cold: TIP.cold, nozalo: TIP.nozalo, task: TIP.task, callback: TIP.callback, all: TIP.all }[x.k]; return '<button class="chip' + (x.k === cur.k ? ' on' : '') + '" data-cf="' + x.k + '"' + (tp ? ' title="' + esc(tp) + '"' : '') + '>' + x.l + ' <em>' + n + '</em></button>'; }).join('') + '</div>' +
      areaBox(q) + crossHint(q, qd, true) +
      (list.length ? '<div class="crows">' + list.slice(0, f.n).map(custRow).join('') + '</div>' +
        (list.length > f.n ? '<button class="btn more" data-more="c">Xem thêm ' + Math.min(60, list.length - f.n) + ' khách</button>' : '') : empty('Không có khách nào khớp.'));
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
  function noteExtras(note) { return String(note || '').split('\n').filter(function (l) { return /^(SĐT khác|Người giới thiệu|Sức khoẻ):/.test(l.trim()); }); }
  function timelineHtml(c, orders, max) {
    var items = (orders || []).map(function (o) { return { time: o.time, k: 'o', html: '<div class="tl o' + (isVoid(o.status) ? ' void' : '') + '"><i>🛒</i><div><b>Đơn ' + money(o.total) + '</b> ' + stTag(o.status) + '<div class="tl-s">' + esc(itemNames(o.items).join(', ')) + '</div></div><small>' + fDate(o.time) + '</small></div>' }; })
      .concat(leadsOf(c.phone).map(function (ld) { return { time: ld.time, html: '<div class="tl lead"><i>🙋</i><div><b>Hỏi qua ' + esc(ld.channel || 'kênh khác') + '</b>' + (ld.interest ? ' · ' + esc(ld.interest) : '') + ' <span class="tag ' + (LEAD_CLS[ld.status] || '') + '">' + esc(ld.status) + '</span>' + (ld.note ? '<div class="tl-s">' + esc(String(ld.note).split('\n')[0].slice(0, 120)) + '</div>' : '') + '</div><small>' + fDate(ld.time) + (ld.owner ? '<br>' + esc(ld.owner) : '') + '</small></div>' }; }))
      .concat(logOf(c.phone).filter(function (l) { return l.what !== 'Gửi ưu đãi'; }).map(function (l) { var ic = l.result === NO_REPLY ? '📵' : l.result === 'Đã đặt lại' ? '✅' : '💬'; return { time: l.time, html: '<div class="tl"><i>' + ic + '</i><div><b>' + esc(l.result || l.what) + '</b>' + (l.note ? '<div class="tl-s">' + esc(l.note) + '</div>' : '') + '</div><small>' + fDate(l.time) + (l.by ? '<br>' + esc(l.by) : '') + '</small></div>' }; }))
      .concat(noteEntries(c.note).filter(function (e) { return !SHIFT_NOTE.test(norm(e.text)); }).map(function (e) { var miss = /(^|[^a-zà-ỹ])(knm|tb)([^a-zà-ỹ]|$)|thuê bao|không nghe|k nghe|tắt máy|từ chối nghe/i.test(e.text); return { time: e.time, html: '<div class="tl old"><i>' + (miss ? '📵' : '📒') + '</i><div>' + esc(e.text) + '</div><small>' + fDate(e.time) + '</small></div>' }; }))
      .sort(function (a, b) { return (b.time || 0) - (a.time || 0); });
    if (!items.length) return '<p class="muted" style="padding:8px 0">Chưa có đơn hàng hay lần chăm sóc nào.</p>';
    return '<div class="tls">' + items.slice(0, max).map(function (x) { return x.html; }).join('') + '</div>' + (items.length > max ? '<button class="btn block" data-tlmore style="margin-top:8px">Xem thêm ' + (items.length - max) + ' mục cũ hơn</button>' : '');
  }
  function openCustomer(phone, fromRoute) {
    var c = cust(phone); if (!c) { toast('Không tìm thấy khách', true); return; }
    if (!fromRoute) history.pushState(null, '', '#khach-hang/' + c.phone);
    var owners = userNames(), all = null, tab = 'hist', tlMax = 25, st = custStats(c, ordersOf(c.phone));
    if (c.owner && owners.indexOf(c.owner) < 0) owners.push(c.owner);
    var r = replyOf(c), avg = c.orders ? c.spent / c.orders : 0;
    var habit = function () { return '<span>🧺 Hay mua: <b>' + esc(st.top || '–') + '</b>' + (st.topN > 1 ? ' (' + st.topN + ' lần)' : '') + '</span>' + (st.gap ? '<span>🔁 Khoảng <b>' + st.gap + ' ngày</b> mua lại 1 lần</span>' : '') + (c.runout ? '<span>⏰ Dự kiến hết: <b>' + fDate(c.runout).slice(0, 5) + '</b> (' + daysAgo(c.runout) + ')</span>' : ''); };
    var body = '<div class="p-top"><div class="p-sub">' + fPhone(c.phone) + ' · ' + (c.owner ? '👤 ' + esc(c.owner) : (isPoolStaff() ? claimBtn('c', c.phone) : 'Chưa ai phụ trách')) + '</div>' +
      '<div class="p-tags">' + zaloTag(c) + consentTag(c) + '</div>' +
      '<div class="acts steps p-acts"><a class="btn" href="tel:' + c.phone + '">📞 Gọi</a><a class="btn zalo" href="' + zalo(c.phone) + '" target="_blank" rel="noopener">Zalo</a><button class="btn pri" data-care="' + c.phone + '" data-task="' + (c.task ? c.task.type : 'other') + '">💬 Chăm sóc</button><button class="btn" data-neworder="' + c.phone + '">＋ Đơn</button></div></div>' +
      (c.flag ? '<div class="notice" style="background:var(--red-light);color:var(--red)">⚠️ Khách có nhãn <b>' + esc(c.flag) + '</b>. Nên yêu cầu chuyển khoản trước khi gửi hàng.</div>' : '') +
      '<div class="p-val"><div><b>' + moneyShort(c.spent) + '</b><span>Tổng chi</span></div><div><b>' + c.orders + '</b><span>đơn</span></div><div><b>' + moneyShort(avg) + '</b><span>TB/đơn</span></div></div>' +
      '<div class="p-lines"><span>🛒 Mua gần nhất: <b>' + daysAgo(c.last) + '</b> (' + fDate(c.last) + ')</span><span id="pHabit">' + habit() + '</span>' +
      (c.backN ? '<span>↩ ' + c.backN + ' lần hoàn' + (c.lastBack ? ' (gần nhất ' + fDate(c.lastBack) + ')' : '') + (riskyReturn(c) ? ' · <span class="bad-line">hay hoàn: nên nhờ khách chuyển khoản trước</span>' : ' · vẫn là khách tốt') + '</span>' : '') + '</div>' +
      (coldOf(c) ? '<div class="notice" style="background:#eef2f7;color:#334">❄️ <b>Khách lạnh</b> (' + esc(coldOf(c)) + '): không đưa vào danh sách gọi hằng ngày. ' + (coldOf(c) === 'Không dùng nữa' ? 'Sau 6 tháng tự quay lại để chào lại 1 lần; khách đặt đơn mới là hết lạnh.' : 'Nếu bán lại, nên nhờ khách chuyển khoản trước.') + '</div>' : '') +
      '<div class="p-now">' + (c.task ? '<div>' + TASKS[c.task.type].icon + ' Hôm nay: <b>' + TASKS[c.task.type].title + '</b> · ' + taskLine(c) + '</div>' : '') +
      '<div class="' + (r.never ? 'muted' : '') + '">💬 ' + (r.never ? 'Chưa ghi nhận lần nào khách trả lời' : 'Lần cuối khách trả lời: <b>' + fDate(r.at) + '</b>' + (r.result ? ' – ' + esc(r.result) : '') + (r.by ? ' (' + esc(r.by) + ')' : '') + ' · ' + r.days + ' ngày trước') + (r.missed ? ' · <span class="bad-line">sau đó ' + r.missed + ' lần không nghe máy</span>' : '') + '</div></div>' +
      '<div class="tabs" role="tablist"><button data-ptab="hist" class="on">Lịch sử</button><button data-ptab="orders">Đơn hàng (' + c.orders + ')</button><button data-ptab="info">Thông tin</button></div><div id="pTab"></div>' +
      '<details class="p-edit" id="pEdit"><summary>⚙️ Sửa thông tin (người phụ trách, hẹn gọi lại, nhãn màu, ghi chú)</summary><div class="box" style="margin:8px 0 0"><div class="row2c">' +
      (lvl() >= 2 ? '<label class="f"><span>Người phụ trách</span><select id="cOwner"><option value="">– Chưa ai –</option>' + owners.map(function (n) { return '<option' + (n === c.owner ? ' selected' : '') + '>' + esc(n) + '</option>'; }).join('') + '</select></label>' : '') +
      '<label class="f"><span>Hẹn gọi lại ngày</span><input type="date" id="cCb" value="' + (c.callback ? isoDate(c.callback) : '') + '"></label></div>' +
      '<label class="f"><span>🎨 Nhãn màu (để trống = máy tự tô theo loại khách)</span><select id="cTag"><option value="">Tự động: ' + esc(custCat(Object.assign({}, c, { tag: '' })).label) + '</option>' +
      myTags().concat(c.tag && !myTags().some(function (t) { return t.name === c.tag; }) ? [{ name: c.tag }] : []).map(function (t) { return '<option' + (t.name === c.tag ? ' selected' : '') + '>' + esc(t.name) + '</option>'; }).join('') + '</select></label>' +
      '<label class="f"><span>Ghi chú về khách / nhật ký (mỗi dòng “ngày: nội dung”)</span><textarea id="cNote" rows="6">' + esc(c.note) + '</textarea></label>' +
      (canEdit(c) ? commBox(c, '') : '') + (canEdit(c) && c.zalo ? '<p style="margin:0 0 10px"><button type="button" class="link small" id="cUnZalo">Bỏ đánh dấu đã kết bạn Zalo</button></p>' : '') +
      '<button class="btn pri" id="cSave">Lưu thay đổi</button></div></details>';
    var foot = '<div class="p-quick"><input type="text" id="cQuick" placeholder="✏️ Ghi nhanh: kh dùng ok, hẹn cuối tháng…" enterkeyhint="send"><button class="btn pri" id="cQSave">Lưu</button></div>';
    var m = modal('<span>' + esc(c.name || 'Khách') + '</span> ' + custTags(c) + famTag(c), body, foot, { route: '#khach-hang', pushed: !fromRoute });
    var draw = function () {
      var list = all || ordersOf(c.phone), box = $('#pTab', m); if (!box) return;
      $$('[data-ptab]', m).forEach(function (b) { b.classList.toggle('on', b.getAttribute('data-ptab') === tab); });
      if (tab === 'hist') box.innerHTML = timelineHtml(c, list, tlMax) + (all ? '' : '<p class="small muted">Đang tải đơn cũ và ghi chú đầy đủ…</p>');
      if (tab === 'orders') box.innerHTML = (list.length ? '<div class="rows-b">' + list.slice().sort(function (a, b) { return (b.time || 0) - (a.time || 0); }).map(function (o) {
        return '<div class="or' + (isVoid(o.status) ? ' void' : '') + '"><div class="or-1"><b>' + fDate(o.time) + '</b>' + stTag(o.status) + '<span class="end">' + money(o.total) + '</span></div><div class="or-2">' + esc(itemNames(o.items).join(', ')) + '</div><div class="or-3">' + esc(o.id) + (o.seller ? ' · 👤 ' + esc(o.seller) : '') + (o.note ? ' · 📝 ' + esc(o.note.length > 80 ? o.note.slice(0, 80) + '…' : o.note) : '') + '</div></div>';
      }).join('') + '</div>' : '<p class="muted">Chưa có đơn.</p>') + (all ? '' : '<p class="small muted">Đang tải đơn cũ…</p>');
      if (tab === 'info') box.innerHTML = '<div class="box" style="margin:0"><div class="grid-info">' + info('Điện thoại', fPhone(c.phone)) + info('Zalo', c.zalo ? '✓ Đã kết bạn' : 'Chưa kết bạn') + info('Cộng đồng', inComm(c) ? '👥 Đã vào nhóm' : c.community || 'Chưa mời') +
        info('Đơn đầu', fDate(c.first)) + info('Nhận hàng gần nhất', c.recv ? fDate(c.recv) : 'chưa rõ') + info('Nhóm', c.group) + info('Nguồn', c.source || '–') +
        (function () { var ld = leadsOf(c.phone)[0]; return ld ? info('Biết đến qua', ld.channel + ' · hỏi ' + fDate(ld.time) + (c.first && c.first >= (ld.time || 0) ? ' · chốt sau ' + Math.max(0, Math.round((c.first - ld.time) / DAY)) + ' ngày' : ''), true) : ''; })() + info('Tỉnh / thành', provOf(c) ? provOf(c).old + (provOf(c).old !== provOf(c).nw ? ' (nay thuộc ' + provOf(c).nw + ')' : '') : 'chưa rõ') + info('Địa chỉ', [c.address, c.ward, c.province].filter(Boolean).join(', '), true) + info('Đã mua', c.products.join('; '), true) +
        noteExtras(c.note).map(function (l) { var i = l.indexOf(':'); return info(l.slice(0, i), l.slice(i + 1).trim(), true); }).join('') + '</div></div>';
      var mo = $('[data-tlmore]', m); if (mo) mo.onclick = function () { tlMax += 50; draw(); };
    };
    $$('[data-ptab]', m).forEach(function (b) { b.onclick = function () { tab = b.getAttribute('data-ptab'); draw(); }; });
    draw();
    var qs = $('#cQSave', m), qi = $('#cQuick', m), sv = $('#cSave', m), ta = $('#cNote', m);
    if (c.noteCut) { qs.disabled = true; sv.disabled = true; ta.disabled = true; }
    api('cust_orders', { phone: c.phone }).then(function (j) { // toàn bộ đơn (kể cả đơn cũ) + ghi chú đầy đủ
      all = j.orders; if (c.noteCut || j.note !== undefined) { c.note = j.note; c.noteCut = false; ta.value = j.note; }
      qs.disabled = false; sv.disabled = false; ta.disabled = false; st = custStats(c, all); var hb = $('#pHabit', m); if (hb) hb.innerHTML = habit(); draw();
    }, function (e) { all = ordersOf(c.phone); qs.disabled = false; sv.disabled = !!c.noteCut; ta.disabled = !!c.noteCut; draw(); if (c.owner) toast(e.message, true); });
    if ($('#cUnZalo', m)) $('#cUnZalo', m).onclick = function () { setZalo(c, false); this.remove(); };
    var quick = function () {
      var q = qi.value.trim(); if (!q || qs.disabled) return;
      var note = fDate(Date.now()).slice(0, 5) + ': ' + q + (c.note ? '\n' + c.note : '');
      sendOp('customer', { phone: c.phone, note: note, quick: q }); ta.value = note; qi.value = ''; tab = 'hist'; draw(); toast('Đã ghi ✓'); render();
    };
    qs.onclick = quick; qi.addEventListener('keydown', function (e) { if (e.key === 'Enter') { e.preventDefault(); quick(); } });
    sv.onclick = function () {
      var p = { phone: c.phone, note: ta.value.trim(), callback: $('#cCb', m).value, tag: $('#cTag', m).value };
      if ($('#cOwner', m)) p.owner = $('#cOwner', m).value;
      sendOp('customer', p); draw(); toast('Đã lưu ✓'); $('#pEdit', m).open = false; render();
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
    return logOf(c.phone).filter(isCareLog).map(function (l) { return { time: l.time, text: (l.result || '') + (l.note ? ': ' + l.note : '') }; })
      .concat(noteEntries(c.note).filter(function (e) { return !SHIFT_NOTE.test(norm(e.text)); })).sort(function (a, b) { return (b.time || 0) - (a.time || 0); }).slice(0, n);
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
  function info(k, v, full) { return '<div' + (full ? ' class="full"' : '') + '><span>' + k + '</span><b>' + esc(v === '' || v == null ? '–' : v) + '</b></div>'; }
  function userNames() { return (S.d.users || []).filter(function (u) { return u.active !== false; }).map(function (u) { return u.name; }); }

  /* ---------- hộp chăm sóc: tin mẫu → Zalo → kết quả */
  function templateFor(type) {
    var key = TASKS[type === 'old' ? 'winback' : type] && TASKS[type === 'old' ? 'winback' : type].tpl, tp = S.d.templates; // khách cũ lâu chưa gọi → dùng mẫu "Mời quay lại"
    if (!key) return -1;
    for (var i = 0; i < tp.length; i++) if (norm(tp[i][0]).indexOf(norm(key)) >= 0) return i;
    return -1;
  }
  function fillTpl(text, c) {
    var name = (c.name || '').replace(/\(.*?\)/g, ' ').trim().split(/\s+/).pop() || 'anh/chị';
    return String(text).replace(/\[Tên\]/gi, name).replace(/\[Sản phẩm\]/gi, shortProducts(c.products, 2) || 'sản phẩm');
  }
  function openCare(phone, type, opt) {
    var c = cust(phone); if (!c) return; opt = opt || {};
    type = type || (c.task ? c.task.type : 'other');
    var ti = templateFor(type), tp = S.d.templates;
    var hist = recentHist(c, 3);
    var body = (opt.flow ? '<div class="flow-h"><div><b>Khách ' + opt.n + ' / ' + opt.total + '</b><span>' + (TASKS[type] ? TASKS[type].icon + ' ' + TASKS[type].title : 'Chăm sóc') + '</span></div><div class="bar"><i style="width:' + Math.round((opt.n - 1) * 100 / Math.max(1, opt.total)) + '%"></i></div></div>' : '') +
      '<div class="box"><div class="r1" style="display:flex;gap:8px;align-items:center;flex-wrap:wrap"><b>' + esc(c.name) + '</b> ' + custTags(c) + famTag(c) + ' <span class="muted">' + fPhone(c.phone) + '</span></div>' +
      '<div class="small muted" style="margin-top:4px">' + esc(shortProducts(c.products, 3)) + ' · mua ' + daysAgo(c.last) + (c.task ? ' · ' + taskLine(c) : '') + '</div>' +
      (hist.length ? '<div class="mini-hist">' + hist.map(function (x) { return '<div><span>' + fDate(x.time).slice(0, 5) + '</span> ' + esc(x.text) + '</div>'; }).join('') + '</div>' : '') + '</div>' +
      '<div class="box"><h3>Bước 1 · Gửi tin cho khách</h3>' +
      '<label class="f"><span>Mẫu tin</span><select id="kTpl"><option value="-1">– Tự viết –</option>' + tp.map(function (t, i) { return '<option value="' + i + '"' + (i === ti ? ' selected' : '') + '>' + esc(t[0] + (t[1] ? ' – ' + t[1] : '')) + '</option>'; }).join('') + '</select></label>' +
      '<label class="f"><span>Nội dung (sửa được, nhớ điền phần “…” nếu có)</span><textarea id="kMsg" rows="6">' + esc(ti >= 0 ? fillTpl(tp[ti][2], c) : '') + '</textarea></label>' +
      (c.zalo ? '<div class="steps"><button class="btn zalo" id="kZalo">📋 Copy tin & mở Zalo</button><button class="btn" id="kCopy">Copy tin</button><a class="btn" href="tel:' + c.phone + '">📞 Gọi</a></div><p class="small muted" style="margin:8px 0 0">' + ZI + ' Khách đã kết bạn Zalo: nhắn tin trước, khách tiện trả lời lúc rảnh.</p></div>'
        : '<div class="steps"><a class="btn pri" href="tel:' + c.phone + '">📞 Gọi</a><button class="btn zalo" id="kZalo">📋 Copy tin & mở Zalo</button><button class="btn" id="kCopy">Copy tin</button></div><p class="small" style="margin:8px 0 0">Khách <b>chưa kết bạn Zalo</b>: gọi xong nhớ xin kết bạn để lần sau nhắn tin chăm sóc. ' + (canEdit(c) ? zaloTag(c) : '') + '</p></div>') +
      commBox(c, type) +
      '<div class="box"><h3>Bước 2 · Ghi kết quả</h3>' +
      '<div class="f"><span style="display:block;font-size:13px;font-weight:600;margin-bottom:6px;color:var(--ink)">Bấm 1 lần là lưu (tự hẹn ngày gọi lại)</span><div class="quick">' + QUICK.filter(function (q) { return !q.only || q.only === type; }).sort(function (a, b) { return (b.only ? 1 : 0) - (a.only ? 1 : 0); }).map(function (q) { return '<button class="btn" data-q="' + q.k + '" title="' + esc(q.r + (q.d ? ', ' + q.d + ' ngày sau tự nhắc gọi lại' : '')) + '">' + q.l + '</button>'; }).join('') + '</div></div>' +
      '<p class="small muted" style="margin:4px 0 10px">Hoặc tự chọn bên dưới:</p>' +
      '<label class="f"><span>Việc</span><select id="kTask">' + Object.keys(TASK_LOG).map(function (k) { return '<option value="' + k + '"' + (k === type ? ' selected' : '') + '>' + TASK_LOG[k] + '</option>'; }).join('') + '</select></label>' +
      '<div class="f"><span style="display:block;font-size:13px;font-weight:600;margin-bottom:6px;color:var(--ink)">Kết quả</span><div class="radios">' + RESULTS.map(function (r, i) { return '<label><input type="radio" name="kRes" value="' + esc(r) + '"' + '><span>' + esc(r) + '</span></label>'; }).join('') + '</div></div>' +
      '<label class="f" id="kCbWrap"><span>Hẹn gọi lại ngày (nếu có)</span><input type="date" id="kCb" min="' + isoDate(Date.now()) + '"></label>' +
      '<label class="f"><span>Ghi chú lần này</span><textarea id="kNote" rows="2" placeholder="Khách nói gì, cần gì…"></textarea></label><p class="err" id="kErr"></p></div>';
    var m = modal((opt.flow ? '📞 ' : 'Chăm sóc: ') + esc(c.name), body, opt.flow ? '<button class="btn" id="kSkip">⏭ Để sau</button><button class="btn pri" id="kSave">Lưu & sang khách tiếp</button>' : '<button class="btn" data-close>Để sau</button><button class="btn pri" id="kSave">Lưu kết quả</button>');
    if (opt.flow) {
      m.addEventListener('click', function (e) { if (e.target === m || e.target.closest('[data-close]')) S.flow = null; }, true); // bấm ✕ = dừng gọi lần lượt
      $('#kSkip', m).onclick = function () { if (S.flow) S.flow.skip[c.phone] = 1; closeModal(true); nextFlow(); };
    }
    var msg = $('#kMsg', m);
    $('#kTpl', m).onchange = function () { var i = +this.value; msg.value = i >= 0 ? fillTpl(tp[i][2], c) : ''; };
    $('#kCopy', m).onclick = function () { copy(msg.value).then(function () { toast('Đã copy tin nhắn'); }); };
    $('#kZalo', m).onclick = function () { copy(msg.value).then(function () { toast('Đã copy – dán vào khung chat Zalo'); }); window.open(zalo(c.phone), '_blank', 'noopener'); };
    $$('input[name=kRes]', m).forEach(function (r) { r.onchange = function () { if (r.value === 'Hẹn gọi lại' && !$('#kCb', m).value) { $('#kCb', m).value = isoDate(Date.now() + 2 * DAY); $('#kCb', m).focus(); } }; });
    $$('[data-q]', m).forEach(function (b) { b.onclick = function () { quickCare(c, b.getAttribute('data-q'), $('#kTask', m).value, $('#kNote', m).value.trim(), b, $('#kErr', m)); }; });
    $('#kSave', m).onclick = function () {
      var res = $('input[name=kRes]:checked', m), err = $('#kErr', m);
      if (!res) { err.textContent = 'Bạn chọn kết quả giúp nhé.'; return; }
      var p = { phone: c.phone, task: $('#kTask', m).value, result: res.value, note: $('#kNote', m).value.trim(), callback: $('#kCb', m).value };
      var btn = this; btn.disabled = true; btn.textContent = 'Đang lưu…';
      saveCare(c, p).then(function () { closeModal(); toast('Đã lưu kết quả chăm sóc ✓'); navBadges(); render(); if (S.flow) setTimeout(nextFlow, 200); }, function (e) { btn.disabled = false; btn.textContent = 'Lưu kết quả'; err.textContent = e.message; });
    };
  }
  function saveCare(c, p) { sendOp('care', p); return Promise.resolve(); } // lưu ngay trên màn hình, gửi ngầm (xem hàng chờ gửi)
  /** Ghi nhanh 1 chạm: KNM, thuê bao, dùng ok… (thêm ghi chú đang gõ nếu có). */
  function quickCare(c, key, task, extra, btn, errEl) {
    var q = QUICK.filter(function (x) { return x.k === key; })[0]; if (!q) return;
    var p = { phone: c.phone, task: task && TASK_LOG[task] ? task : 'other', result: q.r, note: q.n + (extra ? ', ' + extra : ''), callback: q.d ? isoDate(Date.now() + q.d * DAY) : '' };
    if (q.received) p.received = 1;
    var txt = btn ? btn.textContent : ''; if (btn) { btn.disabled = true; btn.textContent = 'Đang lưu…'; }
    saveCare(c, p).then(function () {
      if ($('.modal')) closeModal();
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
    var mgr = lvl() >= 2, here = (location.hash || '#hom-nay').slice(1).split('/')[0] || 'hom-nay', imgs = [];
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
  function orderTodo() {
    var t0 = today(), d = function (o) { return daysSince(o.time); };
    var G = [
      { k: 'new', t: '🆕 Chờ xác nhận', tip: 'gọi khách xác nhận đơn', f: function (o) { return o.status === 'Mới'; } },
      { k: 'pack', t: '📦 Chờ gửi hàng', tip: 'đã xác nhận, chưa có mã vận đơn – đóng hàng, nhập mã vận đơn', f: function (o) { return o.status === 'Đã xác nhận' && !o.tracking; } },
      { k: 'late', t: '🚚 Giao lâu chưa tới', tip: 'đang giao quá ' + SHIP_LATE + ' ngày – gọi hỏi khách, giục bưu cục để tránh hoàn', f: function (o) { return o.status === 'Đang giao' && shipDays(o) > SHIP_LATE; } },
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
    var u = CARRIERS[o.carrier] || '', t = esc(o.carrier) + ' ' + esc(o.tracking);
    return u ? '<a class="trk" href="' + esc(u.replace('{c}', encodeURIComponent(o.tracking))) + '" target="_blank" rel="noopener" data-trk="' + esc(o.tracking) + '" title="Bấm để tra cứu (mã đã được copy sẵn)">🚚 ' + t + ' ↗</a>'
      : '<button type="button" class="trk link" data-trk="' + esc(o.tracking) + '" title="Bấm để copy mã vận đơn">🚚 ' + t + ' 📋</button>';
  }
  function orderRow(o) {
    var oc = orderCat(o), next = NEXT[o.status], dd = shipDays(o), shipping = o.status === 'Đang giao', pv = provOf(o), oc0 = cust(o.phone) || {}, backWarn = oc0.backN && !isVoid(o.status) && o.status !== 'Đã giao', kn = keyNote(o);
    var act = o.status === 'Đã xác nhận' && !o.tracking ? '<button class="btn pri" data-order="' + esc(o.id) + '" title="Mở đơn để nhập mã vận đơn">📦 Nhập mã VĐ</button>' : next ? '<button class="btn pri" data-next="' + esc(o.id) + '">' + NEXT_LABEL[o.status] + '</button>' : '';
    return '<div class="rw orw click tinted" data-order="' + esc(o.id) + '"' + catAttr(oc) + '><div class="rw-m">' +
      '<div class="rw-1"><b>' + esc(o.name) + '</b>' + stTag(o.status) + (shipping ? '<span class="tag ' + (dd > SHIP_LATE ? 'st-late' : 'st-giao') + '" title="' + (o.shipAt ? 'Đã gửi ' + dd + ' ngày (gửi ngày ' + fDate(o.shipAt).slice(0, 5) + ')' : 'Tính từ ngày đặt ' + fDate(o.time).slice(0, 5) + ' (đơn này chưa ghi ngày gửi)') + '">🚚 ' + dd + ' ngày' + (dd > SHIP_LATE ? ' ⚠️' : '') + '</span>' : '') + (oc.key !== 'void' ? catChip(oc) : '') + (backWarn ? '<span class="tag st-back" title="' + esc('Khách này đã hoàn ' + oc0.backN + ' đơn' + (oc0.lastBack ? ', gần nhất ' + fDate(oc0.lastBack) : '') + '. Gọi xác nhận kỹ trước khi gửi; đơn lớn nên nhờ chuyển khoản trước.') + '">⚠️ đã hoàn ' + oc0.backN + ' lần</span>' : '') + '<span class="end">' + (shipping && !isBank(o) ? '<small class="muted">thu hộ </small>' : '') + money(o.total) + '</span></div>' +
      '<div class="rw-2">' + (pv ? '<b class="prov">📍 ' + esc(pv.old) + '</b> · ' : '') + when(o.time) + ' · ' + esc(o.payment) + (isBank(o) && !isVoid(o.status) ? (o.paid ? ' ✓' : ' <span class="warn-line">chưa nhận tiền</span>') : '') + ' · ' + esc(itemNames(o.items).join(', ')) + '</div>' +
      (kn ? '<div class="keynote">📌 ' + esc(o.note.length > 140 ? o.note.slice(0, 140) + '…' : o.note) + '</div>' : '') +
      '<div class="rw-3">' + (o.oflag ? '<span class="tag st-late" title="' + esc(o.oflag) + '">⚠️ Kiểm tra loại đơn</span> ' : '') + (o.tracking ? trackLink(o) + ' · ' : '') + '<span class="muted">' + esc(o.id) + ' · ' + esc(otLabel(otypeOf(o))) + '</span>' + (o.seller && (lvl() >= 2 || o.seller !== S.user.name) ? ' · 👤 ' + esc(o.seller) : '') + (o.note && !kn ? ' · 📝 ' + esc(o.note.length > 60 ? o.note.slice(0, 60) + '…' : o.note) : '') + '</div></div>' +
      '<div class="rw-a">' + act + '<a class="btn" href="tel:' + o.phone + '" aria-label="Gọi">📞</a></div></div>';
  }
  function viewOrders() {
    var f = S.f.o || (S.f.o = { q: '', st: 'all', n: 60, tab: 'todo', p: { k: 'all' } });
    if (!f.tab) f.tab = 'todo'; if (!f.p) f.p = { k: 'all' };
    var q = norm(f.q), qd = q.replace(/\D/g, ''), t0 = today();
    if (q && f.tab === 'todo') f.tab = 'all'; // đang tìm → xem trong tất cả đơn
    var mR = monthRange(monthOf(Date.now())), todayOs = S.d.orders.filter(function (o) { return o.time >= t0 && !isVoid(o.status); }), monthOs = S.d.orders.filter(function (o) { return o.time >= mR[0] && o.time < mR[1] && o.status !== 'Huỷ'; });
    var backM = monthOs.filter(function (o) { return /hoàn/i.test(o.status); }).length, shipOs = S.d.orders.filter(function (o) { return o.status === 'Đang giao'; }), shipping = shipOs.length, codOut = shipOs.reduce(function (s0, o) { return s0 + (isBank(o) ? 0 : o.total); }, 0);
    var h = '<div class="page-head"><h1>Đơn hàng</h1><div class="grow"></div><button class="btn pri" data-neworder="">＋ Tạo đơn (Zalo, điện thoại…)</button></div>' +
      '<div class="minis">' + mini('🧾 Đơn hôm nay', todayOs.length, '', '') + mini('💰 Doanh thu hôm nay', moneyShort(todayOs.reduce(function (s0, o) { return s0 + o.total; }, 0)), '', 'good') + mini('🚚 Đang giao', shipping + (codOut ? '<small class="mini-sub" title="Tiền COD bưu cục đang giữ của các đơn đang giao">thu hộ ' + moneyShort(codOut) + '</small>' : ''), '', '') + mini('↩ Hoàn tháng này', monthOs.length ? pct(backM, monthOs.length) + '%' : '–', '', backM ? 'bad' : '') + '</div>' +
      '<div class="tools"><div class="search">' + I.search + '<input type="search" id="oq" placeholder="Tìm tên, SĐT, mã đơn, sản phẩm…" value="' + esc(f.q) + '"></div></div>';
    var G = orderTodo(), todoN = G.reduce(function (s0, g) { return s0 + g.list.length; }, 0);
    h += '<div class="tabs" style="max-width:420px"><button data-otab="todo" class="' + (f.tab === 'todo' ? 'on' : '') + '">⚡ Cần xử lý' + (todoN ? ' (' + todoN + ')' : '') + '</button><button data-otab="all" class="' + (f.tab === 'all' ? 'on' : '') + '">📋 Tất cả đơn</button></div>';
    if (f.tab === 'todo') {
      var any = false;
      G.forEach(function (g) {
        if (!g.list.length) return; any = true;
        h += '<details class="grp" data-grp="o-' + g.k + '"' + (!S.f.gopen || S.f.gopen['o-' + g.k] !== false ? ' open' : '') + '><summary><span class="g-t">' + g.t + '</span><span class="count">' + g.list.length + '</span><span class="g-tip">' + g.tip + '</span></summary><div class="rows">' + g.list.slice(0, 50).map(orderRow).join('') + (g.list.length > 50 ? '<p class="small muted" style="padding:8px 12px">… và ' + (g.list.length - 50) + ' đơn khác (xem ở Tất cả đơn)</p>' : '') + '</div></details>';
      });
      if (!any) h += empty('🎉 Không có đơn nào cần xử lý. Xem lịch sử ở “Tất cả đơn”.');
      return h;
    }
    var RG = perRange(f.p);
    var base = S.d.orders.filter(function (o) { return o.time >= RG[0] && o.time < RG[1] && (!q || norm(o.name + ' ' + o.id + ' ' + o.items + ' ' + o.province + ' ' + o.source + ' ' + o.tracking).indexOf(q) >= 0 || (qd.length >= 3 && o.phone.indexOf(qd) >= 0)); }).sort(function (a, b) { return b.time - a.time; });
    var list = f.st === 'all' ? base : base.filter(function (o) { return o.status === f.st; });
    var sum = list.filter(function (o) { return !isVoid(o.status); }).reduce(function (s0, o) { return s0 + o.total; }, 0);
    h += perBtn('o', f.p) +
      '<div class="chips">' + ['all'].concat(STATUS).map(function (s0) { var n = s0 === 'all' ? base.length : base.filter(function (o) { return o.status === s0; }).length; return n || s0 === 'all' || f.st === s0 ? '<button class="chip' + (f.st === s0 ? ' on' : '') + '" data-os="' + esc(s0) + '">' + (s0 === 'all' ? 'Tất cả' : s0) + ' <em>' + n + '</em></button>' : ''; }).join('') + '</div>' +
      '<p class="small muted" style="margin:0 0 8px">' + list.length + ' đơn' + ' · ' + money(sum) + ' (không tính huỷ / hoàn)' + '</p>' +
      (list.length ? '<div class="crows">' + list.slice(0, f.n).map(orderRow).join('') + '</div>' +
        (list.length > f.n ? '<button class="btn more" data-more="o">Xem thêm ' + Math.min(60, list.length - f.n) + ' đơn</button>' : '') : empty('Không có đơn nào.'));
    return h;
  }
  function findOrder(id) { return S.d.orders.filter(function (o) { return o.id === id; })[0]; }
  function openOrder(id, fromRoute) {
    var o = findOrder(id); if (!o) return;
    if (!fromRoute) history.pushState(null, '', '#don-hang/' + encodeURIComponent(o.id));
    var c = cust(o.phone), logs = logOf(o.id);
    var body = '<div class="acts steps" style="margin-bottom:12px"><a class="btn" href="tel:' + o.phone + '">📞 Gọi</a><a class="btn zalo" href="' + zalo(o.phone) + '" target="_blank" rel="noopener">Zalo</a>' +
      (c ? '<button class="btn" data-cust="' + c.phone + '">👤 Xem khách (' + c.orders + ' đơn)</button>' : '') + '<button class="btn" id="oCopy">📋 Copy thông tin giao hàng</button><button class="btn" id="oEdit">✏️ Sửa đơn</button></div>' +
      (o.oflag ? '<div class="notice" id="oOtBox">⚠️ <b>Kiểm tra loại đơn:</b> sale chọn <b>' + esc(otLabel(otypeOf(o))) + '</b>. ' + esc(o.oflag) + '.' + (lvl() >= 2 ? '<div class="steps" style="margin-top:8px"><button class="btn pri" id="oOtOk">✓ Đúng, giữ ' + esc(otypeOf(o)) + '</button>' + OTYPES.filter(function (t) { return t !== otypeOf(o); }).map(function (t) { return '<button class="btn" data-otset="' + esc(t) + '">Đổi sang ' + esc(otLabel(t)) + '</button>'; }).join('') + '</div>' : '<br>Quản lý sẽ kiểm tra lại.') + '</div>' : '') +
      '<div class="box"><h3>Trạng thái</h3><div class="radios">' + STATUS.map(function (s) { return '<label><input type="radio" name="oSt" value="' + s + '"' + (s === o.status ? ' checked' : '') + '><span>' + s + '</span></label>'; }).join('') + '</div></div>' +
      '<div class="box"><div class="grid-info">' + info('Khách', o.name) + info('Điện thoại', fPhone(o.phone)) + info('Thời gian', fDateTime(o.time) + ' ' + vnDate(o.time).y) + info('Thanh toán', o.payment) +
      info('Địa chỉ', [o.address, o.ward, o.province].filter(Boolean).join(', '), true) + (o.email ? info('Email', o.email, true) : '') + info('Nguồn', o.source || '–', true) + '</div>' +
      (lvl() >= 2 ? '<label class="f" style="margin:10px 0 0"><span>Nhân viên bán (tính doanh số)</span><select id="oSeller">' + ownerOptions(o.seller, true) + '</select></label>' : '<p class="small muted" style="margin:8px 0 0">Nhân viên bán: <b>' + esc(o.seller || '–') + '</b></p>') + '</div>' +
      '<div class="box"><h3>Sản phẩm</h3><div class="pre">' + esc(o.items) + '</div>' +
      (o.ship ? '<p style="margin:10px 0 0"><b>Lên đơn:</b> ' + esc(o.ship) + ' <button class="btn ghost" id="oShipCopy" type="button">📋 Copy</button></p>' : '') +
      '<p class="small muted" style="margin:6px 0 0">Loại đơn: <b>' + esc(otLabel(otypeOf(o))) + '</b> · Dòng SP: <b>' + esc(o.line || '–') + '</b> · Nguồn: ' + esc(o.source || '–') + '</p><div class="sum" style="margin-top:10px"><div><span>Tạm tính</span><b>' + money(o.subtotal) + '</b></div><div><span>Phí ship</span><b>' + (o.shipping ? money(o.shipping) : 'Miễn phí') + '</b></div><div class="total"><span>Tổng</span><b>' + money(o.total) + '</b></div></div></div>' +
      '<div class="box"><h3>Thanh toán: ' + esc(o.payment) + ' ' + paidTag(o) + '</h3>' + (isBank(o)
        ? (o.paid ? '<p class="hint" style="margin:0 0 8px">✓ ' + esc(o.paid) + '</p><button class="btn ghost" id="oPaid">↩ Bỏ đánh dấu đã nhận tiền</button>'
          : '<p class="hint" style="margin:0 0 8px">Mở tài khoản VCB, thấy tiền về (nội dung có mã <b>' + esc(o.id) + '</b>, đúng ' + money(o.total) + ') thì mới bấm.</p><button class="btn pri" id="oPaid">💳 Xác nhận đã nhận tiền</button>')
        : '<p class="muted" style="margin:0">Khách trả tiền khi nhận hàng (COD).</p>') + '</div>' +
      '<div class="box"><h3>Vận chuyển</h3><div class="row2c"><label class="f"><span>Đơn vị vận chuyển</span><select id="oCarrier"><option value="">– Chọn –</option>' +
      Object.keys(CARRIERS).map(function (k) { return '<option' + (k === o.carrier ? ' selected' : '') + '>' + esc(k) + '</option>'; }).join('') + '</select></label>' +
      '<label class="f"><span>Mã vận đơn</span><input type="text" id="oTrack" value="' + esc(o.tracking) + '" autocomplete="off"></label></div>' +
      '<div class="steps"><button class="btn" id="oTrackSave">Lưu vận đơn</button>' + (o.tracking ? '<button class="btn" id="oTrackGo">🔎 Tra cứu hành trình</button>' : '') + '</div>' +
      (o.tracking ? '' : '<p class="hint" style="margin:8px 0 0">Nhập mã vận đơn xong, đơn tự chuyển sang “Đang giao”.</p>') + '</div>' +
      '<div class="box"><label class="f" style="margin:0"><span>Ghi chú đơn</span><textarea id="oNote" rows="2">' + esc(o.note) + '</textarea></label><button class="btn" id="oNoteSave" style="margin-top:8px">Lưu ghi chú</button></div>' +
      (logs.length ? '<div class="box"><h3>Lịch sử</h3><div class="timeline">' + logs.map(logItem).join('') + '</div></div>' : '');
    var m = modal('Đơn ' + esc(o.id) + ' ' + stTag(o.status), body, null, { route: '#don-hang', pushed: !fromRoute });
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
    if ($('#oSeller', m)) $('#oSeller', m).onchange = function () {
      var sel = this, v = sel.value, old = o.seller; sel.disabled = true;
      api('order_status', { id: o.id, row: o.row, seller: v }).then(function () { o.seller = v; sel.disabled = false; toast('Đã đổi nhân viên bán: ' + (v || 'chưa ai')); render(); },
        function (e) { sel.value = old; sel.disabled = false; toast(e.message, true); });
    };
    if ($('#oPaid', m)) $('#oPaid', m).onclick = function () {
      var btn = this, paid = !o.paid; btn.disabled = true;
      api('order_status', { id: o.id, row: o.row, paid: paid }).then(function () {
        o.paid = paid ? 'Có – ' + S.user.name + ' ' + fDateTime(Date.now()) : '';
        S.d.log.push({ time: Date.now(), by: S.user.name, what: 'Đơn hàng', ref: o.id, name: o.name, result: paid ? 'Đã nhận tiền chuyển khoản' : 'Bỏ đánh dấu đã nhận tiền', note: '' });
        toast(paid ? 'Đã ghi nhận tiền ✓' : 'Đã bỏ đánh dấu'); closeModal(true); openOrder(o.id, true); render();
      }, function (e) { toast(e.message, true); btn.disabled = false; });
    };
    $('#oTrackSave', m).onclick = function () {
      var btn = this, carrier = $('#oCarrier', m).value, code = $('#oTrack', m).value.trim();
      if (code && !carrier) { toast('Chọn đơn vị vận chuyển giúp em nhé', true); return; }
      btn.disabled = true;
      api('order_status', { id: o.id, row: o.row, carrier: carrier, tracking: code }).then(function (j) {
        o.carrier = carrier; o.tracking = code; if (j.status) o.status = j.status;
        toast('Đã lưu vận đơn' + (j.status === 'Đang giao' ? ' – đơn chuyển sang Đang giao' : '')); closeModal(true); openOrder(o.id, true); navBadges(); render();
      }, function (e) { toast(e.message, true); btn.disabled = false; });
    };
    if ($('#oTrackGo', m)) $('#oTrackGo', m).onclick = function () {
      var u = CARRIERS[o.carrier] || ''; copy(o.tracking);
      if (!u) { toast('Đã copy mã vận đơn ' + o.tracking); return; }
      toast('Đã copy mã ' + o.tracking + (u.indexOf('{c}') < 0 ? ' – dán vào ô tra cứu' : '')); window.open(u.replace('{c}', encodeURIComponent(o.tracking)), '_blank', 'noopener');
    };
    $('#oNoteSave', m).onclick = function () {
      var btn = this, note = $('#oNote', m).value.trim(); btn.disabled = true;
      api('order_status', { id: o.id, row: o.row, note: note }).then(function () { o.note = note; toast('Đã lưu ghi chú'); btn.disabled = false; render(); }, function (e) { toast(e.message, true); btn.disabled = false; });
    };
  }
  function setStatus(o, st, done) {
    if (st === o.status) return;
    var reason = '';
    if (st === 'Huỷ' || st === 'Hoàn' || st === 'Đổi hàng') { reason = prompt('Lý do ' + st.toLowerCase() + ' đơn ' + o.id + '? (không bắt buộc)', ''); if (reason === null) { render(); var r = $('input[name=oSt][value="' + o.status + '"]'); if (r) r.checked = true; return; } }
    var old = o.status; o.status = st; if (st === 'Đang giao' && !o.shipAt) o.shipAt = Date.now(); navBadges(); render(); if (done) done();
    api('order_status', { id: o.id, row: o.row, status: st, reason: reason }).then(function (j) {
      if (j.row) o.row = j.row;
      S.d.log.push({ time: Date.now(), by: S.user.name, what: 'Đơn hàng', ref: o.id, name: o.name, result: old + ' → ' + st, note: reason || '' });
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
  /* ---------- loại đơn (tính hoa hồng). Ưu tiên Lễ → Ngoài giờ → Mới/Cũ; khách để lại số qua quảng cáo / form web / ebook trong 30 ngày = Khách mới dù đã từng mua */
  var OTYPES = ['Khách mới', 'Khách cũ', 'Ngoài giờ', 'Ngày lễ'];
  var OT = { 'Khách mới': ['🆕', 'Lần đầu mua, hoặc vừa để lại số qua quảng cáo'], 'Khách cũ': ['🔁', 'Đã mua trước đó, tự liên hệ lại / được chăm sóc'], 'Ngoài giờ': ['🌙', 'Tối (sau giờ ca tối) hoặc Chủ nhật'], 'Ngày lễ': ['🎉', 'Đơn chốt vào ngày lễ'] };
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
    var c0 = eo ? { phone: eo.phone, name: eo.name, address: eo.address, province: eo.province, ward: eo.ward, consent: eo.consent }
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
    var ot0 = eo ? otypeOf(eo) : '', otField = '<div class="f otype"><span class="lbl">Loại đơn (tính hoa hồng)</span><div class="radios ot4">' + OTYPES.map(function (t) { return '<label><input type="radio" name="otype" value="' + t + '"' + (t === ot0 ? ' checked' : '') + '><span><b>' + OT[t][0] + ' ' + t + '</b><small>' + esc(OT[t][1]) + '</small></span></label>'; }).join('') + '</div><p class="hint" id="noOtHint" style="margin:6px 0 0"></p></div>';
    var body = '<form id="noForm" novalidate>' +
      (lead ? '<div class="notice info">🛒 Chốt đơn cho khách hỏi <b>' + esc(lead.name) + '</b>. Lưu đơn xong, khách tự chuyển sang “Đã chốt”.</div>' : '') +
      (eo ? '<div class="notice">Đang sửa đơn <b>' + esc(eo.id) + '</b>. Lưu xong, số đơn / tổng chi của khách được tính lại.</div>' : '') +
      '<div class="box"><h3>Khách hàng</h3>' +
      (eo ? '' : '<details class="paste"' + (c0 ? '' : ' open') + '><summary>📋 Dán tin nhắn của khách</summary><textarea id="noPaste" rows="3" placeholder="Dán nguyên tin Zalo của khách (tên, số điện thoại, địa chỉ) – CRM tự tách vào các ô dưới"></textarea><p class="hint" id="noPasteHint" style="margin:4px 0 10px"></p></details>') +
      '<div class="row2c"><label class="f"><span>Số điện thoại *</span><input type="tel" name="phone" inputmode="tel" value="' + esc(c0 ? c0.phone : '') + '"></label>' +
      '<label class="f"><span>Tên khách *</span><input type="text" name="name" value="' + esc(c0 ? c0.name : '') + '"></label></div>' +
      '<div class="hint" id="noOld"></div><div id="noFlag"></div>' +
      '<label class="f"><span>Địa chỉ</span><textarea name="full" rows="2" placeholder="Số nhà, đường, phường/xã, tỉnh/thành">' + esc(fullAddr) + '</textarea></label>' +
      '<p class="hint" id="noAddrHint"></p>' +
      '<details class="addr-more"><summary>Sửa tỉnh / phường</summary><div class="row2c"><label class="f"><span>Tỉnh / Thành phố</span><select name="province"><option value="">– Chọn –</option></select></label>' +
      '<label class="f"><span>Phường / Xã</span><input type="text" name="ward" list="noWards" autocomplete="off" value="' + esc(c0 ? c0.ward : '') + '"><datalist id="noWards"></datalist></label></div></details></div>' +
      '<datalist id="noProducts">' + names.map(function (n) { return '<option value="' + esc(n) + '">'; }).join('') + '</datalist>' +
      '<div class="box"><h3>Sản phẩm <span class="muted small" style="font-weight:400">· bấm để thêm, bấm lại để tăng số lượng</span></h3><div class="chips wrap" id="noChips"></div>' +
      '<div class="items" id="noItems">' + (sItems.length ? sItems.map(function (i) { return row('prod', i); }).join('') : row('prod')) + '</div>' +
      '<div class="steps" style="margin-top:8px"><button type="button" class="btn" id="noAdd">＋ Sản phẩm khác</button><button type="button" class="btn" id="noAddGift">🎁 Thêm quà</button></div>' +
      '<div class="items" id="noGifts" style="margin-top:8px">' + sGifts.map(function (i) { return row('gift', i); }).join('') + '</div></div>' +
      '<div class="box">' + otField + '<label class="f"><span>Số tiền thu khách *</span><input type="text" name="total" inputmode="decimal" autocomplete="off" placeholder="vd 1800000 hoặc 1tr8" value="' + (eo ? eo.total : '') + '"></label><p class="hint" id="noTotalHint"></p>' +
      '<div class="f"><span class="lbl">Thanh toán</span><div class="radios"><label><input type="radio" name="payment" value="cod"' + (eo && isBank(eo) ? '' : ' checked') + '><span>COD (trả khi nhận)</span></label><label><input type="radio" name="payment" value="bank"' + (eo && isBank(eo) ? ' checked' : '') + '><span>Chuyển khoản</span></label></div></div>' +
      (eo ? '<label class="f"><span>Lý do sửa (không bắt buộc)</span><input type="text" name="reason" placeholder="vd: khách đổi sang hộp 400g"></label>' : '<label class="f"><span>Ghi chú giao hàng</span><textarea name="note" rows="2" placeholder="vd: giao giờ hành chính, gọi trước khi giao"></textarea></label>') +
      '<details class="addr-more opts" id="noOpts"><summary>⚙️ <span id="noOptSum"></span></summary>' +
      '<label class="f"><span>Phí ship tính riêng (nếu có)</span><input type="number" name="shipping" min="0" step="1000" inputmode="numeric" value="' + (eo ? eo.shipping : 0) + '"></label>' +
      (eo ? '' : (lead ? '' : '<label class="f"><span>Khách đặt qua</span><select name="source">' + SOURCES.map(function (s) { return '<option' + (s === src0 ? ' selected' : '') + '>' + s + '</option>'; }).join('') + '</select></label>') +
        '<div class="f"><span class="lbl">Trạng thái</span><div class="radios"><label><input type="radio" name="status" value="Đã xác nhận" checked><span>Đã chốt với khách</span></label><label><input type="radio" name="status" value="Mới"><span>Chưa xác nhận</span></label></div></div>' +
        '<label class="switch"><input type="checkbox" name="consent"' + (c0 && c0.consent ? ' checked' : '') + '> Khách đồng ý nhận tin ưu đãi</label>') + '</details>' +
      '<p class="hint" style="margin:10px 0 0">📦 <span id="noShip"></span> · <a href="#" id="noCopy">copy</a>' + (eo ? ' · Mã đơn <b>' + esc(eo.id) + '</b>' : '') + '</p></div>' +
      '<p class="err" id="noErr"></p></form>';
    var m = modal(eo ? 'Sửa đơn ' + esc(eo.id) : lead ? 'Chốt đơn: ' + esc(lead.name) : 'Lên đơn mới', body, '<button class="btn" data-close>Huỷ</button><button class="btn pri" id="noSave">Lưu đơn</button>');
    var form = $('#noForm', m), F = form.elements, items = $('#noItems', m), gifts = $('#noGifts', m), prov = F.province, ward = F.ward, totalEdited = !!eo, curC = c0 && !c0.isLead && !eo ? c0 : null;
    loadUnits().then(function (u) {
      prov.innerHTML = '<option value="">– Chọn –</option>' + u.map(function (p) { return '<option>' + esc(p.n) + '</option>'; }).join('');
      if (c0 && c0.province) setProvince(c0.province, c0.ward); else addrChanged();
    });
    function setProvince(pv, wd) {
      var u = S.units || [], hit = u.filter(function (p) { return norm(p.n) === norm(pv) || norm(p.f) === norm(pv); })[0];
      if (!hit && pv && !$$('option', prov).some(function (o) { return o.value === pv; })) prov.insertAdjacentHTML('beforeend', '<option>' + esc(pv) + '</option>');
      prov.value = hit ? hit.n : pv; fillWards(); if (wd !== undefined) ward.value = wd; addrHint();
    }
    function fillWards() { var p = (S.units || []).filter(function (x) { return x.n === prov.value; })[0]; $('#noWards', m).innerHTML = p ? p.w.map(function (w) { return '<option value="' + esc(w) + '">'; }).join('') : ''; }
    function addrHint() { $('#noAddrHint', m).innerHTML = prov.value || ward.value ? '📍 Nhận ra: <b>' + esc([ward.value, prov.value].filter(Boolean).join(', ')) + '</b> (sai thì bấm “Sửa tỉnh / phường”)' : F.full.value.trim() ? '⚠️ Chưa nhận ra tỉnh / phường – bấm “Sửa tỉnh / phường” để chọn.' : ''; }
    function addrChanged() { if (!F.full.value.trim()) { prov.value = ''; ward.value = ''; fillWards(); addrHint(); return; } var d = detectAddr(F.full.value); if (d.province) setProvince(d.province, d.ward || ward.value); else addrHint(); } // xoá địa chỉ → bỏ luôn tỉnh / phường cũ
    prov.onchange = function () { fillWards(); addrHint(); }; ward.addEventListener('input', addrHint);
    F.full.addEventListener('input', function () { clearTimeout(F.full._t); F.full._t = setTimeout(addrChanged, 300); });
    function flagOf(c) { return c && c.flag ? '<div class="notice">⚠️ Khách có nhãn <b>' + esc(c.flag) + '</b>. Kiểm tra kỹ trước khi gửi hàng (nên chuyển khoản trước).</div>' : ''; }
    /* ---- khách cũ: thông tin + nút đặt lại như đơn trước */
    function lastOrder(c) { return c ? ordersOf(c.phone).filter(function (o) { return !/huỷ|hủy|hoàn/i.test(o.status) && parseItems(o.items).length; })[0] : null; }
    function showOld(c) {
      var lo = eo ? null : lastOrder(c), el = $('#noOld', m);
      el.innerHTML = c ? 'Khách cũ: <b>' + esc(c.name) + '</b> · ' + c.orders + ' đơn, ' + money(c.spent) + (lo ? '<button type="button" class="btn sm" id="noRepeat" style="display:block;margin:6px 0 4px">🔁 Đặt lại như đơn ' + fDate(lo.time).slice(0, 5) + ': ' + esc(parseItems(lo.items).filter(function (i) { return !i.gift; }).slice(0, 3).map(function (i) { return i.qty + ' ' + shortLabel(i.name + (i.variant ? ' – ' + i.variant : '')); }).join(', ')) + ' · ' + moneyShort(lo.total) + '</button>' : '') : '';
      $('#noFlag', m).innerHTML = flagOf(c);
      if (lo) $('#noRepeat', m).onclick = function () {
        var its = parseItems(lo.items), ps = its.filter(function (i) { return !i.gift; }), gs = its.filter(function (i) { return i.gift; });
        items.innerHTML = ps.map(function (i) { return row('prod', i); }).join('') || row('prod'); gifts.innerHTML = gs.map(function (i) { return row('gift', i); }).join('');
        F.total.value = lo.total; totalEdited = true; F.shipping.value = lo.shipping || 0;
        var pb = $('input[name=payment][value=' + (isBank(lo) ? 'bank' : 'cod') + ']', form); if (pb) pb.checked = true;
        calc(); toast('Đã điền như đơn ' + fDate(lo.time) + ' – sửa chỗ nào khác rồi lưu');
      };
      renderChips(c);
    }
    function fillFrom(c) {
      if (!F.name.value) F.name.value = c.name;
      if (!F.full.value.trim()) { F.full.value = [c.address, c.ward, c.province].filter(Boolean).join(', '); if (c.province) setProvince(c.province, c.ward); else addrChanged(); }
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
    var shipText = function () { var addr = F.full.value.trim(); return F.name.value.trim() + ' – ' + normPhone(F.phone.value) + '\n' + addr + '\n' + $('#noShip', m).textContent + '\nThu: ' + money(moneyIn(F.total.value)) + ($('input[name=payment]:checked', form).value === 'bank' ? ' (đã chuyển khoản)' : ' (COD)') + (F.note && F.note.value.trim() ? '\nGhi chú: ' + F.note.value.trim() : ''); };
    $('#noCopy', m).onclick = function (e) { e.preventDefault(); copy(shipText()).then(function () { toast('Đã copy nội dung lên đơn'); }); };
    showOld(curC); calc(); otUpdate();
    $('#noSave', m).onclick = function () {
      var err = $('#noErr', m), ph = normPhone(F.phone.value), ls = read(items), gs = read(gifts), tot = moneyIn(F.total.value), ship = Math.max(0, +F.shipping.value || 0);
      if (!/^0\d{9,10}$/.test(ph)) { err.textContent = 'Số điện thoại chưa đúng (10 số, bắt đầu bằng 0).'; F.phone.focus(); return; }
      if (!F.name.value.trim()) { err.textContent = 'Nhập tên khách.'; F.name.focus(); return; }
      if (!ls.length) { err.textContent = 'Nhập ít nhất 1 sản phẩm.'; return; }
      if (!tot) { err.textContent = 'Nhập số tiền thu khách.'; F.total.focus(); return; }
      if (tot < ship) { err.textContent = 'Số tiền thu khách nhỏ hơn phí ship.'; $('#noOpts', m).open = true; return; }
      ls.forEach(function (i) { if (!i.price) i.price = Math.round((tot - ship) / ls.length / i.qty); }); // chưa có giá niêm yết: chia đều, máy tính lại theo tổng
      if (!eo) copy(shipText()); // copy ngay lúc bấm (điện thoại chỉ cho copy khi vừa bấm)
      var btn = this; btn.disabled = true; btn.textContent = 'Đang lưu…'; err.textContent = '';
      var full = F.full.value.trim(), cu = { phone: ph, name: F.name.value.trim(), province: prov.value, ward: ward.value.trim(), address: full };
      var otIn = $('input[name=otype]:checked', form), common = { customer: cu, items: ls, gifts: gs, total: tot, shipping: ship, payment: $('input[name=payment]:checked', form).value, otype: otIn ? otIn.value : undefined }; // máy chủ tính lại gợi ý, khác gợi ý → quản lý kiểm tra
      var fail = function (e) { btn.disabled = false; calc(); err.textContent = e.message; };
      if (eo) {
        common.id = eo.id; common.row = eo.row; common.reason = F.reason.value.trim();
        api('order_edit', common).then(function () { closeModal(true); toast('Đã sửa đơn ' + eo.id + ' ✓'); history.replaceState(null, '', '#don-hang'); load(true); }, fail);
        return;
      }
      cu.note = F.note.value.trim(); common.status = $('input[name=status]:checked', form).value; common.source = F.source ? F.source.value : ''; common.consent = F.consent.checked; var L0 = lead || autoLead; common.leadId = L0 ? L0.id : '';
      if (F.source) store('crm_osrc', F.source.value);
      api('order_create', common).then(function (j) {
        if (L0) { L0.status = 'Đã chốt'; L0.orderId = j.id; L0.callback = null; }
        closeModal(); toast('Đã tạo đơn ' + j.id + ' ✓ · nội dung lên đơn đã copy, dán sang bên vận chuyển'); if (j.oflag) toast('⚠️ Loại đơn khác gợi ý của CRM (' + j.oflag.replace(/^CRM gợi ý /, '') + '). Quản lý sẽ kiểm tra lại.', true); location.hash = '#don-hang'; load(true);
      }, fail);
    };
  }
  function slugName(n) { var s = norm(n || 'NV').split(/\s+/).pop() || 'nv'; return s.charAt(0).toUpperCase() + s.slice(1); }

  /* ================================================================ KHÁCH TIỀM NĂNG (hỏi mua nhưng chưa mua) */
  function leadDays(l) { var t = l.lastAt || l.time; return t ? Math.max(0, Math.round((today() - dayStart(t)) / DAY)) : 0; }
  function leadTag(l) { return '<span class="tag ' + (LEAD_CLS[l.status] || '') + '">' + esc(l.status) + '</span>'; }
  function leadAge(l) {
    if (l.status === 'Đã chốt') return '<span class="age ok">🛒 Đã chốt đơn' + (l.orderId ? ' ' + esc(l.orderId) : '') + '</span>';
    if (l.status === 'Không mua') return '<span class="age-miss">✕ Không mua' + (l.reason ? ': ' + esc(l.reason) : '') + '</span>';
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
  function lastNote(l) { var n = String(l.note || '').trim().split('\n').filter(Boolean); return n.length ? n[n.length - 1].replace(/^\[[^\]]*\]\s*/, '') : ''; }
  function leadCard(l) {
    var open = isOpenLead(l), due = leadDueLine(l), note = lastNote(l);
    return '<div class="card click" data-lead="' + esc(l.id) + '">' +
      '<div class="r1"><b>' + esc(l.name || 'Khách') + '</b>' + leadTag(l) + (l.owner ? (lvl() >= 2 || l.owner !== S.user.name ? '<span class="tag owner">👤 ' + esc(l.owner) + '</span>' : '') : '<span class="tag noconsent">Chưa ai phụ trách</span>') + '<span class="end small muted">' + esc(l.channel) + '</span></div>' +
      '<div class="r2">' + fPhone(l.phone) + (leadProv(l) ? ' · 📍 ' + esc(leadProv(l).old) : '') + (l.interest ? ' · Quan tâm: ' + esc(l.interest) : '') + '</div>' +
      '<div class="r-age">' + leadAge(l) + (cust(l.phone) ? '<span class="age-miss">👤 Đã là khách hàng</span>' : '') + '</div>' +
      (due || note ? '<div class="r3">' + due + (due && note ? '<br>' : '') + (note ? '📝 ' + esc(note.length > 90 ? note.slice(0, 90) + '…' : note) : '') + '</div>' : '') +
      (open ? '<div class="acts"><button class="btn pri" data-consult="' + esc(l.id) + '">💬 Tư vấn</button><a class="btn" href="tel:' + l.phone + '">📞 Gọi</a><button class="btn" data-leadorder="' + esc(l.id) + '">🛒 Chốt đơn</button>' + (!l.owner && isPoolStaff() ? claimBtn('l', l.id) : '') + '</div>' : '') +
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
    { k: 'Mới hỏi', l: 'Mới hỏi', f: function (l) { return l.status === 'Mới hỏi'; } },
    { k: 'Đang tư vấn', l: 'Đang tư vấn', f: function (l) { return l.status === 'Đang tư vấn'; } },
    { k: 'Đã chốt', l: 'Đã chốt', f: function (l) { return l.status === 'Đã chốt'; } },
    { k: 'Không mua', l: 'Không mua', f: function (l) { return l.status === 'Không mua'; } },
    { k: 'all', l: 'Tất cả', f: function () { return true; } }
  ];
  function leadChannels() { var n = {}; (S.d.leads || []).forEach(function (l) { var k = l.channel || 'Khác'; n[k] = (n[k] || 0) + 1; }); return Object.keys(n).sort(function (a, b) { return n[b] - n[a]; }); }
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
  function provNames() { var o = {}; Object.keys(PROV_MERGE).forEach(function (nw) { o[nw] = 1; PROV_MERGE[nw].forEach(function (x) { if (!/^(HCM|TPHCM|TP HCM|HN|HP|Kontum|Daklak|Đaklak|Đăk .*|Dak .*|Bắc Cạn)$/.test(x)) o[x] = 1; }); }); return Object.keys(o).sort(function (a, b) { return a.localeCompare(b, 'vi'); }); }
  function viewLeads() {
    var f = S.f.t || (S.f.t = { q: '', k: 'due', n: 60 });
    var q = norm(f.q), qd = q.replace(/\D/g, ''), words = qWords(q), chs = leadChannels(); if (f.ch && chs.indexOf(f.ch) < 0) f.ch = '';
    var base = (S.d.leads || []).filter(function (l) { return (!f.ch || (l.channel || 'Khác') === f.ch) && (!q || leadHit(l, words) || (qd.length >= 3 && l.phone.indexOf(qd) >= 0)); });
    var cur = LF.filter(function (x) { return x.k === f.k; })[0] || LF[0], list = sortLeads(base.filter(cur.f));
    return '<div class="page-head"><h1>Khách hỏi</h1><span class="muted">người hỏi mua nhưng chưa mua</span><div class="grow"></div><button class="btn pri" data-newlead>＋ Thêm khách hỏi</button></div>' +
      '<div class="tools"><div class="search">' + I.search + '<input type="search" id="tq" placeholder="Tìm tên, SĐT, tỉnh, sản phẩm quan tâm…" value="' + esc(f.q) + '"></div>' +
        '<select id="tch" class="' + (f.ch ? 'on' : '') + '" style="flex:0 0 auto;width:auto" title="Lọc theo kênh khách hỏi"><option value="">📣 Mọi kênh</option>' + chs.map(function (x) { return '<option' + (f.ch === x ? ' selected' : '') + '>' + esc(x) + '</option>'; }).join('') + '</select></div>' +
      '<div class="chips">' + LF.map(function (x) { return '<button class="chip' + (x.k === f.k ? ' on' : '') + '" data-tf="' + esc(x.k) + '">' + x.l + ' <em>' + base.filter(x.f).length + '</em></button>'; }).join('') + '</div>' +
      areaBox(q, 'lead') + crossHint(q, qd, false) +
      (list.length ? '<div class="list cols">' + list.slice(0, f.n).map(leadCard).join('') + '</div>' +
        (list.length > f.n ? '<button class="btn more" data-more="t">Xem thêm ' + Math.min(60, list.length - f.n) + ' khách</button>' : '')
        : empty(f.k === 'due' ? 'Không có khách hỏi cần liên hệ 🎉' : 'Chưa có khách nào ở mục này.'));
  }

  function openLead(id, fromRoute) {
    var l = findLead(id); if (!l) return;
    if (!fromRoute) history.pushState(null, '', '#tiem-nang/' + encodeURIComponent(l.id));
    var c = cust(l.phone), open = isOpenLead(l);
    var logs = logOf(l.phone).filter(function (x) { return x.what === 'Tư vấn' || x.what === 'Thêm tiềm năng'; });
    var body = '<div class="acts steps" style="margin-bottom:12px">' + (open ? '<button class="btn pri" data-consult="' + esc(l.id) + '">💬 Tư vấn</button>' : '') +
      '<a class="btn" href="tel:' + l.phone + '">📞 Gọi</a><a class="btn zalo" href="' + zalo(l.phone) + '" target="_blank" rel="noopener">Zalo</a>' +
      (open ? '<button class="btn" data-leadorder="' + esc(l.id) + '">🛒 Chốt đơn</button>' : '') + '<button class="btn" data-editlead="' + esc(l.id) + '">✏️ Sửa</button></div>' +
      (c ? '<div class="notice info">👤 Số này đã là khách hàng: <b>' + esc(c.name) + '</b> · ' + c.orders + ' đơn, ' + money(c.spent) + ' <button class="btn" data-cust="' + c.phone + '" style="margin-left:6px">Xem khách</button></div>' : '') + (leadProv(l) ? areaBox(norm(leadProv(l).old), 'lead') : '') +
      (open && leadDueLine(l) ? '<div class="notice">' + leadDueLine(l) + '</div>' : '') +
      '<div class="r-age" style="margin:0 0 12px">' + leadAge(l) + '</div>' +
      '<div class="box"><div class="grid-info">' + info('Điện thoại', fPhone(l.phone)) + info('Trạng thái', l.status) + info('Kênh', l.channel) + info('Quan tâm', l.interest || '–') +
      info('Phụ trách', l.owner || '– Chưa ai –') + info('Ngày hỏi', fDate(l.time)) + info('Lần liên hệ gần nhất', l.lastAt ? fDate(l.lastAt) + ' (' + daysAgo(l.lastAt) + ')' : 'chưa liên hệ') +
      info('Hẹn liên hệ lại', l.callback ? fDate(l.callback) : '–') + (l.reason ? info('Lý do không mua', l.reason, true) : '') + (l.orderId ? info('Mã đơn', l.orderId, true) : '') + '</div></div>' +
      '<div class="box"><h3>Ghi chú</h3><div class="pre">' + (l.note ? esc(l.note) : '<span class="muted">Chưa có ghi chú.</span>') + '</div></div>' +
      '<div class="box"><h3>Lịch sử tư vấn (' + logs.length + ')</h3>' + (logs.length ? '<div class="timeline">' + logs.map(logItem).join('') + '</div>' : '<p class="muted">Chưa có.</p>') + '</div>';
    modal(esc(l.name || 'Khách hỏi') + ' ' + leadTag(l), body, null, { route: '#tiem-nang', pushed: !fromRoute });
  }

  function ownerOptions(sel, withEmpty) {
    var names = userNames(); if (sel && names.indexOf(sel) < 0) names.push(sel);
    return (withEmpty ? '<option value="">– Chưa ai –</option>' : '') + names.map(function (n) { return '<option' + (n === sel ? ' selected' : '') + '>' + esc(n) + '</option>'; }).join('');
  }
  function productNames() { var seen = {}; return (CFG.products || []).map(function (p) { return p.name; }).filter(function (n) { if (seen[n]) return false; seen[n] = 1; return true; }); }

  /** Thêm mới hoặc sửa thông tin khách hỏi. */
  function openLeadForm(l) {
    var edit = !!l; l = l || { name: '', phone: '', channel: 'Facebook', interest: '', owner: S.user.name, note: '', callback: null, status: 'Mới hỏi', reason: '' };
    var body = '<form id="lfForm" novalidate><div class="box">' +
      '<div class="row2c"><label class="f"><span>Số điện thoại *</span><input type="tel" name="phone" inputmode="tel" value="' + esc(l.phone) + '"></label>' +
      '<label class="f"><span>Tên khách</span><input type="text" name="name" value="' + esc(l.name) + '" placeholder="vd: Chị Lan"></label></div><p class="hint" id="lfHint"></p>' +
      '<div class="row2c"><label class="f"><span>Khách đến từ đâu</span><select name="channel">' + CHANNELS.map(function (c) { return '<option' + (c === l.channel ? ' selected' : '') + '>' + c + '</option>'; }).join('') + '</select></label>' +
      '<label class="f"><span>Quan tâm sản phẩm</span><input type="text" name="interest" list="lfProducts" value="' + esc(l.interest) + '" placeholder="Chọn hoặc gõ"><datalist id="lfProducts">' + productNames().map(function (n) { return '<option value="' + esc(n) + '">'; }).join('') + '</datalist></label></div>' +
      '<div class="row2c">' + (lvl() >= 2 ? '<label class="f"><span>Người phụ trách</span><select name="owner">' + ownerOptions(l.owner, true) + '</select></label>' : '<div class="f"><span style="display:block;font-size:13px;font-weight:600;color:var(--ink);margin-bottom:4px">Người phụ trách</span><b>' + esc(l.owner || S.user.name) + '</b></div>') +
      '<label class="f"><span>Hẹn liên hệ lại ngày</span><input type="date" name="callback" value="' + (l.callback ? isoDate(l.callback) : '') + '"></label></div>' +
      (edit ? '<div class="row2c"><label class="f"><span>Trạng thái</span><select name="status">' + LEAD_ST.map(function (s) { return '<option' + (s === l.status ? ' selected' : '') + '>' + s + '</option>'; }).join('') + '</select></label>' +
        '<label class="f"><span>Lý do không mua</span><input type="text" name="reason" list="lfReasons" value="' + esc(l.reason) + '"><datalist id="lfReasons">' + LOST_REASONS.map(function (r) { return '<option value="' + r + '">'; }).join('') + '</datalist></label></div>' : '') +
      '<label class="f"><span>' + (edit ? 'Ghi chú' : 'Khách hỏi gì / cần gì') + '</span><textarea name="note" rows="' + (edit ? 5 : 3) + '">' + esc(l.note) + '</textarea></label>' +
      '<p class="err" id="lfErr"></p></div></form>';
    var m = modal(edit ? 'Sửa: ' + esc(l.name) : 'Thêm khách hỏi', body, '<button class="btn" data-close>Huỷ</button><button class="btn pri" id="lfSave">Lưu</button>');
    var F = $('#lfForm', m).elements, hint = $('#lfHint', m);
    function check() {
      var ph = normPhone(F.phone.value), c = cust(ph), ol = (S.d.leads || []).filter(function (x) { return x.phone === ph && isOpenLead(x) && x.id !== l.id; })[0];
      hint.innerHTML = c ? '👤 Số này đã là khách hàng: <b>' + esc(c.name) + '</b> (' + c.orders + ' đơn).' : ol ? 'Số này đang có trong danh sách khách hỏi (' + esc(ol.status) + ', ' + esc(ol.owner || 'chưa ai phụ trách') + '). Lưu sẽ ghi nối vào đó, không tạo trùng.' : '';
      if (c && !F.name.value) F.name.value = c.name;
      if (!c && !ol && lvl() < 2) checkPhone(ph, function (r) { if (r && r.status === 'other') hint.innerHTML = ownerWarn(r); });
    }
    F.phone.addEventListener('input', check); if (!edit) setTimeout(function () { F.phone.focus(); }, 60);
    $('#lfSave', m).onclick = function () {
      var err = $('#lfErr', m), ph = normPhone(F.phone.value);
      if (!/^0\d{9,10}$/.test(ph)) { err.textContent = 'Số điện thoại chưa đúng (10 số, bắt đầu bằng 0).'; F.phone.focus(); return; }
      var p = { id: edit ? l.id : '', phone: ph, name: F.name.value.trim() || 'Khách ' + ph.slice(-4), channel: F.channel.value, interest: F.interest.value.trim(), owner: F.owner ? F.owner.value : S.user.name, callback: F.callback.value, note: F.note.value.trim() };
      if (edit) { p.status = F.status.value; p.reason = F.reason.value.trim(); if (p.status === 'Không mua' && !p.reason) { err.textContent = 'Ghi lý do khách không mua giúp em nhé.'; return; } }
      var btn = this; btn.disabled = true; btn.textContent = 'Đang lưu…';
      api('lead_save', p).then(function (j) {
        closeModal(true); if (edit) history.replaceState(null, '', '#tiem-nang');
        toast(j.merged ? 'Số này đã có – đã ghi nối vào khách cũ ✓' : 'Đã lưu ✓');
        if (!edit && location.hash.indexOf('#tiem-nang') !== 0 && location.hash.indexOf('#hom-nay') !== 0) location.hash = '#tiem-nang';
        load(true);
      }, function (e) { btn.disabled = false; btn.textContent = 'Lưu'; err.textContent = e.message; });
    };
  }

  /** Tư vấn: gửi tin mẫu → ghi kết quả → (chốt đơn / không mua / hẹn lần sau). */
  function openConsult(id) {
    var l = findLead(id); if (!l) return;
    var tp = S.d.templates, ti = -1;
    if (!l.lastAt) tp.forEach(function (t, i) { if (ti < 0 && norm(t[0]).indexOf('khach moi hoi') >= 0) ti = i; });
    var fill = function (text) { return fillTpl(text, { name: l.name, products: [l.interest || 'sản phẩm bên em'] }); };
    var body = '<div class="box"><div style="display:flex;gap:8px;align-items:center;flex-wrap:wrap"><b>' + esc(l.name) + '</b> ' + leadTag(l) + ' <span class="muted">' + fPhone(l.phone) + ' · ' + esc(l.channel) + '</span></div>' +
      '<div class="small muted" style="margin-top:4px">' + (l.interest ? 'Quan tâm: ' + esc(l.interest) + ' · ' : '') + 'hỏi ' + daysAgo(l.time) + (lastNote(l) ? '<br>📝 ' + esc(lastNote(l)) : '') + '</div></div>' +
      '<div class="box"><label class="f" style="margin:0"><span>📍 Khách ở tỉnh nào? <em class="muted" style="font-style:normal;font-weight:400">(hỏi khách rồi gõ, máy cho biết bên mình đã có bao nhiêu khách ở đó)</em></span><input type="text" id="cProv" list="cProvs" autocomplete="off" placeholder="vd Nghệ An" value="' + esc(leadProv(l) ? leadProv(l).old : '') + '"><datalist id="cProvs">' + provNames().map(function (n) { return '<option value="' + esc(n) + '">'; }).join('') + '</datalist></label><div id="cArea" style="margin-top:8px"></div></div>' +
      '<div class="box"><h3>Bước 1 · Nhắn / gọi cho khách</h3>' +
      '<label class="f"><span>Mẫu tin</span><select id="cTpl"><option value="-1">– Tự viết –</option>' + tp.map(function (t, i) { return '<option value="' + i + '"' + (i === ti ? ' selected' : '') + '>' + esc(t[0] + (t[1] ? ' – ' + t[1] : '')) + '</option>'; }).join('') + '</select></label>' +
      '<label class="f"><span>Nội dung (sửa được)</span><textarea id="cMsg" rows="5">' + esc(ti >= 0 ? fill(tp[ti][2]) : '') + '</textarea></label>' +
      '<div class="steps"><button class="btn zalo" id="cZalo">📋 Copy tin & mở Zalo</button><a class="btn" href="tel:' + l.phone + '">📞 Gọi</a></div></div>' +
      '<div class="box"><h3>Bước 2 · Kết quả</h3><div class="radios" style="margin-bottom:12px">' + LEAD_RESULTS.map(function (r) { return '<label><input type="radio" name="cRes" value="' + esc(r.v) + '"><span>' + esc(r.v) + '</span></label>'; }).join('') + '</div>' +
      '<div id="cLost" hidden><label class="f"><span>Lý do không mua *</span><select id="cReason"><option value="">– Chọn –</option>' + LOST_REASONS.map(function (r) { return '<option>' + r + '</option>'; }).join('') + '</select></label></div>' +
      '<p class="notice info" id="cClose" hidden>Bấm <b>Lưu</b> → mở ngay form tạo đơn cho khách.</p>' +
      '<label class="f" id="cCbWrap"><span>Hẹn liên hệ lại ngày</span><input type="date" id="cCb" min="' + isoDate(Date.now()) + '"></label>' +
      '<label class="f"><span>Ghi chú lần này</span><textarea id="cNote" rows="2" placeholder="Khách nói gì, băn khoăn gì…"></textarea></label><p class="err" id="cErr"></p></div>';
    var m = modal('Tư vấn: ' + esc(l.name), body, '<button class="btn" data-close>Để sau</button><button class="btn pri" id="cSave">Lưu</button>');
    var msg = $('#cMsg', m);
    $('#cTpl', m).onchange = function () { var i = +this.value; msg.value = i >= 0 ? fill(tp[i][2]) : ''; };
    $('#cZalo', m).onclick = function () { copy(msg.value).then(function () { toast('Đã copy – dán vào khung chat Zalo'); }); window.open(zalo(l.phone), '_blank', 'noopener'); };
    var provIn = $('#cProv', m), showArea = function () { var v = provIn.value.trim(), pv = v && provOf({ address: v }); $('#cArea', m).innerHTML = pv ? areaBox(norm(pv.old), 'consult') : v.length >= 3 ? '<p class="small muted" style="margin:0">Chưa nhận ra tỉnh – chọn trong danh sách gợi ý nhé.</p>' : ''; };
    provIn.oninput = showArea; showArea();
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
        l.status = j.status; l.lastAt = j.at; l.owner = j.owner || l.owner; l.callback = p.callback ? new Date(p.callback + 'T09:00:00+07:00').getTime() : null;
        if (o.lost) l.reason = reason;
        if (p.note) l.note = (l.note ? l.note + '\n' : '') + '[' + fDate(j.at).slice(0, 5) + ' ' + S.user.name + '] ' + p.note;
        S.d.log.push({ time: j.at, by: S.user.name, what: 'Tư vấn', ref: l.phone, name: l.name, result: o.v, note: p.note });
        closeModal(true); if (route().id) history.replaceState(null, '', '#' + route().view);
        navBadges(); render();
        if (o.close) openOrderForm({ lead: l }); else toast('Đã lưu ✓');
      }, function (e) { btn.disabled = false; btn.textContent = 'Lưu'; err.textContent = e.message; });
    };
  }

  /* ================================================================ HIỆU QUẢ (nhân viên xem của mình, quản lý xem thêm cả nhóm) */
  function careWhat() { if (!CARE_WHAT) { CARE_WHAT = {}; Object.keys(TASK_LOG).forEach(function (k) { CARE_WHAT[TASK_LOG[k]] = 1; }); } return CARE_WHAT; }
  function monthOf(t) { var x = vnDate(t); return x.y + '-' + pad(x.m); }
  function monthRange(key) { var y = +key.slice(0, 4), m = +key.slice(5, 7); return [Date.UTC(y, m - 1, 1) - 7 * 3600e3, Date.UTC(y, m, 1) - 7 * 3600e3]; }
  function shiftMonth(key, n) { var y = +key.slice(0, 4), m = +key.slice(5, 7) - 1 + n; y += Math.floor(m / 12); m = ((m % 12) + 12) % 12; return y + '-' + pad(m + 1); }
  function monthLabel(key) { return 'tháng ' + (+key.slice(5, 7)) + '/' + key.slice(0, 4); }
  function targetOf(name, month) { return (S.d.targets || []).filter(function (t) { return t.name === name && t.month === month; })[0] || null; }
  function teamTarget(month) { var s = 0; (S.d.targets || []).forEach(function (t) { if (t.month === month) s += t.amount; }); return s; }
  function pct(a, b) { return b ? Math.round(a * 100 / b) : 0; }

  /* ---------------- Bộ lọc thời gian dùng chung: Hôm nay / Hôm qua / 7 ngày qua / Tháng này / Tháng trước / Tuỳ chỉnh */
  var PER = [['today', 'Hôm nay'], ['yday', 'Hôm qua'], ['d7', '7 ngày qua'], ['month', 'Tháng này'], ['lmonth', 'Tháng trước']];
  /** Khoảng [từ, đến) theo giờ VN của 1 lựa chọn thời gian p = { k, from, to }. */
  function perRange(p) {
    var t0 = today(), mk = monthOf(Date.now());
    switch (p && p.k) {
      case 'all': return [0, Infinity];
      case 'today': return [t0, t0 + DAY];
      case 'yday': return [t0 - DAY, t0];
      case 'd7': return [t0 - 6 * DAY, t0 + DAY];
      case 'lmonth': return monthRange(shiftMonth(mk, -1));
      case 'custom': return [p.from, p.to];
      default: return monthRange(mk);
    }
  }
  function perDates(R) { if (!R[0] && R[1] === Infinity) return ''; var a = fDate(R[0]), b = fDate(R[1] - 1); return a === b ? a : a.slice(0, 5) + ' – ' + b; }
  function perLabel(p) { if (p.k === 'all') return 'Mọi lúc'; if (p.k === 'custom') return perDates(perRange(p)); var x = PER.filter(function (z) { return z[0] === p.k; })[0]; return x ? x[1] : 'Tháng này'; }
  /** Nút mở bộ lọc thời gian. slot = khoá trong S.f (r: Hiệu quả, o: Đơn hàng). */
  function perBtn(slot, p) {
    var R = perRange(p), d = p.k === 'custom' ? '' : perDates(R);
    return '<div class="per-row"><button type="button" class="per-btn" data-per="' + slot + '">📅 <b>' + esc(perLabel(p)) + '</b>' + (d ? '<span>' + d + '</span>' : '') + ' ▾</button></div>';
  }
  function openPer(slot) {
    var f = S.f[slot], p = f.p || { k: 'month' }, withAll = slot === 'o', R = p.k === 'custom' ? perRange(p) : null;
    var opts = (withAll ? [['all', 'Mọi lúc']] : []).concat(PER);
    var body = '<div class="per-list">' + opts.map(function (o) { return '<button type="button" data-pk="' + o[0] + '"' + (p.k === o[0] ? ' class="on"' : '') + '>' + o[1] + '</button>'; }).join('') +
      '<button type="button" class="per-cus' + (p.k === 'custom' ? ' on' : '') + '" id="perCus">Tuỳ chỉnh</button></div>' +
      '<div class="per-custom' + (p.k === 'custom' ? ' show' : '') + '" id="perBox"><div class="row2c"><label class="f"><span>Từ ngày</span><input type="date" id="perFrom" value="' + (R ? isoDate(R[0]) : isoDate(today() - 6 * DAY)) + '" max="' + isoDate(Date.now()) + '"></label>' +
      '<label class="f"><span>Đến ngày</span><input type="date" id="perTo" value="' + (R ? isoDate(R[1] - 1) : isoDate(Date.now())) + '"></label></div><p class="err" id="perErr"></p><button type="button" class="btn pri" id="perOk" style="width:100%">Áp dụng</button></div>';
    var m = modal('Thời gian', body, '<button class="btn per-back" data-close>Quay lại</button>');
    var set = function (np) { f.p = np; if (slot === 'o') f.n = 60; closeModal(); render(); };
    $$('[data-pk]', m).forEach(function (b) { b.onclick = function () { set({ k: b.getAttribute('data-pk') }); }; });
    $('#perCus', m).onclick = function () { $('#perBox', m).classList.add('show'); $('#perFrom', m).focus(); };
    $('#perOk', m).onclick = function () {
      var a = $('#perFrom', m).value, b = $('#perTo', m).value, err = $('#perErr', m);
      if (!a || !b) { err.textContent = 'Chọn đủ ngày bắt đầu và ngày kết thúc giúp em nhé.'; return; }
      var from = dayStart(new Date(a + 'T12:00:00+07:00').getTime()), to = dayStart(new Date(b + 'T12:00:00+07:00').getTime()) + DAY;
      if (to <= from) { err.textContent = 'Ngày kết thúc phải sau ngày bắt đầu.'; return; }
      set({ k: 'custom', from: from, to: to });
    };
  }

  /** Số liệu của 1 nhân viên (name) hoặc cả nhóm (name = null) trong khoảng thời gian R. */
  function careMetrics(c, p, me) {
    return '<section class="section"><div class="section-h"><h2>💬 Chăm sóc khách</h2></div><div class="metrics">' +
      metric('Lượt chăm sóc', c.care, (c.replyPct === null ? 'Chưa có lượt nào.' : 'Kết nối được ' + c.replyPct + '% (' + c.replied + '/' + c.care + ' lượt khách nghe máy / trả lời).'), delta(c.care, p.care)) +
      metric('Chăm sóc ra đơn', c.convPct === null ? '–' : c.convPct + '%', c.conv + ' / ' + c.contacted + ' khách được chăm sóc đã mua trong 14 ngày sau đó · ' + moneyShort(c.convRev) + '. Số này cho biết chăm sóc có ra tiền không.', c.convPct === null ? '' : delta(c.convPct, p.convPct, 'rate')) +
      metric('Khách quay lại mua', c.repeat, 'Số khách cũ đã mua lại trong thời gian đã chọn.', delta(c.repeat, p.repeat)) +
      metric('Tỷ lệ hoàn đơn', c.backPct === null ? '–' : c.backPct + '%', c.backN + ' đơn hoàn · ' + moneyShort(c.backV) + '. Gọi xác nhận kỹ trước khi gửi, đơn lớn nên nhờ chuyển khoản trước.', c.backPct === null ? '' : delta(c.backPct, p.backPct, 'rate')) +
      (function () { var cs = S.d.customers.filter(function (x) { return x.orders && !coldOf(x) && (!me || x.owner === S.user.name); }), inN = cs.filter(inComm).length, invN = cs.filter(invited).length;
        return metric('Khách trong nhóm cộng đồng', cs.length ? pct(inN, cs.length) + '%' : '–', inN + ' / ' + cs.length + ' khách đã vào nhóm Zalo “Sống khỏe cùng Thực Dưỡng Lành”' + (invN ? ' · ' + invN + ' khách đã mời, chưa vào' : '') + '. Mời ở mốc hỏi nhận hàng / hỏi thăm 1 tuần, hoặc lọc 👥 Chưa vào cộng đồng.', ''); })() +
      metric('VIP sắp mất chưa gọi', c.vipRisk, (c.vipRisk ? 'Khách VIP 61–180 ngày chưa mua và hơn 30 ngày chưa nói chuyện. Nên gọi trước tiên.' : 'Tốt lắm, khách VIP đều được chăm sóc.'), '', me && c.vipRisk ? '#khach-hang" data-vipgo="1' : '') +
      '</div></section>';
  }
  /** Danh sách thanh ngang (xếp hạng): 1 màu, đầu thanh bo 4px, số ghi cạnh thanh, rê chuột xem chi tiết. */
  function barList(items, fmt, empt) {
    if (!items.length) return '<p class="muted">' + (empt || 'Chưa có số liệu.') + '</p>';
    var mx = Math.max.apply(null, items.map(function (x) { return x.v; })) || 1;
    return '<div class="bars" role="table">' + items.map(function (x) {
      return '<div class="bar-r' + (x.muted ? ' mut' : '') + '" role="row" title="' + esc(x.tip || '') + '"><span class="bar-l" role="cell">' + esc(x.l) + '</span><span class="bar-t" role="cell"><i style="width:' + Math.max(1.5, x.v * 100 / mx) + '%"></i></span><span class="bar-v" role="cell">' + fmt(x.v) + (x.sub ? '<small>' + esc(x.sub) + '</small>' : '') + '</span></div>' +
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
      '<div class="chips">' + chip('pvs', 'all', 'Tất cả khách') + chip('pvs', 'new', 'Khách mới ' + cx.label.toLowerCase()) + chip('pvm', 'cnt', 'Số khách') + chip('pvm', 'rev', 'Doanh thu') + '</div>' +
      '<div class="box">' + barList(top, fmt, 'Chưa có khách nào trong phạm vi này.') + (rows.length ? '<p class="small muted" style="margin:8px 0 0">Nhiều nhất: <b>' + esc(rows[0].l) + '</b> (' + pct(rows[0].v, rows.reduce(function (s0, x) { return s0 + x.v; }, 0) + none.v) + '% ' + (by === 'rev' ? 'doanh thu' : 'khách') + '). Dùng để chọn vùng chạy quảng cáo, giờ gọi và đơn vị vận chuyển phù hợp.</p>' : '') + '</div></section>';
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
  function perf(name, R) {
    var CW = careWhat(), inR = function (t) { return t && t >= R[0] && t < R[1]; }, me = function (n) { return name === null || n === name; };
    var os = S.d.orders.filter(function (o) { return !isVoid(o.status) && inR(o.time) && me(o.seller); });
    var sales = os.reduce(function (s, o) { return s + o.total; }, 0);
    var old = os.filter(function (o) { var c = cust(o.phone); return c && c.first && c.first < o.time - 3600e3; });
    var oldRev = old.reduce(function (s, o) { return s + o.total; }, 0);
    var leads = (S.d.leads || []).filter(function (l) { return me(l.owner); });
    var won = leads.filter(function (l) { return l.status === 'Đã chốt' && inR(l.lastAt); }).length, lost = leads.filter(function (l) { return l.status === 'Không mua' && inR(l.lastAt); }).length;
    var care = S.d.log.filter(function (l) { return CW[l.what] && me(l.by) && inR(l.time); });
    var replied = care.filter(function (l) { return l.result && l.result !== NO_REPLY; }).length;
    var mine = S.d.customers.filter(function (c) { return name === null ? true : c.owner === name; }); // (dùng cho khách VIP sắp mất)
    // chăm sóc ra đơn: khách được chăm sóc trong kỳ rồi có đơn trong 14 ngày sau lần chăm sóc đầu tiên
    var firstCare = {}; care.forEach(function (l) { var ph = String(l.ref).replace(/^'/, ''); if (!firstCare[ph] || l.time < firstCare[ph]) firstCare[ph] = l.time; });
    var conv = 0, convRev = 0; Object.keys(firstCare).forEach(function (ph) { var t = firstCare[ph], hit = S.d.orders.filter(function (o) { return o.phone === ph && !isVoid(o.status) && o.time > t && o.time <= t + 14 * DAY; }); if (hit.length) { conv++; convRev += hit.reduce(function (s0, o) { return s0 + o.total; }, 0); } });
    var allOs = S.d.orders.filter(function (o) { return inR(o.time) && me(o.seller) && o.status !== 'Huỷ'; }), back = allOs.filter(function (o) { return /hoàn/i.test(o.status); });
    var repeat = {}; old.forEach(function (o) { repeat[o.phone] = 1; });
    var vipRisk = mine.filter(function (c) { return isVip(c) && stageOf(c) === 'risk' && !coldOf(c) && replyOf(c).days > 30; }).length;
    return { contacted: Object.keys(firstCare).length, conv: conv, convRev: convRev, convPct: Object.keys(firstCare).length ? pct(conv, Object.keys(firstCare).length) : null, backN: back.length, backPct: allOs.length ? pct(back.length, allOs.length) : null, backV: back.reduce(function (s0, o) { return s0 + o.total; }, 0), repeat: Object.keys(repeat).length, vipRisk: vipRisk,
      sales: sales, orders: os.length, avg: os.length ? Math.round(sales / os.length) : 0, oldRev: oldRev, oldPct: pct(oldRev, sales), won: won, lost: lost, closePct: won + lost ? pct(won, won + lost) : null,
      care: care.length, replied: replied, replyPct: care.length ? pct(replied, care.length) : null, reorder: care.filter(function (l) { return l.result === 'Đã đặt lại'; }).length,
      stale: mine.filter(function (c) { return replyOf(c).days > 30; }).length, mine: mine.length };
  }
  /** Kỳ so sánh: tháng đang chạy → cùng số ngày của tháng trước (1–2/10 so với 1–2/9), tháng đã qua → cả tháng trước. */
  var CMP_LABEL = 'tháng trước';
  function prevRange(month) { var P = monthRange(shiftMonth(month, -1)), R = monthRange(month), now = Date.now(), part = now >= R[0] && now < R[1]; CMP_LABEL = part ? 'cùng kỳ tháng trước' : 'tháng trước'; return part ? [P[0], Math.min(P[1], P[0] + (now - R[0]))] : P; }
  /** Kỳ so sánh theo bộ lọc thời gian: tháng → như trên; còn lại → khoảng liền trước, cùng độ dài (đang chạy thì cắt tới cùng giờ). */
  function cmpRange(p) {
    if (p.k === 'month') return prevRange(monthOf(Date.now()));
    if (p.k === 'lmonth') return prevRange(shiftMonth(monthOf(Date.now()), -1));
    var R = perRange(p), len = R[1] - R[0], now = Date.now();
    CMP_LABEL = p.k === 'today' ? 'cùng giờ hôm qua' : p.k === 'yday' ? 'hôm kia' : p.k === 'd7' ? '7 ngày trước đó' : 'kỳ trước (' + perDates([R[0] - len, R[1] - len]) + ')';
    return [R[0] - len, Math.min(R[1], now) - len];
  }
  /** Mũi tên so với tháng trước. kind: 'money' | 'count' | 'rate' (điểm %) */
  function delta(cur, prev, kind) {
    if (cur === null || prev === null || prev === undefined) return '<em class="delta">' + CMP_LABEL + ' chưa có số liệu</em>';
    if (kind === 'rate') { var d = cur - prev; return d === 0 ? '<em class="delta">bằng ' + CMP_LABEL + '</em>' : '<em class="delta ' + (d > 0 ? 'up' : 'down') + '">' + (d > 0 ? '▲ ' : '▼ ') + Math.abs(d) + ' điểm so với ' + CMP_LABEL + '</em>'; }
    if (!prev) return cur ? '<em class="delta up">▲ ' + CMP_LABEL + ' chưa có</em>' : '<em class="delta">' + CMP_LABEL + ' chưa có số liệu</em>';
    var p = Math.round((cur - prev) * 100 / prev);
    return p === 0 ? '<em class="delta">bằng ' + CMP_LABEL + '</em>' : '<em class="delta ' + (p > 0 ? 'up' : 'down') + '">' + (p > 0 ? '▲ ' : '▼ ') + Math.abs(p) + '% so với ' + CMP_LABEL + '</em>';
  }
  function metric(label, value, explain, d, href) {
    return '<' + (href ? 'a href="' + href + '"' : 'div') + ' class="metric"><span>' + label + '</span><b>' + value + '</b>' + (d || '') + '<small>' + explain + '</small></' + (href ? 'a' : 'div') + '>';
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

  function viewReport() {
    var f = S.f.r || (S.f.r = { who: lvl() >= 2 ? 'team' : S.user.name });
    if (lvl() < 2) f.who = S.user.name;
    if (!f.p || f.p.k === 'all') f.p = { k: 'month' };
    var R = perRange(f.p), cx = { p: f.p, R: R, label: perLabel(f.p), month: monthOf(Math.min(R[1] - 1, Date.now())) };
    cx.whole = f.p.k === 'month' || f.p.k === 'lmonth'; // đúng trọn 1 tháng → mục tiêu dùng luôn số trong kỳ
    cx.P = cmpRange(f.p);
    var tabs = lvl() >= 2 ? '<div class="chips">' + '<button class="chip' + (f.who === 'team' ? ' on' : '') + '" data-who="team">👥 Cả nhóm</button><button class="chip' + (f.who === S.user.name ? ' on' : '') + '" data-who="' + esc(S.user.name) + '">👤 Của tôi</button>' +
      (f.who !== 'team' && f.who !== S.user.name ? '<button class="chip on">👤 ' + esc(f.who) + '</button>' : '') + '</div>' : '';
    return '<div class="page-head"><h1>Hiệu quả</h1></div>' + tabs + perBtn('r', f.p) +
      (f.who === 'team' ? viewTeam(cx) : viewPerson(f.who, cx));
  }

  function viewPerson(name, cx) {
    var month = cx.month, c = perf(name, cx.R), p = perf(name, cx.P), me = name === S.user.name;
    var h = (lvl() >= 2 && !me ? '<button class="btn ghost" data-who="team" style="margin-bottom:10px">← Quay lại cả nhóm</button>' : '') +
      targetBlock(name, month, cx.whole ? c.sales : perf(name, monthRange(month)).sales, me || lvl() >= 2) +
      '<div class="steps" style="margin:0 0 16px"><button class="btn pri" data-daily="' + esc(name) + '">📋 Báo cáo ngày (gửi Zalo)</button><button class="btn" data-bcdt="' + esc(name) + '|' + month + '">📊 Bảng BCDT ' + monthLabel(month) + '</button></div>';
    h += '<section class="section"><div class="section-h"><h2>💰 Bán hàng</h2></div><div class="metrics">' +
      metric('Doanh số', moneyShort(c.sales), 'Tổng tiền ' + c.orders + ' đơn ' + (me ? 'bạn' : '') + ' bán (không tính đơn huỷ).', delta(c.sales, p.sales)) +
      metric('Giá trị trung bình / đơn', c.orders ? moneyShort(c.avg) : '–', 'Doanh số chia số đơn. Tư vấn mua kèm, mua combo thì số này tăng.', c.orders ? delta(c.avg, p.orders ? p.avg : 0) : '') +
      metric('Tỷ lệ chốt', c.closePct === null ? '–' : c.closePct + '%', c.won + ' khách chốt / ' + (c.won + c.lost) + ' khách hỏi đã có kết quả.', delta(c.closePct, p.closePct, 'rate'), '#tiem-nang') +
      metric('Doanh thu từ khách cũ', c.sales ? c.oldPct + '%' : '–', moneyShort(c.oldRev) + ' từ khách mua lại. Chăm sóc tốt thì số này tăng.', c.sales ? delta(c.oldPct, p.sales ? p.oldPct : null, 'rate') : '') +
      '</div></section>';
    h += careMetrics(c, p, me);
    h += geoBlock(name, cx) + whyBlock(name, cx);
    h += '<p class="small muted">Doanh số tính theo “Nhân viên bán” ghi trên từng đơn. Đơn khách tự đặt trên web được tính cho người đang phụ trách khách đó.</p>';
    return h;
  }

  function viewTeam(cx) {
    var month = cx.month, R = cx.R, all = perf(null, R), tt = teamTarget(month);
    var names = userNames(); S.d.orders.forEach(function (o) { if (o.seller && names.indexOf(o.seller) < 0) names.push(o.seller); });
    var h = targetBlockTeam(cx.whole ? all.sales : perf(null, monthRange(month)).sales, tt, month) + '<div class="steps" style="margin:0 0 16px"><button class="btn pri" data-daily="">📋 Báo cáo ngày (gửi Zalo)</button><button class="btn" data-bcdt="|' + month + '">📊 Bảng BCDT cả nhóm ' + monthLabel(month) + '</button></div>';
    h += '<div class="kpis">' + kpi('Doanh thu', moneyShort(all.sales), 'good', '', all.orders + ' đơn') + kpi('TB / đơn', all.orders ? moneyShort(all.avg) : '–', '', '', 'giá trị trung bình') +
      kpi('Tỷ lệ chốt', all.closePct === null ? '–' : all.closePct + '%', '', '', all.won + ' chốt · ' + all.lost + ' không mua') + kpi('Từ khách cũ', all.sales ? all.oldPct + '%' : '–', '', '', moneyShort(all.oldRev)) + '</div>';
    h += careMetrics(all, perf(null, cx.P), false) + geoBlock(null, cx) + whyBlock(null, cx);
    var rows = names.map(function (n) { var p = perf(n, R); p.n = n; p.t = targetOf(n, month); return p; }).sort(function (a, b) { return b.sales - a.sales; });
    h += '<section class="section"><div class="section-h"><h2>Theo nhân viên</h2><span class="tip">bấm vào từng người để xem chi tiết, đặt mục tiêu</span></div><div class="list cols">' +
      rows.map(function (r) {
        var ms = cx.whole ? r.sales : perf(r.n, monthRange(month)).sales, p = r.t && r.t.amount ? ms / r.t.amount : null;
        return '<div class="card click" data-who="' + esc(r.n) + '"><div class="r1"><b>' + esc(r.n) + '</b><span class="end">' + money(r.sales) + '</span></div>' +
          (p === null ? '<div class="r3">🎯 Chưa đặt mục tiêu</div>' : '<div class="bar sm"><i style="width:' + Math.min(100, p * 100).toFixed(1) + '%"></i></div><div class="r3">🎯 ' + Math.round(p * 100) + '% mục tiêu ' + monthLabel(month) + ' ' + moneyShort(r.t.amount) + '</div>') +
          '<div class="r3">' + r.orders + ' đơn · TB ' + (r.orders ? moneyShort(r.avg) : '–') + ' · Chốt ' + (r.closePct === null ? '–' : r.closePct + '%') + ' · Khách cũ ' + (r.sales ? r.oldPct + '%' : '–') + '</div>' +
          '<div class="r3">💬 ' + r.care + ' lượt chăm sóc · ' + r.reorder + ' đặt lại' + (r.stale ? ' · <span class="bad-line">' + r.stale + ' khách quá 30 ngày</span>' : '') + '</div></div>';
      }).join('') + '</div></section>';
    var noSeller = S.d.orders.filter(function (o) { return !isVoid(o.status) && o.time >= R[0] && o.time < R[1] && !o.seller; });
    if (noSeller.length) h += '<div class="notice">' + noSeller.length + ' đơn (' + money(noSeller.reduce(function (s, o) { return s + o.total; }, 0)) + ') chưa có nhân viên bán, thường là khách mới tự đặt trên web. Mở đơn → mục “Nhân viên bán” để gán.</div>';
    var leads = S.d.leads || [], reasons = {}, lostN = 0;
    leads.forEach(function (l) { if (l.status === 'Không mua' && l.lastAt >= R[0] && l.lastAt < R[1]) { var r = l.reason || 'Không ghi'; reasons[r] = (reasons[r] || 0) + 1; lostN++; } });
    var rk = Object.keys(reasons).sort(function (a, b) { return reasons[b] - reasons[a]; });
    if (rk.length) h += '<section class="section"><div class="section-h"><h2>Vì sao khách hỏi không mua</h2></div><div class="box">' + rk.map(function (r) { return '<div class="reason"><span>' + esc(r) + '</span><b>' + reasons[r] + '</b><div class="bar sm"><i style="width:' + pct(reasons[r], lostN) + '%"></i></div></div>'; }).join('') + '</div></section>';
    return h;
  }
  function targetBlockTeam(sales, tt, month) {
    if (!tt) return '<div class="goal none"><div class="goal-h"><b>🎯 Mục tiêu cả nhóm ' + monthLabel(month) + '</b></div><p>Chưa ai đặt mục tiêu. Bấm vào từng nhân viên bên dưới để đặt.</p></div>';
    var R = monthRange(month), isCur = month === monthOf(Date.now()), days = Math.round((R[1] - R[0]) / DAY), el = isCur ? Math.min(days, Math.floor((today() - R[0]) / DAY) + 1) : days;
    var p = sales / tt, tp = el / days, lv = p >= 1 ? 'done' : p >= tp ? 'ok' : p >= tp * 0.8 ? 'mid' : 'bad';
    return '<div class="goal ' + lv + '"><div class="goal-h"><b>🎯 Mục tiêu cả nhóm ' + monthLabel(month) + '</b><span class="goal-st">' + { done: '🎉 Đã đạt', ok: '🟢 Đúng tiến độ', mid: '🟠 Hơi chậm', bad: '🔴 Đang chậm' }[lv] + '</span></div>' +
      '<div class="goal-num"><b>' + moneyShort(sales) + '</b> / ' + moneyShort(tt) + '<span>' + Math.round(p * 100) + '%</span></div>' +
      '<div class="bar"><i style="width:' + Math.min(100, p * 100).toFixed(1) + '%"></i>' + (isCur ? '<u style="left:' + (tp * 100).toFixed(1) + '%"></u>' : '') + '</div><p class="small muted">Tổng mục tiêu của các nhân viên.</p></div>';
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
      if (sh.role === 'orders') el.innerHTML = '<b>' + r.newOrders + '</b> đơn mới · ' + r.dup + ' đơn đã có' + (r.updated ? ' (<b>' + r.updated + '</b> đơn cập nhật trạng thái theo file)' : '') + (r.afterCut ? ' · ' + r.afterCut + ' đơn sau ngày lên CRM – bỏ qua' : '') + ' · ' + r.skip + ' dòng bỏ qua (thiếu SĐT / ngày / sản phẩm)<br>' + (r.approx ? 'khoảng ' : '') + r.customers + ' khách (' + r.newCustomers + ' khách mới với CRM) · doanh thu ' + money(r.revenue) + (r.from ? ' · từ ' + fDate(r.from) + ' đến ' + fDate(r.to) : '') + conflictHtml(r);
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
        (r.skipped ? '<p class="hint" style="margin:0">' + r.skipped + ' số của sale chưa có trong CRM (hoặc chưa chia) → bỏ qua.</p>' : '') + (r.writes ? '<p class="hint">CRM đã ghi tên sale cho ' + r.writes + ' số.</p>' : '') + '</div>', '<button class="btn pri" data-close>Đóng</button>');
      if (!dry) load(true);
    }, function (e) { btn.disabled = false; btn.textContent = t; toast(e.message, true); });
  }

  /* ================================================================ BCDT – báo cáo doanh thu tháng theo mẫu của sale */
  function lineOfTxt(t) { t = String(t || ''); return /progomax|fucoidan pro|fu ?pro/i.test(t) ? 'Fucoidan Pro' : /curcumin|nghệ/i.test(t) ? 'Curcumin' : /bữa ăn|badd|bua an/i.test(t) ? 'BADD' : 'Khác'; }
  var BC_LINES = ['Curcumin', 'BADD', 'Fucoidan Pro', 'Khác'];
  function bcdtData(name, month) {
    var R = monthRange(month), days = Math.round((R[1] - R[0]) / DAY), rows = [], tot = null, ca = { 'Ngày': [0, 0], 'Tối/CN': [0, 0], 'Lễ': [0, 0] }, ot = {}; OTYPES.forEach(function (t) { ot[t] = [0, 0]; });
    var mine = function (o) { return name === null || o.seller === name; };
    var blank = function () { var r = { newN: {}, newD: {}, newR: {}, oldN: {}, oldR: {}, hoanN: 0, hoanV: 0, offN: 0, offR: 0, careOk: 0, knm: 0 }; BC_LINES.forEach(function (l) { r.newN[l] = 0; r.newD[l] = 0; r.newR[l] = 0; r.oldN[l] = 0; r.oldR[l] = 0; }); return r; };
    tot = blank();
    for (var d = 0; d < days; d++) rows.push(Object.assign(blank(), { day: R[0] + d * DAY }));
    S.d.orders.forEach(function (o) {
      if (!o.time || o.time < R[0] || o.time >= R[1] || !mine(o)) return;
      var r = rows[Math.floor((o.time - R[0]) / DAY)], l = o.line || lineOfTxt(o.items);
      if (BC_LINES.indexOf(l) < 0) l = 'Khác';
      if (/hoàn/i.test(o.status)) { r.hoanN++; r.hoanV += o.total; tot.hoanN++; tot.hoanV += o.total; return; }
      if (isVoid(o.status)) return;
      var c = cust(o.phone), t0 = otypeOf(o), isNew = t0 === 'Khách mới' ? true : t0 === 'Khách cũ' ? false : !c || !c.first || c.first >= o.time - 3600e3; ot[t0][0]++; ot[t0][1] += o.total;
      [r, tot].forEach(function (x) { if (isNew) { x.newN[l]++; x.newR[l] += o.total; } else { x.oldN[l]++; x.oldR[l] += o.total; } });
      var k = o.ca && ca[o.ca] ? o.ca : 'Ngày'; ca[k][0]++; ca[k][1] += o.total;
      if (k !== 'Ngày') [r, tot].forEach(function (x) { x.offN++; x.offR += o.total; });
    });
    rows.forEach(function (r) { var cs = careStats(name, r.day, r.day + DAY); r.careOk = cs.ok; r.knm = cs.knm; tot.careOk += cs.ok; tot.knm += cs.knm; });
    (S.d.leads || []).forEach(function (ld) {
      if (!ld.time || ld.time < R[0] || ld.time >= R[1] || !/^quảng cáo/i.test(ld.channel) || (name !== null && ld.owner !== name)) return;
      var l = lineOfTxt(ld.interest + ' ' + ld.channel); rows[Math.floor((ld.time - R[0]) / DAY)].newD[l]++; tot.newD[l]++;
    });
    return { rows: rows, tot: tot, ca: ca, ot: ot };
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
      '<textarea id="dyText" rows="18" style="font-family:inherit;font-size:14px;line-height:1.5">' + esc(dailyText(name, day)) + '</textarea>';
    var m = modal('📋 Báo cáo ngày', body, '<button class="btn" data-close>Đóng</button><button class="btn zalo" id="dyCopy">📋 Copy để dán vào Zalo</button>');
    var redraw = function () { var w = $('#dyWho', m), dv = $('#dyDay', m).value; $('#dyText', m).value = dailyText(w ? (w.value || null) : name, dv ? new Date(dv + 'T12:00:00+07:00').getTime() : Date.now()); };
    if ($('#dyWho', m)) $('#dyWho', m).onchange = redraw; $('#dyDay', m).onchange = redraw;
    $('#dyCopy', m).onclick = function () { copy($('#dyText', m).value).then(function () { toast('Đã copy – mở nhóm Zalo và dán vào nhé'); }); };
  }
  function bcdtCols() {
    var c = [['Ngày', function (r) { return r.day ? fDate(r.day).slice(0, 5) : 'TỔNG'; }]];
    BC_LINES.forEach(function (l) { c.push(['Đơn mới ' + l, function (r) { return r.newN[l]; }], ['Data mới ' + l, function (r) { return r.newD[l]; }], ['DT mới ' + l, function (r) { return r.newR[l]; }, 1]); });
    BC_LINES.forEach(function (l) { c.push(['Đơn cũ ' + l, function (r) { return r.oldN[l]; }], ['DT cũ ' + l, function (r) { return r.oldR[l]; }, 1]); });
    c.push(['Số đơn hoàn', function (r) { return r.hoanN; }], ['Giá trị hoàn', function (r) { return r.hoanV; }, 1]);
    var sum = function (o) { return BC_LINES.reduce(function (s, l) { return s + o[l]; }, 0); };
    c.push(['DT khách mới', function (r) { return sum(r.newR); }, 1], ['DT khách cũ', function (r) { return sum(r.oldR); }, 1], ['TỔNG DT (đã trừ hoàn)', function (r) { return sum(r.newR) + sum(r.oldR); }, 1]);
    c.push(['Tỷ lệ chốt', function (r) { var d = sum(r.newD); return d ? Math.round(sum(r.newN) / d * 100) + '%' : ''; }], ['TB/đơn mới', function (r) { var n = sum(r.newN); return n ? Math.round(sum(r.newR) / n) : 0; }, 1],
      ['% DT khách cũ', function (r) { var t = sum(r.newR) + sum(r.oldR); return t ? Math.round(sum(r.oldR) / t * 100) + '%' : ''; }],
      ['TB/đơn cũ', function (r) { var n = sum(r.oldN); return n ? Math.round(sum(r.oldR) / n) : 0; }, 1], ['DT ngoài giờ', function (r) { return r.offR; }, 1],
      ['KH cũ chăm sóc (kết nối)', function (r) { return r.careOk; }], ['Không nghe máy', function (r) { return r.knm; }]);
    return c;
  }
  function openBcdt(name, month) {
    var d = bcdtData(name, month), fmtv = function (v, isMoney) { return !v ? '' : isMoney ? v.toLocaleString('vi-VN') : v; };
    var cols = bcdtCols().filter(function (c, i) { return i === 0 || c[1](d.tot); }); // ẩn cột cả tháng bằng 0 (dòng SP không bán) cho gọn
    var sumL = function (o) { return BC_LINES.reduce(function (s, l) { return s + o[l]; }, 0); }, T = d.tot, tRev = sumL(T.newR) + sumL(T.oldR), tg = name ? targetOf(name, month) : null;
    var sumKpi = kpi('Tổng doanh thu', moneyShort(tRev), '', '', (sumL(T.newN) + sumL(T.oldN)) + ' đơn · hoàn ' + T.hoanN) +
      kpi('Tỷ lệ chốt', sumL(T.newD) ? Math.round(sumL(T.newN) / sumL(T.newD) * 100) + '%' : '–', '', '', sumL(T.newN) + ' đơn mới / ' + sumL(T.newD) + ' data mới') +
      kpi('TB/đơn khách mới', sumL(T.newN) ? moneyShort(sumL(T.newR) / sumL(T.newN)) : '–') +
      kpi('Doanh thu khách cũ', tRev ? Math.round(sumL(T.oldR) / tRev * 100) + '%' : '–', '', '', moneyShort(sumL(T.oldR))) +
      kpi('TB/đơn khách cũ', sumL(T.oldN) ? moneyShort(sumL(T.oldR) / sumL(T.oldN)) : '–', '', '', sumL(T.oldN) + ' đơn khách cũ') +
      kpi('DT ngoài giờ', moneyShort(T.offR), '', '', T.offN + ' đơn tối / CN / lễ') +
      kpi('KH cũ đã chăm sóc', T.careOk, '', '', 'kết nối được · ' + T.knm + ' lượt không nghe máy') +
      (tg && tg.amount ? kpi('% tiến độ mục tiêu', pct(tRev, tg.amount) + '%', pct(tRev, tg.amount) >= 100 ? 'good' : '', '', 'mục tiêu ' + moneyShort(tg.amount)) : '');
    var head = '<tr>' + cols.map(function (c) { return '<th>' + esc(c[0]) + '</th>'; }).join('') + '</tr>';
    var tr = function (r, cls) { return '<tr' + (cls ? ' class="' + cls + '"' : '') + '>' + cols.map(function (c) { return '<td>' + fmtv(c[1](r), c[2]) + '</td>'; }).join('') + '</tr>'; };
    var body = '<div class="box"><div class="kpis" style="margin:0 0 10px">' + sumKpi + '</div><h3 style="margin:4px 0 8px">Theo loại đơn (tính hoa hồng)</h3><div class="kpis" style="margin:0">' + OTYPES.map(function (t) { var p = Number((S.d.rules.commission || {})[t]) || 0, x = d.ot[t]; return kpi(OT[t][0] + ' ' + t, moneyShort(x[1]), '', '', x[0] + ' đơn' + (p ? ' · hoa hồng ' + p + '% = <b>' + money(Math.round(x[1] * p / 100)) + '</b>' : '')); }).join('') +
      (OTYPES.some(function (t) { return Number((S.d.rules.commission || {})[t]); }) ? kpi('💰 Tổng hoa hồng', moneyShort(OTYPES.reduce(function (s0, t) { return s0 + Math.round(d.ot[t][1] * (Number((S.d.rules.commission || {})[t]) || 0) / 100); }, 0)), 'good', '', 'tạm tính, đơn chờ kiểm tra loại vẫn tính') : '') + '</div></div>' +
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
    var h = '<div class="page-head"><h1>Cài đặt</h1></div>';
    h += '<div class="box"><h3>Tài khoản</h3><p style="margin:0 0 10px"><b>' + esc(S.user.name) + '</b> · ' + esc(S.user.email) + (lvl() >= 2 ? ' · ' + esc(S.user.role) : '') + '</p><button class="btn danger" id="logout">Đăng xuất</button></div>';
    h += '<div class="box"><h3>🎯 Số khách chăm sóc mỗi ngày</h3><p class="small muted" style="margin:0 0 8px">Tab Hôm nay chỉ đưa ra tối đa bấy nhiêu khách mỗi ngày (khách quan trọng trước). Khách chưa tới lượt tự dời sang hôm sau. Cài trên máy này.</p>' +
      '<div style="display:flex;gap:8px;align-items:center"><input type="number" id="dayLim" min="5" max="200" value="' + dayLimit() + '" style="max-width:110px"><button class="btn" id="dayLimSave">Lưu</button></div></div>';
    h += '<div class="box"><h3>📲 Thông báo Telegram riêng</h3>' + (S.user.tg
      ? '<p style="margin:0 0 10px">✅ Đã kết nối. Bạn nhận riêng: đơn mới của khách mình phụ trách, khách hỏi mới được giao, danh sách việc lúc 8h sáng.</p><button class="btn ghost" id="tgOff">Ngắt kết nối</button>'
      : '<p style="margin:0 0 10px">Nhận thông báo về khách <b>của riêng bạn</b> qua Telegram. Làm 1 lần, mất 30 giây:</p><ol style="margin:0 0 10px;padding-left:20px"><li>Bấm <b>“Kết nối Telegram”</b>.</li><li>Bấm <b>“Mở Telegram”</b> → trong Telegram bấm <b>Start / Bắt đầu</b>.</li><li>Quay lại đây bấm <b>“Tôi đã bấm Start”</b>.</li></ol><div class="steps" id="tgSteps"><button class="btn pri" id="tgLink">Kết nối Telegram</button></div>') + '</div>';
    var cc = {}; CAT_ORDER.forEach(function (k) { cc[k] = catColor(k); });
    var tg = S.f.tags || (S.f.tags = myTags().map(function (t) { return { name: t.name, color: t.color }; }));
    h += '<div class="box"><h3>🎨 Màu phân loại khách</h3><p class="hint" style="margin:0 0 10px">Thẻ khách và thẻ đơn được tô màu tự động theo loại. Bạn đổi màu tuỳ ý, hoặc tạo thêm nhãn riêng rồi gắn cho khách trong hồ sơ khách.</p>' +
      '<div class="color-rows">' + CAT_ORDER.map(function (k) { return '<label class="color-row"><input type="color" data-cc="' + k + '" value="' + cc[k] + '"><span><b>' + CAT_DEF[k].label + '</b><small>' + CAT_DEF[k].tip + '</small></span></label>'; }).join('') + '</div>' +
      '<h3 style="margin:14px 0 8px">Nhãn riêng của bạn</h3><div class="color-rows" id="tagRows">' + tg.map(function (t, i) { return '<div class="color-row" data-ti="' + i + '"><input type="color" data-tk="color" value="' + esc(t.color) + '"><input type="text" data-tk="name" value="' + esc(t.name) + '" placeholder="Tên nhãn (vd Khách thân)" maxlength="30"><button class="rm" data-deltag="' + i + '" aria-label="Xoá">✕</button></div>'; }).join('') + '</div>' +
      '<div class="steps" style="margin-top:10px"><button class="btn" data-addtag>＋ Thêm nhãn</button><button class="btn pri" id="prefSave">Lưu màu & nhãn</button><button class="btn ghost" id="prefReset">Về màu mặc định</button></div></div>';
    h += '<div class="box guide"><h3>Hướng dẫn nhanh</h3><ol>' +
      '<li>Mỗi sáng mở tab <b>Hôm nay</b>. Làm lần lượt 3 phần: đơn mới, chăm sóc khách, khách hỏi.</li>' +
      '<li><b>Đơn mới:</b> gọi khách xác nhận, xong bấm <b>✅ Xác nhận</b>. Gửi hàng thì bấm <b>🚚 Đang giao</b>, khách nhận thì <b>📬 Đã giao</b>.</li>' +
      '<li><b>Chăm sóc:</b> bấm <b>💬 Chăm sóc</b> → <b>Copy tin & mở Zalo</b> → dán tin gửi khách → quay lại chọn <b>Kết quả</b> → <b>Lưu</b>. Khách đó sẽ tự biến khỏi danh sách.</li>' +
      '<li>Khách hẹn gọi lại: chọn “Hẹn gọi lại” và chọn ngày. Đến ngày, khách tự hiện lại ở tab Hôm nay.</li>' +
      '<li>Khách đặt qua Zalo / điện thoại: vào <b>Đơn hàng → ＋ Tạo đơn</b> để lưu, khách sẽ được chăm sóc tự động như đơn web.</li>' +
      '<li><b>Khách hỏi</b> (hỏi mà chưa mua, nhắn Fanpage, Zalo, form web…): vào tab <b>Khách hỏi → ＋ Thêm</b>. Mỗi lần nói chuyện bấm <b>💬 Tư vấn</b> → chọn kết quả. Khách đồng ý mua thì chọn <b>“Khách chốt mua”</b>, form tạo đơn mở ra luôn. Khách từ chối thì chọn <b>“Khách không mua”</b> và ghi lý do.</li>' +
      '<li>Tab <b>Hiệu quả</b>: đầu tháng bấm <b>🎯 Đặt mục tiêu</b> doanh số của mình. Thanh tiến độ cho biết đang nhanh hay chậm (vạch đen = hôm nay), và mỗi ngày cần bán thêm bao nhiêu. Bên dưới là doanh số, giá trị trung bình mỗi đơn, tỷ lệ chốt, phần doanh thu từ khách cũ và kết quả chăm sóc, so với kỳ trước. Bấm nút <b>📅</b> để chọn thời gian (hôm nay, 7 ngày, tháng trước hoặc tự chọn ngày).</li>' +
      '<li><b>Đơn chuyển khoản</b>: tiền về tài khoản thì mở đơn bấm <b>💳 Xác nhận đã nhận tiền</b>. Gửi hàng thì nhập <b>mã vận đơn</b>, đơn tự chuyển sang “Đang giao”.</li>' +
      '<li>Bạn chỉ thấy <b>khách mình phụ trách</b>. Gõ số của khách người khác đang phụ trách, CRM sẽ báo tên người đó. Muốn đổi người phụ trách thì nhờ quản lý chuyển.</li>' +
      '<li>Nên bấm <b>📲 Kết nối Telegram</b> (ngay trên) để nhận riêng đơn mới và việc hằng ngày của mình.</li>' +
      '<li><b>Màu thẻ khách</b>: trắng = khách mới, vàng = khách cũ, tím = ngoài giờ (tối / CN / lễ), xám = hoàn / bom. Bấm vào ô màu ở trang Khách hàng để lọc. Đổi màu hoặc tạo nhãn riêng ở mục 🎨 bên trên.</li>' +
      '<li><b>☐ Khách đồng ý nhận ưu đãi</b> (trong hồ sơ): bấm khi khách đồng ý nhận tin khuyến mãi. Khách chưa đồng ý thì chỉ hỏi thăm, hướng dẫn dùng.</li>' +
      '<li>Nhãn <span class="age ok">💬 5 ngày chưa chăm sóc</span>: đếm từ lần gần nhất khách <b>có trả lời</b> (gọi không nghe máy thì vẫn đếm tiếp). <b>Xanh</b> ≤ 7 ngày · <b>Cam</b> 8–30 ngày · <b>Đỏ</b> trên 30 ngày, nên liên hệ lại.</li>' +
      '</ol><p style="margin:10px 0"><a class="btn" href="/huong-dan/crm/" target="_blank" rel="noopener">📖 Xem hướng dẫn đầy đủ</a></p><p class="small muted" style="margin:6px 0 0">Không chụp màn hình, không gửi danh sách khách ra ngoài: đây là dữ liệu cá nhân, pháp luật yêu cầu giữ kín (Nghị định 13/2023).</p></div>';
    if (lvl() < 2) return h;
    if (lvl() >= 3) h += syncBoxes();
    var R = S.d.rules || {};
    h += '<div class="box"><h3>⭐ Nhóm khách (VIP, Sắp mất)</h3><p class="hint" style="margin:0 0 10px">Máy tự xếp nhóm cho khách theo các mức dưới đây.</p>' +
      '<div class="row2c"><label class="f"><span>VIP khi mua từ (số đơn)</span><input type="number" id="rVipN" min="1" value="' + esc(R.vipOrders || 3) + '"></label>' +
      '<label class="f"><span>hoặc tổng chi từ</span><input type="text" id="rVipS" inputmode="decimal" value="' + esc(R.vipSpent || 2000000) + '" placeholder="vd 5tr"></label></div>' +
      '<label class="f"><span>“Sắp mất” khi bao nhiêu ngày chưa mua lại</span><input type="number" id="rRisk" min="7" value="' + esc(R.atRisk || 60) + '"></label>' +
      '<label class="f"><span>🚚 Số ngày giao hàng trung bình</span><input type="number" id="rShip" min="0" max="15" value="' + esc(R.shipDays === undefined ? 3 : R.shipDays) + '"></label>' +
      '<label class="f"><span>🌟 Khách quen sản phẩm khi đã mua sản phẩm đó từ (lần)</span><input type="number" id="rFam" min="0" max="10" value="' + esc(R.famMin === undefined ? 1 : R.famMin) + '"></label>' +
      '<p class="hint">Khách quen (mua lại đúng sản phẩm đã dùng, lần mua trước trong 6 tháng, đơn trước không bị hoàn) đã biết cách dùng: CRM <b>bỏ qua</b> hỏi nhận hàng, hỏi thăm 7 ngày, xin cảm nhận 14 ngày. Vẫn nhắc <b>sắp hết hàng</b>, giới thiệu sản phẩm 30 ngày, mời quay lại. Ghi <b>0</b> = tắt (ai cũng gọi đủ các mốc).</p>' +
      '<p class="hint">Các mốc chăm sóc (hỏi nhận hàng, sắp hết hàng, xin cảm nhận…) tính từ <b>ngày khách nhận hàng</b>: ngày đơn chuyển “Đã giao”, hoặc ngày sale bấm “Đã nhận hàng” khi gọi. Chưa biết ngày nhận thì máy ước tính = <b>ngày gửi</b> + số ngày này (đơn chưa ghi ngày gửi: ngày đặt + số ngày này). Đơn còn chờ xác nhận / chờ gửi thì chưa nhắc hỏi nhận hàng.</p>' +
      '<p class="hint" id="rHint"></p><button class="btn pri" id="rSave">Lưu nhóm khách</button></div>';
    var CMc = R.commission || {};
    h += '<div class="box"><h3>💰 Hoa hồng theo loại đơn</h3><p class="hint" style="margin:0 0 10px">% hoa hồng trên doanh thu đơn (đã trừ huỷ / hoàn). Báo cáo BCDT tự tính hoa hồng tháng cho từng sale. Để trống = chưa tính.</p><div class="row2c">' +
      OTYPES.map(function (t) { return '<label class="f"><span>' + OT[t][0] + ' ' + t + ' (%)</span><input type="text" inputmode="decimal" data-cm="' + esc(t) + '" value="' + esc(CMc[t] || '') + '" placeholder="vd 5"></label>'; }).join('') +
      '</div><p class="hint">Loại đơn do sale chọn khi lên đơn (CRM chọn sẵn theo gợi ý: Lễ → Ngoài giờ → Khách mới / cũ; khách để lại số qua quảng cáo trong 30 ngày tính là Khách mới). Đơn sale chọn khác gợi ý hiện ở <b>Đơn hàng → Cần xử lý → Kiểm tra loại đơn</b>.</p><button class="btn pri" id="cmSave">Lưu hoa hồng</button></div>';
    h += caBox();
    var md = mode(), staff = (S.d.users || []).filter(function (u) { return u.active !== false; }), noOwner = S.d.customers.filter(function (c) { return !c.owner; }).length;
    h += '<div class="box"><h3>👥 Chia khách & phân quyền</h3><p class="hint" style="margin:0 0 10px">Nhân viên chỉ thấy khách mình phụ trách. Quản lý thấy tất cả.</p>' +
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
    var cy = S.f.cy || (S.f.cy = S.d.cycles.map(function (r) { return r.slice(); }));
    h += '<div class="box"><h3>Chu kỳ dùng sản phẩm</h3><p class="hint" style="margin:0 0 10px">Khách dùng hết 1 hộp/hũ trong bao nhiêu ngày → máy tính ngày “sắp hết hàng” để nhắc đặt lại. Tên chỉ cần chứa 1 phần (ví dụ “DILVANG”). Quy cách để trống = mọi quy cách.</p>' +
      '<div class="edit-table" id="cyT"><div class="edit-row head"><span>Tên sản phẩm (chứa chữ)</span><span>Quy cách</span><span>Số ngày</span><span>Căn cứ</span><span></span></div>' +
      cy.map(function (r, i) { return '<div class="edit-row" data-i="' + i + '"><input type="text" data-k="0" value="' + esc(r[0]) + '" placeholder="Tên sản phẩm"><input type="text" data-k="1" value="' + esc(r[1]) + '" placeholder="vd 500g"><input type="number" data-k="2" min="1" value="' + esc(r[2]) + '" placeholder="Ngày"><input type="text" data-k="3" value="' + esc(r[3]) + '" placeholder="Căn cứ / ghi chú"><button class="rm" data-rm="cy" data-i="' + i + '" aria-label="Xoá">✕</button></div>'; }).join('') +
      '</div><div class="steps" style="margin-top:10px"><button class="btn" data-add="cy">＋ Thêm dòng</button><button class="btn pri" id="cySave">Lưu chu kỳ</button></div></div>';
    var tp = S.f.tp || (S.f.tp = S.d.templates.map(function (r) { return r.slice(); }));
    h += '<div class="box"><h3>Mẫu tin nhắn chăm sóc</h3><p class="hint" style="margin:0 0 10px">Dùng <b>[Tên]</b> và <b>[Sản phẩm]</b>, máy tự thay khi nhắn. Cột “Thời điểm” cần chứa “1 ngày”, “hết”, “14”, “30”, “60” để tự chọn đúng mẫu cho từng việc.</p>' +
      '<div class="edit-table" id="tpT">' + tp.map(function (r, i) { return '<div class="edit-row tpl" data-i="' + i + '"><input type="text" data-k="0" value="' + esc(r[0]) + '" placeholder="Thời điểm"><input type="text" data-k="1" value="' + esc(r[1]) + '" placeholder="Mục đích"><button class="rm" data-rm="tp" data-i="' + i + '" aria-label="Xoá">✕</button><textarea data-k="2" rows="3" placeholder="Nội dung tin">' + esc(r[2]) + '</textarea></div>'; }).join('') +
      '</div><div class="steps" style="margin-top:10px"><button class="btn" data-add="tp">＋ Thêm mẫu</button><button class="btn pri" id="tpSave">Lưu mẫu tin</button></div></div>';
    if (lvl() >= 3) {
      var us = S.f.us || (S.f.us = S.d.users.map(function (u) { return { email: u.email, name: u.name, role: u.role, active: u.active !== false, alias: u.alias || '', prefix: u.prefix || '' }; }));
      h += '<div class="box"><h3>Nhân sự được vào CRM</h3><p class="hint" style="margin:0 0 10px"><b>Quản trị</b>: toàn quyền. <b>Quản lý</b>: thêm xem doanh thu, sửa chu kỳ & mẫu tin. <b>Nhân viên</b>: chăm sóc khách, xử lý đơn. Nhân viên nghỉ việc: bỏ tích “Đang dùng” là không vào được nữa.</p>' +
        '<p class="hint" style="margin:0 0 10px"><b>Tên trong file QC</b>: tên sale như đang ghi ở cột Sale của file số quảng cáo (nhiều cách viết thì cách nhau dấu phẩy, vd “Phương, PHƯƠNG”). <b>Tiền tố mã đơn</b>: vd “Phuong” → mã đơn Phuong300926-01.</p>' +
        '<div class="edit-table" id="usT"><div class="edit-row usr head"><span>Email</span><span>Tên hiển thị</span><span>Quyền</span><span>Đang dùng</span><span></span></div>' +
        us.map(function (u, i) { return '<div class="edit-row usr" data-i="' + i + '"><input type="email" data-k="email" value="' + esc(u.email) + '" placeholder="email@gmail.com"><input type="text" data-k="name" value="' + esc(u.name) + '" placeholder="Tên"><select data-k="role">' + ['Nhân viên', 'Quản lý', 'Quản trị'].map(function (r) { return '<option' + (r === u.role ? ' selected' : '') + '>' + r + '</option>'; }).join('') + '</select><label class="switch"><input type="checkbox" data-k="active"' + (u.active ? ' checked' : '') + '> Có</label><button class="rm" data-rm="us" data-i="' + i + '" aria-label="Xoá">✕</button>' +
          '<input type="text" data-k="alias" value="' + esc(u.alias || '') + '" placeholder="Tên trong file QC (vd Phương)" class="usr-x"><input type="text" data-k="prefix" value="' + esc(u.prefix || '') + '" placeholder="Tiền tố mã đơn (vd Phuong)" class="usr-x"></div>'; }).join('') +
        '</div><div class="steps" style="margin-top:10px"><button class="btn" data-add="us">＋ Thêm người</button><button class="btn pri" id="usSave">Lưu nhân sự</button></div></div>';
    }
    return h;
  }
  function bindSettings() {
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
        api('settings', { rules: { vipOrders: $('#rVipN').value, vipSpent: moneyIn($('#rVipS').value), atRisk: $('#rRisk').value, shipDays: $('#rShip').value, famMin: $('#rFam').value } }).then(function (j) { Object.assign(S.d.rules, j.rules); toast('Đã lưu. Nhóm khách được tính lại ✓'); load(true); }, function (e) { toast(e.message, true); b.disabled = false; });
      }; }
    if ($('#cmSave')) $('#cmSave').onclick = function () {
      var b = this, cm = {}; $$('[data-cm]').forEach(function (x) { cm[x.getAttribute('data-cm')] = x.value.trim(); }); b.disabled = true;
      api('settings', { commission: cm }).then(function (j) { S.d.rules.commission = j.commission; toast('Đã lưu % hoa hồng ✓'); b.disabled = false; }, function (e) { toast(e.message, true); b.disabled = false; });
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
  document.addEventListener('toggle', function (e) { var d = e.target; if (d && d.matches && d.matches('details[data-grp]')) { S.f.gopen = S.f.gopen || {}; S.f.gopen[d.getAttribute('data-grp')] = d.open; } }, true);
  document.addEventListener('click', function (e) {
    var t = e.target.closest('[data-otab],[data-per],[data-promo],[data-rf],[data-vipgo],[data-taghelp],[data-consent],[data-daily],[data-flow],[data-zalo],[data-quick],[data-care],[data-next],[data-neworder],[data-cf],[data-os],[data-tf],[data-cat],[data-addtag],[data-deltag],[data-claim],[data-bcdt],[data-srcadd],[data-srcedit],[data-srcsync],[data-srcdel],[data-adsedit],[data-adssync],[data-who],[data-target],[data-myold],[data-more],[data-add],[data-rm],[data-consult],[data-leadorder],[data-newlead],[data-editlead],[data-cust],[data-order],[data-lead]');
    if (!t || !S.d) return;
    if (e.target.closest('a[href]') && !t.hasAttribute('data-myold')) return; // nút gọi / Zalo bên trong thẻ
    var a = function (k) { return t.getAttribute(k); };
    if (t.hasAttribute('data-flow')) { startFlow(); return; }
    if (t.hasAttribute('data-taghelp')) { openTagHelp(); return; }
    if (t.hasAttribute('data-promo')) { openPromo(); return; }
    if (t.hasAttribute('data-rf')) { var rf = a('data-rf').split('|'); S.f.r = S.f.r || {}; S.f.r[rf[0]] = rf[1]; render(); return; }
    if (t.hasAttribute('data-vipgo')) { e.preventDefault(); S.f.c = { q: '', k: 'risk', sort: 'spent', n: 60 }; location.hash = '#khach-hang'; return; }
    if (t.hasAttribute('data-consent')) { e.stopPropagation(); var cc = cust(a('data-consent')); if (cc) { sendOp('customer', { phone: cc.phone, consent: 1 }); t.outerHTML = consentTag(cc); toast('Đã ghi: khách đồng ý nhận ưu đãi ✓'); } return; }
    if (t.hasAttribute('data-daily')) { openDaily(a('data-daily') || null); return; }
    if (t.hasAttribute('data-zalo')) { e.stopPropagation(); var zc = cust(a('data-zalo')); if (zc) { setZalo(zc, true); var zb = $('.modal [data-zalo]'); if (zb) zb.outerHTML = zaloTag(zc); } return; }
    if (t.hasAttribute('data-quick')) { e.stopPropagation(); var qk = a('data-quick').split('|'), qc = cust(qk[0]); if (qc) quickCare(qc, qk[1], qk[2], '', t); return; }
    if (t.hasAttribute('data-care')) { e.stopPropagation(); openCare(a('data-care'), a('data-task')); return; }
    if (t.hasAttribute('data-next')) { var o = findOrder(a('data-next')); if (o && NEXT[o.status]) setStatus(o, NEXT[o.status]); return; }
    if (t.hasAttribute('data-cat')) { var ck = a('data-cat'); S.f.c = S.f.c || { q: '', k: 'all', sort: 'last', n: 60 }; S.f.c.cat = S.f.c.cat === ck ? '' : ck; S.f.c.n = 60; if (route().view !== 'khach-hang') location.hash = '#khach-hang'; else render(); return; }
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
      var cl = a('data-claim').split('|'), btn = t; btn.disabled = true; btn.textContent = 'Đang nhận…';
      api('claim', cl[0] === 'c' ? { phone: cl[1] } : { leadId: cl[1] }).then(function () {
        if (cl[0] === 'c') { var c0 = cust(cl[1]); if (c0) c0.owner = S.user.name; } else { var l0 = findLead(cl[1]); if (l0) l0.owner = S.user.name; }
        toast('Đã nhận khách ✓'); closeModal(true); navBadges(); render();
      }, function (e) { toast(e.message, true); load(true); });
      return;
    }
    if (t.hasAttribute('data-consult')) { openConsult(a('data-consult')); return; }
    if (t.hasAttribute('data-leadorder')) { var L = findLead(a('data-leadorder')); if (L) openOrderForm({ lead: L }); return; }
    if (t.hasAttribute('data-newlead')) { openLeadForm(); return; }
    if (t.hasAttribute('data-editlead')) { var L2 = findLead(a('data-editlead')); if (L2) openLeadForm(L2); return; }
    if (t.hasAttribute('data-neworder')) { openNewOrder(a('data-neworder')); return; }
    if (t.hasAttribute('data-cf')) { S.f.c.k = a('data-cf'); S.f.c.n = 60; render(); return; }
    if (t.hasAttribute('data-os')) { S.f.o.st = a('data-os'); S.f.o.n = 60; render(); return; }
    if (t.hasAttribute('data-otab')) { S.f.o.tab = a('data-otab'); if (S.f.o.tab === 'todo') S.f.o.q = ''; S.f.o.n = 60; render(); return; }
    if (t.hasAttribute('data-per')) { openPer(a('data-per')); return; }
    if (t.hasAttribute('data-tf')) { S.f.t.k = a('data-tf'); S.f.t.n = 60; render(); return; }
    if (t.hasAttribute('data-who')) { S.f.r.who = a('data-who'); render(); return; }
    if (t.hasAttribute('data-target')) { var tg = a('data-target').split('|'); openTarget(tg[0], tg[1]); return; }
    if (t.hasAttribute('data-myold')) { e.preventDefault(); S.f.c = { q: '', k: lvl() >= 2 ? 'mine' : 'all', sort: 'age', n: 60 }; location.hash = '#khach-hang'; return; }
    if (t.hasAttribute('data-more')) { S.f[a('data-more')].n += 60; render(); return; }
    if (t.hasAttribute('data-add')) { var k = a('data-add'); S.f[k].push(k === 'us' ? { email: '', name: '', role: 'Nhân viên', active: true, alias: '', prefix: '' } : k === 'tp' ? ['', '', ''] : ['', '', '', '']); render(); var rows = $$('#' + k + 'T .edit-row[data-i]'); if (rows.length) $('input', rows[rows.length - 1]).focus(); return; }
    if (t.hasAttribute('data-rm')) { var k2 = a('data-rm'); if (k2 === 'us' && S.f.us[+a('data-i')].email === S.user.email) { toast('Không tự xoá tài khoản của mình được.', true); return; } S.f[k2].splice(+a('data-i'), 1); render(); return; }
    if (t.hasAttribute('data-cust')) { closeModal(true); openCustomer(a('data-cust')); return; }
    if (t.hasAttribute('data-order')) { closeModal(true); openOrder(a('data-order')); return; }
    if (t.hasAttribute('data-lead')) { closeModal(true); openLead(a('data-lead')); return; }
  });
  document.addEventListener('click', function (e) { if (S.d && e.target.closest('[data-cfclear]')) { S.f.c.spend = ''; S.f.c.src = ''; S.f.c.n = 60; render(); } });
  document.addEventListener('click', function (e) { // mã vận đơn trên dòng đơn: copy mã (link thì mở trang tra cứu), không mở hộp đơn
    var tk = e.target.closest && e.target.closest('[data-trk]'); if (!tk) return;
    e.stopPropagation(); var code = tk.getAttribute('data-trk'), paste = tk.tagName === 'A' && tk.getAttribute('href').indexOf(encodeURIComponent(code)) < 0;
    copy(code).then(function () { toast('Đã copy mã vận đơn ' + code + (paste ? ' – dán vào ô tra cứu' : '')); });
  }, true);
  document.addEventListener('click', function (e) { var cm = e.target.closest && e.target.closest('[data-comm]'); if (!cm || !S.d) return; e.stopPropagation(); var a = cm.getAttribute('data-comm').split('|'); commAct(a[0], a[1]); }, true);
  var typing = null;
  document.addEventListener('input', function (e) {
    if (!S.d) return;
    if (e.target.id === 'cq' || e.target.id === 'oq' || e.target.id === 'tq') {
      var key = { cq: 'c', oq: 'o', tq: 't' }[e.target.id], v = e.target.value;
      clearTimeout(typing); typing = setTimeout(function () { S.f[key].q = v; S.f[key].n = 60; render(); }, 180);
    }
  });
  document.addEventListener('change', function (e) {
    if (!S.d) return;
    if (e.target.id === 'csort') { S.f.c.sort = e.target.value; render(); }
    if (e.target.id === 'cspend' || e.target.id === 'csrc') { S.f.c[e.target.id === 'cspend' ? 'spend' : 'src'] = e.target.value; S.f.c.n = 60; render(); }
    if (e.target.id === 'tch') { S.f.t.ch = e.target.value; S.f.t.n = 60; render(); }
    if (e.target.hasAttribute && e.target.hasAttribute('data-assign') && e.target.value) {
      var as = e.target.getAttribute('data-assign').split('|'), to = e.target.value, sel = e.target; sel.disabled = true;
      api('assign', as[0] === 'c' ? { phones: [as[1]], to: to, withLeads: true } : { leadIds: [as[1]], to: to }).then(function () {
        if (as[0] === 'c') { var c1 = cust(as[1]); if (c1) c1.owner = to; (S.d.leads || []).forEach(function (l) { if (l.phone === as[1] && isOpenLead(l)) l.owner = to; }); } else { var l1 = findLead(as[1]); if (l1) l1.owner = to; }
        toast('Đã giao cho ' + to + ' ✓'); render();
      }, function (er) { sel.disabled = false; toast(er.message, true); });
      return;
    }
    if (e.target.id === 'mine') { S.mine = e.target.checked; store('crm_mine', S.mine ? '1' : '0'); navBadges(); render(); }
  });
  document.addEventListener('keydown', function (e) { if (e.key === 'Escape' && $('.modal')) closeModal(); });
  window.addEventListener('hashchange', function () { if (!route().id) closeModal(true); render(); });
  window.addEventListener('popstate', function () { if (!route().id && $('.modal')) closeModal(true); });
  // tự làm mới mỗi 3 phút khi đang mở trang, và khi quay lại tab
  setInterval(function () { if (S.d && !document.hidden && !$('.modal') && Date.now() - S.loadedAt > 170e3) load(true); if (S.pq && S.pq.length && Date.now() - (S.pqAt || 0) > 120e3) perfFlush(); }, 30e3);
  document.addEventListener('visibilitychange', function () { if (document.hidden) perfFlush(); if (!document.hidden && S.d && !$('.modal') && Date.now() - S.loadedAt > 60e3) load(true); });

  /* ================================================================ chạy */
  if (S.token) start(); else renderLogin('email');
})();
