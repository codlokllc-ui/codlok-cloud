=============================
BLOCKER REPORT
=============================

Module: Notifications v1.0 (Phase 2, per §13)
Stage:  STEP 1 — Validation (§21 public interface vs. frozen Mail interface)
Result: SPEC CONFLICT FOUND — STOPPED per directive

------------------------------------------------------------------------
Problem
------------------------------------------------------------------------

§21 (frozen) says Notifications dispatches emails by calling Mail's
public interface. But Mail's frozen public interface (§17) has NO
function that accepts the content shape §21 requires.

§21's notificationRequest includes:
  content: { email?: {subject, body}, sms?: {body}, push?: {title, body} }

Notifications needs to send an email with an arbitrary caller-supplied
{subject, body}. But Mail's frozen public interface (§17) exposes only:

  1. sendVerificationEmail(workspaceId, to, verificationToken, idempotencyKey?)
  2. sendPasswordResetEmail(workspaceId, to, resetToken, idempotencyKey?)
  3. sendInvitationEmail(workspaceId, to, invitationToken, inviterName,
                         workspaceName, idempotencyKey?)
  4. getDeliveryStatus(workspaceId, messageId)

All three send functions take a "token" parameter (which per §17 and
the Mail Build Report is actually a URL the caller already constructed).
Mail constructs the email body internally from hardcoded templates
(see src/modules/mail/internal/provider.ts — _subject() and _html()
methods switch on type: 'verification' | 'password_reset' | 'invitation').

NONE of these functions accept an arbitrary {subject, body}. There is
no generic "sendEmail(workspaceId, to, subject, body, idempotencyKey?)"
function in Mail's frozen interface. Adding one would be a change to
Mail's frozen public interface — which requires a Blocker Report per
the Breaking Change Policy.

------------------------------------------------------------------------
Specification says
------------------------------------------------------------------------

§21 line 1059 (Owns):
  "delivery orchestration (calling Mail/SMS/Push once each per selected
   channel)"

§21 line 1068 (Resolved Ownership Fork #4):
  "Notifications dispatches each selected channel exactly once;
   Mail/SMS/Push own their own retry (Mail's is already frozen, §17).
   Notifications never retries transport calls and never performs
   cross-channel fallback"

§21 line 1086 (Public Interface — sendNotification):
  "notificationRequest: { recipient: { email?, phone?, pushToken? },
   content: { email?: {subject, body}, sms?: {body}, push?: {title,
   body} }, metadata? }"

§21 line 1118 (Compliance Checklist):
  "Does not call Auth, Organizations, or any future Audit/Jobs module"
  (Note: this says Notifications doesn't call Auth/Organizations/Audit —
   it DOES call Mail/SMS/Push.)

§17 line 672-674 (Mail's frozen public interface):
  "sendVerificationEmail(workspaceId, to, verificationToken, idempotencyKey?)
   sendPasswordResetEmail(workspaceId, to, resetToken, idempotencyKey?)
   sendInvitationEmail(workspaceId, to, invitationToken, inviterName,
                       workspaceName, idempotencyKey?)"

§17 line 675: "verificationToken is the same URL string the provisional
  stub called verificationUrl — naming change only, no semantic change."

------------------------------------------------------------------------
Reality (actual Mail implementation)
------------------------------------------------------------------------

File: src/modules/mail/index.ts, lines 227-275

  export async function sendVerificationEmail(
    workspaceId, to, verificationToken, idempotencyKey?
  ) → _send(workspaceId, to, 'verification', verificationToken, ...)

  export async function sendPasswordResetEmail(
    workspaceId, to, resetToken, idempotencyKey?
  ) → _send(workspaceId, to, 'password_reset', resetToken, ...)

  export async function sendInvitationEmail(
    workspaceId, to, invitationToken, inviterName, workspaceName, idempotencyKey?
  ) → _send(workspaceId, to, 'invitation', invitationToken, ...)

  export async function getDeliveryStatus(workspaceId, messageId)

The internal _send() function (line 132) takes a `token` parameter and
passes it to the provider adapter's send() method. The provider adapter
(src/modules/mail/internal/provider.ts) constructs the email subject and
HTML body from the `type` field ('verification' | 'password_reset' |
'invitation') and the `token` — it has NO code path for accepting an
arbitrary {subject, body}.

There is no generic sendEmail() function. Adding one would require:
  - A new function on Mail's public surface (frozen → Blocker Report)
  - A new MessageType ('generic' or 'custom')
  - Provider adapter changes to accept subject+body instead of
    constructing from type+token

------------------------------------------------------------------------
Why this cannot be worked around
------------------------------------------------------------------------

1. Notifications CANNOT use sendVerificationEmail/sendPasswordResetEmail/
   sendInvitationEmail because:
   - Those functions construct the email body from hardcoded templates.
   - They take a "token" (URL), not a {subject, body}.
   - Using them would mean Notifications' emails are always verification/
     reset/invitation emails — which is wrong. Notifications needs to send
     arbitrary business emails (e.g. "Your inspection is scheduled for
     Tuesday", "Payment received: $50.00", etc.).

2. Notifications CANNOT bypass Mail and call the provider directly — §21
   line 1118 and §2 both prohibit this: "Products never talk directly to
   third-party providers. They always go through a Codlok module."

3. Notifications CANNOT construct a fake "token" that encodes the subject
   and body — that would be a hack violating the spirit of §17 (Mail
   owns email delivery, including body construction from templates) and
   §21's Content Ownership fork #3 (Notifications never transforms
   content, but it also shouldn't hack around Mail's interface).

4. SMS and Push modules don't exist yet — they're listed as "(future)" in
   the Platform Freeze Log. So even if the email channel conflict is
   resolved, Notifications can only dispatch emails for v1. The SMS and
   Push channels would return PROVIDER_NOT_CONFIGURED (or be excluded by
   the channel selection intersection) until those modules are built.

------------------------------------------------------------------------
Additional observation: Configuration catalog
------------------------------------------------------------------------

The directive asked to "Confirm Configuration's module catalog can accept
a notifications entry if needed (likely none — Notifications calls Mail,
not providers directly)."

Confirmed: Notifications does NOT need its own Configuration catalog
entry. Per §21, Notifications calls Mail/SMS/Push's public interfaces —
it never calls providers directly and never reads secrets from
Configuration. Mail already has its Configuration keys (RESEND_API_KEY).
SMS and Push will need their own keys when built, but that's their
responsibility, not Notifications'.

So the Configuration catalog is fine. The conflict is solely between
§21's content shape and §17's frozen Mail interface.

------------------------------------------------------------------------
Recommendation (smallest possible change)
------------------------------------------------------------------------

Two options. Both require a decision before I can proceed.

  OPTION A — Add a generic sendEmail() to Mail's frozen public interface.

    This is an additive change to Mail (Rule 11/12 additive-only — a new
    function, no existing function changed). Mail v1.1.

    A1. Add to §17's public interface:
        sendEmail(workspaceId, to, subject, body, idempotencyKey?)
        - Success data: { queued: true, messageId }
        - Errors: INVALID_RECIPIENT, PROVIDER_NOT_CONFIGURED

    A2. Implement in Mail: add a new MessageType 'generic' that accepts
        subject+body directly (no token, no template construction).
        The provider adapter's send() method would use the caller-supplied
        subject/body for type='generic' instead of constructing from
        type+token.

    A3. Notifications calls Mail.sendEmail(workspaceId, to, subject, body,
        idempotencyKey) for the email channel.

    Trade-off: Unfreezes Mail for one additive function. Mail v1.0 → v1.1.
    No existing Mail function changes. All 38 Mail tests pass unmodified.
    This is the same additive-only pattern used for Auth v1.0 → v1.1
    (adding getUser) and for Configuration's catalog extensions.

  OPTION B — Notifications holds email content opaquely and passes it
  through a new Mail function, same as Option A but framed differently.

    This is the same as Option A — there's no way around needing a new
    Mail function that accepts arbitrary content. The only question is
    the exact signature.

  OPTION C — Defer Notifications until SMS is built, then build a
  unified "transport dispatch" interface across Mail+SMS+Push.

    This would mean NOT building Notifications now. The directive says
    to build it, so this option requires explicit override.

    Trade-off: Delays Notifications indefinitely (SMS/Push aren't even
    specified yet). The directive explicitly says "Build Notifications
    per §21" — Option C contradicts that instruction.

------------------------------------------------------------------------
Decision required
------------------------------------------------------------------------

  (i)  Approve Option A — additively add sendEmail(workspaceId, to,
       subject, body, idempotencyKey?) to Mail's frozen public interface
       (Mail v1.0 → v1.1, additive-only, no existing function changed),
       then build Notifications per §21 calling Mail.sendEmail() for the
       email channel. SMS/Push channels return PROVIDER_NOT_CONFIGURED
       until those modules are built (handled naturally by the channel
       selection intersection).

  (ii) Other direction you specify.

No Notifications code has been written. No Mail code has been modified.
No spec file has been modified. STOPPED per directive.

------------------------------------------------------------------------
Status
------------------------------------------------------------------------

Notifications: NOT BUILT — §21 requires calling Mail with arbitrary
              {subject, body}, but Mail's frozen interface (§17) has no
              function that accepts this.
Mail: UNCHANGED (frozen v1.0, zero modifications — pending potential
      additive sendEmail() if Option A approved)
Configuration: UNCHANGED (no notifications catalog entry needed —
               Notifications calls Mail, not providers directly)
Spec: UNCHANGED (§21 and §17 both frozen; conflict is between them)
Ready For Review: NO — waiting on direction decision (i) or (ii)
