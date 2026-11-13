/* ================================================================ 🌿 Quy tắc của ngày (13/11/2026, anh Sơn chọn "cả công ty chung")
 * Mỗi ngày làm việc (thứ 2–7) cả công ty cùng xem 1 trong 10 Quy Tắc Danh Dự Người VitaGreen (Sổ tay nhân viên 2026),
 * xoay vòng theo thứ tự: 10 ngày làm việc đủ 10 quy tắc. Mỗi quy tắc có 3 bộ gợi ý (công việc + cuộc sống), vòng sau dùng bộ kế tiếp
 * → khoảng 30 ngày làm việc mới lặp lại. Chủ nhật dùng lại quy tắc thứ 7.
 * Thẻ hiện ở đầu màn hình đầu tiên của mỗi người trong CRM (app.js vhCard). Nút "✅ Hôm nay mình sẽ làm" ghi bảng vh_ack (+ 1 dòng chuyện đã làm, không bắt buộc).
 * Quản lý / Quản trị xem ai đã bấm, chuyện hay trong tuần (Cài đặt → 🌿 Văn hoá); Quản trị sửa câu chữ gợi ý (lưu kv 'vh_rules').
 * Tin Telegram 8h (cron.js dailyCare) có thêm 1 dòng quy tắc hôm nay. Không dùng AI → không tốn tiền. */
import { run, all, kvJson, kvSet, fmtDate, DAY, TZ_MS } from './lib.js';
import { wishOfDay, wishFor, wishes, wishSave, bdayStaff } from './loichuc.js'; // ☀️ lời chúc mỗi ngày (14/11/2026) đi kèm vh_today

export const VH_RULES = [
  { t: 'Luôn sát cánh cùng đồng đội', q: 'Đi một mình có thể nhanh. Đi cùng đội ngũ mới có thể đi xa.', tips: [
    { w: 'Hỏi 1 bạn trong nhóm: “Hôm nay có việc gì mình đỡ được không?” rồi làm giúp 1 việc nhỏ.', l: 'Tối nay làm giúp người nhà 1 việc họ hay phải làm một mình (rửa bát, đón con, dọn nhà).' },
    { w: 'Hôm nay được ai giúp thì nhắn cảm ơn, nói rõ cảm ơn vì việc gì.', l: 'Nhắn hỏi thăm 1 người bạn đã lâu chưa liên lạc.' },
    { w: 'Thấy đồng đội đang vướng (khách khó, đơn rối, file lỗi) thì hỏi thăm trước khi họ phải lên tiếng nhờ.', l: 'Khi người thân kể chuyện mệt, ngồi nghe hết rồi mới góp ý.' }] },
  { t: 'Đặt mục tiêu chung cao hơn cái tôi cá nhân', q: 'Cái tôi nhỏ lại, đội ngũ lớn lên.', tips: [
    { w: 'Trước khi phản đối ý của ai, tự hỏi: “Điều gì tốt nhất cho mục tiêu chung?”', l: 'Hôm nay nhường người nhà chọn món ăn hoặc chương trình xem.' },
    { w: 'Việc đã thống nhất trong họp thì dốc sức làm, kể cả khi lúc đầu mình chưa đồng ý.', l: 'Khi tranh luận ở nhà, nói “Mình cùng tìm cách nhé” thay vì cố nói cho thắng.' },
    { w: 'Kể thành tích của nhóm, không chỉ của riêng mình: nhắc tên 1 người đã góp sức.', l: 'Chịu thiệt một chút trong 1 chuyện nhỏ để cả nhà vui hơn.' }] },
  { t: 'Minh bạch trong công việc, bảo mật trong dữ liệu', q: 'Rõ ràng tạo ra niềm tin. Bảo mật gìn giữ niềm tin.', tips: [
    { w: 'Có sai sót nào chưa báo? Báo ngay trong sáng nay, kèm cách mình sẽ sửa.', l: 'Nói thật nhẹ nhàng 1 điều mình còn ngại nói với người thân.' },
    { w: 'Không gửi ảnh chụp CRM, số điện thoại khách hay tài liệu nội bộ ra ngoài, kể cả đưa lên AI công khai. Xem lại điện thoại có lưu file khách ở chỗ lạ không.', l: 'Đổi mật khẩu yếu nhất của mình (Facebook, Zalo, ngân hàng).' },
    { w: 'Ghi kết quả công việc vào CRM đúng sự thật, kể cả khi kết quả chưa tốt.', l: 'Ghi lại chi tiêu hôm nay rõ ràng, minh bạch với người cùng lo tiền nhà.' }] },
  { t: 'Tạo giá trị nhiều hơn mong đợi', q: 'Việc nhỏ làm cẩu thả tạo nên con người cẩu thả. Việc nhỏ làm tử tế tạo nên con người đáng tin.', tips: [
    { w: 'Chọn 1 việc hôm nay và làm thêm 1 bước: gói hàng kỹ hơn, ghi chú khách rõ hơn, báo cáo dễ đọc hơn.', l: 'Làm 1 điều nhỏ bất ngờ cho người thân: pha ly nước, viết 1 dòng cảm ơn.' },
    { w: 'Làm xong việc thì kiểm tra lại 1 lần: đúng tên, đúng số, đúng giờ chưa.', l: 'Việc nhà đã nhận thì làm đến nơi: rửa bát xong lau luôn bếp.' },
    { w: 'Với 1 khách hoặc 1 đồng đội hôm nay, nghĩ thêm 1 bước: làm gì để họ đỡ mất công hơn?', l: 'Gọi cho bố mẹ, trò chuyện lâu hơn thường ngày 5 phút.' }] },
  { t: 'Liên tục cải tiến', q: 'Mỗi ngày tốt hơn 1%, một năm sau ta sẽ gặp một phiên bản rất khác của chính mình.', tips: [
    { w: 'Ghi lại 1 việc mình làm đi làm lại mỗi ngày, nghĩ cách làm nhanh hơn, rồi bấm 💡 Góp ý trong CRM để gửi.', l: 'Bớt 1 thói quen nhỏ chưa tốt hôm nay (thức khuya, lướt điện thoại lúc ăn).' },
    { w: 'Lỗi nào mình đã mắc 2 lần? Viết 1 dòng nhắc để lần sau không lặp lại.', l: 'Học 1 điều mới trong 10 phút: 1 món ăn lành, 1 bài tập thở.' },
    { w: 'Thay vì than “cái này khó”, đề xuất với quản lý 1 cách sửa cụ thể. Mỗi tháng ít nhất 1 đề xuất.', l: 'Sắp xếp lại 1 góc nhỏ trong nhà cho gọn, dễ dùng hơn.' }] },
  { t: 'Nhanh, tập trung và hiệu quả', q: 'Đừng chỉ bận rộn. Hãy tạo ra kết quả.', tips: [
    { w: 'Đầu giờ viết ra 3 việc quan trọng nhất hôm nay, làm xong việc số 1 trước.', l: 'Bữa tối nay cất điện thoại, ăn chậm bên người thân.' },
    { w: 'Làm 45 phút thật tập trung: tắt thông báo mạng xã hội, xong mới nghỉ ngắn.', l: 'Tối nay ngủ sớm hơn 30 phút để mai đủ sức.' },
    { w: 'Cuối ngày tự hỏi: hôm nay mình tạo ra kết quả gì, chứ không chỉ bận việc gì?', l: 'Dành trọn 15 phút chơi với con hoặc trò chuyện với người thân, không làm việc khác.' }] },
  { t: 'Nói thẳng với trái tim rộng mở', q: 'Nói thật với thiện chí là xây đội. Nói sau lưng là phá đội.', tips: [
    { w: 'Khen thật lòng 1 đồng đội, nói rõ việc họ đã làm tốt.', l: 'Nói lời cảm ơn hoặc lời khen với người nhà, nói rõ vì sao.' },
    { w: 'Đang để bụng điều gì với ai? Nói riêng với người đó: nói về sự việc, không chê con người.', l: 'Khi góp ý người thân, bắt đầu bằng 1 điều tốt của họ.' },
    { w: 'Nghe ai nói xấu đồng đội, nhẹ nhàng gợi ý họ nói thẳng với người đó.', l: 'Được góp ý thì nói “Cảm ơn, mình sẽ xem lại” trước khi giải thích.' }] },
  { t: 'Chịu trách nhiệm 100%, không đổ lỗi', q: 'Đổ lỗi làm ta yếu đi. Nhận trách nhiệm làm ta lớn lên.', tips: [
    { w: 'Có việc trục trặc, nói “Phần này mình lo” và nêu cách sửa trước, giải thích lý do sau.', l: 'Hôm nay thay câu “Tại…” bằng câu “Lần sau mình sẽ…”.' },
    { w: 'Khách hoặc đồng đội phàn nàn: nhận phần của mình trước, hỏi cách giúp, rồi mới tìm nguyên nhân.', l: 'Cả ngày hôm nay không than phiền. Gặp chuyện thì tìm 1 việc làm được ngay.' },
    { w: 'Làm xong 1 việc đang dở dang mà không đợi ai nhắc.', l: 'Xin lỗi 1 người nếu gần đây mình đã làm họ buồn.' }] },
  { t: 'Đã hứa là làm, không chắc thì nói rõ', q: 'Một người giữ lời tạo nên niềm tin. Một đội ngũ giữ lời tạo nên thương hiệu.', tips: [
    { w: 'Xem lại các lời hẹn: hẹn gọi lại khách, hẹn gửi file, hẹn trả lời. Hôm nay làm cho xong.', l: 'Làm 1 điều đã hứa với người thân mà còn hoãn.' },
    { w: 'Việc nào có thể trễ thì báo ngay hôm nay, kèm ngày xong mới. Đừng đợi đến hạn.', l: 'Chỉ hứa điều chắc làm được, kể cả chuyện nhỏ như “tối nay về sớm”.' },
    { w: 'Trước khi nhận việc, hỏi lại cho rõ: làm gì, khi nào xong, kết quả cần ra sao.', l: 'Đúng giờ với mọi cuộc hẹn hôm nay, đến sớm 5 phút.' }] },
  { t: 'Phát triển bản thân mỗi ngày', q: 'Mỗi người tốt hơn, VitaGreen tốt hơn. VitaGreen tốt hơn, tương lai của mỗi người cũng tốt hơn.', tips: [
    { w: 'Học 1 điều mới trong 15 phút: 1 mục trong Hướng dẫn, 1 thông tin sản phẩm, hoặc 1 cách dùng AI cho công việc.', l: 'Đọc 5 trang sách trước khi ngủ.' },
    { w: 'Chưa biết thì hỏi ngay, không ngại: hôm nay hỏi 1 người giỏi hơn mình 1 câu.', l: 'Viết ra 3 điều biết ơn trong ngày.' },
    { w: 'Chia sẻ lại cho đồng đội 1 điều mình mới học, 1 tin nhắn trong nhóm là đủ.', l: 'Vận động 20 phút: đi bộ, đạp xe hoặc tập thở.' }] }
];

const EPOCH = Date.UTC(2026, 10, 13); // 13/11/2026 (thứ 6) = quy tắc 1, bộ gợi ý 1
const NOTE_LEN = 300;

/** Ngày VN 'yyyy-MM-dd' → số ngày làm việc (bỏ Chủ nhật) kể từ EPOCH. */
function workIdx(day) {
  const [y, m, d] = day.split('-').map(Number), t = Date.UTC(y, m - 1, d);
  let n = 0;
  for (let k = EPOCH + DAY; k <= t; k += DAY) if (new Date(k).getUTCDay() !== 0) n++;
  return Math.max(0, n);
}

async function rules(db) { // bản Quản trị đã sửa (nếu có), thiếu chỗ nào thì lấy bản gốc
  const o = await kvJson(db, 'vh_rules', null);
  if (!Array.isArray(o)) return VH_RULES;
  return VH_RULES.map((r, i) => ({ t: r.t, q: r.q, tips: r.tips.map((p, j) => { const e = o[i] && o[i][j] || {}; return { w: String(e.w || '').trim() || p.w, l: String(e.l || '').trim() || p.l }; }) }));
}

/** Quy tắc của 1 ngày: { day, i (0–9), v (0–2), n (số thứ tự 1–10), t, q, w, l }. */
export async function vhOfDay(db, t) {
  const day = fmtDate(t || Date.now(), 'yyyy-MM-dd'), k = workIdx(day), i = k % 10, v = Math.floor(k / 10) % 3, R = await rules(db), r = R[i];
  return { day, i, v, n: i + 1, t: r.t, q: r.q, w: r.tips[v].w, l: r.tips[v].l };
}

let schemaOk = false;
async function schema(db) {
  if (schemaOk) return;
  await run(db, `CREATE TABLE IF NOT EXISTS vh_ack (day TEXT, email TEXT, name TEXT DEFAULT '', role TEXT DEFAULT '', rule INTEGER, note TEXT DEFAULT '', at INTEGER, note_at INTEGER, PRIMARY KEY (day, email))`);
  schemaOk = true;
}

/** Thẻ đầu màn hình: quy tắc hôm nay + mình đã bấm chưa + bao nhiêu người đã bấm. */
export async function vhToday(x, u) {
  await schema(x.db);
  const r = await vhOfDay(x.db);
  const [me] = await all(x.db, 'SELECT at, note FROM vh_ack WHERE day = ? AND email = ?', r.day, u.email);
  const [c] = await all(x.db, 'SELECT COUNT(*) AS n FROM vh_ack WHERE day = ?', r.day);
  let wish = null; try { wish = await wishFor(x.db, u); } catch (e) { }
  return { ok: true, vh: Object.assign(r, { mine: me ? { at: me.at, note: me.note || '' } : null, cnt: c ? c.n : 0, wish }) };
}

/** ✅ Hôm nay mình sẽ làm (+ 1 dòng chuyện đã làm, không bắt buộc). Bấm lại chỉ sửa dòng ghi chú. */
export async function vhAck(x, u, d) {
  await schema(x.db);
  const r = await vhOfDay(x.db), note = String(d.note || '').replace(/\s+/g, ' ').trim().slice(0, NOTE_LEN), now = Date.now();
  await run(x.db, `INSERT INTO vh_ack (day, email, name, role, rule, note, at, note_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(day, email) DO UPDATE SET note = CASE WHEN excluded.note != '' THEN excluded.note ELSE vh_ack.note END, note_at = CASE WHEN excluded.note != '' THEN excluded.note_at ELSE vh_ack.note_at END, name = excluded.name`,
    r.day, u.email, u.name, u.role, r.n, note, now, note ? now : null);
  return vhToday(x, u);
}

/** Quản lý / Quản trị: ai đã bấm 30 ngày qua, chuyện nhân sự ghi lại, nội dung 10 quy tắc (để sửa). */
export async function vhAdmin(x, u) {
  if (u.level < 2) return { ok: false, error: 'Chỉ Quản lý, Quản trị xem được.' };
  await schema(x.db);
  const since = fmtDate(Date.now() - 30 * DAY, 'yyyy-MM-dd'), today = await vhOfDay(x.db);
  const rows = await all(x.db, 'SELECT day, email, name, rule, note, at FROM vh_ack WHERE day >= ? ORDER BY day DESC, at', since);
  let days = 0; for (let t = Date.now() - 29 * DAY; t <= Date.now(); t += DAY) if (new Date(t + TZ_MS).getUTCDay() !== 0) days++; // số ngày làm việc trong 30 ngày
  return { ok: true, today, days, rows, rules: await rules(x.db), canEdit: u.level >= 3, wish: await wishes(x.db), wishToday: await wishOfDay(x.db) };
}

/** Quản trị sửa câu chữ gợi ý: d.rules = [[{w,l} ×3] ×10]. Ô để trống = dùng lại câu gốc. */
export async function vhSave(x, u, d) {
  if (u.level < 3) return { ok: false, error: 'Chỉ Quản trị sửa được.' };
  const src = Array.isArray(d.rules) ? d.rules : [];
  const o = VH_RULES.map((r, i) => r.tips.map((p, j) => { const e = src[i] && src[i][j] || {}, w = String(e.w || '').trim().slice(0, 400), l = String(e.l || '').trim().slice(0, 400); return { w: w === p.w ? '' : w, l: l === p.l ? '' : l }; }));
  await kvSet(x.db, 'vh_rules', JSON.stringify(o));
  return vhAdmin(x, u);
}

/** ☀️ Quản trị sửa câu chúc mỗi ngày: d.wish = { daily, mon, sat, sun } (mỗi ô nhiều dòng, 1 câu / dòng). */
export async function vhWishSave(x, u, d) {
  if (u.level < 3) return { ok: false, error: 'Chỉ Quản trị sửa được.' };
  await wishSave(x.db, d);
  return vhAdmin(x, u);
}

/** 1 dòng cho tin Telegram 8h. */
export async function vhLine(db) {
  const r = await vhOfDay(db), B = await bdayStaff(db, r.day); // 🎂 sinh nhật nhân sự hôm nay → nhắc cả nhà chúc mừng
  return '🌿 <b>Quy tắc hôm nay · ' + r.n + '. ' + r.t + '</b>\n<i>' + r.q + '</i>\n👉 ' + r.w + (B.length ? '\n🎂 Hôm nay sinh nhật <b>' + B.map(b => b.name).join(', ') + '</b>, nhớ gửi lời chúc mừng nhé!' : '');
}
