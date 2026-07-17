# Control Plane and Data Plane Boundary

Codlok begins as one modular deployment, but the security and dependency
boundaries are enforced as if the planes were independently deployable.

## Control plane

The control plane owns workspaces, operator sessions, product credentials,
provider configuration, environment promotion, audit policy, quotas and
provisioning. It may create and revoke authority, but it never processes a
product payment, message, file or verification operation directly.

Control-plane routes will live below `/api/control/v1`. They require a human or
operator session and must never accept a product API key as sufficient
authority.

## Data plane

The data plane owns runtime product calls to Auth, Pay, Mail, Storage, Verify,
Notifications and SMS. Its public routes will live below `/api/data/v1` and
require a workspace-scoped product credential before invoking a module.

The gateway resolves the credential to trusted context:

```text
credential -> workspaceId + environment + scopes + credentialId
```

Clients cannot choose or override the resolved workspace in a request body or
query string. Provider credentials never leave Codlok.

## Failure isolation

- Dashboard failure must not stop authenticated data-plane traffic.
- Control-plane deployments cannot silently change active runtime settings.
- Data-plane code cannot create credentials or promote configuration.
- Every product credential has an environment, scopes, expiry and revocation
  state.
- Raw API keys are returned once; only keyed hashes are retained.

## Initial deployment decision

Both planes remain in the current Next.js modular monolith during the first
gateway stages. Directory boundaries and route prefixes are mandatory now;
physical service separation remains a reversible later decision.
