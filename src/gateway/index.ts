import { fail, ok, type StandardResponse } from '@/shared';
import {
  authenticateCredential,
  type AuthenticatedProductContext,
  type ProductScope,
} from '@/modules/product-credentials';
import { consumeQuota, writeAuditEvent, type QuotaDecision } from './policy';
import { codlokEnvironment } from '@/shared';

export interface GatewayContext extends AuthenticatedProductContext {
  authenticatedBy: 'product-api-key';
  quota: QuotaDecision;
}

export async function recordGatewayOperation(
  context: GatewayContext,
  operation: string,
  outcome: 'allowed' | 'denied' | 'error',
  metadata: Record<string, string | number | boolean | null> = {}
): Promise<void> {
  await writeAuditEvent({
    workspaceId: context.workspaceId,
    credentialId: context.credentialId,
    environment: context.environment,
    credentialEnvironment: context.environment,
    eventType: 'gateway.operation',
    outcome,
    metadata: { operation, ...metadata },
  });
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
  const runtimeEnvironment = codlokEnvironment();
  const audit = async (
    eventType: string,
    outcome: 'allowed' | 'denied' | 'error',
    metadata: Record<string, string | number | boolean | null>
  ): Promise<boolean> => {
    try {
      await writeAuditEvent({
        workspaceId: authenticated.data.workspaceId,
        credentialId: authenticated.data.credentialId,
        environment: runtimeEnvironment,
        credentialEnvironment: authenticated.data.environment,
        eventType,
        outcome,
        metadata,
      });
      return true;
    } catch {
      return false;
    }
  };
  const operation = input.operation ?? 'unspecified';
  if (authenticated.data.environment !== runtimeEnvironment) {
    if (!(await audit('gateway.authorization', 'denied', {
      reason: 'wrong_environment', operation,
      credentialEnvironment: authenticated.data.environment,
    }))) {
      return fail('GATEWAY_AUDIT_UNAVAILABLE', 'Gateway audit could not be recorded.');
    }
    return fail('API_KEY_WRONG_ENVIRONMENT', 'The product credential is not valid in this environment.');
  }
  if (input.requiredScope && !authenticated.data.scopes.includes(input.requiredScope)) {
    if (!(await audit('gateway.authorization', 'denied', {
      reason: 'insufficient_scope', operation,
    }))) return fail('GATEWAY_AUDIT_UNAVAILABLE', 'Gateway audit could not be recorded.');
    return fail('INSUFFICIENT_SCOPE', 'The product credential does not have the required scope.');
  }

  let quota: QuotaDecision;
  try { quota = await consumeQuota(authenticated.data); }
  catch {
    if (!(await audit('gateway.quota', 'error', { operation }))) {
      return fail('GATEWAY_AUDIT_UNAVAILABLE', 'Gateway audit could not be recorded.');
    }
    return fail('GATEWAY_POLICY_UNAVAILABLE', 'Gateway policy could not be evaluated.');
  }
  if (!quota.allowed) {
    if (!(await audit('gateway.quota', 'denied', { operation, limit: quota.limit }))) {
      return fail('GATEWAY_AUDIT_UNAVAILABLE', 'Gateway audit could not be recorded.');
    }
    return fail('RATE_LIMITED', 'The product credential rate limit has been exceeded.');
  }

  if (!(await audit('gateway.authorization', 'allowed', { operation }))) {
    return fail('GATEWAY_AUDIT_UNAVAILABLE', 'Gateway audit could not be recorded.');
  }

  return ok({ ...authenticated.data, authenticatedBy: 'product-api-key', quota });
}

export const Gateway = { authenticateProductRequest, recordGatewayOperation };
