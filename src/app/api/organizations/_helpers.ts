/**
 * Codlok Cloud — Organizations API Routes — Shared Helpers
 *
 * Thin wrappers that parse JSON bodies, call Organizations public functions,
 * and return the StandardResponse as JSON. No business logic here — routes
 * are pure pass-throughs per §3.3 (modules communicate only through their
 * public interface).
 */

import { NextRequest, NextResponse } from 'next/server';
import type { StandardResponse } from '@/shared';

/** Parse a JSON body, returning a 400 StandardResponse on failure. */
export async function parseBody<T = unknown>(
  req: NextRequest
): Promise<{ ok: true; body: T } | { ok: false; response: NextResponse }> {
  try {
    const body = (await req.json()) as T;
    return { ok: true, body };
  } catch {
    return {
      ok: false,
      response: NextResponse.json(
        {
          success: false,
          error: { code: 'INVALID_INPUT', message: 'Invalid JSON body.' },
        },
        { status: 400 }
      ),
    };
  }
}

/** Extract the Bearer token from the Authorization header. */
export function getAccessToken(req: NextRequest): string {
  const auth = req.headers.get('authorization') ?? '';
  if (auth.startsWith('Bearer ')) return auth.slice('Bearer '.length);
  return '';
}

/** Send a StandardResponse as JSON with an appropriate HTTP status. */
export function sendResponse<T>(r: StandardResponse<T>): NextResponse {
  const status = r.success ? 200 : _httpStatusForError(r.error.code);
  return NextResponse.json(r, { status });
}

function _httpStatusForError(code: string): number {
  switch (code) {
    case 'UNAUTHORIZED':
    case 'INVALID_SESSION':
    case 'SESSION_EXPIRED':
      return 401;
    case 'NOT_A_MEMBER':
    case 'FORBIDDEN':
    case 'PRIVILEGE_ESCALATION':
    case 'LAST_OWNER_CANNOT_LEAVE':
    case 'LAST_OWNER_CANNOT_BE_REMOVED':
    case 'USER_LEVEL_PERMISSION_REJECTED':
    case 'BUILT_IN_ROLE_PROTECTED':
    case 'TRANSFER_REQUIRES_CONFIRMATION':
    case 'CANNOT_INVITE_SELF':
    case 'CANNOT_REMOVE_SELF':
      return 403;
    case 'WORKSPACE_NOT_FOUND':
    case 'MEMBER_NOT_FOUND':
    case 'ROLE_NOT_FOUND':
    case 'INVITATION_NOT_FOUND':
    case 'PERMISSION_NOT_FOUND':
    case 'USER_NOT_FOUND':
      return 404;
    case 'WORKSPACE_ALREADY_EXISTS':
    case 'ROLE_ALREADY_EXISTS':
    case 'ALREADY_A_MEMBER':
    case 'INVITATION_ALREADY_PENDING':
    case 'INVITATION_EXPIRED':
    case 'INVITATION_ALREADY_ACCEPTED':
    case 'INVITATION_ALREADY_DECLINED':
    case 'INVITATION_ALREADY_CANCELLED':
    case 'INVITATION_TOKEN_INVALID':
      return 409;
    case 'WORKSPACE_NAME_REQUIRED':
    case 'ROLE_NAME_REQUIRED':
    case 'ASSIGN_TARGET_NOT_MEMBER':
    case 'TRANSFER_TARGET_NOT_MEMBER':
    case 'TRANSFER_CALLER_NOT_OWNER':
      return 400;
    default:
      return 500;
  }
}
