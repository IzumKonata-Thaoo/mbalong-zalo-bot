#!/usr/bin/env bash
# Public web bằng Tailscale Funnel, giữ app chỉ bind vào 127.0.0.1.
set -Eeuo pipefail

BOT_DIR="${BOT_DIR:-$HOME/zl}"
BOT_SCREEN_NAME="${BOT_SCREEN_NAME:-${SCREEN_NAME:-mbalong}}"
ENV_FILE="$BOT_DIR/.env"

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
stop_bot() {
  screen -S "$BOT_SCREEN_NAME" -X stuff $'\003' >/dev/null 2>&1 || true
  sleep 1
  screen -S "$BOT_SCREEN_NAME" -X quit >/dev/null 2>&1 || true
}
start_bot() {
  local command_line
  printf -v command_line "cd %q && exec npm start >> %q 2>&1" "$BOT_DIR" "$BOT_DIR/logs/bot.log"
  screen -dmS "$BOT_SCREEN_NAME" bash -lc "$command_line"
}

SUDO=""
if [[ $EUID -ne 0 ]]; then
  command -v sudo >/dev/null 2>&1 || die "cần sudo để cấu hình Tailscale Funnel"
  SUDO="sudo"
fi
for command_name in tailscale screen curl awk; do
  command -v "$command_name" >/dev/null 2>&1 || die "thiếu $command_name"
done
[[ -f "$ENV_FILE" ]] || die "không thấy $ENV_FILE"
mkdir -p "$BOT_DIR/logs"

PORT="$(env_value PORT)"
PORT="${PORT:-8787}"
[[ "$PORT" =~ ^[0-9]+$ ]] || die "PORT trong .env không hợp lệ"
LOCAL_ORIGIN="http://127.0.0.1:$PORT"

say "Kiểm tra web nội bộ và trạng thái Tailscale"
curl -fsS --max-time 8 "$LOCAL_ORIGIN/api/health" >/dev/null \
  || die "bot chưa trả lời ở $LOCAL_ORIGIN; xem $BOT_DIR/logs/bot.log"
$SUDO tailscale status >/dev/null 2>&1 \
  || die "VPS chưa đăng nhập Tailscale; chạy 'sudo tailscale up' một lần rồi chạy lại"
TAILSCALE_IP="$($SUDO tailscale ip -4 | head -n 1 | tr -d '\r')"
[[ "$TAILSCALE_IP" =~ ^100\.(6[4-9]|[7-9][0-9]|1[01][0-9]|12[0-7])\.[0-9]{1,3}\.[0-9]{1,3}$ ]] \
  || die "không đọc được IPv4 Tailscale hợp lệ"

say "Bật Tailscale Funnel công khai"
FUNNEL_OUTPUT="$($SUDO tailscale funnel --bg --yes "$LOCAL_ORIGIN" 2>&1)" || {
  printf '%s\n' "$FUNNEL_OUTPUT" >&2
  die "không bật được Funnel; hãy mở URL cấp quyền trong thông báo Tailscale rồi chạy lại"
}
FUNNEL_STATUS="$($SUDO tailscale funnel status 2>&1)"
PUBLIC_URL="$(printf '%s\n%s\n' "$FUNNEL_OUTPUT" "$FUNNEL_STATUS" \
  | grep -Eo 'https://[A-Za-z0-9._-]+\.ts\.net' | head -n 1 || true)"
[[ -n "$PUBLIC_URL" ]] || {
  printf '%s\n' "$FUNNEL_STATUS" >&2
  die "Funnel đã chạy nhưng không đọc được URL *.ts.net"
}

say "Cập nhật PUBLIC_ORIGIN và khởi động lại bot"
set_env_value HOST "127.0.0.1"
set_env_value PUBLIC_ORIGIN "$PUBLIC_URL"
set_env_value TAILSCALE_LISTEN_IP "$TAILSCALE_IP"
if command -v ufw >/dev/null 2>&1 && $SUDO ufw status 2>/dev/null | grep -q '^Status: active'; then
  $SUDO ufw allow in on tailscale0 to any port "$PORT" proto tcp comment 'MbaLong Tailscale panel' >/dev/null
fi
stop_bot
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
  || die "Funnel đã bật nhưng URL công khai chưa phản hồi: $PUBLIC_URL"

cat <<EOF

✓ Web công khai: $PUBLIC_URL
✓ Panel nội bộ:  http://$TAILSCALE_IP:$PORT
✓ Bot screen:    $BOT_SCREEN_NAME
✓ Funnel tự chạy lại cùng dịch vụ Tailscale sau khi reboot.

Kiểm tra Funnel: sudo tailscale funnel status
Xem log bot:     tail -f $BOT_DIR/logs/bot.log
Kiểm tra web:    BOT_DIR=$BOT_DIR bash $BOT_DIR/deploy/diagnose-web.sh
EOF
