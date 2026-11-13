/* ================================================================ 📢 Thông báo nội bộ (13/11/2026, anh Sơn chọn)
 * Thông báo & văn bản quan trọng của công ty để trong CRM (không để group Facebook: tin dễ trôi, không biết ai đã đọc,
 * người đã nghỉ vẫn xem được). Group Facebook family.thucduonglanh.vn chỉ để lưu khoảnh khắc vui.
 * - Quản lý / Quản trị đăng: loại, tiêu đề, nội dung, link văn bản (Google Drive…), tuỳ chọn gửi Telegram riêng cho mọi người.
 * - Thẻ ở đầu màn hình đầu tiên của mỗi người (app.js tbCard): tin chưa đọc hiện đầy đủ + nút ✅ Tôi đã đọc.
 * - Người đăng / Quản lý trở lên xem ai đã đọc, ai chưa. 8h sáng (cron.js dailyCare → tbDaily): ai chưa đọc tin trong 3 ngày
 *   được Telegram nhắc riêng; người đăng nhận danh sách người chưa đọc. Không dùng AI. */
import { run, all, esc, DAY, CRM_URL, kvGet, kvSet } from './lib.js';
import { crmUsers, SUPER_ADMIN } from './crm.js';
import { telegramTo } from './google.js';

export const TB_KINDS = ['📢 Thông báo', '📄 Văn bản', '📅 Lịch / sự kiện', '🎉 Tin vui'];
const KEEP = 60 * DAY; // thẻ hiện tin trong 60 ngày gần nhất
const REMIND = 3.5 * DAY; // nhắc người chưa đọc trong ~3 ngày đầu

let schemaOk = false;
async function schema(db) {
  if (schemaOk) return;
  await run(db, `CREATE TABLE IF NOT EXISTS tb_posts (id INTEGER PRIMARY KEY AUTOINCREMENT, kind TEXT DEFAULT '', title TEXT, body TEXT DEFAULT '', link TEXT DEFAULT '', by_email TEXT, by_name TEXT, at INTEGER, upd_at INTEGER, del INTEGER DEFAULT 0)`);
  await run(db, `CREATE TABLE IF NOT EXISTS tb_read (post INTEGER, email TEXT, name TEXT DEFAULT '', at INTEGER, PRIMARY KEY (post, email))`);
  // 14/11/2026 anh Sơn: hẹn giờ hiện (show_at), hiện đến hết ngày (until), 📌 ghim đầu (pin), Telegram chờ tới giờ hẹn mới gửi (tg_wait)
  const cols = (await all(db, 'PRAGMA table_info(tb_posts)')).map(c => c.name);
  for (const [c, def] of [['show_at', 'INTEGER'], ['until', 'INTEGER'], ['pin', 'INTEGER DEFAULT 0'], ['tg_wait', 'INTEGER DEFAULT 0']]) if (!cols.includes(c)) { try { await run(db, `ALTER TABLE tb_posts ADD COLUMN ${c} ${def}`); } catch (e) { } }
  schemaOk = true;
}

const staff = async x => (await crmUsers(x)).filter(z => z.active);
const clean = (s, n) => String(s || '').replace(/\r/g, '').trim().slice(0, n);

const SHOW = 'coalesce(show_at, at)'; // giờ tin bắt đầu hiện (hẹn giờ) hoặc giờ đăng
/** Danh sách cho thẻ: tin đang hiện (đã tới giờ hẹn, chưa quá ngày "hiện đến", không có hạn thì 60 ngày), 📌 ghim trước rồi mới nhất trước;
 *  mình đã đọc chưa, bao nhiêu người đã đọc. Quản lý trở lên (và người đăng) có thêm danh sách đã đọc / chưa đọc,
 *  và thấy cả tin đang hẹn giờ (wait) / đã hết hạn hiện (gone, 14 ngày gần đây) để sửa hoặc đăng lại. */
export async function tbList(x, u) {
  await schema(x.db);
  if (u.level >= 2) try { await tbSeed(x); } catch (e) { console.error('tbSeed', e.message); } // tin đăng hộ anh Sơn có ngay khi quản lý mở CRM, không chờ cron 7h
  const now = Date.now(), mgr = u.level >= 2;
  const posts = await all(x.db, `SELECT id, kind, title, body, link, by_email, by_name, at, upd_at, show_at, until, pin FROM tb_posts WHERE del = 0 AND ${SHOW} > ? AND (? OR by_email = ? OR (${SHOW} <= ? AND (until IS NULL OR until > ?))) ORDER BY (${SHOW} > ?) DESC, (pin = 1 AND (until IS NULL OR until > ?)) DESC, ${SHOW} DESC LIMIT 40`,
    now - KEEP, mgr ? 1 : 0, u.email, now, now, now, now);
  const ids = posts.map(p => p.id), reads = ids.length ? await all(x.db, `SELECT post, email, name, at FROM tb_read WHERE post IN (${ids.map(() => '?').join(',')})`, ...ids) : [];
  const ppl = await staff(x);
  const out = posts.filter(p => !(p.until && p.until <= now - 14 * DAY)).map(p => {
    const rs = reads.filter(r => r.post === p.id), me = rs.find(r => r.email === u.email), who = ppl.filter(z => z.email !== p.by_email);
    const sh = p.show_at || p.at;
    const o = { id: p.id, kind: p.kind, title: p.title, body: p.body, link: p.link, by: p.by_name, at: sh, posted: p.at, showAt: p.show_at || null, until: p.until || null, pin: p.pin ? 1 : 0, wait: sh > now ? 1 : 0, gone: p.until && p.until <= now ? 1 : 0, upd: p.upd_at || null, mine: me ? me.at : (p.by_email === u.email ? p.at : null), own: p.by_email === u.email, n: rs.filter(r => r.email !== p.by_email).length, total: who.length };
    if (mgr || o.own) { const got = {}; rs.forEach(r => { got[r.email] = r.at; }); o.read = who.filter(z => got[z.email]).map(z => ({ name: z.name, at: got[z.email] })); o.unread = who.filter(z => !got[z.email]).map(z => z.name); }
    return o;
  });
  return { ok: true, tb: { posts: out, kinds: TB_KINDS, canPost: mgr, at: now } };
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
  const id = Number(d.id) || 0, now = Date.now(), pin = d.pin ? 1 : 0;
  let showAt = Number(d.showAt) || null, until = Number(d.until) || null; // ms; trống = hiện ngay / không hạn (60 ngày)
  if (showAt && showAt <= now + 60e3) showAt = null; // giờ đã qua → hiện ngay
  if (showAt && showAt > now + 90 * DAY) return { ok: false, error: 'Chỉ hẹn giờ trong 90 ngày tới.' };
  if (until && until <= (showAt || now)) return { ok: false, error: 'Ngày "hiện đến" phải sau giờ bắt đầu hiện.' };
  const wait = d.tg && showAt ? 1 : 0; // hẹn giờ + gửi Telegram → tbTick gửi khi tới giờ
  if (id) await run(x.db, 'UPDATE tb_posts SET kind = ?, title = ?, body = ?, link = ?, upd_at = ?, show_at = ?, until = ?, pin = ?, tg_wait = ? WHERE id = ? AND del = 0', kind, title, body, link, now, showAt, until, pin, wait, id);
  else await run(x.db, 'INSERT INTO tb_posts (kind, title, body, link, by_email, by_name, at, show_at, until, pin, tg_wait) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)', kind, title, body, link, u.email, u.name, now, showAt, until, pin, wait);
  let sent = 0;
  if (d.tg && !showAt) {
    const msg = kind + (id ? ' (đã sửa)' : '') + ': <b>' + esc(title) + '</b>\n' + (body ? esc(body.length > 600 ? body.slice(0, 600) + '…' : body) + '\n' : '') + (link ? '📎 ' + esc(link) + '\n' : '') + '\n— ' + esc(u.name) + '\n👉 Mở CRM bấm <b>✅ Tôi đã đọc</b>: ' + CRM_URL;
    for (const z of await staff(x)) if (z.tg && z.email !== u.email) { try { await telegramTo(x.env, z.tg, msg); sent++; } catch (e) { console.error('tb tg', e.message); } }
  }
  const r = await tbList(x, u); r.sent = sent; r.wait = wait; return r;
}

/** 14/11/2026 anh Sơn nhờ đăng hộ (1 lần): thông báo phát động mở rộng khách, hiện 7h30 14/11, ghim tới hết 30/11, Telegram khi tới giờ. */
const TB_1411 = { kind: '📢 Thông báo', title: '🌱 Nửa tháng cuối, mỗi chị em mình thêm 6 người khách của riêng mình nhé!', link: 'https://crm.thucduonglanh.vn/huong-dan/mo-rong-khach/',
  show: Date.UTC(2026, 10, 14, 0, 30), until: Date.UTC(2026, 10, 30, 17, 0), body: "Gửi cả nhà mình,\n\nChị em mình gọi điện mỗi ngày, có hôm chục cuộc mà chưa ra đơn nào. Sơn hiểu cảm giác đó. Nhưng Sơn tin một điều: khách mình chăm bằng cả tấm lòng thì sẽ không đi đâu cả. Họ sẽ quay lại, rồi rủ thêm người thân, bạn bè đến với mình.\n\nTừ hôm nay đến 30/11, Sơn mời chị em cùng làm một việc nhỏ mà ý nghĩa lâu dài: mỗi chị em có thêm 6 khách của riêng mình.\n🤝 4 khách do khách cũ giới thiệu · 🔍 2 khách chị em tự tìm\n\n💰 Khách chị em mang về là khách của chị em:\n• 6% mọi đơn trong 6 tháng\n• Thưởng thêm 20k – 50k – 100k theo mức khách mua\n• Hết 6 tháng, khách vẫn là của chị em\nMỗi người khách hôm nay là thu nhập đều đặn của những tháng sau.\n\n✅ Mỗi ngày chỉ 30 phút, 5 việc nhỏ (tab Hôm nay → 🌱 Mở rộng khách):\n1. Mời 2 khách cũ giới thiệu bạn bè\n2. Mời 1 khách vào nhóm Zalo\n3. Gọi lại 1 khách từng nói \"Không mua\"\n4. Nhận 1 số ở Kho chung\n5. Đăng 1 bài Facebook (bài viết sẵn, chỉ cần copy)\n\nHôm nào chưa ra đơn cũng không sao. Mọi công sức của chị em đều được ghi nhận trên bảng thi đua và trong báo cáo mỗi tối.\n\nNgày 24/11, Sơn và chị em cùng nhìn lại chặng giữa. Sơn tin chị em làm được, vì chị em đã vượt qua nhiều điều khó hơn thế này rồi. 💚\n\n(Khách tính khi số chưa có trong CRM, không tính người nhà và khách biết qua quảng cáo công ty.)\nĐọc xong chị em bấm ✅ Tôi đã đọc nhé!" };
async function tbSeed(x) {
  if (await kvGet(x.db, 'tb_1411_mig')) return;
  await kvSet(x.db, 'tb_1411_mig', '1');
  const boss = (await crmUsers(x)).find(z => z.email === SUPER_ADMIN), T = TB_1411;
  await run(x.db, 'INSERT INTO tb_posts (kind, title, body, link, by_email, by_name, at, show_at, until, pin, tg_wait) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 1, 1)', T.kind, T.title, T.body, T.link, SUPER_ADMIN, boss ? boss.name : 'Sơn', Date.now(), T.show > Date.now() + 60e3 ? T.show : null, T.until);
}

/** Mỗi lượt cron (10 phút, 7h–22h): tin hẹn giờ có chọn gửi Telegram → tới giờ thì gửi riêng cho mọi người. */
export async function tbTick(x) {
  await schema(x.db);
  try { await tbSeed(x); } catch (e) { console.error('tbSeed', e.message); }
  const now = Date.now(), posts = await all(x.db, 'SELECT id, kind, title, body, link, by_email, by_name FROM tb_posts WHERE del = 0 AND tg_wait = 1 AND show_at <= ?', now);
  if (!posts.length) return 0;
  const ppl = await staff(x); let n = 0;
  for (const p of posts) {
    await run(x.db, 'UPDATE tb_posts SET tg_wait = 0 WHERE id = ?', p.id); // đánh dấu trước: lỗi giữa chừng không gửi lặp
    const msg = p.kind + ': <b>' + esc(p.title) + '</b>\n' + (p.body ? esc(p.body.length > 600 ? p.body.slice(0, 600) + '…' : p.body) + '\n' : '') + (p.link ? '📎 ' + esc(p.link) + '\n' : '') + '\n— ' + esc(p.by_name) + '\n👉 Mở CRM bấm <b>✅ Tôi đã đọc</b>: ' + CRM_URL;
    for (const z of ppl) if (z.tg && z.email !== p.by_email) { try { await telegramTo(x.env, z.tg, msg); n++; } catch (e) { console.error('tbTick tg', e.message); } }
  }
  return n;
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
  const now = Date.now(), posts = await all(x.db, `SELECT id, title, by_email, by_name, at FROM tb_posts WHERE del = 0 AND ${SHOW} > ? AND ${SHOW} < ? AND (until IS NULL OR until > ?)`, now - REMIND, now - 20 * 3600e3, now);
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
