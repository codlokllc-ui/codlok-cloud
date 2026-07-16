/**
 * Codlok Cloud — Mail Module — In-Memory Store (INTERNAL)
 *
 * Backing store for Mail v1.0. Uses globalThis for Next.js dev-mode module
 * identity consistency. In a future phase, this will be replaced with a
 * persistent database per §3.5.
 *
 * Per §17:
 *   - Messages are workspace-scoped (line 697).
 *   - Idempotency: workspaceId + idempotencyKey within window (line 678).
 *   - Delivery status tracked for getDeliveryStatus (line 680).
 *
 * This file is INTERNAL to the Mail module.
 */

import type { MessageRecord, OutboxEntry, DeliveryStatus } from './types';

// ---------------------------------------------------------------------------
// Store shape
// ---------------------------------------------------------------------------

interface MailStore {
  /** messageId → MessageRecord */
  messages: Map<string, MessageRecord>;
  /** workspaceId → Set<messageId> (for workspace-scoped queries) */
  messagesByWorkspace: Map<string, Set<string>>;
  /** Idempotency index: `${workspaceId}:${idempotencyKey}` → messageId */
  idempotencyIndex: Map<string, string>;
  /** Test-only outbox (preserved from provisional stub). */
  outbox: OutboxEntry[];
}

// ---------------------------------------------------------------------------
// globalThis singleton
// ---------------------------------------------------------------------------

const STORE_KEY = Symbol.for('codlok.mail.store.v1');

function _getStore(): MailStore {
  const g = globalThis as Record<symbol, unknown>;
  if (!g[STORE_KEY]) {
    g[STORE_KEY] = _createFreshStore();
  }
  return g[STORE_KEY] as MailStore;
}

function _createFreshStore(): MailStore {
  return {
    messages: new Map(),
    messagesByWorkspace: new Map(),
    idempotencyIndex: new Map(),
    outbox: [],
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

function _newMessageId(): string {
  return `msg_${Date.now()}_${Math.random().toString(36).slice(2, 12)}`;
}

function _newOutboxId(): string {
  return `mail_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`;
}

// ---------------------------------------------------------------------------
// Store operations
// ---------------------------------------------------------------------------

export const store = {
  // ── Messages ─────────────────────────────────────────────────────────
  insert(record: MessageRecord): void {
    _getStore().messages.set(record.messageId, record);
    _ensure(_getStore().messagesByWorkspace, record.workspaceId).add(record.messageId);
  },
  get(messageId: string): MessageRecord | undefined {
    return _getStore().messages.get(messageId);
  },
  getByWorkspace(messageId: string, workspaceId: string): MessageRecord | undefined {
    const msg = _getStore().messages.get(messageId);
    if (!msg) return undefined;
    if (msg.workspaceId !== workspaceId) return undefined; // §17: cross-workspace → not found
    return msg;
  },
  updateStatus(
    messageId: string,
    status: DeliveryStatus,
    extra?: Partial<Pick<MessageRecord, 'sentAt' | 'deliveredAt' | 'failedAt' | 'lastError' | 'retryCount'>>
  ): void {
    const msg = _getStore().messages.get(messageId);
    if (!msg) return;
    msg.status = status;
    if (extra) {
      Object.assign(msg, extra);
    }
  },
  listByWorkspace(workspaceId: string): MessageRecord[] {
    const ids = _getStore().messagesByWorkspace.get(workspaceId);
    if (!ids) return [];
    return [...ids].map((id) => _getStore().messages.get(id)).filter((r): r is MessageRecord => !!r);
  },
  incrementRetry(messageId: string): void {
    const msg = _getStore().messages.get(messageId);
    if (msg) msg.retryCount++;
  },

  // ── Idempotency ──────────────────────────────────────────────────────
  findByIdempotencyKey(workspaceId: string, idempotencyKey: string): MessageRecord | undefined {
    const key = `${workspaceId}:${idempotencyKey}`;
    const messageId = _getStore().idempotencyIndex.get(key);
    if (!messageId) return undefined;
    return _getStore().messages.get(messageId);
  },
  indexIdempotency(workspaceId: string, idempotencyKey: string, messageId: string): void {
    const key = `${workspaceId}:${idempotencyKey}`;
    _getStore().idempotencyIndex.set(key, messageId);
  },

  // ── Outbox (test-only) ──────────────────────────────────────────────
  recordOutbox(entry: Omit<OutboxEntry, 'id' | 'sentAt'>): OutboxEntry {
    const full: OutboxEntry = {
      ...entry,
      id: _newOutboxId(),
      sentAt: new Date().toISOString(),
    };
    _getStore().outbox.push(full);
    // Keep outbox bounded (same as provisional stub).
    if (_getStore().outbox.length > 200) _getStore().outbox.shift();
    return full;
  },
  getOutbox(): OutboxEntry[] {
    return _getStore().outbox;
  },
  clearOutbox(): void {
    _getStore().outbox.length = 0;
  },
};

// Export the ID generator for the public interface to use.
export { _newMessageId };

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
