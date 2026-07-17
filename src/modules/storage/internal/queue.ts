/**
 * Codlok Cloud — Storage Module — Async Physical Deletion Queue (INTERNAL)
 *
 * Per §18 line 773: "Logical-then-physical delete, same philosophy as
 * Mail's queue-and-retry: state transitions to DELETED immediately and
 * the function returns — the caller's transaction never blocks on provider
 * latency. Physical removal of the object from the provider happens
 * asynchronously afterward, with retry on failure."
 *
 * This file is INTERNAL to the Storage module.
 */

import type { StorageProviderAdapter } from './types';
import { storageRepository } from './repository';

// ---------------------------------------------------------------------------
// Retry configuration
// ---------------------------------------------------------------------------

/** Maximum physical deletion attempts (1 initial + 4 retries = 5 total). */
export const MAX_DELETE_RETRIES = 4;

/**
 * Exponential backoff base in milliseconds. In test mode (NODE_ENV=test),
 * delays are 0 to keep tests fast. In production: 5s, 10s, 20s, 40s.
 */
function _backoffMs(attempt: number): number {
  if (process.env.NODE_ENV === 'test') return 0;
  return Math.pow(2, attempt) * 2500; // 2.5s, 5s, 10s, 20s
}

// ---------------------------------------------------------------------------
// In-flight tracking (for test flushing)
// ---------------------------------------------------------------------------

const _inFlight = new Set<Promise<void>>();

/**
 * Physically delete an object from the provider. Retries on failure with
 * exponential backoff up to MAX_DELETE_RETRIES. Updates the file record's
 * physicalDeletionStatus.
 *
 * This function is NOT awaited by the public deleteFile() — it runs
 * asynchronously after the caller has already received { state: DELETED }.
 */
export function _deletePhysically(
  fileId: string,
  bucket: string,
  objectKey: string,
  provider: StorageProviderAdapter
): Promise<void> {
  let p: Promise<void>;
  p = (async () => {
    try {
      await _deleteInner(fileId, bucket, objectKey, provider);
    } finally {
      _inFlight.delete(p!);
    }
  })();
  _inFlight.add(p);
  return p;
}

async function _deleteInner(
  fileId: string,
  bucket: string,
  objectKey: string,
  provider: StorageProviderAdapter
): Promise<void> {
  await storageRepository.updatePhysicalDeletion(fileId, 'in_progress', 0);

  for (let attempt = 0; attempt <= MAX_DELETE_RETRIES; attempt++) {
    try {
      await provider.deleteObject(bucket, objectKey);
      await storageRepository.updatePhysicalDeletion(fileId, 'completed', attempt);
      return;
    } catch {
      await storageRepository.updatePhysicalDeletion(fileId, 'in_progress', attempt + 1);
      if (attempt < MAX_DELETE_RETRIES) {
        const delay = _backoffMs(attempt);
        if (delay > 0) {
          await new Promise((resolve) => setTimeout(resolve, delay));
        }
      }
    }
  }

  // Max retries exhausted.
  await storageRepository.updatePhysicalDeletion(fileId, 'failed', MAX_DELETE_RETRIES);
}

/**
 * Test-only: wait for all in-flight physical deletions to complete.
 */
export async function _flushDeletionQueueForTesting(): Promise<void> {
  while (_inFlight.size > 0) {
    await Promise.all([..._inFlight]);
  }
}

// ---------------------------------------------------------------------------
// Upload Abandonment TTL Cleanup
// ---------------------------------------------------------------------------

/**
 * Check for abandoned uploads (PENDING/UPLOADING past TTL) and transition
 * them to FAILED. Per §18 line 795: "an upload that stays in PENDING or
 * UPLOADING without reaching completeUpload() within a bounded TTL is
 * automatically transitioned to FAILED by Storage itself."
 *
 * This is called lazily on every public function call — no background timer
 * needed. In production, a cron job would also call this periodically.
 */
export async function _cleanupAbandonedUploads(): Promise<number> {
  const now = new Date().toISOString();
  const abandoned = await storageRepository.findAbandoned(now);
  for (const record of abandoned) {
    await storageRepository.updateState(record.fileId, 'FAILED', {
      expiredAt: now,
    }, ['PENDING', 'UPLOADING']);
  }
  return abandoned.length;
}
