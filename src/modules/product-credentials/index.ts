import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
import { fail, ok, type StandardResponse } from '@/shared';
import { getCredentialRepository } from './internal/repository';
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
  createdBy: string;
  rotatedFromCredentialId: string | null;
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

export async function createCredential(input: {
  workspaceId: string;
  name: string;
  environment: CredentialEnvironment;
  scopes: ProductScope[];
  expiresAt?: string | null;
  createdBy?: string;
  rotatedFromCredentialId?: string | null;
}): Promise<StandardResponse<{ apiKey: string; credential: CredentialMetadata }>> {
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
    createdBy: input.createdBy ?? 'system',
    createdAt: new Date().toISOString(),
    expiresAt,
    revokedAt: null,
    lastUsedAt: null,
    rotatedFromCredentialId: input.rotatedFromCredentialId ?? null,
  };
  try { await getCredentialRepository().insert(record); }
  catch { return fail('CREDENTIAL_PERSISTENCE_FAILED', 'Credential could not be stored.'); }
  return ok({ apiKey: `${prefix}.${secret}`, credential: metadata(record) });
}

export async function authenticateCredential(apiKey: string): Promise<StandardResponse<AuthenticatedProductContext>> {
  const match = KEY_PATTERN.exec(apiKey);
  if (!match) return fail('INVALID_API_KEY', 'API key is invalid.');
  const credentialId = match[2];
  const secret = match[3];
  let record: CredentialRecord | undefined;
  try { record = await getCredentialRepository().get(credentialId); }
  catch { return fail('CREDENTIAL_LOOKUP_FAILED', 'Credential could not be verified.'); }
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
  const usedAt = new Date().toISOString();
  let active: boolean;
  try { active = await getCredentialRepository().touchActive(record.credentialId, usedAt); }
  catch { return fail('CREDENTIAL_UPDATE_FAILED', 'Credential usage could not be recorded.'); }
  if (!active) return fail('API_KEY_INACTIVE', 'API key is no longer active.');
  return ok({
    credentialId: record.credentialId,
    workspaceId: record.workspaceId,
    environment: record.environment,
    scopes: [...record.scopes],
  });
}

export async function revokeCredential(workspaceId: string, credentialId: string): Promise<StandardResponse<CredentialMetadata>> {
  let record: CredentialRecord | undefined;
  try { record = await getCredentialRepository().get(credentialId); }
  catch { return fail('CREDENTIAL_LOOKUP_FAILED', 'Credential could not be loaded.'); }
  if (!record || record.workspaceId !== workspaceId) return fail('CREDENTIAL_NOT_FOUND', 'Credential was not found.');
  if (!record.revokedAt) record.revokedAt = new Date().toISOString();
  try { await getCredentialRepository().update(record); }
  catch { return fail('CREDENTIAL_UPDATE_FAILED', 'Credential could not be revoked.'); }
  return ok(metadata(record));
}

export async function listCredentials(workspaceId: string): Promise<StandardResponse<CredentialMetadata[]>> {
  if (!workspaceId.trim()) return fail('WORKSPACE_REQUIRED', 'Workspace is required.');
  try { return ok((await getCredentialRepository().list(workspaceId)).map(metadata)); }
  catch { return fail('CREDENTIAL_LIST_FAILED', 'Credentials could not be listed.'); }
}

export async function rotateCredential(workspaceId: string, credentialId: string, actorUserId: string) {
  let existing: CredentialRecord | undefined;
  try { existing = await getCredentialRepository().get(credentialId); }
  catch { return fail('CREDENTIAL_LOOKUP_FAILED', 'Credential could not be loaded.'); }
  if (!existing || existing.workspaceId !== workspaceId) return fail('CREDENTIAL_NOT_FOUND', 'Credential was not found.');
  if (existing.revokedAt) return fail('API_KEY_REVOKED', 'API key has been revoked.');
  if (!productionPepperIsConfigured()) return fail('API_KEY_PEPPER_NOT_CONFIGURED', 'API key security is not configured for production.');
  const replacementId = randomBytes(12).toString('hex');
  const secret = randomBytes(32).toString('base64url');
  const prefix = `cdlk_${environmentCode(existing.environment)}_${replacementId}`;
  const now = new Date().toISOString();
  const replacement: CredentialRecord = {
    ...existing,
    credentialId: replacementId,
    keyPrefix: prefix.slice(0, 18),
    keyDigest: digest(secret),
    createdBy: actorUserId,
    createdAt: now,
    revokedAt: null,
    lastUsedAt: null,
    rotatedFromCredentialId: credentialId,
  };
  try {
    const rotated = await getCredentialRepository().rotate(credentialId, replacement, now);
    if (!rotated) return fail('ROTATION_FAILED', 'Credential rotation could not be completed.');
  } catch {
    return fail('ROTATION_FAILED', 'Credential rotation could not be completed.');
  }
  return ok({ apiKey: `${prefix}.${secret}`, credential: metadata(replacement) });
}

export const ProductCredentials = {
  createCredential,
  authenticateCredential,
  revokeCredential,
  listCredentials,
  rotateCredential,
};
