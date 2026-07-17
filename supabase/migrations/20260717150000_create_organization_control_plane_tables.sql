create table if not exists public.codlok_workspaces (
  id text primary key, name text not null, slug text not null,
  description text, created_by_user_id text not null,
  created_at timestamptz not null, updated_at timestamptz not null,
  deleted_at timestamptz
);
create unique index if not exists codlok_workspaces_active_slug_key
  on public.codlok_workspaces (lower(slug)) where deleted_at is null;

create table if not exists public.codlok_workspace_roles (
  id text primary key, workspace_id text not null references public.codlok_workspaces(id) on delete cascade,
  name text not null, system_key text check (system_key in ('owner','admin','member')),
  description text, permissions text[] not null default '{}', built_in boolean not null default false,
  created_at timestamptz not null, updated_at timestamptz not null,
  unique (workspace_id, name), unique (workspace_id, system_key)
);

create table if not exists public.codlok_workspace_members (
  id text primary key, workspace_id text not null references public.codlok_workspaces(id) on delete cascade,
  user_id text not null, role_id text not null references public.codlok_workspace_roles(id),
  joined_at timestamptz not null, created_at timestamptz not null, updated_at timestamptz not null,
  unique (workspace_id, user_id)
);
create index if not exists codlok_workspace_members_user_idx on public.codlok_workspace_members(user_id);

create table if not exists public.codlok_workspace_invitations (
  id text primary key, workspace_id text not null references public.codlok_workspaces(id) on delete cascade,
  invitee_user_id text not null, inviter_user_id text not null,
  role_id text not null references public.codlok_workspace_roles(id),
  status text not null check (status in ('pending','accepted','declined','cancelled','expired')),
  token text not null unique, created_at timestamptz not null, expires_at timestamptz not null,
  resolved_at timestamptz
);

create table if not exists public.codlok_organization_audit (
  id text primary key, workspace_id text not null,
  action text not null, actor_user_id text not null,
  occurred_at timestamptz not null, details jsonb not null default '{}'::jsonb
);
create index if not exists codlok_organization_audit_workspace_time_idx
  on public.codlok_organization_audit(workspace_id, occurred_at desc);

alter table public.codlok_workspaces enable row level security;
alter table public.codlok_workspace_roles enable row level security;
alter table public.codlok_workspace_members enable row level security;
alter table public.codlok_workspace_invitations enable row level security;
alter table public.codlok_organization_audit enable row level security;
alter table public.codlok_workspaces force row level security;
alter table public.codlok_workspace_roles force row level security;
alter table public.codlok_workspace_members force row level security;
alter table public.codlok_workspace_invitations force row level security;
alter table public.codlok_organization_audit force row level security;

revoke all on public.codlok_workspaces, public.codlok_workspace_roles,
  public.codlok_workspace_members, public.codlok_workspace_invitations,
  public.codlok_organization_audit from anon, authenticated;
grant select, insert, update, delete on public.codlok_workspaces,
  public.codlok_workspace_roles, public.codlok_workspace_members,
  public.codlok_workspace_invitations to service_role;
grant select, insert on public.codlok_organization_audit to service_role;

create or replace function public.codlok_prevent_organization_audit_changes()
returns trigger language plpgsql as $$ begin
  raise exception 'organization audit entries are append-only';
end $$;
drop trigger if exists codlok_organization_audit_no_update on public.codlok_organization_audit;
create trigger codlok_organization_audit_no_update before update or delete
  on public.codlok_organization_audit for each row execute function public.codlok_prevent_organization_audit_changes();
alter function public.codlok_prevent_organization_audit_changes() set search_path = pg_catalog;
