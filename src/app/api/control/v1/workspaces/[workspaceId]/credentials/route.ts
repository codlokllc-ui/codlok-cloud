import { NextRequest, NextResponse } from 'next/server';
import { ProductCredentials, type CredentialEnvironment, type ProductScope } from '@/modules/product-credentials';
import { authorizeWorkspaceRequest } from '@/app/api/_workspace-auth';
import { sendResponse } from '@/app/api/organizations/_helpers';

export async function GET(req: NextRequest, { params }: { params: Promise<{ workspaceId: string }> }) {
  const { workspaceId } = await params;
  const auth = await authorizeWorkspaceRequest(req, workspaceId, { requiredPermission: 'credentials:read' });
  if (!auth.ok) return auth.response;
  return sendResponse(await ProductCredentials.listCredentials(workspaceId));
}

export async function POST(req: NextRequest, { params }: { params: Promise<{ workspaceId: string }> }) {
  const { workspaceId } = await params;
  const auth = await authorizeWorkspaceRequest(req, workspaceId, { requiredPermission: 'credentials:manage' });
  if (!auth.ok) return auth.response;
  let body: { name?: string; environment?: CredentialEnvironment; scopes?: ProductScope[]; expiresAt?: string | null };
  try { body = await req.json(); }
  catch { return NextResponse.json({ success: false, error: { code: 'INVALID_INPUT', message: 'Invalid JSON body.' } }, { status: 400 }); }
  return sendResponse(await ProductCredentials.createCredential({
    workspaceId, name: body.name ?? '', environment: body.environment as CredentialEnvironment,
    scopes: body.scopes ?? [], expiresAt: body.expiresAt, createdBy: auth.userId,
  }));
}
