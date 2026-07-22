# Platform Persistence Audit V1

Status: accepted; execution governed by `FOUNDATION_DECISION_F0.md`.

Date: 2026-07-22

## Trigger

The protected multi-module data-plane stage exposed memory-backed Pay records.
The blocker loop was widened to verify every current production store, the
live Supabase schema, upstream dependencies, concurrency behavior, provider
readiness, environment isolation, and restart evidence.

Evidence came from current repository code and the connected live Supabase
project. Historical build reports were not treated as proof of current state.

## Verified persistence matrix

| Component | Current production authority | Restart status | Decision |
| --- | --- | --- | --- |
| Auth identity | Supabase Auth | Durable | Keep; reject mock mode in production |
| Organizations | Supabase control-plane tables | Durable but process-local load/mutate/save is not multi-instance safe | Harden before financial publication |
| Configuration | `globalThis` maps for encrypted secrets, settings, flags, versions, and audit | Not durable | First persistence build |
| Product credentials | Supabase `codlok_product_credentials` | Durable | Keep; repair ownership/FK gaps |
| Gateway quotas | Supabase usage windows/RPC | Durable | Keep |
| Gateway audit | Supabase when available, but failures are ignored | Best effort | Financial operations must fail closed or use a durable outbox |
| Gateway idempotency | Supabase, 24-hour retention | Durable for current general writes | Not sufficient for permanent financial idempotency |
| Storage metadata | Supabase `codlok_storage_files` | Durable | Keep |
| Storage deletion jobs | Supabase `codlok_platform_jobs` and atomic enqueue RPC | Durable | Keep |
| Storage objects | Provider-dependent; the advertised Supabase path currently substitutes a mock provider | Not production-certified | Keep protected writes staging-only until certified |
| Pay | Memory maps for payments, refunds, idempotency, and webhook deduplication | Not durable | Block publication |
| Mail | Memory messages and idempotency | Not durable | Block publication |
| SMS | Memory records, routing, idempotency, and webhook deduplication | Not durable | Block publication |
| Verify | Memory sessions, idempotency, and webhook deduplication | Not durable | Block publication |
| Notifications | Memory records/preferences/idempotency; depends on Mail and SMS | Not durable | Block publication |

The connected Supabase project contains durable tables for credentials,
gateway usage/audit, Organizations, Storage metadata, data-plane idempotency,
and platform jobs. It contains no Configuration persistence tables and no
Pay/Mail/SMS/Verify/Notifications operational tables.

## Additional foundation findings

1. Configuration is upstream of every provider-backed module. A restart can
   remove provider secrets and active provider selection while downstream
   records survive.
2. Production Configuration currently permits a deterministic development
   encryption-key fallback when `CODELOK_CONFIG_MASTER_KEY` is absent. It must
   fail closed.
3. Organizations reloads all tenants into process memory and persists changes
   through multiple independent queries. Its lock protects one Node process,
   not multiple instances, and partial writes are possible.
4. A product credential resolves an environment, but Configuration and module
   provider factories are workspace-only. Staging and production can therefore
   resolve the same provider credentials.
5. The current dashboard treats a Codlok Product as a Workspace, while the
   guardrail hierarchy names both Product and Workspace. That alias or a
   separate durable Product resource must be frozen before new operational
   schemas depend on it.
6. Historical master specifications choose one database per workspace. The
   newer canonical execution plan schedules workspace database routing later.
   The permitted interim topology and its production-readiness label must be
   stated explicitly instead of inferred.
7. Pay calls the provider before storing the payment intent. A crash after the
   provider accepts but before the local insert can lose financial truth.
8. The current Stripe Pay adapter does not implement real production payment,
   refund, signature-verification, or webhook operations.
9. Generic gateway idempotency expires after 24 hours. Financial idempotency
   must remain permanent inside Pay and be enforced atomically by the database.

## Corrected execution sequence

### F0 - Ownership, topology, and production-mode freeze

- Freeze whether Product is an alias of Workspace for the current architecture
  or a separate durable resource.
- Record the permitted interim database topology until workspace database
  routing is built.
- Reject all mock adapters and development encryption fallbacks in production.
- Keep existing Storage writes staging-only until the configured object
  provider is real and certified.

Exit gate: every runtime authority and provider has a truthful production,
staging, experimental, or blocked classification; no unknown memory fallback.

### F1 - Durable Configuration

- Add a Configuration-owned repository abstraction.
- Persist encrypted secrets, non-secret settings, feature flags, versions, and
  append-only audit records.
- Scope provider configuration by workspace/product and environment.
- Enforce database uniqueness and optimistic/concurrent update behavior.
- Fail closed in production without database credentials or a valid master key.
- Define encryption key versioning, rotation, recovery, and rollback.

Exit gate: restart, concurrent-update, environment-isolation, audit-redaction,
key-rotation, database-outage, and cross-workspace tests pass.

### F2 - Organizations and authority hardening

- Replace whole-dataset synchronization with row-scoped transactional database
  operations or narrowly scoped RPCs.
- Add missing workspace ownership foreign keys where safe and additive.
- Prove multi-process concurrency, stale-write prevention, partial-failure
  behavior, deletion, invitation, role, and cross-workspace isolation.

Exit gate: restart and concurrent-instance tests prove no lost authority.

### F3 - Gateway environment and audit hardening

- Carry trusted environment/product identity through module invocation.
- Namespace idempotency, quota, audit, and provider resolution correctly.
- Make required financial audit durable and non-silent.
- Re-certify revoked, expired, wrong-environment, wrong-scope, and orphaned
  credentials.

Exit gate: negative-security and audit-failure tests pass.

### S1 - Storage provider certification

- Remove mock substitution from every advertised production provider path.
- Certify one real object provider without changing the frozen Storage public
  contract or durable deletion-job behavior.

Exit gate: real upload/download/delete, restart, timeout, orphan cleanup,
credential rotation, and rollback tests pass in provider sandbox/staging.

### P1 - Durable Pay operation model

- Add an internal `PayRepository`; provider technology stays inside adapters.
- Atomically reserve permanent idempotency and persist payment/refund intent
  before external calls.
- Model submitted, uncertain, reconciled, and terminal outcomes truthfully.
- Enforce uniqueness for workspace/environment/idempotency and provider events.
- Preserve Pay's public provider-neutral interface.

Exit gate: crash injection and simultaneous duplicate tests prove no duplicate
provider operation and no lost financial fact.

### P2 - One real Pay provider and protected publication

- Select and certify one provider; do not build Stripe and Paystack together.
- Implement hosted checkout, refunds, provider idempotency, signed webhooks,
  timeout classification, and reconciliation.
- Publish protected reads first, then writes after provider certification.

Exit gate: sandbox certification, staging negative-security tests, rollback
drill, and pilot-product evidence pass.

Mail, SMS, Verify, and Notifications durability follow using module-owned
repositories and the same certification discipline. Auth data-plane exposure
requires a separate session, redirect, tenant, and abuse threat review.

## Standing durability gate

Every future production module review must answer and prove:

1. What is the authoritative production store?
2. Does production fail closed when it is unavailable or misconfigured?
3. Can a clean process read records created before restart?
4. Are duplicate and concurrency guarantees enforced by database constraints
   or atomic operations rather than only application checks?
5. Are multi-instance races, stale writes, and partial commits tested?
6. Are external-call ambiguity and reconciliation defined?
7. Are workspace/product/environment boundaries present in storage, authority,
   idempotency, quota, audit, and provider resolution?
8. Are secrets, recipients, request bodies, raw provider errors, and financial
   details absent from logs and responses?
9. Is migration apply repeatable, and is rollback or forward recovery proven?
10. Has the capability been tested after restart against the real staging
    database and provider sandbox?

Passing in-memory unit tests is functional evidence only. It is never accepted
as durability evidence.
