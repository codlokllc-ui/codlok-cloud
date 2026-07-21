create table if not exists public.codlok_platform_jobs (
  job_id text primary key,
  workspace_id text not null references public.codlok_workspaces(id) on delete cascade,
  module text not null,
  job_type text not null,
  deduplication_key text not null,
  payload jsonb not null default '{}'::jsonb,
  status text not null default 'queued'
    check (status in ('queued','running','retry_scheduled','completed','dead_letter')),
  attempt_count integer not null default 0 check (attempt_count >= 0),
  max_attempts integer not null default 5 check (max_attempts between 1 and 25),
  run_after timestamptz not null default now(),
  lease_owner text,
  lease_expires_at timestamptz,
  last_error_code text,
  replay_count integer not null default 0 check (replay_count between 0 and 5),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  claimed_at timestamptz,
  completed_at timestamptz,
  dead_lettered_at timestamptz,
  unique (workspace_id, module, job_type, deduplication_key),
  check (jsonb_typeof(payload) = 'object')
);

create index if not exists codlok_platform_jobs_claim_idx
  on public.codlok_platform_jobs (run_after, created_at, job_id)
  where status in ('queued','retry_scheduled','running');
create index if not exists codlok_platform_jobs_workspace_idx
  on public.codlok_platform_jobs (workspace_id, created_at desc, job_id);

alter table public.codlok_platform_jobs enable row level security;
alter table public.codlok_platform_jobs force row level security;
revoke all on public.codlok_platform_jobs from anon, authenticated;
grant select, insert, update on public.codlok_platform_jobs to service_role;
revoke delete, truncate on public.codlok_platform_jobs from service_role;

comment on table public.codlok_platform_jobs is
  'Server-only infrastructure job ledger. Payloads must not contain secrets or product business data.';

create or replace function public.codlok_delete_storage_file_and_enqueue(
  p_workspace_id text,
  p_file_id text,
  p_deleted_at timestamptz,
  p_job_id text
)
returns boolean
language plpgsql security invoker set search_path = '' as $$
declare
  v_file public.codlok_storage_files%rowtype;
begin
  select * into v_file
  from public.codlok_storage_files
  where workspace_id = p_workspace_id and file_id = p_file_id
  for update;

  if not found then return false; end if;

  if v_file.state <> 'DELETED' then
    update public.codlok_storage_files
    set state = 'DELETED', deleted_at = p_deleted_at,
        physical_deletion_status = 'pending', physical_deletion_retry_count = 0,
        updated_at = p_deleted_at
    where file_id = p_file_id and workspace_id = p_workspace_id;
  end if;

  if coalesce(v_file.physical_deletion_status, 'pending') <> 'completed' then
    insert into public.codlok_platform_jobs (
      job_id, workspace_id, module, job_type, deduplication_key, payload,
      status, attempt_count, max_attempts, run_after
    ) values (
      p_job_id, p_workspace_id, 'storage', 'storage.physical_delete',
      'storage-delete:' || p_file_id,
      jsonb_build_object(
        'fileId', v_file.file_id,
        'provider', v_file.provider,
        'bucket', v_file.bucket,
        'objectKey', v_file.object_key
      ),
      'queued', 0, 5, now()
    ) on conflict (workspace_id, module, job_type, deduplication_key) do nothing;
  end if;

  return true;
end; $$;

revoke all on function public.codlok_delete_storage_file_and_enqueue(text,text,timestamptz,text)
  from public, anon, authenticated;
grant execute on function public.codlok_delete_storage_file_and_enqueue(text,text,timestamptz,text)
  to service_role;

create or replace function public.codlok_claim_platform_jobs(
  p_worker_id text,
  p_module text,
  p_job_type text,
  p_limit integer default 10,
  p_per_workspace_limit integer default 2,
  p_lease_seconds integer default 60
)
returns setof public.codlok_platform_jobs
language plpgsql security invoker set search_path = '' as $$
begin
  if p_worker_id is null or length(p_worker_id) < 8 then
    raise exception 'INVALID_WORKER_ID';
  end if;
  if p_limit not between 1 and 25 or p_per_workspace_limit not between 1 and 5 then
    raise exception 'INVALID_CLAIM_LIMIT';
  end if;
  if p_lease_seconds not between 15 and 300 then
    raise exception 'INVALID_LEASE_SECONDS';
  end if;

  update public.codlok_platform_jobs
  set status = 'dead_letter', lease_owner = null, lease_expires_at = null,
      last_error_code = coalesce(last_error_code, 'LEASE_EXPIRED'),
      dead_lettered_at = now(), updated_at = now()
  where module = p_module and job_type = p_job_type and status = 'running'
    and lease_expires_at <= now() and attempt_count >= max_attempts;

  return query
  with ranked as (
    select job_id,
      row_number() over (
        partition by workspace_id order by run_after, created_at, job_id
      ) as workspace_rank
    from public.codlok_platform_jobs
    where module = p_module and job_type = p_job_type
      and attempt_count < max_attempts
      and (
        (status in ('queued','retry_scheduled') and run_after <= now())
        or (status = 'running' and lease_expires_at <= now())
      )
  ), locked as (
    select jobs.job_id
    from public.codlok_platform_jobs jobs
    join ranked on ranked.job_id = jobs.job_id
    where ranked.workspace_rank <= p_per_workspace_limit
    order by jobs.run_after, jobs.created_at, jobs.job_id
    for update of jobs skip locked
    limit p_limit
  )
  update public.codlok_platform_jobs jobs
  set status = 'running', attempt_count = jobs.attempt_count + 1,
      lease_owner = p_worker_id,
      lease_expires_at = now() + make_interval(secs => p_lease_seconds),
      claimed_at = now(), updated_at = now(), last_error_code = null
  from locked
  where jobs.job_id = locked.job_id
  returning jobs.*;
end; $$;

revoke all on function public.codlok_claim_platform_jobs(text,text,text,integer,integer,integer)
  from public, anon, authenticated;
grant execute on function public.codlok_claim_platform_jobs(text,text,text,integer,integer,integer)
  to service_role;

create or replace function public.codlok_fail_platform_job(
  p_job_id text,
  p_worker_id text,
  p_error_code text,
  p_run_after timestamptz
)
returns text
language plpgsql security invoker set search_path = '' as $$
declare
  v_job public.codlok_platform_jobs%rowtype;
  v_status text;
begin
  select * into v_job from public.codlok_platform_jobs
  where job_id = p_job_id and status = 'running' and lease_owner = p_worker_id
  for update;
  if not found then return null; end if;

  v_status := case when v_job.attempt_count >= v_job.max_attempts
    then 'dead_letter' else 'retry_scheduled' end;

  update public.codlok_platform_jobs
  set status = v_status, run_after = p_run_after,
      lease_owner = null, lease_expires_at = null,
      last_error_code = left(coalesce(p_error_code, 'UNKNOWN_FAILURE'), 100),
      dead_lettered_at = case when v_status = 'dead_letter' then now() else null end,
      updated_at = now()
  where job_id = p_job_id;
  return v_status;
end; $$;

revoke all on function public.codlok_fail_platform_job(text,text,text,timestamptz)
  from public, anon, authenticated;
grant execute on function public.codlok_fail_platform_job(text,text,text,timestamptz)
  to service_role;

create or replace function public.codlok_replay_platform_job(
  p_job_id text,
  p_workspace_id text,
  p_actor_user_id text,
  p_reason text
)
returns boolean
language plpgsql security invoker set search_path = '' as $$
declare
  v_job public.codlok_platform_jobs%rowtype;
begin
  if length(trim(coalesce(p_reason, ''))) < 3 or length(p_reason) > 500 then
    raise exception 'INVALID_REPLAY_REASON';
  end if;

  select * into v_job from public.codlok_platform_jobs
  where job_id = p_job_id and workspace_id = p_workspace_id
  for update;
  if not found or v_job.status <> 'dead_letter' or v_job.replay_count >= 5 then
    return false;
  end if;

  update public.codlok_platform_jobs
  set status = 'queued', attempt_count = 0, run_after = now(),
      lease_owner = null, lease_expires_at = null, last_error_code = null,
      dead_lettered_at = null, replay_count = replay_count + 1, updated_at = now()
  where job_id = p_job_id;

  insert into public.codlok_audit_events (
    workspace_id, credential_id, event_type, outcome, metadata
  ) values (
    p_workspace_id, null, 'platform.job.replayed', 'allowed',
    jsonb_build_object(
      'module', v_job.module,
      'operation', v_job.job_type,
      'reason', trim(p_reason),
      'actorUserId', p_actor_user_id
    )
  );
  return true;
end; $$;

revoke all on function public.codlok_replay_platform_job(text,text,text,text)
  from public, anon, authenticated;
grant execute on function public.codlok_replay_platform_job(text,text,text,text)
  to service_role;
