/** GET /api/config/providers/[moduleId] — list providers for a specific module */
import { NextRequest, NextResponse } from 'next/server';
import { Configuration } from '@/config';

export async function GET(req: NextRequest, { params }: { params: Promise<{ moduleId: string }> }) {
  const { moduleId } = await params;
  const r = await Configuration.listProviders(moduleId);
  return NextResponse.json(r, { status: r.success ? 200 : 500 });
}
