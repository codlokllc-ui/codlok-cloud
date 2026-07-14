/** GET /api/config/providers — list all providers across all modules */
import { NextRequest, NextResponse } from 'next/server';
import { Configuration } from '@/config';

export async function GET() {
  const r = await Configuration.listAllProviders();
  return NextResponse.json(r, { status: r.success ? 200 : 500 });
}
