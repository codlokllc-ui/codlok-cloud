/**
 * Codlok Cloud — SMS Module — Provider Adapters (INTERNAL)
 *
 * Per Master Spec §22 line 1149: "Provider adapter(s): Twilio, Termii,
 * Vonage, Africa's Talking (§5/§7) — not all required for v1 freeze."
 *
 * This file is INTERNAL to the SMS module.
 */

import type {
  SmsProviderAdapter,
  ProviderSendInput,
  ProviderSendResult,
  ParsedWebhookEvent,
  SmsStatus,
} from './types';

// ---------------------------------------------------------------------------
// MockSmsProvider — for tests and dev
// ---------------------------------------------------------------------------

/**
 * In-memory provider that simulates Twilio SMS behavior.
 *
 * The mock's webhook payload format:
 *   {
 *     providerEventId: string,
 *     providerMessageId?: string,       // for outbound delivery receipts
 *     providerStatus?: string,          // 'queued'|'sent'|'delivered'|'failed'|'undelivered'
 *     inbound?: { from: string, to: string, body: string }  // for inbound messages
 *   }
 *
 * The adapter normalizes provider statuses:
 *   - queued → 'queued' (no transition needed — already queued)
 *   - sent → 'sent'
 *   - delivered → 'delivered'
 *   - failed/undelivered → 'failed'
 */
export class MockSmsProvider implements SmsProviderAdapter {
  readonly providerName = 'mock';

  /** Records every successful send. */
  public sends: ProviderSendInput[] = [];
  /** Simulate opt-out rejection on next send. */
  public optOutNext = false;
  /** Simulate send failure on next send. */
  public failNext = false;

  async send(input: ProviderSendInput): Promise<ProviderSendResult> {
    if (this.optOutNext) {
      this.optOutNext = false;
      // Simulate Twilio error 21610 — opt-out rejection.
      throw new Error('MOCK_OPTED_OUT: The recipient has opted out');
    }
    if (this.failNext) {
      this.failNext = false;
      throw new Error('MOCK_SEND_FAILURE: simulated provider failure');
    }
    this.sends.push(input);
    return {
      providerMessageId: `SM_mock_${input.smsId}`,
      status: 'sent', // mock immediately succeeds
    };
  }

  parseWebhookEvent(payload: string): ParsedWebhookEvent {
    try {
      const data = JSON.parse(payload) as {
        providerEventId: string;
        providerMessageId?: string;
        providerStatus?: string;
        inbound?: { from: string; to: string; body: string };
      };
      return {
        providerEventId: data.providerEventId,
        providerMessageId: data.providerMessageId,
        transition: this._normalizeStatus(data.providerStatus),
        inbound: data.inbound,
      };
    } catch {
      return { providerEventId: 'unknown' };
    }
  }

  private _normalizeStatus(providerStatus: string | undefined): SmsStatus | undefined {
    if (!providerStatus) return undefined;
    switch (providerStatus) {
      case 'queued': return 'queued';
      case 'sent': return 'sent';
      case 'delivered': return 'delivered';
      case 'failed':
      case 'undelivered': return 'failed';
      default: return undefined;
    }
  }

  reset(): void {
    this.sends = [];
    this.optOutNext = false;
    this.failNext = false;
  }
}

// ---------------------------------------------------------------------------
// TwilioSmsProvider — real Twilio adapter (placeholder for production)
// ---------------------------------------------------------------------------

/**
 * Real Twilio adapter. Uses the Twilio SDK when available.
 *
 * The adapter maps Twilio-specific error codes:
 *   - 21610 (opt-out) → RECIPIENT_OPTED_OUT (normalized by the public boundary)
 *   - Other errors → SEND_FAILED (after retry exhaustion)
 *
 * Twilio webhook status normalization:
 *   - Twilio 'queued' → Codlok 'queued'
 *   - Twilio 'sent' → Codlok 'sent'
 *   - Twilio 'delivered' → Codlok 'delivered'
 *   - Twilio 'failed'/'undelivered' → Codlok 'failed'
 */
export class TwilioSmsProvider implements SmsProviderAdapter {
  readonly providerName = 'twilio';

  constructor(
    private accountSid: string,
    private authToken: string,
    private fromNumber: string
  ) {}

  async send(input: ProviderSendInput): Promise<ProviderSendResult> {
    // Production: use twilio client to send SMS.
    throw new Error('TwilioSmsProvider.send: not implemented in this environment. Use MockSmsProvider.');
  }

  parseWebhookEvent(_payload: string): ParsedWebhookEvent {
    throw new Error('TwilioSmsProvider.parseWebhookEvent: not implemented in this environment.');
  }
}
