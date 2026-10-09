/* Thực Dưỡng Lành – main.js */
(function () {
  'use strict';
  var $ = function (s, c) { return (c || document).querySelector(s); };
  var $$ = function (s, c) { return Array.prototype.slice.call((c || document).querySelectorAll(s)); };
  var PRODUCTS = window.TDL_PRODUCTS || [];
  var CFG = window.TDL_CONFIG || {};
  var BY = {}; PRODUCTS.forEach(function (p) { BY[p.slug] = p; });
  var ICON = {
    cart: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"><path d="M3 4h2l2.4 11.2a2 2 0 0 0 2 1.6h7.7a2 2 0 0 0 2-1.5L21 8H6.2"/><circle cx="10" cy="20.5" r="1.3"/><circle cx="17" cy="20.5" r="1.3"/></svg>',
    trash: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round"><path d="M4 7h16M9 7V4h6v3M6 7l1 13h10l1-13"/></svg>',
    check: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><path d="m5 12.5 4.5 4.5L19 7.5"/></svg>',
    heart: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linejoin="round"><path d="M12 20.5s-7.5-4.6-9.3-9.2C1.5 8 3.6 4.5 7.1 4.5c2 0 3.5 1.1 4.9 2.8 1.4-1.7 2.9-2.8 4.9-2.8 3.5 0 5.6 3.5 4.4 6.8-1.8 4.6-9.3 9.2-9.3 9.2z"/></svg>',
    close: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M6 6l12 12M18 6 6 18"/></svg>',
    left: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="m15 6-6 6 6 6"/></svg>',
    right: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="m9 6 6 6-6 6"/></svg>'
  };

  /* ---------- utils ---------- */
  function money(n) { return n == null ? 'Liên hệ' : Math.round(n).toString().replace(/\B(?=(\d{3})+(?!\d))/g, '.') + ' ₫'; }
  function esc(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }
  function norm(s) { return String(s || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/đ/g, 'd'); }
  function load(k, d) { try { var v = localStorage.getItem(k); return v ? JSON.parse(v) : d; } catch (e) { return d; } }
  function save(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) { } }
  function toast(msg, type) {
    var t = $('#toast'); if (!t) return;
    t.className = 'toast show ' + (type || ''); t.textContent = msg;
    clearTimeout(t._h); t._h = setTimeout(function () { t.className = 'toast'; }, 2600);
  }
  function offPct(v) { return v && v.price && v.regular_price && v.regular_price > v.price ? (v.web_off || Math.round((1 - v.price / v.regular_price) * 100)) : 0; }
  function perServing(v, p) { var n = v && v.servings; if (!n || !v.price) return ''; return '≈ ' + money(Math.round(v.price / n / 500) * 500).replace(' ₫', 'đ') + '/' + (v.serving_unit || (p && p.serving_unit) || 'phần'); }
  function cardItem(p) { var vs = (p.variants || []).filter(function (v) { return v.price != null; }); return vs.length > 1 ? vs.reduce(function (a, b) { return b.price < a.price ? b : a; }) : null; }
  function lock(on) { document.documentElement.style.overflow = on ? 'hidden' : ''; }
  function qs(name) { return new URLSearchParams(location.search).get(name) || ''; }

  /* ---------- đo lường: GA4 + Clarity (+ pixel quảng cáo nếu có), chỉ bật sau khi khách đồng ý ---------- */
  var CONSENT_KEY = 'tdl_consent';
  function consent() { try { return localStorage.getItem(CONSENT_KEY); } catch (e) { return null; } }
  var loaded = false;
  function loadTrackers() {
    if (loaded) return; loaded = true;
    function js(src) { var s = document.createElement('script'); s.async = true; s.src = src; document.head.appendChild(s); return s; }
    if (CFG.ga4_id) { window.dataLayer = window.dataLayer || []; window.gtag = function () { dataLayer.push(arguments); }; gtag('js', new Date()); gtag('config', CFG.ga4_id); js('https://www.googletagmanager.com/gtag/js?id=' + encodeURIComponent(CFG.ga4_id)); }
    if (CFG.clarity_id) { (function (c, l, a, r, i) { c[a] = c[a] || function () { (c[a].q = c[a].q || []).push(arguments); }; var t = l.createElement(r); t.async = 1; t.src = 'https://www.clarity.ms/tag/' + i; var y = l.getElementsByTagName(r)[0]; y.parentNode.insertBefore(t, y); })(window, document, 'clarity', 'script', CFG.clarity_id); }
    if (CFG.meta_pixel) { !function (f, b, e, v, n, t, s) { if (f.fbq) return; n = f.fbq = function () { n.callMethod ? n.callMethod.apply(n, arguments) : n.queue.push(arguments); }; if (!f._fbq) f._fbq = n; n.push = n; n.loaded = !0; n.version = '2.0'; n.queue = []; t = b.createElement(e); t.async = !0; t.src = v; s = b.getElementsByTagName(e)[0]; s.parentNode.insertBefore(t, s); }(window, document, 'script', 'https://connect.facebook.net/en_US/fbevents.js'); fbq('init', CFG.meta_pixel); fbq('track', 'PageView'); }
    if (CFG.tiktok_pixel) { !function (w, d, t) { w.TiktokAnalyticsObject = t; var ttq = w[t] = w[t] || []; ttq.methods = ['page', 'track', 'identify', 'instances', 'debug', 'on', 'off', 'once', 'ready', 'alias', 'group', 'enableCookie', 'disableCookie']; ttq.setAndDefer = function (t, e) { t[e] = function () { t.push([e].concat(Array.prototype.slice.call(arguments, 0))); }; }; for (var i = 0; i < ttq.methods.length; i++) ttq.setAndDefer(ttq, ttq.methods[i]); ttq.load = function (e) { var s = d.createElement('script'); s.async = !0; s.src = 'https://analytics.tiktok.com/i18n/pixel/events.js?sdkid=' + e + '&lib=' + t; var x = d.getElementsByTagName('script')[0]; x.parentNode.insertBefore(s, x); }; ttq.load(CFG.tiktok_pixel); ttq.page(); }(window, document, 'ttq'); }
    flushQueue();
  }
  var trackQ = [];
  function flushQueue() { var q = trackQ; trackQ = []; q.forEach(function (x) { track(x[0], x[1]); }); }
  var META_MAP = { view_item: 'ViewContent', add_to_cart: 'AddToCart', begin_checkout: 'InitiateCheckout', purchase: 'Purchase', search: 'Search', generate_lead: 'Lead', click_call: 'Contact', click_zalo: 'Contact' };
  var TT_MAP = { view_item: 'ViewContent', add_to_cart: 'AddToCart', begin_checkout: 'InitiateCheckout', purchase: 'CompletePayment', search: 'Search', generate_lead: 'SubmitForm', click_call: 'Contact', click_zalo: 'Contact' };
  function track(name, params) {
    params = params || {};
    if (consent() !== 'yes') return;
    if (!loaded) { trackQ.push([name, params]); return; }
    try { if (window.gtag) gtag('event', name, params); } catch (e) { }
    try { if (window.clarity) clarity('event', name); } catch (e) { }
    try { if (window.fbq && META_MAP[name]) fbq('track', META_MAP[name], { value: params.value, currency: 'VND', content_ids: (params.items || []).map(function (i) { return i.item_id; }), content_type: 'product' }); } catch (e) { }
    try { if (window.ttq && TT_MAP[name]) ttq.track(TT_MAP[name], { value: params.value, currency: 'VND', contents: (params.items || []).map(function (i) { return { content_id: i.item_id, quantity: i.quantity, price: i.price }; }) }); } catch (e) { }
  }
  function gaItem(slug, vi, qty) { var p = BY[slug]; if (!p) return null; var v = (vi >= 0 && p.variants && p.variants[vi]) ? p.variants[vi] : null; return { item_id: slug, item_name: p.name, item_variant: v ? v.name : (p.unit || ''), item_category: p.cat, price: v ? v.price : p.price, quantity: qty || 1 }; }
  function initConsent() {
    var bar = $('#cookieBar'); if (!bar) return;
    var c = consent();
    if (c === 'yes') loadTrackers();
    if (!c) bar.hidden = false;
    bar.addEventListener('click', function (e) {
      var b = e.target.closest('[data-consent]'); if (!b) return;
      var v = b.getAttribute('data-consent'); try { localStorage.setItem(CONSENT_KEY, v); } catch (x) { }
      bar.hidden = true; if (v === 'yes') { loadTrackers(); trackPageEvents(); }
    });
  }
  /* nguồn khách: UTM / Facebook / TikTok / Google / trang giới thiệu – lưu 30 ngày để gắn vào đơn */
  function captureSource() {
    try {
      var q = new URLSearchParams(location.search), now = Date.now(), src = null;
      if (q.get('utm_source')) src = { source: q.get('utm_source'), medium: q.get('utm_medium') || '', campaign: q.get('utm_campaign') || '', content: q.get('utm_content') || '' };
      else if (q.get('fbclid')) src = { source: 'facebook', medium: 'paid_or_social', campaign: '' };
      else if (q.get('ttclid')) src = { source: 'tiktok', medium: 'paid', campaign: '' };
      else if (q.get('gclid')) src = { source: 'google', medium: 'cpc', campaign: '' };
      else if (document.referrer && document.referrer.indexOf(location.host) < 0) { var h = new URL(document.referrer).hostname.replace(/^www\./, ''); src = { source: h, medium: /google|bing|coccoc/.test(h) ? 'organic' : 'referral', campaign: '' }; }
      if (src) { src.t = now; src.landing = location.pathname; var first = load('tdl_src_first', null); if (!first || now - first.t > 30 * 864e5) save('tdl_src_first', src); save('tdl_src_last', src); }
    } catch (e) { }
  }
  function sourceLabel() { var l = load('tdl_src_last', null), f = load('tdl_src_first', null); function fmt(x) { return x ? [x.source, x.medium, x.campaign].filter(Boolean).join(' / ') : ''; } return { last: fmt(l) || 'Truy cập trực tiếp', first: fmt(f) || '' }; }
  function trackPageEvents() {
    var wrap = $('[data-product]'); if (wrap) { var sl = wrap.getAttribute('data-product'), it = gaItem(sl, (BY[sl] && BY[sl].variants && BY[sl].variants.length) ? 0 : -1, 1); if (it) track('view_item', { currency: 'VND', value: it.price || 0, items: [it] }); }
    if ($('#searchPage') && qs('q')) track('search', { search_term: qs('q') });
  }

  /* ---------- cart ---------- */
  var cart = load('tdl_cart', []);
  function unitPrice(it) {
    var p = BY[it.slug]; if (!p) return null;
    if (it.vi >= 0 && p.variants && p.variants[it.vi]) return p.variants[it.vi].price;
    return p.price;
  }
  function cleanCart() { cart = cart.filter(function (it) { return BY[it.slug] && unitPrice(it) != null && it.qty > 0; }); }
  cleanCart();
  function saveCart() { save('tdl_cart', cart); renderCounts(); renderMini(); }
  function cartQty() { return cart.reduce(function (s, it) { return s + it.qty; }, 0); }
  function cartTotal() { return cart.reduce(function (s, it) { return s + it.qty * (unitPrice(it) || 0); }, 0); }
  function addToCart(slug, qty, vi) {
    var p = BY[slug]; if (!p) return false;
    vi = (vi == null) ? -1 : vi;
    var price = (vi >= 0 && p.variants[vi]) ? p.variants[vi].price : p.price;
    if (price == null) { toast('Sản phẩm đang cập nhật giá, vui lòng liên hệ tư vấn.', 'err'); return false; }
    var key = slug + '|' + vi;
    var it = cart.filter(function (x) { return x.key === key; })[0];
    if (it) it.qty += qty; else cart.push({ key: key, slug: slug, vi: vi, qty: qty });
    saveCart(); bump('[data-cart-count]');
    var gi = gaItem(slug, vi, qty); if (gi) track('add_to_cart', { currency: 'VND', value: (gi.price || 0) * qty, items: [gi] });
    return true;
  }
  function variantName(it) { var p = BY[it.slug]; return (it.vi >= 0 && p.variants[it.vi]) ? p.variants[it.vi].name : (p.unit || ''); }
  function bump(sel) { $$(sel).forEach(function (el) { el.classList.remove('bump'); void el.offsetWidth; el.classList.add('bump'); }); }

  /* ---------- wishlist ---------- */
  var wish = load('tdl_wish', []).filter(function (s) { return BY[s]; });
  function toggleWish(slug) {
    var i = wish.indexOf(slug);
    if (i >= 0) { wish.splice(i, 1); toast('Đã bỏ khỏi danh sách yêu thích'); }
    else { wish.push(slug); toast('Đã thêm vào danh sách yêu thích', 'ok'); bump('[data-wish-count]'); }
    save('tdl_wish', wish); renderCounts(); markWish();
    if ($('#wishPage')) renderWishPage();
  }
  function markWish() { $$('[data-wish]').forEach(function (b) { b.classList.toggle('on', wish.indexOf(b.getAttribute('data-wish')) >= 0); }); }

  function renderCounts() {
    $$('[data-cart-count]').forEach(function (e) { e.textContent = cartQty(); });
    $$('[data-wish-count]').forEach(function (e) { e.textContent = wish.length; });
  }

  /* ---------- mini cart ---------- */
  function renderMini() {
    var body = $('#mcBody'); if (!body) return;
    if (!cart.length) {
      body.innerHTML = '<div class="mc-empty">' + ICON.cart + '<p>Giỏ hàng đang trống</p><a class="btn btn-sm" href="/san-pham/">Mua sắm ngay</a></div>';
    } else {
      body.innerHTML = cart.map(function (it) {
        var p = BY[it.slug];
        return '<div class="mc-item"><a href="' + p.url + '"><img src="' + p.img + '" alt=""></a><div><b>' + esc(p.name) + '</b><small>' + esc(variantName(it)) + '</small>' +
          '<div class="price"><ins>' + it.qty + ' × ' + money(unitPrice(it)) + '</ins></div></div>' +
          '<button class="mc-rm" data-rm="' + esc(it.key) + '" aria-label="Xóa">' + ICON.trash + '</button></div>';
      }).join('');
    }
    var t = $('#mcTotal'); if (t) t.textContent = money(cartTotal());
    var hb = $('#mcHint'); if (hb) hb.innerHTML = cart.length ? freeShipHint(cartTotal()) : '';
    var foot = $('.mc-foot'); if (foot) foot.style.display = cart.length ? '' : 'none';
  }
  function openMini() { var m = $('#minicart'); if (!m) return; renderMini(); m.classList.add('open'); m.setAttribute('aria-hidden', 'false'); lock(true); }
  function closeMini() { var m = $('#minicart'); if (!m) return; m.classList.remove('open'); m.setAttribute('aria-hidden', 'true'); lock(false); }

  /* ---------- header, menu ---------- */
  function initHeader() {
    var h = $('#siteHeader'), top = $('#toTop');
    var onScroll = function () {
      var y = window.scrollY;
      if (h) h.classList.toggle('scrolled', y > 10);
      if (top) top.classList.toggle('show', y > 600);
      var sb = $('#stickyBuy'), br = $('.buy-row');
      if (sb && br) sb.classList.toggle('show', br.getBoundingClientRect().bottom < 0);
    };
    window.addEventListener('scroll', onScroll, { passive: true }); onScroll();
    if (top) top.addEventListener('click', function () { window.scrollTo({ top: 0, behavior: 'smooth' }); });

    var oc = $('#offcanvas');
    var openOc = function () { oc.classList.add('open'); oc.setAttribute('aria-hidden', 'false'); lock(true); };
    var closeOc = function () { oc.classList.remove('open'); oc.setAttribute('aria-hidden', 'true'); lock(false); };
    if ($('#burger')) $('#burger').addEventListener('click', openOc);
    if (oc) oc.addEventListener('click', function (e) { if (e.target === oc || e.target.closest('[data-oc-close]')) closeOc(); });
    $$('.oc-menu .sub-toggle').forEach(function (b) { b.addEventListener('click', function () { b.parentNode.classList.toggle('open'); }); });

    // search
    var layer = $('#searchLayer'), input = $('#searchInput'), res = $('#searchResults');
    var openS = function () { layer.classList.add('open'); layer.setAttribute('aria-hidden', 'false'); lock(true); setTimeout(function () { input.focus(); }, 60); liveSearch(); };
    var closeS = function () { layer.classList.remove('open'); layer.setAttribute('aria-hidden', 'true'); lock(false); };
    if ($('#searchOpen')) $('#searchOpen').addEventListener('click', openS);
    if (layer) layer.addEventListener('click', function (e) { if (e.target === layer || e.target.closest('[data-search-close]')) closeS(); });
    function liveSearch() {
      var q = input.value.trim();
      var list = q ? searchProducts(q) : PRODUCTS.filter(function (p) { return p.featured; });
      if (!list.length) { res.innerHTML = '<div class="sr-empty">Không tìm thấy sản phẩm phù hợp với “' + esc(q) + '”.</div>'; return; }
      res.innerHTML = (q ? '' : '<div class="sr-empty" style="padding:12px 18px 4px">Gợi ý cho bạn</div>') + list.slice(0, 6).map(function (p) {
        return '<a class="sr-item" href="' + p.url + '"><img src="' + p.img + '" alt=""><div><b>' + esc(p.name) + '</b><small>' + money(p.price) + '</small></div></a>';
      }).join('') + (q ? '<a class="sr-all" href="/tim-kiem/?q=' + encodeURIComponent(q) + '">Xem tất cả kết quả</a>' : '');
    }
    if (input) input.addEventListener('input', liveSearch);

    document.addEventListener('keydown', function (e) {
      if (e.key === 'Escape') { if (layer) closeS(); if (oc) closeOc(); closeMini(); closeLb(); var q = $('.qo'); if (q) { q.remove(); lock(false); } }
      if (e.key === '/' && !/input|textarea/i.test(document.activeElement.tagName) && layer) { e.preventDefault(); openS(); }
    });
  }
  function searchProducts(q) {
    var words = norm(q).split(/\s+/).filter(Boolean);
    return PRODUCTS.map(function (p) {
      var name = norm(p.name), text = norm(p.text + ' ' + p.cat);
      var score = 0, ok = words.every(function (w) { var inName = name.indexOf(w) >= 0; if (inName) score += 3; else if (text.indexOf(w) >= 0) score += 1; else return false; return true; });
      return ok ? { p: p, s: score } : null;
    }).filter(Boolean).sort(function (a, b) { return b.s - a.s; }).map(function (x) { return x.p; });
  }

  /* ---------- global clicks ---------- */
  function initClicks() {
    document.addEventListener('click', function (e) {
      var a = e.target.closest('a[href]');
      if (a) { var h = a.getAttribute('href') || '';
        if (h.indexOf('tel:') === 0) track('click_call', { location: a.closest('.float-widget') ? 'nut_noi' : (a.closest('.qo,.checkout') ? 'dat_hang' : 'trang') });
        else if (h.indexOf('zalo.me') >= 0) track('click_zalo', { location: a.closest('.float-widget') ? 'nut_noi' : (a.closest('.qo,.checkout') ? 'dat_hang' : 'trang') });
        else if (/heyzine|\.pdf$/.test(h)) track('view_brochure', { method: /\.pdf$/.test(h) ? 'pdf' : 'fullscreen' }); }
      var t;
      if ((t = e.target.closest('[data-add]'))) { e.preventDefault(); if (addToCart(t.getAttribute('data-add'), 1)) openMini(); return; }
      if ((t = e.target.closest('[data-wish]'))) { e.preventDefault(); toggleWish(t.getAttribute('data-wish')); return; }
      if ((t = e.target.closest('[data-rm]'))) { var k = t.getAttribute('data-rm'); cart = cart.filter(function (x) { return x.key !== k; }); saveCart(); if ($('#cartPage')) renderCartPage(); return; }
      if ((t = e.target.closest('#cartOpen'))) { if (!$('#cartPage') && !$('#checkoutForm')) { e.preventDefault(); openMini(); } return; }
      if ((t = e.target.closest('[data-mc-close]')) || e.target === $('#minicart')) { closeMini(); return; }
      if ((t = e.target.closest('[data-copy]'))) {
        var url = t.getAttribute('data-copy');
        if (navigator.clipboard) navigator.clipboard.writeText(url).then(function () { toast('Đã sao chép liên kết', 'ok'); });
        return;
      }
      if ((t = e.target.closest('[data-cta]'))) track('cta_click', { cta: t.getAttribute('data-cta') });
      if ((t = e.target.closest('[data-buy-now]')) && !t.closest('[data-product]')) { // nút Mua ngay ngoài trang chi tiết (thẻ gói ở trang chủ…)
        var bp = BY[t.getAttribute('data-buy-now')]; if (!bp) return;
        var bvi = (bp.variants && bp.variants.length) ? 0 : -1, bpr = bvi >= 0 ? bp.variants[0].price : bp.price;
        if (bpr == null) { toast('Sản phẩm đang cập nhật giá, vui lòng liên hệ tư vấn.', 'err'); return; }
        openQuickOrder(bp.slug, bvi, 1); return;
      }
      if ((t = e.target.closest('.v-frame[data-yt]'))) {
        if (t.querySelector('iframe')) return;
        $$('.v-frame video').forEach(function (o) { o.pause(); });
        var f = document.createElement('iframe'), id = t.getAttribute('data-yt');
        f.src = 'https://www.youtube-nocookie.com/embed/' + id + '?autoplay=1&rel=0&playsinline=1&modestbranding=1';
        f.title = t.getAttribute('data-title') || 'Video'; f.allow = 'autoplay; encrypted-media; picture-in-picture; fullscreen'; f.allowFullscreen = true;
        t.innerHTML = ''; t.appendChild(f); track('video_play', { video: 'youtube:' + id });
        return;
      }
      if ((t = e.target.closest('.v-frame'))) {
        if (t.querySelector('video')) return;
        var v = document.createElement('video');
        v.src = t.getAttribute('data-video'); v.controls = true; v.autoplay = true; v.playsInline = true;
        $$('.v-frame video').forEach(function (o) { o.pause(); });
        t.innerHTML = ''; t.appendChild(v); v.play().catch(function () { }); track('video_play', { video: t.getAttribute('data-video') });
        return;
      }
    });
  }

  /* ---------- hero slider ---------- */
  function initHero() {
    var hero = $('#hero'); if (!hero) return;
    var slides = $$('.slide', hero), dots = $$('.dot', hero), i = 0, timer;
    function go(n) {
      i = (n + slides.length) % slides.length;
      slides.forEach(function (s, k) { s.classList.toggle('is-active', k === i); });
      dots.forEach(function (d, k) { d.classList.toggle('is-active', k === i); });
    }
    function play() { clearInterval(timer); timer = setInterval(function () { go(i + 1); }, 6000); }
    hero.addEventListener('click', function (e) {
      var t;
      if ((t = e.target.closest('[data-go]'))) { go(+t.getAttribute('data-go')); play(); }
      else if (e.target.closest('[data-next]')) { go(i + 1); play(); }
      else if (e.target.closest('[data-prev]')) { go(i - 1); play(); }
    });
    hero.addEventListener('mouseenter', function () { clearInterval(timer); });
    hero.addEventListener('mouseleave', play);
    swipe(hero, function () { go(i + 1); play(); }, function () { go(i - 1); play(); });
    play();
  }
  function swipe(el, onLeft, onRight) {
    var x0 = null, y0 = null;
    el.addEventListener('touchstart', function (e) { x0 = e.touches[0].clientX; y0 = e.touches[0].clientY; }, { passive: true });
    el.addEventListener('touchend', function (e) {
      if (x0 == null) return;
      var dx = e.changedTouches[0].clientX - x0, dy = e.changedTouches[0].clientY - y0;
      if (Math.abs(dx) > 45 && Math.abs(dx) > Math.abs(dy)) { if (dx < 0) onLeft(); else onRight(); }
      x0 = null;
    }, { passive: true });
  }

  /* ---------- lightbox ---------- */
  var lb, lbList = [], lbI = 0;
  function openLb(list, i) {
    if (!lb) {
      lb = document.createElement('div'); lb.className = 'lightbox';
      lb.innerHTML = '<img alt=""><button class="lb-close" aria-label="Đóng">' + ICON.close + '</button><button class="lb-prev" aria-label="Trước">' + ICON.left + '</button><button class="lb-next" aria-label="Sau">' + ICON.right + '</button>';
      document.body.appendChild(lb);
      lb.addEventListener('click', function (e) {
        if (e.target.closest('.lb-prev')) showLb(lbI - 1);
        else if (e.target.closest('.lb-next')) showLb(lbI + 1);
        else if (e.target.tagName !== 'IMG') closeLb();
      });
      swipe(lb, function () { showLb(lbI + 1); }, function () { showLb(lbI - 1); });
    }
    lbList = list; showLb(i); lb.classList.add('open'); lock(true);
  }
  function showLb(i) { lbI = (i + lbList.length) % lbList.length; $('img', lb).src = lbList[lbI]; $$('.lb-prev,.lb-next', lb).forEach(function (b) { b.style.display = lbList.length > 1 ? '' : 'none'; }); }
  function closeLb() { if (lb && lb.classList.contains('open')) { lb.classList.remove('open'); lock(false); } }
  function initLightbox() {
    document.addEventListener('click', function (e) {
      var a = e.target.closest('[data-lightbox]'); if (!a) return;
      e.preventDefault();
      var g = a.getAttribute('data-lightbox'), items = $$('[data-lightbox="' + g + '"]');
      openLb(items.map(function (x) { return x.getAttribute('href'); }), items.indexOf(a));
    });
  }

  /* ---------- product page ---------- */
  function initProduct() {
    var wrap = $('[data-product]'); if (!wrap) return;
    var slug = wrap.getAttribute('data-product'), p = BY[slug];
    var slides = $$('.g-slide'), thumbs = $$('.g-thumb'), gi = 0;
    function g(n) {
      gi = (n + slides.length) % slides.length;
      slides.forEach(function (s, k) { s.classList.toggle('is-active', k === gi); });
      thumbs.forEach(function (t, k) { t.classList.toggle('is-active', k === gi); });
      if (thumbs[gi]) thumbs[gi].scrollIntoView({ block: 'nearest', inline: 'nearest' });
    }
    thumbs.forEach(function (t) { t.addEventListener('click', function () { g(+t.getAttribute('data-thumb')); }); });
    if ($('[data-gnext]')) $('[data-gnext]').addEventListener('click', function (e) { e.preventDefault(); g(gi + 1); });
    if ($('[data-gprev]')) $('[data-gprev]').addEventListener('click', function (e) { e.preventDefault(); g(gi - 1); });
    if ($('.g-main')) swipe($('.g-main'), function () { g(gi + 1); }, function () { g(gi - 1); });

    var qin = $('#qtyInput');
    var vi = (p && p.variants && p.variants.length) ? 0 : -1;
    $$('[data-qminus]').forEach(function (b) { b.addEventListener('click', function () { qin.value = Math.max(1, (+qin.value || 1) - 1); }); });
    $$('[data-qplus]').forEach(function (b) { b.addEventListener('click', function () { qin.value = Math.min(99, (+qin.value || 1) + 1); }); });

    function renderPrice() {
      if (!p || vi < 0) return;
      var v = p.variants[vi], box = $('#pPrice .price');
      if (!box) return;
      var d = offPct(v);
      box.innerHTML = (d ? '<del>' + money(v.regular_price) + '</del>' : '') + '<ins' + (v.price == null ? ' class="contact"' : '') + '>' + money(v.price) + '</ins>' + (d ? '<span class="p-off">-' + d + '%</span>' : '');
      var per = $('#pPer'); if (per) per.textContent = perServing(v, p);
      var gm = $('.g-main'), gb = gm && $('.badge-sale', gm); // nhãn -X% trên ảnh theo quy cách đang chọn
      if (gm) { if (d) { if (!gb) { gb = document.createElement('span'); gb.className = 'badge-sale'; gm.insertBefore(gb, gm.firstChild); } gb.textContent = '-' + d + '%'; } else if (gb) gb.remove(); }
      document.dispatchEvent(new CustomEvent('tdl:variant', { detail: { vi: vi } }));
    }
    $$('[data-variant]').forEach(function (b) {
      b.addEventListener('click', function () {
        vi = +b.getAttribute('data-variant');
        $$('[data-variant]').forEach(function (x) { x.classList.toggle('is-active', x === b); });
        renderPrice();
      });
    });
    renderPrice();
    var getQty = function () { return Math.max(1, Math.min(99, parseInt(qin && qin.value, 10) || 1)); };
    $$('[data-add-detail]').forEach(function (b) { b.addEventListener('click', function () { if (addToCart(slug, getQty(), vi)) openMini(); }); });
    $$('[data-buy-now]').forEach(function (b) { b.addEventListener('click', function () { var pr = (vi >= 0 && p.variants[vi]) ? p.variants[vi].price : p.price; if (pr == null) { toast('Sản phẩm đang cập nhật giá, vui lòng liên hệ tư vấn.', 'err'); return; } openQuickOrder(slug, vi, qin ? getQty() : 1); }); });
  }

  function initCerts() { // huy hiệu "Kiểm nghiệm …" → mở tab Mô tả, cuộn tới mục Tiêu chuẩn & kiểm nghiệm (+ ảnh phiếu nếu có)
    document.addEventListener('click', function (e) {
      var a = e.target.closest('[data-cert]'), sec = $('#kiem-nghiem'); if (!a || !sec) return;
      e.preventDefault();
      var tab = $('[data-tab="desc"]'); if (tab && !tab.classList.contains('is-active')) tab.click();
      sec.scrollIntoView({ behavior: 'smooth', block: 'start' });
      var img = a.getAttribute('data-cert-img'); if (img) setTimeout(function () { openLb([img], 0); }, 500);
    });
  }
  function initTabs() {
    $$('[data-tabs]').forEach(function (t) {
      $$('[data-tab]', t).forEach(function (b) {
        b.addEventListener('click', function () {
          var k = b.getAttribute('data-tab');
          $$('[data-tab]', t).forEach(function (x) { x.classList.toggle('is-active', x === b); });
          $$('[data-panel]', t).forEach(function (x) { x.classList.toggle('is-active', x.getAttribute('data-panel') === k); });
        });
      });
    });
  }
  function initReadmore() {
    var b = $('[data-readmore-btn]'), r = $('[data-readmore]'); if (!b || !r) return;
    b.addEventListener('click', function () { var o = r.classList.toggle('open'); b.textContent = o ? 'Thu gọn' : 'Xem thêm'; });
  }

  /* ---------- listing sort ---------- */
  function initSort() {
    var sel = $('[data-sort]'), grid = $('.shop-grid'); if (!sel || !grid) return;
    var cards = $$('.p-card', grid);
    cards.forEach(function (c, i) { c._i = i; var w = $('[data-wish]', c); c._p = w ? BY[w.getAttribute('data-wish')] : null; });
    sel.addEventListener('change', function () {
      var v = sel.value, list = cards.slice();
      var pr = function (c) { if (!c._p) return Infinity; var ps = (c._p.variants || []).map(function (v) { return v.price; }).concat([c._p.price]).filter(function (x) { return x != null; }); return ps.length ? Math.min.apply(null, ps) : Infinity; }; // giá thấp nhất (đúng như thẻ hiện "Từ …")
      if (v === 'price-asc') list.sort(function (a, b) { return pr(a) - pr(b); });
      else if (v === 'price-desc') list.sort(function (a, b) { return (pr(b) === Infinity ? -1 : pr(b)) - (pr(a) === Infinity ? -1 : pr(a)); });
      else if (v === 'name') list.sort(function (a, b) { return a._p.name.localeCompare(b._p.name, 'vi'); });
      else list.sort(function (a, b) { return a._i - b._i; });
      list.forEach(function (c) { grid.appendChild(c); });
    });
  }

  /* ---------- cart page ---------- */
  function hasFS(items) { return (items || cart).some(function (i) { return (BY[i.slug] || {}).fs; }); } // có gói "miễn phí ship" trong đơn
  function shipInfo(sub, items) {
    var fee = +CFG.shipping_fee || 0, th = +CFG.free_ship_threshold || 0;
    if (hasFS(items)) return { fee: 0, label: 'Miễn phí' };
    if (th && sub >= th) return { fee: 0, label: 'Miễn phí' };
    if (fee) return { fee: fee, label: money(fee) };
    return { fee: 0, label: 'Báo khi xác nhận đơn' };
  }
  function renderCartPage() {
    var el = $('#cartPage'); if (!el) return;
    if (!cart.length) {
      el.innerHTML = '<div class="cart-empty card">' + ICON.cart + '<h2>Giỏ hàng của bạn đang trống</h2><p class="muted">Hãy khám phá các sản phẩm thuần tự nhiên của ' + esc(CFG.brand) + '.</p><a class="btn btn-lg" href="/san-pham/">Tiếp tục mua sắm</a></div>';
      return;
    }
    var sub = cartTotal(), sh = shipInfo(sub);
    el.innerHTML = '<div class="card"><table class="cart-table"><thead><tr><th>Sản phẩm</th><th>Đơn giá</th><th>Số lượng</th><th>Tạm tính</th><th></th></tr></thead><tbody>' +
      cart.map(function (it) {
        var p = BY[it.slug];
        return '<tr><td class="ct-p"><div class="ct-prod"><a href="' + p.url + '"><img src="' + p.img + '" alt=""></a><div><a href="' + p.url + '">' + esc(p.name) + '</a><small>' + esc(variantName(it)) + '</small></div></div></td>' +
          '<td class="ct-price">' + money(unitPrice(it)) + '</td>' +
          '<td><div class="qty sm"><button type="button" data-cq="-1" data-key="' + esc(it.key) + '" aria-label="Giảm">−</button><input type="number" min="1" max="99" value="' + it.qty + '" data-cqi="' + esc(it.key) + '" aria-label="Số lượng"><button type="button" data-cq="1" data-key="' + esc(it.key) + '" aria-label="Tăng">+</button></div></td>' +
          '<td class="ct-sub">' + money(unitPrice(it) * it.qty) + '</td>' +
          '<td><button class="mc-rm" data-rm="' + esc(it.key) + '" aria-label="Xóa">' + ICON.trash + '</button></td></tr>';
      }).join('') + '</tbody></table>' +
      '<div class="cart-actions"><a class="btn btn-outline" href="/san-pham/">← Tiếp tục mua sắm</a><button class="btn btn-ghost" data-clear>Xóa giỏ hàng</button></div></div>' +
      '<aside class="card totals"><h2>Cộng giỏ hàng</h2><div class="row"><span>Tạm tính</span><b>' + money(sub) + '</b></div><div class="row"><span>Phí vận chuyển</span><span>' + sh.label + '</span></div>' + freeShipHint(sub) +
      '<div class="row total"><span>Tổng</span><b>' + money(sub + sh.fee) + '</b></div><a class="btn btn-lg btn-block" href="/thanh-toan/">Tiến hành thanh toán</a></aside>';
  }
  function initCartPage() {
    var el = $('#cartPage'); if (!el) return;
    renderCartPage();
    el.addEventListener('click', function (e) {
      var b = e.target.closest('[data-cq]');
      if (b) { var it = cart.filter(function (x) { return x.key === b.getAttribute('data-key'); })[0]; if (it) { it.qty = Math.max(1, Math.min(99, it.qty + (+b.getAttribute('data-cq')))); saveCart(); renderCartPage(); } }
      if (e.target.closest('[data-clear]') && confirm('Xóa toàn bộ sản phẩm trong giỏ hàng?')) { cart = []; saveCart(); renderCartPage(); }
    });
    el.addEventListener('change', function (e) {
      var k = e.target.getAttribute('data-cqi'); if (!k) return;
      var it = cart.filter(function (x) { return x.key === k; })[0];
      if (it) { it.qty = Math.max(1, Math.min(99, parseInt(e.target.value, 10) || 1)); saveCart(); renderCartPage(); }
    });
  }

  /* ---------- checkout ---------- */
  function renderCheckoutSummary() {}
  function orderText(o) {
    var c = o.customer, lines = ['ĐƠN HÀNG ' + o.id + ' – ' + CFG.brand, 'Khách: ' + c.name + ' – ' + c.phone,
      'Địa chỉ: ' + c.address + ', ' + c.district + ', ' + c.province];
    o.items.forEach(function (it) { lines.push('• ' + it.name + (it.variant ? ' (' + it.variant + ')' : '') + ' x' + it.qty + ' = ' + money(it.subtotal)); });
    lines.push('Tổng: ' + money(o.total) + ' – Thanh toán: ' + (o.payment === 'bank' ? 'Chuyển khoản' : 'COD'));
    if (c.note) lines.push('Ghi chú: ' + c.note);
    return lines.join('\n');
  }
  function send(payload) {
    if (!CFG.endpoint) return Promise.resolve({ sent: false });
    var body = JSON.stringify(payload);
    return fetch(CFG.endpoint, { method: 'POST', headers: { 'Content-Type': 'text/plain;charset=utf-8' }, body: body })
      .then(function (r) { return r.json().catch(function () { return { ok: true }; }); })
      .then(function (j) { if (j && j.ok === false) throw new Error(j.error || 'failed'); return { sent: true }; })
      .catch(function () {
        return fetch(CFG.endpoint, { method: 'POST', mode: 'no-cors', headers: { 'Content-Type': 'text/plain;charset=utf-8' }, body: body })
          .then(function () { return { sent: true }; });
      });
  }
  function validate(form) { // dùng cho form liên hệ
    var ok = true, first = null;
    $$('[required]', form).forEach(function (f) {
      var bad = !f.value.trim() || (f.type === 'tel' && !normPhone(f.value)) || (f.type === 'email' && f.value && !/^\S+@\S+\.\S+$/.test(f.value));
      f.classList.toggle('invalid', bad); if (bad) { ok = false; first = first || f; }
    });
    if (first) first.focus();
    return ok;
  }
  function normPhone(v) {
    var d = String(v || '').replace(/[^\d+]/g, '');
    if (d.indexOf('+84') === 0) d = '0' + d.slice(3); else if (/^84\d{9,10}$/.test(d)) d = '0' + d.slice(2);
    d = d.replace(/\D/g, '');
    return /^0\d{9,10}$/.test(d) ? d : '';
  }

  /* ---------- nhận diện địa chỉ (34 tỉnh / 3.321 phường xã, từ 1/7/2025) ---------- */
  var UNITS = null, unitsP = null;
  var PROV_ALIAS = { 'ha noi': ['hn', 'hanoi', 'tp hn', 'thu do ha noi'], 'ho chi minh': ['hcm', 'tp hcm', 'tphcm', 'sai gon', 'saigon', 'sg', 'thanh pho ho chi minh', 'tp ho chi minh', 'hcmc'], 'hai phong': ['hp', 'tp hp'], 'hue': ['thua thien hue', 'tt hue', 'thanh pho hue'], 'da nang': ['tp da nang'], 'can tho': ['tp can tho'], 'dak lak': ['daklak', 'dac lac'], 'ba ria vung tau': [] };
  var OLD_PROV = { 'ha giang': 'tuyen quang', 'yen bai': 'lao cai', 'bac kan': 'thai nguyen', 'bac can': 'thai nguyen', 'vinh phuc': 'phu tho', 'hoa binh': 'phu tho', 'bac giang': 'bac ninh', 'thai binh': 'hung yen', 'hai duong': 'hai phong', 'ha nam': 'ninh binh', 'nam dinh': 'ninh binh', 'quang binh': 'quang tri', 'quang nam': 'da nang', 'kon tum': 'quang ngai', 'kontum': 'quang ngai', 'binh dinh': 'gia lai', 'ninh thuan': 'khanh hoa', 'dak nong': 'lam dong', 'dac nong': 'lam dong', 'binh thuan': 'lam dong', 'phu yen': 'dak lak', 'binh duong': 'ho chi minh', 'ba ria vung tau': 'ho chi minh', 'ba ria': 'ho chi minh', 'vung tau': 'ho chi minh', 'brvt': 'ho chi minh', 'binh phuoc': 'dong nai', 'long an': 'tay ninh', 'soc trang': 'can tho', 'hau giang': 'can tho', 'ben tre': 'vinh long', 'tra vinh': 'vinh long', 'tien giang': 'dong thap', 'bac lieu': 'ca mau', 'kien giang': 'an giang' };
  function nz(s) { return ' ' + norm(s).replace(/[^a-z0-9]+/g, ' ').replace(/\s+/g, ' ').trim() + ' '; }
  function wardCore(n) { return n.replace(/^(Phường|Xã|Đặc khu)\s+/i, ''); }
  function loadUnits() {
    if (unitsP) return unitsP;
    unitsP = fetch('/assets/data/vn-units.json').then(function (r) { return r.json(); }).then(function (d) {
      d.forEach(function (p) {
        p.k = nz(p.n).trim(); p.keys = [p.k].concat(PROV_ALIAS[p.k] || []);
        Object.keys(OLD_PROV).forEach(function (o) { if (OLD_PROV[o] === p.k) p.keys.push(o); });
        p.ws = p.w.map(function (w) { var t = /^Xã/i.test(w) ? 'xa' : (/^Đặc khu/i.test(w) ? 'dac khu' : 'phuong'); return { n: w, k: nz(wardCore(w)).trim(), t: t }; });
      });
      var top = ['ha noi', 'ho chi minh'];
      d.sort(function (a, b) { var ia = top.indexOf(a.k), ib = top.indexOf(b.k); if (ia >= 0 || ib >= 0) return (ia < 0 ? 9 : ia) - (ib < 0 ? 9 : ib); return a.n.localeCompare(b.n, 'vi'); });
      UNITS = d; return d;
    });
    return unitsP;
  }
  var OLD_DISTRICT_WORDS = [' quan ', ' huyen ', ' q ', ' h ', ' thi xa ', ' tx ', ' tp ', ' thanh pho ', ' thi tran ', ' tt '];
  function findWard(txt, p) {
    var best = null;
    p.ws.forEach(function (w) {
      if (!w.k) return;
      var strongPrefixes = w.t === 'xa' ? [' xa ', ' x '] : (w.t === 'dac khu' ? [' dac khu ', ' dk '] : [' phuong ', ' p ']);
      var strong = strongPrefixes.some(function (pre) { return txt.indexOf(pre + w.k + ' ') >= 0; });
      var weak = false;
      if (!strong && w.k.length >= 4 && !/^\d+$/.test(w.k)) {
        var i = txt.indexOf(' ' + w.k + ' ');
        while (i >= 0) {
          var before = txt.slice(Math.max(0, i - 12), i + 1);
          if (!OLD_DISTRICT_WORDS.some(function (x) { return before.slice(-x.length) === x; }) && !/ (duong|pho|ngo|ngach|hem|kiet|to|thon|ap|khu|kdt|cho) $/.test(before)) { weak = true; break; }
          i = txt.indexOf(' ' + w.k + ' ', i + 1);
        }
      }
      if (strong || weak) {
        var score = (strong ? 100 : 0) + w.k.length;
        if (!best || score > best.score) best = { ward: w.n, score: score, strong: strong };
      }
    });
    return best;
  }
  function detectAddress(raw) {
    if (!UNITS || !raw || raw.trim().length < 4) return null;
    var txt = nz(raw), prov = null, provPos = -1, oldName = false;
    UNITS.forEach(function (p) {
      p.keys.forEach(function (k) {
        var i = txt.lastIndexOf(' ' + k + ' ');
        if (i > provPos || (i === provPos && i >= 0 && prov && k.length > prov.len)) { if (i >= 0) { provPos = i; prov = { p: p, len: k.length, key: k, old: !!OLD_PROV[k] }; } }
      });
    });
    if (prov) {
      // bỏ phần chữ đã dùng để nhận diện tỉnh, tránh hiểu nhầm tên tỉnh thành tên phường
      txt = txt.slice(0, provPos) + ' ' + txt.slice(provPos + prov.key.length + 1);
      prov.p.keys.forEach(function (k) { // gỡ cả tên tỉnh cũ (vd "bà rịa vũng tàu") nếu không đứng sau chữ Phường/Xã
        var i = txt.indexOf(' ' + k + ' ');
        while (i >= 0) {
          var pre = txt.slice(Math.max(0, i - 8), i + 1);
          if (/ (phuong|xa|p|x|dac khu) $/.test(pre)) { i = txt.indexOf(' ' + k + ' ', i + 1); continue; }
          txt = txt.slice(0, i) + ' ' + txt.slice(i + k.length + 1);
          i = txt.indexOf(' ' + k + ' ', i);
        }
      });
      var w = findWard(txt, prov.p);
      return { province: prov.p.n, ward: w ? w.ward : '', sure: !!(w && w.strong && !prov.old), oldProvince: prov.old };
    }
    var hits = [];
    UNITS.forEach(function (p) { var w = findWard(txt, p); if (w && w.strong) hits.push({ p: p, w: w }); });
    if (hits.length === 1) return { province: hits[0].p.n, ward: hits[0].w.ward, sure: true, inferred: true };
    return null;
  }

  /* ---------- form đặt hàng dùng chung (trang Thanh toán + khung Mua ngay) ---------- */
  /* ---------- miễn phí vận chuyển ---------- */
  function freeShipHint(sub, items) {
    var th = +CFG.free_ship_threshold || 0, fee = +CFG.shipping_fee || 0; if (!th || !fee) return '';
    if (sub >= th || hasFS(items)) return '<div class="fs-hint ok">🎉 Đơn hàng được <b>miễn phí vận chuyển</b></div>';
    var gap = th - sub, pct = Math.max(4, Math.round(sub / th * 100));
    return '<div class="fs-hint">🚚 Mua thêm <b>' + money(gap) + '</b> để được <b>miễn phí vận chuyển</b><span class="fs-bar"><i style="width:' + pct + '%"></i></span></div>';
  }

  /* ---------- gợi ý mua kèm ---------- */
  function upsellList(items, max) {
    var inSet = {}; items.forEach(function (i) { inSet[i.slug] = 1; });
    var sub = items.reduce(function (s, i) { return s + i.subtotal; }, 0), th = +CFG.free_ship_threshold || 0, gap = th && sub < th && !hasFS(items) ? th - sub : 0;
    var paired = []; items.forEach(function (i) { ((BY[i.slug] || {}).upsell || []).forEach(function (x) { if (paired.indexOf(x) < 0) paired.push(x); }); });
    var cands = [];
    PRODUCTS.forEach(function (p) {
      if (inSet[p.slug]) return;
      var opts = (p.variants && p.variants.length) ? p.variants.map(function (v, k) { return { vi: k, price: v.price, name: v.name }; }) : [{ vi: -1, price: p.price, name: p.unit || '' }];
      opts = opts.filter(function (o) { return o.price != null; }); if (!opts.length) return;
      var pick = opts[0];
      if (gap) { var enough = opts.filter(function (o) { return o.price >= gap; }).sort(function (x, y) { return x.price - y.price; }); pick = enough[0] || opts.sort(function (x, y) { return y.price - x.price; })[0]; }
      var score = (paired.indexOf(p.slug) >= 0 ? 1000 : 0) + (gap ? (pick.price >= gap ? 500 - pick.price / 10000 : pick.price / 10000) : (p.featured ? 10 : 0));
      cands.push({ slug: p.slug, vi: pick.vi, price: pick.price, variant: pick.name, name: p.short || p.name, img: p.img, score: score });
    });
    return { gap: gap, list: cands.sort(function (x, y) { return y.score - x.score; }).slice(0, max || 3) };
  }
  function upsellHTML(items) {
    var u = upsellList(items, 3); if (!u.list.length) return '';
    return '<div class="up"><div class="up-h"><b>Gợi ý mua kèm</b>' + (u.gap ? '<span>Thêm 1 món để được miễn phí vận chuyển</span>' : '') + '</div>' +
      u.list.map(function (c) { return '<div class="up-i"><img src="' + c.img + '" alt="" loading="lazy"><div><b>' + esc(c.name) + '</b><small>' + esc(c.variant) + '</small><em>' + money(c.price) + '</em></div><button type="button" class="up-add" data-up="' + c.slug + '|' + c.vi + '">+ Thêm</button></div>'; }).join('') + '</div>';
  }

  /* ---------- tách thông tin khi khách dán (Dán và nhập nhanh) ---------- */
  var ADDR_WORDS = /(^|\s)(số|so|sn|ngõ|ngo|ngách|ngach|hẻm|hem|kiệt|kiet|đường|duong|phố|pho|phường|phuong|xã|xa|quận|quan|huyện|huyen|tỉnh|tinh|tp|thành phố|thanh pho|thôn|thon|ấp|ap|tổ|to|khu|kđt|kdt|tòa|toa|tầng|tang|chung cư|chung cu|lô|lo|căn|can|p\.|q\.|x\.|hn|hcm)(\s|$|\.|,)/i;
  function parsePasted(text) {
    var t = String(text || '').replace(/\r/g, '').trim(); if (!t) return null;
    t = t.replace(/(họ\s*(và)?\s*tên|người\s*nhận|tên|sđt|số\s*điện\s*thoại|điện\s*thoại|phone|đt|địa\s*chỉ|dc|đc)\s*[:：\-]\s*/gi, '\n');
    var phone = '', m = t.match(/(?:\+?84|0)[\s.\-]?\d(?:[\s.\-]?\d){8,9}/);
    if (m) { phone = normPhone(m[0]); t = t.replace(m[0], '\n'); }
    t = t.replace(/\s+[-–|;]\s+/g, '\n');
    var parts = t.split(/\n+/).map(function (x) { var c = x.lastIndexOf(':'); if (c >= 0 && !/\d/.test(x.slice(0, c))) x = x.slice(c + 1); return x.replace(/^[\s,;.\-–|]+|[\s,;.\-–|]+$/g, ''); }).filter(Boolean);
    var name = '';
    if (parts.length > 1) {
      var idx = -1; parts.forEach(function (x, i) { if (idx < 0 && !/\d/.test(x) && x.split(/\s+/).length <= 5 && !ADDR_WORDS.test(x)) idx = i; });
      if (idx >= 0) name = parts.splice(idx, 1)[0].replace(/[\s,;.\-–|]+$/, '');
    } else if (parts.length === 1) {
      var mm = parts[0].match(/^([^\d,]{2,40}?)[,\s]+(?=(số|so|sn|\d|ngõ|ngo|thôn|ấp|tổ|khu|đường|phố))/i);
      if (mm && mm[1].split(/\s+/).length <= 5 && !ADDR_WORDS.test(mm[1])) { name = mm[1].trim(); parts[0] = parts[0].slice(mm[0].length); }
    }
    return { name: name, phone: phone, address: parts.join(', ').replace(/\s*,\s*,+/g, ',').trim() };
  }

  /* ---------- bảng chọn Tỉnh / Phường kiểu danh sách toàn màn hình ---------- */
  function openAreaPicker(initProv, onDone) {
    loadUnits().then(function (U) {
      var sh = document.createElement('div'); sh.className = 'ap'; sh.setAttribute('role', 'dialog'); sh.setAttribute('aria-modal', 'true');
      sh.innerHTML = '<div class="ap-box"><div class="ap-head"><button type="button" class="icon-btn ap-back" aria-label="Quay lại">' + ICON.left + '</button><b class="ap-title"></b><button type="button" class="icon-btn ap-x" aria-label="Đóng">' + ICON.close + '</button></div>' +
        '<div class="ap-search"><input type="search" placeholder="🔍 Tìm nhanh (gõ không dấu cũng được)" autocomplete="off"></div><ul class="ap-list"></ul></div>';
      document.body.appendChild(sh);
      var list = sh.querySelector('.ap-list'), q = sh.querySelector('input'), title = sh.querySelector('.ap-title'), prov = null;
      function close() { sh.remove(); }
      function render() {
        var k = nz(q.value).trim(), rows = prov ? prov.w : U.map(function (p) { return p.n; });
        var shown = rows.filter(function (r) { return !k || nz(r).indexOf(' ' + k) >= 0 || nz(prov ? wardCore(r) : r).indexOf(' ' + k) >= 0; });
        title.textContent = prov ? prov.n + ' › Chọn Phường/Xã' : 'Chọn Tỉnh/Thành phố';
        sh.querySelector('.ap-back').style.visibility = prov ? 'visible' : 'hidden';
        list.innerHTML = shown.length ? shown.map(function (r) { return '<li><button type="button" data-v="' + esc(r) + '">' + esc(r) + '<span>›</span></button></li>'; }).join('') : '<li class="ap-empty">Không tìm thấy. Bạn thử gõ ngắn hơn nhé.</li>';
        list.scrollTop = 0;
      }
      if (initProv) prov = U.filter(function (p) { return p.n === initProv; })[0] || null;
      render(); setTimeout(function () { q.focus(); }, 200);
      q.addEventListener('input', render);
      sh.addEventListener('click', function (e) {
        var b = e.target.closest('[data-v]');
        if (b) { var v = b.getAttribute('data-v'); if (!prov) { prov = U.filter(function (p) { return p.n === v; })[0]; q.value = ''; render(); q.focus(); } else { onDone(prov.n, v); close(); } return; }
        if (e.target.closest('.ap-back')) { prov = null; q.value = ''; render(); return; }
        if (e.target.closest('.ap-x') || e.target === sh) close();
      });
    });
  }

  /* ---------- form đặt hàng dùng chung (trang Thanh toán + khung Mua ngay) ---------- */
  function orderFieldsHTML() {
    var bank = CFG.bank;
    var pay = (bank ? '<label class="pay-opt"><input type="radio" name="payment" value="bank" checked><span><b>Chuyển khoản ngân hàng</b><small>Đặt hàng xong sẽ hiện mã QR để quét – ' + esc(bank.bank_name) + '</small></span></label>' : '') +
      '<label class="pay-opt"><input type="radio" name="payment" value="cod"' + (bank ? '' : ' checked') + '><span><b>Thanh toán khi nhận hàng (COD)</b><small>Nhận hàng, kiểm tra rồi trả tiền cho người giao</small></span></label>';
    return '<div class="of">' +
      '<div class="of-saved" hidden></div>' +
      '<div class="of-fields">' +
      '<div class="of-paste"><button type="button" class="of-paste-t">✨ Dán và nhập nhanh <small>(dán tên, số điện thoại, địa chỉ có sẵn từ Zalo, tin nhắn…)</small></button>' +
        '<div class="of-paste-b" hidden><textarea rows="3" placeholder="Ví dụ:&#10;Nguyễn Thị Lan 0912345678&#10;Số 12 Hải Âu 8, Gia Lâm, Hà Nội"></textarea><button type="button" class="btn of-paste-go">Tự động điền</button></div></div>' +
      '<label class="of-f">Họ và tên <em>*</em><input name="name" autocomplete="name" placeholder="Ví dụ: Nguyễn Thị Lan"><small class="of-err"></small></label>' +
      '<label class="of-f">Số điện thoại <em>*</em><input name="phone" type="tel" inputmode="tel" autocomplete="tel" placeholder="Ví dụ: 0912 345 678"><small class="of-err"></small></label>' +
      '<div class="of-f"><span class="of-lbl">Địa chỉ nhận hàng <em>*</em></span>' +
        '<div class="of-type" role="radiogroup" aria-label="Loại địa chỉ"><label><input type="radio" name="addr_type" value="home" checked><span>🏠 Nhà riêng</span></label><label><input type="radio" name="addr_type" value="office"><span>🏢 Văn phòng</span></label></div>' +
        '<textarea name="address" rows="2" autocomplete="street-address" placeholder="Số nhà, tên đường, phường/xã, tỉnh/thành&#10;Ví dụ: Số 12 Hải Âu 8, Xã Gia Lâm, Hà Nội"></textarea>' +
        '<button type="button" class="of-area"><span class="of-area-l">Tỉnh/Thành phố và Phường/Xã</span><span class="of-area-v">Chọn hoặc để web tự nhận diện</span><span class="of-area-c">›</span></button>' +
        '<div class="of-detect" aria-live="polite"></div>' +
        '<small class="of-err"></small></div>' +
      '</div>' +
      '<div class="of-f"><span class="of-lbl">Ghi chú <span class="muted">(không bắt buộc)</span></span>' +
        '<div class="of-chips"><button type="button" data-chip="Giao giờ hành chính">Giao giờ hành chính</button><button type="button" data-chip="Gọi trước khi giao">Gọi trước khi giao</button><button type="button" data-chip="Địa chỉ cũ: " data-focus="1">Địa chỉ cũ</button></div>' +
        '<textarea name="note" rows="2" placeholder="Yêu cầu thêm khi giao hàng…"></textarea></div>' +
      '<input type="text" name="website" class="hp" tabindex="-1" autocomplete="off" aria-hidden="true">' +
      '<div class="of-f"><span class="of-lbl">Thanh toán</span><div class="pay-opts">' + pay + '</div></div>' +
      '<label class="of-save"><input type="checkbox" name="remember" checked> Lưu thông tin cho lần mua sau</label>' +
      '<label class="of-save"><input type="checkbox" name="marketing"> Tôi đồng ý nhận tư vấn, nhắc lịch dùng sản phẩm và ưu đãi qua Zalo/điện thoại</label>' +
      '</div>';
  }
  function mountOrderForm(root) {
    root.querySelector('[data-order-fields]').innerHTML = orderFieldsHTML();
    var f = root.querySelector('form') || root, el = function (n) { return f.querySelector('[name=' + n + ']'); };
    var det = root.querySelector('.of-detect'), areaBtn = root.querySelector('.of-area'), areaV = root.querySelector('.of-area-v');
    var fields = root.querySelector('.of-fields'), savedBox = root.querySelector('.of-saved');
    var state = { province: '', ward: '', manual: false, auto: null, picked: false };
    function renderArea() {
      areaBtn.classList.toggle('set', !!(state.province && state.ward));
      areaBtn.classList.toggle('need', !!(state.province && !state.ward) || (!state.province && el('address').value.trim().length >= 8));
      areaV.innerHTML = state.province ? esc(state.province) + '<br>' + (state.ward ? esc(state.ward) : '<i>Chọn Phường/Xã</i>') : 'Chọn hoặc để web tự nhận diện';
      var r = state.auto;
      if (state.picked) { var chk = detectAddress(el('address').value); if (chk && chk.province && chk.province !== state.province) { det.innerHTML = '<span class="warn">⚠ Khu vực đã chọn (<b>' + esc(state.province) + '</b>) khác với tỉnh trong địa chỉ (<b>' + esc(chk.province) + '</b>). Bạn kiểm tra lại giúp nhé.</span>'; return; } }
      if (!state.manual && r && r.province && r.ward && !r.sure) det.innerHTML = '<span class="warn">Web đoán là <b>' + esc(r.ward) + '</b>. Nếu chưa đúng, bấm vào ô trên để chọn lại.</span>';
      else if (!state.manual && r && r.oldProvince) det.innerHTML = '<span class="warn">Tên tỉnh cũ đã được đổi sang tên mới sau sáp nhập: <b>' + esc(r.province) + '</b>' + (state.ward ? '' : '. Bạn bấm ô trên để chọn Phường/Xã.') + '</span>';
      else if (state.province && state.ward) det.innerHTML = '<span class="ok">✓ Đã nhận diện đúng khu vực giao hàng</span>';
      else det.innerHTML = '';
    }
    function applyAuto() {
      if (state.manual) return;
      var r = detectAddress(el('address').value); state.auto = r;
      state.province = r && r.province || ''; state.ward = r && r.ward || '';
      renderArea();
    }
    function setArea(p, w) { state.manual = true; state.picked = true; state.province = p; state.ward = w; state.auto = null; renderArea(); err('address', ''); }
    function showFields(on) { fields.hidden = !on; savedBox.hidden = on; }
    loadUnits().then(function () {
      var sv = load('tdl_customer', null);
      if (sv && sv.name && sv.phone && sv.address) {
        ['name', 'phone', 'address'].forEach(function (k) { el(k).value = sv[k] || ''; });
        if (sv.addr_type) { var rr = f.querySelector('[name=addr_type][value=' + sv.addr_type + ']'); if (rr) rr.checked = true; }
        state.province = sv.province || ''; state.ward = sv.ward || ''; state.manual = !!sv.manual || !!(sv.province && sv.ward);
        if (!state.province || !state.ward) { state.manual = false; applyAuto(); }
        renderArea();
        if (state.province && state.ward) {
          savedBox.innerHTML = '<div class="of-card"><div class="of-card-h"><b>📍 Giao đến</b><button type="button" class="of-change">Thay đổi</button></div>' +
            '<p><b>' + esc(sv.name) + '</b> · ' + esc(sv.phone.replace(/(\d{4})(\d{3})(\d+)/, '$1 $2 $3')) + '</p><p>' + (sv.addr_type === 'office' ? '🏢 ' : '🏠 ') + esc(sv.address) + '<br><span class="muted">' + esc(state.ward) + ', ' + esc(state.province) + '</span></p></div>';
          showFields(false);
        }
      }
    });
    var t; el('address').addEventListener('input', function () { clearTimeout(t); t = setTimeout(function () { state.manual = false; state.picked = false; applyAuto(); }, 350); });
    areaBtn.addEventListener('click', function () { openAreaPicker(state.province, setArea); });
    root.addEventListener('click', function (e) {
      if (e.target.closest('.of-change')) { showFields(true); el('name').focus(); return; }
      if (e.target.closest('.of-paste-t')) { var pb = root.querySelector('.of-paste-b'); pb.hidden = !pb.hidden; if (!pb.hidden) pb.querySelector('textarea').focus(); return; }
      if (e.target.closest('.of-paste-go')) {
        var r = parsePasted(root.querySelector('.of-paste-b textarea').value); if (!r) return;
        if (r.name) el('name').value = r.name; if (r.phone) el('phone').value = r.phone; if (r.address) el('address').value = r.address;
        state.manual = false; state.picked = false; applyAuto(); root.querySelector('.of-paste-b').hidden = true;
        track('paste_fill', {}); toast('Đã điền sẵn – bạn kiểm tra lại giúp nhé', 'ok'); (r.name ? el('phone') : el('name')).scrollIntoView({ block: 'center', behavior: 'smooth' }); return;
      }
      var c = e.target.closest('[data-chip]'); if (!c) return;
      var n = el('note'), txt = c.getAttribute('data-chip');
      if (c.getAttribute('data-focus')) { if (n.value.indexOf(txt.trim()) < 0) n.value = (n.value.trim() ? n.value.trim() + '. ' : '') + txt; n.focus(); var at = n.value.indexOf(txt.trim()) + txt.length; n.setSelectionRange(at, at); return; }
      if (n.value.indexOf(txt) >= 0) { n.value = n.value.replace(new RegExp('(\\.\\s*)?' + txt.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')), '').replace(/^\.\s*/, '').trim(); c.classList.remove('on'); }
      else { n.value = (n.value.trim() ? n.value.trim() + '. ' : '') + txt; c.classList.add('on'); }
    });
    function err(name, msg) { var box = el(name).closest('.of-f').querySelector('.of-err'); box.textContent = msg || ''; el(name).classList.toggle('invalid', !!msg); }
    return {
      collect: function () {
        var ok = true, first = null;
        var name = el('name').value.trim(), phone = normPhone(el('phone').value), addr = el('address').value.trim();
        err('name', name.length < 2 ? 'Bạn nhập giúp họ tên người nhận nhé' : ''); if (name.length < 2) { ok = false; first = first || el('name'); }
        err('phone', !phone ? 'Số điện thoại cần đủ 10 số (ví dụ 0912 345 678), bạn kiểm tra lại giúp nhé' : ''); if (!phone) { ok = false; first = first || el('phone'); }
        var addrMsg = addr.length < 6 ? 'Bạn nhập giúp số nhà, tên đường và khu vực nhé' : (!state.province || !state.ward ? 'Bạn bấm ô "Tỉnh/Thành phố và Phường/Xã" để chọn khu vực giao hàng nhé' : '');
        err('address', addrMsg); if (addrMsg) { ok = false; first = first || (addr.length < 6 ? el('address') : areaBtn); renderArea(); }
        if (!ok) { showFields(true); if (first) { first.focus(); first.scrollIntoView({ block: 'center', behavior: 'smooth' }); } return null; }
        if (el('website').value) return null;
        var type = (f.querySelector('[name=addr_type]:checked') || {}).value || 'home';
        var note = el('note').value.replace(/Địa chỉ cũ:\s*(?=\.|$)/g, '').replace(/(\.\s*){2,}/g, '. ').replace(/^[\s.]+|[\s.]+$/g, '').trim(); if (state.picked || (!state.manual && state.auto && !state.auto.sure)) note = '⚠ Kiểm tra địa chỉ (phường/xã khách tự chọn hoặc web đoán). ' + note;
        var c = { name: name, phone: phone, email: '', province: state.province, district: state.ward, address: '[' + (type === 'office' ? 'Văn phòng' : 'Nhà riêng') + '] ' + addr, note: note.trim(), addr_type: type };
        if (el('remember').checked) save('tdl_customer', { name: name, phone: phone, address: addr, province: state.province, ward: state.ward, addr_type: type, manual: true });
        else { try { localStorage.removeItem('tdl_customer'); } catch (e) { } }
        return { customer: c, payment: (f.querySelector('[name=payment]:checked') || {}).value || 'cod', marketing: !!(el('marketing') && el('marketing').checked) };
      }
    };
  }
  function placeOrder(items, data, btn, msg, onSent) {
    var sub = items.reduce(function (s, i) { return s + i.subtotal; }, 0), sh = shipInfo(sub, items), d = new Date();
    var id = 'TDL' + String(d.getFullYear()).slice(2) + ('0' + (d.getMonth() + 1)).slice(-2) + ('0' + d.getDate()).slice(-2) + Math.floor(1000 + Math.random() * 9000);
    var clean = items.map(function (i) { var b = BY[i.slug] || {}; return { slug: i.slug, name: i.name, variant: i.variant, qty: i.qty, price: i.price, subtotal: i.subtotal, days: b.days || undefined }; });
    var src = sourceLabel();
    var order = { type: 'order', id: id, created: d.toISOString(), customer: data.customer, payment: data.payment, items: clean, subtotal: sub, shipping: sh.fee, total: sub + sh.fee, page: location.href, marketing_consent: !!data.marketing, source: src.last, first_source: src.first };
    var label = btn.innerHTML; btn.disabled = true; btn.textContent = 'Đang gửi đơn hàng…';
    send(order).then(function (r) { order.sent = r.sent; save('tdl_last_order', order); if (onSent) onSent(); location.href = '/dat-hang-thanh-cong/?id=' + id; })
      .catch(function () { btn.disabled = false; btn.innerHTML = label; msg.className = 'form-msg err'; msg.textContent = 'Chưa gửi được đơn do mạng chập chờn. Bạn bấm lại giúp, hoặc gọi ' + CFG.hotline + ' để đặt nhé.'; });
  }
  function itemLine(slug, vi, qty) { var p = BY[slug], u = (vi >= 0 && p.variants[vi]) ? p.variants[vi].price : p.price; return { slug: slug, vi: vi, name: p.name, variant: (vi >= 0 && p.variants[vi]) ? p.variants[vi].name : (p.unit || ''), qty: qty, price: u, subtotal: u * qty, img: p.img }; }
  function summaryHTML(items, skipFirst, removable) {
    var sub = items.reduce(function (s, i) { return s + i.subtotal; }, 0), sh = shipInfo(sub, items);
    return items.map(function (i, k) { if (skipFirst && k === 0) return ''; return '<div class="co-item"><img src="' + i.img + '" alt=""><div><b>' + esc(i.name) + '</b><small>' + esc(i.variant) + ' × ' + i.qty + '</small></div><span class="ct-sub">' + money(i.subtotal) + (removable && k > 0 ? ' <button type="button" class="co-rm" data-rmx="' + k + '" aria-label="Bỏ">✕</button>' : '') + '</span></div>'; }).join('') +
      '<div class="co-sum"><div><span>Tạm tính</span><b>' + money(sub) + '</b></div><div><span>Phí vận chuyển</span><b' + (sh.fee ? '' : ' class="free"') + '>' + sh.label + '</b></div>' + freeShipHint(sub, items) + '<div class="co-total"><span>Tổng thanh toán</span><b>' + money(sub + sh.fee) + '</b></div></div>';
  }
  function orderTotal(items) { var sub = items.reduce(function (s, i) { return s + i.subtotal; }, 0); return sub + shipInfo(sub, items).fee; }
  function initCheckout() {
    var form = $('#checkoutForm'); if (!form) return;
    if (!cart.length) { location.replace('/gio-hang/'); return; }
    var items = function () { return cart.map(function (it) { return itemLine(it.slug, it.vi, it.qty); }); };
    function refresh() { $('#coItems').innerHTML = summaryHTML(items()); $('#coUpsell').innerHTML = upsellHTML(items()); $('#placeOrder').innerHTML = '✅ Đặt hàng – ' + money(orderTotal(items())); }
    refresh();
    track('begin_checkout', { currency: 'VND', value: cartTotal(), items: cart.map(function (it) { return gaItem(it.slug, it.vi, it.qty); }), checkout_type: 'gio_hang' });
    $('#coUpsell').addEventListener('click', function (e) { var b = e.target.closest('[data-up]'); if (!b) return; var v = b.getAttribute('data-up').split('|'); addToCart(v[0], 1, +v[1]); track('upsell_add', { item_id: v[0] }); toast('Đã thêm vào đơn hàng', 'ok'); refresh(); });
    var of = mountOrderForm(form);
    form.addEventListener('submit', function (e) {
      e.preventDefault(); var msg = $('.form-msg', form); msg.className = 'form-msg'; msg.textContent = '';
      var data = of.collect(); if (!data) return;
      placeOrder(items(), data, $('#placeOrder'), msg, function () { cart = []; saveCart(); });
    });
  }
  function openQuickOrder(slug, vi, qty) {
    var p = BY[slug]; if (!p) return;
    var m = document.createElement('div'); m.className = 'qo'; m.setAttribute('role', 'dialog'); m.setAttribute('aria-modal', 'true'); m.setAttribute('aria-label', 'Đặt hàng nhanh');
    m.innerHTML = '<form class="qo-box" novalidate><div class="qo-head"><b>Đặt hàng nhanh</b><button type="button" class="icon-btn qo-x" aria-label="Đóng">' + ICON.close + '</button></div>' +
      '<div class="qo-prod"><img src="' + p.img + '" alt=""><div><b>' + esc(p.name) + '</b><small class="qo-var"></small><div class="qo-qty"><span>Số lượng</span><div class="qty"><button type="button" data-q="-1" aria-label="Giảm">−</button><input type="number" min="1" max="99" value="' + qty + '" aria-label="Số lượng"><button type="button" data-q="1" aria-label="Tăng">+</button></div></div></div></div>' +
      '<div class="qo-sum"></div><div class="qo-up"></div>' +
      '<div data-order-fields></div>' +
      '<button class="btn btn-lg btn-block btn-order" type="submit"></button><p class="form-msg" role="status"></p>' +
      '<p class="qo-note">Nhân viên sẽ gọi xác nhận trước khi giao hàng.</p>' +
      '<div class="qo-alt"><a class="btn btn-outline" href="tel:' + CFG.zalo + '">📞 Gọi đặt hàng</a><a class="btn btn-zalo" href="https://zalo.me/' + CFG.zalo + '" target="_blank" rel="noopener">💬 Đặt qua Zalo</a></div></form>';
    document.body.appendChild(m); lock(true);
    var bi = gaItem(slug, vi, qty); if (bi) track('begin_checkout', { currency: 'VND', value: (bi.price || 0) * qty, items: [bi], checkout_type: 'mua_ngay' });
    var form = m.querySelector('form'), qIn = m.querySelector('.qo-qty input'), extras = [];
    var items = function () { return [itemLine(slug, vi, Math.max(1, Math.min(99, parseInt(qIn.value, 10) || 1)))].concat(extras.map(function (x) { return itemLine(x.slug, x.vi, 1); })); };
    function refresh() { var it = items(); m.querySelector('.qo-var').textContent = it[0].variant + ' · ' + money(it[0].price); m.querySelector('.qo-sum').innerHTML = summaryHTML(it, true, true); m.querySelector('.qo-up').innerHTML = upsellHTML(it); m.querySelector('.btn-order').innerHTML = '✅ Đặt hàng – ' + money(orderTotal(it)); }
    m.addEventListener('click', function (e) {
      var b = e.target.closest('[data-q]'); if (b) { qIn.value = Math.max(1, Math.min(99, (parseInt(qIn.value, 10) || 1) + (+b.getAttribute('data-q')))); refresh(); }
      var u = e.target.closest('[data-up]'); if (u) { var v = u.getAttribute('data-up').split('|'); extras.push({ slug: v[0], vi: +v[1] }); track('upsell_add', { item_id: v[0] }); var ui = gaItem(v[0], +v[1], 1); if (ui) track('add_to_cart', { currency: 'VND', value: ui.price || 0, items: [ui] }); toast('Đã thêm vào đơn hàng', 'ok'); refresh(); }
      var r = e.target.closest('[data-rmx]'); if (r) { extras.splice(+r.getAttribute('data-rmx') - 1, 1); refresh(); }
      if (e.target === m || e.target.closest('.qo-x')) { m.remove(); lock(false); }
    });
    qIn.addEventListener('change', refresh);
    var of = mountOrderForm(m); refresh();
    form.addEventListener('submit', function (e) { e.preventDefault(); var msg = m.querySelector('.form-msg'); msg.textContent = ''; var data = of.collect(); if (!data) return; placeOrder(items(), data, m.querySelector('.btn-order'), msg); });
  }
  function initThanks() {
    var el = $('#thanksPage'); if (!el) return;
    var o = load('tdl_last_order', null);
    if (o && !o.tracked) { track('purchase', { transaction_id: o.id, currency: 'VND', value: o.total, shipping: o.shipping, payment_type: o.payment, items: o.items.map(function (i) { var g = gaItem(i.slug, -1, i.qty) || {}; g.item_variant = i.variant; g.price = i.price; g.quantity = i.qty; return g; }) }); o.tracked = true; save('tdl_last_order', o); }
    if (!o || (qs('id') && o.id !== qs('id'))) {
      el.innerHTML = '<h1>Không tìm thấy đơn hàng</h1><p>Nếu bạn vừa đặt hàng, vui lòng liên hệ hotline <a href="tel:' + CFG.zalo + '">' + esc(CFG.hotline) + '</a> để được hỗ trợ.</p><a class="btn" href="/">Về trang chủ</a>';
      return;
    }
    var rows = o.items.map(function (it) { return '<div class="row"><span>' + esc(it.name) + (it.variant ? ' – ' + esc(it.variant) : '') + ' × ' + it.qty + '</span><b>' + money(it.subtotal) + '</b></div>'; }).join('');
    var qr = '';
    if (o.payment === 'bank' && CFG.bank) {
      var b = CFG.bank, src = 'https://img.vietqr.io/image/' + encodeURIComponent(b.bank_id) + '-' + encodeURIComponent(b.account_no) + '-compact2.png?amount=' + o.total + '&addInfo=' + encodeURIComponent(o.id) + '&accountName=' + encodeURIComponent(b.account_name);
      qr = '<div class="qr-box"><h3>Quét mã để chuyển khoản</h3><img src="' + src + '" alt="Mã QR chuyển khoản" width="260" height="300"><p><b>' + esc(b.bank_name) + '</b><br>STK: <b>' + esc(b.account_no) + '</b><br>Chủ TK: ' + esc(b.account_name) + '<br>Số tiền: <b>' + money(o.total) + '</b><br>Nội dung: <b>' + esc(o.id) + '</b></p></div>';
    }
    var zaloNote = o.sent ? '' : '<div class="notice"><b>Bước cuối:</b> bấm nút bên dưới để gửi đơn hàng cho ' + esc(CFG.brand) + ' qua Zalo (nội dung đơn đã được tự động sao chép, bạn chỉ cần dán và gửi). Hoặc gọi <a href="tel:' + CFG.zalo + '">' + esc(CFG.hotline) + '</a>.</div>' +
      '<p><button class="btn btn-lg btn-zalo" id="sendZalo">Gửi đơn qua Zalo</button></p>';
    el.innerHTML = '<div class="ok-ic">' + ICON.check + '</div><h1>Cảm ơn ' + esc(o.customer.name) + '!</h1><p>Đơn hàng <b>' + esc(o.id) + '</b> đã được ghi nhận. ' + esc(CFG.brand) + ' sẽ gọi điện xác nhận tới số <b>' + esc(o.customer.phone) + '</b> trong thời gian sớm nhất.</p>' +
      zaloNote + qr + '<div class="order-box">' + rows + '<div class="row"><span>Giao hàng</span><span>' + (o.shipping ? money(o.shipping) : ((+CFG.shipping_fee && +CFG.free_ship_threshold) ? 'Miễn phí' : 'Báo khi xác nhận')) + '</span></div><div class="row"><span><b>Tổng cộng</b></span><b style="color:var(--primary-2)">' + money(o.total) + '</b></div>' +
      '<div class="row"><span>Người nhận</span><span>' + esc(o.customer.name) + ' – ' + esc(o.customer.phone) + '</span></div><div class="row"><span>Địa chỉ</span><span>' + esc(o.customer.address + ', ' + o.customer.district + ', ' + o.customer.province) + '</span></div>' +
      '<div class="row"><span>Thanh toán</span><span>' + (o.payment === 'bank' ? 'Chuyển khoản' : 'Thanh toán khi nhận hàng (COD)') + '</span></div></div>' + (CFG.zalo_group ? '<div class="oa-cta"><b>👥 Mời anh/chị vào nhóm Zalo Sống khỏe cùng ' + esc(CFG.brand) + '</b><p>' + (CFG.gift ? '🎁 Quà tặng thành viên: <strong>' + esc(CFG.gift) + '</strong>. ' : '') + 'Nhận hướng dẫn dùng sản phẩm, thực đơn lành mỗi ngày và ưu đãi riêng cho thành viên.</p><a class="btn btn-zalo" href="' + esc(CFG.zalo_group) + '" target="_blank" rel="noopener" data-cta="zalo_group_thanks">Vào nhóm Zalo</a>' + (CFG.zalo_oa ? '<a class="oa-link" href="' + esc(CFG.zalo_oa) + '" target="_blank" rel="noopener" data-cta="zalo_oa_thanks">hoặc Quan tâm Zalo OA</a>' : '') + '</div>' : CFG.zalo_oa ? '<div class="oa-cta"><b>📲 Quan tâm Zalo OA Thực Dưỡng Lành</b><p>Để nhận hướng dẫn dùng sản phẩm, lịch nhắc và ưu đãi dành riêng cho khách đã mua.</p><a class="btn btn-zalo" href="' + esc(CFG.zalo_oa) + '" target="_blank" rel="noopener">Quan tâm Zalo OA</a></div>' : '') + '<a class="btn btn-outline" href="/san-pham/">Tiếp tục mua sắm</a>';
    var z = $('#sendZalo');
    if (z) z.addEventListener('click', function () {
      var txt = orderText(o);
      var go = function () { window.open('https://zalo.me/' + CFG.zalo, '_blank'); };
      if (navigator.clipboard) navigator.clipboard.writeText(txt).then(function () { toast('Đã sao chép đơn hàng – dán vào Zalo để gửi', 'ok'); go(); }, go); else go();
    });
  }

  /* ---------- wishlist & search pages ---------- */
  function cardHTML(p) {
    var cv = cardItem(p), it = cv || { price: p.price, regular_price: p.regular, web_off: p.off }, d = offPct(it); // giá gạch + nhãn theo đúng giá đang hiện
    return '<article class="p-card"><a class="pc-media" href="' + p.url + '">' + (d ? '<span class="badge-sale">-' + d + '%</span>' : '') + '<img class="pc-img" src="' + p.img + '" alt="' + esc(p.name) + '" width="480" height="480"></a>' +
      '<button class="pc-wish" data-wish="' + p.slug + '" aria-label="Yêu thích">' + ICON.heart + '</button><div class="pc-body"><h3 class="pc-title"><a href="' + p.url + '">' + esc(p.name) + '</a></h3>' +
      '<div class="price pc-price">' + (cv ? '<span class="from">Từ</span>' : '') + (d ? '<del>' + money(it.regular_price) + '</del>' : '') + '<ins' + (it.price == null ? ' class="contact"' : '') + '>' + money(it.price) + '</ins></div></div>' +
      (p.price != null && !(p.variants && p.variants.length) ? '<button class="pc-add" data-add="' + p.slug + '">' + ICON.cart + '<span>Thêm vào giỏ</span></button>' : '<a class="pc-add" href="' + p.url + '">' + ICON.right + '<span>Xem chi tiết</span></a>') + '</article>';
  }
  function renderWishPage() {
    var el = $('#wishPage'); if (!el) return;
    el.innerHTML = wish.length ? '<div class="p-grid shop-grid">' + wish.map(function (s) { return cardHTML(BY[s]); }).join('') + '</div>'
      : '<div class="cart-empty">' + ICON.heart + '<h2>Chưa có sản phẩm yêu thích</h2><p class="muted">Bấm biểu tượng trái tim trên sản phẩm để lưu lại.</p><a class="btn" href="/san-pham/">Xem sản phẩm</a></div>';
    markWish();
  }
  function initSearchPage() {
    var el = $('#searchPage'); if (!el) return;
    var q = qs('q'); $('#spq').value = q;
    var list = q ? searchProducts(q) : PRODUCTS;
    $('#searchSummary').textContent = q ? ('Tìm thấy ' + list.length + ' sản phẩm cho “' + q + '”') : 'Tất cả sản phẩm';
    el.innerHTML = list.length ? list.map(cardHTML).join('') : '';
    if (!list.length) el.outerHTML = '<div class="empty">Không tìm thấy sản phẩm phù hợp. Hãy thử từ khóa khác hoặc <a href="/lien-he/">liên hệ tư vấn</a>.</div>';
    markWish();
  }

  /* ---------- contact form ---------- */
  function initContact() {
    var form = $('#contactForm'); if (!form) return;
    form.addEventListener('submit', function (e) {
      e.preventDefault();
      var msg = $('.form-msg', form); msg.className = 'form-msg';
      if (form.elements.website.value) return;
      if (!validate(form)) { msg.className = 'form-msg err'; msg.textContent = 'Vui lòng điền đầy đủ thông tin bắt buộc (*).'; return; }
      var f = form.elements, data = { type: 'contact', created: new Date().toISOString(), name: f.name.value.trim(), phone: f.phone.value.trim(), email: f.email.value.trim(), message: f.message.value.trim(), page: location.href };
      if (!CFG.endpoint) {
        location.href = 'mailto:' + CFG.email + '?subject=' + encodeURIComponent('Liên hệ từ website – ' + data.name) + '&body=' + encodeURIComponent(data.message + '\n\n' + data.name + ' – ' + data.phone + (data.email ? ' – ' + data.email : ''));
        return;
      }
      var btn = $('button[type=submit]', form); btn.disabled = true;
      track('generate_lead', { form: 'lien_he' }); send(data).then(function () { form.reset(); msg.className = 'form-msg ok'; msg.textContent = 'Cảm ơn anh/chị! Chúng tôi sẽ liên hệ lại sớm nhất.'; })
        .catch(function () { msg.className = 'form-msg err'; msg.textContent = 'Gửi chưa thành công, vui lòng gọi ' + CFG.hotline + '.'; })
        .then(function () { btn.disabled = false; });
    });
  }

  /* ---------- trang nhận ebook: để lại tên + SĐT → mở ebook ngay + mời vào nhóm Zalo ---------- */
  function initEbook() {
    var box = $('#ebookBox'); if (!box) return;
    var form = $('#ebookForm', box), done = $('.ebf-done', box);
    function show(isDone) { form.hidden = isDone; done.hidden = !isDone; }
    if (load('tdl_ebook', null)) show(true);
    $('#ebookAgain').addEventListener('click', function () { form.reset(); show(false); form.elements.name.focus(); });
    form.addEventListener('submit', function (e) {
      e.preventDefault();
      var msg = $('.form-msg', form); msg.className = 'form-msg';
      if (form.elements.website.value) return;
      if (!validate(form)) { msg.className = 'form-msg err'; msg.textContent = 'Vui lòng điền họ tên và số điện thoại đúng (10 số).'; return; }
      var f = form.elements, src = sourceLabel(), pos = qs('tu');
      var data = { type: 'contact', kind: 'ebook', created: new Date().toISOString(), name: f.name.value.trim(), phone: f.phone.value.trim(), email: '', pos: pos, source: src.last,
        message: '🎁 Đăng ký nhận ebook Dinh Dưỡng cho Cơ Xương Khớp' + (pos ? ' · bấm từ web: ' + pos : '') + ' · Nguồn: ' + src.last, page: location.href };
      send(data).catch(function () { });
      track('generate_lead', { form: 'ebook' });
      save('tdl_ebook', { t: Date.now() });
      show(true); box.scrollIntoView({ behavior: 'smooth', block: 'start' });
    });
  }

  /* ---------- floating widget ---------- */
  function initFloat() {
    var w = $('#floatWidget'); if (!w) return;
    // mặc định chỉ hiện nút tròn; tự bung lời chào 1 lần/phiên khi ở trang ≥ 25 giây hoặc cuộn ≥ 60%, trừ khi khách đã bấm ×
    function ss(k, v) { try { if (v == null) return sessionStorage.getItem(k); sessionStorage.setItem(k, v); } catch (e) { return null; } }
    var timer, onScroll;
    function stopAuto() { clearTimeout(timer); window.removeEventListener('scroll', onScroll); }
    function autoOpen(trigger) {
      if (w.classList.contains('open') || ss('tdl_fw') === '1' || ss('tdl_fw_auto') === '1') return stopAuto();
      if (document.body.classList.contains('satc-on')) return; // đang hiện thanh mua nhanh (trang sản phẩm, điện thoại): chờ lần sau
      w.classList.add('open'); ss('tdl_fw_auto', '1'); stopAuto(); track('chat_widget_open', { trigger: trigger });
    }
    if (ss('tdl_fw') !== '1' && ss('tdl_fw_auto') !== '1') {
      timer = setTimeout(function () { autoOpen('auto_time'); }, 25000);
      onScroll = function () { var max = document.documentElement.scrollHeight - innerHeight; if (max > 0 && scrollY / max >= 0.6) autoOpen('auto_scroll'); };
      window.addEventListener('scroll', onScroll, { passive: true });
    }
    $('#fwToggle').addEventListener('click', function () { if (w.classList.toggle('open')) track('chat_widget_open', { trigger: 'click' }); });
    $('#fwClose').addEventListener('click', function () { w.classList.remove('open'); ss('tdl_fw', '1'); stopAuto(); });
  }

  function initFlipbook() {
    $$('[data-flipbook]').forEach(function (v) {
      v.addEventListener('click', function () {
        if (v.querySelector('iframe')) return;
        var f = document.createElement('iframe');
        f.src = v.getAttribute('data-flipbook'); f.allowFullscreen = true; f.setAttribute('allow', 'fullscreen'); f.title = 'Hồ sơ thương hiệu';
        v.appendChild(f); var b = v.querySelector('.br-play'); if (b) b.remove(); v.style.cursor = 'default'; track('view_brochure', { method: 'nhung' });
      });
    });
  }

  function init() {
    captureSource(); initConsent(); trackPageEvents();
    renderCounts(); renderMini(); markWish();
    initHeader(); initClicks(); initHero(); initLightbox(); initProduct(); initCerts(); initTabs(); initReadmore(); initSort();
    initCartPage(); initCheckout(); initThanks(); renderWishPage(); initSearchPage(); initContact(); initEbook(); initFloat(); initFlipbook();
    window.addEventListener('storage', function (e) { if (e.key === 'tdl_cart') { cart = load('tdl_cart', []); cleanCart(); renderCounts(); renderMini(); } });
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init); else init();
})();
