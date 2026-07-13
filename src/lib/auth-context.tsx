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
  logout: () => Promise<void>;
  verifyEmail: (token: string) => Promise<{ success: boolean; error?: string }>;
}

// ---------------------------------------------------------------------------
// Context
// ---------------------------------------------------------------------------

const AuthContext = createContext<AuthContextValue | null>(null);

const STORAGE_KEY = 'codlok_auth';

// ---------------------------------------------------------------------------
// Provider
// ---------------------------------------------------------------------------

export function AuthProvider({ children }: { children: ReactNode }) {
  // Lazy-initialize from localStorage — avoids setState-in-effect lint error.
  const [user, setUser] = useState<AuthUser | null>(() => {
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
      body: JSON.stringify({ userId: data.data.userId, accessToken: data.data.accessToken }),
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
    // In mock/dev mode, auto-verify the email by fetching the verification
    // token from the Mail outbox and calling verify-email. In production,
    // the user would check their real email and click the verification link.
    try {
      const outboxRes = await fetch('/api/mail/outbox');
      const outboxData = await outboxRes.json();
      if (outboxData.success && outboxData.data?.entries) {
        const verifyEntry = outboxData.data.entries.find(
          (e: { type: string; to: string; url: string }) =>
            e.type === 'verification' && e.to === email
        );
        if (verifyEntry) {
          const url = new URL(verifyEntry.url);
          const token = url.searchParams.get('token') ?? '';
          if (token) {
            await fetch('/api/auth/verify-email', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ token }),
            });
          }
        }
      }
    } catch {
      // Best-effort — if auto-verification fails, the user can still log in
      // after manually verifying. Don't block registration on this.
    }
    return { success: true };
  }, []);

  const logout = useCallback(async () => {
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
    <AuthContext.Provider value={{ user, loading, login, register, logout, verifyEmail }}>
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
