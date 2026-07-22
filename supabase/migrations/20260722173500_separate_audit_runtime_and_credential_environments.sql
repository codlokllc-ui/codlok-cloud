alter table public.codlok_audit_events
  add column credential_environment text;
update public.codlok_audit_events a
set credential_environment = c.environment
from public.codlok_product_credentials c
where c.credential_id = a.credential_id and c.workspace_id = a.workspace_id;
alter table public.codlok_audit_events
  add constraint codlok_audit_events_credential_environment_check
  check (
    (credential_id is null and credential_environment is null)
    or credential_environment in ('development','staging','production')
  );

alter table public.codlok_audit_events
  drop constraint codlok_audit_events_credential_authority_fkey;
drop index public.codlok_audit_events_credential_authority_idx;

alter table public.codlok_audit_events
  add constraint codlok_audit_events_credential_authority_fkey
  foreign key (workspace_id, credential_id, credential_environment)
  references public.codlok_product_credentials(workspace_id, credential_id, environment);
create index codlok_audit_events_credential_authority_idx
  on public.codlok_audit_events (workspace_id, credential_id, credential_environment);
