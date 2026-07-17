import { NextRequest } from 'next/server';
import { Storage } from '@/modules/storage';
import { authorizeProductRequest, sendProductResponse } from '../../_helpers';

export async function GET(req: NextRequest) {
  const auth = await authorizeProductRequest(req, 'storage:read', 'storage.files.list');
  if (!auth.ok) return auth.response;
  const limitValue = Number(req.nextUrl.searchParams.get('limit') ?? 20);
  const limit = Number.isFinite(limitValue) ? Math.min(100, Math.max(1, Math.floor(limitValue))) : 20;
  const cursor = req.nextUrl.searchParams.get('cursor') ?? undefined;
  const state = req.nextUrl.searchParams.get('state') ?? undefined;
  const mimeType = req.nextUrl.searchParams.get('mimeType') ?? undefined;
  const result = await Storage.listFiles(
    auth.context.workspaceId,
    { state: state as never, mimeType },
    { limit, cursor }
  );
  return sendProductResponse(result, auth.context);
}
