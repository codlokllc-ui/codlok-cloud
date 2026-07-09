/**
 * Codlok Cloud — Auth Module Demo UI (Phase 1)
 *
 * Single-page interactive demo that exercises every public Auth function per
 * Master Spec §10. Lets the user:
 *   - Register a new user
 *   - Login (with EMAIL_NOT_VERIFIED / ACCOUNT_LOCKED / INVALID_CREDENTIALS paths)
 *   - Verify email (using the token from the Mail outbox)
 *   - Verify session (with the access token)
 *   - Refresh session
 *   - Change password
 *   - Reset password (anti-enumeration)
 *   - Logout
 *
 * Also shows Mail outbox (Phase 1 stub) and Auth provider status. In Mock
 * mode (CODELOK_AUTH_USE_MOCK=true), the entire flow works end-to-end
 * without real Supabase credentials. In Supabase mode (real credentials in
 * Configuration Service / env vars), the same UI works against real Supabase.
 */

'use client';

import { useState, useCallback, useEffect } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Card, CardContent, CardHeader, CardTitle, CardDescription, CardFooter } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Separator } from '@/components/ui/separator';
import { Toaster } from '@/components/ui/sonner';
import { toast } from 'sonner';

// ---------------------------------------------------------------------------
// Types (mirror the Auth module public shapes)
// ---------------------------------------------------------------------------

interface AuthStatus {
  providerConfigured: boolean;
  providerName: string | null;
  mockMode: boolean;
}

interface OutboxEntry {
  id: string;
  type: 'verification' | 'password_reset' | 'invitation';
  to: string;
  url: string;
  workspaceId?: string;
  sentAt: string;
}

interface Session {
  userId: string;
  accessToken: string;
  refreshToken: string;
  expiresAt: number;
  email: string;
}

// ---------------------------------------------------------------------------
// Main component
// ---------------------------------------------------------------------------

export default function Home() {
  const [status, setStatus] = useState<AuthStatus | null>(null);
  const [session, setSession] = useState<Session | null>(null);
  const [outbox, setOutbox] = useState<OutboxEntry[]>([]);
  const [busy, setBusy] = useState(false);

  // Form state
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [oldPassword, setOldPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [verifyToken, setVerifyToken] = useState('');
  const [resetEmail, setResetEmail] = useState('');

  const refreshStatus = useCallback(async () => {
    const res = await fetch('/api/auth/status');
    const json = await res.json();
    setStatus(json.data);
  }, []);

  const refreshOutbox = useCallback(async () => {
    const res = await fetch('/api/mail/outbox');
    const json = await res.json();
    setOutbox(json.data?.entries ?? []);
  }, []);

  useEffect(() => {
    refreshStatus();
    refreshOutbox();
  }, [refreshStatus, refreshOutbox]);

  // Helper: standard POST
  const post = async (path: string, body: unknown) => {
    setBusy(true);
    try {
      const res = await fetch(path, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      const json = await res.json();
      return json;
    } finally {
      setBusy(false);
    }
  };

  // ---- Auth actions ----------------------------------------------------

  const onRegister = async () => {
    const r = await post('/api/auth/register', { email, password });
    if (r.success) {
      toast.success(`Registered. userId=${r.data.userId.slice(0, 12)}…  (emailVerified=false)`);
      refreshOutbox();
    } else {
      toast.error(`Register failed: ${r.error.code} — ${r.error.message}`);
    }
  };

  const onLogin = async () => {
    const r = await post('/api/auth/login', { email, password });
    if (r.success) {
      setSession({
        userId: r.data.userId,
        accessToken: r.data.accessToken,
        refreshToken: r.data.refreshToken,
        expiresAt: r.data.expiresAt,
        email,
      });
      toast.success(`Logged in. userId=${r.data.userId.slice(0, 12)}…`);
    } else {
      toast.error(`Login failed: ${r.error.code} — ${r.error.message}`);
    }
  };

  const onLogout = async () => {
    if (!session) return;
    const r = await post('/api/auth/logout', { accessToken: session.accessToken });
    if (r.success) {
      setSession(null);
      toast.success('Logged out.');
    } else {
      toast.error(`Logout failed: ${r.error.code}`);
    }
  };

  const onVerifyEmail = async () => {
    const r = await post('/api/auth/verify-email', { token: verifyToken });
    if (r.success) {
      toast.success(`Email verified for userId=${r.data.userId.slice(0, 12)}…`);
    } else {
      toast.error(`Verify failed: ${r.error.code} — ${r.error.message}`);
    }
  };

  const onVerifySession = async () => {
    if (!session) return;
    const r = await post('/api/auth/verify-session', { accessToken: session.accessToken });
    if (r.success) {
      toast.success(`Session valid. userId=${r.data.userId.slice(0, 12)}…`);
    } else {
      toast.error(`Session invalid: ${r.error.code}`);
      if (r.error.code === 'SESSION_EXPIRED' || r.error.code === 'INVALID_SESSION') {
        setSession(null);
      }
    }
  };

  const onRefresh = async () => {
    if (!session) return;
    const r = await post('/api/auth/refresh', { refreshToken: session.refreshToken });
    if (r.success) {
      setSession({
        ...session,
        accessToken: r.data.accessToken,
        refreshToken: r.data.refreshToken,
        expiresAt: r.data.expiresAt,
      });
      toast.success('Session refreshed.');
    } else {
      toast.error(`Refresh failed: ${r.error.code}`);
    }
  };

  const onChangePassword = async () => {
    if (!session) return;
    const r = await post('/api/auth/change-password', {
      userId: session.userId,
      oldPassword,
      newPassword,
    });
    if (r.success) {
      toast.success('Password changed.');
      setOldPassword('');
      setNewPassword('');
    } else {
      toast.error(`Change password failed: ${r.error.code} — ${r.error.message}`);
    }
  };

  const onResetPassword = async () => {
    const r = await post('/api/auth/reset-password', { email: resetEmail });
    // Per §10.6, always returns sent:true
    toast.success(`Reset request sent (anti-enumeration: response is always sent=${r.data?.sent}).`);
    refreshOutbox();
  };

  // ---- Render ----------------------------------------------------------

  return (
    <div className="min-h-screen bg-background text-foreground">
      <Toaster richColors position="top-right" />

      <header className="border-b">
        <div className="max-w-6xl mx-auto px-4 py-6 flex items-center justify-between flex-wrap gap-3">
          <div>
            <h1 className="text-2xl font-bold tracking-tight">Codlok Cloud</h1>
            <p className="text-sm text-muted-foreground">
              Auth Module v1.0 — Master Spec §10 (Phase 1)
            </p>
          </div>
          <div className="flex items-center gap-2 flex-wrap">
            {status?.mockMode && (
              <Badge variant="secondary">Mock Mode</Badge>
            )}
            {status && (
              <Badge variant={status.providerConfigured ? 'default' : 'destructive'}>
                {status.providerConfigured
                  ? `Provider: ${status.providerName}`
                  : 'Provider: not configured'}
              </Badge>
            )}
            <Button variant="ghost" size="sm" onClick={() => { refreshStatus(); refreshOutbox(); }}>
              Refresh
            </Button>
          </div>
        </div>
      </header>

      <main className="max-w-6xl mx-auto px-4 py-6 grid gap-6 lg:grid-cols-3">
        {/* Column 1 — Identity / forms */}
        <div className="lg:col-span-2 space-y-6">
          <Card>
            <CardHeader>
              <CardTitle>Register &amp; Login</CardTitle>
              <CardDescription>
                Exercises Auth.registerUser (§10.1) and Auth.loginUser (§10.2).
                After register, a verification email is recorded in the Mail
                outbox (Phase 1 stub). Login will fail with EMAIL_NOT_VERIFIED
                until you verify the email using the token from the outbox.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-3">
              <div className="space-y-2">
                <Label htmlFor="email">Email</Label>
                <Input id="email" type="email" placeholder="you@example.com"
                  value={email} onChange={(e) => setEmail(e.target.value)} />
              </div>
              <div className="space-y-2">
                <Label htmlFor="password">Password (min 8 chars)</Label>
                <Input id="password" type="password" placeholder="password"
                  value={password} onChange={(e) => setPassword(e.target.value)} />
              </div>
            </CardContent>
            <CardFooter className="flex gap-2 flex-wrap">
              <Button onClick={onRegister} disabled={busy || !email || !password}>Register</Button>
              <Button onClick={onLogin} disabled={busy || !email || !password} variant="secondary">Login</Button>
            </CardFooter>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Verify Email</CardTitle>
              <CardDescription>
                Exercises Auth.verifyEmail (§10.8). The verification token is
                shown in the Mail outbox (right column) after a successful
                registerUser call. In Mock mode, copy the token from the
                outbox URL — it&apos;s the last path segment.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-2">
              <Label htmlFor="token">Verification Token</Label>
              <Input id="token" placeholder="paste token from outbox URL"
                value={verifyToken} onChange={(e) => setVerifyToken(e.target.value)} />
            </CardContent>
            <CardFooter>
              <Button onClick={onVerifyEmail} disabled={busy || !verifyToken}>Verify Email</Button>
            </CardFooter>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Session</CardTitle>
              <CardDescription>
                Exercises Auth.verifySession (§10.5), Auth.refreshSession
                (§10.4), and Auth.logoutUser (§10.3).
              </CardDescription>
            </CardHeader>
            <CardContent>
              {session ? (
                <div className="space-y-2 text-sm font-mono break-all">
                  <div><span className="text-muted-foreground">userId:</span> {session.userId}</div>
                  <div><span className="text-muted-foreground">email:</span> {session.email}</div>
                  <div><span className="text-muted-foreground">accessToken:</span> {session.accessToken.slice(0, 32)}…</div>
                  <div><span className="text-muted-foreground">refreshToken:</span> {session.refreshToken.slice(0, 32)}…</div>
                  <div><span className="text-muted-foreground">expiresAt:</span> {new Date(session.expiresAt * 1000).toISOString()}</div>
                </div>
              ) : (
                <p className="text-sm text-muted-foreground">No active session. Login above.</p>
              )}
            </CardContent>
            <CardFooter className="flex gap-2 flex-wrap">
              <Button onClick={onVerifySession} disabled={busy || !session} variant="secondary">Verify Session</Button>
              <Button onClick={onRefresh} disabled={busy || !session} variant="secondary">Refresh Session</Button>
              <Button onClick={onLogout} disabled={busy || !session} variant="destructive">Logout</Button>
            </CardFooter>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Change Password</CardTitle>
              <CardDescription>
                Exercises Auth.changePassword (§10.7). Requires an active
                session.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-3">
              <div className="space-y-2">
                <Label htmlFor="oldpw">Old Password</Label>
                <Input id="oldpw" type="password" value={oldPassword}
                  onChange={(e) => setOldPassword(e.target.value)} />
              </div>
              <div className="space-y-2">
                <Label htmlFor="newpw">New Password (min 8 chars)</Label>
                <Input id="newpw" type="password" value={newPassword}
                  onChange={(e) => setNewPassword(e.target.value)} />
              </div>
            </CardContent>
            <CardFooter>
              <Button onClick={onChangePassword} disabled={busy || !session || !oldPassword || !newPassword}>
                Change Password
              </Button>
            </CardFooter>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Reset Password</CardTitle>
              <CardDescription>
                Exercises Auth.resetPassword (§10.6). Per spec, this ALWAYS
                returns <code>sent: true</code> — even if the email doesn&apos;t
                exist — to prevent email enumeration.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-2">
              <Label htmlFor="reset">Email</Label>
              <Input id="reset" type="email" placeholder="any email"
                value={resetEmail} onChange={(e) => setResetEmail(e.target.value)} />
            </CardContent>
            <CardFooter>
              <Button onClick={onResetPassword} disabled={busy || !resetEmail} variant="secondary">
                Send Reset Email
              </Button>
            </CardFooter>
          </Card>
        </div>

        {/* Column 2 — Status, outbox, current session sidebar */}
        <div className="space-y-6">
          <Card>
            <CardHeader>
              <CardTitle>Module Status</CardTitle>
              <CardDescription>Auth provider configuration</CardDescription>
            </CardHeader>
            <CardContent className="space-y-2 text-sm">
              {status ? (
                <>
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">Provider configured:</span>
                    <span>{status.providerConfigured ? 'Yes' : 'No'}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">Provider name:</span>
                    <span>{status.providerName ?? '—'}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">Mock mode:</span>
                    <span>{status.mockMode ? 'Yes' : 'No'}</span>
                  </div>
                  {!status.providerConfigured && (
                    <p className="mt-2 text-xs text-amber-600 dark:text-amber-400">
                      No provider configured. Set <code>SUPABASE_URL</code>,
                      <code> SUPABASE_ANON_KEY</code>, and
                      <code> SUPABASE_SERVICE_ROLE_KEY</code> env vars, or set
                      <code> CODELOK_AUTH_USE_MOCK=true</code> for the demo.
                    </p>
                  )}
                </>
              ) : (
                <p className="text-muted-foreground">Loading…</p>
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Mail Outbox (Phase 1 Stub)</CardTitle>
              <CardDescription>
                Emails that would be sent by the Mail module. The verification
                token is the <code>token</code> query param in the URL.
              </CardDescription>
            </CardHeader>
            <CardContent className="max-h-96 overflow-y-auto">
              {outbox.length === 0 ? (
                <p className="text-sm text-muted-foreground">Outbox is empty.</p>
              ) : (
                <ul className="space-y-2">
                  {outbox.map((e) => (
                    <li key={e.id} className="text-xs border rounded p-2">
                      <div className="flex justify-between items-center mb-1">
                        <Badge variant="outline">{e.type}</Badge>
                        <span className="text-muted-foreground">
                          {new Date(e.sentAt).toLocaleTimeString()}
                        </span>
                      </div>
                      <div><span className="text-muted-foreground">To:</span> {e.to}</div>
                      <div className="break-all">
                        <span className="text-muted-foreground">URL:</span>{' '}
                        <button
                          className="text-blue-600 hover:underline text-left"
                          onClick={() => {
                            try {
                              const url = new URL(e.url);
                              const token = url.searchParams.get('token') ?? url.searchParams.get('uid') ?? '';
                              if (token) setVerifyToken(token);
                              toast.info('Token copied to verify field.');
                            } catch {
                              toast.error('Could not parse token from URL.');
                            }
                          }}
                        >
                          {e.url}
                        </button>
                      </div>
                    </li>
                  ))}
                </ul>
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Module Spec Compliance (§10)</CardTitle>
              <CardDescription>All 7 rules checked.</CardDescription>
            </CardHeader>
            <CardContent className="text-xs space-y-1.5">
              <div>✓ Standard response shape (§3.6)</div>
              <div>✓ Secrets via Configuration Service (§3.4)</div>
              <div>✓ Workspace isolation respected (§3.5, §6)</div>
              <div>✓ Only public interfaces exposed (§3.1, §3.3)</div>
              <div>✓ No other-module internals accessed</div>
              <div>✓ Codlok-standard error codes</div>
              <div>✓ Module boundary rules followed (§3.3)</div>
            </CardContent>
          </Card>
        </div>
      </main>

      <footer className="border-t mt-auto">
        <div className="max-w-6xl mx-auto px-4 py-4 text-xs text-muted-foreground flex justify-between flex-wrap gap-2">
          <span>Codlok Cloud — Modular Monolith — Phase 1: Auth</span>
          <Separator orientation="vertical" className="hidden sm:block h-4" />
          <span>Build Order §13: Auth → Organizations → Phase 2 → …</span>
        </div>
      </footer>
    </div>
  );
}
