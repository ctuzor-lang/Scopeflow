#!/usr/bin/env bash
# Builds the latest ScopeFlow from GitHub, migrates the database and switches over.
# If the new version doesn't start healthily, the previous one is put back.
#
#   scopeflow-update            # fetch latest from GitHub and deploy
#   scopeflow-update --no-pull  # deploy the code already on the server
set -euo pipefail

APP_USER=scopeflow
BASE=/opt/scopeflow
REPO=$BASE/repo
ENV_FILE=/etc/scopeflow/scopeflow.env
PORT=3000

say() { printf '\n\033[1m==> %s\033[0m\n' "$*"; }
die() { printf '\n\033[1;31mStopped: %s\033[0m\n' "$*" >&2; exit 1; }
[ "$(id -u)" -eq 0 ] || die "run as root."
[ -f "$ENV_FILE" ] || die "$ENV_FILE is missing; run deploy/setup.sh first."

if [ "${1:-}" != "--no-pull" ]; then
  say "Fetching the latest code"
  git -C "$REPO" fetch --quiet origin main
  git -C "$REPO" reset --quiet --hard origin/main
  # Refresh the helper commands and server settings, then continue with the new version of this script.
  bash "$REPO/deploy/install-helpers.sh"
  exec /usr/local/bin/scopeflow-update --no-pull
fi
REV="$(git -C "$REPO" rev-parse --short HEAD)"
STAMP="$(date +%Y%m%d-%H%M%S)"
RELEASE="$BASE/releases/$STAMP-$REV"

say "Building release $REV"
SRC="$BASE/build/src-$STAMP"
git -C "$REPO" archive --format=tar HEAD | (install -d -o "$APP_USER" -g "$APP_USER" "$SRC" && tar -x -C "$SRC")
chown -R "$APP_USER:$APP_USER" "$SRC"
(
  cd "$SRC"
  sudo -u "$APP_USER" env HOME="$BASE/build" NEXT_TELEMETRY_DISABLED=1 npm ci --no-audit --no-fund --loglevel=error
  # Build without production secrets in the environment.
  sudo -u "$APP_USER" env HOME="$BASE/build" NEXT_TELEMETRY_DISABLED=1 \
    DATABASE_URL=postgres://build-only SECRET_KEY=build-only-placeholder-not-a-real-secret npm run build
)

# Self-contained server plus its static files and the scripts needed for migrations.
install -d "$RELEASE"
cp -a "$SRC/.next/standalone/." "$RELEASE/"
install -d "$RELEASE/.next"
cp -a "$SRC/.next/static" "$RELEASE/.next/static"
[ -d "$SRC/public" ] && cp -a "$SRC/public" "$RELEASE/public"
chown -R root:root "$RELEASE"
chmod -R go-w "$RELEASE"

say "Updating the database"
/usr/local/bin/scopeflow-db-migrate

PREVIOUS="$(readlink -f "$BASE/current" 2>/dev/null || true)"
ln -sfn "$RELEASE" "$BASE/current.new" && mv -T "$BASE/current.new" "$BASE/current"
# Keep the matching source (with dev tools) for operator scripts such as creating a workspace.
ln -sfn "$SRC" "$BASE/current-src.new" && mv -T "$BASE/current-src.new" "$BASE/current-src"

say "Restarting"
systemctl enable scopeflow >/dev/null 2>&1
systemctl restart scopeflow
for _ in $(seq 1 30); do
  if curl -fsS "http://127.0.0.1:$PORT/api/health" >/dev/null 2>&1; then
    say "Release $REV is live"
    # Keep the five newest releases and builds.
    ls -1dt "$BASE"/releases/* 2>/dev/null | tail -n +6 | xargs -r rm -rf
    ls -1dt "$BASE"/build/src-* 2>/dev/null | tail -n +6 | xargs -r rm -rf
    exit 0
  fi
  sleep 2
done

if [ -n "$PREVIOUS" ] && [ "$PREVIOUS" != "$RELEASE" ]; then
  printf '\n\033[1;31mNew release did not start; putting the previous one back.\033[0m\n' >&2
  ln -sfn "$PREVIOUS" "$BASE/current.new" && mv -T "$BASE/current.new" "$BASE/current"
  systemctl restart scopeflow
fi
journalctl -u scopeflow -n 40 --no-pager >&2 || true
die "release $REV failed its health check (database changes, if any, were kept)."
