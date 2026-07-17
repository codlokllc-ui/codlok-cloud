create table if not exists public.codlok_gateway_usage_windows (
  credential_id text not null references public.codlok_product_credentials(credential_id),
  workspace_id text not null,
  window_start timestamptz not null,
  request_count integer not null default 0 check (request_count >= 0),
  primary key (credential_id, window_start)
);
create index if not exists codlok_gateway_usage_workspace_idx on public.codlok_gateway_usage_windows (workspace_id, window_start desc);
alter table public.codlok_gateway_usage_windows enable row level security;
alter table public.codlok_gateway_usage_windows force row level security;
revoke all on public.codlok_gateway_usage_windows from anon, authenticated;
grant all on public.codlok_gateway_usage_windows to service_role;

create table if not exists public.codlok_audit_events (
  event_id uuid primary key default gen_random_uuid(), workspace_id text not null, credential_id text,
  event_type text not null, outcome text not null check (outcome in ('allowed','denied','error')),
  metadata jsonb not null default '{}'::jsonb, occurred_at timestamptz not null default now()
);
create index if not exists codlok_audit_events_workspace_idx on public.codlok_audit_events (workspace_id, occurred_at desc);
alter table public.codlok_audit_events enable row level security;
alter table public.codlok_audit_events force row level security;
revoke all on public.codlok_audit_events from anon, authenticated;
grant select, insert on public.codlok_audit_events to service_role;
revoke update, delete, truncate on public.codlok_audit_events from service_role;

create or replace function public.codlok_consume_gateway_quota(p_credential_id text, p_workspace_id text, p_limit integer)
returns table (allowed boolean, current_count integer, reset_at timestamptz)
language plpgsql security invoker set search_path = '' as $$
declare v_window timestamptz := date_trunc('minute', now()); v_count integer;
begin
  insert into public.codlok_gateway_usage_windows (credential_id, workspace_id, window_start, request_count)
  values (p_credential_id, p_workspace_id, v_window, 1)
  on conflict (credential_id, window_start) do update
  set request_count = public.codlok_gateway_usage_windows.request_count + 1
  returning request_count into v_count;
  return query select v_count <= p_limit, v_count, v_window + interval '1 minute';
end; $$;
revoke all on function public.codlok_consume_gateway_quota(text,text,integer) from public, anon, authenticated;
grant execute on function public.codlok_consume_gateway_quota(text,text,integer) to service_role;
