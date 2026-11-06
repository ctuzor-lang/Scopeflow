-- ScopeFlow slice 1: tenants, white-label branding, users, sign-in and audit.
-- Plain PostgreSQL 16, no extensions, so the database can move hosts unchanged.

create table tenant (
  id          uuid primary key default gen_random_uuid(),
  slug        text not null unique check (slug ~ '^[a-z0-9][a-z0-9-]{1,62}$'),
  name        text not null check (length(name) between 1 and 120),
  plan        text not null default 'pilot' check (plan in ('pilot', 'agency', 'white_label')),
  status      text not null default 'active' check (status in ('active', 'suspended')),
  created_at  timestamptz not null default now()
);

-- What a tenant's clients see: name, colour, logo, platform credit.
create table tenant_branding (
  tenant_id           uuid primary key references tenant(id) on delete cascade,
  display_name        text not null check (length(display_name) between 1 and 80),
  accent_colour       text not null default '#1b68ea' check (accent_colour ~ '^#[0-9a-f]{6}$'),
  logo_key            text,
  powered_by_visible  boolean not null default true,
  updated_at          timestamptz not null default now()
);

-- Addresses a tenant is served on. Only verified hostnames resolve to a tenant.
create table tenant_domain (
  id                  uuid primary key default gen_random_uuid(),
  tenant_id           uuid not null references tenant(id) on delete cascade,
  hostname            text not null unique check (hostname = lower(hostname) and hostname ~ '^[a-z0-9.-]+$'),
  verification_token  text not null,
  verified_at         timestamptz,
  is_primary          boolean not null default false,
  created_at          timestamptz not null default now()
);
create index tenant_domain_tenant_idx on tenant_domain(tenant_id);

create table app_user (
  id            uuid primary key default gen_random_uuid(),
  email         text not null unique check (email = lower(email) and position('@' in email) > 1),
  display_name  text,
  created_at    timestamptz not null default now()
);

-- Agency membership. Client access to individual projects arrives in a later slice.
create table membership (
  user_id     uuid not null references app_user(id) on delete cascade,
  tenant_id   uuid not null references tenant(id) on delete cascade,
  role        text not null check (role in ('admin', 'pm', 'contributor')),
  status      text not null default 'active' check (status in ('active', 'removed')),
  created_at  timestamptz not null default now(),
  primary key (user_id, tenant_id)
);
create index membership_tenant_idx on membership(tenant_id);

-- One-time sign-in codes. Only a keyed hash of the code is stored.
create table login_code (
  id           uuid primary key default gen_random_uuid(),
  tenant_id    uuid not null references tenant(id) on delete cascade,
  email        text not null,
  code_hash    text not null,
  expires_at   timestamptz not null,
  attempts     integer not null default 0,
  consumed_at  timestamptz,
  ip           text,
  created_at   timestamptz not null default now()
);
create index login_code_lookup_idx on login_code(tenant_id, email, created_at desc);

-- Sessions are bound to one tenant. Only a hash of the cookie token is stored.
create table session (
  id            uuid primary key default gen_random_uuid(),
  tenant_id     uuid not null references tenant(id) on delete cascade,
  user_id       uuid not null references app_user(id) on delete cascade,
  token_hash    text not null unique,
  created_at    timestamptz not null default now(),
  expires_at    timestamptz not null,
  last_seen_at  timestamptz not null default now(),
  revoked_at    timestamptz
);
create index session_user_idx on session(user_id);

-- Append-only audit trail. Each event carries the digest of the previous event
-- for the same tenant, so any edit or deletion breaks the chain.
create table audit_event (
  id             bigserial primary key,
  tenant_id      uuid not null references tenant(id) on delete restrict,
  actor_user_id  uuid references app_user(id),
  action         text not null,
  target         text,
  detail         jsonb not null default '{}'::jsonb,
  ip             text,
  created_at     timestamptz not null default now(),
  prev_digest    text,
  event_digest   text not null
);
create index audit_event_tenant_idx on audit_event(tenant_id, id);

create function audit_event_is_append_only() returns trigger
language plpgsql as $$
begin
  raise exception 'audit_event is append-only';
end;
$$;

create trigger audit_event_no_update
  before update or delete on audit_event
  for each row execute function audit_event_is_append_only();
