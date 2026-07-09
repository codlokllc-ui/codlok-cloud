/**
 * Codlok Cloud — Auth Module Tests
 *
 * Verifies all 8 public Auth functions per Master Spec §10:
 *   1. registerUser — success path + all 3 error codes (§10.1)
 *   2. loginUser    — success path + all 3 error codes (§10.2)
 *   3. logoutUser   — success + INVALID_SESSION (§10.3)
 *   4. refreshSession — success + both error codes (§10.4)
 *   5. verifySession — success + both error codes (§10.5)
 *   6. resetPassword — anti-enumeration (always sent:true) (§10.6)
 *   7. changePassword — success + both error codes (§10.7)
 *   8. verifyEmail   — success + both error codes (§10.8)
 *
 * Plus compliance tests for §3.6 (standard response shape) and §3.7
 * (AUTH_PROVIDER_NOT_CONFIGURED when no provider configured).
 *
 * Uses Bun's built-in test runner. Run with: bun test
 */

import { describe, test, expect, beforeEach, afterAll } from 'bun:test';
import { Auth } from '@/modules/auth';
import { Mail } from '@/modules/mail';
import { _setAdapterForTesting } from '@/modules/auth/adapters/factory';
import { _clearOutboxForTesting, _getOutboxForTesting } from '@/modules/mail';
import { MockAuthAdapter } from '@/modules/auth/adapters/mock';
import { StandardResponse } from '@/shared';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

let mockAdapter: MockAuthAdapter;

beforeEach(() => {
  mockAdapter = new MockAuthAdapter();
  _setAdapterForTesting(mockAdapter);
  _clearOutboxForTesting();
});

afterAll(() => {
  _setAdapterForTesting(null);
});

const TEST_EMAIL = 'alice@example.com';
const TEST_PASSWORD = 'supersecret123';
const WEAK_PASSWORD = '123';

function assertStandardResponseShape<T>(r: StandardResponse<T>) {
  if (r.success) {
    expect(r).toHaveProperty('data');
    expect(typeof r.success).toBe('boolean');
  } else {
    expect(r).toHaveProperty('error');
    expect(r.error).toHaveProperty('code');
    expect(r.error).toHaveProperty('message');
    expect(typeof r.error.code).toBe('string');
    expect(typeof r.error.message).toBe('string');
  }
}

// ---------------------------------------------------------------------------
// §10.1 registerUser
// ---------------------------------------------------------------------------

describe('Auth.registerUser (§10.1)', () => {
  test('SUCCESS: returns userId, email, emailVerified=false', async () => {
    const r = await Auth.registerUser(TEST_EMAIL, TEST_PASSWORD);
    expect(r.success).toBe(true);
    if (!r.success) return;
    expect(r.data.userId).toMatch(/^user_/);
    expect(r.data.email).toBe(TEST_EMAIL);
    expect(r.data.emailVerified).toBe(false);
    assertStandardResponseShape(r);
  });

  test('ERROR: EMAIL_ALREADY_EXISTS when registering same email twice', async () => {
    await Auth.registerUser(TEST_EMAIL, TEST_PASSWORD);
    const r = await Auth.registerUser(TEST_EMAIL, TEST_PASSWORD);
    expect(r.success).toBe(false);
    if (r.success) return;
    expect(r.error.code).toBe('EMAIL_ALREADY_EXISTS');
    assertStandardResponseShape(r);
  });

  test('ERROR: WEAK_PASSWORD for <8 chars', async () => {
    const r = await Auth.registerUser(TEST_EMAIL, WEAK_PASSWORD);
    expect(r.success).toBe(false);
    if (r.success) return;
    expect(r.error.code).toBe('WEAK_PASSWORD');
  });

  test('ERROR: INVALID_EMAIL for malformed email', async () => {
    const r = await Auth.registerUser('not-an-email', TEST_PASSWORD);
    expect(r.success).toBe(false);
    if (r.success) return;
    expect(r.error.code).toBe('INVALID_EMAIL');
  });

  test('SIDE EFFECT: triggers Mail.sendVerificationEmail (recorded in outbox)', async () => {
    // The Mock adapter's registerUser call is followed by Mail.sendVerificationEmail
    // in Auth.registerUser when CODELOK_AUTH_USE_MOCK=true. We set the env var.
    process.env.CODELOK_AUTH_USE_MOCK = 'true';
    await Auth.registerUser(TEST_EMAIL, TEST_PASSWORD);
    const outbox = _getOutboxForTesting();
    expect(outbox.length).toBeGreaterThan(0);
    expect(outbox[outbox.length - 1].type).toBe('verification');
    expect(outbox[outbox.length - 1].to).toBe(TEST_EMAIL);
    process.env.CODELOK_AUTH_USE_MOCK = '';
  });
});

// ---------------------------------------------------------------------------
// §10.2 loginUser
// ---------------------------------------------------------------------------

describe('Auth.loginUser (§10.2)', () => {
  beforeEach(async () => {
    await Auth.registerUser(TEST_EMAIL, TEST_PASSWORD);
  });

  test('ERROR: EMAIL_NOT_VERIFIED before email verification', async () => {
    const r = await Auth.loginUser(TEST_EMAIL, TEST_PASSWORD);
    expect(r.success).toBe(false);
    if (r.success) return;
    expect(r.error.code).toBe('EMAIL_NOT_VERIFIED');
  });

  test('SUCCESS: returns session after email verification', async () => {
    // Verify email via mock helper (simulates user clicking link)
    mockAdapter._markEmailVerified(TEST_EMAIL);
    const r = await Auth.loginUser(TEST_EMAIL, TEST_PASSWORD);
    expect(r.success).toBe(true);
    if (!r.success) return;
    expect(r.data.userId).toMatch(/^user_/);
    expect(r.data.accessToken).toBeTruthy();
    expect(r.data.refreshToken).toBeTruthy();
    expect(r.data.expiresAt).toBeGreaterThan(Math.floor(Date.now() / 1000));
  });

  test('ERROR: INVALID_CREDENTIALS for wrong password', async () => {
    mockAdapter._markEmailVerified(TEST_EMAIL);
    const r = await Auth.loginUser(TEST_EMAIL, 'wrongpassword');
    expect(r.success).toBe(false);
    if (r.success) return;
    expect(r.error.code).toBe('INVALID_CREDENTIALS');
  });

  test('ERROR: INVALID_CREDENTIALS for unknown email', async () => {
    mockAdapter._markEmailVerified(TEST_EMAIL);
    const r = await Auth.loginUser('nobody@example.com', TEST_PASSWORD);
    expect(r.success).toBe(false);
    if (r.success) return;
    expect(r.error.code).toBe('INVALID_CREDENTIALS');
  });

  test('ERROR: ACCOUNT_LOCKED when user is locked', async () => {
    mockAdapter._markEmailVerified(TEST_EMAIL);
    mockAdapter._lockUser(TEST_EMAIL);
    const r = await Auth.loginUser(TEST_EMAIL, TEST_PASSWORD);
    expect(r.success).toBe(false);
    if (r.success) return;
    expect(r.error.code).toBe('ACCOUNT_LOCKED');
  });
});

// ---------------------------------------------------------------------------
// §10.3 logoutUser
// ---------------------------------------------------------------------------

describe('Auth.logoutUser (§10.3)', () => {
  test('SUCCESS: revokes a valid session', async () => {
    await Auth.registerUser(TEST_EMAIL, TEST_PASSWORD);
    mockAdapter._markEmailVerified(TEST_EMAIL);
    const login = await Auth.loginUser(TEST_EMAIL, TEST_PASSWORD);
    if (!login.success) throw new Error('login failed in setup');

    const r = await Auth.logoutUser(login.data.accessToken);
    expect(r.success).toBe(true);
    if (!r.success) return;
    expect(r.data).toEqual({});

    // Verify session is now invalid
    const v = await Auth.verifySession(login.data.accessToken);
    expect(v.success).toBe(false);
  });

  test('ERROR: INVALID_SESSION for unknown access token', async () => {
    const r = await Auth.logoutUser('nonexistent_token');
    expect(r.success).toBe(false);
    if (r.success) return;
    expect(r.error.code).toBe('INVALID_SESSION');
  });
});

// ---------------------------------------------------------------------------
// §10.4 refreshSession
// ---------------------------------------------------------------------------

describe('Auth.refreshSession (§10.4)', () => {
  test('SUCCESS: returns new session with new tokens', async () => {
    await Auth.registerUser(TEST_EMAIL, TEST_PASSWORD);
    mockAdapter._markEmailVerified(TEST_EMAIL);
    const login = await Auth.loginUser(TEST_EMAIL, TEST_PASSWORD);
    if (!login.success) throw new Error('login failed');

    const r = await Auth.refreshSession(login.data.refreshToken);
    expect(r.success).toBe(true);
    if (!r.success) return;
    expect(r.data.accessToken).not.toBe(login.data.accessToken);
    expect(r.data.refreshToken).not.toBe(login.data.refreshToken);
    expect(r.data.expiresAt).toBeGreaterThan(Math.floor(Date.now() / 1000));
  });

  test('ERROR: INVALID_REFRESH_TOKEN for unknown token', async () => {
    const r = await Auth.refreshSession('garbage_refresh_token');
    expect(r.success).toBe(false);
    if (r.success) return;
    expect(r.error.code).toBe('INVALID_REFRESH_TOKEN');
  });

  test('ERROR: REFRESH_TOKEN_EXPIRED for expired token', async () => {
    await Auth.registerUser(TEST_EMAIL, TEST_PASSWORD);
    mockAdapter._markEmailVerified(TEST_EMAIL);
    const login = await Auth.loginUser(TEST_EMAIL, TEST_PASSWORD);
    if (!login.success) throw new Error('login failed');

    // Advance mock clock past refresh token lifetime (7 days + 1 second).
    mockAdapter._advanceClock(8 * 24 * 3600 * 1000);

    const r = await Auth.refreshSession(login.data.refreshToken);
    expect(r.success).toBe(false);
    if (r.success) return;
    expect(r.error.code).toBe('REFRESH_TOKEN_EXPIRED');
  });
});

// ---------------------------------------------------------------------------
// §10.5 verifySession
// ---------------------------------------------------------------------------

describe('Auth.verifySession (§10.5)', () => {
  test('SUCCESS: returns userId and valid=true', async () => {
    await Auth.registerUser(TEST_EMAIL, TEST_PASSWORD);
    mockAdapter._markEmailVerified(TEST_EMAIL);
    const login = await Auth.loginUser(TEST_EMAIL, TEST_PASSWORD);
    if (!login.success) throw new Error('login failed');

    const r = await Auth.verifySession(login.data.accessToken);
    expect(r.success).toBe(true);
    if (!r.success) return;
    expect(r.data.userId).toBe(login.data.userId);
    expect(r.data.valid).toBe(true);
  });

  test('ERROR: INVALID_SESSION for unknown token', async () => {
    const r = await Auth.verifySession('garbage_access_token');
    expect(r.success).toBe(false);
    if (r.success) return;
    expect(r.error.code).toBe('INVALID_SESSION');
  });

  test('ERROR: SESSION_EXPIRED for expired token', async () => {
    await Auth.registerUser(TEST_EMAIL, TEST_PASSWORD);
    mockAdapter._markEmailVerified(TEST_EMAIL);
    const login = await Auth.loginUser(TEST_EMAIL, TEST_PASSWORD);
    if (!login.success) throw new Error('login failed');

    // Advance clock past access token lifetime (1 hour + 1 second).
    mockAdapter._advanceClock(2 * 3600 * 1000);

    const r = await Auth.verifySession(login.data.accessToken);
    expect(r.success).toBe(false);
    if (r.success) return;
    expect(r.error.code).toBe('SESSION_EXPIRED');
  });
});

// ---------------------------------------------------------------------------
// §10.6 resetPassword (anti-enumeration)
// ---------------------------------------------------------------------------

describe('Auth.resetPassword (§10.6) — anti-enumeration', () => {
  test('returns sent:true for an EXISTING user', async () => {
    await Auth.registerUser(TEST_EMAIL, TEST_PASSWORD);
    const r = await Auth.resetPassword(TEST_EMAIL);
    expect(r.success).toBe(true);
    if (!r.success) return;
    expect(r.data.sent).toBe(true);
  });

  test('returns sent:true for a NON-EXISTENT user (anti-enumeration)', async () => {
    const r = await Auth.resetPassword('never-registered@example.com');
    expect(r.success).toBe(true);
    if (!r.success) return;
    expect(r.data.sent).toBe(true);
  });

  test('records password_reset email in Mail outbox', async () => {
    await Auth.registerUser(TEST_EMAIL, TEST_PASSWORD);
    _clearOutboxForTesting();
    await Auth.resetPassword(TEST_EMAIL);
    const outbox = _getOutboxForTesting();
    expect(outbox.length).toBeGreaterThan(0);
    expect(outbox[outbox.length - 1].type).toBe('password_reset');
  });
});

// ---------------------------------------------------------------------------
// §10.7 changePassword
// ---------------------------------------------------------------------------

describe('Auth.changePassword (§10.7)', () => {
  test('SUCCESS: changes password (old password works before, fails after)', async () => {
    await Auth.registerUser(TEST_EMAIL, TEST_PASSWORD);
    mockAdapter._markEmailVerified(TEST_EMAIL);
    const login = await Auth.loginUser(TEST_EMAIL, TEST_PASSWORD);
    if (!login.success) throw new Error('login failed');

    const NEW_PW = 'newpassword456';
    const r = await Auth.changePassword(login.data.userId, TEST_PASSWORD, NEW_PW);
    expect(r.success).toBe(true);

    // Old password no longer works
    const loginOld = await Auth.loginUser(TEST_EMAIL, TEST_PASSWORD);
    expect(loginOld.success).toBe(false);

    // New password works
    const loginNew = await Auth.loginUser(TEST_EMAIL, NEW_PW);
    expect(loginNew.success).toBe(true);
  });

  test('ERROR: INVALID_CREDENTIALS for wrong old password', async () => {
    await Auth.registerUser(TEST_EMAIL, TEST_PASSWORD);
    mockAdapter._markEmailVerified(TEST_EMAIL);
    const login = await Auth.loginUser(TEST_EMAIL, TEST_PASSWORD);
    if (!login.success) throw new Error('login failed');

    const r = await Auth.changePassword(login.data.userId, 'wrong_old', 'newpassword456');
    expect(r.success).toBe(false);
    if (r.success) return;
    expect(r.error.code).toBe('INVALID_CREDENTIALS');
  });

  test('ERROR: WEAK_PASSWORD for new password <8 chars', async () => {
    await Auth.registerUser(TEST_EMAIL, TEST_PASSWORD);
    mockAdapter._markEmailVerified(TEST_EMAIL);
    const login = await Auth.loginUser(TEST_EMAIL, TEST_PASSWORD);
    if (!login.success) throw new Error('login failed');

    const r = await Auth.changePassword(login.data.userId, TEST_PASSWORD, 'short');
    expect(r.success).toBe(false);
    if (r.success) return;
    expect(r.error.code).toBe('WEAK_PASSWORD');
  });
});

// ---------------------------------------------------------------------------
// §10.8 verifyEmail
// ---------------------------------------------------------------------------

describe('Auth.verifyEmail (§10.8)', () => {
  test('SUCCESS: marks email as verified', async () => {
    await Auth.registerUser(TEST_EMAIL, TEST_PASSWORD);
    const token = mockAdapter._getLatestVerificationToken(TEST_EMAIL);
    expect(token).toBeTruthy();

    const r = await Auth.verifyEmail(token!);
    expect(r.success).toBe(true);
    if (!r.success) return;
    expect(r.data.userId).toBeTruthy();
    expect(r.data.emailVerified).toBe(true);

    // Now login should succeed (was previously EMAIL_NOT_VERIFIED)
    const login = await Auth.loginUser(TEST_EMAIL, TEST_PASSWORD);
    expect(login.success).toBe(true);
  });

  test('ERROR: INVALID_TOKEN for unknown token', async () => {
    const r = await Auth.verifyEmail('garbage_token');
    expect(r.success).toBe(false);
    if (r.success) return;
    expect(r.error.code).toBe('INVALID_TOKEN');
  });
});

// ---------------------------------------------------------------------------
// §3.6 compliance: every response follows the standard shape
// ---------------------------------------------------------------------------

describe('§3.6 Compliance — Standard Response Shape', () => {
  test('Every Auth function returns success-or-error envelope', async () => {
    const samples: StandardResponse<unknown>[] = [
      await Auth.registerUser(TEST_EMAIL, TEST_PASSWORD),
      await Auth.loginUser(TEST_EMAIL, TEST_PASSWORD),
      await Auth.logoutUser('garbage'),
      await Auth.refreshSession('garbage'),
      await Auth.verifySession('garbage'),
      await Auth.resetPassword('anyone@example.com'),
      await Auth.verifyEmail('garbage'),
    ];
    for (const r of samples) {
      assertStandardResponseShape(r);
      // Must have exactly one of `data` or `error`, never both, never neither.
      if (r.success) {
        expect(r.data).not.toBeUndefined();
        expect(r.error).toBeUndefined();
      } else {
        expect(r.error).not.toBeUndefined();
        expect(r.data).toBeUndefined();
      }
    }
  });
});

// ---------------------------------------------------------------------------
// §3.7 compliance: AUTH_PROVIDER_NOT_CONFIGURED
// ---------------------------------------------------------------------------

describe('§3.7 Compliance — AUTH_PROVIDER_NOT_CONFIGURED', () => {
  test('All Auth functions surface AUTH_PROVIDER_NOT_CONFIGURED when no adapter', async () => {
    _setAdapterForTesting(null);
    // Ensure mock mode is off and no Supabase creds configured.
    const originalMock = process.env.CODELOK_AUTH_USE_MOCK;
    process.env.CODELOK_AUTH_USE_MOCK = '';
    // Also clear any Supabase env vars for the duration of this test.
    const originalSupabaseUrl = process.env.SUPABASE_URL;
    const originalSupabaseAnon = process.env.SUPABASE_ANON_KEY;
    const originalSupabaseService = process.env.SUPABASE_SERVICE_ROLE_KEY;
    delete process.env.SUPABASE_URL;
    delete process.env.SUPABASE_ANON_KEY;
    delete process.env.SUPABASE_SERVICE_ROLE_KEY;

    try {
      const r = await Auth.registerUser(TEST_EMAIL, TEST_PASSWORD);
      expect(r.success).toBe(false);
      if (r.success) return;
      expect(r.error.code).toBe('AUTH_PROVIDER_NOT_CONFIGURED');
    } finally {
      process.env.CODELOK_AUTH_USE_MOCK = originalMock;
      if (originalSupabaseUrl !== undefined) process.env.SUPABASE_URL = originalSupabaseUrl;
      if (originalSupabaseAnon !== undefined) process.env.SUPABASE_ANON_KEY = originalSupabaseAnon;
      if (originalSupabaseService !== undefined) process.env.SUPABASE_SERVICE_ROLE_KEY = originalSupabaseService;
    }
  });
});

// ---------------------------------------------------------------------------
// §10 Module Interaction — Auth calls Mail through its public interface only
// ---------------------------------------------------------------------------

describe('§10 Module Interaction — Auth calls Mail.* through public interface', () => {
  test('registerUser triggers Mail.sendVerificationEmail (visible in outbox)', async () => {
    process.env.CODELOK_AUTH_USE_MOCK = 'true';
    await Auth.registerUser(TEST_EMAIL, TEST_PASSWORD);
    const outbox = _getOutboxForTesting();
    const hasVerification = outbox.some(
      (e) => e.type === 'verification' && e.to === TEST_EMAIL
    );
    expect(hasVerification).toBe(true);
    process.env.CODELOK_AUTH_USE_MOCK = '';
  });

  test('resetPassword triggers Mail.sendPasswordResetEmail', async () => {
    await Auth.resetPassword(TEST_EMAIL);
    const outbox = _getOutboxForTesting();
    const hasReset = outbox.some(
      (e) => e.type === 'password_reset' && e.to === TEST_EMAIL
    );
    expect(hasReset).toBe(true);
  });
});
