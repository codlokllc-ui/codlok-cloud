/** GET /api/storage/list?workspaceId=ws1&limit=20&cursor=xxx — Storage.listFiles() */
import { NextRequest } from 'next/server';
import { Storage } from '@/modules/storage';
import { sendResponse } from '../../organizations/_helpers';

export async function GET(req: NextRequest) {
  const url = new URL(req.url);
  const workspaceId = url.searchParams.get('workspaceId') ?? '';
  const limit = url.searchParams.get('limit');
  const cursor = url.searchParams.get('cursor');
  const state = url.searchParams.get('state');
  const filters = state ? { state: state as never } : undefined;
  const pagination = (limit || cursor) ? { limit: limit ? parseInt(limit) : undefined, cursor: cursor ?? undefined } : undefined;
  const r = await Storage.listFiles(workspaceId, filters, pagination);
  return sendResponse(r);
}
