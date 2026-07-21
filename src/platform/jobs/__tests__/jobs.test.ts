import { beforeEach, afterAll, describe, expect, test } from 'bun:test';
import { verifyWorkerAuthorization } from '@/platform/jobs/auth';
import { PlatformJobs } from '@/platform/jobs';
import { platformJobRepository } from '@/platform/jobs/repository';
import { jobStore, resetJobStoreForTesting } from '@/platform/jobs/store';
import { processStorageDeletionJobs, retryDelayMs } from '@/platform/jobs/worker';
import { _setProviderForTesting } from '@/modules/storage';
import { MockStorageProvider } from '@/modules/storage/internal/provider';
import { storageRepository } from '@/modules/storage/internal/repository';
import type { PlatformJobRecord } from '@/platform/jobs/types';
import type { StorageProviderAdapter } from '@/modules/storage/internal/types';

const NOW = new Date('2026-07-21T20:00:00.000Z');

function enqueue(overrides: Partial<PlatformJobRecord> = {}): PlatformJobRecord {
  const suffix = Math.random().toString(36).slice(2);
  return jobStore.enqueue({
    jobId: `job_${suffix}`, workspaceId: 'ws-a', module: 'storage',
    jobType: 'storage.physical_delete', deduplicationKey: `delete_${suffix}`,
    payload: { fileId: `file_${suffix}`, provider: 'mock', bucket: 'bucket', objectKey: `key_${suffix}` },
    status: 'queued', attemptCount: 0, maxAttempts: 5, runAfter: NOW.toISOString(),
    replayCount: 0, createdAt: NOW.toISOString(), updatedAt: NOW.toISOString(),
    ...overrides,
  });
}

beforeEach(() => {
  resetJobStoreForTesting();
  _setProviderForTesting(new MockStorageProvider());
  process.env.NODE_ENV = 'test';
});

afterAll(() => _setProviderForTesting(null));

describe('durable shared job claims', () => {
  test('two workers cannot claim the same job', async () => {
    enqueue();
    const [first, second] = await Promise.all([
      platformJobRepository.claim({ workerId: 'worker-one', module: 'storage', jobType: 'storage.physical_delete', limit: 1, perWorkspaceLimit: 2, leaseSeconds: 60, now: NOW }),
      platformJobRepository.claim({ workerId: 'worker-two', module: 'storage', jobType: 'storage.physical_delete', limit: 1, perWorkspaceLimit: 2, leaseSeconds: 60, now: NOW }),
    ]);
    expect(first.length + second.length).toBe(1);
  });

  test('an expired lease is recovered by another worker', async () => {
    const job = enqueue();
    const first = await platformJobRepository.claim({ workerId: 'worker-one', module: 'storage', jobType: 'storage.physical_delete', limit: 1, perWorkspaceLimit: 2, leaseSeconds: 60, now: NOW });
    expect(first[0].attemptCount).toBe(1);
    const recoveredAt = new Date(NOW.getTime() + 61_000);
    const second = await platformJobRepository.claim({ workerId: 'worker-two', module: 'storage', jobType: 'storage.physical_delete', limit: 1, perWorkspaceLimit: 2, leaseSeconds: 60, now: recoveredAt });
    expect(second[0].jobId).toBe(job.jobId);
    expect(second[0].attemptCount).toBe(2);
    expect(await platformJobRepository.complete(job.jobId, 'worker-one', recoveredAt)).toBe(false);
  });

  test('claims are bounded fairly per workspace', async () => {
    enqueue({ jobId: 'a-1', deduplicationKey: 'a-1' });
    enqueue({ jobId: 'a-2', deduplicationKey: 'a-2' });
    enqueue({ jobId: 'a-3', deduplicationKey: 'a-3' });
    enqueue({ jobId: 'b-1', workspaceId: 'ws-b', deduplicationKey: 'b-1' });
    const jobs = await platformJobRepository.claim({ workerId: 'worker-fair', module: 'storage', jobType: 'storage.physical_delete', limit: 4, perWorkspaceLimit: 2, leaseSeconds: 60, now: NOW });
    expect(jobs.filter((job) => job.workspaceId === 'ws-a')).toHaveLength(2);
    expect(jobs.filter((job) => job.workspaceId === 'ws-b')).toHaveLength(1);
  });
});

describe('retry, dead-letter, and replay', () => {
  test('failed attempts are bounded and become dead-lettered', async () => {
    const job = enqueue({ maxAttempts: 2 });
    for (let attempt = 0; attempt < 2; attempt++) {
      const [claimed] = await platformJobRepository.claim({ workerId: `worker-${attempt}`, module: 'storage', jobType: 'storage.physical_delete', limit: 1, perWorkspaceLimit: 2, leaseSeconds: 60, now: NOW });
      const status = await platformJobRepository.fail({ jobId: claimed.jobId, workerId: `worker-${attempt}`, errorCode: 'NORMALIZED_FAILURE', runAfter: NOW, now: NOW });
      expect(status).toBe(attempt === 0 ? 'retry_scheduled' : 'dead_letter');
    }
    expect(jobStore.get(job.jobId)?.lastErrorCode).toBe('NORMALIZED_FAILURE');
  });

  test('owner replay is workspace-scoped, reasoned, and audited', async () => {
    const job = enqueue({ status: 'dead_letter', attemptCount: 5, deadLetteredAt: NOW.toISOString() });
    const denied = await PlatformJobs.replay({ jobId: job.jobId, workspaceId: 'ws-b', actorUserId: 'user-1', reason: 'Provider recovered' });
    expect(denied.success).toBe(false);
    const replayed = await PlatformJobs.replay({ jobId: job.jobId, workspaceId: 'ws-a', actorUserId: 'user-1', reason: 'Provider recovered' });
    expect(replayed.success).toBe(true);
    expect(jobStore.get(job.jobId)?.status).toBe('queued');
    expect(jobStore.auditCount()).toBe(1);
  });

  test('monitoring never returns payloads and is workspace-isolated', async () => {
    enqueue({ workspaceId: 'ws-a' });
    enqueue({ workspaceId: 'ws-b' });
    const listed = await PlatformJobs.list('ws-a');
    expect(listed.success).toBe(true);
    if (!listed.success) return;
    expect(listed.data.items).toHaveLength(1);
    expect(listed.data.items[0]).not.toHaveProperty('payload');
  });
});

describe('Storage deletion worker', () => {
  test('completes a claimed deletion with the configured provider', async () => {
    const job = enqueue();
    const summary = await processStorageDeletionJobs({ workerId: 'worker-success', batchSize: 1, now: NOW });
    expect(summary.completed).toBe(1);
    expect(jobStore.get(job.jobId)?.status).toBe('completed');
  });

  test('keeps the job retryable when physical deletion state cannot be saved', async () => {
    const updatePhysicalDeletion = storageRepository.updatePhysicalDeletion;
    storageRepository.updatePhysicalDeletion = async () => { throw new Error('STORAGE_STATE_SAVE_FAILED'); };
    try {
      const job = enqueue();
      const summary = await processStorageDeletionJobs({ workerId: 'worker-state-failure', batchSize: 1, now: NOW });
      expect(summary.retried).toBe(1);
      expect(jobStore.get(job.jobId)?.status).toBe('retry_scheduled');
      expect(jobStore.get(job.jobId)?.lastErrorCode).toBe('STORAGE_STATE_SAVE_FAILED');
    } finally {
      storageRepository.updatePhysicalDeletion = updatePhysicalDeletion;
    }
  });

  test('persists only a normalized failure code', async () => {
    class FailingProvider extends MockStorageProvider implements StorageProviderAdapter {
      override async deleteObject(): Promise<void> { throw new Error('raw provider secret details'); }
    }
    _setProviderForTesting(new FailingProvider());
    const job = enqueue();
    const summary = await processStorageDeletionJobs({ workerId: 'worker-failure', batchSize: 1, now: NOW });
    expect(summary.retried).toBe(1);
    const stored = jobStore.get(job.jobId);
    expect(stored?.lastErrorCode).toBe('STORAGE_PROVIDER_DELETE_FAILED');
    expect(JSON.stringify(stored)).not.toContain('raw provider secret details');
  });

  test('retry delay is immediate in tests and bounded in production', () => {
    expect(retryDelayMs(1)).toBe(0);
    const previous = process.env.NODE_ENV;
    process.env.NODE_ENV = 'production';
    expect(retryDelayMs(1)).toBe(30_000);
    expect(retryDelayMs(20)).toBe(3_600_000);
    process.env.NODE_ENV = previous;
  });
});

describe('worker authentication', () => {
  const secret = 'a-secure-worker-secret-with-32-characters';
  test('accepts only the configured bearer secret', () => {
    expect(verifyWorkerAuthorization(`Bearer ${secret}`, secret)).toBe(true);
    expect(verifyWorkerAuthorization('Bearer wrong', secret)).toBe(false);
    expect(verifyWorkerAuthorization(null, secret)).toBe(false);
  });

  test('rejects missing and weak configured secrets', () => {
    expect(verifyWorkerAuthorization(`Bearer ${secret}`, undefined)).toBe(false);
    expect(verifyWorkerAuthorization('Bearer short', 'short')).toBe(false);
  });
});
