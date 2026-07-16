/** GET /api/config/provider-status/[moduleId]?workspaceId=ws1 — Configuration.getProviderStatus() */
import { NextRequest } from 'next/server';
import { Configuration } from '@/config';
import { sendResponse } from '../../../organizations/_helpers';
import { authorizeWorkspaceRequest } from '@/app/api/_workspace-auth';

export async function GET(req: NextRequest, { params }: { params: Promise<{ moduleId: string }> }) {
  const { moduleId } = await params;
  const url = new URL(req.url);
  const workspaceId = url.searchParams.get('workspaceId') ?? '';
  const auth = await authorizeWorkspaceRequest(req, workspaceId);
  if (!auth.ok) return auth.response;
  const r = await Configuration.getProviderStatus(workspaceId, moduleId);
  return sendResponse(r);
}
