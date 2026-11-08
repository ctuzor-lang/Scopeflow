#!/usr/bin/env bash
# Removes public-demo sandboxes an hour after they expire, with everything in them.
# Sandbox rows are protected by the same "no edit / no delete" triggers as real data, so this runs as
# the postgres superuser with triggers suspended for this one transaction, and touches ONLY tenants
# marked as sandboxes (sandbox_expires_at set) and the throwaway …@sandbox.invalid users.
# Runs hourly from cron (installed by scopeflow-install-helpers).
set -euo pipefail
PSQL=(${SCOPEFLOW_PSQL:-sudo -u postgres psql} -X -q -v ON_ERROR_STOP=1 -d "${SCOPEFLOW_DB:-scopeflow}")
"${PSQL[@]}" <<'SQL'
begin;
set local session_replication_role = replica;
create temp table gone on commit drop as
  select id from tenant where sandbox_expires_at is not null and sandbox_expires_at < now() - interval '1 hour';
delete from baseline_item where baseline_id in (select id from baseline where tenant_id in (select id from gone));
delete from impact_draft where change_request_id in (select id from change_request where tenant_id in (select id from gone));
do $$
declare t record;
begin
  for t in select c.table_name from information_schema.columns c
           join information_schema.tables x on x.table_name = c.table_name and x.table_schema = c.table_schema and x.table_type = 'BASE TABLE'
           where c.table_schema = 'public' and c.column_name = 'tenant_id' and c.table_name <> 'tenant'
  loop
    execute format('delete from %I where tenant_id in (select id from gone)', t.table_name);
  end loop;
end $$;
delete from tenant where id in (select id from gone);
delete from app_user u where u.email like '%@sandbox.invalid'
  and not exists (select 1 from membership m where m.user_id = u.id)
  and not exists (select 1 from project_access a where a.user_id = u.id)
  and not exists (select 1 from session s where s.user_id = u.id);
commit;
SQL
