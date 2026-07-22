import { NextRequest, NextResponse } from 'next/server';
import { Gateway, recordGatewayOperation, type GatewayContext } from '@/gateway';
import type { ProductScope } from '@/modules/product-credentials';
import type { StandardResponse } from '@/shared';
import { fail } from '@/shared';
import {
  beginIdempotentOperation,
  completeIdempotentOperation,
  failIdempotentOperation,
  requestDigest,
  validateIdempotencyKey,
} from '@/gateway/idempotency';

export const MAX_DATA_PLANE_JSON_BYTES = 16 * 1024;

export async function authorizeProductRequest(req: NextRequest, requiredScope: ProductScope, operation: string): Promise<{ ok: true; context: GatewayContext } | { ok: false; response: NextResponse }> {
  const result = await Gateway.authenticateProductRequest({ authorization: req.headers.get('authorization'), apiKey: req.headers.get('x-codlok-key'), requiredScope, operation });
  if (!result.success) {
    const status = ['API_KEY_REQUIRED', 'INVALID_API_KEY', 'API_KEY_REVOKED', 'API_KEY_EXPIRED', 'API_KEY_INACTIVE'].includes(result.error.code) ? 401
      : result.error.code === 'INSUFFICIENT_SCOPE' || result.error.code === 'API_KEY_WRONG_ENVIRONMENT' ? 403
        : result.error.code === 'RATE_LIMITED' ? 429
          : result.error.code === 'INVALID_AUTHORIZATION_HEADER' || result.error.code === 'AMBIGUOUS_CREDENTIALS' ? 400 : 503;
    return { ok: false, response: NextResponse.json(result, { status }) };
  }
  return { ok: true, context: result.data };
}

export function sendProductResponse<T>(result: StandardResponse<T>, context: GatewayContext): NextResponse {
  const code = result.success ? '' : result.error.code;
  const status = result.success ? 200
    : ['FILE_NOT_FOUND', 'UPLOAD_NOT_FOUND', 'WORKSPACE_NOT_FOUND'].includes(code) ? 404
      : ['FILE_NOT_UPLOADED', 'UPLOAD_INCOMPLETE', 'UPLOAD_EXPIRED'].includes(code) ? 409
        : ['PROVIDER_NOT_CONFIGURED', 'INTERNAL_ERROR'].includes(code) ? 503
          : code === 'FILE_TOO_LARGE' ? 413 : 400;
  const response = NextResponse.json(result, { status });
  response.headers.set('X-Codlok-RateLimit-Limit', String(context.quota.limit));
  response.headers.set('X-Codlok-RateLimit-Remaining', String(context.quota.remaining));
  response.headers.set('X-Codlok-RateLimit-Reset', context.quota.resetAt);
  return response;
}

export async function runIdempotentMutation<T>(input: {
  req: NextRequest;
  context: GatewayContext;
  operation: string;
  rawBody?: string;
  successStatus?: number;
  execute: () => Promise<StandardResponse<T>>;
}): Promise<NextResponse> {
  const key = validateIdempotencyKey(input.req.headers.get('idempotency-key'));
  if (!key) return sendProductResponse(fail('IDEMPOTENCY_KEY_REQUIRED', 'Idempotency-Key must be 8-128 safe characters.'), input.context);
  const digest = requestDigest(input.operation, input.rawBody ?? '');
  let begun;
  try {
    begun = await beginIdempotentOperation({ workspaceId: input.context.workspaceId, environment: input.context.environment, operation: input.operation, key, digest });
  } catch {
    return NextResponse.json(fail('IDEMPOTENCY_UNAVAILABLE', 'The request safety store is unavailable.'), { status: 503 });
  }
  if (begun.kind === 'replay') {
    try { await recordGatewayOperation(input.context, input.operation, 'allowed', { result: 'replay' }); }
    catch { return NextResponse.json(fail('GATEWAY_AUDIT_UNAVAILABLE', 'Gateway audit could not be recorded.'), { status: 503 }); }
    const replay = NextResponse.json(begun.response.body, { status: begun.response.status });
    replay.headers.set('X-Codlok-Idempotent-Replay', 'true');
    replay.headers.set('X-Codlok-RateLimit-Limit', String(input.context.quota.limit));
    replay.headers.set('X-Codlok-RateLimit-Remaining', String(input.context.quota.remaining));
    replay.headers.set('X-Codlok-RateLimit-Reset', input.context.quota.resetAt);
    return replay;
  }
  if (begun.kind === 'conflict') {
    try { await recordGatewayOperation(input.context, input.operation, 'denied', { reason: begun.reason }); }
    catch { return NextResponse.json(fail('GATEWAY_AUDIT_UNAVAILABLE', 'Gateway audit could not be recorded.'), { status: 503 }); }
    const message = begun.reason === 'different_request'
      ? 'This idempotency key was already used with a different request.'
      : 'A request with this idempotency key is still in progress.';
    return NextResponse.json(fail('IDEMPOTENCY_CONFLICT', message), { status: 409 });
  }
  let result: StandardResponse<T>;
  try {
    result = await input.execute();
  } catch {
    await failIdempotentOperation({ workspaceId: input.context.workspaceId, environment: input.context.environment, operation: input.operation, key, digest });
    try { await recordGatewayOperation(input.context, input.operation, 'error', { reason: 'execution_failed' }); }
    catch { return NextResponse.json(fail('GATEWAY_AUDIT_UNAVAILABLE', 'Gateway audit could not be recorded.'), { status: 503 }); }
    return NextResponse.json(fail('INTERNAL_ERROR', 'The operation could not be completed.'), { status: 500 });
  }
  const status = result.success ? (input.successStatus ?? 200) : 400;
  try {
    await recordGatewayOperation(input.context, input.operation, result.success ? 'allowed' : 'denied', {
      result: result.success ? 'success' : 'business_rejection',
    });
  } catch {
    return NextResponse.json(fail('GATEWAY_AUDIT_UNAVAILABLE', 'Gateway audit could not be recorded.'), { status: 503 });
  }
  try {
    await completeIdempotentOperation({
      workspaceId: input.context.workspaceId, environment: input.context.environment, operation: input.operation, key, digest,
      response: { status, body: result },
    });
  } catch {
    // The business operation may already have succeeded. Keep the record in
    // started state so an automatic retry cannot repeat an uncertain write.
    try { await recordGatewayOperation(input.context, input.operation, 'error', { reason: 'idempotency_commit_failed' }); }
    catch { /* The original outcome audit is already durable. */ }
    return NextResponse.json(fail('IDEMPOTENCY_COMMIT_FAILED', 'The operation result could not be safely committed for replay.'), { status: 503 });
  }
  const response = NextResponse.json(result, { status });
  response.headers.set('X-Codlok-Idempotent-Replay', 'false');
  response.headers.set('X-Codlok-RateLimit-Limit', String(input.context.quota.limit));
  response.headers.set('X-Codlok-RateLimit-Remaining', String(input.context.quota.remaining));
  response.headers.set('X-Codlok-RateLimit-Reset', input.context.quota.resetAt);
  return response;
}

export async function readBoundedJson(req: NextRequest): Promise<{ ok: true; raw: string; value: unknown } | { ok: false; response: NextResponse }> {
  const declared = Number(req.headers.get('content-length') ?? 0);
  if (Number.isFinite(declared) && declared > MAX_DATA_PLANE_JSON_BYTES) {
    return { ok: false, response: NextResponse.json(fail('PAYLOAD_TOO_LARGE', 'Request body is too large.'), { status: 413 }) };
  }
  const raw = await req.text();
  if (Buffer.byteLength(raw, 'utf8') > MAX_DATA_PLANE_JSON_BYTES) {
    return { ok: false, response: NextResponse.json(fail('PAYLOAD_TOO_LARGE', 'Request body is too large.'), { status: 413 }) };
  }
  try { return { ok: true, raw, value: JSON.parse(raw) }; }
  catch { return { ok: false, response: NextResponse.json(fail('INVALID_JSON', 'Request body must be valid JSON.'), { status: 400 }) }; }
}
