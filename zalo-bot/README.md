# 🤖 Trợ lý An Lành trong nhóm Zalo

Tài khoản Zalo **"Trợ lý An Lành"** (SIM riêng) làm phó nhóm "Sống khỏe cùng Thực Dưỡng Lành". Trợ lý làm các việc sau:

- **Chào người mới** vào nhóm, gọi tên @… (người vào trong cùng 1 phút được chào chung 1 tin).
- **Trả lời câu hỏi** trong nhóm bằng kiến thức của An Lành trên web. Trợ lý chờ 1,5 phút; nếu trưởng / phó nhóm đã trả lời thì thôi. Ai gọi tên hoặc trả lời tin của trợ lý thì trợ lý trả lời ngay. Câu cần người thật thì báo Telegram.
- **Thả tim** khi thành viên chia sẻ bữa ăn lành, cảm nhận, lời cảm ơn.
- **Chúc mừng** thành viên vừa nhận quà trên web (như nhóm Sống Khỏe 365). Tin chúc mừng chỉ có tên Zalo và tên quà, không có số điện thoại, không nhắc bệnh.
- **Tự duyệt người xin vào nhóm** nếu họ đã để số qua cổng /nhom-zalo/ hoặc nhận quà trên web (trợ lý tìm Zalo theo số). Người lạ thì báo Telegram để nhân sự duyệt tay.
- **Đăng bài** sáng 7h30 và tối 20h. AI soạn trước theo lịch chủ đề trong tuần; **bài phải được duyệt** ở CRM → **🤖 Trợ lý Zalo** mới được đăng (đổi sang tự đăng trong ⚙️ Cài đặt).
- **Nhắn riêng**: tự đồng ý kết bạn, chào, trả lời như An Lành. Khách gửi số điện thoại thì CRM tự tạo khách hỏi (kênh "Zalo Trợ lý An Lành").
- CRM tự ghi **"Đã vào nhóm"** cho khách đã để số trên web khi họ vào nhóm.

Phần "bộ não" (AI, quyết định, bài đăng) nằm ở máy chủ: `api/src/zbot.js`. Thư mục này chỉ là chương trình giữ tài khoản Zalo, dùng thư viện zca-js (không chính thức).

## Cài trên máy Mac (1 lần)

1. Điện thoại có SIM riêng, cài Zalo, đăng nhập tài khoản "Trợ lý An Lành". Nên dùng tay 3–5 ngày trước: đặt ảnh đại diện, kết bạn vài người, nhắn vài tin.
2. Trong nhóm Zalo: thêm "Trợ lý An Lành" vào nhóm → **đặt làm phó nhóm** (để duyệt thành viên). Bật **Duyệt thành viên mới** nếu muốn chỉ người đã để số mới được vào.
3. Trên Mac, mở Terminal, chạy:
   ```
   cd ~/Documents/"Website TDL"/website && bash zalo-bot/cai-dat.sh
   ```
   Mã QR hiện lên → trên điện thoại "Trợ lý An Lành": Zalo → biểu tượng QR → quét → **Đăng nhập**.
4. Xong. Trợ lý chạy nền, tự bật lại khi khởi động máy. Vào CRM → 🤖 Trợ lý Zalo xem trạng thái 🟢.

**Mac phải bật và có mạng** thì trợ lý mới chạy. Vào Cài đặt hệ thống → Màn hình khoá / Pin → bật "Ngăn máy tự ngủ khi tắt màn hình" (khi cắm sạc). Muốn chạy 24/7 không phụ thuộc Mac: thuê máy chủ nhỏ (VPS khoảng 100–150k/tháng), cài Node.js 20+, chép thư mục này lên, rồi chạy `npm ci && node bot.js` (dùng pm2 để tự bật lại).

## Khi có sự cố

- **Telegram báo "bị đăng xuất"**: mở Terminal, chạy `open ~/.tdl-zalo-bot/qr.png` rồi quét lại bằng điện thoại "Trợ lý An Lành". Mã QR hết hạn sau khoảng 1 phút, trợ lý tự tạo mã mới; nếu mở ra thấy mã cũ thì chạy lại lệnh `open`.
- **Telegram báo "mất kết nối"**: kiểm tra Mac có đang bật, có mạng. Xem nhật ký: `tail -50 ~/.tdl-zalo-bot/bot.log`.
- **Không mở Zalo của tài khoản trợ lý trên máy tính khác** (Zalo PC / web). Mở thì trợ lý bị đẩy ra; đóng bớt rồi chạy lại `bash zalo-bot/cai-dat.sh`.
- **Cập nhật code** (sau khi sửa `bot.js`): chạy lại `bash zalo-bot/cai-dat.sh`. Mã bí mật và phiên đăng nhập vẫn giữ nguyên.
- **Tắt trợ lý ngay**: CRM → 🤖 Trợ lý Zalo → ⚙️ Cài đặt → bỏ tích "Bật trợ lý" (có hiệu lực sau khoảng 1 phút).

## Để Zalo không khoá tài khoản

- Trợ lý **không tự nhắn cho người lạ**. Nó chỉ trả lời người nhắn trước, đồng ý kết bạn, và nói trong nhóm.
- Mỗi tin cách nhau vài giây và có "đang soạn tin" như người thật. Mỗi nhóm tối đa 8 câu trả lời / giờ (đổi được ở Cài đặt). Từ 21h45 đến 6h không chủ động nói trong nhóm.
- Đây là cách không chính thức. Zalo có thể khoá tài khoản trợ lý, nhưng nhóm không bị ảnh hưởng vì anh Sơn vẫn là trưởng nhóm. Nếu bị khoá thì dùng SIM khác, cài lại.

## Bí mật (không đưa lên GitHub)

`~/.tdl-zalo-bot/.env` (ZBOT_KEY, phải giống secret `ZBOT_KEY` của Worker `thucduonglanh-api`) và `~/.tdl-zalo-bot/creds.json` (phiên đăng nhập Zalo). Ai có `creds.json` là dùng được tài khoản trợ lý, nên không gửi file này cho ai.
