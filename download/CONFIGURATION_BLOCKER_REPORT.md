=============================
BLOCKER REPORT
=============================

Module: Configuration Service v1.0 (Phase 2, per §13 Build Order)
Stage:  STEP 1 — Validation (§16 public interface vs. actual Auth/Organizations stub usage)
Result: SPEC CONFLICT FOUND — STOPPED per directive

------------------------------------------------------------------------
Problem
------------------------------------------------------------------------

§16 claims its public interface is "a strict superset of what [Auth and
Organizations] currently use" (line 563). It is not. Auth v1.1's
Supabase adapter calls the Phase 1 Configuration stub in ways that
§16's public interface does not support. If I swap in the §16
interface as-specified, Auth's `resolveSupabaseCredentials()` function
breaks at runtime. Five distinct conflicts exist.

------------------------------------------------------------------------
Specification says (§16)
------------------------------------------------------------------------

§16 line 563 (constraint carried over from stub):
  > "The public interface defined below must be a strict superset of
  > what those two modules currently use, so that swapping the backing
  > store requires zero code changes in Auth or Organizations — only
  > wiring/dependency injection, per §8 rule 5 and the existing stub's
  > documented promise."

§16 Public Interface (lines 567–592):
  getSecret(workspaceId, key)
    → Success data: { value }
    → Errors: SECRET_NOT_CONFIGURED, WORKSPACE_NOT_FOUND
  setSecret(workspaceId, key, value)
  deleteSecret(workspaceId, key)
  getProviderStatus(workspaceId, moduleId)
  listConfiguredModules(workspaceId)
  getFeatureFlag(workspaceId, key) / setFeatureFlag(workspaceId, key, value)

  Explicitly excluded: testConnection() and any batch method.

§16 line 597 (Workspace Context):
  > "Every function requires `workspaceId`" — workspaceId is REQUIRED,
  > not optional.

§16 returns StandardResponse (§3.6) for every function — success:
{ success: true, data: { value } }, failure: { success: false, error:
{ code, message } }.

------------------------------------------------------------------------
Reality (actual Auth stub usage)
------------------------------------------------------------------------

File: src/modules/auth/adapters/supabase.ts, lines 43–60

  export async function resolveSupabaseCredentials(
    workspaceId?: string
  ): Promise<SupabaseCredentials | null> {
    const config = getConfigurationService();
    const secrets = await config.getSecrets(           // ← CONFLICT 1
      ['SUPABASE_URL', 'SUPABASE_ANON_KEY', 'SUPABASE_SERVICE_ROLE_KEY'],
      workspaceId                                     // ← CONFLICT 2 (optional, 2nd arg)
    );
    const url = secrets.SUPABASE_URL?.value;           // ← CONFLICT 3 (reads .value directly)
    const anonKey = secrets.SUPABASE_ANON_KEY?.value;  // ← CONFLICT 3
    const serviceRoleKey = secrets.SUPABASE_SERVICE_ROLE_KEY?.value;
    if (!url || !anonKey || !serviceRoleKey) return null;  // ← CONFLICT 4
    return { url, anonKey, serviceRoleKey };
  }

The Phase 1 stub interface (src/config/index.ts, lines 31–46):
  interface ConfigurationService {
    getSecret(key: string, workspaceId?: string): Promise<SecretRecord>;
    getSecrets(keys: string[], workspaceId?: string): Promise<Record<string, SecretRecord>>;
  }
  interface SecretRecord {
    value: string | undefined;
    configured: boolean;
  }

Organizations v1.0 does NOT call Configuration directly (verified by
grep — zero matches). So only Auth's usage is at issue.

------------------------------------------------------------------------
Conflict breakdown (5 conflicts)
------------------------------------------------------------------------

CONFLICT 1 — `getSecrets` batch method missing from §16
  Auth calls: config.getSecrets(['KEY1','KEY2','KEY3'], workspaceId)
  §16 defines: getSecret(workspaceId, key) — single key only
  §16 has NO batch method.
  Impact: Auth's call would fail with "config.getSecrets is not a
  function" at runtime.

CONFLICT 2 — Argument order reversed
  Stub: getSecret(key, workspaceId?) — key first, workspaceId optional
  §16:  getSecret(workspaceId, key) — workspaceId first, key second,
        workspaceId REQUIRED
  Impact: Even if Auth switched to getSecret, passing key as the first
  argument would be interpreted as workspaceId by §16's interface.

CONFLICT 3 — Return shape: raw SecretRecord vs StandardResponse
  Stub returns: SecretRecord = { value: string | undefined, configured:
                boolean } — a raw object, no envelope
  §16 returns: StandardResponse<{ value }> = { success: true, data:
               { value } } or { success: false, error: {...} }
  Auth reads: secrets.SUPABASE_URL?.value — accesses .value directly
              on the raw record, no .data wrapper, no .success check
  Impact: Auth would read `undefined` from `secrets.SUPABASE_URL` (which
  is now { success, data } not { value, configured }), and `.value`
  would be undefined even when the secret exists.

CONFLICT 4 — Missing-key semantics: undefined value vs error response
  Stub: returns { value: undefined, configured: false } when key is
        missing — no error thrown, no error envelope
  §16:  returns { success: false, error: { code: 'SECRET_NOT_CONFIGURED',
        message: '...' } } — an error response
  Auth checks: if (!url || !anonKey || !serviceRoleKey) return null;
               — relies on falsy undefined values, not error responses
  Impact: With §16, each missing key returns an error response. Auth's
  truthiness check would see the error object as truthy, and `.value`
  on the error object would be undefined — accidentally producing the
  same null return, but only by luck, and the error would go unhandled.

CONFLICT 5 — `configured` field absent from §16
  Stub's SecretRecord has: configured: boolean
  §16's getSecret success data: { value } — no `configured` field
  Auth does NOT currently read `configured` (it checks value truthiness),
  so this is the least severe conflict — but the SecretRecord type that
  Auth's code is typed against would not exist in §16.

------------------------------------------------------------------------
Why this cannot be worked around silently
------------------------------------------------------------------------

The directive says:
  > "Confirm the current Phase 1 Configuration stub used by Auth v1.1
  > and Organizations v1.0 is a subset of §16's public interface — every
  > call they currently make must keep working unmodified once the real
  > backing store replaces the stub."

  > "If anything in §16 conflicts with how Auth or Organizations
  > actually call Configuration today, STOP and submit a Blocker Report."

The stub's interface is NOT a subset of §16's interface:
  - getSecrets (batch) exists in stub, absent in §16 → not a subset
  - getSecret(key, ws?) signature differs from getSecret(ws, key) → not a subset
  - Raw SecretRecord return differs from StandardResponse → not a subset

§16's own constraint (line 563) is violated by §16's own public
interface (lines 567–592). This is an internal spec contradiction that
I cannot resolve without either changing §16 (frozen) or changing Auth
(directive says don't modify except wiring/DI).

------------------------------------------------------------------------
Recommendation (smallest possible change)
------------------------------------------------------------------------

Two options. Both require a decision before I can proceed.

  OPTION A — Unfreeze §16 minimally to add `getSecrets` and align
  the interface with the existing stub promise.

    A1. Add to §16's Public Interface:
        getSecrets(workspaceId, keys[])
          → Success data: { secrets: Record<string, { value }> }
          → Errors: WORKSPACE_NOT_FOUND
          (Batch read of multiple keys in one call. Returns a map of
          key → { value }. Missing keys are omitted from the map
          rather than producing an error, so callers can check
          presence. This matches Auth's current usage pattern.)

    A2. Reconcile the return shape. The core question: does getSecret
        return StandardResponse<{ value }> (per §16 as written) or
        StandardResponse<SecretRecord> (with configured field, per
        the stub)? Recommend: StandardResponse<{ value, configured }>
        so callers get both fields. Auth's code would then need to
        unwrap .data.value — a minimal wiring change.

    A3. Keep workspaceId as the first argument per §16 (not the stub's
        optional-second-arg pattern). Auth's resolveSupabaseCredentials
        would be updated to pass workspaceId first — a minimal wiring
        change to an internal function (not a public contract change).

    Trade-off: Unfreezes §16 for one additive function (getSecrets)
    and one field addition (configured). §16 was just frozen in v1.5,
    so this reopens it briefly. But §16's own constraint (line 563)
    requires this — the spec contradicts itself without this fix.

  OPTION B — Update Auth's internal wiring (resolveSupabaseCredentials
  only) to call §16's getSecret three times instead of getSecrets once.
  Do NOT change §16.

    B1. In src/modules/auth/adapters/supabase.ts, replace:
          const secrets = await config.getSecrets([...], workspaceId);
          const url = secrets.SUPABASE_URL?.value;
        with:
          const [urlR, anonR, serviceR] = await Promise.all([
            config.getSecret(workspaceId, 'SUPABASE_URL'),
            config.getSecret(workspaceId, 'SUPABASE_ANON_KEY'),
            config.getSecret(workspaceId, 'SUPABASE_SERVICE_ROLE_KEY'),
          ]);
          const url = urlR.success ? urlR.data.value : undefined;
          const anonKey = anonR.success ? anonR.data.value : undefined;
          const serviceRoleKey = serviceR.success ? serviceR.data.value : undefined;

    B2. Auth's public interface does NOT change. No Auth test changes.
        The change is confined to one internal function
        (resolveSupabaseCredentials) which is not exported from Auth's
        public surface.

    B3. The Configuration Service implements §16 exactly as specified —
        no batch method, no configured field, StandardResponse
        envelope, workspaceId required and first.

    Trade-off: This is a modification to Auth, which the directive
    says to avoid "except wiring/dependency injection." Changing
    getSecrets → getSecret IS consuming the real Configuration Service
    (it's wiring), but it's also a code change to a frozen module.
    The question is whether the reviewer considers this "wiring" or
    "modification." The Auth public interface is unchanged; only the
    internal adapter function that calls Configuration changes.

  OPTION C — (NOT recommended) Add a backward-compatible adapter
  inside the Configuration module that exposes the old stub interface
  to Auth while implementing §16's interface internally.

    This would mean the Configuration module exports TWO interfaces:
    the §16 public interface AND a legacy compatibility shim. Auth
    continues to call the shim. This violates §3.3 (modules communicate
    only through public interfaces) because Auth would be calling a
    non-public shim, and it creates a maintenance burden. Not
    recommended.

------------------------------------------------------------------------
Decision required
------------------------------------------------------------------------

  (i)  Approve Option A — unfreeze §16 to add getSecrets + align the
       interface, then build Configuration Service per the revised §16.
       Auth changes zero lines.

  (ii) Approve Option B — keep §16 as-is, update Auth's
       resolveSupabaseCredentials (one internal function, no public
       contract change) to call getSecret three times. Auth changes
       ~10 lines in one internal adapter function. All 36 Auth tests
       must still pass unmodified.

  (iii) Other direction you specify.

No Configuration Service code has been written. No Auth code has been
modified. No spec file has been modified. STOPPED per directive.

------------------------------------------------------------------------
Status
------------------------------------------------------------------------

Configuration Service: NOT BUILT (§16 interface conflicts with Auth
                       stub usage — 5 conflicts identified)
Auth: UNCHANGED (frozen v1.1, zero modifications)
Organizations: UNCHANGED (frozen v1.0, zero modifications — does not
               call Configuration directly)
Spec: UNCHANGED (§16 as written conflicts with its own line 563
      constraint)
Ready For Review: NO — waiting on direction decision (i), (ii), or (iii)
