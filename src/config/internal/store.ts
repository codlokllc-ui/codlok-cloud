/**
 * Codlok Cloud — Configuration Service — In-Memory Store (INTERNAL)
 *
 * Backing store for Configuration Service v1.0. Uses globalThis for
 * Next.js dev-mode module identity consistency. In a future phase, this
 * will be replaced with a persistent encrypted database per §3.5.
 *
 * Per §16 Mandatory Rules:
 *   - Secrets stored encrypted (encryption applied by operations.ts, not here).
 *   - Audit log records metadata only (never the value).
 *   - Versioning: version/updatedBy/updatedAt stored on each record.
 *
 * Per §16 Workspace Context: every record is scoped by workspaceId.
 * There is no global/default scope (§16 line 597).
 *
 * This file is INTERNAL to the Configuration Service.
 */

import type {
  SecretRecord,
  FeatureFlagRecord,
  SettingRecord,
  AuditLogEntry,
} from './types';

// ---------------------------------------------------------------------------
// Store shape
// ---------------------------------------------------------------------------

interface ConfigStore {
  /** workspaceId → key → SecretRecord (encrypted) */
  secrets: Map<string, Map<string, SecretRecord>>;
  /** workspaceId → key → non-secret SettingRecord */
  settings: Map<string, Map<string, SettingRecord>>;
  /** workspaceId → key → FeatureFlagRecord */
  featureFlags: Map<string, Map<string, FeatureFlagRecord>>;
  /** Audit log (append-only, capped). */
  auditLog: AuditLogEntry[];
}

// ---------------------------------------------------------------------------
// globalThis singleton
// ---------------------------------------------------------------------------

const STORE_KEY = Symbol.for('codlok.config.store');

function _getStore(): ConfigStore {
  const g = globalThis as Record<symbol, unknown>;
  if (!g[STORE_KEY]) {
    g[STORE_KEY] = _createFreshStore();
  }
  return g[STORE_KEY] as ConfigStore;
}

function _createFreshStore(): ConfigStore {
  return {
    secrets: new Map(),
    settings: new Map(),
    featureFlags: new Map(),
    auditLog: [],
  };
}

/** Test-only escape hatch. Production code MUST NOT call this. */
export function _resetStoreForTesting(): void {
  const g = globalThis as Record<symbol, unknown>;
  g[STORE_KEY] = _createFreshStore();
}

// ---------------------------------------------------------------------------
// ID generator (for audit log entries)
// ---------------------------------------------------------------------------

function _newId(prefix: string): string {
  return `${prefix}_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`;
}

// ---------------------------------------------------------------------------
// Secret operations
// ---------------------------------------------------------------------------

export const store = {
  // ── Secrets ─────────────────────────────────────────────────────────
  getSecret(workspaceId: string, key: string): SecretRecord | undefined {
    return _getStore().secrets.get(workspaceId)?.get(key);
  },
  setSecret(workspaceId: string, key: string, record: SecretRecord): void {
    let wsMap = _getStore().secrets.get(workspaceId);
    if (!wsMap) {
      wsMap = new Map();
      _getStore().secrets.set(workspaceId, wsMap);
    }
    wsMap.set(key, record);
  },
  deleteSecret(workspaceId: string, key: string): SecretRecord | undefined {
    const wsMap = _getStore().secrets.get(workspaceId);
    if (!wsMap) return undefined;
    const existing = wsMap.get(key);
    wsMap.delete(key);
    return existing;
  },
  listSecretKeys(workspaceId: string): string[] {
    const wsMap = _getStore().secrets.get(workspaceId);
    if (!wsMap) return [];
    return [...wsMap.keys()];
  },
  /** Check if a workspace has ANY configuration (secrets or flags). */
  workspaceExists(workspaceId: string): boolean {
    return (
      _getStore().secrets.has(workspaceId) ||
      _getStore().settings.has(workspaceId) ||
      _getStore().featureFlags.has(workspaceId)
    );
  },

  // ── Non-secret workspace settings ──────────────────────────────────
  getSetting(workspaceId: string, key: string): SettingRecord | undefined {
    return _getStore().settings.get(workspaceId)?.get(key);
  },
  setSetting(workspaceId: string, key: string, record: SettingRecord): void {
    let wsMap = _getStore().settings.get(workspaceId);
    if (!wsMap) {
      wsMap = new Map();
      _getStore().settings.set(workspaceId, wsMap);
    }
    wsMap.set(key, record);
  },
  deleteSetting(workspaceId: string, key: string): SettingRecord | undefined {
    const wsMap = _getStore().settings.get(workspaceId);
    if (!wsMap) return undefined;
    const existing = wsMap.get(key);
    wsMap.delete(key);
    return existing;
  },

  // ── Feature flags ───────────────────────────────────────────────────
  getFeatureFlag(workspaceId: string, key: string): FeatureFlagRecord | undefined {
    return _getStore().featureFlags.get(workspaceId)?.get(key);
  },
  setFeatureFlag(workspaceId: string, key: string, record: FeatureFlagRecord): void {
    let wsMap = _getStore().featureFlags.get(workspaceId);
    if (!wsMap) {
      wsMap = new Map();
      _getStore().featureFlags.set(workspaceId, wsMap);
    }
    wsMap.set(key, record);
  },

  // ── Audit log ───────────────────────────────────────────────────────
  appendAudit(entry: Omit<AuditLogEntry, 'id'>): void {
    const full: AuditLogEntry = { ...entry, id: _newId('audit') };
    _getStore().auditLog.push(full);
    if (_getStore().auditLog.length > 5000) {
      _getStore().auditLog.splice(0, 1000);
    }
  },
  listAudit(workspaceId: string, limit = 100): AuditLogEntry[] {
    return _getStore().auditLog
      .filter((e) => e.workspaceId === workspaceId)
      .slice(-limit)
      .reverse();
  },

  // ── Versioning helper ───────────────────────────────────────────────
  nextVersion(workspaceId: string, key: string): number {
    const existing = store.getSecret(workspaceId, key);
    return existing ? existing.version + 1 : 1;
  },
  nextSettingVersion(workspaceId: string, key: string): number {
    const existing = store.getSetting(workspaceId, key);
    return existing ? existing.version + 1 : 1;
  },
  nextFlagVersion(workspaceId: string, key: string): number {
    const existing = store.getFeatureFlag(workspaceId, key);
    return existing ? existing.version + 1 : 1;
  },
};
