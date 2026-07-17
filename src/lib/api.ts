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

export interface ProductCredential {
  credentialId: string;
  workspaceId: string;
  name: string;
  environment: 'development' | 'staging' | 'production';
  scopes: string[];
  keyPrefix: string;
  createdAt: string;
  expiresAt: string | null;
  revokedAt: string | null;
  lastUsedAt: string | null;
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

// ---------------------------------------------------------------------------
// Dashboard Module Data API
// ---------------------------------------------------------------------------

export interface PaginatedData<T = Record<string, unknown>> {
  items: T[];
  hasMore: boolean;
  nextCursor: string | null;
}

export interface ProviderMetadataDto {
  providerId: string;
  moduleId: string;
  displayName: string;
  category: string;
  defaultProvider: boolean;
  supportsTestConnection: boolean;
  supportsRotation: boolean;
  supportsDisconnect: boolean;
  routing: 'DIRECT';
}

export interface ProviderStatusDto {
  moduleId: string;
  configured: boolean;
  requiredKeys: string[];
  missingKeys: string[];
}

function withQuery(path: string, query: Record<string, string | number | undefined>): string {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(query)) {
    if (value !== undefined && value !== '') params.set(key, String(value));
  }
  const suffix = params.toString();
  return suffix ? `${path}?${suffix}` : path;
}

export const moduleDataApi = {
  async list(accessToken: string, moduleId: string, workspaceId: string, cursor?: string, limit = 20) {
    return apiCall<{ success: boolean; data?: Record<string, unknown>; error?: { code: string; message: string } }>(
      withQuery(`/api/${moduleId}/list`, { workspaceId, cursor, limit }),
      { headers: authHeader(accessToken) }
    );
  },

  async get(accessToken: string, moduleId: string, workspaceId: string, id: string) {
    return apiCall<{ success: boolean; data?: Record<string, unknown>; error?: { code: string; message: string } }>(
      withQuery(`/api/${moduleId}/${encodeURIComponent(id)}`, { workspaceId }),
      { headers: authHeader(accessToken) }
    );
  },
};

export const configStatusApi = {
  async getStatus(accessToken: string, workspaceId: string, moduleId: string) {
    return apiCall<{ success: boolean; data?: ProviderStatusDto; error?: { code: string; message: string } }>(
      withQuery(`/api/config/provider-status/${encodeURIComponent(moduleId)}`, { workspaceId }),
      { headers: authHeader(accessToken) }
    );
  },
};

export const providerRegistryApi = {
  async listAll(accessToken: string) {
    return apiCall<{ success: boolean; data?: { providers: ProviderMetadataDto[] }; error?: { code: string; message: string } }>(
      '/api/config/providers',
      { headers: authHeader(accessToken) }
    );
  },
  async listByModule(accessToken: string, moduleId: string) {
    return apiCall<{ success: boolean; data?: { providers: ProviderMetadataDto[] }; error?: { code: string; message: string } }>(
      `/api/config/providers/${encodeURIComponent(moduleId)}`,
      { headers: authHeader(accessToken) }
    );
  },
};

export const secretsApi = {
  async check(accessToken: string, workspaceId: string, key: string) {
    return apiCall<{ success: boolean; data?: { configured: boolean }; error?: { code: string; message: string } }>(
      withQuery('/api/config/secrets', { workspaceId, key }),
      { headers: authHeader(accessToken) }
    );
  },
  async set(accessToken: string, workspaceId: string, key: string, value: string) {
    return apiCall<{ success: boolean; data?: { key: string; configured: true; version: number }; error?: { code: string; message: string } }>(
      '/api/config/secrets',
      { method: 'POST', headers: authHeader(accessToken), body: JSON.stringify({ workspaceId, key, value }) }
    );
  },
  async delete(accessToken: string, workspaceId: string, key: string) {
    return apiCall<{ success: boolean; data?: { key: string; configured: false }; error?: { code: string; message: string } }>(
      withQuery(`/api/config/secrets/${encodeURIComponent(key)}`, { workspaceId }),
      { method: 'DELETE', headers: authHeader(accessToken) }
    );
  },
};

export const settingsApi = {
  async get(accessToken: string, workspaceId: string, key: string) {
    return apiCall<{ success: boolean; data?: { key: string; value: string; version: number; updatedBy: string; updatedAt: string }; error?: { code: string; message: string } }>(
      withQuery(`/api/config/settings/${encodeURIComponent(key)}`, { workspaceId }),
      { headers: authHeader(accessToken) }
    );
  },
  async set(accessToken: string, workspaceId: string, key: string, value: string) {
    return apiCall<{ success: boolean; data?: { key: string; value: string; version: number; updatedBy: string; updatedAt: string }; error?: { code: string; message: string } }>(
      `/api/config/settings/${encodeURIComponent(key)}`,
      { method: 'POST', headers: authHeader(accessToken), body: JSON.stringify({ workspaceId, value }) }
    );
  },
  async delete(accessToken: string, workspaceId: string, key: string) {
    return apiCall<{ success: boolean; data?: { key: string; configured: false }; error?: { code: string; message: string } }>(
      withQuery(`/api/config/settings/${encodeURIComponent(key)}`, { workspaceId }),
      { method: 'DELETE', headers: authHeader(accessToken) }
    );
  },
};

export const credentialsApi = {
  async list(accessToken: string, workspaceId: string) {
    return apiCall<{ success: boolean; data?: ProductCredential[]; error?: { code: string; message: string } }>(
      `/api/control/v1/workspaces/${encodeURIComponent(workspaceId)}/credentials`,
      { headers: authHeader(accessToken) }
    );
  },
  async create(accessToken: string, workspaceId: string, input: { name: string; environment: ProductCredential['environment']; scopes: string[] }) {
    return apiCall<{ success: boolean; data?: { apiKey: string; credential: ProductCredential }; error?: { code: string; message: string } }>(
      `/api/control/v1/workspaces/${encodeURIComponent(workspaceId)}/credentials`,
      { method: 'POST', headers: authHeader(accessToken), body: JSON.stringify(input) }
    );
  },
  async revoke(accessToken: string, workspaceId: string, credentialId: string) {
    return apiCall<{ success: boolean; data?: ProductCredential; error?: { code: string; message: string } }>(
      `/api/control/v1/workspaces/${encodeURIComponent(workspaceId)}/credentials/${encodeURIComponent(credentialId)}`,
      { method: 'DELETE', headers: authHeader(accessToken) }
    );
  },
  async rotate(accessToken: string, workspaceId: string, credentialId: string) {
    return apiCall<{ success: boolean; data?: { apiKey: string; credential: ProductCredential }; error?: { code: string; message: string } }>(
      `/api/control/v1/workspaces/${encodeURIComponent(workspaceId)}/credentials/${encodeURIComponent(credentialId)}/rotate`,
      { method: 'POST', headers: authHeader(accessToken) }
    );
  },
};
