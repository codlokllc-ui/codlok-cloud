import { NextRequest } from 'next/server';
import { ProductCredentials } from '@/modules/product-credentials';
import { authorizeWorkspaceRequest } from '@/app/api/_workspace-auth';
import { sendResponse } from '@/app/api/organizations/_helpers';

export async function DELETE(req: NextRequest, { params }: { params: Promise<{ workspaceId: string; credentialId: string }> }) {
  const { workspaceId, credentialId } = await params;
  const auth = await authorizeWorkspaceRequest(req, workspaceId, { requiredPermission: 'credentials:manage' });
  if (!auth.ok) return auth.response;
  return sendResponse(await ProductCredentials.revokeCredential(workspaceId, credentialId));
}
