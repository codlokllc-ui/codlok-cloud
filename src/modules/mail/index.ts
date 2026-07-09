/**
 * Codlok Cloud — Mail Module (BOUNDARY-LEVEL STUB)
 *
 * Per Master Spec §9, Mail is boundary-level only until Phase 2. Full spec
 * (templates, retry, queue, delivery logs, provider fallback Resend → SES) is
 * NOT yet defined. However, Auth (Phase 1) depends on two Mail public
 * functions per §10:
 *
 *   - Mail.sendVerificationEmail()
 *   - Mail.sendPasswordResetEmail()
 *
 * This file defines the MINIMUM public interface Auth needs, with a stub
 * implementation that:
 *   - Logs the email to console (so demo UI shows what would be sent)
 *   - Records to an in-memory outbox (so tests can verify Mail was called)
 *
 * When Mail is fully built in Phase 2, this file will be replaced with the
 * real implementation (Resend adapter + queue + retry + delivery logs).
 * The PUBLIC INTERFACE (function names + signatures + StandardResponse shape)
 * will remain stable per §11 Module Specification Template, so Auth will not
 * need to change.
 *
 * NOTE: The exact `data` shape for these functions is not yet specified
 * (Mail is boundary-level). The shape used here is the minimum required by
 * Auth's needs. The Phase 2 Mail specification will freeze this shape.
 */

import { StandardResponse, ok, fail } from '@/shared';

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

export interface VerificationEmailInput {
  to: string;
  verificationUrl: string;
  /** Per §10 "Workspace Context": branding / template selection only. */
  workspaceId?: string;
}

export interface PasswordResetEmailInput {
  to: string;
  resetUrl: string;
  /** Per §10 "Workspace Context": branding / template selection only. */
  workspaceId?: string;
}

export interface InvitationEmailInput {
  to: string;
  inviteUrl: string;
  inviterName?: string;
  workspaceName?: string;
  workspaceId?: string;
}

// Per §3.6 — success `data` shape must be defined. For Mail, "data" is a
// delivery receipt. Phase 2 will add messageId, provider, queuedAt, etc.
export interface MailDeliveryReceipt {
  sent: true;
  /** Stub mode: 'stub'. Phase 2: 'resend' | 'ses' | 'mailgun' | 'smtp'. */
  provider: string;
  /** ISO timestamp. */
  sentAt: string;
}

// ---------------------------------------------------------------------------
// In-memory outbox (for tests + demo UI). Phase 2 will replace with delivery
// logs in the workspace's own database.
//
// NOTE: stored on `globalThis` so that all module instances in the Next.js
// dev-server (which may load `src/modules/mail` more than once for different
// route handlers) share the same outbox. Without this, the demo UI's
// `/api/mail/outbox` route would not see entries written by the Auth module.
// In production builds, module identity is stable and this is a no-op.
// ---------------------------------------------------------------------------

export interface OutboxEntry {
  id: string;
  type: 'verification' | 'password_reset' | 'invitation';
  to: string;
  url: string;
  workspaceId?: string;
  sentAt: string;
}

const _OUTBOX_KEY = Symbol.for('codlok.mail.outbox');

function _getOutbox(): OutboxEntry[] {
  if (!(globalThis as Record<symbol, unknown>)[_OUTBOX_KEY]) {
    (globalThis as Record<symbol, unknown>)[_OUTBOX_KEY] = [];
  }
  return (globalThis as Record<symbol, unknown>)[_OUTBOX_KEY] as OutboxEntry[];
}

export function _getOutboxForTesting(): OutboxEntry[] {
  return _getOutbox();
}

export function _clearOutboxForTesting(): void {
  _getOutbox().length = 0;
}

function _record(entry: Omit<OutboxEntry, 'id' | 'sentAt'>): OutboxEntry {
  const outbox = _getOutbox();
  const full: OutboxEntry = {
    ...entry,
    id: `mail_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`,
    sentAt: new Date().toISOString(),
  };
  outbox.push(full);
  // Keep outbox bounded.
  if (outbox.length > 200) outbox.shift();
  console.log(`[Mail.stub] → ${entry.type} to ${entry.to} (${entry.url})`);
  return full;
}

// ---------------------------------------------------------------------------
// Public Interface (the only thing other modules may call)
// ---------------------------------------------------------------------------

export async function sendVerificationEmail(
  input: VerificationEmailInput
): Promise<StandardResponse<MailDeliveryReceipt>> {
  if (!input.to || !input.verificationUrl) {
    return fail('INVALID_INPUT', 'to and verificationUrl are required.');
  }
  const entry = _record({
    type: 'verification',
    to: input.to,
    url: input.verificationUrl,
    workspaceId: input.workspaceId,
  });
  return ok({
    sent: true,
    provider: 'stub',
    sentAt: entry.sentAt,
  });
}

export async function sendPasswordResetEmail(
  input: PasswordResetEmailInput
): Promise<StandardResponse<MailDeliveryReceipt>> {
  if (!input.to || !input.resetUrl) {
    return fail('INVALID_INPUT', 'to and resetUrl are required.');
  }
  const entry = _record({
    type: 'password_reset',
    to: input.to,
    url: input.resetUrl,
    workspaceId: input.workspaceId,
  });
  return ok({
    sent: true,
    provider: 'stub',
    sentAt: entry.sentAt,
  });
}

// Also exposed because §12 Organizations (next after Auth) will need it.
// Provided here to keep the Mail boundary stable when Organizations is built.
export async function sendInvitationEmail(
  input: InvitationEmailInput
): Promise<StandardResponse<MailDeliveryReceipt>> {
  if (!input.to || !input.inviteUrl) {
    return fail('INVALID_INPUT', 'to and inviteUrl are required.');
  }
  const entry = _record({
    type: 'invitation',
    to: input.to,
    url: input.inviteUrl,
    workspaceId: input.workspaceId,
  });
  return ok({
    sent: true,
    provider: 'stub',
    sentAt: entry.sentAt,
  });
}

// ---------------------------------------------------------------------------
// Public surface (re-exported for module imports)
// ---------------------------------------------------------------------------

export const Mail = {
  sendVerificationEmail,
  sendPasswordResetEmail,
  sendInvitationEmail,
};

export type MailModule = typeof Mail;
