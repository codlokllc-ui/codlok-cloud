/**
 * Codlok Cloud — Mail Module — Provider Factory (INTERNAL)
 *
 * Resolves which MailProviderAdapter to use at runtime.
 *
 * Per §17 line 700: "Mail calls Configuration.getSecret(workspaceId, key)
 * for provider credentials (e.g. Resend API key)."
 *
 * Per §17 line 697: "Every function requires workspaceId." The factory
 * resolves the provider for the specific workspace's configured credentials.
 *
 * Per §3.7: "Provider credentials are never auto-created." If no Resend key
 * is configured for the workspace, the factory returns null — the public
 * boundary surfaces PROVIDER_NOT_CONFIGURED.
 *
 * This file is INTERNAL to the Mail module.
 */

import { getConfigurationService } from '@/config';
import { ResendAdapter, MockMailProvider } from './provider';
import type { MailProviderAdapter } from './types';

// Test-only override. Production code never calls this.
let _testProvider: MailProviderAdapter | null = null;

/**
 * Test-only escape hatch. Inject a mock provider for testing.
 * Production code MUST NOT call this.
 */
export function _setProviderForTesting(provider: MailProviderAdapter | null): void {
  _testProvider = provider;
}

/**
 * Resolve the provider for a workspace.
 *
 * Resolution order:
 *   1. Test override (if _setProviderForTesting was called).
 *   2. Dev/mock mode (CODELOK_AUTH_USE_MOCK=true) — uses MockMailProvider.
 *      Same env var as Auth's mock adapter, so tests that set this flag
 *      get both mock Auth AND mock Mail without additional setup. This is
 *      a dev-mode escape hatch, NOT a production behavior.
 *   3. Production: read Resend API key from Configuration.getSecret().
 *      If not configured → null (PROVIDER_NOT_CONFIGURED per §3.7).
 *
 * @returns the provider, or null if not configured (PROVIDER_NOT_CONFIGURED).
 */
export async function resolveProvider(
  workspaceId: string
): Promise<MailProviderAdapter | null> {
  // 1. Test override takes precedence.
  if (_testProvider !== null) return _testProvider;

  // 2. Dev/mock mode — same flag as Auth's mock adapter.
  if (process.env.CODELOK_AUTH_USE_MOCK === 'true') {
    return _getOrCreateDevMockProvider();
  }

  // 3. Production: read Resend API key from Configuration (§17 line 700, §3.4).
  const config = getConfigurationService();
  const r = await config.getSecret(workspaceId, 'RESEND_API_KEY', 'mail');
  if (!r.success) return null;
  return new ResendAdapter(r.data.value);
}

// ---------------------------------------------------------------------------
// Dev-mode mock provider (cached singleton)
// ---------------------------------------------------------------------------

let _devMockProvider: MockMailProvider | null = null;

function _getOrCreateDevMockProvider(): MockMailProvider {
  if (!_devMockProvider) {
    _devMockProvider = new MockMailProvider();
  }
  return _devMockProvider;
}

/**
 * Test-only: get the test provider (if set). Throws if no test provider.
 */
export function _getTestProvider(): MockMailProvider {
  if (!(_testProvider instanceof MockMailProvider)) {
    throw new Error('No MockMailProvider set. Call _setProviderForTesting first.');
  }
  return _testProvider as MockMailProvider;
}
