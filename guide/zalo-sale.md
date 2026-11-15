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

## Lưu ý quan trọng

- **Chạy thử trước**: đây là tính năng mới, nên thử với **1 sale** trong 1–2 tuần rồi mới mở rộng.
- **Đúng luật (Luật 91/2025)**: Zalo này là **của công ty cấp cho công việc**. Trước khi bật, hãy **ghi vào nội quy / hợp đồng** rằng Zalo công việc được lưu lại để kiểm tra chất lượng, và **cho sale ký đồng ý**. Chỉ dùng cho việc công ty, không dùng cho việc riêng.
- **Chỉ Quản lý và Quản trị** thấy mục này. Sale không xem Zalo của sale khác.
- Chỉ lưu **tin chữ** của tin nhắn riêng (1–1). Không đụng nhóm Zalo. Tin tự xoá sau 12 tháng.
- **Chỉ lấy tin từ lúc kết nối trở đi**, không lấy được tin cũ.

## Bật cho 1 sale (người kỹ thuật làm)

1. Đặt khoá chung cho máy chủ 1 lần: `npx wrangler secret put ZSALE_KEY` (máy chủ `thucduonglanh-api`).
2. Trên máy chủ (VPS), cài người đọc cho 1 sale: `ZSALE_KEY=… bash zalo-bot/cai-sale.sh tdl-vps thuy "Chị Thuý"`, rồi quét mã QR bằng Zalo của sale đó (giống đăng nhập Zalo trên máy tính).
3. Tắt theo dõi 1 sale: `ssh tdl-vps systemctl disable --now tdl-zalo-sale-thuy`.

Chi tiết kỹ thuật ở `zalo-bot/README.md` và `HUONG-DAN.md`.
