/**
 * GET  /api/config/feature-flags/[key]?workspaceId=ws1
 *   → Configuration.getFeatureFlag(workspaceId, key)
 * POST /api/config/feature-flags/[key]
 *   Body: { workspaceId, value }
 *   → Configuration.setFeatureFlag(workspaceId, key, value, actorUserId)
 *
 * Used for workspace default provider selection:
 *   key: "default_provider:pay" → value: "stripe"
 *   key: "default_provider:mail" → value: "resend"
 */
import { NextRequest, NextResponse } from 'next/server';
import { Configuration } from '@/config';
import { getAccessToken, sendResponse } from '../../../organizations/_helpers';

export async function GET(req: NextRequest, { params }: { params: Promise<{ key: string }> }) {
  const { key } = await params;
  const url = new URL(req.url);
  const workspaceId = url.searchParams.get('workspaceId') ?? '';
  const r = await Configuration.getFeatureFlag(workspaceId, key);
  return sendResponse(r);
}

export async function POST(req: NextRequest, { params }: { params: Promise<{ key: string }> }) {
  const { key } = await params;
  let body: { workspaceId?: string; value?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json(
      { success: false, error: { code: 'INVALID_INPUT', message: 'Invalid JSON body.' } },
      { status: 400 }
    );
  }
  const accessToken = getAccessToken(req);
  const r = await Configuration.setFeatureFlag(
    body.workspaceId ?? '',
    key,
    body.value ?? '',
    accessToken || 'dashboard'
  );
  return sendResponse(r);
}
