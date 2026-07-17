import { NextRequest, NextResponse } from 'next/server';
import { Gateway, type GatewayContext } from '@/gateway';
import type { ProductScope } from '@/modules/product-credentials';
import type { StandardResponse } from '@/shared';

export async function authorizeProductRequest(
  req: NextRequest,
  requiredScope: ProductScope,
  operation: string
): Promise<{ ok: true; context: GatewayContext } | { ok: false; response: NextResponse }> {
  const result = await Gateway.authenticateProductRequest({
    authorization: req.headers.get('authorization'),
    apiKey: req.headers.get('x-codlok-key'),
    requiredScope,
    operation,
  });
  if (!result.success) {
    const status = result.error.code === 'API_KEY_REQUIRED' || result.error.code === 'INVALID_API_KEY' ? 401
      : result.error.code === 'INSUFFICIENT_SCOPE' ? 403
        : result.error.code === 'RATE_LIMITED' ? 429
          : result.error.code === 'INVALID_AUTHORIZATION_HEADER' || result.error.code === 'AMBIGUOUS_CREDENTIALS' ? 400
            : 503;
    return { ok: false, response: NextResponse.json(result, { status }) };
  }
  return { ok: true, context: result.data };
}

export function sendProductResponse<T>(result: StandardResponse<T>, context: GatewayContext): NextResponse {
  const response = NextResponse.json(result, { status: result.success ? 200 : 400 });
  response.headers.set('X-Codlok-RateLimit-Limit', String(context.quota.limit));
  response.headers.set('X-Codlok-RateLimit-Remaining', String(context.quota.remaining));
  response.headers.set('X-Codlok-RateLimit-Reset', context.quota.resetAt);
  return response;
}
