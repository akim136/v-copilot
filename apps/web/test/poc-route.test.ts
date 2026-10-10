import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const wf = vi.hoisted(() => ({ start: vi.fn(), resumeHook: vi.fn(), getRun: vi.fn() }));
class HookNotFoundError extends Error {
  override name = 'HookNotFoundError';
}
vi.mock('workflow/api', () => wf);
vi.mock('workflow/errors', () => ({ HookNotFoundError }));
vi.mock('@/workflows/poc', () => ({ pocWorkflow: 'pocWorkflow' }));

const { GET, POST } = await import('@/app/api/poc/route');

const TOKEN = 'admin-token-for-tests-0123456789';
const RUN = 'wrun_01K7AAAAAAAAAAAAAAAAAAAAAA';
const post = (body: unknown, auth = `Bearer ${TOKEN}`) =>
  POST(new Request('https://x/api/poc', { method: 'POST', headers: { authorization: auth }, body: JSON.stringify(body) }));

describe('admin poc route', () => {
  beforeEach(() => {
    process.env.ADMIN_API_TOKEN = TOKEN;
    for (const f of Object.values(wf)) f.mockReset();
    wf.start.mockResolvedValue({ runId: RUN });
  });
  afterEach(() => {
    delete process.env.ADMIN_API_TOKEN;
    delete process.env.VERCEL_ENV;
  });

  it('starts a plan run with exactly the validated input', async () => {
    const res = await post({ action: 'start', target: 'prospect-landing', brief: 'Make it fast', mode: 'plan' });
    expect(await res.json()).toEqual({ runId: RUN });
    expect(wf.start).toHaveBeenCalledWith('pocWorkflow', [{ target: 'prospect-landing', brief: 'Make it fast', mode: 'plan' }]);
  });

  it('answers 404 to a missing or wrong token, and to everyone in production', async () => {
    expect((await post({ action: 'start', target: 'prospect-landing', brief: '', mode: 'plan' }, 'Bearer wrong')).status).toBe(404);
    expect((await post({ action: 'start', target: 'prospect-landing', brief: '', mode: 'plan' }, '')).status).toBe(404);
    process.env.VERCEL_ENV = 'production';
    expect((await post({ action: 'start', target: 'prospect-landing', brief: '', mode: 'plan' })).status).toBe(404);
    expect((await GET(new Request(`https://x/api/poc?runId=${RUN}`, { headers: { authorization: `Bearer ${TOKEN}` } }))).status).toBe(404);
    expect(wf.start).not.toHaveBeenCalled();
  });

  it('rejects malformed requests', async () => {
    for (const body of [
      { action: 'start', target: 'prospect-landing', brief: '', mode: 'full' },
      { action: 'start', target: '', brief: '', mode: 'plan' },
      { action: 'start', target: 'x'.repeat(2049), brief: '', mode: 'plan' },
      { action: 'start', target: 'prospect-landing', brief: 'b'.repeat(2001), mode: 'plan' },
      { action: 'start', target: 'prospect-landing', brief: '', mode: 'plan', extra: 1 },
      { action: 'approve', runId: 'wrun_short' },
      { action: 'delete', runId: RUN },
    ]) expect((await post(body)).status).toBe(400);
    const res = await POST(new Request('https://x/api/poc', { method: 'POST', headers: { authorization: `Bearer ${TOKEN}` }, body: 'not json' }));
    expect(res.status).toBe(400);
    expect(wf.start).not.toHaveBeenCalled();
  });

  it('resumes the criteria gate as admin, and answers 409 when no gate is waiting', async () => {
    wf.resumeHook.mockResolvedValueOnce({});
    expect((await post({ action: 'reject', runId: RUN })).status).toBe(200);
    expect(wf.resumeHook).toHaveBeenCalledWith(`criteria:${RUN}`, { decision: 'reject', userId: 'admin', via: 'admin' });
    wf.resumeHook.mockRejectedValueOnce(new HookNotFoundError('gone'));
    expect((await post({ action: 'approve', runId: RUN })).status).toBe(409);
  });

  it('reports a run\'s status and outcome', async () => {
    wf.getRun.mockReturnValue({ status: Promise.resolve('completed'), returnValue: Promise.resolve({ runId: RUN, status: 'planned', costUsd: 0.02 }) });
    const res = await GET(new Request(`https://x/api/poc?runId=${RUN}`, { headers: { authorization: `Bearer ${TOKEN}` } }));
    expect(await res.json()).toEqual({ runId: RUN, status: 'completed', returnValue: { runId: RUN, status: 'planned', costUsd: 0.02 } });
    expect((await GET(new Request('https://x/api/poc?runId=nope', { headers: { authorization: `Bearer ${TOKEN}` } }))).status).toBe(400);
  });
});
