// Nối với Google qua Apps Script ("cầu nối"): lấy mã truy cập Google Sheets, gửi email. Telegram gọi thẳng.
// Cầu nối không cần mật khẩu chung: mỗi lần gọi kèm 1 mã dùng 1 lần, Apps Script hỏi lại máy chủ này để xác nhận.
import { kvGet, kvSet, kvDel, kvJson, randHex } from './lib.js';

export async function bridge(env, op, data) {
  if (env.MOCK_GOOGLE) { const f = await fetch(env.MOCK_GOOGLE + '/bridge-' + op + '.json'); return f.ok ? f.json() : { ok: true }; } // chạy thử trên máy
  if (!env.BRIDGE_URL) throw new Error('Chưa cấu hình cầu nối Google (BRIDGE_URL).');
  const nonce = randHex(16);
  await kvSet(env.DB, 'bn_' + nonce, op, 180e3);
  let r;
  try { r = await fetch(env.BRIDGE_URL, { method: 'POST', headers: { 'Content-Type': 'text/plain;charset=utf-8' }, body: JSON.stringify(Object.assign({ type: 'bridge', op, nonce }, data || {})), redirect: 'follow' }); }
  finally { await kvDel(env.DB, 'bn_' + nonce); }
  const t = await r.text();
  let j; try { j = JSON.parse(t); } catch (e) { throw new Error('Cầu nối Google trả lời lỗi (' + r.status + ', url=' + r.url + '): ' + t.slice(0, 300)); }
  if (!j.ok) throw new Error(j.error || 'Cầu nối Google báo lỗi');
  return j;
}

/** Thông tin từ Apps Script: mã truy cập (1 giờ), id file Sheet chính, email tài khoản Google, Telegram. */
export async function gInfo(env, fresh) {
  if (!fresh) { const c = await kvJson(env.DB, 'g_info', null); if (c && c.exp > Date.now()) return c; }
  const j = await bridge(env, 'token');
  const info = { token: j.token, sheetId: j.sheetId, account: j.account, tg: j.tg || '', chats: j.chats || '', notify: j.notify || '', exp: Date.now() + 45 * 60e3 };
  await kvSet(env.DB, 'g_info', JSON.stringify(info));
  return info;
}
export async function tgConf(env) {
  if (env.TELEGRAM_TOKEN) return { token: env.TELEGRAM_TOKEN, chats: env.TELEGRAM_CHAT_IDS || '', notify: env.NOTIFY_EMAIL || '' };
  let c = await kvJson(env.DB, 'g_info', null);
  if (!c || !c.tg) { try { c = await gInfo(env, true); } catch (e) { return { token: '', chats: '', notify: '' }; } }
  return { token: c.tg, chats: c.chats, notify: c.notify };
}

/* ---------- Google Sheets API */
function a1(name, range) { return "'" + String(name).replace(/'/g, "''") + "'" + (range ? '!' + range : ''); }
export { a1 };
async function gFetch(env, url, opt, retry) {
  if (env.MOCK_GOOGLE) return mockFetch(env, url, opt);
  const info = await gInfo(env, retry);
  const r = await fetch(url, Object.assign({}, opt, { headers: Object.assign({ Authorization: 'Bearer ' + info.token, 'Content-Type': 'application/json' }, (opt || {}).headers || {}) }));
  if (r.status === 401 && !retry) return gFetch(env, url, opt, true);
  const t = await r.text(); let j = {}; try { j = JSON.parse(t); } catch (e) { }
  if (!r.ok) {
    const msg = (j.error && j.error.message) || t.slice(0, 200);
    if (/has not been used|is disabled|SERVICE_DISABLED/i.test(msg)) throw new Error('Cần bật Google Sheets API trong Apps Script: mở Apps Script → mục Dịch vụ (+) → Google Sheets API → Thêm, rồi Lưu.');
    if (r.status === 403 || r.status === 404) throw new Error('CRM chưa mở được file này. Chủ file cần chia sẻ quyền xem (hoặc sửa) cho tài khoản ' + (info.account || 'chạy Apps Script') + '.');
    throw new Error('Google báo lỗi: ' + msg);
  }
  return j;
}
const SHEETS = 'https://sheets.googleapis.com/v4/spreadsheets/';
export async function sheetMeta(env, id) { return gFetch(env, SHEETS + id + '?fields=properties.title,sheets.properties(title,sheetId,gridProperties)'); }
/** Đọc 1 vùng. render: 'FORMATTED_VALUE' (chữ như hiện trên Sheet) hoặc 'UNFORMATTED_VALUE' (số, ngày = số sê-ri). */
export async function sheetValues(env, id, range, render) {
  const q = 'valueRenderOption=' + (render || 'UNFORMATTED_VALUE') + '&dateTimeRenderOption=SERIAL_NUMBER';
  const j = await gFetch(env, SHEETS + id + '/values/' + encodeURIComponent(range) + '?' + q);
  return j.values || [];
}
export async function sheetBatchGet(env, id, ranges, render) {
  const q = ranges.map(r => 'ranges=' + encodeURIComponent(r)).join('&') + '&valueRenderOption=' + (render || 'UNFORMATTED_VALUE') + '&dateTimeRenderOption=SERIAL_NUMBER';
  const j = await gFetch(env, SHEETS + id + '/values:batchGet?' + q);
  return (j.valueRanges || []).map(v => v.values || []);
}
export async function sheetWrite(env, id, data) { // data: [{range, values}]
  if (!data.length) return;
  return gFetch(env, SHEETS + id + '/values:batchUpdate', { method: 'POST', body: JSON.stringify({ valueInputOption: 'RAW', data }) });
}
export async function sheetClear(env, id, ranges) { return gFetch(env, SHEETS + id + '/values:batchClear', { method: 'POST', body: JSON.stringify({ ranges }) }); }
export async function sheetAddTabs(env, id, titles) {
  if (!titles.length) return;
  return gFetch(env, SHEETS + id + ':batchUpdate', { method: 'POST', body: JSON.stringify({ requests: titles.map(t => ({ addSheet: { properties: { title: t } } })) }) });
}
/** Số sê-ri ngày của Google Sheets (giờ VN) ↔ mili giây. */
export function serialToMs(v) { return Math.round((Number(v) - 25569) * 864e5 - 7 * 3600e3); }
export function msToSerial(t) { return (Number(t) + 7 * 3600e3) / 864e5 + 25569; }

/* ---------- chạy thử trên máy: đọc dữ liệu Sheet giả từ MOCK_GOOGLE (thư mục phục vụ file JSON) */
async function mockFetch(env, url, opt) {
  const m = url.match(/spreadsheets\/([^/?:]+)(.*)$/), id = m[1], rest = m[2];
  const f = await fetch(env.MOCK_GOOGLE + '/' + id + '.json'); if (!f.ok) throw new Error('CRM chưa mở được file này (mock).');
  const book = await f.json();
  if (/^\?fields/.test(rest)) return { properties: { title: book.title }, sheets: Object.keys(book.sheets).map(t => ({ properties: { title: t, gridProperties: { rowCount: book.sheets[t].length } } })) };
  const pick = (range, render) => {
    const mm = decodeURIComponent(range).match(/^'((?:[^']|'')*)'(?:!([A-Z]+)(\d+)?(?::([A-Z]+)(\d+)?)?)?$/), name = mm[1].replace(/''/g, "'");
    let rows = book.sheets[name] || [];
    const col = s => s ? s.split('').reduce((a, c) => a * 26 + c.charCodeAt(0) - 64, 0) : 0;
    const r1 = +(mm[3] || 1), c1 = col(mm[2]) || 1, c2 = col(mm[4]) || 999, r2 = mm[5] ? +mm[5] : 1e9;
    rows = rows.slice(r1 - 1, r2).map(r => r.slice(c1 - 1, c2).map(v => v && v.$d ? (render === 'FORMATTED_VALUE' ? fmtMock(v.$d) : (new Date(v.$d).getTime() + 7 * 3600e3) / 864e5 + 25569) : (render === 'FORMATTED_VALUE' && v != null ? String(v) : v)));
    while (rows.length && !rows[rows.length - 1].some(v => v !== '' && v != null)) rows.pop();
    return rows.map(r => { r = r.slice(); while (r.length && (r[r.length - 1] === '' || r[r.length - 1] == null)) r.pop(); return r; });
  };
  const render = (rest.match(/valueRenderOption=([A-Z_]+)/) || [])[1];
  if (/values:batchGet/.test(rest)) return { valueRanges: [...rest.matchAll(/ranges=([^&]+)/g)].map(x => ({ values: pick(x[1], render) })) };
  if (/\/values\//.test(rest)) return { values: pick(rest.match(/\/values\/([^?]+)/)[1], render) };
  if (/values:batchUpdate|values:batchClear|:batchUpdate/.test(rest)) { (env.__mockWrites = env.__mockWrites || []).push({ url, body: opt && opt.body }); return {}; }
  throw new Error('mock: ' + rest);
}
function fmtMock(d) { const t = new Date(new Date(d).getTime() + 7 * 3600e3), p = n => (n < 10 ? '0' : '') + n; return p(t.getUTCDate()) + '/' + p(t.getUTCMonth() + 1) + '/' + t.getUTCFullYear(); }

/* ---------- email (qua Apps Script, tài khoản Google gửi) */
export async function sendMail(env, msg) {
  if (env.MOCK_GOOGLE) { console.log('MAIL', JSON.stringify(msg)); await kvSet(env.DB, 'mock_mail_' + Date.now(), JSON.stringify(msg), 3600e3); return; }
  await bridge(env, 'mail', { mail: msg });
}

/* ---------- Telegram */
export async function telegramTo(env, chatId, text) {
  const c = await tgConf(env); if (!c.token || !chatId) return;
  if (env.MOCK_GOOGLE) { console.log('TG', chatId, text.slice(0, 80)); return; }
  try { await fetch('https://api.telegram.org/bot' + c.token + '/sendMessage', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ chat_id: String(chatId), text, parse_mode: 'HTML', disable_web_page_preview: true }) }); } catch (e) { }
}
export async function telegram(env, text) { const c = await tgConf(env); for (const id of String(c.chats || '').split(',').map(s => s.trim()).filter(Boolean)) await telegramTo(env, id, text); }
export async function tgUpdates(env) {
  const c = await tgConf(env); if (!c.token) return { ok: false, description: 'Chưa cấu hình Telegram' };
  const r = await fetch('https://api.telegram.org/bot' + c.token + '/getUpdates?allowed_updates=' + encodeURIComponent('["message"]'));
  return r.json();
}
