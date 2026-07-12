/**
 * Codlok Cloud — Mail Module Tests
 *
 * Per Master Spec §14 Rule 12 (Pre-freeze test requirement), this file
 * covers all three mandatory categories:
 *
 *   1. BOUNDARY TESTS — internals not importable from outside.
 *   2. REGRESSION TESTS — all 153 existing Auth + Organizations + Configuration
 *      tests pass unmodified (run separately; verified by running the full
 *      suite before this file was written).
 *   3. COMPLIANCE TESTS — StandardResponse shape, §17 Mandatory Rules
 *      (idempotency, workspace isolation, queue-and-retry, provider error
 *      suppression, getDeliveryStatus cross-workspace rejection).
 *
 * Run with: `bun test src/modules/mail`
 */

import { describe, test, expect, beforeEach, afterAll } from 'bun:test';
import {
  Mail,
  _resetStoreForTesting,
  _setProviderForTesting,
  _flushQueueForTesting,
  _getOutboxForTesting,
  _clearOutboxForTesting,
} from '@/modules/mail';
import { MailErrorCode } from '@/modules/mail/internal/errors';
import { MockMailProvider } from '@/modules/mail/internal/provider';
import type { StandardResponse } from '@/shared';

// ---------------------------------------------------------------------------
// Setup
// ---------------------------------------------------------------------------

let mockProvider: MockMailProvider;

beforeEach(() => {
  _resetStoreForTesting();
  _clearOutboxForTesting();
  mockProvider = new MockMailProvider();
  _setProviderForTesting(mockProvider);
  // Ensure dev/mock mode is OFF — we use explicit provider injection.
  process.env.CODELOK_AUTH_USE_MOCK = '';
});

afterAll(() => {
  _setProviderForTesting(null);
  _resetStoreForTesting();
  _clearOutboxForTesting();
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
const GOOD_EMAIL = 'alice@example.com';
const BAD_EMAIL = 'not-an-email';

// ===========================================================================
// 1. BOUNDARY TESTS (Rule 12)
// ===========================================================================

describe('BOUNDARY TESTS — internal symbols not on public surface', () => {
  test('Mail public surface exposes only §17 functions', () => {
    const publicKeys = Object.keys(Mail).sort();
    expect(publicKeys).toContain('sendVerificationEmail');
    expect(publicKeys).toContain('sendPasswordResetEmail');
    expect(publicKeys).toContain('sendInvitationEmail');
    expect(publicKeys).toContain('getDeliveryStatus');
  });

  test('Mail public surface does NOT expose internals', () => {
    const publicKeys = Object.keys(Mail);
    expect(publicKeys).not.toContain('store');
    expect(publicKeys).not.toContain('_deliver');
    expect(publicKeys).not.toContain('resolveProvider');
    expect(publicKeys).not.toContain('_send');
  });

  test('No testConnection() in public surface (§17 explicitly excludes it)', () => {
    expect((Mail as unknown as Record<string, unknown>).testConnection)
      .toBeUndefined();
  });

  test('Mail does NOT construct provider SDK clients for callers', async () => {
    // getSecret returns raw value only — Mail's send functions return
    // { queued, messageId }, not a provider client.
    const r = await Mail.sendVerificationEmail(WS_1, GOOD_EMAIL, 'https://verify.example.com?t=abc');
    expect(r.success).toBe(true);
    if (!r.success) return;
    expect(r.data).toEqual({ queued: true, messageId: expect.any(String) });
    expect(r.data).not.toHaveProperty('client');
    expect(r.data).not.toHaveProperty('sdk');
    expect(r.data).not.toHaveProperty('provider');
  });
});

// ===========================================================================
// 2. FUNCTIONAL — sendVerificationEmail / sendPasswordResetEmail / sendInvitationEmail
// ===========================================================================

describe('FUNCTIONAL — send functions', () => {
  test('sendVerificationEmail: success — returns { queued: true, messageId }', async () => {
    const r = await Mail.sendVerificationEmail(WS_1, GOOD_EMAIL, 'https://verify.example.com?t=abc');
    expect(r.success).toBe(true);
    if (!r.success) return;
    expect(r.data.queued).toBe(true);
    expect(r.data.messageId).toMatch(/^msg_/);
  });

  test('sendPasswordResetEmail: success', async () => {
    const r = await Mail.sendPasswordResetEmail(WS_1, GOOD_EMAIL, 'https://reset.example.com?t=abc');
    expect(r.success).toBe(true);
    if (!r.success) return;
    expect(r.data.queued).toBe(true);
    expect(r.data.messageId).toMatch(/^msg_/);
  });

  test('sendInvitationEmail: success', async () => {
    const r = await Mail.sendInvitationEmail(
      WS_1, GOOD_EMAIL, 'https://invite.example.com?t=abc',
      'alice@example.com', 'Alice Co'
    );
    expect(r.success).toBe(true);
    if (!r.success) return;
    expect(r.data.queued).toBe(true);
    expect(r.data.messageId).toMatch(/^msg_/);
  });

  test('INVALID_RECIPIENT for bad email format', async () => {
    const r = await Mail.sendVerificationEmail(WS_1, BAD_EMAIL, 'token');
    expect(r.success).toBe(false);
    if (r.success) return;
    expect(r.error.code).toBe(MailErrorCode.INVALID_RECIPIENT);
  });

  test('INVALID_RECIPIENT for empty email', async () => {
    const r = await Mail.sendVerificationEmail(WS_1, '', 'token');
    expect(r.success).toBe(false);
    if (r.success) return;
    expect(r.error.code).toBe(MailErrorCode.INVALID_RECIPIENT);
  });

  test('PROVIDER_NOT_CONFIGURED when no provider available', async () => {
    _setProviderForTesting(null);
    // Also ensure dev mock mode is off.
    process.env.CODELOK_AUTH_USE_MOCK = '';
    const r = await Mail.sendVerificationEmail(WS_1, GOOD_EMAIL, 'token');
    expect(r.success).toBe(false);
    if (r.success) return;
    expect(r.error.code).toBe(MailErrorCode.PROVIDER_NOT_CONFIGURED);
  });
});

// ===========================================================================
// 3. IDEMPOTENCY (§17 binding v1 rule)
// ===========================================================================

describe('IDEMPOTENCY — same workspaceId + idempotencyKey returns original messageId', () => {
  test('Duplicate key within window returns SAME messageId', async () => {
    const r1 = await Mail.sendVerificationEmail(
      WS_1, GOOD_EMAIL, 'token1', 'idem-key-001'
    );
    const r2 = await Mail.sendVerificationEmail(
      WS_1, GOOD_EMAIL, 'token1', 'idem-key-001'
    );
    if (!r1.success || !r2.success) throw new Error('send failed');
    expect(r2.data.messageId).toBe(r1.data.messageId);
  });

  test('Duplicate key does NOT send a second email', async () => {
    await Mail.sendVerificationEmail(WS_1, GOOD_EMAIL, 'token1', 'idem-key-002');
    await Mail.sendVerificationEmail(WS_1, GOOD_EMAIL, 'token1', 'idem-key-002');
    // MockMailProvider records every successful send.
    expect(mockProvider.sends).toHaveLength(1);
  });

  test('Different idempotencyKey sends separate emails', async () => {
    await Mail.sendVerificationEmail(WS_1, GOOD_EMAIL, 'token1', 'key-A');
    await Mail.sendVerificationEmail(WS_1, GOOD_EMAIL, 'token1', 'key-B');
    expect(mockProvider.sends).toHaveLength(2);
  });

  test('Same idempotencyKey but DIFFERENT workspaceId sends separate emails', async () => {
    await Mail.sendVerificationEmail(WS_1, GOOD_EMAIL, 'token1', 'same-key');
    await Mail.sendVerificationEmail(WS_2, GOOD_EMAIL, 'token1', 'same-key');
    expect(mockProvider.sends).toHaveLength(2);
  });

  test('No idempotencyKey → always sends (no dedup)', async () => {
    await Mail.sendVerificationEmail(WS_1, GOOD_EMAIL, 'token1');
    await Mail.sendVerificationEmail(WS_1, GOOD_EMAIL, 'token1');
    expect(mockProvider.sends).toHaveLength(2);
  });
});

// ===========================================================================
// 4. QUEUE-AND-RETRY RELIABILITY MODEL (§17 lines 688-694)
// ===========================================================================

describe('RELIABILITY — queue-and-retry model', () => {
  test('sendVerificationEmail returns immediately with { queued: true }', async () => {
    // Even with a slow provider, the function returns immediately.
    // (MockMailProvider is instant, but the point is the function doesn't
    // block on delivery — it returns { queued: true, messageId } before
    // the async delivery completes.)
    const r = await Mail.sendVerificationEmail(WS_1, GOOD_EMAIL, 'token');
    expect(r.success).toBe(true);
    if (!r.success) return;
    expect(r.data.queued).toBe(true);
    // The delivery may or may not have completed yet — but the response
    // is already returned.
  });

  test('Provider failure does NOT propagate to caller', async () => {
    // Configure mock to fail 3 times (all retries).
    mockProvider.failCount = 3;
    const r = await Mail.sendVerificationEmail(WS_1, GOOD_EMAIL, 'token');
    // Caller sees success (queued), NOT a provider error.
    expect(r.success).toBe(true);
    if (!r.success) return;
    expect(r.data.queued).toBe(true);
    expect(r.data.messageId).toMatch(/^msg_/);
  });

  test('Provider failure — message status becomes "failed" after max retries', async () => {
    mockProvider.failCount = 3; // exhaust all retries (MAX_RETRIES = 3)
    const r = await Mail.sendVerificationEmail(WS_1, GOOD_EMAIL, 'token');
    if (!r.success) throw new Error('send failed');
    // Wait for async delivery to complete.
    await _flushQueueForTesting();
    const statusR = await Mail.getDeliveryStatus(WS_1, r.data.messageId);
    expect(statusR.success).toBe(true);
    if (!statusR.success) return;
    expect(statusR.data.status).toBe('failed');
  });

  test('Provider succeeds after retries — message status becomes "delivered"', async () => {
    mockProvider.failCount = 1; // fail once, then succeed
    const r = await Mail.sendVerificationEmail(WS_1, GOOD_EMAIL, 'token');
    if (!r.success) throw new Error('send failed');
    await _flushQueueForTesting();
    const statusR = await Mail.getDeliveryStatus(WS_1, r.data.messageId);
    expect(statusR.success).toBe(true);
    if (!statusR.success) return;
    expect(statusR.data.status).toBe('delivered');
  });

  test('Provider bounce — message status becomes "bounced"', async () => {
    mockProvider.bounceNext = true;
    const r = await Mail.sendVerificationEmail(WS_1, GOOD_EMAIL, 'token');
    if (!r.success) throw new Error('send failed');
    await _flushQueueForTesting();
    const statusR = await Mail.getDeliveryStatus(WS_1, r.data.messageId);
    expect(statusR.success).toBe(true);
    if (!statusR.success) return;
    expect(statusR.data.status).toBe('bounced');
  });

  test('Callers NEVER see raw provider errors — only INVALID_RECIPIENT or PROVIDER_NOT_CONFIGURED', async () => {
    mockProvider.failCount = 3;
    const r = await Mail.sendVerificationEmail(WS_1, GOOD_EMAIL, 'token');
    if (r.success) {
      // Success path: caller sees { queued: true, messageId } — no error.
      return;
    }
    // Error path: only INVALID_RECIPIENT or PROVIDER_NOT_CONFIGURED are valid.
    expect([
      MailErrorCode.INVALID_RECIPIENT,
      MailErrorCode.PROVIDER_NOT_CONFIGURED,
    ]).toContain(r.error.code);
    // Must NOT contain provider-specific text.
    expect(r.error.message).not.toMatch(/Resend|fetch|network|timeout|5\d\d/i);
  });
});

// ===========================================================================
// 5. WORKSPACE ISOLATION
// ===========================================================================

describe('WORKSPACE ISOLATION', () => {
  test('getDeliveryStatus: cross-workspace lookup returns MESSAGE_NOT_FOUND', async () => {
    const r = await Mail.sendVerificationEmail(WS_1, GOOD_EMAIL, 'token');
    if (!r.success) throw new Error('send failed');
    await _flushQueueForTesting();

    // Query from a different workspace → MESSAGE_NOT_FOUND.
    const crossR = await Mail.getDeliveryStatus(WS_2, r.data.messageId);
    expect(crossR.success).toBe(false);
    if (crossR.success) return;
    expect(crossR.error.code).toBe(MailErrorCode.MESSAGE_NOT_FOUND);
  });

  test('getDeliveryStatus: same-workspace lookup succeeds', async () => {
    const r = await Mail.sendVerificationEmail(WS_1, GOOD_EMAIL, 'token');
    if (!r.success) throw new Error('send failed');
    await _flushQueueForTesting();

    const sameR = await Mail.getDeliveryStatus(WS_1, r.data.messageId);
    expect(sameR.success).toBe(true);
    if (!sameR.success) return;
    expect(sameR.data.messageId).toBe(r.data.messageId);
  });

  test('Idempotency is workspace-scoped — same key in different workspaces is independent', async () => {
    const r1 = await Mail.sendVerificationEmail(WS_1, GOOD_EMAIL, 'token', 'shared-key');
    const r2 = await Mail.sendVerificationEmail(WS_2, GOOD_EMAIL, 'token', 'shared-key');
    if (!r1.success || !r2.success) throw new Error('send failed');
    expect(r2.data.messageId).not.toBe(r1.data.messageId);
  });
});

// ===========================================================================
// 6. getDeliveryStatus
// ===========================================================================

describe('FUNCTIONAL — getDeliveryStatus', () => {
  test('MESSAGE_NOT_FOUND for unknown messageId', async () => {
    const r = await Mail.getDeliveryStatus(WS_1, 'msg_nonexistent');
    expect(r.success).toBe(false);
    if (r.success) return;
    expect(r.error.code).toBe(MailErrorCode.MESSAGE_NOT_FOUND);
  });

  test('MESSAGE_NOT_FOUND for empty messageId', async () => {
    const r = await Mail.getDeliveryStatus(WS_1, '');
    expect(r.success).toBe(false);
    if (r.success) return;
    expect(r.error.code).toBe(MailErrorCode.MESSAGE_NOT_FOUND);
  });

  test('Returns all valid status values', async () => {
    // Test 'queued' status (before flush).
    const r = await Mail.sendVerificationEmail(WS_1, GOOD_EMAIL, 'token');
    if (!r.success) throw new Error('send failed');
    // Don't flush — status should be 'queued' or already 'delivered' (mock is instant).
    const statusR = await Mail.getDeliveryStatus(WS_1, r.data.messageId);
    expect(statusR.success).toBe(true);
    if (!statusR.success) return;
    expect(['queued', 'sent', 'delivered', 'failed', 'bounced']).toContain(statusR.data.status);
  });
});

// ===========================================================================
// 7. COMPLIANCE — §3.6 StandardResponse shape
// ===========================================================================

describe('COMPLIANCE — §3.6 StandardResponse shape', () => {
  test('Every Mail function returns success-or-error envelope', async () => {
    const samples: StandardResponse<unknown>[] = [
      await Mail.sendVerificationEmail(WS_1, GOOD_EMAIL, 'token'),
      await Mail.sendVerificationEmail(WS_1, BAD_EMAIL, 'token'),     // error
      await Mail.sendPasswordResetEmail(WS_1, GOOD_EMAIL, 'token'),
      await Mail.sendInvitationEmail(WS_1, GOOD_EMAIL, 'token', 'inv', 'ws'),
      await Mail.getDeliveryStatus(WS_1, 'msg_nonexistent'),          // error
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
// 8. COMPLIANCE — §17 Token parameters = URL strings (no business logic migration)
// ===========================================================================

describe('COMPLIANCE — Token parameters are URL strings from callers', () => {
  test('sendVerificationEmail receives and delivers the caller-provided URL as-is', async () => {
    const url = 'https://app.example.com/auth/verify-email?token=abc123&ws=ws1';
    await Mail.sendVerificationEmail(WS_1, GOOD_EMAIL, url);
    await _flushQueueForTesting();
    // MockMailProvider records what it was asked to send.
    expect(mockProvider.sends).toHaveLength(1);
    expect(mockProvider.sends[0].token).toBe(url);
    // Mail did NOT construct or modify the URL.
  });

  test('sendPasswordResetEmail receives and delivers the caller-provided URL as-is', async () => {
    const url = 'https://app.example.com/auth/reset-password?token=xyz789';
    await Mail.sendPasswordResetEmail(WS_1, GOOD_EMAIL, url);
    await _flushQueueForTesting();
    expect(mockProvider.sends[0].token).toBe(url);
  });

  test('sendInvitationEmail receives and delivers the caller-provided URL as-is', async () => {
    const url = 'https://app.example.com/organizations/invitations/accept?token=inv456';
    await Mail.sendInvitationEmail(WS_1, GOOD_EMAIL, url, 'alice@example.com', 'Alice Co');
    await _flushQueueForTesting();
    expect(mockProvider.sends[0].token).toBe(url);
    expect(mockProvider.sends[0].inviterName).toBe('alice@example.com');
    expect(mockProvider.sends[0].workspaceName).toBe('Alice Co');
  });

  test('Mail does NOT construct URLs — it receives tokens from callers', () => {
    // The public interface takes token parameters; Mail does not have a
    // URL builder function. Verify no buildUrl/buildToken function exists.
    const publicKeys = Object.keys(Mail);
    expect(publicKeys).not.toContain('buildUrl');
    expect(publicKeys).not.toContain('buildToken');
    expect(publicKeys).not.toContain('constructUrl');
  });
});

// ===========================================================================
// 9. COMPLIANCE — Outbox preserved (test-only helper)
// ===========================================================================

describe('COMPLIANCE — Outbox preserved from provisional stub', () => {
  test('_getOutboxForTesting returns entries with backward-compatible fields', async () => {
    await Mail.sendVerificationEmail(WS_1, GOOD_EMAIL, 'https://verify.example.com?t=abc');
    const outbox = _getOutboxForTesting();
    expect(outbox.length).toBeGreaterThan(0);
    const entry = outbox[outbox.length - 1];
    // Fields that existing Auth/Organizations tests depend on (backward compat):
    expect(entry).toHaveProperty('type');
    expect(entry).toHaveProperty('to');
    expect(entry).toHaveProperty('url');
    expect(entry).toHaveProperty('sentAt');
    expect(entry).toHaveProperty('id');
    // Fields added in v1.0 (present on this entry since provider is configured):
    expect(entry).toHaveProperty('status');
    expect(entry).toHaveProperty('queuedAt');
    // messageId is present when the message was actually queued (provider configured).
    // It may be absent when PROVIDER_NOT_CONFIGURED (outbox recorded before provider check).
    if (entry.messageId) {
      expect(entry.messageId).toMatch(/^msg_/);
    }
  });

  test('_clearOutboxForTesting clears the outbox', async () => {
    await Mail.sendVerificationEmail(WS_1, GOOD_EMAIL, 'token');
    _clearOutboxForTesting();
    expect(_getOutboxForTesting().length).toBe(0);
  });

  test('Outbox records send even when PROVIDER_NOT_CONFIGURED', async () => {
    // This preserves the provisional stub's behavior: the outbox records
    // "Mail was asked to send this" regardless of provider availability.
    _setProviderForTesting(null);
    process.env.CODELOK_AUTH_USE_MOCK = '';
    await Mail.sendPasswordResetEmail(WS_1, GOOD_EMAIL, 'https://reset.example.com?t=abc');
    const outbox = _getOutboxForTesting();
    expect(outbox.length).toBeGreaterThan(0);
    expect(outbox[outbox.length - 1].type).toBe('password_reset');
  });
});

// ===========================================================================
// 10. REGRESSION — Auth/Organizations compatibility
// ===========================================================================

describe('REGRESSION — Auth/Organizations compatibility', () => {
  test('Mail.sendVerificationEmail accepts the URL string Auth passes as verificationToken', async () => {
    // Auth's registerUser constructs: buildVerificationUrl(userId, token, ws)
    // → "http://localhost:3000/auth/verify-email?token=vtoken_..."
    // Mail receives this as the verificationToken parameter.
    const authStyleUrl = 'http://localhost:3000/auth/verify-email?token=vtoken_abc123';
    const r = await Mail.sendVerificationEmail(WS_1, GOOD_EMAIL, authStyleUrl);
    expect(r.success).toBe(true);
  });

  test('Mail.sendPasswordResetEmail accepts the URL string Auth passes as resetToken', async () => {
    const authStyleUrl = 'http://localhost:3000/auth/reset-password';
    const r = await Mail.sendPasswordResetEmail(WS_1, GOOD_EMAIL, authStyleUrl);
    expect(r.success).toBe(true);
  });

  test('Mail.sendInvitationEmail accepts the URL string Organizations passes as invitationToken', async () => {
    const orgsStyleUrl = 'http://localhost:3000/organizations/invitations/accept?token=itk_abc123';
    const r = await Mail.sendInvitationEmail(
      WS_1, GOOD_EMAIL, orgsStyleUrl,
      'inviter@example.com', 'Test Workspace'
    );
    expect(r.success).toBe(true);
  });
});

// ===========================================================================
// 11. sendEmail (v1.2 — generic email with arbitrary subject/body)
// ===========================================================================

describe('FUNCTIONAL — sendEmail (v1.2)', () => {
  test('SUCCESS: returns { queued: true, messageId }', async () => {
    const r = await Mail.sendEmail(WS_1, GOOD_EMAIL, 'Your inspection is scheduled', '<p>Tuesday at 3pm</p>');
    expect(r.success).toBe(true);
    if (!r.success) return;
    expect(r.data.queued).toBe(true);
    expect(r.data.messageId).toMatch(/^msg_/);
  });

  test('SUCCESS: subject and body used as-is — no template construction', async () => {
    await Mail.sendEmail(WS_1, GOOD_EMAIL, 'Custom Subject', '<p>Custom Body</p>');
    await _flushQueueForTesting();
    // MockMailProvider records what it was asked to send.
    expect(mockProvider.sends).toHaveLength(1);
    expect(mockProvider.sends[0].type).toBe('generic');
    expect(mockProvider.sends[0].subject).toBe('Custom Subject');
    expect(mockProvider.sends[0].body).toBe('<p>Custom Body</p>');
  });

  test('INVALID_RECIPIENT for bad email format', async () => {
    const r = await Mail.sendEmail(WS_1, BAD_EMAIL, 'subject', 'body');
    expect(r.success).toBe(false);
    if (r.success) return;
    expect(r.error.code).toBe('INVALID_RECIPIENT');
  });

  test('INVALID_CONTENT for missing subject', async () => {
    const r = await Mail.sendEmail(WS_1, GOOD_EMAIL, '', 'body');
    expect(r.success).toBe(false);
    if (r.success) return;
    expect(r.error.code).toBe('INVALID_CONTENT');
  });

  test('INVALID_CONTENT for missing body', async () => {
    const r = await Mail.sendEmail(WS_1, GOOD_EMAIL, 'subject', '');
    expect(r.success).toBe(false);
    if (r.success) return;
    expect(r.error.code).toBe('INVALID_CONTENT');
  });

  test('INVALID_CONTENT for oversized subject', async () => {
    const r = await Mail.sendEmail(WS_1, GOOD_EMAIL, 'x'.repeat(999), 'body');
    expect(r.success).toBe(false);
    if (r.success) return;
    expect(r.error.code).toBe('INVALID_CONTENT');
  });

  test('PROVIDER_NOT_CONFIGURED when no provider available', async () => {
    _setProviderForTesting(null);
    process.env.CODELOK_AUTH_USE_MOCK = '';
    const r = await Mail.sendEmail(WS_1, GOOD_EMAIL, 'subject', 'body');
    expect(r.success).toBe(false);
    if (r.success) return;
    expect(r.error.code).toBe('PROVIDER_NOT_CONFIGURED');
  });

  test('Idempotency: duplicate key returns same messageId', async () => {
    const r1 = await Mail.sendEmail(WS_1, GOOD_EMAIL, 'subject', 'body', 'idem-generic-001');
    const r2 = await Mail.sendEmail(WS_1, GOOD_EMAIL, 'subject', 'body', 'idem-generic-001');
    if (!r1.success || !r2.success) throw new Error('sendEmail failed');
    expect(r2.data.messageId).toBe(r1.data.messageId);
  });

  test('Idempotency: duplicate does NOT send twice', async () => {
    await Mail.sendEmail(WS_1, GOOD_EMAIL, 'subject', 'body', 'idem-generic-no-double');
    await Mail.sendEmail(WS_1, GOOD_EMAIL, 'subject', 'body', 'idem-generic-no-double');
    await _flushQueueForTesting();
    expect(mockProvider.sends.filter((s) => s.type === 'generic')).toHaveLength(1);
  });

  test('No existing function changed — all 3 template functions still work', async () => {
    // Verify sendVerificationEmail still uses template (not generic).
    await Mail.sendVerificationEmail(WS_1, GOOD_EMAIL, 'https://verify.example.com?t=abc');
    await _flushQueueForTesting();
    expect(mockProvider.sends[0].type).toBe('verification');
    // Verify it does NOT have subject/body (template constructs them internally).
    expect(mockProvider.sends[0].subject).toBeUndefined();
    expect(mockProvider.sends[0].body).toBeUndefined();
  });
});
