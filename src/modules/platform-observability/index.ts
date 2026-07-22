import { createClient } from '@supabase/supabase-js';
import { codlokEnvironment, fail, ok, type StandardResponse } from '@/shared';

export interface UsageBucket { hour: string; requests: number }
export interface UsageSummary {
  requestsLastHour: number;
  requestsLast24Hours: number;
  deniedLast24Hours: number;
  errorsLast24Hours: number;
  activeCredentialsLast24Hours: number;
  hourly: UsageBucket[];
}
export interface AuditEventView {
  eventId: string;
  credentialId: string | null;
  eventType: string;
  outcome: 'allowed' | 'denied' | 'error';
  occurredAt: string;
  metadata: Record<string, string | number | boolean | null>;
}

function client() {
  const url = process.env.SUPABASE_URL;
  const secret = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !secret) return null;
  return createClient(url, secret, { auth: { persistSession: false, autoRefreshToken: false } });
}

function safeMetadata(value: unknown): Record<string, string | number | boolean | null> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
  const allowed = new Set(['operation', 'reason', 'limit', 'scope', 'module']);
  return Object.fromEntries(Object.entries(value as Record<string, unknown>)
    .filter(([key, item]) => allowed.has(key) && (item === null || ['string', 'number', 'boolean'].includes(typeof item)))
    .map(([key, item]) => [key, item as string | number | boolean | null]));
}

export async function getUsageSummary(workspaceId: string): Promise<StandardResponse<UsageSummary>> {
  const db = client();
  if (!db) return fail('OBSERVABILITY_NOT_CONFIGURED', 'Usage reporting is not configured.');
  const now = new Date();
  const since = new Date(now.getTime() - 24 * 60 * 60_000);
  const [usage, audit, credentials] = await Promise.all([
    db.from('codlok_gateway_usage_windows').select('window_start,request_count')
      .eq('workspace_id', workspaceId).eq('environment', codlokEnvironment()).gte('window_start', since.toISOString()),
    db.from('codlok_audit_events').select('outcome').eq('workspace_id', workspaceId)
      .eq('environment', codlokEnvironment())
      .gte('occurred_at', since.toISOString()),
    db.from('codlok_product_credentials').select('credential_id').eq('workspace_id', workspaceId)
      .eq('environment', codlokEnvironment()).gte('last_used_at', since.toISOString()),
  ]);
  if (usage.error || audit.error || credentials.error) return fail('OBSERVABILITY_QUERY_FAILED', 'Usage summary could not be loaded.');
  const hours = Array.from({ length: 24 }, (_, index) => {
    const date = new Date(now.getTime() - (23 - index) * 60 * 60_000);
    date.setUTCMinutes(0, 0, 0);
    return { hour: date.toISOString(), requests: 0 };
  });
  const byHour = new Map(hours.map((bucket) => [bucket.hour, bucket]));
  let requestsLast24Hours = 0;
  let requestsLastHour = 0;
  for (const row of usage.data ?? []) {
    const count = Number(row.request_count) || 0;
    const date = new Date(row.window_start);
    date.setUTCMinutes(0, 0, 0);
    const bucket = byHour.get(date.toISOString());
    if (bucket) bucket.requests += count;
    requestsLast24Hours += count;
    if (new Date(row.window_start).getTime() >= now.getTime() - 60 * 60_000) requestsLastHour += count;
  }
  return ok({
    requestsLastHour, requestsLast24Hours,
    deniedLast24Hours: (audit.data ?? []).filter((row) => row.outcome === 'denied').length,
    errorsLast24Hours: (audit.data ?? []).filter((row) => row.outcome === 'error').length,
    activeCredentialsLast24Hours: credentials.data?.length ?? 0,
    hourly: hours,
  });
}

export async function listAuditEvents(
  workspaceId: string,
  options: { limit?: number; before?: string } = {}
): Promise<StandardResponse<{ items: AuditEventView[]; nextCursor: string | null; hasMore: boolean }>> {
  const db = client();
  if (!db) return fail('OBSERVABILITY_NOT_CONFIGURED', 'Audit reporting is not configured.');
  const limit = Math.min(100, Math.max(1, options.limit ?? 30));
  let query = db.from('codlok_audit_events')
    .select('event_id,credential_id,event_type,outcome,metadata,occurred_at')
    .eq('workspace_id', workspaceId).eq('environment', codlokEnvironment())
    .order('occurred_at', { ascending: false }).limit(limit + 1);
  if (options.before) query = query.lt('occurred_at', options.before);
  const { data, error } = await query;
  if (error) return fail('OBSERVABILITY_QUERY_FAILED', 'Audit events could not be loaded.');
  const rows = data ?? [];
  const page = rows.slice(0, limit);
  const items = page.map((row) => ({
    eventId: row.event_id, credentialId: row.credential_id, eventType: row.event_type,
    outcome: row.outcome as AuditEventView['outcome'], occurredAt: row.occurred_at,
    metadata: safeMetadata(row.metadata),
  }));
  return ok({ items, hasMore: rows.length > limit, nextCursor: rows.length > limit ? items.at(-1)?.occurredAt ?? null : null });
}

export const PlatformObservability = { getUsageSummary, listAuditEvents };
