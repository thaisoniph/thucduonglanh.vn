---
title: Kho hàng
nav: Kho
order: 4.5
updated: 2026-11-06
description: Theo dõi hàng còn trong kho, nhận tin khi sắp hết, ghi đặt nhà cung cấp, nhập hàng, xuất quà tặng / đại lý, kiểm kho cuối tuần.
---

Trang này dành cho **người phụ trách kho**, **Quản lý** và **Quản trị**.

## Kho trên CRM làm gì?

- Máy **tự trừ kho** khi đơn được gửi đi: đơn web, đơn sale, đơn sàn (Shopee, TikTok Shop). Đơn có quà 🎁 thì trừ cả quà.
- Máy tính mỗi sản phẩm **còn đủ bán bao nhiêu ngày**.
- Sắp hết thì máy **nhắn Telegram** cho người phụ trách kho, nói rõ **nên đặt bao nhiêu**.
- Máy nhắc mỗi sáng **cho đến khi bạn ghi "Đã đặt NCC"**. Quá 1 buổi sáng chưa ghi thì máy báo Quản trị.
- Hàng quá ngày hẹn chưa về thì máy cũng nhắc để gọi giục nhà cung cấp (NCC).

**Ai vào được:** người được Quản trị tích ô **📦 Phụ trách kho** (Cài đặt → Nhân sự), Quản lý, Quản trị.
Người phụ trách kho mở CRM là vào thẳng tab **📦 Kho**. Quản lý, Quản trị mở ở **••• Thêm** → **Kho**.

## Bắt đầu (làm 1 lần)

**Bước 1: Nối Telegram** để nhận tin sắp hết hàng. Cách làm ở trang [CRM](/huong-dan/crm/) (mục Nối Telegram). Chưa nối thì tin chỉ vào nhóm chung, dễ bị trôi.

**Bước 2: Thêm sản phẩm.** Lần đầu, tab Kho có sẵn danh sách sản phẩm trên web. Tích sản phẩm có trong kho, ghi **số ngày NCC giao hàng** của từng loại, bấm **＋ Thêm các sản phẩm đã chọn**.
Sản phẩm khác (Progomax, Gafo, Mầm xôi…): bấm **＋ Thêm sản phẩm kho**.

- **Tên:** ghi rõ **loại + trọng lượng**, ví dụ "Trà DILVANG hộp 75g", "Fucoidan Progomax 900g". Máy dựa vào tên này để nhận ra hàng trong đơn.
- Cùng loại có 2 cỡ (hộp 400g và hộp 125g) thì tạo 2 sản phẩm.
- **NCC giao mất mấy ngày:** tính từ lúc đặt tới lúc hàng về kho. Mỗi sản phẩm một số riêng.
- **Dự phòng** (mặc định 7 ngày): để kịp khi NCC giao trễ hoặc bán chạy hơn.
- **Mỗi lần đặt đủ bán** (mặc định 30 ngày): máy dựa vào đây để gợi ý số lượng nên đặt.
- **Mức tối thiểu** (không bắt buộc): luôn giữ ít nhất bấy nhiêu hàng, kể cả khi bán chậm.

**Bước 3: Đếm kho.** Đếm từng sản phẩm, bấm **🧮 Kiểm kho**, nhập số đếm được, bấm **Lưu số đếm**. Từ lúc này máy bắt đầu tự trừ.
Hàng đã đóng gói nhưng hãng vận chuyển chưa lấy **vẫn đếm là còn trong kho**.

## Việc hằng ngày

**1. Đọc tin Telegram 8 giờ sáng.** Tin "📦 Kho sáng…" cho biết sản phẩm nào cần đặt, hàng nào về trễ. Không có việc gì thì không có tin.

**2. Khi máy báo "Cần đặt hàng":**

1. Gọi hoặc nhắn NCC để đặt hàng. Số nên đặt có sẵn trong tin và trên thẻ sản phẩm.
2. Trên CRM, bấm **🛒 Đã đặt NCC** ở thẻ sản phẩm đó.
3. Ghi **số lượng đã đặt** và **ngày NCC hẹn giao**, bấm **Lưu**. Máy thôi nhắc.

NCC hẹn lại ngày khác: bấm **✏️ Đổi hẹn / huỷ** trên thẻ sản phẩm.

**3. Khi hàng về:** bấm **📥 Hàng về** ở thẻ sản phẩm. Kiểm số lượng thật rồi sửa nếu khác, bấm **Nhập kho**.
NCC mới giao một phần thì tích **"NCC mới giao một phần, phần còn lại giao sau"**: máy vẫn chờ phần còn lại.

**4. Khi xuất hàng không theo đơn** (quà tặng, đại lý / bán sỉ, livestream, hàng mẫu, hàng hỏng): bấm **📤 Xuất khác**, chọn sản phẩm, số lượng, lý do.
Không ghi thì lần kiểm kho sau sẽ thấy lệch.

**5. Đơn bị hoàn:** khi nhận đủ hàng hoàn về kho, mở đơn trong tab **Đơn hàng**, bấm **📦 Kho đã nhận**. Máy tự cộng lại vào kho.

## Kiểm kho cuối tuần (thứ 6)

Sáng thứ 6, tin Telegram nhắc kiểm kho.

1. Đếm thật từng sản phẩm.
2. Bấm **🧮 Kiểm kho**, nhập số đếm được. Dưới tên mỗi sản phẩm có số máy đang tính để bạn so.
3. Đếm buổi sáng mà chiều mới nhập thì sửa giờ ở ô **Đếm lúc**.
4. Bấm **Lưu số đếm**. Máy lấy số bạn đếm làm số đúng. Nếu có lệch, máy báo Quản trị.

Lệch thường do: quà tặng, hàng mẫu, hàng hỏng chưa ghi **Xuất khác**, hoặc đơn bán ngoài CRM.
Đổi ngày kiểm kho: **⚙️ Cài đặt kho** ở cuối tab Kho.

## Màu trên thẻ sản phẩm

| Nhãn | Nghĩa |
| --- | --- |
| 🟢 Đủ hàng | Chưa cần làm gì |
| 🟠 Cần đặt hàng | Đặt NCC ngay hôm nay |
| 🔴 Đặt gấp | Sẽ hết trước khi hàng kịp về, gọi NCC ngay |
| 🔴 Hết hàng | Không còn hàng để gửi khách |
| ⏳ Đã đặt, chờ hàng về | Đã ghi đặt NCC, đang chờ |
| 🔴 Hàng về trễ | Quá ngày hẹn mà chưa nhập kho, gọi giục NCC |
| 🟠 Có thể hết trước khi hàng về | Đã đặt nhưng hàng hiện có không đủ bán tới ngày hẹn |
| ⚪ Chưa nhập số tồn | Cần đếm và nhập ở 🧮 Kiểm kho |

## Ghép tên hàng

Đơn sale, đơn sàn hay ghi tên sản phẩm mỗi người một kiểu. Máy tự đọc **loại + trọng lượng**, combo, "Mua 3 tặng 1", "Combo 5 hộp".
Tên nào máy chưa hiểu thì hiện ở mục **🔗 Ghép tên hàng** (cuối tab Kho). Hàng có tên này **chưa bị trừ kho**.

1. Bấm **Ghép** ở tên đó.
2. Chọn sản phẩm trong kho, ghi số lượng trong 1 suất. Ví dụ "Combo quà Tết" gồm 2 hộp trà + 1 hũ ruốc: thêm 2 dòng.
3. Tên không phải hàng trong kho (phí ship, dịch vụ…): bấm **Không trừ kho**.

Máy tự tính lại các đơn có tên đó.

## Ghi nhầm thì sao?

- Trong **🕘 Lịch sử nhập / xuất / kiểm kho**, bấm **↩️ Xoá** ở dòng ghi nhầm (được xoá trong 7 ngày), rồi ghi lại.
- Ghi nhầm lâu hơn 7 ngày: đếm lại rồi **🧮 Kiểm kho**, máy lấy số mới.

## Hỏi nhanh

**Máy trừ kho lúc nào?** Khi đơn chuyển sang **Đang giao**. Đơn **Mới / Đã xác nhận** là "chờ gửi": chưa trừ, nhưng máy đã tính vào số ngày còn đủ bán. Đơn **Huỷ** không trừ.

**Đơn sàn trừ kho lúc nào?** Khi người phụ trách sàn tải **file đơn hàng** của sàn lên tab Sàn. Số gõ tay vào Google Sheet báo cáo sàn không có tên sản phẩm nên máy không trừ được: kiểm kho cuối tuần sẽ sửa phần này.

**"Bán ~4 hộp / ngày" tính sao?** Máy lấy số cao hơn giữa trung bình 30 ngày và 14 ngày gần nhất (gồm đơn đã gửi và hàng xuất khác, không tính hàng hỏng). Tuần bán chạy thì máy báo đặt hàng sớm hơn.

**Khi nào máy báo cần đặt?** Khi hàng còn lại (đã trừ đơn chờ gửi, cộng hàng đã đặt chưa về) chỉ đủ bán ít hơn **số ngày NCC giao + số ngày dự phòng**.

**Sao số kho bị âm?** Có hàng đi ra mà chưa ghi (đơn ngoài CRM, quà tặng chưa ghi Xuất khác). Đếm lại rồi **🧮 Kiểm kho**.

**Muốn xem trên Google Sheet?** File Sheet "Đơn hàng website Thực Dưỡng Lành" có tab **CRM · Kho nhập xuất** và **CRM · Kho đặt NCC** (6 tiếng cập nhật 1 lần, chỉ để xem).
