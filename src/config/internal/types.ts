/**
 * Codlok Cloud — Configuration Service — Internal Types (INTERNAL)
 *
 * Per Master Spec §16. This file is internal to the Configuration Service.
 * Only `src/config/index.ts` (the public interface) imports from here.
 */

// ---------------------------------------------------------------------------
// Secret storage (encrypted at rest per §16 Mandatory Rule 3)
// ---------------------------------------------------------------------------

export interface EncryptedSecret {
  /** Ciphertext (base64). */
  ciphertext: string;
  /** Initialization vector (base64). */
  iv: string;
  /** Auth tag from AES-256-GCM (base64). */
  tag: string;
}

export interface SecretRecord {
  /** The encrypted secret value. */
  encrypted: EncryptedSecret;
  /** Version number, incremented on each setSecret call. */
  version: number;
  /** userId of the admin who last set this secret. */
  updatedBy: string;
  /** ISO timestamp of the last update. */
  updatedAt: string;
}

// ---------------------------------------------------------------------------
// Feature flags (plain key-value, not encrypted — per §16 they are
// "workspace configuration data, not business logic or permissions")
// ---------------------------------------------------------------------------

export interface FeatureFlagRecord {
  key: string;
  value: string;
  version: number;
  updatedBy: string;
  updatedAt: string;
}

// ---------------------------------------------------------------------------
// Audit log (§16 Mandatory Rule 1 — Secret Access Auditing)
// ---------------------------------------------------------------------------

export interface AuditLogEntry {
  id: string;
  /** The module that called getSecret (e.g. 'auth', 'mail'). */
  module: string;
  workspaceId: string;
  /** The secret key requested. The secret VALUE is never logged. */
  key: string;
  /** ISO timestamp. */
  at: string;
  /** Whether the secret was found and returned. */
  success: boolean;
  /** Error code if success is false. */
  errorCode?: string;
}

// ---------------------------------------------------------------------------
// Module catalog (for getProviderStatus / listConfiguredModules)
// ---------------------------------------------------------------------------

export interface ModuleRequirement {
  moduleId: string;
  /** Secret keys this module requires to be considered "configured". */
  requiredKeys: string[];
}

/**
 * The known module catalog. Used by getProviderStatus to determine which
 * keys a module needs. Adding a new module means adding an entry here —
 * no code change to the public interface.
 */
export const MODULE_CATALOG: ModuleRequirement[] = [
  {
    moduleId: 'auth',
    requiredKeys: ['SUPABASE_URL', 'SUPABASE_ANON_KEY', 'SUPABASE_SERVICE_ROLE_KEY'],
  },
  {
    moduleId: 'mail',
    requiredKeys: ['RESEND_API_KEY'],
  },
  {
    moduleId: 'sms',
    requiredKeys: ['TWILIO_ACCOUNT_SID', 'TWILIO_AUTH_TOKEN'],
  },
  {
    moduleId: 'storage',
    requiredKeys: ['STORAGE_PROVIDER', 'STORAGE_BUCKET', 'STORAGE_ACCESS_KEY', 'STORAGE_SECRET_KEY'],
  },
  {
    moduleId: 'pay',
    requiredKeys: ['STRIPE_SECRET_KEY'],
  },
  {
    moduleId: 'ai',
    requiredKeys: ['OPENAI_API_KEY'],
  },
];

// ---------------------------------------------------------------------------
// ConfigError — internal exception
// ---------------------------------------------------------------------------

export class ConfigError extends Error {
  constructor(
    public readonly code: string,
    message: string
  ) {
    super(message);
    this.name = 'ConfigError';
  }
}
