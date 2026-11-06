/* Tìm kiếm trong hướng dẫn nội bộ – dữ liệu /huong-dan/search.json do build.py sinh (mỗi tiêu đề ##, ### và mỗi câu hỏi đáp chữ đậm là 1 kết quả) */
(function () {
  'use strict';
  var DATA = null, loading = null;
  // việc hay tìm: hiện thành nút bấm ở trang Bắt đầu và khi ô tìm còn trống
  var HINTS = ['Đăng nhập', 'Nối Telegram', 'Lên đơn', 'Mã vận đơn', 'Khách hỏi', 'Báo cáo cuối ngày', 'Đơn hoàn', 'Mục tiêu', 'Kiểm kho', 'Đăng bài'];
  // từ gần nghĩa: gõ chữ bên trái thì tìm cả chữ bên phải (viết không dấu). Cách nói theo từng mục thì ghi ở guide/tu-khoa.yml
  var SYN = {
    'dat hang': ['len don', 'tao don'], 'len don': ['tao don', 'dat hang'], 'tao don': ['len don', 'dat hang'],
    'tra hang': ['hoan'], 'tra lai': ['hoan'], 'hoan hang': ['hoan', 'tra lai hang'], 'bom': ['hoan', 'khong nhan hang'], 'boom': ['hoan'],
    'van don': ['ma van don', 'gui hang'], 'ship': ['giao hang', 'van chuyen'], 'shipper': ['giao hang'],
    'mat khau': ['dang nhap', 'ma 6 so'], 'pass': ['dang nhap'], 'login': ['dang nhap'], 'app': ['ung dung', 'man hinh chinh'],
    'tele': ['telegram'], 'tl': ['telegram'], 'zl': ['zalo'], 'fb': ['facebook', 'fanpage'], 'ads': ['quang cao'],
    'sdt': ['so dien thoai'], 'so dt': ['so dien thoai'], 'kpi': ['muc tieu'], 'chi tieu': ['muc tieu'], 'doanh thu': ['doanh so'],
    'giam gia': ['ma uu dai', 'voucher'], 'khuyen mai': ['uu dai', 'voucher'], 'voucher': ['ma uu dai'], 'coupon': ['ma uu dai'],
    'bai viet': ['dang bai'], 'hinh': ['anh'], 'ton kho': ['kho'], 'ncc': ['nha cung cap'], 'loi': ['su co', 'gop y'],
    'xoa don': ['huy'], 'huy don': ['huy'], 'sua don': ['sua don', 'doi dia chi'], 'cskh': ['cham soc'], 'cham soc khach': ['cham soc'],
    'goi lai': ['hen goi lai'], 'nghe may': ['bat may'], 'hoa hong': ['thuong', 'loai don']
  };
  // chữ đệm, bỏ qua khi tìm (cụm 2 chữ bỏ trước)
  var STOP2 = ['the nao', 'lam sao', 'lam gi', 'la gi', 'o dau', 'bao nhieu', 'tai sao', 'vi sao', 'duoc khong', 'co the', 'nhu nao', 'cho em', 'cho toi', 'giup em'];
  var STOP = ' la sao gi cach de cho toi minh em chi bi duoc khong thi o nhu muon can co cua va voi mot nhung cac roi hay nen phai khi nay do a oi nhe vay ah ha ak ko k dc j sau truoc ';

  function fold(s) { // bỏ dấu, giữ đúng độ dài từng chữ để tô vàng đúng chỗ
    s = String(s || '').toLowerCase();
    var o = '';
    for (var i = 0; i < s.length; i++) {
      var c = s[i];
      if (c === 'đ') { o += 'd'; continue; }
      var n = c.normalize('NFD');
      o += n.length > 1 ? n[0] : c;
    }
    return o;
  }
  function esc(s) { return String(s).replace(/[&<>"]/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]; }); }

  function load() {
    if (DATA) return Promise.resolve(DATA);
    if (!loading) loading = fetch('/huong-dan/search.json', { cache: 'no-cache' }).then(function (r) { return r.json(); }).then(function (d) {
      d.forEach(function (e) {
        e.fh = fold(e.h); e.fs = fold(e.s || ''); e.fp = fold(e.p); e.fx = fold(e.x); e.fk = fold(e.k || '');
        e.kp = e.fk.split(/\s*,\s*/).filter(function (x) { return x.length > 2; });
      });
      return (DATA = d);
    }).catch(function () { loading = null; return []; });
    return loading;
  }

  function clean(q) { return ' ' + fold(q).replace(/[^a-z0-9]+/g, ' ').trim() + ' '; }
  function core(q) { // bỏ chữ đệm; nếu bỏ hết thì giữ nguyên
    var f = clean(q), c = f;
    STOP2.forEach(function (w) { c = c.split(' ' + w + ' ').join(' '); });
    c = c.split(' ').filter(function (w) { return w && STOP.indexOf(' ' + w + ' ') < 0; }).join(' ');
    return c || f.trim();
  }
  // mỗi cụm = [chữ gốc, chữ gần nghĩa…]
  function parse(q) {
    var c = core(q);
    if (!c) return [];
    var words = c.split(' '), groups = [], i = 0;
    while (i < words.length) {
      var two = words[i] + ' ' + (words[i + 1] || '');
      if (words[i + 1] && SYN[two]) { groups.push([two].concat(SYN[two])); i += 2; continue; }
      groups.push([words[i]].concat(SYN[words[i]] || [])); i++;
    }
    return groups;
  }
  // khớp trọn tiếng: "ma" khớp "mã" nhưng không khớp "email", "màn"; chữ dài ≥ 5 (đang gõ dở "telegr") thì khớp đầu chữ
  function at(txt, i, w) { return (i === 0 || !/[a-z0-9]/.test(txt[i - 1])) && (w.length >= 5 || i + w.length >= txt.length || !/[a-z0-9]/.test(txt[i + w.length])); }
  function count(txt, w) { var n = 0, i = txt.indexOf(w); while (i >= 0 && n < 5) { if (at(txt, i, w)) n++; i = txt.indexOf(w, i + 1); } return n; }
  function has(txt, w) { return count(txt, w) > 0; }
  var IDF = {};
  function idf(w) { // chữ càng hiếm trong hướng dẫn càng nặng ("telegram" nặng hơn "khách")
    if (IDF[w] == null) {
      var df = 0;
      DATA.forEach(function (e) { if (has(e.fh, w) || has(e.fk, w) || has(e.fx, w)) df++; });
      IDF[w] = Math.log(1 + DATA.length / (1 + df));
    }
    return IDF[w];
  }
  function search(q) {
    if (!DATA) return [];
    var groups = parse(q), qn = clean(q), qc = ' ' + core(q) + ' ';
    if (!groups.length) return [];
    var total = 0, gi = groups.map(function (g) { var v = idf(g[0]); total += v; return v; });
    var pairs = [];
    for (var p = 0; p + 1 < groups.length; p++) pairs.push(groups[p][0] + ' ' + groups[p + 1][0]);
    var out = [];
    DATA.forEach(function (e) {
      var sum = 0, got = 0;
      groups.forEach(function (g, gx) {
        var best = 0;
        g.forEach(function (w, k) {
          var m = (k ? 0.75 : 1) * idf(w), f = 0;
          if (has(e.fh, w)) f = 6;
          else if (has(e.fk, w)) f = 5;
          else if (has(e.fs, w) || has(e.fp, w)) f = 2;
          else { var c = count(e.fx, w); if (c) f = Math.min(2.5, 1 + 0.4 * (c - 1)); }
          best = Math.max(best, f * m);
        });
        if (best) { sum += best; got += gi[gx]; }
      });
      // cả cụm từ khoá của mục nằm trong câu gõ (vd "khách bom hàng" chứa "bom hàng") → rất đúng mục
      var kb = 0;
      e.kp.forEach(function (kp) {
        if (qn.indexOf(' ' + kp + ' ') >= 0 || qc.indexOf(' ' + kp + ' ') >= 0) kb = Math.max(kb, 8 + 4 * kp.split(' ').length);
        else if (qc.length > 5 && (' ' + kp + ' ').indexOf(qc) >= 0) kb = Math.max(kb, 8);
      });
      var cov = total ? got / total : 0;
      if (!kb && (cov < 0.5 || (groups.length === 1 && !got))) return;
      var score = sum * (0.3 + 0.7 * cov * cov) + kb;
      pairs.forEach(function (pp) { if (has(e.fh, pp)) score += 5; else if (has(e.fk, pp)) score += 3; else score += Math.min(3, count(e.fx, pp)); });
      var qt = qc.trim();
      if (qt.length > 3 && e.fh.indexOf(qt) >= 0) score += 6;
      if (e.l === 1) score -= 1.5; // phần mở đầu trang xếp sau các mục cụ thể
      out.push({ e: e, s: score });
    });
    out.sort(function (a, b) { return b.s - a.s; });
    return out.slice(0, 30);
  }

  function words(q) { // các chữ cần tô vàng (đã bỏ dấu)
    var w = [];
    parse(q).forEach(function (g) { g.forEach(function (x) { if (x.length > 1 || g.length === 1) w.push(x); }); });
    return w.sort(function (a, b) { return b.length - a.length; });
  }
  function mark(text, ws) {
    var f = fold(text), hit = new Array(text.length + 1).join('0').split('');
    ws.forEach(function (w) { var i = f.indexOf(w); while (i >= 0) { if (at(f, i, w)) for (var k = 0; k < w.length; k++) hit[i + k] = '1'; i = f.indexOf(w, i + 1); } });
    var o = '', on = false;
    for (var i = 0; i < text.length; i++) {
      if (hit[i] === '1' && !on) { o += '<mark>'; on = true; }
      if (hit[i] !== '1' && on) { o += '</mark>'; on = false; }
      o += esc(text[i]);
    }
    return o + (on ? '</mark>' : '');
  }
  function snippet(e, ws) {
    var x = e.x || '', f = e.fx, pos = -1;
    ws.forEach(function (w) { var i = f.indexOf(w); while (i >= 0 && !at(f, i, w)) i = f.indexOf(w, i + 1); if (i >= 0 && (pos < 0 || i < pos)) pos = i; });
    if (pos < 0) return mark(x.slice(0, 140), ws) + (x.length > 140 ? '…' : '');
    var a = Math.max(0, pos - 50), b = Math.min(x.length, pos + 110);
    if (a > 0) { var sp = x.indexOf(' ', a); if (sp > 0 && sp < pos) a = sp + 1; }
    return (a > 0 ? '…' : '') + mark(x.slice(a, b), ws) + (b < x.length ? '…' : '');
  }
  function link(e, q) { return e.u + '?tim=' + encodeURIComponent(q) + (e.a ? '#' + e.a : ''); }

  /* ---------------- hộp tìm kiếm (bật bằng nút Tìm, phím / hoặc Ctrl+K) */
  var dlg, input, list, sel = -1, results = [], lastQ = '';
  function build() {
    dlg = document.createElement('div');
    dlg.className = 'gs';
    dlg.hidden = true;
    dlg.innerHTML = '<div class="gs-back" data-close></div>' +
      '<div class="gs-box" role="dialog" aria-modal="true" aria-label="Tìm trong hướng dẫn">' +
      '<div class="gs-top"><svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true"><circle cx="11" cy="11" r="7" fill="none" stroke="currentColor" stroke-width="2.4"/><path d="M16.5 16.5 21 21" stroke="currentColor" stroke-width="2.4" stroke-linecap="round"/></svg>' +
      '<input type="search" placeholder="Gõ việc bạn cần làm, ví dụ: lên đơn" autocomplete="off" enterkeyhint="search" aria-label="Tìm trong hướng dẫn">' +
      '<button type="button" class="gs-x" data-close>Đóng</button></div>' +
      '<div class="gs-list" role="listbox"></div>' +
      '<div class="gs-foot"><span><kbd>↑</kbd><kbd>↓</kbd> chọn</span><span><kbd>Enter</kbd> mở</span><span><kbd>Esc</kbd> đóng</span></div></div>';
    document.body.appendChild(dlg);
    input = dlg.querySelector('input');
    list = dlg.querySelector('.gs-list');
    dlg.addEventListener('click', function (ev) { if (ev.target.closest('[data-close]')) close(); });
    input.addEventListener('input', function () { render(input.value); });
    input.addEventListener('keydown', function (ev) {
      if (ev.key === 'ArrowDown' || ev.key === 'ArrowUp') {
        ev.preventDefault();
        var n = list.querySelectorAll('.gs-item').length;
        if (!n) return;
        sel = (sel + (ev.key === 'ArrowDown' ? 1 : -1) + n) % n;
        focusSel();
      } else if (ev.key === 'Enter') {
        var it = list.querySelectorAll('.gs-item')[sel < 0 ? 0 : sel];
        if (it) { ev.preventDefault(); go(it); }
      }
    });
    list.addEventListener('click', function (ev) {
      var c = ev.target.closest('[data-q]');
      if (c) { input.value = c.getAttribute('data-q'); render(input.value); input.focus(); }
      var it = ev.target.closest('.gs-item');
      if (it) { ev.preventDefault(); go(it); }
    });
  }
  function focusSel() {
    var items = list.querySelectorAll('.gs-item');
    items.forEach(function (x, i) { x.classList.toggle('on', i === sel); x.setAttribute('aria-selected', i === sel); });
    if (items[sel]) items[sel].scrollIntoView({ block: 'nearest' });
  }
  function go(it) {
    var href = it.getAttribute('href');
    close();
    var u = new URL(href, location.href);
    if (u.pathname === location.pathname) { history.pushState(null, '', href); highlight(); } else location.href = href;
  }
  function chips() { return '<div class="gs-chips">' + HINTS.map(function (h) { return '<button type="button" class="g-chip" data-q="' + esc(h) + '">' + esc(h) + '</button>'; }).join('') + '</div>'; }
  function render(q) {
    lastQ = q; sel = -1;
    if (!q.trim()) { list.innerHTML = '<p class="gs-tip">Hay tìm:</p>' + chips(); return; }
    load().then(function () {
      if (q !== lastQ) return;
      results = search(q);
      if (!results.length) {
        list.innerHTML = '<div class="gs-none"><b>Chưa tìm thấy “' + esc(q) + '”.</b><br>Thử gõ ngắn hơn hoặc chữ khác (ví dụ “đơn” thay vì “đơn hàng mới”). Vẫn không thấy thì hỏi quản lý, hoặc bấm 💡 Góp ý trong CRM.</div>' + chips();
        return;
      }
      var ws = words(q), h = '', page = '', order = [];
      results.forEach(function (r) { if (order.indexOf(r.e.p) < 0) order.push(r.e.p); });
      results = results.slice().sort(function (a, b) { return order.indexOf(a.e.p) - order.indexOf(b.e.p) || b.s - a.s; });
      results.forEach(function (r) {
        var e = r.e;
        if (e.p !== page) { page = e.p; h += '<div class="gs-pg">' + esc(page) + '</div>'; }
        h += '<a class="gs-item" role="option" href="' + esc(link(e, q)) + '">' +
          '<span class="gs-h">' + (e.s ? '<span class="gs-par">' + esc(e.s) + ' › </span>' : '') + mark(e.h, ws) + '</span>' +
          '<span class="gs-x2">' + snippet(e, ws) + '</span></a>';
      });
      list.innerHTML = '<p class="gs-tip">' + results.length + (results.length >= 30 ? '+' : '') + ' mục khớp</p>' + h;
      sel = 0; focusSel();
    });
  }
  function open(q) {
    if (!dlg) build();
    dlg.hidden = false;
    document.documentElement.classList.add('gs-open');
    input.value = q || '';
    render(input.value);
    setTimeout(function () { input.focus(); if (!q) input.select(); }, 10);
    load();
  }
  function close() {
    if (!dlg || dlg.hidden) return;
    dlg.hidden = true;
    document.documentElement.classList.remove('gs-open');
  }

  /* ---------------- mở trang từ kết quả: tô vàng chữ đã tìm + cuộn tới */
  function highlight() {
    var main = document.querySelector('main');
    main.querySelectorAll('mark.g-hl').forEach(function (m) { m.replaceWith(document.createTextNode(m.textContent)); });
    main.normalize();
    var bar = document.querySelector('.g-hlbar');
    if (bar) bar.remove();
    var q = new URLSearchParams(location.search).get('tim');
    if (!q) return;
    var ws = words(q);
    if (!ws.length) return;
    // chỉ tô trong mục đã chọn (từ tiêu đề đó tới tiêu đề cùng cấp kế tiếp); không có mục thì tô cả trang
    var start = location.hash ? document.getElementById(decodeURIComponent(location.hash.slice(1))) : null;
    var isQ = start && start.classList.contains('g-q'), stopTags = start ? (start.tagName === 'H3' || isQ ? ['H2', 'H3'] : ['H2']) : [];
    var nodes = [], n, inside = !start, walker = document.createTreeWalker(main, NodeFilter.SHOW_ELEMENT | NodeFilter.SHOW_TEXT);
    while ((n = walker.nextNode())) {
      if (n.nodeType === 1) {
        if (n === start) inside = true;
        else if (start && inside && (stopTags.indexOf(n.tagName) >= 0 || (isQ && n.classList.contains('g-q')))) break;
        continue;
      }
      if (inside && n.nodeValue.trim() && !n.parentNode.closest('.g-hero, script')) nodes.push(n);
    }
    var first = null, count = 0;
    nodes.forEach(function (t) {
      var txt = t.nodeValue, f = fold(txt), hits = [];
      ws.forEach(function (w) { var i = f.indexOf(w); while (i >= 0) { if (at(f, i, w)) hits.push([i, i + w.length]); i = f.indexOf(w, i + 1); } });
      if (!hits.length) return;
      hits.sort(function (a, b) { return a[0] - b[0]; });
      var frag = document.createDocumentFragment(), pos = 0;
      hits.forEach(function (h) {
        if (h[0] < pos) { if (h[1] > pos) h[0] = pos; else return; }
        frag.appendChild(document.createTextNode(txt.slice(pos, h[0])));
        var m = document.createElement('mark'); m.className = 'g-hl'; m.textContent = txt.slice(h[0], h[1]);
        frag.appendChild(m); if (!first) first = m; count++;
        pos = h[1];
      });
      frag.appendChild(document.createTextNode(txt.slice(pos)));
      t.parentNode.replaceChild(frag, t);
    });
    bar = document.createElement('div');
    bar.className = 'g-hlbar';
    bar.innerHTML = '<span>Đang tô vàng <b>“' + esc(q) + '”</b>' + (count ? '' : ' (không có trong mục này)') + '</span>' +
      '<button type="button" data-again>🔍 Tìm lại</button><button type="button" data-clear>Bỏ tô</button>';
    document.body.appendChild(bar);
    bar.querySelector('[data-again]').onclick = function () { open(q); };
    bar.querySelector('[data-clear]').onclick = function () { history.replaceState(null, '', location.pathname + location.hash); highlight(); };
    if (start) start.scrollIntoView();
    else if (first) first.scrollIntoView({ block: 'center' });
    if (start) { start.classList.remove('g-flash'); void start.offsetWidth; start.classList.add('g-flash'); }
  }

  /* ---------------- gắn sự kiện */
  document.addEventListener('click', function (ev) {
    if (ev.target.closest('[data-find]')) { ev.preventDefault(); open(); }
  });
  document.addEventListener('keydown', function (ev) {
    var tag = (ev.target.tagName || '').toLowerCase(), typing = tag === 'input' || tag === 'textarea' || ev.target.isContentEditable;
    if ((ev.key === 'k' || ev.key === 'K') && (ev.metaKey || ev.ctrlKey)) { ev.preventDefault(); open(); }
    else if (ev.key === '/' && !typing) { ev.preventDefault(); open(); }
    else if (ev.key === 'Escape') close();
  });
  // ô tìm to ở trang Bắt đầu: gõ chữ là mở hộp kết quả
  var hero = document.querySelector('[data-find-input]');
  if (hero) {
    hero.addEventListener('input', function () { var v = hero.value; hero.value = ''; open(v); });
    hero.addEventListener('focus', function () { load(); });
    var c = document.querySelector('[data-chips]');
    if (c) {
      c.innerHTML = HINTS.map(function (h) { return '<button type="button" class="g-chip" data-q="' + esc(h) + '">' + esc(h) + '</button>'; }).join('');
      c.addEventListener('click', function (ev) { var b = ev.target.closest('[data-q]'); if (b) open(b.getAttribute('data-q')); });
    }
  }
  // mục lục "Trong trang này": tô đậm mục đang đọc
  var tocLinks = Array.prototype.slice.call(document.querySelectorAll('.g-toc a'));
  if (tocLinks.length && 'IntersectionObserver' in window) {
    var heads = tocLinks.map(function (a) { return document.getElementById(decodeURIComponent(a.hash.slice(1))); });
    var io = new IntersectionObserver(function () {
      var cur = 0;
      heads.forEach(function (h, i) { if (h && h.getBoundingClientRect().top < 140) cur = i; });
      tocLinks.forEach(function (a, i) { a.classList.toggle('on', i === cur); });
    }, { rootMargin: '-120px 0px -60% 0px' });
    heads.forEach(function (h) { if (h) io.observe(h); });
  }
  window.addEventListener('popstate', highlight);
  highlight();
})();
