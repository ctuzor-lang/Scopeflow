#!/usr/bin/env bash
# Switches on the public demo at its own address (e.g. demo.chayse.com):
# checks DNS points here, adds the address to the web server and the HTTPS certificate,
# and tells ScopeFlow about it. Safe to run again.
#   scopeflow-enable-demo demo.chayse.com
set -euo pipefail
ENV_FILE=/etc/scopeflow/scopeflow.env
SITE=/etc/nginx/sites-available/scopeflow
[ "$(id -u)" -eq 0 ] || { echo "Run as root." >&2; exit 1; }
DEMO="${1:-}"
[[ "$DEMO" =~ ^[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)+$ ]] || { echo "Usage: scopeflow-enable-demo demo.example.com" >&2; exit 1; }
MAIN="$(grep -E '^SCOPEFLOW_DOMAIN=' "$ENV_FILE" | cut -d= -f2-)"

MY_IP="$(curl -4 -fsS https://api.ipify.org || true)"
DNS_IP="$(dig +short A "$DEMO" @1.1.1.1 | tail -n1)"
if [ -z "$MY_IP" ] || [ "$DNS_IP" != "$MY_IP" ]; then
  echo "$DEMO points to '${DNS_IP:-nothing}', this server is '${MY_IP:-unknown}'. Add a DNS A record, wait a few minutes, then run this again." >&2
  exit 1
fi

if ! grep -qE "server_name[^;]*\b$DEMO\b" "$SITE"; then
  cp -a "$SITE" "$SITE.bak.$(date +%Y%m%d%H%M%S)"
  sed -i -E "s/server_name $MAIN;/server_name $MAIN $DEMO;/" "$SITE"
fi
nginx -t && systemctl reload nginx
certbot --nginx -d "$MAIN" -d "$DEMO" --expand --redirect --non-interactive --keep-until-expiring

tmp="$(mktemp)"
grep -v -E '^DEMO_HOSTNAME=' "$ENV_FILE" > "$tmp" || true
printf 'DEMO_HOSTNAME=%s\n' "$DEMO" >> "$tmp"
cat "$tmp" > "$ENV_FILE"
rm -f "$tmp"
systemctl restart scopeflow
echo "Demo is on: https://$DEMO/tour"
