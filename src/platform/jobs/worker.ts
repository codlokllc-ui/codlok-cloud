import { randomUUID } from 'crypto';
import { resolveProvider } from '@/modules/storage/internal/factory';
import { storageRepository } from '@/modules/storage/internal/repository';
import { platformJobRepository } from './repository';
import type { PlatformJobRecord } from './types';

const MODULE = 'storage';
const JOB_TYPE = 'storage.physical_delete';
const MAX_BATCH_SIZE = 25;

interface StorageDeletionPayload {
  fileId: string;
  provider: string;
  bucket: string;
  objectKey: string;
}

export interface WorkerSummary {
  claimed: number;
  completed: number;
  retried: number;
  deadLettered: number;
  leaseConflicts: number;
}

function payload(job: PlatformJobRecord): StorageDeletionPayload {
  const value = job.payload;
  for (const key of ['fileId', 'provider', 'bucket', 'objectKey']) {
    if (typeof value[key] !== 'string' || value[key].length === 0) throw new Error('INVALID_JOB_PAYLOAD');
  }
  return value as unknown as StorageDeletionPayload;
}

function errorCode(error: unknown): string {
  if (!(error instanceof Error)) return 'UNKNOWN_FAILURE';
  const allowed = new Set([
    'INVALID_JOB_PAYLOAD', 'STORAGE_PROVIDER_NOT_CONFIGURED',
    'STORAGE_PROVIDER_CHANGED', 'STORAGE_STATE_SAVE_FAILED',
  ]);
  return allowed.has(error.message) ? error.message : 'STORAGE_PROVIDER_DELETE_FAILED';
}

export function retryDelayMs(attemptCount: number): number {
  if (process.env.NODE_ENV === 'test') return 0;
  return Math.min(60 * 60_000, 30_000 * Math.pow(2, Math.max(0, attemptCount - 1)));
}

export async function processStorageDeletionJobs(options: {
  workerId?: string;
  batchSize?: number;
  now?: Date;
} = {}): Promise<WorkerSummary> {
  const workerId = options.workerId ?? `storage-worker-${randomUUID()}`;
  const now = options.now ?? new Date();
  const batchSize = Math.min(MAX_BATCH_SIZE, Math.max(1, options.batchSize ?? 10));
  const jobs = await platformJobRepository.claim({
    workerId, module: MODULE, jobType: JOB_TYPE, limit: batchSize,
    perWorkspaceLimit: 2, leaseSeconds: 60, now,
  });
  const summary: WorkerSummary = { claimed: jobs.length, completed: 0, retried: 0, deadLettered: 0, leaseConflicts: 0 };

  for (const job of jobs) {
    let fileId: string | undefined;
    try {
      const deletion = payload(job);
      fileId = deletion.fileId;
      const resolved = await resolveProvider(job.workspaceId);
      if (!resolved) throw new Error('STORAGE_PROVIDER_NOT_CONFIGURED');
      if (resolved.provider.providerName !== deletion.provider) throw new Error('STORAGE_PROVIDER_CHANGED');
      await resolved.provider.deleteObject(deletion.bucket, deletion.objectKey);
      await storageRepository.updatePhysicalDeletion(deletion.fileId, 'completed', Math.max(0, job.attemptCount - 1));
      const completed = await platformJobRepository.complete(job.jobId, workerId, now);
      if (!completed) { summary.leaseConflicts += 1; continue; }
      summary.completed += 1;
    } catch (error) {
      const status = await platformJobRepository.fail({
        jobId: job.jobId, workerId, errorCode: errorCode(error),
        runAfter: new Date(now.getTime() + retryDelayMs(job.attemptCount)), now,
      });
      if (!status) { summary.leaseConflicts += 1; continue; }
      if (fileId) {
        try {
          await storageRepository.updatePhysicalDeletion(
            fileId, status === 'dead_letter' ? 'failed' : 'in_progress', job.attemptCount
          );
        } catch {
          // The durable job already records the retry or dead-letter outcome.
        }
      }
      if (status === 'dead_letter') summary.deadLettered += 1;
      else summary.retried += 1;
    }
  }
  return summary;
}
