/**
 * Codlok Cloud — Auth Module — Provider Adapter Interface (INTERNAL)
 *
 * Per Master Spec §7 (Provider Model):
 *   Module Public Interface → Internal Provider Adapter → Third-party API
 *
 * Per Master Spec §3.1: "Each module ... owns its internal logic and internal
 * data. Exposes only a public interface."
 *
 * This file is INTERNAL to the Auth module. Other modules MUST NOT import it.
 * Only `src/modules/auth/index.ts` (the public interface) imports from here.
 *
 * The adapter abstracts Supabase Auth (the chosen provider per §5, §10). If a
 * second provider is added later (e.g. Cognito), it implements this same
 * interface and is selected by Configuration Service settings — no public
 * interface change required (§7).
 */

// ---------------------------------------------------------------------------
// Provider-side data shapes (what the adapter returns to Auth internals)
// ---------------------------------------------------------------------------

export interface ProviderUser {
  userId: string;
  email: string;
  emailVerified: boolean;
  /**
   * Optional verification token, surfaced by adapters that issue tokens
   * directly to the Auth module (e.g. Mock). When present, Auth's
   * `registerUser` includes it in the verification URL sent via Mail.
   *
   * Supabase does NOT populate this field — Supabase sends its own
   * verification email with its own token. In Supabase mode, the URL
   * Auth constructs (via Mail) is informational only; the real verification
   * email comes from Supabase.
   */
  verificationToken?: string;
}

export interface ProviderSession {
  userId: string;
  accessToken: string;
  refreshToken: string;
  /** Unix epoch seconds. */
  expiresAt: number;
}

// ---------------------------------------------------------------------------
// Errors the adapter may throw. Auth's public boundary translates these into
// Codlok-standard codes per `errors.ts`. Other modules never see these.
// ---------------------------------------------------------------------------

export class ProviderAuthError extends Error {
  constructor(
    public readonly code: string,
    message: string
  ) {
    super(message);
    this.name = 'ProviderAuthError';
  }
}

// ---------------------------------------------------------------------------
// The adapter contract
// ---------------------------------------------------------------------------

export interface AuthProviderAdapter {
  /** Create a new user. Returns the new user (emailVerified=false). */
  signUp(email: string, password: string): Promise<ProviderUser>;

  /** Exchange email+password for a session. */
  signInWithPassword(
    email: string,
    password: string
  ): Promise<ProviderSession>;

  /** Invalidate an access token. No-op if token is already invalid. */
  signOut(accessToken: string): Promise<void>;

  /** Exchange a refresh token for a new session. */
  refreshSession(refreshToken: string): Promise<ProviderSession>;

  /** Resolve a user from an access token. Returns null if invalid/expired. */
  getUserByAccessToken(
    accessToken: string
  ): Promise<{ user: ProviderUser; expired: false } | { expired: true } | null>;

  /** Trigger a password-reset email flow on the provider side. */
  triggerPasswordResetEmail(email: string, redirectUrl?: string): Promise<void>;

  /** Change a user's password. Verifies the old password first. */
  updateUserPassword(
    userId: string,
    oldPassword: string,
    newPassword: string
  ): Promise<void>;

  /** Verify an email-verification token issued at signUp time. */
  verifyEmailToken(token: string): Promise<ProviderUser | null>;
}
