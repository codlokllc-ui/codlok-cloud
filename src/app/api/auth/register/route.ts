/**
 * POST /api/auth/register
 * Body: { email, password, workspaceId? }
 *
 * Calls Auth.registerUser() (§10.1). Returns the StandardResponse shape.
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
  const result = await Auth.registerUser(body.email ?? '', body.password ?? '', {
    workspaceId: body.workspaceId,
  });
  return NextResponse.json(result, { status: result.success ? 200 : 400 });
}
