/**
 * POST /api/organizations/check-permission
 *   Body: { workspaceId, targetUserId, permission }
 *   Header: Authorization: Bearer <accessToken>
 * → Organizations.checkPermission()
 */
import { NextRequest } from 'next/server';
import { Organizations } from '@/modules/organizations';
import { parseBody, getAccessToken, sendResponse } from '../_helpers';

export async function POST(req: NextRequest) {
  const parsed = await parseBody<{
    workspaceId?: string;
    targetUserId?: string;
    permission?: string;
  }>(req);
  if (!parsed.ok) return parsed.response;
  const r = await Organizations.checkPermission(
    getAccessToken(req),
    parsed.body.workspaceId ?? '',
    parsed.body.targetUserId ?? '',
    parsed.body.permission ?? ''
  );
  return sendResponse(r);
}
