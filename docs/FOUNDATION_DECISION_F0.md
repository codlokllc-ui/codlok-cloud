# Foundation Decision F0

Status: frozen for the current execution phase.

Date: 2026-07-22

## Product and workspace

For the current Codlok Cloud architecture, a Product is the dashboard and
caller-facing name for one operational Workspace. `productId` is therefore an
alias of `workspaceId`; no second Product authority or duplicate hierarchy is
introduced.

This alias may be revisited only through a new blocker and migration plan. New
schemas must use `workspace_id` as the durable tenant key.

## Interim database topology

The current shared Supabase Postgres database is an approved interim control
plane. Every durable record must be scoped by `workspace_id`, and operational
configuration must also be scoped by `environment`.

This decision does not cancel the historical one-database-per-workspace goal.
Workspace database routing, pooling, migrations, backups, and noisy-neighbor
isolation remain stage 10 of the current execution plan. Until that stage is
certified, the platform must not claim physical database isolation.

## Runtime classifications

- Production: persistent repositories and real certified providers only.
- Staging: persistent repositories; explicitly protected provider sandboxes or
  blocked writes are permitted.
- Development and test: in-memory repositories and mock providers are allowed
  when explicitly selected.
- Production must fail closed when Supabase, the Configuration master key, or a
  required real provider is unavailable.

`CODELOK_ENVIRONMENT` is the canonical deployment classification and accepts
`development`, `staging`, or `production`. When absent, tests resolve to
development and production Node processes resolve to production.

## Consequence

Durable Configuration is the first implementation stage. Pay, Mail, SMS,
Verify, and Notifications remain blocked from production publication until
their own durable repositories and provider certification gates pass.
