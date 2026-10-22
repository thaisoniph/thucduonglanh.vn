/* Trang tuyển dụng congsu.thucduonglanh.vn: thanh đọc, hiện dần khi cuộn, bộ đếm hành trình 10 triệu, video bấm mới tải, trượt ảnh,
   form ứng tuyển 6 bước (tự lưu nháp trên máy) gửi về api.thucduonglanh.vn ({type:'apply'}, api/src/apply.js chấm mức phù hợp). */
(function () {
  'use strict';
  var MAX = 5 * 1024 * 1024, API = 'https://api.thucduonglanh.vn/api', DRAFT = 'cs_draft';
  function store(k, v) { try { if (v === undefined) return localStorage.getItem(k); if (v === null) localStorage.removeItem(k); else localStorage.setItem(k, v); } catch (e) { return null; } }
  function vn(n) { return Math.round(n).toLocaleString('vi-VN'); }

  // Thanh tiến độ đọc ở mép trên + hiện dần các khối .cs-rv khi cuộn tới (kiểm tra vị trí mỗi lần cuộn, không cần IntersectionObserver)
  var bar = document.querySelector('.cs-progress i'), rv = [].slice.call(document.querySelectorAll('.cs-rv')), tick = false;
  function onScroll() {
    tick = false;
    var h = document.documentElement, vh = window.innerHeight || h.clientHeight;
    if (bar) bar.style.width = (h.scrollTop / Math.max(1, h.scrollHeight - h.clientHeight) * 100) + '%';
    if (rv.length) rv = rv.filter(function (el) { if (el.getBoundingClientRect().top < vh * 0.94) { el.classList.add('in'); return false; } return true; });
  }
  function queue() { if (!tick) { tick = true; requestAnimationFrame(onScroll); } }
  window.addEventListener('scroll', queue, { passive: true });
  window.addEventListener('resize', queue);
  onScroll();
  setTimeout(onScroll, 400);
  // Mở trang có #ung-tuyen…: ảnh, phông chữ tải xong làm trang dài ra → cuộn lại đúng chỗ một lần
  window.addEventListener('load', function () {
    var t = location.hash && document.getElementById(location.hash.slice(1));
    if (t) t.scrollIntoView();
    setTimeout(function () { document.documentElement.classList.add('cs-smooth'); }, 50);
  });

  // Bộ đếm hành trình 10 triệu người (api journey.js, cùng số với trang chủ thucduonglanh.vn)
  if (document.querySelector('[data-journey]')) {
    fetch(API + '/journey').then(function (r) { return r.json(); }).then(function (j) {
      if (!j || !j.ok || !j.total) return;
      var goal = j.goal || 1e7;
      document.querySelectorAll('[data-jn]').forEach(function (el) { el.textContent = vn(j.total); });
      document.querySelectorAll('[data-jleft]').forEach(function (el) { el.textContent = vn(Math.max(0, goal - j.total)); });
      document.querySelectorAll('[data-jbar]').forEach(function (el) { el.style.width = Math.max(1, j.total / goal * 100) + '%'; });
    }).catch(function () { });
  }

  // Video YouTube: chỉ tải khung phát khi bấm (trang nhẹ hơn)
  document.querySelectorAll('.cs-video[data-yt]').forEach(function (b) {
    b.addEventListener('click', function () {
      var f = document.createElement('iframe');
      f.src = 'https://www.youtube-nocookie.com/embed/' + b.dataset.yt + '?autoplay=1&rel=0';
      f.allow = 'autoplay; encrypted-media; picture-in-picture'; f.allowFullscreen = true; f.title = 'Video Thực Dưỡng Lành';
      var box = document.createElement('div'); box.className = 'cs-video'; box.appendChild(f); b.replaceWith(box);
    });
  });

  // Trượt ảnh Sống & làm việc
  document.querySelectorAll('.cs-slider').forEach(function (s) {
    var box = s.querySelector('.cs-slides');
    s.querySelectorAll('.cs-sl-btn').forEach(function (b) {
      b.addEventListener('click', function () { box.scrollBy({ left: (b.classList.contains('next') ? 1 : -1) * box.clientWidth * 0.8, behavior: 'smooth' }); });
    });
  });

  var form = document.getElementById('cs-form');
  if (!form) return;
  var msg = form.querySelector('.cs-fmsg'), steps = [].slice.call(form.querySelectorAll('.cs-step')), dots = form.querySelectorAll('.cs-stepbar li'), cur = 0;
  function say(t, bad) { msg.textContent = t; msg.className = 'cs-fmsg' + (bad ? ' err' : ''); }
  function phoneOk(p) { p = String(p).replace(/\D/g, ''); if (p.indexOf('84') === 0 && p.length === 11) p = '0' + p.slice(2); return /^0\d{9}$/.test(p) ? p : ''; }

  // Nháp: lưu mọi ô (trừ file) trên máy, mở lại trang vẫn còn
  function saveDraft() {
    var o = {}; [].forEach.call(form.elements, function (el) {
      if (!el.name || el.type === 'file' || el.name === 'website') return;
      if (el.type === 'radio') { if (el.checked) o[el.name] = el.value; } else if (el.type === 'checkbox') o[el.name] = el.checked; else o[el.name] = el.value;
    });
    o._step = cur; store(DRAFT, JSON.stringify(o));
  }
  var draft = null; try { draft = JSON.parse(store(DRAFT) || 'null'); } catch (e) { }
  if (draft) [].forEach.call(form.elements, function (el) {
    if (!el.name || !(el.name in draft) || el.type === 'file') return;
    if (el.type === 'radio') el.checked = draft[el.name] === el.value; else if (el.type === 'checkbox') el.checked = !!draft[el.name]; else el.value = draft[el.name];
  });

  // Chọn sẵn vị trí khi đến từ trang chi tiết (?vi-tri=<slug>)
  var want = new URLSearchParams(location.search).get('vi-tri');
  if (want) [].forEach.call(form.elements.job.options, function (o) { if (o.dataset.slug === want) form.elements.job.value = o.value; });

  function show(i, scroll) {
    cur = Math.max(0, Math.min(steps.length - 1, i));
    steps.forEach(function (s, k) { s.hidden = k !== cur; });
    [].forEach.call(dots, function (d, k) { d.className = k < cur ? 'done' : k === cur ? 'on' : ''; });
    say('');
    if (scroll) form.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }
  // Kiểm tra bước hiện tại: ô bắt buộc, nhóm chọn 1, số điện thoại, email
  function check(step) {
    var bad = null, why = 'Bạn trả lời giúp các câu còn thiếu nhé.';
    [].forEach.call(step.querySelectorAll('[required]'), function (el) {
      var ok;
      if (el.type === 'radio') ok = !!form.querySelector('input[name="' + el.name + '"]:checked');
      else if (el.type === 'checkbox') { ok = el.checked; if (!ok) why = 'Bạn đánh dấu ô đồng ý lưu thông tin để công ty xét tuyển nhé.'; }
      else if (el.name === 'phone') { ok = !!phoneOk(el.value); if (!ok && el.value) why = 'Số điện thoại cần đủ 10 số, VD: 0912 345 678.'; }
      else if (el.name === 'email') { ok = /^\S+@\S+\.\S+$/.test(el.value.trim()); if (!ok && el.value) why = 'Email chưa đúng, bạn xem lại giúp nhé.'; }
      else ok = !!el.value.trim();
      var box = el.type === 'radio' ? el.closest('.cs-q') : el.type === 'checkbox' ? el.closest('.cs-consent') : el;
      if (box) box.classList.toggle('bad', !ok);
      if (!ok && !bad) bad = box || el;
    });
    if (bad) { say(why, true); bad.scrollIntoView({ behavior: 'smooth', block: 'center' }); }
    return !bad;
  }
  form.addEventListener('click', function (e) {
    if (e.target.closest('[data-next]')) { if (check(steps[cur])) { show(cur + 1, true); saveDraft(); } }
    else if (e.target.closest('[data-prev]')) show(cur - 1, true);
  });
  form.addEventListener('change', function (e) { var q = e.target.closest('.cs-q'); if (q) q.classList.remove('bad'); saveDraft(); });
  form.addEventListener('input', function (e) { e.target.classList.remove('bad'); saveDraft(); });
  show(draft && draft._step ? draft._step : 0, false);

  function readFile(f) {
    return new Promise(function (ok, no) { var r = new FileReader(); r.onload = function () { ok(String(r.result).split(',')[1] || ''); }; r.onerror = no; r.readAsDataURL(f); });
  }
  function source() {
    var q = new URLSearchParams(location.search), u = ['utm_source', 'utm_medium', 'utm_campaign'].map(function (k) { return q.get(k) || ''; }).filter(Boolean).join(' / ');
    return u || (document.referrer && document.referrer.indexOf(location.host) < 0 ? 'Từ ' + document.referrer.replace(/^https?:\/\//, '').split('/')[0] : 'Vào thẳng');
  }

  form.addEventListener('submit', async function (e) {
    e.preventDefault();
    for (var i = 0; i < steps.length; i++) if (!check(steps[i])) { show(i, false); check(steps[i]); return; }
    var el = form.elements, f = el.cv_file.files[0], btn = form.querySelector('button[type=submit]');
    if (f && f.size > MAX) return say('File CV lớn hơn 5 MB. Bạn dán link CV (Google Drive…) thay cho file nhé.', true);
    var q = {}; [].forEach.call(form.querySelectorAll('input[type=radio]:checked'), function (r) { if (r.name.indexOf('q_') === 0) q[r.name.slice(2)] = r.value; });
    // "type" phải đứng đầu: máy chủ nhận gói lớn (có file) chỉ khi bắt đầu bằng {"type":"apply"
    var d = { type: 'apply', job: el.job.value, name: el.name.value.trim(), phone: phoneOk(el.phone.value), email: el.email.value.trim(), birth: el.birth.value.trim(),
      area: el.area.value.trim(), exp: el.exp.value, salary: el.salary.value.trim(), start: el.start.value.trim(), cv_link: el.cv_link.value.trim(),
      why: el.why.value.trim(), hard: el.hard.value.trim(), rules: el.rules.value.trim(), ai: el.ai.value.trim(), life: el.life.value.trim(),
      heard: el.heard.value, consent: true, website: el.website.value, source: source(), q: q };
    btn.disabled = true; say(f ? 'Đang gửi hồ sơ và file CV…' : 'Đang gửi hồ sơ…');
    try {
      if (f) d.file = { name: f.name, data: await readFile(f) };
      var r = await fetch(form.dataset.endpoint, { method: 'POST', headers: { 'Content-Type': 'text/plain;charset=utf-8' }, body: JSON.stringify(d) });
      var j = await r.json();
      if (!j.ok) throw new Error(j.error || 'Gửi chưa được');
      store(DRAFT, null);
      form.hidden = true; var done = document.getElementById('cs-done'); done.hidden = false; done.scrollIntoView({ behavior: 'smooth', block: 'center' });
    } catch (err) {
      btn.disabled = false;
      say((err && err.message && err.message !== 'Failed to fetch' ? err.message + '. ' : 'Mạng đang chập chờn. ') + 'Bạn thử gửi lại, hoặc nhắn Zalo cho chúng tôi nhé.', true);
    }
  });
})();
