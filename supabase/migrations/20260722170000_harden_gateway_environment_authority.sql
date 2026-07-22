create table if not exists public.codlok_orphaned_product_credentials (
  archived_at timestamptz not null default now(),
  reason text not null,
  record jsonb not null
);
alter table public.codlok_orphaned_product_credentials enable row level security;
alter table public.codlok_orphaned_product_credentials force row level security;
revoke all on public.codlok_orphaned_product_credentials from public, anon, authenticated;
grant select, insert on public.codlok_orphaned_product_credentials to service_role;

insert into public.codlok_orphaned_product_credentials (reason, record)
select 'workspace_not_found', to_jsonb(c)
from public.codlok_product_credentials c
left join public.codlok_workspaces w on w.id = c.workspace_id
where w.id is null;

delete from public.codlok_product_credentials c
where not exists (select 1 from public.codlok_workspaces w where w.id = c.workspace_id);

alter table public.codlok_product_credentials
  add constraint codlok_product_credentials_workspace_fkey
  foreign key (workspace_id) references public.codlok_workspaces(id);
alter table public.codlok_product_credentials
  add constraint codlok_product_credentials_workspace_credential_key
  unique (workspace_id, credential_id);
alter table public.codlok_product_credentials
  drop constraint if exists codlok_product_credentials_rotated_from_credential_id_fkey;
alter table public.codlok_product_credentials
  add constraint codlok_product_credentials_rotation_workspace_fkey
  foreign key (workspace_id, rotated_from_credential_id)
  references public.codlok_product_credentials(workspace_id, credential_id);

create or replace function public.codlok_touch_active_product_credential(
  p_credential_id text,
  p_used_at timestamptz
) returns boolean
language plpgsql security invoker set search_path = '' as $$
begin
  update public.codlok_product_credentials
  set last_used_at = p_used_at
  where credential_id = p_credential_id
    and revoked_at is null
    and (expires_at is null or expires_at > now());
  return found;
end; $$;

create or replace function public.codlok_rotate_product_credential(
  p_existing_credential_id text,
  p_replacement jsonb,
  p_revoked_at timestamptz
) returns boolean
language plpgsql security invoker set search_path = '' as $$
declare v_existing public.codlok_product_credentials%rowtype;
begin
  select * into v_existing from public.codlok_product_credentials
  where credential_id = p_existing_credential_id for update;
  if not found or v_existing.revoked_at is not null
    or p_replacement->>'workspace_id' <> v_existing.workspace_id
    or p_replacement->>'environment' <> v_existing.environment
    or p_replacement->>'rotated_from_credential_id' <> v_existing.credential_id
  then return false; end if;

  insert into public.codlok_product_credentials (
    credential_id, workspace_id, name, environment, scopes, key_prefix,
    key_digest, created_by, created_at, expires_at, revoked_at, last_used_at,
    rotated_from_credential_id
  ) values (
    p_replacement->>'credential_id', p_replacement->>'workspace_id',
    p_replacement->>'name', p_replacement->>'environment',
    array(select jsonb_array_elements_text(p_replacement->'scopes')),
    p_replacement->>'key_prefix', p_replacement->>'key_digest',
    p_replacement->>'created_by', (p_replacement->>'created_at')::timestamptz,
    nullif(p_replacement->>'expires_at', '')::timestamptz, null, null,
    p_existing_credential_id
  );
  update public.codlok_product_credentials set revoked_at = p_revoked_at
  where credential_id = p_existing_credential_id;
  return true;
end; $$;

revoke all on function public.codlok_touch_active_product_credential(text,timestamptz) from public,anon,authenticated;
grant execute on function public.codlok_touch_active_product_credential(text,timestamptz) to service_role;
revoke all on function public.codlok_rotate_product_credential(text,jsonb,timestamptz) from public,anon,authenticated;
grant execute on function public.codlok_rotate_product_credential(text,jsonb,timestamptz) to service_role;

drop function if exists public.codlok_consume_gateway_quota(text,text,integer);
drop table public.codlok_gateway_usage_windows;
create table public.codlok_gateway_usage_windows (
  workspace_id text not null references public.codlok_workspaces(id) on delete cascade,
  environment text not null check (environment in ('development','staging','production')),
  window_start timestamptz not null,
  request_count integer not null default 0 check (request_count >= 0),
  primary key (workspace_id, environment, window_start)
);
create index codlok_gateway_usage_workspace_idx
  on public.codlok_gateway_usage_windows (workspace_id, environment, window_start desc);
alter table public.codlok_gateway_usage_windows enable row level security;
alter table public.codlok_gateway_usage_windows force row level security;
revoke all on public.codlok_gateway_usage_windows from public, anon, authenticated;
grant all on public.codlok_gateway_usage_windows to service_role;

create function public.codlok_consume_gateway_quota(
  p_credential_id text, p_workspace_id text, p_environment text, p_limit integer
) returns table (allowed boolean, current_count integer, reset_at timestamptz)
language plpgsql security invoker set search_path = '' as $$
declare v_window timestamptz := date_trunc('minute', now()); v_count integer;
begin
  if not exists (
    select 1 from public.codlok_product_credentials c
    join public.codlok_workspaces w on w.id = c.workspace_id and w.deleted_at is null
    where c.credential_id = p_credential_id and c.workspace_id = p_workspace_id
      and c.environment = p_environment and c.revoked_at is null
      and (c.expires_at is null or c.expires_at > now())
  ) then raise exception 'GATEWAY_CREDENTIAL_AUTHORITY_MISMATCH'; end if;
  insert into public.codlok_gateway_usage_windows
    (workspace_id, environment, window_start, request_count)
  values (p_workspace_id, p_environment, v_window, 1)
  on conflict (workspace_id, environment, window_start) do update
  set request_count = public.codlok_gateway_usage_windows.request_count + 1
  returning request_count into v_count;
  return query select v_count <= p_limit, v_count, v_window + interval '1 minute';
end; $$;
revoke all on function public.codlok_consume_gateway_quota(text,text,text,integer) from public,anon,authenticated;
grant execute on function public.codlok_consume_gateway_quota(text,text,text,integer) to service_role;

alter table public.codlok_data_plane_idempotency
  add column environment text;
update public.codlok_data_plane_idempotency set environment = 'staging' where environment is null;
alter table public.codlok_data_plane_idempotency
  alter column environment set not null,
  add constraint codlok_data_plane_idempotency_environment_check
  check (environment in ('development','staging','production'));
alter table public.codlok_data_plane_idempotency drop constraint codlok_data_plane_idempotency_pkey;
alter table public.codlok_data_plane_idempotency
  add primary key (workspace_id, environment, operation, idempotency_key_hash);

alter table public.codlok_audit_events add column environment text;
update public.codlok_audit_events set environment = 'staging' where environment is null;
alter table public.codlok_audit_events
  alter column environment set not null,
  add constraint codlok_audit_events_environment_check
  check (environment in ('development','staging','production')),
  add constraint codlok_audit_events_workspace_fkey
  foreign key (workspace_id) references public.codlok_workspaces(id),
  add constraint codlok_audit_events_credential_workspace_fkey
  foreign key (workspace_id, credential_id)
  references public.codlok_product_credentials(workspace_id, credential_id);
create index codlok_audit_events_workspace_environment_idx
  on public.codlok_audit_events (workspace_id, environment, occurred_at desc);

create or replace function public.codlok_replay_platform_job(
  p_job_id text, p_workspace_id text, p_actor_user_id text,
  p_reason text, p_environment text
) returns boolean
language plpgsql security invoker set search_path = '' as $$
declare v_job public.codlok_platform_jobs%rowtype;
begin
  if p_environment not in ('development','staging','production') then raise exception 'INVALID_ENVIRONMENT'; end if;
  if length(trim(coalesce(p_reason, ''))) < 3 or length(p_reason) > 500 then raise exception 'INVALID_REPLAY_REASON'; end if;
  select * into v_job from public.codlok_platform_jobs
  where job_id=p_job_id and workspace_id=p_workspace_id for update;
  if not found or v_job.status<>'dead_letter' or v_job.replay_count>=5 then return false; end if;
  update public.codlok_platform_jobs set status='queued', attempt_count=0, run_after=now(),
    lease_owner=null, lease_expires_at=null, last_error_code=null,
    dead_lettered_at=null, replay_count=replay_count+1, updated_at=now()
  where job_id=p_job_id;
  insert into public.codlok_audit_events
    (workspace_id,credential_id,environment,event_type,outcome,metadata)
  values (p_workspace_id,null,p_environment,'platform.job.replayed','allowed',
    jsonb_build_object('module',v_job.module,'operation',v_job.job_type,
      'reason',trim(p_reason),'actorUserId',p_actor_user_id));
  return true;
end; $$;
revoke all on function public.codlok_replay_platform_job(text,text,text,text,text) from public,anon,authenticated;
grant execute on function public.codlok_replay_platform_job(text,text,text,text,text) to service_role;
drop function if exists public.codlok_replay_platform_job(text,text,text,text);
