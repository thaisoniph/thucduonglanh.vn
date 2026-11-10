/* Trạm chuyển tiếp gọi AI (26/10/2026). Máy chủ api thường chạy ở trạm Cloudflare Hồng Kông (cf-placement: local-HKG) – Anthropic
 * không nhận yêu cầu từ khu vực này (lỗi 403 "Request not allowed"). Durable Object AiRelay được đặt cố định ở Tây Bắc Mỹ (locationHint 'wnam'),
 * chỉ chuyển tiếp lời gọi api.anthropic.com; phần còn lại của máy chủ không đổi. Dùng chung cho ✨ AI CRM (ai.js), trợ lý chat web (chat.js),
 * trợ lý Zalo (zbot.js), Fanpage (fb.js), hỏi trợ lý (ask.js).
 * 10/11/2026: mọi lời gọi AI đi qua đây → khi Anthropic báo HẾT TIỀN / khoá sai thì báo Telegram 1 lần (6 tiếng), chạy lại thì báo ✅.
 * (09/11 tài khoản hết tiền cả ngày: bài Zalo tối 09/11 + sáng 10/11 không được soạn, chỉ CRM ghi lỗi nhỏ, không ai biết.) */
import { kvGet, kvSet, kvDel } from './lib.js';
import { telegram } from './google.js';
import { aiLog } from './aiuse.js';

export class AiRelay {
  constructor(state, env) { }
  async fetch(req) {
    const url = new URL(req.url);
    if (url.hostname !== 'api.anthropic.com') return new Response('forbidden', { status: 403 }); // chỉ chuyển tiếp tới Anthropic
    return fetch(req);
  }
}

const ALERT_KEY = 'ai_alert', ALERT_TTL = 6 * 3600e3;
let alerted = false; // trong 1 phiên máy chủ: đã báo lỗi → lần gọi thành công tiếp theo báo "chạy lại"

/** Nhận ra lỗi cần người xử lý (không phải lỗi tạm): hết tiền (400 credit balance), khoá sai / bị khoá (401, 403 permission). Trả về lời nhắn hoặc ''. */
function fatalMsg(status, body) {
  const t = String(body || '');
  if (status === 400 && /credit balance/i.test(t)) return '💳 <b>Tài khoản Anthropic (AI) đã hết tiền.</b>\nTrợ lý Zalo không soạn bài / trả lời, chat An Lành trên web và ✨ AI trong CRM đều dừng cho tới khi nạp.\n👉 Anh Sơn vào console.anthropic.com → Plans & Billing nạp thêm (nên bật tự nạp). Nạp xong, bài Zalo / Fanpage tới giờ sẽ được soạn lại trong 10 phút; bài đã lỡ giờ không đăng bù.';
  if (status === 401 || (status === 403 && /permission|invalid|key/i.test(t))) return '🔑 <b>Khoá AI (ANTHROPIC_API_KEY) không đúng hoặc đã bị khoá</b> (lỗi ' + status + ').\n👉 Anh Sơn tạo khoá mới ở console.anthropic.com → API Keys, rồi dán vào Cloudflare Workers → thucduonglanh-api → Settings → Variables and Secrets.';
  return '';
}

/** Xem kết quả Anthropic trả về: lỗi nặng → báo Telegram (1 lần / 6 tiếng); thành công sau khi đã báo → báo chạy lại. Không bao giờ làm hỏng lời gọi AI. */
async function watch(env, res) {
  try {
    if (!env.DB) return;
    if (res.ok) {
      if (!alerted) return;
      alerted = false;
      if (await kvGet(env.DB, ALERT_KEY)) { await kvDel(env.DB, ALERT_KEY); await telegram(env, '✅ <b>AI đã chạy lại bình thường</b> (trợ lý Zalo, chat web, AI trong CRM).'); }
      return;
    }
    if (![400, 401, 403].includes(res.status)) return;
    const msg = fatalMsg(res.status, await res.clone().text().catch(() => ''));
    if (!msg) return;
    alerted = true;
    if (await kvGet(env.DB, ALERT_KEY)) return; // đã báo trong 6 tiếng qua
    await kvSet(env.DB, ALERT_KEY, String(Date.now()), ALERT_TTL);
    await telegram(env, '⚠️ <b>AI của Thực Dưỡng Lành đang lỗi</b>\n' + msg);
  } catch (e) { console.error('aiWatch', e && e.message); }
}

/** Đọc model + usage từ kết quả /v1/messages (không stream) → ghi bảng ai_usage. Lỗi đọc thì bỏ qua, không ảnh hưởng lời gọi. */
async function count(env, url, res, muc) {
  try {
    if (!res.ok || !/\/v1\/messages(\?|$)/.test(String(url))) return;
    const j = await res.clone().json();
    if (j && j.usage) await aiLog(env.DB, muc, j.model, j.usage);
  } catch (e) { }
}

/** fetch cho thư viện Anthropic: đi qua AiRelay nếu có (không có → fetch thường). Bỏ signal vì không gửi được qua Durable Object.
 * Header riêng x-tdl-muc (mục dùng AI: chat / zalo / zalo-bai / fanpage / fb-bai / crm / hoi / huongdan) được bóc ra để đếm chi phí, không gửi sang Anthropic. */
export function aiFetch(env) {
  const stub = env.AI_RELAY ? env.AI_RELAY.get(env.AI_RELAY.idFromName('anthropic'), { locationHint: 'wnam' }) : null;
  return async (url, init) => {
    const i = init || {}, h = new Headers(i.headers || {}), muc = h.get('x-tdl-muc') || 'khac'; h.delete('x-tdl-muc');
    const res = stub ? await stub.fetch(new Request(String(url), { method: i.method || 'GET', headers: h, body: i.body })) : await fetch(url, Object.assign({}, i, { headers: h }));
    await watch(env, res);
    await count(env, url, res, muc);
    return res;
  };
}
