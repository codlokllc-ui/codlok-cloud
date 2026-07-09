/**
 * POST /api/auth/refresh
 * Body: { refreshToken, workspaceId? }
 *
 * Calls Auth.refreshSession() (§10.4).
 */
import { NextRequest, NextResponse } from 'next/server';
import { Auth } from '@/modules/auth';

export async function POST(req: NextRequest) {
  let body: { refreshToken?: string; workspaceId?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json(
      { success: false, error: { code: 'INVALID_INPUT', message: 'Invalid JSON body.' } },
      { status: 400 }
    );
  }
  const result = await Auth.refreshSession(body.refreshToken ?? '', {
    workspaceId: body.workspaceId,
  });
  return NextResponse.json(result, { status: result.success ? 200 : 401 });
}
