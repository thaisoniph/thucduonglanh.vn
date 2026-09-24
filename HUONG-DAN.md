# Website Thực Dưỡng Lành – Hướng dẫn

## Cấu trúc

```
website/
├── build.py            ← chạy để tạo website: python3 build.py
├── data/
│   ├── site.json       ← hotline, email, địa chỉ, mạng xã hội, ngân hàng, link nhận đơn
│   ├── products.json   ← danh mục + sản phẩm (giá, ảnh, mô tả)
│   ├── posts.json      ← bài viết Góc Sống Lành
│   └── pages.json      ← các trang chính sách
├── assets/             ← CSS, JS, ảnh, video
├── backend/google-apps-script.gs  ← code nhận đơn hàng (Google Sheet + email)
└── dist/               ← WEBSITE HOÀN CHỈNH (thư mục này đưa lên hosting)
```

## 1. Sửa nội dung

1. Mở file trong `data/` và sửa.
2. Chạy `python3 build.py` trong thư mục `website/`.
3. Xem thử: `cd dist && python3 -m http.server 8000`, rồi mở http://localhost:8000
4. Đưa lại thư mục `dist/` lên hosting (mục 4).

**Giá sản phẩm:** trong `products.json`, `"price": 135000` là giá bán, `"regular_price": 189000` là giá gạch ngang.
Nếu `price` là `null` thì web hiện "Liên hệ" và ẩn nút giỏ hàng.

**Thêm sản phẩm:** chép một khối sản phẩm có sẵn, đổi `slug` (đường dẫn, không dấu), tên, ảnh.
Ảnh để trong `assets/img/products/` dạng `.webp`, gồm 2 bản: `ten-anh.webp` (1000px) và `ten-anh-sm.webp` (480px).

## 2. Thanh toán chuyển khoản (VietQR)

Trong `site.json`, mục `bank`:

```json
"bank": { "enabled": true, "bank_id": "VCB", "bank_name": "Vietcombank",
          "account_no": "0123456789", "account_name": "CONG TY TNHH TAP DOAN VITAGREEN NUTRITION" }
```

Khi khách chọn chuyển khoản, trang hoàn tất sẽ hiện mã QR đã điền sẵn số tiền và mã đơn.

## 3. Nhận đơn hàng vào Google Sheet + email

Nếu chưa cài, khách đặt xong sẽ được nhắc gửi đơn qua Zalo để không mất đơn.

1. Vào https://sheets.new, tạo bảng tính và đặt tên "Đơn hàng website Thực Dưỡng Lành".
2. Vào menu **Tiện ích mở rộng → Apps Script**, xóa code mẫu, dán toàn bộ `backend/google-apps-script.gs`, bấm Lưu.
3. Bấm **Triển khai → Tùy chọn triển khai mới**, chọn loại **Ứng dụng web**:
   - Thực thi với tư cách: **Tôi**
   - Người có quyền truy cập: **Bất kỳ ai**
4. Cấp quyền khi Google hỏi. Copy **URL ứng dụng web** (có đuôi `/exec`).
5. Dán URL vào `"order_endpoint"` trong `data/site.json`, chạy `python3 build.py` rồi tải `dist/` lên lại.

## 4. Hosting & tên miền (ĐANG CHẠY)

- Web đang chạy tại **https://thucduonglanh.vn** bằng GitHub Pages (miễn phí, HTTPS Let's Encrypt tự gia hạn).
- Kho chứa: https://github.com/thaisoniph/thucduonglanh.vn (chỉ chứa web hoàn chỉnh `dist/`, không chứa code nhận đơn).
- DNS tại Tenten: `@` có 4 bản ghi A (185.199.108.153 / .109 / .110 / .111), `www` là CNAME → `thaisoniph.github.io`. Không xoá các bản ghi này.

**Cập nhật web sau khi sửa nội dung:**
1. Tạo token mới tại https://github.com/settings/tokens/new?scopes=repo&description=thucduonglanh (chọn 7 days).
2. Trong thư mục `website/` chạy:
   `GH_USER=thaisoniph GH_TOKEN=ghp_xxx ./deploy-github.sh`
3. Khoảng 1 phút sau web tự cập nhật.

## 5. Sau khi web chạy
- Khai báo website với Bộ Công Thương tại online.gov.vn. Sau khi được duyệt, điền link vào `bo_cong_thuong_url` và đặt ảnh logo tại `assets/img/brand/bo-cong-thuong.png`.
- Gửi sitemap `https://thucduonglanh.vn/sitemap.xml` lên Google Search Console.
