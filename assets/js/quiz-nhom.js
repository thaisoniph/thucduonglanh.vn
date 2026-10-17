// Màn hình lớn chơi nhóm "Bạn còn mấy ngón tay?" (/ngon-tay-song-lanh/nhom/, build.py page_quiz_group).
// Người dẫn chiếu lên TV / máy chiếu: mọi người giơ 2 tay, mỗi câu thói quen chưa làm được thì hạ 1 ngón.
// Điều khiển: → / Space / PageDown / bút trình chiếu = tiếp; ← / PageUp = quay lại; F = toàn màn hình.
// Cuối buổi: mã QR nhận quà + chơi lại trên điện thoại + nhóm Zalo, link gắn utm_campaign = tên buổi (CRM đếm khách từ sự kiện).
(function () {
  var D; try { D = JSON.parse(document.getElementById('gm-data').textContent); } catch (e) { return; }
  var Q = D.questions || [], n = Q.length, stage = document.querySelector('[data-gm-stage]'), stepEl = document.querySelector('[data-gm-step]');
  var KEY = 'tdl_gm_event', i = 0; // 0 = chào, 1..n = câu hỏi, n+1 = đếm ngón, n+2 = mã QR
  function esc(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }
  function slug(s) { return String(s || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/đ/g, 'd').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 40); }
  var ev = new URLSearchParams(location.search).get('ten') || ''; try { ev = ev || localStorage.getItem(KEY) || ''; } catch (e) { }
  function link(path, medium) { // link mã QR: nguồn = su_kien, chiến dịch = tên buổi
    var u = D.domain + path, c = slug(ev) || 'su-kien';
    return u + (u.indexOf('?') < 0 ? '?' : '&') + 'utm_source=su_kien&utm_medium=' + medium + '&utm_campaign=' + c;
  }
  function qr(text) {
    if (!window.qrcode) return '<p>' + esc(text) + '</p>';
    var q = window.qrcode(0, 'M'); q.addData(text); q.make(); return q.createSvgTag({ cellSize: 6, margin: 2, scalable: true });
  }
  function hands(down) { // giống .qz-hands ở trang chơi một mình
    var h = function (side, base) { var s = '<div class="qz-hand qz-' + side + '">'; for (var k = 0; k < 5; k++) s += '<span class="qz-f qz-f' + k + (base + k >= 10 - down ? ' down' : '') + '"></span>'; return s + '<span class="qz-palm"></span></div>'; };
    return '<div class="qz-hands gm-hands" aria-hidden="true">' + h('l', 0) + h('r', 5) + '</div>';
  }
  function render() {
    var h = '';
    if (i === 0) {
      h = '<div class="gm-hello">' + hands(0) + '<p class="gm-eye">Trò chơi sống lành · ' + n + ' câu</p><h1>' + esc(D.title) + '</h1>' +
        '<ol class="gm-rules"><li>Mọi người <b>giơ 2 bàn tay lên, xòe đủ 10 ngón</b> ✋✋</li><li>Mỗi câu hỏi: thói quen <b>đang làm tốt → giữ nguyên</b> ngón tay</li><li>Thói quen <b>chưa làm được → hạ 1 ngón</b> xuống 👇</li><li>Hết ' + n + ' câu, <b>ai còn nhiều ngón nhất</b> là người sống lành nhất! 🏆</li></ol>' +
        '<label class="gm-ev">Tên buổi (để đếm người quét mã QR): <input data-gm-ev value="' + esc(ev) + '" placeholder="Ví dụ: Trà đàm tháng 10"></label>' +
        '<p><button type="button" class="gm-btn gm-go" data-gm-next>Bắt đầu ▶</button></p></div>';
    } else if (i <= n) {
      var q = Q[i - 1];
      h = '<div class="gm-q"><div class="gm-bar"><i style="width:' + ((i - 1) / n * 100) + '%"></i></div><p class="gm-no">Câu ' + i + '/' + n + '</p><p class="gm-ic">' + esc(q.icon || '') + '</p><h2>' + esc(q.q) + '</h2>' +
        (q.fun ? '<p class="gm-fun">' + esc(q.fun) + '</p>' : '') +
        '<div class="gm-ans"><span class="gm-yes">✋ Có → giữ ngón tay</span><span class="gm-no2">👇 Chưa → hạ 1 ngón</span></div></div>';
    } else if (i === n + 1) {
      h = '<div class="gm-count"><p class="gm-eye">Hết ' + n + ' câu rồi!</p><h2>Giơ tay lên, đếm ngón nào! 🙌</h2><div class="gm-tiers">' +
        (D.results || []).map(function (r, k, L) { var hi = k ? Number(L[k - 1].min) - 1 : n; var lo = Number(r.min) || 0; return '<div class="gm-tier"><span class="gm-tn">' + (lo === hi ? lo : lo + '–' + hi) + ' ngón</span><b>' + esc((r.icon || '') + ' ' + r.title) + '</b><small>' + esc(r.text || '') + '</small></div>'; }).join('') +
        '</div><p class="gm-win">Ai còn nhiều ngón nhất? Cả phòng cho một tràng pháo tay nào! 👏</p></div>';
    } else {
      var cards = [];
      if (D.gift) cards.push(['🎁 Nhận quà miễn phí', D.gift.title || 'Cẩm nang sống khỏe', link(D.gift.url, 'qr_qua')]);
      cards.push(['🖐 Chơi lại trên điện thoại', 'Nhận gợi ý riêng + thử thách 7 ngày', link(D.quiz, 'qr_choi')]);
      if (D.zalo) cards.push(['👥 Vào nhóm Zalo', 'Sống khỏe cùng Thực Dưỡng Lành', D.domain + D.zalo]);
      h = '<div class="gm-end"><h2>Mang trò chơi về nhà 📱</h2><p class="gm-sub">Mở camera điện thoại, quét mã để nhận quà và bắt đầu thử thách 7 ngày “dựng lại 1 ngón tay”.</p><div class="gm-qrs gm-n' + cards.length + '">' +
        cards.map(function (c) { return '<div class="gm-qr"><div class="gm-qimg">' + qr(c[2]) + '</div><b>' + esc(c[0]) + '</b><small>' + esc(c[1]) + '</small></div>'; }).join('') + '</div></div>';
    }
    stage.innerHTML = h;
    stepEl.textContent = ev ? ev : '';
    document.querySelector('[data-gm-prev]').style.visibility = i ? 'visible' : 'hidden';
    var nx = document.querySelector('.gm-nav [data-gm-next]'); nx.style.visibility = i < n + 2 ? 'visible' : 'hidden'; nx.textContent = i === n ? 'Đếm ngón ▶' : i === n + 1 ? 'Nhận quà ▶' : 'Tiếp ▶';
    var inp = stage.querySelector('[data-gm-ev]');
    if (inp) inp.addEventListener('input', function () { ev = inp.value.trim(); try { localStorage.setItem(KEY, ev); } catch (e) { } });
  }
  function go(d) { i = Math.max(0, Math.min(n + 2, i + d)); render(); }
  document.addEventListener('click', function (e) {
    if (e.target.closest('[data-gm-next]')) go(1);
    else if (e.target.closest('[data-gm-prev]')) go(-1);
    else if (e.target.closest('[data-gm-fs]')) fs();
  });
  function fs() { var el = document.documentElement; if (document.fullscreenElement) document.exitFullscreen(); else if (el.requestFullscreen) el.requestFullscreen().catch(function () { }); }
  document.addEventListener('keydown', function (e) {
    if (e.target.tagName === 'INPUT') { if (e.key === 'Enter') go(1); return; }
    if (['ArrowRight', 'PageDown', ' ', 'Enter'].indexOf(e.key) >= 0) { e.preventDefault(); go(1); }
    else if (['ArrowLeft', 'PageUp', 'Backspace'].indexOf(e.key) >= 0) { e.preventDefault(); go(-1); }
    else if (e.key === 'f' || e.key === 'F') fs();
  });
  render();
  if (!window.qrcode) window.addEventListener('load', function () { if (i === n + 2) render(); });
})();
