#!/usr/bin/env bash
# Nightly backup: database dump plus uploaded files, kept for 14 days.
# These sit on the same server as a first line of defence; copy them off-server too (see docs/runbook.md).
set -euo pipefail
DIR=/var/backups/scopeflow
STAMP="$(date +%Y%m%d-%H%M%S)"
install -d -o postgres -g postgres -m 0750 "$DIR"

sudo -u postgres pg_dump -Fc scopeflow > "$DIR/scopeflow-$STAMP.dump"
tar -czf "$DIR/storage-$STAMP.tar.gz" -C /var/lib/scopeflow storage
chmod 0640 "$DIR"/*-"$STAMP".*

# Check the dump can be read before trusting it.
sudo -u postgres pg_restore --list "$DIR/scopeflow-$STAMP.dump" > /dev/null

find "$DIR" -type f -mtime +14 -delete
echo "$(date -Is) backup ok: $STAMP"
