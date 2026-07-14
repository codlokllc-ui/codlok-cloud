/**
 * Codlok Cloud Dashboard — API Client
 *
 * Frontend API helpers for calling real module API routes.
 * Each function returns the StandardResponse shape from the module.
 */

// ---------------------------------------------------------------------------
// Types (mirror module public interfaces)
// ---------------------------------------------------------------------------

export interface Workspace {
  id: string;
  name: string;
  slug: string;
  description?: string;
  createdByUserId: string;
  createdAt: string;
  updatedAt: string;
}

export interface TeamMember {
  memberId: string;
  userId: string;
  roleId: string;
  roleName: string;
  joinedAt: string;
  email?: string;
  emailVerified?: boolean;
}

// ---------------------------------------------------------------------------
// Fetch helper
// ---------------------------------------------------------------------------

async function apiCall<T>(path: string, options?: RequestInit): Promise<T> {
  const res = await fetch(path, {
    ...options,
    headers: {
      'Content-Type': 'application/json',
      ...options?.headers,
    },
  });
  return res.json() as Promise<T>;
}

function authHeader(accessToken: string): Record<string, string> {
  return { Authorization: `Bearer ${accessToken}` };
}

// ---------------------------------------------------------------------------
// Organizations API
// ---------------------------------------------------------------------------

export const orgsApi = {
  async listWorkspaces(accessToken: string) {
    return apiCall<{ success: boolean; data?: Workspace[]; error?: { code: string; message: string } }>(
      '/api/organizations/workspaces',
      { headers: authHeader(accessToken) }
    );
  },

  async createWorkspace(accessToken: string, name: string, description?: string) {
    return apiCall<{ success: boolean; data?: Workspace; error?: { code: string; message: string } }>(
      '/api/organizations/workspaces',
      {
        method: 'POST',
        headers: authHeader(accessToken),
        body: JSON.stringify({ name, description }),
      }
    );
  },

  async getWorkspace(accessToken: string, workspaceId: string) {
    return apiCall<{ success: boolean; data?: Workspace; error?: { code: string; message: string } }>(
      `/api/organizations/workspaces/${workspaceId}`,
      { headers: authHeader(accessToken) }
    );
  },

  async updateWorkspace(accessToken: string, workspaceId: string, patch: { name?: string; description?: string }) {
    return apiCall<{ success: boolean; data?: Workspace; error?: { code: string; message: string } }>(
      `/api/organizations/workspaces/${workspaceId}`,
      {
        method: 'PATCH',
        headers: authHeader(accessToken),
        body: JSON.stringify(patch),
      }
    );
  },

  async deleteWorkspace(accessToken: string, workspaceId: string) {
    return apiCall<{ success: boolean; error?: { code: string; message: string } }>(
      `/api/organizations/workspaces/${workspaceId}`,
      {
        method: 'DELETE',
        headers: authHeader(accessToken),
      }
    );
  },

  async listMembers(accessToken: string, workspaceId: string) {
    return apiCall<{ success: boolean; data?: { memberId: string; userId: string; roleId: string; joinedAt: string; createdAt: string; updatedAt: string }[]; error?: { code: string; message: string } }>(
      `/api/organizations/workspaces/${workspaceId}/members`,
      { headers: authHeader(accessToken) }
    );
  },

  async listMembersWithIdentity(accessToken: string, workspaceId: string) {
    return apiCall<{ success: boolean; data?: TeamMember[]; error?: { code: string; message: string } }>(
      `/api/organizations/workspaces/${workspaceId}/members-with-identity`,
      { headers: authHeader(accessToken) }
    );
  },

  async listRoles(accessToken: string, workspaceId: string) {
    return apiCall<{ success: boolean; data?: { id: string; name: string; systemKey?: string; permissions: string[]; builtIn: boolean }[]; error?: { code: string; message: string } }>(
      `/api/organizations/workspaces/${workspaceId}/roles`,
      { headers: authHeader(accessToken) }
    );
  },

  async leaveWorkspace(accessToken: string, workspaceId: string) {
    return apiCall<{ success: boolean; error?: { code: string; message: string } }>(
      `/api/organizations/workspaces/${workspaceId}/leave`,
      {
        method: 'POST',
        headers: authHeader(accessToken),
      }
    );
  },

  async transferOwnership(accessToken: string, workspaceId: string, targetUserId: string, confirm: boolean) {
    return apiCall<{ success: boolean; error?: { code: string; message: string } }>(
      `/api/organizations/workspaces/${workspaceId}/transfer-ownership`,
      {
        method: 'POST',
        headers: authHeader(accessToken),
        body: JSON.stringify({ targetUserId, confirm }),
      }
    );
  },
};

// ---------------------------------------------------------------------------
// Configuration API
// ---------------------------------------------------------------------------

export const configApi = {
  async getProviderStatus(workspaceId: string, moduleId: string) {
    // Configuration's getProviderStatus is not exposed via an API route yet.
    // For now, we check via the module-specific getProviderStatus routes.
    // This will be wired in Phase 3.
    return { success: false, error: { code: 'NOT_IMPLEMENTED', message: 'Provider status API not yet wired.' } };
  },

  async listConfiguredModules(workspaceId: string) {
    return { success: false, error: { code: 'NOT_IMPLEMENTED', message: 'List configured modules API not yet wired.' } };
  },
};

// ---------------------------------------------------------------------------
// Module Status API (checks if each module's provider is configured)
// ---------------------------------------------------------------------------

export async function getModuleProviderStatus(workspaceId: string, moduleId: string): Promise<boolean> {
  // For dev/mock mode, all modules with CODELOK_AUTH_USE_MOCK=true are "configured."
  if (process.env.NEXT_PUBLIC_CODELOK_AUTH_USE_MOCK === 'true') {
    return true;
  }
  // In production, we'd call the module's getProviderStatus API route.
  // Phase 2/3 will wire these.
  return false;
}
