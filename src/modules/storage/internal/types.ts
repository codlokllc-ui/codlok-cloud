/**
 * Codlok Cloud — Storage Module — Internal Types (INTERNAL)
 *
 * Per Master Spec §18. This file is internal to the Storage module.
 * Only `src/modules/storage/index.ts` (the public interface) imports from here.
 *
 * Per §3.10 (File Ownership Rule): Storage stores NO business-reference
 * fields. Only fileId, provider, bucket/path, mime, size, checksum, state,
 * timestamps.
 */

// ---------------------------------------------------------------------------
// Upload/File State (§18 Upload State Rule — binding)
// ---------------------------------------------------------------------------

export type FileState = 'PENDING' | 'UPLOADING' | 'UPLOADED' | 'DELETED' | 'FAILED';

// ---------------------------------------------------------------------------
// File record (the canonical metadata for a stored object)
// ---------------------------------------------------------------------------

export interface FileRecord {
  /** Unique file identifier (handed to business modules after completeUpload). */
  fileId: string;
  /** Unique upload identifier (used between createUpload and completeUpload). */
  uploadId: string;
  /** Workspace scope (required per §18 line 807). */
  workspaceId: string;
  mimeType: string;
  expectedSizeBytes: number;
  /** SHA-256 checksum supplied by client at createUpload, verified at completeUpload. */
  expectedChecksum: string;
  /** Actual checksum computed from provider object at completeUpload (if completed). */
  actualChecksum?: string;
  /** Actual size confirmed from provider at completeUpload (if completed). */
  actualSizeBytes?: number;
  state: FileState;
  /** Provider name ('s3' | 'r2' | 'supabase' | 'mock'). */
  provider: string;
  /** Bucket name at the provider. */
  bucket: string;
  /** Object key/path at the provider. */
  objectKey: string;
  createdAt: string;
  updatedAt: string;
  /** When the upload was completed (if UPLOADED). */
  uploadedAt?: string;
  /** When the file was logically deleted (if DELETED). */
  deletedAt?: string;
  /** When an abandoned upload expired to FAILED. */
  expiredAt?: string;
  /** TTL deadline for PENDING/UPLOADING uploads (abandonment). */
  uploadTtlExpiresAt?: string;
  /** Physical deletion tracking (async). */
  physicalDeletionStatus?: 'pending' | 'in_progress' | 'completed' | 'failed';
  physicalDeletionRetryCount?: number;
}

// ---------------------------------------------------------------------------
// Provider adapter interface (internal — abstraction over S3/R2/Supabase)
// ---------------------------------------------------------------------------

export interface PresignedUploadInput {
  bucket: string;
  objectKey: string;
  mimeType: string;
  expectedSizeBytes: number;
  /** TTL for the presigned URL (seconds). */
  expiresInSeconds: number;
}

export interface PresignedUploadResult {
  presignedUploadUrl: string;
  /** Headers the client must include when PUT-ing to the presigned URL. */
  uploadHeaders: Record<string, string>;
  expiresAt: string;
}

export interface PresignedDownloadInput {
  bucket: string;
  objectKey: string;
  /** TTL for the presigned URL (seconds). */
  expiresInSeconds: number;
}

export interface PresignedDownloadResult {
  downloadUrl: string;
  expiresAt: string;
}

export interface ProviderObjectInfo {
  exists: boolean;
  sizeBytes?: number;
  /** SHA-256 checksum from the provider (if available). */
  checksum?: string;
}

export interface StorageProviderAdapter {
  /** Generate a presigned URL for the client to upload bytes directly. */
  createPresignedUpload(input: PresignedUploadInput): Promise<PresignedUploadResult>;

  /** Verify the object exists at the provider and return its size/checksum. */
  getObjectInfo(bucket: string, objectKey: string): Promise<ProviderObjectInfo>;

  /** Generate a presigned URL for downloading. */
  createPresignedDownload(input: PresignedDownloadInput): Promise<PresignedDownloadResult>;

  /** Physically delete the object from the provider. */
  deleteObject(bucket: string, objectKey: string): Promise<void>;

  /** Provider name for metadata. */
  readonly providerName: string;
}

// ---------------------------------------------------------------------------
// StorageError — internal exception
// ---------------------------------------------------------------------------

export class StorageError extends Error {
  constructor(
    public readonly code: string,
    message: string
  ) {
    super(message);
    this.name = 'StorageError';
  }
}
