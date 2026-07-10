/**
 * GET /api/organizations/workspaces
 *   Header: Authorization: Bearer <accessToken>
 * → Organizations.listWorkspaces()
 *
 * POST /api/organizations/workspaces
 *   Body: { name, description? }
 * → Organizations.createWorkspace()
 */
import { NextRequest } from 'next/server';
import { Organizations } from '@/modules/organizations';
import { parseBody, getAccessToken, sendResponse } from '../_helpers';

export async function GET(req: NextRequest) {
  const accessToken = getAccessToken(req);
  const r = await Organizations.listWorkspaces(accessToken);
  return sendResponse(r);
}

export async function POST(req: NextRequest) {
  const parsed = await parseBody<{ name?: string; description?: string }>(req);
  if (!parsed.ok) return parsed.response;
  const accessToken = getAccessToken(req);
  const r = await Organizations.createWorkspace(accessToken, {
    name: parsed.body.name ?? '',
    description: parsed.body.description,
  });
  return sendResponse(r);
}
