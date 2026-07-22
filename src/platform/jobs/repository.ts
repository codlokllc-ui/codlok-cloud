import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { jobStore } from './store';
import type { PlatformJobRecord, PlatformJobStatus, PlatformJobView } from './types';
import { codlokEnvironment } from '@/shared';

function database(): SupabaseClient | null {
  if (process.env.NODE_ENV === 'test') return null;
  const url = process.env.SUPABASE_URL;
  const secret = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !secret) return null;
  return createClient(url, secret, { auth: { persistSession: false, autoRefreshToken: false } });
}

function requireConfigured(db: SupabaseClient | null): void {
  if (!db && process.env.NODE_ENV === 'production') throw new Error('PLATFORM_JOBS_NOT_CONFIGURED');
}

function fromRow(row: Record<string, unknown>): PlatformJobRecord {
  return {
    jobId: String(row.job_id), workspaceId: String(row.workspace_id), module: String(row.module),
    jobType: String(row.job_type), deduplicationKey: String(row.deduplication_key),
    payload: (row.payload ?? {}) as Record<string, unknown>, status: row.status as PlatformJobStatus,
    attemptCount: Number(row.attempt_count), maxAttempts: Number(row.max_attempts),
    runAfter: String(row.run_after), leaseOwner: row.lease_owner == null ? undefined : String(row.lease_owner),
    leaseExpiresAt: row.lease_expires_at == null ? undefined : String(row.lease_expires_at),
    lastErrorCode: row.last_error_code == null ? undefined : String(row.last_error_code),
    replayCount: Number(row.replay_count), createdAt: String(row.created_at), updatedAt: String(row.updated_at),
    claimedAt: row.claimed_at == null ? undefined : String(row.claimed_at),
    completedAt: row.completed_at == null ? undefined : String(row.completed_at),
    deadLetteredAt: row.dead_lettered_at == null ? undefined : String(row.dead_lettered_at),
  };
}

function toView(job: PlatformJobRecord): PlatformJobView {
  return {
    jobId: job.jobId, module: job.module, jobType: job.jobType, status: job.status,
    attemptCount: job.attemptCount, maxAttempts: job.maxAttempts, replayCount: job.replayCount,
    runAfter: job.runAfter, lastErrorCode: job.lastErrorCode ?? null,
    createdAt: job.createdAt, updatedAt: job.updatedAt,
    completedAt: job.completedAt ?? null, deadLetteredAt: job.deadLetteredAt ?? null,
  };
}

export const platformJobRepository = {
  async claim(input: {
    workerId: string; module: string; jobType: string; limit: number;
    perWorkspaceLimit: number; leaseSeconds: number; now?: Date;
  }): Promise<PlatformJobRecord[]> {
    const db = database(); requireConfigured(db);
    if (!db) return jobStore.claim({ ...input, now: input.now ?? new Date() });
    const { data, error } = await db.rpc('codlok_claim_platform_jobs', {
      p_worker_id: input.workerId, p_module: input.module, p_job_type: input.jobType,
      p_limit: input.limit, p_per_workspace_limit: input.perWorkspaceLimit,
      p_lease_seconds: input.leaseSeconds,
    });
    if (error) throw new Error('PLATFORM_JOB_CLAIM_FAILED');
    return (data ?? []).map((row: Record<string, unknown>) => fromRow(row));
  },
  async complete(jobId: string, workerId: string, now = new Date()): Promise<boolean> {
    const db = database(); requireConfigured(db);
    if (!db) return jobStore.complete(jobId, workerId, now);
    const { data, error } = await db.from('codlok_platform_jobs').update({
      status: 'completed', completed_at: now.toISOString(), updated_at: now.toISOString(),
      lease_owner: null, lease_expires_at: null,
    }).eq('job_id', jobId).eq('status', 'running').eq('lease_owner', workerId).select('job_id');
    if (error) throw new Error('PLATFORM_JOB_COMPLETE_FAILED');
    return (data?.length ?? 0) === 1;
  },
  async fail(input: {
    jobId: string; workerId: string; errorCode: string; runAfter: Date; now?: Date;
  }): Promise<PlatformJobStatus | null> {
    const db = database(); requireConfigured(db);
    if (!db) return jobStore.fail(input.jobId, input.workerId, input.errorCode, input.runAfter, input.now ?? new Date());
    const { data, error } = await db.rpc('codlok_fail_platform_job', {
      p_job_id: input.jobId, p_worker_id: input.workerId,
      p_error_code: input.errorCode, p_run_after: input.runAfter.toISOString(),
    });
    if (error) throw new Error('PLATFORM_JOB_FAIL_FAILED');
    return (data as PlatformJobStatus | null) ?? null;
  },
  async list(workspaceId: string, status?: PlatformJobStatus): Promise<PlatformJobView[]> {
    const db = database(); requireConfigured(db);
    if (!db) return jobStore.list(workspaceId).filter((job) => !status || job.status === status).map(toView);
    let query = db.from('codlok_platform_jobs').select([
      'job_id','workspace_id','module','job_type','deduplication_key','payload','status',
      'attempt_count','max_attempts','run_after','lease_owner','lease_expires_at',
      'last_error_code','replay_count','created_at','updated_at','claimed_at',
      'completed_at','dead_lettered_at',
    ].join(',')).eq('workspace_id', workspaceId).order('created_at', { ascending: false }).limit(100);
    if (status) query = query.eq('status', status);
    const { data, error } = await query;
    if (error) throw new Error('PLATFORM_JOB_LIST_FAILED');
    return (data ?? []).map((row) => toView(fromRow(row as unknown as Record<string, unknown>)));
  },
  async replay(input: {
    jobId: string; workspaceId: string; actorUserId: string; reason: string; now?: Date;
  }): Promise<boolean> {
    const db = database(); requireConfigured(db);
    if (!db) return jobStore.replay(input.jobId, input.workspaceId, input.actorUserId, input.reason, input.now ?? new Date());
    const { data, error } = await db.rpc('codlok_replay_platform_job', {
      p_job_id: input.jobId, p_workspace_id: input.workspaceId,
      p_actor_user_id: input.actorUserId, p_reason: input.reason,
      p_environment: codlokEnvironment(),
    });
    if (error) throw new Error('PLATFORM_JOB_REPLAY_FAILED');
    return data === true;
  },
};
