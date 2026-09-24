#!/bin/bash
# Đẩy mã nguồn website lên GitHub. GitHub Actions sẽ tự dựng (build.py) và đăng lên https://thucduonglanh.vn
# Cách dùng:  GH_TOKEN=ghp_xxx ./deploy-github.sh "ghi chú thay đổi"
# Token cần quyền "repo" và "workflow". Token không được lưu lại trên máy.
set -euo pipefail
cd "$(dirname "$0")"
: "${GH_TOKEN:?Thiếu GH_TOKEN}"
GH_USER="${GH_USER:-thaisoniph}"
REPO="${GH_REPO:-thucduonglanh.vn}"
MSG="${1:-Cập nhật website $(date '+%d/%m/%Y %H:%M')}"
API="https://api.github.com/repos/$GH_USER/$REPO"
H=(-H "Authorization: Bearer $GH_TOKEN" -H "Accept: application/vnd.github+json" -H "X-GitHub-Api-Version: 2022-11-28")
B64=$(printf "x-access-token:%s" "$GH_TOKEN" | base64)
GIT=(git -c http.extraheader="Authorization: Basic $B64" -c user.name="Thuc Duong Lanh" -c user.email="vitagreennutrition@gmail.com")
URL="https://github.com/$GH_USER/$REPO.git"

python3 build.py >/dev/null   # kiểm tra build chạy được trước khi đẩy lên

[ -d .git ] || git init -q -b main
"${GIT[@]}" add -A
"${GIT[@]}" diff --cached --quiet || "${GIT[@]}" commit -qm "$MSG"
# Lấy các thay đổi nhân sự đã làm trên trang quản trị trước khi đẩy
if "${GIT[@]}" ls-remote --exit-code "$URL" main >/dev/null 2>&1 && [ "${FIRST_PUSH:-0}" != "1" ]; then
  "${GIT[@]}" pull -q --rebase "$URL" main
fi
if [ "${FIRST_PUSH:-0}" = "1" ]; then "${GIT[@]}" push -qf "$URL" main; else "${GIT[@]}" push -q "$URL" main; fi

# Đảm bảo GitHub Pages dùng GitHub Actions + tên miền riêng
curl -s -o /dev/null -X PUT "${H[@]}" -d '{"build_type":"workflow","cname":"thucduonglanh.vn","https_enforced":true}' "$API/pages"
echo "Đã đẩy lên. Theo dõi tiến trình: https://github.com/$GH_USER/$REPO/actions"
