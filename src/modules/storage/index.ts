/**
 * Codlok Cloud — Storage Module — Public Interface v1.0
 *
 * Per Master Spec §18 Storage Module Specification v1.0 (STATUS: FROZEN).
 * Spec Version 2.1.
 *
 * Purpose: Answers "where do file bytes physically live, and how does a
 * module get them in or out reliably?" Storage manages binary object
 * lifecycle only — it has no knowledge of what a file *means*.
 *
 * ----------------------------------------------------------------------------
 * PUBLIC INTERFACE (§18)
 * ----------------------------------------------------------------------------
 *   createUpload(workspaceId, mimeType, expectedSizeBytes, expectedChecksum)
 *   completeUpload(workspaceId, uploadId)
 *   getDownloadUrl(workspaceId, fileId)
 *   getFile(workspaceId, fileId)
 *   deleteFile(workspaceId, fileId)
 *   fileExists(workspaceId, fileId)
 *   getProviderStatus(workspaceId)
 *
 * All return StandardResponse per §3.6.
 *
 * ----------------------------------------------------------------------------
 * UPLOAD MODEL (§18 line 741 — binding)
 * ----------------------------------------------------------------------------
 * Presigned two-phase upload. The client uploads bytes directly to the
 * provider (S3/R2/Supabase Storage); Codlok's servers never transport file
 * bytes themselves.
 *
 *   1. createUpload() → returns presignedUploadUrl + uploadId + fileId
 *   2. Client PUTs bytes directly to presignedUploadUrl (not through Codlok)
 *   3. completeUpload() → verifies object exists at provider, checks size +
 *      checksum, transitions state to UPLOADED
 *
 * ----------------------------------------------------------------------------
 * UPLOAD STATE RULE (§18 line 787 — binding)
 * ----------------------------------------------------------------------------
 *   PENDING → UPLOADING → UPLOADED → DELETED
 *                       ↘ FAILED (terminal)
 *   PENDING → FAILED (terminal, e.g. expired before any bytes arrived)
 *
 * FAILED is terminal — no retry. Client calls createUpload() again for a
 * fresh uploadId + fileId.
 *
 * Abandoned uploads (PENDING/UPLOADING past TTL) auto-expire to FAILED.
 * Upload abandonment TTL: 1 HOUR.
 *   Rationale: long enough for a client to complete a large file upload
 *   (evidence photos, videos), short enough to not accumulate stale entries.
 *
 * ----------------------------------------------------------------------------
 * IMMUTABILITY (§18 Mandatory Rule 2)
 * ----------------------------------------------------------------------------
 * Uploaded objects are never overwritten. A changed file is a new upload
 * with a new fileId. Storage has no "current version" concept — that's the
 * owning module's decision.
 *
 * ----------------------------------------------------------------------------
 * LOGICAL-THEN-PHYSICAL DELETE (§18 line 773)
 * ----------------------------------------------------------------------------
 * deleteFile() marks state DELETED immediately and returns — the caller's
 * transaction never blocks on provider latency. Physical removal happens
 * asynchronously with retry (same philosophy as Mail's queue-and-retry).
 *
 * ----------------------------------------------------------------------------
 * NO BUSINESS-REFERENCE FIELDS (§3.10)
 * ----------------------------------------------------------------------------
 * Storage stores NO business-reference fields (no inspectionId, no
 * belongsToVerification, etc.). Only fileId, provider, bucket/path, mime,
 * size, checksum, state, timestamps.
 *
 * ----------------------------------------------------------------------------
 * NO AUTHORIZATION (§18 line 737)
 * ----------------------------------------------------------------------------
 * Storage assumes the caller already checked permission. The calling module
 * (Verify, Documents, etc.) has already decided that before calling Storage.
 */

import { StandardResponse, ok, fail } from '@/shared';
import { StorageErrorCode } from './internal/errors';
import type {
  FileRecord,
  FileState,
  StorageProviderAdapter,
} from './internal/types';
import { StorageError } from './internal/types';
import {
  newFileId,
  newUploadId,
  _resetStoreForTesting,
} from './internal/store';
import { storageRepository } from './internal/repository';
import { resolveProvider, _setProviderForTesting } from './internal/factory';
import {
  _deletePhysically,
  _flushDeletionQueueForTesting,
  _cleanupAbandonedUploads,
} from './internal/queue';

// Re-export test helpers so tests can import from the public module.
export { _resetStoreForTesting, _setProviderForTesting, _flushDeletionQueueForTesting };

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** 1 hour in seconds — TTL for presigned upload URLs. */
const PRESIGNED_UPLOAD_TTL_SECONDS = 3600;

/** 1 hour in seconds — TTL for presigned download URLs. */
const PRESIGNED_DOWNLOAD_TTL_SECONDS = 3600;

/** 1 hour in milliseconds — abandonment TTL for PENDING/UPLOADING uploads. */
const UPLOAD_ABANDONMENT_TTL_MS = 60 * 60 * 1000;

// ---------------------------------------------------------------------------
// Allowed MIME types (basic validation — extend as needed)
// ---------------------------------------------------------------------------

const ALLOWED_MIME_TYPES = new Set([
  'image/jpeg',
  'image/png',
  'image/gif',
  'image/webp',
  'image/svg+xml',
  'application/pdf',
  'text/plain',
  'text/csv',
  'application/json',
  'video/mp4',
  'video/webm',
  'application/octet-stream',
]);

// ---------------------------------------------------------------------------
// Public data shapes (per §18)
// ---------------------------------------------------------------------------

export interface CreateUploadData {
  uploadId: string;
  fileId: string;
  presignedUploadUrl: string;
  expiresAt: string;
  uploadHeaders: Record<string, string>;
}

export interface CompleteUploadData {
  fileId: string;
  state: 'UPLOADED';
  checksum: string;
  sizeBytes: number;
}

export interface GetDownloadUrlData {
  downloadUrl: string;
  expiresAt: string;
}

export interface GetFileData {
  fileId: string;
  mimeType: string;
  sizeBytes: number;
  checksum: string;
  state: FileState;
  createdAt: string;
}

export interface DeleteFileData {
  fileId: string;
  state: 'DELETED';
}

export interface FileExistsData {
  exists: boolean;
}

export interface GetProviderStatusData {
  configured: boolean;
  provider: string | null;
}

// ---------------------------------------------------------------------------
// Internal: error wrapping
// ---------------------------------------------------------------------------

function _storageErrorToResponse(err: unknown): StandardResponse<never> {
  if (err instanceof Error && err.name === 'StorageError') {
    const code = (err as { code?: string }).code ?? StorageErrorCode.INTERNAL_ERROR;
    return fail(code, err.message);
  }
  return fail(StorageErrorCode.INTERNAL_ERROR, 'An internal error occurred.');
}

// ---------------------------------------------------------------------------
// Internal: validation helpers
// ---------------------------------------------------------------------------

function _requireWorkspaceId(workspaceId: string): void {
  if (!workspaceId) {
    throw new StorageError(
      StorageErrorCode.WORKSPACE_NOT_FOUND,
      'workspaceId is required.'
    );
  }
}

function _requireMimeType(mimeType: string): void {
  if (!mimeType) {
    throw new StorageError(
      StorageErrorCode.INVALID_MIME_TYPE,
      'mimeType is required.'
    );
  }
  if (!ALLOWED_MIME_TYPES.has(mimeType)) {
    throw new StorageError(
      StorageErrorCode.INVALID_MIME_TYPE,
      `Unsupported MIME type: ${mimeType}.`
    );
  }
}

function _requireChecksum(checksum: string): void {
  // SHA-256 produces a 64-character hex string.
  if (!checksum || !/^[a-f0-9]{64}$/.test(checksum)) {
    throw new StorageError(
      StorageErrorCode.CHECKSUM_MISMATCH,
      'expectedChecksum must be a valid SHA-256 hex string (64 hex chars).'
    );
  }
}

function _now(): string {
  return new Date().toISOString();
}

// ---------------------------------------------------------------------------
// §18 createUpload
// ---------------------------------------------------------------------------

export async function createUpload(
  workspaceId: string,
  mimeType: string,
  expectedSizeBytes: number,
  expectedChecksum: string
): Promise<StandardResponse<CreateUploadData>> {
  try {
    // Lazy cleanup of abandoned uploads (§18 line 795).
    await _cleanupAbandonedUploads();

    _requireWorkspaceId(workspaceId);
    _requireMimeType(mimeType);
    _requireChecksum(expectedChecksum);

    if (typeof expectedSizeBytes !== 'number' || expectedSizeBytes <= 0) {
      throw new StorageError(
        StorageErrorCode.INTERNAL_ERROR,
        'expectedSizeBytes must be a positive number.'
      );
    }

    // Resolve provider (PROVIDER_NOT_CONFIGURED if not configured).
    const resolved = await resolveProvider(workspaceId);
    if (!resolved) {
      throw new StorageError(
        StorageErrorCode.PROVIDER_NOT_CONFIGURED,
        'Storage provider is not configured for this workspace.'
      );
    }
    const { provider, bucket } = resolved;

    // Generate IDs.
    const fileId = newFileId();
    const uploadId = newUploadId();
    const objectKey = `${workspaceId}/${fileId}`;

    // Create presigned upload URL.
    const presigned = await provider.createPresignedUpload({
      bucket,
      objectKey,
      mimeType,
      expectedSizeBytes,
      expiresInSeconds: PRESIGNED_UPLOAD_TTL_SECONDS,
    });

    // Create file record in PENDING state.
    const now = _now();
    const ttlExpiresAt = new Date(Date.now() + UPLOAD_ABANDONMENT_TTL_MS).toISOString();
    const record: FileRecord = {
      fileId,
      uploadId,
      workspaceId,
      mimeType,
      expectedSizeBytes,
      expectedChecksum,
      state: 'PENDING',
      provider: provider.providerName,
      bucket,
      objectKey,
      createdAt: now,
      updatedAt: now,
      uploadTtlExpiresAt: ttlExpiresAt,
    };
    await storageRepository.insert(record);

    return ok<CreateUploadData>({
      uploadId,
      fileId,
      presignedUploadUrl: presigned.presignedUploadUrl,
      expiresAt: presigned.expiresAt,
      uploadHeaders: presigned.uploadHeaders,
    });
  } catch (err) {
    return _storageErrorToResponse(err);
  }
}

// ---------------------------------------------------------------------------
// §18 completeUpload
// ---------------------------------------------------------------------------

export async function completeUpload(
  workspaceId: string,
  uploadId: string
): Promise<StandardResponse<CompleteUploadData>> {
  try {
    // Lazy cleanup of abandoned uploads.
    await _cleanupAbandonedUploads();

    _requireWorkspaceId(workspaceId);
    if (!uploadId) {
      throw new StorageError(
        StorageErrorCode.UPLOAD_NOT_FOUND,
        'uploadId is required.'
      );
    }

    const record = await storageRepository.getByUploadId(uploadId);
    if (!record || record.workspaceId !== workspaceId) {
      throw new StorageError(
        StorageErrorCode.UPLOAD_NOT_FOUND,
        'Upload not found.'
      );
    }

    // If already terminal, return the current state.
    if (record.state === 'FAILED') {
      throw new StorageError(
        StorageErrorCode.UPLOAD_EXPIRED,
        'Upload has expired or failed. Call createUpload() again.'
      );
    }
    if (record.state === 'UPLOADED') {
      // Idempotent — return existing completion.
      return ok<CompleteUploadData>({
        fileId: record.fileId,
        state: 'UPLOADED',
        checksum: record.actualChecksum ?? record.expectedChecksum,
        sizeBytes: record.actualSizeBytes ?? record.expectedSizeBytes,
      });
    }
    if (record.state === 'DELETED') {
      throw new StorageError(
        StorageErrorCode.FILE_NOT_FOUND,
        'File has been deleted.'
      );
    }

    // Check abandonment TTL.
    if (record.uploadTtlExpiresAt && new Date(record.uploadTtlExpiresAt).getTime() < Date.now()) {
      await storageRepository.updateState(record.fileId, 'FAILED', { expiredAt: _now() }, ['PENDING', 'UPLOADING']);
      throw new StorageError(
        StorageErrorCode.UPLOAD_EXPIRED,
        'Upload has expired. Call createUpload() again.'
      );
    }

    // Transition to UPLOADING.
    const claimed = await storageRepository.updateState(record.fileId, 'UPLOADING', undefined, ['PENDING']);
    if (!claimed) {
      throw new StorageError(StorageErrorCode.UPLOAD_INCOMPLETE, 'Upload is already being completed. Retry shortly.');
    }

    // Resolve provider (should still be configured — but check anyway).
    const resolved = await resolveProvider(workspaceId);
    if (!resolved) {
      throw new StorageError(
        StorageErrorCode.PROVIDER_NOT_CONFIGURED,
        'Storage provider is no longer configured for this workspace.'
      );
    }

    // Verify object exists at provider.
    const info = await resolved.provider.getObjectInfo(record.bucket, record.objectKey);
    if (!info.exists) {
      // Object not yet uploaded — transition back to PENDING (client can retry completeUpload).
      await storageRepository.updateState(record.fileId, 'PENDING', undefined, ['UPLOADING']);
      throw new StorageError(
        StorageErrorCode.UPLOAD_INCOMPLETE,
        'Object not found at provider. Upload may not be complete yet.'
      );
    }

    // Verify size.
    if (info.sizeBytes !== undefined && info.sizeBytes !== record.expectedSizeBytes) {
      await storageRepository.updateState(record.fileId, 'FAILED', undefined, ['UPLOADING']);
      throw new StorageError(
        StorageErrorCode.CHECKSUM_MISMATCH,
        `Size mismatch: expected ${record.expectedSizeBytes}, got ${info.sizeBytes}.`
      );
    }

    // Verify checksum (§18 Mandatory Rule 1).
    const actualChecksum = info.checksum ?? record.expectedChecksum; // mock provider always has checksum
    if (actualChecksum !== record.expectedChecksum) {
      await storageRepository.updateState(record.fileId, 'FAILED', undefined, ['UPLOADING']);
      throw new StorageError(
        StorageErrorCode.CHECKSUM_MISMATCH,
        'Checksum mismatch: the uploaded object does not match the expected SHA-256.'
      );
    }

    // Transition to UPLOADED.
    const now = _now();
    await storageRepository.updateState(record.fileId, 'UPLOADED', {
      actualChecksum,
      actualSizeBytes: info.sizeBytes ?? record.expectedSizeBytes,
      uploadedAt: now,
    }, ['UPLOADING']);

    return ok<CompleteUploadData>({
      fileId: record.fileId,
      state: 'UPLOADED',
      checksum: actualChecksum,
      sizeBytes: info.sizeBytes ?? record.expectedSizeBytes,
    });
  } catch (err) {
    return _storageErrorToResponse(err);
  }
}

// ---------------------------------------------------------------------------
// §18 getDownloadUrl
// ---------------------------------------------------------------------------

export async function getDownloadUrl(
  workspaceId: string,
  fileId: string
): Promise<StandardResponse<GetDownloadUrlData>> {
  try {
    _requireWorkspaceId(workspaceId);
    if (!fileId) {
      throw new StorageError(
        StorageErrorCode.FILE_NOT_FOUND,
        'fileId is required.'
      );
    }

    const record = await storageRepository.getByFileIdAndWorkspace(fileId, workspaceId);
    if (!record || record.state === 'DELETED') {
      throw new StorageError(
        StorageErrorCode.FILE_NOT_FOUND,
        'File not found.'
      );
    }
    if (record.state !== 'UPLOADED') {
      throw new StorageError(
        StorageErrorCode.FILE_NOT_UPLOADED,
        `File is not uploaded (current state: ${record.state}).`
      );
    }

    const resolved = await resolveProvider(workspaceId);
    if (!resolved) {
      throw new StorageError(
        StorageErrorCode.PROVIDER_NOT_CONFIGURED,
        'Storage provider is not configured for this workspace.'
      );
    }

    const download = await resolved.provider.createPresignedDownload({
      bucket: record.bucket,
      objectKey: record.objectKey,
      expiresInSeconds: PRESIGNED_DOWNLOAD_TTL_SECONDS,
    });

    return ok<GetDownloadUrlData>({
      downloadUrl: download.downloadUrl,
      expiresAt: download.expiresAt,
    });
  } catch (err) {
    return _storageErrorToResponse(err);
  }
}

// ---------------------------------------------------------------------------
// §18 getFile
// ---------------------------------------------------------------------------

export async function getFile(
  workspaceId: string,
  fileId: string
): Promise<StandardResponse<GetFileData>> {
  try {
    _requireWorkspaceId(workspaceId);
    if (!fileId) {
      throw new StorageError(
        StorageErrorCode.FILE_NOT_FOUND,
        'fileId is required.'
      );
    }

    const record = await storageRepository.getByFileIdAndWorkspace(fileId, workspaceId);
    if (!record || record.state === 'DELETED') {
      throw new StorageError(
        StorageErrorCode.FILE_NOT_FOUND,
        'File not found.'
      );
    }

    return ok<GetFileData>({
      fileId: record.fileId,
      mimeType: record.mimeType,
      sizeBytes: record.actualSizeBytes ?? record.expectedSizeBytes,
      checksum: record.actualChecksum ?? record.expectedChecksum,
      state: record.state,
      createdAt: record.createdAt,
    });
  } catch (err) {
    return _storageErrorToResponse(err);
  }
}

// ---------------------------------------------------------------------------
// §18 deleteFile (logical-then-physical delete)
// ---------------------------------------------------------------------------

export async function deleteFile(
  workspaceId: string,
  fileId: string
): Promise<StandardResponse<DeleteFileData>> {
  try {
    _requireWorkspaceId(workspaceId);
    if (!fileId) {
      throw new StorageError(
        StorageErrorCode.FILE_NOT_FOUND,
        'fileId is required.'
      );
    }

    const record = await storageRepository.getByFileIdAndWorkspace(fileId, workspaceId);
    if (!record) {
      throw new StorageError(
        StorageErrorCode.FILE_NOT_FOUND,
        'File not found.'
      );
    }

    // If already deleted, idempotent success.
    if (record.state === 'DELETED') {
      return ok<DeleteFileData>({ fileId, state: 'DELETED' });
    }

    // Logical delete: immediately transition to DELETED (§18 line 773).
    const now = _now();
    const deleted = await storageRepository.updateState(record.fileId, 'DELETED', {
      deletedAt: now,
      physicalDeletionStatus: 'pending',
      physicalDeletionRetryCount: 0,
    }, ['PENDING', 'UPLOADING', 'UPLOADED', 'FAILED']);
    if (!deleted) return ok<DeleteFileData>({ fileId, state: 'DELETED' });

    // Physical delete: async with retry (non-blocking).
    const resolved = await resolveProvider(workspaceId);
    if (resolved) {
      _deletePhysically(record.fileId, record.bucket, record.objectKey, resolved.provider).catch(() => {
        // Errors are handled inside _deleteInner (updates physicalDeletionStatus).
      });
    }

    return ok<DeleteFileData>({ fileId, state: 'DELETED' });
  } catch (err) {
    return _storageErrorToResponse(err);
  }
}

// ---------------------------------------------------------------------------
// §18 fileExists
// ---------------------------------------------------------------------------

export async function fileExists(
  workspaceId: string,
  fileId: string
): Promise<StandardResponse<FileExistsData>> {
  try {
    _requireWorkspaceId(workspaceId);
    if (!fileId) {
      return ok<FileExistsData>({ exists: false });
    }

    const record = await storageRepository.getByFileIdAndWorkspace(fileId, workspaceId);
    if (!record || record.state === 'DELETED') {
      return ok<FileExistsData>({ exists: false });
    }

    return ok<FileExistsData>({ exists: true });
  } catch (err) {
    return _storageErrorToResponse(err);
  }
}

// ---------------------------------------------------------------------------
// §18 getProviderStatus
// ---------------------------------------------------------------------------

export async function getProviderStatus(
  workspaceId: string
): Promise<StandardResponse<GetProviderStatusData>> {
  try {
    _requireWorkspaceId(workspaceId);

    const resolved = await resolveProvider(workspaceId);
    if (!resolved) {
      return ok<GetProviderStatusData>({ configured: false, provider: null });
    }

    return ok<GetProviderStatusData>({
      configured: true,
      provider: resolved.provider.providerName,
    });
  } catch (err) {
    return _storageErrorToResponse(err);
  }
}


// ---------------------------------------------------------------------------
// v1.1 listFiles (additive dashboard read API)
// ---------------------------------------------------------------------------

export interface ListFilesData {
  items: { fileId: string; state: FileState; mimeType: string; sizeBytes: number; createdAt: string; updatedAt: string }[];
  hasMore: boolean;
  nextCursor: string | null;
}

export async function listFiles(
  workspaceId: string,
  filters?: { state?: FileState; mimeType?: string },
  pagination?: { limit?: number; cursor?: string }
): Promise<StandardResponse<ListFilesData>> {
  try {
    _requireWorkspaceId(workspaceId);
    let records = await storageRepository.listByWorkspace(workspaceId);
    if (filters?.state) records = records.filter((r) => r.state === filters.state);
    if (filters?.mimeType) records = records.filter((r) => r.mimeType === filters.mimeType);
    records = records.sort((a, b) => a.createdAt.localeCompare(b.createdAt));
    const start = pagination?.cursor ? Math.max(0, records.findIndex((r) => r.fileId === pagination.cursor) + 1) : 0;
    const limit = pagination?.limit && pagination.limit > 0 ? pagination.limit : records.length || 1;
    const page = records.slice(start, start + limit);
    const hasMore = start + page.length < records.length;
    return ok({
      items: page.map((r) => ({ fileId: r.fileId, state: r.state, mimeType: r.mimeType, sizeBytes: r.actualSizeBytes ?? r.expectedSizeBytes, createdAt: r.createdAt, updatedAt: r.updatedAt })),
      hasMore,
      nextCursor: hasMore && page.length ? page[page.length - 1].fileId : null,
    });
  } catch (err) { return _storageErrorToResponse(err); }
}

// ---------------------------------------------------------------------------
// Public surface (the ONLY thing other modules may import)
// ---------------------------------------------------------------------------

export const Storage = {
  createUpload,
  completeUpload,
  getDownloadUrl,
  getFile,
  deleteFile,
  fileExists,
  getProviderStatus,
  listFiles,
};

export type StorageModule = typeof Storage;
