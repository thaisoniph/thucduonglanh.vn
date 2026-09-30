/* CRM Thực Dưỡng Lành – crm.thucduonglanh.vn
 * Trang tĩnh, dữ liệu nằm trong Google Sheet, đọc/ghi qua Apps Script (backend/google-apps-script.gs, type: 'crm'). */
(function () {
  'use strict';
  var CFG = window.CRM_CONFIG || {};
  var DAY = 864e5;
  var S = { token: store('crm_token'), user: null, d: null, loading: false, loadedAt: 0, mine: store('crm_mine') === '1', f: {}, units: null };

  var TASKS = {
    callback: { icon: '📞', title: 'Hẹn gọi lại', tip: 'khách đã hẹn đến hôm nay', tpl: '' },
    d1: { icon: '📦', title: 'Hỏi nhận hàng, hướng dẫn dùng', tip: '1–3 ngày sau khi đặt', tpl: '1 ngày' },
    runout: { icon: '⏰', title: 'Sắp hết / đã hết sản phẩm', tip: 'nhắc đặt lại, đơn từ 300K được freeship', tpl: 'hết' },
    d14: { icon: '💬', title: 'Xin cảm nhận', tip: '14 ngày sau khi mua', tpl: '14' },
    d30: { icon: '🌿', title: 'Giới thiệu sản phẩm phù hợp', tip: '30 ngày sau khi mua', tpl: '30' },
    winback: { icon: '💌', title: 'Mời quay lại', tip: '60 ngày chưa mua lại', tpl: '60' }
  };
  var TASK_ORDER = ['callback', 'd1', 'runout', 'd14', 'd30', 'winback'];
  var TASK_LOG = { callback: 'Gọi lại theo hẹn', d1: 'Hỏi nhận hàng', runout: 'Nhắc đặt lại', d14: 'Xin cảm nhận', d30: 'Giới thiệu sản phẩm', winback: 'Mời quay lại', other: 'Chăm sóc' };
  var STATUS = ['Mới', 'Đã xác nhận', 'Đang giao', 'Đã giao', 'Huỷ', 'Hoàn', 'Đổi hàng'];
  var ST_CLS = { 'Mới': 'st-moi', 'Đã xác nhận': 'st-xn', 'Đang giao': 'st-giao', 'Đã giao': 'st-xong', 'Huỷ': 'st-huy', 'Hoàn': 'st-huy', 'Đổi hàng': 'st-giao' };
  function isVoid(st) { return /huỷ|hủy|hoàn/i.test(String(st || '')); } // huỷ / hoàn: không tính doanh thu
  var NEXT = { 'Mới': 'Đã xác nhận', 'Đã xác nhận': 'Đang giao', 'Đang giao': 'Đã giao' };
  var NEXT_LABEL = { 'Mới': '✅ Xác nhận', 'Đã xác nhận': '🚚 Đang giao', 'Đang giao': '📬 Đã giao' };
  var RESULTS = ['Đã đặt lại', 'Hẹn gọi lại', 'Không nghe máy', 'Đã hỏi thăm', 'Không có nhu cầu'];
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
  function when(t) { if (!t) return ''; var n = Math.round((today() - dayStart(t)) / DAY); return n === 0 ? 'Hôm nay ' + fDateTime(t).slice(0, 5) : n === 1 ? 'Hôm qua ' + fDateTime(t).slice(0, 5) : fDateTime(t); }
  function norm(s) { return String(s || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/đ/g, 'd'); }
  function normPhone(p) { p = String(p || '').replace(/\D/g, ''); if (p.indexOf('84') === 0 && p.length >= 11) p = '0' + p.slice(2); return p; }
  function fPhone(p) { p = normPhone(p); return p.length === 10 ? p.slice(0, 4) + ' ' + p.slice(4, 7) + ' ' + p.slice(7) : p; }
  function zalo(p) { return 'https://zalo.me/' + normPhone(p); }
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

  var SERVER_V = '2026-09-30k'; // phải trùng CRM_VERSION trong Apps Script
  function checkVersion(j) {
    if (!j || S._vWarned || j.v === SERVER_V) return;
    S._vWarned = true;
    if (lvl() >= 2 || (j.user && j.user.level >= 2)) toast('⚠️ Máy chủ Apps Script đang chạy bản cũ (' + (j.v || 'chưa có số phiên bản') + '), cần bản ' + SERVER_V + '. Vào Apps Script → Triển khai → Quản lý các bản triển khai → ✏️ → Phiên bản: Phiên bản mới → Triển khai.', true);
  }
  function api(action, payload) {
    var body = Object.assign({ type: 'crm', action: action, token: S.token }, payload || {});
    if (!CFG.endpoint) return Promise.reject(new Error('Chưa cấu hình máy chủ.'));
    return fetch(CFG.endpoint, { method: 'POST', headers: { 'Content-Type': 'text/plain;charset=utf-8' }, body: JSON.stringify(body) })
      .then(function (r) { return r.text(); }, function () { throw new Error('Mất kết nối mạng. Bạn thử lại nhé.'); })
      .then(function (t) { try { return JSON.parse(t); } catch (e) { throw new Error('Máy chủ Google báo lỗi (thường do việc chạy quá lâu hoặc file quá lớn). Bạn bấm lại thử; nếu vẫn lỗi, báo quản trị xem mục “Lượt thực thi” trong Apps Script.'); } })
      .then(function (j) {
        checkVersion(j);
        if (!j || !j.ok) {
          if (j && j.auth) { logout(true); }
          throw new Error((j && j.error) || 'Có lỗi, bạn thử lại nhé.');
        }
        return j;
      });
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
    renderLogin('email', '', expired ? 'Phiên đăng nhập đã hết, bạn đăng nhập lại nhé.' : '');
  }

  /* ================================================================ dữ liệu */
  function load(silent) {
    if (S.loading) return Promise.resolve();
    S.loading = true; var b = $('#refresh'); if (b) b.classList.add('spin');
    return api('load').then(function (j) {
      S.d = j; S.user = j.user; S.loadedAt = Date.now();
      S.d.byPhone = {}; j.customers.forEach(function (c) { S.d.byPhone[c.phone] = c; });
      if (!$('.top')) shell(); else { $('.me').innerHTML = meHTML(); navBadges(); }
      var ae = document.activeElement, editing = silent && ae && ae.closest && ae.closest('#view') && /INPUT|TEXTAREA|SELECT/.test(ae.tagName) && ae.type !== 'search';
      if (!editing) render(); // đang gõ dở thì không vẽ lại, tránh mất chữ
    }, function (e) { if (!silent && S.token) toast(e.message, true); if (!S.d && S.token && !$('.top')) { $('#app').innerHTML = '<div class="login"><div class="login-box"><h1>Chưa tải được dữ liệu</h1><p class="sub">' + esc(e.message) + '</p><button class="btn pri block" id="retry">Thử lại</button></div></div>'; $('#retry').onclick = function () { location.reload(); }; } })
      .then(function () { S.loading = false; var b2 = $('#refresh'); if (b2) b2.classList.remove('spin'); });
  }
  function start() {
    $('#app').innerHTML = '<div class="boot"><img src="/logo.webp" alt="" height="64"><p>Đang tải dữ liệu…</p></div>';
    load();
  }
  function cust(phone) { return S.d && S.d.byPhone[normPhone(phone)]; }
  function ordersOf(phone) { phone = normPhone(phone); return S.d.orders.filter(function (o) { return o.phone === phone; }).sort(function (a, b) { return b.time - a.time; }); }
  function logOf(ref) { return S.d.log.filter(function (l) { return String(l.ref).replace(/^'/, '') === ref; }).sort(function (a, b) { return b.time - a.time; }); }
  function mineOk(c) { return !S.mine || !c.owner || c.owner === S.user.name; }
  function tasksAll() { return S.d.customers.filter(function (c) { return c.task; }); }
  function tasksShown() { return tasksAll().filter(mineOk); }
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
  function ownerWarn(r) { return r && r.status === 'other' ? '⚠️ Số này ' + (r.lead ? 'đang là khách tiềm năng' : 'là khách hàng') + ' do <b>' + esc(r.owner) + '</b> phụ trách. Bạn không thao tác được – nhờ ' + esc(r.owner) + ' hoặc quản lý.' : ''; }
  function claimBtn(kind, id) { return '<button class="btn" data-claim="' + kind + '|' + esc(id) + '">✋ Nhận khách này</button>'; }
  function isBank(o) { return /chuyển khoản/i.test(o.payment); }
  function unpaidOrders() { return S.d.orders.filter(function (o) { return isBank(o) && !o.paid && !isVoid(o.status); }); }
  function isOpenLead(l) { return l.status === 'Mới hỏi' || l.status === 'Đang tư vấn'; }
  function leadDue(l) {
    if (!isOpenLead(l)) return null;
    if (l.callback) return dayStart(l.callback) <= today() ? 'callback' : null;
    if (!l.lastAt) return 'new';
    return (today() - dayStart(l.lastAt)) / DAY >= 3 ? 'stale' : null;
  }
  function leadMine(l) { return !S.mine || !l.owner || l.owner === S.user.name; }
  function leadsDue() { return (S.d.leads || []).filter(function (l) { return leadDue(l) && leadMine(l); }); }
  function findLead(id) { return (S.d.leads || []).filter(function (l) { return l.id === id; })[0]; }

  /* ================================================================ khung */
  var VIEWS = [
    { id: 'hom-nay', label: 'Hôm nay', icon: 'today' },
    { id: 'khach-hang', label: 'Khách hàng', icon: 'users' },
    { id: 'don-hang', label: 'Đơn hàng', icon: 'box' },
    { id: 'tiem-nang', label: 'Tiềm năng', icon: 'lead' },
    { id: 'bao-cao', label: 'Hiệu quả', icon: 'chart' },
    { id: 'cai-dat', label: 'Cài đặt', icon: 'gear' }
  ];
  function myViews() { return VIEWS.filter(function (v) { return !v.min || lvl() >= v.min; }); }
  function meHTML() { return '<b>' + esc(S.user.name) + '</b>' + esc(S.user.role); }
  function shell() {
    $('#app').innerHTML = '<header class="top"><div class="top-in">' +
      '<a class="brand" href="#hom-nay"><img src="/icon-180.png" alt="">CRM</a>' +
      '<nav class="nav">' + myViews().map(function (v) { return '<a href="#' + v.id + '" data-v="' + v.id + '">' + I[v.icon] + '<span>' + v.label + '</span></a>'; }).join('') + '</nav>' +
      '<div class="grow"></div><div class="me">' + meHTML() + '</div>' +
      '<a class="icon-btn" href="/huong-dan/crm/" target="_blank" rel="noopener" title="Hướng dẫn sử dụng" aria-label="Hướng dẫn sử dụng">' + I.help + '</a>' +
      '<button class="icon-btn" id="refresh" title="Tải lại dữ liệu" aria-label="Tải lại dữ liệu">' + I.refresh + '</button>' +
      '</div></header><main id="view"></main>';
    $('#refresh').onclick = function () { load(); };
    navBadges();
  }
  function navBadges() {
    var ld = leadsDue().length, n = { 'hom-nay': newOrders().length + tasksShown().length + ld, 'don-hang': newOrders().length, 'tiem-nang': ld };
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
    el.insertAdjacentHTML('beforeend', '<p class="updated">Cập nhật lúc ' + fDateTime(S.loadedAt) + ' · dữ liệu lưu trong Google Sheet</p>');
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
  function stTag(s) { return '<span class="tag ' + (ST_CLS[s] || '') + '">' + esc(s) + '</span>'; }
  function shortProducts(list, n) { return (list || []).slice(-(n || 2)).map(function (p) { return p.replace(/\s*\(.*\)\s*$/, ''); }).join(', '); }
  function taskLine(c) {
    var t = c.task; if (!t) return '';
    if (t.type === 'callback') return '<span class="warn-line">📞 Hẹn gọi lại ' + (t.late ? '– đã quá ' + t.late + ' ngày' : 'hôm nay') + '</span>';
    if (t.type === 'runout') return t.late ? '<span class="bad-line">Đã hết khoảng ' + t.late + ' ngày</span>' : '<span class="warn-line">' + (t.toRun === 0 ? 'Hết trong hôm nay' : 'Còn khoảng ' + t.toRun + ' ngày là hết') + '</span>';
    return 'Mua ' + t.days + ' ngày trước';
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
    return '<div class="card click" data-cust="' + c.phone + '">' +
      '<div class="r1"><b>' + esc(c.name || 'Khách') + '</b>' + groupTag(c.group) + (c.owner ? (lvl() >= 2 || c.owner !== S.user.name ? '<span class="tag owner">👤 ' + esc(c.owner) + '</span>' : '') : '<span class="tag noconsent">Chưa ai phụ trách</span>') + '<span class="end">' + (c.orders > 1 ? c.orders + ' đơn · ' : '') + moneyShort(c.spent) + '</span></div>' +
      '<div class="r2">' + fPhone(c.phone) + (c.products.length ? ' · ' + esc(shortProducts(c.products)) : '') + '</div>' +
      '<div class="r-age">' + ageTag(c) + (c.flag ? '<span class="age bad">⚠️ ' + esc(c.flag) + '</span>' : '') + '</div>' +
      '<div class="r3">' + (withTask ? taskLine(c) : 'Đơn gần nhất ' + daysAgo(c.last)) + (c.consent ? '' : ' · <span class="tag noconsent">Chỉ hỏi thăm</span>') + '</div>' +
      (withTask ? '<div class="acts"><button class="btn pri" data-care="' + c.phone + '" data-task="' + c.task.type + '">💬 Chăm sóc</button><a class="btn" href="tel:' + c.phone + '">📞 Gọi</a>' + (!c.owner && isPoolStaff() ? claimBtn('c', c.phone) : '') + '</div>'
        : !c.owner && isPoolStaff() ? '<div class="acts">' + claimBtn('c', c.phone) + '</div>' : '') +
      '</div>';
  }
  function orderCard(o, withActs) {
    var next = NEXT[o.status];
    return '<div class="card click" data-order="' + esc(o.id) + '">' +
      '<div class="r1"><b>' + esc(o.name) + '</b>' + stTag(o.status) + '<span class="end">' + money(o.total) + '</span></div>' +
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
    var no = newOrders().sort(function (a, b) { return b.time - a.time; }), ts = tasksShown(), ld = sortLeads(leadsDue());
    var up = unpaidOrders().filter(function (o) { return o.status !== 'Mới'; }).sort(function (a, b) { return a.time - b.time; });
    var t0 = today(), doneToday = S.d.log.filter(function (l) { return l.time >= t0 && l.what !== 'Cài đặt' && l.what !== 'Nhân sự'; }).sort(function (a, b) { return b.time - a.time; });
    var h = '<div class="page-head"><h1>Chào ' + esc(S.user.name) + ' 👋</h1><div class="grow"></div>' +
      (lvl() >= 2 || mode() === 'pool' ? '<label class="switch"><input type="checkbox" id="mine"' + (S.mine ? ' checked' : '') + '> Chỉ khách của tôi</label>' : '') + '</div>';
    h += '<div class="kpis">' +
      kpi('Đơn mới cần xác nhận', no.length, no.length ? 'warn' : 'good', '#don-hang') +
      kpi('Khách cần chăm sóc', ts.length, ts.length ? 'warn' : 'good') +
      kpi('Tiềm năng cần liên hệ', ld.length, ld.length ? 'bad' : 'good', '#tiem-nang') +
      kpi('Đã làm hôm nay', doneToday.length, 'good') + myGoalKpi();
    if (lvl() >= 2) {
      var m = monthStats();
      h += kpi('Doanh thu tháng ' + m.month, moneyShort(m.revenue), '', '', m.orders + ' đơn · ' + (m.prev ? (m.revenue >= m.prev ? '▲ ' : '▼ ') + 'tháng trước ' + moneyShort(m.prev) : 'chưa có tháng trước')) +
        kpi('Khách mới tháng ' + m.month, m.newCus, '', '', m.returning + ' khách mua lại');
    }
    h += '</div>';

    if (lvl() >= 2) h += waitingBlock();
    h += '<section class="section"><div class="section-h"><h2>1️⃣ Đơn mới – gọi khách xác nhận</h2>' + (no.length ? '<span class="count">' + no.length + '</span>' : '') + '<span class="tip">gọi xong bấm “Xác nhận”</span></div>' +
      (no.length ? '<div class="list cols">' + no.map(function (o) { return orderCard(o, true); }).join('') + '</div>' : empty('Không có đơn mới 🎉')) +
      (up.length ? '<div class="section-h" style="margin-top:12px"><h3>💳 Chuyển khoản chưa nhận tiền</h3><span class="count">' + up.length + '</span><span class="tip">xem tài khoản VCB, tiền về thì mở đơn bấm “Xác nhận đã nhận tiền”</span></div>' +
        '<div class="list cols">' + up.map(function (o) { return orderCard(o, false); }).join('') + '</div>' : '') + '</section>';

    h += '<section class="section"><div class="section-h"><h2>2️⃣ Chăm sóc khách</h2>' + (ts.length ? '<span class="count">' + ts.length + '</span>' : '') + '<span class="tip">bấm “Chăm sóc” → gửi tin mẫu → chọn kết quả</span></div>';
    if (!ts.length) h += empty(S.mine && tasksAll().length ? 'Khách của bạn đã chăm sóc xong. Tắt “Chỉ khách của tôi” để xem các khách khác.' : 'Hôm nay không có khách đến lịch chăm sóc 🎉');
    TASK_ORDER.forEach(function (k) {
      var arr = ts.filter(function (c) { return c.task.type === k; }); if (!arr.length) return;
      arr.sort(function (a, b) { return (b.task.late || 0) - (a.task.late || 0) || b.spent - a.spent; });
      h += '<div class="section-h" style="margin-top:12px"><h3>' + TASKS[k].icon + ' ' + TASKS[k].title + '</h3><span class="count">' + arr.length + '</span><span class="tip">' + TASKS[k].tip + '</span></div>' +
        '<div class="list cols">' + arr.map(function (c) { return custCard(c, true); }).join('') + '</div>';
    });
    h += '</section>';

    h += '<section class="section"><div class="section-h"><h2>3️⃣ Khách tiềm năng cần liên hệ</h2>' + (ld.length ? '<span class="count">' + ld.length + '</span>' : '') + '<span class="tip">người hỏi mua nhưng chưa mua</span></div>' +
      (ld.length ? '<div class="list cols">' + ld.map(leadCard).join('') + '</div>' : empty('Không có khách tiềm năng cần liên hệ 🎉')) +
      '<button class="btn" data-newlead style="margin-top:10px">＋ Thêm khách tiềm năng</button></section>';

    if (doneToday.length) h += '<section class="section"><div class="section-h"><h2>✅ Đã làm hôm nay</h2><span class="count">' + doneToday.length + '</span></div><div class="box timeline">' +
      doneToday.slice(0, 40).map(logItem).join('') + '</div></section>';
    return h;
  }
  /** Quản lý: khách / tiềm năng chưa có người phụ trách → giao ngay tại chỗ. */
  function waitingBlock() {
    var cs = S.d.customers.filter(function (c) { return !c.owner && (c.task || (c.last && today() - dayStart(c.last) <= 30 * DAY)); }).sort(function (a, b) { return (b.last || 0) - (a.last || 0); });
    var ls = (S.d.leads || []).filter(function (l) { return !l.owner && isOpenLead(l); });
    var allC = S.d.customers.filter(function (c) { return !c.owner; }).length;
    if (!cs.length && !ls.length && !allC) return '';
    var sel = function (kind, id) { return '<select class="assign" data-assign="' + kind + '|' + esc(id) + '"><option value="">Giao cho…</option>' + userNames().map(function (n) { return '<option>' + esc(n) + '</option>'; }).join('') + '</select>'; };
    return '<section class="section"><div class="section-h"><h2>🧺 Chờ giao người phụ trách</h2><span class="count">' + (cs.length + ls.length) + '</span><span class="tip">chế độ hiện tại: ' + MODE_INFO[mode()][0] + ' · đổi ở Cài đặt</span></div>' +
      (cs.length + ls.length ? '<div class="list cols">' +
        cs.slice(0, 20).map(function (c) { return '<div class="card"><div class="r1"><b>' + esc(c.name) + '</b>' + groupTag(c.group) + '<span class="end">' + moneyShort(c.spent) + '</span></div><div class="r2">' + fPhone(c.phone) + ' · mua ' + daysAgo(c.last) + '</div><div class="acts">' + sel('c', c.phone) + '</div></div>'; }).join('') +
        ls.slice(0, 20).map(function (l) { return '<div class="card"><div class="r1"><b>' + esc(l.name) + '</b>' + leadTag(l) + '<span class="end small muted">' + esc(l.channel) + '</span></div><div class="r2">' + fPhone(l.phone) + (l.interest ? ' · ' + esc(l.interest) : '') + ' · hỏi ' + daysAgo(l.time) + '</div><div class="acts">' + sel('l', l.id) + '</div></div>'; }).join('') + '</div>' : '') +
      (allC > cs.length ? '<p class="small muted">Tổng cộng ' + allC + ' khách (kể cả khách cũ) chưa ai phụ trách. Vào <a href="#cai-dat">Cài đặt → Chia khách</a> để chia đều một lần.</p>' : '') + '</section>';
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
    { k: 'task', l: 'Cần chăm sóc', f: function (c) { return !!c.task; } },
    { k: 'mine', l: 'Của tôi', f: function (c) { return c.owner === S.user.name; } },
    { k: 'noowner', l: 'Chưa ai phụ trách', f: function (c) { return !c.owner; } },
    { k: 'VIP', l: 'VIP', f: function (c) { return c.group === 'VIP'; } },
    { k: 'Quay lại', l: 'Quay lại', f: function (c) { return c.group === 'Quay lại'; } },
    { k: 'Mới', l: 'Mới', f: function (c) { return c.group === 'Mới'; } },
    { k: 'Sắp mất', l: 'Sắp mất', f: function (c) { return c.group === 'Sắp mất'; } },
    { k: 'myold', l: 'Của tôi quá 30 ngày', f: function (c) { return c.owner === S.user.name && replyOf(c).days > 30; } },
    { k: 'old', l: 'Quá 30 ngày chưa chăm sóc', f: function (c) { return replyOf(c).days > 30; } },
    { k: 'callback', l: 'Có hẹn gọi lại', f: function (c) { return !!c.callback; } }
  ];
  var SORTS = { last: ['Mua gần nhất', function (a, b) { return (b.last || 0) - (a.last || 0); }], age: ['Lâu chưa chăm sóc nhất', function (a, b) { return (replyOf(a).at || 0) - (replyOf(b).at || 0) || (a.first || 0) - (b.first || 0); }], spent: ['Chi nhiều nhất', function (a, b) { return b.spent - a.spent; }],
    runout: ['Sắp hết hàng', function (a, b) { return (a.runout || 9e15) - (b.runout || 9e15); }], name: ['Tên A–Z', function (a, b) { return a.name.localeCompare(b.name, 'vi'); }] };
  function viewCustomers() {
    var f = S.f.c || (S.f.c = { q: '', k: 'all', sort: 'last', n: 60 });
    var q = norm(f.q), qd = q.replace(/\D/g, '');
    var base = S.d.customers.filter(function (c) { return !q || norm(c.name + ' ' + c.products.join(' ') + ' ' + c.owner + ' ' + c.province).indexOf(q) >= 0 || (qd.length >= 3 && c.phone.indexOf(qd) >= 0); });
    var chips = CF.filter(function (x) { return lvl() >= 2 || isPoolStaff() || (x.k !== 'mine' && x.k !== 'noowner' && x.k !== 'myold'); });
    var cur = chips.filter(function (x) { return x.k === f.k; })[0] || chips[0];
    var list = base.filter(cur.f).sort(SORTS[f.sort][1]);
    return '<div class="page-head"><h1>Khách hàng</h1><span class="muted">' + S.d.customers.length + ' khách</span></div>' +
      '<div class="tools"><div class="search">' + I.search + '<input type="search" id="cq" placeholder="Tìm tên, số điện thoại, sản phẩm…" value="' + esc(f.q) + '"></div>' +
      '<select id="csort" style="flex:0 0 auto;width:auto">' + Object.keys(SORTS).map(function (k) { return '<option value="' + k + '"' + (f.sort === k ? ' selected' : '') + '>' + SORTS[k][0] + '</option>'; }).join('') + '</select></div>' +
      '<div class="chips">' + chips.map(function (x) { var n = base.filter(x.f).length; return '<button class="chip' + (x.k === cur.k ? ' on' : '') + '" data-cf="' + x.k + '">' + x.l + ' <em>' + n + '</em></button>'; }).join('') + '</div>' +
      (list.length ? '<div class="list cols">' + list.slice(0, f.n).map(function (c) { return custCard(c, false); }).join('') + '</div>' +
        (list.length > f.n ? '<button class="btn more" data-more="c">Xem thêm ' + Math.min(60, list.length - f.n) + ' khách</button>' : '') : empty('Không có khách nào khớp.'));
  }

  function openCustomer(phone, fromRoute) {
    var c = cust(phone); if (!c) { toast('Không tìm thấy khách', true); return; }
    if (!fromRoute) history.pushState(null, '', '#khach-hang/' + c.phone);
    var os = ordersOf(c.phone), logs = logOf(c.phone), owners = userNames();
    if (c.owner && owners.indexOf(c.owner) < 0) owners.push(c.owner);
    var body = '<div class="acts steps" style="margin-bottom:12px"><button class="btn pri" data-care="' + c.phone + '" data-task="' + (c.task ? c.task.type : 'other') + '">💬 Chăm sóc</button><a class="btn" href="tel:' + c.phone + '">📞 Gọi</a><a class="btn zalo" href="' + zalo(c.phone) + '" target="_blank" rel="noopener">Zalo</a><button class="btn" data-neworder="' + c.phone + '">＋ Tạo đơn</button></div>' +
      (c.task ? '<div class="notice">' + TASKS[c.task.type].icon + ' Hôm nay cần: <b>' + TASKS[c.task.type].title + '</b> · ' + taskLine(c) + '</div>' : '') +
      (c.flag ? '<div class="notice" style="background:var(--red-light);color:var(--red)">⚠️ Khách có nhãn <b>' + esc(c.flag) + '</b>. Nên yêu cầu chuyển khoản trước khi gửi hàng.</div>' : '') +
      (c.consent ? '' : '<div class="notice">Khách <b>chưa đồng ý nhận tin</b>: chỉ hỏi thăm, không gửi quảng cáo / ưu đãi.</div>') +
      ageBox(c) +
      '<div class="box"><div class="grid-info">' +
      info('Điện thoại', fPhone(c.phone)) + info('Nhóm', c.group) + info('Số đơn', c.orders) + info('Tổng chi', money(c.spent)) +
      info('Đơn đầu', fDate(c.first)) + info('Đơn gần nhất', fDate(c.last) + ' (' + daysAgo(c.last) + ')') +
      info('Dự kiến hết hàng', c.runout ? fDate(c.runout) + ' (' + daysAgo(c.runout) + ')' : 'chưa có chu kỳ') + info('Nguồn', c.source || '–') +
      info('Địa chỉ', [c.address, c.ward, c.province].filter(Boolean).join(', '), true) + info('Đã mua', c.products.join('; '), true) +
      '</div></div>' +
      '<div class="box"><h3>Chăm sóc</h3><div class="row2c">' +
      (lvl() >= 2 ? '<label class="f"><span>Người phụ trách</span><select id="cOwner"><option value="">– Chưa ai –</option>' + owners.map(function (n) { return '<option' + (n === c.owner ? ' selected' : '') + '>' + esc(n) + '</option>'; }).join('') + '</select></label>'
        : '<div class="f"><span style="display:block;font-size:13px;font-weight:600;color:var(--ink);margin-bottom:4px">Người phụ trách</span>' + (c.owner ? '<b>' + esc(c.owner) + '</b>' : (isPoolStaff() ? claimBtn('c', c.phone) : 'Chưa ai')) + '</div>') +
      '<label class="f"><span>Hẹn gọi lại ngày</span><input type="date" id="cCb" value="' + (c.callback ? isoDate(c.callback) : '') + '"></label></div>' +
      '<label class="f"><span>Ghi nhanh hôm nay (tự thêm ngày, như ghi trên Sheet)</span><input type="text" id="cQuick" placeholder="vd: kh dùng ok, hẹn cuối tháng lấy tiếp"></label>' +
      '<label class="f"><span>Ghi chú về khách / nhật ký</span><textarea id="cNote" rows="5">' + esc(c.note) + '</textarea></label>' +
      '<button class="btn" id="cSave">Lưu thông tin chăm sóc</button></div>' +
      '<div class="box"><h3>Đơn hàng (' + (c.orders > os.length ? os.length + ' gần đây / ' + c.orders : os.length) + ')</h3>' + (os.length ? '<div class="list" id="cOrders">' + os.map(function (o) { return orderCard(o, false); }).join('') + '</div>' : '<div id="cOrders"><p class="muted">Không có đơn trong 13 tháng gần đây.</p></div>') +
      '<button class="btn" id="cAllOrders" style="margin-top:8px">📜 Xem toàn bộ lịch sử mua (kể cả đơn cũ)</button></div>' +
      '<div class="box"><h3>Lịch sử chăm sóc (' + logs.length + ')</h3>' + (logs.length ? '<div class="timeline">' + logs.map(logItem).join('') + '</div>' : '<p class="muted">Chưa có lần chăm sóc nào trên CRM.' + (c.careAt ? ' Lần gần nhất ghi trong Sheet: ' + fDate(c.careAt) + (c.careResult ? ' – ' + esc(c.careResult) : '') : '') + '</p>') + '</div>';
    var m = modal('<span>' + esc(c.name || 'Khách') + '</span> ' + groupTag(c.group), body, null, { route: '#khach-hang', pushed: !fromRoute });
    if (c.noteCut) { // nhật ký dài: tải bản đầy đủ trước khi cho sửa
      var ta = $('#cNote', m), sv = $('#cSave', m); ta.disabled = true; sv.disabled = true; ta.value = 'Đang tải nhật ký đầy đủ…';
      api('cust_orders', { phone: c.phone }).then(function (j) { c.note = j.note; c.noteCut = false; ta.value = j.note; ta.disabled = false; sv.disabled = false; }, function (e) { ta.value = c.note; toast(e.message, true); });
    }
    $('#cAllOrders', m).onclick = function () {
      var b = this; b.disabled = true; b.textContent = 'Đang tải…';
      api('cust_orders', { phone: c.phone }).then(function (j) {
        var list = j.orders.sort(function (a, b) { return (b.time || 0) - (a.time || 0); });
        $('#cOrders', m).innerHTML = list.length ? list.map(function (o) { return '<div class="card"><div class="r1"><b>' + fDate(o.time) + '</b>' + stTag(o.status) + '<span class="end">' + money(o.total) + '</span></div><div class="r3 pre">' + esc(o.items.split('\n').map(function (l) { return l.replace(/\s*=\s*[\d.,]+\s*₫?$/, ''); }).join('\n')) + '</div><div class="r3">' + esc(o.id) + (o.seller ? ' · 👤 ' + esc(o.seller) : '') + (o.note ? ' · 📝 ' + esc(o.note) : '') + '</div></div>'; }).join('') : '<p class="muted">Chưa có đơn.</p>';
        b.remove();
      }, function (e) { toast(e.message, true); b.disabled = false; b.textContent = '📜 Xem toàn bộ lịch sử mua'; });
    };
    $('#cSave', m).onclick = function () {
      var q = $('#cQuick', m).value.trim(), noteNow = $('#cNote', m).value.trim();
      if (q) noteNow = fDate(Date.now()).slice(0, 5) + ': ' + q + (noteNow ? '\n' + noteNow : '');
      var p = { phone: c.phone, note: noteNow, callback: $('#cCb', m).value };
      if ($('#cOwner', m)) p.owner = $('#cOwner', m).value;
      var btn = this; btn.disabled = true; btn.textContent = 'Đang lưu…';
      api('customer', p).then(function () {
        if (p.owner !== undefined) c.owner = p.owner; c.note = p.note; $('#cNote', m).value = p.note; $('#cQuick', m).value = ''; c.callback = p.callback ? new Date(p.callback + 'T09:00:00+07:00').getTime() : null;
        if (c.callback && dayStart(c.callback) <= today()) c.task = { type: 'callback', late: Math.round((today() - dayStart(c.callback)) / DAY), days: 0 };
        else if (c.task && c.task.type === 'callback') c.task = null;
        toast('Đã lưu'); btn.textContent = 'Đã lưu ✓'; setTimeout(function () { btn.disabled = false; btn.textContent = 'Lưu thông tin chăm sóc'; }, 1500); refreshBehind();
      }, function (e) { toast(e.message, true); btn.disabled = false; btn.textContent = 'Lưu thông tin chăm sóc'; });
    };
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
    var key = TASKS[type] && TASKS[type].tpl, tp = S.d.templates;
    if (!key) return -1;
    for (var i = 0; i < tp.length; i++) if (norm(tp[i][0]).indexOf(norm(key)) >= 0) return i;
    return -1;
  }
  function fillTpl(text, c) {
    var name = (c.name || '').replace(/\(.*?\)/g, ' ').trim().split(/\s+/).pop() || 'anh/chị';
    return String(text).replace(/\[Tên\]/gi, name).replace(/\[Sản phẩm\]/gi, shortProducts(c.products, 2) || 'sản phẩm');
  }
  function openCare(phone, type) {
    var c = cust(phone); if (!c) return;
    type = type || (c.task ? c.task.type : 'other');
    var ti = templateFor(type), tp = S.d.templates;
    var body = (c.consent ? '' : '<div class="notice">Khách <b>chưa đồng ý nhận tin</b>: chỉ hỏi thăm sức khoẻ / hướng dẫn dùng, không gửi ưu đãi.</div>') +
      '<div class="box"><div class="r1" style="display:flex;gap:8px;align-items:center;flex-wrap:wrap"><b>' + esc(c.name) + '</b> ' + groupTag(c.group) + ' <span class="muted">' + fPhone(c.phone) + '</span></div>' +
      '<div class="small muted" style="margin-top:4px">' + esc(shortProducts(c.products, 3)) + ' · mua ' + daysAgo(c.last) + (c.note ? '<br>📝 ' + esc(c.note) : '') + '</div></div>' +
      '<div class="box"><h3>Bước 1 · Gửi tin cho khách</h3>' +
      '<label class="f"><span>Mẫu tin</span><select id="kTpl"><option value="-1">– Tự viết –</option>' + tp.map(function (t, i) { return '<option value="' + i + '"' + (i === ti ? ' selected' : '') + '>' + esc(t[0] + (t[1] ? ' – ' + t[1] : '')) + '</option>'; }).join('') + '</select></label>' +
      '<label class="f"><span>Nội dung (sửa được, nhớ điền phần “…” nếu có)</span><textarea id="kMsg" rows="6">' + esc(ti >= 0 ? fillTpl(tp[ti][2], c) : '') + '</textarea></label>' +
      '<div class="steps"><button class="btn zalo" id="kZalo">📋 Copy tin & mở Zalo</button><button class="btn" id="kCopy">Copy tin</button><a class="btn" href="tel:' + c.phone + '">📞 Gọi</a></div></div>' +
      '<div class="box"><h3>Bước 2 · Ghi kết quả</h3>' +
      '<label class="f"><span>Việc</span><select id="kTask">' + Object.keys(TASK_LOG).map(function (k) { return '<option value="' + k + '"' + (k === type ? ' selected' : '') + '>' + TASK_LOG[k] + '</option>'; }).join('') + '</select></label>' +
      '<div class="f"><span style="display:block;font-size:13px;font-weight:600;margin-bottom:6px;color:var(--ink)">Kết quả</span><div class="radios">' + RESULTS.map(function (r, i) { return '<label><input type="radio" name="kRes" value="' + esc(r) + '"' + '><span>' + esc(r) + '</span></label>'; }).join('') + '</div></div>' +
      '<label class="f" id="kCbWrap"><span>Hẹn gọi lại ngày (nếu có)</span><input type="date" id="kCb" min="' + isoDate(Date.now()) + '"></label>' +
      '<label class="f"><span>Ghi chú lần này</span><textarea id="kNote" rows="2" placeholder="Khách nói gì, cần gì…"></textarea></label><p class="err" id="kErr"></p></div>';
    var m = modal('Chăm sóc: ' + esc(c.name), body, '<button class="btn" data-close>Để sau</button><button class="btn pri" id="kSave">Lưu kết quả</button>');
    var msg = $('#kMsg', m);
    $('#kTpl', m).onchange = function () { var i = +this.value; msg.value = i >= 0 ? fillTpl(tp[i][2], c) : ''; };
    $('#kCopy', m).onclick = function () { copy(msg.value).then(function () { toast('Đã copy tin nhắn'); }); };
    $('#kZalo', m).onclick = function () { copy(msg.value).then(function () { toast('Đã copy – dán vào khung chat Zalo'); }); window.open(zalo(c.phone), '_blank', 'noopener'); };
    $$('input[name=kRes]', m).forEach(function (r) { r.onchange = function () { if (r.value === 'Hẹn gọi lại' && !$('#kCb', m).value) { $('#kCb', m).value = isoDate(Date.now() + 2 * DAY); $('#kCb', m).focus(); } }; });
    $('#kSave', m).onclick = function () {
      var res = $('input[name=kRes]:checked', m), err = $('#kErr', m);
      if (!res) { err.textContent = 'Bạn chọn kết quả giúp nhé.'; return; }
      var p = { phone: c.phone, task: $('#kTask', m).value, result: res.value, note: $('#kNote', m).value.trim(), callback: $('#kCb', m).value };
      var btn = this; btn.disabled = true; btn.textContent = 'Đang lưu…';
      api('care', p).then(function (j) {
        c.careAt = j.careAt; c.careResult = p.result; c.owner = j.owner || c.owner; c.callback = j.callback || null;
        c.task = null; // vừa chăm sóc xong → rời danh sách hôm nay
        S.d.log.push({ time: j.careAt, by: S.user.name, what: TASK_LOG[p.task], ref: c.phone, name: c.name, result: p.result, note: p.note + (p.callback ? (p.note ? ' – ' : '') + 'hẹn gọi lại ' + p.callback.split('-').reverse().join('/') : '') });
        closeModal(); toast('Đã lưu kết quả chăm sóc ✓'); navBadges(); render();
      }, function (e) { btn.disabled = false; btn.textContent = 'Lưu kết quả'; err.textContent = e.message; });
    };
  }

  /* ================================================================ ĐƠN HÀNG */
  function viewOrders() {
    var f = S.f.o || (S.f.o = { q: '', st: 'all', n: 60 });
    var q = norm(f.q), qd = q.replace(/\D/g, '');
    var base = S.d.orders.filter(function (o) { return !q || norm(o.name + ' ' + o.id + ' ' + o.items + ' ' + o.province + ' ' + o.source).indexOf(q) >= 0 || (qd.length >= 3 && o.phone.indexOf(qd) >= 0); })
      .sort(function (a, b) { return b.time - a.time; });
    var list = f.st === 'all' ? base : base.filter(function (o) { return o.status === f.st; });
    var sum = list.filter(function (o) { return !isVoid(o.status); }).reduce(function (s, o) { return s + o.total; }, 0);
    return '<div class="page-head"><h1>Đơn hàng</h1><span class="muted">' + list.length + ' đơn' + (lvl() >= 2 ? ' · ' + money(sum) : '') + '</span><div class="grow"></div><button class="btn pri" data-neworder="">＋ Tạo đơn (Zalo, điện thoại…)</button></div>' +
      '<div class="tools"><div class="search">' + I.search + '<input type="search" id="oq" placeholder="Tìm tên, SĐT, mã đơn, sản phẩm…" value="' + esc(f.q) + '"></div></div>' +
      '<div class="chips">' + ['all'].concat(STATUS).map(function (s) { var n = s === 'all' ? base.length : base.filter(function (o) { return o.status === s; }).length; return '<button class="chip' + (f.st === s ? ' on' : '') + '" data-os="' + esc(s) + '">' + (s === 'all' ? 'Tất cả' : s) + ' <em>' + n + '</em></button>'; }).join('') + '</div>' +
      (list.length ? '<div class="list cols">' + list.slice(0, f.n).map(function (o) { return orderCard(o, true); }).join('') + '</div>' +
        (list.length > f.n ? '<button class="btn more" data-more="o">Xem thêm ' + Math.min(60, list.length - f.n) + ' đơn</button>' : '') : empty('Không có đơn nào.'));
  }
  function findOrder(id) { return S.d.orders.filter(function (o) { return o.id === id; })[0]; }
  function openOrder(id, fromRoute) {
    var o = findOrder(id); if (!o) return;
    if (!fromRoute) history.pushState(null, '', '#don-hang/' + encodeURIComponent(o.id));
    var c = cust(o.phone), logs = logOf(o.id);
    var body = '<div class="acts steps" style="margin-bottom:12px"><a class="btn" href="tel:' + o.phone + '">📞 Gọi</a><a class="btn zalo" href="' + zalo(o.phone) + '" target="_blank" rel="noopener">Zalo</a>' +
      (c ? '<button class="btn" data-cust="' + c.phone + '">👤 Xem khách (' + c.orders + ' đơn)</button>' : '') + '<button class="btn" id="oCopy">📋 Copy thông tin giao hàng</button><button class="btn" id="oEdit">✏️ Sửa đơn</button></div>' +
      '<div class="box"><h3>Trạng thái</h3><div class="radios">' + STATUS.map(function (s) { return '<label><input type="radio" name="oSt" value="' + s + '"' + (s === o.status ? ' checked' : '') + '><span>' + s + '</span></label>'; }).join('') + '</div></div>' +
      '<div class="box"><div class="grid-info">' + info('Khách', o.name) + info('Điện thoại', fPhone(o.phone)) + info('Thời gian', fDateTime(o.time) + ' ' + vnDate(o.time).y) + info('Thanh toán', o.payment) +
      info('Địa chỉ', [o.address, o.ward, o.province].filter(Boolean).join(', '), true) + (o.email ? info('Email', o.email, true) : '') + info('Nguồn', o.source || '–', true) + '</div>' +
      (lvl() >= 2 ? '<label class="f" style="margin:10px 0 0"><span>Nhân viên bán (tính doanh số)</span><select id="oSeller">' + ownerOptions(o.seller, true) + '</select></label>' : '<p class="small muted" style="margin:8px 0 0">Nhân viên bán: <b>' + esc(o.seller || '–') + '</b></p>') + '</div>' +
      '<div class="box"><h3>Sản phẩm</h3><div class="pre">' + esc(o.items) + '</div>' +
      (o.ship ? '<p style="margin:10px 0 0"><b>Lên đơn:</b> ' + esc(o.ship) + ' <button class="btn ghost" id="oShipCopy" type="button">📋 Copy</button></p>' : '') +
      '<p class="small muted" style="margin:6px 0 0">Ca: <b>' + esc(o.ca || '–') + '</b> · Dòng SP: <b>' + esc(o.line || '–') + '</b> · Nguồn: ' + esc(o.source || '–') + '</p><div class="sum" style="margin-top:10px"><div><span>Tạm tính</span><b>' + money(o.subtotal) + '</b></div><div><span>Phí ship</span><b>' + (o.shipping ? money(o.shipping) : 'Miễn phí') + '</b></div><div class="total"><span>Tổng</span><b>' + money(o.total) + '</b></div></div></div>' +
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
      api('order_status', { id: o.id, row: o.row, note: note }).then(function () { o.note = note; toast('Đã lưu ghi chú'); btn.disabled = false; refreshBehind(); }, function (e) { toast(e.message, true); btn.disabled = false; });
    };
  }
  function setStatus(o, st, done) {
    if (st === o.status) return;
    var reason = '';
    if (st === 'Huỷ' || st === 'Hoàn' || st === 'Đổi hàng') { reason = prompt('Lý do ' + st.toLowerCase() + ' đơn ' + o.id + '? (không bắt buộc)', ''); if (reason === null) { render(); var r = $('input[name=oSt][value="' + o.status + '"]'); if (r) r.checked = true; return; } }
    var old = o.status; o.status = st; navBadges(); render(); if (done) done();
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
    u.forEach(function (p) { [p.n, p.f].forEach(function (nm) { var k = ' ' + norm(nm) + ' '; if (t.indexOf(k) >= 0 && (!prov || nm.length > prov._len)) { prov = p; prov._len = nm.length; } }); });
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
  function caNow() {
    var cfg = (S.d.rules && S.d.rules.ca) || {}, x = vnDate(Date.now()), dm = pad(x.d) + '/' + pad(x.m), ev = String(cfg.evening || '17:30').split(':');
    if ((cfg.holidays || ['01/01', '30/04', '01/05', '02/09']).indexOf(dm) >= 0) return 'Lễ';
    if (new Date(Date.now() + 7 * 3600e3).getUTCDay() === 0 || x.h * 60 + x.mi >= (+ev[0]) * 60 + (+ev[1] || 0)) return 'Tối/CN';
    return 'Ngày';
  }
  function openNewOrder(phone) { openOrderForm({ phone: phone }); }
  /** Form đơn hàng dùng chung: tạo đơn mới (opt.phone), chốt đơn từ khách tiềm năng (opt.lead), sửa đơn (opt.order). */
  function openOrderForm(opt) {
    opt = opt || {};
    var P = productOptions(), byLabel = {}, eo = opt.order || null, lead = opt.lead || null;
    P.forEach(function (p) { byLabel[norm(p.label)] = p; });
    var c0 = eo ? { phone: eo.phone, name: eo.name, address: eo.address, province: eo.province, ward: eo.ward, consent: eo.consent }
      : cust(opt.phone || (lead && lead.phone) || '') || (lead ? { phone: lead.phone, name: lead.name, address: '', province: '', ward: '', consent: false, isLead: true } : null);
    var names = P.map(function (p) { return p.label; }); soldNames().forEach(function (n) { if (names.indexOf(n) < 0) names.push(n); });
    var row = function (cls, it) {
      return '<div class="item2 ' + cls + '"><input type="text" class="iName" list="noProducts" placeholder="' + (cls === 'gift' ? 'Quà tặng (bỏ trống nếu không có)' : 'Gõ hoặc chọn sản phẩm') + '" value="' + esc(it ? it.name + (it.variant ? ' – ' + it.variant : '') : '') + '">' +
        '<input type="number" class="iQty" min="1" max="999" inputmode="numeric" value="' + (it ? it.qty : 1) + '" aria-label="Số lượng"><button type="button" class="rm" aria-label="Bỏ">✕</button></div>';
    };
    var start = eo ? parseItems(eo.items) : [], sItems = start.filter(function (i) { return !i.gift; }), sGifts = start.filter(function (i) { return i.gift; });
    if (!eo && lead && lead.interest) sItems = [{ name: lead.interest, variant: '', qty: 1 }];
    var ca = eo ? (eo.ca || 'Ngày') : caNow(), fullAddr = c0 ? [c0.address, c0.ward, c0.province].filter(Boolean).join(', ') : '';
    var body = '<form id="noForm" novalidate>' +
      (lead ? '<div class="notice info">🛒 Chốt đơn cho khách tiềm năng <b>' + esc(lead.name) + '</b>. Lưu đơn xong, khách tự chuyển sang “Đã chốt”.</div>' : '') +
      (eo ? '<div class="notice">Đang sửa đơn <b>' + esc(eo.id) + '</b>. Lưu xong, số đơn / tổng chi của khách được tính lại.</div>' : '') +
      '<div class="box"><h3>Khách hàng</h3><div class="row2c"><label class="f"><span>Số điện thoại *</span><input type="tel" name="phone" inputmode="tel" value="' + esc(c0 ? c0.phone : '') + '"></label>' +
      '<label class="f"><span>Tên khách *</span><input type="text" name="name" value="' + esc(c0 ? c0.name : '') + '"></label></div>' +
      '<p class="hint" id="noOld">' + (c0 && !eo && !c0.isLead ? 'Khách cũ: ' + c0.orders + ' đơn, ' + money(c0.spent) : '') + '</p><div id="noFlag"></div>' +
      '<label class="f"><span>Địa chỉ (dán nguyên 1 dòng như trên Sheet)</span><textarea name="full" rows="2" placeholder="Số nhà, đường, phường/xã, tỉnh/thành">' + esc(fullAddr) + '</textarea></label>' +
      '<p class="hint" id="noAddrHint"></p>' +
      '<details class="addr-more"><summary>Sửa tỉnh / phường</summary><div class="row2c"><label class="f"><span>Tỉnh / Thành phố</span><select name="province"><option value="">– Chọn –</option></select></label>' +
      '<label class="f"><span>Phường / Xã</span><input type="text" name="ward" list="noWards" autocomplete="off" value="' + esc(c0 ? c0.ward : '') + '"><datalist id="noWards"></datalist></label></div></details></div>' +
      '<datalist id="noProducts">' + names.map(function (n) { return '<option value="' + esc(n) + '">'; }).join('') + '</datalist>' +
      '<div class="box"><h3>Sản phẩm</h3><div class="items" id="noItems">' + (sItems.length ? sItems.map(function (i) { return row('prod', i); }).join('') : row('prod')) + '</div><button type="button" class="btn" id="noAdd" style="margin-top:8px">＋ Thêm sản phẩm</button>' +
      '<h3 style="margin-top:14px">🎁 Quà tặng</h3><div class="items" id="noGifts">' + (sGifts.length ? sGifts.map(function (i) { return row('gift', i); }).join('') : row('gift')) + '</div><button type="button" class="btn" id="noAddGift" style="margin-top:8px">＋ Thêm quà</button></div>' +
      '<div class="box"><div class="row2c"><label class="f"><span>Số tiền thu khách *</span><input type="text" name="total" inputmode="decimal" autocomplete="off" placeholder="vd 1800000 hoặc 1tr8" value="' + (eo ? eo.total : '') + '"></label>' +
      '<label class="f"><span>Phí ship tính riêng (nếu có)</span><input type="number" name="shipping" min="0" step="1000" inputmode="numeric" value="' + (eo ? eo.shipping : 0) + '"></label></div><p class="hint" id="noTotalHint"></p>' +
      '<div class="f"><span class="lbl">Ca (để tính lương)</span><div class="radios">' + ['Ngày', 'Tối/CN', 'Lễ'].map(function (c) { return '<label><input type="radio" name="ca" value="' + c + '"' + (c === ca ? ' checked' : '') + '><span>' + (c === 'Ngày' ? '☀️ Ca ngày' : c === 'Tối/CN' ? '🌙 Tối / Chủ nhật' : '🎉 Lễ') + '</span></label>'; }).join('') + '</div></div>' +
      '<div class="f"><span class="lbl">Thanh toán</span><div class="radios"><label><input type="radio" name="payment" value="cod"' + (eo && isBank(eo) ? '' : ' checked') + '><span>COD (trả khi nhận)</span></label><label><input type="radio" name="payment" value="bank"' + (eo && isBank(eo) ? ' checked' : '') + '><span>Chuyển khoản</span></label></div></div>' +
      (eo ? '<label class="f"><span>Lý do sửa (không bắt buộc)</span><input type="text" name="reason" placeholder="vd: khách đổi sang hộp 400g"></label>' :
        (lead ? '' : '<label class="f"><span>Khách đặt qua</span><select name="source">' + SOURCES.map(function (s) { return '<option>' + s + '</option>'; }).join('') + '</select></label>') +
        '<div class="f"><span class="lbl">Trạng thái</span><div class="radios"><label><input type="radio" name="status" value="Đã xác nhận" checked><span>Đã chốt với khách</span></label><label><input type="radio" name="status" value="Mới"><span>Chưa xác nhận</span></label></div></div>' +
        '<label class="f"><span>Ghi chú</span><textarea name="note" rows="2"></textarea></label>' +
        '<label class="switch"><input type="checkbox" name="consent"' + (c0 && c0.consent ? ' checked' : '') + '> Khách đồng ý nhận tin ưu đãi</label>') + '</div>' +
      '<div class="box"><h3>📦 Lên đơn</h3><p class="pre" id="noShip" style="margin:0 0 8px"></p><button type="button" class="btn" id="noCopy">📋 Copy nội dung lên đơn</button><p class="hint" style="margin:8px 0 0">' + (eo ? 'Mã đơn: <b>' + esc(eo.id) + '</b>' : 'Mã đơn tự tạo khi lưu, theo kiểu Tên + ngày, ví dụ ' + esc((S.user.prefix || slugName(S.user.name)) + fDate(Date.now()).replace(/\//g, '').replace(/^(\d{4})\d{2}(\d{2})$/, '$1$2') + '-01')) + '</p></div>' +
      '<p class="err" id="noErr"></p></form>';
    var m = modal(eo ? 'Sửa đơn ' + esc(eo.id) : lead ? 'Chốt đơn: ' + esc(lead.name) : 'Lên đơn mới', body, '<button class="btn" data-close>Huỷ</button><button class="btn pri" id="noSave">Lưu đơn</button>');
    var form = $('#noForm', m), F = form.elements, items = $('#noItems', m), gifts = $('#noGifts', m), prov = F.province, ward = F.ward, totalEdited = !!eo;
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
    function addrChanged() { var d = detectAddr(F.full.value); if (d.province) setProvince(d.province, d.ward || ward.value); else addrHint(); }
    prov.onchange = function () { fillWards(); addrHint(); }; ward.addEventListener('input', addrHint);
    F.full.addEventListener('input', function () { clearTimeout(F.full._t); F.full._t = setTimeout(addrChanged, 300); });
    function flagOf(c) { return c && c.flag ? '<div class="notice">⚠️ Khách có nhãn <b>' + esc(c.flag) + '</b>. Kiểm tra kỹ trước khi gửi hàng (nên chuyển khoản trước).</div>' : ''; }
    $('#noFlag', m).innerHTML = flagOf(c0);
    F.phone.addEventListener('input', function () {
      var c = cust(this.value), hint = $('#noOld', m);
      hint.textContent = c ? 'Khách cũ: ' + c.name + ' · ' + c.orders + ' đơn, ' + money(c.spent) + ' – đã điền sẵn thông tin' : '';
      $('#noFlag', m).innerHTML = flagOf(c);
      if (!c && lvl() < 2) checkPhone(this.value, function (r) { if (r && r.status === 'other') hint.innerHTML = ownerWarn(r); });
      if (c) { if (!F.name.value) F.name.value = c.name; if (!F.full.value.trim()) { F.full.value = [c.address, c.ward, c.province].filter(Boolean).join(', '); if (c.province) setProvince(c.province, c.ward); } if (F.consent) F.consent.checked = c.consent; }
    });
    function read(box) {
      return $$('.item2', box).map(function (r) {
        var t = $('.iName', r).value.trim(), q = Math.max(0, parseInt($('.iQty', r).value, 10) || 0); if (!t || !q) return null;
        var p = byLabel[norm(t)], parts = t.split(' – ');
        return p ? { name: p.name, variant: p.variant, qty: q, price: p.price } : { name: parts[0], variant: parts.slice(1).join(' – '), qty: q, price: 0 };
      }).filter(Boolean);
    }
    function shipLine(ls, gs) { return ls.map(function (i) { return i.qty + ' ' + i.name + (i.variant ? ' ' + i.variant : ''); }).concat(gs.map(function (i) { return i.qty + ' ' + i.name + (i.variant ? ' ' + i.variant : '') + ' (quà)'; })).join(', '); }
    function calc() {
      var ls = read(items), gs = read(gifts), base = ls.reduce(function (s, i) { return s + i.qty * i.price; }, 0), ship = Math.max(0, +F.shipping.value || 0);
      if (!totalEdited && base) F.total.value = base + ship;
      var tot = moneyIn(F.total.value);
      $('#noTotalHint', m).innerHTML = (tot ? '= <b>' + money(tot) + '</b>' : '') + (base ? ' · giá niêm yết ' + money(base) + (tot && tot - ship !== base ? ' (bạn đang bán ' + (tot - ship > base ? 'cao' : 'thấp') + ' hơn ' + money(Math.abs(tot - ship - base)) + ')' : '') : '');
      $('#noShip', m).textContent = shipLine(ls, gs) || '–';
      $('#noSave', m).textContent = tot ? 'Lưu đơn · ' + money(tot) : 'Lưu đơn';
    }
    [items, gifts].forEach(function (box) {
      box.addEventListener('input', calc);
      box.addEventListener('click', function (e) { if (e.target.classList.contains('rm')) { var r = e.target.closest('.item2'); if ($$('.item2', box).length > 1) r.remove(); else { $('.iName', r).value = ''; $('.iQty', r).value = 1; } calc(); } });
    });
    $('#noAdd', m).onclick = function () { items.insertAdjacentHTML('beforeend', row('prod')); $('.item2:last-child .iName', items).focus(); };
    $('#noAddGift', m).onclick = function () { gifts.insertAdjacentHTML('beforeend', row('gift')); $('.item2:last-child .iName', gifts).focus(); };
    F.total.addEventListener('input', function () { totalEdited = true; calc(); });
    F.shipping.addEventListener('input', calc);
    $('#noCopy', m).onclick = function () {
      var addr = F.full.value.trim(); copy(F.name.value.trim() + ' – ' + normPhone(F.phone.value) + '\n' + addr + '\n' + $('#noShip', m).textContent + '\nThu: ' + money(moneyIn(F.total.value)) + ($('input[name=payment]:checked', form).value === 'bank' ? ' (đã chuyển khoản)' : ' (COD)')).then(function () { toast('Đã copy nội dung lên đơn'); });
    };
    calc();
    $('#noSave', m).onclick = function () {
      var err = $('#noErr', m), ph = normPhone(F.phone.value), ls = read(items), gs = read(gifts), tot = moneyIn(F.total.value), ship = Math.max(0, +F.shipping.value || 0);
      if (!/^0\d{9,10}$/.test(ph)) { err.textContent = 'Số điện thoại chưa đúng (10 số, bắt đầu bằng 0).'; F.phone.focus(); return; }
      if (!F.name.value.trim()) { err.textContent = 'Nhập tên khách.'; F.name.focus(); return; }
      if (!ls.length) { err.textContent = 'Nhập ít nhất 1 sản phẩm.'; return; }
      if (!tot) { err.textContent = 'Nhập số tiền thu khách.'; F.total.focus(); return; }
      if (tot < ship) { err.textContent = 'Số tiền thu khách nhỏ hơn phí ship.'; return; }
      ls.forEach(function (i) { if (!i.price) i.price = Math.round((tot - ship) / ls.length / i.qty); }); // chưa có giá niêm yết: chia đều, máy tính lại theo tổng
      var btn = this; btn.disabled = true; btn.textContent = 'Đang lưu…'; err.textContent = '';
      var full = F.full.value.trim(), cu = { phone: ph, name: F.name.value.trim(), province: prov.value, ward: ward.value.trim(), address: full };
      var common = { customer: cu, items: ls, gifts: gs, total: tot, shipping: ship, payment: $('input[name=payment]:checked', form).value, ca: ($('input[name=ca]:checked', form) || {}).value };
      var fail = function (e) { btn.disabled = false; calc(); err.textContent = e.message; };
      if (eo) {
        common.id = eo.id; common.row = eo.row; common.reason = F.reason.value.trim();
        api('order_edit', common).then(function () { closeModal(true); toast('Đã sửa đơn ' + eo.id + ' ✓'); history.replaceState(null, '', '#don-hang'); load(true); }, fail);
        return;
      }
      cu.note = F.note.value.trim(); common.status = $('input[name=status]:checked', form).value; common.source = F.source ? F.source.value : ''; common.consent = F.consent.checked; common.leadId = lead ? lead.id : '';
      api('order_create', common).then(function (j) {
        if (lead) { lead.status = 'Đã chốt'; lead.orderId = j.id; lead.callback = null; }
        closeModal(); toast('Đã tạo đơn ' + j.id + ' ✓'); location.hash = '#don-hang'; load(true);
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
      '<div class="r2">' + fPhone(l.phone) + (l.interest ? ' · Quan tâm: ' + esc(l.interest) : '') + '</div>' +
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
  function viewLeads() {
    var f = S.f.t || (S.f.t = { q: '', k: 'due', n: 60 });
    var q = norm(f.q), qd = q.replace(/\D/g, '');
    var base = (S.d.leads || []).filter(function (l) { return !q || norm(l.name + ' ' + l.interest + ' ' + l.channel + ' ' + l.owner + ' ' + l.note).indexOf(q) >= 0 || (qd.length >= 3 && l.phone.indexOf(qd) >= 0); });
    var cur = LF.filter(function (x) { return x.k === f.k; })[0] || LF[0], list = sortLeads(base.filter(cur.f));
    return '<div class="page-head"><h1>Khách tiềm năng</h1><span class="muted">người hỏi mua nhưng chưa mua</span><div class="grow"></div><button class="btn pri" data-newlead>＋ Thêm khách tiềm năng</button></div>' +
      '<div class="tools"><div class="search">' + I.search + '<input type="search" id="tq" placeholder="Tìm tên, số điện thoại, sản phẩm quan tâm…" value="' + esc(f.q) + '"></div></div>' +
      '<div class="chips">' + LF.map(function (x) { return '<button class="chip' + (x.k === f.k ? ' on' : '') + '" data-tf="' + esc(x.k) + '">' + x.l + ' <em>' + base.filter(x.f).length + '</em></button>'; }).join('') + '</div>' +
      (list.length ? '<div class="list cols">' + list.slice(0, f.n).map(leadCard).join('') + '</div>' +
        (list.length > f.n ? '<button class="btn more" data-more="t">Xem thêm ' + Math.min(60, list.length - f.n) + ' khách</button>' : '')
        : empty(f.k === 'due' ? 'Không có khách tiềm năng cần liên hệ 🎉' : 'Chưa có khách nào ở mục này.'));
  }

  function openLead(id, fromRoute) {
    var l = findLead(id); if (!l) return;
    if (!fromRoute) history.pushState(null, '', '#tiem-nang/' + encodeURIComponent(l.id));
    var c = cust(l.phone), open = isOpenLead(l);
    var logs = logOf(l.phone).filter(function (x) { return x.what === 'Tư vấn' || x.what === 'Thêm tiềm năng'; });
    var body = '<div class="acts steps" style="margin-bottom:12px">' + (open ? '<button class="btn pri" data-consult="' + esc(l.id) + '">💬 Tư vấn</button>' : '') +
      '<a class="btn" href="tel:' + l.phone + '">📞 Gọi</a><a class="btn zalo" href="' + zalo(l.phone) + '" target="_blank" rel="noopener">Zalo</a>' +
      (open ? '<button class="btn" data-leadorder="' + esc(l.id) + '">🛒 Chốt đơn</button>' : '') + '<button class="btn" data-editlead="' + esc(l.id) + '">✏️ Sửa</button></div>' +
      (c ? '<div class="notice info">👤 Số này đã là khách hàng: <b>' + esc(c.name) + '</b> · ' + c.orders + ' đơn, ' + money(c.spent) + ' <button class="btn" data-cust="' + c.phone + '" style="margin-left:6px">Xem khách</button></div>' : '') +
      (open && leadDueLine(l) ? '<div class="notice">' + leadDueLine(l) + '</div>' : '') +
      '<div class="r-age" style="margin:0 0 12px">' + leadAge(l) + '</div>' +
      '<div class="box"><div class="grid-info">' + info('Điện thoại', fPhone(l.phone)) + info('Trạng thái', l.status) + info('Kênh', l.channel) + info('Quan tâm', l.interest || '–') +
      info('Phụ trách', l.owner || '– Chưa ai –') + info('Ngày hỏi', fDate(l.time)) + info('Lần liên hệ gần nhất', l.lastAt ? fDate(l.lastAt) + ' (' + daysAgo(l.lastAt) + ')' : 'chưa liên hệ') +
      info('Hẹn liên hệ lại', l.callback ? fDate(l.callback) : '–') + (l.reason ? info('Lý do không mua', l.reason, true) : '') + (l.orderId ? info('Mã đơn', l.orderId, true) : '') + '</div></div>' +
      '<div class="box"><h3>Ghi chú</h3><div class="pre">' + (l.note ? esc(l.note) : '<span class="muted">Chưa có ghi chú.</span>') + '</div></div>' +
      '<div class="box"><h3>Lịch sử tư vấn (' + logs.length + ')</h3>' + (logs.length ? '<div class="timeline">' + logs.map(logItem).join('') + '</div>' : '<p class="muted">Chưa có.</p>') + '</div>';
    modal(esc(l.name || 'Khách tiềm năng') + ' ' + leadTag(l), body, null, { route: '#tiem-nang', pushed: !fromRoute });
  }

  function ownerOptions(sel, withEmpty) {
    var names = userNames(); if (sel && names.indexOf(sel) < 0) names.push(sel);
    return (withEmpty ? '<option value="">– Chưa ai –</option>' : '') + names.map(function (n) { return '<option' + (n === sel ? ' selected' : '') + '>' + esc(n) + '</option>'; }).join('');
  }
  function productNames() { var seen = {}; return (CFG.products || []).map(function (p) { return p.name; }).filter(function (n) { if (seen[n]) return false; seen[n] = 1; return true; }); }

  /** Thêm mới hoặc sửa thông tin khách tiềm năng. */
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
    var m = modal(edit ? 'Sửa: ' + esc(l.name) : 'Thêm khách tiềm năng', body, '<button class="btn" data-close>Huỷ</button><button class="btn pri" id="lfSave">Lưu</button>');
    var F = $('#lfForm', m).elements, hint = $('#lfHint', m);
    function check() {
      var ph = normPhone(F.phone.value), c = cust(ph), ol = (S.d.leads || []).filter(function (x) { return x.phone === ph && isOpenLead(x) && x.id !== l.id; })[0];
      hint.innerHTML = c ? '👤 Số này đã là khách hàng: <b>' + esc(c.name) + '</b> (' + c.orders + ' đơn).' : ol ? 'Số này đang có trong danh sách tiềm năng (' + esc(ol.status) + ', ' + esc(ol.owner || 'chưa ai phụ trách') + '). Lưu sẽ ghi nối vào đó, không tạo trùng.' : '';
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
      var p = { id: l.id, result: o.v, note: $('#cNote', m).value.trim(), callback: o.lost || o.close ? '' : $('#cCb', m).value, status: o.lost ? 'Không mua' : 'Đang tư vấn', reason: reason };
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

  /** Số liệu của 1 nhân viên (name) hoặc cả nhóm (name = null) trong khoảng thời gian R. */
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
    var mine = S.d.customers.filter(function (c) { return name === null ? true : c.owner === name; });
    return { sales: sales, orders: os.length, avg: os.length ? Math.round(sales / os.length) : 0, oldRev: oldRev, oldPct: pct(oldRev, sales), won: won, lost: lost, closePct: won + lost ? pct(won, won + lost) : null,
      care: care.length, replied: replied, replyPct: care.length ? pct(replied, care.length) : null, reorder: care.filter(function (l) { return l.result === 'Đã đặt lại'; }).length,
      stale: mine.filter(function (c) { return replyOf(c).days > 30; }).length, mine: mine.length };
  }
  /** Mũi tên so với tháng trước. kind: 'money' | 'count' | 'rate' (điểm %) */
  function delta(cur, prev, kind) {
    if (cur === null || prev === null || prev === undefined) return '<em class="delta">tháng trước chưa có số liệu</em>';
    if (kind === 'rate') { var d = cur - prev; return d === 0 ? '<em class="delta">bằng tháng trước</em>' : '<em class="delta ' + (d > 0 ? 'up' : 'down') + '">' + (d > 0 ? '▲ ' : '▼ ') + Math.abs(d) + ' điểm so với tháng trước</em>'; }
    if (!prev) return cur ? '<em class="delta up">▲ tháng trước chưa có</em>' : '<em class="delta">tháng trước chưa có số liệu</em>';
    var p = Math.round((cur - prev) * 100 / prev);
    return p === 0 ? '<em class="delta">bằng tháng trước</em>' : '<em class="delta ' + (p > 0 ? 'up' : 'down') + '">' + (p > 0 ? '▲ ' : '▼ ') + Math.abs(p) + '% so với tháng trước</em>';
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
    var f = S.f.r || (S.f.r = { m: monthOf(Date.now()), who: lvl() >= 2 ? 'team' : S.user.name });
    if (lvl() < 2) f.who = S.user.name;
    var cur = monthOf(Date.now());
    var monthChips = '<div class="chips">' + [cur, shiftMonth(cur, -1), shiftMonth(cur, -2)].map(function (k, i) { return '<button class="chip' + (k === f.m ? ' on' : '') + '" data-mon="' + k + '">' + (i === 0 ? 'Tháng này' : i === 1 ? 'Tháng trước' : monthLabel(k)) + '</button>'; }).join('') + '</div>';
    var tabs = lvl() >= 2 ? '<div class="chips">' + '<button class="chip' + (f.who === 'team' ? ' on' : '') + '" data-who="team">👥 Cả nhóm</button><button class="chip' + (f.who === S.user.name ? ' on' : '') + '" data-who="' + esc(S.user.name) + '">👤 Của tôi</button>' +
      (f.who !== 'team' && f.who !== S.user.name ? '<button class="chip on">👤 ' + esc(f.who) + '</button>' : '') + '</div>' : '';
    return '<div class="page-head"><h1>Hiệu quả</h1><span class="muted">' + monthLabel(f.m) + '</span></div>' + tabs + monthChips +
      (f.who === 'team' ? viewTeam(f.m) : viewPerson(f.who, f.m));
  }

  function viewPerson(name, month) {
    var R = monthRange(month), P = monthRange(shiftMonth(month, -1)), c = perf(name, R), p = perf(name, P), me = name === S.user.name;
    var h = (lvl() >= 2 && !me ? '<button class="btn ghost" data-who="team" style="margin-bottom:10px">← Quay lại cả nhóm</button>' : '') +
      targetBlock(name, month, c.sales, me || lvl() >= 2) +
      '<button class="btn" data-bcdt="' + esc(name) + '|' + month + '" style="margin:0 0 16px">📊 Bảng BCDT ' + monthLabel(month) + '</button>';
    h += '<section class="section"><div class="section-h"><h2>💰 Bán hàng</h2></div><div class="metrics">' +
      metric('Doanh số', moneyShort(c.sales), 'Tổng tiền ' + c.orders + ' đơn ' + (me ? 'bạn' : '') + ' bán (không tính đơn huỷ).', delta(c.sales, p.sales)) +
      metric('Giá trị trung bình / đơn', c.orders ? moneyShort(c.avg) : '–', 'Doanh số chia số đơn. Tư vấn mua kèm, mua combo thì số này tăng.', c.orders ? delta(c.avg, p.orders ? p.avg : 0) : '') +
      metric('Tỷ lệ chốt', c.closePct === null ? '–' : c.closePct + '%', c.won + ' khách chốt / ' + (c.won + c.lost) + ' khách tiềm năng đã có kết quả.', delta(c.closePct, p.closePct, 'rate'), '#tiem-nang') +
      metric('Doanh thu từ khách cũ', c.sales ? c.oldPct + '%' : '–', moneyShort(c.oldRev) + ' từ khách mua lại. Chăm sóc tốt thì số này tăng.', c.sales ? delta(c.oldPct, p.sales ? p.oldPct : null, 'rate') : '') +
      '</div></section>';
    h += '<section class="section"><div class="section-h"><h2>💬 Chăm sóc khách</h2></div><div class="metrics">' +
      metric('Lượt chăm sóc', c.care, (c.replyPct === null ? 'Chưa có lượt nào.' : c.replyPct + '% lượt khách có trả lời (' + c.replied + '/' + c.care + ').'), delta(c.care, p.care)) +
      metric('Khách đặt lại', c.reorder, 'Số lần chăm sóc có kết quả “Đã đặt lại”.', delta(c.reorder, p.reorder)) +
      metric('Quá 30 ngày chưa chăm sóc', c.stale, (c.stale ? 'Bấm vào để xem danh sách cần gọi.' : 'Tốt lắm, không bỏ quên khách nào.') + ' Tính trên ' + c.mine + ' khách phụ trách.', '', me ? '#khach-hang" data-myold="1' : '') +
      '</div></section>';
    h += '<p class="small muted">Doanh số tính theo “Nhân viên bán” ghi trên từng đơn. Đơn khách tự đặt trên web được tính cho người đang phụ trách khách đó.</p>';
    return h;
  }

  function viewTeam(month) {
    var R = monthRange(month), all = perf(null, R), tt = teamTarget(month);
    var names = userNames(); S.d.orders.forEach(function (o) { if (o.seller && names.indexOf(o.seller) < 0) names.push(o.seller); });
    var h = targetBlockTeam(all.sales, tt, month) + '<button class="btn" data-bcdt="|' + month + '" style="margin:0 0 16px">📊 Bảng BCDT cả nhóm ' + monthLabel(month) + '</button>';
    h += '<div class="kpis">' + kpi('Doanh thu', moneyShort(all.sales), 'good', '', all.orders + ' đơn') + kpi('TB / đơn', all.orders ? moneyShort(all.avg) : '–', '', '', 'giá trị trung bình') +
      kpi('Tỷ lệ chốt', all.closePct === null ? '–' : all.closePct + '%', '', '', all.won + ' chốt · ' + all.lost + ' không mua') + kpi('Từ khách cũ', all.sales ? all.oldPct + '%' : '–', '', '', moneyShort(all.oldRev)) + '</div>';
    var rows = names.map(function (n) { var p = perf(n, R); p.n = n; p.t = targetOf(n, month); return p; }).sort(function (a, b) { return b.sales - a.sales; });
    h += '<section class="section"><div class="section-h"><h2>Theo nhân viên</h2><span class="tip">bấm vào từng người để xem chi tiết, đặt mục tiêu</span></div><div class="list cols">' +
      rows.map(function (r) {
        var p = r.t && r.t.amount ? r.sales / r.t.amount : null;
        return '<div class="card click" data-who="' + esc(r.n) + '"><div class="r1"><b>' + esc(r.n) + '</b><span class="end">' + money(r.sales) + '</span></div>' +
          (p === null ? '<div class="r3">🎯 Chưa đặt mục tiêu</div>' : '<div class="bar sm"><i style="width:' + Math.min(100, p * 100).toFixed(1) + '%"></i></div><div class="r3">🎯 ' + Math.round(p * 100) + '% mục tiêu ' + moneyShort(r.t.amount) + '</div>') +
          '<div class="r3">' + r.orders + ' đơn · TB ' + (r.orders ? moneyShort(r.avg) : '–') + ' · Chốt ' + (r.closePct === null ? '–' : r.closePct + '%') + ' · Khách cũ ' + (r.sales ? r.oldPct + '%' : '–') + '</div>' +
          '<div class="r3">💬 ' + r.care + ' lượt chăm sóc · ' + r.reorder + ' đặt lại' + (r.stale ? ' · <span class="bad-line">' + r.stale + ' khách quá 30 ngày</span>' : '') + '</div></div>';
      }).join('') + '</div></section>';
    var noSeller = S.d.orders.filter(function (o) { return !isVoid(o.status) && o.time >= R[0] && o.time < R[1] && !o.seller; });
    if (noSeller.length) h += '<div class="notice">' + noSeller.length + ' đơn (' + money(noSeller.reduce(function (s, o) { return s + o.total; }, 0)) + ') chưa có nhân viên bán, thường là khách mới tự đặt trên web. Mở đơn → mục “Nhân viên bán” để gán.</div>';
    var leads = S.d.leads || [], reasons = {}, lostN = 0;
    leads.forEach(function (l) { if (l.status === 'Không mua' && l.lastAt >= R[0] && l.lastAt < R[1]) { var r = l.reason || 'Không ghi'; reasons[r] = (reasons[r] || 0) + 1; lostN++; } });
    var rk = Object.keys(reasons).sort(function (a, b) { return reasons[b] - reasons[a]; });
    if (rk.length) h += '<section class="section"><div class="section-h"><h2>Vì sao khách tiềm năng không mua</h2></div><div class="box">' + rk.map(function (r) { return '<div class="reason"><span>' + esc(r) + '</span><b>' + reasons[r] + '</b><div class="bar sm"><i style="width:' + pct(reasons[r], lostN) + '%"></i></div></div>'; }).join('') + '</div></section>';
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
      : '<p class="hint" style="margin:0 0 10px">Số quảng cáo mới trong file chung sẽ tự vào mục <b>Tiềm năng</b> của đúng sale (theo tên ở cột Sale). Tên sale trong file khai ở Nhân sự → “Tên trong file QC”.</p><button class="btn" data-adsedit>⚙️ Kết nối file số quảng cáo</button>') + '</div>';
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
    var roles = ads ? { skip: 'Không lấy', ads: '✅ Lấy số từ sheet này' } : ROLE_LABEL, role = sh.role;
    var fields = ROLE_FIELDS[ads ? 'ads' : role] || [];
    var mapped = {}; Object.keys(sh.map || {}).forEach(function (k) { mapped[sh.map[k]] = 1; });
    if (sh.pending) return '<div class="sheet-cfg unread" data-si="' + i + '"><div class="r1"><b>' + esc(sh.name) + '</b><span class="muted small">⏳ đang đọc…</span></div></div>';
    if (sh.failed) return '<div class="sheet-cfg" data-si="' + i + '"><div class="r1"><b>' + esc(sh.name) + '</b><span class="bad-line small">Không đọc được: ' + esc(sh.failed) + '</span><select class="role" style="display:none"><option value="skip">skip</option></select></div></div>';
    return '<div class="sheet-cfg' + (sh.unread ? ' unread' : '') + '" data-si="' + i + '"><div class="r1"><b>' + esc(sh.name) + '</b><span class="muted small">' + (sh.unread ? 'sheet báo cáo – không nhập' : (sh.rows || 0) + ' dòng') + '</span>' +
      '<select class="role" style="margin-left:auto;width:auto">' + Object.keys(roles).map(function (k) { return '<option value="' + k + '"' + (k === role || (ads && k === 'ads' && sh.on) ? ' selected' : '') + '>' + roles[k] + '</option>'; }).join('') + '</select></div>' +
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
      '<p class="hint">Chưa có tên sale trong danh sách? Thêm ở <b>Cài đặt → Nhân sự</b> trước.</p><button class="btn pri" id="srcRead">📖 Đọc file</button><p class="err" id="srcErr"></p></div><div id="srcSheets"></div>';
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
      var cfg = { sheets: readSheetCfg(m, info.sheets) };
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
      if (sh.role === 'orders') el.innerHTML = '<b>' + r.newOrders + '</b> đơn mới · ' + r.dup + ' đơn đã có · ' + r.skip + ' dòng bỏ qua (thiếu SĐT / ngày / sản phẩm)<br>' + (r.approx ? 'khoảng ' : '') + r.customers + ' khách (' + r.newCustomers + ' khách mới với CRM) · doanh thu ' + money(r.revenue) + (r.from ? ' · từ ' + fDate(r.from) + ' đến ' + fDate(r.to) : '') + conflictHtml(r);
      else if (sh.role === 'care') el.innerHTML = r.people + ' người trong sổ' + (r.from ? ' (từ dòng ' + (r.from + 1) + ')' : '') + ' · <b>' + r.notes + '</b> khách được ghép nhật ký cũ · <b>' + r.newLeads + '</b> người chưa mua → Tiềm năng (' + r.openLeads + ' còn theo dõi, số còn lại ghi “Không mua – dữ liệu cũ”)' + conflictHtml(r);
      else el.innerHTML = r.summary;
    }
    function conflictHtml(r) { return r.conflictCount ? '<br><span class="warn-line">⚠️ ' + r.conflictCount + ' khách đang do sale khác phụ trách (giữ người cũ):</span> ' + r.conflicts.slice(0, 12).map(function (c) { return esc(c.name || fPhone(c.phone)) + ' → ' + esc(c.owner); }).join(', ') + (r.conflictCount > 12 ? '…' : '') : ''; }
    var CHUNK = 1500;
    function addUp(acc, r) { // cộng dồn kết quả các phần
      if (!acc) return r;
      ['newOrders', 'dup', 'skip', 'revenue', 'conflictCount'].forEach(function (k) { acc[k] = (acc[k] || 0) + (r[k] || 0); });
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
        (r.skipped ? '<p class="hint" style="margin:0">' + r.skipped + ' số của sale chưa có trong CRM (hoặc chưa chia) → bỏ qua.</p>' : '') + (r.writes ? '<p class="hint">CRM đã ghi tên sale cho ' + r.writes + ' số.</p>' : '') + '</div>', '<button class="btn pri" data-close>Đóng</button>');
      if (!dry) load(true);
    }, function (e) { btn.disabled = false; btn.textContent = t; toast(e.message, true); });
  }

  /* ================================================================ BCDT – báo cáo doanh thu tháng theo mẫu của sale */
  function lineOfTxt(t) { t = String(t || ''); return /progomax|fucoidan pro|fu ?pro/i.test(t) ? 'Fucoidan Pro' : /curcumin|nghệ/i.test(t) ? 'Curcumin' : /bữa ăn|badd|bua an/i.test(t) ? 'BADD' : 'Khác'; }
  var BC_LINES = ['Curcumin', 'BADD', 'Fucoidan Pro', 'Khác'];
  function bcdtData(name, month) {
    var R = monthRange(month), days = Math.round((R[1] - R[0]) / DAY), rows = [], tot = null, ca = { 'Ngày': [0, 0], 'Tối/CN': [0, 0], 'Lễ': [0, 0] };
    var mine = function (o) { return name === null || o.seller === name; };
    var blank = function () { var r = { newN: {}, newD: {}, newR: {}, oldN: {}, oldR: {}, hoanN: 0, hoanV: 0 }; BC_LINES.forEach(function (l) { r.newN[l] = 0; r.newD[l] = 0; r.newR[l] = 0; r.oldN[l] = 0; r.oldR[l] = 0; }); return r; };
    tot = blank();
    for (var d = 0; d < days; d++) rows.push(Object.assign(blank(), { day: R[0] + d * DAY }));
    S.d.orders.forEach(function (o) {
      if (!o.time || o.time < R[0] || o.time >= R[1] || !mine(o)) return;
      var r = rows[Math.floor((o.time - R[0]) / DAY)], l = o.line || lineOfTxt(o.items);
      if (BC_LINES.indexOf(l) < 0) l = 'Khác';
      if (/hoàn/i.test(o.status)) { r.hoanN++; r.hoanV += o.total; tot.hoanN++; tot.hoanV += o.total; return; }
      if (isVoid(o.status)) return;
      var c = cust(o.phone), isNew = !c || !c.first || c.first >= o.time - 3600e3;
      [r, tot].forEach(function (x) { if (isNew) { x.newN[l]++; x.newR[l] += o.total; } else { x.oldN[l]++; x.oldR[l] += o.total; } });
      var k = o.ca && ca[o.ca] ? o.ca : 'Ngày'; ca[k][0]++; ca[k][1] += o.total;
    });
    (S.d.leads || []).forEach(function (ld) {
      if (!ld.time || ld.time < R[0] || ld.time >= R[1] || !/^quảng cáo/i.test(ld.channel) || (name !== null && ld.owner !== name)) return;
      var l = lineOfTxt(ld.interest + ' ' + ld.channel); rows[Math.floor((ld.time - R[0]) / DAY)].newD[l]++; tot.newD[l]++;
    });
    return { rows: rows, tot: tot, ca: ca };
  }
  function bcdtCols() {
    var c = [['Ngày', function (r) { return r.day ? fDate(r.day).slice(0, 5) : 'TỔNG'; }]];
    BC_LINES.forEach(function (l) { c.push(['Đơn mới ' + l, function (r) { return r.newN[l]; }], ['Data mới ' + l, function (r) { return r.newD[l]; }], ['DT mới ' + l, function (r) { return r.newR[l]; }, 1]); });
    BC_LINES.forEach(function (l) { c.push(['Đơn cũ ' + l, function (r) { return r.oldN[l]; }], ['DT cũ ' + l, function (r) { return r.oldR[l]; }, 1]); });
    c.push(['Số đơn hoàn', function (r) { return r.hoanN; }], ['Giá trị hoàn', function (r) { return r.hoanV; }, 1]);
    var sum = function (o) { return BC_LINES.reduce(function (s, l) { return s + o[l]; }, 0); };
    c.push(['DT khách mới', function (r) { return sum(r.newR); }, 1], ['DT khách cũ', function (r) { return sum(r.oldR); }, 1], ['TỔNG DT (đã trừ hoàn)', function (r) { return sum(r.newR) + sum(r.oldR); }, 1]);
    return c;
  }
  function openBcdt(name, month) {
    var d = bcdtData(name, month), cols = bcdtCols(), fmtv = function (v, isMoney) { return !v ? '' : isMoney ? v.toLocaleString('vi-VN') : v; };
    var head = '<tr>' + cols.map(function (c) { return '<th>' + esc(c[0]) + '</th>'; }).join('') + '</tr>';
    var tr = function (r, cls) { return '<tr' + (cls ? ' class="' + cls + '"' : '') + '>' + cols.map(function (c) { return '<td>' + fmtv(c[1](r), c[2]) + '</td>'; }).join('') + '</tr>'; };
    var body = '<div class="box"><div class="kpis" style="margin:0">' + Object.keys(d.ca).map(function (k) { return kpi('Ca ' + k, moneyShort(d.ca[k][1]), '', '', d.ca[k][0] + ' đơn'); }).join('') + '</div></div>' +
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
    h += '<div class="box"><h3>Tài khoản</h3><p style="margin:0 0 10px">' + esc(S.user.name) + ' · ' + esc(S.user.email) + ' · <b>' + esc(S.user.role) + '</b></p><button class="btn danger" id="logout">Đăng xuất</button></div>';
    h += '<div class="box"><h3>📲 Thông báo Telegram riêng</h3>' + (S.user.tg
      ? '<p style="margin:0 0 10px">✅ Đã kết nối. Bạn nhận riêng: đơn mới của khách mình phụ trách, khách tiềm năng mới được giao, danh sách việc lúc 8h sáng.</p><button class="btn ghost" id="tgOff">Ngắt kết nối</button>'
      : '<p style="margin:0 0 10px">Nhận thông báo về khách <b>của riêng bạn</b> qua Telegram. Làm 1 lần, mất 30 giây:</p><ol style="margin:0 0 10px;padding-left:20px"><li>Bấm <b>“Kết nối Telegram”</b>.</li><li>Bấm <b>“Mở Telegram”</b> → trong Telegram bấm <b>Start / Bắt đầu</b>.</li><li>Quay lại đây bấm <b>“Tôi đã bấm Start”</b>.</li></ol><div class="steps" id="tgSteps"><button class="btn pri" id="tgLink">Kết nối Telegram</button></div>') + '</div>';
    h += '<div class="box guide"><h3>Hướng dẫn nhanh</h3><ol>' +
      '<li>Mỗi sáng mở tab <b>Hôm nay</b>. Làm lần lượt 3 phần: đơn mới, chăm sóc khách, khách tiềm năng.</li>' +
      '<li><b>Đơn mới:</b> gọi khách xác nhận, xong bấm <b>✅ Xác nhận</b>. Gửi hàng thì bấm <b>🚚 Đang giao</b>, khách nhận thì <b>📬 Đã giao</b>.</li>' +
      '<li><b>Chăm sóc:</b> bấm <b>💬 Chăm sóc</b> → <b>Copy tin & mở Zalo</b> → dán tin gửi khách → quay lại chọn <b>Kết quả</b> → <b>Lưu</b>. Khách đó sẽ tự biến khỏi danh sách.</li>' +
      '<li>Khách hẹn gọi lại: chọn “Hẹn gọi lại” và chọn ngày. Đến ngày, khách tự hiện lại ở tab Hôm nay.</li>' +
      '<li>Khách đặt qua Zalo / điện thoại: vào <b>Đơn hàng → ＋ Tạo đơn</b> để lưu, khách sẽ được chăm sóc tự động như đơn web.</li>' +
      '<li><b>Khách tiềm năng</b> (hỏi mà chưa mua, nhắn Fanpage, Zalo, form web…): vào tab <b>Tiềm năng → ＋ Thêm</b>. Mỗi lần nói chuyện bấm <b>💬 Tư vấn</b> → chọn kết quả. Khách đồng ý mua thì chọn <b>“Khách chốt mua”</b>, form tạo đơn mở ra luôn. Khách từ chối thì chọn <b>“Khách không mua”</b> và ghi lý do.</li>' +
      '<li>Tab <b>Hiệu quả</b>: đầu tháng bấm <b>🎯 Đặt mục tiêu</b> doanh số của mình. Thanh tiến độ cho biết đang nhanh hay chậm (vạch đen = hôm nay), và mỗi ngày cần bán thêm bao nhiêu. Bên dưới là doanh số, giá trị trung bình mỗi đơn, tỷ lệ chốt, phần doanh thu từ khách cũ và kết quả chăm sóc, so với tháng trước.</li>' +
      '<li><b>Đơn chuyển khoản</b>: tiền về tài khoản thì mở đơn bấm <b>💳 Xác nhận đã nhận tiền</b>. Gửi hàng thì nhập <b>mã vận đơn</b>, đơn tự chuyển sang “Đang giao”.</li>' +
      '<li>Bạn chỉ thấy <b>khách mình phụ trách</b>. Gõ số của khách người khác đang phụ trách, CRM sẽ báo tên người đó. Muốn đổi người phụ trách thì nhờ quản lý chuyển.</li>' +
      '<li>Nên bấm <b>📲 Kết nối Telegram</b> (ngay trên) để nhận riêng đơn mới và việc hằng ngày của mình.</li>' +
      '<li>Nhãn <span class="tag noconsent">Chỉ hỏi thăm</span>: khách chưa đồng ý nhận tin, không gửi quảng cáo / ưu đãi.</li>' +
      '<li>Nhãn <span class="age ok">💬 5 ngày chưa chăm sóc</span>: đếm từ lần gần nhất khách <b>có trả lời</b> (gọi không nghe máy thì vẫn đếm tiếp). <b>Xanh</b> ≤ 7 ngày · <b>Cam</b> 8–30 ngày · <b>Đỏ</b> trên 30 ngày, nên liên hệ lại.</li>' +
      '</ol><p style="margin:10px 0"><a class="btn" href="/huong-dan/crm/" target="_blank" rel="noopener">📖 Xem hướng dẫn đầy đủ</a></p><p class="small muted" style="margin:6px 0 0">Không chụp màn hình, không gửi danh sách khách ra ngoài: đây là dữ liệu cá nhân, pháp luật yêu cầu giữ kín (Nghị định 13/2023).</p></div>';
    if (lvl() < 2) return h;
    if (lvl() >= 3) h += syncBoxes();
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
      '<button class="btn" id="moveBtn">Chuyển khách</button><p class="hint" style="margin:8px 0 0">Dùng khi nhân viên nghỉ việc hoặc đổi ca. Khách tiềm năng đang theo dõi cũng được chuyển theo.</p></div>';
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
    $('#logout').onclick = function () { if (confirm('Đăng xuất khỏi CRM?')) logout(); };
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
      api('bulk', { spread: true }).then(function (j) { toast('Đã chia ' + j.customers + ' khách, ' + j.leads + ' khách tiềm năng ✓'); load(true); }, function (e) { toast(e.message, true); b.disabled = false; b.textContent = 'Chia đều'; });
    };
    $('#moveBtn').onclick = function () {
      var from = $('#mvFrom').value, to = $('#mvTo').value, b = this;
      if (!from || !to || from === to) { toast('Chọn 2 người khác nhau', true); return; }
      if (!confirm('Chuyển toàn bộ khách của ' + from + ' sang ' + to + '?')) return; b.disabled = true;
      api('bulk', { from: from, to: to }).then(function (j) { toast('Đã chuyển ' + j.customers + ' khách, ' + j.leads + ' khách tiềm năng ✓'); load(true); }, function (e) { toast(e.message, true); b.disabled = false; });
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
  var bgTimer = null;
  function refreshBehind() { render(); clearTimeout(bgTimer); bgTimer = setTimeout(function () { if (!$('.modal')) load(true); }, 1500); }

  /* ================================================================ sự kiện chung */
  document.addEventListener('click', function (e) {
    var t = e.target.closest('[data-care],[data-next],[data-neworder],[data-cf],[data-os],[data-tf],[data-claim],[data-mon],[data-bcdt],[data-srcadd],[data-srcedit],[data-srcsync],[data-srcdel],[data-adsedit],[data-adssync],[data-who],[data-target],[data-myold],[data-more],[data-add],[data-rm],[data-consult],[data-leadorder],[data-newlead],[data-editlead],[data-cust],[data-order],[data-lead]');
    if (!t || !S.d) return;
    if (e.target.closest('a[href]') && !t.hasAttribute('data-myold')) return; // nút gọi / Zalo bên trong thẻ
    var a = function (k) { return t.getAttribute(k); };
    if (t.hasAttribute('data-care')) { e.stopPropagation(); openCare(a('data-care'), a('data-task')); return; }
    if (t.hasAttribute('data-next')) { var o = findOrder(a('data-next')); if (o && NEXT[o.status]) setStatus(o, NEXT[o.status]); return; }
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
    if (t.hasAttribute('data-tf')) { S.f.t.k = a('data-tf'); S.f.t.n = 60; render(); return; }
    if (t.hasAttribute('data-mon')) { S.f.r.m = a('data-mon'); render(); return; }
    if (t.hasAttribute('data-who')) { S.f.r.who = a('data-who'); render(); return; }
    if (t.hasAttribute('data-target')) { var tg = a('data-target').split('|'); openTarget(tg[0], tg[1]); return; }
    if (t.hasAttribute('data-myold')) { e.preventDefault(); S.f.c = { q: '', k: 'myold', sort: 'age', n: 60 }; location.hash = '#khach-hang'; return; }
    if (t.hasAttribute('data-more')) { S.f[a('data-more')].n += 60; render(); return; }
    if (t.hasAttribute('data-add')) { var k = a('data-add'); S.f[k].push(k === 'us' ? { email: '', name: '', role: 'Nhân viên', active: true, alias: '', prefix: '' } : k === 'tp' ? ['', '', ''] : ['', '', '', '']); render(); var rows = $$('#' + k + 'T .edit-row[data-i]'); if (rows.length) $('input', rows[rows.length - 1]).focus(); return; }
    if (t.hasAttribute('data-rm')) { var k2 = a('data-rm'); if (k2 === 'us' && S.f.us[+a('data-i')].email === S.user.email) { toast('Không tự xoá tài khoản của mình được.', true); return; } S.f[k2].splice(+a('data-i'), 1); render(); return; }
    if (t.hasAttribute('data-cust')) { closeModal(true); openCustomer(a('data-cust')); return; }
    if (t.hasAttribute('data-order')) { closeModal(true); openOrder(a('data-order')); return; }
    if (t.hasAttribute('data-lead')) { closeModal(true); openLead(a('data-lead')); return; }
  });
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
  setInterval(function () { if (S.d && !document.hidden && !$('.modal') && Date.now() - S.loadedAt > 170e3) load(true); }, 30e3);
  document.addEventListener('visibilitychange', function () { if (!document.hidden && S.d && !$('.modal') && Date.now() - S.loadedAt > 60e3) load(true); });

  /* ================================================================ chạy */
  if (S.token) start(); else renderLogin('email');
})();
