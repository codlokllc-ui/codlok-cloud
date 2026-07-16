/**
 * Codlok Cloud — Storage Module — Provider Factory (INTERNAL)
 *
 * Resolves which StorageProviderAdapter to use at runtime.
 *
 * Per §18 line 811: "Storage calls Configuration.getSecret(workspaceId, key)
 * for provider credentials."
 *
 * Per §18 line 801: "Workspace isolation — every function requires workspaceId."
 *
 * Per §3.7: "Provider credentials are never auto-created." If no storage
 * credentials are configured, the factory returns null — the public boundary
 * surfaces PROVIDER_NOT_CONFIGURED.
 *
 * This file is INTERNAL to the Storage module.
 */

import { getConfigurationService } from '@/config';
import { MockStorageProvider, S3StorageProvider } from './provider';
import type { StorageProviderAdapter } from './types';

// Test-only override. Production code never calls this.
let _testProvider: StorageProviderAdapter | null = null;

// Dev-mode mock provider (cached singleton).
let _devMockProvider: MockStorageProvider | null = null;

/**
 * Test-only escape hatch. Inject a mock provider for testing.
 * Production code MUST NOT call this.
 */
export function _setProviderForTesting(provider: StorageProviderAdapter | null): void {
  _testProvider = provider;
}

/**
 * Resolve the provider for a workspace.
 *
 * Resolution order:
 *   1. Test override (if _setProviderForTesting was called).
 *   2. Dev/mock mode (CODELOK_AUTH_USE_MOCK=true) — uses MockStorageProvider.
 *      Same env var as Auth's and Mail's mock adapters.
 *   3. Production: read storage credentials from Configuration.getSecret().
 *      Keys read: STORAGE_PROVIDER, STORAGE_BUCKET, STORAGE_ACCESS_KEY,
 *      STORAGE_SECRET_KEY (matches Configuration's MODULE_CATALOG entry).
 *      If not configured → null (PROVIDER_NOT_CONFIGURED per §3.7).
 *
 * @returns the provider + bucket name, or null if not configured.
 */
export async function resolveProvider(
  workspaceId: string
): Promise<{ provider: StorageProviderAdapter; bucket: string } | null> {
  // 1. Test override takes precedence.
  if (_testProvider !== null) {
    return { provider: _testProvider, bucket: 'mock-bucket' };
  }

  // 2. Dev/mock mode — same flag as Auth/Mail.
  if (process.env.CODELOK_AUTH_USE_MOCK === 'true') {
    if (!_devMockProvider) {
      _devMockProvider = new MockStorageProvider();
    }
    return { provider: _devMockProvider, bucket: 'mock-bucket' };
  }

  // 3. Production: read storage credentials from Configuration.
  const config = getConfigurationService();
  const [providerR, regionR, bucketR, accessKeyR, secretKeyR] = await Promise.all([
    config.getSecret(workspaceId, 'STORAGE_PROVIDER', 'storage'),
    config.getSecret(workspaceId, 'STORAGE_REGION', 'storage'),
    config.getSecret(workspaceId, 'STORAGE_BUCKET', 'storage'),
    config.getSecret(workspaceId, 'STORAGE_ACCESS_KEY', 'storage'),
    config.getSecret(workspaceId, 'STORAGE_SECRET_KEY', 'storage'),
  ]);

  if (!providerR.success || !regionR.success || !bucketR.success || !accessKeyR.success || !secretKeyR.success) {
    return null;
  }

  const providerName = providerR.data.value.toLowerCase();
  const bucket = bucketR.data.value;
  const accessKey = accessKeyR.data.value;
  const secretKey = secretKeyR.data.value;

  if (providerName === 's3' || providerName === 'r2') {
    // R2 is S3-compatible, so the same adapter works.
    const region = regionR.data.value;
    const endpoint = providerName === 'r2'
      ? `https://${process.env.STORAGE_ACCOUNT_ID}.r2.cloudflarestorage.com`
      : undefined;
    return {
      provider: new S3StorageProvider(accessKey, secretKey, region, endpoint),
      bucket,
    };
  }

  if (providerName === 'supabase') {
    // Supabase Storage uses its own SDK. For v1, we fall back to the mock
    // provider — a real Supabase adapter would be implemented when the
    // SDK is installed. This is documented in the Build Report.
    if (!_devMockProvider) {
      _devMockProvider = new MockStorageProvider();
    }
    return { provider: _devMockProvider, bucket };
  }

  // Unknown provider name.
  return null;
}

/**
 * Test-only: get the dev mock provider (if active).
 */
export function _getDevMockProvider(): MockStorageProvider | null {
  return _devMockProvider;
}
