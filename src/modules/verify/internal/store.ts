/**
 * Codlok Cloud — Verify Module — In-Memory Store (INTERNAL)
 *
 * Backing store for Verify v1.0. Uses globalThis for Next.js dev-mode
 * module identity consistency. In a future phase, this will be replaced
 * with a persistent database per §3.5.
 *
 * Per §20:
 *   - Verifications are workspace-scoped (line 1016).
 *   - Verification Fact Immutability: core fields never change (line 968).
 *   - Webhook events deduplicated permanently (line 1013).
 *
 * This file is INTERNAL to the Verify module.
 */

import type {
  VerificationRecord,
  WebhookEventRecord,
  VerificationStatus,
  VerificationType,
} from './types';

// ---------------------------------------------------------------------------
// Store shape
// ---------------------------------------------------------------------------

interface VerifyStore {
  /** verificationId → VerificationRecord */
  verifications: Map<string, VerificationRecord>;
  /** workspaceId → Set<verificationId> */
  verificationsByWorkspace: Map<string, Set<string>>;
  /** Idempotency index: `${workspaceId}:${idempotencyKey}` → verificationId */
  idempotencyIndex: Map<string, string>;
  /** Webhook event log: `${provider}:${providerEventId}` → WebhookEventRecord */
  webhookEvents: Map<string, WebhookEventRecord>;
}

// ---------------------------------------------------------------------------
// globalThis singleton
// ---------------------------------------------------------------------------

const STORE_KEY = Symbol.for('codlok.verify.store.v1');

function _getStore(): VerifyStore {
  const g = globalThis as Record<symbol, unknown>;
  if (!g[STORE_KEY]) {
    g[STORE_KEY] = _createFreshStore();
  }
  return g[STORE_KEY] as VerifyStore;
}

function _createFreshStore(): VerifyStore {
  return {
    verifications: new Map(),
    verificationsByWorkspace: new Map(),
    idempotencyIndex: new Map(),
    webhookEvents: new Map(),
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

export function newVerificationId(): string {
  return _newId('ver');
}

// ---------------------------------------------------------------------------
// Store operations
// ---------------------------------------------------------------------------

export const store = {
  // ── Verifications ────────────────────────────────────────────────────
  insert(record: VerificationRecord): void {
    _getStore().verifications.set(record.verificationId, record);
    _ensure(_getStore().verificationsByWorkspace, record.workspaceId).add(record.verificationId);
    _getStore().idempotencyIndex.set(
      `${record.workspaceId}:${record.idempotencyKey}`,
      record.verificationId
    );
  },
  getByVerificationId(verificationId: string): VerificationRecord | undefined {
    return _getStore().verifications.get(verificationId);
  },
  getByVerificationIdAndWorkspace(
    verificationId: string,
    workspaceId: string
  ): VerificationRecord | undefined {
    const record = _getStore().verifications.get(verificationId);
    if (!record) return undefined;
    if (record.workspaceId !== workspaceId) return undefined; // §20: cross-workspace → not found
    return record;
  },
  findByIdempotencyKey(
    workspaceId: string,
    idempotencyKey: string
  ): VerificationRecord | undefined {
    const verificationId = _getStore().idempotencyIndex.get(
      `${workspaceId}:${idempotencyKey}`
    );
    if (!verificationId) return undefined;
    return _getStore().verifications.get(verificationId);
  },
  updateStatus(
    verificationId: string,
    status: VerificationStatus,
    extra?: Partial<VerificationRecord>
  ): void {
    const record = _getStore().verifications.get(verificationId);
    if (!record) return;
    record.status = status;
    record.updatedAt = new Date().toISOString();
    if (extra) {
      Object.assign(record, extra);
    }
  },
  listByWorkspace(
    workspaceId: string,
    filters?: { status?: VerificationStatus; verificationType?: VerificationType }
  ): VerificationRecord[] {
    const ids = _getStore().verificationsByWorkspace.get(workspaceId);
    if (!ids) return [];
    const out: VerificationRecord[] = [];
    for (const id of ids) {
      const r = _getStore().verifications.get(id);
      if (!r) continue;
      if (filters?.status && r.status !== filters.status) continue;
      if (filters?.verificationType && r.verificationType !== filters.verificationType) continue;
      out.push(r);
    }
    return out;
  },

  // ── Webhook event log (deduplication — permanent per §20 line 1013) ─
  isWebhookProcessed(provider: string, providerEventId: string): boolean {
    return _getStore().webhookEvents.has(`${provider}:${providerEventId}`);
  },
  recordWebhookEvent(entry: WebhookEventRecord): void {
    _getStore().webhookEvents.set(`${entry.provider}:${entry.providerEventId}`, entry);
  },
  getWebhookEvent(provider: string, providerEventId: string): WebhookEventRecord | undefined {
    return _getStore().webhookEvents.get(`${provider}:${providerEventId}`);
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
