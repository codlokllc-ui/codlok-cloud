# Codlok Cloud Execution Plan V1

Status: canonical source of truth. Updated 2026-07-17.

## Product goal

Codlok Cloud is the reusable backend and tool control plane for products built
by people or coding agents. Products integrate stable Codlok module contracts;
provider credentials and provider-specific behavior remain inside Codlok.

## Binding architecture decisions

1. Keep a modular monolith initially, with enforceable module boundaries.
2. Separate control-plane authority from data-plane runtime traffic.
3. Human control-plane routes live under `/api/control/v1`.
4. Product data-plane routes live under `/api/data/v1`.
5. A product credential resolves `workspaceId`, environment, scopes and quota.
   Product callers cannot supply or override their workspace identity.
6. Provider adapters implement canonical module contracts; provider-specific
   concepts cannot leak into product applications.
7. Production state must be durable before a write API is exposed.
8. External write operations require idempotency, durable workflow state and
   explicit compensation rules. Distributed work is never described as atomic.
9. Browser roles cannot directly access control-plane tables. Server access is
   least-privilege, audited and protected by row-level security.
10. Secrets, request bodies, recipients, identity documents and raw payment
    details are prohibited from platform logs.

## Completed stages

- Stage 0 baseline freeze and regression suite.
- Control-plane/data-plane boundary.
- Durable Organizations control-plane records.
- Supabase user authentication.
- Product credentials, environments, scopes, expiry, rotation and revocation.
- Gateway authentication, quotas and append-only audit events.
- Safe Monitoring and Logs summaries.
- First protected Storage read operations.

## Current stage: durable shared Storage jobs

Storage write contracts and durable control records are present. The current
frozen implementation slice is `docs/DURABLE_SHARED_JOBS_V1.md`:

- atomically enqueue physical deletion with logical deletion;
- claim work through bounded, fair, expiring database leases;
- retry with bounded backoff and terminal dead-letter state;
- provide workspace-scoped monitoring and owner-only audited replay;
- prove restart, duplicate-worker, retry, and cross-workspace behavior.

After those gates pass, publish canonical Storage operations through
`/api/data/v1/storage/*` with `storage:read` and `storage:write` scopes.

## Remaining execution order

1. Durable Storage writes and deletion jobs.
2. Durable shared jobs, dead-letter handling and operator replay.
3. Protect Pay, Mail, SMS, Verify, Notifications and Auth data-plane routes.
4. Cross-module workflow and compensation standard.
5. Provider certification framework and adapter versioning.
6. Paystack adapter certified against the canonical Pay contract.
7. Configuration promotion, approvals, diffs and rollback.
8. Usage cost attribution, budgets and retry-storm protection.
9. Ingress/egress security, SSRF controls and fixed/private networking options.
10. Workspace database routing, pooling, migrations, backups and noisy-neighbor isolation.
11. Regional placement, residency and backup policy.
12. Break-glass support access with approval, expiry and immutable audit.
13. Agent SDK/CLI/OpenAPI/MCP package and software supply-chain enforcement.
14. Automated workspace provisioning and recovery exercises.
15. Provider routing modes and Hybrid Data Proxy only after DIRECT is proven.

## Release gates for every stage

- module and workspace isolation tests;
- scope and permission denial tests;
- retry, duplicate, timeout and partial-failure tests;
- secret/redaction review;
- type checking, lint, full tests and production build;
- staging deployment and live negative-security check;
- rollback path documented before production promotion.

Historical master specifications are reference material only. If they conflict
with this plan or a newer frozen decision record, this plan and the newer
decision record control execution.
