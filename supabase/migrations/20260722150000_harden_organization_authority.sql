alter table public.codlok_workspaces
  add column if not exists revision bigint not null default 1 check (revision > 0);

alter table public.codlok_workspace_roles
  add constraint codlok_workspace_roles_workspace_id_id_key unique (workspace_id, id);

alter table public.codlok_workspace_members
  add constraint codlok_workspace_members_workspace_role_fkey
  foreign key (workspace_id, role_id)
  references public.codlok_workspace_roles(workspace_id, id);

alter table public.codlok_workspace_invitations
  add constraint codlok_workspace_invitations_workspace_role_fkey
  foreign key (workspace_id, role_id)
  references public.codlok_workspace_roles(workspace_id, id);

create unique index if not exists codlok_workspace_invitations_one_pending
  on public.codlok_workspace_invitations (workspace_id, invitee_user_id)
  where status = 'pending';

create index if not exists codlok_workspace_invitations_workspace_idx
  on public.codlok_workspace_invitations (workspace_id);
create index if not exists codlok_workspace_invitations_role_idx
  on public.codlok_workspace_invitations (role_id);
create index if not exists codlok_workspace_members_role_idx
  on public.codlok_workspace_members (role_id);

create or replace function public.codlok_commit_organization_workspace(
  p_workspace_id text,
  p_expected_revision bigint,
  p_workspace jsonb,
  p_roles jsonb,
  p_members jsonb,
  p_invitations jsonb,
  p_audit_entries jsonb
) returns bigint
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_revision bigint;
begin
  select revision into v_revision
  from public.codlok_workspaces
  where id = p_workspace_id
  for update;

  if v_revision is null or v_revision <> p_expected_revision then
    raise exception 'ORGANIZATION_CONFLICT';
  end if;

  if p_workspace->>'id' <> p_workspace_id
    or exists (select 1 from jsonb_array_elements(p_roles) x where x->>'workspace_id' <> p_workspace_id)
    or exists (select 1 from jsonb_array_elements(p_members) x where x->>'workspace_id' <> p_workspace_id)
    or exists (select 1 from jsonb_array_elements(p_invitations) x where x->>'workspace_id' <> p_workspace_id)
    or exists (select 1 from jsonb_array_elements(p_audit_entries) x where x->>'workspace_id' <> p_workspace_id)
  then
    raise exception 'ORGANIZATION_CROSS_WORKSPACE_MUTATION';
  end if;

  if exists (
    select 1 from jsonb_array_elements(p_roles) x
    join public.codlok_workspace_roles r on r.id = x->>'id'
    where r.workspace_id <> p_workspace_id
  ) or exists (
    select 1 from jsonb_array_elements(p_members) x
    join public.codlok_workspace_members m on m.id = x->>'id'
    where m.workspace_id <> p_workspace_id
  ) or exists (
    select 1 from jsonb_array_elements(p_invitations) x
    join public.codlok_workspace_invitations i on i.id = x->>'id'
    where i.workspace_id <> p_workspace_id
  ) then
    raise exception 'ORGANIZATION_CROSS_WORKSPACE_ID_COLLISION';
  end if;

  update public.codlok_workspaces set
    name = p_workspace->>'name', slug = p_workspace->>'slug',
    description = nullif(p_workspace->>'description', ''),
    created_by_user_id = p_workspace->>'created_by_user_id',
    created_at = (p_workspace->>'created_at')::timestamptz,
    updated_at = (p_workspace->>'updated_at')::timestamptz,
    deleted_at = nullif(p_workspace->>'deleted_at', '')::timestamptz
  where id = p_workspace_id;

  insert into public.codlok_workspace_roles
    (id, workspace_id, name, system_key, description, permissions, built_in, created_at, updated_at)
  select x.id, x.workspace_id, x.name, x.system_key, x.description, x.permissions, x.built_in, x.created_at, x.updated_at
  from jsonb_to_recordset(p_roles) as x(
    id text, workspace_id text, name text, system_key text, description text,
    permissions text[], built_in boolean, created_at timestamptz, updated_at timestamptz)
  on conflict (id) do update set
    name=excluded.name, description=excluded.description, permissions=excluded.permissions,
    updated_at=excluded.updated_at;

  insert into public.codlok_workspace_members
    (id, workspace_id, user_id, role_id, joined_at, created_at, updated_at)
  select x.id, x.workspace_id, x.user_id, x.role_id, x.joined_at, x.created_at, x.updated_at
  from jsonb_to_recordset(p_members) as x(
    id text, workspace_id text, user_id text, role_id text,
    joined_at timestamptz, created_at timestamptz, updated_at timestamptz)
  on conflict (id) do update set role_id=excluded.role_id, updated_at=excluded.updated_at;

  insert into public.codlok_workspace_invitations
    (id, workspace_id, invitee_user_id, inviter_user_id, role_id, status, token, created_at, expires_at, resolved_at)
  select x.id, x.workspace_id, x.invitee_user_id, x.inviter_user_id, x.role_id,
    x.status, x.token, x.created_at, x.expires_at, x.resolved_at
  from jsonb_to_recordset(p_invitations) as x(
    id text, workspace_id text, invitee_user_id text, inviter_user_id text,
    role_id text, status text, token text, created_at timestamptz,
    expires_at timestamptz, resolved_at timestamptz)
  on conflict (id) do update set
    role_id=excluded.role_id, status=excluded.status, token=excluded.token,
    created_at=excluded.created_at, expires_at=excluded.expires_at,
    resolved_at=excluded.resolved_at;

  delete from public.codlok_workspace_invitations i
  where i.workspace_id = p_workspace_id
    and not exists (select 1 from jsonb_array_elements(p_invitations) x where x->>'id' = i.id);
  delete from public.codlok_workspace_members m
  where m.workspace_id = p_workspace_id
    and not exists (select 1 from jsonb_array_elements(p_members) x where x->>'id' = m.id);
  delete from public.codlok_workspace_roles r
  where r.workspace_id = p_workspace_id
    and not exists (select 1 from jsonb_array_elements(p_roles) x where x->>'id' = r.id);

  if (p_workspace->>'deleted_at') is null and not exists (
    select 1 from public.codlok_workspace_members m
    join public.codlok_workspace_roles r on r.id=m.role_id and r.workspace_id=m.workspace_id
    where m.workspace_id=p_workspace_id and r.system_key='owner'
  ) then
    raise exception 'ORGANIZATION_LAST_OWNER_REQUIRED';
  end if;

  insert into public.codlok_organization_audit
    (id, workspace_id, action, actor_user_id, occurred_at, details)
  select x.id, x.workspace_id, x.action, x.actor_user_id, x.occurred_at, x.details
  from jsonb_to_recordset(p_audit_entries) as x(
    id text, workspace_id text, action text, actor_user_id text,
    occurred_at timestamptz, details jsonb);

  update public.codlok_workspaces set revision=revision+1 where id=p_workspace_id
  returning revision into v_revision;
  return v_revision;
end;
$$;

create or replace function public.codlok_create_organization_workspace(
  p_workspace jsonb, p_roles jsonb, p_members jsonb, p_audit_entries jsonb
) returns bigint
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare v_workspace_id text := p_workspace->>'id';
begin
  if v_workspace_id is null
    or exists (select 1 from jsonb_array_elements(p_roles) x where x->>'workspace_id' <> v_workspace_id)
    or exists (select 1 from jsonb_array_elements(p_members) x where x->>'workspace_id' <> v_workspace_id)
    or exists (select 1 from jsonb_array_elements(p_audit_entries) x where x->>'workspace_id' <> v_workspace_id)
  then raise exception 'ORGANIZATION_CROSS_WORKSPACE_MUTATION'; end if;

  insert into public.codlok_workspaces
    (id,name,slug,description,created_by_user_id,created_at,updated_at,deleted_at,revision)
  values (v_workspace_id,p_workspace->>'name',p_workspace->>'slug',nullif(p_workspace->>'description',''),
    p_workspace->>'created_by_user_id',(p_workspace->>'created_at')::timestamptz,
    (p_workspace->>'updated_at')::timestamptz,null,1);

  insert into public.codlok_workspace_roles
    (id,workspace_id,name,system_key,description,permissions,built_in,created_at,updated_at)
  select x.id,x.workspace_id,x.name,x.system_key,x.description,x.permissions,x.built_in,x.created_at,x.updated_at
  from jsonb_to_recordset(p_roles) as x(id text,workspace_id text,name text,system_key text,
    description text,permissions text[],built_in boolean,created_at timestamptz,updated_at timestamptz);
  insert into public.codlok_workspace_members
    (id,workspace_id,user_id,role_id,joined_at,created_at,updated_at)
  select x.id,x.workspace_id,x.user_id,x.role_id,x.joined_at,x.created_at,x.updated_at
  from jsonb_to_recordset(p_members) as x(id text,workspace_id text,user_id text,role_id text,
    joined_at timestamptz,created_at timestamptz,updated_at timestamptz);
  insert into public.codlok_organization_audit
    (id,workspace_id,action,actor_user_id,occurred_at,details)
  select x.id,x.workspace_id,x.action,x.actor_user_id,x.occurred_at,x.details
  from jsonb_to_recordset(p_audit_entries) as x(id text,workspace_id text,action text,
    actor_user_id text,occurred_at timestamptz,details jsonb);
  return 1;
end;
$$;

revoke all on function public.codlok_commit_organization_workspace(text,bigint,jsonb,jsonb,jsonb,jsonb,jsonb) from public,anon,authenticated;
grant execute on function public.codlok_commit_organization_workspace(text,bigint,jsonb,jsonb,jsonb,jsonb,jsonb) to service_role;
revoke all on function public.codlok_create_organization_workspace(jsonb,jsonb,jsonb,jsonb) from public,anon,authenticated;
grant execute on function public.codlok_create_organization_workspace(jsonb,jsonb,jsonb,jsonb) to service_role;
