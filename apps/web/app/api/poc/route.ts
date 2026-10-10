import { getRun, resumeHook, start } from 'workflow/api';
import { HookNotFoundError } from 'workflow/errors';
import { z } from 'zod';
import { isAdmin, notFound } from '@/lib/admin-auth';
import { criteriaToken, type GateDecision } from '@/lib/gates';
import { RUN_ID } from '@/lib/run-id';
import { pocWorkflow } from '@/workflows/poc';

const Body = z.discriminatedUnion('action', [
  z.strictObject({ action: z.literal('start'), target: z.string().min(1).max(2048), brief: z.string().max(2000), mode: z.literal('plan') }),
  z.strictObject({ action: z.enum(['approve', 'reject']), runId: z.string().regex(RUN_ID) }),
]);

// Admin-only (bearer ADMIN_API_TOKEN, never in production): start a plan run, or decide its criteria gate
// when Telegram can't reach the run (a local dev server).
export async function POST(req: Request) {
  if (!isAdmin(req)) return notFound();
  const parsed = Body.safeParse(await req.json().catch(() => undefined));
  if (!parsed.success) return Response.json({ error: 'invalid request' }, { status: 400 });
  const body = parsed.data;
  if (body.action === 'start') {
    const run = await start(pocWorkflow, [{ target: body.target, brief: body.brief, mode: body.mode }]);
    return Response.json({ runId: run.runId });
  }
  const payload: GateDecision = { decision: body.action, userId: 'admin', via: 'admin' };
  try {
    await resumeHook(criteriaToken(body.runId), payload);
  } catch (err) {
    if (err instanceof HookNotFoundError || (err as Error)?.name === 'HookNotFoundError') {
      return Response.json({ error: 'no criteria gate is waiting for this run' }, { status: 409 });
    }
    throw err;
  }
  return Response.json({ runId: body.runId, decision: body.action });
}

export async function GET(req: Request) {
  if (!isAdmin(req)) return notFound();
  const runId = new URL(req.url).searchParams.get('runId') ?? '';
  if (!RUN_ID.test(runId)) return Response.json({ error: 'bad runId' }, { status: 400 });
  const run = getRun(runId);
  const status = await run.status;
  return Response.json({ runId, status, returnValue: status === 'completed' ? await run.returnValue : undefined });
}
