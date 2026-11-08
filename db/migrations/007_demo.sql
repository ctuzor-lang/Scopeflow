-- Public demo: each visitor gets a short-lived sandbox workspace (tenant). Real tenants have null here.
alter table tenant add column sandbox_expires_at timestamptz;
alter table tenant add column sandbox_ip_hash text;
create index tenant_sandbox_idx on tenant (sandbox_expires_at) where sandbox_expires_at is not null;
