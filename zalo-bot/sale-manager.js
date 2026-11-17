/* 👀 Giữ Zalo của nhiều sale – CHỈ ĐỌC tin nhắn riêng với khách, gửi về máy chủ (15/11/2026)
 * Cài 1 lần lên VPS (bash zalo-bot/cai-zalo-sale.sh). Về sau mọi việc bấm trong CRM → 👀 Zalo của sale:
 *   ➕ Kết nối 1 sale → chương trình này hiện mã QR → mã hiện trong CRM → sale quét bằng Zalo → xong. Ngắt cũng bấm trong CRM.
 * KHÔNG gửi tin, không thả tim, không đụng nhóm. Sale vẫn dùng Zalo điện thoại + Zalo PC như cũ (bản này ở chỗ "Zalo Web").
 * Máy chủ: api/src/zsale.js. Khoá dùng lại ZBOT_KEY của trợ lý An Lành. Phiên đăng nhập từng sale lưu ở creds/<sale>.json. */
import { Zalo, ThreadType, LoginQRCallbackEventType } from 'zca-js';
import { readFileSync, writeFileSync, existsSync, mkdirSync, unlinkSync, readdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const VER = '2026-11-17a';
const DIR = dirname(fileURLToPath(import.meta.url)), CREDS = join(DIR, 'creds');
for (const l of (existsSync(join(DIR, '.env')) ? readFileSync(join(DIR, '.env'), 'utf8') : '').split('\n')) { const m = l.match(/^\s*([A-Z_]+)\s*=\s*(.*)\s*$/); if (m && !process.env[m[1]]) process.env[m[1]] = m[2]; }
const API = process.env.API_URL || 'https://api.thucduonglanh.vn/', KEY = process.env.ZSALE_KEY || process.env.ZBOT_KEY;
if (!KEY) { console.error('Thiếu ZSALE_KEY (hoặc ZBOT_KEY) trong .env'); process.exit(1); }
if (!existsSync(CREDS)) mkdirSync(CREDS, { recursive: true });

const log = (...a) => console.log(new Date().toLocaleString('vi-VN', { timeZone: 'Asia/Ho_Chi_Minh' }), ...a);
const sleep = ms => new Promise(r => setTimeout(r, ms));
const credFile = sale => join(CREDS, sale + '.json');
async function call(ev, data) {
  for (let i = 0; i < 3; i++) {
    try {
      const r = await fetch(API, { method: 'POST', headers: { 'Content-Type': 'text/plain;charset=utf-8' }, body: JSON.stringify(Object.assign({ type: 'zsale', key: KEY, ev, ver: VER }, data)), signal: AbortSignal.timeout(60e3) });
      const j = await r.json(); if (j.error === 'key') log('⚠️ Máy chủ không nhận khoá'); return j;
    } catch (e) { log('api', ev, e.message); await sleep(2000 * (i + 1)); }
  }
  return {};
}

/* mỗi sale 1 "chỗ ngồi": { api, me, name, phone, pairing } */
const SEAT = {};

/** Nghe tin nhắn riêng (1–1) của 1 sale với khách. Chỉ chữ, chỉ đọc. */
function listen(sale) {
  const seat = SEAT[sale]; if (!seat || !seat.api) return;
  const api = seat.api, me = seat.me;
  const PHONE = new Map(); let lastLookup = 0;
  async function phoneOf(uid) {
    if (PHONE.has(uid)) return PHONE.get(uid);
    if (Date.now() - lastLookup < 4000) return '';
    lastLookup = Date.now();
    try { // 17/11: changed_profiles có khoá dạng "<uid>_0" chứ không phải "<uid>" → trước đây không bao giờ đọc ra số (0/11 tin khớp khách)
      const r = await api.getUserInfo(uid), cp = (r && r.changed_profiles) || {}, info = cp[uid] || cp[uid + '_0'] || Object.values(cp)[0];
      if (info) { const ph = String(info.phoneNumber || info.phone_number || '').replace(/^\+?84/, '0').replace(/\D/g, ''); PHONE.set(uid, ph); if (!ph) log('[' + sale + '] Zalo không cho xem số của', uid, '(sale bấm 📇 Gắn số khách trong CRM)'); return ph; } }
    catch (e) { log('[' + sale + '] đọc số lỗi', e.message); }
    return '';
  }
  const L = api.listener;
  L.on('message', m => (async () => {
    if (m.type !== ThreadType.User) return; // bỏ qua nhóm
    const d = m.data, text = typeof d.content === 'string' ? d.content.trim() : '';
    if (!text) return;
    const self = m.isSelf ? 1 : 0, uid = String(self ? m.threadId : d.uidFrom || m.threadId);
    const phone = await phoneOf(uid);
    await call('msg', { sale, uid, zname: self ? '' : (d.dName || ''), phone, self, text, msgId: String(d.msgId || ''), ts: Number(d.ts) || Date.now() });
  })().catch(e => log('[' + sale + '] tin', e.message)));
  L.on('connected', () => log('🟢 [' + sale + '] đã kết nối'));
  L.on('closed', async (code, reason) => { log('🔴 [' + sale + '] mất kết nối', code, reason); delete SEAT[sale]; await call('gone', { sale, name: seat.name, reason: 'closed ' + code }); });
  L.on('error', e => log('[' + sale + '] lỗi', e && e.message));
  L.start({ retryOnClose: true });
}

/** Đăng nhập 1 sale bằng phiên đã lưu (im lặng). Thành công → nghe tin. */
async function loginSaved(sale) {
  if (SEAT[sale]) return true;
  const f = credFile(sale); if (!existsSync(f)) return false;
  try {
    const zalo = new Zalo({ selfListen: true, logging: false });
    const api = await zalo.login(JSON.parse(readFileSync(f, 'utf8')));
    const me = String(api.getOwnId()); let name = sale, phone = '';
    try { const p = (await api.fetchAccountInfo()).profile; name = p.displayName || p.zaloName || sale; phone = String(p.phoneNumber || '').replace(/^\+?84/, '0').replace(/\D/g, ''); } catch (e) { }
    SEAT[sale] = { api, me, name, phone };
    listen(sale);
    log('👀 [' + sale + '] đang đọc Zalo của', name, '(chỉ đọc)');
    return true;
  } catch (e) { log('[' + sale + '] phiên cũ hỏng:', e.message); try { unlinkSync(f); } catch (e2) { } return false; }
}

/** Kết nối 1 sale mới: tạo mã QR, gửi về máy chủ cho CRM hiện; sale quét xong thì lưu phiên + nghe tin. */
async function pair(sale, name) {
  if (SEAT[sale] || (SEAT['pair:' + sale])) return;
  SEAT['pair:' + sale] = 1; // đang chờ quét, khỏi mở 2 lần
  log('➕ [' + sale + '] mở mã QR cho', name);
  try {
    const zalo = new Zalo({ selfListen: true, logging: false });
    const qrPng = join(CREDS, 'qr.' + sale + '.png');
    const api = await zalo.loginQR({ qrPath: qrPng }, async ev => {
      if (ev.type === LoginQRCallbackEventType.QRCodeGenerated) {
        let b64 = ev.data && ev.data.image; // 1 số bản để ảnh ngay trong sự kiện
        if (!b64) { try { if (ev.actions && ev.actions.saveToFile) await ev.actions.saveToFile(qrPng); } catch (e) { } }
        try { if (!b64 && existsSync(qrPng)) b64 = readFileSync(qrPng).toString('base64'); } catch (e) { }
        if (b64) await call('qr', { sale, name, img: 'data:image/png;base64,' + b64 }); // ảnh mã QR → CRM hiện
      }
      if (ev.type === LoginQRCallbackEventType.QRCodeExpired) ev.actions.retry();
      if (ev.type === LoginQRCallbackEventType.GotLoginInfo) { writeFileSync(credFile(sale), JSON.stringify({ cookie: ev.data.cookie, imei: ev.data.imei, userAgent: ev.data.userAgent }), { mode: 0o600 }); try { unlinkSync(qrPng); } catch (e) { } }
    });
    const me = String(api.getOwnId()); let nm = name, phone = '';
    try { const p = (await api.fetchAccountInfo()).profile; nm = p.displayName || p.zaloName || name; phone = String(p.phoneNumber || '').replace(/^\+?84/, '0').replace(/\D/g, ''); } catch (e) { }
    delete SEAT['pair:' + sale];
    SEAT[sale] = { api, me, name: nm, phone };
    listen(sale);
    await call('connected', { sale, name: nm, phone, uid: me });
    log('✅ [' + sale + '] đã kết nối', nm);
  } catch (e) { delete SEAT['pair:' + sale]; log('[' + sale + '] kết nối lỗi:', e.message); await call('login', { sale, name }); }
}

/** Ngắt 1 sale: dừng nghe, xoá phiên. */
async function drop(sale) {
  const seat = SEAT[sale]; if (seat && seat.api) { try { seat.api.listener.stop(); } catch (e) { } }
  delete SEAT[sale]; delete SEAT['pair:' + sale];
  try { unlinkSync(credFile(sale)); } catch (e) { }
  await call('gone', { sale, reason: 'logout' });
  log('⏹ [' + sale + '] đã ngắt');
}

async function poll() {
  const sales = Object.keys(SEAT).filter(k => !k.startsWith('pair:')).map(sale => ({ sale, name: SEAT[sale].name, phone: SEAT[sale].phone, uid: SEAT[sale].me }));
  const r = await call('poll', { sales });
  for (const w of (r.want || [])) { if (!SEAT[w.sale] && !SEAT['pair:' + w.sale]) { if (!(await loginSaved(w.sale))) pair(w.sale, w.name); } } // có phiên cũ thì vào thẳng, chưa có thì mở QR
  for (const sale of (r.stop || [])) if (SEAT[sale]) drop(sale);
}

async function main() {
  log('👀 Chương trình giữ Zalo của sale đang chạy (chỉ đọc). Kết nối từng sale trong CRM → 👀 Zalo của sale.');
  for (const f of readdirSync(CREDS)) if (f.endsWith('.json')) await loginSaved(f.slice(0, -5)); // bật lại các sale đã kết nối
  await poll().catch(e => log('poll', e.message));
  setInterval(() => poll().catch(e => log('poll', e.message)), 20e3);
}
main().catch(async e => { log('Lỗi khởi động', e && e.message); await sleep(60e3); process.exit(1); });
