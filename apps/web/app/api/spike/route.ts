import { getRun, start } from 'workflow/api';
import { isAdmin, notFound } from '@/lib/admin-auth';
import { RUN_ID } from '@/lib/run-id';
import { spikeGate } from '@/workflows/spike-gate';

export async function POST(req: Request) {
  if (!isAdmin(req)) return notFound();
  const run = await start(spikeGate, []);
  return Response.json({ runId: run.runId });
}

export async function GET(req: Request) {
  if (!isAdmin(req)) return notFound();
  const runId = new URL(req.url).searchParams.get('runId') ?? '';
  if (!RUN_ID.test(runId)) return Response.json({ error: 'bad runId' }, { status: 400 });
  const run = getRun(runId);
  const status = await run.status;
  return Response.json({ runId, status, returnValue: status === 'completed' ? await run.returnValue : undefined });
}
