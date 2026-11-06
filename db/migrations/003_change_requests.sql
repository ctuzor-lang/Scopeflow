-- ScopeFlow slice 3: change requests and impact assessments.

alter table project add column cr_counter integer not null default 0;

create table change_request (
  id                  uuid primary key default gen_random_uuid(),
  tenant_id           uuid not null,
  project_id          uuid not null,
  number              integer not null check (number >= 1),
  source_baseline_id  uuid not null,
  title               text not null check (length(title) between 1 and 200),
  request_text        text not null check (length(request_text) between 1 and 10000),
  source              text not null check (source in ('email', 'meeting', 'call', 'document', 'other')),
  requested_by        text check (requested_by is null or length(requested_by) <= 160),
  requested_on        date,
  wanted_by           date,
  status              text not null default 'submitted'
                      check (status in ('submitted', 'assessing', 'awaiting_client', 'approved', 'rejected', 'incorporated', 'withdrawn')),
  created_by          uuid references app_user(id),
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now(),
  unique (project_id, number),
  unique (id, tenant_id),
  foreign key (project_id, tenant_id) references project(id, tenant_id) on delete restrict,
  foreign key (source_baseline_id, tenant_id) references baseline(id, tenant_id)
);
create index change_request_project_idx on change_request(project_id, number desc);

-- The agency's working assessment. Editable until published as a revision.
create table impact_draft (
  change_request_id  uuid primary key references change_request(id) on delete cascade,
  affected_keys      text[] not null default '{}',
  scope_change       text check (scope_change is null or length(scope_change) <= 10000),
  effort_min_days    numeric(7,1) check (effort_min_days is null or effort_min_days >= 0),
  effort_max_days    numeric(7,1) check (effort_max_days is null or effort_max_days >= 0),
  price_minor        bigint check (price_minor is null or price_minor >= 0),
  pricing_basis      text check (pricing_basis is null or pricing_basis in ('fixed', 'estimate', 'no_charge')),
  schedule_days      integer check (schedule_days is null or schedule_days between -365 and 365),
  assumptions        text check (assumptions is null or length(assumptions) <= 5000),
  risks              text check (risks is null or length(risks) <= 5000),
  updated_by         uuid references app_user(id),
  updated_at         timestamptz not null default now()
);

-- A published assessment the client decides on. Never edited; a revision supersedes it.
create table impact_revision (
  id                 uuid primary key default gen_random_uuid(),
  tenant_id          uuid not null,
  change_request_id  uuid not null,
  rev_no             integer not null check (rev_no >= 1),
  payload            jsonb not null,
  content_digest     text not null,
  published_by       uuid references app_user(id),
  published_at       timestamptz not null default now(),
  unique (change_request_id, rev_no),
  foreign key (change_request_id, tenant_id) references change_request(id, tenant_id) on delete restrict
);

create function impact_revision_is_immutable() returns trigger
language plpgsql as $$
begin
  raise exception 'published assessments are immutable';
end;
$$;

create trigger impact_revision_no_update
  before update or delete on impact_revision
  for each row execute function impact_revision_is_immutable();
