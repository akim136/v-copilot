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
// The planRun deps that are steps, and the step each one calls.
const DEP_STEPS = {
  resolveTarget: 'resolveTargetStep', intake: 'intakeStep', readCachedBaseline: 'readCachedBaselineStep',
  startSandbox: 'startSandboxStep', lighthouse: 'lighthouseStep', stopSandbox: 'stopSandboxStep', psiField: 'psiFieldStep',
  saveBaseline: 'saveBaselineStep', readDailySpend: 'readDailySpendStep', analyze: 'analyzeStep',
  writeReport: 'writeReportStep', recordRun: 'recordRunStep', alert: 'alertStep',
} as const;
const steps = vi.hoisted(() => ({
  postCriteriaCardStep: vi.fn(async () => (steps.log('post'), '42')),
  armCriteriaCardStep: vi.fn(async () => void steps.log('arm')),
  closeCriteriaCardStep: vi.fn(async () => void steps.log('close')),
  startSandboxStep: vi.fn(async () => ({ name: 'poc-x', chromePath: '/c' })),
  resolveTargetStep: vi.fn(async () => null), intakeStep: vi.fn(async () => null), readCachedBaselineStep: vi.fn(async () => null),
  lighthouseStep: vi.fn(async () => null), stopSandboxStep: vi.fn(async () => {}), psiFieldStep: vi.fn(async () => undefined),
  saveBaselineStep: vi.fn(async () => null), readDailySpendStep: vi.fn(async () => 0), analyzeStep: vi.fn(async () => null),
  writeReportStep: vi.fn(async () => {}), recordRunStep: vi.fn(async () => {}), alertStep: vi.fn(async () => {}),
  log: (e: string) => void h.events.push(e),
}));
vi.mock('@/workflows/poc-steps', async (original) => ({ ...(await original<object>()), ...steps }));
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

  it('calls every step as a plain function, so the deps object is never serialized as its `this`', async () => {
    await pocWorkflow({ target: 'prospect-landing', brief: '', mode: 'plan' });
    const deps = h.deps as unknown as Record<string, (...args: unknown[]) => Promise<unknown>>;
    for (const [dep, step] of Object.entries(DEP_STEPS)) {
      await deps[dep]!('a', 'b', 'c');
      expect(steps[step].mock.contexts.at(-1), dep).toBeUndefined();
    }
    expect(steps.recordRunStep).toHaveBeenCalledWith('a');
    expect(steps.lighthouseStep).toHaveBeenCalledWith('a', 'b', 'c');
  });

  it('starts the run\'s Sandbox under the run ID', async () => {
    await pocWorkflow({ target: 'prospect-landing', brief: '', mode: 'plan' });
    await (h.deps as PlanDeps).startSandbox();
    expect(steps.startSandboxStep).toHaveBeenCalledWith(RUN);
    expect((h.deps as PlanDeps).runId).toBe(RUN);
  });
});
