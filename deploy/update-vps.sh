#!/usr/bin/env bash
# Cập nhật MbaLong trên VPS Ubuntu, chạy bằng screen.
# Giữ nguyên .env, data/ (session Zalo, database SQLite, ví), chỉ thay mã nguồn.
#
#   curl -fsSL https://raw.githubusercontent.com/IzumKonata-Thaoo/mbalong-zalo-bot/main/deploy/update-vps.sh | bash
#
# Tuỳ chọn: BOT_DIR=~/zl SCREEN_NAME=mbalong BRANCH=main TUNNEL_MODE=tailscale
set -Eeuo pipefail

REPO_URL="${REPO_URL:-https://github.com/IzumKonata-Thaoo/mbalong-zalo-bot.git}"
BRANCH="${BRANCH:-main}"
BOT_DIR="${BOT_DIR:-$HOME/zl}"
SCREEN_NAME="${SCREEN_NAME:-zl}"
TUNNEL_MODE="${TUNNEL_MODE:-none}"

say() { printf '\n\033[1;36m==> %s\033[0m\n' "$*"; }
die() { printf '\n\033[1;31mLỗi: %s\033[0m\n' "$*" >&2; exit 1; }

SUDO=""
if [[ $EUID -ne 0 ]]; then
  command -v sudo >/dev/null 2>&1 && SUDO="sudo" || SUDO=""
fi

need_apt=()
for pkg in git screen rsync curl ffmpeg; do
  command -v "$pkg" >/dev/null 2>&1 || need_apt+=("$pkg")
done
command -v make >/dev/null 2>&1 && command -v g++ >/dev/null 2>&1 || need_apt+=(build-essential)
command -v python3 >/dev/null 2>&1 || need_apt+=(python3)
if ((${#need_apt[@]})); then
  say "Cài gói hệ thống: ${need_apt[*]}"
  $SUDO apt-get update -y
  $SUDO apt-get install -y "${need_apt[@]}"
fi

node_major() { node -p 'Number(process.versions.node.split(".")[0])' 2>/dev/null || echo 0; }
if ! command -v node >/dev/null 2>&1 || (( $(node_major) < 22 )); then
  say "Cài Node.js 22"
  $SUDO apt-get update -y
  $SUDO apt-get install -y ca-certificates curl gnupg
  curl -fsSL https://deb.nodesource.com/gpgkey/nodesource-repo.gpg.key \
    | gpg --dearmor \
    | $SUDO tee /usr/share/keyrings/nodesource.gpg >/dev/null
  echo "deb [signed-by=/usr/share/keyrings/nodesource.gpg] https://deb.nodesource.com/node_22.x nodistro main" \
    | $SUDO tee /etc/apt/sources.list.d/nodesource.list >/dev/null
  $SUDO apt-get update -y
  $SUDO apt-get install -y nodejs
fi

if ! command -v yt-dlp >/dev/null 2>&1; then
  say "Cài yt-dlp"
  $SUDO curl -fsSL https://github.com/yt-dlp/yt-dlp/releases/latest/download/yt-dlp -o /usr/local/bin/yt-dlp
  $SUDO chmod a+rx /usr/local/bin/yt-dlp
else
  $SUDO yt-dlp -U >/dev/null 2>&1 || true
fi

if [[ "$TUNNEL_MODE" == "tailscale" ]] && ! command -v tailscale >/dev/null 2>&1; then
  say "Cài Tailscale"
  curl -fsSL https://tailscale.com/install.sh | $SUDO sh
fi

if [[ "$TUNNEL_MODE" == "quick" ]] && ! command -v cloudflared >/dev/null 2>&1; then
  say "Cài Cloudflare Tunnel"
  $SUDO install -d -m 0755 /usr/share/keyrings
  curl -fsSL https://pkg.cloudflare.com/cloudflare-main.gpg \
    | $SUDO tee /usr/share/keyrings/cloudflare-main.gpg >/dev/null
  echo "deb [signed-by=/usr/share/keyrings/cloudflare-main.gpg] https://pkg.cloudflare.com/cloudflared any main" \
    | $SUDO tee /etc/apt/sources.list.d/cloudflared.list >/dev/null
  $SUDO apt-get update -y
  $SUDO apt-get install -y cloudflared
fi

mkdir -p "$BOT_DIR"
BOT_DIR="$(cd "$BOT_DIR" && pwd)"

say "Sao lưu .env và data/ trong $BOT_DIR"
STAMP="$(date +%Y%m%d-%H%M%S)"
BACKUP="$HOME/zl-backup-$STAMP.tar.gz"
backup_items=()
for item in .env data; do [[ -e "$BOT_DIR/$item" ]] && backup_items+=("$item"); done
if ((${#backup_items[@]})); then
  tar -czf "$BACKUP" -C "$BOT_DIR" "${backup_items[@]}"
  chmod 600 "$BACKUP"
  echo "Đã sao lưu: $BACKUP"
else
  echo "Chưa có .env/data — cài mới."
fi

say "Tải mã nguồn mới ($BRANCH)"
TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT
git clone --depth 1 --branch "$BRANCH" "$REPO_URL" "$TMP/src"
rm -rf "$TMP/src/.git"

say "Dừng bot cũ"
if screen -ls 2>/dev/null | grep -qE "[0-9]+\.${SCREEN_NAME}[[:space:]]"; then
  screen -S "$SCREEN_NAME" -X stuff $'\003' || true
  sleep 3
  screen -S "$SCREEN_NAME" -X quit || true
fi
for pid in $(pgrep -f "node .*dist/server/index.js" || true); do
  if [[ "$(readlink -f "/proc/$pid/cwd" 2>/dev/null)" == "$BOT_DIR" ]]; then
    kill "$pid" 2>/dev/null || true
  fi
done
sleep 2
for pid in $(pgrep -f "node .*dist/server/index.js" || true); do
  [[ "$(readlink -f "/proc/$pid/cwd" 2>/dev/null)" == "$BOT_DIR" ]] && kill -9 "$pid" 2>/dev/null || true
done

say "Thay mã nguồn (giữ .env, data/, logs/)"
rm -rf "$BOT_DIR/dist" "$BOT_DIR/src" "$BOT_DIR/web"
rsync -a \
  --exclude '.env' --exclude 'data/' --exclude 'logs/' --exclude 'node_modules/' \
  "$TMP/src/" "$BOT_DIR/"

cd "$BOT_DIR"
mkdir -p data logs
chmod 700 data
say "Cài dependencies và build"
bash setup.sh

say "Khởi động bot trong screen '$SCREEN_NAME'"
screen -dmS "$SCREEN_NAME" bash -lc "cd '$BOT_DIR' && npm start 2>&1 | tee -a logs/bot.log"
sleep 6
if screen -ls | grep -qE "[0-9]+\.${SCREEN_NAME}[[:space:]]"; then
  echo "Bot đang chạy. Xem: screen -r $SCREEN_NAME  (thoát: Ctrl+A rồi D)"
  echo "Log: tail -f $BOT_DIR/logs/bot.log"
  tail -n 20 logs/bot.log 2>/dev/null || true
else
  die "screen '$SCREEN_NAME' không chạy. Kiểm tra: cd $BOT_DIR && npm start"
fi
if [[ "$TUNNEL_MODE" == "tailscale" ]]; then
  BOT_DIR="$BOT_DIR" BOT_SCREEN_NAME="$SCREEN_NAME" \
    bash "$BOT_DIR/deploy/start-tailscale-funnel.sh"
elif [[ "$TUNNEL_MODE" == "quick" ]]; then
  BOT_DIR="$BOT_DIR" BOT_SCREEN_NAME="$SCREEN_NAME" TUNNEL_SCREEN_NAME="${SCREEN_NAME}-tunnel" \
    bash "$BOT_DIR/deploy/start-quick-tunnel.sh"
elif [[ "$TUNNEL_MODE" != "none" ]]; then
  die "TUNNEL_MODE chỉ nhận: none, tailscale hoặc quick"
fi
if [[ -f "$BACKUP" ]]; then
  echo "Khôi phục nếu cần: tar -xzf $BACKUP -C $BOT_DIR"
fi
