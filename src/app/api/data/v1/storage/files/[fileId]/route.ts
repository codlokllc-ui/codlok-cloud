import { NextRequest } from 'next/server';
import { Storage } from '@/modules/storage';
import { authorizeProductRequest, runIdempotentMutation, sendProductResponse } from '../../../_helpers';

export async function GET(req: NextRequest, { params }: { params: Promise<{ fileId: string }> }) {
  const auth = await authorizeProductRequest(req, 'storage:read', 'storage.files.get');
  if (!auth.ok) return auth.response;
  const { fileId } = await params;
  return sendProductResponse(await Storage.getFile(auth.context.workspaceId, fileId), auth.context);
}

export async function DELETE(req: NextRequest, { params }: { params: Promise<{ fileId: string }> }) {
  const auth = await authorizeProductRequest(req, 'storage:write', 'storage.files.delete');
  if (!auth.ok) return auth.response;
  const { fileId } = await params;
  return runIdempotentMutation({
    req, context: auth.context, operation: `storage.files.delete:${fileId}`,
    execute: () => Storage.deleteFile(auth.context.workspaceId, fileId),
  });
}
