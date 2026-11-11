/* ================================================================ 📈 Học từ số tương tác thật (11/11/2026, khoá content K131 đợt 2, anh Sơn duyệt)
 * Khoá học: giữ "file bài thành công" + "file bài thất bại", cho AI xem mỗi ngày → AI hiểu khán giả thật (thầy đạt ~80% bài lên xu hướng).
 * Ở đây: lấy bài đã đăng 60 ngày (bỏ bài < 2 ngày vì số chưa đủ, bỏ bài chúc dịp lễ ở Zalo), xếp theo điểm tương tác của từng kênh:
 *   💬 Nhóm Zalo (zb_posts): người tương tác × 3 + tin nhắn + cảm xúc (số do trợ lý Zalo trên VPS gửi về).
 *   📘 Fanpage (fp_posts): cảm xúc + bình luận × 3 + chia sẻ × 5 (fb.js fpEng lấy từ Facebook mỗi ngày 1 lần).
 * → 3 bài nhiều nhất (NÊN HỌC) + 3 bài ít nhất (NÊN TRÁNH), cần ≥ 6 bài có số mới so sánh. Bài web, video, bài Facebook cá nhân học chung từ cả 2 kênh.
 * Dùng ở: insPick (insight.js) gắn p.learn → insBlock chèn lrnBlock vào prompt; CRM 🎯 Insight & nội dung → 📈 Học từ tương tác (ins_view.learn). */
import { all, DAY } from './lib.js';

const cut = (s, n) => String(s == null ? '' : s).replace(/\s+/g, ' ').trim().slice(0, n);
const insOf = s => { try { return JSON.parse(s || '{}') || {}; } catch (e) { return {}; } };
export const LRN_MIN = 6;

async function rowsOf(x, ch, since, until) {
  try {
    if (ch === 'zalo') return (await all(x.db, "SELECT id, sent_at, text, funnel, ins, eng_people, eng_msgs, eng_reacts FROM zb_posts WHERE status = 'sent' AND sent_at BETWEEN ? AND ? AND COALESCE(ev, '') = ''", since, until))
      .map(r => ({ ch, id: r.id, at: r.sent_at, f: r.funnel || '', ins: insOf(r.ins), text: r.text, s: (r.eng_people || 0) * 3 + (r.eng_msgs || 0) + (r.eng_reacts || 0), m: (r.eng_people || 0) + ' người tương tác, ' + (r.eng_msgs || 0) + ' tin nhắn' }));
    if (ch === 'fb') return (await all(x.db, "SELECT id, sent_at, text, funnel, ins, eng_react, eng_cmt, eng_share FROM fp_posts WHERE status = 'sent' AND eng_at > 0 AND sent_at BETWEEN ? AND ?", since, until))
      .map(r => ({ ch, id: r.id, at: r.sent_at, f: r.funnel || '', ins: insOf(r.ins), text: r.text, s: (r.eng_react || 0) + (r.eng_cmt || 0) * 3 + (r.eng_share || 0) * 5, m: (r.eng_react || 0) + ' cảm xúc, ' + (r.eng_cmt || 0) + ' bình luận, ' + (r.eng_share || 0) + ' chia sẻ' }));
  } catch (e) { } // bảng chưa có (kênh chưa dùng lần nào)
  return [];
}
const pack = r => ({ ch: r.ch, id: r.id, at: r.at, f: r.f, s: r.s, m: r.m, gn: cut(r.ins.gn, 80), t: cut(r.ins.t, 200), a: cut(r.ins.a, 120), text: cut(r.text, 420) });

/** { ch: { n, top[], flop[] } } cho từng kênh có đủ bài. ch = 'zalo' | 'fb' → chỉ kênh đó; kênh khác → cả 2. */
export async function lrnPosts(x, ch) {
  const now = Date.now(), since = now - 60 * DAY, until = now - 2 * DAY, out = {};
  for (const c of ch === 'zalo' || ch === 'fb' ? [ch] : ['zalo', 'fb']) {
    const R = (await rowsOf(x, c, since, until)).sort((a, b) => b.s - a.s);
    if (R.length < LRN_MIN || R[0].s <= 0) continue;
    out[c] = { n: R.length, top: R.slice(0, 3).map(pack), flop: R.slice(-3).reverse().map(pack) };
  }
  return out;
}

const CHN = { zalo: 'Nhóm Zalo', fb: 'Fanpage' };
/** Đoạn chèn vào prompt (rỗng nếu chưa đủ số) */
export function lrnBlock(L) {
  const ks = Object.keys(L || {}); if (!ks.length) return '';
  const one = r => '- [' + CHN[r.ch] + ' · ' + r.m + (r.a ? ' · góc kể: ' + r.a : '') + (r.f ? ' · ' + r.f : '') + '] ' + r.text;
  return ['📈 HỌC TỪ SỐ TƯƠNG TÁC THẬT (bài đã đăng 60 ngày qua; đây là DỮ LIỆU để học, KHÔNG chép câu chữ, KHÔNG lặp lại chủ đề):',
    'Bài NHIỀU người hưởng ứng nhất: học cách mở bài, nhịp câu, độ dài, góc kể, cách mời tương tác:', ...ks.flatMap(k => L[k].top.map(r => one(r))),
    'Bài ÍT người hưởng ứng nhất: tránh kiểu mở bài, độ dài, góc kể, cách viết giống các bài này:', ...ks.flatMap(k => L[k].flop.map(r => one(r)))].join('\n');
}
