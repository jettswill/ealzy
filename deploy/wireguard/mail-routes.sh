#!/bin/bash
# Pin Gmail/Outlook host /32s to wg0 so IMAP/SMTP leave via the VPN.
# Broader Google CIDRs already live in wg0.conf AllowedIPs; this covers IP churn.
set -euo pipefail

IFACE="${1:-wg0}"
HOSTS=(
  imap.gmail.com
  smtp.gmail.com
  imap.googlemail.com
  smtp.googlemail.com
  outlook.office365.com
  smtp.office365.com
)

if ! command -v wg >/dev/null; then
  exit 0
fi
if ! ip link show "$IFACE" >/dev/null 2>&1; then
  exit 0
fi

PEER="$(wg show "$IFACE" peers | awk 'NR==1 { print; exit }')"
if [[ -z "${PEER:-}" ]]; then
  echo "No WireGuard peer on $IFACE" >&2
  exit 0
fi

ips=()
for host in "${HOSTS[@]}"; do
  while read -r ip; do
    [[ "$ip" =~ ^[0-9]+\.[0-9]+\.[0-9]+\.[0-9]+$ ]] || continue
    ips+=("$ip")
  done < <(getent ahostsv4 "$host" 2>/dev/null | awk '{ print $1 }' | sort -u)
done

if [[ ${#ips[@]} -eq 0 ]]; then
  echo "Could not resolve mail hosts for $IFACE" >&2
  exit 0
fi

existing="$(wg show "$IFACE" allowed-ips | awk -v peer="$PEER" '$1 == peer { $1=""; print }')"
merged=()
declare -A seen=()
while read -r cidr; do
  [[ -n "$cidr" ]] || continue
  seen["$cidr"]=1
  merged+=("$cidr")
done < <(printf '%s\n' $existing)

for ip in "${ips[@]}"; do
  cidr="$ip/32"
  if [[ -z "${seen[$cidr]:-}" ]]; then
    seen["$cidr"]=1
    merged+=("$cidr")
  fi
  ip route replace "$cidr" dev "$IFACE"
done

IFS=,
wg set "$IFACE" peer "$PEER" allowed-ips "${merged[*]}"
unset IFS

echo "Mail routes on $IFACE: ${ips[*]}"
