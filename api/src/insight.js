/* ================================================================ 🎯 Insight → Tension → Phễu: quy trình chung cho MỌI nội dung AI viết (10/11/2026, anh Sơn:
 * "tất cả nội dung đăng nhóm Zalo, fanpage, website hay kịch bản video đều phải dựa trên insight/tension của nhóm khách mục tiêu và theo 3 tầng phễu TOFU, MOFU, BOFU").
 * Theo khoá content Tuấn Hà (Vinalink): Insight = TENSION – thế giằng co khi điều khách MONG (benefit có ý thức / aspiration tiềm ẩn) va vào RÀO CẢN (constraint) trong 1 cảnh đời cụ thể.
 * Nội dung tốt = gỡ đúng 1 tension (cắt / giảm / đi vòng rào cản, đổi cách nhìn) ở đúng tầng phễu:
 *   TOFU giá trị nằm ở chính nội dung (kéo người lạ) · MOFU giá trị là uy tín (bằng chứng thật) · BOFU giá trị nằm ở sản phẩm / ưu đãi. Mỗi bài có 1 "lối ra".
 * Ngân hàng insight dùng chung: kv ins_bank (CRM → 🎯 Insight & nội dung, Marketing / Quản lý / Quản trị sửa). Chưa sửa lần nào → INS0 bên dưới.
 * Ai dùng: blog.js (bài web), zbot.js (bài nhóm Zalo), fb.js (bài Fanpage), vdWrite ở đây (🎬 kịch bản video), mcp.js (AI bên ngoài lấy về trước khi viết).
 *   1. insPick: chọn nhóm khách (nhân sự chỉ định, không thì nhóm ít được viết nhất ở kênh đó trong 14 ngày) – xoay vòng để không bỏ sót nhóm nào.
 *   2. insBlock: đoạn hướng dẫn gửi AI: chân dung + mong muốn + rào cản + tension của nhóm, tension vừa dùng (tránh lặp), quy trình 4 bước, luật của tầng phễu.
 *   3. AI trả về thêm 3 dòng NHÓM KHÁCH / TENSION / INSIGHT trước nội dung → insParse → lưu cùng bài (hiện trên thẻ bài ở CRM) + insLog (kv ins_log, thống kê). */
import Anthropic from '@anthropic-ai/sdk';
import { aiFetch } from './airelay.js';
import { run, all, first, kvJson, kvSet, kvDel, nrm, DAY } from './lib.js';
import { kb, safe, TRUTH_RULES } from './chat.js';
import { prodMap } from './zbot.js';

const WRITER = 'claude-opus-5-5';
export const CH = { web: '🌐 Web', zalo: '💬 Zalo', fb: '📘 Fanpage', video: '🎬 Video' };

/** Ngân hàng mặc định (từ ô "Tệp khách hàng, insight và tension" của trợ lý viết bài web + chân dung trong skill vtg). Tension: "mong muốn ↔ rào cản – cảnh". */
export const INS0 = [
  { id: 'me-bim', name: 'Mẹ bỉm, mẹ sau sinh', on: true,
    who: '25–38 tuổi, đang nuôi con nhỏ, nhiều người đang cho con bú. Ngày xoay quanh con, ngủ không đủ giấc, hay hỏi trong nhóm mẹ bỉm, hỏi bà, hỏi bạn.',
    want: 'Đủ sữa cho con; lấy lại sức và vóc dáng; con ăn ngon; có chút thời gian cho mình. Sâu hơn: là người mẹ tốt mà vẫn là chính mình, được người nhà ghi nhận sự vất vả.',
    block: 'Không có thời gian nấu riêng; thiếu ngủ; sợ ăn gì ảnh hưởng sữa và con; mỗi người khuyên một kiểu (bà, mẹ chồng, mạng); ngại tiêu tiền cho bản thân; ngại than mệt.',
    tensions: [
      'Muốn ăn đủ chất để có sữa cho con ↔ cả ngày bế con, không có thời gian nấu một bữa tử tế cho mình',
      'Muốn lấy lại vóc dáng ↔ sợ ăn kiêng làm ít sữa, ảnh hưởng tới con',
      'Mệt rã rời, muốn được nghỉ ↔ ngại than vì sợ bị nói "ai đẻ chẳng thế"',
      'Muốn chăm con theo kiến thức mới ↔ ngại trái ý bà, mẹ chồng',
      'Muốn chăm mình một chút ↔ thấy có lỗi khi tiêu tiền, thời gian cho bản thân thay vì cho con',
      'Muốn biết ăn gì là đúng ↔ mỗi nguồn nói một kiểu, không biết tin ai'] },
  { id: 'van-phong', name: 'Dân văn phòng bận rộn', on: true,
    who: '25–45 tuổi, làm 8–10 tiếng, ngồi nhiều, ăn vội; bắt đầu lo cân nặng và các chỉ số khi khám sức khỏe định kỳ.',
    want: 'Tỉnh táo cả ngày; giữ cân; bữa sáng nhanh mà đủ chất; đỡ mệt cuối ngày. Sâu hơn: làm chủ sức khỏe để đi đường dài, không muốn "già trước tuổi".',
    block: 'Buổi sáng vội; đồ ăn quanh công ty nhiều dầu mỡ, đường; căng thẳng là thèm đồ ngọt; không có thói quen nấu; dễ bỏ cuộc; chi tiêu phải tính.',
    tensions: [
      'Biết phải ăn sáng đủ chất ↔ sáng nào cũng vội, ăn tạm hoặc bỏ bữa',
      'Muốn bớt đồ ngọt ↔ chiều nào căng thẳng cũng thèm trà sữa',
      'Muốn ăn lành ↔ cơm văn phòng quanh công ty nhiều dầu mỡ, không tự nấu được',
      'Khám định kỳ thấy chỉ số bắt đầu vượt ngưỡng, muốn thay đổi ↔ không biết bắt đầu từ đâu, sợ phải kiêng khem khổ sở',
      'Muốn sống khỏe ↔ tối về mệt chỉ muốn nằm, thức khuya lướt điện thoại',
      'Muốn đầu tư cho sức khỏe ↔ sợ mua đồ "healthy" đắt tiền rồi bỏ dở'] },
  { id: 'trung-nien', name: 'Trung niên, nghỉ hưu', on: true,
    who: '50–70 tuổi, đã hoặc sắp nghỉ hưu, sống cùng hoặc gần con cháu; quan tâm đường huyết, mỡ máu, giấc ngủ, xương khớp; đọc nhiều tin sức khỏe trên Facebook, Zalo.',
    want: 'Khỏe để tự lo, không phiền con cháu; ngủ ngon; ăn uống điều độ. Sâu hơn: sống vui bên con cháu, vẫn thấy mình hữu ích.',
    block: 'Quá nhiều quảng cáo thổi phồng, sợ bị lừa; răng yếu, ăn khó; quen vị cũ; con cái lo lắng, can thiệp; lương hưu có hạn; đang dùng thuốc nên sợ ăn thêm thứ không hợp.',
    tensions: [
      'Muốn ăn uống lành để tự lo cho mình ↔ quá nhiều lời quảng cáo, không biết tin nguồn nào',
      'Muốn ngủ một giấc tròn ↔ nửa đêm tỉnh giấc, trằn trọc tới sáng',
      'Muốn bớt đồ ngọt, đồ chế biến sẵn ↔ quen vị cũ, ăn nhạt thì mất ngon',
      'Muốn không làm phiền con cháu ↔ đang mỏi mệt nhưng ngại nói vì sợ con lo',
      'Muốn thử thực phẩm tốt cho sức khỏe ↔ lương hưu có hạn, sợ tiền mất mà không thấy gì',
      'Đang làm theo lời bác sĩ ↔ sợ ăn thêm thứ gì đó không hợp với thuốc đang dùng'] },
  { id: 'an-chay', name: 'Người ăn chay, Phật tử, theo thực dưỡng', on: true,
    who: 'Ăn chay trường hoặc ăn chay ngày rằm, mùng 1; nhiều người sinh hoạt ở chùa, đọc về thực dưỡng.',
    want: 'Ăn chay đủ đạm, đủ chất; món chay ngon, thanh nhẹ. Sâu hơn: sống đúng niềm tin, cho người nhà thấy ăn chay vẫn khỏe.',
    block: 'Món chay ngoài hàng nhiều dầu, bột ngọt, đồ giả mặn; ít món, dễ chán; người nhà lo ăn chay thì yếu; chưa biết phối hợp đạm thực vật; nấu riêng tốn thời gian.',
    tensions: [
      'Muốn ăn chay lâu dài ↔ lo thiếu đạm, sắt, B12, người nhà sợ mình yếu',
      'Muốn ăn chay thanh tịnh ↔ món chay ngoài hàng nhiều dầu, bột ngọt, đồ giả mặn',
      'Muốn bữa chay ngon, đổi món ↔ quanh quẩn đậu phụ, rau luộc nên dễ chán',
      'Muốn cả nhà ăn chay cùng ngày rằm ↔ con cháu chê nhạt, phải nấu hai mâm',
      'Muốn sống đúng niềm tin ↔ ngại bị xem là khác người khi đi ăn cùng bạn bè, đồng nghiệp'] },
  { id: 'mua-qua', name: 'Con cái mua quà sức khỏe cho bố mẹ', on: true,
    who: '28–45 tuổi, sống xa bố mẹ hoặc bận rộn; muốn thể hiện sự quan tâm dịp Tết, Vu Lan, 8/3, 20/10, sinh nhật.',
    want: 'Món quà thiết thực, bố mẹ thích và dùng thật. Sâu hơn: là người con chu đáo dù ở xa, bù đắp vì ít về thăm.',
    block: 'Sợ mua nhầm hàng thổi phồng, không rõ nguồn gốc; bố mẹ tiếc tiền, cất đi không dùng; không biết bố mẹ hợp loại nào, có đang dùng thuốc; ngân sách có hạn; không có thời gian đi chọn.',
    tensions: [
      'Muốn biếu bố mẹ món quà sức khỏe thật sự ↔ sợ mua nhầm hàng thổi phồng, không rõ nguồn gốc',
      'Muốn bố mẹ dùng đều quà mình mua ↔ bố mẹ tiếc tiền, cất tủ hoặc đem cho người khác',
      'Ở xa muốn chăm bố mẹ ↔ chỉ gửi được quà, không ở bên nhắc bố mẹ ăn uống',
      'Muốn quà tươm tất để biếu ↔ ngân sách có hạn, không muốn mua hộp quà toàn vỏ'] }
];

/** 3 tầng phễu (khoá content Tuấn Hà): mỗi tầng 1 nguồn giá trị + 1 lối ra */
export const FUN = {
  TOFU: { name: '🔵 TOFU – Nhận biết', rule: 'Giá trị nằm ở CHÍNH NỘI DUNG: kiến thức, mẹo, cảnh đời thường chạm đúng tension, hữu ích kể cả khi người đọc chưa từng nghe tên Thực Dưỡng Lành. Không bán hàng, không giới thiệu sản phẩm (tối đa 1 câu rất nhẹ ở cuối nếu kênh cho phép). Lối ra nhẹ: mời bình luận, chia sẻ, lưu lại, nhận quà, vào nhóm.' },
  MOFU: { name: '⚪ MOFU – Cân nhắc', rule: 'Giá trị là UY TÍN của Thực Dưỡng Lành: giúp người đang tìm giải pháp biết cách chọn, so sánh, hiểu tiêu chí; tạo niềm tin bằng bằng chứng CÓ THẬT trong TÀI LIỆU (nguồn gốc nguyên liệu, nhà máy, hồ sơ công bố, cách làm, đội ngũ, cảm nhận khách thật đã đồng ý chia sẻ). Sản phẩm xuất hiện như 1 lựa chọn gỡ tension, không ép. Lối ra: xem sản phẩm, hỏi tư vấn, nhận quà / ưu đãi.' },
  BOFU: { name: '🟠 BOFU – Mua hàng', rule: 'Giá trị nằm ở SẢN PHẨM / ƯU ĐÃI: 1 sản phẩm cụ thể gỡ đúng tension (ai hợp, dùng lúc nào, cách dùng trong ngày, ai nên hỏi bác sĩ), ưu đãi thật đang chạy nếu có, lý do thật để đặt ngay (không bịa khan hiếm, không bịa khuyến mãi). Lối ra: đúng 1 lời mời đặt hàng (web được kiểm hàng trước khi nhận, freeship đơn từ 300.000đ).' }
};
export const funOf = s => (String(s || '').match(/TOFU|MOFU|BOFU/) || [''])[0];

/* ---------------------------------------------------------------- ngân hàng */
const cut = (s, n) => String(s == null ? '' : s).trim().slice(0, n);
function clean(list) {
  const seen = {};
  return (Array.isArray(list) ? list : []).slice(0, 12).map((g, i) => {
    let id = nrm(g.id || g.name).replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 30) || 'nhom-' + (i + 1);
    while (seen[id]) id += '-2'; seen[id] = 1;
    const tensions = (Array.isArray(g.tensions) ? g.tensions : String(g.tensions || '').split('\n')).map(t => cut(String(t).replace(/^[-•*\d.)\s]+/, ''), 300)).filter(Boolean).slice(0, 20);
    return { id, name: cut(g.name, 80), on: g.on !== false, who: cut(g.who, 800), want: cut(g.want, 800), block: cut(g.block, 800), tensions, note: cut(g.note, 800) };
  }).filter(g => g.name);
}
export async function insBank(x) { const b = await kvJson(x.db, 'ins_bank', null); return b && Array.isArray(b.groups) && b.groups.length ? clean(b.groups) : clean(INS0); }
const live = bank => bank.filter(g => g.on && g.tensions.length);
export function insFind(bank, want) {
  const w = nrm(want); if (!w) return null;
  return bank.find(g => g.id === w || nrm(g.name) === w) || bank.find(g => nrm(g.name).includes(w) || w.includes(nrm(g.name))) || null;
}

/** Nhật ký nội dung đã viết theo nhóm × tension × kênh (kv ins_log, giữ 90 ngày / 600 dòng) */
async function logGet(x) { const l = await kvJson(x.db, 'ins_log', []); return Array.isArray(l) ? l : []; }
export async function insLog(x, ch, rec) {
  try {
    const now = Date.now(), l = (await logGet(x)).filter(r => now - r.at < 90 * DAY && !(rec.ref && r.ch === ch && r.ref === rec.ref)); // viết lại cùng bài → thay dòng cũ
    l.push({ at: now, ch, g: rec.g || '', gn: cut(rec.gn, 80), f: funOf(rec.f), t: cut(rec.t, 300), ref: cut(rec.ref, 60) });
    await kvSet(x.db, 'ins_log', JSON.stringify(l.slice(-600)));
  } catch (e) { console.error('insLog', e.message); }
}

/** Chọn nhóm khách: chỉ định (id / tên) → nhóm đó; không thì nhóm ít được viết nhất ở kênh này trong 14 ngày (hoà → ít nhất mọi kênh → thứ tự trong ngân hàng xoay theo ngày).
 * opt.only = danh sách id được phép (vd fanpage chỉ nói với 1–2 nhóm). Trả { bank, g, recent: tension nhóm này đã dùng 14 ngày qua } */
export async function insPick(x, ch, want, opt) {
  const bank = await insBank(x), on = live(bank), only = opt && Array.isArray(opt.only) && opt.only.length ? opt.only : null;
  const pool = (only ? on.filter(g => only.includes(g.id)) : on).length ? (only ? on.filter(g => only.includes(g.id)) : on) : on;
  const now = Date.now(), log = (await logGet(x)).filter(r => now - r.at < 14 * DAY);
  let g = insFind(bank, want);
  if (!g && pool.length) {
    const n = (k, c) => log.filter(r => r.g === k && (!c || r.ch === c)).length, rot = Math.floor(now / DAY) % pool.length;
    g = pool.map((v, i) => ({ v, a: n(v.id, ch), b: n(v.id), c: (i - rot + pool.length) % pool.length })).sort((p, q) => p.a - q.a || p.b - q.b || p.c - q.c)[0].v;
  }
  const recent = g ? log.filter(r => r.g === g.id).slice(-8).map(r => (CH[r.ch] || r.ch) + ': ' + r.t).filter(s => !/: $/.test(s)) : [];
  return { bank, g, recent };
}

/** Đoạn hướng dẫn gửi AI: bước insight bắt buộc trước khi viết + luật tầng phễu.
 * f = TOFU | MOFU | BOFU (hoặc '' để AI tự chọn tầng hợp nhất); opt.light = bài chúc mừng ngày lễ (tension chỉ để chọn góc chạm, không biến thành bài bán). */
export function insBlock(p, f, opt) {
  opt = opt || {};
  const g = p && p.g, F = FUN[f];
  const grp = g ? ['NHÓM KHÁCH MỤC TIÊU của bài này: ' + g.name + (g.who ? ' – ' + g.who : ''),
    g.want ? 'Họ mong (nói ra được / sâu hơn): ' + g.want : '', g.block ? 'Rào cản: ' + g.block : '', g.note ? 'Ghi chú: ' + g.note : '',
    'Tension đã biết (mong muốn ↔ rào cản):\n' + g.tensions.map(t => '- ' + t).join('\n'),
    p.recent && p.recent.length ? 'Tension nhóm này vừa dùng gần đây (ưu tiên tension KHÁC, hoặc góc khác hẳn):\n' + p.recent.map(t => '- ' + t).join('\n') : ''].filter(Boolean).join('\n')
    : 'NHÓM KHÁCH: tự chọn 1 nhóm trong NGÂN HÀNG INSIGHT bên dưới.\n' + live(p && p.bank || []).map(v => '- ' + v.name + ': ' + v.tensions.slice(0, 4).join(' | ')).join('\n');
  return ['# BƯỚC BẮT BUỘC TRƯỚC KHI VIẾT: INSIGHT → TENSION → PHỄU',
    grp,
    'Làm lần lượt (nghĩ trong đầu, chỉ ghi kết quả vào 3 dòng NHÓM KHÁCH / TENSION / INSIGHT ở phần đầu câu trả lời):',
    '1. Chọn ĐÚNG 1 tension hợp nhất với chủ đề' + (f ? ' và tầng phễu' : '') + ' (được diễn đạt tension mới của cùng nhóm, nhưng phải đủ 2 cực: điều họ mong ↔ điều đang cản họ, trong 1 cảnh đời cụ thể: ai, lúc nào, ở đâu).',
    '2. Insight: nói tension đó bằng lời người trong nhóm, ngôi thứ nhất, 1–2 câu (đây là giả thuyết của người viết, KHÔNG trình bày như lời khách thật).',
    '3. Chọn cách gỡ: cắt bỏ rào cản / giảm rào cản (thời gian, tiền, công sức, rủi ro) / đi vòng rào cản / đổi cách nhìn (không hứa sai sự thật).',
    '4. Viết: câu mở (hook) làm người trong nhóm nhận ra chính mình trong 1–2 giây; thân bài gỡ đúng tension đó; kết bằng đúng 1 lối ra của tầng phễu.',
    opt.light ? 'Bài này là bài theo dịp (chúc mừng / tương tác): giữ đúng chủ đề dịp, tension chỉ dùng để chọn góc chạm gần gũi (1–2 câu), không biến thành bài bán.' : '',
    F ? 'TẦNG PHỄU: ' + F.name + '. ' + F.rule : 'TẦNG PHỄU: tự chọn 1 tầng hợp với tension và chủ đề:\n' + Object.values(FUN).map(v => '- ' + v.name + ': ' + v.rule).join('\n'),
    'Đạo đức: nội dung phải GỠ tension, không khoét sâu nỗi sợ bệnh tật, mặc cảm cơ thể, áp lực gia đình để ép mua; không bịa lời khách, số liệu, khuyến mãi.'
  ].filter(Boolean).join('\n');
}
/** 3 dòng AI phải ghi ở phần đầu (trước ---) */
export const INS_HEAD = 'NHÓM KHÁCH: <tên nhóm khách>\nTENSION: <điều họ mong> ↔ <điều đang cản họ>\nINSIGHT: <1 câu, lời người trong nhóm, ngôi thứ nhất>';
/** Đọc 3 dòng trên từ phần đầu câu trả lời → { gn, t, i, g } (g = id nhóm nếu khớp ngân hàng) */
export function insParse(head, bank, fb) {
  const get = k => ((String(head || '').match(new RegExp('^\\s*\\**' + k + '\\**\\s*:\\s*(.+)$', 'mi')) || [])[1] || '').replace(/\*/g, '').trim();
  const gn = get('NHÓM KHÁCH').slice(0, 120), g = insFind(bank || [], gn) || fb || null; // nhóm đã giao cho AI: AI gọi tên khác đi một chút vẫn tính đúng nhóm
  return { g: g ? g.id : '', gn: g ? g.name : gn, t: get('TENSION').replace(/<->|<=>|->/g, '↔').slice(0, 300), i: get('INSIGHT').replace(/^["“']|["”']$/g, '').slice(0, 300) };
}
/** Thẻ ngắn hiện ở CRM: "🎯 Nhóm · tension" */
export const insTag = o => o && (o.gn || o.t) ? '🎯 ' + [o.gn, o.t].filter(Boolean).join(' · ') : '';

/** Bản tóm tắt ngân hàng + quy trình (MCP cho ChatGPT / Gemini / Claude bên ngoài, và cho nhân sự copy) */
export async function insText(x) {
  const bank = await insBank(x);
  return ['QUY TRÌNH NỘI DUNG THỰC DƯỠNG LÀNH: Insight → Tension → Phễu (TOFU / MOFU / BOFU). Mọi bài web, bài nhóm Zalo, Fanpage, kịch bản video đều làm theo:',
    '1. Chọn 1 nhóm khách mục tiêu và 1 tension (điều họ mong ↔ điều đang cản họ, trong 1 cảnh cụ thể).',
    '2. Viết insight bằng lời khách (giả thuyết, không phải lời khách thật).',
    '3. Chọn tầng phễu và lối ra:', ...Object.values(FUN).map(v => '   ' + v.name + ': ' + v.rule),
    '4. Viết: hook chạm tension trong 1–2 giây → gỡ tension → 1 lối ra. Không dùng "chữa / điều trị / khỏi bệnh"; nhắc sản phẩm thì có dòng "Sản phẩm là thực phẩm, không phải là thuốc và không có tác dụng thay thế thuốc chữa bệnh."',
    '', 'NGÂN HÀNG INSIGHT (nhóm khách mục tiêu):',
    ...bank.map(g => ['## ' + g.name + (g.on ? '' : ' (đang tạm tắt)'), g.who, 'Mong muốn: ' + g.want, 'Rào cản: ' + g.block, 'Tension:', ...g.tensions.map(t => '- ' + t), g.note ? 'Ghi chú: ' + g.note : ''].filter(Boolean).join('\n'))].join('\n');
}

/* ---------------------------------------------------------------- 🎬 kịch bản video */
let schemaOk = false;
async function schema(db) {
  if (schemaOk) return;
  await run(db, `CREATE TABLE IF NOT EXISTS vd_scripts (id INTEGER PRIMARY KEY AUTOINCREMENT, at INTEGER, by_name TEXT DEFAULT '', g TEXT DEFAULT '', gn TEXT DEFAULT '', f TEXT DEFAULT '',
    t TEXT DEFAULT '', i TEXT DEFAULT '', prod TEXT DEFAULT '', sec INTEGER DEFAULT 60, kind TEXT DEFAULT '', title TEXT DEFAULT '', text TEXT DEFAULT '', hint TEXT DEFAULT '')`);
  schemaOk = true;
}
const KIND = { noi: 'Người thật nói trước máy (nhân viên / chuyên viên tư vấn quay bằng điện thoại)', canh: 'Quay cảnh (pha, nấu, nguyên liệu, sinh hoạt) + giọng đọc, không cần lộ mặt', chu: 'Không quay: ảnh có sẵn + chữ trên màn hình + giọng đọc' };
let client = null;
function ai(env) { if (!client) client = new Anthropic({ apiKey: env.ANTHROPIC_API_KEY, maxRetries: 1, timeout: 120e3, fetch: aiFetch(env), defaultHeaders: { 'x-tdl-muc': 'video' } }); return client; }
const textOf = res => res.content.filter(b => b.type === 'text').map(b => b.text).join('\n').trim();

async function vdWrite(x, u, d) {
  if (!x.env.ANTHROPIC_API_KEY) return { ok: false, error: 'Máy chủ chưa có khoá AI.' };
  await schema(x.db);
  const sec = [15, 30, 45, 60, 90].includes(Number(d.sec)) ? Number(d.sec) : 60, kind = KIND[d.kind] ? d.kind : 'noi', f = funOf(d.f), hint = cut(d.hint, 1000);
  const p = await insPick(x, 'video', cut(d.g, 80)), know = await kb(), prods = prodMap(know), pc = prods[cut(d.prod, 80)] ? cut(d.prod, 80) : '';
  if (!p.g && !live(p.bank).length) return { ok: false, error: 'Ngân hàng insight chưa có nhóm khách nào đang bật.' };
  const scenes = sec <= 30 ? '4–6' : sec <= 60 ? '6–9' : '8–12';
  const ask = [
    'Viết 1 kịch bản video ngắn dọc 9:16 (TikTok, Facebook Reels, YouTube Shorts) cho Thực Dưỡng Lành, dài khoảng ' + sec + ' giây (lời thoại ~' + Math.round(sec * 2.6) + ' chữ).',
    'Kiểu video: ' + KIND[kind] + '.',
    pc ? 'Sản phẩm muốn nhắc: ' + prods[pc].name + ' (mã ' + pc + ').' : 'Sản phẩm: tự chọn nếu tầng phễu cần (MOFU / BOFU), TOFU thì không nhắc sản phẩm.',
    hint ? 'Yêu cầu thêm của nhân sự: ' + hint : '',
    '',
    insBlock(p, f),
    '',
    '# Cách viết kịch bản',
    '- Theo AIDA: Attention (hook 0–3 giây chạm đúng tension) → Interest (cảnh đời / vì sao kẹt) → Desire (cách gỡ, lối đi khả thi) → Action (đúng 1 lối ra của tầng phễu).',
    '- Lời thoại nói tự nhiên như người thật, câu ngắn, xưng "mình" hoặc "em", gọi người xem "bạn" / "anh chị" / "cô chú" hợp với nhóm khách. Không đọc như quảng cáo.',
    '- Mỗi cảnh 2–8 giây, ' + scenes + ' cảnh, tổng thời lượng đúng ' + sec + ' giây. Chữ trên màn hình ngắn (tối đa 8 chữ / cảnh), nhấn từ khoá.',
    '- Hình ảnh quay được bằng điện thoại, đồ dùng sẵn có (bếp, bàn làm việc, sản phẩm thật). Nguồn hình: "quay mới", "ảnh sản phẩm có sẵn", "ảnh minh hoạ tự vẽ".',
    '- Đúng sự thật: thông tin sản phẩm, thành phần, giá, ưu đãi CHỈ lấy từ TÀI LIỆU. Không số liệu nghiên cứu, không trích chuyên gia, không bịa lời khách / trước–sau.',
    '- Không dùng "chữa", "điều trị", "khỏi bệnh", "đặc trị", "thay thuốc", "thần dược". Có nhắc sản phẩm thì cảnh cuối có chữ nhỏ "Sản phẩm là thực phẩm, không phải là thuốc và không có tác dụng thay thế thuốc chữa bệnh."',
    '',
    'Trả về ĐÚNG định dạng (không lời dẫn):',
    'TIÊU ĐỀ: <tên video, tối đa 12 chữ>\n' + INS_HEAD + '\nTẦNG PHỄU: <TOFU | MOFU | BOFU>\nSẢN PHẨM: <mã sản phẩm hoặc "không">\n---',
    '🎯 HOOK 3 GIÂY (3 phương án để quay thử, mỗi dòng 1 câu)\n1. …\n2. …\n3. …',
    '',
    '🎬 KỊCH BẢN (bảng 6 cột, mỗi cảnh 1 dòng, cột Cảnh ghi số + phần AIDA, vd "1 · A"):\n| Cảnh | Thời lượng | Hình ảnh | Lời thoại | Chữ trên màn hình | Nguồn hình |\n|---|---|---|---|---|---|',
    '',
    '📝 CAPTION đăng kèm (2–4 câu, kết bằng lối ra) + 3–5 hashtag',
    '',
    '💡 GHI CHÚ QUAY (2–4 gạch đầu dòng: góc máy, ánh sáng, đạo cụ)'
  ].join('\n');
  const req = { model: WRITER, max_tokens: 6000, output_config: { effort: 'medium' },
    system: [{ type: 'text', text: 'Bạn là biên kịch video ngắn của Thực Dưỡng Lành (VitaGreen Nutrition): thực phẩm dinh dưỡng từ hạt, trà thảo mộc, đồ chay. Tiếng Việt chuẩn, tự nhiên, đúng luật quảng cáo thực phẩm Việt Nam.\n' + TRUTH_RULES },
      { type: 'text', text: 'TÀI LIỆU (thông tin chính thức của Thực Dưỡng Lành):\n\n' + know, cache_control: { type: 'ephemeral' } }],
    messages: [{ role: 'user', content: ask }] };
  let res; // bị bộ lọc an toàn từ chối nhầm → máy chủ Anthropic tự chuyển mô hình dự phòng (như zbot.js); tham số này lỗi thì gọi lại không kèm
  try { res = await ai(x.env).beta.messages.create(Object.assign({ betas: ['server-side-fallback-2026-07-01'], fallbacks: 'default' }, req)); }
  catch (e) { if (!(e instanceof Anthropic.BadRequestError)) throw e; res = await ai(x.env).messages.create(req); }
  if (res.stop_reason === 'refusal') return { ok: false, error: 'AI từ chối viết kịch bản này, thử đổi yêu cầu.' };
  const raw = textOf(res), parts = raw.split(/\n-{3,}\n/), head = parts.length > 1 ? parts[0] : '';
  const text = safe((parts.length > 1 ? parts.slice(1).join('\n---\n') : raw).trim());
  if (text.length < 200) return { ok: false, error: 'AI chưa viết được kịch bản, bấm viết lại nhé.' };
  const get = k => ((head.match(new RegExp(k + ':\\s*(.+)')) || [])[1] || '').replace(/\*/g, '').trim();
  const ins = insParse(head, p.bank, p.g), ff = funOf(get('TẦNG PHỄU')) || f || 'TOFU', code = (get('SẢN PHẨM').match(/[a-z0-9-]+/) || [''])[0];
  const title = get('TIÊU ĐỀ').slice(0, 120) || 'Kịch bản ' + sec + ' giây';
  const r = await run(x.db, 'INSERT INTO vd_scripts (at, by_name, g, gn, f, t, i, prod, sec, kind, title, text, hint) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
    Date.now(), u.name, ins.g, ins.gn, ff, ins.t, ins.i, prods[code] ? code : pc, sec, kind, title, text.slice(0, 20000), hint);
  const id = r && r.meta && r.meta.last_row_id;
  await insLog(x, 'video', { g: ins.g, gn: ins.gn, f: ff, t: ins.t, ref: 'vd' + id });
  return { ok: true, id, script: await first(x.db, 'SELECT * FROM vd_scripts WHERE id = ?', id) };
}

/* ---------------------------------------------------------------- CRM → tab 🎯 Insight & nội dung (Marketing, Quản lý, Quản trị, người phụ trách Trợ lý Zalo) */
export function canIns(u) { return !!u && (u.level >= 2 || u.role === 'Marketing' || !!u.zb || !!u.web); }
export async function crmIns(x, u, d, crmLog) {
  if (!canIns(u)) return { ok: false, error: 'Bạn chưa có quyền dùng tab Insight & nội dung. Nhờ Quản trị cấp quyền Marketing hoặc tích ô phụ trách trợ lý.' };
  await schema(x.db);
  const a = d.action, now = Date.now();
  if (a === 'ins_view') {
    const bank = await insBank(x), custom = !!await kvJson(x.db, 'ins_bank', null), log = (await logGet(x)).filter(r => now - r.at < 30 * DAY);
    const scripts = await all(x.db, 'SELECT id, at, by_name, g, gn, f, t, i, prod, sec, kind, title, text FROM vd_scripts ORDER BY id DESC LIMIT 30');
    const prods = Object.entries(prodMap(await kb())).map(([k, v]) => ({ code: k, name: v.name }));
    return { ok: true, now, bank, custom, log: log.slice(-300), scripts, prods, aiOn: !!x.env.ANTHROPIC_API_KEY, fun: Object.fromEntries(Object.entries(FUN).map(([k, v]) => [k, v.name])) };
  }
  if (a === 'ins_save') {
    if (u.level < 2 && u.role !== 'Marketing') return { ok: false, error: 'Chỉ Marketing, Quản lý, Quản trị sửa được ngân hàng insight.' };
    if (d.reset) { await kvDel(x.db, 'ins_bank'); await crmLog(x, u, 'Insight & nội dung', '-', '', 'Dùng lại ngân hàng insight mặc định', ''); return { ok: true, bank: await insBank(x) }; }
    const groups = clean(d.groups);
    if (!groups.length) return { ok: false, error: 'Cần ít nhất 1 nhóm khách có tên.' };
    if (!groups.some(g => g.on && g.tensions.length)) return { ok: false, error: 'Cần ít nhất 1 nhóm đang bật và có tension.' };
    await kvSet(x.db, 'ins_bank', JSON.stringify({ groups, by: u.name, at: now }));
    await crmLog(x, u, 'Insight & nội dung', '-', '', 'Sửa ngân hàng insight', groups.map(g => g.name + ' (' + g.tensions.length + ')').join(', ').slice(0, 300));
    return { ok: true, bank: groups };
  }
  if (a === 'ins_video') {
    const r = await vdWrite(x, u, d);
    if (r.ok) await crmLog(x, u, 'Insight & nội dung', '-', '', 'Viết kịch bản video', (r.script && r.script.title || '').slice(0, 200));
    return r;
  }
  if (a === 'ins_vdel') { await run(x.db, 'DELETE FROM vd_scripts WHERE id = ?', Number(d.id) || 0); return { ok: true }; }
  return { ok: false, error: 'Không rõ thao tác.' };
}
