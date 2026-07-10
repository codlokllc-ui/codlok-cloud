/**
 * Codlok Cloud — Storage Module — Provider Adapters (INTERNAL)
 *
 * Per Master Spec §18 line 739: "Provider adapter(s): Supabase Storage,
 * Cloudflare R2, Amazon S3 (per §5/§7)."
 *
 * Per §18 line 741: "Presigned two-phase upload. The client uploads bytes
 * directly to the provider; Codlok's servers never transport file bytes."
 *
 * Per §18 line 811: "Storage calls Configuration.getSecret(workspaceId, key)
 * for provider credentials. Storage calls no other module."
 *
 * This file is INTERNAL to the Storage module.
 */

import { createHash } from 'crypto';
import type {
  StorageProviderAdapter,
  PresignedUploadInput,
  PresignedUploadResult,
  PresignedDownloadInput,
  PresignedDownloadResult,
  ProviderObjectInfo,
} from './types';

// ---------------------------------------------------------------------------
// MockStorageProvider — for tests and dev (when no real provider configured)
// ---------------------------------------------------------------------------

/**
 * In-memory provider that simulates S3/R2/Supabase Storage behavior.
 * Stores objects in a Map keyed by `${bucket}/${objectKey}`.
 *
 * Used in:
 *   - Tests (injected via _setProviderForTesting)
 *   - Dev mode when CODELOK_AUTH_USE_MOCK=true (same flag as Auth/Mail)
 *
 * Supports checksum verification (computes SHA-256 of stored bytes),
 * presigned URL generation (returns fake URLs), and object deletion.
 */
export class MockStorageProvider implements StorageProviderAdapter {
  readonly providerName = 'mock';

  /** Stored objects: `${bucket}/${objectKey}` → { bytes, mimeType, size, checksum } */
  public objects = new Map<string, { bytes: Buffer; mimeType: string; size: number; checksum: string }>();

  /** When true, getObjectInfo reports the object as missing (simulates upload incomplete). */
  public incompleteUploads = new Set<string>();

  async createPresignedUpload(input: PresignedUploadInput): Promise<PresignedUploadResult> {
    const expiresAt = new Date(Date.now() + input.expiresInSeconds * 1000).toISOString();
    return {
      presignedUploadUrl: `https://mock-storage.local/upload/${input.bucket}/${input.objectKey}?expires=${expiresAt}`,
      uploadHeaders: {
        'Content-Type': input.mimeType,
        'Content-Length': String(input.expectedSizeBytes),
      },
      expiresAt,
    };
  }

  async getObjectInfo(bucket: string, objectKey: string): Promise<ProviderObjectInfo> {
    const key = `${bucket}/${objectKey}`;
    if (this.incompleteUploads.has(key)) {
      return { exists: false };
    }
    const obj = this.objects.get(key);
    if (!obj) return { exists: false };
    return {
      exists: true,
      sizeBytes: obj.size,
      checksum: obj.checksum,
    };
  }

  async createPresignedDownload(input: PresignedDownloadInput): Promise<PresignedDownloadResult> {
    const expiresAt = new Date(Date.now() + input.expiresInSeconds * 1000).toISOString();
    return {
      downloadUrl: `https://mock-storage.local/download/${input.bucket}/${input.objectKey}?expires=${expiresAt}`,
      expiresAt,
    };
  }

  async deleteObject(bucket: string, objectKey: string): Promise<void> {
    this.objects.delete(`${bucket}/${objectKey}`);
  }

  // ── Test helpers ─────────────────────────────────────────────────────

  /**
   * Simulate the client uploading bytes to the presigned URL.
   * Computes SHA-256 checksum and stores the object.
   */
  simulateUpload(bucket: string, objectKey: string, bytes: Buffer, mimeType: string): void {
    const checksum = createHash('sha256').update(bytes).digest('hex');
    this.objects.set(`${bucket}/${objectKey}`, {
      bytes,
      mimeType,
      size: bytes.length,
      checksum,
    });
  }

  /** Reset the mock's state. */
  reset(): void {
    this.objects.clear();
    this.incompleteUploads.clear();
  }
}

// ---------------------------------------------------------------------------
// S3StorageProvider — real S3 adapter (placeholder for production)
// ---------------------------------------------------------------------------

/**
 * Real S3 adapter. Uses the AWS SDK when available.
 *
 * NOTE: For v1, this is a thin wrapper. The actual S3 SDK integration
 * (presigned URL generation, getObjectInfo, deleteObject) would use
 * @aws-sdk/client-s3 and @aws-sdk/s3-request-presigner. We don't import
 * the SDK here to avoid adding a heavy dependency for a module that may
 * not be exercised in this environment. The MockStorageProvider is used
 * for all tests and dev mode. Production deployments would install the
 * SDK and implement the methods below.
 *
 * The interface is complete — only the implementation bodies are stubbed.
 */
export class S3StorageProvider implements StorageProviderAdapter {
  readonly providerName = 's3';

  constructor(
    private accessKey: string,
    private secretKey: string,
    private region: string,
    private endpoint?: string
  ) {}

  async createPresignedUpload(input: PresignedUploadInput): Promise<PresignedUploadResult> {
    // Production: use @aws-sdk/s3-request-presigner to generate a presigned PUT URL.
    // For now, this is a stub — MockStorageProvider is used for all tests/dev.
    throw new Error('S3StorageProvider.createPresignedUpload: not implemented in this environment. Use MockStorageProvider.');
  }

  async getObjectInfo(bucket: string, objectKey: string): Promise<ProviderObjectInfo> {
    throw new Error('S3StorageProvider.getObjectInfo: not implemented in this environment.');
  }

  async createPresignedDownload(input: PresignedDownloadInput): Promise<PresignedDownloadResult> {
    throw new Error('S3StorageProvider.createPresignedDownload: not implemented in this environment.');
  }

  async deleteObject(bucket: string, objectKey: string): Promise<void> {
    throw new Error('S3StorageProvider.deleteObject: not implemented in this environment.');
  }
}
