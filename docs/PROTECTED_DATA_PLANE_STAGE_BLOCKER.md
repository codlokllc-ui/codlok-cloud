# Protected Multi-Module Data Plane - Stage Blocker

Status: superseded by `docs/PLATFORM_PERSISTENCE_AUDIT_V1.md` after the
required whole-platform persistence review.

Date: 2026-07-22

## Intended stage

Protect Pay, Mail, SMS, Verify, Notifications, and Auth runtime operations
below `/api/data/v1` with workspace-scoped product credentials, explicit
scopes, quotas, audit events, bounded input, and idempotent writes.

## Blocking evidence

The existing module contracts are provider-neutral and workspace-scoped, but
the following production records and safety indexes remain backed by
`globalThis` in-memory maps:

- Pay payments, refunds, idempotency indexes, and webhook deduplication;
- Mail messages and idempotency indexes;
- SMS messages, inbound events, routing, idempotency, and webhook deduplication;
- Verify sessions, idempotency, and webhook deduplication;
- Notifications delivery records and deduplication state.

A process restart can therefore lose operational truth or permit a repeated
external write. Wrapping these modules with the product-credential gateway
would authenticate the caller but would not make the operation durable.

This conflicts with the binding execution-plan rules:

1. production state must be durable before a write API is exposed;
2. external writes require durable idempotency and explicit failure behavior;
3. release evidence must include restart, duplicate, timeout, partial-failure,
   isolation, and rollback verification.

## Rejected shortcut

Do not publish write routes that call the current in-memory stores. Do not use
gateway idempotency as a substitute for durable module-owned records: a
completed gateway response without the corresponding module record would
create inconsistent operational truth.

## Original proposed slice

This Pay-first proposal is retained as evidence of the initial blocker scope.
It is not approved for implementation until the upstream foundation gates in
the platform persistence audit pass.

Start with Pay because duplicate or lost financial operations have the highest
impact and later Paystack certification depends on a durable canonical Pay
contract.

1. Freeze a Pay persistence schema for payments, refunds, permanent
   idempotency keys, and provider webhook deduplication.
2. Add a Pay-owned repository with a durable Supabase implementation and an
   isolated memory implementation for tests only.
3. Preserve the current public Pay contract and provider boundary.
4. Publish these product routes:
   - `POST /api/data/v1/pay/payments` with `pay:write`;
   - `GET /api/data/v1/pay/payments/{paymentId}` with `pay:read`;
   - `POST /api/data/v1/pay/payments/{paymentId}/refunds` with `pay:write`;
   - `GET /api/data/v1/pay/payments/{paymentId}/refunds` with `pay:read`.
5. Derive `workspaceId` only from the product credential. Reject any workspace
   field in a request body or query.
6. Require bounded JSON and an `Idempotency-Key` for both writes. Keep Pay's
   financial idempotency permanent.
7. Keep provider webhooks outside product authentication and require a
   separately frozen provider-signature ingress contract before publishing
   them.
8. Prove restart persistence, duplicate suppression, cross-workspace not-found,
   scope denial, quota denial, redaction, provider timeout, and uncertain
   idempotency-commit behavior.

After this slice passes, apply the same module-owned repository pattern to
Mail, SMS, Verify, and Notifications. Auth already uses durable Supabase
identity state but needs a separate tenant/redirect/session threat review
before product data-plane routes are frozen.

## Rollback boundary

The protected Pay routes remain additive and can be removed without changing
the existing Pay public module contract. The migration must be additive. No
legacy in-memory write route may be promoted as a production fallback.
