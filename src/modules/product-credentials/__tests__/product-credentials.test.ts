import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { authenticateCredential, createCredential, listCredentials, revokeCredential, rotateCredential, type ProductScope } from '..';
import { credentialStore, _resetCredentialStoreForTesting } from '../internal/store';

async function create(scopes: ProductScope[] = ['pay:write']) {
  return createCredential({ workspaceId: 'workspace-a', name: 'Staging product', environment: 'staging', scopes, createdBy: 'user-a' });
}

beforeEach(() => {
  _resetCredentialStoreForTesting();
  process.env.NODE_ENV = 'test';
  process.env.CODELOK_API_KEY_PEPPER = 'test-pepper';
});
afterEach(() => {
  process.env.NODE_ENV = 'test';
  process.env.CODELOK_API_KEY_PEPPER = 'test-pepper';
});

describe('Product Credentials', () => {
  test('stores only a digest and never lists raw key material', async () => {
    const created = await create();
    expect(created.success).toBe(true);
    if (!created.success) return;
    const stored = credentialStore.get(created.data.credential.credentialId);
    expect(stored?.keyDigest).toMatch(/^[a-f0-9]{64}$/);
    expect(JSON.stringify(stored)).not.toContain(created.data.apiKey);
    const listed = await listCredentials('workspace-a');
    expect(listed.success && listed.data[0]).not.toHaveProperty('keyDigest');
  });

  test('authenticates into trusted workspace context and rejects tampering', async () => {
    const created = await create(['pay:read', 'pay:write']);
    if (!created.success) throw new Error('fixture failed');
    expect(await authenticateCredential(created.data.apiKey)).toMatchObject({ success: true, data: { workspaceId: 'workspace-a', environment: 'staging' } });
    const replacement = created.data.apiKey.endsWith('A') ? 'B' : 'A';
    expect(await authenticateCredential(`${created.data.apiKey.slice(0, -1)}${replacement}`)).toMatchObject({ success: false, error: { code: 'INVALID_API_KEY' } });
  });

  test('enforces workspace-isolated revocation and expiry', async () => {
    const created = await create();
    if (!created.success) throw new Error('fixture failed');
    expect(await revokeCredential('workspace-b', created.data.credential.credentialId)).toMatchObject({ success: false, error: { code: 'CREDENTIAL_NOT_FOUND' } });
    const record = credentialStore.get(created.data.credential.credentialId)!;
    record.expiresAt = new Date(Date.now() - 1000).toISOString();
    expect(await authenticateCredential(created.data.apiKey)).toMatchObject({ success: false, error: { code: 'API_KEY_EXPIRED' } });
  });

  test('rotates to a new key and revokes the old key', async () => {
    const created = await create();
    if (!created.success) throw new Error('fixture failed');
    const rotated = await rotateCredential('workspace-a', created.data.credential.credentialId, 'user-a');
    expect(rotated.success).toBe(true);
    expect(await authenticateCredential(created.data.apiKey)).toMatchObject({ success: false, error: { code: 'API_KEY_REVOKED' } });
    if (rotated.success) expect(await authenticateCredential(rotated.data.apiKey)).toMatchObject({ success: true });
  });

  test('rejects unknown runtime scopes and missing production pepper', async () => {
    expect(await createCredential({ workspaceId: 'workspace-a', name: 'Bad', environment: 'staging', scopes: ['bad' as ProductScope] }))
      .toMatchObject({ success: false, error: { code: 'INVALID_SCOPE' } });
    process.env.NODE_ENV = 'production'; delete process.env.CODELOK_API_KEY_PEPPER;
    expect(await create()).toMatchObject({ success: false, error: { code: 'API_KEY_PEPPER_NOT_CONFIGURED' } });
  });
});
