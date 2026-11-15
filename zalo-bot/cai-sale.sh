#!/bin/bash
# 👀 Cài "người đọc Zalo của sale" lên VPS, chạy 24/7. Mỗi sale 1 bản (1 dịch vụ systemd riêng).
# Chạy trên máy Mac của người kỹ thuật (lần đầu cần quét mã QR bằng Zalo của sale):
#   ZSALE_KEY=<khoá giống secret của Worker> bash zalo-bot/cai-sale.sh tdl-vps thuy "Chị Thuý"
#     tdl-vps  = tên tắt SSH trong ~/.ssh/config (đã dùng cho trợ lý An Lành)
#     thuy     = mã ngắn của sale (chữ thường, không dấu, không cách)
#     "Chị Thuý" = tên hiện trong CRM
# ZSALE_KEY: cùng giá trị với secret ZSALE_KEY của Worker thucduonglanh-api (đặt 1 lần bằng: npx wrangler secret put ZSALE_KEY).
#   Chương trình này chỉ ĐỌC tin nhắn riêng của sale với khách, không bao giờ gửi. Không đụng trợ lý An Lành (dịch vụ khác).
set -e
H="$1"; SALE="$2"; NAME="$3"
[ -z "$H" ] || [ -z "$SALE" ] && { echo 'Cách dùng: ZSALE_KEY=... bash zalo-bot/cai-sale.sh <vps> <sale-id> "<Tên sale>"'; exit 1; }
[ -z "$NAME" ] && NAME="$SALE"
[ -z "$ZSALE_KEY" ] && { echo "❌ Thiếu biến ZSALE_KEY. Chạy: ZSALE_KEY=<khoá> bash zalo-bot/cai-sale.sh $H $SALE \"$NAME\""; exit 1; }
echo "$SALE" | grep -qE '^[a-z0-9]+$' || { echo "❌ sale-id chỉ gồm chữ thường và số (vd thuy, hoa2)."; exit 1; }
SRC="$(cd "$(dirname "$0")" && pwd)"
SSH="ssh -o ConnectTimeout=15 $H"
$SSH true || { echo "❌ Không vào được VPS. Chạy: ssh-copy-id $H  rồi chạy lại."; exit 1; }
D="/opt/tdl-zalo-sale/$SALE"

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

echo "📤 Chép chương trình đọc lên VPS…"
TMPD="/tmp/tdl-zsale-$$"
$SSH "mkdir -p $TMPD && chmod 700 $TMPD"
scp -q "$SRC/sale-reader.js" "$SRC/package.json" "$SRC/package-lock.json" "$H:$TMPD/"
# .env riêng của sale (bí mật, không đưa lên GitHub)
printf 'ZSALE_KEY=%s\nSALE_ID=%s\nSALE_NAME=%s\n' "$ZSALE_KEY" "$SALE" "$NAME" | $SSH "cat > $TMPD/.env"

echo "📦 Cài thư viện + tạo dịch vụ tdl-zalo-sale-$SALE…"
$SSH "TMPD=$TMPD SALE=$SALE D=$D bash -s" <<'EOF'
set -e
SUDO=""; [ "$(id -u)" -ne 0 ] && SUDO="sudo"
$SUDO mkdir -p "$D"
$SUDO cp "$TMPD"/sale-reader.js "$TMPD"/package.json "$TMPD"/package-lock.json "$D/"
[ -f "$D/.env" ] || $SUDO cp "$TMPD/.env" "$D/"
rm -rf "$TMPD"
$SUDO chown -R tdlbot:tdlbot "$D" && $SUDO chmod 600 "$D/.env"
cd "$D" && $SUDO -u tdlbot npm ci --omit=dev --no-audit --no-fund >/dev/null 2>&1 || (cd "$D" && $SUDO npm ci --omit=dev --no-audit --no-fund >/dev/null && $SUDO chown -R tdlbot:tdlbot "$D")
$SUDO tee /etc/systemd/system/tdl-zalo-sale-$SALE.service >/dev/null <<UNIT
[Unit]
Description=Nguoi doc Zalo cua sale ($SALE)
After=network-online.target
Wants=network-online.target
[Service]
User=tdlbot
WorkingDirectory=$D
ExecStart=$(command -v node) $D/sale-reader.js
Restart=always
RestartSec=60
Environment=TZ=Asia/Ho_Chi_Minh
MemoryMax=300M
[Install]
WantedBy=multi-user.target
UNIT
$SUDO systemctl daemon-reload
EOF

# Lần đầu: chưa có phiên đăng nhập → quét mã QR bằng Zalo của sale
if ! $SSH "test -f $D/creds.$SALE.json"; then
  echo "📲 Lần đầu: cần quét mã QR bằng Zalo của sale $NAME."
  $SSH "cd $D && sudo -u tdlbot timeout 150 node sale-reader.js --dang-nhap >/tmp/zs-$SALE.log 2>&1 &" || true
  sleep 8
  $SSH "test -f $D/qr.$SALE.png" && { scp -q "$H:$D/qr.$SALE.png" "/tmp/qr.$SALE.png" && (command -v open >/dev/null && open "/tmp/qr.$SALE.png" || echo "Mở /tmp/qr.$SALE.png để quét"); } || echo "⚠️ Chưa thấy mã QR, xem log: ssh $H cat /tmp/zs-$SALE.log"
  echo "👉 Quét mã QR bằng Zalo của sale $NAME, bấm Đăng nhập. Xong rồi Enter để bật dịch vụ…"; read -r _
fi

$SSH "sudo systemctl enable tdl-zalo-sale-$SALE >/dev/null 2>&1; sudo systemctl restart tdl-zalo-sale-$SALE; sleep 10; sudo journalctl -u tdl-zalo-sale-$SALE -n 10 --no-pager -o cat"
echo
echo "✅ Xong. Người đọc Zalo của $NAME chạy 24/7 (chỉ đọc)."
echo "Nhật ký: ssh $H journalctl -u tdl-zalo-sale-$SALE -f   ·   Khởi động lại: ssh $H systemctl restart tdl-zalo-sale-$SALE"
echo "Zalo bắt đăng nhập lại: ssh $H 'cd $D && sudo -u tdlbot node sale-reader.js --dang-nhap' rồi chép qr.$SALE.png về máy quét."
echo "Tắt theo dõi sale này: ssh $H systemctl disable --now tdl-zalo-sale-$SALE"
