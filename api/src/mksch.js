// 🕛 Thay đổi quảng cáo Facebook chỉ có hiệu lực lúc 0h (18/11/2026, quy tắc của anh Sơn).
// Chiến dịch ĐANG CHẠY (đã tiêu tiền): bật / tắt / đổi ngân sách trong CRM không áp ngay mà lưu lệnh chờ (bảng mk_sched),
// lịch chạy (cron.js, 10 phút / lần cả ngày lẫn đêm) áp lên Meta đúng 0h theo múi giờ của tài khoản quảng cáo, ghi Nhật ký, báo Telegram.
// Chiến dịch CHƯA TỪNG CHẠY (chưa tiêu đồng nào): áp ngay (anh Sơn chọn 18/11/2026).
// Rào an toàn:
//   - chỉ Quản trị + Marketing (kiểm ở crm.js trước khi gọi mkSchEdit);
//   - công tắc tổng ở Cài đặt (dash_cfg.sch.off): tắt = CRM không sửa quảng cáo nữa, lệnh chờ bị bỏ;
//   - tăng ngân sách tối đa 20% mỗi lần, mỗi chiến dịch 1 lệnh ngân sách / ngày (cả lệnh đã áp trong 24 giờ qua);
//   - không đụng chiến dịch đang học (chạy dưới 3 ngày);
//   - tắt cả chiến dịch luôn cần Quản trị duyệt 1 chạm (Marketing đặt → Telegram báo Quản trị → bấm Duyệt trong CRM; Quản trị tự đặt = bấm xác nhận 1 lần);
//   - xem / huỷ lệnh chờ trước 0h; quá 0h 30 phút chưa áp (hoặc chưa duyệt) thì bỏ, không áp muộn; lỗi thì báo rõ, không thử lại âm thầm.
// CHƯA có tự chạy theo luật (tự tắt / tự tăng không cần người): chỉ đề xuất + duyệt, đo 2 tuần rồi anh Sơn quyết.
// Sau này nếu CRM tạo chiến dịch / nhóm quảng cáo: đặt vị trí bằng ghim + bán kính (vd Hà Nội 100 km), không gõ tên tỉnh / thành.
import { all, first, run, kvJson, esc, fmtDate, DAY, CRM_URL } from './lib.js';

const WIN = 30 * 60e3; // áp trong 30 phút sau 0h; muộn hơn thì bỏ
const LEARN = 3 * DAY; // chiến dịch chạy dưới 3 ngày = đang học
const UP_MAX = 0.2; // tăng ngân sách tối đa 20% / lần
const FB_API = 'https://graph.facebook.com/v23.0/';
export const SCH_ST = { wait: 'Chờ 0h', approve: 'Chờ Quản trị duyệt', done: 'Đã áp', error: 'Lỗi', cancel: 'Đã huỷ', expired: 'Bỏ (quá hạn)' };

export async function mkSchSchema(db) {
  await run(db, `CREATE TABLE IF NOT EXISTS mk_sched (id INTEGER PRIMARY KEY AUTOINCREMENT, acc TEXT, camp_id TEXT, camp_n TEXT DEFAULT '', kind TEXT, obj_id TEXT, obj_n TEXT DEFAULT '',
    op TEXT, old_v INTEGER DEFAULT 0, new_v INTEGER DEFAULT 0, why TEXT DEFAULT '', by_name TEXT DEFAULT '', at INTEGER, due INTEGER, tz TEXT DEFAULT '',
    st TEXT DEFAULT 'wait', ok_by TEXT DEFAULT '', ok_at INTEGER, done_at INTEGER, err TEXT DEFAULT '')`); // lệnh sửa quảng cáo chờ áp lúc 0h (mksch.js)
  await run(db, 'CREATE INDEX IF NOT EXISTS mk_sched_st ON mk_sched(st, due)');
  await run(db, 'CREATE INDEX IF NOT EXISTS mk_sched_camp ON mk_sched(camp_id, at)');
}
const schOff = async x => !!(((await kvJson(x.db, 'dash_cfg', {})) || {}).sch || {}).off;
const vnd = n => Math.round(Number(n) || 0).toLocaleString('vi-VN') + 'đ';

/** Múi giờ tài khoản quảng cáo (giờ lệch so với UTC). Lấy từ danh sách tài khoản (fbAccounts), chưa có thì hỏi Facebook 1 lần, không được thì coi như giờ Việt Nam. */
async function tzOf(x, acc) {
  const c = (await kvJson(x.db, 'mkt_cfg', {})) || {}, fb = c.fb || {}, a = (fb.all || []).find(z => z.id === acc) || {};
  if (a.tz !== undefined && a.tz !== null && a.tz !== '') return [Number(a.tz), a.tzn || ''];
  if (fb.token) try {
    const j = await (await fetch(FB_API + acc + '?fields=timezone_offset_hours_utc,timezone_name&access_token=' + encodeURIComponent(fb.token))).json();
    if (j && j.timezone_offset_hours_utc !== undefined) return [Number(j.timezone_offset_hours_utc), String(j.timezone_name || '')];
  } catch (e) { }
  return [7, 'Asia/Ho_Chi_Minh (mặc định)'];
}
/** 0h kế tiếp theo múi giờ lệch h giờ → mili giây. */
export function nextMidnight(now, h) { const off = h * 3600e3, loc = now + off; return Math.floor(loc / DAY) * DAY + DAY - off; }
/** Chiến dịch đã từng chạy chưa: bắt đầu quá 9 ngày, hoặc có chi tiền trong ad_spend từ lúc bắt đầu. */
async function ranOf(x, cp) {
  const st = cp.start ? new Date(String(cp.start).replace(/([+-]\d\d)(\d\d)$/, '$1:$2')).getTime() : 0;
  if (st && Date.now() - st > 9 * DAY) return true;
  const from = fmtDate(st && !isNaN(st) ? st - DAY : Date.now() - 30 * DAY, 'yyyy-MM-dd');
  return !!(await first(x.db, "SELECT 1 FROM ad_spend WHERE day >= ? AND channel = 'Facebook' AND account = ? AND campaign = ? AND spend > 0 LIMIT 1", from, cp.acc, cp.n));
}
const ageOf = cp => { const t = cp.start ? new Date(String(cp.start).replace(/([+-]\d\d)(\d\d)$/, '$1:$2')).getTime() : 0; return t && !isNaN(t) ? Date.now() - t : 0; };
const opTxt = r => r.op === 'budget' ? 'Ngân sách ' + vnd(r.old_v) + ' → ' + vnd(r.new_v) + ' / ngày' : r.op === 'pause' ? 'Tắt' : 'Bật lại';
const kindTxt = k => k === 'campaign' ? 'chiến dịch' : k === 'adset' ? 'nhóm quảng cáo' : 'quảng cáo';
async function tgRoles(x, crmUsers, telegramUser, roles, text, also) {
  const names = new Set((await crmUsers(x)).filter(y => y.active && roles.indexOf(y.role) >= 0).map(y => y.name).concat(also || []));
  for (const n of names) await telegramUser(x, n, text);
}

/** mkt_fb_edit (thay bản áp ngay cũ): d = { kind, id, op, amount, force, why }. → { ok, sched, now, log, due, st } */
export async function mkSchEdit(x, u, d, H) {
  if (await schOff(x)) return { ok: false, error: 'Quản trị đang TẮT sửa quảng cáo từ CRM (⚙️ Cài đặt → 🕛 Hẹn giờ thay đổi quảng cáo). Sửa trong Trình quản lý quảng cáo nếu thật cần.' };
  const pre = await H.mktFbEdit(x, Object.assign({}, d, { dry: 1 })); if (!pre.ok) return pre;
  const cp = pre.cpObj, why = String(d.why || '').trim().slice(0, 300);
  if (!await ranOf(x, cp)) { // chưa từng chạy → áp ngay (anh Sơn chọn 18/11/2026)
    const r = await H.mktFbEdit(x, d); if (!r.ok) return r;
    await H.crmLog(x, u, 'Quảng cáo Facebook', '-', cp.n, 'Áp ngay (chiến dịch chưa chạy): ' + r.log + (why ? ' · Lý do: ' + why : ''), '');
    return Object.assign(r, { now: 1, log: 'Áp ngay (chiến dịch chưa chạy): ' + r.log });
  }
  const age = ageOf(cp); if (age && age < LEARN) return { ok: false, error: 'Chiến dịch đang học (mới chạy ' + Math.max(1, Math.floor(age / DAY)) + ' ngày, cần đủ 3 ngày): CRM chưa sửa để Facebook học xong. Thật gấp thì sửa trong Trình quản lý quảng cáo.' };
  const now = Date.now(), objN = pre.objN, old = pre.old || 0, amt = pre.amt || 0;
  if (d.op === 'budget' && old && amt > Math.round(old * (1 + UP_MAX))) return { ok: false, error: 'Mỗi lần chỉ tăng tối đa 20%: từ ' + vnd(old) + ' lên tối đa ' + vnd(Math.floor(old * (1 + UP_MAX) / 1000) * 1000) + ' / ngày.' };
  const open = await all(x.db, "SELECT * FROM mk_sched WHERE camp_id = ? AND (st IN ('wait', 'approve') OR (st = 'done' AND done_at > ?))", cp.id, now - DAY);
  if (open.some(r => r.st !== 'done' && r.obj_id === String(d.id) && (r.op === 'budget') === (d.op === 'budget'))) return { ok: false, error: 'Đã có lệnh chờ 0h cho ' + kindTxt(d.kind) + ' này. Huỷ lệnh cũ ở mục 🕛 Lệnh chờ 0h rồi đặt lại.' };
  if (d.op === 'budget' && open.some(r => r.op === 'budget')) return { ok: false, error: 'Chiến dịch này đã có 1 lệnh đổi ngân sách trong ngày (mỗi chiến dịch 1 lần / ngày). Để ngày mai, hoặc huỷ lệnh cũ.' };
  const [h, tzn] = await tzOf(x, cp.acc), due = nextMidnight(now, h);
  const needOk = d.kind === 'campaign' && d.op === 'pause', admin = u.level >= 3; // tắt chiến dịch: Quản trị duyệt; Quản trị tự đặt = đã bấm xác nhận 1 lần ở CRM
  const st = needOk && !admin ? 'approve' : 'wait';
  const r = await run(x.db, `INSERT INTO mk_sched (acc, camp_id, camp_n, kind, obj_id, obj_n, op, old_v, new_v, why, by_name, at, due, tz, st, ok_by, ok_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    cp.acc, cp.id, cp.n, d.kind, String(d.id), objN, d.op, old, amt, why, u.name, now, due, (h >= 0 ? '+' : '') + h + ' ' + tzn, st, needOk && admin ? u.name : '', needOk && admin ? now : null);
  const row = { op: d.op, old_v: old, new_v: amt }, when = fmtDate(due, 'HH:mm dd/MM');
  const log = '🕛 Hẹn ' + when + ' (0h tài khoản): ' + opTxt(row) + ' – ' + kindTxt(d.kind) + ' “' + objN + '”' + (st === 'approve' ? ' · chờ Quản trị duyệt' : '');
  await H.crmLog(x, u, 'Quảng cáo Facebook', 'hẹn #' + r.meta.last_row_id, cp.n, log + (why ? ' · Lý do: ' + why : ''), '');
  if (st === 'approve') x.later(tgRoles(x, H.crmUsers, H.telegramUser, ['Quản trị'], '🕛 <b>' + esc(u.name) + '</b> muốn <b>TẮT chiến dịch</b> “' + esc(cp.n) + '” lúc 0h.' + (why ? '\n💬 ' + esc(why) : '') +
    '\n👉 Duyệt hoặc huỷ trong CRM trước 0h (không duyệt thì lệnh tự bỏ): ' + CRM_URL + '/#marketing'));
  return { ok: true, sched: 1, id: r.meta.last_row_id, due, st, log, cp: cp.n };
}

/** Danh sách lệnh: đang chờ + đã xử lý 3 ngày gần đây (tối đa 40). Dòng: [id, chiến dịch, loại, tên mục, thao tác, cũ, mới, lý do, người đặt, lúc đặt, 0h lúc, trạng thái, người duyệt, lúc xong, lỗi, múi giờ] */
export async function mkSchList(x) {
  const rs = await all(x.db, "SELECT * FROM mk_sched WHERE st IN ('wait', 'approve') OR at > ? ORDER BY CASE WHEN st IN ('wait', 'approve') THEN 0 ELSE 1 END, due DESC, id DESC LIMIT 40", Date.now() - 3 * DAY);
  return { on: !await schOff(x), rows: rs.map(r => [r.id, r.camp_n, r.kind, r.obj_n, r.op, r.old_v, r.new_v, r.why, r.by_name, r.at, r.due, r.st, r.ok_by, r.done_at, r.err, r.tz]) };
}
/** mk_sch_act { id, op: cancel | ok }: huỷ (Quản trị + Marketing) hoặc duyệt lệnh tắt chiến dịch (chỉ Quản trị), trước giờ áp. */
export async function mkSchAct(x, u, d, H) {
  const r = await first(x.db, 'SELECT * FROM mk_sched WHERE id = ?', Number(d.id) || 0); if (!r) return { ok: false, error: 'Không thấy lệnh này.' };
  if (r.st !== 'wait' && r.st !== 'approve') return { ok: false, error: 'Lệnh này đã ' + (SCH_ST[r.st] || r.st).toLowerCase() + ', không đổi được nữa.' };
  if (Date.now() >= r.due) return { ok: false, error: 'Đã quá giờ áp, không đổi được nữa.' };
  if (d.op === 'ok') {
    if (u.level < 3) return { ok: false, error: 'Chỉ Quản trị duyệt được lệnh tắt chiến dịch.' };
    if (r.st !== 'approve') return { ok: false, error: 'Lệnh này không cần duyệt.' };
    await run(x.db, "UPDATE mk_sched SET st = 'wait', ok_by = ?, ok_at = ? WHERE id = ? AND st = 'approve'", u.name, Date.now(), r.id);
    await H.crmLog(x, u, 'Quảng cáo Facebook', 'hẹn #' + r.id, r.camp_n, '✅ Duyệt lệnh 0h: ' + opTxt(r) + ' – ' + kindTxt(r.kind) + ' “' + r.obj_n + '” (người đặt: ' + r.by_name + ')', '');
    if (r.by_name !== u.name) x.later(H.telegramUser(x, r.by_name, '✅ ' + esc(u.name) + ' đã duyệt lệnh tắt chiến dịch “' + esc(r.camp_n) + '”, áp lúc 0h.'));
    return Object.assign({ ok: true }, await mkSchList(x));
  }
  if (d.op === 'cancel') {
    await run(x.db, "UPDATE mk_sched SET st = 'cancel', done_at = ?, err = ? WHERE id = ? AND st IN ('wait', 'approve')", Date.now(), 'Huỷ bởi ' + u.name, r.id);
    await H.crmLog(x, u, 'Quảng cáo Facebook', 'hẹn #' + r.id, r.camp_n, '✖ Huỷ lệnh 0h: ' + opTxt(r) + ' – ' + kindTxt(r.kind) + ' “' + r.obj_n + '” (người đặt: ' + r.by_name + ')', '');
    return Object.assign({ ok: true }, await mkSchList(x));
  }
  return { ok: false, error: 'Thao tác chưa đúng.' };
}

/** Lịch chạy (cron.js, mỗi 10 phút, cả đêm): áp lệnh tới giờ, bỏ lệnh quá hạn / chưa duyệt / công tắc tắt. Báo Telegram Quản trị + Marketing + người đặt. */
export async function mkSchTick(x, H) {
  const now = Date.now(), rs = await all(x.db, "SELECT * FROM mk_sched WHERE st IN ('wait', 'approve') AND due <= ? ORDER BY due, id LIMIT 50", now);
  if (!rs.length) return;
  const off = await schOff(x), out = [], by = new Set();
  for (const r of rs) {
    by.add(r.by_name); let st = 'done', err = '';
    if (off) { st = 'expired'; err = 'Công tắc hẹn giờ ở Cài đặt đang tắt'; }
    else if (r.st === 'approve') { st = 'expired'; err = 'Quản trị chưa duyệt trước 0h'; }
    else if (now > r.due + WIN) { st = 'expired'; err = 'Quá 0h hơn 30 phút mới tới lượt chạy (lịch trễ) → không áp muộn'; }
    else {
      try {
        const res = await H.mktFbEdit(x, { kind: r.kind, id: r.obj_id, op: r.op, amount: r.new_v, force: 1 });
        if (!res.ok) { st = 'error'; err = res.error || 'Facebook báo lỗi'; }
      } catch (e) { st = 'error'; err = e.message; }
    }
    await run(x.db, 'UPDATE mk_sched SET st = ?, err = ?, done_at = ? WHERE id = ?', st, err.slice(0, 300), now, r.id);
    await H.crmLog(x, { name: 'Lịch 0h' }, 'Quảng cáo Facebook', 'hẹn #' + r.id, r.camp_n, (st === 'done' ? '✅ Đã áp: ' : st === 'error' ? '❌ Lỗi: ' : '⏭ Bỏ: ') + opTxt(r) + ' – ' + kindTxt(r.kind) + ' “' + r.obj_n + '”' + (err ? ' · ' + err : '') + ' (người đặt: ' + r.by_name + ')', '');
    out.push((st === 'done' ? '✅ ' : st === 'error' ? '❌ ' : '⏭ ') + esc(opTxt(r)) + ' – ' + kindTxt(r.kind) + ' “' + esc(r.obj_n) + '”' + (r.kind !== 'campaign' ? ' (chiến dịch “' + esc(r.camp_n) + '”)' : '') + (err ? '\n    ' + esc(err) : ''));
  }
  const ok = out.filter(s => /^✅/.test(s)).length, bad = out.length - ok;
  const msg = '🕛 <b>Áp thay đổi quảng cáo lúc 0h</b>: ' + ok + ' lệnh đã áp' + (bad ? ', <b>' + bad + ' lệnh lỗi / bỏ</b>' : '') + '\n\n' + out.join('\n') +
    (bad ? '\n\n👉 Lệnh lỗi / bỏ KHÔNG tự thử lại. Muốn làm tiếp thì đặt lại trong CRM: ' + CRM_URL + '/#marketing' : '');
  await tgRoles(x, H.crmUsers, H.telegramUser, ['Quản trị', 'Marketing'], msg, [...by]);
}
