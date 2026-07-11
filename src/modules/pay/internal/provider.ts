/**
 * Codlok Cloud — Pay Module — Provider Adapters (INTERNAL)
 *
 * Per Master Spec §19 line 849: "Provider adapter(s): Stripe (primary).
 * Paystack, PayPal, Flutterwave, Wise listed in §5 as future-supported
 * providers — not required for v1 freeze."
 *
 * Per §19 PCI Boundary Rule (line 905): "Pay never receives, transmits,
 * logs, or stores raw card numbers, CVVs, or bank account credentials.
 * createPayment() returns a checkoutUrl pointing to the provider's own
 * hosted checkout/tokenization flow."
 *
 * Per §19 line 917: "Pay calls Configuration.getSecret(workspaceId, key)
 * for provider credentials (e.g. Stripe secret key). Pay calls no other
 * module."
 *
 * This file is INTERNAL to the Pay module.
 */

import type {
  PayProviderAdapter,
  CreatePaymentProviderInput,
  CreatePaymentProviderResult,
  RefundProviderInput,
  RefundProviderResult,
  ParsedWebhookEvent,
} from './types';

// ---------------------------------------------------------------------------
// MockPayProvider — for tests and dev (when no real Stripe configured)
// ---------------------------------------------------------------------------

/**
 * In-memory provider that simulates Stripe behavior.
 *
 * Used in:
 *   - Tests (injected via _setProviderForTesting)
 *   - Dev mode when CODELOK_AUTH_USE_MOCK=true (same flag as Auth/Mail/Storage)
 *
 * Supports:
 *   - createPayment: returns a fake checkoutUrl
 *   - issueRefund: returns a fake providerRefundId
 *   - verifyWebhookSignature: always true (mock)
 *   - parseWebhookEvent: parses a simple JSON payload
 */
export class MockPayProvider implements PayProviderAdapter {
  readonly providerName = 'mock';

  async createPayment(input: CreatePaymentProviderInput): Promise<CreatePaymentProviderResult> {
    const providerPaymentId = `cs_mock_${input.paymentId}`;
    const checkoutUrl = `https://mock-pay.local/checkout/${providerPaymentId}?amount=${input.amountMinorUnits}&currency=${input.currency}`;
    return { providerPaymentId, checkoutUrl };
  }

  async issueRefund(input: RefundProviderInput): Promise<RefundProviderResult> {
    return {
      providerRefundId: `re_mock_${input.refundId}`,
      status: 'refunded', // mock immediately succeeds
    };
  }

  verifyWebhookSignature(_payload: string, _signature: string, _secret: string): boolean {
    return true; // mock always verifies
  }

  parseWebhookEvent(payload: string): ParsedWebhookEvent {
    try {
      const data = JSON.parse(payload) as {
        providerEventId: string;
        paymentId?: string;
        providerPaymentId?: string;
        transition?: ParsedWebhookEvent['transition'];
        settlementExchangeRate?: number;
        settlementCurrency?: string;
      };
      return {
        providerEventId: data.providerEventId,
        paymentId: data.paymentId,
        providerPaymentId: data.providerPaymentId,
        transition: data.transition,
        settlementExchangeRate: data.settlementExchangeRate,
        settlementCurrency: data.settlementCurrency,
      };
    } catch {
      return { providerEventId: 'unknown' };
    }
  }
}

// ---------------------------------------------------------------------------
// StripePayProvider — real Stripe adapter (placeholder for production)
// ---------------------------------------------------------------------------

/**
 * Real Stripe adapter. Uses the Stripe SDK when available.
 *
 * NOTE: For v1, this is a thin wrapper. The actual Stripe SDK integration
 * (Checkout Session creation, Refund creation, Webhook signature verification)
 * would use the 'stripe' npm package. We don't import the SDK here to avoid
 * adding a heavy dependency for a module that may not be exercised in this
 * environment. The MockPayProvider is used for all tests and dev mode.
 * Production deployments would install the SDK and implement the methods below.
 *
 * The interface is complete — only the implementation bodies are stubbed.
 */
export class StripePayProvider implements PayProviderAdapter {
  readonly providerName = 'stripe';

  constructor(
    private secretKey: string,
    private webhookSecret: string
  ) {}

  async createPayment(input: CreatePaymentProviderInput): Promise<CreatePaymentProviderResult> {
    // Production: use stripe.checkout.sessions.create() with the idempotencyKey.
    // For now, this is a stub — MockPayProvider is used for all tests/dev.
    throw new Error('StripePayProvider.createPayment: not implemented in this environment. Use MockPayProvider.');
  }

  async issueRefund(input: RefundProviderInput): Promise<RefundProviderResult> {
    throw new Error('StripePayProvider.issueRefund: not implemented in this environment.');
  }

  verifyWebhookSignature(_payload: string, _signature: string, _secret: string): boolean {
    throw new Error('StripePayProvider.verifyWebhookSignature: not implemented in this environment.');
  }

  parseWebhookEvent(_payload: string): ParsedWebhookEvent {
    throw new Error('StripePayProvider.parseWebhookEvent: not implemented in this environment.');
  }
}
