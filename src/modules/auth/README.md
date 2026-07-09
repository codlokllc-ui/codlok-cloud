# Codlok Cloud — Auth Module v1.1

> **Status:** Built against Master Spec §10 (Auth Module Specification v1.1 — FROZEN).
> **Build Order:** Phase 1 — Auth (per §13).
> **v1.1 change:** Added `getUser(userId)` — one additive, non-breaking function. No existing function's signature, behavior, or tests changed. v1.0 implementation/tests preserved unmodified.

## Purpose

Answers **"who is this user?"** — identity and authentication only. Nothing about roles, workspaces, or permissions (that is Organizations, §9).

Per §3.8 (Identity Ownership Rule), Auth is the sole authoritative source of user identity. Other modules retrieve identity through `Auth.getUser(userId)` and must not persist identity attributes as authoritative data.

Provider adapter: **Supabase Auth** (per §5, §10).

## Public Interface (§10 v1.1)

Every function returns the StandardResponse shape (§3.6). No exceptions.

| Function | Inputs | Success `data` | Error codes |
|---|---|---|---|
| `registerUser` | `email, password, ctx?` | `{ userId, email, emailVerified: false }` | `EMAIL_ALREADY_EXISTS`, `WEAK_PASSWORD`, `INVALID_EMAIL` |
| `loginUser` | `email, password, ctx?` | `{ userId, accessToken, refreshToken, expiresAt }` | `INVALID_CREDENTIALS`, `ACCOUNT_LOCKED`, `EMAIL_NOT_VERIFIED` |
| `logoutUser` | `accessToken, ctx?` | `{}` | `INVALID_SESSION` |
| `refreshSession` | `refreshToken, ctx?` | `{ accessToken, refreshToken, expiresAt }` | `INVALID_REFRESH_TOKEN`, `REFRESH_TOKEN_EXPIRED` |
| `verifySession` | `accessToken, ctx?` | `{ userId, valid: true }` | `INVALID_SESSION`, `SESSION_EXPIRED` |
| `resetPassword` | `email, ctx?` | `{ sent: true }` | _(none — anti-enumeration)_ |
| `changePassword` | `userId, oldPassword, newPassword, ctx?` | `{}` | `INVALID_CREDENTIALS`, `WEAK_PASSWORD` |
| `verifyEmail` | `token, ctx?` | `{ userId, emailVerified: true }` | `INVALID_TOKEN`, `TOKEN_EXPIRED` |
| `getUser` *(v1.1)* | `userId, ctx?` | `{ userId, email, emailVerified }` | `USER_NOT_FOUND` |

### `getUser(userId)` — added in v1.1

**Purpose:** Resolve a stored `userId` (e.g. from a workspace membership record) into current identity attributes. Distinct from `verifySession`, which validates an access token and returns only `{ userId, valid }` — `getUser` takes a userId directly and returns the identity fields.

**Used by:** Other modules (e.g. Organizations) to comply with §3.8 Identity Ownership Rule. Instead of persisting an `email` column on the Workspace Members table and treating it as authoritative, a module stores only `userId` and calls `Auth.getUser(userId)` whenever identity attributes are needed (member lists, audit logs, invitation flows).

**Compliance:** Backed by `SupabaseAuthAdapter.getUserByUserId` (uses `admin.getUserById` with the service-role key, which never leaves the adapter per §3.4) and `MockAuthAdapter.getUserByUserId` (in-memory `usersById` lookup).

Plus one internal-only code surfaced to callers when the provider is not yet configured (per §3.7): `AUTH_PROVIDER_NOT_CONFIGURED`. And the catch-all: `INTERNAL_ERROR`.

`ctx` is `WorkspaceContext` (`{ workspaceId?: string }`) — per §10 "Workspace Context", `workspaceId` is **context only**: it selects branding, email templates, redirect URLs for the Mail calls Auth triggers. It does not scope identity, alter authentication, or change `userId`. Identity is global.

## Module Interaction

Auth calls the following other modules' public interfaces (only):

- **`Mail.sendVerificationEmail()`** — called by `registerUser` (when in Mock mode; in Supabase mode, Supabase itself sends the verification email).
- **`Mail.sendPasswordResetEmail()`** — called by `resetPassword` (best-effort, anti-enumeration).
- **Configuration Service** — `getSecrets()` to resolve Supabase credentials at runtime per §3.4.

Auth does NOT know how Mail delivers, queues, or retries. Auth does NOT know what Supabase returns on errors. Both are entirely internal to those modules.

## Internal Architecture

```
Auth module (src/modules/auth/)
├── index.ts                     ← Public interface (the ONLY thing other modules import)
├── errors.ts                    ← Codlok-standard error codes (AuthErrorCode enum)
├── adapters/
│   ├── types.ts                 ← AuthProviderAdapter interface (internal contract)
│   ├── factory.ts               ← resolveAdapter() — picks Supabase or Mock based on config
│   ├── supabase.ts              ← SupabaseAuthAdapter (real Supabase, internal)
│   └── mock.ts                  ← MockAuthAdapter (testing + demo only)
└── __tests__/
    └── auth.test.ts             ← 36 tests (30 v1.0 + 6 v1.1) covering all 9 functions + compliance
```

### Adapter selection (per §3.4 + §3.7)

1. If `CODELOK_AUTH_USE_MOCK=true` env var → use `MockAuthAdapter` (explicit dev/demo opt-in).
2. Else, resolve Supabase credentials through Configuration Service:
   - All three present (`SUPABASE_URL`, `SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY`) → use `SupabaseAuthAdapter`.
   - Any missing → return `null`. Auth's public boundary surfaces `AUTH_PROVIDER_NOT_CONFIGURED`.
3. NEVER auto-fallback from missing Supabase credentials to Mock. That would violate §3.7.

### Error translation (per §3.6)

Two-stage translation to keep Supabase strings out of the rest of the codebase:

1. Supabase errors → `ProviderAuthError` (with internal code) — inside `SupabaseAuthAdapter`.
2. `ProviderAuthError` → `ModuleError` (with Codlok-standard code) — inside Auth's public boundary.

Final error messages surfaced to callers are Codlok-defined strings, never raw Supabase text.

**Note on duck-typing:** We use `err.name === 'ModuleError'` / `err.name === 'ProviderAuthError'` rather than `instanceof` because Next.js dev mode may load modules multiple times across route handlers, breaking cross-instance `instanceof` checks. In production builds, module identity is stable and this is equivalent.

## API Routes (thin wrappers — call Auth's public interface only)

| Route | Method | Maps to |
|---|---|---|
| `/api/auth/register` | POST | `Auth.registerUser()` |
| `/api/auth/login` | POST | `Auth.loginUser()` |
| `/api/auth/logout` | POST | `Auth.logoutUser()` |
| `/api/auth/refresh` | POST | `Auth.refreshSession()` |
| `/api/auth/verify-session` | POST | `Auth.verifySession()` |
| `/api/auth/reset-password` | POST | `Auth.resetPassword()` |
| `/api/auth/change-password` | POST | `Auth.changePassword()` |
| `/api/auth/verify-email` | POST | `Auth.verifyEmail()` |
| `/api/auth/status` | GET | Returns provider configuration status (no secrets exposed) |
| `/api/mail/outbox` | GET | Returns Mail module's in-memory outbox (Phase 1 stub visibility) |

Routes never contain business logic — they parse JSON, call Auth, and return the StandardResponse. This preserves the module boundary (§3.3).

## Demo UI

`src/app/page.tsx` is an interactive demo that exercises every Auth public function. In Mock mode (default for local dev), the entire flow works end-to-end without real Supabase credentials:

1. Register a user → Mail outbox records verification email with token
2. Copy token from outbox URL → verify email → returns `emailVerified: true`
3. Login → returns session (accessToken, refreshToken, expiresAt)
4. Verify session → confirms `valid: true`
5. Refresh session → returns new tokens
6. Change password → invalidates old password
7. Reset password → always returns `sent: true` (anti-enumeration)
8. Logout → revokes session; subsequent verify-session returns `INVALID_SESSION`

All error paths (INVALID_CREDENTIALS, EMAIL_NOT_VERIFIED, WEAK_PASSWORD, etc.) are exercised by submitting wrong inputs.

## Core Spec Compliance Checklist (§10)

- [x] Uses only the standard API response format (§3.6) — enforced by `withStandardResponse()` and direct `ok()/fail()` calls; verified by 36 tests (30 v1.0 + 6 v1.1) including §3.6 compliance tests that assert every response has exactly one of `data` or `error`.
- [x] Reads secrets through the Configuration Service (§3.4) — `resolveSupabaseCredentials()` calls `getConfigurationService().getSecrets()`; no Supabase keys appear in code or config files.
- [x] Respects workspace isolation (§3.5, §6) — identity is global; `workspaceId` is accepted as `ctx.workspaceId` and passed through to Mail for branding/templates only; it never scopes identity, credentials, or `userId`.
- [x] Exposes only public interfaces (§3.1, §3.3) — only `src/modules/auth/index.ts` is importable; `adapters/`, `errors.ts`, and `__tests__/` are internal (Next.js path aliases would prevent cross-module imports, but no other module imports them in Phase 1).
- [x] Does not access other modules' internals (calls `Mail.*` only through its public interface) — verified by reading `src/modules/auth/index.ts`: only `Mail.sendVerificationEmail` and `Mail.sendPasswordResetEmail` are called; no imports from `src/modules/mail/adapters/` or similar internal paths.
- [x] Uses Codlok-standard error codes, not raw Supabase errors — two-stage translation in `translateProviderError()`; verified by API tests showing all 9 error codes return correctly mapped Codlok codes.
- [x] Follows module boundary rules (§3.3) — Auth module's `adapters/`, `errors.ts`, and `factory.ts` are never imported by any file outside `src/modules/auth/`.
- [x] §3.8 Identity Ownership Rule — Auth is the sole authoritative source of user identity; `getUser(userId)` is the sanctioned way for other modules to resolve a userId into identity attributes.
- [x] §3.9 Data Ownership Rule — Auth owns identity data; no other module may read or write Auth's identity store directly.

## Test Coverage

36 tests in `src/modules/auth/__tests__/auth.test.ts` (30 from v1.0 unmodified + 6 new for v1.1):

- All 9 public functions (8 from v1.0 + `getUser` from v1.1): success path + every error code listed in §10 v1.1
- §3.6 compliance: every response has exactly one of `data` or `error` (separate compliance tests for v1.0 functions and for `getUser`)
- §3.7 compliance: `AUTH_PROVIDER_NOT_CONFIGURED` surfaced when no provider configured
- §10 Module Interaction: `registerUser` triggers `Mail.sendVerificationEmail`; `resetPassword` triggers `Mail.sendPasswordResetEmail`
- §10.6 anti-enumeration: `resetPassword` returns `sent: true` for both existing and non-existent emails
- v1.1 `getUser`: success path, USER_NOT_FOUND for unknown userId, USER_NOT_FOUND for empty userId, emailVerified reflects current state, response format compliance

Run with: `bun test src/modules/auth`

## Files Created

```
src/
├── shared/
│   └── index.ts                              ← Standard response types (§3.6)
├── config/
│   └── index.ts                              ← Configuration Service (§3.4, Phase 1 env-backed stub)
├── modules/
│   ├── mail/
│   │   └── index.ts                          ← Mail boundary stub (sendVerificationEmail, sendPasswordResetEmail, sendInvitationEmail)
│   └── auth/
│       ├── index.ts                          ← Public interface (8 functions per §10)
│       ├── errors.ts                         ← Codlok-standard error codes
│       ├── adapters/
│       │   ├── types.ts                      ← AuthProviderAdapter interface (internal)
│       │   ├── factory.ts                    ← resolveAdapter() — Supabase vs Mock selection
│       │   ├── supabase.ts                   ← SupabaseAuthAdapter (real)
│       │   └── mock.ts                       ← MockAuthAdapter (testing/demo)
│       └── __tests__/
│           └── auth.test.ts                  ← 36 tests (30 v1.0 + 6 v1.1)
├── app/
│   ├── page.tsx                              ← Demo UI
│   └── api/
│       ├── auth/
│       │   ├── register/route.ts
│       │   ├── login/route.ts
│       │   ├── logout/route.ts
│       │   ├── refresh/route.ts
│       │   ├── verify-session/route.ts
│       │   ├── reset-password/route.ts
│       │   ├── change-password/route.ts
│       │   ├── verify-email/route.ts
│       │   └── status/route.ts
│       └── mail/
│           └── outbox/route.ts
└── (existing Next.js scaffold files unchanged)
```

## Configuration

Environment variables (in `.env`):

```bash
# Option 1: Mock mode (demo / local dev)
CODELOK_AUTH_USE_MOCK=true

# Option 2: Real Supabase (production)
# SUPABASE_URL=https://your-project.supabase.co
# SUPABASE_ANON_KEY=eyJ...
# SUPABASE_SERVICE_ROLE_KEY=eyJ...

# Base URL for verification/reset links sent via Mail
CODELOK_APP_BASE_URL=http://localhost:3000
```

Per §3.7: provider credentials are NEVER auto-created. If neither option is configured, every Auth function returns `{ success: false, error: { code: "AUTH_PROVIDER_NOT_CONFIGURED", ... } }` — except `resetPassword`, which still returns `sent: true` per §10.6 anti-enumeration.

## Notes on Phase 1 Trade-offs (for the §15 Build Report)

These are not spec violations — they are explicit decisions made to enable Phase 1 Auth to function, given that its declared dependencies (Configuration Service and Mail) are scheduled for Phase 2 per §13.

1. **Configuration Service (Phase 2) was implemented as a minimal Phase 1 stub** (`src/config/index.ts`). The interface is final; only the backing store is simplified (env vars instead of a multi-tenant credential store with admin UI). Phase 2 will replace the backing store without changing the interface — no Auth code will need to change.

2. **Mail module (Phase 2) was implemented as a boundary-level stub** (`src/modules/mail/index.ts`). Only the two functions Auth needs (`sendVerificationEmail`, `sendPasswordResetEmail`) are exposed. A third (`sendInvitationEmail`) is included because §12 Organizations (next module per §13) will need it, and defining it now keeps the Mail boundary stable when Organizations is built. Phase 2 will replace the stub with real Resend/SES adapters without changing the public interface.

3. **`MockAuthAdapter` is provided for tests and demo UI.** It is NEVER auto-selected — it requires explicit opt-in via `CODELOK_AUTH_USE_MOCK=true`. This complies with §3.7 ("No fake defaults, no silent fallback credentials"). Production deployments without this env var and without real Supabase credentials will correctly surface `AUTH_PROVIDER_NOT_CONFIGURED`.

4. **`ProviderUser.verificationToken` optional field** was added to the internal adapter contract. Mock populates it (so the demo UI can complete the email-verification flow without a real email provider). Supabase leaves it undefined (Supabase sends its own verification email with its own token, which the Auth module never sees). This is purely internal — it does not affect the Auth public interface.

5. **`globalThis` is used for module-level caches** (Mail outbox, cached Mock/Supabase adapters). This is a workaround for Next.js dev-mode loading modules multiple times across route handlers, which would otherwise cause state divergence. In production builds, module identity is stable and this is a no-op.

## Build Order Status (§13)

- [x] **Phase 1 — Auth** ← this module (ready for review)
- [ ] Phase 1 — Organizations (next — re-validate §12 draft against Auth's real public interface, then build)
- [ ] Phase 2 — Configuration Service (replace env-backed stub with full multi-tenant implementation)
- [ ] Phase 2 — Mail (replace boundary stub with real Resend/SES adapters)
- [ ] Phase 2 — Storage, Notify
- [ ] Phase 3 — Pay, AI, Verify
- [ ] Phase 4 — Analytics, Logs, Admin Dashboard
