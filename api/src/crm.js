// CRM: đăng nhập, dữ liệu, đơn hàng, khách, tiềm năng, cài đặt. Chuyển từ Apps Script sang, giữ nguyên cách làm việc & dữ liệu trả về cho giao diện.
import { normPhone, nrm, esc, fmt, startOfDay, TZ_MS, fmtDate, dateOrBlank, slugName, replaceRows, isVoid, randHex, all, first, run, insertMany, allIn, kvGet, kvSet, kvDel, kvJson, DAY, CRM_URL, ROLE_URL, refCode } from './lib.js';
import { crmPartner, partnerSchema, orderAttrib, refClaim, staffOf, staffHit } from './partner.js';
import { chatSchema } from './chat.js';
import { zbotSchema, crmZbot } from './zbot.js';
import { fbSchema, crmFp } from './fb.js';
import { crmBlog } from './blog.js';
import { crmIns } from './insight.js';
import { sendMail, telegram, telegramTo, telegramPhoto, tgUpdates, tgConf, bridge } from './google.js';
import { crmGa, crmGaProp } from './ga.js';
import { crmCfToken } from './cfweb.js';
import { crmMkt, mktFbEdit } from './mkt.js';
import { mktView, mktBudgetSet, mktGoalSet, mktDailyMsgs } from './mktv.js';
import { crmSan, sanSchema, sanAllowed } from './san.js';
import { crmKho, khoSchema, khoRetOut } from './kho.js';
import { fetchXlsx, crmFin } from './fin.js';
import { KT_ROLE_OK, ktSettingsOk, finOk, ktLoad, ktCfg, crmKt, ktKho, crmKtBatch } from './kt.js';
import { crmSaleMkt, crmOffers } from './salemkt.js';
import { cmsTokenSet, quizCms } from './cms.js';
import { crmVoucher, voucherSchema } from './voucher.js';
import { journeySchema, wallHide } from './journey.js';
import { crmLinks } from './links.js';
import { crmAi } from './ai.js';
import { guideAsk, guideAskList } from './guideask.js';
import { aiUsage, aiFund } from './aiuse.js';
import { crmAsk, askAllowed } from './ask.js';
import { crmMcp } from './mcp.js';
import { saleDays } from './zday.js';
import { wbQueue, wbOrderQueue, wbStatusQueue, wbEditQueue, wbDeleteQueue, wbInfoQueue, wbOrderInfo, WB_SHORT } from './wb.js';

let schemaDone = false, deltaOk = false; // deltaOk: đã có cột upd + trigger → cho CRM tải phần thay đổi
const NOW_MS = "CAST((julianday('now') - 2440587.5) * 86400000 AS INTEGER)"; // giờ của máy chủ dữ liệu (ms)
const SCHEMA_V = '2026-11-11a'; // đổi số này khi thêm bảng / cột / chỉ mục bên dưới → lần chạy sau tự kiểm tra lại
export async function ensureSchema(db) {
  if (schemaDone) return;
  // Đã kiểm tra với bản này rồi → chỉ hỏi 1 lần. Trước đây mỗi lần Cloudflare bật máy mới (rất thường xuyên) phải chạy ~25 lệnh nối tiếp, mất 3–5 giây.
  try { const f = await db.prepare("SELECT v FROM kv WHERE k = 'schema_v'").first(); if (f && f.v === SCHEMA_V) { schemaDone = true; deltaOk = true; return; } } catch (e) { }
  try {
    const cols = (await all(db, "PRAGMA table_info(orders)")).map(r => r.name);
    const addCol = async (col, def) => {
      if (!cols.includes(col)) {
        try { await run(db, `ALTER TABLE orders ADD COLUMN ${col} ${def}`); } catch (e) { }
      }
    };
    await addCol('ship_at', 'INTEGER');
    await addCol('received_at', 'INTEGER');
    await addCol('otype', "TEXT DEFAULT ''");
    await addCol('oflag', "TEXT DEFAULT ''");
    await addCol('trk', "TEXT DEFAULT ''");
    await addCol('trk_at', 'INTEGER');
    await addCol('trk_code', 'INTEGER DEFAULT 0');
    await addCol('voucher', "TEXT DEFAULT ''"); // mã ưu đãi khách nhập khi đặt web (api/src/voucher.js)
    await addCol('discount', 'INTEGER DEFAULT 0');
    await addCol('addr_old', "TEXT DEFAULT ''");
    await addCol('ship_fee', 'INTEGER'); // 01/11/2026: phí thật trả hãng vận chuyển (từ file đối soát Best / Viettel Post / xe ôm)
    await addCol('recon', "TEXT DEFAULT ''"); // lần đối soát gần nhất: "Best 01/11"
    await addCol('cash_at', 'INTEGER'); // 💼 09/11/2026: lúc tiền đơn về tài khoản công ty (kế toán ghi tay / file COD Best, Viettel Post) – kt.js
    await addCol('cash_amt', 'INTEGER');
    await addCol('cash_src', "TEXT DEFAULT ''");
    await addCol('cash_acct', "TEXT DEFAULT ''"); // 10/11/2026: tiền về tài khoản nào (Công ty / Anh Sơn / Hộ kinh doanh… – kt_cfg.accts)
    await addCol('cash_why', "TEXT DEFAULT ''"); // 10/11/2026: lý do hãng thu khác tiền trên đơn (Hạ COD hỗ trợ ship, Sale nhập sai…)
 // 20/10/2026: địa chỉ cũ (63 tỉnh, có huyện) – Misa vẫn chọn theo địa chỉ cũ
    // Khách: đã kết bạn Zalo, nhóm cộng đồng, ngày sinh (bản Apps Script có, lúc chuyển sang D1 bị thiếu)
    const ccols = (await all(db, "PRAGMA table_info(customers)")).map(r => r.name);
    for (const [col, def] of [['zalo', 'INTEGER DEFAULT 0'], ['community', "TEXT DEFAULT ''"], ['dob', "TEXT DEFAULT ''"], ['recv', 'INTEGER'], ['ok_n', 'INTEGER DEFAULT 0'], ['back_n', 'INTEGER DEFAULT 0'], ['last_back', 'INTEGER'], ['fam', 'INTEGER DEFAULT 0'], ['addr_old', "TEXT DEFAULT ''"], ['zone', 'INTEGER DEFAULT 0'], ['stop', "TEXT DEFAULT ''"], ['stop_by', "TEXT DEFAULT ''"], ['stop_at', 'INTEGER'], ['stop_ok', 'INTEGER DEFAULT 0']]) if (!ccols.includes(col)) { try { await run(db, `ALTER TABLE customers ADD COLUMN ${col} ${def}`); } catch (e) { } }
    const lcols = (await all(db, "PRAGMA table_info(leads)")).map(r => r.name); // 20/10/2026: khách hỏi do khách khác giới thiệu (SĐT + tên người giới thiệu)
    for (const col of ['ref_phone', 'ref_name', 'how']) if (!lcols.includes(col)) { try { await run(db, `ALTER TABLE leads ADD COLUMN ${col} TEXT DEFAULT ''`); } catch (e) { } }
    for (const [col, def] of [['own_at', 'INTEGER'], ['pool_n', 'INTEGER DEFAULT 0'], ['pool_from', "TEXT DEFAULT ''"], ['pool_warn', 'INTEGER']]) if (!lcols.includes(col)) { try { await run(db, `ALTER TABLE leads ADD COLUMN ${col} ${def}`); } catch (e) { } } // 09/11/2026 🧺 Kho chung: ngày giao người phụ trách, số lần về kho, người giữ trước, lúc đã báo trước 1 ngày
    for (const [col, def] of [['own_src', "TEXT DEFAULT ''"], ['own_at', 'INTEGER'], ['own_by', "TEXT DEFAULT ''"], ['own_ok', 'INTEGER DEFAULT 0'], ['own_flag', "TEXT DEFAULT ''"], ['own_how', "TEXT DEFAULT ''"], ['own_chk', 'INTEGER DEFAULT 0']]) if (!ccols.includes(col)) { try { await run(db, `ALTER TABLE customers ADD COLUMN ${col} ${def}`); } catch (e) { } } // 10/11/2026 🙋 khách sale tự mang về: self / ref / no, ngày đơn đầu, sale được hưởng
    const tcols = (await all(db, "PRAGMA table_info(targets)")).map(r => r.name); // 10/11/2026: mục tiêu khách tự tạo trong tháng (số khách, không tốn quảng cáo)
    if (!tcols.includes('self_n')) { try { await run(db, 'ALTER TABLE targets ADD COLUMN self_n INTEGER DEFAULT 0'); } catch (e) { } }
    const ucols = (await all(db, "PRAGMA table_info(users)")).map(r => r.name);
    if (!ucols.includes('web')) { try { await run(db, "ALTER TABLE users ADD COLUMN web TEXT DEFAULT ''"); } catch (e) { } } // Sửa website: đăng nhập /admin bằng email (api/src/cms.js)
    for (const col of ['phone', 'full', 'acct', 'joined']) if (!ucols.includes(col)) { try { await run(db, `ALTER TABLE users ADD COLUMN ${col} TEXT DEFAULT ''`); } catch (e) { } } // 30/10/2026: SĐT + họ tên đầy đủ nhân sự → cảnh báo nhân sự / người nhà đăng ký CTV (partner.js staffHit)
    if (!ucols.includes('mkv')) { try { await run(db, "ALTER TABLE users ADD COLUMN mkv TEXT DEFAULT ''"); } catch (e) { } }
    if (!ucols.includes('zb')) { try { await run(db, "ALTER TABLE users ADD COLUMN zb TEXT DEFAULT ''"); } catch (e) { } }
    if (!ucols.includes('kho')) { try { await run(db, "ALTER TABLE users ADD COLUMN kho TEXT DEFAULT ''"); } catch (e) { } } // 06/11/2026: 📦 Phụ trách kho (nhận tin sắp hết hàng, nhập / xuất / kiểm kho) // 31/10/2026: 🤖 Phụ trách Trợ lý Zalo (người được giao, kể cả Sale) // 26/10/2026: 📣 Xem Marketing (Quản lý / Sale chỉ xem tab Marketing)
    await run(db, "UPDATE users SET role = 'Sale & CSKH' WHERE role = 'Nhân viên'"); // 15/10/2026: đổi tên quyền
    if (!ccols.includes('zone')) await run(db, "INSERT INTO kv (k, v) VALUES ('recalc_all', '1') ON CONFLICT(k) DO UPDATE SET v = '1'"); // 27/10/2026: vùng giao hàng đọc từ địa chỉ → tính lại mọi khách 1 lần
    if (!ccols.includes('recv')) await run(db, "INSERT INTO kv (k, v) VALUES ('recalc_all', '1') ON CONFLICT(k) DO UPDATE SET v = '1'"); // cột mới (ngày nhận, số đơn hoàn, khách quen) → cron tính lại mọi khách 1 lần
    // 11/10/2026: khách đều nhập từ file sale (đã mua, đã liên hệ) → anh Sơn chọn mặc định tất cả đồng ý nhận ưu đãi. Chạy 1 lần.
    if (!(await db.prepare("SELECT v FROM kv WHERE k = 'consent_all'").first())) { await run(db, 'UPDATE customers SET consent = 1 WHERE consent IS NOT 1'); await run(db, "INSERT INTO kv (k, v) VALUES ('consent_all', ?) ON CONFLICT(k) DO NOTHING", String(Date.now())); }

    await run(db, `CREATE TABLE IF NOT EXISTS perf (
      rid INTEGER PRIMARY KEY AUTOINCREMENT,
      time INTEGER, by_name TEXT DEFAULT '', role TEXT DEFAULT '', what TEXT DEFAULT '',
      total REAL, server REAL, data TEXT DEFAULT '', kb REAL, dev TEXT DEFAULT ''
    )`);
    await run(db, `CREATE INDEX IF NOT EXISTS perf_time ON perf(time)`);

    await run(db, `CREATE TABLE IF NOT EXISTS usage (
      rid INTEGER PRIMARY KEY AUTOINCREMENT,
      day TEXT NOT NULL, email TEXT NOT NULL, name TEXT DEFAULT '',
      opens INTEGER DEFAULT 0, mins REAL DEFAULT 0, screens TEXT DEFAULT '', dev TEXT DEFAULT '',
      first_time INTEGER, last_time INTEGER,
      UNIQUE(day, email)
    )`);
    await run(db, `CREATE INDEX IF NOT EXISTS usage_day ON usage(day)`);

    await run(db, `CREATE TABLE IF NOT EXISTS feedback (
      id TEXT PRIMARY KEY, time INTEGER, by_name TEXT DEFAULT '', email TEXT DEFAULT '',
      kind TEXT DEFAULT 'Góp ý', text TEXT DEFAULT '', route TEXT DEFAULT '', ua TEXT DEFAULT '',
      ver TEXT DEFAULT '', imgs TEXT DEFAULT '', status TEXT DEFAULT 'Mới', reply TEXT DEFAULT '',
      handler TEXT DEFAULT '', updated INTEGER
    )`);

    await run(db, `CREATE TABLE IF NOT EXISTS feedback_images (
      id TEXT NOT NULL, idx INTEGER NOT NULL, data TEXT NOT NULL,
      PRIMARY KEY (id, idx)
    )`);

    await run(db, `CREATE TABLE IF NOT EXISTS sale_phones (
      phone TEXT NOT NULL, src TEXT NOT NULL, sheet TEXT NOT NULL, sale TEXT DEFAULT '', last INTEGER, rows INTEGER DEFAULT 1,
      PRIMARY KEY (phone, src, sheet)
    )`);
    await run(db, `CREATE INDEX IF NOT EXISTS sale_phones_src ON sale_phones(src, sheet)`);
    await run(db, `CREATE INDEX IF NOT EXISTS logs_time ON logs(time)`); // CRM tải nhật ký theo khoảng ngày
    // Cột upd = giờ đổi gần nhất (do máy chủ dữ liệu tự ghi) → CRM chỉ tải phần thay đổi từ lần trước
    try { for (const [t, k] of [['orders', 'rid'], ['customers', 'rowid'], ['leads', 'rid']]) {
      const cs = t === 'orders' ? cols : (await all(db, `PRAGMA table_info(${t})`)).map(r => r.name);
      if (!cs.includes('upd')) { try { await run(db, `ALTER TABLE ${t} ADD COLUMN upd INTEGER`); } catch (e) { } }
      await run(db, `CREATE INDEX IF NOT EXISTS ${t}_upd ON ${t}(upd)`);
      await run(db, `CREATE TRIGGER IF NOT EXISTS ${t}_upd_i AFTER INSERT ON ${t} BEGIN UPDATE ${t} SET upd = ${NOW_MS} WHERE ${k} = NEW.${k}; END`);
      await run(db, `CREATE TRIGGER IF NOT EXISTS ${t}_upd_u AFTER UPDATE ON ${t} WHEN NEW.upd IS OLD.upd BEGIN UPDATE ${t} SET upd = max(${NOW_MS}, coalesce(NEW.upd, 0) + 1) WHERE ${k} = NEW.${k}; END`); // luôn khác giá trị cũ → không tự gọi lại
    }
    deltaOk = true; } catch (e) { console.error('ensureSchema upd', e.message); } // lỗi thì CRM vẫn tải đủ như cũ
    // Đổi người phụ trách trên CRM (A → B, không tính lúc giao khách chưa ai giữ) → adsSync ghi lại vào cột Trùng sale của file số quảng cáo
    await run(db, `CREATE TABLE IF NOT EXISTS owner_chg (id INTEGER PRIMARY KEY AUTOINCREMENT, phone TEXT, owner TEXT, at INTEGER)`);
    for (const t of ['customers', 'leads']) await run(db, `CREATE TRIGGER IF NOT EXISTS ${t}_owner_chg AFTER UPDATE OF owner ON ${t}
      WHEN coalesce(OLD.owner, '') != '' AND coalesce(NEW.owner, '') != '' AND OLD.owner != NEW.owner${t === 'leads' ? " AND NEW.status IN ('Mới hỏi', 'Đang tư vấn')" : ''}
      BEGIN INSERT INTO owner_chg (phone, owner, at) VALUES (NEW.phone, NEW.owner, ${NOW_MS}); END`);
    await run(db, `CREATE TABLE IF NOT EXISTS dup_done (phone TEXT PRIMARY KEY, owner TEXT DEFAULT '', sales TEXT DEFAULT '', by_name TEXT DEFAULT '', at INTEGER)`);
    await run(db, `CREATE TABLE IF NOT EXISTS ad_spend (
        day TEXT NOT NULL, channel TEXT NOT NULL, account TEXT NOT NULL DEFAULT '', campaign TEXT NOT NULL DEFAULT '',
        spend INTEGER DEFAULT 0, impressions INTEGER DEFAULT 0, clicks INTEGER DEFAULT 0, msgs INTEGER DEFAULT 0, leads INTEGER DEFAULT 0, purchases INTEGER DEFAULT 0,
        src TEXT DEFAULT '', batch TEXT DEFAULT '', note TEXT DEFAULT '', at INTEGER,
        PRIMARY KEY (day, channel, account, campaign)
      )`); // chi phí quảng cáo theo ngày (api/src/mkt.js)
    await run(db, 'CREATE INDEX IF NOT EXISTS ad_spend_batch ON ad_spend(batch)');
    await sanSchema(db); // đơn sàn TMĐT (api/src/san.js)
    await khoSchema(db); // 📦 kho hàng (api/src/kho.js), sau sanSchema (thêm chỉ mục cho san_orders)
    await voucherSchema(db); // mã ưu đãi (api/src/voucher.js)
    await journeySchema(db); // lời cam kết sống lành (api/src/journey.js)
    await partnerSchema(db); // 🤝 CTV / đối tác + 🎁 khách giới thiệu (api/src/partner.js)
    await chatSchema(db); // 💬 trợ lý chat trên web (api/src/chat.js)
    await zbotSchema(db); // 🤖 trợ lý nhóm Zalo (api/src/zbot.js)
    await fbSchema(db); // 📘 trợ lý Fanpage Facebook (api/src/fb.js)
    schemaDone = true;
    if (deltaOk) await run(db, "INSERT INTO kv (k, v) VALUES ('schema_v', ?) ON CONFLICT(k) DO UPDATE SET v = excluded.v, exp = NULL", SCHEMA_V);
  } catch (e) {
    console.error('ensureSchema', e.message);
  }
}

export const SUPER_ADMIN = 'thaisoniph@gmail.com'; // luôn có quyền Quản trị
const ROLES = { 'Quản trị': 3, 'Quản lý': 2, 'Sale & CSKH': 1, 'Marketing': 0, 'Kho': 0, 'Kế toán': 0 }; // Kế toán (09/11/2026): chỉ tab 💼 Kế toán (kt.js: tiền về, tiền treo ở hãng, chi phí, lãi lỗ), không thấy SĐT / địa chỉ khách // Kho (09/11/2026, anh Sơn tách khỏi Sale): chỉ tab 📦 Kho + nhận hàng hoàn (KHO_ROLE_OK), không thấy khách / doanh số
// Marketing: chỉ thấy tab 📣 Marketing (MKT_ACTIONS), không thấy khách / đơn / doanh thu công ty
const SALE = 'Sale & CSKH'; // 15/10/2026: đổi tên từ "Nhân viên" (tên cũ vẫn nhận, tự quy về tên mới)
const roleOf = r => r === 'Nhân viên' ? SALE : Object.hasOwn(ROLES, r || '') ? r : SALE;
const BOT_USERNAME = 'thucduonglanh_donhang_bot';
const ASSIGN_MODES = { auto: 'Tự chia đều', manager: 'Quản lý giao tay', pool: 'Kho chung' };
const SESSION_DAYS = 30;
const TASK_LABEL = { callback: 'Gọi lại theo hẹn', d1: 'Hỏi nhận hàng', runout: 'Nhắc đặt lại', d7: 'Hỏi thăm sau 1 tuần', d14: 'Xin cảm nhận', d30: 'Giới thiệu sản phẩm', winback: 'Mời quay lại', old: 'Gọi khách cũ', other: 'Chăm sóc' };
export const ORDER_STATUS = ['Mới', 'Đã xác nhận', 'Đang giao', 'Đã giao', 'Huỷ', 'Đang chuyển hoàn', 'Hoàn', 'Đổi hàng']; // 05/11/2026: Đang chuyển hoàn = hãng đang trả về; kho nhận đủ hàng mới bấm Hoàn
const OPEN_STATUS = ['Mới', 'Đã xác nhận', 'Đang giao'];
const CARE_RESULTS = ['Đã đặt lại', 'Hẹn gọi lại', 'Không nghe máy', 'Đã hỏi thăm', 'Không có nhu cầu'];
export const LEAD_STATUS = ['Mới hỏi', 'Đang tư vấn', 'Đã chốt', 'Không mua'];
const CA_LIST = ['Ngày', 'Tối/CN', 'Lễ'];
/* Loại đơn (tính hoa hồng): CRM gợi ý theo ca / khách quảng cáo / đã mua chưa; nhân viên chọn khác gợi ý → "Kiểm tra loại đơn" chờ quản lý */
const OTYPES = ['Khách mới', 'Khách cũ', 'Ngoài giờ', 'Ngày lễ'], AD_LEAD_DAYS = 30, AD_CH = /^(quảng cáo|ebook|form website)/i;
function otypeCa(t) { return t === 'Ngày lễ' ? 'Lễ' : t === 'Ngoài giờ' ? 'Tối/CN' : 'Ngày'; }
async function otypeSuggest(x, phone, t) {
  const ca = caOf(t, await caCfg(x)), dm = v => fmtDate(v, 'dd/MM');
  if (ca === 'Lễ') return { t: 'Ngày lễ', why: 'đơn tạo ngày lễ ' + dm(t) };
  if (ca === 'Tối/CN') return { t: 'Ngoài giờ', why: 'đơn tạo ' + (new Date(t + 7 * 3600e3).getUTCDay() === 0 ? 'Chủ nhật' : 'sau giờ ca tối') };
  phone = normPhone(phone);
  // 31/10/2026 (anh Sơn duyệt, như chế độ cũ): khách mới do khách cũ giới thiệu → hoa hồng như Khách cũ (cộng thêm thưởng giới thiệu, partner.js)
  const rf = (await first(x.db, 'SELECT ref_phone FROM ref_sale WHERE phone = ? AND void = 0', phone)) || (await first(x.db, "SELECT ref_phone FROM leads WHERE phone = ? AND coalesce(ref_phone, '') != '' ORDER BY rid DESC LIMIT 1", phone));
  if (rf && rf.ref_phone) { const rc = await first(x.db, 'SELECT name FROM customers WHERE phone = ?', rf.ref_phone); return { t: 'Khách cũ', why: 'khách do khách cũ ' + ((rc && rc.name) || rf.ref_phone) + ' giới thiệu (hoa hồng theo luật khách tự mang về, xem 💰 Thu nhập tạm tính)' }; }
  const ad = (await all(x.db, 'SELECT channel, time FROM leads WHERE phone = ? AND time >= ? AND time <= ? ORDER BY time DESC', phone, t - AD_LEAD_DAYS * DAY, t + DAY)).find(l => AD_CH.test(l.channel || ''));
  if (ad) return { t: 'Khách mới', why: 'khách để lại số qua ' + ad.channel + ' ngày ' + dm(ad.time) };
  const v = await first(x.db, 'SELECT first, orders FROM customers WHERE phone = ?', phone);
  if (v && v.first && v.first < t - 3600e3) return { t: 'Khách cũ', why: 'đã mua từ ' + fmtDate(v.first, 'dd/MM/yy') + ' (' + (Number(v.orders) || 1) + ' đơn)' };
  return { t: 'Khách mới', why: 'lần đầu mua' };
}
function otypeFlag(chosen, sug) { return chosen && chosen !== sug.t ? 'CRM gợi ý ' + sug.t + ': ' + sug.why : ''; }
export const VIP_ORDERS = 3, VIP_SPENT = 2000000, AT_RISK_DAYS = 60, COOL_DAYS = 14, SHIP_DAYS = 3, SHIP_FAR = 5, FAM_MIN = 1, FAM_GAP = 180; // COOL_DAYS: khách vừa trả lời chăm sóc → bao nhiêu ngày sau mới nhắc lại (0 = tắt)
const NOTE_MAX = 400; // nhật ký dài chỉ gửi phần đầu khi mở CRM; mở hồ sơ khách mới tải đủ (cust_orders)
export const LINES = [['Fucoidan Pro', /progomax|fucoidan pro|fu ?pro/i], ['Curcumin', /curcumin|nghệ/i], ['BADD', /bữa ăn|badd|bua an/i]];
export const DEFAULT_CYCLES = [
  ['DILVANG', '', 6, '15 gói, dùng 2–3 gói/ngày (theo nhãn)'], ['Bữa Ăn Dinh Dưỡng', '500g', 10, '20 gói, khoảng 2 gói/ngày'], ['Bữa Ăn Dinh Dưỡng', '125g', 3, '5 gói, khoảng 2 gói/ngày'],
  ['Curcumin', '400g', 7, '30g/lần, 2 lần/ngày'], ['Curcumin', '125g', 2, '30g/lần, 2 lần/ngày'], ['Ruốc', '215g', 10, 'Ước tính – chỉnh theo thực tế'], ['Ruốc', '165g', 8, 'Ước tính – chỉnh theo thực tế'],
  ['Xì Dầu', '', 30, 'Ước tính – chỉnh theo thực tế'], ['Progomax', '900g', 15, 'Ước tính 30g/lần, 2 lần/ngày – chỉnh theo thực tế'], ['Progomax', '400g', 7, 'Ước tính 30g/lần, 2 lần/ngày – chỉnh theo thực tế'],
  ['Gafo', '800g', 13, 'Ước tính 30g/lần, 2 lần/ngày – chỉnh theo thực tế'], ['Gafo', '500g', 8, 'Ước tính 30g/lần, 2 lần/ngày – chỉnh theo thực tế'], ['Curcumin', '900g', 15, 'Ước tính 30g/lần, 2 lần/ngày – chỉnh theo thực tế'],
  ['Vimy', '900g', 15, 'Ước tính 30g/lần, 2 lần/ngày – chỉnh theo thực tế'], ['Ngũ cốc', '900g', 15, 'Ước tính 30g/lần, 2 lần/ngày – chỉnh theo thực tế'], ['Ngũ cốc', '400g', 7, 'Ước tính 30g/lần, 2 lần/ngày – chỉnh theo thực tế']];
export const DEFAULT_TEMPLATES = [
  ['1 ngày sau khi đặt', 'Hỏi nhận hàng + hướng dẫn dùng', 'Dạ em chào [Tên] ạ, em là nhân viên Thực Dưỡng Lành. [Tên] đã nhận được [Sản phẩm] chưa ạ? Em gửi mình cách dùng để đạt hiệu quả tốt nhất: … Có gì chưa rõ [Tên] cứ nhắn em nhé ❤️'],
  ['Trước khi hết sản phẩm', 'Nhắc đặt lại', 'Dạ [Tên] ơi, theo lịch thì [Sản phẩm] của mình sắp hết rồi ạ. [Tên] có muốn em lên đơn tiếp để dùng không bị gián đoạn không ạ? Đơn từ 300.000đ được miễn phí vận chuyển ạ.'],
  ['14 ngày sau khi đặt', 'Xin cảm nhận', 'Dạ em chào [Tên], mình dùng [Sản phẩm] được 2 tuần rồi, [Tên] thấy thế nào ạ? Cảm nhận của [Tên] giúp Thực Dưỡng Lành làm tốt hơn mỗi ngày ạ 🙏'],
  ['30 ngày sau khi đặt', 'Giới thiệu sản phẩm phù hợp', 'Dạ [Tên] ơi, ngoài [Sản phẩm], Thực Dưỡng Lành còn … phù hợp để bữa ăn cân bằng hơn. Em gửi [Tên] tham khảo nhé: https://thucduonglanh.vn/san-pham/'],
  ['60 ngày chưa mua lại', 'Mời quay lại', 'Dạ lâu rồi em chưa được phục vụ [Tên] ạ. Tháng này Thực Dưỡng Lành có ưu đãi dành riêng cho khách cũ … [Tên] cần em tư vấn gì cứ nhắn em nhé ❤️'],
  ['Khách mới hỏi', 'Chào hỏi, tư vấn', 'Dạ em chào [Tên] ạ, em là nhân viên Thực Dưỡng Lành. Em thấy mình đang quan tâm đến [Sản phẩm]. [Tên] cho em hỏi mình mua dùng cho bản thân hay cho người nhà, và đang mong muốn cải thiện điều gì ạ? Em tư vấn để mình chọn đúng sản phẩm nhé ❤️']];

/* ================================================================ cài đặt chung (bảng kv) */
export async function rulesCfg(x) {
  if (x._rules) return x._rules;
  const r = await kvJson(x.db, 'rules_cfg', {}) || {};
  return (x._rules = { vipOrders: Number(r.vipOrders) || VIP_ORDERS, vipSpent: Number(r.vipSpent) || VIP_SPENT, atRisk: Number(r.atRisk) || AT_RISK_DAYS, coolDays: r.coolDays !== undefined && r.coolDays !== '' ? Number(r.coolDays) : COOL_DAYS,
    shipDays: r.shipDays !== undefined && r.shipDays !== '' ? Number(r.shipDays) : SHIP_DAYS, shipFar: r.shipFar !== undefined && r.shipFar !== '' ? Number(r.shipFar) : SHIP_FAR, famMin: r.famMin !== undefined && r.famMin !== '' ? Number(r.famMin) : FAM_MIN,
    poolDays: r.poolDays !== undefined && r.poolDays !== '' ? Number(r.poolDays) : POOL_DAYS, poolNoCall: r.poolNoCall !== undefined && r.poolNoCall !== '' ? Number(r.poolNoCall) : POOL_NOCALL, poolIdle: r.poolIdle !== undefined && r.poolIdle !== '' ? Number(r.poolIdle) : POOL_IDLE, poolMax: r.poolMax !== undefined && r.poolMax !== '' ? Number(r.poolMax) : POOL_MAX, selfOn: r.selfOn ? 1 : 0, poolOn: r.poolOn ? 1 : 0 }); // poolOn: 11/11/2026 anh Sơn tạm ẩn Kho chung (tự về kho + mục 🧺 của sale) tới sau họp sale. selfOn: 10/11/2026 anh Sơn tạm ẩn mục Tự tạo khách tới sau họp sale, Quản trị bật ở Cài đặt
}
export async function caCfg(x) { if (!x._ca) x._ca = await kvJson(x.db, 'ca_cfg', {}) || {}; return x._ca; }
export async function assignMode(x) { if (!x._mode) x._mode = (await kvGet(x.db, 'assign_mode')) || 'pool'; return x._mode; }
export function groupOf(orders, spent, last, R) {
  if (last && (Date.now() - last) / DAY > R.atRisk) return 'Sắp mất';
  if (orders >= R.vipOrders || spent >= R.vipSpent) return 'VIP';
  if (orders >= 2) return 'Quay lại';
  return 'Mới';
}
/** Ca: Lễ (ngày lễ trong Cài đặt) / Tối-CN (sau giờ ca tối hoặc Chủ nhật) / Ngày. */
export function caOf(t, cfg) {
  const d = new Date(Number(t) + 7 * 3600e3), pad = n => (n < 10 ? '0' : '') + n;
  const dm = pad(d.getUTCDate()) + '/' + pad(d.getUTCMonth() + 1), ev = String(cfg.evening || '17:30').split(':');
  if ((cfg.holidays || ['01/01', '30/04', '01/05', '02/09']).indexOf(dm) >= 0) return 'Lễ';
  if (d.getUTCDay() === 0) return 'Tối/CN';
  if (d.getUTCHours() * 60 + d.getUTCMinutes() >= (+ev[0]) * 60 + (+ev[1] || 0)) return 'Tối/CN';
  return 'Ngày';
}
export function lineOf(text) { for (const l of LINES) if (l[1].test(String(text || ''))) return l[0]; return 'Khác'; }
export function normLine(v, fallbackText) { const t = String(v || '').trim(); if (!t) return lineOf(fallbackText); const l = lineOf(t); return l !== 'Khác' ? l : (/khác/i.test(t) || !lineOf(fallbackText) ? 'Khác' : lineOf(fallbackText)); }

/* ================================================================ nhân sự */
const no = v => /^(không|khong|no|0|false)$/i.test(String(v == null ? '' : v).trim());
export async function crmUsers(x) {
  if (x._users) return x._users;
  return usersFrom(x, await all(x.db, USERS_SQL));
}
const USERS_SQL = 'SELECT * FROM users ORDER BY ord, rowid';
function usersFrom(x, rows) {
  const list = rows.map(r => {
    const e = String(r.email || '').trim().toLowerCase(), role = roleOf(r.role);
    return { email: e, name: String(r.name || e.split('@')[0]).trim(), role, active: !!r.active, recv: role === 'Marketing' || role === 'Kho' || role === 'Kế toán' ? false : String(r.recv || '').trim() === '' ? role === SALE : !no(r.recv), tg: String(r.tg || '').trim(), alias: String(r.alias || '').trim(), prefix: String(r.prefix || '').trim(), web: String(r.web || '').trim() === 'Có', phone: String(r.phone || '').trim(), full: String(r.full || '').trim(), acct: String(r.acct || '').trim(), joined: String(r.joined || '').trim(), mkv: role !== 'Marketing' && role !== 'Kho' && String(r.mkv || '').trim() === 'Có', zb: role !== 'Kho' && String(r.zb || '').trim() === 'Có', kho: role === 'Kho' || String(r.kho || '').trim() === 'Có' };
  }).filter(u => /@/.test(u.email));
  const sa = list.find(u => u.email === SUPER_ADMIN);
  if (!sa) list.unshift({ email: SUPER_ADMIN, name: 'Thái Sơn', role: 'Quản trị', active: true, recv: false, tg: '', alias: '', prefix: '', web: true });
  else { sa.role = 'Quản trị'; sa.active = true; }
  list.forEach(u => { u.level = ROLES[u.role]; });
  return (x._users = list);
}
/** Khoá so tên người: không phân biệt vị trí đặt dấu thanh (Thuỷ = Thủy), hoa thường, khoảng trắng. Vẫn phân biệt Thủy ≠ Thúy. */
const TONES = /[̣̀́̃̉]/g;
export function nameKey(s) { return String(s || '').normalize('NFD').toLowerCase().trim().split(/\s+/).map(w => w.replace(TONES, '') + (w.match(TONES) || []).join('')).join(' '); }
/** Tên nhân sự gõ khác cách đặt dấu (dữ liệu cũ từ Sheet, đổi tên ở Nhân sự…) → đưa về đúng tên tài khoản, để khách không bị tách thành 2 người phụ trách. */
const NAME_COLS = [['customers', 'owner'], ['customers', 'last_seller'], ['orders', 'seller'], ['leads', 'owner'], ['sources', 'sale'], ['sale_phones', 'sale'], ['dup_done', 'owner'], ['logs', 'by_name']];
export async function unifyNames(x, ren) {
  ren = ren || {}; // { tên cũ: tên mới } – vừa đổi tên ở Cài đặt → Nhân sự
  const us = await crmUsers(x), by = {}, al = {}; us.forEach(u => { const k = nameKey(u.name); (by[k] = by[k] || []).indexOf(u.name) < 0 && by[k].push(u.name); });
  us.forEach(u => { const k = nameKey(u.alias); if (u.alias && !by[k]) (al[k] = al[k] || []).push(u.name); }); // tên gọi tắt ("Chang" của "Thu Chang") – file sale hay ghi tên này
  const fix = v => { if (ren[v]) return ren[v]; const s = by[nameKey(v)] || al[nameKey(v)]; return s && s.length === 1 && s[0] !== v ? s[0] : ''; }; // 2 tài khoản cùng khoá: không tự gộp
  let n = 0;
  for (const [t, c] of NAME_COLS) for (const r of await all(x.db, `SELECT DISTINCT ${c} AS v FROM ${t} WHERE ${c} != ''`)) {
    const to = fix(r.v); if (to) n += (await run(x.db, `UPDATE ${t} SET ${c} = ? WHERE ${c} = ?`, to, r.v)).meta.changes;
  }
  for (const r of await all(x.db, "SELECT DISTINCT name AS v FROM targets WHERE name != ''")) { const to = fix(r.v); if (to) { n += (await run(x.db, 'UPDATE OR IGNORE targets SET name = ? WHERE name = ?', to, r.v)).meta.changes; await run(x.db, 'DELETE FROM targets WHERE name = ?', r.v); } } // tháng đã có mục tiêu theo tên đúng: giữ bản đó
  for (const r of await all(x.db, "SELECT phone, sales FROM dup_done WHERE sales != ''")) {
    const s = String(r.sales).split('|').map(v => fix(v) || v), j = [...new Set(s)].join('|'); if (j !== r.sales) { await run(x.db, 'UPDATE dup_done SET sales = ? WHERE phone = ?', j, r.phone); n++; }
  }
  return n;
}
export async function crmUser(x, email) { email = String(email || '').trim().toLowerCase(); return (await crmUsers(x)).find(u => u.email === email && u.active) || null; }
function publicUser(u) { return { email: u.email, name: u.name, role: u.role, level: u.level, web: !!u.web || u.level >= 3, ask: askAllowed(u), tg: !!u.tg, prefix: u.prefix || slugName(u.name), mkv: !!u.mkv, zb: !!u.zb, kho: !!u.kho }; }
async function userSet(x, email, field, value) {
  const r = await run(x.db, `UPDATE users SET ${field} = ? WHERE email = ?`, value, email);
  if (!r.meta.changes && email === SUPER_ADMIN) { await run(x.db, "INSERT INTO users (email, name, role, active, recv, ord) VALUES (?, 'Thái Sơn', 'Quản trị', 1, 'Không', -1)", SUPER_ADMIN); await run(x.db, `UPDATE users SET ${field} = ? WHERE email = ?`, value, email); }
  x._users = null;
}

/* ================================================================ nhật ký */
export async function crmLog(x, u, what, ref, name, result, note) {
  await run(x.db, 'INSERT INTO logs (time, by_name, what, ref, name, result, note) VALUES (?, ?, ?, ?, ?, ?, ?)', Date.now(), u.name || '', what, String(ref == null ? '' : ref), name || '', result || '', note || '');
}

/* ================================================================ khách hàng: tính lại từ đơn hàng */
export async function cyclesList(x) {
  if (!x._cycles) x._cycles = (await all(x.db, 'SELECT name, variant, days, basis FROM cycles ORDER BY rid')).filter(r => r.name && r.days).map(r => [String(r.name), String(r.variant || ''), Number(r.days) || 0, String(r.basis || '')]);
  return x._cycles;
}
function usageDays(cycles, name, variant) {
  const full = (String(name) + ' ' + String(variant || '')).toLowerCase();
  for (const r of cycles) if (full.indexOf(String(r[0]).toLowerCase()) >= 0 && (!r[1] || full.indexOf(String(r[1]).toLowerCase()) >= 0)) return Number(r[2]) || 0;
  return 0;
}
/** Ngày dự kiến hết hàng = ngày đặt + (số ngày dùng × số lượng) của món dùng LÂU nhất trong đơn (anh Sơn chốt 07/11/2026: đơn có nhiều món thì khách còn dùng món lâu hết, chưa cần nhắc). */
function runOutDate(cycles, items, t) { let best = 0; (items || []).forEach(i => { const d = usageDays(cycles, i.name, i.variant) * (Number(i.qty) || 1); if (d && d > best) best = d; }); return best ? t + best * DAY : null; }
/** Đọc dòng sản phẩm đã lưu: "Tên (quy cách) x2 = 280.000 ₫". Bỏ dòng quà tặng (🎁). */
export function parseItemLines(text) { return String(text || '').split('\n').map(l => { if (/^🎁/.test(l)) return null; const m = l.match(/^(.*?)(?: \((.*?)\))? x(\d+) =/); return m ? { name: m[1], variant: m[2] || '', qty: +m[3] } : null; }).filter(Boolean); }

const CUS_COLS = ['phone', 'name', 'address', 'province', 'ward', 'orders', 'spent', 'first', 'last', 'products', 'runout', 'consent', 'source', 'owner', 'last_status', 'last_ca', 'last_seller', 'recv', 'ok_n', 'back_n', 'last_back', 'fam', 'zone'];
/** Vùng giao hàng (gửi từ Hà Nội, sale báo 27/10/2026): 1 = gần (miền Bắc + Thanh Hóa, Nghệ An, Hà Tĩnh) ~3 ngày, 2 = xa (miền Trung, miền Nam) ~5 ngày, 0 = không đọc được tỉnh. */
const NEAR_PROV = ['Hà Nội', 'Hải Phòng', 'Quảng Ninh', 'Bắc Ninh', 'Hưng Yên', 'Ninh Bình', 'Phú Thọ', 'Thái Nguyên', 'Tuyên Quang', 'Lào Cai', 'Lạng Sơn', 'Cao Bằng', 'Lai Châu', 'Điện Biên', 'Sơn La', 'Thanh Hóa', 'Nghệ An', 'Hà Tĩnh'];
export function zoneOf(text) { const pv = provOfAddr(text || ''); return !pv ? 0 : NEAR_PROV.indexOf(pv.nw) >= 0 ? 1 : 2; }
/** Số ngày giao ước tính theo vùng (Cài đặt → Nhóm khách); không rõ vùng = trung bình 2 mức. */
export function shipOf(zone, R) { const a = R.shipDays || 0, b = R.shipFar == null ? a : R.shipFar; return zone === 1 ? a : zone === 2 ? b : Math.round((a + b) / 2); }
/**
 * Tính lại khách của các số điện thoại (từ toàn bộ đơn, bỏ đơn Huỷ / Hoàn). Giữ nguyên các cột nhân viên điền (ghi chú, hẹn, nhãn…).
 * opt.owners = {sđt: tên} gán người phụ trách cho khách chưa có; opt.sellerOwner = tên sale: khách chưa ai phụ trách mà đơn gần nhất do sale này bán → giao cho sale.
 */
/** Tên sản phẩm trong ô "Sản phẩm" của đơn → khoá so sánh (bỏ quà 🎁, số lượng, giá, quy cách 400g/900g…). */
function prodKeys(items) {
  return String(items || '').split(/\n|;\s*/).map(l => l.trim()).filter(l => l && !/^🎁/.test(l)).map(l => l.replace(/=.*$/, '').replace(/\s*x\s*\d+\s*$/i, '').toLowerCase().replace(/\(.*?\)/g, ' ')
    .replace(/\d+([.,]\d+)?\s*(g|gr|gram|kg|ml|l|gói|goi|hộp|hop|hũ|hu|lon)(?=\s|$)/g, ' ').replace(/[^0-9a-zà-ỹđ]+/g, ' ').replace(/\s+/g, ' ').trim()).filter(k => k.length >= 3);
}
/** Khách quen sản phẩm: mọi sản phẩm trong đơn gần nhất (không huỷ/hoàn) khách đã nhận ≥ min lần trước đó (lần gần nhất trong FAM_GAP ngày), đơn liền trước không bị hoàn.
 *  → đã biết cách dùng: không nhắc hỏi nhận hàng / 14 ngày. min = 0: tắt. list: đơn của 1 khách, xếp theo thời gian. */
function famOf(list, min) {
  if (!min) return false;
  let xi = -1; for (let i = list.length - 1; i >= 0; i--) if (!isVoid(list[i].status) && list[i].time) { xi = i; break; }
  if (xi < 0) return false;
  const x = list[xi], keys = prodKeys(x.items), t = x.time || 0; if (!keys.length) return false;
  const prev = list.slice(0, xi).filter(o => (o.time || 0) < t); if (!prev.length) return false;
  if (/hoàn/i.test(prev[prev.length - 1].status || '')) return false; // đơn trước bị hoàn: gọi lại cho chắc
  const pk = prev.filter(o => !isVoid(o.status)).map(o => ({ time: o.time || 0, keys: prodKeys(o.items) })), same = (a, b) => a === b || a.indexOf(b) >= 0 || b.indexOf(a) >= 0;
  return keys.every(k => { const hit = pk.filter(o => o.keys.some(q => same(k, q))); return hit.length >= min && t - hit[hit.length - 1].time <= FAM_GAP * DAY; });
}
/** Nguồn khách (theo đơn đầu tiên): Website (khách tự đặt trên web) hoặc kênh sale chọn khi lên đơn / kênh khách hỏi.
 *  Anh Sơn 12/10/2026: trước ngày 13/10/2026 mọi khách đều từ quảng cáo Facebook, trừ khách tự đặt web (chị Vân là khách web đầu tiên). */
const SRC_CUT = Date.parse('2026-10-13T00:00:00+07:00'), FB_ADS = 'Facebook Ads';
/** Đơn khách tự đặt trên web: mã TDL…, hoặc đã đổi sang mã sale gõ trong file (ghi chú "Mã web TDL…"). */
export function isWebId(o) { return /^TDL\d/.test(o.id || '') || /Mã web TDL\d/.test(o.note || ''); }
export function custSource(o) {
  const s = String(o.source || '').trim(), m = s.match(/^(Nhập tay|Tiềm năng)\s*[–-]\s*(.*)$/);
  if (!/^File /.test(s) && !m && isWebId(o)) return 'Website';
  if ((o.time || 0) < SRC_CUT || /^File /.test(s) || !m) return FB_ADS; // file sale = số từ quảng cáo Facebook
  const k = nrm(m[2]);
  if (/facebook|\bfb\b|messenger|instagram|quang cao/.test(k)) return FB_ADS;
  if (/website|web/.test(k)) return 'Website';
  if (/zalo/.test(k)) return 'Zalo';
  if (/tiktok/.test(k)) return 'TikTok';
  if (/shopee|lazada/.test(k)) return m[2].trim();
  if (/gioi thieu|nguoi quen|khach quen/.test(k)) return 'Khách giới thiệu';
  if (/dien thoai|hotline/.test(k)) return 'Gọi hotline';
  if (/su kien|hoi thao/.test(k)) return 'Sự kiện / hội thảo';
  if (/cua hang/.test(k)) return 'Tại cửa hàng';
  return m[2].trim() || 'Khác';
}
export async function recalc(x, phones, opt) {
  opt = opt || {};
  const list = [...new Set((phones || []).map(normPhone).filter(Boolean))]; if (!list.length) return 0;
  const cycles = await cyclesList(x), R = await rulesCfg(x); let n = 0;
  for (let i = 0; i < list.length; i += 400) {
    const part = list.slice(i, i + 400);
    const rows = await all(x.db, 'SELECT id, note, phone, time, status, items, total, consent, first_source, source, seller, name, address, province, ward, addr_old, ca, received_at, ship_at FROM orders WHERE phone IN (SELECT value FROM json_each(?)) ORDER BY time, rid', JSON.stringify(part));
    const map = {};
    for (const r of rows) {
      const c = map[r.phone] || (map[r.phone] = { orders: 0, spent: 0, first: null, last: null, bought: [], run: null, consent: 0, src: '', lastT: -1, lastStatus: '', lastCa: '', seller: '', okN: 0, backN: 0, lastBack: null, recv: null, zone: 0, list: [] });
      c.list.push(r); if (/hoàn/i.test(r.status || '')) { c.backN++; if ((r.time || 0) > (c.lastBack || 0)) c.lastBack = r.time || 0; } else if (!isVoid(r.status) && r.time) c.okN++;
      if ((r.time || 0) >= c.lastT) { c.lastT = r.time || 0; c.lastStatus = r.status || ''; if (!isVoid(r.status)) c.lastCa = r.ca || ''; }
      if (isVoid(r.status) || !r.time) continue;
      if (!c.orders) { c.first = r.time; c.src = custSource(r); }
      c.orders++; c.spent += Number(r.total) || 0; c.last = r.time; if (r.seller) c.seller = r.seller;
      ['name', 'address', 'province', 'ward'].forEach(h => { if (r[h] !== '' && r[h] != null) c[h] = r[h]; });
      const items = parseItemLines(r.items);
      items.forEach(it => { const nm = it.name + (it.variant ? ' (' + it.variant + ')' : ''); if (c.bought.indexOf(nm) < 0) c.bought.push(nm); });
      c.recv = r.received_at || null; // ngày khách nhận đơn gần nhất (chưa biết thì để trống)
      const z = zoneOf([r.address, r.ward, r.province, r.addr_old].join(' ')); if (z) c.zone = z; // vùng theo địa chỉ đơn gần nhất đọc được tỉnh
      const sd = shipOf(z || c.zone, R) * DAY, ro = runOutDate(cycles, items, r.received_at || (r.ship_at ? r.ship_at + sd : r.time + sd)); if (ro) c.run = ro; // dùng hết tính từ ngày nhận hàng (chưa biết thì ngày gửi / ngày đặt + số ngày giao theo vùng)
      if (r.consent) c.consent = 1;
    }
    const up = [], zero = [];
    for (const ph of part) {
      const c = map[ph];
      if (!c || !c.orders) { zero.push({ phone: ph, last_status: c ? c.lastStatus : '', last_ca: c ? c.lastCa : '', back_n: c ? c.backN : 0, last_back: c ? c.lastBack : null }); continue; }
      let owner = (opt.owners && opt.owners[ph]) || '';
      if (!owner && opt.sellerOwner && c.seller === opt.sellerOwner) owner = opt.sellerOwner;
      up.push({ phone: ph, name: c.name || '', address: c.address || '', province: c.province || '', ward: c.ward || '', orders: c.orders, spent: c.spent, first: c.first, last: c.last, products: c.bought.join('; '), runout: c.run, consent: c.consent, source: c.src, owner, last_status: c.lastStatus, last_ca: c.lastCa, last_seller: c.seller,
        recv: c.recv, ok_n: c.okN, back_n: c.backN, last_back: c.lastBack, fam: famOf(c.list, R.famMin) ? 1 : 0, zone: c.zone });
    }
    await insertMany(x.db, 'customers', CUS_COLS, up, `ON CONFLICT(phone) DO UPDATE SET name = excluded.name, address = excluded.address, province = excluded.province, ward = excluded.ward, orders = excluded.orders, spent = excluded.spent,
      first = excluded.first, last = excluded.last, products = excluded.products, runout = excluded.runout, consent = max(coalesce(customers.consent, 0), excluded.consent), source = excluded.source, last_status = excluded.last_status, last_ca = excluded.last_ca, last_seller = excluded.last_seller,
      recv = excluded.recv, ok_n = excluded.ok_n, back_n = excluded.back_n, last_back = excluded.last_back, fam = excluded.fam, zone = excluded.zone,
      owner = CASE WHEN customers.owner IS NULL OR customers.owner = '' THEN excluded.owner ELSE customers.owner END`);
    if (zero.length) await run(x.db, "UPDATE customers SET orders = 0, spent = 0, products = '', runout = NULL, recv = NULL, ok_n = 0, fam = 0, last_status = json_extract(j.value, '$.last_status'), last_ca = json_extract(j.value, '$.last_ca'), back_n = json_extract(j.value, '$.back_n'), last_back = json_extract(j.value, '$.last_back') FROM json_each(?) j WHERE customers.phone = json_extract(j.value, '$.phone')", JSON.stringify(zero));
    n += up.length;
  }
  try { await autoCloseLeads(x, list); } catch (e) { console.error('autoCloseLeads', e.message); } // có đơn mới → khách hỏi cùng số tự "Đã chốt"
  return n;
}
/** Tính lại toàn bộ khách (đổi chu kỳ dùng, chuyển dữ liệu). */
/** Khách hỏi (Mới hỏi / Đang tư vấn) có đơn trong 30 ngày kể từ lúc hỏi → tự chuyển "Đã chốt", dù đơn lên từ đâu (CRM, web, file Sheet của sale).
 *  Tính từ 1 ngày trước lúc hỏi vì đơn trong file sale chỉ ghi ngày. phones = null → quét tất cả. */
const LEAD_ORDER = "FROM orders o WHERE o.phone = leads.phone AND o.time >= leads.time - 86400000 AND o.time <= leads.time + 30 * 86400000" +
  " AND o.status NOT LIKE '%uỷ%' AND o.status NOT LIKE '%ủy%' AND o.status NOT LIKE '%oàn%'";
export async function autoCloseLeads(x, phones) {
  const list = phones ? [...new Set(phones.map(normPhone).filter(Boolean))] : null; if (list && !list.length) return 0;
  const r = await run(x.db, "UPDATE leads SET status = 'Đã chốt', callback = NULL," +
    ` order_id = (SELECT o.id ${LEAD_ORDER} ORDER BY o.time LIMIT 1), last_at = (SELECT o.time ${LEAD_ORDER} ORDER BY o.time LIMIT 1),` +
    ` owner = CASE WHEN coalesce(owner, '') = '' THEN coalesce((SELECT o.seller ${LEAD_ORDER} ORDER BY o.time LIMIT 1), '') ELSE owner END` +
    ` WHERE status IN ('Mới hỏi', 'Đang tư vấn') AND phone != '' AND time IS NOT NULL` + (list ? ' AND phone IN (SELECT value FROM json_each(?))' : '') +
    ` AND EXISTS (SELECT 1 ${LEAD_ORDER})`, ...(list ? [JSON.stringify(list)] : []));
  return r.meta.changes || 0;
}
export async function recalcAll(x, opt) {
  const phones = (await all(x.db, "SELECT DISTINCT phone FROM orders WHERE phone != ''")).map(r => r.phone);
  return recalc(x, phones, opt);
}
export async function setCallbacks(x, cb) {
  const list = Object.keys(cb).map(p => ({ p, t: cb[p] })); if (!list.length) return;
  for (let i = 0; i < list.length; i += 500) await run(x.db, "UPDATE customers SET callback = json_extract(j.value, '$.t') FROM json_each(?) j WHERE customers.phone = json_extract(j.value, '$.p') AND customers.callback IS NULL", JSON.stringify(list.slice(i, i + 500)));
}

/* ================================================================ việc chăm sóc hôm nay */
const CARE_STEPS = [{ key: 'd1', at: 1, win: 2 }, { key: 'runout' }, { key: 'd7', at: 7, win: 3 }, { key: 'd14', at: 14, win: 3 }, { key: 'd30', at: 30, win: 3 }, { key: 'winback', at: AT_RISK_DAYS, win: 7 }];
const OPEN_ST = /^(Mới|Đã xác nhận|Đang giao)$/, D1_WIN = 3;
/** D+7 "Hỏi thăm sau 1 tuần" (anh Sơn chốt 16/10/2026): chỉ khách mua lần đầu, tính từ ngày nhận hàng (chưa rõ ngày nhận mà đơn đã giao → ngày đặt + số ngày giao).
 *  Không bị giãn cách chăm sóc chặn (khách vừa được hỏi nhận hàng ở D+1); đã chăm sóc từ ngày nhận + 4 trở đi thì thôi. */
function d7Task(c, today, R, last, care, toRun) {
  if (Number(c.orders) !== 1) return null;
  let recv = c.recv ? startOfDay(c.recv) : null, est = 0;
  if (recv == null || recv < last) { if (OPEN_ST.test(c.last_status || '')) return null; recv = last + shipOf(c.zone, R) * DAY; est = 1; }
  const rd = Math.round((today - recv) / DAY);
  if (rd < 7 || rd > 10 || (care != null && care >= recv + 4 * DAY)) return null;
  return { type: 'd7', days: rd, late: 0, toRun, est };
}
/** 📵 Ngừng liên hệ (31/10/2026): khách đã mất / bỏ số → không bao giờ nhắc chăm sóc. Khách đặt đơn mới sau ngày đánh dấu (số vẫn dùng) thì tự hết. */
export function isStopped(c) { return !!(c && c.stop) && !((Number(c.last) || 0) > (Number(c.stop_at) || 0)); }
export function careTask(c, today, R) {
  if (isStopped(c)) return null;
  const last = c.last ? startOfDay(c.last) : null; if (last == null) return null;
  const days = Math.round((today - last) / DAY);
  const runD = c.runout ? startOfDay(c.runout) : null, care = c.care_at ? startOfDay(c.care_at) : null;
  const toRun = runD != null ? Math.round((runD - today) / DAY) : null;
  const cb = c.callback ? startOfDay(c.callback) : null;
  if (cb != null && cb <= today) return { type: 'callback', days, late: Math.round((today - cb) / DAY), toRun };
  // Khách vừa trả lời chăm sóc (không tính "Không nghe máy") trong coolDays ngày → chưa nhắc lại các mốc định kỳ (hẹn gọi lại, hỏi nhận hàng vẫn nhắc)
  const cool = R.coolDays > 0 && care != null && c.care_result !== 'Không nghe máy' && today - care < R.coolDays * DAY;
  const ship = shipOf(c.zone, R), lead = ship + 1; // nhắc đặt lại sớm hơn ngày hết đủ để đơn mới kịp tới (khách xa nhắc sớm hơn)
  for (const s of CARE_STEPS) {
    if (c.fam && (s.key === 'd1' || s.key === 'd14')) continue; // khách quen sản phẩm: đã biết cách dùng
    if (s.key === 'd1') { // hỏi nhận hàng. Đã chăm sóc sau ngày đặt → coi như đã hỏi
      if (care != null && care > last) continue;
      const recv = c.recv ? startOfDay(c.recv) : null;
      if (recv != null && recv >= last) { const rd = Math.round((today - recv) / DAY); if (rd >= 0 && rd <= 2) return { type: 'd1', days: rd, late: 0, toRun }; continue; } // biết ngày nhận: từ hôm nhận đến 2 ngày sau
      // chưa rõ ngày nhận (27/10/2026): hỏi 1 ngày sau ngày hàng dự kiến tới theo vùng (gần: ngày thứ 4, xa: ngày thứ 6, không rõ tỉnh: ngày thứ 5), hiện 3 ngày.
      // Không dựa vào trạng thái "Đã giao" vì đơn từ file sale thường ghi sẵn lúc lên đơn.
      const from = ship + 1;
      if (days >= from && days <= from + D1_WIN) return { type: 'd1', days, late: 0, toRun, est: 1 };
      continue;
    }
    if (s.key === 'd7') { const t7 = d7Task(c, today, R, last, care, toRun); if (t7) return t7; continue; }
    // Sắp hết hàng = lúc dễ ra đơn nhất: không bị giãn cách chặn, chỉ nhường khi sale đã hẹn gọi lại ngày sau (27/10/2026)
    // Đơn gần nhất còn đang chờ giao (Mới / Đã xác nhận / Đang giao, chưa có ngày nhận) trong 14 ngày đầu: khách chưa có hàng để dùng nên chưa nhắc đặt lại (sale Thùy góp ý 07/11/2026)
    if (s.key === 'runout') { const waiting = (OPEN_ST.test(c.last_status || '') && !(c.recv && startOfDay(c.recv) >= last) && days <= 14) || c.last_status === 'Đang chuyển hoàn'; if (!waiting && toRun !== null && toRun >= -7 && toRun <= lead && days >= 2 && !(cb != null && cb > today) && !(care != null && care >= runD - lead * DAY)) return { type: 'runout', days, late: toRun < 0 ? -toRun : 0, toRun }; continue; }
    if (cool) continue;
    else { const at = s.key === 'winback' ? R.atRisk : s.at; if (days >= at && days <= at + s.win && !(care != null && care >= last + at * DAY)) return { type: s.key, days, late: 0, toRun }; }
  }
  return null;
}
export function leadDue(l, today) {
  if (l.status !== 'Mới hỏi' && l.status !== 'Đang tư vấn') return false;
  if (l.callback) return l.callback <= today + DAY - 1;
  return !l.lastAt || l.lastAt < today - 2 * DAY;
}

/* ================================================================ đọc dữ liệu cho giao diện */
const leadOut = r => ({ id: r.id, time: r.time, name: r.name || '', phone: r.phone || '', channel: r.channel || '', interest: r.interest || '', status: r.status || 'Mới hỏi', owner: r.owner || '', lastAt: r.last_at, callback: r.callback, reason: r.reason || '', note: r.note || '', orderId: r.order_id || '', by: r.by_name || '', refPhone: r.ref_phone || '', refName: r.ref_name || '', ownAt: r.own_at || r.time, poolN: r.pool_n || 0, poolFrom: r.pool_from || '', how: r.how || '' });
const orderOut = r => ({ row: r.rid, time: r.time, id: r.id, name: r.name || '', phone: r.phone || '', email: r.email || '', province: r.province || '', ward: r.ward || '', address: r.address || '', items: r.items || '', subtotal: r.subtotal || 0,
  shipping: r.shipping || 0, total: r.total || 0, payment: r.payment || '', note: r.note || '', status: r.status || 'Mới', source: r.source || '', consent: !!r.consent, paid: r.paid || '', carrier: r.carrier || '', tracking: r.tracking || '', seller: r.seller || '', ca: r.ca || '', line: r.line || '', ship: r.ship || '',
  shipAt: r.ship_at, receivedAt: r.received_at, otype: r.otype || '', oflag: r.oflag || '', trk: r.trk || '', trkAt: r.trk_at, trkCode: r.trk_code || 0, voucher: r.voucher || '', refPhone: r.ref_phone || '', refGift: r.ref_gift || '', refTold: r.ref_told ? 1 : 0, partner: r.partner || '', pRate: r.partner_rate || 0, discount: r.discount || 0, addrOld: r.addr_old || '', shipFee: r.ship_fee == null ? null : r.ship_fee, recon: r.recon || '', cashAt: r.cash_at || null, cashAmt: r.cash_amt == null ? null : r.cash_amt, cashSrc: r.cash_src || '', cashAcct: r.cash_acct || '', cashWhy: r.cash_why || '' });
export async function leadsData(x, where, ...args) { return (await all(x.db, 'SELECT * FROM leads' + (where ? ' WHERE ' + where : '') + ' ORDER BY rid DESC LIMIT 3000', ...args)).reverse().map(leadOut); }

async function prefsOf(x, email) { return await kvJson(x.db, 'prefs_' + email, {}) || {}; }
async function allTagColors(x) {
  const m = {};
  for (const r of await all(x.db, "SELECT v FROM kv WHERE k LIKE 'prefs\\_%' ESCAPE '\\'")) { try { (JSON.parse(r.v).tags || []).forEach(t => { if (!m[t.name]) m[t.name] = t.color; }); } catch (e) { } }
  return m;
}
export async function srcList(x) {
  return (await all(x.db, 'SELECT * FROM sources ORDER BY rid')).map(r => { let cfg = {}; try { cfg = JSON.parse(r.cfg || '{}'); } catch (e) { } return { id: r.id, sale: r.sale || '', url: r.url || '', fileName: r.file_name || '', cfg, last: r.last, result: r.result || '', row: r.rid }; });
}
export async function adsCfg(x) { return kvJson(x.db, 'ads_cfg', null); }

const CUS_SQL = `SELECT phone, name, address, province, ward, orders, spent, first, last, products, runout, consent, source, owner, care_at, care_result, substr(note, 1, ${NOTE_MAX}) AS note, length(note) > ${NOTE_MAX} AS cut, callback, flag, tag, last_status, last_ca, zalo, community, dob, recv, ok_n, back_n, last_back, fam, addr_old, zone, stop, stop_by, stop_at, stop_ok, own_src, own_at, own_by, own_ok, own_flag, own_how, own_chk FROM customers`;
const cusOut = (v, today, R) => ({
  phone: v.phone, name: v.name || '', address: v.address || '', province: v.province || '', ward: v.ward || '', orders: v.orders || 0, spent: v.spent || 0, first: v.first, last: v.last,
  products: String(v.products || '').split('; ').filter(String), runout: v.runout, group: groupOf(v.orders || 0, v.spent || 0, v.last, R), consent: !!v.consent, source: v.source || '', owner: v.owner || '',
  careAt: v.care_at, careResult: v.care_result || '', note: v.note || '', noteCut: !!v.cut, callback: v.callback, flag: v.flag || '', tag: v.tag || '', task: careTask(v, today, R), lastStatus: v.last_status || '', lastCa: v.last_ca || '',
  zalo: !!v.zalo, community: v.community || '', dob: v.dob || '', recv: v.recv || null, okN: v.ok_n || 0, backN: v.back_n || 0, lastBack: v.last_back || 0, fam: !!v.fam, addrOld: v.addr_old || '', zone: v.zone || 0,
  stop: v.stop || '', stopBy: v.stop_by || '', stopAt: v.stop_at || null, stopOk: !!v.stop_ok,
  ownSrc: v.own_src === 'self' || v.own_src === 'ref' ? v.own_src : '', ownAt: v.own_at || null, ownBy: v.own_by || '', ownOk: Number(v.own_ok) || 0, ownFlag: v.own_flag || '', ownHow: v.own_how || '', ownChk: Number(v.own_chk) || 0 // 🙋 khách sale tự mang về (ownTick)
});
const logOut = l => ({ time: l.time, by: l.by_name || '', what: l.what || '', ref: l.ref || '', name: l.name || '', result: l.result || '', note: l.note || '' });
const contactOut = r => ({ row: r.rid, time: r.time, name: r.name || '', phone: r.phone || '', email: r.email || '', message: r.message || '', page: r.page || '', done: !!r.done, note: r.note || '' });

/** Danh sách số trong file quảng cáo 100 ngày gần nhất ([đầu ngày, SĐT, sale, nguồn], adsSync ghi), để tính tỷ lệ chốt. Nhân viên chỉ nhận số của mình.
 *  Máy đã có đúng bản (adV) thì không gửi lại. */
async function adRowsOf(x, u, adV) {
  const v = (await kvGet(x.db, 'ads_rows_v')) || ''; if (!v || v === adV) return { v, rows: undefined };
  const rows = await kvJson(x.db, 'ads_rows', []); return { v, rows: u.level < 2 ? rows.filter(r => r[2] === u.name) : rows };
}
/** Phần nhỏ đi kèm mọi lần tải (cấu hình, nhân sự, mục tiêu, mẫu tin…): vài chục dòng. */
/* Tỉnh của khách từ địa chỉ (giống PROV_MERGE trong crm/app.js): tỉnh cũ → tỉnh mới sau sáp nhập 07/2025 */
const PROV_MERGE = { 'Tuyên Quang': ['Hà Giang', 'Tuyên Quang'], 'Lào Cai': ['Yên Bái', 'Lào Cai'], 'Thái Nguyên': ['Bắc Kạn', 'Bắc Cạn', 'Thái Nguyên'], 'Phú Thọ': ['Vĩnh Phúc', 'Hòa Bình', 'Phú Thọ'],
  'Bắc Ninh': ['Bắc Giang', 'Bắc Ninh'], 'Hưng Yên': ['Thái Bình', 'Hưng Yên'], 'Hải Phòng': ['Hải Dương', 'Hải Phòng', 'HP'], 'Ninh Bình': ['Hà Nam', 'Nam Định', 'Ninh Bình'], 'Quảng Trị': ['Quảng Bình', 'Quảng Trị'],
  'Đà Nẵng': ['Quảng Nam', 'Đà Nẵng'], 'Quảng Ngãi': ['Kon Tum', 'Kontum', 'Quảng Ngãi'], 'Gia Lai': ['Bình Định', 'Gia Lai', 'Quy Nhơn', 'Pleiku'], 'Khánh Hòa': ['Ninh Thuận', 'Khánh Hòa', 'Nha Trang', 'Phan Rang'],
  'Lâm Đồng': ['Đắk Nông', 'Đăk Nông', 'Dak Nong', 'Bình Thuận', 'Lâm Đồng', 'Đà Lạt', 'Phan Thiết'], 'Đắk Lắk': ['Phú Yên', 'Đắk Lắk', 'Đăk Lăk', 'Dak Lak', 'Daklak', 'Đaklak', 'Buôn Ma Thuột', 'Buôn Mê Thuột', 'Tuy Hòa'],
  'Hồ Chí Minh': ['Bà Rịa', 'Vũng Tàu', 'Bình Dương', 'Hồ Chí Minh', 'HCM', 'TPHCM', 'TP HCM', 'Sài Gòn', 'Thủ Đức', 'Thủ Dầu Một'], 'Đồng Nai': ['Bình Phước', 'Đồng Nai', 'Biên Hòa'],
  'Tây Ninh': ['Long An', 'Tây Ninh'], 'Cần Thơ': ['Sóc Trăng', 'Hậu Giang', 'Cần Thơ'], 'Vĩnh Long': ['Bến Tre', 'Trà Vinh', 'Vĩnh Long'], 'Đồng Tháp': ['Tiền Giang', 'Đồng Tháp', 'Mỹ Tho'],
  'Cà Mau': ['Bạc Liêu', 'Cà Mau'], 'An Giang': ['Kiên Giang', 'An Giang', 'Rạch Giá', 'Phú Quốc', 'Long Xuyên'],
  'Hà Nội': ['Hà Nội', 'HN'], 'Huế': ['Thừa Thiên Huế', 'Huế'], 'Lai Châu': ['Lai Châu'], 'Điện Biên': ['Điện Biên'], 'Sơn La': ['Sơn La'], 'Lạng Sơn': ['Lạng Sơn'], 'Quảng Ninh': ['Quảng Ninh', 'Hạ Long'],
  'Thanh Hóa': ['Thanh Hóa'], 'Nghệ An': ['Nghệ An'], 'Hà Tĩnh': ['Hà Tĩnh'], 'Cao Bằng': ['Cao Bằng'] };
let PROV_KEYS = null;
export function provOfAddr(text) {
  if (!PROV_KEYS) { PROV_KEYS = []; Object.keys(PROV_MERGE).forEach(nw => PROV_MERGE[nw].forEach(old => PROV_KEYS.push({ k: ' ' + nrm(old) + ' ', old, nw }))); PROV_KEYS.sort((a, b) => b.k.length - a.k.length); }
  const t = ' ' + nrm(text).replace(/[.,;:\-–()/]/g, ' ').replace(/\s+/g, ' ') + ' '; let best = null, at = -1;
  PROV_KEYS.forEach(p => { const i = t.lastIndexOf(p.k); if (i > at) { at = i; best = p; } });
  return best ? { old: /^(HCM|TPHCM|TP HCM|HN|HP|Kontum|Daklak|Đaklak)$/.test(best.old) ? best.nw : best.old, nw: best.nw } : null;
}
/** Số khách cả công ty theo tỉnh / sản phẩm (chỉ con số, không tên / SĐT) cho khung 📍 khi nhân viên gõ tên tỉnh. Tính lại 6 tiếng 1 lần.
 *  { p: { 'Nam Định': [tỉnh mới, số khách, mua ≥2 lần, mua trong 30 ngày, { sản phẩm: số khách }] }, s: { sản phẩm: [số khách, mua ≥2 lần] } } */
export async function areaStats(x) { // cũng dùng cho bản đồ hành trình (journey.js)
  const c0 = await kvGet(x.db, 'areas'); if (c0) return JSON.parse(c0);
  const p = {}, s = {}, d30 = Date.now() - 30 * DAY;
  for (const c of await all(x.db, 'SELECT address, ward, province, products, orders, last FROM customers WHERE orders > 0')) {
    const rep = c.orders >= 2 ? 1 : 0, seen = {};
    String(c.products || '').split('; ').forEach(v => { const n = v.replace(/\s*\(.*\)\s*$/, '').trim(); if (n) seen[n] = 1; });
    Object.keys(seen).forEach(n => { const r = s[n] || (s[n] = [0, 0]); r[0]++; r[1] += rep; });
    const pv = provOfAddr([c.address, c.ward, c.province].join(' ')); if (!pv) continue;
    const a = p[pv.old] || (p[pv.old] = [pv.nw, 0, 0, 0, {}]);
    a[1]++; a[2] += rep; if (c.last && c.last >= d30) a[3]++;
    Object.keys(seen).forEach(n => { a[4][n] = (a[4][n] || 0) + 1; });
  }
  Object.keys(p).forEach(k => { const t = p[k][4], top = {}; Object.keys(t).sort((a, b) => t[b] - t[a]).slice(0, 4).forEach(n => { top[n] = t[n]; }); p[k][4] = top; });
  const v = { p, s }; await kvSet(x.db, 'areas', JSON.stringify(v), 6 * 3600e3); return v;
}
async function loadSmall(x, u, R, mode, adV) {
  const staff = u.level < 2, b = (sql, ...a) => x.db.prepare(sql).bind(...a);
  const smallQ = x.db.batch([
    b('SELECT * FROM contacts ORDER BY rid DESC LIMIT ' + (staff ? 0 : 1000)),
    b('SELECT * FROM targets' + (staff ? ' WHERE name = ?' : ''), ...(staff ? [u.name] : [])),
    b('SELECT name, variant, days, basis FROM cycles ORDER BY rid'),
    b('SELECT when_txt, purpose, text FROM templates ORDER BY rid')
  ]); smallQ.catch(() => { });
  const users = (await crmUsers(x)).filter(y => y.active || u.level >= 3).map(y => u.level >= 3 ? { email: y.email, name: y.name, role: y.role, active: y.active, recv: y.recv, tg: !!y.tg, alias: y.alias, prefix: y.prefix || slugName(y.name), web: y.web || y.level >= 3, mkv: y.mkv || y.level >= 3, zb: !!y.zb, kho: !!y.kho, phone: y.phone, full: y.full, acct: y.acct, joined: y.joined } : u.level >= 2 ? { name: y.name, role: y.role, recv: y.recv, tg: !!y.tg, joined: y.joined } : { name: y.name, role: y.role, joined: y.name === u.name ? y.joined : '' }); // SĐT, họ tên, số tài khoản nhân sự: chỉ Quản trị; ngày vào làm: tính thâm niên (Phụ lục 01)
  const adsP = adRowsOf(x, u, adV); adsP.catch(() => { });
  const areasP = u.level === 1 ? areaStats(x) : Promise.resolve(undefined); areasP.catch(() => { }); // quản lý đã có đủ khách → máy tự đếm
  const ktP = finOk(u) ? ktCfg(x) : Promise.resolve(null); ktP.catch(() => { });
  const [ca, fbNew, prefs, tagColors, sources, ads, commission, sanOk, dash, qrLinks, mktDoc, cost, payplan, staffGuard, opex, fin, ktLink, kho] = await Promise.all([caCfg(x), // hỏi song song: mỗi lần hỏi máy chủ dữ liệu mất một nhịp
    u.level >= 2 ? first(x.db, "SELECT count(*) AS n FROM feedback WHERE status = 'Mới'").then(r => (r || {}).n || 0) : 0,
    prefsOf(x, u.email), allTagColors(x), u.level >= 3 ? srcList(x) : [], u.level >= 3 ? adsCfg(x) : null, kvJson(x.db, 'commission_cfg', {}).then(r => r || {}), sanAllowed(x, u).catch(() => false), kvJson(x.db, 'dash_cfg', {}).then(r => r || {}),
    all(x.db, 'SELECT code, name FROM links').then(r => r.map(l => [l.code, l.name])).catch(() => []),
    u.level >= 3 || u.role === 'Marketing' || u.mkv ? kvJson(x.db, 'mkt_doc', null).then(r => r || MKT_DOC_DEF) : null,
    finOk(u) ? kvJson(x.db, 'cost_cfg', null) : null, kvJson(x.db, 'payplan_cfg', null).then(r => Object.assign({}, PAYPLAN, r || {})), u.level >= 3 ? kvJson(x.db, 'staff_guard', []).then(r => r || []) : [], finOk(u) ? kvJson(x.db, 'opex_cfg', {}).then(r => r || {}) : null, finOk(u) ? kvJson(x.db, 'fin_cfg', null) : null, finOk(u) ? kvJson(x.db, 'kt_link', null) : null, u.level >= 2 || u.kho ? kvJson(x.db, 'kho_sum', null) : null]); // 💰 giá nhập sản phẩm: chỉ Quản trị (không nằm trong repo công khai) // 📍 tên link QR → nguồn đơn web hiện "📍 <tên>"
  const [ct, tg, cy, tp] = (await smallQ).map(r => r.results || []), ar = await adsP, areas = await areasP.catch(() => undefined);
  return {
    ok: true, user: publicUser(u), areas, sanOk, kho, now: Date.now(), today: startOfDay(Date.now()), fbNew, users, prefs, tagColors, sources, ads, adV: ar.v, adRows: ar.rows, qrLinks,
    occ: saleDays(fmtDate(Date.now() - 864e5, 'yyyyMMdd'), 5), // 🎉 dịp chúc khách hôm qua → 3 ngày tới (zday.js), CRM tự lọc theo ngày
    contacts: ct.reverse().map(contactOut), targets: tg.map(t => ({ month: t.month, name: t.name, amount: t.amount || 0, selfN: t.self_n || 0, by: t.by_name || '', at: t.at })),
    cycles: cy.filter(r => r.name).map(r => [r.name, r.variant || '', Number(r.days) || 0, r.basis || '']), templates: tp.filter(r => r.text).map(r => [r.when_txt || '', r.purpose || '', r.text]),
    rules: { backCost: Number(dash.backCost) || 0, ai: !!x.env.ANTHROPIC_API_KEY && u.role !== 'Marketing', vipOrders: R.vipOrders, vipSpent: R.vipSpent, atRisk: R.atRisk, coolDays: R.coolDays, shipDays: R.shipDays, shipFar: R.shipFar, famMin: R.famMin, poolDays: R.poolDays, poolNoCall: R.poolNoCall, poolIdle: R.poolIdle, poolMax: R.poolMax, selfOn: R.selfOn, poolOn: R.poolOn, otypes: OTYPES, commission, payplan, staffGuard, dash: u.level >= 3 || u.role === 'Marketing' || u.mkv || u.role === 'Kế toán' ? dash : null, ktCfg: await ktP, mktDoc, cost, opex, fin, ktLink: ktLink && ktLink.link ? ktLink : null, statuses: ORDER_STATUS, results: CARE_RESULTS, leadStatus: LEAD_STATUS, assignMode: mode, bot: BOT_USERNAME, ca, lines: LINES.map(l => l[0]).concat(['Khác']) }
  };
}

/** Tải dữ liệu CRM.
 * d.part = 'core': đợt 1 (khách, đơn 100 ngày + đơn đang xử lý, nhật ký 60 ngày) – hiện màn hình ngay; 'rest': đợt 2 (đơn, nhật ký cũ hơn) – tải ngầm;
 * 'delta': chỉ những dòng đổi từ lần tải trước (d.since = giờ máy chủ lần trước, d.lr = số dòng nhật ký cuối) – dùng khi tự làm mới.
 * Không có d.part (CRM bản cũ): tải 1 lần đủ hết. */
async function crmLoad(x, u, d) {
  d = d || {};
  if (u.role === 'Kho') { // 09/11/2026: tài khoản Kho chỉ có khung + tab Kho (số liệu kho tải riêng bằng kho_load), không 1 dòng khách / đơn nào
    const [R0, mode0] = await Promise.all([rulesCfg(x), assignMode(x)]), s0 = await loadSmall(x, u, R0, mode0, '');
    return Object.assign(s0, { today: startOfDay(Date.now()), customers: [], orders: [], leads: [], log: [], contacts: [], targets: [], users: [], sources: [], areas: undefined, ads: null, adRows: [], adV: '', fbNew: 0, sanOk: false, sv: 0, lr: 0, qrLinks: [], occ: [] });
  }
  if (u.role === 'Kế toán') { // 09/11/2026: đơn đã che SĐT / địa chỉ / ghi chú (kt.js), không khách / khách hỏi / nhật ký
    const [R0, mode0] = await Promise.all([rulesCfg(x), assignMode(x)]), sp = loadSmall(x, u, R0, mode0, ''); sp.catch(() => { });
    return ktLoad(x, u, d, sp, NOW_MS, deltaOk);
  }
  if (u.role === 'Marketing') { // chỉ phần khung (tên, cài đặt màu…), không 1 dòng khách / đơn / khách hỏi / nhật ký nào
    const [R0, mode0] = await Promise.all([rulesCfg(x), assignMode(x)]), s0 = await loadSmall(x, u, R0, mode0, '');
    const wl = await all(x.db, "SELECT * FROM leads WHERE by_name = 'Website' ORDER BY rid DESC LIMIT 3000"); // 24/10/2026: Marketing xem (chỉ đọc) khách để lại số trên web
    return Object.assign(s0, { today: startOfDay(Date.now()), customers: [], orders: [], leads: wl.reverse().map(leadOut), log: [], contacts: [], targets: [], users: [], sources: [], areas: undefined, ads: null, adRows: [], adV: '', fbNew: 0, sanOk: false, sv: 0, lr: 0 });
  }
  if (d.part === 'delta') return crmDelta(x, u, d);
  const today = startOfDay(Date.now()), staff = u.level < 2, part = d.part === 'core' || d.part === 'rest' ? d.part : '';
  const [R, mode] = await Promise.all([rulesCfg(x), assignMode(x)]); // hỏi song song cho nhanh
  // khách của nhân viên: viết để dùng được chỉ mục customers(owner) → chỉ đọc khách của người đó, không quét cả bảng
  const see = mode === 'pool' ? "(owner = ?1 OR owner = '' OR owner IS NULL)" : '(owner = ?1)';
  const seeL = mode === 'pool' ? "(owner = ?1 OR ((owner = '' OR owner IS NULL) AND (coalesce(by_name, '') != 'Website' OR coalesce(pool_n, 0) > 0)))" : '(owner = ?1)'; // khách hỏi để lại số trên web chưa giao: sale không thấy, chờ quản lý giao
  const from = Date.now() - 400 * DAY, open = "status IN ('Mới', 'Đã xác nhận', 'Đang giao')";
  const cutO = part === 'rest' ? Number(d.o) || 0 : Date.now() - 100 * DAY, cutL = part === 'rest' ? Number(d.l) || 0 : Date.now() - 60 * DAY;
  const ordWhen = part === 'core' ? `(time >= ?4 OR ${open})` : part === 'rest' ? `time >= ?3 AND time < ?4 AND NOT ${open}` : `(time >= ?3 OR ${open})`;
  const ordSql = `SELECT * FROM orders WHERE ${ordWhen}` + (staff ? ` AND (seller = ?1 OR phone IN (SELECT phone FROM customers WHERE ${see}))` : '') + ' ORDER BY time DESC, rid DESC LIMIT 6000';
  const logWhen = part === 'core' ? 'time >= ?3' : part === 'rest' ? 'time < ?3' : '';
  const logSee = staff ? `(by_name = ?1 OR ref IN (SELECT phone FROM customers WHERE ${see}) OR ref IN (SELECT phone FROM leads WHERE ${seeL}) OR ref IN (SELECT id FROM orders WHERE seller = ?1 OR phone IN (SELECT phone FROM customers WHERE ${see})))` : '';
  const logSql = 'SELECT time, by_name, what, ref, name, result, note FROM logs' + (logSee || logWhen ? ' WHERE ' + [logSee, logWhen].filter(Boolean).join(' AND ') : '') + ' ORDER BY rid DESC LIMIT 6000';
  const b = (sql, ...a) => x.db.prepare(sql).bind(...a);
  // Quản trị/Quản lý không có ?1 (tên) → dồn số thứ tự tham số; ?2 bỏ trống
  const ordA = part ? [from, cutO] : [from]; // ?3 ?4 (bản tải 1 lần không có ?4)
  const ordQ = staff ? b(ordSql, u.name, '', ...ordA) : b(ordSql.replace(/\?4/g, '?2').replace(/\?3/g, '?1'), ...ordA);
  const logQ = staff ? (logWhen ? b(logSql, u.name, '', cutL) : b(logSql, u.name)) : (logWhen ? b(logSql.replace('?3', '?1'), cutL) : b(logSql));
  if (part === 'rest') {
    const [ro, rl] = (await x.db.batch([ordQ, logQ])).map(r => r.results || []);
    return { ok: true, orders: ro.reverse().map(orderOut), log: rl.reverse().map(logOut) };
  }
  const cusSql = CUS_SQL + " WHERE (orders > 0 OR flag != '')" + (staff ? ' AND ' + see : '');
  const leadSql = 'SELECT * FROM leads' + (staff ? ' WHERE ' + seeL : '') + ' ORDER BY rid DESC LIMIT 3000';
  const smallP = loadSmall(x, u, R, mode); smallP.catch(() => { }); // chạy song song với lượt đọc chính
  const res = await x.db.batch([
    b(`SELECT ${NOW_MS} AS sv, (SELECT max(rid) FROM logs) AS lr`), // mốc cho lần tự làm mới sau chỉ lấy phần thay đổi
    staff ? b(cusSql, u.name) : b(cusSql),
    ordQ,
    staff ? b(leadSql, u.name) : b(leadSql),
    logQ
  ]);
  const [mk, cs, os, ls, lg] = res.map(r => r.results || []);
  return Object.assign(await smallP, {
    today, customers: cs.map(v => cusOut(v, today, R)), orders: os.reverse().map(orderOut), leads: ls.reverse().map(leadOut), log: lg.reverse().map(logOut),
    part: part === 'core' ? { o: cutO, l: cutL } : undefined, sv: deltaOk ? (mk[0] || {}).sv || 0 : 0, lr: (mk[0] || {}).lr || 0
  });
}

/** Tự làm mới: chỉ đọc những dòng khách / đơn / khách hỏi đã đổi từ lần trước (theo cột upd, có chỉ mục) + nhật ký mới. Đổi quá nhiều → báo CRM tải lại đủ. */
async function crmDelta(x, u, d) {
  const since = Number(d.since) || 0, lr = Number(d.lr) || 0; if (!since || !deltaOk) return { ok: true, delta: true, full: true };
  const today = startOfDay(Date.now()), staff = u.level < 2, MAX = 1500;
  const [R, mode] = await Promise.all([rulesCfg(x), assignMode(x)]);
  const mine = o => o === u.name || (mode === 'pool' && !o);
  const b = (sql, ...a) => x.db.prepare(sql).bind(...a), since2 = since - 5000; // lùi 5 giây phòng ghi cùng lúc
  const smallP = loadSmall(x, u, R, mode, d.adV); smallP.catch(() => { }); // chạy song song; lỗi thì báo ở chỗ await bên dưới
  const [mk, cs, os, ls, lg] = (await x.db.batch([
    b(`SELECT ${NOW_MS} AS sv, (SELECT max(rid) FROM logs) AS lr`),
    b(CUS_SQL + ' WHERE upd > ?1 LIMIT ' + (MAX + 1), since2),
    b('SELECT o.*, c.owner AS c_owner FROM orders o LEFT JOIN customers c ON c.phone = o.phone WHERE o.upd > ?1 LIMIT ' + (MAX + 1), since2),
    b('SELECT * FROM leads WHERE upd > ?1 LIMIT ' + (MAX + 1), since2),
    b('SELECT rid, time, by_name, what, ref, name, result, note FROM logs WHERE rid > ?1 ORDER BY rid LIMIT ' + (MAX + 1), lr)
  ])).map(r => r.results || []);
  if (cs.length > MAX || os.length > MAX || ls.length > MAX || lg.length > MAX) return { ok: true, delta: true, full: true };
  const dels = await delSince(x, since2); // dòng Quản trị vừa xoá → máy khác bỏ khỏi danh sách
  const cusOk = v => (v.orders > 0 || (v.flag || '') !== '') && (!staff || mine(v.owner || ''));
  const ordOk = o => !staff || o.seller === u.name || (o.c_owner != null && mine(o.c_owner || ''));
  const leadOk = l => !staff || (l.owner ? l.owner === u.name : mine('') && (l.by_name !== 'Website' || l.pool_n > 0)); // số đã về Kho chung thì sale thấy dù khách từ web
  let logs = lg;
  if (staff && logs.length) { // nhật ký mới: chỉ giữ dòng của khách / khách hỏi / đơn mình xem được
    const refs = [...new Set(logs.map(l => l.ref).filter(Boolean))], vis = {};
    if (refs.length) {
      (await allIn(x.db, 'SELECT phone, owner FROM customers WHERE phone IN (SELECT value FROM json_each(?))', refs)).forEach(r => { if (mine(r.owner || '')) vis[r.phone] = 1; });
      (await allIn(x.db, 'SELECT phone, owner, by_name FROM leads WHERE phone IN (SELECT value FROM json_each(?))', refs)).forEach(r => { if (leadOk(r)) vis[r.phone] = 1; });
      (await allIn(x.db, 'SELECT o.id, o.seller, c.owner AS c_owner FROM orders o LEFT JOIN customers c ON c.phone = o.phone WHERE o.id IN (SELECT value FROM json_each(?))', refs)).forEach(r => { if (ordOk(r)) vis[r.id] = 1; });
    }
    logs = logs.filter(l => l.by_name === u.name || vis[l.ref]);
  }
  return Object.assign(await smallP, {
    delta: true, today,
    customers: cs.filter(cusOk).map(v => cusOut(v, today, R)), cusGone: cs.filter(v => !cusOk(v)).map(v => v.phone).concat(dels.filter(e => e.c && !cs.some(v => v.phone === e.c)).map(e => e.c)), // xoá rồi lại có đơn mới → giữ
    orders: os.filter(ordOk).map(orderOut), ordGone: os.filter(o => !ordOk(o)).map(o => o.rid).concat(dels.filter(e => e.o).map(e => e.o)),
    leads: ls.filter(leadOk).map(leadOut), leadGone: ls.filter(l => !leadOk(l)).map(l => l.id).concat(dels.filter(e => e.l).map(e => e.l)),
    log: logs.map(logOut), sv: (mk[0] || {}).sv || 0, lr: Math.max(lr, (mk[0] || {}).lr || 0)
  });
}
/** Toàn bộ đơn của 1 khách (kể cả đơn cũ) + ghi chú đầy đủ. */
/** Doanh số + số đơn từ trước tới nay theo nhân viên bán (tab Hiệu quả → Mọi lúc; CRM chỉ tải sẵn đơn 400 ngày). Nhân viên chỉ thấy số của mình. */
async function crmSalesAll(x, u) {
  const own = u.level < 2;
  const rows = await all(x.db, "SELECT seller, count(*) AS n, coalesce(sum(total), 0) AS s FROM orders WHERE time IS NOT NULL AND status NOT LIKE '%uỷ%' AND status NOT LIKE '%ủy%' AND status NOT LIKE '%oàn%'" + (own ? ' AND seller = ?' : '') + ' GROUP BY seller', ...(own ? [u.name] : []));
  return { ok: true, rows: rows.map(r => ({ seller: r.seller || '', n: r.n, s: r.s })) };
}
/** Bảng thi đua (tab Hôm nay của nhân viên): tuần này + tháng này, 4 hạng mục. Nhân viên chỉ nhận Top 3 + hạng của mình + khoảng cách tới người ngay trên;
 *  không gửi số của người hạng 4 trở xuống. Quản lý / Quản trị nhận đủ bảng. Kèm tiến độ mục tiêu tháng của cả nhóm (thưởng nhóm).
 *  17/10/2026: hạng mục Doanh số xếp theo % mục tiêu (tuần = mục tiêu tháng × 7 / số ngày của tháng), số tiền chỉ gửi cho chính người đó và quản lý. */
async function crmRace(x, u) {
  const now = Date.now(), t0 = startOfDay(now), dow = (new Date(t0 + TZ_MS).getUTCDay() + 6) % 7, w0 = t0 - dow * DAY; // tuần bắt đầu thứ Hai
  const vn = new Date(now + TZ_MS), y = vn.getUTCFullYear(), mo = vn.getUTCMonth(), m0 = Date.UTC(y, mo, 1) - TZ_MS, m1 = Date.UTC(y, mo + 1, 1) - TZ_MS;
  const pm0 = Date.UTC(y, mo - 1, 1) - TZ_MS, mk = y + '-' + (mo < 9 ? '0' : '') + (mo + 1), from = Math.min(w0 - 7 * DAY, pm0);
  const VOID = "status NOT LIKE '%uỷ%' AND status NOT LIKE '%ủy%' AND status NOT LIKE '%oàn%'";
  // 01/11/2026: Tỷ lệ chốt tính giống tab Hiệu quả (closeStats trong crm/app.js): data quảng cáo trong kỳ (file số quảng cáo, mỗi SĐT 1 lần) đã ra đơn.
  // Trước đây đếm mọi khách hỏi được giao, gồm cả data cũ nhập từ file ("File cũ – …") → sale nhận data nguội bị tụt còn ~14%, lệch với Hiệu quả.
  const a0 = Math.min(w0, m0), a1 = Math.max(w0 + 7 * DAY, m1);
  const ads = ((await kvJson(x.db, 'ads_rows', [])) || []).map(a => [Number(a[0]) || 0, normPhone(a[1]), String(a[2] || '')]).filter(a => a[1] && a[0] >= a0 && a[0] < a1);
  const adPh = [...new Set(ads.map(a => a[1]))];
  const [os, tg, ao, al, ownRows] = await Promise.all([
    all(x.db, `SELECT o.seller, o.time, o.total, o.phone, c.first FROM orders o LEFT JOIN customers c ON c.phone = o.phone WHERE o.time >= ? AND ${VOID.replace(/status/g, 'o.status')}`, from),
    all(x.db, "SELECT own_by, own_at FROM customers WHERE own_src IN ('self', 'ref') AND own_at >= ?", from).catch(() => []), // 🙋 khách tự mang về (10/11/2026)
    all(x.db, 'SELECT name, amount FROM targets WHERE month = ?', mk),
    adPh.length ? allIn(x.db, `SELECT phone, time FROM orders WHERE phone IN (SELECT value FROM json_each(?)) AND time >= ? AND ${VOID}`, adPh, a0) : [],
    adPh.length ? allIn(x.db, 'SELECT phone, time, last_at, status FROM leads WHERE phone IN (SELECT value FROM json_each(?)) AND coalesce(last_at, time) >= ?', adPh, a0) : []]);
  const buyT = {}, ldBy = {}; ao.forEach(o => { (buyT[normPhone(o.phone)] = buyT[normPhone(o.phone)] || []).push(Number(o.time) || 0); }); al.forEach(l => { (ldBy[normPhone(l.phone)] = ldBy[normPhone(l.phone)] || []).push(l); });
  const closeOf = (n, a, b) => { const seen = {}; let data = 0, won = 0; ads.forEach(r => { const [day, ph] = r; if (day < a || day >= b || r[2] !== n || seen[ph]) return; seen[ph] = 1; data++;
    if ((buyT[ph] || []).some(t => t >= day) || (ldBy[ph] || []).some(l => (Number(l.last_at) || Number(l.time) || 0) >= day && l.status === 'Đã chốt')) won++; }); return { data, won }; };
  const us = (await crmUsers(x)).filter(v => v.active && v.level >= 1 && v.level < 3), names = us.map(v => v.name), tgt = {}; tg.forEach(t => { tgt[t.name] = Number(t.amount) || 0; });
  const sum = (a, b, n) => os.filter(o => o.time >= a && o.time < b && (!n || o.seller === n)).reduce((s, o) => s + (Number(o.total) || 0), 0);
  const period = (a, b, pa, pb, minLead, gk) => {
    const rows = names.map(n => {
      const mine = os.filter(o => o.seller === n && o.time >= a && o.time < b), sales = mine.reduce((s, o) => s + (Number(o.total) || 0), 0);
      const back = {}; mine.forEach(o => { if (o.first && o.first < o.time - 3600e3) back[o.phone] = 1; });
      const cs = closeOf(n, a, b), won = cs.won, prev = sum(pa, pb, n), own = ownRows.filter(r => r.own_by === n && r.own_at >= a && r.own_at < b).length;
      const goal = (tgt[n] || 0) * gk;
      return { n, sales, own, pct: goal > 0 ? Math.round(sales * 100 / goal) : null, orders: mine.length, back: Object.keys(back).length, data: cs.data, won, close: cs.data >= minLead ? Math.round(won * 100 / cs.data) : null,
        grow: prev >= 500000 ? Math.round((sales - prev) * 100 / prev) : null, prev };
    }).filter(r => us.find(v => v.name === r.n).level === 1 || r.orders > 0); // quản lý không bán thì không đưa vào bảng
    const cat = (k, f, money) => {
      const ok = rows.filter(r => f(r) !== null).sort((p, q) => f(q) - f(p) || (p.n < q.n ? -1 : 1));
      let rank = 0, last = null; const list = ok.map((r, i) => { const v = f(r); if (v !== last) { rank = i + 1; last = v; } const e = { n: r.n, v, r: rank }; if (money) e.s = r.sales; return e; });
      const hide = e => u.level >= 2 || e.n === u.name || !money ? e : { n: e.n, v: e.v, r: e.r }; // số tiền của người khác chỉ quản lý thấy
      const out = { k, top: list.filter(e => e.r <= 3 && e.v > 0).map(hide), count: list.length };
      if (money) { out.pct = 1; if (u.level >= 2) out.none = rows.filter(r => f(r) === null).map(r => ({ n: r.n, s: r.sales })); } // quản lý: ai chưa đặt mục tiêu
      if (u.level >= 2) out.all = list;
      const me = list.find(e => e.n === u.name);
      if (me) { out.me = { r: me.r, v: me.v }; if (money) out.me.s = me.s; const up = list.filter(e => e.v > me.v).pop(); if (up) out.me.gap = up.v - me.v; } // khoảng cách tới người ngay trên
      return out;
    };
    const mine = rows.find(r => r.n === u.name);
    return { from: a, to: b, n: rows.length, cats: [cat('sales', r => r.pct, 1), cat('close', r => r.close), cat('own', r => r.own), cat('back', r => r.back), cat('grow', r => r.grow)],
      mine: mine ? { sales: mine.sales, orders: mine.orders, back: mine.back, data: mine.data, won: mine.won, close: mine.close, grow: mine.grow } : null };
  };
  const el = now - w0, mel = now - m0;
  const teamTarget = names.reduce((s, n) => s + (tgt[n] || 0), 0);
  return { ok: true, now, week: period(w0, w0 + 7 * DAY, w0 - 7 * DAY, w0 - 7 * DAY + el, 3, 7 * DAY / (m1 - m0)), month: period(m0, m1, pm0, Math.min(m0, pm0 + mel), 5, 1), // tiến bộ: so với cùng kỳ tuần / tháng trước
    team: { month: mk, sales: sum(m0, m1), target: teamTarget, days: Math.round((m1 - m0) / DAY), day: Math.floor((t0 - m0) / DAY) + 1 } };
}
async function crmCustOrders(x, u, d) {
  const phone = normPhone(d.phone);
  if (u.level < 2 && await ownerOf(x, phone) !== u.name) return { ok: false, error: 'Khách này không do bạn phụ trách.' };
  const os = await all(x.db, 'SELECT * FROM orders WHERE phone = ? ORDER BY time, rid', phone);
  const c = await first(x.db, 'SELECT note FROM customers WHERE phone = ?', phone);
  return { ok: true, orders: os.map(orderOut), note: c ? c.note || '' : '' };
}

/* ================================================================ chia khách & phạm vi dữ liệu */
export { refCode };
/** Khách vào web qua link của sale → tên sale (đang dùng, không phải Marketing); không khớp → ''. */
async function refUser(x, ref) {
  const k = refCode(ref); if (!k) return '';
  const u = (await crmUsers(x)).find(r => r.active && r.role !== 'Marketing' && r.role !== 'Kho' && r.role !== 'Kế toán' && refCode(r.name) === k);
  return u ? u.name : '';
}
export async function ownerOf(x, phone) { const r = await first(x.db, 'SELECT owner FROM customers WHERE phone = ?', normPhone(phone)); return r ? r.owner || '' : ''; }
async function setOwner(x, phone, name) { const r = await run(x.db, 'UPDATE customers SET owner = ? WHERE phone = ?', name, normPhone(phone)); return r.meta.changes > 0; }
export async function nextAssignee(x) {
  const names = (await crmUsers(x)).filter(u => u.active && u.recv).map(u => u.name); if (!names.length) return '';
  const last = x._rr !== undefined ? x._rr : (await kvGet(x.db, 'rr_last')) || '';
  const n = names[(names.indexOf(last) + 1) % names.length]; x._rr = n; await kvSet(x.db, 'rr_last', n); return n;
}
export async function autoOwner(x) { return (await assignMode(x)) === 'auto' ? nextAssignee(x) : ''; }
/** Nhân viên chỉ được làm việc với khách mình phụ trách. Chế độ Kho chung: khách chưa ai phụ trách → người thao tác nhận luôn. */
async function guardPhone(x, u, phone) {
  if (u.level >= 2) return '';
  phone = normPhone(phone);
  const c = await first(x.db, 'SELECT owner, name FROM customers WHERE phone = ?', phone); if (!c) return '';
  const owner = c.owner || '';
  if (owner === u.name) return '';
  if (!owner && await assignMode(x) === 'pool') { await setOwner(x, phone, u.name); await crmLog(x, u, 'Nhận khách', phone, c.name, 'Kho chung', ''); return ''; }
  return owner ? 'Khách này do ' + owner + ' phụ trách. Cần đổi người phụ trách thì nhờ quản lý chuyển.' : 'Khách này chưa được giao cho bạn. Nhờ quản lý giao.';
}
async function guardLead(x, u, ld) {
  if (u.level >= 2) return '';
  const owner = ld.owner || '';
  if (owner === u.name) return '';
  if (!owner && ld.by_name === 'Website' && !ld.pool_n) return 'Khách để lại số trên web: chờ quản lý giao người phụ trách.';
  if (!owner && await assignMode(x) === 'pool') { const lim = await poolLimit(x, u); if (lim) return lim; await leadUpdate(x, ld.id, { owner: u.name }); ld.owner = u.name; await crmLog(x, u, 'Nhận khách', ld.phone, ld.name, 'Kho chung – tiềm năng' + (ld.pool_from ? ' (trước: ' + ld.pool_from + ')' : ''), ''); return ''; }
  return owner ? 'Khách này do ' + owner + ' phụ trách. Nhờ quản lý chuyển nếu cần.' : 'Khách này chưa được giao cho bạn. Nhờ quản lý giao.';
}
/** Số điện thoại này của ai? Nhân viên chỉ biết tên người phụ trách, không thấy thông tin khách. */
async function crmCheckPhone(x, u, d) {
  const phone = await mainPhone(x, d.phone); if (!/^0\d{9,10}$/.test(phone)) return { ok: true, status: 'none' };
  const c = await first(x.db, 'SELECT owner FROM customers WHERE phone = ?', phone);
  if (!c) {
    const ol = await first(x.db, "SELECT owner, by_name, pool_n FROM leads WHERE phone = ? AND status IN ('Mới hỏi', 'Đang tư vấn') ORDER BY rid LIMIT 1", phone);
    if (ol && !ol.owner && ol.by_name === 'Website' && !ol.pool_n && u.level < 2) return { ok: true, status: 'other', owner: 'Quản lý (khách web chờ giao)', lead: true };
    if (ol) return { ok: true, status: ol.owner === u.name ? 'mine' : ol.owner ? 'other' : 'free', owner: ol.owner || '', lead: true };
    return { ok: true, status: 'none' };
  }
  const owner = c.owner || '';
  return { ok: true, status: owner === u.name ? 'mine' : owner ? 'other' : 'free', owner };
}
async function crmAssign(x, u, d) {
  const to = String(d.to || ''); let n = 0, ln = 0;
  for (const ph of d.phones || []) if (await setOwner(x, ph, to)) n++;
  for (const id of d.leadIds || []) if (await leadUpdate(x, id, { owner: to })) ln++;
  if (d.withLeads && (d.phones || []).length) { const r = await run(x.db, "UPDATE leads SET owner = ?, own_at = ? WHERE status IN ('Mới hỏi', 'Đang tư vấn') AND phone IN (SELECT value FROM json_each(?))", to, Date.now(), JSON.stringify((d.phones || []).map(normPhone))); ln += r.meta.changes; }
  await crmLog(x, u, 'Giao khách', '-', to || 'bỏ phụ trách', n + ' khách, ' + ln + ' tiềm năng', '');
  return { ok: true, customers: n, leads: ln };
}
async function crmBulk(x, u, d) {
  const names = (await crmUsers(x)).filter(y => y.active && y.recv).map(y => y.name);
  if (d.spread && !names.length) return { ok: false, error: 'Chưa có ai bật "Nhận khách mới".' };
  if (!d.spread && (!d.from || !d.to || d.from === d.to)) return { ok: false, error: 'Chọn người chuyển đi và người nhận.' };
  let n = 0, ln = 0;
  if (d.spread) {
    const cs = await all(x.db, "SELECT phone FROM customers WHERE (owner = '' OR owner IS NULL) AND (orders > 0 OR flag != '')");
    const ls = await all(x.db, "SELECT id FROM leads WHERE (owner = '' OR owner IS NULL) AND status IN ('Mới hỏi', 'Đang tư vấn')");
    let last = (await kvGet(x.db, 'rr_last')) || '', i = names.indexOf(last);
    const pick = () => { i = (i + 1) % names.length; return names[i]; };
    const ca = cs.map(r => ({ k: r.phone, o: pick() })), la = ls.map(r => ({ k: r.id, o: pick() }));
    for (let k = 0; k < ca.length; k += 500) await run(x.db, "UPDATE customers SET owner = json_extract(j.value, '$.o') FROM json_each(?) j WHERE customers.phone = json_extract(j.value, '$.k')", JSON.stringify(ca.slice(k, k + 500)));
    for (let k = 0; k < la.length; k += 500) await run(x.db, "UPDATE leads SET owner = json_extract(j.value, '$.o'), own_at = " + Date.now() + " FROM json_each(?) j WHERE leads.id = json_extract(j.value, '$.k')", JSON.stringify(la.slice(k, k + 500)));
    if (i >= 0) await kvSet(x.db, 'rr_last', names[i]);
    n = ca.length; ln = la.length;
  } else {
    n = (await run(x.db, 'UPDATE customers SET owner = ? WHERE owner = ?', d.to, d.from)).meta.changes;
    ln = (await run(x.db, "UPDATE leads SET owner = ?, own_at = ? WHERE owner = ? AND status IN ('Mới hỏi', 'Đang tư vấn')", d.to, Date.now(), d.from)).meta.changes;
  }
  await crmLog(x, u, 'Giao khách', '-', d.spread ? 'Chia đều khách chưa ai phụ trách' : d.from + ' → ' + d.to, n + ' khách, ' + ln + ' tiềm năng', '');
  return { ok: true, customers: n, leads: ln };
}
async function crmRecv(x, u, d) {
  const y = (await crmUsers(x)).find(z => z.name === d.name); if (!y) return { ok: false, error: 'Không tìm thấy ' + d.name };
  await userSet(x, y.email, 'recv', d.on ? 'Có' : 'Không'); await crmLog(x, u, 'Nhân sự', '-', y.name, 'Nhận khách mới: ' + (d.on ? 'Có' : 'Không'), '');
  return { ok: true };
}
async function crmClaim(x, u, d) {
  if (await assignMode(x) !== 'pool' && u.level < 2) return { ok: false, error: 'Đang không ở chế độ Kho chung.' };
  if (d.leadId) { const ld = await leadGet(x, d.leadId); if (!ld) return { ok: false, error: 'Không tìm thấy khách.' }; if (ld.owner && ld.owner !== u.name) return { ok: false, error: 'Khách này vừa được ' + ld.owner + ' nhận.' }; if (!ld.owner && ld.by_name === 'Website' && !ld.pool_n && u.level < 2) return { ok: false, error: 'Khách để lại số trên web: chờ quản lý giao người phụ trách.' }; if (u.level < 2) { const lim = await poolLimit(x, u); if (lim) return { ok: false, error: lim }; } await leadUpdate(x, d.leadId, { owner: u.name }); }
  if (d.phone) { const o = await ownerOf(x, d.phone); if (o && o !== u.name) return { ok: false, error: 'Khách này vừa được ' + o + ' nhận.' }; await setOwner(x, d.phone, u.name); }
  await crmLog(x, u, 'Nhận khách', normPhone(d.phone || ''), '', 'Kho chung', '');
  return { ok: true };
}

/* ================================================================ 🙋 Khách sale tự mang về (10/11/2026, anh Sơn): tự tìm hoặc được khách cũ giới thiệu → hoa hồng payplan.own % mọi đơn trong ownMonths tháng.
 *  Phân loại khi khách có đơn đầu (own_src: self / ref / no), chỉ khách mua lần đầu từ ownFrom. Người hưởng (own_by) = sale thêm khách hỏi / sale có link / sale của người giới thiệu.
 *  Chặn lách luật (10/11/2026, anh Sơn chọn lớp 1 + 2):
 *   Lớp 1 – máy tự chặn: số có trong quảng cáo (lead File QC / web / kênh QC, hoặc danh sách số quảng cáo ads_rows 100 ngày) trước đơn đầu → không tính tự tìm; có trong quảng cáo TRƯỚC khi ghi người giới thiệu → không tính giới thiệu;
 *     trùng nhân sự → không tính; trùng tên + địa chỉ khách cũ (số khác) → không tính; sale tự chọn "📣 khách xem quảng cáo" → không tính.
 *     Cờ ⚠️ (cần quản lý duyệt): chưa ghi khách biết qua đâu, cùng địa chỉ khách cũ / khách 🙋 khác của cùng sale, tỷ lệ khách 🙋 của sale cao bất thường, khách 🙋 của sale hay hoàn.
 *     Chờ chốt OWN_WAIT ngày: trong thời gian này mỗi 6 giờ xét lại (file quảng cáo nhập muộn → tự gỡ). Hết hạn mà không có cờ → own_ok = 1 (đã chốt).
 *   Lớp 2 – quản lý: khách có cờ nằm ở Hôm nay → "🙋 Chờ quản lý duyệt" (Tính / Không tính); mỗi tuần máy chọn OWN_AUDIT khách 🙋 / sale để quản lý gọi xác minh (own_chk 1 → 2 đúng / 3 sai).
 *  own_ok: 0 chờ chốt · 1 đã chốt (máy hoặc quản lý) · -1 đã gỡ (own_src = 'no', own_flag = lý do). Hoa hồng 10% tính khi own_ok ≥ 0 và (own_ok = 1 hoặc chưa có cờ). */
const OWN_SYS = { name: 'Hoa hồng (tự động)', email: '', level: 3, role: 'Hệ thống' }, OWN_ADS = /^(quảng cáo|ebook|form website|facebook|fanpage|instagram|tiktok|shopee|lazada|file )/i;
const OWN_WAIT = 14, OWN_AUDIT = 2, OWN_SHARE = 40, OWN_RECHK = 6 * 3600e3, OWN_HOW_ADS = /^📣/, OWN_SOFT = /^(Chưa ghi|Chỉ đặt qua link)/;
export async function ownPlan(x) { return Object.assign({}, PAYPLAN, await kvJson(x.db, 'payplan_cfg', null) || {}); }
const addrKey = c => { const k = nrm([c.address, c.ward, c.province].filter(Boolean).join(' ')).replace(/[^a-z0-9]+/g, ' ').trim(); return k.length >= 12 && /\d/.test(k) ? k : ''; }; // phải có số nhà, đủ dài → tránh trùng kiểu "xã A, tỉnh B"
const ownLeadAds = l => l.by_name === 'File QC' || l.by_name === 'Website' || OWN_ADS.test(l.channel || '') || /^File cũ/.test(l.channel || '');
async function ownCtx(x) { // dữ liệu dùng chung 1 lượt: nhân sự, số quảng cáo, địa chỉ, thống kê từng sale (30 / 60 ngày)
  const now = Date.now(), [staff, users, ads, addr, ownN, newN, backN] = await Promise.all([staffOf(x), crmUsers(x), kvJson(x.db, 'ads_rows', []),
    all(x.db, "SELECT phone, name, address, ward, province, first, own_src, own_by FROM customers WHERE orders > 0 AND coalesce(address, '') != ''"),
    all(x.db, "SELECT own_by s, count(*) n FROM customers WHERE own_src IN ('self', 'ref') AND own_at >= ? GROUP BY own_by", now - 30 * DAY),
    all(x.db, "SELECT o.seller s, count(DISTINCT o.phone) n FROM orders o JOIN customers c ON c.phone = o.phone WHERE c.first >= ? AND o.time <= c.first + 3600000 GROUP BY o.seller", now - 30 * DAY),
    all(x.db, "SELECT c.own_by s, count(DISTINCT c.phone) n, sum(CASE WHEN EXISTS (SELECT 1 FROM orders o WHERE o.phone = c.phone AND o.status LIKE '%oàn%') THEN 1 ELSE 0 END) b FROM customers c WHERE c.own_src IN ('self', 'ref') AND c.own_at >= ? GROUP BY c.own_by", now - 60 * DAY)]);
  const adsAt = {}; (ads || []).forEach(a => { const p = normPhone(a[1]), t = Number(a[0]) || 0; if (p && t && (!adsAt[p] || t < adsAt[p])) adsAt[p] = t; });
  const byAddr = {}; addr.forEach(c => { const k = addrKey(c); if (k) (byAddr[k] = byAddr[k] || []).push(c); });
  const saleFlag = {}, nn = {}; newN.forEach(r => { nn[r.s] = r.n; });
  ownN.forEach(r => { const tot = Math.max(nn[r.s] || 0, r.n), pc = Math.round(r.n * 100 / tot); if (r.n >= 5 && pc > OWN_SHARE) (saleFlag[r.s] = saleFlag[r.s] || []).push(r.s + ' có ' + pc + '% khách mới 30 ngày là khách 🙋 (cao bất thường, mức xem lại > ' + OWN_SHARE + '%)'); });
  backN.forEach(r => { if (r.b >= 2 && r.b * 100 >= r.n * 30) (saleFlag[r.s] = saleFlag[r.s] || []).push(r.b + '/' + r.n + ' khách 🙋 của ' + r.s + ' có đơn hoàn trong 60 ngày'); });
  return { staff, users, saleNames: new Set(users.map(v => v.name)), adsAt, byAddr, saleFlag };
}
/** Xét 1 khách → { src, by, how, why (lý do không tính, rỗng = không tính mà không cần báo), flags[] }. */
async function ownCheck(x, C, c) {
  const [fo, lds, rs] = await Promise.all([
    first(x.db, "SELECT id, time, seller, ref_phone, note FROM orders WHERE phone = ? AND status NOT LIKE '%uỷ%' AND status NOT LIKE '%ủy%' ORDER BY time LIMIT 1", c.phone),
    all(x.db, 'SELECT by_name, channel, owner, ref_phone, ref_name, time, coalesce(how, \'\') AS how FROM leads WHERE phone = ? ORDER BY time', c.phone),
    first(x.db, 'SELECT sale, void, at, ref_phone FROM ref_sale WHERE phone = ?', c.phone)]);
  const t0 = fo ? fo.time : c.first, flags = [], R = { src: 'no', by: '', how: c.own_how || '', why: '', flags };
  const guard = staffHit(C.staff, { phone: c.phone, name: c.name || '' }); if (guard) { R.why = guard; return R; }
  let adsT = C.adsAt[c.phone] && C.adsAt[c.phone] <= t0 + DAY ? C.adsAt[c.phone] : 0; // ngày có trong file số quảng cáo (trước đơn đầu, lệch ngày cho phép 1 ngày)
  lds.forEach(l => { if (ownLeadAds(l) && l.time <= t0 + DAY && (!adsT || l.time < adsT)) adsT = l.time; });
  const refLead = lds.find(l => l.ref_phone || l.ref_name), refTs = [refLead && refLead.time, rs && !rs.void && rs.at, fo && fo.ref_phone && fo.time].filter(Boolean), refT = refTs.length ? Math.min(...refTs) : 0;
  if (refT) {
    if (adsT && adsT < refT - 3600e3) { R.why = 'Số đã có trong quảng cáo / web từ ' + fmtDate(adsT, 'dd/MM') + ', trước khi ghi người giới thiệu (' + fmtDate(refT, 'dd/MM') + ')'; return R; }
    R.src = 'ref'; R.by = (rs && !rs.void && rs.sale) || (refLead && refLead.owner) || (fo && fo.seller) || c.owner || '';
  } else {
    if (adsT) { R.why = c.own_src === 'self' ? 'Số có trong quảng cáo / web từ ' + fmtDate(adsT, 'dd/MM') + ' (file quảng cáo về sau)' : ''; return R; }
    const selfLd = lds.find(l => l.by_name && C.saleNames.has(l.by_name) && l.time <= t0 + 3600e3);
    const lm = fo && String(fo.note || '').match(/🔗 Đặt qua link của ([^(·\n]+)/), linkBy = lm ? lm[1].trim() : '';
    if (selfLd) { R.src = 'self'; R.by = selfLd.by_name; R.how = R.how || selfLd.how || ''; if (!R.how) flags.push('Chưa ghi khách biết sale qua đâu'); }
    else if (linkBy && C.saleNames.has(linkBy)) { R.src = 'self'; R.by = linkBy; if (!R.how) flags.push('Chỉ đặt qua link riêng, chưa ghi khách biết sale qua đâu'); }
    if (R.src === 'self' && OWN_HOW_ADS.test(R.how)) { R.src = 'no'; R.why = c.own_src ? 'Sale ghi khách biết qua quảng cáo / fanpage công ty' : ''; return R; }
  }
  if (!R.by) { R.src = 'no'; return R; }
  const k = addrKey(c), same = k ? (C.byAddr[k] || []).filter(o => o.phone !== c.phone) : [];
  const old = same.find(o => (Number(o.first) || 0) < (Number(c.first) || 0) - 3600e3);
  if (old && c.name && nrm(old.name) === nrm(c.name)) { R.src = 'no'; R.why = 'Trùng tên + địa chỉ khách cũ ' + (old.name || '') + ' ' + old.phone + ' (khách cũ đổi số)'; return R; }
  const refPh = R.src === 'ref' ? normPhone((refLead && refLead.ref_phone) || (fo && fo.ref_phone) || (rs && rs.ref_phone) || '') : '';
  if (refPh && same.some(o => o.phone === refPh)) { R.src = 'no'; R.why = 'Cùng địa chỉ với người giới thiệu ' + refPh + ' (người nhà mua thay)'; return R; }
  if (old) flags.push('Cùng địa chỉ khách cũ ' + (old.name || '') + ' ' + old.phone + ' (có thể người nhà)');
  const mates = same.filter(o => o.own_by === R.by && (o.own_src === 'self' || o.own_src === 'ref'));
  if (mates.length) flags.push('Cùng địa chỉ với ' + mates.length + ' khách 🙋 khác của ' + R.by);
  (C.saleFlag[R.by] || []).forEach(f => flags.push(f));
  return R;
}
const ownBoss = (C, text) => Promise.all(C.users.filter(m => m.active && m.tg && m.level >= 2).map(m => telegramTo(C.env, m.tg, text).catch(() => { })));
export async function ownTick(x) {
  const PP = await ownPlan(x); if (!PP.own) return;
  const from = (dateOrBlank(PP.ownFrom) || 9 * 3600e3) - 9 * 3600e3, now = Date.now(); // dateOrBlank = 9h sáng → lùi về 0h ngày đó
  await run(x.db, "UPDATE customers SET own_src = 'no' WHERE orders > 0 AND first IS NOT NULL AND first < ? AND (own_src IS NULL OR own_src = '')", from); // khách cũ trước ngày áp dụng: không xét (1 câu, nhanh)
  const rows = await all(x.db, "SELECT phone, name, first, owner, address, ward, province, own_src, own_how FROM customers WHERE orders > 0 AND first IS NOT NULL AND first >= ? AND (own_src IS NULL OR own_src = '') ORDER BY first DESC LIMIT 150", from);
  const reChk = now - (Number(await kvGet(x.db, 'own_rechk')) || 0) >= OWN_RECHK;
  const pend = reChk ? await all(x.db, "SELECT phone, name, first, owner, address, ward, province, own_src, own_by, own_at, own_how, coalesce(own_flag, '') AS own_flag FROM customers WHERE own_src IN ('self', 'ref') AND coalesce(own_ok, 0) = 0 LIMIT 300") : [];
  if (reChk) await kvSet(x.db, 'own_rechk', String(now));
  const R0 = await rulesCfg(x), selfOn = !!R0.selfOn;
  if (rows.length || pend.length) {
    const C = Object.assign(await ownCtx(x), { env: x.env }), bySale = {}, boss = [], toSale = {};
    for (const c of rows) {
      const r = await ownCheck(x, C, c), src = r.by ? r.src : 'no', fl = r.flags.join(' · ');
      await run(x.db, 'UPDATE customers SET own_src = ?, own_at = ?, own_by = ?, own_how = ?, own_flag = ?, own_ok = 0, own_chk = 0 WHERE phone = ?', src, src === 'no' ? null : c.first, src === 'no' ? '' : r.by, r.how || '', src === 'no' ? r.why : fl, c.phone);
      const end = fmtDate(c.first + PP.ownMonths * 30.44 * DAY, 'dd/MM/yyyy'), kind = src === 'self' ? 'sale tự tìm' : 'khách cũ giới thiệu';
      if (src !== 'no') {
        await crmLog(x, OWN_SYS, 'Khách tự mang về', c.phone, c.name, r.by, kind + ' · hoa hồng ' + PP.own + '% mọi đơn tới ' + end + (r.how ? ' · biết qua: ' + r.how : '') + (fl ? ' · ⚠️ chờ quản lý duyệt: ' + fl : ' · chờ chốt ' + OWN_WAIT + ' ngày'));
        (bySale[r.by] = bySale[r.by] || []).push('• ' + (c.name || 'Khách') + ' – ' + c.phone + ' (' + kind + ') → ' + PP.own + '% mọi đơn tới ' + end + (fl ? '\n   ⚠️ Chờ quản lý duyệt: ' + fl : ''));
        if (fl) boss.push('• ' + (c.name || c.phone) + ' – ' + c.phone + ' (' + r.by + ', ' + kind + '): ' + fl);
      } else if (r.why) { await crmLog(x, OWN_SYS, 'Không tính tự mang về', c.phone, c.name, '', r.why); boss.push('• ⛔ Không tính ' + (c.name || c.phone) + ' – ' + c.phone + ': ' + r.why); }
    }
    for (const c of pend) { // ⏳ đang chờ chốt: xét lại (file quảng cáo nhập muộn, địa chỉ mới, sale bổ sung nguồn…)
      const r = await ownCheck(x, C, c), fl = r.flags.join(' · ');
      if (r.src === 'no' || (r.by && r.by !== c.own_by)) {
        const why = r.why || (r.src === 'no' ? 'Xét lại: không còn đủ điều kiện khách tự mang về' : 'Xét lại: người hưởng đổi thành ' + r.by);
        if (r.src === 'no') {
          await run(x.db, "UPDATE customers SET own_src = 'no', own_ok = -1, own_flag = ? WHERE phone = ?", why, c.phone);
          await crmLog(x, OWN_SYS, 'Gỡ khách tự mang về', c.phone, c.name, c.own_by, why);
          boss.push('• ↩ Gỡ 🙋 ' + (c.name || c.phone) + ' – ' + c.phone + ' (' + c.own_by + '): ' + why); (toSale[c.own_by] = toSale[c.own_by] || []).push('• ' + (c.name || 'Khách') + ' – ' + c.phone + ': ' + why);
        } else { await run(x.db, 'UPDATE customers SET own_by = ?, own_src = ?, own_flag = ? WHERE phone = ?', r.by, r.src, fl, c.phone); await crmLog(x, OWN_SYS, 'Đổi người hưởng tự mang về', c.phone, c.name, r.by, c.own_by + ' → ' + r.by); }
        continue;
      }
      if (fl !== c.own_flag) {
        await run(x.db, 'UPDATE customers SET own_flag = ?, own_how = ? WHERE phone = ?', fl, r.how || '', c.phone);
        const added = r.flags.filter(f => c.own_flag.indexOf(f) < 0); if (added.length) boss.push('• ⚠️ ' + (c.name || c.phone) + ' – ' + c.phone + ' (' + c.own_by + '): ' + added.join(' · '));
      }
      if (!fl && now - (Number(c.own_at) || now) >= OWN_WAIT * DAY) { await run(x.db, 'UPDATE customers SET own_ok = 1 WHERE phone = ?', c.phone); await crmLog(x, OWN_SYS, 'Chốt khách tự mang về', c.phone, c.name, c.own_by, 'qua ' + OWN_WAIT + ' ngày không có dấu hiệu lạ → chốt hoa hồng ' + PP.own + '%'); }
    }
    if (boss.length) await ownBoss(C, '<b>🙋 Khách tự mang về – quản lý xem</b>\n' + boss.slice(0, 25).map(esc).join('\n') + (boss.length > 25 ? '\n… và ' + (boss.length - 25) + ' khách nữa' : '') + '\n\nDuyệt ở CRM → Hôm nay → 🙋 Chờ quản lý duyệt: ' + CRM_URL + '/#hom-nay');
    if (selfOn) { // chưa công bố với sale (Cài đặt → Tự tạo khách đang ẩn): phân loại vẫn ghi, chưa nhắn
      for (const n of Object.keys(bySale)) { const y = C.users.find(v => v.name === n && v.active); if (y && y.tg) { try { await telegramTo(x.env, y.tg, '<b>🙋 Khách bạn tự mang về</b> – hoa hồng ' + PP.own + '% mọi đơn trong ' + PP.ownMonths + ' tháng (chờ chốt ' + OWN_WAIT + ' ngày):\n' + bySale[n].map(esc).join('\n') + '\n\nXem ở Hiệu quả → 💰 Thu nhập tạm tính.'); } catch (e) { } } }
      for (const n of Object.keys(toSale)) { const y = C.users.find(v => v.name === n && v.active); if (y && y.tg) { try { await telegramTo(x.env, y.tg, '<b>↩ Không tính khách tự mang về</b>\n' + toSale[n].map(esc).join('\n') + '\n\nCó thắc mắc thì báo quản lý.'); } catch (e) { } } }
    }
  }
  await ownAudit(x);
}
/** 📞 Mỗi tuần (từ thứ 2) chọn ngẫu nhiên OWN_AUDIT khách 🙋 / sale (đơn đầu trong 45 ngày, chưa gọi xác minh) để quản lý gọi hỏi "Chị biết Thực Dưỡng Lành qua đâu ạ?". */
async function ownAudit(x) {
  const vn = new Date(Date.now() + TZ_MS), wd = (vn.getUTCDay() + 6) % 7, mon = fmtDate(Date.now() - wd * DAY, 'yyyy-MM-dd');
  if (vn.getUTCHours() < 8 || (await kvGet(x.db, 'own_audit_wk')) === mon) return;
  await kvSet(x.db, 'own_audit_wk', mon);
  const cs = await all(x.db, "SELECT phone, name, own_by, own_src FROM customers WHERE own_src IN ('self', 'ref') AND coalesce(own_ok, 0) >= 0 AND coalesce(own_chk, 0) = 0 AND own_at >= ?", Date.now() - 45 * DAY);
  const by = {}; cs.forEach(c => { (by[c.own_by] = by[c.own_by] || []).push(c); });
  const pick = [];
  for (const s of Object.keys(by)) { const a = by[s]; for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; } a.slice(0, OWN_AUDIT).forEach(c => pick.push(c)); }
  if (!pick.length) return;
  for (const c of pick) await run(x.db, 'UPDATE customers SET own_chk = 1 WHERE phone = ?', c.phone);
  await crmLog(x, OWN_SYS, 'Chọn gọi xác minh', '-', '', pick.length + ' khách', pick.map(c => c.own_by + ': ' + c.phone).join(', '));
  const users = await crmUsers(x), msg = '<b>📞 Gọi xác minh khách tự mang về tuần này</b> (' + pick.length + ' khách, máy chọn ngẫu nhiên)\nHỏi khách: <i>"Chị biết Thực Dưỡng Lành qua đâu ạ?"</i> rồi bấm Đúng / Sai ở CRM → Hôm nay.\n' + pick.map(c => '• ' + esc(c.name || 'Khách') + ' – ' + c.phone + ' (' + esc(c.own_by) + ', ' + (c.own_src === 'self' ? 'tự tìm' : 'giới thiệu') + ')').join('\n');
  for (const m of users) if (m.active && m.tg && m.level >= 2) { try { await telegramTo(x.env, m.tg, msg); } catch (e) { } }
}
/** Lệnh CRM own: { phone, act: 'how' (sale bổ sung khách biết qua đâu) | 'ok' / 'no' (quản lý duyệt / không tính) | 'chk_ok' / 'chk_no' (kết quả gọi xác minh), how, why }. */
async function crmOwn(x, u, d) {
  const phone = normPhone(d.phone), act = String(d.act || ''), c = await first(x.db, "SELECT phone, name, own_src, own_by, coalesce(own_ok, 0) AS own_ok, coalesce(own_flag, '') AS own_flag, coalesce(own_chk, 0) AS own_chk FROM customers WHERE phone = ?", phone);
  if (!c || (c.own_src !== 'self' && c.own_src !== 'ref')) return { ok: false, error: 'Khách này không phải khách tự mang về (hoặc đã bị gỡ).' };
  const why = String(d.why || '').trim().slice(0, 200), out = () => first(x.db, "SELECT own_src, own_ok, coalesce(own_flag, '') AS own_flag, coalesce(own_how, '') AS own_how, coalesce(own_chk, 0) AS own_chk FROM customers WHERE phone = ?", phone).then(r => ({ ok: true, ownSrc: r.own_src === 'no' ? '' : r.own_src, ownOk: r.own_ok || 0, ownFlag: r.own_flag, ownHow: r.own_how, ownChk: r.own_chk }));
  if (act === 'how') {
    if (c.own_by !== u.name && u.level < 2) return { ok: false, error: 'Chỉ ' + c.own_by + ' hoặc quản lý ghi được.' };
    const how = String(d.how || '').trim().slice(0, 160); if (how.length < 4) return { ok: false, error: 'Chọn khách biết bạn qua đâu và ghi rõ thêm (tên nhóm, sự kiện, người quen…).' };
    if (c.own_ok !== 0) return { ok: false, error: 'Khách này đã chốt, không sửa được nữa.' };
    if (OWN_HOW_ADS.test(how)) { await run(x.db, "UPDATE customers SET own_how = ?, own_src = 'no', own_ok = -1, own_flag = ? WHERE phone = ?", how, 'Sale ghi khách biết qua quảng cáo / fanpage công ty', phone); await crmLog(x, u, 'Gỡ khách tự mang về', phone, c.name, c.own_by, 'Sale ghi: ' + how); return out(); }
    const fl = c.own_flag.split(' · ').filter(f => f && !OWN_SOFT.test(f)).join(' · ');
    await run(x.db, 'UPDATE customers SET own_how = ?, own_flag = ? WHERE phone = ?', how, fl, phone);
    await crmLog(x, u, 'Nguồn khách tự mang về', phone, c.name, c.own_by, how); return out();
  }
  if (u.level < 2) return { ok: false, error: 'Chỉ quản lý duyệt được.' };
  if (act === 'ok') { await run(x.db, 'UPDATE customers SET own_ok = 1 WHERE phone = ?', phone); await crmLog(x, u, 'Duyệt khách tự mang về', phone, c.name, c.own_by, 'Tính hoa hồng' + (c.own_flag ? ' (cờ: ' + c.own_flag + ')' : '') + (why ? ' · ' + why : '')); }
  // chk_ok: gọi khách xác nhận đúng → khách đang có cờ thì coi như quản lý đã duyệt
  else if (act === 'chk_ok') { await run(x.db, 'UPDATE customers SET own_chk = 2, own_ok = CASE WHEN own_ok = 0 AND coalesce(own_flag, \'\') != \'\' THEN 1 ELSE own_ok END WHERE phone = ?', phone); await crmLog(x, u, 'Gọi xác minh', phone, c.name, c.own_by, 'Đúng' + (why ? ' · ' + why : '')); }
  else if (act === 'no' || act === 'chk_no') {
    if (!why) return { ok: false, error: 'Ghi lý do không tính giúp em (sale sẽ thấy lý do này).' };
    await run(x.db, "UPDATE customers SET own_src = 'no', own_ok = -1, own_flag = ?, own_chk = ? WHERE phone = ?", 'Quản lý không tính: ' + why, act === 'chk_no' ? 3 : c.own_chk, phone);
    await crmLog(x, u, act === 'chk_no' ? 'Gọi xác minh' : 'Không tính tự mang về', phone, c.name, c.own_by, (act === 'chk_no' ? 'Sai · ' : '') + why);
    if ((await rulesCfg(x)).selfOn) x.later(telegramUser(x, c.own_by, '↩ Khách ' + esc(c.name || phone) + ' – ' + phone + ' không được tính là khách bạn tự mang về: ' + esc(why) + '. Có thắc mắc thì báo ' + esc(u.name) + '.').catch(() => { }));
  } else return { ok: false, error: 'Lệnh không đúng.' };
  return out();
}

/* ================================================================ 🧺 Kho chung: số quá hạn chưa chốt tự về kho (09/11/2026, ý anh Sơn + bạn anh: người này không chốt được, người khác có thể chốt) */
const POOL_DAYS = 30, POOL_MAX = 10, POOL_ROUNDS = 2, POOL_FRESH = 45; // mặc định: về kho sau 30 ngày (anh Sơn 10/11/2026: tạm 30, họp sale rồi chỉnh ở Cài đặt); nhận tối đa 10 số / ngày; mỗi số về kho tối đa 2 vòng; chỉ xét khách hỏi trong 45 ngày gần đây (file cũ, số rất cũ không đụng)
// 11/11/2026 (anh Sơn): 3 mốc, mỗi mốc chỉnh ở Cài đặt (0 = tắt mốc đó): chưa liên hệ lần nào sau POOL_NOCALL ngày · đã liên hệ nhưng POOL_IDLE ngày không chăm lại · giữ tối đa poolDays ngày chưa chốt.
// Hẹn gọi lại giữ số, nhưng mỗi lần hẹn tối đa POOL_CB_MAX ngày (hẹn xa hơn coi như không hẹn → tránh hẹn ảo để giữ số). Liên hệ = leads.last_at (💬 Tư vấn) hoặc nhật ký chăm sóc của chính người giữ (CONTACT_WHAT).
const POOL_NOCALL = 2, POOL_IDLE = 10, POOL_CB_MAX = 14;
const CONTACT_WHAT = "('Tư vấn', 'Ghi nhanh', 'Trả lời liên hệ', 'Gửi ưu đãi', 'Gửi quà tặng', 'Gửi lời chúc', 'Gọi xác minh', 'Cộng đồng')";
const CARED_DAYS = 30; // đơn web: sale có liên hệ khách trong bấy nhiêu ngày trước khi đặt → tính như đặt qua link (đủ % khách mới)
const LEAD_OWN = 'coalesce(own_at, time)';
const LEAD_LASTC = "max(coalesce(last_at, 0), coalesce((SELECT max(g.time) FROM logs g WHERE g.ref IN (leads.phone, '''' || leads.phone) AND g.by_name = leads.owner AND g.what IN " + CONTACT_WHAT + "), 0))"; // lần liên hệ cuối của người đang giữ
export function poolRuleTxt(R) {
  const t = [R.poolNoCall ? 'chưa liên hệ lần nào sau ' + R.poolNoCall + ' ngày' : '', R.poolIdle ? R.poolIdle + ' ngày không chăm lại' : '', R.poolDays ? 'giữ quá ' + R.poolDays + ' ngày chưa chốt' : ''].filter(Boolean);
  return t.length ? 'Khách hỏi về Kho chung khi: ' + t.join(' / ') + ' (có hẹn gọi lại ≤ ' + POOL_CB_MAX + ' ngày thì giữ)' : 'Tắt tự về Kho chung';
}
const POOL_SYS = { name: 'Kho chung (tự động)', email: '', level: 3, role: 'Hệ thống' };
/** Mỗi người 1 ngày chỉ nhận tối đa poolMax khách từ Kho chung (0 = không giới hạn) → không ai vơ hết số. Đếm theo dòng Nhật ký "Nhận khách". */
async function poolLimit(x, u) {
  const R = await rulesCfg(x); if (!R.poolMax) return '';
  const r = await first(x.db, "SELECT count(*) n FROM logs WHERE by_name = ? AND what = 'Nhận khách' AND time >= ?", u.name, startOfDay(Date.now()));
  return r && r.n >= R.poolMax ? 'Hôm nay bạn đã nhận ' + r.n + ' khách từ Kho chung (tối đa ' + R.poolMax + ' / ngày). Chăm kỹ các khách đã nhận, mai nhận tiếp nhé.' : '';
}
/** Điều kiện về kho (SQL dùng chung cho báo trước + về kho): đang mở, có người giữ, hỏi trong POOL_FRESH ngày, giữ quá ?2, không có hẹn còn hiệu lực (hẹn đã qua hơn 1 ngày thì coi như không hẹn),
 *  chưa quá POOL_ROUNDS vòng, và là số công ty giao: không phải sale tự thêm (by_name = owner), không phải khách do khách cũ giới thiệu, không phải file cũ. */
const POOL_BASE = "FROM leads WHERE status IN ('Mới hỏi', 'Đang tư vấn') AND owner != '' AND owner IS NOT NULL AND time > ? AND (callback IS NULL OR callback < ? OR callback > ?) AND coalesce(pool_n, 0) < " + POOL_ROUNDS +
  " AND coalesce(by_name, '') != owner AND coalesce(ref_phone, '') = '' AND coalesce(ref_name, '') = '' AND coalesce(channel, '') NOT LIKE 'File cũ%'";
/** SQL + tham số cho số quá hạn theo 3 mốc; ahead = 1 → sớm 1 ngày (để báo trước). null = cả 3 mốc đang tắt. */
function poolSql(R, now, ahead) {
  const t = n => now - (n - ahead) * DAY, ors = [], args = [now - POOL_FRESH * DAY, now - DAY, now + POOL_CB_MAX * DAY];
  if (R.poolNoCall) { ors.push('(' + LEAD_LASTC + ' < ' + LEAD_OWN + ' AND ' + LEAD_OWN + ' < ?)'); args.push(t(R.poolNoCall)); }
  if (R.poolIdle) { ors.push('(' + LEAD_LASTC + ' >= ' + LEAD_OWN + ' AND ' + LEAD_LASTC + ' < ?)'); args.push(t(R.poolIdle)); }
  if (R.poolDays) { ors.push('(' + LEAD_OWN + ' < ?)'); args.push(t(R.poolDays)); }
  return ors.length ? { sql: POOL_BASE + ' AND (' + ors.join(' OR ') + ')', args } : null;
}
/** Vì sao số này về kho (ghi chú, Telegram) */
function poolWhy(R, l, now) {
  const own = Number(l.own_at || l.time), lc = Number(l.lc) || 0, d = ms => Math.floor(ms / DAY);
  if (R.poolNoCall && lc < own && now - own >= (R.poolNoCall - 1) * DAY) return 'chưa liên hệ lần nào sau ' + d(now - own) + ' ngày';
  if (R.poolIdle && lc >= own && now - lc >= (R.poolIdle - 1) * DAY) return d(now - lc) + ' ngày không chăm lại';
  return 'giữ ' + d(now - own) + ' ngày chưa chốt';
}
/** Khách hỏi đang có người giữ: người đó có đang chăm không (cùng luật với Kho chung). Dùng khi khách đặt đơn web (11/11/2026). */
export async function leadKeeper(x, phone) {
  const R = await rulesCfg(x), now = Date.now();
  const l = await first(x.db, "SELECT owner, own_at, time, callback, " + LEAD_LASTC + " AS lc FROM leads WHERE phone = ? AND status IN ('Mới hỏi', 'Đang tư vấn') AND coalesce(owner, '') != '' AND " + LEAD_OWN + " > ? ORDER BY " + LEAD_OWN + " DESC LIMIT 1", normPhone(phone), now - 90 * DAY);
  if (!l) return null;
  const own = Number(l.own_at || l.time), lc = Number(l.lc) || 0, cb = Number(l.callback) || 0;
  const caring = (cb >= now - DAY && cb <= now + POOL_CB_MAX * DAY) || (lc < own ? now - own < (R.poolNoCall || POOL_NOCALL) * DAY : now - lc < (R.poolIdle || POOL_IDLE) * DAY);
  return { owner: l.owner, caring, idle: Math.floor((now - Math.max(lc, own)) / DAY), never: lc < own };
}
/** Chạy theo lịch (25 phút / lần, giờ làm việc). Bước 1: số đã báo trước ≥ 20 tiếng mà vẫn chưa chốt / chưa hẹn → về kho, báo người giữ cũ + nhóm Telegram. Bước 2: số sắp quá hạn (còn ≤ 1 ngày) → báo riêng người đang giữ 1 lần. */
export async function poolTick(x) {
  if (await assignMode(x) !== 'pool') return;
  const R = await rulesCfg(x), now = Date.now(); if (!R.poolOn) return; // tắt Kho chung (Cài đặt) → không báo, không trả số về kho
  const Q = poolSql(R, now, 0), Q1 = poolSql(R, now, 1); if (!Q) return; // cả 3 mốc = 0
  const users = await crmUsers(x), tgOf = n => { const y = users.find(z => z.name === n && z.active); return y && y.tg; };
  const line = l => '• ' + (l.name || 'Khách') + ' – ' + l.phone + (l.interest ? ' · ' + String(l.interest).slice(0, 40) : '') + ' (hỏi ' + fmtDate(l.time, 'dd/MM') + ')';
  const due = await all(x.db, 'SELECT *, ' + LEAD_LASTC + ' AS lc ' + Q.sql + ' AND pool_warn IS NOT NULL AND pool_warn < ? ORDER BY time LIMIT 100', ...Q.args, now - 20 * 3600e3);
  const byOwner = {};
  for (const l of due) {
    const why = poolWhy(R, l, now); l.why = why;
    await run(x.db, "UPDATE leads SET owner = '', own_at = ?, pool_n = coalesce(pool_n, 0) + 1, pool_from = ?, pool_warn = NULL, note = ? WHERE id = ?", now, l.owner,
      String(l.note || '') + '\n[' + fmtDate(now, 'dd/MM') + '] ↩ Về Kho chung: ' + l.owner + ' ' + why, l.id);
    await crmLog(x, POOL_SYS, 'Về kho chung', l.phone, l.name, l.owner, why + (l.pool_n ? ' · vòng ' + (l.pool_n + 1) : ''));
    (byOwner[l.owner] = byOwner[l.owner] || []).push(l);
  }
  if (due.length) {
    for (const n of Object.keys(byOwner)) { const tg = tgOf(n); if (tg) await telegramTo(x.env, tg, '<b>↩️ Đã về Kho chung</b> (cả phòng cùng khai thác):\n' + byOwner[n].map(l => esc(line(l) + ' – ' + l.why)).join('\n') + '\n\nLần sau: gọi / nhắn xong thì ghi 💬 Tư vấn; khách hẹn thì chọn ngày hẹn (tối đa ' + POOL_CB_MAX + ' ngày), số được giữ tới ngày hẹn.'); }
    await telegram(x.env, '<b>🧺 KHO CHUNG có ' + due.length + ' khách hỏi mới</b> – ai nhận cũng được. Đọc lịch sử tư vấn trước khi gọi, thử cách khác người trước:\n' + due.slice(0, 30).map(l => esc(line(l)) + ' – từ ' + esc(l.owner)).join('\n') + (due.length > 30 ? '\n… và ' + (due.length - 30) + ' khách nữa' : '') + '\n\n' + CRM_URL);
  }
  const soon = await all(x.db, 'SELECT *, ' + LEAD_LASTC + ' AS lc ' + Q1.sql + ' AND (pool_warn IS NULL OR pool_warn < ' + LEAD_LASTC + ' OR pool_warn < coalesce(own_at, time)) ORDER BY time LIMIT 100', ...Q1.args);
  if (!soon.length) return;
  await run(x.db, 'UPDATE leads SET pool_warn = ? WHERE id IN (SELECT value FROM json_each(?))', now, JSON.stringify(soon.map(l => l.id)));
  const byO = {}; soon.forEach(l => { (byO[l.owner] = byO[l.owner] || []).push(l); });
  for (const n of Object.keys(byO)) { const tg = tgOf(n); if (tg) await telegramTo(x.env, tg, '<b>⏳ Ngày mai về Kho chung</b> nếu chưa chăm / chưa chốt / chưa hẹn gọi lại – ' + byO[n].length + ' khách hỏi:\n' + byO[n].slice(0, 30).map(l => esc(line(l) + ' – ' + poolWhy(R, l, now + DAY))).join('\n') + (byO[n].length > 30 ? '\n… và ' + (byO[n].length - 30) + ' khách nữa' : '') + '\n\nGọi / nhắn ngay hôm nay. Khách hẹn thì bấm 💬 Tư vấn → chọn ngày hẹn.\n' + CRM_URL); }
}

/* ================================================================ màu phân loại khách */
async function crmPrefs(x, u, d) {
  const clean = c => /^#[0-9a-fA-F]{6}$/.test(String(c)) ? c : '', colors = {};
  Object.keys(d.colors || {}).forEach(k => { if (/^(new|old|void|off|vip)$/.test(k) && clean(d.colors[k])) colors[k] = d.colors[k]; });
  const seen = {}, tags = (d.tags || []).map(t => ({ name: String(t.name || '').trim().slice(0, 30), color: clean(t.color) || '#dbeafe' })).filter(t => { if (!t.name || seen[t.name]) return false; seen[t.name] = 1; return true; }).slice(0, 20);
  const cur = await prefsOf(x, u.email), zp = d.zalo === undefined ? cur.zalo || '' : normPhone(d.zalo); // số Zalo bán hàng của nhân viên: in vào tin mời giới thiệu để bạn của khách nhắn thẳng
  if (zp && !/^0\d{9}$/.test(zp)) return { ok: false, error: 'Số Zalo chưa đúng (10 số, bắt đầu bằng 0).' };
  const P = d.colors === undefined && d.tags === undefined ? Object.assign({}, cur, { zalo: zp }) : { colors, tags, zalo: zp };
  await kvSet(x.db, 'prefs_' + u.email, JSON.stringify(P));
  return { ok: true, prefs: P };
}

/* ================================================================ Telegram riêng */
async function crmTgLink(x, u) {
  const code = randHex(5); await kvSet(x.db, 'tg_' + code, u.email, 3600e3);
  return { ok: true, code, url: 'https://t.me/' + BOT_USERNAME + '?start=' + code };
}
async function crmTgCheck(x, u, d) {
  const code = String(d.code || '').replace(/[^a-f0-9]/g, '');
  if (await kvGet(x.db, 'tg_' + code) !== u.email) return { ok: false, error: 'Mã kết nối đã hết hạn, bấm "Kết nối Telegram" lại nhé.' };
  const j = await tgUpdates(x.env); let chat = null;
  (j.result || []).forEach(up => { const m = up.message; if (m && m.chat && m.chat.type === 'private' && String(m.text || '').trim() === '/start ' + code) chat = m.chat.id; });
  if (!chat) return { ok: false, error: j.ok === false ? 'Telegram báo lỗi: ' + (j.description || '') : 'Chưa thấy bạn bấm "Start" trong Telegram. Mở lại link, bấm Start (Bắt đầu) rồi thử lại.' };
  await userSet(x, u.email, 'tg', String(chat));
  await telegramTo(x.env, chat, '✅ Đã kết nối CRM Thực Dưỡng Lành cho <b>' + esc(u.name) + '</b>.\nTừ giờ bạn nhận riêng: đơn mới của khách mình phụ trách, khách tiềm năng mới được giao, và danh sách việc lúc 8h sáng.');
  await kvDel(x.db, 'tg_' + code);
  await crmLog(x, u, 'Nhân sự', '-', u.name, 'Kết nối Telegram', '');
  return { ok: true };
}
export async function telegramUser(x, name, text) { const y = (await crmUsers(x)).find(z => z.name === name && z.active); if (y && y.tg) await telegramTo(x.env, y.tg, text); }

/* ================================================================ đăng nhập */
export async function crmLogin(x, d) {
  const email = String(d.email || '').trim().toLowerCase();
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) return { ok: false, error: 'Email chưa đúng.' };
  const lu = await crmUser(x, email);
  if (!lu) return { ok: false, error: 'Email này chưa được cấp quyền vào CRM. Nhờ anh Sơn hoặc quản lý thêm email của bạn.' };
  const rk = 'rl_' + email, n = Number(await kvGet(x.db, rk) || 0);
  if (n >= 5) return { ok: false, error: 'Bạn đã xin mã quá nhiều lần. Vui lòng đợi 15 phút rồi thử lại.' };
  await kvSet(x.db, rk, String(n + 1), 900e3);
  const b = new Uint32Array(1); crypto.getRandomValues(b); const code = String(b[0] % 900000 + 100000);
  await kvSet(x.db, 'otp_' + email, JSON.stringify({ c: code, t: 0 }), 600e3);
  x.later(sendMail(x.env, { to: email, name: 'CRM Thực Dưỡng Lành', subject: code + ' là mã đăng nhập CRM Thực Dưỡng Lành',
    body: 'Mã đăng nhập của bạn: ' + code + '\n\nMã dùng được trong 10 phút. Không đưa mã này cho người khác.\nNếu bạn không yêu cầu đăng nhập, hãy bỏ qua email này.\n\n' + ROLE_URL(lu.role) }).catch(e => console.error('mail', e.message))); // địa chỉ đúng vai trò (quantri. / mkt. / kho. / ketoan. / crm.) // gửi nền: trả lời ngay, email tới sau vài giây
  return { ok: true };
}
export async function crmVerify(x, d) {
  const email = String(d.email || '').trim().toLowerCase(), code = String(d.code || '').replace(/\D/g, ''), key = 'otp_' + email;
  const raw = await kvGet(x.db, key); if (!raw) return { ok: false, error: 'Mã đã hết hạn. Bấm "Gửi lại mã".' };
  const o = JSON.parse(raw);
  if (o.c !== code) {
    o.t++;
    if (o.t >= 5) { await kvDel(x.db, key); return { ok: false, error: 'Nhập sai quá 5 lần. Bấm "Gửi lại mã" để lấy mã mới.' }; }
    await run(x.db, 'UPDATE kv SET v = ? WHERE k = ?', JSON.stringify(o), key);
    return { ok: false, error: 'Mã chưa đúng, bạn kiểm tra lại email nhé.' };
  }
  await kvDel(x.db, key);
  const u = await crmUser(x, email); if (!u) return { ok: false, error: 'Tài khoản đã bị khoá.' };
  await run(x.db, 'DELETE FROM sessions WHERE exp < ?', Date.now());
  const token = randHex(32);
  await run(x.db, 'INSERT INTO sessions (token, email, exp) VALUES (?, ?, ?)', token, email, Date.now() + SESSION_DAYS * DAY);
  return { ok: true, token, user: publicUser(u) };
}
/** Trang kiểm tra kỹ thuật (GET /api/status…) chỉ cho Quản trị: ?token=<phiên đăng nhập CRM>. */
export async function adminByToken(x, token) { const u = await crmSession(x, token); return u && u.level >= 3 ? u : null; }
async function crmSession(x, token) {
  if (!/^[a-f0-9]{64}$/.test(String(token || ''))) return null;
  const [sr, ur] = await x.db.batch([x.db.prepare('SELECT email, exp FROM sessions WHERE token = ?').bind(token), x.db.prepare(USERS_SQL)]); // 1 lượt hỏi thay vì 2
  const s = (sr.results || [])[0]; if (!s) return null;
  if (!x._users) usersFrom(x, ur.results || []);
  if (s.exp < Date.now()) { await run(x.db, 'DELETE FROM sessions WHERE token = ?', token); return null; }
  const u = await crmUser(x, s.email); if (!u) { await run(x.db, 'DELETE FROM sessions WHERE token = ?', token); return null; }
  return u;
}

/* ================================================================ đơn hàng */
/** Tên sản phẩm sale gõ khác nhau nhưng là 1 thứ ("Fu Progomax900g", "fucoidan PROgomax 900g"…) → cùng 1 khoá: bỏ dấu, hoa thường, khoảng trắng, tách số dính chữ, "Fu" = Fucoidan. */
function prodKey0(s) {
  return nrm(s).replace(/(\d)\s*(?:gr|gram|gam)\b/g, '$1g').replace(/([a-z])(\d)/g, '$1 $2').replace(/(\d)\s+(g|kg|ml|v|goi)\b/g, '$1$2').replace(/[^a-z0-9]+/g, ' ').trim().replace(/^fu\b/, 'fucoidan');
}
/** Tên gọi khác do anh Sơn xác nhận 19/10/2026: "promax", "Sữa hạt Fucoidan progomax" = Progomax (400g hộp nhỏ, 900g hộp to – tách theo cỡ); fucodan/fucudan = Ngũ cốc Fucoidan (loại cũ đã dừng, khác Progomax); ruốc chay không ghi cỡ / 165g = ruốc chay rong biển 165g. */
const PROD_ALIAS = [[/^(?:sua hat )?fucoidan promax\b/, 'fucoidan progomax'], [/^sua hat fucoidan progomax\b/, 'fucoidan progomax'], [/^(?:ngu coc )?fuc[ou]dan\b/, 'ngu coc fucoidan'], [/^ruoc chay(?: 165g)?$/, 'ruoc chay rong bien 165g']];
export function prodKey(s) { let k = prodKey0(s); PROD_ALIAS.forEach(a => { k = k.replace(a[0], a[1]); }); return k; }
/** Đổi tên sản phẩm trong đơn về tên chuẩn (bảng kv prod_canon do unifyProducts lập). */
export function canonItems(items, map) { (items || []).forEach(i => { const c = map && map[prodKey(i.name)]; if (c) i.name = c; }); return items; }
const ITEM_LINE = /^(🎁 ?)?(.*?)((?: \(.*\))? x\d+ = .*)$/;
const canonText = (text, map) => String(text || '').split('\n').map(l => { const m = l.match(ITEM_LINE), c = m && map[prodKey(m[2])]; return c ? (m[1] || '') + c + m[3] : l; }).join('\n');
/** Chọn tên chuẩn: không dính số vào chữ, viết hoa chữ đầu (không viết IN HOA cả chữ), rồi đến cách ghi nhiều đơn nhất. */
const prodScore = (n, c) => c + (/\p{L}\d/u.test(n) ? 0 : 1e7) + (n[0] === n[0].toUpperCase() && n[0] !== n[0].toLowerCase() && !/\p{Lu}{4,}/u.test(n) ? 1e6 : 0);
/** Gộp tên sản phẩm gõ khác nhau trong mọi đơn về 1 tên, để thống kê theo sản phẩm đúng. Đọc hết đơn → 6 tiếng 1 lần. */
export async function unifyProducts(x) {
  const rows = await all(x.db, "SELECT rid, items FROM orders WHERE items != ''"), by = {};
  rows.forEach(r => String(r.items).split('\n').forEach(l => { const m = l.match(ITEM_LINE); if (!m) return; const n = m[2].replace(/\s+/g, ' ').trim(), k = prodKey(n); if (k) (by[k] = by[k] || {})[n] = (by[k][n] || 0) + 1; }));
  const map = {}; Object.keys(by).forEach(k => { const g = by[k]; const sc = n => prodScore(n, g[n]) + (prodKey0(n) === k ? 1e8 : 0); const n = Object.keys(g).sort((a, b) => sc(b) - sc(a))[0]; map[k] = n[0].toUpperCase() + n.slice(1); }); // tên gọi khác (PROD_ALIAS) không được chọn làm tên chuẩn
  await kvSet(x.db, 'prod_canon', JSON.stringify(map));
  const chg = []; rows.forEach(r => { const t = canonText(r.items, map); if (t !== r.items) chg.push({ rid: r.rid, items: t }); });
  for (let i = 0; i < chg.length; i += 200) await run(x.db, "UPDATE orders SET items = json_extract(j.value, '$.items') FROM json_each(?) j WHERE orders.rid = json_extract(j.value, '$.rid')", JSON.stringify(chg.slice(i, i + 200)));
  if (chg.length) await kvSet(x.db, 'recalc_all', '1'); // sản phẩm hay mua của khách tính lại theo tên mới
  return chg.length;
}
export function itemsText(items) { return items.map(i => (i.gift ? '🎁 ' : '') + i.name + (i.variant ? ' (' + i.variant + ')' : '') + ' x' + i.qty + ' = ' + fmt(i.gift ? 0 : i.subtotal)).join('\n'); }
/** Câu "lên đơn" gửi vận chuyển: "4 Fucoidan Progomax 900g, 1 Bữa ăn dinh dưỡng (quà)". */
export function shipText(items) { return (items || []).map(i => (Number(i.qty) || 1) + ' ' + i.name + (i.variant ? ' ' + i.variant : '') + (i.gift ? ' (quà)' : '')).join(', '); }
function cleanItems(list) {
  return (list || []).filter(i => i && i.name && Number(i.qty) > 0).map(i => {
    const q = Math.round(Number(i.qty)), p = Math.round(Number(i.price) || 0);
    return { name: String(i.name).replace(/\s+x\d+\s*=.*$/, '').trim(), variant: String(i.variant || '').trim(), qty: q, price: p, subtotal: p * q };
  });
}
/** Sale linh động giá: nếu nhập "Tổng tiền thu khách" thì chia lại tiền cho các dòng theo tỉ lệ giá. Trả về tạm tính. */
function applyTotal(items, total, ship) {
  const sub = items.reduce((s, i) => s + i.subtotal, 0), want = Math.round(Number(total) || 0) - ship;
  if (total !== undefined && total !== null && String(total).trim() !== '' && Number(total) === 0) { items.forEach(i => { i.price = 0; i.subtotal = 0; }); return 0; } // đơn 0đ: gửi bù hàng / tặng quà (Thuỷ góp ý 05/11/2026)
  if (!(want > 0) || want === sub) return sub;
  let left = want;
  items.forEach((i, k) => { const v = k === items.length - 1 ? left : sub ? Math.round(i.subtotal * want / sub) : Math.round(want / items.length); i.subtotal = v; i.price = i.qty ? Math.round(v / i.qty) : v; left -= v; });
  return want;
}
const ORDER_COLS = ['id', 'time', 'name', 'phone', 'email', 'province', 'ward', 'address', 'items', 'subtotal', 'shipping', 'total', 'payment', 'note', 'status', 'source', 'first_source', 'consent', 'paid', 'carrier', 'tracking', 'seller', 'ca', 'line', 'ship'];
export { ORDER_COLS };

/** Ghi 1 đơn (web hoặc nhập tay), tính lại khách, báo email/Telegram. opt.by = tên nhân viên nhập tay. */
export async function saveOrder(x, data, opt) {
  const c = Object.assign({}, data.customer || {}), now = Date.now(), manual = !!opt.by, raw = normPhone(c.phone), phone = await mainPhone(x, raw);
  if (raw !== phone) c.note = (c.note ? c.note + ' · ' : '') + 'SĐT khách ghi: ' + raw; // số phụ của khách đã gộp → đơn vào hồ sơ số chính, giữ số khách ghi để giao hàng
  if (!manual && data.id && await first(x.db, 'SELECT rid FROM orders WHERE id = ?', String(data.id))) return { dup: true }; // web gửi lại khi mạng chập chờn
  canonItems(data.items, await kvJson(x.db, 'prod_canon', {}));
  const items = itemsText(data.items || []), pay = data.payment === 'bank' ? 'Chuyển khoản' : 'COD', realItems = (data.items || []).filter(i => !i.gift);
  if (!opt.otype) { try { opt.otype = (await otypeSuggest(x, phone, now)).t; } catch (e) { console.error('otype', e.message); } } // đơn web: loại đơn theo gợi ý (tính trước khi lưu)
  const ca = opt.ca || caOf(now, await caCfg(x)), line = opt.line || lineOf(realItems.map(i => i.name + ' ' + (i.variant || '')).join(' ')), ship = opt.shipText || shipText(data.items || []);
  const isNew = !manual && !(await first(x.db, "SELECT rid FROM orders WHERE phone = ? AND status NOT LIKE '%uỷ%' AND status NOT LIKE '%ủy%' AND status NOT LIKE '%oàn%' LIMIT 1", phone)); // khách mua lần đầu (để gắn CTV)
  let owner = await ownerOf(x, phone), assigned = '', refBy = '';
  if (!opt.by && data.ref) refBy = await refUser(x, String(data.ref).slice(0, 40)); // khách đặt qua link riêng của sale
  // 11/11/2026 (anh Sơn): khách hỏi (chưa mua) đang có người giữ → người đó đang chăm (cùng luật Kho chung: chưa quá hạn chưa liên hệ / không chăm, hoặc có hẹn) thì đơn tính cho người đó;
  // bỏ bê quá hạn mà khách đặt qua link của sale khác → tính cho người chốt được (sale gửi link), báo người giữ cũ
  let lk = null; if (!manual && !owner) { try { lk = await leadKeeper(x, phone); } catch (e) { console.error('leadKeeper', e.message); } }
  let lkNote = '';
  if (lk && lk.owner !== refBy) {
    if (lk.caring || !refBy) { owner = assigned = lk.owner; if (refBy) lkNote = '🔗 Đặt qua link của ' + refBy + ' nhưng là khách hỏi ' + lk.owner + ' đang chăm → tính cho ' + lk.owner; }
    else lkNote = '🔗 Khách hỏi của ' + lk.owner + ' (' + (lk.never ? 'chưa liên hệ lần nào' : lk.idle + ' ngày không chăm') + ') đặt qua link của ' + refBy + ' → tính cho ' + refBy;
  }
  if (lkNote) c.note = (c.note ? c.note + ' · ' : '') + lkNote;
  else if (refBy) c.note = (c.note ? c.note + ' · ' : '') + '🔗 Đặt qua link của ' + refBy + (owner && owner !== refBy ? ' (khách do ' + owner + ' phụ trách)' : '');
  let refSale = ''; // 🌱 khách mới (chưa có trong CRM) dùng mã / SĐT của khách cũ → thuộc về sale phụ trách khách cũ (partner.js refClaim)
  if (!manual && !owner && data.voucher) { try { const rv = await first(x.db, 'SELECT ref_phone FROM vouchers WHERE code = ?', String(data.voucher)); if (rv && rv.ref_phone) refSale = await refClaim(x, phone, rv.ref_phone, 'web', 'Website'); } catch (e) { console.error('refClaim', e.message); } }
  if (refSale) owner = assigned = refSale;
  if (opt.otype === 'Khách mới' && data.voucher && !manual) { try { const rv2 = await first(x.db, 'SELECT ref_phone FROM vouchers WHERE code = ?', String(data.voucher)); if (rv2 && rv2.ref_phone) opt.otype = 'Khách cũ'; } catch (e) { } } // đặt web bằng mã / SĐT người giới thiệu → hoa hồng như khách cũ
  if (!owner && !opt.by) owner = assigned = refBy || await autoOwner(x); // khách mới: giao cho sale gửi link, không thì theo chế độ "Tự chia đều"
  const seller = opt.by || owner;
  // 11/11/2026 (anh Sơn): khách sale đã chăm (có ghi nhật ký liên hệ trong 30 ngày trước khi đặt) tự lên web đặt, không bấm link → vẫn đủ % khách mới như đặt qua link (CRM payOf đọc dấu 🤝)
  if (!manual && seller && seller !== refBy) { try { const lg = await first(x.db, "SELECT time FROM logs WHERE ref IN (?, '''' || ?) AND by_name = ? AND what IN " + CONTACT_WHAT + ' AND time >= ? AND time < ? ORDER BY time DESC LIMIT 1', phone, phone, seller, now - CARED_DAYS * DAY, now);
    if (lg) c.note = (c.note ? c.note + ' · ' : '') + '🤝 ' + seller + ' đã chăm khách trước khi đặt (' + fmtDate(lg.time, 'dd/MM') + ')'; } catch (e) { console.error('cared', e.message); } }
  await insertMany(x.db, 'orders', ORDER_COLS, [{ id: String(data.id || ''), time: now, name: c.name || '', phone, email: c.email || '', province: c.province || '', ward: c.district || '', address: c.address || '', items,
    subtotal: Number(data.subtotal) || 0, shipping: Number(data.shipping) || 0, total: Number(data.total) || 0, payment: pay, note: c.note || '', status: opt.status || 'Mới', source: data.source || '', first_source: data.first_source || '',
    consent: data.marketing_consent ? 1 : 0, paid: '', carrier: '', tracking: '', seller: seller || '', ca, line, ship }]);
  if (opt.otype || opt.oflag) await run(x.db, 'UPDATE orders SET otype = ?, oflag = ? WHERE id = ? AND phone = ?', opt.otype || '', opt.oflag || '', String(data.id || ''), phone);
  if (data.voucher) await run(x.db, 'UPDATE orders SET voucher = ?, discount = ? WHERE id = ? AND phone = ?', String(data.voucher), Math.round(Number(data.discount) || 0), String(data.id || ''), phone);
  try { await comboCycles(x, data.items || []); } catch (e) { console.error('comboCycles', e.message); }
  await recalc(x, [phone], assigned ? { owners: { [phone]: assigned } } : {});
  let at = {}; // 🎁 khách cũ giới thiệu (mã giới thiệu) / 🤝 khách của CTV (link ?ref= hoặc mã của CTV)
  if (!manual) { try { at = await orderAttrib(x, { id: data.id, phone, ref: data.ref, refAt: data.ref_at, voucher: data.voucher, isNew }); } catch (e) { console.error('orderAttrib', e.message); } }
  const atNote = [at.refPhone ? '🎁 Được ' + (at.refName || at.refPhone) + ' giới thiệu' : '', at.partner ? '🤝 Khách của CTV ' + at.partner : '', at.ctvSkip || ''].filter(Boolean).join(' · ');
  if (atNote) await run(x.db, "UPDATE orders SET note = CASE WHEN coalesce(note, '') = '' THEN ? ELSE note || ' · ' || ? END WHERE id = ? AND phone = ?", atNote, atNote, String(data.id || ''), phone);
  const notify = async () => {
    const tg = await tgConf(x.env);
    if (!manual && tg.notify) await sendMail(x.env, { to: tg.notify, subject: '🛒 Đơn hàng mới ' + data.id + ' – ' + c.name + ' – ' + fmt(data.total),
      body: 'Mã đơn: ' + data.id + '\nKhách: ' + c.name + ' – ' + c.phone + (c.email ? ' – ' + c.email : '') + '\nĐịa chỉ: ' + c.address + ', ' + c.district + ', ' + c.province + '\n\n' + items +
        '\n\nTạm tính: ' + fmt(data.subtotal) + '\nPhí ship: ' + fmt(data.shipping) + '\nTổng: ' + fmt(data.total) + '\nThanh toán: ' + pay + (c.note ? '\nGhi chú: ' + c.note : '') + '\nNguồn: ' + (data.source || '') + '\n\nXem đơn: ' + CRM_URL + '/#don-hang' }).catch(() => {});
    let omsg = (manual ? '📝 <b>ĐƠN NHẬP TAY ' + esc(data.id) + '</b> – bởi ' + esc(opt.by) : '🛒 <b>ĐƠN HÀNG MỚI ' + esc(data.id) + '</b>') + '\n👤 ' + esc(c.name) + ' – <b>' + esc(c.phone) + '</b>' +
      '\n📍 ' + esc([c.address, c.district, c.province].filter(Boolean).join(', ')) + '\n\n' + esc(items) + '\n\n💰 <b>Tổng: ' + fmt(data.total) + '</b> (ship ' + fmt(data.shipping) + ') – ' + pay +
      (c.note ? '\n📝 ' + esc(c.note) : '') + (data.source ? '\n🔗 Nguồn: ' + esc(data.source) : '');
    if (atNote) omsg += '\n' + esc(atNote);
    await telegram(x.env, omsg + (manual ? '' : owner ? '\n👤 Phụ trách: ' + esc(owner) + (assigned ? (refSale ? ' (khách mới do khách cũ của ' + esc(refSale) + ' giới thiệu)' : lk && assigned === lk.owner ? ' (khách hỏi đang chăm)' : assigned === refBy ? ' (khách đặt qua link của ' + esc(refBy) + ')' : ' (vừa tự chia)') : '') : '\n⚠️ Khách chưa có người phụ trách – vào CRM để giao'));
    if (!manual && owner) await telegramUser(x, owner, omsg + (refSale ? '\n\n🌱 Khách mới do khách bạn phụ trách giới thiệu → khách thuộc về bạn, đơn giao thành công 7 ngày là bạn được thưởng.' : '') + '\n\n👉 Đơn của khách bạn phụ trách – gọi xác nhận: ' + CRM_URL + '/#don-hang');
    if (lk && lkNote && !lk.caring && refBy) await telegramUser(x, lk.owner, '⚠️ Khách hỏi ' + esc(c.name) + ' – ' + esc(c.phone) + ' bạn đang giữ (' + (lk.never ? 'chưa liên hệ lần nào' : lk.idle + ' ngày chưa chăm lại') + ') vừa đặt đơn ' + esc(data.id) + ' qua link của ' + esc(refBy) + ' → đơn tính cho ' + esc(refBy) + '. Khách hỏi nào cũng cần chăm đều, ghi 💬 Tư vấn sau mỗi lần gọi / nhắn.');
    if (at.refOwner && at.refOwner !== owner) await telegramUser(x, at.refOwner, '🎁 Khách ' + esc(at.refName || at.refPhone) + ' (bạn phụ trách) vừa giới thiệu ' + esc(c.name) + ' đặt đơn ' + esc(data.id) + ' – ' + fmt(data.total) + '. Giao xong nhớ tặng quà / voucher cảm ơn ở tab Hôm nay: ' + CRM_URL);
  };
  x.later(notify());
  return { ok: true };
}
/** Gói giải pháp trên web có số ngày dùng (items[].days) → tự thêm chu kỳ dùng nếu chưa có. */
async function comboCycles(x, items) {
  const add = (items || []).filter(i => Number(i.days) > 0 && i.name); if (!add.length) return;
  const cy = await cyclesList(x);
  for (const i of add) {
    const nm = String(i.name).toLowerCase();
    if (cy.some(r => nm.indexOf(String(r[0]).toLowerCase()) >= 0 && !r[1] && Number(r[2]) === Number(i.days))) continue;
    await run(x.db, "INSERT INTO cycles (name, variant, days, basis) VALUES (?, '', ?, 'Gói giải pháp – web tự thêm')", String(i.name), Number(i.days)); cy.push([String(i.name), '', Number(i.days), '']);
  }
}
async function orderFind(x, d) {
  let o = await first(x.db, 'SELECT * FROM orders WHERE rid = ? AND id = ?', Number(d.row) || 0, String(d.id));
  if (!o) o = await first(x.db, 'SELECT * FROM orders WHERE id = ? ORDER BY rid LIMIT 1', String(d.id));
  return o;
}
/** Nhân viên được xử lý đơn mình bán hoặc đơn của khách mình phụ trách. */
async function orderGuard(x, u, o) { if (u.level >= 2 || o.seller === u.name) return ''; return guardPhone(x, u, o.phone); }
async function crmOrderStatus(x, u, d, sys) { // sys: lệnh nội bộ đã tự kiểm quyền (kho nhận hàng hoàn)
  const o = await orderFind(x, d); if (!o) return { ok: false, error: 'Không tìm thấy đơn ' + d.id };
  const gErr = sys ? '' : await orderGuard(x, u, o); if (gErr) return { ok: false, error: gErr };
  const old = String(o.status || ''), set = {}; let status = d.status;
  if (d.seller !== undefined && u.level < 2) return { ok: false, error: 'Chỉ quản lý đổi được nhân viên bán.' };
  if (status && status !== old && ORDER_STATUS.indexOf(status) < 0) return { ok: false, error: 'Trạng thái không hợp lệ' };
  if (d.note !== undefined) set.note = String(d.note);
  if (d.paid !== undefined) { set.paid = d.paid ? 'Có – ' + u.name + ' ' + fmtDate(Date.now(), 'dd/MM HH:mm') : ''; await crmLog(x, u, 'Đơn hàng', d.id, o.name, d.paid ? 'Đã nhận tiền chuyển khoản' : 'Bỏ đánh dấu đã nhận tiền', ''); }
  if (d.seller !== undefined) { set.seller = String(d.seller); await crmLog(x, u, 'Đơn hàng', d.id, o.name, 'Nhân viên bán: ' + (o.seller || '–') + ' → ' + (d.seller || '–'), ''); }
  if (d.tracking !== undefined || d.carrier !== undefined) {
    if (d.carrier !== undefined) set.carrier = String(d.carrier);
    if (d.tracking !== undefined) set.tracking = String(d.tracking).trim();
    await crmLog(x, u, 'Đơn hàng', d.id, o.name, 'Vận đơn: ' + [d.carrier, d.tracking].filter(Boolean).join(' '), '');
    if (String(d.tracking || '').trim() && (old === 'Mới' || old === 'Đã xác nhận') && !status) status = 'Đang giao'; // có mã vận đơn = đã gửi hàng
  }
  if (d.otype !== undefined || d.otypeOk) { // quản lý kiểm tra loại đơn: giữ (✓ Đúng) hoặc đổi
    if (u.level < 2) return { ok: false, error: 'Chỉ quản lý xác nhận / đổi loại đơn.' };
    const ot0 = String(o.otype || ''), ot1 = OTYPES.indexOf(d.otype) >= 0 ? d.otype : ot0;
    set.otype = ot1; set.oflag = ''; if (ot1 !== ot0) set.ca = otypeCa(ot1);
    await crmLog(x, u, 'Loại đơn', d.id, o.name, ot1 !== ot0 ? ot0 + ' → ' + ot1 : 'Xác nhận ' + ot1, o.oflag || '');
  }
  if (status && status !== old) {
    set.status = status;
    if (status === 'Đang giao' && !o.ship_at && !set.ship_at) set.ship_at = Date.now();
    if (status === 'Đã giao' && !o.received_at && !set.received_at) set.received_at = Date.now();
    await crmLog(x, u, 'Đơn hàng', d.id, o.name, old + ' → ' + status, d.reason || '');
  }
  const ks = Object.keys(set);
  if (ks.length) await run(x.db, 'UPDATE orders SET ' + ks.map(k => k + ' = ?').join(', ') + ' WHERE rid = ?', ...ks.map(k => set[k]), o.rid);
  if (set.status) await recalc(x, [o.phone]); // huỷ / hoàn / khôi phục đơn → tính lại khách (và màu khách)
  if (set.status) await wbSafe(async () => { const ow = await ownerOf(x, o.phone), m = String(o.source || '').match(/^File .+? – (.+)$/);
    await wbStatusQueue(x, [o.seller, ow], { id: o.id, sheet: m ? m[1] : '', phone: o.phone, name: o.name, time: Number(o.time) || 0, total: Number(o.total) || 0, status: set.status }); });
  return { ok: true, row: o.rid, status: status || old };
}
/** 📦 Đối soát vận chuyển (01/11/2026): CRM đọc file Best / Viettel Post / xe ôm ngay trên máy, khớp đơn theo mã + SĐT, quản lý xem lại rồi gửi lên.
 *  d.items = [{ row, id, fee, carrier, tracking, status }]: ghi phí thật, hãng, mã vận đơn (nếu đơn chưa có); status (nếu có) đổi như bấm tay (ghi nhật ký, tính lại khách, ghi file sale). */
async function crmReconApply(x, u, d) {
  if (u.level < 2) return { ok: false, error: 'Chỉ Quản lý / Quản trị đối soát được.' };
  const items = (Array.isArray(d.items) ? d.items : []).slice(0, 3000), tag = String(d.src || 'Đối soát').slice(0, 40) + ' ' + fmtDate(Date.now(), 'dd/MM');
  let fee = 0, st = 0; const errs = [], ups = [];
  // 05/11/2026: đọc 1 lần cả lô + ghi gộp (trước: 2 lệnh / đơn, rất chậm); đổi trạng thái vẫn đi như bấm tay
  const byRid = {}; (await allIn(x.db, 'SELECT * FROM orders WHERE rid IN (SELECT value FROM json_each(?))', items.map(it => Number(it.row) || 0))).forEach(o => { byRid[o.rid] = o; });
  for (const it of items) {
    let o = byRid[Number(it.row) || 0]; if (o && String(o.id) !== String(it.id)) o = null;
    if (!o) o = await orderFind(x, it); if (!o) { errs.push(it.id); continue; }
    const set = { recon: tag };
    if (it.fee !== undefined && it.fee !== null && Number(it.fee) >= 0) { set.ship_fee = Math.round(Number(it.fee)); fee++; }
    if (it.carrier && !o.carrier) set.carrier = String(it.carrier).slice(0, 40);
    if (it.tracking && !o.tracking) set.tracking = String(it.tracking).trim().slice(0, 40);
    if (typeof it.trk === 'string') { set.trk = it.trk.slice(0, 300); set.trk_at = Number(it.trkAt) || Date.now(); set.trk_code = it.trk ? 900 : 0; } // 05/11/2026: file Best báo "kiện vấn đề" khi đơn còn đang giao
    const ks = Object.keys(set); ups.push(x.db.prepare('UPDATE orders SET ' + ks.map(k => k + ' = ?').join(', ') + ' WHERE rid = ?').bind(...ks.map(k => set[k]), o.rid));
    if (it.status && it.status !== o.status && ORDER_STATUS.indexOf(it.status) >= 0) {
      const r = await crmOrderStatus(x, u, { row: o.rid, id: o.id, status: it.status, reason: 'Đối soát ' + tag });
      if (r.ok) st++; else errs.push(it.id);
    }
  }
  for (let i = 0; i < ups.length; i += 100) await x.db.batch(ups.slice(i, i + 100));
  await crmLog(x, u, 'Đối soát', '-', '', tag + ': ' + items.length + ' đơn, ghi phí ' + fee + ', đổi trạng thái ' + st, errs.length ? 'Lỗi: ' + errs.slice(0, 20).join(', ') : '');
  return { ok: true, fee, status: st, errors: errs };
}
async function crmOrderEdit(x, u, d) {
  const o = await orderFind(x, d); if (!o) return { ok: false, error: 'Không tìm thấy đơn ' + d.id };
  const c = d.customer || {}, phone = normPhone(c.phone); let items = cleanItems(d.items);
  if (!/^0\d{9,10}$/.test(phone)) return { ok: false, error: 'Số điện thoại chưa đúng.' };
  if (!String(c.name || '').trim()) return { ok: false, error: 'Thiếu tên khách.' };
  if (!items.length) return { ok: false, error: 'Đơn phải có ít nhất 1 sản phẩm.' };
  const gErr = (await orderGuard(x, u, o)) || (o.phone !== phone ? await guardPhone(x, u, phone) : ''); if (gErr) return { ok: false, error: gErr };
  const ship = Math.max(0, Math.round(Number(d.shipping) || 0)), sub = applyTotal(items, d.total, ship);
  items = items.concat(cleanItems(d.gifts).map(g => Object.assign(g, { gift: true, price: 0, subtotal: 0 })));
  canonItems(items, await kvJson(x.db, 'prod_canon', {}));
  const set = { name: String(c.name).trim(), phone, province: c.province || '', ward: c.ward || '', address: c.address || '', items: itemsText(items), subtotal: sub, shipping: ship, total: sub + ship, payment: d.payment === 'bank' ? 'Chuyển khoản' : 'COD',
    ship: shipText(items), line: lineOf(items.filter(i => !i.gift).map(i => i.name + ' ' + i.variant).join(' ')) };
  if (c.addrOld !== undefined) set.addr_old = String(c.addrOld || '').slice(0, 300);
  if (d.carrier) set.carrier = String(d.carrier).slice(0, 40);
  if (OTYPES.indexOf(d.otype) >= 0 && d.otype !== o.otype) { // đổi loại đơn: quản lý → xong; nhân viên khác gợi ý → chờ quản lý kiểm tra
    set.otype = d.otype; set.ca = otypeCa(d.otype); set.oflag = u.level >= 2 ? '' : otypeFlag(d.otype, await otypeSuggest(x, phone, Number(o.time) || Date.now()));
  }
  const ks = Object.keys(set);
  await run(x.db, 'UPDATE orders SET ' + ks.map(k => k + ' = ?').join(', ') + ' WHERE rid = ?', ...ks.map(k => set[k]), o.rid);
  await crmLog(x, u, 'Sửa đơn', d.id, c.name, fmt(o.total) + ' → ' + fmt(sub + ship), d.reason || '');
  await recalc(x, [o.phone, phone]);
  await wbSafe(async () => { // 30/10/2026 anh Sơn: sửa đơn trên CRM → ghi ngược vào dòng đơn trong file sale (sửa ở đâu cũng được)
    const ow = await ownerOf(x, phone), m = String(o.source || '').match(/^File .+? – (.+)$/), real0 = items.filter(i => !i.gift), gift0 = items.filter(i => i.gift)[0];
    await wbEditQueue(x, [o.seller, ow], { id: o.id, sheet: m ? m[1] : '', time: Number(o.time) || 0, prev: { phone: o.phone, total: Number(o.total) || 0 }, name: set.name, phone, address: [set.address, set.ward, set.province].filter(Boolean).join(', '),
      product: real0.map(i => i.name + (i.variant ? ' ' + i.variant : '') + (real0.length > 1 ? ' x' + i.qty : '')).join(', '), qty: real0.length === 1 ? real0[0].qty : '', gift: gift0 ? gift0.name : '', giftQty: gift0 ? gift0.qty : '', total: sub + ship, ship: set.ship });
  });
  if (set.addr_old) await run(x.db, 'UPDATE customers SET addr_old = ? WHERE phone = ?', set.addr_old, phone);
  return { ok: true, row: o.rid };
}
/* ---------- Quản trị xoá dữ liệu nhập thử / nhập nhầm (không hoàn tác được) */
const DEL_KEY = 'del_log', DEL_IDS = 'del_order_ids';
/** Ghi lại dòng đã xoá 3 ngày → CRM đang mở ở máy khác tự bỏ khi làm mới phần thay đổi. */
export async function delMark(x, orders, phones, leads) {
  const now = Date.now(), list = ((await kvJson(x.db, DEL_KEY, [])) || []).filter(e => now - e.t < 3 * DAY);
  orders.forEach(r => list.push({ t: now, o: r.rid })); phones.forEach(p => list.push({ t: now, c: p })); (leads || []).forEach(l => list.push({ t: now, l: l.id }));
  await kvSet(x.db, DEL_KEY, JSON.stringify(list.slice(-3000)));
  const fileIds = orders.filter(r => String(r.source || '').indexOf('File ') === 0).map(r => r.id); // đơn nhập từ file sale: nhớ mã để lần đồng bộ sau không nhập lại
  if (fileIds.length) { const ids = (await kvJson(x.db, DEL_IDS, [])) || []; fileIds.forEach(i => { if (ids.indexOf(i) < 0) ids.push(i); }); await kvSet(x.db, DEL_IDS, JSON.stringify(ids.slice(-5000))); }
}
export async function deletedOrderIds(x) { return (await kvJson(x.db, DEL_IDS, [])) || []; }
async function delSince(x, since) { return ((await kvJson(x.db, DEL_KEY, [])) || []).filter(e => e.t >= since); }
async function crmOrderDelete(x, u, d) {
  if (u.level < 3) return { ok: false, error: 'Chỉ Quản trị xoá được đơn hàng.' };
  const o = await first(x.db, 'SELECT * FROM orders WHERE rid = ? AND id = ?', Number(d.row) || 0, String(d.id || ''));
  if (!o) return { ok: false, error: 'Không tìm thấy đơn ' + (d.id || '') + ' (có thể đã bị xoá).' };
  await wbSafe(async () => { const ow = await ownerOf(x, o.phone), m = String(o.source || '').match(/^File .+? – (.+)$/); // ghi "Huỷ" vào dòng đơn trong file sale
    await wbDeleteQueue(x, [o.seller, ow], { id: o.id, sheet: m ? m[1] : '', phone: o.phone, name: o.name, time: Number(o.time) || 0, total: Number(o.total) || 0 }); });
  await run(x.db, 'DELETE FROM orders WHERE rid = ?', o.rid);
  if (!await first(x.db, 'SELECT rid FROM orders WHERE id = ?', o.id)) await run(x.db, 'DELETE FROM logs WHERE ref = ?', o.id); // còn đơn trùng mã thì giữ nhật ký
  await recalc(x, [o.phone]);
  await delMark(x, [o], []);
  await crmLog(x, u, 'Xoá dữ liệu', '', o.name, 'Xoá đơn ' + o.id, fmt(o.total) + ' · ' + o.phone);
  return { ok: true };
}
/** Xoá khách: hồ sơ khách + mọi đơn, khách hỏi, nhật ký của số điện thoại này. */
async function crmCustomerDelete(x, u, d) {
  if (u.level < 3) return { ok: false, error: 'Chỉ Quản trị xoá được khách hàng.' };
  const phone = normPhone(d.phone); if (!phone) return { ok: false, error: 'Thiếu số điện thoại.' };
  const c = await first(x.db, 'SELECT name FROM customers WHERE phone = ?', phone);
  const os = await all(x.db, 'SELECT rid, id, source, total FROM orders WHERE phone = ?', phone);
  const ls = await all(x.db, 'SELECT id FROM leads WHERE phone = ?', phone);
  if (!c && !os.length && !ls.length) return { ok: false, error: 'Không tìm thấy khách ' + phone + ' (có thể đã bị xoá).' };
  const ids = [...new Set(os.map(o => o.id))], refs = [phone].concat(ids, ls.map(l => l.id));
  await x.db.batch([
    x.db.prepare('DELETE FROM orders WHERE phone = ?').bind(phone),
    x.db.prepare('DELETE FROM leads WHERE phone = ?').bind(phone),
    x.db.prepare('DELETE FROM customers WHERE phone = ?').bind(phone),
    x.db.prepare('DELETE FROM sale_phones WHERE phone = ?').bind(phone),
    x.db.prepare('DELETE FROM dup_done WHERE phone = ?').bind(phone)
  ]);
  for (let i = 0; i < refs.length; i += 500) await run(x.db, 'DELETE FROM logs WHERE ref IN (SELECT value FROM json_each(?))', JSON.stringify(refs.slice(i, i + 500)));
  await delMark(x, os, [phone], ls);
  await crmLog(x, u, 'Xoá dữ liệu', '', (c && c.name) || '', 'Xoá khách ' + phone, os.length + ' đơn (' + fmt(os.reduce((s0, o) => s0 + (Number(o.total) || 0), 0)) + ')' + (ls.length ? ' · ' + ls.length + ' khách hỏi' : ''));
  return { ok: true, orders: os.length, leads: ls.length };
}

/** Xoá 1 khách hỏi nhập thử (04/11/2026): chỉ dòng khách hỏi + nhật ký tư vấn của nó; khách đã mua / đơn hàng giữ nguyên. */
async function crmLeadDelete(x, u, d) {
  if (u.level < 3) return { ok: false, error: 'Chỉ Quản trị xoá được khách hỏi.' };
  const l = await first(x.db, 'SELECT id, name, phone FROM leads WHERE id = ?', String(d.id || ''));
  if (!l) return { ok: false, error: 'Không tìm thấy khách hỏi (có thể đã bị xoá).' };
  await run(x.db, 'DELETE FROM leads WHERE id = ?', l.id);
  const left = await first(x.db, 'SELECT (SELECT COUNT(*) FROM leads WHERE phone = ?) + (SELECT COUNT(*) FROM orders WHERE phone = ?) + (SELECT COUNT(*) FROM customers WHERE phone = ?) AS n', l.phone, l.phone, l.phone);
  const refs = [l.id].concat(l.phone && !(left && left.n) ? [l.phone] : []); // số không còn gì khác → xoá luôn nhật ký theo số
  await run(x.db, 'DELETE FROM logs WHERE ref IN (SELECT value FROM json_each(?))', JSON.stringify(refs));
  await delMark(x, [], [], [l]);
  await crmLog(x, u, 'Xoá dữ liệu', '', l.name || '', 'Xoá khách hỏi ' + (l.phone || ''), '');
  return { ok: true };
}

/* ---------- gộp khách dùng nhiều số điện thoại (14/10/2026: chị Trịnh Thị Thu có 3 số → 3 hồ sơ, đơn và tổng chi bị chia nhỏ) */
const ALIAS_KEY = 'ph_alias', MSKIP_KEY = 'merge_skip';
/** {số phụ: số chính}. File sale, đơn web, đơn nhập tay, khách hỏi có số phụ → tính vào số chính, không tách lại. */
export async function phoneAlias(x) {
  if (!x._pal) { const m = (await kvJson(x.db, ALIAS_KEY, {})) || {}; x._pal = {}; Object.keys(m).forEach(k => { x._pal[k] = m[k].m; }); }
  return x._pal;
}
export async function mainPhone(x, p) { p = normPhone(p); return (await phoneAlias(x))[p] || p; }
async function crmMerge(x, u, d) {
  const main = normPhone(d.main), others = [...new Set((d.phones || []).map(normPhone))].filter(p => p && p !== main);
  if (!/^0\d{9,10}$/.test(main) || !others.length) return { ok: false, error: 'Chọn số chính và ít nhất 1 số cần gộp.' };
  if (others.length > 10) return { ok: false, error: 'Mỗi lần gộp tối đa 10 số.' };
  const cs = await allIn(x.db, 'SELECT * FROM customers WHERE phone IN (SELECT value FROM json_each(?))', [main].concat(others));
  const M = cs.find(c => c.phone === main); if (!M) return { ok: false, error: 'Không tìm thấy khách ' + main + ' (có thể đã được gộp).' };
  const O = others.map(p => cs.find(c => c.phone === p)), miss = others.filter((p, i) => !O[i]);
  if (miss.length) return { ok: false, error: 'Không tìm thấy khách ' + miss.join(', ') + ' (có thể đã được gộp).' };
  if (u.level < 2) { // sale (15/10/2026): chỉ gộp khách mình phụ trách (hoặc chưa ai nhận) – không đụng khách của người khác
    const other = [M].concat(O).find(c => c.owner && c.owner !== u.name);
    if (other) return { ok: false, error: 'Số ' + other.phone + ' do ' + other.owner + ' phụ trách. Nhờ quản lý gộp, hoặc nhờ quản lý chuyển khách về bạn trước.' };
  }
  // ghi chú: số phụ thành dòng "SĐT khác" (hiện 📱 trong hồ sơ, tìm được theo số), ghi chú của số phụ nối xuống dưới
  let note = String(M.note || '');
  const head = others.filter(p => !new RegExp('^\\s*SĐT khác:\\s*' + p, 'm').test(note)).map(p => 'SĐT khác: ' + p);
  note = head.concat(note ? [note] : []).join('\n');
  O.forEach(c => {
    const n = String(c.note || '').split('\n').filter(l => !(/^\s*SĐT khác:/.test(l) && [main].concat(others).some(p => l.indexOf(p) >= 0))).join('\n').trim();
    if (n) note += '\n— Gộp từ số ' + c.phone + ' —\n' + n;
  });
  const A = [M].concat(O), lastCare = A.filter(c => c.care_at).sort((a, b) => b.care_at - a.care_at)[0], today = startOfDay(Date.now());
  const cbs = A.map(c => c.callback).filter(Boolean), cb = cbs.filter(t => t >= today).sort((a, b) => a - b)[0] || (cbs.length ? Math.max(...cbs) : null);
  const pick = k => { const v = A.map(c => c[k]).find(v => v !== '' && v != null); return v == null ? '' : v; };
  const rids = (await allIn(x.db, 'SELECT rid FROM orders WHERE phone IN (SELECT value FROM json_each(?))', others)).map(r => r.rid);
  const js = JSON.stringify(others), p = (sql, ...a) => x.db.prepare(sql).bind(...a);
  await x.db.batch([
    p('UPDATE orders SET phone = ? WHERE phone IN (SELECT value FROM json_each(?))', main, js),
    p('UPDATE leads SET phone = ? WHERE phone IN (SELECT value FROM json_each(?))', main, js),
    p('UPDATE logs SET ref = ? WHERE ref IN (SELECT value FROM json_each(?))', main, js),
    p('UPDATE OR IGNORE sale_phones SET phone = ? WHERE phone IN (SELECT value FROM json_each(?))', main, js),
    p('DELETE FROM sale_phones WHERE phone IN (SELECT value FROM json_each(?))', js),
    p('DELETE FROM dup_done WHERE phone IN (SELECT value FROM json_each(?))', js),
    p('DELETE FROM customers WHERE phone IN (SELECT value FROM json_each(?))', js),
    p('UPDATE customers SET note = ?, care_at = ?, care_result = ?, callback = ?, owner = ?, flag = ?, tag = ?, zalo = ?, community = ?, dob = ?, consent = ? WHERE phone = ?',
      note.slice(0, 45000), lastCare ? lastCare.care_at : null, lastCare ? lastCare.care_result || '' : '', cb, pick('owner'), pick('flag'), pick('tag'),
      A.some(c => c.zalo) ? 1 : 0, pick('community'), pick('dob'), A.some(c => c.consent) ? 1 : 0, main)
  ]);
  const al = (await kvJson(x.db, ALIAS_KEY, {})) || {}, now = Date.now();
  Object.keys(al).forEach(k => { if (others.indexOf(al[k].m) >= 0) al[k].m = main; }); // số đã gộp vào 1 số phụ trước đây → trỏ về số chính mới
  others.forEach(ph => { al[ph] = { m: main, by: u.name, at: now, o: rids.length <= 200 ? rids : [] }; }); // o: đơn đã chuyển (để tách lại bằng tay nếu gộp nhầm)
  delete al[main];
  await kvSet(x.db, ALIAS_KEY, JSON.stringify(al)); x._pal = null;
  await recalc(x, [main]);
  await delMark(x, [], others, []); // CRM đang mở ở máy khác bỏ hồ sơ số phụ
  await crmLog(x, u, 'Gộp khách', main, M.name, 'Gộp ' + others.join(', ') + ' vào ' + main, rids.length + ' đơn chuyển sang số chính');
  if (u.level < 2) x.later(telegram(x.env, '🔗 <b>' + esc(u.name) + ' gộp khách</b> ' + esc(M.name) + ': ' + others.join(', ') + ' → ' + main + ' (' + rids.length + ' đơn chuyển sang số chính)')); // báo nhóm để quản lý biết, gộp nhầm thì tách
  return { ok: true, main, moved: rids.length };
}
/** Tên để so khách trùng: bỏ dấu, bỏ "(x)" và số điện thoại sale ghi kèm trong tên. */
function mergeName(n) { return nrm(n).replace(/\(\s*[x×]\s*\)/g, ' ').replace(/0\d{9,10}/g, ' ').replace(/[^a-z0-9 ]/g, ' ').replace(/\s+/g, ' ').trim(); }
/** Gợi ý khách nghi là 1 người: cùng tên + cùng địa chỉ, hoặc sale ghi số kia trong tên / dòng "SĐT khác". */
async function crmMergeSuggest(x, u) {
  const cs = await all(x.db, "SELECT phone, name, address, orders, spent, first, last, owner, products, substr(note, 1, 3000) AS note FROM customers WHERE orders > 0 OR coalesce(flag, '') != ''");
  const by = {}, par = {}, why = {}; cs.forEach(c => { by[c.phone] = c; });
  const f = q => par[q] && par[q] !== q ? (par[q] = f(par[q])) : q;
  const join = (a, b, w) => { const ra = f(a), rb = f(b); if (ra !== rb) par[rb] = ra; (why[a] = why[a] || {})[w] = 1; (why[b] = why[b] || {})[w] = 1; };
  const seen = {};
  cs.forEach(c => {
    const a = nrm(c.address).replace(/[^a-z0-9]/g, ''), n = mergeName(c.name); if (a.length < 12 || !n) return;
    const k = n + '|' + a; if (seen[k]) join(seen[k], c.phone, 'Cùng tên, cùng địa chỉ'); else seen[k] = c.phone;
  });
  cs.forEach(c => {
    (c.name.match(/0\d{9,10}/g) || []).forEach(q => { if (q !== c.phone && by[q]) join(c.phone, q, 'Sale ghi số kia trong tên'); });
    String(c.note || '').split('\n').filter(l => /^\s*SĐT khác:/.test(l)).forEach(l => (l.match(/0\d{9,10}/g) || []).forEach(q => { if (q !== c.phone && by[q]) join(c.phone, q, 'Ghi chú có “SĐT khác” là số kia'); }));
  });
  const skip = (await kvJson(x.db, MSKIP_KEY, [])) || [], G = {};
  Object.keys(why).forEach(ph => { (G[f(ph)] = G[f(ph)] || []).push(ph); });
  const groups = Object.values(G).filter(g => g.length > 1).map(g => {
    const items = g.map(ph => { const c = by[ph]; return { phone: ph, name: c.name, address: c.address, orders: c.orders, spent: c.spent, first: c.first, last: c.last, owner: c.owner || '', products: c.products || '' }; })
      .sort((a, b) => b.orders - a.orders || b.spent - a.spent);
    return { key: g.slice().sort().join('|'), items, why: [...new Set(g.flatMap(ph => Object.keys(why[ph])))], spent: items.reduce((s, i) => s + (Number(i.spent) || 0), 0) };
  }).filter(g => skip.indexOf(g.key) < 0 && (u.level >= 2 || (g.items.some(i => i.owner === u.name) && g.items.every(i => !i.owner || i.owner === u.name)))) // sale: chỉ nhóm toàn khách của mình
    .sort((a, b) => b.spent - a.spent);
  return { ok: true, groups: groups.slice(0, 300), total: groups.length, skipped: skip.length };
}
/** "Không phải 1 người": ẩn nhóm gợi ý này. */
async function crmMergeSkip(x, u, d) {
  const k = String(d.key || ''); if (!k) return { ok: false, error: 'Thiếu nhóm.' };
  const skip = (await kvJson(x.db, MSKIP_KEY, [])) || []; if (skip.indexOf(k) < 0) skip.push(k);
  await kvSet(x.db, MSKIP_KEY, JSON.stringify(skip.slice(-2000)));
  await crmLog(x, u, 'Gộp khách', '-', '', 'Không phải 1 người', k.split('|').join(', '));
  return { ok: true };
}
/** Mã đơn theo sale (anh Sơn 20/10/2026): <V nếu gửi Viettel Post><tiền tố><ddMMyy>-<số thứ tự 2 chữ số trong ngày>,
 *  ví dụ Phuong201026-01, VPhuong201026-02 (gạch cho dễ nhìn; sync.js CODE_RE đọc 6 số ddMMyy). Mã không gạch Phuong20102601 (sáng 20/10/2026) vẫn được đếm. Số thứ tự đếm chung đơn có / không có chữ V của sale trong ngày (36 tiếng gần nhất để năm sau không đếm nhầm). */
async function nextCode(x, u, now, vtp) {
  const y = (await crmUsers(x)).find(z => z.email === u.email) || u, base = (y.prefix || slugName(u.name)) + fmtDate(now, 'ddMMyy');
  let n = 0; for (const r of await all(x.db, 'SELECT id FROM orders WHERE (substr(id, 1, ?) = ? OR substr(id, 1, ?) = ?) AND time > ?', base.length, base, base.length + 1, 'V' + base, now - 36 * 3600e3)) {
    const t = r.id.charAt(0) === 'V' && r.id.indexOf('V' + base) === 0 ? r.id.slice(base.length + 1) : r.id.slice(base.length), k = t.match(/^-?(\d{2})(?![\d-])/); if (k) n = Math.max(n, +k[1]); // bỏ mã trùng có đuôi SĐT (Phuong051004-5179)
  }
  return (vtp ? 'V' : '') + base + '-' + (n + 1 < 10 ? '0' : '') + (n + 1);
}
async function crmOrderCreate(x, u, d) {
  const c = d.customer || {}, raw = normPhone(c.phone), phone = await mainPhone(x, raw);
  if (!/^0\d{9,10}$/.test(phone)) return { ok: false, error: 'Số điện thoại chưa đúng.' };
  if (u.level < 2) { const ow = await ownerOf(x, phone); if (ow && ow !== u.name) return { ok: false, error: 'Khách này do ' + ow + ' phụ trách. Nhờ ' + ow + ' lên đơn, hoặc nhờ quản lý chuyển khách.' }; }
  let ld = null;
  if (d.leadId) { ld = await leadGet(x, d.leadId); if (ld) { const lErr = await guardLead(x, u, ld); if (lErr) return { ok: false, error: lErr }; } }
  if (!String(c.name || '').trim()) return { ok: false, error: 'Thiếu tên khách.' };
  let items = cleanItems(d.items); if (!items.length) return { ok: false, error: 'Chưa chọn sản phẩm.' };
  const ship = Math.max(0, Math.round(Number(d.shipping) || 0)), sub = applyTotal(items, d.total, ship);
  items = items.concat(cleanItems(d.gifts).map(g => Object.assign(g, { gift: true, price: 0, subtotal: 0 })));
  const now = Date.now();
  if (!d.force) { // bấm Lưu 2 lần (lần đầu mạng chập chờn, đơn đã lưu nhưng máy không nhận được trả lời) → không tạo đơn trùng
    const dup = await first(x.db, "SELECT id, time FROM orders WHERE phone = ? AND total = ? AND time > ? AND status NOT IN ('Huỷ', 'Hoàn', 'Đang chuyển hoàn') ORDER BY time DESC LIMIT 1", phone, sub + ship, now - 60 * 60e3);
    if (dup) return { ok: false, dupOf: dup.id, error: 'Khách này vừa có đơn ' + dup.id + ' cùng số tiền ' + fmt(sub + ship) + ' lúc ' + fmtDate(Number(dup.time), 'HH:mm') + '. Có thể lần trước đã lưu rồi.' };
  }
  const vtp = /viettel/i.test(String(d.carrier || '')), want = String(d.code || '').trim().replace(/\s+/g, ' ');
  let id = '';
  if (want) { // mã sale gõ / CRM tự điền: trùng đơn khác → mã tự điền thì lấy số kế tiếp, mã tự gõ thì báo sale sửa
    if (!/^[\p{L}\d][\p{L}\d.\-_ ]{2,29}$/u.test(want)) return { ok: false, error: 'Mã đơn chưa đúng (3–30 ký tự: chữ, số, dấu chấm, gạch).' };
    if (!(await first(x.db, 'SELECT rid FROM orders WHERE id = ?', want))) id = want;
    else if (!d.codeAuto) return { ok: false, error: 'Mã đơn ' + want + ' đã có rồi. Sửa mã khác rồi lưu lại.' };
  }
  if (!id) id = await nextCode(x, u, now, vtp);
  const sug = await otypeSuggest(x, phone, now); // gợi ý tính TRƯỚC khi lưu (lưu xong khách đã thành "đã mua")
  const otype = OTYPES.indexOf(d.otype) >= 0 ? d.otype : sug.t, oflag = u.level >= 2 ? '' : otypeFlag(otype, sug);
  const src = ld && ld.channel ? 'Tiềm năng – ' + ld.channel : 'Nhập tay – ' + (d.source || 'Khác');
  await saveOrder(x, { id, customer: { name: String(c.name).trim(), phone: raw, email: c.email || '', province: c.province || '', district: c.ward || '', address: c.address || '', note: c.note || '' },
    items, subtotal: sub, shipping: ship, total: sub + ship, payment: d.payment === 'bank' ? 'bank' : 'cod', source: src, first_source: src, marketing_consent: !!d.consent },
    { by: u.name, status: ORDER_STATUS.indexOf(d.status) >= 0 ? d.status : 'Đã xác nhận', ca: otypeCa(otype), otype, oflag });
  await run(x.db, "UPDATE customers SET owner = ? WHERE phone = ? AND (owner = '' OR owner IS NULL)", u.name, phone);
  const ao = String(c.addrOld || '').trim().slice(0, 300); // địa chỉ cũ (Misa) – lưu vào đơn + hồ sơ khách để lần sau tự điền
  if (d.carrier) await run(x.db, 'UPDATE orders SET carrier = ? WHERE id = ? AND phone = ?', String(d.carrier).slice(0, 40), id, phone); // đơn vị vận chuyển chọn lúc lên đơn
  if (ao) { await run(x.db, 'UPDATE orders SET addr_old = ? WHERE id = ? AND phone = ?', ao, id, phone); await run(x.db, 'UPDATE customers SET addr_old = ? WHERE phone = ?', ao, phone); }
  await crmLog(x, u, 'Tạo đơn', id, c.name, fmt(sub + ship), src);
  await wbSafe(async () => { // ghi ngược vào sheet lên đơn của sale
    const cv = await first(x.db, 'SELECT owner, orders FROM customers WHERE phone = ?', phone), real0 = items.filter(i => !i.gift), gift0 = items.filter(i => i.gift)[0];
    await wbOrderQueue(x, (cv && cv.owner) || u.name, { id, time: now, name: String(c.name).trim(), phone: raw, address: [c.address, c.ward, c.province].filter(Boolean).join(', '),
      product: real0.map(i => i.name + (i.variant ? ' ' + i.variant : '') + (real0.length > 1 ? ' x' + i.qty : '')).join(', '), qty: real0.length === 1 ? real0[0].qty : '', gift: gift0 ? gift0.name : '', giftQty: gift0 ? gift0.qty : '',
      total: sub + ship, status: ORDER_STATUS.indexOf(d.status) >= 0 ? d.status : 'Đã xác nhận', ship: shipText(items), note: c.note || '', ca: otypeCa(otype), otype, old: !!cv && Number(cv.orders) > 1 });
  });
  if (d.leadId) await leadUpdate(x, d.leadId, { status: 'Đã chốt', order_id: id, last_at: now, callback: null });
  // 🎁 khách hỏi do khách khác giới thiệu → đơn đầu tiên ghi người giới thiệu: tab Hôm nay nhắc "Cảm ơn khách giới thiệu" (api/src/partner.js)
  const rl = ld && ld.ref_phone ? ld : await first(x.db, "SELECT ref_phone FROM leads WHERE phone = ? AND coalesce(ref_phone, '') != '' ORDER BY rid DESC LIMIT 1", phone);
  if (rl && rl.ref_phone) { try { await run(x.db, "UPDATE orders SET ref_phone = ? WHERE id = ? AND coalesce(ref_phone, '') = '' AND NOT EXISTS (SELECT 1 FROM orders o2 WHERE o2.phone = ? AND coalesce(o2.ref_phone, '') != '')", rl.ref_phone, id, phone); } catch (e) { } }
  return { ok: true, id, otype, oflag };
}

/* ================================================================ khách: chăm sóc, sửa thông tin */
async function crmCare(x, u, d) {
  const gErr = await guardPhone(x, u, d.phone); if (gErr) return { ok: false, error: gErr };
  const phone = normPhone(d.phone), c = await first(x.db, 'SELECT name, owner FROM customers WHERE phone = ?', phone);
  if (!c) return { ok: false, error: 'Không tìm thấy khách ' + phone };
  const now = Date.now(), cb = dateOrBlank(d.callback), owner = c.owner || u.name;
  await run(x.db, 'UPDATE customers SET care_at = ?, care_result = ?, callback = ?, owner = ? WHERE phone = ?', now, String(d.result || ''), cb, owner, phone);
  const note = String(d.note || '').trim();
  if (d.received) {
    const lastOrd = (await all(x.db, 'SELECT rid, id, time, status, received_at FROM orders WHERE phone = ? ORDER BY time DESC LIMIT 20', phone)).find(r => !isVoid(r.status));
    if (lastOrd) {
      const open = /^(Mới|Đã xác nhận|Đang giao)$/.test(lastOrd.status);
      if (!lastOrd.received_at && (open || now - Number(lastOrd.time) <= 20 * DAY)) {
        await run(x.db, "UPDATE orders SET received_at = ?, status = CASE WHEN status IN ('Mới', 'Đã xác nhận', 'Đang giao') THEN 'Đã giao' ELSE status END WHERE rid = ?", now, lastOrd.rid);
        await recalc(x, [phone]);
      }
    }
  }
  await wbSafe(() => wbQueue(x, owner, phone, c.name, (note || WB_SHORT[d.result] || d.result) + cbTxt(d.callback)));
  await crmLog(x, u, TASK_LABEL[d.task] || TASK_LABEL.other, phone, c.name, d.result, note + (d.callback ? (note ? ' – ' : '') + 'hẹn gọi lại ' + String(d.callback).split('-').reverse().join('/') : ''));
  return { ok: true, careAt: now, owner, callback: cb };
}
/** 📵 Ngừng liên hệ (anh Sơn 31/10/2026): khách đã mất / bỏ số → không hiện ở chăm sóc nữa.
 *  mode set: sale bấm (đã xác nhận trên màn hình) → báo Telegram riêng cho Quản lý / Quản trị; ok: quản lý xác nhận đúng; undo: trả khách về chăm sóc (quản lý, hoặc chính người bấm khi quản lý chưa xác nhận). */
const STOP_REASONS = ['Khách đã mất', 'Bỏ số / số không còn dùng'];
async function crmStop(x, u, d) {
  const phone = normPhone(d.phone), mode = d.mode || 'set';
  const c = await first(x.db, 'SELECT name, owner, orders, spent, last, stop, stop_by, stop_at, stop_ok FROM customers WHERE phone = ?', phone);
  if (!c) return { ok: false, error: 'Không tìm thấy khách ' + phone };
  const note = String(d.note || '').trim().slice(0, 300), now = Date.now();
  if (mode === 'set') {
    const gErr = await guardPhone(x, u, phone); if (gErr) return { ok: false, error: gErr };
    const reason = STOP_REASONS.indexOf(d.reason) >= 0 ? d.reason : note ? 'Khác: ' + note : '';
    if (!reason) return { ok: false, error: 'Chọn lý do ngừng liên hệ.' };
    const ok = u.level >= 2 ? 1 : 0;
    await run(x.db, "UPDATE customers SET stop = ?, stop_by = ?, stop_at = ?, stop_ok = ?, care_at = ?, care_result = 'Ngừng liên hệ', callback = NULL WHERE phone = ?", reason, u.name, now, ok, now, phone);
    await crmLog(x, u, 'Ngừng liên hệ', phone, c.name, reason, reason.indexOf('Khác: ') === 0 ? '' : note);
    await wbSafe(() => wbQueue(x, c.owner || u.name, phone, c.name, 'ngừng liên hệ: ' + reason.toLowerCase() + (note && reason.indexOf('Khác: ') ? ', ' + note : '')));
    const msg = '🕊️ <b>' + esc(u.name) + '</b> báo <b>ngừng liên hệ</b> khách <b>' + esc(c.name || '') + '</b> – ' + phone +
      '\nLý do: ' + esc(reason) + (note && reason.indexOf('Khác: ') ? ' (' + esc(note) + ')' : '') +
      '\nĐã mua ' + (c.orders || 0) + ' đơn · ' + fmt(c.spent) + (c.last ? ' · lần cuối ' + fmtDate(c.last, 'dd/MM/yyyy') : '') +
      '\n\nKhách này sẽ không hiện ở danh sách chăm sóc nữa. Bạn kiểm tra lại: ' + CRM_URL + '#khach-hang → lọc 🕊️ Ngừng liên hệ';
    for (const m of await crmUsers(x)) if (m.active && m.tg && m.level >= 2 && m.name !== u.name) { try { await telegramTo(x.env, m.tg, msg); } catch (e) { } }
    return { ok: true, stop: reason, stopAt: now, stopOk: !!ok };
  }
  if (!c.stop) return { ok: true };
  if (mode === 'ok') {
    if (u.level < 2) return { ok: false, error: 'Chỉ quản lý xác nhận được.' };
    await run(x.db, 'UPDATE customers SET stop_ok = 1 WHERE phone = ?', phone);
    await crmLog(x, u, 'Ngừng liên hệ', phone, c.name, 'Quản lý xác nhận', c.stop);
    return { ok: true };
  }
  if (mode === 'undo') {
    if (u.level < 2 && !(c.stop_by === u.name && !c.stop_ok)) return { ok: false, error: 'Quản lý đã xác nhận ngừng liên hệ. Cần chăm sóc lại thì nhờ quản lý bỏ.' };
    await run(x.db, "UPDATE customers SET stop = '', stop_by = '', stop_at = NULL, stop_ok = 0 WHERE phone = ?", phone);
    await crmLog(x, u, 'Bỏ ngừng liên hệ', phone, c.name, 'Chăm sóc lại', note || ('trước đó: ' + c.stop + ' (' + (c.stop_by || '') + ')'));
    if (c.stop_by && c.stop_by !== u.name) { try { await telegramUser(x, c.stop_by, '↩️ <b>' + esc(u.name) + '</b> trả lại khách <b>' + esc(c.name || '') + '</b> – ' + phone + ' để bạn chăm sóc tiếp (trước đó bạn báo: ' + esc(c.stop) + ').' + (note ? '\nGhi chú: ' + esc(note) : '')); } catch (e) { } }
    return { ok: true };
  }
  return { ok: false, error: 'Không rõ thao tác' };
}
async function crmCustomer(x, u, d) {
  const gErr = await guardPhone(x, u, d.phone); if (gErr) return { ok: false, error: gErr };
  if (u.level < 2) delete d.owner; // nhân viên không tự đổi người phụ trách
  const phone = normPhone(d.phone); if (!await first(x.db, 'SELECT phone FROM customers WHERE phone = ?', phone)) return { ok: false, error: 'Không tìm thấy khách ' + phone };
  const map = { owner: 'owner', note: 'note', name: 'name', address: 'address', province: 'province', ward: 'ward', tag: 'tag' }, set = {};
  if (d.quick) delete d.note; // ghi nhanh: máy chủ tự chèn dòng (bên dưới)
  Object.keys(map).forEach(k => { if (d[k] !== undefined) set[map[k]] = String(d[k]).slice(0, 45000); });
  if (set.note !== undefined && d.noteWas !== undefined) { // người khác vừa thêm dòng vào ghi chú trong lúc mình sửa → giữ các dòng đó (đặt lên đầu), không đè mất (16/10/2026)
    const cur = String((await first(x.db, 'SELECT note FROM customers WHERE phone = ?', phone) || {}).note || ''), base = String(d.noteWas);
    if (cur !== base) { const bl = new Set(base.split('\n')), mine = new Set(set.note.split('\n')), add = cur.split('\n').filter(l => l.trim() && !bl.has(l) && !mine.has(l)); if (add.length) set.note = (add.join('\n') + '\n' + set.note).slice(0, 45000); }
  }
  if (d.callback !== undefined) set.callback = dateOrBlank(d.callback);
  if (d.zalo !== undefined) set.zalo = d.zalo ? 1 : 0;
  if (d.consent !== undefined) set.consent = d.consent ? 1 : 0;
  if (d.dob !== undefined) { const dob = dobText(d.dob); if (String(d.dob).trim() && !dob) return { ok: false, error: 'Ngày sinh không đúng, nhập dạng ngày/tháng hoặc ngày/tháng/năm (VD 15/08 hoặc 15/08/1975)' }; set.dob = dob; }
  const cm = d.community === undefined ? null : d.community === 'Đã vào' ? 'Đã vào' : d.community === 'Đã mời' ? 'Đã mời ' + fmtDate(Date.now(), 'dd/MM/yy') : '';
  if (cm !== null) set.community = cm;
  const ks = Object.keys(set);
  if (ks.length) {
    const was = await first(x.db, 'SELECT ' + ks.join(', ') + ', name AS nm FROM customers WHERE phone = ?', phone) || {};
    await run(x.db, 'UPDATE customers SET ' + ks.map(k => k + ' = ?').join(', ') + ' WHERE phone = ?', ...ks.map(k => set[k]), phone);
    await custEditLog(x, u, phone, was, set);
    // 30/10/2026 anh Sơn: sửa tên / địa chỉ khách trên CRM → đơn gần nhất cũng đổi (lần tính lại khách lấy tên, địa chỉ theo đơn gần nhất) + ghi ngược vào file sale
    const nmC = set.name !== undefined && String(set.name).trim() && set.name !== was.name, adC = ['address', 'ward', 'province'].some(k => set[k] !== undefined && set[k] !== was[k]);
    if (nmC || adC) {
      const lo = await first(x.db, "SELECT rid, id, seller, source FROM orders WHERE phone = ? AND status NOT LIKE '%uỷ%' AND status NOT LIKE '%ủy%' ORDER BY time DESC, rid DESC LIMIT 1", phone);
      const cu = await first(x.db, 'SELECT name, address, ward, province, owner FROM customers WHERE phone = ?', phone), addr = [cu.address, cu.ward, cu.province].filter(Boolean).join(', ');
      if (lo) await run(x.db, 'UPDATE orders SET ' + [nmC ? 'name = ?' : '', adC ? 'address = ?, ward = ?, province = ?' : ''].filter(String).join(', ') + ' WHERE rid = ?', ...(nmC ? [cu.name] : []), ...(adC ? [cu.address || '', cu.ward || '', cu.province || ''] : []), lo.rid);
      await wbSafe(async () => { const mm = lo && String(lo.source || '').match(/^File .+? – (.+)$/);
        await wbInfoQueue(x, [cu.owner, lo && lo.seller], { phone, sheet: mm ? mm[1] : '', name: nmC ? cu.name : '', address: adC ? addr : '' }); });
    }
  }
  if (d.quick) { // ✏️ Ghi nhanh (16/10/2026): máy chủ tự chèn 1 dòng lên đầu ghi chú (không đè ghi chú người khác vừa sửa), tính là 1 lượt chăm sóc + nhật ký, xoá hẹn gọi lại đã tới hạn
    const q = String(d.quick).trim().slice(0, 500), now = Date.now(), cq = await first(x.db, 'SELECT name, note, owner, callback FROM customers WHERE phone = ?', phone);
    const line = fmtDate(now, 'dd/MM') + ': ' + q, cur = String(cq.note || ''), cbDue = cq.callback && Number(cq.callback) < startOfDay(now) + DAY;
    await run(x.db, 'UPDATE customers SET note = ?, care_at = ?, care_result = ?, owner = CASE WHEN owner IS NULL OR owner = \'\' THEN ? ELSE owner END' + (cbDue ? ', callback = NULL' : '') + ' WHERE phone = ?',
      (line + (cur ? '\n' + cur : '')).slice(0, 45000), now, 'Ghi nhanh', u.name, phone);
    await crmLog(x, u, 'Ghi nhanh', phone, cq.name, '', q);
  }
  if (cm !== null || d.promo || d.quick || d.zalo) {
    const cv = await first(x.db, 'SELECT name, note, owner FROM customers WHERE phone = ?', phone);
    if (cm !== null) await crmLog(x, u, 'Cộng đồng', phone, cv.name, cm || 'Bỏ đánh dấu', '');
    await wbSafe(async () => { // ghi nhanh / đã kết bạn Zalo / vào nhóm / gửi ưu đãi → cũng ghi vào file sale của người phụ trách
      if (d.quick) await wbQueue(x, cv.owner, phone, cv.name, String(d.quick));
      if (d.zalo) await wbQueue(x, cv.owner, phone, cv.name, '@zalo', true);
      if (cm === 'Đã vào') await wbQueue(x, cv.owner, phone, cv.name, '👥 đã vào nhóm Zalo cộng đồng');
      if (d.promo) await wbQueue(x, cv.owner, phone, cv.name, '📣 ' + String(d.promo).slice(0, 80));
    });
    if (d.promo) { // đã gửi tin ưu đãi qua Zalo: thêm 1 dòng vào ghi chú (không đè) + nhật ký "Gửi ưu đãi" để đo ưu đãi ra đơn
      const camp = String(d.promo).slice(0, 80), line = fmtDate(Date.now(), 'dd/MM/yy') + ': 📣 Gửi ưu đãi: ' + camp, cur = String(cv.note || '');
      await run(x.db, 'UPDATE customers SET note = ? WHERE phone = ?', (line + (cur ? '\n' + cur : '')).slice(0, 45000), phone);
      await crmLog(x, u, 'Gửi ưu đãi', phone, cv.name, camp, '');
    }
  }
  return { ok: true };
}
/** Nhật ký sửa thông tin khách (16/10/2026): đổi người phụ trách → "Đổi phụ trách" (A → B); sửa tên, địa chỉ, ghi chú, nhãn, hẹn gọi, ngày sinh… → "Sửa thông tin khách" (liệt kê mục đã đổi). */
const CUS_FIELD = { name: 'tên', address: 'địa chỉ', province: 'tỉnh', ward: 'phường/xã', note: 'ghi chú', tag: 'nhãn', callback: 'hẹn gọi lại', zalo: 'Zalo', consent: 'đồng ý nhận tin', dob: 'ngày sinh' };
async function custEditLog(x, u, phone, was, set) {
  const nm = set.name || was.nm || '', same = (a, b) => String(a == null ? '' : a) === String(b == null ? '' : b);
  if (set.owner !== undefined && !same(was.owner, set.owner)) await crmLog(x, u, 'Đổi phụ trách', phone, nm, (was.owner || 'Chưa ai') + ' → ' + (set.owner || 'Chưa ai'), '');
  const ch = Object.keys(CUS_FIELD).filter(k => set[k] !== undefined && !same(was[k], set[k])).map(k => CUS_FIELD[k]);
  if (ch.length) await crmLog(x, u, 'Sửa thông tin khách', phone, nm, 'Sửa ' + ch.join(', '), '');
}
/** Ghi ngược vào file sale (wb.js): lỗi không chặn thao tác trên CRM. */
async function wbSafe(fn) { try { await fn(); } catch (e) { console.error('wb', e.message); } }
const cbTxt = cb => cb ? ' (hẹn gọi ' + String(cb).split('-').reverse().slice(0, 2).map(Number).join('/') + ')' : '';
/** Ngày sinh → "dd/MM" hoặc "dd/MM/yyyy" ('' nếu sai). */
export function dobText(v) {
  const m = String(v || '').trim().match(/^(\d{1,2})[\/.\-](\d{1,2})(?:[\/.\-](\d{4}))?$/); if (!m) return '';
  const dd = +m[1], mo = +m[2]; if (dd < 1 || dd > 31 || mo < 1 || mo > 12) return '';
  return ('0' + dd).slice(-2) + '/' + ('0' + mo).slice(-2) + (m[3] ? '/' + m[3] : '');
}
/** 🎁 Nhân sự gửi quà tặng (cẩm nang, ebook) cho khách qua Zalo → ghi Nhật ký "Gửi quà tặng" (kết quả = tên quà). */
async function crmGift(x, u, d) {
  const phone = normPhone(d.phone); if (!/^0\d{9,10}$/.test(phone)) return { ok: false, error: 'Số điện thoại chưa đúng.' };
  if (u.level < 2) { const ow = await ownerOf(x, phone); if (ow && ow !== u.name) return { ok: false, error: 'Khách này do ' + ow + ' phụ trách.' }; } // không ghi nhật ký vào khách của người khác (16/10/2026)
  await crmLog(x, u, 'Gửi quà tặng', phone, String(d.name || '').slice(0, 100), String(d.gift || '').slice(0, 100), '');
  return { ok: true };
}
/** 🎉 Sale gửi lời chúc (ngày lễ, sinh nhật) cho khách / khách hỏi qua Zalo → Nhật ký "Gửi lời chúc" (kết quả = tên dịp). Không tính là chăm sóc, không đổi ngày chăm sóc. */
async function crmGreet(x, u, d) {
  const phone = normPhone(d.phone); if (!/^0\d{9,10}$/.test(phone)) return { ok: false, error: 'Số điện thoại chưa đúng.' };
  if (u.level < 2) { const ow = await ownerOf(x, phone); if (ow && ow !== u.name) return { ok: false, error: 'Khách này do ' + ow + ' phụ trách.' }; }
  await crmLog(x, u, 'Gửi lời chúc', phone, String(d.name || '').slice(0, 100), String(d.occ || '').slice(0, 100), '');
  return { ok: true };
}
async function crmContact(x, u, d) {
  if (u.level < 2) return { ok: false, error: 'Chỉ quản lý xử lý liên hệ từ website.' }; // sale không thấy tab Liên hệ (16/10/2026)
  const r = await first(x.db, 'SELECT * FROM contacts WHERE rid = ?', Number(d.row) || 0); if (!r) return { ok: false, error: 'Không tìm thấy liên hệ' };
  if (d.done !== undefined) await run(x.db, 'UPDATE contacts SET done = ? WHERE rid = ?', d.done ? 1 : 0, r.rid);
  if (d.note !== undefined) await run(x.db, 'UPDATE contacts SET note = ? WHERE rid = ?', String(d.note), r.rid);
  if (d.done) await crmLog(x, u, 'Trả lời liên hệ', r.phone, r.name, 'Đã trả lời', d.note || '');
  return { ok: true };
}

/* ================================================================ cài đặt, nhân sự, mục tiêu */
const COMM_KEYS = ['Khách mới', 'Khách cũ', 'Ngoài giờ', 'Ngày lễ', 'Đơn web'];
// 💰 Phụ lục 01/CĐ2026 (anh Sơn gửi 30/10/2026): [doanh thu tháng từ, lương cơ bản, trợ cấp BH, [[% khách cũ, % khách mới] dưới 1 năm, 1–2 năm, trên 2 năm]].
// Dưới bậc đầu (80 triệu) = "hỗ trợ theo năng lực" (quản lý quyết). senior: [số tháng làm từ, phụ cấp thâm niên / tháng]. webAuto: khách mới tự đặt web không qua link sale = % của mức khách mới.
const PAYPLAN = { on: 1, webAuto: 50, off: 6, hol: 10, own: 10, ownMonths: 6, ownFrom: '2026-11-10', // own: % mọi đơn của khách sale tự mang về (tự tìm / được giới thiệu) trong ownMonths tháng, khách mua lần đầu từ ownFrom (anh Sơn 10/11/2026) // off / hol: % cố định đơn sale chốt tối / Chủ nhật (Ngoài giờ) và ngày lễ (anh Sơn gửi 30/10/2026), không theo bậc / thâm niên
  senior: [[36, 300000], [60, 500000]], tiers: [
  [80e6, 5500000, 1000000, [[3, 2], [4.5, 2.5], [5, 2.5]]], [100e6, 6500000, 1000000, [[3, 2.5], [4.5, 2.5], [5, 2.5]]], [150e6, 7000000, 1000000, [[3.5, 2.5], [4.5, 2.5], [5, 2.5]]],
  [200e6, 7500000, 1000000, [[3.5, 3], [4.5, 3], [5, 3.5]]], [250e6, 8000000, 1000000, [[4, 3], [4.5, 3], [5, 3.5]]], [300e6, 8500000, 1000000, [[4, 3], [4.5, 3], [5, 3.5]]], [350e6, 9000000, 1000000, [[4, 3], [4.5, 3], [5, 3.5]]]] };
// 🗺 Ảnh hệ thống Marketing (19/10/2026): nút ở tab Marketing mở link này; Quản trị đổi link ở Cài đặt khi cập nhật ảnh
const MKT_DOC_DEF = { url: 'https://www.canva.com/design/DAHR6DTx10U/rS1FE_25_Xrf9_WPWuN1Sg/view', at: '' };
async function crmSettings(x, u, d) {
  if (d.ca) {
    const hol = String(d.ca.holidays || '').split(/[,;\s]+/).map(s => { const m = s.match(/^(\d{1,2})\/(\d{1,2})$/); return m ? ('0' + m[1]).slice(-2) + '/' + ('0' + m[2]).slice(-2) : ''; }).filter(String);
    const ev = /^\d{1,2}:\d{2}$/.test(String(d.ca.evening)) ? d.ca.evening : '17:30';
    await kvSet(x.db, 'ca_cfg', JSON.stringify({ evening: ev, holidays: hol })); x._ca = null;
    await crmLog(x, u, 'Cài đặt', '-', '', 'Ca tối từ ' + ev + ', lễ: ' + hol.join(', '), '');
    return { ok: true };
  }
  if (d.self) { // 🔎 Tự tạo khách: mục ở tab Hôm nay của sale, ô mục tiêu khách tự tạo, hạng thi đua, tin Telegram “khách bạn tự mang về” (ẩn tới khi Quản trị bật)
    if (u.level < 3) return { ok: false, error: 'Chỉ Quản trị bật / tắt được mục này.' };
    const cur = await rulesCfg(x), R = Object.assign({}, cur, { selfOn: d.self.on ? 1 : 0 });
    await kvSet(x.db, 'rules_cfg', JSON.stringify(R)); x._rules = null;
    await crmLog(x, u, 'Cài đặt', '-', '', (R.selfOn ? 'Bật' : 'Ẩn') + ' mục Tự tạo khách (tab Hôm nay của sale, mục tiêu khách tự tạo, thi đua, tin khách tự mang về)', '');
    return { ok: true, rules: R };
  }
  if (d.pool) { // 🧺 Kho chung (09/11/2026): số công ty giao quá N ngày chưa chốt tự về kho; mỗi người nhận tối đa M số / ngày
    const day60 = v => Math.min(60, Math.max(0, Math.round(Number(v) || 0)));
    const cur = await rulesCfg(x), R = Object.assign({}, cur, { poolDays: day60(d.pool.days), poolNoCall: d.pool.noCall === undefined ? cur.poolNoCall : day60(d.pool.noCall), poolIdle: d.pool.idle === undefined ? cur.poolIdle : day60(d.pool.idle), poolMax: Math.min(100, Math.max(0, Math.round(Number(d.pool.max) || 0))), poolOn: d.pool.on === undefined ? cur.poolOn : (d.pool.on ? 1 : 0) });
    if (d.pool.on !== undefined && u.level < 3) return { ok: false, error: 'Chỉ Quản trị bật / tắt được Kho chung.' };
    await kvSet(x.db, 'rules_cfg', JSON.stringify(R)); x._rules = null;
    await crmLog(x, u, 'Cài đặt', '-', '', (R.poolOn ? '🧺 Kho chung BẬT · ' : '🧺 Kho chung ĐANG ẨN · ') + poolRuleTxt(R) + '; nhận tối đa ' + (R.poolMax || 'không giới hạn') + ' số / ngày', '');
    return { ok: true, rules: R };
  }
  if (d.rules) {
    const cur = await rulesCfg(x);
    const R = { poolDays: cur.poolDays, poolNoCall: cur.poolNoCall, poolIdle: cur.poolIdle, poolMax: cur.poolMax, selfOn: cur.selfOn, poolOn: cur.poolOn, vipOrders: Math.max(1, Math.round(Number(d.rules.vipOrders) || VIP_ORDERS)), vipSpent: Math.max(0, Math.round(Number(d.rules.vipSpent) || VIP_SPENT)), atRisk: Math.max(7, Math.round(Number(d.rules.atRisk) || AT_RISK_DAYS)),
      coolDays: d.rules.coolDays === undefined || d.rules.coolDays === '' ? (await rulesCfg(x)).coolDays : Math.min(60, Math.max(0, Math.round(Number(d.rules.coolDays) || 0))),
      shipDays: d.rules.shipDays === undefined || d.rules.shipDays === '' ? (await rulesCfg(x)).shipDays : Math.min(15, Math.max(0, Math.round(Number(d.rules.shipDays) || 0))),
      shipFar: d.rules.shipFar === undefined || d.rules.shipFar === '' ? (await rulesCfg(x)).shipFar : Math.min(15, Math.max(0, Math.round(Number(d.rules.shipFar) || 0))),
      famMin: d.rules.famMin === undefined || d.rules.famMin === '' ? (await rulesCfg(x)).famMin : Math.min(10, Math.max(0, Math.round(Number(d.rules.famMin) || 0))) };
    await kvSet(x.db, 'rules_cfg', JSON.stringify(R)); x._rules = null;
    await crmLog(x, u, 'Cài đặt', '-', '', 'VIP từ ' + R.vipOrders + ' đơn hoặc ' + fmt(R.vipSpent) + '; Sắp mất sau ' + R.atRisk + ' ngày; giãn cách chăm sóc ' + R.coolDays + ' ngày', '');
    return { ok: true, rules: R };
  }
  if (d.commission) { // % hoa hồng theo loại đơn + riêng đơn khách tự đặt trên web; để trống = chưa tính
    const CM = {};
    COMM_KEYS.forEach(t => { const v = String(d.commission[t] == null ? '' : d.commission[t]).trim().replace(',', '.'), n = Number(v); CM[t] = v === '' || isNaN(n) ? '' : Math.min(100, Math.max(0, n)); });
    await kvSet(x.db, 'commission_cfg', JSON.stringify(CM));
    await crmLog(x, u, 'Cài đặt', '-', '', 'Hoa hồng: ' + COMM_KEYS.map(t => t + ' ' + (CM[t] === '' ? '–' : CM[t] + '%')).join(', '), '');
    return { ok: true, commission: CM };
  }
  if (d.payplan) { // 💰 Lương & hoa hồng theo Phụ lục 01/CĐ2026 (30/10/2026): bậc doanh thu × thâm niên × khách cũ / mới; chỉ Quản trị sửa
    if (u.level < 3) return { ok: false, error: 'Chỉ Quản trị sửa được mục này.' };
    const P = d.payplan, n = v => Math.max(0, Number(String(v == null ? '' : v).replace(',', '.')) || 0);
    const tiers = (Array.isArray(P.tiers) ? P.tiers : []).map(t => [n(t[0]), n(t[1]), n(t[2]), [0, 1, 2].map(k => [Math.min(50, n((t[3] || [])[k] && t[3][k][0])), Math.min(50, n((t[3] || [])[k] && t[3][k][1]))])]).filter(t => t[0] > 0).sort((a, b) => a[0] - b[0]).slice(0, 12);
    const cur = Object.assign({}, PAYPLAN, await kvJson(x.db, 'payplan_cfg', null) || {});
    const PP = { on: P.on ? 1 : 0, tiers, senior: (Array.isArray(P.senior) ? P.senior : []).map(t => [Math.round(n(t[0])), n(t[1])]).filter(t => t[0] > 0).slice(0, 4), webAuto: Math.min(100, n(P.webAuto)), off: Math.min(50, n(P.off)), hol: Math.min(50, n(P.hol)),
      own: P.own === undefined ? cur.own : Math.min(50, n(P.own)), ownMonths: P.ownMonths === undefined ? cur.ownMonths : Math.min(24, Math.max(1, Math.round(n(P.ownMonths)) || 6)), ownFrom: /^\d{4}-\d{2}-\d{2}$/.test(String(P.ownFrom || '')) ? P.ownFrom : cur.ownFrom }; // 🙋 khách tự mang về: client cũ không gửi thì giữ số cũ
    await kvSet(x.db, 'payplan_cfg', JSON.stringify(PP));
    await crmLog(x, u, 'Cài đặt', '-', '', 'Lương & hoa hồng Phụ lục 01: ' + (PP.on ? 'bật' : 'tắt') + ' · ' + tiers.length + ' bậc · khách mới tự đặt web ' + PP.webAuto + '% mức khách mới · tối / CN ' + PP.off + '% · lễ ' + PP.hol + '% · khách tự mang về ' + PP.own + '% trong ' + PP.ownMonths + ' tháng (từ ' + PP.ownFrom + ')', '');
    return { ok: true, payplan: PP };
  }
  if (d.staffGuard) { // nhân sự chưa có tài khoản CRM: họ tên, SĐT, số tài khoản → cảnh báo tự làm CTV (partner.js staffHit)
    if (u.level < 3) return { ok: false, error: 'Chỉ Quản trị sửa được mục này.' };
    const G = (Array.isArray(d.staffGuard) ? d.staffGuard : []).map(r => ({ full: String(r.full || '').trim().slice(0, 80), phone: normPhone(r.phone || '') || '', acct: String(r.acct || '').replace(/\D/g, '').slice(0, 24) })).filter(r => r.full || r.phone || r.acct).slice(0, 100);
    await kvSet(x.db, 'staff_guard', JSON.stringify(G));
    await crmLog(x, u, 'Cài đặt', '-', '', 'Nhân sự chưa có tài khoản CRM: ' + G.length + ' người', '');
    return { ok: true, staffGuard: G };
  }
  if (d.kpi) { // mức "tốt" của chỉ số chiến dịch ở tab Marketing (chỉ Quản trị): CPM, CPC, giá 1 tin nhắn, giá 1 SĐT (đ, tốt khi dưới), CTR (%, tốt khi từ). 0 = chưa đặt → so với trung bình 7 ngày
    if (u.level < 3) return { ok: false, error: 'Chỉ Quản trị sửa được mục này.' };
    const v = k => Math.min(1e9, Math.max(0, Number(String(d.kpi[k] == null ? '' : d.kpi[k]).replace(',', '.')) || 0)), K = { cpm: Math.round(v('cpm')), ctr: Math.min(100, Math.round(v('ctr') * 100) / 100), cpc: Math.round(v('cpc')), msg: Math.round(v('msg')), sdt: Math.round(v('sdt')) };
    const D = Object.assign({}, await kvJson(x.db, 'dash_cfg', {}), { kpi: K }); await kvSet(x.db, 'dash_cfg', JSON.stringify(D));
    await crmLog(x, u, 'Cài đặt', '-', '', 'Mức tốt chỉ số quảng cáo: CPM dưới ' + (K.cpm || '–') + 'đ · CTR từ ' + (K.ctr || '–') + '% · CPC dưới ' + (K.cpc || '–') + 'đ · 1 tin nhắn dưới ' + (K.msg || '–') + 'đ', '');
    return { ok: true, dash: D };
  }
  if (d.cost) { // 💰 giá nhập từng sản phẩm + % chi phí thêm (vận chuyển, kho…) → giá vốn để Tổng quan tính lãi gộp. Chỉ Quản trị.
    if (!finOk(u)) return { ok: false, error: 'Chỉ Quản trị và Kế toán sửa được mục này.' };
    const items = (Array.isArray(d.cost.items) ? d.cost.items : []).slice(0, 200).map(r => [String((r || [])[0] || '').trim().slice(0, 80), Math.max(0, Math.min(1e9, Math.round(Number(String((r || [])[1] || '').replace(/[^\d]/g, '')) || 0)))]).filter(r => r[0] && r[1]);
    const C = { items, oh: Math.min(100, Math.max(0, Number(String(d.cost.oh == null ? 15 : d.cost.oh).replace(',', '.')) || 0)), at: Date.now(), by: u.name };
    await kvSet(x.db, 'cost_cfg', JSON.stringify(C));
    await crmLog(x, u, 'Cài đặt', '-', '', 'Giá vốn: ' + items.length + ' sản phẩm, cộng thêm ' + C.oh + '%', '');
    return { ok: true, cost: C };
  }
  if (d.pay) { // 👥 bảng lương / tạm ứng kế toán gửi (02/11/2026): chỉ lưu tổng theo bộ phận, không lưu tên, số tài khoản. Chỉ Quản trị. Ghi vào opex_cfg[tháng].pay
    if (!finOk(u)) return { ok: false, error: 'Chỉ Quản trị và Kế toán sửa được mục này.' };
    const m = String(d.pay.month || ''), P = d.pay.data || {}; if (!/^20\d\d-(0[1-9]|1[0-2])$/.test(m)) return { ok: false, error: 'Tháng không hợp lệ.' };
    const num = v => Math.max(0, Math.min(1e11, Math.round(Number(v) || 0)));
    const pay = { file: String(P.file || '').slice(0, 120), kind: P.kind === 'luong' ? 'luong' : 'tu', dept: (Array.isArray(P.dept) ? P.dept : []).slice(0, 20).map(r => [String((r || [])[0] || '').trim().slice(0, 40), num((r || [])[1]), num((r || [])[2])]).filter(r => r[0]), at: Date.now(), by: u.name };
    pay.n = pay.dept.reduce((a, r) => a + r[1], 0); pay.tot = pay.dept.reduce((a, r) => a + r[2], 0);
    const O = (await kvJson(x.db, 'opex_cfg', {})) || {};
    if (P.del) { if (O[m]) delete O[m].pay; } else O[m] = Object.assign(O[m] || { items: [], at: Date.now(), by: u.name }, { pay });
    if (O[m] && !(O[m].items || []).length && !O[m].kt && !O[m].pay) delete O[m];
    await kvSet(x.db, 'opex_cfg', JSON.stringify(O));
    await crmLog(x, u, 'Cài đặt', '-', '', (P.del ? 'Xoá bảng lương' : 'Tải ' + (pay.kind === 'luong' ? 'bảng lương' : 'bảng tạm ứng')) + ' tháng ' + m.slice(5) + '/' + m.slice(0, 4) + (P.del ? '' : ': ' + pay.n + ' người, tổng ' + fmt(pay.tot)), '');
    return { ok: true, opex: O };
  }
  if (d.opex) { // 🧮 chi phí văn phòng theo tháng (thuê nhà, lương, điện nước…) → Tổng quan tính lãi / lỗ ròng (01/11/2026). Chỉ Quản trị. kv opex_cfg = { 'YYYY-MM': { items: [[tên, số tiền]], at, by } }
    if (!finOk(u)) return { ok: false, error: 'Chỉ Quản trị và Kế toán sửa được mục này.' };
    const m = String(d.opex.month || ''); if (!/^20\d\d-(0[1-9]|1[0-2])$/.test(m)) return { ok: false, error: 'Tháng không hợp lệ.' };
    const items = (Array.isArray(d.opex.items) ? d.opex.items : []).slice(0, 60).map(r => [String((r || [])[0] || '').trim().slice(0, 80), Math.max(0, Math.min(1e11, Math.round(Number(String((r || [])[1] || '').replace(/[^\d]/g, '')) || 0)))]).filter(r => r[0] && r[1]);
    const O = (await kvJson(x.db, 'opex_cfg', {})) || {};
    // kt = số từ file báo cáo kế toán tải lên (01/11/2026): tổng hợp tháng + chi phí theo nhóm, để so với số CRM tính
    const num = v => { const n = Math.round(Number(v)); return isFinite(n) ? Math.max(-1e12, Math.min(1e12, n)) : null; }, k0 = d.opex.kt;
    const kt = k0 && typeof k0 === 'object' ? Object.assign({ file: String(k0.file || '').slice(0, 120), groups: (Array.isArray(k0.groups) ? k0.groups : []).slice(0, 40).map(r => [String((r || [])[0] || '').trim().slice(0, 80), num((r || [])[1]) || 0]).filter(r => r[0]), at: Date.now(), by: u.name },
      ...['sale', 'shopee', 'dt', 'cogs', 'gp', 'cost', 'profit', 'flow', 'cash', 'payable', 'ads', 'san'].map(k => k0[k] == null || num(k0[k]) === null ? {} : { [k]: num(k0[k]) })) : (O[m] || {}).kt;
    const pay0 = (O[m] || {}).pay;
    if (!d.opex.del && (items.length || kt)) O[m] = Object.assign({ items, at: Date.now(), by: u.name }, kt ? { kt } : {}, pay0 ? { pay: pay0 } : {}); else if (pay0 && !d.opex.del) O[m] = { items: [], pay: pay0 }; else delete O[m];
    Object.keys(O).sort().slice(0, -36).forEach(k => delete O[k]); // giữ 3 năm gần nhất
    await kvSet(x.db, 'opex_cfg', JSON.stringify(O));
    await crmLog(x, u, 'Cài đặt', '-', '', (d.opex.del ? 'Xoá chi phí' : kt && k0 ? 'Tải file kế toán' : 'Chi phí văn phòng') + ' tháng ' + m.slice(5) + '/' + m.slice(0, 4) + ': ' + items.length + ' khoản, tổng ' + fmt(items.reduce((a, r) => a + r[1], 0)), '');
    return { ok: true, opex: O };
  }
  if (d.dash) { // mức đèn ở tab Tổng quan (chỉ Quản trị): chi phí quảng cáo / doanh thu khách mới dưới adsGood % = xanh, tới adsBad % = cam, trên = đỏ
    if (u.level < 3) return { ok: false, error: 'Chỉ Quản trị sửa được mục này.' };
    const g = Math.min(500, Math.max(1, Number(String(d.dash.adsGood).replace(',', '.')) || 30)), b = Math.min(1000, Math.max(g, Number(String(d.dash.adsBad).replace(',', '.')) || 40));
    const bc = Math.min(1e6, Math.max(0, Math.round(Number(d.dash.backCost) || 0))); // phí ship mất cho 1 đơn hoàn (đi + về), 01/11/2026
    const D = Object.assign({}, await kvJson(x.db, 'dash_cfg', {}), { adsGood: g, adsBad: b }, bc ? { backCost: bc } : {}); await kvSet(x.db, 'dash_cfg', JSON.stringify(D));
    await crmLog(x, u, 'Cài đặt', '-', '', 'Đèn quảng cáo Tổng quan: xanh dưới ' + g + '%, cam tới ' + b + '%, đỏ trên ' + b + '%' + (bc ? ' · phí ship 1 đơn hoàn ' + bc + 'đ' : ''), '');
    return { ok: true, dash: D };
  }
  if (d.mktDoc) {
    if (u.level < 3) return { ok: false, error: 'Chỉ Quản trị sửa được mục này.' };
    const url = String(d.mktDoc.url || '').trim();
    if (!/^https:\/\/\S+$/.test(url) || url.length > 500) return { ok: false, error: 'Link phải bắt đầu bằng https://' };
    const M = { url, at: fmtDate(Date.now(), 'dd/MM/yyyy') }; await kvSet(x.db, 'mkt_doc', JSON.stringify(M));
    await crmLog(x, u, 'Cài đặt', '-', '', 'Link ảnh hệ thống Marketing: ' + url, '');
    return { ok: true, mktDoc: M };
  }
  if (d.assignMode) {
    if (!ASSIGN_MODES[d.assignMode]) return { ok: false, error: 'Chế độ không hợp lệ' };
    await kvSet(x.db, 'assign_mode', d.assignMode); x._mode = null;
    await crmLog(x, u, 'Cài đặt', '-', '', 'Chia khách mới: ' + ASSIGN_MODES[d.assignMode], '');
    return { ok: true };
  }
  if (d.cycles) {
    const rows = d.cycles.filter(r => r && String(r[0]).trim() && Number(r[2]) > 0).map(r => ({ name: String(r[0]).trim(), variant: String(r[1] || '').trim(), days: Number(r[2]), basis: String(r[3] || '') }));
    await replaceRows(x.db, 'cycles', ['name', 'variant', 'days', 'basis'], rows); x._cycles = null;
    await recalcAll(x); // tính lại ngày dự kiến hết hàng theo chu kỳ mới
  }
  if (d.templates) {
    const rows = d.templates.filter(r => r && String(r[2]).trim()).map(r => ({ when_txt: String(r[0] || ''), purpose: String(r[1] || ''), text: String(r[2]) }));
    await replaceRows(x.db, 'templates', ['when_txt', 'purpose', 'text'], rows);
  }
  await crmLog(x, u, 'Cài đặt', '-', '', d.cycles ? 'Sửa chu kỳ dùng' : 'Sửa mẫu tin nhắn', '');
  return { ok: true };
}
async function crmSaveUsers(x, u, d) {
  const cur = {}; (await crmUsers(x)).forEach(y => { cur[y.email] = y; });
  const seen = {}, rows = (d.users || []).map((y, i) => {
    const e = String(y.email || '').trim().toLowerCase(), o = cur[e] || {}, role = roleOf(y.role);
    return { email: e, name: String(y.name || '').trim(), role, active: y.active === false ? 0 : 1, recv: (y.recv !== undefined ? y.recv : o.recv !== undefined ? o.recv : role === SALE) ? 'Có' : 'Không', tg: o.tg || '',
      alias: String(y.alias !== undefined ? y.alias : o.alias || '').trim(), prefix: String(y.prefix !== undefined ? y.prefix : o.prefix || '').replace(/[^A-Za-z0-9]/g, ''), web: (y.web !== undefined ? y.web : o.web) ? 'Có' : '', mkv: (y.mkv !== undefined ? y.mkv : o.mkv) ? 'Có' : '', zb: (y.zb !== undefined ? y.zb : o.zb) ? 'Có' : '', kho: (y.kho !== undefined ? y.kho : o.kho) ? 'Có' : '', phone: normPhone(y.phone !== undefined ? y.phone : o.phone || '') || '', full: String(y.full !== undefined ? y.full : o.full || '').trim().slice(0, 80), acct: String(y.acct !== undefined ? y.acct : o.acct || '').replace(/\D/g, '').slice(0, 24), joined: String(y.joined !== undefined ? y.joined : o.joined || '').trim().slice(0, 30), ord: i };
  }).filter(r => { if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(r.email) || seen[r.email]) return false; seen[r.email] = 1; return true; });
  if (!seen[SUPER_ADMIN]) rows.unshift({ email: SUPER_ADMIN, name: 'Thái Sơn', role: 'Quản trị', active: 1, recv: 'Không', tg: cur[SUPER_ADMIN] ? cur[SUPER_ADMIN].tg || '' : '', alias: '', prefix: '', web: 'Có', mkv: '', zb: '', kho: cur[SUPER_ADMIN] && cur[SUPER_ADMIN].kho ? 'Có' : '', phone: cur[SUPER_ADMIN] ? cur[SUPER_ADMIN].phone || '' : '', full: cur[SUPER_ADMIN] ? cur[SUPER_ADMIN].full || '' : '', acct: cur[SUPER_ADMIN] ? cur[SUPER_ADMIN].acct || '' : '', joined: cur[SUPER_ADMIN] ? cur[SUPER_ADMIN].joined || '' : '', ord: -1 });
  const ren = {}; rows.forEach(r => { const o = cur[r.email]; if (o && o.name && r.name && o.name !== r.name && !rows.some(z => z.name === o.name)) ren[o.name] = r.name; }); // đổi tên → đơn, khách, file sale theo tên mới
  await replaceRows(x.db, 'users', ['email', 'name', 'role', 'active', 'recv', 'tg', 'alias', 'prefix', 'web', 'mkv', 'zb', 'kho', 'phone', 'full', 'acct', 'joined', 'ord'], rows); x._users = null;
  try { await unifyNames(x, ren); } catch (e) { console.error('unifyNames', e.message); }
  await crmLog(x, u, 'Nhân sự', '-', '', 'Cập nhật ' + rows.length + ' tài khoản', '');
  return { ok: true, users: await crmUsers(x) };
}
async function crmTarget(x, u, d) {
  const month = String(d.month || ''), amount = Math.round(Number(d.amount) || 0), name = String(d.name || u.name).trim();
  if (!/^\d{4}-\d{2}$/.test(month)) return { ok: false, error: 'Tháng không hợp lệ.' };
  if (amount < 0 || amount > 1e11) return { ok: false, error: 'Số tiền chưa đúng.' };
  if (name !== u.name && u.level < 2) return { ok: false, error: 'Bạn chỉ đặt được mục tiêu của mình.' };
  const selfN = d.selfN === undefined || d.selfN === null || d.selfN === '' ? null : Math.min(999, Math.max(0, Math.round(Number(d.selfN) || 0))); // 🙋 khách tự tạo / tháng (null = giữ số cũ)
  const old = await first(x.db, 'SELECT amount, self_n FROM targets WHERE month = ? AND name = ?', month, name);
  await run(x.db, 'INSERT INTO targets (month, name, amount, by_name, at, self_n) VALUES (?, ?, ?, ?, ?, ?) ON CONFLICT(month, name) DO UPDATE SET amount = excluded.amount, by_name = excluded.by_name, at = excluded.at, self_n = coalesce(excluded.self_n, targets.self_n)', month, name, amount, u.name, Date.now(), selfN);
  await crmLog(x, u, 'Mục tiêu', month, name, fmt(old ? old.amount : 0) + ' → ' + fmt(amount) + (selfN !== null ? ' · khách tự tạo ' + (old ? old.self_n || 0 : 0) + ' → ' + selfN : ''), name !== u.name ? 'quản lý đặt' : '');
  return { ok: true };
}

/* ================================================================ khách tiềm năng */
async function leadGet(x, id) { return first(x.db, 'SELECT * FROM leads WHERE id = ?', String(id)); }
const LEAD_FIELDS = ['time', 'name', 'phone', 'channel', 'interest', 'status', 'owner', 'last_at', 'callback', 'reason', 'note', 'order_id', 'by_name', 'ref_phone', 'ref_name', 'own_at', 'pool_n', 'pool_from', 'pool_warn', 'how'];
export async function leadUpdate(x, id, f) {
  if (f.owner !== undefined && f.own_at === undefined) f.own_at = Date.now(); // 🧺 đổi người phụ trách = tính lại ngày giao (đếm N ngày về Kho chung từ đây)
  const ks = Object.keys(f).filter(k => LEAD_FIELDS.indexOf(k) >= 0); if (!ks.length) return false;
  if (f.phone !== undefined) f.phone = normPhone(f.phone);
  const r = await run(x.db, 'UPDATE leads SET ' + ks.map(k => k + ' = ?').join(', ') + ' WHERE id = ?', ...ks.map(k => f[k] === undefined ? null : f[k]), String(id));
  return r.meta.changes > 0;
}
/** Thêm khách tiềm năng. Số này đang có 1 lượt đang mở (Mới hỏi / Đang tư vấn) thì ghi nối vào đó, không tạo trùng. */
export async function addLead(x, o) {
  const phone = await mainPhone(x, o.phone), now = Date.now();
  const cur = await first(x.db, "SELECT * FROM leads WHERE phone = ? AND status IN ('Mới hỏi', 'Đang tư vấn') ORDER BY rid DESC LIMIT 1", phone);
  if (cur) {
    const note = String(cur.note || '') + (o.note ? '\n[' + fmtDate(now, 'dd/MM') + '] ' + o.note : '');
    const ci = String(cur.interest || ''), oi = String(o.interest || '');
    const interest = o.addInterest && ci && oi && ci.indexOf(oi.split(' · ')[0]) < 0 ? ci + ' | ' + oi : (oi || ci); // addInterest: khách nhận thêm quà khác → giữ quan tâm cũ, ghi nối
    const f = { note, interest, owner: cur.owner || o.owner || '' };
    if (o.refPhone && !cur.ref_phone) Object.assign(f, { ref_phone: o.refPhone, ref_name: o.refName || '', channel: o.channel || cur.channel });
    if (o.how && !cur.how) f.how = String(o.how).slice(0, 160); // 🙋 khách biết sale qua đâu
    await leadUpdate(x, cur.id, f);
    return { id: cur.id, merged: true, owner: cur.owner || o.owner || '' };
  }
  let owner = o.owner || '';
  if (!owner && o.auto) owner = (await ownerOf(x, phone)) || (o.by === 'Website' ? '' : await autoOwner(x)); // khách cũ → người đang phụ trách; khách lạ → theo chế độ chia khách. 24/10/2026: khách lạ để lại số trên web không tự chia, chờ quản lý giao
  const id = 'TN' + fmtDate(now, 'yyMMddHHmmss') + Math.floor(Math.random() * 10) + randHex(1);
  await run(x.db, 'INSERT INTO leads (id, time, name, phone, channel, interest, status, owner, last_at, callback, reason, note, order_id, by_name, ref_phone, ref_name, own_at, how) VALUES (?, ?, ?, ?, ?, ?, ?, ?, NULL, ?, \'\', ?, \'\', ?, ?, ?, ?, ?)',
    id, now, o.name || '', phone, o.channel || 'Khác', o.interest || '', 'Mới hỏi', owner, dateOrBlank(o.callback), o.note || '', o.by || '', o.refPhone || '', o.refName || '', owner ? now : null, String(o.how || '').slice(0, 160));
  return { id, merged: false, owner };
}
async function crmLeadSave(x, u, d) {
  const phone = normPhone(d.phone);
  if (!/^0\d{9,10}$/.test(phone)) return { ok: false, error: 'Số điện thoại chưa đúng (10 số, bắt đầu bằng 0).' };
  // 🎁 Khách giới thiệu: SĐT người giới thiệu (có thể chưa có trong CRM thì ghi kèm tên)
  const refPhone = d.refPhone ? normPhone(d.refPhone) : '', refName = String(d.refName || '').trim().slice(0, 80);
  if (refPhone && !/^0\d{9,10}$/.test(refPhone)) return { ok: false, error: 'Số điện thoại người giới thiệu chưa đúng.' };
  if (refPhone && refPhone === phone) return { ok: false, error: 'Người giới thiệu không thể là chính khách này.' };
  if (!d.id && u.level < 2) { // nhân viên thêm khách tiềm năng: không được "đè" lên khách của người khác
    const chk = await crmCheckPhone(x, u, { phone });
    if (chk.status === 'other') return { ok: false, error: 'Số này ' + (chk.lead ? 'đang là khách tiềm năng' : 'là khách hàng') + ' do ' + chk.owner + ' phụ trách. Nhờ quản lý nếu cần chuyển.' };
    d.owner = u.name;
  }
  if (d.id && u.level < 2) { const ld0 = await leadGet(x, d.id); if (!ld0) return { ok: false, error: 'Không tìm thấy khách tiềm năng.' }; const e0 = await guardLead(x, u, ld0); if (e0) return { ok: false, error: e0 }; d.owner = u.name; }
  let refTo = ''; // 🌱 khách mới (chưa có trong CRM) do khách cũ giới thiệu → thuộc về sale phụ trách khách cũ, sale đó được thưởng (partner.js refClaim)
  if (!d.id && refPhone) { refTo = await refClaim(x, phone, refPhone, 'lead', u.name); if (refTo) d.owner = refTo; }
  if (d.id && refPhone) { const ld2 = await leadGet(x, d.id); if (ld2 && !ld2.ref_phone && Date.now() - (Number(ld2.time) || 0) < 2 * DAY) { refTo = await refClaim(x, phone, refPhone, 'lead', u.name, d.id); if (refTo) d.owner = refTo; } } // quên ghi người giới thiệu lúc thêm: sửa trong 2 ngày vẫn tính
  if (refTo && refTo !== u.name) x.later(telegramUser(x, refTo, '🌱 ' + esc(u.name) + ' vừa thêm khách hỏi ' + esc(String(d.name || '').trim() || phone) + ' – ' + phone + ', do khách bạn phụ trách ' + esc(refName || refPhone) + ' giới thiệu → khách giao cho bạn. Gọi ngay nhé: ' + CRM_URL + '/#tiem-nang').catch(() => {}));
  if (!d.id) {
    const res = await addLead(x, { name: String(d.name || '').trim(), phone, channel: d.channel, interest: d.interest, owner: d.owner === undefined ? u.name : d.owner, note: d.note, callback: d.callback, by: u.name, refPhone, refName, how: d.how });
    await crmLog(x, u, 'Thêm tiềm năng', phone, d.name, d.channel || '', [d.interest || '', refPhone || refName ? '🎁 ' + (refName || '') + (refPhone ? ' ' + refPhone : '') + ' giới thiệu' : '', d.how ? '🙋 biết qua: ' + String(d.how).slice(0, 160) : ''].filter(String).join(' · '));
    return { ok: true, id: res.id, merged: res.merged, refTo };
  }
  const f = { name: String(d.name || '').trim(), phone, channel: d.channel || 'Khác', interest: d.interest || '', owner: d.owner || '', note: d.note || '', callback: dateOrBlank(d.callback) };
  if (d.refPhone !== undefined) { f.ref_phone = refPhone; f.ref_name = refName; }
  if (d.how !== undefined) f.how = String(d.how || '').trim().slice(0, 160); // 🙋 khách biết sale qua đâu
  if (d.status && LEAD_STATUS.indexOf(d.status) >= 0) f.status = d.status;
  if (f.status === 'Đã chốt' && u.level < 2) { // sale không tự đặt "Đã chốt" khi chưa có đơn (tỷ lệ chốt, thi đua công bằng – 16/10/2026)
    const ld1 = await leadGet(x, d.id);
    if (ld1 && ld1.status !== 'Đã chốt' && !ld1.order_id) return { ok: false, error: 'Muốn chuyển “Đã chốt” thì bấm 🛒 Chốt đơn và lưu đơn cho khách, khách tự chuyển sang Đã chốt.' };
  }
  if (d.reason !== undefined) f.reason = d.reason;
  if (!await leadUpdate(x, d.id, f)) return { ok: false, error: 'Không tìm thấy khách tiềm năng.' };
  return { ok: true, id: d.id, refTo };
}
async function crmLeadContact(x, u, d) {
  const ld = await leadGet(x, d.id); if (!ld) return { ok: false, error: 'Không tìm thấy khách tiềm năng.' };
  const gErr = await guardLead(x, u, ld); if (gErr) return { ok: false, error: gErr };
  const st = LEAD_STATUS.indexOf(d.status) >= 0 ? d.status : (ld.status === 'Mới hỏi' ? 'Đang tư vấn' : ld.status);
  if (st === 'Không mua' && !String(d.reason || '').trim()) return { ok: false, error: 'Ghi lý do khách không mua giúp em nhé.' };
  const now = Date.now(), f = { status: st, last_at: now, callback: st === 'Không mua' ? null : dateOrBlank(d.callback) };
  if (!ld.owner) f.owner = u.name;
  if (st === 'Không mua') f.reason = String(d.reason).trim();
  const note = String(d.note || '').trim();
  if (note) f.note = String(ld.note || '') + '\n[' + fmtDate(now, 'dd/MM') + ' ' + u.name + '] ' + note;
  await leadUpdate(x, d.id, f);
  await wbSafe(() => wbQueue(x, f.owner || ld.owner, normPhone(ld.phone), ld.name, [note || WB_SHORT[d.result] || d.result || st, st === 'Không mua' && d.reason ? 'không mua: ' + d.reason : ''].filter(String).join(', ') + cbTxt(st === 'Không mua' ? '' : d.callback)));
  await crmLog(x, u, 'Tư vấn', ld.phone, ld.name, d.result || st, [note, st === 'Không mua' ? 'Lý do: ' + d.reason : '', d.callback ? 'hẹn ' + String(d.callback).split('-').reverse().join('/') : ''].filter(String).join(' – '));
  return { ok: true, status: st, at: now, owner: f.owner || ld.owner };
}

/* ================================================================ Viettel Post Webhook */
const VTP_ALERT = { 502: 'Chuyển hoàn', 503: 'Huỷ theo yêu cầu', 505: 'Sắp chuyển hoàn', 506: 'Khách vắng nhà / không liên lạc được', 507: 'Khách hẹn đến bưu cục nhận', 515: 'Bưu cục duyệt hoàn' };
const VTP_BOT = { name: 'Viettel Post (tự động)', email: '', level: 3, role: 'Hệ thống' };

function vtpDate(s) {
  const m = String(s || '').match(/(\d{1,2})\/(\d{1,2})\/(\d{4})\s+(\d{1,2}):(\d{2})(?::(\d{2}))?/);
  if (!m) return null;
  return Date.UTC(+m[3], +m[2] - 1, +m[1], +m[4] - 7, +m[5], +(m[6] || 0));
}

function vtpPlace(s) {
  const p = String(s || '').split(/\s*,\s*/).filter(Boolean);
  if (!p.length) return '';
  const x = p.find(t => /bưu cục|buu cuc|kho|trung tâm|điểm|bưu điện/i.test(t)) || p[2] || p[0];
  return String(x).slice(0, 80);
}

export async function vtpWebhook(x, raw) {
  await ensureSchema(x.db);
  let d;
  try { d = typeof raw === 'string' ? JSON.parse(raw) : raw; } catch (e) { return { ok: false, error: 'Dữ liệu không đọc được' }; }
  let secret = x.env.VTP_SECRET || (await kvGet(x.db, 'vtp_secret')) || '';
  if (!secret) {
    try {
      const p = (await bridge(x.env, 'props')).props;
      if (p && p.VTP_SECRET) { secret = p.VTP_SECRET; await kvSet(x.db, 'vtp_secret', secret, 86400e3); }
    } catch (e) { }
  }
  if (!secret || String(d && d.TOKEN || '') !== secret) {
    return { ok: false, denied: true, error: secret ? 'Sai mã bí mật' : 'Chưa cài VTP_SECRET' };
  }
  const D = d.DATA || {}, code = String(D.ORDER_NUMBER || '').trim().toUpperCase(), st = Number(D.ORDER_STATUS) || 0;
  if (!code) return { ok: true, skip: 'Không có mã vận đơn' };
  const ref = String(D.ORDER_REFERENCE || '').trim().toUpperCase();

  // tìm nhanh theo chỉ mục trước; không thấy mới quét cả bảng đơn (quét mỗi tin báo VTP tốn hạn mức đọc)
  let candidates = await all(x.db, "SELECT * FROM orders WHERE tracking IN (?1, '''' || ?1) OR id = ?1 OR (?2 != '' AND id = ?2) ORDER BY time DESC LIMIT 20", code, ref);
  if (!candidates.length) candidates = await all(x.db, 'SELECT * FROM orders WHERE upper(trim(tracking)) = ?1 OR upper(trim(id)) = ?1 OR (?2 != "" AND upper(trim(id)) = ?2) ORDER BY time DESC LIMIT 20', code, ref);
  if (!candidates.length && /^TDL\d/.test(ref)) candidates = await all(x.db, 'SELECT * FROM orders WHERE note LIKE ?1 ORDER BY time DESC LIMIT 5', '%Mã web ' + ref + '%'); // đơn web đã đổi sang mã sale gõ trong file
  const U = v => String(v || '').replace(/^'/, '').trim().toUpperCase();
  let best = null;
  for (const o of candidates) {
    const hitT = U(o.tracking) === code;
    const hitI = U(o.id) === code || (ref && (U(o.id) === ref || String(o.note || '').indexOf('Mã web ' + ref) >= 0));
    if (!hitT && !hitI) continue;
    const sc = (hitT ? 4 : 0) + (/^(Mới|Đã xác nhận|Đang giao)$/.test(String(o.status || '')) ? 2 : 0);
    const tm = Number(o.time) || 0;
    if (!best || sc > best.sc || (sc === best.sc && tm > best.tm)) best = { sc, tm, order: o, byRef: !hitT };
  }
  if (!best) return { ok: true, skip: 'Không có đơn nào mang mã ' + code + (ref ? ' / ' + ref : '') };
  const o = best.order;
  if (best.byRef && !o.tracking) {
    await run(x.db, 'UPDATE orders SET tracking = ? WHERE rid = ?', code, o.rid);
    o.tracking = code;
  }
  const at = vtpDate(D.ORDER_STATUSDATE) || Date.now();
  if (o.trk_at && at < o.trk_at) return { ok: true, skip: 'Tin cũ hơn tin đã có' };
  const prevCode = Number(o.trk_code) || 0;
  const old = String(o.status || 'Mới'), returning = D.IS_RETURNING === true;
  if (st === prevCode && (old === 'Đã giao' || isVoid(old))) return { ok: true, skip: 'Đơn đã xong, trạng thái vận chuyển không đổi' }; // đơn đã giao / huỷ / hoàn: không ghi lại
  const label = String(D.STATUS_NAME || VTP_ALERT[st] || ('Trạng thái ' + st)).trim();
  const place = vtpPlace(D.LOCATION_CURRENTLY || D.LOCALION_CURRENTLY);
  const note = String(D.NOTE || '').trim();
  const line = (fmtDate(at, 'dd/MM HH:mm') + ' · ' + (returning && st !== 504 ? '↩️ Đang hoàn · ' : '') + label + (place ? ' · ' + place : '') + (note && note !== label ? ' · ' + note : '')).slice(0, 300);

  await run(x.db, "UPDATE orders SET trk = ?, trk_at = ?, trk_code = ?, carrier = CASE WHEN carrier LIKE '%viettel%' THEN carrier ELSE 'Viettel Post' END WHERE rid = ?", line, at, st, o.rid);

  // 05/11/2026 (anh Sơn): hãng báo chuyển hoàn / đã trả hàng → Đang chuyển hoàn; chỉ khi kho nhận đủ hàng mới bấm Hoàn trên CRM
  const to = st === 501 ? (/^(Mới|Đã xác nhận|Đang giao)$/.test(old) ? 'Đã giao' : '')
           : st === 502 || st === 504 || st === 515 ? (isVoid(old) ? '' : 'Đang chuyển hoàn')
           : st >= 200 && /^(Mới|Đã xác nhận)$/.test(old) && st !== 201 && st !== 503 ? 'Đang giao' : '';
  let res = { ok: true };
  if (to) {
    res = await crmOrderStatus(x, VTP_BOT, { id: o.id, row: o.rid, status: to, reason: label });
  }
  const warn = st !== prevCode && (VTP_ALERT[st] || st === 504);
  if (!to && warn) await crmLog(x, VTP_BOT, 'Đơn hàng', o.id, o.name, label, note);
  if (warn) {
    const msg = '🚚 <b>Viettel Post</b> · ' + esc(code) +
      '\n👤 <b>' + esc(o.name) + '</b> (' + esc(o.id) + ')' +
      '\n⚠️ ' + esc(label) + (to ? ' → đơn chuyển sang <b>' + esc(to) + '</b>' : '') + (st === 504 ? '\n📦 Hãng báo đã trả hàng – kho kiểm đủ hàng thì bấm <b>Kho đã nhận</b>' : '') +
      (note ? '\n📝 ' + esc(note) : '') +
      (place ? '\n📍 ' + esc(place) : '') +
      (o.seller ? '\n👤 NV bán: ' + esc(o.seller) : '') +
      '\n👉 ' + (st === 504 ? 'Xem đơn' : 'Gọi khách giữ đơn') + ': ' + CRM_URL + '/#don-hang';
    x.later(telegram(x.env, msg));
    if (o.seller) x.later(telegramUser(x, o.seller, msg));
  }
  return { ok: true, id: o.id, status: (res && res.status) || to || old };
}

/* ================================================================ Đo tốc độ CRM (perf) */
async function crmPerf(x, u, d) {
  const sec = v => v === null || v === undefined || v === '' || isNaN(v) ? null : Math.round(Number(v) / 100) / 10;
  const rows = (Array.isArray(d.rows) ? d.rows : []).slice(-60).map(r => {
    r = Array.isArray(r) ? r : [];
    return {
      time: Number(r[0]) || Date.now(),
      by_name: u.name,
      role: u.role,
      what: String(r[1] || '').slice(0, 40),
      total: sec(r[2]),
      server: sec(r[3]),
      data: String(r[4] || '').slice(0, 40),
      kb: Number(r[5]) || 0,
      dev: String(d.dev || '').slice(0, 80)
    };
  });
  if (!rows.length) return { ok: true };
  await insertMany(x.db, 'perf', ['time', 'by_name', 'role', 'what', 'total', 'server', 'data', 'kb', 'dev'], rows);
  const cnt = (await first(x.db, 'SELECT coalesce(max(rid) - min(rid) + 1, 0) AS n FROM perf')).n; // không dùng count(*): đếm là đọc hết bảng
  if (cnt > 3000) await run(x.db, 'DELETE FROM perf WHERE rid IN (SELECT rid FROM perf ORDER BY rid ASC LIMIT ?)', cnt - 2000);
  return { ok: true };
}

/* ================================================================ Mức độ dùng CRM (usage) */
async function crmUsage(x, u, d) {
  const opens = Math.min(50, Math.max(0, Math.round(Number(d.opens) || 0)));
  const mins = Math.min(60, Math.max(0, Number(d.mins) || 0));
  const scr = (Array.isArray(d.screens) ? d.screens : []).map(s => String(s).slice(0, 30)).filter(Boolean).slice(0, 20);
  const dev = String(d.dev || '').slice(0, 40);
  if (!opens && !mins && !scr.length) return { ok: true };
  const now = Date.now(), key = fmtDate(now, 'yyyy-MM-dd');
  const cur = await first(x.db, 'SELECT * FROM usage WHERE day = ? AND email = ?', key, u.email);
  const join = (old, add) => {
    const a = String(old || '').split(', ').filter(Boolean);
    add.forEach(item => { if (item && a.indexOf(item) < 0) a.push(item); });
    return a.join(', ');
  };
  if (!cur) {
    await run(x.db, 'INSERT INTO usage (day, email, name, opens, mins, screens, dev, first_time, last_time) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)',
      key, u.email, u.name, opens, Math.round(mins * 10) / 10, scr.join(', '), dev, now, now);
  } else {
    await run(x.db, 'UPDATE usage SET opens = opens + ?, mins = round((mins + ?) * 10) / 10, screens = ?, dev = ?, last_time = ? WHERE rid = ?',
      opens, mins, join(cur.screens, scr), join(cur.dev, dev ? [dev] : []), now, cur.rid);
  }
  return { ok: true };
}

const USE_CARE = { 'Tư vấn': 1, 'Trả lời liên hệ': 1, 'Ghi nhanh': 1 };
Object.keys(TASK_LABEL).forEach(k => { USE_CARE[TASK_LABEL[k]] = 1; });
const USE_ORDER = { 'Tạo đơn': 1, 'Sửa đơn': 1, 'Đơn hàng': 1, 'Loại đơn': 1 };
function useKind(what) { return USE_CARE[what] ? 'care' : USE_ORDER[what] ? 'order' : what === 'Gửi ưu đãi' || what === 'Gửi lời chúc' ? 'promo' : 'other'; }
const USE_MILES = [['login', 'Đăng nhập lần đầu'], ['tg', 'Kết nối Telegram'], ['care', 'Ghi chăm sóc đầu tiên'], ['promo', 'Gửi ưu đãi Zalo'], ['order', 'Tạo đơn đầu tiên'], ['steady', 'Dùng đều 5/7 ngày']];
const USE_IDLE_DAYS = 2;

export async function usageData(x, days) {
  days = [7, 14, 30].indexOf(Number(days)) >= 0 ? Number(days) : 7;
  const today = startOfDay(Date.now()), from = today - (days - 1) * DAY, w7 = today - 6 * DAY;
  const users = (await crmUsers(x)).filter(u => u.active), P = {};
  users.forEach(u => {
    P[u.name] = { name: u.name, email: u.email, role: u.role, level: u.level, tg: !!u.tg, first: null, lastSeen: null, lastAct: null, opens: 0, mins: 0, actions: 0, acts: { care: 0, order: 0, promo: 0, other: 0 }, day: {}, act7: {}, miles: {}, screens: {}, dev: '' };
  });
  const byEmail = {}; users.forEach(u => { byEmail[u.email.toLowerCase()] = P[u.name]; });
  const dayOf = (p, k) => p.day[k] || (p.day[k] = { opens: 0, mins: 0, actions: 0, care: 0, seen: false });
  const seen = (p, t) => {
    if (!t) return;
    if (!p.first || t < p.first) p.first = t;
    if (!p.lastSeen || t > p.lastSeen) p.lastSeen = t;
    const k = fmtDate(t, 'yyyy-MM-dd');
    if (t >= w7) p.act7[k] = 1;
    if (t >= from) dayOf(p, k).seen = true;
  };

  for (const r of await all(x.db, 'SELECT * FROM usage WHERE last_time >= ? OR first_time >= ?', from - 30 * DAY, from - 30 * DAY)) {
    const p = byEmail[String(r.email || '').trim().toLowerCase()]; if (!p) continue;
    const k = r.day, t0 = r.first_time, t1 = r.last_time;
    seen(p, t0); seen(p, t1);
    if (r.dev && t1 >= from) p.dev = String(r.dev).split(', ').pop();
    if (!t1 || t1 < from) continue;
    const dd = dayOf(p, k);
    dd.opens += Number(r.opens) || 0; dd.mins += Number(r.mins) || 0;
    p.opens += Number(r.opens) || 0; p.mins += Number(r.mins) || 0;
    String(r.screens || '').split(', ').filter(Boolean).forEach(s => { p.screens[s] = (p.screens[s] || 0) + 1; });
  }

  for (const r of await all(x.db, 'SELECT time, by_name FROM perf WHERE time >= ?', from - 30 * DAY)) {
    const p = P[r.by_name]; if (p) seen(p, r.time);
  }

  for (const r of await all(x.db, 'SELECT time, by_name, what FROM logs WHERE time >= ?', from - 60 * DAY)) {
    const p = P[r.by_name], t = r.time; if (!p || !t) continue;
    seen(p, t);
    if (!p.lastAct || t > p.lastAct) p.lastAct = t;
    const kd = useKind(r.what);
    if (kd !== 'other' && !p.miles[kd]) p.miles[kd] = t;
    if (t < from) continue;
    p.actions++; p.acts[kd]++;
    const dd = dayOf(p, fmtDate(t, 'yyyy-MM-dd'));
    dd.actions++; if (kd === 'care') dd.care++;
  }

  const out = users.map(u => {
    const p = P[u.name], series = [];
    for (let t = from; t <= today; t += DAY) {
      const k = fmtDate(t + 12 * 3600e3, 'yyyy-MM-dd'), dd = p.day[k] || {};
      series.push({ day: k, opens: dd.opens || 0, mins: Math.round((dd.mins || 0) * 10) / 10, actions: dd.actions || 0, care: dd.care || 0, seen: !!dd.seen });
    }
    const n7 = Object.keys(p.act7).length;
    p.miles.login = p.first; p.miles.tg = p.tg ? true : null; p.miles.steady = n7 >= 5 ? true : null;
    return {
      name: p.name, email: p.email, role: p.role, level: p.level, tg: p.tg, lastSeen: p.lastSeen, lastAct: p.lastAct,
      activeDays: series.filter(s => s.seen).length, days7: n7, opens: p.opens, mins: Math.round(p.mins), actions: p.actions,
      acts: p.acts, dev: p.dev, screens: p.screens, series,
      miles: USE_MILES.map(m => { const v = p.miles[m[0]]; return { k: m[0], label: m[1], done: !!v, at: typeof v === 'number' ? v : null }; })
    };
  });

  return { days, from, today, since: '2026-10-07', people: out };
}

async function crmUsageReport(x, u, d) {
  if (u.level < 3) return { ok: false, error: 'Chỉ Quản trị xem được mức độ dùng CRM.' };
  const r = await usageData(x, d.days);
  r.ok = true;
  return r;
}

export async function usageAlert(x) {
  const now = Date.now(), vn = new Date(now + 7 * 3600e3);
  const monday = vn.getUTCDay() === 1;
  const r = await usageData(x, 7), today = r.today;
  const staff = r.people.filter(p => p.level >= 1 && p.level < 3); // không tính Quản trị, Marketing
  if (!staff.length) return;
  const ago = t => t ? Math.round((today - startOfDay(t)) / DAY) : null;
  const idle = staff.filter(p => { const a = ago(p.lastSeen); return a === null || a >= USE_IDLE_DAYS; });
  let msg = '';
  if (idle.length) {
    msg += '⚠️ <b>Nhân sự chưa vào CRM</b>\n' + idle.map(p => {
      const a = ago(p.lastSeen);
      return '• ' + esc(p.name) + ' – ' + (a === null ? 'chưa từng đăng nhập' : a + ' ngày (lần cuối ' + fmtDate(p.lastSeen, 'dd/MM HH:mm') + ')');
    }).join('\n') + '\n👉 Gọi hỏi thăm xem bạn có vướng gì không.';
  }
  if (monday) {
    msg += (msg ? '\n\n' : '') + '📈 <b>Mức dùng CRM 7 ngày qua</b>\n' + staff.map(p => {
      const miss = p.miles.filter(m => !m.done).map(m => m.label);
      return '• <b>' + esc(p.name) + '</b>: vào ' + p.activeDays + '/7 ngày · ' + p.mins + ' phút · ' + p.actions + ' thao tác (chăm sóc ' + p.acts.care + ', đơn ' + p.acts.order + ', ưu đãi ' + p.acts.promo + ')' + (miss.length ? '\n   Chưa: ' + miss.join(', ') : '\n   ✅ Đã qua đủ các mốc');
    }).join('\n');
  }
  if (!msg) return;
  msg += '\n\nChi tiết: ' + CRM_URL + '/#bao-cao → 📈 Mức dùng CRM';
  const ad = (await crmUsers(x)).find(u => u.role === 'Quản trị' && u.tg);
  if (ad && ad.tg) await telegramTo(x.env, ad.tg, msg);
  else await telegram(x.env, msg);
}

/* ================================================================ Góp ý (Feedback) */
const FB_STATUS = ['Mới', 'Đang làm', 'Đã xong', 'Không làm'];

async function crmFeedback(x, u, d) {
  const text = String(d.text || '').trim().slice(0, 5000);
  const imgs = (Array.isArray(d.images) ? d.images : []).slice(0, 3);
  if (!text && !imgs.length) return { ok: false, error: 'Bạn gõ vài chữ hoặc gửi kèm ảnh giúp nhé.' };
  const now = Date.now(), id = 'GY' + fmtDate(now, 'yyMMddHHmmss');
  const imgIdxs = [];
  for (let i = 0; i < imgs.length; i++) {
    const b64 = imgs[i];
    if (typeof b64 === 'string' && b64.startsWith('data:image/')) {
      await run(x.db, 'INSERT INTO feedback_images (id, idx, data) VALUES (?, ?, ?)', id, i, b64);
      imgIdxs.push(i);
    }
  }
  await run(x.db, 'INSERT INTO feedback (id, time, by_name, email, kind, text, route, ua, ver, imgs, status, reply, handler, updated) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
    id, now, u.name, u.email, String(d.kind || 'Góp ý'), text, String(d.route || ''), String(d.ua || '').slice(0, 300), String(d.ver || ''), JSON.stringify(imgIdxs), 'Mới', '', '', now);
  
  const cap = '💡 <b>GÓP Ý CRM</b> – ' + esc(d.kind || 'Góp ý') + '\n👤 ' + esc(u.name) + ' · ' + esc(d.route || '') + '\n\n' + esc(text.slice(0, 800)) + (imgs.length > 1 ? '\n\n(' + imgs.length + ' ảnh, xem đủ trong CRM → 💡 Góp ý)' : '') + '\n\n👉 ' + CRM_URL;
  x.later((async () => { // như bản Apps Script: gửi riêng Telegram của Quản trị chính (chưa kết nối thì nhóm đầu tiên), kèm ảnh đầu tiên
    const ad = (await crmUsers(x)).find(y => y.email === SUPER_ADMIN), chat = ad && ad.tg ? ad.tg : String((await tgConf(x.env)).chats || '').split(',')[0].trim();
    const img = imgs.find(b => typeof b === 'string' && b.startsWith('data:image/'));
    if (img) await telegramPhoto(x.env, chat, img, cap); else await telegramTo(x.env, chat, cap);
  })());
  return { ok: true, id };
}

async function crmFbList(x, u) {
  let rows = await all(x.db, 'SELECT * FROM feedback ORDER BY time DESC LIMIT 200');
  if (u.level < 2) rows = rows.filter(r => r.email === u.email);
  const items = rows.map(r => {
    let imgs = [];
    try { imgs = JSON.parse(r.imgs || '[]'); } catch (e) { }
    return {
      id: r.id, time: r.time, by: r.by_name, email: r.email, kind: r.kind, text: r.text,
      route: r.route, ua: r.ua, ver: r.ver, imgs, imgNote: '', status: r.status || 'Mới',
      reply: r.reply || '', handler: r.handler || '', updated: r.updated
    };
  });
  return { ok: true, items, statuses: FB_STATUS };
}

async function crmFbImg(x, u, d) {
  const it = await first(x.db, 'SELECT * FROM feedback WHERE id = ?', String(d.id));
  if (!it) return { ok: false, error: 'Không tìm thấy góp ý.' };
  if (u.level < 2 && it.email !== u.email) return { ok: false, error: 'Bạn không xem được góp ý này.' };
  const row = await first(x.db, 'SELECT data FROM feedback_images WHERE id = ? AND idx = ?', String(d.id), Number(d.i) || 0);
  if (!row) return { ok: false, error: 'Không có ảnh.' };
  return { ok: true, src: row.data };
}

async function crmFbUpdate(x, u, d) {
  if (u.level < 2) return { ok: false, error: 'Chỉ quản lý cập nhật được góp ý.' };
  const it = await first(x.db, 'SELECT * FROM feedback WHERE id = ?', String(d.id));
  if (!it) return { ok: false, error: 'Không tìm thấy góp ý.' };
  const st = FB_STATUS.indexOf(d.status) >= 0 ? d.status : it.status;
  const reply = String(d.reply == null ? it.reply : d.reply).slice(0, 3000);
  const now = Date.now();
  await run(x.db, 'UPDATE feedback SET status = ?, reply = ?, handler = ?, updated = ? WHERE id = ?', st, reply, u.name, now, it.id);
  if (st !== it.status || reply !== it.reply) {
    x.later(telegramUser(x, it.by_name, '💡 Góp ý của bạn (' + esc(it.text.slice(0, 60)) + '…) → <b>' + esc(st) + '</b>' + (reply ? '\n💬 ' + esc(u.name) + ': ' + esc(reply) : '') + '\n\nCảm ơn bạn đã góp ý! 🙏'));
  }
  return { ok: true };
}

/* ================================================================ điều phối */
/** Việc tài khoản Marketing được làm: xem tab Marketing, nhập chi phí (file / nhập tay), góp ý, Telegram, cài đặt màu, đo tốc độ. Mọi việc khác máy chủ từ chối. */
// Tài khoản Kho (09/11/2026): ngoài các lệnh kho_* chỉ được những lệnh chung này
const KHO_ROLE_OK = { load: 1, logout: 1, guide_ask: 1, prefs: 1, tg_link: 1, tg_check: 1, tg_off: 1, perf: 1, usage: 1, feedback: 1, fb_list: 1, fb_img: 1 };
const RET_FROM = ['Đang chuyển hoàn', 'Đang giao', 'Đã giao', 'Đổi hàng']; // kho nhận được hàng hoàn từ các trạng thái này
/** ↩ Kho nhận hàng hoàn (09/11/2026, anh Sơn tách quyền Kho): đơn → Hoàn, ghi 1 dòng vào ghi chú đơn (đủ hàng / thiếu, hỏng gì),
 *  báo Telegram sale bán + người phụ trách khách (gọi hỏi lý do, giữ khách); thiếu / hỏng → báo thêm Quản lý, Quản trị. Trả lại số liệu tab Kho. */
async function crmKhoRecv(x, u, d) {
  if (!(u.level >= 2 || u.kho)) return { ok: false, error: 'Chỉ người phụ trách kho, Quản lý, Quản trị ghi được hàng hoàn về kho.' };
  const o = await orderFind(x, { id: d.id, row: d.row }); if (!o) return { ok: false, error: 'Không tìm thấy đơn ' + (d.id || '') };
  const old = String(o.status || '');
  if (old === 'Hoàn') return { ok: false, error: 'Đơn ' + o.id + ' đã ghi hoàn về kho rồi.' };
  if (RET_FROM.indexOf(old) < 0) return { ok: false, error: 'Đơn ' + o.id + ' đang ở trạng thái “' + old + '” (chưa gửi đi hoặc đã huỷ) nên không nhận hoàn được. Báo sale / quản lý kiểm tra.' };
  const ok = d.ok !== false, note = String(d.note || '').replace(/\s+/g, ' ').trim().slice(0, 300);
  if (!ok && !note) return { ok: false, error: 'Ghi rõ thiếu hoặc hỏng gì (vd: thiếu 1 hộp Curcumin, 1 hộp móp).' };
  const line = '📦 Kho nhận hoàn ' + fmtDate(Date.now(), 'dd/MM HH:mm') + ' (' + u.name + '): ' + (ok ? 'đủ hàng, còn nguyên' : '⚠️ ' + note) + (ok && note ? ' · ' + note : '');
  const r = await crmOrderStatus(x, u, { id: o.id, row: o.rid, status: 'Hoàn', note: (o.note ? o.note + '\n' : '') + line, reason: ok ? 'Kho nhận đủ hàng' + (note ? ': ' + note : '') : 'Kho nhận thiếu / hỏng: ' + note }, true);
  if (!r.ok) return r;
  try {
    const ow = await ownerOf(x, o.phone), msg = '📦 <b>Kho đã nhận hàng hoàn</b>\nĐơn <b>' + esc(o.id) + '</b> · ' + esc(o.name) + (old !== 'Đang chuyển hoàn' ? ' (CRM đang ghi ' + esc(old) + ')' : '') + '\n' + esc(String(o.items || '').split('\n').slice(0, 4).join(', ')) +
      '\n' + (ok ? '✅ Đủ hàng, còn nguyên' : '⚠️ ' + esc(note)) + '\n👉 Gọi hỏi khách lý do không nhận hàng để giữ khách.\n' + CRM_URL;
    const to = [...new Set([o.seller, ow].filter(n => n && n !== u.name))];
    for (const n of to) await telegramUser(x, n, msg);
    if (!ok) for (const m of await crmUsers(x)) if (m.active && m.tg && m.level >= 2 && m.name !== u.name && to.indexOf(m.name) < 0) await telegramTo(x.env, m.tg, msg);
  } catch (e) { console.error('khoRecv tg', e.message); }
  const k = await crmKho(x, u, { action: 'kho_load' }, crmLog);
  return Object.assign(k, { done: o.id });
}
/** 🔍 Kho tìm đơn theo mã đơn / mã vận đơn / 4+ số cuối SĐT / tên (hàng hoàn về mà CRM chưa báo hoàn). 180 ngày, đơn đã gửi đi. */
async function crmKhoFind(x, u, d) {
  if (!(u.level >= 2 || u.kho)) return { ok: false, error: 'Bạn không có quyền làm việc này.' };
  const q = String(d.q || '').trim().slice(0, 60), dg = q.replace(/\D/g, '');
  if (q.length < 3) return { ok: false, error: 'Gõ ít nhất 3 chữ / số.' };
  const like = '%' + q.replace(/[%_]/g, '') + '%';
  const rows = await all(x.db, "SELECT rid, id, time, name, phone, items, status, carrier, tracking, seller, trk, upd, note FROM orders WHERE time > ? AND status IN ('Đang chuyển hoàn', 'Đang giao', 'Đã giao', 'Đổi hàng', 'Hoàn') AND (id LIKE ? OR tracking LIKE ? OR name LIKE ? OR (? <> '' AND phone LIKE ?)) ORDER BY time DESC LIMIT 15",
    Date.now() - 180 * DAY, like, like, like, dg.length >= 4 ? dg : '', '%' + dg);
  return { ok: true, list: rows.map(khoRetOut) };
}
const MKT_ACTIONS = { guide_ask: 1, link_list: 1, link_save: 1, link_active: 1, load: 1, mktv: 1, mkt_tg_test: 1, mkt_goal: 1, mkt_import: 1, mkt_add: 1, mkt_list: 1, mkt_kpi: 1, mkt_fb_edit: 1, quiz_cms: 1, mkt_del: 1, prefs: 1, tg_link: 1, tg_check: 1, tg_off: 1, perf: 1, usage: 1, feedback: 1, fb_list: 1, fb_img: 1, offers: 1, offer_save: 1, offer_del: 1, wall_hide: 1, zb_view: 1, zb_cfg: 1, zb_post: 1, zb_regen: 1, zb_send: 1, zb_cancel: 1, zb_recall: 1, zb_img: 1, zb_hist: 1, zb_logmore: 1, zb_done: 1, zb_time: 1, zb_plan_make: 1, zb_plan_set: 1, zb_plan_redo: 1, fp_view: 1, fp_page: 1, fp_resub: 1, fp_scan: 1, fp_post: 1, fp_now: 1, fp_regen: 1, fp_send: 1, fp_logmore: 1, fp_done: 1, bl_view: 1, bl_post: 1, bl_act: 1, bl_cfg: 1, bl_stats: 1, ins_view: 1, ins_save: 1, ins_video: 1, ins_vdel: 1, ins_merge: 1, ins_import: 1, ins_skill: 1, ins_skilldel: 1, ins_odel: 1, ins_find: 1, ins_offer: 1 };
export async function crmApi(x, d, sync, mgr) {
  await ensureSchema(x.db);
  const a = d.action;
  if (a === 'login') return crmLogin(x, d);
  if (a === 'verify') return crmVerify(x, d);
  const u = await crmSession(x, d.token);
  if (!u) return { ok: false, auth: true, error: 'Phiên đăng nhập đã hết. Vui lòng đăng nhập lại.' };
  x.user = u;
  if (a === 'logout') { await run(x.db, 'DELETE FROM sessions WHERE token = ?', d.token); return { ok: true }; }
  if (u.role === 'Marketing' && !MKT_ACTIONS[a]) return { ok: false, error: 'Tài khoản Marketing chỉ xem được phần quảng cáo.' };
  if (u.role === 'Kho' && !KHO_ROLE_OK[a] && !/^kho_/.test(a)) return { ok: false, error: 'Tài khoản Kho chỉ dùng được tab 📦 Kho.' };
  if (u.role === 'Kế toán' && ((!KT_ROLE_OK[a] && !/^kt_/.test(a)) || (a === 'settings' && !ktSettingsOk(d)))) return { ok: false, error: 'Tài khoản Kế toán chỉ dùng được tab 💼 Kế toán.' };
  if (a === 'kt_bl' || a === 'kt_badd' || a === 'kt_bpay' || a === 'kt_bdel') return crmKtBatch(x, u, d, crmLog); // 🧾 phiếu đối soát COD chờ tiền về (kt.js)
  if (a === 'kt_kho') return ktKho(x, u); // 📦 giá trị tồn kho cho kế toán (chỉ đọc)
  if (a === 'kt_cash' || a === 'kt_cfg' || a === 'kt_why') return crmKt(x, u, d, crmLog); // 💼 tiền về tài khoản, ngày bắt đầu theo dõi (kt.js)
  if (u.role === 'Kế toán' && a === 'settings') return crmSettings(x, u, d); // chỉ chi phí / bảng lương / giá vốn (ktSettingsOk)
  if (a === 'kho_recv' || a === 'kho_find') return a === 'kho_recv' ? crmKhoRecv(x, u, d) : crmKhoFind(x, u, d); // ↩ hàng hoàn về kho (09/11/2026)
  if (a === 'load') return crmLoad(x, u, d);
  if (a === 'guide_ask') return guideAsk(x, u, d); // ✨ Hỏi trợ lý An Lành trong trang hướng dẫn (guideask.js)
  if (a === 'guide_ask_list') return guideAskList(x, u, d); // câu nhân sự đã hỏi trợ lý (Quản lý trở lên)
  if (a === 'ai_usage') return aiUsage(x, u, d); // 🤖 mức dùng & chi phí AI theo mục (Quản trị, 10/11/2026, aiuse.js)
  if (a === 'ai_fund') return aiFund(x, u, d); // ghi số tiền đã nạp Anthropic → tính tiền còn lại, nhắc sắp hết
  if (a === 'ai_sum') return crmAi(x, u, d); // ✨ AI tóm tắt hồ sơ / gợi ý tin nhắn (chỉ khi có ANTHROPIC_API_KEY)
  if (/^mcp_/.test(a)) return crmMcp(x, u, d); // 🔌 kết nối ChatGPT / Gemini (mcp.js): xem, tạo Client ID, ngắt
  if (a === 'ai_ask') return crmAsk(x, u, d); // ✨ Hỏi số liệu: trợ lý AI tự tra số trong D1 (ask.js, ai dùng được: askAllowed)
  if (a === 'mktv') return u.level >= 3 || u.role === 'Marketing' || u.mkv ? mktView(x, u, d) : { ok: false, error: 'Chỉ Marketing, Quản trị và người được tích 📣 Xem Marketing xem được mục này.' };
  if (a === 'wall_hide') return wallHide(x, u, d); // 🌱 ẩn / hiện tên trên Bức tường Sống Lành (journey.js)
  if (a === 'quiz_cms') return quizCms(x, u, d); // 🖐 sửa trò chơi Bạn còn mấy ngón tay (cms.js)
  if (a === 'order_create') return crmOrderCreate(x, u, d);
  if (a === 'wb_order') return wbOrderInfo(x, u, d); // 📄 đơn đã ghi vào file lên đơn của sale chưa (wb.js)
  if (a === 'check_phone') return crmCheckPhone(x, u, d);
  if (a === 'cust_orders') return crmCustOrders(x, u, d);
  if (a === 'sales_all') return crmSalesAll(x, u);
  if (a === 'race') return crmRace(x, u);
  if (a === 'sale_mkt') return crmSaleMkt(x, u, d); // 📣 Từ quảng cáo ở tab Hiệu quả
  if (a === 'offers' || a === 'offer_save' || a === 'offer_del') return crmOffers(x, u, d); // ưu đãi đang chạy (Marketing ghi, sale đọc)
  if (sync[a]) { if (u.level < 3) return { ok: false, error: 'Chỉ Quản trị làm được việc này.' }; return sync[a](x, u, d); }
  if (mgr && mgr[a]) { if (u.level < 2) return { ok: false, error: 'Bạn không có quyền làm việc này.' }; return mgr[a](x, u, d); }
  if (a === 'tg_link') return crmTgLink(x, u);
  if (a === 'tg_check') return crmTgCheck(x, u, d);
  if (a === 'prefs') return crmPrefs(x, u, d);
  if (a === 'tg_off') { await userSet(x, u.email, 'tg', ''); return { ok: true }; }
  if (a === 'perf') return crmPerf(x, u, d);
  if (a === 'usage') return crmUsage(x, u, d);
  if (a === 'usage_report') return crmUsageReport(x, u, d);
  if (a === 'feedback') return crmFeedback(x, u, d);
  if (a === 'fb_list') return crmFbList(x, u);
  if (a === 'fb_img') return crmFbImg(x, u, d);
  if (a === 'fb_update') return crmFbUpdate(x, u, d);
  if (a === 'cms_pat') return cmsTokenSet(x, u, d); // Cài đặt → 🌐 Trang quản trị website: mã GitHub của công ty
  if (a === 'ga') return crmGa(x, u, d); // tab Tổng quan: số liệu Google Analytics
  if (a === 'ga_prop') return crmGaProp(x, u, d);
  if (a === 'cf_token') return crmCfToken(x, u, d); // Tổng quan → Website: dán mã API Cloudflare Web Analytics (lượt vào đủ 100%)
  if (a === 'mkt_tg_test') { // gửi thử tin 📣 Marketing 8h sáng cho chính mình
    if (u.role !== 'Marketing' && u.level < 3) return { ok: false, error: 'Chỉ Marketing và Quản trị.' };
    if (!u.tg) return { ok: false, error: 'Bạn chưa kết nối Telegram: vào Cài đặt → 📲 Thông báo Telegram riêng.' };
    const m = (await mktDailyMsgs(x, [u]))[0]; if (!m) return { ok: false, error: 'Chưa tạo được tin.' };
    await telegramTo(x.env, u.tg, m.text); return { ok: true };
  }
  if (a === 'mkt_goal') { // Quản trị: mọi kênh; Marketing: kênh mình phụ trách / chưa ai nhận
    if (u.level < 3 && u.role !== 'Marketing') return { ok: false, error: 'Chỉ Marketing và Quản trị đặt được mục tiêu marketing.' };
    const r = await mktGoalSet(x, u, d);
    for (const c of r.changes || []) await crmLog(x, u, 'Mục tiêu marketing', d.month, c[0], c[1] + ' → ' + c[2], '');
    return r;
  }
  if (a === 'mkt_budget') return u.level >= 3 ? mktBudgetSet(x, d) : { ok: false, error: 'Chỉ Quản trị đặt được ngân sách quảng cáo.' };
  if (a === 'mkt_fb_edit') { // ✏️ bật / tắt / đổi ngân sách quảng cáo Facebook ngay trong CRM (Quản trị + Marketing), ghi Nhật ký
    if (!(u.level >= 3 || u.role === 'Marketing')) return { ok: false, error: 'Chỉ Quản trị và Marketing sửa được quảng cáo.' };
    const r = await mktFbEdit(x, d);
    if (r.ok) await crmLog(x, u, 'Quảng cáo Facebook', '-', r.cp || '', r.log, '');
    return r;
  }
  if (/^mkt(_|$)/.test(a)) return crmMkt(x, u, d); // chi phí marketing
  if (/^san(_|$)/.test(a)) return crmSan(x, u, d); // doanh thu sàn TMĐT + mục tiêu theo mảng
  if (/^kho_/.test(a)) return crmKho(x, u, d, crmLog); // 📦 kho hàng: người tích Phụ trách kho, Quản lý, Quản trị (kho.js)
  if (a === 'merge_suggest') return crmMergeSuggest(x, u); // gộp khách nhiều số (Quản lý trở lên)
  if (a === 'merge_skip') return crmMergeSkip(x, u, d);
  if (a === 'merge') return crmMerge(x, u, d);
  if (/^zb_/.test(a)) return crmZbot(x, u, d, crmLog); // 🤖 Trợ lý Zalo An Lành (Quản lý, Quản trị, Marketing)
  if (/^bl_/.test(a)) return crmBlog(x, u, d); // 📰 Trợ lý viết bài web (Quản lý, Quản trị, người bật Sửa website)
  if (/^fp_/.test(a)) return crmFp(x, u, d, crmLog); // 📘 Trợ lý Fanpage (Quản lý, Quản trị, Marketing; kết nối: Quản trị)
  if (/^ins_/.test(a)) return crmIns(x, u, d, crmLog); // 🎯 Insight & nội dung: ngân hàng insight chung + 🎬 kịch bản video (insight.js)
  if (/^link_/.test(a)) return crmLinks(x, u, d, crmLog); // 📍 Link & mã QR (Marketing, Quản lý, Quản trị)
  if (/^voucher_/.test(a)) return crmVoucher(x, u, d, crmLog); // 🎟 Mã ưu đãi (Quản lý trở lên)
  if (/^ref_/.test(a) || /^partner_/.test(a)) { // 🎁 mã giới thiệu / quà cảm ơn / mốc thưởng (sale làm cho khách mình) · 🤝 CTV (Quản lý trở lên)
    if (a === 'ref_code' || a === 'ref_tier_done') { const g = await guardPhone(x, u, d.phone); if (g) return { ok: false, error: g }; }
    if (a === 'ref_gift' || a === 'ref_told') { const o = await first(x.db, 'SELECT ref_phone FROM orders WHERE id = ? ORDER BY rid LIMIT 1', String(d.id || '')); const g = o && o.ref_phone ? await guardPhone(x, u, o.ref_phone) : ''; if (g) return { ok: false, error: g }; }
    return crmPartner(x, u, d, crmLog, (await crmUsers(x)).map(z => z.name));
  }
  if (a === 'kt_fetch') return finOk(u) ? crmKtFetch(x, d) : { ok: false, error: 'Bạn không có quyền làm việc này.' };
  if (a === 'kt_link' || a === 'fin_save' || a === 'fin_test') return crmFin(x, u, d, a); // 💼 tài chính (05/11/2026)
  const need = { settings: 2, users: 3, assign: 2, bulk: 2, recv: 2 };
  if (need[a] && u.level < need[a]) return { ok: false, error: 'Bạn không có quyền làm việc này.' };
  const opKey = d.opId ? 'op_' + String(d.opId).slice(0, 40) : ''; // CRM gửi lại việc khi mạng chập chờn: việc đã làm rồi thì trả kết quả cũ, không ghi trùng
  if (opKey) { const done = await kvGet(x.db, opKey); if (done) return JSON.parse(done); }
  const h = { care: crmCare, customer: crmCustomer, order_status: crmOrderStatus, recon_apply: crmReconApply, contact: crmContact, settings: crmSettings, users: crmSaveUsers, order_edit: crmOrderEdit,
    lead_save: crmLeadSave, lead_contact: crmLeadContact, target: crmTarget, assign: crmAssign, bulk: crmBulk, recv: crmRecv, claim: crmClaim,
    order_delete: crmOrderDelete, customer_delete: crmCustomerDelete, lead_delete: crmLeadDelete, gift: crmGift, greet: crmGreet, stop: crmStop, own: crmOwn }[a];
  if (h) {
    const res = await h(x, u, d);
    if (opKey && res && res.ok) { await kvSet(x.db, opKey, JSON.stringify(res), 6 * 3600e3); if (Math.random() < 0.02) await run(x.db, "DELETE FROM kv WHERE k LIKE 'op\\_%' ESCAPE '\\' AND exp < ?", Date.now()); }
    return res;
  }
  return { ok: false, error: 'Không rõ thao tác: ' + a };
}

/** 📎 Tổng quan → Tải file kế toán bằng link Google Sheet (05/11/2026): trình duyệt không tự tải được từ Google (CORS) nên máy chủ tải bản .xlsx rồi gửi lại (base64).
 *  CRM đọc file ngay trên máy như khi chọn file. Chỉ Quản trị. Không gửi link → dùng link đã nối (kt_link). Không lưu file. */
async function crmKtFetch(x, d) {
  const link = d.link || ((await kvJson(x.db, 'kt_link', null)) || {}).link; if (!link) return { ok: false, error: 'Chưa nối link Google Sheet kế toán.' };
  const f = await fetchXlsx(link); if (f.error) return { ok: false, error: f.error };
  let bin = ''; for (let i = 0; i < f.buf.length; i += 0x8000) bin += String.fromCharCode.apply(null, f.buf.subarray(i, i + 0x8000));
  return { ok: true, b64: btoa(bin), name: f.name };
}
