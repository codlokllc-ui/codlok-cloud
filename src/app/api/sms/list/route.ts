/** GET /api/sms/list?workspaceId=ws1&limit=20&cursor=xxx — SMS.listSms() */
import { NextRequest } from 'next/server';
import { SMS } from '@/modules/sms';
import { sendResponse } from '../../organizations/_helpers';

export async function GET(req: NextRequest) {
  const url = new URL(req.url);
  const workspaceId = url.searchParams.get('workspaceId') ?? '';
  const limit = url.searchParams.get('limit');
  const cursor = url.searchParams.get('cursor');
  const status = url.searchParams.get('status');
  const filters = status ? { status: status as never } : undefined;
  const pagination = (limit || cursor) ? { limit: limit ? parseInt(limit) : undefined, cursor: cursor ?? undefined } : undefined;
  const r = await SMS.listSms(workspaceId, filters, pagination);
  return sendResponse(r);
}
