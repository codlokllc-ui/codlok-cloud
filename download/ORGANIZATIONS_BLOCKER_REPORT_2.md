=============================
BLOCKER REPORT
=============================

Module: Organizations v1.0 (Phase 1, second module per §13)
Stage:  Step 1 — Validation (directive's stated preconditions vs. actual codebase)
Result: PRECONDITION MISMATCH — STOPPED per directive

------------------------------------------------------------------------
Problem
------------------------------------------------------------------------

The directive asserts three preconditions that are NOT reflected in the
actual codebase or the on-disk Master Specification:

  1. "Auth Module v1.1 is APPROVED and FROZEN."
  2. "Auth public interface now includes getUser(userId)."
  3. "Core Specification includes Identity Ownership Rule and Data
      Ownership Rule."

None of these are present in the actual implementation or spec file.
Step 1 cannot be completed because the Auth v1.1 interface that
Organizations is supposed to validate against does not exist.

------------------------------------------------------------------------
Specification says (directive)
------------------------------------------------------------------------

  > CURRENT STATUS
  > * Auth Module v1.1 is APPROVED and FROZEN.
  > * Auth public interface now includes getUser(userId).
  > * Core Specification includes Identity Ownership Rule and Data
  >   Ownership Rule.
  > * Organizations is the next module in the build order.
  >
  > ### Step 1 — Validation
  > Before writing any Organizations code, validate the specification
  > against the actual Auth implementation.
  > Specifically verify:
  > * Auth.verifySession(accessToken)
  > * Auth.getUser(userId)
  > ...

------------------------------------------------------------------------
Reality (actual codebase + spec file on disk)
------------------------------------------------------------------------

CHECK 1 — Does Auth v1.1 exist?

  src/modules/auth/index.ts, lines 466-475:
    export const Auth = {
      registerUser,
      loginUser,
      logoutUser,
      refreshSession,
      verifySession,
      resetPassword,
      changePassword,
      verifyEmail,
    };

  Auth public surface exports EXACTLY 8 functions. There is no version
  marker, no v1.1 annotation, no getUser. README.md still describes the
  module as "Auth Module v1.0". The spec file §10 is still titled
  "Auth Module Specification v1.0".

  RESULT: ✗ MISMATCH — Auth is v1.0, not v1.1.

CHECK 2 — Does Auth.getUser(userId) exist?

  Grep of src/modules/auth/index.ts for "getUser|verifyUser":
    (no matches for a standalone getUser or verifyUser export)
    (only matches are adapter.getUserByAccessToken — internal adapter
    method used by verifySession, not a public Auth function)

  RESULT: ✗ MISMATCH — getUser(userId) is not present in the Auth
  public interface. Cannot validate its signature, response format,
  or error codes.

CHECK 3 — Do Identity Ownership Rule and Data Ownership Rule exist in
the Core Specification?

  Grep of upload/codlok-cloud-master-spec.md for
  "Identity Ownership|Data Ownership":
    (no matches)

  §3 Core Specification contains only the original seven rules:
  §3.1 (Module), §3.2 (Workspace), §3.3 (Module Communication),
  §3.4 (Secrets), §3.5 (Database Isolation), §3.6 (Standard API
  Response), §3.7 (Workspace Provisioning). No Identity Ownership
  Rule. No Data Ownership Rule.

  RESULT: ✗ MISMATCH — neither rule exists in the on-disk Core Spec.

CHECK 4 — Does §12's dependency line reference getUser (the directive's
claimed new name) or verifyUser (the original draft name)?

  upload/codlok-cloud-master-spec.md line 366:
    "**Depends on:** `Auth.verifySession()`, `Auth.verifyUser()`
    (public interface only)."

  §12 still references Auth.verifyUser() — the original draft name
  from the previous Blocker Report, NOT getUser(userId) as the
  directive's status section implies. So even the spec file itself
  has not been updated to reflect the directive's claimed v1.1 state.

  RESULT: ✗ MISMATCH — §12 still names verifyUser(), not getUser().

------------------------------------------------------------------------
Validation summary against the directive's Step 1 checklist
------------------------------------------------------------------------

  * Auth.verifySession(accessToken):  ✓ EXISTS (frozen v1.0)
      - Signature: (accessToken, ctx?) → StandardResponse<{userId, valid}>
      - Error codes: INVALID_SESSION, SESSION_EXPIRED
      - Response format: StandardResponse per §3.6
      - VALIDATED — no issue with this function.

  * Auth.getUser(userId):             ✗ DOES NOT EXIST
      - Not in Auth public surface (only 8 functions exported).
      - Cannot validate signature, response format, or error codes.
      - BLOCKER.

  * Response formats:                 ✓ Match where they exist
      - Auth uses StandardResponse (§3.6) consistently.
      - Shared module provides ok()/fail()/ModuleError helpers.
      - No blocker for the functions that DO exist.

  * Error codes:                      ✓ Match (Codlok-standard)
      - Auth uses UPPER_SNAKE_CASE codes.
      - No conflict with Organizations' future code namespace.

  * Public contracts:                 ✗ INCOMPLETE
      - Auth v1.0 public contract is intact.
      - Auth v1.1 public contract (which the directive requires for
        getUser) does not exist.
      - The directive's mandatory rule "Identity Ownership Rule
        enforced — Organizations must retrieve identity through
        Auth.getUser(), not persist identity as authoritative data"
        cannot be enforced because Auth.getUser() does not exist.

------------------------------------------------------------------------
Why this cannot be worked around
------------------------------------------------------------------------

The directive's Step 3 explicitly mandates:

  > Identity Ownership Rule enforced — Organizations must retrieve
  > identity through Auth.getUser(), not persist identity as
  > authoritative data.

Without Auth.getUser() in the actual codebase, Organizations cannot:
  - Resolve a stored userId to an identity (email) for member lists,
    audit logs, or invitation flows.
  - Comply with the Identity Ownership Rule (which forbids
    Organizations from persisting identity as authoritative data).
  - Be validated against the directive's stated precondition.

Building Organizations now would require either:
  (a) Violating the directive by persisting identity snapshots in
      Organizations (rejected by the Identity Ownership Rule the
      directive itself introduces), OR
  (b) Calling a function (Auth.getUser) that does not exist, which
      would fail at runtime and at compile time.

Both are forbidden. The directive's own instructions say:
  > If any specification conflict is discovered, STOP and return a
  > Blocker Report.
  > Do not invent new modules.
  > Do not modify Auth public contracts except through an approved
  > blocker process.

------------------------------------------------------------------------
Recommendation (smallest possible change)
------------------------------------------------------------------------

The previous Blocker Report (ORGANIZATIONS_BLOCKER_REPORT.md, Task 2)
proposed Option A: add verifyUser(userId) to Auth v1.1. The directive
adopted Option A but renamed the function to getUser(userId) and added
two Core Spec rules. The implementation work to make the directive's
stated preconditions true has not been performed.

Smallest required change — execute the Auth v1.1 update that the
directive describes, BEFORE building Organizations:

  STEP A — Update Master Specification (upload/codlok-cloud-master-spec.md):
    A1. Add to §3 Core Specification:
        - §3.8 Identity Ownership Rule: "Auth is the sole
          authoritative source of user identity (userId, email,
          emailVerified). Other modules MUST retrieve identity
          through Auth.getUser(userId) and MUST NOT persist identity
          attributes as authoritative data. Cached/displayed
          identity is permitted for read-only display but must be
          re-resolvable through Auth on demand."
        - §3.9 Data Ownership Rule: "Each module owns the data
          tables it creates. No module may read or write another
          module's tables directly; cross-module data access is
          always through the owning module's public interface."
    A2. Update §10 title to "Auth Module Specification v1.1" and add:
        getUser(userId, ctx?)
          - Success data: { userId, email, emailVerified }
          - Errors: USER_NOT_FOUND
        Add USER_NOT_FOUND to §10's error code list.
    A3. Update §12 line 366 from:
          "Depends on: Auth.verifySession(), Auth.verifyUser()"
        to:
          "Depends on: Auth.verifySession(), Auth.getUser()"
    A4. Mark §12 status line from "DRAFT, not frozen" to
        "VALIDATED against Auth v1.1 — ready for build".

  STEP B — Implement Auth v1.1 (src/modules/auth/):
    B1. Add USER_NOT_FOUND to src/modules/auth/errors.ts.
    B2. Add getUserByUserId(userId) to the AuthProviderAdapter
        interface in src/modules/auth/adapters/types.ts.
    B3. Implement getUserByUserId in SupabaseAuthAdapter
        (admin.getUserById).
    B4. Implement getUserByUserId in MockAuthAdapter
        (lookup in usersById map; throw USER_NOT_FOUND if absent).
    B5. Add getUser(userId, ctx?) public function to
        src/modules/auth/index.ts with two-stage error translation.
    B6. Export getUser in the Auth public surface.
    B7. Add tests for getUser (success + USER_NOT_FOUND).
    B8. Re-run all Auth tests to confirm no regression.
    B9. Re-freeze Auth as v1.1.

  STEP C — Re-run Organizations Step 1 validation:
    C1. With Auth v1.1 in place, verify Auth.getUser(userId) exists
        with the expected signature and StandardResponse shape.
    C2. Verify §12's dependency line matches.
    C3. Mark Organizations Spec VALIDATED.
    C4. Proceed to Step 2 (Build Organizations).

NO ALTERNATIVE OPTION IS PROPOSED. The directive has already chosen
Option A from the previous Blocker Report (renamed to getUser). The
only remaining question is execution: the Auth v1.1 update must be
performed before Organizations can be validated and built. The
directive's wording implies this update has already happened, but
the codebase shows it has not.

------------------------------------------------------------------------
Decision required
------------------------------------------------------------------------

  Confirm one of the following:

  (i)  "Proceed with STEP A + STEP B above (implement Auth v1.1 with
        getUser, add Identity/Data Ownership Rules to Core Spec),
        then re-run Organizations validation, then build
        Organizations." — This treats the directive's "CURRENT STATUS"
        as the desired end state and authorizes me to perform the
        Auth v1.1 update as part of this task.

  (ii) "Auth v1.1 was supposed to be applied externally and was not.
        Stop and wait; I will apply Auth v1.1 separately and re-issue
        the Organizations directive afterwards." — This treats the
        mismatch as an environmental error to be fixed out-of-band.

  (iii) Some other direction you specify.

No Organizations code has been written. No Auth code has been modified.
No spec file has been modified. STOPPED per directive.

------------------------------------------------------------------------
Status
------------------------------------------------------------------------

Organizations Spec: NOT VALIDATED (Auth v1.1 precondition not met)
Organizations Build: NOT STARTED (blocked)
Auth Module: UNCHANGED (still v1.0 on disk; directive's claimed v1.1
             not present)
Master Spec: UNCHANGED (still references verifyUser; no Identity/Data
             Ownership Rules in §3)
Ready For Review: NO — waiting on direction decision (i), (ii), or (iii)
