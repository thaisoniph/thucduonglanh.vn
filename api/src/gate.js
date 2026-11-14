/* ================================================================ 🛡 Người gác cổng cho câu trả lời của trợ lý chat web + Zalo + Fanpage (tin nhắn, từ 14/11/2026 tối) (14/11/2026, anh Sơn, khoá "AI Workforce: Claude & Codex")
 * Trước khi gửi khách, kiểm tra câu AI vừa viết bằng LUẬT CỐ ĐỊNH (không gọi AI: không tốn tiền, không làm chậm chat):
 *   1. 💰 Giá / phí ship / mức miễn phí ship / số tiền giảm: mọi số tiền phải có trong TÀI LIỆU (chat-kb.txt), hoặc tính được từ đó
 *      (k × giá với k ≤ 10, giá + phí ship, tổng 2 giá, giá sau giảm % có trong tài liệu).
 *   2. 🏷 Khuyến mãi: % giảm và mã giảm giá (chữ in hoa có số, vd SONGLANH5) phải có trong tài liệu.
 *   3. ☎️ Hotline: số điện thoại trong câu trả lời chỉ được là hotline chính thức (hoặc số khách vừa tự gửi).
 *   4. 🌿 Công dụng: câu "giúp / hỗ trợ / tốt cho / giảm / tăng cường… + điều về sức khoẻ" thì điều đó phải có trong phần SẢN PHẨM của tài liệu (lấy từ trang
 *      sản phẩm = hồ sơ công bố); các cụm chỉ dùng khi đúng hồ sơ (lợi sữa, giảm cân, giải độc…) như luật LAW.
 *   5. 🚫 Bệnh / hứa hẹn / doạ: "giúp / hỗ trợ / ngừa… + tên bệnh", chữa / điều trị / khỏi bệnh / thay thuốc, cam kết hiệu quả, "100% khỏi", "nếu không dùng thì…" + bệnh nặng.
 * Không đạt → câu gửi khách đổi thành GATE_MSG ("để em kiểm tra lại rồi báo anh/chị"), báo Telegram nhóm nhân sự, ghi bảng gate_log (CRM → 🎯 → 🛡 Gác cổng).
 * Chế độ (kv gate_cfg { mode }): 'block' (mặc định, chặn + báo) · 'log' (chỉ ghi nhật ký để xem có chặn nhầm không). */
import { run, all, first, kvGet, kvSet, kvJson, nrm, esc, fmtDate, DAY, CRM_URL } from './lib.js';
import { telegram } from './google.js';

export const GATE_MSG = 'Dạ để em kiểm tra lại thông tin này cho thật chắc rồi báo anh/chị ngay nha. [[zalo]]';
const HOTLINE = ['0966326522'];
const PHONE_RE = /(?:\+?84|0)(?:[\s.-]?\d){9}\b/g;
const MONEY_RE = /(\d{1,3}(?:[.,]\d{3})+|\d+(?:[.,]\d+)?)\s*(₫|đồng|vnđ|vnd|đ|k|nghìn|ngàn|nghin|ngan|triệu|trieu|tr)(?![\p{L}\d])/giu;
const NEG = /(không|chẳng|chưa|đừng|chớ|hỏi (ý kiến )?bác sĩ)(?![\p{L}])/iu;
const VERB = '(?:giúp(?: cho)?|hỗ trợ|tốt cho|có tác dụng|có lợi cho|cải thiện|tăng cường|tăng|làm giảm|giảm|hạ|ổn định|điều hoà|điều hòa|ngừa|phòng ngừa|phòng|chống|ngăn|đẩy lùi|chữa|bổ|nuôi dưỡng|làm đẹp|làm mát|thải|đào thải|giải|thanh lọc|phục hồi|bảo vệ)';
// tên bệnh / tình trạng bệnh: không bao giờ nói sản phẩm giúp gì cho các điều này
const DISEASE = ['ung thư', 'khối u', 'u bướu', 'tiểu đường', 'đái tháo đường', 'huyết áp', 'mỡ máu', 'cholesterol', 'gout', 'gút', 'viêm', 'sỏi', 'trĩ', 'men gan', 'gan nhiễm mỡ', 'đột quỵ', 'tim mạch', 'bệnh', 'trào ngược', 'đại tràng', 'dạ dày', 'loãng xương', 'thoái hoá', 'thoái hóa', 'tuyến giáp', 'mất ngủ', 'táo bón', 'hoá trị', 'hóa trị', 'xạ trị', 'suy thận', 'mỡ gan'];
// lợi ích sức khoẻ: được nói khi có trong phần sản phẩm của tài liệu
const BENEFIT = ['tiêu hoá', 'tiêu hóa', 'đường ruột', 'giấc ngủ', 'ngủ ngon', 'đề kháng', 'miễn dịch', 'lợi sữa', 'gọi sữa', 'nhiều sữa', 'cân nặng', 'giảm cân', 'giảm mỡ', 'mỡ bụng', 'vóc dáng', 'da', 'tóc', 'trí nhớ', 'não', 'mắt', 'gan', 'thận', 'tim', 'xương', 'khớp', 'cơ bắp', 'nội tiết', 'thanh nhiệt', 'giải nhiệt', 'giải độc', 'thải độc', 'độc tố', 'thanh lọc', 'mát gan', 'nóng trong', 'đường huyết', 'co hồi', 'sức đề kháng', 'năng lượng', 'trao đổi chất', 'lão hoá', 'lão hóa', 'nám'];
const PROMISE = /cam kết (hiệu quả|khỏi|hết|giảm|tăng|có kết quả)|đảm bảo (hiệu quả|khỏi|hết bệnh|giảm|tăng|100 ?%)|100 ?% (khỏi|hiệu quả|hết|an toàn)|chắc chắn (khỏi|hết|giảm|có hiệu quả|hiệu quả|sẽ khỏe)|hiệu quả (ngay|tức thì|thần kỳ)|sau \d+ (ngày|tuần|tháng) (là |sẽ |thì )?(hết|khỏi|giảm|đỡ|lành)|khỏi hẳn|hết hẳn|dứt điểm|an toàn tuyệt đối|không (hề )?(có )?tác dụng phụ|thần dược|ai dùng cũng (hợp|được|khỏi)|thay (được )?thuốc|thay thế thuốc/i;
const MONEY_TXT = '\\d[\\d.,]*\\s*(?:₫|đồng|vnđ|vnd|đ|k|nghìn|ngàn|triệu|tr)(?![\\p{L}\\d])';
const FREE_RE = new RegExp('(?:miễn phí|free|freeship|không mất phí)\\s*(?:ship|giao hàng|vận chuyển|phí ship|phí giao hàng)?[^.!?\\n]{0,30}?(?:từ|trên|cho đơn|đơn)[^\\d.!?\\n]{0,15}' + MONEY_TXT, 'giu');
const FEE_RE = new RegExp('phí (?:ship|giao hàng|vận chuyển)(?:\\s+(?:là|chỉ|chỉ có|có|đồng giá))?\\s*' + MONEY_TXT, 'giu');
const CURE = /chữa khỏi|chữa dứt|trị dứt|đặc trị|khỏi bệnh|chữa (bệnh|được)|(giúp|hỗ trợ|có thể|có tác dụng|dùng để) (điều )?trị(?![\p{L}])/iu; // "đang điều trị", "phác đồ điều trị" là chuyện của khách, không phải lời hứa
const THREAT = /(nếu (không|chưa)|không (dùng|uống|ăn|mua)[^.!?]{0,25}(thì|sẽ)|để lâu|bỏ qua)[^.!?]{0,50}(ung thư|đột quỵ|tử vong|chết|nguy hiểm tính mạng|biến chứng|bệnh nặng|suy gan|suy thận|nằm viện|hối hận)|nguy cơ (tử vong|ung thư|đột quỵ)/i;

/** Số tiền trong 1 đoạn chữ → [đồng] */
export function moneyOf(text) {
  const out = []; let m; MONEY_RE.lastIndex = 0;
  while ((m = MONEY_RE.exec(String(text || '')))) {
    const raw = m[1], u = m[2].toLowerCase(); let v;
    if (/^(k|nghìn|ngàn|nghin|ngan)$/.test(u)) v = parseFloat(raw.replace(/\.(?=\d{3}\b)/g, '').replace(',', '.')) * 1e3;
    else if (/^(triệu|trieu|tr)$/.test(u)) v = parseFloat(raw.replace(',', '.')) * 1e6;
    else v = /[.,]\d{3}\b/.test(raw) ? Number(raw.replace(/[.,]/g, '')) : parseFloat(raw.replace(',', '.'));
    if (v >= 1000) out.push(Math.round(v));
  }
  return out;
}
/** Dữ kiện cho phép, tính từ TÀI LIỆU (chat-kb.txt); giữ trong bộ nhớ theo nội dung tài liệu */
let factsMem = null;
export function facts(kbText) {
  const K = String(kbText || '');
  if (factsMem && factsMem.k === K.length + ':' + K.slice(-200)) return factsMem.f;
  const st = K.indexOf('\n# SỔ TAY DOANH NGHIỆP'), base = st > 0 ? K.slice(0, st) : K; // Sổ tay có danh sách "cụm cấm" → không tính là được nói
  const a = base.indexOf('# KIẾN THỨC CHI TIẾT'), b = base.indexOf('## Quà tặng miễn phí');
  const prodTxt = nrm(a >= 0 ? base.slice(a, b > a ? b : undefined) : base);
  const money = [...new Set(moneyOf(K))], pct = [...new Set((K.match(/\d+(?:[.,]\d+)?\s?%/g) || []).map(s => parseFloat(s.replace(',', '.'))))];
  const ok = new Set();
  for (const p of money) {
    for (let k = 1; k <= 10; k++) ok.add(k * p);
    ok.add(p + 30000);
    for (const r of pct) if (r > 0 && r < 100) { ok.add(Math.round(p * (1 - r / 100) / 1000) * 1000); ok.add(Math.round(p * r / 100 / 1000) * 1000); }
    for (const q of money) ok.add(p + q);
  }
  const grab = re => new Set([...K.matchAll(re)].flatMap(m => moneyOf(m[0])));
  const free = grab(FREE_RE), fee = grab(FEE_RE);
  const codes = new Set((K.match(/\b[A-Z][A-Z0-9]{3,}\d\b/g) || []));
  const f = { ok, pct: new Set(pct), codes, prodTxt, money, free, fee };
  factsMem = { k: K.length + ':' + K.slice(-200), f };
  return f;
}
const near = (s, i) => NEG.test(s.slice(Math.max(0, i - 40), i).split(/[.!?\n]/).pop()); // phủ định trong cùng câu, ≤ 40 ký tự trước ("không có tác dụng thay thế thuốc chữa bệnh")
/** Kiểm tra 1 câu trả lời → [{ k: loại, t: lý do }] (rỗng = đạt). ctx.q = tin khách vừa gửi (số điện thoại khách tự gửi thì được nhắc lại). */
export function gateCheck(reply, kbText, ctx) {
  const R = String(reply || '').replace(/\[\[[^\]]*\]\]/g, ' '), f = facts(kbText), why = [], q = String(ctx && ctx.q || '');
  // 1. tiền
  for (const v of moneyOf(R)) {
    const r1 = Math.round(v / 1000) * 1000;
    if (!f.ok.has(v) && !f.ok.has(r1)) why.push({ k: 'gia', t: 'Số tiền ' + v.toLocaleString('vi-VN') + 'đ không có trong dữ liệu web (giá, phí ship, mức miễn phí ship)' });
  }
  for (const m of R.matchAll(FREE_RE)) for (const v of moneyOf(m[0])) if (!f.free.has(v)) why.push({ k: 'ship', t: 'Mức miễn phí ship ' + v.toLocaleString('vi-VN') + 'đ khác dữ liệu web (' + [...f.free].map(n => n.toLocaleString('vi-VN') + 'đ').join(', ') + ')' });
  for (const m of R.matchAll(FEE_RE)) for (const v of moneyOf(m[0])) if (!f.fee.has(v)) why.push({ k: 'ship', t: 'Phí ship ' + v.toLocaleString('vi-VN') + 'đ khác dữ liệu web' });
  // 2. khuyến mãi
  for (const m of R.matchAll(/(\d+(?:[.,]\d+)?)\s?%/g)) { const v = parseFloat(m[1].replace(',', '.')); if (!f.pct.has(v)) why.push({ k: 'km', t: 'Mức ' + m[0] + ' không có trong dữ liệu web' }); }
  for (const m of R.matchAll(/\b[A-Z][A-Z0-9]{3,}\d\b/g)) if (!f.codes.has(m[0])) why.push({ k: 'km', t: 'Mã ' + m[0] + ' không có trong dữ liệu web' });
  // 3. số điện thoại
  const mine = new Set((q.match(PHONE_RE) || []).map(s => s.replace(/\D/g, '').replace(/^84/, '0')));
  for (const m of R.match(PHONE_RE) || []) { const p = m.replace(/\D/g, '').replace(/^84/, '0'); if (!HOTLINE.includes(p) && !mine.has(p)) why.push({ k: 'sdt', t: 'Số ' + m.trim() + ' không phải hotline chính thức 0966 326 522' }); }
  // 5. chữa bệnh, hứa hẹn, doạ (xét trước công dụng)
  const low = R.toLowerCase();
  for (const m of low.matchAll(new RegExp(CURE.source, 'giu'))) if (!near(low, m.index)) why.push({ k: 'benh', t: 'Có chữ "' + m[0] + '"' });
  const pm = low.match(PROMISE); if (pm && !near(low, pm.index)) why.push({ k: 'hua', t: 'Hứa hẹn: "' + pm[0] + '"' });
  const tm = low.match(THREAT); if (tm) why.push({ k: 'doa', t: 'Doạ: "' + tm[0].slice(0, 60) + '"' });
  // 4. công dụng: động từ lợi ích + điều sức khoẻ trong cùng 1 vế câu
  for (const cl of low.split(/(?<=[.!?\n;:])/).filter(c => !/\?\s*$/.test(c))) { // câu hỏi ("… có tốt cho dạ dày không?") không phải lời khẳng định
    for (const m of cl.matchAll(new RegExp('(?<![\\p{L}])' + VERB + '(?![\\p{L}])([^,]{0,40})', 'giu'))) {
      if (near(cl, m.index)) continue;
      const tail = ' ' + m[1] + ' ', has = w => new RegExp('(^|[^\\p{L}])' + w + '($|[^\\p{L}])', 'iu').test(tail);
      const dz = DISEASE.find(has); if (dz) { why.push({ k: 'benh', t: 'Nói sản phẩm ' + m[0].trim().slice(0, 50) + ' (tên bệnh: ' + dz + ')' }); continue; }
      const bn = BENEFIT.find(has); if (bn && !f.prodTxt.includes(nrm(bn))) why.push({ k: 'cong', t: 'Công dụng "' + m[0].trim().slice(0, 50) + '" không có trong hồ sơ / trang sản phẩm' });
    }
  }
  const seen = new Set(); return why.filter(w => { const k = w.k + w.t; if (seen.has(k)) return false; seen.add(k); return true; }).slice(0, 6);
}

let ready = false;
async function schema(db) {
  if (ready) return;
  await run(db, "CREATE TABLE IF NOT EXISTS gate_log (id INTEGER PRIMARY KEY AUTOINCREMENT, at INTEGER, ch TEXT DEFAULT '', q TEXT DEFAULT '', draft TEXT DEFAULT '', why TEXT DEFAULT '[]', mode TEXT DEFAULT '', ref TEXT DEFAULT '', ok_by TEXT DEFAULT '', ok_note TEXT DEFAULT '')");
  await run(db, 'CREATE INDEX IF NOT EXISTS gate_at ON gate_log(at)');
  ready = true;
}
export async function gateCfg(x) { const c = await kvJson(x.db, 'gate_cfg', null); return { mode: c && c.mode === 'log' ? 'log' : 'block' }; }
const CHN = { web: '💬 Chat web', zalo: '👥 Nhóm Zalo', zdm: '💬 Zalo tin riêng', fb: '📘 Fanpage tin nhắn' };
/** Gọi ngay trước khi gửi khách. Trả câu được gửi (gốc hoặc GATE_MSG). Ghi nhật ký + Telegram chạy nền (x.later). */
export async function gate(x, ch, reply, kbText, ctx) {
  let why = []; try { why = gateCheck(reply, kbText, ctx); } catch (e) { console.error('gate', e.message); return reply; }
  if (!why.length) return reply;
  const cfg = await gateCfg(x), block = cfg.mode === 'block', q = String(ctx && ctx.q || '').replace(PHONE_RE, '[SĐT]').slice(0, 600);
  x.later((async () => {
    await schema(x.db);
    await run(x.db, 'INSERT INTO gate_log (at, ch, q, draft, why, mode, ref) VALUES (?, ?, ?, ?, ?, ?, ?)', Date.now(), ch, q, String(reply).slice(0, 2000), JSON.stringify(why), cfg.mode, String(ctx && ctx.ref || '').slice(0, 80));
    const dk = 'gate_tg_' + fmtDate(Date.now(), 'yyMMdd'), n = Number(await kvGet(x.db, dk) || 0);
    if (n < 30) { await kvSet(x.db, dk, String(n + 1), 2 * DAY);
      await telegram(x.env, '🛡 <b>NGƯỜI GÁC CỔNG ' + (block ? 'ĐÃ CHẶN' : 'GHI NHẬN') + ' 1 CÂU TRẢ LỜI</b> · ' + (CHN[ch] || ch) + '\n❓ Khách hỏi: ' + esc(q.slice(0, 300)) + '\n🤖 Trợ lý định trả lời: ' + esc(String(reply).replace(/\[\[[^\]]*\]\]/g, '').slice(0, 500))
        + '\n⚠️ ' + esc(why.map(w => w.t).join(' · ')) + (block ? '\n✉️ Khách nhận: "' + esc(GATE_MSG.replace(' [[zalo]]', '')) + '"\n👉 Nhân sự trả lời lại khách cho đúng.' : '') + '\n📋 ' + CRM_URL + '/#noi-dung'); }
  })().catch(e => console.error('gate log', e.message)));
  return block ? GATE_MSG : reply;
}
/** CRM 🎯 → 🛡 Gác cổng: nhật ký 30 ngày + chế độ */
export async function crmGate(x, u, d, crmLog) {
  await schema(x.db);
  if (d.mode) {
    if (u.level < 3) return { ok: false, error: 'Chỉ Quản trị đổi được chế độ người gác cổng.' };
    const mode = d.mode === 'log' ? 'log' : 'block'; await kvSet(x.db, 'gate_cfg', JSON.stringify({ mode, by: u.name, at: Date.now() }));
    await crmLog(x, u, 'Insight & nội dung', '-', '', 'Người gác cổng: ' + (mode === 'log' ? 'chỉ ghi nhật ký' : 'chặn + báo'), ''); return { ok: true, mode };
  }
  if (d.ok_id) { await run(x.db, 'UPDATE gate_log SET ok_by = ?, ok_note = ? WHERE id = ?', u.name, String(d.note || '').slice(0, 300), Number(d.ok_id) || 0); return { ok: true }; }
  const since = Date.now() - 30 * DAY, rows = await all(x.db, 'SELECT * FROM gate_log WHERE at > ? ORDER BY id DESC LIMIT 100', since);
  const cnt = await all(x.db, 'SELECT ch, count(*) AS n FROM gate_log WHERE at > ? GROUP BY ch', Date.now() - 7 * DAY);
  const tot = await first(x.db, "SELECT (SELECT count(*) FROM chats WHERE last > ?) AS chats", Date.now() - 7 * DAY).catch(() => null);
  return { ok: true, rows: rows.map(r => Object.assign(r, { why: JSON.parse(r.why || '[]') })), cnt, chats7: tot && tot.chats || 0, mode: (await gateCfg(x)).mode, canMode: u.level >= 3, ch: CHN };
}
