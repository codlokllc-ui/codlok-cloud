/**
 * Codlok Cloud — Verify Module — Public Interface v1.0
 *
 * Per Master Spec §20 Verify Module Specification v1.0 (STATUS: FROZEN).
 * Spec Version 2.6.
 *
 * Purpose: Answers "how does a workspace get an identity/business verification
 * done, reliably, regardless of which provider does the actual checking?"
 * Verify orchestrates external KYC/identity-verification providers — it never
 * implements verification logic itself (§7 Provider Model).
 *
 * Naming disambiguation: "Codlok Verify" (this module) ≠ "SREMA Verify"
 * (a downstream product). This module is generic infrastructure.
 *
 * ----------------------------------------------------------------------------
 * PUBLIC INTERFACE (§20)
 * ----------------------------------------------------------------------------
 *   createVerificationSession(workspaceId, verificationType, subjectReference, idempotencyKey)
 *   getVerificationStatus(workspaceId, verificationId)
 *   listVerifications(workspaceId, filters?)
 *   getProviderStatus(workspaceId)
 *
 * All return StandardResponse per §3.6.
 *
 * ----------------------------------------------------------------------------
 * IDEMPOTENCY (§20 line 976 — REQUIRED, not optional)
 * ----------------------------------------------------------------------------
 * idempotencyKey is REQUIRED on createVerificationSession. Same reasoning as
 * Pay: duplicate verification sessions cost real provider fees and create
 * confusing duplicate records. Same workspaceId + idempotencyKey → returns
 * original verificationId, never creates a second session.
 *
 * Idempotency window: PERMANENT (no expiry) — same as Pay, since a duplicate
 * verification at any future point wastes provider fees.
 *
 * ----------------------------------------------------------------------------
 * VERIFICATION STATUS STATE MACHINE (§20 line 994 — binding)
 * ----------------------------------------------------------------------------
 *   pending → in_review → approved
 *                       → rejected
 *   pending → expired (terminal)
 *
 * - approved, rejected, expired are terminal.
 * - approved/rejected driven exclusively by provider webhooks — no public
 *   function transitions status directly.
 *
 * ----------------------------------------------------------------------------
 * ADAPTER ABSORPTION RULE (§20 line 1003 — binding)
 * ----------------------------------------------------------------------------
 * The provider adapter absorbs internal looping/multi-phase complexity and
 * only emits a Codlok status transition when something is actually actionable:
 * - pending covers ALL not-yet-finalized activity (including Stripe's
 *   requires_input resubmission loop).
 * - in_review is reserved for providers with explicit manual-review hold.
 * - rejected: adapters translate ambiguous provider outcomes (e.g. Stripe's
 *   canceled) into Codlok's clean terminal states.
 *
 * ----------------------------------------------------------------------------
 * VERIFICATION FACT IMMUTABILITY RULE (§20 line 968 — binding)
 * ----------------------------------------------------------------------------
 * Once a verification session is created, the following NEVER change:
 * verificationId, provider, providerVerificationId, verificationType,
 * subjectReference, workspaceId. Only status transitions. A correction
 * always means a new verification session, never an edit.
 *
 * ----------------------------------------------------------------------------
 * VERIFICATION DATA MINIMIZATION RULE (§20 line 965 — binding)
 * ----------------------------------------------------------------------------
 * Verify stores ONLY: provider name, provider verification/session ID,
 * normalized status, timestamps, non-sensitive metadata. NEVER stores raw
 * documents, biometric templates, face embeddings, OCR results, or full
 * provider reports. The provider remains the system of record for all
 * verification artifacts.
 *
 * ----------------------------------------------------------------------------
 * NO BUSINESS-REFERENCE FIELDS (§20 line 963)
 * ----------------------------------------------------------------------------
 * Verify never accepts or stores entityType/entityId. subjectReference is
 * stored opaquely — Verify never interprets it.
 *
 * ----------------------------------------------------------------------------
 * WEBHOOK DEDUPLICATION (§20 line 1013 — permanent)
 * ----------------------------------------------------------------------------
 * Incoming webhooks are received exclusively by Verify. Every webhook event
 * is deduplicated by provider event ID, permanently — a given provider event
 * ID is processed at most once, ever (same as Pay).
 */

import { StandardResponse, ok, fail } from '@/shared';
import { VerifyErrorCode } from './internal/errors';
import type {
  VerificationRecord,
  VerificationStatus,
  VerificationType,
  VerifyProviderAdapter,
  ParsedWebhookEvent,
} from './internal/types';
import { VerifyError, isValidVerificationType } from './internal/types';
import {
  store,
  newVerificationId,
  _resetStoreForTesting,
} from './internal/store';
import { resolveProvider, _setProviderForTesting } from './internal/factory';

// Re-export test helpers so tests can import from the public module.
export { _resetStoreForTesting, _setProviderForTesting };
export type { VerificationType, VerificationStatus };

// ---------------------------------------------------------------------------
// Public data shapes (per §20)
// ---------------------------------------------------------------------------

export interface CreateVerificationSessionData {
  verificationId: string;
  providerSessionUrl: string;
  status: 'pending';
}

export interface GetVerificationStatusData {
  verificationId: string;
  status: VerificationStatus;
  provider: string;
  verificationType: VerificationType;
  createdAt: string;
  updatedAt: string;
}

export interface ListVerificationsData {
  verifications: {
    verificationId: string;
    status: VerificationStatus;
    verificationType: VerificationType;
    createdAt: string;
  }[];
}

export interface GetProviderStatusData {
  configured: boolean;
  provider: string | null;
}

// ---------------------------------------------------------------------------
// Internal: error wrapping
// ---------------------------------------------------------------------------

function _verifyErrorToResponse(err: unknown): StandardResponse<never> {
  if (err instanceof Error && err.name === 'VerifyError') {
    const code = (err as { code?: string }).code ?? VerifyErrorCode.INTERNAL_ERROR;
    return fail(code, err.message);
  }
  return fail(VerifyErrorCode.INTERNAL_ERROR, 'An internal error occurred.');
}

// ---------------------------------------------------------------------------
// Internal: validation helpers
// ---------------------------------------------------------------------------

function _requireWorkspaceId(workspaceId: string): void {
  if (!workspaceId) {
    throw new VerifyError(
      VerifyErrorCode.WORKSPACE_NOT_FOUND,
      'workspaceId is required.'
    );
  }
}

function _requireIdempotencyKey(idempotencyKey: string): void {
  if (!idempotencyKey) {
    throw new VerifyError(
      VerifyErrorCode.IDEMPOTENCY_KEY_REQUIRED,
      'idempotencyKey is required for createVerificationSession (§20 line 976).'
    );
  }
}

function _requireSubjectReference(subjectReference: string): void {
  if (!subjectReference) {
    throw new VerifyError(
      VerifyErrorCode.INTERNAL_ERROR,
      'subjectReference is required.'
    );
  }
}

function _requireVerificationType(verificationType: string): void {
  if (!verificationType) {
    throw new VerifyError(
      VerifyErrorCode.INVALID_VERIFICATION_TYPE,
      'verificationType is required.'
    );
  }
  if (!isValidVerificationType(verificationType)) {
    throw new VerifyError(
      VerifyErrorCode.INVALID_VERIFICATION_TYPE,
      `Invalid verificationType: ${verificationType}. Must be one of: INDIVIDUAL_IDENTITY, BUSINESS_VERIFICATION, DOCUMENT_VERIFICATION, ADDRESS_VERIFICATION, AGE_VERIFICATION.`
    );
  }
}

function _now(): string {
  return new Date().toISOString();
}

// ---------------------------------------------------------------------------
// §20 createVerificationSession
// ---------------------------------------------------------------------------

export async function createVerificationSession(
  workspaceId: string,
  verificationType: string,
  subjectReference: string,
  idempotencyKey: string
): Promise<StandardResponse<CreateVerificationSessionData>> {
  try {
    _requireWorkspaceId(workspaceId);
    _requireIdempotencyKey(idempotencyKey); // REQUIRED per §20
    _requireSubjectReference(subjectReference);
    _requireVerificationType(verificationType);

    // Idempotency: same workspaceId + idempotencyKey → return original.
    const existing = store.findByIdempotencyKey(workspaceId, idempotencyKey);
    if (existing) {
      // Return original verificationId — do NOT create a second session.
      return ok<CreateVerificationSessionData>({
        verificationId: existing.verificationId,
        providerSessionUrl: existing.providerSessionUrl ?? '',
        status: 'pending',
      });
    }

    // Resolve provider (PROVIDER_NOT_CONFIGURED if not configured).
    const provider = await resolveProvider(workspaceId);
    if (!provider) {
      throw new VerifyError(
        VerifyErrorCode.PROVIDER_NOT_CONFIGURED,
        'Verify provider is not configured for this workspace.'
      );
    }

    // Create session at provider.
    const verificationId = newVerificationId();
    const providerResult = await provider.createSession({
      workspaceId,
      verificationType: verificationType as VerificationType,
      verificationId,
      subjectReference,
      idempotencyKey,
    });

    // Create verification record in 'pending' state.
    const now = _now();
    const record: VerificationRecord = {
      verificationId,
      workspaceId,
      verificationType: verificationType as VerificationType,
      subjectReference,
      status: 'pending',
      provider: provider.providerName,
      providerVerificationId: providerResult.providerVerificationId,
      providerSessionUrl: providerResult.providerSessionUrl,
      idempotencyKey,
      createdAt: now,
      updatedAt: now,
    };
    store.insert(record);

    return ok<CreateVerificationSessionData>({
      verificationId,
      providerSessionUrl: providerResult.providerSessionUrl,
      status: 'pending',
    });
  } catch (err) {
    return _verifyErrorToResponse(err);
  }
}

// ---------------------------------------------------------------------------
// §20 getVerificationStatus
// ---------------------------------------------------------------------------

export async function getVerificationStatus(
  workspaceId: string,
  verificationId: string
): Promise<StandardResponse<GetVerificationStatusData>> {
  try {
    _requireWorkspaceId(workspaceId);
    if (!verificationId) {
      throw new VerifyError(
        VerifyErrorCode.VERIFICATION_NOT_FOUND,
        'verificationId is required.'
      );
    }

    const record = store.getByVerificationIdAndWorkspace(verificationId, workspaceId);
    if (!record) {
      throw new VerifyError(
        VerifyErrorCode.VERIFICATION_NOT_FOUND,
        'Verification not found.'
      );
    }

    return ok<GetVerificationStatusData>({
      verificationId: record.verificationId,
      status: record.status,
      provider: record.provider,
      verificationType: record.verificationType,
      createdAt: record.createdAt,
      updatedAt: record.updatedAt,
    });
  } catch (err) {
    return _verifyErrorToResponse(err);
  }
}

// ---------------------------------------------------------------------------
// §20 listVerifications
// ---------------------------------------------------------------------------

export async function listVerifications(
  workspaceId: string,
  filters?: { status?: VerificationStatus; verificationType?: VerificationType }
): Promise<StandardResponse<ListVerificationsData>> {
  try {
    _requireWorkspaceId(workspaceId);

    const records = store.listByWorkspace(workspaceId, filters);
    return ok<ListVerificationsData>({
      verifications: records.map((r) => ({
        verificationId: r.verificationId,
        status: r.status,
        verificationType: r.verificationType,
        createdAt: r.createdAt,
      })),
    });
  } catch (err) {
    return _verifyErrorToResponse(err);
  }
}

// ---------------------------------------------------------------------------
// §20 getProviderStatus
// ---------------------------------------------------------------------------

export async function getProviderStatus(
  workspaceId: string
): Promise<StandardResponse<GetProviderStatusData>> {
  try {
    _requireWorkspaceId(workspaceId);

    const provider = await resolveProvider(workspaceId);
    if (!provider) {
      return ok<GetProviderStatusData>({ configured: false, provider: null });
    }

    return ok<GetProviderStatusData>({
      configured: true,
      provider: provider.providerName,
    });
  } catch (err) {
    return _verifyErrorToResponse(err);
  }
}

// ---------------------------------------------------------------------------
// Webhook handling (§20 line 1011 — received exclusively by Verify)
// ---------------------------------------------------------------------------

/**
 * Process an incoming webhook from a provider.
 *
 * Per §20 line 1011-1014:
 *   - Webhooks are received exclusively by Verify.
 *   - Every event is deduplicated by provider event ID, permanently.
 *   - A duplicate event is a true no-op.
 *   - Verify translates provider-specific payloads into normalized status
 *     transitions (the Adapter Absorption Rule is applied inside the adapter's
 *     parseWebhookEvent method).
 *
 * This function is NOT part of the 4-function public interface — it's the
 * internal webhook ingestion point that an HTTP route handler would call.
 */
export async function processWebhook(
  workspaceId: string,
  payload: string,
  signature: string
): Promise<StandardResponse<{ processed: boolean; eventId: string; deduplicated: boolean }>> {
  try {
    _requireWorkspaceId(workspaceId);

    const provider = await resolveProvider(workspaceId);
    if (!provider) {
      throw new VerifyError(
        VerifyErrorCode.PROVIDER_NOT_CONFIGURED,
        'Verify provider is not configured for this workspace.'
      );
    }

    // Read webhook secret for signature verification.
    const { getConfigurationService } = await import('@/config');
    const config = getConfigurationService();
    const webhookSecretR = await config.getSecret(
      workspaceId,
      'STRIPE_IDENTITY_WEBHOOK_SECRET',
      'verify'
    );
    if (!webhookSecretR.success) {
      throw new VerifyError(
        VerifyErrorCode.PROVIDER_NOT_CONFIGURED,
        'Webhook secret is not configured for this workspace.'
      );
    }

    // Verify signature.
    if (!provider.verifyWebhookSignature(payload, signature, webhookSecretR.data.value)) {
      throw new VerifyError(
        VerifyErrorCode.WEBHOOK_SIGNATURE_INVALID,
        'Webhook signature verification failed.'
      );
    }

    // Parse event (adapter applies the Absorption Rule here — absorbs
    // intermediate states, only emits actionable transitions).
    const event = provider.parseWebhookEvent(payload);

    // Deduplicate by provider event ID (§20 line 1013 — permanent).
    if (store.isWebhookProcessed(provider.providerName, event.providerEventId)) {
      // Duplicate — true no-op.
      return ok({
        processed: false,
        eventId: event.providerEventId,
        deduplicated: true,
      });
    }

    // Apply status transition (if any).
    let verificationId: string | undefined;
    if (event.providerVerificationId) {
      // Find the verification by providerVerificationId.
      // (In production, this would be an indexed lookup; for the in-memory
      // store, we scan — acceptable for v1.)
      for (const record of store.listByWorkspace(workspaceId)) {
        if (record.providerVerificationId === event.providerVerificationId) {
          if (event.transition && _isValidTransition(record.status, event.transition)) {
            store.updateStatus(record.verificationId, event.transition, {
              finalizedAt: ['approved', 'rejected', 'expired'].includes(event.transition)
                ? _now()
                : undefined,
              metadata: event.metadata
                ? { ...record.metadata, ...event.metadata }
                : record.metadata,
            });
            verificationId = record.verificationId;
          }
          break;
        }
      }
    }

    // Record the webhook event (for dedup — permanent).
    store.recordWebhookEvent({
      provider: provider.providerName,
      providerEventId: event.providerEventId,
      workspaceId,
      processedAt: _now(),
      verificationId,
      appliedTransition: event.transition,
    });

    return ok({
      processed: true,
      eventId: event.providerEventId,
      deduplicated: false,
    });
  } catch (err) {
    return _verifyErrorToResponse(err);
  }
}

// ---------------------------------------------------------------------------
// Internal: state machine transition validation
// ---------------------------------------------------------------------------

function _isValidTransition(from: VerificationStatus, to: VerificationStatus): boolean {
  const validTransitions: Record<VerificationStatus, VerificationStatus[]> = {
    pending: ['in_review', 'approved', 'rejected', 'expired'],
    in_review: ['approved', 'rejected'],
    approved: [], // terminal
    rejected: [], // terminal
    expired: [], // terminal
  };
  return validTransitions[from]?.includes(to) ?? false;
}

// ---------------------------------------------------------------------------
// Public surface (the ONLY thing other modules may import)
// ---------------------------------------------------------------------------

export const Verify = {
  createVerificationSession,
  getVerificationStatus,
  listVerifications,
  getProviderStatus,
  processWebhook, // exported for the webhook route handler
};

export type VerifyModule = typeof Verify;
