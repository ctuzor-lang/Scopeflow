#!/usr/bin/env bash
# Nightly backup: database dump plus uploaded files, kept for 14 days.
# Written by root into a root-only folder (security review F6/F7). These sit on the same
# server as a first line of defence; copy them off-server too (see docs/runbook.md).
set -euo pipefail
umask 077
DIR=/var/backups/scopeflow
install -d -o root -g root -m 0700 "$DIR"
chown root:root "$DIR" && chmod 0700 "$DIR"
STAMP="$(date +%Y%m%d-%H%M%S)"

DUMP="$(mktemp "$DIR/scopeflow-$STAMP-XXXXXX.dump")"
FILES="$(mktemp "$DIR/storage-$STAMP-XXXXXX.tar.gz")"
# postgres writes to our pipe; root owns the file.
sudo -u postgres pg_dump -Fc scopeflow > "$DUMP"
tar -czf "$FILES" -C /var/lib/scopeflow storage

# Check the dump can be read before trusting it (root opens it; no database needed).
pg_restore --list < "$DUMP" > /dev/null

find "$DIR" -maxdepth 1 -type f -mtime +14 -delete
echo "$(date -Is) backup ok: $(basename "$DUMP") $(basename "$FILES")"
