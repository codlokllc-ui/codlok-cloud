/**
 * Codlok Cloud — Organizations Module — Codlok-Standard Error Codes
 *
 * Per Master Spec §3.6: public interfaces never leak provider-specific
 * errors. Each module translates internal errors into Codlok-standard
 * error codes.
 *
 * Per Master Spec §12 Organizations Public Interface + Mandatory Rules.
 *
 * Namespaced with ORG_ prefix to avoid collision with Auth's codes.
 */

export const OrgErrorCode = {
  // ── Caller authentication / authorization ──────────────────────────────
  // Caller's session could not be verified (token missing, invalid, expired).
  UNAUTHORIZED: 'UNAUTHORIZED',
  // Caller is authenticated but is not a member of the workspace.
  NOT_A_MEMBER: 'NOT_A_MEMBER',
  // Caller is a member but lacks the permission required for the operation.
  FORBIDDEN: 'FORBIDDEN',

  // ── Workspace ──────────────────────────────────────────────────────────
  WORKSPACE_NOT_FOUND: 'WORKSPACE_NOT_FOUND',
  WORKSPACE_ALREADY_EXISTS: 'WORKSPACE_ALREADY_EXISTS',
  WORKSPACE_NAME_REQUIRED: 'WORKSPACE_NAME_REQUIRED',

  // ── Membership ─────────────────────────────────────────────────────────
  ALREADY_A_MEMBER: 'ALREADY_A_MEMBER',
  MEMBER_NOT_FOUND: 'MEMBER_NOT_FOUND',
  LAST_OWNER_CANNOT_LEAVE: 'LAST_OWNER_CANNOT_LEAVE',
  LAST_OWNER_CANNOT_BE_REMOVED: 'LAST_OWNER_CANNOT_BE_REMOVED',
  CANNOT_REMOVE_SELF: 'CANNOT_REMOVE_SELF',

  // ── Ownership transfer ────────────────────────────────────────────────
  // transferOwnership requires explicit confirm=true (per §12 Mandatory Rule 2)
  TRANSFER_REQUIRES_CONFIRMATION: 'TRANSFER_REQUIRES_CONFIRMATION',
  TRANSFER_TARGET_NOT_MEMBER: 'TRANSFER_TARGET_NOT_MEMBER',
  TRANSFER_CALLER_NOT_OWNER: 'TRANSFER_CALLER_NOT_OWNER',

  // ── Roles ──────────────────────────────────────────────────────────────
  ROLE_NOT_FOUND: 'ROLE_NOT_FOUND',
  ROLE_ALREADY_EXISTS: 'ROLE_ALREADY_EXISTS',
  ROLE_NAME_REQUIRED: 'ROLE_NAME_REQUIRED',
  // Cannot delete or modify built-in roles (Owner, Admin, Member).
  BUILT_IN_ROLE_PROTECTED: 'BUILT_IN_ROLE_PROTECTED',
  // assignRole/removeRole target is not a member of the workspace.
  ASSIGN_TARGET_NOT_MEMBER: 'ASSIGN_TARGET_NOT_MEMBER',

  // ── Privilege Escalation Rule (§12 Mandatory Rule 3) ───────────────────
  // Caller tried to assign a role whose permissions are NOT a subset of
  // their own effective permissions.
  PRIVILEGE_ESCALATION: 'PRIVILEGE_ESCALATION',
  // Caller tried to grant/revoke a permission at user level (rejected for v1
  // per §12 Permissions: "roles must remain the single source of truth").
  USER_LEVEL_PERMISSION_REJECTED: 'USER_LEVEL_PERMISSION_REJECTED',

  // ── Invitations ────────────────────────────────────────────────────────
  INVITATION_NOT_FOUND: 'INVITATION_NOT_FOUND',
  INVITATION_ALREADY_PENDING: 'INVITATION_ALREADY_PENDING',
  INVITATION_EXPIRED: 'INVITATION_EXPIRED',
  INVITATION_ALREADY_ACCEPTED: 'INVITATION_ALREADY_ACCEPTED',
  INVITATION_ALREADY_DECLINED: 'INVITATION_ALREADY_DECLINED',
  INVITATION_ALREADY_CANCELLED: 'INVITATION_ALREADY_CANCELLED',
  INVITATION_TOKEN_INVALID: 'INVITATION_TOKEN_INVALID',
  CANNOT_INVITE_SELF: 'CANNOT_INVITE_SELF',

  // ── Permissions ────────────────────────────────────────────────────────
  PERMISSION_NOT_FOUND: 'PERMISSION_NOT_FOUND',

  // ── Identity (delegated to Auth) ───────────────────────────────────────
  // Caller provided a userId that Auth.getUser() could not resolve.
  USER_NOT_FOUND: 'USER_NOT_FOUND',

  // ── Catch-all ──────────────────────────────────────────────────────────
  INTERNAL_ERROR: 'INTERNAL_ERROR',
} as const;

export type OrgErrorCodeValue = (typeof OrgErrorCode)[keyof typeof OrgErrorCode];
