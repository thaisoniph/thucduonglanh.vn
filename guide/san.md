---
title: Trợ lý sàn Shopee
nav: Sàn Shopee
group: ban-hang
short: Chấm sức khoẻ shop mỗi sáng, xem đối thủ đầu tuần
order: 2.7
updated: 2026-11-16
description: Người phụ trách sàn chấm sức khoẻ shop Shopee mỗi sáng và xem đối thủ cùng ngách đầu tuần ngay trong tab Sàn của CRM, thay cho skill rời trên máy.
roles: [ql]
---
Trang này dành cho **người phụ trách sàn Shopee**. Quản trị chọn người phụ trách ở tab **Sàn → 👤 Người phụ trách sàn**.

> **Một câu dễ nhớ:** Sáng nào cũng **tải file → 🩺 Chấm → làm 3 việc → ✅**. Thứ Hai thì **chụp Shopee → 🔍 Xem đối thủ**.

## Việc của bạn mỗi ngày, mỗi tuần

**Làm 1 lần:** dán cách đánh giá bạn đang dùng (nội dung skill Claude trên máy) vào CRM ([Việc 1](#viec-1-dan-cach-danh-gia)). Không dán thì CRM dùng cách mặc định.

**Mỗi sáng (khoảng 2 phút):** Telegram 8h báo số Shopee hôm qua. Tải file mới, bấm **🩺 Chấm sức khoẻ shop**, làm 3 việc, bấm **✅ Đã làm** ([Việc 2](#viec-2-cham-suc-khoe-shop)).

**Thứ Hai (khoảng 5 phút):** chụp màn hình Shopee của đối thủ, bấm **🔍 Xem đối thủ tuần này** ([Việc 3](#viec-3-xem-doi-thu-dau-tuan)).

## Việc 1: Dán cách đánh giá

[[steps:san-cach]]

- Dán **nguyên văn** nội dung skill cũng được, AI tự đọc và làm theo. Không cần dán số liệu, CRM tự gửi số mới nhất.
- Muốn đổi cách đánh giá thì sửa lại ô này bất cứ lúc nào.

## Việc 2: Chấm sức khoẻ shop

[[steps:san-suc-khoe]]

- **CRM tự tính:** doanh số, số đơn, giá trị 1 đơn, tỷ lệ huỷ + hoàn, tiền thực về, sản phẩm tăng / giảm, tiến độ mục tiêu tháng. Kỳ so sánh là **7 ngày gần nhất với 7 ngày trước đó**.
- **File đơn hàng / doanh thu** tự nhập vào số sàn như nút **📤 Tải file từ sàn**, không phải tải 2 lần.
- **File khác** (quảng cáo, phân tích bán hàng, lượt truy cập…) AI đọc khoảng 200 dòng đầu mỗi file.
- Không có file mới vẫn chấm được bằng số đã có (Google Sheet báo cáo, file tải hôm trước).
- Chấm lại trong ngày được (tối đa 20 lần / ngày cả công ty). Các lần trước xem ở **🗂 Các lần chấm trước**.

## Việc 3: Xem đối thủ đầu tuần

[[steps:san-doi-thu]]

- AI **chỉ ghi số đọc được trong ảnh**. Ảnh mờ, bị che thì số đó để "?". Chụp rõ chữ giá và "Đã bán".
- CRM tự lấy **giá bán của mình** (đơn Shopee 30 ngày) để so.
- Phương án không bao giờ khuyên bán dưới giá có lãi. Đổi giá lớn thì hỏi anh Sơn trước.

## Hỏi nhanh

| Gặp gì | Làm gì |
| --- | --- |
| "Chưa có số Shopee" | Tải file đơn hàng Shopee hoặc gõ Google Sheet báo cáo trước |
| "AI đang bận" | Chờ 1 phút rồi bấm lại |
| "Hôm nay đã dùng hết lượt" | Mai làm tiếp, hoặc nhờ anh Sơn |
| Việc AI gợi ý không làm được | Bỏ qua, ghi vào ô **Bạn ghi thêm** lần sau để AI biết |
