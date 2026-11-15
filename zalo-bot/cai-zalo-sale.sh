#!/bin/bash
# 👀 Cài "chương trình giữ Zalo của sale" lên VPS – CÀI 1 LẦN DUY NHẤT. Về sau kết nối / ngắt từng sale bấm trong CRM.
# Chạy trên máy Mac (đã vào SSH được VPS, như trợ lý An Lành):
#   bash zalo-bot/cai-zalo-sale.sh tdl-vps
# Không cần nhập khoá: script tự lấy ZBOT_KEY từ trợ lý An Lành đang chạy trên VPS (/opt/tdl-zalo-bot/.env).
#   Nếu chưa cài trợ lý An Lành, truyền tay: ZSALE_KEY=<khoá> bash zalo-bot/cai-zalo-sale.sh tdl-vps
# Chương trình CHỈ ĐỌC tin nhắn riêng của sale với khách. Không đụng trợ lý An Lành (dịch vụ systemd khác).
set -e
H="$1"
[ -z "$H" ] && { echo "Cách dùng: bash zalo-bot/cai-zalo-sale.sh tdl-vps"; exit 1; }
SRC="$(cd "$(dirname "$0")" && pwd)"
SSH="ssh -o ConnectTimeout=15 $H"
$SSH true || { echo "❌ Không vào được VPS. Chạy: ssh-copy-id $H  rồi chạy lại."; exit 1; }
D="/opt/tdl-zalo-sale"

echo "🖥  Chuẩn bị VPS (Node.js 20, người dùng tdlbot)…"
$SSH 'bash -s' <<'EOF'
set -e
SUDO=""; [ "$(id -u)" -ne 0 ] && SUDO="sudo"
if ! command -v node >/dev/null || [ "$(node -p 'process.versions.node.split(".")[0]')" -lt 20 ]; then
  curl -fsSL https://deb.nodesource.com/setup_20.x | $SUDO bash - >/dev/null
  $SUDO apt-get install -y nodejs >/dev/null
fi
id tdlbot >/dev/null 2>&1 || $SUDO useradd -r -m -d /opt/tdl-zalo-bot -s /usr/sbin/nologin tdlbot
$SUDO timedatectl set-timezone Asia/Ho_Chi_Minh 2>/dev/null || true
EOF

echo "📤 Chép chương trình lên VPS…"
TMPD="/tmp/tdl-zsale-$$"
$SSH "mkdir -p $TMPD && chmod 700 $TMPD"
scp -q "$SRC/sale-manager.js" "$SRC/package.json" "$SRC/package-lock.json" "$H:$TMPD/"

echo "📦 Cài thư viện + tạo dịch vụ tdl-zalo-sale…"
$SSH "TMPD=$TMPD D=$D ZSALE_KEY='${ZSALE_KEY:-}' bash -s" <<'EOF'
set -e
SUDO=""; [ "$(id -u)" -ne 0 ] && SUDO="sudo"
$SUDO mkdir -p "$D/creds"
$SUDO cp "$TMPD"/sale-manager.js "$TMPD"/package.json "$TMPD"/package-lock.json "$D/"
# Khoá: ưu tiên ZSALE_KEY truyền vào, không có thì lấy ZBOT_KEY của trợ lý An Lành
if [ -z "$ZSALE_KEY" ] && [ -f /opt/tdl-zalo-bot/.env ]; then ZSALE_KEY="$(grep -E '^ZBOT_KEY=' /opt/tdl-zalo-bot/.env | head -1 | cut -d= -f2-)"; fi
[ -z "$ZSALE_KEY" ] && { echo "❌ Không tìm thấy khoá. Chạy lại: ZSALE_KEY=<khoá giống ZBOT_KEY> bash zalo-bot/cai-zalo-sale.sh <vps>"; exit 1; }
[ -f "$D/.env" ] || printf 'ZSALE_KEY=%s\nAPI_URL=https://api.thucduonglanh.vn/\n' "$ZSALE_KEY" | $SUDO tee "$D/.env" >/dev/null
rm -rf "$TMPD"
$SUDO chown -R tdlbot:tdlbot "$D" && $SUDO chmod 600 "$D/.env" && $SUDO chmod 700 "$D/creds"
cd "$D" && $SUDO -u tdlbot npm ci --omit=dev --no-audit --no-fund >/dev/null 2>&1 || (cd "$D" && $SUDO npm ci --omit=dev --no-audit --no-fund >/dev/null && $SUDO chown -R tdlbot:tdlbot "$D")
$SUDO tee /etc/systemd/system/tdl-zalo-sale.service >/dev/null <<UNIT
[Unit]
Description=Giu Zalo cua sale (chi doc)
After=network-online.target
Wants=network-online.target
[Service]
User=tdlbot
WorkingDirectory=$D
ExecStart=$(command -v node) $D/sale-manager.js
Restart=always
RestartSec=60
Environment=TZ=Asia/Ho_Chi_Minh
MemoryMax=500M
[Install]
WantedBy=multi-user.target
UNIT
$SUDO systemctl daemon-reload
$SUDO systemctl enable tdl-zalo-sale >/dev/null 2>&1
$SUDO systemctl restart tdl-zalo-sale
sleep 8
$SUDO journalctl -u tdl-zalo-sale -n 8 --no-pager -o cat
EOF
echo
echo "✅ Xong. Chương trình giữ Zalo của sale chạy 24/7 (chỉ đọc)."
echo "👉 Giờ vào CRM → 👀 Zalo của sale → ➕ Kết nối, chọn sale, cho sale quét mã QR hiện trong CRM. Không cần SSH nữa."
echo "Nhật ký: ssh $H journalctl -u tdl-zalo-sale -f   ·   Khởi động lại: ssh $H systemctl restart tdl-zalo-sale"
echo "Cập nhật code sau này: chạy lại đúng lệnh này."
