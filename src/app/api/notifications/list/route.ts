/** GET /api/notifications/list?workspaceId=ws1&limit=20&cursor=xxx — Notifications.listNotifications() */
import { NextRequest } from 'next/server';
import { Notifications } from '@/modules/notifications';
import { sendResponse } from '../../organizations/_helpers';

export async function GET(req: NextRequest) {
  const url = new URL(req.url);
  const workspaceId = url.searchParams.get('workspaceId') ?? '';
  const limit = url.searchParams.get('limit');
  const cursor = url.searchParams.get('cursor');
  const overallStatus = url.searchParams.get('overallStatus');
  const filters = overallStatus ? { overallStatus: overallStatus as never } : undefined;
  const pagination = (limit || cursor) ? { limit: limit ? parseInt(limit) : undefined, cursor: cursor ?? undefined } : undefined;
  const r = await Notifications.listNotifications(workspaceId, filters, pagination);
  return sendResponse(r);
}
