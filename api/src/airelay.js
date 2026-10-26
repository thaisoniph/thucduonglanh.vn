/* Trạm chuyển tiếp gọi AI (26/10/2026). Máy chủ api thường chạy ở trạm Cloudflare Hồng Kông (cf-placement: local-HKG) – Anthropic
 * không nhận yêu cầu từ khu vực này (lỗi 403 "Request not allowed"). Durable Object AiRelay được đặt cố định ở Tây Bắc Mỹ (locationHint 'wnam'),
 * chỉ chuyển tiếp lời gọi api.anthropic.com; phần còn lại của máy chủ không đổi. Dùng chung cho ✨ AI CRM (ai.js) và trợ lý chat web (chat.js). */
export class AiRelay {
  constructor(state, env) { }
  async fetch(req) {
    const url = new URL(req.url);
    if (url.hostname !== 'api.anthropic.com') return new Response('forbidden', { status: 403 }); // chỉ chuyển tiếp tới Anthropic
    return fetch(req);
  }
}

/** fetch cho thư viện Anthropic: đi qua AiRelay nếu có (không có → fetch thường). Bỏ signal vì không gửi được qua Durable Object. */
export function aiFetch(env) {
  if (!env.AI_RELAY) return undefined;
  const stub = env.AI_RELAY.get(env.AI_RELAY.idFromName('anthropic'), { locationHint: 'wnam' });
  return async (url, init) => {
    const i = init || {};
    return stub.fetch(new Request(String(url), { method: i.method || 'GET', headers: i.headers, body: i.body }));
  };
}
