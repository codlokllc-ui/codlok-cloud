/**
 * Codlok Cloud — Organizations Module — Internal Operations (INTERNAL)
 *
 * Pure functions that mutate the store. Each operation enforces the
 * relevant Mandatory Rule from §12:
 *
 *   - Last Owner Rule (Rule 1) — enforced in removeMember/leaveWorkspace
 *   - Ownership Transfer Rule (Rule 2) — enforced in transferOwnership
 *   - Privilege Escalation Rule (Rule 3) — enforced in createRole/updateRole/
 *     assignRole
 *
 * Operations throw OrgError (defined below) with a Codlok-standard code.
 * The public interface (index.ts) catches OrgError and returns the
 * StandardResponse failure shape.
 *
 * This file is INTERNAL to the Organizations module.
 */

import type {
  Workspace,
  Member,
  Role,
  Invitation,
  AuditLogEntry,
  AuditAction,
  WorkspaceId,
  RoleId,
  PermissionKey,
  Caller,
} from './types';
import {
  store,
  newWorkspaceId,
  newMemberId,
  newRoleId,
  newInvitationId,
  newInvitationToken,
  newAuditLogId,
} from './store';
import {
  BUILT_IN_ROLES,
  OWNER_PERMISSIONS,
} from './builtin-roles';
import {
  isValidPermissionKey,
  allValidPermissionKeys,
} from './permissions';

// ---------------------------------------------------------------------------
// OrgError — internal exception with Codlok-standard code
// ---------------------------------------------------------------------------

export class OrgError extends Error {
  constructor(
    public readonly code: string,
    message: string
  ) {
    super(message);
    this.name = 'OrgError';
  }
}

// ---------------------------------------------------------------------------
// Helpers: slug, time, audit
// ---------------------------------------------------------------------------

function _slugify(name: string): string {
  return name
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 64) || `ws-${Date.now().toString(36)}`;
}

function _now(): string {
  return new Date().toISOString();
}

function _audit(
  workspaceId: WorkspaceId,
  action: AuditAction,
  actorUserId: string,
  details: Record<string, unknown>
): void {
  const entry: AuditLogEntry = {
    id: newAuditLogId(),
    workspaceId,
    action,
    actorUserId,
    at: _now(),
    details,
  };
  store.appendAudit(entry);
}

// ---------------------------------------------------------------------------
// Caller resolution: verify the caller is a member and resolve their role
// ---------------------------------------------------------------------------

/**
 * Resolve the caller's membership in a workspace. Throws if not a member.
 */
export function requireMember(caller: Caller, workspaceId: WorkspaceId): Member {
  const m = store.findMember(workspaceId, caller.userId);
  if (!m) {
    throw new OrgError('NOT_A_MEMBER', 'Caller is not a member of this workspace.');
  }
  return m;
}

/**
 * Resolve the caller's effective permissions in a workspace.
 * Throws NOT_A_MEMBER if caller isn't a member.
 */
export function getEffectivePermissions(caller: Caller, workspaceId: WorkspaceId): Set<PermissionKey> {
  const member = requireMember(caller, workspaceId);
  const role = store.getRole(member.roleId);
  if (!role) {
    throw new OrgError('INTERNAL_ERROR', 'Member references a non-existent role.');
  }
  return new Set(role.permissions);
}

/**
 * Verify the caller holds a specific permission. Throws FORBIDDEN if not.
 */
export function requirePermission(
  caller: Caller,
  workspaceId: WorkspaceId,
  permission: PermissionKey
): void {
  const perms = getEffectivePermissions(caller, workspaceId);
  if (!perms.has(permission)) {
    throw new OrgError(
      'FORBIDDEN',
      `Caller lacks required permission: ${permission}.`
    );
  }
}

/**
 * Verify the caller is an Owner of the workspace. Throws FORBIDDEN if not.
 */
export function requireOwner(caller: Caller, workspaceId: WorkspaceId): void {
  const member = requireMember(caller, workspaceId);
  const ownerRole = store.findBuiltInRole(workspaceId, 'owner');
  if (!ownerRole || member.roleId !== ownerRole.id) {
    throw new OrgError('FORBIDDEN', 'Caller is not an Owner of this workspace.');
  }
}

// ---------------------------------------------------------------------------
// Subset check (for Privilege Escalation Rule)
// ---------------------------------------------------------------------------

/**
 * Returns true iff `candidate` is a subset of `owned`.
 * Empty candidate is a subset of any set (assigning a no-permission role
 * is allowed — it's not an escalation).
 */
export function isSubset<T>(candidate: Iterable<T>, owned: Set<T>): boolean {
  for (const c of candidate) {
    if (!owned.has(c)) return false;
  }
  return true;
}

// ---------------------------------------------------------------------------
// Workspace operations
// ---------------------------------------------------------------------------

export function createWorkspace(
  caller: Caller,
  input: { name: string; description?: string }
): Workspace {
  if (!input.name || !input.name.trim()) {
    throw new OrgError('WORKSPACE_NAME_REQUIRED', 'Workspace name is required.');
  }
  const at = _now();
  const id = newWorkspaceId();
  let slug = _slugify(input.name);
  // Ensure slug uniqueness.
  let suffix = 1;
  while (store.isSlugTaken(slug)) {
    slug = _slugify(`${input.name} ${suffix++}`);
  }
  const ws: Workspace = {
    id,
    name: input.name.trim(),
    slug,
    description: input.description?.trim() || undefined,
    createdByUserId: caller.userId,
    createdAt: at,
    updatedAt: at,
  };
  store.upsertWorkspace(ws);
  store.addSlug(slug);
  // Seed built-in roles.
  store.seedBuiltInRoles(id, at);
  // Add caller as initial Owner.
  const ownerRole = store.findBuiltInRole(id, 'owner');
  if (!ownerRole) {
    throw new OrgError('INTERNAL_ERROR', 'Failed to seed Owner role.');
  }
  const member: Member = {
    id: newMemberId(),
    workspaceId: id,
    userId: caller.userId,
    roleId: ownerRole.id,
    joinedAt: at,
    createdAt: at,
    updatedAt: at,
  };
  store.insertMember(member);
  _audit(id, 'workspace.created', caller.userId, { name: ws.name, slug });
  _audit(id, 'member.added', caller.userId, { userId: caller.userId, roleName: 'Owner' });
  return ws;
}

export function updateWorkspace(
  caller: Caller,
  workspaceId: WorkspaceId,
  patch: { name?: string; description?: string }
): Workspace {
  requirePermission(caller, workspaceId, 'workspace:update');
  const ws = store.getWorkspace(workspaceId);
  if (!ws || ws.deletedAt) {
    throw new OrgError('WORKSPACE_NOT_FOUND', 'Workspace not found.');
  }
  const at = _now();
  const oldName = ws.name;
  if (patch.name !== undefined) {
    if (!patch.name.trim()) {
      throw new OrgError('WORKSPACE_NAME_REQUIRED', 'Workspace name cannot be empty.');
    }
    // If name changes, regenerate slug (only if slug would change).
    const newSlug = _slugify(patch.name);
    if (newSlug !== ws.slug && store.isSlugTaken(newSlug)) {
      // Don't fail — keep old slug. Slug uniqueness is best-effort on rename.
    } else if (newSlug !== ws.slug) {
      store.removeSlug(ws.slug);
      ws.slug = newSlug;
      store.addSlug(newSlug);
    }
    ws.name = patch.name.trim();
  }
  if (patch.description !== undefined) {
    ws.description = patch.description?.trim() || undefined;
  }
  ws.updatedAt = at;
  store.upsertWorkspace(ws);
  _audit(workspaceId, 'workspace.updated', caller.userId, {
    oldName,
    newName: ws.name,
  });
  return ws;
}

export function deleteWorkspace(caller: Caller, workspaceId: WorkspaceId): void {
  requireOwner(caller, workspaceId);
  requirePermission(caller, workspaceId, 'workspace:delete');
  const ws = store.getWorkspace(workspaceId);
  if (!ws || ws.deletedAt) {
    throw new OrgError('WORKSPACE_NOT_FOUND', 'Workspace not found.');
  }
  const at = _now();
  store.softDeleteWorkspace(workspaceId, at);
  store.removeSlug(ws.slug);
  _audit(workspaceId, 'workspace.deleted', caller.userId, { name: ws.name });
}

export function getWorkspace(caller: Caller, workspaceId: WorkspaceId): Workspace {
  requireMember(caller, workspaceId);
  const ws = store.getWorkspace(workspaceId);
  if (!ws || ws.deletedAt) {
    throw new OrgError('WORKSPACE_NOT_FOUND', 'Workspace not found.');
  }
  return ws;
}

export function listWorkspaces(caller: Caller): Workspace[] {
  return store.listWorkspacesForUser(caller.userId);
}

// ---------------------------------------------------------------------------
// Membership operations
// ---------------------------------------------------------------------------

export function addMember(
  caller: Caller,
  workspaceId: WorkspaceId,
  targetUserId: string,
  roleId: RoleId
): Member {
  requirePermission(caller, workspaceId, 'members:add');
  // Caller must also satisfy privilege escalation for the target role.
  _requireCanAssignRole(caller, workspaceId, roleId);
  const ws = store.getWorkspace(workspaceId);
  if (!ws || ws.deletedAt) {
    throw new OrgError('WORKSPACE_NOT_FOUND', 'Workspace not found.');
  }
  const role = store.getRole(roleId);
  if (!role || role.workspaceId !== workspaceId) {
    throw new OrgError('ROLE_NOT_FOUND', 'Role not found in this workspace.');
  }
  if (store.findMember(workspaceId, targetUserId)) {
    throw new OrgError('ALREADY_A_MEMBER', 'User is already a member of this workspace.');
  }
  const at = _now();
  const member: Member = {
    id: newMemberId(),
    workspaceId,
    userId: targetUserId,
    roleId,
    joinedAt: at,
    createdAt: at,
    updatedAt: at,
  };
  store.insertMember(member);
  _audit(workspaceId, 'member.added', caller.userId, {
    targetUserId,
    roleName: role.name,
  });
  return member;
}

export function removeMember(
  caller: Caller,
  workspaceId: WorkspaceId,
  targetUserId: string
): void {
  requirePermission(caller, workspaceId, 'members:remove');
  const target = store.findMember(workspaceId, targetUserId);
  if (!target) {
    throw new OrgError('MEMBER_NOT_FOUND', 'Target user is not a member of this workspace.');
  }
  // Last Owner Rule: cannot remove the sole owner.
  _requireNotLastOwner(workspaceId, target);
  const targetRole = store.getRole(target.roleId);
  const at = _now();
  store.deleteMember(target.id);
  _audit(workspaceId, 'member.removed', caller.userId, {
    targetUserId,
    roleName: targetRole?.name ?? 'unknown',
  });
}

export function leaveWorkspace(
  caller: Caller,
  workspaceId: WorkspaceId
): void {
  const member = requireMember(caller, workspaceId);
  // Last Owner Rule: cannot leave if sole owner.
  _requireNotLastOwner(workspaceId, member);
  const memberRole = store.getRole(member.roleId);
  const at = _now();
  store.deleteMember(member.id);
  _audit(workspaceId, 'member.left', caller.userId, {
    roleName: memberRole?.name ?? 'unknown',
  });
}

export function listMembers(
  caller: Caller,
  workspaceId: WorkspaceId
): Member[] {
  requirePermission(caller, workspaceId, 'members:read');
  return store.listMembers(workspaceId);
}

export function checkAccess(userId: string, workspaceId: WorkspaceId): { member: boolean } {
  const m = store.findMember(workspaceId, userId);
  return { member: !!m };
}

// ---------------------------------------------------------------------------
// transferOwnership (§12 Mandatory Rule 2)
// ---------------------------------------------------------------------------

export function transferOwnership(
  caller: Caller,
  workspaceId: WorkspaceId,
  targetUserId: string,
  confirm: boolean
): void {
  requireOwner(caller, workspaceId);
  if (!confirm) {
    throw new OrgError(
      'TRANSFER_REQUIRES_CONFIRMATION',
      'transferOwnership requires explicit confirmation (confirm=true).'
    );
  }
  const target = store.findMember(workspaceId, targetUserId);
  if (!target) {
    throw new OrgError(
      'TRANSFER_TARGET_NOT_MEMBER',
      'Transfer target is not a member of this workspace.'
    );
  }
  const ownerRole = store.findBuiltInRole(workspaceId, 'owner');
  if (!ownerRole) {
    throw new OrgError('INTERNAL_ERROR', 'Owner role not found.');
  }
  if (target.roleId === ownerRole.id) {
    throw new OrgError('ALREADY_A_MEMBER', 'Target is already an Owner.');
  }
  const at = _now();
  const previousRoleId = target.roleId;
  const previousRole = store.getRole(previousRoleId);
  // Promote target to Owner.
  store.updateMemberRole(target.id, ownerRole.id, at);
  // Demote caller (previous owner) to the previous role of the target.
  // This ensures the workspace still has at least one Owner (the new one),
  // and the previous Owner steps down to a non-Owner role. The spec says
  // "not reversible through normal role editing" — we record an explicit
  // 'ownership.transferred' audit entry to distinguish from 'role.assigned'.
  const callerMember = store.findMember(workspaceId, caller.userId);
  if (callerMember && callerMember.id !== target.id) {
    store.updateMemberRole(callerMember.id, previousRoleId, at);
  }
  _audit(workspaceId, 'ownership.transferred', caller.userId, {
    fromUserId: caller.userId,
    toUserId: targetUserId,
    callerNewRoleName: previousRole?.name ?? 'unknown',
  });
}

// ---------------------------------------------------------------------------
// Roles
// ---------------------------------------------------------------------------

export function createRole(
  caller: Caller,
  workspaceId: WorkspaceId,
  input: { name: string; description?: string; permissions: PermissionKey[] }
): Role {
  requirePermission(caller, workspaceId, 'roles:manage');
  if (!input.name || !input.name.trim()) {
    throw new OrgError('ROLE_NAME_REQUIRED', 'Role name is required.');
  }
  if (!allValidPermissionKeys(input.permissions)) {
    throw new OrgError('PERMISSION_NOT_FOUND', 'One or more permission keys are invalid.');
  }
  // Privilege Escalation Rule: caller's effective permissions must be a
  // superset of the new role's permissions.
  const callerPerms = getEffectivePermissions(caller, workspaceId);
  if (!isSubset(input.permissions, callerPerms)) {
    throw new OrgError(
      'PRIVILEGE_ESCALATION',
      'Cannot create a role with permissions you do not hold.'
    );
  }
  if (store.findRoleByName(workspaceId, input.name)) {
    throw new OrgError('ROLE_ALREADY_EXISTS', 'A role with this name already exists in this workspace.');
  }
  const at = _now();
  const role: Role = {
    id: newRoleId(),
    workspaceId,
    name: input.name.trim(),
    description: input.description?.trim() || undefined,
    permissions: [...input.permissions],
    builtIn: false,
    createdAt: at,
    updatedAt: at,
  };
  store.insertRole(role);
  _audit(workspaceId, 'role.created', caller.userId, {
    roleId: role.id,
    roleName: role.name,
    permissions: role.permissions,
  });
  return role;
}

export function updateRole(
  caller: Caller,
  workspaceId: WorkspaceId,
  roleId: RoleId,
  patch: { name?: string; description?: string; permissions?: PermissionKey[] }
): Role {
  requirePermission(caller, workspaceId, 'roles:manage');
  const role = store.getRole(roleId);
  if (!role || role.workspaceId !== workspaceId) {
    throw new OrgError('ROLE_NOT_FOUND', 'Role not found in this workspace.');
  }
  if (role.builtIn) {
    // Built-in roles: only description can be edited. Name and permissions
    // are protected to preserve the Last Owner and Privilege Escalation
    // invariants.
    if (patch.name !== undefined && patch.name !== role.name) {
      throw new OrgError('BUILT_IN_ROLE_PROTECTED', 'Built-in role name cannot be changed.');
    }
    if (patch.permissions !== undefined) {
      throw new OrgError('BUILT_IN_ROLE_PROTECTED', 'Built-in role permissions cannot be changed.');
    }
  }
  if (patch.name !== undefined && patch.name.trim() && patch.name !== role.name) {
    if (store.findRoleByName(workspaceId, patch.name)) {
      throw new OrgError('ROLE_ALREADY_EXISTS', 'A role with this name already exists.');
    }
  }
  if (patch.permissions !== undefined) {
    if (!allValidPermissionKeys(patch.permissions)) {
      throw new OrgError('PERMISSION_NOT_FOUND', 'One or more permission keys are invalid.');
    }
    // Privilege Escalation Rule.
    const callerPerms = getEffectivePermissions(caller, workspaceId);
    if (!isSubset(patch.permissions, callerPerms)) {
      throw new OrgError(
        'PRIVILEGE_ESCALATION',
        'Cannot set permissions you do not hold on this role.'
      );
    }
  }
  store.updateRole(roleId, {
    name: patch.name !== undefined ? patch.name.trim() : undefined,
    description: patch.description,
    permissions: patch.permissions,
  }, _now());
  const updated = store.getRole(roleId)!;
  _audit(workspaceId, 'role.updated', caller.userId, {
    roleId,
    roleName: updated.name,
    patch,
  });
  return updated;
}

export function deleteRole(
  caller: Caller,
  workspaceId: WorkspaceId,
  roleId: RoleId
): void {
  requirePermission(caller, workspaceId, 'roles:manage');
  const role = store.getRole(roleId);
  if (!role || role.workspaceId !== workspaceId) {
    throw new OrgError('ROLE_NOT_FOUND', 'Role not found in this workspace.');
  }
  if (role.builtIn) {
    throw new OrgError('BUILT_IN_ROLE_PROTECTED', 'Built-in roles cannot be deleted.');
  }
  // Cannot delete a role currently assigned to any member.
  const assignedCount = store
    .listMembers(workspaceId)
    .filter((m) => m.roleId === roleId).length;
  if (assignedCount > 0) {
    throw new OrgError(
      'ROLE_ALREADY_EXISTS',
      `Role is currently assigned to ${assignedCount} member(s); reassign before deleting.`
    );
  }
  store.deleteRole(roleId);
  _audit(workspaceId, 'role.deleted', caller.userId, { roleId, roleName: role.name });
}

export function listRoles(
  caller: Caller,
  workspaceId: WorkspaceId
): Role[] {
  requirePermission(caller, workspaceId, 'roles:read');
  return store.listRoles(workspaceId);
}

export function assignRole(
  caller: Caller,
  workspaceId: WorkspaceId,
  targetUserId: string,
  roleId: RoleId
): void {
  requirePermission(caller, workspaceId, 'members:manage_roles');
  _requireCanAssignRole(caller, workspaceId, roleId);
  const target = store.findMember(workspaceId, targetUserId);
  if (!target) {
    throw new OrgError('ASSIGN_TARGET_NOT_MEMBER', 'Target user is not a member of this workspace.');
  }
  const role = store.getRole(roleId);
  if (!role || role.workspaceId !== workspaceId) {
    throw new OrgError('ROLE_NOT_FOUND', 'Role not found in this workspace.');
  }
  // Special case: assigning the Owner role via assignRole is forbidden —
  // ownership changes must go through transferOwnership (which is audited
  // distinctly per Rule 2).
  if (role.systemKey === 'owner') {
    throw new OrgError(
      'PRIVILEGE_ESCALATION',
      'Ownership can only be transferred via transferOwnership().'
    );
  }
  // Special case: if target is currently the sole Owner, demoting them via
  // assignRole would violate the Last Owner Rule.
  _requireNotLastOwnerIfOwner(workspaceId, target);
  if (target.roleId === roleId) {
    return; // idempotent
  }
  const previousRoleId = target.roleId;
  store.updateMemberRole(target.id, roleId, _now());
  const previousRole = store.getRole(previousRoleId);
  _audit(workspaceId, 'role.assigned', caller.userId, {
    targetUserId,
    roleId,
    roleName: role.name,
    previousRoleName: previousRole?.name ?? 'unknown',
  });
}

export function removeRole(
  caller: Caller,
  workspaceId: WorkspaceId,
  targetUserId: string
): void {
  // "Remove role" = demote to the workspace's Member role.
  requirePermission(caller, workspaceId, 'members:manage_roles');
  const target = store.findMember(workspaceId, targetUserId);
  if (!target) {
    throw new OrgError('ASSIGN_TARGET_NOT_MEMBER', 'Target user is not a member of this workspace.');
  }
  _requireNotLastOwnerIfOwner(workspaceId, target);
  const memberRole = store.findBuiltInRole(workspaceId, 'member');
  if (!memberRole) {
    throw new OrgError('INTERNAL_ERROR', 'Member role not found.');
  }
  if (target.roleId === memberRole.id) {
    return; // already at Member role
  }
  // Caller must hold all permissions of the Member role (always true since
  // Member permissions are a subset of every other role) — but enforce
  // generally via _requireCanAssignRole for consistency.
  _requireCanAssignRole(caller, workspaceId, memberRole.id);
  const previousRoleId = target.roleId;
  const previousRole = store.getRole(previousRoleId);
  store.updateMemberRole(target.id, memberRole.id, _now());
  _audit(workspaceId, 'role.unassigned', caller.userId, {
    targetUserId,
    previousRoleName: previousRole?.name ?? 'unknown',
    newRoleName: 'Member',
  });
}

// ---------------------------------------------------------------------------
// Invitations
// ---------------------------------------------------------------------------

const INVITATION_TTL_MS = 7 * 24 * 60 * 60 * 1000; // 7 days

export function inviteMember(
  caller: Caller,
  workspaceId: WorkspaceId,
  inviteeUserId: string,
  roleId: RoleId
): Invitation {
  requirePermission(caller, workspaceId, 'members:invite');
  _requireCanAssignRole(caller, workspaceId, roleId);
  if (inviteeUserId === caller.userId) {
    throw new OrgError('CANNOT_INVITE_SELF', 'Cannot invite yourself.');
  }
  const role = store.getRole(roleId);
  if (!role || role.workspaceId !== workspaceId) {
    throw new OrgError('ROLE_NOT_FOUND', 'Role not found in this workspace.');
  }
  if (role.systemKey === 'owner') {
    throw new OrgError(
      'PRIVILEGE_ESCALATION',
      'Ownership can only be transferred via transferOwnership().'
    );
  }
  if (store.findMember(workspaceId, inviteeUserId)) {
    throw new OrgError('ALREADY_A_MEMBER', 'Invitee is already a member of this workspace.');
  }
  // If there's already a pending invitation for this user, reject.
  const pending = store.findPendingInvitation(workspaceId, inviteeUserId);
  if (pending) {
    throw new OrgError('INVITATION_ALREADY_PENDING', 'An invitation is already pending for this user.');
  }
  const at = _now();
  const inv: Invitation = {
    id: newInvitationId(),
    workspaceId,
    inviteeUserId,
    inviterUserId: caller.userId,
    roleId,
    status: 'pending',
    token: newInvitationToken(),
    createdAt: at,
    expiresAt: new Date(Date.now() + INVITATION_TTL_MS).toISOString(),
  };
  store.insertInvitation(inv);
  _audit(workspaceId, 'invitation.sent', caller.userId, {
    invitationId: inv.id,
    inviteeUserId,
    roleName: role.name,
  });
  return inv;
}

export function acceptInvitation(
  caller: Caller,
  token: string
): { invitation: Invitation; workspaceId: WorkspaceId } {
  const inv = store.getInvitationByToken(token);
  if (!inv) {
    throw new OrgError('INVITATION_TOKEN_INVALID', 'Invitation token is invalid.');
  }
  if (inv.status === 'accepted') {
    throw new OrgError('INVITATION_ALREADY_ACCEPTED', 'Invitation has already been accepted.');
  }
  if (inv.status === 'declined') {
    throw new OrgError('INVITATION_ALREADY_DECLINED', 'Invitation has already been declined.');
  }
  if (inv.status === 'cancelled') {
    throw new OrgError('INVITATION_ALREADY_CANCELLED', 'Invitation has been cancelled.');
  }
  if (new Date(inv.expiresAt).getTime() < Date.now()) {
    store.updateInvitationStatus(inv.id, 'expired', _now());
    throw new OrgError('INVITATION_EXPIRED', 'Invitation has expired.');
  }
  // Per §12 Workspace Rules: acceptInvitation resolves the workspace from
  // the token. Caller must match the invitee.
  if (caller.userId !== inv.inviteeUserId) {
    throw new OrgError('UNAUTHORIZED', 'Only the invited user can accept this invitation.');
  }
  if (store.findMember(inv.workspaceId, inv.inviteeUserId)) {
    // Already a member (e.g. via direct addMember while invitation was
    // pending). Mark accepted to clear it.
    store.updateInvitationStatus(inv.id, 'accepted', _now());
    throw new OrgError('ALREADY_A_MEMBER', 'User is already a member of this workspace.');
  }
  const role = store.getRole(inv.roleId);
  if (!role || role.workspaceId !== inv.workspaceId) {
    throw new OrgError('ROLE_NOT_FOUND', 'Invitation references a deleted role.');
  }
  const at = _now();
  const member: Member = {
    id: newMemberId(),
    workspaceId: inv.workspaceId,
    userId: inv.inviteeUserId,
    roleId: inv.roleId,
    joinedAt: at,
    createdAt: at,
    updatedAt: at,
  };
  store.insertMember(member);
  store.updateInvitationStatus(inv.id, 'accepted', at);
  _audit(inv.workspaceId, 'invitation.accepted', caller.userId, {
    invitationId: inv.id,
    roleName: role.name,
  });
  return { invitation: inv, workspaceId: inv.workspaceId };
}

export function declineInvitation(
  caller: Caller,
  token: string
): Invitation {
  const inv = store.getInvitationByToken(token);
  if (!inv) {
    throw new OrgError('INVITATION_TOKEN_INVALID', 'Invitation token is invalid.');
  }
  if (inv.status !== 'pending') {
    throw new OrgError(
      `INVITATION_ALREADY_${inv.status.toUpperCase()}` as keyof typeof OrgError | string,
      `Invitation is already ${inv.status}.`
    );
  }
  if (caller.userId !== inv.inviteeUserId) {
    throw new OrgError('UNAUTHORIZED', 'Only the invited user can decline this invitation.');
  }
  store.updateInvitationStatus(inv.id, 'declined', _now());
  _audit(inv.workspaceId, 'invitation.declined', caller.userId, { invitationId: inv.id });
  return inv;
}

export function cancelInvitation(
  caller: Caller,
  workspaceId: WorkspaceId,
  invitationId: string
): Invitation {
  requirePermission(caller, workspaceId, 'invitations:cancel');
  const inv = store.getInvitation(invitationId);
  if (!inv || inv.workspaceId !== workspaceId) {
    throw new OrgError('INVITATION_NOT_FOUND', 'Invitation not found in this workspace.');
  }
  if (inv.status !== 'pending') {
    throw new OrgError(
      'INVITATION_ALREADY_CANCELLED',
      `Invitation is already ${inv.status}.`
    );
  }
  store.updateInvitationStatus(inv.id, 'cancelled', _now());
  _audit(workspaceId, 'invitation.cancelled', caller.userId, { invitationId: inv.id });
  return inv;
}

export function resendInvitation(
  caller: Caller,
  workspaceId: WorkspaceId,
  invitationId: string
): Invitation {
  requirePermission(caller, workspaceId, 'members:invite');
  const inv = store.getInvitation(invitationId);
  if (!inv || inv.workspaceId !== workspaceId) {
    throw new OrgError('INVITATION_NOT_FOUND', 'Invitation not found in this workspace.');
  }
  // Resend is allowed for pending, expired, declined, or cancelled — anything
  // except already-accepted (in which case the user is already a member).
  if (inv.status === 'accepted') {
    throw new OrgError('INVITATION_ALREADY_ACCEPTED', 'Invitation has already been accepted.');
  }
  if (store.findMember(workspaceId, inv.inviteeUserId)) {
    throw new OrgError('ALREADY_A_MEMBER', 'Invitee is already a member of this workspace.');
  }
  const newToken = newInvitationToken();
  const newExpiresAt = new Date(Date.now() + INVITATION_TTL_MS).toISOString();
  store.refreshInvitation(inv, newToken, newExpiresAt);
  _audit(workspaceId, 'invitation.resent', caller.userId, { invitationId: inv.id });
  return inv;
}

export function listInvitations(
  caller: Caller,
  workspaceId: WorkspaceId
): Invitation[] {
  requirePermission(caller, workspaceId, 'invitations:read');
  return store.listInvitations(workspaceId);
}

// ---------------------------------------------------------------------------
// Internal: Last Owner Rule helpers
// ---------------------------------------------------------------------------

function _requireNotLastOwner(
  workspaceId: WorkspaceId,
  target: Member
): void {
  const ownerRole = store.findBuiltInRole(workspaceId, 'owner');
  if (!ownerRole) return;
  if (target.roleId !== ownerRole.id) return;
  // Target is an Owner. Check if they're the only one.
  const ownerCount = store.countOwners(workspaceId);
  if (ownerCount <= 1) {
    throw new OrgError(
      'LAST_OWNER_CANNOT_LEAVE',
      'Cannot remove the last Owner. Transfer ownership first via transferOwnership().'
    );
  }
}

function _requireNotLastOwnerIfOwner(
  workspaceId: WorkspaceId,
  target: Member
): void {
  // Same as _requireNotLastOwner but with a different error code to
  // distinguish removeMember from assignRole/removeRole contexts.
  const ownerRole = store.findBuiltInRole(workspaceId, 'owner');
  if (!ownerRole) return;
  if (target.roleId !== ownerRole.id) return;
  const ownerCount = store.countOwners(workspaceId);
  if (ownerCount <= 1) {
    throw new OrgError(
      'LAST_OWNER_CANNOT_LEAVE',
      'Cannot demote the last Owner. Transfer ownership first via transferOwnership().'
    );
  }
}

// ---------------------------------------------------------------------------
// Internal: Privilege Escalation Rule helper
// ---------------------------------------------------------------------------

function _requireCanAssignRole(
  caller: Caller,
  workspaceId: WorkspaceId,
  roleId: RoleId
): void {
  const role = store.getRole(roleId);
  if (!role || role.workspaceId !== workspaceId) {
    throw new OrgError('ROLE_NOT_FOUND', 'Role not found in this workspace.');
  }
  const callerPerms = getEffectivePermissions(caller, workspaceId);
  if (!isSubset(role.permissions, callerPerms)) {
    throw new OrgError(
      'PRIVILEGE_ESCALATION',
      'Cannot assign a role with permissions you do not hold.'
    );
  }
}

// Re-export for callers that want to use OWNER_PERMISSIONS directly.
export { OWNER_PERMISSIONS, BUILT_IN_ROLES, isValidPermissionKey };
