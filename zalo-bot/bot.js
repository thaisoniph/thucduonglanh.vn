/* 🤖 Trợ lý An Lành – chương trình giữ tài khoản Zalo "Trợ lý An Lành" (26/10/2026)
 * Chỉ "nghe – nói": nhận tin / sự kiện từ Zalo → hỏi máy chủ api.thucduonglanh.vn (api/src/zbot.js) → làm theo.
 * Thư viện zca-js (không chính thức): đăng nhập bằng mã QR như Zalo trên máy tính. Giữ nhịp như người thật để Zalo không khoá tài khoản.
 * Bí mật nằm ở máy (không đưa lên GitHub): .env (ZBOT_KEY), creds.json (phiên đăng nhập Zalo). Cách cài: README.md */
import { Zalo, ThreadType, GroupEventType, FriendEventType, LoginQRCallbackEventType, TextStyle, Reactions } from 'zca-js';
import sharp from 'sharp';
import { readFileSync, writeFileSync, existsSync, mkdirSync, unlinkSync } from 'node:fs';
import { execFile } from 'node:child_process';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const VER = '2026-10-31a';
const DIR = dirname(fileURLToPath(import.meta.url)), TMP = join(DIR, 'tmp'), CREDS = join(DIR, 'creds.json'), QR = join(DIR, 'qr.png');
for (const l of (existsSync(join(DIR, '.env')) ? readFileSync(join(DIR, '.env'), 'utf8') : '').split('\n')) { const m = l.match(/^\s*([A-Z_]+)\s*=\s*(.*)\s*$/); if (m && !process.env[m[1]]) process.env[m[1]] = m[2]; }
const API = process.env.API_URL || 'https://api.thucduonglanh.vn/', KEY = process.env.ZBOT_KEY;
if (!KEY) { console.error('Thiếu ZBOT_KEY trong .env (xem README.md)'); process.exit(1); }
if (!existsSync(TMP)) mkdirSync(TMP);

const log = (...a) => console.log(new Date().toLocaleString('vi-VN', { timeZone: 'Asia/Ho_Chi_Minh' }), ...a);
const sleep = ms => new Promise(r => setTimeout(r, ms));
const rnd = (a, b) => a + Math.random() * (b - a);
async function call(ev, data) {
  for (let i = 0; i < 3; i++) {
    try {
      const r = await fetch(API, { method: 'POST', headers: { 'Content-Type': 'text/plain;charset=utf-8' }, body: JSON.stringify(Object.assign({ type: 'zbot', key: KEY, ev }, data)), signal: AbortSignal.timeout(90e3) });
      const j = await r.json(); if (j.error === 'key') log('⚠️ Máy chủ không nhận ZBOT_KEY'); return j;
    } catch (e) { log('api', ev, e.message); await sleep(3000 * (i + 1)); }
  }
  return {};
}

let api = null, me = '', myName = '', CFG = { on: false, groups: [] };
const G = {}; // nhóm: { name, total, admins:Set, members:Set, ctx:[], joins:[], joinTimer }
const isMine = gid => CFG.groups.includes(gid);

/* ---------------------------------------------------------------- gửi tin: 1 hàng đợi, nghỉ giữa các tin như người thật */
let chain = Promise.resolve(), lastSend = 0;
function queue(fn) { chain = chain.then(async () => { const gap = 3500 + rnd(0, 2500) - (Date.now() - lastSend); if (gap > 0) await sleep(gap); try { return await fn(); } catch (e) { log('gửi lỗi', e.message); throw e; } finally { lastSend = Date.now(); } }); return chain; }
/** **đậm** → kiểu chữ Zalo; @Tên → gọi tên */
function rich(text, mentions) {
  const styles = []; let out = '', i = 0; const s = String(text || '');
  const re = /\*\*([^*\n]+)\*\*/g; let m;
  while ((m = re.exec(s))) { out += s.slice(i, m.index); styles.push({ start: out.length, len: m[1].length, st: TextStyle.Bold }); out += m[1]; i = m.index + m[0].length; }
  out += s.slice(i);
  const ms = []; for (const p of mentions || []) { const tag = '@' + p.name, pos = out.indexOf(tag); if (pos >= 0) ms.push({ pos, uid: p.uid, len: tag.length }); }
  const o = { msg: out }; if (styles.length) o.styles = styles; if (ms.length) o.mentions = ms; return o;
}
async function typing(tid, type, text) { try { await api.sendTypingEvent(tid, type); } catch (e) { } await sleep(Math.min(9000, 1500 + String(text || '').length * 45 + rnd(0, 1500))); }
/* tin do trợ lý gửi (để phân biệt với tin nhân sự nhắn tay trên điện thoại "Trợ lý An Lành") */
const SENT = new Map();
function mine(id, text) { const now = Date.now(); if (id) SENT.set('i' + id, now); if (text) SENT.set('t' + String(text).trim().slice(0, 200), now); for (const [k, t] of SENT) if (now - t > 10 * 60e3) SENT.delete(k); }
const isBotMsg = d => SENT.has('i' + d.msgId) || SENT.has('i' + d.realMsgId) || (typeof d.content === 'string' && SENT.has('t' + d.content.trim().slice(0, 200)));
function say(tid, type, text, extra) {
  const c = Object.assign(rich(text, extra && extra.mentions), extra && extra.quote ? { quote: extra.quote } : {});
  mine('', c.msg);
  return queue(async () => { await typing(tid, type, text); const r = await api.sendMessage(c, tid, type); mine(r && r.message && r.message.msgId, c.msg); return r; });
}
/** Câu trả lời dài → 2 tin ngắn như người thật nhắn (chỉ tin đầu trích dẫn câu hỏi) */
async function reply(tid, type, text, extra) {
  const p = String(text || '').split(/\n\s*\n/), cut = text.length > 160 && p.length > 1 ? Math.ceil(p.length / 2) : p.length;
  const a = p.slice(0, cut).join('\n\n'), b = p.slice(cut).join('\n\n');
  try { await say(tid, type, a, extra); } catch (e) { if (!extra) throw e; await say(tid, type, a); } // trích dẫn lỗi → gửi thường
  if (b) await say(tid, type, b);
}
async function imgFile(url) {
  const r = await fetch(url, { signal: AbortSignal.timeout(30e3) }); if (!r.ok) throw new Error('ảnh ' + r.status);
  const f = join(TMP, Date.now() + '.jpg');
  await sharp(Buffer.from(await r.arrayBuffer())).resize({ width: 1280, height: 1280, fit: 'inside', withoutEnlargement: true }).flatten({ background: '#ffffff' }).jpeg({ quality: 86 }).toFile(f);
  return f;
}
async function post(gid, text, img, mentions) {
  const ids = [];
  if (img) {
    try { const f = await imgFile(img); const r = await queue(() => api.sendMessage({ msg: '', attachments: [f] }, gid, ThreadType.Group)); try { unlinkSync(f); } catch (e) { } for (const a of (r && r.attachment) || []) if (a && a.msgId) ids.push(String(a.msgId)); }
    catch (e) { log('ảnh bài đăng', e.message); }
  }
  const r = await say(gid, ThreadType.Group, text, { mentions });
  if (r && r.message && r.message.msgId) ids.push(String(r.message.msgId));
  return ids;
}

/* ---------------------------------------------------------------- nhóm */
async function refreshGroups() {
  try {
    const ids = Object.keys((await api.getAllGroups()).gridVerMap || {});
    for (let i = 0; i < ids.length; i += 20) {
      const info = (await api.getGroupInfo(ids.slice(i, i + 20))).gridInfoMap || {};
      for (const [id, g] of Object.entries(info)) {
        const o = G[id] || (G[id] = { ctx: [], joins: [] });
        o.name = g.name; o.total = g.totalMember; o.admins = new Set([g.creatorId, ...(g.adminIds || [])]);
        o.members = new Set((g.memVerList || g.memberIds || []).map(v => String(v).split('_')[0]));
        o.boss = o.admins.has(me);
      }
    }
  } catch (e) { log('đọc nhóm', e.message); }
}
const groupList = () => Object.entries(G).map(([id, g]) => ({ id, name: g.name || '', total: g.total || 0, admin: !!g.boss }));
/* ---------------------------------------------------------------- đo tương tác bài đăng: 2 tiếng sau khi đăng, đếm tin nhắn, số người nói, lượt thả cảm xúc (không tính đội ngũ, trợ lý) */
const WATCH = {}, WATCH_MS = 2 * 3600e3;
function watchPost(gid, ref, ids) { WATCH[gid] = { ref, ids: new Set(ids), until: Date.now() + WATCH_MS, msgs: 0, people: new Set(), reacts: 0, dirty: 1 }; }
function watchMsg(gid, uid) { const w = WATCH[gid]; if (!w || Date.now() > w.until) return; w.msgs++; w.people.add(String(uid)); w.dirty = 1; }
function onReaction(r) {
  if (r.isSelf || !r.isGroup) return; const w = WATCH[r.threadId]; if (!w || Date.now() > w.until) return;
  const g = G[r.threadId]; if (g && g.admins && g.admins.has(String(r.data.uidFrom))) return;
  if (((r.data.content && r.data.content.rMsg) || []).some(x => w.ids.has(String(x.gMsgID)))) { w.reacts++; w.people.add(String(r.data.uidFrom)); w.dirty = 1; }
}
function watchStats() { // gửi kèm vòng hỏi máy chủ; hết 2 tiếng thì gửi lần cuối rồi thôi
  const out = [];
  for (const [gid, w] of Object.entries(WATCH)) {
    const done = Date.now() > w.until;
    if (w.dirty || done) out.push({ id: w.ref, msgs: w.msgs, people: w.people.size, reacts: w.reacts, done: done ? 1 : 0 });
    w.dirty = 0; if (done) delete WATCH[gid];
  }
  return out;
}
function remember(gid, m) { const g = G[gid] || (G[gid] = { ctx: [], joins: [], admins: new Set(), members: new Set() }); g.ctx.push(m); if (g.ctx.length > 15) g.ctx.shift(); }

/* ---------------------------------------------------------------- vòng hỏi máy chủ (45 giây) */
let pendAt = 0;
async function poll() {
  const pending = {};
  if (Date.now() - pendAt > 3 * 60e3) { // người xin vào nhóm: 3 phút xem 1 lần
    pendAt = Date.now();
    for (const gid of CFG.groups) {
      if (!G[gid] || !G[gid].boss) continue;
      try { const p = await api.getPendingGroupMembers(gid); if (p && p.users && p.users.length) pending[gid] = p.users.map(u => ({ uid: u.uid, name: u.dpn })); } catch (e) { }
    }
  }
  const r = await call('poll', { me: { uid: me, name: myName }, groups: groupList(), pending, ver: VER, stats: watchStats() });
  if (r.cfg) CFG = r.cfg;
  for (const [gid, uids] of Object.entries(r.approve || {})) {
    try { const res = await api.reviewPendingMemberRequest({ members: uids, isApprove: true }, gid); log('✅ duyệt vào nhóm', G[gid] && G[gid].name, JSON.stringify(res)); } catch (e) { log('duyệt', e.message); }
  }
  for (const j of r.jobs || []) doJob(j);
}
async function doJob(j) {
  try {
    if (j.kind === 'lookup') {
      const u = await api.findUser(j.phone); const uid = u && (u.uid || u.userId);
      if (!uid) return call('ack', { id: j.id, ok: false, error: 'không tìm thấy' });
      return call('ack', { id: j.id, ok: true, uid, zname: u.zalo_name || u.display_name || '', inGroups: Object.entries(G).filter(([, g]) => g.members && g.members.has(String(uid))).map(([id]) => id) });
    }
    if (j.kind === 'post') { const ids = await post(j.gid, j.text, j.img, j.mentions); if (j.ref && j.ref !== 'announce') watchPost(j.gid, j.ref, ids); remember(j.gid, { uid: me, name: myName, text: j.text, bot: 1 }); return call('ack', { id: j.id, ok: true }); }
    if (j.kind === 'dm') { await say(j.uid, ThreadType.User, j.text); return call('ack', { id: j.id, ok: true }); }
  } catch (e) { log('việc', j.kind, e.message); call('ack', { id: j.id, ok: false, error: e.message }); }
}

/* ---------------------------------------------------------------- tin nhắn */
const handled = {}; // người đã được đội ngũ trả lời → trợ lý không chen vào 30 phút
const HUMAN = {}, HUMAN_MS = 2 * 3600e3; // nhân sự nhắn tay trên điện thoại "Trợ lý An Lành" → trợ lý nhường cuộc trò chuyện đó 2 tiếng
const humanOn = tid => HUMAN[tid] && Date.now() - HUMAN[tid] < HUMAN_MS;
async function onMessage(m) {
  const d = m.data, text = typeof d.content === 'string' ? d.content.trim() : '';
  if (m.isSelf) {
    if (!text || isBotMsg(d)) return; // ảnh / tin trợ lý vừa gửi quay về
    if (m.type === ThreadType.User) { if (!humanOn(m.threadId)) call('human', { uid: m.threadId, text }); HUMAN[m.threadId] = Date.now(); log('🧑 nhân sự nhắn tay, trợ lý nhường', m.threadId); }
    else { remember(m.threadId, { uid: me, name: 'Đội ngũ', text, staff: 1 }); if (d.quote && d.quote.ownerId) handled[m.threadId + d.quote.ownerId] = Date.now(); for (const x of d.mentions || []) handled[m.threadId + x.uid] = Date.now(); }
    return;
  }
  if (m.type === ThreadType.User) {
    if (!text || !CFG.on || humanOn(m.threadId)) return;
    const r = await call('dm', { uid: m.threadId, name: d.dName, text });
    if (r.reply && !humanOn(m.threadId)) await reply(m.threadId, ThreadType.User, r.reply);
    return;
  }
  const gid = m.threadId, g = G[gid]; if (!g) return;
  const staff = g.admins && g.admins.has(d.uidFrom);
  if (!staff) watchMsg(gid, d.uidFrom); // đếm cả ảnh, sticker (khoe mâm cơm…)
  if (!text) return;
  remember(gid, { uid: d.uidFrom, name: d.dName, text, staff: staff ? 1 : 0 });
  if (!isMine(gid) || !CFG.on) return;
  if (staff) { // đội ngũ trả lời ai thì đánh dấu người đó
    if (d.quote && d.quote.ownerId) handled[gid + d.quote.ownerId] = Date.now();
    for (const x of d.mentions || []) handled[gid + x.uid] = Date.now();
    return;
  }
  const direct = (d.mentions || []).some(x => x.uid === me) || (d.quote && String(d.quote.ownerId) === me) || (/an lành/i.test(text) && /trợ lý|ơi/i.test(text));
  if (!direct && (!CFG.answer || CFG.quiet)) return;
  if (!direct) { // chờ 90 giây: đội ngũ / thành viên khác trả lời trước thì thôi
    const n = g.ctx.length; await sleep(90e3 + rnd(0, 30e3));
    if (handled[gid + d.uidFrom] && Date.now() - handled[gid + d.uidFrom] < 30 * 60e3) return;
    if (g.ctx.slice(n).some(x => x.staff || x.bot)) return;
  }
  const r = await call('msg', { gid, uid: d.uidFrom, name: d.dName, text, direct, ctx: g.ctx.slice(0, -1) });
  if (r.react) { try { await sleep(rnd(2000, 6000)); await api.addReaction(Reactions.HEART, { data: { msgId: d.msgId, cliMsgId: d.cliMsgId }, threadId: gid, type: ThreadType.Group }); } catch (e) { log('thả tim', e.message); } }
  if (r.reply) {
    const quote = { content: d.content, msgType: d.msgType, propertyExt: d.propertyExt, uidFrom: d.uidFrom, msgId: d.msgId, cliMsgId: d.cliMsgId, ts: d.ts, ttl: d.ttl };
    await reply(gid, ThreadType.Group, r.reply, { quote });
    remember(gid, { uid: me, name: myName, text: r.reply, bot: 1 });
  }
}

/* ---------------------------------------------------------------- vào nhóm: gom 60 giây rồi chào 1 lần */
function onGroupEvent(ev) {
  const gid = ev.threadId, g = G[gid] || (G[gid] = { ctx: [], joins: [], admins: new Set(), members: new Set() });
  if (ev.type === GroupEventType.JOIN) {
    const mem = (ev.data.updateMembers || []).filter(u => u.id !== me);
    for (const u of mem) { g.members.add(String(u.id)); g.joins.push({ uid: String(u.id), name: u.dName }); }
    if (!mem.length || !isMine(gid) || !CFG.on) return;
    clearTimeout(g.joinTimer);
    g.joinTimer = setTimeout(async () => {
      const list = g.joins.splice(0); if (!list.length) return;
      const r = await call('join', { gid, members: list });
      if (r.text && !CFG.quiet) { await post(gid, r.text, '', r.mentions); remember(gid, { uid: me, name: myName, text: r.text, bot: 1 }); }
    }, 60e3 + rnd(0, 20e3));
  }
  if (ev.type === GroupEventType.LEAVE || ev.type === GroupEventType.REMOVE_MEMBER) for (const u of ev.data.updateMembers || []) g.members.delete(String(u.id));
  if ([GroupEventType.ADD_ADMIN, GroupEventType.REMOVE_ADMIN, GroupEventType.UPDATE].includes(ev.type)) setTimeout(refreshGroups, 5000);
  if (ev.type === GroupEventType.JOIN_REQUEST && isMine(gid)) pendAt = 0; // có người xin vào → lần hỏi tới xem ngay
}

async function onFriend(ev) {
  if (ev.type !== FriendEventType.REQUEST || ev.isSelf) return;
  const uid = ev.data.fromUid; let name = '';
  try { const info = await api.getUserInfo(uid); const p = Object.values(info.changed_profiles || {})[0]; name = p ? p.displayName || p.zaloName : ''; } catch (e) { }
  const r = await call('friend', { uid, name, msg: ev.data.message });
  if (!r.accept) return;
  await sleep(rnd(20e3, 90e3)); // như người thật: một lúc sau mới đồng ý
  try { await api.acceptFriendRequest(uid); if (r.text) await say(uid, ThreadType.User, r.text); log('🤝 kết bạn', name); } catch (e) { log('kết bạn', e.message); }
}

/* ---------------------------------------------------------------- đăng nhập */
async function imageMeta(path) { const m = await sharp(path).metadata(); const { size } = await import('node:fs').then(f => f.promises.stat(path)); return { width: m.width, height: m.height, size }; }
async function login() {
  const zalo = new Zalo({ selfListen: true, logging: false, imageMetadataGetter: imageMeta });
  if (existsSync(CREDS)) {
    try { const a = await zalo.login(JSON.parse(readFileSync(CREDS, 'utf8'))); log('Đăng nhập bằng phiên đã lưu'); return a; }
    catch (e) { log('Phiên đăng nhập hết hạn:', e.message); }
  }
  await call('login', { reason: existsSync(CREDS) ? 'phiên hết hạn' : 'lần đầu' });
  log('👉 Mở file qr.png và quét bằng Zalo của điện thoại "Trợ lý An Lành" (Zalo → biểu tượng QR → Quét mã)');
  return zalo.loginQR({ qrPath: QR }, async ev => {
    if (ev.type === LoginQRCallbackEventType.QRCodeGenerated) { await ev.actions.saveToFile(QR); if (process.platform === 'darwin' && process.stdout.isTTY) execFile('open', [QR]); log('Mã QR đã lưu ở', QR); }
    if (ev.type === LoginQRCallbackEventType.QRCodeExpired) { log('Mã QR hết hạn, tạo mã mới'); ev.actions.retry(); }
    if (ev.type === LoginQRCallbackEventType.QRCodeScanned) log('Đã quét bởi', ev.data.display_name, '– bấm Đăng nhập trên điện thoại');
    if (ev.type === LoginQRCallbackEventType.GotLoginInfo) { writeFileSync(CREDS, JSON.stringify({ cookie: ev.data.cookie, imei: ev.data.imei, userAgent: ev.data.userAgent }), { mode: 0o600 }); try { unlinkSync(QR); } catch (e) { } log('✅ Đã lưu phiên đăng nhập'); }
  });
}

async function main() {
  api = await login();
  me = String(api.getOwnId());
  if (process.argv.includes('--dang-nhap')) { log('✅ Đăng nhập xong, đã lưu phiên. Giờ cài chạy nền (cai-dat.sh làm tiếp).'); process.exit(0); } // cai-dat.sh: chỉ đăng nhập lần đầu
  try { const p = (await api.fetchAccountInfo()).profile; myName = p.displayName || p.zaloName || 'Trợ lý An Lành'; } catch (e) { myName = 'Trợ lý An Lành'; }
  log('🤖 Đang chạy với tài khoản', myName, me);
  await refreshGroups();
  log('Nhóm:', groupList().map(g => g.name + (g.admin ? ' (phó nhóm)' : ' (chưa là phó nhóm)')).join(' · ') || 'chưa ở nhóm nào');
  const L = api.listener;
  L.on('message', m => onMessage(m).catch(e => log('tin', e.message)));
  L.on('group_event', ev => { try { onGroupEvent(ev); } catch (e) { log('nhóm', e.message); } });
  L.on('friend_event', ev => onFriend(ev).catch(e => log('bạn', e.message)));
  L.on('reaction', r => { try { onReaction(r); } catch (e) { log('cảm xúc', e.message); } });
  L.on('connected', () => log('🟢 Đã kết nối Zalo'));
  L.on('closed', async (code, reason) => { log('🔴 Mất kết nối Zalo', code, reason); if (code === 3000) log('Tài khoản đang mở ở máy khác (Zalo PC/web) – đóng bớt rồi chạy lại.'); await call('login', { reason: 'mất kết nối ' + code + ' ' + (reason || '') }); process.exit(1); }); // launchd / pm2 tự bật lại
  L.on('error', e => log('lỗi kết nối', e && e.message));
  L.start({ retryOnClose: true });
  await poll().catch(e => log('poll', e.message));
  setInterval(() => poll().catch(e => log('poll', e.message)), 45e3);
  setInterval(refreshGroups, 30 * 60e3);
}
main().catch(async e => { log('Lỗi khởi động', e && e.message); await call('login', { reason: String(e && e.message).slice(0, 100) }); await sleep(60e3); process.exit(1); });
