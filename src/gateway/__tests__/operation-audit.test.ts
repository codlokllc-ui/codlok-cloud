import { beforeEach, describe, expect, test } from 'bun:test';
import { NextRequest } from 'next/server';
import { ok } from '@/shared';
import type { GatewayContext } from '..';
import { runIdempotentMutation } from '@/app/api/data/v1/_helpers';
import {
  _gatewayAuditEventsForTesting,
  _resetGatewayPolicyForTesting,
  _setGatewayAuditFailureForTesting,
} from '../policy';

const context: GatewayContext = {
  authenticatedBy: 'product-api-key',
  credentialId: 'credential-1',
  workspaceId: 'workspace-1',
  environment: 'development',
  scopes: ['storage:write'],
  quota: { allowed: true, limit: 120, remaining: 119, resetAt: new Date().toISOString() },
};

function request(key: string): NextRequest {
  return new NextRequest('http://localhost/api/data/v1/storage/uploads', {
    method: 'POST',
    headers: { 'idempotency-key': key },
  });
}

beforeEach(() => {
  process.env.NODE_ENV = 'test';
  _resetGatewayPolicyForTesting();
});

describe('gateway operation audit', () => {
  test('records a durable-safe operation outcome before completing replay state', async () => {
    const response = await runIdempotentMutation({
      req: request('operation-success-1'), context, operation: 'storage.create',
      execute: async () => ok({ created: true }),
    });
    expect(response.status).toBe(200);
    expect(_gatewayAuditEventsForTesting()).toContainEqual(expect.objectContaining({
      environment: 'development', eventType: 'gateway.operation', outcome: 'allowed',
    }));
  });

  test('an outcome-audit failure leaves the operation locked against repetition', async () => {
    let executions = 0;
    _setGatewayAuditFailureForTesting(true);
    const run = () => runIdempotentMutation({
      req: request('operation-audit-failure-1'), context, operation: 'storage.create',
      execute: async () => { executions += 1; return ok({ created: true }); },
    });
    expect((await run()).status).toBe(503);
    expect((await run()).status).toBe(503);
    expect(executions).toBe(1);
  });
});
