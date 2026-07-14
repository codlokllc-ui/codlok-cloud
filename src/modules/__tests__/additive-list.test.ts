/**
 * Codlok Cloud — Additive List Function Tests
 *
 * Tests for the 3 new list functions (Storage.listFiles, Pay.listPayments,
 * Mail.listMessages) and §3.13 Pagination Standard across all list functions.
 *
 * Run with: `bun test src/modules/__tests__/additive-list.test.ts`
 */

import { describe, test, expect, beforeEach, afterAll } from 'bun:test';
import { Storage, _resetStoreForTesting as _resetStorageStore, _setProviderForTesting as _setStorageProvider } from '@/modules/storage';
import { Pay, _resetStoreForTesting as _resetPayStore, _setProviderForTesting as _setPayProvider } from '@/modules/pay';
import { Mail, _resetStoreForTesting as _resetMailStore, _setProviderForTesting as _setMailProvider, _clearOutboxForTesting } from '@/modules/mail';
import { Verify, _resetStoreForTesting as _resetVerifyStore, _setProviderForTesting as _setVerifyProvider } from '@/modules/verify';
import { SMS, _resetStoreForTesting as _resetSmsStore, _setProviderForTesting as _setSmsProvider } from '@/modules/sms';
import { Notifications, _resetStoreForTesting as _resetNotifStore } from '@/modules/notifications';
import { MockStorageProvider } from '@/modules/storage/internal/provider';
import { MockPayProvider } from '@/modules/pay/internal/provider';
import { MockMailProvider } from '@/modules/mail/internal/provider';
import { MockVerifyProvider } from '@/modules/verify/internal/provider';
import { MockSmsProvider } from '@/modules/sms/internal/provider';
import { createHash } from 'crypto';

// ---------------------------------------------------------------------------
// Setup
// ---------------------------------------------------------------------------

const WS_1 = 'ws_list_1';
const WS_2 = 'ws_list_2';

beforeEach(() => {
  _resetStorageStore();
  _resetPayStore();
  _resetMailStore();
  _resetVerifyStore();
  _resetSmsStore();
  _resetNotifStore();
  _clearOutboxForTesting();
  _setStorageProvider(new MockStorageProvider());
  _setPayProvider(new MockPayProvider());
  _setMailProvider(new MockMailProvider());
  _setVerifyProvider(new MockVerifyProvider());
  _setSmsProvider(new MockSmsProvider());
  process.env.CODELOK_AUTH_USE_MOCK = 'true';
});

afterAll(() => {
  _setStorageProvider(null);
  _setPayProvider(null);
  _setMailProvider(null);
  _setVerifyProvider(null);
  _setSmsProvider(null);
});

function _sha256(data: string) {
  return createHash('sha256').update(data).digest('hex');
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

async function createStorageFile(wsId: string) {
  const checksum = _sha256('file contents');
  const createR = await Storage.createUpload(wsId, 'application/pdf', 13, checksum);
  if (!createR.success) throw new Error('createUpload failed');
  return createR.data.fileId;
}

async function createPayment(wsId: string, amount = 1999) {
  const r = await Pay.createPayment(wsId, amount, 'USD', `idem-pay-${Date.now()}-${Math.random()}`);
  if (!r.success) throw new Error('createPayment failed');
  return r.data.paymentId;
}

async function sendMailMessage(wsId: string) {
  const r = await Mail.sendEmail(wsId, 'test@example.com', 'Subject', '<p>Body</p>');
  if (!r.success) throw new Error('sendEmail failed');
  return r.data.messageId;
}

async function createVerification(wsId: string) {
  const r = await Verify.createVerificationSession(wsId, 'INDIVIDUAL_IDENTITY', 'subj-ref', `idem-ver-${Date.now()}-${Math.random()}`);
  if (!r.success) throw new Error('createVerificationSession failed');
  return r.data.verificationId;
}

async function sendSmsMessage(wsId: string) {
  const r = await SMS.sendSms(wsId, '+1234567890', 'Test message', `idem-sms-${Date.now()}-${Math.random()}`);
  if (!r.success) throw new Error('sendSms failed');
  return r.data.smsId;
}

async function sendNotification(wsId: string) {
  const r = await Notifications.sendNotification(wsId, {
    recipient: { email: 'test@example.com' },
    content: { email: { subject: 's', body: 'b' } },
  }, `idem-notif-${Date.now()}-${Math.random()}`);
  if (!r.success) throw new Error('sendNotification failed');
  return r.data.notificationId;
}

// ===========================================================================
// Storage.listFiles() — v1.1
// ===========================================================================

describe('Storage.listFiles() — v1.1', () => {
  test('SUCCESS: returns infrastructure metadata only', async () => {
    await createStorageFile(WS_1);
    const r = await Storage.listFiles(WS_1);
    expect(r.success).toBe(true);
    if (!r.success) return;
    expect(r.data.items.length).toBeGreaterThan(0);
    const item = r.data.items[0];
    expect(item).toHaveProperty('fileId');
    expect(item).toHaveProperty('state');
    expect(item).toHaveProperty('mimeType');
    expect(item).toHaveProperty('sizeBytes');
    expect(item).toHaveProperty('createdAt');
    expect(item).toHaveProperty('updatedAt');
  });

  test('No filenames or business metadata exposed', async () => {
    await createStorageFile(WS_1);
    const r = await Storage.listFiles(WS_1);
    if (!r.success) throw new Error('listFiles failed');
    const item = r.data.items[0] as unknown as Record<string, unknown>;
    expect(item).not.toHaveProperty('objectKey');
    expect(item).not.toHaveProperty('bucket');
    expect(item).not.toHaveProperty('checksum');
    expect(item).not.toHaveProperty('filename');
  });

  test('Workspace isolation: WS_2 cannot see WS_1 files', async () => {
    await createStorageFile(WS_1);
    const r = await Storage.listFiles(WS_2);
    expect(r.success).toBe(true);
    if (!r.success) return;
    expect(r.data.items).toHaveLength(0);
  });

  test('Filter by state', async () => {
    await createStorageFile(WS_1);
    const r = await Storage.listFiles(WS_1, { state: 'PENDING' });
    expect(r.success).toBe(true);
    if (!r.success) return;
    expect(r.data.items.every((i) => i.state === 'PENDING')).toBe(true);
  });

  test('Pagination: limit + nextCursor + hasMore', async () => {
    for (let i = 0; i < 5; i++) await createStorageFile(WS_1);
    const r1 = await Storage.listFiles(WS_1, undefined, { limit: 2 });
    expect(r1.success).toBe(true);
    if (!r1.success) return;
    expect(r1.data.items).toHaveLength(2);
    expect(r1.data.hasMore).toBe(true);
    expect(r1.data.nextCursor).not.toBeNull();

    const r2 = await Storage.listFiles(WS_1, undefined, { limit: 2, cursor: r1.data.nextCursor! });
    expect(r2.success).toBe(true);
    if (!r2.success) return;
    expect(r2.data.items).toHaveLength(2);
  });

  test('StandardResponse compliance', async () => {
    const r = await Storage.listFiles(WS_1);
    expect(r).toHaveProperty('success');
    expect(r).toHaveProperty('data');
  });
});

// ===========================================================================
// Pay.listPayments() — v1.1
// ===========================================================================

describe('Pay.listPayments() — v1.1', () => {
  test('SUCCESS: returns financial metadata only', async () => {
    await createPayment(WS_1);
    const r = await Pay.listPayments(WS_1);
    expect(r.success).toBe(true);
    if (!r.success) return;
    expect(r.data.items.length).toBeGreaterThan(0);
    const item = r.data.items[0];
    expect(item).toHaveProperty('paymentId');
    expect(item).toHaveProperty('amountMinorUnits');
    expect(item).toHaveProperty('currency');
    expect(item).toHaveProperty('provider');
    expect(item).toHaveProperty('status');
    expect(item).toHaveProperty('createdAt');
    expect(item).toHaveProperty('updatedAt');
  });

  test('No business labels exposed', async () => {
    await createPayment(WS_1);
    const r = await Pay.listPayments(WS_1);
    if (!r.success) throw new Error('listPayments failed');
    const item = r.data.items[0] as unknown as Record<string, unknown>;
    expect(item).not.toHaveProperty('entityType');
    expect(item).not.toHaveProperty('entityId');
    expect(item).not.toHaveProperty('description');
  });

  test('Workspace isolation', async () => {
    await createPayment(WS_1);
    const r = await Pay.listPayments(WS_2);
    expect(r.success).toBe(true);
    if (!r.success) return;
    expect(r.data.items).toHaveLength(0);
  });

  test('Filter by status', async () => {
    await createPayment(WS_1);
    const r = await Pay.listPayments(WS_1, { status: 'pending' });
    expect(r.success).toBe(true);
    if (!r.success) return;
    expect(r.data.items.every((i) => i.status === 'pending')).toBe(true);
  });

  test('Pagination', async () => {
    for (let i = 0; i < 5; i++) await createPayment(WS_1, 1000 + i);
    const r1 = await Pay.listPayments(WS_1, undefined, { limit: 2 });
    expect(r1.success).toBe(true);
    if (!r1.success) return;
    expect(r1.data.items).toHaveLength(2);
    expect(r1.data.hasMore).toBe(true);
  });
});

// ===========================================================================
// Mail.listMessages() — v1.3
// ===========================================================================

describe('Mail.listMessages() — v1.3', () => {
  test('SUCCESS: returns delivery info only', async () => {
    await sendMailMessage(WS_1);
    const r = await Mail.listMessages(WS_1);
    expect(r.success).toBe(true);
    if (!r.success) return;
    expect(r.data.items.length).toBeGreaterThan(0);
    const item = r.data.items[0] as unknown as Record<string, unknown>;
    expect(item).toHaveProperty('messageId');
    expect(item).toHaveProperty('type');
    expect(item).toHaveProperty('deliveryStatus');
    expect(item).toHaveProperty('createdAt');
    expect(item).toHaveProperty('updatedAt');
  });

  test('CRITICAL: no recipient, subject, body exposed', async () => {
    await sendMailMessage(WS_1);
    const r = await Mail.listMessages(WS_1);
    if (!r.success) throw new Error('listMessages failed');
    const item = r.data.items[0] as unknown as Record<string, unknown>;
    expect(item).not.toHaveProperty('to');
    expect(item).not.toHaveProperty('subject');
    expect(item).not.toHaveProperty('body');
    expect(item).not.toHaveProperty('token');
  });

  test('Workspace isolation', async () => {
    await sendMailMessage(WS_1);
    const r = await Mail.listMessages(WS_2);
    expect(r.success).toBe(true);
    if (!r.success) return;
    expect(r.data.items).toHaveLength(0);
  });

  test('Pagination', async () => {
    for (let i = 0; i < 5; i++) await sendMailMessage(WS_1);
    const r1 = await Mail.listMessages(WS_1, undefined, { limit: 2 });
    expect(r1.success).toBe(true);
    if (!r1.success) return;
    expect(r1.data.items).toHaveLength(2);
    expect(r1.data.hasMore).toBe(true);
  });
});

// ===========================================================================
// §3.13 Pagination Standard — existing list functions
// ===========================================================================

describe('§3.13 Pagination — existing list functions', () => {
  test('Verify.listVerifications supports pagination', async () => {
    for (let i = 0; i < 5; i++) await createVerification(WS_1);
    const r = await Verify.listVerifications(WS_1, undefined, { limit: 2 });
    expect(r.success).toBe(true);
    if (!r.success) return;
    expect(r.data.verifications).toHaveLength(2);
    expect(r.data.hasMore).toBe(true);
    expect(r.data.nextCursor).not.toBeNull();
  });

  test('SMS.listSms supports pagination', async () => {
    for (let i = 0; i < 5; i++) await sendSmsMessage(WS_1);
    const r = await SMS.listSms(WS_1, undefined, { limit: 2 });
    expect(r.success).toBe(true);
    if (!r.success) return;
    expect(r.data.items).toHaveLength(2);
    expect(r.data.hasMore).toBe(true);
  });

  test('Notifications.listNotifications supports pagination', async () => {
    for (let i = 0; i < 5; i++) await sendNotification(WS_1);
    const r = await Notifications.listNotifications(WS_1, undefined, { limit: 2 });
    expect(r.success).toBe(true);
    if (!r.success) return;
    expect(r.data.notifications).toHaveLength(2);
    expect(r.data.hasMore).toBe(true);
  });

  test('Backward compatibility: no pagination → full list + hasMore=false', async () => {
    await createVerification(WS_1);
    const r = await Verify.listVerifications(WS_1);
    expect(r.success).toBe(true);
    if (!r.success) return;
    expect(r.data.verifications.length).toBeGreaterThan(0);
    expect(r.data.hasMore).toBe(false);
    expect(r.data.nextCursor).toBeNull();
  });
});
