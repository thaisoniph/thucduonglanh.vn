// Thử nhanh kế hoạch chủ đề Fanpage (api/src/fbplan.js): đọc JSON AI trả về + khung dịp lễ. Chạy: node scripts/test-fbplan.mjs (cần cd api && npm install trước)
import assert from 'node:assert';
const { fpPlanParse, fpFrame } = await import('../api/src/fbplan.js');
assert.deepEqual(fpPlanParse('Đây ạ:\n```json\n[{"id":"1_20261201_1130","topic":"Cháo kê"}]\n```'), [{ id: '1_20261201_1130', topic: 'Cháo kê' }]);
assert.throws(() => fpPlanParse('[{"id": 1,]'), /sai định dạng/);
const t = fpFrame('20261201', '11:30', 0, false); assert.ok(t.f && t.t, 'khung ngày thường có tầng + chủ đề');
const tet = fpFrame('20270101', '11:30', 0, false); assert.ok(tet.ev, 'Tết dương lịch có dịp: ' + JSON.stringify(tet));
console.log('test-fbplan ok ·', t.f, '·', tet.ev);
