/**
 * Codlok Cloud — Mail Module — Queue & Retry (INTERNAL)
 *
 * Per §17 Reliability Model (lines 688-694):
 *   - Public functions return quickly with { queued: true, messageId }.
 *   - Internally, Mail queues the send and retries on provider failure
 *     (exponential backoff, bounded retry count) without the caller knowing.
 *   - Callers never see a provider-specific error — only PROVIDER_NOT_CONFIGURED
 *     or INVALID_RECIPIENT.
 *
 * This file is INTERNAL to the Mail module.
 */

import type { MailProviderAdapter } from './types';
import { store } from './store';

// ---------------------------------------------------------------------------
// Retry configuration
// ---------------------------------------------------------------------------

/** Maximum delivery attempts (1 initial + 3 retries = 4 total). */
export const MAX_RETRIES = 3;

/**
 * Exponential backoff base in milliseconds. In test mode (NODE_ENV=test),
 * delays are 0 to keep tests fast. In production: 2s, 4s, 8s.
 */
function _backoffMs(attempt: number): number {
  if (process.env.NODE_ENV === 'test') return 0;
  return Math.pow(2, attempt) * 1000;
}

// ---------------------------------------------------------------------------
// In-flight tracking (for test flushing)
// ---------------------------------------------------------------------------

const _inFlight = new Set<Promise<void>>();

/**
 * Deliver a queued message. Retries on provider failure with exponential
 * backoff up to MAX_RETRIES. Updates the message status in the store.
 *
 * This function is NOT awaited by the public interface — it runs
 * asynchronously after the caller has already received { queued: true, messageId }.
 */
export function _deliver(
  messageId: string,
  provider: MailProviderAdapter
): Promise<void> {
  let p: Promise<void>;
  p = (async () => {
    try {
      await _deliverInner(messageId, provider);
    } finally {
      _inFlight.delete(p!);
    }
  })();
  _inFlight.add(p);
  return p;
}

async function _deliverInner(
  messageId: string,
  provider: MailProviderAdapter
): Promise<void> {
  const record = store.get(messageId);
  if (!record) return;

  for (let attempt = record.retryCount; attempt < MAX_RETRIES; attempt++) {
    try {
      const result = await provider.send({
        to: record.to,
        type: record.type,
        token: record.token,
        inviterName: record.inviterName,
        workspaceName: record.workspaceName,
      });

      if (result.status === 'bounced') {
        store.updateStatus(messageId, 'bounced', {
          sentAt: new Date().toISOString(),
        });
      } else {
        store.updateStatus(messageId, 'sent', {
          sentAt: new Date().toISOString(),
        });
        // Simulate 'delivered' — in production, this would come from a
        // provider webhook. For v1, we mark delivered immediately after sent.
        store.updateStatus(messageId, 'delivered', {
          deliveredAt: new Date().toISOString(),
        });
      }
      return;
    } catch (err) {
      // Provider failure — retry per §17 Reliability Model.
      store.incrementRetry(messageId);
      const lastError = err instanceof Error ? err.message : String(err);
      store.updateStatus(messageId, 'queued', { lastError });

      // Wait before retrying (0ms in test mode).
      const delay = _backoffMs(attempt);
      if (delay > 0) {
        await new Promise((resolve) => setTimeout(resolve, delay));
      }
    }
  }

  // Max retries exhausted.
  store.updateStatus(messageId, 'failed', {
    failedAt: new Date().toISOString(),
  });
}

/**
 * Test-only: wait for all in-flight deliveries to complete.
 * This lets tests assert on final delivery status without flaky timing.
 */
export async function _flushQueueForTesting(): Promise<void> {
  while (_inFlight.size > 0) {
    await Promise.all([..._inFlight]);
  }
}
