-- ScopeFlow slice 4: client access, decisions and question threads.

-- Client people get access to individual projects, never to the agency workspace.
create table project_access (
  id          uuid primary key default gen_random_uuid(),
  tenant_id   uuid not null,
  project_id  uuid not null,
  user_id     uuid not null references app_user(id),
  role        text not null check (role in ('approver', 'viewer')),
  status      text not null default 'active' check (status in ('active', 'revoked')),
  invited_by  uuid references app_user(id),
  invited_at  timestamptz not null default now(),
  revoked_at  timestamptz,
  unique (project_id, user_id),
  foreign key (project_id, tenant_id) references project(id, tenant_id) on delete cascade
);
create index project_access_user_idx on project_access(user_id, tenant_id);

alter table impact_revision add constraint impact_revision_id_cr_key unique (id, change_request_id);

-- The client's decision. One per change request, bound to one exact published revision.
create table change_decision (
  id                   uuid primary key default gen_random_uuid(),
  tenant_id            uuid not null,
  change_request_id    uuid not null unique,
  impact_revision_id   uuid not null,
  rev_no               integer not null,
  revision_digest      text not null,
  outcome              text not null check (outcome in ('approved', 'rejected')),
  decided_by           uuid not null references app_user(id),
  authority_statement  text,
  comment              text check (comment is null or length(comment) <= 5000),
  ip                   text,
  user_agent           text,
  decided_at           timestamptz not null default now(),
  foreign key (change_request_id, tenant_id) references change_request(id, tenant_id) on delete restrict,
  foreign key (impact_revision_id, change_request_id) references impact_revision(id, change_request_id),
  check (outcome = 'rejected' or authority_statement is not null)
);

create function change_decision_is_immutable() returns trigger
language plpgsql as $$
begin
  raise exception 'client decisions are immutable';
end;
$$;

create trigger change_decision_no_update
  before update or delete on change_decision
  for each row execute function change_decision_is_immutable();

-- Questions and answers between agency and client on a change. Append-only.
create table change_comment (
  id                 uuid primary key default gen_random_uuid(),
  tenant_id          uuid not null,
  change_request_id  uuid not null,
  author_id          uuid not null references app_user(id),
  author_side        text not null check (author_side in ('agency', 'client')),
  body               text not null check (length(body) between 1 and 5000),
  created_at         timestamptz not null default now(),
  foreign key (change_request_id, tenant_id) references change_request(id, tenant_id) on delete restrict
);
create index change_comment_cr_idx on change_comment(change_request_id, created_at);

create function change_comment_is_append_only() returns trigger
language plpgsql as $$
begin
  raise exception 'comments are append-only';
end;
$$;

create trigger change_comment_no_update
  before update or delete on change_comment
  for each row execute function change_comment_is_append_only();
