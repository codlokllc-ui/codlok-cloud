import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import {
  authenticateCredential,
  createCredential,
  listCredentials,
  revokeCredential,
  type ProductScope,
} from '..';
import { credentialStore, _resetCredentialStoreForTesting } from '../internal/store';

const originalNodeEnv = process.env.NODE_ENV;
const originalPepper = process.env.CODELOK_API_KEY_PEPPER;

function create(scopes: ProductScope[] = ['pay:write']) {
  return createCredential({
    workspaceId: 'workspace-a',
    name: 'Staging product',
    environment: 'staging',
    scopes,
  });
}

beforeEach(() => {
  _resetCredentialStoreForTesting();
  process.env.NODE_ENV = 'test';
  process.env.CODELOK_API_KEY_PEPPER = 'test-pepper-never-used-in-production';
});

afterEach(() => {
  process.env.NODE_ENV = originalNodeEnv;
  if (originalPepper === undefined) delete process.env.CODELOK_API_KEY_PEPPER;
  else process.env.CODELOK_API_KEY_PEPPER = originalPepper;
});

describe('Product Credentials', () => {
  test('returns the raw key once and never stores or lists it', () => {
    const created = create();
    expect(created.success).toBe(true);
    if (!created.success) return;
    expect(created.data.apiKey).toMatch(/^cdlk_stg_/);
    expect(created.data.credential).not.toHaveProperty('keyDigest');

    const stored = credentialStore.get(created.data.credential.credentialId);
    expect(stored?.keyDigest).toMatch(/^[a-f0-9]{64}$/);
    expect(JSON.stringify(stored)).not.toContain(created.data.apiKey);

    const listed = listCredentials('workspace-a');
    expect(listed.success).toBe(true);
    expect(JSON.stringify(listed)).not.toContain(created.data.apiKey);
    expect(listed.success && listed.data[0]).not.toHaveProperty('keyDigest');
  });

  test('authenticates a valid key into trusted workspace context', () => {
    const created = create(['pay:read', 'pay:write']);
    if (!created.success) throw new Error('fixture failed');
    const result = authenticateCredential(created.data.apiKey);
    expect(result).toMatchObject({
      success: true,
      data: {
        workspaceId: 'workspace-a',
        environment: 'staging',
        scopes: ['pay:read', 'pay:write'],
      },
    });
  });

  test('rejects malformed and tampered keys without revealing lookup details', () => {
    expect(authenticateCredential('not-a-key')).toMatchObject({ success: false, error: { code: 'INVALID_API_KEY' } });
    const created = create();
    if (!created.success) throw new Error('fixture failed');
    const tampered = `${created.data.apiKey.slice(0, -1)}A`;
    expect(authenticateCredential(tampered)).toMatchObject({ success: false, error: { code: 'INVALID_API_KEY' } });
  });

  test('revocation is workspace-isolated and blocks later authentication', () => {
    const created = create();
    if (!created.success) throw new Error('fixture failed');
    expect(revokeCredential('workspace-b', created.data.credential.credentialId)).toMatchObject({
      success: false,
      error: { code: 'CREDENTIAL_NOT_FOUND' },
    });
    expect(revokeCredential('workspace-a', created.data.credential.credentialId).success).toBe(true);
    expect(authenticateCredential(created.data.apiKey)).toMatchObject({ success: false, error: { code: 'API_KEY_REVOKED' } });
    expect(listCredentials('workspace-b')).toMatchObject({ success: true, data: [] });
  });

  test('rejects expired keys and invalid runtime scopes', () => {
    const created = create();
    if (!created.success) throw new Error('fixture failed');
    const record = credentialStore.get(created.data.credential.credentialId);
    if (!record) throw new Error('fixture missing');
    record.expiresAt = new Date(Date.now() - 1_000).toISOString();
    expect(authenticateCredential(created.data.apiKey)).toMatchObject({ success: false, error: { code: 'API_KEY_EXPIRED' } });

    const invalid = createCredential({
      workspaceId: 'workspace-a',
      name: 'Invalid',
      environment: 'staging',
      scopes: ['admin:everything' as ProductScope],
    });
    expect(invalid).toMatchObject({ success: false, error: { code: 'INVALID_SCOPE' } });
  });

  test('fails closed when the production pepper is absent', () => {
    process.env.NODE_ENV = 'production';
    delete process.env.CODELOK_API_KEY_PEPPER;
    expect(create()).toMatchObject({ success: false, error: { code: 'API_KEY_PEPPER_NOT_CONFIGURED' } });
  });
});
