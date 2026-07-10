/**
 * GET  /api/organizations/workspaces/[id]/members
 * POST /api/organizations/workspaces/[id]/members   Body: { targetUserId, roleId }
 */
import { NextRequest } from 'next/server';
import { Organizations } from '@/modules/organizations';
import { parseBody, getAccessToken, sendResponse } from '../../../_helpers';

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const r = await Organizations.listMembers(getAccessToken(req), id);
  return sendResponse(r);
}

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const parsed = await parseBody<{ targetUserId?: string; roleId?: string }>(req);
  if (!parsed.ok) return parsed.response;
  const r = await Organizations.addMember(
    getAccessToken(req),
    id,
    parsed.body.targetUserId ?? '',
    parsed.body.roleId ?? ''
  );
  return sendResponse(r);
}
