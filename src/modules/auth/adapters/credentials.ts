/**
 * Supabase credential resolution kept separate from the SDK-backed adapter.
 * This lets configuration and mock-mode tests validate credential behavior
 * without loading the Supabase SDK or any of its transitive dependencies.
 */
import { getConfigurationService } from '@/config';

export interface SupabaseCredentials {
  url: string;
  anonKey: string;
  serviceRoleKey: string;
}

export async function resolveSupabaseCredentials(
  workspaceId?: string
): Promise<SupabaseCredentials | null> {
  const config = getConfigurationService();
  const ws = workspaceId ?? '__global__';

  const [urlR, anonR, serviceR] = await Promise.all([
    config.getSecret(ws, 'SUPABASE_URL', 'auth'),
    config.getSecret(ws, 'SUPABASE_ANON_KEY', 'auth'),
    config.getSecret(ws, 'SUPABASE_SERVICE_ROLE_KEY', 'auth'),
  ]);

  const url = urlR.success ? urlR.data.value : undefined;
  const anonKey = anonR.success ? anonR.data.value : undefined;
  const serviceRoleKey = serviceR.success ? serviceR.data.value : undefined;
  if (!url || !anonKey || !serviceRoleKey) return null;
  return { url, anonKey, serviceRoleKey };
}
