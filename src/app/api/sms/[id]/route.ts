/** GET /api/sms/[id]?workspaceId=ws1 — SMS.getSms() */
import { NextRequest } from 'next/server';
import { SMS } from '@/modules/sms';
import { sendResponse } from '../../organizations/_helpers';

export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const url = new URL(req.url);
  const workspaceId = url.searchParams.get('workspaceId') ?? '';
  const r = await SMS.getSms(workspaceId, id);
  return sendResponse(r);
}
