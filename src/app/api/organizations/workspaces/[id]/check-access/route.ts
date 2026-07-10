/**
 * GET /api/organizations/workspaces/[id]/check-access?userId=...
 *
 * Per §12: checkAccess takes a userId and workspaceId and returns
 * { member: true/false }. No access token required (the caller module is
 * responsible for having already authenticated the user).
 */
import { NextRequest } from 'next/server';
import { Organizations } from '@/modules/organizations';
import { sendResponse } from '../../../_helpers';

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const url = new URL(req.url);
  const userId = url.searchParams.get('userId') ?? '';
  const r = await Organizations.checkAccess(userId, id);
  return sendResponse(r);
}
