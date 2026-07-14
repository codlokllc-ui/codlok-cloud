/** GET /api/notifications/[id]?workspaceId=ws1 — Notifications.getNotification() */
import { NextRequest } from 'next/server';
import { Notifications } from '@/modules/notifications';
import { sendResponse } from '../../organizations/_helpers';

export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const url = new URL(req.url);
  const workspaceId = url.searchParams.get('workspaceId') ?? '';
  const r = await Notifications.getNotification(workspaceId, id);
  return sendResponse(r);
}
