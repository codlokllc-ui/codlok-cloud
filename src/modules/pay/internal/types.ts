/**
 * Codlok Cloud — Pay Module — Internal Types (INTERNAL)
 *
 * Per Master Spec §19. This file is internal to the Pay module.
 *
 * Per §3.12 (Financial Ownership Rule): Pay stores only financial facts
 * (amount, currency, provider transaction ID, status) — never business
 * entities. No entityType/entityId fields anywhere.
 *
 * Per §19 PCI Boundary Rule: Pay never receives/logs/stores raw card data.
 */

// ---------------------------------------------------------------------------
// Payment Status State Machine (§19 line 892 — binding)
// ---------------------------------------------------------------------------
//
//   pending → succeeded → refund_pending → refunded (full)
//                       → refund_pending → partially_refunded (partial)
//          → failed (terminal)
//   succeeded → disputed (provider-initiated, via webhook only)
//
// - failed is terminal — never retried in place.
// - Financial facts (amount/currency/payer/provider) immutable after
//   createPayment() succeeds. Only status transitions.

export type PaymentStatus =
  | 'pending'
  | 'succeeded'
  | 'failed'
  | 'refund_pending'
  | 'refunded'
  | 'partially_refunded'
  | 'disputed';

export type RefundStatus =
  | 'refund_pending'
  | 'refunded'
  | 'failed';

// ---------------------------------------------------------------------------
// Payment record (the canonical financial fact)
// ---------------------------------------------------------------------------

export interface PaymentRecord {
  /** Unique payment identifier (returned to caller). */
  paymentId: string;
  /** Workspace scope (required per §19 line 913). */
  workspaceId: string;
  /** Integer minor units (e.g. 1999 for $19.99). Never floating-point. */
  amountMinorUnits: number;
  /** ISO 4217 currency code (e.g. 'USD', 'NGN', 'JPY'). */
  currency: string;
  status: PaymentStatus;
  /** Provider name ('stripe' | 'mock'). */
  provider: string;
  /** Provider's transaction/session ID (e.g. Stripe Checkout Session ID). */
  providerPaymentId?: string;
  /** Checkout URL for the customer to enter payment details (PCI Boundary). */
  checkoutUrl?: string;
  /** Total amount refunded so far (minor units). */
  refundedAmountMinorUnits: number;
  /** Idempotency key from createPayment (for dedup). */
  idempotencyKey: string;
  createdAt: string;
  updatedAt: string;
  /** When the payment succeeded (if succeeded). */
  succeededAt?: string;
  /** When the payment failed (if failed). */
  failedAt?: string;
  /** When the payment was disputed (if disputed). */
  disputedAt?: string;
  /** Settlement metadata — exchange rate as REPORTED by provider (never computed). */
  settlementExchangeRate?: number;
  settlementCurrency?: string;
}

// ---------------------------------------------------------------------------
// Refund record
// ---------------------------------------------------------------------------

export interface RefundRecord {
  /** Unique refund identifier. */
  refundId: string;
  paymentId: string;
  workspaceId: string;
  /** Amount refunded (minor units). */
  amountMinorUnits: number;
  status: RefundStatus;
  /** Provider's refund ID. */
  providerRefundId?: string;
  /** Idempotency key from refundPayment (for dedup). */
  idempotencyKey: string;
  createdAt: string;
  updatedAt: string;
  /** When the refund succeeded (if refunded). */
  refundedAt?: string;
  /** When the refund failed (if failed). */
  failedAt?: string;
}

// ---------------------------------------------------------------------------
// Webhook event log (for deduplication per §19 line 908)
// ---------------------------------------------------------------------------

export interface WebhookEventRecord {
  /** Provider name ('stripe' | 'mock'). */
  provider: string;
  /** Provider's unique event ID (used for dedup). */
  providerEventId: string;
  /** Workspace scope. */
  workspaceId: string;
  /** ISO timestamp when processed. */
  processedAt: string;
  /** The payment this event affected (if any). */
  paymentId?: string;
  /** The status transition applied (if any). */
  appliedTransition?: PaymentStatus;
}

// ---------------------------------------------------------------------------
// Provider adapter interface (internal — abstraction over Stripe, etc.)
// ---------------------------------------------------------------------------

export interface CreatePaymentProviderInput {
  workspaceId: string;
  amountMinorUnits: number;
  currency: string;
  paymentId: string;
  idempotencyKey: string;
}

export interface CreatePaymentProviderResult {
  /** Provider's checkout/session ID. */
  providerPaymentId: string;
  /** URL for the customer to enter payment details (PCI Boundary). */
  checkoutUrl: string;
}

export interface RefundProviderInput {
  workspaceId: string;
  paymentId: string;
  providerPaymentId: string;
  amountMinorUnits: number;
  refundId: string;
  idempotencyKey: string;
}

export interface RefundProviderResult {
  providerRefundId: string;
  status: 'refund_pending' | 'refunded';
}

export interface PayProviderAdapter {
  /** Create a payment intent / checkout session at the provider. */
  createPayment(input: CreatePaymentProviderInput): Promise<CreatePaymentProviderResult>;

  /** Issue a refund at the provider. */
  issueRefund(input: RefundProviderInput): Promise<RefundProviderResult>;

  /** Verify a webhook signature (provider-specific). */
  verifyWebhookSignature(payload: string, signature: string, secret: string): boolean;

  /** Parse a webhook payload into a normalized event. */
  parseWebhookEvent(payload: string): ParsedWebhookEvent;

  /** Provider name for metadata. */
  readonly providerName: string;
}

export interface ParsedWebhookEvent {
  providerEventId: string;
  paymentId?: string;
  providerPaymentId?: string;
  /** The status transition to apply (if any). */
  transition?: PaymentStatus;
  /** Settlement metadata (exchange rate as reported by provider). */
  settlementExchangeRate?: number;
  settlementCurrency?: string;
}

// ---------------------------------------------------------------------------
// PayError — internal exception
// ---------------------------------------------------------------------------

export class PayError extends Error {
  constructor(
    public readonly code: string,
    message: string
  ) {
    super(message);
    this.name = 'PayError';
  }
}
