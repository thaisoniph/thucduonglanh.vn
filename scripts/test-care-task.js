// Chạy: cd api && node ../scripts/test-care-task.js
// Kiểm tra việc "Nhắc đặt lại" không hiện khi khách chưa có hàng (mọi sale dùng chung careTask).
import { careTask } from '../api/src/crm.js';
const DAY = 864e5, t = Math.floor(Date.now() / DAY) * DAY, R = { shipDays: 3, shipFar: 5, coolDays: 0, atRisk: 60 };
const base = { orders: 2, last: t - 3 * DAY, runout: t + 2 * DAY, zone: 2 };
const cases = [
  ['Mới, chờ giao', { last_status: 'Mới' }, false],
  ['Đã xác nhận, chờ giao', { last_status: 'Đã xác nhận' }, false],
  ['Đang giao', { last_status: 'Đang giao' }, false],
  ['Đang chuyển hoàn', { last_status: 'Đang chuyển hoàn' }, false],
  ['Đã giao', { last_status: 'Đã giao' }, true],
  ['Đã xác nhận nhưng có ngày nhận', { last_status: 'Đã xác nhận', recv: t - DAY, fam: 1 }, true],
  ['Đơn kẹt trạng thái 20 ngày', { last_status: 'Đang giao', last: t - 20 * DAY, runout: t + DAY }, true],
];
let bad = 0;
for (const [name, o, want] of cases) { const r = careTask({ ...base, ...o }, t, R), got = !!(r && r.type === 'runout'); if (got !== want) { bad++; console.log('SAI:', name, '→', r); } else console.log('ok :', name); }
process.exit(bad ? 1 : 0);
