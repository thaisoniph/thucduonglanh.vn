/* ================================================================ 📈 Học từ số tương tác thật (11/11/2026, khoá content K131 đợt 2, anh Sơn duyệt)
 * Khoá học: giữ "file bài thành công" + "file bài thất bại", cho AI xem mỗi ngày → AI hiểu khán giả thật (thầy đạt ~80% bài lên xu hướng).
 * Ở đây: lấy bài đã đăng 60 ngày (bỏ bài < 2 ngày vì số chưa đủ, bỏ bài chúc dịp lễ ở Zalo), xếp theo điểm tương tác của từng kênh:
 *   💬 Nhóm Zalo (zb_posts): người tương tác × 3 + tin nhắn + cảm xúc (số do trợ lý Zalo trên VPS gửi về).
 *   📘 Fanpage (fp_posts): cảm xúc + bình luận × 3 + chia sẻ × 5 (fb.js fpEng lấy từ Facebook mỗi ngày 1 lần).
 * → 3 bài nhiều nhất (NÊN HỌC) + 3 bài ít nhất (NÊN TRÁNH), cần ≥ 6 bài có số mới so sánh. Bài web, video, bài Facebook cá nhân học chung từ cả 2 kênh.
 * 11/11/2026 (khoá K133): CHỈ SO TRONG CÙNG TẦNG PHỄU. Bài MOFU (tạo niềm tin) vốn ít tương tác nhưng bắt buộc phải có (~91% người thấy bài là người lạ, vào trang để "thẩm định"),
 *   bài BOFU đo bằng đơn / tin nhắn chứ không bằng lượt thích → xếp chung sẽ luôn coi MOFU, BOFU là "nên tránh" (sai). Mỗi tầng: ≥ 6 bài → 3 cao + 3 thấp; 3–5 bài → chỉ 2 bài cao nhất.
 *   Bài BOFU nhóm Zalo: điểm = đơn từ link trong bài (nguồn "zalo / nhom / <mã bài>") × 20 + tin nhắn × 3 + người tương tác.
 * Dùng ở: insPick (insight.js) gắn p.learn → insBlock chèn lrnBlock vào prompt; CRM 🎯 Insight & nội dung → 📈 Học từ tương tác (ins_view.learn). */
import { all, DAY } from './lib.js';

const cut = (s, n) => String(s == null ? '' : s).replace(/\s+/g, ' ').trim().slice(0, n);
const insOf = s => { try { return JSON.parse(s || '{}') || {}; } catch (e) { return {}; } };
export const LRN_MIN = 6;

async function zOrders(x, since) {
  const by = {};
  try {
    for (const o of await all(x.db, "SELECT source, first_source, status FROM orders WHERE time >= ? AND (source LIKE 'zalo / nhom / %' OR first_source LIKE 'zalo / nhom / %')", since)) {
      if (/huỷ|hủy|hoàn|trả/i.test(String(o.status || ''))) continue;
      const m = String(o.source).match(/^zalo \/ nhom \/ (\S+)/) || String(o.first_source).match(/^zalo \/ nhom \/ (\S+)/); if (m) by[m[1]] = (by[m[1]] || 0) + 1;
    }
  } catch (e) { }
  return by;
}
async function rowsOf(x, ch, since, until) {
  try {
    if (ch === 'zalo') { const od = await zOrders(x, since); return (await all(x.db, "SELECT id, sent_at, text, funnel, ins, eng_people, eng_msgs, eng_reacts FROM zb_posts WHERE status = 'sent' AND sent_at BETWEEN ? AND ? AND COALESCE(ev, '') = ''", since, until))
      .map(r => { const n = od[r.id] || 0, bo = r.funnel === 'BOFU'; return { ch, id: r.id, at: r.sent_at, f: r.funnel || '', ins: insOf(r.ins), text: r.text, s: bo ? n * 20 + (r.eng_msgs || 0) * 3 + (r.eng_people || 0) : (r.eng_people || 0) * 3 + (r.eng_msgs || 0) + (r.eng_reacts || 0), m: (bo || n ? n + ' đơn, ' : '') + (r.eng_people || 0) + ' người tương tác, ' + (r.eng_msgs || 0) + ' tin nhắn' }; }); }
    if (ch === 'fb') return (await all(x.db, "SELECT id, sent_at, text, funnel, ins, eng_react, eng_cmt, eng_share, eng_reach, eng_fan FROM fp_posts WHERE status = 'sent' AND eng_at > 0 AND sent_at BETWEEN ? AND ?", since, until))
      .map(r => ({ nf: r.eng_reach > 0 ? Math.max(0, Math.round(100 * (r.eng_reach - (r.eng_fan || 0)) / r.eng_reach)) : null, ch, id: r.id, at: r.sent_at, f: r.funnel || '', ins: insOf(r.ins), text: r.text, s: (r.eng_react || 0) + (r.eng_cmt || 0) * 3 + (r.eng_share || 0) * 5, m: (r.eng_react || 0) + ' cảm xúc, ' + (r.eng_cmt || 0) + ' bình luận, ' + (r.eng_share || 0) + ' chia sẻ' }));
  } catch (e) { } // bảng chưa có (kênh chưa dùng lần nào)
  return [];
}
const pack = r => ({ ch: r.ch, id: r.id, at: r.at, f: r.f, s: r.s, m: r.m + (r.nf != null ? ', ' + r.nf + '% người chưa theo dõi' : ''), gn: cut(r.ins.gn, 80), t: cut(r.ins.t, 200), a: cut(r.ins.a, 120), text: cut(r.text, 420) });
export const TIERS = ['TOFU', 'MOFU', 'BOFU'];

/** { kênh: { n, tiers: { TOFU: { n, top[], flop[] }, … } } } cho từng kênh có đủ bài. ch = 'zalo' | 'fb' → chỉ kênh đó; kênh khác → cả 2. */
export async function lrnPosts(x, ch) {
  const now = Date.now(), since = now - 60 * DAY, until = now - 2 * DAY, out = {};
  for (const c of ch === 'zalo' || ch === 'fb' ? [ch] : ['zalo', 'fb']) {
    const all_ = await rowsOf(x, c, since, until), tiers = {};
    for (const f of TIERS) {
      const R = all_.filter(r => r.f === f).sort((a, b) => b.s - a.s);
      if (R.length < 3 || R[0].s <= 0) continue;
      tiers[f] = { n: R.length, top: R.slice(0, R.length >= LRN_MIN ? 3 : 2).map(pack), flop: R.length >= LRN_MIN ? R.slice(-3).reverse().map(pack) : [] };
    }
    if (Object.keys(tiers).length) out[c] = { n: all_.length, tiers };
  }
  return out;
}

const CHN = { zalo: 'Nhóm Zalo', fb: 'Fanpage' };
/** Đoạn chèn vào prompt (rỗng nếu chưa đủ số). f = tầng phễu của bài đang viết → chỉ học bài CÙNG TẦNG; không rõ tầng → bài TOFU. */
export function lrnBlock(L, f) {
  const t = TIERS.includes(f) ? f : 'TOFU', ks = Object.keys(L || {}).filter(k => L[k].tiers && L[k].tiers[t]); if (!ks.length) return '';
  const one = r => '- [' + CHN[r.ch] + ' · ' + r.m + (r.a ? ' · góc kể: ' + r.a : '') + '] ' + r.text;
  const top = ks.flatMap(k => L[k].tiers[t].top), flop = ks.flatMap(k => L[k].tiers[t].flop);
  return ['📈 HỌC TỪ SỐ THẬT CỦA BÀI CÙNG LOẠI (' + t + ', đã đăng 60 ngày qua' + (t === 'BOFU' ? ', xếp theo đơn hàng và tin nhắn' : t === 'MOFU' ? '; bài tạo niềm tin vốn ít tương tác hơn bài thu hút, chỉ so với nhau' : '') + '; đây là DỮ LIỆU để học, KHÔNG chép câu chữ, KHÔNG lặp lại chủ đề):',
    'Bài hiệu quả nhất: học cách mở bài, nhịp câu, độ dài, góc kể, cách mời tương tác:', ...top.map(one),
    ...(flop.length ? ['Bài kém nhất: tránh kiểu mở bài, độ dài, góc kể, cách viết giống các bài này:', ...flop.map(one)] : [])].join('\n');
}
