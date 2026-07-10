/**
 * DELETE /api/organizations/workspaces/[id]/members/[userId]
 *   Removes the member.
 * PATCH  /api/organizations/workspaces/[id]/members/[userId]   Body: { roleId }
 *   Assigns a new role to the member.
 */
import { NextRequest } from 'next/server';
import { Organizations } from '@/modules/organizations';
import { parseBody, getAccessToken, sendResponse } from '../../../../_helpers';

export async function DELETE(
  req: NextRequest,
  { params }: { params: Promise<{ id: string; userId: string }> }
) {
  const { id, userId } = await params;
  const r = await Organizations.removeMember(getAccessToken(req), id, userId);
  return sendResponse(r);
}

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string; userId: string }> }
) {
  const { id, userId } = await params;
  const parsed = await parseBody<{ roleId?: string }>(req);
  if (!parsed.ok) return parsed.response;
  const r = await Organizations.assignRole(
    getAccessToken(req),
    id,
    userId,
    parsed.body.roleId ?? ''
  );
  return sendResponse(r);
}
