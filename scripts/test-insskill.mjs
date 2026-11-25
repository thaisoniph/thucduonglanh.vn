// 🧩 Thử: skill ô ✍️ Viết bài chỉ kèm cho bài tạo niềm tin / chốt đơn, bài nhận biết (TOFU) không kèm và không đếm lượt dùng (api/src/insight.js insPick + insBlock).
// Chạy: node scripts/test-insskill.mjs   (không gọi AI, không tốn tiền)
import { DatabaseSync } from 'node:sqlite';
const sq = new DatabaseSync(':memory:');
const D1 = { prepare(sql) { return { _a: [], bind(...a) { this._a = a.map(v => v === undefined ? null : typeof v === 'boolean' ? Number(v) : v); return this; },
  async all() { return { results: sq.prepare(sql).all(...this._a) }; }, async first() { return sq.prepare(sql).get(...this._a) || null; }, async run() { const r = sq.prepare(sql).run(...this._a); return { meta: { changes: r.changes, last_row_id: Number(r.lastInsertRowid) } }; } }; } };
sq.exec('CREATE TABLE kv (k TEXT PRIMARY KEY, v TEXT, exp INTEGER); CREATE TABLE logs (what TEXT, by_name TEXT, result TEXT, time INTEGER)');
sq.prepare('INSERT INTO kv (k, v) VALUES (?, ?)').run('ins_skill_write', JSON.stringify({ name: 'viet-bai-ban-hang', text: 'CÔNG THỨC AIDA '.repeat(100), at: 1 }));
globalThis.fetch = async () => new Response('{}', { headers: { 'content-type': 'application/json' } });
const I = await import('../api/src/insight.js');
const ok = (c, m) => { if (!c) { console.error('❌', m); process.exitCode = 1; } else console.log('✅', m); };
const x = { db: D1, env: { DB: D1 }, later() { } }, SK = 'PHƯƠNG PHÁP – làm theo skill';
const used = () => { const r = sq.prepare("SELECT v FROM kv WHERE k = 'ins_sku_write'").get(); return r ? JSON.parse(r.v).n : 0; };

const t = await I.insPick(x, 'zalo', '', { f: 'TOFU' });
ok(!t.wsk && !I.insBlock(t, 'TOFU').includes(SK) && used() === 0, 'bài nhận biết: không kèm skill, không đếm lượt dùng');
for (const f of ['MOFU', 'BOFU']) { const p = await I.insPick(x, 'zalo', '', { f }); ok(p.wsk && I.insBlock(p, f).includes(SK), 'bài ' + f + ': có kèm skill'); }
ok(used() === 2, 'đếm đúng 2 lượt dùng (2 bài có skill): ' + used());
const n = await I.insPick(x, 'zalo', ''); // nơi gọi chưa gửi tầng phễu
ok(n.wsk && !I.insBlock(n, 'TOFU').includes(SK) && I.insBlock(n, '').includes(SK), 'nơi gọi không gửi tầng phễu: bài TOFU vẫn không kèm skill; để AI tự chọn tầng thì vẫn kèm');
console.log(process.exitCode ? 'CÓ LỖI' : 'Tất cả đều ổn');
