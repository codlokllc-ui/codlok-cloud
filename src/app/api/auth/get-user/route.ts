/** Return only the caller's own identity, resolved from their session. */
import { NextRequest, NextResponse } from 'next/server';
import { Auth } from '@/modules/auth';

export async function POST(req: NextRequest) {
  let body: { accessToken?: string };
  try { body = await req.json(); }
  catch { return NextResponse.json({ success: false, error: { code: 'INVALID_INPUT', message: 'Invalid JSON body.' } }, { status: 400 }); }
  const accessToken = body.accessToken ?? '';
  if (!accessToken) return NextResponse.json({ success: false, error: { code: 'UNAUTHORIZED', message: 'Authentication required.' } }, { status: 401 });
  const session = await Auth.verifySession(accessToken);
  if (!session.success) return NextResponse.json(session, { status: 401 });
  const result = await Auth.getUser(session.data.userId);
  return NextResponse.json(result, { status: result.success ? 200 : 404 });
}
