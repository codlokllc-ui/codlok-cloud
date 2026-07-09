/**
 * Codlok Cloud — Auth Module — Public Interface (v1.0)
 *
 * Per Master Spec §10 — Auth Module Specification v1.0 (fully specified —
 * first module to build).
 *
 * Purpose: Answers "who is this user?" — identity and authentication only.
 * Nothing about roles, workspaces, or permissions (that is Organizations, §9).
 *
 * Provider adapter: Supabase Auth.
 *
 * ----------------------------------------------------------------------------
 * PUBLIC SURFACE (this is the ONLY thing other modules may import from Auth)
 * ----------------------------------------------------------------------------
 *
 *   registerUser(email, password, ctx?)           → §10.1
 *   loginUser(email, password, ctx?)              → §10.2
 *   logoutUser(accessToken, ctx?)                  → §10.3
 *   refreshSession(refreshToken, ctx?)             → §10.4
 *   verifySession(accessToken, ctx?)               → §10.5
 *   resetPassword(email, ctx?)                     → §10.6
 *   changePassword(userId, oldPassword, newPassword, ctx?)  → §10.7
 *   verifyEmail(token, ctx?)                       → §10.8
 *
 * Every function returns the StandardResponse shape (§3.6). No exceptions.
 *
 * ----------------------------------------------------------------------------
 * DEPENDENCIES (called through their public interface only — §3.3, §10)
 * ----------------------------------------------------------------------------
 *   - Mail.sendVerificationEmail()
 *   - Mail.sendPasswordResetEmail()
 *   - Configuration Service (§3.4) — for Supabase credential resolution
 *
 * Auth does NOT know how Mail delivers, queues, or retries. Auth does NOT
 * know what Supabase returns on errors. Both are entirely internal.
 */

import { StandardResponse, ok, fail, ModuleError, WorkspaceContext } from '@/shared';
import { Mail } from '@/modules/mail';
import { resolveAdapter } from './adapters/factory';
import { AuthErrorCode } from './errors';

// ---------------------------------------------------------------------------
// Public data shapes (per §10 — exact)
// ---------------------------------------------------------------------------

export interface RegisterUserData {
  userId: string;
  email: string;
  emailVerified: false; // always false immediately after registerUser
}

export interface LoginUserData {
  userId: string;
  accessToken: string;
  refreshToken: string;
  /** Unix epoch seconds. */
  expiresAt: number;
}

export interface RefreshSessionData {
  accessToken: string;
  refreshToken: string;
  expiresAt: number;
}

export interface VerifySessionData {
  userId: string;
  valid: true;
}

export interface ResetPasswordData {
  sent: true; // always true — anti-enumeration per §10
}

export interface VerifyEmailData {
  userId: string;
  emailVerified: true; // always true after verifyEmail
}

// Added in v1.1 — backs Auth.getUser(userId) per §10 v1.1 and §3.8 Identity
// Ownership Rule. Used by other modules (e.g. Organizations) to resolve a
// stored userId into current identity attributes without holding a session
// token. emailVerified is `boolean` (not `true`) here because getUser may be
// called for users who have not yet verified their email.
export interface GetUserData {
  userId: string;
  email: string;
  emailVerified: boolean;
}

// ---------------------------------------------------------------------------
// Internal: translate ProviderAuthError → ModuleError with Codlok code
// ---------------------------------------------------------------------------

function translateProviderError(err: unknown): ModuleError {
  // ModuleError already carries a Codlok-standard code (e.g. INVALID_SESSION
  // thrown by verifySession, or AUTH_PROVIDER_NOT_CONFIGURED thrown by
  // requireAdapter). Pass through directly.
  //
  // NOTE: We use duck-typing (err.name === 'ModuleError') rather than
  // `instanceof ModuleError` because Next.js dev mode may load the Auth
  // module multiple times across route handlers, and `instanceof` checks
  // fail across module instances. The class name is a stable identifier.
  if (err instanceof Error && err.name === 'ModuleError') {
    const code = (err as { code?: string }).code ?? AuthErrorCode.INTERNAL_ERROR;
    const message = err.message || 'An internal error occurred.';
    return new ModuleError(code, message);
  }
  // ProviderAuthError: same duck-typing approach for the same reason.
  if (err instanceof Error && err.name === 'ProviderAuthError') {
    const providerCode = (err as { code?: string }).code ?? 'PROVIDER_UNKNOWN_ERROR';
    // Map provider-internal codes to Codlok-standard AuthErrorCode values.
    // Unknown provider codes become INTERNAL_ERROR (never leak provider text).
    const known: Record<string, string> = {
      EMAIL_ALREADY_EXISTS: AuthErrorCode.EMAIL_ALREADY_EXISTS,
      WEAK_PASSWORD: AuthErrorCode.WEAK_PASSWORD,
      INVALID_EMAIL: AuthErrorCode.INVALID_EMAIL,
      INVALID_CREDENTIALS: AuthErrorCode.INVALID_CREDENTIALS,
      ACCOUNT_LOCKED: AuthErrorCode.ACCOUNT_LOCKED,
      EMAIL_NOT_VERIFIED: AuthErrorCode.EMAIL_NOT_VERIFIED,
      INVALID_SESSION: AuthErrorCode.INVALID_SESSION,
      SESSION_EXPIRED: AuthErrorCode.SESSION_EXPIRED,
      INVALID_REFRESH_TOKEN: AuthErrorCode.INVALID_REFRESH_TOKEN,
      REFRESH_TOKEN_EXPIRED: AuthErrorCode.REFRESH_TOKEN_EXPIRED,
      INVALID_TOKEN: AuthErrorCode.INVALID_TOKEN,
      TOKEN_EXPIRED: AuthErrorCode.TOKEN_EXPIRED,
      USER_NOT_FOUND: AuthErrorCode.USER_NOT_FOUND,
    };
    const code = known[providerCode] ?? AuthErrorCode.INTERNAL_ERROR;
    // Use a Codlok-standard message (NOT the provider's raw message) for the
    // codes we surface. This guarantees §3.6 — no provider text leaks.
    const messages: Record<string, string> = {
      [AuthErrorCode.EMAIL_ALREADY_EXISTS]: 'An account with this email already exists.',
      [AuthErrorCode.WEAK_PASSWORD]: 'Password does not meet strength requirements.',
      [AuthErrorCode.INVALID_EMAIL]: 'Email address is invalid.',
      [AuthErrorCode.INVALID_CREDENTIALS]: 'Invalid email or password.',
      [AuthErrorCode.ACCOUNT_LOCKED]: 'Account is locked. Please contact support.',
      [AuthErrorCode.EMAIL_NOT_VERIFIED]: 'Please verify your email before signing in.',
      [AuthErrorCode.INVALID_SESSION]: 'Session is invalid or already revoked.',
      [AuthErrorCode.SESSION_EXPIRED]: 'Session has expired. Please sign in again.',
      [AuthErrorCode.INVALID_REFRESH_TOKEN]: 'Refresh token is invalid.',
      [AuthErrorCode.REFRESH_TOKEN_EXPIRED]: 'Refresh token has expired. Please sign in again.',
      [AuthErrorCode.INVALID_TOKEN]: 'Token is invalid.',
      [AuthErrorCode.TOKEN_EXPIRED]: 'Token has expired.',
      [AuthErrorCode.USER_NOT_FOUND]: 'User not found.',
      [AuthErrorCode.INTERNAL_ERROR]: 'An internal error occurred.',
    };
    return new ModuleError(code, messages[code] ?? 'An internal error occurred.');
  }
  // Unknown error — never leak err.message.
  return new ModuleError(AuthErrorCode.INTERNAL_ERROR, 'An internal error occurred.');
}

// ---------------------------------------------------------------------------
// Internal: resolve adapter, returning AUTH_PROVIDER_NOT_CONFIGURED if missing
// ---------------------------------------------------------------------------

async function requireAdapter(ctx?: WorkspaceContext) {
  const adapter = await resolveAdapter(ctx?.workspaceId);
  if (!adapter) {
    throw new ModuleError(
      AuthErrorCode.AUTH_PROVIDER_NOT_CONFIGURED,
      'Auth provider is not configured for this workspace.'
    );
  }
  return adapter;
}

// ---------------------------------------------------------------------------
// §10.1 — registerUser(email, password, ctx?)
// ---------------------------------------------------------------------------

export async function registerUser(
  email: string,
  password: string,
  ctx?: WorkspaceContext
): Promise<StandardResponse<RegisterUserData>> {
  try {
    if (!email || !password) {
      throw new ModuleError(AuthErrorCode.INVALID_EMAIL, 'Email and password are required.');
    }
    const adapter = await requireAdapter(ctx);
    const user = await adapter.signUp(email, password);

    // Side effect per §10.1: trigger verification email via Mail's public
    // interface. We construct a verification URL. The exact URL format is
    // owned by Auth (the caller of Mail); Mail only delivers it.
    //
    // NOTE: With the Supabase adapter, the verification email is sent BY
    // Supabase itself during signUp() (Supabase's built-in flow). With the
    // Mock adapter, we trigger Mail.sendVerificationEmail() explicitly so
    // the demo UI shows the Mail side-effect. To keep behavior consistent
    // and avoid double-sending with Supabase, the Supabase adapter's signUp
    // already triggers Supabase's email; we still call Mail here so that the
    // Mail module's outbox records the event for visibility — but in
    // production with Supabase, callers should rely on Supabase's email
    // unless CODELOK_AUTH_USE_MOCK=true.
    if (process.env.CODELOK_AUTH_USE_MOCK === 'true') {
      // Mock-mode only: Mail handles delivery. Use the verification token
      // surfaced by the Mock adapter (Supabase would leave this undefined
      // and send its own verification email).
      const verificationUrl = buildVerificationUrl(
        user.userId,
        user.verificationToken,
        ctx?.workspaceId
      );
      await Mail.sendVerificationEmail({
        to: user.email,
        verificationUrl,
        workspaceId: ctx?.workspaceId,
      });
    }

    return ok<RegisterUserData>({
      userId: user.userId,
      email: user.email,
      emailVerified: false,
    });
  } catch (err) {
    const e = translateProviderError(err);
    return fail(e.code, e.message);
  }
}

// ---------------------------------------------------------------------------
// §10.2 — loginUser(email, password, ctx?)
// ---------------------------------------------------------------------------

export async function loginUser(
  email: string,
  password: string,
  ctx?: WorkspaceContext
): Promise<StandardResponse<LoginUserData>> {
  try {
    if (!email || !password) {
      throw new ModuleError(AuthErrorCode.INVALID_CREDENTIALS, 'Email and password are required.');
    }
    const adapter = await requireAdapter(ctx);
    const session = await adapter.signInWithPassword(email, password);
    return ok<LoginUserData>({
      userId: session.userId,
      accessToken: session.accessToken,
      refreshToken: session.refreshToken,
      expiresAt: session.expiresAt,
    });
  } catch (err) {
    const e = translateProviderError(err);
    return fail(e.code, e.message);
  }
}

// ---------------------------------------------------------------------------
// §10.3 — logoutUser(accessToken, ctx?)
// ---------------------------------------------------------------------------

export async function logoutUser(
  accessToken: string,
  ctx?: WorkspaceContext
): Promise<StandardResponse<Record<string, never>>> {
  try {
    if (!accessToken) {
      throw new ModuleError(AuthErrorCode.INVALID_SESSION, 'Access token is required.');
    }
    const adapter = await requireAdapter(ctx);
    // Verify the session is currently valid before revoking — otherwise
    // return INVALID_SESSION per §10.3's only error code.
    const current = await adapter.getUserByAccessToken(accessToken);
    if (!current || current.expired) {
      throw new ModuleError(AuthErrorCode.INVALID_SESSION, 'Session is invalid or already revoked.');
    }
    await adapter.signOut(accessToken);
    return ok({});
  } catch (err) {
    const e = translateProviderError(err);
    return fail(e.code, e.message);
  }
}

// ---------------------------------------------------------------------------
// §10.4 — refreshSession(refreshToken, ctx?)
// ---------------------------------------------------------------------------

export async function refreshSession(
  refreshToken: string,
  ctx?: WorkspaceContext
): Promise<StandardResponse<RefreshSessionData>> {
  try {
    if (!refreshToken) {
      throw new ModuleError(AuthErrorCode.INVALID_REFRESH_TOKEN, 'Refresh token is required.');
    }
    const adapter = await requireAdapter(ctx);
    const session = await adapter.refreshSession(refreshToken);
    return ok<RefreshSessionData>({
      accessToken: session.accessToken,
      refreshToken: session.refreshToken,
      expiresAt: session.expiresAt,
    });
  } catch (err) {
    const e = translateProviderError(err);
    return fail(e.code, e.message);
  }
}

// ---------------------------------------------------------------------------
// §10.5 — verifySession(accessToken, ctx?)
// ---------------------------------------------------------------------------

export async function verifySession(
  accessToken: string,
  ctx?: WorkspaceContext
): Promise<StandardResponse<VerifySessionData>> {
  try {
    if (!accessToken) {
      throw new ModuleError(AuthErrorCode.INVALID_SESSION, 'Access token is required.');
    }
    const adapter = await requireAdapter(ctx);
    const result = await adapter.getUserByAccessToken(accessToken);
    if (result === null) {
      // Token not recognized / malformed / revoked.
      throw new ModuleError(AuthErrorCode.INVALID_SESSION, 'Session is invalid.');
    }
    if ('expired' in result && result.expired) {
      throw new ModuleError(AuthErrorCode.SESSION_EXPIRED, 'Session has expired.');
    }
    if (!('user' in result)) {
      throw new ModuleError(AuthErrorCode.INVALID_SESSION, 'Session is invalid.');
    }
    return ok<VerifySessionData>({
      userId: result.user.userId,
      valid: true,
    });
  } catch (err) {
    const e = translateProviderError(err);
    return fail(e.code, e.message);
  }
}

// ---------------------------------------------------------------------------
// §10.6 — resetPassword(email, ctx?)
// Per §10.6: ALWAYS returns { sent: true } — anti-enumeration. Internally
// only triggers Mail if user actually exists.
// ---------------------------------------------------------------------------

export async function resetPassword(
  email: string,
  ctx?: WorkspaceContext
): Promise<StandardResponse<ResetPasswordData>> {
  // Anti-enumeration: we never vary response based on whether email exists.
  // We therefore cannot early-return on missing email without leaking. So:
  // we run the same flow, and the adapter / Mail side-effects handle the
  // "user not found" case silently.
  try {
    const adapter = await requireAdapter(ctx);

    // We attempt to trigger the provider-side reset email (which itself
    // silently no-ops on unknown emails per §10.6 expectations). Then we
    // ALSO call Mail.sendPasswordResetEmail() so the Mail outbox records
    // the event for visibility (in Mock mode this is the primary delivery
    // channel; in Supabase mode it's a secondary notification).
    if (email) {
      try {
        const resetUrl = buildPasswordResetUrl(ctx?.workspaceId);
        await adapter.triggerPasswordResetEmail(email, resetUrl);
        // Mail side-effect (best-effort, never surfaces errors to caller —
        // anti-enumeration). Per §10.6, no errors are exposed at all.
        await Mail.sendPasswordResetEmail({
          to: email,
          resetUrl,
          workspaceId: ctx?.workspaceId,
        }).catch(() => {
          /* swallow — anti-enumeration */
        });
      } catch {
        /* swallow — anti-enumeration per §10.6 */
      }
    }
    return ok<ResetPasswordData>({ sent: true });
  } catch {
    // Even if the adapter is not configured, we return sent:true per the
    // anti-enumeration rule. NOTE: this is a deliberate exception to the
    // usual "surface AUTH_PROVIDER_NOT_CONFIGURED" behavior, because §10.6
    // explicitly says "no errors are exposed". The trade-off: the password
    // reset email is not actually sent if the provider isn't configured,
    // but the caller cannot tell — which is the correct security posture.
    return ok<ResetPasswordData>({ sent: true });
  }
}

// ---------------------------------------------------------------------------
// §10.7 — changePassword(userId, oldPassword, newPassword, ctx?)
// ---------------------------------------------------------------------------

export async function changePassword(
  userId: string,
  oldPassword: string,
  newPassword: string,
  ctx?: WorkspaceContext
): Promise<StandardResponse<Record<string, never>>> {
  try {
    if (!userId || !oldPassword || !newPassword) {
      throw new ModuleError(AuthErrorCode.INVALID_CREDENTIALS, 'userId, oldPassword, newPassword are required.');
    }
    const adapter = await requireAdapter(ctx);
    await adapter.updateUserPassword(userId, oldPassword, newPassword);
    return ok({});
  } catch (err) {
    const e = translateProviderError(err);
    return fail(e.code, e.message);
  }
}

// ---------------------------------------------------------------------------
// §10.8 — verifyEmail(token, ctx?)
// ---------------------------------------------------------------------------

export async function verifyEmail(
  token: string,
  ctx?: WorkspaceContext
): Promise<StandardResponse<VerifyEmailData>> {
  try {
    if (!token) {
      throw new ModuleError(AuthErrorCode.INVALID_TOKEN, 'Token is required.');
    }
    const adapter = await requireAdapter(ctx);
    const user = await adapter.verifyEmailToken(token);
    if (!user) {
      throw new ModuleError(AuthErrorCode.INVALID_TOKEN, 'Token is invalid.');
    }
    return ok<VerifyEmailData>({
      userId: user.userId,
      emailVerified: true,
    });
  } catch (err) {
    const e = translateProviderError(err);
    return fail(e.code, e.message);
  }
}

// ---------------------------------------------------------------------------
// §10 v1.1 — getUser(userId, ctx?)
//
// Added in v1.1. Resolves a stored userId into current identity attributes.
// Distinct from verifySession: takes a userId (not an access token) and
// returns identity fields (not just { userId, valid }).
//
// Used by other modules (e.g. Organizations) to comply with §3.8 Identity
// Ownership Rule — they call this function to resolve identity on demand
// rather than persisting email/identity snapshots as authoritative data.
//
// Per §10 v1.1:
//   Success data: { userId, email, emailVerified }
//   Errors: USER_NOT_FOUND
// ---------------------------------------------------------------------------

export async function getUser(
  userId: string,
  ctx?: WorkspaceContext
): Promise<StandardResponse<GetUserData>> {
  try {
    if (!userId) {
      throw new ModuleError(AuthErrorCode.USER_NOT_FOUND, 'userId is required.');
    }
    const adapter = await requireAdapter(ctx);
    const user = await adapter.getUserByUserId(userId);
    if (!user) {
      throw new ModuleError(AuthErrorCode.USER_NOT_FOUND, 'User not found.');
    }
    return ok<GetUserData>({
      userId: user.userId,
      email: user.email,
      emailVerified: user.emailVerified,
    });
  } catch (err) {
    const e = translateProviderError(err);
    return fail(e.code, e.message);
  }
}

// ---------------------------------------------------------------------------
// URL builders (internal — used for Mail links)
//
// The base URL is configurable via CODELOK_APP_BASE_URL env var (default
// http://localhost:3000). In production, this would be the workspace-specific
// app URL (per §6 — workspaceId is branding/redirect context only).
// ---------------------------------------------------------------------------

function buildVerificationUrl(
  userId: string,
  verificationToken: string | undefined,
  workspaceId?: string
): string {
  const base = process.env.CODELOK_APP_BASE_URL ?? 'http://localhost:3000';
  const params = new URLSearchParams();
  // Prefer the verification token when available (Mock adapter). Fall back to
  // uid-only URL for Supabase (which sends its own verification email with
  // its own token).
  if (verificationToken) {
    params.set('token', verificationToken);
  } else {
    params.set('uid', userId);
  }
  if (workspaceId) params.set('ws', workspaceId);
  return `${base}/auth/verify-email?${params.toString()}`;
}

function buildPasswordResetUrl(workspaceId?: string): string {
  const base = process.env.CODELOK_APP_BASE_URL ?? 'http://localhost:3000';
  const params = new URLSearchParams();
  if (workspaceId) params.set('ws', workspaceId);
  const qs = params.toString();
  return qs ? `${base}/auth/reset-password?${qs}` : `${base}/auth/reset-password`;
}

// ---------------------------------------------------------------------------
// Public surface (the only thing other modules may import)
// ---------------------------------------------------------------------------

export const Auth = {
  registerUser,
  loginUser,
  logoutUser,
  refreshSession,
  verifySession,
  resetPassword,
  changePassword,
  verifyEmail,
  getUser, // added in v1.1
};

export type AuthModule = typeof Auth;
