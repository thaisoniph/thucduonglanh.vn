---
title: Kế toán
nav: Kế toán
order: 4.6
updated: 2026-11-13
description: Ghi tiền về tài khoản (tải file đối soát COD Best / Viettel Post hoặc tích tay), đối soát Shopee từng đơn, ghi công nợ nhà cung cấp, tự chấm KPI tháng, xem tiền còn treo ở hãng vận chuyển, nhập chi phí, xem lãi lỗ theo ngày / tuần / tháng. Có hình từng bước.
---

Trang này dành cho **kế toán**. Đọc khoảng 5 phút là làm được.

> **Thứ 2, 4, 6 (ngày hãng chuyển tiền):** tải file phiếu đối soát của Best / Viettel Post. **Mỗi ngày:** tải file sao kê VCB / MB của từng tài khoản. Máy tự tìm phiếu và đơn chuyển khoản đã có tiền, tự xếp nhóm các khoản chi, lấy số dư cuối ngày; kế toán xem lại rồi bấm Lưu. Không cần ghi Sổ chi cho khoản chuyển khoản. **Khi nhận hoá đơn nhập hàng:** ghi vào **🧾 Công nợ nhà cung cấp**, máy tự trừ khi sao kê có khoản trả. Xong là anh Sơn xem được lãi lỗ và tiền thật gần như ngay lúc đó.

**Cách xem hình:** ô khoanh đỏ có số **1, 2, 3** trên hình chính là **bước 1, 2, 3** viết ngay bên dưới hình.

## Tài khoản Kế toán thấy gì?

- Chỉ có tab **💼 Kế toán** và **Cài đặt**.
- Thấy đơn hàng: mã đơn, ngày, sale bán, sản phẩm, số tiền, trạng thái, hãng, mã vận đơn, **tên khách và 4 số cuối SĐT**.
- Thấy **số hàng tồn kho** (chỉ xem, do người kho ghi trên CRM) và giá trị tồn kho tính bằng tiền.
- **Không thấy** SĐT đầy đủ, địa chỉ, ghi chú chăm sóc. Không chăm sóc khách, không nhận khách mới.
- 8h sáng nhận tin **💼 Tài chính** qua Telegram: tiền còn treo ở hãng, tiền về hôm qua, chuyển khoản chờ xác nhận, nợ nhà cung cấp sắp tới hạn, lãi lỗ. Nối Telegram ở **Cài đặt → 📲 Thông báo Telegram riêng** (làm 1 lần, 30 giây).

## Quản trị cấp quyền Kế toán (làm 1 lần)

![Chọn quyền Kế toán (1), bấm Lưu nhân sự (2)](/huong-dan/img/ke-toan-quyen.webp)

Quản trị vào **Cài đặt → Nhân sự được vào CRM**, thêm email của kế toán (hoặc tìm dòng có sẵn), rồi:

1. Ở ô **Quyền**, chọn **Kế toán**.
2. Bấm **Lưu nhân sự**.

Kế toán mở **[ketoan.thucduonglanh.vn](https://ketoan.thucduonglanh.vn)**, đăng nhập bằng email đó (mã 6 số gửi về email) là vào thẳng tab **💼 Kế toán**. Đưa ra màn hình điện thoại sẽ có biểu tượng **Kế toán TDL**. Quản trị muốn xem tab này: bấm **••• Thêm** → **Kế toán**.

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

## Phiếu đối soát chờ tiền về (thứ 2, 4, 6)

Hãng gom nhiều đơn vào **1 phiếu** rồi chuyển **1 khoản tiền** về tài khoản. Kế toán chỉ cần xem khoản đó đã về chưa, không phải tích từng đơn.

Lấy file phiếu trên trang của hãng (mỗi phiếu 1 file):

- **Best**: **Đối soát COD** → bấm vào **mã phiếu NO…** → **Xuất Excel**.
- **Viettel Post**: **Tiền hàng đã trả** → bấm **mã bảng kê PCOD…** → xuất **Báo cáo chi tiết bảng kê**.

Bấm **📥 Tải file đối soát COD** → **Chọn tệp** → chọn **cùng lúc** mọi file phiếu vừa tải. Máy cho xem từng phiếu: số đơn, tiền thu hộ, cước hãng trừ và **số tiền sẽ về tài khoản**. File Viettel Post không ghi mã bảng kê: gõ mã **PCOD-…** (xem trên trang Tiền hàng đã trả) vào ô trống. Bấm **💾 Lưu … phiếu vào danh sách chờ tiền về**.

![Tải file phiếu (1), số tiền phải về (2), bấm Đã về (3), phiếu chờ quá lâu (4)](/huong-dan/img/ke-toan-phieu.webp)

1. Nút **📥 Tải file đối soát COD**: chọn file phiếu ở đây.
2. **Số tiền phải về tài khoản** của phiếu. Best: đã trừ cước và **5.000đ phí chuyển khoản**, đúng bằng số hiện trên sao kê.
3. Mở sao kê VCB. Thấy **đúng số tiền** đó thì bấm **✅ Đã về** (hoặc tải sao kê VCB như mục dưới để máy tự khớp), chọn **ngày tiền về** và **tài khoản nhận**, bấm **Ghi tiền về**. Mọi đơn có thu hộ trong phiếu được ghi tiền về một lần.
4. Phiếu **tô đỏ** = tạo quá 3 ngày mà chưa thấy tiền: gọi hỏi hãng. Dòng **"… mã không có trong CRM"** = đơn sale chưa lên CRM hoặc chưa ghi mã vận đơn: báo sale.

Ghi chú:

- Số tiền về trên sao kê khác số phiếu: gõ số thật vào ô **Số tiền thực về**. Máy báo lệch, vẫn ghi được. Nên hỏi lại hãng.
- Bấm nhầm: mở **✅ Phiếu đã về gần đây** → **↩ Bỏ ghi**. Tải nhầm phiếu: bấm 🗑 để xoá (chỉ xoá được phiếu chưa về).
- Tải lại cùng phiếu không sao: máy cập nhật, không tạo trùng.
- Dòng quà tặng, đổi hàng (thu hộ 0đ) không ghi tiền về, nhưng máy vẫn ghi **phí ship thật** cho đơn đó.
- 8h sáng tin Telegram **💼 Tài chính** báo số phiếu đang chờ tiền và phiếu quá 3 ngày.

## Tải file chi tiết đơn cả tháng (khi cần đối soát lại)

Cách cũ vẫn dùng được, hợp khi cần rà lại cả tháng:

- **Best**: trang Best → **Đối soát COD** → Chi tiết đơn → **Xuất Excel** (chọn cả tháng).
- **Viettel Post**: Quản lý vận đơn → **Xuất danh sách vận đơn** (file có cột **Trạng thái thanh toán**).

![Chọn file (1), số tiền hãng đã trả (2), đơn lệch tiền (3), bấm Ghi tiền về (4)](/huong-dan/img/ke-toan-cod.webp)

1. Bấm **📥 Tải file đối soát COD**. Chọn **tiền của file này về tài khoản nào** (Công ty, Anh Sơn…), rồi bấm **Chọn tệp** → chọn file vừa tải.
2. Máy đọc file ngay, chia 3 ô: **✅ Hãng đã trả, chưa ghi**, **💤 Hãng chưa trả**, **❓ Không thấy trong CRM**.
3. Đơn **tô đỏ** = hãng thu khác số tiền trên đơn. Máy vẫn ghi theo số hãng thu. Ghi xong, chọn lý do lệch ở mục **⚠️ Đơn hãng thu khác tiền trên đơn** (xem phần Chốt doanh số bên dưới). Đơn nào không muốn ghi thì bỏ tích.
4. Bấm **✅ Ghi tiền về … đơn**. Xong.

Ghi chú:

- Tải lại cùng file cũng không sao: đơn đã ghi rồi thì máy bỏ qua.
- Máy ghi luôn **ngày hãng trả tiền**, **mã phiếu thanh toán** (Best) và **phí ship thật** của đơn.
- **❓ Không thấy trong CRM**: đơn chưa lên CRM hoặc sai mã. Mở dòng đó xem mã vận đơn rồi báo sale.
- Hãng báo giao thành công mà CRM còn ghi "Đang giao": máy nhắc báo Quản lý chạy **📦 Đối soát vận chuyển** ở tab Đơn hàng. Kế toán không đổi trạng thái đơn.

## Tải sao kê VCB / MB: máy tự khớp tiền về, xếp khoản chi

![Nút Tải sao kê VCB (1)](/huong-dan/img/ke-toan-sao-ke.webp)

Lấy file Excel, để nguyên không cần đổi:

- **VCB**: **VCB DigiBiz** → **Lịch sử giao dịch** → chọn ngày → **Xuất Excel** (file `.xls`).
- **MB**: **MB BIZ** → **Sao kê chi tiết tài khoản** → chọn ngày → **Xuất Excel** (file `.xlsx`). Tài khoản MB chủ yếu trả quảng cáo Facebook: máy để nhóm **Quảng cáo Facebook** (không trừ lần 2), dòng phí nhỏ đi kèm mỗi lần trừ thẻ thì để nhóm **Phí ngân hàng**.

1. Bấm **🏦 Tải sao kê VCB / MB**. Chọn **sao kê này của tài khoản nào** (Công ty, Anh Sơn…), rồi chọn file.

Máy đọc **tiền vào**, **tiền ra** và **số dư cuối ngày**. Tiền vào chia thành:

- **🧾 Phiếu hãng đã chuyển tiền**: tiền Best về có ghi mã phiếu **NO…** nên máy khớp đúng phiếu. Tiền Viettel Post về (ghi "VTP NDUG…") khớp phiếu có **đúng số tiền**. Dòng tô đỏ = số tiền về khác số trên phiếu: hỏi lại hãng.
- **⚠️ Khoản hãng chuyển nhưng chưa có phiếu trong CRM**: tải file phiếu đó (theo mã NO… hoặc ngày Viettel Post chuyển) ở mục trên, rồi tải lại sao kê.
- **🏦 Đơn khách chuyển khoản**: khoản tiền khớp đúng số tiền một đơn chuyển khoản đang chờ, đặt trong khoảng 15 ngày trước ngày tiền vào. Dòng **tô đỏ, chưa tích** = có nhiều đơn cùng số tiền, máy đoán đơn gần ngày nhất: đọc tên trong nội dung chuyển khoản, đúng thì mới tích.
- **❔ Khoản tiền vào khác**: không khớp đơn nào. Đúng là tiền đơn thì ghi tay ở **🏦 Chuyển khoản chờ xác nhận**.

**💸 Tiền ra**: mỗi khoản chi 1 dòng, máy **tự chọn nhóm** theo nội dung chuyển khoản (lương, BHXH, tiền điện, thuê nhà, trả tiền hàng nhà cung cấp, chuyển nội bộ, rút séc, thuế, phí ngân hàng…).

- Dòng **tô đỏ** = máy chưa đoán được: chọn nhóm trong ô bên phải. Lần sau gặp cùng người nhận, máy tự xếp theo nhóm bạn đã chọn.
- Thấy nhóm máy chọn chưa đúng thì đổi luôn trong ô.
- Nhóm quyết định cách tính lãi lỗ: **lương, bảo hiểm, thuê nhà, điện nước, internet, ship** chia đều mỗi ngày; **trả nhà cung cấp, nhập hàng, chuyển nội bộ, rút tiền mặt, thuế** không phải chi phí; **quảng cáo Facebook, phí sàn** máy đã tự lấy; còn lại (tiếp khách, mua sắm, phí ngân hàng…) trừ đúng ngày.

Bấm **✅ Lưu …**: máy ghi tiền về cho các phiếu / đơn đã tích, lưu các khoản chi và số dư cuối ngày (hiện ở **🏦 Tiền & công nợ**).

Tải lại cùng sao kê (hoặc sao kê có ngày trùng) không sao: khoản đã ghi rồi máy bỏ qua, nhóm bạn đã chọn được giữ nguyên.

**Sửa nhóm sau khi đã lưu:** bấm **💸 Tiền ra đã lưu** (cạnh nút tải sao kê). Khoản chưa chọn nhóm nằm trên cùng, đổi nhóm là lãi lỗ tính lại ngay.

**Tiền mặt:** khoản rút ra rồi chi bằng tiền mặt không có trên sao kê, nên ghi vào trang **Sổ chi** trong file Google Sheet kế toán (mục dưới).

## Ghi tiền về bằng tay (chuyển khoản VCB, hoặc không có file)

![Tìm đơn (1), tích đơn (2), ngày tiền về (3), bấm Đã nhận tiền (4)](/huong-dan/img/ke-toan-ck.webp)

Bấm ô **🏦 Chuyển khoản chờ xác nhận** (hoặc nút **✅ Ghi tiền về bằng tay** cho đơn COD). Mở sao kê VCB bên cạnh.

1. Gõ **mã đơn**, **mã vận đơn**, **tên** hoặc **4 số cuối SĐT** để tìm nhanh. Nội dung chuyển khoản thường có mã đơn hoặc tên khách.
2. Thấy tiền về **đúng số tiền** thì tích ✓ đơn đó. Tích được nhiều đơn một lúc.
3. Chọn **ngày tiền về** (mặc định hôm nay) và **tài khoản nhận tiền**.
4. Bấm **✅ Đã nhận tiền**.

**Ghi nhầm?** Bấm ô **✅ Đã về** → tích đơn ghi nhầm → **↩ Bỏ ghi tiền về**. Đơn quay lại danh sách chờ tiền.

## Shopee: đơn nào Shopee đã trả tiền (thay cho VLOOKUP)

Ở tab 💼 Kế toán, kéo xuống mục **🟠 Shopee – tiền về từng đơn**. Máy tự ghép file đơn hàng với file tiền Shopee trả **theo mã đơn**, kế toán không phải VLOOKUP nữa.

**Tải file (1 tuần 1 lần, hoặc cuối tháng):** bấm **📤 Tải file Shopee**, chọn **cùng lúc** các file xuất từ Kênh Người Bán Shopee:

| File | Lấy ở đâu trên Shopee | Tên file thường bắt đầu bằng |
|---|---|---|
| 📦 Đơn hàng | Đơn hàng → tab **Tất cả** → chọn ngày → Xuất | `Order.all` |
| 💵 Số dư TK Shopee | Tài Chính → **Số dư TK Shopee** → Xuất | `my_balance_transaction_report` |
| 💵 Doanh thu (thay được file Số dư) | Tài Chính → **Doanh Thu** → tab Đã thanh toán → Xuất | `Income` |
| 🤝 Tiếp thị liên kết (không bắt buộc) | Marketing → Tiếp thị liên kết → **Báo cáo chuyển đổi** → Xuất | `SellerConversionReport` |

Máy đọc file và cho xem trước rồi mới bấm **Nhập**. Tải lại file trùng ngày không sao: máy cập nhật, không cộng đôi.

**Đọc kết quả:** các ô theo **ngày đặt đơn** trong kỳ chọn ở đầu trang.

| Ô | Nghĩa là | Kế toán làm gì |
|---|---|---|
| ✅ **Shopee đã trả** | Đơn đã có tiền vào Số dư TK Shopee: số tiền, ngày trả | Không phải làm gì |
| 🔴 **Quá hạn, chưa thấy tiền** | Đơn đã hoàn thành trước ngày cuối của file tiền về hơn 3 ngày mà vẫn chưa có tiền | **Hỏi Shopee** (Kênh Người Bán → Hỗ trợ) |
| ⏳ **Chờ Shopee trả** | Đơn mới hoàn thành, file tiền về chưa tới ngày đó | Chờ, tuần sau tải file mới |
| 🚚 **Đang giao** | Đơn chưa hoàn thành theo file đơn hàng mới nhất | Chờ |

Bấm vào ô hoặc nút nhóm để xem từng đơn. Các nhóm khác:
- **⚠️ Tiền về thấp**: Shopee trả dưới 50% giá bán (phí sàn, voucher, hoa hồng quá cao). Xem lại đơn đó.
- **✏️ Có điều chỉnh**: Shopee trừ hoặc cộng thêm sau khi đã trả (hoàn tiền, phí trả hàng, khấu trừ hoa hồng tiếp thị liên kết).
- **🤝 Qua tiếp thị liên kết**: đơn có hoa hồng cho đối tác (KOL, CreatorX…), hiện tên đối tác, kênh và đã trừ hay chưa.
- **↩️ Hoàn / huỷ**.

Bấm **📋 Chép bảng** rồi dán vào Google Sheet nếu cần nộp file đối soát.

**Hạch toán từng đơn (giống màn Tiền treo của Best / Viettel Post):** bấm **🧾 Xem kết quả & hạch toán từng đơn**. Tải file xong máy cũng tự mở màn này.

1. Nhóm **🧾 Đã trả, chưa hạch toán**: đơn Shopee đã trả tiền. Mỗi dòng có: ngày đặt, ngày hoàn thành, **ngày Shopee trả**, giá bán, **Shopee trừ bao nhiêu** (phí sàn, voucher, hoa hồng), điều chỉnh, hoa hồng tiếp thị liên kết. Số bên phải là **tiền thực nhận**.
2. Hạch toán xong đơn nào thì **tích** đơn đó (hoặc **Chọn hết**), bấm **✅ Đã hạch toán**. Đơn chuyển sang nhóm **✅ Đã hạch toán**, có ngày và tên người bấm.
3. Bấm nhầm: vào nhóm **✅ Đã hạch toán**, tích đơn, bấm **↩ Bỏ hạch toán**.
4. **📋 Chép**: chép các đơn đang tích (không tích thì chép cả nhóm), dán vào Google Sheet / Excel / Misa với đủ cột giá bán, Shopee trừ, thực nhận.

Màn này lấy mọi đơn Shopee đặt từ **ngày bắt đầu theo dõi** (⚙️ Cài đặt kế toán), không theo ô thời gian đầu trang. Ô 🔍 tìm theo mã đơn Shopee hoặc tên đối tác.

**Khi tải file Số dư**, máy báo luôn **tiền rút về ngân hàng** (để so với sao kê VCB) và **tiền trừ nạp quảng cáo Shopee**.

Máy báo **"… đơn có tiền về nhưng chưa có trong CRM"**: đó là các đơn đặt ngoài khoảng ngày của file đơn hàng. Tải thêm file đơn hàng các tháng đó rồi tải lại file tiền về.

Tin Telegram 8h sáng có dòng 🟠 khi có đơn Shopee quá hạn chưa thấy tiền.

## Chốt doanh số tháng theo sale

Mục **📋 Chốt doanh số theo sale** thay cho tab "Tổng kết" trong file đối soát. Máy tự cộng, không cần gõ tay. Chọn **Tháng trước** ở thanh thời gian trên cùng để chốt tháng vừa xong.

Mỗi sale 1 cột, cột cuối là **Tổng**. Các dòng:

- **Doanh số (sale nhập)**: đơn đặt trong tháng, trừ đơn hoàn và huỷ. Cùng số với Tổng quan.
- **Chia theo cách thu tiền**: Best, Viettel Post, Xe ôm / tự giao, Chuyển khoản.
- **− Hãng thu khác tiền đơn**: phần hạ COD hoặc lệch tiền (có số sau khi tải file đối soát COD).
- **= Thực thu**: doanh số trừ phần lệch.
- **trong đó còn đang giao**: đơn chưa giao xong, tiền chưa chắc về.
- **Chia theo loại khách**: Khách mới, Khách tối + CN, Khách cũ, Lễ Tết (theo Loại đơn sale chọn).
- **Tiền về tài khoản**: tiền đã về từng tài khoản, và tiền chưa về.

Bấm **📋 Chép bảng** rồi dán vào Google Sheet nếu cần gửi file.

**⚠️ Đơn hãng thu khác tiền trên đơn** (ngay dưới bảng): mỗi đơn có ô **Chọn lý do**: Hạ COD hỗ trợ ship, Sale nhập sai tiền, Khách trả thiếu, Giảm giá thêm cho khách, Khác. Chọn là lưu luôn. Lý do là **Sale nhập sai tiền** thì nhắn sale sửa lại số tiền trên đơn.

## Đơn hạ COD, ký 1 phần, đổi hàng

Mục **✏️ Đơn hạ COD / ký 1 phần / đổi hàng** (dưới bảng Chốt doanh số) thay cho file Google Sheet sale tự điền. Sale ghi ngay trong từng đơn, kế toán chỉ cần xem.

- Mỗi dòng có: ngày đơn, mã đơn, khách (4 số cuối SĐT), sale, loại, **tiền ban đầu**, **tiền hạ**, **thu thêm**, **thực thu**, **hoá đơn mới**, mã vận đơn cũ → mới, ngày xử lý, người xử lý, ghi chú.
- **Hạ COD, ký 1 phần**: xuất hoá đơn theo cột **Thực thu**. Hạ COD không có mã vận đơn mới.
- **Đổi hàng**: dòng ghi rõ **📤 hàng gửi khách** và **📥 hàng lấy về**. Cột **Hạ** là **giá trị hàng cũ khách trả lại**: giảm hoá đơn cũ đúng số này. Cột **Hoá đơn mới** = giá trị hàng cũ trả lại + tiền thu thêm (thu qua COD của mã vận đơn mới). Doanh số = tiền ban đầu + thu thêm.
- Danh sách lấy đơn **đặt** hoặc **xử lý** trong khoảng thời gian chọn ở trên cùng (Tháng này, Tháng trước…).
- Bấm **📋 Chép bảng** rồi dán vào Google Sheet nếu cần gửi file. Các cột giống file cũ.
- Doanh số, tiền treo ở hãng đã tính theo thực thu. Tải file đối soát COD thì đơn đã ghi ở đây **không** bị báo lệch tiền.

Thấy đơn hãng thu ít hơn mà sale chưa ghi (nằm ở **⚠️ Đơn hãng thu khác tiền trên đơn**) thì nhắn sale mở đơn ghi hạ COD / ký 1 phần.

## Công nợ nhà cung cấp

Ghi công nợ ngay trên CRM, **không cần trang Công nợ trong file Google Sheet nữa**. Tiền trả qua tài khoản VCB / MB máy tự trừ khi tải sao kê.

![Tổng nợ (1), khoản sao kê chưa rõ (2), từng nhà cung cấp (3), ghi hoá đơn (4), ghi trả tiền mặt (5)](/huong-dan/img/ke-toan-cong-no.webp)

Mục **🧾 Công nợ nhà cung cấp** trên tab 💼 Kế toán:

1. **Còn nợ / Quá hạn / Tới hạn 7 ngày**: ô đỏ = có khoản quá hạn, cần trả ngay hoặc gọi hẹn lại.
2. **⚠️ Khoản trả nhà cung cấp trên sao kê máy chưa biết trả cho ai**: bấm vào, chọn nhà cung cấp cho từng khoản. Máy nhớ chữ trong nội dung chuyển khoản, lần sau tự nhận ra. Khoản không phải trả nhà cung cấp thì chọn **✖ Không phải trả nhà cung cấp**.
3. **Từng nhà cung cấp**: số còn nợ, hạn gần nhất. Bấm vào để xem từng hoá đơn (còn nợ bao nhiêu, hạn ngày nào) và các lần đã trả. Bấm 1 hoá đơn để sửa hoặc xoá khi ghi nhầm.
4. **＋ Hoá đơn nhập hàng**: mỗi lần nhận hoá đơn thì ghi: chọn nhà cung cấp, số tiền, số hoá đơn, ngày hoá đơn. **Hạn trả máy tự tính** = ngày hoá đơn + số ngày được nợ. Hoá đơn ghi hạn khác thì sửa ô Hạn trả.
5. **＋ Ghi đã trả (tiền mặt)**: chỉ ghi khoản trả bằng **tiền mặt** hoặc tài khoản không tải sao kê. Khoản chuyển từ VCB / MB **không ghi ở đây** (máy đã tự lấy, ghi thêm là trừ 2 lần).

**Làm lần đầu:**

- Bấm **＋ Nhà cung cấp** cho từng nơi nhập hàng: tên, **được nợ bao nhiêu ngày**, người liên hệ. Ô **Chữ nhận ra trên sao kê** để trống cũng được.
- **Nợ cũ** đang còn: ghi 1 hoá đơn, ghi chú "Nợ cũ", số tiền = số còn nợ hôm nay, hạn trả = ngày phải trả. Máy chỉ tự trừ khoản trả trên sao kê **từ ngày hoá đơn đầu tiên** của nhà cung cấp đó trở đi.
- Nếu file kế toán đã có trang **Công nợ**: bấm **📥 Chép vào sổ CRM** (hiện khi sổ còn trống), rồi mở từng nhà cung cấp sửa số ngày được nợ.

**Máy trừ tiền trả vào hoá đơn nào?** Hoá đơn có **hạn sớm nhất** trước, không phải chọn. Trả dư thì hiện **đã trả trước**, trừ vào hoá đơn sau.

**Khoản sao kê bị trừ nhầm nhà cung cấp:** mở nhà cung cấp đó, ở dòng đã trả bấm **↩ Không phải**.

**Trước khi trả tiền:** so hoá đơn với **📥 Hàng về kho** (mục Hàng tồn kho bên dưới) xem kho đã nhận đủ chưa.

Số công nợ này cũng hiện ở ô **🧾 Nợ nhà cung cấp** (Tổng quan của anh Sơn) và tin Telegram 8h sáng (khoản quá hạn, tới hạn 7 ngày). Nút **📋 Chép bảng công nợ** chép cả sổ để dán vào Google Sheet khi cần gửi báo cáo.

## KPI tháng: tự chấm, quản lý chấm lại

Mỗi tháng kế toán tự chấm 7 nhóm việc. Sau đó quản lý (chị Thủy) hoặc anh Sơn chấm lại và **chốt**. Điểm đã chốt được lưu để đánh giá cuối năm và xét điều chỉnh lương.

![Chọn tháng (1), mở phiếu của bạn (2)](/huong-dan/img/ke-toan-kpi.webp)

Mục **📋 KPI tháng của kế toán** trên tab 💼 Kế toán:

1. **Chọn tháng.** Từ ngày 1 đến ngày 15, máy tự mở tháng trước. Bấm **‹ ›** để đổi tháng.
2. **Phiếu KPI của bạn:** bấm vào để tự chấm.

![Xem thời hạn (1), chọn mức (2), ghi bằng chứng (3), tổng điểm (4), lưu (5)](/huong-dan/img/ke-toan-kpi-cham.webp)

Trong phiếu, làm từng nhóm việc:

1. Bấm **Thời hạn & kết quả cần đạt** để xem nhóm đó cần làm gì, hạn ngày nào.
2. **Chọn mức:**
   - **100%**: đúng hạn, số đúng.
   - **80%**: trễ 1–2 ngày làm việc, hoặc có 1 lỗi tự phát hiện và đã sửa.
   - **50%**: trễ quá 2 ngày, lỗi do người khác phát hiện, hoặc lặp lại lỗi tháng trước.
   - **0%**: công ty bị phạt hoặc mất tiền do lỗi kế toán.
3. **Ghi bằng chứng:** link bảng đối soát, báo cáo hoặc biên nhận; nếu trễ thì ghi vì sao.
4. **Tổng điểm** máy tự cộng, kèm xếp loại và lương tháng của bạn.
5. Bấm **Lưu tự chấm**. Chưa chốt thì bạn sửa lại được.

**Điểm cộng (tối đa 5):** dành cho việc phát hiện rủi ro (của hệ thống hoặc bộ phận khác), hoặc đề xuất cải tiến được duyệt. Ghi rõ việc gì, ngày nào.

> 💡 Nếu bạn **báo trước hạn** rằng sẽ trễ (ví dụ thiếu dữ liệu từ người khác) và được đồng ý lùi hạn, thì vẫn tính **đúng hạn (100%)**.

**Xếp loại:** từ 90 điểm là **A**; 75–89 điểm là **B**; 60–74 điểm là **C**; dưới 60 điểm thì họp riêng để xem lại. Không được loại A nếu nhóm 1, 5 hoặc 7 đạt dưới 70%, hoặc nếu tháng đó công ty bị phạt / mất tiền.

**Lương** = lương cơ bản + lương hiệu quả theo xếp loại (chưa tính bảo hiểm). Tháng chấm thử: lương không thấp hơn mức đang nhận.

### Quản lý chấm lại và chốt

Chị Thủy (Quản lý) mở tab **Hiệu quả**, kéo xuống cuối trang. Anh Sơn (Quản trị) mở tab **💼 Kế toán**. Bấm tên người kế toán.

![Điểm kế toán tự chấm (1), chọn mức của quản lý (2), tổng điểm (3), chốt (4)](/huong-dan/img/ke-toan-kpi-chot.webp)

1. Dòng **🙋 Kế toán tự chấm** cho biết kế toán chọn mức nào và ghi chú gì.
2. Phiếu mở sẵn theo mức kế toán tự chấm. Thấy khác thì chọn lại, ghi nhận xét.
3. Xem tổng điểm, xếp loại và lương.
4. Bấm **✅ Chốt tháng**. Sau khi chốt, kế toán không sửa được nữa. Cần sửa thì bấm **🔓 Mở lại để sửa**.

Chưa xong thì bấm **Lưu nháp**. Các tháng đã chốt nằm ở **📈 Các tháng đã chốt**. Anh Sơn sửa mức lương theo xếp loại ở **⚙️ Mức lương theo xếp loại**.

## Nhập chi phí và xem lãi lỗ

Lãi lỗ ở tab này **cùng số** với Tổng quan của anh Sơn.

![Chọn kỳ xem](/huong-dan/img/ke-toan-ky.webp)

1. Chọn kỳ muốn xem: **Hôm nay**, **Tuần này**, **Tháng này**, **Tháng trước**… hoặc **📅 Khác** để tự chọn ngày.

![Lãi lỗ từng ngày (2), nhập chi phí (3), tải file kế toán (4)](/huong-dan/img/ke-toan-lai-lo.webp)

2. **💵 Lãi lỗ thật**: hôm nay, từ đầu tháng, dự kiến cả tháng; cột đỏ / xanh từng ngày; mỗi ngày cần bán bao nhiêu để hoà vốn. Bấm **Xem từng ngày** để xem bảng.
3. Mở **🧮 Lãi lỗ sau mọi chi phí** → **✏️ Nhập chi phí tháng …**: gõ từng khoản (thuê văn phòng, lương, điện, nước, tiền ship trả hãng…), bấm Lưu.
4. Hoặc **📎 Tải file kế toán** (file báo cáo tháng) và **👥 Tải bảng lương**: máy tự đọc các khoản chi phí.

5. **Khoản chi chuyển khoản** máy lấy từ sao kê (mục 🏦 Tải sao kê VCB / MB ở trên). **Khoản chi tiền mặt** ghi vào trang **Sổ chi** trong file Google Sheet kế toán: 1 dòng **đúng ngày chi**. Lãi lỗ ngày đó trừ đúng số tiền đó.

### Khoản chi (sao kê + Sổ chi) tính vào lãi lỗ thế nào

| Loại khoản | Máy làm gì |
|---|---|
| Lương, bảo hiểm, thuê nhà / kho, điện nước, internet, phần mềm, ship trả hãng | **Chia đều mỗi ngày** theo chi phí cả tháng (bước 3, 4). Ghi vào Sổ chi vẫn được, máy không trừ lần 2. |
| Khoản phát sinh khác (tiếp khách, mua đồ, sửa chữa, quà, hỗ trợ marketing…) | **Trừ đúng ngày** ghi trong Sổ chi. |
| Quảng cáo Facebook, phí sàn | Máy tự lấy, **không trừ lần 2**. |
| Trả nợ / nhập hàng nhà cung cấp, chuyển tiền nội bộ, thuế | **Không phải chi phí** (giá vốn đã tính theo hàng bán ra). |

- Bảng **Xem từng ngày**, cột **Chi phí**: ngày có 📒 là có khoản phát sinh (rê chuột vào số để xem từng khoản). Ngày có **~** là chưa có sao kê / Sổ chi tới ngày đó nên máy tạm tính trung bình. Vì vậy **tải sao kê mỗi ngày** để anh Sơn xem số đúng.
- Khoản chuyển khoản lỡ ghi cả Sổ chi (cùng ngày, cùng số tiền) thì máy chỉ tính 1 lần.
- Cột **Nhóm** trong Sổ chi nên ghi rõ (ví dụ "Tiếp khách", "Lương nhân viên", "Trả nợ nhà cung cấp") để máy xếp đúng loại.
- Máy đọc lại file 3 tiếng 1 lần. Muốn thấy ngay thì bấm **↻ Lấy số mới** ở mục 🏦 Tiền & công nợ.

Ghi chú:

- Tháng này chưa nhập chi phí thì máy **tạm lấy theo tháng gần nhất** đã có, ghi rõ trên màn hình.
- Quảng cáo máy tự lấy, không cần nhập.
- **💰 Giá vốn sản phẩm** (giá nhập từng sản phẩm) sửa ở **Cài đặt**. Có giá vốn thì máy mới tính được lãi.
- **🏦 Tiền & công nợ** (cuối trang): bấm **🔗 Nối link** để nối file Google Sheet kế toán (Sổ chi, Số dư ngân hàng). Công nợ nhà cung cấp ghi ở mục **🧾 Công nợ nhà cung cấp** phía trên. Máy tự đọc lại 3 tiếng 1 lần.

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

Cũng ở đây: **Tài khoản nhận tiền**, mỗi dòng 1 tài khoản (mặc định: Công ty, Anh Sơn, Hộ kinh doanh). Sửa xong bấm **Lưu tài khoản**.

## Câu hỏi hay gặp

**Doanh số khác tiền về thế nào?**
Doanh số tính lúc **lên đơn**. Tiền về là tiền **đã vào tài khoản công ty**. Đơn đã giao nhưng hãng chưa trả tiền vẫn có doanh số, nhưng chưa có tiền về.

**Vì sao tiền hãng trả ít hơn tiền thu hộ?**
Hãng trừ phí ship trước khi chuyển tiền. Máy ghi số **tiền thu hộ** vào đơn, phần phí ship ghi riêng vào phí ship thật của đơn.

**Sàn Shopee / TikTok Shop thì sao?**
Tiền sàn không đi qua hãng vận chuyển của công ty nên không nằm ở đây. Số sàn đã có trong lãi lỗ (lấy từ tab Sàn).
