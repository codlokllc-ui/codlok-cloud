/**
 * Codlok Cloud — Mail Module — Internal Types (INTERNAL)
 *
 * Per Master Spec §17. This file is internal to the Mail module.
 * Only `src/modules/mail/index.ts` (the public interface) imports from here.
 */

// ---------------------------------------------------------------------------
// Message types
// ---------------------------------------------------------------------------

export type MessageType = 'verification' | 'password_reset' | 'invitation';

export type DeliveryStatus =
  | 'queued'
  | 'sent'
  | 'delivered'
  | 'failed'
  | 'bounced';

export interface MessageRecord {
  /** Unique message identifier (returned to caller as messageId). */
  messageId: string;
  /** Workspace scope (required per §17 line 697). */
  workspaceId: string;
  type: MessageType;
  to: string;
  /**
   * The clickable credential passed by the caller. Per §17, this is called
   * "verificationToken" / "resetToken" / "invitationToken" in the public
   * interface. In practice, callers (Auth, Organizations) pass the same URL
   * strings they constructed for the provisional stub — naming change only,
   * no semantic change. Mail does not construct URLs or tokens; it receives
   * and delivers whatever the caller already built.
   */
  token: string;
  /** For invitation emails only. */
  inviterName?: string;
  /** For invitation emails only. */
  workspaceName?: string;
  /** Optional idempotency key (§17 binding v1 rule). */
  idempotencyKey?: string;
  status: DeliveryStatus;
  retryCount: number;
  createdAt: string;
  sentAt?: string;
  deliveredAt?: string;
  failedAt?: string;
  lastError?: string;
}

// ---------------------------------------------------------------------------
// Outbox (test-only — preserved from provisional stub for test inspection)
// ---------------------------------------------------------------------------

export interface OutboxEntry {
  id: string;
  type: MessageType;
  to: string;
  /** The token/URL passed by the caller. Preserved for backward compat. */
  url: string;
  workspaceId?: string;
  sentAt: string;
  /** Added in v1.0 — the §17 messageId. */
  messageId?: string;
  /** Added in v1.0 — current delivery status. */
  status?: DeliveryStatus;
  /** Added in v1.0 — when the message was queued. */
  queuedAt?: string;
}

// ---------------------------------------------------------------------------
// Provider adapter interface (internal — abstraction over Resend, SES, etc.)
// ---------------------------------------------------------------------------

export interface ProviderSendInput {
  to: string;
  type: MessageType;
  token: string;
  inviterName?: string;
  workspaceName?: string;
}

export interface ProviderSendResult {
  /** 'sent' = provider accepted; 'bounced' = recipient rejected. */
  status: 'sent' | 'bounced';
}

export interface MailProviderAdapter {
  /**
   * Send an email via the provider. Throws on provider failure (network
   * error, 5xx, rate limit) — the queue worker catches and retries.
   * Returns { status: 'bounced' } for soft bounces (not an error).
   */
  send(input: ProviderSendInput): Promise<ProviderSendResult>;
}

// ---------------------------------------------------------------------------
// MailError — internal exception
// ---------------------------------------------------------------------------

export class MailError extends Error {
  constructor(
    public readonly code: string,
    message: string
  ) {
    super(message);
    this.name = 'MailError';
  }
}
