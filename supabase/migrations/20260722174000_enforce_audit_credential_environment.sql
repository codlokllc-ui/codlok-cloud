create function public.codlok_bind_audit_credential_environment()
returns trigger
language plpgsql security invoker set search_path = '' as $$
begin
  if new.credential_id is null then
    new.credential_environment := null;
  elsif new.credential_environment is null then
    select environment into new.credential_environment
    from public.codlok_product_credentials
    where credential_id = new.credential_id and workspace_id = new.workspace_id;
  end if;
  return new;
end; $$;

create trigger codlok_audit_events_bind_credential_environment
before insert on public.codlok_audit_events
for each row execute function public.codlok_bind_audit_credential_environment();

alter table public.codlok_audit_events
  drop constraint codlok_audit_events_credential_environment_check;
alter table public.codlok_audit_events
  add constraint codlok_audit_events_credential_environment_check
  check (
    (credential_id is null and credential_environment is null)
    or (credential_id is not null and credential_environment is not null)
  );

revoke all on function public.codlok_bind_audit_credential_environment()
  from public,anon,authenticated;
