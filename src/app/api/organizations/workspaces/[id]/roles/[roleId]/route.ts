/**
 * PATCH  /api/organizations/workspaces/[id]/roles/[roleId]   Body: { name?, description?, permissions? }
 * DELETE /api/organizations/workspaces/[id]/roles/[roleId]
 */
import { NextRequest } from 'next/server';
import { Organizations } from '@/modules/organizations';
import { parseBody, getAccessToken, sendResponse } from '../../../../_helpers';

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string; roleId: string }> }
) {
  const { id, roleId } = await params;
  const parsed = await parseBody<{
    name?: string;
    description?: string;
    permissions?: string[];
  }>(req);
  if (!parsed.ok) return parsed.response;
  const r = await Organizations.updateRole(getAccessToken(req), id, roleId, parsed.body);
  return sendResponse(r);
}

export async function DELETE(
  req: NextRequest,
  { params }: { params: Promise<{ id: string; roleId: string }> }
) {
  const { id, roleId } = await params;
  const r = await Organizations.deleteRole(getAccessToken(req), id, roleId);
  return sendResponse(r);
}
