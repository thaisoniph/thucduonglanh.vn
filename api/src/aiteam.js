/* ================================================================ 🤖 Đội nhân sự AI (14/11/2026, anh Sơn duyệt – bài học "AI gánh việc, bạn rảnh tay", đề xuất 3)
 * Một màn cho Quản trị + Quản lý: mỗi trợ lý AI đang chạy 1 thẻ – làm việc gì, chạy lúc nào, lần chạy gần nhất, hôm nay / 7 ngày làm được bao nhiêu,
 * kết quả thật (khách để số, đơn), chi phí AI (bảng ai_usage của aiuse.js, theo mục x-tdl-muc), lỗi gần nhất.
 * CHỈ ĐỌC bảng + nhật ký đã có, không gọi AI, không ghi gì. Bảng nào chưa có (trợ lý chưa chạy lần nào) thì thẻ ghi "chưa có số liệu".
 * Lệnh CRM: aiteam (crm.js). Giao diện: viewAit trong crm/app.js (tab doi-ai). */
import { all, first, kvGet, kvJson, fmtDate, startOfDay, DAY, TZ_MS } from './lib.js';
import { MUC } from './aiuse.js';

const RATE_DEF = 26500;
/** Chạy câu SQL, bảng chưa có (trợ lý chưa chạy bao giờ) → null thay vì lỗi. */
async function q1(x, sql, ...a) { try { return await first(x.db, sql, ...a); } catch (e) { return null; } }
async function qa(x, sql, ...a) { try { return await all(x.db, sql, ...a); } catch (e) { return []; } }
const N = r => (r && Number(r.n)) || 0;
/** Lỗi lưu dạng "HH:mm dd/MM: nội dung" (zb_write_err, fp_write_err…) hoặc JSON {at, msg}. */
function errOf(v) {
  if (!v) return null;
  try { const j = JSON.parse(v); if (j && (j.msg || j.m || j.err)) return { at: Number(j.at) || 0, txt: String(j.msg || j.m || j.err).slice(0, 220) }; } catch (e) { }
  const s = String(v), m = s.match(/^(\d{1,2}):(\d{2}) (\d{2})\/(\d{2})/); // "HH:mm dd/MM: …" → mốc giờ (năm nay, hoặc năm trước nếu rơi vào tương lai)
  let at = 0; if (m) { const y = new Date(Date.now() + TZ_MS).getUTCFullYear(); at = Date.UTC(y, +m[4] - 1, +m[3], +m[1], +m[2]) - TZ_MS; if (at > Date.now() + DAY) at = Date.UTC(y - 1, +m[4] - 1, +m[3], +m[1], +m[2]) - TZ_MS; }
  return { at, txt: s.slice(0, 240) };
}
/** Chọn lỗi mới nhất trong nhiều nguồn. */
function newest(list) { return list.filter(Boolean).sort((a, b) => (b.at || 0) - (a.at || 0))[0] || null; }
/** Đơn + doanh số từ khách hỏi của 1 kênh (leads.order_id được CRM tự gắn khi khách đó mua). */
async function leadRes(x, chans, since) {
  const ph = chans.map(() => '?').join(',');
  const l = await q1(x, `SELECT count(*) n, sum(CASE WHEN order_id <> '' THEN 1 ELSE 0 END) o FROM leads WHERE channel IN (${ph}) AND time >= ?`, ...chans, since);
  const s = await q1(x, `SELECT count(*) n, coalesce(sum(o.total), 0) t FROM leads l JOIN orders o ON o.id = l.order_id WHERE l.channel IN (${ph}) AND l.time >= ? AND l.order_id <> '' AND o.status NOT IN ('Huỷ', 'Hoàn', 'Đang chuyển hoàn')`, ...chans, since);
  return { leads: N(l), orders: s ? N(s) : 0, money: s ? Number(s.t) || 0 : 0 };
}

export async function aiTeam(x, u) {
  if (u.level < 2) return { ok: false, error: 'Màn này dành cho anh Sơn và Quản lý.' };
  const now = Date.now(), d0 = startOfDay(now), d7 = now - 7 * DAY, d30 = now - 30 * DAY;
  const rate = Number(await kvGet(x.db, 'ai_rate')) || RATE_DEF;

  // chi phí AI theo mục: hôm nay / 7 ngày / 30 ngày + số lượt gọi
  const day = t => fmtDate(t, 'yyyyMMdd'), today = day(now);
  const costRows = await qa(x, 'SELECT muc, day, sum(n) n, sum(usd) usd FROM ai_usage WHERE day >= ? GROUP BY muc, day', day(d30));
  const cost = {};
  for (const r of costRows) {
    const c = cost[r.muc] || (cost[r.muc] = { t: 0, w: 0, m: 0, nt: 0, nw: 0 });
    const usd = Number(r.usd) || 0, n = Number(r.n) || 0;
    c.m += usd; if (r.day > day(d7)) { c.w += usd; c.nw += n; } if (r.day === today) { c.t += usd; c.nt += n; }
  }
  const costOf = mucs => { const o = { t: 0, w: 0, m: 0, nt: 0, nw: 0 }; for (const k of mucs) { const c = cost[k]; if (c) for (const f in o) o[f] += c[f]; } return { today: Math.round(o.t * rate), d7: Math.round(o.w * rate), d30: Math.round(o.m * rate), calls7: o.nw, callsToday: o.nt, mucs }; };
  const cards = [];

  /* 💬 Chat An Lành trên web: bảng chats (sid fb… = Messenger, zl… = Zalo riêng → không tính ở đây) */
  {
    const W = "sid NOT LIKE 'fb%' AND sid NOT LIKE 'zl%'";
    const t = await q1(x, `SELECT count(*) n FROM chats WHERE ${W} AND start >= ?`, d0), w = await q1(x, `SELECT count(*) n FROM chats WHERE ${W} AND start >= ?`, d7);
    const last = await q1(x, `SELECT max(last) at FROM chats WHERE ${W}`), miss = await q1(x, `SELECT count(*) n FROM chats WHERE ${W} AND start >= ? AND miss > 0`, d7);
    const r = await leadRes(x, ['Chatbot (Website)'], d7), g = await q1(x, "SELECT count(*) n, max(at) at FROM gate_log WHERE ch = 'web' AND at >= ?", d7);
    cards.push({ id: 'chat', ic: '💬', name: 'Trợ lý chat An Lành trên website', what: 'Trả lời khách ngay trên thucduonglanh.vn, tặng quà để khách để lại số, chuyển khách cho sale.',
      when: 'Mỗi khi khách nhắn, cả ngày lẫn đêm', last: last && last.at, today: N(t), d7: N(w), unit: 'cuộc chat',
      res: [['Khách để lại số', r.leads], ['Đơn từ khách đó', r.orders], ['Doanh số', r.money, 'd']],
      resNote: [N(miss) ? N(miss) + ' cuộc chat có câu trợ lý chưa trả lời được.' : '', g && N(g) ? '🛡 Gác cổng đã chặn ' + N(g) + ' câu trả lời sai trước khi tới khách.' : ''].filter(Boolean).join(' '),
      cost: costOf(['chat']), err: null, link: 'noi-dung' });
  }

  /* 🤖 Trợ lý Zalo An Lành: nhóm + tin riêng (zb_log, zb_status = tín hiệu máy VPS 4 phút / lần) */
  {
    const k = (kinds, s) => q1(x, `SELECT count(*) n FROM zb_log WHERE kind IN (${kinds.map(() => '?').join(',')}) AND at >= ?`, ...kinds, s);
    const ANS = ['answer', 'handoff', 'dm', 'dm_handoff'], POST = ['post', 'announced', 'send'];
    const st = await kvJson(x.db, 'zb_status', null), last = await q1(x, "SELECT max(at) at FROM zb_log WHERE kind <> 'error'");
    const er = await q1(x, "SELECT at, text FROM zb_log WHERE kind = 'error' ORDER BY at DESC LIMIT 1");
    const ho = await k(['handoff', 'dm_handoff'], d7), wel = await k(['welcome'], d7), posts = await k(POST, d7);
    const r = await leadRes(x, ['Zalo nhóm', 'Zalo Trợ lý An Lành'], d7);
    const down = st && (st.down || now - st.at > 20 * 60e3);
    cards.push({ id: 'zalo', ic: '🤖', name: 'Trợ lý Zalo An Lành (nhóm + tin riêng)', what: 'Trả lời câu hỏi trong nhóm Zalo và tin nhắn riêng, chào thành viên mới, đăng bài hằng ngày, chuyển ca khó cho người thật.',
      when: 'Cả ngày (máy chủ riêng chạy 24/7), bài đăng theo khung giờ đã đặt', last: Math.max(Number(last && last.at) || 0, 0) || null, alive: st ? st.at : null, down: !!down,
      today: N(await k(ANS, d0)), d7: N(await k(ANS, d7)), unit: 'câu trả lời',
      res: [['Bài đã đăng', N(posts)], ['Chào thành viên mới', N(wel)], ['Ca chuyển người thật', N(ho)], ['Khách để lại số', r.leads], ['Đơn từ khách đó', r.orders], ['Doanh số', r.money, 'd']],
      cost: costOf(['zalo', 'zalo-bai', 'zalo-kh']),
      err: newest([down ? { at: st.at, txt: '⚠️ Máy chạy trợ lý im lặng từ ' + fmtDate(st.at, 'HH:mm dd/MM') + ' (mất kết nối)' } : null, er && { at: er.at, txt: String(er.text || '').slice(0, 220) }, errOf(await kvGet(x.db, 'zb_write_err')), errOf(await kvGet(x.db, 'zb_plan_err'))]),
      link: 'tro-ly-zalo' });
  }

  /* 📘 Trợ lý Fanpage (fp_log + chats sid fb… = Messenger) */
  {
    const k = (kinds, s) => q1(x, `SELECT count(*) n FROM fp_log WHERE kind IN (${kinds.map(() => '?').join(',')}) AND at >= ?`, ...kinds, s);
    const pages = await q1(x, 'SELECT count(*) n FROM fp_pages WHERE active = 1');
    const mt = await q1(x, "SELECT count(*) n FROM chats WHERE sid LIKE 'fb%' AND last >= ?", d0), mw = await q1(x, "SELECT count(*) n FROM chats WHERE sid LIKE 'fb%' AND last >= ?", d7);
    const ct = await k(['comment'], d0), cw = await k(['comment'], d7), lw = await k(['lead'], d7), pw = await k(['post'], d7);
    const last = await q1(x, "SELECT max(at) at FROM fp_log WHERE kind <> 'error'"), er = await q1(x, "SELECT at, text FROM fp_log WHERE kind = 'error' ORDER BY at DESC LIMIT 1");
    const o = await q1(x, "SELECT count(*) n, coalesce(sum(o.total), 0) t FROM fp_users f JOIN leads l ON l.id = f.lead JOIN orders o ON o.id = l.order_id WHERE f.lead <> '' AND l.order_id <> '' AND l.time >= ? AND o.status NOT IN ('Huỷ', 'Hoàn', 'Đang chuyển hoàn')", d7);
    cards.push({ id: 'fanpage', ic: '📘', name: 'Trợ lý Fanpage', what: 'Trả lời bình luận và tin nhắn Messenger, xin số tặng quà, đăng bài lên trang.',
      when: 'Mỗi khi có bình luận / tin nhắn (Facebook báo về ngay), bài đăng theo lịch', off: !N(pages), offTxt: 'Chưa nối trang nào (hoặc đang chờ Facebook duyệt quyền)',
      last: last && last.at, today: N(ct) + N(mt), d7: N(cw) + N(mw), unit: 'bình luận + cuộc nhắn',
      res: [['Khách để lại số', N(lw)], ['Đơn từ khách đó', o ? N(o) : 0], ['Doanh số', o ? Number(o.t) || 0 : 0, 'd'], ['Bài đã đăng', N(pw)]],
      cost: costOf(['fanpage', 'fb-bai']), err: newest([er && { at: er.at, txt: String(er.text || '').slice(0, 220) }, errOf(await kvGet(x.db, 'fp_write_err')), errOf(await kvGet(x.db, 'fp_nf_err'))]), link: 'fanpage' });
  }

  /* 📰 Trợ lý viết bài web (bl_posts: day = ngày đăng; bl_conv = đơn đặt trong 7 ngày sau khi khách đọc bài) */
  {
    const wr = await q1(x, 'SELECT count(*) n FROM bl_posts WHERE at >= ?', d7), wt = await q1(x, 'SELECT count(*) n FROM bl_posts WHERE at >= ?', d0);
    const pub = await q1(x, 'SELECT count(*) n FROM bl_posts WHERE pub_at >= ?', d30), last = await q1(x, 'SELECT max(at) at FROM bl_posts');
    const er = await q1(x, "SELECT at, err, title FROM bl_posts WHERE err <> '' ORDER BY at DESC LIMIT 1");
    const cv = await q1(x, 'SELECT count(*) n, coalesce(sum(total), 0) t FROM bl_conv WHERE at >= ?', d30);
    cards.push({ id: 'blog', ic: '📰', name: 'Trợ lý viết bài web (Góc Sống Lành)', what: 'Viết bài theo từ khoá khách hay tìm, gửi Telegram để duyệt, duyệt xong tự đăng lên website.',
      when: 'Theo lịch ở tab Bài web (đang đặt 3 bài / tuần, 9h sáng)',
      last: last && last.at, today: N(wt), d7: N(wr), unit: 'bài viết',
      res: [['Bài đã đăng (30 ngày)', N(pub)], ['Đơn sau khi khách đọc bài (30 ngày)', cv ? N(cv) : 0], ['Doanh số', cv ? Number(cv.t) || 0 : 0, 'd']],
      cost: costOf(['web-bai']), err: er && { at: er.at, txt: (er.title ? '«' + String(er.title).slice(0, 60) + '»: ' : '') + String(er.err).slice(0, 200) }, link: 'bai-web' });
  }

  /* 🛡 Người gác cổng (gate.js, luật cố định, không tốn AI) */
  {
    const t = await q1(x, 'SELECT count(*) n FROM gate_log WHERE at >= ?', d0), w = await q1(x, 'SELECT count(*) n FROM gate_log WHERE at >= ?', d7);
    const open = await q1(x, "SELECT count(*) n FROM gate_log WHERE at >= ? AND ok_by = ''", d7), last = await q1(x, 'SELECT max(at) at FROM gate_log');
    const g = await kvJson(x.db, 'gate_cfg', null);
    cards.push({ id: 'gate', ic: '🛡', name: 'Người gác cổng', what: 'Kiểm từng câu trả lời của chat web, Zalo, Fanpage trước khi tới khách: sai giá, sai phí ship, nói quá công dụng thì chặn và báo người thật.',
      when: 'Trước mỗi câu trả lời gửi khách', last: last && last.at, lastNote: 'lần chặn gần nhất', today: N(t), d7: N(w), unit: 'câu bị chặn',
      res: [['Câu chặn chưa ai xem lại', N(open)]], resNote: (g && g.mode === 'log' ? '⚠️ Đang ở chế độ chỉ ghi nhật ký (không chặn). ' : '') + 'Không gọi AI nên không tốn tiền. Chưa đếm tổng số câu đã kiểm.',
      cost: null, link: 'noi-dung' });
  }

  /* 🗣 Kho lời khách nguyên văn (voc.js) */
  {
    const w = await q1(x, 'SELECT count(*) n FROM vq_quotes WHERE at >= ?', d7), t = await q1(x, 'SELECT count(*) n FROM vq_quotes WHERE at >= ?', d0);
    const live = await q1(x, "SELECT count(*) n, sum(CASE WHEN color = 'xanh' THEN 1 ELSE 0 END) g FROM vq_quotes WHERE hide = 0");
    cards.push({ id: 'voc', ic: '🗣', name: 'Kho lời khách nguyên văn', what: 'Gom câu khách nói thật (chat, Zalo, Fanpage, ghi chú sale), xếp theo nỗi đau / mong muốn để các trợ lý viết bài dùng.',
      when: '9h sáng mỗi ngày', last: Number(await kvGet(x.db, 'vq_last')) || null, today: N(t), d7: N(w), unit: 'câu mới',
      res: [['Câu đang dùng', N(live)], ['Câu còn mới (🟢)', live ? Number(live.g) || 0 : 0]], resNote: 'Chưa đo được bài dùng lời khách có nhiều tương tác hơn không.',
      cost: costOf(['loikhach']), link: 'noi-dung' });
  }

  /* ✅ Giao việc (gv_tasks): AI đọc tin Telegram (src tg) + việc từ biên bản họp (src hop) */
  {
    const c = (src, s) => q1(x, 'SELECT count(*) n FROM gv_tasks WHERE src = ? AND at >= ?', src, s);
    const cfg = await kvJson(x.db, 'gv_cfg', null) || {};
    const aiT = Number(await kvGet(x.db, 'gv_ai_' + fmtDate(now, 'yyMMdd'))) || 0;
    const hopW = await c('hop', d7), tgW = await c('tg', d7), tgT = await c('tg', d0), hopT = await c('hop', d0);
    const done = await q1(x, "SELECT count(*) n, sum(CASE WHEN due IS NULL OR done_at <= (CASE WHEN due_t = 1 THEN due ELSE due + 86400000 END) THEN 1 ELSE 0 END) ok FROM gv_tasks WHERE src IN ('tg', 'hop') AND status = 'Xong' AND done_at >= ?", d7);
    const last = await q1(x, "SELECT max(at) at FROM gv_tasks WHERE src IN ('tg', 'hop')");
    cards.push({ id: 'gv', ic: '✅', name: 'Bot giao việc + việc từ cuộc họp', what: 'Đọc câu giao việc trên Telegram, tách người – việc – hạn; nhận việc từ biên bản họp Zoom; nhắc hạn, 8h sáng gửi danh sách việc.',
      when: 'Mỗi khi có tin nhắn bot; sau mỗi cuộc họp Zoom; nhắc 10 phút / lần, 8h sáng', off: !cfg.token, offTxt: 'Chưa cài bot Telegram giao việc (tab Giao việc)',
      last: last && last.at, today: N(tgT) + N(hopT), d7: N(tgW) + N(hopW), unit: 'việc AI tạo',
      res: [['Việc từ cuộc họp (7 ngày)', N(hopW)], ['Việc giao qua Telegram (7 ngày)', N(tgW)], ['Đã xong (7 ngày)', done ? N(done) : 0], ['Xong đúng hạn', done ? Number(done.ok) || 0 : 0], ['Lượt AI đọc tin hôm nay', aiT]],
      cost: costOf(['giaoviec']), link: 'giao-viec' });
  }

  /* ▶️ Báo cáo tuần YouTube (yt.js) */
  {
    const rep = await kvJson(x.db, 'yt_rep', null), key = !!x.env.YOUTUBE_API_KEY || !!(await kvGet(x.db, 'yt_key'));
    cards.push({ id: 'yt', ic: '▶️', name: 'Báo cáo tuần YouTube', what: 'Quét video ngành đang lên mạnh, gom câu hỏi chưa ai trả lời, gợi ý chủ đề bài web.',
      when: '8h sáng thứ Hai', off: !key, offTxt: 'Chưa có khoá YouTube (xem hướng dẫn Marketing → Báo cáo YouTube)',
      last: rep && rep.at, today: rep && rep.at >= d0 ? 1 : 0, d7: rep && rep.at >= d7 ? 1 : 0, unit: 'lần quét',
      res: rep ? [['Video vượt trội lần gần nhất', (rep.videos || []).length], ['Câu hỏi chưa ai trả lời', (rep.qs || []).length], ['Chủ đề gợi ý', (rep.topics || []).length]] : [],
      resNote: 'Chưa đo chủ đề gợi ý đã thành bài / đơn chưa.', cost: costOf(['youtube']),
      err: rep && rep.errs && rep.errs.length ? { at: rep.at, txt: String(rep.errs[0]).slice(0, 220) } : null, link: 'noi-dung' });
  }

  /* 🧪 Chấm bài trước khi đăng (score.js) */
  {
    const t = await q1(x, 'SELECT count(*) n FROM cs_scores WHERE at >= ?', d0), w = await q1(x, 'SELECT count(*) n, avg(score) a FROM cs_scores WHERE at >= ? AND score > 0', d7);
    const last = await q1(x, 'SELECT max(at) at FROM cs_scores');
    cards.push({ id: 'score', ic: '🧪', name: 'Chấm bài trước khi đăng', what: 'Chấm bài viết / video của nhân sự trên thang 100 điểm theo insight, phễu, luật nội dung; chỉ ra chỗ cần sửa.',
      when: 'Khi nhân sự bấm Chấm bài', last: last && last.at, today: N(t), d7: N(w), unit: 'bài chấm',
      res: [['Điểm trung bình 7 ngày', w && w.a ? Math.round(w.a) : 0]], resNote: 'Chưa đo bài đã chấm có tương tác cao hơn không.',
      cost: costOf(['chamdiem']), err: errOf(await kvGet(x.db, 'ins_sc_err')), link: 'noi-dung' });
  }

  /* 📖 Trợ lý trang hướng dẫn (guideask.js) */
  {
    const t = await q1(x, 'SELECT count(*) n FROM guide_q WHERE at >= ?', d0), w = await q1(x, 'SELECT count(*) n, sum(miss) m FROM guide_q WHERE at >= ?', d7);
    const last = await q1(x, 'SELECT max(at) at FROM guide_q');
    cards.push({ id: 'guide', ic: '📖', name: 'Trợ lý trang hướng dẫn nhân sự', what: 'Trả lời nhân sự hỏi cách dùng CRM, website ngay ở trang Hướng dẫn.',
      when: 'Khi nhân sự hỏi', last: last && last.at, today: N(t), d7: N(w), unit: 'câu hỏi',
      res: [['Câu trợ lý chưa trả lời được', w ? Number(w.m) || 0 : 0]], cost: costOf(['huongdan']), link: 'cai-dat' });
  }

  /* Các trợ lý khác trong CRM: chỉ có số lượt gọi AI + chi phí (chưa ghi nhật ký riêng) */
  {
    const OTHER = ['crm', 'hoi', 'video', 'insight', 'insight-anh', 'insight-big', 'insight-kw', 'offer', 'khac'];
    const known = new Set(['chat', 'zalo', 'zalo-bai', 'zalo-kh', 'fanpage', 'fb-bai', 'web-bai', 'loikhach', 'giaoviec', 'youtube', 'chamdiem', 'huongdan'].concat(OTHER));
    const extra = Object.keys(cost).filter(k => !known.has(k)), mucs = OTHER.concat(extra);
    const c = costOf(mucs);
    cards.push({ id: 'other', ic: '✨', name: 'AI trong CRM (tóm tắt khách, hỏi số liệu, kịch bản video, tìm insight, viết offer)', what: 'Các nút ✨ nhân sự tự bấm trong CRM.',
      when: 'Khi nhân sự bấm', last: null, today: c.callsToday, d7: c.calls7, unit: 'lượt dùng AI',
      res: [], resNote: 'Chưa đo kết quả riêng từng nút, chỉ đếm số lượt và tiền.',
      parts: mucs.filter(k => cost[k] && cost[k].m > 0).map(k => ({ name: MUC[k] || k, d30: Math.round(cost[k].m * rate), n7: cost[k].nw })), cost: c, link: '' });
  }

  // tình trạng mỗi thẻ: off (chưa bật) / down / err (lỗi trong 24 giờ) / idle (im lặng > 3 ngày) / ok
  for (const c of cards) {
    const errAt = c.err && c.err.at;
    c.state = c.off ? 'off' : c.down ? 'down' : errAt && now - errAt < DAY ? 'err' : c.d7 > 0 || (c.last && now - c.last < 3 * DAY) ? 'ok' : 'idle';
  }
  const tot = { d7: 0, d30: 0, today: 0 }; for (const c of cards) if (c.cost) { tot.d7 += c.cost.d7; tot.d30 += c.cost.d30; tot.today += c.cost.today; }
  return { ok: true, ait: { cards, tot, rate, now, aiOn: !!x.env.ANTHROPIC_API_KEY, admin: u.level >= 3 ? 1 : 0 } };
}
