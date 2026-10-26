#!/bin/bash
# Cài / cập nhật trợ lý Zalo An Lành trên máy Mac. Chạy trong Terminal:  bash zalo-bot/cai-dat.sh
# Lần đầu: tạo mã bí mật (ghi vào máy chủ api), cài thư viện, mở mã QR để quét bằng Zalo "Trợ lý An Lành", rồi cho chạy nền (tự bật lại khi khởi động máy / bị tắt).
# Lần sau (cập nhật code): chạy lại lệnh này, giữ nguyên mã bí mật và phiên đăng nhập.
# Chương trình được chép ra ~/.tdl-zalo-bot (ngoài thư mục Documents, vì macOS chặn chương trình chạy nền đọc Documents).
set -e
SRC="$(cd "$(dirname "$0")" && pwd)"
DST="$HOME/.tdl-zalo-bot"
NODE="$(command -v node || true)"
[ -z "$NODE" ] && { echo "❌ Máy chưa có Node.js. Cài bản LTS ở https://nodejs.org rồi chạy lại."; exit 1; }
mkdir -p "$DST" && chmod 700 "$DST"
cp "$SRC/bot.js" "$SRC/package.json" "$SRC/package-lock.json" "$DST/"
cd "$DST"

if [ ! -f .env ]; then
  KEY="$(openssl rand -hex 24)"
  printf "API_URL=https://api.thucduonglanh.vn/\nZBOT_KEY=%s\n" "$KEY" > .env && chmod 600 .env
  echo "🔑 Ghi mã bí mật ZBOT_KEY vào máy chủ api (Cloudflare)…"
  (cd "$SRC/../api" && printf "%s" "$KEY" | npx -y wrangler secret put ZBOT_KEY) || { rm -f .env; echo "❌ Chưa ghi được mã vào Cloudflare (cần đăng nhập: npx wrangler login). Chạy lại sau."; exit 1; }
fi

echo "📦 Cài thư viện…"
npm ci --omit=dev --no-audit --no-fund >/dev/null

if [ ! -f creds.json ]; then
  echo "📱 Sắp mở mã QR. Trên điện thoại có Zalo \"Trợ lý An Lành\": Zalo → biểu tượng QR (góc trên) → quét → Đăng nhập."
  "$NODE" bot.js --dang-nhap
fi

PL="$HOME/Library/LaunchAgents/vn.thucduonglanh.zalobot.plist"
mkdir -p "$HOME/Library/LaunchAgents"
cat > "$PL" <<EOF
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
  <key>Label</key><string>vn.thucduonglanh.zalobot</string>
  <key>ProgramArguments</key><array><string>$NODE</string><string>$DST/bot.js</string></array>
  <key>WorkingDirectory</key><string>$DST</string>
  <key>RunAtLoad</key><true/>
  <key>KeepAlive</key><true/>
  <key>ThrottleInterval</key><integer>60</integer>
  <key>StandardOutPath</key><string>$DST/bot.log</string>
  <key>StandardErrorPath</key><string>$DST/bot.log</string>
</dict></plist>
EOF
launchctl bootout "gui/$(id -u)" "$PL" 2>/dev/null || true
launchctl bootstrap "gui/$(id -u)" "$PL"
sleep 8
echo "✅ Trợ lý đang chạy nền. 10 dòng nhật ký gần nhất:"
tail -n 10 "$DST/bot.log" || true
echo
echo "Xem tiếp nhật ký: tail -f ~/.tdl-zalo-bot/bot.log   ·   Tắt hẳn: launchctl bootout gui/\$(id -u) $PL"
