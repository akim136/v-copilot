import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { CriteriaCard } from '@/lib/poc/types';
import type { PlanDeps } from '@/workflows/plan-run';

// A fake hook: resolves with `payload` when awaited, records the order of events.
const h = vi.hoisted(() => ({
  events: [] as string[],
  conflict: null as unknown,
  payload: undefined as unknown,
  tokens: [] as string[],
  deps: undefined as unknown,
}));
class FatalError extends Error {}
vi.mock('workflow', () => ({
  FatalError,
  getWorkflowMetadata: () => ({ workflowRunId: 'wrun_01K7AAAAAAAAAAAAAAAAAAAAAA' }),
  createHook: ({ token }: { token: string }) => {
    h.tokens.push(token);
    return {
      getConflict: async () => (h.events.push('register'), h.conflict),
      then: (resolve: (v: unknown) => void) => (h.events.push('await'), resolve(h.payload)),
      dispose: () => void h.events.push('dispose'),
    };
  },
}));
const steps = vi.hoisted(() => ({
  postCriteriaCardStep: vi.fn(async () => (steps.log('post'), '42')),
  armCriteriaCardStep: vi.fn(async () => void steps.log('arm')),
  closeCriteriaCardStep: vi.fn(async () => void steps.log('close')),
  startSandboxStep: vi.fn(async () => ({ name: 'poc-x', chromePath: '/c' })),
  log: (e: string) => void h.events.push(e),
}));
// The other steps are never called here; their real modules import their dependencies lazily.
vi.mock(import('@/workflows/poc-steps'), async (original) => ({ ...(await original()), ...steps }));
vi.mock('@/workflows/plan-run', () => ({
  planRun: async (_input: unknown, deps: unknown) => {
    h.deps = deps;
    return { runId: 'wrun_01K7AAAAAAAAAAAAAAAAAAAAAA', status: 'planned', costUsd: 0 };
  },
}));

const { pocWorkflow } = await import('@/workflows/poc');

const RUN = 'wrun_01K7AAAAAAAAAAAAAAAAAAAAAA';
const card = { runId: RUN } as CriteriaCard;
async function gate() {
  await pocWorkflow({ target: 'prospect-landing', brief: '', mode: 'plan' });
  return (h.deps as PlanDeps).awaitCriteria(card);
}

describe('criteria gate', () => {
  beforeEach(() => {
    h.events = [];
    h.tokens = [];
    h.conflict = null;
    h.payload = { decision: 'approve', userId: '1', via: 'telegram' };
    vi.clearAllMocks();
  });

  it('registers the hook before the buttons exist, awaits once, releases it, then closes the card', async () => {
    expect(await gate()).toEqual({ decision: 'approve', userId: '1', via: 'telegram' });
    expect(h.tokens).toEqual([`criteria:${RUN}`]);
    expect(h.events).toEqual(['register', 'post', 'arm', 'await', 'dispose', 'close']);
    expect(steps.closeCriteriaCardStep).toHaveBeenCalledWith(card, '42', { decision: 'approve', via: 'telegram' });
  });

  it('fails without posting when another run owns the token', async () => {
    h.conflict = { runId: 'wrun_OTHER' };
    await expect(gate()).rejects.toBeInstanceOf(FatalError);
    expect(steps.postCriteriaCardStep).not.toHaveBeenCalled();
    expect(h.events).toEqual(['register', 'dispose']);
  });

  it('releases the hook when the card cannot be posted', async () => {
    steps.postCriteriaCardStep.mockRejectedValueOnce(new Error('telegram down'));
    await expect(gate()).rejects.toThrow('telegram down');
    expect(h.events).toEqual(['register', 'dispose']);
  });

  it('refuses a malformed decision', async () => {
    h.payload = { decision: 'yes', userId: '1', via: 'telegram' };
    await expect(gate()).rejects.toBeInstanceOf(FatalError);
    expect(steps.closeCriteriaCardStep).not.toHaveBeenCalled();
    expect(h.events.at(-1)).toBe('dispose');
  });

  it('starts the run\'s Sandbox under the run ID', async () => {
    await pocWorkflow({ target: 'prospect-landing', brief: '', mode: 'plan' });
    await (h.deps as PlanDeps).startSandbox();
    expect(steps.startSandboxStep).toHaveBeenCalledWith(RUN);
    expect((h.deps as PlanDeps).runId).toBe(RUN);
  });
});
