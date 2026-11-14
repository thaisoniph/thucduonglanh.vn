/* ================================================================ ✅ Giao việc qua Telegram (14/11/2026, anh Sơn chọn: lưu trong CRM, áp dụng mọi nhân sự)
 * Anh Sơn / Quản lý / người được cấp quyền giao việc (vd trưởng phòng Marketing) giao việc cho bất kỳ nhân sự nào đang hoạt động:
 *   - trong CRM (tab ✅ Giao việc), hoặc
 *   - nhắn bot Telegram RIÊNG cho giao việc (không dùng @thucduonglanh_donhang_bot vì bot đó đọc tin bằng getUpdates; bật webhook sẽ làm hỏng
 *     nút "Kết nối Telegram"). Câu viết tự nhiên ("@bot giao Trang gửi bảng lương trước 17h thứ Sáu") → AI (Haiku) tách người, việc, hạn.
 * Nhân sự trả lời bằng nút ✋ Nhận việc / ✅ Xong ngay dưới tin, hoặc trả lời (reply) vào tin việc: "xong rồi", "xin lùi sang thứ Hai", gửi ảnh / link kết quả.
 * Nhắc: 8h sáng mỗi người nhận danh sách việc của mình; việc có giờ hạn được nhắc trước 1 tiếng; quá hạn báo người làm + người giao;
 *   thứ Hai 8h người giao việc nhận tổng kết tuần (xong đúng hạn / trễ / còn tồn theo từng người).
 * Dữ liệu: D1 bảng gv_tasks, gv_log; cấu hình kv gv_cfg (khoá bot, nhóm, người được giao việc); kv gv_tg_<email> = chat riêng với bot giao việc.
 * Nhận diện người nhắn: from.id Telegram = gv_tg_<email>, hoặc = users.tg (chat riêng với bot đơn hàng, cùng là mã người dùng Telegram). */
import Anthropic from '@anthropic-ai/sdk';
import { aiFetch } from './airelay.js';
import { run, all, first, esc, DAY, TZ_MS, CRM_URL, kvGet, kvSet, kvDel, kvJson, fmtDate, startOfDay, randHex, nrm } from './lib.js';
import { crmUsers } from './crm.js';

const API = 'https://api.thucduonglanh.vn';
const AI_MODEL = 'claude-haiku-5-5'; // đủ để tách người / việc / hạn; ~20đ một câu
const AI_DAY_MAX = 400; // lượt AI đọc tin giao việc mỗi ngày (cả công ty)
export const GV_ST = ['Mới', 'Đang làm', 'Xong', 'Huỷ'];
const OPEN = "status IN ('Mới', 'Đang làm')";
const VIEW_URL = CRM_URL + '/#giao-viec';

let schemaOk = false;
async function schema(db) {
  if (schemaOk) return;
  await run(db, `CREATE TABLE IF NOT EXISTS gv_tasks (id INTEGER PRIMARY KEY AUTOINCREMENT, title TEXT, body TEXT DEFAULT '', who_email TEXT, who_name TEXT, by_email TEXT, by_name TEXT,
    due INTEGER, due_t INTEGER DEFAULT 0, status TEXT DEFAULT 'Mới', at INTEGER, upd_at INTEGER, done_at INTEGER, src TEXT DEFAULT 'crm', rem INTEGER DEFAULT 0, result TEXT DEFAULT '')`);
  await run(db, `CREATE TABLE IF NOT EXISTS gv_log (id INTEGER PRIMARY KEY AUTOINCREMENT, task INTEGER, at INTEGER, by_name TEXT, text TEXT)`);
  await run(db, `CREATE TABLE IF NOT EXISTS gv_msg (chat TEXT, msg INTEGER, task INTEGER, at INTEGER, PRIMARY KEY (chat, msg))`);
  schemaOk = true;
}

const clean = (s, n) => String(s || '').replace(/\r/g, '').trim().slice(0, n);
const staff = async x => (await crmUsers(x)).filter(z => z.active);
async function cfgOf(x) { return Object.assign({ token: '', bot: '', secret: '', group: '', groupName: '', leads: [] }, await kvJson(x.db, 'gv_cfg', {})); }
async function cfgSet(x, c) { await kvSet(x.db, 'gv_cfg', JSON.stringify(c)); }
/** Ai được giao việc cho người khác: Quản trị, Quản lý, người anh Sơn tích "Được giao việc" (vd trưởng phòng Marketing). */
function canAssign(u, C) { return u.level >= 2 || (C.leads || []).indexOf(u.email) >= 0; }
const shortName = n => String(n || '').trim().split(/\s+/).pop();

/* ---------------------------------------------------------------- Telegram (bot giao việc) */
async function tg(x, C, method, body) {
  if (!C.token) return null;
  if (x.env.MOCK_GOOGLE) { console.log('GV', method, JSON.stringify(body).slice(0, 200)); return { ok: true, result: { message_id: Math.floor(Math.random() * 1e6) } }; }
  try { const r = await fetch('https://api.telegram.org/bot' + C.token + '/' + method, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }); return await r.json(); }
  catch (e) { console.error('gv tg', method, e.message); return null; }
}
async function say(x, C, chat, text, extra) { return tg(x, C, 'sendMessage', Object.assign({ chat_id: String(chat), text, parse_mode: 'HTML', disable_web_page_preview: true }, extra || {})); }
async function privChat(x, u) { return (await kvGet(x.db, 'gv_tg_' + u.email)) || ''; }
/** Gắn tên có thông báo trong nhóm (không cần @username). */
function mention(u, tgId) { return tgId ? '<a href="tg://user?id=' + esc(tgId) + '">' + esc(u.name) + '</a>' : '<b>' + esc(u.name) + '</b>'; }
async function tgIdOf(x, u) { return (await privChat(x, u)) || u.tg || ''; }
/** Nút dưới tin việc. */
function kb(t) {
  if (t.status === 'Xong' || t.status === 'Huỷ') return { inline_keyboard: [[{ text: '📋 Xem trong CRM', url: VIEW_URL }]] };
  const row = []; if (t.status === 'Mới') row.push({ text: '✋ Nhận việc', callback_data: 'gv:nhan:' + t.id });
  row.push({ text: '✅ Xong', callback_data: 'gv:xong:' + t.id });
  return { inline_keyboard: [row, [{ text: '📋 Xem trong CRM', url: VIEW_URL }]] };
}
const ST_IC = { 'Mới': '🆕', 'Đang làm': '⏳', 'Xong': '✅', 'Huỷ': '✖️' };
function dueTxt(t) {
  if (!t.due) return 'không đặt hạn';
  const d0 = startOfDay(Date.now()), dd = startOfDay(t.due), n = Math.round((dd - d0) / DAY), hm = t.due_t ? ' ' + fmtDate(t.due, 'HH:mm') : '';
  const wd = ['CN', 'T2', 'T3', 'T4', 'T5', 'T6', 'T7'][new Date(t.due + TZ_MS).getUTCDay()];
  return (n === 0 ? 'hôm nay' : n === 1 ? 'mai' : n === -1 ? 'hôm qua' : wd + ' ' + fmtDate(t.due, 'dd/MM')) + hm;
}
function late(t, now) { if (!t.due || t.status === 'Xong' || t.status === 'Huỷ') return false; return t.due_t ? t.due < now : startOfDay(t.due) + DAY <= now; }
function taskText(t, who, by) {
  const now = Date.now();
  return ST_IC[t.status] + ' <b>Việc #' + t.id + '</b> cho ' + who + '\n' + esc(t.title) + (t.body ? '\n<i>' + esc(t.body.slice(0, 500)) + '</i>' : '') +
    '\n📅 Hạn: ' + esc(dueTxt(t)) + (late(t, now) ? ' · 🔴 trễ hạn' : '') + '\n👤 Giao: ' + esc(by) + ' · ' + esc(t.status) + (t.result ? '\n📎 ' + esc(t.result.slice(0, 300)) : '');
}

/** Gửi tin việc: vào nhóm (nếu đã nối nhóm) và/hoặc chat riêng người làm. Lưu mã tin để nút bấm / trả lời biết là việc nào. */
async function announce(x, C, t, opt) {
  opt = opt || {};
  const ppl = await staff(x), w = ppl.find(z => z.email === t.who_email) || { name: t.who_name, email: t.who_email }, wid = await tgIdOf(x, w);
  const text = taskText(t, mention(w, wid), t.by_name), sent = [];
  const send = async chat => { const r = await say(x, C, chat, text, { reply_markup: kb(t) }); if (r && r.ok && r.result) { await run(x.db, 'INSERT OR REPLACE INTO gv_msg (chat, msg, task, at) VALUES (?, ?, ?, ?)', String(chat), r.result.message_id, t.id, Date.now()); sent.push(String(chat)); } };
  const priv = await privChat(x, w);
  if (C.group && !opt.privOnly) await send(C.group);
  if (priv && (!C.group || opt.alsoPriv || opt.privOnly) && sent.indexOf(String(priv)) < 0) await send(priv);
  return sent.length;
}
/** Sửa lại các tin đã gửi của việc này cho đúng trạng thái mới (nút đổi theo). */
async function refreshMsgs(x, C, t) {
  const ppl = await staff(x), w = ppl.find(z => z.email === t.who_email) || { name: t.who_name, email: t.who_email }, wid = await tgIdOf(x, w);
  for (const m of await all(x.db, 'SELECT chat, msg FROM gv_msg WHERE task = ? ORDER BY at DESC LIMIT 4', t.id))
    await tg(x, C, 'editMessageText', { chat_id: m.chat, message_id: m.msg, text: taskText(t, mention(w, wid), t.by_name), parse_mode: 'HTML', disable_web_page_preview: true, reply_markup: kb(t) });
}
/** Báo người giao (chat riêng nếu có, không thì vào nhóm). Bỏ qua khi người giao chính là người vừa làm. */
async function tellBoss(x, C, t, text, actorEmail) {
  if (t.by_email === actorEmail) return;
  const b = (await staff(x)).find(z => z.email === t.by_email); if (!b) return;
  const priv = await privChat(x, b);
  if (priv) await say(x, C, priv, text); else if (C.group) await say(x, C, C.group, mention(b, b.tg) + ' ' + text);
}

/* ---------------------------------------------------------------- dữ liệu việc */
async function getTask(x, id) { await schema(x.db); return await first(x.db, 'SELECT * FROM gv_tasks WHERE id = ?', Number(id) || 0); }
async function addLog(x, id, who, text) { await run(x.db, 'INSERT INTO gv_log (task, at, by_name, text) VALUES (?, ?, ?, ?)', id, Date.now(), who, clean(text, 1000)); }
async function createTask(x, C, by, w, f, src) {
  const now = Date.now();
  const r = await run(x.db, 'INSERT INTO gv_tasks (title, body, who_email, who_name, by_email, by_name, due, due_t, status, at, upd_at, src) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
    clean(f.title, 300), clean(f.body, 2000), w.email, w.name, by.email, by.name, f.due || null, f.due && f.dueT ? 1 : 0, w.email === by.email ? 'Đang làm' : 'Mới', now, now, src || 'crm');
  const id = r.meta && r.meta.last_row_id;
  await addLog(x, id, by.name, src === 'tg' ? 'Giao qua Telegram' : src === 'hop' ? '🎙 Giao từ biên bản cuộc họp' : 'Giao trong CRM');
  return getTask(x, id);
}
/** Đổi trạng thái / hạn / thêm kết quả. Kiểm quyền: người làm, người giao, người được giao việc. */
async function changeTask(x, C, u, t, ch) {
  const mine = t.who_email === u.email, boss = t.by_email === u.email || canAssign(u, C);
  if (!mine && !boss) return { ok: false, error: 'Việc #' + t.id + ' là của ' + t.who_name + ', bạn không sửa được.' };
  const now = Date.now(), notes = [], set = {};
  if (ch.status && ch.status !== t.status && GV_ST.indexOf(ch.status) >= 0) {
    if (ch.status === 'Huỷ' && !boss) return { ok: false, error: 'Chỉ người giao việc huỷ được việc. Bạn nhắn xin huỷ để ' + t.by_name + ' quyết nhé.' };
    set.status = ch.status; if (ch.status === 'Xong') set.done_at = now; notes.push(ST_IC[ch.status] + ' ' + ch.status);
  }
  if (ch.due !== undefined && ch.due !== t.due) {
    if (!boss) { notes.push('🙏 xin lùi hạn sang ' + dueTxt({ due: ch.due, due_t: ch.dueT })); ch.ask = 1; } // người làm xin lùi: báo người giao duyệt, chưa đổi
    else { set.due = ch.due || null; set.due_t = ch.due && ch.dueT ? 1 : 0; set.rem = 0; notes.push('📅 đổi hạn → ' + dueTxt({ due: ch.due, due_t: ch.dueT })); }
  }
  if (ch.result) { set.result = clean(ch.result, 1000); notes.push('📎 ' + clean(ch.result, 300)); }
  if (ch.note) notes.push('💬 ' + clean(ch.note, 500));
  if (ch.title && boss) { set.title = clean(ch.title, 300); }
  if (ch.body !== undefined && boss) { set.body = clean(ch.body, 2000); }
  if (ch.who && boss && ch.who.email !== t.who_email) { set.who_email = ch.who.email; set.who_name = ch.who.name; set.status = 'Mới'; notes.push('👤 chuyển cho ' + ch.who.name); }
  if (!notes.length && !set.title && set.body === undefined) return { ok: true, t, same: 1 };
  const keys = Object.keys(set);
  if (keys.length) await run(x.db, 'UPDATE gv_tasks SET ' + keys.map(k => k + ' = ?').join(', ') + ', upd_at = ? WHERE id = ?', ...keys.map(k => set[k]), now, t.id);
  if (notes.length) await addLog(x, t.id, u.name, notes.join(' · '));
  const nt = await getTask(x, t.id);
  try {
    await refreshMsgs(x, C, nt);
    if (set.who_email) await announce(x, C, nt, { alsoPriv: 1 });
    if (notes.length) await tellBoss(x, C, nt, '<b>Việc #' + nt.id + '</b> (' + esc(nt.who_name) + '): ' + esc(nt.title) + '\n' + notes.map(esc).join('\n') + (ch.ask ? '\n👉 Đồng ý thì trả lời tin này: "ok lùi", hoặc sửa hạn trong CRM: ' + VIEW_URL : ''), u.email);
    if (boss && !mine && notes.length) { const w = (await staff(x)).find(z => z.email === nt.who_email); const p = w && await privChat(x, w); if (p) await say(x, C, p, '<b>Việc #' + nt.id + '</b>: ' + esc(nt.title) + '\n' + esc(u.name) + ': ' + notes.map(esc).join(' · ')); }
  } catch (e) { console.error('gv notify', e.message); }
  return { ok: true, t: nt };
}

/* ---------------------------------------------------------------- AI đọc câu giao việc */
let client = null;
function ai(env) { if (!client) client = new Anthropic({ apiKey: env.ANTHROPIC_API_KEY, maxRetries: 1, timeout: 25e3, fetch: aiFetch(env), defaultHeaders: { 'x-tdl-muc': 'giaoviec' } }); return client; }
/** "2026-11-20 17:00" / "2026-11-20" (giờ VN) → { due, dueT }. */
function parseDue(s) {
  const m = String(s || '').match(/(\d{4})-(\d{2})-(\d{2})(?:[ T](\d{1,2}):(\d{2}))?/); if (!m) return { due: null, dueT: 0 };
  const t = Date.UTC(+m[1], +m[2] - 1, +m[3], m[4] ? +m[4] : 9, m[5] ? +m[5] : 0) - TZ_MS;
  return isNaN(t) ? { due: null, dueT: 0 } : { due: t, dueT: m[4] ? 1 : 0 };
}
async function aiRead(x, u, C, text, ctxTask) {
  if (!x.env.ANTHROPIC_API_KEY) return null;
  const dk = 'gv_ai_' + fmtDate(Date.now(), 'yyMMdd'), n = Number(await kvGet(x.db, dk) || 0);
  if (n >= AI_DAY_MAX) return null;
  await kvSet(x.db, dk, String(n + 1), 2 * DAY);
  const ppl = await staff(x), lead = canAssign(u, C);
  const open = await all(x.db, `SELECT id, title, who_name, by_name, due, due_t, status FROM gv_tasks WHERE ${OPEN} ${lead ? '' : 'AND (who_email = ? OR by_email = ?)'} ORDER BY id DESC LIMIT 60`, ...(lead ? [] : [u.email, u.email]));
  const now = Date.now(), wd = ['Chủ nhật', 'Thứ Hai', 'Thứ Ba', 'Thứ Tư', 'Thứ Năm', 'Thứ Sáu', 'Thứ Bảy'][new Date(now + TZ_MS).getUTCDay()];
  const prompt = 'Hôm nay: ' + wd + ' ' + fmtDate(now, 'yyyy-MM-dd HH:mm') + ' (giờ Việt Nam). Công ty Thực Dưỡng Lành.\n' +
    'Người nhắn: ' + u.name + ' (' + u.role + ')' + (lead ? ', được giao việc cho người khác' : ', chỉ tự ghi việc cho chính mình') + '.\n' +
    'Nhân sự (tên trong CRM | vai trò): ' + ppl.map(z => z.name + ' | ' + z.role).join('; ') + '\n' +
    'Việc đang mở (id | việc | người làm | người giao | hạn | trạng thái):\n' + (open.map(t => t.id + ' | ' + t.title + ' | ' + t.who_name + ' | ' + t.by_name + ' | ' + (t.due ? fmtDate(t.due, t.due_t ? 'yyyy-MM-dd HH:mm' : 'yyyy-MM-dd') : '-') + ' | ' + t.status).join('\n') || '(chưa có)') + '\n' +
    (ctxTask ? 'Tin này là TRẢ LỜI cho việc #' + ctxTask.id + ' (' + ctxTask.title + ', của ' + ctxTask.who_name + ').\n' : '') +
    '\nTin nhắn:\n"""' + text.slice(0, 1500) + '"""\n\n' +
    'Trả về DUY NHẤT 1 khối JSON:\n{"loai":"giao|cap_nhat|hoi|khac",\n "viec":[{"nguoi":"tên đúng như danh sách nhân sự, hoặc \\"tôi\\"","viec":"việc cần làm, ngắn gọn, bắt đầu bằng động từ","han":"YYYY-MM-DD HH:mm hoặc YYYY-MM-DD hoặc rỗng","ghi_chu":""}],\n "cap_nhat":[{"id":0,"trang_thai":"Xong|Đang làm|Huỷ|","han_moi":"YYYY-MM-DD HH:mm hoặc YYYY-MM-DD hoặc rỗng","ket_qua":"link/kết quả nếu có","ghi_chu":""}],\n "tra_loi":"câu trả lời ngắn (tối đa 6 dòng) nếu người nhắn hỏi về việc, hoặc câu hỏi lại nếu chưa rõ ai làm / làm gì"}\n' +
    'Quy tắc: 1 tin có thể giao nhiều việc cho nhiều người. "Thứ Sáu" = thứ Sáu sắp tới. "cuối tuần" = Chủ nhật này. "sáng" = 09:00, "trưa" = 12:00, "chiều" = 17:00, "tối" = 20:00. Không rõ hạn thì để rỗng, không tự bịa. ' +
    'Tên gọi tắt/biệt danh ("Thủy", "chị Trang", "Hà mkt") thì chọn đúng người trong danh sách; không chắc người nào thì loai="khac" và hỏi lại trong tra_loi. Người nhắn tự nhận việc ("để em làm", "anh tự làm") thì nguoi="tôi".';
  let res;
  try { res = await ai(x.env).messages.create({ model: AI_MODEL, max_tokens: 1500, output_config: { effort: 'low' }, messages: [{ role: 'user', content: prompt }] }); }
  catch (e) { console.error('gv ai', e.message); return null; }
  const out = (res.content || []).filter(b => b.type === 'text').map(b => b.text).join('');
  const m = out.match(/\{[\s\S]*\}/); if (!m) return null;
  try { return JSON.parse(m[0]); } catch (e) { return null; }
}
function findPerson(ppl, name, me) {
  const n = nrm(name).replace(/^(anh|chi|em|ban|co|chu|a|c|e)\s+/, '');
  if (!n || n === 'toi' || n === 'minh' || n === 'em' || n === 'anh') return me;
  return ppl.find(z => nrm(z.name) === n) || ppl.find(z => nrm(z.name).endsWith(' ' + n)) || ppl.find(z => nrm(z.name).indexOf(n) >= 0) || null;
}

/* ---------------------------------------------------------------- nhận tin từ Telegram */
export async function gvRoute(x, req, path) {
  await schema(x.db);
  const C = await cfgOf(x);
  if (path === '/gv/tg/' + C.secret && C.secret && req.method === 'POST') {
    if (req.headers.get('X-Telegram-Bot-Api-Secret-Token') !== C.secret) return new Response('no', { status: 403 });
    const up = await req.json().catch(() => null);
    if (up) x.later(onUpdate(x, C, up).catch(e => console.error('gv update', e && e.stack || e))); // trả 200 ngay, AI đọc tin chạy nền (Telegram không gửi lặp)
    return new Response('ok');
  }
  if (path === '/gv/import' && req.method === 'POST') return gvImport(x, req, C);
  return null;
}

/* ---------------------------------------------------------------- 🎙 nhận việc từ biên bản họp (14/11/2026, anh Sơn duyệt)
 * Bot Zoom của web cá nhân (dinhminhthaison.com, worker/hoc.js) gửi việc sau cuộc họp: POST /gv/import, header x-gv-key = env.GV_IMPORT_KEY.
 * Body { src: 'hop', meeting, tasks: [{ who, title, body, due: 'YYYY-MM-DD' | '' }] }. Người giao = anh Sơn, hạn = cuối ngày due.
 * Tên không khớp đúng 1 nhân sự đang hoạt động (không dấu: họ tên đầy đủ, hoặc tên gọi / phần cuối họ tên) → không tạo, trả về unknown. */
const BOSS = 'thaisoniph@gmail.com';
const HONOR = /^(anh|chi|em|ban|co|chu|bac|a|c|e|mr|ms|mrs)\.?\s+/;
/** Khớp tên trong cuộc họp với nhân sự. Trả về [người] (0, 1 hoặc nhiều). */
export function gvMatch(ppl, who) {
  const n = nrm(who).replace(/[^a-z0-9 ]/g, ' ').replace(/\s+/g, ' ').trim().replace(HONOR, '');
  if (!n) return [];
  const full = ppl.filter(z => nrm(z.name) === n);
  if (full.length) return full;
  return ppl.filter(z => nrm(z.name).endsWith(' ' + n));
}
/** 'YYYY-MM-DD' → 23:59 giờ Việt Nam của ngày đó (due_t = 0: chỉ ngày, trễ hạn tính từ hết ngày). */
function endOfDay(s) {
  const m = String(s || '').match(/^(\d{4})-(\d{2})-(\d{2})$/); if (!m) return null;
  const t = Date.UTC(+m[1], +m[2] - 1, +m[3], 23, 59) - TZ_MS;
  return isNaN(t) ? null : t;
}
function sameKey(a, b) { if (!a || !b || a.length !== b.length) return false; let r = 0; for (let i = 0; i < a.length; i++) r |= a.charCodeAt(i) ^ b.charCodeAt(i); return r === 0; }
async function gvImport(x, req, C) {
  const j = (o, st) => new Response(JSON.stringify(o), { status: st || 200, headers: { 'Content-Type': 'application/json; charset=utf-8' } });
  const key = x.env.GV_IMPORT_KEY;
  if (!key || !sameKey(String(req.headers.get('x-gv-key') || ''), String(key))) return j({ ok: false, error: 'Sai khoá' }, 401);
  const d = await req.json().catch(() => null);
  if (!d || !Array.isArray(d.tasks)) return j({ ok: false, error: 'Thiếu danh sách việc (tasks)' }, 400);
  const meeting = clean(d.meeting, 200), ppl = await staff(x);
  const by = ppl.find(z => z.email === BOSS) || { email: BOSS, name: 'Thái Sơn' };
  const made = [], unknown = [], skipped = [];
  for (const v of d.tasks.slice(0, 40)) {
    const title = clean(v && v.title, 300); if (!title) continue;
    const who = clean(v.who, 80), hit = gvMatch(ppl, who);
    if (hit.length !== 1) { unknown.push(who || '(không ghi tên)'); continue; }
    const w = hit[0];
    // bot gửi lại lần 2 (mạng chập chờn) → không tạo trùng
    const dup = await first(x.db, `SELECT id FROM gv_tasks WHERE src = 'hop' AND who_email = ? AND title = ? AND at > ?`, w.email, title, Date.now() - 3 * DAY);
    if (dup) { skipped.push({ who: w.name, title, id: dup.id }); continue; }
    const body = [clean(v.body, 1700), meeting ? 'Từ cuộc họp: ' + meeting : ''].filter(Boolean).join('\n');
    const t = await createTask(x, C, by, w, { title, body, due: endOfDay(v.due), dueT: 0 }, 'hop');
    if (C.token) { try { await announce(x, C, t, { alsoPriv: 1 }); } catch (e) { console.error('gv import announce', e.message); } }
    made.push({ who: w.name, title, id: t.id });
  }
  return j({ ok: true, made, unknown, skipped });
}
async function whoIs(x, from) {
  const id = String(from && from.id || ''); if (!id) return null;
  const ppl = await staff(x);
  for (const z of ppl) if (await kvGet(x.db, 'gv_tg_' + z.email) === id) return z;
  return ppl.find(z => z.tg === id) || null;
}
async function onUpdate(x, C, up) {
  if (up.my_chat_member) { // bot vừa được thêm vào nhóm
    const m = up.my_chat_member, ch = m.chat, st = m.new_chat_member && m.new_chat_member.status;
    if (ch && ch.type !== 'private' && (st === 'member' || st === 'administrator') && String(ch.id) !== String(C.group))
      await say(x, C, ch.id, '👋 Chào cả nhà! Em là trợ lý giao việc của Thực Dưỡng Lành.\nAnh Sơn hoặc Quản lý gõ <b>/noinhom</b> trong nhóm này để em gửi việc vào đây.');
    return;
  }
  if (up.callback_query) return onButton(x, C, up.callback_query);
  const msg = up.message; if (!msg || !msg.from || msg.from.is_bot) return;
  const chat = msg.chat, priv = chat.type === 'private', text = String(msg.text || msg.caption || '').trim();
  const reply = (t, extra) => say(x, C, chat.id, t, Object.assign({ reply_to_message_id: msg.message_id, allow_sending_without_reply: true }, extra || {}));
  // nối tài khoản: /start <mã> từ nút Kết nối trong CRM
  const st = text.match(/^\/start(?:@\w+)?\s+([a-f0-9]{10})$/);
  if (st && priv) {
    const email = await kvGet(x.db, 'gvl_' + st[1]);
    if (!email) return reply('Mã kết nối đã hết hạn. Vào CRM → ✅ Giao việc → bấm <b>Kết nối Telegram</b> lại nhé.');
    await kvSet(x.db, 'gv_tg_' + email, String(chat.id)); await kvDel(x.db, 'gvl_' + st[1]);
    const z = (await staff(x)).find(y => y.email === email);
    return reply('✅ Đã nối với CRM cho <b>' + esc(z ? z.name : email) + '</b>.\nTừ giờ việc được giao, lời nhắc hạn và danh sách việc 8h sáng sẽ gửi riêng cho bạn ở đây.\n\nGõ /viec để xem việc của bạn.');
  }
  const u = await whoIs(x, msg.from);
  const mentioned = C.bot && new RegExp('@' + C.bot, 'i').test(text);
  const rid = msg.reply_to_message && msg.reply_to_message.message_id;
  const rTask = rid ? await first(x.db, 'SELECT task FROM gv_msg WHERE chat = ? AND msg = ?', String(chat.id), rid) : null;
  const cmd = (text.match(/^\/(\w+)/) || [])[1];
  if (!priv && !mentioned && !rTask && !cmd) return; // trong nhóm: chỉ đọc tin gọi tên bot, trả lời tin việc, hoặc lệnh /
  if (!u) return reply('Em chưa biết bạn là ai trong CRM. Bạn vào CRM → <b>✅ Giao việc</b> → bấm <b>Kết nối Telegram</b> (30 giây) rồi nhắn lại nhé.\n' + VIEW_URL);
  if (cmd === 'start' && priv) { await kvSet(x.db, 'gv_tg_' + u.email, String(chat.id)); return reply('Chào ' + esc(shortName(u.name)) + '! 👋\n' + helpText(u, C)); }
  if (cmd === 'noinhom') {
    if (priv) return reply('Gõ /noinhom ở trong nhóm Telegram muốn dùng nhé.');
    if (u.level < 2) return reply('Chỉ anh Sơn hoặc Quản lý nối được nhóm.');
    C.group = String(chat.id); C.groupName = chat.title || ''; await cfgSet(x, C);
    return reply('✅ Từ giờ việc giao sẽ gửi vào nhóm <b>' + esc(chat.title || '') + '</b>.\n' + helpText(u, C));
  }
  if (cmd === 'help' || cmd === 'huongdan') return reply(helpText(u, C));
  if (cmd === 'viec') return reply(await listText(x, C, u, 'me'));
  if (cmd === 'phong' || cmd === 'ca') return reply(await listText(x, C, u, 'all'));
  const body = text.replace(new RegExp('@' + (C.bot || '-'), 'ig'), '').replace(/^\/\w+(@\w+)?/, '').trim();
  const ctxTask = rTask ? await getTask(x, rTask.task) : null;
  const file = msg.photo || msg.document || msg.video;
  // trả lời nhanh vào tin việc, không tốn AI
  if (ctxTask) {
    const b = nrm(body);
    if (file && !b) { const r = await changeTask(x, C, u, ctxTask, { note: '📎 đã gửi ' + (msg.photo ? 'ảnh' : msg.video ? 'video' : 'file') + ' kết quả trong Telegram' }); return r.ok ? null : reply(esc(r.error)); }
    if (/^(xong|da xong|xong roi|done|hoan thanh|da hoan thanh|ok xong)\b/.test(b)) { const r = await changeTask(x, C, u, ctxTask, { status: 'Xong', result: /https?:\/\//.test(body) ? body : '', note: file ? '📎 có gửi kèm file' : '' }); return reply(r.ok ? '✅ Đã ghi xong việc #' + ctxTask.id + '. Cảm ơn ' + esc(shortName(u.name)) + '!' : esc(r.error)); }
    if (/^(nhan|em nhan|da nhan|ok|oke|okie|vang|da vang|da)\b/.test(b) && b.length < 25 && ctxTask.who_email === u.email) { const r = await changeTask(x, C, u, ctxTask, { status: 'Đang làm' }); return reply(r.ok ? '⏳ ' + esc(shortName(u.name)) + ' đã nhận việc #' + ctxTask.id + '.' : esc(r.error)); }
  }
  if (!body && !file) return reply(helpText(u, C));
  const J = await aiRead(x, u, C, body || '(gửi ảnh/file)', ctxTask);
  if (!J) return reply('Em chưa đọc được tin này (AI tạm nghỉ). Bạn giao trong CRM giúp em nhé: ' + VIEW_URL);
  const ppl = await staff(x), lines = [];
  if (J.loai === 'giao' && Array.isArray(J.viec) && J.viec.length) {
    for (const v of J.viec.slice(0, 10)) {
      const w = findPerson(ppl, v.nguoi, u);
      if (!w) { lines.push('❓ Chưa rõ "' + esc(v.nguoi) + '" là ai trong CRM, việc "' + esc(v.viec) + '" chưa giao.'); continue; }
      if (w.email !== u.email && !canAssign(u, C)) { lines.push('🙏 Bạn chỉ tự ghi việc cho mình được. Việc cho ' + esc(w.name) + ' nhờ anh Sơn / Quản lý giao nhé.'); continue; }
      const d = parseDue(v.han), t = await createTask(x, C, u, w, { title: v.viec, body: v.ghi_chu, due: d.due, dueT: d.dueT }, 'tg');
      const sent = await announce(x, C, t, { alsoPriv: priv ? 1 : 0 });
      lines.push('✅ #' + t.id + ' ' + esc(w.name) + ': ' + esc(t.title) + ' · ' + esc(dueTxt(t)) + (sent ? '' : ' (' + esc(shortName(w.name)) + ' chưa nối Telegram, sẽ thấy trong CRM)'));
    }
    if (!(C.group && String(chat.id) === String(C.group)) || lines.some(l => !/^✅/.test(l))) await reply(lines.join('\n') || 'Không có việc nào được giao.');
    else if (lines.length > 1) await reply('Đã giao ' + lines.length + ' việc ✓');
    return;
  }
  if (J.loai === 'cap_nhat' && Array.isArray(J.cap_nhat) && J.cap_nhat.length) {
    for (const c of J.cap_nhat.slice(0, 10)) {
      const t = await getTask(x, c.id || (ctxTask && ctxTask.id)); if (!t) { lines.push('❓ Không thấy việc #' + esc(c.id)); continue; }
      const d = c.han_moi ? parseDue(c.han_moi) : null;
      const r = await changeTask(x, C, u, t, { status: GV_ST.indexOf(c.trang_thai) >= 0 ? c.trang_thai : '', due: d ? d.due : undefined, dueT: d ? d.dueT : 0, result: c.ket_qua || '', note: c.ghi_chu || (file ? '📎 có gửi kèm file' : '') });
      lines.push(r.ok ? (r.same ? 'ℹ️ Việc #' + t.id + ' không có gì thay đổi.' : '✓ Việc #' + t.id + ': ' + esc((r.t || t).status) + (d && t.who_email === u.email && t.by_email !== u.email && !canAssign(u, C) ? ' · đã gửi ' + esc(t.by_name) + ' duyệt lùi hạn' : '')) : '⚠️ ' + esc(r.error));
    }
    return reply(lines.join('\n'));
  }
  if (ctxTask && body) { await changeTask(x, C, u, ctxTask, { note: body }); return reply(J.tra_loi ? esc(J.tra_loi) : '💬 Đã ghi vào việc #' + ctxTask.id + ' và báo ' + esc(ctxTask.by_name) + '.'); }
  return reply(esc(J.tra_loi || 'Em chưa hiểu ý. ') + (J.loai === 'khac' && !J.tra_loi ? '\n' + helpText(u, C) : ''));
}
async function onButton(x, C, q) {
  const m = String(q.data || '').match(/^gv:(nhan|xong):(\d+)$/), ans = (t, alert) => tg(x, C, 'answerCallbackQuery', { callback_query_id: q.id, text: t, show_alert: !!alert });
  if (!m) return ans('');
  const u = await whoIs(x, q.from); if (!u) return ans('Bạn chưa nối CRM: vào CRM → ✅ Giao việc → Kết nối Telegram.', true);
  const t = await getTask(x, m[2]); if (!t) return ans('Không thấy việc này.', true);
  if (m[1] === 'nhan' && t.who_email !== u.email) return ans('Việc này giao cho ' + t.who_name + ', chỉ ' + shortName(t.who_name) + ' bấm nhận được.', true);
  const r = await changeTask(x, C, u, t, { status: m[1] === 'nhan' ? 'Đang làm' : 'Xong' });
  return ans(r.ok ? (m[1] === 'nhan' ? '⏳ Đã nhận việc' : '✅ Đã ghi xong. Cảm ơn bạn!') : r.error, !r.ok);
}
function helpText(u, C) {
  const lead = canAssign(u, C), b = C.bot ? '@' + C.bot : 'bot';
  return '<b>Cách dùng</b>\n' + (lead ? '• Giao việc: <i>' + b + ' giao Trang gửi bảng lương trước 17h thứ Sáu</i> (1 tin giao được nhiều người)\n' : '• Tự ghi việc: <i>' + b + ' em làm báo cáo tuần, hạn thứ Hai</i>\n') +
    '• Bấm <b>✋ Nhận việc</b> / <b>✅ Xong</b> ngay dưới tin việc\n• Trả lời (reply) tin việc: <i>xong rồi + link</i>, <i>xin lùi sang thứ Hai</i>, gửi ảnh kết quả\n• /viec: việc của tôi' + (lead ? ' · /phong: việc cả công ty' : '') + '\n• Xem đủ trong CRM: ' + VIEW_URL;
}
async function listText(x, C, u, scope) {
  const all_ = scope === 'all' && canAssign(u, C), now = Date.now();
  const rows = await all(x.db, `SELECT * FROM gv_tasks WHERE ${OPEN} ${all_ ? '' : 'AND who_email = ?'} ORDER BY (due IS NULL), due, id LIMIT 80`, ...(all_ ? [] : [u.email]));
  if (!rows.length) return all_ ? '🎉 Không còn việc nào đang mở.' : '🎉 ' + esc(shortName(u.name)) + ' không còn việc nào đang mở.';
  const line = t => (late(t, now) ? '🔴' : ST_IC[t.status]) + ' #' + t.id + ' ' + esc(t.title) + ' · ' + esc(dueTxt(t)) + (all_ ? '' : ' · ' + esc(shortName(t.by_name)) + ' giao');
  if (!all_) return '<b>Việc của ' + esc(u.name) + '</b> (' + rows.length + ')\n' + rows.map(line).join('\n');
  const by = {}; rows.forEach(t => (by[t.who_name] || (by[t.who_name] = [])).push(t));
  return '<b>Việc đang mở cả công ty</b> (' + rows.length + ')\n' + Object.keys(by).map(n => '\n<b>' + esc(n) + '</b>\n' + by[n].map(line).join('\n')).join('\n');
}

/* ---------------------------------------------------------------- nhắc việc (cron) */
/** Mỗi lượt cron (10 phút, 7h–22h): việc có giờ hạn → nhắc trước ~1 tiếng; quá hạn → báo người làm + người giao (mỗi việc 1 lần). */
export async function gvTick(x) {
  const C = await cfgOf(x); if (!C.token) return;
  await schema(x.db);
  const now = Date.now(), ppl = await staff(x);
  const soon = await all(x.db, `SELECT * FROM gv_tasks WHERE ${OPEN} AND due_t = 1 AND rem = 0 AND due > ? AND due <= ?`, now, now + 70 * 60e3);
  for (const t of soon) {
    await run(x.db, 'UPDATE gv_tasks SET rem = 1 WHERE id = ?', t.id);
    const w = ppl.find(z => z.email === t.who_email); if (!w) continue;
    const p = await privChat(x, w), txt = '⏰ Còn khoảng 1 tiếng tới hạn <b>việc #' + t.id + '</b> (' + fmtDate(t.due, 'HH:mm') + '): ' + esc(t.title) + '\nXong rồi thì bấm ✅ hoặc trả lời "xong" vào tin việc nhé.';
    if (p) await say(x, C, p, txt); else if (C.group) await say(x, C, C.group, mention(w, w.tg) + ' ' + txt);
  }
  const over = (await all(x.db, `SELECT * FROM gv_tasks WHERE ${OPEN} AND rem < 2 AND due IS NOT NULL AND due < ?`, now)).filter(t => late(t, now));
  for (const t of over) {
    await run(x.db, 'UPDATE gv_tasks SET rem = 2 WHERE id = ?', t.id);
    const w = ppl.find(z => z.email === t.who_email); if (!w) continue;
    const p = await privChat(x, w), txt = '🔴 <b>Việc #' + t.id + '</b> đã quá hạn (' + esc(dueTxt(t)) + '): ' + esc(t.title) + '\nXong rồi thì bấm ✅; cần thêm thời gian thì trả lời tin việc "xin lùi sang …" để ' + esc(t.by_name) + ' biết.';
    if (p) await say(x, C, p, txt); else if (C.group) await say(x, C, C.group, mention(w, w.tg) + ' ' + txt);
    await tellBoss(x, C, t, '🔴 Việc #' + t.id + ' của <b>' + esc(t.who_name) + '</b> đã quá hạn: ' + esc(t.title), t.who_email);
  }
}
/** 8h sáng: mỗi người (đã nối bot) nhận danh sách việc của mình; nhóm nhận bảng việc hôm nay + trễ hạn; thứ Hai người giao nhận tổng kết tuần. */
export async function gvMorning(x) {
  const C = await cfgOf(x); if (!C.token) return;
  await schema(x.db);
  const now = Date.now(), d0 = startOfDay(now), ppl = await staff(x);
  const open = await all(x.db, `SELECT * FROM gv_tasks WHERE ${OPEN} ORDER BY (due IS NULL), due, id`);
  const line = t => (late(t, now) ? '🔴' : ST_IC[t.status]) + ' #' + t.id + ' ' + esc(t.title) + ' · ' + esc(dueTxt(t));
  for (const w of ppl) {
    const mine = open.filter(t => t.who_email === w.email); if (!mine.length) continue;
    const p = await privChat(x, w); if (!p) continue;
    const lateN = mine.filter(t => late(t, now)).length, todayN = mine.filter(t => t.due && startOfDay(t.due) === d0).length;
    await say(x, C, p, '☀️ Chào ' + esc(shortName(w.name)) + '! Hôm nay bạn có <b>' + mine.length + '</b> việc' + (todayN ? ', ' + todayN + ' việc hạn hôm nay' : '') + (lateN ? ', <b>' + lateN + ' việc trễ hạn</b>' : '') + ':\n' + mine.slice(0, 25).map(line).join('\n') + '\n\nTrả lời "xong" vào tin việc hoặc bấm ✅ khi làm xong nhé.');
  }
  if (C.group) {
    const hot = open.filter(t => late(t, now) || (t.due && startOfDay(t.due) === d0));
    if (hot.length) {
      const by = {}; hot.forEach(t => (by[t.who_email] || (by[t.who_email] = [])).push(t));
      await say(x, C, C.group, '☀️ <b>Việc hôm nay</b> (' + hot.length + ' việc hạn hôm nay hoặc đã trễ)\n' + Object.keys(by).map(e => { const w = ppl.find(z => z.email === e) || { name: by[e][0].who_name }; return '\n' + mention(w, w.tg) + '\n' + by[e].map(line).join('\n'); }).join('\n'));
    }
  }
  if (new Date(now + TZ_MS).getUTCDay() === 1) { // thứ Hai: tổng kết tuần cho từng người giao việc
    const wk = await all(x.db, 'SELECT * FROM gv_tasks WHERE (done_at >= ? OR ' + OPEN + ') AND status <> \'Huỷ\'', now - 7 * DAY);
    const bosses = {}; wk.forEach(t => { if (t.by_email !== t.who_email) (bosses[t.by_email] || (bosses[t.by_email] = [])).push(t); });
    for (const e of Object.keys(bosses)) {
      const b = ppl.find(z => z.email === e); if (!b) continue; const p = await privChat(x, b); if (!p) continue;
      const by = {}; bosses[e].forEach(t => { const o = by[t.who_name] || (by[t.who_name] = { ok: 0, lateDone: 0, open: 0, late: 0 }); if (t.status === 'Xong') { if (t.due && t.done_at > (t.due_t ? t.due : startOfDay(t.due) + DAY)) o.lateDone++; else o.ok++; } else { o.open++; if (late(t, now)) o.late++; } });
      await say(x, C, p, '📊 <b>Tổng kết tuần việc bạn giao</b>\n' + Object.keys(by).map(n => { const o = by[n]; return '• <b>' + esc(n) + '</b>: ✅ ' + o.ok + ' đúng hạn' + (o.lateDone ? ' · 🟠 ' + o.lateDone + ' xong trễ' : '') + (o.open ? ' · ⏳ ' + o.open + ' còn mở' : '') + (o.late ? ' (🔴 ' + o.late + ' trễ)' : ''); }).join('\n') + '\n\nXem chi tiết: ' + VIEW_URL);
    }
  }
}

/* ---------------------------------------------------------------- CRM */
async function gvList(x, u, d) {
  await schema(x.db);
  const C = await cfgOf(x), lead = canAssign(u, C), now = Date.now();
  const rows = await all(x.db, `SELECT * FROM gv_tasks WHERE (${OPEN} OR upd_at > ?) ${lead ? '' : 'AND (who_email = ? OR by_email = ?)'} ORDER BY id DESC LIMIT 400`, now - 30 * DAY, ...(lead ? [] : [u.email, u.email]));
  const ids = rows.map(t => t.id), logs = ids.length ? await all(x.db, `SELECT task, at, by_name, text FROM gv_log WHERE task IN (${ids.map(() => '?').join(',')}) ORDER BY id`, ...ids) : [];
  const L = {}; logs.forEach(l => (L[l.task] || (L[l.task] = [])).push({ at: l.at, by: l.by_name, text: l.text }));
  const ppl = await staff(x), linked = {};
  for (const z of ppl) linked[z.email] = !!(await kvGet(x.db, 'gv_tg_' + z.email));
  const tasks = rows.map(t => ({ id: t.id, title: t.title, body: t.body, who: t.who_name, whoE: t.who_email, by: t.by_name, byE: t.by_email, due: t.due, dueT: t.due_t ? 1 : 0, st: t.status, at: t.at, upd: t.upd_at, done: t.done_at, src: t.src, result: t.result, late: late(t, now) ? 1 : 0, log: L[t.id] || [] }));
  const out = { tasks, me: u.email, lead: lead ? 1 : 0, admin: u.level >= 3 ? 1 : 0, linked: linked[u.email] ? 1 : 0, bot: C.bot, group: C.groupName || (C.group ? 'đã nối' : ''), on: C.token ? 1 : 0, ai: x.env.ANTHROPIC_API_KEY ? 1 : 0,
    staff: ppl.map(z => ({ email: z.email, name: z.name, role: z.role, tg: linked[z.email] || !!z.tg ? 1 : 0, lead: canAssign(z, C) ? 1 : 0, lv: z.level })) };
  if (u.level >= 3) out.leads = C.leads || [];
  return { ok: true, gv: out };
}
async function gvSave(x, u, d) {
  await schema(x.db);
  const C = await cfgOf(x), ppl = await staff(x), w = ppl.find(z => z.email === String(d.who || '').toLowerCase()) || (d.id ? null : u);
  const due = Number(d.due) || null, dueT = d.dueT ? 1 : 0;
  if (Number(d.id)) {
    const t = await getTask(x, d.id); if (!t) return { ok: false, error: 'Không thấy việc này.' };
    const r = await changeTask(x, C, u, t, { title: d.title, body: d.body, due, dueT, who: w && w.email !== t.who_email ? w : null });
    return r.ok ? gvList(x, u) : r;
  }
  const title = clean(d.title, 300); if (!title) return { ok: false, error: 'Bạn ghi việc cần làm nhé.' };
  if (!w) return { ok: false, error: 'Chọn người làm.' };
  if (w.email !== u.email && !canAssign(u, C)) return { ok: false, error: 'Bạn chỉ tự ghi việc cho mình. Việc cho người khác nhờ anh Sơn / Quản lý giao nhé.' };
  const t = await createTask(x, C, u, w, { title, body: d.body, due, dueT }, 'crm');
  let sent = 0; if (C.token && d.tg !== false) { try { sent = await announce(x, C, t, { alsoPriv: 1 }); } catch (e) { console.error('gv announce', e.message); } }
  const r = await gvList(x, u); r.sent = sent; return r;
}
async function gvSet(x, u, d) {
  const C = await cfgOf(x), t = await getTask(x, d.id); if (!t) return { ok: false, error: 'Không thấy việc này.' };
  const r = await changeTask(x, C, u, t, { status: GV_ST.indexOf(d.st) >= 0 ? d.st : '', note: d.note, result: d.result });
  return r.ok ? gvList(x, u) : r;
}
async function gvLink(x, u) {
  const C = await cfgOf(x); if (!C.token || !C.bot) return { ok: false, error: 'Anh Sơn chưa cài bot giao việc.' };
  const code = randHex(5); await kvSet(x.db, 'gvl_' + code, u.email, 3600e3);
  return { ok: true, url: 'https://t.me/' + C.bot + '?start=' + code };
}
/** Quản trị: dán khoá bot (BotFather) → kiểm tra, bật webhook; chọn người được giao việc; bỏ nối nhóm. */
async function gvCfg(x, u, d) {
  if (u.level < 3) return { ok: false, error: 'Chỉ Quản trị cài được bot giao việc.' };
  const C = await cfgOf(x);
  if (d.bot !== undefined) {
    const tok = String(d.bot || '').trim();
    if (!/^\d{6,}:[\w-]{30,}$/.test(tok)) return { ok: false, error: 'Khoá bot chưa đúng. Khoá có dạng 123456789:ABC… (BotFather gửi sau khi tạo bot).' };
    const me = await tg(x, { token: tok }, 'getMe', {});
    if (!me || !me.ok) return { ok: false, error: 'Telegram không nhận khoá này (' + (me && me.description || 'không kết nối được') + ').' };
    if (me.result.username === 'thucduonglanh_donhang_bot') return { ok: false, error: 'Đây là bot báo đơn. Cần tạo 1 bot MỚI riêng cho giao việc.' };
    const secret = randHex(16);
    const wh = await tg(x, { token: tok }, 'setWebhook', { url: API + '/gv/tg/' + secret, secret_token: secret, allowed_updates: ['message', 'callback_query', 'my_chat_member'], drop_pending_updates: true });
    if (!wh || !wh.ok) return { ok: false, error: 'Không bật được nhận tin (' + (wh && wh.description || '') + ').' };
    await tg(x, { token: tok }, 'setMyCommands', { commands: [{ command: 'viec', description: 'Việc của tôi' }, { command: 'phong', description: 'Việc cả công ty (người giao việc)' }, { command: 'help', description: 'Cách dùng' }, { command: 'noinhom', description: 'Dùng nhóm này để giao việc (Quản lý)' }] });
    Object.assign(C, { token: tok, bot: me.result.username, secret });
  }
  if (Array.isArray(d.leads)) C.leads = d.leads.map(e => String(e).toLowerCase()).filter(e => /@/.test(e)).slice(0, 30);
  if (d.ungroup) { C.group = ''; C.groupName = ''; }
  if (d.off) { if (C.token) await tg(x, C, 'deleteWebhook', {}); Object.assign(C, { token: '', bot: '', secret: '' }); }
  await cfgSet(x, C);
  return gvList(x, u);
}
export async function crmGv(x, u, d) {
  const a = d.action;
  if (a === 'gv_list') return gvList(x, u, d);
  if (a === 'gv_save') return gvSave(x, u, d);
  if (a === 'gv_set') return gvSet(x, u, d);
  if (a === 'gv_link') return gvLink(x, u);
  if (a === 'gv_cfg') return gvCfg(x, u, d);
  return { ok: false, error: 'Không rõ thao tác: ' + a };
}
