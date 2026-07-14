/** GET /api/pay/[id]?workspaceId=ws1 — Pay.getPayment() */
import { NextRequest } from 'next/server';
import { Pay } from '@/modules/pay';
import { sendResponse } from '../../organizations/_helpers';

export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const url = new URL(req.url);
  const workspaceId = url.searchParams.get('workspaceId') ?? '';
  const r = await Pay.getPayment(workspaceId, id);
  return sendResponse(r);
}
