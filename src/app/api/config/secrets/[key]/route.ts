/**
 * DELETE /api/config/secrets/[key]?workspaceId=ws1
 * → Configuration.deleteSecret(workspaceId, key, actorUserId)
 */
import { NextRequest, NextResponse } from 'next/server';
import { Configuration } from '@/config';
import { getAccessToken, sendResponse } from '../../../organizations/_helpers';

export async function DELETE(req: NextRequest, { params }: { params: Promise<{ key: string }> }) {
  const { key } = await params;
  const url = new URL(req.url);
  const workspaceId = url.searchParams.get('workspaceId') ?? '';
  const accessToken = getAccessToken(req);
  const r = await Configuration.deleteSecret(workspaceId, key, accessToken || 'dashboard');
  return sendResponse(r);
}
