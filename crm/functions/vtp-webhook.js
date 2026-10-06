// crm.thucduonglanh.vn/vtp-webhook: cổng nhận tin báo trạng thái đơn của Viettel Post (webhook).
// Viettel Post cần trả lời "200" ngay, mà Apps Script luôn trả "302" và chậm → cổng này trả 200 rồi chuyển tin sang Apps Script.
// Mã bí mật (TOKEN trong tin) do Apps Script kiểm tra (Thuộc tính tập lệnh VTP_SECRET), không ghi ở đây.
// Link Apps Script lấy từ crm-data.js (build.py ghi từ data/config.json), không ghi cứng.
async function endpoint(request, env) {
  const t = await (await env.ASSETS.fetch(new URL('/crm-data.js', request.url))).text();
  return (t.match(/"endpoint":\s*"([^"]+)"/) || [])[1];
}

// Viettel Post chỉ chờ vài giây, Apps Script mất ~5–6 giây → trả lời 200 ngay, chuyển tin sang Apps Script chạy nền (waitUntil).
// Kết quả xử lý (sai mã bí mật, không tìm thấy đơn…) xem ở Apps Script → Lần thực thi.
export async function onRequestPost({ request, env, waitUntil }) {
  const body = await request.text();
  waitUntil((async () => {
    try {
      const url = await endpoint(request, env);
      const r = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'text/plain;charset=utf-8' }, body: JSON.stringify({ type: 'vtp', payload: body }), redirect: 'follow' });
      console.log('vtp', (await r.text()).slice(0, 300));
    } catch (e) { console.error('vtp', String(e)); }
  })());
  return Response.json({ status: 200, error: false, message: 'OK' });
}

export function onRequestGet() {
  return Response.json({ status: 200, error: false, message: 'Cổng nhận trạng thái đơn Viettel Post' });
}
