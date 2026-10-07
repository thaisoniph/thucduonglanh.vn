# Dự án website thucduonglanh.vn (Thực Dưỡng Lành – VitaGreen Nutrition)

Chủ dự án: anh Sơn (thaisoniph@gmail.com). Anh Sơn không chuyên kỹ thuật và thường làm việc từ app Claude trên điện thoại. Vì vậy:
- Trả lời bằng tiếng Việt, ngắn gọn, dễ hiểu. Câu trả lời cần đọc được trên màn hình nhỏ: ít bảng rộng, ít khối code dài.
- Việc gì làm được thì chủ động làm. Chỉ hỏi khi thật sự cần anh quyết định hoặc cung cấp thông tin.
- Đọc `HUONG-DAN.md` (tài liệu kỹ thuật đầy đủ) trước khi sửa.

## Repo này là gì
- GitHub `thaisoniph/thucduonglanh.vn`, **công khai**. Không bao giờ ghi token, mật khẩu, dữ liệu khách thật vào repo.
- Site tĩnh, build bằng `build.py` (Python) ra `dist/` (website) và `dist-crm/` (CRM nhân sự).
  - Nội dung: `content/products/*.json`, `content/combos/*.json`, `content/posts|pages/*.md`, `data/site.json` (hotline, ngân hàng, phí ship), `data/config.json` (GA4, Clarity, order_endpoint).
  - JS/CSS: `assets/js/main.js` (giỏ hàng, checkout, nhận diện địa chỉ, tracking có consent), `assets/css/`.
  - CMS: Sveltia tại `/admin` (`admin/config.yml`); trang tạo link UTM `/admin/utm`.
  - CRM web: `crm/` → crm.thucduonglanh.vn.
  - Hướng dẫn nhân sự: `guide/*.md` → crm.thucduonglanh.vn/huong-dan/. **Đổi tính năng CRM hoặc /admin thì sửa luôn `guide/`.**
- `backend/google-apps-script.gs`: code Apps Script (đơn hàng + CRM, gắn với Google Sheet). Token Telegram nằm trong Script Properties (`TELEGRAM_TOKEN`), không có trong code.
- `api/`: máy chủ Cloudflare Workers + D1 (api.thucduonglanh.vn) chạy chính thức từ 10/2026 (bản `2026-10-07d`). Nhận đơn web, phục vụ toàn bộ CRM API (hôm nay, khách hàng, đơn hàng, khách hỏi, hiệu quả, mức dùng CRM, góp ý...), nhận webhook Viettel Post, và đồng bộ 2 chiều với Google Sheet / file sale qua cron. Apps Script (`backend/google-apps-script.gs`) làm cầu nối Google (gửi email, cấp quyền đọc Sheet, dọn trigger cũ).

## Đăng lên (deploy)
- Push lên nhánh `main` → GitHub Actions build → Cloudflare Pages (website `thucduonglanh`, CRM `thucduonglanh-crm`). Khoảng 1–2 phút sau là live.
- Trước khi push: chạy `pip install -r requirements.txt` (nếu chưa cài) rồi `python3 build.py`. Build lỗi thì không push.
- Nhân sự sửa nội dung qua /admin cũng commit thẳng vào `main`, nên luôn `git pull --rebase origin main` trước khi push.
- Phiên Claude trên web/điện thoại push lên nhánh riêng (`claude/...`), không vào thẳng `main`. Khi anh Sơn nói "đăng lên", "cho live", "deploy": pull/rebase `main`, build thử, push nhánh, tạo Pull Request vào `main` rồi gửi anh link PR. Nhắc anh: mở link → **Merge pull request** → **Confirm merge** (làm được trong app GitHub hoặc trình duyệt điện thoại). Nếu phiên có quyền merge thì tự merge luôn.
- Sau khi đăng, báo anh link trang cần xem và nhắc anh chờ 1–2 phút.
- Trên máy Mac có thêm script `deploy-github.sh` (cần GH_TOKEN). Phiên Claude trên web/điện thoại không cần script này.
- Anh dùng cả Antigravity trên Mac (đẩy thẳng `main`) lẫn app Claude trên điện thoại. Lưu ý + cách quay lại bản trước: HUONG-DAN.md mục 8a, 8b.
- Anh nói "quay lại bản trước" / web hoặc CRM lỗi sau khi đăng: `git revert` commit (hoặc merge commit, `-m 1`) gây lỗi trên nhánh mới, build thử, tạo PR và tự merge nếu có quyền. Revert có đổi Apps Script thì workflow tự triển khai lại.

## Khi sửa Apps Script (`backend/google-apps-script.gs`)
Nếu đã cài **tự triển khai** (workflow `.github/workflows/apps-script.yml`, secrets `CLASPRC_JSON` + `APPS_SCRIPT_ID`, xem HUONG-DAN.md): merge vào `main` là GitHub tự Lưu + Triển khai phiên bản mới (~1–2 phút), báo anh xem tab Actions có ✅. Nếu chưa cài hoặc workflow báo bỏ qua/lỗi thì làm tay như dưới.
Làm tay: sau khi sửa và push, hướng dẫn anh Sơn từng bước:
1. Mở file trên GitHub, bấm biểu tượng Copy (sao chép toàn bộ nội dung). Nên làm trên máy tính, hoặc bật "Trang web cho máy tính" trên điện thoại.
2. Vào script.google.com → dự án Apps Script của Sheet "Đơn hàng website Thực Dưỡng Lành" → chọn hết code cũ → dán đè → Lưu.
3. Nếu có sửa `doPost` hoặc bất kỳ hàm `crm…` nào thì phải Triển khai → Quản lý các bản triển khai → ✏️ → Phiên bản mới → Triển khai. Nếu chỉ sửa hàm chạy theo lịch thì Lưu là đủ.
4. Nếu đổi `CRM_VERSION` thì CRM web sẽ kiểm tra số phiên bản này.
Mỗi lần sửa, nói rõ cho anh: lần này "chỉ cần Lưu" hay "phải Triển khai phiên bản mới".
Nếu CRM web (`crm/`) cần Apps Script bản mới mới chạy được thì phải báo trước khi anh merge. Code CRM web cũng phải chạy được với Apps Script bản cũ, vì anh có thể chưa kịp dán code (thường dán khi về tới máy tính).

## Đơn hàng & CRM
- Sheet "Đơn hàng website Thực Dưỡng Lành": các tab Đơn hàng, Khách hàng, Chu kỳ dùng, Mẫu tin nhắn CSKH, Liên hệ, Nhân sự CRM, Nhật ký CSKH.
- Báo đơn qua email và Telegram (bot @thucduonglanh_donhang_bot, nhóm "Đơn hàng Thực Dưỡng Lành"). Tin "CSKH hôm nay" gửi lúc 8h sáng.
- CRM: đăng nhập bằng mã email; quyền lấy từ tab "Nhân sự CRM" (thaisoniph@gmail.com luôn là Quản trị).
- Phí ship 30.000đ, miễn phí từ 300.000đ. Chuyển khoản qua QR VCB. Hotline/Zalo: 0966 326 522.

## Đo lường
- GA4 G-X40P3S7FZ8 và Clarity yoto1kqbmx chỉ tải sau khi khách đồng ý cookie (Nghị định 13/2023).
- Chưa có Meta Pixel và TikTok Pixel, chờ anh Sơn gửi mã.

## Tên miền
- DNS ở Cloudflare (zone thucduonglanh.vn). Đã dùng hết 10 redirect rule của gói miễn phí. `quatang` trỏ về LadiPage. Không đăng nhập Tenten bằng mật khẩu.

## Nguyên tắc nội dung
- Chỉ ghi công dụng đúng hồ sơ công bố. Không dùng các từ "chữa/điều trị/khỏi bệnh". Thực phẩm bổ sung phải có dòng "không phải là thuốc…".
- Thông tin sản phẩm lấy từ skill vitagreen-company-info, nếu phiên làm việc có skill này. Nếu không có thì dựa vào `content/products/*.json` và không tự bịa thông tin.

## Ảnh từ điện thoại
- Ảnh anh gửi trong cuộc trò chuyện được lưu ở `~/.claude/uploads/`. Ảnh chụp màn hình lỗi hay mẫu thiết kế thì chỉ cần xem. Ảnh cần đưa lên web thì nén WebP (rộng tối đa 1200px) rồi lưu vào `assets/uploads/`, đây cũng là thư mục ảnh của /admin.
- Ảnh và PDF gốc của công ty nằm trên máy Mac, ngoài repo. Phiên trên cloud không thấy các file này.
