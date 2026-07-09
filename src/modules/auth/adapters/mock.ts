/**
 * Codlok Cloud — Auth Module — Mock Adapter (INTERNAL, testing/demo only)
 *
 * Purpose: enables Auth tests and the demo UI to run end-to-end without real
 * Supabase credentials.
 *
 * Compliance with §3.7 ("Provider credentials are never auto-created. ... No
 * fake defaults, no silent fallback credentials."):
 *
 *   This adapter is NEVER selected automatically by the Auth public
 *   interface. It is only used when:
 *     (a) the explicit `CODELOK_AUTH_USE_MOCK=true` env var is set (local dev
 *         and demo only — checked by the adapter factory), OR
 *     (b) tests inject it directly through the adapter setter.
 *
 *   Production deployments with `CODELOK_AUTH_USE_MOCK` unset and no Supabase
 *   credentials configured will correctly return AUTH_PROVIDER_NOT_CONFIGURED
 *   — never silently falling back to Mock.
 *
 * This file is INTERNAL to the Auth module.
 */

import {
  AuthProviderAdapter,
  ProviderUser,
  ProviderSession,
  ProviderAuthError,
} from './types';

// ---------------------------------------------------------------------------
// In-memory store (resets on process restart; isolated per MockAuthAdapter
// instance so parallel tests don't collide).
// ---------------------------------------------------------------------------

interface MockUserRow extends ProviderUser {
  password: string;
  locked: boolean;
}

interface MockSessionRow {
  accessToken: string;
  refreshToken: string;
  userId: string;
  expiresAt: number;
  revoked: boolean;
}

export class MockAuthAdapter implements AuthProviderAdapter {
  private users = new Map<string, MockUserRow>();        // keyed by email
  private usersById = new Map<string, MockUserRow>();    // keyed by userId
  private sessions = new Map<string, MockSessionRow>();  // keyed by accessToken
  private refreshTokens = new Map<string, MockSessionRow>(); // keyed by refreshToken
  private verificationTokens = new Map<string, string>(); // token → userId
  private clockOffsetMs = 0;

  // -- helpers -----------------------------------------------------------

  private newId(prefix: string): string {
    return `${prefix}_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`;
  }

  /** Advance the internal clock (for testing expiry). */
  _advanceClock(ms: number): void {
    this.clockOffsetMs += ms;
  }

  private now(): number {
    return Date.now() + this.clockOffsetMs;
  }

  // -- AuthProviderAdapter implementation --------------------------------

  async signUp(email: string, password: string): Promise<ProviderUser> {
    await Promise.resolve();
    if (this.users.has(email.toLowerCase())) {
      throw new ProviderAuthError('EMAIL_ALREADY_EXISTS', 'Mock: email exists.');
    }
    if (password.length < 8) {
      throw new ProviderAuthError('WEAK_PASSWORD', 'Mock: password < 8 chars.');
    }
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) {
      throw new ProviderAuthError('INVALID_EMAIL', 'Mock: invalid email format.');
    }
    const user: MockUserRow = {
      userId: this.newId('user'),
      email,
      emailVerified: false,
      password,
      locked: false,
    };
    this.users.set(email.toLowerCase(), user);
    this.usersById.set(user.userId, user);
    // Auto-issue a verification token (mock-side).
    const token = this.newId('vtoken');
    this.verificationTokens.set(token, user.userId);
    (user as MockUserRow & { _latestVerificationToken?: string })._latestVerificationToken = token;
    return {
      userId: user.userId,
      email: user.email,
      emailVerified: user.emailVerified,
      // Surface the token so the Auth module can include it in the
      // verification URL. (Supabase adapter leaves this undefined — Supabase
      // sends its own verification email with its own token.)
      verificationToken: token,
    };
  }

  async signInWithPassword(
    email: string,
    password: string
  ): Promise<ProviderSession> {
    await Promise.resolve();
    const user = this.users.get(email.toLowerCase());
    if (!user || user.password !== password) {
      throw new ProviderAuthError('INVALID_CREDENTIALS', 'Mock: bad credentials.');
    }
    if (user.locked) {
      throw new ProviderAuthError('ACCOUNT_LOCKED', 'Mock: account locked.');
    }
    if (!user.emailVerified) {
      throw new ProviderAuthError('EMAIL_NOT_VERIFIED', 'Mock: email not verified.');
    }
    const session: MockSessionRow = {
      accessToken: this.newId('access'),
      refreshToken: this.newId('refresh'),
      userId: user.userId,
      expiresAt: Math.floor((this.now() + 3600 * 1000) / 1000),
      revoked: false,
    };
    this.sessions.set(session.accessToken, session);
    this.refreshTokens.set(session.refreshToken, session);
    return { ...session };
  }

  async signOut(accessToken: string): Promise<void> {
    await Promise.resolve();
    const s = this.sessions.get(accessToken);
    if (s) s.revoked = true;
  }

  async refreshSession(refreshToken: string): Promise<ProviderSession> {
    await Promise.resolve();
    const existing = this.refreshTokens.get(refreshToken);
    if (!existing) {
      throw new ProviderAuthError('INVALID_REFRESH_TOKEN', 'Mock: refresh token not recognized.');
    }
    const nowSec = Math.floor(this.now() / 1000);
    // Refresh tokens in mock live for 7 days from session creation.
    if (existing.expiresAt + 7 * 24 * 3600 < nowSec) {
      throw new ProviderAuthError('REFRESH_TOKEN_EXPIRED', 'Mock: refresh token expired.');
    }
    existing.revoked = true;
    const session: MockSessionRow = {
      accessToken: this.newId('access'),
      refreshToken: this.newId('refresh'),
      userId: existing.userId,
      expiresAt: Math.floor((this.now() + 3600 * 1000) / 1000),
      revoked: false,
    };
    this.sessions.set(session.accessToken, session);
    this.refreshTokens.set(session.refreshToken, session);
    return { ...session };
  }

  async getUserByAccessToken(
    accessToken: string
  ): Promise<{ user: ProviderUser; expired: false } | { expired: true } | null> {
    await Promise.resolve();
    const s = this.sessions.get(accessToken);
    if (!s) return null;
    if (s.revoked) return null;
    const nowSec = Math.floor(this.now() / 1000);
    if (s.expiresAt < nowSec) return { expired: true };
    const user = this.usersById.get(s.userId);
    if (!user) return null;
    return {
      expired: false,
      user: { userId: user.userId, email: user.email, emailVerified: user.emailVerified },
    };
  }

  async triggerPasswordResetEmail(email: string): Promise<void> {
    await Promise.resolve();
    // Per §10 resetPassword: anti-enumeration. We don't reveal whether the
    // email exists. Mock silently no-ops if user not found.
    void email;
  }

  async updateUserPassword(
    userId: string,
    oldPassword: string,
    newPassword: string
  ): Promise<void> {
    await Promise.resolve();
    const user = this.usersById.get(userId);
    if (!user) {
      throw new ProviderAuthError('PROVIDER_UNKNOWN_ERROR', 'Mock: user not found.');
    }
    if (user.password !== oldPassword) {
      throw new ProviderAuthError('INVALID_CREDENTIALS', 'Mock: old password wrong.');
    }
    if (newPassword.length < 8) {
      throw new ProviderAuthError('WEAK_PASSWORD', 'Mock: new password < 8 chars.');
    }
    user.password = newPassword;
  }

  async verifyEmailToken(token: string): Promise<ProviderUser | null> {
    await Promise.resolve();
    const userId = this.verificationTokens.get(token);
    if (!userId) {
      throw new ProviderAuthError('INVALID_TOKEN', 'Mock: token not recognized.');
    }
    const user = this.usersById.get(userId);
    if (!user) return null;
    user.emailVerified = true;
    this.verificationTokens.delete(token);
    return { userId: user.userId, email: user.email, emailVerified: true };
  }

  async getUserByUserId(userId: string): Promise<ProviderUser | null> {
    await Promise.resolve();
    const user = this.usersById.get(userId);
    if (!user) return null;
    return {
      userId: user.userId,
      email: user.email,
      emailVerified: user.emailVerified,
    };
  }

  // -- Mock-only helpers (test access) -----------------------------------

  /** Test helper: lock a user to simulate ACCOUNT_LOCKED. */
  _lockUser(email: string): void {
    const u = this.users.get(email.toLowerCase());
    if (u) u.locked = true;
  }

  /** Test helper: get the latest verification token for a user. */
  _getLatestVerificationToken(email: string): string | undefined {
    const u = this.users.get(email.toLowerCase());
    if (!u) return undefined;
    return (u as MockUserRow & { _latestVerificationToken?: string })._latestVerificationToken;
  }

  /** Test helper: verify a user's email directly (bypassing token flow). */
  _markEmailVerified(email: string): void {
    const u = this.users.get(email.toLowerCase());
    if (u) u.emailVerified = true;
  }
}
