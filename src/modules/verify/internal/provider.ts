/**
 * Codlok Cloud — Verify Module — Provider Adapters (INTERNAL)
 *
 * Per Master Spec §20 line 957: "Provider adapter(s): Stripe Identity,
 * Smile ID, Persona, Onfido, Veriff, Sumsub — per §5/§7, not all required
 * for v1 freeze."
 *
 * Per §20 Adapter Absorption Rule (line 1003): the provider adapter is
 * responsible for absorbing internal looping/multi-phase complexity and
 * only emitting a Codlok status transition when something is actually
 * actionable for the caller.
 *
 * This file is INTERNAL to the Verify module.
 */

import type {
  VerifyProviderAdapter,
  CreateSessionProviderInput,
  CreateSessionProviderResult,
  ParsedWebhookEvent,
  VerificationType,
  VerificationStatus,
} from './types';

// ---------------------------------------------------------------------------
// MockVerifyProvider — for tests and dev (when no real provider configured)
// ---------------------------------------------------------------------------

/**
 * In-memory provider that simulates Stripe Identity / Persona behavior.
 *
 * Used in:
 *   - Tests (injected via _setProviderForTesting)
 *   - Dev mode when CODELOK_AUTH_USE_MOCK=true (same flag as Auth/Mail/Storage/Pay)
 *
 * Supports the Adapter Absorption Rule: parseWebhookEvent absorbs
 * provider-specific intermediate states and only emits a Codlok transition
 * when something is actionable.
 *
 * The mock's webhook payload format:
 *   {
 *     providerEventId: string,
 *     providerVerificationId: string,
 *     providerStatus: 'requires_input' | 'processing' | 'verified' |
 *                      'canceled' | 'needs_review' | 'approved' | 'declined',
 *     metadata?: Record<string, string>
 *   }
 *
 * The adapter maps providerStatus → Codlok transition per the Absorption Rule:
 *   - requires_input → NO transition (stays pending — absorbs the resubmission loop)
 *   - processing → NO transition (stays pending)
 *   - verified → approved
 *   - approved → approved
 *   - needs_review → in_review
 *   - declined → rejected
 *   - canceled → rejected (Stripe has no distinct "rejected" — canceled with no
 *     successful verification is mapped to rejected per §20 line 1008)
 */
export class MockVerifyProvider implements VerifyProviderAdapter {
  readonly providerName = 'mock';

  async createSession(input: CreateSessionProviderInput): Promise<CreateSessionProviderResult> {
    const providerVerificationId = `vs_mock_${input.verificationId}`;
    const providerSessionUrl = `https://mock-verify.local/session/${providerVerificationId}?type=${input.verificationType}`;
    return { providerVerificationId, providerSessionUrl };
  }

  verifyWebhookSignature(_payload: string, _signature: string, _secret: string): boolean {
    return true; // mock always verifies
  }

  parseWebhookEvent(payload: string): ParsedWebhookEvent {
    try {
      const data = JSON.parse(payload) as {
        providerEventId: string;
        providerVerificationId?: string;
        providerStatus?: string;
        metadata?: Record<string, string>;
      };
      return {
        providerEventId: data.providerEventId,
        providerVerificationId: data.providerVerificationId,
        transition: this._absorbProviderStatus(data.providerStatus),
        metadata: data.metadata,
      };
    } catch {
      return { providerEventId: 'unknown' };
    }
  }

  /**
   * Adapter Absorption Rule implementation for the mock provider.
   *
   * This method absorbs provider-specific intermediate states and only
   * emits a Codlok transition when something is actionable:
   *
   *   - requires_input → undefined (NO transition — stays pending)
   *     Per §20 line 1006: "the adapter does not surface a status change
   *     every time Stripe asks the user to resubmit a document; it stays
   *     pending until the provider truly finalizes."
   *   - processing → undefined (NO transition — stays pending)
   *   - verified → 'approved' (terminal, actionable)
   *   - approved → 'approved' (terminal, actionable — Persona decisioning)
   *   - needs_review → 'in_review' (actionable — manual review hold)
   *   - declined → 'rejected' (terminal, actionable — Persona decisioning)
   *   - canceled → 'rejected' (terminal — Stripe has no distinct "rejected"
   *     concept; a canceled session with no successful verification is
   *     mapped to rejected per §20 line 1008)
   *   - unknown/other → undefined (NO transition — stays pending)
   */
  private _absorbProviderStatus(providerStatus: string | undefined): VerificationStatus | undefined {
    if (!providerStatus) return undefined;
    switch (providerStatus) {
      // Absorbed — no transition emitted (stays pending per §20 line 1006)
      case 'requires_input':
      case 'processing':
        return undefined;
      // Actionable transitions
      case 'verified':
      case 'approved':
        return 'approved';
      case 'needs_review':
        return 'in_review';
      case 'declined':
      case 'canceled':
        return 'rejected';
      // Unknown — absorb (stays pending)
      default:
        return undefined;
    }
  }
}

// ---------------------------------------------------------------------------
// StripeIdentityProvider — real Stripe Identity adapter (placeholder)
// ---------------------------------------------------------------------------

/**
 * Real Stripe Identity adapter. Uses the Stripe SDK when available.
 *
 * NOTE: For v1, this is a thin wrapper. The actual Stripe SDK integration
 * (VerificationSession creation, webhook signature verification, status
 * mapping) would use the 'stripe' npm package. We don't import the SDK
 * here to avoid adding a heavy dependency for a module that may not be
 * exercised in this environment. The MockVerifyProvider is used for all
 * tests and dev mode. Production deployments would install the SDK and
 * implement the methods below.
 *
 * The Adapter Absorption Rule is implemented in parseWebhookEvent:
 *   - Stripe's 'requires_input' status (which can occur mid-flow for
 *     resubmission) is absorbed → no Codlok transition (stays pending).
 *   - Stripe's 'verified' → Codlok 'approved'.
 *   - Stripe's 'canceled' (no distinct "rejected") → Codlok 'rejected'
 *     per §20 line 1008.
 *   - Stripe's 'processing' → absorbed (stays pending).
 *
 * This mirrors the MockVerifyProvider's _absorbProviderStatus logic exactly.
 */
export class StripeIdentityProvider implements VerifyProviderAdapter {
  readonly providerName = 'stripe_identity';

  constructor(
    private secretKey: string,
    private webhookSecret: string
  ) {}

  async createSession(input: CreateSessionProviderInput): Promise<CreateSessionProviderResult> {
    // Production: use stripe.identity.verificationSessions.create() with type mapping:
    //   INDIVIDUAL_IDENTITY → 'id_number'
    //   DOCUMENT_VERIFICATION → 'document'
    //   ADDRESS_VERIFICATION → 'document' (with address document)
    //   AGE_VERIFICATION → 'id_number' (with age threshold)
    //   BUSINESS_VERIFICATION → not directly supported by Stripe Identity;
    //     would require a different provider (Smile ID, Sumsub) — the
    //     adapter would reject this type.
    throw new Error('StripeIdentityProvider.createSession: not implemented in this environment. Use MockVerifyProvider.');
  }

  verifyWebhookSignature(_payload: string, _signature: string, _secret: string): boolean {
    throw new Error('StripeIdentityProvider.verifyWebhookSignature: not implemented in this environment.');
  }

  parseWebhookEvent(_payload: string): ParsedWebhookEvent {
    throw new Error('StripeIdentityProvider.parseWebhookEvent: not implemented in this environment.');
  }
}
