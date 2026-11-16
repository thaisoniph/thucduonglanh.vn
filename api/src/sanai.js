/* ================================================================ 🛒 Trợ lý sàn Shopee (16/11/2026, anh Sơn: Thủy phụ trách Shopee đang dùng skill Claude rời rạc trên máy
 * để mỗi ngày đánh giá shop và đầu tuần xem đối thủ cùng ngách → gom hết vào tab Sàn của CRM).
 *   🩺 Sức khoẻ shop (mỗi sáng): CRM tự tính số Shopee 7 ngày gần nhất so 7 ngày trước từ bảng san_orders (file đơn hàng / Google Sheet báo cáo)
 *      + file thêm người phụ trách tải (quảng cáo Shopee, phân tích bán hàng… đọc trên trình duyệt, gửi lên dạng bảng chữ)
 *      → AI (Sonnet) đánh giá theo "Cách đánh giá" người phụ trách dán từ skill của mình → tối đa 3 việc cần làm hôm nay.
 *      Vòng học: bấm ✅ Đã làm → sau 7 ngày CRM so doanh số / số đơn 7 ngày trước và sau ngày làm, lần chấm sau AI đọc kết quả đó để rút kinh nghiệm.
 *   🔍 Đối thủ đầu tuần: chụp màn hình trang tìm kiếm / trang shop đối thủ trên Shopee (hoặc dán chữ) → AI (Opus, đọc ảnh) rút giá, đã bán, sao, khuyến mãi
 *      → bảng so với tuần trước + giá bán của mình (từ đơn Shopee 30 ngày) → phương án. Không tự vào Shopee lấy số (Shopee chặn máy tự động).
 * Bảng D1 san_ai (tự tạo, không cần SCHEMA_V). kv san_ai_cfg = cách đánh giá + từ khoá + shop đối thủ. Mục chi phí AI: san.
 * Lệnh: san_ai_view, san_ai_cfg, san_ai_shop, san_ai_dt, san_ai_act, san_ai_del (đi qua crmSan ở san.js, quyền sanAllowed). */
import Anthropic from '@anthropic-ai/sdk';
import { aiFetch } from './airelay.js';
import { all, first, run, kvGet, kvSet, kvJson, randHex, fmtDate, DAY } from './lib.js';
import { sanDaySchema, crmShp } from './sanshp.js';

const M_SHOP = 'claude-sonnet-5-5', M_DT = 'claude-opus-5-5'; // anh Sơn 13/11: Sonnet việc hằng ngày, Opus việc nghĩ sâu (đối thủ 1 lần / tuần)
const DAY_MAX = { shop: 20, dt: 10 };
const cut = (s, n) => String(s == null ? '' : s).trim().slice(0, n);
const vnDay = t => fmtDate(t, 'yyyy-MM-dd');
const addDay = (d, k) => vnDay(new Date(d + 'T12:00:00+07:00').getTime() + k * DAY);
const textOf = res => res.content.filter(b => b.type === 'text').map(b => b.text).join('\n').trim();
const LAW = 'Thực Dưỡng Lành bán thực phẩm dinh dưỡng, trà thảo mộc, thực phẩm bổ sung. Khi gợi ý câu chữ cho trang sản phẩm / quảng cáo: không dùng "chữa", "điều trị", "khỏi bệnh", "thần dược"; thực phẩm bổ sung phải có câu "không phải là thuốc, không có tác dụng thay thế thuốc chữa bệnh".';
export const DEF_SHOP = [
  'Đánh giá như một người vận hành shop Shopee giỏi, nói thẳng, dễ hiểu cho người mới.',
  '1. Doanh số, số đơn, giá trị đơn trung bình: tăng hay giảm so với 7 ngày trước, vì sao (sản phẩm nào kéo lên / kéo xuống).',
  '2. Tỷ lệ huỷ, hoàn: cao hơn 5% là cần xem lý do (hết hàng, giao chậm, mô tả sai, khách đặt nhầm).',
  '3. Tiền thực về so với doanh số: phí sàn, voucher, quảng cáo đang ăn bao nhiêu %.',
  '4. Quảng cáo Shopee (nếu có file): chi phí / doanh thu quảng cáo (ACOS), từ khoá tốn tiền mà không ra đơn → tắt, từ khoá ra đơn rẻ → tăng giá thầu.',
  '5. Lượt xem, tỷ lệ chuyển đổi từng sản phẩm (nếu có file): nhiều lượt xem ít đơn → sửa ảnh bìa, giá, tiêu đề, đánh giá; ít lượt xem → quảng cáo, flash sale, tham gia chương trình.',
  '6. Tiến độ mục tiêu tháng: còn thiếu bao nhiêu, mỗi ngày cần bán bao nhiêu.',
  'Cuối cùng chọn ĐÚNG tối đa 3 việc làm được ngay hôm nay, ảnh hưởng nhiều nhất tới doanh số.'
].join('\n');
export const DEF_DT = [
  'Đọc trang tìm kiếm / trang shop đối thủ trên Shopee như người nghiên cứu thị trường.',
  'Với mỗi sản phẩm đối thủ: tên shop, tên sản phẩm (rút gọn), giá bán, đã bán (số hiện trên Shopee, vd "1,2k"), số sao, khuyến mãi / quà / freeship / mall.',
  'So với tuần trước: ai giảm giá, ai bán tăng mạnh, sản phẩm mới xuất hiện.',
  'So với giá của Thực Dưỡng Lành: mình đang đắt hay rẻ hơn, điểm mạnh / yếu so với họ.',
  'Đưa ra tối đa 3 phương án cho tuần này (giá, combo, quà tặng, voucher, ảnh bìa, quảng cáo từ khoá). Không khuyên phá giá dưới mức có lãi.'
].join('\n');

let client = null;
const ai = env => client || (client = new Anthropic({ apiKey: env.ANTHROPIC_API_KEY, maxRetries: 1, timeout: 120e3, fetch: aiFetch(env), defaultHeaders: { 'x-tdl-muc': 'san' } }));

let schemaOk = false;
async function schema(db) {
  if (schemaOk) return;
  await run(db, "CREATE TABLE IF NOT EXISTS san_ai (id TEXT PRIMARY KEY, kind TEXT, day TEXT, j TEXT DEFAULT '{}', m TEXT DEFAULT '{}', acts TEXT DEFAULT '[]', by_name TEXT DEFAULT '', at INTEGER)");
  await run(db, 'CREATE INDEX IF NOT EXISTS san_ai_kind ON san_ai(kind, at)');
  // 📥 sản phẩm đối thủ lấy bằng nút "Gửi về CRM" trên trang Shopee: 1 dòng / sản phẩm / ngày; id = shopid.itemid (không đổi khi đối thủ đổi tên)
  await run(db, "CREATE TABLE IF NOT EXISTS san_dti (day TEXT, id TEXT, kw TEXT DEFAULT '', name TEXT DEFAULT '', price INTEGER, price_max INTEGER, sold INTEGER, sold_txt TEXT DEFAULT '', tags TEXT DEFAULT '', PRIMARY KEY (day, id))");
  await run(db, 'CREATE INDEX IF NOT EXISTS san_dti_id ON san_dti(id, day)');
  await sanDaySchema(db);
  schemaOk = true;
}
async function cfgOf(x) { return Object.assign({ shop: '', dt: '', kw: '', rivals: '' }, await kvJson(x.db, 'san_ai_cfg', {}) || {}); }

/** Số Shopee 1 khoảng ngày: tổng + từng sản phẩm. */
async function win(x, from, to) {
  const r = await first(x.db, "SELECT SUM(CASE WHEN state = 'ok' THEN gmv - refund ELSE 0 END) AS g, SUM(state = 'ok') AS n, SUM(state = 'cancel') AS c, SUM(state = 'return') AS r, COUNT(*) AS t, " +
    "SUM(CASE WHEN state = 'ok' AND net IS NOT NULL THEN net ELSE 0 END) AS nv, SUM(CASE WHEN state = 'ok' AND net IS NOT NULL THEN gmv - refund ELSE 0 END) AS gn FROM san_orders WHERE shop = 'Shopee' AND day BETWEEN ? AND ?", from, to) || {};
  const P = {};
  for (const o of await all(x.db, "SELECT items FROM san_orders WHERE shop = 'Shopee' AND state = 'ok' AND day BETWEEN ? AND ? LIMIT 20000", from, to)) {
    let a = []; try { a = JSON.parse(o.items || '[]'); } catch (e) { }
    a.forEach(i => { const p = P[i[0]] || (P[i[0]] = [i[0], 0, 0]); p[1] += Number(i[1]) || 0; p[2] += Number(i[2]) || 0; });
  }
  return { g: r.g || 0, n: r.n || 0, c: r.c || 0, r: r.r || 0, t: r.t || 0, netPct: r.gn ? Math.round((r.nv || 0) * 1000 / r.gn) / 10 : null, P };
}
const k = v => Math.round((v || 0) / 1000) + 'k';
const pct = (a, b) => b ? (a >= b ? '+' : '') + Math.round((a - b) * 100 / b) + '%' : 'mới';

/** 7 ngày gần nhất có số (kết thúc ở ngày mới nhất có đơn, không quá hôm qua nếu hôm nay chưa đủ ngày) so 7 ngày trước + mục tiêu tháng. */
async function shopMetrics(x) {
  const lastR = await first(x.db, "SELECT MAX(day) AS d FROM san_orders WHERE shop = 'Shopee' AND day <= ?", vnDay(Date.now()));
  const end = lastR && lastR.d; if (!end) return null;
  const a0 = addDay(end, -6), b1 = addDay(end, -7), b0 = addDay(end, -13);
  const [A, B, days] = await Promise.all([win(x, a0, end), win(x, b0, b1),
    all(x.db, "SELECT day, SUM(CASE WHEN state = 'ok' THEN gmv - refund ELSE 0 END) AS g, SUM(state = 'ok') AS n, SUM(state IN ('cancel', 'return')) AS v FROM san_orders WHERE shop = 'Shopee' AND day BETWEEN ? AND ? GROUP BY day ORDER BY day", b0, end)]);
  const month = end.slice(0, 7), tg = ((await kvJson(x.db, 'san_targets', {}) || {})[month] || {}).Shopee || 0;
  const mon = await first(x.db, "SELECT SUM(CASE WHEN state = 'ok' THEN gmv - refund ELSE 0 END) AS g FROM san_orders WHERE shop = 'Shopee' AND day BETWEEN ? AND ?", month + '-01', month + '-31');
  const dim = new Date(Date.UTC(+month.slice(0, 4), +month.slice(5, 7), 0)).getUTCDate(), left = dim - +end.slice(8, 10);
  const prods = Object.values(A.P).sort((p, q) => q[2] - p[2]).slice(0, 15).map(p => { const o = B.P[p[0]]; return { sp: p[0], sl: p[1], dt: p[2], gia: p[1] ? Math.round(p[2] / p[1]) : 0, sl0: o ? o[1] : 0, dt0: o ? o[2] : 0 }; });
  const gone = Object.values(B.P).filter(p => !A.P[p[0]] && p[2] > 0).sort((p, q) => q[2] - p[2]).slice(0, 5).map(p => ({ sp: p[0], sl0: p[1], dt0: p[2] }));
  const strip = w => ({ g: w.g, n: w.n, c: w.c, r: w.r, t: w.t, netPct: w.netPct, aov: w.n ? Math.round(w.g / w.n) : 0, huy: w.t ? Math.round((w.c + w.r) * 1000 / w.t) / 10 : 0 });
  await sanDaySchema(x.db);
  const so = await all(x.db, 'SELECT day, ads, ads_gmv, vid, live, aff FROM san_day WHERE day BETWEEN ? AND ? ORDER BY day', b0, end), be = await breakEven(x);
  return { so, be, end, a0, b0, b1, A: strip(A), B: strip(B), days: days.map(r => [r.day, r.g || 0, r.n || 0, r.v || 0]), prods, gone, goal: { month, tg, cur: mon && mon.g || 0, left } };
}
function metricsText(M) {
  const L = [
    `Kỳ này ${M.a0} → ${M.end} so kỳ trước ${M.b0} → ${M.b1} (Shopee).`,
    `Doanh số (đã trừ huỷ / hoàn): ${k(M.A.g)} so ${k(M.B.g)} (${pct(M.A.g, M.B.g)}). Số đơn thành công: ${M.A.n} so ${M.B.n}. Giá trị đơn trung bình: ${k(M.A.aov)} so ${k(M.B.aov)}.`,
    `Tỷ lệ huỷ + hoàn: ${M.A.huy}% (${M.A.c} huỷ, ${M.A.r} hoàn / ${M.A.t} đơn) so ${M.B.huy}%.`,
    M.A.netPct != null ? `Tiền thực về / doanh số (đơn đã có số tiền về): ${M.A.netPct}%${M.B.netPct != null ? ' so ' + M.B.netPct + '%' : ''}.` : 'Chưa có số tiền thực về kỳ này.',
    M.goal.tg ? `Mục tiêu Shopee tháng ${M.goal.month}: ${k(M.goal.tg)}, đã đạt ${k(M.goal.cur)} (${Math.round(M.goal.cur * 100 / M.goal.tg)}%), còn ${M.goal.left} ngày → mỗi ngày cần ${k(Math.max(0, M.goal.tg - M.goal.cur) / Math.max(1, M.goal.left))}.` : `Tháng ${M.goal.month} chưa đặt mục tiêu Shopee, đã đạt ${k(M.goal.cur)}.`,
    'Theo ngày (ngày · doanh số · đơn · huỷ/hoàn): ' + M.days.map(d => d[0].slice(5) + ' ' + k(d[1]) + ' ' + d[2] + 'đ ' + d[3] + 'h').join(' | '),
    'Sản phẩm kỳ này (tên · SL · doanh số · giá TB · kỳ trước SL / doanh số):', ...M.prods.map(p => `- ${p.sp} · ${p.sl} · ${k(p.dt)} · ${k(p.gia)} · trước ${p.sl0} / ${k(p.dt0)}`),
    M.so && M.so.length ? 'Sổ theo dõi ngày (ngày · chi phí QC · doanh thu QC · ROI · đơn video / live / affiliate): ' + M.so.map(r => r.day.slice(5) + ' ' + (r.ads != null ? k(r.ads) : '?') + ' ' + (r.ads_gmv != null ? k(r.ads_gmv) : '?') + ' ' + (r.ads ? 'ROI ' + Math.round(r.ads_gmv / r.ads * 10) / 10 : '') + ' ' + [r.vid, r.live, r.aff].map(v => v == null ? '?' : v).join('/')).join(' | ') : 'Chưa ghi sổ theo dõi ngày (chi phí quảng cáo).',
    M.be ? `ROI hoà vốn ≈ ${M.be.roi} (tiền về ${Math.round(M.be.fee * 100)}% doanh số, giá vốn ${Math.round(M.be.cogs * 100)}%): ROI quảng cáo thấp hơn mức này là đang lỗ.` : 'Chưa tính được ROI hoà vốn (Quản trị chưa nhập giá vốn).',
    M.gone.length ? 'Kỳ trước có bán, kỳ này không ra đơn: ' + M.gone.map(p => p.sp + ' (' + p.sl0 + ' · ' + k(p.dt0) + ')').join('; ') : ''
  ];
  return L.filter(Boolean).join('\n');
}
/** Doanh số / số đơn trung bình 1 ngày, 7 ngày trước và 7 ngày sau ngày bấm Đã làm (đủ 7 ngày mới có kết quả). */
async function actResult(x, day) {
  const after = addDay(day, 7); if (after > vnDay(Date.now() - DAY)) return null;
  const q = (f, t) => first(x.db, "SELECT SUM(CASE WHEN state = 'ok' THEN gmv - refund ELSE 0 END) AS g, SUM(state = 'ok') AS n FROM san_orders WHERE shop = 'Shopee' AND day BETWEEN ? AND ?", f, t);
  const [b, a] = await Promise.all([q(addDay(day, -7), addDay(day, -1)), q(addDay(day, 1), after)]);
  return { g0: Math.round((b && b.g || 0) / 7), n0: Math.round((b && b.n || 0) / 7 * 10) / 10, g1: Math.round((a && a.g || 0) / 7), n1: Math.round((a && a.n || 0) / 7 * 10) / 10 };
}
async function learnText(x) {
  const rows = await all(x.db, "SELECT day, acts FROM san_ai WHERE kind = 'shop' AND at > ? ORDER BY at DESC LIMIT 40", Date.now() - 60 * DAY), L = [];
  for (const r of rows) { let A = []; try { A = JSON.parse(r.acts || '[]'); } catch (e) { } for (const a of A) if (a.done) { const res = await actResult(x, a.done.slice(0, 10)); L.push('- ' + a.done.slice(0, 10) + ' đã làm: ' + a.t + (res ? ` → doanh số TB/ngày ${k(res.g0)} → ${k(res.g1)}, đơn/ngày ${res.n0} → ${res.n1}` : ' → chưa đủ 7 ngày để đo') + (a.note ? ' · ghi chú: ' + a.note : '')); if (L.length >= 12) break; } if (L.length >= 12) break; }
  return L.join('\n');
}
async function ourPrices(x) {
  const P = {};
  for (const o of await all(x.db, "SELECT items FROM san_orders WHERE shop = 'Shopee' AND state = 'ok' AND day >= ? LIMIT 20000", vnDay(Date.now() - 30 * DAY))) { let a = []; try { a = JSON.parse(o.items || '[]'); } catch (e) { } a.forEach(i => { const p = P[i[0]] || (P[i[0]] = [i[0], 0, 0]); p[1] += Number(i[1]) || 0; p[2] += Number(i[2]) || 0; }); }
  return Object.values(P).filter(p => p[1]).sort((a, b) => b[2] - a[2]).slice(0, 15).map(p => `- ${p[0]}: giá bán TB ${k(p[2] / p[1])}, bán ${p[1]} trong 30 ngày`).join('\n');
}

/** ROI hoà vốn = doanh số ÷ (tiền về − giá vốn): quảng cáo tốn hơn phần lãi này là lỗ. fee = tiền về / doanh số Shopee 30 ngày; cogs = tỷ lệ giá vốn (Quản trị mở tab Sàn là CRM tự gửi, không gửi giá nhập). */
async function breakEven(x) {
  const C = await cfgOf(x), r = await first(x.db, "SELECT SUM(CASE WHEN state = 'ok' AND net IS NOT NULL THEN net ELSE 0 END) AS nv, SUM(CASE WHEN state = 'ok' AND net IS NOT NULL THEN gmv - refund ELSE 0 END) AS gn FROM san_orders WHERE shop = 'Shopee' AND day >= ?", vnDay(Date.now() - 30 * DAY));
  const fee = r && r.gn > 0 ? r.nv / r.gn : null, cogs = Number(C.cogs) || null;
  if (!fee || !cogs || fee - cogs <= 0.02) return null;
  return { roi: Math.round(10 / (fee - cogs)) / 10, fee: Math.round(fee * 1000) / 1000, cogs: Math.round(cogs * 1000) / 1000 };
}
/** 📒 sổ theo dõi ngày: 21 ngày gần nhất, doanh số / đơn từ đơn Shopee + số Thủy ghi (hoặc Shopee tự đổ về). */
async function dayBook(x) {
  await sanDaySchema(x.db);
  const from = vnDay(Date.now() - 20 * DAY), to = vnDay(Date.now());
  const [S, D] = await Promise.all([all(x.db, "SELECT day, SUM(CASE WHEN state = 'ok' THEN gmv - refund ELSE 0 END) AS g, SUM(state = 'ok') AS n FROM san_orders WHERE shop = 'Shopee' AND day BETWEEN ? AND ? GROUP BY day", from, to),
    all(x.db, 'SELECT * FROM san_day WHERE day BETWEEN ? AND ?', from, to)]);
  const by = {}; S.forEach(r => { by[r.day] = { day: r.day, g: r.g || 0, n: r.n || 0 }; }); D.forEach(r => { by[r.day] = Object.assign(by[r.day] || { day: r.day, g: 0, n: 0 }, { ads: r.ads, ads_gmv: r.ads_gmv, bal: r.bal, vid: r.vid, live: r.live, aff: r.aff, note: r.note, by: r.by_name, src: r.src }); });
  const rows = Object.values(by).sort((a, b) => a.day < b.day ? 1 : -1);
  const balR = await first(x.db, 'SELECT day, bal FROM san_day WHERE bal IS NOT NULL ORDER BY day DESC LIMIT 1'), sp = rows.filter(r => r.ads > 0).slice(0, 7), avg = sp.length ? sp.reduce((s, r) => s + r.ads, 0) / sp.length : 0;
  const bal = balR ? { v: balR.bal, day: balR.day, avg: Math.round(avg), left: avg ? Math.round(balR.bal / avg * 10) / 10 : null } : null;
  return { rows, bal, be: await breakEven(x) };
}
async function aiDay(x, u, d) {
  if (!/^\d{4}-\d\d-\d\d$/.test(String(d.day || ''))) return { ok: false, error: 'Ngày chưa đúng.' };
  const v = f => d[f] === '' || d[f] == null ? null : Math.max(0, Math.round(Number(d[f]) || 0));
  await sanDaySchema(x.db);
  await run(x.db, "INSERT INTO san_day (day, ads, ads_gmv, bal, vid, live, aff, note, by_name, at, src) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'tay') ON CONFLICT(day) DO UPDATE SET ads = excluded.ads, ads_gmv = excluded.ads_gmv, bal = excluded.bal, vid = excluded.vid, live = excluded.live, aff = excluded.aff, note = excluded.note, by_name = excluded.by_name, at = excluded.at",
    d.day, v('ads'), v('ads_gmv'), v('bal'), v('vid'), v('live'), v('aff'), cut(d.note, 300), u.name, Date.now());
  return { ok: true };
}

/* ---------- 📥 dữ liệu đối thủ từ nút "Gửi về CRM": mỗi sản phẩm = [id, chữ trên thẻ sản phẩm] → tên, giá, đã bán (máy tách, không cần AI) */
const toInt = s => Number(String(s).replace(/\./g, '').replace(/,/g, '')) || 0;
function soldNum(t) { const m = String(t).match(/([\d]+(?:[.,]\d+)?)\s*(k|tr|triệu)?/i); if (!m) return 0; const n = Number(m[1].replace(',', '.')); return Math.round(m[2] ? n * (/k/i.test(m[2]) ? 1e3 : 1e6) : n * (/\./.test(m[1]) && !/,/.test(m[1]) && m[1].split('.')[1].length === 3 ? 1000 : 1)); }
export function parseCard(t) {
  const s = String(t || '').replace(/₫\s*\|\s*/g, '₫').replace(/(\d)\s*\|\s*₫/g, '$1₫'), parts = s.split(/\s*\|\s*/).map(z => z.trim()).filter(Boolean);
  const prices = []; s.replace(/₫\s*([\d.]{4,})|([\d.]{4,})\s*₫/g, (_, a, b) => { const v = toInt(a || b); if (v >= 1000) prices.push(v); return ''; });
  const sm = s.match(/(?:Đã bán|đã bán|Sold)\s*([\d.,]+\s*(?:k|tr|triệu)?\+?)/i), sold_txt = sm ? sm[1].replace(/\s+/g, '') : '';
  const tags = parts.filter(z => /^(Mall|Yêu thích\+?|Yêu thích|Rẻ Vô Địch|Choice|Freeship|Hàng chính hãng|-\d+%|Giảm \S+|Mua kèm.*|Tài trợ|Ad)$/i.test(z)).join(', ');
  const isName = z => !/₫|^(?:Đã bán|đã bán|Sold)|^-?\d+%$|^\d(?:[.,]\d)?$/.test(z) && z.length >= 8, ip = parts.findIndex(z => /₫/.test(z)); // thẻ Shopee: nhãn → tên → giá → đã bán → nơi bán
  const pick = a => a.filter(isName).sort((x, y) => y.length - x.length)[0];
  const name = (ip > 0 && pick(parts.slice(0, ip))) || pick(parts.slice(0, -1)) || pick(parts) || '';
  return { name: name.slice(0, 200), price: prices.length ? Math.min(...prices) : null, price_max: prices.length > 1 ? Math.max(...prices) : null, sold: sold_txt ? soldNum(sold_txt) : null, sold_txt, tags: tags.slice(0, 120) };
}
const words = s => new Set(String(s || '').toLowerCase().normalize('NFC').split(/[^\p{L}\p{N}]+/u).filter(w => w.length > 1));
/** Lưu ảnh chụp hôm nay + so mỗi sản phẩm với lần lấy gần nhất cách ≥ 3 ngày. → rows để hiện + chữ cho AI. */
async function dtItems(x, pages) {
  const day = vnDay(Date.now()), seen = {}, items = [];
  for (const p of pages.slice(0, 20)) for (const it of (Array.isArray(p.i) ? p.i : []).slice(0, 120)) {
    const id = String(it[0] || '').replace(/[^\d.]/g, ''); if (!/^\d+\.\d+$/.test(id) || seen[id]) continue; seen[id] = 1;
    const c = parseCard(it[1]); if (!c.name) continue; items.push(Object.assign({ id, kw: cut(p.k, 80) }, c));
    if (items.length >= 400) break;
  }
  if (!items.length) return null;
  for (let i = 0; i < items.length; i += 40) { const B = items.slice(i, i + 40); await x.db.batch(B.map(r => x.db.prepare('INSERT OR REPLACE INTO san_dti (day, id, kw, name, price, price_max, sold, sold_txt, tags) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)').bind(day, r.id, r.kw, r.name, r.price, r.price_max, r.sold, r.sold_txt, r.tags))); }
  const prev = {}, lim = vnDay(Date.now() - 3 * DAY);
  for (let i = 0; i < items.length; i += 80) { const ids = items.slice(i, i + 80).map(r => r.id); (await all(x.db, `SELECT id, day, name, price, sold FROM san_dti WHERE day <= ? AND id IN (${ids.map(() => '?').join(',')}) ORDER BY day DESC`, lim, ...ids)).forEach(r => { if (!prev[r.id]) prev[r.id] = r; }); }
  const kk = v => v == null ? '?' : v >= 1e6 ? (Math.round(v / 1e5) / 10 + 'tr').replace('.', ',') : Math.round(v / 1000) + 'k';
  const rows = items.map(r => {
    const o = prev[r.id], ch = [];
    if (!o) ch.push('🆕 mới thấy');
    else {
      if (o.price && r.price && o.price !== r.price) ch.push((r.price < o.price ? '🔻 giảm giá ' : '🔺 tăng giá ') + kk(o.price) + ' → ' + kk(r.price));
      if (o.sold != null && r.sold != null && r.sold > o.sold) ch.push('📈 bán thêm ~' + (r.sold - o.sold).toLocaleString('vi-VN') + ' từ ' + o.day.slice(8) + '/' + o.day.slice(5, 7));
      if (o.name && o.name !== r.name) { const a = words(o.name), b = words(r.name), add = [...b].filter(w => !a.has(w)), rm = [...a].filter(w => !b.has(w)); if (add.length || rm.length) ch.push('✏️ đổi tên' + (add.length ? ' +' + add.slice(0, 6).join(' ') : '') + (rm.length ? ' −' + rm.slice(0, 6).join(' ') : '')); }
    }
    const [shop, item] = r.id.split('.');
    return { shop: '', sp: r.name, url: 'https://shopee.vn/product/' + shop + '/' + item, gia: r.price ? kk(r.price) + (r.price_max ? '–' + kk(r.price_max) : '') : '?', daban: r.sold_txt || '?', sao: '', km: r.tags, ghichu: ch.join(' · '), kw: r.kw, s: r.sold || 0, mine: /thực dưỡng lành|dilvang|vitagreen/i.test(r.name) ? 1 : 0, shopid: shop };
  }).sort((a, b) => b.s - a.s);
  const text = rows.slice(0, 80).map(r => '- [' + r.kw + '] ' + (r.mine ? '(SẢN PHẨM CỦA MÌNH) ' : '') + r.sp + ' · ' + r.gia + ' · đã bán ' + r.daban + (r.km ? ' · ' + r.km : '') + ' · shop ' + r.shopid + (r.ghichu ? ' · ' + r.ghichu : '')).join('\n');
  return { rows: rows.slice(0, 150), text, n: items.length, kws: [...new Set(items.map(r => r.kw))].slice(0, 10) };
}

async function callAi(x, model, effort, system, content, sch, maxTok) {
  const req = { model, max_tokens: maxTok, output_config: { effort, format: { type: 'json_schema', schema: sch } }, system, messages: [{ role: 'user', content }] };
  let res;
  try {
    try { res = await ai(x.env).beta.messages.create(Object.assign({ betas: ['server-side-fallback-2026-07-01'], fallbacks: 'default' }, req)); }
    catch (e) { if (!(e instanceof Anthropic.BadRequestError)) throw e; res = await ai(x.env).messages.create(req); }
  } catch (e) {
    if (e instanceof Anthropic.AuthenticationError) return { error: 'Khoá AI không đúng hoặc đã hết hạn. Nhờ Quản trị kiểm tra ANTHROPIC_API_KEY.' };
    if (e instanceof Anthropic.RateLimitError) return { error: 'AI đang bận, thử lại sau 1 phút.' };
    if (e instanceof Anthropic.APIError) return { error: 'AI báo lỗi (' + (e.status || '') + '). Thử lại sau.' };
    return { error: 'Không kết nối được AI. Thử lại sau.' };
  }
  if (res.stop_reason === 'refusal') return { error: 'AI không trả lời được nội dung này.' };
  if (res.stop_reason === 'max_tokens') return { error: 'AI viết dài quá giới hạn nên bị cắt. Thử lại với ít ảnh / file hơn.' };
  let j = null; const raw = textOf(res), m = raw.match(/\{[\s\S]*\}/); try { j = m && JSON.parse(m[0]); } catch (e) { }
  return j ? { j } : { error: 'AI trả lời sai định dạng, bấm làm lại nhé.' };
}
async function dayGate(x, kind) {
  const dk = 'sanai_' + kind + '_' + fmtDate(Date.now(), 'yyMMdd'), n = Number(await kvGet(x.db, dk) || 0);
  if (n >= DAY_MAX[kind]) return 'Hôm nay đã dùng hết ' + DAY_MAX[kind] + ' lượt. Mai làm tiếp nhé.';
  await kvSet(x.db, dk, String(n + 1), 2 * DAY); return '';
}
const STR = { type: 'string' }, ARR = { type: 'array', items: STR };
const ACT = { type: 'array', items: { type: 'object', properties: { t: STR, why: STR, do: STR }, required: ['t', 'why', 'do'], additionalProperties: false } };
const SCH_SHOP = { type: 'object', properties: { diem: { type: 'integer' }, sum: STR, tot: ARR, chua: ARR, acts: ACT, hoc: STR, can_them: STR }, required: ['diem', 'sum', 'tot', 'chua', 'acts', 'hoc', 'can_them'], additionalProperties: false };
const ROW = { type: 'object', properties: { shop: STR, sp: STR, gia: STR, daban: STR, sao: STR, km: STR, ghichu: STR }, required: ['shop', 'sp', 'gia', 'daban', 'sao', 'km', 'ghichu'], additionalProperties: false };
const SCH_DT = { type: 'object', properties: { rows: { type: 'array', items: ROW }, sum: STR, doi: ARR, minh: STR, acts: ACT, tukhoa: ARR }, required: ['rows', 'sum', 'doi', 'minh', 'acts', 'tukhoa'], additionalProperties: false };
const cleanActs = a => (Array.isArray(a) ? a : []).slice(0, 3).map(z => ({ t: cut(z.t, 200), why: cut(z.why, 400), do: cut(z.do, 600) })).filter(z => z.t);
const law = s => String(s || '').replace(/chữa khỏi|điều trị|khỏi bệnh|thần dược/gi, '…');

/** 🩺 chấm sức khoẻ shop */
async function aiShop(x, u, d) {
  const M = await shopMetrics(x);
  if (!M) return { ok: false, error: 'Chưa có số Shopee. Tải file đơn hàng Shopee (📤 Tải file từ sàn) hoặc nhập Google Sheet báo cáo trước.' };
  const files = (Array.isArray(d.files) ? d.files : []).slice(0, 4).map(f => ({ name: cut(f.name, 120), text: cut(f.text, 15000) })).filter(f => f.text);
  const g = await dayGate(x, 'shop'); if (g) return { ok: false, error: g };
  const C = await cfgOf(x), learn = await learnText(x);
  const sys = 'Bạn là trợ lý vận hành shop Shopee của Thực Dưỡng Lành (VitaGreen Nutrition). Viết tiếng Việt dễ hiểu, ngắn, nói thẳng, không thuật ngữ khó (nếu dùng ACOS, CTR… thì giải thích 3–5 chữ). Chỉ dùng số có trong dữ liệu, không bịa. ' + LAW;
  const ask = [
    '# CÁCH ĐÁNH GIÁ (của người phụ trách sàn, làm đúng theo cách này)', cut(C.shop, 20000) || DEF_SHOP, '',
    '# SỐ CRM TỰ TÍNH TỪ ĐƠN SHOPEE', metricsText(M),
    ...files.map(f => '\n# FILE THÊM: ' + f.name + ' (bảng, cột cách nhau bằng dấu tab)\n' + f.text),
    d.note ? '\n# NGƯỜI PHỤ TRÁCH GHI THÊM\n' + cut(d.note, 2000) : '',
    learn ? '\n# VIỆC ĐÃ LÀM TRƯỚC ĐÂY + KẾT QUẢ (CRM đo doanh số TB / ngày 7 ngày trước và sau khi làm). Việc hiệu quả → gợi ý làm tiếp / nhân rộng; không hiệu quả → đừng lặp lại, rút kinh nghiệm vào ô hoc.\n' + learn : '',
    '', 'ĐẦU RA (JSON): diem = điểm sức khoẻ shop 0–100; sum = nhận xét chung 2–3 câu; tot = tối đa 3 điểm tốt; chua = tối đa 4 điểm chưa tốt (kèm số); acts = ĐÚNG tối đa 3 việc làm hôm nay, t = việc (≤15 chữ), why = vì sao (kèm số), do = làm thế nào từng bước trên Kênh Người Bán; hoc = 1–2 câu rút kinh nghiệm từ việc đã làm (không có thì ""); can_them = file nào nên tải thêm lần sau để đánh giá chính xác hơn (không cần thì "").'
  ].filter(s => s !== '').join('\n');
  const r = await callAi(x, M_SHOP, 'medium', sys, [{ type: 'text', text: ask }], SCH_SHOP, 12000);
  if (r.error) return { ok: false, error: r.error };
  const j = r.j, out = { diem: Math.max(0, Math.min(100, Math.round(Number(j.diem) || 0))), sum: law(cut(j.sum, 800)), tot: (j.tot || []).slice(0, 3).map(s => law(cut(s, 300))), chua: (j.chua || []).slice(0, 4).map(s => law(cut(s, 300))), hoc: law(cut(j.hoc, 500)), can_them: cut(j.can_them, 300), files: files.map(f => f.name) };
  const acts = cleanActs(j.acts).map(a => ({ t: law(a.t), why: law(a.why), do: law(a.do) }));
  const id = 'S' + randHex(5);
  await schema(x.db);
  await run(x.db, 'INSERT INTO san_ai (id, kind, day, j, m, acts, by_name, at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)', id, 'shop', vnDay(Date.now()), JSON.stringify(out), JSON.stringify(M), JSON.stringify(acts), u.name, Date.now());
  return { ok: true, id };
}

/** 🔍 đối thủ đầu tuần: ảnh chụp màn hình + chữ dán */
async function aiDt(x, u, d) {
  const imgs = (Array.isArray(d.imgs) ? d.imgs : []).filter(s => /^data:image\/(jpeg|png|webp);base64,/.test(s)).slice(0, 8), text = cut(d.text, 30000);
  await schema(x.db);
  const DI = Array.isArray(d.pages) && d.pages.length ? await dtItems(x, d.pages) : null;
  if (!imgs.length && !text && !DI) return { ok: false, error: Array.isArray(d.pages) && d.pages.length ? 'Không đọc được sản phẩm nào từ dữ liệu dán vào. Kéo trang Shopee xuống cho hiện sản phẩm rồi bấm nút 📥 lại.' : 'Chọn ảnh chụp màn hình hoặc dán chữ trang Shopee trước nhé.' };
  if (imgs.reduce((s, i) => s + i.length, 0) > 9e6) return { ok: false, error: 'Ảnh nặng quá, bớt ảnh đi nhé.' };
  const g = await dayGate(x, 'dt'); if (g) return { ok: false, error: g };
  await schema(x.db);
  const C = await cfgOf(x), prev = await first(x.db, "SELECT day, j FROM san_ai WHERE kind = 'dt' ORDER BY at DESC LIMIT 1"), mine = await ourPrices(x);
  let pj = null; try { pj = prev && JSON.parse(prev.j); } catch (e) { }
  const sys = 'Bạn là chuyên viên nghiên cứu thị trường sàn Shopee cho Thực Dưỡng Lành (VitaGreen Nutrition): thực phẩm dinh dưỡng từ hạt, trà thảo mộc (trà DILVANG đinh lăng chè vằng, trà mâm xôi…), bột ngũ cốc, đồ chay, fucoidan. Viết tiếng Việt dễ hiểu. Chỉ ghi số đọc được trong ảnh / chữ, không đọc được thì để "?". Không bịa. ' + LAW;
  const ask = [
    '# CÁCH XEM ĐỐI THỦ (của người phụ trách sàn, làm đúng theo cách này)', cut(C.dt, 20000) || DEF_DT,
    C.kw ? '\nTừ khoá đang theo dõi: ' + cut(C.kw, 1000) : '', C.rivals ? 'Shop đối thủ đang theo dõi: ' + cut(C.rivals, 2000) : '',
    mine ? '\n# GIÁ BÁN CỦA THỰC DƯỠNG LÀNH TRÊN SHOPEE (30 ngày)\n' + mine : '',
    pj && pj.rows ? '\n# BẢNG TUẦN TRƯỚC (' + prev.day + ') để so sánh\n' + pj.rows.map(r0 => '- ' + [r0.shop, r0.sp, r0.gia, 'đã bán ' + r0.daban, r0.sao + '★', r0.km].join(' · ')).join('\n') : '\n(Chưa có bảng tuần trước.)',
    DI ? '\n# SẢN PHẨM LẤY TỪ TRANG SHOPEE (máy đã tách tên / giá / đã bán và tự so với lần lấy trước ≥3 ngày; [từ khoá trang] · tên · giá · đã bán · nhãn · mã shop · thay đổi)\n' + DI.text : '',
    text ? '\n# CHỮ DÁN TỪ TRANG SHOPEE\n' + text : '',
    imgs.length ? '\nCó ' + imgs.length + ' ảnh chụp màn hình Shopee ở trên.' : '',
    DI ? '\nCó bảng sản phẩm máy đã tách: rows để [] (CRM tự hiện bảng), tập trung phân tích. tukhoa = 5–10 từ khoá / cụm từ đối thủ bán chạy hay đặt trong TÊN sản phẩm (nhóm khách, công dụng được phép nói, quy cách) mà mình nên cân nhắc thêm vào tên.' : 'tukhoa = từ khoá đối thủ hay đặt trong tên sản phẩm (tối đa 10).',
    '', 'ĐẦU RA (JSON): rows = mỗi sản phẩm đối thủ 1 dòng (tối đa 40, bỏ sản phẩm của Thực Dưỡng Lành nếu có, ghichu = so tuần trước: "giảm giá 20k", "bán tăng mạnh", "mới"… hoặc ""); sum = tóm tắt thị trường 2–3 câu; doi = tối đa 5 thay đổi đáng chú ý so tuần trước; minh = vị trí của Thực Dưỡng Lành so với đối thủ (giá, điểm mạnh / yếu) 2–3 câu; acts = tối đa 3 phương án tuần này, t ≤15 chữ, why kèm số, do = làm thế nào.'
  ].filter(s => s !== '').join('\n');
  const content = imgs.map(s => { const m = s.match(/^data:(image\/[a-z]+);base64,(.+)$/); return { type: 'image', source: { type: 'base64', media_type: m[1], data: m[2] } }; });
  content.push({ type: 'text', text: ask });
  const r = x.env.ANTHROPIC_API_KEY ? await callAi(x, M_DT, 'medium', sys, content, SCH_DT, 16000) : { error: 'AI chưa được bật.' };
  if (r.error && !DI) return { ok: false, error: r.error };
  // AI lỗi nhưng đã có bảng máy so (nút 📥) → vẫn lưu bảng so tuần trước, ghi rõ AI chưa phân tích
  const j = r.error ? { sum: '⚠️ AI chưa phân tích được (' + r.error + '). Bảng so với tuần trước bên dưới do máy tính sẵn, vẫn dùng được.', doi: [], minh: '', acts: [], tukhoa: [] } : r.j, out = { tukhoa: (j.tukhoa || []).slice(0, 10).map(s => cut(s, 60)), pages: DI ? DI.kws : [], items: DI ? DI.n : 0, rows: DI ? DI.rows : (j.rows || []).slice(0, 40).map(z => ({ shop: cut(z.shop, 80), sp: cut(z.sp, 160), gia: cut(z.gia, 40), daban: cut(z.daban, 40), sao: cut(z.sao, 10), km: cut(z.km, 160), ghichu: cut(z.ghichu, 160) })), sum: law(cut(j.sum, 800)), doi: (j.doi || []).slice(0, 5).map(s => cut(s, 300)), minh: law(cut(j.minh, 800)), n: imgs.length, txt: text ? 1 : 0 };
  const acts = cleanActs(j.acts).map(a => ({ t: law(a.t), why: law(a.why), do: law(a.do) }));
  const id = 'D' + randHex(5);
  await run(x.db, 'INSERT INTO san_ai (id, kind, day, j, m, acts, by_name, at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)', id, 'dt', vnDay(Date.now()), JSON.stringify(out), '{}', JSON.stringify(acts), u.name, Date.now());
  return { ok: true, id };
}

async function aiView(x, u) {
  await schema(x.db);
  const rows = await all(x.db, 'SELECT id, kind, day, j, m, acts, by_name, at FROM san_ai ORDER BY at DESC LIMIT 30'), P = s => { try { return JSON.parse(s); } catch (e) { return null; } };
  const list = [];
  for (const r of rows) {
    const acts = P(r.acts) || [];
    for (const a of acts) if (a.done && r.kind === 'shop') a.res = await actResult(x, a.done.slice(0, 10));
    list.push({ id: r.id, kind: r.kind, day: r.day, j: P(r.j) || {}, m: r.kind === 'shop' ? P(r.m) : null, acts, by: r.by_name, at: r.at });
  }
  const C = await cfgOf(x), shp = await crmShp(x, u, { action: 'san_shp' });
  return { ok: true, list, cfg: C, def: { shop: DEF_SHOP, dt: DEF_DT }, aiOn: !!x.env.ANTHROPIC_API_KEY, book: await dayBook(x), shp, admin: u.level >= 3 };
}
async function aiCfg(x, u, d) {
  const C = await cfgOf(x);
  for (const f of ['shop', 'dt']) if (d[f] != null) C[f] = cut(d[f], 20000);
  for (const f of ['kw', 'rivals']) if (d[f] != null) C[f] = cut(d[f], 2000);
  if (d.cogs != null) { if (u.level < 3) return { ok: false, error: 'Chỉ Quản trị.' }; const c = Number(d.cogs); if (c > 0 && c < 0.95) C.cogs = Math.round(c * 1000) / 1000; }
  if (d.shop != null || d.dt != null) { C.by = u.name; C.at = Date.now(); }
  await kvSet(x.db, 'san_ai_cfg', JSON.stringify(C)); return { ok: true };
}
async function aiAct(x, u, d) {
  await schema(x.db);
  const r = await first(x.db, 'SELECT acts FROM san_ai WHERE id = ?', String(d.id || '')); if (!r) return { ok: false, error: 'Không tìm thấy bản đánh giá.' };
  let A = []; try { A = JSON.parse(r.acts || '[]'); } catch (e) { }
  const a = A[Number(d.i)]; if (!a) return { ok: false, error: 'Không tìm thấy việc.' };
  if (d.done) { a.done = vnDay(Date.now()); a.by = u.name; if (d.note != null) a.note = cut(d.note, 300); } else { delete a.done; delete a.by; delete a.note; }
  await run(x.db, 'UPDATE san_ai SET acts = ? WHERE id = ?', JSON.stringify(A), String(d.id)); return { ok: true };
}
async function aiDel(x, u, d) {
  if (u.level < 3) return { ok: false, error: 'Chỉ Quản trị xoá được.' };
  await schema(x.db); await run(x.db, 'DELETE FROM san_ai WHERE id = ?', String(d.id || '')); return { ok: true };
}

export async function crmSanAi(x, u, d) {
  const a = d.action;
  if (a === 'san_ai_view') return aiView(x, u);
  if (a === 'san_ai_cfg') return aiCfg(x, u, d);
  if (a === 'san_ai_act') return aiAct(x, u, d);
  if (a === 'san_ai_del') return aiDel(x, u, d);
  if (a === 'san_ai_day') return aiDay(x, u, d);
  if (/^san_shp/.test(a)) return crmShp(x, u, d);
  if (a === 'san_ai_dt' && Array.isArray(d.pages) && d.pages.length) return aiDt(x, u, d); // có bảng máy so → chạy được cả khi AI tắt
  if (!x.env.ANTHROPIC_API_KEY) return { ok: false, error: 'AI chưa được bật (chưa có khoá ANTHROPIC_API_KEY trên máy chủ).' };
  if (a === 'san_ai_shop') return aiShop(x, u, d);
  if (a === 'san_ai_dt') return aiDt(x, u, d);
  return { ok: false, error: 'Lệnh không đúng.' };
}

/** 21h: chưa ghi sổ theo dõi hôm nay (Shopee chưa tự đổ chi phí quảng cáo về) → nhắc người phụ trách sàn. */
export async function sanAiEvening(x, users, sendTo) {
  const ppl = ((await kvJson(x.db, 'san_cfg', {}) || {}).people || []); if (!ppl.length) return;
  await sanDaySchema(x.db); const r = await first(x.db, 'SELECT ads, vid, live, aff FROM san_day WHERE day = ?', vnDay(Date.now()));
  if (r && (r.ads != null || r.vid != null || r.live != null || r.aff != null)) return;
  const text = '📒 <b>Rà soát cuối ngày Shopee</b>\nHôm nay chưa ghi sổ: chi phí quảng cáo, doanh thu quảng cáo, đơn video / live / affiliate. Mở CRM tab Sàn → 📒 Sổ theo dõi ngày → ✏️ Ghi số (1 phút).\nhttps://crm.thucduonglanh.vn/#san';
  for (const n of ppl) { const z = users.find(v => v.active && v.tg && v.name === n); if (z) await sendTo(x.env, z.tg, text); }
}
/** 8h sáng: nhắc người phụ trách sàn (Telegram riêng). Mỗi ngày: số Shopee hôm qua; thứ Hai: thêm nhắc làm bảng đối thủ. */
export async function sanAiMorning(x, users, sendTo) {
  const ppl = ((await kvJson(x.db, 'san_cfg', {}) || {}).people || []); if (!ppl.length) return;
  const y = vnDay(Date.now() - DAY), w = vnDay(Date.now() - 8 * DAY);
  const q = dd => first(x.db, "SELECT SUM(CASE WHEN state = 'ok' THEN gmv - refund ELSE 0 END) AS g, SUM(state = 'ok') AS n FROM san_orders WHERE shop = 'Shopee' AND day = ?", dd);
  const [a, b] = await Promise.all([q(y), q(w)]), mon = new Date(Date.now() + 7 * 3600e3).getUTCDay() === 1, L0 = await kvJson(x.db, 'shp_live', null);
  const bal = (await dayBook(x)).bal;
  const L = ['🛒 <b>Shopee sáng nay</b>', a && a.n ? `Hôm qua: ${k(a.g)} · ${a.n} đơn (cùng thứ tuần trước ${k(b && b.g)} · ${(b && b.n) || 0} đơn)` : 'Hôm qua chưa có số Shopee: tải file đơn hàng hoặc gõ Google Sheet báo cáo.',
    L0 && L0.pending != null ? '📦 Đơn chờ đóng gói: <b>' + L0.pending + '</b>' + (L0.chat != null ? ' · 💬 tin nhắn chưa đọc: <b>' + L0.chat + '</b>' : '') : '',
    bal && bal.left != null && bal.left < 3 ? '⚠️ Tiền quảng cáo còn ' + k(bal.v) + ', chỉ đủ khoảng ' + bal.left + ' ngày (chi TB ' + k(bal.avg) + '/ngày). Nạp thêm!' : '',
    '🩺 Bấm <b>Chấm sức khoẻ shop</b> ở tab Sàn để biết 3 việc cần làm hôm nay.', mon ? '🔍 Hôm nay thứ Hai: chụp màn hình trang Shopee của đối thủ, bấm <b>Xem đối thủ tuần này</b>.' : ''];
  const text = L.filter(Boolean).join('\n') + '\nhttps://crm.thucduonglanh.vn/#san';
  for (const n of ppl) { const z = users.find(v => v.active && v.tg && v.name === n); if (z) await sendTo(x.env, z.tg, text); }
}
