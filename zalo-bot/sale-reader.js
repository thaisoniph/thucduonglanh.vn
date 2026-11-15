/* 👀 Người đọc Zalo của sale – giữ tài khoản Zalo của 1 sale, CHỈ ĐỌC tin nhắn riêng với khách rồi gửi về máy chủ (15/11/2026)
 * KHÁC với bot.js (Trợ lý An Lành): chương trình này KHÔNG bao giờ gửi tin, không thả tim, không đụng nhóm. Chỉ nghe tin
 *   nhắn riêng (1–1) giữa sale và khách → hỏi máy chủ api.thucduonglanh.vn (api/src/zsale.js) lưu lại để Quản lý xem.
 * Vì chỉ đọc nên ít rủi ro Zalo khoá hơn trợ lý. Đăng nhập bằng mã QR như Zalo PC (anh Sơn đã thử: điện thoại + Zalo PC +
 *   Zalo Web chạy song song được, nên sale không phải đổi thói quen – chương trình này ngồi ở chỗ "Zalo Web").
 * Mỗi sale = 1 bản chạy riêng, có .env riêng (SALE_ID, SALE_NAME) và creds.json riêng. Cài: cai-sale.sh. Bí mật nằm ở máy
 *   (không đưa lên GitHub): .env (ZSALE_KEY giống secret của Worker), creds.json (phiên đăng nhập Zalo của sale). */
import { Zalo, ThreadType, LoginQRCallbackEventType } from 'zca-js';
import { readFileSync, writeFileSync, existsSync, mkdirSync, unlinkSync } from 'node:fs';
import { execFile } from 'node:child_process';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const VER = '2026-11-15a';
const DIR = dirname(fileURLToPath(import.meta.url));
for (const l of (existsSync(join(DIR, '.env')) ? readFileSync(join(DIR, '.env'), 'utf8') : '').split('\n')) { const m = l.match(/^\s*([A-Z_]+)\s*=\s*(.*)\s*$/); if (m && !process.env[m[1]]) process.env[m[1]] = m[2]; }
const API = process.env.API_URL || 'https://api.thucduonglanh.vn/', KEY = process.env.ZSALE_KEY;
const SALE = (process.env.SALE_ID || '').trim(), SALE_NAME = (process.env.SALE_NAME || SALE).trim();
if (!KEY) { console.error('Thiếu ZSALE_KEY trong .env'); process.exit(1); }
if (!SALE) { console.error('Thiếu SALE_ID trong .env (mã ngắn của sale, vd thuy)'); process.exit(1); }
const CREDS = join(DIR, 'creds.' + SALE + '.json'), QR = join(DIR, 'qr.' + SALE + '.png');

const log = (...a) => console.log(new Date().toLocaleString('vi-VN', { timeZone: 'Asia/Ho_Chi_Minh' }), '[' + SALE + ']', ...a);
const sleep = ms => new Promise(r => setTimeout(r, ms));
async function call(ev, data) {
  for (let i = 0; i < 3; i++) {
    try {
      const r = await fetch(API, { method: 'POST', headers: { 'Content-Type': 'text/plain;charset=utf-8' }, body: JSON.stringify(Object.assign({ type: 'zsale', key: KEY, ev, sale: SALE, name: SALE_NAME }, data)), signal: AbortSignal.timeout(60e3) });
      const j = await r.json(); if (j.error === 'key') log('⚠️ Máy chủ không nhận ZSALE_KEY'); return j;
    } catch (e) { log('api', ev, e.message); await sleep(3000 * (i + 1)); }
  }
  return {};
}

let api = null, me = '', myName = '', myPhone = '', CFG = { on: true };
/* nhớ số điện thoại theo uid (khách là bạn Zalo → tra 1 lần, giữ lại). Giới hạn tần suất tra để Zalo không nghi ngờ. */
const PHONE = new Map(); let lastLookup = 0;
async function phoneOf(uid) {
  if (PHONE.has(uid)) return PHONE.get(uid);
  if (Date.now() - lastLookup < 4000) return ''; // tra thưa (tối đa ~1 lần / 4 giây), lần sau có tin lại tra
  lastLookup = Date.now();
  try {
    const r = await api.getUserInfo(uid), info = r && r.changed_profiles && r.changed_profiles[uid];
    const ph = String((info && (info.phoneNumber || info.phone_number)) || '').replace(/^\+?84/, '0').replace(/\D/g, '');
    if (info) { PHONE.set(uid, ph); return ph; } // lưu cả khi rỗng (khách ẩn số) để khỏi tra lại
  } catch (e) { log('tra số', e.message); }
  return '';
}

async function onMessage(m) {
  if (m.type !== ThreadType.User) return; // chỉ tin nhắn riêng (bỏ qua nhóm)
  const d = m.data, text = typeof d.content === 'string' ? d.content.trim() : '';
  if (!text) return; // tạm bỏ qua ảnh / sticker (chỉ lưu chữ)
  if (!CFG.on) return;
  const self = m.isSelf ? 1 : 0; // self = 1: do chính sale gửi (kể cả nhắn từ điện thoại / Zalo PC)
  const uid = String(self ? m.threadId : d.uidFrom || m.threadId);
  const phone = await phoneOf(uid);
  await call('msg', { uid, zname: self ? '' : (d.dName || ''), phone, self, text, msgId: String(d.msgId || ''), ts: Number(d.ts) || Date.now() });
}

async function login() {
  const zalo = new Zalo({ selfListen: true, logging: false }); // selfListen: nghe cả tin sale tự gửi
  if (existsSync(CREDS)) {
    try { const a = await zalo.login(JSON.parse(readFileSync(CREDS, 'utf8'))); log('Đăng nhập bằng phiên đã lưu'); return a; }
    catch (e) { log('Phiên đăng nhập hết hạn:', e.message); }
  }
  await call('login', { reason: existsSync(CREDS) ? 'phiên hết hạn' : 'lần đầu' });
  log('👉 Mở file', QR, 'và quét bằng Zalo của sale này (Zalo → biểu tượng QR → Quét mã → Đăng nhập)');
  return zalo.loginQR({ qrPath: QR }, async ev => {
    if (ev.type === LoginQRCallbackEventType.QRCodeGenerated) { await ev.actions.saveToFile(QR); if (process.platform === 'darwin' && process.stdout.isTTY) execFile('open', [QR]); log('Mã QR đã lưu ở', QR); }
    if (ev.type === LoginQRCallbackEventType.QRCodeExpired) { log('Mã QR hết hạn, tạo mã mới'); ev.actions.retry(); }
    if (ev.type === LoginQRCallbackEventType.QRCodeScanned) log('Đã quét bởi', ev.data.display_name, '– bấm Đăng nhập trên điện thoại');
    if (ev.type === LoginQRCallbackEventType.GotLoginInfo) { writeFileSync(CREDS, JSON.stringify({ cookie: ev.data.cookie, imei: ev.data.imei, userAgent: ev.data.userAgent }), { mode: 0o600 }); try { unlinkSync(QR); } catch (e) { } log('✅ Đã lưu phiên đăng nhập'); }
  });
}

async function poll() {
  const r = await call('poll', { me: { uid: me, name: myName, phone: myPhone }, ver: VER });
  if (r.cfg) CFG = r.cfg;
}

async function main() {
  api = await login();
  me = String(api.getOwnId());
  if (process.argv.includes('--dang-nhap')) { log('✅ Đăng nhập xong, đã lưu phiên.'); process.exit(0); }
  try { const p = (await api.fetchAccountInfo()).profile; myName = p.displayName || p.zaloName || SALE_NAME; myPhone = String(p.phoneNumber || '').replace(/^\+?84/, '0').replace(/\D/g, ''); } catch (e) { myName = SALE_NAME; }
  log('👀 Đang đọc Zalo của', myName, me, '(chỉ đọc, không gửi)');
  const L = api.listener;
  L.on('message', m => onMessage(m).catch(e => log('tin', e.message)));
  L.on('connected', () => log('🟢 Đã kết nối Zalo'));
  L.on('closed', async (code, reason) => { log('🔴 Mất kết nối Zalo', code, reason); if (code === 3000) log('Tài khoản đang mở ở máy khác – đóng bớt rồi chạy lại.'); await call('login', { reason: 'mất kết nối ' + code + ' ' + (reason || '') }); process.exit(1); }); // systemd tự bật lại
  L.on('error', e => log('lỗi kết nối', e && e.message));
  L.start({ retryOnClose: true });
  await poll().catch(e => log('poll', e.message));
  setInterval(() => poll().catch(e => log('poll', e.message)), 60e3);
}
main().catch(async e => { log('Lỗi khởi động', e && e.message); await call('login', { reason: String(e && e.message).slice(0, 100) }); await sleep(60e3); process.exit(1); });
