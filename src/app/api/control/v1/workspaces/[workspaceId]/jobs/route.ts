import { NextRequest } from 'next/server';
import { authorizeWorkspaceRequest } from '@/app/api/_workspace-auth';
import { sendResponse } from '@/app/api/organizations/_helpers';
import { PlatformJobs } from '@/platform/jobs';

export async function GET(req: NextRequest, { params }: { params: Promise<{ workspaceId: string }> }) {
  const { workspaceId } = await params;
  const auth = await authorizeWorkspaceRequest(req, workspaceId, { requiredPermission: 'audit:read' });
  if (!auth.ok) return auth.response;
  return sendResponse(await PlatformJobs.list(workspaceId, req.nextUrl.searchParams.get('status') ?? undefined));
}
