/**
 * Codlok Cloud — Verify Module — Provider Factory (INTERNAL)
 *
 * Resolves which VerifyProviderAdapter to use at runtime.
 *
 * Per §20 line 1019: "Verify calls Configuration.getSecret(workspaceId, key)
 * for provider credentials."
 *
 * Per §20 line 1016: "Every function requires workspaceId."
 *
 * Per §3.7: "Provider credentials are never auto-created." If no Stripe
 * Identity credentials are configured, the factory returns null — the public
 * boundary surfaces PROVIDER_NOT_CONFIGURED.
 *
 * This file is INTERNAL to the Verify module.
 */

import { getConfigurationService } from '@/config';
import { MockVerifyProvider, StripeIdentityProvider } from './provider';
import type { VerifyProviderAdapter } from './types';

// Test-only override. Production code never calls this.
let _testProvider: VerifyProviderAdapter | null = null;

// Dev-mode mock provider (cached singleton).
let _devMockProvider: MockVerifyProvider | null = null;

/**
 * Test-only escape hatch. Inject a mock provider for testing.
 * Production code MUST NOT call this.
 */
export function _setProviderForTesting(provider: VerifyProviderAdapter | null): void {
  _testProvider = provider;
}

/**
 * Resolve the provider for a workspace.
 *
 * Resolution order:
 *   1. Test override (if _setProviderForTesting was called).
 *   2. Dev/mock mode (CODELOK_AUTH_USE_MOCK=true) — uses MockVerifyProvider.
 *      Same env var as Auth/Mail/Storage/Pay mock adapters.
 *   3. Production: read Stripe Identity credentials from Configuration.getSecret().
 *      Keys read: STRIPE_IDENTITY_SECRET_KEY, STRIPE_IDENTITY_WEBHOOK_SECRET
 *      (matches Configuration's MODULE_CATALOG entry for 'verify').
 *      If not configured → null (PROVIDER_NOT_CONFIGURED per §3.7).
 *
 * @returns the provider, or null if not configured.
 */
export async function resolveProvider(
  workspaceId: string
): Promise<VerifyProviderAdapter | null> {
  // 1. Test override takes precedence.
  if (_testProvider !== null) return _testProvider;

  // 2. Dev/mock mode — same flag as Auth/Mail/Storage/Pay.
  if (process.env.CODELOK_AUTH_USE_MOCK === 'true') {
    if (!_devMockProvider) {
      _devMockProvider = new MockVerifyProvider();
    }
    return _devMockProvider;
  }

  // 3. Production: read Stripe Identity credentials from Configuration.
  const config = getConfigurationService();
  const [secretKeyR, webhookSecretR] = await Promise.all([
    config.getSecret(workspaceId, 'STRIPE_IDENTITY_SECRET_KEY', 'verify'),
    config.getSecret(workspaceId, 'STRIPE_IDENTITY_WEBHOOK_SECRET', 'verify'),
  ]);

  if (!secretKeyR.success || !webhookSecretR.success) {
    return null;
  }

  return new StripeIdentityProvider(
    secretKeyR.data.value,
    webhookSecretR.data.value
  );
}
