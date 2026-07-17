create table if not exists public.codlok_product_credentials (
  credential_id text primary key,
  workspace_id text not null,
  name text not null,
  environment text not null check (environment in ('development','staging','production')),
  scopes text[] not null check (cardinality(scopes) > 0),
  key_prefix text not null,
  key_digest text not null,
  created_by text not null,
  created_at timestamptz not null default now(),
  expires_at timestamptz,
  revoked_at timestamptz,
  last_used_at timestamptz,
  rotated_from_credential_id text references public.codlok_product_credentials(credential_id)
);
create index if not exists codlok_product_credentials_workspace_idx on public.codlok_product_credentials (workspace_id, created_at desc);
create index if not exists codlok_product_credentials_active_idx on public.codlok_product_credentials (credential_id) where revoked_at is null;
create index if not exists codlok_product_credentials_rotated_from_idx on public.codlok_product_credentials (rotated_from_credential_id);
alter table public.codlok_product_credentials enable row level security;
alter table public.codlok_product_credentials force row level security;
revoke all on table public.codlok_product_credentials from anon, authenticated;
grant all on table public.codlok_product_credentials to service_role;
