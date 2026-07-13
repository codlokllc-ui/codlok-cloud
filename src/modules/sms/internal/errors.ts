/**
 * Codlok Cloud — SMS Module — Codlok-Standard Error Codes
 *
 * Per Master Spec §22 Public Interface. Namespaced with SMS_ prefix.
 *
 * This file is internal to the SMS module.
 */

export const SmsErrorCode = {
  // sendSms
  WORKSPACE_NOT_FOUND: 'WORKSPACE_NOT_FOUND',
  INVALID_RECIPIENT: 'INVALID_RECIPIENT',
  INVALID_CONTENT: 'INVALID_CONTENT',
  MESSAGE_TOO_LONG: 'MESSAGE_TOO_LONG',
  IDEMPOTENCY_KEY_REQUIRED: 'IDEMPOTENCY_KEY_REQUIRED',
  RECIPIENT_OPTED_OUT: 'RECIPIENT_OPTED_OUT',
  PROVIDER_NOT_CONFIGURED: 'PROVIDER_NOT_CONFIGURED',
  SEND_FAILED: 'SEND_FAILED',

  // getSms
  SMS_NOT_FOUND: 'SMS_NOT_FOUND',

  // processWebhook
  WEBHOOK_EVENT_ALREADY_PROCESSED: 'WEBHOOK_EVENT_ALREADY_PROCESSED',

  // Catch-all
  INTERNAL_ERROR: 'INTERNAL_ERROR',
} as const;

export type SmsErrorCodeValue =
  (typeof SmsErrorCode)[keyof typeof SmsErrorCode];
