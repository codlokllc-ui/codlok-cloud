/**
 * Codlok Cloud Dashboard — Auth Context
 *
 * Manages the access token, user identity, and session lifecycle.
 * Calls real Auth API routes (which use MockAuthAdapter in dev mode
 * or SupabaseAuthAdapter in production).
 */

'use client';

import { createContext, useContext, useState, useEffect, useCallback, ReactNode } from 'react';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface AuthUser {
  userId: string;
  email: string;
  accessToken: string;
  refreshToken: string;
  expiresAt: number;
}

interface AuthContextValue {
  user: AuthUser | null;
  loading: boolean;
  login: (email: string, password: string) => Promise<{ success: boolean; error?: string }>;
  register: (email: string, password: string) => Promise<{ success: boolean; error?: string }>;
  autoVerifyEmail: (email: string) => Promise<{ success: boolean; error?: string }>;
  logout: () => Promise<void>;
  verifyEmail: (token: string) => Promise<{ success: boolean; error?: string }>;
}

// ---------------------------------------------------------------------------
// Context
// ---------------------------------------------------------------------------

const AuthContext = createContext<AuthContextValue | null>(null);

const STORAGE_KEY = 'codlok_auth';

// Authentication remains required by default. A staging deployment can opt
// into build-preview mode explicitly; production must never inherit a silent
// bypass merely because a variable is missing.
// Preview bypass is a local-development convenience only. A deployed build
// must always use the configured identity provider.
const AUTH_REQUIRED =
  process.env.NODE_ENV === 'production' ||
  process.env.NEXT_PUBLIC_CODELOK_PREVIEW_BYPASS_AUTH !== 'true';
const PREVIEW_USER: AuthUser = {
  userId: 'codlok-preview-builder',
  email: 'preview@codlok.local',
  accessToken: 'codlok-preview-bypass',
  refreshToken: 'codlok-preview-bypass',
  expiresAt: 4_102_444_800,
};

// ---------------------------------------------------------------------------
// Provider
// ---------------------------------------------------------------------------

export function AuthProvider({ children }: { children: ReactNode }) {
  // Lazy-initialize from localStorage — avoids setState-in-effect lint error.
  const [user, setUser] = useState<AuthUser | null>(() => {
    if (!AUTH_REQUIRED) return PREVIEW_USER;
    if (typeof window === 'undefined') return null;
    const stored = localStorage.getItem(STORAGE_KEY);
    if (stored) {
      try {
        const parsed = JSON.parse(stored) as AuthUser;
        if (parsed.expiresAt > Math.floor(Date.now() / 1000)) {
          return parsed;
        }
        localStorage.removeItem(STORAGE_KEY);
      } catch {
        localStorage.removeItem(STORAGE_KEY);
      }
    }
    return null;
  });
  const [loading, setLoading] = useState(false);

  const login = useCallback(async (email: string, password: string) => {
    const res = await fetch('/api/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, password }),
    });
    const data = await res.json();
    if (!data.success) {
      return { success: false, error: data.error?.message ?? 'Login failed' };
    }
    // Fetch user identity via Auth.getUser.
    const userRes = await fetch('/api/auth/get-user', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ accessToken: data.data.accessToken }),
    });
    const userData = await userRes.json();
    const authUser: AuthUser = {
      userId: data.data.userId,
      email: userData.success ? userData.data.email : email,
      accessToken: data.data.accessToken,
      refreshToken: data.data.refreshToken,
      expiresAt: data.data.expiresAt,
    };
    setUser(authUser);
    localStorage.setItem(STORAGE_KEY, JSON.stringify(authUser));
    return { success: true };
  }, []);

  const register = useCallback(async (email: string, password: string) => {
    const res = await fetch('/api/auth/register', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, password }),
    });
    const data = await res.json();
    if (!data.success) {
      return { success: false, error: data.error?.message ?? 'Registration failed' };
    }
    return { success: true };
  }, []);

  const autoVerifyEmail = useCallback(async (email: string) => {
    const isDevMode =
      process.env.NEXT_PUBLIC_CODELOK_AUTH_USE_MOCK === 'true' &&
      process.env.NODE_ENV !== 'production';
    if (!isDevMode) return { success: false, error: 'Developer auto-verification is unavailable.' };

    try {
      const outboxRes = await fetch('/api/mail/outbox');
      const outboxData = await outboxRes.json();
      const verifyEntry = outboxData.success
        ? outboxData.data?.entries?.find(
            (entry: { type: string; to: string; url: string }) =>
              entry.type === 'verification' && entry.to === email
          )
        : undefined;
      if (!verifyEntry) return { success: false, error: 'Verification message was not found.' };
      const token = new URL(verifyEntry.url).searchParams.get('token') ?? '';
      if (!token) return { success: false, error: 'Verification token was not found.' };
      const verifyRes = await fetch('/api/auth/verify-email', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ token }) });
      const verifyData = await verifyRes.json();
      return verifyData.success ? { success: true } : { success: false, error: verifyData.error?.message ?? 'Verification failed' };
    } catch {
      return { success: false, error: 'Developer auto-verification failed.' };
    }
  }, []);

  const logout = useCallback(async () => {
    if (!AUTH_REQUIRED) return;
    if (user) {
      await fetch('/api/auth/logout', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ accessToken: user.accessToken }),
      }).catch(() => {/* best-effort */});
    }
    setUser(null);
    localStorage.removeItem(STORAGE_KEY);
  }, [user]);

  const verifyEmail = useCallback(async (token: string) => {
    const res = await fetch('/api/auth/verify-email', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ token }),
    });
    const data = await res.json();
    if (!data.success) {
      return { success: false, error: data.error?.message ?? 'Verification failed' };
    }
    return { success: true };
  }, []);

  return (
    <AuthContext.Provider value={{ user, loading, login, register, autoVerifyEmail, logout, verifyEmail }}>
      {children}
    </AuthContext.Provider>
  );
}

// ---------------------------------------------------------------------------
// Hook
// ---------------------------------------------------------------------------

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used within AuthProvider');
  return ctx;
}
