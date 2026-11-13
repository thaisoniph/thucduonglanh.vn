/* ================================================================ ☀️ Lời chúc mỗi ngày (14/11/2026, anh Sơn)
 * Ai đăng nhập CRM cũng thấy "Chào buổi sáng, <tên>" + 1 câu chúc ở đầu màn hình đầu tiên. Cả công ty cùng 1 câu / ngày (giống 🌿 Quy tắc của ngày)
 * để mọi người có chuyện nói với nhau. Thứ tự ưu tiên: ngày lễ / rằm / mùng 1 (lịch zday.js) → thứ Hai → thứ Bảy → Chủ nhật → ngày thường.
 * Câu chúc ấm áp, 1 dòng, không nhắc doanh số / tiền / bán hàng. Quản trị sửa ở Cài đặt → 👥 Nhân sự → 🌿 Văn hoá (kv 'vh_wish': mỗi ô 1 câu / dòng, ô trống = câu gốc).
 * Không dùng AI → không tốn tiền. Gửi kèm lệnh vh_today (vanhoa.js). */
import { kvJson, kvSet, fmtDate, DAY } from './lib.js';
import { eventsAhead } from './zday.js';

export const WISH0 = {
  daily: [
    'Chúc bạn một ngày nhẹ nhàng, mỗi cuộc trò chuyện hôm nay đều mang lại một nụ cười 🌿',
    'Chúc bạn hôm nay thật khoẻ, thật vui và làm việc gì cũng suôn sẻ ☀️',
    'Một tách trà ấm, một nụ cười tươi, chúc bạn bắt đầu ngày mới thật nhiều năng lượng 🍵',
    'Chúc bạn hôm nay được lắng nghe, được thấu hiểu và được yêu thương 💚',
    'Mỗi ngày một việc tử tế nhỏ thôi cũng đủ làm thế giới đẹp hơn. Chúc bạn một ngày an lành 🌱',
    'Chúc bạn hôm nay bình tâm, việc khó cũng hoá nhẹ khi mình mỉm cười 😊',
    'Hôm nay là một trang mới. Chúc bạn viết lên đó thật nhiều điều đáng nhớ 📖',
    'Chúc bạn có một ngày đủ đầy: đủ sức khoẻ, đủ niềm vui và đủ những người thương bên cạnh 🌼',
    'Hít một hơi thật sâu, uống một cốc nước ấm, rồi mình cùng bắt đầu nhé. Chúc bạn ngày mới vui vẻ 💧',
    'Chúc bạn hôm nay gặp toàn người dễ thương và chuyện dễ chịu 🌸',
    'Sức khoẻ là món quà quý nhất. Chúc bạn và gia đình luôn mạnh khoẻ, bình an 🍀',
    'Chúc bạn một ngày làm việc tập trung, xong việc sớm và về nhà thật vui 🏡',
    'Người ta nhớ cách mình làm họ cảm thấy. Chúc bạn hôm nay lan toả thật nhiều điều ấm áp 🤝',
    'Chúc bạn hôm nay tự hào về chính mình, dù chỉ vì một việc nhỏ làm thật tốt ⭐',
    'Trời có thể nắng hay mưa, mong lòng bạn luôn trong xanh. Chúc bạn một ngày an vui 🌤️',
    'Chúc bạn hôm nay học được một điều mới và kể lại cho đồng đội cùng nghe 📚',
    'Mỗi cuộc gọi là một người được quan tâm. Chúc bạn một ngày gieo thật nhiều yêu thương 📞',
    'Chúc bạn ăn sáng ngon miệng, làm việc hăng say và ngủ thật ngon tối nay 🌙',
    'Chậm lại một chút, mỉm cười nhiều hơn một chút. Chúc bạn một ngày thật bình yên 🍃',
    'Chúc bạn hôm nay có thật nhiều khoảnh khắc khiến mình mỉm cười 😄',
    'Cảm ơn bạn đã có mặt ở đây hôm nay. Chúc bạn một ngày thật nhiều niềm vui 💐',
    'Chúc bạn giữ được sự kiên nhẫn và lòng tử tế, vì đó là điều làm nên một ngày đẹp 🌻',
    'Mỗi bước nhỏ hôm nay đều đưa mình đến gần mục tiêu hơn. Chúc bạn vững vàng và vui vẻ 👣',
    'Chúc bạn hôm nay được tiếp thêm năng lượng từ những người xung quanh, và tiếp lại năng lượng cho họ ✨',
    'Một ngày mới, một cơ hội mới để sống lành hơn. Chúc bạn luôn khoẻ mạnh 🥗',
    'Chúc bạn có một ngày nhẹ đầu, vui tim và việc nào cũng trôi chảy 💫',
    'Đừng quên uống đủ nước và đứng dậy vươn vai nhé. Chúc bạn một ngày thật khoẻ 🙆',
    'Chúc bạn hôm nay nói lời hay, nghe lời thật và làm việc tốt 🌿',
    'Niềm vui nhân đôi khi được chia sẻ. Chúc bạn có một ngày thật nhiều chuyện vui để kể 🎈',
    'Chúc bạn hôm nay luôn bình tĩnh trước khó khăn và biết ơn trước những điều tốt đẹp 🙏',
    'Chúc bạn một ngày mà khi nhìn lại, bạn thấy mình đã sống thật trọn vẹn 🌅',
    'Gửi bạn một nụ cười buổi sáng 😊 Chúc bạn hôm nay mọi sự hanh thông',
    'Chúc bạn hôm nay được làm điều mình giỏi nhất và được ghi nhận xứng đáng 🏅',
    'Lành từ bữa ăn, lành từ suy nghĩ, lành từ cách mình đối xử với nhau. Chúc bạn một ngày Sống Lành 🌱',
    'Chúc bạn hôm nay có đủ thời gian cho công việc và cả cho chính mình 🕊️',
    'Một lời cảm ơn, một lời khen thật lòng có thể làm sáng cả ngày của ai đó. Chúc bạn một ngày ấm áp 💛',
    'Chúc bạn hôm nay khoẻ từ bên trong, vui từ trong lòng và tươi tắn ra bên ngoài 🌺',
    'Chúc bạn một ngày không vội, không lo, chỉ có sự tập trung và niềm vui 🍵',
    'Hôm qua là bài học, hôm nay là món quà. Chúc bạn trân trọng từng phút giây 🎁',
    'Chúc bạn hôm nay được ai đó nói lời cảm ơn, và bạn cũng nói lời cảm ơn với ai đó 🤗',
    'Chúc bạn có một ngày tràn đầy cảm hứng, ý tưởng hay cứ thế mà đến 💡',
    'Mỗi người mình chăm sóc đều là một gia đình được khoẻ hơn. Chúc bạn một ngày thật ý nghĩa 💚',
    'Chúc bạn hôm nay tâm an, thân khoẻ, việc thuận 🌿',
    'Cùng nhau thì việc gì cũng nhẹ hơn. Chúc cả nhà mình một ngày làm việc thật ăn ý 🤝',
    'Chúc bạn hôm nay mỉm cười với cả những điều chưa như ý, vì ngày mai sẽ tốt hơn 🌈',
    'Chúc bạn một ngày nhiều nắng ấm trong lòng, dù ngoài trời có ra sao ☀️',
    'Hãy dịu dàng với chính mình hôm nay nhé. Chúc bạn một ngày thật thong thả 🌸',
    'Chúc bạn hôm nay hoàn thành việc quan trọng nhất trước tiên, rồi thảnh thơi tận hưởng phần còn lại ✅',
    'Có bạn là một may mắn của cả đội. Chúc bạn một ngày thật vui 🍀',
    'Chúc bạn hôm nay ăn ngon, ngủ đủ, cười nhiều và lo ít 😊',
    'Điều tốt mình làm hôm nay, ngày mai sẽ quay về với mình. Chúc bạn một ngày gieo hạt lành 🌾',
    'Chúc bạn có một ngày mà mỗi việc nhỏ đều được làm bằng cả trái tim 💗',
    'Chúc bạn hôm nay được bình yên giữa bộn bề, được vui vẻ giữa bận rộn 🍃',
    'Sáng nay trời đẹp, mong lòng bạn cũng đẹp như vậy. Chúc bạn một ngày an lành 🌤️',
    'Chúc bạn hôm nay vững tin vào chính mình. Bạn làm được nhiều hơn bạn nghĩ đấy 💪',
    'Chúc bạn một ngày được đồng đội nâng đỡ và được khách hàng tin yêu 💚',
    'Mỗi ngày khoẻ hơn một chút, vui hơn một chút, tử tế hơn một chút. Chúc bạn một ngày như thế 🌱',
    'Chúc bạn hôm nay nhận được một tin vui bất ngờ 🎉',
    'Chúc bạn hôm nay giữ được nụ cười từ sáng đến tối, và mang nó về nhà cho người thân 🏡',
    'Cảm ơn bạn vì đã chăm chỉ mỗi ngày. Chúc bạn hôm nay thật nhiều sức khoẻ và niềm vui 🌻'
  ],
  mon: [
    'Chào tuần mới! Chúc bạn một tuần thật khoẻ, thật vui và thật nhiều điều tốt đẹp 🌱',
    'Thứ Hai là trang đầu của một tuần mới. Chúc bạn mở đầu thật nhẹ nhàng và đầy năng lượng ☀️',
    'Chúc bạn một tuần mới vững vàng: mỗi ngày một bước nhỏ, cuối tuần nhìn lại thấy tự hào ⭐',
    'Tuần mới, năng lượng mới! Chúc bạn và cả đội một tuần làm việc thật ăn ý 🤝',
    'Chúc bạn một tuần mới bình an, sức khoẻ dồi dào và gặp nhiều may mắn 🍀',
    'Đầu tuần uống một cốc nước ấm, đặt một mục tiêu nhỏ rồi bắt đầu nhé. Chúc bạn tuần mới thật vui 💧'
  ],
  sat: [
    'Thứ Bảy rồi! Cảm ơn bạn đã đồng hành cả tuần. Chúc bạn một ngày làm việc nhẹ nhàng và một cuối tuần thật ấm áp 🏡',
    'Chúc bạn khép lại tuần làm việc thật trọn vẹn và có một ngày Chủ nhật nghỉ ngơi thật trọn vẹn 🌿',
    'Cuối tuần rồi, mình cùng nhìn lại một điều làm tốt trong tuần nhé. Chúc bạn một thứ Bảy vui vẻ 😊',
    'Chúc bạn một thứ Bảy thật thong thả, và hẹn gặp lại bạn sau một ngày nghỉ thật khoẻ 🍵',
    'Một tuần đã qua với bao cố gắng. Chúc bạn tối nay được quây quần bên người thương 💛',
    'Chúc bạn một ngày cuối tuần nhiều niềm vui và một buổi trà đàm thật ấm cúng 🍵'
  ],
  sun: [
    'Chủ nhật mà bạn vẫn có mặt, cảm ơn bạn nhiều lắm! Chúc bạn một ngày nhẹ nhàng và được nghỉ ngơi thật xứng đáng 💚',
    'Chúc bạn một Chủ nhật bình yên, có thời gian cho gia đình và cho chính mình 🏡',
    'Chủ nhật là ngày nạp năng lượng. Chúc bạn ăn ngon, ngủ đủ và thật thảnh thơi 🌿'
  ]
};

/** Câu chúc cho ngày lễ (id theo lịch zday.js). Không có trong đây thì dùng câu chung "Hôm nay là <tên dịp>…". */
const OCC = {
  tet: 'Chúc mừng năm mới! Chúc bạn và gia đình một năm an khang, mạnh khoẻ, sum vầy và vạn sự như ý 🧧',
  tao: 'Hôm nay 23 tháng Chạp, Tết đã gần lắm rồi. Chúc bạn một ngày làm việc nhẹ nhàng và một năm cũ khép lại thật trọn vẹn 🏮',
  nguyentieu: 'Hôm nay Rằm tháng Giêng. Chúc bạn một năm mới bình an, mọi việc hanh thông 🌕',
  gioto: 'Hôm nay Giỗ Tổ Hùng Vương. Uống nước nhớ nguồn, chúc bạn và gia đình luôn bình an, đủ đầy 🇻🇳',
  phatdan: 'Hôm nay Lễ Phật đản. Chúc bạn tâm an, thân khoẻ và lan toả thật nhiều điều thiện lành 🪷',
  doanngo: 'Hôm nay Tết Đoan Ngọ. Chúc bạn và gia đình luôn khoẻ mạnh, bình an 🍑',
  vulan: 'Hôm nay Lễ Vu Lan. Chúc bạn có thời gian gọi điện hỏi thăm, ôm cha mẹ thật lâu 🌹',
  trungthu: 'Tết Trung thu rồi! Chúc bạn một tối trăng tròn sum vầy bên gia đình 🥮',
  mung1: 'Hôm nay mùng 1 âm lịch. Chúc bạn một tháng mới bình an, khoẻ mạnh và nhiều niềm vui 🌙',
  ram: 'Hôm nay ngày rằm. Chúc bạn một ngày tâm an, thân khoẻ, mọi việc thuận hoà 🌕',
  hanguyen: 'Hôm nay Rằm tháng Mười. Chúc bạn một ngày tâm an, thân khoẻ, mọi việc thuận hoà 🌕',
  tetduong: 'Chúc mừng năm mới! Chúc bạn một năm mới thật nhiều sức khoẻ, niềm vui và những bước tiến mới 🎆',
  thaythuoc: 'Hôm nay Ngày Thầy thuốc Việt Nam. Chúc bạn luôn khoẻ, và gửi lời cảm ơn tới những người đã chăm lo sức khoẻ cho mình 🩺',
  pn83: 'Chúc mừng ngày Quốc tế Phụ nữ 8/3! Chúc các chị em luôn xinh đẹp, khoẻ mạnh và hạnh phúc 💐',
  le304: 'Chúc bạn một kỳ nghỉ lễ 30/4 – 1/5 thật vui, thật khoẻ bên gia đình 🇻🇳',
  thieunhi: 'Hôm nay Quốc tế Thiếu nhi 1/6. Chúc bạn giữ mãi trái tim trong trẻo, và chúc các bạn nhỏ nhà mình thật vui 🎈',
  giadinh: 'Hôm nay Ngày Gia đình Việt Nam. Chúc bạn tối nay có một bữa cơm thật ấm cúng bên người thân 🏡',
  tbls: 'Hôm nay Ngày Thương binh – Liệt sĩ 27/7. Cùng tri ân những người đã hy sinh vì Tổ quốc. Chúc bạn một ngày bình an 🕯️',
  quockhanh: 'Chúc mừng Quốc khánh 2/9! Chúc bạn một kỳ nghỉ vui, khoẻ và đầy tự hào 🇻🇳',
  pn2010: 'Chúc mừng ngày Phụ nữ Việt Nam 20/10! Chúc các chị em luôn rạng rỡ, khoẻ mạnh và được yêu thương 🌹',
  nhagiao: 'Hôm nay Ngày Nhà giáo Việt Nam 20/11. Chúc bạn một ngày nhớ về những người thầy, người cô đã dạy mình nên người 📚',
  noel: 'Giáng sinh an lành! Chúc bạn một mùa lễ ấm áp và thật nhiều niềm vui 🎄'
};

const EPOCH = Date.UTC(2026, 10, 14); // 14/11/2026 = câu đầu tiên
const LISTS = ['daily', 'mon', 'sat', 'sun'];

/** Bản đang dùng: Quản trị đã sửa (kv 'vh_wish') thì lấy, ô trống thì lấy câu gốc. */
export async function wishes(db) {
  const o = await kvJson(db, 'vh_wish', null), r = {};
  for (const k of LISTS) { const L = o && Array.isArray(o[k]) ? o[k].map(s => String(s || '').trim()).filter(Boolean) : []; r[k] = L.length ? L : WISH0[k]; }
  return r;
}

/** Câu chúc hôm nay (cả công ty như nhau): { day, t, occ? }. */
export async function wishOfDay(db, t) {
  const day = fmtDate(t || Date.now(), 'yyyy-MM-dd'), [y, m, d] = day.split('-').map(Number), ut = Date.UTC(y, m - 1, d);
  const n = Math.max(0, Math.round((ut - EPOCH) / DAY)), wd = new Date(ut).getUTCDay();
  let ev = null; try { ev = eventsAhead(day.replace(/-/g, ''), 1)[0] || null; } catch (e) { }
  if (ev) return { day, t: OCC[ev.id] || ('Hôm nay là ' + ev.n + '. Chúc bạn một ngày thật vui và bình an 🌿'), occ: ev.n };
  const W = await wishes(db), L = wd === 1 ? W.mon : wd === 6 ? W.sat : wd === 0 ? W.sun : W.daily;
  return { day, t: L[Math.floor(wd === 1 || wd === 6 || wd === 0 ? n / 7 : n) % L.length] };
}

/** Quản trị sửa: d.wish = { daily: [..], mon: [..], sat: [..], sun: [..] }. Danh sách trống hoặc giống hệt bản gốc = dùng bản gốc. */
export async function wishSave(db, d) {
  const src = d && d.wish || {}, o = {};
  for (const k of LISTS) {
    const L = (Array.isArray(src[k]) ? src[k] : String(src[k] || '').split('\n')).map(s => String(s || '').replace(/\s+/g, ' ').trim().slice(0, 300)).filter(Boolean).slice(0, 400);
    o[k] = L.join('\n') === WISH0[k].join('\n') ? [] : L;
  }
  await kvSet(db, 'vh_wish', JSON.stringify(o));
}
