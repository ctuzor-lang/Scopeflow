-- ScopeFlow slice 6: advisory AI suggestions on change requests.
-- Off by default per tenant. Suggestions are proposals until a person accepts one.

alter table tenant add column ai_enabled boolean not null default false;

create table ai_run (
  id                 uuid primary key default gen_random_uuid(),
  tenant_id          uuid not null references tenant(id),
  change_request_id  uuid not null references change_request(id) on delete restrict,
  model              text not null,
  prompt_version     text not null,
  input_digest       text not null,
  status             text not null check (status in ('ok', 'failed')),
  error              text,
  created_by         uuid references app_user(id),
  created_at         timestamptz not null default now()
);
create index ai_run_tenant_idx on ai_run(tenant_id, created_at desc);

create table ai_suggestion (
  id                 uuid primary key default gen_random_uuid(),
  tenant_id          uuid not null references tenant(id),
  run_id             uuid not null references ai_run(id) on delete restrict,
  change_request_id  uuid not null references change_request(id) on delete restrict,
  kind               text not null check (kind in ('summary', 'affected_item', 'risk', 'assumption', 'question')),
  position           integer not null default 0,
  content            jsonb not null,
  status             text not null default 'proposed' check (status in ('proposed', 'accepted', 'dismissed')),
  decided_by         uuid references app_user(id),
  decided_at         timestamptz,
  created_at         timestamptz not null default now()
);
create index ai_suggestion_cr_idx on ai_suggestion(change_request_id, created_at);
