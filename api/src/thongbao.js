/* ================================================================ 📢 Thông báo nội bộ (13/11/2026, anh Sơn chọn)
 * Thông báo & văn bản quan trọng của công ty để trong CRM (không để group Facebook: tin dễ trôi, không biết ai đã đọc,
 * người đã nghỉ vẫn xem được). Group Facebook family.thucduonglanh.vn chỉ để lưu khoảnh khắc vui.
 * - Quản lý / Quản trị đăng: loại, tiêu đề, nội dung, link văn bản (Google Drive…), tuỳ chọn gửi Telegram riêng cho mọi người.
 * - Thẻ ở đầu màn hình đầu tiên của mỗi người (app.js tbCard): tin chưa đọc hiện đầy đủ + nút ✅ Tôi đã đọc.
 * - Người đăng / Quản lý trở lên xem ai đã đọc, ai chưa. 8h sáng (cron.js dailyCare → tbDaily): ai chưa đọc tin trong 3 ngày
 *   được Telegram nhắc riêng; người đăng nhận danh sách người chưa đọc. Không dùng AI. */
import { run, all, esc, DAY, CRM_URL } from './lib.js';
import { crmUsers } from './crm.js';
import { telegramTo } from './google.js';

export const TB_KINDS = ['📢 Thông báo', '📄 Văn bản', '📅 Lịch / sự kiện', '🎉 Tin vui'];
const KEEP = 60 * DAY; // thẻ hiện tin trong 60 ngày gần nhất
const REMIND = 3.5 * DAY; // nhắc người chưa đọc trong ~3 ngày đầu

let schemaOk = false;
async function schema(db) {
  if (schemaOk) return;
  await run(db, `CREATE TABLE IF NOT EXISTS tb_posts (id INTEGER PRIMARY KEY AUTOINCREMENT, kind TEXT DEFAULT '', title TEXT, body TEXT DEFAULT '', link TEXT DEFAULT '', by_email TEXT, by_name TEXT, at INTEGER, upd_at INTEGER, del INTEGER DEFAULT 0)`);
  await run(db, `CREATE TABLE IF NOT EXISTS tb_read (post INTEGER, email TEXT, name TEXT DEFAULT '', at INTEGER, PRIMARY KEY (post, email))`);
  schemaOk = true;
}

const staff = async x => (await crmUsers(x)).filter(z => z.active);
const clean = (s, n) => String(s || '').replace(/\r/g, '').trim().slice(0, n);

/** Danh sách cho thẻ: tin 60 ngày qua (mới nhất trước), mình đã đọc chưa, bao nhiêu người đã đọc.
 *  Quản lý trở lên (và người đăng) có thêm danh sách đã đọc / chưa đọc từng tin. */
export async function tbList(x, u) {
  await schema(x.db);
  const posts = await all(x.db, 'SELECT id, kind, title, body, link, by_email, by_name, at, upd_at FROM tb_posts WHERE del = 0 AND at > ? ORDER BY at DESC LIMIT 30', Date.now() - KEEP);
  const ids = posts.map(p => p.id), reads = ids.length ? await all(x.db, `SELECT post, email, name, at FROM tb_read WHERE post IN (${ids.map(() => '?').join(',')})`, ...ids) : [];
  const ppl = await staff(x), mgr = u.level >= 2;
  const out = posts.map(p => {
    const rs = reads.filter(r => r.post === p.id), me = rs.find(r => r.email === u.email), who = ppl.filter(z => z.email !== p.by_email);
    const o = { id: p.id, kind: p.kind, title: p.title, body: p.body, link: p.link, by: p.by_name, at: p.at, upd: p.upd_at || null, mine: me ? me.at : (p.by_email === u.email ? p.at : null), own: p.by_email === u.email, n: rs.filter(r => r.email !== p.by_email).length, total: who.length };
    if (mgr || o.own) { const got = {}; rs.forEach(r => { got[r.email] = r.at; }); o.read = who.filter(z => got[z.email]).map(z => ({ name: z.name, at: got[z.email] })); o.unread = who.filter(z => !got[z.email]).map(z => z.name); }
    return o;
  });
  return { ok: true, tb: { posts: out, kinds: TB_KINDS, canPost: mgr, at: Date.now() } };
}

/** ✅ Tôi đã đọc. */
export async function tbRead(x, u, d) {
  await schema(x.db);
  const id = Number(d.id) || 0;
  if (id) await run(x.db, 'INSERT INTO tb_read (post, email, name, at) VALUES (?, ?, ?, ?) ON CONFLICT(post, email) DO NOTHING', id, u.email, u.name, Date.now());
  return tbList(x, u);
}

/** Đăng / sửa thông báo (Quản lý trở lên). d.tg = gửi Telegram riêng cho mọi người đã kết nối. */
export async function tbSave(x, u, d) {
  if (u.level < 2) return { ok: false, error: 'Chỉ Quản lý, Quản trị đăng được thông báo.' };
  await schema(x.db);
  const title = clean(d.title, 150), body = clean(d.body, 4000), kind = TB_KINDS.includes(d.kind) ? d.kind : TB_KINDS[0];
  let link = clean(d.link, 500);
  if (!title) return { ok: false, error: 'Bạn ghi tiêu đề thông báo nhé.' };
  if (link && !/^https?:\/\//i.test(link)) link = 'https://' + link;
  const id = Number(d.id) || 0, now = Date.now();
  if (id) await run(x.db, 'UPDATE tb_posts SET kind = ?, title = ?, body = ?, link = ?, upd_at = ? WHERE id = ? AND del = 0', kind, title, body, link, now, id);
  else await run(x.db, 'INSERT INTO tb_posts (kind, title, body, link, by_email, by_name, at) VALUES (?, ?, ?, ?, ?, ?, ?)', kind, title, body, link, u.email, u.name, now);
  let sent = 0;
  if (d.tg) {
    const msg = kind + (id ? ' (đã sửa)' : '') + ': <b>' + esc(title) + '</b>\n' + (body ? esc(body.length > 600 ? body.slice(0, 600) + '…' : body) + '\n' : '') + (link ? '📎 ' + esc(link) + '\n' : '') + '\n— ' + esc(u.name) + '\n👉 Mở CRM bấm <b>✅ Tôi đã đọc</b>: ' + CRM_URL;
    for (const z of await staff(x)) if (z.tg && z.email !== u.email) { try { await telegramTo(x.env, z.tg, msg); sent++; } catch (e) { console.error('tb tg', e.message); } }
  }
  const r = await tbList(x, u); r.sent = sent; return r;
}

/** Ẩn thông báo (người đăng hoặc Quản trị). Không xoá hẳn, vẫn còn trong D1. */
export async function tbDel(x, u, d) {
  await schema(x.db);
  const [p] = await all(x.db, 'SELECT by_email FROM tb_posts WHERE id = ?', Number(d.id) || 0);
  if (!p) return { ok: false, error: 'Không thấy thông báo này.' };
  if (u.level < 3 && p.by_email !== u.email) return { ok: false, error: 'Chỉ người đăng hoặc Quản trị ẩn được.' };
  await run(x.db, 'UPDATE tb_posts SET del = 1, upd_at = ? WHERE id = ?', Date.now(), Number(d.id));
  return tbList(x, u);
}

export async function crmTb(x, u, d) {
  const a = d.action;
  if (a === 'tb_list') return tbList(x, u);
  if (a === 'tb_read') return tbRead(x, u, d);
  if (a === 'tb_save') return tbSave(x, u, d);
  if (a === 'tb_del') return tbDel(x, u, d);
  return { ok: false, error: 'Không rõ thao tác: ' + a };
}

/** 8h sáng: nhắc riêng người chưa đọc (tin đăng từ 20 tiếng đến ~3 ngày trước), báo người đăng ai còn chưa đọc. */
export async function tbDaily(x) {
  await schema(x.db);
  const now = Date.now(), posts = await all(x.db, 'SELECT id, title, by_email, by_name, at FROM tb_posts WHERE del = 0 AND at > ? AND at < ?', now - REMIND, now - 20 * 3600e3);
  if (!posts.length) return 0;
  const ppl = await staff(x), mine = {}, owner = {};
  for (const p of posts) {
    const got = new Set((await all(x.db, 'SELECT email FROM tb_read WHERE post = ?', p.id)).map(r => r.email));
    const left = ppl.filter(z => z.email !== p.by_email && !got.has(z.email));
    left.forEach(z => { (mine[z.email] || (mine[z.email] = { z, t: [] })).t.push(p.title); });
    if (left.length) (owner[p.by_email] || (owner[p.by_email] = [])).push('• <b>' + esc(p.title) + '</b>: ' + left.length + ' người chưa đọc (' + esc(left.map(z => z.name).join(', ')) + ')');
  }
  let n = 0;
  for (const k in mine) { const { z, t } = mine[k]; if (!z.tg) continue; try { await telegramTo(x.env, z.tg, '📢 Bạn còn ' + t.length + ' thông báo công ty chưa đọc:\n' + t.map(s => '• ' + esc(s)).join('\n') + '\n\n👉 Mở CRM đọc và bấm <b>✅ Tôi đã đọc</b>: ' + CRM_URL); n++; } catch (e) { console.error('tbDaily', e.message); } }
  for (const k in owner) { const o = ppl.find(z => z.email === k); if (o && o.tg) try { await telegramTo(x.env, o.tg, '📢 Thông báo bạn đăng còn người chưa đọc (đã nhắc riêng qua Telegram những ai có kết nối):\n' + owner[k].join('\n')); } catch (e) { } }
  return n;
}
