#!/usr/bin/env bash
# Adds (or removes) the Anthropic API key for AI suggestions. Typed here, never shown.
# Workspace admins must still turn AI on in Settings.
set -euo pipefail
ENV_FILE=/etc/scopeflow/scopeflow.env
[ "$(id -u)" -eq 0 ] || { echo "Run as root."; exit 1; }

read -r -s -p "Anthropic API key (leave empty to remove; not shown): " KEY; echo
tmp="$(mktemp)"
grep -v -E '^ANTHROPIC_API_KEY=' "$ENV_FILE" > "$tmp" || true
printf 'ANTHROPIC_API_KEY=%s\n' "$KEY" >> "$tmp"
cat "$tmp" > "$ENV_FILE"
rm -f "$tmp"
systemctl restart scopeflow
if [ -n "$KEY" ]; then echo "AI key saved. An admin can now turn on AI suggestions in Settings."; else echo "AI key removed; AI suggestions are off."; fi
unset KEY
