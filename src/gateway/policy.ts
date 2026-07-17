import { createClient } from '@supabase/supabase-js';
import type { CredentialEnvironment } from '@/modules/product-credentials';

export interface QuotaDecision {
  allowed: boolean;
  limit: number;
  remaining: number;
  resetAt: string;
}

const LIMITS: Record<CredentialEnvironment, number> = {
  development: 120,
  staging: 300,
  production: 600,
};

const TEST_STORE = Symbol.for('codlok.gateway.quota.test.v1');
function testWindows(): Map<string, { minute: number; count: number }> {
  const root = globalThis as Record<symbol, unknown>;
  if (!root[TEST_STORE]) root[TEST_STORE] = new Map();
  return root[TEST_STORE] as Map<string, { minute: number; count: number }>;
}

function serverClient() {
  const url = process.env.SUPABASE_URL;
  const secret = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !secret) return null;
  return createClient(url, secret, { auth: { persistSession: false, autoRefreshToken: false } });
}

export async function consumeQuota(input: {
  credentialId: string;
  workspaceId: string;
  environment: CredentialEnvironment;
}): Promise<QuotaDecision> {
  const limit = LIMITS[input.environment];
  if (process.env.NODE_ENV === 'test') {
    const minute = Math.floor(Date.now() / 60_000);
    const existing = testWindows().get(input.credentialId);
    const count = existing?.minute === minute ? existing.count + 1 : 1;
    testWindows().set(input.credentialId, { minute, count });
    return { allowed: count <= limit, limit, remaining: Math.max(0, limit - count), resetAt: new Date((minute + 1) * 60_000).toISOString() };
  }

  const client = serverClient();
  if (!client) throw new Error('GATEWAY_POLICY_NOT_CONFIGURED');
  const { data, error } = await client.rpc('codlok_consume_gateway_quota', {
    p_credential_id: input.credentialId,
    p_workspace_id: input.workspaceId,
    p_limit: limit,
  }).single();
  if (error || !data) throw new Error('QUOTA_CHECK_FAILED');
  const row = data as { allowed: boolean; current_count: number; reset_at: string };
  return { allowed: row.allowed, limit, remaining: Math.max(0, limit - row.current_count), resetAt: row.reset_at };
}

export async function writeAuditEvent(input: {
  workspaceId: string;
  credentialId: string;
  eventType: string;
  outcome: 'allowed' | 'denied' | 'error';
  metadata?: Record<string, string | number | boolean | null>;
}): Promise<void> {
  if (process.env.NODE_ENV === 'test') return;
  const client = serverClient();
  if (!client) return;
  await client.from('codlok_audit_events').insert({
    workspace_id: input.workspaceId,
    credential_id: input.credentialId,
    event_type: input.eventType,
    outcome: input.outcome,
    metadata: input.metadata ?? {},
  });
}

export function _resetGatewayPolicyForTesting(): void {
  (globalThis as Record<symbol, unknown>)[TEST_STORE] = new Map();
}
