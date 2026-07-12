/**
 * Codlok Cloud — Verify Module — Codlok-Standard Error Codes
 *
 * Per Master Spec §20 Public Interface. Namespaced with VERIFY_ prefix.
 *
 * This file is internal to the Verify module — only index.ts imports from here.
 */

export const VerifyErrorCode = {
  // createVerificationSession
  INVALID_VERIFICATION_TYPE: 'INVALID_VERIFICATION_TYPE',
  WORKSPACE_NOT_FOUND: 'WORKSPACE_NOT_FOUND',
  PROVIDER_NOT_CONFIGURED: 'PROVIDER_NOT_CONFIGURED',
  IDEMPOTENCY_KEY_REQUIRED: 'IDEMPOTENCY_KEY_REQUIRED',

  // getVerificationStatus
  VERIFICATION_NOT_FOUND: 'VERIFICATION_NOT_FOUND',

  // Webhook
  WEBHOOK_SIGNATURE_INVALID: 'WEBHOOK_SIGNATURE_INVALID',

  // Catch-all
  INTERNAL_ERROR: 'INTERNAL_ERROR',
} as const;

export type VerifyErrorCodeValue =
  (typeof VerifyErrorCode)[keyof typeof VerifyErrorCode];
