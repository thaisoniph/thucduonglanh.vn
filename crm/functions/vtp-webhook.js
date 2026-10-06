// crm.thucduonglanh.vn/vtp-webhook: cổng nhận tin báo trạng thái đơn của Viettel Post (webhook).
// Viettel Post cần trả lời "200" ngay, mà Apps Script luôn trả "302" → cổng này chuyển tiếp tin sang Apps Script rồi trả 200.
// Mã bí mật (TOKEN trong tin) do Apps Script kiểm tra (Thuộc tính tập lệnh VTP_SECRET), không ghi ở đây.
// Link Apps Script lấy từ crm-data.js (build.py ghi từ data/config.json), không ghi cứng.
async function endpoint(request, env) {
  const t = await (await env.ASSETS.fetch(new URL('/crm-data.js', request.url))).text();
  return (t.match(/"endpoint":\s*"([^"]+)"/) || [])[1];
}

export async function onRequestPost({ request, env }) {
  const body = await request.text();
  let res = { ok: false };
  try {
    const url = await endpoint(request, env);
    const r = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'text/plain;charset=utf-8' }, body: JSON.stringify({ type: 'vtp', payload: body }), redirect: 'follow' });
    res = JSON.parse(await r.text());
  } catch (e) { res = { ok: false, error: String(e) }; }
  return Response.json({ status: 200, error: !res.ok, message: res.ok ? 'OK' : String(res.error || 'Lỗi') }, { status: res.denied ? 401 : 200 });
}

export function onRequestGet() {
  return Response.json({ status: 200, error: false, message: 'Cổng nhận trạng thái đơn Viettel Post' });
}
