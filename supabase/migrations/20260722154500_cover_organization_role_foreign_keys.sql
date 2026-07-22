create index if not exists codlok_workspace_invitations_role_idx
  on public.codlok_workspace_invitations (role_id);

create index if not exists codlok_workspace_members_role_idx
  on public.codlok_workspace_members (role_id);
