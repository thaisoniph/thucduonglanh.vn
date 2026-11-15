#!/bin/bash
# 📣 Cài "Lành nhận việc từ CRM" lên máy Mac (Phòng Marketing AI, 16/11/2026). Chạy 1 lần:  bash scripts/cai-lanh-nhan-viec.sh
# - chép scripts/lanh-nhan-viec.py → ~/.claude/scripts/ (launchd không đọc được thư mục Documents)
# - tạo khoá cổng (nếu chưa có) ở Keychain "tdl-pm-agent" và đặt cùng khoá cho máy chủ: wrangler secret put PM_AGENT_KEY
# - bật lịch 5 phút / lần (launchd vn.thucduonglanh.lanh-nhan-viec), nhật ký ~/Library/Logs/lanh-nhan-viec.log
# Gỡ: launchctl bootout gui/$(id -u)/vn.thucduonglanh.lanh-nhan-viec
set -e
cd "$(dirname "$0")/.."
mkdir -p ~/.claude/scripts ~/Library/LaunchAgents ~/Library/Logs
cp scripts/lanh-nhan-viec.py ~/.claude/scripts/lanh-nhan-viec.py
if ! security find-generic-password -s tdl-pm-agent -w >/dev/null 2>&1; then
  K=$(openssl rand -hex 24)
  security add-generic-password -s tdl-pm-agent -a tdl -w "$K"
  echo "Đặt khoá cho máy chủ…"
  (cd api && printf '%s' "$K" | npx wrangler secret put PM_AGENT_KEY)
fi
L=vn.thucduonglanh.lanh-nhan-viec; P=~/Library/LaunchAgents/$L.plist
cat > "$P" <<EOF
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
  <key>Label</key><string>$L</string>
  <key>ProgramArguments</key><array><string>/usr/bin/python3</string><string>$HOME/.claude/scripts/lanh-nhan-viec.py</string></array>
  <key>StartInterval</key><integer>300</integer>
  <key>RunAtLoad</key><true/>
  <key>EnvironmentVariables</key><dict><key>PATH</key><string>$HOME/.local/bin:/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin</string><key>LANG</key><string>en_US.UTF-8</string></dict>
  <key>StandardOutPath</key><string>$HOME/Library/Logs/lanh-nhan-viec.log</string>
  <key>StandardErrorPath</key><string>$HOME/Library/Logs/lanh-nhan-viec.log</string>
</dict></plist>
EOF
launchctl bootout gui/$(id -u)/$L 2>/dev/null || true
launchctl bootstrap gui/$(id -u) "$P"
echo "✅ Đã bật. Thử kết nối:"; /usr/bin/python3 ~/.claude/scripts/lanh-nhan-viec.py --test || true
