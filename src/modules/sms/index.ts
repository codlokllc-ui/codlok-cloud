/**
 * Codlok Cloud — SMS Module — Public Interface v1.0
 *
 * Per Master Spec §22 SMS Module Specification v1.0 (STATUS: FROZEN).
 * Spec Version 3.7.
 *
 * Purpose: SMS owns transporting text messages through SMS providers,
 * normalizing provider behavior — it never invents messaging policy.
 *
 * ----------------------------------------------------------------------------
 * PUBLIC INTERFACE (§22 — five functions only, no getDeliveryStatus)
 * ----------------------------------------------------------------------------
 *   sendSms(workspaceId, recipient, message, idempotencyKey)
 *   getSms(workspaceId, smsId)
 *   listSms(workspaceId, filters?)
 *   getProviderStatus(workspaceId)
 *   processWebhook(payload)
 *
 * All return StandardResponse per §3.6.
 *
 * ----------------------------------------------------------------------------
 * RECIPIENT DATA (§22 line 1157 — binding)
 * ----------------------------------------------------------------------------
 * SMS temporarily stores recipient phone numbers as operational transport
 * data — it needs the number to dispatch, match delivery receipts, and
 * resolve inbound STOP/START/HELP events. SMS is NOT the system of record
 * for phone numbers. Recipient data is excluded from the public SMS record
 * (getSms() never returns it). Mirrors Notifications' recipient-data rule.
 *
 * ----------------------------------------------------------------------------
 * IDEMPOTENCY (§22 line 1164 — REQUIRED, permanent)
 * ----------------------------------------------------------------------------
 * idempotencyKey is REQUIRED. Permanent retention (no expiry). Same
 * reasoning as Pay/Verify: real per-channel provider cost.
 *
 * ----------------------------------------------------------------------------
 * DELIVERY STATUS STATE MACHINE (§22 line 1185 — binding)
 * ----------------------------------------------------------------------------
 *   queued → sending → sent
 *                     ↙      ↘
 *               delivered   failed
 *
 * sent is a RESTING state, not guaranteed-final. Not every provider/route
 * sends a delivery receipt. delivered/failed are guaranteed-final.
 *
 * ----------------------------------------------------------------------------
 * ERROR CODE PRECISION (§22 line 1205)
 * ----------------------------------------------------------------------------
 * - SEND_FAILED: only after SMS has exhausted all provider retry attempts.
 * - RECIPIENT_OPTED_OUT: normalized from provider's opt-out rejection
 *   (e.g. Twilio 21610). SMS does not attempt to bypass it.
 * - MESSAGE_TOO_LONG: message exceeds the configured maximum segment limit.
 *   SMS rejects rather than silently splitting.
 *
 * ----------------------------------------------------------------------------
 * WEBHOOK (§22 line 1181)
 * ----------------------------------------------------------------------------
 * processWebhook(payload) — NO workspaceId parameter. SMS resolves workspace
 * context by locating the stored SMS record using providerMessageId (outbound)
 * or destination-number/provider-account matching (inbound). Deduplicated by
 * provider event ID, permanently.
 *
 * ----------------------------------------------------------------------------
 * COMPLIANCE RULE — PROVIDER ENFORCEMENT (§22 line 1210)
 * ----------------------------------------------------------------------------
 * SMS normalizes the provider's opt-out enforcement into RECIPIENT_OPTED_OUT.
 * It does not determine whether a message category is legally exempt from
 * opt-out, and does not attempt to bypass provider-enforced blocking.
 */

import { StandardResponse, ok, fail } from '@/shared';
import { SmsErrorCode } from './internal/errors';
import type {
  SmsRecord,
  SmsStatus,
  InboundKeyword,
  SmsProviderAdapter,
  ParsedWebhookEvent,
} from './internal/types';
import { SmsError } from './internal/types';
import {
  store,
  newSmsId,
  newInboundEventId,
  _resetStoreForTesting,
} from './internal/store';
import { resolveProvider, _setProviderForTesting, _getTestProvider } from './internal/factory';

// Re-export test helpers.
export { _resetStoreForTesting, _setProviderForTesting };

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/**
 * Maximum SMS segment count. A single SMS segment is 160 chars (GSM-7) or
 * 70 chars (UCS-2). For v1, we use a simplified segment cap of 10 segments
 * (1600 chars GSM-7). Messages exceeding this are rejected with
 * MESSAGE_TOO_LONG — no silent splitting (§22 line 1208).
 */
const MAX_SEGMENTS = 10;
const CHARS_PER_SEGMENT_GSM = 160;
const MAX_MESSAGE_LENGTH = MAX_SEGMENTS * CHARS_PER_SEGMENT_GSM; // 1600 chars

/** Maximum provider retry attempts (same as Mail). */
const MAX_RETRIES = 3;

// ---------------------------------------------------------------------------
// Public data shapes (per §22)
// ---------------------------------------------------------------------------

export interface SendSmsData {
  smsId: string;
  provider: string;
  providerMessageId: string;
  status: 'queued';
}

export interface GetSmsData {
  smsId: string;
  provider: string;
  status: SmsStatus;
  createdAt: string;
  updatedAt: string;
  // NO recipient field — per §22 line 1169.
}

export interface ListSmsData {
  items: {
    smsId: string;
    status: SmsStatus;
    createdAt: string;
  }[];
}

export interface GetProviderStatusData {
  providers: {
    twilio: { configured: boolean };
    termii: { configured: boolean };
    vonage: { configured: boolean };
  };
}

export interface ProcessWebhookData {
  processed: boolean;
  eventId: string;
  deduplicated: boolean;
}

// ---------------------------------------------------------------------------
// Internal: error wrapping
// ---------------------------------------------------------------------------

function _smsErrorToResponse(err: unknown): StandardResponse<never> {
  if (err instanceof Error && err.name === 'SmsError') {
    const code = (err as { code?: string }).code ?? SmsErrorCode.INTERNAL_ERROR;
    return fail(code, err.message);
  }
  return fail(SmsErrorCode.INTERNAL_ERROR, 'An internal error occurred.');
}

// ---------------------------------------------------------------------------
// Internal: validation helpers
// ---------------------------------------------------------------------------

function _requireWorkspaceId(workspaceId: string): void {
  if (!workspaceId) {
    throw new SmsError(
      SmsErrorCode.WORKSPACE_NOT_FOUND,
      'workspaceId is required.'
    );
  }
}

function _requireIdempotencyKey(idempotencyKey: string): void {
  if (!idempotencyKey) {
    throw new SmsError(
      SmsErrorCode.IDEMPOTENCY_KEY_REQUIRED,
      'idempotencyKey is required (§22 line 1164).'
    );
  }
}

/**
 * Validate E.164 format: starts with '+', followed by 1-15 digits.
 * No carrier lookup — that's provider intelligence (§22 line 1163).
 */
function _validateE164(recipient: string): void {
  if (!recipient) {
    throw new SmsError(
      SmsErrorCode.INVALID_RECIPIENT,
      'recipient is required.'
    );
  }
  if (!/^\+\d{1,15}$/.test(recipient)) {
    throw new SmsError(
      SmsErrorCode.INVALID_RECIPIENT,
      'recipient must be in E.164 format (e.g. +1234567890).'
    );
  }
}

function _validateMessage(message: string): void {
  if (!message || typeof message !== 'string') {
    throw new SmsError(
      SmsErrorCode.INVALID_CONTENT,
      'message is required.'
    );
  }
  if (message.length > MAX_MESSAGE_LENGTH) {
    throw new SmsError(
      SmsErrorCode.MESSAGE_TOO_LONG,
      `message exceeds maximum length of ${MAX_MESSAGE_LENGTH} characters (${MAX_SEGMENTS} segments). SMS rejects rather than silently splitting.`
    );
  }
}

function _now(): string {
  return new Date().toISOString();
}

// ---------------------------------------------------------------------------
// §22 sendSms
// ---------------------------------------------------------------------------

export async function sendSms(
  workspaceId: string,
  recipient: string,
  message: string,
  idempotencyKey: string
): Promise<StandardResponse<SendSmsData>> {
  try {
    _requireWorkspaceId(workspaceId);
    _requireIdempotencyKey(idempotencyKey);
    _validateE164(recipient);
    _validateMessage(message);

    // Idempotency: permanent retention — duplicate returns original.
    const existing = store.findByIdempotencyKey(workspaceId, idempotencyKey);
    if (existing) {
      return ok<SendSmsData>({
        smsId: existing.smsId,
        provider: existing.provider,
        providerMessageId: existing.providerMessageId ?? '',
        status: 'queued',
      });
    }

    // Resolve provider (PROVIDER_NOT_CONFIGURED if not configured).
    const provider = await resolveProvider(workspaceId);
    if (!provider) {
      throw new SmsError(
        SmsErrorCode.PROVIDER_NOT_CONFIGURED,
        'SMS provider is not configured for this workspace.'
      );
    }

    // Create SMS record in 'queued' state.
    const smsId = newSmsId();
    const now = _now();
    const record: SmsRecord = {
      smsId,
      workspaceId,
      provider: provider.providerName,
      status: 'queued',
      idempotencyKey,
      createdAt: now,
      updatedAt: now,
      _recipient: recipient,    // transient — never returned by getSms()
      _message: message,        // transient — held for dispatch
      retryCount: 0,
    };
    store.insert(record);

    // Attempt to send via provider (with bounded retry).
    store.updateStatus(smsId, 'sending');

    let lastError: string | undefined;
    let sendSucceeded = false;
    let providerMessageId = '';

    for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
      try {
        const result = await provider.send({
          to: recipient,
          message,
          smsId,
          idempotencyKey,
        });
        providerMessageId = result.providerMessageId;
        sendSucceeded = true;
        break;
      } catch (err) {
        lastError = err instanceof Error ? err.message : String(err);

        // Check for opt-out rejection (e.g. Twilio 21610).
        if (/opt.*out|21610/i.test(lastError)) {
          // RECIPIENT_OPTED_OUT — do not retry, do not bypass (§22 line 1210).
          store.updateStatus(smsId, 'failed', {
            failedAt: _now(),
          });
          throw new SmsError(
            SmsErrorCode.RECIPIENT_OPTED_OUT,
            'Recipient has opted out of SMS messages. This is a provider-enforced block that cannot be bypassed from application code.'
          );
        }

        // Retryable failure — continue to next attempt.
        record.retryCount = attempt + 1;
      }
    }

    if (!sendSucceeded) {
      // SEND_FAILED — only after all retry attempts exhausted (§22 line 1206).
      store.updateStatus(smsId, 'failed', {
        failedAt: _now(),
      });
      throw new SmsError(
        SmsErrorCode.SEND_FAILED,
        `SMS send failed after ${MAX_RETRIES} attempts. Last error: ${lastError ?? 'unknown'}.`
      );
    }

    // Send succeeded — transition to 'sent' (resting state, not guaranteed-final).
    store.updateStatus(smsId, 'sent', {
      providerMessageId,
      sentAt: _now(),
    });

    // Index providerMessageId for webhook workspace resolution.
    if (providerMessageId) {
      store.indexProviderMessageId(providerMessageId, smsId);
    }

    // Set up workspace routing for inbound (destination number → workspace).
    // In production, this would be configured per workspace (the workspace's
    // Twilio phone number). For v1, we register the recipient number → workspace
    // so inbound STOP/START/HELP from that number can be resolved.
    // NOTE: This is a simplified routing — production would use the workspace's
    // own Twilio number as the destination, not the recipient's number.
    store.setWorkspaceRouting(recipient, workspaceId);

    return ok<SendSmsData>({
      smsId,
      provider: provider.providerName,
      providerMessageId,
      status: 'queued', // §22 spec says success returns status: "queued"
    });
  } catch (err) {
    return _smsErrorToResponse(err);
  }
}

// ---------------------------------------------------------------------------
// §22 getSms
// ---------------------------------------------------------------------------

export async function getSms(
  workspaceId: string,
  smsId: string
): Promise<StandardResponse<GetSmsData>> {
  try {
    _requireWorkspaceId(workspaceId);
    if (!smsId) {
      throw new SmsError(
        SmsErrorCode.SMS_NOT_FOUND,
        'smsId is required.'
      );
    }

    const record = store.getBySmsIdAndWorkspace(smsId, workspaceId);
    if (!record) {
      throw new SmsError(
        SmsErrorCode.SMS_NOT_FOUND,
        'SMS not found.'
      );
    }

    // NO recipient field in the response — per §22 line 1169.
    return ok<GetSmsData>({
      smsId: record.smsId,
      provider: record.provider,
      status: record.status,
      createdAt: record.createdAt,
      updatedAt: record.updatedAt,
    });
  } catch (err) {
    return _smsErrorToResponse(err);
  }
}

// ---------------------------------------------------------------------------
// §22 listSms
// ---------------------------------------------------------------------------

export async function listSms(
  workspaceId: string,
  filters?: { status?: SmsStatus; dateFrom?: string; dateTo?: string }
): Promise<StandardResponse<ListSmsData>> {
  try {
    _requireWorkspaceId(workspaceId);

    // NO recipient/phone-number filter — SMS doesn't retain recipients as
    // queryable system-of-record data (§22 line 1173).
    const records = store.listByWorkspace(workspaceId, filters);
    return ok<ListSmsData>({
      items: records.map((r) => ({
        smsId: r.smsId,
        status: r.status,
        createdAt: r.createdAt,
      })),
    });
  } catch (err) {
    return _smsErrorToResponse(err);
  }
}

// ---------------------------------------------------------------------------
// §22 getProviderStatus
// ---------------------------------------------------------------------------

export async function getProviderStatus(
  workspaceId: string
): Promise<StandardResponse<GetProviderStatusData>> {
  try {
    _requireWorkspaceId(workspaceId);

    // Check which providers are configured for this workspace.
    let twilioConfigured = false;
    if (process.env.CODELOK_AUTH_USE_MOCK === 'true') {
      twilioConfigured = true;
    } else {
      try {
        const { getConfigurationService } = await import('@/config');
        const config = getConfigurationService();
        const [sidR, tokenR] = await Promise.all([
          config.getSecret(workspaceId, 'TWILIO_ACCOUNT_SID', 'sms'),
          config.getSecret(workspaceId, 'TWILIO_AUTH_TOKEN', 'sms'),
        ]);
        twilioConfigured = sidR.success && tokenR.success;
      } catch {
        twilioConfigured = false;
      }
    }

    return ok<GetProviderStatusData>({
      providers: {
        twilio: { configured: twilioConfigured },
        termii: { configured: false }, // not implemented in v1
        vonage: { configured: false }, // not implemented in v1
      },
    });
  } catch (err) {
    return _smsErrorToResponse(err);
  }
}

// ---------------------------------------------------------------------------
// §22 processWebhook (NO workspaceId parameter — §22 line 1181)
// ---------------------------------------------------------------------------

export async function processWebhook(
  payload: string
): Promise<StandardResponse<ProcessWebhookData>> {
  try {
    // Resolve provider. In production, the payload itself identifies the
    // provider (e.g. Twilio webhook format). For v1, we use the mock provider
    // if available, or try to resolve from the payload.
    //
    // Since we don't have a workspaceId, we need a provider to parse the
    // payload first. We check: (1) test override, (2) dev mock, (3) we
    // can't resolve a real provider without workspaceId — but the payload
    // itself contains a providerMessageId that lets us find the workspace.
    //
    // Strategy: use the mock provider if CODELOK_AUTH_USE_MOCK is set.
    // In production, the HTTP route handler would identify the provider from
    // the webhook URL path (e.g. /api/sms/webhook/twilio) and pass the
    // appropriate provider. For v1, we handle this by trying the dev mock
    // first, then parsing the payload to find a providerMessageId.

    let provider: SmsProviderAdapter | null = null;

    // Try test override (from factory — same one set by _setProviderForTesting).
    const testProvider = _getTestProvider();
    if (testProvider !== null) {
      provider = testProvider;
    } else if (process.env.CODELOK_AUTH_USE_MOCK === 'true') {
      // Dev mock mode — resolveProvider with a dummy workspaceId will return
      // the dev mock provider when CODELOK_AUTH_USE_MOCK is set.
      provider = await resolveProvider('__webhook_dummy__');
    }

    // If no provider available, we can't parse the webhook.
    // In production, the route handler would supply the provider.
    if (!provider) {
      // Fall back to the mock for parsing (the parse logic is provider-agnostic
      // in the mock — it just reads JSON fields). This is a v1 simplification;
      // production would use the route handler's provider identification.
      const { MockSmsProvider } = await import('./internal/provider');
      provider = new MockSmsProvider();
    }

    // Parse the webhook event.
    const event = provider.parseWebhookEvent(payload);

    // Deduplicate by provider event ID (permanent — §22 line 1229).
    if (store.isWebhookProcessed(provider.providerName, event.providerEventId)) {
      return ok({
        processed: false,
        eventId: event.providerEventId,
        deduplicated: true,
      });
    }

    let workspaceId: string | undefined;
    let smsId: string | undefined;

    // Outbound delivery receipt: resolve workspace via providerMessageId lookup.
    if (event.providerMessageId) {
      const record = store.findByProviderMessageId(event.providerMessageId);
      if (record) {
        workspaceId = record.workspaceId;
        smsId = record.smsId;

        // Apply status transition (if valid).
        if (event.transition && _isValidTransition(record.status, event.transition)) {
          store.updateStatus(record.smsId, event.transition, {
            sentAt: event.transition === 'sent' ? _now() : record.sentAt,
            deliveredAt: event.transition === 'delivered' ? _now() : record.deliveredAt,
            failedAt: event.transition === 'failed' ? _now() : record.failedAt,
          });
        }
      }
    }

    // Inbound message (STOP/START/HELP or other): resolve workspace via
    // destination-number/provider-account matching.
    if (event.inbound && !workspaceId) {
      // The 'to' field in an inbound message is the workspace's Twilio number.
      // We resolve workspace via the workspaceRouting index (destination → workspace).
      workspaceId = store.resolveWorkspaceByDestination(event.inbound.to);

      // Detect keyword.
      const keyword = _detectKeyword(event.inbound.body);

      if (workspaceId) {
        // Try to match to an outbound SMS (by from number → recipient).
        // This is simplified — in production, we'd look up by the from number
        // matching a previously-sent recipient.
        // For now, we record the inbound event without a specific smsId.
        store.insertInboundEvent({
          eventId: newInboundEventId(),
          workspaceId,
          provider: provider.providerName,
          providerEventId: event.providerEventId,
          smsId: undefined, // optional — not every inbound is a reply
          keyword,
          receivedAt: _now(),
        });
      }
    }

    // Record the webhook event (for dedup — permanent).
    if (workspaceId) {
      store.recordWebhookEvent({
        provider: provider.providerName,
        providerEventId: event.providerEventId,
        workspaceId,
        processedAt: _now(),
        smsId,
      });
    }

    return ok({
      processed: true,
      eventId: event.providerEventId,
      deduplicated: false,
    });
  } catch (err) {
    return _smsErrorToResponse(err);
  }
}

// ---------------------------------------------------------------------------
// Internal: state machine transition validation
// ---------------------------------------------------------------------------

function _isValidTransition(from: SmsStatus, to: SmsStatus): boolean {
  // §22 line 1185:
  //   queued → sending → sent → (delivered|failed)
  // sent is a resting state — can transition to delivered/failed later.
  const validTransitions: Record<SmsStatus, SmsStatus[]> = {
    queued: ['sending', 'sent', 'failed'],
    sending: ['sent', 'failed'],
    sent: ['delivered', 'failed'],
    delivered: [], // guaranteed-final
    failed: [],     // guaranteed-final
  };
  return validTransitions[from]?.includes(to) ?? false;
}

// ---------------------------------------------------------------------------
// Internal: keyword detection for inbound SMS (STOP/START/HELP)
// ---------------------------------------------------------------------------

function _detectKeyword(body: string): InboundKeyword {
  const upper = body.trim().toUpperCase();
  if (upper === 'STOP' || upper === 'UNSUBSCRIBE' || upper === 'CANCEL' || upper === 'END') {
    return 'STOP';
  }
  if (upper === 'START' || upper === 'YES' || upper === 'UNSTOP') {
    return 'START';
  }
  if (upper === 'HELP' || upper === 'INFO') {
    return 'HELP';
  }
  return 'OTHER';
}

// ---------------------------------------------------------------------------
// Public surface (the ONLY thing other modules may import)
// ---------------------------------------------------------------------------

export const SMS = {
  sendSms,
  getSms,
  listSms,
  getProviderStatus,
  processWebhook,
};

export type SmsModule = typeof SMS;
