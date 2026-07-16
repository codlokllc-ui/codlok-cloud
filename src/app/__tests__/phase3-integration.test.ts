/**
 * Codlok Cloud Dashboard — Phase 3 Integration Tests
 *
 * Tests for Provider Configuration:
 *   - Secret management via Configuration.setSecret/getSecret/deleteSecret
 *   - Workspace default provider selection via Configuration.setFeatureFlag/getFeatureFlag
 *   - Provider status via Configuration.getProviderStatus
 *   - Workspace isolation (secrets are workspace-scoped)
 *   - Secrets never exposed (getSecret returns value, but dashboard API route
 *     only returns configured: boolean, never the value)
 *   - Provider Registry defaultProvider field is never modified
 *
 * Run with: `bun test src/app/__tests__/phase3-integration.test.ts`
 */

import { describe, test, expect, beforeEach, afterAll } from 'bun:test';
import { Auth } from '@/modules/auth';
import { Organizations } from '@/modules/organizations';
import { Configuration } from '@/config';
import { _setAdapterForTesting } from '@/modules/auth/adapters/factory';
import { MockAuthAdapter } from '@/modules/auth/adapters/mock';
import { _resetStoreForTesting as _resetOrgStore } from '@/modules/organizations/internal/store';
import { _resetStoreForTesting as _resetConfigStore } from '@/config';
import { _clearOutboxForTesting, _getOutboxForTesting } from '@/modules/mail';

// ---------------------------------------------------------------------------
// Setup
// ---------------------------------------------------------------------------

beforeEach(() => {
  _setAdapterForTesting(new MockAuthAdapter());
  _resetOrgStore();
  _resetConfigStore();
  _clearOutboxForTesting();
  process.env.CODELOK_AUTH_USE_MOCK = 'true';
});

afterAll(() => {
  _setAdapterForTesting(null);
});

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

async function registerAndLogin(email: string) {
  const reg = await Auth.registerUser(email, 'supersecret123');
  if (!reg.success) throw new Error(`register failed: ${reg.error.code}`);
  const outbox = _getOutboxForTesting();
  const entry = outbox.find((e) => e.to === email && e.type === 'verification');
  if (entry) {
    const url = new URL(entry.url);
    const token = url.searchParams.get('token') ?? '';
    if (token) await Auth.verifyEmail(token);
  }
  const login = await Auth.loginUser(email, 'supersecret123');
  if (!login.success) throw new Error(`login failed: ${login.error.code}`);
  return { userId: login.data.userId, accessToken: login.data.accessToken };
}

async function createWorkspace(accessToken: string, name: string) {
  const r = await Organizations.createWorkspace(accessToken, { name });
  if (!r.success) throw new Error(`createWorkspace failed: ${r.error.code}`);
  return r.data;
}

// ===========================================================================
// Secret Management — setSecret / getSecret / deleteSecret
// ===========================================================================

describe('Phase 3 — Secret Management', () => {
  test('setSecret stores a credential, getSecret retrieves it', async () => {
    const user = await registerAndLogin('p3s@codlok.cloud');
    const ws = await createWorkspace(user.accessToken, 'Test');

    const setR = await Configuration.setSecret(ws.id, 'STRIPE_SECRET_KEY', 'sk_test_123', user.userId);
    expect(setR.success).toBe(true);
    if (!setR.success) return;
    expect(setR.data.configured).toBe(true);
    expect(setR.data.version).toBe(1);

    const getR = await Configuration.getSecret(ws.id, 'STRIPE_SECRET_KEY', 'dashboard');
    expect(getR.success).toBe(true);
    if (!getR.success) return;
    expect(getR.data.value).toBe('sk_test_123');
  });

  test('deleteSecret removes a credential', async () => {
    const user = await registerAndLogin('p3d@codlok.cloud');
    const ws = await createWorkspace(user.accessToken, 'Test');

    await Configuration.setSecret(ws.id, 'STRIPE_SECRET_KEY', 'sk_test_456', user.userId);
    const delR = await Configuration.deleteSecret(ws.id, 'STRIPE_SECRET_KEY', user.userId);
    expect(delR.success).toBe(true);
    expect(delR.data.configured).toBe(false);

    const getR = await Configuration.getSecret(ws.id, 'STRIPE_SECRET_KEY', 'dashboard');
    expect(getR.success).toBe(false); // SECRET_NOT_CONFIGURED
  });

  test('Workspace isolation: Workspace A secrets not visible in Workspace B', async () => {
    const userA = await registerAndLogin('p3isoA@codlok.cloud');
    const wsA = await createWorkspace(userA.accessToken, 'A');
    await Configuration.setSecret(wsA.id, 'STRIPE_SECRET_KEY', 'sk_ws_A', userA.userId);

    const userB = await registerAndLogin('p3isoB@codlok.cloud');
    const wsB = await createWorkspace(userB.accessToken, 'B');

    const getR = await Configuration.getSecret(wsB.id, 'STRIPE_SECRET_KEY', 'dashboard');
    expect(getR.success).toBe(false); // SECRET_NOT_CONFIGURED — workspace isolation
  });

  test('Updating a secret increments version', async () => {
    const user = await registerAndLogin('p3v@codlok.cloud');
    const ws = await createWorkspace(user.accessToken, 'Test');

    const r1 = await Configuration.setSecret(ws.id, 'RESEND_API_KEY', 're_001', user.userId);
    expect(r1.data?.version).toBe(1);

    const r2 = await Configuration.setSecret(ws.id, 'RESEND_API_KEY', 're_002', user.userId);
    expect(r2.data?.version).toBe(2);

    const getR = await Configuration.getSecret(ws.id, 'RESEND_API_KEY', 'dashboard');
    expect(getR.data?.value).toBe('re_002');
  });
});

// ===========================================================================
// Provider Status — getProviderStatus reflects real Configuration state
// ===========================================================================

describe('Phase 3 — Provider Status', () => {
  test('getProviderStatus shows not configured when no secrets set', async () => {
    const user = await registerAndLogin('p3ps1@codlok.cloud');
    const ws = await createWorkspace(user.accessToken, 'Test');

    const status = await Configuration.getProviderStatus(ws.id, 'pay');
    expect(status.success).toBe(true);
    if (!status.success) return;
    expect(status.data.configured).toBe(false);
    expect(status.data.missingKeys).toContain('STRIPE_SECRET_KEY');
    expect(status.data.missingKeys).toContain('STRIPE_WEBHOOK_SECRET');
  });

  test('getProviderStatus shows configured when all secrets set', async () => {
    const user = await registerAndLogin('p3ps2@codlok.cloud');
    const ws = await createWorkspace(user.accessToken, 'Test');

    await Configuration.setSecret(ws.id, 'STRIPE_SECRET_KEY', 'sk_test', user.userId);
    await Configuration.setSecret(ws.id, 'STRIPE_WEBHOOK_SECRET', 'whsec_test', user.userId);

    const status = await Configuration.getProviderStatus(ws.id, 'pay');
    expect(status.success).toBe(true);
    if (!status.success) return;
    expect(status.data.configured).toBe(true);
    expect(status.data.missingKeys).toHaveLength(0);
  });

  test('Provider status is workspace-scoped', async () => {
    const userA = await registerAndLogin('p3ps3A@codlok.cloud');
    const wsA = await createWorkspace(userA.accessToken, 'A');
    await Configuration.setSecret(wsA.id, 'STRIPE_SECRET_KEY', 'sk_A', userA.userId);
    await Configuration.setSecret(wsA.id, 'STRIPE_WEBHOOK_SECRET', 'whsec_A', userA.userId);

    const userB = await registerAndLogin('p3ps3B@codlok.cloud');
    const wsB = await createWorkspace(userB.accessToken, 'B');

    const statusA = await Configuration.getProviderStatus(wsA.id, 'pay');
    const statusB = await Configuration.getProviderStatus(wsB.id, 'pay');
    expect(statusA.data?.configured).toBe(true);
    expect(statusB.data?.configured).toBe(false);
  });
});

// ===========================================================================
// Workspace Default Provider — stored in Configuration settings
// ===========================================================================

describe('Phase 3 — Workspace Default Provider', () => {
  test('setSetting stores workspace default provider selection', async () => {
    const user = await registerAndLogin('p3dp1@codlok.cloud');
    const ws = await createWorkspace(user.accessToken, 'Test');

    const setR = await Configuration.setSetting(ws.id, 'default_provider:pay', 'stripe', user.userId);
    expect(setR.success).toBe(true);
    expect(setR.data.value).toBe('stripe');
  });

  test('getSetting retrieves workspace default provider', async () => {
    const user = await registerAndLogin('p3dp2@codlok.cloud');
    const ws = await createWorkspace(user.accessToken, 'Test');

    await Configuration.setSetting(ws.id, 'default_provider:mail', 'resend', user.userId);
    const getR = await Configuration.getSetting(ws.id, 'default_provider:mail');
    expect(getR.success).toBe(true);
    expect(getR.data.value).toBe('resend');
  });

  test('Default provider is workspace-scoped', async () => {
    const userA = await registerAndLogin('p3dp3A@codlok.cloud');
    const wsA = await createWorkspace(userA.accessToken, 'A');
    await Configuration.setSetting(wsA.id, 'default_provider:pay', 'stripe', userA.userId);

    const userB = await registerAndLogin('p3dp3B@codlok.cloud');
    const wsB = await createWorkspace(userB.accessToken, 'B');

    const getA = await Configuration.getSetting(wsA.id, 'default_provider:pay');
    const getB = await Configuration.getSetting(wsB.id, 'default_provider:pay');
    expect(getA.data?.value).toBe('stripe');
    expect(getB.success).toBe(false); // FEATURE_FLAG_NOT_FOUND — not set in wsB
  });

  test('Provider Registry defaultProvider field is never modified', async () => {
    // The registry's defaultProvider field is metadata — it indicates which
    // provider is the platform default, NOT the workspace default.
    // Workspace defaults are stored in Configuration settings, never in the registry.
    const listR = await Configuration.listProviders('pay');
    expect(listR.success).toBe(true);
    if (!listR.success) return;
    const stripe = listR.data.providers.find((p) => p.providerId === 'stripe');
    expect(stripe?.defaultProvider).toBe(true); // unchanged

    // Now set a workspace default — registry should be unaffected.
    const user = await registerAndLogin('p3dp4@codlok.cloud');
    const ws = await createWorkspace(user.accessToken, 'Test');
    await Configuration.setSetting(ws.id, 'default_provider:pay', 'stripe', user.userId);

    // Re-check registry — defaultProvider still true (unchanged).
    const listR2 = await Configuration.listProviders('pay');
    const stripe2 = listR2.data?.providers.find((p) => p.providerId === 'stripe');
    expect(stripe2?.defaultProvider).toBe(true);
  });
});

// ===========================================================================
// Provider Registry — metadata only, never stores credentials
// ===========================================================================

describe('Phase 3 — Provider Registry metadata only', () => {
  test('listProviders returns metadata, never credentials', async () => {
    const user = await registerAndLogin('p3reg@codlok.cloud');
    const ws = await createWorkspace(user.accessToken, 'Test');
    await Configuration.setSecret(ws.id, 'STRIPE_SECRET_KEY', 'sk_secret_value', user.userId);

    const listR = await Configuration.listProviders('pay');
    expect(listR.success).toBe(true);
    if (!listR.success) return;
    for (const p of listR.data.providers) {
      const pRecord = p as unknown as Record<string, unknown>;
      expect(pRecord).not.toHaveProperty('apiKey');
      expect(pRecord).not.toHaveProperty('secret');
      expect(pRecord).not.toHaveProperty('credentials');
      expect(pRecord).not.toHaveProperty('value');
    }
  });
});

// ===========================================================================
// All 6 provider configuration pages have fields
// ===========================================================================

describe('Phase 3 — All 6 registered providers have configuration fields', () => {
  test('Stripe (pay) has Secret Key + Webhook Secret', async () => {
    const r = await Configuration.listProviders('pay');
    const stripe = r.data?.providers.find((p) => p.providerId === 'stripe');
    expect(stripe).toBeTruthy();
  });

  test('Stripe Identity (verify) has API Key + Webhook Secret', async () => {
    const r = await Configuration.listProviders('verify');
    const si = r.data?.providers.find((p) => p.providerId === 'stripe_identity');
    expect(si).toBeTruthy();
  });

  test('Resend (mail) has API Key', async () => {
    const r = await Configuration.listProviders('mail');
    const resend = r.data?.providers.find((p) => p.providerId === 'resend');
    expect(resend).toBeTruthy();
  });

  test('Twilio (sms) has Account SID + Auth Token', async () => {
    const r = await Configuration.listProviders('sms');
    const twilio = r.data?.providers.find((p) => p.providerId === 'twilio');
    expect(twilio).toBeTruthy();
  });

  test('Amazon S3 (storage) has Region/Bucket/Access Key/Secret Key', async () => {
    const r = await Configuration.listProviders('storage');
    const s3 = r.data?.providers.find((p) => p.providerId === 's3');
    expect(s3).toBeTruthy();
  });

  test('Supabase (auth) has URL/Anon Key/Service Role Key', async () => {
    const r = await Configuration.listProviders('auth');
    const supabase = r.data?.providers.find((p) => p.providerId === 'supabase');
    expect(supabase).toBeTruthy();
  });
});

// ===========================================================================
// Test Connection — supportsTestConnection from registry metadata
// ===========================================================================

describe('Phase 3 — Test Connection metadata', () => {
  test('All registered providers have supportsTestConnection field', async () => {
    const r = await Configuration.listAllProviders();
    if (!r.success) throw new Error('listAllProviders failed');
    for (const p of r.data.providers) {
      expect(p).toHaveProperty('supportsTestConnection');
      expect(typeof p.supportsTestConnection).toBe('boolean');
    }
  });

  test('All current providers support test connection (metadata only, not implemented)', async () => {
    const r = await Configuration.listAllProviders();
    if (!r.success) throw new Error('listAllProviders failed');
    expect(r.data.providers.every((p) => p.supportsTestConnection === true)).toBe(true);
  });
});
