import { beforeEach, describe, expect, test } from 'bun:test';
import { authenticateProductRequest } from '..';
import { createCredential, revokeCredential, type ProductScope } from '@/modules/product-credentials';
import { _resetCredentialStoreForTesting } from '@/modules/product-credentials/internal/store';

function key(scopes: ProductScope[] = ['storage:read']): { apiKey: string; credentialId: string } {
  const result = createCredential({
    workspaceId: 'workspace-trusted',
    name: 'Product runtime',
    environment: 'development',
    scopes,
  });
  if (!result.success) throw new Error('fixture failed');
  return { apiKey: result.data.apiKey, credentialId: result.data.credential.credentialId };
}

beforeEach(() => {
  _resetCredentialStoreForTesting();
  process.env.NODE_ENV = 'test';
  process.env.CODELOK_API_KEY_PEPPER = 'gateway-test-pepper';
});

describe('Product API gateway authentication', () => {
  test('accepts Bearer authentication and derives workspace from the credential', () => {
    const credential = key();
    expect(authenticateProductRequest({ authorization: `Bearer ${credential.apiKey}`, requiredScope: 'storage:read' })).toMatchObject({
      success: true,
      data: {
        workspaceId: 'workspace-trusted',
        environment: 'development',
        authenticatedBy: 'product-api-key',
      },
    });
  });

  test('enforces scopes and rejects missing, malformed, or ambiguous credentials', () => {
    const credential = key(['storage:read']);
    expect(authenticateProductRequest({ apiKey: credential.apiKey, requiredScope: 'storage:write' })).toMatchObject({
      success: false,
      error: { code: 'INSUFFICIENT_SCOPE' },
    });
    expect(authenticateProductRequest({})).toMatchObject({ success: false, error: { code: 'API_KEY_REQUIRED' } });
    expect(authenticateProductRequest({ authorization: credential.apiKey })).toMatchObject({
      success: false,
      error: { code: 'INVALID_AUTHORIZATION_HEADER' },
    });
    expect(authenticateProductRequest({ authorization: `Bearer ${credential.apiKey}`, apiKey: credential.apiKey })).toMatchObject({
      success: false,
      error: { code: 'AMBIGUOUS_CREDENTIALS' },
    });
  });

  test('rejects a credential after revocation', () => {
    const credential = key();
    revokeCredential('workspace-trusted', credential.credentialId);
    expect(authenticateProductRequest({ apiKey: credential.apiKey })).toMatchObject({
      success: false,
      error: { code: 'API_KEY_REVOKED' },
    });
  });
});
