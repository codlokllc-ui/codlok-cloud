/** GET /api/storage/[id]?workspaceId=ws1 — Storage.getFile() */
import { NextRequest } from 'next/server';
import { Storage } from '@/modules/storage';
import { sendResponse } from '../../organizations/_helpers';

export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const url = new URL(req.url);
  const workspaceId = url.searchParams.get('workspaceId') ?? '';
  const r = await Storage.getFile(workspaceId, id);
  return sendResponse(r);
}
