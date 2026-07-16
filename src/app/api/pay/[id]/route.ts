/** GET /api/pay/[id]?workspaceId=ws1 — Pay.getPayment() */
import { NextRequest } from 'next/server';
import { Pay } from '@/modules/pay';
import { sendResponse } from '../../organizations/_helpers';
import { authorizeWorkspaceRequest } from '@/app/api/_workspace-auth';

export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const url = new URL(req.url);
  const workspaceId = url.searchParams.get('workspaceId') ?? '';
  const auth = await authorizeWorkspaceRequest(req, workspaceId);
  if (!auth.ok) return auth.response;
  const r = await Pay.getPayment(workspaceId, id);
  return sendResponse(r);
}
