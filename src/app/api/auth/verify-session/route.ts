/**
 * POST /api/auth/verify-session
 * Body: { accessToken, workspaceId? }
 *
 * Calls Auth.verifySession() (§10.5).
 */
import { NextRequest, NextResponse } from 'next/server';
import { Auth } from '@/modules/auth';

export async function POST(req: NextRequest) {
  let body: { accessToken?: string; workspaceId?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json(
      { success: false, error: { code: 'INVALID_INPUT', message: 'Invalid JSON body.' } },
      { status: 400 }
    );
  }
  const result = await Auth.verifySession(body.accessToken ?? '', {
    workspaceId: body.workspaceId,
  });
  return NextResponse.json(result, { status: result.success ? 200 : 401 });
}
