/**
 * Codlok Cloud — SMS Module — Provider Factory (INTERNAL)
 *
 * Resolves which SmsProviderAdapter to use at runtime.
 *
 * Per §22: SMS calls Configuration.getSecret(workspaceId, key) for provider
 * credentials. Keys: TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN (matches
 * Configuration's MODULE_CATALOG entry for 'sms').
 *
 * This file is INTERNAL to the SMS module.
 */

import { getConfigurationService } from '@/config';
import { MockSmsProvider, TwilioSmsProvider } from './provider';
import type { SmsProviderAdapter } from './types';

// Test-only override.
let _testProvider: SmsProviderAdapter | null = null;

// Dev-mode mock provider (cached singleton).
let _devMockProvider: MockSmsProvider | null = null;

/**
 * Test-only escape hatch. Inject a mock provider for testing.
 */
export function _setProviderForTesting(provider: SmsProviderAdapter | null): void {
  _testProvider = provider;
}

/**
 * Test-only: get the currently-injected test provider (or null).
 * Used by processWebhook which doesn't have a workspaceId to resolve a
 * provider normally.
 */
export function _getTestProvider(): SmsProviderAdapter | null {
  return _testProvider;
}

/**
 * Resolve the provider for a workspace.
 *
 * Resolution order:
 *   1. Test override.
 *   2. Dev/mock mode (CODELOK_AUTH_USE_MOCK=true).
 *   3. Production: read Twilio credentials from Configuration.getSecret().
 *
 * @returns the provider, or null if not configured.
 */
export async function resolveProvider(
  workspaceId: string
): Promise<SmsProviderAdapter | null> {
  // 1. Test override takes precedence.
  if (_testProvider !== null) return _testProvider;

  // 2. Dev/mock mode — same flag as Auth/Mail/Storage/Pay/Verify.
  if (process.env.CODELOK_AUTH_USE_MOCK === 'true') {
    if (!_devMockProvider) {
      _devMockProvider = new MockSmsProvider();
    }
    return _devMockProvider;
  }

  // 3. Production: read Twilio credentials from Configuration.
  const config = getConfigurationService();
  const [sidR, tokenR] = await Promise.all([
    config.getSecret(workspaceId, 'TWILIO_ACCOUNT_SID', 'sms'),
    config.getSecret(workspaceId, 'TWILIO_AUTH_TOKEN', 'sms'),
  ]);

  if (!sidR.success || !tokenR.success) {
    return null;
  }

  // For v1, we'd also need a from-number. In production this would come from
  // Configuration or a workspace setting. For now, use a placeholder.
  const fromNumber = process.env.TWILIO_FROM_NUMBER ?? '+1234567890';
  return new TwilioSmsProvider(sidR.data.value, tokenR.data.value, fromNumber);
}
