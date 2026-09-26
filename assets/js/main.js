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
  function lock(on) { document.documentElement.style.overflow = on ? 'hidden' : ''; }
  function qs(name) { return new URLSearchParams(location.search).get(name) || ''; }

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
      if (e.key === 'Escape') { if (layer) closeS(); if (oc) closeOc(); closeMini(); closeLb(); }
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
      if ((t = e.target.closest('.v-frame'))) {
        if (t.querySelector('video')) return;
        var v = document.createElement('video');
        v.src = t.getAttribute('data-video'); v.controls = true; v.autoplay = true; v.playsInline = true;
        $$('.v-frame video').forEach(function (o) { o.pause(); });
        t.innerHTML = ''; t.appendChild(v); v.play().catch(function () { });
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
      box.innerHTML = (v.regular_price && v.price && v.regular_price > v.price ? '<del>' + money(v.regular_price) + '</del>' : '') + '<ins' + (v.price == null ? ' class="contact"' : '') + '>' + money(v.price) + '</ins>';
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
    $$('[data-buy-now]').forEach(function (b) { b.addEventListener('click', function () { if (addToCart(slug, qin ? getQty() : 1, vi)) location.href = '/thanh-toan/'; }); });
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
      var pr = function (c) { return c._p && c._p.price != null ? c._p.price : Infinity; };
      if (v === 'price-asc') list.sort(function (a, b) { return pr(a) - pr(b); });
      else if (v === 'price-desc') list.sort(function (a, b) { return (pr(b) === Infinity ? -1 : pr(b)) - (pr(a) === Infinity ? -1 : pr(a)); });
      else if (v === 'name') list.sort(function (a, b) { return a._p.name.localeCompare(b._p.name, 'vi'); });
      else list.sort(function (a, b) { return a._i - b._i; });
      list.forEach(function (c) { grid.appendChild(c); });
    });
  }

  /* ---------- cart page ---------- */
  function shipInfo(sub) {
    var fee = +CFG.shipping_fee || 0, th = +CFG.free_ship_threshold || 0;
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
      '<aside class="card totals"><h2>Cộng giỏ hàng</h2><div class="row"><span>Tạm tính</span><b>' + money(sub) + '</b></div><div class="row"><span>Giao hàng</span><span>' + sh.label + '</span></div>' +
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
  var PROVINCES = ['TP. Hà Nội', 'TP. Hồ Chí Minh', 'TP. Hải Phòng', 'TP. Đà Nẵng', 'TP. Cần Thơ', 'TP. Huế', 'An Giang', 'Bắc Ninh', 'Cà Mau', 'Cao Bằng', 'Đắk Lắk', 'Điện Biên', 'Đồng Nai', 'Đồng Tháp', 'Gia Lai', 'Hà Tĩnh', 'Hưng Yên', 'Khánh Hòa', 'Lai Châu', 'Lạng Sơn', 'Lào Cai', 'Lâm Đồng', 'Nghệ An', 'Ninh Bình', 'Phú Thọ', 'Quảng Ngãi', 'Quảng Ninh', 'Quảng Trị', 'Sơn La', 'Tây Ninh', 'Thái Nguyên', 'Thanh Hóa', 'Tuyên Quang', 'Vĩnh Long'];
  function renderCheckoutSummary() {
    var box = $('#coItems'); if (!box) return;
    var sub = cartTotal(), sh = shipInfo(sub);
    box.innerHTML = cart.map(function (it) {
      var p = BY[it.slug];
      return '<div class="co-item"><img src="' + p.img + '" alt=""><div><b>' + esc(p.name) + '</b><small>' + esc(variantName(it)) + ' × ' + it.qty + '</small></div><span class="ct-sub">' + money(unitPrice(it) * it.qty) + '</span></div>';
    }).join('');
    $('#coSub').textContent = money(sub); $('#coShip').textContent = sh.label; $('#coTotal').textContent = money(sub + sh.fee);
  }
  function orderText(o) {
    var lines = ['ĐƠN HÀNG ' + o.id + ' – ' + CFG.brand, 'Khách: ' + o.customer.name + ' – ' + o.customer.phone,
      'Địa chỉ: ' + o.customer.address + ', ' + o.customer.district + ', ' + o.customer.province];
    o.items.forEach(function (it) { lines.push('• ' + it.name + (it.variant ? ' (' + it.variant + ')' : '') + ' x' + it.qty + ' = ' + money(it.subtotal)); });
    lines.push('Tổng: ' + money(o.total) + ' – Thanh toán: ' + (o.payment === 'bank' ? 'Chuyển khoản' : 'COD'));
    if (o.customer.note) lines.push('Ghi chú: ' + o.customer.note);
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
  function validate(form) {
    var ok = true, first = null;
    $$('[required]', form).forEach(function (f) {
      var bad = !f.value.trim() || (f.type === 'tel' && !/^[0-9 +.]{9,15}$/.test(f.value.trim())) || (f.type === 'email' && f.value && !/^\S+@\S+\.\S+$/.test(f.value));
      f.classList.toggle('invalid', bad); if (bad) { ok = false; first = first || f; }
    });
    var em = form.querySelector('[type=email]');
    if (em && em.value && !/^\S+@\S+\.\S+$/.test(em.value)) { em.classList.add('invalid'); ok = false; first = first || em; }
    if (first) first.focus();
    return ok;
  }
  function initCheckout() {
    var form = $('#checkoutForm'); if (!form) return;
    if (!cart.length) { location.replace('/gio-hang/'); return; }
    var dl = $('#provinces'); if (dl) dl.innerHTML = PROVINCES.map(function (p) { return '<option value="' + p + '">'; }).join('');
    var saved = load('tdl_customer', null);
    if (saved) Object.keys(saved).forEach(function (k) { var f = form.elements[k]; if (f && f.type !== 'radio') f.value = saved[k] || ''; });
    renderCheckoutSummary();
    form.addEventListener('submit', function (e) {
      e.preventDefault();
      var msg = $('.form-msg', form); msg.className = 'form-msg'; msg.textContent = '';
      if (form.elements.website.value) return;
      if (!validate(form)) { msg.className = 'form-msg err'; msg.textContent = 'Vui lòng điền đầy đủ và đúng các thông tin bắt buộc (*).'; return; }
      var f = form.elements;
      var customer = { name: f.name.value.trim(), phone: f.phone.value.trim(), email: f.email.value.trim(), province: f.province.value.trim(), district: f.district.value.trim(), address: f.address.value.trim(), note: f.note.value.trim() };
      save('tdl_customer', { name: customer.name, phone: customer.phone, email: customer.email, province: customer.province, district: customer.district, address: customer.address });
      var sub = cartTotal(), sh = shipInfo(sub), d = new Date();
      var id = 'TDL' + String(d.getFullYear()).slice(2) + ('0' + (d.getMonth() + 1)).slice(-2) + ('0' + d.getDate()).slice(-2) + Math.floor(1000 + Math.random() * 9000);
      var order = {
        type: 'order', id: id, created: d.toISOString(), customer: customer, payment: form.querySelector('[name=payment]:checked').value,
        items: cart.map(function (it) { var p = BY[it.slug], u = unitPrice(it); return { slug: it.slug, name: p.name, variant: variantName(it), qty: it.qty, price: u, subtotal: u * it.qty }; }),
        subtotal: sub, shipping: sh.fee, total: sub + sh.fee, page: location.href
      };
      var btn = $('#placeOrder'); btn.disabled = true; btn.textContent = 'Đang gửi đơn hàng…';
      send(order).then(function (r) {
        order.sent = r.sent;
        save('tdl_last_order', order);
        cart = []; saveCart();
        location.href = '/dat-hang-thanh-cong/?id=' + id;
      }).catch(function () {
        btn.disabled = false; btn.textContent = 'Đặt hàng';
        msg.className = 'form-msg err'; msg.textContent = 'Không gửi được đơn hàng do lỗi kết nối. Vui lòng thử lại hoặc gọi ' + CFG.hotline + '.';
      });
    });
  }
  function initThanks() {
    var el = $('#thanksPage'); if (!el) return;
    var o = load('tdl_last_order', null);
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
      zaloNote + qr + '<div class="order-box">' + rows + '<div class="row"><span>Giao hàng</span><span>' + (o.shipping ? money(o.shipping) : 'Báo khi xác nhận') + '</span></div><div class="row"><span><b>Tổng cộng</b></span><b style="color:var(--primary-2)">' + money(o.total) + '</b></div>' +
      '<div class="row"><span>Người nhận</span><span>' + esc(o.customer.name) + ' – ' + esc(o.customer.phone) + '</span></div><div class="row"><span>Địa chỉ</span><span>' + esc(o.customer.address + ', ' + o.customer.district + ', ' + o.customer.province) + '</span></div>' +
      '<div class="row"><span>Thanh toán</span><span>' + (o.payment === 'bank' ? 'Chuyển khoản' : 'Thanh toán khi nhận hàng (COD)') + '</span></div></div><a class="btn btn-outline" href="/san-pham/">Tiếp tục mua sắm</a>';
    var z = $('#sendZalo');
    if (z) z.addEventListener('click', function () {
      var txt = orderText(o);
      var go = function () { window.open('https://zalo.me/' + CFG.zalo, '_blank'); };
      if (navigator.clipboard) navigator.clipboard.writeText(txt).then(function () { toast('Đã sao chép đơn hàng – dán vào Zalo để gửi', 'ok'); go(); }, go); else go();
    });
  }

  /* ---------- wishlist & search pages ---------- */
  function cardHTML(p) {
    var d = (p.price && p.regular && p.regular > p.price) ? Math.round((1 - p.price / p.regular) * 100) : 0;
    return '<article class="p-card"><a class="pc-media" href="' + p.url + '">' + (d ? '<span class="badge-sale">-' + d + '%</span>' : '') + '<img class="pc-img" src="' + p.img + '" alt="' + esc(p.name) + '"></a>' +
      '<button class="pc-wish" data-wish="' + p.slug + '" aria-label="Yêu thích">' + ICON.heart + '</button><div class="pc-body"><h3 class="pc-title"><a href="' + p.url + '">' + esc(p.name) + '</a></h3>' +
      '<div class="price pc-price">' + (d ? '<del>' + money(p.regular) + '</del>' : '') + '<ins' + (p.price == null ? ' class="contact"' : '') + '>' + money(p.price) + '</ins></div></div>' +
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
      send(data).then(function () { form.reset(); msg.className = 'form-msg ok'; msg.textContent = 'Cảm ơn anh/chị! Chúng tôi sẽ liên hệ lại sớm nhất.'; })
        .catch(function () { msg.className = 'form-msg err'; msg.textContent = 'Gửi chưa thành công, vui lòng gọi ' + CFG.hotline + '.'; })
        .then(function () { btn.disabled = false; });
    });
  }

  /* ---------- floating widget ---------- */
  function initFloat() {
    var w = $('#floatWidget'); if (!w) return;
    var closed = false; try { closed = sessionStorage.getItem('tdl_fw') === '1'; } catch (e) { }
    if (!closed && window.innerWidth >= 1200 && matchMedia('(hover:hover)').matches) setTimeout(function () { w.classList.add('open'); }, 4000);
    $('#fwToggle').addEventListener('click', function () { w.classList.toggle('open'); });
    $('#fwClose').addEventListener('click', function () { w.classList.remove('open'); try { sessionStorage.setItem('tdl_fw', '1'); } catch (e) { } });
  }

  function initFlipbook() {
    $$('[data-flipbook]').forEach(function (v) {
      v.addEventListener('click', function () {
        if (v.querySelector('iframe')) return;
        var f = document.createElement('iframe');
        f.src = v.getAttribute('data-flipbook'); f.allowFullscreen = true; f.setAttribute('allow', 'fullscreen'); f.title = 'Hồ sơ thương hiệu';
        v.appendChild(f); var b = v.querySelector('.br-play'); if (b) b.remove(); v.style.cursor = 'default';
      });
    });
  }

  function init() {
    renderCounts(); renderMini(); markWish();
    initHeader(); initClicks(); initHero(); initLightbox(); initProduct(); initTabs(); initReadmore(); initSort();
    initCartPage(); initCheckout(); initThanks(); renderWishPage(); initSearchPage(); initContact(); initFloat(); initFlipbook();
    window.addEventListener('storage', function (e) { if (e.key === 'tdl_cart') { cart = load('tdl_cart', []); cleanCart(); renderCounts(); renderMini(); } });
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init); else init();
})();
