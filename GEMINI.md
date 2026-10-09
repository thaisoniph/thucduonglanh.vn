# Quy tắc cho Gemini / Antigravity – dự án thucduonglanh.vn

Bối cảnh đầy đủ của dự án nằm trong `CLAUDE.md` và `HUONG-DAN.md`. Hãy đọc hai file đó trước khi sửa. Trả lời anh Sơn bằng tiếng Việt, ngắn gọn, dễ hiểu.

## BẮT BUỘC: lấy bản mới nhất trước khi sửa
Anh Sơn sửa dự án từ nhiều nơi: Claude trên máy tính, Claude trên điện thoại và Gemini. Nhân sự cũng sửa qua /admin. Vì vậy, **trước khi sửa bất kỳ file nào** trong mỗi phiên làm việc, phải chạy:

```
./scripts/sync-latest.sh
```

- Kết quả ✅: máy đã có bản mới nhất, sửa được.
- Kết quả ⚠️: chưa sửa. Làm theo hướng dẫn trong thông báo (gộp bằng `git pull --rebase`, hoặc hỏi anh Sơn về các file đang sửa dở).

## Sửa xong phải đẩy lên ngay
Sửa xong thì build thử (`python3 build.py`), commit rồi đẩy lên GitHub (`git pull --rebase https://github.com/thaisoniph/thucduonglanh.vn.git main` rồi `git push https://github.com/thaisoniph/thucduonglanh.vn.git HEAD:main`). Không để file sửa dở trong thư mục, vì phiên Claude sau có thể đẩy nhầm phần dở dang đó lên web.
