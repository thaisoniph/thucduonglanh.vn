---
title: Kế toán
nav: Kế toán
order: 4.6
updated: 2026-11-09
description: Ghi tiền về tài khoản (tải file đối soát COD Best / Viettel Post hoặc tích tay), xem tiền còn treo ở hãng vận chuyển, nhập chi phí, xem lãi lỗ theo ngày / tuần / tháng. Có hình từng bước.
---

Trang này dành cho **kế toán**. Đọc khoảng 5 phút là làm được.

> **Mỗi ngày chỉ cần:** mở **💼 Kế toán**, tải file đối soát COD mới nhất của hãng, rồi tích các đơn chuyển khoản đã thấy tiền trên sao kê VCB. Xong là anh Sơn xem được lãi lỗ và tiền thật gần như ngay lúc đó.

**Cách xem hình:** ô khoanh đỏ có số **1, 2, 3** trên hình chính là **bước 1, 2, 3** viết ngay bên dưới hình.

## Tài khoản Kế toán thấy gì?

- Chỉ có tab **💼 Kế toán** và **Cài đặt**.
- Thấy đơn hàng: mã đơn, ngày, sale bán, sản phẩm, số tiền, trạng thái, hãng, mã vận đơn, **tên khách và 4 số cuối SĐT**.
- Thấy **số hàng tồn kho** (chỉ xem, do người kho ghi trên CRM) và giá trị tồn kho tính bằng tiền.
- **Không thấy** SĐT đầy đủ, địa chỉ, ghi chú chăm sóc. Không chăm sóc khách, không nhận khách mới.
- 8h sáng nhận tin **💼 Tài chính** qua Telegram: tiền còn treo ở hãng, tiền về hôm qua, chuyển khoản chờ xác nhận, lãi lỗ. Nối Telegram ở **Cài đặt → 📲 Thông báo Telegram riêng** (làm 1 lần, 30 giây).

## Quản trị cấp quyền Kế toán (làm 1 lần)

![Chọn quyền Kế toán (1), bấm Lưu nhân sự (2)](/huong-dan/img/ke-toan-quyen.webp)

Quản trị vào **Cài đặt → Nhân sự được vào CRM**, thêm email của kế toán (hoặc tìm dòng có sẵn), rồi:

1. Ở ô **Quyền**, chọn **Kế toán**.
2. Bấm **Lưu nhân sự**.

Kế toán đăng nhập CRM bằng email đó (mã 6 số gửi về email) là vào thẳng tab **💼 Kế toán**. Quản trị muốn xem tab này: bấm **••• Thêm** → **Kế toán**.

## Màn hình 💼 Kế toán

![Màn hình đầu: hướng dẫn bắt đầu (1), tải file COD (2), tiền treo (3), từng hãng (4)](/huong-dan/img/ke-toan-tab.webp)

1. Lần đầu dùng có khung **👋 Bắt đầu**. Khung này tự ẩn sau lần đầu ghi tiền về.
2. Nút **📥 Tải file đối soát COD**: cách nhanh nhất để ghi tiền về (xem mục dưới).
3. Ô **💤 Đang treo ở hãng vận chuyển**: đơn **đã giao xong** mà hãng **chưa trả tiền** cho công ty. Ô đỏ khi có đơn quá **10 ngày**. Bấm vào ô để xem từng đơn.
4. **Tiền treo theo hãng**: Best, Viettel Post riêng. Dòng chữ đỏ = số đơn quá 10 ngày: gọi hỏi hãng.

4 ô ở trên cùng:

| Ô | Nghĩa là |
|---|---|
| ✅ **Đã về** | Tiền đã ghi nhận về tài khoản trong kỳ đang xem (tính theo **ngày tiền về**) |
| 💤 **Đang treo ở hãng** | Đơn COD đã giao, hãng chưa trả tiền |
| 🏦 **Chuyển khoản chờ xác nhận** | Đơn khách chuyển khoản, kế toán chưa đối chiếu sao kê |
| 🚚 **Tiền sắp về** | Đơn COD còn đang giao |

## Tải file đối soát COD (mỗi ngày hoặc mỗi tuần)

Lấy file trên trang của hãng:

- **Best**: trang Best → **Đối soát COD** → Chi tiết đơn → **Xuất Excel** (chọn cả tháng).
- **Viettel Post**: Quản lý vận đơn → **Xuất danh sách vận đơn** (file có cột **Trạng thái thanh toán**).

![Chọn file (1), số tiền hãng đã trả (2), đơn lệch tiền (3), bấm Ghi tiền về (4)](/huong-dan/img/ke-toan-cod.webp)

1. Bấm **📥 Tải file đối soát COD** → **Chọn tệp** → chọn file vừa tải.
2. Máy đọc file ngay, chia 3 ô: **✅ Hãng đã trả, chưa ghi**, **💤 Hãng chưa trả**, **❓ Không thấy trong CRM**.
3. Đơn **tô đỏ** = hãng thu khác số tiền trên đơn. Máy vẫn ghi theo số hãng thu. Hỏi sale hoặc hãng vì sao lệch. Đơn nào không muốn ghi thì bỏ tích.
4. Bấm **✅ Ghi tiền về … đơn**. Xong.

Ghi chú:

- Tải lại cùng file cũng không sao: đơn đã ghi rồi thì máy bỏ qua.
- Máy ghi luôn **ngày hãng trả tiền**, **mã phiếu thanh toán** (Best) và **phí ship thật** của đơn.
- **❓ Không thấy trong CRM**: đơn chưa lên CRM hoặc sai mã. Mở dòng đó xem mã vận đơn rồi báo sale.
- Hãng báo giao thành công mà CRM còn ghi "Đang giao": máy nhắc báo Quản lý chạy **📦 Đối soát vận chuyển** ở tab Đơn hàng. Kế toán không đổi trạng thái đơn.

## Ghi tiền về bằng tay (chuyển khoản VCB, hoặc không có file)

![Tìm đơn (1), tích đơn (2), ngày tiền về (3), bấm Đã nhận tiền (4)](/huong-dan/img/ke-toan-ck.webp)

Bấm ô **🏦 Chuyển khoản chờ xác nhận** (hoặc nút **✅ Ghi tiền về bằng tay** cho đơn COD). Mở sao kê VCB bên cạnh.

1. Gõ **mã đơn**, **mã vận đơn**, **tên** hoặc **4 số cuối SĐT** để tìm nhanh. Nội dung chuyển khoản thường có mã đơn hoặc tên khách.
2. Thấy tiền về **đúng số tiền** thì tích ✓ đơn đó. Tích được nhiều đơn một lúc.
3. Chọn **ngày tiền về** (mặc định hôm nay).
4. Bấm **✅ Đã nhận tiền**.

**Ghi nhầm?** Bấm ô **✅ Đã về** → tích đơn ghi nhầm → **↩ Bỏ ghi tiền về**. Đơn quay lại danh sách chờ tiền.

## Nhập chi phí và xem lãi lỗ

Lãi lỗ ở tab này **cùng số** với Tổng quan của anh Sơn.

![Chọn kỳ xem](/huong-dan/img/ke-toan-ky.webp)

1. Chọn kỳ muốn xem: **Hôm nay**, **Tuần này**, **Tháng này**, **Tháng trước**… hoặc **📅 Khác** để tự chọn ngày.

![Lãi lỗ từng ngày (2), nhập chi phí (3), tải file kế toán (4)](/huong-dan/img/ke-toan-lai-lo.webp)

2. **💵 Lãi lỗ thật**: hôm nay, từ đầu tháng, dự kiến cả tháng; cột đỏ / xanh từng ngày; mỗi ngày cần bán bao nhiêu để hoà vốn. Bấm **Xem từng ngày** để xem bảng.
3. Mở **🧮 Lãi lỗ sau mọi chi phí** → **✏️ Nhập chi phí tháng …**: gõ từng khoản (thuê văn phòng, lương, điện, nước, tiền ship trả hãng…), bấm Lưu.
4. Hoặc **📎 Tải file kế toán** (file báo cáo tháng) và **👥 Tải bảng lương**: máy tự đọc các khoản chi phí.

Ghi chú:

- Tháng này chưa nhập chi phí thì máy **tạm lấy theo tháng gần nhất** đã có, ghi rõ trên màn hình.
- Quảng cáo máy tự lấy, không cần nhập.
- **💰 Giá vốn sản phẩm** (giá nhập từng sản phẩm) sửa ở **Cài đặt**. Có giá vốn thì máy mới tính được lãi.
- **🏦 Tiền & công nợ** (cuối trang): bấm **🔗 Nối link** để nối file Google Sheet kế toán (Sổ chi, Số dư ngân hàng, Công nợ). Máy tự đọc lại 3 tiếng 1 lần.

## Hàng tồn kho tính bằng tiền

Số lượng hàng do **người lo kho** ghi trên tab 📦 Kho (hàng về, lấy ra, đếm kho cuối tuần). Kế toán **không đếm lại**, chỉ xem số tiền.

![Chọn ngày (1), giá trị tồn kho (2), sản phẩm chưa có giá (3), hàng về kho (4)](/huong-dan/img/ke-toan-ton-kho.webp)

Kéo xuống mục **📦 Hàng tồn kho** ở cuối tab 💼 Kế toán:

1. Chọn **Hôm nay**, hoặc **Cuối tháng …** khi chốt sổ cuối tháng.
2. **Giá trị hàng tồn** = số hộp còn × giá nhập. Đây là số ghi vào báo cáo cuối tháng.
3. Dòng **chưa có giá**: vào **Cài đặt → 💰 Giá vốn sản phẩm** thêm giá nhập. Dòng **chưa đếm**: nhắc người kho đếm sản phẩm đó.
4. Bấm **📥 Hàng về kho** để xem từng lần hàng về (ngày, số lượng, người ghi). **Trước khi trả tiền nhà cung cấp**, so số trên hoá đơn với số ở đây. Hoá đơn ghi nhiều hơn số kho nhận thì hỏi người kho và nhà cung cấp trước khi trả.

## Theo dõi từ ngày nào?

Cuối trang, mục **⚙️ Cài đặt kế toán**: chọn **ngày bắt đầu theo dõi tiền về** rồi bấm Lưu. Đơn đặt trước ngày này không tính vào tiền treo (thường là đơn đã đối soát xong ở sổ sách cũ). Mặc định: 01/10/2026.

## Câu hỏi hay gặp

**Doanh số khác tiền về thế nào?**
Doanh số tính lúc **lên đơn**. Tiền về là tiền **đã vào tài khoản công ty**. Đơn đã giao nhưng hãng chưa trả tiền vẫn có doanh số, nhưng chưa có tiền về.

**Vì sao tiền hãng trả ít hơn tiền thu hộ?**
Hãng trừ phí ship trước khi chuyển tiền. Máy ghi số **tiền thu hộ** vào đơn, phần phí ship ghi riêng vào phí ship thật của đơn.

**Sàn Shopee / TikTok Shop thì sao?**
Tiền sàn không đi qua hãng vận chuyển của công ty nên không nằm ở đây. Số sàn đã có trong lãi lỗ (lấy từ tab Sàn).
