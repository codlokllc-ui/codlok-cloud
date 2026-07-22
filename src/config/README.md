# Codlok Cloud — Configuration Service v1.0

> **Status:** Built against Master Spec §16 (Configuration Service Module Specification v1.0 — STATUS: FROZEN). Spec Version 1.5.
> **Build Order:** Phase 2 — Configuration Service (per §13).
> **Validation:** §16 public interface verified against actual Auth stub usage. 5 conflicts found (see `download/CONFIGURATION_BLOCKER_REPORT.md`). Option B approved: Auth's internal `resolveSupabaseCredentials` rewired to call `getSecret` 3x; all 36 Auth tests pass unmodified.

## Purpose

Answers **"what is the current, correct provider credential/setting for this module, in this workspace?"** It is the single authoritative store for secrets and per-workspace provider configuration (§3.4, §3.7).

**Out of scope:** business logic, provider SDK client construction, connection testing. Each consuming module constructs its own client from the raw value `getSecret()` returns.

## Durable authority

Production Configuration records are stored in Supabase and scoped by
`workspace_id`, deployment `environment`, record kind, and key. Secret values
are AES-256-GCM ciphertext; settings and feature flags are structured JSON.
Database-side upserts increment versions atomically, and secret reads append to
the server-only audit table. Tests and local development retain the in-memory
repository.

Production fails closed without `SUPABASE_URL`,
`SUPABASE_SERVICE_ROLE_KEY`, or `CODELOK_CONFIG_MASTER_KEY`.
`CODELOK_ENVIRONMENT` must classify a deployment as `development`, `staging`,
or `production`.

## Public Interface (§16)

Every function returns the StandardResponse shape (§3.6). No exceptions.

| Function | Inputs | Success `data` | Error codes |
|---|---|---|---|
| `getSecret` | `workspaceId, key, module?` | `{ value }` | `SECRET_NOT_CONFIGURED`, `WORKSPACE_NOT_FOUND` |
| `setSecret` | `workspaceId, key, value, actorUserId` | `{ key, configured: true, version }` | `INVALID_KEY`, `WORKSPACE_NOT_FOUND` |
| `deleteSecret` | `workspaceId, key, actorUserId` | `{ key, configured: false }` | `SECRET_NOT_CONFIGURED`, `WORKSPACE_NOT_FOUND` |
| `getProviderStatus` | `workspaceId, moduleId` | `{ moduleId, configured, requiredKeys, missingKeys }` | `WORKSPACE_NOT_FOUND`, `UNKNOWN_MODULE` |
| `listConfiguredModules` | `workspaceId` | `{ modules: [{ moduleId, configured }] }` | `WORKSPACE_NOT_FOUND` |
| `getFeatureFlag` | `workspaceId, key` | `{ key, value }` | `FEATURE_FLAG_NOT_FOUND`, `WORKSPACE_NOT_FOUND` |
| `setFeatureFlag` | `workspaceId, key, value, actorUserId` | `{ key, value }` | `INVALID_KEY`, `WORKSPACE_NOT_FOUND` |
| `listAuditLog` *(internal/test)* | `workspaceId, limit?` | `{ entries: AuditLogEntry[] }` | `WORKSPACE_NOT_FOUND` |

**Explicitly excluded** (per §16 line 594): `testConnection()` and any function returning a constructed provider client.

### Key design decisions (per §16)

- **`getSecret()` returns raw values, not provider clients.** Each module builds its own SDK client. Configuration never imports a provider SDK.
- **No `testConnection()`.** Connection validation stays with each consuming module.
- **`setSecret`/`deleteSecret` take no role/permission logic inside Configuration.** Permission checks are enforced externally by the Admin Dashboard via `Organizations.checkPermission()` (Owner-only). Configuration trusts the caller — it records `actorUserId` for versioning metadata only, not for authorization.
- **Feature flags are plain key-value config** — not business logic or permissions. Kept in Configuration to prevent scope creep.

## Mandatory Rules (§16)

### 1. Secret Access Auditing

Every `getSecret()` call is logged with: `module`, `workspaceId`, `key`, `at` (timestamp), `success` (boolean), `errorCode` (if failed). **The secret value is NEVER logged.** Verified by test: audit log serialization does not contain the secret value.

### 2. Permission Enforcement (external)

Configuration has NO concept of Owner/Admin/Member. It does NOT import Organizations. It does NOT call `Organizations.checkPermission()`. The caller (Admin Dashboard) is responsible for verifying the actor has Owner permission before calling `setSecret`/`deleteSecret`. Verified by source-inspection test and by the absence of any permission function on the public surface.

### 3. Encryption at rest

Secrets are encrypted via **AES-256-GCM** (authenticated encryption). See "Master-key strategy" below.

### 4. Configuration Versioning

Every `setSecret` call increments a `version` number and stores `updatedBy` (actor userId) and `updatedAt` (ISO timestamp) as metadata. The secret value stays encrypted; only metadata is retained. Feature flags are also versioned. Old versions are not retained in v1 (version number is monotonic); a future migration may add history retention.

## Master-key strategy (documented per §16 Mandatory Rule 3)

**Chosen: Environment-injected master key (AES-256-GCM).**

### Rationale

| Strategy | Verdict |
|---|---|
| Cloud KMS (AWS/GCP) | Rejected — adds network dependency and cloud-provider-specific configuration. Too opinionated for a platform that may be self-hosted. |
| Hardware key (HSM) | Rejected — expensive and over-engineered for v1. |
| **Environment-injected master key** | **Chosen** — simplest strategy satisfying §16's requirement. Key never lives in code or git, injected at deploy time, can be rotated by changing the env var. |

### Implementation

- **Master key source:** `CODELOK_CONFIG_MASTER_KEY` env var.
  - Accepted formats: 64-char hex string (32 bytes), 32-char raw string, or any string (derived via scrypt).
  - If absent: a deterministic dev-only key is derived from a fixed salt. A warning is logged. **DO NOT use in production.**
- **Algorithm:** AES-256-GCM (authenticated encryption — detects tampering).
- **IV:** Fresh random 12-byte IV per encryption (never reused).
- **Storage:** Ciphertext, IV, and auth tag are stored together in the `EncryptedSecret` record.
- **Tamper detection:** If the master key changes, decryption fails with `ENCRYPTION_ERROR` (verified by test).

### Rotation

To rotate the master key in a future phase: change `CODELOK_CONFIG_MASTER_KEY`, then re-encrypt all secrets (a migration tool would iterate `setSecret` for each key). For v1, rotation means re-setting all secrets via the Admin Dashboard.

## Internal Architecture

```
src/config/
├── index.ts                    ← Public interface (§16 functions + getConfigurationService singleton)
├── README.md                   ← This file
├── internal/
│   ├── errors.ts               ← ConfigErrorCode enum (CONFIG_ namespace)
│   ├── types.ts                ← SecretRecord, FeatureFlagRecord, AuditLogEntry, ModuleCatalog, ConfigError
│   ├── crypto.ts               ← AES-256-GCM encrypt/decrypt + master-key resolution
│   └── store.ts                ← In-memory store (globalThis singleton; Phase 3 will replace with persistent DB)
└── __tests__/
    └── config.test.ts          ← 48 tests (boundary + functional + compliance + regression)
```

### Module catalog (for `getProviderStatus`)

| Module | Required keys |
|---|---|
| `auth` | `SUPABASE_URL`, `SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY` |
| `mail` | `RESEND_API_KEY` |
| `sms` | `TWILIO_ACCOUNT_SID`, `TWILIO_AUTH_TOKEN` |
| `storage` | `STORAGE_PROVIDER`, `STORAGE_BUCKET`, `STORAGE_ACCESS_KEY`, `STORAGE_SECRET_KEY` |
| `pay` | `STRIPE_SECRET_KEY` |
| `ai` | `OPENAI_API_KEY` |

Adding a new module means adding an entry to `MODULE_CATALOG` in `internal/types.ts` — no public interface change.

## Auth v1.1 Rewiring (Option B)

Per the approved Option B directive, Auth's internal `resolveSupabaseCredentials` function (in `src/modules/auth/adapters/supabase.ts`) was rewired:

**Before (Phase 1 stub):**
```typescript
const secrets = await config.getSecrets(['SUPABASE_URL', ...], workspaceId);
const url = secrets.SUPABASE_URL?.value;
```

**After (§16 interface):**
```typescript
const [urlR, anonR, serviceR] = await Promise.all([
  config.getSecret(ws, 'SUPABASE_URL', 'auth'),
  config.getSecret(ws, 'SUPABASE_ANON_KEY', 'auth'),
  config.getSecret(ws, 'SUPABASE_SERVICE_ROLE_KEY', 'auth'),
]);
const url = urlR.success ? urlR.data.value : undefined;
```

**Behavioral preservation:**
- `SECRET_NOT_CONFIGURED` error → `undefined` value → null return → `AUTH_PROVIDER_NOT_CONFIGURED` (same as Phase 1 stub).
- `WORKSPACE_NOT_FOUND` error → `undefined` value → null return (same).
- Any other error → `undefined` value → null return (same).
- No unhandled rejections. No different error path.

**`workspaceId` handling:** §16 requires `workspaceId`. Auth's `resolveSupabaseCredentials` takes optional `workspaceId`. When undefined, a sentinel `'__global__'` scope is used. Per §16 line 597 ("no global/default secret"), this scope is empty unless explicitly populated via `setSecret`. This preserves the Phase 1 behavior where Auth could resolve credentials without a workspace context (in tests, `CODELOK_AUTH_USE_MOCK=true` bypasses this path entirely; the §3.7 test relies on the empty-store → null → `AUTH_PROVIDER_NOT_CONFIGURED` path).

**What did NOT change:**
- Auth public interface (8 v1.0 functions + `getUser` from v1.1) — untouched.
- All 36 Auth tests — pass unmodified.
- Auth's `requireAdapter` / `resolveAdapter` flow — untouched.
- Auth's error codes — untouched.

## Core Spec Compliance Checklist (§16)

- [x] Uses only the standard API response format (§3.6) — enforced by `_configErrorToResponse` boundary helper; verified by §3.6 compliance test across 11 sample responses
- [x] Secrets never appear in logs, error messages, or non-owning-module responses; only access metadata is logged — verified by audit-log-serialization test
- [x] Respects workspace isolation — no cross-workspace secret access; verified by 4 workspace-isolation tests
- [x] Exposes only public interfaces — `internal/` not on public surface; verified by boundary tests
- [x] Does not access other modules' internals; does not call Organizations directly — verified by source-inspection test (strips comments, checks for Organizations imports/calls in code)
- [x] Uses Codlok-standard error codes — `ConfigErrorCode` enum, all codes UPPER_SNAKE_CASE
- [x] Existing Auth/Organizations calls into the Phase 1 stub continue working unmodified against this real interface — verified by 153-test regression (36 Auth + 69 Organizations + 48 Configuration, all passing)
- [x] Secrets encrypted at rest; master-key strategy documented in Build Report — AES-256-GCM, env-injected master key, documented above
- [x] Secret changes versioned with updatedBy/updatedAt metadata — verified by 5 versioning tests

## Test Coverage (Rule 12 — Pre-freeze Test Requirement)

48 tests in `src/config/__tests__/config.test.ts`:

### Boundary tests (4)
- Public surface exposes only §16 functions
- Public surface does NOT expose internal store/crypto
- `getConfigurationService()` returns the Configuration object
- No `testConnection()` in public surface

### Functional tests — secrets (8)
- setSecret → getSecret round-trip
- getSecret: SECRET_NOT_CONFIGURED for missing key
- getSecret: WORKSPACE_NOT_FOUND for empty workspaceId
- setSecret: INVALID_KEY for empty key
- deleteSecret: success after setSecret
- deleteSecret: SECRET_NOT_CONFIGURED for missing key
- setSecret overwrites and increments version
- §3.6 StandardResponse shape on all secret operations

### Functional tests — provider status (5)
- getProviderStatus: UNKNOWN_MODULE
- getProviderStatus: not configured when no secrets
- getProviderStatus: configured when all required keys set
- getProviderStatus: partially configured shows missing keys
- listConfiguredModules: returns all catalog modules

### Functional tests — feature flags (3)
- setFeatureFlag → getFeatureFlag round-trip
- getFeatureFlag: FEATURE_FLAG_NOT_FOUND
- setFeatureFlag overwrites and increments version

### Workspace isolation (4)
- Secret in WS_1 not visible in WS_2
- Feature flag in WS_1 not visible in WS_2
- Same key can have different values in different workspaces
- getProviderStatus is workspace-scoped

### Mandatory Rule 1 — Secret Access Auditing (3)
- Every getSecret call audit-logged with module/workspaceId/key/timestamp/success
- Audit log NEVER contains the secret value
- Audit log is workspace-scoped

### Mandatory Rule 2 — Permission Enforcement external (3)
- Configuration has NO permission check (non-admin can setSecret)
- Configuration does NOT import Organizations (source inspection)
- Configuration does NOT expose permission-related functions

### Mandatory Rule 3 — Encryption at rest (6)
- Secret value NOT stored in plaintext in the store
- Encrypted ciphertext is not the plaintext
- Decrypt recovers the original value
- Each encryption produces a unique IV
- Decryption fails with wrong master key (tamper detection)
- Master key from CODELOK_CONFIG_MASTER_KEY env var

### Mandatory Rule 4 — Configuration Versioning (5)
- First setSecret produces version 1
- Subsequent setSecret increments version
- Version metadata includes updatedBy and updatedAt
- updatedBy changes when different admin updates
- Feature flags are also versioned

### Compliance — §3.6 + §16 (3)
- Every public function returns StandardResponse envelope (11 samples)
- No global/default fallback (§16 line 597)
- getSecret returns raw value only — no SDK client construction

### Regression — Auth/Organizations compatibility (3)
- resolveSupabaseCredentials returns null when no secrets configured (preserves §3.7)
- resolveSupabaseCredentials returns credentials when all 3 secrets configured
- resolveSupabaseCredentials returns null when only 2 of 3 secrets configured

## Files

```
src/config/
├── index.ts                    ← Public interface (replaces Phase 1 stub)
├── README.md                   ← This file
├── internal/
│   ├── errors.ts               ← ConfigErrorCode enum
│   ├── types.ts                ← SecretRecord, FeatureFlagRecord, AuditLogEntry, ModuleCatalog, ConfigError
│   ├── crypto.ts               ← AES-256-GCM encrypt/decrypt + master-key resolution
│   └── store.ts                ← In-memory store (globalThis singleton)
└── __tests__/
    └── config.test.ts          ← 48 tests

src/modules/auth/adapters/supabase.ts  ← REWIRED (resolveSupabaseCredentials: getSecrets → 3x getSecret)
```

## Phase 2 Trade-offs

1. **In-memory store** (`internal/store.ts`) — Phase 2 backing; will be replaced with a persistent encrypted database per §3.5 when the DB provisioning layer arrives. Store interface is internal, so no public surface change will be needed.

2. **Dev-only master key fallback** — when `CODELOK_CONFIG_MASTER_KEY` is not set, a deterministic dev key is derived via scrypt. This is safe for local dev and tests but MUST NOT be used in production. A warning is logged. Future work: enforce that production deployments fail-fast if the master key is missing.

3. **No secret history retention** — v1 stores only the current version (with version number and metadata). Old values are overwritten. A future phase may add history retention for rollback. The version number is monotonic, enabling audit trail reconstruction from the audit log.

4. **`__global__` workspace sentinel** — Auth's `resolveSupabaseCredentials` takes optional `workspaceId`. When undefined, `'__global__'` is used as the workspace scope. Per §16 line 597, there is no global/default secret — so `'__global__'` is just an empty scope that returns `SECRET_NOT_CONFIGURED` unless explicitly populated. This preserves Auth's Phase 1 behavior without violating §16.
