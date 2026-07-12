/**
 * Codlok Cloud — SMS Module — In-Memory Store (INTERNAL)
 *
 * Backing store for SMS v1.0. Uses globalThis for Next.js dev-mode module
 * identity consistency.
 *
 * Per §22:
 *   - SMS records are workspace-scoped.
 *   - Recipient data held transiently, never in public responses.
 *   - Idempotency: permanent retention.
 *   - Webhook events deduplicated permanently.
 *
 * This file is INTERNAL to the SMS module.
 */

import type {
  SmsRecord,
  InboundEventRecord,
  WebhookEventRecord,
  SmsStatus,
} from './types';

// ---------------------------------------------------------------------------
// Store shape
// ---------------------------------------------------------------------------

interface SmsStore {
  /** smsId → SmsRecord */
  smsRecords: Map<string, SmsRecord>;
  /** workspaceId → Set<smsId> */
  smsByWorkspace: Map<string, Set<string>>;
  /** Idempotency index: `${workspaceId}:${idempotencyKey}` → smsId (permanent) */
  idempotencyIndex: Map<string, string>;
  /** providerMessageId → smsId (for webhook workspace resolution) */
  providerMessageIndex: Map<string, string>;
  /** Webhook event log: `${provider}:${providerEventId}` → record (permanent) */
  webhookEvents: Map<string, WebhookEventRecord>;
  /** Inbound event records */
  inboundEvents: InboundEventRecord[];
  /** Workspace routing: destination phone number → workspaceId (for inbound) */
  workspaceRouting: Map<string, string>;
}

// ---------------------------------------------------------------------------
// globalThis singleton
// ---------------------------------------------------------------------------

const STORE_KEY = Symbol.for('codlok.sms.store.v1');

function _getStore(): SmsStore {
  const g = globalThis as Record<symbol, unknown>;
  if (!g[STORE_KEY]) {
    g[STORE_KEY] = _createFreshStore();
  }
  return g[STORE_KEY] as SmsStore;
}

function _createFreshStore(): SmsStore {
  return {
    smsRecords: new Map(),
    smsByWorkspace: new Map(),
    idempotencyIndex: new Map(),
    providerMessageIndex: new Map(),
    webhookEvents: new Map(),
    inboundEvents: [],
    workspaceRouting: new Map(),
  };
}

/** Test-only escape hatch. Production code MUST NOT call this. */
export function _resetStoreForTesting(): void {
  const g = globalThis as Record<symbol, unknown>;
  g[STORE_KEY] = _createFreshStore();
}

// ---------------------------------------------------------------------------
// ID generators
// ---------------------------------------------------------------------------

function _newId(prefix: string): string {
  return `${prefix}_${Date.now()}_${Math.random().toString(36).slice(2, 12)}`;
}

export function newSmsId(): string {
  return _newId('sms');
}

export function newInboundEventId(): string {
  return _newId('inbound');
}

// ---------------------------------------------------------------------------
// Store operations
// ---------------------------------------------------------------------------

export const store = {
  // ── SMS records ──────────────────────────────────────────────────────
  insert(record: SmsRecord): void {
    _getStore().smsRecords.set(record.smsId, record);
    _ensure(_getStore().smsByWorkspace, record.workspaceId).add(record.smsId);
    _getStore().idempotencyIndex.set(
      `${record.workspaceId}:${record.idempotencyKey}`,
      record.smsId
    );
    if (record.providerMessageId) {
      _getStore().providerMessageIndex.set(record.providerMessageId, record.smsId);
    }
  },
  getBySmsId(smsId: string): SmsRecord | undefined {
    return _getStore().smsRecords.get(smsId);
  },
  getBySmsIdAndWorkspace(smsId: string, workspaceId: string): SmsRecord | undefined {
    const record = _getStore().smsRecords.get(smsId);
    if (!record) return undefined;
    if (record.workspaceId !== workspaceId) return undefined;
    return record;
  },
  findByIdempotencyKey(workspaceId: string, idempotencyKey: string): SmsRecord | undefined {
    const smsId = _getStore().idempotencyIndex.get(`${workspaceId}:${idempotencyKey}`);
    if (!smsId) return undefined;
    return _getStore().smsRecords.get(smsId);
  },
  findByProviderMessageId(providerMessageId: string): SmsRecord | undefined {
    const smsId = _getStore().providerMessageIndex.get(providerMessageId);
    if (!smsId) return undefined;
    return _getStore().smsRecords.get(smsId);
  },
  updateStatus(
    smsId: string,
    status: SmsStatus,
    extra?: Partial<SmsRecord>
  ): void {
    const record = _getStore().smsRecords.get(smsId);
    if (!record) return;
    record.status = status;
    record.updatedAt = new Date().toISOString();
    if (extra) {
      Object.assign(record, extra);
    }
  },
  indexProviderMessageId(providerMessageId: string, smsId: string): void {
    _getStore().providerMessageIndex.set(providerMessageId, smsId);
  },
  listByWorkspace(
    workspaceId: string,
    filters?: { status?: SmsStatus; dateFrom?: string; dateTo?: string }
  ): SmsRecord[] {
    const ids = _getStore().smsByWorkspace.get(workspaceId);
    if (!ids) return [];
    const out: SmsRecord[] = [];
    const fromMs = filters?.dateFrom ? new Date(filters.dateFrom).getTime() : 0;
    const toMs = filters?.dateTo ? new Date(filters.dateTo).getTime() : Infinity;
    for (const id of ids) {
      const r = _getStore().smsRecords.get(id);
      if (!r) continue;
      if (filters?.status && r.status !== filters.status) continue;
      const createdMs = new Date(r.createdAt).getTime();
      if (createdMs < fromMs || createdMs > toMs) continue;
      out.push(r);
    }
    return out;
  },

  // ── Webhook event log (deduplication — permanent per §22 line 1229) ─
  isWebhookProcessed(provider: string, providerEventId: string): boolean {
    return _getStore().webhookEvents.has(`${provider}:${providerEventId}`);
  },
  recordWebhookEvent(entry: WebhookEventRecord): void {
    _getStore().webhookEvents.set(`${entry.provider}:${entry.providerEventId}`, entry);
  },

  // ── Inbound events ───────────────────────────────────────────────────
  insertInboundEvent(event: InboundEventRecord): void {
    _getStore().inboundEvents.push(event);
  },
  listInboundEvents(workspaceId: string): InboundEventRecord[] {
    return _getStore().inboundEvents.filter((e) => e.workspaceId === workspaceId);
  },

  // ── Workspace routing (destination number → workspaceId for inbound) ─
  setWorkspaceRouting(destinationNumber: string, workspaceId: string): void {
    _getStore().workspaceRouting.set(destinationNumber, workspaceId);
  },
  resolveWorkspaceByDestination(destinationNumber: string): string | undefined {
    return _getStore().workspaceRouting.get(destinationNumber);
  },
};

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function _ensure<K, V>(m: Map<K, V>, key: K): V {
  let v = m.get(key);
  if (!v) {
    v = new Set<string>() as unknown as V;
    m.set(key, v);
  }
  return v;
}
