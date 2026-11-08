#!/usr/bin/env bash
# Applies database migrations and keeps the app's database account least-privileged
# (security review F4):
#   - scopeflow_owner (no login) owns every table, trigger and function;
#   - scopeflow (the running app) can read and write rows but cannot alter, truncate,
#     drop or disable triggers, so the immutability rules hold even if the app is compromised.
# Migrations are read from the root-owned git clone, never from the app-writable build folder,
# and run through psql as the postgres superuser switching to scopeflow_owner.
# Usage (as root): scopeflow-db-migrate
set -euo pipefail
REPO="${SCOPEFLOW_REPO:-/opt/scopeflow/repo}"
DB="${SCOPEFLOW_DB:-scopeflow}"
APP_ROLE="${SCOPEFLOW_APP_ROLE:-scopeflow}"
OWNER_ROLE="${APP_ROLE}_owner"
PSQL=(${SCOPEFLOW_PSQL:-sudo -u postgres psql} -X -q -v ON_ERROR_STOP=1)

sql() { "${PSQL[@]}" -d "$DB" "$@"; }

# 1. Owner role, and hand ownership of everything over to it (one-time conversion; no-op after).
"${PSQL[@]}" -d postgres -c "do \$\$ begin
  if not exists (select 1 from pg_roles where rolname = '$OWNER_ROLE') then
    create role $OWNER_ROLE nologin;
  end if;
end \$\$;"
"${PSQL[@]}" -d postgres -c "alter database $DB owner to $OWNER_ROLE"
sql -c "reassign owned by $APP_ROLE to $OWNER_ROLE"

# 2. Pending migrations, each in its own transaction, as the owner.
sql -c "set role $OWNER_ROLE; create table if not exists schema_migrations (version text primary key, applied_at timestamptz not null default now())"
done_list="$(sql -At -c "select version from schema_migrations")"
applied=0
while IFS= read -r file; do
  [ -n "$file" ] || continue
  version="$(basename "$file")"
  grep -qxF "$version" <<<"$done_list" && continue
  { echo "set role $OWNER_ROLE;"; git -C "$REPO" show "HEAD:$file"; echo; echo "insert into schema_migrations(version) values ('$version');"; } \
    | sql --single-transaction -f - || { echo "Migration $version failed" >&2; exit 1; }
  echo "applied $version"
  applied=$((applied + 1))
done < <(git -C "$REPO" ls-tree --name-only HEAD db/migrations/ | grep -E '\.sql$' | sort)
[ "$applied" -gt 0 ] || echo "database is up to date"

# 3. What the running app may do: rows only. No TRUNCATE, no DDL, no trigger changes.
sql <<SQL
revoke all on schema public from public;
grant usage on schema public to $APP_ROLE;
revoke all on all tables in schema public from $APP_ROLE;
grant select, insert, update, delete on all tables in schema public to $APP_ROLE;
grant usage, select on all sequences in schema public to $APP_ROLE;
alter default privileges for role $OWNER_ROLE in schema public grant select, insert, update, delete on tables to $APP_ROLE;
alter default privileges for role $OWNER_ROLE in schema public grant usage, select on sequences to $APP_ROLE;
revoke create on database $DB from $APP_ROLE;
grant connect on database $DB to $APP_ROLE;
SQL
