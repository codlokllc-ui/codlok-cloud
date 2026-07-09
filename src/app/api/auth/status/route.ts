/**
 * GET /api/auth/status
 *
 * Returns the current Auth module configuration status (for the demo UI).
 * Does NOT expose any secrets — only whether a provider is configured.
 */
import { NextResponse } from 'next/server';
import { resolveAdapter } from '@/modules/auth/adapters/factory';

export async function GET() {
  const mockMode = process.env.CODELOK_AUTH_USE_MOCK === 'true';
  let providerConfigured = false;
  let providerName: string | null = null;
  try {
    const adapter = await resolveAdapter();
    if (adapter) {
      providerConfigured = true;
      providerName = mockMode ? 'mock' : 'supabase';
    }
  } catch {
    providerConfigured = false;
  }
  return NextResponse.json({
    success: true,
    data: {
      providerConfigured,
      providerName,
      mockMode,
    },
  });
}
