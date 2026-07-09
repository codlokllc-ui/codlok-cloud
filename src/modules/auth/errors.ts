/**
 * Codlok Cloud — Auth Module — Codlok-Standard Error Codes
 *
 * Per Master Spec §3.6:
 *   "Public interfaces never leak provider-specific errors (raw Stripe/Supabase
 *    errors). Each module translates provider errors into Codlok-standard
 *    error codes."
 *
 * Per Master Spec §10, Auth's public interface exposes exactly these error
 * codes (no more, no less):
 *
 *   registerUser:           EMAIL_ALREADY_EXISTS, WEAK_PASSWORD, INVALID_EMAIL
 *   loginUser:              INVALID_CREDENTIALS, ACCOUNT_LOCKED, EMAIL_NOT_VERIFIED
 *   logoutUser:             INVALID_SESSION
 *   refreshSession:         INVALID_REFRESH_TOKEN, REFRESH_TOKEN_EXPIRED
 *   verifySession:          INVALID_SESSION, SESSION_EXPIRED
 *   resetPassword:          (no errors exposed — anti-enumeration)
 *   changePassword:         INVALID_CREDENTIALS, WEAK_PASSWORD
 *   verifyEmail:            INVALID_TOKEN, TOKEN_EXPIRED
 *
 * Plus one internal-only code surfaced when Supabase credentials are not
 * configured (per §3.7 — module is "disabled" until credentials supplied):
 *
 *   AUTH_PROVIDER_NOT_CONFIGURED
 *
 * And the catch-all for unexpected internal failures:
 *
 *   INTERNAL_ERROR
 */

export const AuthErrorCode = {
  // registerUser
  EMAIL_ALREADY_EXISTS: 'EMAIL_ALREADY_EXISTS',
  WEAK_PASSWORD: 'WEAK_PASSWORD',
  INVALID_EMAIL: 'INVALID_EMAIL',

  // loginUser
  INVALID_CREDENTIALS: 'INVALID_CREDENTIALS',
  ACCOUNT_LOCKED: 'ACCOUNT_LOCKED',
  EMAIL_NOT_VERIFIED: 'EMAIL_NOT_VERIFIED',

  // logoutUser / verifySession
  INVALID_SESSION: 'INVALID_SESSION',
  SESSION_EXPIRED: 'SESSION_EXPIRED',

  // refreshSession
  INVALID_REFRESH_TOKEN: 'INVALID_REFRESH_TOKEN',
  REFRESH_TOKEN_EXPIRED: 'REFRESH_TOKEN_EXPIRED',

  // verifyEmail
  INVALID_TOKEN: 'INVALID_TOKEN',
  TOKEN_EXPIRED: 'TOKEN_EXPIRED',

  // Provider not configured (§3.7)
  AUTH_PROVIDER_NOT_CONFIGURED: 'AUTH_PROVIDER_NOT_CONFIGURED',

  // Catch-all
  INTERNAL_ERROR: 'INTERNAL_ERROR',
} as const;

export type AuthErrorCodeValue =
  (typeof AuthErrorCode)[keyof typeof AuthErrorCode];
