/**
 * Codlok Cloud — Configuration Service (boundary-level stub, Phase 2)
 *
 * Per Master Spec §3.4:
 *   "Secrets (Stripe keys, Supabase service role keys, OpenAI keys, Resend
 *    keys, etc.) never live in code, git, or committed config files. Secrets
 *   are stored in Codlok's central Configuration Service and requested by
 *   modules at runtime — modules never hardcode credentials."
 *
 * Per Master Spec §13 Build Order, Configuration Service is officially Phase 2.
 * However, Auth (Phase 1) depends on it per §3.4 and §10 ("Reads secrets
 * through the Configuration Service"). This file therefore provides the
 * MINIMUM interface Auth needs, backed by environment variables for local
 * development. The full Configuration Service (per-workspace credential store,
 * admin UI for managing credentials, rotation, audit) will be implemented in
 * Phase 2 and will replace this implementation without changing the interface.
 *
 * Compliance with §3.7: "Provider credentials are never auto-created."
 * If no credentials are configured, `getSecret()` returns `undefined`. The
 * calling module is responsible for returning its `*_PROVIDER_NOT_CONFIGURED`
 * error. No fake defaults, no silent fallback credentials.
 */

export interface SecretRecord {
  /** The secret value. Undefined if not configured. */
  value: string | undefined;
  /** Whether this secret was found in the configuration store. */
  configured: boolean;
}

export interface ConfigurationService {
  /**
   * Look up a single secret by key, optionally scoped to a workspace.
   * Returns `{ value: undefined, configured: false }` if not found.
   */
  getSecret(key: string, workspaceId?: string): Promise<SecretRecord>;

  /**
   * Look up a group of related secrets (e.g. all Supabase credentials) in
   * a single round-trip. Returns a map keyed by the requested key names.
   */
  getSecrets(
    keys: string[],
    workspaceId?: string
  ): Promise<Record<string, SecretRecord>>;
}

// ---------------------------------------------------------------------------
// EnvironmentVariableConfigurationService
//
// Phase 1 backing implementation. Reads from `process.env`. This is a real
// implementation, not a mock — it is how local development and self-hosted
// deployments will configure credentials until the Phase 2 Configuration
// Service (with admin UI, per-workspace scoping, rotation, audit) is built.
//
// The Phase 2 service will provide the SAME `ConfigurationService` interface,
// so no module code (including Auth) will need to change.
// ---------------------------------------------------------------------------

export class EnvironmentVariableConfigurationService
  implements ConfigurationService
{
  async getSecret(key: string, _workspaceId?: string): Promise<SecretRecord> {
    const value = process.env[key];
    return { value, configured: value !== undefined && value !== '' };
  }

  async getSecrets(
    keys: string[],
    workspaceId?: string
  ): Promise<Record<string, SecretRecord>> {
    const out: Record<string, SecretRecord> = {};
    for (const k of keys) {
      out[k] = await this.getSecret(k, workspaceId);
    }
    return out;
  }
}

// ---------------------------------------------------------------------------
// Singleton accessor
//
// Modules import `configurationService` and call `getSecret()` on it. They
// never construct the implementation class directly — this preserves the
// §3.4 boundary (modules only know the interface).
// ---------------------------------------------------------------------------

let _instance: ConfigurationService | null = null;

export function getConfigurationService(): ConfigurationService {
  if (_instance === null) {
    _instance = new EnvironmentVariableConfigurationService();
  }
  return _instance;
}

/**
 * Test-only escape hatch. Production code MUST NOT call this — modules must
 * only consume the singleton via `getConfigurationService()`.
 */
export function _setConfigurationServiceForTesting(
  service: ConfigurationService | null
): void {
  _instance = service;
}
