import { NextRequest } from 'next/server';
import { Storage } from '@/modules/storage';
import { authorizeProductRequest, runIdempotentMutation } from '../../../../_helpers';

export async function POST(req: NextRequest, { params }: { params: Promise<{ uploadId: string }> }) {
  const auth = await authorizeProductRequest(req, 'storage:write', 'storage.uploads.complete');
  if (!auth.ok) return auth.response;
  const { uploadId } = await params;
  return runIdempotentMutation({
    req, context: auth.context, operation: `storage.uploads.complete:${uploadId}`,
    execute: () => Storage.completeUpload(auth.context.workspaceId, uploadId),
  });
}
