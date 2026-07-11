/**
 * Codlok Cloud — Storage Module — In-Memory Store (INTERNAL)
 *
 * Backing store for Storage v1.0. Uses globalThis for Next.js dev-mode
 * module identity consistency. In a future phase, this will be replaced
 * with a persistent database per §3.5.
 *
 * Per §18:
 *   - Files are workspace-scoped (line 807).
 *   - Upload state lifecycle tracked (line 787).
 *   - Abandoned uploads auto-expire to FAILED via TTL (line 795).
 *   - No business-reference fields (§3.10).
 *
 * This file is INTERNAL to the Storage module.
 */

import type { FileRecord, FileState } from './types';

// ---------------------------------------------------------------------------
// Store shape
// ---------------------------------------------------------------------------

interface StorageStore {
  /** fileId → FileRecord */
  files: Map<string, FileRecord>;
  /** uploadId → fileId (for completeUpload lookup) */
  uploadsByUploadId: Map<string, string>;
  /** workspaceId → Set<fileId> (for workspace-scoped queries) */
  filesByWorkspace: Map<string, Set<string>>;
}

// ---------------------------------------------------------------------------
// globalThis singleton
// ---------------------------------------------------------------------------

const STORE_KEY = Symbol.for('codlok.storage.store.v1');

function _getStore(): StorageStore {
  const g = globalThis as Record<symbol, unknown>;
  if (!g[STORE_KEY]) {
    g[STORE_KEY] = _createFreshStore();
  }
  return g[STORE_KEY] as StorageStore;
}

function _createFreshStore(): StorageStore {
  return {
    files: new Map(),
    uploadsByUploadId: new Map(),
    filesByWorkspace: new Map(),
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

export function newFileId(): string {
  return _newId('file');
}

export function newUploadId(): string {
  return _newId('upload');
}

// ---------------------------------------------------------------------------
// Store operations
// ---------------------------------------------------------------------------

export const store = {
  // ── Files ────────────────────────────────────────────────────────────
  insert(record: FileRecord): void {
    _getStore().files.set(record.fileId, record);
    _getStore().uploadsByUploadId.set(record.uploadId, record.fileId);
    _ensure(_getStore().filesByWorkspace, record.workspaceId).add(record.fileId);
  },
  getByFileId(fileId: string): FileRecord | undefined {
    return _getStore().files.get(fileId);
  },
  getByUploadId(uploadId: string): FileRecord | undefined {
    const fileId = _getStore().uploadsByUploadId.get(uploadId);
    if (!fileId) return undefined;
    return _getStore().files.get(fileId);
  },
  getByFileIdAndWorkspace(fileId: string, workspaceId: string): FileRecord | undefined {
    const record = _getStore().files.get(fileId);
    if (!record) return undefined;
    if (record.workspaceId !== workspaceId) return undefined; // §18: cross-workspace → not found
    return record;
  },
  updateState(fileId: string, state: FileState, extra?: Partial<FileRecord>): void {
    const record = _getStore().files.get(fileId);
    if (!record) return;
    record.state = state;
    record.updatedAt = new Date().toISOString();
    if (extra) {
      Object.assign(record, extra);
    }
  },
  updatePhysicalDeletion(fileId: string, status: 'pending' | 'in_progress' | 'completed' | 'failed', retryCount?: number): void {
    const record = _getStore().files.get(fileId);
    if (!record) return;
    record.physicalDeletionStatus = status;
    if (retryCount !== undefined) record.physicalDeletionRetryCount = retryCount;
  },
  listByWorkspace(workspaceId: string): FileRecord[] {
    const ids = _getStore().filesByWorkspace.get(workspaceId);
    if (!ids) return [];
    const out: FileRecord[] = [];
    for (const id of ids) {
      const r = _getStore().files.get(id);
      if (r) out.push(r);
    }
    return out;
  },
  /** Find abandoned uploads (PENDING/UPLOADING past TTL). */
  findAbandoned(now: string): FileRecord[] {
    const nowMs = new Date(now).getTime();
    const out: FileRecord[] = [];
    for (const r of _getStore().files.values()) {
      if ((r.state === 'PENDING' || r.state === 'UPLOADING') && r.uploadTtlExpiresAt) {
        if (new Date(r.uploadTtlExpiresAt).getTime() < nowMs) {
          out.push(r);
        }
      }
    }
    return out;
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
