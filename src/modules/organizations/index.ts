/**
 * Codlok Cloud — Organizations Module — Public Interface v1.0
 *
 * Per Master Spec §12 Organizations Module Specification v1.0.
 *
 * Purpose: Answers "what can this authenticated user access, and what can
 * they do?" Does not authenticate — depends entirely on Auth for identity.
 *
 * Depends on (per §12 "Depends on"):
 *   - Auth.verifySession(accessToken)  — to resolve the caller's userId
 *   - Auth.getUser(userId)             — to resolve identity attributes
 *   - Mail.sendInvitationEmail(input)  — provisional per Rule 11
 *
 * All calls go through public interfaces only (§3.3, §3.9). No reach-ins
 * to Auth or Mail internals.
 *
 * Every public function returns the StandardResponse shape (§3.6). No
 * exceptions.
 *
 * ----------------------------------------------------------------------------
 * MANDATORY RULES ENFORCED (§12)
 * ----------------------------------------------------------------------------
 * 1. Last Owner Rule — enforced in removeMember/leaveWorkspace/assignRole.
 * 2. Ownership Transfer Rule — enforced in transferOwnership (requires
 *    confirm=true, audit-logged as 'ownership.transferred').
 * 3. Privilege Escalation Rule — enforced in createRole/updateRole/
 *    assignRole/inviteMember (target role's permissions must be a subset
 *    of caller's effective permissions).
 *
 * ----------------------------------------------------------------------------
 * IDENTITY OWNERSHIP (§3.8)
 * ----------------------------------------------------------------------------
 * Organizations persists `userId` only. Identity attributes (email, etc.)
 * are resolved on-demand via Auth.getUser(userId). This is exposed through
 * the `enrichMember` helper and the `listMembersWithIdentity` function —
 * callers should prefer these over raw listMembers when displaying members.
 */

import {
  StandardResponse,
  ok,
  fail,
  WorkspaceContext,
} from '@/shared';
import { Auth } from '@/modules/auth';
import { Mail } from '@/modules/mail';
import {
  OrgErrorCode,
} from './errors';
import {
  OrgError,
  createWorkspace as _createWorkspace,
  updateWorkspace as _updateWorkspace,
  deleteWorkspace as _deleteWorkspace,
  getWorkspace as _getWorkspace,
  listWorkspaces as _listWorkspaces,
  addMember as _addMember,
  removeMember as _removeMember,
  leaveWorkspace as _leaveWorkspace,
  listMembers as _listMembers,
  checkAccess as _checkAccess,
  transferOwnership as _transferOwnership,
  createRole as _createRole,
  updateRole as _updateRole,
  deleteRole as _deleteRole,
  listRoles as _listRoles,
  assignRole as _assignRole,
  removeRole as _removeRole,
  inviteMember as _inviteMember,
  acceptInvitation as _acceptInvitation,
  declineInvitation as _declineInvitation,
  cancelInvitation as _cancelInvitation,
  resendInvitation as _resendInvitation,
  listInvitations as _listInvitations,
  getEffectivePermissions as _getEffectivePermissions,
  requireMember as _requireMember,
} from './internal/operations';
import { PERMISSIONS, PERMISSION_BY_KEY } from './internal/permissions';
import { withDurableOrganizationRecords } from './internal/repository';
import type {
  Workspace,
  Member,
  Role,
  Invitation,
  Permission,
  PermissionKey,
  WorkspaceId,
  RoleId,
  Caller,
} from './internal/types';

// ---------------------------------------------------------------------------
// Public data shapes
// ---------------------------------------------------------------------------

export interface CreateWorkspaceInput {
  name: string;
  description?: string;
}
export interface UpdateWorkspaceInput {
  name?: string;
  description?: string;
}
export interface CreateRoleInput {
  name: string;
  description?: string;
  permissions: PermissionKey[];
}
export interface UpdateRoleInput {
  name?: string;
  description?: string;
  permissions?: PermissionKey[];
}
export interface MemberWithIdentity {
  memberId: string;
  userId: string;
  roleId: RoleId;
  roleName: string;
  joinedAt: string;
  /** Resolved via Auth.getUser (per §3.8). Undefined if Auth could not resolve. */
  email?: string;
  emailVerified?: boolean;
}
export interface InvitationView {
  id: string;
  workspaceId: WorkspaceId;
  inviteeUserId: string;
  inviterUserId: string;
  roleId: RoleId;
  roleName: string;
  status: Invitation['status'];
  createdAt: string;
  expiresAt: string;
  resolvedAt?: string;
  /** Token is only surfaced to: (a) the invitee, (b) the inviter, (c) Owners. */
  token?: string;
}

// ---------------------------------------------------------------------------
// Internal: caller resolution + error translation
// ---------------------------------------------------------------------------

/**
 * Verify the access token via Auth's public interface and return a Caller.
 * Throws OrgError(UNAUTHORIZED) if the session cannot be verified.
 */
async function _resolveCaller(accessToken: string): Promise<Caller> {
  if (!accessToken) {
    throw new OrgError(OrgErrorCode.UNAUTHORIZED, 'Access token is required.');
  }
  const r = await Auth.verifySession(accessToken);
  if (!r.success) {
    throw new OrgError(
      OrgErrorCode.UNAUTHORIZED,
      `Session verification failed: ${r.error.code}.`
    );
  }
  return { userId: r.data.userId };
}

/**
 * Resolve a userId → identity via Auth.getUser (per §3.8).
 * Returns undefined if the user cannot be resolved (e.g. deleted).
 */
async function _resolveIdentity(
  userId: string
): Promise<{ email?: string; emailVerified?: boolean }> {
  const r = await Auth.getUser(userId);
  if (!r.success) return {};
  return { email: r.data.email, emailVerified: r.data.emailVerified };
}

/**
 * Wrap an internal operation so that:
 *  - OrgError → StandardResponse failure with the given code/message
 *  - Unknown Error → StandardResponse failure with INTERNAL_ERROR
 *
 * This is the single boundary that enforces §3.6 at every public function.
 */
async function _wrap<T>(
  fn: () => Promise<T> | T
): Promise<StandardResponse<T>> {
  try {
    const data = await withDurableOrganizationRecords(fn);
    return ok(data);
  } catch (err) {
    if (err instanceof Error && err.name === 'OrgError') {
      const code = (err as { code?: string }).code ?? OrgErrorCode.INTERNAL_ERROR;
      return fail(code, err.message);
    }
    // Never leak unknown error text.
    return fail(
      OrgErrorCode.INTERNAL_ERROR,
      'An internal error occurred.'
    );
  }
}

// ---------------------------------------------------------------------------
// Workspace management
// ---------------------------------------------------------------------------

export async function createWorkspace(
  accessToken: string,
  input: CreateWorkspaceInput,
  _ctx?: WorkspaceContext
): Promise<StandardResponse<Workspace>> {
  return _wrap(async () => {
    const caller = await _resolveCaller(accessToken);
    return _createWorkspace(caller, input);
  });
}

export async function updateWorkspace(
  accessToken: string,
  workspaceId: WorkspaceId,
  patch: UpdateWorkspaceInput,
  _ctx?: WorkspaceContext
): Promise<StandardResponse<Workspace>> {
  return _wrap(async () => {
    const caller = await _resolveCaller(accessToken);
    return _updateWorkspace(caller, workspaceId, patch);
  });
}

export async function deleteWorkspace(
  accessToken: string,
  workspaceId: WorkspaceId,
  _ctx?: WorkspaceContext
): Promise<StandardResponse<Record<string, never>>> {
  return _wrap(async () => {
    const caller = await _resolveCaller(accessToken);
    _deleteWorkspace(caller, workspaceId);
    return {};
  });
}

export async function getWorkspace(
  accessToken: string,
  workspaceId: WorkspaceId,
  _ctx?: WorkspaceContext
): Promise<StandardResponse<Workspace>> {
  return _wrap(async () => {
    const caller = await _resolveCaller(accessToken);
    return _getWorkspace(caller, workspaceId);
  });
}

export async function listWorkspaces(
  accessToken: string,
  _ctx?: WorkspaceContext
): Promise<StandardResponse<Workspace[]>> {
  return _wrap(async () => {
    const caller = await _resolveCaller(accessToken);
    return _listWorkspaces(caller);
  });
}

// ---------------------------------------------------------------------------
// Membership
// ---------------------------------------------------------------------------

export async function addMember(
  accessToken: string,
  workspaceId: WorkspaceId,
  targetUserId: string,
  roleId: RoleId,
  _ctx?: WorkspaceContext
): Promise<StandardResponse<Member>> {
  return _wrap(async () => {
    const caller = await _resolveCaller(accessToken);
    return _addMember(caller, workspaceId, targetUserId, roleId);
  });
}

export async function removeMember(
  accessToken: string,
  workspaceId: WorkspaceId,
  targetUserId: string,
  _ctx?: WorkspaceContext
): Promise<StandardResponse<Record<string, never>>> {
  return _wrap(async () => {
    const caller = await _resolveCaller(accessToken);
    _removeMember(caller, workspaceId, targetUserId);
    return {};
  });
}

export async function transferOwnership(
  accessToken: string,
  workspaceId: WorkspaceId,
  targetUserId: string,
  confirm: boolean,
  _ctx?: WorkspaceContext
): Promise<StandardResponse<Record<string, never>>> {
  return _wrap(async () => {
    const caller = await _resolveCaller(accessToken);
    _transferOwnership(caller, workspaceId, targetUserId, confirm);
    return {};
  });
}

export async function leaveWorkspace(
  accessToken: string,
  workspaceId: WorkspaceId,
  _ctx?: WorkspaceContext
): Promise<StandardResponse<Record<string, never>>> {
  return _wrap(async () => {
    const caller = await _resolveCaller(accessToken);
    _leaveWorkspace(caller, workspaceId);
    return {};
  });
}

export async function listMembers(
  accessToken: string,
  workspaceId: WorkspaceId,
  _ctx?: WorkspaceContext
): Promise<StandardResponse<Member[]>> {
  return _wrap(async () => {
    const caller = await _resolveCaller(accessToken);
    return _listMembers(caller, workspaceId);
  });
}

/**
 * listMembers + identity enrichment. Per §3.8, identity is resolved on-demand
 * via Auth.getUser(userId) rather than persisted. Callers should prefer this
 * function over the raw `listMembers` when displaying members in a UI.
 */
export async function listMembersWithIdentity(
  accessToken: string,
  workspaceId: WorkspaceId,
  _ctx?: WorkspaceContext
): Promise<StandardResponse<MemberWithIdentity[]>> {
  return _wrap(async () => {
    const caller = await _resolveCaller(accessToken);
    const members = _listMembers(caller, workspaceId);
    const out: MemberWithIdentity[] = [];
    for (const m of members) {
      const role = _getRoleForMember(m);
      const identity = await _resolveIdentity(m.userId);
      out.push({
        memberId: m.id,
        userId: m.userId,
        roleId: m.roleId,
        roleName: role?.name ?? 'unknown',
        joinedAt: m.joinedAt,
        email: identity.email,
        emailVerified: identity.emailVerified,
      });
    }
    return out;
  });
}

export async function checkAccess(
  userId: string,
  workspaceId: WorkspaceId,
  _ctx?: WorkspaceContext
): Promise<StandardResponse<{ member: boolean }>> {
  // Per §12, checkAccess does NOT require an access token — it takes a
  // userId and workspaceId directly and returns { member: true/false }.
  // This is by design: checkAccess is used by other modules (e.g. Pay) to
  // verify whether a user belongs to a workspace before performing an
  // operation. The caller module is responsible for having already
  // authenticated the user via Auth.
  return _wrap(() => _checkAccess(userId, workspaceId));
}

// ---------------------------------------------------------------------------
// Roles
// ---------------------------------------------------------------------------

export async function createRole(
  accessToken: string,
  workspaceId: WorkspaceId,
  input: CreateRoleInput,
  _ctx?: WorkspaceContext
): Promise<StandardResponse<Role>> {
  return _wrap(async () => {
    const caller = await _resolveCaller(accessToken);
    return _createRole(caller, workspaceId, input);
  });
}

export async function updateRole(
  accessToken: string,
  workspaceId: WorkspaceId,
  roleId: RoleId,
  patch: UpdateRoleInput,
  _ctx?: WorkspaceContext
): Promise<StandardResponse<Role>> {
  return _wrap(async () => {
    const caller = await _resolveCaller(accessToken);
    return _updateRole(caller, workspaceId, roleId, patch);
  });
}

export async function deleteRole(
  accessToken: string,
  workspaceId: WorkspaceId,
  roleId: RoleId,
  _ctx?: WorkspaceContext
): Promise<StandardResponse<Record<string, never>>> {
  return _wrap(async () => {
    const caller = await _resolveCaller(accessToken);
    _deleteRole(caller, workspaceId, roleId);
    return {};
  });
}

export async function assignRole(
  accessToken: string,
  workspaceId: WorkspaceId,
  targetUserId: string,
  roleId: RoleId,
  _ctx?: WorkspaceContext
): Promise<StandardResponse<Record<string, never>>> {
  return _wrap(async () => {
    const caller = await _resolveCaller(accessToken);
    _assignRole(caller, workspaceId, targetUserId, roleId);
    return {};
  });
}

export async function removeRole(
  accessToken: string,
  workspaceId: WorkspaceId,
  targetUserId: string,
  _ctx?: WorkspaceContext
): Promise<StandardResponse<Record<string, never>>> {
  return _wrap(async () => {
    const caller = await _resolveCaller(accessToken);
    _removeRole(caller, workspaceId, targetUserId);
    return {};
  });
}

export async function listRoles(
  accessToken: string,
  workspaceId: WorkspaceId,
  _ctx?: WorkspaceContext
): Promise<StandardResponse<Role[]>> {
  return _wrap(async () => {
    const caller = await _resolveCaller(accessToken);
    return _listRoles(caller, workspaceId);
  });
}

// ---------------------------------------------------------------------------
// Permissions
// ---------------------------------------------------------------------------

/**
 * List the full permission catalog. Per §12: "permissions are edited only
 * through role editing." This function returns the immutable catalog that
 * roles may select from.
 */
export async function listPermissions(
  _accessToken?: string,
  _ctx?: WorkspaceContext
): Promise<StandardResponse<Permission[]>> {
  return _wrap(() => [...PERMISSIONS]);
}

/**
 * Check whether a user holds a specific permission in a workspace.
 *
 * Per §3.8 Identity Ownership Rule and §12 Privilege Escalation Rule: a
 * user's effective permissions are the union of permissions from all roles
 * they hold in that workspace. (In v1 a member holds exactly one role, so
 * it's just that role's permissions — but the API supports the union
 * semantics for forward compatibility.)
 *
 * This function takes an access token (to verify the caller) and a target
 * userId + permission to check. The caller must be a member of the
 * workspace (so they have a legitimate reason to ask), but they do NOT
 * need to hold the permission being checked (that would make the function
 * useless for self-checks).
 */
export async function checkPermission(
  accessToken: string,
  workspaceId: WorkspaceId,
  targetUserId: string,
  permission: PermissionKey,
  _ctx?: WorkspaceContext
): Promise<StandardResponse<{ has: boolean }>> {
  return _wrap(async () => {
    const caller = await _resolveCaller(accessToken);
    // Caller must be a member of the workspace to query permissions in it.
    _requireMember(caller, workspaceId);
    if (!isValidPermissionKeyPub(permission)) {
      throw new OrgError(
        OrgErrorCode.PERMISSION_NOT_FOUND,
        `Unknown permission: ${permission}.`
      );
    }
    // If target is not a member, they have no permissions.
    const targetMember = _findMemberPub(workspaceId, targetUserId);
    if (!targetMember) {
      return { has: false };
    }
    const perms = _getEffectivePermissions({ userId: targetUserId }, workspaceId);
    return { has: perms.has(permission) };
  });
}

// ---------------------------------------------------------------------------
// Invitations
// ---------------------------------------------------------------------------

export async function inviteMember(
  accessToken: string,
  workspaceId: WorkspaceId,
  inviteeUserId: string,
  roleId: RoleId,
  _ctx?: WorkspaceContext
): Promise<StandardResponse<InvitationView>> {
  return _wrap(async () => {
    const caller = await _resolveCaller(accessToken);
    const inv = _inviteMember(caller, workspaceId, inviteeUserId, roleId);
    // Per §12: inviteMember calls Mail.sendInvitationEmail through Mail's
    // public interface (§17 frozen interface — positional args).
    const ws = _getWorkspace(caller, workspaceId);
    const role = _getRoleById(inv.roleId);
    const inviterIdentity = await _resolveIdentity(caller.userId);
    const inviteUrl = _buildInviteUrl(inv.token);
    // §17 interface: sendInvitationEmail(workspaceId, to, invitationToken,
    // inviterName, workspaceName). invitationToken is the same URL string
    // the provisional stub called inviteUrl — naming change only.
    await Mail.sendInvitationEmail(
      ws.id,
      (await _resolveIdentity(inviteeUserId)).email ?? '',
      inviteUrl,
      inviterIdentity.email ?? '',
      ws.name
    );
    return _toInvitationView(inv, /* includeToken */ true);
    void role;
  });
}

export async function acceptInvitation(
  accessToken: string,
  token: string,
  _ctx?: WorkspaceContext
): Promise<StandardResponse<{ workspaceId: WorkspaceId; invitation: InvitationView }>> {
  return _wrap(async () => {
    const caller = await _resolveCaller(accessToken);
    const { invitation, workspaceId } = _acceptInvitation(caller, token);
    return {
      workspaceId,
      invitation: _toInvitationView(invitation, /* includeToken */ false),
    };
  });
}

export async function declineInvitation(
  accessToken: string,
  token: string,
  _ctx?: WorkspaceContext
): Promise<StandardResponse<InvitationView>> {
  return _wrap(async () => {
    const caller = await _resolveCaller(accessToken);
    const inv = _declineInvitation(caller, token);
    return _toInvitationView(inv, /* includeToken */ false);
  });
}

export async function cancelInvitation(
  accessToken: string,
  workspaceId: WorkspaceId,
  invitationId: string,
  _ctx?: WorkspaceContext
): Promise<StandardResponse<InvitationView>> {
  return _wrap(async () => {
    const caller = await _resolveCaller(accessToken);
    const inv = _cancelInvitation(caller, workspaceId, invitationId);
    return _toInvitationView(inv, /* includeToken */ false);
  });
}

export async function resendInvitation(
  accessToken: string,
  workspaceId: WorkspaceId,
  invitationId: string,
  _ctx?: WorkspaceContext
): Promise<StandardResponse<InvitationView>> {
  return _wrap(async () => {
    const caller = await _resolveCaller(accessToken);
    const inv = _resendInvitation(caller, workspaceId, invitationId);
    // Re-send via Mail (§17 frozen interface — positional args).
    const ws = _getWorkspace(caller, workspaceId);
    const inviterIdentity = await _resolveIdentity(caller.userId);
    const inviteeIdentity = await _resolveIdentity(inv.inviteeUserId);
    // §17 interface: sendInvitationEmail(workspaceId, to, invitationToken,
    // inviterName, workspaceName). invitationToken is the same URL string
    // the provisional stub called inviteUrl — naming change only.
    await Mail.sendInvitationEmail(
      ws.id,
      inviteeIdentity.email ?? '',
      _buildInviteUrl(inv.token),
      inviterIdentity.email ?? '',
      ws.name
    );
    return _toInvitationView(inv, /* includeToken */ true);
  });
}

export async function listInvitations(
  accessToken: string,
  workspaceId: WorkspaceId,
  _ctx?: WorkspaceContext
): Promise<StandardResponse<InvitationView[]>> {
  return _wrap(async () => {
    const caller = await _resolveCaller(accessToken);
    const invs = _listInvitations(caller, workspaceId);
    // Token is only surfaced to inviter + Owners.
    const callerMember = _findMemberPub(workspaceId, caller.userId);
    const ownerRole = _findBuiltInRolePub(workspaceId, 'owner');
    const isOwner = callerMember && ownerRole && callerMember.roleId === ownerRole.id;
    return invs.map((inv) =>
      _toInvitationView(
        inv,
        /* includeToken */ isOwner || inv.inviterUserId === caller.userId
      )
    );
  });
}

// ---------------------------------------------------------------------------
// Internal helpers (still inside the public file — not exported to consumers)
// ---------------------------------------------------------------------------

function _getRoleForMember(m: Member): Role | undefined {
  return _getRoleById(m.roleId);
}

// Re-imports from internal store for read access (kept here so public
// functions don't reach into store directly from outside the module —
// they go through internal/operations which is part of THIS module).
import { store } from './internal/store';
function _getRoleById(roleId: RoleId): Role | undefined {
  return store.getRole(roleId);
}
function _findMemberPub(workspaceId: WorkspaceId, userId: string) {
  return store.findMember(workspaceId, userId);
}
function _findBuiltInRolePub(workspaceId: WorkspaceId, key: 'owner' | 'admin' | 'member') {
  return store.findBuiltInRole(workspaceId, key);
}
function isValidPermissionKeyPub(key: string): boolean {
  return key in PERMISSION_BY_KEY;
}

function _buildInviteUrl(token: string): string {
  const base = process.env.CODELOK_APP_BASE_URL ?? 'http://localhost:3000';
  return `${base}/organizations/invitations/accept?token=${encodeURIComponent(token)}`;
}

function _toInvitationView(
  inv: Invitation,
  includeToken: boolean
): InvitationView {
  const role = _getRoleById(inv.roleId);
  return {
    id: inv.id,
    workspaceId: inv.workspaceId,
    inviteeUserId: inv.inviteeUserId,
    inviterUserId: inv.inviterUserId,
    roleId: inv.roleId,
    roleName: role?.name ?? 'unknown',
    status: inv.status,
    createdAt: inv.createdAt,
    expiresAt: inv.expiresAt,
    resolvedAt: inv.resolvedAt,
    token: includeToken ? inv.token : undefined,
  };
}

// ---------------------------------------------------------------------------
// Public surface (the ONLY thing other modules may import)
// ---------------------------------------------------------------------------

export const Organizations = {
  // Workspace
  createWorkspace,
  updateWorkspace,
  deleteWorkspace,
  getWorkspace,
  listWorkspaces,
  // Membership
  addMember,
  removeMember,
  transferOwnership,
  leaveWorkspace,
  listMembers,
  listMembersWithIdentity,
  checkAccess,
  // Roles
  createRole,
  updateRole,
  deleteRole,
  assignRole,
  removeRole,
  listRoles,
  // Permissions
  listPermissions,
  checkPermission,
  // Invitations
  inviteMember,
  acceptInvitation,
  declineInvitation,
  cancelInvitation,
  resendInvitation,
  listInvitations,
};

export type OrganizationsModule = typeof Organizations;

// Re-export public types for consumers.
export type {
  Workspace,
  Member,
  Role,
  Invitation,
  Permission,
  PermissionKey,
  WorkspaceId,
  RoleId,
};
