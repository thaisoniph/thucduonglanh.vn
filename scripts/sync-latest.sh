#!/bin/bash
# Lấy bản mới nhất từ GitHub (nhánh main) về máy trước khi bắt đầu sửa.
# Chạy tự động khi mở phiên Claude Code (hook SessionStart); Gemini/Antigravity và người dùng chạy tay:
#   ./scripts/sync-latest.sh
# An toàn: chỉ tự cập nhật khi máy không có sửa đổi dở dang; nếu có thì chỉ cảnh báo, không đụng vào file.
cd "$(dirname "$0")/.." || exit 0
URL="https://github.com/thaisoniph/thucduonglanh.vn.git"

say() {  # in ra cho người dùng thấy + đưa vào bối cảnh cho trợ lý AI
  if [ -n "${CLAUDE_PROJECT_DIR:-}" ]; then
    python3 -c 'import json,sys; m=sys.argv[1]; print(json.dumps({"systemMessage": m, "hookSpecificOutput": {"hookEventName": "SessionStart", "additionalContext": m}}))' "$1"
  else
    echo "$1"
  fi
}

if ! git fetch -q "$URL" main 2>/dev/null; then
  say "⚠️ Đồng bộ GitHub: không kết nối được GitHub, chưa kiểm tra được bản mới nhất. Chạy lại scripts/sync-latest.sh khi có mạng trước khi sửa."
  exit 0
fi

branch=$(git branch --show-current)
read -r ahead behind < <(git rev-list --left-right --count HEAD...FETCH_HEAD)
dirty=$(git status --porcelain --untracked-files=no)

if [ "$behind" = "0" ]; then
  say "✅ Đồng bộ GitHub: máy đang có bản mới nhất (nhánh $branch)."
elif [ -n "$dirty" ]; then
  say "⚠️ Đồng bộ GitHub: GitHub có $behind thay đổi mới nhưng máy đang có file sửa dở nên CHƯA cập nhật:
$(echo "$dirty" | head -10)
Trợ lý AI: hỏi anh Sơn các file này là của ai/còn dùng không, rồi commit (hoặc stash) và chạy 'git pull --rebase $URL main' trước khi sửa tiếp."
elif [ "$ahead" = "0" ]; then
  git merge -q --ff-only FETCH_HEAD
  say "✅ Đồng bộ GitHub: đã lấy $behind thay đổi mới từ GitHub về (nhánh $branch). Giờ có thể sửa trên bản mới nhất."
else
  say "⚠️ Đồng bộ GitHub: máy có $ahead commit chưa đẩy lên, GitHub có $behind thay đổi mới. Trợ lý AI: chạy 'git pull --rebase $URL main' (gộp, xử lý xung đột nếu có) trước khi sửa tiếp."
fi
