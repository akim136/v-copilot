import { createHash, timingSafeEqual } from 'node:crypto';
import { getRun, start } from 'workflow/api';
import { RUN_ID } from '@/lib/run-id';
import { spikeGate } from '@/workflows/spike-gate';

const notFound = () => new Response('Not found', { status: 404 });
const digest = (s: string) => createHash('sha256').update(s).digest();

// Admin-only, never in production. Compares SHA-256 digests so lengths always match.
function authorized(req: Request): boolean {
  if (process.env.VERCEL_ENV === 'production') return false;
  const expected = process.env.ADMIN_API_TOKEN;
  const header = req.headers.get('authorization') ?? '';
  if (!expected || !header.startsWith('Bearer ')) return false;
  return timingSafeEqual(digest(header.slice(7)), digest(expected));
}

export async function POST(req: Request) {
  if (!authorized(req)) return notFound();
  const run = await start(spikeGate, []);
  return Response.json({ runId: run.runId });
}

export async function GET(req: Request) {
  if (!authorized(req)) return notFound();
  const runId = new URL(req.url).searchParams.get('runId') ?? '';
  if (!RUN_ID.test(runId)) return Response.json({ error: 'bad runId' }, { status: 400 });
  const run = getRun(runId);
  const status = await run.status;
  return Response.json({ runId, status, returnValue: status === 'completed' ? await run.returnValue : undefined });
}
