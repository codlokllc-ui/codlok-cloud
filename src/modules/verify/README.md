# Codlok Cloud — Verify Module v1.0

> **Status:** Built against Master Spec §20 (Verify Module Specification v1.0 — STATUS: FROZEN). Spec Version 2.6.
> **Build Order:** Phase 3 — Verify (per §13).
> **Validation:** No frozen module assumes a different Verify shape. Configuration's `MODULE_CATALOG` was additively extended with a `verify` entry (`STRIPE_IDENTITY_SECRET_KEY`, `STRIPE_IDENTITY_WEBHOOK_SECRET` — same pattern as Pay's Stripe keys). All 306 existing tests pass unmodified.

## Purpose

Answers **"how does a workspace get an identity/business verification done, reliably, regardless of which provider does the actual checking?"** Verify orchestrates external KYC/identity-verification providers — it never implements verification logic itself (§7 Provider Model).

**Naming disambiguation:** "Codlok Verify" (this module) ≠ "SREMA Verify" (a downstream product). This module is generic infrastructure.

**Out of scope:** Biometric matching, OCR, document authenticity analysis, liveness detection, deciding *when* verification is required, storing verification artifacts (documents, biometrics, full reports).

## Public Interface (§20)

Every function returns StandardResponse (§3.6). No exceptions.

| Function | Inputs | Success `data` | Error codes |
|---|---|---|---|
| `createVerificationSession` | `workspaceId, verificationType, subjectReference, idempotencyKey` | `{ verificationId, providerSessionUrl, status: "pending" }` | `INVALID_VERIFICATION_TYPE`, `WORKSPACE_NOT_FOUND`, `PROVIDER_NOT_CONFIGURED`, `IDEMPOTENCY_KEY_REQUIRED` |
| `getVerificationStatus` | `workspaceId, verificationId` | `{ verificationId, status, provider, verificationType, createdAt, updatedAt }` | `VERIFICATION_NOT_FOUND` |
| `listVerifications` | `workspaceId, filters?` | `{ verifications: [{ verificationId, status, verificationType, createdAt }] }` | `WORKSPACE_NOT_FOUND` |
| `getProviderStatus` | `workspaceId` | `{ configured: boolean, provider: string \| null }` | `WORKSPACE_NOT_FOUND` |
| `processWebhook` | `workspaceId, payload, signature` | `{ processed, eventId, deduplicated }` | `PROVIDER_NOT_CONFIGURED`, `WEBHOOK_SIGNATURE_INVALID` |

**Explicitly excluded** (per §20 line 992): any function accepting `entityType`/`entityId`; any function returning raw documents/biometrics/full reports; any function implying Verify itself performs matching/OCR (no `compareFaces()`, no `extractDocumentData()`).

## Canonical VerificationType Enum (§20 line 975)

`verificationType` is a **canonical Codlok enum**, NOT an opaque string:

- `INDIVIDUAL_IDENTITY` — individual KYC (name, DOB, ID number)
- `BUSINESS_VERIFICATION` — business/entity verification
- `DOCUMENT_VERIFICATION` — document-only verification
- `ADDRESS_VERIFICATION` — address verification
- `AGE_VERIFICATION` — age verification

Different providers use different vocabulary for similar flows (Stripe's "document" type, Persona's "Government ID" inquiry). The canonical enum prevents provider-specific vocabulary from leaking into Codlok's public API. The provider adapter maps each canonical type to whatever that provider actually calls it.

## Verification Status State Machine (§20 line 994 — binding)

```
pending → in_review → approved
                     → rejected
pending → expired (terminal)
```

- `approved`, `rejected`, `expired` are terminal.
- `approved`/`rejected` driven **exclusively** by provider webhooks — no public function transitions status directly (like Pay's `disputed` state).

## Adapter Absorption Rule (§20 line 1003 — binding)

Real providers do not have a clean one-directional lifecycle:
- **Stripe Identity's** `requires_input` status can occur mid-flow — a failed document check sends the session back to `requires_input` for resubmission *within the same session*.
- **Persona** has two separate phases: a "Done" phase (`completed`/`failed`/`expired`) followed by a distinct decisioning phase (`approved`/`declined`/`needs_review`).

Rather than adding a normalized state for every provider quirk, the **provider adapter is responsible for absorbing this internal complexity** and only emitting a Codlok status transition when something is actually actionable:

| Provider Status | Codlok Transition | Reasoning |
|---|---|---|
| `requires_input` | *(none — stays pending)* | Absorbs the resubmission loop (§20 line 1006) |
| `processing` | *(none — stays pending)* | Not yet finalized |
| `verified` | `approved` | Terminal, actionable |
| `approved` | `approved` | Terminal, actionable (Persona decisioning) |
| `needs_review` | `in_review` | Actionable — manual review hold |
| `declined` | `rejected` | Terminal, actionable (Persona decisioning) |
| `canceled` | `rejected` | Stripe has no distinct "rejected" — canceled with no successful verification mapped to rejected (§20 line 1008) |

## Verification Fact Immutability Rule (§20 line 968 — binding)

Once a verification session is created, the following **never change**:
- `verificationId`
- `provider`
- `providerVerificationId`
- `verificationType`
- `subjectReference`
- `workspaceId`

Only `status` transitions. A correction always means a new verification session, never an edit — same reasoning as Pay's immutable financial facts and Storage's immutable uploaded objects.

## Verification Data Minimization Rule (§20 line 965 — binding)

Verify stores **only**: provider name, provider verification/session ID, normalized status, timestamps, non-sensitive metadata. **Never** stores:
- Raw documents (passport/license images)
- Biometric templates / face embeddings
- OCR results
- Full provider reports

The provider remains the system of record for all verification artifacts. If a future release needs underlying documents (e.g. for dispute resolution), that means fetching them from the provider on demand, not storing a Codlok-side copy.

## Idempotency — REQUIRED (§20 line 976)

`idempotencyKey` is **required** on `createVerificationSession` (same reasoning as Pay: duplicate sessions cost real provider fees and create confusing duplicate records).

**Idempotency window: PERMANENT (no expiry)** — same as Pay, since a duplicate verification at any future point wastes provider fees.

## Webhook Deduplication (§20 line 1013 — permanent)

Incoming webhooks are received **exclusively** by Verify. Every webhook event is deduplicated by provider event ID, **permanently** — a given provider event ID is processed at most once, ever (same as Pay). A duplicate event is a true no-op, not a repeated status transition.

## Internal Architecture

```
src/modules/verify/
├── index.ts                    ← Public interface (§20 functions + processWebhook)
├── README.md                   ← This file
├── internal/
│   ├── errors.ts               ← VerifyErrorCode enum
│   ├── types.ts                ← VerificationRecord, WebhookEventRecord, VerifyProviderAdapter, VerifyError
│   ├── store.ts                ← In-memory store (globalThis singleton; idempotency index; webhook dedup)
│   ├── provider.ts             ← MockVerifyProvider (test/dev) + StripeIdentityProvider (stub)
│   └── factory.ts              ← resolveProvider() — Configuration integration
└── __tests__/
    └── verify.test.ts          ← 52 tests
```

### Provider Resolution

```
resolveProvider(workspaceId)
    ↓
1. Test override? (_setProviderForTesting) → use injected provider
2. CODELOK_AUTH_USE_MOCK=true? → use dev MockVerifyProvider
3. Configuration.getSecret(workspaceId, 'STRIPE_IDENTITY_SECRET_KEY'/'STRIPE_IDENTITY_WEBHOOK_SECRET', 'verify')
   - Both present → StripeIdentityProvider(secretKey, webhookSecret)
   - Missing → null → PROVIDER_NOT_CONFIGURED
```

## Module Interaction (§20 line 1019)

- Verify calls `Configuration.getSecret(workspaceId, key)` for provider credentials (`STRIPE_IDENTITY_SECRET_KEY`, `STRIPE_IDENTITY_WEBHOOK_SECRET`).
- Verify calls **no other module** — not Storage (Verify doesn't store documents), not Pay (if a product wants to charge for verification, the calling module sequences it), not a future Audit module (Verify's audit trail is self-contained).

## Core Spec Compliance Checklist (§20)

- [x] Uses only the standard API response format (§3.6) — enforced by `_verifyErrorToResponse` boundary helper; verified by §3.6 compliance test across 6 sample responses
- [x] Reads provider secrets only through `Configuration.getSecret()` — never hardcoded; `resolveProvider()` calls `Configuration.getSecret()` for `STRIPE_IDENTITY_SECRET_KEY` and `STRIPE_IDENTITY_WEBHOOK_SECRET`
- [x] Respects workspace isolation — no cross-workspace verification access; verified by 2 workspace-isolation tests
- [x] Exposes only public interfaces — `internal/` not on public surface; verified by boundary tests
- [x] Does not access other modules' internals; does not call Storage, Pay, or a future Audit module — verified by source-inspection test
- [x] Uses Codlok-standard error codes; never leaks raw provider errors to callers — `VerifyErrorCode` enum
- [x] No business-reference fields anywhere in Verify's data model — no `entityType`/`entityId`; verified by compliance test
- [x] No raw documents, biometric data, or full provider reports ever stored (Verification Data Minimization Rule) — verified by 3 data-minimization tests
- [x] `idempotencyKey` required on `createVerificationSession`; duplicate calls return the original `verificationId`, never a second session — verified by 4 idempotency tests
- [x] Webhook events deduplicated by provider event ID, permanently — verified by 4 webhook dedup tests
- [x] Verify's own audit trail is self-contained — no dependency on a future Audit module — verified by module-boundary test
- [x] Verification Fact Immutability — core fields never change after creation — verified by 2 immutability tests
- [x] Adapter Absorption Rule — provider intermediate states absorbed, only actionable transitions emitted — verified by 8 adapter-absorption tests
- [x] State machine — valid transitions succeed, terminal states enforced — verified by 6 state-machine tests

## Test Coverage (Rule 12 — Pre-freeze Test Requirement)

52 tests in `src/modules/verify/__tests__/verify.test.ts`:

### Boundary tests (4)
- Public surface exposes §20 functions
- No internals on public surface
- No entityType/entityId parameters
- No document/biometric/OCR functions

### Functional — createVerificationSession (7)
- Success: returns providerSessionUrl
- IDEMPOTENCY_KEY_REQUIRED, INVALID_VERIFICATION_TYPE (non-enum, empty)
- WORKSPACE_NOT_FOUND, PROVIDER_NOT_CONFIGURED
- All 5 canonical verificationTypes accepted

### Idempotency (4)
- Duplicate returns same verificationId
- Duplicate does NOT create a second session
- Different key creates separate sessions
- Same key different workspace is independent

### Functional — getVerificationStatus + listVerifications (6)
- Success: returns metadata
- VERIFICATION_NOT_FOUND
- listVerifications: lists all, filters by status, filters by type
- WORKSPACE_NOT_FOUND

### Functional — getProviderStatus (2)
- Configured, not configured

### Workspace isolation (2)
- Cross-workspace getVerificationStatus → VERIFICATION_NOT_FOUND
- listVerifications only returns verifications from the specified workspace

### Webhook deduplication (4)
- First webhook processes
- Duplicate event ID is a true no-op
- Duplicate does NOT repeat status transition
- Different event IDs processed separately

### Adapter Absorption Rule (8)
- requires_input does NOT trigger status change (stays pending)
- processing does NOT trigger status change
- requires_input loop: multiple events all stay pending
- verified → approved
- needs_review → in_review
- declined → rejected
- canceled → rejected (Stripe mapping per §20 line 1008)
- Full lifecycle: requires_input loop → verified → approved

### Verification Fact Immutability (2)
- Core fields never change after creation (only status transitions)
- No updateVerificationType/updateSubjectReference function

### Data Minimization (3)
- Record contains NO document/biometric/OCR fields
- getVerificationStatus returns NO document/biometric data
- No function returns raw documents or biometric data

### State machine (6)
- pending → in_review, approved, rejected
- in_review → approved
- approved is terminal
- No public function transitions status directly (only webhooks)

### Compliance — §3.6 + no business-reference + module boundary (4)
- StandardResponse on 6 samples
- No business-reference fields in response
- subjectReference stored opaquely
- Verify does NOT import Storage, Pay, Auth, Organizations, or Mail

## Phase 3 Trade-offs

1. **In-memory store** (`internal/store.ts`) — Phase 3 backing; will be replaced with a persistent database per §3.5 when the DB provisioning layer arrives.

2. **StripeIdentityProvider is a stub** — the real Stripe Identity SDK integration (`stripe` npm package) is not implemented in this environment. The `MockVerifyProvider` is used for all tests and dev mode. Production deployments would install the SDK and implement the methods. The Adapter Absorption Rule logic is fully implemented in the mock and documented for the real adapter.

3. **Stripe Identity type mapping** — Stripe Identity doesn't directly support `BUSINESS_VERIFICATION` (that would require a different provider like Smile ID or Sumsub). The adapter would reject this type in production. For v1 with the mock provider, all 5 types are accepted since the mock doesn't enforce provider-specific type constraints.

4. **No expired transition from public API** — `expired` is in the state machine but only reachable via webhook (provider reports session timeout). No public function triggers it, consistent with §20 line 1001.
