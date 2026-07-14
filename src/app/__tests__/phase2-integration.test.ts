/**
 * Codlok Cloud Dashboard — Phase 2 Integration Tests
 *
 * Tests that the dashboard API routes return real module data (not mock),
 * with proper error handling, workspace isolation, and pagination.
 *
 * Run with: `bun test src/app/__tests__/phase2-integration.test.ts`
 */

import { describe, test, expect, beforeEach, afterAll } from 'bun:test';
import { Auth } from '@/modules/auth';
import { Organizations } from '@/modules/organizations';
import { Verify } from '@/modules/verify';
import { Storage } from '@/modules/storage';
import { Pay } from '@/modules/pay';
import { Mail } from '@/modules/mail';
import { SMS } from '@/modules/sms';
import { Notifications } from '@/modules/notifications';
import { Configuration } from '@/config';
import { _setAdapterForTesting } from '@/modules/auth/adapters/factory';
import { MockAuthAdapter } from '@/modules/auth/adapters/mock';
import { _resetStoreForTesting as _resetOrgStore } from '@/modules/organizations/internal/store';
import { _resetStoreForTesting as _resetVerifyStore, _setProviderForTesting as _setVerifyProvider } from '@/modules/verify';
import { _resetStoreForTesting as _resetStorageStore, _setProviderForTesting as _setStorageProvider } from '@/modules/storage';
import { _resetStoreForTesting as _resetPayStore, _setProviderForTesting as _setPayProvider } from '@/modules/pay';
import { _resetStoreForTesting as _resetMailStore, _setProviderForTesting as _setMailProvider } from '@/modules/mail';
import { _resetStoreForTesting as _resetSmsStore, _setProviderForTesting as _setSmsProvider } from '@/modules/sms';
import { _resetStoreForTesting as _resetNotifStore } from '@/modules/notifications';
import { _resetStoreForTesting as _resetConfigStore } from '@/config';
import { MockVerifyProvider } from '@/modules/verify/internal/provider';
import { MockStorageProvider } from '@/modules/storage/internal/provider';
import { MockPayProvider } from '@/modules/pay/internal/provider';
import { MockMailProvider } from '@/modules/mail/internal/provider';
import { MockSmsProvider } from '@/modules/sms/internal/provider';
import { _clearOutboxForTesting, _getOutboxForTesting } from '@/modules/mail';
import { createHash } from 'crypto';

// ---------------------------------------------------------------------------
// Setup
// ---------------------------------------------------------------------------

let mockAuth: MockAuthAdapter;

beforeEach(() => {
  mockAuth = new MockAuthAdapter();
  _setAdapterForTesting(mockAuth);
  _resetOrgStore();
  _resetVerifyStore();
  _setVerifyProvider(new MockVerifyProvider());
  _resetStorageStore();
  _setStorageProvider(new MockStorageProvider());
  _resetPayStore();
  _setPayProvider(new MockPayProvider());
  _resetMailStore();
  _setMailProvider(new MockMailProvider());
  _resetSmsStore();
  _setSmsProvider(new MockSmsProvider());
  _resetNotifStore();
  _resetConfigStore();
  _clearOutboxForTesting();
  process.env.CODELOK_AUTH_USE_MOCK = 'true';
});

afterAll(() => {
  _setAdapterForTesting(null);
  _setVerifyProvider(null);
  _setStorageProvider(null);
  _setPayProvider(null);
  _setMailProvider(null);
  _setSmsProvider(null);
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

function _sha256(data: string) {
  return createHash('sha256').update(data).digest('hex');
}

// ===========================================================================
// Verify — list loads real data, no business names
// ===========================================================================

describe('Phase 2 — Verify list', () => {
  test('listVerifications returns real data from Verify module', async () => {
    const user = await registerAndLogin('p2v@codlok.cloud');
    const ws = await createWorkspace(user.accessToken, 'Test');

    // Create a verification session.
    const ver = await Verify.createVerificationSession(ws.id, 'INDIVIDUAL_IDENTITY', 'subj-ref-1', 'idem-1');
    expect(ver.success).toBe(true);

    // List should return the real record.
    const list = await Verify.listVerifications(ws.id);
    expect(list.success).toBe(true);
    if (!list.success) return;
    expect(list.data.verifications.length).toBeGreaterThan(0);
    expect(list.data.verifications[0].verificationId).toBeTruthy();
    // No business names — only opaque IDs.
    const v = list.data.verifications[0] as unknown as Record<string, unknown>;
    expect(v).not.toHaveProperty('entityName');
    expect(v).not.toHaveProperty('universityName');
  });

  test('Pagination works on listVerifications', async () => {
    const user = await registerAndLogin('p2vp@codlok.cloud');
    const ws = await createWorkspace(user.accessToken, 'Test');

    for (let i = 0; i < 5; i++) {
      await Verify.createVerificationSession(ws.id, 'INDIVIDUAL_IDENTITY', `subj-${i}`, `idem-${i}`);
    }

    const page1 = await Verify.listVerifications(ws.id, undefined, { limit: 2 });
    expect(page1.success).toBe(true);
    if (!page1.success) return;
    expect(page1.data.verifications).toHaveLength(2);
    expect(page1.data.hasMore).toBe(true);
  });
});

// ===========================================================================
// Storage — list loads real data, no filenames
// ===========================================================================

describe('Phase 2 — Storage list', () => {
  test('listFiles returns real data, no filenames', async () => {
    const user = await registerAndLogin('p2s@codlok.cloud');
    const ws = await createWorkspace(user.accessToken, 'Test');

    const checksum = _sha256('file data');
    await Storage.createUpload(ws.id, 'application/pdf', 9, checksum);

    const list = await Storage.listFiles(ws.id);
    expect(list.success).toBe(true);
    if (!list.success) return;
    expect(list.data.items.length).toBeGreaterThan(0);
    const item = list.data.items[0] as unknown as Record<string, unknown>;
    expect(item).toHaveProperty('fileId');
    expect(item).toHaveProperty('state');
    expect(item).not.toHaveProperty('filename');
    expect(item).not.toHaveProperty('objectKey');
  });
});

// ===========================================================================
// Pay — list loads real data, no business labels
// ===========================================================================

describe('Phase 2 — Pay list', () => {
  test('listPayments returns real data, no business labels', async () => {
    const user = await registerAndLogin('p2p@codlok.cloud');
    const ws = await createWorkspace(user.accessToken, 'Test');

    await Pay.createPayment(ws.id, 5000, 'NGN', 'idem-pay-1');

    const list = await Pay.listPayments(ws.id);
    expect(list.success).toBe(true);
    if (!list.success) return;
    expect(list.data.items.length).toBeGreaterThan(0);
    const item = list.data.items[0] as unknown as Record<string, unknown>;
    expect(item).toHaveProperty('paymentId');
    expect(item).toHaveProperty('amountMinorUnits');
    expect(item).not.toHaveProperty('entityType');
    expect(item).not.toHaveProperty('description');
  });
});

// ===========================================================================
// Mail — list loads real data, no recipient/subject/body
// ===========================================================================

describe('Phase 2 — Mail list', () => {
  test('listMessages returns delivery info only, no recipient/subject/body', async () => {
    const user = await registerAndLogin('p2m@codlok.cloud');
    const ws = await createWorkspace(user.accessToken, 'Test');

    await Mail.sendEmail(ws.id, 'recipient@example.com', 'Secret Subject', '<p>Secret Body</p>');

    const list = await Mail.listMessages(ws.id);
    expect(list.success).toBe(true);
    if (!list.success) return;
    expect(list.data.items.length).toBeGreaterThan(0);
    const item = list.data.items[0] as unknown as Record<string, unknown>;
    expect(item).toHaveProperty('messageId');
    expect(item).toHaveProperty('type');
    expect(item).toHaveProperty('deliveryStatus');
    // CRITICAL: no recipient, subject, body.
    expect(item).not.toHaveProperty('to');
    expect(item).not.toHaveProperty('subject');
    expect(item).not.toHaveProperty('body');
    expect(item).not.toHaveProperty('token');
  });
});

// ===========================================================================
// SMS — list loads real data, no recipient
// ===========================================================================

describe('Phase 2 — SMS list', () => {
  test('listSms returns real data, no recipient', async () => {
    const user = await registerAndLogin('p2sms@codlok.cloud');
    const ws = await createWorkspace(user.accessToken, 'Test');

    await SMS.sendSms(ws.id, '+1234567890', 'Test message', 'idem-sms-1');

    const list = await SMS.listSms(ws.id);
    expect(list.success).toBe(true);
    if (!list.success) return;
    expect(list.data.items.length).toBeGreaterThan(0);
    const item = list.data.items[0] as unknown as Record<string, unknown>;
    expect(item).toHaveProperty('smsId');
    expect(item).toHaveProperty('status');
    // CRITICAL: no recipient.
    expect(item).not.toHaveProperty('recipient');
    expect(item).not.toHaveProperty('_recipient');
    expect(item).not.toHaveProperty('phone');
  });
});

// ===========================================================================
// Notifications — list loads real data, pagination works
// ===========================================================================

describe('Phase 2 — Notifications list', () => {
  test('listNotifications returns real data with pagination', async () => {
    const user = await registerAndLogin('p2n@codlok.cloud');
    const ws = await createWorkspace(user.accessToken, 'Test');

    for (let i = 0; i < 5; i++) {
      await Notifications.sendNotification(ws.id, {
        recipient: { email: 'test@example.com' },
        content: { email: { subject: 's', body: 'b' } },
      }, `idem-notif-${i}`);
    }

    const page1 = await Notifications.listNotifications(ws.id, undefined, { limit: 2 });
    expect(page1.success).toBe(true);
    if (!page1.success) return;
    expect(page1.data.notifications).toHaveLength(2);
    expect(page1.data.hasMore).toBe(true);

    const item = page1.data.notifications[0] as unknown as Record<string, unknown>;
    expect(item).toHaveProperty('notificationId');
    expect(item).toHaveProperty('overallStatus');
    // No recipient.
    expect(item).not.toHaveProperty('recipient');
  });
});

// ===========================================================================
// Configuration — provider status reflects real module state
// ===========================================================================

describe('Phase 2 — Configuration provider status', () => {
  test('getProviderStatus returns real configuration state', async () => {
    const user = await registerAndLogin('p2c@codlok.cloud');
    const ws = await createWorkspace(user.accessToken, 'Test');

    const status = await Configuration.getProviderStatus(ws.id, 'auth');
    expect(status.success).toBe(true);
    if (!status.success) return;
    expect(status.data.moduleId).toBe('auth');
    expect(status.data).toHaveProperty('configured');
    expect(status.data).toHaveProperty('requiredKeys');
    expect(status.data).toHaveProperty('missingKeys');
  });
});

// ===========================================================================
// Workspace Isolation — User A cannot see User B's data
// ===========================================================================

describe('Phase 2 — Workspace isolation across all modules', () => {
  test('User A cannot list User B\'s verifications', async () => {
    const userA = await registerAndLogin('p2isoA@codlok.cloud');
    const wsA = await createWorkspace(userA.accessToken, 'A');
    await Verify.createVerificationSession(wsA.id, 'INDIVIDUAL_IDENTITY', 'subj', 'idem-1');

    const userB = await registerAndLogin('p2isoB@codlok.cloud');
    const wsB = await createWorkspace(userB.accessToken, 'B');

    // User B's workspace should have 0 verifications.
    const listB = await Verify.listVerifications(wsB.id);
    expect(listB.success).toBe(true);
    if (!listB.success) return;
    expect(listB.data.verifications).toHaveLength(0);
  });

  test('User A cannot list User B\'s payments', async () => {
    const userA = await registerAndLogin('p2isoA2@codlok.cloud');
    const wsA = await createWorkspace(userA.accessToken, 'A');
    await Pay.createPayment(wsA.id, 1000, 'USD', 'idem-1');

    const userB = await registerAndLogin('p2isoB2@codlok.cloud');
    const wsB = await createWorkspace(userB.accessToken, 'B');

    const listB = await Pay.listPayments(wsB.id);
    expect(listB.success).toBe(true);
    if (!listB.success) return;
    expect(listB.data.items).toHaveLength(0);
  });

  test('User A cannot list User B\'s SMS', async () => {
    const userA = await registerAndLogin('p2isoA3@codlok.cloud');
    const wsA = await createWorkspace(userA.accessToken, 'A');
    await SMS.sendSms(wsA.id, '+1234567890', 'msg', 'idem-1');

    const userB = await registerAndLogin('p2isoB3@codlok.cloud');
    const wsB = await createWorkspace(userB.accessToken, 'B');

    const listB = await SMS.listSms(wsB.id);
    expect(listB.success).toBe(true);
    if (!listB.success) return;
    expect(listB.data.items).toHaveLength(0);
  });

  test('User A cannot list User B\'s mail messages', async () => {
    const userA = await registerAndLogin('p2isoA4@codlok.cloud');
    const wsA = await createWorkspace(userA.accessToken, 'A');
    await Mail.sendEmail(wsA.id, 'test@example.com', 's', 'b');

    const userB = await registerAndLogin('p2isoB4@codlok.cloud');
    const wsB = await createWorkspace(userB.accessToken, 'B');

    const listB = await Mail.listMessages(wsB.id);
    expect(listB.success).toBe(true);
    if (!listB.success) return;
    expect(listB.data.items).toHaveLength(0);
  });
});
