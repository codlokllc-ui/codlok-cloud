/** GET /api/verify/[id]?workspaceId=ws1 — Verify.getVerificationStatus() */
import { NextRequest } from 'next/server';
import { Verify } from '@/modules/verify';
import { sendResponse } from '../../organizations/_helpers';
import { authorizeWorkspaceRequest } from '@/app/api/_workspace-auth';

export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const url = new URL(req.url);
  const workspaceId = url.searchParams.get('workspaceId') ?? '';
  const auth = await authorizeWorkspaceRequest(req, workspaceId);
  if (!auth.ok) return auth.response;
  const r = await Verify.getVerificationStatus(workspaceId, id);
  return sendResponse(r);
}
