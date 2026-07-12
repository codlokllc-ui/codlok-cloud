/**
 * Codlok Cloud — Verify Module — Internal Types (INTERNAL)
 *
 * Per Master Spec §20. This file is internal to the Verify module.
 *
 * Per §20 Verification Data Minimization Rule: Verify stores ONLY provider
 * reference IDs, normalized status, timestamps, and non-sensitive metadata.
 * Never raw documents, biometric data, OCR output, or full provider reports.
 *
 * Per §20 Verification Fact Immutability Rule: verificationId, provider,
 * providerVerificationId, verificationType, subjectReference, workspaceId
 * never change after creation — only status transitions.
 */

// ---------------------------------------------------------------------------
// Canonical verification type enum (§20 line 975 — NOT an opaque string)
// ---------------------------------------------------------------------------

export type VerificationType =
  | 'INDIVIDUAL_IDENTITY'
  | 'BUSINESS_VERIFICATION'
  | 'DOCUMENT_VERIFICATION'
  | 'ADDRESS_VERIFICATION'
  | 'AGE_VERIFICATION';

export const VERIFICATION_TYPES: VerificationType[] = [
  'INDIVIDUAL_IDENTITY',
  'BUSINESS_VERIFICATION',
  'DOCUMENT_VERIFICATION',
  'ADDRESS_VERIFICATION',
  'AGE_VERIFICATION',
];

export function isValidVerificationType(value: string): value is VerificationType {
  return (VERIFICATION_TYPES as string[]).includes(value);
}

// ---------------------------------------------------------------------------
// Verification Status State Machine (§20 line 994 — binding)
// ---------------------------------------------------------------------------
//
//   pending → in_review → approved
//                       → rejected
//   pending → expired (terminal)
//
// - approved, rejected, expired are terminal.
// - approved/rejected driven exclusively by provider webhooks.
// - expired is terminal; new verification requires createVerificationSession
//   again with a new idempotencyKey.
//
// Adapter Absorption Rule (§20 line 1003): the provider adapter absorbs
// internal looping/multi-phase complexity and only emits a Codlok status
// transition when something is actually actionable for the caller.
// - pending covers ALL not-yet-finalized activity (including Stripe's
//   requires_input resubmission loop).
// - in_review is reserved for providers with explicit manual-review hold
//   (e.g. Persona's needs_review).
// - rejected: adapters translate ambiguous provider outcomes (e.g. Stripe's
//   canceled) into Codlok's clean terminal states.

export type VerificationStatus =
  | 'pending'
  | 'in_review'
  | 'approved'
  | 'rejected'
  | 'expired';

// ---------------------------------------------------------------------------
// Verification record (the canonical session record)
// ---------------------------------------------------------------------------

export interface VerificationRecord {
  /** Unique verification identifier (returned to caller). */
  verificationId: string;
  /** Workspace scope (required per §20 line 1016). */
  workspaceId: string;
  /** Canonical Codlok enum (never an opaque string). */
  verificationType: VerificationType;
  /**
   * Caller-supplied identifier for the person/entity being verified.
   * Verify stores it opaquely and never interprets it (§20 line 974).
   */
  subjectReference: string;
  status: VerificationStatus;
  /** Provider name ('stripe_identity' | 'mock'). */
  provider: string;
  /** Provider's verification/session ID. */
  providerVerificationId?: string;
  /** Provider-hosted URL for the user to complete the flow. */
  providerSessionUrl?: string;
  /** Idempotency key from createVerificationSession (for dedup). */
  idempotencyKey: string;
  /** Non-sensitive provider metadata (never raw documents/biometrics). */
  metadata?: Record<string, string>;
  createdAt: string;
  updatedAt: string;
  /** When the verification was finalized (if terminal). */
  finalizedAt?: string;
}

// ---------------------------------------------------------------------------
// Webhook event log (for deduplication per §20 line 1013 — permanent)
// ---------------------------------------------------------------------------

export interface WebhookEventRecord {
  provider: string;
  providerEventId: string;
  workspaceId: string;
  processedAt: string;
  verificationId?: string;
  appliedTransition?: VerificationStatus;
}

// ---------------------------------------------------------------------------
// Provider adapter interface (internal — abstraction over Stripe Identity, etc.)
// ---------------------------------------------------------------------------

export interface CreateSessionProviderInput {
  workspaceId: string;
  verificationType: VerificationType;
  verificationId: string;
  subjectReference: string;
  idempotencyKey: string;
}

export interface CreateSessionProviderResult {
  providerVerificationId: string;
  providerSessionUrl: string;
}

export interface ParsedWebhookEvent {
  providerEventId: string;
  providerVerificationId?: string;
  /**
   * The NORMALIZED Codlok status transition to apply (if any).
   * Per the Adapter Absorption Rule, the adapter has already absorbed
   * provider-specific intermediate states and only emits a Codlok status
   * when something is actually actionable.
   */
  transition?: VerificationStatus;
  /** Non-sensitive metadata from the webhook (never raw documents). */
  metadata?: Record<string, string>;
}

export interface VerifyProviderAdapter {
  /** Create a verification session at the provider. */
  createSession(input: CreateSessionProviderInput): Promise<CreateSessionProviderResult>;

  /** Verify a webhook signature (provider-specific). */
  verifyWebhookSignature(payload: string, signature: string, secret: string): boolean;

  /**
   * Parse a webhook payload into a normalized event.
   * Per the Adapter Absorption Rule, this method is responsible for
   * absorbing provider-specific intermediate states (Stripe's requires_input
   * loop, Persona's two-phase lifecycle) and only emitting a transition
   * when something is actually actionable for the caller.
   */
  parseWebhookEvent(payload: string): ParsedWebhookEvent;

  /** Provider name for metadata. */
  readonly providerName: string;
}

// ---------------------------------------------------------------------------
// VerifyError — internal exception
// ---------------------------------------------------------------------------

export class VerifyError extends Error {
  constructor(
    public readonly code: string,
    message: string
  ) {
    super(message);
    this.name = 'VerifyError';
  }
}
