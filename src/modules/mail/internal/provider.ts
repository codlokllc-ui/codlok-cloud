/**
 * Codlok Cloud — Mail Module — Provider Adapters (INTERNAL)
 *
 * Per Master Spec §17: Resend is the primary provider for v1. SES, Mailgun,
 * SMTP are future-supported (§5) — not required for v1 freeze.
 *
 * Per §17 line 693: "Callers never see a provider-specific error — only
 * PROVIDER_NOT_CONFIGURED or INVALID_RECIPIENT." Provider failures (network
 * errors, 5xx, rate limits) are caught by the queue worker and retried;
 * they NEVER surface to callers.
 *
 * Per §17 line 700: "Mail calls Configuration.getSecret(workspaceId, key)
 * for provider credentials (e.g. Resend API key). Mail calls no other module."
 *
 * This file is INTERNAL to the Mail module.
 */

import type { MailProviderAdapter, ProviderSendInput, ProviderSendResult } from './types';

// ---------------------------------------------------------------------------
// ResendAdapter — real Resend API integration
// ---------------------------------------------------------------------------

/**
 * Sends email via the Resend REST API.
 *
 * Per §17 line 659: "Provider adapter(s): Resend (primary)." The adapter
 * constructs the email body from the caller-provided token (which is
 * actually a URL — see §17 line 675 and the Build Report's "no business
 * logic migration" documentation). Mail owns the email template; the caller
 * owns the URL/token.
 */
export class ResendAdapter implements MailProviderAdapter {
  constructor(private apiKey: string) {}

  async send(input: ProviderSendInput): Promise<ProviderSendResult> {
    const response = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${this.apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        from: this._from(input),
        to: [input.to],
        subject: this._subject(input),
        html: this._html(input),
      }),
    });

    if (!response.ok) {
      const text = await response.text().catch(() => '');
      // Provider failure — the queue worker will catch this and retry.
      // Never surfaces to caller per §17 line 693.
      throw new Error(`Resend API error: ${response.status} ${text}`);
    }

    return { status: 'sent' };
  }

  private _from(_input: ProviderSendInput): string {
    // In production, this would be workspace-branded. For v1, use Resend's
    // default onboarding sender (workspace branding is a future concern).
    return 'Codlok Cloud <onboarding@resend.dev>';
  }

  private _subject(input: ProviderSendInput): string {
    switch (input.type) {
      case 'verification':
        return 'Verify your email';
      case 'password_reset':
        return 'Reset your password';
      case 'invitation':
        return `Invitation to join ${input.workspaceName ?? 'workspace'}`;
    }
  }

  private _html(input: ProviderSendInput): string {
    const link = `<a href="${input.token}">${input.token}</a>`;
    switch (input.type) {
      case 'verification':
        return `<p>Verify your email by clicking the link below:</p><p>${link}</p>`;
      case 'password_reset':
        return `<p>Reset your password by clicking the link below:</p><p>${link}</p>`;
      case 'invitation': {
        const inviter = input.inviterName
          ? `<p>${input.inviterName} has invited you to join ${input.workspaceName ?? 'a workspace'}.</p>`
          : `<p>You've been invited to join ${input.workspaceName ?? 'a workspace'}.</p>`;
        return `${inviter}<p>Click the link below to accept:</p><p>${link}</p>`;
      }
    }
  }
}

// ---------------------------------------------------------------------------
// MockMailProvider — for tests and dev (when no real Resend key is configured)
// ---------------------------------------------------------------------------

/**
 * Records all sends without making network calls. Can be configured to fail
 * N times before succeeding (for retry testing).
 *
 * NEVER used in production — only injected via _setProviderForTesting.
 */
export class MockMailProvider implements MailProviderAdapter {
  /** Records every successful send. */
  public sends: ProviderSendInput[] = [];
  /** Number of consecutive failures to simulate before succeeding. */
  public failCount = 0;
  /** Whether to simulate a bounce on the next send. */
  public bounceNext = false;

  async send(input: ProviderSendInput): Promise<ProviderSendResult> {
    if (this.failCount > 0) {
      this.failCount--;
      throw new Error('MockMailProvider: simulated provider failure');
    }
    if (this.bounceNext) {
      this.bounceNext = false;
      this.sends.push(input);
      return { status: 'bounced' };
    }
    this.sends.push(input);
    return { status: 'sent' };
  }

  /** Test helper: reset the mock's state. */
  reset(): void {
    this.sends = [];
    this.failCount = 0;
    this.bounceNext = false;
  }
}
