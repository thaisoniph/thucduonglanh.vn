/* ================================================================ 📅 Lịch ngày lễ cho bài đăng nhóm Zalo (09/11/2026, anh Sơn duyệt)
 * Ngày thường: bài theo thứ trong tuần (THEME trong zbot.js). Mùng 1, rằm, lễ Tết âm + dương: bài đổi theo dịp.
 * Phễu: ngày lễ = 🔵 chúc mừng, tương tác, KHÔNG bán. Trước các dịp tặng quà (Tết, 8/3, Vu Lan, Trung thu, 20/10, 20/11)
 * thêm 1 bài 🟠 gợi ý quà (vài ngày trước, lúc khách cần mua thật) + với Tết, Vu Lan thêm 1 bài ⚪ kiến thức.
 * Bài bán buổi sáng (sáng Thứ 7) bị ngày lễ chiếm chỗ → dời sang sáng hôm sau, nếu hôm sau là bài 🔵 thường và chưa có bài bán (bài bán buổi tối thì bỏ, tránh 2 bài bán liền nhau).
 * Ưu tiên: Tết > lễ có tên > mùng 1 / rằm > bài trước dịp quà > ngày đôi 11/11, 12/12 (chỉ khi Marketing có ưu đãi đang chạy).
 * Mỗi dịp: k = 'L d/m' (âm lịch, không tính tháng nhuận) · 'L d' (ngày âm d của mọi tháng, kể cả nhuận) · 'S d/m' (dương lịch).
 * Mỗi bài (parts): o = lệch bao nhiêu ngày so với ngày lễ (-1 = hôm trước), s = khung sang | toi, f = phễu, n = tên dịp, t = chủ đề gửi AI. */
import { lunar, monthName } from './lunar.js';

const P = { TET: 1, BIG: 2, MOON: 3, PRE: 4, SALE: 5 };
const NO_SELL = ' Không bán hàng, không nhắc sản phẩm.';
const NO_SPIRIT = ' Không nói chuyện tâm linh, bói toán, ngày tốt xấu.';
const GIFT = (what, who) => 'Gợi ý quà ' + what + ': 1–2 sản phẩm hợp làm quà sức khỏe cho ' + who + ' (vì sao hợp, cách dùng, quy cách, giá đúng tài liệu), ưu đãi đang chạy nếu có; nhắc đặt trên web được kiểm hàng trước khi nhận, freeship đơn từ 300k, nên đặt sớm vài ngày cho kịp (không hứa ngày giao cụ thể); để 1 link sản phẩm. Ấm áp, không thúc ép.';
const WOMEN = day => 'Ngày ' + day + ': lời chúc các bà, các mẹ, các chị em trong nhóm; nhắc chị em dành chút thời gian chăm mình (ngủ đủ, ăn sáng đủ chất, vận động nhẹ); mời các anh gửi lời chúc tới người phụ nữ của mình.' + NO_SELL;
const mon = c => monthName(c.l.m, c.l.leap);

const EVENTS = [
  // ---------------------------------------------------------------- Tết Nguyên Đán (ngày lễ = mùng 1 tháng Giêng)
  { id: 'tet', n: 'Mùng 1 Tết', k: 'L 1/1', p: P.TET, parts: [
    { o: -14, s: 'sang', f: 'BOFU', n: 'Quà Tết', t: GIFT('Tết', 'ông bà, cha mẹ, họ hàng, thầy cô, đối tác') },
    { o: -10, s: 'toi', f: 'BOFU', n: 'Nhắc đặt quà Tết sớm', t: 'Nhắc nhẹ: ai định biếu quà Tết sức khỏe thì nên đặt sớm vì cận Tết bên giao hàng rất đông đơn (không hứa ngày giao cụ thể); 1 câu về sản phẩm hợp làm quà + ưu đãi nếu có; được kiểm hàng trước khi nhận, freeship từ 300k; để 1 link sản phẩm. Không thúc ép.' },
    { o: -4, s: 'sang', f: 'MOFU', n: 'Chuẩn bị Tết lành', t: 'Chuẩn bị Tết lành: đi chợ Tết vừa đủ, mâm cỗ cân bằng (thêm rau xanh, dưa góp, món luộc / hấp bên cạnh món chiên, đồ ngọt), uống đủ nước, giữ giờ ngủ những ngày cận Tết. Kiến thức phổ thông, dễ làm.' + NO_SELL },
    { o: -1, s: 'sang', f: 'TOFU', p: P.TET, n: 'Tất niên (ngày cuối năm âm lịch)', t: 'Ngày cuối năm âm lịch (tất niên): chúc cả nhà chiều nay sum họp bữa cơm tất niên ấm áp; gợi ý mâm cơm cuối năm vừa đủ, nhẹ nhàng; cảm ơn mọi người đã đồng hành cùng nhóm suốt năm qua.' + NO_SELL + NO_SPIRIT },
    { o: -1, s: 'toi', f: 'TOFU', p: P.TET, n: 'Đêm giao thừa', t: c => 'Đêm giao thừa (bài đăng trước thời khắc giao thừa): lời chúc năm mới ' + c.l.yName + ' an khang, mạnh khỏe, sum vầy; cảm ơn cả nhà một năm đồng hành; mời mọi người gửi lời chúc đầu năm.' + NO_SELL + NO_SPIRIT },
    { o: 0, s: 'sang', f: 'TOFU', t: c => 'Mùng 1 Tết Nguyên Đán năm ' + c.l.yName + ': chúc mừng năm mới cả nhà. Lời chúc năm mới an khang, mạnh khỏe, gia đình sum vầy; 1–2 ý nhẹ nhàng về ăn Tết lành (ăn uống điều độ, giữ nếp ngủ nghỉ, quây quần bên gia đình).' + NO_SELL + NO_SPIRIT + ' Kết bằng lời mời mọi người gửi lời chúc / mong ước năm mới.' },
    { o: 0, s: 'toi', f: 'TOFU', n: 'Tối mùng 1 Tết', t: 'Tối mùng 1 Tết: hỏi thăm cả nhà ngày đầu năm có vui không, đã đi chúc Tết những đâu; mời gửi ảnh gia đình sum vầy, mâm cỗ ngày Tết.' + NO_SELL },
    { o: 1, s: 'sang', f: 'MOFU', p: P.TET, n: 'Mùng 2 Tết', t: 'Mùng 2 Tết (mùng 2 Tết mẹ, nhiều nhà về quê ngoại): lời chúc ngày mùng 2; ăn Tết lành mà vẫn vui: xen rau xanh, trái cây, món thanh nhẹ giữa những bữa nhiều đồ chiên, bánh kẹo; uống đủ nước, đi bộ nhẹ sau bữa ăn; 1 món thanh nhẹ dễ làm từ đồ có sẵn ngày Tết.' + NO_SELL },
    { o: 2, s: 'sang', f: 'TOFU', p: P.TET, n: 'Mùng 3 Tết', t: 'Mùng 3 Tết ("mùng 3 Tết thầy"): chúc các thầy cô trong nhóm, mời mọi người kể về 1 thầy cô mình nhớ; nhắc nhẹ giữ nếp ngủ nghỉ để sẵn sàng đi làm, đi học lại sau Tết.' + NO_SELL }] },
  { id: 'tao', n: 'Ông Công ông Táo (23 tháng Chạp)', k: 'L 23/12', p: P.BIG, parts: [
    { o: 0, s: 'sang', f: 'TOFU', t: '23 tháng Chạp, nhiều gia đình tiễn ông Công ông Táo: dịp dọn dẹp bếp núc, nhà cửa đón Tết; 1–2 mẹo dọn bếp, sắp xếp tủ lạnh gọn sạch trước Tết; hỏi nhà mình đã bắt đầu dọn Tết chưa.' + NO_SELL + NO_SPIRIT }] },
  // ---------------------------------------------------------------- lễ âm lịch khác
  { id: 'nguyentieu', n: 'Rằm tháng Giêng', k: 'L 15/1', p: P.BIG, parts: [
    { o: 0, s: 'sang', f: 'TOFU', t: 'Rằm tháng Giêng (Tết Nguyên Tiêu), ngày rằm lớn đầu năm: lời chúc năm mới bình an, mọi việc hanh thông; gợi ý mâm cơm chay rằm đầu năm thanh đạm cho ai ăn chay; mời mọi người chia sẻ 1 mong ước cho cả năm.' + NO_SELL + NO_SPIRIT }] },
  { id: 'hanthuc', n: 'Tết Hàn thực (3/3 âm)', k: 'L 3/3', p: P.BIG, parts: [
    { o: 0, s: 'sang', f: 'TOFU', t: 'Tết Hàn thực (mùng 3 tháng 3 âm lịch), nhiều nhà làm bánh trôi, bánh chay: hướng dẫn ngắn cách làm bánh trôi tại nhà (bột nếp, nhân đường, có thể giảm ngọt), mời cả nhà khoe bánh nhà mình.' + NO_SELL }] },
  { id: 'gioto', n: 'Giỗ Tổ Hùng Vương (10/3 âm)', k: 'L 10/3', p: P.BIG, parts: [
    { o: 0, s: 'sang', f: 'TOFU', t: 'Giỗ Tổ Hùng Vương (mùng 10 tháng 3 âm lịch): lời nhắc "uống nước nhớ nguồn", biết ơn tổ tiên, ông bà; nhắc chuyện bánh chưng bánh giầy và hạt gạo quê hương; mời kể 1 nếp nhà mình giữ từ ông bà.' + NO_SELL + NO_SPIRIT }] },
  { id: 'phatdan', n: 'Lễ Phật đản (rằm tháng 4)', k: 'L 15/4', p: P.BIG, parts: [
    { o: 0, s: 'sang', f: 'TOFU', t: 'Đại lễ Phật đản (rằm tháng 4 âm lịch): lời chúc an lạc, sống hiền hòa, yêu thương; gợi ý 1–2 món chay thanh nhẹ cho ai ăn chay hôm nay; tôn trọng mọi tín ngưỡng, không giảng đạo.' + NO_SELL }] },
  { id: 'doanngo', n: 'Tết Đoan Ngọ (5/5 âm)', k: 'L 5/5', p: P.BIG, parts: [
    { o: 0, s: 'sang', f: 'TOFU', t: 'Tết Đoan Ngọ (mùng 5 tháng 5 âm lịch): nếp xưa ăn trái cây, cơm rượu nếp, chè kê đầu hè; gợi ý ăn trái cây theo mùa vừa đủ và 1 món giải nhiệt mùa hè dễ làm; hỏi nhà mình có giữ nếp này không.' + NO_SELL + NO_SPIRIT }] },
  { id: 'vulan', n: 'Lễ Vu Lan (rằm tháng 7)', k: 'L 15/7', p: P.BIG, parts: [
    { o: -10, s: 'sang', f: 'MOFU', n: 'Trước mùa Vu Lan', t: 'Mùa Vu Lan sắp tới: chăm cha mẹ lớn tuổi bằng bữa ăn hằng ngày (đồ mềm dễ ăn, đủ đạm, nhiều rau, uống đủ nước, vận động nhẹ); kiến thức phổ thông, ấm áp, dễ làm. Có thể nhắc 1 sản phẩm hợp người lớn tuổi đúng tài liệu, không để link.' },
    { o: -5, s: 'sang', f: 'BOFU', n: 'Quà Vu Lan', t: GIFT('Vu Lan báo hiếu', 'cha mẹ, ông bà') },
    { o: 0, s: 'sang', f: 'TOFU', t: 'Rằm tháng 7, mùa Vu Lan báo hiếu: lời nhắc yêu thương cha mẹ khi còn có thể, gọi điện hoặc về thăm, cùng cha mẹ ăn 1 bữa cơm; mời mọi người kể 1 kỷ niệm đẹp với cha mẹ.' + NO_SELL + NO_SPIRIT }] },
  { id: 'trungthu', n: 'Tết Trung thu (rằm tháng 8)', k: 'L 15/8', p: P.BIG, parts: [
    { o: -7, s: 'sang', f: 'BOFU', n: 'Quà Trung thu', t: GIFT('Trung thu', 'ông bà, cha mẹ, thầy cô, đối tác (đi kèm hộp bánh)') },
    { o: -1, s: 'toi', f: 'TOFU', p: P.BIG, n: 'Tối trước Trung thu', t: 'Mai là Tết Trung thu: rủ cả nhà cùng con làm đèn lồng, bày mâm cỗ đơn giản (trái cây, bánh tự làm ít ngọt); hỏi nhà mình chuẩn bị gì.' + NO_SELL },
    { o: 0, s: 'sang', f: 'TOFU', t: 'Tết Trung thu (rằm tháng 8 âm lịch): chúc các gia đình đoàn viên, các bé vui Trung thu; gợi ý làm bánh / mâm cỗ Trung thu ít ngọt tại nhà cùng con, ăn bánh vừa phải.' + NO_SELL },
    { o: 0, s: 'toi', f: 'TOFU', n: 'Đêm Trung thu', t: 'Đêm Trung thu: mời cả nhà khoe mâm cỗ, đèn lồng, ảnh cả nhà ngắm trăng; lời chúc đoàn viên.' + NO_SELL }] },
  { id: 'hanguyen', n: 'Rằm tháng 10', k: 'L 15/10', p: P.BIG, parts: [
    { o: 0, s: 'sang', f: 'TOFU', t: 'Rằm tháng Mười (nhiều nơi gọi là Tết Hạ Nguyên, gắn với mùa gặt và cơm mới): lời chúc ngày rằm bình an; biết ơn hạt gạo, người trồng lúa và bữa cơm gia đình; gợi ý 1 món từ gạo / gạo lứt dễ làm.' + NO_SELL + NO_SPIRIT + ' Kết bằng câu hỏi: rằm này nhà mình nấu món gì?' }] },
  // ---------------------------------------------------------------- mùng 1 và rằm hằng tháng (lễ có tên ở trên được ưu tiên hơn)
  { id: 'mung1', n: c => 'Mùng 1 ' + mon(c), k: 'L 1', p: P.MOON, parts: [
    { o: 0, s: 'sang', f: 'TOFU', t: c => 'Hôm nay mùng 1 ' + mon(c) + ' âm lịch: chúc mừng cả nhà đón tháng mới. Lời chúc tháng mới bình an, mạnh khỏe, gia đình êm ấm, mọi việc hanh thông; 1–2 ý nhẹ nhàng hợp ngày đầu tháng theo nếp người Việt (sống chậm, biết ơn, bữa cơm thanh đạm hoặc ăn chay với ai có thói quen ngày rằm – mùng 1, chọn 1 thói quen lành để bắt đầu tháng mới).' + NO_SELL + NO_SPIRIT + ' Kết bằng lời mời mọi người chia sẻ 1 mong muốn cho tháng mới.' }] },
  { id: 'ram', n: c => 'Rằm ' + mon(c), k: 'L 15', p: P.MOON, parts: [
    { o: -1, s: 'toi', f: 'TOFU', p: P.MOON, n: c => 'Tối trước rằm ' + mon(c), t: c => 'Mai là rằm ' + mon(c) + ' âm lịch: nhắc nhẹ cả nhà, gợi ý 2–3 món chay dễ nấu, nguyên liệu dễ mua (cho ai có thói quen ăn chay ngày rằm) để sáng mai đi chợ; ai không ăn chay thì gợi ý bữa cơm thanh đạm.' + NO_SELL },
    { o: 0, s: 'sang', f: 'TOFU', t: c => 'Hôm nay rằm ' + mon(c) + ' âm lịch: lời chúc ngày rằm bình an, an lạc; 1–2 ý nhẹ nhàng về sống chậm, biết ơn, bữa cơm thanh đạm cùng gia đình.' + NO_SELL + NO_SPIRIT + ' Kết bằng câu hỏi: rằm này nhà mình nấu món gì?' },
    { o: 0, s: 'toi', f: 'TOFU', n: c => 'Tối rằm ' + mon(c), t: c => 'Tối rằm ' + mon(c) + ': mời mọi người khoe mâm cơm rằm nhà mình (ảnh hoặc kể vài món), hoặc viết 1 điều mình biết ơn trong tháng này; lời chúc ngủ ngon ngắn.' + NO_SELL }] },
  // ---------------------------------------------------------------- lễ dương lịch
  { id: 'tetduong', n: 'Tết Dương lịch', k: 'S 1/1', p: P.BIG, parts: [
    { o: -1, s: 'toi', f: 'TOFU', p: P.BIG, n: 'Tối cuối năm dương lịch', t: 'Tối cuối cùng của năm dương lịch: cảm ơn cả nhà đã đồng hành cùng nhóm cả năm, mời mỗi người kể 1 điều tốt đẹp của năm nay.' + NO_SELL },
    { o: 0, s: 'sang', f: 'TOFU', t: c => 'Năm mới ' + c.s.y + ' (Tết Dương lịch): lời chúc năm mới; gợi ý chọn 1 mục tiêu sống lành nhỏ cho năm mới (ngủ sớm hơn, thêm rau, đi bộ mỗi ngày…); mời mọi người chia sẻ mục tiêu của mình.' + NO_SELL }] },
  { id: 'thaythuoc', n: 'Ngày Thầy thuốc Việt Nam 27/2', k: 'S 27/2', p: P.BIG, parts: [
    { o: 0, s: 'sang', f: 'MOFU', t: 'Ngày Thầy thuốc Việt Nam 27/2: tri ân các y bác sĩ (cả thành viên trong nhóm làm nghề y); nhắc nhẹ thói quen khám sức khỏe định kỳ, làm theo lời khuyên của bác sĩ, ăn uống lành mỗi ngày.' + NO_SELL }] },
  { id: 'pn83', n: 'Quốc tế Phụ nữ 8/3', k: 'S 8/3', p: P.BIG, parts: [
    { o: -4, s: 'sang', f: 'BOFU', n: 'Quà 8/3', t: GIFT('8/3', 'mẹ, vợ, chị em, đồng nghiệp nữ') },
    { o: 0, s: 'sang', f: 'TOFU', t: WOMEN('Quốc tế Phụ nữ 8/3') }] },
  { id: 'le304', n: 'Lễ 30/4 – 1/5', k: 'S 30/4', p: P.BIG, parts: [
    { o: 0, s: 'sang', f: 'TOFU', t: 'Kỷ niệm ngày Giải phóng miền Nam, thống nhất đất nước 30/4 và kỳ nghỉ lễ 30/4 – 1/5: lời chúc kỳ nghỉ vui, an toàn; gợi ý giữ ăn uống lành khi đi chơi xa (mang nước, trái cây, ăn đúng bữa, ngủ đủ).' + NO_SELL }] },
  { id: 'thieunhi', n: 'Quốc tế Thiếu nhi 1/6', k: 'S 1/6', p: P.BIG, parts: [
    { o: 0, s: 'sang', f: 'TOFU', t: 'Quốc tế Thiếu nhi 1/6: chúc các bé vui khỏe; gợi ý bữa phụ / món ăn vặt lành cho trẻ, rủ con cùng vào bếp làm 1 món đơn giản.' + NO_SELL }] },
  { id: 'giadinh', n: 'Ngày Gia đình Việt Nam 28/6', k: 'S 28/6', p: P.BIG, parts: [
    { o: 0, s: 'sang', f: 'TOFU', t: 'Ngày Gia đình Việt Nam 28/6: giá trị bữa cơm gia đình; gợi ý tối nay cả nhà cùng nấu, cùng ăn, cất điện thoại trong bữa; mời khoe bữa cơm nhà mình.' + NO_SELL }] },
  { id: 'tbls', n: 'Ngày Thương binh – Liệt sĩ 27/7', k: 'S 27/7', p: P.BIG, parts: [
    { o: 0, s: 'sang', f: 'TOFU', t: 'Ngày Thương binh – Liệt sĩ 27/7: lời tri ân trang trọng, ngắn gọn, biết ơn các anh hùng liệt sĩ, thương binh và gia đình; giọng trầm lắng, không đùa vui, tối đa 1 emoji.' + NO_SELL }] },
  { id: 'quockhanh', n: 'Quốc khánh 2/9', k: 'S 2/9', p: P.BIG, parts: [
    { o: 0, s: 'sang', f: 'TOFU', t: 'Quốc khánh 2/9: chúc mừng ngày Tết Độc lập, tự hào dân tộc; chúc cả nhà kỳ nghỉ lễ vui, an toàn; gợi ý giữ nếp ăn uống lành khi đi chơi, tụ họp.' + NO_SELL }] },
  { id: 'pn2010', n: 'Phụ nữ Việt Nam 20/10', k: 'S 20/10', p: P.BIG, parts: [
    { o: -4, s: 'sang', f: 'BOFU', n: 'Quà 20/10', t: GIFT('20/10', 'mẹ, vợ, chị em, đồng nghiệp nữ') },
    { o: 0, s: 'sang', f: 'TOFU', t: WOMEN('Phụ nữ Việt Nam 20/10') }] },
  { id: 'nhagiao', n: 'Nhà giáo Việt Nam 20/11', k: 'S 20/11', p: P.BIG, parts: [
    { o: -4, s: 'sang', f: 'BOFU', n: 'Quà 20/11', t: GIFT('tri ân thầy cô 20/11', 'thầy cô của mình và của con') },
    { o: 0, s: 'sang', f: 'TOFU', t: 'Ngày Nhà giáo Việt Nam 20/11: tri ân thầy cô; chúc các thầy cô trong nhóm; mời mọi người kể về 1 thầy cô mình nhớ mãi.' + NO_SELL }] },
  { id: 'noel', n: 'Đêm Giáng sinh', k: 'S 24/12', p: P.BIG, parts: [
    { o: 0, s: 'toi', f: 'TOFU', t: 'Đêm Giáng sinh: lời chúc an lành, ấm áp, sum vầy; gợi ý 1 thức uống ấm cho tối nay (trà gừng, sữa ấm…).' + NO_SELL }] },
  // ---------------------------------------------------------------- ngày đôi mua sắm: chỉ đăng khi Marketing có ưu đãi đang chạy (CRM → Marketing → Ưu đãi)
  ...['11/11', '12/12'].map(dm => ({ id: 'sale' + dm.slice(0, 2), n: 'Ngày đôi ' + dm, k: 'S ' + dm, p: P.SALE, offer: 1, parts: [
    { o: 0, s: 'sang', f: 'BOFU', t: 'Ngày đôi ' + dm + ', nhiều nhà mua sắm: giới thiệu ưu đãi đang chạy (chỉ nói đúng như mục ƯU ĐÃI), sản phẩm hợp với ai; cách đặt trên web (được kiểm hàng trước khi nhận, freeship từ 300k); vui vẻ, không thúc ép; để 1 link sản phẩm.' }] }))
];
for (const e of EVENTS) { const [cal, dm] = e.k.split(' '), [d, m] = dm.split('/').map(Number); e.cal = cal; e.d = d; e.m = m || 0; }

/** 'yyyyMMdd' ± n ngày (lịch dương) */
export const addDay = (day, n) => { const t = new Date(Date.UTC(+day.slice(0, 4), +day.slice(4, 6) - 1, +day.slice(6, 8) + n)); return t.getUTCFullYear() + String(t.getUTCMonth() + 1).padStart(2, '0') + String(t.getUTCDate()).padStart(2, '0'); };
export const weekday = day => new Date(Date.UTC(+day.slice(0, 4), +day.slice(4, 6) - 1, +day.slice(6, 8))).getUTCDay(); // 0 = Chủ nhật

const mem = new Map();
function ctx(day) {
  let c = mem.get(day);
  if (!c) { if (mem.size > 2000) mem.clear(); c = { l: lunar(day), s: { d: +day.slice(6, 8), m: +day.slice(4, 6), y: +day.slice(0, 4) } }; mem.set(day, c); }
  return c;
}
const hit = (e, c) => e.cal === 'S' ? c.s.d === e.d && c.s.m === e.m : c.l.d === e.d && (!e.m || (c.l.m === e.m && !c.l.leap));
const val = (v, c) => typeof v === 'function' ? v(c) : v;

/** Bài theo dịp cho (ngày, khung): lấy dịp ưu tiên cao nhất, không có thì null */
function pick(day, slot, hasOffer) {
  let best = null;
  for (const e of EVENTS) {
    if (e.offer && !hasOffer) continue;
    for (const p of e.parts) {
      if (p.s !== slot) continue;
      const c = ctx(addDay(day, -p.o)); if (!hit(e, c)) continue;
      const pri = p.p || (p.o === 0 ? e.p : P.PRE);
      if (best && best.pri <= pri) continue;
      best = { pri, f: p.f, t: val(p.t, c), ev: val(p.n || e.n, c), offer: !!e.offer };
    }
  }
  return best;
}

/** Chủ đề bài cho (ngày, khung). base(day, slot) = chủ đề theo thứ trong tuần. Trả về { f, t, ev?, quiz?, moved?, offer? } */
export function dayTheme(day, slot, base, hasOffer) {
  const b = base(day, slot), e = pick(day, slot, hasOffer);
  if (e) return { f: e.f, t: e.t, ev: e.ev, quiz: b.quiz, offer: e.offer }; // giữ cờ đố vui: sáng Thứ 5 vẫn công bố đáp án tối qua
  if (slot !== 'sang') return b;
  const prev = addDay(day, -1), pb = base(prev, slot), pe = pb.f === 'BOFU' ? pick(prev, slot, hasOffer) : null;
  if (pe && pe.f !== 'BOFU' && b.f === 'TOFU' && (pick(day, 'toi', hasOffer) || base(day, 'toi')).f !== 'BOFU') return Object.assign({}, pb, { ev: 'Bài bán dời từ hôm qua vì ' + pe.ev, moved: 1 });
  return b;
}

/** Các bài theo dịp trong n ngày tới (CRM → 🤖 Trợ lý Zalo → 📅 Ngày lễ sắp tới) */
export function upcoming(from, n, base) {
  const out = [];
  for (let i = 0; i < n; i++) {
    const d = addDay(from, i);
    for (const s of ['sang', 'toi']) { const t = dayTheme(d, s, base, true); if (t.ev) out.push({ d, s, ev: t.ev, f: t.f, offer: t.offer ? 1 : 0, moved: t.moved ? 1 : 0, lu: ctx(d).l.text }); }
  }
  return out;
}
