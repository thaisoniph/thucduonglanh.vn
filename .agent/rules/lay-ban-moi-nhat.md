---
trigger: always_on
---

Trước khi sửa bất kỳ file nào trong phiên làm việc, chạy `./scripts/sync-latest.sh` (trong thư mục `website/`) để lấy bản mới nhất từ GitHub. Chỉ sửa khi kết quả báo ✅. Nếu báo ⚠️ thì làm theo hướng dẫn trong thông báo hoặc hỏi anh Sơn. Sửa xong thì build thử, commit và đẩy lên GitHub ngay. Xem thêm `GEMINI.md`.
