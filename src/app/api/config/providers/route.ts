/** GET /api/config/providers — list all providers across all modules */
import { NextRequest, NextResponse } from 'next/server';
import { Auth } from '@/modules/auth';
import { getAccessToken, sendResponse } from '../../organizations/_helpers';
import { Configuration } from '@/config';

export async function GET(req: NextRequest) {
  const token = getAccessToken(req);
  const session = await Auth.verifySession(token);
  if (!session.success) return sendResponse(session);
  const r = await Configuration.listAllProviders();
  return NextResponse.json(r, { status: r.success ? 200 : 500 });
}
