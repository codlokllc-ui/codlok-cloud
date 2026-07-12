/**
 * Codlok Cloud — SMS Module — Internal Types (INTERNAL)
 *
 * Per Master Spec §22. This file is internal to the SMS module.
 *
 * Per §22 Recipient Data rule: SMS temporarily stores recipient phone
 * numbers as operational transport data — it needs the number to dispatch,
 * match delivery receipts, and resolve inbound STOP/START/HELP events.
 * SMS is NOT the system of record for phone numbers. Recipient data is
 * excluded from the public SMS record (getSms() never returns it).
 *
 * Per §22 State Machine: queued → sending → sent → (delivered|failed).
 * sent is a RESTING state, not guaranteed-final.
 */

// ---------------------------------------------------------------------------
// Delivery Status State Machine (§22 line 1185 — binding)
// ---------------------------------------------------------------------------
//
//   queued → sending → sent
//                     ↙      ↘
//               delivered   failed
//
// - sent is a RESTING state — may never receive a delivery receipt.
// - delivered and failed are guaranteed-final.
// - A caller should not treat sent as equivalent to "this record will
//   never change" — it may still transition to delivered/failed if a
//   receipt arrives later, or may stay sent forever.

export type SmsStatus = 'queued' | 'sending' | 'sent' | 'delivered' | 'failed';

// ---------------------------------------------------------------------------
// SMS record (the canonical record — NO recipient field per §22 line 1169)
// ---------------------------------------------------------------------------

export interface SmsRecord {
  smsId: string;
  workspaceId: string;
  provider: string;
  providerMessageId?: string;
  status: SmsStatus;
  idempotencyKey: string;
  createdAt: string;
  updatedAt: string;
  sentAt?: string;
  deliveredAt?: string;
  failedAt?: string;
  /**
   * Transient recipient — held internally for dispatch and delivery-receipt
   * matching, NEVER returned by getSms()/listSms() (§22 line 1158).
   */
  _recipient?: string;
  /** Transient message body — held for dispatch, never publicly exposed. */
  _message?: string;
  retryCount: number;
}

// ---------------------------------------------------------------------------
// Inbound event record (§22 line 1199)
// ---------------------------------------------------------------------------

export type InboundKeyword = 'STOP' | 'START' | 'HELP' | 'OTHER';

export interface InboundEventRecord {
  eventId: string;
  workspaceId: string;
  provider: string;
  providerEventId: string;
  smsId?: string; // optional — not every inbound corresponds to an outbound
  keyword: InboundKeyword;
  receivedAt: string;
}

// ---------------------------------------------------------------------------
// Webhook event log (for deduplication — permanent per §22 line 1229)
// ---------------------------------------------------------------------------

export interface WebhookEventRecord {
  provider: string;
  providerEventId: string;
  workspaceId: string;
  processedAt: string;
  smsId?: string;
}

// ---------------------------------------------------------------------------
// Provider adapter interface (internal — abstraction over Twilio, etc.)
// ---------------------------------------------------------------------------

export interface ProviderSendInput {
  to: string;
  message: string;
  smsId: string;
  idempotencyKey: string;
}

export interface ProviderSendResult {
  providerMessageId: string;
  status: 'queued' | 'sent';
}

export interface ParsedWebhookEvent {
  providerEventId: string;
  /** Outbound delivery receipt — provider's message ID to match. */
  providerMessageId?: string;
  /** The status transition to apply (if any). */
  transition?: SmsStatus;
  /** Inbound message data (if this is an inbound webhook). */
  inbound?: {
    from: string;
    to: string;
    body: string;
  };
}

export interface SmsProviderAdapter {
  /** Send an SMS via the provider. Throws on provider failure (retryable). */
  send(input: ProviderSendInput): Promise<ProviderSendResult>;

  /**
   * Parse a webhook payload into a normalized event.
   * The adapter normalizes provider-specific statuses into Codlok-standard
   * SmsStatus values.
   */
  parseWebhookEvent(payload: string): ParsedWebhookEvent;

  /** Provider name for metadata. */
  readonly providerName: string;
}

// ---------------------------------------------------------------------------
// SmsError — internal exception
// ---------------------------------------------------------------------------

export class SmsError extends Error {
  constructor(
    public readonly code: string,
    message: string
  ) {
    super(message);
    this.name = 'SmsError';
  }
}
