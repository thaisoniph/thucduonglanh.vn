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

// 📣 ưu đãi đang chạy (kv mkt_offers) → lời dặn trợ lý
await (await import('file://' + ROOT + '/api/src/mkcamp.js')).mkCampSchema(DB);
const T = Date.now(), dd = t => new Date(t + 7 * 3600e3).toISOString().slice(0, 10);
raw.prepare("INSERT INTO kv (k, v) VALUES ('mkt_offers', ?)").run(JSON.stringify([
  { id: 'a', title: 'Combo 2 hộp 799k', text: '2 hộp VitaGreen 500g 799.000đ\ntặng bình lắc', bot: true, until: dd(T + 864e5) },
  { id: 'b', title: 'QC để lại SĐT', text: '1 hộp 450.000đ', bot: true, camps: [{ id: '501', n: 'cũ' }] },
  { id: 'e', title: 'Trang khác', text: 'quà riêng trang 777', bot: true, pages: ['777'] },
  { id: 'c', title: 'Khách thân thiết', text: 'giảm 10%', bot: false },
  { id: 'd', title: 'Hết hạn', text: 'x', bot: true, until: dd(T - 2 * 864e5) }]));
const pg = { id: '111' };
let pr = await FB.promosFor(x, pg, 'k1', T);
assert.ok(pr.txt.includes('Combo 2 hộp 799k') && pr.txt.includes('799.000đ; tặng bình lắc'));
assert.ok(!pr.txt.includes('450.000') && !pr.txt.includes('giảm 10%') && !pr.txt.includes('Hết hạn') && !pr.txt.includes('777'), 'chỉ ưu đãi tích 🤖, còn hạn, đúng trang, không gắn QC');
raw.prepare("INSERT INTO kv (k, v) VALUES ('mkt_live', ?)").run(JSON.stringify({ camps: [{ id: '501', n: '28/11 ĐỂ LẠI SĐT', st: 'ACTIVE', pages: [['111', 'TDL']], ads: [{ id: '9' }] }] }));
raw.prepare("INSERT INTO mk_adref (psid, page, ad, camp, at) VALUES ('k2', '111', '9', 'tên đã đổi', ?)").run(T);
pr = await FB.promosFor(x, pg, 'k2', T);
assert.ok(pr.txt.includes('quảng cáo có chương trình riêng') && pr.txt.includes('450.000đ') && pr.kb.includes('450.000đ'), 'khách từ QC khớp chữ → ưu đãi riêng');
assert.equal(pr.hit, 'QC để lại SĐT', 'khách QC có ưu đãi riêng → chỉ báo ưu đãi đó (khớp theo mã quảng cáo)');
assert.ok((await FB.promosFor(x, { id: '777' }, 'k9', T)).txt.includes('quà riêng trang 777'));

// 1 chiến dịch chỉ gắn 1 ưu đãi (salemkt.js offer_save)
const SM = await import('file://' + ROOT + '/api/src/salemkt.js'), ql = { level: 2, name: 'Thủy', role: 'Quản lý' };
raw.prepare("UPDATE kv SET v = '[]' WHERE k = 'mkt_offers'").run();
let o1 = await SM.crmOffers(x, ql, { action: 'offer_save', title: 'A', text: 'a', bot: true, camps: [{ id: '501', n: 'x' }, { id: '502', n: 'y' }] });
assert.equal(o1.ok, true);
let o2 = await SM.crmOffers(x, ql, { action: 'offer_save', title: 'B', text: 'b', bot: true, camps: [{ id: '502', n: 'y' }], pages: ['111'] });
const A = o2.list.find(o => o.title === 'A'), B = o2.list.find(o => o.title === 'B');
assert.deepEqual(A.camps.map(c => c.id), ['501']); assert.deepEqual(B.camps.map(c => c.id), ['502']); assert.deepEqual(B.pages, ['111']);
assert.equal((await SM.crmOffers(x, { level: 1, name: 'S', role: 'Sale' }, { action: 'offer_save', title: 'C', text: 'c' })).ok, false);
console.log('✅ test-fbapp2: OK');
