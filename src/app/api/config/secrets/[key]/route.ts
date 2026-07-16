/**
 * DELETE /api/config/secrets/[key]?workspaceId=ws1
 * → Configuration.deleteSecret(workspaceId, key, actorUserId)
 */
import { NextRequest, NextResponse } from 'next/server';
import { Configuration } from '@/config';
import { sendResponse } from '../../../organizations/_helpers';
import { authorizeWorkspaceRequest } from '@/app/api/_workspace-auth';

export async function DELETE(req: NextRequest, { params }: { params: Promise<{ key: string }> }) {
  const { key } = await params;
  const url = new URL(req.url);
  const workspaceId = url.searchParams.get('workspaceId') ?? '';
  const auth = await authorizeWorkspaceRequest(req, workspaceId, { ownerOnly: true });
  if (!auth.ok) return auth.response;
  const r = await Configuration.deleteSecret(workspaceId, key, auth.userId);
  return sendResponse(r);
}
