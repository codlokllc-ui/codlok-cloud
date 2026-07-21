import { NextRequest } from 'next/server';
import { authorizeWorkspaceRequest } from '@/app/api/_workspace-auth';
import { sendResponse } from '@/app/api/organizations/_helpers';
import { PlatformJobs } from '@/platform/jobs';

export async function POST(req: NextRequest, { params }: { params: Promise<{ workspaceId: string; jobId: string }> }) {
  const { workspaceId, jobId } = await params;
  const auth = await authorizeWorkspaceRequest(req, workspaceId, { ownerOnly: true });
  if (!auth.ok) return auth.response;
  const body = await req.json().catch(() => ({})) as { reason?: unknown };
  return sendResponse(await PlatformJobs.replay({
    workspaceId, jobId, actorUserId: auth.userId,
    reason: typeof body.reason === 'string' ? body.reason : '',
  }));
}
