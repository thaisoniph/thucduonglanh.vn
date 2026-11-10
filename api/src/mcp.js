/* ================================================================ 🔌 Cổng MCP: hỏi số liệu CRM từ ChatGPT / Gemini / Claude (06/11/2026, anh Sơn: "dùng ChatGPT hay Gemini chế độ voice kết nối CRM để hỏi dữ liệu")
 * MCP (Model Context Protocol) là chuẩn chung để các trợ lý AI gọi công cụ bên ngoài. Địa chỉ: https://api.thucduonglanh.vn/mcp
 * - Kiểu Streamable HTTP không giữ phiên: POST JSON-RPC → trả JSON. GET / DELETE → 405 (không mở luồng SSE).
 * - Đăng nhập OAuth 2.1 (mã PKCE S256) bằng chính mã email của CRM: /oauth/authorize hiện trang nhập email → mã gửi về email → bấm Cho phép.
 *   Chỉ người askAllowed() (ask.js; tạm thời anh Sơn + anh Hiếu) kết nối được. Mỗi lần gọi đều kiểm tra lại (bị khoá / bỏ quyền là hết dùng ngay).
 *   Đăng ký ứng dụng: tự động (RFC 7591 /oauth/register), client_id là URL (CIMD), hoặc Client ID / Secret tạo trong CRM (lệnh mcp_client) cho app bắt nhập tay.
 *   Chỉ chuyển hướng về ChatGPT / OpenAI, Google (Gemini – trả về oauth-redirect.googleusercontent.com, chỉ đúng tên miền này, 06/11/2026), Claude và máy mình (localhost, để thử) – REDIRECT_OK.
 *   Mã truy cập 30 ngày, mã làm mới 365 ngày (đổi mã mỗi lần làm mới); trong D1 chỉ lưu mã băm SHA-256 (kv oat_ / ort_ / oac_ / ocl_).
 * - Công cụ: hoi_so_lieu (trợ lý số liệu Claude của CRM tự tra và trả lời – chắc nhất), mo_ta_du_lieu + tra_cuu + san_pham_ban (+ tai_chinh cho Quản trị),
 *   insight_noi_dung (10/11/2026: ngân hàng insight + quy trình Insight → Tension → Phễu, gọi trước khi viết nội dung)
 *   để AI bên ngoài tự tra. Tất cả chỉ đọc; dữ liệu khách đã che như ✨ Hỏi số liệu. Giới hạn MCP_DAY_MAX lượt gọi / người / ngày. */
import { esc, kvGet, kvSet, kvJson, run, all, randHex, fmtDate, DAY } from './lib.js';
import { crmUser, crmLogin, crmVerify, crmLog } from './crm.js';
import { askAllowed, askCtx, askTool, askGuide, crmAsk } from './ask.js';
import { insText } from './insight.js';

const AT_DAYS = 30, RT_DAYS = 365, CODE_MS = 10 * 60e3, MCP_DAY_MAX = 400, REG_IP_MAX = 30, SCOPE = 'crm.read';
const REDIRECT_OK = /^https:\/\/([a-z0-9-]+\.)*(chatgpt\.com|openai\.com|google\.com|claude\.ai|claude\.com|anthropic\.com)(\/|$)|^https:\/\/oauth-redirect\.googleusercontent\.com\/|^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?\//i;
const NAME = 'CRM Thực Dưỡng Lành';
const PROTO = ['2024-11-05', '2025-03-26', '2025-06-18', '2025-11-25'];
const INSTR = 'Máy chủ số liệu CRM của Thực Dưỡng Lành (thực phẩm dinh dưỡng; bán qua sale, website, sàn). Chỉ đọc. Hỏi số liệu kinh doanh (doanh số, đơn, khách, khách hỏi, chăm sóc, nhân viên, quảng cáo, sàn, lãi lỗ…) thì gọi hoi_so_lieu với nguyên câu hỏi tiếng Việt, rồi kể lại cho người dùng. Người dùng có thể đang nói chuyện bằng giọng: trả lời tiếng Việt, ngắn, số tròn dễ nghe. Muốn tự tra chi tiết thì gọi mo_ta_du_lieu trước rồi dùng tra_cuu. Trước khi viết nội dung (bài web, Zalo, Fanpage, kịch bản video, quảng cáo) cho Thực Dưỡng Lành thì gọi insight_noi_dung để bài dựa trên insight / tension của 1 nhóm khách và đúng tầng phễu. Tên khách chỉ có tên gọi, số điện thoại đã che: đừng cố lấy số đầy đủ.';

/* ---------- tiện ích */
const enc = new TextEncoder();
async function sha(s) { const b = new Uint8Array(await crypto.subtle.digest('SHA-256', enc.encode(String(s)))); return [...b].map(v => v.toString(16).padStart(2, '0')).join(''); }
async function s256(v) { const b = new Uint8Array(await crypto.subtle.digest('SHA-256', enc.encode(String(v)))); let s = ''; b.forEach(c => { s += String.fromCharCode(c); }); return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, ''); }
const CORS = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Methods': 'GET, POST, DELETE, OPTIONS', 'Access-Control-Allow-Headers': 'Authorization, Content-Type, Mcp-Protocol-Version, Mcp-Session-Id, Last-Event-ID', 'Access-Control-Expose-Headers': 'WWW-Authenticate, Mcp-Session-Id', 'Access-Control-Max-Age': '86400' };
function jres(o, status, extra) { return new Response(o == null ? null : JSON.stringify(o), { status: status || 200, headers: Object.assign({ 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' }, CORS, extra || {}) }); }
function oerr(code, desc, status) { return jres({ error: code, error_description: desc }, status || 400); }
const LOGO = 'https://crm.thucduonglanh.vn/logo.webp';

/* ---------- ứng dụng (client) */
async function clientOf(x, cid) {
  cid = String(cid || '');
  if (/^https:\/\/[^\s]{8,400}$/.test(cid)) { // CIMD: client_id là địa chỉ tài liệu mô tả ứng dụng
    const ck = 'ocm_' + (await sha(cid)).slice(0, 32), old = await kvJson(x.db, ck, null); if (old) return old;
    try {
      const r = await fetch(cid, { headers: { Accept: 'application/json' }, signal: AbortSignal.timeout(6000) });
      if (!r.ok) return null;
      const m = await r.json(); if (!m || m.client_id !== cid || !Array.isArray(m.redirect_uris)) return null;
      const c = { n: String(m.client_name || new URL(cid).hostname).slice(0, 80), ru: m.redirect_uris.map(String).slice(0, 20), s: '', cimd: 1 };
      await kvSet(x.db, ck, JSON.stringify(c), DAY); return c;
    } catch (e) { return null; }
  }
  if (!/^tdl_[a-f0-9]{8,40}$/.test(cid)) return null;
  return kvJson(x.db, 'ocl_' + cid, null);
}
const redirectOk = (c, ru) => !!c && REDIRECT_OK.test(String(ru || '')) && (!c.ru || !c.ru.length || c.ru.includes(ru)); // ứng dụng tạo tay trong CRM (ru rỗng): chỉ cần nằm trong REDIRECT_OK

async function register(x, req) {
  let d = {}; try { d = await req.json(); } catch (e) { return oerr('invalid_client_metadata', 'JSON không hợp lệ'); }
  const ru = Array.isArray(d.redirect_uris) ? d.redirect_uris.map(String).slice(0, 10) : [];
  if (!ru.length || ru.some(u => !REDIRECT_OK.test(u))) return console.log('mcp register bị từ chối', JSON.stringify({ ru: d.redirect_uris, ten: d.client_name })), oerr('invalid_redirect_uri', 'Chỉ nhận địa chỉ trả về của ChatGPT, Gemini, Claude.');
  const ik = 'oreg_' + (await sha(x.ip || '-')).slice(0, 16) + '_' + fmtDate(Date.now(), 'yyMMdd'), n = Number(await kvGet(x.db, ik) || 0);
  if (n >= REG_IP_MAX) return oerr('invalid_client_metadata', 'Đăng ký quá nhiều lần hôm nay.', 429);
  await kvSet(x.db, ik, String(n + 1), 2 * DAY);
  const m = ['client_secret_post', 'client_secret_basic'].includes(d.token_endpoint_auth_method) ? d.token_endpoint_auth_method : 'none';
  const id = 'tdl_' + randHex(12), sec = m === 'none' ? '' : randHex(24), now = Date.now();
  await kvSet(x.db, 'ocl_' + id, JSON.stringify({ n: String(d.client_name || 'Ứng dụng AI').slice(0, 80), ru, s: sec ? await sha(sec) : '', m, at: now }), 400 * DAY);
  return jres({ client_id: id, client_id_issued_at: Math.floor(now / 1000), client_name: d.client_name || 'Ứng dụng AI', redirect_uris: ru, grant_types: ['authorization_code', 'refresh_token'], response_types: ['code'], token_endpoint_auth_method: m, scope: SCOPE,
    ...(sec ? { client_secret: sec, client_secret_expires_at: 0 } : {}) }, 201);
}

/* ---------- trang đăng nhập / cho phép (không cần JavaScript, chạy được trong trình duyệt trong app) */
function page(title, body) {
  return new Response('<!doctype html><html lang="vi"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>' + esc(title) + '</title><meta name="robots" content="noindex"><style>' +
    ':root{color-scheme:light}body{margin:0;background:#f5f4ef;color:#1f231b;font:16px/1.5 -apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,Arial,sans-serif}main{max-width:420px;margin:0 auto;padding:32px 16px}' +
    '.card{background:#fff;border:1px solid #e6e3da;border-radius:16px;padding:22px;box-shadow:0 2px 10px rgba(31,50,30,.07)}h1{font-size:21px;margin:0 0 6px}p{margin:0 0 12px}.muted{color:#5f6257;font-size:14px}.err{background:#fdecea;color:#c62828;border-radius:10px;padding:8px 12px}' +
    'label{display:block;font-weight:600;font-size:14px;margin:12px 0 4px}input{width:100%;box-sizing:border-box;min-height:46px;padding:10px 12px;border:1px solid #d8d4c8;border-radius:10px;font-size:17px}' +
    'button{width:100%;min-height:48px;margin-top:16px;border:0;border-radius:12px;background:#1f5f3a;color:#fff;font-size:16px;font-weight:700;cursor:pointer}ul{margin:0 0 12px;padding-left:20px}.logo{display:flex;align-items:center;gap:10px;margin-bottom:16px;font-weight:700;color:#1f5f3a}.logo img{width:36px;height:36px;border-radius:9px}' +
    '</style></head><body><main><div class="logo"><img src="' + LOGO + '" alt="" onerror="this.remove()">' + NAME + '</div><div class="card">' + body + '</div></main></body></html>', { headers: { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store', 'X-Frame-Options': 'DENY', 'Referrer-Policy': 'no-referrer' } });
}
const OP = ['response_type', 'client_id', 'redirect_uri', 'state', 'code_challenge', 'code_challenge_method', 'scope', 'resource'];
const hidden = p => OP.map(k => p[k] ? '<input type="hidden" name="' + k + '" value="' + esc(p[k]) + '">' : '').join('');
function backTo(ru, q) { const u = new URL(ru); Object.keys(q).forEach(k => { if (q[k] != null && q[k] !== '') u.searchParams.set(k, q[k]); }); return Response.redirect(u.toString(), 302); }
function emailStep(p, c, msg, email) {
  return page('Kết nối ' + NAME, '<h1>Kết nối ' + esc(c.n) + ' với CRM</h1><p class="muted">' + esc(c.n) + ' (' + esc(new URL(p.redirect_uri).hostname) + ') xin quyền <b>đọc số liệu</b> CRM Thực Dưỡng Lành để trả lời câu hỏi của bạn. Không sửa, không xoá được gì.</p>' +
    (msg ? '<p class="err">' + esc(msg) + '</p>' : '') + '<form method="post">' + hidden(p) + '<input type="hidden" name="step" value="email"><label for="em">Email đăng nhập CRM</label><input id="em" name="email" type="email" autocomplete="email" required value="' + esc(email || '') + '"><button>Gửi mã vào email</button></form>');
}
function codeStep(p, c, msg, email) {
  return page('Nhập mã', '<h1>Nhập mã trong email</h1><p class="muted">Mã 6 số vừa gửi tới <b>' + esc(email) + '</b> (xem cả thư mục Spam).</p>' + (msg ? '<p class="err">' + esc(msg) + '</p>' : '') +
    '<form method="post">' + hidden(p) + '<input type="hidden" name="step" value="code"><input type="hidden" name="email" value="' + esc(email) + '"><label for="cd">Mã đăng nhập</label><input id="cd" name="code" inputmode="numeric" autocomplete="one-time-code" pattern="[0-9 ]{6,8}" required autofocus>' +
    '<p class="muted" style="margin-top:12px">Bấm nút dưới là bạn cho phép <b>' + esc(c.n) + '</b>:</p><ul class="muted"><li>đọc số liệu kinh doanh trong CRM (tên khách chỉ có tên gọi, số điện thoại bị che)</li><li>không sửa, không xoá được gì</li><li>ngắt lúc nào cũng được: CRM → ✨ Hỏi số liệu → 🔌</li></ul><button>✅ Cho phép kết nối</button></form>');
}
async function authorize(x, req, url) {
  const p = {}; let f = null;
  if (req.method === 'POST') { f = await req.formData(); OP.concat(['step', 'email', 'code']).forEach(k => { p[k] = String(f.get(k) || '').trim(); }); }
  else OP.forEach(k => { p[k] = String(url.searchParams.get(k) || '').trim(); });
  const c = await clientOf(x, p.client_id);
  if (!c) return page('Lỗi', '<h1>Ứng dụng chưa đăng ký</h1><p>Không nhận ra ứng dụng xin kết nối. Bạn thử thêm lại kết nối từ đầu trong ChatGPT / Gemini.</p>');
  if (!redirectOk(c, p.redirect_uri)) return page('Lỗi', '<h1>Địa chỉ trả về không hợp lệ</h1><p>CRM chỉ cho kết nối với ChatGPT, Gemini, Claude.</p>');
  if (p.response_type !== 'code') return backTo(p.redirect_uri, { error: 'unsupported_response_type', state: p.state });
  if (!p.code_challenge || p.code_challenge_method !== 'S256') return backTo(p.redirect_uri, { error: 'invalid_request', error_description: 'PKCE S256 required', state: p.state });
  if (req.method !== 'POST') return emailStep(p, c);
  const email = String(p.email || '').toLowerCase();
  if (p.step === 'email') {
    const lu = await crmUser(x, email);
    if (lu && !askAllowed(lu)) return emailStep(p, c, '✨ Hỏi số liệu đang dùng thử, tài khoản này chưa được kết nối AI.', email);
    const r = await crmLogin(x, { email }); if (!r.ok) return emailStep(p, c, r.error, email);
    return codeStep(p, c, '', email);
  }
  if (p.step !== 'code') return emailStep(p, c);
  const r = await crmVerify(x, { email, code: p.code });
  if (!r.ok) return /hết hạn|quá 5 lần|khoá/.test(r.error || '') ? emailStep(p, c, r.error, email) : codeStep(p, c, r.error, email);
  await run(x.db, 'DELETE FROM sessions WHERE token = ?', r.token); // chỉ dùng mã email để xác minh, không mở phiên CRM
  const u = await crmUser(x, email);
  if (!u || !askAllowed(u)) return emailStep(p, c, '✨ Hỏi số liệu đang dùng thử, tài khoản này chưa được kết nối AI.', email);
  const code = randHex(24);
  await kvSet(x.db, 'oac_' + await sha(code), JSON.stringify({ c: p.client_id, r: p.redirect_uri, cc: p.code_challenge, e: u.email, n: c.n }), CODE_MS);
  try { await crmLog(x, u, 'Kết nối AI', 'mcp', c.n, 'Cho phép đọc số liệu', new URL(p.redirect_uri).hostname); } catch (e) { }
  return backTo(p.redirect_uri, { code, state: p.state, iss: url.origin });
}

/* ---------- đổi mã → mã truy cập */
async function issue(x, e, cid, n) {
  const at = 'tdlat_' + randHex(32), rt = 'tdlrt_' + randHex(32), now = Date.now(), v = JSON.stringify({ e, c: cid, n, at: now });
  await kvSet(x.db, 'oat_' + await sha(at), v, AT_DAYS * DAY);
  await kvSet(x.db, 'ort_' + await sha(rt), v, RT_DAYS * DAY);
  return jres({ access_token: at, token_type: 'Bearer', expires_in: AT_DAYS * 86400, refresh_token: rt, scope: SCOPE });
}
async function token(x, req) {
  const ct = req.headers.get('Content-Type') || '', f = {};
  if (/json/.test(ct)) { try { Object.assign(f, await req.json()); } catch (e) { } } else { const fd = await req.formData(); for (const [k, v] of fd.entries()) f[k] = String(v); }
  const ba = (req.headers.get('Authorization') || '').match(/^Basic\s+(.+)$/i);
  if (ba) { try { const [i, s] = atob(ba[1]).split(':'); f.client_id = f.client_id || decodeURIComponent(i); f.client_secret = f.client_secret || decodeURIComponent(s || ''); } catch (e) { } }
  const c = await clientOf(x, f.client_id);
  if (!c) return oerr('invalid_client', 'Không nhận ra ứng dụng.', 401);
  if (c.s && (!f.client_secret || await sha(f.client_secret) !== c.s)) return oerr('invalid_client', 'Sai client_secret.', 401);
  if (f.grant_type === 'authorization_code') {
    const k = 'oac_' + await sha(f.code || ''), o = await kvJson(x.db, k, null);
    if (!o) return oerr('invalid_grant', 'Mã đã dùng hoặc hết hạn.');
    await run(x.db, 'DELETE FROM kv WHERE k = ?', k); // mỗi mã dùng 1 lần
    if (o.c !== f.client_id || o.r !== f.redirect_uri) return oerr('invalid_grant', 'Mã không khớp ứng dụng.');
    if (!f.code_verifier || await s256(f.code_verifier) !== o.cc) return oerr('invalid_grant', 'PKCE không khớp.');
    return issue(x, o.e, f.client_id, o.n);
  }
  if (f.grant_type === 'refresh_token') {
    const k = 'ort_' + await sha(f.refresh_token || ''), o = await kvJson(x.db, k, null);
    if (!o || o.c !== f.client_id) return oerr('invalid_grant', 'Mã làm mới không hợp lệ.');
    await run(x.db, 'DELETE FROM kv WHERE k = ?', k); // đổi mã mỗi lần làm mới
    const u = await crmUser(x, o.e); if (!u || !askAllowed(u)) return oerr('invalid_grant', 'Tài khoản không còn quyền.');
    return issue(x, o.e, o.c, o.n);
  }
  return oerr('unsupported_grant_type', 'Chỉ nhận authorization_code, refresh_token.');
}

/* ---------- MCP */
function unauth(url, why) {
  return jres({ jsonrpc: '2.0', error: { code: -32001, message: 'Cần đăng nhập CRM (OAuth).' }, id: null }, 401,
    { 'WWW-Authenticate': 'Bearer resource_metadata="' + url.origin + '/.well-known/oauth-protected-resource"' + (why ? ', error="invalid_token", error_description="' + why + '"' : '') });
}
const RO = { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false };
function toolList(u) {
  const T = [
    { name: 'hoi_so_lieu', title: 'Hỏi số liệu CRM', annotations: Object.assign({ title: 'Hỏi số liệu CRM' }, RO),
      description: 'Hỏi bất kỳ số liệu kinh doanh nào của Thực Dưỡng Lành bằng tiếng Việt (doanh số, doanh thu, đơn hàng, hoàn / huỷ, khách mới / cũ, khách hỏi và tỷ lệ chốt, chăm sóc khách, từng nhân viên, sản phẩm bán chạy, quảng cáo, sàn, mục tiêu' + (u.level >= 3 ? ', lãi lỗ, tiền ngân hàng, công nợ' : '') + '). Trợ lý số liệu của CRM tự tra cơ sở dữ liệu theo đúng cách tính của CRM rồi trả lời ngắn gọn. Cách nhanh và chắc nhất: gửi nguyên câu hỏi, nói rõ kỳ nếu có. Mất khoảng 10–40 giây.',
      inputSchema: { type: 'object', properties: { cau_hoi: { type: 'string', description: 'Câu hỏi tiếng Việt, vd "Doanh số tuần này so với tuần trước, chia theo nhân viên?"' } }, required: ['cau_hoi'], additionalProperties: false } },
    { name: 'mo_ta_du_lieu', title: 'Bảng và cách tính', annotations: Object.assign({ title: 'Bảng và cách tính' }, RO),
      description: 'Trả về cách tính chuẩn của CRM (doanh số, doanh thu, tỷ lệ hoàn, tỷ lệ chốt…), danh sách bảng / cột được đọc và các mốc thời gian (mili giây) của hôm nay, tuần, tháng. Gọi trước khi tự viết câu tra bằng tra_cuu.',
      inputSchema: { type: 'object', properties: {}, additionalProperties: false } },
    { name: 'tra_cuu', title: 'Tra số bằng SQL', annotations: Object.assign({ title: 'Tra số bằng SQL' }, RO),
      description: 'Chạy 1 câu SELECT (SQLite, chỉ đọc) trên cơ sở dữ liệu CRM, tối đa 300 dòng. Gọi mo_ta_du_lieu trước để biết bảng, cột và cách tính. Lỗi thì đọc thông báo, sửa câu và thử lại.',
      inputSchema: { type: 'object', properties: { muc_dich: { type: 'string', description: 'Việc đang tra, vd "Doanh số tháng 11 theo nhân viên"' }, sql: { type: 'string', description: 'Câu SELECT hoặc WITH … SELECT, không có dấu chấm phẩy' } }, required: ['sql'], additionalProperties: false } },
    { name: 'san_pham_ban', title: 'Sản phẩm bán ra', annotations: Object.assign({ title: 'Sản phẩm bán ra' }, RO),
      description: 'Số lượng và tiền từng sản phẩm bán ra (đơn văn phòng + web, đã trừ huỷ / hoàn) trong kỳ, kèm quà tặng.',
      inputSchema: { type: 'object', properties: { tu_ngay: { type: 'string', description: 'yyyy-mm-dd (giờ Việt Nam)' }, den_ngay: { type: 'string', description: 'yyyy-mm-dd, tính cả ngày này' }, nguoi_ban: { type: 'string', description: 'Tên nhân viên; bỏ trống = cả công ty' } }, required: ['tu_ngay', 'den_ngay'], additionalProperties: false } },
    { name: 'insight_noi_dung', title: 'Insight khách hàng & quy trình nội dung', annotations: Object.assign({ title: 'Insight khách hàng & quy trình nội dung' }, RO),
      description: 'Ngân hàng insight của Thực Dưỡng Lành (nhóm khách mục tiêu, mong muốn, rào cản, tension) + quy trình Insight → Tension → Phễu TOFU / MOFU / BOFU. GỌI TRƯỚC khi viết bất kỳ nội dung nào (bài web, bài nhóm Zalo, Fanpage, kịch bản video, quảng cáo) để bài nhắm đúng 1 nhóm khách và 1 tension.',
      inputSchema: { type: 'object', properties: {}, additionalProperties: false } }
  ];
  if (u.level >= 3) T.push({ name: 'tai_chinh', title: 'Số kế toán, lãi lỗ', annotations: Object.assign({ title: 'Số kế toán, lãi lỗ' }, RO),
    description: 'Số kế toán đã nối vào CRM: lãi lỗ ước tính hôm qua / từ đầu tháng, điểm hoà vốn, tiền ngân hàng, nợ nhà cung cấp, khoản chi lớn, số kế toán 6 tháng gần nhất.',
    inputSchema: { type: 'object', properties: {}, additionalProperties: false } });
  return T;
}
const txt = (t, isErr) => ({ content: [{ type: 'text', text: String(t) }], ...(isErr ? { isError: true } : {}) });
async function callTool(x, u, name, a) {
  a = a && typeof a === 'object' ? a : {};
  const dk = 'mcp_n_' + u.email + '_' + fmtDate(Date.now(), 'yyMMdd'), n = Number(await kvGet(x.db, dk) || 0);
  if (n >= MCP_DAY_MAX) return txt('Hôm nay đã gọi ' + MCP_DAY_MAX + ' lần, mai dùng tiếp nhé.', true);
  await kvSet(x.db, dk, String(n + 1), 2 * DAY);
  if (name === 'hoi_so_lieu') {
    const r = await crmAsk(x, u, { q: a.cau_hoi, fast: 1, voice: 1 });
    return r.ok ? txt(r.text + '\n\n(Nguồn: CRM Thực Dưỡng Lành. Số do trợ lý tự tra, tên khách đã che.)') : txt(r.error || 'Chưa trả lời được.', true);
  }
  if (name === 'insight_noi_dung') return txt(await insText(x));
  const ctx = await askCtx(x, u);
  if (name === 'mo_ta_du_lieu') return txt(askGuide(ctx));
  if (!['tra_cuu', 'san_pham_ban', 'tai_chinh'].includes(name) || (name === 'tai_chinh' && u.level < 3)) return txt('Không có công cụ ' + name, true);
  const out = await askTool(x, ctx, name, { muc_dich: '', nguoi_ban: '', ...a });
  return txt(JSON.stringify(out), !!out.error);
}
async function rpc(x, u, m) {
  const id = m.id, ok = result => ({ jsonrpc: '2.0', id, result }), bad = (code, message) => ({ jsonrpc: '2.0', id, error: { code, message } });
  if (!m || m.jsonrpc !== '2.0' || typeof m.method !== 'string') return bad(-32600, 'Invalid Request');
  const p = m.params || {};
  switch (m.method) {
    case 'initialize': {
      const want = String(p.protocolVersion || ''), v = PROTO.includes(want) || want > PROTO[PROTO.length - 1] ? want : PROTO[PROTO.length - 1];
      return ok({ protocolVersion: v, capabilities: { tools: { listChanged: false } }, serverInfo: { name: 'thucduonglanh-crm', title: NAME, version: '1.0.0' }, instructions: INSTR });
    }
    case 'ping': return ok({});
    case 'tools/list': return ok({ tools: toolList(u) });
    case 'tools/call': {
      try { return ok(await callTool(x, u, String(p.name || ''), p.arguments)); } catch (e) { console.error('mcp call', e && e.message); return ok(txt('Lỗi máy chủ: ' + String(e && e.message || e).slice(0, 200), true)); }
    }
    case 'resources/list': return ok({ resources: [] });
    case 'resources/templates/list': return ok({ resourceTemplates: [] });
    case 'prompts/list': return ok({ prompts: [] });
    default: return bad(-32601, 'Method not found: ' + m.method);
  }
}
async function mcp(x, req, url) {
  if (req.method !== 'POST') return jres({ jsonrpc: '2.0', error: { code: -32000, message: 'Chỉ nhận POST (Streamable HTTP, không mở luồng SSE).' }, id: null }, 405, { Allow: 'POST' });
  const m = (req.headers.get('Authorization') || '').match(/^Bearer\s+(\S+)$/i);
  if (!m) return unauth(url);
  const o = await kvJson(x.db, 'oat_' + await sha(m[1]), null);
  if (!o) return unauth(url, 'token expired or revoked');
  const u = await crmUser(x, o.e);
  if (!u || !askAllowed(u)) return unauth(url, 'account no longer allowed');
  let body; try { body = JSON.parse(await req.text() || 'null'); } catch (e) { return jres({ jsonrpc: '2.0', error: { code: -32700, message: 'Parse error' }, id: null }, 400); }
  const list = Array.isArray(body) ? body : [body], out = [];
  for (const msg of list) { if (msg && msg.method && msg.id === undefined) continue; if (msg && !msg.method && (msg.result !== undefined || msg.error !== undefined)) continue; out.push(await rpc(x, u, msg)); } // bỏ qua thông báo / câu trả lời của máy khách
  if (!out.length) return new Response(null, { status: 202, headers: CORS });
  return jres(Array.isArray(body) ? out : out[0]);
}

/** Đường dẫn của cổng MCP + OAuth. Không phải đường của mình → null. */
export async function mcpRoute(x, req, path, url) {
  const meta = path.startsWith('/.well-known/oauth-') || path === '/.well-known/openid-configuration';
  if (!(meta || path === '/mcp' || path.startsWith('/oauth/'))) return null;
  if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: CORS });
  const o = url.origin;
  if (path === '/.well-known/oauth-protected-resource' || path === '/.well-known/oauth-protected-resource/mcp')
    return jres({ resource: o + '/mcp', resource_name: NAME, authorization_servers: [o], bearer_methods_supported: ['header'], scopes_supported: [SCOPE] });
  if (path === '/.well-known/oauth-authorization-server' || path === '/.well-known/oauth-authorization-server/mcp' || path === '/.well-known/openid-configuration')
    return jres({ issuer: o, authorization_endpoint: o + '/oauth/authorize', token_endpoint: o + '/oauth/token', registration_endpoint: o + '/oauth/register', scopes_supported: [SCOPE],
      response_types_supported: ['code'], response_modes_supported: ['query'], grant_types_supported: ['authorization_code', 'refresh_token'], code_challenge_methods_supported: ['S256'],
      token_endpoint_auth_methods_supported: ['none', 'client_secret_post', 'client_secret_basic'], client_id_metadata_document_supported: true, authorization_response_iss_parameter_supported: true });
  if (meta) return jres({ error: 'not_found' }, 404);
  if (path === '/oauth/register' && req.method === 'POST') return register(x, req);
  if (path === '/oauth/authorize' && (req.method === 'GET' || req.method === 'POST')) return authorize(x, req, url);
  if (path === '/oauth/token' && req.method === 'POST') return token(x, req);
  if (path === '/mcp') return mcp(x, req, url);
  return jres({ error: 'not_found' }, 404);
}

/** Lệnh CRM (người askAllowed): mcp_list = các kết nối đang mở · mcp_client = tạo Client ID / Secret cho app bắt nhập tay · mcp_off = ngắt mọi kết nối của mình. */
export async function crmMcp(x, u, d) {
  if (!askAllowed(u)) return { ok: false, error: 'Chức năng đang dùng thử, tài khoản này chưa dùng được.' };
  const a = d.action;
  if (a === 'mcp_list') {
    const rows = await all(x.db, "SELECT v, exp FROM kv WHERE k LIKE 'ort\\_%' ESCAPE '\\' AND CASE WHEN json_valid(v) THEN json_extract(v, '$.e') END = ? AND (exp IS NULL OR exp > ?)", u.email, Date.now());
    const by = {}; rows.forEach(r => { try { const o = JSON.parse(r.v), k = o.n || 'Ứng dụng AI'; if (!by[k] || by[k].at < o.at) by[k] = { name: k, at: o.at }; } catch (e) { } });
    return { ok: true, url: 'https://api.thucduonglanh.vn/mcp', list: Object.values(by).sort((p, q) => q.at - p.at) };
  }
  if (a === 'mcp_client') {
    const id = 'tdl_' + randHex(12), sec = randHex(24), name = String(d.name || 'Ứng dụng AI').slice(0, 60);
    await kvSet(x.db, 'ocl_' + id, JSON.stringify({ n: name, ru: [], s: await sha(sec), m: 'client_secret_post', at: Date.now(), by: u.email }), 400 * DAY);
    await crmLog(x, u, 'Kết nối AI', 'mcp', name, 'Tạo Client ID', id);
    return { ok: true, client_id: id, client_secret: sec };
  }
  if (a === 'mcp_off') {
    let n = 0;
    for (const p of ['oat\\_%', 'ort\\_%']) n += (await run(x.db, "DELETE FROM kv WHERE k LIKE ? ESCAPE '\\' AND CASE WHEN json_valid(v) THEN json_extract(v, '$.e') END = ?", p, u.email)).meta.changes || 0;
    await crmLog(x, u, 'Kết nối AI', 'mcp', '', 'Ngắt mọi kết nối', '');
    return { ok: true, n };
  }
  return { ok: false, error: 'Không rõ thao tác: ' + a };
}
