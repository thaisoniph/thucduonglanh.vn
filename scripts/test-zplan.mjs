// Thử nhanh kế hoạch chủ đề + giờ đăng riêng + soạn trước 3 ngày (zbot.js) trên SQLite trong máy, AI giả. Chạy: node scripts/test-zplan.mjs (cần cd api && npm install trước)
import { DatabaseSync } from 'node:sqlite';
import { readFileSync } from 'node:fs';

const sq = new DatabaseSync(':memory:');
const D1 = { prepare(sql) { return { _a: [], bind(...a) { this._a = a.map(v => v === undefined ? null : typeof v === 'boolean' ? Number(v) : v); return this; },
  async all() { return { results: sq.prepare(sql).all(...this._a) }; }, async first() { return sq.prepare(sql).get(...this._a) || null; }, async run() { const r = sq.prepare(sql).run(...this._a); return { meta: { changes: r.changes } }; } }; } };
sq.exec('CREATE TABLE kv (k TEXT PRIMARY KEY, v TEXT, exp INTEGER); CREATE TABLE orders (source TEXT, first_source TEXT, total INTEGER, status TEXT, time INTEGER)');

const KB = readFileSync(new URL('../dist/chat-kb.txt', import.meta.url), 'utf8');
let aiCalls = [], aiReply = null;
globalThis.fetch = async (url, init) => {
  url = String(url);
  if (url.includes('chat-kb.txt')) return new Response(KB);
  if (url.includes('anh-zalo.json')) return new Response('[]', { headers: { 'content-type': 'application/json' } });
  if (url.includes('api.telegram.org')) { tg.push(JSON.parse(init.body).text); return new Response('{"ok":true}'); }
  if (url.includes('anthropic.com')) {
    const body = JSON.parse(init.body); aiCalls.push(body);
    const text = aiReply(body);
    return new Response(JSON.stringify({ id: 'm', type: 'message', role: 'assistant', model: body.model, content: [{ type: 'text', text }], stop_reason: 'end_turn', usage: { input_tokens: 10, output_tokens: 10 } }), { headers: { 'content-type': 'application/json' } });
  }
  throw new Error('unexpected fetch ' + url);
};
const tg = [];
const env = { DB: D1, ANTHROPIC_API_KEY: 'x', ZBOT_KEY: 'k', TELEGRAM_TOKEN: 't', TELEGRAM_CHAT_IDS: '1' };
const later = []; const x = { db: D1, env, later: p => later.push(p) };

const Z = await import('../api/src/zbot.js');
await Z.zbotSchema(D1);
const { fmtDate } = await import('../api/src/lib.js');
const { addDay } = await import('../api/src/zday.js');
const ok = (c, m) => { if (!c) { console.error('❌', m); process.exitCode = 1; } else console.log('✅', m); };

// okTime
ok(Z.okTime('sang', '6:15') === '06:15' && Z.okTime('sang', '12:00') === '' && Z.okTime('toi', '21:45') === '21:45' && Z.okTime('toi', '21:50') === '' && Z.okTime('sang', '05:59') === '' && Z.okTime('toi', '12:00') === '12:00', 'okTime giới hạn giờ sáng / tối');

// AI giả: kế hoạch → mảng JSON theo các id được hỏi; bài → định dạng bài
aiReply = body => {
  const ask = body.messages[0].content;
  if (ask.startsWith('Lập KẾ HOẠCH')) {
    const ids = [...ask.matchAll(/^- (\d{8}_(?:sang|toi)) · /gm)].map(m => m[1]);
    return 'Đây là kế hoạch:\n' + JSON.stringify(ids.map((id, i) => ({ id, f: i % 3 === 0 ? 'BOFU' : 'TOFU', topic: 'Chủ đề ' + id, idea: 'Góc ' + i, cta: 'Mời bình luận', g: 'me-bim', tn: 'Muốn A ↔ ngại B', sp: i % 2 ? 'tra-hoa-tan-dilvang-dinh-lang-che-vang' : 'khong-co' })));
  }
  return 'CHỦ ĐỀ: Bài thử\nNHÓM KHÁCH: Mẹ sau sinh, mẹ bỉm\nISSUE: x\nTENSION: a ↔ b\nINSIGHT: tôi\nIDEA: y\nSẢN PHẨM: không\nẢNH: không\n---\n**BÀI THỬ**\nNội dung bài thử.';
};

const now = Date.now(), today = fmtDate(now, 'yyyyMMdd');
// cài đặt: bot đã chạy
await D1.prepare("INSERT INTO kv (k, v) VALUES ('zb_status', ?)").bind(JSON.stringify({ at: now, groups: [{ id: 'g1', name: 'Thực Dưỡng Lành' }] })).run();
await D1.prepare("INSERT INTO kv (k, v) VALUES ('zb_cfg', ?)").bind(JSON.stringify({ groups: ['g1'] })).run();

// 1) zbotTick soạn trước tới hôm nay + 3 ngày
for (let i = 0; i < 12; i++) await Z.zbotTick(x);
const posts = sq.prepare('SELECT id FROM zb_posts ORDER BY id').all().map(r => r.id);
ok(posts.some(id => id.startsWith(addDay(today, 3))) && !posts.some(id => id.startsWith(addDay(today, 4))), 'soạn trước đúng 3 ngày: ' + posts.join(', '));
const autoPlan = sq.prepare('SELECT count(*) n, min(day) a, max(day) b FROM zb_plan').get();
ok(autoPlan.n === 14 && autoPlan.a === addDay(today, 4), 'tự lập kế hoạch 7 ngày từ ngày thứ 4: ' + JSON.stringify(autoPlan));
ok(tg.some(t => t.includes('Kế hoạch chủ đề nhóm Zalo')), 'Telegram báo kế hoạch mới');
const planAsk = aiCalls.find(b => b.messages[0].content.startsWith('Lập KẾ HOẠCH'));
if (process.env.SHOW) console.log(planAsk.messages[0].content);
ok(planAsk && /NGÂN HÀNG INSIGHT/.test(planAsk.messages[0].content) && /TOFU/.test(planAsk.messages[0].content), 'prompt kế hoạch có ngân hàng insight + 3 tầng');
const p1 = sq.prepare("SELECT * FROM zb_plan WHERE sp != '' LIMIT 1").get(), p0 = sq.prepare("SELECT * FROM zb_plan WHERE id = ?").get(addDay(today, 4) + '_sang');
ok(p1 && p1.sp === 'tra-hoa-tan-dilvang-dinh-lang-che-vang', 'giữ mã sản phẩm đúng, bỏ mã sai');
ok(sq.prepare("SELECT count(*) n FROM zb_plan WHERE f = 'BOFU'").get().n <= 3, 'tỉ lệ "theo lịch tuần": AI trả BOFU 1/3 bài nhưng giữ tầng của khung (' + sq.prepare("SELECT group_concat(f) g FROM zb_plan").get().g + ')');

// 2) CRM: duyệt, sửa, giờ riêng
const u = { level: 3, name: 'Sơn', role: 'Quản trị' }, log = async () => { };
let r = await Z.crmZbot(x, u, { action: 'zb_view' }, log);
ok(r.ok && r.plan.length === 14 && r.prods.length > 3 && r.mix.warm, 'zb_view trả kế hoạch + sản phẩm + tỉ lệ');
r = await Z.crmZbot(x, u, { action: 'zb_plan_set', id: p0.id, topic: 'Cháo hạt sen cho bữa sáng', at: '06:40', status: 'ok' }, log);
const p0b = sq.prepare('SELECT * FROM zb_plan WHERE id = ?').get(p0.id);
ok(r.ok && p0b.status === 'ok' && p0b.topic === 'Cháo hạt sen cho bữa sáng' && p0b.at_time === '06:40' && p0b.ok_by === 'Sơn', 'sửa + duyệt + giờ riêng chủ đề');
r = await Z.crmZbot(x, u, { action: 'zb_plan_set', id: p0.id, at: '13:00' }, log);
ok(!r.ok && /6:00/.test(r.error), 'chặn giờ sáng sai: ' + r.error);
const wk = sq.prepare("SELECT id FROM zb_plan WHERE status = 'draft'").all().map(z => z.id);
r = await Z.crmZbot(x, u, { action: 'zb_plan_set', ids: wk, status: 'ok' }, log);
ok(r.ok && r.n === wk.length && sq.prepare("SELECT count(*) n FROM zb_plan WHERE status = 'ok'").get().n === 14, 'duyệt cả tuần');

// 3) giờ riêng cho bài đã soạn (ngày mai, tối)
const pid = addDay(today, 1) + '_toi';
r = await Z.crmZbot(x, u, { action: 'zb_time', id: pid, at: '19:15' }, log);
ok(r.ok && sq.prepare('SELECT at_time FROM zb_posts WHERE id = ?').get(pid).at_time === '19:15', 'hẹn giờ riêng bài tối ngày mai 19:15');
r = await Z.crmZbot(x, u, { action: 'zb_time', id: pid, at: '' }, log);
ok(r.ok && sq.prepare('SELECT at_time FROM zb_posts WHERE id = ?').get(pid).at_time === '', 'về giờ chung');

// 4) chủ đề được duyệt cho bài AI đã soạn → bài bị xoá để soạn lại theo chủ đề
r = await Z.crmZbot(x, u, { action: 'zb_plan_make', from: addDay(today, 2), n: 2, mix: 'warm', focus: 'Quà Tết', save: addDay(today, 3) }, log);
ok(r.ok && r.n === 4, 'lập kế hoạch cho ngày đã có bài AI nháp: ' + JSON.stringify(r));
const id2 = addDay(today, 2) + '_sang';
r = await Z.crmZbot(x, u, { action: 'zb_plan_set', id: id2, status: 'ok' }, log);
ok(r.ok && r.redo === 1 && !sq.prepare('SELECT id FROM zb_posts WHERE id = ?').get(id2), 'duyệt chủ đề → xoá bài AI cũ để soạn lại');
aiCalls = [];
await Z.zbotTick(x);
const re = sq.prepare('SELECT plan, at_time FROM zb_posts WHERE id = ?').get(id2), wAsk = aiCalls[0] && aiCalls[0].messages[0].content;
ok(re && re.plan === 'ok' && /ĐÃ DUYỆT trong kế hoạch/.test(wAsk) && /TENSION ĐÃ CHỌN TRONG KẾ HOẠCH/.test(wAsk), 'trợ lý soạn lại bài đúng chủ đề đã duyệt');
ok(/đăng lúc \d{1,2}h\d{2}/.test(wAsk), 'prompt bài có giờ đăng thật');

// 5) chủ đề chưa duyệt còn > 24 tiếng → chưa soạn; ngày đã soạn hết → không soạn thêm
sq.prepare('DELETE FROM zb_posts WHERE id = ?').run(addDay(today, 3) + '_toi');
sq.prepare("INSERT INTO zb_plan (id, day, slot, f, topic, status) VALUES (?, ?, 'toi', 'TOFU', 'Chờ duyệt', 'draft') ON CONFLICT(id) DO UPDATE SET status = 'draft'").run(addDay(today, 3) + '_toi', addDay(today, 3));
aiCalls = []; await Z.zbotTick(x);
ok(!aiCalls.some(b => b.messages[0].content.startsWith('Viết 1 bài')) && !sq.prepare('SELECT id FROM zb_posts WHERE id = ?').get(addDay(today, 3) + '_toi'), 'chủ đề chưa duyệt (> 24 tiếng): chờ, chưa soạn');
// skip
r = await Z.crmZbot(x, u, { action: 'zb_plan_set', id: addDay(today, 3) + '_toi', status: 'skip' }, log);
ok(r.ok, 'không đăng bài này');

// 6) zPoll dùng giờ riêng
const pd = fmtDate(now, 'yyyyMMdd'), pastT = fmtDate(now - 5 * 60e3, 'HH:mm'), tid = pd + '_toi';
sq.prepare("INSERT INTO zb_posts (id, day, slot, topic, text, status) VALUES (?, ?, 'toi', 't', 'abc', 'ok') ON CONFLICT(id) DO UPDATE SET status = 'ok', text = 'abc'").run(tid, pd);
sq.prepare('UPDATE zb_posts SET at_time = ? WHERE id = ?').run(pastT, tid);
await Z.zbot(x, { key: 'k', ev: 'poll', groups: [{ id: 'g1', name: 'Thực Dưỡng Lành' }] });
ok(sq.prepare('SELECT status FROM zb_posts WHERE id = ?').get(tid).status === 'sent' && sq.prepare("SELECT count(*) n FROM zb_out WHERE ref = ?").get(tid).n === 1, 'tới giờ riêng (' + pastT + ') thì đăng');
const cfgRaw = JSON.parse(sq.prepare("SELECT v FROM kv WHERE k = 'zb_cfg'").get().v);
ok(cfgRaw.pmix && cfgRaw.pmix.mix === 'warm' && cfgRaw.pmix.focus === 'Quà Tết' && cfgRaw.pmix.to === addDay(today, 3), 'lưu tỉ lệ + trọng tâm cho lần tự lập sau');
// zb_cfg: lead + time validation
r = await Z.crmZbot(x, u, { action: 'zb_cfg', cfg: { lead: 2, slots: [{ id: 'sang', on: true, at: '05:00' }] } }, log);
ok(!r.ok && /6:00/.test(r.error), 'cài đặt chặn giờ sai');
r = await Z.crmZbot(x, u, { action: 'zb_cfg', cfg: { lead: 2, planAuto: false, slots: [{ id: 'sang', on: true, at: '07:45' }, { id: 'toi', on: true, at: '20:30' }] } }, log);
ok(r.ok && r.cfg.lead === 2 && r.cfg.planAuto === false && r.cfg.slots[0].at === '07:45', 'cài đặt soạn trước 2 ngày + tắt tự lập');
if (process.env.DUMP) { sq.prepare("UPDATE zb_plan SET status = 'draft' WHERE day >= ?").run(addDay(today, 7)); const v = await Z.crmZbot(x, u, { action: 'zb_view' }, log); (await import('node:fs')).writeFileSync(process.env.DUMP, JSON.stringify(v)); }
await Promise.allSettled(later);
console.log(process.exitCode ? 'CÓ LỖI' : 'Tất cả đều ổn');
