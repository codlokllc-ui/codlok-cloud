create or replace function public.codlok_touch_active_product_credential(
  p_credential_id text,
  p_used_at timestamptz
) returns boolean
language plpgsql security invoker set search_path = '' as $$
begin
  update public.codlok_product_credentials c
  set last_used_at = p_used_at
  from public.codlok_workspaces w
  where c.credential_id = p_credential_id
    and w.id = c.workspace_id
    and w.deleted_at is null
    and c.revoked_at is null
    and (c.expires_at is null or c.expires_at > now());
  return found;
end; $$;

revoke all on function public.codlok_touch_active_product_credential(text,timestamptz)
  from public,anon,authenticated;
grant execute on function public.codlok_touch_active_product_credential(text,timestamptz)
  to service_role;
