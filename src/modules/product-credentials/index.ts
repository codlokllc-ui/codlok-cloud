import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
import { fail, ok, type StandardResponse } from '@/shared';
import { credentialStore } from './internal/store';
import { PRODUCT_SCOPES, type CredentialEnvironment, type CredentialRecord, type ProductScope } from './internal/types';

export type { CredentialEnvironment, ProductScope } from './internal/types';

export interface CredentialMetadata {
  credentialId: string;
  workspaceId: string;
  name: string;
  environment: CredentialEnvironment;
  scopes: ProductScope[];
  keyPrefix: string;
  createdAt: string;
  expiresAt: string | null;
  revokedAt: string | null;
  lastUsedAt: string | null;
}

export interface AuthenticatedProductContext {
  credentialId: string;
  workspaceId: string;
  environment: CredentialEnvironment;
  scopes: ProductScope[];
}

const ENVIRONMENTS = new Set<CredentialEnvironment>(['development', 'staging', 'production']);
const SCOPES = new Set<string>(PRODUCT_SCOPES);
const KEY_PATTERN = /^cdlk_(dev|stg|prd)_([a-f0-9]{24})\.([A-Za-z0-9_-]{43})$/;

function pepper(): string {
  return process.env.CODELOK_API_KEY_PEPPER ?? 'codlok-development-pepper-not-for-production';
}

function productionPepperIsConfigured(): boolean {
  return process.env.NODE_ENV !== 'production' || Boolean(process.env.CODELOK_API_KEY_PEPPER?.trim());
}

function digest(secret: string): string {
  return createHmac('sha256', pepper()).update(secret).digest('hex');
}

function environmentCode(environment: CredentialEnvironment): 'dev' | 'stg' | 'prd' {
  return environment === 'development' ? 'dev' : environment === 'staging' ? 'stg' : 'prd';
}

function metadata(record: CredentialRecord): CredentialMetadata {
  const { keyDigest: _keyDigest, ...safe } = record;
  void _keyDigest;
  return { ...safe, scopes: [...safe.scopes] };
}

export function createCredential(input: {
  workspaceId: string;
  name: string;
  environment: CredentialEnvironment;
  scopes: ProductScope[];
  expiresAt?: string | null;
}): StandardResponse<{ apiKey: string; credential: CredentialMetadata }> {
  if (!input.workspaceId.trim()) return fail('WORKSPACE_REQUIRED', 'Workspace is required.');
  if (!input.name.trim()) return fail('NAME_REQUIRED', 'Credential name is required.');
  if (!ENVIRONMENTS.has(input.environment)) return fail('INVALID_ENVIRONMENT', 'Credential environment is invalid.');
  if (!input.scopes.length) return fail('SCOPES_REQUIRED', 'At least one scope is required.');
  if (input.scopes.some((scope) => !SCOPES.has(scope))) return fail('INVALID_SCOPE', 'One or more credential scopes are invalid.');
  if (new Set(input.scopes).size !== input.scopes.length) return fail('DUPLICATE_SCOPE', 'Credential scopes must be unique.');
  if (!productionPepperIsConfigured()) {
    return fail('API_KEY_PEPPER_NOT_CONFIGURED', 'API key security is not configured for production.');
  }

  const expiresAt = input.expiresAt ?? null;
  if (expiresAt && (!Number.isFinite(Date.parse(expiresAt)) || Date.parse(expiresAt) <= Date.now())) {
    return fail('INVALID_EXPIRY', 'Credential expiry must be a future timestamp.');
  }

  const credentialId = randomBytes(12).toString('hex');
  const secret = randomBytes(32).toString('base64url');
  const prefix = `cdlk_${environmentCode(input.environment)}_${credentialId}`;
  const record: CredentialRecord = {
    credentialId,
    workspaceId: input.workspaceId,
    name: input.name.trim(),
    environment: input.environment,
    scopes: [...input.scopes],
    keyPrefix: prefix.slice(0, 18),
    keyDigest: digest(secret),
    createdAt: new Date().toISOString(),
    expiresAt,
    revokedAt: null,
    lastUsedAt: null,
  };
  credentialStore.insert(record);
  return ok({ apiKey: `${prefix}.${secret}`, credential: metadata(record) });
}

export function authenticateCredential(apiKey: string): StandardResponse<AuthenticatedProductContext> {
  const match = KEY_PATTERN.exec(apiKey);
  if (!match) return fail('INVALID_API_KEY', 'API key is invalid.');
  const credentialId = match[2];
  const secret = match[3];
  const record = credentialStore.get(credentialId);
  if (!record) return fail('INVALID_API_KEY', 'API key is invalid.');
  const actual = Buffer.from(digest(secret), 'hex');
  const expected = Buffer.from(record.keyDigest, 'hex');
  if (actual.length !== expected.length || !timingSafeEqual(actual, expected)) {
    return fail('INVALID_API_KEY', 'API key is invalid.');
  }
  if (record.revokedAt) return fail('API_KEY_REVOKED', 'API key has been revoked.');
  if (record.expiresAt && Date.parse(record.expiresAt) <= Date.now()) {
    return fail('API_KEY_EXPIRED', 'API key has expired.');
  }
  record.lastUsedAt = new Date().toISOString();
  return ok({
    credentialId: record.credentialId,
    workspaceId: record.workspaceId,
    environment: record.environment,
    scopes: [...record.scopes],
  });
}

export function revokeCredential(workspaceId: string, credentialId: string): StandardResponse<CredentialMetadata> {
  const record = credentialStore.get(credentialId);
  if (!record || record.workspaceId !== workspaceId) return fail('CREDENTIAL_NOT_FOUND', 'Credential was not found.');
  if (!record.revokedAt) record.revokedAt = new Date().toISOString();
  return ok(metadata(record));
}

export function listCredentials(workspaceId: string): StandardResponse<CredentialMetadata[]> {
  if (!workspaceId.trim()) return fail('WORKSPACE_REQUIRED', 'Workspace is required.');
  return ok(credentialStore.list(workspaceId).map(metadata));
}

export const ProductCredentials = {
  createCredential,
  authenticateCredential,
  revokeCredential,
  listCredentials,
};
