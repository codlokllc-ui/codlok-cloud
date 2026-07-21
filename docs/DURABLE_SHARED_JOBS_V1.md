# Durable Shared Jobs v1

Status: frozen for the Storage physical-deletion implementation slice.

## Product need

Codlok must complete accepted infrastructure work even when a server restarts
or a provider is temporarily unavailable. The first proven consumer is
Storage physical deletion after a file has already been logically deleted.

This is platform infrastructure, not a public business Workflow module. It
must not own product workflow state or create false multi-provider atomicity.

## Scope

This slice provides:

- a server-only, database-backed shared job ledger;
- atomic Storage logical deletion and job enqueue;
- fair batch claiming with expiring worker leases;
- idempotent worker execution;
- bounded exponential retry and terminal dead-letter state;
- safe lease recovery after worker failure or deployment restart;
- workspace-scoped owner monitoring and replay;
- immutable audit evidence for operator replay;
- a secret-protected internal worker endpoint.

Mail, SMS, Notifications, webhooks, generic workflow orchestration, and a
public agent job API remain outside this slice.

## Ownership and data contract

The ledger stores infrastructure facts only:

- `jobId`, `workspaceId`, module, job type, and deduplication key;
- a minimal internal payload with opaque infrastructure identifiers;
- state, attempt limits, schedule, lease, timestamps, and normalized error
  code;
- replay count.

Payloads must never contain credentials, request bodies, recipients, identity
documents, payment details, or raw provider errors.

## State machine

```text
queued -> running -> completed
   ^         |
   |         +-> retry_scheduled -> running
   |         +-> dead_letter
   |
dead_letter -- owner replay --> queued
```

An expired `running` lease is claimable again while attempts remain. An
expired job that exhausted its attempt limit becomes `dead_letter` before new
claims are selected.

## Claim and fairness rules

- Claims use database row locks with `FOR UPDATE SKIP LOCKED`.
- A claim increments `attempt_count`, records a random worker identifier, and
  sets a 60-second lease.
- A worker claims at most 25 jobs per request and at most 2 jobs per workspace
  per batch.
- Claim ordering is due time, creation time, then job ID.
- Multiple workers may run concurrently, but only the current lease owner can
  complete or fail a claimed job.

## Retry and dead-letter rules

- Storage deletion allows 5 total attempts.
- Retry delay is exponential from 30 seconds and capped at 1 hour.
- Only normalized error codes are persisted.
- Provider credentials missing or an unsupported provider configuration are
  retryable until the bounded attempt limit is reached.
- After the final failed attempt, the job becomes `dead_letter` and requires
  owner review.
- Replay is allowed only from `dead_letter`, requires a non-empty reason,
  resets attempt state, increments `replay_count`, and is limited to 5 replays.

## Storage transaction rule

In production, logical deletion and enqueue occur in one database transaction.
The transaction locks the workspace-scoped file row, marks it `DELETED`, and
inserts one deduplicated `storage.physical_delete` job. Repeating the operation
returns success and cannot create a second job.

The worker resolves the provider from server-side Configuration at execution
time, deletes the stored object, then marks both the job and file deletion
state complete. Provider deletion must be safe to repeat.

## Authorization and exposure

- Job tables and functions are server-only and inaccessible to `anon` and
  `authenticated` database roles.
- The internal worker route accepts only `POST` with a bearer secret compared
  in constant time against `CODLOK_JOB_RUNNER_SECRET`.
- The secret is never returned or logged.
- Workspace job listing and replay use human control-plane authentication.
- Listing requires `audit:read`; replay is owner-only.
- Operator responses never expose job payloads, object keys, credentials, or
  raw provider errors.

## Verification gates

The slice cannot advance until tests prove:

- atomic and idempotent deletion enqueue;
- duplicate-worker exclusion and lease-owner enforcement;
- expired-lease recovery;
- bounded retry, backoff, and dead-letter transition;
- owner-only replay, replay limit, and immutable audit evidence;
- workspace-isolated monitoring and cross-workspace denial;
- worker-secret denial and constant-time authentication path;
- no secret or raw provider error in stored or returned data;
- typecheck, lint, full tests, production build, migration advisors, staging
  migration, live worker invocation, and rollback readiness.

## Rollback

Disable scheduled worker calls first, roll the application back, and preserve
the additive job tables for diagnosis. Do not drop queued or dead-letter jobs
during routine rollback. Resume workers only after the compatible application
revision is restored and lease behavior is verified.
