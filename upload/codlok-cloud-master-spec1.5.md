# Codlok Cloud — Master Specification

**Spec Version: 1.5** — Last updated: Configuration Service (§16) debated and frozen. Ready for agent validation and build.

**Status:** Canonical. This is the single source of truth handed to any AI coding agent building Codlok Cloud. Do not invent module boundaries, response shapes, or architecture beyond what is written here. If something is ambiguous, stop and ask rather than assume.

**Before starting any task, check the Spec Version number above against the version you were last told to expect. If it doesn't match, or if you were given no version to expect, treat this file as authoritative and re-verify every precondition a directive claims — do not trust a directive's description of what the spec contains; check this file directly.**

## Changelog
| Version | Change |
|---|---|
| 1.0 | Initial master spec: vision, Core Spec §3.1–3.7, architecture, Auth v1.0 (full spec), Organizations v1.0 (draft), module boundaries, build order, engineering playbook |
| 1.1 | Auth v1.0 approved and frozen (implemented, 30/30 tests). Rule 11 (Provisional Interfaces) added. |
| 1.2 | Added §3.8 Identity Ownership Rule, §3.9 Data Ownership Rule. Auth updated to v1.1 (added `getUser(userId)`). §12 Organizations dependency line corrected from `Auth.verifyUser()` to `Auth.getUser()`. |
| 1.3 | Auth v1.1 approved and frozen (`getUser()` implemented, 36/36 tests passing, boundary/regression/compliance tests confirmed). Rule 12 (Pre-freeze Test Requirement) added to Engineering Playbook. |
| 1.4 | Organizations v1.0 approved and frozen (105/105 tests passing incl. privilege-escalation and cross-workspace isolation). Design Rationale subsections added to §10/§12 (replacing separate per-module ADR files). Configuration Service Module Specification added as new §16 — status DRAFT. |
| 1.5 | Configuration Service (§16) debated by both AI reviewers and frozen. Key decisions: `getSecret()` returns raw values, not provider clients (modules construct their own SDK clients); permission checks for `setSecret`/`deleteSecret` enforced externally by the Admin Dashboard via `Organizations.checkPermission()`, not inside Configuration; `testConnection()` explicitly excluded; feature flags kept in scope as plain key-value config. Added Mandatory Rules: Secret Access Auditing, Permission Enforcement (external), Encryption at rest (master-key strategy documented in Build Report, not fixed by spec), Configuration Versioning. Ready for agent validation and build — next step in §17. |

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

## 3. Core Specification (the nine platform rules)

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
  Auth
  Organizations

Phase 2
  Configuration Service
  Mail
  Storage
  Notify

Phase 3
  Pay
  AI
  Verify

Phase 4
  Analytics
  Logs
  Admin Dashboard
```

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

## 16. Configuration Service Module Specification v1.0 — STATUS: FROZEN (debated by both AI reviewers; revisions incorporated below; ready for agent validation and build)

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
- [ ] Uses only the standard API response format
- [ ] Secrets never appear in logs, error messages, or non-owning-module responses; only access metadata is logged
- [ ] Respects workspace isolation — no cross-workspace secret access
- [ ] Exposes only public interfaces
- [ ] Does not access other modules' internals; does not call Organizations directly
- [ ] Uses Codlok-standard error codes
- [ ] Existing Auth/Organizations calls into the Phase 1 stub continue working unmodified against this real interface
- [ ] Secrets encrypted at rest; master-key strategy documented in Build Report
- [ ] Secret changes versioned with updatedBy/updatedAt metadata

---

## 17. What Happens Next

**Current status:**
- Core Spec: Frozen.
- Auth v1.1: Frozen (36/36 tests).
- Organizations v1.0: Frozen (105/105 tests).
- Configuration Service v1.0 (§16): DRAFT — this is the next milestone, not yet debated/frozen.

**Next steps, in order:**
1. Debate this Configuration Service draft (§16) — the same review-board process used for Organizations. Resolve any open questions, revise if needed.
2. Freeze the Configuration Service spec.
3. Send the agent to validate the frozen spec against the real Auth/Organizations stub usage (Step 1, same pattern as every prior module) and report before writing any code.
4. Build Configuration Service per §16, replacing the Phase 1 stub without changing Auth or Organizations code.
5. Boundary + regression + compliance tests (Rule 12) before Configuration Service can be marked Frozen.
6. Only after Configuration Service is frozen does Phase 2 continue to Mail, Storage, Notify (§13) — each following this same lifecycle: draft spec → debate → freeze spec → agent validates → build → Build Report → review → freeze module → next module.
7. Do not pre-specify Pay, AI, Verify, etc. beyond §9's boundary-level description until their turn.

### Agent Prompt Template (reusable per module)

> You are the lead backend engineer for Codlok Cloud. This document is your only source of truth — check the Spec Version header before starting. Do not invent architecture. Do not add modules. Do not change API contracts, response formats, or module boundaries. Implement only the current module in the Build Order (§13). If the specification is unclear, stop and report the ambiguity. If implementation conflicts with the specification, stop, explain the conflict, propose the smallest possible change, and wait for approval. Do not proceed to the next module until the current one is approved. Report using the formats in §15.
