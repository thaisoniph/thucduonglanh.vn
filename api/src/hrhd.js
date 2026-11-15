/* ================================================================ 📄 Hợp đồng nhân sự – hr.thucduonglanh.vn đợt 3 (15/11/2026, anh Sơn "làm đợt 3 hợp đồng")
 * hr_ct: mỗi hợp đồng 1 dòng (thử việc / xác định thời hạn / không xác định thời hạn / cộng tác viên). Chỉ Quản trị (có lương).
 * In: điền mẫu (kv hr_ct_cfg, Quản trị sửa được) bằng thông tin hồ sơ → trang A4 để in / lưu PDF. Ký tay xong tải bản scan → hr_doc, trạng thái Đã ký (chốt nội dung lúc ký).
 * Cảnh báo theo Bộ luật Lao động 2019: thử việc ≤ 60 ngày (Điều 25), lương thử việc ≥ 85% (Điều 26), xác định thời hạn ≤ 36 tháng, ký tới hợp đồng thứ 3 phải không xác định thời hạn (Điều 20).
 * Nhắc Telegram Quản trị lúc 8h ở các mốc còn 30 / 15 / 7 / 0 ngày và quá hạn (ctTick). */
import { esc, all, first, run, kvJson, kvSet, kvGet, fmtDate, DAY } from './lib.js';
import { telegramTo } from './google.js';
import { crmUsers } from './crm.js';

export const CT_KIND = ['Thử việc', 'Xác định thời hạn', 'Không xác định thời hạn', 'Cộng tác viên'];
const CT_CODE = { 'Thử việc': 'HĐTV', 'Xác định thời hạn': 'HĐLĐ', 'Không xác định thời hạn': 'HĐLĐ', 'Cộng tác viên': 'HĐCTV' };
const CT_ST = ['Nháp', 'Đã ký', 'Đã thanh lý'];
const cut = (v, n) => String(v == null ? '' : v).trim().slice(0, n);
const iso = v => /^\d{4}-\d{2}-\d{2}$/.test(String(v || '')) ? String(v) : '';
const dmy = s => { const m = String(s || '').match(/^(\d{4})-(\d{2})-(\d{2})/); return m ? m[3] + '/' + m[2] + '/' + m[1] : ''; };
const today = () => fmtDate(Date.now(), 'yyyy-MM-dd');
const dayN = s => Math.round(new Date(s + 'T00:00:00Z').getTime() / DAY);
export const daysLeft = (end, t) => end ? dayN(end) - dayN(t || today()) : null;
const money = s => { const n = Number(String(s || '').replace(/[^\d]/g, '')); return n >= 1e5 ? n : 0; };

let ok = false;
export async function ctSchema(db) {
  if (ok) return;
  await run(db, `CREATE TABLE IF NOT EXISTS hr_ct (id INTEGER PRIMARY KEY AUTOINCREMENT, email TEXT, kind TEXT, no TEXT DEFAULT '', sign_d TEXT DEFAULT '', start TEXT DEFAULT '', end TEXT DEFAULT '',
    pos TEXT DEFAULT '', place TEXT DEFAULT '', hours TEXT DEFAULT '', pay TEXT DEFAULT '', allow TEXT DEFAULT '', note TEXT DEFAULT '', st TEXT DEFAULT 'Nháp', body TEXT DEFAULT '',
    doc_id INTEGER, rem INTEGER DEFAULT 0, off_d TEXT DEFAULT '', time INTEGER, by_name TEXT DEFAULT '', upd INTEGER)`);
  ok = true;
}

/* ---------------------------------------------------------------- mẫu hợp đồng (Quản trị sửa ở ⚙️ Mẫu hợp đồng) */
const HEAD = `CỘNG HOÀ XÃ HỘI CHỦ NGHĨA VIỆT NAM
Độc lập – Tự do – Hạnh phúc
`;
const PARTIES = `Hôm nay, ngày {ngay_ky}, tại {dia_chi_cty}, chúng tôi gồm:

## BÊN A: {cong_ty}
Mã số doanh nghiệp: {mst}
Địa chỉ: {dia_chi_cty}
Điện thoại: {hotline}
Người đại diện: {dai_dien} – Chức vụ: {chuc_vu}

## BÊN B: Ông/Bà {ho_ten}
Ngày sinh: {ngay_sinh} – Quê quán: {que_quan}
Số CCCD: {cccd} – Cấp ngày {ngay_cap} tại {noi_cap}
Nơi ở hiện tại: {dia_chi}
Điện thoại: {sdt} – Email: {email}
`;
export const TPL_DEF = {
  tv: HEAD + `# HỢP ĐỒNG THỬ VIỆC
Số: {so_hd}

` + PARTIES + `
Hai bên thoả thuận ký hợp đồng thử việc theo Điều 24 – 27 Bộ luật Lao động 2019 với các điều khoản sau:

## Điều 1. Công việc và thời gian thử việc
- Vị trí, công việc: {vi_tri} – Bộ phận: {bo_phan}
- Địa điểm làm việc: {dia_diem}
- Thời gian thử việc: {thoi_han}, từ ngày {tu_ngay} đến hết ngày {den_ngay}.
- Thời giờ làm việc: {gio_lam}

## Điều 2. Lương và quyền lợi trong thời gian thử việc
- Lương thử việc: {luong} (không thấp hơn 85% lương chính thức của công việc).
- Phụ cấp, thưởng, hoa hồng: {phu_cap}
- Hình thức trả: chuyển khoản vào tài khoản {tai_khoan}; trả lương vào {ngay_tra}.

## Điều 3. Quyền và nghĩa vụ của hai bên
- Bên B làm đúng công việc được giao, giữ nội quy, bảo mật thông tin khách hàng và công ty.
- Bên A hướng dẫn công việc, bố trí người kèm cặp, trả lương đúng hạn.
- Trong thời gian thử việc, mỗi bên có quyền huỷ thoả thuận thử việc mà không cần báo trước và không phải bồi thường.

## Điều 4. Kết thúc thử việc
- Khi hết thời gian thử việc, Bên A thông báo kết quả cho Bên B. Đạt yêu cầu thì hai bên ký hợp đồng lao động; không đạt thì chấm dứt thoả thuận thử việc.

## Điều 5. Thoả thuận khác
{ghi_chu}

Hợp đồng lập thành 02 bản có giá trị như nhau, mỗi bên giữ 01 bản.`,
  ld: HEAD + `# HỢP ĐỒNG LAO ĐỘNG
Số: {so_hd}

` + PARTIES + `
Hai bên thoả thuận ký hợp đồng lao động theo Bộ luật Lao động 2019 với các điều khoản sau:

## Điều 1. Loại hợp đồng, công việc, địa điểm
- Loại hợp đồng: {loai_hd}, thời hạn {thoi_han}, từ ngày {tu_ngay}{den_ngay_cau}.
- Vị trí, công việc: {vi_tri} – Bộ phận: {bo_phan}
- Địa điểm làm việc: {dia_diem}

## Điều 2. Thời giờ làm việc, nghỉ ngơi
- Thời giờ làm việc: {gio_lam}
- Nghỉ hằng năm, nghỉ lễ, Tết, việc riêng theo Bộ luật Lao động và nội quy công ty.

## Điều 3. Lương, phụ cấp và hình thức trả
- Mức lương: {luong}
- Phụ cấp, thưởng, hoa hồng: {phu_cap}
- Hình thức trả: chuyển khoản vào tài khoản {tai_khoan}; trả lương vào {ngay_tra}.
- Xét nâng lương theo kết quả công việc và quy chế lương của công ty.

## Điều 4. Bảo hiểm, đào tạo
- Hai bên tham gia bảo hiểm xã hội, bảo hiểm y tế, bảo hiểm thất nghiệp bắt buộc theo quy định.
- Bên B được đào tạo, hướng dẫn công việc và sản phẩm của công ty.

## Điều 5. Quyền và nghĩa vụ của Bên B
- Làm đúng công việc được giao, giữ nội quy lao động, 10 Quy Tắc Danh Dự và Sổ tay nhân viên.
- Bảo mật thông tin khách hàng, giá, kế hoạch kinh doanh, kể cả sau khi nghỉ việc. Chỉ tư vấn công dụng sản phẩm đúng hồ sơ công bố.
- Bồi thường thiệt hại do lỗi của mình theo quy định của pháp luật.

## Điều 6. Quyền và nghĩa vụ của Bên A
- Bố trí công việc, trả lương đúng hạn, bảo đảm điều kiện làm việc an toàn.
- Đóng bảo hiểm cho Bên B theo quy định.

## Điều 7. Thoả thuận khác
{ghi_chu}

Những vấn đề chưa ghi trong hợp đồng thực hiện theo nội quy công ty và Bộ luật Lao động. Hợp đồng lập thành 02 bản có giá trị như nhau, mỗi bên giữ 01 bản.`,
  ctv: HEAD + `# HỢP ĐỒNG CỘNG TÁC
Số: {so_hd}

` + PARTIES + `
Hai bên thoả thuận ký hợp đồng cộng tác (hợp đồng dịch vụ theo Bộ luật Dân sự 2015, không phải hợp đồng lao động) với các điều khoản sau:

## Điều 1. Nội dung cộng tác
- Công việc: {vi_tri}
- Thời hạn: {thoi_han}, từ ngày {tu_ngay}{den_ngay_cau}.
- Bên B tự sắp xếp thời gian, địa điểm làm việc.

## Điều 2. Thù lao
- Thù lao, hoa hồng: {luong}
- Thưởng, hỗ trợ khác: {phu_cap}
- Thanh toán: chuyển khoản vào tài khoản {tai_khoan}; vào {ngay_tra}. Bên A khấu trừ thuế thu nhập cá nhân theo quy định (nếu có).

## Điều 3. Cam kết của Bên B
- Giới thiệu, tư vấn sản phẩm đúng thông tin công ty cung cấp, chỉ nói công dụng đúng hồ sơ công bố; không dùng các từ "chữa", "điều trị", "khỏi bệnh".
- Bảo mật thông tin khách hàng và chính sách giá của công ty.

## Điều 4. Chấm dứt
- Mỗi bên có quyền chấm dứt hợp đồng, báo trước cho bên kia ít nhất 07 ngày. Thù lao đã phát sinh được thanh toán đủ.

## Điều 5. Thoả thuận khác
{ghi_chu}

Hợp đồng lập thành 02 bản có giá trị như nhau, mỗi bên giữ 01 bản.`
};
export const CT_PH = [['so_hd', 'Số hợp đồng'], ['ngay_ky', 'Ngày ký'], ['cong_ty', 'Tên công ty'], ['mst', 'Mã số doanh nghiệp'], ['dia_chi_cty', 'Địa chỉ công ty'], ['hotline', 'Điện thoại công ty'],
  ['dai_dien', 'Người đại diện'], ['chuc_vu', 'Chức vụ người đại diện'], ['ho_ten', 'Họ tên nhân sự'], ['ngay_sinh', 'Ngày sinh'], ['que_quan', 'Quê quán'], ['cccd', 'Số CCCD'], ['ngay_cap', 'Ngày cấp'],
  ['noi_cap', 'Nơi cấp'], ['dia_chi', 'Nơi ở'], ['sdt', 'Điện thoại'], ['email', 'Email'], ['loai_hd', 'Loại hợp đồng'], ['thoi_han', 'Thời hạn'], ['tu_ngay', 'Từ ngày'], ['den_ngay', 'Đến ngày'],
  ['den_ngay_cau', '“ đến hết ngày …” (trống nếu không thời hạn)'], ['vi_tri', 'Vị trí'], ['bo_phan', 'Bộ phận'], ['dia_diem', 'Địa điểm'], ['gio_lam', 'Giờ làm'], ['luong', 'Lương'], ['phu_cap', 'Phụ cấp, thưởng'],
  ['tai_khoan', 'Tài khoản nhận lương'], ['ngay_tra', 'Ngày trả lương'], ['ghi_chu', 'Thoả thuận khác']];
const CFG_DEF = { company: 'CÔNG TY TNHH TẬP ĐOÀN VITAGREEN NUTRITION', mst: '0111053409', addr: 'HA10-SP8A-15, Đường Hải Âu 8A, KĐT Vinhomes Ocean Park, Gia Lâm, TP. Hà Nội', hotline: '0966 326 522',
  rep: '', repTitle: '', hours: 'Thứ 2 – Thứ 7, 8h00 – 17h00, nghỉ trưa 1 tiếng', payDay: 'ngày 10 hằng tháng', tpl: {} };
export async function ctCfg(db) { const c = Object.assign({}, CFG_DEF, await kvJson(db, 'hr_ct_cfg', null) || {}); c.tpl = Object.assign({}, TPL_DEF, c.tpl || {}); return c; }
const tplKey = k => k === 'Thử việc' ? 'tv' : k === 'Cộng tác viên' ? 'ctv' : 'ld';

function span(c) { // "2 tháng", "12 tháng", "không xác định thời hạn"
  if (!c.end) return c.kind === 'Cộng tác viên' ? 'không xác định thời hạn' : 'không xác định thời hạn';
  const a = new Date(c.start + 'T00:00:00Z'), b = new Date(c.end + 'T00:00:00Z'); b.setUTCDate(b.getUTCDate() + 1);
  const m = (b.getUTCFullYear() - a.getUTCFullYear()) * 12 + b.getUTCMonth() - a.getUTCMonth();
  return m > 0 && b.getUTCDate() === a.getUTCDate() ? m + ' tháng' : (dayN(c.end) - dayN(c.start) + 1) + ' ngày';
}

/** Cảnh báo pháp lý cho 1 hợp đồng (trước khi lưu), dựa trên các hợp đồng đã có của người đó. */
export function ctWarn(c, prev, offerPay) {
  const W = [];
  if (c.end && c.start && c.end < c.start) W.push('Ngày kết thúc trước ngày bắt đầu.');
  if (c.kind === 'Thử việc' && c.start && c.end && dayN(c.end) - dayN(c.start) + 1 > 60) W.push('Thử việc dài hơn 60 ngày. Luật chỉ cho tối đa 60 ngày với vị trí cần cao đẳng trở lên, 30 ngày với trung cấp, 6 ngày với việc khác, 180 ngày với người quản lý doanh nghiệp (Điều 25 Bộ luật Lao động 2019).');
  if (c.kind === 'Thử việc' && !c.end) W.push('Hợp đồng thử việc cần có ngày kết thúc.');
  if (c.kind === 'Xác định thời hạn' && !c.end) W.push('Hợp đồng xác định thời hạn cần có ngày kết thúc.');
  if (c.kind === 'Xác định thời hạn' && c.start && c.end && dayN(c.end) - dayN(c.start) + 1 > 366 * 3) W.push('Hợp đồng xác định thời hạn tối đa 36 tháng (Điều 20).');
  const fixed = (prev || []).filter(p => p.id !== c.id && p.kind === 'Xác định thời hạn' && p.st !== 'Nháp').length;
  if (c.kind === 'Xác định thời hạn' && fixed >= 2) W.push('Bạn này đã ký ' + fixed + ' hợp đồng xác định thời hạn. Luật chỉ cho ký thêm 1 lần, lần sau phải là hợp đồng không xác định thời hạn (Điều 20).');
  if (c.kind === 'Thử việc') { const t = money(c.pay), f = money(offerPay); if (t && f && t < f * 0.85) W.push('Lương thử việc thấp hơn 85% lương chính thức trong thư mời (' + offerPay + '). Luật yêu cầu ít nhất 85% (Điều 26).'); }
  if (c.kind === 'Thử việc' && (prev || []).some(p => p.id !== c.id && p.kind === 'Thử việc' && p.st === 'Đã ký')) W.push('Bạn này đã có hợp đồng thử việc. Mỗi công việc chỉ được thử việc 1 lần.');
  return W;
}

/** Tình trạng hiện tại để hiện nhãn + nhắc. */
export function ctState(c, all) {
  if (c.st === 'Đã thanh lý') return { k: 'off', t: 'Đã thanh lý' + (c.off_d ? ' ' + dmy(c.off_d) : '') };
  const t = today(), newer = (all || []).some(p => p.id !== c.id && p.st !== 'Đã thanh lý' && p.start > c.start && p.st === 'Đã ký');
  if (newer && c.end && c.end < t) return { k: 'old', t: 'Đã có hợp đồng mới' };
  if (c.st === 'Nháp') return { k: 'draft', t: 'Nháp – chưa ký' };
  if (c.start > t) return { k: 'wait', t: 'Hiệu lực từ ' + dmy(c.start) };
  const n = daysLeft(c.end, t);
  if (n == null) return { k: 'on', t: 'Đang hiệu lực · không thời hạn' };
  if (n < 0) return { k: 'late', t: 'Hết hạn ' + -n + ' ngày trước', n };
  if (n <= 30) return { k: 'soon', t: n === 0 ? 'Hết hạn hôm nay' : 'Còn ' + n + ' ngày', n };
  return { k: 'on', t: 'Đang hiệu lực đến ' + dmy(c.end), n };
}

const out = c => ({ id: c.id, kind: c.kind, no: c.no, sign: c.sign_d, start: c.start, end: c.end, pos: c.pos, place: c.place, hours: c.hours, pay: c.pay, allow: c.allow, note: c.note, st: c.st, doc: c.doc_id || 0, off: c.off_d, time: c.time, by: c.by_name, locked: !!c.body });
/** email → [hợp đồng], mới nhất trước (cho listOut, chỉ Quản trị). */
export async function ctList(db) {
  await ctSchema(db);
  const m = {}; for (const r of await all(db, 'SELECT * FROM hr_ct ORDER BY start DESC, id DESC')) (m[r.email] = m[r.email] || []).push(r);
  const res = {}; for (const e in m) res[e] = m[e].map(c => Object.assign(out(c), { state: ctState(c, m[e]) }));
  return res;
}

async function nextNo(db, kind, d) {
  const y = (d || today()).slice(0, 4), code = CT_CODE[kind] || 'HĐLĐ';
  const n = (await first(db, "SELECT COUNT(*) n FROM hr_ct WHERE no LIKE ?", '%/' + y + '/%')).n + 1;
  return String(n).padStart(2, '0') + '/' + y + '/' + code + '-VTG';
}

/** Điền mẫu → HTML A4 (trống thì để dòng chấm để viết tay). */
export async function ctHtml(x, c) {
  const cfg = await ctCfg(x.db), z = (await crmUsers(x)).find(y => y.email === c.email) || {}, e = await first(x.db, 'SELECT * FROM hr_staff WHERE email = ?', c.email).catch(() => null) || {};
  const V = { so_hd: c.no, ngay_ky: dmy(c.sign_d || c.start), cong_ty: cfg.company, mst: cfg.mst, dia_chi_cty: cfg.addr, hotline: cfg.hotline, dai_dien: cfg.rep, chuc_vu: cfg.repTitle,
    ho_ten: z.full || z.name, ngay_sinh: z.dob, que_quan: e.home, cccd: e.idno, ngay_cap: e.idd, noi_cap: e.idp, dia_chi: e.addr, sdt: z.phone, email: c.email,
    loai_hd: c.kind === 'Cộng tác viên' ? 'Hợp đồng cộng tác' : 'Hợp đồng lao động ' + c.kind.toLowerCase(), thoi_han: span(c), tu_ngay: dmy(c.start), den_ngay: dmy(c.end), den_ngay_cau: c.end ? ' đến hết ngày ' + dmy(c.end) : '',
    vi_tri: c.pos || e.pos, bo_phan: e.dept, dia_diem: c.place || cfg.addr, gio_lam: c.hours || cfg.hours, luong: c.pay, phu_cap: c.allow || 'Theo quy chế lương, thưởng của công ty',
    tai_khoan: [z.acct, e.bank].filter(Boolean).join(' – '), ngay_tra: cfg.payDay, ghi_chu: c.note || 'Không có.' };
  const miss = [], blank = '<span class="dot">……………………</span>';
  const fill = s => esc(s).replace(/\{(\w+)\}/g, (m, k) => { if (!(k in V)) return m; if (k === 'den_ngay_cau') return c.end ? ' đến hết ngày <b>' + dmy(c.end) + '</b>' : ''; const v = String(V[k] || '').trim(); if (!v && k !== 'den_ngay_cau') { miss.push(k); return blank; } return '<b>' + esc(v).replace(/\n/g, '<br>') + '</b>'; });
  let n = 0;
  const body = String(cfg.tpl[tplKey(c.kind)] || '').split('\n').map(l => {
    n++; if (n <= 2 && /CỘNG HOÀ|CỘNG HÒA|Độc lập/.test(l)) return '<p class="c' + (n === 1 ? ' b' : ' u') + '">' + esc(l) + '</p>';
    if (/^# /.test(l)) return '<h1>' + fill(l.slice(2)) + '</h1>'; if (/^## /.test(l)) return '<h2>' + fill(l.slice(3)) + '</h2>';
    if (/^Số: /.test(l)) return '<p class="c">' + fill(l) + '</p>'; if (!l.trim()) return ''; return '<p>' + fill(l) + '</p>';
  }).join('\n');
  const sign = '<table class="sg"><tr><td><b>BÊN B</b><br><i>(Ký, ghi rõ họ tên)</i><div class="sp"></div>' + esc(V.ho_ten || '') + '</td><td><b>BÊN A</b><br><i>(Ký, ghi rõ họ tên, đóng dấu)</i><div class="sp"></div>' + esc(cfg.rep || '') + '</td></tr></table>';
  const html = `<!doctype html><html lang="vi"><head><meta charset="utf-8"><title>${esc(c.kind === 'Cộng tác viên' ? 'Hợp đồng cộng tác' : 'Hợp đồng') + ' ' + esc(V.ho_ten || '')} – ${esc(c.no)}</title><style>
@page{size:A4;margin:20mm 18mm 20mm 25mm}body{font-family:"Times New Roman",Times,serif;font-size:13.5pt;line-height:1.45;color:#000;max-width:800px;margin:24px auto;padding:0 16px}
p{margin:0 0 4px}.c{text-align:center}.b{font-weight:bold}.u{text-decoration:underline;margin-bottom:14px}h1{font-size:16pt;text-align:center;margin:18px 0 2px}h2{font-size:13.5pt;margin:12px 0 4px}
.dot{color:#666}.sg{width:100%;margin-top:28px;text-align:center}.sg td{width:50%;vertical-align:top}.sp{height:90px}.bar{position:sticky;top:0;background:#fffbe6;border:1px solid #e8d48a;padding:10px 14px;border-radius:8px;margin-bottom:16px;font-family:system-ui,sans-serif;font-size:14px}
.bar button{font-size:15px;padding:6px 14px;margin-right:8px;cursor:pointer}@media print{.bar{display:none}body{margin:0;max-width:none;padding:0}}</style></head><body>
<div class="bar"><button onclick="print()">🖨 In / Lưu PDF</button>${miss.length ? '⚠️ Còn ' + miss.length + ' chỗ trống (dòng chấm) – điền ở hồ sơ hoặc viết tay khi ký.' : '✅ Đã đủ thông tin.'}</div>
${body}
${sign}
</body></html>`;
  return { html, miss: [...new Set(miss)] };
}

/** hr {op: ct_*} – Quản trị (crmHrStaff đã kiểm). Trả { ok, … }; crmHrStaff gộp thêm danh sách hồ sơ. */
export async function crmHrCt(x, u, d, log) {
  await ctSchema(x.db);
  const op = String(d.op), now = Date.now(), email = cut(d.email, 120).toLowerCase();
  if (op === 'ct_cfg') {
    const cur = await kvJson(x.db, 'hr_ct_cfg', null) || {};
    if (d.reset) { const k = String(d.reset); cur.tpl = Object.assign({}, cur.tpl || {}); delete cur.tpl[k]; }
    else if (d.save) {
      ['company', 'mst', 'addr', 'hotline', 'rep', 'repTitle', 'hours', 'payDay'].forEach(k => { if (d[k] != null) cur[k] = cut(d[k], 300); });
      if (d.tpl && typeof d.tpl === 'object') { cur.tpl = Object.assign({}, cur.tpl || {}); ['tv', 'ld', 'ctv'].forEach(k => { const v = String(d.tpl[k] == null ? '' : d.tpl[k]).slice(0, 20000); if (d.tpl[k] != null) { if (!v.trim() || v === TPL_DEF[k]) delete cur.tpl[k]; else cur.tpl[k] = v; } }); }
      await log(x, u, 'Nhân sự', '-', '', 'Sửa mẫu hợp đồng', '');
    }
    if (d.reset || d.save) await kvSet(x.db, 'hr_ct_cfg', JSON.stringify(cur));
    const c = await ctCfg(x.db);
    return { ok: true, ctCfg: Object.assign(c, { def: TPL_DEF, ph: CT_PH, edited: Object.keys(cur.tpl || {}) }) };
  }
  if (op === 'ct_save') {
    const z = (await crmUsers(x)).find(y => y.email === email); if (!z) return { ok: false, error: 'Không thấy nhân sự.' };
    const id = Number(d.id) || 0, old = id ? await first(x.db, 'SELECT * FROM hr_ct WHERE id = ?', id) : null;
    if (id && !old) return { ok: false, error: 'Không thấy hợp đồng.' };
    if (old && old.body) return { ok: false, error: 'Hợp đồng đã ký thì không sửa nội dung. Làm hợp đồng mới hoặc phụ lục.' };
    const kind = CT_KIND.indexOf(d.kind) >= 0 ? d.kind : 'Xác định thời hạn';
    const c = { id, email, kind, sign_d: iso(d.sign) || iso(d.start), start: iso(d.start), end: kind === 'Không xác định thời hạn' ? '' : iso(d.end), pos: cut(d.pos, 200), place: cut(d.place, 300), hours: cut(d.hours, 300),
      pay: cut(d.pay, 300), allow: cut(d.allow, 600), note: cut(d.note, 3000) };
    if (!c.start) return { ok: false, error: 'Chọn ngày bắt đầu.' };
    if (!c.pay) return { ok: false, error: kind === 'Cộng tác viên' ? 'Ghi thù lao / hoa hồng.' : 'Ghi mức lương.' };
    const prev = await all(x.db, 'SELECT * FROM hr_ct WHERE email = ?', email);
    const W = ctWarn(c, prev, cut(d.offerPay, 100)), hard = W.filter(w => /trước ngày bắt đầu|cần có ngày kết thúc/.test(w));
    if (hard.length) return { ok: false, error: hard[0] };
    if (W.length && !d.force) return { ok: false, warn: W };
    const no = cut(d.no, 60) || (old && old.no) || await nextNo(x.db, kind, c.start);
    if (old) await run(x.db, 'UPDATE hr_ct SET kind = ?, no = ?, sign_d = ?, start = ?, end = ?, pos = ?, place = ?, hours = ?, pay = ?, allow = ?, note = ?, rem = 0, upd = ? WHERE id = ?',
      kind, no, c.sign_d, c.start, c.end, c.pos, c.place, c.hours, c.pay, c.allow, c.note, now, id);
    else await run(x.db, "INSERT INTO hr_ct (email, kind, no, sign_d, start, end, pos, place, hours, pay, allow, note, st, time, by_name, upd) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'Nháp', ?, ?, ?)",
      email, kind, no, c.sign_d, c.start, c.end, c.pos, c.place, c.hours, c.pay, c.allow, c.note, now, u.name, now);
    const nid = old ? id : (await first(x.db, 'SELECT MAX(id) id FROM hr_ct WHERE email = ?', email)).id;
    await log(x, u, 'Nhân sự', '-', z.name, (old ? 'Sửa' : 'Làm') + ' hợp đồng ' + kind + ' ' + no + (W.length ? ' (bỏ qua cảnh báo: ' + W.length + ')' : ''), '');
    return { ok: true, ctId: nid };
  }
  const c = await first(x.db, 'SELECT * FROM hr_ct WHERE id = ?', Number(d.id) || 0); if (!c) return { ok: false, error: 'Không thấy hợp đồng.' };
  if (op === 'ct_doc') { // bản in: đã ký thì in đúng nội dung lúc ký
    if (c.body) return { ok: true, html: c.body, miss: [] };
    const r = await ctHtml(x, c); await log(x, u, 'Nhân sự', '-', c.email, 'Xem / in hợp đồng ' + c.no, ''); return { ok: true, html: r.html, miss: r.miss };
  }
  if (op === 'ct_sign') { // ✅ đã ký (kèm bản scan nếu có) → chốt nội dung
    let docId = c.doc_id || null;
    const b64 = String(d.data || '').replace(/^data:[^,]*,/, '');
    if (b64) {
      if (b64.length > 1.9e6) return { ok: false, error: 'File lớn hơn 1,4 MB. Nén PDF hoặc chụp ảnh nhỏ hơn rồi tải lại.' };
      const name = cut(d.name, 120).replace(/[\\/:*?"<>|]/g, '_') || 'hop-dong.pdf';
      await run(x.db, 'INSERT INTO hr_doc (email, kind, name, b64, size, time, by_name) VALUES (?, ?, ?, ?, ?, ?, ?)', c.email, (c.kind === 'Thử việc' ? 'Hợp đồng thử việc' : c.kind === 'Cộng tác viên' ? 'Hợp đồng cộng tác' : 'Hợp đồng lao động') + ' ' + c.no + ' (bản ký)', name, b64, Math.round(b64.length * 0.75), now, u.name);
      docId = (await first(x.db, 'SELECT MAX(id) id FROM hr_doc WHERE email = ?', c.email)).id;
    }
    const body = c.body || (await ctHtml(x, c)).html;
    await run(x.db, "UPDATE hr_ct SET st = 'Đã ký', body = ?, doc_id = ?, sign_d = ?, upd = ? WHERE id = ?", body, docId, iso(d.sign) || c.sign_d, now, c.id);
    await log(x, u, 'Nhân sự', '-', c.email, 'Hợp đồng ' + c.no + ' đã ký' + (b64 ? ' + tải bản scan' : ''), '');
    return { ok: true };
  }
  if (op === 'ct_off') { // chấm dứt / thanh lý
    const od = iso(d.date) || today();
    await run(x.db, "UPDATE hr_ct SET st = 'Đã thanh lý', off_d = ?, note = CASE WHEN ? = '' THEN note ELSE note || char(10) || ? END, upd = ? WHERE id = ?", od, cut(d.why, 500), 'Thanh lý: ' + cut(d.why, 500), now, c.id);
    await log(x, u, 'Nhân sự', '-', c.email, 'Thanh lý hợp đồng ' + c.no + ' ngày ' + dmy(od), '');
    return { ok: true };
  }
  if (op === 'ct_del') {
    if (c.st !== 'Nháp') return { ok: false, error: 'Chỉ xoá được hợp đồng nháp. Hợp đồng đã ký thì bấm Thanh lý.' };
    await run(x.db, 'DELETE FROM hr_ct WHERE id = ?', c.id); await log(x, u, 'Nhân sự', '-', c.email, 'Xoá hợp đồng nháp ' + c.no, '');
    return { ok: true };
  }
  return { ok: false, error: 'Không rõ thao tác.' };
}

/* ---------------------------------------------------------------- 🔔 nhắc Telegram (cron, 1 lần / ngày sau 8h) */
const MARK = [30, 15, 7, 0, -1];
/** Việc cần xử lý: hợp đồng mới nhất của mỗi người đang làm sắp hết / đã hết hạn, nháp chưa ký đã tới ngày, người chưa có hợp đồng. */
export async function ctTodo(x, users) {
  await ctSchema(x.db);
  const act = (users || await crmUsers(x)).filter(z => z.active && z.email && z.role !== 'Quản trị'), byE = {}; // chủ / Quản trị không cần hợp đồng
  for (const r of await all(x.db, "SELECT * FROM hr_ct ORDER BY start DESC, id DESC")) (byE[r.email] = byE[r.email] || []).push(r);
  const L = [], t = today();
  for (const z of act) {
    const C = (byE[z.email] || []).filter(c => c.st !== 'Đã thanh lý');
    if (!C.length) { L.push({ z, k: 'none' }); continue; }
    const live = C.filter(c => c.st === 'Đã ký'), cur = live[0], draft = C.find(c => c.st === 'Nháp');
    if (draft && draft.start <= t) L.push({ z, k: 'draft', c: draft });
    if (!cur) continue;
    const n = daysLeft(cur.end, t); if (n == null || n > 30) continue;
    if (C.some(c => c.id !== cur.id && c.start > cur.start)) continue; // đã làm hợp đồng tiếp theo
    L.push({ z, k: n < 0 ? 'late' : 'soon', c: cur, n });
  }
  return L;
}
export async function ctTick(x, users, force) {
  if (!force && Number(fmtDate(Date.now(), 'HH')) < 8) return;
  const dk = 'hr_ct_tg_' + fmtDate(Date.now(), 'yyyyMMdd'); if (await kvGet(x.db, dk)) return; await kvSet(x.db, dk, '1', 2 * DAY);
  const L = (await ctTodo(x)).filter(i => i.k === 'soon' || i.k === 'late'), send = [];
  for (const i of L) {
    const idx = MARK.filter(m => i.n <= m).length; // quá hạn: nhắc thêm mỗi 7 ngày tới 30 ngày
    if (!(idx > (i.c.rem || 0) || (i.n < 0 && i.n >= -30 && (-i.n) % 7 === 0))) continue;
    send.push(i); await run(x.db, 'UPDATE hr_ct SET rem = ? WHERE id = ?', idx, i.c.id);
  }
  if (!send.length) return;
  const msg = '📄 <b>Hợp đồng nhân sự cần xử lý</b>' + send.map(i => '\n\n• <b>' + esc(i.z.full || i.z.name) + '</b> – ' + esc(i.c.kind) + ' ' + esc(i.c.no) + ': ' + (i.n < 0 ? 'đã hết hạn ' + -i.n + ' ngày (' + dmy(i.c.end) + ')' : i.n === 0 ? 'hết hạn hôm nay' : 'còn ' + i.n + ' ngày (hết ' + dmy(i.c.end) + ')') +
    '\n  👉 ' + (i.c.kind === 'Thử việc' ? 'Báo kết quả thử việc cho bạn ấy; đạt thì làm hợp đồng lao động.' : i.c.kind === 'Cộng tác viên' ? 'Gia hạn hoặc kết thúc cộng tác.' : i.n < 0 ? 'Bạn ấy vẫn làm thì trong 30 ngày phải ký hợp đồng mới, quá 30 ngày hợp đồng tự thành không xác định thời hạn (Điều 20).' : 'Ký tiếp hoặc báo bằng văn bản ít nhất 15 ngày trước khi hết hạn (Điều 45).')).join('') +
    '\n\n👉 https://hr.thucduonglanh.vn/#nhan-su';
  for (const u of (users || []).filter(z => z.active && z.tg && z.level >= 3)) await telegramTo(x.env, u.tg, msg);
}
