/**
 * Codlok Cloud — Notifications Module — In-Memory Store (INTERNAL)
 *
 * Backing store for Notifications v1.0. Uses globalThis for Next.js
 * dev-mode module identity consistency. In a future phase, this will
 * be replaced with a persistent database per §3.5.
 *
 * Per §21:
 *   - Notifications are workspace-scoped (line 1116).
 *   - Idempotency: permanent retention (line 1099).
 *   - Recipient data held only transiently — NOT persisted as SoR.
 *
 * This file is INTERNAL to the Notifications module.
 */

import type {
  NotificationRecord,
  WorkspacePreferences,
  OverallStatus,
} from './types';

// ---------------------------------------------------------------------------
// Store shape
// ---------------------------------------------------------------------------

interface NotificationStore {
  /** notificationId → NotificationRecord */
  notifications: Map<string, NotificationRecord>;
  /** workspaceId → Set<notificationId> */
  notificationsByWorkspace: Map<string, Set<string>>;
  /** Idempotency index: `${workspaceId}:${idempotencyKey}` → notificationId (permanent) */
  idempotencyIndex: Map<string, string>;
  /** Workspace preferences (workspace-scoped, per §21 fork #2). */
  preferences: Map<string, WorkspacePreferences>;
}

// ---------------------------------------------------------------------------
// globalThis singleton
// ---------------------------------------------------------------------------

const STORE_KEY = Symbol.for('codlok.notifications.store.v1');

function _getStore(): NotificationStore {
  const g = globalThis as Record<symbol, unknown>;
  if (!g[STORE_KEY]) {
    g[STORE_KEY] = _createFreshStore();
  }
  return g[STORE_KEY] as NotificationStore;
}

function _createFreshStore(): NotificationStore {
  return {
    notifications: new Map(),
    notificationsByWorkspace: new Map(),
    idempotencyIndex: new Map(),
    preferences: new Map(),
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

export function newNotificationId(): string {
  return _newId('notif');
}

// ---------------------------------------------------------------------------
// Store operations
// ---------------------------------------------------------------------------

export const store = {
  // ── Notifications ────────────────────────────────────────────────────
  insert(record: NotificationRecord): void {
    _getStore().notifications.set(record.notificationId, record);
    _ensure(_getStore().notificationsByWorkspace, record.workspaceId).add(record.notificationId);
    // Permanent idempotency retention (§21 line 1099).
    _getStore().idempotencyIndex.set(
      `${record.workspaceId}:${record.idempotencyKey}`,
      record.notificationId
    );
  },
  getByNotificationId(notificationId: string): NotificationRecord | undefined {
    return _getStore().notifications.get(notificationId);
  },
  getByNotificationIdAndWorkspace(
    notificationId: string,
    workspaceId: string
  ): NotificationRecord | undefined {
    const record = _getStore().notifications.get(notificationId);
    if (!record) return undefined;
    if (record.workspaceId !== workspaceId) return undefined;
    return record;
  },
  findByIdempotencyKey(
    workspaceId: string,
    idempotencyKey: string
  ): NotificationRecord | undefined {
    const notificationId = _getStore().idempotencyIndex.get(
      `${workspaceId}:${idempotencyKey}`
    );
    if (!notificationId) return undefined;
    return _getStore().notifications.get(notificationId);
  },
  updateOverallStatus(
    notificationId: string,
    status: OverallStatus,
    extra?: Partial<NotificationRecord>
  ): void {
    const record = _getStore().notifications.get(notificationId);
    if (!record) return;
    record.overallStatus = status;
    record.updatedAt = new Date().toISOString();
    if (extra) {
      Object.assign(record, extra);
    }
  },
  updateChannelResult(
    notificationId: string,
    channel: 'email' | 'sms' | 'push',
    result: { status: import('./types').ChannelStatus; messageId?: string; errorCode?: string }
  ): void {
    const record = _getStore().notifications.get(notificationId);
    if (!record) return;
    record.channels[channel] = result;
    record.updatedAt = new Date().toISOString();
  },
  listByWorkspace(
    workspaceId: string,
    filters?: {
      overallStatus?: OverallStatus;
      dateFrom?: string;
      dateTo?: string;
    }
  ): NotificationRecord[] {
    const ids = _getStore().notificationsByWorkspace.get(workspaceId);
    if (!ids) return [];
    const out: NotificationRecord[] = [];
    const fromMs = filters?.dateFrom ? new Date(filters.dateFrom).getTime() : 0;
    const toMs = filters?.dateTo ? new Date(filters.dateTo).getTime() : Infinity;
    for (const id of ids) {
      const r = _getStore().notifications.get(id);
      if (!r) continue;
      if (filters?.overallStatus && r.overallStatus !== filters.overallStatus) continue;
      const createdMs = new Date(r.createdAt).getTime();
      if (createdMs < fromMs || createdMs > toMs) continue;
      out.push(r);
    }
    return out;
  },

  // ── Preferences ──────────────────────────────────────────────────────
  getPreferences(workspaceId: string): WorkspacePreferences {
    return _getStore().preferences.get(workspaceId) ?? {
      emailEnabled: true,  // default: all channels enabled
      smsEnabled: true,
      pushEnabled: true,
    };
  },
  setPreferences(workspaceId: string, prefs: WorkspacePreferences): void {
    _getStore().preferences.set(workspaceId, prefs);
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
