// Máy chủ CRM + nhận đơn Thực Dưỡng Lành trên Cloudflare Workers (api.thucduonglanh.vn), dữ liệu ở Cloudflare D1.
// Giao diện gửi POST (text/plain, JSON) giống hệt Apps Script trước đây: {type:'crm', action, token, …} / {type:'order'} / {type:'contact'}.
import { shpRoute } from './sanshp.js';
import { esc, run, first, kvGet, kvIncr, normPhone, CRM_URL, fmtDate, randHex } from './lib.js';
import { gvRoute } from './giaoviec.js';
import { pmRoute } from './phongai.js';
import { crmApi, crmUsers, saveOrder, addLead, telegramUser, vtpWebhook, ensureSchema, adminByToken, userByToken, mainPhone } from './crm.js';
import { driveVideo } from './score.js';
import { canIns } from './insight.js';
import { telegram, sendMail, tgConf, bridge } from './google.js';
import { SYNC, DUPS } from './sync.js';
import { migrate } from './migrate.js';
import { scheduled, mirror, dailyCare } from './cron.js';
import { blogRoute, blogConv } from './blog.js';
import { cmsRoute } from './cms.js';
import { voucherCheck, voucherApply, voucherRecheck } from './voucher.js';
import { qrGo } from './links.js';
import { webReprice } from './webgia.js';
import { journeyCounts, pledge, quiz, wall } from './journey.js';
import { webWishOfDay, lcEvent } from './loichuc.js'; // 🌐 lời chúc cho khách trên website (19/11/2026)
import { apply } from './apply.js';
import { dlApply, dlMe, dlOrderWeb, dlGoalWeb } from './daily.js';
import { spfHit, spfOrder } from './spost.js'; // 📣 đo hiệu quả bài sale đăng
import { hrRoute } from './hr.js'; // 🧑‍💼 trang ứng viên xác nhận lịch phỏng vấn / nhận việc (/tm/<mã>)
import { chat, chatLead } from './chat.js';
import { zbot, zbotLead, zbImg } from './zbot.js';
import { zsale } from './zsale.js'; // 👀 giám sát Zalo của sale (zsale.js, zalo-bot/sale-manager.js)
import { refMe, ctvMe, ctvApply } from './partner.js';
import { fbRoute } from './fb.js';
import { mcpRoute } from './mcp.js';
import { ddApply, ddStatus, qtetApply } from './ngaydoi.js';
import { stBind } from './sotay.js'; // 📗 kb() đọc Sổ tay trong D1
export { AiRelay } from './airelay.js'; // Durable Object chuyển tiếp lời gọi AI qua Bắc Mỹ

const API_VERSION = '2026-11-28e'; // + 🌟 đăng ký Thành viên Gian Bếp Lành (kind member) · + 🎓 4 mẫu tin chăm khách học khoá · bot số liệu nhận ra đơn web (TDL…) · + 🍚 Zalo: mâm cơm cả nhà là bữa tối (khoe mâm cơm sang tối CN, sáng T7 không viết bày mâm ăn sáng) · + 👥 bài cho nhóm Facebook (fb.js fbgList, fp_gdone) · + ➕ mua thêm trên trang cảm ơn (order_add: đơn đi kèm, giao chung, không ship) · + 💸 Opus → Sonnet: chấm bài, bài FB cá nhân sale, kịch bản video, big idea · + 📣 tab Marketing: việc riêng từng người (mk_today: Phát báo, kết quả Phòng AI chờ đăng – pm_done, pm_post) · + 🚨 Phát báo 8h: giá 1 SĐT thật vượt trần, không AI (mktg.js mkPhatAlert) · + 🤖 tự chấm quảng cáo mới + tự lấy tiền / số khách từ Facebook Ads (score.js scoreAuto, mkt.js mktAdText) · + 🌟 big idea nhóm Trung niên, Ăn chay · + 💸 skill ✍️ Viết bài chỉ kèm bài tạo niềm tin / chốt đơn, bài nhận biết không kèm (insPick opt.f, insBlock) · + 💸 kho bài: danh sách ảnh nằm trong phần system lưu đệm, mỗi bài chỉ gửi số ảnh cần tránh (spost.js skip, libGet) · + 💸 bài Fanpage: fpTick soạn 2 bài liền nhau / lượt (như zbotTick) · + 💸 bài nhóm Zalo: zbotTick soạn 2 bài liền nhau / lượt để bài thứ 2 đọc lại cache AI · + 💸 giảm tiền AI: kb() luôn kèm Sổ tay (trước gọi lại trong 10 phút bị thiếu → cache không dùng lại được), viết sẵn kho bài giữ cache 1 giờ + effort medium · +🏪 đại lý: 🎁 thưởng quý trừ vào đơn quý sau (dưới trần giá vốn), 🚀 3 tháng đầu lên 1 bậc + bộ hàng mẫu, 🎯 mục tiêu quý (dl_goal, dl_kit) · + 🔒 rà soát đợt 2: file sale không sửa tiền đơn tháng trước (sync.js), lương tháng đã duyệt chốt mức lương (luong_snap_), nhật ký ghi rõ đổi lương ai, trả hoa hồng CTV giữ đơn trước (chống trả 2 lần), thưởng đại lý bỏ đơn Mới, giới hạn form công khai / IP / giờ (RATE), voucherRecheck sau khi lưu đơn, aiteam lọc Hủy · + 📄 đơn web tự ghi vào file lên đơn của người bán (wb.js wbWebOrder) · + 🔒 rà soát bảo mật 25/11: đơn web tính theo bảng giá (webgia.js), trùng mã đơn cấp mã mới, đếm lần nhập mã / chat bằng kvIncr, esc thoát " ', MCP bỏ *.google.com, tra_cuu chặn mọi bảng ngoài danh sách + che trong SQL, sale: giới hạn tìm khách, trần voucher cảm ơn, không đổi đơn Hoàn / sửa đơn đã giao, tháng trước · + 🧩 Skill khoá học 6 ô (inskill.js SLOTS, guessSlot, skUse, ins_skillview; nối viết bài, big idea, chấm bài) · + 🔍 Tìm insight đọc Kho lời khách (inskill.js voc → vqPick) · + 💰 chiết khấu đại lý riêng từng sản phẩm theo giá vốn (daily.js dlCaps, dlPctOf, dl_cfg.keep, rules.dlCaps) · + 🏪 thưởng sale giới thiệu đại lý tự cộng vào bảng lương (luong.js list.dlb, daily.js dlBonusMonth, chốt kv luong_dlb_<tháng> khi duyệt) · + 🛒 đại lý đợt 3: tự đặt hàng bằng link riêng (dlMe, dlOrderWeb, dl_key, /dl-gia.json) · + 🏪 đại lý đợt 2: đăng ký ở /dai-ly/ (dlApply, kv dl_apps, dl_app_no) · + 👩‍💼 người phụ trách đại lý (dl_cfg.lead) · + 🏪 kênh đại lý đợt 1 (daily.js: dl_list, dl_save, dl_del, dl_cfg; đơn đại lý seller = Kênh đại lý, tự trừ chiết khấu theo bậc) · + 🖼 kho bài tránh ảnh đã dùng gần đây · + 🗂 viết sẵn bài theo nhóm khách + lời dặn (spf_q g, h), bài nhận biết gắn sản phẩm không nhắc tên · + 📊 hiệu quả từng bài sale đăng (lượt bấm, đơn: spf_hit, sp_conv) · + 🗂 kho bài: sale lọc trên cả kho, bài chưa có ảnh vẫn tới sale kèm gợi ý tự chụp, bài Zalo mang nhóm khách · + 🟠 bài chốt đơn cho sale link thẳng trang sản phẩm · + 🗂 Kho bài đăng cho sale: lưới có ảnh, lọc, ✨ viết sẵn N bài theo 3 tầng phễu 60/20/20, ảnh bắt buộc (spost.js spf_fill, spFillTick) · + 📊 Tin AI chăm khách cả công ty (ai_stats team, aiCareTeam) · + ✨ Nhờ AI viết tin: 3 tin, học giọng từng sale, đo khách mua lại (ai.js ai_sent, ai_stats) · + 🎯 trợ lý Hỏi số liệu + MCP có công cụ ty_le_chot tính khớp CRM (ask.js toolClose) · + 🎛 chọn mô hình AI theo việc (aiuse.js aiPick, kv ai_models, lệnh ai_pick) + Hỏi số liệu Opus → Sonnet · + 🔌 Gemini: nhận địa chỉ trả về sandbox/test của Google · + 💬 Zalo PA A: ✓ Xong (zs_done) · + 🅰️🅱️©️ sale_mkt trả tierAt, tierFrom, tierTo, splitAt (dòng nhóm ghi rõ cách tính) · + ⏰ hẹn bật CRM tự chia số (ads_cfg.crmAt, adsCrmAt) · + ↩️ phí ship hoàn mặc định 30k · + 💬 Zalo của tôi: 💤 khách im, gắn số 1 chạm, nhãn loại khách, học từ câu sale sửa, ☀️ 8h · + ↩️ nhóm A/B/C trừ phí ship đơn hoàn (adsTier bk, bn) · + 🎯 tỷ lệ chốt chỉ khách chưa từng mua, ra đơn trong 30 ngày (crmRace closeOf, salemkt cn/cw) · + 📊 sale_mkt teamS: mốc cả nhóm chỉ 5 sale nhận số quảng cáo · + 📋 phiếu KPI sale tạm chỉ Quản lý / Quản trị · + ⚡ đọc file số quảng cáo mỗi phút (adsFast, cron * * * * *) + Nhập số nhanh (qc_info, qc_quick) · + ☀️ người nhặt số ban ngày theo thứ / ngày + nhắc 8h + ⏰ cảnh báo số về chậm (adsSlowCheck, kv ads_slow) · + 🗓 lịch trực số: lịch tuần + đổi riêng ngày + người phụ trách + nhắc Telegram (ads_duty_get, dutyTick) · + 🌙 người trực tối / CN / lễ nhận số quảng cáo khi CRM tự chia (adsDutyPool, kv ads_duty, lệnh ads_duty_set) · + 🎯 sv: phần 5 sale nhận số quảng cáo cần bán / ngày · + 🏢 hoà vốn cả văn phòng cho sale (be_vr_set co, kv be_co, sale_mkt trả co) · + 💵 lãi lỗ tin 8h như kế toán (bỏ VAT, quảng cáo +5%, phát sinh trung bình) · + 📋 phiếu KPI tháng của sale (kpisale.js, lệnh sale_kpi) · + 📰 Bài web: sửa nhanh, dời giờ, đăng ngay, viết sớm (bl_edit, bl_move, bl_early, bl_imgs) · + 🏛 nhóm khách có ô bằng chứng họ tin nhất (tháp niềm tin K218, insight.js PROOF0) · + 📊 /so hỏi số quảng cáo qua bot Việc tuần, chỉ đọc (mktg.js, kv mk_snap) · + 🕛 hẹn giờ thay đổi quảng cáo lúc 0h (mksch.js: mk_sched, mk_sch_act, cron cả đêm) · + 🎯 số thật theo chiến dịch (mkcamp.js: cột Chiến dịch, mã quảng cáo Messenger, cr / cr7) · + 📋 Biểu mẫu Facebook → CRM + 📡 báo kết quả về Facebook (fblead.js) · + Việc tuần: ưu tiên, con số đích, đèn tiến độ, hạn bắt buộc · + ✨ gợi ý Zalo đủ chỗ cho AI · + ✨ gợi ý trả lời Zalo đọc JSON · + 🔒 Xem như không lộ Zalo của nhân sự · + 🛒 lên đơn từ Zalo (zs_order) + bỏ tin chào khỏi khách chờ + đoán khách theo tên · + 🎯 Việc tuần: mục tiêu đếm được (gv_goals) · + 🔒 khoá hẳn đọc nội dung Zalo của sale (READ_ALLOWED = false) · + 👁 công tắc xem nội dung Zalo của sale (zs_cfg.readUntil, tự tắt 24 giờ) · + 📲 sale tự nối Zalo (zs_self, zs_consent) + ✨ gợi ý trả lời (zs_ai) · + 📥 nút đọc trang Kênh Người Bán → sổ ngày + ca sáng (sanai.js aiScRead) · + 👀 Zalo của sale chia quyền: Quản trị xem hết, Quản lý chỉ số + gợi ý, sale 💬 Zalo của tôi (zs_mine, zs_link, zs_private) · + 🅰️🅱️©️ chia số quảng cáo theo nhóm (adsTier, ads_wrr, lệnh ads_tier) · + ⚖️ hoà vốn số quảng cáo ở tab Hôm nay sale (be_vr_set, sale_mkt.be) · + 💎 giá trị khách 12 tháng (ltvOf.y) → mức tốt / trần chi phí có 1 khách mới · + 📥 lương thực trả từ file Tính lương (kt_luong op real, kv luong_real) · + 📥 nút Gửi về CRM (đối thủ so tuần trước bằng máy) + 📒 sổ theo dõi ngày + ROI hoà vốn + 🔗 nối Shopee chính chủ (sanshp.js) · + 🧮 cây mục tiêu: khách cũ (sale) / khách mới (Marketing) trong saleToMkt · + 🛒 trợ lý sàn Shopee: 🩺 sức khoẻ shop + 🔍 đối thủ đầu tuần (sanai.js) · + 📣 Tin vui PA A (số đơn chung nhóm, mốc % mục tiêu riêng, 🙈 ẩn tên) · + 🕐 giờ chốt đơn (closedAt, entered_at, cờ chờ quản lý duyệt) · + 👁 Xem như: Quản trị xem giao diện từng nhân sự, chỉ đọc (as_open, vaOk) · + 📦 Kho cho sale (kho_sale, ⭐ kho_star) · + 👀 Việc tuần: ai xem việc của ai (users.gvsee), nhóm Telegram không lộ nội dung việc · + 🌿 điều văn hoá nhẹ nhàng (câu thân thiện, ôn 10 điều, ai cùng giữ) · + ✅ Việc tuần bật theo từng người + 🔐 lần cuối vào CRM / đăng xuất mọi máy / phiên tự gia hạn · + 📣 Phòng Marketing AI giao việc cho Lành trên Mac (phongai.js) · + 📝 Thông tin của tôi + bật/tắt form nhân sự (hrstaff.js) · + 🌙 Zalo bài tối mặc định 19:15 · + 📝 Zalo: nút Duyệt nói rõ giờ đăng + Làm bài khác + quy tắc người đọc là cha mẹ · + 🎂 sinh nhật theo tháng (sinhnhat.js) · 📇 số điện thoại cho sale trong tin Marketing 8h (mktv.js) · 📄 hợp đồng nhân sự (hrhd.js) // CRM web so với số này để biết giao diện & máy chủ khớp nhau
const ORIGINS = /^https:\/\/((www\.|crm\.|quantri\.|mkt\.|kho\.|ketoan\.|kinhdoanh\.|hr\.|congsu\.|camnangsongkhoe\.)?thucduonglanh\.vn|([a-z0-9-]+\.)?(thucduonglanh(-crm|-congsu)?|camnang-song-khoe-thuc-duong-lanh)\.pages\.dev)$|^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/;

function ctxOf(env, ectx) { stBind(env.DB); return { env, db: env.DB, later: p => ectx.waitUntil(Promise.resolve(p).catch(e => console.error('later', e && e.message))) }; }
function json(o, origin, status) {
  const h = { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' };
  if (origin && ORIGINS.test(origin)) { h['Access-Control-Allow-Origin'] = origin; h['Vary'] = 'Origin'; }
  return new Response(JSON.stringify(o), { status: status || 200, headers: h });
}

const ADMIN = Object.assign({}, SYNC, {
  migrate: (x, u, d) => d.confirm === 'CHEP LAI' ? migrate(x, { force: true }) : { ok: false, error: 'Cần xác nhận' },
  mirror: async x => ({ ok: true, counts: await mirror(x) }),
  care_now: async x => ({ ok: true, sent: await dailyCare(x) }),
  clean_triggers: async x => bridge(x.env, 'clean_triggers')
});

/** Máy chủ dữ liệu (D1) lỗi / hết hạn mức → chuyển đơn, liên hệ sang Apps Script báo thẳng Telegram + email để nhân sự nhập tay, không mất khách. */
async function rescue(x, data, err) {
  if (!x.env.BRIDGE_URL) return false;
  try {
    const r = await fetch(x.env.BRIDGE_URL, { method: 'POST', headers: { 'Content-Type': 'text/plain;charset=utf-8' }, body: JSON.stringify({ type: 'rescue', data, error: String(err && err.message || err).slice(0, 300) }), redirect: 'follow' });
    const j = await r.json(); return !!(j && j.ok);
  } catch (e) { console.error('rescue', e.message); return false; }
}

/** Mã đơn web còn trống cùng ngày: TDL + yyMMdd + 4 số (giữ dạng cũ cho phiếu Misa), thử 8 lần rồi thêm chữ. */
async function freeOrderId(x, id) {
  const base = /^TDL\d{6}/.test(id) ? id.slice(0, 9) : 'TDL' + fmtDate(Date.now(), 'yyMMdd'), r = new Uint16Array(8); crypto.getRandomValues(r);
  for (const n of r) { const c = base + (1000 + n % 9000); if (!(await first(x.db, 'SELECT rid FROM orders WHERE id = ?', c))) return c; }
  return base + randHex(3).toUpperCase();
}

/** ➕ Mua thêm ngay trên trang cảm ơn (28/11/2026, ý "trạm dừng nghỉ" của anh Hiếu, anh Sơn duyệt): đơn nhỏ đi kèm đơn vừa đặt, giao chung 1 kiện nên không tính ship.
 *  Đơn riêng (không sửa đơn cũ) vì đơn cũ đã ghi sang file lên đơn của sale; 2 đơn ghi chú chéo để kho đóng chung. */
const ADD_MIN = 40; // web chỉ mời trong 30 phút, chừa 10 phút cho khách bấm chậm
async function orderAdd(x, data) {
  const p = await first(x.db, 'SELECT * FROM orders WHERE id = ?', String(data.parent || '')), phone = await mainPhone(x, data.phone);
  if (!p || p.phone !== phone || Date.now() - Number(p.time) > ADD_MIN * 60e3 || ['Mới', 'Đã xác nhận'].indexOf(p.status) < 0 || p.tracking)
    return { ok: false, error: 'Đơn đã sang bước chuẩn bị hàng nên không thêm trên web được nữa. Anh/chị gọi / Zalo 0966 326 522 để thêm món nhé.' };
  const d = { type: 'order', id: await freeOrderId(x, p.id), items: (Array.isArray(data.items) ? data.items : []).slice(0, 5), shipping: 0, payment: p.payment === 'Chuyển khoản' ? 'bank' : 'cod',
    customer: { name: p.name, phone: String(data.phone), province: p.province, district: p.ward, address: p.address, note: '➕ Mua thêm cho đơn ' + p.id + ' – GIAO CHUNG 1 kiện, không tính ship' },
    source: p.source || '', first_source: p.first_source || '', marketing_consent: !!p.consent };
  d.items.forEach(i => { if (i) i.qty = Math.min(10, Number(i.qty) || 1); });
  await webReprice(x, d);
  if (!d.subtotal) return { ok: false, error: 'Chưa chọn món để thêm.' };
  await saveOrder(x, d, { otype: p.otype || undefined }); // cùng loại đơn với đơn chính (tránh tự xếp "Khách cũ" vì vừa có đơn)
  if (p.seller) await run(x.db, 'UPDATE orders SET seller = ? WHERE id = ?', p.seller, d.id);
  const nt = '➕ Khách mua thêm đơn ' + d.id + ' (' + fmtDate(Date.now(), 'HH:mm') + ') – GIAO CHUNG 1 kiện';
  await run(x.db, "UPDATE orders SET note = CASE WHEN coalesce(note, '') = '' THEN ? ELSE note || ' · ' || ? END WHERE rid = ?", nt, nt, p.rid);
  return { ok: true, id: d.id, total: d.total };
}

/** 💚 Khách tự bấm "Có, nhắc tôi" ở trang cảm ơn (28/11/2026): ghi đồng ý nhận tin cho đơn + khách. Chỉ đúng mã đơn + số điện thoại, trong 7 ngày. */
async function orderConsent(x, data) {
  const p = await first(x.db, 'SELECT rid, phone, time FROM orders WHERE id = ?', String(data.id || '')), phone = await mainPhone(x, data.phone);
  if (!p || p.phone !== phone || Date.now() - Number(p.time) > 7 * 864e5) return { ok: false, error: 'Chưa ghi nhận được, anh/chị nhắn Zalo 0966 326 522 giúp em nhé.' };
  await run(x.db, 'UPDATE orders SET consent = 1 WHERE rid = ?', p.rid);
  await run(x.db, 'UPDATE customers SET consent = 1 WHERE phone = ?', phone);
  return { ok: true };
}

const RATE = { order: 30, order_add: 10, order_consent: 10, contact: 30, chat_lead: 20, apply: 6, dl_apply: 6, ctv_apply: 6 }; // lượt / giờ / địa chỉ IP (nhiều khách dùng chung mạng 4G vẫn đủ)
async function website(x, data) {
  if (data.website) return { ok: true }; // chống spam (honeypot)
  // 25/11/2026 (rà soát bảo mật): trước đây chỉ có ô bẫy → 1 đoạn mã tự động tạo được hàng nghìn khách giả, hồ sơ 2 MB làm đầy kho dữ liệu, email liên hệ dùng hết lượt gửi trong ngày (không ai nhận được mã đăng nhập)
  if (RATE[data.type] && x.ip && await kvIncr(x.db, 'rl_' + data.type + '_' + x.ip.slice(0, 60), 3600e3) > RATE[data.type]) return { ok: false, error: 'Bạn gửi nhiều lần quá. Bạn thử lại sau 1 tiếng, hoặc gọi / Zalo 0966 326 522 để được hỗ trợ ngay nhé.' };
  if (data.type === 'vtp') return await vtpWebhook(x, data.payload);
  if (data.type === 'pledge') return await pledge(x, data); // lời cam kết "Tôi chọn sống lành" (journey.js)
  if (data.type === 'spf_hit') return await spfHit(x, data); // 📣 khách bấm link trong bài sale đăng (spost.js)
  if (data.type === 'lc_ev') return await lcEvent(x, data); // 🌐 đếm lượt thấy / bấm lời chúc ở trang chủ (loichuc.js)
  if (data.type === 'quiz') return await quiz(x, data); // trò chơi "Bạn còn mấy ngón tay?" (journey.js)
  if (data.type === 'voucher') return await voucherCheck(x, data); // khách bấm "Áp dụng" mã ưu đãi (gõ SĐT người giới thiệu cũng được)
  if (data.type === 'ctv_me') return await ctvMe(x, data); // 🤝 trang CTV tự xem hoa hồng /ctv/#<link bí mật> (partner.js)
  if (data.type === 'dl_goal') return await dlGoalWeb(x, data); // 🎯 đại lý tự đăng ký mục tiêu quý (25/11/2026)
  if (data.type === 'dl_me') return await dlMe(x, data); // 🛒 đại lý tự xem bậc + bảng giá ở /dai-ly/dat-hang/#<link riêng> (daily.js, đợt 3)
  if (data.type === 'dl_order') { await ensureSchema(x.db); return await dlOrderWeb(x, data, { saveOrder, telegramUser, staff: (await crmUsers(x)).filter(u => u.active).map(u => u.name) }); } // 🛒 đại lý tự gửi đơn nhập hàng
  if (data.type === 'dl_apply') return await dlApply(x, data); // 🏪 người ngoài đăng ký làm đại lý ở /dai-ly/ → người phụ trách duyệt (daily.js)
  if (data.type === 'ctv_apply') return await ctvApply(x, data); // 📝 người ngoài đăng ký làm CTV ở /cong-tac-vien/ → chờ quản lý duyệt (partner.js)
  if (data.type === 'ref_me') return await refMe(x, data); // 🌱 /gioi-thieu-ban-be/ + trang cảm ơn: link giới thiệu, bạn bè đã mua, voucher (partner.js)
  if (data.type === 'apply') return await apply(x, data); // ứng tuyển từ congsu.thucduonglanh.vn (apply.js)
  if (data.type === 'chat') return await chat(x, data); // 💬 trợ lý chat An Lành trên web (chat.js)
  if (data.type === 'chat_lead') return await chatLead(x, data); // khách để lại số trong khung chat
  if (data.type === 'zbot') { await ensureSchema(x.db); return await zbot(x, data); } // 🤖 chương trình Zalo "Trợ lý An Lành" (zbot.js, zalo-bot/); bảng mới (zb_act…) tạo cả khi chưa ai mở CRM
  if (data.type === 'zsale') { await ensureSchema(x.db); return await zsale(x, data); } // 👀 người đọc Zalo của sale (zsale.js, zalo-bot/sale-manager.js): chỉ lưu tin, không gửi
  if (data.type === 'order_add') { await ensureSchema(x.db); return await orderAdd(x, data); }
  if (data.type === 'order_consent') return await orderConsent(x, data);
  if (data.type === 'order') {
    try {
      // đơn gửi lại (mạng chập chờn) đã lưu rồi thì không kiểm tra lại mã (mã 1 lần sẽ báo "đã dùng") và không tính lại suất quà Ngày Đôi
      if (data.id) {
        const ex = await first(x.db, 'SELECT phone FROM orders WHERE id = ?', String(data.id));
        if (ex && ex.phone === await mainPhone(x, (data.customer || {}).phone)) return { ok: true, id: data.id, dup: true };
        if (ex) data.id = await freeOrderId(x, String(data.id)); // 25/11/2026: trùng mã với đơn của khách khác (web chỉ có 9.000 mã / ngày) → cấp mã mới, trước đây đơn này bị bỏ qua mà khách vẫn thấy "thành công"
      }
      await webReprice(x, data); // 💰 tiền đơn tính theo bảng giá web, không theo số trình duyệt gửi (webgia.js)
      if (data.voucher) {
        const v = await voucherApply(x, data); if (!v.ok) return { ok: false, voucher_error: v.error, error: v.error };
      } else { data.discount = 0; }
      let dd = null; try { dd = await ddApply(x, data); } catch (e) { console.error('ngaydoi', e.message); } // 🎉 Ngày Đôi 1/1…12/12: miễn ship + quà (ngaydoi.js)
      let qt = null; try { qt = qtetApply(data); } catch (e) { console.error('qtet', e.message); } // 🧧 Quà Tết đặt sớm: tặng 1 hũ ruốc (ngaydoi.js)
      // 🎟 kiểm lại lượt dùng mã sau khi lưu (voucher.js, 25/11/2026)
      const r = await saveOrder(x, data, {}); if (!r.dup && data.voucher) { try { const t2 = await voucherRecheck(x, data.id); if (t2 != null) { data.total = t2; data.voucher_lost = true; } } catch (e) { console.error('voucherRecheck', e.message); } } if (!r.dup && data.post) x.later(blogConv(x, data)); if (!r.dup && data.bv) x.later(spfOrder(x, data).catch(e => console.error('spfOrder', e.message))); // 📣 đơn sau khi bấm link trong bài sale đăng // 📰 khách đọc bài Góc Sống Lành trong 7 ngày trước khi đặt → đếm đơn cho bài (blog.js)
      return { ok: true, id: data.id, dup: !!r.dup, total: data.total, dd, qt };
    }
    catch (e) { if (await rescue(x, data, e)) return { ok: true, id: data.id, rescued: true }; throw e; }
  }
  if (data.type === 'contact') {
    try { await run(x.db, 'INSERT INTO contacts (time, name, phone, email, message, page) VALUES (?, ?, ?, ?, ?, ?)', Date.now(), data.name || '', normPhone(data.phone), data.email || '', data.message || '', data.page || ''); }
    catch (e) { if (await rescue(x, data, e)) return { ok: true, rescued: true }; throw e; }
    // kind 'ebook': trang quà tặng trên web (/ebook/, /cam-nang-song-khoe/) → kênh "Ebook – quà tặng (Website)", không gửi email
    const isEb = data.kind === 'ebook', book = String(data.book_title || 'Ebook quà tặng').slice(0, 80), concern = String(data.concern || '').slice(0, 300), ask = String(data.ask || '').slice(0, 500), ctx = String(data.ctx || '').slice(0, 300); // ctx: kết quả trò chơi Bạn còn mấy ngón tay / đã ký cam kết
    if (data.kind === 'member') { // 🌟 gói thành viên Gian Bếp Lành /thanh-vien/ (28/11/2026): tầng 4 phễu Bữa ăn, sale gọi xác nhận rồi lên đơn đợt 1
      const plan = String(data.plan || '').slice(0, 80);
      let lm = null; try { lm = await addLead(x, { name: data.name, phone: data.phone, channel: 'Thành viên (Website)', interest: 'Đăng ký Thành viên Gian Bếp Lành – ' + plan, addInterest: true, note: 'Đăng ký thành viên trên web: ' + plan + (ask ? ' · Ghi chú: ' + ask : '') + ' · Nguồn: ' + (data.source || ''), by: 'Website', auto: true }); } catch (e) { console.error('lead', e.message); }
      const mm = '🌟 <b>ĐĂNG KÝ THÀNH VIÊN</b> – ' + esc(plan) + '\n👤 ' + esc(data.name) + ' – <b>' + esc(data.phone) + '</b>' + (ask ? '\n💬 ' + esc(ask) : '') + '\n📍 Nguồn: ' + esc(data.source || '') + '\n👉 Gọi xác nhận trong ngày, lên đơn đợt 1 đủ tiền gói (xem hướng dẫn CRM: Thành viên Gian Bếp Lành)';
      x.later((async () => { await telegram(x.env, mm + (lm && lm.owner ? '\n\n👤 Giao cho: ' + esc(lm.owner) : '\n\n⚠️ Chưa có người phụ trách – vào CRM để giao')); if (lm && lm.owner) await telegramUser(x, lm.owner, mm + '\n\n👉 ' + CRM_URL + '/#tiem-nang'); })());
      return { ok: true };
    }
    if (data.kind === 'zalo') { // cổng vào nhóm Zalo /nhom-zalo/ (17/10/2026): khách để tên + số Zalo rồi mới nhận link nhóm → kênh "Nhóm Zalo (Website)"
      let lz = null; try { lz = await addLead(x, { name: data.name, phone: data.phone, channel: 'Nhóm Zalo (Website)', interest: 'Xin vào nhóm Zalo' + (concern ? ' · Quan tâm: ' + concern : '') + (data.pos ? ' · từ web (' + data.pos + ')' : ''), addInterest: true, note: (data.again ? 'Bấm vào nhóm Zalo trên web (đã có số từ trước)' : 'Xin vào nhóm Zalo trên web') + (ctx ? ' · ' + ctx : '') + ' · Nguồn: ' + (data.source || ''), by: 'Website', auto: true }); } catch (e) { console.error('lead', e.message); }
      x.later(zbotLead(x, { phone: data.phone, name: data.name, lead: lz && lz.id, what: '' })); // trợ lý Zalo tìm tài khoản theo số → tự duyệt vào nhóm
      if (!data.again) {
        const zm = '👥 <b>XIN VÀO NHÓM ZALO</b>\n👤 ' + esc(data.name) + ' – <b>' + esc(data.phone) + '</b>' + (concern ? '\n🩺 Quan tâm: ' + esc(concern) : '') + (ctx ? '\n' + esc(ctx) : '') + '\n📍 Nguồn: ' + esc(data.source || '') + (data.pos ? ' · bấm từ web: ' + esc(data.pos) : '') + '\n👉 Duyệt vào nhóm (nếu nhóm bật duyệt) + kết bạn Zalo, chào trong 24 giờ';
        x.later((async () => { await telegram(x.env, zm + (lz && lz.owner ? '\n\n👤 Giao cho: ' + esc(lz.owner) : '\n\n⚠️ Chưa có người phụ trách – vào CRM để giao')); if (lz && lz.owner) await telegramUser(x, lz.owner, zm + '\n\n👉 Khách tiềm năng mới của bạn: ' + CRM_URL + '/#tiem-nang'); })());
      }
      return { ok: true };
    }
    let ld = null; try { ld = await addLead(x, isEb ? { name: data.name, phone: data.phone, channel: 'Ebook – quà tặng (Website)', interest: book + (concern ? ' · Quan tâm: ' + concern : '') + (data.pos ? ' · từ web (' + data.pos + ')' : ''), addInterest: true, note: (data.again ? 'Nhận thêm ' : 'Đăng ký ') + book + ' trên web' + (ctx ? ' · ' + ctx : '') + (ask ? ' · Hỏi thêm: ' + ask : '') + ' · Nguồn: ' + (data.source || ''), by: 'Website', auto: true } : { name: data.name, phone: data.phone, channel: 'Form website', note: data.message, by: 'Website', auto: true }); } catch (e) { console.error('lead', e.message); }
    if (isEb) x.later(zbotLead(x, { phone: data.phone, name: data.name, lead: ld && ld.id, what: book, announce: !data.again })); // đang trong nhóm Zalo → trợ lý chúc mừng
    const cmsg = isEb ? (data.again ? '🎁 <b>NHẬN THÊM EBOOK</b> (khách đã đăng ký trước) – ' : '🎁 <b>ĐĂNG KÝ EBOOK</b> – ') + esc(book) + '\n👤 ' + esc(data.name) + ' – <b>' + esc(data.phone) + '</b>' + (concern ? '\n🩺 Quan tâm: ' + esc(concern) : '') + (ctx ? '\n' + esc(ctx) : '') + (ask ? '\n💬 ' + esc(ask) : '') + '\n📍 Nguồn: ' + esc(data.source || '') + (data.pos ? ' · bấm từ web: ' + esc(data.pos) : '') + '\n👉 Kết bạn Zalo, mời vào nhóm Sống khỏe'
      : '✉️ <b>LIÊN HỆ MỚI</b>\n👤 ' + esc(data.name) + ' – <b>' + esc(data.phone) + '</b>\n\n' + esc(data.message);
    x.later((async () => {
      await telegram(x.env, cmsg + (ld && ld.owner ? '\n\n👤 Giao cho: ' + esc(ld.owner) : '\n\n⚠️ Chưa có người phụ trách – vào CRM để giao'));
      if (ld && ld.owner) await telegramUser(x, ld.owner, cmsg + '\n\n👉 Khách tiềm năng mới của bạn: ' + CRM_URL + '/#tiem-nang');
      const c = await tgConf(x.env); if (c.notify && !isEb) await sendMail(x.env, { to: c.notify, subject: '✉️ Liên hệ mới từ website – ' + data.name, body: data.message + '\n\n' + data.name + ' – ' + data.phone + (data.email ? ' – ' + data.email : '') });
    })());
    return { ok: true };
  }
  return { ok: false, error: 'unknown type' };
}

export default {
  async fetch(req, env, ectx) {
    const url = new URL(req.url), origin = req.headers.get('Origin') || '', x = ctxOf(env, ectx), path = url.pathname.replace(/\/+$/, '') || '/';
    x.ip = req.headers.get('CF-Connecting-IP') || ''; // chống dò mã ưu đãi (voucher.js)
    if (path.startsWith('/gh/') || path.startsWith('/cms/')) { // trang quản trị website đăng nhập bằng email (cms.js)
      try { await ensureSchema(x.db); const r = await cmsRoute(x, req, path); if (r) return r; }
      catch (err) { console.error('cms', err && err.stack || err); return json({ ok: false, message: String(err && err.message || err) }, origin, 500); }
    }
    if (path.startsWith('/bai/')) { // 🤖 trang duyệt bài web do trợ lý viết (blog.js), mở từ link Telegram
      try { await ensureSchema(x.db); const r = await blogRoute(x, req, path, url); if (r) return r; }
      catch (err) { console.error('blog', err && err.stack || err); return new Response('Có lỗi, vui lòng thử lại sau ít phút.', { status: 500, headers: { 'Content-Type': 'text/plain; charset=utf-8' } }); }
    }
    if (path.startsWith('/tm/')) { // 🧑‍💼 thư mời phỏng vấn / nhận việc: ứng viên bấm xác nhận (hr.js, 15/11/2026)
      try { await ensureSchema(x.db); const r = await hrRoute(x, req, path, await crmUsers(x)); if (r) return r; }
      catch (err) { console.error('hr', err && err.stack || err); return new Response('Có lỗi, vui lòng thử lại sau ít phút hoặc gọi 0966 326 522.', { status: 500, headers: { 'Content-Type': 'text/plain; charset=utf-8' } }); }
    }
    if (path === '/shopee/cb') { // 🔗 Shopee chuyển về sau khi chủ shop bấm Cho phép (sanshp.js, 16/11/2026)
      try { await ensureSchema(x.db); const r = await shpRoute(x, req, path, url); if (r) return r; }
      catch (err) { console.error('shp', err && err.stack || err); return new Response('Có lỗi, thử lại sau.', { status: 500 }); }
    }
    if (path === '/pm/agent') { // 📣 Lành trên Mac nhận việc / gửi kết quả cho Phòng Marketing AI (phongai.js, 16/11/2026)
      try { await ensureSchema(x.db); const r = await pmRoute(x, req, path); if (r) return r; }
      catch (err) { console.error('pm', err && err.stack || err); return new Response(JSON.stringify({ ok: false, error: 'Lỗi máy chủ' }), { status: 500 }); }
    }
    if (path.startsWith('/gv/')) { // ✅ bot Telegram giao việc: nhận tin + nút bấm (giaoviec.js)
      try { await ensureSchema(x.db); const r = await gvRoute(x, req, path); if (r) return r; }
      catch (err) { console.error('gv', err && err.stack || err); return new Response('ok'); } // trả 200 để Telegram không gửi lặp
    }
    if (path.startsWith('/fb/')) { // 📘 trợ lý Fanpage: webhook Facebook + đăng nhập kết nối trang (fb.js)
      try { await ensureSchema(x.db); const r = await fbRoute(x, req, path, url); if (r) return r; }
      catch (err) { console.error('fb', err && err.stack || err); return new Response('error', { status: 500 }); }
    }
    if (path === '/drive-video' && req.method === 'POST') { // 🧪 chấm bài: tải video từ link Google Drive cho CRM cắt khung hình + tách tiếng (score.js)
      const cors = origin && ORIGINS.test(origin) ? { 'Access-Control-Allow-Origin': origin, 'Vary': 'Origin' } : {};
      try { const d = JSON.parse(await req.text() || '{}'); if (d.probe === 1) return await driveVideo(x, d, cors); const u = await userByToken(x, d.token); if (!u || !canIns(u)) return json({ ok: false, error: 'Bạn cần đăng nhập CRM (quyền Marketing / Quản lý) để tải video.' }, origin, 403); return await driveVideo(x, d, cors); }
      catch (err) { console.error('drive', err && err.stack || err); return json({ ok: false, error: 'Không tải được video: ' + String(err && err.message || err).slice(0, 150) }, origin, 500); }
    }
    if (path === '/mcp' || path.startsWith('/oauth/') || path.startsWith('/.well-known/')) { // 🔌 cổng MCP: ChatGPT / Gemini / Claude hỏi số liệu CRM (mcp.js)
      try { await ensureSchema(x.db); const r = await mcpRoute(x, req, path, url); if (r) return r; }
      catch (err) { console.error('mcp', err && err.stack || err); return new Response(JSON.stringify({ error: 'server_error' }), { status: 500, headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' } }); }
    }
    if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: ORIGINS.test(origin) ? { 'Access-Control-Allow-Origin': origin, 'Access-Control-Allow-Methods': 'GET, POST', 'Access-Control-Allow-Headers': 'Content-Type', 'Access-Control-Max-Age': '86400' } : {} });
    try {
      if (req.method === 'GET') {
        if (/^\/zb-img\/[a-z0-9]+$/.test(path)) return await zbImg(x, path.slice(8)); // ảnh bài đăng nhóm Zalo do nhân sự tải lên (zbot.js)
        if (/^\/q\/[^/]+$/.test(path)) return await qrGo(x, req, path.slice(3)); // mã QR / link ngắn thucduonglanh.vn/q/<mã>/ (links.js)
        if (path === '/api/journey') { // bộ đếm hành trình 10 triệu người (journey.js): lưu đệm 5 phút ở Cloudflare để ít đọc D1
          const ck = new Request('https://api.thucduonglanh.vn/api/journey'), cache = caches.default;
          let r = await cache.match(ck);
          if (!r) { await ensureSchema(x.db); r = new Response(JSON.stringify(await journeyCounts(x)), { headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'public, max-age=300' } }); x.later(cache.put(ck, r.clone())); }
          const h = new Headers(r.headers); h.set('Access-Control-Allow-Origin', '*');
          return new Response(r.body, { headers: h });
        }
        if (path === '/api/wall') { // Bức tường Sống Lành /buc-tuong-song-lanh/ (journey.js): chỉ tên đã che; lưu đệm 2 phút theo từng câu tìm
          const sp = url.searchParams, key = new URL('https://api.thucduonglanh.vn/api/wall');
          ['q', 'p', 'b'].forEach(k => { const v = String(sp.get(k) || '').trim().slice(0, 40); if (v) key.searchParams.set(k, v); });
          const ck = new Request(key.toString()), cache = caches.default;
          let r = await cache.match(ck);
          if (!r) { await ensureSchema(x.db); r = new Response(JSON.stringify(await wall(x, key.searchParams.get('q'), key.searchParams.get('p'), key.searchParams.get('b'))), { headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'public, max-age=120' } }); x.later(cache.put(ck, r.clone())); }
          const h = new Headers(r.headers); h.set('Access-Control-Allow-Origin', '*');
          return new Response(r.body, { headers: h });
        }
        if (path === '/api/loi-chuc') { // 🌐 lời chúc hôm nay cho khách (loichuc.js): lưu đệm 10 phút, khoá theo ngày VN để qua 0h là đổi câu
          const ck = new Request('https://api.thucduonglanh.vn/api/loi-chuc?d=' + fmtDate(Date.now(), 'yyyy-MM-dd')), cache = caches.default;
          let r = await cache.match(ck);
          if (!r) { await ensureSchema(x.db); r = new Response(JSON.stringify(await webWishOfDay(x.db)), { headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'public, max-age=600' } }); x.later(cache.put(ck, r.clone())); }
          const h = new Headers(r.headers); h.set('Access-Control-Allow-Origin', '*');
          return new Response(r.body, { headers: h });
        }
        if (path === '/api/ngay-doi') { // 🎉 Ngày Đôi: web hỏi còn mấy suất quà "N đơn đầu" (ngaydoi.js), lưu đệm 20 giây
          const ck = new Request('https://api.thucduonglanh.vn/api/ngay-doi'), cache = caches.default;
          let r = await cache.match(ck);
          if (!r) { r = new Response(JSON.stringify(await ddStatus(x)), { headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'public, max-age=20' } }); x.later(cache.put(ck, r.clone())); }
          const h = new Headers(r.headers); h.set('Access-Control-Allow-Origin', '*');
          return new Response(r.body, { headers: h });
        }
        if (path === '/api/bridge-check') { const n = String(url.searchParams.get('n') || '').replace(/[^a-f0-9]/g, ''); return json({ ok: !!(n && await kvGet(x.db, 'bn_' + n)) }); }
        if (path === '/api/test-google' || path === '/api/status') { // chỉ Quản trị (trước đây ai cũng gọi được)
          await ensureSchema(x.db);
          if (!await adminByToken(x, url.searchParams.get('token'))) return json({ ok: false, error: 'Chỉ Quản trị: thêm ?token=<mã phiên CRM>' }, origin, 403);
        }
        if (path === '/api/test-google') {
          const r = await fetch(env.BRIDGE_URL, { method: 'POST', headers: { 'Content-Type': 'text/plain;charset=utf-8' }, body: JSON.stringify({ type: 'crm', action: 'ping' }), redirect: 'follow' });
          const text = await r.text();
          return json({ status: r.status, url: r.url, text: text.slice(0, 500) }, origin);
        }
        if (path === '/api/status') {
          const n = async t => (await first(x.db, 'SELECT count(*) AS n FROM ' + t)).n;
          const mr = await kvGet(x.db, 'migrate_result');
          return json({ ok: true, v: API_VERSION, migrated: Number(await kvGet(x.db, 'migrated')) || null, orders: await n('orders'), customers: await n('customers'), leads: await n('leads'), users: await n('users'), mirror: Number(await kvGet(x.db, 'mirror_last')) || null, mirrorErr: await kvGet(x.db, 'mirror_err'), migrate: mr ? JSON.parse(mr) : null }, origin);
        }
        if (path === '/api/setup') { // bước chuyển 1 lần: tắt máy chủ cũ (Apps Script chuyển đơn web sang đây) rồi chép dữ liệu
          if (await kvGet(x.db, 'migrated')) return json({ ok: true, already: true, result: JSON.parse(await kvGet(x.db, 'migrate_result') || 'null') }, origin);
          return json(await migrate(x, { retire: url.searchParams.get('retire') !== '0', apiUrl: url.origin + '/api' }), origin);
        }
        return json({ ok: true, service: 'Thực Dưỡng Lành orders + CRM', v: API_VERSION }, origin);
      }
      if (req.method !== 'POST') return json({ ok: false, error: 'method' }, origin, 405);
      const t0 = Date.now();
      await ensureSchema(x.db);
      const text = await req.text(); if (text.length > (text.startsWith('{"type":"apply"') ? 8e6 : /^\{"type":"crm","action":"ins_s(core|tt)"/.test(text.slice(0, 40)) ? 16e6 : text.startsWith('{"type":"crm","action":"kt_ncc"') ? 4e6 : 2e6)) return json({ ok: false, error: 'Dữ liệu quá lớn' }, origin, 413); // hồ sơ ứng tuyển kèm file CV tới 5 MB · 🧪 chấm bài kèm 8 khung hình + tiếng video ≤ 4 phút (~10 MB)
      const d = JSON.parse(text || '{}');
      if (d.type === 'crm') { x.ua = req.headers.get('user-agent') || ''; const out = await crmApi(x, d, ADMIN, DUPS); out.v = API_VERSION; out.sms = Date.now() - t0; return json(out, origin); } // sms: thời gian máy chủ xử lý → CRM ghi vào "Đo tốc độ CRM"
      if (d.type === 'vtp') return json(await vtpWebhook(x, d.payload), origin);
      return json(await website(x, d), origin);
    } catch (err) {
      console.error('api', err && err.stack || err);
      return json({ ok: false, error: String(err && err.message || err), v: API_VERSION }, origin);
    }
  },
  async scheduled(ev, env, ectx) { const x = ctxOf(env, ectx); await ensureSchema(x.db); ectx.waitUntil(scheduled(x, ev.cron)); }
};
