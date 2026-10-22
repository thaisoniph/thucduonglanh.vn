/* Trang tuyển dụng congsu.thucduonglanh.vn: video bấm mới tải, trượt ảnh, form ứng tuyển gửi về api.thucduonglanh.vn ({type:'apply'}, api/src/apply.js). */
(function () {
  'use strict';
  var MAX = 5 * 1024 * 1024;

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
  var msg = form.querySelector('.cs-fmsg'), btn = form.querySelector('button[type=submit]'), sel = form.elements.job;

  // Chọn sẵn vị trí khi đến từ trang chi tiết (?vi-tri=<slug>)
  var want = new URLSearchParams(location.search).get('vi-tri');
  if (want) [].forEach.call(sel.options, function (o) { if (o.dataset.slug === want) sel.value = o.value; });

  function say(t, bad) { msg.textContent = t; msg.className = 'cs-fmsg' + (bad ? ' err' : ''); }
  function phoneOk(p) { p = String(p).replace(/\D/g, ''); if (p.indexOf('84') === 0 && p.length === 11) p = '0' + p.slice(2); return /^0\d{9}$/.test(p) ? p : ''; }
  function readFile(f) {
    return new Promise(function (ok, no) { var r = new FileReader(); r.onload = function () { ok(String(r.result).split(',')[1] || ''); }; r.onerror = no; r.readAsDataURL(f); });
  }
  function source() {
    var q = new URLSearchParams(location.search), u = ['utm_source', 'utm_medium', 'utm_campaign'].map(function (k) { return q.get(k) || ''; }).filter(Boolean).join(' / ');
    return u || (document.referrer && document.referrer.indexOf(location.host) < 0 ? 'Từ ' + document.referrer.replace(/^https?:\/\//, '').split('/')[0] : 'Vào thẳng');
  }

  form.addEventListener('input', function (e) { e.target.classList.remove('bad'); });
  form.addEventListener('submit', async function (e) {
    e.preventDefault();
    var el = form.elements, bad = [];
    [['job', el.job.value], ['name', el.name.value.trim()], ['phone', phoneOk(el.phone.value)], ['email', /^\S+@\S+\.\S+$/.test(el.email.value.trim())],
      ['why', el.why.value.trim()], ['hard', el.hard.value.trim()]].forEach(function (x) { if (!x[1]) { bad.push(el[x[0]]); el[x[0]].classList.add('bad'); } });
    if (bad.length) { bad[0].focus(); return say(el.phone.value && !phoneOk(el.phone.value) && bad[0] === el.phone ? 'Số điện thoại cần đủ 10 số, VD: 0912 345 678.' : 'Bạn điền giúp các ô có dấu * nhé.', true); }
    var f = el.cv_file.files[0];
    if (f && f.size > MAX) return say('File CV lớn hơn 5 MB. Bạn dán link CV (Google Drive…) thay cho file nhé.', true);
    if (!el.consent.checked) { el.consent.focus(); return say('Bạn đánh dấu ô đồng ý lưu thông tin để công ty xét tuyển nhé.', true); }
    // "type" phải đứng đầu: máy chủ nhận gói lớn (có file) chỉ khi bắt đầu bằng {"type":"apply"
    var d = { type: 'apply', job: el.job.value, name: el.name.value.trim(), phone: phoneOk(el.phone.value), email: el.email.value.trim(), birth: el.birth.value.trim(),
      area: el.area.value.trim(), exp: el.exp.value, salary: el.salary.value.trim(), start: el.start.value.trim(), cv_link: el.cv_link.value.trim(),
      why: el.why.value.trim(), hard: el.hard.value.trim(), rules: el.rules.value.trim(), ai: el.ai.value.trim(), life: el.life.value.trim(),
      heard: el.heard.value, consent: true, website: el.website.value, source: source() };
    btn.disabled = true; say(f ? 'Đang gửi hồ sơ và file CV…' : 'Đang gửi hồ sơ…');
    try {
      if (f) d.file = { name: f.name, data: await readFile(f) };
      var r = await fetch(form.dataset.endpoint, { method: 'POST', headers: { 'Content-Type': 'text/plain;charset=utf-8' }, body: JSON.stringify(d) });
      var j = await r.json();
      if (!j.ok) throw new Error(j.error || 'Gửi chưa được');
      form.hidden = true; var done = document.getElementById('cs-done'); done.hidden = false; done.scrollIntoView({ behavior: 'smooth', block: 'center' });
    } catch (err) {
      btn.disabled = false;
      say((err && err.message && err.message !== 'Failed to fetch' ? err.message + '. ' : 'Mạng đang chập chờn. ') + 'Bạn thử gửi lại, hoặc nhắn Zalo cho chúng tôi nhé.', true);
    }
  });
})();
