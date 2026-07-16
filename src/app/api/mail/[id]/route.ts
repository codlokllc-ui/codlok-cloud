/** GET /api/mail/[id]?workspaceId=ws1 — Mail.getDeliveryStatus() */
import { NextRequest } from 'next/server';
import { Mail } from '@/modules/mail';
import { sendResponse } from '../../organizations/_helpers';
import { authorizeWorkspaceRequest } from '@/app/api/_workspace-auth';

export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const url = new URL(req.url);
  const workspaceId = url.searchParams.get('workspaceId') ?? '';
  const auth = await authorizeWorkspaceRequest(req, workspaceId);
  if (!auth.ok) return auth.response;
  const r = await Mail.getDeliveryStatus(workspaceId, id);
  return sendResponse(r);
}
