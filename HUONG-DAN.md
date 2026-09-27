# Website Thực Dưỡng Lành – Hướng dẫn kỹ thuật & vận hành

Cập nhật: 27/09/2026 · Web: https://thucduonglanh.vn · Quản trị: https://thucduonglanh.vn/admin/ · Kho mã: https://github.com/thaisoniph/thucduonglanh.vn

> Tài liệu dành cho chủ web / người phụ trách kỹ thuật. Nhân sự dùng Google Docs "Hướng dẫn cập nhật website thucduonglanh.vn (dành cho nhân sự)".

---

## 1. Tổng quan hệ thống

```
Nhân sự sửa ở /admin ─► lưu vào GitHub (content/, data/) ─► GitHub Actions chạy build.py ─► Cloudflare Pages ─► thucduonglanh.vn (~1 phút)

Khách đặt hàng ─► Google Apps Script ─► Google Sheet "Đơn hàng website Thực Dưỡng Lành"
                                        ├─ cập nhật trang "Khách hàng" (CRM)
                                        ├─ email vitagreennutrition@gmail.com
                                        └─ nhóm Telegram "Đơn hàng Thực Dưỡng Lành"
8h sáng mỗi ngày ─► Apps Script gửi danh sách "CSKH hôm nay" vào nhóm Telegram
```

| Thành phần | Nơi quản lý | Chi phí |
|---|---|---|
| Tên miền thucduonglanh.vn | Tenten (đăng ký, gia hạn – hết hạn 22/04/2027) | theo Tenten |
| DNS + link chuyển hướng | Cloudflare (dash.cloudflare.com) | miễn phí |
| Hosting | Cloudflare Pages – dự án `thucduonglanh` (dự phòng: thucduonglanh.pages.dev) | miễn phí |
| Mã nguồn + lịch sử sửa | GitHub `thaisoniph/thucduonglanh.vn` | miễn phí |
| Trang quản trị | Sveltia CMS tại /admin | miễn phí |
| Đơn hàng + CRM | Google Sheet + Apps Script | miễn phí |
| Báo đơn | Email + Telegram bot `@thucduonglanh_donhang_bot` | miễn phí |
| Đo lường | Google Analytics 4 `G-X40P3S7FZ8`, Microsoft Clarity `yoto1kqbmx` | miễn phí |

---

## 2. Cấu trúc mã nguồn

```
website/
├── admin/                 trang quản trị (index.html, config.yml) + utm.html (tạo link theo dõi)
├── content/
│   ├── products/*.json    mỗi sản phẩm 1 file (tên file = đường link /san-pham/<tên>/)
│   ├── posts/*.md         bài viết Góc Sống Lành
│   └── pages/*.md         trang chính sách
├── data/
│   ├── site.json          liên hệ, hotline/Zalo, mạng xã hội, ngân hàng, phí ship, kênh cộng đồng
│   ├── home.json          slider trang chủ
│   ├── categories.json    danh mục sản phẩm
│   ├── post-categories.json
│   ├── brochure.json      trang Hồ sơ thương hiệu
│   ├── vn-units.json      34 tỉnh/thành + 3.321 phường/xã (sau 1/7/2025) – dùng nhận diện địa chỉ
│   └── config.json        kỹ thuật: tên miền, link nhận đơn, mã GA4/Clarity/Pixel (không có trong /admin)
├── assets/                CSS, JS, ảnh, video, PDF; ảnh tải từ /admin nằm ở assets/uploads/
├── build.py               sinh web vào dist/ (tự nén ảnh sang WebP)
├── .github/workflows/deploy.yml   tự build + đăng lên Cloudflare mỗi khi có thay đổi
└── backend/               CHỈ Ở MÁY (không đưa lên GitHub – có mã Telegram)
    ├── google-apps-script.gs            code nhận đơn + CRM
    └── cloudflare-redirect-rules.json   bản sao 10 quy tắc chuyển hướng
```

---

## 3. Tính năng chính của website

**Bán hàng**
- Trang chủ theo bố cục thuanchay.vn; danh mục; trang sản phẩm nhiều quy cách/giá; giỏ hàng; tìm kiếm (gõ không dấu được); yêu thích.
- **"Mua ngay"** mở khung Đặt hàng nhanh ngay trên trang sản phẩm (không qua giỏ).
- **Form đặt hàng**: Họ tên, SĐT (chấp nhận dấu cách, +84), địa chỉ 1 ô – **tự nhận diện Tỉnh/Phường** (hiểu viết tắt, không dấu, tên tỉnh cũ → tỉnh mới), Nhà riêng/Văn phòng, bảng chọn khu vực kiểu Shopee, **Dán và nhập nhanh**, ghi chú nhanh (Giao giờ hành chính / Gọi trước khi giao / Địa chỉ cũ), lưu thông tin cho lần sau (thẻ "Giao đến"), ô đồng ý nhận tư vấn.
- **Phí vận chuyển**: đơn < 300.000đ cộng 30.000đ; từ 300.000đ miễn phí (sửa trong /admin → Cài đặt → Thông tin liên hệ…). Thanh tiến độ "Mua thêm … để được miễn phí vận chuyển".
- **Gợi ý mua kèm**: tối đa 3 món, ưu tiên món giúp đơn đạt 300.000đ và cặp khai báo ở ô "Gợi ý mua kèm" của từng sản phẩm.
- **Thanh toán**: Chuyển khoản (chọn sẵn, hiện mã VietQR Vietcombank đúng số tiền + mã đơn) hoặc COD.

**Nội dung**: Góc Sống Lành, Giới thiệu, **Hồ sơ thương hiệu** (/ho-so-thuong-hieu/ – sách lật Heyzine + PDF), trang chính sách, Liên hệ (form gửi về Sheet/Telegram).

**Liên hệ nhanh**: nút Gọi / Zalo nổi (điện thoại: 2 nút), hotline **0966 326 522**, Zalo OA ở chân trang.

---

## 4. Đơn hàng & CRM (Google Sheet)

Sheet **Đơn hàng website Thực Dưỡng Lành**: https://docs.google.com/spreadsheets/d/1RlDE9iFVtRaOwOfg2p_X_vpV9Q5MTrKquBEcv6gMIIM/edit

| Trang tính | Nội dung |
|---|---|
| Đơn hàng | Mỗi đơn 1 dòng: khách, SĐT, địa chỉ ([Nhà riêng]/[Văn phòng]), sản phẩm, tạm tính, phí ship, tổng, thanh toán, ghi chú, **Trạng thái**, **Nguồn**, **Đồng ý nhận tin**. Nhân viên cập nhật Trạng thái: Mới → Đã xác nhận → Đã giao / Huỷ. |
| Khách hàng | Tự gộp theo SĐT: số đơn, tổng chi, đơn đầu/gần nhất, sản phẩm đã mua, **Dự kiến hết hàng**, **Nhóm** (Mới / Quay lại / VIP ≥3 đơn hoặc ≥2 triệu / Sắp mất >60 ngày). Nhân viên điền: Phụ trách, Lần CSKH gần nhất, Kết quả CSKH, Ghi chú CSKH. |
| Chu kỳ dùng | Số ngày dùng hết 1 đơn vị sản phẩm → tính "Dự kiến hết hàng". Chỉnh theo thực tế. |
| Mẫu tin nhắn CSKH | Mẫu Zalo cho từng thời điểm chăm sóc. |
| Liên hệ | Lời nhắn từ form Liên hệ. |

**Tin Telegram 8h sáng**: hỏi nhận hàng (đơn hôm qua) · sắp hết / đã hết sản phẩm (–7 đến +2 ngày, bỏ qua khách đã chăm sóc) · xin cảm nhận (D+14) · giới thiệu sản phẩm (D+30) · mời quay lại (60 ngày).

**Hàm trong Apps Script** (chọn hàm → ▶ Chạy):

| Hàm | Khi nào dùng |
|---|---|
| `setupCRM` | Lần đầu cài CRM, hoặc cài lại lịch 8h |
| `dailyCare` | Xem thử tin CSKH ngay |
| `rebuildCustomers` | Sau khi sửa/huỷ đơn cũ – tính lại trang Khách hàng (giữ cột CSKH) |
| `testTelegram` | Kiểm tra bot Telegram |

**Sửa code Apps Script**: dán đè toàn bộ `backend/google-apps-script.gs` → Lưu. Nếu sửa phần nhận đơn (`doPost`) thì thêm: Triển khai → Quản lý các bản triển khai → ✏️ → **Phiên bản mới** → Triển khai (link nhận đơn giữ nguyên). Lịch 8h luôn dùng bản đã lưu mới nhất.

**Người nhận báo đơn**: thêm/xoá thành viên trong nhóm Telegram "Đơn hàng Thực Dưỡng Lành" – không cần sửa code.

---

## 5. Đo lường & remarketing

- Mã trong `data/config.json`: `ga4_id` = **G-X40P3S7FZ8**, `clarity_id` = **yoto1kqbmx**, `meta_pixel`, `tiktok_pixel` (để trống = chưa bật).
- Công cụ chỉ chạy **sau khi khách bấm "Đồng ý"** ở thông báo cookie (Nghị định 13/2023/NĐ-CP).
- Sự kiện: `view_item`, `add_to_cart`, `begin_checkout`, `purchase` (doanh thu), `upsell_add`, `paste_fill`, `click_call`, `click_zalo`, `view_brochure`, `video_play`, `search`, `generate_lead`.
- Nguồn khách (UTM / fbclid / ttclid / gclid / trang giới thiệu) lưu 30 ngày → cột **Nguồn** của đơn.
- **Tạo link theo dõi**: https://thucduonglanh.vn/admin/utm – dùng cho mọi bài đăng/quảng cáo.
- Báo cáo: analytics.google.com (Thời gian thực, Thu nạp người dùng, Kiếm tiền) · clarity.microsoft.com (Bản ghi, Bản đồ nhiệt).
- Nên làm trong GA4: đánh dấu sự kiện chính `purchase`, `click_call`, `click_zalo`, `generate_lead`; lưu dữ liệu 14 tháng; liên kết Search Console.

---

## 6. Trang quản trị & nhân sự

- Cấp quyền: https://github.com/thaisoniph/thucduonglanh.vn/settings/access → **Add people** → quyền **Write**. Nghỉ việc → **Remove**.
- Nhân sự đăng nhập /admin bằng **mã truy cập GitHub** (quyền `public_repo`), chọn "Đăng nhập bằng mã truy cập".
- Trong /admin: Bài viết · Sản phẩm (giá, quy cách, ảnh, mô tả, **Gợi ý mua kèm**, ẩn/hiện) · Trang chính sách · Cài đặt (liên hệ, mạng xã hội, ngân hàng, **phí ship**, kênh cộng đồng, slider, danh mục, **Hồ sơ thương hiệu**).
- Mọi lần lưu có lịch sử trên GitHub → khôi phục được.

---

## 7. Tên miền, DNS, chuyển hướng

- Nameserver: `liberty.ns.cloudflare.com`, `randy.ns.cloudflare.com`. **Mọi thay đổi DNS làm trên Cloudflare**, không làm ở Tenten.
- `www` và `http://` tự chuyển về `https://thucduonglanh.vn`.
- Link phụ = **Redirect Rules** (Cloudflare → thucduonglanh.vn → Rules → Redirect Rules), dùng đủ 10/10 quy tắc gói miễn phí: story, ld, shop, shopee, family, **cauchuyen → /ho-so-thuong-hieu/**, sotay, mkt, quacmadiamond + quy tắc HTTPS/www. `quatang` là CNAME tới LadiPage.
- GitHub Actions dùng secrets `CLOUDFLARE_API_TOKEN`, `CLOUDFLARE_ACCOUNT_ID` (GitHub → Settings → Secrets).

---

## 8. Sửa giao diện / chạy thử trên máy

```bash
cd website
python3 -m pip install --user -r requirements.txt               # lần đầu
python3 build.py && (cd dist && python3 -m http.server 8000)    # xem http://localhost:8000
GH_TOKEN=ghp_xxx ./deploy-github.sh "ghi chú thay đổi"           # đẩy lên (token quyền repo + workflow)
```
Script tự lấy các thay đổi nhân sự đã làm ở /admin trước khi đẩy.

---

## 9. Việc nên làm tiếp

- Khai báo website với Bộ Công Thương (online.gov.vn) → điền `bo_cong_thuong_url` trong `data/config.json`, đặt logo tại `assets/img/brand/bo-cong-thuong.png`.
- Gửi mã Meta Pixel / TikTok Pixel khi có tài khoản quảng cáo.
- Brochure PDF/Heyzine còn hotline cũ 0896 869 333 (trang 32) và câu công dụng DILVANG (trang 19) – sửa ở bản thiết kế mới.
- Bổ sung ảnh + thông tin 4 sản phẩm: Trà Mâm Xôi, Bột Đậu Xanh Rau Má, Gafo Fucoidan, Fucoidan Progomax.
