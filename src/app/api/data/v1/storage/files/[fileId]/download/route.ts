import { NextRequest } from 'next/server';
import { Storage } from '@/modules/storage';
import { authorizeProductRequest, sendProductResponse } from '../../../../_helpers';

export async function GET(req: NextRequest, { params }: { params: Promise<{ fileId: string }> }) {
  const auth = await authorizeProductRequest(req, 'storage:read', 'storage.files.download');
  if (!auth.ok) return auth.response;
  const { fileId } = await params;
  return sendProductResponse(
    await Storage.getDownloadUrl(auth.context.workspaceId, fileId),
    auth.context
  );
}
