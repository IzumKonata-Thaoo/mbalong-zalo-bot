#!/usr/bin/env bash
# Tạo Cloudflare Quick Tunnel, cập nhật PUBLIC_ORIGIN và chạy lại bot bằng screen.
set -Eeuo pipefail

BOT_DIR="${BOT_DIR:-$HOME/zl}"
BOT_SCREEN_NAME="${BOT_SCREEN_NAME:-${SCREEN_NAME:-mbalong}}"
TUNNEL_SCREEN_NAME="${TUNNEL_SCREEN_NAME:-${BOT_SCREEN_NAME}-tunnel}"
ENV_FILE="$BOT_DIR/.env"
TUNNEL_LOG="$BOT_DIR/logs/tunnel.log"

say() { printf '\n\033[1;36m==> %s\033[0m\n' "$*"; }
die() { printf '\n\033[1;31mLỗi: %s\033[0m\n' "$*" >&2; exit 1; }
env_value() {
  local key="$1"
  sed -n "s/^${key}=//p" "$ENV_FILE" | tail -n 1 | tr -d '\r'
}
set_env_value() {
  local key="$1" value="$2" temp
  temp="$(mktemp "$BOT_DIR/.env.XXXXXX")"
  awk -v key="$key" -v value="$value" '
    BEGIN { found = 0 }
    $0 ~ "^" key "=" { print key "=" value; found = 1; next }
    { print }
    END { if (!found) print key "=" value }
  ' "$ENV_FILE" >"$temp"
  chmod 600 "$temp"
  mv -f "$temp" "$ENV_FILE"
}
screen_running() {
  screen -ls 2>/dev/null | grep -Fq ".${1}"$'\t'
}
stop_screen() {
  local name="$1"
  screen -S "$name" -X stuff $'\003' >/dev/null 2>&1 || true
  sleep 1
  screen -S "$name" -X quit >/dev/null 2>&1 || true
}
start_bot() {
  local command_line
  printf -v command_line "cd %q && exec npm start >> %q 2>&1" "$BOT_DIR" "$BOT_DIR/logs/bot.log"
  screen -dmS "$BOT_SCREEN_NAME" bash -lc "$command_line"
}

for command_name in cloudflared screen curl awk; do
  command -v "$command_name" >/dev/null 2>&1 || die "thiếu $command_name"
done
[[ -f "$ENV_FILE" ]] || die "không thấy $ENV_FILE"
mkdir -p "$BOT_DIR/logs"

PORT="$(env_value PORT)"
PORT="${PORT:-8787}"
[[ "$PORT" =~ ^[0-9]+$ ]] || die "PORT trong .env không hợp lệ"
LOCAL_ORIGIN="http://127.0.0.1:$PORT"

say "Kiểm tra web nội bộ"
for _ in {1..30}; do
  curl -fsS --max-time 3 "$LOCAL_ORIGIN/api/health" >/dev/null 2>&1 && break
  sleep 1
done
curl -fsS --max-time 5 "$LOCAL_ORIGIN/api/health" >/dev/null \
  || die "bot chưa trả lời ở $LOCAL_ORIGIN; xem $BOT_DIR/logs/bot.log"

say "Mở Cloudflare Quick Tunnel"
stop_screen "$TUNNEL_SCREEN_NAME"
: >"$TUNNEL_LOG"
chmod 600 "$TUNNEL_LOG"
printf -v tunnel_command "exec cloudflared tunnel --config /dev/null --no-autoupdate --url %q >> %q 2>&1" \
  "$LOCAL_ORIGIN" "$TUNNEL_LOG"
screen -dmS "$TUNNEL_SCREEN_NAME" bash -lc "$tunnel_command"

PUBLIC_URL=""
for _ in {1..45}; do
  PUBLIC_URL="$(grep -Eo 'https://[a-z0-9-]+\.trycloudflare\.com' "$TUNNEL_LOG" | tail -n 1 || true)"
  [[ -n "$PUBLIC_URL" ]] && break
  screen_running "$TUNNEL_SCREEN_NAME" || {
    tail -n 30 "$TUNNEL_LOG" >&2 || true
    die "cloudflared đã dừng trước khi tạo được URL"
  }
  sleep 1
done
[[ -n "$PUBLIC_URL" ]] || {
  tail -n 30 "$TUNNEL_LOG" >&2 || true
  die "quá thời gian chờ URL trycloudflare.com"
}

say "Cập nhật địa chỉ web và khởi động lại bot"
set_env_value HOST "127.0.0.1"
set_env_value PUBLIC_ORIGIN "$PUBLIC_URL"
stop_screen "$BOT_SCREEN_NAME"
start_bot

for _ in {1..30}; do
  curl -fsS --max-time 3 "$LOCAL_ORIGIN/api/health" >/dev/null 2>&1 && break
  sleep 1
done
curl -fsS --max-time 5 "$LOCAL_ORIGIN/api/health" >/dev/null \
  || die "bot không chạy lại được; xem $BOT_DIR/logs/bot.log"

for _ in {1..45}; do
  curl -fsS --max-time 8 "$PUBLIC_URL/api/health" >/dev/null 2>&1 && break
  sleep 1
done
curl -fsS --max-time 12 "$PUBLIC_URL/api/health" >/dev/null \
  || die "tunnel có URL nhưng chưa truy cập công khai được; xem $TUNNEL_LOG"

cat <<EOF

✓ Web công khai: $PUBLIC_URL
✓ Bot screen:     $BOT_SCREEN_NAME
✓ Tunnel screen:  $TUNNEL_SCREEN_NAME

Xem log bot:      tail -f $BOT_DIR/logs/bot.log
Xem log tunnel:   tail -f $TUNNEL_LOG
Kiểm tra lại:     BOT_DIR=$BOT_DIR bash $BOT_DIR/deploy/diagnose-web.sh

URL Quick Tunnel sẽ đổi nếu tunnel bị dừng hoặc VPS khởi động lại.
Chạy lại script này để bot tự nhận URL mới.
EOF
