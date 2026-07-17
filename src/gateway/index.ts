import { fail, ok, type StandardResponse } from '@/shared';
import {
  authenticateCredential,
  type AuthenticatedProductContext,
  type ProductScope,
} from '@/modules/product-credentials';
import { consumeQuota, writeAuditEvent, type QuotaDecision } from './policy';

export interface GatewayContext extends AuthenticatedProductContext {
  authenticatedBy: 'product-api-key';
  quota: QuotaDecision;
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
  operation?: string;
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
    await writeAuditEvent({ workspaceId: authenticated.data.workspaceId, credentialId: authenticated.data.credentialId,
      eventType: 'gateway.authorization', outcome: 'denied', metadata: { reason: 'insufficient_scope', operation: input.operation ?? 'unspecified' } });
    return fail('INSUFFICIENT_SCOPE', 'The product credential does not have the required scope.');
  }

  let quota: QuotaDecision;
  try { quota = await consumeQuota(authenticated.data); }
  catch {
    await writeAuditEvent({ workspaceId: authenticated.data.workspaceId, credentialId: authenticated.data.credentialId,
      eventType: 'gateway.quota', outcome: 'error', metadata: { operation: input.operation ?? 'unspecified' } });
    return fail('GATEWAY_POLICY_UNAVAILABLE', 'Gateway policy could not be evaluated.');
  }
  if (!quota.allowed) {
    await writeAuditEvent({ workspaceId: authenticated.data.workspaceId, credentialId: authenticated.data.credentialId,
      eventType: 'gateway.quota', outcome: 'denied', metadata: { operation: input.operation ?? 'unspecified', limit: quota.limit } });
    return fail('RATE_LIMITED', 'The product credential rate limit has been exceeded.');
  }

  await writeAuditEvent({ workspaceId: authenticated.data.workspaceId, credentialId: authenticated.data.credentialId,
    eventType: 'gateway.authorization', outcome: 'allowed', metadata: { operation: input.operation ?? 'unspecified' } });

  return ok({ ...authenticated.data, authenticatedBy: 'product-api-key', quota });
}

export const Gateway = { authenticateProductRequest };
