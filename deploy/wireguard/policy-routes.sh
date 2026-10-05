#!/bin/bash
# Keep Telegram CIDRs on wg0 for outbound Bot API calls, but reply to
# inbound connections (webhooks) via the public NIC. wg-quick AllowedIPs
# otherwise send SYN-ACKs into the tunnel and Telegram times out.
set -euo pipefail

ACTION="${1:-up}"
TABLE=100
PREF=100

read_public() {
  ip -4 route get 1.1.1.1 | awk '{
    gw=""; dev=""; src="";
    for (i = 1; i <= NF; i++) {
      if ($i == "via") gw = $(i + 1)
      if ($i == "dev") dev = $(i + 1)
      if ($i == "src") src = $(i + 1)
    }
    print src, gw, dev
  }'
}

flush_rules() {
  ip rule del pref "$PREF" 2>/dev/null || true
  ip route flush table "$TABLE" 2>/dev/null || true
  # leftover from the previous fwmark split-tunnel attempt
  ip rule del pref 51820 2>/dev/null || true
  ip rule del pref 51821 2>/dev/null || true
  ip route flush table 51820 2>/dev/null || true
  iptables -t mangle -D PREROUTING -j EALZY_TG 2>/dev/null || true
  iptables -t mangle -D OUTPUT -j EALZY_TG 2>/dev/null || true
  iptables -t mangle -F EALZY_TG 2>/dev/null || true
  iptables -t mangle -X EALZY_TG 2>/dev/null || true
}

if [[ "$ACTION" == "down" ]]; then
  flush_rules
  iptables -t nat -D POSTROUTING -o "${2:-wg0}" -j MASQUERADE 2>/dev/null || true
  exit 0
fi

sysctl -q net.ipv4.ip_forward=1
flush_rules

read -r SRC GW DEV <<<"$(read_public)"
if [[ -z "${SRC:-}" || -z "${DEV:-}" ]]; then
  echo "Could not detect public IPv4 route" >&2
  exit 1
fi

if [[ -n "${GW:-}" ]]; then
  ip route replace default via "$GW" dev "$DEV" src "$SRC" table "$TABLE"
else
  ip route replace default dev "$DEV" src "$SRC" table "$TABLE"
fi
ip rule add pref "$PREF" from "$SRC" lookup "$TABLE"
iptables -t nat -C POSTROUTING -o "${2:-wg0}" -j MASQUERADE 2>/dev/null \
  || iptables -t nat -A POSTROUTING -o "${2:-wg0}" -j MASQUERADE
