# Codlok Cloud — Organizations Module v1.0

> **Status:** Built against Master Spec §12 (Organizations Module Specification v1.0 — STATUS: IMPLEMENTATION VALIDATION). Spec Version 1.3.
> **Build Order:** Phase 1 — Organizations (per §13).
> **Validation:** Auth v1.1 interface verified (Auth.verifySession, Auth.getUser both present with signatures matching §10 v1.1). §12 "Depends on" line reads `Auth.verifySession(), Auth.getUser()`. Organizations Spec VALIDATED.

## Purpose

Answers **"what can this authenticated user access, and what can they do?"** Does not authenticate — depends entirely on Auth for identity (per §12).

Per §3.8 (Identity Ownership Rule), Organizations persists `userId` only. Identity attributes (email, etc.) are resolved on-demand via `Auth.getUser(userId)`.

## Dependencies (per §12)

| Dependency | Used for | Public interface |
|---|---|---|
| `Auth.verifySession(accessToken)` | Resolve caller's userId from access token | `Auth` (frozen v1.1) |
| `Auth.getUser(userId)` | Resolve stored userId → identity attributes (email, emailVerified) | `Auth` (frozen v1.1) |
| `Mail.sendInvitationEmail(input)` | Send invitation emails (provisional per Rule 11) | `Mail` (Phase 2 stub) |

All calls go through public interfaces only (§3.3, §3.9). No reach-ins to Auth or Mail internals.

## Public Interface (§12)

Every function returns the StandardResponse shape (§3.6). No exceptions.

### Workspace management
| Function | Inputs | Success `data` | Error codes |
|---|---|---|---|
| `createWorkspace` | `accessToken, { name, description? }` | `Workspace` | `UNAUTHORIZED`, `WORKSPACE_NAME_REQUIRED` |
| `updateWorkspace` | `accessToken, workspaceId, { name?, description? }` | `Workspace` | `UNAUTHORIZED`, `NOT_A_MEMBER`, `FORBIDDEN`, `WORKSPACE_NOT_FOUND`, `WORKSPACE_NAME_REQUIRED` |
| `deleteWorkspace` | `accessToken, workspaceId` | `{}` | `UNAUTHORIZED`, `NOT_A_MEMBER`, `FORBIDDEN`, `WORKSPACE_NOT_FOUND` |
| `getWorkspace` | `accessToken, workspaceId` | `Workspace` | `UNAUTHORIZED`, `NOT_A_MEMBER`, `WORKSPACE_NOT_FOUND` |
| `listWorkspaces` | `accessToken` | `Workspace[]` | `UNAUTHORIZED` |

### Membership
| Function | Inputs | Success `data` | Error codes |
|---|---|---|---|
| `addMember` | `accessToken, workspaceId, targetUserId, roleId` | `Member` | `UNAUTHORIZED`, `NOT_A_MEMBER`, `FORBIDDEN`, `WORKSPACE_NOT_FOUND`, `ROLE_NOT_FOUND`, `ALREADY_A_MEMBER`, `PRIVILEGE_ESCALATION` |
| `removeMember` | `accessToken, workspaceId, targetUserId` | `{}` | `UNAUTHORIZED`, `NOT_A_MEMBER`, `FORBIDDEN`, `MEMBER_NOT_FOUND`, `LAST_OWNER_CANNOT_LEAVE` |
| `transferOwnership` | `accessToken, workspaceId, targetUserId, confirm` | `{}` | `UNAUTHORIZED`, `NOT_A_MEMBER`, `FORBIDDEN`, `TRANSFER_REQUIRES_CONFIRMATION`, `TRANSFER_TARGET_NOT_MEMBER`, `ALREADY_A_MEMBER` |
| `leaveWorkspace` | `accessToken, workspaceId` | `{}` | `UNAUTHORIZED`, `NOT_A_MEMBER`, `LAST_OWNER_CANNOT_LEAVE` |
| `listMembers` | `accessToken, workspaceId` | `Member[]` | `UNAUTHORIZED`, `NOT_A_MEMBER`, `FORBIDDEN` |
| `listMembersWithIdentity` | `accessToken, workspaceId` | `MemberWithIdentity[]` | `UNAUTHORIZED`, `NOT_A_MEMBER`, `FORBIDDEN` |
| `checkAccess` | `userId, workspaceId` | `{ member: boolean }` | _(none — pure query)_ |

### Roles
| Function | Inputs | Success `data` | Error codes |
|---|---|---|---|
| `createRole` | `accessToken, workspaceId, { name, description?, permissions[] }` | `Role` | `UNAUTHORIZED`, `NOT_A_MEMBER`, `FORBIDDEN`, `ROLE_NAME_REQUIRED`, `ROLE_ALREADY_EXISTS`, `PERMISSION_NOT_FOUND`, `PRIVILEGE_ESCALATION` |
| `updateRole` | `accessToken, workspaceId, roleId, { name?, description?, permissions? }` | `Role` | `UNAUTHORIZED`, `NOT_A_MEMBER`, `FORBIDDEN`, `ROLE_NOT_FOUND`, `ROLE_ALREADY_EXISTS`, `BUILT_IN_ROLE_PROTECTED`, `PERMISSION_NOT_FOUND`, `PRIVILEGE_ESCALATION` |
| `deleteRole` | `accessToken, workspaceId, roleId` | `{}` | `UNAUTHORIZED`, `NOT_A_MEMBER`, `FORBIDDEN`, `ROLE_NOT_FOUND`, `BUILT_IN_ROLE_PROTECTED`, `ROLE_ALREADY_EXISTS` (assigned) |
| `assignRole` | `accessToken, workspaceId, targetUserId, roleId` | `{}` | `UNAUTHORIZED`, `NOT_A_MEMBER`, `FORBIDDEN`, `ASSIGN_TARGET_NOT_MEMBER`, `ROLE_NOT_FOUND`, `PRIVILEGE_ESCALATION`, `LAST_OWNER_CANNOT_LEAVE` |
| `removeRole` | `accessToken, workspaceId, targetUserId` | `{}` | `UNAUTHORIZED`, `NOT_A_MEMBER`, `FORBIDDEN`, `ASSIGN_TARGET_NOT_MEMBER`, `LAST_OWNER_CANNOT_LEAVE` |
| `listRoles` | `accessToken, workspaceId` | `Role[]` | `UNAUTHORIZED`, `NOT_A_MEMBER`, `FORBIDDEN` |

### Permissions
| Function | Inputs | Success `data` | Error codes |
|---|---|---|---|
| `listPermissions` | _(none)_ | `Permission[]` | _(none)_ |
| `checkPermission` | `accessToken, workspaceId, targetUserId, permission` | `{ has: boolean }` | `UNAUTHORIZED`, `NOT_A_MEMBER`, `PERMISSION_NOT_FOUND` |

Per §12: there is **no** `grantPermission()` / `revokePermission()` at the user level. Permissions are edited only through role editing. Roles own permissions; users never own permissions directly.

### Invitations
| Function | Inputs | Success `data` | Error codes |
|---|---|---|---|
| `inviteMember` | `accessToken, workspaceId, inviteeUserId, roleId` | `InvitationView` | `UNAUTHORIZED`, `NOT_A_MEMBER`, `FORBIDDEN`, `ROLE_NOT_FOUND`, `CANNOT_INVITE_SELF`, `ALREADY_A_MEMBER`, `INVITATION_ALREADY_PENDING`, `PRIVILEGE_ESCALATION` |
| `acceptInvitation` | `accessToken, token` | `{ workspaceId, invitation }` | `UNAUTHORIZED`, `INVITATION_TOKEN_INVALID`, `INVITATION_EXPIRED`, `INVITATION_ALREADY_ACCEPTED/DECLINED/CANCELLED`, `ALREADY_A_MEMBER`, `ROLE_NOT_FOUND` |
| `declineInvitation` | `accessToken, token` | `InvitationView` | `UNAUTHORIZED`, `INVITATION_TOKEN_INVALID`, `INVITATION_ALREADY_*` |
| `cancelInvitation` | `accessToken, workspaceId, invitationId` | `InvitationView` | `UNAUTHORIZED`, `NOT_A_MEMBER`, `FORBIDDEN`, `INVITATION_NOT_FOUND`, `INVITATION_ALREADY_CANCELLED` |
| `resendInvitation` | `accessToken, workspaceId, invitationId` | `InvitationView` | `UNAUTHORIZED`, `NOT_A_MEMBER`, `FORBIDDEN`, `INVITATION_NOT_FOUND`, `INVITATION_ALREADY_ACCEPTED`, `ALREADY_A_MEMBER` |
| `listInvitations` | `accessToken, workspaceId` | `InvitationView[]` | `UNAUTHORIZED`, `NOT_A_MEMBER`, `FORBIDDEN` |

## Mandatory Rules Enforced (§12)

1. **Last Owner Rule** — `removeMember()`, `leaveWorkspace()`, `assignRole()` (when demoting an Owner) all reject if the target is the sole remaining Owner. Enforced in `internal/operations.ts` via `_requireNotLastOwner` / `_requireNotLastOwnerIfOwner`. Returns `LAST_OWNER_CANNOT_LEAVE`.

2. **Ownership Transfer Rule** — `transferOwnership()` requires `confirm=true` (else `TRANSFER_REQUIRES_CONFIRMATION`). The transfer is audit-logged with action `ownership.transferred` (distinct from `role.assigned`) so it's not reversible through normal role editing. `assignRole()` explicitly refuses to assign the Owner role (`PRIVILEGE_ESCALATION`), forcing all ownership changes through `transferOwnership()`.

3. **Privilege Escalation Rule** — `createRole()`, `updateRole()`, `assignRole()`, `inviteMember()` all check that the target role's permission set is a subset of the caller's effective permissions. Enforced in `internal/operations.ts` via `_requireCanAssignRole` and `isSubset`. Returns `PRIVILEGE_ESCALATION`.

## Internal Architecture

```
src/modules/organizations/
├── index.ts                          ← Public interface (the ONLY thing other modules import)
├── errors.ts                         ← OrgErrorCode enum (Codlok-standard, ORG_ namespace)
├── internal/                         ← INTERNAL — not importable from outside
│   ├── types.ts                      ← Workspace, Member, Role, Invitation, AuditLogEntry, Caller
│   ├── permissions.ts                ← Immutable permission catalog (14 permissions)
│   ├── builtin-roles.ts              ← Owner / Admin / Member definitions
│   ├── store.ts                      ← In-memory store (globalThis singleton; Phase 2 will replace with per-workspace DB per §3.5)
│   └── operations.ts                 ← Pure functions enforcing Mandatory Rules; throw OrgError
└── __tests__/
    └── organizations.test.ts         ← 69 tests (boundary + functional + compliance)
```

### Caller resolution flow

```
HTTP request with Authorization: Bearer <token>
        ↓
Public function (index.ts) calls _resolveCaller(accessToken)
        ↓
Auth.verifySession(accessToken)  ← Auth public interface (§3.3)
        ↓ returns { userId, valid: true }
Caller { userId }
        ↓
Internal operation (internal/operations.ts) enforces rules
        ↓ throws OrgError on failure
_wrap() catches → StandardResponse failure (§3.6)
        ↓
JSON response
```

### Identity resolution flow (§3.8)

```
listMembersWithIdentity(accessToken, workspaceId)
        ↓
listMembers() → Member[] (each has userId only — no email)
        ↓
For each member: Auth.getUser(member.userId)  ← Auth public interface
        ↓ returns { userId, email, emailVerified }
MemberWithIdentity[] (email/emailVerified resolved on-demand, NOT persisted)
```

## Built-in Roles (seeded into every workspace at creation)

| Role | systemKey | Permissions | Notes |
|---|---|---|---|
| Owner | `owner` | All 14 permissions | Required ≥1 per workspace (Last Owner Rule). Cannot be deleted/renamed. |
| Admin | `admin` | All except `workspace:delete`, `ownership:transfer` | Can manage members and roles. |
| Member | `member` | `workspace:read`, `members:read`, `roles:read`, `invitations:read` | Read-only baseline. |

Built-in roles are protected: `updateRole` rejects name/permission changes (`BUILT_IN_ROLE_PROTECTED`); `deleteRole` rejects deletion. Only the description field of a built-in role can be edited.

## Permission Catalog (immutable)

14 permissions across 6 resources:

- **workspace**: `read`, `update`, `delete`
- **members**: `read`, `invite`, `add`, `remove`, `manage_roles`
- **roles**: `read`, `manage`
- **invitations**: `read`, `cancel`
- **audit**: `read`
- **ownership**: `transfer`

Permissions are platform constants — there is no `createPermission()` / `deletePermission()` in the public surface. Custom roles select from this catalog subject to the Privilege Escalation Rule.

## API Routes

Thin wrappers under `/api/organizations/` — call Organizations public functions only, return StandardResponse JSON:

| Route | Method | Maps to |
|---|---|---|
| `/api/organizations/workspaces` | GET, POST | `listWorkspaces`, `createWorkspace` |
| `/api/organizations/workspaces/[id]` | GET, PATCH, DELETE | `getWorkspace`, `updateWorkspace`, `deleteWorkspace` |
| `/api/organizations/workspaces/[id]/members` | GET, POST | `listMembers`, `addMember` |
| `/api/organizations/workspaces/[id]/members/[userId]` | PATCH, DELETE | `assignRole`, `removeMember` |
| `/api/organizations/workspaces/[id]/members-with-identity` | GET | `listMembersWithIdentity` |
| `/api/organizations/workspaces/[id]/roles` | GET, POST | `listRoles`, `createRole` |
| `/api/organizations/workspaces/[id]/roles/[roleId]` | PATCH, DELETE | `updateRole`, `deleteRole` |
| `/api/organizations/workspaces/[id]/invitations` | GET, POST | `listInvitations`, `inviteMember` |
| `/api/organizations/workspaces/[id]/invitations/[invitationId]/[action]` | POST | `cancelInvitation`, `resendInvitation` |
| `/api/organizations/workspaces/[id]/transfer-ownership` | POST | `transferOwnership` |
| `/api/organizations/workspaces/[id]/leave` | POST | `leaveWorkspace` |
| `/api/organizations/workspaces/[id]/check-access` | GET | `checkAccess` |
| `/api/organizations/invitations/accept` | POST | `acceptInvitation` |
| `/api/organizations/invitations/decline` | POST | `declineInvitation` |
| `/api/organizations/permissions` | GET | `listPermissions` |
| `/api/organizations/check-permission` | POST | `checkPermission` |

All routes require `Authorization: Bearer <accessToken>` header (except `permissions` and `check-access`, which take no token).

## Core Spec Compliance Checklist (§12)

- [x] Uses only the standard API response format (§3.6) — enforced by `_wrap()` boundary helper; verified by §3.6 compliance test
- [x] Reads secrets through the Configuration Service — Organizations has no direct provider dependencies; all identity resolution goes through Auth, which itself uses the Configuration Service
- [x] Respects workspace isolation — every operation requires `workspaceId` (except `acceptInvitation`/`declineInvitation` which resolve it from the token); cross-workspace isolation verified by tests
- [x] Exposes only public interfaces — only `index.ts` exportable; `internal/`, `errors.ts` not on public surface; verified by boundary tests
- [x] Does not access other modules' internals — only imports `Auth` and `Mail` from their public `index.ts`; verified by source-inspection compliance test
- [x] Uses Codlok-standard error codes — `OrgErrorCode` enum, all codes UPPER_SNAKE_CASE with `ORG_`-style names; never leaks Auth or Mail error codes
- [x] Follows module boundary rules (§3.3) — Organizations' `internal/` and `errors.ts` never imported by any file outside `src/modules/organizations/`
- [x] Last Owner Rule enforced — verified by 3 tests (cannot remove, cannot leave, cannot demote via assignRole)
- [x] Privilege Escalation Rule enforced — verified by 4 tests (createRole, updateRole, assignRole, assign-Owner-forbidden)
- [x] §3.8 Identity Ownership Rule — Member records persist `userId` only (no email/displayName columns); identity resolved on-demand via `Auth.getUser()`; verified by 2 compliance tests
- [x] §3.9 Data Ownership Rule — Organizations owns Workspaces/Members/Roles/Permissions/Invitations/AuditLog tables; store is private (only test-only `_resetStoreForTesting` escape hatch); verified by compliance test
- [x] Ownership Transfer Rule — `transferOwnership` requires `confirm=true`; audit-logged as `ownership.transferred`; not reversible via `assignRole` (which forbids Owner role); verified by 2 tests

## Test Coverage (Rule 12 — Pre-freeze Test Requirement)

69 tests in `src/modules/organizations/__tests__/organizations.test.ts`:

### Boundary tests (Rule 12)
- Public surface does not expose internal operations (`requireMember`, `requirePermission`, `requireOwner`, `getEffectivePermissions`, `_requireCanAssignRole`)
- Public surface does not expose store helpers (`store`, `_resetStoreForTesting`, ID generators)
- `errors.ts` exports only `OrgErrorCode` (not `OrgError` class)

### Functional tests (full STEP 3 coverage)
- **Workspace lifecycle**: create, update, delete, get, list (6 tests)
- **Membership**: addMember, removeMember, listMembers, checkAccess, leaveWorkspace (8 tests)
- **Last Owner Rule**: cannot leave, cannot be removed (2 tests)
- **transferOwnership**: requires confirmation, success flow, non-owner rejected, audit-logged (4 tests)
- **Roles**: createRole, updateRole, deleteRole, assignRole, removeRole, listRoles, built-in protection (10 tests)
- **Permissions**: listPermissions, checkPermission (Owner has / Member lacks / unknown permission), no user-level grant/revoke (5 tests)
- **Invitations**: inviteMember, acceptInvitation, declineInvitation, cancelInvitation, resendInvitation + edge cases (8 tests)

### Compliance tests (Rule 12)
- §3.6 StandardResponse shape across 12 sample responses
- §3.8 Identity Ownership: Member records have no email/displayName; listMembersWithIdentity resolves via Auth.getUser
- §3.9 Data Ownership: store is private
- §3.3 Module boundary: index.ts imports only from Auth/Mail public surfaces (source inspection)
- Last Owner Rule: cannot remove, cannot demote via assignRole
- Ownership Transfer Rule: audit-logged, not reversible via role editing
- Roles own permissions: no grantPermission/revokePermission/createPermission/deletePermission

### Cross-workspace isolation + unauthorized access
- Member of workspace A cannot access workspace B (getWorkspace, listMembers)
- One identity → many workspaces (§12 Core Model)
- No access token → UNAUTHORIZED
- Invalid access token → UNAUTHORIZED
- Expired access token → UNAUTHORIZED

### Privilege escalation (comprehensive)
- Admin cannot create role with `workspace:delete` (lacks it)
- Admin cannot update role to include `workspace:delete`
- Admin cannot assign Owner role (must use transferOwnership)
- Admin CAN assign a role whose permissions are a subset of Admin (positive test)

## Files Created

```
src/modules/organizations/
├── index.ts                                    ← Public interface (25 functions)
├── errors.ts                                   ← OrgErrorCode enum (30 codes)
├── README.md                                   ← This file
├── internal/
│   ├── types.ts                                ← Workspace, Member, Role, Invitation, AuditLogEntry, Caller
│   ├── permissions.ts                          ← 14-permission immutable catalog
│   ├── builtin-roles.ts                        ← Owner / Admin / Member definitions
│   ├── store.ts                                ← In-memory store (globalThis singleton)
│   └── operations.ts                           ← Pure functions enforcing Mandatory Rules
└── __tests__/
    └── organizations.test.ts                   ← 69 tests

src/app/api/organizations/
├── _helpers.ts                                 ← parseBody, getAccessToken, sendResponse
├── workspaces/route.ts
├── workspaces/[id]/route.ts
├── workspaces/[id]/members/route.ts
├── workspaces/[id]/members/[userId]/route.ts
├── workspaces/[id]/members-with-identity/route.ts
├── workspaces/[id]/roles/route.ts
├── workspaces/[id]/roles/[roleId]/route.ts
├── workspaces/[id]/invitations/route.ts
├── workspaces/[id]/invitations/[invitationId]/[action]/route.ts
├── workspaces/[id]/transfer-ownership/route.ts
├── workspaces/[id]/leave/route.ts
├── workspaces/[id]/check-access/route.ts
├── invitations/accept/route.ts
├── invitations/decline/route.ts
├── permissions/route.ts
└── check-permission/route.ts
```

## Phase 1 Trade-offs

1. **In-memory store** (`internal/store.ts`) — Phase 1 backing; will be replaced per §3.5 (one database per workspace) when Configuration Service / DB provisioning arrives in Phase 2. Store interface is internal, so no public surface change will be needed.

2. **Mail.sendInvitationEmail** is provisional per Rule 11. Organizations calls it through Mail's public interface only. When Mail is built in Phase 2, the interface may be re-validated — Organizations will adapt at that time with no architecture violation.

3. **No separate audit module** — Organizations records audit entries in its own store (`auditLog` array). Per §9, a future `Logs` module (Phase 4) will own audit trails across modules. For v1, Organizations maintains its own audit log to satisfy the Ownership Transfer Rule's audit requirement. When Logs is built, this data may migrate — flagged for Phase 4 review.

## Build Order Status (§13)

- [x] **Phase 1 — Auth** (v1.0 → v1.1; frozen)
- [x] **Phase 1 — Organizations** ← this module (ready for review)
- [ ] Phase 2 — Configuration Service, Mail, Storage, Notify
- [ ] Phase 3 — Pay, AI, Verify
- [ ] Phase 4 — Analytics, Logs, Admin Dashboard
