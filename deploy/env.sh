#!/usr/bin/env bash
# Runs a command with ScopeFlow's settings loaded, read literally (never executed as shell code),
# the same way systemd reads them. Usage: scopeflow-env <command> [args...]
set -euo pipefail
ENV_FILE="${SCOPEFLOW_ENV_FILE:-/etc/scopeflow/scopeflow.env}"
[ -r "$ENV_FILE" ] || { echo "Can't read $ENV_FILE" >&2; exit 1; }
while IFS= read -r line || [ -n "$line" ]; do
  case "$line" in ''|'#'*) continue ;; esac
  key="${line%%=*}"
  val="${line#*=}"
  [[ "$key" =~ ^[A-Za-z_][A-Za-z0-9_]*$ ]] || continue
  if [ "${#val}" -ge 2 ] && [ "${val:0:1}" = '"' ] && [ "${val: -1}" = '"' ]; then
    val="${val:1:${#val}-2}"
    val="${val//\\\"/\"}"
    val="${val//\\\\/\\}"
  fi
  export "$key=$val"
done < "$ENV_FILE"
exec "$@"
