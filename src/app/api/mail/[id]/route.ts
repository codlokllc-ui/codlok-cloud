/** GET /api/mail/[id]?workspaceId=ws1 — Mail.getDeliveryStatus() */
import { NextRequest } from 'next/server';
import { Mail } from '@/modules/mail';
import { sendResponse } from '../../organizations/_helpers';

export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const url = new URL(req.url);
  const workspaceId = url.searchParams.get('workspaceId') ?? '';
  const r = await Mail.getDeliveryStatus(workspaceId, id);
  return sendResponse(r);
}
