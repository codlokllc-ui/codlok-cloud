/**
 * POST /api/organizations/workspaces/[id]/leave
 */
import { NextRequest } from 'next/server';
import { Organizations } from '@/modules/organizations';
import { getAccessToken, sendResponse } from '../../../_helpers';

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const r = await Organizations.leaveWorkspace(getAccessToken(req), id);
  return sendResponse(r);
}
