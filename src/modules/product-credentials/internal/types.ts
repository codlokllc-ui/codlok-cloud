export type CredentialEnvironment = 'development' | 'staging' | 'production';

export type ProductScope =
  | 'auth:read'
  | 'auth:write'
  | 'mail:send'
  | 'notifications:send'
  | 'pay:read'
  | 'pay:write'
  | 'sms:send'
  | 'storage:read'
  | 'storage:write'
  | 'verify:read'
  | 'verify:write';

export const PRODUCT_SCOPES: readonly ProductScope[] = [
  'auth:read',
  'auth:write',
  'mail:send',
  'notifications:send',
  'pay:read',
  'pay:write',
  'sms:send',
  'storage:read',
  'storage:write',
  'verify:read',
  'verify:write',
];

export interface CredentialRecord {
  credentialId: string;
  workspaceId: string;
  name: string;
  environment: CredentialEnvironment;
  scopes: ProductScope[];
  keyPrefix: string;
  keyDigest: string;
  createdAt: string;
  expiresAt: string | null;
  revokedAt: string | null;
  lastUsedAt: string | null;
}
