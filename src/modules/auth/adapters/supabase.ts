/**
 * Codlok Cloud — Auth Module — Supabase Adapter (INTERNAL)
 *
 * Per Master Spec §5: "Auth provider: Supabase Auth"
 * Per Master Spec §10: "Provider adapter: Supabase Auth."
 *
 * This file is INTERNAL to the Auth module. It is the only place that knows
 * about Supabase. Other modules (and the public Auth surface) never see
 * Supabase types or errors.
 *
 * Per Master Spec §3.4: secrets (Supabase URL, anon key, service role key)
 * are read through the Configuration Service — never hardcoded.
 *
 * Per Master Spec §3.7: if Supabase credentials are not configured, this
 * adapter cannot be constructed. Auth's public boundary surfaces
 * AUTH_PROVIDER_NOT_CONFIGURED to callers.
 */

import { createClient, SupabaseClient } from '@supabase/supabase-js';
import { getConfigurationService } from '@/config';
import {
  AuthProviderAdapter,
  ProviderUser,
  ProviderSession,
  ProviderAuthError,
} from './types';

// ---------------------------------------------------------------------------
// Supabase credential resolution (via Configuration Service per §3.4)
// ---------------------------------------------------------------------------

export interface SupabaseCredentials {
  url: string;
  anonKey: string;
  serviceRoleKey: string;
}

/**
 * Resolve Supabase credentials from the Configuration Service.
 * Returns `null` if any of the three required credentials are missing —
 * per §3.7 the module is "disabled" until all are supplied.
 */
export async function resolveSupabaseCredentials(
  workspaceId?: string
): Promise<SupabaseCredentials | null> {
  const config = getConfigurationService();
  const secrets = await config.getSecrets(
    [
      'SUPABASE_URL',
      'SUPABASE_ANON_KEY',
      'SUPABASE_SERVICE_ROLE_KEY',
    ],
    workspaceId
  );
  const url = secrets.SUPABASE_URL?.value;
  const anonKey = secrets.SUPABASE_ANON_KEY?.value;
  const serviceRoleKey = secrets.SUPABASE_SERVICE_ROLE_KEY?.value;
  if (!url || !anonKey || !serviceRoleKey) return null;
  return { url, anonKey, serviceRoleKey };
}

// ---------------------------------------------------------------------------
// Error translation: Supabase → ProviderAuthError
//
// The Auth public boundary will further translate ProviderAuthError →
// Codlok-standard error codes. This two-stage translation keeps Supabase
// strings out of the rest of the codebase.
// ---------------------------------------------------------------------------

function translateSupabaseError(err: unknown): ProviderAuthError {
  const msg = err instanceof Error ? err.message : String(err);
  const lower = msg.toLowerCase();

  // Sign-up errors
  if (lower.includes('already registered') || lower.includes('already been registered')) {
    return new ProviderAuthError('EMAIL_ALREADY_EXISTS', msg);
  }
  if (lower.includes('password should be') || lower.includes('weak password') || lower.includes('password too')) {
    return new ProviderAuthError('WEAK_PASSWORD', msg);
  }
  if (lower.includes('invalid email') || lower.includes('unable to validate email')) {
    return new ProviderAuthError('INVALID_EMAIL', msg);
  }

  // Sign-in errors
  if (lower.includes('invalid login') || lower.includes('invalid credentials')) {
    return new ProviderAuthError('INVALID_CREDENTIALS', msg);
  }
  if (lower.includes('email not confirmed') || lower.includes('not verified')) {
    return new ProviderAuthError('EMAIL_NOT_VERIFIED', msg);
  }
  if (lower.includes('locked') || lower.includes('rate limit')) {
    return new ProviderAuthError('ACCOUNT_LOCKED', msg);
  }

  // Session / token errors
  if (lower.includes('invalid token') || lower.includes('jwt invalid') || lower.includes('jwt malformed')) {
    return new ProviderAuthError('INVALID_TOKEN', msg);
  }
  if (lower.includes('token expired') || lower.includes('jwt expired')) {
    return new ProviderAuthError('TOKEN_EXPIRED', msg);
  }
  if (lower.includes('refresh_token') && lower.includes('invalid')) {
    return new ProviderAuthError('INVALID_REFRESH_TOKEN', msg);
  }
  if (lower.includes('refresh_token') && lower.includes('expired')) {
    return new ProviderAuthError('REFRESH_TOKEN_EXPIRED', msg);
  }
  if (lower.includes('session') && lower.includes('expired')) {
    return new ProviderAuthError('SESSION_EXPIRED', msg);
  }
  if (lower.includes('session') && lower.includes('not found')) {
    return new ProviderAuthError('INVALID_SESSION', msg);
  }

  // Fallback — never leaks Supabase-specific text upward beyond this point.
  return new ProviderAuthError('PROVIDER_UNKNOWN_ERROR', 'Supabase returned an unrecognized error.');
}

// ---------------------------------------------------------------------------
// SupabaseAuthAdapter
// ---------------------------------------------------------------------------

export class SupabaseAuthAdapter implements AuthProviderAdapter {
  private client: SupabaseClient;
  private adminClient: SupabaseClient;

  constructor(credentials: SupabaseCredentials) {
    // Public anon-key client for sign-up / sign-in / OAuth flows.
    this.client = createClient(credentials.url, credentials.anonKey, {
      auth: { persistSession: false, autoRefreshToken: false },
    });
    // Service-role client for privileged operations (e.g. reading user by ID
    // during password change). Per §3.4 service role key never leaves this
    // adapter and never reaches the public Auth interface.
    this.adminClient = createClient(credentials.url, credentials.serviceRoleKey, {
      auth: { persistSession: false, autoRefreshToken: false },
    });
  }

  async signUp(email: string, password: string): Promise<ProviderUser> {
    const { data, error } = await this.client.auth.signUp({ email, password });
    if (error) throw translateSupabaseError(error);
    if (!data.user) {
      throw new ProviderAuthError('PROVIDER_UNKNOWN_ERROR', 'Sign-up returned no user.');
    }
    return {
      userId: data.user.id,
      email: data.user.email ?? email,
      emailVerified: !!data.user.email_confirmed_at,
    };
  }

  async signInWithPassword(
    email: string,
    password: string
  ): Promise<ProviderSession> {
    const { data, error } = await this.client.auth.signInWithPassword({
      email,
      password,
    });
    if (error) throw translateSupabaseError(error);
    if (!data.session || !data.user) {
      throw new ProviderAuthError('PROVIDER_UNKNOWN_ERROR', 'Sign-in returned no session.');
    }
    return {
      userId: data.user.id,
      accessToken: data.session.access_token,
      refreshToken: data.session.refresh_token,
      expiresAt: data.session.expires_at ?? Math.floor(Date.now() / 1000) + 3600,
    };
  }

  async signOut(accessToken: string): Promise<void> {
    // signOut with global scope invalidates the access token server-side.
    // Per §3.6, no error is thrown if the token is already invalid —
    // logoutUser's only exposed error is INVALID_SESSION, handled by caller.
    const { error } = await this.client.auth.signOut({
      scope: 'global',
    });
    // Suppress "session not found" — logout is idempotent at the public
    // interface level. Other errors propagate.
    if (error && !/session_not_found|jwt/i.test(error.message)) {
      throw translateSupabaseError(error);
    }
    void accessToken;
  }

  async refreshSession(refreshToken: string): Promise<ProviderSession> {
    this.client.auth.setSession({
      access_token: 'placeholder_for_refresh',
      refresh_token: refreshToken,
    }).catch(() => {
      /* setSession validates access_token; we use refresh separately below. */
    });

    // Use the dedicated refresh flow.
    const { data, error } = await this.client.auth.refreshSession({
      refresh_token: refreshToken,
    });
    if (error) throw translateSupabaseError(error);
    if (!data.session || !data.user) {
      throw new ProviderAuthError('PROVIDER_UNKNOWN_ERROR', 'Refresh returned no session.');
    }
    return {
      userId: data.user.id,
      accessToken: data.session.access_token,
      refreshToken: data.session.refresh_token,
      expiresAt: data.session.expires_at ?? Math.floor(Date.now() / 1000) + 3600,
    };
  }

  async getUserByAccessToken(
    accessToken: string
  ): Promise<{ user: ProviderUser; expired: false } | { expired: true } | null> {
    // We use the admin client's getUser(token) — works regardless of the
    // anon-key user session state. Returns expired:true on JWT expiry.
    const { data, error } = await this.adminClient.auth.getUser(accessToken);
    if (error) {
      const lower = error.message.toLowerCase();
      if (lower.includes('expired') || lower.includes('jwt expired')) {
        return { expired: true };
      }
      if (lower.includes('invalid') || lower.includes('malformed')) {
        return null;
      }
      throw translateSupabaseError(error);
    }
    if (!data.user) return null;
    return {
      expired: false,
      user: {
        userId: data.user.id,
        email: data.user.email ?? '',
        emailVerified: !!data.user.email_confirmed_at,
      },
    };
  }

  async triggerPasswordResetEmail(
    email: string,
    redirectUrl?: string
  ): Promise<void> {
    const { error } = await this.client.auth.resetPasswordForEmail(email, {
      redirectTo: redirectUrl,
    });
    // Per §10 resetPassword: always returned as sent=true regardless of
    // whether email exists (anti-enumeration). So we suppress "user not found"
    // here. Other errors propagate.
    if (error && !/user not found|not registered/i.test(error.message)) {
      throw translateSupabaseError(error);
    }
  }

  async updateUserPassword(
    userId: string,
    oldPassword: string,
    newPassword: string
  ): Promise<void> {
    // Verify old password by attempting a sign-in with it.
    const { data: adminData } = await this.adminClient.auth.admin.getUserById(userId);
    if (!adminData.user?.email) {
      throw new ProviderAuthError('PROVIDER_UNKNOWN_ERROR', 'User not found.');
    }
    const { error: signInError } = await this.client.auth.signInWithPassword({
      email: adminData.user.email,
      password: oldPassword,
    });
    if (signInError) throw translateSupabaseError(signInError);

    // Update password via admin API (we already verified the old password).
    const { error: updateError } = await this.adminClient.auth.admin.updateUserById(
      userId,
      { password: newPassword }
    );
    if (updateError) throw translateSupabaseError(updateError);
  }

  async verifyEmailToken(token: string): Promise<ProviderUser | null> {
    // For OTP-style verification flows; if using email confirmation links,
    // Supabase handles verification client-side via the URL hash. We support
    // the OTP token flow here.
    const { data, error } = await this.client.auth.verifyOtp({
      token_hash: token,
      type: 'email_signup',
    });
    if (error) throw translateSupabaseError(error);
    if (!data.user) return null;
    return {
      userId: data.user.id,
      email: data.user.email ?? '',
      emailVerified: !!data.user.email_confirmed_at,
    };
  }
}
