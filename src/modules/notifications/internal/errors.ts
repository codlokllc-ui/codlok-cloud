/**
 * Codlok Cloud — Notifications Module — Codlok-Standard Error Codes
 *
 * Per Master Spec §21 Public Interface. Namespaced with NOTIF_ prefix.
 *
 * This file is internal to the Notifications module.
 */

export const NotificationErrorCode = {
  // sendNotification
  WORKSPACE_NOT_FOUND: 'WORKSPACE_NOT_FOUND',
  INVALID_RECIPIENT: 'INVALID_RECIPIENT',
  INVALID_CONTENT: 'INVALID_CONTENT',
  NO_AVAILABLE_CHANNEL: 'NO_AVAILABLE_CHANNEL',
  PROVIDER_NOT_CONFIGURED: 'PROVIDER_NOT_CONFIGURED',
  IDEMPOTENCY_KEY_REQUIRED: 'IDEMPOTENCY_KEY_REQUIRED',

  // getNotification / cancelNotification
  NOTIFICATION_NOT_FOUND: 'NOTIFICATION_NOT_FOUND',
  NOTIFICATION_ALREADY_DISPATCHING: 'NOTIFICATION_ALREADY_DISPATCHING',

  // Catch-all
  INTERNAL_ERROR: 'INTERNAL_ERROR',
} as const;

export type NotificationErrorCodeValue =
  (typeof NotificationErrorCode)[keyof typeof NotificationErrorCode];
