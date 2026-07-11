/**
 * Codlok Cloud — Mail Module — Codlok-Standard Error Codes
 *
 * Per Master Spec §17 Public Interface. Namespaced with MAIL_ prefix.
 *
 * This file is internal to the Mail module — only index.ts imports from here.
 */

export const MailErrorCode = {
  // sendVerificationEmail / sendPasswordResetEmail / sendInvitationEmail
  INVALID_RECIPIENT: 'INVALID_RECIPIENT',
  PROVIDER_NOT_CONFIGURED: 'PROVIDER_NOT_CONFIGURED',

  // getDeliveryStatus
  MESSAGE_NOT_FOUND: 'MESSAGE_NOT_FOUND',

  // Catch-all
  INTERNAL_ERROR: 'INTERNAL_ERROR',
} as const;

export type MailErrorCodeValue =
  (typeof MailErrorCode)[keyof typeof MailErrorCode];
