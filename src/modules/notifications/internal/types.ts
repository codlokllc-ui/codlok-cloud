/**
 * Codlok Cloud — Notifications Module — Internal Types (INTERNAL)
 *
 * Per Master Spec §21. This file is internal to the Notifications module.
 *
 * Per §21 Content Ownership (fork 3a): Notifications never rewrites,
 * summarizes, truncates, interpolates, localizes, or generates from
 * templates. Content is stored as-is from the caller.
 *
 * Per §21 Recipient Data: held only transiently for dispatch, never
 * persisted as a system of record.
 */

// ---------------------------------------------------------------------------
// Channels
// ---------------------------------------------------------------------------

export type ChannelType = 'email' | 'sms' | 'push';

// ---------------------------------------------------------------------------
// Notification request (caller-supplied)
// ---------------------------------------------------------------------------

export interface Recipient {
  email?: string;
  phone?: string;
  pushToken?: string;
}

export interface EmailContent {
  subject: string;
  body: string;
}

export interface SmsContent {
  body: string;
}

export interface PushContent {
  title: string;
  body: string;
}

export interface NotificationContent {
  email?: EmailContent;
  sms?: SmsContent;
  push?: PushContent;
}

export interface NotificationRequest {
  recipient: Recipient;
  content: NotificationContent;
  metadata?: Record<string, string>;
}

// ---------------------------------------------------------------------------
// Overall status (§21 line 1110)
// ---------------------------------------------------------------------------

export type OverallStatus =
  | 'queued'
  | 'dispatching'
  | 'completed'
  | 'cancelled';

// ---------------------------------------------------------------------------
// Per-channel status
// ---------------------------------------------------------------------------

export type ChannelStatus = 'pending' | 'dispatched' | 'failed' | 'skipped';

export interface ChannelResult {
  status: ChannelStatus;
  /** messageId from the transport module (e.g. Mail's messageId). */
  messageId?: string;
  /** Error code if status is 'failed'. */
  errorCode?: string;
}

// ---------------------------------------------------------------------------
// Notification record
// ---------------------------------------------------------------------------

export interface NotificationRecord {
  notificationId: string;
  workspaceId: string;
  overallStatus: OverallStatus;
  /**
   * Per-channel dispatch results. Only channels in the dispatch plan
   * are present. Each transport module is called at most once.
   */
  channels: {
    email?: ChannelResult;
    sms?: ChannelResult;
    push?: ChannelResult;
  };
  /** Idempotency key (required, permanent retention). */
  idempotencyKey: string;
  createdAt: string;
  updatedAt: string;
  /** Transient recipient — held for dispatch only, NOT persisted as SoR. */
  _transientRecipient?: Recipient;
  /** Transient content — held for dispatch only, NOT persisted as SoR. */
  _transientContent?: NotificationContent;
  /** Transient metadata. */
  _transientMetadata?: Record<string, string>;
}

// ---------------------------------------------------------------------------
// Workspace preferences (channel enabled/disabled per workspace)
// ---------------------------------------------------------------------------

export interface WorkspacePreferences {
  emailEnabled: boolean;
  smsEnabled: boolean;
  pushEnabled: boolean;
}

// ---------------------------------------------------------------------------
// NotificationError — internal exception
// ---------------------------------------------------------------------------

export class NotificationError extends Error {
  constructor(
    public readonly code: string,
    message: string
  ) {
    super(message);
    this.name = 'NotificationError';
  }
}
