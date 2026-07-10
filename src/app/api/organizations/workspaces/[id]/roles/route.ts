/**
 * GET  /api/organizations/workspaces/[id]/roles
 * POST /api/organizations/workspaces/[id]/roles   Body: { name, description?, permissions: string[] }
 */
import { NextRequest } from 'next/server';
import { Organizations } from '@/modules/organizations';
import { parseBody, getAccessToken, sendResponse } from '../../../_helpers';

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const r = await Organizations.listRoles(getAccessToken(req), id);
  return sendResponse(r);
}

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const parsed = await parseBody<{ name?: string; description?: string; permissions?: string[] }>(req);
  if (!parsed.ok) return parsed.response;
  const r = await Organizations.createRole(getAccessToken(req), id, {
    name: parsed.body.name ?? '',
    description: parsed.body.description,
    permissions: parsed.body.permissions ?? [],
  });
  return sendResponse(r);
}
