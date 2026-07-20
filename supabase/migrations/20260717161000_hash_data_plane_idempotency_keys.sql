-- Existing installations may have the original raw-key column. Hash values
-- in place before the application switches to idempotency_key_hash.
do $$
begin
  if exists (
    select 1 from information_schema.columns
    where table_schema = 'public'
      and table_name = 'codlok_data_plane_idempotency'
      and column_name = 'idempotency_key'
  ) then
    alter table public.codlok_data_plane_idempotency
      rename column idempotency_key to idempotency_key_hash;

    update public.codlok_data_plane_idempotency
      set idempotency_key_hash = encode(digest(idempotency_key_hash, 'sha256'), 'hex');
  end if;
end $$;

alter table public.codlok_data_plane_idempotency
  drop constraint if exists codlok_data_plane_idempotency_idempotency_key_hash_check;
alter table public.codlok_data_plane_idempotency
  add constraint codlok_data_plane_idempotency_idempotency_key_hash_check
  check (idempotency_key_hash ~ '^[a-f0-9]{64}$');

comment on column public.codlok_data_plane_idempotency.idempotency_key_hash is
  'SHA-256 digest of the caller-supplied replay key; the raw key is never persisted.';
