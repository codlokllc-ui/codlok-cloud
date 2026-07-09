/**
 * GET /api/mail/outbox
 *
 * Returns Mail module's in-memory outbox (Phase 1 stub). Useful for demo UI
 * to show "what emails would have been sent". Phase 2 Mail will replace this
 * with delivery logs stored in the workspace's own database.
 */
import { NextResponse } from 'next/server';
import { _getOutboxForTesting } from '@/modules/mail';

export async function GET() {
  // Return most-recent-first
  const entries = [..._getOutboxForTesting()].reverse();
  return NextResponse.json({ success: true, data: { entries } });
}
