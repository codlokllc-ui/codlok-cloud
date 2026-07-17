import { NextRequest, NextResponse } from 'next/server';
import { Storage } from '@/modules/storage';
import { fail } from '@/shared';
import { authorizeProductRequest, readBoundedJson, runIdempotentMutation } from '../../_helpers';

type CreateUploadBody = { mimeType: string; expectedSizeBytes: number; expectedChecksum: string };

function validBody(value: unknown): value is CreateUploadBody {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const body = value as Record<string, unknown>;
  return Object.keys(body).every((key) => ['mimeType', 'expectedSizeBytes', 'expectedChecksum'].includes(key))
    && typeof body.mimeType === 'string'
    && typeof body.expectedSizeBytes === 'number'
    && Number.isSafeInteger(body.expectedSizeBytes)
    && typeof body.expectedChecksum === 'string';
}

export async function POST(req: NextRequest) {
  const auth = await authorizeProductRequest(req, 'storage:write', 'storage.uploads.create');
  if (!auth.ok) return auth.response;
  const parsed = await readBoundedJson(req);
  if (!parsed.ok) return parsed.response;
  if (!validBody(parsed.value)) {
    return NextResponse.json(fail('INVALID_REQUEST', 'Expected mimeType, expectedSizeBytes, and expectedChecksum only.'), { status: 400 });
  }
  const body = parsed.value;
  return runIdempotentMutation({
    req, context: auth.context, operation: 'storage.uploads.create', rawBody: parsed.raw, successStatus: 201,
    execute: () => Storage.createUpload(auth.context.workspaceId, body.mimeType, body.expectedSizeBytes, body.expectedChecksum),
  });
}
