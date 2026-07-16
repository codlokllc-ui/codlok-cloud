/** Workspace-scoped non-secret Configuration settings. */
import { NextRequest, NextResponse } from 'next/server';
import { Auth } from '@/modules/auth';
import { Organizations } from '@/modules/organizations';
import { Configuration } from '@/config';
import { getAccessToken, sendResponse } from '../../../organizations/_helpers';

async function authorize(req: NextRequest, workspaceId: string) {
  const accessToken = getAccessToken(req);
  if (!accessToken) return { ok: false as const, response: NextResponse.json({ success: false, error: { code: 'UNAUTHORIZED', message: 'Authentication required.' } }, { status: 401 }) };
  const session = await Auth.verifySession(accessToken);
  if (!session.success) return { ok: false as const, response: sendResponse(session) };
  const access = await Organizations.checkAccess(session.data.userId, workspaceId);
  if (!access.success || !access.data.member) return { ok: false as const, response: NextResponse.json({ success: false, error: { code: 'NOT_A_MEMBER', message: 'Workspace access denied.' } }, { status: 403 }) };
  const members = await Organizations.listMembersWithIdentity(accessToken, workspaceId);
  if (!members.success) return { ok: false as const, response: sendResponse(members) };
  const caller = members.data.find((member) => member.userId === session.data.userId);
  if (!caller || caller.roleName !== 'Owner') return { ok: false as const, response: NextResponse.json({ success: false, error: { code: 'FORBIDDEN', message: 'Owner permission is required.' } }, { status: 403 }) };
  return { ok: true as const, accessToken, userId: session.data.userId };
}

export async function GET(req: NextRequest, { params }: { params: Promise<{ key: string }> }) {
  const { key } = await params;
  const workspaceId = new URL(req.url).searchParams.get('workspaceId') ?? '';
  const auth = await authorize(req, workspaceId);
  if (!auth.ok) return auth.response;
  return sendResponse(await Configuration.getSetting(workspaceId, key));
}

export async function POST(req: NextRequest, { params }: { params: Promise<{ key: string }> }) {
  const { key } = await params;
  let body: { workspaceId?: string; value?: string };
  try { body = await req.json(); } catch { return NextResponse.json({ success: false, error: { code: 'INVALID_INPUT', message: 'Invalid JSON body.' } }, { status: 400 }); }
  const workspaceId = body.workspaceId ?? '';
  const auth = await authorize(req, workspaceId);
  if (!auth.ok) return auth.response;
  return sendResponse(await Configuration.setSetting(workspaceId, key, body.value ?? '', auth.userId));
}

export async function DELETE(req: NextRequest, { params }: { params: Promise<{ key: string }> }) {
  const { key } = await params;
  const workspaceId = new URL(req.url).searchParams.get('workspaceId') ?? '';
  const auth = await authorize(req, workspaceId);
  if (!auth.ok) return auth.response;
  return sendResponse(await Configuration.deleteSetting(workspaceId, key, auth.userId));
}
