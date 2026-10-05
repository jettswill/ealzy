#!/bin/bash
# Install host WireGuard and route Telegram plus Gmail/Outlook through it.
# Full-tunnel AllowedIPs=0.0.0.0/0 must not be used: it would steal SSH and HTTPS.
set -euo pipefail

CONF_SRC="${1:-/etc/wireguard/wg0.conf}"
CONF_DST="/etc/wireguard/wg0.conf"

if [[ ! -f "$CONF_SRC" ]]; then
  echo "Missing WireGuard config: $CONF_SRC" >&2
  exit 1
fi

export DEBIAN_FRONTEND=noninteractive
if ! command -v wg >/dev/null; then
  apt-get update -qq
  apt-get install -y wireguard
fi

install -d -m 700 /etc/wireguard
install -m 600 -o root -g root "$CONF_SRC" "$CONF_DST"

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
for helper in policy-routes.sh mail-routes.sh; do
  helper_src="$SCRIPT_DIR/$helper"
  if [[ ! -f "$helper_src" ]]; then
    helper_src="$(cd "$(dirname "$CONF_SRC")" && pwd)/$helper"
  fi
  if [[ -f "$helper_src" ]]; then
    install -m 700 -o root -g root "$helper_src" "/etc/wireguard/$helper"
  fi
done
if [[ ! -x /etc/wireguard/policy-routes.sh ]]; then
  echo "Missing /etc/wireguard/policy-routes.sh" >&2
  exit 1
fi

printf 'net.ipv4.ip_forward=1\n' >/etc/sysctl.d/99-ealzy-wireguard.conf
sysctl -q -p /etc/sysctl.d/99-ealzy-wireguard.conf

systemctl enable wg-quick@wg0
systemctl restart wg-quick@wg0

handshake=0
for _ in $(seq 1 20); do
  handshake="$(wg show wg0 latest-handshakes 2>/dev/null | awk 'NF{print $2; exit}')"
  if [[ -n "${handshake:-}" && "$handshake" != "0" ]]; then
    break
  fi
  sleep 1
done

if [[ -z "${handshake:-}" || "$handshake" == "0" ]]; then
  wg show wg0 || true
  echo "WireGuard is up but no handshake yet; Telegram may still fail." >&2
fi

code="$(curl -4 -sS --max-time 15 -o /dev/null -w '%{http_code}' https://api.telegram.org || true)"
if [[ "$code" == "000" || -z "$code" ]]; then
  echo "Telegram API is still unreachable after bringing WireGuard up." >&2
  wg show wg0 || true
  ip route show | grep -E 'wg0|149.154|91.108' || true
  exit 1
fi

if [[ -x /etc/wireguard/mail-routes.sh ]]; then
  /etc/wireguard/mail-routes.sh wg0 || true
fi
if timeout 8 bash -c 'echo >/dev/tcp/imap.gmail.com/993' 2>/dev/null; then
  echo "Gmail IMAP reachable through the current route"
else
  echo "Gmail IMAP is still unreachable; mail sync may fail until the VPN route is up." >&2
fi

echo "WireGuard handshake ok; Telegram API HTTP $code"
wg show wg0
