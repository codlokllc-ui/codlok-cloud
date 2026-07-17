import { fail, ok, type StandardResponse } from '@/shared';
import {
  authenticateCredential,
  type AuthenticatedProductContext,
  type ProductScope,
} from '@/modules/product-credentials';

export interface GatewayContext extends AuthenticatedProductContext {
  authenticatedBy: 'product-api-key';
}

function bearerToken(authorization?: string | null): StandardResponse<string | null> {
  if (!authorization) return ok(null);
  const match = /^Bearer\s+(\S+)$/i.exec(authorization.trim());
  if (!match) return fail('INVALID_AUTHORIZATION_HEADER', 'Authorization header must use Bearer authentication.');
  return ok(match[1]);
}

export async function authenticateProductRequest(input: {
  authorization?: string | null;
  apiKey?: string | null;
  requiredScope?: ProductScope;
}): Promise<StandardResponse<GatewayContext>> {
  const bearer = bearerToken(input.authorization);
  if (!bearer.success) return bearer;
  if (bearer.data && input.apiKey) {
    return fail('AMBIGUOUS_CREDENTIALS', 'Provide one product credential only.');
  }

  const apiKey = bearer.data ?? input.apiKey?.trim();
  if (!apiKey) return fail('API_KEY_REQUIRED', 'A product API key is required.');

  const authenticated = await authenticateCredential(apiKey);
  if (!authenticated.success) return authenticated;
  if (input.requiredScope && !authenticated.data.scopes.includes(input.requiredScope)) {
    return fail('INSUFFICIENT_SCOPE', 'The product credential does not have the required scope.');
  }

  return ok({ ...authenticated.data, authenticatedBy: 'product-api-key' });
}

export const Gateway = { authenticateProductRequest };
