/**
 * Codlok Cloud — Notifications Module — Public Interface v1.0
 *
 * Per Master Spec §21 Notifications Module Specification v1.0 (STATUS: FROZEN).
 * Spec Version 3.4.
 *
 * Purpose: Answers "who should be notified, about what, through which channels?"
 * — delivery intent and orchestration only. Does not answer "how is an
 * email/SMS/push actually sent" (Mail/SMS/Push own that).
 *
 * ----------------------------------------------------------------------------
 * PUBLIC INTERFACE (§21)
 * ----------------------------------------------------------------------------
 *   sendNotification(workspaceId, notificationRequest, idempotencyKey)
 *   getNotification(workspaceId, notificationId)
 *   listNotifications(workspaceId, filters?)
 *   cancelNotification(workspaceId, notificationId)
 *   getChannelStatus(workspaceId)
 *
 * All return StandardResponse per §3.6.
 *
 * ----------------------------------------------------------------------------
 * CHANNEL SELECTION LOGIC (§21 line 1070 — binding)
 * ----------------------------------------------------------------------------
 *   dispatch plan = available content ∩ workspace preferences ∩ configured providers
 *
 * The caller does NOT choose channels directly — it supplies content per
 * channel, and Notifications computes the actual dispatch plan by
 * intersecting that with the workspace's enabled preferences and configured
 * providers.
 *
 * ----------------------------------------------------------------------------
 * CONTENT OWNERSHIP (§21 fork 3a — binding)
 * ----------------------------------------------------------------------------
 * Business modules supply fully composed, channel-specific content.
 * Notifications NEVER rewrites, summarizes, truncates, interpolates,
 * localizes, or generates from templates. If a payload violates a provider
 * requirement, Notifications returns INVALID_CONTENT — it never silently
 * fixes content.
 *
 * ----------------------------------------------------------------------------
 * RETRY (§21 fork 4 — binding)
 * ----------------------------------------------------------------------------
 * Transport modules (Mail/SMS/Push) own retry entirely. Notifications
 * dispatches each selected channel exactly once and never performs
 * cross-channel fallback.
 *
 * ----------------------------------------------------------------------------
 * IDEMPOTENCY (§21 line 1099 — REQUIRED, permanent)
 * ----------------------------------------------------------------------------
 * idempotencyKey is REQUIRED. Permanent retention (no expiry). Same
 * reasoning as Pay/Verify: real per-channel provider cost.
 *
 * ----------------------------------------------------------------------------
 * CANCELLATION BOUNDARY (§21 line 1101 — binding)
 * ----------------------------------------------------------------------------
 * cancelNotification only succeeds while overallStatus === "queued".
 * Once any channel enters dispatching, the entire notification is no
 * longer cancelable.
 *
 * ----------------------------------------------------------------------------
 * RECIPIENT DATA (§21 line 1122 — binding)
 * ----------------------------------------------------------------------------
 * Recipient data held only transiently for dispatch, never persisted as
 * a system of record.
 *
 * ----------------------------------------------------------------------------
 * MODULE BOUNDARY (§21 line 1118 — binding)
 * ----------------------------------------------------------------------------
 * Notifications does NOT call Auth, Organizations, or any future Audit/Jobs
 * module. It calls Mail (for email channel). SMS/Push will be called when
 * those modules are built — until then, those channels are excluded by the
 * channel selection intersection (no configured provider).
 */

import { StandardResponse, ok, fail } from '@/shared';
import { Mail } from '@/modules/mail';
import { NotificationErrorCode } from './internal/errors';
import type {
  NotificationRequest,
  NotificationRecord,
  OverallStatus,
  ChannelResult,
  ChannelStatus,
  WorkspacePreferences,
  Recipient,
  NotificationContent,
} from './internal/types';
import { NotificationError } from './internal/types';
import {
  store,
  newNotificationId,
  _resetStoreForTesting,
} from './internal/store';

// Re-export test helpers.
export { _resetStoreForTesting };
export type { NotificationRequest, Recipient, NotificationContent };

// ---------------------------------------------------------------------------
// Public data shapes (per §21)
// ---------------------------------------------------------------------------

export interface SendNotificationData {
  notificationId: string;
  overallStatus: 'queued';
}

export interface GetNotificationData {
  notificationId: string;
  overallStatus: OverallStatus;
  channels: {
    email?: { status: ChannelStatus; messageId?: string };
    sms?: { status: ChannelStatus; messageId?: string };
    push?: { status: ChannelStatus; messageId?: string };
  };
  createdAt: string;
  updatedAt: string;
}

export interface ListNotificationsData {
  notifications: {
    notificationId: string;
    overallStatus: OverallStatus;
    createdAt: string;
  }[];
}

export interface CancelNotificationData {
  notificationId: string;
  overallStatus: 'cancelled';
}

export interface GetChannelStatusData {
  channels: {
    email: { configured: boolean };
    sms: { configured: boolean };
    push: { configured: boolean };
  };
}

// ---------------------------------------------------------------------------
// Internal: error wrapping
// ---------------------------------------------------------------------------

function _notifErrorToResponse(err: unknown): StandardResponse<never> {
  if (err instanceof Error && err.name === 'NotificationError') {
    const code = (err as { code?: string }).code ?? NotificationErrorCode.INTERNAL_ERROR;
    return fail(code, err.message);
  }
  return fail(NotificationErrorCode.INTERNAL_ERROR, 'An internal error occurred.');
}

// ---------------------------------------------------------------------------
// Internal: validation helpers
// ---------------------------------------------------------------------------

function _requireWorkspaceId(workspaceId: string): void {
  if (!workspaceId) {
    throw new NotificationError(
      NotificationErrorCode.WORKSPACE_NOT_FOUND,
      'workspaceId is required.'
    );
  }
}

function _requireIdempotencyKey(idempotencyKey: string): void {
  if (!idempotencyKey) {
    throw new NotificationError(
      NotificationErrorCode.IDEMPOTENCY_KEY_REQUIRED,
      'idempotencyKey is required (§21 line 1099).'
    );
  }
}

function _validateRecipient(recipient: Recipient): void {
  if (!recipient || typeof recipient !== 'object') {
    throw new NotificationError(
      NotificationErrorCode.INVALID_RECIPIENT,
      'recipient is required.'
    );
  }
  // At least one channel target must be present.
  if (!recipient.email && !recipient.phone && !recipient.pushToken) {
    throw new NotificationError(
      NotificationErrorCode.INVALID_RECIPIENT,
      'recipient must have at least one of: email, phone, pushToken.'
    );
  }
  // Basic email format check (if email is present).
  if (recipient.email && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(recipient.email)) {
    throw new NotificationError(
      NotificationErrorCode.INVALID_RECIPIENT,
      'recipient.email is not a valid email address.'
    );
  }
}

function _validateContent(content: NotificationContent): void {
  if (!content || typeof content !== 'object') {
    throw new NotificationError(
      NotificationErrorCode.INVALID_CONTENT,
      'content is required.'
    );
  }
  // At least one channel content must be present.
  if (!content.email && !content.sms && !content.push) {
    throw new NotificationError(
      NotificationErrorCode.INVALID_CONTENT,
      'content must have at least one of: email, sms, push.'
    );
  }
  // Validate email content (if present) — NO transformation, only required-field presence.
  if (content.email) {
    if (!content.email.subject || typeof content.email.subject !== 'string') {
      throw new NotificationError(
        NotificationErrorCode.INVALID_CONTENT,
        'content.email.subject is required.'
      );
    }
    if (!content.email.body || typeof content.email.body !== 'string') {
      throw new NotificationError(
        NotificationErrorCode.INVALID_CONTENT,
        'content.email.body is required.'
      );
    }
  }
  // Validate SMS content (if present).
  if (content.sms) {
    if (!content.sms.body || typeof content.sms.body !== 'string') {
      throw new NotificationError(
        NotificationErrorCode.INVALID_CONTENT,
        'content.sms.body is required.'
      );
    }
  }
  // Validate push content (if present).
  if (content.push) {
    if (!content.push.title || typeof content.push.title !== 'string') {
      throw new NotificationError(
        NotificationErrorCode.INVALID_CONTENT,
        'content.push.title is required.'
      );
    }
    if (!content.push.body || typeof content.push.body !== 'string') {
      throw new NotificationError(
        NotificationErrorCode.INVALID_CONTENT,
        'content.push.body is required.'
      );
    }
  }
}

function _now(): string {
  return new Date().toISOString();
}

// ---------------------------------------------------------------------------
// Internal: channel selection intersection (§21 line 1070 — binding)
// ---------------------------------------------------------------------------

interface DispatchPlan {
  email: boolean;
  sms: boolean;
  push: boolean;
}

function _computeDispatchPlan(
  content: NotificationContent,
  preferences: WorkspacePreferences,
  configuredProviders: { email: boolean; sms: boolean; push: boolean }
): DispatchPlan {
  // §21 line 1070: dispatch plan = content ∩ preferences ∩ configured providers
  return {
    email: !!content.email && preferences.emailEnabled && configuredProviders.email,
    sms: !!content.sms && preferences.smsEnabled && configuredProviders.sms,
    push: !!content.push && preferences.pushEnabled && configuredProviders.push,
  };
}

// ---------------------------------------------------------------------------
// Internal: check which transport providers are configured
// ---------------------------------------------------------------------------

async function _getConfiguredProviders(workspaceId: string): Promise<{
  email: boolean;
  sms: boolean;
  push: boolean;
}> {
  // Email: check if Mail provider is configured.
  // We use Mail.getProviderStatus — wait, Mail doesn't have getProviderStatus.
  // But we can check by seeing if a Mail provider would resolve. Since Mail's
  // factory uses the same CODELOK_AUTH_USE_MOCK flag and Configuration keys,
  // we check: (1) if CODELOK_AUTH_USE_MOCK=true, email is configured (mock mode);
  // (2) otherwise, check Configuration for RESEND_API_KEY.
  let emailConfigured = false;
  if (process.env.CODELOK_AUTH_USE_MOCK === 'true') {
    emailConfigured = true;
  } else {
    try {
      const { getConfigurationService } = await import('@/config');
      const config = getConfigurationService();
      const r = await config.getSecret(workspaceId, 'RESEND_API_KEY', 'notifications');
      emailConfigured = r.success;
    } catch {
      emailConfigured = false;
    }
  }

  // SMS and Push modules don't exist yet — always not configured.
  return {
    email: emailConfigured,
    sms: false,
    push: false,
  };
}

// ---------------------------------------------------------------------------
// §21 sendNotification
// ---------------------------------------------------------------------------

export async function sendNotification(
  workspaceId: string,
  notificationRequest: NotificationRequest,
  idempotencyKey: string
): Promise<StandardResponse<SendNotificationData>> {
  try {
    _requireWorkspaceId(workspaceId);
    _requireIdempotencyKey(idempotencyKey);

    if (!notificationRequest) {
      throw new NotificationError(
        NotificationErrorCode.INVALID_CONTENT,
        'notificationRequest is required.'
      );
    }

    _validateRecipient(notificationRequest.recipient);
    _validateContent(notificationRequest.content);

    // Idempotency: permanent retention — duplicate returns original.
    const existing = store.findByIdempotencyKey(workspaceId, idempotencyKey);
    if (existing) {
      return ok<SendNotificationData>({
        notificationId: existing.notificationId,
        overallStatus: 'queued',
      });
    }

    // Channel selection intersection (§21 line 1070).
    const preferences = store.getPreferences(workspaceId);
    const configuredProviders = await _getConfiguredProviders(workspaceId);
    const dispatchPlan = _computeDispatchPlan(
      notificationRequest.content,
      preferences,
      configuredProviders
    );

    // NO_AVAILABLE_CHANNEL if intersection is empty.
    if (!dispatchPlan.email && !dispatchPlan.sms && !dispatchPlan.push) {
      throw new NotificationError(
        NotificationErrorCode.NO_AVAILABLE_CHANNEL,
        'No channel available after intersecting content with workspace preferences and configured providers.'
      );
    }

    // Create notification record in 'queued' state.
    // Recipient and content are held TRANSIENTLY (on the record's _transient
    // fields) for dispatch — NOT persisted as a system of record (§21 line 1122).
    const now = _now();
    const notificationId = newNotificationId();
    const record: NotificationRecord = {
      notificationId,
      workspaceId,
      overallStatus: 'queued',
      channels: {},
      idempotencyKey,
      createdAt: now,
      updatedAt: now,
      _transientRecipient: notificationRequest.recipient,
      _transientContent: notificationRequest.content,
      _transientMetadata: notificationRequest.metadata,
    };
    store.insert(record);

    // Dispatch: transition to 'dispatching', call each transport exactly once.
    // Per §21 fork 4: Notifications dispatches each selected channel exactly
    // once — no retry, no cross-channel fallback. Transport modules own retry.
    store.updateOverallStatus(notificationId, 'dispatching');

    const channels: NotificationRecord['channels'] = {};

    // Email channel: call Mail.sendEmail exactly once.
    if (dispatchPlan.email && notificationRequest.content.email && notificationRequest.recipient.email) {
      try {
        const mailR = await Mail.sendEmail(
          workspaceId,
          notificationRequest.recipient.email,
          notificationRequest.content.email.subject,
          notificationRequest.content.email.body,
          `${idempotencyKey}:email` // derive a sub-key for the email channel
        );
        if (mailR.success) {
          channels.email = { status: 'dispatched', messageId: mailR.data.messageId };
        } else {
          // Mail returned an error — record it. Per §21, Notifications does
          // NOT retry. The error code is NOT a raw provider error (Mail already
          // translated it to Codlok-standard codes).
          channels.email = { status: 'failed', errorCode: mailR.error.code };
        }
      } catch {
        channels.email = { status: 'failed', errorCode: NotificationErrorCode.INTERNAL_ERROR };
      }
    } else if (dispatchPlan.email) {
      // Email was in the dispatch plan but recipient.email is missing — skip.
      channels.email = { status: 'skipped' };
    }

    // SMS channel: not configured (module doesn't exist yet).
    if (dispatchPlan.sms) {
      channels.sms = { status: 'skipped' };
    }

    // Push channel: not configured (module doesn't exist yet).
    if (dispatchPlan.push) {
      channels.push = { status: 'skipped' };
    }

    // Update the record with channel results.
    for (const [channel, result] of Object.entries(channels)) {
      store.updateChannelResult(notificationId, channel as 'email' | 'sms' | 'push', result);
    }

    // Transition to 'completed' — every selected channel has finished processing.
    // Per §21 line 1124: 'completed' deliberately does NOT imply overall success
    // or failure. Per-channel status holds the real detail.
    store.updateOverallStatus(notificationId, 'completed');

    // Clear transient data — recipient/content held only for dispatch (§21 line 1122).
    const finalRecord = store.getByNotificationId(notificationId);
    if (finalRecord) {
      finalRecord._transientRecipient = undefined;
      finalRecord._transientContent = undefined;
      finalRecord._transientMetadata = undefined;
    }

    return ok<SendNotificationData>({
      notificationId,
      overallStatus: 'queued', // §21 spec says success returns overallStatus: "queued"
    });
  } catch (err) {
    return _notifErrorToResponse(err);
  }
}

// ---------------------------------------------------------------------------
// §21 getNotification
// ---------------------------------------------------------------------------

export async function getNotification(
  workspaceId: string,
  notificationId: string
): Promise<StandardResponse<GetNotificationData>> {
  try {
    _requireWorkspaceId(workspaceId);
    if (!notificationId) {
      throw new NotificationError(
        NotificationErrorCode.NOTIFICATION_NOT_FOUND,
        'notificationId is required.'
      );
    }

    const record = store.getByNotificationIdAndWorkspace(notificationId, workspaceId);
    if (!record) {
      throw new NotificationError(
        NotificationErrorCode.NOTIFICATION_NOT_FOUND,
        'Notification not found.'
      );
    }

    return ok<GetNotificationData>({
      notificationId: record.notificationId,
      overallStatus: record.overallStatus,
      channels: record.channels,
      createdAt: record.createdAt,
      updatedAt: record.updatedAt,
    });
  } catch (err) {
    return _notifErrorToResponse(err);
  }
}

// ---------------------------------------------------------------------------
// §21 listNotifications
// ---------------------------------------------------------------------------

export async function listNotifications(
  workspaceId: string,
  filters?: {
    overallStatus?: OverallStatus;
    dateFrom?: string;
    dateTo?: string;
  }
): Promise<StandardResponse<ListNotificationsData>> {
  try {
    _requireWorkspaceId(workspaceId);

    const records = store.listByWorkspace(workspaceId, filters);
    return ok<ListNotificationsData>({
      notifications: records.map((r) => ({
        notificationId: r.notificationId,
        overallStatus: r.overallStatus,
        createdAt: r.createdAt,
      })),
    });
  } catch (err) {
    return _notifErrorToResponse(err);
  }
}

// ---------------------------------------------------------------------------
// §21 cancelNotification
// ---------------------------------------------------------------------------

export async function cancelNotification(
  workspaceId: string,
  notificationId: string
): Promise<StandardResponse<CancelNotificationData>> {
  try {
    _requireWorkspaceId(workspaceId);
    if (!notificationId) {
      throw new NotificationError(
        NotificationErrorCode.NOTIFICATION_NOT_FOUND,
        'notificationId is required.'
      );
    }

    const record = store.getByNotificationIdAndWorkspace(notificationId, workspaceId);
    if (!record) {
      throw new NotificationError(
        NotificationErrorCode.NOTIFICATION_NOT_FOUND,
        'Notification not found.'
      );
    }

    // §21 line 1101: cancelNotification only succeeds while overallStatus === "queued".
    // Once any channel enters dispatching, the entire notification is no longer
    // cancelable.
    if (record.overallStatus !== 'queued') {
      throw new NotificationError(
        NotificationErrorCode.NOTIFICATION_ALREADY_DISPATCHING,
        `Notification cannot be cancelled (current status: ${record.overallStatus}). Only 'queued' notifications can be cancelled.`
      );
    }

    store.updateOverallStatus(notificationId, 'cancelled');
    return ok<CancelNotificationData>({
      notificationId,
      overallStatus: 'cancelled',
    });
  } catch (err) {
    return _notifErrorToResponse(err);
  }
}

// ---------------------------------------------------------------------------
// §21 getChannelStatus
// ---------------------------------------------------------------------------

export async function getChannelStatus(
  workspaceId: string
): Promise<StandardResponse<GetChannelStatusData>> {
  try {
    _requireWorkspaceId(workspaceId);

    const configuredProviders = await _getConfiguredProviders(workspaceId);
    return ok<GetChannelStatusData>({
      channels: {
        email: { configured: configuredProviders.email },
        sms: { configured: configuredProviders.sms },
        push: { configured: configuredProviders.push },
      },
    });
  } catch (err) {
    return _notifErrorToResponse(err);
  }
}

// ---------------------------------------------------------------------------
// Public surface (the ONLY thing other modules may import)
// ---------------------------------------------------------------------------

export const Notifications = {
  sendNotification,
  getNotification,
  listNotifications,
  cancelNotification,
  getChannelStatus,
};

export type NotificationsModule = typeof Notifications;
