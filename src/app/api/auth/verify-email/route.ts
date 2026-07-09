/**
 * POST /api/auth/verify-email
 * Body: { token, workspaceId? }
 *
 * Calls Auth.verifyEmail() (§10.8).
 */
import { NextRequest, NextResponse } from 'next/server';
import { Auth } from '@/modules/auth';

export async function POST(req: NextRequest) {
  let body: { token?: string; workspaceId?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json(
      { success: false, error: { code: 'INVALID_INPUT', message: 'Invalid JSON body.' } },
      { status: 400 }
    );
  }
  const result = await Auth.verifyEmail(body.token ?? '', {
    workspaceId: body.workspaceId,
  });
  return NextResponse.json(result, { status: result.success ? 200 : 400 });
}
