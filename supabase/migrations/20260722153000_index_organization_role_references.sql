drop index if exists public.codlok_workspace_invitations_role_idx;
drop index if exists public.codlok_workspace_members_role_idx;

create index if not exists codlok_workspace_invitations_workspace_role_idx
  on public.codlok_workspace_invitations (workspace_id, role_id);

create index if not exists codlok_workspace_members_workspace_role_idx
  on public.codlok_workspace_members (workspace_id, role_id);
