alter table public.codlok_product_credentials
  add constraint codlok_product_credentials_workspace_credential_environment_key
  unique (workspace_id, credential_id, environment);

alter table public.codlok_audit_events
  drop constraint codlok_audit_events_credential_workspace_fkey;

alter table public.codlok_audit_events
  add constraint codlok_audit_events_credential_authority_fkey
  foreign key (workspace_id, credential_id, environment)
  references public.codlok_product_credentials(workspace_id, credential_id, environment);
