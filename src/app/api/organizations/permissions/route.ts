/**
 * GET /api/organizations/permissions
 *   Returns the immutable permission catalog.
 */
import { NextResponse } from 'next/server';
import { Organizations } from '@/modules/organizations';

export async function GET() {
  const r = await Organizations.listPermissions();
  return NextResponse.json(r, { status: r.success ? 200 : 500 });
}
