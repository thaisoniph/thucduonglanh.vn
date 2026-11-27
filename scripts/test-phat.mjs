// Thử 🚨 Phát báo (mktg.js mkPhatAlert): node scripts/test-phat.mjs
import assert from 'node:assert';
import { mkPhatAlert } from '../api/src/mktg.js';
const now = Date.now();
const S = (y, rows) => ({ at: now, lap_luc: '07:20 27/11/2026', muc_tot: { gia_1_sdt_tran: 270000 },
  theo_ngay_14_ngay: [{ ngay: '2026-11-26', ...y, gia_1_sdt_that: y.sdt_that ? Math.round(y.chi_facebook / y.sdt_that) : null }, { ngay: '2026-11-27', chi_facebook: 0, sdt_that: 0 }],
  chien_dich_7_ngay: { rows } });
// dưới trần → không gửi
assert.equal(mkPhatAlert(S({ chi_facebook: 2000000, sdt_that: 10 }, [{ chien_dich: 'A', chi: 1000000, sdt_that: 5, gia_1_sdt_that: 200000 }])), null);
// hôm qua vượt + 1 chiến dịch 0 số
const t = mkPhatAlert(S({ chi_facebook: 3000000, sdt_that: 5 }, [{ chien_dich: 'B <x>', chi: 900000, sdt_that: 0 }, { chien_dich: 'C', chi: 100000, sdt_that: 0 }, { chien_dich: 'D', chi: 500000, sdt_that: 5 }, { chien_dich: 'Shopee 399k', chi: 2e6, sdt_that: 0 }]));
// chưa gắn số theo chiến dịch → không liệt kê, có dòng nhắc
const u = mkPhatAlert(S({ chi_facebook: 3e6, sdt_that: 2 }, [{ chien_dich: 'E', chi: 2e6, sdt_that: 0 }]));
assert.ok(u.includes('Chưa biết chiến dịch nào đắt') && !u.includes('• E'), u);
assert.ok(t.includes('600.000đ / 1 SĐT') && t.includes('B &lt;x&gt;') && t.includes('chưa có SĐT thật') && !t.includes('• C') && !t.includes('Shopee') && !t.includes('• D'), t);
// bảng số cũ → không báo
assert.equal(mkPhatAlert({ ...S({ chi_facebook: 3e6, sdt_that: 1 }, []), at: now - 5 * 3600e3 }), null);
console.log(t, '\n\n✅ test-phat OK');
