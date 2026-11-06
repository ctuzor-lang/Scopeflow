-- ScopeFlow slice 2: clients, projects, scope items and immutable baselines.
-- Every row carries tenant_id, and composite foreign keys make it impossible for
-- a row to point at another tenant's project or item.

create table client_organisation (
  id          uuid primary key default gen_random_uuid(),
  tenant_id   uuid not null references tenant(id) on delete cascade,
  name        text not null check (length(name) between 1 and 160),
  created_at  timestamptz not null default now(),
  unique (tenant_id, name),
  unique (id, tenant_id)
);

create table project (
  id              uuid primary key default gen_random_uuid(),
  tenant_id       uuid not null references tenant(id) on delete cascade,
  client_org_id   uuid not null,
  name            text not null check (length(name) between 1 and 160),
  reference       text check (reference is null or length(reference) <= 60),
  currency        char(3) not null default 'GBP' check (currency ~ '^[A-Z]{3}$'),
  status          text not null default 'active' check (status in ('active', 'archived')),
  key_counter     integer not null default 0,
  created_by      uuid references app_user(id),
  created_at      timestamptz not null default now(),
  unique (id, tenant_id),
  foreign key (client_org_id, tenant_id) references client_organisation(id, tenant_id)
);
create index project_tenant_idx on project(tenant_id, created_at desc);

-- A scope item. Its content lives in append-only revisions; the item points at the current one.
create table requirement (
  id                   uuid primary key default gen_random_uuid(),
  tenant_id            uuid not null,
  project_id           uuid not null,
  canonical_key        text not null check (canonical_key ~ '^[A-Z0-9][A-Z0-9._-]{0,31}$'),
  status               text not null default 'active' check (status in ('active', 'removed')),
  current_revision_id  uuid,
  position             integer not null default 0,
  created_at           timestamptz not null default now(),
  unique (project_id, canonical_key),
  unique (id, tenant_id),
  foreign key (project_id, tenant_id) references project(id, tenant_id) on delete cascade
);

create table requirement_revision (
  id                   uuid primary key default gen_random_uuid(),
  tenant_id            uuid not null,
  requirement_id       uuid not null,
  rev_no               integer not null check (rev_no >= 1),
  kind                 text not null check (kind in ('deliverable', 'requirement', 'assumption', 'exclusion')),
  section              text check (section is null or length(section) <= 120),
  title                text not null check (length(title) between 1 and 300),
  description          text check (description is null or length(description) <= 5000),
  acceptance_criteria  text check (acceptance_criteria is null or length(acceptance_criteria) <= 5000),
  author_id            uuid references app_user(id),
  created_at           timestamptz not null default now(),
  unique (requirement_id, rev_no),
  foreign key (requirement_id, tenant_id) references requirement(id, tenant_id) on delete cascade
);

alter table requirement
  add constraint requirement_current_revision_fk
  foreign key (current_revision_id) references requirement_revision(id) deferrable initially deferred;

-- A published, numbered snapshot of the scope. Content never changes after publishing;
-- only its review status moves (in-review, approved, superseded) in later slices.
create table baseline (
  id              uuid primary key default gen_random_uuid(),
  tenant_id       uuid not null,
  project_id      uuid not null,
  version_number  integer not null check (version_number >= 1),
  status          text not null default 'published'
                  check (status in ('published', 'in_review', 'approved', 'changes_requested', 'superseded')),
  content_digest  text not null,
  item_count      integer not null,
  published_by    uuid references app_user(id),
  published_at    timestamptz not null default now(),
  unique (project_id, version_number),
  unique (id, tenant_id),
  foreign key (project_id, tenant_id) references project(id, tenant_id) on delete restrict
);

create table baseline_item (
  baseline_id              uuid not null references baseline(id) on delete restrict,
  requirement_revision_id  uuid not null references requirement_revision(id) on delete restrict,
  canonical_key            text not null,
  position                 integer not null,
  payload                  jsonb not null,
  primary key (baseline_id, canonical_key)
);

-- Revisions and baseline items are append-only.
create function requirement_revision_is_append_only() returns trigger
language plpgsql as $$
begin
  raise exception 'requirement revisions are append-only';
end;
$$;

create trigger requirement_revision_no_update
  before update or delete on requirement_revision
  for each row execute function requirement_revision_is_append_only();

create function baseline_item_is_immutable() returns trigger
language plpgsql as $$
begin
  raise exception 'baseline content is immutable';
end;
$$;

create trigger baseline_item_no_update
  before update or delete on baseline_item
  for each row execute function baseline_item_is_immutable();

-- A baseline's identity and content fields are frozen; only status may change. It can't be deleted.
create function baseline_guard() returns trigger
language plpgsql as $$
begin
  if tg_op = 'DELETE' then
    raise exception 'baseline content is immutable';
  end if;
  if new.project_id is distinct from old.project_id
     or new.tenant_id is distinct from old.tenant_id
     or new.version_number is distinct from old.version_number
     or new.content_digest is distinct from old.content_digest
     or new.item_count is distinct from old.item_count
     or new.published_by is distinct from old.published_by
     or new.published_at is distinct from old.published_at then
    raise exception 'baseline content is immutable';
  end if;
  return new;
end;
$$;

create trigger baseline_guard
  before update or delete on baseline
  for each row execute function baseline_guard();
