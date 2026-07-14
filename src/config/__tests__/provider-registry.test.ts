/**
 * Codlok Cloud — Provider Registry Tests (Phase 2.5)
 *
 * Tests for Configuration.listProviders() and Configuration.listAllProviders().
 *
 * Run with: `bun test src/config/__tests__/provider-registry.test.ts`
 */

import { describe, test, expect, beforeEach } from 'bun:test';
import { Configuration, _resetStoreForTesting } from '@/config';
import type { ProviderMetadata } from '@/config';

// ---------------------------------------------------------------------------
// Setup
// ---------------------------------------------------------------------------

beforeEach(() => {
  _resetStoreForTesting();
});

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function assertProviderMetadata(p: ProviderMetadata) {
  expect(p).toHaveProperty('providerId');
  expect(p).toHaveProperty('moduleId');
  expect(p).toHaveProperty('displayName');
  expect(p).toHaveProperty('category');
  expect(p).toHaveProperty('defaultProvider');
  expect(p).toHaveProperty('supportsTestConnection');
  expect(p).toHaveProperty('supportsRotation');
  expect(p).toHaveProperty('supportsDisconnect');
  expect(p).toHaveProperty('routing');
  // No credentials.
  expect(p).not.toHaveProperty('apiKey');
  expect(p).not.toHaveProperty('secret');
  expect(p).not.toHaveProperty('credentials');
}

// ===========================================================================
// Provider Registration
// ===========================================================================

describe('Provider Registry — Registration', () => {
  test('listAllProviders returns all registered providers', async () => {
    const r = await Configuration.listAllProviders();
    expect(r.success).toBe(true);
    if (!r.success) return;
    expect(r.data.providers.length).toBeGreaterThan(0);
    // At least 6 providers registered (one per module).
    expect(r.data.providers.length).toBeGreaterThanOrEqual(6);
  });

  test('Each provider has metadata only — no credentials', async () => {
    const r = await Configuration.listAllProviders();
    if (!r.success) throw new Error('listAllProviders failed');
    for (const p of r.data.providers) {
      assertProviderMetadata(p);
    }
  });

  test('Stripe is registered for pay module', async () => {
    const r = await Configuration.listProviders('pay');
    expect(r.success).toBe(true);
    if (!r.success) return;
    const stripe = r.data.providers.find((p) => p.providerId === 'stripe');
    expect(stripe).toBeTruthy();
    expect(stripe!.moduleId).toBe('pay');
    expect(stripe!.displayName).toBe('Stripe');
    expect(stripe!.category).toBe('payments');
    expect(stripe!.defaultProvider).toBe(true);
  });

  test('Resend is registered for mail module', async () => {
    const r = await Configuration.listProviders('mail');
    if (!r.success) throw new Error('listProviders failed');
    const resend = r.data.providers.find((p) => p.providerId === 'resend');
    expect(resend).toBeTruthy();
    expect(resend!.displayName).toBe('Resend');
    expect(resend!.category).toBe('email');
  });

  test('Twilio is registered for sms module', async () => {
    const r = await Configuration.listProviders('sms');
    if (!r.success) throw new Error('listProviders failed');
    const twilio = r.data.providers.find((p) => p.providerId === 'twilio');
    expect(twilio).toBeTruthy();
    expect(twilio!.displayName).toBe('Twilio');
    expect(twilio!.category).toBe('sms');
  });

  test('Amazon S3 is registered for storage module', async () => {
    const r = await Configuration.listProviders('storage');
    if (!r.success) throw new Error('listProviders failed');
    const s3 = r.data.providers.find((p) => p.providerId === 's3');
    expect(s3).toBeTruthy();
    expect(s3!.displayName).toBe('Amazon S3');
    expect(s3!.category).toBe('storage');
  });

  test('Supabase is registered for auth module', async () => {
    const r = await Configuration.listProviders('auth');
    if (!r.success) throw new Error('listProviders failed');
    const supabase = r.data.providers.find((p) => p.providerId === 'supabase');
    expect(supabase).toBeTruthy();
    expect(supabase!.displayName).toBe('Supabase');
    expect(supabase!.category).toBe('auth');
  });

  test('Stripe Identity is registered for verify module', async () => {
    const r = await Configuration.listProviders('verify');
    if (!r.success) throw new Error('listProviders failed');
    const si = r.data.providers.find((p) => p.providerId === 'stripe_identity');
    expect(si).toBeTruthy();
    expect(si!.displayName).toBe('Stripe Identity');
    expect(si!.category).toBe('identity');
  });
});

// ===========================================================================
// Provider Lookup by Module
// ===========================================================================

describe('Provider Registry — Lookup by Module', () => {
  test('listProviders returns only providers for the specified module', async () => {
    const r = await Configuration.listProviders('pay');
    expect(r.success).toBe(true);
    if (!r.success) return;
    expect(r.data.providers.length).toBeGreaterThan(0);
    // All returned providers should be for 'pay' module.
    expect(r.data.providers.every((p) => p.moduleId === 'pay')).toBe(true);
  });

  test('listProviders does not return providers from other modules', async () => {
    const r = await Configuration.listProviders('pay');
    if (!r.success) throw new Error('listProviders failed');
    const hasNonPay = r.data.providers.some((p) => p.moduleId !== 'pay');
    expect(hasNonPay).toBe(false);
  });
});

// ===========================================================================
// Unknown Module Returns Empty List
// ===========================================================================

describe('Provider Registry — Unknown Module', () => {
  test('Unknown module returns empty list (not an error)', async () => {
    const r = await Configuration.listProviders('nonexistent_module');
    expect(r.success).toBe(true);
    if (!r.success) return;
    expect(r.data.providers).toHaveLength(0);
  });

  test('Empty moduleId returns empty list', async () => {
    const r = await Configuration.listProviders('');
    expect(r.success).toBe(true);
    if (!r.success) return;
    expect(r.data.providers).toHaveLength(0);
  });
});

// ===========================================================================
// Registry Metadata is Immutable at Runtime
// ===========================================================================

describe('Provider Registry — Immutability', () => {
  test('Registry cannot be modified at runtime (Object.freeze)', async () => {
    // The PROVIDER_REGISTRY entries are individually Object.frozen.
    // listProviders returns references to these frozen objects.
    // Attempting to mutate a property should throw TypeError.
    const r1 = await Configuration.listProviders('pay');
    if (!r1.success) throw new Error('listProviders failed');
    const originalName = r1.data.providers[0].displayName;

    // Attempt to mutate — should throw because the object is frozen.
    expect(() => {
      r1.data.providers[0].displayName = 'Hacked';
    }).toThrow();

    // Re-fetch — the registry should still return the original value.
    const r2 = await Configuration.listProviders('pay');
    if (!r2.success) throw new Error('listProviders failed');
    const provider2 = r2.data.providers.find((p) => p.providerId === r1.data.providers[0].providerId);
    expect(provider2!.displayName).toBe(originalName);
  });

  test('Registry array cannot be modified (frozen)', async () => {
    const r1 = await Configuration.listAllProviders();
    if (!r1.success) throw new Error('listAllProviders failed');
    const originalCount = r1.data.providers.length;

    // Attempt to push — should fail silently or throw.
    try {
      (r1.data.providers as unknown[]).push({} as never);
    } catch {
      // strict mode throws — fine.
    }

    // Re-fetch — count should be unchanged.
    const r2 = await Configuration.listAllProviders();
    if (!r2.success) throw new Error('listAllProviders failed');
    expect(r2.data.providers.length).toBe(originalCount);
  });
});

// ===========================================================================
// StandardResponse Compliance
// ===========================================================================

describe('Provider Registry — StandardResponse Compliance', () => {
  test('listProviders returns StandardResponse shape', async () => {
    const r = await Configuration.listProviders('pay');
    expect(r).toHaveProperty('success');
    expect(r).toHaveProperty('data');
  });

  test('listAllProviders returns StandardResponse shape', async () => {
    const r = await Configuration.listAllProviders();
    expect(r).toHaveProperty('success');
    expect(r).toHaveProperty('data');
  });
});

// ===========================================================================
// Routing Reservation
// ===========================================================================

describe('Provider Registry — Routing Reservation', () => {
  test('All providers have routing field set to DIRECT', async () => {
    const r = await Configuration.listAllProviders();
    if (!r.success) throw new Error('listAllProviders failed');
    expect(r.data.providers.every((p) => p.routing === 'DIRECT')).toBe(true);
  });

  test('Routing field is not exposed in dashboard-visible data beyond metadata', async () => {
    const r = await Configuration.listProviders('pay');
    if (!r.success) throw new Error('listProviders failed');
    // routing exists in metadata but should not be a separate dashboard concern.
    expect(r.data.providers[0]).toHaveProperty('routing');
  });
});
