// 📊 Hỏi số quảng cáo qua Telegram, CHỈ ĐỌC (18/11/2026, giai đoạn 3 của anh Sơn).
// Bot ✅ Việc tuần ("Lành", giaoviec.js – bot có webhook; bot báo đơn @thucduonglanh_donhang_bot không được bật webhook) nhận lệnh /so:
//   /so                → tóm tắt hôm qua + 7 ngày (không tốn AI)
//   /so <câu hỏi>      → AI mô hình rẻ (Haiku) trả lời CHỈ từ bảng số đã tính sẵn (kv mk_snap)
// Ai hỏi được: Quản trị, Quản lý, Marketing (đã nối bot Việc tuần). Chỉ trả lời trong chat riêng (hỏi trong nhóm → nhắn riêng).
// Không đọc D1 lúc trả lời: bảng số mk_snap do lịch chạy (cron.js) dựng 1 tiếng / lần, 7h–22h. Không có tên / SĐT khách, không có lệnh ghi.
import Anthropic from '@anthropic-ai/sdk';
import { aiFetch } from './airelay.js';
import { all, kvGet, kvSet, kvJson, normPhone, fmtDate, esc, DAY } from './lib.js';
import { mkCampReal } from './mkcamp.js';
import { mkSchList, SCH_ST } from './mksch.js';

const MODEL = 'claude-haiku-5-5';
const ASK_DAY = 30, ASK_ALL = 200; // câu hỏi AI / người / ngày, cả công ty / ngày
const iso = t => fmtDate(t, 'yyyy-MM-dd');
const vnd = n => Math.round(Number(n) || 0).toLocaleString('vi-VN') + 'đ';
export const mkSoOk = u => !!u && (u.level >= 2 || u.role === 'Marketing');

/** Dựng bảng số (cron, 1 tiếng / lần ban ngày). Chỉ con số tổng, tên chiến dịch; không tên / SĐT khách. kv mk_snap. */
export async function mkSnapBuild(x) {
  const now = Date.now(), d0 = Math.floor((now + 7 * 3600e3) / DAY) * DAY - 7 * 3600e3, from = iso(d0 - 13 * DAY), to = iso(d0);
  const [sp, rows, dash] = await Promise.all([
    all(x.db, 'SELECT day, channel, SUM(spend) AS s, SUM(msgs) AS m, SUM(leads) AS l FROM ad_spend WHERE day BETWEEN ? AND ? GROUP BY day, channel', from, to),
    kvJson(x.db, 'ads_rows', []), kvJson(x.db, 'dash_cfg', {})]);
  const D = {}; for (let i = 13; i >= 0; i--) D[iso(d0 - i * DAY)] = { ngay: iso(d0 - i * DAY), chi_facebook: 0, chi_moi_kenh: 0, tin_nhan_meta: 0, lead_meta: 0, sdt_that: 0 };
  sp.forEach(r => { const o = D[r.day]; if (!o) return; o.chi_moi_kenh += Math.round(r.s || 0); if (r.channel === 'Facebook') { o.chi_facebook += Math.round(r.s || 0); o.tin_nhan_meta += r.m || 0; o.lead_meta += r.l || 0; } });
  const seen = {}; (rows || []).forEach(a => { const k = iso(Number(a[0]) || 0), p = normPhone(a[1]); if (!D[k] || !p || seen[k + p]) return; seen[k + p] = 1; D[k].sdt_that++; });
  Object.values(D).forEach(o => { o.gia_1_sdt_that = o.sdt_that ? Math.round(o.chi_facebook / o.sdt_that) : null; o.gia_1_tin_nhan = o.tin_nhan_meta ? Math.round(o.chi_facebook / o.tin_nhan_meta) : null; });
  const cr = await mkCampReal(x, iso(d0 - 6 * DAY), to).catch(() => null);
  const camps = ((cr && cr.rows) || []).map(r => ({ chien_dich: r[0], chi: r[2], meta_bao: r[3], sdt_that: r[4], ty_le_sdt_that_phan_tram: r[3] ? Math.round(r[4] * 100 / r[3]) : null, ra_don: r[5], doanh_thu_tu_sdt_nay: r[6],
    gia_1_sdt_that: r[4] ? Math.round(r[2] / r[4]) : null, gia_1_don_that: r[5] ? Math.round(r[2] / r[5]) : null }));
  const sch = await mkSchList(x).catch(() => null), K = (dash && dash.kpi) || {};
  const snap = { lap_luc: fmtDate(now, 'HH:mm dd/MM/yyyy'), at: now, hom_nay: to, theo_ngay_14_ngay: Object.values(D),
    chien_dich_7_ngay: { tu: iso(d0 - 6 * DAY), den: to, rows: camps, chua_ro_chien_dich: cr ? { sdt_that: cr.none[0], ra_don: cr.none[1] } : null, tong_sdt: cr ? cr.n : 0 },
    lenh_cho_0h: sch ? sch.rows.filter(r => r[11] === 'wait' || r[11] === 'approve').map(r => ({ chien_dich: r[1], viec: r[4] === 'budget' ? 'ngân sách ' + vnd(r[5]) + ' → ' + vnd(r[6]) : r[4] === 'pause' ? 'tắt' : 'bật lại', trang_thai: SCH_ST[r[11]], ap_luc: fmtDate(r[10], 'HH:mm dd/MM') })) : [],
    muc_tot: { gia_1_tin_nhan_duoi: K.msg || 100000, gia_1_sdt_duoi: K.sdt || 175000, gia_1_sdt_tran: K.sdtMax || 270000, ty_le_sdt_that_toi_thieu_phan_tram: K.yx || 30 } };
  await kvSet(x.db, 'mk_snap', JSON.stringify(snap));
  return snap;
}

/** Tóm tắt không tốn AI: hôm qua + 7 ngày + chiến dịch cảnh báo + lệnh chờ 0h. */
function plain(S) {
  const D = S.theo_ngay_14_ngay, y = D[D.length - 2] || {}, w = D.slice(-8, -1), sum = k => w.reduce((a, o) => a + (o[k] || 0), 0);
  const fb7 = sum('chi_facebook'), p7 = sum('sdt_that'), m7 = sum('tin_nhan_meta'), M = S.muc_tot;
  const bad = (S.chien_dich_7_ngay.rows || []).filter(r => r.meta_bao >= 10 && r.ty_le_sdt_that_phan_tram !== null && r.ty_le_sdt_that_phan_tram < M.ty_le_sdt_that_toi_thieu_phan_tram);
  return '📊 <b>Số quảng cáo</b> (tính lúc ' + S.lap_luc + ')\n\n' +
    '<b>Hôm qua ' + y.ngay.slice(8, 10) + '/' + y.ngay.slice(5, 7) + '</b>\n• Chi Facebook: ' + vnd(y.chi_facebook) + '\n• Meta báo: ' + y.tin_nhan_meta + ' tin nhắn, ' + y.lead_meta + ' lead\n• SĐT thật về file: ' + y.sdt_that +
    (y.gia_1_sdt_that ? ' · <b>' + vnd(y.gia_1_sdt_that) + ' / 1 SĐT thật</b>' : '') + '\n\n' +
    '<b>7 ngày qua</b>\n• Chi Facebook: ' + vnd(fb7) + '\n• ' + m7 + ' tin nhắn → ' + p7 + ' SĐT thật' + (p7 ? ' · ' + vnd(fb7 / p7) + ' / 1 SĐT (tốt dưới ' + vnd(M.gia_1_sdt_duoi) + ')' : '') +
    (bad.length ? '\n\n⚠️ <b>Meta báo nhiều, SĐT thật ít</b>: ' + bad.map(r => esc(r.chien_dich) + ' (' + r.ty_le_sdt_that_phan_tram + '%)').join('; ') : '') +
    (S.lenh_cho_0h.length ? '\n\n🕛 <b>' + S.lenh_cho_0h.length + ' lệnh chờ 0h</b>: ' + S.lenh_cho_0h.map(r => r.viec + ' – ' + esc(r.chien_dich) + ' (' + r.trang_thai + ')').join('; ') : '') +
    '\n\nHỏi thêm: <i>/so tuần này chiến dịch nào giá 1 SĐT thật rẻ nhất?</i>';
}

/** 🚨 Phát báo 8h (27/11/2026, anh Sơn "làm phần báo miễn phí"): giá 1 SĐT thật vượt trần → tin Telegram, KHÔNG gọi AI. null = không có gì vượt, không gửi. */
export function mkPhatAlert(S, now = Date.now()) {
  if (!S || now - (S.at || 0) > 3 * 3600e3) return null; // bảng số cũ quá 3 tiếng → không báo theo số cũ
  const T = S.muc_tot.gia_1_sdt_tran, D = S.theo_ngay_14_ngay, y = D[D.length - 2] || {}, out = [];
  const over = (chi, n) => chi >= T && (!n || chi / n > T);
  if (over(y.chi_facebook || 0, y.sdt_that)) out.push('<b>Hôm qua ' + y.ngay.slice(8, 10) + '/' + y.ngay.slice(5, 7) + '</b>: chi ' + vnd(y.chi_facebook) + ' → ' + y.sdt_that + ' SĐT thật' + (y.sdt_that ? ' = <b>' + vnd(y.gia_1_sdt_that) + ' / 1 SĐT</b>' : ''));
  // shortcut: bỏ chiến dịch Shopee / Tương tác / Lượt bấm theo tên (không nhằm lấy số); đổi cách đặt tên thì sửa NOSDT
  const NOSDT = /shopee|tuong tac|luot bam/, nm = t => String(t || '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/đ/g, 'd');
  const R = (S.chien_dich_7_ngay.rows || []).filter(r => !NOSDT.test(nm(r.chien_dich))), mapped = R.some(r => r.sdt_that > 0);
  const bad = mapped ? R.filter(r => over(r.chi || 0, r.sdt_that)).sort((a, b) => b.chi - a.chi) : []; // chưa gắn được SĐT nào theo chiến dịch → không liệt kê (tránh báo nhầm mọi chiến dịch 0 số)
  if (out.length && !mapped && R.length) out.push('<i>Chưa biết chiến dịch nào đắt: SĐT thật chưa gắn được theo chiến dịch (CRM tab Marketing → 🎯 Số thật theo chiến dịch).</i>');
  if (bad.length) out.push('<b>Chiến dịch 7 ngày vượt trần</b>:\n' + bad.slice(0, 5).map(r => '• ' + esc(r.chien_dich) + ': chi ' + vnd(r.chi) + ', ' + (r.sdt_that ? r.sdt_that + ' SĐT = ' + vnd(r.gia_1_sdt_that) + ' / số' : 'chưa có SĐT thật')).join('\n') + (bad.length > 5 ? '\n• … và ' + (bad.length - 5) + ' chiến dịch khác' : ''));
  if (!out.length) return null;
  return '🚨 <b>Phát báo: giá 1 SĐT vượt trần ' + vnd(T) + '</b>\n\n' + out.join('\n\n') +
    '\n\n👉 Nên giảm tiền hoặc tắt các chiến dịch trên: vào CRM tab Marketing, hẹn lệnh lúc 0h để Facebook không phải học lại giữa ngày.\n<i>Số tính lúc ' + S.lap_luc + '. Hỏi thêm: /so</i>';
}

let client = null;
function ai(env) { if (!client) client = new Anthropic({ apiKey: env.ANTHROPIC_API_KEY, maxRetries: 1, timeout: 25e3, fetch: aiFetch(env), defaultHeaders: { 'x-tdl-muc': 'tg-so' } }); return client; }

/** Trả lời 1 câu hỏi (u đã kiểm quyền). q rỗng → tóm tắt. Chỉ đọc kv. → chữ HTML Telegram. */
export async function mkSoAnswer(x, u, q) {
  const S = await kvJson(x.db, 'mk_snap', null);
  if (!S) return 'Chưa có bảng số. Máy tính 1 tiếng 1 lần từ 7h–22h, chờ chút rồi hỏi lại nhé.';
  q = String(q || '').replace(/\s+/g, ' ').trim().slice(0, 400);
  if (!q) return plain(S);
  if (!x.env.ANTHROPIC_API_KEY) return plain(S) + '\n\n(Chưa bật AI nên em gửi bản tóm tắt.)';
  const day = fmtDate(Date.now(), 'yyMMdd'), ku = 'mkso_' + day + '_' + u.email, ka = 'mkso_' + day;
  const nu = Number(await kvGet(x.db, ku) || 0), na = Number(await kvGet(x.db, ka) || 0);
  if (nu >= ASK_DAY || na >= ASK_ALL) return plain(S) + '\n\n(Hôm nay đã hỏi nhiều, em gửi bản tóm tắt. Mai hỏi tiếp nhé.)';
  await kvSet(x.db, ku, String(nu + 1), 2 * DAY); await kvSet(x.db, ka, String(na + 1), 2 * DAY);
  const sys = 'Bạn là trợ lý số liệu quảng cáo của Thực Dưỡng Lành. Chỉ trả lời dựa trên bảng số JSON được cho, không đoán, không bịa. ' +
    'Bảng không có số cần hỏi thì nói rõ "bảng số chưa có" và gợi ý xem CRM tab Marketing. Hôm nay là ' + S.hom_nay + '; "hôm qua" là ngày ngay trước đó trong theo_ngay_14_ngay. ' +
    'SĐT thật = số điện thoại thật về file số quảng cáo; Meta báo = tin nhắn/lead Facebook ghi nhận. Tiền viết dạng 1.234.000đ. Trả lời tiếng Việt, ngắn (tối đa 8 dòng), đọc trên điện thoại, không bảng, không markdown, có thể dùng <b> </b>. ' +
    'Không có quyền sửa gì: nếu được nhờ tắt / tăng / sửa quảng cáo thì nói vào CRM tab Marketing để hẹn lệnh 0h.';
  try {
    const r = await ai(x.env).messages.create({ model: MODEL, max_tokens: 600, system: sys, messages: [{ role: 'user', content: 'Bảng số (JSON):\n' + JSON.stringify(S) + '\n\nCâu hỏi: ' + q }] });
    const t = (r.content || []).filter(b => b.type === 'text').map(b => b.text).join('').trim();
    return (t ? t.replace(/&/g, '&amp;').replace(/<(?!\/?b>)/g, '&lt;') : plain(S)) + '\n\n<i>Số tính lúc ' + S.lap_luc + '</i>';
  } catch (e) { console.error('mkSo ai', e.message); return plain(S) + '\n\n(AI đang lỗi, em gửi bản tóm tắt.)'; }
}
