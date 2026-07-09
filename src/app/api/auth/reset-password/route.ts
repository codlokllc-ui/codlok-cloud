/**
 * POST /api/auth/reset-password
 * Body: { email, workspaceId? }
 *
 * Calls Auth.resetPassword() (§10.6). Always returns { sent: true } —
 * anti-enumeration per §10.6.
 */
import { NextRequest, NextResponse } from 'next/server';
import { Auth } from '@/modules/auth';

export async function POST(req: NextRequest) {
  let body: { email?: string; workspaceId?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json(
      { success: false, error: { code: 'INVALID_INPUT', message: 'Invalid JSON body.' } },
      { status: 400 }
    );
  }
  // Per §10.6, this always returns sent:true regardless of whether email exists.
  const result = await Auth.resetPassword(body.email ?? '', {
    workspaceId: body.workspaceId,
  });
  return NextResponse.json(result, { status: 200 });
}
