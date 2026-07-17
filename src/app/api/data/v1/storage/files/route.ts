import { NextRequest } from 'next/server';
import { Storage } from '@/modules/storage';
import { authorizeProductRequest, sendProductResponse } from '../../_helpers';

export async function GET(req: NextRequest) {
  const auth = await authorizeProductRequest(req, 'storage:read', 'storage.files.list');
  if (!auth.ok) return auth.response;
  const rawLimit = Number(req.nextUrl.searchParams.get('limit') ?? 20);
  const limit = Number.isFinite(rawLimit) ? Math.min(100, Math.max(1, Math.floor(rawLimit))) : 20;
  const result = await Storage.listFiles(auth.context.workspaceId, {
    state: (req.nextUrl.searchParams.get('state') ?? undefined) as never,
    mimeType: req.nextUrl.searchParams.get('mimeType') ?? undefined,
  }, { limit, cursor: req.nextUrl.searchParams.get('cursor') ?? undefined });
  return sendProductResponse(result, auth.context);
}
