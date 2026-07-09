/**
 * POST /api/auth/change-password
 * Body: { userId, oldPassword, newPassword, workspaceId? }
 *
 * Calls Auth.changePassword() (§10.7).
 */
import { NextRequest, NextResponse } from 'next/server';
import { Auth } from '@/modules/auth';

export async function POST(req: NextRequest) {
  let body: {
    userId?: string;
    oldPassword?: string;
    newPassword?: string;
    workspaceId?: string;
  };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json(
      { success: false, error: { code: 'INVALID_INPUT', message: 'Invalid JSON body.' } },
      { status: 400 }
    );
  }
  const result = await Auth.changePassword(
    body.userId ?? '',
    body.oldPassword ?? '',
    body.newPassword ?? '',
    { workspaceId: body.workspaceId }
  );
  return NextResponse.json(result, { status: result.success ? 200 : 400 });
}
