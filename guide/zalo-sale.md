---
title: Zalo của sale
nav: Zalo của sale
group: quan-ly
short: Xem sale chăm khách qua Zalo, báo khách chờ lâu
order: 9
updated: 2026-11-15
description: Xem sale đang nhắn Zalo chăm sóc khách như thế nào ngay trong CRM, mà sale vẫn dùng Zalo như cũ. Dành cho Quản lý và Quản trị.
roles: [ql]
---

Trang này dành cho **Quản lý** và **Quản trị**.

## Để làm gì?

Mỗi sale được công ty cấp **1 số Zalo riêng** để chăm khách. Tính năng này giúp bạn **xem sale đang nhắn Zalo với khách thế nào** ngay trong CRM, để biết sale tư vấn có tốt không, có bỏ quên khách không.

Quan trọng: **sale không phải đổi thói quen**. Sale vẫn dùng Zalo trên điện thoại và máy tính như cũ. Một chương trình chạy trên máy chủ công ty **chỉ đọc** tin nhắn riêng của sale với khách rồi đưa về CRM. Chương trình **không bao giờ gửi tin thay sale**.

## Bạn xem được gì

Mở tab **👀 Zalo của sale** (trong **••• Thêm**):

- **🟢 / 🔴 từng sale**: chương trình đọc đang chạy hay mất kết nối. 🔴 nghĩa là máy tắt / mất mạng / Zalo bắt đăng nhập lại — tin trong lúc đó chưa được lưu.
- **💬 Khách đang chờ trả lời**: khách nhắn sau cùng mà sale chưa trả lời. Bấm vào để đọc cả cuộc trò chuyện.
- **📊 Hôm nay từng sale**: mỗi sale hôm nay có bao nhiêu khách nhắn, trả lời bao nhiêu, trung bình trả lời sau bao lâu, đang để mấy khách chờ.
- **🕐 Trò chuyện gần đây**: danh sách các cuộc gần nhất, bấm để xem.

Trong **hồ sơ khách** (tab Khách đã mua / Khách hỏi) cũng có mục **💬 Zalo của sale với khách này**, bấm để xem toàn bộ tin Zalo của khách đó.

## Báo Telegram

Khi khách nhắn Zalo mà **quá 30 phút chưa ai trả lời** (trong giờ làm), hệ thống nhắc vào nhóm Telegram và nhắn riêng cho sale phụ trách. Đổi số phút ở **⚙️ Cài đặt** cuối tab (chỉ Quản trị).

## Kết nối 1 sale (bấm ngay trong CRM)

Sau khi người kỹ thuật đã **cài 1 lần** (xem dưới), mọi việc bạn làm trong CRM:

1. Tab **👀 Zalo của sale** → bấm **➕ Kết nối Zalo của 1 sale**.
2. Chọn / gõ **tên sale** → bấm **Kết nối**. Một **mã QR** hiện ra ngay trong trang.
3. Đưa máy cho **sale đó**: mở Zalo trên điện thoại → biểu tượng **QR** → **Quét mã** → **Đăng nhập**.
4. Xong. Thẻ sale chuyển 🟢. Sale **vẫn dùng Zalo điện thoại bình thường**.

Ngắt theo dõi 1 sale: bấm dấu **✕** cạnh tên sale.

## Lưu ý quan trọng

- **Chạy thử trước**: đây là tính năng mới, nên thử với **1 sale** trong 1–2 tuần rồi mới mở rộng.
- **Đúng luật (Luật 91/2025)**: Zalo này là **của công ty cấp cho công việc**. Trước khi bật, hãy **ghi vào nội quy / hợp đồng** rằng Zalo công việc được lưu lại để kiểm tra chất lượng, và **cho sale ký đồng ý**. Chỉ dùng cho việc công ty, không dùng cho việc riêng.
- **Chỉ Quản lý và Quản trị** thấy mục này. Sale không xem Zalo của sale khác.
- Chỉ lưu **tin chữ** của tin nhắn riêng (1–1). Không đụng nhóm Zalo. Tin tự xoá sau 12 tháng.
- **Chỉ lấy tin từ lúc kết nối trở đi**, không lấy được tin cũ.

## Cài 1 lần lên máy chủ (người kỹ thuật, 1 lệnh)

Trên máy Mac (đã vào SSH được VPS như trợ lý An Lành):

```
bash zalo-bot/cai-zalo-sale.sh tdl-vps
```

Chỉ cần chạy 1 lần cho cả công ty. Không phải đặt khoá mới (tự dùng lại khoá của trợ lý An Lành). Xong rồi mọi việc kết nối/ngắt từng sale làm trong CRM như trên.

Chi tiết kỹ thuật ở `zalo-bot/README.md` và `HUONG-DAN.md`.
