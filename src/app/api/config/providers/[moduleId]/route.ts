/** GET /api/config/providers/[moduleId] — list providers for a specific module */
import { NextRequest, NextResponse } from 'next/server';
import { Auth } from '@/modules/auth';
import { getAccessToken, sendResponse } from '../../../organizations/_helpers';
import { Configuration } from '@/config';

export async function GET(req: NextRequest, { params }: { params: Promise<{ moduleId: string }> }) {
  const { moduleId } = await params;
  const token = getAccessToken(req);
  const session = await Auth.verifySession(token);
  if (!session.success) return sendResponse(session);
  const r = await Configuration.listProviders(moduleId);
  return NextResponse.json(r, { status: r.success ? 200 : 500 });
}
