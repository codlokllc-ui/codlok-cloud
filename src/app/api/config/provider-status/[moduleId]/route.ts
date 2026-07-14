/** GET /api/config/provider-status/[moduleId]?workspaceId=ws1 — Configuration.getProviderStatus() */
import { NextRequest } from 'next/server';
import { Configuration } from '@/config';
import { sendResponse } from '../../../organizations/_helpers';

export async function GET(req: NextRequest, { params }: { params: Promise<{ moduleId: string }> }) {
  const { moduleId } = await params;
  const url = new URL(req.url);
  const workspaceId = url.searchParams.get('workspaceId') ?? '';
  const r = await Configuration.getProviderStatus(workspaceId, moduleId);
  return sendResponse(r);
}
