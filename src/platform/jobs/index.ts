import { fail, ok, type StandardResponse } from '@/shared';
import { platformJobRepository } from './repository';
import type { PlatformJobStatus, PlatformJobView } from './types';

const STATUSES = new Set<PlatformJobStatus>(['queued','running','retry_scheduled','completed','dead_letter']);

export async function listPlatformJobs(
  workspaceId: string,
  status?: string
): Promise<StandardResponse<{ items: PlatformJobView[] }>> {
  if (status && !STATUSES.has(status as PlatformJobStatus)) return fail('INVALID_JOB_STATUS', 'Job status is invalid.');
  try {
    return ok({ items: await platformJobRepository.list(workspaceId, status as PlatformJobStatus | undefined) });
  } catch {
    return fail('PLATFORM_JOB_LIST_FAILED', 'Jobs could not be loaded.');
  }
}

export async function replayPlatformJob(input: {
  jobId: string; workspaceId: string; actorUserId: string; reason: string;
}): Promise<StandardResponse<{ jobId: string; status: 'queued' }>> {
  const reason = input.reason.trim();
  if (reason.length < 3 || reason.length > 500) return fail('INVALID_REPLAY_REASON', 'A replay reason between 3 and 500 characters is required.');
  try {
    const replayed = await platformJobRepository.replay({ ...input, reason });
    if (!replayed) return fail('JOB_NOT_REPLAYABLE', 'The job is not dead-lettered, is outside this workspace, or reached its replay limit.');
    return ok({ jobId: input.jobId, status: 'queued' });
  } catch {
    return fail('PLATFORM_JOB_REPLAY_FAILED', 'The job could not be replayed.');
  }
}

export const PlatformJobs = { list: listPlatformJobs, replay: replayPlatformJob };
export type { PlatformJobRecord, PlatformJobStatus, PlatformJobView } from './types';
