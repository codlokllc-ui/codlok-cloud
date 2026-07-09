/**
 * GET /api/organizations/workspaces/[id]/members-with-identity
 *   Returns listMembers + identity attributes resolved via Auth.getUser.
 */
import { NextRequest } from 'next/server';
import { Organizations } from '@/modules/organizations';
import { getAccessToken, sendResponse } from '../../../_helpers';

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const r = await Organizations.listMembersWithIdentity(getAccessToken(req), id);
  return sendResponse(r);
}
