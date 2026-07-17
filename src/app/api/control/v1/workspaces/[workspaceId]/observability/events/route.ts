import { NextRequest } from 'next/server';
import { authorizeWorkspaceRequest } from '@/app/api/_workspace-auth';
import { sendResponse } from '@/app/api/organizations/_helpers';
import { PlatformObservability } from '@/modules/platform-observability';

export async function GET(req: NextRequest, { params }: { params: Promise<{ workspaceId: string }> }) {
  const { workspaceId } = await params;
  const auth = await authorizeWorkspaceRequest(req, workspaceId, { requiredPermission: 'audit:read' });
  if (!auth.ok) return auth.response;
  const before = req.nextUrl.searchParams.get('before') ?? undefined;
  const rawLimit = Number(req.nextUrl.searchParams.get('limit') ?? 30);
  return sendResponse(await PlatformObservability.listAuditEvents(workspaceId, {
    before, limit: Number.isFinite(rawLimit) ? rawLimit : 30,
  }));
}
