import { createClient } from '@supabase/supabase-js';
import { credentialStore } from './store';
import type { CredentialRecord } from './types';

export interface CredentialRepository {
  insert(record: CredentialRecord): Promise<void>;
  get(credentialId: string): Promise<CredentialRecord | undefined>;
  list(workspaceId: string): Promise<CredentialRecord[]>;
  update(record: CredentialRecord): Promise<void>;
  touchActive(credentialId: string, usedAt: string): Promise<boolean>;
  rotate(existingCredentialId: string, replacement: CredentialRecord, revokedAt: string): Promise<boolean>;
}

const memoryRepository: CredentialRepository = {
  async insert(record) { credentialStore.insert(record); },
  async get(id) { return credentialStore.get(id); },
  async list(workspaceId) { return credentialStore.list(workspaceId); },
  async update(record) { credentialStore.insert(record); },
  async touchActive(id, usedAt) {
    const record = credentialStore.get(id);
    if (!record || record.revokedAt || (record.expiresAt && Date.parse(record.expiresAt) <= Date.now())) return false;
    credentialStore.insert({ ...record, lastUsedAt: usedAt });
    return true;
  },
  async rotate(id, replacement, revokedAt) {
    const existing = credentialStore.get(id);
    if (!existing || existing.workspaceId !== replacement.workspaceId || existing.revokedAt) return false;
    credentialStore.insert({ ...existing, revokedAt });
    credentialStore.insert(replacement);
    return true;
  },
};

type Row = {
  credential_id: string; workspace_id: string; name: string; environment: CredentialRecord['environment'];
  scopes: CredentialRecord['scopes']; key_prefix: string; key_digest: string; created_by: string;
  created_at: string; expires_at: string | null; revoked_at: string | null; last_used_at: string | null;
  rotated_from_credential_id: string | null;
};

function fromRow(row: Row): CredentialRecord {
  return {
    credentialId: row.credential_id, workspaceId: row.workspace_id, name: row.name,
    environment: row.environment, scopes: row.scopes, keyPrefix: row.key_prefix,
    keyDigest: row.key_digest, createdBy: row.created_by, createdAt: row.created_at,
    expiresAt: row.expires_at, revokedAt: row.revoked_at, lastUsedAt: row.last_used_at,
    rotatedFromCredentialId: row.rotated_from_credential_id,
  };
}

function toRow(record: CredentialRecord): Row {
  return {
    credential_id: record.credentialId, workspace_id: record.workspaceId, name: record.name,
    environment: record.environment, scopes: record.scopes, key_prefix: record.keyPrefix,
    key_digest: record.keyDigest, created_by: record.createdBy, created_at: record.createdAt,
    expires_at: record.expiresAt, revoked_at: record.revokedAt, last_used_at: record.lastUsedAt,
    rotated_from_credential_id: record.rotatedFromCredentialId,
  };
}

function supabaseRepository(): CredentialRepository | null {
  if (process.env.NODE_ENV === 'test') return null;
  const url = process.env.SUPABASE_URL;
  const secret = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !secret) return null;
  const client = createClient(url, secret, { auth: { persistSession: false, autoRefreshToken: false } });
  return {
    async insert(record) {
      const { error } = await client.from('codlok_product_credentials').insert(toRow(record));
      if (error) throw new Error('CREDENTIAL_PERSISTENCE_FAILED');
    },
    async get(id) {
      const { data, error } = await client.from('codlok_product_credentials').select('*').eq('credential_id', id).maybeSingle();
      if (error) throw new Error('CREDENTIAL_LOOKUP_FAILED');
      return data ? fromRow(data as Row) : undefined;
    },
    async list(workspaceId) {
      const { data, error } = await client.from('codlok_product_credentials').select('*').eq('workspace_id', workspaceId).order('created_at', { ascending: false });
      if (error) throw new Error('CREDENTIAL_LIST_FAILED');
      return (data as Row[]).map(fromRow);
    },
    async update(record) {
      const { error } = await client.from('codlok_product_credentials').update(toRow(record)).eq('credential_id', record.credentialId).eq('workspace_id', record.workspaceId);
      if (error) throw new Error('CREDENTIAL_UPDATE_FAILED');
    },
    async touchActive(id, usedAt) {
      const { data, error } = await client.rpc('codlok_touch_active_product_credential', {
        p_credential_id: id,
        p_used_at: usedAt,
      });
      if (error) throw new Error('CREDENTIAL_UPDATE_FAILED');
      return data === true;
    },
    async rotate(id, replacement, revokedAt) {
      const { data, error } = await client.rpc('codlok_rotate_product_credential', {
        p_existing_credential_id: id,
        p_replacement: toRow(replacement),
        p_revoked_at: revokedAt,
      });
      if (error) throw new Error('ROTATION_FAILED');
      return data === true;
    },
  };
}

export function getCredentialRepository(): CredentialRepository {
  const durable = supabaseRepository();
  if (durable) return durable;
  if (process.env.NODE_ENV === 'production') throw new Error('CREDENTIAL_STORE_NOT_CONFIGURED');
  return memoryRepository;
}
