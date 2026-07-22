create table if not exists public.codlok_configuration_values (
  workspace_id text not null,
  environment text not null check (environment in ('development', 'staging', 'production')),
  kind text not null check (kind in ('secret', 'setting', 'feature_flag')),
  key text not null,
  value jsonb not null,
  version integer not null default 1 check (version > 0),
  updated_by text not null,
  updated_at timestamptz not null default now(),
  primary key (workspace_id, environment, kind, key)
);

comment on table public.codlok_configuration_values is
  'Server-only, environment-scoped Configuration authority. Secret values contain AES-256-GCM ciphertext only.';

create index if not exists codlok_configuration_values_lookup
  on public.codlok_configuration_values (workspace_id, environment, kind);

alter table public.codlok_configuration_values enable row level security;
revoke all on public.codlok_configuration_values from anon, authenticated;
grant select, insert, update, delete on public.codlok_configuration_values to service_role;

create table if not exists public.codlok_configuration_audit (
  id uuid primary key default gen_random_uuid(),
  workspace_id text not null,
  environment text not null check (environment in ('development', 'staging', 'production')),
  module text not null,
  key text not null,
  occurred_at timestamptz not null default now(),
  success boolean not null,
  error_code text null
);

comment on table public.codlok_configuration_audit is
  'Append-only metadata for Configuration secret access. Secret values are forbidden.';

create index if not exists codlok_configuration_audit_workspace_time
  on public.codlok_configuration_audit (workspace_id, environment, occurred_at desc);

alter table public.codlok_configuration_audit enable row level security;
revoke all on public.codlok_configuration_audit from anon, authenticated;
grant select, insert on public.codlok_configuration_audit to service_role;

create or replace function public.codlok_set_configuration_value(
  p_workspace_id text,
  p_environment text,
  p_kind text,
  p_key text,
  p_value jsonb,
  p_updated_by text
) returns table(version integer, updated_at timestamptz)
language sql
security definer
set search_path = public, pg_temp
as $$
  insert into public.codlok_configuration_values
    (workspace_id, environment, kind, key, value, version, updated_by, updated_at)
  values
    (p_workspace_id, p_environment, p_kind, p_key, p_value, 1, p_updated_by, now())
  on conflict (workspace_id, environment, kind, key) do update
    set value = excluded.value,
        version = codlok_configuration_values.version + 1,
        updated_by = excluded.updated_by,
        updated_at = now()
  returning codlok_configuration_values.version, codlok_configuration_values.updated_at;
$$;

revoke all on function public.codlok_set_configuration_value(text, text, text, text, jsonb, text) from public, anon, authenticated;
grant execute on function public.codlok_set_configuration_value(text, text, text, text, jsonb, text) to service_role;

create or replace function public.codlok_reject_configuration_audit_changes()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
begin
  raise exception 'codlok_configuration_audit is append-only';
end;
$$;

drop trigger if exists codlok_configuration_audit_append_only on public.codlok_configuration_audit;
create trigger codlok_configuration_audit_append_only
before update or delete on public.codlok_configuration_audit
for each row execute function public.codlok_reject_configuration_audit_changes();
