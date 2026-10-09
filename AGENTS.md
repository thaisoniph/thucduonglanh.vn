# Quy tắc cho Codex (ChatGPT) và các AI agent khác – dự án thucduonglanh.vn

Chủ dự án là anh Sơn, người không chuyên kỹ thuật. Trả lời bằng **tiếng Việt**, ngắn gọn, dễ hiểu.
Bối cảnh đầy đủ nằm trong `CLAUDE.md` (tóm tắt dự án) và `HUONG-DAN.md` (tài liệu kỹ thuật). **Đọc cả hai file trước khi sửa.**

## Vai trò của Codex trong dự án
Công cụ chính của dự án là Claude. Codex chủ yếu được dùng để:
1. **Duyệt Pull Request** trước khi anh Sơn bấm Merge: tìm lỗi, chỗ thiếu sót, chỗ vi phạm quy tắc bên dưới. Báo kết quả rõ ràng: "an toàn để Merge" hoặc "cần sửa: …".
2. **Dự phòng** khi Claude không dùng được: sửa lỗi nhỏ, việc gấp.
Việc lớn (tính năng CRM mới, đổi API, Apps Script) thì khuyên anh để Claude trên Mac làm.

## BẮT BUỘC: làm trên bản mới nhất
- Bản gốc là nhánh `main` trên GitHub `thaisoniph/thucduonglanh.vn`. Anh sửa từ nhiều nơi (Claude, Gemini, Codex) và nhân sự cũng sửa qua /admin.
- Nếu chạy trên máy (Codex CLI), trước khi sửa phải chạy `./scripts/sync-latest.sh`. Chỉ sửa khi kết quả báo ✅. Nếu báo ⚠️ thì làm theo thông báo, hoặc hỏi anh về các file đang sửa dở. Không tự xoá file của người khác.
- Nếu chạy trên đám mây (Codex cloud), làm trên nhánh mới tách từ `main` mới nhất.

## Đăng lên
- Trước khi đăng: `pip install -r requirements.txt` (nếu chưa cài), rồi `python3 build.py`. Build lỗi thì không đăng.
- **Codex cloud:** tạo Pull Request vào `main` và gửi anh link. Nhắc anh mở link → **Merge pull request** → **Confirm merge**. Không push thẳng `main`.
- **Codex CLI trên Mac:** `git pull --rebase https://github.com/thaisoniph/thucduonglanh.vn.git main` rồi `git push https://github.com/thaisoniph/thucduonglanh.vn.git HEAD:main`. Sửa xong là đẩy lên ngay, không để phần sửa dở trên máy.
- Push lên `main` thì GitHub Actions tự build và đăng website + CRM (Cloudflare). Nếu `backend/google-apps-script.gs` đổi thì Apps Script cũng được tự triển khai. Sau khoảng 1–2 phút là live.

## Không được làm
- Repo **công khai**: không ghi token, mật khẩu hay dữ liệu khách thật vào bất kỳ file nào.
- Không sửa cùng một tính năng mà một phiên AI khác đang làm dở. Nếu `git status` có file lạ đang sửa thì hỏi anh trước.
- Đổi tính năng CRM hoặc /admin thì phải sửa luôn hướng dẫn nhân sự trong `guide/*.md`.

## Nguyên tắc nội dung (thực phẩm bảo vệ sức khoẻ)
- Chỉ ghi công dụng đúng hồ sơ công bố. **Không dùng các từ "chữa", "điều trị", "khỏi bệnh".**
- Thực phẩm bổ sung phải có dòng "Sản phẩm này không phải là thuốc và không có tác dụng thay thế thuốc chữa bệnh." (trường `disclaimer` trong file sản phẩm).
- Thông tin sản phẩm lấy từ `content/products/*.json`. Không tự bịa thông tin.
