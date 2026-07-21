import type { PlatformJobRecord, PlatformJobStatus } from './types';

interface JobStore {
  jobs: Map<string, PlatformJobRecord>;
  audit: Array<{ workspaceId: string; jobId: string; actorUserId: string; reason: string }>;
}

const KEY = Symbol.for('codlok.platform.jobs.store.v1');

function state(): JobStore {
  const global = globalThis as Record<symbol, unknown>;
  if (!global[KEY]) global[KEY] = { jobs: new Map(), audit: [] } satisfies JobStore;
  return global[KEY] as JobStore;
}

export function resetJobStoreForTesting(): void {
  const global = globalThis as Record<symbol, unknown>;
  global[KEY] = { jobs: new Map(), audit: [] } satisfies JobStore;
}

export const jobStore = {
  enqueue(job: PlatformJobRecord): PlatformJobRecord {
    const existing = [...state().jobs.values()].find((item) =>
      item.workspaceId === job.workspaceId && item.module === job.module &&
      item.jobType === job.jobType && item.deduplicationKey === job.deduplicationKey);
    if (existing) return existing;
    state().jobs.set(job.jobId, structuredClone(job));
    return job;
  },
  claim(input: {
    workerId: string; module: string; jobType: string; limit: number;
    perWorkspaceLimit: number; leaseSeconds: number; now: Date;
  }): PlatformJobRecord[] {
    const nowMs = input.now.getTime();
    for (const job of state().jobs.values()) {
      if (job.module !== input.module || job.jobType !== input.jobType) continue;
      if (job.status === 'running' && new Date(job.leaseExpiresAt ?? 0).getTime() <= nowMs && job.attemptCount >= job.maxAttempts) {
        job.status = 'dead_letter';
        job.lastErrorCode ??= 'LEASE_EXPIRED';
        job.deadLetteredAt = input.now.toISOString();
        job.leaseOwner = undefined;
        job.leaseExpiresAt = undefined;
        job.updatedAt = input.now.toISOString();
      }
    }
    const counts = new Map<string, number>();
    const due = [...state().jobs.values()].filter((job) => {
      if (job.module !== input.module || job.jobType !== input.jobType || job.attemptCount >= job.maxAttempts) return false;
      if (job.status === 'queued' || job.status === 'retry_scheduled') return new Date(job.runAfter).getTime() <= nowMs;
      return job.status === 'running' && new Date(job.leaseExpiresAt ?? 0).getTime() <= nowMs;
    }).sort((a, b) => a.runAfter.localeCompare(b.runAfter) || a.createdAt.localeCompare(b.createdAt) || a.jobId.localeCompare(b.jobId));
    const claimed: PlatformJobRecord[] = [];
    for (const job of due) {
      if (claimed.length >= input.limit) break;
      const workspaceCount = counts.get(job.workspaceId) ?? 0;
      if (workspaceCount >= input.perWorkspaceLimit) continue;
      counts.set(job.workspaceId, workspaceCount + 1);
      job.status = 'running';
      job.attemptCount += 1;
      job.leaseOwner = input.workerId;
      job.leaseExpiresAt = new Date(nowMs + input.leaseSeconds * 1000).toISOString();
      job.claimedAt = input.now.toISOString();
      job.updatedAt = input.now.toISOString();
      job.lastErrorCode = undefined;
      claimed.push(structuredClone(job));
    }
    return claimed;
  },
  complete(jobId: string, workerId: string, now: Date): boolean {
    const job = state().jobs.get(jobId);
    if (!job || job.status !== 'running' || job.leaseOwner !== workerId) return false;
    job.status = 'completed';
    job.completedAt = now.toISOString();
    job.updatedAt = now.toISOString();
    job.leaseOwner = undefined;
    job.leaseExpiresAt = undefined;
    return true;
  },
  fail(jobId: string, workerId: string, errorCode: string, runAfter: Date, now: Date): PlatformJobStatus | null {
    const job = state().jobs.get(jobId);
    if (!job || job.status !== 'running' || job.leaseOwner !== workerId) return null;
    job.status = job.attemptCount >= job.maxAttempts ? 'dead_letter' : 'retry_scheduled';
    job.runAfter = runAfter.toISOString();
    job.lastErrorCode = errorCode.slice(0, 100);
    job.updatedAt = now.toISOString();
    job.leaseOwner = undefined;
    job.leaseExpiresAt = undefined;
    if (job.status === 'dead_letter') job.deadLetteredAt = now.toISOString();
    return job.status;
  },
  list(workspaceId: string): PlatformJobRecord[] {
    return [...state().jobs.values()].filter((job) => job.workspaceId === workspaceId)
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt) || b.jobId.localeCompare(a.jobId))
      .map((job) => structuredClone(job));
  },
  replay(jobId: string, workspaceId: string, actorUserId: string, reason: string, now: Date): boolean {
    const job = state().jobs.get(jobId);
    if (!job || job.workspaceId !== workspaceId || job.status !== 'dead_letter' || job.replayCount >= 5) return false;
    job.status = 'queued';
    job.attemptCount = 0;
    job.runAfter = now.toISOString();
    job.lastErrorCode = undefined;
    job.deadLetteredAt = undefined;
    job.replayCount += 1;
    job.updatedAt = now.toISOString();
    state().audit.push({ workspaceId, jobId, actorUserId, reason });
    return true;
  },
  get(jobId: string): PlatformJobRecord | undefined {
    const job = state().jobs.get(jobId);
    return job ? structuredClone(job) : undefined;
  },
  auditCount(): number { return state().audit.length; },
};
