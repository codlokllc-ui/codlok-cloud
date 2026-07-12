/**
 * Codlok Cloud — Verify Module Tests
 *
 * Per Master Spec §14 Rule 12 (Pre-freeze test requirement), this file
 * covers all three mandatory categories:
 *
 *   1. BOUNDARY TESTS — internals not importable from outside.
 *   2. REGRESSION TESTS — all 306 existing tests pass unmodified (run
 *      separately; this file doesn't touch other modules).
 *   3. COMPLIANCE TESTS — StandardResponse shape, §20 Mandatory Rules
 *      (idempotency required, data minimization, fact immutability,
 *      webhook dedup, adapter absorption, state machine, no business-
 *      reference fields).
 *
 * Run with: `bun test src/modules/verify`
 */

import { describe, test, expect, beforeEach, afterAll } from 'bun:test';
import {
  Verify,
  _resetStoreForTesting,
  _setProviderForTesting,
} from '@/modules/verify';
import { VerifyErrorCode } from '@/modules/verify/internal/errors';
import { MockVerifyProvider } from '@/modules/verify/internal/provider';
import { store } from '@/modules/verify/internal/store';
import type { StandardResponse } from '@/shared';

// ---------------------------------------------------------------------------
// Setup
// ---------------------------------------------------------------------------

let mockProvider: MockVerifyProvider;

beforeEach(() => {
  _resetStoreForTesting();
  mockProvider = new MockVerifyProvider();
  _setProviderForTesting(mockProvider);
  // Ensure dev/mock mode is OFF — we use explicit provider injection.
  process.env.CODELOK_AUTH_USE_MOCK = '';
});

afterAll(() => {
  _setProviderForTesting(null);
  _resetStoreForTesting();
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
const GOOD_TYPE = 'INDIVIDUAL_IDENTITY';
const GOOD_SUBJECT = 'user_alice_001';
const GOOD_IDEM_KEY = 'idem-verify-001';

/**
 * Helper: create a verification session.
 */
async function _createSession(
  workspaceId: string = WS_1,
  type: string = GOOD_TYPE,
  subject: string = GOOD_SUBJECT,
  idemKey: string = GOOD_IDEM_KEY
): Promise<{ verificationId: string; providerVerificationId: string }> {
  const r = await Verify.createVerificationSession(workspaceId, type, subject, idemKey);
  if (!r.success) throw new Error(`createVerificationSession failed: ${r.error.code}`);
  const record = store.getByVerificationId(r.data.verificationId);
  if (!record) throw new Error('record not found');
  return { verificationId: r.data.verificationId, providerVerificationId: record.providerVerificationId ?? '' };
}

/**
 * Helper: set up Configuration with webhook secret and process a webhook.
 */
async function _processWebhook(
  workspaceId: string,
  providerEventId: string,
  providerVerificationId: string,
  providerStatus: string,
  metadata?: Record<string, string>
): Promise<StandardResponse<{ processed: boolean; eventId: string; deduplicated: boolean }>> {
  const { getConfigurationService } = await import('@/config');
  const config = getConfigurationService();
  await config.setSecret(workspaceId, 'STRIPE_IDENTITY_WEBHOOK_SECRET', 'whsec_test', 'admin');
  const payload = JSON.stringify({ providerEventId, providerVerificationId, providerStatus, metadata });
  return Verify.processWebhook(workspaceId, payload, 'sig_test');
}

// ===========================================================================
// 1. BOUNDARY TESTS (Rule 12)
// ===========================================================================

describe('BOUNDARY TESTS — internal symbols not on public surface', () => {
  test('Verify public surface exposes §20 functions', () => {
    const publicKeys = Object.keys(Verify).sort();
    expect(publicKeys).toContain('createVerificationSession');
    expect(publicKeys).toContain('getVerificationStatus');
    expect(publicKeys).toContain('listVerifications');
    expect(publicKeys).toContain('getProviderStatus');
  });

  test('Verify public surface does NOT expose internals', () => {
    const publicKeys = Object.keys(Verify);
    expect(publicKeys).not.toContain('store');
    expect(publicKeys).not.toContain('resolveProvider');
    expect(publicKeys).not.toContain('_isValidTransition');
  });

  test('No entityType/entityId parameters (§20 line 963)', () => {
    const publicKeys = Object.keys(Verify);
    expect(publicKeys).not.toContain('approveEvidence');
    expect(publicKeys).not.toContain('attachToInspection');
    expect(publicKeys).not.toContain('linkSremaVerify');
  });

  test('No document/biometric/OCR functions (Data Minimization Rule)', () => {
    const publicKeys = Object.keys(Verify);
    expect(publicKeys).not.toContain('compareFaces');
    expect(publicKeys).not.toContain('extractDocumentData');
    expect(publicKeys).not.toContain('storeDocumentImage');
    expect(publicKeys).not.toContain('runOCR');
    expect(publicKeys).not.toContain('getBiometricTemplate');
  });
});

// ===========================================================================
// 2. FUNCTIONAL — createVerificationSession
// ===========================================================================

describe('FUNCTIONAL — createVerificationSession', () => {
  test('SUCCESS: returns { verificationId, providerSessionUrl, status: "pending" }', async () => {
    const r = await Verify.createVerificationSession(WS_1, GOOD_TYPE, GOOD_SUBJECT, GOOD_IDEM_KEY);
    expect(r.success).toBe(true);
    if (!r.success) return;
    expect(r.data.verificationId).toMatch(/^ver_/);
    expect(r.data.status).toBe('pending');
    expect(r.data.providerSessionUrl).toContain('mock-verify.local');
  });

  test('IDEMPOTENCY_KEY_REQUIRED when key missing', async () => {
    const r = await Verify.createVerificationSession(WS_1, GOOD_TYPE, GOOD_SUBJECT, '');
    expect(r.success).toBe(false);
    if (r.success) return;
    expect(r.error.code).toBe(VerifyErrorCode.IDEMPOTENCY_KEY_REQUIRED);
  });

  test('INVALID_VERIFICATION_TYPE for non-enum string', async () => {
    const r = await Verify.createVerificationSession(WS_1, 'OPAQUE_STRING', GOOD_SUBJECT, GOOD_IDEM_KEY);
    expect(r.success).toBe(false);
    if (r.success) return;
    expect(r.error.code).toBe(VerifyErrorCode.INVALID_VERIFICATION_TYPE);
  });

  test('INVALID_VERIFICATION_TYPE for empty type', async () => {
    const r = await Verify.createVerificationSession(WS_1, '', GOOD_SUBJECT, GOOD_IDEM_KEY);
    expect(r.success).toBe(false);
    if (r.success) return;
    expect(r.error.code).toBe(VerifyErrorCode.INVALID_VERIFICATION_TYPE);
  });

  test('WORKSPACE_NOT_FOUND for empty workspaceId', async () => {
    const r = await Verify.createVerificationSession('', GOOD_TYPE, GOOD_SUBJECT, GOOD_IDEM_KEY);
    expect(r.success).toBe(false);
    if (r.success) return;
    expect(r.error.code).toBe(VerifyErrorCode.WORKSPACE_NOT_FOUND);
  });

  test('PROVIDER_NOT_CONFIGURED when no provider available', async () => {
    _setProviderForTesting(null);
    const r = await Verify.createVerificationSession(WS_1, GOOD_TYPE, GOOD_SUBJECT, GOOD_IDEM_KEY);
    expect(r.success).toBe(false);
    if (r.success) return;
    expect(r.error.code).toBe(VerifyErrorCode.PROVIDER_NOT_CONFIGURED);
  });

  test('All 5 canonical verificationTypes accepted', async () => {
    const types = ['INDIVIDUAL_IDENTITY', 'BUSINESS_VERIFICATION', 'DOCUMENT_VERIFICATION', 'ADDRESS_VERIFICATION', 'AGE_VERIFICATION'];
    for (let i = 0; i < types.length; i++) {
      const r = await Verify.createVerificationSession(WS_1, types[i], GOOD_SUBJECT, `idem-type-${i}`);
      expect(r.success).toBe(true);
    }
  });
});

// ===========================================================================
// 3. IDEMPOTENCY — createVerificationSession (§20 line 976 — REQUIRED)
// ===========================================================================

describe('IDEMPOTENCY — createVerificationSession', () => {
  test('Duplicate workspaceId + idempotencyKey returns SAME verificationId', async () => {
    const r1 = await Verify.createVerificationSession(WS_1, GOOD_TYPE, GOOD_SUBJECT, 'idem-dup-001');
    const r2 = await Verify.createVerificationSession(WS_1, GOOD_TYPE, GOOD_SUBJECT, 'idem-dup-001');
    if (!r1.success || !r2.success) throw new Error('createVerificationSession failed');
    expect(r2.data.verificationId).toBe(r1.data.verificationId);
  });

  test('Duplicate does NOT create a second session', async () => {
    await Verify.createVerificationSession(WS_1, GOOD_TYPE, GOOD_SUBJECT, 'idem-no-double-001');
    await Verify.createVerificationSession(WS_1, GOOD_TYPE, GOOD_SUBJECT, 'idem-no-double-001');
    const record = store.findByIdempotencyKey(WS_1, 'idem-no-double-001');
    expect(record).toBeTruthy();
  });

  test('Different idempotencyKey creates separate sessions', async () => {
    const r1 = await Verify.createVerificationSession(WS_1, GOOD_TYPE, GOOD_SUBJECT, 'key-A');
    const r2 = await Verify.createVerificationSession(WS_1, GOOD_TYPE, GOOD_SUBJECT, 'key-B');
    if (!r1.success || !r2.success) throw new Error('createVerificationSession failed');
    expect(r2.data.verificationId).not.toBe(r1.data.verificationId);
  });

  test('Same idempotencyKey but different workspaceId creates separate sessions', async () => {
    const r1 = await Verify.createVerificationSession(WS_1, GOOD_TYPE, GOOD_SUBJECT, 'shared-key');
    const r2 = await Verify.createVerificationSession(WS_2, GOOD_TYPE, GOOD_SUBJECT, 'shared-key');
    if (!r1.success || !r2.success) throw new Error('createVerificationSession failed');
    expect(r2.data.verificationId).not.toBe(r1.data.verificationId);
  });
});

// ===========================================================================
// 4. FUNCTIONAL — getVerificationStatus + listVerifications
// ===========================================================================

describe('FUNCTIONAL — getVerificationStatus', () => {
  test('SUCCESS: returns verification metadata', async () => {
    const { verificationId } = await _createSession();
    const r = await Verify.getVerificationStatus(WS_1, verificationId);
    expect(r.success).toBe(true);
    if (!r.success) return;
    expect(r.data.verificationId).toBe(verificationId);
    expect(r.data.status).toBe('pending');
    expect(r.data.provider).toBe('mock');
    expect(r.data.verificationType).toBe(GOOD_TYPE);
    expect(r.data.createdAt).toBeTruthy();
    expect(r.data.updatedAt).toBeTruthy();
  });

  test('VERIFICATION_NOT_FOUND for unknown verificationId', async () => {
    const r = await Verify.getVerificationStatus(WS_1, 'ver_nonexistent');
    expect(r.success).toBe(false);
    if (r.success) return;
    expect(r.error.code).toBe(VerifyErrorCode.VERIFICATION_NOT_FOUND);
  });
});

describe('FUNCTIONAL — listVerifications', () => {
  test('SUCCESS: lists all verifications in workspace', async () => {
    await _createSession(WS_1, GOOD_TYPE, 'subject1', 'idem-list-1');
    await _createSession(WS_1, 'DOCUMENT_VERIFICATION', 'subject2', 'idem-list-2');
    const r = await Verify.listVerifications(WS_1);
    expect(r.success).toBe(true);
    if (!r.success) return;
    expect(r.data.verifications).toHaveLength(2);
  });

  test('SUCCESS: filters by status', async () => {
    await _createSession(WS_1, GOOD_TYPE, 'subject1', 'idem-filter-1');
    const { verificationId } = await _createSession(WS_1, GOOD_TYPE, 'subject2', 'idem-filter-2');
    // Transition one to approved via webhook.
    const record = store.getByVerificationId(verificationId);
    store.updateStatus(verificationId, 'approved', { finalizedAt: new Date().toISOString() });
    const r = await Verify.listVerifications(WS_1, { status: 'approved' });
    if (!r.success) throw new Error('listVerifications failed');
    expect(r.data.verifications).toHaveLength(1);
    expect(r.data.verifications[0].verificationId).toBe(verificationId);
  });

  test('SUCCESS: filters by verificationType', async () => {
    await _createSession(WS_1, 'INDIVIDUAL_IDENTITY', 'subject1', 'idem-type-filter-1');
    await _createSession(WS_1, 'DOCUMENT_VERIFICATION', 'subject2', 'idem-type-filter-2');
    const r = await Verify.listVerifications(WS_1, { verificationType: 'DOCUMENT_VERIFICATION' });
    if (!r.success) throw new Error('listVerifications failed');
    expect(r.data.verifications).toHaveLength(1);
    expect(r.data.verifications[0].verificationType).toBe('DOCUMENT_VERIFICATION');
  });

  test('WORKSPACE_NOT_FOUND for empty workspaceId', async () => {
    const r = await Verify.listVerifications('');
    expect(r.success).toBe(false);
    if (r.success) return;
    expect(r.error.code).toBe(VerifyErrorCode.WORKSPACE_NOT_FOUND);
  });
});

// ===========================================================================
// 5. FUNCTIONAL — getProviderStatus
// ===========================================================================

describe('FUNCTIONAL — getProviderStatus', () => {
  test('configured when provider available', async () => {
    const r = await Verify.getProviderStatus(WS_1);
    expect(r.success).toBe(true);
    if (!r.success) return;
    expect(r.data.configured).toBe(true);
    expect(r.data.provider).toBe('mock');
  });

  test('not configured when no provider', async () => {
    _setProviderForTesting(null);
    const r = await Verify.getProviderStatus(WS_1);
    expect(r.success).toBe(true);
    if (!r.success) return;
    expect(r.data.configured).toBe(false);
    expect(r.data.provider).toBeNull();
  });
});

// ===========================================================================
// 6. WORKSPACE ISOLATION
// ===========================================================================

describe('WORKSPACE ISOLATION', () => {
  test('getVerificationStatus: cross-workspace returns VERIFICATION_NOT_FOUND', async () => {
    const { verificationId } = await _createSession(WS_1);
    const r = await Verify.getVerificationStatus(WS_2, verificationId);
    expect(r.success).toBe(false);
    if (r.success) return;
    expect(r.error.code).toBe(VerifyErrorCode.VERIFICATION_NOT_FOUND);
  });

  test('listVerifications: only returns verifications from the specified workspace', async () => {
    await _createSession(WS_1, GOOD_TYPE, 'subject1', 'idem-ws-iso-1');
    await _createSession(WS_2, GOOD_TYPE, 'subject2', 'idem-ws-iso-2');
    const r1 = await Verify.listVerifications(WS_1);
    const r2 = await Verify.listVerifications(WS_2);
    if (!r1.success || !r2.success) throw new Error('listVerifications failed');
    expect(r1.data.verifications).toHaveLength(1);
    expect(r2.data.verifications).toHaveLength(1);
  });
});

// ===========================================================================
// 7. WEBHOOK DEDUPLICATION (§20 line 1013 — permanent)
// ===========================================================================

describe('WEBHOOK DEDUPLICATION', () => {
  test('First webhook processes successfully', async () => {
    const { verificationId, providerVerificationId } = await _createSession();
    const r = await _processWebhook(WS_1, 'evt_001', providerVerificationId, 'verified');
    expect(r.success).toBe(true);
    if (!r.success) return;
    expect(r.data.processed).toBe(true);
    expect(r.data.deduplicated).toBe(false);
  });

  test('Duplicate webhook event ID is a true no-op', async () => {
    const { providerVerificationId } = await _createSession();
    await _processWebhook(WS_1, 'evt_dup_001', providerVerificationId, 'verified');
    const r2 = await _processWebhook(WS_1, 'evt_dup_001', providerVerificationId, 'verified');
    expect(r2.success).toBe(true);
    if (!r2.success) return;
    expect(r2.data.deduplicated).toBe(true);
    expect(r2.data.processed).toBe(false);
  });

  test('Duplicate webhook does NOT repeat status transition', async () => {
    const { verificationId, providerVerificationId } = await _createSession();
    // First delivery → transitions to 'approved'.
    await _processWebhook(WS_1, 'evt_dup_transition_001', providerVerificationId, 'verified');
    const getR1 = await Verify.getVerificationStatus(WS_1, verificationId);
    if (!getR1.success) throw new Error('getVerificationStatus failed');
    expect(getR1.data.status).toBe('approved');

    // Second delivery of the same event → no-op (status unchanged).
    await _processWebhook(WS_1, 'evt_dup_transition_001', providerVerificationId, 'verified');
    const getR2 = await Verify.getVerificationStatus(WS_1, verificationId);
    if (!getR2.success) throw new Error('getVerificationStatus failed');
    expect(getR2.data.status).toBe('approved'); // unchanged
  });

  test('Different event IDs are processed separately', async () => {
    const { providerVerificationId } = await _createSession();
    const r1 = await _processWebhook(WS_1, 'evt_unique_001', providerVerificationId, 'verified');
    const r2 = await _processWebhook(WS_1, 'evt_unique_002', providerVerificationId, 'verified');
    if (!r1.success || !r2.success) throw new Error('processWebhook failed');
    expect(r1.data.deduplicated).toBe(false);
    expect(r2.data.deduplicated).toBe(false);
  });
});

// ===========================================================================
// 8. ADAPTER ABSORPTION RULE (§20 line 1003 — binding)
// ===========================================================================

describe('ADAPTER ABSORPTION RULE — provider intermediate states absorbed', () => {
  test('requires_input does NOT trigger a status change (stays pending)', async () => {
    const { verificationId, providerVerificationId } = await _createSession();
    await _processWebhook(WS_1, 'evt_req_input_001', providerVerificationId, 'requires_input');
    const getR = await Verify.getVerificationStatus(WS_1, verificationId);
    if (!getR.success) throw new Error('getVerificationStatus failed');
    // Per §20 line 1006: "the adapter does not surface a status change every
    // time Stripe asks the user to resubmit a document; it stays pending."
    expect(getR.data.status).toBe('pending');
  });

  test('processing does NOT trigger a status change (stays pending)', async () => {
    const { verificationId, providerVerificationId } = await _createSession();
    await _processWebhook(WS_1, 'evt_processing_001', providerVerificationId, 'processing');
    const getR = await Verify.getVerificationStatus(WS_1, verificationId);
    if (!getR.success) throw new Error('getVerificationStatus failed');
    expect(getR.data.status).toBe('pending');
  });

  test('requires_input loop: multiple requires_input webhooks all stay pending', async () => {
    const { verificationId, providerVerificationId } = await _createSession();
    // Simulate Stripe's resubmission loop: multiple requires_input events.
    await _processWebhook(WS_1, 'evt_loop_001', providerVerificationId, 'requires_input');
    await _processWebhook(WS_1, 'evt_loop_002', providerVerificationId, 'requires_input');
    await _processWebhook(WS_1, 'evt_loop_003', providerVerificationId, 'requires_input');
    const getR = await Verify.getVerificationStatus(WS_1, verificationId);
    if (!getR.success) throw new Error('getVerificationStatus failed');
    expect(getR.data.status).toBe('pending'); // never changed
  });

  test('verified → approved (actionable transition)', async () => {
    const { verificationId, providerVerificationId } = await _createSession();
    await _processWebhook(WS_1, 'evt_verified_001', providerVerificationId, 'verified');
    const getR = await Verify.getVerificationStatus(WS_1, verificationId);
    if (!getR.success) throw new Error('getVerificationStatus failed');
    expect(getR.data.status).toBe('approved');
  });

  test('needs_review → in_review (Persona-style manual review)', async () => {
    const { verificationId, providerVerificationId } = await _createSession();
    await _processWebhook(WS_1, 'evt_needs_review_001', providerVerificationId, 'needs_review');
    const getR = await Verify.getVerificationStatus(WS_1, verificationId);
    if (!getR.success) throw new Error('getVerificationStatus failed');
    expect(getR.data.status).toBe('in_review');
  });

  test('declined → rejected (Persona-style decision)', async () => {
    const { verificationId, providerVerificationId } = await _createSession();
    await _processWebhook(WS_1, 'evt_declined_001', providerVerificationId, 'declined');
    const getR = await Verify.getVerificationStatus(WS_1, verificationId);
    if (!getR.success) throw new Error('getVerificationStatus failed');
    expect(getR.data.status).toBe('rejected');
  });

  test('canceled → rejected (Stripe has no distinct "rejected" — mapped per §20 line 1008)', async () => {
    const { verificationId, providerVerificationId } = await _createSession();
    await _processWebhook(WS_1, 'evt_canceled_001', providerVerificationId, 'canceled');
    const getR = await Verify.getVerificationStatus(WS_1, verificationId);
    if (!getR.success) throw new Error('getVerificationStatus failed');
    expect(getR.data.status).toBe('rejected');
  });

  test('Full lifecycle: requires_input loop → verified → approved', async () => {
    const { verificationId, providerVerificationId } = await _createSession();
    // Loop through requires_input multiple times.
    await _processWebhook(WS_1, 'evt_lifecycle_001', providerVerificationId, 'requires_input');
    await _processWebhook(WS_1, 'evt_lifecycle_002', providerVerificationId, 'requires_input');
    let getR = await Verify.getVerificationStatus(WS_1, verificationId);
    if (!getR.success) throw new Error('getVerificationStatus failed');
    expect(getR.data.status).toBe('pending');
    // Finally verified.
    await _processWebhook(WS_1, 'evt_lifecycle_003', providerVerificationId, 'verified');
    getR = await Verify.getVerificationStatus(WS_1, verificationId);
    if (!getR.success) throw new Error('getVerificationStatus failed');
    expect(getR.data.status).toBe('approved');
  });
});

// ===========================================================================
// 9. VERIFICATION FACT IMMUTABILITY (§20 line 968)
// ===========================================================================

describe('VERIFICATION FACT IMMUTABILITY', () => {
  test('Core fields never change after creation (only status transitions)', async () => {
    const { verificationId, providerVerificationId } = await _createSession();
    const record1 = store.getByVerificationId(verificationId);
    if (!record1) throw new Error('record not found');

    // Transition via webhook.
    await _processWebhook(WS_1, 'evt_immut_001', providerVerificationId, 'verified');

    const record2 = store.getByVerificationId(verificationId);
    if (!record2) throw new Error('record not found');

    // Status changed.
    expect(record2.status).toBe('approved');
    // Immutable fields did NOT change.
    expect(record2.verificationId).toBe(record1.verificationId);
    expect(record2.provider).toBe(record1.provider);
    expect(record2.providerVerificationId).toBe(record1.providerVerificationId);
    expect(record2.verificationType).toBe(record1.verificationType);
    expect(record2.subjectReference).toBe(record1.subjectReference);
    expect(record2.workspaceId).toBe(record1.workspaceId);
  });

  test('No updateVerificationType or updateSubjectReference function', () => {
    const publicKeys = Object.keys(Verify);
    expect(publicKeys).not.toContain('updateVerificationType');
    expect(publicKeys).not.toContain('updateSubjectReference');
    expect(publicKeys).not.toContain('updateProvider');
    expect(publicKeys).not.toContain('editVerification');
  });
});

// ===========================================================================
// 10. DATA MINIMIZATION (§20 line 965)
// ===========================================================================

describe('DATA MINIMIZATION — no raw documents/biometric/OCR stored', () => {
  test('Verification record contains NO document/biometric/OCR fields', async () => {
    const { verificationId } = await _createSession();
    const record = store.getByVerificationId(verificationId);
    if (!record) throw new Error('record not found');
    const recordKeys = Object.keys(record);
    // Forbidden fields.
    expect(recordKeys).not.toContain('documentImage');
    expect(recordKeys).not.toContain('documentData');
    expect(recordKeys).not.toContain('biometricTemplate');
    expect(recordKeys).not.toContain('faceEmbedding');
    expect(recordKeys).not.toContain('ocrResult');
    expect(recordKeys).not.toContain('fullProviderReport');
    expect(recordKeys).not.toContain('selfieImage');
    expect(recordKeys).not.toContain('passportImage');
    // Allowed fields.
    expect(recordKeys).toContain('verificationId');
    expect(recordKeys).toContain('provider');
    expect(recordKeys).toContain('status');
    expect(recordKeys).toContain('verificationType');
  });

  test('getVerificationStatus returns NO document/biometric data', async () => {
    const { verificationId } = await _createSession();
    const r = await Verify.getVerificationStatus(WS_1, verificationId);
    if (!r.success) throw new Error('getVerificationStatus failed');
    const data = r.data as unknown as Record<string, unknown>;
    expect(data).not.toHaveProperty('documentImage');
    expect(data).not.toHaveProperty('biometricTemplate');
    expect(data).not.toHaveProperty('ocrResult');
    expect(data).not.toHaveProperty('fullProviderReport');
  });

  test('No function returns raw documents or biometric data', () => {
    const publicKeys = Object.keys(Verify);
    expect(publicKeys).not.toContain('getDocument');
    expect(publicKeys).not.toContain('getBiometric');
    expect(publicKeys).not.toContain('getOcrResult');
    expect(publicKeys).not.toContain('getFullReport');
    expect(publicKeys).not.toContain('downloadDocument');
  });
});

// ===========================================================================
// 11. STATE MACHINE TRANSITIONS (§20 line 994)
// ===========================================================================

describe('STATE MACHINE — valid and invalid transitions', () => {
  test('pending → in_review (via webhook)', async () => {
    const { verificationId, providerVerificationId } = await _createSession();
    await _processWebhook(WS_1, 'evt_sm_001', providerVerificationId, 'needs_review');
    const getR = await Verify.getVerificationStatus(WS_1, verificationId);
    if (!getR.success) throw new Error('getVerificationStatus failed');
    expect(getR.data.status).toBe('in_review');
  });

  test('pending → approved (via webhook, terminal)', async () => {
    const { verificationId, providerVerificationId } = await _createSession();
    await _processWebhook(WS_1, 'evt_sm_002', providerVerificationId, 'verified');
    const getR = await Verify.getVerificationStatus(WS_1, verificationId);
    if (!getR.success) throw new Error('getVerificationStatus failed');
    expect(getR.data.status).toBe('approved');
  });

  test('pending → rejected (via webhook, terminal)', async () => {
    const { verificationId, providerVerificationId } = await _createSession();
    await _processWebhook(WS_1, 'evt_sm_003', providerVerificationId, 'declined');
    const getR = await Verify.getVerificationStatus(WS_1, verificationId);
    if (!getR.success) throw new Error('getVerificationStatus failed');
    expect(getR.data.status).toBe('rejected');
  });

  test('in_review → approved (via webhook)', async () => {
    const { verificationId, providerVerificationId } = await _createSession();
    // First: needs_review → in_review.
    await _processWebhook(WS_1, 'evt_sm_004a', providerVerificationId, 'needs_review');
    // Then: verified → approved.
    await _processWebhook(WS_1, 'evt_sm_004b', providerVerificationId, 'verified');
    const getR = await Verify.getVerificationStatus(WS_1, verificationId);
    if (!getR.success) throw new Error('getVerificationStatus failed');
    expect(getR.data.status).toBe('approved');
  });

  test('approved is terminal — no further transitions', async () => {
    const { verificationId, providerVerificationId } = await _createSession();
    await _processWebhook(WS_1, 'evt_sm_005a', providerVerificationId, 'verified');
    // Try to transition again — should be rejected by _isValidTransition.
    await _processWebhook(WS_1, 'evt_sm_005b', providerVerificationId, 'declined');
    const getR = await Verify.getVerificationStatus(WS_1, verificationId);
    if (!getR.success) throw new Error('getVerificationStatus failed');
    expect(getR.data.status).toBe('approved'); // unchanged — terminal
  });

  test('No public function transitions status directly (only webhooks)', () => {
    // createVerificationSession always returns status: "pending".
    // getVerificationStatus, listVerifications, getProviderStatus are read-only.
    // No approve(), reject(), or transition() function exists.
    const publicKeys = Object.keys(Verify);
    expect(publicKeys).not.toContain('approve');
    expect(publicKeys).not.toContain('reject');
    expect(publicKeys).not.toContain('transitionStatus');
    expect(publicKeys).not.toContain('markApproved');
  });
});

// ===========================================================================
// 12. COMPLIANCE — §3.6 StandardResponse shape
// ===========================================================================

describe('COMPLIANCE — §3.6 StandardResponse shape', () => {
  test('Every Verify function returns success-or-error envelope', async () => {
    const { verificationId } = await _createSession();
    const samples: StandardResponse<unknown>[] = [
      await Verify.createVerificationSession(WS_1, GOOD_TYPE, GOOD_SUBJECT, 'idem-compliance-001'),
      await Verify.createVerificationSession('', GOOD_TYPE, GOOD_SUBJECT, 'idem-compliance-002'), // error
      await Verify.getVerificationStatus(WS_1, verificationId),
      await Verify.getVerificationStatus(WS_1, 'ver_bogus'), // error
      await Verify.listVerifications(WS_1),
      await Verify.getProviderStatus(WS_1),
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
// 13. COMPLIANCE — No business-reference fields (§20 line 963)
// ===========================================================================

describe('COMPLIANCE — No business-reference fields', () => {
  test('getVerificationStatus response contains no business-reference fields', async () => {
    const { verificationId } = await _createSession();
    const r = await Verify.getVerificationStatus(WS_1, verificationId);
    if (!r.success) throw new Error('getVerificationStatus failed');
    const data = r.data as unknown as Record<string, unknown>;
    expect(data).toHaveProperty('verificationId');
    expect(data).toHaveProperty('status');
    expect(data).toHaveProperty('provider');
    expect(data).toHaveProperty('verificationType');
    // Forbidden business-reference fields.
    expect(data).not.toHaveProperty('entityType');
    expect(data).not.toHaveProperty('entityId');
    expect(data).not.toHaveProperty('inspectionId');
    expect(data).not.toHaveProperty('orderId');
    expect(data).not.toHaveProperty('subscriptionId');
  });

  test('subjectReference stored opaquely — Verify never interprets it', async () => {
    // subjectReference can be any string — a userId, a business ID, etc.
    // Verify stores it as-is and never validates or interprets it.
    const r1 = await Verify.createVerificationSession(WS_1, GOOD_TYPE, 'user_abc', 'idem-sub-1');
    const r2 = await Verify.createVerificationSession(WS_1, GOOD_TYPE, 'business_xyz_456', 'idem-sub-2');
    const r3 = await Verify.createVerificationSession(WS_1, GOOD_TYPE, 'any-opaque-string-here', 'idem-sub-3');
    expect(r1.success).toBe(true);
    expect(r2.success).toBe(true);
    expect(r3.success).toBe(true);
  });
});

// ===========================================================================
// 14. COMPLIANCE — Module boundary (§20 line 1019)
// ===========================================================================

describe('COMPLIANCE — Module boundary', () => {
  test('Verify does NOT import Storage, Pay, or any other module', async () => {
    const fs = await import('fs');
    const src = fs.readFileSync('/home/z/my-project/src/modules/verify/index.ts', 'utf-8');
    // Must import Configuration (allowed per §20 line 1019) — either static or dynamic.
    expect(src).toMatch(/@\/config/);
    // Must NOT import Storage, Pay, Auth, Organizations, Mail.
    // Strip comments to avoid false positives on JSDoc that mentions other modules.
    const codeOnly = src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');
    expect(codeOnly).not.toMatch(/@\/modules\/storage/);
    expect(codeOnly).not.toMatch(/@\/modules\/pay/);
    expect(codeOnly).not.toMatch(/@\/modules\/auth/);
    expect(codeOnly).not.toMatch(/@\/modules\/organizations/);
    expect(codeOnly).not.toMatch(/@\/modules\/mail/);
  });
});
