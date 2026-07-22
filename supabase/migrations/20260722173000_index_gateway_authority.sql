alter table public.codlok_orphaned_product_credentials
  add column archive_id uuid not null default gen_random_uuid();
alter table public.codlok_orphaned_product_credentials
  add primary key (archive_id);

create index codlok_audit_events_credential_authority_idx
  on public.codlok_audit_events (workspace_id, credential_id, environment);

create index codlok_product_credentials_rotation_workspace_idx
  on public.codlok_product_credentials (workspace_id, rotated_from_credential_id);
