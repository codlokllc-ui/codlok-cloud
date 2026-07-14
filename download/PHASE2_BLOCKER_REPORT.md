=============================
BLOCKER REPORT
=============================

Module: Codlok Cloud Dashboard — Phase 2 (Module Wiring)
Stage:  STEP 1 — Validate frozen module interfaces against dashboard requirements
Result: THREE MISSING PUBLIC FUNCTIONS + PAGINATION GAP — STOPPED per directive

------------------------------------------------------------------------
Problem
------------------------------------------------------------------------

Three frozen modules lack public list functions that the dashboard
requires to display their records. A fourth issue (pagination) affects
all existing list functions. The directive explicitly says: "If any
required dashboard screen cannot be completed using existing frozen
public APIs, stop immediately and submit a Blocker Report."

------------------------------------------------------------------------
Missing Function 1 — Storage.listFiles()
------------------------------------------------------------------------

Affected module: Storage (v1.0, FROZEN per §18)

Specification says (§18 line 744): Storage owns "file lifecycle (upload,
download, delete), object metadata, checksums, upload state." The spec
lists 7 public functions: createUpload, completeUpload, getDownloadUrl,
getFile, deleteFile, fileExists, getProviderStatus.

Reality: Storage has `getFile(workspaceId, fileId)` — a single-record
fetch by ID. There is NO `listFiles(workspaceId, filters?)` function.
The dashboard's Storage module detail page needs to display a list of
files. Without a list function, the dashboard cannot show any files
unless it already knows their fileIds — which it doesn't.

Why it cannot be wired: The dashboard has no way to discover fileIds
without a list function. `getFile()` requires a known fileId.
`fileExists()` also requires a known fileId. Neither can enumerate.

Recommended additive change (does NOT modify existing interfaces):
  Add to Storage v1.1 (additive, same pattern as Mail v1.2 sendEmail):
    listFiles(workspaceId, filters?, pagination?)
      → Success data: { files: [{ fileId, mimeType, sizeBytes, state, createdAt }], pagination }
      → Errors: WORKSPACE_NOT_FOUND
  No existing function changes. No existing test changes.

------------------------------------------------------------------------
Missing Function 2 — Pay.listPayments()
------------------------------------------------------------------------

Affected module: Pay (v1.0, FROZEN per §19)

Specification says (§19): Pay has 5 public functions: createPayment,
getPayment, refundPayment, listRefunds, getProviderStatus.

Reality: Pay has `getPayment(workspaceId, paymentId)` — a single-record
fetch. `listRefunds(workspaceId, paymentId)` lists refunds FOR A SPECIFIC
PAYMENT, not payments across a workspace. There is NO
`listPayments(workspaceId, filters?)` function. The dashboard's Pay
module detail page needs to display a list of payments.

Why it cannot be wired: The dashboard has no way to discover paymentIds
without a list function. `getPayment()` requires a known paymentId.

Recommended additive change (does NOT modify existing interfaces):
  Add to Pay v1.1 (additive):
    listPayments(workspaceId, filters?, pagination?)
      → Success data: { payments: [{ paymentId, status, amountMinorUnits, currency, createdAt }], pagination }
      → Errors: WORKSPACE_NOT_FOUND
  No existing function changes.

------------------------------------------------------------------------
Missing Function 3 — Mail.listMessages()
------------------------------------------------------------------------

Affected module: Mail (v1.2, FROZEN per §17)

Specification says (§17): Mail has 5 public functions: sendVerificationEmail,
sendPasswordResetEmail, sendInvitationEmail, sendEmail, getDeliveryStatus.

Reality: Mail has `getDeliveryStatus(workspaceId, messageId)` — a
single-record fetch. There is NO `listMessages(workspaceId, filters?)`
function. The directive explicitly says: "If Mail lacks a public list
function, STOP. Submit Blocker Report. Do not access internal outbox."

Why it cannot be wired: The dashboard has no way to discover messageIds
without a list function. The internal outbox (_getOutboxForTesting) is
a test-only export and must not be used per the directive and per the
Phase 1 evidence pass.

Recommended additive change (does NOT modify existing interfaces):
  Add to Mail v1.3 (additive):
    listMessages(workspaceId, filters?, pagination?)
      → Success data: { messages: [{ messageId, type, status, to, createdAt }], pagination }
      → Errors: WORKSPACE_NOT_FOUND

  NOTE on `to` field: Mail's MessageRecord stores the recipient address.
  The list function would return it as-is (Mail already knows it — it's
  not a business entity, it's a transport address, same as Auth knows
  email). If the reviewer prefers `to` omitted from list responses (like
  SMS omits recipient), that's also acceptable — the dashboard doesn't
  need it for display.

  No existing function changes.

------------------------------------------------------------------------
Issue 4 — Pagination gap across all existing list functions
------------------------------------------------------------------------

The directive (Step 5) requires a consistent pagination model:
  { limit, cursor, nextCursor, hasMore }

Current list functions return full lists with no pagination:
  - Verify.listVerifications → { verifications: [...] } (no pagination)
  - SMS.listSms → { items: [...] } (no pagination)
  - Notifications.listNotifications → { notifications: [...] } (no pagination)
  - Organizations.listWorkspaces → Workspace[] (no pagination)
  - Organizations.listMembers → Member[] (no pagination)
  - Organizations.listRoles → Role[] (no pagination)

The directive says: "If a module lacks pagination support, STOP. Submit
Blocker Report. Do not invent client-side pagination."

Recommended additive change: Add optional pagination parameters to
ALL existing list functions (additive — existing callers that don't
pass pagination params get the full list, same as today):
  listX(workspaceId, filters?, pagination?: { limit?: number, cursor?: string })
    → Success data: { items: [...], pagination: { nextCursor?: string, hasMore: boolean } }

  This is additive: callers that omit `pagination` get all records
  (backward-compatible). Callers that pass `{ limit: 20 }` get the first
  20 + a `nextCursor` for the next page.

  Affected modules: Verify, SMS, Notifications, Organizations (4 list
  functions), plus the 3 new list functions (Storage, Pay, Mail).

------------------------------------------------------------------------
Summary of required additive changes
------------------------------------------------------------------------

  Module        Change                    Type
  ------------  ------------------------  ----------
  Storage v1.1  Add listFiles()           New function
  Pay v1.1      Add listPayments()        New function
  Mail v1.3     Add listMessages()        New function
  Verify v1.1   Add pagination to listVerifications()  Additive param
  SMS v1.1      Add pagination to listSms()             Additive param
  Notifications v1.1  Add pagination to listNotifications()  Additive param
  Organizations v1.1  Add pagination to listWorkspaces/listMembers/listRoles  Additive param

  No existing function signature changes (pagination is optional).
  No existing tests change (callers that omit pagination get full list).
  No existing response shape changes (pagination is an ADDITIONAL field,
  not a replacement).

------------------------------------------------------------------------
Decision required
------------------------------------------------------------------------

  (i) Approve all additive changes, then proceed with Phase 2.
  (ii) Approve only the 3 new list functions (Storage/Pay/Mail), defer
       pagination to Phase 4 (which the directive already lists as
       "Pagination Standard"). The dashboard would display full lists
       for now (acceptable for dev/mock mode with small data volumes).
  (iii) Other direction you specify.

No Phase 2 code has been written. No frozen module modified.
STOPPED per directive.

------------------------------------------------------------------------
Status
------------------------------------------------------------------------

Phase 2: NOT STARTED — 3 missing public functions + pagination gap.
         Blocker Report submitted.
Ready For Review: NO — waiting on direction decision.
