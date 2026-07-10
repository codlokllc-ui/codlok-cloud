/**
 * POST   /api/organizations/workspaces/[id]/invitations/[invitationId]/[action]
 *   action: "cancel" | "resend"
 */
import { NextRequest } from 'next/server';
import { Organizations } from '@/modules/organizations';
import { getAccessToken, sendResponse } from '../../../../../_helpers';

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string; invitationId: string; action: string }> }
) {
  const { id, invitationId, action } = await params;
  if (action === 'cancel') {
    const r = await Organizations.cancelInvitation(getAccessToken(req), id, invitationId);
    return sendResponse(r);
  }
  if (action === 'resend') {
    const r = await Organizations.resendInvitation(getAccessToken(req), id, invitationId);
    return sendResponse(r);
  }
  return sendResponse({
    success: false,
    error: { code: 'INVALID_INPUT', message: `Unknown action: ${action}` },
  });
}
