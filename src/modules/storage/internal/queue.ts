import { processStorageDeletionJobs } from '@/platform/jobs/worker';
import { storageRepository } from './repository';

/** Maximum physical deletion retries after the first attempt. */
export const MAX_DELETE_RETRIES = 4;

/** Test-only helper that drains all immediately due Storage deletion jobs. */
export async function _flushDeletionQueueForTesting(): Promise<void> {
  for (let pass = 0; pass < 20; pass++) {
    const summary = await processStorageDeletionJobs({ batchSize: 25 });
    if (summary.claimed === 0) return;
  }
  throw new Error('STORAGE_DELETION_QUEUE_DID_NOT_DRAIN');
}

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
