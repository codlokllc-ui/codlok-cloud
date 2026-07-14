/** GET /api/verify/[id]?workspaceId=ws1 — Verify.getVerificationStatus() */
import { NextRequest } from 'next/server';
import { Verify } from '@/modules/verify';
import { sendResponse } from '../../organizations/_helpers';

export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const url = new URL(req.url);
  const workspaceId = url.searchParams.get('workspaceId') ?? '';
  const r = await Verify.getVerificationStatus(workspaceId, id);
  return sendResponse(r);
}
