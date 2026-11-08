#!/usr/bin/env bash
# Installs or refreshes ScopeFlow's server-side pieces from the repository: helper commands,
# the systemd service, nginx hardening and rate limits, backup folder and schedule.
# Safe to run any number of times; scopeflow-update runs it after fetching new code.
# Never rewrites the nginx site once it exists (certbot has added HTTPS to it).
set -euo pipefail
REPO_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
[ "$(id -u)" -eq 0 ] || { echo "Run as root." >&2; exit 1; }
SITE=/etc/nginx/sites-available/scopeflow

for name in env update db-migrate set-mail set-ai-key enable-https enable-demo demo-cleanup backup; do
  install -m 0755 "$REPO_DIR/deploy/$name.sh" "/usr/local/bin/scopeflow-$name"
done
install -m 0755 "$REPO_DIR/deploy/install-helpers.sh" /usr/local/bin/scopeflow-install-helpers

if ! cmp -s "$REPO_DIR/deploy/scopeflow.service" /etc/systemd/system/scopeflow.service; then
  install -m 0644 "$REPO_DIR/deploy/scopeflow.service" /etc/systemd/system/scopeflow.service
  systemctl daemon-reload
fi

# Backups: root-only folder (F6/F7), nightly at 02:30.
install -d -o root -g root -m 0700 /var/backups/scopeflow
chown root:root /var/backups/scopeflow && chmod 0700 /var/backups/scopeflow
find /var/backups/scopeflow -maxdepth 1 -type f -exec chown root:root {} + -exec chmod 0600 {} +
cat > /etc/cron.d/scopeflow-backup <<'EOF'
# Nightly database and file backup at 02:30, kept for 14 days.
30 2 * * * root /usr/local/bin/scopeflow-backup >> /var/log/scopeflow-backup.log 2>&1
EOF
cat > /etc/cron.d/scopeflow-demo-cleanup <<'EOF'
# Remove expired public-demo sandboxes, hourly.
17 * * * * root /usr/local/bin/scopeflow-demo-cleanup >> /var/log/scopeflow-demo-cleanup.log 2>&1
EOF

# nginx: server-wide hardening, plus rate limits inside the existing site (F10).
if [ -d /etc/nginx/conf.d ]; then
  install -m 0644 "$REPO_DIR/deploy/nginx-hardening.conf" /etc/nginx/conf.d/scopeflow-hardening.conf
  if [ -f "$SITE" ] && ! grep -q 'zone=sf_post' "$SITE"; then
    cp -a "$SITE" "$SITE.bak.$(date +%Y%m%d%H%M%S)"
    sed -i '/^\s*location \/ {/a\        limit_req zone=sf_all burst=60 nodelay;\n        limit_req zone=sf_post burst=20 nodelay;' "$SITE"
  fi
  if nginx -t 2>/dev/null; then
    systemctl reload nginx
  else
    nginx -t || true
    # Put things back so the running web server keeps working.
    rm -f /etc/nginx/conf.d/scopeflow-hardening.conf
    latest_bak="$(ls -1t "$SITE".bak.* 2>/dev/null | head -n1 || true)"
    [ -n "$latest_bak" ] && grep -q 'zone=sf_post' "$SITE" && cp -a "$latest_bak" "$SITE"
    echo "Web server hardening skipped: nginx rejected it (nothing else changed)." >&2
  fi
fi
echo "Helpers, service, backups and web server settings are up to date."
