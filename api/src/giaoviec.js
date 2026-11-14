/* ================================================================ ✅ Việc tuần · cùng làm qua Telegram (14–15/11/2026, anh Sơn chọn: lưu trong CRM, mọi nhân sự, giữ Notion song song)
 * Nhịp tuần (anh Sơn 15/11/2026):
 *   - Mỗi người tối đa 3 việc ⭐ TRỌNG TÂM / tuần; việc PHÁT SINH ghi thêm thoải mái.
 *   - Chốt việc trọng tâm trước 9h sáng thứ Ba · cập nhật tiến độ trước 21h thứ Năm · chốt kết quả + link minh chứng trước 21h Chủ nhật.
 *   - Thứ Hai họp: CRM có sẵn báo cáo từng người (cam kết → thực tế → đúng hạn? → minh chứng), theo "Quy trình họp tuần" trên Notion.
 *   - Việc tạo ra phải rõ và đo được: ô "Thế nào là xong" bắt buộc; việc trọng tâm viết mơ hồ → AI gợi ý viết lại.
 *   - Việc trọng tâm chỉ ghi Xong khi có kết quả + minh chứng (link, hoặc ảnh / file gửi trong Telegram).
 * Giọng "cùng làm": ai cũng nhờ được ai (việc phát sinh); việc trọng tâm của người khác chỉ Quản lý / người được cấp quyền đặt; việc trễ chỉ nhắc riêng,
 *   xong việc thì bot cảm ơn trong nhóm.
 * Telegram: bot RIÊNG (không dùng @thucduonglanh_donhang_bot: bot đó đọc tin bằng getUpdates; bật webhook sẽ hỏng nút "Kết nối Telegram").
 *   Câu tự nhiên → AI (Haiku) tách người / việc / kết quả cần đạt / hạn. Nút bấm và trả lời "xong + link" không tốn AI.
 * Notion song song (một chiều CRM → Notion): mỗi việc là 1 dòng trong "VitaGreen TDL. Công việc & Mục tiêu tuần" (gvNotionTick).
 * 🎙 Việc từ biên bản họp: POST /gv/import (gvImport, phiên "Nhận việc từ cuộc họp" 14/11/2026) → việc phát sinh, src 'hop'.
 * Dữ liệu: D1 gv_tasks, gv_log, gv_msg (tin Telegram ↔ việc), gv_wk (việc thuộc tuần nào, kể cả tuần bị chuyển). kv gv_cfg, gv_tg_<email>. */
import Anthropic from '@anthropic-ai/sdk';
import { aiFetch } from './airelay.js';
import { run, all, first, esc, DAY, TZ_MS, CRM_URL, kvGet, kvSet, kvDel, kvJson, fmtDate, startOfDay, randHex, nrm, md5hex } from './lib.js';
import { crmUsers } from './crm.js';

const API = 'https://api.thucduonglanh.vn';
const AI_MODEL = 'claude-haiku-5-5';
const AI_DAY_MAX = 400;
export const GV_ST = ['Mới', 'Đang làm', 'Xong', 'Huỷ'];
const OPEN = "status IN ('Mới', 'Đang làm')";
const OPEN_T = "t.status IN ('Mới', 'Đang làm')";
const VIEW_URL = CRM_URL + '/#giao-viec';
const MAX_TT = 3;
const PACE = { ok: '🟢 Đúng tiến độ', risk: '🟡 Có thể trễ', help: '🔴 Cần hỗ trợ' };
const ST_TX = { 'Mới': 'Chưa nhận', 'Đang làm': 'Đang làm', 'Xong': 'Xong rồi', 'Huỷ': 'Đã dừng' };
const ST_IC = { 'Mới': '🆕', 'Đang làm': '⏳', 'Xong': '✅', 'Huỷ': '✖️' };
const NOTION_DB = 'bc08c03ee8004e3080f17f2cb1bab6c5'; // ✅ VitaGreen TDL. Công việc & Mục tiêu tuần
const NV = '2022-06-28';

let schemaOk = false;
async function schema(db) {
  if (schemaOk) return;
  await run(db, `CREATE TABLE IF NOT EXISTS gv_tasks (id INTEGER PRIMARY KEY AUTOINCREMENT, title TEXT, body TEXT DEFAULT '', who_email TEXT, who_name TEXT, by_email TEXT, by_name TEXT,
    due INTEGER, due_t INTEGER DEFAULT 0, status TEXT DEFAULT 'Mới', at INTEGER, upd_at INTEGER, done_at INTEGER, src TEXT DEFAULT 'crm', rem INTEGER DEFAULT 0, result TEXT DEFAULT '')`);
  const cols = (await all(db, 'PRAGMA table_info(gv_tasks)')).map(c => c.name);
  for (const [c, def] of [['kind', "TEXT DEFAULT 'ps'"], ['goal', "TEXT DEFAULT ''"], ['week', 'INTEGER'], ['pace', "TEXT DEFAULT ''"], ['pace_at', 'INTEGER'], ['next', "TEXT DEFAULT ''"], ['block', "TEXT DEFAULT ''"],
    ['proof', "TEXT DEFAULT ''"], ['carry', 'INTEGER DEFAULT 0'], ['qa', "TEXT DEFAULT ''"], ['helpers', "TEXT DEFAULT ''"], ['nid', "TEXT DEFAULT ''"], ['ndirty', 'INTEGER DEFAULT 1'], ['ntry', 'INTEGER DEFAULT 0'], ['nerr', "TEXT DEFAULT ''"]])
    if (!cols.includes(c)) { try { await run(db, `ALTER TABLE gv_tasks ADD COLUMN ${c} ${def}`); } catch (e) { } }
  await run(db, `CREATE TABLE IF NOT EXISTS gv_log (id INTEGER PRIMARY KEY AUTOINCREMENT, task INTEGER, at INTEGER, by_name TEXT, text TEXT)`);
  await run(db, `CREATE TABLE IF NOT EXISTS gv_msg (chat TEXT, msg INTEGER, task INTEGER, at INTEGER, PRIMARY KEY (chat, msg))`);
  await run(db, `CREATE TABLE IF NOT EXISTS gv_wk (task INTEGER, week INTEGER, PRIMARY KEY (task, week))`);
  schemaOk = true;
}

const clean = (s, n) => String(s || '').replace(/\r/g, '').trim().slice(0, n);
const staff = async x => (await crmUsers(x)).filter(z => z.active);
async function cfgOf(x) { return Object.assign({ token: '', bot: '', secret: '', group: '', groupName: '', leads: [], out: [], notion: null }, await kvJson(x.db, 'gv_cfg', {})); }
async function cfgSet(x, c) { await kvSet(x.db, 'gv_cfg', JSON.stringify(c)); }
/** Đặt việc trọng tâm cho người khác, dừng việc, nghiệm thu: Quản trị, Quản lý, người được tích (vd trưởng phòng Marketing). */
function canAssign(u, C) { return u.level >= 2 || (C.leads || []).indexOf(u.email) >= 0; }
const shortName = n => String(n || '').trim().split(/\s+/).pop();
/** Thứ Hai 0h (giờ VN) của tuần chứa t. */
export function weekOf(t) { const d = startOfDay(t); return d - ((new Date(d + TZ_MS).getUTCDay() + 6) % 7) * DAY; }
const wkLabel = w => fmtDate(w, 'dd/MM') + '–' + fmtDate(w + 6 * DAY, 'dd/MM');
const helpersOf = t => String(t.helpers || '').split(',').filter(Boolean);
/** Người tham gia nhịp tuần: mọi nhân sự đang làm, trừ người Quản trị bỏ tích. */
async function members(x, C) { return (await staff(x)).filter(z => (C.out || []).indexOf(z.email) < 0); }
const hasLink = s => /https?:\/\/\S+/.test(String(s || ''));
const linkOf = s => (String(s || '').match(/https?:\/\/\S+/) || [''])[0].replace(/[),.;]+$/, '');
function proofUrl(C, t) { if (!t.proof) return ''; if (/^tg:/.test(t.proof)) return API + '/gv/f/' + t.id + '/' + md5hex((C.secret || 'x') + ':' + t.id).slice(0, 12); return t.proof; }
/** Việc trọng tâm chỉ ghi Xong khi có kết quả thực tế + minh chứng. */
const needProof = t => t.kind === 'tt';

/* ---------------------------------------------------------------- Telegram (bot việc tuần) */
async function tg(x, C, method, body) {
  if (!C.token) return null;
  if (x.env.MOCK_GOOGLE) { console.log('GV', method, JSON.stringify(body).slice(0, 3000)); return { ok: true, result: { message_id: Math.floor(Math.random() * 1e6), chat: { id: body.chat_id }, file_path: 'photos/a.jpg' } }; }
  try { const r = await fetch('https://api.telegram.org/bot' + C.token + '/' + method, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }); return await r.json(); }
  catch (e) { console.error('gv tg', method, e.message); return null; }
}
async function say(x, C, chat, text, extra) { return tg(x, C, 'sendMessage', Object.assign({ chat_id: String(chat), text, parse_mode: 'HTML', disable_web_page_preview: true }, extra || {})); }
async function privChat(x, u) { return (await kvGet(x.db, 'gv_tg_' + u.email)) || ''; }
function mention(u, tgId) { return tgId ? '<a href="tg://user?id=' + esc(tgId) + '">' + esc(u.name) + '</a>' : '<b>' + esc(u.name) + '</b>'; }
async function tgIdOf(x, u) { return (await privChat(x, u)) || u.tg || ''; }
/** Nhắn riêng nếu đã nối bot; chưa nối thì gắn tên trong nhóm (groupOk = false: tin dễ làm người nhận ngại → chỉ nhắn riêng). */
async function tell(x, C, u, text, extra, groupOk) {
  const p = await privChat(x, u); if (p) return say(x, C, p, text, extra);
  if (groupOk !== false && C.group) return say(x, C, C.group, mention(u, u.tg) + ' ' + text, extra);
  return null;
}
async function remember(x, r, task) { if (r && r.ok && r.result && r.result.message_id && r.result.chat) await run(x.db, 'INSERT OR REPLACE INTO gv_msg (chat, msg, task, at) VALUES (?, ?, ?, ?)', String(r.result.chat.id), r.result.message_id, task, Date.now()); }
function kb(t) {
  if (t.status === 'Xong' || t.status === 'Huỷ') return { inline_keyboard: [[{ text: '📋 Xem trong CRM', url: VIEW_URL }]] };
  const row = []; if (t.status === 'Mới') row.push({ text: '🙋 Mình nhận', callback_data: 'gv:nhan:' + t.id });
  row.push({ text: '✅ Xong rồi', callback_data: 'gv:xong:' + t.id });
  return { inline_keyboard: [row, [{ text: '📋 Xem trong CRM', url: VIEW_URL }]] };
}
function dueTxt(t) {
  if (!t.due) return 'không đặt hạn';
  const d0 = startOfDay(Date.now()), dd = startOfDay(t.due), n = Math.round((dd - d0) / DAY), hm = t.due_t ? ' ' + fmtDate(t.due, 'HH:mm') : '';
  const wd = ['CN', 'T2', 'T3', 'T4', 'T5', 'T6', 'T7'][new Date(t.due + TZ_MS).getUTCDay()];
  return (n === 0 ? 'hôm nay' : n === 1 ? 'mai' : n === -1 ? 'hôm qua' : wd + ' ' + fmtDate(t.due, 'dd/MM')) + hm;
}
const dueEnd = t => t.due ? (t.due_t ? t.due : startOfDay(t.due) + DAY) : null;
function late(t, now) { if (!t.due || t.status === 'Xong' || t.status === 'Huỷ') return false; return dueEnd(t) <= now; }
function taskText(C, t, who) {
  return ST_IC[t.status] + ' ' + (t.kind === 'tt' ? '⭐ <b>Việc trọng tâm #' + t.id + '</b>' : '<b>Việc #' + t.id + '</b>') + ' · ' + who + '\n<b>' + esc(t.title) + '</b>' +
    (t.goal ? '\n🎯 Thế nào là xong: ' + esc(t.goal) : '') + (t.body ? '\n<i>' + esc(t.body.slice(0, 400)) + '</i>' : '') +
    '\n📅 Hạn: ' + esc(dueTxt(t)) + ' · 🤝 ' + esc(t.by_email === t.who_email ? 'tự đặt' : t.by_name + ' nhờ') + (t.pace && t.status !== 'Xong' ? ' · ' + PACE[t.pace] : '') +
    (t.result ? '\n📊 Kết quả: ' + esc(t.result.slice(0, 300)) : '') + (t.proof ? '\n📎 Minh chứng: ' + esc(proofUrl(C, t)) : '') + (t.status === 'Huỷ' ? '\n✖️ Đã dừng' : '');
}
/** Gửi tin việc: vào nhóm (nếu có) + chat riêng người làm; người cùng làm nhận tin riêng. */
async function announce(x, C, t, opt) {
  opt = opt || {};
  const ppl = await staff(x), w = ppl.find(z => z.email === t.who_email) || { name: t.who_name, email: t.who_email }, wid = await tgIdOf(x, w);
  const text = taskText(C, t, mention(w, wid)), sent = [];
  const send = async chat => { const r = await say(x, C, chat, text, { reply_markup: kb(t) }); if (r && r.ok) { await remember(x, r, t.id); sent.push(String(chat)); } };
  const priv = await privChat(x, w);
  if (C.group && !opt.privOnly) await send(C.group);
  if (priv && (!C.group || opt.alsoPriv || opt.privOnly) && sent.indexOf(String(priv)) < 0) await send(priv);
  for (const e of helpersOf(t)) { const h = ppl.find(z => z.email === e); const p = h && await privChat(x, h); if (p && sent.indexOf(String(p)) < 0) { const r = await say(x, C, p, '🤝 Bạn cùng làm với ' + esc(w.name) + ':\n' + text, { reply_markup: kb(t) }); await remember(x, r, t.id); } }
  return sent.length;
}
async function refreshMsgs(x, C, t) {
  const ppl = await staff(x), w = ppl.find(z => z.email === t.who_email) || { name: t.who_name, email: t.who_email }, wid = await tgIdOf(x, w);
  for (const m of await all(x.db, 'SELECT chat, msg FROM gv_msg WHERE task = ? ORDER BY at DESC LIMIT 4', t.id))
    await tg(x, C, 'editMessageText', { chat_id: m.chat, message_id: m.msg, text: taskText(C, t, mention(w, wid)), parse_mode: 'HTML', disable_web_page_preview: true, reply_markup: kb(t) });
}
async function tellBoss(x, C, t, text, actorEmail) {
  if (t.by_email === actorEmail || t.by_email === t.who_email) return;
  const b = (await staff(x)).find(z => z.email === t.by_email); if (b) await tell(x, C, b, text);
}

/* ---------------------------------------------------------------- dữ liệu việc */
async function getTask(x, id) { await schema(x.db); return await first(x.db, 'SELECT * FROM gv_tasks WHERE id = ?', Number(id) || 0); }
async function addLog(x, id, who, text) { await run(x.db, 'INSERT INTO gv_log (task, at, by_name, text) VALUES (?, ?, ?, ?)', id, Date.now(), who, clean(text, 1000)); }
async function ttCount(x, email, week, skipId) { const r = await first(x.db, "SELECT COUNT(*) n FROM gv_tasks t JOIN gv_wk w ON w.task = t.id WHERE t.who_email = ? AND w.week = ? AND t.kind = 'tt' AND t.status <> 'Huỷ' AND t.id <> ?", email, week, skipId || 0); return r ? r.n : 0; }
async function ttList(x, email, week) { return all(x.db, "SELECT t.id, t.title FROM gv_tasks t JOIN gv_wk w ON w.task = t.id WHERE t.who_email = ? AND w.week = ? AND t.kind = 'tt' AND t.status <> 'Huỷ' ORDER BY t.id", email, week); }
async function createTask(x, C, by, w, f, src) {
  const now = Date.now(), wk = weekOf(now), kind = f.kind === 'tt' ? 'tt' : 'ps';
  const r = await run(x.db, 'INSERT INTO gv_tasks (title, body, who_email, who_name, by_email, by_name, due, due_t, status, at, upd_at, src, kind, goal, week, helpers, ndirty) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1)',
    clean(f.title, 300), clean(f.body, 2000), w.email, w.name, by.email, by.name, f.due || null, f.due && f.dueT ? 1 : 0, w.email === by.email ? 'Đang làm' : 'Mới', now, now, src || 'crm', kind, clean(f.goal, 500), wk, (f.helpers || []).filter(e => e !== w.email).join(','));
  const id = r.meta && r.meta.last_row_id;
  await run(x.db, 'INSERT OR IGNORE INTO gv_wk (task, week) VALUES (?, ?)', id, wk);
  await addLog(x, id, by.name, (kind === 'tt' ? '⭐ Việc trọng tâm' : 'Việc phát sinh') + (src === 'tg' ? ' · qua Telegram' : src === 'hop' ? ' · 🎙 từ biên bản cuộc họp' : ' · trong CRM'));
  return getTask(x, id);
}
/** Kiểm tra trước khi đặt việc trọng tâm: tối đa 3 / người / tuần. */
async function ttGuard(x, C, by, w, skipId) {
  if (w.email !== by.email && !canAssign(by, C)) return 'Việc trọng tâm của ' + w.name + ' do ' + shortName(w.name) + ' tự chốt hoặc Quản lý đặt. Bạn nhờ việc này dưới dạng việc phát sinh nhé.';
  const wk = weekOf(Date.now());
  if (await ttCount(x, w.email, wk, skipId) >= MAX_TT) { const L = await ttList(x, w.email, wk); return w.name + ' đã có ' + MAX_TT + ' việc trọng tâm tuần này: ' + L.map(t => '#' + t.id + ' ' + t.title).join('; ') + '. Dừng bớt 1 việc, hoặc ghi việc này là phát sinh.'; }
  return '';
}
/** Đổi việc. Quyền: người làm, người cùng làm (tiến độ, ghi chú, kết quả), người nhờ / Quản lý (mọi thứ). */
async function changeTask(x, C, u, t, ch) {
  const mine = t.who_email === u.email, help = helpersOf(t).indexOf(u.email) >= 0, boss = t.by_email === u.email || canAssign(u, C);
  if (!mine && !boss && !help) return { ok: false, error: 'Việc #' + t.id + ' là của ' + t.who_name + ', bạn chưa cùng làm việc này.' };
  const now = Date.now(), notes = [], set = {};
  const proof = ch.proof !== undefined && ch.proof !== '' ? clean(ch.proof, 500) : t.proof, result = ch.result !== undefined && ch.result !== '' ? clean(ch.result, 1000) : t.result;
  if (proof !== t.proof) { set.proof = proof; notes.push('📎 minh chứng: ' + (/^tg:/.test(proof) ? 'ảnh / file trong Telegram' : proof)); }
  if (result !== t.result) { set.result = result; notes.push('📊 kết quả: ' + clean(result, 300)); }
  if (ch.status && ch.status !== t.status && GV_ST.indexOf(ch.status) >= 0) {
    if (ch.status === 'Huỷ' && !boss) return { ok: false, error: 'Muốn dừng việc này thì nhắn ' + t.by_name + ' để cùng thống nhất nhé.' };
    if (ch.status === 'Xong' && needProof(t) && (!result || !proof)) return { ok: false, needProof: 1, error: 'Việc trọng tâm cần ' + (!result && !proof ? 'kết quả thực tế và link minh chứng' : !result ? '1 câu kết quả thực tế (đạt bao nhiêu)' : 'link minh chứng (bài đăng, file, báo cáo… hoặc gửi ảnh trong Telegram)') + ' rồi mới ghi Xong.' };
    set.status = ch.status; if (ch.status === 'Xong') set.done_at = now; if (t.status === 'Xong') set.done_at = null;
    notes.push(ST_IC[ch.status] + ' ' + ST_TX[ch.status]);
  }
  if (ch.pace && PACE[ch.pace]) { set.pace = ch.pace; set.pace_at = now; if (ch.pace !== t.pace) notes.push(PACE[ch.pace]); if (t.status === 'Mới' && mine) set.status = 'Đang làm'; }
  if (ch.next && ch.next !== t.next) { set.next = clean(ch.next, 500); set.pace_at = now; notes.push('➡️ ' + clean(ch.next, 300)); }
  if (ch.block !== undefined && ch.block !== t.block) { set.block = clean(ch.block, 500); if (ch.block) notes.push('🙏 cần hỗ trợ: ' + clean(ch.block, 300)); }
  if (ch.due !== undefined && ch.due !== t.due) {
    if (!boss) { notes.push('🙏 xin lùi hạn sang ' + dueTxt({ due: ch.due, due_t: ch.dueT })); ch.ask = 1; }
    else { set.due = ch.due || null; set.due_t = ch.due && ch.dueT ? 1 : 0; set.rem = 0; notes.push('📅 đổi hạn → ' + dueTxt({ due: ch.due, due_t: ch.dueT })); }
  } else if (ch.dueT !== undefined && ch.due === t.due && boss && (ch.dueT ? 1 : 0) !== t.due_t) set.due_t = ch.dueT ? 1 : 0;
  if (ch.goal && ch.goal !== t.goal && (boss || mine)) { set.goal = clean(ch.goal, 500); notes.push('🎯 ' + clean(ch.goal, 300)); }
  if (ch.kind && ch.kind !== t.kind && (boss || mine)) {
    if (ch.kind === 'tt') { const err = await ttGuard(x, C, u, { email: t.who_email, name: t.who_name }, t.id); if (err) return { ok: false, error: err }; await run(x.db, 'INSERT OR IGNORE INTO gv_wk (task, week) VALUES (?, ?)', t.id, weekOf(now)); }
    set.kind = ch.kind === 'tt' ? 'tt' : 'ps'; notes.push(set.kind === 'tt' ? '⭐ thành việc trọng tâm' : 'thành việc phát sinh');
  }
  if (ch.qa && boss && ch.qa !== t.qa) { set.qa = ch.qa; notes.push('🔎 nghiệm thu: ' + ch.qa); }
  if (ch.note) notes.push('💬 ' + clean(ch.note, 500));
  if (ch.title && boss && ch.title !== t.title) set.title = clean(ch.title, 300);
  if (ch.body !== undefined && boss && clean(ch.body, 2000) !== t.body) set.body = clean(ch.body, 2000);
  if (ch.helpers && (boss || mine)) { const h = ch.helpers.filter(e => e !== t.who_email).join(','); if (h !== (t.helpers || '')) set.helpers = h; }
  if (ch.who && boss && ch.who.email !== t.who_email) { set.who_email = ch.who.email; set.who_name = ch.who.name; set.status = 'Mới'; notes.push('👤 chuyển cho ' + ch.who.name); }
  const keys = Object.keys(set);
  if (!keys.length && !notes.length) return { ok: true, t, same: 1 };
  if (keys.length) await run(x.db, 'UPDATE gv_tasks SET ' + keys.map(k => k + ' = ?').join(', ') + ', upd_at = ?, ndirty = 1, ntry = 0 WHERE id = ?', ...keys.map(k => set[k]), now, t.id);
  else await run(x.db, 'UPDATE gv_tasks SET upd_at = ? WHERE id = ?', now, t.id);
  if (notes.length) await addLog(x, t.id, u.name, notes.join(' · '));
  const nt = await getTask(x, t.id);
  try {
    await refreshMsgs(x, C, nt);
    if (set.who_email) await announce(x, C, nt, { alsoPriv: 1 });
    if (notes.length && !ch.quiet) await tellBoss(x, C, nt, '<b>Việc #' + nt.id + '</b> (' + esc(nt.who_name) + '): ' + esc(nt.title) + '\n' + notes.map(esc).join('\n') + (ch.ask ? '\n👉 Đồng ý thì sửa hạn trong CRM (bấm việc → ✏️ Sửa): ' + VIEW_URL : ''), u.email);
    if (boss && !mine && notes.length) { const w = (await staff(x)).find(z => z.email === nt.who_email); if (w) { const p = await privChat(x, w); if (p) await say(x, C, p, '<b>Việc #' + nt.id + '</b>: ' + esc(nt.title) + '\n' + esc(u.name) + ': ' + notes.map(esc).join(' · ')); } }
    if (set.status === 'Xong' && C.group) await say(x, C, C.group, '🌿 Cảm ơn <b>' + esc(nt.who_name) + '</b> đã xong' + (nt.kind === 'tt' ? ' việc trọng tâm' : '') + ': ' + esc(nt.title) + (nt.result ? '\n📊 ' + esc(nt.result.slice(0, 200)) : '') + (nt.by_email !== nt.who_email ? '\n🤝 ' + esc(nt.by_name) + ' nhờ' : ''));
  } catch (e) { console.error('gv notify', e.message); }
  return { ok: true, t: nt };
}

/* ---------------------------------------------------------------- AI */
let client = null;
function ai(env) { if (!client) client = new Anthropic({ apiKey: env.ANTHROPIC_API_KEY, maxRetries: 1, timeout: 25e3, fetch: aiFetch(env), defaultHeaders: { 'x-tdl-muc': 'giaoviec' } }); return client; }
async function aiJson(x, prompt, maxTok) {
  if (!x.env.ANTHROPIC_API_KEY) return null;
  const dk = 'gv_ai_' + fmtDate(Date.now(), 'yyMMdd'), n = Number(await kvGet(x.db, dk) || 0);
  if (n >= AI_DAY_MAX) return null;
  await kvSet(x.db, dk, String(n + 1), 2 * DAY);
  let res;
  try { res = await ai(x.env).messages.create({ model: AI_MODEL, max_tokens: maxTok || 1500, output_config: { effort: 'low' }, messages: [{ role: 'user', content: prompt }] }); }
  catch (e) { console.error('gv ai', e.message); return null; }
  const out = (res.content || []).filter(b => b.type === 'text').map(b => b.text).join(''), m = out.match(/\{[\s\S]*\}/);
  if (!m) return null; try { return JSON.parse(m[0]); } catch (e) { return null; }
}
function parseDue(s) {
  const m = String(s || '').match(/(\d{4})-(\d{2})-(\d{2})(?:[ T](\d{1,2}):(\d{2}))?/); if (!m) return { due: null, dueT: 0 };
  const t = Date.UTC(+m[1], +m[2] - 1, +m[3], m[4] ? +m[4] : 9, m[5] ? +m[5] : 0) - TZ_MS;
  return isNaN(t) ? { due: null, dueT: 0 } : { due: t, dueT: m[4] ? 1 : 0 };
}
/** "Thế nào là xong" đo được chưa. Có con số / link → khỏi gọi AI. */
function goalLooksOk(g) { g = String(g || ''); return g.length >= 12 && (/\d/.test(g) || hasLink(g)); }
export async function goalCheck(x, title, goal) {
  if (goalLooksOk(goal)) return { ok: true };
  const J = await aiJson(x, 'Việc: "' + clean(title, 300) + '"\nThế nào là xong: "' + clean(goal, 500) + '"\n\n"Thế nào là xong" phải ĐO ĐƯỢC: có con số, số lượng, sản phẩm bàn giao cụ thể hoặc tiêu chuẩn kiểm được (vd "Đăng 3 video trà DILVANG lên TikTok, mỗi video có tiêu đề + ảnh bìa", "Báo cáo doanh thu Shopee tháng 8–10 trong 1 file Google Sheet"). "Hoàn thành video", "xong", "báo cáo cuối tuần", "tối ưu shopee" là CHƯA đo được.\nTrả về DUY NHẤT JSON: {"do_duoc":true|false,"vi_sao":"1 câu ngắn, giọng nhẹ nhàng","goi_y":"viết lại Thế nào là xong cho đo được, giữ đúng ý, dưới 30 chữ"}', 500);
  if (!J) return { ok: String(goal || '').trim().length >= 8 };
  return { ok: !!J.do_duoc, tip: clean(J.vi_sao, 200), goal: clean(J.goi_y, 300) };
}
async function aiRead(x, u, C, text, ctxTask) {
  const ppl = await staff(x), lead = canAssign(u, C);
  const open = await all(x.db, `SELECT id, title, who_name, by_name, due, due_t, status, kind FROM gv_tasks WHERE ${OPEN} ${lead ? '' : 'AND (who_email = ? OR by_email = ?)'} ORDER BY id DESC LIMIT 60`, ...(lead ? [] : [u.email, u.email]));
  const now = Date.now(), wd = ['Chủ nhật', 'Thứ Hai', 'Thứ Ba', 'Thứ Tư', 'Thứ Năm', 'Thứ Sáu', 'Thứ Bảy'][new Date(now + TZ_MS).getUTCDay()];
  return aiJson(x, 'Hôm nay: ' + wd + ' ' + fmtDate(now, 'yyyy-MM-dd HH:mm') + ' (giờ Việt Nam). Công ty Thực Dưỡng Lành. Mỗi người tối đa 3 việc TRỌNG TÂM/tuần (chốt trước 9h thứ Ba); việc khác là PHÁT SINH.\n' +
    'Người nhắn: ' + u.name + ' (' + u.role + ').\n' +
    'Nhân sự (tên trong CRM | vai trò): ' + ppl.map(z => z.name + ' | ' + z.role).join('; ') + '\n' +
    'Việc đang mở (id | việc | người làm | người nhờ | hạn | trạng thái | loại):\n' + (open.map(t => t.id + ' | ' + t.title + ' | ' + t.who_name + ' | ' + t.by_name + ' | ' + (t.due ? fmtDate(t.due, t.due_t ? 'yyyy-MM-dd HH:mm' : 'yyyy-MM-dd') : '-') + ' | ' + t.status + ' | ' + (t.kind === 'tt' ? 'trọng tâm' : 'phát sinh')).join('\n') || '(chưa có)') + '\n' +
    (ctxTask ? 'Tin này là TRẢ LỜI cho việc #' + ctxTask.id + ' (' + ctxTask.title + ', của ' + ctxTask.who_name + ').\n' : '') +
    '\nTin nhắn:\n"""' + text.slice(0, 1500) + '"""\n\n' +
    'Trả về DUY NHẤT 1 khối JSON:\n{"loai":"giao|cap_nhat|hoi|khac",\n "viec":[{"nguoi":"tên đúng như danh sách nhân sự, hoặc \\"tôi\\"","viec":"việc cần làm, bắt đầu bằng động từ","xong_la":"thế nào là xong: con số / sản phẩm bàn giao đo được; người nhắn không nói thì tự đề xuất hợp lý","trong_tam":true,"han":"YYYY-MM-DD HH:mm hoặc YYYY-MM-DD hoặc rỗng"}],\n "cap_nhat":[{"id":0,"trang_thai":"Xong|Đang làm|Huỷ|","tien_do":"ok|risk|help|","buoc_tiep":"đã làm được gì → làm gì tiếp","vuong":"vướng gì, cần ai hỗ trợ","ket_qua":"kết quả thực tế đạt được","minh_chung":"link nếu có","han_moi":"YYYY-MM-DD HH:mm hoặc YYYY-MM-DD hoặc rỗng","xong_la":"nếu người nhắn sửa thế nào là xong"}],\n "tra_loi":"câu trả lời ngắn (tối đa 6 dòng) nếu người nhắn hỏi, hoặc câu hỏi lại nếu chưa rõ"}\n' +
    'Quy tắc: trong_tam=true khi người nhắn nói "trọng tâm", "việc chính tuần", "cam kết tuần", hoặc liệt kê 1–3 việc tuần này của mình; còn lại false. 1 tin có thể có nhiều việc. "Thứ Sáu" = thứ Sáu sắp tới. "cuối tuần" = Chủ nhật này. sáng=09:00, trưa=12:00, chiều=17:00, tối=20:00. Không rõ hạn thì để rỗng. ' +
    'Tên gọi tắt ("Thủy", "chị Trang", "Hà mkt") thì chọn đúng người; không chắc thì loai="khac" và hỏi lại. "để em làm", "anh tự làm" → nguoi="tôi". Báo tiến độ ("đang làm 3/5 video", "chắc trễ", "cần hỗ trợ") → cap_nhat với tien_do.');
}
function findPerson(ppl, name, me) {
  const n = nrm(name).replace(/^(anh|chi|em|ban|co|chu|a|c|e)\s+/, '');
  if (!n || n === 'toi' || n === 'minh' || n === 'em' || n === 'anh') return me;
  return ppl.find(z => nrm(z.name) === n) || ppl.find(z => nrm(z.name).endsWith(' ' + n)) || ppl.find(z => nrm(z.name).indexOf(n) >= 0) || null;
}

/* ---------------------------------------------------------------- nhận tin từ Telegram + file minh chứng + 🎙 việc từ cuộc họp */
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
  const f = path.match(/^\/gv\/f\/(\d+)\/([a-f0-9]{12})$/); // 📎 ảnh / file minh chứng gửi trong Telegram → mở được từ CRM, Notion
  if (f && C.token) {
    if (md5hex((C.secret || 'x') + ':' + f[1]).slice(0, 12) !== f[2]) return new Response('no', { status: 403 });
    const t = await getTask(x, f[1]); if (!t || !/^tg:/.test(t.proof)) return new Response('Không có file', { status: 404 });
    const g = await tg(x, C, 'getFile', { file_id: t.proof.slice(3) }); if (!g || !g.ok) return new Response('File đã hết hạn trên Telegram', { status: 404 });
    const r = await fetch('https://api.telegram.org/file/bot' + C.token + '/' + g.result.file_path);
    return new Response(r.body, { headers: { 'Content-Type': r.headers.get('Content-Type') || 'application/octet-stream', 'Cache-Control': 'private, max-age=3600' } });
  }
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
const DONE_RE = /^(xong|da xong|xong roi|done|hoan thanh|da hoan thanh|ok xong)\b/;
async function onUpdate(x, C, up) {
  if (up.my_chat_member) {
    const m = up.my_chat_member, ch = m.chat, st = m.new_chat_member && m.new_chat_member.status;
    if (ch && ch.type !== 'private' && (st === 'member' || st === 'administrator') && String(ch.id) !== String(C.group))
      await say(x, C, ch.id, '👋 Chào cả nhà! Em là Lành, bạn cùng làm của Thực Dưỡng Lành 🌿\nAnh Sơn hoặc Quản lý gõ <b>/noinhom</b> trong nhóm này để em gửi việc vào đây.');
    return;
  }
  if (up.callback_query) return onButton(x, C, up.callback_query);
  const msg = up.message; if (!msg || !msg.from || msg.from.is_bot) return;
  const chat = msg.chat, priv = chat.type === 'private', text = String(msg.text || msg.caption || '').trim();
  const reply = (t, extra) => say(x, C, chat.id, t, Object.assign({ reply_to_message_id: msg.message_id, allow_sending_without_reply: true }, extra || {}));
  const st = text.match(/^\/start(?:@\w+)?\s+([a-f0-9]{10})$/);
  if (st && priv) {
    const email = await kvGet(x.db, 'gvl_' + st[1]);
    if (!email) return reply('Mã kết nối đã hết hạn. Vào CRM → ✅ Việc tuần → bấm <b>Kết nối Telegram</b> lại nhé.');
    await kvSet(x.db, 'gv_tg_' + email, String(chat.id)); await kvDel(x.db, 'gvl_' + st[1]);
    const z = (await staff(x)).find(y => y.email === email);
    return reply('✅ Đã nối với CRM cho <b>' + esc(z ? z.name : email) + '</b> 🌿\nTừ giờ việc tuần, việc được nhờ và lời nhắc sẽ gửi riêng cho bạn ở đây.\n\n' + helpText(z || {}, C));
  }
  const u = await whoIs(x, msg.from);
  const mentioned = C.bot && new RegExp('@' + C.bot, 'i').test(text);
  const rid = msg.reply_to_message && msg.reply_to_message.message_id;
  const rTask = rid ? await first(x.db, 'SELECT task FROM gv_msg WHERE chat = ? AND msg = ?', String(chat.id), rid) : null;
  const cmd = (text.match(/^\/(\w+)/) || [])[1];
  if (!priv && !mentioned && !rTask && !cmd) return; // trong nhóm: chỉ đọc tin gọi tên bot, trả lời tin việc, hoặc lệnh /
  if (!u) return reply('Em chưa biết bạn là ai trong CRM. Bạn vào CRM → <b>✅ Việc tuần</b> → bấm <b>Kết nối Telegram</b> (30 giây) rồi nhắn lại nhé.\n' + VIEW_URL);
  if (cmd === 'start' && priv) { await kvSet(x.db, 'gv_tg_' + u.email, String(chat.id)); return reply('Chào ' + esc(shortName(u.name)) + '! 🌿\n' + helpText(u, C)); }
  if (cmd === 'noinhom') {
    if (priv) return reply('Gõ /noinhom ở trong nhóm Telegram muốn dùng nhé.');
    if (u.level < 2) return reply('Chỉ anh Sơn hoặc Quản lý nối được nhóm.');
    C.group = String(chat.id); C.groupName = chat.title || ''; await cfgSet(x, C);
    return reply('✅ Từ giờ việc tuần sẽ hiện trong nhóm <b>' + esc(chat.title || '') + '</b> 🌿\n' + helpText(u, C));
  }
  if (cmd === 'help' || cmd === 'huongdan') return reply(helpText(u, C));
  if (cmd === 'viec') return reply(await listText(x, C, u, 'me'));
  if (cmd === 'phong' || cmd === 'ca') return reply(await listText(x, C, u, 'all'));
  if (cmd === 'baocao') { const now = Date.now(); return reply(await myReportText(x, C, u, weekOf(now) - (new Date(now + TZ_MS).getUTCDay() === 1 ? 7 * DAY : 0))); }
  const body = text.replace(new RegExp('@' + (C.bot || '-'), 'ig'), '').replace(/^\/\w+(@\w+)?/, '').trim();
  const ctxTask = rTask ? await getTask(x, rTask.task) : null;
  const file = msg.photo ? msg.photo[msg.photo.length - 1] : msg.document || msg.video;
  if (ctxTask) { // trả lời vào tin việc: phần lớn không cần AI
    const b = nrm(body), link = linkOf(body);
    const proofCh = file ? { proof: 'tg:' + file.file_id } : link ? { proof: link } : {};
    if (DONE_RE.test(b) || (file && !b)) {
      const res = body.replace(/^\s*(đã\s+)?(xong( rồi)?|done|hoàn thành)( ạ| nha| nhé)?[\s:,.-]*/i, '').replace(link, '').replace(/\s+/g, ' ').trim();
      const ch = Object.assign({ result: res }, proofCh); if (DONE_RE.test(b)) ch.status = 'Xong';
      const r = await changeTask(x, C, u, ctxTask, ch);
      if (!r.ok && r.needProof) return reply('🙏 ' + esc(r.error) + '\nTrả lời lại tin việc: <i>xong, đăng 3 video https://…</i> hoặc gửi ảnh chụp kết quả kèm 1 câu.');
      if (!r.ok) return reply(esc(r.error));
      return reply(ch.status ? '✅ Đã ghi xong việc #' + ctxTask.id + '. Cảm ơn ' + esc(shortName(u.name)) + ' 🌿' : '📎 Đã lưu minh chứng cho việc #' + ctxTask.id + '. Xong rồi thì trả lời "xong, <kết quả>" nhé.');
    }
    if (/^(nhan|em nhan|da nhan|minh nhan|ok|oke|okie|vang|da vang|da)\b/.test(b) && b.length < 25 && ctxTask.who_email === u.email) { const r = await changeTask(x, C, u, ctxTask, { status: 'Đang làm' }); return reply(r.ok ? '🙋 ' + esc(shortName(u.name)) + ' đã nhận việc #' + ctxTask.id + '.' : esc(r.error)); }
    if (/^chua xong/.test(b)) { const r = await changeTask(x, C, u, ctxTask, Object.assign({ next: body }, proofCh)); return reply(r.ok ? '📝 Đã ghi. Việc #' + ctxTask.id + ' sẽ sang tuần sau, thứ Hai mình cùng xem nhé.' : esc(r.error)); }
    if (file) { const r = await changeTask(x, C, u, ctxTask, Object.assign({ note: body }, proofCh)); return reply(r.ok ? '📎 Đã lưu ảnh / file vào việc #' + ctxTask.id + '.' : esc(r.error)); }
  }
  if (!body && !file) return reply(helpText(u, C));
  const J = await aiRead(x, u, C, body || '(gửi ảnh/file)', ctxTask);
  if (!J) { if (ctxTask && body) { await changeTask(x, C, u, ctxTask, { note: body }); return reply('💬 Đã ghi vào việc #' + ctxTask.id + '.'); } return reply('Em chưa đọc được tin này (AI tạm nghỉ). Bạn ghi trong CRM giúp em nhé: ' + VIEW_URL); }
  const ppl = await staff(x), lines = [];
  if (J.loai === 'giao' && Array.isArray(J.viec) && J.viec.length) {
    for (const v of J.viec.slice(0, 10)) {
      const w = findPerson(ppl, v.nguoi, u);
      if (!w) { lines.push('❓ Chưa rõ "' + esc(v.nguoi) + '" là ai trong CRM, việc "' + esc(v.viec) + '" chưa ghi.'); continue; }
      let kind = v.trong_tam ? 'tt' : 'ps';
      if (kind === 'tt') { const err = await ttGuard(x, C, u, w); if (err) { lines.push('⚠️ ' + esc(err) + ' → em ghi "' + esc(v.viec) + '" là việc phát sinh.'); kind = 'ps'; } }
      const d = parseDue(v.han), t = await createTask(x, C, u, w, { title: v.viec, goal: v.xong_la, due: d.due, dueT: d.dueT, kind }, 'tg');
      const sent = await announce(x, C, t, { alsoPriv: priv ? 1 : 0 });
      lines.push((kind === 'tt' ? '⭐' : '✅') + ' #' + t.id + ' ' + esc(w.name) + ': ' + esc(t.title) + ' · ' + esc(dueTxt(t)) + (t.goal ? '\n   🎯 ' + esc(t.goal) : '') + (sent ? '' : '\n   (' + esc(shortName(w.name)) + ' chưa nối Telegram, sẽ thấy trong CRM)'));
    }
    await reply((lines.join('\n') || 'Không có việc nào được ghi.') + (lines.some(l => /🎯/.test(l)) ? '\n\n"Thế nào là xong" chưa đúng ý thì trả lời tin việc để sửa nhé.' : ''));
    return;
  }
  if (J.loai === 'cap_nhat' && Array.isArray(J.cap_nhat) && J.cap_nhat.length) {
    for (const c of J.cap_nhat.slice(0, 10)) {
      const t = await getTask(x, c.id || (ctxTask && ctxTask.id)); if (!t) { lines.push('❓ Không thấy việc #' + esc(c.id)); continue; }
      const d = c.han_moi ? parseDue(c.han_moi) : null, lk = c.minh_chung && hasLink(c.minh_chung) ? linkOf(c.minh_chung) : '';
      const ch = { status: GV_ST.indexOf(c.trang_thai) >= 0 ? c.trang_thai : '', pace: PACE[c.tien_do] ? c.tien_do : '', next: c.buoc_tiep || '', result: c.ket_qua || '', goal: c.xong_la || '', due: d ? d.due : undefined, dueT: d ? d.dueT : 0 };
      if (c.vuong) ch.block = c.vuong;
      if (lk) ch.proof = lk; else if (file) ch.proof = 'tg:' + file.file_id;
      const r = await changeTask(x, C, u, t, ch);
      lines.push(r.ok ? (r.same ? 'ℹ️ Việc #' + t.id + ' không có gì thay đổi.' : '✓ Việc #' + t.id + ': ' + esc(ST_TX[r.t.status]) + (r.t.pace && r.t.status !== 'Xong' ? ' · ' + PACE[r.t.pace] : '') + (d && !canAssign(u, C) && t.by_email !== u.email ? ' · đã gửi ' + esc(t.by_name) + ' duyệt lùi hạn' : '')) : '⚠️ ' + esc(r.error));
    }
    return reply(lines.join('\n'));
  }
  if (ctxTask && body) { await changeTask(x, C, u, ctxTask, { note: body }); return reply(J.tra_loi ? esc(J.tra_loi) : '💬 Đã ghi vào việc #' + ctxTask.id + ' và báo ' + esc(ctxTask.by_name) + '.'); }
  return reply(esc(J.tra_loi || 'Em chưa hiểu ý. ') + (J.loai === 'khac' && !J.tra_loi ? '\n' + helpText(u, C) : ''));
}
async function onButton(x, C, q) {
  const m = String(q.data || '').match(/^gv:(nhan|xong|ok|risk|help|carry):(\d+)$/), ans = (t, alert) => tg(x, C, 'answerCallbackQuery', { callback_query_id: q.id, text: t, show_alert: !!alert });
  if (!m) return ans('');
  const u = await whoIs(x, q.from); if (!u) return ans('Bạn chưa nối CRM: vào CRM → ✅ Việc tuần → Kết nối Telegram.', true);
  const t = await getTask(x, m[2]); if (!t) return ans('Không thấy việc này.', true);
  if (m[1] === 'nhan' && t.who_email !== u.email) return ans('Việc này nhờ ' + t.who_name + ', chỉ ' + shortName(t.who_name) + ' bấm nhận được.', true);
  if (m[1] === 'carry') { const r = await changeTask(x, C, u, t, { note: 'chưa xong, chuyển tuần sau', quiet: 1 }); return ans(r.ok ? 'Đã ghi. Trả lời tin này 1 câu: vì sao chưa xong, tuần sau làm gì tiếp.' : r.error, true); }
  if (PACE[m[1]]) { const r = await changeTask(x, C, u, t, { pace: m[1], quiet: m[1] === 'ok' ? 1 : 0 }); return ans(r.ok ? PACE[m[1]] + ' ✓ Trả lời tin này 1 câu: đã làm được gì → làm gì tiếp' + (m[1] === 'help' ? ', cần ai hỗ trợ.' : '.') : r.error, true); }
  const r = await changeTask(x, C, u, t, { status: m[1] === 'nhan' ? 'Đang làm' : 'Xong' });
  if (!r.ok && r.needProof) return ans('Việc trọng tâm cần kết quả + minh chứng: trả lời tin việc "xong, <kết quả> <link>" hoặc gửi ảnh kết quả kèm 1 câu.', true);
  return ans(r.ok ? (m[1] === 'nhan' ? '🙋 Đã nhận việc' : '✅ Đã ghi xong. Cảm ơn bạn 🌿') : r.error, !r.ok);
}
function helpText(u, C) {
  const b = C.bot ? '@' + C.bot : 'em';
  return '<b>Nhịp tuần của mình</b>\n• Trước <b>9h sáng thứ Ba</b>: chốt tối đa 3 việc ⭐ trọng tâm\n• Trước <b>21h thứ Năm</b>: cập nhật tiến độ\n• Trước <b>21h Chủ nhật</b>: kết quả + link minh chứng\n\n' +
    '<b>Cách nhắn</b>\n• Chốt việc: <i>' + b + ' trọng tâm tuần: đăng 3 video trà DILVANG lên TikTok, hạn thứ Sáu</i>\n• Nhờ ai đó: <i>' + b + ' nhờ Trang gửi bảng lương trước 17h thứ Sáu</i>\n' +
    '• Bấm <b>🙋 Mình nhận</b> / <b>✅ Xong rồi</b> dưới tin việc\n• Trả lời (reply) tin việc: <i>xong, đăng 3 video https://…</i> · gửi ảnh kết quả · <i>xin lùi sang thứ Hai</i>\n• /viec: việc của tôi · /baocao: báo cáo tuần của tôi' + (canAssign(u, C) ? ' · /phong: việc cả công ty' : '') + '\n• Xem đủ trong CRM: ' + VIEW_URL;
}
async function listText(x, C, u, scope) {
  const all_ = scope === 'all' && canAssign(u, C), now = Date.now();
  const rows = await all(x.db, `SELECT * FROM gv_tasks WHERE ${OPEN} ${all_ ? '' : "AND (who_email = ? OR (',' || helpers || ',') LIKE ?)"} ORDER BY (kind <> 'tt'), (due IS NULL), due, id LIMIT 80`, ...(all_ ? [] : [u.email, '%,' + u.email + ',%']));
  if (!rows.length) return all_ ? '🎉 Không còn việc nào đang mở.' : '🎉 ' + esc(shortName(u.name)) + ' không còn việc nào đang mở.';
  const line = t => (t.kind === 'tt' ? '⭐' : '•') + ' #' + t.id + ' ' + esc(t.title) + ' · ' + esc(dueTxt(t)) + (late(t, now) ? ' ⏰' : '') + (t.pace ? ' · ' + PACE[t.pace].split(' ')[0] : '');
  if (!all_) return '<b>Việc của ' + esc(u.name) + '</b> (' + rows.length + ')\n' + rows.map(line).join('\n');
  const by = {}; rows.forEach(t => (by[t.who_name] || (by[t.who_name] = [])).push(t));
  return '<b>Việc đang mở cả công ty</b> (' + rows.length + ')\n' + Object.keys(by).map(n => '\n<b>' + esc(n) + '</b>\n' + by[n].map(line).join('\n')).join('\n');
}

/* ---------------------------------------------------------------- báo cáo tuần (họp thứ Hai) */
/** Báo cáo tuần W: mỗi người → việc trọng tâm thuộc tuần đó (kể cả đã chuyển sang tuần sau) + việc phát sinh xong trong tuần. */
export async function weekReport(x, C, W, onlyEmail, nowArg) {
  await schema(x.db);
  const end = W + 7 * DAY, now = nowArg || Date.now(), ppl = await members(x, C);
  const tt = await all(x.db, "SELECT t.* FROM gv_tasks t JOIN gv_wk w ON w.task = t.id WHERE w.week = ? AND t.kind = 'tt' AND t.status <> 'Huỷ'" + (onlyEmail ? ' AND t.who_email = ?' : '') + ' ORDER BY t.id', W, ...(onlyEmail ? [onlyEmail] : []));
  const ps = await all(x.db, "SELECT * FROM gv_tasks WHERE kind = 'ps' AND status = 'Xong' AND done_at >= ? AND done_at < ?" + (onlyEmail ? ' AND who_email = ?' : '') + ' ORDER BY done_at', W, end, ...(onlyEmail ? [onlyEmail] : []));
  const people = [];
  for (const z of ppl) {
    if (onlyEmail && z.email !== onlyEmail) continue;
    const mine = tt.filter(t => t.who_email === z.email).map(t => {
      const doneIn = t.status === 'Xong' && t.done_at < end, ontime = doneIn && (!t.due || t.done_at <= dueEnd(t));
      return { id: t.id, title: t.title, goal: t.goal, due: t.due, dueT: t.due_t, result: t.result, proof: proofUrl(C, t), qa: t.qa, pace: t.pace, next: t.next, block: t.block, carry: t.carry, by: t.by_email === t.who_email ? '' : t.by_name,
        st: doneIn ? (ontime ? 'ontime' : 'late') : (end <= now ? 'carried' : 'open'), noProof: doneIn && (!t.proof || !t.result) ? 1 : 0 };
    });
    const extra = ps.filter(t => t.who_email === z.email).map(t => ({ id: t.id, title: t.title, result: t.result, proof: proofUrl(C, t), src: t.src }));
    const n = mine.length, done = mine.filter(r => r.st === 'ontime' || r.st === 'late').length, ontime = mine.filter(r => r.st === 'ontime').length;
    people.push({ email: z.email, name: z.name, role: z.role, tt: mine, ps: extra, n, done, ontime, pctDone: n ? Math.round(done * 100 / n) : null, pctOn: n ? Math.round(ontime * 100 / n) : null,
      help: mine.filter(r => (r.pace === 'help' || r.block) && (r.st === 'open' || r.st === 'carried')).length, noProof: mine.filter(r => r.noProof).length });
  }
  const T = people.reduce((a, p) => { a.n += p.n; a.done += p.done; a.ontime += p.ontime; return a; }, { n: 0, done: 0, ontime: 0 });
  return { week: W, label: wkLabel(W), people, total: { n: T.n, done: T.done, ontime: T.ontime, pctDone: T.n ? Math.round(T.done * 100 / T.n) : null, pctOn: T.n ? Math.round(T.ontime * 100 / T.n) : null } };
}
/** Bài nói 3–5 phút cho buổi họp thứ Hai, theo "Công thức báo cáo" trong Quy trình họp tuần. */
export function speech(p, label, nextTT) {
  const L = ['<b>📋 Báo cáo tuần ' + esc(label) + ' · ' + esc(p.name) + '</b>'];
  if (!p.tt.length) L.push('Tuần này chưa chốt việc trọng tâm.');
  p.tt.forEach((r, i) => {
    L.push('\n<b>' + (i + 1) + '. ' + esc(r.title) + '</b>' + (r.goal ? '\n   🎯 Cam kết: ' + esc(r.goal) : '') +
      '\n   📊 Thực tế: ' + esc(r.result || (r.st === 'carried' || r.st === 'open' ? 'chưa xong' : 'chưa ghi kết quả')) +
      '\n   ' + ({ ontime: '✅ Đúng hạn', late: '🟠 Xong trễ hạn', carried: '⏭ Chuyển tuần' + (r.carry ? ' (lần ' + (r.carry + 1) + ')' : ''), open: '⏳ Đang làm' + (r.pace ? ' · ' + PACE[r.pace] : '') })[r.st] +
      (r.proof ? '\n   📎 ' + esc(r.proof) : r.st === 'ontime' || r.st === 'late' ? '\n   ⚠️ Thiếu link minh chứng' : '') +
      ((r.st === 'carried' || r.st === 'open') && r.next ? '\n   ➡️ ' + esc(r.next) : '') + (r.block ? '\n   🙏 Cần hỗ trợ: ' + esc(r.block) : ''));
  });
  if (p.ps.length) L.push('\n<b>Việc phát sinh đã xong:</b> ' + p.ps.map(r => esc(r.title)).join(' · '));
  if (p.n) L.push('\n👉 Xong ' + p.done + '/' + p.n + ' việc trọng tâm, ' + p.ontime + ' việc đúng hạn.');
  if (nextTT) L.push(nextTT.length ? '\n<b>Tuần mới (việc chuyển sang):</b> ' + nextTT.map(t => esc(t.title)).join(' · ') + '\nChốt thêm (tổng tối đa 3 việc) trước 9h sáng thứ Ba nhé.' : '\nTuần mới: chốt tối đa 3 việc ⭐ trọng tâm trước 9h sáng thứ Ba nhé 🌿');
  return L.join('\n');
}
async function myReportText(x, C, u, W) { const R = await weekReport(x, C, W, u.email); const p = R.people[0]; return p ? speech(p, R.label) : 'Bạn chưa nằm trong nhịp tuần (nhờ anh Sơn bật trong CRM).'; }

/* ---------------------------------------------------------------- nhịp tuần + nhắc (cron, 10 phút/lần, 7h–22h) */
async function once(x, key) { if (await kvGet(x.db, key)) return false; await kvSet(x.db, key, '1', 9 * DAY); return true; }
async function leadsOf(x, C) { return (await staff(x)).filter(z => canAssign(z, C)); }
async function toLeads(x, C, msg) { for (const b of await leadsOf(x, C)) { const p = await privChat(x, b); if (p) await say(x, C, p, msg); } }
const weekTT = (x, W) => all(x.db, `SELECT t.* FROM gv_tasks t JOIN gv_wk w ON w.task = t.id WHERE w.week = ? AND t.kind = 'tt' AND ${OPEN_T} ORDER BY t.id`, W);
export async function gvTick(x, nowArg) {
  const C = await cfgOf(x);
  await schema(x.db);
  try { await gvNotionTick(x, C); } catch (e) { console.error('gvNotion', e.message); }
  const now = nowArg || Date.now(), vn = new Date(now + TZ_MS), wd = vn.getUTCDay(), hm = vn.getUTCHours() * 60 + vn.getUTCMinutes(), W = weekOf(now);
  if (wd === 1 && hm >= 7 * 60 && await once(x, 'gvr_mon_' + W)) await gvMonday(x, C, W, now); // ⑦ chạy cả khi chưa có bot: chuyển việc sang tuần mới
  if (!C.token) return;
  const ppl = await staff(x);
  for (const t of await all(x.db, `SELECT * FROM gv_tasks WHERE ${OPEN} AND due_t = 1 AND rem = 0 AND due > ? AND due <= ?`, now, now + 70 * 60e3)) { // việc có giờ hạn: nhắc trước ~1 tiếng
    await run(x.db, 'UPDATE gv_tasks SET rem = 1 WHERE id = ?', t.id);
    const w = ppl.find(z => z.email === t.who_email); if (w) await tell(x, C, w, '⏰ Còn khoảng 1 tiếng tới hạn <b>việc #' + t.id + '</b> (' + fmtDate(t.due, 'HH:mm') + '): ' + esc(t.title) + '\nXong rồi thì bấm ✅ hoặc trả lời "xong, <kết quả>" vào tin việc nhé.');
  }
  for (const t of (await all(x.db, `SELECT * FROM gv_tasks WHERE ${OPEN} AND rem < 2 AND due IS NOT NULL AND due < ?`, now)).filter(t => late(t, now))) { // qua hạn: chỉ nhắn RIÊNG
    await run(x.db, 'UPDATE gv_tasks SET rem = 2 WHERE id = ?', t.id);
    const w = ppl.find(z => z.email === t.who_email); if (!w) continue;
    await tell(x, C, w, '⏰ <b>Việc #' + t.id + '</b> đã qua hạn (' + esc(dueTxt(t)) + '): ' + esc(t.title) + '\nXong rồi thì bấm ✅; cần thêm thời gian thì trả lời tin việc "xin lùi sang …" để mình cùng sắp xếp nhé.', null, false);
    const b = ppl.find(z => z.email === t.by_email); if (b && b.email !== w.email) { const p = await privChat(x, b); if (p) await say(x, C, p, '⏰ Việc #' + t.id + ' của <b>' + esc(t.who_name) + '</b> đã qua hạn: ' + esc(t.title)); }
  }
  const mem = await members(x, C);
  if ((wd === 1 && hm >= 20 * 60 && hm < 22 * 60) || (wd === 2 && hm >= 7 * 60 + 30 && hm < 9 * 60)) { // ① nhắc chốt việc trọng tâm
    if (await once(x, 'gvr_plan' + wd + '_' + W)) { const noTg = []; for (const z of mem) {
      const L = await ttList(x, z.email, W); if (L.length >= MAX_TT) continue;
      if (L.length && wd === 2) continue; // sáng thứ Ba chỉ nhắc người chưa có việc nào
      if (!await privChat(x, z)) { noTg.push(z); continue; }
      await tell(x, C, z, '🌱 Tuần mới rồi ' + esc(shortName(z.name)) + ' ơi! ' + (L.length ? 'Bạn đang có ' + L.length + ' việc ⭐ (' + L.map(t => esc(t.title)).join('; ') + '). Chốt thêm nếu cần, tổng tối đa 3 việc' : 'Mình chốt tối đa <b>3 việc ⭐ trọng tâm</b>') + ' trước <b>9h sáng thứ Ba</b> nhé.\nNhắn em: <i>trọng tâm tuần: đăng 3 video trà DILVANG lên TikTok, hạn thứ Sáu</i>\nHoặc vào CRM: ' + VIEW_URL, null, false);
    }
    if (noTg.length && C.group) await say(x, C, C.group, '🌱 Tuần mới rồi cả nhà! ' + noTg.map(z => mention(z, z.tg)).join(', ') + ' nhớ chốt tối đa 3 việc ⭐ trọng tâm trước <b>9h sáng thứ Ba</b> nhé (nhắn em hoặc vào CRM). Bấm Kết nối Telegram trong CRM để em nhắc riêng: ' + VIEW_URL); }
  }
  if (wd === 2 && hm >= 9 * 60 && hm < 12 * 60 && await once(x, 'gvr_plan9_' + W)) { // ② 9h thứ Ba: báo Quản lý ai chưa chốt
    const miss = []; for (const z of mem) if (!(await ttList(x, z.email, W)).length) miss.push(z.name);
    await toLeads(x, C, miss.length ? '📋 9h thứ Ba · còn <b>' + miss.length + '</b> người chưa chốt việc trọng tâm tuần ' + wkLabel(W) + ': ' + esc(miss.join(', ')) + '\nCRM: ' + VIEW_URL : '✅ 9h thứ Ba · cả nhà đã chốt việc trọng tâm tuần ' + wkLabel(W) + ' 🌿');
  }
  if (wd === 4 && hm >= 19 * 60 && hm < 21 * 60 && await once(x, 'gvr_pace_' + W)) { // ③ 19h thứ Năm: hỏi tiến độ từng việc trọng tâm
    for (const t of await weekTT(x, W)) {
      const w = ppl.find(z => z.email === t.who_email); if (!w) continue;
      const r = await tell(x, C, w, '📍 <b>Cập nhật tiến độ</b> (trước 21h tối nay)\n⭐ #' + t.id + ' ' + esc(t.title) + (t.goal ? '\n🎯 ' + esc(t.goal) : '') + '\nBấm 1 nút, rồi trả lời tin này 1 câu: đã làm được gì → làm gì tiếp.', { reply_markup: { inline_keyboard: [[{ text: '🟢 Đúng tiến độ', callback_data: 'gv:ok:' + t.id }, { text: '🟡 Có thể trễ', callback_data: 'gv:risk:' + t.id }], [{ text: '🔴 Cần hỗ trợ', callback_data: 'gv:help:' + t.id }, { text: '✅ Xong rồi', callback_data: 'gv:xong:' + t.id }]] } }, false);
      await remember(x, r, t.id);
    }
  }
  if (wd === 4 && hm >= 21 * 60 && await once(x, 'gvr_pace21_' + W)) { // ④ 21h thứ Năm: Quản lý xem ai chưa cập nhật, việc cần hỗ trợ
    const rows = await weekTT(x, W), d0 = startOfDay(now) + 12 * 3600e3; // cập nhật từ trưa thứ Năm trở đi
    const miss = rows.filter(t => !(t.pace_at >= d0)), help = rows.filter(t => t.pace === 'help' || t.pace === 'risk');
    if (miss.length || help.length) await toLeads(x, C, '📍 21h thứ Năm · tiến độ việc trọng tâm' + (miss.length ? '\n<b>Chưa cập nhật:</b> ' + esc([...new Set(miss.map(t => t.who_name))].join(', ')) : '') + (help.length ? '\n<b>Cần mình hỗ trợ:</b>\n' + help.map(t => (t.pace === 'help' ? '🔴 ' : '🟡 ') + esc(t.who_name) + ': ' + esc(t.title) + (t.block ? ' — ' + esc(t.block) : t.next ? ' — ' + esc(t.next) : '')).join('\n') : '') + '\nCRM: ' + VIEW_URL);
  }
  if (wd === 0 && hm >= 19 * 60 && hm < 21 * 60 && await once(x, 'gvr_res_' + W)) { // ⑤ 19h Chủ nhật: hỏi kết quả + minh chứng
    for (const t of await weekTT(x, W)) {
      const w = ppl.find(z => z.email === t.who_email); if (!w) continue;
      const r = await tell(x, C, w, '🏁 <b>Chốt kết quả tuần</b> (trước 21h tối nay)\n⭐ #' + t.id + ' ' + esc(t.title) + (t.goal ? '\n🎯 ' + esc(t.goal) : '') + '\n\n<b>Xong rồi:</b> trả lời tin này <i>xong, đạt … https://link-minh-chung</i> (hoặc gửi ảnh kết quả kèm 1 câu)\n<b>Chưa xong:</b> trả lời <i>chưa xong vì …, tuần sau làm …</i>', { reply_markup: { inline_keyboard: [[{ text: '⏭ Chưa xong, chuyển tuần sau', callback_data: 'gv:carry:' + t.id }]] } }, false);
      await remember(x, r, t.id);
    }
  }
  if (wd === 0 && hm >= 21 * 60 && await once(x, 'gvr_res21_' + W)) { // ⑥ 21h Chủ nhật: Quản lý xem còn thiếu gì
    const R = await weekReport(x, C, W), miss = R.people.filter(p => p.tt.some(r => r.st === 'open') || p.noProof);
    await toLeads(x, C, '🏁 21h Chủ nhật · tuần ' + R.label + ': xong ' + R.total.done + '/' + R.total.n + ' việc trọng tâm' + (miss.length ? '\n<b>Còn mở hoặc thiếu minh chứng:</b> ' + esc(miss.map(p => p.name).join(', ')) : ' 🌿') + '\nBáo cáo họp thứ Hai: ' + VIEW_URL);
  }
}
/** 7h thứ Hai: chuyển việc trọng tâm chưa xong sang tuần mới + gửi mỗi người bài báo cáo cho buổi họp + tổng tuần cho Quản lý, lời cảm ơn trong nhóm. */
export async function gvMonday(x, C, W, nowArg) {
  const P = W - 7 * DAY, ppl = await staff(x);
  const R = await weekReport(x, C, P, null, nowArg);
  for (const t of await weekTT(x, P)) {
    await run(x.db, 'INSERT OR IGNORE INTO gv_wk (task, week) VALUES (?, ?)', t.id, W);
    await run(x.db, "UPDATE gv_tasks SET carry = carry + 1, week = ?, pace = '', ndirty = 1, ntry = 0, upd_at = ? WHERE id = ?", W, Date.now(), t.id);
    await addLog(x, t.id, 'Lành (tự động)', '⏭ chuyển sang tuần ' + wkLabel(W));
  }
  if (!C.token) return R;
  for (const p of R.people) {
    if (!p.n && !p.ps.length) continue;
    const z = ppl.find(y => y.email === p.email); if (!z) continue;
    const pc = await privChat(x, z); if (!pc) continue;
    await say(x, C, pc, speech(p, R.label, await ttList(x, p.email, W)) + '\n\n<i>Dùng bài này để báo cáo 3–5 phút trong buổi họp nhé.</i>');
  }
  await toLeads(x, C, '📊 <b>Tuần ' + R.label + '</b>: xong ' + R.total.done + '/' + R.total.n + ' việc trọng tâm' + (R.total.pctDone == null ? '' : ' (' + R.total.pctDone + '%)') + ', đúng hạn ' + R.total.ontime + '.\nBáo cáo từng người cho buổi họp: CRM → ✅ Việc tuần → 📋 Báo cáo tuần\n' + VIEW_URL);
  const psN = R.people.reduce((a, p) => a + p.ps.length, 0);
  if (C.group && (R.total.done || psN)) await say(x, C, C.group, '🌿 Tuần ' + R.label + ' Nhà Lành cùng xong <b>' + R.total.done + '</b> việc trọng tâm' + (psN ? ' và ' + psN + ' việc phát sinh' : '') + '. Cảm ơn cả nhà 💚');
  return R;
}
/** 8h sáng: mỗi người (đã nối bot) nhận danh sách việc của mình. Nhóm chỉ thấy việc hạn hôm nay (không nêu việc trễ). */
export async function gvMorning(x) {
  const C = await cfgOf(x); if (!C.token) return;
  await schema(x.db);
  const now = Date.now(), d0 = startOfDay(now), ppl = await staff(x);
  const open = await all(x.db, `SELECT * FROM gv_tasks WHERE ${OPEN} ORDER BY (kind <> 'tt'), (due IS NULL), due, id`);
  const line = t => (t.kind === 'tt' ? '⭐' : '•') + ' #' + t.id + ' ' + esc(t.title) + ' · ' + esc(dueTxt(t)) + (late(t, now) ? ' ⏰' : '');
  for (const w of ppl) {
    const mine = open.filter(t => t.who_email === w.email); if (!mine.length) continue;
    const p = await privChat(x, w); if (!p) continue;
    const tt = mine.filter(t => t.kind === 'tt').length;
    await say(x, C, p, '☀️ Chào ' + esc(shortName(w.name)) + '! Hôm nay mình cùng làm <b>' + mine.length + '</b> việc' + (tt ? ' (' + tt + ' việc ⭐ trọng tâm)' : '') + ':\n' + mine.slice(0, 25).map(line).join('\n') + '\n\nXong việc nào thì bấm ✅ hoặc trả lời "xong, <kết quả>" vào tin việc nhé 🌿');
  }
  if (C.group) {
    const hot = open.filter(t => t.due && startOfDay(t.due) === d0);
    if (hot.length) {
      const by = {}; hot.forEach(t => (by[t.who_email] || (by[t.who_email] = [])).push(t));
      await say(x, C, C.group, '☀️ <b>Hôm nay Nhà Lành cùng làm</b> (' + hot.length + ' việc hạn hôm nay)\n' + Object.keys(by).map(e => { const w = ppl.find(z => z.email === e) || { name: by[e][0].who_name }; return '\n<b>' + esc(w.name) + '</b>\n' + by[e].map(t => (t.kind === 'tt' ? '⭐ ' : '• ') + esc(t.title) + (t.due_t ? ' · ' + fmtDate(t.due, 'HH:mm') : '')).join('\n'); }).join('\n'));
    }
  }
}

/* ---------------------------------------------------------------- Notion song song (CRM → "VitaGreen TDL. Công việc & Mục tiêu tuần") */
async function notion(N, method, path, body) {
  const r = await fetch('https://api.notion.com/v1/' + path, { method, headers: { Authorization: 'Bearer ' + N.token, 'Notion-Version': NV, 'Content-Type': 'application/json' }, body: body ? JSON.stringify(body) : undefined });
  const j = await r.json().catch(() => ({})); if (!r.ok) throw new Error((j.message || 'Notion lỗi ' + r.status).slice(0, 200)); return j;
}
const rt = s => [{ type: 'text', text: { content: String(s || '').slice(0, 1900) } }];
const nDate = (t, withTime) => t ? { start: withTime ? fmtDate(t, 'yyyy-MM-dd') + 'T' + fmtDate(t, 'HH:mm') + ':00+07:00' : fmtDate(t, 'yyyy-MM-dd') } : null;
/** Chọn ô "Nhân sự thực hiện" (dạng "Bộ phận — Họ tên") khớp họ tên đầy đủ / tên trong CRM. */
export function nPerson(M, z) {
  if (!z) return null;
  const keys = [nrm(z.full || ''), nrm(z.name)].filter(Boolean);
  const opts = (M.people || []).map(o => ({ o, n: nrm(o.split(' — ').pop()) }));
  const hit = opts.filter(p => keys.indexOf(p.n) >= 0);
  if (hit.length === 1) return hit[0].o;
  const ends = opts.filter(p => keys.some(k => p.n.endsWith(' ' + k) || k.endsWith(' ' + p.n)));
  return ends.length === 1 ? ends[0].o : null;
}
export function nProps(C, M, t, z, helpers) {
  const P = {
    'Đầu việc / Kết quả': { title: rt(t.title) },
    'Kết quả mong muốn': { rich_text: rt(t.goal) },
    'Loại việc': { select: { name: t.kind === 'tt' ? 'Cam kết đầu tuần' : 'Phát sinh' } },
    'Trạng thái': { status: { name: t.status === 'Xong' ? 'Hoàn thành' : t.pace === 'help' ? 'Chờ hỗ trợ' : t.status === 'Mới' ? 'Chưa làm' : 'Đang làm' } },
    'Hạn hoàn thành': { date: nDate(t.due, t.due_t) },
    'Kết quả thực tế': { rich_text: rt(t.result) },
    'Minh chứng': { url: proofUrl(C, t) || null },
    'Ngày hoàn thành thực tế': { date: t.status === 'Xong' ? nDate(t.done_at, false) : null },
    'Bước tiếp theo': { rich_text: rt(t.next) },
    'Vướng mắc / Cần hỗ trợ': { rich_text: rt(t.block) },
    'Số lần chuyển tuần': { number: t.carry || 0 },
    'Mức ảnh hưởng': { select: { name: t.kind === 'tt' ? 'Cao — Ảnh hưởng trực tiếp' : 'Thường — Có ảnh hưởng' } },
    'Ưu tiên': { select: { name: t.kind === 'tt' ? 'P1 — Quan trọng' : 'P2 — Bình thường' } },
    'Dừng có duyệt': { checkbox: t.status === 'Huỷ' },
    'Đã kiểm tra trước khi gửi': { checkbox: !!t.goal },
  };
  if (t.qa) P['Nghiệm thu kết quả'] = { select: { name: t.qa } };
  const pn = nPerson(M, z); if (pn) { P['Nhân sự thực hiện'] = { select: { name: pn } }; const dep = pn.split(' — ')[0]; if ((M.deps || []).indexOf(dep) >= 0) P['Bộ phận'] = { select: { name: dep } }; }
  const uid = z && M.users && M.users[z.email]; if (uid) P['Người phụ trách chính'] = { people: [{ id: uid }] };
  P['Người phối hợp / hỗ trợ'] = { people: helpers.map(e => M.users && M.users[e]).filter(Boolean).map(id => ({ id })) };
  return P;
}
/** Đọc cấu trúc bảng (tên nhân sự, bộ phận) + tài khoản Notion (email → id) để gắn "Người phụ trách chính" → view "Việc của tôi" trên Notion vẫn đúng. */
async function notionMeta(N) {
  const db = await notion(N, 'GET', 'databases/' + N.db);
  const pr = db.properties || {}, opt = k => pr[k] && pr[k].select ? pr[k].select.options.map(o => o.name) : [];
  const users = {}; let cur;
  try { for (let i = 0; i < 5; i++) { const j = await notion(N, 'GET', 'users?page_size=100' + (cur ? '&start_cursor=' + cur : '')); (j.results || []).forEach(u => { if (u.type === 'person' && u.person && u.person.email) users[u.person.email.toLowerCase()] = u.id; }); if (!j.has_more) break; cur = j.next_cursor; } } catch (e) { }
  return { people: opt('Nhân sự thực hiện'), deps: opt('Bộ phận'), users, title: (db.title || []).map(t => t.plain_text).join(''), at: Date.now() };
}
export async function gvNotionTick(x, C, max) {
  if (!C.notion || !C.notion.token) return 0;
  let M = await kvJson(x.db, 'gv_nmeta', null);
  if (!M || Date.now() - M.at > 6 * 3600e3) { M = await notionMeta(C.notion); await kvSet(x.db, 'gv_nmeta', JSON.stringify(M)); }
  const rows = await all(x.db, 'SELECT * FROM gv_tasks WHERE ndirty = 1 AND ntry < 5 ORDER BY upd_at LIMIT ?', max || 12), ppl = await crmUsers(x);
  let n = 0;
  for (const t of rows) {
    try {
      const z = ppl.find(y => y.email === t.who_email), props = nProps(C, M, t, z, helpersOf(t));
      if (t.nid) await notion(C.notion, 'PATCH', 'pages/' + t.nid, { properties: props });
      else {
        const pg = await notion(C.notion, 'POST', 'pages', { parent: { database_id: C.notion.db }, properties: props, children: [{ object: 'block', type: 'paragraph', paragraph: { rich_text: rt('Tự ghi từ CRM · Việc #' + t.id + ' · ' + (t.by_email === t.who_email ? 'tự đặt' : t.by_name + ' nhờ') + '. Cập nhật ở CRM / Telegram; sửa ở đây sẽ bị CRM ghi đè.') } }] });
        await run(x.db, 'UPDATE gv_tasks SET nid = ? WHERE id = ?', pg.id, t.id);
      }
      await run(x.db, "UPDATE gv_tasks SET ndirty = 0, ntry = 0, nerr = '' WHERE id = ? AND upd_at = ?", t.id, t.upd_at); n++;
    } catch (e) { await run(x.db, 'UPDATE gv_tasks SET ntry = ntry + 1, nerr = ? WHERE id = ?', String(e.message).slice(0, 200), t.id); }
  }
  return n;
}

/* ---------------------------------------------------------------- CRM */
async function gvList(x, u) {
  await schema(x.db);
  const C = await cfgOf(x), lead = canAssign(u, C), now = Date.now();
  const rows = await all(x.db, `SELECT * FROM gv_tasks WHERE (${OPEN} OR upd_at > ?) ${lead ? '' : "AND (who_email = ? OR by_email = ? OR (',' || helpers || ',') LIKE ?)"} ORDER BY id DESC LIMIT 500`, now - 30 * DAY, ...(lead ? [] : [u.email, u.email, '%,' + u.email + ',%']));
  const ids = rows.map(t => t.id), logs = ids.length ? await all(x.db, `SELECT task, at, by_name, text FROM gv_log WHERE task IN (${ids.map(() => '?').join(',')}) ORDER BY id`, ...ids) : [];
  const L = {}; logs.forEach(l => (L[l.task] || (L[l.task] = [])).push({ at: l.at, by: l.by_name, text: l.text }));
  const ppl = await staff(x), linked = {};
  for (const z of ppl) linked[z.email] = !!(await kvGet(x.db, 'gv_tg_' + z.email));
  const W = weekOf(now), inW = new Set((await all(x.db, 'SELECT task FROM gv_wk WHERE week = ?', W)).map(r => r.task));
  const tasks = rows.map(t => ({ id: t.id, title: t.title, body: t.body, goal: t.goal, kind: t.kind, who: t.who_name, whoE: t.who_email, by: t.by_name, byE: t.by_email, due: t.due, dueT: t.due_t ? 1 : 0, st: t.status, at: t.at, upd: t.upd_at, done: t.done_at, src: t.src,
    result: t.result, proof: proofUrl(C, t), proofTg: /^tg:/.test(t.proof) ? 1 : 0, pace: t.pace, paceAt: t.pace_at, next: t.next, block: t.block, carry: t.carry, qa: t.qa, helpers: helpersOf(t), thisWeek: inW.has(t.id) ? 1 : 0, late: late(t, now) ? 1 : 0, nOk: t.nid && !t.ndirty ? 1 : 0, log: L[t.id] || [] }));
  const out = { tasks, me: u.email, lead: lead ? 1 : 0, admin: u.level >= 3 ? 1 : 0, linked: linked[u.email] ? 1 : 0, bot: C.bot, group: C.groupName || (C.group ? 'đã nối' : ''), on: C.token ? 1 : 0, ai: x.env.ANTHROPIC_API_KEY ? 1 : 0, week: W, weekLabel: wkLabel(W), max: MAX_TT, now,
    staff: ppl.map(z => ({ email: z.email, name: z.name, role: z.role, tg: linked[z.email] || !!z.tg ? 1 : 0, lead: canAssign(z, C) ? 1 : 0, lv: z.level, mem: (C.out || []).indexOf(z.email) < 0 ? 1 : 0 })) };
  if (u.level >= 3) { out.leads = C.leads || []; out.notion = C.notion ? { title: C.notion.title || '', wait: (await first(x.db, 'SELECT COUNT(*) n FROM gv_tasks WHERE ndirty = 1 AND ntry < 5')).n, fail: (await first(x.db, 'SELECT COUNT(*) n FROM gv_tasks WHERE ndirty = 1 AND ntry >= 5')).n, err: ((await first(x.db, "SELECT nerr FROM gv_tasks WHERE nerr <> '' ORDER BY upd_at DESC LIMIT 1")) || {}).nerr || '' } : null; }
  return { ok: true, gv: out };
}
async function gvSave(x, u, d) {
  await schema(x.db);
  const C = await cfgOf(x), ppl = await staff(x), w = ppl.find(z => z.email === String(d.who || '').toLowerCase()) || (d.id ? null : u);
  const due = Number(d.due) || null, dueT = d.dueT ? 1 : 0, kind = d.kind === 'tt' ? 'tt' : 'ps', helpers = (Array.isArray(d.helpers) ? d.helpers : []).map(e => String(e).toLowerCase()).filter(e => ppl.some(z => z.email === e));
  const title = clean(d.title, 300), goal = clean(d.goal, 500);
  if (!title) return { ok: false, error: 'Bạn ghi việc cần làm nhé.' };
  if (!goal) return { ok: false, error: 'Ghi "Thế nào là xong" (con số hoặc sản phẩm bàn giao) để hai bên cùng hiểu một kết quả nhé.' };
  if (kind === 'tt' && !d.force) { const g = await goalCheck(x, title, goal); if (!g.ok) return { ok: false, needFix: 1, tip: g.tip || 'Kết quả này chưa đo được.', goal: g.goal || '', error: g.tip || 'Kết quả này chưa đo được.' }; }
  if (Number(d.id)) {
    const t = await getTask(x, d.id); if (!t) return { ok: false, error: 'Không thấy việc này.' };
    const r = await changeTask(x, C, u, t, { title, body: d.body, goal, due, dueT, kind, helpers, who: w && w.email !== t.who_email ? w : null });
    return r.ok ? gvList(x, u) : r;
  }
  if (!w) return { ok: false, error: 'Chọn người làm.' };
  if (kind === 'tt') { const err = await ttGuard(x, C, u, w); if (err) return { ok: false, error: err }; }
  const t = await createTask(x, C, u, w, { title, body: d.body, goal, due, dueT, kind, helpers }, 'crm');
  let sent = 0; if (C.token && d.tg !== false) { try { sent = await announce(x, C, t, { alsoPriv: 1 }); } catch (e) { console.error('gv announce', e.message); } }
  const r = await gvList(x, u); r.sent = sent; return r;
}
async function gvSet(x, u, d) {
  const C = await cfgOf(x), t = await getTask(x, d.id); if (!t) return { ok: false, error: 'Không thấy việc này.' };
  const ch = { status: GV_ST.indexOf(d.st) >= 0 ? d.st : '', note: d.note, pace: PACE[d.pace] ? d.pace : '', next: d.next || '', qa: ['Đạt yêu cầu', 'Cần bổ sung', 'Chờ xác nhận'].indexOf(d.qa) >= 0 ? d.qa : '' };
  if (d.result !== undefined) ch.result = d.result;
  if (d.proof !== undefined && d.proof !== '') { if (!hasLink(d.proof)) return { ok: false, error: 'Minh chứng cần là 1 link mở được (bài đăng, Google Drive, Sheet, Canva…).' }; ch.proof = linkOf(d.proof); }
  if (d.block !== undefined) ch.block = d.block;
  const r = await changeTask(x, C, u, t, ch);
  return r.ok ? gvList(x, u) : r;
}
async function gvLink(x, u) {
  const C = await cfgOf(x); if (!C.token || !C.bot) return { ok: false, error: 'Anh Sơn chưa cài bot.' };
  const code = randHex(5); await kvSet(x.db, 'gvl_' + code, u.email, 3600e3);
  return { ok: true, url: 'https://t.me/' + C.bot + '?start=' + code };
}
async function gvRep(x, u, d) {
  const C = await cfgOf(x), W = Number(d.week) || weekOf(Date.now()), lead = canAssign(u, C);
  const R = await weekReport(x, C, W, lead ? null : u.email);
  R.people.forEach(p => { p.text = speech(p, R.label).replace(/<[^>]+>/g, ''); });
  const trend = []; if (lead) for (let i = 1; i <= 4; i++) { const r = await weekReport(x, C, W - i * 7 * DAY); trend.push({ week: r.week, label: r.label, total: r.total, people: r.people.map(p => ({ email: p.email, n: p.n, done: p.done, ontime: p.ontime })) }); }
  return { ok: true, rep: R, trend, lead: lead ? 1 : 0, thisWeek: weekOf(Date.now()) };
}
async function gvCfg(x, u, d) {
  if (u.level < 3) return { ok: false, error: 'Chỉ Quản trị cài được phần này.' };
  const C = await cfgOf(x);
  if (d.bot !== undefined) {
    const tok = String(d.bot || '').trim();
    if (!/^\d{6,}:[\w-]{30,}$/.test(tok)) return { ok: false, error: 'Khoá bot chưa đúng. Khoá có dạng 123456789:ABC… (BotFather gửi sau khi tạo bot).' };
    const me = await tg(x, { token: tok }, 'getMe', {});
    if (!me || !me.ok) return { ok: false, error: 'Telegram không nhận khoá này (' + (me && me.description || 'không kết nối được') + ').' };
    if (me.result.username === 'thucduonglanh_donhang_bot') return { ok: false, error: 'Đây là bot báo đơn. Cần tạo 1 bot MỚI riêng cho việc tuần.' };
    const secret = randHex(16);
    const wh = await tg(x, { token: tok }, 'setWebhook', { url: API + '/gv/tg/' + secret, secret_token: secret, allowed_updates: ['message', 'callback_query', 'my_chat_member'], drop_pending_updates: true });
    if (!wh || !wh.ok) return { ok: false, error: 'Không bật được nhận tin (' + (wh && wh.description || '') + ').' };
    await tg(x, { token: tok }, 'setMyCommands', { commands: [{ command: 'viec', description: 'Việc của tôi' }, { command: 'baocao', description: 'Báo cáo tuần của tôi' }, { command: 'phong', description: 'Việc cả công ty (Quản lý)' }, { command: 'help', description: 'Cách dùng' }, { command: 'noinhom', description: 'Dùng nhóm này (Quản lý)' }] });
    Object.assign(C, { token: tok, bot: me.result.username, secret });
  }
  if (d.notion !== undefined) {
    const tok = String(d.notion || '').trim();
    if (!tok) C.notion = null;
    else {
      if (!/^(secret_|ntn_)\w{20,}$/.test(tok)) return { ok: false, error: 'Khoá Notion có dạng ntn_… hoặc secret_… (lấy ở notion.so/profile/integrations).' };
      const N = { token: tok, db: NOTION_DB };
      try { const M = await notionMeta(N); N.title = M.title; await kvSet(x.db, 'gv_nmeta', JSON.stringify(M)); }
      catch (e) { return { ok: false, error: 'Notion chưa cho đọc bảng "VitaGreen TDL. Công việc & Mục tiêu tuần" (' + e.message + '). Mở bảng → ••• → Kết nối (Connections) → chọn tích hợp vừa tạo.' }; }
      C.notion = N; await run(x.db, 'UPDATE gv_tasks SET ndirty = 1, ntry = 0');
    }
  }
  if (Array.isArray(d.leads)) C.leads = d.leads.map(e => String(e).toLowerCase()).filter(e => /@/.test(e)).slice(0, 30);
  if (Array.isArray(d.out)) C.out = d.out.map(e => String(e).toLowerCase()).filter(e => /@/.test(e)).slice(0, 80);
  if (d.ungroup) { C.group = ''; C.groupName = ''; }
  if (d.off) { if (C.token) await tg(x, C, 'deleteWebhook', {}); Object.assign(C, { token: '', bot: '', secret: '' }); }
  await cfgSet(x, C);
  if (d.notion) { try { await gvNotionTick(x, C, 20); } catch (e) { } }
  return gvList(x, u);
}
export async function crmGv(x, u, d) {
  const a = d.action;
  if (a === 'gv_list') return gvList(x, u);
  if (a === 'gv_save') return gvSave(x, u, d);
  if (a === 'gv_set') return gvSet(x, u, d);
  if (a === 'gv_link') return gvLink(x, u);
  if (a === 'gv_cfg') return gvCfg(x, u, d);
  if (a === 'gv_rep') return gvRep(x, u, d);
  if (a === 'gv_check') return { ok: true, check: await goalCheck(x, d.title, d.goal) };
  return { ok: false, error: 'Không rõ thao tác: ' + a };
}
