/** Development-only Mail outbox helper. Never available in production. */
import { NextResponse } from 'next/server';
import { _getOutboxForTesting } from '@/modules/mail';

export async function GET() {
  const allowed = process.env.CODELOK_AUTH_USE_MOCK === 'true' && process.env.NODE_ENV !== 'production';
  if (!allowed) {
    return NextResponse.json(
      { success: false, error: { code: 'NOT_FOUND', message: 'Development helper is unavailable.' } },
      { status: 404 }
    );
  }
  return NextResponse.json({ success: true, data: { entries: [..._getOutboxForTesting()].reverse() } });
}
