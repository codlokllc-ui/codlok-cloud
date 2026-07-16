# Codlok Cloud — Master Specification v1.0

**Status:** Canonical. This is the single source of truth handed to any AI coding agent building Codlok Cloud. Do not invent module boundaries, response shapes, or architecture beyond what is written here. If something is ambiguous, stop and ask rather than assume.

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

## 3. Core Specification (the seven platform rules)

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

## 10. Auth Module Specification v1.0 (fully specified — first module to build)

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

## 12. Organizations Module Specification v1.0 (Draft — pending Auth implementation)

**Status: DRAFT, not frozen.** This was specified ahead of Auth being built, out of the normal order (§13 build order). It may not be revised speculatively further, but it must be re-validated once Auth is actually implemented and Organizations is built against Auth's real public interface — not before.

**Purpose:** Answers "what can this authenticated user access, and what can they do?" Does not authenticate — depends entirely on Auth for identity.

**Depends on:** `Auth.verifySession()`, `Auth.verifyUser()` (public interface only). Auth must never depend on Organizations.

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

## 16. What Happens Next

1. Build Auth (§10) against this document. Nothing else. Use the agent prompt below.
2. Bring back a Build Report or Blocker Report — not a status update.
3. Only after Auth is approved does Organizations (§12) get re-validated against Auth's real interface and move from Draft to Frozen.
4. Repeat per module, strictly in Build Order (§13).
5. Do not pre-specify Pay, Mail, Verify, AI, etc. beyond §9's boundary-level description until it is that module's turn.

### Agent Prompt

> You are the lead backend engineer for Codlok Cloud. This document is your only source of truth. Do not invent architecture. Do not add modules. Do not change API contracts, response formats, or module boundaries. Implement only the current module in the Build Order (§13) — right now, that is Auth (§10). If the specification is unclear, stop and report the ambiguity. If implementation conflicts with the specification, stop, explain the conflict, propose the smallest possible change, and wait for approval. Do not proceed to the next module until the current one is approved. Report using the formats in §15.
