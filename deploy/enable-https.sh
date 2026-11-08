#!/usr/bin/env bash
# Gets a free HTTPS certificate (Let's Encrypt) once the domain points at this server.
# Renewal is automatic. Safe to run again.
set -euo pipefail
ENV_FILE=/etc/scopeflow/scopeflow.env
DOMAIN="$(grep -E '^SCOPEFLOW_DOMAIN=' "$ENV_FILE" | cut -d= -f2-)"
EMAIL="${1:-}"

MY_IP="$(curl -4 -fsS https://api.ipify.org || true)"
DNS_IP="$(dig +short A "$DOMAIN" @1.1.1.1 | tail -n1)"
if [ -z "$MY_IP" ] || [ "$DNS_IP" != "$MY_IP" ]; then
  cat <<EOF

HTTPS not set up yet: $DOMAIN points to '${DNS_IP:-nothing}', this server is '${MY_IP:-unknown}'.
Add a DNS "A" record for $DOMAIN pointing to ${MY_IP:-the server IP} in one.com,
wait a few minutes, then run:  scopeflow-enable-https you@chayse.com

Sign-in needs HTTPS, so do this before using ScopeFlow.
EOF
  exit 1
fi

if [ -d "/etc/letsencrypt/live/$DOMAIN" ]; then
  echo "HTTPS is already set up for $DOMAIN."
  exit 0
fi
if [ -z "$EMAIL" ]; then
  read -r -p "Email for certificate expiry notices: " EMAIL
fi
certbot --nginx -d "$DOMAIN" --non-interactive --agree-tos -m "$EMAIL" --redirect
# Tell browsers to always use HTTPS for this address.
sed -i "/server_name $DOMAIN;/a\\    add_header Strict-Transport-Security \"max-age=31536000\" always;" /etc/nginx/sites-available/scopeflow
nginx -t && systemctl reload nginx
echo "HTTPS is on: https://$DOMAIN"
