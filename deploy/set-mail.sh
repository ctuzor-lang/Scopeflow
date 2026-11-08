#!/usr/bin/env bash
# Connects ScopeFlow to a one.com mailbox so sign-in codes and notifications are emailed.
# The password is typed here and stored only in /etc/scopeflow/scopeflow.env.
set -euo pipefail
ENV_FILE=/etc/scopeflow/scopeflow.env
[ "$(id -u)" -eq 0 ] || { echo "Run as root."; exit 1; }

read -r -p "Mailbox to send from [no-reply@chayse.com]: " ADDRESS
ADDRESS="${ADDRESS:-no-reply@chayse.com}"
read -r -s -p "Password for $ADDRESS (not shown): " PASSWORD; echo
[ -n "$PASSWORD" ] || { echo "No password entered; nothing changed."; exit 1; }

set_value() {
  local key="$1" value="$2" tmp
  tmp="$(mktemp)"
  grep -v -E "^$key=" "$ENV_FILE" > "$tmp" || true
  # Double-quoted with \ and " escaped, which systemd and scopeflow-env both read back literally.
  value="${value//\\/\\\\}"; value="${value//\"/\\\"}"
  printf '%s="%s"\n' "$key" "$value" >> "$tmp"
  cat "$tmp" > "$ENV_FILE"
  rm -f "$tmp"
}
set_value MAIL_TRANSPORT smtp
set_value MAIL_FROM "ScopeFlow <$ADDRESS>"
set_value SMTP_HOST send.one.com
set_value SMTP_PORT 587
set_value SMTP_USER "$ADDRESS"
set_value SMTP_PASS "$PASSWORD"
unset PASSWORD

systemctl restart scopeflow
echo "Email set to send from $ADDRESS via send.one.com. Test it by asking for a sign-in code."
