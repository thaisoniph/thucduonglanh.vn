---
title: Hướng dẫn sửa website
nav: Website
order: 3
updated: 2026-10-09
description: Đăng bài, sửa sản phẩm, giá, cài đặt website và tạo link theo dõi trên thucduonglanh.vn/admin.
---

Phần này dành cho người **đăng bài, sửa sản phẩm, sửa giá** trên [thucduonglanh.vn](https://thucduonglanh.vn). Việc xử lý đơn hàng và chăm sóc khách làm trên CRM, xem [Hướng dẫn CRM](/huong-dan/crm/).

Trang quản trị: **[thucduonglanh.vn/admin](https://thucduonglanh.vn/admin/)**. Dùng tốt nhất trên **máy tính** (Chrome, Edge hoặc Safari).

## Chuẩn bị tài khoản sửa website

Chỉ làm 1 lần.

1. **Tạo tài khoản GitHub** miễn phí tại [github.com/signup](https://github.com/signup). Gửi **tên đăng nhập GitHub** cho anh Sơn.
2. Mở email mời từ GitHub, bấm **Accept invitation**.
3. **Tạo mã đăng nhập trang quản trị**: đăng nhập GitHub, mở [link tạo mã này](https://github.com/settings/tokens/new?scopes=public_repo&description=Quan%20tri%20thucduonglanh).
    - Ô **Expiration** chọn **No expiration**.
    - Bấm **Generate token**, copy mã bắt đầu bằng **ghp_**, lưu vào nơi an toàn.
    - **Không gửi mã cho bất kỳ ai.** Mất mã thì tạo mã mới theo link trên.

## Đăng nhập trang quản trị

1. Mở [thucduonglanh.vn/admin](https://thucduonglanh.vn/admin/) trên máy tính.
2. Bấm **“Đăng nhập bằng mã truy cập”**. Không bấm “Đăng nhập bằng GitHub”.
3. Dán mã **ghp_…**, đăng nhập. Máy nhớ cho lần sau.

Bấm **Lưu** xong, khoảng **1–2 phút** sau thay đổi mới hiện trên website. Chưa thấy thì tải lại trang bằng **Ctrl + F5** (Windows) hoặc **Cmd + Shift + R** (Mac).

## Đăng bài viết (Góc Sống Lành)

1. Cột trái chọn **Bài viết (Góc Sống Lành)**, bấm **Tạo mới**.
2. Điền các ô:
    - **Tiêu đề**, **Ngày đăng**, **Chuyên mục**.
    - **Ảnh đại diện**: ảnh ngang hoặc vuông, tối thiểu 1000px. Web tự nén ảnh.
    - **Mô tả ngắn**: 1–2 câu, hiện ở danh sách bài và khi chia sẻ lên Facebook, Zalo.
    - **Nội dung**: soạn như Word (in đậm, tiêu đề nhỏ, gạch đầu dòng, chèn ảnh, chèn link).
3. Bấm **Lưu**.

Muốn ẩn bài mà không xoá: tắt **“Hiển thị trên web”**.

## Sửa sản phẩm

1. Chọn **Sản phẩm**, bấm vào sản phẩm cần sửa.
2. **Giá**: nhập số liền, **không dấu chấm, không chữ “đ”** (ví dụ **140000**).
    - Sản phẩm 1 quy cách: sửa ô **Giá bán**.
    - Nhiều quy cách (Hộp 400g, Hộp 125g…): sửa trong **“Nhiều quy cách / nhiều giá”**. Quy cách đầu tiên được chọn sẵn cho khách.
    - Giảm giá: điền **Giá gốc gạch ngang** (lớn hơn Giá bán). Web tự hiện “-x%” và đưa vào mục Khuyến Mãi.
    - Để trống Giá bán: web hiện “Liên hệ” và ẩn nút mua.
3. **Ảnh**: ảnh đầu tiên là ảnh đại diện. Kéo biểu tượng ☰ để đổi thứ tự, bấm ✕ để xoá.
4. **Hết hàng, ngừng bán**: tắt **“Hiển thị trên web”**.
5. **Sản phẩm nổi bật**: bật để hiện ở mục “Sản phẩm được yêu thích nhất” trên trang chủ.
6. **Nhãn trên ảnh**: ví dụ “Bán chạy”, “Mới”. Để trống nếu không cần.
7. **Gợi ý mua kèm**: chọn các sản phẩm muốn gợi ý khi khách mua sản phẩm này (ví dụ Ruốc gợi ý Xì dầu). Để trống thì web tự gợi ý món giúp đơn đạt mức miễn phí ship. Giỏ hàng đã đủ freeship thì web gợi ý 1 món trong danh sách này ("Thường mua kèm").
8. **Số gói/phần**: ví dụ hộp 20 gói thì nhập 20 (sản phẩm nhiều quy cách nhập ở từng quy cách). Web hiện thêm dòng *"≈ 22.500đ/gói"* dưới giá. Ô **Đơn vị phần**: gói, bữa, ly… Không chắc số gói thì để trống.
9. **Huy hiệu chứng nhận**: hiện thành hàng nhãn nhỏ dưới mô tả ngắn, ví dụ *Kiểm nghiệm NIFC*, *GMP – ISO 22000:2018*. **Chỉ ghi điều có giấy tờ thật.** Huy hiệu có chữ "kiểm nghiệm" bấm vào sẽ cuộn tới mục *Tiêu chuẩn & kiểm nghiệm*; có **Ảnh phiếu kiểm nghiệm** thì mở luôn ảnh đó.
10. **Nhu cầu**: chọn sản phẩm thuộc thẻ nào trong khối *"Chọn theo nhu cầu"* (Bữa sáng bận rộn, Ăn chay ngon miệng…).
11. **Từ khóa tìm kiếm**: các từ khách hay gõ (ăn sáng, bữa phụ, ăn chay, mẹ sau sinh…). Gõ có dấu hay không dấu đều tìm ra. Từ khóa **không hiện ra web**, chỉ dùng để tìm. Từ đứng trước được ưu tiên.
12. **Đánh giá khách hàng**: chỉ nhập **đánh giá thật** (tên, nơi ở, số sao, lời nhận xét, ảnh tin nhắn hoặc video). Có đánh giá thì trang sản phẩm hiện khối *"Khách hàng nói gì"*. Từ **3 đánh giá có chấm sao** trở lên, web mới hiện sao trung bình trên thẻ sản phẩm và báo cho Google. Không tự viết đánh giá.
13. Bấm **Lưu**.

> Giá sửa trên website cũng tự cập nhật vào danh sách sản phẩm khi tạo đơn trên CRM.

## Thêm sản phẩm mới

1. **Sản phẩm**, bấm **Tạo mới**.
2. Điền tên, danh mục, giá (hoặc các quy cách), 3–6 ảnh vuông, mô tả ngắn, điểm nổi bật, gợi ý mua kèm.
3. Mục **“Các mục mô tả chi tiết”**: thêm từng khối (Thành phần, Công dụng, Cách dùng, Bảo quản…) và chọn **Kiểu trình bày**:
    - **Đoạn văn** (khung xám hoặc viền xanh bên trái).
    - **Danh sách gạch đầu dòng**.
    - **Bảng thông số 2 cột**, dùng cho bảng dinh dưỡng.
4. **Công dụng** chỉ ghi đúng hồ sơ công bố. Giữ dòng lưu ý cuối trang: *“Sản phẩm này không phải là thuốc và không có tác dụng thay thế thuốc chữa bệnh.”*
5. Bấm **Lưu**.

## Tạo gói giải pháp (combo)

Gói = nhiều sản phẩm bán chung 1 giá, ví dụ **Gói Khởi Động 10 Ngày Sống Lành**.

1. Vào **/admin → Gói giải pháp → Tạo gói** (hoặc bấm vào gói có sẵn để sửa / nhân bản).
2. **Sản phẩm trong gói**: bấm **Thêm**, chọn sản phẩm, gõ đúng tên **quy cách** như trong sản phẩm (ví dụ `Hộp 125g`; sản phẩm 1 quy cách thì để trống), nhập số lượng.
3. **Giá gói**: nên **thấp hơn tổng giá mua lẻ trên web** (giá đã giảm %), nếu không khách mua lẻ còn rẻ hơn. Web tự tính và hiện: *"Tiết kiệm … so với giá gốc mua lẻ, rẻ hơn mua lẻ trên web …"*.
4. **Miễn phí vận chuyển**: bật thì đơn có gói này được freeship.
5. **Số ngày dùng hết gói** (ví dụ 10): CRM tự nhắc sale gọi khách trước khi khách dùng hết.
6. Ảnh, mô tả, lịch dùng: chỉ mô tả **thói quen, thực đơn, cách dùng** – không hứa kết quả sức khỏe (không dùng "giảm cân, thải độc, chữa, khỏi…"). Gói có thực phẩm bổ sung phải có dòng *"không phải là thuốc…"*.
7. **Nội dung thuyết phục** (không bắt buộc, xem mẫu ở gói Khởi Động 10 Ngày):
    - Trong từng sản phẩm của gói: **Biểu tượng**, **Lợi ích** (ví dụ "Ăn lành hơn"), câu ngắn, mô tả, thông điệp. Lợi ích hiện to hơn tên sản phẩm.
    - **Tiêu đề lớn, Câu chính, Câu phụ, Chữ trên nút mua**: thẻ gói ở trang chủ.
    - Các mục **Trang gói – …** (phần đầu, vấn đề, giải pháp, các chặng, nhận được gì, nút cuối): trang chi tiết gói. Xuống dòng trong ô thì trên web cũng xuống dòng.
    - **Link tài liệu lộ trình**: chỉ điền khi đã có tài liệu thật gửi khách. Khi có link, web tự hiện nhãn "🎁 Lộ trình đồng hành" và nút "Xem lộ trình". Mục **Quyền lợi thêm** cũng chỉ ghi điều khách thật sự nhận được.
    - Nên dùng các từ *bắt đầu, khởi động, trải nghiệm, thói quen nhỏ, dễ duy trì*. Tránh *thử thách, phải, bắt buộc*. Không viết lượng sản phẩm như thể đủ ăn cả 10 ngày.
8. Bấm **Lưu → Đăng**. Sau 1–2 phút gói hiện ở: trang chủ (mục **Gói Giải Pháp Sống Lành**), danh mục **Gói Giải Pháp**, hộp tư vấn nổi, và khung *"Tiết kiệm hơn khi mua theo gói"* trong trang từng sản phẩm có trong gói.

Muốn tạm ngừng bán gói: tắt **Hiển thị trên web**.

## Cài đặt website

Vào **Cài đặt website**:

| Mục | Sửa được gì |
| --- | --- |
| **Thông tin liên hệ, mạng xã hội, ngân hàng** | Hotline, Zalo, email, địa chỉ, giờ làm việc. Link Facebook, TikTok, YouTube, Shopee, Zalo OA. Tài khoản nhận chuyển khoản (mã QR). Phí vận chuyển (hiện tại 30.000đ, miễn phí từ 300.000đ). Các kênh cộng đồng trên trang chủ. **Video thương hiệu** (link YouTube, tiêu đề, mô tả) hiện ở trang chủ (đầu phần "Khách hàng nói gì") và trang Giới thiệu; xoá link thì khối video tự ẩn. **Ebook quà tặng**: trang nhận ebook nằm ngay trên web tại **thucduonglanh.vn/ebook/** (dùng link này cho quảng cáo và bài đăng). Khách điền họ tên + số điện thoại là mở được ebook (sách lật Heyzine, có video thực đơn 7 ngày) và được mời vào nhóm Zalo Sống khỏe. Số khách vào thẳng CRM, tab **Khách hỏi**, kênh **"Ebook – quà tặng (Website)"**, kèm nguồn (Facebook, TikTok…) và báo Telegram cho người được giao. Trong ô cài đặt sửa được: **Link đọc ebook (Heyzine)** (đổi ebook thì dán link mới), tiêu đề, mô tả, ảnh bìa của khung mời ở trang chủ, cuối mỗi bài viết, menu điện thoại và hộp tư vấn. Xoá ô Link trang ebook thì ẩn toàn bộ lời mời. **Link nhóm Zalo Sống khỏe** hiện trong menu điện thoại và trang Đặt hàng thành công. **Ưu đãi chỉ có khi đặt trên website**: bật/tắt, mức giảm chung (%), **câu quảng bá chính** (hiện ở dòng trên cùng và khung ưu đãi, ví dụ "Giá tại website luôn tốt hơn mua trên sàn"), quà tặng (tên, trị giá, điều kiện). Giá trong từng sản phẩm vẫn nhập **giá gốc**; web tự giảm, gạch giá gốc, hiện nhãn −%, khung ưu đãi ở trang sản phẩm / thanh toán và dòng ưu đãi trên cùng. Muốn **mỗi sản phẩm giảm một mức khác**: vào **Sản phẩm → chọn sản phẩm → ô "Giảm khi đặt trên web (%)"**: để trống = theo mức chung, nhập **0 = không giảm** (sản phẩm giá thấp, lãi mỏng, ví dụ Ruốc Rong Biển), nhập số khác = giảm riêng. Sản phẩm nhiều quy cách có thể nhập riêng cho từng quy cách. CRM (đơn gọi điện, Zalo) vẫn dùng giá gốc. Biểu tượng Shopee không hiện trên web để khách đặt trực tiếp. |
| **Trang chủ – Ảnh lớn đầu trang & băng chuyền** | **Ảnh lớn đầu trang** (cố định, không tự chạy): dòng nhỏ, tiêu đề, câu dẫn, mã sản phẩm/gói của nút chính (giá tự lấy), chữ trên nút, ảnh. **Băng chuyền sản phẩm**: các thẻ nằm dưới mục Danh mục, khách tự lướt. |
| **Chọn theo nhu cầu** | Các thẻ *Bữa sáng bận rộn*, *Bữa phụ từ hạt*… ở trang chủ (ngay dưới ảnh lớn) và trang Sản phẩm. Gắn sản phẩm vào thẻ ở ô **Nhu cầu** của từng sản phẩm. Thẻ chỉ có 1 sản phẩm thì bấm vào là tới thẳng sản phẩm đó. Không ghi tên bệnh hay công dụng chữa bệnh. |
| **Hồ sơ thương hiệu (brochure)** | Link sách lật, file PDF, ảnh bìa, các chương, số liệu, giải thưởng |
| **Danh mục sản phẩm**, **Chuyên mục bài viết** | Thêm, đổi tên danh mục. **Không đổi “Mã”** của danh mục đang có sản phẩm, vì đường link sẽ bị đổi. |

Mục **Trang chính sách / hỗ trợ** ở cột trái: nội dung chính sách giao hàng, đổi trả, bảo mật… Có thể gõ {hotline}, {email}, {address}, web tự thay bằng thông tin công ty.

## Tạo link theo dõi khi đăng bài, chạy quảng cáo

Mỗi lần đăng bài hoặc chạy quảng cáo dẫn khách về website, dùng link theo dõi. Nhờ vậy đơn hàng có ghi **Nguồn** (khách đến từ bài nào, kênh nào), giúp biết kênh nào hiệu quả.

1. Mở [thucduonglanh.vn/admin/utm](https://thucduonglanh.vn/admin/utm).
2. Dán link trang muốn dẫn khách tới (trang chủ hoặc trang sản phẩm).
3. Chọn **Kênh** (Facebook, TikTok, Zalo…) và **Hình thức** (bài đăng, quảng cáo, livestream…).
4. Gõ **Tên chiến dịch** không dấu, ví dụ `dilvang-combo`, `trungthu2026`. Ô **Nội dung / người đăng** không bắt buộc, ví dụ `video-co-lan`.
5. Bấm **📋 Sao chép link**, dùng link này khi đăng bài.

## Sửa trang hướng dẫn này

Quản lý có thể sửa chính trang hướng dẫn này: trong trang quản trị, chọn **Hướng dẫn nội bộ**, bấm vào phần cần sửa, sửa xong bấm **Lưu**. Khoảng 2 phút sau trang hướng dẫn được cập nhật.

## Lưu ý khi sửa website

1. **Sửa nhầm?** Mọi lần lưu đều có lịch sử. Báo anh Sơn để khôi phục bản trước.
2. **Không đổi “Mã”** của danh mục, đường dẫn của sản phẩm đang bán.
3. Nội dung đăng lên phải theo [quy định chung](/huong-dan/#quy-dinh-chung) về công dụng sản phẩm.
