import { NextRequest, NextResponse } from 'next/server';
import { Auth } from '@/modules/auth';
import { Organizations } from '@/modules/organizations';
import { getAccessToken, sendResponse } from './organizations/_helpers';

export type WorkspaceAuthorization =
  | { ok: true; accessToken: string; userId: string }
  | { ok: false; response: NextResponse };

export async function authorizeWorkspaceRequest(
  req: NextRequest,
  workspaceId: string,
  options: { ownerOnly?: boolean } = {}
): Promise<WorkspaceAuthorization> {
  const accessToken = getAccessToken(req);
  if (!accessToken) {
    return {
      ok: false,
      response: NextResponse.json(
        { success: false, error: { code: 'UNAUTHORIZED', message: 'Authentication required.' } },
        { status: 401 }
      ),
    };
  }

  const session = await Auth.verifySession(accessToken);
  if (!session.success) return { ok: false, response: sendResponse(session) };

  const access = await Organizations.checkAccess(session.data.userId, workspaceId);
  if (!access.success || !access.data.member) {
    return {
      ok: false,
      response: NextResponse.json(
        { success: false, error: { code: 'NOT_A_MEMBER', message: 'Workspace access denied.' } },
        { status: 403 }
      ),
    };
  }

  if (options.ownerOnly) {
    const members = await Organizations.listMembersWithIdentity(accessToken, workspaceId);
    if (!members.success) return { ok: false, response: sendResponse(members) };
    const caller = members.data.find((member) => member.userId === session.data.userId);
    if (!caller || caller.roleName !== 'Owner') {
      return {
        ok: false,
        response: NextResponse.json(
          { success: false, error: { code: 'FORBIDDEN', message: 'Owner permission is required.' } },
          { status: 403 }
        ),
      };
    }
  }

  return { ok: true, accessToken, userId: session.data.userId };
}
