-- ScopeFlow slice 5: record which approved changes a new scope version includes (FR-016).

create table baseline_change (
  baseline_id        uuid not null references baseline(id) on delete restrict,
  change_request_id  uuid not null unique references change_request(id) on delete restrict,
  tenant_id          uuid not null references tenant(id),
  created_at         timestamptz not null default now(),
  primary key (baseline_id, change_request_id)
);

create function baseline_change_is_immutable() returns trigger
language plpgsql as $$
begin
  raise exception 'baseline content is immutable';
end;
$$;

create trigger baseline_change_no_update
  before update or delete on baseline_change
  for each row execute function baseline_change_is_immutable();
