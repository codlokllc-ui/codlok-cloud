import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { store } from './store';
import type { FileRecord, FileState } from './types';

type DeletionStatus = NonNullable<FileRecord['physicalDeletionStatus']>;

function database(): SupabaseClient | null {
  if (process.env.NODE_ENV === 'test') return null;
  const url = process.env.SUPABASE_URL;
  const secret = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !secret) return null;
  return createClient(url, secret, { auth: { persistSession: false, autoRefreshToken: false } });
}

function requireConfigured(db: SupabaseClient | null): void {
  if (!db && process.env.NODE_ENV === 'production') throw new Error('STORAGE_STORE_NOT_CONFIGURED');
}

const toRow = (r: FileRecord) => ({
  file_id: r.fileId, upload_id: r.uploadId, workspace_id: r.workspaceId,
  mime_type: r.mimeType, expected_size_bytes: r.expectedSizeBytes,
  expected_checksum: r.expectedChecksum, actual_checksum: r.actualChecksum ?? null,
  actual_size_bytes: r.actualSizeBytes ?? null, state: r.state, provider: r.provider,
  bucket: r.bucket, object_key: r.objectKey, created_at: r.createdAt, updated_at: r.updatedAt,
  uploaded_at: r.uploadedAt ?? null, deleted_at: r.deletedAt ?? null,
  expired_at: r.expiredAt ?? null, upload_ttl_expires_at: r.uploadTtlExpiresAt ?? null,
  physical_deletion_status: r.physicalDeletionStatus ?? null,
  physical_deletion_retry_count: r.physicalDeletionRetryCount ?? null,
});

function fromRow(row: Record<string, unknown>): FileRecord {
  return {
    fileId: String(row.file_id), uploadId: String(row.upload_id), workspaceId: String(row.workspace_id),
    mimeType: String(row.mime_type), expectedSizeBytes: Number(row.expected_size_bytes),
    expectedChecksum: String(row.expected_checksum),
    actualChecksum: row.actual_checksum == null ? undefined : String(row.actual_checksum),
    actualSizeBytes: row.actual_size_bytes == null ? undefined : Number(row.actual_size_bytes),
    state: row.state as FileState, provider: String(row.provider), bucket: String(row.bucket),
    objectKey: String(row.object_key), createdAt: String(row.created_at), updatedAt: String(row.updated_at),
    uploadedAt: row.uploaded_at == null ? undefined : String(row.uploaded_at),
    deletedAt: row.deleted_at == null ? undefined : String(row.deleted_at),
    expiredAt: row.expired_at == null ? undefined : String(row.expired_at),
    uploadTtlExpiresAt: row.upload_ttl_expires_at == null ? undefined : String(row.upload_ttl_expires_at),
    physicalDeletionStatus: row.physical_deletion_status == null ? undefined : row.physical_deletion_status as DeletionStatus,
    physicalDeletionRetryCount: row.physical_deletion_retry_count == null ? undefined : Number(row.physical_deletion_retry_count),
  };
}

async function one(query: PromiseLike<{ data: unknown; error: unknown }>): Promise<FileRecord | undefined> {
  const { data, error } = await query;
  if (error) throw new Error('STORAGE_STATE_LOAD_FAILED');
  return data ? fromRow(data as Record<string, unknown>) : undefined;
}

export const storageRepository = {
  async insert(record: FileRecord): Promise<void> {
    const db = database(); requireConfigured(db);
    if (!db) return store.insert(record);
    const { error } = await db.from('codlok_storage_files').insert(toRow(record));
    if (error) throw new Error('STORAGE_STATE_SAVE_FAILED');
  },
  async getByUploadId(uploadId: string): Promise<FileRecord | undefined> {
    const db = database(); requireConfigured(db);
    if (!db) return store.getByUploadId(uploadId);
    return one(db.from('codlok_storage_files').select('*').eq('upload_id', uploadId).maybeSingle());
  },
  async getByFileIdAndWorkspace(fileId: string, workspaceId: string): Promise<FileRecord | undefined> {
    const db = database(); requireConfigured(db);
    if (!db) return store.getByFileIdAndWorkspace(fileId, workspaceId);
    return one(db.from('codlok_storage_files').select('*').eq('file_id', fileId).eq('workspace_id', workspaceId).maybeSingle());
  },
  async updateState(fileId: string, state: FileState, extra?: Partial<FileRecord>, expectedStates?: FileState[]): Promise<boolean> {
    const db = database(); requireConfigured(db);
    if (!db) {
      const current = store.getByFileId(fileId);
      if (!current || (expectedStates && !expectedStates.includes(current.state))) return false;
      store.updateState(fileId, state, extra); return true;
    }
    const changes: Record<string, unknown> = { state, updated_at: new Date().toISOString() };
    const mapping: Array<[keyof FileRecord, string]> = [
      ['actualChecksum', 'actual_checksum'], ['actualSizeBytes', 'actual_size_bytes'],
      ['uploadedAt', 'uploaded_at'], ['deletedAt', 'deleted_at'], ['expiredAt', 'expired_at'],
      ['physicalDeletionStatus', 'physical_deletion_status'],
      ['physicalDeletionRetryCount', 'physical_deletion_retry_count'],
    ];
    for (const [source, target] of mapping) if (extra?.[source] !== undefined) changes[target] = extra[source];
    let query = db.from('codlok_storage_files').update(changes).eq('file_id', fileId).select('file_id');
    if (expectedStates?.length) query = query.in('state', expectedStates);
    const { data, error } = await query;
    if (error) throw new Error('STORAGE_STATE_SAVE_FAILED');
    return (data?.length ?? 0) === 1;
  },
  async updatePhysicalDeletion(fileId: string, status: DeletionStatus, retryCount?: number): Promise<void> {
    const db = database(); requireConfigured(db);
    if (!db) return store.updatePhysicalDeletion(fileId, status, retryCount);
    const changes: Record<string, unknown> = { physical_deletion_status: status, updated_at: new Date().toISOString() };
    if (retryCount !== undefined) changes.physical_deletion_retry_count = retryCount;
    const { error } = await db.from('codlok_storage_files').update(changes).eq('file_id', fileId);
    if (error) throw new Error('STORAGE_STATE_SAVE_FAILED');
  },
  async listByWorkspace(workspaceId: string): Promise<FileRecord[]> {
    const db = database(); requireConfigured(db);
    if (!db) return store.listByWorkspace(workspaceId);
    const { data, error } = await db.from('codlok_storage_files').select('*').eq('workspace_id', workspaceId).order('created_at').order('file_id');
    if (error) throw new Error('STORAGE_STATE_LOAD_FAILED');
    return (data ?? []).map((row) => fromRow(row));
  },
  async findAbandoned(now: string): Promise<FileRecord[]> {
    const db = database(); requireConfigured(db);
    if (!db) return store.findAbandoned(now);
    const { data, error } = await db.from('codlok_storage_files').select('*').in('state', ['PENDING', 'UPLOADING']).lt('upload_ttl_expires_at', now);
    if (error) throw new Error('STORAGE_STATE_LOAD_FAILED');
    return (data ?? []).map((row) => fromRow(row));
  },
};
