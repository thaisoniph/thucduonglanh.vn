// Trang quản trị website (https://thucduonglanh.vn/admin, Sveltia CMS) đăng nhập bằng email như CRM, không cần tài khoản GitHub.
// - GET  /cms/auth          : cửa sổ đăng nhập (Sveltia mở khi bấm "Đăng nhập bằng GitHub"): email → mã 6 số → gửi mã phiên về /admin
// - POST /cms/login|verify  : xin mã / kiểm tra mã (cùng nguồn với trang trên, không cần CORS)
// - /gh/api/v3/*, /gh/api/graphql : cổng trung gian tới api.github.com. Đổi mã phiên của nhân sự thành mã GitHub của công ty
//   (kv gh_cms_token, Quản trị dán ở CRM → Cài đặt), chỉ cho đọc/ghi repo website, ghi tên người sửa vào commit + Nhật ký CRM.
// Chỉ nhận mã phiên đăng nhập bằng email (từ 14/10/2026 bỏ cách cũ đăng nhập bằng mã GitHub cá nhân).
import { kvGet, kvSet, kvDel, randHex, DAY } from './lib.js';
import { sendMail } from './google.js';
import { crmUsers, crmLog, SUPER_ADMIN } from './crm.js';

const REPO = 'thaisoniph/thucduonglanh.vn', GH = 'https://api.github.com', ADMIN_URL = 'https://thucduonglanh.vn/admin/';
const SESSION_DAYS = 30, NO_TOKEN = 'Trang quản trị chưa được kết nối GitHub. Nhờ anh Sơn dán mã ở CRM → Cài đặt → 🌐 Trang quản trị website.';
const SITE = /^https:\/\/((www\.)?thucduonglanh\.vn|[a-z0-9-]+\.thucduonglanh\.pages\.dev)$|^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/;
const okEmail = e => /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(e);

/** Ai được sửa website: Quản trị, hoặc người bật "Sửa website" ở CRM → Cài đặt → Nhân sự. */
export function canWeb(u) { return !!u && u.active && (u.level >= 3 || u.web); }
async function webUser(x, email) { email = String(email || '').trim().toLowerCase(); const u = (await crmUsers(x)).find(y => y.email === email); return canWeb(u) ? u : null; }

/* ---------- mã GitHub của công ty (fine-grained, chỉ repo website) */
export async function cmsToken(x) { return x.env.GH_CMS_TOKEN || await kvGet(x.db, 'gh_cms_token'); }
/** CRM → Cài đặt (Quản trị): lưu / kiểm tra mã. Trả trạng thái để hiện ở Cài đặt (không bao giờ trả mã). */
export async function cmsTokenSet(x, u, d) {
  if (u.level < 3) return { ok: false, error: 'Chỉ Quản trị.' };
  if (d.pat !== undefined) {
    const t = String(d.pat || '').trim();
    if (!t) { await kvDel(x.db, 'gh_cms_token'); await crmLog(x, u, 'Cài đặt', '-', '', 'Xoá mã GitHub trang quản trị web', ''); return { ok: true, status: await cmsStatus(x) }; }
    if (!/^github_pat_\w{20,}$/.test(t)) return { ok: false, error: 'Mã phải là loại "Fine-grained" (bắt đầu bằng github_pat_). Xem hướng dẫn ngay trên ô nhập.' };
    const s = await ghCheck(t); if (!s.ok) return { ok: false, error: s.error };
    await kvSet(x.db, 'gh_cms_token', t); await kvSet(x.db, 'gh_cms_exp', s.exp || '');
    await crmLog(x, u, 'Cài đặt', '-', '', 'Lưu mã GitHub trang quản trị web', s.exp ? 'hết hạn ' + s.exp : '');
  }
  return { ok: true, status: await cmsStatus(x) };
}
async function ghCheck(t) {
  const r = await fetch(GH + '/repos/' + REPO, { headers: ghHeaders(t) });
  if (r.status === 401) return { ok: false, error: 'GitHub báo mã sai hoặc đã hết hạn.' };
  if (!r.ok) return { ok: false, error: 'Mã chưa được cấp repo ' + REPO + ' (GitHub trả ' + r.status + '). Ở mục "Repository access" chọn "Only select repositories" → thucduonglanh.vn.' };
  const j = await r.json();
  if (!j.permissions || !j.permissions.push) return { ok: false, error: 'Mã chưa có quyền ghi. Ở "Repository permissions" → Contents chọn "Read and write".' };
  const exp = r.headers.get('github-authentication-token-expiration') || ''; // "2027-10-14 08:00:00 UTC"
  return { ok: true, exp: exp.slice(0, 10) };
}
export async function cmsStatus(x) {
  const has = !!await cmsToken(x), exp = has ? await kvGet(x.db, 'gh_cms_exp') || '' : '';
  return { has, env: !!x.env.GH_CMS_TOKEN, exp };
}
function ghHeaders(t) { return { Authorization: 'Bearer ' + t, Accept: 'application/vnd.github+json', 'User-Agent': 'thucduonglanh-cms', 'X-GitHub-Api-Version': '2022-11-28' }; }

/* ---------- đăng nhập bằng email */
async function cmsLogin(x, d) {
  const email = String(d.email || '').trim().toLowerCase();
  if (!okEmail(email)) return { ok: false, error: 'Email chưa đúng.' };
  if (!await webUser(x, email)) return { ok: false, error: 'Email này chưa được cấp quyền sửa website. Nhờ anh Sơn bật "Sửa website" cho bạn ở CRM → Cài đặt → Nhân sự.' };
  if (!await cmsToken(x)) return { ok: false, error: NO_TOKEN };
  const rk = 'rl_' + email, n = Number(await kvGet(x.db, rk) || 0);
  if (n >= 5) return { ok: false, error: 'Bạn đã xin mã quá nhiều lần. Vui lòng đợi 15 phút rồi thử lại.' };
  await kvSet(x.db, rk, String(n + 1), 900e3);
  const b = new Uint32Array(1); crypto.getRandomValues(b); const code = String(b[0] % 900000 + 100000);
  await kvSet(x.db, 'cotp_' + email, JSON.stringify({ c: code, t: 0 }), 600e3);
  x.later(sendMail(x.env, { to: email, name: 'Website Thực Dưỡng Lành', subject: code + ' là mã đăng nhập trang quản trị website Thực Dưỡng Lành',
    body: 'Mã đăng nhập trang quản trị website của bạn: ' + code + '\n\nMã dùng được trong 10 phút. Không đưa mã này cho người khác.\nNếu bạn không yêu cầu đăng nhập, hãy bỏ qua email này.\n\n' + ADMIN_URL }).catch(e => console.error('mail', e.message)));
  return { ok: true };
}
async function cmsVerify(x, d) {
  const email = String(d.email || '').trim().toLowerCase(), code = String(d.code || '').replace(/\D/g, ''), key = 'cotp_' + email;
  const raw = await kvGet(x.db, key); if (!raw) return { ok: false, error: 'Mã đã hết hạn. Bấm "Gửi lại mã".' };
  const o = JSON.parse(raw);
  if (o.c !== code) {
    o.t++;
    if (o.t >= 5) { await kvDel(x.db, key); return { ok: false, error: 'Nhập sai quá 5 lần. Bấm "Gửi lại mã" để lấy mã mới.' }; }
    await kvSet(x.db, key, JSON.stringify(o), 600e3);
    return { ok: false, error: 'Mã chưa đúng, bạn kiểm tra lại email nhé.' };
  }
  await kvDel(x.db, key);
  const u = await webUser(x, email); if (!u) return { ok: false, error: 'Tài khoản đã bị khoá hoặc tắt quyền sửa website.' };
  if (!await cmsToken(x)) return { ok: false, error: NO_TOKEN };
  const token = randHex(32);
  await kvSet(x.db, 'cms_' + token, email, SESSION_DAYS * DAY);
  await crmLog(x, u, 'Website', '-', '', 'Đăng nhập trang quản trị', '');
  return { ok: true, token, name: u.name };
}

/* ---------- cổng trung gian GitHub */
const seen = new Map(); // mã phiên → { u, t }: đỡ hỏi D1 mỗi lượt (Sveltia gọi nhiều lượt liền nhau)
async function sessionUser(x, token) {
  const c = seen.get(token); if (c && Date.now() - c.t < 60e3) return c.u;
  const email = await kvGet(x.db, 'cms_' + token), u = email ? await webUser(x, email) : null;
  if (!u && email) await kvDel(x.db, 'cms_' + token); // bị khoá / tắt quyền → đăng xuất luôn
  if (u) { if (seen.size > 200) seen.clear(); seen.set(token, { u, t: Date.now() }); }
  return u;
}
function cors(req) {
  const o = req.headers.get('Origin') || '';
  return SITE.test(o) ? { 'Access-Control-Allow-Origin': o, Vary: 'Origin', 'Access-Control-Expose-Headers': 'ETag, Link, Location, Retry-After, X-RateLimit-Limit, X-RateLimit-Remaining, X-RateLimit-Reset, X-GitHub-Request-Id' } : {};
}
function jres(req, o, status) { return new Response(JSON.stringify(o), { status: status || 200, headers: Object.assign({ 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' }, cors(req)) }); }

async function ghProxy(x, req, sub) {
  const auth = String(req.headers.get('Authorization') || '').replace(/^(token|bearer)\s+/i, '').trim();
  const url = new URL(req.url), gql = sub === '/graphql', target = GH + (gql ? '/graphql' : sub) + url.search;
  const h = { Accept: req.headers.get('Accept') || 'application/vnd.github+json', 'User-Agent': 'thucduonglanh-cms', 'X-GitHub-Api-Version': '2022-11-28' };
  ['Content-Type', 'If-None-Match', 'If-Modified-Since'].forEach(k => { const v = req.headers.get(k); if (v) h[k] = v; });
  let body = ['GET', 'HEAD'].includes(req.method) ? undefined : await req.arrayBuffer(), u = null, logAs = '';
  {
    u = /^[a-f0-9]{64}$/.test(auth) ? await sessionUser(x, auth) : null;
    if (!u) return jres(req, { message: 'Bad credentials', documentation_url: ADMIN_URL }, 401); // Sveltia hiểu 401 = đăng nhập lại
    const t = await cmsToken(x); if (!t) return jres(req, { message: 'Trang quản trị chưa được kết nối GitHub (CRM → Cài đặt → Trang quản trị website).' }, 503);
    h.Authorization = 'Bearer ' + t;
    if (!gql) {
      if (sub === '/user') return jres(req, { login: u.email.split('@')[0], id: 0, name: u.name, email: u.email, avatar_url: '', html_url: 'https://crm.thucduonglanh.vn', type: 'User' });
      if (!(sub.toLowerCase() === '/repos/' + REPO || sub.toLowerCase().startsWith('/repos/' + REPO + '/') || sub === '/rate_limit')) return jres(req, { message: 'Chỉ được truy cập repo website.' }, 403);
    } else if (body) {
      let q = null; try { q = JSON.parse(new TextDecoder().decode(body)); } catch (e) { return jres(req, { message: 'Bad request' }, 400); }
      const inp = q && q.variables && q.variables.input, br = inp && inp.branch;
      if (br && br.repositoryNameWithOwner && String(br.repositoryNameWithOwner).toLowerCase() !== REPO) return jres(req, { message: 'Chỉ được ghi vào repo website.' }, 403);
      if (/createCommitOnBranch/.test(q.query || '') && inp && inp.message) { // ghi tên người sửa vào commit + Nhật ký CRM
        const head = String(inp.message.headline || 'Cập nhật website');
        inp.message.headline = head + ' · ' + u.name;
        inp.message.body = 'Sửa qua trang quản trị bởi ' + u.name + ' <' + u.email + '>';
        body = JSON.stringify(q); h['Content-Type'] = 'application/json';
        logAs = head.slice(0, 200);
      }
    }
  }
  const r = await fetch(target, { method: req.method, headers: h, body });
  const out = new Headers(cors(req));
  ['Content-Type', 'ETag', 'Link', 'Location', 'Retry-After', 'X-RateLimit-Limit', 'X-RateLimit-Remaining', 'X-RateLimit-Reset', 'X-GitHub-Request-Id', 'Last-Modified'].forEach(k => { const v = r.headers.get(k); if (v) out.set(k, v); });
  out.set('Cache-Control', 'no-store');
  if (u && r.status === 401) return jres(req, { message: 'Mã GitHub của công ty đã hết hạn hoặc bị thu hồi. Nhờ anh Sơn tạo mã mới ở CRM → Cài đặt → Trang quản trị website.' }, 503); // không để Sveltia tưởng nhân sự sai mã
  if (logAs) { // Nhật ký CRM chỉ ghi khi GitHub lưu được
    const txt = await r.text(); let okc = false; try { okc = !!JSON.parse(txt).data.createCommitOnBranch.commit; } catch (e) { }
    if (okc) x.later(crmLog(x, u, 'Website', '-', '', logAs, ''));
    return new Response(txt, { status: r.status, headers: out });
  }
  return new Response(r.body, { status: r.status, headers: out });
}

/** Xử lý các đường dẫn /cms/* và /gh/*; trả null nếu không thuộc phần này. */
export async function cmsRoute(x, req, path) {
  if (path.startsWith('/gh/api/')) {
    if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: Object.assign(cors(req), { 'Access-Control-Allow-Methods': 'GET, HEAD, POST, PUT, PATCH, DELETE', 'Access-Control-Allow-Headers': req.headers.get('Access-Control-Request-Headers') || 'Authorization, Content-Type, Accept', 'Access-Control-Max-Age': '86400' }) });
    const sub = path === '/gh/api/graphql' ? '/graphql' : path.startsWith('/gh/api/v3/') ? path.slice('/gh/api/v3'.length) : null;
    if (!sub) return jres(req, { message: 'Not Found' }, 404);
    return ghProxy(x, req, sub);
  }
  if (path === '/cms/auth' && req.method === 'GET') return new Response(AUTH_PAGE, { headers: { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store', 'X-Frame-Options': 'DENY', 'Referrer-Policy': 'no-referrer' } });
  if ((path === '/cms/login' || path === '/cms/verify') && req.method === 'POST') {
    let d = {}; try { d = JSON.parse(await req.text() || '{}'); } catch (e) { }
    const o = path === '/cms/login' ? await cmsLogin(x, d) : await cmsVerify(x, d);
    return new Response(JSON.stringify(o), { headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' } });
  }
  return null;
}

// Cửa sổ đăng nhập. Giao thức Sveltia/Decap: trang gửi "authorizing:github" cho /admin, /admin gửi lại, rồi trang gửi
// "authorization:github:success:{token}" đúng về nguồn /admin vừa trả lời (chỉ nhận nguồn thucduonglanh.vn).
const AUTH_PAGE = `<!doctype html><html lang="vi"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Đăng nhập quản trị website</title><meta name="robots" content="noindex">
<style>
:root{--g:#2f6b3a;--line:#d9e2d6;--mut:#667;--bg:#f6f8f4}
*{box-sizing:border-box}body{margin:0;background:var(--bg);font:16px/1.5 system-ui,-apple-system,Segoe UI,Roboto,sans-serif;color:#1d2a1f;display:flex;min-height:100vh;align-items:center;justify-content:center;padding:16px}
.card{background:#fff;border:1px solid var(--line);border-radius:14px;padding:24px;max-width:380px;width:100%}
h1{font-size:19px;margin:0 0 4px}p{margin:0 0 14px;color:var(--mut);font-size:14px}
label{display:block;font-size:14px;font-weight:600;margin:0 0 6px}
input{width:100%;font:inherit;padding:11px 12px;border:1px solid var(--line);border-radius:10px;margin-bottom:12px}
input:focus{outline:2px solid var(--g);border-color:var(--g)}
button{width:100%;font:inherit;font-weight:600;padding:11px;border:0;border-radius:10px;background:var(--g);color:#fff;cursor:pointer}
button[disabled]{opacity:.6}.link{background:none;color:var(--g);padding:8px;font-weight:500}
.err{color:#b42318;font-size:14px;min-height:20px;margin-bottom:8px}.ok{color:var(--g);font-weight:600}
</style></head><body><div class="card">
<h1>🌿 Quản trị website</h1><p>Thực Dưỡng Lành · đăng nhập bằng email công việc (giống CRM)</p>
<div id="s1"><label for="em">Email</label><input id="em" type="email" autocomplete="email" placeholder="ban@gmail.com"><div class="err" id="e1"></div><button id="b1">Gửi mã về email</button></div>
<div id="s2" hidden><p id="sent"></p><label for="cd">Mã 6 số trong email</label><input id="cd" inputmode="numeric" autocomplete="one-time-code" maxlength="6" placeholder="••••••"><div class="err" id="e2"></div><button id="b2">Đăng nhập</button><button class="link" id="back">← Đổi email / gửi lại mã</button></div>
<div id="s3" hidden><p class="ok" id="done"></p><p>Cửa sổ này sẽ tự đóng.</p></div>
</div><script>
(function(){
var OK=/^https:\\/\\/((www\\.)?thucduonglanh\\.vn|[a-z0-9-]+\\.thucduonglanh\\.pages\\.dev)$|^http:\\/\\/(localhost|127\\.0\\.0\\.1)(:\\d+)?$/;
var op=window.opener,target=null,pend=null,$=function(i){return document.getElementById(i)};
function send(){if(!pend||!target||!op)return;op.postMessage('authorization:github:success:'+JSON.stringify({token:pend,provider:'github'}),target);setTimeout(function(){window.close()},800)}
window.addEventListener('message',function(e){if(e.source===op&&e.data==='authorizing:github'&&OK.test(e.origin)){target=e.origin;send()}});
if(op)op.postMessage('authorizing:github','*');else{$('e1').textContent='Hãy mở trang này bằng nút Đăng nhập ở thucduonglanh.vn/admin.'}
try{$('em').value=localStorage.getItem('cms_email')||''}catch(e){}
function post(p,d){return fetch(p,{method:'POST',headers:{'Content-Type':'text/plain;charset=utf-8'},body:JSON.stringify(d)}).then(function(r){return r.json()})}
var email='';
$('b1').onclick=function(){var b=this;email=$('em').value.trim().toLowerCase();$('e1').textContent='';if(!email){$('e1').textContent='Nhập email của bạn.';return}
b.disabled=true;b.textContent='Đang gửi…';post('/cms/login',{email:email}).then(function(j){b.disabled=false;b.textContent='Gửi mã về email';
if(!j.ok){$('e1').textContent=j.error||'Lỗi, thử lại.';return}try{localStorage.setItem('cms_email',email)}catch(e){}
$('sent').textContent='Đã gửi mã tới '+email+'. Mở email (xem cả mục Spam/Quảng cáo) rồi nhập mã.';$('s1').hidden=true;$('s2').hidden=false;$('cd').focus()},
function(){b.disabled=false;b.textContent='Gửi mã về email';$('e1').textContent='Mất kết nối, thử lại.'})};
$('em').onkeydown=function(e){if(e.key==='Enter')$('b1').click()};
$('cd').onkeydown=function(e){if(e.key==='Enter')$('b2').click()};
$('back').onclick=function(){$('s2').hidden=true;$('s1').hidden=false;$('e2').textContent=''};
$('b2').onclick=function(){var b=this;$('e2').textContent='';b.disabled=true;b.textContent='Đang kiểm tra…';
post('/cms/verify',{email:email,code:$('cd').value}).then(function(j){b.disabled=false;b.textContent='Đăng nhập';
if(!j.ok){$('e2').textContent=j.error||'Lỗi, thử lại.';return}
pend=j.token;$('done').textContent='✅ Xin chào '+(j.name||'')+'! Đã đăng nhập.';$('s2').hidden=true;$('s3').hidden=false;
if(op)op.postMessage('authorizing:github','*');send()},
function(){b.disabled=false;b.textContent='Đăng nhập';$('e2').textContent='Mất kết nối, thử lại.'})};
})();
</script></body></html>`;
