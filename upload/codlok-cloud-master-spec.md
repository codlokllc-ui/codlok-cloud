# Codlok Cloud — Master Specification

**Spec Version: 4.5** — Last updated: Repository Reconciliation Release. The canonical specification, source code, dashboard routes, and verified test suite now describe the same implementation. Dashboard Phases 1–3 are implemented against real module APIs; Provider Registry and workspace provider configuration are built; workspace provider selection uses Configuration settings rather than feature flags. Hybrid Data Proxy, routing behavior, dynamic provider schemas, real provider connection tests, API Keys, Logs, Monitoring, and Secret Templates remain unbuilt roadmap/backlog items.

**Status:** Canonical. This is the single source of truth handed to any AI coding agent building Codlok Cloud. Do not invent module boundaries, response shapes, or architecture beyond what is written here. If something is ambiguous, stop and ask rather than assume.

**Before starting any task, check the Spec Version number above against the version you were last told to expect. If it doesn't match, or if you were given no version to expect, treat this file as authoritative and re-verify every precondition a directive claims — do not trust a directive's description of what the spec contains; check this file directly.**

## Platform Freeze Log
Read this before touching any code. One row per module — its frozen status, what it depends on, what depends on it, and what's known-incomplete. No breaking changes to a Frozen public interface without going through the Blocker Report process (§15) — additive-only, per Rule 11/12.

| Module | Version | Status | Depends On | Used By | Tests | Known Backlog |
|---|---|---|---|---|---|---|
| Core Spec | — | 🟢 Frozen | — | Everything | — | — |
| Auth | v1.1 | 🟢 Frozen | Configuration, Mail (provisional) | Organizations | 36 | — |
| Organizations | v1.0 | 🟢 Frozen | Auth, Configuration, Mail (provisional) | — | 69 (105 incl. Auth regression) | — |
| Configuration | v1.2 | 🟢 Frozen, built | — | Auth, Organizations, Dashboard | 543 (full platform) | Real provider SDK validation not built; Secret Templates platform-owned backend undesigned; registry store remains internal and sealed after built-in registration |
| Mail | v1.3 | 🟢 Frozen, built | Configuration | Auth, Organizations, Notifications, Dashboard | 543 (full platform) | Cross-provider failover not in v1; subject deliberately excluded from listMessages |
| Storage | v1.1 | 🟢 Frozen, built | Configuration | (future: Verify, Documents), Dashboard | 543 (full platform) | No virus scanning, no multipart upload, GC is lazy not callable |
| Pay | v1.1 | 🟢 Frozen, built | Configuration | (future: Verify, Documents), Dashboard | 543 (full platform) | No multi-currency conversion, no provider failover, no reconciliation tooling |
| Verify | v1.0 | 🟢 Frozen | Configuration | (future: SREMA Verify, other products) | 52 (358 incl. full regression) | No multi-provider fallback (Stripe→Persona/Smile ID) — deliberate v1 scope cut |
| Notifications | v1.0 | 🟢 Frozen | Mail, SMS (future), Push (future) | (future: all products) | 41 (409 incl. full regression) | No cross-channel fallback in v1 — deliberate, business-policy decision |
| SMS | v1.0 | 🟢 Frozen | Configuration | Notifications | 48 (457 incl. full regression) | Audit retention is an Open Design Decision |
| Dashboard | v1.1 | 🟢 Built, real module wiring + provider configuration | Auth, Organizations, Configuration, Mail, Storage, Pay, Verify, Notifications, SMS | — | 543 full-platform tests; UI syntax build verified | Production hardening remains: HttpOnly sessions, real-provider validation, full Next/ESLint/TypeScript build when dependencies are installed; API Keys/Logs/Monitoring/Settings/Secret Templates remain Coming Soon |
| Evidence, AI, Search, Audit, Jobs/Queue, Analytics, Logs, API Gateway | — | ⚪ Not started | — | — | — | Boundary-level only, see §9 |

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
| 2.2 | Storage v1.0 implemented and frozen (244/244 tests passing). Step 1 validation found zero conflicts — first module to reach implementation clean, since nothing existed before Storage that assumed a different shape (unlike Auth's Configuration/Mail stubs or Mail's provisional interface). Compliance tests explicitly verify absence of business-reference fields and absence of `updateFile`/`overwriteFile`/`getLatestVersion` — proving the no-business-logic and immutability rules rather than just documenting them. `getDownloadUrl()` expiry fixed at 15 minutes and written into §18 itself (was previously unspecified — flagged during review as needing to be a spec-level constant, not an implementation detail that could vary). Backlog logged: garbage collection as a callable function (currently lazy cleanup + optional cron), multipart upload support, additional providers beyond S3/Mock. Platform now has five frozen modules (Auth, Organizations, Configuration, Mail, Storage) and 244 passing tests. |
| 2.3 | Pay (§19) fully specified and frozen across two debate passes. §3.12 Financial Ownership Rule added to Core Spec (now 12 rules) — payments owned exclusively by Pay; financial facts immutable, status transitions separately via a defined state machine. Key decisions: Payment Intent ownership is Option A (generic — Pay never accepts entityType/entityId, mirrors Storage's refusal to track "current version"); idempotencyKey made **required** (not optional like Mail's) on all state-changing functions, since a duplicate charge is a real financial loss unlike a duplicate email; amounts specified as integer minor units + ISO 4217 currency, never floating-point decimals; Payment Status State Machine formalized (pending→succeeded/failed, succeeded→refund_pending→refunded/partially_refunded, succeeded→disputed via webhook only); webhook events deduplicated by provider event ID (exactly-once processing); PCI Boundary Rule added (Pay never receives/stores raw card data, only provider-hosted checkout) — kept at module level rather than promoted to Core Spec, since it's a single-module hard boundary rather than a recurring cross-module ownership pattern. Second-pass additions: Pricing Rule (Pay executes the amount/currency it's given, never calculates or converts) and Refund Decision Rule (Pay executes refunds, never decides eligibility) — resolved a contradiction where the original ownership draft listed "Exchange Rate" as Pay-owned while the Pricing Rule says Pay never converts currency; resolved as record-only (Pay may log an exchange rate the provider reports, never compute one itself). Not yet built. |
| 2.4 | Pay v1.0 implemented and frozen (306/306 tests passing). Step 1 validation clean — only change needed was additively adding `STRIPE_WEBHOOK_SECRET` to Configuration's module catalog (Rule 11/12 additive-only, no breaking change). Webhook Deduplication Rule promoted from Build Report detail to binding spec text: a given provider event ID is processed at most once, ever — permanently, not just within a window. Idempotency key retention specified as **permanent** (no expiry), deliberately stronger than Mail's 24-hour window, since a duplicate charge at any point in the future is an unacceptable financial loss in a way a stale duplicate email is not. Backlog logged: payment method expansion beyond hosted checkout, provider failover (Stripe→Paystack), reconciliation tooling, explicit webhook event-type mapping documentation. Platform now has six frozen, fully built modules (Auth, Organizations, Configuration, Mail, Storage, Pay) and 306 passing tests. |
| 2.5 | Verify Module Specification drafted as §20 (DRAFT). Key decision: Codlok Verify orchestrates external identity-verification providers (Stripe Identity, Smile ID, Persona, Onfido, Veriff, Sumsub) rather than building an in-house KYC/biometric engine — applying the existing §7 Provider Model to identity verification, the same pattern Pay/Mail/Storage/Auth already follow, not a new architectural principle. Verification Data Minimization Rule added (module-level, not Core Spec, same placement reasoning as Pay's PCI Boundary Rule): Verify never stores raw documents, biometric templates, or full provider reports — only provider reference IDs, normalized status, and its own audit trail. Confirmed via explicit (a)/(b) decision: Verify's internal audit trail is self-contained (same pattern as Pay/Configuration/Mail/Storage), no dependency on a future cross-module Audit module — Audit will later consume Verify's records, not the reverse. No Build Order change needed. Naming disambiguation added: "Codlok Verify" (this module) vs. "SREMA Verify" (a downstream product) are explicitly different things. `idempotencyKey` required on session creation, same reasoning as Pay (real provider fees per session, not just an annoyance like Mail's duplicate sends). Status: DRAFT, pending stress-test pass before freeze. |
| 2.6 | Verify (§20) stress-tested and frozen. Live web research performed against real Stripe Identity and Persona documentation before freezing the state machine (not assumed): Stripe's `requires_input` status loops mid-flow for resubmission rather than only appearing at the start, and has no distinct "rejected" concept (failed sessions become `canceled`); Persona has two separate phases — a "Done" phase (completed/failed/expired) followed by a distinct decisioning phase (approved/declined/needs_review) — reaching "done" doesn't mean a decision was made. Neither provider's real lifecycle is one-directional, so rather than adding normalized states to chase every provider's quirks, added the **Adapter Absorption Rule**: the provider adapter absorbs internal looping/multi-phase complexity and only emits a Codlok status transition when something is actually actionable for the caller — `pending` covers all not-yet-finalized activity (including Stripe's resubmission loop), `in_review` is reserved for providers with an explicit manual-review hold (e.g. Persona's `needs_review`), and adapters are responsible for translating ambiguous provider outcomes (e.g. Stripe's `canceled`) into Codlok's clean terminal states. `verificationType` changed from an opaque caller-supplied string to a canonical Codlok enum (INDIVIDUAL_IDENTITY, BUSINESS_VERIFICATION, DOCUMENT_VERIFICATION, ADDRESS_VERIFICATION, AGE_VERIFICATION) — prevents provider-specific vocabulary (Stripe's "document" type, Persona's inquiry naming) from leaking into Codlok's public API. Verification Fact Immutability Rule added (mirrors Pay's Financial Facts Rule): verificationId/provider/providerVerificationId/verificationType/subjectReference/workspaceId never change after creation, only status transitions. Added `subjectReference` parameter to `createVerificationSession()` to support this. Webhook deduplication confirmed already correctly specified in the first draft — no change needed. Ready for agent validation and build. |
| 2.7 | Verify v1.0 implemented and frozen (358/358 tests passing). Step 1 validation clean — only change needed was additively adding a `verify` entry (STRIPE_IDENTITY_SECRET_KEY, STRIPE_IDENTITY_WEBHOOK_SECRET) to Configuration's module catalog. Adapter Absorption Rule specifically verified with 8 tests simulating real provider looping (requires_input resubmission stays pending, full lifecycle loop→verified→approved), not just static state checks. Data minimization proven by tests checking the *absence* of document/biometric/OCR fields and functions, same evidentiary standard as Storage/Pay. Confirmed Verify calls no other module — self-contained audit trail, correct dependency direction for a future Audit module to later consume Verify's records. Backlog logged: multi-provider fallback (Stripe→Persona/Smile ID), same treatment as Mail's cross-provider failover backlog item. Platform now has seven frozen, fully built modules (Auth, Organizations, Configuration, Mail, Storage, Pay, Verify) and 358 passing tests — infrastructure layer considered substantially complete. |
| 2.8 | Planning-only update, no frozen module changed. Post-Verify architecture review flagged that the infrastructure layer (7 modules) is substantially complete and proposed several future modules (SMS, Notifications, Search, Audit, Jobs/Queue, AI, Connect) plus an "AI-native platform"/MCP direction. Applied the same discipline used throughout: rejected Connect (no real dependency drives it, same speculative-design pattern rejected at project start) and the original 7-category AI module scope (text/image/voice/video/music/embeddings/moderation — same over-design pattern as the original Trust Platform/Developer Portal proposals); left Jobs/Queue explicitly open (real unresolved fork: does it replace Mail/Storage/Pay/Verify's existing internal queues, reopening 4 frozen modules, or serve only future business-layer work?); separated "AI accessibility is a goal" from "MCP is the mechanism" — added AI Client Principle to §1 as a directional design principle, explicitly not a Core Spec rule, since it isn't enforceable/testable like §3.1–3.12. MCP Gateway, if built, needs its own full ownership pass (auth, org/workspace resolution, tool discovery, permission enforcement, error propagation, long-running ops, streaming, multi-step transactions) — none of that is designed. Confirmed next-candidate recommendation unchanged: Notifications or SMS, both narrow/reusable/fork-free unlike Jobs or AI. |
| 2.9 | Planning-only update, no frozen module changed. AI Client Principle wording refined: encodes parity (AI can do what human apps can do), security (AI never bypasses Organizations/Auth/Permissions), architecture stability (modules don't change because an AI is calling them), and future-proofing (doesn't assume MCP specifically wins) — without pre-listing implementation-specific concerns (tool discovery, streaming, etc.), which correctly belong in a future MCP Gateway's own ownership pass rather than a vision-level principle. Confirmed: Notifications is the next module to receive an ownership pass — one module at a time, same discipline as the first seven. |
| 3.0 | Notifications ownership agreed and written into the spec as §21 — explicitly ownership-only, no public interface/function names, per instruction to keep this pass matching every prior module's first stage. Three ownership forks debated and resolved: (1) Contact Resolution — Option A, business modules supply contact info directly, Notifications never calls Auth to resolve identity, no new module dependency introduced; (2) Preference Scope — workspace-scoped, not user-global, consistent with every other module's isolation model; explicit accepted cost logged (same preference set separately per workspace, no cross-workspace sync); (3) Content Ownership — resolved as "3a": business modules supply fully composed, channel-specific content (separate email/SMS/push fields) rather than a generic message Notifications transforms, or a template key Notifications interpolates. Notifications' only permitted operations are transport-safety (encoding, line endings, required-field validation) and rejection of oversized payloads (MESSAGE_TOO_LARGE) — never silent truncation or content rewriting, mirroring Storage's checksum-mismatch rejection rather than auto-fixing. One item explicitly left open rather than assumed: whether "retry coordination" means Notifications gets its own new retry/fallback logic, or relies entirely on Mail's already-frozen internal retry (§17) — flagged as consequential for the still-unresolved Jobs/Queue fork, since a fifth module with its own retry logic raises the stakes of that future migration decision. |
| 3.1 | Retry coordination reframed from an "open item flagged during debate" into a formal, explicitly-labeled **Open Design Decision**, deliberately kept out of the ownership freeze: "who owns orchestration" (settled) is a different question from "what orchestration requires doing" (an implementation question, deferred to interface design, must stay compatible with the still-undecided Jobs/Queue architecture). §21 header updated to note this begins Phase 2 of the platform (shared platform services), following Phase 1 (the seven frozen generic-infrastructure modules) — a milestone in maturity, not in module count; nothing beyond Notifications' ownership has changed. |
| 3.2 | Notifications full interface drafted (§21) and stress-tested across two passes before freeze consideration. Retry Open Design Decision resolved: transport modules (Mail/SMS/Push) own retry entirely; Notifications dispatches each selected channel exactly once and never performs cross-channel fallback — that remains business policy, decided by the calling application. Channel-selection ownership gap from the first interface pass fixed: callers supply content per channel (not a channels list), Notifications computes the actual dispatch plan via content ∩ workspace-preferences ∩ configured-providers intersection. Status model resolved: per-channel `status`/`messageId` holds real delivery detail (Mail already owns email delivered/bounced lifecycle, not duplicated here); top-level `overallStatus` (queued/dispatching/completed/cancelled) deliberately carries no aggregate success/failure judgment — deciding whether partial delivery is acceptable is a business decision, same reasoning as why Notifications never truncates SMS content. idempotencyKey required, permanent retention (same reasoning as Pay/Verify — real per-channel provider cost). Second stress-test pass closed three remaining completeness gaps: cancelNotification only succeeds while overallStatus is queued (once any channel starts dispatching, the whole notification is no longer cancelable); listNotifications filters specified (overallStatus, dateFrom/dateTo, recipient); getChannelStatus response shape specified (was previously just a description with no data/error shape, unlike every other function). Status: DRAFT v2, ready for freeze. |
| 3.3 | Notifications (§21) frozen — ownership debate, two full interface stress-test passes, all completeness gaps closed (cancellation boundary, list filters, getChannelStatus shape), no remaining architectural issues found. Not yet built. Eight modules now specified — matches the maturity level Storage, Pay, and Verify each had immediately before their own build phase, per the established Draft → Stress-test → Freeze → Agent Validation → Build → Regression → Freeze lifecycle. |
| 3.4 | Mail v1.0 → v1.2: additively added `sendEmail(workspaceId, to, subject, body, idempotencyKey?)`. Discovered as a genuine Blocker Report during Notifications' Step 1 validation, not a planning gap — Mail's three frozen functions (sendVerificationEmail/sendPasswordResetEmail/sendInvitationEmail) all construct email bodies internally from type+token templates; none accept arbitrary caller-supplied content, which Notifications requires. Resolved as Option A (additive-only, same pattern as Auth v1.0→v1.1 adding getUser()): new MessageType.GENERIC added to the provider adapter alongside VERIFICATION/PASSWORD_RESET/INVITATION; no existing function's signature or behavior changed. Explicit boundary stated: sendEmail() validates format/required-fields/provider-payload-limits only — Mail never judges business correctness of arbitrary content, same posture Notifications already holds toward the content it passes through. Ready for Notifications' Step 1 validation to resume against the now-real Mail v1.2 interface. |
| 3.5 | Mail v1.2 implemented (48 tests, all 10 new sendEmail tests plus existing 38 unmodified) and Notifications v1.0 implemented (41 tests) — both frozen. Full platform regression: 409/409 tests passing across 8 modules. Notifications' compliance tests specifically proved negative claims rather than just happy-path behavior: no content-transformation functions exist, no entityType/entityId anywhere, module boundary verified by source inspection (does not import Auth/Organizations), recipient data confirmed transient (cleared after dispatch, not returned by getNotification). Eight infrastructure modules now fully built: Auth, Organizations, Configuration, Mail, Storage, Pay, Verify, Notifications. |
| 3.6 | SMS ownership frozen (§22, interface not yet drafted — same staged approach as Notifications). Live web research performed against real Twilio opt-out documentation before freezing the compliance rule (not assumed): providers enforce STOP/opt-out blocking at the provider level, for every message category, before Codlok's code runs (Twilio error 21610 — "cannot override from your own code or by retrying"). This changed the ownership conclusion: an earlier draft proposed SMS record opt-out events while a future business/compliance module decides bypass eligibility per category — but the provider already makes that decision by default, so deferring to a not-yet-built module would have meant zero enforcement today. Resolved instead as pure normalization: SMS surfaces the provider's rejection as a distinct `RECIPIENT_OPTED_OUT` error rather than a generic failure; SMS does not decide category-based exemptions, because that was never actually Codlok's decision to make — it happens at provider/account configuration, outside any Codlok module. Frozen alongside: generic transport API (same lesson as Mail's sendEmail()), provider-normalized statuses only, E.164-only validation, MESSAGE_TOO_LONG segment cap (reject, don't silently split), required+permanent idempotency, STOP/START/HELP inbound ownership. Audit retention/redaction policy left as an explicit Open Design Decision, same treatment as Notifications' retry-coordination question. |
| 3.7 | SMS full interface frozen (§22) after two stress-test passes. Five public functions (sendSms, getSms, listSms, getProviderStatus, processWebhook) — getDeliveryStatus() dropped as redundant with getSms(), matching the one-getX()-per-record pattern already used by Pay/Verify/Notifications. Fixed a real contradiction from Pass 1: SMS needs the recipient internally (to dispatch, match delivery receipts, resolve inbound STOP events) but must never expose it publicly or treat it as a system of record — reworded to make both true simultaneously, same distinction Notifications already established for its own recipient data. State machine corrected: `sent` is a resting state that may never receive a delivery receipt from some providers/routes — it is explicitly not equivalent to `delivered`/`failed`, which are guaranteed-final; a caller must not assume a `sent` record is immutable. `processWebhook()` resolves workspace context via `providerMessageId` lookup (outbound) or destination-number/provider-account matching (inbound) rather than requiring callers to supply `workspaceId` — same pattern as Pay's webhook handling. `SEND_FAILED` precisely defined as post-retry-exhaustion only, matching Mail. Ready for agent validation and build. |
| 3.8 | SMS v1.0 implemented and frozen (457/457 tests passing). Step 1 validation clean — Notifications' channel-selection logic (designed anticipating SMS but never previously validated against it) confirmed compatible without changes to its public interface; Configuration's existing `sms` catalog entry (TWILIO_ACCOUNT_SID/TWILIO_AUTH_TOKEN) confirmed compatible. Notifications rewired internally to call `SMS.sendSms()` instead of marking SMS as unconfigured/skipped — same additive-internal-wiring pattern as Mail's sendEmail rewire; no public interface change to Notifications. State-machine tests specifically proved `sent` can remain non-final forever (not just the delivered/failed happy paths), matching the spec's explicit resting-state semantics. Nine modules now frozen and fully built: Auth, Organizations, Configuration, Mail, Storage, Pay, Verify, Notifications, SMS. |
| 3.9 | Dashboard v1.0 architecture added as §23 — the first UI/UX design pass, following the same review discipline as backend modules. Products-first navigation adopted (not "workspace-first") after review correctly identified module-freeze-status as a poor home screen. Binding rule added: Codlok's own dashboard never displays business entities (university names, transcript filenames, admission fee labels) — only opaque infrastructure IDs, enforcing §3.10/§3.12 inside the UI itself, not just the backend. Caught and fixed twice during design: first pass showed resolved business names in Verify/Storage module pages (violated Verify's Data Minimization Rule); second pass proposed a shared "Platform > Providers" page for live cross-product credentials (violated §3.7/§16's no-global-secret rule) — corrected to Secret Templates (copy-on-apply into each workspace's own Configuration, never a live shared reference). "Organizations" renamed "Team" inside a product to prevent confusion with a product's own customer data. Split into Track A (frontend, mock data, approved to build now) and Track B (Secret Templates real backend wiring, blocked — requires an undesigned additive Configuration v1.3 extension for platform-owned secrets, which the current workspace-scoped-only interface has no shape for). OpenAPI/SDK/API Explorer marked "Coming Soon" — same discipline as not pre-specifying AI/Connect/MCP. |
| 4.0 | Dashboard v1.0 Track A implemented and browser-verified. 12 screens built (Login, Products, Product Dashboard shell, Overview, Modules grid, 9 module detail pages, Health, Team, AI Builder, Freeze Log, Secret Templates, Coming Soon). Mock data verified grounded in real frozen specs, not invented: Verify mock IDs match §20's VER-xxx/status/provider shape with no subjectReference resolution; SMS mock data has no recipient field per §22's public-interface rule; Pay mock data has no entityType/business label per §3.12. Team page explicitly cites §12 in its copy. Secret Templates page carries the required "copied, not live" note and a visible Track B blocked warning. All 457 backend tests confirmed unchanged (frontend-only change, correctly no backend regression). Dashboard status: UI complete, not yet wired to real module APIs. |
| 4.1 | Phase 2 (Module Wiring) produced a genuine Blocker Report: Storage, Pay, and Mail each lacked a public list function needed for their dashboard pages — Storage had getFile() but no listFiles(); Pay had getPayment()/listRefunds() but no listPayments(); Mail had getDeliveryStatus() but no listMessages(). Resolved additively, all three simultaneously, alongside a new Core Spec rule rather than three separate later fixes: **§3.13 Pagination Standard** — every list function (existing: listSms, listNotifications, listVerifications, listRefunds; new: listFiles, listPayments, listMessages; future: listJobs, listAuditEvents, etc.) shares one `{limit, cursor}` request and `{items, hasMore, nextCursor}` response contract. Storage v1.1 adds listFiles() (no filenames, per §3.10). Pay v1.1 adds listPayments() (no business labels, per §3.12). Mail v1.3 adds listMessages() — `subject` deliberately excluded from the response despite Mail storing it internally for sendEmail()-originated messages, since subject lines can carry business content and returning them would leak business meaning through a list function, the same violation the opaque-ID dashboard rule (§23) was built to prevent elsewhere. "Dashboard-complete" standing test added to §3.13: any module managing a resource collection needs both get...() and list...(), both following the pagination contract — this is the check that caught this exact gap and prevents it recurring. |
| 4.2 | Storage v1.1, Pay v1.1, Mail v1.3 implemented and built (487/487 tests passing). Retroactive optional pagination added to listVerifications/listSms/listNotifications too, extending §3.13 to all six list functions, not just the three new ones. Backward compatibility proven: all 468 prior tests passed unmodified with pagination omitted (defaults to full list, hasMore=false). §3.14 Dashboard Readiness Rule proposed but deliberately deferred — same discipline as every prior Core Spec rule: codify only after a pattern repeats across multiple real incidents, not after one. |
| 4.3 | Configuration v1.1 documented retroactively. listProviders(moduleId)/listAllProviders() added — a metadata-only Provider Registry (providerId, moduleId, displayName, category, routing reserved-not-implemented) backed by a static Object.freeze-enforced array, letting the dashboard discover provider names instead of hardcoding them. Built and reported (517/517 tests) before this spec file was updated — the first additive change in this project to skip the propose→approve→build→report order. Approved on review of real evidence, flagged explicitly so the gap doesn't recur silently. Self-registration/plugin architecture for the registry proposed and deliberately deferred as a non-blocking design note (public interface must stay stable if it ever happens) — not justified at 6 providers, same "don't design for scale that doesn't exist yet" reasoning applied throughout. |
| 4.4 | Architecture Roadmap added as §24 — explicitly not frozen, not a build directive, six future Provider Registry enhancements (sandbox model, configuration schema, capability metadata, credential lifecycle metadata, routing modes, Hybrid Data Proxy). Both requested corrections from stress-test incorporated: configuration schema explicitly barred from containing executable logic (same boundary as Configuration Service itself, §16); capability metadata explicitly requires hiding absent features rather than showing non-functional UI. **Provenance correction:** "Hybrid Data Proxy" was asserted as something "previously described" in this project — verified against every prior spec version (grep across the full file history) and found in none of them. Recorded as newly proposed, not recovered; the definition itself was kept since it's sound on its own merits, only the "already agreed" claim was corrected. This is the same evidence-over-assertion discipline that caught the Auth v1.1 spec-file mismatch earlier in this project, applied to a claim about prior agreement rather than a claim about code. |
| 4.5 | **Repository Reconciliation Release.** Reconciled the uploaded working tree against the canonical v4.4 design and implemented the missing approved work in one verified repository: additive list APIs and §3.13 pagination across six modules; registration-driven Provider Registry behind an internal sealed `RegistryStore`; real dashboard module wiring; workspace-authorized HTTP routes; explicit provider configuration for Stripe, Stripe Identity, Resend, Twilio, Amazon S3, and Supabase; secrets remain server-only and are exposed to the browser only as configured/not-configured; workspace active-provider selection is stored in new Configuration settings (`getSetting`/`setSetting`/`deleteSetting`), never feature flags or registry mutation; S3 Region is workspace configuration; dev Mail outbox is unavailable in production. Full Bun regression: 543/543 passing. UI source syntax bundle verified. Real provider SDK connection testing, routing/Hybrid Data Proxy, dynamic provider schemas, API Keys, Logs, Monitoring, Secret Templates, and production HttpOnly-cookie migration remain unbuilt. |

---

## 1. Vision

Codlok Cloud is an **internal platform** — not a product sold to external developers or startups. It exists to power Codlok LLC's own products (SREMA Platform, SREMA Academy, AcadID, and future products) without rebuilding common infrastructure for each one.

Guiding principle: **build once, reuse forever, design for separation, build together.**

Products never talk directly to third-party providers (Stripe, Resend, OpenAI, Supabase, etc.). They always go through a Codlok module, which owns the provider relationship.

**AI Client Principle (design principle, not an enforceable Core Spec rule — see note below):** Codlok shall expose officially supported interfaces that allow AI clients to perform the same operations available to human-operated applications, subject to the same authentication, authorization, organizational boundaries, and business rules. The choice of interface (REST, SDK, MCP, or future protocols) is an implementation decision and does not alter module ownership, module responsibilities, or platform security boundaries. This principle is intentionally kept out of §3 (Core Specification) because those rules are enforceable and checked against real code via compliance tests; this principle is directional, not something a Build Report can verify. It states that AI accessibility is a goal — it does not decide the mechanism (e.g. MCP), which remains an undesigned, unfrozen question requiring its own full ownership pass like every module in §9.

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

## 3. Core Specification (the thirteen platform rules)

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

### 3.12 Financial Ownership Rule
Every monetary transaction has exactly one owner: the Pay module. Other modules may request payments through Pay's public interface, but may never create, modify, or delete payment records directly, and never touch a provider (Stripe, Paystack, etc.) themselves. Pay stores only financial facts (amount, currency, provider transaction ID, status) — never business entities such as Verification, Inspection, Document, Subscription, or Order. The relationship between a payment and a business entity (e.g. "this payment unlocked that Verification") is owned entirely by the requesting module, the same pattern as `fileId` under §3.10. Financial *facts* are immutable once a payment succeeds (amount/currency/payer/provider never change); financial *status* legitimately transitions afterward (e.g. `succeeded → refunded`, `succeeded → disputed`), driven by provider webhooks — see §19 for the full status state machine.

### 3.13 Pagination Standard
Every public list function — existing and future — supports the same pagination contract, so no module invents its own style and no caller (including the Dashboard) has to handle six different shapes.

**Request parameter:**
```ts
pagination?: { limit?: number; cursor?: string }
```

**Response shape:**
```ts
{ items: [...], hasMore: boolean, nextCursor: string | null }
```

Applies retroactively (additively — no existing behavior changes, `pagination` is optional) to every list function already frozen (`listSms`, `listNotifications`, `listVerifications`, `listRefunds`) and to every list function added from this point forward (`listFiles`, `listPayments`, `listMessages`, and any future `listJobs`, `listAuditEvents`, `listSearchResults`, etc.). A module is not considered **dashboard-complete** unless, for any resource it manages as a collection, it exposes both a `get...()` for a single resource and a `list...()` for operational browsing, both following this same pagination contract — this is the standing test that caught Storage/Pay/Mail's missing list functions during Phase 2 validation and prevents the same gap recurring as new modules are added.

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
- **Owns:** the UI/functionality for creating workspaces (products), connecting providers, managing users/roles, viewing logs/analytics/health. IA decided — see §23 (Codlok Cloud Dashboard v1.0) for the full navigation structure, opaque-ID display rule, and build tracks. Track A (frontend, mock data) ready to build; Track B (Secret Templates backend) blocked on an additive Configuration extension, not yet designed.

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

## 16. Configuration Service Module Specification v1.2 — STATUS: FROZEN (v1.0 secrets/flags; v1.1 Provider Registry; v1.2 workspace settings; 543/543 full regression)

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

### v1.1 Addition — Provider Registry (listProviders / listAllProviders)
**Why this exists:** The dashboard needed to display provider names (e.g. "Stripe" for Pay, "Twilio" for SMS) without hardcoding them into frontend code — hardcoded names meant every new provider required a dashboard code change, not just a Configuration entry.

**`listProviders(moduleId)`**
- Success `data`: `{ providers: [{ providerId, moduleId, displayName, category, defaultProvider, supportsTestConnection, supportsRotation, supportsDisconnect, routing }] }`
- Errors: none (unknown or empty `moduleId` returns an empty list, not an error)

**`listAllProviders()`**
- Success `data`: same shape as above, unfiltered by module.

**Metadata only — binding, same boundary as everything else in Configuration.** `ProviderMetadata` never contains credentials, secrets, SDK configuration, or connection logic — only display/discovery metadata. Built-in providers register through an internal `RegistryStore` abstraction during Configuration initialization; each entry is frozen and the store is sealed after initialization. `listProviders()`/`listAllProviders()` never depend on a switch statement or hardcoded module→provider mapping. The registration function and store are internal and are not public runtime extension APIs.

**`routing` field:** reserved (currently always `"DIRECT"`), not exposed in the dashboard, not implemented. Future values (`PROXY`, `FAILOVER`, `MIRROR`, `LOCAL`, `EDGE`) are anticipated but deliberately not built — this field exists so a future routing capability doesn't require a breaking schema change, not because routing is being designed now.

**Registry implementation boundary:** the internal `RegistryStore`/sealed built-in-registration mechanism is implemented. Runtime plugin loading, marketplace discovery, and public self-registration remain deliberately unbuilt. Any future store implementation must preserve `listProviders()`/`listAllProviders()` exactly so dashboard consumers remain unaffected.

### v1.2 Addition — Workspace Settings

**`getSetting(workspaceId, key)`** / **`setSetting(workspaceId, key, value, updatedBy)`** / **`deleteSetting(workspaceId, key)`**
- Persistent, workspace-scoped non-secret configuration values.
- Success data includes `{ key, value, version, updatedBy, updatedAt }` where applicable.
- Used for workspace choices such as `default_provider:<moduleId>`.
- Settings are not Feature Flags and never mutate Provider Registry metadata.
- Dashboard HTTP write/delete routes require Owner-level authorization before calling Configuration.
- Errors: `SETTING_NOT_FOUND`, `WORKSPACE_NOT_FOUND`, `INVALID_KEY`.

**Binding separation:** Feature Flags are runtime behavior toggles. Workspace provider selection is persistent Configuration setting data, not a Feature Flag.

**`getFeatureFlag(workspaceId, key)`** / **`setFeatureFlag(workspaceId, key, value)`**
- Feature flags are workspace configuration data, not business logic or permissions — kept in Configuration for that reason, called out explicitly here to prevent future scope creep into anything more than key-value flags.
- Success `data`: `{ key, value }`
- Errors: `FEATURE_FLAG_NOT_FOUND`, `WORKSPACE_NOT_FOUND`

**Explicitly excluded from this interface:** `testConnection()` and any function that returns a constructed provider client. Both were proposed during debate and rejected — see "Out of scope" above.

### Workspace Context
Every secret, setting, feature-flag, and provider-status function requires `workspaceId` — configuration is always per-workspace (§3.7: no global fallback credentials, no defaults shared across workspaces). There is no global/default secret; a missing key for a given workspace is `SECRET_NOT_CONFIGURED`, not silently inherited from elsewhere.

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
## 17. Mail Module Specification v1.3 — STATUS: FROZEN (v1.2 implemented/tested; v1.3 additively adds listMessages() — see below; ready for agent validation and build)

**Purpose:** Answers "how does an email actually get sent, reliably, regardless of which provider is behind it?" Retires the Rule 11 provisional stub that Auth (`registerUser`, `resetPassword`) and Organizations (`inviteMember`) are already calling in real, frozen code paths.

**Out of scope:** Marketing/campaign email (explicitly out of scope per the original §9 boundary description — transactional only for v1). Deciding *when* to send an email or *what* it should say beyond a template — callers (Auth, Organizations) decide that; Mail only delivers it reliably. **Business correctness of arbitrary content passed to `sendEmail()`** (see v1.2 addition below) — Mail validates format/required-fields/provider-payload-limits only, never whether the content itself makes sense.

**Provider adapter(s):** Resend (primary). Amazon SES, Mailgun, SMTP listed in §5 as future-supported providers — not required for v1 freeze; the interface must not preclude adding them later without a contract change.

**Constraint carried over from the existing Phase 1 stub (must not break):** Auth v1.1 and Organizations v1.0 already call `Mail.sendVerificationEmail()`, `Mail.sendPasswordResetEmail()`, and `Mail.sendInvitationEmail()` against the provisional stub. This spec's public interface must be validated against that real call pattern in Step 1 (agent validation) before build — same discipline that caught five real conflicts during the Configuration Service build. Do not assume the stub's shape is already correct; check it.

### v1.2 Addition — sendEmail() (additive, same pattern as Auth v1.0→v1.1's getUser())
**Why this exists:** When Mail was originally designed, its only three callers (Auth's verification/reset emails, Organizations' invitations) all fit a template+token model — a generic email API at that point would have been over-design, the same discipline applied throughout this project. Notifications (§21) now needs to send arbitrary business-composed email content, which none of the three existing template-bound functions support. The platform has legitimately outgrown Mail's original interface — this is genuine architectural growth, not scope creep, discovered by the agent during Notifications' Step 1 validation rather than assumed upfront.

**`sendEmail(workspaceId, to, subject, body, idempotencyKey?)`**
- Unlike `sendVerificationEmail()` etc., `subject` and `body` come directly from the caller — Mail performs zero business templating and zero content interpretation for this function. Mail still owns provider selection, queue-and-retry, idempotency, and delivery tracking exactly as for the other three functions.
- Mail validates only: recipient format, required fields present, provider payload limits (e.g. subject/body length caps). It never validates business correctness of the content — same posture Notifications already has toward the content it passes through.
- Success `data`: `{ queued: true, messageId }`
- Errors: `INVALID_RECIPIENT`, `PROVIDER_NOT_CONFIGURED`, `INVALID_CONTENT` (missing subject/body, or exceeds provider payload limits)
- Internal: provider adapter gains `MessageType.GENERIC` alongside the existing `VERIFICATION`/`PASSWORD_RESET`/`INVITATION` types. For `GENERIC`, subject/body are used as-is rather than constructed from a type+token.

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

### v1.3 Addition — listMessages() (additive, per §3.13 Pagination Standard)
**`listMessages(workspaceId, filters?, pagination?)`**
- `filters`: `{ status? }`
- `pagination`: `{ limit?, cursor? }` per §3.13
- Success `data`: `{ items: [{ messageId, provider, deliveryStatus, createdAt }], hasMore, nextCursor }`
- Errors: `WORKSPACE_NOT_FOUND`
- **`subject` is deliberately excluded from the response**, even though Mail stores it for `sendEmail()`-originated messages. Subject lines can contain business content (e.g. "Your order #4829 has shipped") — returning them through a dashboard-facing list function would leak business meaning through a different door than the one §17's `sendEmail()` boundary was built to close. Consistent with SMS's `listSms()` never returning recipient: list functions expose infrastructure state only, never payload content.
- Errors: `WORKSPACE_NOT_FOUND`

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
- [ ] `sendEmail()` performs zero business templating/content interpretation — validates format/required-fields/payload-limits only, never business correctness of subject/body
- [ ] Idempotency verified: same `workspaceId` + `idempotencyKey` within the window returns the original `messageId`, does not send a second email

### Known Limitation (backlog, not a v1 blocker)
**No documented delivery-status state-transition table.** `getDeliveryStatus` returns one of `queued|sent|delivered|failed|bounced`, but there is no written definition of which transitions are valid (e.g. can `failed` become `delivered` after a retry succeeds? can `bounced` ever become `delivered`? no — but this isn't written down anywhere). Documentation-only fix, no code change required — add a transition diagram to `src/modules/mail/README.md`.

---

## 18. Storage Module Specification v1.1 — STATUS: FROZEN (v1.0 implemented/tested; v1.1 additively adds listFiles() — see below; ready for agent validation and build)

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
- Returns a time-limited presigned download URL, valid for **15 minutes** from issuance, consistently across every provider (not provider-dependent — Storage sets this itself when generating the presigned URL). A caller needing a longer-lived link must call this function again closer to when it's needed rather than caching an old URL.
- Storage does not check whether the caller *should* have access — the calling module already decided that.
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

### v1.1 Addition — listFiles() (additive, per §3.13 Pagination Standard)
**`listFiles(workspaceId, filters?, pagination?)`**
- `filters`: `{ state? }` (e.g. `UPLOADED`, `DELETED`)
- `pagination`: `{ limit?, cursor? }` per §3.13
- Success `data`: `{ items: [{ fileId, state, mimeType, sizeBytes, createdAt }], hasMore, nextCursor }`
- Errors: `WORKSPACE_NOT_FOUND`
- No filenames — Storage never owns filenames per §3.10 (File Ownership Rule), only bytes/metadata. If a dashboard needs to show something human-readable, that has to come from the owning module's own data, not Storage.

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

## 19. Pay Module Specification v1.1 — STATUS: FROZEN (v1.0 implemented/tested; v1.1 additively adds listPayments() — see below; ready for agent validation and build)

**Purpose:** Answers "how does money move, reliably and safely, regardless of which provider is behind it?" Pay owns financial facts and transaction lifecycle only — never the business reason money moved.

**Out of scope:** Business meaning of a payment (what it unlocked, what subscription it renewed, what invoice it settled) — that belongs entirely to the requesting module. Raw card/bank data — Pay never receives, transmits, or stores it (see PCI Boundary Rule below). Authorization ("is this caller allowed to charge this workspace") — the calling module has already decided that, exactly per Storage's precedent.

**Provider adapter(s):** Stripe (primary). Paystack, PayPal, Flutterwave, Wise listed in §5 as future-supported providers — not required for v1 freeze.

**Payment Intent ownership (settled during ownership debate — binding, not open):** Option A (Generic Pay). The requesting module calls `Pay.createPayment()` and receives a `paymentId` back; it stores the `businessEntityId ↔ paymentId` relationship itself. Pay never accepts or stores an `entityType`/`entityId` — that would introduce business concepts into Pay, violating §3.12 the same way a hypothetical `getLatestVersion()` would have violated §3.10 in Storage.

### Owns
Payment Intent, Payment Record, Refund Record, provider transaction IDs, payment status, currency, amount (as integer minor units — see below), fees, settlement metadata (including exchange rate **as reported by the provider**, never computed by Pay — see Pricing Rule below), payment audit trail, webhook event log (for deduplication).

### Does not own
Users, workspaces, secrets, email delivery, files, verification records, evidence, documents, orders, subscriptions, invoices, raw card/bank data, pricing decisions, currency conversion, refund-eligibility decisions. Per §3.12, the relationship between a payment and any business entity is owned by the requesting module, never by Pay.

### Pricing Rule (binding)
Pay executes exactly the `amountMinorUnits` and `currency` it's given by the caller — it never calculates prices, applies discounts, or performs currency conversion. If a caller wants to charge NGN 5,000, it asks Pay for NGN 5,000; Pay does not accept a USD amount and convert it. If a provider's settlement currency differs from the charge currency, Pay may *record* the exchange rate the provider reports as settlement metadata — this is recording a fact the provider already decided, not Pay deciding a rate. Pricing policy belongs entirely to the requesting module.

### Refund Decision Rule (binding)
Pay executes refunds when asked and records the result — it never decides whether a refund is warranted. "This verification was cancelled, so it deserves a refund" is a business decision made by the requesting module (e.g. Verify), which then calls `Pay.refundPayment()`. Pay has no eligibility logic of its own.

### Public Interface

**`createPayment(workspaceId, amountMinorUnits, currency, idempotencyKey)`**
- `amountMinorUnits` is a positive integer in the currency's smallest unit (e.g. `1999` for $19.99 USD, `500` for ¥500 JPY — no decimals, ever, avoiding floating-point rounding). `currency` is an ISO 4217 code.
- `idempotencyKey` is **required, not optional** (unlike Mail's optional key) — a caller retrying after a timeout without one risks double-charging a real card. Same `workspaceId` + `idempotencyKey` within the idempotency window returns the original `paymentId` without creating a second charge.
- Success `data`: `{ paymentId, status: "pending", checkoutUrl }` — `checkoutUrl` is a provider-hosted checkout/tokenization page; Pay never receives raw card data (see PCI Boundary Rule).
- Errors: `INVALID_AMOUNT`, `INVALID_CURRENCY`, `WORKSPACE_NOT_FOUND`, `PROVIDER_NOT_CONFIGURED`

**`getPayment(workspaceId, paymentId)`**
- Success `data`: `{ paymentId, status, amountMinorUnits, currency, createdAt, updatedAt }`
- Errors: `PAYMENT_NOT_FOUND`

**`refundPayment(workspaceId, paymentId, amountMinorUnits?, idempotencyKey)`**
- Omitting `amountMinorUnits` refunds the full remaining amount; supplying it does a partial refund. `idempotencyKey` required, same reasoning as `createPayment`.
- Success `data`: `{ refundId, paymentId, status: "refund_pending", amountMinorUnits }`
- Errors: `PAYMENT_NOT_FOUND`, `PAYMENT_NOT_REFUNDABLE`, `REFUND_EXCEEDS_REMAINING`

**`listRefunds(workspaceId, paymentId)`**
- Success `data`: `{ refunds: [{ refundId, amountMinorUnits, status, createdAt }] }`
- Errors: `PAYMENT_NOT_FOUND`

### v1.1 Addition — listPayments() (additive, per §3.13 Pagination Standard)
**`listPayments(workspaceId, filters?, pagination?)`**
- `filters`: `{ status? }`
- `pagination`: `{ limit?, cursor? }` per §3.13
- Success `data`: `{ items: [{ paymentId, amountMinorUnits, currency, provider, status, createdAt }], hasMore, nextCursor }`
- Errors: `WORKSPACE_NOT_FOUND`
- No business labels, no invoice descriptions, no customer names — same §3.12 boundary as every other Pay function. A dashboard wanting "Admission Fee" instead of a bare `paymentId` has to resolve that from the calling product's own data, never from Pay.

**`getProviderStatus(workspaceId)`**
- Success `data`: `{ configured: boolean, provider: string | null }`
- Errors: `WORKSPACE_NOT_FOUND`

**Explicitly excluded from this interface:** any function accepting `entityType`/`entityId` (violates Payment Intent ownership above); any function accepting raw card numbers, CVV, or bank account details (violates PCI Boundary Rule); `updatePaymentAmount()` or similar (violates financial-facts immutability, §3.12).

### Payment Status State Machine (binding, not illustrative — same treatment as Mail's delivery status and Storage's upload state)
```
pending → succeeded → refund_pending → refunded (full)
                    → refund_pending → partially_refunded (partial)
        → failed (terminal)
succeeded → disputed (provider-initiated, via webhook only)
```
- `pending → succeeded` and `pending → failed` are driven by the provider's checkout completing or failing.
- `succeeded → refund_pending → refunded/partially_refunded` is driven by `refundPayment()` plus webhook confirmation.
- `succeeded → disputed` is driven exclusively by an incoming webhook (a chargeback initiated at the customer's bank) — no public function triggers this; it can only happen via Provider Webhook Handling below.
- `failed` is terminal — a failed payment is never retried in place; the caller calls `createPayment()` again with a new `idempotencyKey` for a new attempt.
- This state machine governs *status* only. The underlying financial facts (`amountMinorUnits`, `currency`, `provider`, payer) never change after `createPayment()` succeeds, regardless of status — per §3.12's distinction between immutable facts and legitimate status transitions.

### PCI Boundary Rule (binding — not a v1 nicety, a compliance requirement)
Pay never receives, transmits, logs, or stores raw card numbers, CVVs, or bank account credentials. `createPayment()` returns a `checkoutUrl` pointing to the provider's own hosted checkout/tokenization flow (Stripe Checkout, Stripe Elements, etc.) — the customer enters payment details directly with the provider, never through Codlok's servers. This keeps Codlok itself outside PCI-DSS scope for card data, the same way Configuration Service's encryption keeps secrets out of git.

### Provider Webhook Handling (Rule 5 formalized)
- Incoming webhooks are received exclusively by Pay — no other module ever receives a provider webhook directly.
- Every webhook event is deduplicated by the provider's event ID before processing. Providers (including Stripe) can and do deliver the same event more than once; processing a duplicate event must be a no-op, not a repeated status transition or a repeated audit log entry.
- Pay translates provider-specific webhook payloads into Codlok-standard status transitions (per the state machine above) before anything is visible to callers — callers never see a raw provider webhook shape.

**Webhook Deduplication Rule (binding, promoted from implementation to spec):** Pay records every processed provider event ID, permanently. A given provider event ID is processed at most once — ever. Subsequent deliveries of the same event ID are acknowledged but perform no state transition and no repeated audit log entry. This is an architectural guarantee, not an implementation detail, and must hold regardless of which provider adapter is in use.

### Workspace Context
Every function requires `workspaceId` — provider selection (which Stripe account) is per-workspace, per §6/§7, consistent with every other module.

### Module Interaction
Pay calls `Configuration.getSecret(workspaceId, key)` for provider credentials (e.g. Stripe secret key). Pay calls no other module. Every other module calls Pay's public interface only — never Stripe directly, per the foundational rule established in §2.

### Design Rationale
- *Why is `idempotencyKey` required for Pay but optional for Mail?* A duplicate email is an annoyance; a duplicate charge is a real financial loss and a support/compliance problem. The cost of getting this wrong is categorically different, so the safety net is mandatory rather than opt-in.
- *Why integer minor units instead of decimal amounts?* Floating-point decimals accumulate rounding errors that compound at scale and can create off-by-one-cent discrepancies that are genuinely difficult to debug later. Minor units (cents) are exact integers and match what Stripe/Paystack/Flutterwave already expect at their own API boundary.
- *Why does Pay never accept `entityType`/`entityId`?* Same reasoning as Storage's refusal to track "current version" (§3.10/§18): the moment Pay understands *what* a payment is for, it has absorbed business meaning that belongs to the requesting module, and every future business module would need Pay to understand its specific entity types — an ever-growing dependency in the wrong direction.
- *Why formalize webhook deduplication now instead of treating it as an implementation detail?* Unlike Mail's provider retries (where a duplicate *send* is the risk to guard against), here a duplicate *webhook delivery* is the risk — processing "payment succeeded" twice could double-fire whatever the caller does in response (e.g. unlocking two verifications instead of one). This is exactly the kind of caller-visible correctness issue Rule 12's compliance tests exist to catch, so it belongs in the spec, not left to be discovered during implementation the way Configuration's missing `verifyUser()` was.

### Core Spec Compliance Checklist
- [ ] Uses only the standard API response format
- [ ] Reads provider secrets only through `Configuration.getSecret()` — never hardcoded
- [ ] Respects workspace isolation — no cross-workspace payment access
- [ ] Exposes only public interfaces
- [ ] Does not access other modules' internals
- [ ] Uses Codlok-standard error codes; never leaks raw provider errors to callers
- [ ] No business-reference fields anywhere in Pay's data model (§3.12) — no `entityType`/`entityId`
- [ ] `idempotencyKey` required (not optional) on `createPayment` and `refundPayment`; duplicate calls return the original record, never a second charge/refund
- [ ] Amounts stored and transmitted as integer minor units — never floating-point decimals
- [ ] Financial facts (amount/currency/payer/provider) immutable after `createPayment()` succeeds
- [ ] Webhook events deduplicated by provider event ID before processing
- [ ] No raw card/bank data ever received, logged, or stored by Pay
- [ ] `createPayment`/`refundPayment` execute exactly the amount/currency given — no price calculation, no currency conversion inside Pay
- [ ] Pay has no refund-eligibility logic — only executes refunds the caller explicitly requests

---

## 20. Verify Module Specification v1.0 — STATUS: FROZEN (implemented; 52 Verify tests + 306 existing = 358/358 passing; boundary, adapter absorption, data minimization, immutability, webhook deduplication, and regression tests confirmed per Rule 12)

**Naming disambiguation (read this first):** "Codlok Verify" (this module) and "SREMA Verify" (a downstream product built on Codlok) are two different things. Codlok Verify is generic infrastructure any Codlok product can use; SREMA Verify is one specific application that will call it. This document never uses "Verify" to mean the SREMA product — always the Codlok module.

**Purpose:** Answers "how does a workspace get an identity/business verification done, reliably, regardless of which provider does the actual checking?" Verify orchestrates external KYC/identity-verification providers — it never implements verification logic itself, exactly as Pay orchestrates Stripe rather than being a payment network (§7 Provider Model applied to identity verification, not a new principle).

**Out of scope:** Biometric matching, OCR, document authenticity analysis, liveness detection, or any actual verification algorithm — all of that stays with the provider (Stripe Identity, Smile ID, Persona, Onfido, Veriff, Sumsub). Deciding *when* verification is required or *what level* is needed (individual KYC vs. business verification vs. document-only) — the calling module/product decides that and tells Verify which provider flow to start. Storing verification artifacts (document images, biometric templates, full provider reports) — see Verification Data Minimization Rule below.

**Provider adapter(s):** Stripe Identity, Smile ID, Persona, Onfido, Veriff, Sumsub — per §5/§7, not all required for v1 freeze; the interface must not preclude adding more later without a contract change.

### Owns
Verification session/request records, provider reference IDs, normalized verification status, provider name, non-sensitive provider metadata, Verify's own internal audit trail (verification requests, provider interactions, webhook processing, status transitions — per the (a) decision above, self-contained, no dependency on a future Audit module), webhook event log (for deduplication, same pattern as Pay).

### Does not own
Raw identity documents, passport/license images, biometric templates, face embeddings, OCR output, full provider verification reports, authorization decisions, the business reason verification was requested. Per the same pattern as §3.10/§3.12, the relationship between a verification and a business entity (e.g. "this verification unlocked that SREMA Verify inspection") is owned entirely by the calling module — Verify never accepts or stores an `entityType`/`entityId`.

### Verification Data Minimization Rule (binding — module-level, not Core Spec, same placement reasoning as Pay's PCI Boundary Rule)
Verify stores only: provider name, provider verification/session ID, normalized status, timestamps, its own audit trail, and non-sensitive provider metadata. Verify **never** stores raw documents, biometric templates, face embeddings, OCR results, or full provider reports — the provider remains the system of record for all verification artifacts; Verify never re-hosts them. This reduces Codlok's compliance surface to "who requested what, and what was the outcome" rather than "custodian of identity documents and biometric data." If a future release needs the underlying documents (e.g. for dispute resolution), that means fetching them from the provider on demand via the provider's own API, not storing a Codlok-side copy.

### Verification Fact Immutability Rule (binding, mirrors Pay's Financial Facts Rule under §3.12)
Once a verification session is created, the following never change: `verificationId`, `provider`, `providerVerificationId`, `verificationType`, `subjectReference` (whatever caller-supplied identifier ties this verification to the person/entity being checked), `workspaceId`. Only `status` transitions, per the state machine above. A correction always means a new verification session, never an edit to an existing one — same reasoning as Pay's immutable financial facts and Storage's immutable uploaded objects.

### Public Interface

**`createVerificationSession(workspaceId, verificationType, subjectReference, idempotencyKey)`**
- `subjectReference` is a caller-supplied identifier for the person/entity being verified (e.g. a `userId` from Auth, or any string the calling module uses internally) — Verify stores it opaquely and never interprets it, same as Pay never interpreting business identifiers. It exists so a caller can later ask "what verifications exist for this subject" without Verify needing to understand what the subject actually is.
- `verificationType` is a **canonical Codlok enum**, not an opaque string — `INDIVIDUAL_IDENTITY`, `BUSINESS_VERIFICATION`, `DOCUMENT_VERIFICATION`, `ADDRESS_VERIFICATION`, `AGE_VERIFICATION`. Different providers use different vocabulary for similar flows (Stripe's "document" type, Persona's "Government ID" inquiry, etc.) — an opaque caller-supplied string would leak that provider-specific vocabulary into Codlok's public API. The provider adapter maps each canonical type to whatever that provider actually calls it. Verify does not decide *which* type is appropriate for a given situation — that remains the caller's business decision — but the vocabulary itself is Codlok's, not the provider's.
- `idempotencyKey` is **required** (same reasoning as Pay, not Mail): a duplicate session creation isn't just wasteful, it can cost real provider fees per session and creates confusing duplicate verification records for the same person.
- Success `data`: `{ verificationId, providerSessionUrl, status: "pending" }` — `providerSessionUrl` is a provider-hosted flow (document capture, selfie, etc.); Codlok's servers never handle the capture itself.
- Errors: `INVALID_VERIFICATION_TYPE`, `WORKSPACE_NOT_FOUND`, `PROVIDER_NOT_CONFIGURED`

**`getVerificationStatus(workspaceId, verificationId)`**
- Success `data`: `{ verificationId, status, provider, verificationType, createdAt, updatedAt }`
- Errors: `VERIFICATION_NOT_FOUND`

**`listVerifications(workspaceId, filters?)`**
- Success `data`: `{ verifications: [{ verificationId, status, verificationType, createdAt }] }`
- Errors: `WORKSPACE_NOT_FOUND`

**`getProviderStatus(workspaceId)`**
- Success `data`: `{ configured: boolean, provider: string | null }`
- Errors: `WORKSPACE_NOT_FOUND`

**Explicitly excluded from this interface:** any function accepting `entityType`/`entityId`; any function returning raw document images, biometric data, or full provider reports; any function implying Verify itself performs matching/OCR (e.g. no `compareFaces()`, no `extractDocumentData()`).

### Verification Status State Machine (binding, revised against real provider behavior — validated against Stripe Identity and Persona before freezing)
```
pending → in_review → approved
                     → rejected
pending → expired (terminal — session timed out before completion)
```
- `approved` and `rejected` are terminal and driven exclusively by provider webhooks — no public function transitions status directly, exactly like Pay's `disputed` state.
- `expired` is terminal; a new verification requires `createVerificationSession()` again with a new `idempotencyKey`.

**Adapter Absorption Rule (added after validating against real providers — this is the actual fix, not more states):** Real providers do not have a clean one-directional lifecycle. Stripe Identity's `requires_input` status can occur mid-flow — a failed document check sends the session back to `requires_input` for resubmission *within the same session*, not just at the start. Persona has two separate phases: a "Done" phase (`completed`/`failed`/`expired`) followed by a distinct decisioning phase (`approved`/`declined`/`needs_review`) — reaching "done" does not mean a decision has been made.

Rather than adding a normalized state for every provider quirk, the **provider adapter is responsible for absorbing this internal complexity** and only emitting a Codlok status transition when something meaningfully actionable changes for the caller:
- `pending` covers *all* not-yet-finalized provider activity, including Stripe's `requires_input` resubmission loop — the adapter does not surface a status change every time Stripe asks the user to resubmit a document; it stays `pending` until the provider truly finalizes.
- `in_review` is reserved for a provider explicitly flagging a session for manual/human review that the caller may want to know about (e.g. Persona's `needs_review`) — not every provider has this state, and providers without one simply never emit `in_review`.
- `rejected` is not always a direct 1:1 provider mapping. Persona has an explicit `declined` status; Stripe Identity does not — a Stripe session that never succeeds ends up `canceled`, with no distinct "rejected" concept. The Stripe adapter is responsible for deciding when a `canceled` session with no successful verification should be reported to Codlok as `rejected` vs. simply left unresolved — this is documented adapter behavior, not a gap in the normalized model.
- Status here reflects Verify's *normalized* view — provider-specific intermediate states beyond what's captured above are never exposed to callers; they collapse into `pending` until a final provider outcome arrives.

### Webhook Handling (same pattern as Pay's Provider Webhook Handling + Webhook Deduplication Rule)
- Incoming webhooks are received exclusively by Verify — no other module receives a provider verification webhook directly.
- Every webhook event is deduplicated by provider event ID, permanently — a given provider event ID is processed at most once, ever, mirroring Pay's rule exactly.
- Verify translates provider-specific webhook payloads into the normalized status state machine above before anything is visible to callers.

### Workspace Context
Every function requires `workspaceId` — provider selection is per-workspace, per §6/§7, consistent with every other module.

### Module Interaction
Verify calls `Configuration.getSecret(workspaceId, key)` for provider credentials. Verify calls no other module — not Audit (per the (a) decision: Audit will later consume Verify's records, Verify never depends on Audit), not Storage (Verify does not store documents, so it has no reason to call Storage), not Pay (if a product wants to charge for verification, that's the calling module's job to sequence — Verify and Pay never call each other directly).

### Design Rationale
- *Why is `idempotencyKey` required here, same as Pay but unlike Mail?* Duplicate verification sessions aren't just wasteful like a duplicate email — most providers charge per session, and duplicate sessions for the same person create confusing, hard-to-reconcile records. The cost profile is closer to Pay's than Mail's.
- *Why does Verify normalize away provider-specific intermediate states?* If callers had to understand each provider's specific state names, switching providers would require every calling module to change its status-handling logic — defeating the point of provider abstraction (§7). A small, stable set of normalized states is what makes "switch providers without affecting applications" (the stated goal) actually true.
- *Why is data minimization a module-level rule rather than a Core Spec rule, same as Pay's PCI boundary?* It's specific to what Verify's inputs look like (identity documents, biometrics), not a recurring ownership pattern across modules — same reasoning already applied to keep PCI at Pay's level rather than promoting it to the Core Spec.

### Core Spec Compliance Checklist
- [ ] Uses only the standard API response format
- [ ] Reads provider secrets only through `Configuration.getSecret()` — never hardcoded
- [ ] Respects workspace isolation — no cross-workspace verification access
- [ ] Exposes only public interfaces
- [ ] Does not access other modules' internals; does not call Storage, Pay, or a future Audit module
- [ ] Uses Codlok-standard error codes; never leaks raw provider errors to callers
- [ ] No business-reference fields anywhere in Verify's data model — no `entityType`/`entityId`
- [ ] No raw documents, biometric data, or full provider reports ever stored (Verification Data Minimization Rule)
- [ ] `idempotencyKey` required on `createVerificationSession`; duplicate calls return the original `verificationId`, never a second session
- [ ] Webhook events deduplicated by provider event ID, permanently
- [ ] Verify's own audit trail is self-contained — no dependency on a future Audit module

---

## 21. Notifications Module Specification v1.0 — STATUS: FROZEN (implemented; 41 Notifications tests + 368 existing = 409/409 passing; boundary, channel-selection, idempotency, cancellation, content-immutability, and regression tests confirmed per Rule 12)

**Purpose:** Answers "who should be notified, about what, through which channels?" — delivery intent and orchestration only. Does not answer "how is an email/SMS/push actually sent" (Mail/SMS/Push own that). Marks the start of Phase 2 (shared platform services), following Phase 1 (the seven frozen generic-infrastructure modules).

**Out of scope:** Business templates, business copy, localization, variable interpolation, cross-channel fallback (business module responsibility), identity resolution (Auth's job, never called by Notifications).

### Owns
Notification records, workspace-scoped user preferences (channel enabled/disabled, quiet hours, categories, unsubscribe), channel selection (intersecting caller-supplied content with preferences and configured providers), notification history, delivery orchestration (calling Mail/SMS/Push once each per selected channel).

### Does Not Own
Sending email/SMS/push (transport modules own that), user identity (Auth), business events, whether a customer *should* be notified, business templates/copy/localization, recipient identity as a system of record (Notifications holds it only transiently for dispatch — same distinction Mail already makes for the addresses it transports).

### Resolved Ownership Forks (settled during ownership debate, unchanged since)
1. **Contact Resolution — Option A.** Business modules supply recipient info directly; Notifications never calls Auth.
2. **Preference Scope — workspace-scoped.** Not user-global. Accepted cost: a person in five workspaces sets preferences five times, no cross-workspace sync.
3. **Content Ownership — 3a.** Business modules supply fully composed, channel-specific content. Notifications never rewrites, summarizes, truncates, interpolates, localizes, or generates from templates. If a payload violates a provider requirement, Notifications returns an error — it never silently fixes content (mirrors Storage's checksum-mismatch rejection).
4. **Retry — transport modules own it.** Notifications dispatches each selected channel exactly once; Mail/SMS/Push own their own retry (Mail's is already frozen, §17). Notifications never retries transport calls and never performs cross-channel fallback — that's business policy, decided by the calling application, not infrastructure.

### Channel Selection Logic (binding)
```
Available Content (caller-supplied)
        ∩
Workspace Preferences
        ∩
Configured Providers
        │
        ▼
Actual Dispatch Plan
```
The caller does not choose channels directly — it supplies content per channel it has composed, and Notifications computes the actual dispatch plan by intersecting that with the workspace's enabled preferences and configured providers. A caller offering `{email, sms}` content in a workspace with SMS disabled results in email-only dispatch.

### Public Interface

**`sendNotification(workspaceId, notificationRequest, idempotencyKey)`**
- `notificationRequest`: `{ recipient: { email?, phone?, pushToken? }, content: { email?: {subject, body}, sms?: {body}, push?: {title, body} }, metadata? }`
- `idempotencyKey` **required**, permanent retention — duplicate requests return the original notification, never a second dispatch (same reasoning as Pay/Verify: real per-channel provider cost, not just an annoyance like Mail's duplicate sends).
- Success `data`: `{ notificationId, overallStatus: "queued" }`
- Errors: `WORKSPACE_NOT_FOUND`, `INVALID_RECIPIENT`, `INVALID_CONTENT`, `NO_AVAILABLE_CHANNEL`, `PROVIDER_NOT_CONFIGURED`, `IDEMPOTENCY_KEY_REQUIRED`

**`getNotification(workspaceId, notificationId)`**
- Success `data`: `{ notificationId, overallStatus, channels: { email?: {status, messageId}, sms?: {status, messageId}, push?: {status, messageId} }, createdAt, updatedAt }`
- Errors: `NOTIFICATION_NOT_FOUND`

**`listNotifications(workspaceId, filters?)`**
- `filters` (all optional, combinable): `{ overallStatus?, dateFrom?, dateTo?, recipient? }` — `recipient` filters by the same opaque recipient object fields used at send time (e.g. "all notifications sent to this email/phone"), not a resolved identity lookup.
- Success `data`: `{ notifications: [{ notificationId, overallStatus, createdAt }] }`
- Errors: `WORKSPACE_NOT_FOUND`

**`cancelNotification(workspaceId, notificationId)`**
- **Cancellation boundary (resolved during stress-test):** succeeds only while `overallStatus === "queued"` — nothing has dispatched yet. Once any channel enters `dispatching`, the entire notification is no longer cancelable, even if other channels haven't started. This is simpler than partial-cancellation semantics and treats dispatch as an atomic unit once begun, consistent with immutability-after-action patterns elsewhere (Pay's financial facts, Storage's uploaded objects).
- Success `data`: `{ notificationId, overallStatus: "cancelled" }`
- Errors: `NOTIFICATION_NOT_FOUND`, `NOTIFICATION_ALREADY_DISPATCHING`

**`getChannelStatus(workspaceId)`**
- Success `data`: `{ channels: { email: {configured: boolean}, sms: {configured: boolean}, push: {configured: boolean} } }`
- Errors: `WORKSPACE_NOT_FOUND`

### Notification Status Model
Top-level `overallStatus`: `queued` (nothing dispatched yet) → `dispatching` (in progress) → `completed` (every selected channel has finished processing, success or failure) → `cancelled` (only reachable from `queued`, per the cancellation boundary above).

`completed` **deliberately does not imply overall success or failure.** Per-channel `status`/`messageId` in `channels` holds the real detail (delegated to each transport module — Mail already owns whether a specific email becomes `delivered`/`bounced`; Notifications does not duplicate that lifecycle). Whether partial delivery (e.g. email succeeded, SMS failed) counts as an acceptable outcome is a business judgment — deciding that would be the same kind of infrastructure-deciding-what-matters violation as truncating an SMS. Applications inspect per-channel results themselves.

### Core Spec Compliance Checklist
- [ ] Uses only the standard API response format
- [ ] Respects workspace isolation — preferences and history scoped per `workspaceId`
- [ ] Exposes only public interfaces
- [ ] Does not call Auth, Organizations, or any future Audit/Jobs module
- [ ] Uses Codlok-standard error codes; never leaks raw provider errors
- [ ] `idempotencyKey` required; duplicate calls return the original `notificationId`, never a second dispatch
- [ ] No content transformation, truncation, or interpolation anywhere in the code — only transport-safety validation (encoding, required-field presence) and rejection (`INVALID_CONTENT`) of malformed payloads
- [ ] Recipient data held only transiently for dispatch — never treated as a system of record
- [ ] Each transport module called at most once per channel per notification — no internal retry, no cross-channel fallback
- [ ] `cancelNotification` only succeeds while `overallStatus === "queued"`

---


## 22. SMS Module Specification v1.0 — STATUS: FROZEN (implemented; 48 SMS tests + 409 existing = 457/457 passing; boundary, state-machine, webhook resolution/dedup, opt-out normalization, and regression tests confirmed per Rule 12)

**Purpose:** SMS owns transporting text messages through SMS providers, normalizing provider behavior — it never invents messaging policy. Same orchestration philosophy as Pay, Verify, and Mail.

**Provider adapter(s):** Twilio, Termii, Vonage, Africa's Talking (§5/§7) — not all required for v1 freeze.

### Owns
SMS provider abstraction/selection/transport, delivery status normalization, provider webhooks, idempotency (required, permanent), transport retry (internal, never retried by callers), transport audit trail, inbound SMS reception, STOP/START/HELP normalization, provider error normalization including opt-out (`RECIPIENT_OPTED_OUT`).

### Does Not Own
Business messaging policy, notification preferences (Notifications), user identity (Auth), phone numbers as a system of record, business workflows, template rendering, business content.

### Recipient Data — Transport vs. System of Record (resolved contradiction from Pass 1)
SMS temporarily stores recipient phone numbers as operational transport data — it needs the number to dispatch, match delivery receipts, and resolve inbound STOP/START/HELP events. **SMS is not the system of record for phone numbers.** Recipient data is excluded from the public SMS record (`getSms()` never returns it) and is subject to whatever the future audit-retention policy (still an Open Design Decision, below) determines for redaction/removal. This mirrors the exact distinction Notifications already makes for its own recipient data — internally necessary, never publicly persisted as identity.

### Public Interface (five functions — `getDeliveryStatus()` removed as redundant with `getSms()`, same pattern as Pay/Verify/Notifications using one `getX()` per record)

**`sendSms(workspaceId, recipient, message, idempotencyKey)`**
- `recipient`: E.164 format only (validated, no carrier lookup — that's provider intelligence).
- `idempotencyKey` **required**, permanent retention.
- Success `data`: `{ smsId, provider, providerMessageId, status: "queued" }`
- Errors: `WORKSPACE_NOT_FOUND`, `INVALID_RECIPIENT`, `INVALID_CONTENT`, `MESSAGE_TOO_LONG`, `IDEMPOTENCY_KEY_REQUIRED`, `RECIPIENT_OPTED_OUT`, `PROVIDER_NOT_CONFIGURED`, `SEND_FAILED`

**`getSms(workspaceId, smsId)`**
- Success `data`: `{ smsId, provider, status, createdAt, updatedAt }` — no `recipient` field, per the rule above.
- Errors: `WORKSPACE_NOT_FOUND`, `SMS_NOT_FOUND`

**`listSms(workspaceId, filters?)`**
- `filters`: `{ status?, dateFrom?, dateTo? }` — no recipient/phone-number filter, since SMS doesn't retain recipients as queryable system-of-record data.
- Success `data`: `{ items: [{ smsId, status, createdAt }] }`
- Errors: `WORKSPACE_NOT_FOUND`

**`getProviderStatus(workspaceId)`**
- Success `data`: `{ providers: { twilio: {configured}, termii: {configured}, vonage: {configured} } }`
- Errors: `WORKSPACE_NOT_FOUND`

**`processWebhook(payload)`** — internal entry point, called only by provider callbacks, never by business modules.
- **No `workspaceId` parameter (resolved during Pass 2).** SMS resolves workspace context by locating the stored SMS record using the `providerMessageId` the provider callback supplies — exactly the pattern Pay's webhook handling already uses. For inbound messages (STOP/START/HELP) that aren't a reply to any specific outbound SMS, workspace is resolved via destination number → provider account → matching workspace configuration; `smsId` on the resulting inbound event is optional, since not every inbound message corresponds to one.
- Responsibilities: delivery receipts, inbound SMS, STOP/START/HELP normalization, provider event deduplication (permanent, by provider event ID — same rule as Pay/Verify), provider status normalization.

### Delivery Status State Machine (corrected during Pass 2 against real provider behavior)
```
queued → sending → sent
                  ↙      ↘
            delivered   failed
```
- `sent` is a **resting state, not a guaranteed-final one.** Not every provider/route sends a delivery receipt — a message can remain `sent` indefinitely if no receipt ever arrives. This is different from `delivered`/`failed`, which are guaranteed-final once reached. A caller should not treat `sent` as equivalent to "this record will never change" — it may still transition to `delivered` or `failed` if a receipt arrives later, or it may simply stay `sent` forever. Terminal states in the sense of "SMS will not itself keep working on this" are `sent`, `delivered`, and `failed` — but only `delivered`/`failed` mean no further change is possible.

### SMS Record
```ts
{ smsId, workspaceId, provider, providerMessageId, status, createdAt, updatedAt }
```
No recipient (see rule above). No business-reference fields. No templates.

### Inbound Event Record
```ts
{ eventId, workspaceId, provider, providerEventId, smsId?, keyword: "STOP"|"START"|"HELP"|"OTHER", receivedAt }
```
`smsId` is optional — an inbound STOP isn't necessarily a reply to a specific outbound message. `workspaceId` resolved via destination number → provider account, same as outbound webhook resolution. No business interpretation of keywords.

### Error Code Precision
- **`SEND_FAILED`**: returned only after SMS has exhausted all provider retry attempts. Never returned for a retryable first-attempt transport failure — matches Mail's terminal-failure handling.
- **`RECIPIENT_OPTED_OUT`**: the provider rejected the send because the recipient previously opted out (e.g. Twilio error 21610) — normalized from the provider's specific rejection, not a Codlok-invented judgment.
- **`MESSAGE_TOO_LONG`**: message exceeds the configured maximum segment limit — SMS rejects rather than silently splitting into excessive billable segments.

### Compliance Rule — Provider Enforcement (binding, unchanged from ownership freeze)
SMS normalizes the provider's opt-out enforcement into `RECIPIENT_OPTED_OUT`. It does not determine whether a message category is legally exempt from opt-out, and does not attempt to bypass provider-enforced blocking — that decision structurally belongs to provider/account-level configuration (e.g. Twilio's Advanced Opt-Out), never to Codlok application code.

### STOP/START/HELP Ownership Rule (binding, unchanged from ownership freeze)
SMS exclusively owns inbound reception, webhook normalization, and keyword detection/recording. It never interprets those keywords as business policy.

### Open Design Decision — Audit Retention Policy (still explicitly deferred)
Retention duration, phone-number redaction/hashing, jurisdiction-specific requirements — not resolved now, same treatment as every other genuinely open item in this project (Jobs/Queue's Option A/B, MCP's mechanism).

### Core Spec Compliance Checklist
- [ ] Uses only the standard API response format
- [ ] Reads provider secrets only through `Configuration.getSecret()` — never hardcoded
- [ ] Respects workspace isolation
- [ ] Exposes only public interfaces
- [ ] Does not access other modules' internals
- [ ] Uses Codlok-standard error codes; never leaks raw provider errors
- [ ] `idempotencyKey` required on `sendSms`; duplicate calls return the original `smsId`, never a second send
- [ ] Recipient never exposed in `getSms()`/`listSms()` responses
- [ ] `processWebhook` resolves workspace via `providerMessageId` (outbound) or destination-number/provider-account matching (inbound) — never requires the caller to supply `workspaceId`
- [ ] Webhook events deduplicated by provider event ID, permanently
- [ ] `sent` status never treated internally as equivalent to `delivered`/`failed` — remains open to further transition

---

## 23. Codlok Cloud Dashboard v1.1 — STATUS: BUILT (Phases 1–3 reconciled; real module APIs and provider configuration; 543/543 full regression)

**Purpose:** The admin dashboard's information architecture and display rules — decided through UI/UX design passes, not module-spec debate, but binding for whoever builds it since it enforces existing frozen ownership boundaries rather than inventing new ones.

### Navigation Structure
```
Codlok Cloud
├── Products
│     ├── AcadID / SREMA / Droppday / ...
│     └── Create Product
├── Secret Templates
├── Developer
│     ├── AI Builder
│     ├── OpenAPI (Coming Soon)
│     ├── SDK (Coming Soon)
│     ├── API Explorer (Coming Soon)
│     └── Freeze Log
└── Account

Inside a Product:
├── Overview       (aggregate stats + module list)
├── Modules        (per-module config, provider selection)
├── Health         (uptime per module)
├── Team           (Codlok access — Owner/Admin/Member, per §12)
├── API Keys
├── Monitoring
├── Logs
└── Settings
```

### Binding Display Rule — No Business Entities in Codlok's Own UI (enforces §3.10/§3.12, not a new principle)
Every module detail page (Verify, Storage, Pay, Notifications, SMS) displays **only what that module actually owns** — opaque IDs, status, timestamps, provider name. Never a resolved business name or entity, because Codlok's modules structurally don't have that information (per §3.10's File Ownership Rule, §3.12's Financial Ownership Rule, and Verify's Data Minimization Rule).

Examples:
- Verify shows `VER-7C82D91 · Approved · 2026-07-13 14:35 UTC` — never "University of Lagos" (that's AcadID's own data, tied to Verify's `subjectReference`, which Verify stores opaquely and never interprets, per §20).
- Storage shows `FIL-1A82B · 12 MB · Created 14:02 UTC` — never "Student Transcript.pdf."
- Pay shows `PAY-92AAB · Completed · ₦50,000 · Stripe` — never "Admission Fee."
- Notifications shows `NOT-821AB · Completed · Email · 14:03 UTC` — never "Admission Email."
- SMS shows `SMS-1BC8D · Delivered · Twilio · 14:01 UTC` — never "OTP for Student."

If a product wants to show its own business-meaningful view of this data (e.g. "University of Lagos's verification history"), that's a page inside the product's own application, built on top of Codlok's opaque IDs — not something Codlok's dashboard can or should show, since Codlok genuinely doesn't have the business context.

### "Team" Naming (not "Organizations")
Inside a product, the people-management page is named **Team**, not "Organizations," to avoid confusion with a product's own customer/tenant data (e.g. AcadID's universities). It reflects exactly §12's Organizations module — Owner/Admin/Member access to *configure this product inside Codlok* — never a product's own business relationships.

### Secret Templates (renamed from "Credential Templates" — matches Configuration's actual `getSecret`/`setSecret` terminology, scales to non-provider secrets like API keys generally)
**Not live shared configuration.** A template is copied into a workspace's own Configuration store when applied — never referenced live, never inherited. This preserves §3.7 and §16's workspace-isolation guarantee exactly: rotating one product's copy never affects another's, deleting a template never breaks a product that already applied it.
```
Secret Template (platform-owned)
        │  read
        ▼
   [Apply Template]
        │  copy value, write via existing Configuration.setSecret(workspaceId, ...)
        ▼
Product's own Configuration store (workspace-scoped, isolated)
```
**Security:** Secret Templates carry the exact same guarantees as any workspace secret under §16 — encryption at rest, permanent Secret Access Auditing, versioning. The **apply/copy operation itself** must be logged as both a read (on the template) and a write (on the destination workspace), attributed to the acting admin — not just the resulting stored value.

**Backend status — Track B, NOT yet designed, blocking real (non-mock) implementation:** Configuration Service (§16) is entirely workspace-scoped by design (§3.7) — every function requires `workspaceId`. A template is platform-owned data with no workspace context, which the current frozen interface has no shape for. This requires an **additive** extension to §16 (not a new module — same reasoning as keeping PCI/data-minimization at module level rather than inventing new Core Spec territory), most likely a reserved platform-level `workspaceId` sentinel writable only by the account owner, reusing existing `getSecret()`/`setSecret()` rather than new functions. **This extension itself needs its own draft → stress-test → freeze pass**, same lifecycle as every other Configuration change (§16 is currently Frozen at the workspace-scoped version — this would be v1.3, not yet drafted). Do not build real backend wiring for Secret Templates until this is designed and frozen.

### Implemented Dashboard Phases
- **Phase 1 — Platform wiring:** Auth registration/login/logout and Organizations product/workspace creation/list/detail use real public APIs. Development-only automatic email verification is isolated from production registration and the Mail outbox route is blocked in production. Session persistence currently uses browser `localStorage`; migration to HttpOnly cookies is mandatory production hardening.
- **Phase 2 — Module wiring:** Verify, Storage, Pay, Mail, SMS, Notifications, Team, and provider-status pages use real public module APIs. Lists follow §3.13. Workspace authorization is enforced at HTTP routes. No user-visible fake module records remain.
- **Phase 3 — Provider configuration:** explicit configuration components exist for the six registered providers. Secret writes/deletes use Configuration only; secret values are never returned to the browser. Provider readiness comes from `getProviderStatus()`. Active provider selection is stored as workspace setting `default_provider:<moduleId>`, not a Feature Flag and not a Provider Registry mutation. Test Connection is visibly disabled until real provider adapter validation exists.
- **Track B — Secret Templates:** still blocked and shown only as Coming Soon. It requires a separately designed platform-owned secret model; no fake templates or fake Apply action may appear.

### Coming Soon (explicitly not designed — UI must not imply these work)
OpenAPI, SDK generation, API Explorer, API Keys, Logs, Monitoring, product Settings, Secret Templates, and real uptime/latency Health metrics — placeholder/Coming Soon only. No ownership pass has been done on any of them (consistent with §18's earlier decision not to design AI/Connect/MCP speculatively — same discipline applied to dashboard features).

### Explicitly Rejected During Design
A "Platform > Providers" page offering live, shared provider configuration across all products was proposed and rejected — it would have meant every product billing through the same Stripe account, every product's SMS through the same Twilio number, and one credential rotation silently affecting unrelated products. This directly contradicts §3.7 and §16's explicit "no global/default secret, never silently inherited from elsewhere" rule. Secret Templates (copy, not live reference) is the corrected version of the same underlying convenience goal.

---

## 24. Architecture Roadmap (Post–Phase 2.5, Pre–Phase 3) — NOT FROZEN, NOT AN IMPLEMENTATION DIRECTIVE

**Status note on provenance:** item 6 below (Hybrid Data Proxy) was introduced in conversation as if it had been previously defined elsewhere in this project. It had not — a search of this spec file at every prior version found no mention of the term. It is recorded here as a **newly proposed** roadmap item, not a recovered one. This distinction matters: a claim that something was "already agreed" should be verified against the actual record before being treated as settled, the same discipline applied to every other claim in this project (e.g. the Auth v1.1 Blocker Report that caught a spec-file/reality mismatch). The definition itself is sound on its own merits and is kept below — only the provenance claim is corrected.

The following items are roadmap notes only. **Not frozen interfaces, not implementation directives, not part of any current build.** They exist to guide future design while preserving every currently frozen public API. Building any of these prematurely would repeat the exact mistake already caught and corrected once during Phase 2.5 (an internal refactor built ahead of an explicit "not now" decision) — do not use this roadmap as license to build ahead of a future directive.

### 1. Provider Sandbox Model
Not all providers support testing the same way. Rather than a boolean, a provider may eventually declare a sandbox model:
```
NONE | FLAG | SEPARATE_CREDENTIALS | SEPARATE_PROJECT
```
This lets the dashboard present the correct configuration workflow without provider-specific code. Real-world variation this addresses: Stripe/Paystack need separate test-mode keys; Resend's test mode uses the same key; Convex uses an entirely separate deployment URL. A flat "supports sandbox" boolean can't express this difference.

### 2. Provider Configuration Schema
Each provider may eventually publish a configuration schema describing its required credentials/settings — metadata only (field names, labels, types, validation hints, required/optional, grouping). **Must never contain executable logic, provider behavior, business rules, or application code** — same boundary that keeps Configuration Service itself a pure key-value store with zero business logic (§16). If built, the dashboard could render provider configuration forms directly from this schema, eliminating hardcoded provider-specific pages — this is the single highest-leverage item on this list, since it's what actually lets new providers (Paystack, Convex, etc.) get added without a dashboard code change.

### 3. Provider Capability Metadata
Providers may eventually advertise optional capabilities affecting dashboard presentation: webhook support, OAuth support, health check support, multi-region support, sandbox support. **If a capability is absent, the dashboard hides that feature rather than presenting non-functional UI** — the same "reject, don't fake it" discipline as Storage's checksum rejection and Notifications' `INVALID_CONTENT` — never show a button that doesn't work.

### 4. Credential Lifecycle Metadata
Rotation and disconnect aren't uniform across all possible future providers, even though they are today (both are just `Configuration.setSecret()`/`deleteSecret()` currently). A provider may eventually describe its actual lifecycle:
```
MANUAL | SELF_SERVICE | OAUTH_REFRESH | AUTO_ROTATION
```
Some providers (AWS IAM-style) require creating a new credential before an old one can be revoked; some use OAuth refresh flows; some have no rotation API at all. This metadata affects dashboard workflow only — it never changes Configuration's responsibility for securely storing whatever secret results.

### 5. Routing Modes
The `routing` field is already reserved in Configuration v1.1's Provider Registry (§16), currently always `"DIRECT"`. Future values: `PROXY`, `FAILOVER`, `MIRROR`, `LOCAL`, `EDGE`. No routing behavior is implemented at this stage — the field exists so a future capability doesn't require a breaking schema change later.

### 6. Hybrid Data Proxy (newly proposed — see provenance note above)
An optional routing layer between Codlok Cloud and external providers:
```
Product → Codlok Cloud → Hybrid Data Proxy (optional) → Third-party Provider
```
instead of the current `Product → Codlok Cloud → Third-party Provider`. If built, it must be:
- Enabled/disabled independently, per module, without affecting other modules.
- Enabled for multiple modules simultaneously if desired.
- Never mandatory — `DIRECT` routing remains fully supported indefinitely.
- Invisible to callers — enabling or disabling it changes only the routing layer, never any module's public API or any application code using that module.

### Architectural Principle (applies to all items above, if/when built)
Adding a new provider should eventually require only: (1) a provider adapter, (2) registering provider metadata, (3) a provider configuration schema, (4) configuring credentials, (5) selecting a routing mode (`DIRECT` by default) — never a dashboard redesign, a public API change, or a frozen interface modification. This is the test any future provider-registry enhancement should be measured against.

---

## 25. What Happens Next

**Current status:**
- Core Spec: Frozen (12 rules).
- Nine modules frozen and fully built: Auth, Organizations, Configuration, Mail (v1.2), Storage, Pay, Verify, Notifications, SMS (457/457 tests).
- Dashboard v1.0 (§23): IA decided. Track A (frontend, mock data) approved to build now. Track B (Secret Templates backend) blocked on an undesigned additive Configuration extension.

**Next steps, in order:**
1. Build Dashboard v1.0 Track A per §23 — mock data, no backend dependency. Use the standard Module Build Report format, adapted for frontend (files created, screens built, adherence to the opaque-ID display rule, "Coming Soon" labels honest about undesigned features).
2. Do not build Secret Templates backend wiring. If tempted to, that means Track B (Configuration v1.3 draft for platform-owned templates) needs to happen first — draft → stress-test → freeze, same lifecycle as every other Configuration change.
3. Once real backend integration begins (replacing Track A's mock data with real calls to the nine frozen modules), do it one module's dashboard page at a time, validating each against the real API the same way every backend module was validated against real dependencies before being marked complete.
4. Search, Audit, Jobs/Queue, and AI remain planning-only per §13 — none should be scheduled next by default. Jobs/Queue remains blocked on its unresolved Option A/B fork. Search and Audit have no concrete driving need from any built module yet.
5. Do not pre-specify Search, Audit, Jobs, AI, OpenAPI, SDK, API Explorer, etc. beyond their current placeholder/boundary-level status until a real need drives one of them.

### Agent Prompt Template (reusable per module or dashboard track)

> You are the lead engineer for Codlok Cloud. This document is your only source of truth — check the Spec Version header before starting. Do not invent architecture. Do not add modules or dashboard features beyond what's specified. Do not change API contracts, response formats, or module boundaries. If the specification is unclear, stop and report the ambiguity. If implementation conflicts with the specification, stop, explain the conflict, propose the smallest possible change, and wait for approval. Report using the formats in §15 (backend) or an adapted equivalent (frontend).
