/**
 * Codlok Cloud — Organizations Module — Internal Types (INTERNAL)
 *
 * Per Master Spec §3.1: a module owns its internal logic and internal data.
 * Per Master Spec §3.9: Organizations owns Workspaces, Members, Roles,
 * Permissions, Invitations, AuditLog tables. No other module may write to
 * them directly.
 *
 * This file is INTERNAL to the Organizations module. Other modules MUST NOT
 * import it. Only `src/modules/organizations/index.ts` (the public interface)
 * imports from here.
 *
 * Per Master Spec §3.8 (Identity Ownership Rule): Organizations stores
 * `userId` only — NOT email or other identity attributes. Identity is
 * resolved on-demand through Auth.getUser(userId) by the public interface.
 */

// ---------------------------------------------------------------------------
// Permissions
// ---------------------------------------------------------------------------

/**
 * A permission is a granular capability (e.g. "workspace:read",
 * "members:invite", "roles:manage"). Permissions are immutable platform
 * constants — they are NOT created or deleted by users. Roles reference
 * permissions by key.
 *
 * The full permission catalog is defined in `permissions.ts`. This file
 * only defines the type.
 */
export type PermissionKey = string;

export interface Permission {
  key: PermissionKey;
  /** Human-readable label shown in admin UI. */
  label: string;
  /** Longer description. */
  description: string;
}

// ---------------------------------------------------------------------------
// Roles
// ---------------------------------------------------------------------------

export type RoleId = string;

/**
 * A role is a named bundle of permissions assigned to members of a
 * workspace. Per §12: "roles own permissions; users never own permissions
 * directly." There is no per-user permission override.
 *
 * Built-in roles (Owner, Admin, Member) are seeded into every workspace at
 * creation and cannot be deleted or renamed. Custom roles can be created,
 * updated, and deleted by members who hold the `roles:manage` permission
 * (subject to the Privilege Escalation Rule).
 */
export interface Role {
  id: RoleId;
  workspaceId: string;
  name: string;
  /** Stable machine key for built-in roles ('owner', 'admin', 'member'). */
  systemKey?: 'owner' | 'admin' | 'member';
  description?: string;
  /** Permission keys granted by this role. */
  permissions: PermissionKey[];
  builtIn: boolean;
  createdAt: string;
  updatedAt: string;
}

// ---------------------------------------------------------------------------
// Workspaces
// ---------------------------------------------------------------------------

export type WorkspaceId = string;

export interface Workspace {
  id: WorkspaceId;
  name: string;
  slug: string;
  description?: string;
  /** Creator's userId (the initial Owner). */
  createdByUserId: string;
  createdAt: string;
  updatedAt: string;
  /** Soft-delete marker. */
  deletedAt?: string;
}

// ---------------------------------------------------------------------------
// Membership
// ---------------------------------------------------------------------------

export type MemberId = string;

export interface Member {
  id: MemberId;
  workspaceId: WorkspaceId;
  /**
   * The user's global identity — per §3.8 this is the ONLY identity field
   * Organizations persists. Email/displayName/etc. are resolved on demand
   * via Auth.getUser(userId).
   */
  userId: string;
  /** Role currently assigned to this member. */
  roleId: RoleId;
  joinedAt: string;
  createdAt: string;
  updatedAt: string;
}

// ---------------------------------------------------------------------------
// Invitations
// ---------------------------------------------------------------------------

export type InvitationId = string;
export type InvitationToken = string;

export type InvitationStatus =
  | 'pending'
  | 'accepted'
  | 'declined'
  | 'cancelled'
  | 'expired';

export interface Invitation {
  id: InvitationId;
  workspaceId: WorkspaceId;
  /** The userId being invited (resolved from inviteeEmail via Auth). */
  inviteeUserId: string;
  /** The userId who sent the invitation. */
  inviterUserId: string;
  /** Role the invitee will receive on acceptance. */
  roleId: RoleId;
  status: InvitationStatus;
  /** Opaque token used by acceptInvitation/declineInvitation. */
  token: InvitationToken;
  /** ISO timestamp. */
  createdAt: string;
  /** ISO timestamp — invitation expires after this. */
  expiresAt: string;
  /** ISO timestamp of status change (accepted/declined/cancelled). */
  resolvedAt?: string;
}

// ---------------------------------------------------------------------------
// Audit log (for Ownership Transfer Rule and future audit needs)
// ---------------------------------------------------------------------------

export type AuditAction =
  | 'workspace.created'
  | 'workspace.updated'
  | 'workspace.deleted'
  | 'member.added'
  | 'member.removed'
  | 'member.left'
  | 'role.created'
  | 'role.updated'
  | 'role.deleted'
  | 'role.assigned'
  | 'role.unassigned'
  | 'ownership.transferred'
  | 'invitation.sent'
  | 'invitation.resent'
  | 'invitation.accepted'
  | 'invitation.declined'
  | 'invitation.cancelled';

export interface AuditLogEntry {
  id: string;
  workspaceId: WorkspaceId;
  action: AuditAction;
  /** userId who performed the action. */
  actorUserId: string;
  /** ISO timestamp. */
  at: string;
  /** Free-form structured details (target userId, role name, etc.). */
  details: Record<string, unknown>;
}

// ---------------------------------------------------------------------------
// Caller context (passed to internal operations)
// ---------------------------------------------------------------------------

/**
 * Resolved caller — the actor for an operation. `accessToken` is verified
 * via Auth.verifySession() at the public interface boundary, then the
 * resulting userId is passed into internal operations as `callerUserId`.
 *
 * Internal operations NEVER hold the access token. This keeps the token's
 * blast radius confined to the public boundary.
 */
export interface Caller {
  userId: string;
}
