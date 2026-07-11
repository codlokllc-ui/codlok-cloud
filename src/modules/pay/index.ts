/**
 * Codlok Cloud — Pay Module — Public Interface v1.0
 *
 * Per Master Spec §19 Pay Module Specification v1.0 (STATUS: FROZEN).
 * Spec Version 2.3.
 *
 * Purpose: Answers "how does money move, reliably and safely, regardless
 * of which provider is behind it?" Pay owns financial facts and transaction
 * lifecycle only — never the business reason money moved.
 *
 * ----------------------------------------------------------------------------
 * PUBLIC INTERFACE (§19)
 * ----------------------------------------------------------------------------
 *   createPayment(workspaceId, amountMinorUnits, currency, idempotencyKey)
 *   getPayment(workspaceId, paymentId)
 *   refundPayment(workspaceId, paymentId, amountMinorUnits?, idempotencyKey)
 *   listRefunds(workspaceId, paymentId)
 *   getProviderStatus(workspaceId)
 *
 * All return StandardResponse per §3.6.
 *
 * ----------------------------------------------------------------------------
 * IDEMPOTENCY (§19 line 869 — REQUIRED, not optional)
 * ----------------------------------------------------------------------------
 * idempotencyKey is REQUIRED on createPayment and refundPayment. A caller
 * retrying after a timeout without one risks double-charging a real card.
 * Same workspaceId + idempotencyKey within the idempotency window returns
 * the original paymentId/refundId without creating a second charge/refund.
 *
 * Idempotency window: PERMANENT (no expiry).
 * Rationale: unlike Mail (where a duplicate send after 24h is harmless),
 * a duplicate charge at ANY point in the future is a real financial loss.
 * Idempotency keys are retained indefinitely — there is no window after
 * which a key "expires" and a duplicate charge becomes possible.
 *
 * ----------------------------------------------------------------------------
 * PAYMENT STATUS STATE MACHINE (§19 line 892 — binding)
 * ----------------------------------------------------------------------------
 *   pending → succeeded → refund_pending → refunded (full)
 *                       → refund_pending → partially_refunded (partial)
 *          → failed (terminal)
 *   succeeded → disputed (provider-initiated, via webhook only)
 *
 * - failed is terminal — never retried in place.
 * - Financial facts (amount/currency/payer/provider) immutable after
 *   createPayment() succeeds. Only status transitions.
 *
 * ----------------------------------------------------------------------------
 * PCI BOUNDARY RULE (§19 line 905 — binding)
 * ----------------------------------------------------------------------------
 * Pay never receives, transmits, logs, or stores raw card numbers, CVVs,
 * or bank account credentials. createPayment() returns a checkoutUrl
 * pointing to the provider's hosted checkout/tokenization flow (Stripe
 * Checkout, etc.) — the customer enters payment details directly with the
 * provider, never through Codlok's servers.
 *
 * ----------------------------------------------------------------------------
 * PRICING RULE (§19 line 859 — binding)
 * ----------------------------------------------------------------------------
 * Pay executes exactly the amountMinorUnits and currency it's given —
 * never calculates prices, applies discounts, or performs currency
 * conversion. May record an exchange rate the provider reports as
 * settlement metadata (recording a fact, not computing one).
 *
 * ----------------------------------------------------------------------------
 * REFUND DECISION RULE (§19 line 862 — binding)
 * ----------------------------------------------------------------------------
 * Pay executes refunds when asked and records the result — it never
 * decides whether a refund is warranted. Eligibility is the requesting
 * module's decision.
 *
 * ----------------------------------------------------------------------------
 * NO BUSINESS-REFERENCE FIELDS (§3.12)
 * ----------------------------------------------------------------------------
 * Pay stores NO business-reference fields. No entityType/entityId
 * parameters anywhere in the public interface.
 *
 * ----------------------------------------------------------------------------
 * WEBHOOK DEDUPLICATION (§19 line 908)
 * ----------------------------------------------------------------------------
 * Incoming webhooks are received exclusively by Pay. Every webhook event
 * is deduplicated by the provider's event ID before processing. A duplicate
 * event is a true no-op, not a repeated status transition.
 */

import { StandardResponse, ok, fail } from '@/shared';
import { PayErrorCode } from './internal/errors';
import type {
  PaymentRecord,
  RefundRecord,
  PaymentStatus,
  PayProviderAdapter,
  ParsedWebhookEvent,
} from './internal/types';
import { PayError } from './internal/types';
import {
  store,
  newPaymentId,
  newRefundId,
  _resetStoreForTesting,
} from './internal/store';
import { resolveProvider, _setProviderForTesting } from './internal/factory';

// Re-export test helpers so tests can import from the public module.
export { _resetStoreForTesting, _setProviderForTesting };

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** Valid ISO 4217 currency codes (subset for v1 — extend as needed). */
const VALID_CURRENCIES = new Set([
  'USD', 'EUR', 'GBP', 'NGN', 'KES', 'GHS', 'ZAR',
  'JPY', 'CAD', 'AUD', 'CAD', 'CHF', 'CNY', 'INR', 'BRL',
]);

// ---------------------------------------------------------------------------
// Public data shapes (per §19)
// ---------------------------------------------------------------------------

export interface CreatePaymentData {
  paymentId: string;
  status: 'pending';
  checkoutUrl: string;
}

export interface GetPaymentData {
  paymentId: string;
  status: PaymentStatus;
  amountMinorUnits: number;
  currency: string;
  createdAt: string;
  updatedAt: string;
}

export interface RefundPaymentData {
  refundId: string;
  paymentId: string;
  status: 'refund_pending';
  amountMinorUnits: number;
}

export interface ListRefundsData {
  refunds: {
    refundId: string;
    amountMinorUnits: number;
    status: RefundRecord['status'];
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

function _payErrorToResponse(err: unknown): StandardResponse<never> {
  if (err instanceof Error && err.name === 'PayError') {
    const code = (err as { code?: string }).code ?? PayErrorCode.INTERNAL_ERROR;
    return fail(code, err.message);
  }
  return fail(PayErrorCode.INTERNAL_ERROR, 'An internal error occurred.');
}

// ---------------------------------------------------------------------------
// Internal: validation helpers
// ---------------------------------------------------------------------------

function _requireWorkspaceId(workspaceId: string): void {
  if (!workspaceId) {
    throw new PayError(
      PayErrorCode.WORKSPACE_NOT_FOUND,
      'workspaceId is required.'
    );
  }
}

function _requireIdempotencyKey(idempotencyKey: string): void {
  if (!idempotencyKey) {
    throw new PayError(
      PayErrorCode.IDEMPOTENCY_KEY_REQUIRED,
      'idempotencyKey is required for createPayment and refundPayment (§19 line 869).'
    );
  }
}

function _requireAmount(amountMinorUnits: number): void {
  if (typeof amountMinorUnits !== 'number' || !Number.isInteger(amountMinorUnits) || amountMinorUnits <= 0) {
    throw new PayError(
      PayErrorCode.INVALID_AMOUNT,
      'amountMinorUnits must be a positive integer (§19 line 868).'
    );
  }
}

function _requireCurrency(currency: string): void {
  if (!currency || !/^[A-Z]{3}$/.test(currency)) {
    throw new PayError(
      PayErrorCode.INVALID_CURRENCY,
      'currency must be a 3-letter ISO 4217 code.'
    );
  }
  if (!VALID_CURRENCIES.has(currency)) {
    throw new PayError(
      PayErrorCode.INVALID_CURRENCY,
      `Unsupported currency: ${currency}.`
    );
  }
}

function _now(): string {
  return new Date().toISOString();
}

// ---------------------------------------------------------------------------
// §19 createPayment
// ---------------------------------------------------------------------------

export async function createPayment(
  workspaceId: string,
  amountMinorUnits: number,
  currency: string,
  idempotencyKey: string
): Promise<StandardResponse<CreatePaymentData>> {
  try {
    _requireWorkspaceId(workspaceId);
    _requireIdempotencyKey(idempotencyKey); // REQUIRED per §19
    _requireAmount(amountMinorUnits);
    _requireCurrency(currency);

    // Idempotency: same workspaceId + idempotencyKey → return original.
    const existing = store.findByPaymentIdempotencyKey(workspaceId, idempotencyKey);
    if (existing) {
      // Return original paymentId — do NOT create a second charge.
      // checkoutUrl may have expired in a real provider; we return the
      // original record's checkoutUrl if still present, otherwise a placeholder.
      return ok<CreatePaymentData>({
        paymentId: existing.paymentId,
        status: 'pending',
        checkoutUrl: existing.checkoutUrl ?? '',
      });
    }

    // Resolve provider (PROVIDER_NOT_CONFIGURED if not configured).
    const provider = await resolveProvider(workspaceId);
    if (!provider) {
      throw new PayError(
        PayErrorCode.PROVIDER_NOT_CONFIGURED,
        'Pay provider is not configured for this workspace.'
      );
    }

    // Create payment at provider (get checkoutUrl — PCI Boundary).
    const paymentId = newPaymentId();
    const providerResult = await provider.createPayment({
      workspaceId,
      amountMinorUnits,
      currency,
      paymentId,
      idempotencyKey,
    });

    // Create payment record in 'pending' state.
    const now = _now();
    const record: PaymentRecord = {
      paymentId,
      workspaceId,
      amountMinorUnits,
      currency,
      status: 'pending',
      provider: provider.providerName,
      providerPaymentId: providerResult.providerPaymentId,
      checkoutUrl: providerResult.checkoutUrl,
      refundedAmountMinorUnits: 0,
      idempotencyKey,
      createdAt: now,
      updatedAt: now,
    };
    store.insertPayment(record);

    return ok<CreatePaymentData>({
      paymentId,
      status: 'pending',
      checkoutUrl: providerResult.checkoutUrl,
    });
  } catch (err) {
    return _payErrorToResponse(err);
  }
}

// ---------------------------------------------------------------------------
// §19 getPayment
// ---------------------------------------------------------------------------

export async function getPayment(
  workspaceId: string,
  paymentId: string
): Promise<StandardResponse<GetPaymentData>> {
  try {
    _requireWorkspaceId(workspaceId);
    if (!paymentId) {
      throw new PayError(
        PayErrorCode.PAYMENT_NOT_FOUND,
        'paymentId is required.'
      );
    }

    const record = store.getByPaymentIdAndWorkspace(paymentId, workspaceId);
    if (!record) {
      throw new PayError(
        PayErrorCode.PAYMENT_NOT_FOUND,
        'Payment not found.'
      );
    }

    return ok<GetPaymentData>({
      paymentId: record.paymentId,
      status: record.status,
      amountMinorUnits: record.amountMinorUnits,
      currency: record.currency,
      createdAt: record.createdAt,
      updatedAt: record.updatedAt,
    });
  } catch (err) {
    return _payErrorToResponse(err);
  }
}

// ---------------------------------------------------------------------------
// §19 refundPayment
// ---------------------------------------------------------------------------

export async function refundPayment(
  workspaceId: string,
  paymentId: string,
  amountMinorUnits: number | undefined,
  idempotencyKey: string
): Promise<StandardResponse<RefundPaymentData>> {
  try {
    _requireWorkspaceId(workspaceId);
    _requireIdempotencyKey(idempotencyKey); // REQUIRED per §19
    if (!paymentId) {
      throw new PayError(
        PayErrorCode.PAYMENT_NOT_FOUND,
        'paymentId is required.'
      );
    }

    // Determine refund amount.
    const record = store.getByPaymentIdAndWorkspace(paymentId, workspaceId);
    if (!record) {
      throw new PayError(
        PayErrorCode.PAYMENT_NOT_FOUND,
        'Payment not found.'
      );
    }

    // State machine check: only 'succeeded' and 'partially_refunded' payments
    // are refundable. Per §19 line 894-896, a partially_refunded payment can
    // receive further refunds until it reaches 'refunded' (full).
    if (record.status !== 'succeeded' && record.status !== 'partially_refunded') {
      throw new PayError(
        PayErrorCode.PAYMENT_NOT_REFUNDABLE,
        `Payment is not refundable (current status: ${record.status}). Only 'succeeded' or 'partially_refunded' payments can be refunded.`
      );
    }

    // Calculate refund amount.
    const remaining = record.amountMinorUnits - record.refundedAmountMinorUnits;
    const refundAmount = amountMinorUnits === undefined ? remaining : amountMinorUnits;

    // Validate amount.
    if (typeof refundAmount !== 'number' || !Number.isInteger(refundAmount) || refundAmount <= 0) {
      throw new PayError(
        PayErrorCode.INVALID_AMOUNT,
        'Refund amount must be a positive integer.'
      );
    }

    if (refundAmount > remaining) {
      throw new PayError(
        PayErrorCode.REFUND_EXCEEDS_REMAINING,
        `Refund amount ${refundAmount} exceeds remaining refundable amount ${remaining}.`
      );
    }

    // Idempotency: same workspaceId + paymentId + idempotencyKey → return original.
    const existingRefund = store.findByRefundIdempotencyKey(workspaceId, paymentId, idempotencyKey);
    if (existingRefund) {
      // Per §19, refundPayment always returns status: "refund_pending" —
      // the final 'refunded'/'partially_refunded' status comes via webhook.
      // On idempotent return, we return the original refundId with the
      // spec-mandated 'refund_pending' status.
      return ok<RefundPaymentData>({
        refundId: existingRefund.refundId,
        paymentId: existingRefund.paymentId,
        status: 'refund_pending',
        amountMinorUnits: existingRefund.amountMinorUnits,
      });
    }

    // Resolve provider.
    const provider = await resolveProvider(workspaceId);
    if (!provider) {
      throw new PayError(
        PayErrorCode.PROVIDER_NOT_CONFIGURED,
        'Pay provider is not configured for this workspace.'
      );
    }

    // Issue refund at provider.
    const refundId = newRefundId();
    const providerResult = await provider.issueRefund({
      workspaceId,
      paymentId,
      providerPaymentId: record.providerPaymentId ?? '',
      amountMinorUnits: refundAmount,
      refundId,
      idempotencyKey,
    });

    // Create refund record.
    const now = _now();
    const refundRecord: RefundRecord = {
      refundId,
      paymentId,
      workspaceId,
      amountMinorUnits: refundAmount,
      status: providerResult.status,
      providerRefundId: providerResult.providerRefundId,
      idempotencyKey,
      createdAt: now,
      updatedAt: now,
      refundedAt: providerResult.status === 'refunded' ? now : undefined,
    };
    store.insertRefund(refundRecord);

    // Update payment: add refunded amount + transition status.
    // NOTE: record is a live reference to the store object. Capture the
    // pre-refund amount BEFORE calling addRefundedAmount, which mutates it.
    const preRefundRefundedAmount = record.refundedAmountMinorUnits;
    store.addRefundedAmount(paymentId, refundAmount);
    const newRefundedTotal = preRefundRefundedAmount + refundAmount;
    const isFullRefund = newRefundedTotal >= record.amountMinorUnits;
    store.updatePaymentStatus(
      paymentId,
      isFullRefund ? 'refunded' : 'partially_refunded'
    );

    // Return 'refund_pending' per §19 (the provider may have already confirmed,
    // but the public interface returns 'refund_pending' — webhook confirmation
    // updates the final status).
    return ok<RefundPaymentData>({
      refundId,
      paymentId,
      status: 'refund_pending',
      amountMinorUnits: refundAmount,
    });
  } catch (err) {
    return _payErrorToResponse(err);
  }
}

// ---------------------------------------------------------------------------
// §19 listRefunds
// ---------------------------------------------------------------------------

export async function listRefunds(
  workspaceId: string,
  paymentId: string
): Promise<StandardResponse<ListRefundsData>> {
  try {
    _requireWorkspaceId(workspaceId);
    if (!paymentId) {
      throw new PayError(
        PayErrorCode.PAYMENT_NOT_FOUND,
        'paymentId is required.'
      );
    }

    // Verify payment exists in this workspace.
    const record = store.getByPaymentIdAndWorkspace(paymentId, workspaceId);
    if (!record) {
      throw new PayError(
        PayErrorCode.PAYMENT_NOT_FOUND,
        'Payment not found.'
      );
    }

    const refunds = store.listRefundsByPayment(paymentId);
    return ok<ListRefundsData>({
      refunds: refunds.map((r) => ({
        refundId: r.refundId,
        amountMinorUnits: r.amountMinorUnits,
        status: r.status,
        createdAt: r.createdAt,
      })),
    });
  } catch (err) {
    return _payErrorToResponse(err);
  }
}

// ---------------------------------------------------------------------------
// §19 getProviderStatus
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
    return _payErrorToResponse(err);
  }
}

// ---------------------------------------------------------------------------
// Webhook handling (§19 line 908 — received exclusively by Pay)
// ---------------------------------------------------------------------------

/**
 * Process an incoming webhook from a provider.
 *
 * Per §19 line 908-911:
 *   - Webhooks are received exclusively by Pay.
 *   - Every event is deduplicated by provider event ID before processing.
 *   - A duplicate event is a true no-op, not a repeated status transition.
 *   - Pay translates provider-specific payloads into Codlok-standard status
 *     transitions before anything is visible to callers.
 *
 * This function is NOT part of the 5-function public interface listed in
 * §19's "Public Interface" section — it's the internal webhook ingestion
 * point that an HTTP route handler would call. It's exported because an
 * API route (/api/pay/webhook) needs to call it, but it's not one of the
 * 5 business-facing functions.
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
      throw new PayError(
        PayErrorCode.PROVIDER_NOT_CONFIGURED,
        'Pay provider is not configured for this workspace.'
      );
    }

    // Read webhook secret for signature verification.
    const { getConfigurationService } = await import('@/config');
    const config = getConfigurationService();
    const webhookSecretR = await config.getSecret(workspaceId, 'STRIPE_WEBHOOK_SECRET', 'pay');
    if (!webhookSecretR.success) {
      throw new PayError(
        PayErrorCode.PROVIDER_NOT_CONFIGURED,
        'Webhook secret is not configured for this workspace.'
      );
    }

    // Verify signature.
    if (!provider.verifyWebhookSignature(payload, signature, webhookSecretR.data.value)) {
      throw new PayError(
        PayErrorCode.WEBHOOK_SIGNATURE_INVALID,
        'Webhook signature verification failed.'
      );
    }

    // Parse event.
    const event = provider.parseWebhookEvent(payload);

    // Deduplicate by provider event ID (§19 line 910).
    if (store.isWebhookProcessed(provider.providerName, event.providerEventId)) {
      // Duplicate — true no-op.
      return ok({
        processed: false,
        eventId: event.providerEventId,
        deduplicated: true,
      });
    }

    // Apply status transition (if any).
    let paymentId: string | undefined;
    if (event.paymentId) {
      const record = store.getByPaymentIdAndWorkspace(event.paymentId, workspaceId);
      if (record && event.transition) {
        // State machine validation: only allow valid transitions.
        if (_isValidTransition(record.status, event.transition)) {
          store.updatePaymentStatus(record.paymentId, event.transition, {
            succeededAt: event.transition === 'succeeded' ? _now() : record.succeededAt,
            failedAt: event.transition === 'failed' ? _now() : record.failedAt,
            disputedAt: event.transition === 'disputed' ? _now() : record.disputedAt,
            settlementExchangeRate: event.settlementExchangeRate ?? record.settlementExchangeRate,
            settlementCurrency: event.settlementCurrency ?? record.settlementCurrency,
          });
          paymentId = record.paymentId;
        }
      }
    }

    // Record the webhook event (for dedup).
    store.recordWebhookEvent({
      provider: provider.providerName,
      providerEventId: event.providerEventId,
      workspaceId,
      processedAt: _now(),
      paymentId,
      appliedTransition: event.transition,
    });

    return ok({
      processed: true,
      eventId: event.providerEventId,
      deduplicated: false,
    });
  } catch (err) {
    return _payErrorToResponse(err);
  }
}

// ---------------------------------------------------------------------------
// Internal: state machine transition validation
// ---------------------------------------------------------------------------

function _isValidTransition(from: PaymentStatus, to: PaymentStatus): boolean {
  const validTransitions: Record<PaymentStatus, PaymentStatus[]> = {
    pending: ['succeeded', 'failed'],
    succeeded: ['refund_pending', 'refunded', 'partially_refunded', 'disputed'],
    failed: [], // terminal
    refund_pending: ['refunded', 'partially_refunded', 'failed'],
    refunded: [], // terminal
    partially_refunded: ['refund_pending', 'refunded', 'disputed'],
    disputed: [], // terminal
  };
  return validTransitions[from]?.includes(to) ?? false;
}

// ---------------------------------------------------------------------------
// Public surface (the ONLY thing other modules may import)
// ---------------------------------------------------------------------------

export const Pay = {
  createPayment,
  getPayment,
  refundPayment,
  listRefunds,
  getProviderStatus,
  processWebhook, // exported for the webhook route handler
};

export type PayModule = typeof Pay;
