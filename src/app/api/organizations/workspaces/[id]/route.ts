/**
 * GET    /api/organizations/workspaces/[id]
 * PATCH  /api/organizations/workspaces/[id]    Body: { name?, description? }
 * DELETE /api/organizations/workspaces/[id]
 */
import { NextRequest } from 'next/server';
import { Organizations } from '@/modules/organizations';
import { parseBody, getAccessToken, sendResponse } from '../../_helpers';

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const r = await Organizations.getWorkspace(getAccessToken(req), id);
  return sendResponse(r);
}

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const parsed = await parseBody<{ name?: string; description?: string }>(req);
  if (!parsed.ok) return parsed.response;
  const r = await Organizations.updateWorkspace(getAccessToken(req), id, parsed.body);
  return sendResponse(r);
}

export async function DELETE(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const r = await Organizations.deleteWorkspace(getAccessToken(req), id);
  return sendResponse(r);
}
