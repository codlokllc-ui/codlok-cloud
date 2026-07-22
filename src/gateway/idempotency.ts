import { createHash } from 'node:crypto';
import { createClient } from '@supabase/supabase-js';
import type { CredentialEnvironment } from '@/modules/product-credentials';

const KEY_PATTERN = /^[A-Za-z0-9._:-]{8,128}$/;
const RETENTION_MS = 24 * 60 * 60 * 1000;

type StoredResponse = { status: number; body: unknown };
type Entry = { digest: string; state: 'started' | 'completed' | 'failed'; response?: StoredResponse; expiresAt: string };
type BeginResult =
  | { kind: 'acquired' }
  | { kind: 'replay'; response: StoredResponse }
  | { kind: 'conflict'; reason: 'different_request' | 'in_progress' };

const MEMORY_KEY = Symbol.for('codlok.data-plane.idempotency');
function memory(): Map<string, Entry> {
  const root = globalThis as Record<symbol, unknown>;
  if (!root[MEMORY_KEY]) root[MEMORY_KEY] = new Map<string, Entry>();
  return root[MEMORY_KEY] as Map<string, Entry>;
}

function db() {
  if (process.env.NODE_ENV === 'test') return null;
  const url = process.env.SUPABASE_URL;
  const secret = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !secret) return null;
  return createClient(url, secret, { auth: { persistSession: false, autoRefreshToken: false } });
}

function keyHash(key: string): string {
  return createHash('sha256').update(key).digest('hex');
}

function memoryId(workspaceId: string, environment: CredentialEnvironment, operation: string, key: string): string {
  return `${workspaceId}\u0000${environment}\u0000${operation}\u0000${keyHash(key)}`;
}

export function validateIdempotencyKey(value: string | null): string | null {
  const key = value?.trim() ?? '';
  return KEY_PATTERN.test(key) ? key : null;
}

export function requestDigest(operation: string, body: string): string {
  return createHash('sha256').update(operation).update('\u0000').update(body).digest('hex');
}

export async function beginIdempotentOperation(input: {
  workspaceId: string; environment: CredentialEnvironment; operation: string; key: string; digest: string;
}): Promise<BeginResult> {
  const database = db();
  if (!database) {
    if (process.env.NODE_ENV === 'production') throw new Error('IDEMPOTENCY_STORE_NOT_CONFIGURED');
    const id = memoryId(input.workspaceId, input.environment, input.operation, input.key);
    const existing = memory().get(id);
    if (!existing || existing.state === 'failed' || Date.parse(existing.expiresAt) <= Date.now()) {
      memory().set(id, { digest: input.digest, state: 'started', expiresAt: new Date(Date.now() + RETENTION_MS).toISOString() });
      return { kind: 'acquired' };
    }
    if (existing.digest !== input.digest) return { kind: 'conflict', reason: 'different_request' };
    if (existing.state === 'completed' && existing.response) return { kind: 'replay', response: existing.response };
    return { kind: 'conflict', reason: 'in_progress' };
  }

  const idempotencyKeyHash = keyHash(input.key);
  const row = {
    workspace_id: input.workspaceId, environment: input.environment, operation: input.operation, idempotency_key_hash: idempotencyKeyHash,
    request_digest: input.digest, state: 'started', expires_at: new Date(Date.now() + RETENTION_MS).toISOString(),
  };
  const inserted = await database.from('codlok_data_plane_idempotency').insert(row);
  if (!inserted.error) return { kind: 'acquired' };
  if (inserted.error.code !== '23505') throw new Error('IDEMPOTENCY_STATE_SAVE_FAILED');
  const { data, error } = await database.from('codlok_data_plane_idempotency').select('*')
    .eq('workspace_id', input.workspaceId).eq('environment', input.environment)
    .eq('operation', input.operation).eq('idempotency_key_hash', idempotencyKeyHash).single();
  if (error || !data) throw new Error('IDEMPOTENCY_STATE_LOAD_FAILED');
  if (data.request_digest !== input.digest) return { kind: 'conflict', reason: 'different_request' };
  if (data.state === 'completed') return { kind: 'replay', response: { status: data.response_status, body: data.response_body } };
  if (data.state === 'failed' || Date.parse(data.expires_at) <= Date.now()) {
    const restarted = await database.from('codlok_data_plane_idempotency').update({
      state: 'started', request_digest: input.digest, response_status: null, response_body: null,
      expires_at: new Date(Date.now() + RETENTION_MS).toISOString(),
    }).eq('workspace_id', input.workspaceId).eq('operation', input.operation)
      .eq('environment', input.environment)
      .eq('idempotency_key_hash', idempotencyKeyHash).eq('state', data.state).select('idempotency_key_hash');
    if (restarted.error) throw new Error('IDEMPOTENCY_STATE_SAVE_FAILED');
    return restarted.data?.length === 1 ? { kind: 'acquired' } : { kind: 'conflict', reason: 'in_progress' };
  }
  return { kind: 'conflict', reason: 'in_progress' };
}

export async function completeIdempotentOperation(input: {
  workspaceId: string; environment: CredentialEnvironment; operation: string; key: string; digest: string; response: StoredResponse;
}): Promise<void> {
  const database = db();
  if (!database) {
    if (process.env.NODE_ENV === 'production') throw new Error('IDEMPOTENCY_STORE_NOT_CONFIGURED');
    memory().set(memoryId(input.workspaceId, input.environment, input.operation, input.key), {
      digest: input.digest, state: 'completed', response: input.response,
      expiresAt: new Date(Date.now() + RETENTION_MS).toISOString(),
    });
    return;
  }
  const idempotencyKeyHash = keyHash(input.key);
  const { data, error } = await database.from('codlok_data_plane_idempotency').update({
    state: 'completed', response_status: input.response.status, response_body: input.response.body,
  }).eq('workspace_id', input.workspaceId).eq('operation', input.operation)
    .eq('environment', input.environment)
    .eq('idempotency_key_hash', idempotencyKeyHash).eq('request_digest', input.digest)
    .eq('state', 'started').select('idempotency_key_hash');
  if (error || data?.length !== 1) throw new Error('IDEMPOTENCY_STATE_SAVE_FAILED');
}

export async function failIdempotentOperation(input: {
  workspaceId: string; environment: CredentialEnvironment; operation: string; key: string; digest: string;
}): Promise<void> {
  const database = db();
  if (!database) {
    if (process.env.NODE_ENV !== 'production') {
      const id = memoryId(input.workspaceId, input.environment, input.operation, input.key);
      const existing = memory().get(id);
      if (existing?.digest === input.digest) existing.state = 'failed';
    }
    return;
  }
  const idempotencyKeyHash = keyHash(input.key);
  const { error } = await database.from('codlok_data_plane_idempotency').update({ state: 'failed' })
    .eq('workspace_id', input.workspaceId).eq('operation', input.operation)
    .eq('environment', input.environment)
    .eq('idempotency_key_hash', idempotencyKeyHash).eq('request_digest', input.digest).eq('state', 'started');
  if (error) throw new Error('IDEMPOTENCY_STATE_SAVE_FAILED');
}
