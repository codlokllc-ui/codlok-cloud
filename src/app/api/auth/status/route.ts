/**
 * GET /api/auth/status
 *
 * Returns the current Auth module configuration status (for the demo UI).
 * Does NOT expose any secrets — only whether a provider is configured.
 */
import { NextResponse } from 'next/server';
import { resolveAdapter } from '@/modules/auth/adapters/factory';
import { resolveSupabaseCredentials } from '@/modules/auth/adapters/credentials';

export async function GET() {
  const mockMode = process.env.CODELOK_AUTH_USE_MOCK === 'true';
  let providerConfigured = false;
  let providerName: string | null = null;
  let connectivity: 'not_checked' | 'connected' | 'rejected' | 'unreachable' = 'not_checked';
  let providerHttpStatus: number | null = null;
  let urlShapeValid = false;
  try {
    const adapter = await resolveAdapter();
    if (adapter) {
      providerConfigured = true;
      providerName = mockMode ? 'mock' : 'supabase';
    }
  } catch {
    providerConfigured = false;
  }

  if (providerConfigured && !mockMode) {
    const credentials = await resolveSupabaseCredentials();
    if (credentials) {
      try {
        const url = new URL(credentials.url);
        urlShapeValid = url.protocol === 'https:' && url.hostname.endsWith('.supabase.co');
        const response = await fetch(`${url.origin}/auth/v1/settings`, {
          headers: {
            apikey: credentials.anonKey,
            Authorization: `Bearer ${credentials.anonKey}`,
          },
          cache: 'no-store',
          signal: AbortSignal.timeout(5000),
        });
        providerHttpStatus = response.status;
        connectivity = response.ok ? 'connected' : 'rejected';
      } catch {
        connectivity = 'unreachable';
      }
    }
  }
  return NextResponse.json({
    success: true,
    data: {
      providerConfigured,
      providerName,
      mockMode,
      connectivity,
      providerHttpStatus,
      urlShapeValid,
    },
  });
}
