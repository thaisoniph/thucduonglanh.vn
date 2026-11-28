// 💬 Thử app Messenger riêng (fp_app2, fp_pages.token2) của api/src/fb.js trên máy: node scripts/test-fbapp2.mjs
// D1 giả bằng node:sqlite, Facebook giả bằng fetch. Không gọi dịch vụ thật.
import { DatabaseSync } from 'node:sqlite';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';
const ROOT = fileURLToPath(new URL('..', import.meta.url)).replace(/\/$/, '');
const raw = new DatabaseSync(':memory:');
raw.exec(readFileSync(ROOT + '/api/schema.sql', 'utf8'));
const DB = { prepare(sql) { const st = raw.prepare(sql); let a = []; const o = { bind(...x) { a = x.map(v => v === undefined ? null : typeof v === 'boolean' ? (v ? 1 : 0) : v); return o; },
  async all() { return { results: st.all(...a) }; }, async first() { return st.get(...a) || null; }, async run() { const r = st.run(...a); return { meta: { changes: r.changes } }; } }; return o; } };
const S1 = 'a'.repeat(32), S2 = 'b'.repeat(32);
const calls = [];
globalThis.fetch = async (url, init) => {
  const u = String(url); calls.push({ u, body: init && init.body });
  if (u.includes('debug_token')) return new Response(JSON.stringify({ data: { is_valid: true, app_id: '222', type: 'PAGE', profile_id: '111', scopes: ['pages_messaging'] } }));
  return new Response(JSON.stringify({ success: true }));
};
const later = [];
const x = { env: { DB, FB_GRAPH: 'https://fb.test/' }, db: DB, later: p => later.push(p) };
const FB = await import('file://' + ROOT + '/api/src/fb.js');
await FB.fbSchema(DB); await (await import('file://' + ROOT + '/api/src/zbot.js')).zbotSchema(DB);
raw.exec("INSERT INTO fp_pages (id, name, token, active) VALUES ('111', 'Thực Dưỡng Lành', 'TOK1', 1)");
raw.prepare("INSERT INTO kv (k, v) VALUES ('fp_app', ?)").run(JSON.stringify({ id: '999', secret: S1, verify: 'v' }));
const admin = { level: 3, name: 'QT' }, log = async () => { };

// lưu app 2 + dán mã trang
assert.equal((await FB.crmFp(x, admin, { action: 'fp_app2', appId: '999', secret: S2 }, log)).ok, false); // trùng app chính
assert.equal((await FB.crmFp(x, admin, { action: 'fp_app2', appId: '222', secret: S2 }, log)).ok, true);
const r = await FB.crmFp(x, admin, { action: 'fp_ptoken2', ptk: 'T'.repeat(50) }, log);
assert.equal(r.ok, true); assert.equal(r.name, 'Thực Dưỡng Lành');
assert.ok(calls.some(c => c.u.includes('111/subscribed_apps') && c.u.includes('TTTT')), 'đăng ký nhận tin qua app 2');
const v = await FB.crmFp(x, admin, { action: 'fp_view' }, log);
assert.equal(v.app2.id, '222'); assert.equal(v.app2.secret, true); assert.equal(v.pages[0].t2, 1); assert.ok(!('token2' in v.pages[0]));

const post = async (secret, body) => { const b = JSON.stringify(body), sig = 'sha256=' + createHmac('sha256', secret).update(b).digest('hex');
  const res = await FB.fbRoute(x, new Request('https://api/fb/hook', { method: 'POST', body: b, headers: { 'X-Hub-Signature-256': sig } }), '/fb/hook', new URL('https://api/fb/hook'));
  await Promise.all(later.splice(0)); return res.status; };
const echo = (app_id, psid) => ({ object: 'page', entry: [{ id: '111', messaging: [{ sender: { id: '111' }, recipient: { id: psid }, message: { is_echo: true, app_id, mid: 'm' + psid } }] }] });
const paused = psid => !!raw.prepare('SELECT pause FROM fp_users WHERE psid = ?').get(psid);

assert.equal(await post('c'.repeat(32), echo(0, 'p0')), 403); // chữ ký lạ
assert.equal(await post(S1, echo(0, 'p1')), 200); assert.equal(paused('p1'), false, 'có app 2: tin nhắn từ app chính bị bỏ qua');
assert.equal(await post(S2, echo(222, 'p2')), 200); assert.equal(paused('p2'), false, 'tin của bot (app 2) không làm bot nhường');
assert.equal(await post(S2, echo(0, 'p3')), 200); assert.equal(paused('p3'), true, 'nhân sự nhắn tay → bot nhường');

// gỡ app 2 → tin nhắn quay về app chính
assert.equal((await FB.crmFp(x, admin, { action: 'fp_app2', off: 1 }, log)).ok, true);
assert.equal(await post(S2, echo(0, 'p4')), 403);
assert.equal(await post(S1, echo(0, 'p5')), 200); assert.equal(paused('p5'), true);
console.log('✅ test-fbapp2: OK');
