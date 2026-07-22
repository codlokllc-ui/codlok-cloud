alter table public.codlok_data_plane_idempotency
  alter column environment set default 'staging';
alter table public.codlok_audit_events
  alter column environment set default 'staging';

create function public.codlok_consume_gateway_quota(
  p_credential_id text, p_workspace_id text, p_limit integer
) returns table (allowed boolean, current_count integer, reset_at timestamptz)
language plpgsql security invoker set search_path = '' as $$
declare v_environment text;
begin
  select environment into v_environment
  from public.codlok_product_credentials
  where credential_id = p_credential_id and workspace_id = p_workspace_id;
  if v_environment is null then raise exception 'GATEWAY_CREDENTIAL_AUTHORITY_MISMATCH'; end if;
  return query select * from public.codlok_consume_gateway_quota(
    p_credential_id, p_workspace_id, v_environment, p_limit
  );
end; $$;

revoke all on function public.codlok_consume_gateway_quota(text,text,integer)
  from public,anon,authenticated;
grant execute on function public.codlok_consume_gateway_quota(text,text,integer)
  to service_role;
