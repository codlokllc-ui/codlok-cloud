create table if not exists public.codlok_storage_files (
  file_id text primary key,
  upload_id text not null unique,
  workspace_id text not null references public.codlok_workspaces(id) on delete cascade,
  mime_type text not null,
  expected_size_bytes bigint not null check (expected_size_bytes > 0),
  expected_checksum text not null check (expected_checksum ~ '^[a-f0-9]{64}$'),
  actual_checksum text,
  actual_size_bytes bigint,
  state text not null check (state in ('PENDING','UPLOADING','UPLOADED','DELETED','FAILED')),
  provider text not null,
  bucket text not null,
  object_key text not null,
  created_at timestamptz not null,
  updated_at timestamptz not null,
  uploaded_at timestamptz,
  deleted_at timestamptz,
  expired_at timestamptz,
  upload_ttl_expires_at timestamptz,
  physical_deletion_status text check (physical_deletion_status in ('pending','in_progress','completed','failed')),
  physical_deletion_retry_count integer check (physical_deletion_retry_count >= 0),
  unique (workspace_id, object_key)
);
create index if not exists codlok_storage_files_workspace_created_idx
  on public.codlok_storage_files(workspace_id, created_at, file_id);
create index if not exists codlok_storage_files_cleanup_idx
  on public.codlok_storage_files(state, upload_ttl_expires_at)
  where state in ('PENDING','UPLOADING');

create table if not exists public.codlok_data_plane_idempotency (
  workspace_id text not null references public.codlok_workspaces(id) on delete cascade,
  operation text not null,
  idempotency_key_hash text not null check (idempotency_key_hash ~ '^[a-f0-9]{64}$'),
  request_digest text not null,
  response_status integer,
  response_body jsonb,
  state text not null check (state in ('started','completed','failed')),
  created_at timestamptz not null default now(),
  expires_at timestamptz not null,
  primary key (workspace_id, operation, idempotency_key_hash)
);
create index if not exists codlok_data_plane_idempotency_expiry_idx
  on public.codlok_data_plane_idempotency(expires_at);

alter table public.codlok_storage_files enable row level security;
alter table public.codlok_storage_files force row level security;
alter table public.codlok_data_plane_idempotency enable row level security;
alter table public.codlok_data_plane_idempotency force row level security;
revoke all on public.codlok_storage_files, public.codlok_data_plane_idempotency from anon, authenticated;
grant select, insert, update on public.codlok_storage_files, public.codlok_data_plane_idempotency to service_role;
revoke delete, truncate on public.codlok_storage_files from service_role;
grant delete on public.codlok_data_plane_idempotency to service_role;

comment on table public.codlok_storage_files is
  'Durable infrastructure-only Storage metadata. Contains no product business references.';
comment on table public.codlok_data_plane_idempotency is
  'Server-only replay records for product write operations; request payloads are represented only by digests.';
