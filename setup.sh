#!/usr/bin/env bash
set -Eeuo pipefail

cd -- "$(dirname -- "${BASH_SOURCE[0]}")"

for command_name in node npm openssl; do
  if ! command -v "$command_name" >/dev/null 2>&1; then
    echo "Thiếu $command_name. Hãy cài Node.js 22+, npm và openssl trước." >&2
    exit 1
  fi
done

node_major="$(node -p 'Number(process.versions.node.split(".")[0])')"
if (( node_major < 22 )); then
  echo "Cần Node.js 22 trở lên. Phiên bản hiện tại: $(node --version)" >&2
  exit 1
fi

for media_command in ffmpeg yt-dlp; do
  if ! command -v "$media_command" >/dev/null 2>&1; then
    echo "Cảnh báo: chưa có $media_command; tính năng gửi nhạc SoundCloud sẽ chưa hoạt động." >&2
  fi
done

mkdir -p data
chmod 700 data

if [[ ! -f .env ]]; then
  admin_password="$(openssl rand -base64 24 | tr -d '\n')"
  jwt_secret="$(openssl rand -base64 48 | tr -d '\n')"
  mbalong_public_origin="${MBALONG_PUBLIC_ORIGIN:-${NOVA_PUBLIC_ORIGIN:-http://localhost:8787}}"
  umask 077
  cat > .env <<EOF
PORT=8787
HOST=127.0.0.1
ADMIN_PASSWORD=${admin_password}
JWT_SECRET=${jwt_secret}
ZALO_ADMIN_IDS=
SEARCH_API_URL=https://api.tavily.com/search
SEARCH_API_KEY=
YTDLP_PATH=yt-dlp
FFMPEG_PATH=ffmpeg
DATABASE_PATH=./data/bot.db
SESSION_PATH=./data/zalo-session.json
PUBLIC_ORIGIN=${mbalong_public_origin}
BOT_NAME=MbaLong
EOF
  chmod 600 .env
  echo
  echo "Đã tạo .env. Mật khẩu web admin: ${admin_password}"
  echo "Hãy lưu mật khẩu này ở nơi an toàn. API AI sẽ được nhập trong web admin."
else
  echo ".env đã tồn tại; không ghi đè."
fi

echo "Đang cài dependencies…"
npm install --no-audit --no-fund
npm run build

echo
echo "Cài đặt hoàn tất."
echo "1. Chạy lần đầu trong terminal: npm start"
echo "2. Quét QR Zalo."
configured_public_origin="$(grep -E '^PUBLIC_ORIGIN=' .env | tail -n 1 | cut -d= -f2-)"
echo "3. Mở web: ${configured_public_origin:-http://localhost:8787}"
echo "4. Vào Cấu hình để nhập Base URL, Model và API key."
