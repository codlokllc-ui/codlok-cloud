/**
 * Codlok Cloud — Pay Module — Provider Factory (INTERNAL)
 *
 * Resolves which PayProviderAdapter to use at runtime.
 *
 * Per §19 line 917: "Pay calls Configuration.getSecret(workspaceId, key)
 * for provider credentials (e.g. Stripe secret key)."
 *
 * Per §19 line 913: "Every function requires workspaceId."
 *
 * Per §3.7: "Provider credentials are never auto-created." If no Stripe
 * credentials are configured, the factory returns null — the public boundary
 * surfaces PROVIDER_NOT_CONFIGURED.
 *
 * This file is INTERNAL to the Pay module.
 */

import { getConfigurationService } from '@/config';
import { MockPayProvider, StripePayProvider } from './provider';
import type { PayProviderAdapter } from './types';

// Test-only override. Production code never calls this.
let _testProvider: PayProviderAdapter | null = null;

// Dev-mode mock provider (cached singleton).
let _devMockProvider: MockPayProvider | null = null;

/**
 * Test-only escape hatch. Inject a mock provider for testing.
 * Production code MUST NOT call this.
 */
export function _setProviderForTesting(provider: PayProviderAdapter | null): void {
  _testProvider = provider;
}

/**
 * Resolve the provider for a workspace.
 *
 * Resolution order:
 *   1. Test override (if _setProviderForTesting was called).
 *   2. Dev/mock mode (CODELOK_AUTH_USE_MOCK=true) — uses MockPayProvider.
 *      Same env var as Auth/Mail/Storage mock adapters.
 *   3. Production: read Stripe credentials from Configuration.getSecret().
 *      Keys read: STRIPE_SECRET_KEY, STRIPE_WEBHOOK_SECRET (matches
 *      Configuration's MODULE_CATALOG entry for 'pay').
 *      If not configured → null (PROVIDER_NOT_CONFIGURED per §3.7).
 *
 * @returns the provider, or null if not configured.
 */
export async function resolveProvider(
  workspaceId: string
): Promise<PayProviderAdapter | null> {
  // 1. Test override takes precedence.
  if (_testProvider !== null) return _testProvider;

  // 2. Dev/mock mode — same flag as Auth/Mail/Storage.
  if (process.env.CODELOK_AUTH_USE_MOCK === 'true') {
    if (!_devMockProvider) {
      _devMockProvider = new MockPayProvider();
    }
    return _devMockProvider;
  }

  // 3. Production: read Stripe credentials from Configuration.
  const config = getConfigurationService();
  const [secretKeyR, webhookSecretR] = await Promise.all([
    config.getSecret(workspaceId, 'STRIPE_SECRET_KEY', 'pay'),
    config.getSecret(workspaceId, 'STRIPE_WEBHOOK_SECRET', 'pay'),
  ]);

  if (!secretKeyR.success || !webhookSecretR.success) {
    return null;
  }

  return new StripePayProvider(
    secretKeyR.data.value,
    webhookSecretR.data.value
  );
}
