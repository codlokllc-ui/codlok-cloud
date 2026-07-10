# Codlok Cloud — Master Specification

**Spec Version: 2.1** — Last updated: Storage (§18) stress-tested and frozen. Added logical-then-physical delete (same philosophy as Mail's queue-and-retry) and an explicit Upload Transaction Ownership Rule. Confirmed getFile()/getDownloadUrl() separation and provider-side completeUpload() verification were already correctly specified in the draft. Ready for agent validation and build.

**Status:** Canonical. This is the single source of truth handed to any AI coding agent building Codlok Cloud. Do not invent module boundaries, response shapes, or architecture beyond what is written here. If something is ambiguous, stop and ask rather than assume.

**Before starting any task, check the Spec Version number above against the version you were last told to expect. If it doesn't match, or if you were given no version to expect, treat this file as authoritative and re-verify every precondition a directive claims — do not trust a directive's description of what the spec contains; check this file directly.**

## Platform Freeze Log
Read this before touching any code. One row per module — its frozen status, what it depends on, what depends on it, and what's known-incomplete. No breaking changes to a Frozen public interface without going through the Blocker Report process (§15) — additive-only, per Rule 11/12.

| Module | Version | Status | Depends On | Used By | Tests | Known Backlog |
|---|---|---|---|---|---|---|
| Core Spec | — | 🟢 Frozen | — | Everything | — | — |
| Auth | v1.1 | 🟢 Frozen | Configuration, Mail (provisional) | Organizations | 36 | — |
| Organizations | v1.0 | 🟢 Frozen | Auth, Configuration, Mail (provisional) | — | 69 (105 incl. Auth regression) | — |
| Configuration | v1.0 | 🟢 Frozen | — | Auth, Organizations | 48 (153 incl. full regression) | Key rotation (env-var swap only, no versioned decrypt chain) |
| Mail | v1.0 | 🟢 Frozen | Configuration | Auth, Organizations | 38 (191 incl. full regression) | Cross-provider failover not in v1; delivery-status transition table undocumented |
| Storage | v1.0 | 🟢 Frozen (spec only — not yet built) | Configuration | (future: Verify, Documents, Inspection) | — | No virus scanning in v1 (deliberate) |
| Pay, Verify, Evidence, Notifications, AI, SMS, Analytics, Logs, API Gateway, Admin Dashboard | — | ⚪ Not started | — | — | — | Boundary-level only, see §9 |

**Breaking Change Policy:** once a module's Status is 🟢 Frozen, its public interface does not change except via an approved Blocker Report (additive changes only, per Rule 11/12) — never a silent edit.
| Version | Change |
|---|---|
| 1.0 | Initial master spec: vision, Core Spec §3.1–3.7, architecture, Auth v1.0 (full spec), Organizations v1.0 (draft), module boundaries, build order, engineering playbook |
| 1.1 | Auth v1.0 approved and frozen (implemented, 30/30 tests). Rule 11 (Provisional Interfaces) added. |
| 1.2 | Added §3.8 Identity Ownership Rule, §3.9 Data Ownership Rule. Auth updated to v1.1 (added `getUser(userId)`). §12 Organizations dependency line corrected from `Auth.verifyUser()` to `Auth.getUser()`. |
| 1.3 | Auth v1.1 approved and frozen (`getUser()` implemented, 36/36 tests passing, boundary/regression/compliance tests confirmed). Rule 12 (Pre-freeze Test Requirement) added to Engineering Playbook. |
| 1.4 | Organizations v1.0 approved and frozen (105/105 tests passing incl. privilege-escalation and cross-workspace isolation). Design Rationale subsections added to §10/§12 (replacing separate per-module ADR files). Configuration Service Module Specification added as new §16 — status DRAFT. |
| 1.5 | Configuration Service (§16) debated by both AI reviewers and frozen. Key decisions: `getSecret()` returns raw values, not provider clients; permission checks enforced externally via `Organizations.checkPermission()`; `testConnection()` excluded; feature flags kept in scope. Mandatory Rules added: Secret Access Auditing, Permission Enforcement (external), Encryption at rest, Configuration Versioning. |
| 1.6 | Configuration Service v1.0 implemented and frozen (153/153 tests passing). Blocker resolved via Option B: Auth's internal `resolveSupabaseCredentials` rewired to call `getSecret()` three times concurrently via `Promise.all`. Key rotation documented as a known limitation/backlog item, not a v1 blocker. |
| 1.7 | Build Order (§13) revised: Mail moved ahead of Storage in Phase 1/2. Rationale — Mail's Rule 11 provisional stub already underlies real, frozen code paths (Auth's `registerUser`/`resetPassword`, Organizations' `inviteMember`), while Storage has zero consumers among built modules; specifying Storage now would repeat the speculative-dependency reasoning already rejected earlier in this project. Mail Module Specification added as new §17 — status DRAFT, pending debate. Formalizes the queue-and-retry reliability model first noted during Auth's Phase 1 build. Flags that `sendInvitationEmail()`'s exact signature must be validated against the real provisional stub in Step 1, not assumed. |
| 1.8 | Mail spec (§17) stress-tested and frozen: `getDeliveryStatus(workspaceId, messageId)` now workspace-scoped (was a cross-workspace info-leak risk as originally drafted); cross-provider failover (Resend→SES) explicitly deferred to backlog; **idempotency made a binding v1 rule, not backlog** — every send function takes an optional `idempotencyKey`, duplicate calls within the window return the original `messageId` instead of sending twice. Platform Freeze Log table added at the top of the document. |
| 1.9 | Mail v1.0 implemented and frozen (191/191 tests passing). Rule 11 provisional-to-frozen transition validated end-to-end: 6 conflicts found between the old stub and §17 (argument shape, URL-vs-token naming, workspaceId placement, return shape), resolved via Path A (internal rewiring of Auth's `registerUser`/`resetPassword` and Organizations' `inviteMember`/`resendInvitation` — neither module's public interface changed). Confirmed Mail does not construct URLs/tokens — it transports whatever the caller already built, with evidence trail. Delivery-status transition table logged as documentation-only backlog. |
| 2.0 | Storage ownership debated (Storage owns bytes/metadata only, never business meaning) and full §18 spec drafted. Two new Core Spec rules added: §3.10 File Ownership Rule (generalizes the Storage/owning-module split so Verify, Documents, Inspection inherit it automatically later) and §3.11 File Lifecycle Rule (no cascading deletes; owning module cleans up its own files). Upload model settled: presigned two-phase upload (createUpload/completeUpload), never proxying bytes through Codlok's servers. Checksum (SHA-256) mandatory, supplied by client at createUpload() and verified at completeUpload(). Objects immutable — content changes always produce a new fileId, never an overwrite; Storage has no concept of "current version," that's the owning module's decision. Upload State Rule made explicit: FAILED is terminal, no retry path; abandoned PENDING/UPLOADING uploads auto-expire to FAILED via TTL (Storage's own responsibility, since no business module owns an incomplete upload yet). §18 status: DRAFT, pending stress-test pass before freeze. |
| 2.1 | Storage (§18) stress-tested and frozen. Added: logical-then-physical delete for `deleteFile()` (marks DELETED immediately, physical provider removal is async with retry — same philosophy as Mail's queue-and-retry, so the caller's transaction never blocks on provider latency); explicit Upload Transaction Ownership Rule (formalizes that an incomplete upload belongs to Storage alone until `completeUpload()` succeeds, since no business module has a `fileId` reference yet). Confirmed two review claims did not apply — `getFile()`/`getDownloadUrl()` were already separate functions and `completeUpload()` already verified provider-side state — corrected rather than redundantly re-applied. Virus/malware scanning confirmed correctly out of scope for v1. |

---

## 1. Vision

Codlok Cloud is an **internal platform** — not a product sold to external developers or startups. It exists to power Codlok LLC's own products (SREMA Platform, SREMA Academy, AcadID, and future products) without rebuilding common infrastructure for each one.

Guiding principle: **build once, reuse forever, design for separation, build together.**

Products never talk directly to third-party providers (Stripe, Resend, OpenAI, Supabase, etc.). They always go through a Codlok module, which owns the provider relationship.

---

## 2. Architecture

Codlok Cloud is a **modular monolith**: one application, one deployment, one admin dashboard, many independently-bounded modules. It is not microservices. It is not a collection of separately deployed services.

```
Codlok Cloud (one application)
        │
   ┌────┴─────────────────────────┐
   │        Core Modules          │
   │  Auth · Organizations · Pay  │
   │  Mail · SMS · Notify         │
   │  Storage · Verify · AI       │
   │  Analytics · Logs            │
   └────┬─────────────────────────┘
        │
   ┌────┴────────┬─────────────┐
   ▼              ▼             ▼
SREMA         SREMA          AcadID
Platform      Academy      (Workspace)
(Workspace)   (Workspace)
```

Any module may be extracted into its own service later **if and only if** implementation proves it needs to scale independently (e.g. AI job queue load). This is a release valve, not a plan. Nothing is extracted speculatively.

---

## 3. Core Specification (the eleven platform rules)

These rules are frozen. They do not change unless implementation of a real module proves one of them wrong. This is the "constitution" — everything else depends on it.

### 3.1 What is a Module
A Module is a self-contained capability (Auth, Pay, Mail, Storage, Verify, AI, Organizations, etc.).
- Has one responsibility.
- Owns its internal logic and internal data.
- Exposes only a **public interface**.
- Never accesses another module's internals or database directly.

### 3.2 What is a Workspace
A Workspace is an isolated environment for one product (e.g. SREMA Platform, SREMA Academy, AcadID).

Each workspace has its own:
- Database
- Storage bucket
- Provider configuration (API keys per provider)
- Email templates
- Logs
- Analytics

A Workspace is not a module. Modules are shared capabilities; workspaces are isolated products that consume those capabilities.

### 3.3 Module Communication
Modules communicate **only** through their public interface.

- ✅ `Pay.createPayment()`, `Mail.sendVerificationEmail()`, `Auth.verifySession()`
- ❌ Importing another module's internal files
- ❌ Reading another module's database tables directly

This keeps modules replaceable and testable in isolation.

### 3.4 Secrets
Secrets (Stripe keys, Supabase service role keys, OpenAI keys, Resend keys, etc.) never live in code, git, or committed config files.

Secrets are stored in Codlok's central Configuration Service and requested by modules at runtime — modules never hardcode credentials. Changing a provider key never requires an application code change.

### 3.5 Database Isolation
**Decision: Option A — one database per workspace.**

Each workspace (SREMA Platform, SREMA Academy, AcadID, future products) gets its own separate database. This maximizes isolation, simplifies backup/restore per product, and reduces the risk of accidental cross-product data access — especially important when AI agents are writing the code.

### 3.6 Standard API Response
Every public module function returns this shape. No exceptions.

**Success:**
```json
{
  "success": true,
  "data": {},
  "meta": {}
}
```

**Failure:**
```json
{
  "success": false,
  "error": {
    "code": "PAYMENT_FAILED",
    "message": "Card was declined."
  }
}
```

Rules:
- Public interfaces never leak provider-specific errors (raw Stripe/Supabase errors). Each module translates provider errors into Codlok-standard error codes.
- Internal exceptions may be thrown inside a module; the public interface always returns the standard response shape above.

### 3.7 Workspace Provisioning
When a new workspace is created, Codlok automatically provisions: database, storage bucket, API key, configuration record, logs, analytics, default module settings.

**Provider credentials are never auto-created.** A module that depends on an external provider (Payments → Stripe, Mail → Resend, AI → OpenAI) remains **disabled** for that workspace until an administrator supplies valid credentials through the admin dashboard. No fake defaults, no silent fallback credentials.

### 3.8 Identity Ownership Rule
Auth is the sole owner of user identity. No other module may persist or become the source of truth for identity attributes (email, display name, verification status, etc.). A module may hold an identity field only as a request-scoped or short-TTL cache — never as a persisted column read back later as truth (e.g. no `email` column in the Workspace Members table treated as authoritative). Any module needing current identity data calls `Auth.getUser(userId)` and re-resolves it; it does not store a durable snapshot.

### 3.9 Data Ownership Rule
Generalizing §3.5 and §3.8: every piece of platform data has exactly one owning module, and only that module's public interface may read or write the authoritative copy. (Identity → Auth. Workspaces/membership/roles/permissions → Organizations. Payment records → Pay. Etc.) Other modules may cache transiently for their own request but must never treat their own copy as canonical.

### 3.10 File Ownership Rule
Storage owns file bytes, physical storage location, provider integration, checksums, and low-level lifecycle state (pending/uploaded/failed/deleted). Storage never knows or stores what a file *means* (evidence, passport, inspection photo, invoice, etc.) — that business meaning belongs entirely to the owning module (Verify, Documents, Inspection, etc.), which stores only a `fileId` reference and its own business fields. Storage has no `belongsToVerification`, `inspectionId`, or similar business-reference columns.

### 3.11 File Lifecycle Rule
Storage performs no cascading deletes and no automatic cleanup triggered by business events, because it has no visibility into business entities (§3.10) — deleting an Evidence record does not automatically delete its file. The owning module is responsible for calling `Storage.deleteFile()` itself when it no longer needs a file. Separately, Storage is responsible for its own bookkeeping: an upload that never completes (client never calls `completeUpload()`) is Storage's own orphan, not the caller's, and must be handled by Storage itself — see §19's Upload Abandonment rule.

---

## 4. Folder Structure

```
/codlok-cloud
  /modules
    /auth
    /organizations
    /pay
    /mail
    /sms
    /notify
    /storage
    /verify
    /ai
    /analytics
    /logs
  /admin          (admin dashboard — functionality, not yet built)
  /config         (central configuration/secrets service)
  /shared         (standard response types, shared utilities only — no business logic)
```

Each module folder contains its own internal structure (adapters, services, etc.) which is invisible to every other module. Only an `index`/public-interface file is importable from outside.

---

## 5. Technology Stack (initial)

- **Auth provider:** Supabase Auth
- **Database:** Postgres (one instance/database per workspace, per §3.5)
- **Storage providers:** Supabase Storage, Cloudflare R2, Amazon S3 (Storage module abstracts these)
- **Mail providers:** Resend (primary), Amazon SES, Mailgun, SMTP (fallback-capable)
- **Payment providers:** Stripe, Paystack, PayPal, Flutterwave, Wise
- **AI providers:** OpenAI, Anthropic, Gemini

Stack choices for modules beyond Auth are not finalized until that module is specified — do not assume providers not listed here.

---

## 6. Workspace Model

```
User (Auth — global identity, one record)
   │
   ▼
Organizations module scopes:
   SREMA Platform   → role: Founder
   SREMA Academy    → role: Instructor
   AcadID           → role: Student
```

- Identity is global: one `userId` per person, independent of workspace.
- Roles, permissions, and membership are workspace-scoped and owned by the **Organizations** module, not Auth.
- `workspaceId` may be passed to Auth functions as **context only** (branding, email templates, redirect URLs). It never scopes identity, credentials, or `userId`.

---

## 7. Provider Model

Each module that depends on external providers follows the same pattern:

```
Module Public Interface
        │
        ▼
Internal Provider Adapter(s)
        │
        ▼
Third-party API (Stripe / Resend / OpenAI / etc.)
```

- Products call the module's public interface only — never the provider directly.
- Providers are configured per-workspace (§3.7) and can be swapped without changing any product code, because products only ever depend on the module's function signatures, never the provider.
- A module may use multiple providers internally (e.g. Mail can queue and retry through Resend, falling back to SES) — this is entirely internal to the module and invisible to callers.

---

## 8. Development Rules (for AI coding agents)

1. Do not create a new module without explicit instruction. If you believe one is needed, stop and flag it — do not create it speculatively.
2. Do not add fields, endpoints, or error codes to a module's public interface beyond what its specification defines.
3. Do not have one module import or call into another module's internal files. Public interface only.
4. Do not hardcode provider credentials anywhere. Always read through the Configuration Service.
5. Every public function must return the standard response shape (§3.6) — no ad hoc shapes, ever.
6. If a module's specification doesn't cover a case you've hit, stop and ask rather than inventing behavior.
7. Only Auth (§10, fully specified) and Organizations (§12, drafted but not yet frozen — pending Auth) have specifications beyond the boundary level. All other modules are boundary-level only (§9) — do not write implementation code for them until they have a full module specification and their turn arrives in the Build Order (§13).

---

## 9. Module Boundaries (unbuilt modules — boundary-level only)

These modules are **not yet specified for implementation.** This section defines only what each module is responsible for, its dependencies, and what it explicitly does not own — enough for an agent to understand the platform shape without inventing function signatures, error codes, or internal behavior. Full specs are written immediately before each module is built, following the same process used for Auth.

### Organizations
- **Owns:** workspaces, membership, roles, permissions, invitations, teams (future).
- **Depends on:** Auth (to resolve `userId` → identity).
- **Does not own:** authentication, credentials, sessions.

### Pay
- **Owns:** one-time payments, subscriptions, refunds, webhooks, invoices.
- **Providers:** Stripe, Paystack, PayPal, Flutterwave, Wise.
- **Depends on:** Organizations (workspace context), Configuration Service (provider credentials).
- **Does not own:** billing/subscription business logic beyond payment execution (see Billing, future).

### Mail
- **Owns:** transactional email sending, templates, delivery logs, retry/queue reliability.
- **Providers:** Resend (primary), Amazon SES, Mailgun, SMTP.
- **Depends on:** Configuration Service.
- **Does not own:** marketing email campaigns (out of scope unless later expanded).

### SMS
- **Owns:** SMS sending.
- **Providers:** Twilio, Termii, Africa's Talking, Vonage.
- **Depends on:** Configuration Service.

### Notify
- **Owns:** unifying Email/SMS/push/in-app notifications behind one call.
- **Depends on:** Mail, SMS.
- **Does not own:** the actual sending — it composes and routes to Mail/SMS.

### Storage
- **Owns:** file/image/video/document upload, retrieval, deletion.
- **Providers:** Supabase Storage, Cloudflare R2, Amazon S3.
- **Depends on:** Configuration Service.

### Verify
- **Owns:** identity verification, face verification/liveness, document verification/OCR, business verification, address verification, trust score.
- **Depends on:** Storage (documents/images), AI (OCR/face match), Organizations (workspace context).
- **Compliance note:** handles biometric and identity documents. Before implementation, data retention, consent, and storage-location requirements must be defined per jurisdiction of use. This is not optional and is not covered elsewhere in this document.

### AI
- **Owns:** chat, OCR, vision, speech, embeddings — routing to the appropriate model per task.
- **Providers:** OpenAI, Anthropic, Gemini, local models.
- **Depends on:** Configuration Service.
- **Note:** provider routing is per-task static binding (e.g. "OCR always uses provider X"), not dynamic cost/quality routing — that is a separate, harder problem not in scope for v1.

### Analytics
- **Owns:** event collection, usage dashboards, reporting, per workspace.

### Logs
- **Owns:** API logs, audit trails, error tracking, per workspace.

### Admin Dashboard
- **Owns:** the UI/functionality for creating workspaces, connecting providers, managing users/roles, viewing logs/analytics. Not yet designed — functionality only, no UI spec exists yet.

---

## 10. Auth Module Specification v1.1 — STATUS: FROZEN (36/36 tests passing — 30 original + 6 for `getUser()` — boundary, regression, and compliance tests confirmed per Rule 12)

**Note (Rule 11, §14):** Auth's Phase 1 build required stubs for Configuration Service and Mail ahead of their own build phases. Those stub interfaces — including `Mail.sendInvitationEmail()` — are **provisional**, not frozen, and will be re-validated when Mail reaches its own Phase 2 design review. Their existence in Auth's codebase does not settle their final shape.

**v1.1 change:** Organizations validation (§12) found Auth had no way to resolve a `userId` into identity attributes — `verifySession()` takes an access token and returns only `{ userId, valid }`, which cannot serve member lists, invitation emails, or audit-trail display. Added one new function, `getUser(userId)`, below. No existing function's signature, behavior, or tests changed.

**Purpose:** Answers "who is this user?" — identity and authentication only. Nothing about roles, workspaces, or permissions (that is Organizations, §9).

**Provider adapter:** Supabase Auth.

### Public Interface

**`registerUser(email, password)`**
- Success `data`: `{ userId, email, emailVerified: false }`
- Errors: `EMAIL_ALREADY_EXISTS`, `WEAK_PASSWORD`, `INVALID_EMAIL`
- Side effect: calls `Mail.sendVerificationEmail()` through Mail's public interface. Auth does not know how Mail delivers, queues, or retries this — that is entirely internal to Mail.

**`loginUser(email, password)`**
- Success `data`: `{ userId, accessToken, refreshToken, expiresAt }`
- Errors: `INVALID_CREDENTIALS`, `ACCOUNT_LOCKED`, `EMAIL_NOT_VERIFIED`

**`logoutUser(accessToken)`**
- Success `data`: `{}`
- Errors: `INVALID_SESSION`

**`refreshSession(refreshToken)`**
- Success `data`: `{ accessToken, refreshToken, expiresAt }`
- Errors: `INVALID_REFRESH_TOKEN`, `REFRESH_TOKEN_EXPIRED`

**`verifySession(accessToken)`**
- Success `data`: `{ userId, valid: true }`
- Errors: `INVALID_SESSION`, `SESSION_EXPIRED`

**`getUser(userId)`** *(added in v1.1)*
- Purpose: resolve a stored `userId` (e.g. from a workspace membership record) into current identity attributes. Distinct from `verifySession`, which validates an access token and does not return identity fields.
- Success `data`: `{ userId, email, emailVerified }`
- Errors: `USER_NOT_FOUND`

**`resetPassword(email)`**
- Success `data`: `{ sent: true }` — **always returned regardless of whether the email exists**, to prevent email enumeration. Internally, Auth only calls `Mail.sendPasswordResetEmail()` if the user actually exists; the caller-facing response is identical either way.
- Errors: none exposed for this reason (no `USER_NOT_FOUND`)

**`changePassword(userId, oldPassword, newPassword)`**
- Success `data`: `{}`
- Errors: `INVALID_CREDENTIALS`, `WEAK_PASSWORD`

**`verifyEmail(token)`**
- Success `data`: `{ userId, emailVerified: true }`
- Errors: `INVALID_TOKEN`, `TOKEN_EXPIRED`

### Workspace Context
`workspaceId` may be passed optionally to relevant functions (e.g. `registerUser`, `resetPassword`) purely as **context** — it selects branding, email template, and redirect URL for the Mail calls Auth triggers. **It does not scope identity, alter authentication, or change the user's `userId`.** Identity is global — one user record regardless of how many workspaces they belong to.

### Module Interaction
Auth calls `Mail.sendVerificationEmail()` and `Mail.sendPasswordResetEmail()` through Mail's public interface only. Auth does not know or care whether Mail sends synchronously, queues, or retries — that reliability behavior is entirely internal to Mail and invisible to Auth.

### Core Spec Compliance Checklist
- [x] Uses only the standard API response format (§3.6)
- [x] Reads secrets through the Configuration Service (§3.4) — never hardcodes Supabase keys
- [x] Respects workspace isolation (§3.5, §6) — identity remains global, workspaceId is context only
- [x] Exposes only public interfaces (§3.1, §3.3)
- [x] Does not access other modules' internals (calls `Mail.*` only through its public interface)
- [x] Uses Codlok-standard error codes, not raw Supabase errors
- [x] Follows module boundary rules (§3.3)

---

## 11. Module Specification Template

Use this exact structure when specifying the next module (Organizations, then Pay, Mail, etc.). Do not add sections beyond this template without a real implementation reason.

```
## [Module Name] Module Specification v1.0

**Purpose:** [one sentence — what question does this module answer?]
**Out of scope:** [what it explicitly does not own]
**Provider adapter(s):** [initial provider(s)]

### Public Interface
For each function:
- Name + inputs
- Success `data` shape
- Error codes
- Any module dependencies it calls (through their public interface only)

### Workspace Context
[How, if at all, workspaceId affects this module's behavior]

### Module Interaction
[Which other modules' public interfaces this module calls, and why]

### Core Spec Compliance Checklist
- [ ] Uses only the standard API response format
- [ ] Reads secrets through the Configuration Service
- [ ] Respects workspace isolation
- [ ] Exposes only public interfaces
- [ ] Does not access other modules' internals
- [ ] Uses Codlok-standard error codes
- [ ] Follows module boundary rules
```

---

## 12. Organizations Module Specification v1.0 — STATUS: FROZEN (69 tests + 36 Auth regression = 105/105 passing; boundary, regression, compliance, privilege-escalation, and cross-workspace isolation tests confirmed)

**Design Rationale:**
- *Why does Organizations store only `userId`, not identity fields?* Per §3.8, identity has exactly one owner (Auth). Storing a duplicated `email` column would create a second source of truth that goes stale silently. Identity is resolved on-demand via `Auth.getUser()`.
- *Why do roles own permissions instead of allowing user-level grants?* Per-user overrides make a role's meaning unauditable — "what can this Admin actually do" would require checking both the role definition and a per-user diff. Roles as the sole permission source keep that answerable in one lookup.
- *Why is the Privilege Escalation Rule (subset-of-caller's-permissions) mandatory rather than optional?* Without it, any user with role-assignment rights could grant themselves or others unlimited access — a standard, well-known privilege-escalation vector. This is not a style preference; it's a security requirement.

**Purpose:** Answers "what can this authenticated user access, and what can they do?" Does not authenticate — depends entirely on Auth for identity.

**Depends on:** `Auth.verifySession()`, `Auth.getUser()` (public interface only). Auth must never depend on Organizations.

### Owns
Workspaces, membership, roles, permissions, invitations, teams (future), organization metadata.

### Does not own
Passwords, sessions, email verification, tokens, MFA — all Auth.

### Core Model
```
Identity (Auth) → Organizations → Workspace → Role → Permissions
```
One identity may belong to many workspaces with different roles in each. Identity never changes; only membership changes.

### Public Interface

**Workspace management:** `createWorkspace()`, `updateWorkspace()`, `deleteWorkspace()`, `getWorkspace()`, `listWorkspaces()`

**Membership:** `addMember()`, `removeMember()`, `transferOwnership()`, `leaveWorkspace()`, `listMembers()`, `checkAccess(userId, workspaceId)` → `{ member: true/false }`

**Roles:** `createRole()`, `updateRole()`, `deleteRole()`, `assignRole()`, `removeRole()`, `listRoles()`

**Permissions:** `listPermissions()`, `checkPermission()` — permissions are edited only through role editing. There is no `grantPermission()`/`revokePermission()` at the user level; per-user permission overrides are explicitly rejected for v1 (roles must remain the single source of truth for what a permission set means).

**Invitations:** `inviteMember()`, `acceptInvitation()`, `declineInvitation()`, `cancelInvitation()`, `resendInvitation()` — calls `Mail.sendInvitationEmail()` through Mail's public interface.

### Mandatory Rules

1. **Last Owner Rule:** a workspace must always have ≥1 Owner. `removeMember()` and `leaveWorkspace()` are rejected if the target is the sole remaining owner, unless `transferOwnership()` completes first.
2. **Ownership Transfer Rule:** `transferOwnership()` requires explicit confirmation, is recorded in the audit log, and is not reversible through normal role editing.
3. **Privilege Escalation Rule:** a user may only assign a role whose permission set is a subset of their own effective permissions. A user can never grant another user (or themselves) more access than they currently hold.

### Database Ownership
Organizations owns: Workspaces, Workspace Members, Roles, Permissions, Invitations tables. No other module may write to them directly.

### Workspace Rules
Every operation requires `workspaceId`, except `acceptInvitation()`/`declineInvitation()`, which resolve the workspace from the invitation token.

### Core Spec Compliance Checklist
- [ ] Uses only the standard API response format
- [ ] Reads secrets through the Configuration Service
- [ ] Respects workspace isolation
- [ ] Exposes only public interfaces
- [ ] Does not access other modules' internals
- [ ] Uses Codlok-standard error codes
- [ ] Follows module boundary rules
- [ ] Last Owner Rule enforced
- [ ] Privilege Escalation Rule enforced

---

## 13. Build Order

The agent is forbidden from jumping ahead of this order. One module at a time. Do not begin a module until the previous one is approved (§15).

```
Phase 1 — IN PROGRESS
  Auth              ✓ Frozen
  Organizations     ✓ Frozen
  Configuration     ✓ Frozen
  Mail              ➡ next (revised order — see rationale below)

Phase 2
  Storage
  Pay
  Audit

Phase 3
  Verify
  Evidence
  Notifications
  AI
  SMS
  Analytics
  Logs

Phase 4
  API Gateway
  Admin Dashboard
```

**Reordering rationale (v1.7):** Mail was originally Phase 2 alongside Storage/Notify. Moved ahead of Storage because, unlike at the start of the project, there is now real frozen code to weigh this against: Auth's `registerUser()`/`resetPassword()` and Organizations' `inviteMember()` already call `Mail.sendVerificationEmail()` / `sendPasswordResetEmail()` / `sendInvitationEmail()` as a Rule 11 provisional stub — real code paths running on an unvalidated interface. Storage has zero consumers among built modules; specifying it now would be based on assumptions about Verify/Evidence, the same speculative dependency reasoning rejected earlier in this project (§1, §9). The operating principle: build the next module that removes the largest amount of uncertainty from code that already exists, not the module a future diagram suggests will eventually be needed.

Modules beyond Auth and Organizations are boundary-level only (§9) until their phase arrives. Do not write implementation code, function signatures, or error codes for a later-phase module before its turn.

---

## 14. Engineering Playbook (rules for the coding agent)

This section tells the agent how to behave, not what to build.

1. **Never invent architecture.** If this specification doesn't cover something, stop and ask.
2. **Never change module boundaries.**
3. **Never change the standard API response format (§3.6).**
4. **Never access another module's database directly.** Always use its public interface.
5. **Never hardcode provider logic or credentials.** Always go through the Configuration Service and adapters.
6. **Never silently create a new module.** If you believe a new module is genuinely needed, this is itself a stop-and-ask blocker (§15) — raise it explicitly, do not create it and do not suppress the observation either.
7. **If implementation conflicts with the specification, stop.** Explain the conflict, propose the smallest possible fix, and wait for approval before proceeding.
8. **Build exactly one module at a time**, per the Build Order (§13).
9. **Every completed module must include tests, documentation, and a completed Compliance Checklist.**
10. **Do not continue to the next module until the current one is explicitly approved.**
11. **Provisional interfaces.** If a module temporarily exposes a public interface before its own specification/implementation phase (e.g. Auth's Phase 1 needing a Mail or Configuration Service stub ahead of their Phase 2 slot), that interface is **provisional**, not frozen. Its existence in code does not settle its shape. It must be re-validated during the dependent module's own design review, once that module is actually built, and may be changed at that point with no architecture violation and no backward-compatibility promise. Any module-boundary-import test (e.g. preventing `adapters/*.ts` from being imported outside its module) should be written as a general rule applied to every module, not a one-off for whichever module happened to need it first.
12. **Pre-freeze test requirement.** A module cannot be marked Frozen without all of: boundary tests (adapters/internals are not importable from outside the module), regression tests (all prior tests for that module still pass unmodified), and compliance tests (StandardResponse shape, module-boundary rules, and any ownership rules from §3 are explicitly verified, not assumed).

---

## 15. Reporting Format

Do not ask the agent "is it done?" Require one of the two reports below.

### Build Report (module complete)
```
=============================
MODULE BUILD REPORT
=============================
Module: [name] v1.0
Status: Completed
Compliance:
  ✓ Core Spec followed
  ✓ Response format followed
  ✓ Module boundaries respected
  ✓ Tests passed
  ✓ Documentation generated
Files Created: [list]
Issues: [none, or list]
Questions: [none, or list]
Ready For Review: YES
```

### Blocker Report (something doesn't match the spec)
```
=============================
BLOCKER REPORT
=============================
Problem: [what doesn't match]
Specification says: [quote/summary]
Reality: [what was actually found]
Recommendation:
  Option A: [...]
  Option B: [...]
Waiting for approval.
```

The agent stops at a Blocker Report. No guessing, no silent workarounds.

### Review Loop
```
Agent builds module
      ↓
Agent produces Build Report or Blocker Report
      ↓
You bring the report back for review
      ↓
Review checks: does the implementation follow this spec?
Are any proposed changes justified by real implementation findings?
      ↓
If yes — update this document minimally, noting what changed and why
      ↓
Module approved → next module in Build Order (§13)
```

---

## 16. Configuration Service Module Specification v1.0 — STATUS: FROZEN (implemented; 48 Configuration tests + 36 Auth + 69 Organizations = 153/153 passing; boundary, regression, compliance, encryption, auditing, and versioning tests confirmed per Rule 12)

**Purpose:** Answers "what is the current, correct provider credential/setting for this module, in this workspace?" It is the single authoritative store for secrets and per-workspace provider configuration, referenced by §3.4 (Secrets) and §3.7 (Workspace Provisioning) since Auth's Phase 1 build.

**Out of scope:** Business logic of any kind, including constructing provider SDK clients and validating that a credential actually works against its provider. Configuration does not know what a Stripe key is used for and does not talk to providers — it only stores, retrieves, and reports the status of configuration values. Each consuming module (Auth, Pay, Mail, etc.) constructs its own provider client from the raw value `getSecret()` returns and validates its own connection — Configuration never does this on a module's behalf (this was revised during debate; an earlier draft proposed Configuration return ready-made provider clients, which was rejected because it would require Configuration to depend on every provider's SDK, contradicting its own "no business logic" purpose and breaking the frozen Auth implementation's existing adapter pattern).

**Provider adapter(s):** None — Configuration Service has no external provider of its own. It is backing storage (currently env-var-backed per Auth's Phase 1 stub; this spec defines the real backing store).

**Constraint carried over from the existing Phase 1 stub (must not break):** Auth v1.1 and Organizations v1.0 already call into the Configuration Service stub. The public interface defined below must be a strict superset of what those two modules currently use, so that swapping the backing store requires zero code changes in Auth or Organizations — only wiring/dependency injection, per §8 rule 5 and the existing stub's documented promise.

### Public Interface

**`getSecret(workspaceId, key)`**
- Success `data`: `{ value }` — the raw secret value, returned only to the calling module's server-side code, never logged, never exposed through any HTTP route. Every call is audit-logged per the Secret Access Auditing rule below (metadata only, never the value).
- Errors: `SECRET_NOT_CONFIGURED`, `WORKSPACE_NOT_FOUND`

**`setSecret(workspaceId, key, value)`**
- Callable only from the Admin Dashboard layer, which must call `Organizations.checkPermission()` (Owner-only) before invoking this — Configuration itself performs no role/permission check (see Permission Enforcement below).
- Success `data`: `{ key, configured: true, version }`
- Errors: `INVALID_KEY`, `WORKSPACE_NOT_FOUND`

**`deleteSecret(workspaceId, key)`**
- Same caller constraint as `setSecret`.
- Success `data`: `{ key, configured: false }`
- Errors: `SECRET_NOT_CONFIGURED`, `WORKSPACE_NOT_FOUND`

**`getProviderStatus(workspaceId, moduleId)`** — answers "is this module enabled for this workspace," per §3.7's "no fake defaults" rule.
- Success `data`: `{ moduleId, configured: boolean, requiredKeys: string[], missingKeys: string[] }`
- Errors: `WORKSPACE_NOT_FOUND`, `UNKNOWN_MODULE`

**`listConfiguredModules(workspaceId)`**
- Success `data`: `{ modules: [{ moduleId, configured: boolean }] }`
- Errors: `WORKSPACE_NOT_FOUND`

**`getFeatureFlag(workspaceId, key)`** / **`setFeatureFlag(workspaceId, key, value)`**
- Feature flags are workspace configuration data, not business logic or permissions — kept in Configuration for that reason, called out explicitly here to prevent future scope creep into anything more than key-value flags.
- Success `data`: `{ key, value }`
- Errors: `FEATURE_FLAG_NOT_FOUND`, `WORKSPACE_NOT_FOUND`

**Explicitly excluded from this interface:** `testConnection()` and any function that returns a constructed provider client. Both were proposed during debate and rejected — see "Out of scope" above.

### Workspace Context
Every function requires `workspaceId` — configuration is always per-workspace (§3.7: no global fallback credentials, no defaults shared across workspaces). There is no global/default secret; a missing key for a given workspace is `SECRET_NOT_CONFIGURED`, not silently inherited from elsewhere.

### Module Interaction
Every other module calls `Configuration.getSecret()` to read its own provider credentials. No module reads another module's secrets. Configuration Service calls no other module directly — permission checks for `setSecret`/`deleteSecret` are the calling layer's (Admin Dashboard's) responsibility via `Organizations.checkPermission()`, not Configuration's.

### Mandatory Rules

1. **Secret Access Auditing:** every `getSecret()` call is logged with module, workspaceId, key requested, timestamp, and success/failure. The secret value itself is never logged.
2. **Permission Enforcement (external):** Configuration has no concept of Owner/Admin/Member — that coupling belongs in Organizations. Only the Admin Dashboard, after calling `Organizations.checkPermission()` and confirming Owner-level access, may call `setSecret()`/`deleteSecret()`.
3. **Encryption at rest:** secrets are never stored in plaintext. The master-key strategy (Cloud KMS, environment-injected master key, hardware key, etc.) is an implementation decision, not fixed by this spec — but the Module Build Report must explicitly document which strategy was used and why.
4. **Configuration Versioning:** every secret change is versioned, not silently overwritten. Store version number, `updatedBy`, and `updatedAt` as metadata (the secret value stays encrypted; only this metadata is retained for rollback and troubleshooting).

### Design Rationale
- *Why is there no global/default credential fallback?* §3.7 already established this for workspace provisioning generally — a module stays disabled until a workspace admin explicitly configures it. Configuration Service is simply the storage layer that enforces that rule; a silent fallback here would undermine §3.7 platform-wide.
- *Why per-workspace rather than per-module-global?* Each workspace (SREMA Platform, SREMA Academy, AcadID) may use different Stripe/Resend/OpenAI accounts. A global credential would leak one product's provider account into another's traffic.
- *Why does Configuration Service have no business logic, no SDK clients, and no `testConnection()`?* An earlier draft proposed Configuration return ready-made provider clients and validate connections itself. Both were rejected in debate: it would force Configuration to import and understand every provider's SDK, meaning it would need to change every time a new provider is added — directly contradicting its own purpose as a stable, provider-agnostic store. Client construction and connection validation stay with each consuming module, exactly as Auth's frozen implementation already does.
- *Why does permission enforcement live in Organizations instead of Configuration?* Adding role checks inside Configuration would create a new dependency (Configuration → Organizations) that doesn't otherwise exist and isn't necessary — the caller (Admin Dashboard) already has to call Organizations for permission checks regardless. Keeping Configuration a pure store, with the caller responsible for authorization, keeps the module boundary clean per §3.3.
- *Why audit logging and versioning instead of just "encrypt it and move on"?* Secrets are the highest-blast-radius data on the platform — a wrong or leaked credential can affect an entire product. Traceability (who accessed what, when) and rollback (what changed, by whom) are operational safety requirements, not optional polish, given what this module protects.

### Core Spec Compliance Checklist
- [x] Uses only the standard API response format
- [x] Secrets never appear in logs, error messages, or non-owning-module responses; only access metadata is logged
- [x] Respects workspace isolation — no cross-workspace secret access
- [x] Exposes only public interfaces
- [x] Does not access other modules' internals; does not call Organizations directly
- [x] Uses Codlok-standard error codes
- [x] Existing Auth/Organizations calls into the Phase 1 stub continue working unmodified against this real interface (Auth's internal adapter wiring was updated per Option B; Auth's public interface was not)
- [x] Secrets encrypted at rest (AES-256-GCM, env-injected master key); master-key strategy documented in Build Report
- [x] Secret changes versioned with updatedBy/updatedAt metadata

### Known Limitation (backlog, not a v1 blocker)
**Key rotation is not yet real rotation.** Changing `CODELOK_CONFIG_MASTER_KEY` today makes previously-encrypted secrets undecryptable — it swaps the key, it doesn't migrate existing ciphertext. Real rotation requires per-secret `keyVersion` metadata and a fallback decrypt chain (try current key version, fall back to prior versions) so an admin can rotate the master key without re-entering every secret. Scheduled for a later phase once the platform has enough real secrets in production that manual re-entry becomes impractical — not before.

---
## 17. Mail Module Specification v1.0 — STATUS: FROZEN (implemented; 38 Mail tests + 153 existing = 191/191 passing; boundary, idempotency, reliability, workspace isolation, and regression tests confirmed per Rule 12)

**Purpose:** Answers "how does an email actually get sent, reliably, regardless of which provider is behind it?" Retires the Rule 11 provisional stub that Auth (`registerUser`, `resetPassword`) and Organizations (`inviteMember`) are already calling in real, frozen code paths.

**Out of scope:** Marketing/campaign email (explicitly out of scope per the original §9 boundary description — transactional only for v1). Deciding *when* to send an email or *what* it should say beyond a template — callers (Auth, Organizations) decide that; Mail only delivers it reliably.

**Provider adapter(s):** Resend (primary). Amazon SES, Mailgun, SMTP listed in §5 as future-supported providers — not required for v1 freeze; the interface must not preclude adding them later without a contract change.

**Constraint carried over from the existing Phase 1 stub (must not break):** Auth v1.1 and Organizations v1.0 already call `Mail.sendVerificationEmail()`, `Mail.sendPasswordResetEmail()`, and `Mail.sendInvitationEmail()` against the provisional stub. This spec's public interface must be validated against that real call pattern in Step 1 (agent validation) before build — same discipline that caught five real conflicts during the Configuration Service build. Do not assume the stub's shape is already correct; check it.

### Public Interface

**`sendVerificationEmail(workspaceId, to, verificationToken, idempotencyKey?)`**
- Success `data`: `{ queued: true, messageId }`
- Errors: `INVALID_RECIPIENT`, `PROVIDER_NOT_CONFIGURED`

**`sendPasswordResetEmail(workspaceId, to, resetToken, idempotencyKey?)`**
- Success `data`: `{ queued: true, messageId }`
- Errors: `INVALID_RECIPIENT`, `PROVIDER_NOT_CONFIGURED`

**`sendInvitationEmail(workspaceId, to, invitationToken, inviterName, workspaceName, idempotencyKey?)`**
- Success `data`: `{ queued: true, messageId }`
- Errors: `INVALID_RECIPIENT`, `PROVIDER_NOT_CONFIGURED`
- Note: the provisional stub's actual signature must be checked in Step 1 — it may differ from this proposed shape (e.g. it may currently take fewer fields). Reconcile during validation, not by assumption.

### Idempotency (binding v1 rule, not backlog)
Every send function accepts an optional `idempotencyKey`. A request with the same `workspaceId` + `idempotencyKey` within the configured idempotency window (implementation detail — document the window length in the Build Report) returns the **original** `messageId` without sending a second email. This is a deliberate v1 contract decision: without it, a caller retrying after a timeout (e.g. `registerUser()` retried after `Mail` didn't respond in time) has no defined behavior — did one email send, two, or three? Idempotency lives inside Mail, the module that actually performs the send, rather than requiring every caller (Auth, Organizations, and every future module) to reinvent duplicate-prevention independently.

**`getDeliveryStatus(workspaceId, messageId)`**
- Success `data`: `{ messageId, status: "queued"|"sent"|"delivered"|"failed"|"bounced" }`
- Errors: `MESSAGE_NOT_FOUND`
- `workspaceId` is required for the same reason every other function requires it (§3.5) — without it, one workspace could query another's message status by guessing a `messageId`. A `messageId` belonging to a different workspace than the one supplied returns `MESSAGE_NOT_FOUND`, not the real status.

### Explicitly Out of Scope for v1 (stress-tested during debate, not oversights)
- **Cross-provider failover** (e.g. automatically switching from Resend to SES if Resend is down) is **not** in v1. Only same-provider retry with backoff is specified. Cross-provider failover requires reconciling different delivery-status semantics across providers and isn't required to retire the current stub — logged as backlog, same treatment as Configuration Service's key rotation.

### Reliability Model (per the earlier Auth v1.0 design note this spec must formalize)
When Auth v1.0 was built, the team noted a real risk: if `Mail.send...()` were purely synchronous, a slow or down provider would fail user registration itself. The resolution agreed at the time — restated here as a binding rule, not a suggestion:

- The public interface (`sendVerificationEmail()`, etc.) returns quickly with `{ queued: true, messageId }` — it does not block on provider delivery.
- Internally, Mail queues the send and retries on provider failure (exponential backoff, bounded retry count) without the caller (Auth, Organizations) knowing or caring.
- Callers never see a provider-specific error (Resend timeout, rate limit, etc.) — only `PROVIDER_NOT_CONFIGURED` (workspace hasn't set up Mail) or `INVALID_RECIPIENT` (bad email format) are ever surfaced.
- `getDeliveryStatus()` lets a caller check on a previously queued send if it needs to (e.g. an admin dashboard showing "invitation not yet delivered"), but callers are not required to poll it.

### Workspace Context
Every function requires `workspaceId` — provider selection (which Resend account, or fallback provider) and email branding/templates are per-workspace, per §6/§7. A workspace with no Mail provider configured gets `PROVIDER_NOT_CONFIGURED` per §3.7 — no silent fallback to a shared/default account.

### Module Interaction
Mail calls `Configuration.getSecret(workspaceId, key)` for provider credentials (e.g. Resend API key). Mail calls no other module. Auth and Organizations call Mail's public interface only — never Resend directly, per the foundational rule established in §2.

### Design Rationale
- *Why queue-and-retry instead of synchronous send?* Established during Auth's original build: a provider hiccup should never fail user registration or password reset. Reliability is Mail's job, invisible to callers — this is the same reasoning that led Configuration to hide encryption/versioning behind a simple `getSecret()`/`setSecret()` interface.
- *Why does `sendInvitationEmail()`'s exact shape need re-validation rather than being taken as final?* It was created as a Rule 11 provisional interface during Auth's Phase 1 build, anticipated for Organizations before Organizations existed. Provisional interfaces are explicitly not frozen by existence in code (Rule 11) — this is precisely the case that rule was written for.
- *Why is marketing/campaign email out of scope?* Different reliability, compliance (unsubscribe, CAN-SPAM/GDPR marketing rules), and volume characteristics than transactional mail. Bundling them would pull business logic into what should stay a thin, boring delivery layer — the same "no business logic" principle applied to Configuration Service.

### Core Spec Compliance Checklist
- [ ] Uses only the standard API response format
- [ ] Reads provider secrets only through `Configuration.getSecret()` — never hardcoded
- [ ] Respects workspace isolation — provider config and branding are per-workspace
- [ ] Exposes only public interfaces
- [ ] Does not access other modules' internals
- [ ] Uses Codlok-standard error codes; never leaks raw provider errors to callers
- [ ] Existing Auth/Organizations calls into the provisional stub validated and reconciled in Step 1 before build
- [ ] `getDeliveryStatus` rejects cross-workspace `messageId` lookups (returns `MESSAGE_NOT_FOUND`, not another workspace's real status)
- [ ] Idempotency verified: same `workspaceId` + `idempotencyKey` within the window returns the original `messageId`, does not send a second email

### Known Limitation (backlog, not a v1 blocker)
**No documented delivery-status state-transition table.** `getDeliveryStatus` returns one of `queued|sent|delivered|failed|bounced`, but there is no written definition of which transitions are valid (e.g. can `failed` become `delivered` after a retry succeeds? can `bounced` ever become `delivered`? no — but this isn't written down anywhere). Documentation-only fix, no code change required — add a transition diagram to `src/modules/mail/README.md`.

---

## 18. Storage Module Specification v1.0 — STATUS: FROZEN (stress-tested by both AI reviewers; logical-then-physical delete and Upload Transaction Ownership Rule added; getFile/getDownloadUrl separation and provider-side completeUpload verification confirmed already correct in draft; ready for agent validation and build)

**Purpose:** Answers "where do file bytes physically live, and how does a module get them in or out reliably?" Storage manages binary object lifecycle only — it has no knowledge of what a file *means*.

**Out of scope:** Business meaning of any file (evidence, passport, inspection photo, invoice — Storage never knows which). Authorization ("is this caller allowed to access this file") — the calling module (Verify, Documents, etc.) has already decided that before calling Storage; Storage assumes the caller had permission, exactly as Configuration assumes the Admin Dashboard already checked `Organizations.checkPermission()`.

**Provider adapter(s):** Supabase Storage, Cloudflare R2, Amazon S3 (per §5/§7).

**Upload model (settled during ownership debate — binding, not open):** Presigned two-phase upload. The client uploads bytes directly to the provider (S3/R2/Supabase Storage); Codlok's servers never transport file bytes themselves. This was chosen over direct-through-Codlok upload specifically because Storage will eventually handle large evidence photos/videos, and routing every byte through Codlok's own compute doesn't scale and adds unnecessary load for no benefit.

### Owns
File lifecycle (upload, download, delete), object metadata, checksums, upload state, provider selection, access URL generation. Per §3.10, Storage never stores a business reference (`inspectionId`, `belongsToVerification`, etc.) — only `fileId`, provider, bucket/path, mime, size, checksum, state, timestamps.

**Upload Transaction Ownership Rule:** until `completeUpload()` succeeds, the upload belongs to Storage alone — no business module has a `fileId` reference yet, because Storage hasn't handed one off. This is why Storage (not the owning module) is responsible for cleaning up abandoned uploads (see Upload Abandonment below): nothing outside Storage even knows an incomplete upload exists.

### Does not own
Business meaning of files, authorization decisions, cascading deletes triggered by business events (§3.11 — the owning module calls `deleteFile()` itself when it no longer needs a file).

### Public Interface

**`createUpload(workspaceId, mimeType, expectedSizeBytes, expectedChecksum)`**
- Client computes SHA-256 of the file *before* upload and supplies it here as `expectedChecksum` — Storage cannot compute a checksum for bytes it hasn't received yet. `completeUpload()` later verifies the provider-stored object actually matches this value.
- Success `data`: `{ uploadId, fileId, presignedUploadUrl, expiresAt, uploadHeaders }`
- Errors: `WORKSPACE_NOT_FOUND`, `PROVIDER_NOT_CONFIGURED`, `INVALID_MIME_TYPE`

**`completeUpload(workspaceId, uploadId)`**
- Confirms the object exists at the provider, verifies size and checksum match what `createUpload()` was given, and transitions state to `UPLOADED`. If verification fails, state transitions to `FAILED` (terminal — see Upload State Rule below).
- Success `data`: `{ fileId, state: "UPLOADED", checksum, sizeBytes }`
- Errors: `UPLOAD_NOT_FOUND`, `CHECKSUM_MISMATCH`, `UPLOAD_INCOMPLETE`, `UPLOAD_EXPIRED`

**`getDownloadUrl(workspaceId, fileId)`**
- Returns a time-limited presigned download URL. Storage does not check whether the caller *should* have access — the calling module already decided that.
- Success `data`: `{ downloadUrl, expiresAt }`
- Errors: `FILE_NOT_FOUND`, `FILE_NOT_UPLOADED`

**`getFile(workspaceId, fileId)`**
- Success `data`: `{ fileId, mimeType, sizeBytes, checksum, state, createdAt }`
- Errors: `FILE_NOT_FOUND`

**`deleteFile(workspaceId, fileId)`**
- **Logical-then-physical delete**, same philosophy as Mail's queue-and-retry: `state` transitions to `DELETED` immediately and the function returns — the caller's transaction never blocks on provider latency. Physical removal of the object from the provider happens asynchronously afterward, with retry on failure (bounded retry count, same pattern as Mail's provider retry). A file in `DELETED` state is already inaccessible via `getDownloadUrl()`/`getFile()` regardless of whether physical removal has completed yet.
- Success `data`: `{ fileId, state: "DELETED" }`
- Errors: `FILE_NOT_FOUND`

**`fileExists(workspaceId, fileId)`**
- Success `data`: `{ exists: boolean }`
- Errors: none (returns `{ exists: false }` rather than an error for a missing file — this is a boolean check, not a fetch)

**`getProviderStatus(workspaceId)`**
- Success `data`: `{ configured: boolean, provider: string | null }`
- Errors: `WORKSPACE_NOT_FOUND`

**Explicitly excluded from this interface:** `approveEvidence()`, `attachPhoto()`, `linkMission()`, `getLatestVersion()`, or any function implying business meaning or cross-version relationships. Versioning (a corrected file becomes a new, unrelated `fileId` rather than overwriting) is deliberate per the Design Rationale below — Storage mints an independent `fileId` for each version and has no concept of "which version is current." That decision belongs entirely to the owning module.

### Upload State Rule (binding, not just illustrative)
```
PENDING → UPLOADING → UPLOADED → DELETED
                    ↘ FAILED (terminal)
PENDING → FAILED (terminal, e.g. expired before any bytes arrived)
```
- `FAILED` is **terminal** for that `uploadId`. There is no `FAILED → PENDING` retry path — the client must call `createUpload()` again, which mints a fresh `uploadId` and `fileId`.
- `UPLOADED` is immutable. There is no `UPLOADED → PENDING` or `UPLOADED → UPLOADING` transition — content changes always produce a new `fileId` (see versioning above), never an overwrite of an uploaded object.
- **Upload Abandonment:** an upload that stays in `PENDING` or `UPLOADING` without reaching `completeUpload()` within a bounded TTL (implementation detail — document the TTL chosen in the Build Report) is automatically transitioned to `FAILED` by Storage itself. This is Storage's own bookkeeping responsibility (§3.11) — unlike orphaned *uploaded* files (the owning module's job to clean up), an incomplete upload has no owning module yet, since no `fileId` reference has been handed to any business module until `completeUpload()` succeeds.

### Mandatory Rules
1. **Checksum required, not optional.** Every upload requires a caller-supplied `expectedChecksum` (SHA-256) at `createUpload()` time, verified at `completeUpload()`. No upload can complete without a matching checksum.
2. **Immutability.** Uploaded objects are never overwritten. A changed file is a new upload with a new `fileId`. Established for auditability and to prevent silent data loss — not conditional on any particular future use case.
3. **Provider abstraction.** Exactly per §7 — callers never know or care whether a workspace uses S3, R2, or Supabase Storage.
4. **Workspace isolation.** Exactly per §3.5/§6 — every function requires `workspaceId`; no cross-workspace file access.
5. **No business knowledge (§3.10).** Storage stores no business-reference fields. Enforced by the public interface itself containing no such parameters.
6. **No cascading deletes (§3.11).** Deleting a business record (e.g. an Evidence entry) does not automatically delete its file — the owning module must call `deleteFile()` itself.
7. **Upload abandonment cleanup.** Incomplete uploads auto-expire to `FAILED` per the TTL rule above — this is Storage's responsibility, not the caller's.
8. **Logical-then-physical delete.** `deleteFile()` marks `DELETED` immediately and returns; physical provider removal happens asynchronously with retry, never blocking the caller.

### Workspace Context
Every function requires `workspaceId` — provider selection and bucket/path are per-workspace, per §6/§7, consistent with every other module.

### Module Interaction
Storage calls `Configuration.getSecret(workspaceId, key)` for provider credentials. Storage calls no other module. Every other module (Verify, Documents, Inspection, etc.) calls Storage's public interface only — never a provider SDK directly.

### Design Rationale
- *Why presigned two-phase upload instead of routing bytes through Codlok's servers?* Storage will eventually handle large evidence photos and videos. Proxying every byte through Codlok's own compute doesn't scale and adds cost/latency for no benefit — the client can upload directly to the provider just as securely via a presigned URL.
- *Why is checksum mandatory rather than optional?* An optional checksum means some files have integrity verification and others don't, which is worse than a consistent, simple rule. It also costs nothing extra to require it, since the client already has the bytes and can compute SHA-256 before uploading.
- *Why immutable objects instead of allowing overwrite?* Auditability and preventing silent data loss — if a "corrected" file silently replaced the original, there would be no way to recover or compare against what was originally uploaded. This is a general storage-hygiene principle, not something adopted because of any specific future use case.
- *Why does Storage have no concept of "current version"?* Per §3.10, "which version is authoritative" is a business decision, not a storage fact. If Storage tracked "latest version," it would need to understand version relationships between files — business meaning it isn't supposed to have. The owning module (e.g. Verify) tracks which `fileId` is current; Storage just holds independent, immutable objects.
- *Why does Storage handle its own abandoned-upload cleanup instead of leaving it to the owning module (per §3.11's general no-cascading-cleanup rule)?* §3.11's cleanup rule assumes a business module already owns a reference to the file — but an incomplete upload was never handed off to any business module in the first place (that only happens after `completeUpload()` succeeds). Nobody outside Storage even knows an abandoned `uploadId` exists, so only Storage can clean it up.

### Core Spec Compliance Checklist
- [ ] Uses only the standard API response format
- [ ] Reads provider secrets only through `Configuration.getSecret()` — never hardcoded
- [ ] Respects workspace isolation — no cross-workspace file access
- [ ] Exposes only public interfaces
- [ ] Does not access other modules' internals
- [ ] Uses Codlok-standard error codes; never leaks raw provider errors to callers
- [ ] No business-reference fields anywhere in Storage's data model (§3.10)
- [ ] No cascading deletes triggered by business events (§3.11)
- [ ] Abandoned uploads (PENDING/UPLOADING past TTL) auto-transition to FAILED
- [ ] Checksum verified on every `completeUpload()`; mismatch blocks completion
- [ ] No overwrite of `UPLOADED` objects — content changes always produce a new `fileId`
- [ ] `deleteFile()` returns immediately with logical DELETED state; physical removal is async with retry

---

## 19. What Happens Next

**Current status:**
- Core Spec: Frozen (11 rules).
- Auth v1.1: Frozen (36/36 tests).
- Organizations v1.0: Frozen (105/105 tests).
- Configuration Service v1.0: Frozen (153/153 tests).
- Mail v1.0: Frozen (191/191 tests).
- Storage v1.0 (§18): DRAFT — ownership already debated and agreed; the full interface above needs its own stress-test pass (same as every prior module) before freeze.

**Next steps, in order:**
1. Debate this Storage draft (§18) — same review-board process used for every prior module. Particular attention to: the Upload State Rule's edge cases, whether the TTL for abandoned uploads needs to be specified now or left to the Build Report (precedent: Configuration's master-key strategy and Mail's idempotency window were both left as implementation decisions documented in the Build Report — likely the same pattern applies here), and whether any additional error codes are needed.
2. Freeze the Storage spec.
3. Send the agent to validate — Storage has no existing provisional stub to reconcile against (unlike Mail), since nothing currently calls Storage. Step 1 should instead confirm no other frozen module already assumes a different Storage shape.
4. Build Storage per §18.
5. Boundary + regression + compliance tests (Rule 12) before Storage can be marked Frozen — regression must include all 191 existing tests.
6. Only after Storage is frozen does Phase 2 continue per §13's Build Order.
7. Do not pre-specify Pay, Verify, Evidence, etc. beyond §9's boundary-level description until their turn.

### Agent Prompt Template (reusable per module)

> You are the lead backend engineer for Codlok Cloud. This document is your only source of truth — check the Spec Version header before starting. Do not invent architecture. Do not add modules. Do not change API contracts, response formats, or module boundaries. Implement only the current module in the Build Order (§13). If the specification is unclear, stop and report the ambiguity. If implementation conflicts with the specification, stop, explain the conflict, propose the smallest possible change, and wait for approval. Do not proceed to the next module until the current one is approved. Report using the formats in §15.
