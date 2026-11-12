#!/usr/bin/env bash
set -Eeuo pipefail

BOT_DIR="${BOT_DIR:-$HOME/zl}"
ENV_FILE="${ENV_FILE:-$BOT_DIR/.env}"

die() { printf 'Lỗi: %s\n' "$*" >&2; exit 1; }
env_value() {
  local key="$1"
  sed -n "s/^${key}=//p" "$ENV_FILE" | tail -n 1 | tr -d '\r'
}

[[ -f "$ENV_FILE" ]] || die "không thấy $ENV_FILE"
PORT="$(env_value PORT)"
PORT="${PORT:-8787}"
[[ "$PORT" =~ ^[0-9]+$ ]] || die "PORT trong .env không hợp lệ"
HOST="$(env_value HOST)"
HOST="${HOST:-127.0.0.1}"
PUBLIC_ORIGIN="$(env_value PUBLIC_ORIGIN)"
TAILSCALE_LISTEN_IP="$(env_value TAILSCALE_LISTEN_IP)"
LOCAL_ORIGIN="http://127.0.0.1:$PORT"

printf 'HOST=%s\nPUBLIC_ORIGIN=%s\n' "$HOST" "${PUBLIC_ORIGIN:-chưa cấu hình}"
curl -fsS --max-time 8 "$LOCAL_ORIGIN/api/health" >/dev/null \
  || die "bot chưa trả lời ở $LOCAL_ORIGIN; kiểm tra screen và logs/bot.log"
echo "✓ Web nội bộ hoạt động"

[[ -n "$PUBLIC_ORIGIN" ]] || die "PUBLIC_ORIGIN đang trống"
case "$PUBLIC_ORIGIN" in
  http://localhost:*|http://127.0.0.1:*|https://localhost:*|https://127.0.0.1:*)
    die "PUBLIC_ORIGIN chỉ là địa chỉ nội bộ; hãy chạy deploy/start-quick-tunnel.sh"
    ;;
esac

curl -fsS --max-time 20 "${PUBLIC_ORIGIN%/}/api/health" >/dev/null \
  || die "URL công khai chưa vào được: $PUBLIC_ORIGIN"
printf '✓ Web công khai hoạt động: %s\n' "$PUBLIC_ORIGIN"
if [[ -n "$TAILSCALE_LISTEN_IP" ]]; then
  TAILSCALE_ORIGIN="http://$TAILSCALE_LISTEN_IP:$PORT"
  curl -fsS --max-time 8 "$TAILSCALE_ORIGIN/api/health" >/dev/null \
    || die "listener Tailscale chưa hoạt động: $TAILSCALE_ORIGIN"
  printf '✓ Panel Tailscale hoạt động: %s\n' "$TAILSCALE_ORIGIN"
fi
