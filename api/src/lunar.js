/* ================================================================ 🌙 Lịch âm Việt Nam (09/11/2026, anh Sơn: mùng 1 âm thì bài sáng nhóm Zalo đổi thành lời chúc tháng mới)
 * Thuật toán của Hồ Ngọc Đức (tính điểm sóc + trung khí theo giờ Việt Nam UTC+7), không cần thư viện, không gọi mạng.
 * lunar('20261109') → { d: 1, m: 10, y: 2026, leap: false, yName: 'Bính Ngọ', text: 'mùng 1 tháng 10 năm Bính Ngọ' } */
const TZ = 7, PI = Math.PI, dr = PI / 180;

function jdFromDate(dd, mm, yy) {
  const a = Math.floor((14 - mm) / 12), y = yy + 4800 - a, m = mm + 12 * a - 3;
  return dd + Math.floor((153 * m + 2) / 5) + 365 * y + Math.floor(y / 4) - Math.floor(y / 100) + Math.floor(y / 400) - 32045;
}
/** Lúc sóc (trăng mới) thứ k tính từ 1/1/1900 (ngày Julius) */
function newMoon(k) {
  const T = k / 1236.85, T2 = T * T, T3 = T2 * T;
  let jd = 2415020.75933 + 29.53058868 * k + 0.0001178 * T2 - 0.000000155 * T3 + 0.00033 * Math.sin((166.56 + 132.87 * T - 0.009173 * T2) * dr);
  const M = 359.2242 + 29.10535608 * k - 0.0000333 * T2 - 0.00000347 * T3;
  const Mpr = 306.0253 + 385.81691806 * k + 0.0107306 * T2 + 0.00001236 * T3;
  const F = 21.2964 + 390.67050646 * k - 0.0016528 * T2 - 0.00000239 * T3;
  let C1 = (0.1734 - 0.000393 * T) * Math.sin(M * dr) + 0.0021 * Math.sin(2 * dr * M);
  C1 += -0.4068 * Math.sin(Mpr * dr) + 0.0161 * Math.sin(dr * 2 * Mpr) - 0.0004 * Math.sin(dr * 3 * Mpr);
  C1 += 0.0104 * Math.sin(dr * 2 * F) - 0.0051 * Math.sin(dr * (M + Mpr)) - 0.0074 * Math.sin(dr * (M - Mpr));
  C1 += 0.0004 * Math.sin(dr * (2 * F + M)) - 0.0004 * Math.sin(dr * (2 * F - M)) - 0.0006 * Math.sin(dr * (2 * F + Mpr));
  C1 += 0.0010 * Math.sin(dr * (2 * F - Mpr)) + 0.0005 * Math.sin(dr * (2 * Mpr + M));
  const dt = T < -11 ? 0.001 + 0.000839 * T + 0.0002261 * T2 - 0.00000845 * T3 - 0.000000081 * T * T3 : -0.000278 + 0.000265 * T + 0.000262 * T2;
  return jd + C1 - dt;
}
const newMoonDay = k => Math.floor(newMoon(k) + 0.5 + TZ / 24);
/** Kinh độ mặt trời lúc 0h ngày jdn, quy về 12 cung (0–11) */
function sunSector(jdn) {
  const T = (jdn - 0.5 - TZ / 24 - 2451545.0) / 36525, T2 = T * T;
  const M = 357.52910 + 35999.05030 * T - 0.0001559 * T2 - 0.00000048 * T * T2;
  const L0 = 280.46645 + 36000.76983 * T + 0.0003032 * T2;
  const DL = (1.914600 - 0.004817 * T - 0.000014 * T2) * Math.sin(dr * M) + (0.019993 - 0.000101 * T) * Math.sin(dr * 2 * M) + 0.000290 * Math.sin(dr * 3 * M);
  let L = (L0 + DL) * dr; L -= PI * 2 * Math.floor(L / (PI * 2));
  return Math.floor(L / PI * 6);
}
/** Ngày bắt đầu tháng 11 âm (tháng có Đông chí) của năm yy */
function month11(yy) {
  const k = Math.floor((jdFromDate(31, 12, yy) - 2415021) / 29.530588853);
  const nm = newMoonDay(k);
  return sunSector(nm) >= 9 ? newMoonDay(k - 1) : nm;
}
/** Vị trí tháng nhuận tính từ tháng 11 (tháng đầu tiên không có trung khí) */
function leapOffset(a11) {
  const k = Math.floor((a11 - 2415021.076998695) / 29.530588853 + 0.5);
  let last, i = 1, arc = sunSector(newMoonDay(k + i));
  do { last = arc; i++; arc = sunSector(newMoonDay(k + i)); } while (arc !== last && i < 14);
  return i - 1;
}

const CAN = ['Giáp', 'Ất', 'Bính', 'Đinh', 'Mậu', 'Kỷ', 'Canh', 'Tân', 'Nhâm', 'Quý'];
const CHI = ['Tý', 'Sửu', 'Dần', 'Mão', 'Thìn', 'Tỵ', 'Ngọ', 'Mùi', 'Thân', 'Dậu', 'Tuất', 'Hợi'];
export const monthName = (m, leap) => 'tháng ' + (m === 1 ? 'Giêng' : m === 12 ? 'Chạp' : m) + (leap ? ' nhuận' : '');

/** day: 'yyyyMMdd' (ngày dương theo giờ Việt Nam) → ngày âm */
export function lunar(day) {
  const yy = Number(String(day).slice(0, 4)), mm = Number(String(day).slice(4, 6)), dd = Number(String(day).slice(6, 8));
  const jd = jdFromDate(dd, mm, yy), k = Math.floor((jd - 2415021.076998695) / 29.530588853);
  let start = newMoonDay(k + 1); if (start > jd) start = newMoonDay(k);
  let a11 = month11(yy), b11 = a11, y;
  if (a11 >= start) { y = yy; a11 = month11(yy - 1); } else { y = yy + 1; b11 = month11(yy + 1); }
  const d = jd - start + 1, diff = Math.floor((start - a11) / 29);
  let m = diff + 11, leap = false;
  if (b11 - a11 > 365) { const lo = leapOffset(a11); if (diff >= lo) { m = diff + 10; leap = diff === lo; } }
  if (m > 12) m -= 12;
  if (m >= 11 && diff < 4) y -= 1;
  const yName = CAN[(y + 6) % 10] + ' ' + CHI[(y + 8) % 12];
  return { d, m, y, leap, yName, text: (d === 15 ? 'rằm' : (d <= 10 ? 'mùng ' : 'ngày ') + d) + ' ' + monthName(m, leap) + ' năm ' + yName };
}
