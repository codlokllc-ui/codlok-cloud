/**
 * Codlok Cloud — Organizations Module — Built-in Role Definitions (INTERNAL)
 *
 * Per §12: every workspace is seeded with built-in roles at creation.
 * Built-in roles cannot be deleted or renamed. They are:
 *
 *   owner  — full permissions; required ≥1 per workspace (Last Owner Rule)
 *   admin  — most permissions except ownership:transfer and workspace:delete
 *   member — read-only baseline
 *
 * This file is INTERNAL to the Organizations module.
 */

import type { PermissionKey } from './types';

export const OWNER_PERMISSIONS: PermissionKey[] = [
  'workspace:read',
  'workspace:update',
  'workspace:delete',
  'members:read',
  'members:invite',
  'members:add',
  'members:remove',
  'members:manage_roles',
  'roles:read',
  'roles:manage',
  'invitations:read',
  'invitations:cancel',
  'audit:read',
  'credentials:read',
  'credentials:manage',
  'ownership:transfer',
];

export const ADMIN_PERMISSIONS: PermissionKey[] = [
  'workspace:read',
  'workspace:update',
  'members:read',
  'members:invite',
  'members:add',
  'members:remove',
  'members:manage_roles',
  'roles:read',
  'roles:manage',
  'invitations:read',
  'invitations:cancel',
  'audit:read',
  'credentials:read',
  'credentials:manage',
  // admins cannot transfer ownership or delete the workspace
];

export const MEMBER_PERMISSIONS: PermissionKey[] = [
  'workspace:read',
  'members:read',
  'roles:read',
  'invitations:read',
];

export interface BuiltInRoleDef {
  systemKey: 'owner' | 'admin' | 'member';
  name: string;
  description: string;
  permissions: PermissionKey[];
}

export const BUILT_IN_ROLES: BuiltInRoleDef[] = [
  {
    systemKey: 'owner',
    name: 'Owner',
    description: 'Full control. Required at least one per workspace.',
    permissions: OWNER_PERMISSIONS,
  },
  {
    systemKey: 'admin',
    name: 'Admin',
    description: 'Manage members and roles, but cannot transfer ownership or delete the workspace.',
    permissions: ADMIN_PERMISSIONS,
  },
  {
    systemKey: 'member',
    name: 'Member',
    description: 'Read-only baseline access.',
    permissions: MEMBER_PERMISSIONS,
  },
];
