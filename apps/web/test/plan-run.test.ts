import { LIGHTHOUSE_RUNS as CORE_LIGHTHOUSE_RUNS, type Baseline, type LighthouseRun, type RunIndexRow, type Span } from '@v-copilot/poc-core';
import { describe, expect, it, vi } from 'vitest';
import type { GateDecision } from '@/lib/gates';
import type { AnalyzeResult, IntakeResult, ReportRequest } from '@/lib/poc/types';
import { LIGHTHOUSE_RUNS, planRun, type PlanDeps } from '@/workflows/plan-run';

const RUN = 'wrun_01K7AAAAAAAAAAAAAAAAAAAAAA';
const median = { performance: 61, lcp: 18329.984, cls: 0.1267, tbt: 229, fcp: 2245.984, ttfb: 47, jsBytes: 59676, accessibility: 85, seo: 82 };
const lhRun: LighthouseRun = { lighthouseVersion: '13.5.0', metrics: median, opportunities: [], scriptBytes: {} };
const baseline: Baseline = {
  url: 'https://akim136.github.io/v-copilot/prospect-landing/', measuredAt: '2026-10-10T00:01:00.000Z', lighthouseVersion: '13.5.0',
  runs: [median, median, median], median, opportunities: [], scriptBytes: {},
};
const span = (costUsd: number, attempt = 1): Span => ({
  runId: RUN, step: 'analyze', model: 'openai/gpt-5.6-terra', attempt, inputTokens: 1, cachedInputTokens: 0, cacheWriteTokens: 0,
  outputTokens: 1, costUsd, latencyMs: 1, mode: 'live', startedAt: '2026-10-10T00:02:00.000Z',
});
const analysis = {
  sections: [], opportunities: [{ title: 'Size the hero image', detail: 'd', metrics: ['lcp' as const] }],
  criteria: [{ id: 'c1', metric: 'lcp' as const, baseline: median.lcp, target: 2500, rationale: 'Hero image.' }], dropped: [],
};
const okIntake: IntakeResult = {
  ok: true, targetName: 'prospect-landing', html: '<h1>x</h1>', imageSizes: [],
  outline: { headings: [], textBlocks: [], images: [], landmarks: [], scripts: [], order: ['h-0-aaaaaaaa'] },
};
const approve: GateDecision = { decision: 'approve', userId: '1', via: 'telegram' };

// Fake steps that record every call. Each test overrides only what it is about.
function fakeDeps(over: Partial<PlanDeps> = {}) {
  const calls = { reports: [] as ReportRequest[], rows: [] as RunIndexRow[], alerts: [] as string[] };
  let t = 0;
  const d: PlanDeps = {
    runId: RUN,
    now: () => new Date(Date.UTC(2026, 9, 10, 0, 0, t++)).toISOString(),
    clock: () => (t += 1000),
    intake: vi.fn(async () => okIntake),
    readCachedBaseline: vi.fn(async () => null),
    startSandbox: vi.fn(async () => ({ name: 'poc-x', chromePath: '/chrome' })),
    lighthouse: vi.fn(async () => lhRun),
    stopSandbox: vi.fn(async () => {}),
    psiField: vi.fn(async () => undefined),
    saveBaseline: vi.fn(async () => baseline),
    analyze: vi.fn(async (): Promise<AnalyzeResult> => ({ ok: true, spans: [span(0.02)], analysis })),
    awaitCriteria: vi.fn(async () => approve),
    writeReport: vi.fn(async (r: ReportRequest) => void calls.reports.push(structuredClone(r))),
    recordRun: vi.fn(async (row: RunIndexRow) => void calls.rows.push(row)),
    alert: vi.fn(async (text: string) => void calls.alerts.push(text)),
    ...over,
  };
  return { d, calls };
}
const input = { target: 'prospect-landing', brief: 'Make it fast', mode: 'plan' as const };

describe('planRun', () => {
  it('uses the same number of Lighthouse runs as poc-core', () => {
    expect(LIGHTHOUSE_RUNS).toBe(CORE_LIGHTHOUSE_RUNS);
  });

  it('rejects an unlisted target with no Sandbox, Lighthouse, model or gate, and still reports and indexes it', async () => {
    const { d, calls } = fakeDeps({ intake: vi.fn(async (): Promise<IntakeResult> => ({ ok: false, reason: 'not_allowlisted' })) });
    const out = await planRun({ ...input, target: 'https://evil.example/' }, d);
    expect(out).toMatchObject({ status: 'rejected', rejectReason: 'not_allowlisted', costUsd: 0 });
    for (const step of [d.readCachedBaseline, d.startSandbox, d.lighthouse, d.psiField, d.analyze, d.awaitCriteria]) expect(step).not.toHaveBeenCalled();
    expect(calls.reports).toHaveLength(1);
    expect(calls.reports[0]).toMatchObject({ status: 'rejected', rejectReason: 'not_allowlisted', input: { target: 'https://evil.example/' } });
    expect(calls.rows).toEqual([expect.objectContaining({ runId: RUN, target: '_unlisted', status: 'rejected', costUsd: 0 })]);
    expect(calls.alerts).toEqual([]);
  });

  it('refuses at the daily cap before any model call, alerts once and marks the cap in the index', async () => {
    const { d, calls } = fakeDeps({ intake: vi.fn(async (): Promise<IntakeResult> => ({ ok: false, reason: 'daily_cap', targetName: 'prospect-landing', spentUsd: 8.2 })) });
    const out = await planRun(input, d);
    expect(out).toMatchObject({ status: 'rejected', rejectReason: 'daily_cap' });
    expect(d.analyze).not.toHaveBeenCalled();
    expect(d.startSandbox).not.toHaveBeenCalled();
    expect(calls.alerts).toHaveLength(1);
    expect(calls.alerts[0]).toMatch(/\$8\.20/);
    expect(calls.rows[0]).toMatchObject({ status: 'rejected', capHit: 'daily_cap', target: 'prospect-landing' });
  });

  it('measures three times in one Sandbox, stops it, and ends planned on approval', async () => {
    const { d, calls } = fakeDeps({ psiField: vi.fn(async () => ({ LARGEST_CONTENTFUL_PAINT_MS: 4100 })) });
    const out = await planRun(input, d);
    expect(out).toEqual({ runId: RUN, status: 'planned', costUsd: 0.02 });
    expect(d.startSandbox).toHaveBeenCalledTimes(1);
    expect(vi.mocked(d.lighthouse).mock.calls.map((c) => c[2])).toEqual([0, 1, 2]);
    expect(d.stopSandbox).toHaveBeenCalledTimes(1);
    expect(d.saveBaseline).toHaveBeenCalledWith(expect.objectContaining({ runs: [lhRun, lhRun, lhRun], psiField: { LARGEST_CONTENTFUL_PAINT_MS: 4100 } }));
    expect(d.awaitCriteria).toHaveBeenCalledWith(expect.objectContaining({ runId: RUN, criteria: analysis.criteria, costUsd: 0.02, runs: 3 }));
    expect(calls.reports.at(-1)).toMatchObject({ status: 'planned', gate: { decision: 'approve', via: 'telegram' }, analysis });
    expect(Object.keys(calls.reports.at(-1)!.timingsMs)).toEqual(['intake', 'baseline', 'analyze', 'await_criteria']);
    expect(calls.rows).toEqual([expect.objectContaining({ status: 'planned', costUsd: 0.02 })]);
    expect(calls.rows[0]!.capHit).toBeUndefined();
    expect(calls.alerts).toEqual([]);
  });

  it('starts no Sandbox when today\'s baseline is cached', async () => {
    const { d } = fakeDeps({ readCachedBaseline: vi.fn(async () => baseline) });
    await planRun(input, d);
    expect(d.startSandbox).not.toHaveBeenCalled();
    expect(d.lighthouse).not.toHaveBeenCalled();
    expect(d.saveBaseline).not.toHaveBeenCalled();
    expect(d.analyze).toHaveBeenCalledWith(expect.objectContaining({ baseline }));
  });

  it('ends rejected with criteria_rejected when the criteria are rejected', async () => {
    const { d, calls } = fakeDeps({ awaitCriteria: vi.fn(async (): Promise<GateDecision> => ({ ...approve, decision: 'reject' })) });
    expect(await planRun(input, d)).toMatchObject({ status: 'rejected', rejectReason: 'criteria_rejected' });
    expect(calls.rows[0]!.status).toBe('rejected');
    expect(calls.alerts).toEqual([]);
  });

  it('fails at the per-run cap without reaching the gate, alerts, and counts every span', async () => {
    const { d, calls } = fakeDeps({
      analyze: vi.fn(async (): Promise<AnalyzeResult> => ({ ok: false, reason: 'cap', cap: 'run_cap', spentUsd: 1.52, limitUsd: 1.5, spans: [span(1.52)] })),
    });
    expect(await planRun(input, d)).toMatchObject({ status: 'failed', costUsd: 1.52 });
    expect(d.awaitCriteria).not.toHaveBeenCalled();
    expect(calls.alerts).toHaveLength(1);
    expect(calls.alerts[0]).toMatch(/per-run cap/);
    expect(calls.rows[0]).toMatchObject({ status: 'failed', capHit: 'run_cap', costUsd: 1.52 });
    expect(calls.reports.at(-1)).toMatchObject({ status: 'failed', error: expect.stringMatching(/per-run cap/) });
  });

  it('retries a retryable model failure once, passing the spend so far, and counts both calls', async () => {
    const analyze = vi.fn()
      .mockResolvedValueOnce({ ok: false, reason: 'model', message: 'model call failed: APICallError (status 429)', retryable: true, spans: [span(0.3)] })
      .mockResolvedValueOnce({ ok: true, spans: [span(0.02, 2)], analysis });
    const { d, calls } = fakeDeps({ analyze });
    expect(await planRun(input, d)).toMatchObject({ status: 'planned' });
    expect(analyze.mock.calls.map((c) => [c[0].attempt, c[0].runCostUsd])).toEqual([[1, 0], [2, 0.3]]);
    expect(calls.rows[0]!.costUsd).toBeCloseTo(0.32, 10);
  });

  it('fails without a second call when the model failure is not retryable', async () => {
    const analyze = vi.fn(async (): Promise<AnalyzeResult> => ({ ok: false, reason: 'model', message: 'model returned no valid structured output', retryable: false, spans: [span(0.1)] }));
    const { d, calls } = fakeDeps({ analyze });
    expect(await planRun(input, d)).toMatchObject({ status: 'failed', costUsd: 0.1 });
    expect(analyze).toHaveBeenCalledTimes(1);
    expect(calls.alerts).toHaveLength(1);
    expect(calls.rows[0]).toMatchObject({ status: 'failed' });
    expect(calls.rows[0]!.capHit).toBeUndefined();
  });

  it('stops the Sandbox, reports, alerts and indexes the run when a step throws, then rethrows', async () => {
    const boom = new Error('lighthouse exited with 1');
    const { d, calls } = fakeDeps({ lighthouse: vi.fn().mockResolvedValueOnce(lhRun).mockRejectedValueOnce(boom) });
    await expect(planRun(input, d)).rejects.toBe(boom);
    expect(d.stopSandbox).toHaveBeenCalledTimes(1);
    expect(d.analyze).not.toHaveBeenCalled();
    expect(calls.reports.at(-1)).toMatchObject({ status: 'failed', error: expect.stringMatching(/^baseline failed: Error: lighthouse exited with 1/) });
    expect(calls.alerts).toHaveLength(1);
    expect(calls.rows).toEqual([expect.objectContaining({ status: 'failed', target: 'prospect-landing' })]);
  });

  it('still indexes the run when the failure report and the alert both fail', async () => {
    const { d, calls } = fakeDeps({
      intake: vi.fn(async () => { throw new Error('index unreadable'); }),
      writeReport: vi.fn(async () => { throw new Error('blob down'); }),
      alert: vi.fn(async () => { throw new Error('telegram down'); }),
    });
    await expect(planRun(input, d)).rejects.toThrow('index unreadable');
    expect(calls.rows).toEqual([expect.objectContaining({ status: 'failed', target: '_unlisted' })]);
  });

  it('alerts and fails when the index cannot be written', async () => {
    const { d, calls } = fakeDeps({ recordRun: vi.fn(async () => { throw new Error('conflict after 5 attempts'); }) });
    await expect(planRun(input, d)).rejects.toThrow('conflict after 5 attempts');
    expect(calls.alerts).toEqual([expect.stringMatching(/runs\/index\.json/)]);
  });

  it('treats a failed report write on a finished run as a failure', async () => {
    const writeReport = vi.fn().mockRejectedValueOnce(new Error('blob down')).mockResolvedValueOnce(undefined);
    const { d, calls } = fakeDeps({ writeReport });
    await expect(planRun(input, d)).rejects.toThrow('blob down');
    expect(writeReport.mock.calls.at(-1)![0]).toMatchObject({ status: 'failed', error: expect.stringMatching(/^report failed: Error: blob down/) });
    expect(calls.rows[0]!.status).toBe('failed');
  });
});
