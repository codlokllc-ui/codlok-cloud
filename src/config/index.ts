/**
 * Codlok Cloud — Configuration Service — Public Interface v1.0
 *
 * Per Master Spec §16 Configuration Service Module Specification v1.0
 * (STATUS: FROZEN, Spec Version 1.5).
 *
 * Purpose: Answers "what is the current, correct provider credential/
 * setting for this module, in this workspace?" It is the single
 * authoritative store for secrets and per-workspace provider
 * configuration (§3.4, §3.7).
 *
 * Out of scope: business logic, provider SDK client construction,
 * connection testing. Each consuming module constructs its own client
 * from the raw value getSecret() returns.
 *
 * ----------------------------------------------------------------------------
 * PUBLIC INTERFACE (§16)
 * ----------------------------------------------------------------------------
 *   getSecret(workspaceId, key)         → { value }
 *   setSecret(workspaceId, key, value)  → { key, configured: true, version }
 *   deleteSecret(workspaceId, key)      → { key, configured: false }
 *   getProviderStatus(workspaceId, moduleId)
 *                                        → { moduleId, configured, requiredKeys, missingKeys }
 *   listConfiguredModules(workspaceId)  → { modules: [{ moduleId, configured }] }
 *   getFeatureFlag(workspaceId, key)    → { key, value }
 *   setFeatureFlag(workspaceId, key, value) → { key, value }
 *
 * ----------------------------------------------------------------------------
 * MANDATORY RULES (§16)
 * ----------------------------------------------------------------------------
 * 1. Secret Access Auditing — every getSecret() call is logged with
 *    module, workspaceId, key, timestamp, success/failure. Value is
 *    NEVER logged.
 * 2. Permission Enforcement (external) — Configuration has NO concept of
 *    Owner/Admin/Member. setSecret/deleteSecret permission checks are the
 *    caller's responsibility (Admin Dashboard via
 *    Organizations.checkPermission()). Configuration performs no role
 *    check internally.
 * 3. Encryption at rest — secrets encrypted via AES-256-GCM. Master key
 *    from CODELOK_CONFIG_MASTER_KEY env var. See internal/crypto.ts for
 *    the full master-key strategy documentation.
 * 4. Configuration Versioning — every secret change stores version,
 *    updatedBy, updatedAt. Old versions are not retained in v1 (the
 *    version number is monotonic), but the metadata is.
 *
 * ----------------------------------------------------------------------------
 * CALLER CONTEXT
 * ----------------------------------------------------------------------------
 * The `module` parameter on getSecret is used for audit logging only —
 * it records which module requested the secret. It does NOT scope the
 * lookup (any module can read any key; Configuration does not enforce
 * per-module access control — that's §3.3's job, enforced by the
 * module-boundary architecture itself).
 *
 * The `actorUserId` parameter on setSecret/deleteSecret/setFeatureFlag
 * is used for versioning metadata (updatedBy) only — it is NOT a
 * permission check. The caller (Admin Dashboard) must have already
 * verified the actor has Owner permission via
 * Organizations.checkPermission() before calling these functions.
 */

import {
  StandardResponse,
  ok,
  fail,
} from '@/shared';
import { ConfigErrorCode } from './internal/errors';
import {
  ConfigError,
  MODULE_CATALOG,
} from './internal/types';
import type {
  SecretRecord,
  FeatureFlagRecord,
  AuditLogEntry,
} from './internal/types';
import { store, _resetStoreForTesting } from './internal/store';
import { encrypt, decrypt, _resetMasterKeyForTesting } from './internal/crypto';

// Re-export test helpers so tests can import from the public module.
export { _resetStoreForTesting, _resetMasterKeyForTesting };
export type { AuditLogEntry };

// ---------------------------------------------------------------------------
// Public data shapes (per §16)
// ---------------------------------------------------------------------------

export interface GetSecretData {
  value: string;
}

export interface SetSecretData {
  key: string;
  configured: true;
  version: number;
}

export interface DeleteSecretData {
  key: string;
  configured: false;
}

export interface ProviderStatusData {
  moduleId: string;
  configured: boolean;
  requiredKeys: string[];
  missingKeys: string[];
}

export interface ListConfiguredModulesData {
  modules: { moduleId: string; configured: boolean }[];
}

export interface FeatureFlagData {
  key: string;
  value: string;
}

// ---------------------------------------------------------------------------
// Internal: error wrapping
// ---------------------------------------------------------------------------

function _configErrorToResponse(err: unknown): StandardResponse<never> {
  if (err instanceof Error && err.name === 'ConfigError') {
    const code = (err as { code?: string }).code ?? ConfigErrorCode.INTERNAL_ERROR;
    return fail(code, err.message);
  }
  return fail(ConfigErrorCode.INTERNAL_ERROR, 'An internal error occurred.');
}

// ---------------------------------------------------------------------------
// Internal: input validation
// ---------------------------------------------------------------------------

function _requireWorkspaceId(workspaceId: string): void {
  if (!workspaceId || typeof workspaceId !== 'string') {
    throw new ConfigError(
      ConfigErrorCode.WORKSPACE_NOT_FOUND,
      'workspaceId is required.'
    );
  }
}

function _requireKey(key: string): void {
  if (!key || typeof key !== 'string' || key.trim() !== key) {
    throw new ConfigError(
      ConfigErrorCode.INVALID_KEY,
      'key is required and must not have leading/trailing whitespace.'
    );
  }
}

function _now(): string {
  return new Date().toISOString();
}

// ---------------------------------------------------------------------------
// §16 getSecret
// ---------------------------------------------------------------------------

/**
 * Retrieve a secret value for a workspace.
 *
 * @param workspaceId  The workspace scope (required per §16 line 597).
 * @param key          The secret key (e.g. 'SUPABASE_URL').
 * @param module       The calling module name, for audit logging only.
 *                     (e.g. 'auth', 'mail'). Not a permission check.
 * @returns StandardResponse<{ value }> — the raw decrypted value.
 */
export async function getSecret(
  workspaceId: string,
  key: string,
  module: string = 'unknown'
): Promise<StandardResponse<GetSecretData>> {
  try {
    _requireWorkspaceId(workspaceId);
    _requireKey(key);

    const record = store.getSecret(workspaceId, key);
    const success = !!record;

    // Audit log (metadata only — never the value). Per §16 Mandatory Rule 1.
    store.appendAudit({
      module,
      workspaceId,
      key,
      at: _now(),
      success,
      errorCode: success ? undefined : ConfigErrorCode.SECRET_NOT_CONFIGURED,
    });

    if (!record) {
      throw new ConfigError(
        ConfigErrorCode.SECRET_NOT_CONFIGURED,
        `Secret '${key}' is not configured for this workspace.`
      );
    }

    // Decrypt and return the raw value.
    let value: string;
    try {
      value = decrypt(record.encrypted);
    } catch {
      // Decryption failure means the master key changed or data was
      // corrupted. This is an operational emergency.
      throw new ConfigError(
        ConfigErrorCode.ENCRYPTION_ERROR,
        `Failed to decrypt secret '${key}'. The master key may have changed.`
      );
    }

    return ok<GetSecretData>({ value });
  } catch (err) {
    return _configErrorToResponse(err);
  }
}

// ---------------------------------------------------------------------------
// §16 setSecret
// ---------------------------------------------------------------------------

/**
 * Store or update a secret for a workspace.
 *
 * Per §16: "Callable only from the Admin Dashboard layer, which must
 * call Organizations.checkPermission() (Owner-only) before invoking
 * this — Configuration itself performs no role/permission check."
 *
 * @param workspaceId  The workspace scope.
 * @param key          The secret key.
 * @param value        The raw plaintext value (will be encrypted at rest).
 * @param actorUserId  The admin's userId (for versioning metadata only,
 *                     NOT a permission check).
 */
export async function setSecret(
  workspaceId: string,
  key: string,
  value: string,
  actorUserId: string
): Promise<StandardResponse<SetSecretData>> {
  try {
    _requireWorkspaceId(workspaceId);
    _requireKey(key);
    if (!actorUserId) {
      // actorUserId is metadata, but it's required for the versioning
      // rule (§16 Mandatory Rule 4: "updatedBy"). We don't check
      // permissions, but we do require the field for audit completeness.
      throw new ConfigError(
        ConfigErrorCode.INVALID_KEY,
        'actorUserId is required (for versioning metadata).'
      );
    }
    if (typeof value !== 'string') {
      throw new ConfigError(
        ConfigErrorCode.INVALID_KEY,
        'value must be a string.'
      );
    }

    const version = store.nextVersion(workspaceId, key);
    const encrypted = encrypt(value);
    const record: SecretRecord = {
      encrypted,
      version,
      updatedBy: actorUserId,
      updatedAt: _now(),
    };
    store.setSecret(workspaceId, key, record);

    return ok<SetSecretData>({ key, configured: true, version });
  } catch (err) {
    return _configErrorToResponse(err);
  }
}

// ---------------------------------------------------------------------------
// §16 deleteSecret
// ---------------------------------------------------------------------------

export async function deleteSecret(
  workspaceId: string,
  key: string,
  _actorUserId: string
): Promise<StandardResponse<DeleteSecretData>> {
  try {
    _requireWorkspaceId(workspaceId);
    _requireKey(key);

    const existing = store.deleteSecret(workspaceId, key);
    if (!existing) {
      throw new ConfigError(
        ConfigErrorCode.SECRET_NOT_CONFIGURED,
        `Secret '${key}' is not configured for this workspace.`
      );
    }

    return ok<DeleteSecretData>({ key, configured: false });
  } catch (err) {
    return _configErrorToResponse(err);
  }
}

// ---------------------------------------------------------------------------
// §16 getProviderStatus
// ---------------------------------------------------------------------------

export async function getProviderStatus(
  workspaceId: string,
  moduleId: string
): Promise<StandardResponse<ProviderStatusData>> {
  try {
    _requireWorkspaceId(workspaceId);
    if (!moduleId) {
      throw new ConfigError(
        ConfigErrorCode.UNKNOWN_MODULE,
        'moduleId is required.'
      );
    }

    const moduleDef = MODULE_CATALOG.find((m) => m.moduleId === moduleId);
    if (!moduleDef) {
      throw new ConfigError(
        ConfigErrorCode.UNKNOWN_MODULE,
        `Unknown module: '${moduleId}'.`
      );
    }

    const configuredKeys = new Set(store.listSecretKeys(workspaceId));
    const missingKeys = moduleDef.requiredKeys.filter((k) => !configuredKeys.has(k));
    const configured = missingKeys.length === 0;

    return ok<ProviderStatusData>({
      moduleId,
      configured,
      requiredKeys: moduleDef.requiredKeys,
      missingKeys,
    });
  } catch (err) {
    return _configErrorToResponse(err);
  }
}

// ---------------------------------------------------------------------------
// §16 listConfiguredModules
// ---------------------------------------------------------------------------

export async function listConfiguredModules(
  workspaceId: string
): Promise<StandardResponse<ListConfiguredModulesData>> {
  try {
    _requireWorkspaceId(workspaceId);

    const modules = MODULE_CATALOG.map((m) => {
      const configuredKeys = new Set(store.listSecretKeys(workspaceId));
      const missingKeys = m.requiredKeys.filter((k) => !configuredKeys.has(k));
      return {
        moduleId: m.moduleId,
        configured: missingKeys.length === 0,
      };
    });

    return ok<ListConfiguredModulesData>({ modules });
  } catch (err) {
    return _configErrorToResponse(err);
  }
}

// ---------------------------------------------------------------------------
// §16 getFeatureFlag / setFeatureFlag
// ---------------------------------------------------------------------------

export async function getFeatureFlag(
  workspaceId: string,
  key: string
): Promise<StandardResponse<FeatureFlagData>> {
  try {
    _requireWorkspaceId(workspaceId);
    _requireKey(key);

    const record = store.getFeatureFlag(workspaceId, key);
    if (!record) {
      throw new ConfigError(
        ConfigErrorCode.FEATURE_FLAG_NOT_FOUND,
        `Feature flag '${key}' is not set for this workspace.`
      );
    }

    return ok<FeatureFlagData>({ key, value: record.value });
  } catch (err) {
    return _configErrorToResponse(err);
  }
}

export async function setFeatureFlag(
  workspaceId: string,
  key: string,
  value: string,
  actorUserId: string
): Promise<StandardResponse<FeatureFlagData>> {
  try {
    _requireWorkspaceId(workspaceId);
    _requireKey(key);
    if (!actorUserId) {
      throw new ConfigError(
        ConfigErrorCode.INVALID_KEY,
        'actorUserId is required (for versioning metadata).'
      );
    }
    if (typeof value !== 'string') {
      throw new ConfigError(
        ConfigErrorCode.INVALID_KEY,
        'value must be a string.'
      );
    }

    const version = store.nextFlagVersion(workspaceId, key);
    const record: FeatureFlagRecord = {
      key,
      value,
      version,
      updatedBy: actorUserId,
      updatedAt: _now(),
    };
    store.setFeatureFlag(workspaceId, key, record);

    return ok<FeatureFlagData>({ key, value });
  } catch (err) {
    return _configErrorToResponse(err);
  }
}

// ---------------------------------------------------------------------------
// Audit log read (for tests and future Admin Dashboard)
// ---------------------------------------------------------------------------

export async function listAuditLog(
  workspaceId: string,
  limit = 100
): Promise<StandardResponse<{ entries: AuditLogEntry[] }>> {
  try {
    _requireWorkspaceId(workspaceId);
    return ok({ entries: store.listAudit(workspaceId, limit) });
  } catch (err) {
    return _configErrorToResponse(err);
  }
}

// ---------------------------------------------------------------------------
// Public surface
// ---------------------------------------------------------------------------

export const Configuration = {
  getSecret,
  setSecret,
  deleteSecret,
  getProviderStatus,
  listConfiguredModules,
  getFeatureFlag,
  setFeatureFlag,
  listAuditLog,
};

export type ConfigurationModule = typeof Configuration;

// ---------------------------------------------------------------------------
// Singleton accessor (preserved from Phase 1 stub for backward-compatible
// import path — Auth calls getConfigurationService())
// ---------------------------------------------------------------------------

/**
 * Returns the Configuration Service singleton. Modules call this to get
 * the service, then call its methods. The singleton IS the Configuration
 * object itself (all methods are module-level pure functions backed by
 * the globalThis store).
 *
 * For the §16 interface, modules can also import `Configuration` directly
 * and call its methods. The `getConfigurationService()` accessor is kept
 * for backward compatibility with Auth's existing wiring.
 */
export function getConfigurationService(): ConfigurationModule {
  return Configuration;
}
