import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { store } from './store';
import type { AuditLogEntry, FeatureFlagRecord, SecretRecord, SettingRecord } from './types';

type ConfigKind = 'secret' | 'setting' | 'feature_flag';
type Environment = 'development' | 'staging' | 'production';

function environment(): Environment {
  const configured = process.env.CODELOK_ENVIRONMENT;
  if (configured === 'development' || configured === 'staging' || configured === 'production') return configured;
  return process.env.NODE_ENV === 'production' ? 'production' : 'development';
}

function database(): SupabaseClient | null {
  if (process.env.NODE_ENV === 'test') return null;
  const url = process.env.SUPABASE_URL;
  const secret = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !secret) return null;
  return createClient(url, secret, { auth: { persistSession: false, autoRefreshToken: false } });
}

function requireConfigured(db: SupabaseClient | null): void {
  if (!db && process.env.NODE_ENV === 'production') throw new Error('CONFIGURATION_STORE_NOT_CONFIGURED');
}

function secretFromRow(row: Record<string, unknown>): SecretRecord {
  const payload = row.value as SecretRecord['encrypted'];
  return { encrypted: payload, version: Number(row.version), updatedBy: String(row.updated_by), updatedAt: String(row.updated_at) };
}

function plainFromRow(row: Record<string, unknown>): SettingRecord {
  const payload = row.value as { value: string };
  return { key: String(row.key), value: payload.value, version: Number(row.version), updatedBy: String(row.updated_by), updatedAt: String(row.updated_at) };
}

async function getRow(db: SupabaseClient, workspaceId: string, kind: ConfigKind, key: string): Promise<Record<string, unknown> | undefined> {
  const result = await db.from('codlok_configuration_values').select('*')
    .eq('workspace_id', workspaceId).eq('environment', environment()).eq('kind', kind).eq('key', key).maybeSingle();
  if (result.error) throw new Error('CONFIGURATION_STATE_LOAD_FAILED');
  return result.data as Record<string, unknown> | undefined;
}

async function setRow(db: SupabaseClient, workspaceId: string, kind: ConfigKind, key: string, value: unknown, updatedBy: string): Promise<{ version: number; updatedAt: string }> {
  const result = await db.rpc('codlok_set_configuration_value', {
    p_workspace_id: workspaceId, p_environment: environment(), p_kind: kind,
    p_key: key, p_value: value, p_updated_by: updatedBy,
  });
  if (result.error || !result.data?.[0]) throw new Error('CONFIGURATION_STATE_SAVE_FAILED');
  return { version: Number(result.data[0].version), updatedAt: String(result.data[0].updated_at) };
}

async function deleteRow(db: SupabaseClient, workspaceId: string, kind: ConfigKind, key: string): Promise<boolean> {
  const result = await db.from('codlok_configuration_values').delete().eq('workspace_id', workspaceId)
    .eq('environment', environment()).eq('kind', kind).eq('key', key).select('key');
  if (result.error) throw new Error('CONFIGURATION_STATE_DELETE_FAILED');
  return (result.data?.length ?? 0) === 1;
}

export const configurationRepository = {
  async getSecret(workspaceId: string, key: string): Promise<SecretRecord | undefined> {
    const db = database(); requireConfigured(db);
    if (!db) return store.getSecret(workspaceId, key);
    const row = await getRow(db, workspaceId, 'secret', key);
    return row ? secretFromRow(row) : undefined;
  },
  async setSecret(workspaceId: string, key: string, encrypted: SecretRecord['encrypted'], updatedBy: string): Promise<SecretRecord> {
    const db = database(); requireConfigured(db);
    if (!db) {
      const record = { encrypted, version: store.nextVersion(workspaceId, key), updatedBy, updatedAt: new Date().toISOString() };
      store.setSecret(workspaceId, key, record); return record;
    }
    const saved = await setRow(db, workspaceId, 'secret', key, encrypted, updatedBy);
    return { encrypted, version: saved.version, updatedBy, updatedAt: saved.updatedAt };
  },
  async deleteSecret(workspaceId: string, key: string): Promise<boolean> {
    const db = database(); requireConfigured(db);
    if (!db) return !!store.deleteSecret(workspaceId, key);
    return deleteRow(db, workspaceId, 'secret', key);
  },
  async listSecretKeys(workspaceId: string): Promise<string[]> {
    const db = database(); requireConfigured(db);
    if (!db) return store.listSecretKeys(workspaceId);
    const result = await db.from('codlok_configuration_values').select('key').eq('workspace_id', workspaceId)
      .eq('environment', environment()).eq('kind', 'secret');
    if (result.error) throw new Error('CONFIGURATION_STATE_LOAD_FAILED');
    return (result.data ?? []).map((row) => String(row.key));
  },
  async getSetting(workspaceId: string, key: string): Promise<SettingRecord | undefined> {
    const db = database(); requireConfigured(db); if (!db) return store.getSetting(workspaceId, key);
    const row = await getRow(db, workspaceId, 'setting', key); return row ? plainFromRow(row) : undefined;
  },
  async setSetting(workspaceId: string, key: string, value: string, updatedBy: string): Promise<SettingRecord> {
    const db = database(); requireConfigured(db);
    if (!db) { const record = { key, value, version: store.nextSettingVersion(workspaceId, key), updatedBy, updatedAt: new Date().toISOString() }; store.setSetting(workspaceId, key, record); return record; }
    const saved = await setRow(db, workspaceId, 'setting', key, { value }, updatedBy);
    return { key, value, version: saved.version, updatedBy, updatedAt: saved.updatedAt };
  },
  async deleteSetting(workspaceId: string, key: string): Promise<boolean> {
    const db = database(); requireConfigured(db); if (!db) return !!store.deleteSetting(workspaceId, key);
    return deleteRow(db, workspaceId, 'setting', key);
  },
  async getFeatureFlag(workspaceId: string, key: string): Promise<FeatureFlagRecord | undefined> {
    const db = database(); requireConfigured(db); if (!db) return store.getFeatureFlag(workspaceId, key);
    const row = await getRow(db, workspaceId, 'feature_flag', key); return row ? plainFromRow(row) : undefined;
  },
  async setFeatureFlag(workspaceId: string, key: string, value: string, updatedBy: string): Promise<FeatureFlagRecord> {
    const db = database(); requireConfigured(db);
    if (!db) { const record = { key, value, version: store.nextFlagVersion(workspaceId, key), updatedBy, updatedAt: new Date().toISOString() }; store.setFeatureFlag(workspaceId, key, record); return record; }
    const saved = await setRow(db, workspaceId, 'feature_flag', key, { value }, updatedBy);
    return { key, value, version: saved.version, updatedBy, updatedAt: saved.updatedAt };
  },
  async appendAudit(entry: Omit<AuditLogEntry, 'id'>): Promise<void> {
    const db = database(); requireConfigured(db);
    if (!db) return store.appendAudit(entry);
    const result = await db.from('codlok_configuration_audit').insert({ workspace_id: entry.workspaceId, environment: environment(), module: entry.module, key: entry.key, occurred_at: entry.at, success: entry.success, error_code: entry.errorCode ?? null });
    if (result.error) throw new Error('CONFIGURATION_AUDIT_SAVE_FAILED');
  },
  async listAudit(workspaceId: string, limit: number): Promise<AuditLogEntry[]> {
    const db = database(); requireConfigured(db); if (!db) return store.listAudit(workspaceId, limit);
    const result = await db.from('codlok_configuration_audit').select('*').eq('workspace_id', workspaceId)
      .eq('environment', environment()).order('occurred_at', { ascending: false }).limit(limit);
    if (result.error) throw new Error('CONFIGURATION_AUDIT_LOAD_FAILED');
    return (result.data ?? []).map((row) => ({ id: String(row.id), module: String(row.module), workspaceId: String(row.workspace_id), key: String(row.key), at: String(row.occurred_at), success: Boolean(row.success), errorCode: row.error_code == null ? undefined : String(row.error_code) }));
  },
};
