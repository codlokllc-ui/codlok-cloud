/**
 * POST /api/config/secrets
 * Body: { workspaceId, key, value, actorUserId }
 * → Configuration.setSecret(workspaceId, key, value, actorUserId)
 *
 * GET /api/config/secrets?workspaceId=ws1&key=STRIPE_SECRET_KEY
 * → Configuration.getSecret(workspaceId, key, 'dashboard')
 *   NOTE: getSecret returns the raw value. The dashboard route MUST NOT
 *   return the value to the client. It only returns whether the secret
 *   is configured (configured: true/false), never the value itself.
 *   This is a deliberate security boundary — the dashboard never exposes
 *   saved credentials (Rule 2, Step 3).
 */
import { NextRequest, NextResponse } from 'next/server';
import { Configuration } from '@/config';
import { sendResponse } from '../../organizations/_helpers';
import { authorizeWorkspaceRequest } from '@/app/api/_workspace-auth';

export async function POST(req: NextRequest) {
  let body: { workspaceId?: string; key?: string; value?: string; actorUserId?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json(
      { success: false, error: { code: 'INVALID_INPUT', message: 'Invalid JSON body.' } },
      { status: 400 }
    );
  }
  const auth = await authorizeWorkspaceRequest(req, body.workspaceId ?? '', { ownerOnly: true });
  if (!auth.ok) return auth.response;
  const r = await Configuration.setSecret(
    body.workspaceId ?? '',
    body.key ?? '',
    body.value ?? '',
    auth.userId
  );
  return sendResponse(r);
}

export async function GET(req: NextRequest) {
  const url = new URL(req.url);
  const workspaceId = url.searchParams.get('workspaceId') ?? '';
  const key = url.searchParams.get('key') ?? '';
  const auth = await authorizeWorkspaceRequest(req, workspaceId, { ownerOnly: true });
  if (!auth.ok) return auth.response;
  // Call getSecret to check if the secret is configured.
  // CRITICAL: We do NOT return the value to the client.
  // Only return whether it is configured.
  const r = await Configuration.getSecret(workspaceId, key, 'dashboard');
  if (r.success) {
    // Return only configured status, never the value.
    return NextResponse.json({ success: true, data: { configured: true } });
  }
  // If getSecret failed (SECRET_NOT_CONFIGURED), return configured: false.
  return NextResponse.json({ success: true, data: { configured: false } });
}
