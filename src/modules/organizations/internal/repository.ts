import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import {
  exportOrganizationRecords,
  importOrganizationRecords,
  type OrganizationRecords,
} from './store';
import type { AuditLogEntry, Invitation, Member, Role, Workspace } from './types';

const EMPTY: OrganizationRecords = { workspaces: [], members: [], roles: [], invitations: [], auditLog: [] };

function client(): SupabaseClient | null {
  if (process.env.NODE_ENV === 'test') return null;
  const url = process.env.SUPABASE_URL;
  const secret = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !secret) return null;
  return createClient(url, secret, { auth: { persistSession: false, autoRefreshToken: false } });
}

const workspaceRow = (w: Workspace) => ({ id: w.id, name: w.name, slug: w.slug, description: w.description ?? null, created_by_user_id: w.createdByUserId, created_at: w.createdAt, updated_at: w.updatedAt, deleted_at: w.deletedAt ?? null });
const roleRow = (r: Role) => ({ id: r.id, workspace_id: r.workspaceId, name: r.name, system_key: r.systemKey ?? null, description: r.description ?? null, permissions: r.permissions, built_in: r.builtIn, created_at: r.createdAt, updated_at: r.updatedAt });
const memberRow = (m: Member) => ({ id: m.id, workspace_id: m.workspaceId, user_id: m.userId, role_id: m.roleId, joined_at: m.joinedAt, created_at: m.createdAt, updated_at: m.updatedAt });
const invitationRow = (i: Invitation) => ({ id: i.id, workspace_id: i.workspaceId, invitee_user_id: i.inviteeUserId, inviter_user_id: i.inviterUserId, role_id: i.roleId, status: i.status, token: i.token, created_at: i.createdAt, expires_at: i.expiresAt, resolved_at: i.resolvedAt ?? null });
const auditRow = (a: AuditLogEntry) => ({ id: a.id, workspace_id: a.workspaceId, action: a.action, actor_user_id: a.actorUserId, occurred_at: a.at, details: a.details });

async function load(db: SupabaseClient): Promise<OrganizationRecords> {
  const [workspaces, roles, members, invitations, audit] = await Promise.all([
    db.from('codlok_workspaces').select('*'), db.from('codlok_workspace_roles').select('*'),
    db.from('codlok_workspace_members').select('*'), db.from('codlok_workspace_invitations').select('*'),
    db.from('codlok_organization_audit').select('*').order('occurred_at'),
  ]);
  const error = workspaces.error ?? roles.error ?? members.error ?? invitations.error ?? audit.error;
  if (error) throw new Error('ORGANIZATION_STATE_LOAD_FAILED');
  return {
    workspaces: (workspaces.data ?? []).map((w) => ({ id: w.id, name: w.name, slug: w.slug, description: w.description ?? undefined, createdByUserId: w.created_by_user_id, createdAt: w.created_at, updatedAt: w.updated_at, deletedAt: w.deleted_at ?? undefined })),
    roles: (roles.data ?? []).map((r) => ({ id: r.id, workspaceId: r.workspace_id, name: r.name, systemKey: r.system_key ?? undefined, description: r.description ?? undefined, permissions: r.permissions, builtIn: r.built_in, createdAt: r.created_at, updatedAt: r.updated_at })),
    members: (members.data ?? []).map((m) => ({ id: m.id, workspaceId: m.workspace_id, userId: m.user_id, roleId: m.role_id, joinedAt: m.joined_at, createdAt: m.created_at, updatedAt: m.updated_at })),
    invitations: (invitations.data ?? []).map((i) => ({ id: i.id, workspaceId: i.workspace_id, inviteeUserId: i.invitee_user_id, inviterUserId: i.inviter_user_id, roleId: i.role_id, status: i.status, token: i.token, createdAt: i.created_at, expiresAt: i.expires_at, resolvedAt: i.resolved_at ?? undefined })),
    auditLog: (audit.data ?? []).map((a) => ({ id: a.id, workspaceId: a.workspace_id, action: a.action, actorUserId: a.actor_user_id, at: a.occurred_at, details: a.details })),
  } as OrganizationRecords;
}

async function upsertChanged(db: SupabaseClient, before: OrganizationRecords, after: OrganizationRecords): Promise<void> {
  const work: Array<{ table: string; rows: Array<Record<string, unknown>> }> = [
    { table: 'codlok_workspaces', rows: after.workspaces.map(workspaceRow) },
    { table: 'codlok_workspace_roles', rows: after.roles.map(roleRow) },
    { table: 'codlok_workspace_members', rows: after.members.map(memberRow) },
    { table: 'codlok_workspace_invitations', rows: after.invitations.map(invitationRow) },
  ];
  for (const { table, rows } of work) {
    if (rows.length) {
      const { error } = await db.from(table).upsert(rows);
      if (error) throw new Error('ORGANIZATION_STATE_SAVE_FAILED');
    }
  }
  const knownAudit = new Set(before.auditLog.map((entry) => entry.id));
  const newAudit = after.auditLog.filter((entry) => !knownAudit.has(entry.id)).map(auditRow);
  if (newAudit.length) {
    const { error } = await db.from('codlok_organization_audit').insert(newAudit);
    if (error) throw new Error('ORGANIZATION_AUDIT_SAVE_FAILED');
  }
  const deletions = [
    ['codlok_workspace_members', before.members, after.members],
    ['codlok_workspace_roles', before.roles, after.roles],
  ] as const;
  for (const [table, oldRows, newRows] of deletions) {
    const retained = new Set(newRows.map((row) => row.id));
    const removed = oldRows.filter((row) => !retained.has(row.id)).map((row) => row.id);
    if (removed.length) {
      const { error } = await db.from(table).delete().in('id', removed);
      if (error) throw new Error('ORGANIZATION_STATE_DELETE_FAILED');
    }
  }
}

const LOCK = Symbol.for('codlok.organizations.repository-lock');
export async function withDurableOrganizationRecords<T>(operation: () => Promise<T> | T): Promise<T> {
  const db = client();
  if (!db) {
    if (process.env.NODE_ENV === 'production') throw new Error('ORGANIZATION_STORE_NOT_CONFIGURED');
    return operation();
  }
  const global = globalThis as Record<symbol, unknown>;
  const previous = (global[LOCK] as Promise<void> | undefined) ?? Promise.resolve();
  let release!: () => void;
  const current = new Promise<void>((resolve) => { release = resolve; });
  global[LOCK] = previous.then(() => current);
  await previous;
  try {
    const durable = await load(db);
    const cached = exportOrganizationRecords();
    const durableIsEmpty = durable.workspaces.length === 0 && durable.members.length === 0;
    const cachedHasData = cached.workspaces.length > 0 || cached.members.length > 0;
    const before = durableIsEmpty && cachedHasData ? EMPTY : durable;
    if (!(durableIsEmpty && cachedHasData)) importOrganizationRecords(durable);
    const result = await operation();
    await upsertChanged(db, before, exportOrganizationRecords());
    return result;
  } finally { release(); }
}
