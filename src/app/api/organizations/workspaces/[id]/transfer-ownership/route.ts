/**
 * POST /api/organizations/workspaces/[id]/transfer-ownership
 *   Body: { targetUserId, confirm: boolean }
 */
import { NextRequest } from 'next/server';
import { Organizations } from '@/modules/organizations';
import { parseBody, getAccessToken, sendResponse } from '../../../_helpers';

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const parsed = await parseBody<{ targetUserId?: string; confirm?: boolean }>(req);
  if (!parsed.ok) return parsed.response;
  const r = await Organizations.transferOwnership(
    getAccessToken(req),
    id,
    parsed.body.targetUserId ?? '',
    parsed.body.confirm === true
  );
  return sendResponse(r);
}
