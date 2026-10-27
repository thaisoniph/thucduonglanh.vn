---
title: Trợ lý Zalo An Lành
nav: Trợ lý Zalo
order: 8
updated: 2026-10-27
description: Cài đặt và sử dụng tài khoản Zalo "Trợ lý An Lành" trong nhóm Sống khỏe cùng Thực Dưỡng Lành – chào người mới, trả lời, đăng bài, chuyển ca khó cho người thật.
---

Trang này dành cho **người quản lý nhóm Zalo**, **marketing** và **sale trực Zalo**.

## Trợ lý Zalo làm gì?

**"Trợ lý An Lành"** là một tài khoản Zalo riêng, dùng số mới, làm **phó nhóm** "Sống khỏe cùng Thực Dưỡng Lành". Máy tính tự trả lời thay cho tài khoản này, cả ngày lẫn đêm.

Trợ lý tự làm các việc sau:

1. **Chào người mới** vào nhóm, gọi đúng tên @…
2. **Chúc mừng** thành viên vừa nhận quà trên web (cẩm nang, ebook). Chỉ ghi tên Zalo và tên quà, không bao giờ ghi số điện thoại hay bệnh của khách.
3. **Trả lời câu hỏi** trong nhóm về sản phẩm, cách dùng, dinh dưỡng, đặt hàng. Trợ lý chờ khoảng 1,5 phút. Nếu bạn đã trả lời rồi thì trợ lý thôi, không chen vào.
4. **Thả tim** khi thành viên khoe bữa ăn, chia sẻ cảm nhận, cảm ơn.
5. **Duyệt người xin vào nhóm**, nhưng chỉ người đã để số trên web. Người lạ thì Telegram báo để bạn duyệt tay.
6. **Đăng bài** lúc 7h30 và 20h. Bài do AI soạn, **phải được duyệt** mới đăng.
7. **Nhắn riêng**: tự đồng ý kết bạn và tư vấn như chuyên viên. Khách gửi số điện thoại thì CRM tự tạo khách hỏi.

## Trợ lý và người thật chia việc thế nào?

- **Số Zalo mới**: dành cho trợ lý, trả lời tự động.
- **Hotline 0966 326 522**: vẫn do người thật trực như cũ. **Không cài trợ lý lên hotline.**

**Ca khó** là khi khách hỏi đơn hàng, đổi trả, khiếu nại, giá sỉ, bệnh cụ thể, hoặc khách đang bực. Gặp ca khó, trợ lý trả lời ngắn, xin số điện thoại, rồi Telegram báo **"🤖 TRỢ LÝ ZALO CẦN NGƯỜI THẬT"**. Bạn làm trong ngày:

1. **Tin báo có số điện thoại**: gọi hoặc nhắn khách từ **Zalo hotline 0966 326 522**.
2. **Chưa có số**: mở **điện thoại có SIM trợ lý**, nhắn tay cho khách. Trợ lý thấy bạn nhắn thì **tự im 2 tiếng** trong cuộc trò chuyện đó.

Trong nhóm cũng vậy: bạn trả lời ai (bấm trả lời tin hoặc gọi tên @) thì trợ lý không chen vào với người đó.

⚠️ **Tài khoản trợ lý chỉ dùng trên app Zalo của điện thoại.** Không đăng nhập Zalo máy tính hay Zalo web, vì máy chạy trợ lý đang dùng chỗ đó. Đăng nhập vào là trợ lý bị đẩy ra và ngừng chạy.

## Cài đặt lần đầu

**Việc của người quản lý nhóm:**

1. Lắp **SIM mới** vào một điện thoại, cài Zalo, tạo tài khoản. Đặt tên **Trợ lý An Lành**, ảnh đại diện dùng logo Thực Dưỡng Lành.
2. Dùng tay tài khoản này **3–5 ngày**: kết bạn vài người trong công ty, nhắn vài tin. Tài khoản mới mà hoạt động ngay thì Zalo dễ khoá.
3. Vào nhóm "Sống khỏe cùng Thực Dưỡng Lành": **thêm** Trợ lý An Lành vào nhóm. Sau đó vào phần cài đặt nhóm → **Thành viên** → bấm giữ tên Trợ lý An Lành → chọn **Bổ nhiệm làm phó nhóm**.
4. Muốn chỉ người đã để số trên web mới được vào nhóm: vào cài đặt nhóm, bật **Phê duyệt thành viên mới**.
5. Đưa điện thoại có SIM trợ lý cho **anh Sơn** làm bước kết nối bên dưới.

**Việc của anh Sơn (máy Mac, làm 1 lần):**

1. Mở **Terminal**, dán lệnh này rồi bấm Enter:
   ```
   cd ~/Documents/"Website TDL"/website && bash zalo-bot/cai-dat.sh
   ```
2. Máy hiện một **mã QR**. Trên điện thoại có SIM trợ lý: mở Zalo → bấm biểu tượng **QR** ở góc trên → quét mã → bấm **Đăng nhập**.
3. Đợi Terminal báo **"✅ Trợ lý đang chạy nền"** là xong.

**Kiểm tra:** vào CRM → **🤖 Trợ lý Zalo**. Ô trên cùng hiện **🟢 Đang chạy** là được. Máy Mac phải bật và có mạng thì trợ lý mới chạy.

## Mở tab Trợ lý Zalo

Trong CRM bấm **Zalo** trên thanh menu. Quản trị vào từ **Tổng quan → 🤖 Trợ lý Zalo**.

## Việc hằng ngày: duyệt bài đăng

AI soạn sẵn bài cho **hôm nay** và **ngày mai**, rồi Telegram báo **"📝 Bài Zalo chờ duyệt"**. **Bài chưa duyệt thì trợ lý không đăng.**

Mỗi ngày, đọc bài của ngày mai:

1. Bài ổn: bấm **✅ Duyệt**. Tới giờ trợ lý tự đăng.
2. Muốn sửa chữ: sửa ngay trong ô, bấm **💾 Lưu sửa**, rồi bấm **✅ Duyệt**. Chữ đặt giữa `**hai dấu sao**` sẽ in đậm trên Zalo.
3. Muốn AI viết bài khác: bấm **🔄 Viết lại**, gõ ý muốn (ví dụ "nói về hạt óc chó", "ngắn hơn", "vui hơn"), chờ khoảng 30 giây.
4. Không muốn đăng bài này: bấm **⏸ Bỏ bài này**. Đổi ý thì bấm **▶️ Đăng lại bài này**.

**Trước khi duyệt, kiểm tra:**

- Giá và ưu đãi đúng với web.
- Không có chữ "chữa", "điều trị", "khỏi bệnh".
- Bài nói về sản phẩm phải có dòng "không phải là thuốc".

## Gửi tin của mình vào nhóm

Dùng khi có thông báo live, khuyến mãi, sự kiện:

1. Bấm **📣 Gửi tin vào nhóm**.
2. Gõ nội dung.
3. Để trống ô giờ thì trợ lý gửi ngay (trong khoảng 1 phút). Chọn giờ thì trợ lý gửi đúng giờ đó.
4. Bấm **Gửi**.

## Xem trợ lý vừa làm gì

Cuối tab có mục **🕘 Trợ lý vừa làm gì**. Bấm vào từng dòng để xem tin của khách và câu trả lời của trợ lý.

- 👋 Chào người mới · 💬 Trả lời trong nhóm · 📩 Trả lời tin riêng · ❤️ Thả tim
- 🙋 Cần người thật: đã báo Telegram
- 🧑 Nhân sự nhắn tay: trợ lý đang nhường
- 🎉 Chúc mừng nhận quà · 📝 Đăng bài

Thấy trợ lý trả lời chưa đúng thì chụp màn hình gửi anh Sơn để chỉnh.

## Cài đặt trợ lý

Bấm **⚙️ Cài đặt trợ lý** để mở. Đổi xong bấm **Lưu cài đặt**, khoảng 1 phút sau trợ lý làm theo.

- **Bật trợ lý**: bỏ tích là trợ lý im lặng hoàn toàn. Dùng khi có sự cố cần dừng ngay.
- **Nhóm trợ lý chăm sóc**: tích nhóm muốn trợ lý làm việc.
- Bật / tắt từng việc: chào người mới, trả lời câu hỏi, chúc mừng nhận quà, tự duyệt.
- **Bài đăng**:
  - **Chờ duyệt** (đang dùng): chỉ đăng bài đã bấm Duyệt.
  - **Tự đăng**: tới giờ là đăng, kể cả bài chưa ai xem. Chỉ chuyển sang chế độ này khi anh Sơn đồng ý.
- **Giờ đăng**: mặc định 7h30 và 20h. Bỏ tích buổi nào thì buổi đó không đăng.
- **Tối đa số câu trả lời / nhóm / giờ**: để trợ lý không nói quá nhiều (mặc định 8).

## Khi có sự cố

- **Tab báo 🔴 Mất kết nối** hoặc Telegram báo **"⚠️ Trợ lý Zalo mất kết nối"**: máy Mac chạy trợ lý đang tắt hoặc mất mạng. Báo anh Sơn.
- **Telegram báo "⚠️ Trợ lý Zalo bị đăng xuất"**: cần quét lại mã QR. Mang điện thoại SIM trợ lý tới anh Sơn.
- **Zalo khoá tài khoản trợ lý**: nhóm không sao vì anh Sơn vẫn là trưởng nhóm. Dùng SIM khác, làm lại phần cài đặt lần đầu.
- **Trợ lý nói sai, cần dừng gấp**: tab Trợ lý Zalo → ⚙️ Cài đặt → bỏ tích **Bật trợ lý** → **Lưu cài đặt**.
