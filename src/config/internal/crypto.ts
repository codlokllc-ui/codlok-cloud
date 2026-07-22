/**
 * Codlok Cloud — Configuration Service — Encryption at Rest (INTERNAL)
 *
 * Per Master Spec §16 Mandatory Rule 3: "secrets are never stored in
 * plaintext. The master-key strategy ... is an implementation decision,
 * not fixed by this spec — but the Module Build Report must explicitly
 * document which strategy was used and why."
 *
 * === MASTER-KEY STRATEGY (documented for the Build Report) ===
 *
 * Chosen: Environment-injected master key (AES-256-GCM).
 *
 * Rationale:
 *   - Cloud KMS (AWS KMS, GCP KMS) would add a network dependency and
 *     require cloud-provider-specific configuration. For an internal
 *     platform that may be self-hosted, a KMS dependency is too
 *     opinionated at this stage.
 *   - Hardware keys (HSM) are expensive and over-engineered for v1.
 *   - An environment-injected master key is the simplest strategy that
 *     satisfies §16's requirement: the key never lives in code or git,
 *     is injected at deploy time, and can be rotated by changing the
 *     env var and re-encrypting (a future migration tool would handle
 *     re-encryption; for v1, rotation means re-setting all secrets).
 *
 * Implementation:
 *   - Master key source: CODELOK_CONFIG_MASTER_KEY env var (must be
 *     32 bytes / 64 hex chars). If absent, a deterministic dev-only
 *     key is derived from a fixed salt — this is ONLY safe for local
 *     development and tests, and a warning is logged. Production
 *     deployments MUST set CODELOK_CONFIG_MASTER_KEY.
 *   - Algorithm: AES-256-GCM (authenticated encryption — detects
 *     tampering).
 *   - Each secret gets a fresh random 12-byte IV per encryption.
 *   - Ciphertext, IV, and auth tag are stored together.
 *
 * This file is INTERNAL to the Configuration Service.
 */

import { createCipheriv, createDecipheriv, randomBytes, scryptSync } from 'crypto';

const ALGORITHM = 'aes-256-gcm';
const IV_LENGTH = 12; // 96-bit IV recommended for GCM
const KEY_LENGTH = 32; // 256-bit key
const SALT = 'codlok-config-v1'; // Fixed salt for dev key derivation (NOT for production)

// ---------------------------------------------------------------------------
// Master key resolution
// ---------------------------------------------------------------------------

let _cachedKey: Buffer | null = null;

function _getMasterKey(): Buffer {
  if (_cachedKey) return _cachedKey;

  const envKey = process.env.CODELOK_CONFIG_MASTER_KEY;
  if (envKey) {
    // Accept either a 64-char hex string or a 32-char raw string.
    if (envKey.length === 64 && /^[0-9a-fA-F]+$/.test(envKey)) {
      _cachedKey = Buffer.from(envKey, 'hex');
    } else if (envKey.length === 32) {
      _cachedKey = Buffer.from(envKey, 'utf8');
    } else {
      // Fall back to deriving a key from the env var via scrypt.
      _cachedKey = scryptSync(envKey, SALT, KEY_LENGTH);
    }
    return _cachedKey;
  }

  if (process.env.NODE_ENV === 'production') {
    throw new Error('CONFIGURATION_MASTER_KEY_NOT_CONFIGURED');
  }

  // Dev/test fallback: derive a deterministic key. This is NOT secure for
  // production — log a warning.
  if (process.env.NODE_ENV !== 'test') {
    console.warn(
      '[Configuration] WARNING: CODELOK_CONFIG_MASTER_KEY not set. Using '
      + 'deterministic dev-only key. DO NOT use in production.'
    );
  }
  _cachedKey = scryptSync('codlok-dev-master-key', SALT, KEY_LENGTH);
  return _cachedKey;
}

/** Test-only: reset the cached key (so tests can change env vars). */
export function _resetMasterKeyForTesting(): void {
  _cachedKey = null;
}

// ---------------------------------------------------------------------------
// Encrypt / Decrypt
// ---------------------------------------------------------------------------

export interface EncryptedPayload {
  ciphertext: string; // base64
  iv: string;         // base64
  tag: string;        // base64
}

export function encrypt(plaintext: string): EncryptedPayload {
  const key = _getMasterKey();
  const iv = randomBytes(IV_LENGTH);
  const cipher = createCipheriv(ALGORITHM, key, iv);
  const encrypted = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return {
    ciphertext: encrypted.toString('base64'),
    iv: iv.toString('base64'),
    tag: tag.toString('base64'),
  };
}

export function decrypt(payload: EncryptedPayload): string {
  const key = _getMasterKey();
  const iv = Buffer.from(payload.iv, 'base64');
  const tag = Buffer.from(payload.tag, 'base64');
  const decipher = createDecipheriv(ALGORITHM, key, iv);
  decipher.setAuthTag(tag);
  const decrypted = Buffer.concat([
    decipher.update(Buffer.from(payload.ciphertext, 'base64')),
    decipher.final(),
  ]);
  return decrypted.toString('utf8');
}

/**
 * Verify that a payload's ciphertext does NOT contain the plaintext.
 * Used by encryption-at-rest compliance tests.
 */
export function isPlaintextVisible(payload: EncryptedPayload, plaintext: string): boolean {
  return payload.ciphertext.includes(plaintext) || payload.ciphertext.includes(Buffer.from(plaintext).toString('base64'));
}
