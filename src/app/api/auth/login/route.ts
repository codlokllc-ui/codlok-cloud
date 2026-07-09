/**
 * POST /api/auth/login
 * Body: { email, password, workspaceId? }
 *
 * Calls Auth.loginUser() (§10.2). Returns the StandardResponse shape.
 */
import { NextRequest, NextResponse } from 'next/server';
import { Auth } from '@/modules/auth';

export async function POST(req: NextRequest) {
  let body: { email?: string; password?: string; workspaceId?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json(
      { success: false, error: { code: 'INVALID_INPUT', message: 'Invalid JSON body.' } },
      { status: 400 }
    );
  }
  const result = await Auth.loginUser(body.email ?? '', body.password ?? '', {
    workspaceId: body.workspaceId,
  });
  return NextResponse.json(result, { status: result.success ? 200 : 401 });
}
