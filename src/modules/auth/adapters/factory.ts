/**
 * Codlok Cloud — Auth Module — Adapter Factory (INTERNAL)
 *
 * Selects which AuthProviderAdapter implementation to use at runtime.
 *
 * Selection rules (strict — compliant with §3.4 and §3.7):
 *
 *   1. If `CODELOK_AUTH_USE_MOCK=true` env var is set:
 *        → use MockAuthAdapter (explicit dev/demo opt-in).
 *
 *   2. Else, look up Supabase credentials through the Configuration Service.
 *      - If credentials are fully configured → use SupabaseAuthAdapter.
 *      - If credentials are missing/incomplete → return `null`. Auth's public
 *        boundary then surfaces AUTH_PROVIDER_NOT_CONFIGURED per §3.7.
 *
 *   3. NEVER auto-fallback from missing Supabase credentials to Mock. That
 *      would violate §3.7 ("No fake defaults, no silent fallback credentials").
 *
 * This file is INTERNAL to the Auth module.
 */

import { MockAuthAdapter } from './mock';
import { resolveSupabaseCredentials } from './credentials';
import { AuthProviderAdapter } from './types';

// Allow tests to inject a custom adapter (e.g. a spy). Production code never
// calls this.
let _override: AuthProviderAdapter | null = null;

export function _setAdapterForTesting(
  adapter: AuthProviderAdapter | null
): void {
  _override = adapter;
}

// Use globalThis for module-level caches — Next.js dev mode may load this
// module multiple times across route handlers, and we want all instances
// to share the same cached adapter (otherwise state would diverge).
const _SUPABASE_KEY = Symbol.for('codlok.auth.cachedSupabase');
const _MOCK_KEY = Symbol.for('codlok.auth.cachedMock');

function _getCachedSupabase(): AuthProviderAdapter | null {
  return (globalThis as Record<symbol, unknown>)[_SUPABASE_KEY] as AuthProviderAdapter | null ?? null;
}
function _setCachedSupabase(a: AuthProviderAdapter | null): void {
  (globalThis as Record<symbol, unknown>)[_SUPABASE_KEY] = a;
}
function _getCachedMock(): MockAuthAdapter | null {
  return (globalThis as Record<symbol, unknown>)[_MOCK_KEY] as MockAuthAdapter | null ?? null;
}
function _setCachedMock(a: MockAuthAdapter | null): void {
  (globalThis as Record<symbol, unknown>)[_MOCK_KEY] = a;
}

/**
 * Resolve the adapter to use for a given workspace context.
 *
 * @returns the adapter, or `null` if no provider is configured.
 */
export async function resolveAdapter(
  workspaceId?: string
): Promise<AuthProviderAdapter | null> {
  if (_override) return _override;

  if (process.env.CODELOK_AUTH_USE_MOCK === 'true') {
    let mock = _getCachedMock();
    if (!mock) {
      mock = new MockAuthAdapter();
      _setCachedMock(mock);
    }
    return mock;
  }

  const creds = await resolveSupabaseCredentials(workspaceId);
  if (!creds) return null;

  // Cache by reference — credentials are workspace-scoped, but Phase 1 Auth
  // uses global Supabase project (identity is global per §6). Phase 2 will
  // re-resolve per workspace once Configuration Service is multi-tenant.
  let supabase = _getCachedSupabase();
  if (!supabase) {
    const { SupabaseAuthAdapter } = await import('./supabase');
    supabase = new SupabaseAuthAdapter(creds);
    _setCachedSupabase(supabase);
  }
  return supabase;
}

/**
 * Test-only: get the underlying MockAuthAdapter instance (so tests can call
 * `_lockUser`, `_markEmailVerified`, etc.). Throws if Mock mode is not active.
 */
export function _getMockAdapterForTesting(): MockAuthAdapter {
  const mock = _getCachedMock();
  if (!mock) {
    throw new Error('Mock adapter not initialized. Set CODELOK_AUTH_USE_MOCK=true or inject one.');
  }
  return mock;
}
