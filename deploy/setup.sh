#!/usr/bin/env bash
# ScopeFlow server setup for a fresh Ubuntu server (24.04 or later) (one.com Cloud Server).
# Run as root from a clone of the repository:
#
#   bash /opt/scopeflow/repo/deploy/setup.sh
#
# Safe to run again: it skips anything already done.
# It never asks for or stores the email password or AI key; set those
# afterwards with `scopeflow-set-mail` and `scopeflow-set-ai-key`.
set -euo pipefail

REPO_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
APP_USER=scopeflow
BASE=/opt/scopeflow
ENV_DIR=/etc/scopeflow
ENV_FILE=$ENV_DIR/scopeflow.env
DATA_DIR=/var/lib/scopeflow
BACKUP_DIR=/var/backups/scopeflow
PORT=3000

say() { printf '\n\033[1m==> %s\033[0m\n' "$*"; }
die() { printf '\n\033[1;31mStopped: %s\033[0m\n' "$*" >&2; exit 1; }

[ "$(id -u)" -eq 0 ] || die "run this as root (sudo -i first)."
. /etc/os-release
[ "${ID:-}" = "ubuntu" ] || die "this script is for Ubuntu (found ${PRETTY_NAME:-unknown})."

# ---------------------------------------------------------------- questions
DOMAIN="${SCOPEFLOW_DOMAIN:-}"
ADMIN_EMAIL="${SCOPEFLOW_ADMIN_EMAIL:-}"
if [ -f "$ENV_FILE" ]; then
  DOMAIN="${DOMAIN:-$(grep -E '^SCOPEFLOW_DOMAIN=' "$ENV_FILE" | cut -d= -f2-)}"
fi
if [ -z "$DOMAIN" ]; then
  read -r -p "Web address for ScopeFlow [app.chayse.com]: " DOMAIN
  DOMAIN="${DOMAIN:-app.chayse.com}"
fi
if [ -z "$ADMIN_EMAIL" ] && [ ! -f "$BASE/.tenant-created" ]; then
  read -r -p "Email address of the first workspace admin: " ADMIN_EMAIL
  [[ "$ADMIN_EMAIL" == *@*.* ]] || die "that doesn't look like an email address."
fi

# ---------------------------------------------------------------- packages
say "Updating the system and installing packages"
export DEBIAN_FRONTEND=noninteractive
apt-get update -q
apt-get -y -q upgrade
apt-get -y -q install ca-certificates curl gnupg git nginx postgresql postgresql-contrib \
  certbot python3-certbot-nginx ufw fail2ban unattended-upgrades dnsutils

if ! command -v node >/dev/null || [ "$(node -p 'process.versions.node.split(".")[0]')" -lt 20 ]; then
  say "Installing Node.js 22 LTS"
  install -d -m 0755 /etc/apt/keyrings
  curl -fsSL https://deb.nodesource.com/gpgkey/nodesource-repo.gpg.key | gpg --dearmor --yes -o /etc/apt/keyrings/nodesource.gpg
  echo "deb [signed-by=/etc/apt/keyrings/nodesource.gpg] https://deb.nodesource.com/node_22.x nodistro main" > /etc/apt/sources.list.d/nodesource.list
  apt-get update -q
  apt-get -y -q install nodejs
fi
node --version

# ---------------------------------------------------------------- security basics
say "Turning on automatic security updates, firewall and brute-force protection"
dpkg-reconfigure -f noninteractive unattended-upgrades
ufw allow OpenSSH >/dev/null
ufw allow 'Nginx Full' >/dev/null
ufw --force enable >/dev/null
systemctl enable --now fail2ban >/dev/null

# ---------------------------------------------------------------- user and folders
id -u "$APP_USER" >/dev/null 2>&1 || useradd --system --home "$BASE" --shell /usr/sbin/nologin "$APP_USER"
install -d -o root -g root -m 0755 "$BASE" "$BASE/releases"
install -d -o "$APP_USER" -g "$APP_USER" -m 0750 "$DATA_DIR" "$DATA_DIR/storage" "$BASE/build"
install -d -o root -g "$APP_USER" -m 0750 "$ENV_DIR"
install -d -o postgres -g postgres -m 0750 "$BACKUP_DIR"

# ---------------------------------------------------------------- database
say "Setting up the database"
if ! sudo -u postgres psql -tAc "select 1 from pg_roles where rolname='scopeflow'" | grep -q 1; then
  DB_PASS="$(openssl rand -hex 24)"
  sudo -u postgres psql -q -c "create role scopeflow login password '$DB_PASS'"
  sudo -u postgres createdb -O scopeflow scopeflow
else
  DB_PASS=""
fi

# ---------------------------------------------------------------- settings file
if [ ! -f "$ENV_FILE" ]; then
  say "Writing settings to $ENV_FILE"
  [ -n "$DB_PASS" ] || die "database exists but $ENV_FILE is missing; restore it from a backup."
  umask 027
  cat > "$ENV_FILE" <<EOF
# ScopeFlow settings. Readable only by root and the scopeflow service.
SCOPEFLOW_DOMAIN=$DOMAIN
NODE_ENV=production
DATABASE_URL=postgres://scopeflow:$DB_PASS@127.0.0.1:5432/scopeflow
SECRET_KEY=$(openssl rand -base64 48 | tr -d '\n')
TRUST_PROXY=true
STORAGE_DIR=$DATA_DIR/storage
# Email: set with scopeflow-set-mail. Until then, sign-in codes appear in: journalctl -u scopeflow
MAIL_TRANSPORT=console
MAIL_FROM="ScopeFlow <no-reply@chayse.com>"
SMTP_HOST=send.one.com
SMTP_PORT=587
SMTP_USER=
SMTP_PASS=
# AI suggestions: set with scopeflow-set-ai-key (optional).
ANTHROPIC_API_KEY=
EOF
  chown root:"$APP_USER" "$ENV_FILE"
  chmod 0640 "$ENV_FILE"
  umask 022
fi

# Older versions wrote MAIL_FROM unquoted; quote it so every reader agrees.
sed -i 's/^MAIL_FROM=\([^"].*<.*>\)$/MAIL_FROM="\1"/' "$ENV_FILE"

# ---------------------------------------------------------------- helper commands
say "Installing helper commands"
install -m 0755 "$REPO_DIR/deploy/env.sh" /usr/local/bin/scopeflow-env
install -m 0755 "$REPO_DIR/deploy/update.sh" /usr/local/bin/scopeflow-update
install -m 0755 "$REPO_DIR/deploy/set-mail.sh" /usr/local/bin/scopeflow-set-mail
install -m 0755 "$REPO_DIR/deploy/set-ai-key.sh" /usr/local/bin/scopeflow-set-ai-key
install -m 0755 "$REPO_DIR/deploy/enable-https.sh" /usr/local/bin/scopeflow-enable-https
install -m 0755 "$REPO_DIR/deploy/backup.sh" /usr/local/bin/scopeflow-backup
install -m 0644 "$REPO_DIR/deploy/scopeflow.service" /etc/systemd/system/scopeflow.service
systemctl daemon-reload

# ---------------------------------------------------------------- nginx
say "Configuring the web server for $DOMAIN"
sed "s/__DOMAIN__/$DOMAIN/g; s/__PORT__/$PORT/g" "$REPO_DIR/deploy/nginx.conf" > /etc/nginx/sites-available/scopeflow
ln -sf /etc/nginx/sites-available/scopeflow /etc/nginx/sites-enabled/scopeflow
rm -f /etc/nginx/sites-enabled/default
nginx -t
systemctl reload nginx

# ---------------------------------------------------------------- build and start
say "Building and starting ScopeFlow (takes a few minutes)"
/usr/local/bin/scopeflow-update --no-pull

# ---------------------------------------------------------------- first workspace
if [ ! -f "$BASE/.tenant-created" ]; then
  say "Creating the Chayse Consulting workspace"
  (
    cd "$BASE/current-src"
    sudo -u "$APP_USER" env HOME="$BASE/build" /usr/local/bin/scopeflow-env npx --no-install tsx scripts/create-tenant.ts \
      --slug chayse --name "Chayse Consulting" --admin-email "$ADMIN_EMAIL" \
      --hostname "$DOMAIN" --verified
  )
  touch "$BASE/.tenant-created"
fi

# ---------------------------------------------------------------- backups
say "Scheduling nightly backups"
cat > /etc/cron.d/scopeflow-backup <<EOF
# Nightly database and file backup at 02:30, kept for 14 days.
30 2 * * * root /usr/local/bin/scopeflow-backup >> /var/log/scopeflow-backup.log 2>&1
EOF

# ---------------------------------------------------------------- HTTPS
say "Checking whether $DOMAIN points at this server"
/usr/local/bin/scopeflow-enable-https || true

say "Done"
cat <<EOF

ScopeFlow is installed.

  Health check:   curl -s http://127.0.0.1:$PORT/api/health
  Logs:           journalctl -u scopeflow -f
  Set up email:   scopeflow-set-mail
  Add AI key:     scopeflow-set-ai-key   (optional)
  Update later:   scopeflow-update

Until email is set up, sign-in codes are written to the log instead of emailed.
EOF
