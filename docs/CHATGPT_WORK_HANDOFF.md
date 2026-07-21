# ChatGPT Work Handoff

Recovered from the shared "Sites Deployment Update" conversation on
2026-07-21. This note contains project context only. Credentials from the
shared Google document are intentionally excluded and must not be reused.

## Repository baseline

- Repository: `codlokllc-ui/codlok-cloud`
- Canonical branch: `main`
- GitHub baseline available to Codex: `60759e9`
- `docs/CODLOK_CLOUD_EXECUTION_PLAN_V1.md` remains the canonical execution
  plan.

The GitHub baseline includes the premium landing page, animated sign-in
diagram, animated Codlok rider mark, dashboard authentication fixes, and the
durable Storage control-record and idempotency foundations.

## Unpushed web-work gap

The ChatGPT Work workspace reported later local work ending at commit
`56ce2b9`, but that object was never pushed to GitHub and is not present in the
repository. The conversation reported both 25 and 32 unpushed commits at
different times, so the safe assumption is that all code after `60759e9` must
be reconstructed and verified rather than treated as available.

The last reported web-only implementation added:

- durable shared storage-deletion jobs that survive server restarts;
- worker leases to prevent duplicate processing across servers;
- retry backoff and terminal dead-letter state;
- a protected worker route at `/api/internal/jobs/storage-deletions`;
- a Supabase migration for the shared job state;
- a required `CODLOK_JOB_RUNNER_SECRET` environment variable;
- passing typecheck, lint, and production build at that workspace revision.

No source files or commit objects for that implementation were included in the
shared conversation.

## Continuation point

1. Verify the `60759e9` baseline locally.
2. Reconstruct durable shared jobs using the repository's current Storage and
   Supabase patterns.
3. Add lease, retry, dead-letter, replay, restart, duplicate-request, and
   cross-workspace isolation tests.
4. Run typecheck, lint, full tests, and the production build.
5. Apply the new Supabase migration and configure the worker secret before
   deployment.

The Google Drive document used during the old workflow contains a GitHub
personal access token. Revoke that token and remove it from the document. The
Codex GitHub connector is the authorized repository integration for future
repository work.

## Governance recovered from Build-to-Production Plan v1.1

The attached v1.1 plan remains authoritative for product intent, frozen
architecture principles, build discipline, release evidence, and governance.
Its progress board is historical: repository evidence and the newer canonical
execution plan show that product credentials, gateway policy, quotas, audit
events, observability summaries, and durable Storage foundations were built
after that board was written.

Every feature or provider change must follow this loop:

1. Name the real product need and pilot use case.
2. Draft ownership, contract, permissions, limits, data, and failure behavior.
3. Stress-test isolation, leakage, retries, duplicates, concurrency, outages,
   partial failure, cost abuse, and migration.
4. Freeze the specification before implementation.
5. Implement the smallest complete slice without speculative adjacent work.
6. Run appropriate unit, boundary, regression, security, contract,
   integration, and load verification.
7. Preview the real workflow for user review.
8. Certify against official provider sandbox APIs where a provider is involved.
9. Prove the capability through a real Codlok pilot product.
10. Freeze release evidence, limitations, rollback instructions, and the next
    decision.

No stage advances because its UI looks complete. It advances only when its
exit gate passes. When implementation evidence conflicts with a frozen
specification, stop, write the blocker and evidence, propose the smallest safe
change, obtain review, update and freeze the specification, and only then
resume implementation.

The source hierarchy is:

1. Newest reviewed and frozen decision record for its specific decision.
2. `docs/CODLOK_CLOUD_EXECUTION_PLAN_V1.md` for current sequencing and status.
3. Master specification for architecture and public contracts.
4. `docs/PRODUCT_DEFENSIBILITY_GUARDRAILS.md` for strategic feature evaluation
   and architecture protection.
5. Build-to-Production Plan v1.1 for lifecycle, long-range roadmap, release
   standards, and governance.
6. Historical chat summaries only as supporting context.
