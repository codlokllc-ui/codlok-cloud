/**
 * POST /api/auth/get-user
 * Body: { userId }
 * → Auth.getUser(userId)
 */
import { NextRequest, NextResponse } from 'next/server';
import { Auth } from '@/modules/auth';

export async function POST(req: NextRequest) {
  let body: { userId?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json(
      { success: false, error: { code: 'INVALID_INPUT', message: 'Invalid JSON body.' } },
      { status: 400 }
    );
  }
  const result = await Auth.getUser(body.userId ?? '');
  return NextResponse.json(result, { status: result.success ? 200 : 400 });
}
