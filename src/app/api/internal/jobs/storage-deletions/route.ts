import { NextRequest, NextResponse } from 'next/server';
import { verifyWorkerAuthorization } from '@/platform/jobs/auth';
import { processStorageDeletionJobs } from '@/platform/jobs/worker';

export const dynamic = 'force-dynamic';

export async function POST(req: NextRequest) {
  const configuredSecret = process.env.CODLOK_JOB_RUNNER_SECRET;
  if (!configuredSecret) {
    return NextResponse.json(
      { success: false, error: { code: 'JOB_RUNNER_NOT_CONFIGURED', message: 'Job runner is not configured.' } },
      { status: 503, headers: { 'Cache-Control': 'no-store' } }
    );
  }
  if (!verifyWorkerAuthorization(req.headers.get('authorization'), configuredSecret)) {
    return NextResponse.json(
      { success: false, error: { code: 'UNAUTHORIZED', message: 'Worker authorization failed.' } },
      { status: 401, headers: { 'Cache-Control': 'no-store' } }
    );
  }
  const rawLimit = Number(req.nextUrl.searchParams.get('limit') ?? 10);
  const batchSize = Number.isFinite(rawLimit) ? Math.min(25, Math.max(1, Math.floor(rawLimit))) : 10;
  try {
    const summary = await processStorageDeletionJobs({ batchSize });
    return NextResponse.json({ success: true, data: summary }, { headers: { 'Cache-Control': 'no-store' } });
  } catch {
    return NextResponse.json(
      { success: false, error: { code: 'JOB_RUNNER_FAILED', message: 'The job batch could not be processed.' } },
      { status: 500, headers: { 'Cache-Control': 'no-store' } }
    );
  }
}
