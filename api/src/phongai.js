/* ================================================================ 📣 Phòng Marketing AI trong CRM (16/11/2026, anh Sơn chọn "Cách A: Lành trên Mac")
 * Anh Sơn / Quản lý nhìn sơ đồ phòng (Lành + Thám, Văn, Chuẩn, Phát), giao việc ngay trên CRM, nhận kết quả và bấm Duyệt / Sửa lại.
 * Người làm thật là phiên Claude "Lành" chạy trên máy Mac của anh Sơn (thư mục Drive 09_Phòng Marketing AI):
 *   chương trình nhỏ website/scripts/lanh-nhan-viec.sh chạy 5 phút 1 lần (launchd) → POST /pm/agent {op:'pull'} lấy việc mới / việc bị trả sửa
 *   → báo 'dang' → chạy `claude -p` trong thư mục phòng (đủ skill + Drive) → gửi kết quả {op:'update', status:'duyet', result, file, score}.
 * Khoá cổng: env.PM_AGENT_KEY (wrangler secret), trên Mac lưu ở Keychain "tdl-pm-agent". Máy chủ KHÔNG gọi AI (0đ), chỉ lưu và báo Telegram.
 * Lệnh CRM: pm_view, pm_add, pm_review, pm_cancel (chỉ Quản trị = anh Sơn, anh Hiếu, 16/11/2026). Giao diện: viewAit (tab doi-ai) phần đầu, crm/app.js (PM, pm*). */
import { all, first, run, kvGet, kvSet, esc, DAY, CRM_URL } from './lib.js';
import { crmUsers } from './crm.js';
import { telegramTo } from './google.js';

/** Sơ đồ phòng – 1 nguồn duy nhất (đổi cấu trúc phòng thì sửa cả CLAUDE.md của phòng, xem memory phong-marketing-ai). */
export const PM_TEAM = [
  { id: 'lanh', name: 'Lành', role: 'Trưởng phòng', ic: '🌿', job: 'Hiểu anh muốn gì, lên kế hoạch có số, chia việc cho đúng người, gom kết quả báo anh.', skills: ['plan-marketing-basic'], ex: 'Lên kế hoạch tháng 12 cho Quà Tết, chia việc cho cả phòng' },
  { id: 'tham', name: 'Thám', role: 'Hiểu khách & làm offer', ic: '🔎', job: 'Khách là ai, muốn gì nhưng sợ gì (tension), mời họ mua bằng gì (offer).', skills: ['nghien-cuu-thi-truong', 'viet-offer-hormozi'], ex: 'Tìm 5 tension của tệp công ty mua quà Tết' },
  { id: 'van', name: 'Văn', role: 'Viết nội dung', ic: '✍️', job: 'Bài Fanpage, tin nhóm Zalo, kịch bản video, mô tả sản phẩm, trả lời mẫu. Luôn đủ khối 6 dòng.', skills: ['vinalink-3c-content'], ex: 'Viết 3 bài Quà Tết cho tệp mẹ bỉm, tầng MOFU' },
  { id: 'chuan', name: 'Chuẩn', role: 'Kiểm duyệt', ic: '🛡', job: 'Chấm bài trước khi tới anh: đúng luật quảng cáo, đúng hồ sơ công bố, đúng giọng, đủ khối 6 dòng.', skills: ['Phiếu kiểm duyệt'], ex: 'Kiểm lại bài quảng cáo DILVANG này giúp anh' },
  { id: 'phat', name: 'Phát', role: 'Quảng cáo & đo lường', ic: '📈', job: 'Đọc số quảng cáo, chỉ ra cái hiệu quả / dở, viết Phiếu việc quảng cáo. Anh Hiếu là người bấm.', skills: ['vinalink-3c-content', 'he-thong-content-ai'], ex: 'Vì sao giá 1 số điện thoại tuần này lên 450k?' },
];
const IDS = PM_TEAM.map(m => m.id);
export const PM_ST = { moi: 'Mới giao', dang: 'Đang làm', duyet: 'Chờ anh duyệt', sua: 'Đang sửa lại', xong: 'Xong', huy: 'Đã huỷ' };
const ALIVE_K = 'pm_alive', DOWN_K = 'pm_down_sent';
const OFF_MS = 20 * 60e3; // Mac im > 20 phút (chương trình chạy 5 phút / lần) = đang tắt / ngủ
const nowMs = () => Date.now();
const clean = (s, n) => String(s == null ? '' : s).replace(/\r/g, '').trim().slice(0, n);

let schemaOk = false;
export async function pmSchema(db) {
  if (schemaOk) return;
  await run(db, `CREATE TABLE IF NOT EXISTS pm_tasks (id INTEGER PRIMARY KEY AUTOINCREMENT, who TEXT DEFAULT 'lanh', title TEXT, body TEXT DEFAULT '',
    due INTEGER, status TEXT DEFAULT 'moi', step TEXT DEFAULT '', by_email TEXT, by_name TEXT, at INTEGER, upd INTEGER, start_at INTEGER, done_at INTEGER,
    result TEXT DEFAULT '', file TEXT DEFAULT '', score INTEGER, note TEXT DEFAULT '', rounds INTEGER DEFAULT 0, hist TEXT DEFAULT '[]')`);
  await run(db, 'CREATE INDEX IF NOT EXISTS pm_tasks_st ON pm_tasks(status, at)');
  schemaOk = true;
}
const code = id => 'CRM-' + id;
function histAdd(t, txt) { let h = []; try { h = JSON.parse(t.hist || '[]'); } catch (e) { } h.push([nowMs(), txt]); return JSON.stringify(h.slice(-30)); }

async function admins(x) { return (await crmUsers(x)).filter(z => z.active && z.level >= 2); }
async function tellBoss(x, msg, exceptEmail) {
  for (const z of await admins(x)) if (z.tg && z.level >= 3 && z.email !== exceptEmail) { try { await telegramTo(x.env, z.tg, msg); } catch (e) { console.error('pm tg', e.message); } }
}

/* ---------------------------------------------------------------- lệnh CRM */
export async function crmPm(x, u, a, d) {
  if ((a === 'pm_done' || a === 'pm_post') && (u.level >= 3 || u.role === 'Marketing')) { await pmSchema(x.db); return a === 'pm_done' ? { ok: true, rows: await pmDoneList(x) } : pmPost(x, u, d); } // 📝 27/11/2026: bạn marketing xem kết quả đã duyệt để đăng
  if (u.level < 3) return { ok: false, error: 'Phòng Marketing AI chỉ dành cho anh Sơn và anh Hiếu (quyền Quản trị).' }; // anh Sơn 16/11/2026: tạm thời chỉ Quản trị
  await pmSchema(x.db);
  if (a === 'pm_view') return pmView(x);
  if (a === 'pm_add') return pmAdd(x, u, d);
  if (a === 'pm_review') return pmReview(x, u, d);
  if (a === 'pm_cancel') return pmCancel(x, u, d);
  return { ok: false, error: 'Không rõ thao tác' };
}
function pub(t, full) {
  const o = { id: t.id, code: code(t.id), who: t.who, title: t.title, body: t.body, due: t.due, status: t.status, step: t.step, by: t.by_name, at: t.at, upd: t.upd,
    start: t.start_at, done: t.done_at, file: t.file, score: t.score, note: t.note, rounds: t.rounds || 0, hasRes: !!t.result };
  if (full) { o.result = t.result; try { o.hist = JSON.parse(t.hist || '[]'); } catch (e) { o.hist = []; } }
  return o;
}
async function pmView(x) {
  const since = nowMs() - 30 * DAY;
  const rows = await all(x.db, `SELECT * FROM pm_tasks WHERE status NOT IN ('xong', 'huy') OR coalesce(done_at, upd, at) >= ? ORDER BY at DESC LIMIT 200`, since);
  const alive = JSON.parse(await kvGet(x.db, ALIVE_K) || 'null');
  const team = PM_TEAM.map(m => {
    const mine = rows.filter(t => t.who === m.id);
    return Object.assign({}, m, { open: mine.filter(t => ['moi', 'dang', 'sua'].includes(t.status)).length, wait: mine.filter(t => t.status === 'duyet').length,
      done30: mine.filter(t => t.status === 'xong').length, busy: mine.some(t => t.status === 'dang') });
  });
  // kết quả trả về trong vòng chạy hiện tại (việc duyệt / xong) gửi kèm nội dung để mở xem không phải tải thêm
  return { ok: true, team, st: PM_ST, alive, offMs: OFF_MS, now: nowMs(), tasks: rows.map(t => pub(t, t.status === 'duyet' || t.status === 'xong')) };
}
/** Kết quả anh đã duyệt 14 ngày qua mà chưa ai bấm Đã đăng (kv pm_posted = danh sách mã việc đã đăng). */
const POSTED_K = 'pm_posted';
export async function pmDoneList(x) {
  const posted = JSON.parse(await kvGet(x.db, POSTED_K) || '[]');
  const rows = await all(x.db, "SELECT * FROM pm_tasks WHERE status = 'xong' AND coalesce(done_at, upd) >= ? ORDER BY done_at DESC LIMIT 30", nowMs() - 14 * DAY);
  return rows.filter(t => posted.indexOf(t.id) < 0 && t.result).map(t => Object.assign(pub(t, true), { ic: (PM_TEAM.find(m => m.id === t.who) || PM_TEAM[0]).ic, name: (PM_TEAM.find(m => m.id === t.who) || PM_TEAM[0]).name }));
}
async function pmPost(x, u, d) {
  const t = await first(x.db, "SELECT * FROM pm_tasks WHERE id = ? AND status = 'xong'", Number(d.id)); if (!t) return { ok: false, error: 'Không thấy kết quả này' };
  const posted = JSON.parse(await kvGet(x.db, POSTED_K) || '[]'); if (posted.indexOf(t.id) < 0) posted.push(t.id);
  await kvSet(x.db, POSTED_K, JSON.stringify(posted.slice(-300)));
  await run(x.db, 'UPDATE pm_tasks SET hist = ? WHERE id = ?', histAdd(t, u.name + ' đã đăng / đưa ra dùng 📤'), t.id);
  return { ok: true };
}
async function pmAdd(x, u, d) {
  const title = clean(d.title, 300); if (!title) return { ok: false, error: 'Anh gõ việc cần làm trước nhé.' };
  const who = IDS.includes(d.who) ? d.who : 'lanh', body = clean(d.body, 4000), due = Number(d.due) || null, t = nowMs();
  const r = await run(x.db, `INSERT INTO pm_tasks (who, title, body, due, status, step, by_email, by_name, at, upd, hist) VALUES (?, ?, ?, ?, 'moi', 'Chờ Lành nhận việc', ?, ?, ?, ?, ?)`,
    who, title, body, due, u.email, u.name, t, t, JSON.stringify([[t, u.name + ' giao việc']]));
  const id = r.meta && r.meta.last_row_id;
  return { ok: true, id, code: code(id) };
}
async function pmReview(x, u, d) {
  const t = await first(x.db, 'SELECT * FROM pm_tasks WHERE id = ?', Number(d.id)); if (!t) return { ok: false, error: 'Không thấy việc này' };
  if (t.status !== 'duyet') return { ok: false, error: 'Việc này không ở bước chờ duyệt.' };
  if (d.ok) {
    await run(x.db, `UPDATE pm_tasks SET status = 'xong', step = 'Anh đã duyệt', done_at = ?, upd = ?, hist = ? WHERE id = ?`, nowMs(), nowMs(), histAdd(t, u.name + ' duyệt ✅'), t.id);
    return { ok: true };
  }
  const note = clean(d.note, 2000); if (!note) return { ok: false, error: 'Anh ghi cần sửa chỗ nào để Lành làm lại cho đúng.' };
  await run(x.db, `UPDATE pm_tasks SET status = 'sua', step = 'Chờ Lành nhận lời sửa', note = ?, upd = ?, rounds = coalesce(rounds, 0) + 1, hist = ? WHERE id = ?`,
    note, nowMs(), histAdd(t, u.name + ' trả sửa: ' + note.slice(0, 200)), t.id);
  return { ok: true };
}
async function pmCancel(x, u, d) {
  const t = await first(x.db, 'SELECT * FROM pm_tasks WHERE id = ?', Number(d.id)); if (!t) return { ok: false, error: 'Không thấy việc này' };
  if (t.status === 'xong') return { ok: false, error: 'Việc đã xong, không huỷ được.' };
  await run(x.db, `UPDATE pm_tasks SET status = 'huy', step = 'Đã huỷ', done_at = ?, upd = ?, hist = ? WHERE id = ?`, nowMs(), nowMs(), histAdd(t, u.name + ' huỷ việc'), t.id);
  return { ok: true };
}

/* ---------------------------------------------------------------- cổng cho Lành trên Mac: POST /pm/agent, header x-pm-key */
function sameKey(a, b) { if (!a || !b || a.length !== b.length) return false; let r = 0; for (let i = 0; i < a.length; i++) r |= a.charCodeAt(i) ^ b.charCodeAt(i); return r === 0; }
export async function pmRoute(x, req, path) {
  if (path !== '/pm/agent' || req.method !== 'POST') return null;
  const j = (o, st) => new Response(JSON.stringify(o), { status: st || 200, headers: { 'Content-Type': 'application/json; charset=utf-8' } });
  const key = x.env.PM_AGENT_KEY;
  if (!key || !sameKey(String(req.headers.get('x-pm-key') || ''), String(key))) return j({ ok: false, error: 'Sai khoá' }, 401);
  await pmSchema(x.db);
  const d = await req.json().catch(() => null) || {};
  const prev = JSON.parse(await kvGet(x.db, ALIVE_K) || 'null');
  const alive = { at: nowMs(), host: clean(d.host, 60) || (prev && prev.host) || 'Mac', busy: d.op === 'update' && d.status === 'dang' ? Number(d.id) || 0 : (d.busy != null ? Number(d.busy) || 0 : (prev && prev.busy) || 0) };
  if (d.op === 'update' && (d.status === 'duyet' || d.status === 'loi')) alive.busy = 0;
  await kvSet(x.db, ALIVE_K, JSON.stringify(alive));
  if (await kvGet(x.db, DOWN_K)) { await kvSet(x.db, DOWN_K, ''); } // Mac chạy lại → lần tắt sau báo lại được
  if (d.op === 'ping') return j({ ok: true });
  if (d.op === 'pull') {
    // việc treo ở 'dang' quá 3 tiếng (Mac tắt giữa chừng) → cho nhận lại
    const rows = await all(x.db, `SELECT * FROM pm_tasks WHERE status IN ('moi', 'sua') OR (status = 'dang' AND coalesce(start_at, 0) < ?) ORDER BY at LIMIT 5`, nowMs() - 3 * 3600e3);
    return j({ ok: true, team: PM_TEAM, tasks: rows.map(t => Object.assign(pub(t, true), { prevResult: t.status === 'sua' || t.status === 'dang' ? t.result : '' })) });
  }
  if (d.op === 'update') {
    const t = await first(x.db, 'SELECT * FROM pm_tasks WHERE id = ?', Number(d.id)); if (!t) return j({ ok: false, error: 'Không thấy việc' }, 404);
    if (t.status === 'huy' || t.status === 'xong') return j({ ok: true, skip: 1 });
    const step = clean(d.step, 200), now = nowMs();
    if (d.status === 'dang') {
      await run(x.db, `UPDATE pm_tasks SET status = 'dang', step = ?, start_at = ?, upd = ?, hist = ? WHERE id = ?`, step || 'Lành đang làm', now, now, histAdd(t, 'Lành nhận việc' + (t.status === 'sua' ? ' (sửa lần ' + (t.rounds || 1) + ')' : '')), t.id);
      return j({ ok: true });
    }
    if (d.status === 'buoc') { await run(x.db, 'UPDATE pm_tasks SET step = ?, upd = ? WHERE id = ?', step, now, t.id); return j({ ok: true }); }
    if (d.status === 'duyet') {
      const result = clean(d.result, 60000); if (!result) return j({ ok: false, error: 'Thiếu kết quả' }, 400);
      const score = d.score == null || d.score === '' ? null : Math.max(0, Math.min(100, Math.round(Number(d.score) || 0)));
      await run(x.db, `UPDATE pm_tasks SET status = 'duyet', step = ?, result = ?, file = ?, score = ?, upd = ?, hist = ? WHERE id = ?`,
        step || 'Chờ anh duyệt', result, clean(d.file, 400), score, now, histAdd(t, 'Lành gửi kết quả' + (score != null ? ' · Chuẩn chấm ' + score + '/100' : '')), t.id);
      const m = PM_TEAM.find(z => z.id === t.who) || PM_TEAM[0];
      await tellBoss(x, '📣 <b>Phòng Marketing AI</b> gửi kết quả, chờ anh duyệt\n' + m.ic + ' ' + esc(m.name) + ': <b>' + esc(t.title) + '</b>' +
        (score != null ? '\n🛡 Chuẩn chấm ' + score + '/100' : '') + '\n\n👉 Mở xem và bấm Duyệt / Sửa lại: ' + CRM_URL + '#doi-ai');
      return j({ ok: true });
    }
    if (d.status === 'loi') { // Lành không làm được (thiếu thông tin, lỗi) → về lại 'moi'? Không: để anh thấy lý do, chờ anh bổ sung
      const why = clean(d.step, 600) || 'Lành chưa làm được';
      await run(x.db, `UPDATE pm_tasks SET status = 'duyet', step = ?, result = ?, upd = ?, hist = ? WHERE id = ?`, '⚠️ ' + why.slice(0, 190), clean(d.result, 20000) || why, now, histAdd(t, '⚠️ ' + why.slice(0, 200)), t.id);
      await tellBoss(x, '⚠️ <b>Phòng Marketing AI</b> chưa làm được việc "' + esc(t.title) + '"\n' + esc(why) + '\n\n👉 Mở CRM bấm Sửa lại và ghi thêm thông tin: ' + CRM_URL + '#doi-ai');
      return j({ ok: true });
    }
    return j({ ok: false, error: 'Trạng thái không hợp lệ' }, 400);
  }
  return j({ ok: false, error: 'Không rõ thao tác' }, 400);
}

/* ---------------------------------------------------------------- lịch 10 phút: có việc chờ mà Mac tắt > 1 tiếng → báo anh 1 lần */
export async function pmTick(x) {
  await pmSchema(x.db);
  const w = await first(x.db, `SELECT count(*) n, min(at) at FROM pm_tasks WHERE status IN ('moi', 'sua')`);
  if (!w || !Number(w.n) || nowMs() - Number(w.at) < 60 * 60e3) return;
  const alive = JSON.parse(await kvGet(x.db, ALIVE_K) || 'null');
  if (alive && nowMs() - alive.at < 60 * 60e3) return;
  if (await kvGet(x.db, DOWN_K)) return;
  await kvSet(x.db, DOWN_K, String(nowMs()));
  await tellBoss(x, '💤 <b>Phòng Marketing AI</b>: có ' + w.n + ' việc đang chờ mà máy Mac của Lành ' + (alive ? 'tắt từ ' + new Date(alive.at + 7 * 3600e3).toISOString().slice(11, 16) + ' ' + new Date(alive.at + 7 * 3600e3).toISOString().slice(8, 10) + '/' + new Date(alive.at + 7 * 3600e3).toISOString().slice(5, 7) : 'chưa kết nối lần nào') +
    '.\n👉 Anh mở máy Mac (không cho ngủ) là Lành tự làm tiếp.');
}
