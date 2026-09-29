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
  var STATUS = ['Mới', 'Đã xác nhận', 'Đang giao', 'Đã giao', 'Huỷ'];
  var ST_CLS = { 'Mới': 'st-moi', 'Đã xác nhận': 'st-xn', 'Đang giao': 'st-giao', 'Đã giao': 'st-xong', 'Huỷ': 'st-huy' };
  var NEXT = { 'Mới': 'Đã xác nhận', 'Đã xác nhận': 'Đang giao', 'Đang giao': 'Đã giao' };
  var NEXT_LABEL = { 'Mới': '✅ Xác nhận', 'Đã xác nhận': '🚚 Đang giao', 'Đang giao': '📬 Đã giao' };
  var RESULTS = ['Đã đặt lại', 'Hẹn gọi lại', 'Không nghe máy', 'Đã hỏi thăm', 'Không có nhu cầu'];
  var SOURCES = ['Zalo', 'Điện thoại', 'Facebook', 'TikTok', 'Shopee', 'Khách quen giới thiệu', 'Tại cửa hàng', 'Khác'];
  var GROUP_CLS = { 'VIP': 'vip', 'Quay lại': 'back', 'Mới': 'new', 'Sắp mất': 'risk' };

  var I = {
    today: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M9 11l3 3L22 4"/><path d="M21 12v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11"/></svg>',
    users: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 0 0-3-3.87M16 3.13a4 4 0 0 1 0 7.75"/></svg>',
    box: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z"/><path d="M3.27 6.96L12 12.01l8.73-5.05M12 22.08V12"/></svg>',
    mail: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/></svg>',
    gear: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 1 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 1 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 1 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 1 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"/></svg>',
    refresh: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M23 4v6h-6M1 20v-6h6"/><path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15"/></svg>',
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
    setTimeout(function () { el.remove(); }, err ? 6000 : 2800);
  }
  function copy(text) {
    if (navigator.clipboard && window.isSecureContext) return navigator.clipboard.writeText(text).catch(fallback);
    fallback(); return Promise.resolve();
    function fallback() { var t = document.createElement('textarea'); t.value = text; t.style.position = 'fixed'; t.style.opacity = '0'; document.body.appendChild(t); t.select(); try { document.execCommand('copy'); } catch (e) { } t.remove(); }
  }

  function api(action, payload) {
    var body = Object.assign({ type: 'crm', action: action, token: S.token }, payload || {});
    if (!CFG.endpoint) return Promise.reject(new Error('Chưa cấu hình máy chủ.'));
    return fetch(CFG.endpoint, { method: 'POST', headers: { 'Content-Type': 'text/plain;charset=utf-8' }, body: JSON.stringify(body) })
      .then(function (r) { return r.json(); }, function () { throw new Error('Mất kết nối mạng. Bạn thử lại nhé.'); })
      .then(function (j) {
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
  function openContacts() { return S.d.contacts.filter(function (c) { return !c.done; }); }

  /* ================================================================ khung */
  var VIEWS = [
    { id: 'hom-nay', label: 'Hôm nay', icon: 'today' },
    { id: 'khach-hang', label: 'Khách hàng', icon: 'users' },
    { id: 'don-hang', label: 'Đơn hàng', icon: 'box' },
    { id: 'lien-he', label: 'Liên hệ', icon: 'mail' },
    { id: 'cai-dat', label: 'Cài đặt', icon: 'gear' }
  ];
  function meHTML() { return '<b>' + esc(S.user.name) + '</b>' + esc(S.user.role); }
  function shell() {
    $('#app').innerHTML = '<header class="top"><div class="top-in">' +
      '<a class="brand" href="#hom-nay"><img src="/icon-180.png" alt="">CRM</a>' +
      '<nav class="nav">' + VIEWS.map(function (v) { return '<a href="#' + v.id + '" data-v="' + v.id + '">' + I[v.icon] + '<span>' + v.label + '</span></a>'; }).join('') + '</nav>' +
      '<div class="grow"></div><div class="me">' + meHTML() + '</div>' +
      '<button class="icon-btn" id="refresh" title="Tải lại dữ liệu" aria-label="Tải lại dữ liệu">' + I.refresh + '</button>' +
      '</div></header><main id="view"></main>';
    $('#refresh').onclick = function () { load(); };
    navBadges();
  }
  function navBadges() {
    var n = { 'hom-nay': newOrders().length + tasksShown().length, 'don-hang': newOrders().length, 'lien-he': openContacts().length };
    $$('.nav a').forEach(function (a) {
      var v = a.getAttribute('data-v'), d = $('.dot', a); if (d) d.remove();
      if (n[v]) a.insertAdjacentHTML('beforeend', '<span class="dot">' + (n[v] > 99 ? '99+' : n[v]) + '</span>');
    });
  }
  function route() { var h = (location.hash || '#hom-nay').slice(1).split('/'); return { view: h[0] || 'hom-nay', id: decodeURIComponent(h[1] || '') }; }
  var lastView = '';
  function render() {
    if (!S.d || !$('#view')) return;
    var r = route(), v = VIEWS.some(function (x) { return x.id === r.view; }) ? r.view : 'hom-nay';
    $$('.nav a').forEach(function (a) { a.classList.toggle('on', a.getAttribute('data-v') === v); });
    var keepScroll = lastView === v, y = window.scrollY;
    var el = $('#view');
    var focusId = document.activeElement && document.activeElement.id, selStart = document.activeElement && document.activeElement.selectionStart;
    el.innerHTML = ({ 'hom-nay': viewToday, 'khach-hang': viewCustomers, 'don-hang': viewOrders, 'lien-he': viewContacts, 'cai-dat': viewSettings })[v]();
    el.insertAdjacentHTML('beforeend', '<p class="updated">Cập nhật lúc ' + fDateTime(S.loadedAt) + ' · dữ liệu lưu trong Google Sheet</p>');
    if (focusId && $('#' + focusId)) { var f = $('#' + focusId); f.focus(); try { f.setSelectionRange(selStart, selStart); } catch (e) { } }
    if (keepScroll) window.scrollTo(0, y); else window.scrollTo(0, 0);
    lastView = v;
    document.title = VIEWS.filter(function (x) { return x.id === v; })[0].label + ' – CRM Thực Dưỡng Lành';
    if (v === 'cai-dat') bindSettings();
    if (r.id && !$('.modal')) {
      if (v === 'khach-hang' && cust(r.id)) openCustomer(r.id, true);
      if (v === 'don-hang') { var o = S.d.orders.filter(function (x) { return x.id === r.id; })[0]; if (o) openOrder(o.id, true); }
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
  function custCard(c, withTask) {
    return '<div class="card click" data-cust="' + c.phone + '">' +
      '<div class="r1"><b>' + esc(c.name || 'Khách') + '</b>' + groupTag(c.group) + (c.owner ? '<span class="tag owner">👤 ' + esc(c.owner) + '</span>' : '') + '<span class="end">' + (c.orders > 1 ? c.orders + ' đơn · ' : '') + moneyShort(c.spent) + '</span></div>' +
      '<div class="r2">' + fPhone(c.phone) + (c.products.length ? ' · ' + esc(shortProducts(c.products)) : '') + '</div>' +
      '<div class="r3">' + (withTask ? taskLine(c) : 'Đơn gần nhất ' + daysAgo(c.last)) + (c.consent ? '' : ' · <span class="tag noconsent">Chỉ hỏi thăm</span>') +
      (c.careAt ? ' · Chăm sóc ' + daysAgo(c.careAt) + (c.careResult ? ' (' + esc(c.careResult) + ')' : '') : '') + '</div>' +
      (withTask ? '<div class="acts"><button class="btn pri" data-care="' + c.phone + '" data-task="' + c.task.type + '">💬 Chăm sóc</button><a class="btn" href="tel:' + c.phone + '">📞 Gọi</a></div>' : '') +
      '</div>';
  }
  function orderCard(o, withActs) {
    var next = NEXT[o.status];
    return '<div class="card click" data-order="' + esc(o.id) + '">' +
      '<div class="r1"><b>' + esc(o.name) + '</b>' + stTag(o.status) + '<span class="end">' + money(o.total) + '</span></div>' +
      '<div class="r2">' + fPhone(o.phone) + ' · ' + esc(o.payment) + ' · <span class="muted">' + esc(o.id) + '</span></div>' +
      '<div class="r3 pre">' + esc(o.items.split('\n').map(function (l) { return l.replace(/\s*=\s*[\d.,]+\s*₫?$/, ''); }).join('\n')) + '</div>' +
      '<div class="r3">' + when(o.time) + (o.source ? ' · ' + esc(o.source) : '') + (o.note ? ' · 📝 ' + esc(o.note) : '') + '</div>' +
      (withActs && next ? '<div class="acts"><button class="btn pri" data-next="' + esc(o.id) + '">' + NEXT_LABEL[o.status] + '</button><a class="btn" href="tel:' + o.phone + '">📞 Gọi</a><a class="btn zalo" href="' + zalo(o.phone) + '" target="_blank" rel="noopener">Zalo</a></div>' : '') +
      '</div>';
  }
  function contactCard(c) {
    return '<div class="card' + (c.done ? ' done' : '') + '">' +
      '<div class="r1"><b>' + esc(c.name) + '</b>' + (c.done ? '<span class="tag st-xong">Đã trả lời</span>' : '<span class="tag st-moi">Chưa trả lời</span>') + '<span class="end small muted">' + when(c.time) + '</span></div>' +
      '<div class="r2">' + fPhone(c.phone) + (c.email ? ' · ' + esc(c.email) : '') + '</div>' +
      '<div class="r2 pre" style="margin-top:6px">' + esc(c.message) + '</div>' +
      (c.note ? '<div class="r3">📝 ' + esc(c.note) + '</div>' : '') +
      '<div class="acts"><a class="btn" href="tel:' + c.phone + '">📞 Gọi</a><a class="btn zalo" href="' + zalo(c.phone) + '" target="_blank" rel="noopener">Zalo</a>' +
      '<button class="btn ' + (c.done ? 'ghost' : 'pri') + '" data-contact="' + c.row + '">' + (c.done ? 'Đánh dấu chưa trả lời' : '✓ Đã trả lời') + '</button></div></div>';
  }
  function empty(t) { return '<div class="empty">' + t + '</div>'; }

  /* ================================================================ HÔM NAY */
  function viewToday() {
    var no = newOrders().sort(function (a, b) { return b.time - a.time; }), ts = tasksShown(), oc = openContacts().sort(function (a, b) { return b.time - a.time; });
    var t0 = today(), doneToday = S.d.log.filter(function (l) { return l.time >= t0 && l.what !== 'Cài đặt' && l.what !== 'Nhân sự'; }).sort(function (a, b) { return b.time - a.time; });
    var h = '<div class="page-head"><h1>Chào ' + esc(S.user.name) + ' 👋</h1><div class="grow"></div>' +
      '<label class="switch"><input type="checkbox" id="mine"' + (S.mine ? ' checked' : '') + '> Chỉ khách của tôi</label></div>';
    h += '<div class="kpis">' +
      kpi('Đơn mới cần xác nhận', no.length, no.length ? 'warn' : 'good', '#don-hang') +
      kpi('Khách cần chăm sóc', ts.length, ts.length ? 'warn' : 'good') +
      kpi('Liên hệ chưa trả lời', oc.length, oc.length ? 'bad' : 'good', '#lien-he') +
      kpi('Đã làm hôm nay', doneToday.length, 'good');
    if (lvl() >= 2) {
      var m = monthStats();
      h += kpi('Doanh thu tháng ' + m.month, moneyShort(m.revenue), '', '', m.orders + ' đơn · ' + (m.prev ? (m.revenue >= m.prev ? '▲ ' : '▼ ') + 'tháng trước ' + moneyShort(m.prev) : 'chưa có tháng trước')) +
        kpi('Khách mới tháng ' + m.month, m.newCus, '', '', m.returning + ' khách mua lại');
    }
    h += '</div>';

    h += '<section class="section"><div class="section-h"><h2>1️⃣ Đơn mới – gọi khách xác nhận</h2>' + (no.length ? '<span class="count">' + no.length + '</span>' : '') + '<span class="tip">gọi xong bấm “Xác nhận”</span></div>' +
      (no.length ? '<div class="list cols">' + no.map(function (o) { return orderCard(o, true); }).join('') + '</div>' : empty('Không có đơn mới 🎉')) + '</section>';

    h += '<section class="section"><div class="section-h"><h2>2️⃣ Chăm sóc khách</h2>' + (ts.length ? '<span class="count">' + ts.length + '</span>' : '') + '<span class="tip">bấm “Chăm sóc” → gửi tin mẫu → chọn kết quả</span></div>';
    if (!ts.length) h += empty(S.mine && tasksAll().length ? 'Khách của bạn đã chăm sóc xong. Tắt “Chỉ khách của tôi” để xem các khách khác.' : 'Hôm nay không có khách đến lịch chăm sóc 🎉');
    TASK_ORDER.forEach(function (k) {
      var arr = ts.filter(function (c) { return c.task.type === k; }); if (!arr.length) return;
      arr.sort(function (a, b) { return (b.task.late || 0) - (a.task.late || 0) || b.spent - a.spent; });
      h += '<div class="section-h" style="margin-top:12px"><h3>' + TASKS[k].icon + ' ' + TASKS[k].title + '</h3><span class="count">' + arr.length + '</span><span class="tip">' + TASKS[k].tip + '</span></div>' +
        '<div class="list cols">' + arr.map(function (c) { return custCard(c, true); }).join('') + '</div>';
    });
    h += '</section>';

    h += '<section class="section"><div class="section-h"><h2>3️⃣ Liên hệ chưa trả lời</h2>' + (oc.length ? '<span class="count">' + oc.length + '</span>' : '') + '</div>' +
      (oc.length ? '<div class="list cols">' + oc.map(contactCard).join('') + '</div>' : empty('Không có liên hệ nào 🎉')) + '</section>';

    if (doneToday.length) h += '<section class="section"><div class="section-h"><h2>✅ Đã làm hôm nay</h2><span class="count">' + doneToday.length + '</span></div><div class="box timeline">' +
      doneToday.slice(0, 40).map(logItem).join('') + '</div></section>';
    return h;
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
    { k: 'callback', l: 'Có hẹn gọi lại', f: function (c) { return !!c.callback; } }
  ];
  var SORTS = { last: ['Mua gần nhất', function (a, b) { return (b.last || 0) - (a.last || 0); }], spent: ['Chi nhiều nhất', function (a, b) { return b.spent - a.spent; }],
    runout: ['Sắp hết hàng', function (a, b) { return (a.runout || 9e15) - (b.runout || 9e15); }], name: ['Tên A–Z', function (a, b) { return a.name.localeCompare(b.name, 'vi'); }] };
  function viewCustomers() {
    var f = S.f.c || (S.f.c = { q: '', k: 'all', sort: 'last', n: 60 });
    var q = norm(f.q), qd = q.replace(/\D/g, '');
    var base = S.d.customers.filter(function (c) { return !q || norm(c.name + ' ' + c.products.join(' ') + ' ' + c.owner + ' ' + c.province).indexOf(q) >= 0 || (qd.length >= 3 && c.phone.indexOf(qd) >= 0); });
    var cur = CF.filter(function (x) { return x.k === f.k; })[0] || CF[0];
    var list = base.filter(cur.f).sort(SORTS[f.sort][1]);
    return '<div class="page-head"><h1>Khách hàng</h1><span class="muted">' + S.d.customers.length + ' khách</span></div>' +
      '<div class="tools"><div class="search">' + I.search + '<input type="search" id="cq" placeholder="Tìm tên, số điện thoại, sản phẩm…" value="' + esc(f.q) + '"></div>' +
      '<select id="csort" style="flex:0 0 auto;width:auto">' + Object.keys(SORTS).map(function (k) { return '<option value="' + k + '"' + (f.sort === k ? ' selected' : '') + '>' + SORTS[k][0] + '</option>'; }).join('') + '</select></div>' +
      '<div class="chips">' + CF.map(function (x) { var n = base.filter(x.f).length; return '<button class="chip' + (x.k === f.k ? ' on' : '') + '" data-cf="' + x.k + '">' + x.l + ' <em>' + n + '</em></button>'; }).join('') + '</div>' +
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
      (c.consent ? '' : '<div class="notice">Khách <b>chưa đồng ý nhận tin</b>: chỉ hỏi thăm, không gửi quảng cáo / ưu đãi.</div>') +
      '<div class="box"><div class="grid-info">' +
      info('Điện thoại', fPhone(c.phone)) + info('Nhóm', c.group) + info('Số đơn', c.orders) + info('Tổng chi', money(c.spent)) +
      info('Đơn đầu', fDate(c.first)) + info('Đơn gần nhất', fDate(c.last) + ' (' + daysAgo(c.last) + ')') +
      info('Dự kiến hết hàng', c.runout ? fDate(c.runout) + ' (' + daysAgo(c.runout) + ')' : 'chưa có chu kỳ') + info('Nguồn', c.source || '–') +
      info('Địa chỉ', [c.address, c.ward, c.province].filter(Boolean).join(', '), true) + info('Đã mua', c.products.join('; '), true) +
      '</div></div>' +
      '<div class="box"><h3>Chăm sóc</h3><div class="row2c">' +
      '<label class="f"><span>Người phụ trách</span><select id="cOwner"><option value="">– Chưa ai –</option>' + owners.map(function (n) { return '<option' + (n === c.owner ? ' selected' : '') + '>' + esc(n) + '</option>'; }).join('') + '</select></label>' +
      '<label class="f"><span>Hẹn gọi lại ngày</span><input type="date" id="cCb" value="' + (c.callback ? isoDate(c.callback) : '') + '"></label></div>' +
      '<label class="f"><span>Ghi chú về khách (thích gì, dị ứng gì, hẹn gì…)</span><textarea id="cNote" rows="3">' + esc(c.note) + '</textarea></label>' +
      '<button class="btn" id="cSave">Lưu thông tin chăm sóc</button></div>' +
      '<div class="box"><h3>Đơn hàng (' + os.length + ')</h3>' + (os.length ? '<div class="list">' + os.map(function (o) { return orderCard(o, false); }).join('') + '</div>' : '<p class="muted">Chưa có đơn.</p>') + '</div>' +
      '<div class="box"><h3>Lịch sử chăm sóc (' + logs.length + ')</h3>' + (logs.length ? '<div class="timeline">' + logs.map(logItem).join('') + '</div>' : '<p class="muted">Chưa có lần chăm sóc nào trên CRM.' + (c.careAt ? ' Lần gần nhất ghi trong Sheet: ' + fDate(c.careAt) + (c.careResult ? ' – ' + esc(c.careResult) : '') : '') + '</p>') + '</div>';
    var m = modal('<span>' + esc(c.name || 'Khách') + '</span> ' + groupTag(c.group), body, null, { route: '#khach-hang', pushed: !fromRoute });
    $('#cSave', m).onclick = function () {
      var p = { phone: c.phone, owner: $('#cOwner', m).value, note: $('#cNote', m).value.trim(), callback: $('#cCb', m).value };
      var btn = this; btn.disabled = true; btn.textContent = 'Đang lưu…';
      api('customer', p).then(function () {
        c.owner = p.owner; c.note = p.note; c.callback = p.callback ? new Date(p.callback + 'T09:00:00+07:00').getTime() : null;
        if (c.callback && dayStart(c.callback) <= today()) c.task = { type: 'callback', late: Math.round((today() - dayStart(c.callback)) / DAY), days: 0 };
        else if (c.task && c.task.type === 'callback') c.task = null;
        toast('Đã lưu'); btn.textContent = 'Đã lưu ✓'; setTimeout(function () { btn.disabled = false; btn.textContent = 'Lưu thông tin chăm sóc'; }, 1500); refreshBehind();
      }, function (e) { toast(e.message, true); btn.disabled = false; btn.textContent = 'Lưu thông tin chăm sóc'; });
    };
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
    var name = (c.name || '').trim().split(/\s+/).pop() || 'anh/chị';
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
    var sum = list.filter(function (o) { return o.status !== 'Huỷ'; }).reduce(function (s, o) { return s + o.total; }, 0);
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
      (c ? '<button class="btn" data-cust="' + c.phone + '">👤 Xem khách (' + c.orders + ' đơn)</button>' : '') + '<button class="btn" id="oCopy">📋 Copy thông tin giao hàng</button></div>' +
      '<div class="box"><h3>Trạng thái</h3><div class="radios">' + STATUS.map(function (s) { return '<label><input type="radio" name="oSt" value="' + s + '"' + (s === o.status ? ' checked' : '') + '><span>' + s + '</span></label>'; }).join('') + '</div></div>' +
      '<div class="box"><div class="grid-info">' + info('Khách', o.name) + info('Điện thoại', fPhone(o.phone)) + info('Thời gian', fDateTime(o.time) + ' ' + vnDate(o.time).y) + info('Thanh toán', o.payment) +
      info('Địa chỉ', [o.address, o.ward, o.province].filter(Boolean).join(', '), true) + (o.email ? info('Email', o.email, true) : '') + info('Nguồn', o.source || '–', true) + '</div></div>' +
      '<div class="box"><h3>Sản phẩm</h3><div class="pre">' + esc(o.items) + '</div><div class="sum" style="margin-top:10px"><div><span>Tạm tính</span><b>' + money(o.subtotal) + '</b></div><div><span>Phí ship</span><b>' + (o.shipping ? money(o.shipping) : 'Miễn phí') + '</b></div><div class="total"><span>Tổng</span><b>' + money(o.total) + '</b></div></div></div>' +
      '<div class="box"><label class="f" style="margin:0"><span>Ghi chú đơn</span><textarea id="oNote" rows="2">' + esc(o.note) + '</textarea></label><button class="btn" id="oNoteSave" style="margin-top:8px">Lưu ghi chú</button></div>' +
      (logs.length ? '<div class="box"><h3>Lịch sử</h3><div class="timeline">' + logs.map(logItem).join('') + '</div></div>' : '');
    var m = modal('Đơn ' + esc(o.id) + ' ' + stTag(o.status), body, null, { route: '#don-hang', pushed: !fromRoute });
    $$('input[name=oSt]', m).forEach(function (r) { r.onchange = function () { setStatus(o, r.value, function () { closeModal(); }); }; });
    $('#oCopy', m).onclick = function () {
      copy(o.name + ' – ' + o.phone + '\n' + [o.address, o.ward, o.province].filter(Boolean).join(', ') + '\n' + o.items + '\nTổng: ' + money(o.total) + ' (' + o.payment + ')' + (o.note ? '\nGhi chú: ' + o.note : '')).then(function () { toast('Đã copy'); });
    };
    $('#oNoteSave', m).onclick = function () {
      var btn = this, note = $('#oNote', m).value.trim(); btn.disabled = true;
      api('order_status', { id: o.id, row: o.row, note: note }).then(function () { o.note = note; toast('Đã lưu ghi chú'); btn.disabled = false; refreshBehind(); }, function (e) { toast(e.message, true); btn.disabled = false; });
    };
  }
  function setStatus(o, st, done) {
    if (st === o.status) return;
    var reason = '';
    if (st === 'Huỷ') { reason = prompt('Lý do huỷ đơn ' + o.id + '? (không bắt buộc)', ''); if (reason === null) { render(); var r = $('input[name=oSt][value="' + o.status + '"]'); if (r) r.checked = true; return; } }
    var old = o.status; o.status = st; navBadges(); render(); if (done) done();
    api('order_status', { id: o.id, row: o.row, status: st, reason: reason }).then(function (j) {
      if (j.row) o.row = j.row;
      S.d.log.push({ time: Date.now(), by: S.user.name, what: 'Đơn hàng', ref: o.id, name: o.name, result: old + ' → ' + st, note: reason || '' });
      toast('Đơn ' + o.id + ': ' + st);
      if ((old === 'Huỷ') !== (st === 'Huỷ')) load(true); else render();
    }, function (e) { o.status = old; navBadges(); render(); toast(e.message, true); });
  }

  /* ---------- tạo đơn nhập tay */
  function productOptions() {
    var o = []; (CFG.products || []).forEach(function (p) {
      if (p.variants && p.variants.length) p.variants.forEach(function (v) { o.push({ name: p.name, variant: v.name, price: v.price }); });
      else o.push({ name: p.name, variant: p.unit || '', price: p.price });
    });
    return o;
  }
  function loadUnits() {
    if (S.units) return Promise.resolve(S.units);
    return fetch('/vn-units.json').then(function (r) { return r.json(); }).then(function (u) { S.units = u; return u; }).catch(function () { return []; });
  }
  function openNewOrder(phone) {
    var P = productOptions(), c0 = phone ? cust(phone) : null;
    var itemRow = function () {
      return '<div class="item"><select class="iSel"><option value="">– Chọn sản phẩm –</option>' + P.map(function (p, i) { return '<option value="' + i + '">' + esc(p.name + (p.variant ? ' – ' + p.variant : '') + ' · ' + money(p.price)) + '</option>'; }).join('') + '<option value="x">Sản phẩm khác (tự gõ)…</option></select>' +
        '<input class="iQty" type="number" min="1" max="999" value="1" inputmode="numeric" aria-label="Số lượng"><input class="iPrice price" type="number" min="0" step="1000" inputmode="numeric" placeholder="Đơn giá" aria-label="Đơn giá"><button type="button" class="rm" aria-label="Bỏ">✕</button>' +
        '<input class="iName" type="text" placeholder="Tên sản phẩm (và quy cách)" hidden style="grid-column:1/-1"></div>';
    };
    var body = '<form id="noForm" novalidate>' +
      '<div class="box"><h3>Khách hàng</h3><div class="row2c"><label class="f"><span>Số điện thoại *</span><input type="tel" name="phone" inputmode="tel" required value="' + esc(c0 ? c0.phone : '') + '"></label>' +
      '<label class="f"><span>Tên khách *</span><input type="text" name="name" required value="' + esc(c0 ? c0.name : '') + '"></label></div>' +
      '<p class="hint" id="noOld">' + (c0 ? 'Khách cũ: ' + c0.orders + ' đơn, ' + money(c0.spent) : '') + '</p>' +
      '<div class="row2c"><label class="f"><span>Tỉnh / Thành phố</span><select name="province"><option value="">– Chọn –</option></select></label>' +
      '<label class="f"><span>Phường / Xã</span><input type="text" name="ward" list="noWards" autocomplete="off"><datalist id="noWards"></datalist></label></div>' +
      '<label class="f"><span>Địa chỉ (số nhà, đường, thôn…)</span><input type="text" name="address" value="' + esc(c0 ? c0.address : '') + '"></label></div>' +
      '<div class="box"><h3>Sản phẩm</h3><div class="items" id="noItems">' + itemRow() + '</div><button type="button" class="btn" id="noAdd" style="margin-top:8px">＋ Thêm sản phẩm</button></div>' +
      '<div class="box"><div class="row2c"><label class="f"><span>Phí ship</span><input type="number" name="shipping" min="0" step="1000" inputmode="numeric"></label>' +
      '<label class="f"><span>Khách đặt qua</span><select name="source">' + SOURCES.map(function (s) { return '<option>' + s + '</option>'; }).join('') + '</select></label></div>' +
      '<div class="f"><span style="display:block;font-size:13px;font-weight:600;margin-bottom:6px;color:var(--ink)">Thanh toán</span><div class="radios"><label><input type="radio" name="payment" value="cod" checked><span>COD (trả khi nhận)</span></label><label><input type="radio" name="payment" value="bank"><span>Chuyển khoản</span></label></div></div>' +
      '<div class="f"><span style="display:block;font-size:13px;font-weight:600;margin-bottom:6px;color:var(--ink)">Trạng thái</span><div class="radios"><label><input type="radio" name="status" value="Đã xác nhận" checked><span>Đã chốt với khách</span></label><label><input type="radio" name="status" value="Mới"><span>Chưa xác nhận</span></label></div></div>' +
      '<label class="f"><span>Ghi chú</span><textarea name="note" rows="2"></textarea></label>' +
      '<label class="switch"><input type="checkbox" name="consent"' + (c0 && c0.consent ? ' checked' : '') + '> Khách đồng ý nhận tin ưu đãi</label></div>' +
      '<div class="box sum" id="noSum"></div><p class="err" id="noErr"></p></form>';
    var m = modal('Tạo đơn mới', body, '<button class="btn" data-close>Huỷ</button><button class="btn pri" id="noSave">Lưu đơn</button>');
    var form = $('#noForm', m), F = form.elements, items = $('#noItems', m), shipEdited = false, prov = F.province, ward = F.ward;
    loadUnits().then(function (u) {
      prov.innerHTML = '<option value="">– Chọn –</option>' + u.map(function (p) { return '<option>' + esc(p.n) + '</option>'; }).join('');
      if (c0 && c0.province) setProvince(c0.province, c0.ward);
    });
    function setProvince(pv, wd) {
      var u = S.units || [], hit = u.filter(function (p) { return norm(p.n) === norm(pv) || norm(p.f) === norm(pv); })[0];
      if (!hit && pv) { prov.insertAdjacentHTML('beforeend', '<option>' + esc(pv) + '</option>'); }
      prov.value = hit ? hit.n : pv; fillWards(); if (wd !== undefined) ward.value = wd;
    }
    function fillWards() { var p = (S.units || []).filter(function (x) { return x.n === prov.value; })[0]; $('#noWards', m).innerHTML = p ? p.w.map(function (w) { return '<option value="' + esc(w) + '">'; }).join('') : ''; }
    prov.onchange = fillWards;
    F.phone.addEventListener('input', function () {
      var c = cust(this.value), hint = $('#noOld', m);
      hint.textContent = c ? 'Khách cũ: ' + c.name + ' · ' + c.orders + ' đơn, ' + money(c.spent) + ' – đã điền sẵn thông tin' : '';
      if (c) { if (!F.name.value) F.name.value = c.name; if (!F.address.value) F.address.value = c.address; if (!prov.value && c.province) setProvince(c.province, c.ward); F.consent.checked = c.consent; }
    });
    function lines() {
      return $$('.item', items).map(function (r) {
        var sel = $('.iSel', r).value, q = Math.max(0, parseInt($('.iQty', r).value, 10) || 0), pr = Math.max(0, Math.round(+$('.iPrice', r).value || 0));
        if (sel === '') return null;
        if (sel === 'x') { var n = $('.iName', r).value.trim(); return n ? { name: n, variant: '', qty: q, price: pr } : null; }
        var p = P[+sel]; return { name: p.name, variant: p.variant, qty: q, price: pr };
      }).filter(function (x) { return x && x.qty > 0; });
    }
    function calc() {
      var sub = lines().reduce(function (s, i) { return s + i.qty * i.price; }, 0), th = +CFG.free_ship_threshold || 0, fee = +CFG.shipping_fee || 0;
      if (!shipEdited) F.shipping.value = sub && !(th && sub >= th) ? fee : 0;
      var sh = Math.max(0, +F.shipping.value || 0);
      $('#noSum', m).innerHTML = '<div><span>Tạm tính</span><b>' + money(sub) + '</b></div><div><span>Phí ship</span><b>' + (sh ? money(sh) : 'Miễn phí') + '</b></div>' +
        (th && sub && sub < th ? '<div class="small muted">Thêm ' + money(th - sub) + ' nữa là được miễn phí ship</div>' : '') + '<div class="total"><span>Tổng</span><b>' + money(sub + sh) + '</b></div>';
      $('#noSave', m).textContent = sub ? 'Lưu đơn · ' + money(sub + sh) : 'Lưu đơn';
    }
    items.addEventListener('change', function (e) {
      var r = e.target.closest('.item'); if (!r) return;
      if (e.target.classList.contains('iSel')) { var v = e.target.value, nm = $('.iName', r); nm.hidden = v !== 'x'; if (v === 'x') nm.focus(); if (v !== '' && v !== 'x') $('.iPrice', r).value = P[+v].price; }
      calc();
    });
    items.addEventListener('input', calc);
    items.addEventListener('click', function (e) { if (e.target.classList.contains('rm')) { var r = e.target.closest('.item'); if ($$('.item', items).length > 1) r.remove(); else { $('.iSel', r).value = ''; $('.iPrice', r).value = ''; } calc(); } });
    $('#noAdd', m).onclick = function () { items.insertAdjacentHTML('beforeend', itemRow()); };
    F.shipping.addEventListener('input', function () { shipEdited = true; calc(); });
    calc();
    $('#noSave', m).onclick = function () {
      var err = $('#noErr', m), ph = normPhone(F.phone.value), ls = lines();
      if (!/^0\d{9,10}$/.test(ph)) { err.textContent = 'Số điện thoại chưa đúng (10 số, bắt đầu bằng 0).'; F.phone.focus(); return; }
      if (!F.name.value.trim()) { err.textContent = 'Nhập tên khách.'; F.name.focus(); return; }
      if (!ls.length) { err.textContent = 'Chọn ít nhất 1 sản phẩm.'; return; }
      if (ls.some(function (i) { return !i.price; }) && !confirm('Có sản phẩm giá 0đ (quà tặng?). Vẫn lưu đơn?')) return;
      var p = { customer: { phone: ph, name: F.name.value.trim(), province: prov.value, ward: F.ward.value.trim(), address: F.address.value.trim(), note: F.note.value.trim() },
        items: ls, shipping: Math.max(0, +F.shipping.value || 0), payment: $('input[name=payment]:checked', form).value, status: $('input[name=status]:checked', form).value, source: F.source.value, consent: F.consent.checked };
      var btn = this; btn.disabled = true; btn.textContent = 'Đang lưu…'; err.textContent = '';
      api('order_create', p).then(function (j) { closeModal(); toast('Đã tạo đơn ' + j.id + ' ✓'); location.hash = '#don-hang'; load(true); }, function (e) { btn.disabled = false; calc(); err.textContent = e.message; });
    };
  }

  /* ================================================================ LIÊN HỆ */
  function viewContacts() {
    var f = S.f.l || (S.f.l = { k: 'open' });
    var all = S.d.contacts.slice().sort(function (a, b) { return b.time - a.time; }), open = all.filter(function (c) { return !c.done; });
    var list = f.k === 'open' ? open : all;
    return '<div class="page-head"><h1>Liên hệ từ website</h1></div>' +
      '<div class="chips"><button class="chip' + (f.k === 'open' ? ' on' : '') + '" data-lf="open">Chưa trả lời <em>' + open.length + '</em></button><button class="chip' + (f.k === 'all' ? ' on' : '') + '" data-lf="all">Tất cả <em>' + all.length + '</em></button></div>' +
      (list.length ? '<div class="list cols">' + list.slice(0, 200).map(contactCard).join('') + '</div>' : empty(f.k === 'open' ? 'Đã trả lời hết 🎉' : 'Chưa có liên hệ nào.'));
  }
  function toggleContact(row) {
    var c = S.d.contacts.filter(function (x) { return x.row === row; })[0]; if (!c) return;
    var done = !c.done, note = c.note;
    if (done) { var n = prompt('Đã tư vấn gì cho ' + c.name + '? (không bắt buộc)', c.note || ''); if (n === null) return; note = n.trim(); }
    c.done = done; c.note = note; navBadges(); render();
    api('contact', { row: row, done: done, note: note }).then(function () {
      if (done) S.d.log.push({ time: Date.now(), by: S.user.name, what: 'Trả lời liên hệ', ref: c.phone, name: c.name, result: 'Đã trả lời', note: note });
      toast(done ? 'Đã đánh dấu trả lời ✓' : 'Đã chuyển về chưa trả lời'); render();
    }, function (e) { c.done = !done; navBadges(); render(); toast(e.message, true); });
  }

  /* ================================================================ CÀI ĐẶT */
  function viewSettings() {
    var h = '<div class="page-head"><h1>Cài đặt</h1></div>';
    h += '<div class="box"><h3>Tài khoản</h3><p style="margin:0 0 10px">' + esc(S.user.name) + ' · ' + esc(S.user.email) + ' · <b>' + esc(S.user.role) + '</b></p><button class="btn danger" id="logout">Đăng xuất</button></div>';
    h += '<div class="box guide"><h3>Hướng dẫn nhanh</h3><ol>' +
      '<li>Mỗi sáng mở tab <b>Hôm nay</b>. Làm lần lượt 3 phần: đơn mới, chăm sóc khách, liên hệ.</li>' +
      '<li><b>Đơn mới:</b> gọi khách xác nhận, xong bấm <b>✅ Xác nhận</b>. Gửi hàng thì bấm <b>🚚 Đang giao</b>, khách nhận thì <b>📬 Đã giao</b>.</li>' +
      '<li><b>Chăm sóc:</b> bấm <b>💬 Chăm sóc</b> → <b>Copy tin & mở Zalo</b> → dán tin gửi khách → quay lại chọn <b>Kết quả</b> → <b>Lưu</b>. Khách đó sẽ tự biến khỏi danh sách.</li>' +
      '<li>Khách hẹn gọi lại: chọn “Hẹn gọi lại” và chọn ngày. Đến ngày, khách tự hiện lại ở tab Hôm nay.</li>' +
      '<li>Khách đặt qua Zalo / điện thoại: vào <b>Đơn hàng → ＋ Tạo đơn</b> để lưu, khách sẽ được chăm sóc tự động như đơn web.</li>' +
      '<li>Nhãn <span class="tag noconsent">Chỉ hỏi thăm</span>: khách chưa đồng ý nhận tin, không gửi quảng cáo / ưu đãi.</li>' +
      '</ol><p class="small muted" style="margin:6px 0 0">Không chụp màn hình, không gửi danh sách khách ra ngoài: đây là dữ liệu cá nhân, pháp luật yêu cầu giữ kín (Nghị định 13/2023).</p></div>';
    if (lvl() < 2) return h;
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
      var us = S.f.us || (S.f.us = S.d.users.map(function (u) { return { email: u.email, name: u.name, role: u.role, active: u.active !== false }; }));
      h += '<div class="box"><h3>Nhân sự được vào CRM</h3><p class="hint" style="margin:0 0 10px"><b>Quản trị</b>: toàn quyền. <b>Quản lý</b>: thêm xem doanh thu, sửa chu kỳ & mẫu tin. <b>Nhân viên</b>: chăm sóc khách, xử lý đơn. Nhân viên nghỉ việc: bỏ tích “Đang dùng” là không vào được nữa.</p>' +
        '<div class="edit-table" id="usT"><div class="edit-row usr head"><span>Email</span><span>Tên hiển thị</span><span>Quyền</span><span>Đang dùng</span><span></span></div>' +
        us.map(function (u, i) { return '<div class="edit-row usr" data-i="' + i + '"><input type="email" data-k="email" value="' + esc(u.email) + '" placeholder="email@gmail.com"><input type="text" data-k="name" value="' + esc(u.name) + '" placeholder="Tên"><select data-k="role">' + ['Nhân viên', 'Quản lý', 'Quản trị'].map(function (r) { return '<option' + (r === u.role ? ' selected' : '') + '>' + r + '</option>'; }).join('') + '</select><label class="switch"><input type="checkbox" data-k="active"' + (u.active ? ' checked' : '') + '> Có</label><button class="rm" data-rm="us" data-i="' + i + '" aria-label="Xoá">✕</button></div>'; }).join('') +
        '</div><div class="steps" style="margin-top:10px"><button class="btn" data-add="us">＋ Thêm người</button><button class="btn pri" id="usSave">Lưu nhân sự</button></div></div>';
    }
    return h;
  }
  function bindSettings() {
    $('#logout').onclick = function () { if (confirm('Đăng xuất khỏi CRM?')) logout(); };
    if (lvl() < 2) return;
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
    var t = e.target.closest('[data-care],[data-next],[data-contact],[data-neworder],[data-cf],[data-os],[data-lf],[data-more],[data-add],[data-rm],[data-cust],[data-order]');
    if (!t || !S.d) return;
    if (e.target.closest('a[href]')) return; // nút gọi / Zalo bên trong thẻ
    var a = function (k) { return t.getAttribute(k); };
    if (t.hasAttribute('data-care')) { e.stopPropagation(); openCare(a('data-care'), a('data-task')); return; }
    if (t.hasAttribute('data-next')) { var o = findOrder(a('data-next')); if (o && NEXT[o.status]) setStatus(o, NEXT[o.status]); return; }
    if (t.hasAttribute('data-contact')) { toggleContact(+a('data-contact')); return; }
    if (t.hasAttribute('data-neworder')) { openNewOrder(a('data-neworder')); return; }
    if (t.hasAttribute('data-cf')) { S.f.c.k = a('data-cf'); S.f.c.n = 60; render(); return; }
    if (t.hasAttribute('data-os')) { S.f.o.st = a('data-os'); S.f.o.n = 60; render(); return; }
    if (t.hasAttribute('data-lf')) { S.f.l.k = a('data-lf'); render(); return; }
    if (t.hasAttribute('data-more')) { S.f[a('data-more')].n += 60; render(); return; }
    if (t.hasAttribute('data-add')) { var k = a('data-add'); S.f[k].push(k === 'us' ? { email: '', name: '', role: 'Nhân viên', active: true } : k === 'tp' ? ['', '', ''] : ['', '', '', '']); render(); var rows = $$('#' + k + 'T .edit-row[data-i]'); if (rows.length) $('input', rows[rows.length - 1]).focus(); return; }
    if (t.hasAttribute('data-rm')) { var k2 = a('data-rm'); if (k2 === 'us' && S.f.us[+a('data-i')].email === S.user.email) { toast('Không tự xoá tài khoản của mình được.', true); return; } S.f[k2].splice(+a('data-i'), 1); render(); return; }
    if (t.hasAttribute('data-cust')) { closeModal(true); openCustomer(a('data-cust')); return; }
    if (t.hasAttribute('data-order')) { closeModal(true); openOrder(a('data-order')); return; }
  });
  var typing = null;
  document.addEventListener('input', function (e) {
    if (!S.d) return;
    if (e.target.id === 'cq' || e.target.id === 'oq') {
      var key = e.target.id === 'cq' ? 'c' : 'o', v = e.target.value;
      clearTimeout(typing); typing = setTimeout(function () { S.f[key].q = v; S.f[key].n = 60; render(); }, 180);
    }
  });
  document.addEventListener('change', function (e) {
    if (!S.d) return;
    if (e.target.id === 'csort') { S.f.c.sort = e.target.value; render(); }
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
