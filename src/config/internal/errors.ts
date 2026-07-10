/**
 * Codlok Cloud — Configuration Service — Codlok-Standard Error Codes
 *
 * Per Master Spec §16 Public Interface. Namespaced with CONFIG_ prefix.
 *
 * This file is internal to the Configuration Service — only index.ts
 * (the public interface) imports from here.
 */

export const ConfigErrorCode = {
  // getSecret
  SECRET_NOT_CONFIGURED: 'SECRET_NOT_CONFIGURED',
  WORKSPACE_NOT_FOUND: 'WORKSPACE_NOT_FOUND',

  // setSecret
  INVALID_KEY: 'INVALID_KEY',

  // deleteSecret
  // (reuses SECRET_NOT_CONFIGURED, WORKSPACE_NOT_FOUND)

  // getProviderStatus
  UNKNOWN_MODULE: 'UNKNOWN_MODULE',

  // getFeatureFlag / setFeatureFlag
  FEATURE_FLAG_NOT_FOUND: 'FEATURE_FLAG_NOT_FOUND',

  // Catch-all
  INTERNAL_ERROR: 'INTERNAL_ERROR',
  ENCRYPTION_ERROR: 'ENCRYPTION_ERROR',
} as const;

export type ConfigErrorCodeValue =
  (typeof ConfigErrorCode)[keyof typeof ConfigErrorCode];
