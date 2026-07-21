import { createHash, timingSafeEqual } from 'crypto';

function digest(value: string): Buffer {
  return createHash('sha256').update(value).digest();
}

export function verifyWorkerAuthorization(authorization: string | null, configuredSecret?: string): boolean {
  if (!configuredSecret || configuredSecret.length < 32 || !authorization?.startsWith('Bearer ')) return false;
  const supplied = authorization.slice('Bearer '.length);
  return timingSafeEqual(digest(supplied), digest(configuredSecret));
}
