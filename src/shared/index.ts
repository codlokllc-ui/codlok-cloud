/**
 * Codlok Cloud — Shared Module
 *
 * Per Master Spec §4: "shared (standard response types, shared utilities only —
 * no business logic)".
 *
 * Per Master Spec §3.6: every public module function returns this shape.
 * No exceptions.
 */

// ---------------------------------------------------------------------------
// Standard API Response Shape (§3.6)
// ---------------------------------------------------------------------------

export interface SuccessResponse<TData = unknown, TMeta = unknown> {
  success: true;
  data: TData;
  meta?: TMeta;
}

export interface ErrorResponse {
  success: false;
  error: {
    /** Codlok-standard error code (UPPER_SNAKE_CASE). Never a provider string. */
    code: string;
    /** Human-readable message safe to surface to callers. */
    message: string;
  };
}

export type StandardResponse<TData = unknown, TMeta = unknown> =
  | SuccessResponse<TData, TMeta>
  | ErrorResponse;

// ---------------------------------------------------------------------------
// Constructors — guarantees the shape is exactly what §3.6 specifies
// ---------------------------------------------------------------------------

export function ok<TData, TMeta = unknown>(
  data: TData,
  meta?: TMeta
): SuccessResponse<TData, TMeta> {
  if (meta === undefined) {
    return { success: true, data };
  }
  return { success: true, data, meta };
}

export function fail(code: string, message: string): ErrorResponse {
  return { success: false, error: { code, message } };
}

// ---------------------------------------------------------------------------
// Workspace Context (§6, §10 "Workspace Context")
//
// `workspaceId` is OPTIONAL context passed to module functions. It does not
// scope identity, credentials, or `userId`. It only selects branding /
// templates / redirect URLs for downstream module calls (e.g. Mail).
// ---------------------------------------------------------------------------

export interface WorkspaceContext {
  workspaceId?: string;
}

export { codlokEnvironment, type CodlokEnvironment } from './environment';

// ---------------------------------------------------------------------------
// ModuleError — internal exception type
//
// Per §3.6: "Internal exceptions may be thrown inside a module; the public
// interface always returns the standard response shape above."
//
// Modules throw ModuleError internally with a Codlok-standard code; the public
// interface boundary catches and translates it into an ErrorResponse.
// ---------------------------------------------------------------------------

export class ModuleError extends Error {
  constructor(
    public readonly code: string,
    message: string
  ) {
    super(message);
    this.name = 'ModuleError';
  }
}

/**
 * Wrap an internal module operation so that:
 *  - ModuleError → standard ErrorResponse with the given code/message
 *  - Unknown Error → standard ErrorResponse with INTERNAL_ERROR
 *
 * This is the single boundary that enforces §3.6 at every public function.
 */
export function withStandardResponse<TData>(
  fn: () => Promise<TData>
): Promise<StandardResponse<TData>> {
  return fn()
    .then((data) => ok(data))
    .catch((err) => {
      if (err instanceof ModuleError) {
        return fail(err.code, err.message);
      }
      // Never leak provider/unknown error text to callers.
      return fail('INTERNAL_ERROR', 'An internal error occurred.');
    });
}
