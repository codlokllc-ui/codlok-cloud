/**
 * Codlok Cloud — Mail Module — Public Interface v1.0
 *
 * Per Master Spec §17 Mail Module Specification v1.0 (STATUS: FROZEN).
 * Spec Version 1.8.
 *
 * Purpose: Answers "how does an email actually get sent, reliably, regardless
 * of which provider is behind it?" Retires the Rule 11 provisional stub that
 * Auth (registerUser, resetPassword) and Organizations (inviteMember,
 * resendInvitation) were calling.
 *
 * ----------------------------------------------------------------------------
 * PUBLIC INTERFACE (§17)
 * ----------------------------------------------------------------------------
 *   sendVerificationEmail(workspaceId, to, verificationToken, idempotencyKey?)
 *   sendPasswordResetEmail(workspaceId, to, resetToken, idempotencyKey?)
 *   sendInvitationEmail(workspaceId, to, invitationToken, inviterName,
 *                       workspaceName, idempotencyKey?)
 *   getDeliveryStatus(workspaceId, messageId)
 *
 * All return StandardResponse per §3.6.
 *
 * ----------------------------------------------------------------------------
 * RELIABILITY MODEL (§17 lines 688-694)
 * ----------------------------------------------------------------------------
 * - Public functions return quickly with { queued: true, messageId }.
 * - Internally, Mail queues the send and retries on provider failure
 *   (exponential backoff, bounded retry count = 3 retries).
 * - Callers NEVER see a provider-specific error — only INVALID_RECIPIENT
 *   (bad email format) or PROVIDER_NOT_CONFIGURED (no Resend key in
 *   Configuration for this workspace).
 *
 * ----------------------------------------------------------------------------
 * IDEMPOTENCY (§17 lines 677-678 — binding v1 rule)
 * ----------------------------------------------------------------------------
 * Every send function accepts an optional idempotencyKey. A request with the
 * same workspaceId + idempotencyKey within the idempotency window (24 hours)
 * returns the ORIGINAL messageId without sending a second email.
 *
 * Idempotency window: 24 HOURS.
 * Rationale: long enough to handle caller retry-after-timeout scenarios
 * (e.g. Auth.registerUser retried after Mail didn't respond in time), short
 * enough to not accumulate stale entries indefinitely.
 *
 * ----------------------------------------------------------------------------
 * TOKEN PARAMETERS (per Build Report requirement)
 * ----------------------------------------------------------------------------
 * §17's "verificationToken" / "resetToken" / "invitationToken" parameters
 * are populated with the SAME URL strings the provisional stub passed as
 * "verificationUrl" / "resetUrl" / "inviteUrl" — naming change only, no
 * semantic change. Mail does not construct URLs or tokens; it receives and
 * delivers whatever the caller (Auth, Organizations) already built. This
 * confirms compliance with "no business logic migration."
 *
 * ----------------------------------------------------------------------------
 * TEST OUTBOX (preserved from provisional stub)
 * ----------------------------------------------------------------------------
 * _getOutboxForTesting, _clearOutboxForTesting, and OutboxEntry are preserved
 * as test-only exports. They record every send for test inspection. This is
 * NOT part of the §17 public surface — it's a test helper, same pattern as
 * Configuration's _resetStoreForTesting and Organizations' _resetStoreForTesting.
 */

import { StandardResponse, ok, fail } from '@/shared';
import { MailErrorCode } from './internal/errors';
import type {
  MessageType,
  DeliveryStatus,
  OutboxEntry,
  MailProviderAdapter,
} from './internal/types';
import { MailError } from './internal/types';
import { store, _newMessageId, _resetStoreForTesting } from './internal/store';
import { resolveProvider, _setProviderForTesting } from './internal/factory';
import { _deliver, _flushQueueForTesting } from './internal/queue';

// Re-export test helpers so tests can import from the public module.
export { _resetStoreForTesting, _setProviderForTesting, _flushQueueForTesting };
export type { OutboxEntry, DeliveryStatus };

// ---------------------------------------------------------------------------
// Public data shapes (per §17)
// ---------------------------------------------------------------------------

export interface SendResultData {
  queued: true;
  messageId: string;
}

export interface DeliveryStatusData {
  messageId: string;
  status: DeliveryStatus;
}

// ---------------------------------------------------------------------------
// Internal: idempotency window
// ---------------------------------------------------------------------------

/** 24 hours in milliseconds. */
const IDEMPOTENCY_WINDOW_MS = 24 * 60 * 60 * 1000;

function _isWithinIdempotencyWindow(createdAt: string): boolean {
  const created = new Date(createdAt).getTime();
  return Date.now() - created < IDEMPOTENCY_WINDOW_MS;
}

// ---------------------------------------------------------------------------
// Internal: email validation (for INVALID_RECIPIENT)
// ---------------------------------------------------------------------------

function _isValidEmail(email: string): boolean {
  // Simple but sufficient: non-empty, has @, has domain with dot.
  return /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email);
}

// ---------------------------------------------------------------------------
// Internal: error wrapping
// ---------------------------------------------------------------------------

function _mailErrorToResponse(err: unknown): StandardResponse<never> {
  if (err instanceof Error && err.name === 'MailError') {
    const code = (err as { code?: string }).code ?? MailErrorCode.INTERNAL_ERROR;
    return fail(code, err.message);
  }
  return fail(MailErrorCode.INTERNAL_ERROR, 'An internal error occurred.');
}

// ---------------------------------------------------------------------------
// Internal: core send logic (shared by all three send functions)
// ---------------------------------------------------------------------------

async function _send(
  workspaceId: string,
  to: string,
  type: MessageType,
  token: string,
  idempotencyKey?: string,
  inviterName?: string,
  workspaceName?: string,
  subject?: string,
  body?: string
): Promise<StandardResponse<SendResultData>> {
  try {
    // 1. Validate workspaceId (required per §17 line 697).
    if (!workspaceId) {
      throw new MailError(MailErrorCode.PROVIDER_NOT_CONFIGURED, 'workspaceId is required.');
    }

    // 2. Validate recipient (INVALID_RECIPIENT per §17).
    if (!to || !_isValidEmail(to)) {
      throw new MailError(MailErrorCode.INVALID_RECIPIENT, 'Invalid recipient email address.');
    }

    // 3. Check idempotency (§17 binding v1 rule).
    if (idempotencyKey) {
      const existing = store.findByIdempotencyKey(workspaceId, idempotencyKey);
      if (existing && _isWithinIdempotencyWindow(existing.createdAt)) {
        // Return original messageId, do NOT send again.
        return ok<SendResultData>({ queued: true, messageId: existing.messageId });
      }
    }

    // 4. Record in outbox (test-only — preserved from provisional stub).
    //
    // The outbox is recorded BEFORE the provider check, matching the
    // provisional stub's behavior (always recorded, even when no provider
    // was configured). The outbox is a test-only helper that records
    // "Mail was asked to send this" — not "Mail successfully queued this."
    // This preserves backward compatibility with existing tests that check
    // the outbox after calling resetPassword (which swallows Mail errors
    // for anti-enumeration per §10.6).
    const now = new Date().toISOString();
    store.recordOutbox({
      type,
      to,
      url: token, // 'url' field name preserved for backward compat with existing tests
      workspaceId,
      status: 'queued',
      queuedAt: now,
    });

    // 5. Check provider configured (PROVIDER_NOT_CONFIGURED per §17).
    const provider = await resolveProvider(workspaceId);
    if (!provider) {
      throw new MailError(
        MailErrorCode.PROVIDER_NOT_CONFIGURED,
        'Mail provider is not configured for this workspace.'
      );
    }

    // 6. Create message record with status 'queued'.
    const messageId = _newMessageId();
    store.insert({
      messageId,
      workspaceId,
      type,
      to,
      token,
      inviterName,
      workspaceName,
      subject,
      body,
      idempotencyKey,
      status: 'queued',
      retryCount: 0,
      createdAt: now,
    });

    // 7. Index idempotency.
    if (idempotencyKey) {
      store.indexIdempotency(workspaceId, idempotencyKey, messageId);
    }

    // 8. Kick off async delivery (NOT awaited — per §17 Reliability Model).
    _deliver(messageId, provider).catch(() => {
      // Errors are handled inside _deliver (updates status to 'failed').
      // This catch is a safety net only.
    });

    // 9. Return immediately with { queued: true, messageId }.
    return ok<SendResultData>({ queued: true, messageId });
  } catch (err) {
    return _mailErrorToResponse(err);
  }
}

// ---------------------------------------------------------------------------
// §17 sendVerificationEmail
// ---------------------------------------------------------------------------

export async function sendVerificationEmail(
  workspaceId: string,
  to: string,
  verificationToken: string,
  idempotencyKey?: string
): Promise<StandardResponse<SendResultData>> {
  return _send(workspaceId, to, 'verification', verificationToken, idempotencyKey);
}

// ---------------------------------------------------------------------------
// §17 sendPasswordResetEmail
// ---------------------------------------------------------------------------

export async function sendPasswordResetEmail(
  workspaceId: string,
  to: string,
  resetToken: string,
  idempotencyKey?: string
): Promise<StandardResponse<SendResultData>> {
  return _send(workspaceId, to, 'password_reset', resetToken, idempotencyKey);
}

// ---------------------------------------------------------------------------
// §17 sendInvitationEmail
// ---------------------------------------------------------------------------

export async function sendInvitationEmail(
  workspaceId: string,
  to: string,
  invitationToken: string,
  inviterName: string,
  workspaceName: string,
  idempotencyKey?: string
): Promise<StandardResponse<SendResultData>> {
  return _send(
    workspaceId,
    to,
    'invitation',
    invitationToken,
    idempotencyKey,
    inviterName,
    workspaceName
  );
}

// ---------------------------------------------------------------------------
// §17 v1.2 — sendEmail(workspaceId, to, subject, body, idempotencyKey?)
//
// Added in v1.2. Unlike the three template-bound functions above, sendEmail
// accepts arbitrary caller-supplied subject and body — Mail performs ZERO
// business templating and ZERO content interpretation for this function.
// Mail still owns provider selection, queue-and-retry, idempotency, and
// delivery tracking exactly as for the other three functions.
//
// Mail validates only: recipient format, required fields present, provider
// payload limits (subject/body length caps). It never validates business
// correctness of the content.
// ---------------------------------------------------------------------------

/** Maximum subject length (provider payload limit). */
const MAX_SUBJECT_LENGTH = 998; // RFC 5321 practical limit
/** Maximum body length (provider payload limit). */
const MAX_BODY_LENGTH = 1_000_000; // 1MB — generous for transactional email

export async function sendEmail(
  workspaceId: string,
  to: string,
  subject: string,
  body: string,
  idempotencyKey?: string
): Promise<StandardResponse<SendResultData>> {
  try {
    // Validate content (INVALID_CONTENT per §17 v1.2).
    if (!subject || typeof subject !== 'string') {
      throw new MailError(MailErrorCode.INVALID_CONTENT, 'subject is required.');
    }
    if (!body || typeof body !== 'string') {
      throw new MailError(MailErrorCode.INVALID_CONTENT, 'body is required.');
    }
    if (subject.length > MAX_SUBJECT_LENGTH) {
      throw new MailError(
        MailErrorCode.INVALID_CONTENT,
        `subject exceeds maximum length of ${MAX_SUBJECT_LENGTH} characters.`
      );
    }
    if (body.length > MAX_BODY_LENGTH) {
      throw new MailError(
        MailErrorCode.INVALID_CONTENT,
        `body exceeds maximum length of ${MAX_BODY_LENGTH} characters.`
      );
    }

    // Delegate to _send with type='generic'. The token is empty (not used
    // for generic emails — subject/body are the content). The provider
    // adapter uses subject/body directly for type='generic' instead of
    // constructing from type+token.
    return _send(workspaceId, to, 'generic', '', idempotencyKey, undefined, undefined, subject, body);
  } catch (err) {
    return _mailErrorToResponse(err);
  }
}

// ---------------------------------------------------------------------------
// §17 getDeliveryStatus
// ---------------------------------------------------------------------------

export async function getDeliveryStatus(
  workspaceId: string,
  messageId: string
): Promise<StandardResponse<DeliveryStatusData>> {
  try {
    if (!workspaceId) {
      throw new MailError(MailErrorCode.MESSAGE_NOT_FOUND, 'workspaceId is required.');
    }
    if (!messageId) {
      throw new MailError(MailErrorCode.MESSAGE_NOT_FOUND, 'messageId is required.');
    }

    // §17 line 683: cross-workspace lookup returns MESSAGE_NOT_FOUND,
    // not the real status. store.getByWorkspace enforces this.
    const record = store.getByWorkspace(messageId, workspaceId);
    if (!record) {
      throw new MailError(MailErrorCode.MESSAGE_NOT_FOUND, 'Message not found.');
    }

    return ok<DeliveryStatusData>({
      messageId: record.messageId,
      status: record.status,
    });
  } catch (err) {
    return _mailErrorToResponse(err);
  }
}


// ---------------------------------------------------------------------------
// v1.3 listMessages (additive dashboard read API)
// ---------------------------------------------------------------------------

export interface ListMessagesData {
  items: { messageId: string; type: MessageType; deliveryStatus: DeliveryStatus; createdAt: string; updatedAt: string }[];
  hasMore: boolean;
  nextCursor: string | null;
}

export async function listMessages(
  workspaceId: string,
  filters?: { type?: MessageType; deliveryStatus?: DeliveryStatus },
  pagination?: { limit?: number; cursor?: string }
): Promise<StandardResponse<ListMessagesData>> {
  try {
    if (!workspaceId) throw new MailError(MailErrorCode.MESSAGE_NOT_FOUND, 'workspaceId is required.');
    let records = store.listByWorkspace(workspaceId);
    if (filters?.type) records = records.filter((r) => r.type === filters.type);
    if (filters?.deliveryStatus) records = records.filter((r) => r.status === filters.deliveryStatus);
    records = records.sort((a, b) => a.createdAt.localeCompare(b.createdAt));
    const start = pagination?.cursor ? Math.max(0, records.findIndex((r) => r.messageId === pagination.cursor) + 1) : 0;
    const limit = pagination?.limit && pagination.limit > 0 ? pagination.limit : records.length || 1;
    const page = records.slice(start, start + limit);
    const hasMore = start + page.length < records.length;
    return ok({
      items: page.map((r) => ({ messageId: r.messageId, type: r.type, deliveryStatus: r.status, createdAt: r.createdAt, updatedAt: r.sentAt ?? r.createdAt })),
      hasMore,
      nextCursor: hasMore && page.length ? page[page.length - 1].messageId : null,
    });
  } catch (err) { return _mailErrorToResponse(err); }
}

// ---------------------------------------------------------------------------
// Test-only outbox accessors (preserved from provisional stub)
// ---------------------------------------------------------------------------

export function _getOutboxForTesting(): OutboxEntry[] {
  return store.getOutbox();
}

export function _clearOutboxForTesting(): void {
  store.clearOutbox();
}

// ---------------------------------------------------------------------------
// Public surface (the ONLY thing other modules may import)
// ---------------------------------------------------------------------------

export const Mail = {
  sendVerificationEmail,
  sendPasswordResetEmail,
  sendInvitationEmail,
  sendEmail, // added in v1.2
  getDeliveryStatus,
  listMessages,
};

export type MailModule = typeof Mail;
