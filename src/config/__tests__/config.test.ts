/**
 * Codlok Cloud — Configuration Service Tests
 *
 * Per Master Spec §14 Rule 12 (Pre-freeze test requirement), this file
 * covers all three mandatory categories:
 *
 *   1. BOUNDARY TESTS — internals not importable from outside.
 *   2. REGRESSION TESTS — all existing Auth + Organizations tests pass
 *      unmodified (run separately; this file verifies Configuration does
 *      not break them).
 *   3. COMPLIANCE TESTS — StandardResponse shape, module-boundary rules,
 *      §16 Mandatory Rules (Secret Access Auditing, Encryption at rest,
 *      Configuration Versioning, Permission Enforcement external).
 *
 * Run with: `bun test src/config`
 */

import { describe, test, expect, beforeEach, afterAll } from 'bun:test';
import {
  Configuration,
  getConfigurationService,
  _resetStoreForTesting,
  _resetMasterKeyForTesting,
} from '@/config';
import { ConfigErrorCode } from '@/config/internal/errors';
import { store } from '@/config/internal/store';
import { encrypt, decrypt, isPlaintextVisible } from '@/config/internal/crypto';
import type { StandardResponse } from '@/shared';

// ---------------------------------------------------------------------------
// Setup
// ---------------------------------------------------------------------------

beforeEach(() => {
  _resetStoreForTesting();
  _resetMasterKeyForTesting();
  delete process.env.CODELOK_CONFIG_MASTER_KEY;
});

afterAll(() => {
  _resetStoreForTesting();
  _resetMasterKeyForTesting();
  delete process.env.CODELOK_CONFIG_MASTER_KEY;
});

function assertStandardResponseShape<T>(r: StandardResponse<T>) {
  if (r.success) {
    expect(r).toHaveProperty('data');
    expect(typeof r.success).toBe('boolean');
  } else {
    expect(r).toHaveProperty('error');
    expect(r.error).toHaveProperty('code');
    expect(r.error).toHaveProperty('message');
    expect(typeof r.error.code).toBe('string');
    expect(typeof r.error.message).toBe('string');
  }
}

const WS_1 = 'ws_test_1';
const WS_2 = 'ws_test_2';
const ADMIN_USER = 'user_admin_001';

// ===========================================================================
// 1. BOUNDARY TESTS (Rule 12)
// ===========================================================================

describe('BOUNDARY TESTS — internal symbols not on public surface', () => {
  test('Configuration public surface exposes only §16 functions', () => {
    const publicKeys = Object.keys(Configuration).sort();
    expect(publicKeys).toContain('getSecret');
    expect(publicKeys).toContain('setSecret');
    expect(publicKeys).toContain('deleteSecret');
    expect(publicKeys).toContain('getProviderStatus');
    expect(publicKeys).toContain('listConfiguredModules');
    expect(publicKeys).toContain('getFeatureFlag');
    expect(publicKeys).toContain('setFeatureFlag');
  });

  test('Configuration public surface does NOT expose internal store/crypto', () => {
    const publicKeys = Object.keys(Configuration);
    expect(publicKeys).not.toContain('store');
    expect(publicKeys).not.toContain('encrypt');
    expect(publicKeys).not.toContain('decrypt');
    expect(publicKeys).not.toContain('_resetStoreForTesting');
    expect(publicKeys).not.toContain('_resetMasterKeyForTesting');
  });

  test('getConfigurationService returns the Configuration object', () => {
    const svc = getConfigurationService();
    expect(svc).toBe(Configuration);
    expect(typeof svc.getSecret).toBe('function');
    expect(typeof svc.setSecret).toBe('function');
  });

  test('No testConnection() in public surface (§16 explicitly excludes it)', () => {
    expect((Configuration as unknown as Record<string, unknown>).testConnection)
      .toBeUndefined();
  });
});

// ===========================================================================
// 2. FUNCTIONAL TESTS — getSecret / setSecret / deleteSecret
// ===========================================================================

describe('FUNCTIONAL — getSecret / setSecret / deleteSecret', () => {
  test('setSecret then getSecret: returns the raw value', async () => {
    const setR = await Configuration.setSecret(WS_1, 'STRIPE_SECRET_KEY', 'sk_test_abc123', ADMIN_USER);
    expect(setR.success).toBe(true);
    if (!setR.success) return;
    expect(setR.data.configured).toBe(true);
    expect(setR.data.version).toBe(1);

    const getR = await Configuration.getSecret(WS_1, 'STRIPE_SECRET_KEY', 'pay');
    expect(getR.success).toBe(true);
    if (!getR.success) return;
    expect(getR.data.value).toBe('sk_test_abc123');
  });

  test('getSecret: SECRET_NOT_CONFIGURED for missing key', async () => {
    const r = await Configuration.getSecret(WS_1, 'NONEXISTENT_KEY', 'pay');
    expect(r.success).toBe(false);
    if (r.success) return;
    expect(r.error.code).toBe(ConfigErrorCode.SECRET_NOT_CONFIGURED);
  });

  test('getSecret: WORKSPACE_NOT_FOUND for empty workspaceId', async () => {
    const r = await Configuration.getSecret('', 'STRIPE_SECRET_KEY', 'pay');
    expect(r.success).toBe(false);
    if (r.success) return;
    expect(r.error.code).toBe(ConfigErrorCode.WORKSPACE_NOT_FOUND);
  });

  test('setSecret: INVALID_KEY for empty key', async () => {
    const r = await Configuration.setSecret(WS_1, '', 'value', ADMIN_USER);
    expect(r.success).toBe(false);
    if (r.success) return;
    expect(r.error.code).toBe(ConfigErrorCode.INVALID_KEY);
  });

  test('deleteSecret: success after setSecret', async () => {
    await Configuration.setSecret(WS_1, 'STRIPE_SECRET_KEY', 'sk_test_abc', ADMIN_USER);
    const r = await Configuration.deleteSecret(WS_1, 'STRIPE_SECRET_KEY', ADMIN_USER);
    expect(r.success).toBe(true);
    if (!r.success) return;
    expect(r.data.configured).toBe(false);
    // Subsequent getSecret should fail.
    const getR = await Configuration.getSecret(WS_1, 'STRIPE_SECRET_KEY', 'pay');
    expect(getR.success).toBe(false);
  });

  test('deleteSecret: SECRET_NOT_CONFIGURED for missing key', async () => {
    const r = await Configuration.deleteSecret(WS_1, 'NONEXISTENT', ADMIN_USER);
    expect(r.success).toBe(false);
    if (r.success) return;
    expect(r.error.code).toBe(ConfigErrorCode.SECRET_NOT_CONFIGURED);
  });

  test('setSecret overwrites and increments version', async () => {
    await Configuration.setSecret(WS_1, 'KEY', 'v1', ADMIN_USER);
    const r2 = await Configuration.setSecret(WS_1, 'KEY', 'v2', ADMIN_USER);
    expect(r2.success).toBe(true);
    if (!r2.success) return;
    expect(r2.data.version).toBe(2);
    const getR = await Configuration.getSecret(WS_1, 'KEY', 'test');
    if (!getR.success) throw new Error('getSecret failed');
    expect(getR.data.value).toBe('v2');
  });

  test('§16 StandardResponse shape on all secret operations', async () => {
    const samples: StandardResponse<unknown>[] = [
      await Configuration.getSecret(WS_1, 'KEY', 'test'),
      await Configuration.setSecret(WS_1, 'KEY', 'val', ADMIN_USER),
      await Configuration.getSecret(WS_1, 'KEY', 'test'),
      await Configuration.deleteSecret(WS_1, 'KEY', ADMIN_USER),
      await Configuration.getSecret('', 'KEY', 'test'),
    ];
    for (const r of samples) {
      assertStandardResponseShape(r);
      if (r.success) {
        expect(r.data).not.toBeUndefined();
        expect((r as { error?: unknown }).error).toBeUndefined();
      } else {
        expect(r.error).not.toBeUndefined();
        expect((r as { data?: unknown }).data).toBeUndefined();
      }
    }
  });
});

// ===========================================================================
// 3. FUNCTIONAL — getProviderStatus / listConfiguredModules
// ===========================================================================

describe('FUNCTIONAL — getProviderStatus / listConfiguredModules', () => {
  test('getProviderStatus: UNKNOWN_MODULE for unrecognized moduleId', async () => {
    const r = await Configuration.getProviderStatus(WS_1, 'nonexistent_module');
    expect(r.success).toBe(false);
    if (r.success) return;
    expect(r.error.code).toBe(ConfigErrorCode.UNKNOWN_MODULE);
  });

  test('getProviderStatus: not configured when no secrets set', async () => {
    const r = await Configuration.getProviderStatus(WS_1, 'auth');
    expect(r.success).toBe(true);
    if (!r.success) return;
    expect(r.data.moduleId).toBe('auth');
    expect(r.data.configured).toBe(false);
    expect(r.data.requiredKeys).toContain('SUPABASE_URL');
    expect(r.data.missingKeys).toEqual(r.data.requiredKeys);
  });

  test('getProviderStatus: configured when all required keys set', async () => {
    await Configuration.setSecret(WS_1, 'SUPABASE_URL', 'https://x.supabase.co', ADMIN_USER);
    await Configuration.setSecret(WS_1, 'SUPABASE_ANON_KEY', 'anon', ADMIN_USER);
    await Configuration.setSecret(WS_1, 'SUPABASE_SERVICE_ROLE_KEY', 'srk', ADMIN_USER);
    const r = await Configuration.getProviderStatus(WS_1, 'auth');
    expect(r.success).toBe(true);
    if (!r.success) return;
    expect(r.data.configured).toBe(true);
    expect(r.data.missingKeys).toEqual([]);
  });

  test('getProviderStatus: partially configured shows missing keys', async () => {
    await Configuration.setSecret(WS_1, 'SUPABASE_URL', 'https://x.supabase.co', ADMIN_USER);
    const r = await Configuration.getProviderStatus(WS_1, 'auth');
    expect(r.success).toBe(true);
    if (!r.success) return;
    expect(r.data.configured).toBe(false);
    expect(r.data.missingKeys).toContain('SUPABASE_ANON_KEY');
    expect(r.data.missingKeys).toContain('SUPABASE_SERVICE_ROLE_KEY');
  });

  test('listConfiguredModules: returns all catalog modules with configured flag', async () => {
    await Configuration.setSecret(WS_1, 'SUPABASE_URL', 'u', ADMIN_USER);
    await Configuration.setSecret(WS_1, 'SUPABASE_ANON_KEY', 'a', ADMIN_USER);
    await Configuration.setSecret(WS_1, 'SUPABASE_SERVICE_ROLE_KEY', 's', ADMIN_USER);
    const r = await Configuration.listConfiguredModules(WS_1);
    expect(r.success).toBe(true);
    if (!r.success) return;
    const authMod = r.data.modules.find((m) => m.moduleId === 'auth');
    const mailMod = r.data.modules.find((m) => m.moduleId === 'mail');
    expect(authMod?.configured).toBe(true);
    expect(mailMod?.configured).toBe(false);
  });
});

// ===========================================================================
// 4. FUNCTIONAL — Feature flags
// ===========================================================================

describe('FUNCTIONAL — getFeatureFlag / setFeatureFlag', () => {
  test('setFeatureFlag then getFeatureFlag: returns value', async () => {
    const setR = await Configuration.setFeatureFlag(WS_1, 'enable_beta', 'true', ADMIN_USER);
    expect(setR.success).toBe(true);
    const getR = await Configuration.getFeatureFlag(WS_1, 'enable_beta');
    expect(getR.success).toBe(true);
    if (!getR.success) return;
    expect(getR.data.value).toBe('true');
  });

  test('getFeatureFlag: FEATURE_FLAG_NOT_FOUND for missing flag', async () => {
    const r = await Configuration.getFeatureFlag(WS_1, 'nonexistent_flag');
    expect(r.success).toBe(false);
    if (r.success) return;
    expect(r.error.code).toBe(ConfigErrorCode.FEATURE_FLAG_NOT_FOUND);
  });

  test('setFeatureFlag overwrites and increments version', async () => {
    await Configuration.setFeatureFlag(WS_1, 'flag', 'v1', ADMIN_USER);
    const r2 = await Configuration.setFeatureFlag(WS_1, 'flag', 'v2', ADMIN_USER);
    expect(r2.success).toBe(true);
    if (!r2.success) return;
    const getR = await Configuration.getFeatureFlag(WS_1, 'flag');
    if (!getR.success) throw new Error('getFeatureFlag failed');
    expect(getR.data.value).toBe('v2');
  });
});

// ===========================================================================
// 5. WORKSPACE ISOLATION
// ===========================================================================

describe('WORKSPACE ISOLATION', () => {
  test('Secret set in workspace 1 is NOT visible in workspace 2', async () => {
    await Configuration.setSecret(WS_1, 'STRIPE_SECRET_KEY', 'sk_ws1', ADMIN_USER);
    const r1 = await Configuration.getSecret(WS_1, 'STRIPE_SECRET_KEY', 'pay');
    const r2 = await Configuration.getSecret(WS_2, 'STRIPE_SECRET_KEY', 'pay');
    if (!r1.success) throw new Error('ws1 getSecret failed');
    expect(r1.data.value).toBe('sk_ws1');
    expect(r2.success).toBe(false);
    if (r2.success) return;
    expect(r2.error.code).toBe(ConfigErrorCode.SECRET_NOT_CONFIGURED);
  });

  test('Feature flag set in workspace 1 is NOT visible in workspace 2', async () => {
    await Configuration.setFeatureFlag(WS_1, 'flag', 'on', ADMIN_USER);
    const r2 = await Configuration.getFeatureFlag(WS_2, 'flag');
    expect(r2.success).toBe(false);
    if (r2.success) return;
    expect(r2.error.code).toBe(ConfigErrorCode.FEATURE_FLAG_NOT_FOUND);
  });

  test('Same key can have different values in different workspaces', async () => {
    await Configuration.setSecret(WS_1, 'STRIPE_SECRET_KEY', 'sk_ws1', ADMIN_USER);
    await Configuration.setSecret(WS_2, 'STRIPE_SECRET_KEY', 'sk_ws2', ADMIN_USER);
    const r1 = await Configuration.getSecret(WS_1, 'STRIPE_SECRET_KEY', 'pay');
    const r2 = await Configuration.getSecret(WS_2, 'STRIPE_SECRET_KEY', 'pay');
    if (!r1.success || !r2.success) throw new Error('getSecret failed');
    expect(r1.data.value).toBe('sk_ws1');
    expect(r2.data.value).toBe('sk_ws2');
  });

  test('getProviderStatus is workspace-scoped', async () => {
    await Configuration.setSecret(WS_1, 'SUPABASE_URL', 'u', ADMIN_USER);
    await Configuration.setSecret(WS_1, 'SUPABASE_ANON_KEY', 'a', ADMIN_USER);
    await Configuration.setSecret(WS_1, 'SUPABASE_SERVICE_ROLE_KEY', 's', ADMIN_USER);
    // WS_1 has auth configured; WS_2 does not.
    const r1 = await Configuration.getProviderStatus(WS_1, 'auth');
    const r2 = await Configuration.getProviderStatus(WS_2, 'auth');
    if (!r1.success || !r2.success) throw new Error('getProviderStatus failed');
    expect(r1.data.configured).toBe(true);
    expect(r2.data.configured).toBe(false);
  });
});

// ===========================================================================
// 6. MANDATORY RULE 1 — Secret Access Auditing
// ===========================================================================

describe('MANDATORY RULE 1 — Secret Access Auditing', () => {
  test('Every getSecret call is audit-logged with module, workspaceId, key, timestamp, success/failure', async () => {
    await Configuration.setSecret(WS_1, 'KEY', 'val', ADMIN_USER);

    // Successful getSecret
    await Configuration.getSecret(WS_1, 'KEY', 'pay');
    // Failed getSecret (missing key)
    await Configuration.getSecret(WS_1, 'MISSING', 'mail');

    const auditR = await Configuration.listAuditLog(WS_1);
    if (!auditR.success) throw new Error('listAuditLog failed');
    const entries = auditR.data.entries;
    expect(entries.length).toBeGreaterThanOrEqual(2);

    const successEntry = entries.find((e) => e.key === 'KEY' && e.success);
    const failureEntry = entries.find((e) => e.key === 'MISSING' && !e.success);
    expect(successEntry).toBeTruthy();
    expect(failureEntry).toBeTruthy();
    expect(successEntry!.module).toBe('pay');
    expect(successEntry!.workspaceId).toBe(WS_1);
    expect(successEntry!.at).toBeTruthy();
    expect(failureEntry!.module).toBe('mail');
    expect(failureEntry!.errorCode).toBe(ConfigErrorCode.SECRET_NOT_CONFIGURED);
  });

  test('Audit log NEVER contains the secret value', async () => {
    const SECRET_VALUE = 'sk_super_secret_value_xyz';
    await Configuration.setSecret(WS_1, 'STRIPE_SECRET_KEY', SECRET_VALUE, ADMIN_USER);
    await Configuration.getSecret(WS_1, 'STRIPE_SECRET_KEY', 'pay');

    // Inspect the raw audit log (via internal store — test-only access).
    const audit = store.listAudit(WS_1);
    const serialized = JSON.stringify(audit);
    expect(serialized).not.toContain(SECRET_VALUE);
  });

  test('Audit log is workspace-scoped (entries from WS_1 not visible in WS_2)', async () => {
    await Configuration.setSecret(WS_1, 'KEY', 'val', ADMIN_USER);
    await Configuration.getSecret(WS_1, 'KEY', 'pay');

    const r1 = await Configuration.listAuditLog(WS_1);
    const r2 = await Configuration.listAuditLog(WS_2);
    if (!r1.success || !r2.success) throw new Error('listAuditLog failed');
    expect(r1.data.entries.length).toBeGreaterThan(0);
    expect(r2.data.entries.length).toBe(0);
  });
});

// ===========================================================================
// 7. MANDATORY RULE 2 — Permission Enforcement (external)
// ===========================================================================

describe('MANDATORY RULE 2 — Permission Enforcement is external', () => {
  test('Configuration has NO permission check — setSecret does not verify actor roles', async () => {
    // Even a "non-admin" userId can set a secret. The caller (Admin
    // Dashboard) is responsible for checking Organizations.checkPermission
    // before calling setSecret. Configuration trusts the caller.
    const r = await Configuration.setSecret(WS_1, 'KEY', 'val', 'user_nobody_001');
    expect(r.success).toBe(true);
  });

  test('Configuration does NOT import or call Organizations', async () => {
    const fs = await import('fs');
    const src = fs.readFileSync('/home/z/my-project/src/config/index.ts', 'utf-8');
    // Must NOT import from Organizations module.
    expect(src).not.toMatch(/from ['"]@\/modules\/organizations/);
    // Must NOT call Organizations.checkPermission (in code, not comments).
    // Strip comments before checking to avoid false positives on JSDoc that
    // merely DOCUMENTS the external permission boundary.
    const codeOnly = src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');
    expect(codeOnly).not.toMatch(/Organizations\.checkPermission/);
    expect(codeOnly).not.toMatch(/Organizations\./);
  });

  test('Configuration does NOT expose any permission-related function', () => {
    const publicKeys = Object.keys(Configuration);
    expect(publicKeys).not.toContain('checkPermission');
    expect(publicKeys).not.toContain('hasPermission');
    expect(publicKeys).not.toContain('requireOwner');
  });
});

// ===========================================================================
// 8. MANDATORY RULE 3 — Encryption at rest
// ===========================================================================

describe('MANDATORY RULE 3 — Encryption at rest', () => {
  test('Secret value is NOT stored in plaintext in the store', async () => {
    const SECRET_VALUE = 'sk_test_plaintext_check_12345';
    await Configuration.setSecret(WS_1, 'STRIPE_SECRET_KEY', SECRET_VALUE, ADMIN_USER);

    // Inspect the raw store record (via internal store — test-only access).
    const record = store.getSecret(WS_1, 'STRIPE_SECRET_KEY');
    expect(record).toBeTruthy();
    if (!record) return;
    // The encrypted payload should NOT contain the plaintext value.
    const serialized = JSON.stringify(record);
    expect(serialized).not.toContain(SECRET_VALUE);
  });

  test('Encrypted ciphertext is not the plaintext', async () => {
    const plaintext = 'my_secret_value';
    const payload = encrypt(plaintext);
    expect(isPlaintextVisible(payload, plaintext)).toBe(false);
    expect(payload.ciphertext).not.toBe(plaintext);
  });

  test('Decrypt recovers the original value', async () => {
    const plaintext = 'decrypt_me_please';
    const payload = encrypt(plaintext);
    const recovered = decrypt(payload);
    expect(recovered).toBe(plaintext);
  });

  test('Each encryption produces a unique IV (same plaintext → different ciphertext)', async () => {
    const plaintext = 'same_value';
    const p1 = encrypt(plaintext);
    const p2 = encrypt(plaintext);
    expect(p1.iv).not.toBe(p2.iv);
    expect(p1.ciphertext).not.toBe(p2.ciphertext);
  });

  test('Decryption fails with wrong master key (tamper detection)', async () => {
    process.env.CODELOK_CONFIG_MASTER_KEY = 'key_A_______________________________________________'; // 64 hex chars
    _resetMasterKeyForTesting();
    await Configuration.setSecret(WS_1, 'KEY', 'val_with_key_A', ADMIN_USER);

    // Switch to a different master key.
    process.env.CODELOK_CONFIG_MASTER_KEY = 'key_B_______________________________________________';
    _resetMasterKeyForTesting();

    const r = await Configuration.getSecret(WS_1, 'KEY', 'test');
    expect(r.success).toBe(false);
    if (r.success) return;
    expect(r.error.code).toBe(ConfigErrorCode.ENCRYPTION_ERROR);
  });

  test('Master key from CODELOK_CONFIG_MASTER_KEY env var (hex format)', async () => {
    process.env.CODELOK_CONFIG_MASTER_KEY = 'ab'.repeat(32); // 64 hex chars = 32 bytes
    _resetMasterKeyForTesting();
    const r = await Configuration.setSecret(WS_1, 'KEY', 'val', ADMIN_USER);
    expect(r.success).toBe(true);
    const getR = await Configuration.getSecret(WS_1, 'KEY', 'test');
    expect(getR.success).toBe(true);
    if (!getR.success) return;
    expect(getR.data.value).toBe('val');
  });
});

// ===========================================================================
// 9. MANDATORY RULE 4 — Configuration Versioning
// ===========================================================================

describe('MANDATORY RULE 4 — Configuration Versioning', () => {
  test('First setSecret produces version 1', async () => {
    const r = await Configuration.setSecret(WS_1, 'KEY', 'v1', ADMIN_USER);
    expect(r.success).toBe(true);
    if (!r.success) return;
    expect(r.data.version).toBe(1);
  });

  test('Subsequent setSecret increments version', async () => {
    await Configuration.setSecret(WS_1, 'KEY', 'v1', ADMIN_USER);
    const r2 = await Configuration.setSecret(WS_1, 'KEY', 'v2', ADMIN_USER);
    const r3 = await Configuration.setSecret(WS_1, 'KEY', 'v3', ADMIN_USER);
    if (!r2.success || !r3.success) throw new Error('setSecret failed');
    expect(r2.data.version).toBe(2);
    expect(r3.data.version).toBe(3);
  });

  test('Version metadata includes updatedBy and updatedAt', async () => {
    await Configuration.setSecret(WS_1, 'KEY', 'val', 'user_alice', );
    const record = store.getSecret(WS_1, 'KEY');
    expect(record).toBeTruthy();
    if (!record) return;
    expect(record.updatedBy).toBe('user_alice');
    expect(record.updatedAt).toBeTruthy();
    // updatedAt should be a valid ISO date.
    expect(new Date(record.updatedAt).toISOString()).toBe(record.updatedAt);
  });

  test('updatedBy changes when different admin updates the secret', async () => {
    await Configuration.setSecret(WS_1, 'KEY', 'v1', 'user_alice');
    await Configuration.setSecret(WS_1, 'KEY', 'v2', 'user_bob');
    const record = store.getSecret(WS_1, 'KEY');
    expect(record?.updatedBy).toBe('user_bob');
    expect(record?.version).toBe(2);
  });

  test('Feature flags are also versioned', async () => {
    const r1 = await Configuration.setFeatureFlag(WS_1, 'flag', 'v1', ADMIN_USER);
    const r2 = await Configuration.setFeatureFlag(WS_1, 'flag', 'v2', ADMIN_USER);
    if (!r1.success || !r2.success) throw new Error('setFeatureFlag failed');
    expect(r1.data.value).toBe('v1');
    expect(r2.data.value).toBe('v2');
    // Verify the store record has version metadata.
    const record = store.getFeatureFlag(WS_1, 'flag');
    expect(record?.version).toBe(2);
    expect(record?.updatedBy).toBe(ADMIN_USER);
  });
});

// ===========================================================================
// 10. COMPLIANCE — §3.6 StandardResponse on all functions
// ===========================================================================

describe('COMPLIANCE — §3.6 StandardResponse shape (all functions)', () => {
  test('Every public function returns the success-or-error envelope', async () => {
    await Configuration.setSecret(WS_1, 'KEY', 'val', ADMIN_USER);
    const samples: StandardResponse<unknown>[] = [
      await Configuration.getSecret(WS_1, 'KEY', 'test'),
      await Configuration.getSecret(WS_1, 'MISSING', 'test'),
      await Configuration.setSecret(WS_1, 'KEY2', 'val', ADMIN_USER),
      await Configuration.deleteSecret(WS_1, 'KEY', ADMIN_USER),
      await Configuration.getProviderStatus(WS_1, 'auth'),
      await Configuration.getProviderStatus(WS_1, 'bogus'),
      await Configuration.listConfiguredModules(WS_1),
      await Configuration.getFeatureFlag(WS_1, 'flag'),
      await Configuration.setFeatureFlag(WS_1, 'flag', 'on', ADMIN_USER),
      await Configuration.getFeatureFlag(WS_1, 'flag'),
      await Configuration.listAuditLog(WS_1),
    ];
    for (const r of samples) {
      assertStandardResponseShape(r);
      if (r.success) {
        expect(r.data).not.toBeUndefined();
        expect((r as { error?: unknown }).error).toBeUndefined();
      } else {
        expect(r.error).not.toBeUndefined();
        expect((r as { data?: unknown }).data).toBeUndefined();
      }
    }
  });
});

// ===========================================================================
// 11. COMPLIANCE — §16 "no global/default secret" (§3.7 compliance)
// ===========================================================================

describe('COMPLIANCE — §16 no global/default fallback', () => {
  test('Secret set in workspace 1 does NOT leak to workspace 2 or __global__', async () => {
    await Configuration.setSecret(WS_1, 'KEY', 'ws1_val', ADMIN_USER);
    const r2 = await Configuration.getSecret(WS_2, 'KEY', 'test');
    const rGlobal = await Configuration.getSecret('__global__', 'KEY', 'test');
    expect(r2.success).toBe(false);
    expect(rGlobal.success).toBe(false);
  });

  test('No testConnection() (§16 explicitly excludes it)', () => {
    expect((Configuration as unknown as Record<string, unknown>).testConnection)
      .toBeUndefined();
  });

  test('getSecret returns raw value only — no SDK client construction', async () => {
    await Configuration.setSecret(WS_1, 'KEY', 'raw_value', ADMIN_USER);
    const r = await Configuration.getSecret(WS_1, 'KEY', 'test');
    expect(r.success).toBe(true);
    if (!r.success) return;
    // Data should be { value: string } — nothing else.
    expect(r.data).toEqual({ value: 'raw_value' });
    expect(r.data).not.toHaveProperty('client');
    expect(r.data).not.toHaveProperty('sdk');
  });
});

// ===========================================================================
// 12. REGRESSION — Auth + Organizations still work with real Configuration
// ===========================================================================

describe('REGRESSION — Auth/Organizations compatibility', () => {
  test('Auth.resolveSupabaseCredentials returns null when no secrets configured (preserves §3.7 behavior)', async () => {
    // This is the exact behavior the §3.7 Auth test relies on:
    // when Supabase credentials are not configured, Auth returns
    // AUTH_PROVIDER_NOT_CONFIGURED. The Configuration store is empty
    // → getSecret returns SECRET_NOT_CONFIGURED → Auth's adapter
    // catches and returns null → AUTH_PROVIDER_NOT_CONFIGURED.
    // We verify the Configuration side here; the Auth test suite
    // (36 tests, unmodified) verifies the Auth side end-to-end.
    const { resolveSupabaseCredentials } = await import('@/modules/auth/adapters/supabase');
    const result = await resolveSupabaseCredentials(undefined);
    expect(result).toBeNull();
  });

  test('Auth.resolveSupabaseCredentials returns credentials when all 3 secrets are configured', async () => {
    await Configuration.setSecret('__global__', 'SUPABASE_URL', 'https://x.supabase.co', ADMIN_USER);
    await Configuration.setSecret('__global__', 'SUPABASE_ANON_KEY', 'anon_key_val', ADMIN_USER);
    await Configuration.setSecret('__global__', 'SUPABASE_SERVICE_ROLE_KEY', 'srk_val', ADMIN_USER);

    const { resolveSupabaseCredentials } = await import('@/modules/auth/adapters/supabase');
    const result = await resolveSupabaseCredentials(undefined);
    expect(result).not.toBeNull();
    expect(result!.url).toBe('https://x.supabase.co');
    expect(result!.anonKey).toBe('anon_key_val');
    expect(result!.serviceRoleKey).toBe('srk_val');
  });

  test('Auth.resolveSupabaseCredentials returns null when only 2 of 3 secrets configured', async () => {
    await Configuration.setSecret('__global__', 'SUPABASE_URL', 'https://x.supabase.co', ADMIN_USER);
    await Configuration.setSecret('__global__', 'SUPABASE_ANON_KEY', 'anon_key_val', ADMIN_USER);
    // Missing: SUPABASE_SERVICE_ROLE_KEY

    const { resolveSupabaseCredentials } = await import('@/modules/auth/adapters/supabase');
    const result = await resolveSupabaseCredentials(undefined);
    expect(result).toBeNull();
  });
});

// ===========================================================================
// v1.2 — Workspace Settings (persistent configuration, not feature flags)
// ===========================================================================

describe('v1.2 — Workspace Settings', () => {
  test('Configuration public surface exposes getSetting/setSetting/deleteSetting', () => {
    expect(Object.keys(Configuration)).toContain('getSetting');
    expect(Object.keys(Configuration)).toContain('setSetting');
    expect(Object.keys(Configuration)).toContain('deleteSetting');
  });

  test('setSetting then getSetting returns persistent workspace configuration', async () => {
    const setResult = await Configuration.setSetting(WS_1, 'default_provider:pay', 'stripe', ADMIN_USER);
    expect(setResult.success).toBe(true);
    expect(setResult.data?.version).toBe(1);
    const getResult = await Configuration.getSetting(WS_1, 'default_provider:pay');
    expect(getResult.success).toBe(true);
    expect(getResult.data?.value).toBe('stripe');
  });

  test('settings are workspace-isolated', async () => {
    await Configuration.setSetting(WS_1, 'default_provider:pay', 'stripe', ADMIN_USER);
    const other = await Configuration.getSetting(WS_2, 'default_provider:pay');
    expect(other.success).toBe(false);
    expect(other.error?.code).toBe('SETTING_NOT_FOUND');
  });

  test('setting updates increment version and preserve attribution', async () => {
    await Configuration.setSetting(WS_1, 'default_provider:pay', 'stripe', ADMIN_USER);
    const updated = await Configuration.setSetting(WS_1, 'default_provider:pay', 'paystack', 'user_admin_002');
    expect(updated.success).toBe(true);
    expect(updated.data?.version).toBe(2);
    expect(updated.data?.updatedBy).toBe('user_admin_002');
  });

  test('deleteSetting removes the workspace setting', async () => {
    await Configuration.setSetting(WS_1, 'default_provider:mail', 'resend', ADMIN_USER);
    const removed = await Configuration.deleteSetting(WS_1, 'default_provider:mail');
    expect(removed.success).toBe(true);
    const missing = await Configuration.getSetting(WS_1, 'default_provider:mail');
    expect(missing.success).toBe(false);
    expect(missing.error?.code).toBe('SETTING_NOT_FOUND');
  });

  test('provider selection setting does not mutate provider registry metadata', async () => {
    const before = await Configuration.listProviders('pay');
    await Configuration.setSetting(WS_1, 'default_provider:pay', 'stripe', ADMIN_USER);
    const after = await Configuration.listProviders('pay');
    expect(after.data?.providers).toEqual(before.data?.providers);
  });
});
