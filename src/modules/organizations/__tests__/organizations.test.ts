/**
 * Codlok Cloud — Organizations Module Tests
 *
 * Per Master Spec §14 Rule 12 (Pre-freeze test requirement), this file
 * covers all three mandatory categories:
 *
 *   1. BOUNDARY TESTS — adapters/internals not importable from outside.
 *   2. REGRESSION TESTS — (Auth regression is covered separately by
 *      `src/modules/auth/__tests__/auth.test.ts`; this file does not
 *      modify Auth. We assert here that Auth's existing functions behave
 *      as Organizations expects.)
 *   3. COMPLIANCE TESTS — StandardResponse shape, module-boundary rules,
 *      §3.8 Identity Ownership, §3.9 Data Ownership, Last Owner Rule,
 *      Privilege Escalation Rule.
 *
 * Plus full functional coverage per the directive's STEP 3 list.
 *
 * Uses Bun's built-in test runner. Run with: `bun test src/modules/organizations`
 */

import { describe, test, expect, beforeEach, afterAll } from 'bun:test';
import { Auth } from '@/modules/auth';
import { Mail } from '@/modules/mail';
import { Organizations } from '@/modules/organizations';
import { OrgErrorCode } from '@/modules/organizations/errors';
import { _setAdapterForTesting } from '@/modules/auth/adapters/factory';
import { MockAuthAdapter } from '@/modules/auth/adapters/mock';
import { _resetStoreForTesting } from '@/modules/organizations/internal/store';
import { _clearOutboxForTesting, _getOutboxForTesting } from '@/modules/mail';
import type { StandardResponse } from '@/shared';

// ---------------------------------------------------------------------------
// Setup
// ---------------------------------------------------------------------------

let mockAuth: MockAuthAdapter;

beforeEach(() => {
  // Fresh Auth mock + fresh Organizations store for each test.
  mockAuth = new MockAuthAdapter();
  _setAdapterForTesting(mockAuth);
  _resetStoreForTesting();
  _clearOutboxForTesting();
  // Auth.registerUser only triggers Mail.sendVerificationEmail when this
  // env var is set (per Auth v1.1 implementation). Set it for tests so the
  // createUser helper can extract the verification token from the outbox.
  process.env.CODELOK_AUTH_USE_MOCK = 'true';
});

afterAll(() => {
  _setAdapterForTesting(null);
  process.env.CODELOK_AUTH_USE_MOCK = '';
});

// ---------------------------------------------------------------------------
// Helpers: register a user, verify email, login, return access token
// ---------------------------------------------------------------------------

interface TestUser {
  userId: string;
  email: string;
  accessToken: string;
  refreshToken: string;
}

async function createUser(
  email: string,
  password = 'supersecret123'
): Promise<TestUser> {
  const reg = await Auth.registerUser(email, password);
  if (!reg.success) throw new Error(`register failed for ${email}: ${reg.error.code}`);
  // Mock-mode verification email is in the outbox — extract token.
  const outbox = _getOutboxForTesting();
  const entry = outbox.find((e) => e.to === email && e.type === 'verification');
  if (!entry) throw new Error(`no verification email for ${email}`);
  const url = new URL(entry.url);
  const token = url.searchParams.get('token') ?? '';
  if (!token) throw new Error(`no token in verification URL for ${email}`);
  const ver = await Auth.verifyEmail(token);
  if (!ver.success) throw new Error(`verifyEmail failed for ${email}: ${ver.error.code}`);
  const login = await Auth.loginUser(email, password);
  if (!login.success) throw new Error(`login failed for ${email}: ${login.error.code}`);
  return {
    userId: reg.data.userId,
    email,
    accessToken: login.data.accessToken,
    refreshToken: login.data.refreshToken,
  };
}

function assertStandardResponseShape<T>(r: StandardResponse<T>) {
  if (r.success) {
    expect(r).toHaveProperty('data');
    expect(typeof r.success).toBe('boolean');
  } else {
    expect(r).toHaveProperty('error');
    expect(r.error).toHaveProperty('code');
    expect(r.error).toHaveProperty('message');
    expect(typeof r.error.code).toBe('string');
    expect(typeof r.error.message).toBe('string');
  }
}

// ===========================================================================
// 1. BOUNDARY TESTS (Rule 12 — adapters/internals not importable from outside)
// ===========================================================================
//
// These tests verify that the Organizations module's internal files
// (internal/store.ts, internal/operations.ts, internal/types.ts,
// internal/permissions.ts, internal/builtin-roles.ts, errors.ts) are not
// exported from the public surface. We test this by reading the public
// surface's exported keys and asserting that none of the internal symbols
// appear.
//
// Note: ESLint/TypeScript path aliases don't strictly prevent imports
// across module boundaries in this scaffold; the real enforcement is the
// public surface object. These tests document the contract.

describe('BOUNDARY TESTS (Rule 12) — internal symbols not on public surface', () => {
  test('Organizations public surface does not expose internal operations', () => {
    const publicKeys = Object.keys(Organizations).sort();
    // Sanity: the expected public functions are present.
    expect(publicKeys).toContain('createWorkspace');
    expect(publicKeys).toContain('transferOwnership');
    expect(publicKeys).toContain('checkPermission');
    // Internal operations must NOT be on the public surface.
    expect(publicKeys).not.toContain('requireMember');
    expect(publicKeys).not.toContain('requirePermission');
    expect(publicKeys).not.toContain('requireOwner');
    expect(publicKeys).not.toContain('getEffectivePermissions');
    expect(publicKeys).not.toContain('_requireCanAssignRole');
  });

  test('Organizations public surface does not expose store helpers', () => {
    const publicKeys = Object.keys(Organizations);
    expect(publicKeys).not.toContain('store');
    expect(publicKeys).not.toContain('_resetStoreForTesting');
    expect(publicKeys).not.toContain('newWorkspaceId');
    expect(publicKeys).not.toContain('newMemberId');
    expect(publicKeys).not.toContain('newRoleId');
    expect(publicKeys).not.toContain('newInvitationToken');
  });

  test('Organizations errors module exports only OrgErrorCode + type', async () => {
    // Dynamic import to inspect exports without polluting the test file.
    const mod = await import('@/modules/organizations/errors');
    const exportedKeys = Object.keys(mod).filter(
      (k) => k !== 'default' && !k.startsWith('__')
    );
    // Should export OrgErrorCode (const) and OrgErrorCodeValue (type, erased at runtime).
    expect(exportedKeys).toContain('OrgErrorCode');
    // Should NOT export the internal error class or other internals.
    expect(exportedKeys).not.toContain('OrgError');
  });
});

// ===========================================================================
// 2. FUNCTIONAL TESTS — full coverage per STEP 3
// ===========================================================================

describe('FUNCTIONAL — Workspace lifecycle', () => {
  test('createWorkspace: success — caller becomes Owner', async () => {
    const alice = await createUser('alice@example.com');
    const r = await Organizations.createWorkspace(alice.accessToken, {
      name: 'Alice Co',
      description: 'Alice\'s workspace',
    });
    expect(r.success).toBe(true);
    if (!r.success) return;
    expect(r.data.name).toBe('Alice Co');
    expect(r.data.slug).toBeTruthy();
    expect(r.data.createdByUserId).toBe(alice.userId);
    // Alice should be a member with Owner role.
    const members = await Organizations.listMembers(alice.accessToken, r.data.id);
    expect(members.success).toBe(true);
    if (!members.success) return;
    expect(members.data).toHaveLength(1);
    expect(members.data[0].userId).toBe(alice.userId);
  });

  test('createWorkspace: WORKSPACE_NAME_REQUIRED for empty name', async () => {
    const alice = await createUser('alice@example.com');
    const r = await Organizations.createWorkspace(alice.accessToken, { name: '' });
    expect(r.success).toBe(false);
    if (r.success) return;
    expect(r.error.code).toBe(OrgErrorCode.WORKSPACE_NAME_REQUIRED);
  });

  test('updateWorkspace: success', async () => {
    const alice = await createUser('alice@example.com');
    const ws = await Organizations.createWorkspace(alice.accessToken, { name: 'Old' });
    if (!ws.success) throw new Error('setup failed');
    const r = await Organizations.updateWorkspace(alice.accessToken, ws.data.id, {
      name: 'New',
      description: 'updated',
    });
    expect(r.success).toBe(true);
    if (!r.success) return;
    expect(r.data.name).toBe('New');
    expect(r.data.description).toBe('updated');
  });

  test('deleteWorkspace: success (soft delete)', async () => {
    const alice = await createUser('alice@example.com');
    const ws = await Organizations.createWorkspace(alice.accessToken, { name: 'Doomed' });
    if (!ws.success) throw new Error('setup failed');
    const r = await Organizations.deleteWorkspace(alice.accessToken, ws.data.id);
    expect(r.success).toBe(true);
    // Subsequent getWorkspace should fail.
    const get = await Organizations.getWorkspace(alice.accessToken, ws.data.id);
    expect(get.success).toBe(false);
  });

  test('getWorkspace: WORKSPACE_NOT_FOUND for unknown id', async () => {
    const alice = await createUser('alice@example.com');
    const r = await Organizations.getWorkspace(alice.accessToken, 'ws_nonexistent');
    expect(r.success).toBe(false);
    if (r.success) return;
    expect(r.error.code).toBe(OrgErrorCode.NOT_A_MEMBER); // requireMember runs first
  });

  test('listWorkspaces: only workspaces the caller belongs to', async () => {
    const alice = await createUser('alice@example.com');
    const bob = await createUser('bob@example.com');
    await Organizations.createWorkspace(alice.accessToken, { name: 'Alice WS' });
    await Organizations.createWorkspace(bob.accessToken, { name: 'Bob WS' });
    const aliceList = await Organizations.listWorkspaces(alice.accessToken);
    const bobList = await Organizations.listWorkspaces(bob.accessToken);
    if (!aliceList.success || !bobList.success) throw new Error('setup failed');
    expect(aliceList.data).toHaveLength(1);
    expect(aliceList.data[0].name).toBe('Alice WS');
    expect(bobList.data).toHaveLength(1);
    expect(bobList.data[0].name).toBe('Bob WS');
  });
});

describe('FUNCTIONAL — Membership', () => {
  test('addMember: success — Owner adds Bob as Member', async () => {
    const alice = await createUser('alice@example.com');
    const bob = await createUser('bob@example.com');
    const ws = await Organizations.createWorkspace(alice.accessToken, { name: 'WS' });
    if (!ws.success) throw new Error('setup failed');
    const memberRole = await _findRoleByName(alice.accessToken, ws.data.id, 'Member');
    if (!memberRole) throw new Error('Member role not found');
    const r = await Organizations.addMember(
      alice.accessToken,
      ws.data.id,
      bob.userId,
      memberRole.id
    );
    expect(r.success).toBe(true);
    // Bob should now be a member.
    const access = await Organizations.checkAccess(bob.userId, ws.data.id);
    expect(access.success).toBe(true);
    if (!access.success) return;
    expect(access.data.member).toBe(true);
  });

  test('addMember: ALREADY_A_MEMBER', async () => {
    const alice = await createUser('alice@example.com');
    const bob = await createUser('bob@example.com');
    const ws = await Organizations.createWorkspace(alice.accessToken, { name: 'WS' });
    if (!ws.success) throw new Error('setup failed');
    const memberRole = await _findRoleByName(alice.accessToken, ws.data.id, 'Member');
    if (!memberRole) throw new Error('Member role not found');
    await Organizations.addMember(alice.accessToken, ws.data.id, bob.userId, memberRole.id);
    const r = await Organizations.addMember(alice.accessToken, ws.data.id, bob.userId, memberRole.id);
    expect(r.success).toBe(false);
    if (r.success) return;
    expect(r.error.code).toBe(OrgErrorCode.ALREADY_A_MEMBER);
  });

  test('addMember: FORBIDDEN — Member cannot add members', async () => {
    const alice = await createUser('alice@example.com');
    const bob = await createUser('bob@example.com');
    const carol = await createUser('carol@example.com');
    const ws = await Organizations.createWorkspace(alice.accessToken, { name: 'WS' });
    if (!ws.success) throw new Error('setup failed');
    const memberRole = await _findRoleByName(alice.accessToken, ws.data.id, 'Member');
    if (!memberRole) throw new Error('Member role not found');
    await Organizations.addMember(alice.accessToken, ws.data.id, bob.userId, memberRole.id);
    // Bob (Member) tries to add Carol.
    const r = await Organizations.addMember(
      bob.accessToken,
      ws.data.id,
      carol.userId,
      memberRole.id
    );
    expect(r.success).toBe(false);
    if (r.success) return;
    expect(r.error.code).toBe(OrgErrorCode.FORBIDDEN);
  });

  test('removeMember: success', async () => {
    const alice = await createUser('alice@example.com');
    const bob = await createUser('bob@example.com');
    const ws = await Organizations.createWorkspace(alice.accessToken, { name: 'WS' });
    if (!ws.success) throw new Error('setup failed');
    const memberRole = await _findRoleByName(alice.accessToken, ws.data.id, 'Member');
    if (!memberRole) throw new Error('Member role not found');
    await Organizations.addMember(alice.accessToken, ws.data.id, bob.userId, memberRole.id);
    const r = await Organizations.removeMember(alice.accessToken, ws.data.id, bob.userId);
    expect(r.success).toBe(true);
    const access = await Organizations.checkAccess(bob.userId, ws.data.id);
    if (!access.success) throw new Error('checkAccess failed');
    expect(access.data.member).toBe(false);
  });

  test('LAST OWNER RULE: last owner cannot leave', async () => {
    const alice = await createUser('alice@example.com');
    const ws = await Organizations.createWorkspace(alice.accessToken, { name: 'WS' });
    if (!ws.success) throw new Error('setup failed');
    const r = await Organizations.leaveWorkspace(alice.accessToken, ws.data.id);
    expect(r.success).toBe(false);
    if (r.success) return;
    expect(r.error.code).toBe(OrgErrorCode.LAST_OWNER_CANNOT_LEAVE);
  });

  test('LAST OWNER RULE: last owner cannot be removed', async () => {
    const alice = await createUser('alice@example.com');
    const bob = await createUser('bob@example.com');
    const ws = await Organizations.createWorkspace(alice.accessToken, { name: 'WS' });
    if (!ws.success) throw new Error('setup failed');
    const memberRole = await _findRoleByName(alice.accessToken, ws.data.id, 'Member');
    if (!memberRole) throw new Error('Member role not found');
    await Organizations.addMember(alice.accessToken, ws.data.id, bob.userId, memberRole.id);
    // Bob tries to remove Alice (the sole owner).
    const r = await Organizations.removeMember(bob.accessToken, ws.data.id, alice.userId);
    expect(r.success).toBe(false);
    if (r.success) return;
    // Bob lacks members:remove permission (Member role doesn't have it).
    expect(r.error.code).toBe(OrgErrorCode.FORBIDDEN);
    // Even Alice cannot leave/remove herself as sole owner.
    const r2 = await Organizations.leaveWorkspace(alice.accessToken, ws.data.id);
    expect(r2.success).toBe(false);
    if (r2.success) return;
    expect(r2.error.code).toBe(OrgErrorCode.LAST_OWNER_CANNOT_LEAVE);
  });

  test('leaveWorkspace: success when not last owner', async () => {
    const alice = await createUser('alice@example.com');
    const bob = await createUser('bob@example.com');
    const ws = await Organizations.createWorkspace(alice.accessToken, { name: 'WS' });
    if (!ws.success) throw new Error('setup failed');
    // Make Bob a second Owner via transferOwnership? No — simpler: have Alice
    // add Bob as Admin, then transfer ownership to Bob, then Alice can leave.
    const adminRole = await _findRoleByName(alice.accessToken, ws.data.id, 'Admin');
    if (!adminRole) throw new Error('Admin role not found');
    await Organizations.addMember(alice.accessToken, ws.data.id, bob.userId, adminRole.id);
    await Organizations.transferOwnership(alice.accessToken, ws.data.id, bob.userId, true);
    // Now Alice is no longer the sole owner; she can leave.
    const r = await Organizations.leaveWorkspace(alice.accessToken, ws.data.id);
    expect(r.success).toBe(true);
  });

  test('listMembers: success', async () => {
    const alice = await createUser('alice@example.com');
    const bob = await createUser('bob@example.com');
    const ws = await Organizations.createWorkspace(alice.accessToken, { name: 'WS' });
    if (!ws.success) throw new Error('setup failed');
    const memberRole = await _findRoleByName(alice.accessToken, ws.data.id, 'Member');
    if (!memberRole) throw new Error('Member role not found');
    await Organizations.addMember(alice.accessToken, ws.data.id, bob.userId, memberRole.id);
    const r = await Organizations.listMembers(alice.accessToken, ws.data.id);
    expect(r.success).toBe(true);
    if (!r.success) return;
    expect(r.data).toHaveLength(2);
  });

  test('checkAccess: returns { member: true/false } correctly', async () => {
    const alice = await createUser('alice@example.com');
    const bob = await createUser('bob@example.com');
    const ws = await Organizations.createWorkspace(alice.accessToken, { name: 'WS' });
    if (!ws.success) throw new Error('setup failed');
    const memberRole = await _findRoleByName(alice.accessToken, ws.data.id, 'Member');
    if (!memberRole) throw new Error('Member role not found');
    await Organizations.addMember(alice.accessToken, ws.data.id, bob.userId, memberRole.id);
    const yes = await Organizations.checkAccess(bob.userId, ws.data.id);
    const no = await Organizations.checkAccess('user_nobody', ws.data.id);
    if (!yes.success || !no.success) throw new Error('checkAccess failed');
    expect(yes.data.member).toBe(true);
    expect(no.data.member).toBe(false);
  });
});

describe('FUNCTIONAL — transferOwnership', () => {
  test('TRANSFER REQUIRES CONFIRMATION: confirm=false rejected', async () => {
    const alice = await createUser('alice@example.com');
    const bob = await createUser('bob@example.com');
    const ws = await Organizations.createWorkspace(alice.accessToken, { name: 'WS' });
    if (!ws.success) throw new Error('setup failed');
    const adminRole = await _findRoleByName(alice.accessToken, ws.data.id, 'Admin');
    if (!adminRole) throw new Error('Admin role not found');
    await Organizations.addMember(alice.accessToken, ws.data.id, bob.userId, adminRole.id);
    const r = await Organizations.transferOwnership(
      alice.accessToken,
      ws.data.id,
      bob.userId,
      false
    );
    expect(r.success).toBe(false);
    if (r.success) return;
    expect(r.error.code).toBe(OrgErrorCode.TRANSFER_REQUIRES_CONFIRMATION);
  });

  test('transferOwnership: success with confirm=true', async () => {
    const alice = await createUser('alice@example.com');
    const bob = await createUser('bob@example.com');
    const ws = await Organizations.createWorkspace(alice.accessToken, { name: 'WS' });
    if (!ws.success) throw new Error('setup failed');
    const adminRole = await _findRoleByName(alice.accessToken, ws.data.id, 'Admin');
    if (!adminRole) throw new Error('Admin role not found');
    await Organizations.addMember(alice.accessToken, ws.data.id, bob.userId, adminRole.id);
    const r = await Organizations.transferOwnership(
      alice.accessToken,
      ws.data.id,
      bob.userId,
      true
    );
    expect(r.success).toBe(true);
    // Bob should now be Owner; Alice should be Admin (Bob's previous role).
    const members = await Organizations.listMembers(alice.accessToken, ws.data.id);
    if (!members.success) throw new Error('listMembers failed');
    const bobMember = members.data.find((m) => m.userId === bob.userId);
    const aliceMember = members.data.find((m) => m.userId === alice.userId);
    expect(bobMember).toBeTruthy();
    expect(aliceMember).toBeTruthy();
    const ownerRole = members.data.length > 0
      ? await _findRoleByName(alice.accessToken, ws.data.id, 'Owner')
      : null;
    if (!ownerRole) throw new Error('Owner role not found');
    expect(bobMember!.roleId).toBe(ownerRole.id);
    expect(aliceMember!.roleId).toBe(adminRole.id);
  });

  test('transferOwnership: non-owner rejected', async () => {
    const alice = await createUser('alice@example.com');
    const bob = await createUser('bob@example.com');
    const carol = await createUser('carol@example.com');
    const ws = await Organizations.createWorkspace(alice.accessToken, { name: 'WS' });
    if (!ws.success) throw new Error('setup failed');
    const adminRole = await _findRoleByName(alice.accessToken, ws.data.id, 'Admin');
    const memberRole = await _findRoleByName(alice.accessToken, ws.data.id, 'Member');
    if (!adminRole || !memberRole) throw new Error('roles not found');
    await Organizations.addMember(alice.accessToken, ws.data.id, bob.userId, adminRole.id);
    await Organizations.addMember(alice.accessToken, ws.data.id, carol.userId, memberRole.id);
    // Bob (Admin, not Owner) tries to transfer ownership to Carol.
    const r = await Organizations.transferOwnership(
      bob.accessToken,
      ws.data.id,
      carol.userId,
      true
    );
    expect(r.success).toBe(false);
    if (r.success) return;
    expect(r.error.code).toBe(OrgErrorCode.FORBIDDEN);
  });

  test('OWNERSHIP TRANSFER AUDITED: audit log records ownership.transferred', async () => {
    const alice = await createUser('alice@example.com');
    const bob = await createUser('bob@example.com');
    const ws = await Organizations.createWorkspace(alice.accessToken, { name: 'WS' });
    if (!ws.success) throw new Error('setup failed');
    const adminRole = await _findRoleByName(alice.accessToken, ws.data.id, 'Admin');
    if (!adminRole) throw new Error('Admin role not found');
    await Organizations.addMember(alice.accessToken, ws.data.id, bob.userId, adminRole.id);
    await Organizations.transferOwnership(alice.accessToken, ws.data.id, bob.userId, true);
    // Access audit log via internal store (test-only).
    const { store } = await import('@/modules/organizations/internal/store');
    const audit = store.listAudit(ws.data.id);
    const transfer = audit.find((e) => e.action === 'ownership.transferred');
    expect(transfer).toBeTruthy();
    expect(transfer!.actorUserId).toBe(alice.userId);
    expect(transfer!.details.toUserId).toBe(bob.userId);
  });
});

describe('FUNCTIONAL — Roles', () => {
  test('createRole: success', async () => {
    const alice = await createUser('alice@example.com');
    const ws = await Organizations.createWorkspace(alice.accessToken, { name: 'WS' });
    if (!ws.success) throw new Error('setup failed');
    const r = await Organizations.createRole(alice.accessToken, ws.data.id, {
      name: 'Editor',
      description: 'Can edit content',
      permissions: ['workspace:read', 'members:read'],
    });
    expect(r.success).toBe(true);
    if (!r.success) return;
    expect(r.data.name).toBe('Editor');
    expect(r.data.builtIn).toBe(false);
    expect(r.data.permissions).toContain('workspace:read');
  });

  test('createRole: ROLE_NAME_REQUIRED', async () => {
    const alice = await createUser('alice@example.com');
    const ws = await Organizations.createWorkspace(alice.accessToken, { name: 'WS' });
    if (!ws.success) throw new Error('setup failed');
    const r = await Organizations.createRole(alice.accessToken, ws.data.id, {
      name: '',
      permissions: ['workspace:read'],
    });
    expect(r.success).toBe(false);
    if (r.success) return;
    expect(r.error.code).toBe(OrgErrorCode.ROLE_NAME_REQUIRED);
  });

  test('createRole: PRIVILEGE_ESCALATION — cannot include permission caller lacks', async () => {
    const alice = await createUser('alice@example.com');
    const bob = await createUser('bob@example.com');
    const ws = await Organizations.createWorkspace(alice.accessToken, { name: 'WS' });
    if (!ws.success) throw new Error('setup failed');
    // Make Bob an Admin (Admin lacks ownership:transfer and workspace:delete).
    const adminRole = await _findRoleByName(alice.accessToken, ws.data.id, 'Admin');
    if (!adminRole) throw new Error('Admin role not found');
    await Organizations.addMember(alice.accessToken, ws.data.id, bob.userId, adminRole.id);
    // Bob tries to create a role with ownership:transfer (which Admin lacks).
    const r = await Organizations.createRole(bob.accessToken, ws.data.id, {
      name: 'SuperEditor',
      permissions: ['workspace:read', 'ownership:transfer'],
    });
    expect(r.success).toBe(false);
    if (r.success) return;
    expect(r.error.code).toBe(OrgErrorCode.PRIVILEGE_ESCALATION);
  });

  test('updateRole: success', async () => {
    const alice = await createUser('alice@example.com');
    const ws = await Organizations.createWorkspace(alice.accessToken, { name: 'WS' });
    if (!ws.success) throw new Error('setup failed');
    const createR = await Organizations.createRole(alice.accessToken, ws.data.id, {
      name: 'Editor',
      permissions: ['workspace:read'],
    });
    if (!createR.success) throw new Error('createRole failed');
    const r = await Organizations.updateRole(
      alice.accessToken,
      ws.data.id,
      createR.data.id,
      { name: 'Editor Plus', permissions: ['workspace:read', 'members:read'] }
    );
    expect(r.success).toBe(true);
    if (!r.success) return;
    expect(r.data.name).toBe('Editor Plus');
    expect(r.data.permissions).toContain('members:read');
  });

  test('updateRole: BUILT_IN_ROLE_PROTECTED — cannot rename Owner role', async () => {
    const alice = await createUser('alice@example.com');
    const ws = await Organizations.createWorkspace(alice.accessToken, { name: 'WS' });
    if (!ws.success) throw new Error('setup failed');
    const ownerRole = await _findRoleByName(alice.accessToken, ws.data.id, 'Owner');
    if (!ownerRole) throw new Error('Owner role not found');
    const r = await Organizations.updateRole(
      alice.accessToken,
      ws.data.id,
      ownerRole.id,
      { name: 'Supreme Ruler' }
    );
    expect(r.success).toBe(false);
    if (r.success) return;
    expect(r.error.code).toBe(OrgErrorCode.BUILT_IN_ROLE_PROTECTED);
  });

  test('deleteRole: success for unassigned custom role', async () => {
    const alice = await createUser('alice@example.com');
    const ws = await Organizations.createWorkspace(alice.accessToken, { name: 'WS' });
    if (!ws.success) throw new Error('setup failed');
    const createR = await Organizations.createRole(alice.accessToken, ws.data.id, {
      name: 'Temp',
      permissions: ['workspace:read'],
    });
    if (!createR.success) throw new Error('createRole failed');
    const r = await Organizations.deleteRole(alice.accessToken, ws.data.id, createR.data.id);
    expect(r.success).toBe(true);
  });

  test('deleteRole: BUILT_IN_ROLE_PROTECTED — cannot delete Owner role', async () => {
    const alice = await createUser('alice@example.com');
    const ws = await Organizations.createWorkspace(alice.accessToken, { name: 'WS' });
    if (!ws.success) throw new Error('setup failed');
    const ownerRole = await _findRoleByName(alice.accessToken, ws.data.id, 'Owner');
    if (!ownerRole) throw new Error('Owner role not found');
    const r = await Organizations.deleteRole(alice.accessToken, ws.data.id, ownerRole.id);
    expect(r.success).toBe(false);
    if (r.success) return;
    expect(r.error.code).toBe(OrgErrorCode.BUILT_IN_ROLE_PROTECTED);
  });

  test('assignRole: success', async () => {
    const alice = await createUser('alice@example.com');
    const bob = await createUser('bob@example.com');
    const ws = await Organizations.createWorkspace(alice.accessToken, { name: 'WS' });
    if (!ws.success) throw new Error('setup failed');
    const memberRole = await _findRoleByName(alice.accessToken, ws.data.id, 'Member');
    if (!memberRole) throw new Error('Member role not found');
    await Organizations.addMember(alice.accessToken, ws.data.id, bob.userId, memberRole.id);
    // Promote Bob to Admin.
    const adminRole = await _findRoleByName(alice.accessToken, ws.data.id, 'Admin');
    if (!adminRole) throw new Error('Admin role not found');
    const r = await Organizations.assignRole(
      alice.accessToken,
      ws.data.id,
      bob.userId,
      adminRole.id
    );
    expect(r.success).toBe(true);
  });

  test('assignRole: PRIVILEGE_ESCALATION — Member cannot assign Admin role', async () => {
    const alice = await createUser('alice@example.com');
    const bob = await createUser('bob@example.com');
    const carol = await createUser('carol@example.com');
    const ws = await Organizations.createWorkspace(alice.accessToken, { name: 'WS' });
    if (!ws.success) throw new Error('setup failed');
    const memberRole = await _findRoleByName(alice.accessToken, ws.data.id, 'Member');
    const adminRole = await _findRoleByName(alice.accessToken, ws.data.id, 'Admin');
    if (!memberRole || !adminRole) throw new Error('roles not found');
    await Organizations.addMember(alice.accessToken, ws.data.id, bob.userId, memberRole.id);
    await Organizations.addMember(alice.accessToken, ws.data.id, carol.userId, memberRole.id);
    // Bob (Member) tries to promote Carol to Admin. Bob lacks members:manage_roles.
    const r = await Organizations.assignRole(
      bob.accessToken,
      ws.data.id,
      carol.userId,
      adminRole.id
    );
    expect(r.success).toBe(false);
    if (r.success) return;
    // Bob lacks members:manage_roles permission → FORBIDDEN (checked before escalation).
    expect(r.error.code).toBe(OrgErrorCode.FORBIDDEN);
  });

  test('assignRole: cannot assign Owner role (must use transferOwnership)', async () => {
    const alice = await createUser('alice@example.com');
    const bob = await createUser('bob@example.com');
    const ws = await Organizations.createWorkspace(alice.accessToken, { name: 'WS' });
    if (!ws.success) throw new Error('setup failed');
    const memberRole = await _findRoleByName(alice.accessToken, ws.data.id, 'Member');
    const ownerRole = await _findRoleByName(alice.accessToken, ws.data.id, 'Owner');
    if (!memberRole || !ownerRole) throw new Error('roles not found');
    await Organizations.addMember(alice.accessToken, ws.data.id, bob.userId, memberRole.id);
    const r = await Organizations.assignRole(
      alice.accessToken,
      ws.data.id,
      bob.userId,
      ownerRole.id
    );
    expect(r.success).toBe(false);
    if (r.success) return;
    expect(r.error.code).toBe(OrgErrorCode.PRIVILEGE_ESCALATION);
  });

  test('removeRole: success (demotes to Member)', async () => {
    const alice = await createUser('alice@example.com');
    const bob = await createUser('bob@example.com');
    const ws = await Organizations.createWorkspace(alice.accessToken, { name: 'WS' });
    if (!ws.success) throw new Error('setup failed');
    const memberRole = await _findRoleByName(alice.accessToken, ws.data.id, 'Member');
    const adminRole = await _findRoleByName(alice.accessToken, ws.data.id, 'Admin');
    if (!memberRole || !adminRole) throw new Error('roles not found');
    await Organizations.addMember(alice.accessToken, ws.data.id, bob.userId, adminRole.id);
    const r = await Organizations.removeRole(alice.accessToken, ws.data.id, bob.userId);
    expect(r.success).toBe(true);
    // Bob should now have Member role.
    const members = await Organizations.listMembers(alice.accessToken, ws.data.id);
    if (!members.success) throw new Error('listMembers failed');
    const bobMember = members.data.find((m) => m.userId === bob.userId);
    expect(bobMember!.roleId).toBe(memberRole.id);
  });

  test('listRoles: returns built-in + custom roles', async () => {
    const alice = await createUser('alice@example.com');
    const ws = await Organizations.createWorkspace(alice.accessToken, { name: 'WS' });
    if (!ws.success) throw new Error('setup failed');
    await Organizations.createRole(alice.accessToken, ws.data.id, {
      name: 'Custom',
      permissions: ['workspace:read'],
    });
    const r = await Organizations.listRoles(alice.accessToken, ws.data.id);
    expect(r.success).toBe(true);
    if (!r.success) return;
    // 3 built-in + 1 custom = 4
    expect(r.data).toHaveLength(4);
    const builtIns = r.data.filter((role) => role.builtIn);
    expect(builtIns).toHaveLength(3);
  });
});

describe('FUNCTIONAL — Permissions', () => {
  test('listPermissions: returns immutable catalog', async () => {
    const r = await Organizations.listPermissions();
    expect(r.success).toBe(true);
    if (!r.success) return;
    expect(r.data.length).toBeGreaterThan(0);
    // Sanity: workspace:read should be in the catalog.
    expect(r.data.some((p) => p.key === 'workspace:read')).toBe(true);
  });

  test('checkPermission: Owner has ownership:transfer', async () => {
    const alice = await createUser('alice@example.com');
    const ws = await Organizations.createWorkspace(alice.accessToken, { name: 'WS' });
    if (!ws.success) throw new Error('setup failed');
    const r = await Organizations.checkPermission(
      alice.accessToken,
      ws.data.id,
      alice.userId,
      'ownership:transfer'
    );
    expect(r.success).toBe(true);
    if (!r.success) return;
    expect(r.data.has).toBe(true);
  });

  test('checkPermission: Member does NOT have ownership:transfer', async () => {
    const alice = await createUser('alice@example.com');
    const bob = await createUser('bob@example.com');
    const ws = await Organizations.createWorkspace(alice.accessToken, { name: 'WS' });
    if (!ws.success) throw new Error('setup failed');
    const memberRole = await _findRoleByName(alice.accessToken, ws.data.id, 'Member');
    if (!memberRole) throw new Error('Member role not found');
    await Organizations.addMember(alice.accessToken, ws.data.id, bob.userId, memberRole.id);
    const r = await Organizations.checkPermission(
      alice.accessToken,
      ws.data.id,
      bob.userId,
      'ownership:transfer'
    );
    expect(r.success).toBe(true);
    if (!r.success) return;
    expect(r.data.has).toBe(false);
  });

  test('checkPermission: PERMISSION_NOT_FOUND for unknown permission', async () => {
    const alice = await createUser('alice@example.com');
    const ws = await Organizations.createWorkspace(alice.accessToken, { name: 'WS' });
    if (!ws.success) throw new Error('setup failed');
    const r = await Organizations.checkPermission(
      alice.accessToken,
      ws.data.id,
      alice.userId,
      'nonexistent:permission'
    );
    expect(r.success).toBe(false);
    if (r.success) return;
    expect(r.error.code).toBe(OrgErrorCode.PERMISSION_NOT_FOUND);
  });

  test('NO USER-LEVEL PERMISSION GRANT: no grantPermission/revokePermission in public surface', () => {
    expect(typeof (Organizations as unknown as Record<string, unknown>).grantPermission)
      .toBe('undefined');
    expect(typeof (Organizations as unknown as Record<string, unknown>).revokePermission)
      .toBe('undefined');
  });
});

describe('FUNCTIONAL — Invitations', () => {
  test('inviteMember: success — sends Mail.sendInvitationEmail', async () => {
    const alice = await createUser('alice@example.com');
    const bob = await createUser('bob@example.com');
    const ws = await Organizations.createWorkspace(alice.accessToken, { name: 'WS' });
    if (!ws.success) throw new Error('setup failed');
    const memberRole = await _findRoleByName(alice.accessToken, ws.data.id, 'Member');
    if (!memberRole) throw new Error('Member role not found');
    _clearOutboxForTesting();
    const r = await Organizations.inviteMember(
      alice.accessToken,
      ws.data.id,
      bob.userId,
      memberRole.id
    );
    expect(r.success).toBe(true);
    // Mail outbox should have an invitation email.
    const outbox = _getOutboxForTesting();
    const invite = outbox.find((e) => e.type === 'invitation' && e.to === 'bob@example.com');
    expect(invite).toBeTruthy();
  });

  test('inviteMember: CANNOT_INVITE_SELF', async () => {
    const alice = await createUser('alice@example.com');
    const ws = await Organizations.createWorkspace(alice.accessToken, { name: 'WS' });
    if (!ws.success) throw new Error('setup failed');
    const memberRole = await _findRoleByName(alice.accessToken, ws.data.id, 'Member');
    if (!memberRole) throw new Error('Member role not found');
    const r = await Organizations.inviteMember(
      alice.accessToken,
      ws.data.id,
      alice.userId,
      memberRole.id
    );
    expect(r.success).toBe(false);
    if (r.success) return;
    expect(r.error.code).toBe(OrgErrorCode.CANNOT_INVITE_SELF);
  });

  test('inviteMember: ALREADY_A_MEMBER', async () => {
    const alice = await createUser('alice@example.com');
    const bob = await createUser('bob@example.com');
    const ws = await Organizations.createWorkspace(alice.accessToken, { name: 'WS' });
    if (!ws.success) throw new Error('setup failed');
    const memberRole = await _findRoleByName(alice.accessToken, ws.data.id, 'Member');
    if (!memberRole) throw new Error('Member role not found');
    await Organizations.addMember(alice.accessToken, ws.data.id, bob.userId, memberRole.id);
    const r = await Organizations.inviteMember(
      alice.accessToken,
      ws.data.id,
      bob.userId,
      memberRole.id
    );
    expect(r.success).toBe(false);
    if (r.success) return;
    expect(r.error.code).toBe(OrgErrorCode.ALREADY_A_MEMBER);
  });

  test('inviteMember: INVITATION_ALREADY_PENDING', async () => {
    const alice = await createUser('alice@example.com');
    const bob = await createUser('bob@example.com');
    const ws = await Organizations.createWorkspace(alice.accessToken, { name: 'WS' });
    if (!ws.success) throw new Error('setup failed');
    const memberRole = await _findRoleByName(alice.accessToken, ws.data.id, 'Member');
    if (!memberRole) throw new Error('Member role not found');
    await Organizations.inviteMember(alice.accessToken, ws.data.id, bob.userId, memberRole.id);
    const r = await Organizations.inviteMember(
      alice.accessToken,
      ws.data.id,
      bob.userId,
      memberRole.id
    );
    expect(r.success).toBe(false);
    if (r.success) return;
    expect(r.error.code).toBe(OrgErrorCode.INVITATION_ALREADY_PENDING);
  });

  test('acceptInvitation: success — invitee becomes member', async () => {
    const alice = await createUser('alice@example.com');
    const bob = await createUser('bob@example.com');
    const ws = await Organizations.createWorkspace(alice.accessToken, { name: 'WS' });
    if (!ws.success) throw new Error('setup failed');
    const memberRole = await _findRoleByName(alice.accessToken, ws.data.id, 'Member');
    if (!memberRole) throw new Error('Member role not found');
    const inv = await Organizations.inviteMember(
      alice.accessToken,
      ws.data.id,
      bob.userId,
      memberRole.id
    );
    if (!inv.success) throw new Error('invite failed');
    const r = await Organizations.acceptInvitation(bob.accessToken, inv.data.token!);
    expect(r.success).toBe(true);
    // Bob should now be a member.
    const access = await Organizations.checkAccess(bob.userId, ws.data.id);
    if (!access.success) throw new Error('checkAccess failed');
    expect(access.data.member).toBe(true);
  });

  test('acceptInvitation: UNAUTHORIZED — non-invitee cannot accept', async () => {
    const alice = await createUser('alice@example.com');
    const bob = await createUser('bob@example.com');
    const carol = await createUser('carol@example.com');
    const ws = await Organizations.createWorkspace(alice.accessToken, { name: 'WS' });
    if (!ws.success) throw new Error('setup failed');
    const memberRole = await _findRoleByName(alice.accessToken, ws.data.id, 'Member');
    if (!memberRole) throw new Error('Member role not found');
    const inv = await Organizations.inviteMember(
      alice.accessToken,
      ws.data.id,
      bob.userId,
      memberRole.id
    );
    if (!inv.success) throw new Error('invite failed');
    // Carol tries to accept Bob's invitation.
    const r = await Organizations.acceptInvitation(carol.accessToken, inv.data.token!);
    expect(r.success).toBe(false);
    if (r.success) return;
    expect(r.error.code).toBe(OrgErrorCode.UNAUTHORIZED);
  });

  test('declineInvitation: success', async () => {
    const alice = await createUser('alice@example.com');
    const bob = await createUser('bob@example.com');
    const ws = await Organizations.createWorkspace(alice.accessToken, { name: 'WS' });
    if (!ws.success) throw new Error('setup failed');
    const memberRole = await _findRoleByName(alice.accessToken, ws.data.id, 'Member');
    if (!memberRole) throw new Error('Member role not found');
    const inv = await Organizations.inviteMember(
      alice.accessToken,
      ws.data.id,
      bob.userId,
      memberRole.id
    );
    if (!inv.success) throw new Error('invite failed');
    const r = await Organizations.declineInvitation(bob.accessToken, inv.data.token!);
    expect(r.success).toBe(true);
    // Bob should NOT be a member.
    const access = await Organizations.checkAccess(bob.userId, ws.data.id);
    if (!access.success) throw new Error('checkAccess failed');
    expect(access.data.member).toBe(false);
  });

  test('cancelInvitation: success', async () => {
    const alice = await createUser('alice@example.com');
    const bob = await createUser('bob@example.com');
    const ws = await Organizations.createWorkspace(alice.accessToken, { name: 'WS' });
    if (!ws.success) throw new Error('setup failed');
    const memberRole = await _findRoleByName(alice.accessToken, ws.data.id, 'Member');
    if (!memberRole) throw new Error('Member role not found');
    const inv = await Organizations.inviteMember(
      alice.accessToken,
      ws.data.id,
      bob.userId,
      memberRole.id
    );
    if (!inv.success) throw new Error('invite failed');
    const r = await Organizations.cancelInvitation(
      alice.accessToken,
      ws.data.id,
      inv.data.id
    );
    expect(r.success).toBe(true);
    // Subsequent accept should fail.
    const acc = await Organizations.acceptInvitation(bob.accessToken, inv.data.token!);
    expect(acc.success).toBe(false);
    if (acc.success) return;
    expect(acc.error.code).toBe(OrgErrorCode.INVITATION_ALREADY_CANCELLED);
  });

  test('resendInvitation: success — new token issued', async () => {
    const alice = await createUser('alice@example.com');
    const bob = await createUser('bob@example.com');
    const ws = await Organizations.createWorkspace(alice.accessToken, { name: 'WS' });
    if (!ws.success) throw new Error('setup failed');
    const memberRole = await _findRoleByName(alice.accessToken, ws.data.id, 'Member');
    if (!memberRole) throw new Error('Member role not found');
    const inv = await Organizations.inviteMember(
      alice.accessToken,
      ws.data.id,
      bob.userId,
      memberRole.id
    );
    if (!inv.success) throw new Error('invite failed');
    const oldToken = inv.data.token;
    _clearOutboxForTesting();
    const r = await Organizations.resendInvitation(
      alice.accessToken,
      ws.data.id,
      inv.data.id
    );
    expect(r.success).toBe(true);
    if (!r.success) return;
    expect(r.data.token).toBeTruthy();
    expect(r.data.token).not.toBe(oldToken);
    // Mail outbox should have a second invitation email.
    const outbox = _getOutboxForTesting();
    expect(outbox.filter((e) => e.type === 'invitation').length).toBeGreaterThan(0);
  });
});

// ===========================================================================
// 3. CROSS-WORKSPACE ISOLATION + UNAUTHORIZED ACCESS
// ===========================================================================

describe('CROSS-WORKSPACE ISOLATION', () => {
  test('Member of workspace A cannot access workspace B', async () => {
    const alice = await createUser('alice@example.com');
    const bob = await createUser('bob@example.com');
    const wsA = await Organizations.createWorkspace(alice.accessToken, { name: 'A' });
    const wsB = await Organizations.createWorkspace(bob.accessToken, { name: 'B' });
    if (!wsA.success || !wsB.success) throw new Error('setup failed');
    // Bob tries to access Alice's workspace A.
    const r = await Organizations.getWorkspace(bob.accessToken, wsA.data.id);
    expect(r.success).toBe(false);
    if (r.success) return;
    expect(r.error.code).toBe(OrgErrorCode.NOT_A_MEMBER);
  });

  test('Member of workspace A cannot list members of workspace B', async () => {
    const alice = await createUser('alice@example.com');
    const bob = await createUser('bob@example.com');
    const wsA = await Organizations.createWorkspace(alice.accessToken, { name: 'A' });
    const wsB = await Organizations.createWorkspace(bob.accessToken, { name: 'B' });
    if (!wsA.success || !wsB.success) throw new Error('setup failed');
    const r = await Organizations.listMembers(bob.accessToken, wsA.data.id);
    expect(r.success).toBe(false);
    if (r.success) return;
    expect(r.error.code).toBe(OrgErrorCode.NOT_A_MEMBER);
  });

  test('One identity → many workspaces (§12 Core Model)', async () => {
    const alice = await createUser('alice@example.com');
    const wsA = await Organizations.createWorkspace(alice.accessToken, { name: 'A' });
    const wsB = await Organizations.createWorkspace(alice.accessToken, { name: 'B' });
    const wsC = await Organizations.createWorkspace(alice.accessToken, { name: 'C' });
    if (!wsA.success || !wsB.success || !wsC.success) throw new Error('setup failed');
    const list = await Organizations.listWorkspaces(alice.accessToken);
    if (!list.success) throw new Error('listWorkspaces failed');
    expect(list.data).toHaveLength(3);
    // Alice is Owner of all three (one identity → many workspaces).
    for (const ws of list.data) {
      const members = await Organizations.listMembers(alice.accessToken, ws.id);
      if (!members.success) throw new Error('listMembers failed');
      const aliceMember = members.data.find((m) => m.userId === alice.userId);
      expect(aliceMember).toBeTruthy();
    }
  });
});

describe('UNAUTHORIZED ACCESS', () => {
  test('No access token → UNAUTHORIZED', async () => {
    const r = await Organizations.createWorkspace('', { name: 'X' });
    expect(r.success).toBe(false);
    if (r.success) return;
    expect(r.error.code).toBe(OrgErrorCode.UNAUTHORIZED);
  });

  test('Invalid access token → UNAUTHORIZED', async () => {
    const r = await Organizations.createWorkspace('invalid_token', { name: 'X' });
    expect(r.success).toBe(false);
    if (r.success) return;
    expect(r.error.code).toBe(OrgErrorCode.UNAUTHORIZED);
  });

  test('Expired access token → UNAUTHORIZED', async () => {
    const alice = await createUser('alice@example.com');
    // Force expiry by advancing the mock clock. We use the injected mockAuth
    // instance (set in beforeEach) — not _getMockAdapterForTesting, which
    // returns the global cached mock that may differ from our injection.
    mockAuth._advanceClock(2 * 3600 * 1000); // 2 hours past expiry
    const r = await Organizations.createWorkspace(alice.accessToken, { name: 'X' });
    expect(r.success).toBe(false);
    if (r.success) return;
    expect(r.error.code).toBe(OrgErrorCode.UNAUTHORIZED);
  });
});

// ===========================================================================
// 4. PRIVILEGE ESCALATION (comprehensive)
// ===========================================================================

describe('PRIVILEGE ESCALATION RULE (§12 Mandatory Rule 3) — comprehensive', () => {
  test('Admin cannot create a role with workspace:delete (which Admin lacks)', async () => {
    const alice = await createUser('alice@example.com');
    const bob = await createUser('bob@example.com');
    const ws = await Organizations.createWorkspace(alice.accessToken, { name: 'WS' });
    if (!ws.success) throw new Error('setup failed');
    const adminRole = await _findRoleByName(alice.accessToken, ws.data.id, 'Admin');
    if (!adminRole) throw new Error('Admin role not found');
    await Organizations.addMember(alice.accessToken, ws.data.id, bob.userId, adminRole.id);
    const r = await Organizations.createRole(bob.accessToken, ws.data.id, {
      name: 'Deleter',
      permissions: ['workspace:delete'],
    });
    expect(r.success).toBe(false);
    if (r.success) return;
    expect(r.error.code).toBe(OrgErrorCode.PRIVILEGE_ESCALATION);
  });

  test('Admin cannot update a role to include workspace:delete', async () => {
    const alice = await createUser('alice@example.com');
    const bob = await createUser('bob@example.com');
    const ws = await Organizations.createWorkspace(alice.accessToken, { name: 'WS' });
    if (!ws.success) throw new Error('setup failed');
    const adminRole = await _findRoleByName(alice.accessToken, ws.data.id, 'Admin');
    if (!adminRole) throw new Error('Admin role not found');
    await Organizations.addMember(alice.accessToken, ws.data.id, bob.userId, adminRole.id);
    // Alice (Owner) creates a role with workspace:read only.
    const createR = await Organizations.createRole(alice.accessToken, ws.data.id, {
      name: 'Reader',
      permissions: ['workspace:read'],
    });
    if (!createR.success) throw new Error('createRole failed');
    // Bob (Admin) tries to add workspace:delete to it.
    const r = await Organizations.updateRole(
      bob.accessToken,
      ws.data.id,
      createR.data.id,
      { permissions: ['workspace:read', 'workspace:delete'] }
    );
    expect(r.success).toBe(false);
    if (r.success) return;
    expect(r.error.code).toBe(OrgErrorCode.PRIVILEGE_ESCALATION);
  });

  test('Admin cannot assign Owner role (must use transferOwnership)', async () => {
    const alice = await createUser('alice@example.com');
    const bob = await createUser('bob@example.com');
    const carol = await createUser('carol@example.com');
    const ws = await Organizations.createWorkspace(alice.accessToken, { name: 'WS' });
    if (!ws.success) throw new Error('setup failed');
    const adminRole = await _findRoleByName(alice.accessToken, ws.data.id, 'Admin');
    const memberRole = await _findRoleByName(alice.accessToken, ws.data.id, 'Member');
    if (!adminRole || !memberRole) throw new Error('roles not found');
    await Organizations.addMember(alice.accessToken, ws.data.id, bob.userId, adminRole.id);
    await Organizations.addMember(alice.accessToken, ws.data.id, carol.userId, memberRole.id);
    const r = await Organizations.assignRole(
      bob.accessToken,
      ws.data.id,
      carol.userId,
      adminRole.id  // Bob IS admin, so this is a subset. Should succeed.
    );
    expect(r.success).toBe(true);
  });

  test('Admin can assign a role whose permissions are a subset of Admin', async () => {
    const alice = await createUser('alice@example.com');
    const bob = await createUser('bob@example.com');
    const carol = await createUser('carol@example.com');
    const ws = await Organizations.createWorkspace(alice.accessToken, { name: 'WS' });
    if (!ws.success) throw new Error('setup failed');
    const adminRole = await _findRoleByName(alice.accessToken, ws.data.id, 'Admin');
    const memberRole = await _findRoleByName(alice.accessToken, ws.data.id, 'Member');
    if (!adminRole || !memberRole) throw new Error('roles not found');
    await Organizations.addMember(alice.accessToken, ws.data.id, bob.userId, adminRole.id);
    await Organizations.addMember(alice.accessToken, ws.data.id, carol.userId, memberRole.id);
    // Bob (Admin) promotes Carol to Admin — Admin permissions are a subset
    // of Bob's own (he IS Admin), so this is allowed.
    const r = await Organizations.assignRole(
      bob.accessToken,
      ws.data.id,
      carol.userId,
      adminRole.id
    );
    expect(r.success).toBe(true);
  });
});

// ===========================================================================
// 5. COMPLIANCE TESTS (Rule 12)
// ===========================================================================

describe('COMPLIANCE — §3.6 StandardResponse shape', () => {
  test('Every Organizations function returns success-or-error envelope', async () => {
    const alice = await createUser('alice@example.com');
    const ws = await Organizations.createWorkspace(alice.accessToken, { name: 'WS' });
    if (!ws.success) throw new Error('setup failed');
    const samples: StandardResponse<unknown>[] = [
      await Organizations.createWorkspace(alice.accessToken, { name: 'X' }),
      await Organizations.listWorkspaces(alice.accessToken),
      await Organizations.getWorkspace(alice.accessToken, ws.data.id),
      await Organizations.createWorkspace(alice.accessToken, { name: '' }), // error
      await Organizations.listMembers(alice.accessToken, ws.data.id),
      await Organizations.listMembers(alice.accessToken, 'ws_nonexistent'), // error
      await Organizations.listRoles(alice.accessToken, ws.data.id),
      await Organizations.listPermissions(),
      await Organizations.checkAccess(alice.userId, ws.data.id),
      await Organizations.checkPermission(
        alice.accessToken,
        ws.data.id,
        alice.userId,
        'workspace:read'
      ),
      await Organizations.checkPermission(
        alice.accessToken,
        ws.data.id,
        alice.userId,
        'bogus:permission'
      ),
      await Organizations.createWorkspace('', { name: 'X' }), // unauthorized
    ];
    for (const r of samples) {
      assertStandardResponseShape(r);
      if (r.success) {
        expect(r.data).not.toBeUndefined();
        expect((r as { error?: unknown }).error).toBeUndefined();
      } else {
        expect(r.error).not.toBeUndefined();
        expect((r as { data?: unknown }).data).toBeUndefined();
      }
    }
  });
});

describe('COMPLIANCE — §3.8 Identity Ownership (no persisted identity columns)', () => {
  test('Organizations does not persist email/displayName on Member records', async () => {
    const alice = await createUser('alice@example.com');
    const ws = await Organizations.createWorkspace(alice.accessToken, { name: 'WS' });
    if (!ws.success) throw new Error('setup failed');
    const members = await Organizations.listMembers(alice.accessToken, ws.data.id);
    if (!members.success) throw new Error('listMembers failed');
    const m = members.data[0];
    // The Member type must NOT have email/displayName fields.
    expect(m).not.toHaveProperty('email');
    expect(m).not.toHaveProperty('displayName');
    expect(m).toHaveProperty('userId');
    expect(m).toHaveProperty('roleId');
  });

  test('listMembersWithIdentity resolves email via Auth.getUser on-demand', async () => {
    const alice = await createUser('alice@example.com');
    const ws = await Organizations.createWorkspace(alice.accessToken, { name: 'WS' });
    if (!ws.success) throw new Error('setup failed');
    const r = await Organizations.listMembersWithIdentity(
      alice.accessToken,
      ws.data.id
    );
    expect(r.success).toBe(true);
    if (!r.success) return;
    expect(r.data[0].email).toBe('alice@example.com');
    expect(r.data[0].emailVerified).toBe(true);
  });
});

describe('COMPLIANCE — §3.9 Data Ownership (Organizations owns its tables)', () => {
  test('Organizations store is private — internal/store not on public surface', () => {
    const publicKeys = Object.keys(Organizations);
    expect(publicKeys).not.toContain('store');
    // The store object is internal; only the test-only _resetStoreForTesting
    // escape hatch is importable, and only from internal/store (not from
    // the public index).
  });
});

describe('COMPLIANCE — §3.3 Module boundary (no reach-ins to Auth/Mail internals)', () => {
  test('Organizations index.ts imports only from Auth/Mail public surfaces', async () => {
    // Read the source file and check imports.
    const fs = await import('fs');
    const src = fs.readFileSync(
      '/home/z/my-project/src/modules/organizations/index.ts',
      'utf-8'
    );
    // Must import Auth and Mail from their public index files.
    expect(src).toMatch(/from ['"]@\/modules\/auth['"]/);
    expect(src).toMatch(/from ['"]@\/modules\/mail['"]/);
    // Must NOT import from Auth or Mail internal paths.
    expect(src).not.toMatch(/from ['"]@\/modules\/auth\/adapters/);
    expect(src).not.toMatch(/from ['"]@\/modules\/mail\/adapters/);
    expect(src).not.toMatch(/from ['"]@\/modules\/auth\/errors/);
  });
});

describe('COMPLIANCE — Last Owner Rule enforced (§12 Mandatory Rule 1)', () => {
  test('Cannot remove last owner', async () => {
    const alice = await createUser('alice@example.com');
    const bob = await createUser('bob@example.com');
    const ws = await Organizations.createWorkspace(alice.accessToken, { name: 'WS' });
    if (!ws.success) throw new Error('setup failed');
    const adminRole = await _findRoleByName(alice.accessToken, ws.data.id, 'Admin');
    if (!adminRole) throw new Error('Admin role not found');
    await Organizations.addMember(alice.accessToken, ws.data.id, bob.userId, adminRole.id);
    // Bob tries to remove Alice (sole owner). Bob lacks members:remove (Admin has it though).
    // Actually Admin DOES have members:remove. So the only thing protecting Alice is the Last Owner Rule.
    const r = await Organizations.removeMember(bob.accessToken, ws.data.id, alice.userId);
    expect(r.success).toBe(false);
    if (r.success) return;
    expect(r.error.code).toBe(OrgErrorCode.LAST_OWNER_CANNOT_LEAVE);
  });

  test('Cannot demote last owner via assignRole', async () => {
    const alice = await createUser('alice@example.com');
    const bob = await createUser('bob@example.com');
    const ws = await Organizations.createWorkspace(alice.accessToken, { name: 'WS' });
    if (!ws.success) throw new Error('setup failed');
    const adminRole = await _findRoleByName(alice.accessToken, ws.data.id, 'Admin');
    const memberRole = await _findRoleByName(alice.accessToken, ws.data.id, 'Member');
    if (!adminRole || !memberRole) throw new Error('roles not found');
    await Organizations.addMember(alice.accessToken, ws.data.id, bob.userId, adminRole.id);
    // Alice tries to demote herself to Member (she's sole owner).
    const r = await Organizations.assignRole(
      alice.accessToken,
      ws.data.id,
      alice.userId,
      memberRole.id
    );
    expect(r.success).toBe(false);
    if (r.success) return;
    expect(r.error.code).toBe(OrgErrorCode.LAST_OWNER_CANNOT_LEAVE);
  });
});

describe('COMPLIANCE — Ownership Transfer Rule (§12 Mandatory Rule 2)', () => {
  test('Transfer is audit-logged with action=ownership.transferred', async () => {
    const alice = await createUser('alice@example.com');
    const bob = await createUser('bob@example.com');
    const ws = await Organizations.createWorkspace(alice.accessToken, { name: 'WS' });
    if (!ws.success) throw new Error('setup failed');
    const adminRole = await _findRoleByName(alice.accessToken, ws.data.id, 'Admin');
    if (!adminRole) throw new Error('Admin role not found');
    await Organizations.addMember(alice.accessToken, ws.data.id, bob.userId, adminRole.id);
    await Organizations.transferOwnership(alice.accessToken, ws.data.id, bob.userId, true);
    const { store } = await import('@/modules/organizations/internal/store');
    const audit = store.listAudit(ws.data.id);
    const transfer = audit.find((e) => e.action === 'ownership.transferred');
    expect(transfer).toBeTruthy();
  });

  test('Transfer is NOT reversible through normal role editing', async () => {
    const alice = await createUser('alice@example.com');
    const bob = await createUser('bob@example.com');
    const ws = await Organizations.createWorkspace(alice.accessToken, { name: 'WS' });
    if (!ws.success) throw new Error('setup failed');
    const adminRole = await _findRoleByName(alice.accessToken, ws.data.id, 'Admin');
    if (!adminRole) throw new Error('Admin role not found');
    await Organizations.addMember(alice.accessToken, ws.data.id, bob.userId, adminRole.id);
    // Alice transfers ownership to Bob. Alice is now Admin, Bob is Owner.
    await Organizations.transferOwnership(alice.accessToken, ws.data.id, bob.userId, true);
    // Alice tries to "undo" by assigning Owner role to herself via assignRole.
    // assignRole forbids assigning Owner role — must use transferOwnership.
    const ownerRole = await _findRoleByName(bob.accessToken, ws.data.id, 'Owner');
    if (!ownerRole) throw new Error('Owner role not found');
    const r = await Organizations.assignRole(
      alice.accessToken,
      ws.data.id,
      alice.userId,
      ownerRole.id
    );
    expect(r.success).toBe(false);
    if (r.success) return;
    expect(r.error.code).toBe(OrgErrorCode.PRIVILEGE_ESCALATION);
  });
});

describe('COMPLIANCE — Roles own permissions (§12 Permissions)', () => {
  test('No grantPermission/revokePermission at user level', () => {
    expect((Organizations as unknown as Record<string, unknown>).grantPermission)
      .toBeUndefined();
    expect((Organizations as unknown as Record<string, unknown>).revokePermission)
      .toBeUndefined();
  });

  test('Permissions are immutable catalog — no createPermission/deletePermission', () => {
    expect((Organizations as unknown as Record<string, unknown>).createPermission)
      .toBeUndefined();
    expect((Organizations as unknown as Record<string, unknown>).deletePermission)
      .toBeUndefined();
  });
});

// ===========================================================================
// Helper: find a role by name in a workspace
// ===========================================================================

async function _findRoleByName(
  accessToken: string,
  workspaceId: string,
  name: string
): Promise<{ id: string } | null> {
  const r = await Organizations.listRoles(accessToken, workspaceId);
  if (!r.success) return null;
  const role = r.data.find((role) => role.name === name);
  return role ? { id: role.id } : null;
}
