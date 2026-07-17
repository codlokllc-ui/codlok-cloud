import { describe, expect, test } from 'bun:test';
import {
  beginIdempotentOperation,
  completeIdempotentOperation,
  failIdempotentOperation,
  requestDigest,
  validateIdempotencyKey,
} from '../idempotency';

const unique = () => `test-${Date.now()}-${Math.random().toString(36).slice(2)}`;

describe('data-plane idempotency', () => {
  test('validates bounded safe keys', () => {
    expect(validateIdempotencyKey('request-123')).toBe('request-123');
    expect(validateIdempotencyKey('short')).toBeNull();
    expect(validateIdempotencyKey('bad key spaces')).toBeNull();
    expect(validateIdempotencyKey('x'.repeat(129))).toBeNull();
  });

  test('digest binds the operation and exact request', () => {
    expect(requestDigest('a', '{}')).not.toBe(requestDigest('b', '{}'));
    expect(requestDigest('a', '{}')).not.toBe(requestDigest('a', '{ }'));
    expect(requestDigest('a', '{}')).toBe(requestDigest('a', '{}'));
  });

  test('replays a completed response without running twice', async () => {
    const key = unique();
    const input = { workspaceId: 'ws-1', operation: 'storage.create', key, digest: requestDigest('storage.create', '{}') };
    expect((await beginIdempotentOperation(input)).kind).toBe('acquired');
    await completeIdempotentOperation({ ...input, response: { status: 201, body: { success: true } } });
    const replay = await beginIdempotentOperation(input);
    expect(replay.kind).toBe('replay');
    if (replay.kind === 'replay') expect(replay.response.status).toBe(201);
  });

  test('rejects key reuse with a different request', async () => {
    const key = unique();
    const base = { workspaceId: 'ws-1', operation: 'storage.create', key };
    expect((await beginIdempotentOperation({ ...base, digest: 'a' })).kind).toBe('acquired');
    const conflict = await beginIdempotentOperation({ ...base, digest: 'b' });
    expect(conflict).toEqual({ kind: 'conflict', reason: 'different_request' });
  });

  test('prevents concurrent execution and permits retry after failure', async () => {
    const key = unique();
    const input = { workspaceId: 'ws-1', operation: 'storage.delete', key, digest: 'same' };
    expect((await beginIdempotentOperation(input)).kind).toBe('acquired');
    expect(await beginIdempotentOperation(input)).toEqual({ kind: 'conflict', reason: 'in_progress' });
    await failIdempotentOperation(input);
    expect((await beginIdempotentOperation(input)).kind).toBe('acquired');
  });

  test('same key is independent across workspaces and operations', async () => {
    const key = unique();
    expect((await beginIdempotentOperation({ workspaceId: 'ws-a', operation: 'one', key, digest: 'x' })).kind).toBe('acquired');
    expect((await beginIdempotentOperation({ workspaceId: 'ws-b', operation: 'one', key, digest: 'x' })).kind).toBe('acquired');
    expect((await beginIdempotentOperation({ workspaceId: 'ws-a', operation: 'two', key, digest: 'x' })).kind).toBe('acquired');
  });
});
