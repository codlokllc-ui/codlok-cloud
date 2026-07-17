import { beforeEach, describe, expect, test } from 'bun:test';
import { authenticateProductRequest } from '..';
import { createCredential, revokeCredential } from '@/modules/product-credentials';
import { _resetCredentialStoreForTesting } from '@/modules/product-credentials/internal/store';
import { _resetGatewayPolicyForTesting } from '../policy';

beforeEach(() => { _resetCredentialStoreForTesting(); _resetGatewayPolicyForTesting(); process.env.NODE_ENV = 'test'; process.env.CODELOK_API_KEY_PEPPER = 'gateway-test'; });

async function key() {
  const result = await createCredential({ workspaceId: 'workspace-trusted', name: 'Runtime', environment: 'development', scopes: ['storage:read'] });
  if (!result.success) throw new Error('fixture failed');
  return result.data;
}

describe('Product API gateway', () => {
  test('derives workspace from Bearer credential and enforces scope', async () => {
    const created = await key();
    expect(await authenticateProductRequest({ authorization: `Bearer ${created.apiKey}`, requiredScope: 'storage:read' }))
      .toMatchObject({ success: true, data: { workspaceId: 'workspace-trusted', authenticatedBy: 'product-api-key' } });
    expect(await authenticateProductRequest({ apiKey: created.apiKey, requiredScope: 'storage:write' }))
      .toMatchObject({ success: false, error: { code: 'INSUFFICIENT_SCOPE' } });
  });

  test('rejects missing, ambiguous, and revoked credentials', async () => {
    const created = await key();
    expect(await authenticateProductRequest({})).toMatchObject({ success: false, error: { code: 'API_KEY_REQUIRED' } });
    expect(await authenticateProductRequest({ authorization: `Bearer ${created.apiKey}`, apiKey: created.apiKey }))
      .toMatchObject({ success: false, error: { code: 'AMBIGUOUS_CREDENTIALS' } });
    await revokeCredential('workspace-trusted', created.credential.credentialId);
    expect(await authenticateProductRequest({ apiKey: created.apiKey })).toMatchObject({ success: false, error: { code: 'API_KEY_REVOKED' } });
  });

  test('enforces the development per-minute quota', async () => {
    const created = await key();
    for (let request = 0; request < 120; request += 1) {
      expect((await authenticateProductRequest({ apiKey: created.apiKey, operation: 'storage.list' })).success).toBe(true);
    }
    expect(await authenticateProductRequest({ apiKey: created.apiKey, operation: 'storage.list' }))
      .toMatchObject({ success: false, error: { code: 'RATE_LIMITED' } });
  });
});
