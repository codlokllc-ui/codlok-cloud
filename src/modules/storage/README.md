# Codlok Cloud — Storage Module v1.0

> **Status:** Built against Master Spec §18 (Storage Module Specification v1.0 — STATUS: FROZEN). Spec Version 2.1.
> **Build Order:** Phase 2 — Storage (per §13).
> **Validation:** No frozen module assumes a different Storage shape. Configuration's `MODULE_CATALOG` entry for `storage` (keys: `STORAGE_PROVIDER`, `STORAGE_BUCKET`, `STORAGE_ACCESS_KEY`, `STORAGE_SECRET_KEY`) is the only existing assumption — §18 reads these keys via `Configuration.getSecret()`, no conflict. All 191 existing tests pass unmodified.

## Purpose

Answers **"where do file bytes physically live, and how does a module get them in or out reliably?"** Storage manages binary object lifecycle only — it has no knowledge of what a file *means*.

**Out of scope:** Business meaning of files, authorization decisions, cascading deletes, virus scanning.

## Public Interface (§18)

Every function returns StandardResponse (§3.6). No exceptions.

| Function | Inputs | Success `data` | Error codes |
|---|---|---|---|
| `createUpload` | `workspaceId, mimeType, expectedSizeBytes, expectedChecksum` | `{ uploadId, fileId, presignedUploadUrl, expiresAt, uploadHeaders }` | `WORKSPACE_NOT_FOUND`, `PROVIDER_NOT_CONFIGURED`, `INVALID_MIME_TYPE` |
| `completeUpload` | `workspaceId, uploadId` | `{ fileId, state: "UPLOADED", checksum, sizeBytes }` | `UPLOAD_NOT_FOUND`, `CHECKSUM_MISMATCH`, `UPLOAD_INCOMPLETE`, `UPLOAD_EXPIRED` |
| `getDownloadUrl` | `workspaceId, fileId` | `{ downloadUrl, expiresAt }` | `FILE_NOT_FOUND`, `FILE_NOT_UPLOADED` |
| `getFile` | `workspaceId, fileId` | `{ fileId, mimeType, sizeBytes, checksum, state, createdAt }` | `FILE_NOT_FOUND` |
| `deleteFile` | `workspaceId, fileId` | `{ fileId, state: "DELETED" }` | `FILE_NOT_FOUND` |
| `fileExists` | `workspaceId, fileId` | `{ exists: boolean }` | _(none — returns exists=false)_ |
| `getProviderStatus` | `workspaceId` | `{ configured: boolean, provider: string \| null }` | `WORKSPACE_NOT_FOUND` |

**Explicitly excluded** (per §18 line 785): `approveEvidence()`, `attachPhoto()`, `linkMission()`, `getLatestVersion()`, or any function implying business meaning or cross-version relationships.

## Upload Model — Presigned Two-Phase (§18 line 741, binding)

Bytes never pass through Codlok's servers. The client uploads directly to the provider:

```
1. createUpload(workspaceId, mimeType, size, checksum)
   → Storage creates presigned upload URL + fileId + uploadId
   → Returns { presignedUploadUrl, uploadId, fileId, ... }

2. Client PUTs bytes directly to presignedUploadUrl
   (Codlok's servers are NOT involved — bytes go straight to S3/R2/Supabase)

3. completeUpload(workspaceId, uploadId)
   → Storage verifies object exists at provider
   → Verifies size matches expectedSizeBytes
   → Verifies SHA-256 checksum matches expectedChecksum
   → Transitions state PENDING → UPLOADING → UPLOADED
   → Returns { fileId, state: "UPLOADED", checksum, sizeBytes }
```

## Upload State Rule (§18 line 787, binding)

```
PENDING → UPLOADING → UPLOADED → DELETED
                    ↘ FAILED (terminal)
PENDING → FAILED (terminal, e.g. expired before any bytes arrived)
```

- **FAILED is terminal.** No retry path. Client calls `createUpload()` again for a fresh `uploadId` + `fileId`.
- **UPLOADED is immutable.** No `UPLOADED → PENDING` or `UPLOADED → UPLOADING` transition. Content changes always produce a new `fileId`.
- **Abandoned uploads auto-expire.** PENDING/UPLOADING uploads past TTL → FAILED (Storage's own responsibility per §3.11).

### Upload Abandonment TTL: 1 HOUR

Rationale: long enough for a client to complete a large file upload (evidence photos, videos), short enough to not accumulate stale entries. Cleanup is triggered lazily on every `createUpload()` and `completeUpload()` call — no background timer needed for v1. In production, a cron job would also call `_cleanupAbandonedUploads()` periodically.

## Mandatory Rules (§18)

1. **Checksum required, not optional.** Every upload requires a caller-supplied `expectedChecksum` (SHA-256) at `createUpload()`, verified at `completeUpload()`. No upload can complete without a matching checksum.

2. **Immutability.** Uploaded objects are never overwritten. A changed file is a new upload with a new `fileId`. Storage has no "current version" concept — that's the owning module's decision.

3. **Provider abstraction.** Callers never know whether a workspace uses S3, R2, or Supabase Storage.

4. **Workspace isolation.** Every function requires `workspaceId`; no cross-workspace file access.

5. **No business knowledge (§3.10).** Storage stores no business-reference fields. Enforced by the public interface containing no such parameters.

6. **No cascading deletes (§3.11).** Deleting a business record does not automatically delete its file — the owning module must call `deleteFile()` itself.

7. **Upload abandonment cleanup.** Incomplete uploads auto-expire to FAILED per the TTL rule — Storage's responsibility, not the caller's.

8. **Logical-then-physical delete.** `deleteFile()` marks `DELETED` immediately and returns; physical provider removal happens asynchronously with retry, never blocking the caller.

## Logical-Then-Physical Delete (§18 line 773)

Same philosophy as Mail's queue-and-retry:

```
deleteFile(workspaceId, fileId)
  → state transitions to DELETED immediately
  → function returns { fileId, state: "DELETED" }
  → physical provider removal happens ASYNC with retry (non-blocking)

A DELETED file is immediately inaccessible via getDownloadUrl()/getFile()
regardless of whether physical removal has completed.
```

Physical deletion retry: exponential backoff (2.5s, 5s, 10s, 20s in production; 0ms in test mode), max 4 retries (5 total attempts). After max retries, `physicalDeletionStatus` = `failed` (the logical DELETED state is unaffected — the file is already inaccessible).

## Internal Architecture

```
src/modules/storage/
├── index.ts                    ← Public interface (§18 functions)
├── README.md                   ← This file
├── internal/
│   ├── errors.ts               ← StorageErrorCode enum
│   ├── types.ts                ← FileRecord, StorageProviderAdapter, StorageError
│   ├── store.ts                ← In-memory store (globalThis singleton)
│   ├── provider.ts             ← MockStorageProvider + S3StorageProvider (stub)
│   ├── factory.ts              ← resolveProvider() — Configuration integration
│   └── queue.ts                ← _deletePhysically() with retry + _cleanupAbandonedUploads()
└── __tests__/
    └── storage.test.ts         ← 53 tests
```

### Provider Resolution

```
resolveProvider(workspaceId)
    ↓
1. Test override? (_setProviderForTesting) → use injected provider
2. CODELOK_AUTH_USE_MOCK=true? → use dev MockStorageProvider
3. Configuration.getSecret(workspaceId, 'STORAGE_PROVIDER'/'STORAGE_BUCKET'/'STORAGE_ACCESS_KEY'/'STORAGE_SECRET_KEY')
   - 's3' or 'r2' → S3StorageProvider (S3-compatible)
   - 'supabase' → MockStorageProvider (Supabase adapter is a future task)
   - Missing → null → PROVIDER_NOT_CONFIGURED
```

The dev/mock mode (step 2) uses the same `CODELOK_AUTH_USE_MOCK` env var as Auth and Mail.

## Module Interaction (§18 line 811)

- Storage calls `Configuration.getSecret(workspaceId, key)` for provider credentials.
- Storage calls **no other module**.
- Every other module (Verify, Documents, Inspection, etc.) calls Storage's public interface only — never a provider SDK directly (§2).

## Core Spec Compliance Checklist (§18)

- [x] Uses only the standard API response format (§3.6) — enforced by `_storageErrorToResponse` boundary helper; verified by §3.6 compliance test across 10 sample responses
- [x] Reads provider secrets only through `Configuration.getSecret()` — never hardcoded; `resolveProvider()` calls `Configuration.getSecret()` for `STORAGE_PROVIDER`, `STORAGE_BUCKET`, `STORAGE_ACCESS_KEY`, `STORAGE_SECRET_KEY`
- [x] Respects workspace isolation — no cross-workspace file access; verified by 5 workspace-isolation tests
- [x] Exposes only public interfaces — `internal/` not on public surface; verified by boundary tests
- [x] Does not access other modules' internals — Storage calls only `Configuration.getSecret()` (no other module)
- [x] Uses Codlok-standard error codes; never leaks raw provider errors to callers — `StorageErrorCode` enum; provider errors caught and retried (physical deletion) or translated to `CHECKSUM_MISMATCH`/`UPLOAD_INCOMPLETE`
- [x] No business-reference fields anywhere in Storage's data model (§3.10) — verified by compliance test checking getFile response has no inspectionId/belongsToVerification/etc.
- [x] No cascading deletes triggered by business events (§3.11) — verified by boundary test (no deleteByInspection/cascadeDelete functions)
- [x] Abandoned uploads (PENDING/UPLOADING past TTL) auto-transition to FAILED — verified by 3 TTL tests
- [x] Checksum verified on every `completeUpload()`; mismatch blocks completion — verified by 3 checksum tests
- [x] No overwrite of `UPLOADED` objects — content changes always produce a new `fileId` — verified by 3 immutability tests
- [x] `deleteFile()` returns immediately with logical DELETED state; physical removal is async with retry — verified by 6 delete tests

## Test Coverage (Rule 12 — Pre-freeze Test Requirement)

53 tests in `src/modules/storage/__tests__/storage.test.ts`:

### Boundary tests (4)
- Public surface exposes only §18 functions
- Public surface does NOT expose internals
- No business-reference fields in data model (§3.10)
- No authorization functions (§18 line 737)

### Functional — createUpload (7)
- Success: returns presigned URL + IDs
- WORKSPACE_NOT_FOUND, INVALID_MIME_TYPE, CHECKSUM_MISMATCH (bad format), PROVIDER_NOT_CONFIGURED
- Presigned URL points to provider, not Codlok

### Functional — completeUpload (7)
- Success: verifies checksum, transitions to UPLOADED
- CHECKSUM_MISMATCH (wrong bytes), CHECKSUM_MISMATCH (size mismatch)
- UPLOAD_NOT_FOUND, UPLOAD_INCOMPLETE
- FAILED is terminal (no retry)
- Idempotent on already-UPLOADED

### Functional — getDownloadUrl/getFile/fileExists/getProviderStatus (10)
- getDownloadUrl success, FILE_NOT_FOUND, FILE_NOT_UPLOADED, FILE_NOT_FOUND for DELETED
- getFile success, FILE_NOT_FOUND
- fileExists true/false/DELETED
- getProviderStatus configured/not-configured

### Workspace isolation (5)
- Cross-workspace getFile/getDownloadUrl/deleteFile → FILE_NOT_FOUND
- Cross-workspace fileExists → exists=false
- Same fileId in different workspaces is independent

### Immutability (3)
- Changed file is new fileId, not overwrite
- No updateFile/overwriteFile/getLatestVersion function
- No UPLOADED → PENDING transition

### Logical-then-physical delete (6)
- Returns immediately with DELETED
- DELETED file inaccessible via getDownloadUrl/getFile
- Physical deletion async with retry
- Idempotent on already-DELETED

### Upload abandonment TTL (3)
- Abandoned PENDING auto-expires to FAILED
- Expired upload: completeUpload returns UPLOAD_EXPIRED
- Non-expired PENDING is NOT cleaned up

### Compliance — §3.6 + §3.10 + presigned upload (6)
- StandardResponse shape on 10 samples
- No business-reference fields in getFile response
- No cascading delete functions
- Presigned URL points to provider
- No uploadBytes/uploadFile function

### Compliance — Full upload lifecycle (2)
- PENDING → UPLOADING → UPLOADED → DELETED
- PENDING → FAILED (checksum mismatch terminal branch)

## Phase 2 Trade-offs

1. **In-memory store** (`internal/store.ts`) — Phase 2 backing; will be replaced with a persistent database per §3.5 when the DB provisioning layer arrives.

2. **S3StorageProvider is a stub** — the real S3 SDK integration (`@aws-sdk/client-s3` + `@aws-sdk/s3-request-presigner`) is not implemented in this environment. The `MockStorageProvider` is used for all tests and dev mode. Production deployments would install the SDK and implement the methods. The interface is complete — only the implementation bodies are stubbed.

3. **Supabase Storage adapter** — falls back to `MockStorageProvider` for v1. A real Supabase adapter would be implemented when the Supabase SDK is installed.

4. **Lazy TTL cleanup** — abandoned uploads are cleaned up on every `createUpload()`/`completeUpload()` call, not by a background timer. In production, a cron job would also call `_cleanupAbandonedUploads()` periodically for reliability.

5. **No virus scanning** — deliberately out of v1 scope per §18 line 737. A future phase may add virus scanning as a post-upload step.
