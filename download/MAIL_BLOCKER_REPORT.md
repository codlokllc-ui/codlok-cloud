=============================
BLOCKER REPORT
=============================

Module: Mail v1.0 (Phase 2, per §13 Build Order as revised in v1.7)
Stage:  STEP 1 — Validation (§17 public interface vs. actual provisional stub usage)
Result: SPEC CONFLICT FOUND — but resolution is mandated by Rule 11.
        STOPPING per directive to report before proceeding.

------------------------------------------------------------------------
Problem
------------------------------------------------------------------------

§17's frozen public interface conflicts with the current provisional
Mail stub that Auth v1.1 and Organizations v1.0 call today. The stub
was created during Auth's Phase 1 build as a Rule 11 provisional
interface — explicitly NOT frozen, explicitly intended to be
re-validated when Mail reached its own design review. That review has
now happened (§17 is FROZEN). The stub's shape does NOT match §17's
shape. Six conflicts exist.

Per Rule 11 (§14): "If a module temporarily exposes a public interface
before its own specification/implementation phase ... that interface
is provisional, not frozen. Its existence in code does not settle its
shape. It must be re-validated during the dependent module's own
design review, once that module is actually built, and may be changed
at that point with no architecture violation and no backward-
compatibility promise."

So the resolution direction is clear: the stub and its callers MUST
be updated to match §17. This is NOT a spec violation — it's the
exact scenario Rule 11 was written for. However, the directive says
"STOP and submit a Blocker Report" if anything conflicts, so I am
reporting before making changes.

------------------------------------------------------------------------
Specification says (§17, FROZEN)
------------------------------------------------------------------------

§17 Public Interface (lines 664–683):

  sendVerificationEmail(workspaceId, to, verificationToken, idempotencyKey?)
    → Success data: { queued: true, messageId }
    → Errors: INVALID_RECIPIENT, PROVIDER_NOT_CONFIGURED

  sendPasswordResetEmail(workspaceId, to, resetToken, idempotencyKey?)
    → Success data: { queued: true, messageId }
    → Errors: INVALID_RECIPIENT, PROVIDER_NOT_CONFIGURED

  sendInvitationEmail(workspaceId, to, invitationToken, inviterName,
                      workspaceName, idempotencyKey?)
    → Success data: { queued: true, messageId }
    → Errors: INVALID_RECIPIENT, PROVIDER_NOT_CONFIGURED

  getDeliveryStatus(workspaceId, messageId)
    → Success data: { messageId, status: "queued"|"sent"|"delivered"|"failed"|"bounced" }
    → Errors: MESSAGE_NOT_FOUND

Key §17 requirements:
  - workspaceId is REQUIRED and FIRST (line 697: "Every function
    requires workspaceId")
  - Functions take TOKENS (verificationToken, resetToken,
    invitationToken), NOT URLs. Callers pass tokens; Mail does not
    construct URLs.
  - Return shape is { queued: true, messageId }, NOT
    { sent: true, provider, sentAt }.
  - Idempotency via optional idempotencyKey (binding v1 rule).
  - Queue-and-retry: returns quickly with { queued: true }; retry
    happens internally, invisible to callers.
  - Callers only see INVALID_RECIPIENT or PROVIDER_NOT_CONFIGURED —
    never raw provider errors.

------------------------------------------------------------------------
Reality (actual provisional stub + caller usage)
------------------------------------------------------------------------

STUB (src/modules/mail/index.ts):

  sendVerificationEmail(input: { to, verificationUrl, workspaceId? })
    → { sent: true, provider: 'stub', sentAt }

  sendPasswordResetEmail(input: { to, resetUrl, workspaceId? })
    → { sent: true, provider: 'stub', sentAt }

  sendInvitationEmail(input: { to, inviteUrl, inviterName?,
                               workspaceName?, workspaceId? })
    → { sent: true, provider: 'stub', sentAt }

  (No getDeliveryStatus function.)

CALLERS:

Auth (src/modules/auth/index.ts):
  - registerUser (line 208): Mail.sendVerificationEmail({
      to: user.email,
      verificationUrl,           // ← full URL, not token
      workspaceId: ctx?.workspaceId,  // ← optional
    })
  - resetPassword (line 367): Mail.sendPasswordResetEmail({
      to: email,
      resetUrl,                  // ← full URL, not token
      workspaceId: ctx?.workspaceId,
    })

Organizations (src/modules/organizations/index.ts):
  - inviteMember (line 528): Mail.sendInvitationEmail({
      to: ...,
      inviteUrl,                 // ← full URL, not token
      inviterName: ...,
      workspaceName: ws.name,
      workspaceId: ws.id,
    })
  - resendInvitation (line 593): same shape

TESTS:
  - Auth tests (src/modules/auth/__tests__/auth.test.ts) import
    _getOutboxForTesting, _clearOutboxForTesting from '@/modules/mail'.
    They check outbox entries' .type, .to, .url fields.
  - Organizations tests (src/modules/organizations/__tests__/
    organizations.test.ts) do the same, AND critically: the createUser
    helper (line 73-78) parses entry.url to extract the verification
    token from the outbox. So tests depend on the outbox storing
    full URLs.
  - src/app/api/mail/outbox/route.ts exposes the outbox via HTTP.
  - src/app/page.tsx (demo UI) consumes the outbox.

------------------------------------------------------------------------
Conflict breakdown (6 conflicts)
------------------------------------------------------------------------

CONFLICT 1 — Argument shape: object-input vs. positional
  Stub:  sendVerificationEmail({ to, verificationUrl, workspaceId? })
  §17:   sendVerificationEmail(workspaceId, to, verificationToken, idempotencyKey?)
  Impact: Auth and Organizations call with object; §17 expects positional.

CONFLICT 2 — URL vs. Token
  Stub:  takes verificationUrl / resetUrl / inviteUrl (full URLs)
  §17:   takes verificationToken / resetToken / invitationToken (just tokens)
  Impact: Callers currently construct URLs (Auth's buildVerificationUrl,
          Organizations' _buildInviteUrl) and pass them. §17 says Mail
          should receive just the token. Either:
    (a) Callers stop constructing URLs and pass tokens only — but then
        who constructs the URL? §17 doesn't say Mail constructs URLs.
    (b) Mail receives the token AND constructs the URL internally —
        but §17's signature only takes a token, no base URL or workspace
        branding info to construct from.
  This is a genuine ambiguity in §17. §17 line 656 says Mail's job is
  "delivers it reliably" — it does NOT say Mail constructs URLs. But
  §17's signature takes a token, not a URL. The most sensible reading:
  the CALLER still constructs the URL (because the caller knows the
  base URL and branding), but passes it... wait, §17 explicitly says
  "verificationToken", not "verificationUrl". So either:
    - The caller passes a token and Mail wraps it in a URL (requires
      Mail to know the base URL — feasible, CODELOK_APP_BASE_URL env
      var already exists), OR
    - The caller passes a URL and §17's "verificationToken" is loose
      wording for "the thing the user clicks" (could be a URL).
  RECOMMENDATION: Treat §17's "verificationToken" as "the clickable
  credential" — which in practice is a URL (because that's what
  registerUser/resetPassword/inviteMember produce today). Mail stores
  and sends it as-is. This is the smallest change: callers pass the
  same URL they pass today, just renamed from verificationUrl to
  verificationToken in the positional arg. No URL construction moves
  into Mail. This preserves the existing caller behavior exactly.

CONFLICT 3 — workspaceId: optional vs. required-and-first
  Stub:  workspaceId? (optional, inside object)
  §17:   workspaceId (required, first positional arg)
  Impact: Auth currently passes ctx?.workspaceId (may be undefined).
          §17 requires it. Per §16 precedent (Auth's
          resolveSupabaseCredentials uses '__global__' sentinel when
          workspaceId is undefined), we apply the same sentinel here.

CONFLICT 4 — Return shape
  Stub:  { sent: true, provider: 'stub', sentAt }
  §17:   { queued: true, messageId }
  Impact: Callers don't currently read the return value's fields
          (Auth's registerUser awaits but doesn't use the result;
          resetPassword catches and swallows; Organizations' invite
          awaits but doesn't use). So changing the return shape is
          SAFE — no caller depends on .sent / .provider / .sentAt.
          However, TESTS check the outbox (separate from the return
          value), so the outbox must be preserved.

CONFLICT 5 — getDeliveryStatus absent from stub
  Stub:  No getDeliveryStatus function.
  §17:   getDeliveryStatus(workspaceId, messageId) required.
  Impact: Pure addition. No caller currently uses it. No conflict —
          just needs to be implemented.

CONFLICT 6 — Tests depend on outbox .url field
  Tests: Organizations' createUser helper parses entry.url to extract
         the verification token. Auth tests check entry.url exists.
  §17:   Doesn't mention an outbox. The outbox is a stub-era test
         helper, not part of the public interface.
  Impact: If I remove the outbox, tests break. The outbox must be
          PRESERVED as a test-only helper (not part of the §17 public
          surface) so existing tests continue to work. The outbox
          entries should continue to record { type, to, url,
          workspaceId, sentAt } for test inspection. This is a
          test-only escape hatch, same pattern as Configuration's
          _resetStoreForTesting and Organizations' _resetStoreForTesting.

------------------------------------------------------------------------
Why this is NOT a true blocker (per Rule 11)
------------------------------------------------------------------------

Rule 11 explicitly says provisional interfaces "may be changed at
[the dependent module's own design review] with no architecture
violation and no backward-compatibility promise." §17 IS that design
review. The stub's shape was never frozen. So updating the stub and
its callers to match §17 is the SPEC-MANDATED outcome, not a
violation.

However, the directive says "If anything conflicts, STOP and submit
a Blocker Report." I am honoring that instruction. The "blocker" is
not a spec contradiction (unlike the Configuration Service case,
where §16 contradicted its own line 563 constraint) — it's the
expected Rule 11 transition from provisional to frozen interface.

------------------------------------------------------------------------
Recommendation (smallest possible change)
------------------------------------------------------------------------

Only one viable path. The other options would violate §17 (frozen)
or Rule 11.

  PATH A (ONLY VIABLE) — Update stub + callers to match §17.
  Preserve test outbox as a test-only helper.

    A1. Rebuild src/modules/mail/index.ts to implement §17's public
        interface exactly:
          - sendVerificationEmail(workspaceId, to, verificationToken, idempotencyKey?)
          - sendPasswordResetEmail(workspaceId, to, resetToken, idempotencyKey?)
          - sendInvitationEmail(workspaceId, to, invitationToken, inviterName, workspaceName, idempotencyKey?)
          - getDeliveryStatus(workspaceId, messageId)
        All return StandardResponse per §3.6.
        Success data: { queued: true, messageId } / { messageId, status }.
        Errors: INVALID_RECIPIENT, PROVIDER_NOT_CONFIGURED, MESSAGE_NOT_FOUND.

    A2. Treat §17's "verificationToken" / "resetToken" / "invitationToken"
        as "the clickable credential the caller passes" — which in
        practice is the URL the caller already constructs. This is the
        smallest change: callers pass the same string they pass today,
        just as a positional arg renamed from *Url to *Token. No URL
        construction moves into Mail. (Documented in Build Report.)

    A3. Rewire Auth's registerUser (line 208) and resetPassword
        (line 367) to call Mail with §17's positional signature.
        Auth public interface UNCHANGED. Auth tests UNCHANGED.
        Use '__global__' sentinel for optional workspaceId (same as
        Configuration Service precedent).

    A4. Rewire Organizations' inviteMember (line 528) and
        resendInvitation (line 593) to call Mail with §17's positional
        signature. Organizations public interface UNCHANGED.
        Organizations tests UNCHANGED.

    A5. PRESERVE the test outbox (_getOutboxForTesting,
        _clearOutboxForTesting, OutboxEntry type) as test-only exports.
        The outbox records every send with { type, to, url (the token
        passed), workspaceId, messageId, queuedAt, status }. Existing
        tests that check entry.type, entry.to, entry.url continue to
        work. New tests can also check entry.messageId, entry.status.

    A6. Implement queue-and-retry reliability model:
        - Public functions return immediately with { queued: true,
          messageId } after enqueueing.
        - Internal worker attempts provider send with exponential
          backoff (bounded retries).
        - Provider errors are caught and either retried or recorded
          as delivery status 'failed' — never surfaced to caller.
        - Only INVALID_RECIPIENT (bad email format) and
          PROVIDER_NOT_CONFIGURED (no Resend key in Configuration)
          are surfaced to callers.

    A7. Implement idempotency:
        - Idempotency window: 24 hours (documented in Build Report).
        - Key: workspaceId + idempotencyKey.
        - Within window: return original messageId, do not send twice.
        - After window: treat as new request.

    A8. Implement getDeliveryStatus with workspace-scoped lookup:
        - messageId belongs to exactly one workspace.
        - Cross-workspace lookup returns MESSAGE_NOT_FOUND (not the
          real status).

    A9. Read Resend API key via Configuration.getSecret(workspaceId,
        'RESEND_API_KEY', 'mail'). If not configured →
        PROVIDER_NOT_CONFIGURED.

    A10. Run all 153 existing tests. All must pass unmodified.
         (Auth tests check the outbox; Organizations tests check the
         outbox; Configuration tests don't touch Mail. The outbox is
         preserved, so these tests continue to work.)

    A11. Write Mail tests per Rule 12: boundary, functional, workspace
         isolation, idempotency, retry/reliability, compliance.

  NO ALTERNATIVE OPTIONS. §17 is frozen; Rule 11 mandates the
  transition. The only question is execution.

------------------------------------------------------------------------
Behavioral changes to callers (all internal wiring, no public
contract changes)
------------------------------------------------------------------------

Auth (src/modules/auth/index.ts):
  - registerUser: Mail.sendVerificationEmail({to, verificationUrl, workspaceId})
    → Mail.sendVerificationEmail(workspaceId ?? '__global__', user.email, verificationUrl)
  - resetPassword: Mail.sendPasswordResetEmail({to, resetUrl, workspaceId})
    → Mail.sendPasswordResetEmail(workspaceId ?? '__global__', email, resetUrl)
  Auth public interface: UNCHANGED (registerUser, resetPassword signatures unchanged).

Organizations (src/modules/organizations/index.ts):
  - inviteMember: Mail.sendInvitationEmail({to, inviteUrl, inviterName, workspaceName, workspaceId})
    → Mail.sendInvitationEmail(workspaceId, email, inviteUrl, inviterName, workspaceName)
  - resendInvitation: same rewire.
  Organizations public interface: UNCHANGED.

Tests: UNCHANGED. The outbox helpers (_getOutboxForTesting,
_clearOutboxForTesting) and OutboxEntry shape (type, to, url,
workspaceId, sentAt) are preserved. Tests that parse entry.url to
extract tokens continue to work.

------------------------------------------------------------------------
Decision required
------------------------------------------------------------------------

  (i)  Approve Path A — rebuild Mail per §17, rewire Auth +
       Organizations internal calls, preserve test outbox, run full
       regression. This is the Rule 11-mandated transition.

  (ii) Other direction you specify.

No Mail code has been written yet. No Auth or Organizations code has
been modified. STOPPED per directive.

------------------------------------------------------------------------
Status
------------------------------------------------------------------------

Mail: NOT BUILT (§17 conflicts with provisional stub — 6 conflicts,
      all expected per Rule 11 transition)
Auth: UNCHANGED (frozen v1.1, pending internal rewiring of
      registerUser/resetPassword Mail calls)
Organizations: UNCHANGED (frozen v1.0, pending internal rewiring of
      inviteMember/resendInvitation Mail calls)
Spec: UNCHANGED (§17 frozen; Rule 11 explicitly permits this transition)
Ready For Review: NO — waiting on direction decision (i) or (ii)
