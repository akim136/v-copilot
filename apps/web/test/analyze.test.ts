import { mkdtempSync, readdirSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  ANALYZE_SYSTEM, buildPocReport, checkAllowlist, comparableReport, costUsd, extractOutline, MODELS, parseLighthouseResult,
  parseTargetsConfig, worstCaseUsage, type Baseline, type ModelMode,
} from '@v-copilot/poc-core';
import { APICallError } from 'ai';
import { MockLanguageModelV4 } from 'ai/test';
import { describe, expect, it, vi } from 'vitest';
import { analyzeInput, runAnalyze, type AnalyzeDeps } from '@/lib/poc/analyze';
import type { AnalyzeRequest } from '@/lib/poc/types';

const BASE = 'https://akim136.github.io/v-copilot/prospect-landing/';
const allowed = checkAllowlist(parseTargetsConfig({ 'prospect-landing': { url: BASE, permission: 'owned', kind: 'fixture' } }), 'prospect-landing');
if (!allowed.ok) throw new Error('fixture target');
const target = allowed.target;
const html = readFileSync(join(import.meta.dirname, '../../../fixtures/prospects/landing/index.html'), 'utf8');
const run = parseLighthouseResult(JSON.parse(readFileSync(join(import.meta.dirname, '../../../packages/poc-core/test/fixtures/lhr-prospect-landing.json'), 'utf8')));
const baseline: Baseline = {
  url: BASE, measuredAt: '2026-10-10T00:01:00.000Z', lighthouseVersion: run.lighthouseVersion,
  runs: [run.metrics, run.metrics, run.metrics], median: run.metrics, opportunities: run.opportunities, scriptBytes: run.scriptBytes,
};
const intakeOutline = extractOutline(html, { baseUrl: BASE });
const RUN = 'wrun_01K7AAAAAAAAAAAAAAAAAAAAAA';
const req = (o: Partial<AnalyzeRequest> = {}): AnalyzeRequest => ({
  runId: RUN, targetName: 'prospect-landing', brief: 'Make the landing page fast', html, imageSizes: [],
  outlineOrder: intakeOutline.order, baseline, runCostUsd: 0, attempt: 1, ...o,
});

const output = {
  sections: [{ kind: 'hero', name: 'Hero', ids: [intakeOutline.order[0], 'x-9-invented'] }],
  opportunities: [{ title: 'Size the hero image', detail: 'It is the LCP element.', metrics: ['lcp'] }],
  criteria: [{ metric: 'lcp', baseline: 1, target: 2500, rationale: 'Hero image is the LCP element.' }],
};
type GenerateResult = Awaited<ReturnType<MockLanguageModelV4['doGenerate']>>;
function mockModel(fail?: Error) {
  const result: GenerateResult = {
    content: [{ type: 'text', text: JSON.stringify(output) }],
    finishReason: { unified: 'stop', raw: 'stop' },
    usage: { inputTokens: { total: 6000, noCache: 4976, cacheRead: 1024, cacheWrite: undefined }, outputTokens: { total: 900, text: 700, reasoning: 200 } },
    warnings: [],
  };
  return new MockLanguageModelV4({ modelId: MODELS.terra, doGenerate: async () => { if (fail) throw fail; return result; } });
}
const deps = (o: Partial<AnalyzeDeps> = {}): AnalyzeDeps => ({
  target, readDailySpend: async () => 0, mode: 'record' as ModelMode, recordingsDir: mkdtempSync(join(tmpdir(), 'rec-')),
  stepAttempt: 1, now: () => new Date('2026-10-10T00:02:00.000Z'), ...o,
});

describe('analyze', () => {
  it('fills script sizes from the baseline without changing outline IDs', () => {
    const { outline } = analyzeInput(req(), target);
    expect(outline.order).toEqual(intakeOutline.order);
    const host = new URL(BASE).host;
    expect(intakeOutline.scripts.find((s) => s.host === host)?.bytes).toBe(0);
    expect(outline.scripts.find((s) => s.host === host)?.bytes).toBeGreaterThan(0);
    expect(() => analyzeInput(req({ outlineOrder: ['h-0-00000000'] }), target)).toThrow(/outline IDs changed/);
  });

  it('asks for structured output with no tools, keeps the page in the untrusted block, and reconciles the answer in code', async () => {
    const model = mockModel();
    const res = await runAnalyze(req(), deps({ model }));
    if (!res.ok) throw new Error(`analyze failed: ${JSON.stringify(res)}`);
    const sent = model.doGenerateCalls[0]!;
    expect(sent.tools ?? []).toEqual([]);
    expect(sent.responseFormat).toMatchObject({ type: 'json' });
    const prompt = JSON.stringify(sent.prompt);
    expect(prompt).toContain('untrusted_page_outline');
    expect(prompt).not.toContain('<script');
    expect(res.analysis.criteria).toEqual([{ id: 'c1', metric: 'lcp', baseline: run.metrics.lcp, target: 2500, rationale: 'Hero image is the LCP element.' }]);
    expect(res.analysis.sections).toEqual([{ kind: 'hero', name: 'Hero', ids: [intakeOutline.order[0]] }]);
    expect(res.spans).toHaveLength(1);
    expect(res.spans[0]).toMatchObject({ step: 'analyze', model: MODELS.terra, attempt: 1, inputTokens: 6000, cachedInputTokens: 1024, outputTokens: 900 });
  });

  it('charges each earlier attempt that died unrecorded its worst case, and counts it toward the cap', async () => {
    const { prompt } = analyzeInput(req(), target);
    const worst = costUsd(MODELS.terra, worstCaseUsage(ANALYZE_SYSTEM, prompt));
    const res = await runAnalyze(req({ attempt: 1 }), deps({ model: mockModel(), stepAttempt: 3, mode: 'live' }));
    if (!res.ok) throw new Error('analyze failed');
    expect(res.spans).toHaveLength(3);
    expect(res.spans.slice(0, 2).map((s) => [s.costUsd, s.latencyMs, s.mode])).toEqual([[worst, 0, 'live'], [worst, 0, 'live']]);

    // Near the per-run cap the worst-case charge alone stops the call.
    const model = mockModel();
    const capped = await runAnalyze(req({ runCostUsd: 1.5 - worst / 2 }), deps({ model, stepAttempt: 2, mode: 'live' }));
    expect(capped).toMatchObject({ ok: false, reason: 'cap', cap: 'run_cap', spans: [{ costUsd: worst }] });
    expect(model.doGenerateCalls).toHaveLength(0);
  });

  it('adds no unrecorded charge in replay, which makes no calls', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'rec-'));
    await runAnalyze(req(), deps({ model: mockModel(), recordingsDir: dir }));
    const res = await runAnalyze(req(), deps({ mode: 'replay', recordingsDir: dir, stepAttempt: 2 }));
    expect(res.ok && res.spans.length).toBe(1);
  });

  it('replays a recorded run to an identical report with zero live calls', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'rec-'));
    const recorded = await runAnalyze(req(), deps({ model: mockModel(), recordingsDir: dir }));
    expect(readdirSync(dir)).toHaveLength(1);
    const replayed = await runAnalyze(req({ runId: 'wrun_01K7BBBBBBBBBBBBBBBBBBBBBB' }), deps({ mode: 'replay', recordingsDir: dir }));
    if (!recorded.ok || !replayed.ok) throw new Error('analyze failed');
    expect(replayed.analysis).toEqual(recorded.analysis);
    const report = (r: typeof recorded, runId: string) => buildPocReport({
      runId, mode: 'plan', brief: 'Make the landing page fast', status: 'planned',
      target: { name: target.name, url: target.url, kind: target.kind, permission: target.permission },
      baseline, criteria: r.analysis.criteria, spans: r.spans.map((s) => ({ ...s, runId, mode: 'live', latencyMs: 0 })), timingsMs: {},
    });
    expect(comparableReport(report(replayed, 'wrun_B'))).toEqual(comparableReport(report(recorded, 'wrun_A')));
    expect(replayed.spans[0]!.costUsd).toBe(recorded.spans[0]!.costUsd);
  });

  it('returns the cap instead of calling the model at the per-run or 24-hour cap', async () => {
    const model = mockModel();
    expect(await runAnalyze(req({ runCostUsd: 1.51 }), deps({ model }))).toMatchObject({ ok: false, reason: 'cap', cap: 'run_cap', spans: [] });
    expect(await runAnalyze(req(), deps({ model, readDailySpend: async () => 8 }))).toMatchObject({ ok: false, reason: 'cap', cap: 'daily_cap' });
    expect(model.doGenerateCalls).toHaveLength(0);
  });

  it('returns a failed call with its charge, and a replay miss as not retryable', async () => {
    const fail = new APICallError({ message: 'rate limited', url: 'https://gateway', requestBodyValues: {}, statusCode: 429, isRetryable: true });
    const res = await runAnalyze(req(), deps({ model: mockModel(fail), mode: 'live' }));
    expect(res).toMatchObject({ ok: false, reason: 'model', retryable: true, message: expect.stringMatching(/status 429/) });
    expect(res.spans).toHaveLength(1);
    expect(res.spans[0]!.costUsd).toBeGreaterThan(0);

    const miss = await runAnalyze(req(), deps({ mode: 'replay' }));
    expect(miss).toMatchObject({ ok: false, reason: 'model', retryable: false, spans: [] });
  });

  it('reads the 24-hour spend before every call', async () => {
    const readDailySpend = vi.fn(async () => 0);
    await runAnalyze(req(), deps({ model: mockModel(), readDailySpend }));
    expect(readDailySpend).toHaveBeenCalledTimes(1);
  });
});
