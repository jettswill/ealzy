#!/usr/bin/env bash
# Выкладка Ealzy из CI (GitHub Actions). Тот же порядок, что в локальном deploy.sh:
# rsync исходников -> .env, nginx, wireguard -> сборка и запуск на сервере -> Telegram.
#
# Ждёт в окружении:
#   DEPLOY_HOST          адрес сервера
#   DEPLOY_USER          пользователь (по умолчанию root)
#   DEPLOY_PORT          порт SSH (по умолчанию 22)
#   DEPLOY_SSH_KEY       приватный ключ деплоя
#   DEPLOY_KNOWN_HOSTS   строка(и) known_hosts сервера; пусто — ключ хоста принимается при первом входе
#   ENV_PRODUCTION       содержимое .env.production
#   WG0_CONF             содержимое deploy/wireguard/wg0.conf
set -euo pipefail

: "${DEPLOY_HOST:?DEPLOY_HOST is required}"
: "${DEPLOY_SSH_KEY:?DEPLOY_SSH_KEY is required}"
: "${ENV_PRODUCTION:?ENV_PRODUCTION is required}"
: "${WG0_CONF:?WG0_CONF is required}"
DEPLOY_USER="${DEPLOY_USER:-root}"
DEPLOY_PORT="${DEPLOY_PORT:-22}"
DOMAIN="${DEPLOY_DOMAIN:-ealzy.ru}"
DEST_DIR="${DEPLOY_DEST_DIR:-/root/ealzy-app}"
OLD_DIR="${DEPLOY_OLD_DIR:-/root/ealzy}"
APP_DIR="$(cd "$(dirname "$0")/.." && pwd)"
SERVER="$DEPLOY_USER@$DEPLOY_HOST"

WORK="$(mktemp -d)"
trap 'rm -rf "$WORK"' EXIT
umask 077
printf '%s\n' "$DEPLOY_SSH_KEY" > "$WORK/key"
printf '%s\n' "$ENV_PRODUCTION" > "$WORK/env"
printf '%s\n' "$WG0_CONF" > "$WORK/wg0.conf"
if [[ -n "${DEPLOY_KNOWN_HOSTS:-}" ]]; then
  printf '%s\n' "$DEPLOY_KNOWN_HOSTS" > "$WORK/known_hosts"
  HOST_CHECK=yes
else
  : > "$WORK/known_hosts"
  HOST_CHECK=accept-new
fi

SSH=(ssh -i "$WORK/key" -p "$DEPLOY_PORT" -o IdentitiesOnly=yes -o BatchMode=yes
  -o StrictHostKeyChecking="$HOST_CHECK" -o UserKnownHostsFile="$WORK/known_hosts"
  -o ServerAliveInterval=5 -o ConnectTimeout=20)
export RSYNC_RSH="${SSH[*]}"

retry() {
  local attempt=1 max=8 status=0
  while true; do
    set +e
    "$@"
    status=$?
    set -e
    (( status == 0 )) && return 0
    # Повторяем только сбои транспорта (ssh — 255, rsync — 12/30/35/255).
    case "$status" in 255|12|30|35) ;; *) return "$status" ;; esac
    if (( attempt >= max )); then
      echo "Failed after $max attempts (exit $status): $1" >&2
      return "$status"
    fi
    echo "Attempt $attempt failed (exit $status); retrying..." >&2
    attempt=$((attempt + 1))
    sleep 3
  done
}
upload() { retry "${SSH[@]}" "$SERVER" "umask 077; cat > $1" < "$2"; }

echo "Deploying Ealzy to $DOMAIN..."
retry rsync -az --delete \
  --exclude node_modules --exclude dist --exclude .git --exclude .github --exclude coverage \
  --exclude .env --exclude '.env.*' --exclude .turbo --exclude .cache \
  --exclude .DS_Store --exclude deploy/wireguard/wg0.conf \
  "$APP_DIR/" "$SERVER:$DEST_DIR/"

upload "$DEST_DIR/.env" "$WORK/env"
upload /tmp/nginx-ealzy.conf "$APP_DIR/deploy/nginx-ealzy.conf"
upload /tmp/ealzy-wg0.conf "$WORK/wg0.conf"

cat > "$WORK/remote.sh" <<'REMOTE_EOF'
set -euo pipefail

if ! command -v docker >/dev/null; then
  curl -fsSL https://get.docker.com -o get-docker.sh
  sh get-docker.sh
fi

if ! docker compose version >/dev/null 2>&1; then
  curl -L "https://github.com/docker/compose/releases/download/v2.24.5/docker-compose-$(uname -s)-$(uname -m)" -o /usr/local/bin/docker-compose
  chmod +x /usr/local/bin/docker-compose
fi

if ! command -v nginx >/dev/null; then
  apt-get update
  apt-get install -y nginx certbot python3-certbot-nginx curl
fi

echo "Bringing up WireGuard split-tunnel for Telegram..."
# Туннель нужен боту Telegram и почте, но не сайту. Если узел VPN не отвечает,
# выкладку не останавливаем: веб-пользователи не должны ждать починки VPN.
VPN_OK=1
if ! bash "$DEST_DIR/deploy/wireguard/setup.sh" /tmp/ealzy-wg0.conf; then
  VPN_OK=0
  sleep 20
  handshake="$(wg show wg0 latest-handshakes 2>/dev/null | awk 'NF{print $2; exit}')"
  if [[ -n "${handshake:-}" && "$handshake" != "0" ]]; then
    echo "::warning::WireGuard connected late; Telegram check failed once, continuing."
  else
    # Мёртвый туннель хуже выключенного: через него уходят и адреса Google,
    # то есть вход через Google и почта. Выключаем до следующей выкладки.
    echo "::warning::WireGuard has no handshake - VPN node is not answering. Stopping wg0; Telegram bot and mail sync stay down until the VPN is fixed and the deploy is re-run."
    systemctl stop wg-quick@wg0 || true
  fi
fi
rm -f /tmp/ealzy-wg0.conf

if [[ ! -f /swapfile ]]; then
  dd if=/dev/zero of=/swapfile bs=1M count=2048
  chmod 600 /swapfile
  mkswap /swapfile
  swapon /swapfile
  echo "/swapfile none swap sw 0 0" >> /etc/fstab
fi

if [[ -f "$OLD_DIR/docker-compose.yml" ]]; then
  echo "Stopping legacy Ealzy stack..."
  docker compose -f "$OLD_DIR/docker-compose.yml" --project-directory "$OLD_DIR" down || true
fi

echo "Pruning unused Docker build cache..."
docker builder prune -af >/dev/null
docker image prune -f >/dev/null

cd "$DEST_DIR"
echo "Building images..."
docker compose --profile tools build
echo "Starting database..."
docker compose up -d postgres
echo "Pausing app containers so role grants are not racing PostgREST..."
docker compose stop postgrest api web || true
echo "Applying migrations..."
if ! docker compose --profile tools run --rm --no-TTY --interactive=false migrate </dev/null; then
  # The app is paused at this point. A failed migration must not leave the site
  # down: bring the previous containers back (they still run the old images).
  echo "::error::Migrations failed - restarting the previous version."
  docker compose start postgrest api web || true
  exit 1
fi
echo "Starting application..."
docker compose up -d --force-recreate --remove-orphans

echo "Waiting for health checks..."
for _ in $(seq 1 45); do
  if curl -fsS http://127.0.0.1:3001/health >/dev/null && curl -fsS http://127.0.0.1:8080/healthz >/dev/null; then
    break
  fi
  sleep 2
done
curl -fsS http://127.0.0.1:3001/health
echo
curl -fsS http://127.0.0.1:8080/healthz
echo

echo "Checking Telegram API from api container..."
# With TELEGRAM_API_BASE_URL the bot talks to Telegram through an HTTPS proxy and
# does not need the VPN; check the address the app will really use.
TG_BASE="$(grep -E '^TELEGRAM_API_BASE_URL=' .env | cut -d= -f2- || true)"
TG_ORIGIN="$(printf '%s' "${TG_BASE:-https://api.telegram.org}" | sed -E 's#^(https?://[^/]+).*#\1#')"
if docker exec ealzy-app-api-1 wget -q -O /dev/null -T 15 "$TG_ORIGIN"; then
  echo "Telegram API reachable from api container."
else
  status=$?
  if [[ "$status" -eq 8 ]]; then
    echo "Telegram API reachable from api container (HTTP error is expected without a bot method)."
  elif [[ "$VPN_OK" == "0" ]]; then
    echo "::warning::Telegram API unreachable from api container (wget exit $status) - expected while the VPN is down."
  else
    echo "Telegram API still unreachable from api container (wget exit $status)." >&2
    exit 1
  fi
fi

if [[ -f /etc/nginx/sites-available/ealzy ]]; then
  cp /etc/nginx/sites-available/ealzy "/root/ealzy-nginx.bak.$(date +%Y%m%d%H%M%S)"
fi
cp /tmp/nginx-ealzy.conf /etc/nginx/sites-available/ealzy
ln -sf /etc/nginx/sites-available/ealzy /etc/nginx/sites-enabled/ealzy
rm -f /etc/nginx/sites-enabled/default
nginx -t
systemctl reload nginx

CRON_SECRET="$(grep -E '^CRON_SECRET=' .env | cut -d= -f2-)"
{
  echo "*/10 * * * * curl -fsS -X POST -H \"x-cron-secret: ${CRON_SECRET}\" http://127.0.0.1:3001/internal/scheduled-messages >/dev/null 2>&1 # ealzy"
  echo "15 * * * * curl -fsS -X POST -H \"x-cron-secret: ${CRON_SECRET}\" http://127.0.0.1:3001/internal/experience-follow-ups >/dev/null 2>&1 # ealzy"
  echo "*/2 * * * * curl -fsS -X POST -H \"x-cron-secret: ${CRON_SECRET}\" http://127.0.0.1:3001/internal/ai-work >/dev/null 2>&1 # ealzy"
  echo "*/15 * * * * curl -fsS -X POST -H \"x-cron-secret: ${CRON_SECRET}\" http://127.0.0.1:3001/internal/mail-sync >/dev/null 2>&1 # ealzy"
  echo "7 * * * * /etc/wireguard/mail-routes.sh wg0 >/dev/null 2>&1 # ealzy-mail-routes"
} | crontab -

echo "Deployment completed."
REMOTE_EOF

echo "Building and switching production..."
upload /tmp/ealzy-remote-deploy.sh "$WORK/remote.sh"
retry "${SSH[@]}" "$SERVER" "DEST_DIR=$DEST_DIR OLD_DIR=$OLD_DIR DOMAIN=$DOMAIN bash /tmp/ealzy-remote-deploy.sh"

echo "Switching Telegram bot to long polling and setting the menu button..."
env_value() { grep -E "^$1=" "$WORK/env" | head -1 | cut -d= -f2- | sed -e 's/^"//' -e 's/"$//' -e "s/^'//" -e "s/'$//"; }
BOT_TOKEN="$(env_value TELEGRAM_BOT_TOKEN)"
MINI_APP_URL="$(env_value TELEGRAM_MINI_APP_URL)"
curl -fsS -o /dev/null "https://api.telegram.org/bot${BOT_TOKEN}/deleteWebhook" \
  -H 'content-type: application/json' -d '{"drop_pending_updates":false}'
curl -fsS -o /dev/null "https://api.telegram.org/bot${BOT_TOKEN}/setChatMenuButton" \
  -H 'content-type: application/json' \
  -d "{\"menu_button\":{\"type\":\"web_app\",\"text\":\"Open Ealzy\",\"web_app\":{\"url\":\"${MINI_APP_URL}\"}}}"

echo "Deployment finished: https://${DOMAIN}"
