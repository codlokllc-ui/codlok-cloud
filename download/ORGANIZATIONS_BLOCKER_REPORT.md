=============================
BLOCKER REPORT
=============================

Module: Organizations v1.0 (Phase 1, second module per §13)
Stage: Step 1 — Validation (Organizations spec §12 vs. actual Auth implementation)
Result: SPECIFICATION CONFLICT FOUND — STOPPED per directive

------------------------------------------------------------------------
Problem
------------------------------------------------------------------------

The Organizations Module Specification (§12) declares a dependency on
`Auth.verifyUser()`, but that function does not exist in the Auth
module's public interface — neither in the Auth Module Specification
(§10) nor in the actual Auth implementation that was built, approved,
and frozen in the previous step.

------------------------------------------------------------------------
Specification says
------------------------------------------------------------------------

§12 Organizations Module Specification v1.0 (Draft — pending Auth
implementation), line "Depends on":

  > **Depends on:** `Auth.verifySession()`, `Auth.verifyUser()`
  > (public interface only). Auth must never depend on Organizations.

§9 Organizations (boundary-level), line "Depends on":

  > **Depends on:** Auth (to resolve `userId` → identity).

So §12 explicitly names `Auth.verifyUser()` as a required public
dependency, and §9 establishes the underlying need: Organizations must
be able to resolve a `userId` into an identity record. This is needed
for:

  - Confirming a userId is a real, valid Auth user before adding them
    as a workspace member (the `addMember()` and `acceptInvitation()`
    flows).
  - Retrieving identity attributes (e.g. email) for a userId when
    rendering member lists, audit logs, or invitation records — cases
    where Organizations holds a stored userId but has no access token
    for that user and therefore cannot call `verifySession()`.

------------------------------------------------------------------------
Reality
------------------------------------------------------------------------

The Auth module's public interface (frozen, approved in the previous
step) exports exactly these 8 functions, per §10 and the implementation
in `src/modules/auth/index.ts`:

  1. registerUser(email, password, ctx?)
  2. loginUser(email, password, ctx?)
  3. logoutUser(accessToken, ctx?)
  4. refreshSession(refreshToken, ctx?)
  5. verifySession(accessToken, ctx?)        → { userId, valid: true }
  6. resetPassword(email, ctx?)              → { sent: true }
  7. changePassword(userId, oldPassword, newPassword, ctx?)
  8. verifyEmail(token, ctx?)

There is NO `verifyUser()` function. There is no function that takes a
`userId` and returns identity information. `verifySession()` is the
closest, but it takes an `accessToken` (not a `userId`) and returns
only `{ userId, valid: true }` — it does not return email,
emailVerified, or any other identity attribute, and it cannot be used
to look up a user by userId.

Validation breakdown (per the directive's Step 1 validation points):

  1. Public Auth APIs used by Organizations:
       Auth.verifySession()  — EXISTS ✓
       Auth.verifyUser()     — DOES NOT EXIST ✗  BLOCKER

  2. Response formats:
       Auth uses StandardResponse (§3.6). Organizations will use the
       same. ✓ Match. No blocker.

  3. Error codes:
       Auth uses Codlok-standard codes (EMAIL_ALREADY_EXISTS,
       INVALID_CREDENTIALS, etc.). Organizations will define its own
       Codlok-standard codes in its own namespace (e.g.
       WORKSPACE_NOT_FOUND, LAST_OWNER_CANNOT_LEAVE). No conflict.
       ✓ Match. No blocker.

  4. Session verification:
       Auth.verifySession(accessToken) returns { userId, valid: true }
       on success, or INVALID_SESSION / SESSION_EXPIRED on failure.
       Organizations can use this to verify the CALLING user's session
       and obtain their userId. ✓ Match. No blocker — for this
       specific use case.

  5. User identity retrieval:
       There is no Auth public function to resolve a userId → identity
       record. verifySession() cannot serve this role because (a) it
       takes an access token, not a userId, and (b) it returns only
       { userId, valid }, not identity attributes. ✗ BLOCKER — same
       root cause as point 1.

------------------------------------------------------------------------
Why this cannot be worked around
------------------------------------------------------------------------

`verifySession()` cannot substitute for `verifyUser()`:

  - Input mismatch: verifySession takes an access token; verifyUser
    would take a userId. Organizations holds stored userIds (in
    membership records, invitation records, audit logs) but does not
    hold access tokens for those users — access tokens belong to
    individual user sessions, not to workspace records.

  - Output mismatch: verifySession returns { userId, valid } only.
    Organizations needs identity attributes (at minimum: email) to
    render member lists, send invitation emails to existing users,
    and display audit-trail actors. None of this is available from
    verifySession.

Inventing a workaround (e.g. having Organizations store email
snapshots, or calling Supabase directly) would violate:
  - §3.3 (module communication through public interfaces only)
  - §9 Organizations "Does not own: authentication, credentials,
    sessions"
  - The directive's explicit instruction: "Do not invent a solution."

------------------------------------------------------------------------
Recommendation
------------------------------------------------------------------------

Two options. Both require a spec change and explicit approval before
Organizations can be built. No code has been written for Organizations.

  Option A — Add `verifyUser(userId)` to the Auth module (smallest
  change to Auth, largest change to §10):

    1. Amend §10 (Auth Module Specification) to add a new public
       function:
         verifyUser(userId, ctx?)
           Success data: { userId, email, emailVerified }
           Errors: USER_NOT_FOUND
       (Exact success shape subject to your approval — this is the
       minimum Organizations needs; you may want to add more fields.)
    2. Implement verifyUser() in the Auth module:
       - Add to AuthProviderAdapter interface (internal).
       - Implement in SupabaseAuthAdapter (admin.getUserById).
       - Implement in MockAuthAdapter (lookup in usersById map).
       - Add USER_NOT_FOUND to AuthErrorCode.
       - Export from Auth public surface.
    3. Re-freeze Auth as v1.1.
    4. Update §12 to reference the now-real Auth.verifyUser() with
       the agreed signature.
    5. Mark §12 Validated and proceed to Step 2 (Build Organizations).

    Trade-off: Auth is currently frozen. Option A unfreezes it for a
    minimal, additive change (one new function, no changes to existing
    functions or signatures). This is the cleanest fix because §9
    already establishes that Organizations needs userId → identity
    resolution, so Auth owning that capability is correct per the
    platform's separation of concerns.

  Option B — Remove the `verifyUser()` dependency from §12 (smallest
  change to §12, restricts Organizations):

    1. Amend §12 to remove `Auth.verifyUser()` from the "Depends on"
       line. Organizations depends on `Auth.verifySession()` only.
    2. Accept the consequence: Organizations cannot resolve a userId
       → identity on its own. This means:
       - Organizations must store an email snapshot at
         membership-creation time (when the user accepts an
         invitation, their email is captured from the session and
         stored in the Workspace Members table).
       - Member lists, audit logs, and invitation records display
         the stored snapshot, which may go stale if the user changes
         their email in Auth (Auth has no change-email function in
         v1, so this is currently moot, but it is a latent risk).
       - Organizations cannot verify that a stored userId is still a
         valid Auth user (e.g. if Auth adds account deletion in the
         future, Organizations would have orphaned member records).
    3. Update §9 Organizations "Depends on" line to remove "resolve
       userId → identity" (this is a Core-adjacent boundary change
       and may require treating §9 as revisable — confirm with
       reviewer).
    4. Mark §12 Validated (with the amended dependency) and proceed
       to Step 2 (Build Organizations).

    Trade-off: Option B avoids touching frozen Auth, but it pushes an
    identity-cache responsibility into Organizations that §9 says
    belongs to Auth. This creates a latent staleness risk and a
    boundary ambiguity that will resurface when Auth adds account
    deletion or email change in a future phase.

------------------------------------------------------------------------
Decision required
------------------------------------------------------------------------

  - Approve Option A (add verifyUser to Auth v1.1), OR
  - Approve Option B (remove verifyUser dependency from §12), OR
  - Specify an alternative you prefer.

No Organizations code has been written. No Auth code has been modified.
Waiting for approval.

------------------------------------------------------------------------
Status
------------------------------------------------------------------------

Organizations Spec: NOT VALIDATED (conflict with frozen Auth interface)
Organizations Build: NOT STARTED (blocked)
Auth Module: UNCHANGED (frozen v1.0, no modifications made)
Ready For Review: NO — waiting on direction decision
