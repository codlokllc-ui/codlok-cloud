# Codlok Cloud — Mail Module v1.0

> **Status:** Built against Master Spec §17 (Mail Module Specification v1.0 — STATUS: FROZEN). Spec Version 1.8.
> **Build Order:** Phase 2 — Mail (per §13 as revised in v1.7).
> **Validation:** §17 public interface validated against provisional stub usage. 6 conflicts found (all expected per Rule 11 transition). Path A approved: rebuild Mail per §17, rewire Auth + Organizations internal calls, preserve test outbox. All 153 existing tests pass unmodified.

## Purpose

Answers **"how does an email actually get sent, reliably, regardless of which provider is behind it?"** Retires the Rule 11 provisional stub that Auth (`registerUser`, `resetPassword`) and Organizations (`inviteMember`, `resendInvitation`) were calling.

**Out of scope:** Marketing/campaign email, deciding *when* to send or *what* to say beyond a template, cross-provider failover (deferred to backlog per §17 line 686).

## Public Interface (§17)

Every function returns StandardResponse (§3.6). No exceptions.

| Function | Inputs | Success `data` | Error codes |
|---|---|---|---|
| `sendVerificationEmail` | `workspaceId, to, verificationToken, idempotencyKey?` | `{ queued: true, messageId }` | `INVALID_RECIPIENT`, `PROVIDER_NOT_CONFIGURED` |
| `sendPasswordResetEmail` | `workspaceId, to, resetToken, idempotencyKey?` | `{ queued: true, messageId }` | `INVALID_RECIPIENT`, `PROVIDER_NOT_CONFIGURED` |
| `sendInvitationEmail` | `workspaceId, to, invitationToken, inviterName, workspaceName, idempotencyKey?` | `{ queued: true, messageId }` | `INVALID_RECIPIENT`, `PROVIDER_NOT_CONFIGURED` |
| `getDeliveryStatus` | `workspaceId, messageId` | `{ messageId, status }` | `MESSAGE_NOT_FOUND` |

**Explicitly excluded** (per §17 line 594/685): `testConnection()`, cross-provider failover, and any function returning a constructed provider client.

### Token Parameters — Naming Change Only, No Semantic Change

Per the Build Report requirement (and the approved Path A directive):

> §17's `verificationToken` / `resetToken` / `invitationToken` parameters are populated with the **same URL strings** the provisional stub passed as `verificationUrl` / `resetUrl` / `inviteUrl` — naming change only, no semantic change. Mail does not construct URLs or tokens; it receives and delivers whatever the caller (Auth, Organizations) already built. This confirms compliance with "no business logic migration."

**Evidence:**
- Auth's `registerUser` constructs `buildVerificationUrl(userId, token, workspaceId)` → `http://localhost:3000/auth/verify-email?token=vtoken_...` and passes it as `verificationToken`.
- Auth's `resetPassword` constructs `buildPasswordResetUrl(workspaceId)` → `http://localhost:3000/auth/reset-password` and passes it as `resetToken`.
- Organizations' `inviteMember` constructs `_buildInviteUrl(inv.token)` → `http://localhost:3000/organizations/invitations/accept?token=itk_...` and passes it as `invitationToken`.
- Mail stores these strings as-is in the `MessageRecord.token` field and passes them to the provider adapter's `send()` method. Mail has no `buildUrl()` or `buildToken()` function.

## Reliability Model (§17 lines 688-694)

### Queue-and-Retry

- Public functions return **immediately** with `{ queued: true, messageId }` — they do not block on provider delivery.
- Internally, Mail queues the send and retries on provider failure with **exponential backoff** (2s, 4s, 8s in production; 0ms in test mode).
- **Bounded retry count:** 3 retries (4 total attempts). After max retries, status becomes `failed`.
- Callers **never** see a provider-specific error (Resend timeout, rate limit, 5xx). Only `INVALID_RECIPIENT` (bad email format) and `PROVIDER_NOT_CONFIGURED` (no Resend key in Configuration) are ever surfaced.

### Delivery Status Lifecycle

```
queued → sent → delivered    (happy path)
queued → sent → bounced      (soft bounce)
queued → failed              (max retries exhausted)
```

`getDeliveryStatus(workspaceId, messageId)` lets callers check on a previously queued send. Callers are NOT required to poll it.

## Idempotency (§17 binding v1 rule)

Every send function accepts an optional `idempotencyKey`. A request with the same `workspaceId` + `idempotencyKey` within the **idempotency window** returns the **original** `messageId` without sending a second email.

**Idempotency window: 24 HOURS.**

Rationale: long enough to handle caller retry-after-timeout scenarios (e.g. `Auth.registerUser()` retried after Mail didn't respond in time), short enough to not accumulate stale entries indefinitely.

The idempotency key is scoped by `workspaceId` — the same key in different workspaces is independent (verified by test).

## Workspace Isolation (§17 line 697)

Every function requires `workspaceId`. Provider selection and email branding are per-workspace. A workspace with no Mail provider configured gets `PROVIDER_NOT_CONFIGURED` per §3.7 — no silent fallback to a shared/default account.

`getDeliveryStatus` is workspace-scoped: a `messageId` belonging to a different workspace than the one supplied returns `MESSAGE_NOT_FOUND`, not the real status (§17 line 683, verified by test).

## Module Interaction (§17 line 700)

- Mail calls `Configuration.getSecret(workspaceId, 'RESEND_API_KEY', 'mail')` for provider credentials.
- Mail calls **no other module**.
- Auth and Organizations call Mail's public interface only — never Resend directly (§2).

## Internal Architecture

```
src/modules/mail/
├── index.ts                    ← Public interface (§17 functions + test helpers)
├── README.md                   ← This file
├── internal/
│   ├── errors.ts               ← MailErrorCode enum (MAIL_ namespace)
│   ├── types.ts                ← MessageRecord, OutboxEntry, MailProviderAdapter, MailError
│   ├── store.ts                ← In-memory store (globalThis singleton; idempotency index)
│   ├── provider.ts             ← ResendAdapter (real) + MockMailProvider (test/dev)
│   ├── factory.ts              ← resolveProvider() — checks Configuration for RESEND_API_KEY
│   └── queue.ts                ← _deliver() with retry + _flushQueueForTesting()
└── __tests__/
    └── mail.test.ts            ← 38 tests (boundary + functional + idempotency + reliability + compliance)
```

### Provider Resolution

```
resolveProvider(workspaceId)
    ↓
1. Test override? (_setProviderForTesting) → use injected provider
2. CODELOK_AUTH_USE_MOCK=true? → use dev MockMailProvider (same flag as Auth's mock adapter)
3. Configuration.getSecret(workspaceId, 'RESEND_API_KEY', 'mail')
   - Success → ResendAdapter(apiKey)
   - Failure → null → PROVIDER_NOT_CONFIGURED
```

The dev/mock mode (step 2) uses the same `CODELOK_AUTH_USE_MOCK` env var as Auth's mock adapter. This means tests that set this flag get both mock Auth AND mock Mail without additional setup. This is a dev-mode escape hatch, NOT a production behavior.

## Auth + Organizations Rewiring (Path A)

### Auth (src/modules/auth/index.ts)

**registerUser** (line 212):
```typescript
// Before (provisional stub):
await Mail.sendVerificationEmail({ to, verificationUrl, workspaceId });

// After (§17 frozen interface):
await Mail.sendVerificationEmail(
  ctx?.workspaceId ?? '__global__',
  user.email,
  verificationUrl  // same URL string, now passed as verificationToken
);
```

**resetPassword** (line 374):
```typescript
// Before:
await Mail.sendPasswordResetEmail({ to, resetUrl, workspaceId }).catch(...);

// After:
await Mail.sendPasswordResetEmail(
  ctx?.workspaceId ?? '__global__',
  email,
  resetUrl  // same URL string, now passed as resetToken
).catch(...);
```

Auth public interface: **UNCHANGED**. All 36 Auth tests pass unmodified.

### Organizations (src/modules/organizations/index.ts)

**inviteMember** (line 531) and **resendInvitation** (line 599):
```typescript
// Before:
await Mail.sendInvitationEmail({ to, inviteUrl, inviterName, workspaceName, workspaceId });

// After:
await Mail.sendInvitationEmail(
  ws.id,
  email,
  inviteUrl,      // same URL string, now passed as invitationToken
  inviterName,
  workspaceName
);
```

Organizations public interface: **UNCHANGED**. All 69 Organizations tests pass unmodified.

## Test Outbox (preserved from provisional stub)

The test outbox (`_getOutboxForTesting`, `_clearOutboxForTesting`, `OutboxEntry`) is preserved as a **test-only** export. It is NOT part of the §17 public surface — it's a test helper, same pattern as Configuration's `_resetStoreForTesting` and Organizations' `_resetStoreForTesting`.

The outbox records every send attempt (after validation, before the provider check) with backward-compatible fields: `id`, `type`, `to`, `url`, `workspaceId`, `sentAt`. New fields added in v1.0: `messageId`, `status`, `queuedAt`.

This preservation is critical for backward compatibility:
- Auth tests check `outbox[outbox.length - 1].type` and `.to`.
- Organizations' `createUser` helper parses `entry.url` to extract verification tokens.
- The outbox route (`/api/mail/outbox`) and demo UI (`page.tsx`) consume the same shape.

## Core Spec Compliance Checklist (§17)

- [x] Uses only the standard API response format (§3.6) — enforced by `_mailErrorToResponse` boundary helper; verified by §3.6 compliance test across 5 sample responses
- [x] Reads provider secrets only through `Configuration.getSecret()` — never hardcoded; `resolveProvider()` calls `Configuration.getSecret(workspaceId, 'RESEND_API_KEY', 'mail')`
- [x] Respects workspace isolation — provider config and branding are per-workspace; cross-workspace `getDeliveryStatus` returns `MESSAGE_NOT_FOUND` (verified by test)
- [x] Exposes only public interfaces — `internal/` not on public surface; verified by boundary tests
- [x] Does not access other modules' internals — Mail calls only `Configuration.getSecret()` (no other module); verified by code inspection
- [x] Uses Codlok-standard error codes; never leaks raw provider errors to callers — `MailErrorCode` enum; provider errors caught and retried, never surfaced (verified by test)
- [x] Existing Auth/Organizations calls into the provisional stub validated and reconciled in Step 1 before build — 6 conflicts found, documented in Blocker Report, Path A approved
- [x] `getDeliveryStatus` rejects cross-workspace `messageId` lookups (returns `MESSAGE_NOT_FOUND`, not another workspace's real status) — verified by test
- [x] Idempotency verified: same `workspaceId` + `idempotencyKey` within the window returns the original `messageId`, does not send a second email — verified by 5 idempotency tests

## Test Coverage (Rule 12 — Pre-freeze Test Requirement)

38 tests in `src/modules/mail/__tests__/mail.test.ts`:

### Boundary tests (4)
- Public surface exposes only §17 functions
- Public surface does NOT expose internals (store, _deliver, resolveProvider, _send)
- No `testConnection()` in public surface (§17 explicitly excludes it)
- Mail does NOT construct provider SDK clients for callers (returns { queued, messageId }, not a client)

### Functional — send functions (6)
- sendVerificationEmail / sendPasswordResetEmail / sendInvitationEmail: success
- INVALID_RECIPIENT for bad email format
- INVALID_RECIPIENT for empty email
- PROVIDER_NOT_CONFIGURED when no provider available

### Idempotency (5)
- Duplicate key within window returns SAME messageId
- Duplicate key does NOT send a second email
- Different idempotencyKey sends separate emails
- Same idempotencyKey but DIFFERENT workspaceId sends separate emails
- No idempotencyKey → always sends (no dedup)

### Reliability — queue-and-retry (6)
- sendVerificationEmail returns immediately with { queued: true }
- Provider failure does NOT propagate to caller
- Provider failure — message status becomes "failed" after max retries
- Provider succeeds after retries — message status becomes "delivered"
- Provider bounce — message status becomes "bounced"
- Callers NEVER see raw provider errors — only INVALID_RECIPIENT or PROVIDER_NOT_CONFIGURED

### Workspace isolation (3)
- getDeliveryStatus: cross-workspace lookup returns MESSAGE_NOT_FOUND
- getDeliveryStatus: same-workspace lookup succeeds
- Idempotency is workspace-scoped

### Functional — getDeliveryStatus (3)
- MESSAGE_NOT_FOUND for unknown messageId
- MESSAGE_NOT_FOUND for empty messageId
- Returns all valid status values

### Compliance — §3.6 StandardResponse (1)
- Every Mail function returns success-or-error envelope (5 samples)

### Compliance — Token parameters = URL strings (4)
- sendVerificationEmail receives and delivers caller-provided URL as-is
- sendPasswordResetEmail receives and delivers caller-provided URL as-is
- sendInvitationEmail receives and delivers caller-provided URL as-is
- Mail does NOT construct URLs — no buildUrl/buildToken function

### Compliance — Outbox preserved (3)
- _getOutboxForTesting returns entries with backward-compatible fields
- _clearOutboxForTesting clears the outbox
- Outbox records send even when PROVIDER_NOT_CONFIGURED

### Regression — Auth/Organizations compatibility (3)
- Mail.sendVerificationEmail accepts the URL string Auth passes as verificationToken
- Mail.sendPasswordResetEmail accepts the URL string Auth passes as resetToken
- Mail.sendInvitationEmail accepts the URL string Organizations passes as invitationToken

## Phase 2 Trade-offs

1. **In-memory store** (`internal/store.ts`) — Phase 2 backing; will be replaced with a persistent database per §3.5 when the DB provisioning layer arrives. Store interface is internal, so no public surface change will be needed.

2. **Dev-mode mock provider** — when `CODELOK_AUTH_USE_MOCK=true` (same flag as Auth's mock adapter), Mail uses `MockMailProvider` instead of checking Configuration. This is a dev-mode escape hatch, NOT a production behavior. Production deployments without this flag and without a real Resend key in Configuration will correctly return `PROVIDER_NOT_CONFIGURED`.

3. **No cross-provider failover** — per §17 line 686, only same-provider retry with backoff is specified for v1. Cross-provider failover (Resend → SES) is logged as backlog.

4. **Synchronous retry in test mode** — in test mode (`NODE_ENV=test`), backoff delays are 0ms to keep tests fast. In production, delays are 2s, 4s, 8s (exponential).

5. **`delivered` status simulated** — in production, `delivered` would come from a Resend webhook. For v1, we mark `delivered` immediately after `sent` (simulated). A future phase will add webhook integration for real delivery confirmation.

## Files

```
src/modules/mail/
├── index.ts                    ← Public interface (replaces provisional stub)
├── README.md                   ← This file
├── internal/
│   ├── errors.ts               ← MailErrorCode enum
│   ├── types.ts                ← MessageRecord, OutboxEntry, MailProviderAdapter, MailError
│   ├── store.ts                ← In-memory store (globalThis singleton)
│   ├── provider.ts             ← ResendAdapter (real) + MockMailProvider (test/dev)
│   ├── factory.ts              ← resolveProvider() — Configuration integration
│   └── queue.ts                ← _deliver() with retry + _flushQueueForTesting()
└── __tests__/
    └── mail.test.ts            ← 38 tests

src/modules/auth/index.ts               ← REWIRED (registerUser, resetPassword)
src/modules/organizations/index.ts       ← REWIRED (inviteMember, resendInvitation)
```
