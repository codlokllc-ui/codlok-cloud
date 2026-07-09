/**
 * Codlok Cloud — Organizations Module — In-Memory Store (INTERNAL)
 *
 * Phase 1 backing store for Organizations data. Per §3.5, production will
 * use one database per workspace; this in-memory store stands in until the
 * Configuration Service / DB provisioning is built in Phase 2.
 *
 * Per §3.9 (Data Ownership Rule): Organizations owns these tables. No other
 * module may read or write them. The store is private to this module — only
 * `internal/operations.ts` and `internal/store.ts` reference it.
 *
 * Stored on `globalThis` so all module instances in the Next.js dev-server
 * share the same state. In production builds, module identity is stable.
 *
 * This file is INTERNAL to the Organizations module.
 */

import type {
  Workspace,
  Member,
  Role,
  Invitation,
  AuditLogEntry,
  WorkspaceId,
  RoleId,
} from './types';
import { BUILT_IN_ROLES } from './builtin-roles';

// ---------------------------------------------------------------------------
// Store shape
// ---------------------------------------------------------------------------

interface OrgStore {
  workspaces: Map<string, Workspace>;
  members: Map<string, Member>;            // keyed by memberId
  roles: Map<string, Role>;                // keyed by roleId
  invitations: Map<string, Invitation>;   // keyed by invitationId
  invitationsByToken: Map<string, string>; // token → invitationId
  auditLog: AuditLogEntry[];
  // Indexes for fast lookups
  membersByWorkspace: Map<WorkspaceId, Set<string>>;   // ws → memberIds
  membersByUser: Map<string, Set<string>>;              // userId → memberIds
  rolesByWorkspace: Map<WorkspaceId, Set<RoleId>>;      // ws → roleIds
  invitationsByWorkspace: Map<WorkspaceId, Set<string>>; // ws → invitationIds
  // Slug uniqueness
  slugs: Set<string>;
}

// ---------------------------------------------------------------------------
// globalThis singleton
// ---------------------------------------------------------------------------

const STORE_KEY = Symbol.for('codlok.organizations.store');

function _getStore(): OrgStore {
  const g = globalThis as Record<symbol, unknown>;
  if (!g[STORE_KEY]) {
    g[STORE_KEY] = _createFreshStore();
  }
  return g[STORE_KEY] as OrgStore;
}

function _createFreshStore(): OrgStore {
  return {
    workspaces: new Map(),
    members: new Map(),
    roles: new Map(),
    invitations: new Map(),
    invitationsByToken: new Map(),
    auditLog: [],
    membersByWorkspace: new Map(),
    membersByUser: new Map(),
    rolesByWorkspace: new Map(),
    invitationsByWorkspace: new Map(),
    slugs: new Set(),
  };
}

// ---------------------------------------------------------------------------
// Test-only escape hatch. Production code MUST NOT call this.
// ---------------------------------------------------------------------------

export function _resetStoreForTesting(): void {
  const g = globalThis as Record<symbol, unknown>;
  g[STORE_KEY] = _createFreshStore();
}

// ---------------------------------------------------------------------------
// ID + token generators
// ---------------------------------------------------------------------------

function _newId(prefix: string): string {
  return `${prefix}_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`;
}

export function newWorkspaceId(): string {
  return _newId('ws');
}

export function newMemberId(): string {
  return _newId('member');
}

export function newRoleId(): string {
  return _newId('role');
}

export function newInvitationId(): string {
  return _newId('inv');
}

export function newInvitationToken(): string {
  // Long opaque token — 32 bytes of base36 entropy.
  return `itk_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 14)}${Math.random().toString(36).slice(2, 14)}`;
}

export function newAuditLogId(): string {
  return _newId('audit');
}

// ---------------------------------------------------------------------------
// Read accessors
// ---------------------------------------------------------------------------

export const store = {
  // ── Workspaces ──────────────────────────────────────────────────────
  getWorkspace(id: WorkspaceId): Workspace | undefined {
    return _getStore().workspaces.get(id);
  },
  getWorkspaceBySlug(slug: string): Workspace | undefined {
    for (const ws of _getStore().workspaces.values()) {
      if (ws.slug === slug && !ws.deletedAt) return ws;
    }
    return undefined;
  },
  isSlugTaken(slug: string): boolean {
    return _getStore().slugs.has(slug.toLowerCase());
  },
  addSlug(slug: string): void {
    _getStore().slugs.add(slug.toLowerCase());
  },
  removeSlug(slug: string): void {
    _getStore().slugs.delete(slug.toLowerCase());
  },
  listWorkspacesForUser(userId: string): Workspace[] {
    const memberIds = _getStore().membersByUser.get(userId);
    if (!memberIds) return [];
    const out: Workspace[] = [];
    for (const memberId of memberIds) {
      const m = _getStore().members.get(memberId);
      if (!m) continue;
      const ws = _getStore().workspaces.get(m.workspaceId);
      if (ws && !ws.deletedAt) out.push(ws);
    }
    return out;
  },
  upsertWorkspace(ws: Workspace): void {
    _getStore().workspaces.set(ws.id, ws);
  },
  softDeleteWorkspace(id: WorkspaceId, at: string): void {
    const ws = _getStore().workspaces.get(id);
    if (ws) {
      ws.deletedAt = at;
      ws.updatedAt = at;
    }
  },

  // ── Members ─────────────────────────────────────────────────────────
  getMember(id: string): Member | undefined {
    return _getStore().members.get(id);
  },
  findMember(workspaceId: WorkspaceId, userId: string): Member | undefined {
    const memberIds = _getStore().membersByWorkspace.get(workspaceId);
    if (!memberIds) return undefined;
    for (const memberId of memberIds) {
      const m = _getStore().members.get(memberId);
      if (m && m.userId === userId) return m;
    }
    return undefined;
  },
  listMembers(workspaceId: WorkspaceId): Member[] {
    const memberIds = _getStore().membersByWorkspace.get(workspaceId);
    if (!memberIds) return [];
    const out: Member[] = [];
    for (const memberId of memberIds) {
      const m = _getStore().members.get(memberId);
      if (m) out.push(m);
    }
    return out;
  },
  countOwners(workspaceId: WorkspaceId): number {
    const ownerRoleId = _findBuiltInRoleId(workspaceId, 'owner');
    if (!ownerRoleId) return 0;
    return store.listMembers(workspaceId).filter((m) => m.roleId === ownerRoleId).length;
  },
  insertMember(m: Member): void {
    _getStore().members.set(m.id, m);
    _ensure(_getStore().membersByWorkspace, m.workspaceId).add(m.id);
    _ensure(_getStore().membersByUser, m.userId).add(m.id);
  },
  updateMemberRole(memberId: string, roleId: RoleId, at: string): void {
    const m = _getStore().members.get(memberId);
    if (m) {
      m.roleId = roleId;
      m.updatedAt = at;
    }
  },
  deleteMember(memberId: string): void {
    const m = _getStore().members.get(memberId);
    if (!m) return;
    _getStore().members.delete(memberId);
    const byWs = _getStore().membersByWorkspace.get(m.workspaceId);
    byWs?.delete(memberId);
    const byUser = _getStore().membersByUser.get(m.userId);
    byUser?.delete(memberId);
  },

  // ── Roles ───────────────────────────────────────────────────────────
  getRole(id: RoleId): Role | undefined {
    return _getStore().roles.get(id);
  },
  findRoleByName(workspaceId: WorkspaceId, name: string): Role | undefined {
    const roleIds = _getStore().rolesByWorkspace.get(workspaceId);
    if (!roleIds) return undefined;
    for (const roleId of roleIds) {
      const r = _getStore().roles.get(roleId);
      if (r && r.name.toLowerCase() === name.toLowerCase()) return r;
    }
    return undefined;
  },
  findBuiltInRole(workspaceId: WorkspaceId, systemKey: 'owner' | 'admin' | 'member'): Role | undefined {
    const roleIds = _getStore().rolesByWorkspace.get(workspaceId);
    if (!roleIds) return undefined;
    for (const roleId of roleIds) {
      const r = _getStore().roles.get(roleId);
      if (r && r.systemKey === systemKey) return r;
    }
    return undefined;
  },
  listRoles(workspaceId: WorkspaceId): Role[] {
    const roleIds = _getStore().rolesByWorkspace.get(workspaceId);
    if (!roleIds) return [];
    const out: Role[] = [];
    for (const roleId of roleIds) {
      const r = _getStore().roles.get(roleId);
      if (r) out.push(r);
    }
    return out;
  },
  insertRole(r: Role): void {
    _getStore().roles.set(r.id, r);
    _ensure(_getStore().rolesByWorkspace, r.workspaceId).add(r.id);
  },
  updateRole(id: RoleId, patch: Partial<Pick<Role, 'name' | 'description' | 'permissions'>>, at: string): void {
    const r = _getStore().roles.get(id);
    if (!r) return;
    if (patch.name !== undefined) r.name = patch.name;
    if (patch.description !== undefined) r.description = patch.description;
    if (patch.permissions !== undefined) r.permissions = patch.permissions;
    r.updatedAt = at;
  },
  deleteRole(id: RoleId): void {
    const r = _getStore().roles.get(id);
    if (!r) return;
    _getStore().roles.delete(id);
    const byWs = _getStore().rolesByWorkspace.get(r.workspaceId);
    byWs?.delete(id);
  },

  // ── Invitations ─────────────────────────────────────────────────────
  getInvitation(id: string): Invitation | undefined {
    return _getStore().invitations.get(id);
  },
  getInvitationByToken(token: string): Invitation | undefined {
    const id = _getStore().invitationsByToken.get(token);
    if (!id) return undefined;
    return _getStore().invitations.get(id);
  },
  listInvitations(workspaceId: WorkspaceId): Invitation[] {
    const ids = _getStore().invitationsByWorkspace.get(workspaceId);
    if (!ids) return [];
    const out: Invitation[] = [];
    for (const id of ids) {
      const inv = _getStore().invitations.get(id);
      if (inv) out.push(inv);
    }
    return out;
  },
  findPendingInvitation(workspaceId: WorkspaceId, inviteeUserId: string): Invitation | undefined {
    const ids = _getStore().invitationsByWorkspace.get(workspaceId);
    if (!ids) return undefined;
    for (const id of ids) {
      const inv = _getStore().invitations.get(id);
      if (inv && inv.inviteeUserId === inviteeUserId && inv.status === 'pending') return inv;
    }
    return undefined;
  },
  insertInvitation(inv: Invitation): void {
    _getStore().invitations.set(inv.id, inv);
    _getStore().invitationsByToken.set(inv.token, inv.id);
    _ensure(_getStore().invitationsByWorkspace, inv.workspaceId).add(inv.id);
  },
  updateInvitationStatus(
    id: string,
    status: Invitation['status'],
    at: string
  ): void {
    const inv = _getStore().invitations.get(id);
    if (inv) {
      inv.status = status;
      inv.resolvedAt = at;
    }
  },
  /** Regenerate token + reset expiry (for resendInvitation). */
  refreshInvitation(inv: Invitation, newToken: string, newExpiresAt: string): void {
    const oldToken = inv.token;
    _getStore().invitationsByToken.delete(oldToken);
    inv.token = newToken;
    inv.expiresAt = newExpiresAt;
    inv.status = 'pending';
    inv.resolvedAt = undefined;
    inv.createdAt = new Date().toISOString();
    _getStore().invitationsByToken.set(newToken, inv.id);
  },

  // ── Audit log ───────────────────────────────────────────────────────
  appendAudit(entry: AuditLogEntry): void {
    _getStore().auditLog.push(entry);
    // Cap to prevent unbounded growth in long-running dev sessions.
    if (_getStore().auditLog.length > 5000) {
      _getStore().auditLog.splice(0, 1000);
    }
  },
  listAudit(workspaceId: WorkspaceId, limit = 100): AuditLogEntry[] {
    return _getStore().auditLog
      .filter((e) => e.workspaceId === workspaceId)
      .slice(-limit)
      .reverse();
  },

  // ── Workspace initialization (built-in roles) ──────────────────────
  seedBuiltInRoles(workspaceId: WorkspaceId, at: string): void {
    for (const def of BUILT_IN_ROLES) {
      const role: Role = {
        id: newRoleId(),
        workspaceId,
        name: def.name,
        systemKey: def.systemKey,
        description: def.description,
        permissions: [...def.permissions],
        builtIn: true,
        createdAt: at,
        updatedAt: at,
      };
      store.insertRole(role);
    }
  },
};

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function _ensure<K, V>(m: Map<K, V>, key: K): V {
  let v = m.get(key);
  if (!v) {
    v = (typeof key === 'string' ? new Set<string>() : new Set()) as unknown as V;
    m.set(key, v);
  }
  return v;
}

function _findBuiltInRoleId(workspaceId: WorkspaceId, systemKey: 'owner' | 'admin' | 'member'): string | undefined {
  return store.findBuiltInRole(workspaceId, systemKey)?.id;
}
