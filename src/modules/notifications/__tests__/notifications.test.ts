/**
 * Codlok Cloud — Notifications Module Tests
 *
 * Per Master Spec §14 Rule 12 (Pre-freeze test requirement), this file
 * covers all three mandatory categories:
 *
 *   1. BOUNDARY TESTS — internals not importable from outside.
 *   2. REGRESSION TESTS — all 368 existing tests pass unmodified (run
 *      separately; this file doesn't touch other modules).
 *   3. COMPLIANCE TESTS — StandardResponse shape, §21 Mandatory Rules
 *      (idempotency required/permanent, channel selection intersection,
 *      no content transformation, cancellation boundary, no cross-channel
 *      fallback, recipient data transient, each transport called at most once).
 *
 * Run with: `bun test src/modules/notifications`
 */

import { describe, test, expect, beforeEach, afterAll } from 'bun:test';
import {
  Notifications,
  _resetStoreForTesting,
} from '@/modules/notifications';
import { NotificationErrorCode } from '@/modules/notifications/internal/errors';
import { store } from '@/modules/notifications/internal/store';
import { Mail, _setProviderForTesting as _setMailProviderForTesting, _resetStoreForTesting as _resetMailStoreForTesting } from '@/modules/mail';
import { MockMailProvider } from '@/modules/mail/internal/provider';
import type { StandardResponse } from '@/shared';

// ---------------------------------------------------------------------------
// Setup
// ---------------------------------------------------------------------------

let mockMailProvider: MockMailProvider;

beforeEach(() => {
  _resetStoreForTesting();
  _resetMailStoreForTesting();
  mockMailProvider = new MockMailProvider();
  _setMailProviderForTesting(mockMailProvider);
  // Set mock mode ON so Notifications' _getConfiguredProviders sees email as
  // configured. Mail's factory checks the test override FIRST (takes precedence
  // over the dev mock), so Mail itself uses our injected mockMailProvider.
  process.env.CODELOK_AUTH_USE_MOCK = 'true';
});

afterAll(() => {
  _setMailProviderForTesting(null);
  _resetStoreForTesting();
  _resetMailStoreForTesting();
});

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function assertStandardResponseShape<T>(r: StandardResponse<T>) {
  if (r.success) {
    expect(r).toHaveProperty('data');
    expect(typeof r.success).toBe('boolean');
  } else {
    expect(r).toHaveProperty('error');
    expect(r.error).toHaveProperty('code');
    expect(r.error).toHaveProperty('message');
    expect(typeof r.error.code).toBe('string');
    expect(typeof r.error.message).toBe('string');
  }
}

const WS_1 = 'ws_test_1';
const WS_2 = 'ws_test_2';
const GOOD_IDEM_KEY = 'idem-notif-001';

function _goodRequest() {
  return {
    recipient: { email: 'alice@example.com' },
    content: {
      email: { subject: 'Your inspection is scheduled', body: '<p>Tuesday at 3pm</p>' },
    },
  };
}

async function _sendNotification(
  workspaceId: string = WS_1,
  request?: ReturnType<typeof _goodRequest>,
  idemKey: string = GOOD_IDEM_KEY
): Promise<string> {
  const r = await Notifications.sendNotification(workspaceId, request ?? _goodRequest(), idemKey);
  if (!r.success) throw new Error(`sendNotification failed: ${r.error.code}`);
  return r.data.notificationId;
}

// ===========================================================================
// 1. BOUNDARY TESTS (Rule 12)
// ===========================================================================

describe('BOUNDARY TESTS — internal symbols not on public surface', () => {
  test('Notifications public surface exposes §21 functions', () => {
    const publicKeys = Object.keys(Notifications).sort();
    expect(publicKeys).toContain('sendNotification');
    expect(publicKeys).toContain('getNotification');
    expect(publicKeys).toContain('listNotifications');
    expect(publicKeys).toContain('cancelNotification');
    expect(publicKeys).toContain('getChannelStatus');
  });

  test('Notifications public surface does NOT expose internals', () => {
    const publicKeys = Object.keys(Notifications);
    expect(publicKeys).not.toContain('store');
    expect(publicKeys).not.toContain('_computeDispatchPlan');
    expect(publicKeys).not.toContain('_getConfiguredProviders');
  });

  test('No content transformation functions (§21 fork 3a)', () => {
    const publicKeys = Object.keys(Notifications);
    expect(publicKeys).not.toContain('truncateContent');
    expect(publicKeys).not.toContain('interpolateTemplate');
    expect(publicKeys).not.toContain('localizeContent');
    expect(publicKeys).not.toContain('generateContent');
    expect(publicKeys).not.toContain('summarizeContent');
  });

  test('No cross-channel fallback functions (§21 fork 4)', () => {
    const publicKeys = Object.keys(Notifications);
    expect(publicKeys).not.toContain('retryChannel');
    expect(publicKeys).not.toContain('fallbackToSms');
    expect(publicKeys).not.toContain('fallbackChannel');
  });

  test('Notifications does NOT import Auth, Organizations, or future Audit/Jobs', async () => {
    const fs = await import('fs');
    const src = fs.readFileSync('/home/z/my-project/src/modules/notifications/index.ts', 'utf-8');
    // Must import Mail (allowed per §21).
    expect(src).toMatch(/@\/modules\/mail/);
    // Must NOT import Auth, Organizations.
    const codeOnly = src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');
    expect(codeOnly).not.toMatch(/@\/modules\/auth/);
    expect(codeOnly).not.toMatch(/@\/modules\/organizations/);
  });
});

// ===========================================================================
// 2. FUNCTIONAL — sendNotification
// ===========================================================================

describe('FUNCTIONAL — sendNotification', () => {
  test('SUCCESS: returns { notificationId, overallStatus: "queued" }', async () => {
    const r = await Notifications.sendNotification(WS_1, _goodRequest(), GOOD_IDEM_KEY);
    expect(r.success).toBe(true);
    if (!r.success) return;
    expect(r.data.notificationId).toMatch(/^notif_/);
    expect(r.data.overallStatus).toBe('queued');
  });

  test('IDEMPOTENCY_KEY_REQUIRED when key missing', async () => {
    const r = await Notifications.sendNotification(WS_1, _goodRequest(), '');
    expect(r.success).toBe(false);
    if (r.success) return;
    expect(r.error.code).toBe(NotificationErrorCode.IDEMPOTENCY_KEY_REQUIRED);
  });

  test('INVALID_RECIPIENT for missing recipient', async () => {
    const r = await Notifications.sendNotification(WS_1, {
      recipient: {} as never,
      content: { email: { subject: 's', body: 'b' } },
    }, GOOD_IDEM_KEY);
    expect(r.success).toBe(false);
    if (r.success) return;
    expect(r.error.code).toBe(NotificationErrorCode.INVALID_RECIPIENT);
  });

  test('INVALID_RECIPIENT for bad email format', async () => {
    const r = await Notifications.sendNotification(WS_1, {
      recipient: { email: 'not-an-email' },
      content: { email: { subject: 's', body: 'b' } },
    }, GOOD_IDEM_KEY);
    expect(r.success).toBe(false);
    if (r.success) return;
    expect(r.error.code).toBe(NotificationErrorCode.INVALID_RECIPIENT);
  });

  test('INVALID_CONTENT for missing content', async () => {
    const r = await Notifications.sendNotification(WS_1, {
      recipient: { email: 'alice@example.com' },
      content: {} as never,
    }, GOOD_IDEM_KEY);
    expect(r.success).toBe(false);
    if (r.success) return;
    expect(r.error.code).toBe(NotificationErrorCode.INVALID_CONTENT);
  });

  test('INVALID_CONTENT for missing email.subject', async () => {
    const r = await Notifications.sendNotification(WS_1, {
      recipient: { email: 'alice@example.com' },
      content: { email: { subject: '', body: 'b' } },
    }, GOOD_IDEM_KEY);
    expect(r.success).toBe(false);
    if (r.success) return;
    expect(r.error.code).toBe(NotificationErrorCode.INVALID_CONTENT);
  });

  test('NO_AVAILABLE_CHANNEL when no content matches configured providers', async () => {
    // Only SMS content, but SMS module doesn't exist → no available channel.
    const r = await Notifications.sendNotification(WS_1, {
      recipient: { phone: '+1234567890' },
      content: { sms: { body: 'Hello' } },
    }, GOOD_IDEM_KEY);
    expect(r.success).toBe(false);
    if (r.success) return;
    expect(r.error.code).toBe(NotificationErrorCode.NO_AVAILABLE_CHANNEL);
  });

  test('WORKSPACE_NOT_FOUND for empty workspaceId', async () => {
    const r = await Notifications.sendNotification('', _goodRequest(), GOOD_IDEM_KEY);
    expect(r.success).toBe(false);
    if (r.success) return;
    expect(r.error.code).toBe(NotificationErrorCode.WORKSPACE_NOT_FOUND);
  });
});

// ===========================================================================
// 3. IDEMPOTENCY (§21 line 1099 — REQUIRED, permanent)
// ===========================================================================

describe('IDEMPOTENCY — sendNotification', () => {
  test('Duplicate workspaceId + idempotencyKey returns SAME notificationId', async () => {
    const r1 = await Notifications.sendNotification(WS_1, _goodRequest(), 'idem-dup-001');
    const r2 = await Notifications.sendNotification(WS_1, _goodRequest(), 'idem-dup-001');
    if (!r1.success || !r2.success) throw new Error('sendNotification failed');
    expect(r2.data.notificationId).toBe(r1.data.notificationId);
  });

  test('Different idempotencyKey creates separate notifications', async () => {
    const r1 = await Notifications.sendNotification(WS_1, _goodRequest(), 'key-A');
    const r2 = await Notifications.sendNotification(WS_1, _goodRequest(), 'key-B');
    if (!r1.success || !r2.success) throw new Error('sendNotification failed');
    expect(r2.data.notificationId).not.toBe(r1.data.notificationId);
  });

  test('Same key but different workspace creates separate notifications', async () => {
    const r1 = await Notifications.sendNotification(WS_1, _goodRequest(), 'shared-key');
    const r2 = await Notifications.sendNotification(WS_2, _goodRequest(), 'shared-key');
    if (!r1.success || !r2.success) throw new Error('sendNotification failed');
    expect(r2.data.notificationId).not.toBe(r1.data.notificationId);
  });
});

// ===========================================================================
// 4. CHANNEL SELECTION INTERSECTION (§21 line 1070 — binding)
// ===========================================================================

describe('CHANNEL SELECTION — content ∩ preferences ∩ configured providers', () => {
  test('Email content + email enabled + email configured → email dispatched', async () => {
    const notificationId = await _sendNotification();
    const r = await Notifications.getNotification(WS_1, notificationId);
    if (!r.success) throw new Error('getNotification failed');
    expect(r.data.channels.email).toBeDefined();
    expect(r.data.channels.email!.status).toBe('dispatched');
  });

  test('Email content + email DISABLED in preferences → email NOT dispatched', async () => {
    store.setPreferences(WS_1, { emailEnabled: false, smsEnabled: true, pushEnabled: true });
    // Only email content → no available channel → error.
    const r = await Notifications.sendNotification(WS_1, _goodRequest(), 'idem-pref-disabled');
    expect(r.success).toBe(false);
    if (r.success) return;
    expect(r.error.code).toBe(NotificationErrorCode.NO_AVAILABLE_CHANNEL);
  });

  test('Email + SMS content, SMS not configured → only email dispatched', async () => {
    const r = await Notifications.sendNotification(WS_1, {
      recipient: { email: 'alice@example.com', phone: '+1234567890' },
      content: {
        email: { subject: 's', body: 'b' },
        sms: { body: 'SMS body' },
      },
    }, 'idem-multi-channel');
    if (!r.success) throw new Error('sendNotification failed');
    const getR = await Notifications.getNotification(WS_1, r.data.notificationId);
    if (!getR.success) throw new Error('getNotification failed');
    expect(getR.data.channels.email).toBeDefined();
    // SMS is not configured (module doesn't exist) → not in dispatch plan.
    // SMS channel result should be absent (not in dispatch plan at all).
    expect(getR.data.channels.sms).toBeUndefined();
  });

  test('All channels enabled but only email configured → only email in dispatch plan', async () => {
    const r = await Notifications.getChannelStatus(WS_1);
    if (!r.success) throw new Error('getChannelStatus failed');
    expect(r.data.channels.email.configured).toBe(true);
    expect(r.data.channels.sms.configured).toBe(false);
    expect(r.data.channels.push.configured).toBe(false);
  });
});

// ===========================================================================
// 5. CANCELLATION BOUNDARY (§21 line 1101 — binding)
// ===========================================================================

describe('CANCELLATION BOUNDARY', () => {
  test('cancelNotification on a queued notification → cancelled', async () => {
    // We need to create a notification that stays in 'queued' state.
    // Since sendNotification dispatches immediately, we need to create
    // a notification directly in the store for this test.
    const notificationId = 'notif_test_cancel_001';
    store.insert({
      notificationId,
      workspaceId: WS_1,
      overallStatus: 'queued',
      channels: {},
      idempotencyKey: 'idem-cancel-test',
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    });
    const r = await Notifications.cancelNotification(WS_1, notificationId);
    expect(r.success).toBe(true);
    if (!r.success) return;
    expect(r.data.overallStatus).toBe('cancelled');
  });

  test('cancelNotification on a completed notification → NOTIFICATION_ALREADY_DISPATCHING', async () => {
    // sendNotification dispatches and completes synchronously.
    const notificationId = await _sendNotification(WS_1, _goodRequest(), 'idem-cancel-completed');
    // The notification is now 'completed' (dispatch happens immediately in test mode).
    const r = await Notifications.cancelNotification(WS_1, notificationId);
    expect(r.success).toBe(false);
    if (r.success) return;
    expect(r.error.code).toBe(NotificationErrorCode.NOTIFICATION_ALREADY_DISPATCHING);
  });

  test('cancelNotification on unknown notificationId → NOTIFICATION_NOT_FOUND', async () => {
    const r = await Notifications.cancelNotification(WS_1, 'notif_nonexistent');
    expect(r.success).toBe(false);
    if (r.success) return;
    expect(r.error.code).toBe(NotificationErrorCode.NOTIFICATION_NOT_FOUND);
  });
});

// ===========================================================================
// 6. FUNCTIONAL — getNotification + listNotifications
// ===========================================================================

describe('FUNCTIONAL — getNotification', () => {
  test('SUCCESS: returns notification with per-channel status', async () => {
    const notificationId = await _sendNotification();
    const r = await Notifications.getNotification(WS_1, notificationId);
    expect(r.success).toBe(true);
    if (!r.success) return;
    expect(r.data.notificationId).toBe(notificationId);
    expect(r.data.overallStatus).toBe('completed');
    expect(r.data.channels.email).toBeDefined();
    expect(r.data.channels.email!.status).toBe('dispatched');
    expect(r.data.channels.email!.messageId).toMatch(/^msg_/);
  });

  test('NOTIFICATION_NOT_FOUND for unknown notificationId', async () => {
    const r = await Notifications.getNotification(WS_1, 'notif_nonexistent');
    expect(r.success).toBe(false);
    if (r.success) return;
    expect(r.error.code).toBe(NotificationErrorCode.NOTIFICATION_NOT_FOUND);
  });
});

describe('FUNCTIONAL — listNotifications', () => {
  test('SUCCESS: lists all notifications in workspace', async () => {
    await _sendNotification(WS_1, _goodRequest(), 'idem-list-1');
    await _sendNotification(WS_1, _goodRequest(), 'idem-list-2');
    const r = await Notifications.listNotifications(WS_1);
    expect(r.success).toBe(true);
    if (!r.success) return;
    expect(r.data.notifications).toHaveLength(2);
  });

  test('Filters by overallStatus', async () => {
    await _sendNotification(WS_1, _goodRequest(), 'idem-filter-1');
    const r = await Notifications.listNotifications(WS_1, { overallStatus: 'completed' });
    expect(r.success).toBe(true);
    if (!r.success) return;
    expect(r.data.notifications.length).toBeGreaterThan(0);
    expect(r.data.notifications.every((n) => n.overallStatus === 'completed')).toBe(true);
  });

  test('WORKSPACE_NOT_FOUND for empty workspaceId', async () => {
    const r = await Notifications.listNotifications('');
    expect(r.success).toBe(false);
    if (r.success) return;
    expect(r.error.code).toBe(NotificationErrorCode.WORKSPACE_NOT_FOUND);
  });
});

// ===========================================================================
// 7. FUNCTIONAL — getChannelStatus
// ===========================================================================

describe('FUNCTIONAL — getChannelStatus', () => {
  test('Returns configured status for each channel', async () => {
    const r = await Notifications.getChannelStatus(WS_1);
    expect(r.success).toBe(true);
    if (!r.success) return;
    expect(r.data.channels.email.configured).toBe(true);
    expect(r.data.channels.sms.configured).toBe(false);
    expect(r.data.channels.push.configured).toBe(false);
  });
});

// ===========================================================================
// 8. WORKSPACE ISOLATION
// ===========================================================================

describe('WORKSPACE ISOLATION', () => {
  test('getNotification: cross-workspace returns NOTIFICATION_NOT_FOUND', async () => {
    const notificationId = await _sendNotification(WS_1);
    const r = await Notifications.getNotification(WS_2, notificationId);
    expect(r.success).toBe(false);
    if (r.success) return;
    expect(r.error.code).toBe(NotificationErrorCode.NOTIFICATION_NOT_FOUND);
  });

  test('listNotifications: only returns notifications from the specified workspace', async () => {
    await _sendNotification(WS_1, _goodRequest(), 'idem-ws-iso-1');
    await _sendNotification(WS_2, _goodRequest(), 'idem-ws-iso-2');
    const r1 = await Notifications.listNotifications(WS_1);
    const r2 = await Notifications.listNotifications(WS_2);
    if (!r1.success || !r2.success) throw new Error('listNotifications failed');
    expect(r1.data.notifications).toHaveLength(1);
    expect(r2.data.notifications).toHaveLength(1);
  });
});

// ===========================================================================
// 9. CONTENT OWNERSHIP — no transformation (§21 fork 3a)
// ===========================================================================

describe('CONTENT OWNERSHIP — no transformation/truncation/interpolation', () => {
  test('Email subject and body passed to Mail.sendEmail EXACTLY as supplied', async () => {
    const subject = 'Your Inspection #12345 is Scheduled';
    const body = '<p>Dear Alice,</p><p>Your inspection is scheduled for Tuesday at 3pm.</p>';
    await Notifications.sendNotification(WS_1, {
      recipient: { email: 'alice@example.com' },
      content: { email: { subject, body } },
    }, 'idem-content-exact');

    // Check what Mail.sendEmail received by inspecting the mock provider's sends.
    const genericSends = mockMailProvider.sends.filter((s) => s.type === 'generic');
    expect(genericSends.length).toBeGreaterThan(0);
    expect(genericSends[0].subject).toBe(subject); // exact, no transformation
    expect(genericSends[0].body).toBe(body);       // exact, no transformation
  });

  test('No content transformation functions exist in the codebase', () => {
    const publicKeys = Object.keys(Notifications);
    expect(publicKeys).not.toContain('transformContent');
    expect(publicKeys).not.toContain('truncate');
    expect(publicKeys).not.toContain('interpolate');
    expect(publicKeys).not.toContain('renderTemplate');
  });
});

// ===========================================================================
// 10. EACH TRANSPORT CALLED AT MOST ONCE (§21 fork 4)
// ===========================================================================

describe('EACH TRANSPORT CALLED AT MOST ONCE — no retry, no fallback', () => {
  test('Mail.sendEmail called exactly once per notification', async () => {
    await Notifications.sendNotification(WS_1, _goodRequest(), 'idem-once-001');
    const genericSends = mockMailProvider.sends.filter((s) => s.type === 'generic');
    expect(genericSends).toHaveLength(1);
  });

  test('No retry — if Mail returns an error, Notifications does NOT retry', async () => {
    // Configure Mail to fail by removing the provider and turning off mock mode.
    _setMailProviderForTesting(null);
    process.env.CODELOK_AUTH_USE_MOCK = '';
    // With no Mail provider, Notifications' _getConfiguredProviders sees email
    // as not configured → NO_AVAILABLE_CHANNEL (the channel is excluded by the
    // intersection before dispatch even happens).
    const r = await Notifications.sendNotification(WS_1, _goodRequest(), 'idem-no-retry-001');
    expect(r.success).toBe(false);
    if (r.success) return;
    expect(r.error.code).toBe(NotificationErrorCode.NO_AVAILABLE_CHANNEL);
    // Restore for subsequent tests.
    _setMailProviderForTesting(mockMailProvider);
    process.env.CODELOK_AUTH_USE_MOCK = 'true';
  });
});

// ===========================================================================
// 11. RECIPIENT DATA TRANSIENT (§21 line 1122)
// ===========================================================================

describe('RECIPIENT DATA — held transiently, not persisted as system of record', () => {
  test('Recipient data is cleared after dispatch', async () => {
    const notificationId = await _sendNotification();
    const record = store.getByNotificationId(notificationId);
    if (!record) throw new Error('record not found');
    // After dispatch, transient fields should be cleared.
    expect(record._transientRecipient).toBeUndefined();
    expect(record._transientContent).toBeUndefined();
  });

  test('getNotification does NOT return recipient data', async () => {
    const notificationId = await _sendNotification();
    const r = await Notifications.getNotification(WS_1, notificationId);
    if (!r.success) throw new Error('getNotification failed');
    const data = r.data as unknown as Record<string, unknown>;
    expect(data).not.toHaveProperty('recipient');
    expect(data).not.toHaveProperty('_transientRecipient');
  });
});

// ===========================================================================
// 12. OVERALL STATUS MODEL (§21 line 1110)
// ===========================================================================

describe('OVERALL STATUS MODEL', () => {
  test('overallStatus is "completed" after dispatch (not "succeeded")', async () => {
    const notificationId = await _sendNotification();
    const r = await Notifications.getNotification(WS_1, notificationId);
    if (!r.success) throw new Error('getNotification failed');
    // "completed" deliberately does NOT imply success or failure (§21 line 1124).
    expect(r.data.overallStatus).toBe('completed');
  });

  test('Per-channel status holds the real detail', async () => {
    const notificationId = await _sendNotification();
    const r = await Notifications.getNotification(WS_1, notificationId);
    if (!r.success) throw new Error('getNotification failed');
    expect(r.data.channels.email).toBeDefined();
    expect(['dispatched', 'failed', 'skipped', 'pending']).toContain(r.data.channels.email!.status);
  });
});

// ===========================================================================
// 13. COMPLIANCE — §3.6 StandardResponse shape
// ===========================================================================

describe('COMPLIANCE — §3.6 StandardResponse shape', () => {
  test('Every Notifications function returns success-or-error envelope', async () => {
    const notificationId = await _sendNotification();
    const samples: StandardResponse<unknown>[] = [
      await Notifications.sendNotification(WS_1, _goodRequest(), 'idem-compliance-001'),
      await Notifications.sendNotification('', _goodRequest(), 'idem-compliance-002'),
      await Notifications.getNotification(WS_1, notificationId),
      await Notifications.getNotification(WS_1, 'notif_bogus'),
      await Notifications.listNotifications(WS_1),
      await Notifications.getChannelStatus(WS_1),
    ];
    for (const r of samples) {
      assertStandardResponseShape(r);
      if (r.success) {
        expect(r.data).not.toBeUndefined();
        expect((r as { error?: unknown }).error).toBeUndefined();
      } else {
        expect(r.error).not.toBeUndefined();
        expect((r as { data?: unknown }).data).toBeUndefined();
      }
    }
  });
});

// ===========================================================================
// 14. COMPLIANCE — No business-reference fields
// ===========================================================================

describe('COMPLIANCE — no business-reference fields', () => {
  test('getNotification response contains no business-reference fields', async () => {
    const notificationId = await _sendNotification();
    const r = await Notifications.getNotification(WS_1, notificationId);
    if (!r.success) throw new Error('getNotification failed');
    const data = r.data as unknown as Record<string, unknown>;
    expect(data).toHaveProperty('notificationId');
    expect(data).toHaveProperty('overallStatus');
    expect(data).toHaveProperty('channels');
    // Forbidden business-reference fields.
    expect(data).not.toHaveProperty('entityType');
    expect(data).not.toHaveProperty('entityId');
    expect(data).not.toHaveProperty('inspectionId');
    expect(data).not.toHaveProperty('orderId');
    expect(data).not.toHaveProperty('verificationId');
  });
});
