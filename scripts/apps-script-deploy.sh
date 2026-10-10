#!/usr/bin/env bash
# Đẩy backend/google-apps-script.gs lên dự án Apps Script của Sheet đơn hàng rồi triển khai phiên bản mới
# vào ĐÚNG bản triển khai đang dùng (link order_endpoint trong data/config.json giữ nguyên).
# Chạy bởi .github/workflows/apps-script.yml (anh Sơn đồng ý cài 06/10/2026). Cần biến môi trường:
#   CLASPRC_JSON   nội dung ~/.clasprc.json (đăng nhập clasp của tài khoản sở hữu Apps Script)
#   APPS_SCRIPT_ID mã dự án Apps Script (Cài đặt dự án → Mã tập lệnh)
#   CLASP          lệnh clasp (mặc định: npx -y @google/clasp@2.4.2)
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
SRC="$ROOT/backend/google-apps-script.gs"
CLASP="${CLASP:-npx -y @google/clasp@2.4.2}"
: "${CLASPRC_JSON:?Thiếu CLASPRC_JSON}" "${APPS_SCRIPT_ID:?Thiếu APPS_SCRIPT_ID}"

# 1. Kiểm tra code trước khi đẩy
node -e "new Function(require('fs').readFileSync(process.argv[1], 'utf8'))" "$SRC" || { echo "::error::Code Apps Script lỗi cú pháp, không đẩy lên."; exit 1; }
if grep -Eq '[0-9]{8,10}:AA[A-Za-z0-9_-]{30,}' "$SRC"; then echo "::error::Có token Telegram trong code, không đẩy lên."; exit 1; fi
VER="$(sed -n "s/^var CRM_VERSION = '\([^']*\)'.*/\1/p" "$SRC" | head -1)"
ENDPOINT="$(node -p "require('$ROOT/data/config.json').order_endpoint")"
DEPLOY_ID="$(echo "$ENDPOINT" | sed -n 's#.*/macros/s/\([^/]*\)/exec.*#\1#p')"
[ -n "$VER" ] && [ -n "$DEPLOY_ID" ] || { echo "::error::Không đọc được CRM_VERSION hoặc mã triển khai từ data/config.json."; exit 1; }
echo "Phiên bản code: $VER · bản triển khai: ${DEPLOY_ID:0:12}…"

# 2. Đăng nhập + tải dự án hiện tại (giữ appsscript.json và các file khác nếu có)
umask 077; printf '%s' "$CLASPRC_JSON" > "$HOME/.clasprc.json"
WORK="$(mktemp -d)"; cd "$WORK"
printf '{"scriptId":"%s","rootDir":"."}' "$APPS_SCRIPT_ID" > .clasp.json
$CLASP pull
TARGET="$(grep -l 'function doPost' -- *.js *.gs 2>/dev/null | head -1 || true)"
if [ -z "$TARGET" ]; then
  N="$(ls -1 -- *.js *.gs 2>/dev/null | wc -l)"
  [ "$N" = 1 ] && TARGET="$(ls -1 -- *.js *.gs 2>/dev/null)" || { echo "::error::Không tìm thấy file code chính trong dự án Apps Script (có $N file)."; ls -la; exit 1; }
fi
echo "Ghi đè file: $TARGET"
cp "$SRC" "$TARGET"

# 2b. Dịch vụ nâng cao (backend/appsscript-services.json): thêm vào appsscript.json nếu chưa có.
#     Có dịch vụ mới mà chủ tài khoản chưa bấm Cho phép (authorized=false) → chỉ Lưu (push), KHÔNG triển khai:
#     web app chạy bản cần quyền chưa cấp sẽ báo lỗi, cầu nối Google (mã đăng nhập CRM, Sheet) ngừng chạy.
SVC="$ROOT/backend/appsscript-services.json"
if [ -f "$SVC" ]; then
  HEAD_ONLY="$(node -e '
    const fs=require("fs"), want=JSON.parse(fs.readFileSync(process.argv[1],"utf8")), m=JSON.parse(fs.readFileSync("appsscript.json","utf8"));
    const dep=m.dependencies=m.dependencies||{}, list=dep.enabledAdvancedServices=dep.enabledAdvancedServices||[]; let added=0;
    for (const s of want.services||[]) if (!list.some(x=>x.userSymbol===s.userSymbol)) { list.push(s); added++; }
    fs.writeFileSync("appsscript.json", JSON.stringify(m,null,2));
    console.log(want.authorized===false ? "1" : "");
  ' "$SVC")"
  if [ -n "$HEAD_ONLY" ]; then
    $CLASP push -f
    echo "::warning::Đã Lưu code + dịch vụ mới, CHƯA triển khai: chờ chủ tài khoản mở Apps Script bấm ▶ Chạy → Cho phép, rồi đổi authorized=true trong backend/appsscript-services.json."
    exit 0
  fi
fi

# 3. Đẩy code (= Lưu), tạo phiên bản, cập nhật bản triển khai đang dùng
$CLASP push -f
MSG="$VER · $(git -C "$ROOT" log -1 --format=%h) $(node -e 'console.log(process.argv[1].slice(0, 60))' "$(git -C "$ROOT" log -1 --format=%s)")"
OUT="$($CLASP version "$MSG")"; echo "$OUT"
NUM="$(echo "$OUT" | grep -oE 'version [0-9]+' | grep -oE '[0-9]+' | tail -1)"
[ -n "$NUM" ] || { echo "::error::Không tạo được phiên bản mới (Apps Script giới hạn 200 phiên bản: vào Apps Script xoá bớt phiên bản cũ)."; exit 1; }
$CLASP deploy -i "$DEPLOY_ID" -V "$NUM" -d "$MSG"

# 4. Kiểm tra máy chủ đã chạy bản mới
for i in 1 2 3 4 5 6; do
  GOT="$(curl -sL --max-time 30 "$ENDPOINT" | node -e "let s='';process.stdin.on('data',d=>s+=d).on('end',()=>{try{console.log(JSON.parse(s).v||'')}catch(e){console.log('')}})")"
  [ "$GOT" = "$VER" ] && { echo "✅ Apps Script đang chạy bản $VER (phiên bản số $NUM)"; exit 0; }
  echo "Máy chủ trả bản '${GOT:-?}', chờ thêm…"; sleep 10
done
echo "::error::Đã triển khai phiên bản $NUM nhưng máy chủ chưa trả đúng bản $VER."; exit 1
