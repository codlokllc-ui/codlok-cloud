/**
 * Workspace feature flags. Feature flags are runtime behavior toggles only;
 * provider selection is stored through Configuration settings instead.
 */
import { NextRequest, NextResponse } from 'next/server';
import { Configuration } from '@/config';
import { sendResponse } from '../../../organizations/_helpers';
import { authorizeWorkspaceRequest } from '../../../_workspace-auth';

export async function GET(req: NextRequest, { params }: { params: Promise<{ key: string }> }) {
  const { key } = await params;
  const url = new URL(req.url);
  const workspaceId = url.searchParams.get('workspaceId') ?? '';
  const auth = await authorizeWorkspaceRequest(req, workspaceId);
  if (!auth.ok) return auth.response;
  return sendResponse(await Configuration.getFeatureFlag(workspaceId, key));
}

export async function POST(req: NextRequest, { params }: { params: Promise<{ key: string }> }) {
  const { key } = await params;
  let body: { workspaceId?: string; value?: string };
  try { body = await req.json(); }
  catch {
    return NextResponse.json({ success: false, error: { code: 'INVALID_INPUT', message: 'Invalid JSON body.' } }, { status: 400 });
  }
  const workspaceId = body.workspaceId ?? '';
  const auth = await authorizeWorkspaceRequest(req, workspaceId, { ownerOnly: true });
  if (!auth.ok) return auth.response;
  return sendResponse(await Configuration.setFeatureFlag(workspaceId, key, body.value ?? '', auth.userId));
}
