# Codlok Cloud — Pay Module v1.0

> **Status:** Built against Master Spec §19 (Pay Module Specification v1.0 — STATUS: FROZEN). Spec Version 2.3.
> **Build Order:** Phase 3 — Pay (per §13).
> **Validation:** No frozen module assumes a different Pay shape. Configuration's `MODULE_CATALOG` entry for `pay` was additively extended with `STRIPE_WEBHOOK_SECRET` (was `STRIPE_SECRET_KEY` only — additive change, no breaking impact). All 244 existing tests pass unmodified.

## Purpose

Answers **"how does money move, reliably and safely, regardless of which provider is behind it?"** Pay owns financial facts and transaction lifecycle only — never the business reason money moved.

**Out of scope:** Business meaning of payments, raw card/bank data, authorization decisions, pricing decisions, currency conversion, refund-eligibility decisions.

## Public Interface (§19)

Every function returns StandardResponse (§3.6). No exceptions.

| Function | Inputs | Success `data` | Error codes |
|---|---|---|---|
| `createPayment` | `workspaceId, amountMinorUnits, currency, idempotencyKey` | `{ paymentId, status: "pending", checkoutUrl }` | `INVALID_AMOUNT`, `INVALID_CURRENCY`, `WORKSPACE_NOT_FOUND`, `PROVIDER_NOT_CONFIGURED`, `IDEMPOTENCY_KEY_REQUIRED` |
| `getPayment` | `workspaceId, paymentId` | `{ paymentId, status, amountMinorUnits, currency, createdAt, updatedAt }` | `PAYMENT_NOT_FOUND` |
| `refundPayment` | `workspaceId, paymentId, amountMinorUnits?, idempotencyKey` | `{ refundId, paymentId, status: "refund_pending", amountMinorUnits }` | `PAYMENT_NOT_FOUND`, `PAYMENT_NOT_REFUNDABLE`, `REFUND_EXCEEDS_REMAINING`, `IDEMPOTENCY_KEY_REQUIRED` |
| `listRefunds` | `workspaceId, paymentId` | `{ refunds: [{ refundId, amountMinorUnits, status, createdAt }] }` | `PAYMENT_NOT_FOUND` |
| `getProviderStatus` | `workspaceId` | `{ configured: boolean, provider: string \| null }` | `WORKSPACE_NOT_FOUND` |
| `processWebhook` | `workspaceId, payload, signature` | `{ processed, eventId, deduplicated }` | `PROVIDER_NOT_CONFIGURED`, `WEBHOOK_SIGNATURE_INVALID` |

**Explicitly excluded** (per §19 line 890): any function accepting `entityType`/`entityId`, any function accepting raw card/CVV/bank data, `updatePaymentAmount()` or similar.

## Idempotency — REQUIRED (§19 line 869)

Unlike Mail (where `idempotencyKey` is optional), Pay makes it **REQUIRED** on `createPayment` and `refundPayment`. A duplicate email is an annoyance; a duplicate charge is a real financial loss.

**Idempotency window: PERMANENT (no expiry).**

Rationale: unlike Mail (where a duplicate send after 24h is harmless), a duplicate charge at ANY point in the future is a real financial loss. Idempotency keys are retained indefinitely — there is no window after which a key "expires" and a duplicate charge becomes possible.

- `createPayment`: same `workspaceId` + `idempotencyKey` → returns original `paymentId`, never creates a second charge.
- `refundPayment`: same `workspaceId` + `paymentId` + `idempotencyKey` → returns original `refundId`, never issues a second refund.

## Payment Status State Machine (§19 line 892 — binding)

```
pending → succeeded → refund_pending → refunded (full)
                    → refund_pending → partially_refunded (partial)
       → failed (terminal)
succeeded → disputed (provider-initiated, via webhook only)
```

- `pending → succeeded` / `pending → failed`: driven by provider checkout completing/failing.
- `succeeded → refund_pending → refunded/partially_refunded`: driven by `refundPayment()` + webhook confirmation.
- `succeeded → disputed`: driven exclusively by incoming webhook (chargeback). No public function triggers this.
- `failed` is terminal — never retried in place. Caller calls `createPayment()` again with a new `idempotencyKey`.
- **Financial facts immutable** (§3.12): `amountMinorUnits`, `currency`, `provider`, payer never change after `createPayment()` succeeds. Only `status` transitions.

## PCI Boundary Rule (§19 line 905 — binding)

Pay **never** receives, transmits, logs, or stores raw card numbers, CVVs, or bank account credentials. `createPayment()` returns a `checkoutUrl` pointing to the provider's hosted checkout/tokenization flow (Stripe Checkout, etc.) — the customer enters payment details directly with the provider, never through Codlok's servers.

This keeps Codlok itself outside PCI-DSS scope for card data.

## Pricing Rule (§19 line 859 — binding)

Pay executes **exactly** the `amountMinorUnits` and `currency` it's given — never calculates prices, applies discounts, or performs currency conversion. If a provider's settlement currency differs, Pay may **record** the exchange rate the provider reports as settlement metadata (recording a fact, not computing one).

## Refund Decision Rule (§19 line 862 — binding)

Pay executes refunds when asked and records the result — it **never** decides whether a refund is warranted. Eligibility is the requesting module's decision. Pay has no `checkRefundEligibility()` function.

## Webhook Deduplication (§19 line 908)

Incoming webhooks are received **exclusively** by Pay. Every webhook event is deduplicated by the provider's event ID before processing. A duplicate event is a **true no-op** — not a repeated status transition, not a repeated audit log entry.

- `processWebhook(workspaceId, payload, signature)` verifies the signature, parses the event, checks the dedup index, and applies the status transition if not a duplicate.
- Dedup key: `${provider}:${providerEventId}`.
- Duplicate delivery → `{ processed: false, deduplicated: true }`.

## Internal Architecture

```
src/modules/pay/
├── index.ts                    ← Public interface (§19 functions + processWebhook)
├── README.md                   ← This file
├── internal/
│   ├── errors.ts               ← PayErrorCode enum
│   ├── types.ts                ← PaymentRecord, RefundRecord, WebhookEventRecord, PayProviderAdapter, PayError
│   ├── store.ts                ← In-memory store (globalThis singleton; idempotency indexes; webhook dedup)
│   ├── provider.ts             ← MockPayProvider (test/dev) + StripePayProvider (stub)
│   └── factory.ts              ← resolveProvider() — Configuration integration
└── __tests__/
    └── pay.test.ts             ← 62 tests
```

### Provider Resolution

```
resolveProvider(workspaceId)
    ↓
1. Test override? (_setProviderForTesting) → use injected provider
2. CODELOK_AUTH_USE_MOCK=true? → use dev MockPayProvider
3. Configuration.getSecret(workspaceId, 'STRIPE_SECRET_KEY'/'STRIPE_WEBHOOK_SECRET', 'pay')
   - Both present → StripePayProvider(secretKey, webhookSecret)
   - Missing → null → PROVIDER_NOT_CONFIGURED
```

## Module Interaction (§19 line 917)

- Pay calls `Configuration.getSecret(workspaceId, key)` for provider credentials (`STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET`).
- Pay calls **no other module**.
- Every other module calls Pay's public interface only — never Stripe directly (§2).

## Core Spec Compliance Checklist (§19)

- [x] Uses only the standard API response format (§3.6) — enforced by `_payErrorToResponse` boundary helper; verified by §3.6 compliance test across 8 sample responses
- [x] Reads provider secrets only through `Configuration.getSecret()` — never hardcoded; `resolveProvider()` calls `Configuration.getSecret()` for `STRIPE_SECRET_KEY` and `STRIPE_WEBHOOK_SECRET`
- [x] Respects workspace isolation — no cross-workspace payment access; verified by 3 workspace-isolation tests
- [x] Exposes only public interfaces — `internal/` not on public surface; verified by boundary tests
- [x] Does not access other modules' internals — Pay calls only `Configuration.getSecret()` (no other module)
- [x] Uses Codlok-standard error codes; never leaks raw provider errors to callers — `PayErrorCode` enum; provider errors translated
- [x] No business-reference fields anywhere in Pay's data model (§3.12) — no `entityType`/`entityId`; verified by compliance test
- [x] `idempotencyKey` required (not optional) on `createPayment` and `refundPayment`; duplicate calls return the original record, never a second charge/refund — verified by 5 idempotency tests
- [x] Amounts stored and transmitted as integer minor units — never floating-point decimals — verified by 3 integer-minor-units tests
- [x] Financial facts (amount/currency/payer/provider) immutable after `createPayment()` succeeds — verified by immutability test
- [x] Webhook events deduplicated by provider event ID before processing — verified by 4 webhook dedup tests
- [x] No raw card/bank data ever received, logged, or stored by Pay — verified by 3 PCI compliance tests
- [x] `createPayment`/`refundPayment` execute exactly the amount/currency given — no price calculation, no currency conversion — verified by 3 pricing rule tests
- [x] Pay has no refund-eligibility logic — only executes refunds the caller explicitly requests — verified by 3 refund decision rule tests

## Test Coverage (Rule 12 — Pre-freeze Test Requirement)

62 tests in `src/modules/pay/__tests__/pay.test.ts`:

### Boundary tests (4)
- Public surface exposes §19 functions
- Public surface does NOT expose internals
- No entityType/entityId parameters (§3.12)
- No raw card data functions (PCI Boundary)

### Functional — createPayment (8)
- Success: returns checkoutUrl
- IDEMPOTENCY_KEY_REQUIRED, INVALID_AMOUNT (zero, floating-point), INVALID_CURRENCY (non-ISO, lowercase)
- WORKSPACE_NOT_FOUND, PROVIDER_NOT_CONFIGURED

### Idempotency — createPayment (5)
- Duplicate key returns SAME paymentId
- Duplicate does NOT create a second charge
- Different key creates separate payments
- Same key different workspace is independent
- Idempotency works even with different amount (returns original)

### Functional — getPayment (3)
- Success: returns metadata
- PAYMENT_NOT_FOUND
- Financial facts immutable after createPayment

### Functional — refundPayment (10)
- Full refund, partial refund
- IDEMPOTENCY_KEY_REQUIRED, PAYMENT_NOT_FOUND, PAYMENT_NOT_REFUNDABLE (pending)
- REFUND_EXCEEDS_REMAINING
- Idempotency: duplicate key returns same refundId
- Full refund → "refunded", partial → "partially_refunded"
- Multiple partial refunds + final full → "refunded"

### Functional — listRefunds (3)
- Lists all refunds, PAYMENT_NOT_FOUND, empty list

### Functional — getProviderStatus (2)
- Configured, not configured

### Workspace isolation (3)
- Cross-workspace getPayment/refundPayment/listRefunds → PAYMENT_NOT_FOUND

### Webhook deduplication (5)
- First webhook processes successfully
- Duplicate event ID is a true no-op
- Duplicate does NOT repeat status transition
- Different event IDs processed separately
- Webhook received exclusively by Pay

### PCI compliance (3)
- checkoutUrl points to provider, not Codlok
- No card-accepting functions
- Payment record stores NO card data fields

### State machine (6)
- pending → succeeded, pending → failed (terminal)
- succeeded → refunded (full), partially_refunded (partial)
- succeeded → disputed (webhook only)
- failed is terminal — cannot refund

### Compliance — §3.6 + §3.12 + Pricing + Refund + Integer (9)
- StandardResponse on 8 samples
- No business-reference fields
- No updatePaymentAmount function
- Pricing Rule: exact amount, no calculation function
- Refund Decision Rule: no eligibility function
- Integer minor units: stored as integer, floating-point rejected, JPY works

## Phase 3 Trade-offs

1. **In-memory store** (`internal/store.ts`) — Phase 3 backing; will be replaced with a persistent database per §3.5 when the DB provisioning layer arrives.

2. **StripePayProvider is a stub** — the real Stripe SDK integration (`stripe` npm package) is not implemented in this environment. The `MockPayProvider` is used for all tests and dev mode. Production deployments would install the SDK and implement the methods.

3. **Idempotency is permanent** — idempotency keys are retained indefinitely in the in-memory store. In a persistent database, this would mean idempotency keys never expire (unlike Mail's 24-hour window). This is the correct behavior for financial data — a duplicate charge at any point in the future is a real loss.

4. **No multi-currency conversion** — per §19 line 860, Pay never converts currency. If a provider's settlement currency differs, Pay records the exchange rate the provider reports as metadata, never computes one.

5. **No capture/cancel functions** — per the Platform Freeze Log, v1 does not include separate authorize/capture/cancel flows. `createPayment` creates a pending payment that transitions to `succeeded` or `failed` via webhook.
