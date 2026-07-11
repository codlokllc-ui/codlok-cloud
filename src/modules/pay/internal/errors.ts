/**
 * Codlok Cloud — Pay Module — Codlok-Standard Error Codes
 *
 * Per Master Spec §19 Public Interface. Namespaced with PAY_ prefix.
 *
 * This file is internal to the Pay module — only index.ts imports from here.
 */

export const PayErrorCode = {
  // createPayment
  INVALID_AMOUNT: 'INVALID_AMOUNT',
  INVALID_CURRENCY: 'INVALID_CURRENCY',
  WORKSPACE_NOT_FOUND: 'WORKSPACE_NOT_FOUND',
  PROVIDER_NOT_CONFIGURED: 'PROVIDER_NOT_CONFIGURED',
  IDEMPOTENCY_KEY_REQUIRED: 'IDEMPOTENCY_KEY_REQUIRED',

  // getPayment / refundPayment / listRefunds
  PAYMENT_NOT_FOUND: 'PAYMENT_NOT_FOUND',
  PAYMENT_NOT_REFUNDABLE: 'PAYMENT_NOT_REFUNDABLE',
  REFUND_EXCEEDS_REMAINING: 'REFUND_EXCEEDS_REMAINING',

  // Webhook
  WEBHOOK_EVENT_ALREADY_PROCESSED: 'WEBHOOK_EVENT_ALREADY_PROCESSED',
  WEBHOOK_SIGNATURE_INVALID: 'WEBHOOK_SIGNATURE_INVALID',

  // Catch-all
  INTERNAL_ERROR: 'INTERNAL_ERROR',
} as const;

export type PayErrorCodeValue =
  (typeof PayErrorCode)[keyof typeof PayErrorCode];
