/**
 * GET  /api/organizations/workspaces/[id]/invitations
 * POST /api/organizations/workspaces/[id]/invitations   Body: { inviteeUserId, roleId }
 */
import { NextRequest } from 'next/server';
import { Organizations } from '@/modules/organizations';
import { parseBody, getAccessToken, sendResponse } from '../../../_helpers';

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const r = await Organizations.listInvitations(getAccessToken(req), id);
  return sendResponse(r);
}

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const parsed = await parseBody<{ inviteeUserId?: string; roleId?: string }>(req);
  if (!parsed.ok) return parsed.response;
  const r = await Organizations.inviteMember(
    getAccessToken(req),
    id,
    parsed.body.inviteeUserId ?? '',
    parsed.body.roleId ?? ''
  );
  return sendResponse(r);
}
