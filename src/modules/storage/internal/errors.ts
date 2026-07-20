/**
 * Codlok Cloud — Storage Module — Codlok-Standard Error Codes
 *
 * Per Master Spec §18 Public Interface. Namespaced with STORAGE_ prefix.
 *
 * This file is internal to the Storage module — only index.ts imports from here.
 */

export const StorageErrorCode = {
  // createUpload
  WORKSPACE_NOT_FOUND: 'WORKSPACE_NOT_FOUND',
  PROVIDER_NOT_CONFIGURED: 'PROVIDER_NOT_CONFIGURED',
  INVALID_MIME_TYPE: 'INVALID_MIME_TYPE',
  FILE_TOO_LARGE: 'FILE_TOO_LARGE',

  // completeUpload
  UPLOAD_NOT_FOUND: 'UPLOAD_NOT_FOUND',
  CHECKSUM_MISMATCH: 'CHECKSUM_MISMATCH',
  UPLOAD_INCOMPLETE: 'UPLOAD_INCOMPLETE',
  UPLOAD_EXPIRED: 'UPLOAD_EXPIRED',

  // getDownloadUrl
  FILE_NOT_FOUND: 'FILE_NOT_FOUND',
  FILE_NOT_UPLOADED: 'FILE_NOT_UPLOADED',

  // Catch-all
  INTERNAL_ERROR: 'INTERNAL_ERROR',
} as const;

export type StorageErrorCodeValue =
  (typeof StorageErrorCode)[keyof typeof StorageErrorCode];
