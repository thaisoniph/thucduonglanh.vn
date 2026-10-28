#!/bin/bash
# Chuyển trợ lý Zalo An Lành từ máy Mac lên VPS (Ubuntu/Debian) để chạy 24/7. Chạy trên Mac:
#   bash zalo-bot/cai-vps.sh root@<IP-VPS>
# Cần đăng nhập SSH được vào VPS (lần đầu: ssh-copy-id root@<IP-VPS>, gõ mật khẩu VPS).
# Chép bot.js + .env + creds.json (phiên Zalo đã quét trên Mac, khỏi quét lại) lên /opt/tdl-zalo-bot,
# chạy bằng systemd (tự bật lại khi VPS khởi động / bị lỗi), rồi tắt bản trên Mac (2 nơi cùng chạy sẽ đá nhau ra).
# Không đụng tới n8n hay chương trình khác trên VPS. Lần sau cập nhật code: chạy lại đúng lệnh này.
set -e
H="$1"
[ -z "$H" ] && { echo "Cách dùng: bash zalo-bot/cai-vps.sh root@<IP-VPS>"; exit 1; }
SRC="$(cd "$(dirname "$0")" && pwd)"
MAC="$HOME/.tdl-zalo-bot"
PL="$HOME/Library/LaunchAgents/vn.thucduonglanh.zalobot.plist"
for f in .env creds.json; do [ -f "$MAC/$f" ] || { echo "❌ Chưa có $MAC/$f. Chạy bash zalo-bot/cai-dat.sh trên Mac trước."; exit 1; }; done
SSH="ssh -o ConnectTimeout=15 $H"
$SSH true || { echo "❌ Không vào được VPS. Chạy: ssh-copy-id $H  (gõ mật khẩu VPS) rồi chạy lại."; exit 1; }

echo "🖥  Chuẩn bị VPS (Node.js 20, người dùng tdlbot)…"
$SSH 'bash -s' <<'EOF'
set -e
SUDO=""; [ "$(id -u)" -ne 0 ] && SUDO="sudo"
if ! command -v node >/dev/null || [ "$(node -p 'process.versions.node.split(".")[0]')" -lt 20 ]; then
  curl -fsSL https://deb.nodesource.com/setup_20.x | $SUDO bash - >/dev/null
  $SUDO apt-get install -y nodejs >/dev/null
fi
id tdlbot >/dev/null 2>&1 || $SUDO useradd -r -m -d /opt/tdl-zalo-bot -s /usr/sbin/nologin tdlbot
$SUDO mkdir -p /opt/tdl-zalo-bot/tmp && $SUDO chmod 700 /opt/tdl-zalo-bot
$SUDO timedatectl set-timezone Asia/Ho_Chi_Minh 2>/dev/null || true
echo "Node $(node -v)"
EOF

echo "📤 Chép chương trình + phiên đăng nhập lên VPS…"
TMPD="/tmp/tdl-zalo-$$"
$SSH "mkdir -p $TMPD && chmod 700 $TMPD"
scp -q "$SRC/bot.js" "$SRC/package.json" "$SRC/package-lock.json" "$MAC/.env" "$MAC/creds.json" "$H:$TMPD/"

echo "⏸  Tắt bản trên Mac…"
launchctl bootout "gui/$(id -u)" "$PL" 2>/dev/null || true
[ -f "$PL" ] && mv "$PL" "$PL.da-chuyen-vps"

echo "📦 Cài thư viện và cho chạy nền trên VPS…"
$SSH "TMPD=$TMPD bash -s" <<'EOF'
set -e
SUDO=""; [ "$(id -u)" -ne 0 ] && SUDO="sudo"
D=/opt/tdl-zalo-bot
$SUDO cp "$TMPD"/bot.js "$TMPD"/package.json "$TMPD"/package-lock.json "$D/"
# phiên đăng nhập: chỉ chép lần đầu (về sau bot tự làm mới creds.json trên VPS)
[ -f "$D/creds.json" ] || $SUDO cp "$TMPD/creds.json" "$D/"
[ -f "$D/.env" ] || $SUDO cp "$TMPD/.env" "$D/"
rm -rf "$TMPD"
$SUDO chown -R tdlbot:tdlbot "$D" && $SUDO chmod 600 "$D/.env" "$D/creds.json"
cd "$D" && $SUDO -u tdlbot npm ci --omit=dev --no-audit --no-fund >/dev/null 2>&1 || (cd "$D" && $SUDO npm ci --omit=dev --no-audit --no-fund >/dev/null && $SUDO chown -R tdlbot:tdlbot "$D")
$SUDO tee /etc/systemd/system/tdl-zalo-bot.service >/dev/null <<UNIT
[Unit]
Description=Tro ly Zalo An Lanh (Thuc Duong Lanh)
After=network-online.target
Wants=network-online.target
[Service]
User=tdlbot
WorkingDirectory=$D
ExecStart=$(command -v node) $D/bot.js
Restart=always
RestartSec=60
Environment=TZ=Asia/Ho_Chi_Minh
MemoryMax=400M
[Install]
WantedBy=multi-user.target
UNIT
$SUDO systemctl daemon-reload
$SUDO systemctl enable tdl-zalo-bot >/dev/null 2>&1
$SUDO systemctl restart tdl-zalo-bot
sleep 12
$SUDO journalctl -u tdl-zalo-bot -n 8 --no-pager -o cat
EOF
echo
echo "✅ Xong. Trợ lý chạy trên VPS 24/7, đã tắt bản trên Mac."
echo "Xem nhật ký: ssh $H journalctl -u tdl-zalo-bot -f   ·   Khởi động lại: ssh $H systemctl restart tdl-zalo-bot"
echo "Nếu Zalo bắt đăng nhập lại: ssh $H 'cd /opt/tdl-zalo-bot && sudo -u tdlbot node bot.js --dang-nhap' rồi chép qr.png về máy để quét."
