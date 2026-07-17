/**
 * Codlok Cloud — Organizations Module — Permission Catalog (INTERNAL)
 *
 * Defines the immutable set of permissions recognized by Organizations.
 * Permissions are platform constants — users cannot create or delete them.
 * Roles reference permissions by key.
 *
 * This file is INTERNAL to the Organizations module.
 */

import type { Permission } from './types';

/**
 * The complete permission catalog for v1.
 *
 * Naming convention: `<resource>:<action>` (lowercase, colon-separated).
 * Resources: workspace, members, roles, invitations, audit.
 *
 * These permissions are referenced by built-in roles (Owner, Admin, Member)
 * and may be selected for custom roles subject to the Privilege Escalation
 * Rule (§12 Mandatory Rule 3).
 */
export const PERMISSIONS: readonly Permission[] = [
  // ── Workspace ────────────────────────────────────────────────────────
  {
    key: 'workspace:read',
    label: 'View workspace',
    description: 'View workspace metadata, members, roles, and audit log.',
  },
  {
    key: 'workspace:update',
    label: 'Update workspace',
    description: 'Update workspace name, slug, and description.',
  },
  {
    key: 'workspace:delete',
    label: 'Delete workspace',
    description: 'Soft-delete the workspace. Reserved for Owner.',
  },

  // ── Members ──────────────────────────────────────────────────────────
  {
    key: 'members:read',
    label: 'View members',
    description: 'List workspace members and their roles.',
  },
  {
    key: 'members:invite',
    label: 'Invite members',
    description: 'Send invitations to new members.',
  },
  {
    key: 'members:add',
    label: 'Add members directly',
    description: 'Add a member without sending an invitation.',
  },
  {
    key: 'members:remove',
    label: 'Remove members',
    description: 'Remove a member from the workspace.',
  },
  {
    key: 'members:manage_roles',
    label: 'Assign/remove roles',
    description: 'Assign or remove roles on members (subject to Privilege Escalation Rule).',
  },

  // ── Roles ────────────────────────────────────────────────────────────
  {
    key: 'roles:read',
    label: 'View roles',
    description: 'List workspace roles and their permissions.',
  },
  {
    key: 'roles:manage',
    label: 'Manage roles',
    description: 'Create, update, and delete custom roles (subject to Privilege Escalation Rule).',
  },

  // ── Invitations ──────────────────────────────────────────────────────
  {
    key: 'invitations:read',
    label: 'View invitations',
    description: 'List pending and resolved invitations.',
  },
  {
    key: 'invitations:cancel',
    label: 'Cancel invitations',
    description: 'Cancel pending invitations you or others sent.',
  },

  // ── Audit ────────────────────────────────────────────────────────────
  {
    key: 'audit:read',
    label: 'View audit log',
    description: 'View the workspace audit log.',
  },

  {
    key: 'credentials:read',
    label: 'View product credentials',
    description: 'List product credential metadata. Raw keys are never recoverable.',
  },
  {
    key: 'credentials:manage',
    label: 'Manage product credentials',
    description: 'Create, rotate, and revoke workspace product credentials.',
  },

  // ── Ownership ────────────────────────────────────────────────────────
  {
    key: 'ownership:transfer',
    label: 'Transfer ownership',
    description: 'Transfer workspace ownership to another member. Reserved for Owner.',
  },
] as const;

/** Quick lookup by key. */
export const PERMISSION_BY_KEY: Record<string, Permission> = Object.fromEntries(
  PERMISSIONS.map((p) => [p.key, p])
);

/** Returns true iff `key` is a recognized permission. */
export function isValidPermissionKey(key: string): boolean {
  return key in PERMISSION_BY_KEY;
}

/** Returns true iff every key in `keys` is a recognized permission. */
export function allValidPermissionKeys(keys: string[]): boolean {
  return keys.every(isValidPermissionKey);
}
