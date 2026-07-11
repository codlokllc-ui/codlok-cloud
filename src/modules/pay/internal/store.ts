/**
 * Codlok Cloud — Pay Module — In-Memory Store (INTERNAL)
 *
 * Backing store for Pay v1.0. Uses globalThis for Next.js dev-mode module
 * identity consistency. In a future phase, this will be replaced with a
 * persistent database per §3.5.
 *
 * Per §19:
 *   - Payments are workspace-scoped (line 913).
 *   - Financial facts immutable after createPayment succeeds (§3.12).
 *   - Webhook events deduplicated by provider event ID (line 908).
 *
 * This file is INTERNAL to the Pay module.
 */

import type {
  PaymentRecord,
  RefundRecord,
  WebhookEventRecord,
  PaymentStatus,
} from './types';

// ---------------------------------------------------------------------------
// Store shape
// ---------------------------------------------------------------------------

interface PayStore {
  /** paymentId → PaymentRecord */
  payments: Map<string, PaymentRecord>;
  /** workspaceId → Set<paymentId> */
  paymentsByWorkspace: Map<string, Set<string>>;
  /** refundId → RefundRecord */
  refunds: Map<string, RefundRecord>;
  /** paymentId → refundId[] (for listRefunds) */
  refundsByPayment: Map<string, string[]>;
  /** Idempotency index: `${workspaceId}:${idempotencyKey}` → paymentId */
  paymentIdempotencyIndex: Map<string, string>;
  /** Refund idempotency index: `${workspaceId}:${paymentId}:${idempotencyKey}` → refundId */
  refundIdempotencyIndex: Map<string, string>;
  /** Webhook event log: `${provider}:${providerEventId}` → WebhookEventRecord */
  webhookEvents: Map<string, WebhookEventRecord>;
}

// ---------------------------------------------------------------------------
// globalThis singleton
// ---------------------------------------------------------------------------

const STORE_KEY = Symbol.for('codlok.pay.store.v1');

function _getStore(): PayStore {
  const g = globalThis as Record<symbol, unknown>;
  if (!g[STORE_KEY]) {
    g[STORE_KEY] = _createFreshStore();
  }
  return g[STORE_KEY] as PayStore;
}

function _createFreshStore(): PayStore {
  return {
    payments: new Map(),
    paymentsByWorkspace: new Map(),
    refunds: new Map(),
    refundsByPayment: new Map(),
    paymentIdempotencyIndex: new Map(),
    refundIdempotencyIndex: new Map(),
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

export function newPaymentId(): string {
  return _newId('pay');
}

export function newRefundId(): string {
  return _newId('rfnd');
}

// ---------------------------------------------------------------------------
// Store operations
// ---------------------------------------------------------------------------

export const store = {
  // ── Payments ─────────────────────────────────────────────────────────
  insertPayment(record: PaymentRecord): void {
    _getStore().payments.set(record.paymentId, record);
    _ensure(_getStore().paymentsByWorkspace, record.workspaceId).add(record.paymentId);
    _getStore().paymentIdempotencyIndex.set(
      `${record.workspaceId}:${record.idempotencyKey}`,
      record.paymentId
    );
  },
  getByPaymentId(paymentId: string): PaymentRecord | undefined {
    return _getStore().payments.get(paymentId);
  },
  getByPaymentIdAndWorkspace(paymentId: string, workspaceId: string): PaymentRecord | undefined {
    const record = _getStore().payments.get(paymentId);
    if (!record) return undefined;
    if (record.workspaceId !== workspaceId) return undefined; // §19: cross-workspace → not found
    return record;
  },
  findByPaymentIdempotencyKey(workspaceId: string, idempotencyKey: string): PaymentRecord | undefined {
    const paymentId = _getStore().paymentIdempotencyIndex.get(
      `${workspaceId}:${idempotencyKey}`
    );
    if (!paymentId) return undefined;
    return _getStore().payments.get(paymentId);
  },
  updatePaymentStatus(
    paymentId: string,
    status: PaymentStatus,
    extra?: Partial<PaymentRecord>
  ): void {
    const record = _getStore().payments.get(paymentId);
    if (!record) return;
    record.status = status;
    record.updatedAt = new Date().toISOString();
    if (extra) {
      Object.assign(record, extra);
    }
  },
  addRefundedAmount(paymentId: string, amountMinorUnits: number): void {
    const record = _getStore().payments.get(paymentId);
    if (!record) return;
    record.refundedAmountMinorUnits += amountMinorUnits;
  },

  // ── Refunds ──────────────────────────────────────────────────────────
  insertRefund(record: RefundRecord): void {
    _getStore().refunds.set(record.refundId, record);
    const list = _getStore().refundsByPayment.get(record.paymentId) ?? [];
    list.push(record.refundId);
    _getStore().refundsByPayment.set(record.paymentId, list);
    _getStore().refundIdempotencyIndex.set(
      `${record.workspaceId}:${record.paymentId}:${record.idempotencyKey}`,
      record.refundId
    );
  },
  getByRefundId(refundId: string): RefundRecord | undefined {
    return _getStore().refunds.get(refundId);
  },
  findByRefundIdempotencyKey(
    workspaceId: string,
    paymentId: string,
    idempotencyKey: string
  ): RefundRecord | undefined {
    const refundId = _getStore().refundIdempotencyIndex.get(
      `${workspaceId}:${paymentId}:${idempotencyKey}`
    );
    if (!refundId) return undefined;
    return _getStore().refunds.get(refundId);
  },
  listRefundsByPayment(paymentId: string): RefundRecord[] {
    const ids = _getStore().refundsByPayment.get(paymentId) ?? [];
    return ids.map((id) => _getStore().refunds.get(id)).filter((r): r is RefundRecord => !!r);
  },
  updateRefundStatus(
    refundId: string,
    status: RefundRecord['status'],
    extra?: Partial<RefundRecord>
  ): void {
    const record = _getStore().refunds.get(refundId);
    if (!record) return;
    record.status = status;
    record.updatedAt = new Date().toISOString();
    if (extra) {
      Object.assign(record, extra);
    }
  },

  // ── Webhook event log (deduplication) ────────────────────────────────
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
