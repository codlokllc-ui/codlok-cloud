/**
 * POST /api/organizations/invitations/decline   Body: { token }
 */
import { NextRequest } from 'next/server';
import { Organizations } from '@/modules/organizations';
import { parseBody, getAccessToken, sendResponse } from '../../_helpers';

export async function POST(req: NextRequest) {
  const parsed = await parseBody<{ token?: string }>(req);
  if (!parsed.ok) return parsed.response;
  const r = await Organizations.declineInvitation(getAccessToken(req), parsed.body.token ?? '');
  return sendResponse(r);
}
