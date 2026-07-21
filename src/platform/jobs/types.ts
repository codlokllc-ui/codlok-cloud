export type PlatformJobStatus =
  | 'queued'
  | 'running'
  | 'retry_scheduled'
  | 'completed'
  | 'dead_letter';

export interface PlatformJobRecord {
  jobId: string;
  workspaceId: string;
  module: string;
  jobType: string;
  deduplicationKey: string;
  payload: Record<string, unknown>;
  status: PlatformJobStatus;
  attemptCount: number;
  maxAttempts: number;
  runAfter: string;
  leaseOwner?: string;
  leaseExpiresAt?: string;
  lastErrorCode?: string;
  replayCount: number;
  createdAt: string;
  updatedAt: string;
  claimedAt?: string;
  completedAt?: string;
  deadLetteredAt?: string;
}

export interface PlatformJobView {
  jobId: string;
  module: string;
  jobType: string;
  status: PlatformJobStatus;
  attemptCount: number;
  maxAttempts: number;
  replayCount: number;
  runAfter: string;
  lastErrorCode: string | null;
  createdAt: string;
  updatedAt: string;
  completedAt: string | null;
  deadLetteredAt: string | null;
}
